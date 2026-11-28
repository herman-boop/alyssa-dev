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
