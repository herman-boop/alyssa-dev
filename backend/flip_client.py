"""
Adapter tipis ke Flip (flip.id) untuk transfer ke rekening driver. SEMUA detail API Flip ada di file ini
(URL, nama header, nama field, status) supaya gampang dicocokkan dengan dokumentasi resmi.

PENTING: dirancang dari pengetahuan umum API Flip v3 + v2 dan BELUM diuji ke server Flip sungguhan
(dokumentasi tidak bisa diakses dari lingkungan pengembangan). Wajib dites di Sandbox dulu; kalau ada
nama header/field/status yang beda, ubah HANYA konstanta di bagian atas file ini.

Konfigurasi lewat environment (tidak pernah ditulis di kode / log):
  FLIP_PAYOUT_ENABLED   "true" untuk menyalakan fitur (default mati)
  FLIP_ENV              "sandbox" (default) atau "live"
  FLIP_SECRET_KEY       secret key Flip (dipakai sebagai username Basic Auth)
  FLIP_MAX_AMOUNT       batas nominal per transfer (default 1.000.000)
"""
import os
from datetime import datetime, timezone, timedelta

BASE_URL = {"sandbox": "https://bigflip.id/big_sandbox_api", "live": "https://bigflip.id/api"}
PATH_INQUIRY = "/v2/disbursement/bank-account-inquiry"   # di dokumentasi Flip, Bank Account Inquiry ada di bagian Disbursement (bukan General)
PATH_DISBURSE = "/v3/disbursement"
PATH_GET_DISBURSEMENT = "/v3/get-disbursement"
HDR_IDEMPOTENCY = "idempotency-key"
HDR_TIMESTAMP = "X-TIMESTAMP"
TIMEOUT_S = 25
WIB = timezone(timedelta(hours=7))

# Status Flip -> status internal kita
DISBURSE_STATUS = {"DONE": "berhasil", "PENDING": "diproses", "CANCELLED": "gagal", "FAILED": "gagal"}
INQUIRY_OK = "SUCCESS"


class FlipError(Exception):
    """Kegagalan yang jelas dari Flip (HTTP 4xx/5xx dengan isi) atau konfigurasi."""
    def __init__(self, message, status=None, body=None):
        super().__init__(message)
        self.status, self.body = status, body


class FlipUnknown(Exception):
    """Hasil TIDAK PASTI (timeout / koneksi putus): uang mungkin sudah terkirim. Jangan dicoba ulang otomatis."""


def config():
    env = (os.environ.get("FLIP_ENV") or "sandbox").strip().lower()
    if env not in BASE_URL:
        env = "sandbox"
    try:
        cap = int(os.environ.get("FLIP_MAX_AMOUNT") or 1_000_000)
    except ValueError:
        cap = 1_000_000
    return {
        "enabled": (os.environ.get("FLIP_PAYOUT_ENABLED") or "").strip().lower() == "true",
        "env": env,
        "has_key": bool((os.environ.get("FLIP_SECRET_KEY") or "").strip()),
        "max_amount": cap,
    }


def _auth():
    key = (os.environ.get("FLIP_SECRET_KEY") or "").strip()
    if not key:
        raise FlipError("FLIP_SECRET_KEY belum diisi")
    return (key, "")


def _stamp():
    return datetime.now(WIB).isoformat(timespec="seconds")


def _call(http, method, path, *, data=None, params=None, headers=None):
    cfg = config()
    url = BASE_URL[cfg["env"]] + path
    try:
        r = http.request(method, url, data=data, params=params, headers=headers or {}, auth=_auth(), timeout=TIMEOUT_S)
    except FlipError:
        raise
    except Exception as e:      # timeout / koneksi putus: hasil tidak pasti
        raise FlipUnknown(f"{type(e).__name__}")
    try:
        body = r.json()
    except Exception:
        body = {"raw": (getattr(r, "text", "") or "")[:300]}
    if r.status_code >= 500:
        raise FlipUnknown(f"HTTP {r.status_code}")      # 5xx saat transfer: bisa jadi sudah diproses
    if r.status_code >= 400:
        raise FlipError(_msg(body) or f"HTTP {r.status_code}", status=r.status_code, body=body)
    return body


def _msg(body):
    if isinstance(body, dict):
        errs = body.get("errors")
        if isinstance(errs, list) and errs:
            return "; ".join(str(e.get("message") or e) if isinstance(e, dict) else str(e) for e in errs)[:200]
        return str(body.get("message") or body.get("error") or "")[:200]
    return ""


def inquiry(http, bank_code, account_number, inquiry_key=None):
    """Cek rekening: kembalikan {status, account_holder, raw}. status 'SUCCESS' hanya kalau pemilik terbaca.
    Status Flip: PENDING, SUCCESS, INVALID_ACCOUNT_NUMBER, SUSPECTED_ACCOUNT, BLACK_LISTED.
    inquiry_key (opsional di Flip) mengenali permintaan berulang untuk inquiry yang sama."""
    data = {"account_number": account_number, "bank_code": bank_code}
    if inquiry_key:
        data["inquiry_key"] = inquiry_key
    body = _call(http, "POST", PATH_INQUIRY, data=data)
    return {"status": str(body.get("status") or "").upper(), "account_holder": (body.get("account_holder") or "").strip(), "raw": body}


def disburse(http, *, bank_code, account_number, amount, remark, idempotency_key):
    """Kirim transfer. idempotency_key WAJIB unik per transfer: kirim ulang dengan key yang sama tidak menggandakan uang."""
    body = _call(
        http, "POST", PATH_DISBURSE,
        data={"account_number": account_number, "bank_code": bank_code, "amount": int(amount), "remark": (remark or "")[:18]},
        headers={HDR_IDEMPOTENCY: idempotency_key, HDR_TIMESTAMP: _stamp(), "Content-Type": "application/x-www-form-urlencoded"},
    )
    return {"flip_id": str(body.get("id") or ""), "status": DISBURSE_STATUS.get(str(body.get("status") or "").upper(), "diproses"),
            "reason": str(body.get("reason") or "")[:200], "raw": body}


def check(http, idempotency_key):
    """Tanyakan status transfer ke Flip berdasarkan idempotency key."""
    body = _call(http, "GET", PATH_GET_DISBURSEMENT, params={"idempotency-key": idempotency_key},
                 headers={HDR_TIMESTAMP: _stamp()})
    row = body
    if isinstance(body, dict) and isinstance(body.get("data"), list) and body["data"]:
        row = body["data"][0]
    return {"flip_id": str((row or {}).get("id") or ""), "status": DISBURSE_STATUS.get(str((row or {}).get("status") or "").upper(), "diproses"),
            "reason": str((row or {}).get("reason") or "")[:200], "raw": body}
