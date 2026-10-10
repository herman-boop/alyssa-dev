"""Aturan tugas petugas yang "simple" (saat ini: Driver Tujuan).

Driver Tujuan nggak dijejelin banyak foto: terima mobil = 1 jepret (foto + checkpoint "Unit diterima"),
lalu 1 checkpoint per hari jam 08.00-16.00 supaya titik di peta akurat. Batas hari (mis. Makassar-Manado
4 hari) dihitung sejak mobil diterima. Modul ini murni (tanpa DB) supaya gampang dites.
"""
import os
from datetime import datetime, timedelta, timezone

JENIS_TERIMA = "Unit diterima"
JENIS_HARIAN = "Dalam perjalanan"
CP_JAM_MULAI = 8
CP_JAM_AKHIR = 16                      # sampai 15:59 (jam < 16)
TZ_OFFSET_OK = {420, 480, 540}         # WIB / WITA / WIT (menit dari UTC)
TZ_DEFAULT = 420


def _dt(s):
    d = datetime.fromisoformat(str(s))
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def tz_offset(v):
    """Offset zona waktu dari HP driver (menit). Di luar WIB/WITA/WIT -> WIB."""
    try:
        v = int(v)
    except (TypeError, ValueError):
        return TZ_DEFAULT
    return v if v in TZ_OFFSET_OK else TZ_DEFAULT


def local(now, offset_min):
    return _dt(now) + timedelta(minutes=offset_min)


def cek_checkpoint(jenis, now, offset_min, checkpoints, has_gps, has_foto):
    """Validasi checkpoint Driver Tujuan. Return (status_http, pesan) atau None kalau lolos."""
    if not has_gps:
        return 400, "Lokasi GPS wajib. Aktifkan izin Lokasi lalu coba lagi."
    if not has_foto:
        return 400, "Foto wajib. Tekan tombol kamera lalu jepret."
    cps = checkpoints or []
    sudah_terima = any(c.get("jenis") == JENIS_TERIMA for c in cps)
    if jenis == JENIS_TERIMA:
        if sudah_terima:
            return 409, "Mobil sudah tercatat diterima."
        return None
    if jenis == JENIS_HARIAN:
        if not sudah_terima:
            return 409, "Terima mobil dulu (foto Unit diterima)."
        lt = local(now, offset_min)
        if not (CP_JAM_MULAI <= lt.hour < CP_JAM_AKHIR):
            return 403, f"Checkpoint hanya bisa jam {CP_JAM_MULAI:02d}.00-{CP_JAM_AKHIR:02d}.00."
        for c in cps:
            if c.get("jenis") == JENIS_HARIAN and c.get("ts") and local(c["ts"], offset_min).date() == lt.date():
                return 409, f"Checkpoint hari ini sudah terkirim. Lanjut besok jam {CP_JAM_MULAI:02d}.00."
        return None
    return 403, "Jenis checkpoint di luar tugas Anda"


def batas_info(task, now=None):
    """Tanggal batas tiba = tanggal mobil diterima + batas_hari. Dihitung dalam zona kantor (DEADLINE_TZ_MIN, WIB)."""
    now = now or datetime.now(timezone.utc)
    cps = task.get("checkpoints") or []
    rec = next((c for c in cps if c.get("jenis") == JENIS_TERIMA and c.get("ts")), None)
    try:
        hari = int(task.get("batas_hari") or 0)
    except (TypeError, ValueError):
        hari = 0
    out = {"batas_hari": hari or None, "diterima_ts": rec["ts"] if rec else None,
           "batas_tanggal": None, "sisa_hari": None, "terlambat": False}
    if not rec or hari <= 0:
        return out
    off = int(os.environ.get("DEADLINE_TZ_MIN", TZ_DEFAULT))
    batas = local(rec["ts"], off).date() + timedelta(days=hari)
    sisa = (batas - local(now, off).date()).days
    out["batas_tanggal"] = batas.isoformat()
    out["sisa_hari"] = sisa
    out["terlambat"] = sisa < 0 and task.get("status") != "selesai"
    return out
