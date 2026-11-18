"""Aturan tugas petugas yang "simple" (saat ini: Driver Tujuan).

Driver Tujuan nggak dijejelin banyak foto: terima mobil = 1 jepret (foto + checkpoint "Unit diterima"),
lalu maksimal 2 checkpoint per hari jam 08.00-16.00 supaya titik di peta akurat. Batas hari (mis. Makassar-Manado
4 hari) dihitung sejak mobil diterima. Modul ini murni (tanpa DB) supaya gampang dites.
"""
import os
from datetime import datetime, timedelta, timezone

JENIS_TERIMA = "Unit diterima"
JENIS_HARIAN = "Dalam perjalanan"
CP_JAM_MULAI = 8
CP_JAM_AKHIR = 16                      # sampai 15:59 (jam < 16)
CP_MAKS_HARIAN = 2                     # maksimal checkpoint harian per hari (tanggal lokal HP driver)
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
        hari_ini = sum(1 for c in cps if c.get("jenis") == JENIS_HARIAN and c.get("ts") and local(c["ts"], offset_min).date() == lt.date())
        if hari_ini >= CP_MAKS_HARIAN:
            return 409, f"Checkpoint hari ini sudah terkirim {CP_MAKS_HARIAN}x. Lanjut besok jam {CP_JAM_MULAI:02d}.00."
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


def leg_for(legs, task):
    """Leg milik tugas ini (cocok route_leg_id, kalau tidak ada: leg_index)."""
    legs = legs or []
    rid = task.get("route_leg_id")
    if rid:
        for l in legs:
            if l.get("route_leg_id") == rid:
                return l
    i = task.get("leg_index")
    if isinstance(i, int) and 0 <= i < len(legs):
        return legs[i]
    return None


def nama_rombongan(leg, maks=3):
    """Leg rombongan (multi-unit): nama driver anggota di daftar `drivers` (unik, maks 3, sisanya '+N').
    `kepala_rombongan` sengaja TIDAK dipakai: di layar admin blok itu berlabel SUPPLIER, bukan driver."""
    nama = []
    for d in (leg.get("drivers") or []):
        n = " ".join(str((d or {}).get("driver") or "").split()) if isinstance(d, dict) else ""
        if n and n.upper() not in [x.upper() for x in nama]:
            nama.append(n)
    if not nama:
        return ""
    sisa = len(nama) - maks
    return ", ".join(nama[:maks]) + (f" +{sisa}" if sisa > 0 else "")


def nama_petugas(legs, task, nama_driver_trip=""):
    """Nama petugas/driver yang DITAMPILKAN di halaman link tugas.
    Diambil LANGSUNG dari leg di trip (yang dipilih admin di input leg), jadi nama yang diisi/diganti setelah link
    dibuat tetap ikut. Peran kapal -> koordinator kapal; peran lain -> driver (lalu petugas leg). Cadangan: nama yang
    tersimpan di tugas saat link dibuat, lalu nama driver di trip (khusus peran driver)."""
    tipe = str(task.get("tipe_tugas") or "")
    l = leg_for(legs, task) or {}
    kapal = tipe == "kapal"
    driver = tipe.startswith("driver")
    live = (l.get("kord_kapal") if kapal else l.get("driver")) or l.get("petugas_nama") or ""
    if not live and driver:
        live = nama_rombongan(l)       # leg rombongan: nama ada di daftar driver anggota, bukan kolom 'driver'
    for n in (live, task.get("petugas_nama"), (nama_driver_trip if driver else "")):
        n = " ".join(str(n or "").split())
        if n:
            return n
    return ""


def leg_selesai(legs, task):
    """True kalau admin sudah memilih status leg = Selesai -> semua link tugas leg itu ditutup."""
    l = leg_for(legs, task)
    return bool(l) and str(l.get("status") or "").strip().lower() == "selesai"


def pilih_sebelumnya(kandidat, route_leg_id, leg_index):
    """Dari daftar tugas lama (terbaru dulu) di trip + peran yang sama: ambil yang untuk leg ini
    dan sudah punya isi (foto / checkpoint / dokumen). None kalau tidak ada."""
    for t in kandidat or []:
        cocok = (route_leg_id and t.get("route_leg_id") == route_leg_id) or (not t.get("route_leg_id") and t.get("leg_index") == leg_index)
        if cocok and (t.get("photos") or t.get("checkpoints") or t.get("documents")):
            return t
    return None


def warisi_riwayat(doc, prev):
    """Link tugas BARU untuk leg yang sama (mis. link lama hilang / dibuat ulang) tidak boleh mulai dari nol:
    foto, checkpoint, dokumen, dan input tambahan dari tugas sebelumnya ikut dibawa, supaya driver
    yang sedang di jalan tinggal melanjutkan (tidak diminta foto asal lagi). Mengembalikan doc baru."""
    if not prev:
        return doc
    out = dict(doc)
    for k in ("photos", "documents", "checkpoints"):
        out[k] = list(prev.get(k) or [])
    out["extra_inputs"] = dict(prev.get("extra_inputs") or {})
    out["status"] = "dikerjakan"
    out["diwarisi_dari"] = prev.get("token")
    return out
