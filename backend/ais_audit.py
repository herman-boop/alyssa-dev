"""Audit & kontrol refresh posisi kapal (AIS) — TANPA koordinat simulasi.

- validasi MMSI (9 digit, MID 201-775) & IMO (7 digit, checksum)
- log percobaan refresh persisten (koleksi `ais_refresh_log`) supaya penyebab
  posisi basi (kuota / 404 / timeout / data provider lama) terlihat di panel admin
- cooldown refresh manual per kapal (hemat kuota provider)
"""
import os
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("ais")

COLL = "ais_refresh_log"
# Refresh manual (tombol di peta): jeda minimum per kapal, menit. Default 30.
MANUAL_COOLDOWN_MIN = int(os.environ.get("AIS_MANUAL_COOLDOWN_MIN") or "30")
LOG_KEEP_DAYS = 30


def validate_mmsi(v):
    """(ok, pesan). MMSI kapal = 9 digit, 3 digit awal (MID) 201-775."""
    s = str(v or "").strip()
    if not s:
        return True, ""
    if not s.isdigit() or len(s) != 9:
        return False, "MMSI harus 9 digit angka"
    if not (201 <= int(s[:3]) <= 775):
        return False, "3 digit awal MMSI (kode negara/MID) di luar rentang 201-775"
    return True, ""


def validate_imo(v):
    """(ok, pesan). IMO = 7 digit dengan checksum (digit ke-1..6 x 7..2, jumlah mod 10 = digit terakhir)."""
    s = str(v or "").strip()
    if s.upper().startswith("IMO"):
        s = s[3:].strip()
    if not s:
        return True, ""
    if not s.isdigit() or len(s) != 7:
        return False, "IMO harus 7 digit angka"
    total = sum(int(d) * w for d, w in zip(s[:6], range(7, 1, -1)))
    if total % 10 != int(s[6]):
        return False, "checksum IMO tidak cocok (kemungkinan salah ketik)"
    return True, ""


def identity_issues(mmsi, imo):
    out = []
    ok1, m1 = validate_mmsi(mmsi)
    ok2, m2 = validate_imo(imo)
    if not ok1:
        out.append(m1)
    if not ok2:
        out.append(m2)
    if not str(mmsi or "").strip() and not str(imo or "").strip():
        out.append("MMSI dan IMO sama-sama kosong")
    return out


async def log_attempt(db, ident, outcome, **extra):
    """Catat 1 percobaan refresh. outcome: updated|same|older|no_position|http_error|timeout|quota|no_timestamp|disabled."""
    try:
        doc = {"ident": str(ident), "outcome": outcome,
               "at": datetime.now(timezone.utc).isoformat()}
        doc.update({k: v for k, v in extra.items() if v is not None})
        await db[COLL].insert_one(doc)
    except Exception as e:      # log tidak boleh menggagalkan refresh
        logger.info("[ais] log_attempt gagal: %s", e)


async def last_attempts(db, ident, limit=5):
    try:
        cur = db[COLL].find({"ident": str(ident)}, {"_id": 0}).sort("at", -1).limit(limit)
        return [d async for d in cur]
    except Exception:
        return []


async def cooldown_left_seconds(db, ident, minutes=None):
    """Sisa detik cooldown refresh MANUAL (percobaan manual terakhir untuk kapal ini)."""
    mins = MANUAL_COOLDOWN_MIN if minutes is None else minutes
    try:
        d = await db[COLL].find_one({"ident": str(ident), "manual": True}, {"_id": 0, "at": 1}, sort=[("at", -1)])
    except TypeError:
        rows = await last_attempts(db, ident, 20)
        d = next((r for r in rows if r.get("manual")), None)
    except Exception:
        d = None
    if not d or not d.get("at"):
        return 0
    try:
        t = datetime.fromisoformat(str(d["at"]).replace("Z", "+00:00"))
    except Exception:
        return 0
    left = (t + timedelta(minutes=mins) - datetime.now(timezone.utc)).total_seconds()
    return max(0, int(left))


# ── Monitoring pemakaian API & status per kapal ─────────────────────────────
CALLS = "ais_api_calls"      # 1 dokumen per panggilan ke provider
STATUS = "ais_ship_status"   # status terakhir per kapal (ident = mmsi atau imo)

# Penyebab "tidak ada data" yang DIBEDAKAN (bukan satu pesan umum):
#   ok | pending | not_found | no_signal | quota | auth | api_error | timeout | disabled
PESAN = {
    "ok": "",
    "pending": "Posisi sedang diminta dari provider AIS.",
    "not_found": "Kapal tidak ditemukan di provider AIS — periksa kembali nomor IMO/MMSI.",
    "no_position": "Provider AIS belum punya posisi untuk kapal ini (nomor IMO/MMSI belum cocok, atau belum ada sinyal AIS).",
    "no_signal": "Kapal dikenali provider, tetapi belum ada sinyal AIS (di luar jangkauan penerima atau transponder mati).",
    "quota": "Kuota API provider AIS sedang habis. Posisi terakhir yang valid tetap ditampilkan bila ada.",
    "auth": "API key atau paket provider AIS ditolak (HTTP 401/403) — perlu dicek admin.",
    "api_error": "Layanan provider AIS sedang gagal merespons; sistem mencoba lagi otomatis.",
    "timeout": "Provider AIS tidak merespons tepat waktu; sistem mencoba lagi otomatis.",
    "disabled": "Integrasi AIS belum diaktifkan di server (API key belum diisi).",
}


def classify_http(status=None, exc=None):
    """Kelas hasil 1 panggilan HTTP: ok | quota | auth | not_found | timeout | api_error."""
    if exc is not None:
        t = (str(exc) + type(exc).__name__).lower()
        return "timeout" if ("timed out" in t or "timeout" in t) else "api_error"
    if status == 200:
        return "ok"
    if status == 429:
        return "quota"
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "not_found"
    return "api_error"


def _hdr_int(headers, name):
    try:
        v = (headers or {}).get(name)
        return int(float(v)) if v not in (None, "") else None
    except Exception:
        return None


async def log_call(db, ident, path, cls, status=None, headers=None):
    """Catat 1 panggilan ke provider (untuk monitoring kuota). Tidak boleh menggagalkan refresh."""
    try:
        await db[CALLS].insert_one({
            "at": datetime.now(timezone.utc).isoformat(), "ident": str(ident), "path": str(path)[:60],
            "cls": cls, "http": status,
            "remaining": _hdr_int(headers, "X-RateLimit-Remaining"), "limit": _hdr_int(headers, "X-RateLimit-Limit")})
    except Exception as e:
        logger.info("[ais] log_call gagal: %s", e)


async def set_status(db, ident, state, **extra):
    """Simpan status terakhir kapal (dipakai halaman tracking utk menjelaskan 'belum ada data')."""
    try:
        d = {"ident": str(ident), "state": state, "last_checked_at": datetime.now(timezone.utc).isoformat()}
        d.update({k: v for k, v in extra.items() if v is not None})
        await db[STATUS].update_one({"ident": str(ident)}, {"$set": d}, upsert=True)
    except Exception as e:
        logger.info("[ais] set_status gagal: %s", e)


async def get_status(db, ident):
    try:
        return await db[STATUS].find_one({"ident": str(ident)}, {"_id": 0})
    except Exception:
        return None


def status_publik(st, provider_enabled=True):
    """Status ramah-pelanggan: {state, message, last_checked_at}. Tanpa detail teknis."""
    if not provider_enabled:
        return {"state": "disabled", "message": PESAN["disabled"], "last_checked_at": ""}
    if not st:
        return {"state": "pending", "message": PESAN["pending"], "last_checked_at": ""}
    s = st.get("state") or "pending"
    return {"state": s, "message": PESAN.get(s, ""), "last_checked_at": st.get("last_checked_at") or ""}


async def usage(db, now=None):
    """Ringkasan pemakaian API bulan ini & hari ini: total, berhasil, gagal per kelas, sisa kuota (bila provider mengirim header)."""
    now = now or datetime.now(timezone.utc)
    month0 = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
    day0 = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    out = {"bulan": {"total": 0}, "hari": {"total": 0}, "sisa_kuota": None, "batas_kuota": None, "terakhir": None}
    last_hdr = None
    try:
        cur = db[CALLS].find({"at": {"$gte": month0}}, {"_id": 0})
        rows = [d async for d in cur]
    except Exception:
        rows = []
    for d in rows:
        at = str(d.get("at") or "")
        if at < month0:
            continue
        for key, ok_ in (("bulan", True), ("hari", at >= day0)):
            if not ok_:
                continue
            b = out[key]
            b["total"] += 1
            b[d.get("cls") or "api_error"] = b.get(d.get("cls") or "api_error", 0) + 1
        if d.get("remaining") is not None and (last_hdr is None or at > last_hdr[0]):
            last_hdr = (at, d.get("remaining"), d.get("limit"))
        if out["terakhir"] is None or at > out["terakhir"]:
            out["terakhir"] = at
    if last_hdr:
        out["sisa_kuota"], out["batas_kuota"] = last_hdr[1], last_hdr[2]
    return out
