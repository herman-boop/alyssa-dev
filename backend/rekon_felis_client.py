"""
rekon_felis_client.py — ADAPTER PULL transaksi dari Felis-Alyssa.

Arah data SATU ARAH: alyssa-dev MENARIK dari Felis. Felis tidak pernah memanggil
alyssa-dev. Mengikuti KONTRAK FINAL Felis (3 Okt 2026).

ENDPOINT (prefix /api di base):
  READY    GET  /api/integrasi/siap-tarik
  ACK      POST /api/integrasi/tandai-tertarik
  KOREKSI  GET  /api/integrasi/koreksi
  AKUI     POST /api/integrasi/koreksi/akui

AUTENTIKASI: header `Authorization: Bearer <FELIS_API_TOKEN>`.
  Token TIDAK di-hardcode, TIDAK di-log, TIDAK ditampilkan. Dari ENV.

ENV:
  FELIS_BASE_URL   = https://felis-alyssa-production.up.railway.app  (root, tanpa /api)
  FELIS_API_TOKEN  = <token integrasi>  (diisi lewat jalur aman di Railway)

Semua request blocking (requests) dijalankan via asyncio.to_thread agar tidak
memblok event loop. Kesalahan dibungkus jadi FelisError dengan pesan jelas
(tanpa membocorkan token).
"""

import os
import asyncio
import logging

logger = logging.getLogger("rekon.felis")

# Timeout (connect, read). Query READY bisa agak berat → read timeout longgar.
_TIMEOUT = (10, 60)


class FelisError(Exception):
    """Kegagalan komunikasi/otorisasi dengan Felis (pesan aman untuk ditampilkan)."""


def _base_url() -> str:
    base = (os.environ.get("FELIS_BASE_URL") or "").strip().rstrip("/")
    # Terima baik root maupun yang sudah berakhiran /api — normalkan ke root.
    if base.endswith("/api"):
        base = base[: -len("/api")]
    return base


def _token() -> str:
    return (os.environ.get("FELIS_API_TOKEN") or "").strip()


def is_configured() -> bool:
    """True kalau ENV koneksi Felis sudah lengkap. Token < 32 char dianggap
    tidak ada (sesuai semangat kontrak: integrasi MATI, bukan setengah jalan)."""
    return bool(_base_url()) and len(_token()) >= 32


def _headers(json_body: bool = False) -> dict:
    h = {"Authorization": f"Bearer {_token()}", "Accept": "application/json"}
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def _url(path: str) -> str:
    return f"{_base_url()}/api/integrasi/{path.lstrip('/')}"


def _raise_for_status(r, what: str):
    if r.status_code == 401:
        raise FelisError("Token integrasi Felis tidak sah / belum diisi (401).")
    if r.status_code == 400:
        # body boleh memuat {"pesan": "..."} — tampilkan pesannya saja.
        try:
            msg = (r.json() or {}).get("pesan")
        except Exception:
            msg = None
        raise FelisError(f"Permintaan ke Felis ditolak (400): {msg or 'bad request'} [{what}]")
    if r.status_code != 200:
        raise FelisError(f"Felis HTTP {r.status_code} saat {what}.")


def _get_sync(path: str, params: dict | None):
    import requests
    return requests.get(_url(path), params=params or {}, headers=_headers(), timeout=_TIMEOUT)


def _post_sync(path: str, body: dict):
    import requests
    import json as _json
    return requests.post(_url(path), data=_json.dumps(body or {}),
                         headers=_headers(json_body=True), timeout=_TIMEOUT)


async def fetch_ready(entitas: str | None = None, dari: str | None = None,
                      sampai: str | None = None, batas: int | None = None) -> dict:
    """READY (baca murni, tidak menandai apa pun). Return dict kontrak:
    {batch, dibuat_pada, jumlah, data:[...]}. Aman dipanggil berkali-kali."""
    if not is_configured():
        raise FelisError("Koneksi Felis belum diset (FELIS_BASE_URL + FELIS_API_TOKEN).")
    params = {}
    if entitas:
        params["entitas"] = entitas
    if dari:
        params["dari"] = dari
    if sampai:
        params["sampai"] = sampai
    if batas:
        params["batas"] = int(batas)
    try:
        r = await asyncio.to_thread(_get_sync, "siap-tarik", params)
    except FelisError:
        raise
    except Exception as e:
        raise FelisError(f"Gagal menghubungi Felis (READY): {e}")
    _raise_for_status(r, "READY")
    try:
        return r.json() or {}
    except Exception as e:
        raise FelisError(f"Respons READY Felis bukan JSON valid: {e}")


async def ack(batch: str, transaksi_id: list) -> dict:
    """ACK: tandai transaksi sudah ditarik+tersimpan permanen di alyssa-dev.
    HANYA kirim transaksi_id yang BENAR-BENAR sudah committed. Idempoten."""
    if not is_configured():
        raise FelisError("Koneksi Felis belum diset.")
    ids = [str(x).strip() for x in (transaksi_id or []) if str(x or "").strip()]
    if not batch or not ids:
        raise FelisError("ACK butuh `batch` dan `transaksi_id` tidak kosong.")
    body = {"batch": str(batch), "transaksi_id": ids}
    try:
        r = await asyncio.to_thread(_post_sync, "tandai-tertarik", body)
    except FelisError:
        raise
    except Exception as e:
        raise FelisError(f"Gagal menghubungi Felis (ACK): {e}")
    _raise_for_status(r, "ACK")
    try:
        return r.json() or {}
    except Exception as e:
        raise FelisError(f"Respons ACK Felis bukan JSON valid: {e}")


async def fetch_koreksi() -> dict:
    """KOREKSI: daftar transaksi yang supplier_id-nya DIUBAH sesudah ditarik.
    Return {jumlah, data:[{bank_transaction_id, supplier_id_lama, supplier_id_baru, ...}]}."""
    if not is_configured():
        raise FelisError("Koneksi Felis belum diset.")
    try:
        r = await asyncio.to_thread(_get_sync, "koreksi", None)
    except FelisError:
        raise
    except Exception as e:
        raise FelisError(f"Gagal menghubungi Felis (KOREKSI): {e}")
    _raise_for_status(r, "KOREKSI")
    try:
        return r.json() or {}
    except Exception as e:
        raise FelisError(f"Respons KOREKSI Felis bukan JSON valid: {e}")


async def akui_koreksi(transaksi_id: list) -> dict:
    """AKUI koreksi: beri tahu Felis koreksi sudah diterapkan di alyssa-dev.
    Hanya dipanggil SETELAH pemindahan pembayaran berhasil & tersimpan."""
    if not is_configured():
        raise FelisError("Koneksi Felis belum diset.")
    ids = [str(x).strip() for x in (transaksi_id or []) if str(x or "").strip()]
    if not ids:
        raise FelisError("AKUI butuh `transaksi_id` tidak kosong.")
    try:
        r = await asyncio.to_thread(_post_sync, "koreksi/akui", {"transaksi_id": ids})
    except FelisError:
        raise
    except Exception as e:
        raise FelisError(f"Gagal menghubungi Felis (AKUI): {e}")
    _raise_for_status(r, "AKUI")
    try:
        return r.json() or {}
    except Exception as e:
        raise FelisError(f"Respons AKUI Felis bukan JSON valid: {e}")
