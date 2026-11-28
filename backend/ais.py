"""
AIS ship-position module (modular, provider-agnostic).

Tujuan: menyediakan posisi kapal untuk Fleet/Live Track TANPA mengunci ke satu
provider. Tahap ini memakai aisstream.io (gratis, resmi, websocket). Provider
lain (berbayar) bisa ditambah nanti tanpa membongkar Fleet — cukup mengisi
cache `ais_positions` dengan bentuk data yang sama.

KEAMANAN:
- API key HANYA dibaca dari env backend (AISSTREAM_API_KEY). Tidak pernah
  dikirim ke frontend / response / log. Modul ini tidak pernah mengembalikan key.
- Data yang diekspos hanya posisi AIS kapal (informasi publik), di-scope per-trip
  oleh pemanggil (server.py) — modul ini tidak menyediakan query MMSI bebas ke publik.

Data model (cache `ais_positions`, 1 dokumen per kapal, key = mmsi):
  mmsi, imo, ship_name, latitude, longitude, speed, course, heading,
  destination, eta, position_timestamp, source, updated_at
"""
import os
import re
import json
import asyncio
import logging
import ais_audit
from datetime import datetime, timezone

logger = logging.getLogger("ais")

AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream"
# Bounding box perairan Indonesia (SW, NE) — [[lat,lon],[lat,lon]]
INDONESIA_BBOX = [[[-11.5, 94.0], [7.5, 141.5]]]

# Ambang staleness (detik): <=1 jam Fresh, 1-6 jam Recent, >6 jam Stale
FRESH_MAX = 3600
RECENT_MAX = 6 * 3600

_worker_task = None

# ── Provider tambahan (berbayar, opsional): VesselAPI (REST) ──────────────
# Modular: kalau VESSEL_API_KEY diisi, posisi diambil on-demand via REST saat
# halaman tracking dibuka & cache sudah basi. Hemat kuota (tidak polling 24 jam).
# Terrestrial default; satelit hanya kalau VESSELAPI_USE_SAT=true + ada kredit.
VESSELAPI_URL = "https://api.vesselapi.com/v1"
# Umur maksimum posisi cache (menit) sebelum coba refresh dari VesselAPI:
VESSELAPI_MAX_AGE_MIN = int(os.environ.get("VESSELAPI_MAX_AGE_MIN") or "45")
# Satelit: seberapa lama fix satelit boleh diterima (menit, 60-4800). Tersedia di
# semua paket termasuk Free. Default 480 (8 jam) -> lebih banyak dapat posisi
# untuk kapal offshore. (satMaxAgeMinutes TIDAK dipakai: khusus paket berbayar.)
VESSELAPI_SAT_LOOKBACK = int(os.environ.get("VESSELAPI_SAT_LOOKBACK") or "480")
# Jadwal cek OTOMATIS (hemat kuota): jam lokal dipisah koma. Default "8,10,12,14,16" =
# 5x sehari, jam kerja, jeda 2 jam. Kosong / "always" = perilaku lama (tiap putaran).
AIS_TZ_OFFSET_MIN = int(os.environ.get("AIS_TZ_OFFSET_MIN") or "420")   # WIB = UTC+7


def refresh_hours():
    """Set jam jadwal cek otomatis, atau None = 24 JAM (tanpa jendela jam; interval diatur per prioritas & anggaran kuota).
    Env AIS_REFRESH_HOURS="8,10,12" masih bisa dipakai untuk membatasi ke jam tertentu."""
    raw = os.environ.get("AIS_REFRESH_HOURS")
    raw = "" if raw is None else raw.strip().lower()
    if raw in ("", "always", "semua"):
        return None
    hrs = set()
    for x in raw.split(","):
        x = x.strip()
        if x.isdigit() and 0 <= int(x) <= 23:
            hrs.add(int(x))
    return hrs or None


def current_slot(now_utc):
    """Slot jadwal saat ini ("YYYY-MM-DD@HH" jam lokal) atau None kalau di luar jadwal.
    Tanpa jadwal -> "always" (tiap putaran boleh)."""
    hrs = refresh_hours()
    if hrs is None:
        return "always"
    from datetime import timedelta
    lt = now_utc + timedelta(minutes=AIS_TZ_OFFSET_MIN)
    return f"{lt.date().isoformat()}@{lt.hour:02d}" if lt.hour in hrs else None


def customer_refresh_enabled():
    """Pelanggan yang membuka halaman tracking BOLEH memicu panggilan berbayar? Default: tidak
    (halaman tracking cuma baca cache; yang menyegarkan cache = jadwal otomatis)."""
    return (os.environ.get("AIS_CUSTOMER_REFRESH") or "off").strip().lower() in ("1", "true", "yes", "on")


# Jeda minimum antar-panggil VesselAPI untuk 1 kapal (detik) — cegah boros kuota:
WARM_MAX_AGE_MIN = int(os.environ.get("AIS_WARM_MAX_AGE_MIN") or "360")   # simpan leg: ambil posisi hanya kalau cache kosong / lebih tua dari ini
_MIN_FETCH_INTERVAL = 300
_ETA_FETCH_INTERVAL = 3600
_last_pos_fetch = {}
_last_eta_fetch = {}

# Status navigasi AIS (kode -> teks Indonesia)
NAV_STATUS = {
    0: "Berlayar (mesin)", 1: "Lego jangkar", 2: "Tidak terkendali",
    3: "Olah gerak terbatas", 4: "Terbatas draft", 5: "Sandar",
    6: "Kandas", 7: "Menangkap ikan", 8: "Berlayar (layar)",
    9: "Kapal khusus (HSC)", 10: "Kapal khusus (WIG)",
    11: "Menarik (di belakang)", 12: "Mendorong/menggandeng",
    14: "AIS-SART/darurat", 15: "Tidak ada info",
}


def nav_status_text(code):
    if code is None:
        return ""
    try:
        return NAV_STATUS.get(int(code), "")
    except Exception:
        return ""


def api_key() -> str:
    """API key aisstream — HANYA dari env backend. Jangan pernah diekspos."""
    return (os.environ.get("AISSTREAM_API_KEY") or "").strip()


def provider_enabled() -> bool:
    return bool(api_key())


def vesselapi_key() -> str:
    """API key VesselAPI — HANYA dari env backend. Jangan pernah diekspos."""
    return (os.environ.get("VESSEL_API_KEY") or "").strip()


def vesselapi_enabled() -> bool:
    return bool(vesselapi_key())


def any_provider_enabled() -> bool:
    return provider_enabled() or vesselapi_enabled() or vesselfinder_enabled()


def _vesselapi_use_sat() -> bool:
    return (os.environ.get("VESSELAPI_USE_SAT") or "").strip().lower() in ("1", "true", "yes", "on")


# ── Provider tambahan (berbayar, opsional): VesselFinder API ──────────────
# Sumber data SAMA dengan vesselfinder.com. On-demand saat cache kosong/basi &
# provider lain belum dapat. Terrestrial default (sat=0 → 1 kredit, cocok untuk
# kapal sandar/pesisir); sat=1 opsional (10 kredit) via VESSELFINDER_USE_SAT.
# Dormant total kalau VESSELFINDER_API_KEY belum diset.
VESSELFINDER_URL = "https://api.vesselfinder.com"


def vesselfinder_key() -> str:
    """API key (userkey) VesselFinder — HANYA dari env backend. Jangan diekspos."""
    return (os.environ.get("VESSELFINDER_API_KEY") or "").strip()


def vesselfinder_enabled() -> bool:
    return bool(vesselfinder_key())


def _vesselfinder_use_sat() -> bool:
    return (os.environ.get("VESSELFINDER_USE_SAT") or "").strip().lower() in ("1", "true", "yes", "on")


def _vesselfinder_get(params, timeout=15):
    """HTTP GET ke VesselFinder /vessels (blocking; via asyncio.to_thread).
    userkey disuntik dari env — jangan pernah diterima dari parameter publik."""
    import requests
    p = dict(params or {})
    p["userkey"] = vesselfinder_key()
    p.setdefault("format", "json")
    return requests.get(f"{VESSELFINDER_URL}/vessels", params=p, timeout=timeout)


def _vf_ts(s):
    """Normalisasi TIMESTAMP VesselFinder ('YYYY-MM-DD HH:MM:SS UTC') -> ISO."""
    if not s:
        return None
    t = str(s).strip()
    if t.upper().endswith(" UTC"):
        t = t[:-4].strip()
    t = t.replace(" ", "T", 1)
    parsed = _parse_ts(t)
    return parsed.isoformat() if parsed else None


# Kuota bulanan VesselAPI habis (HTTP 429): hentikan SEMUA panggilan selama jeda ini, jangan terus mencoba
# (tiap percobaan yang ditolak tetap memakan waktu & log, dan kuota baru yang pulih langsung habis lagi).
KUOTA_JEDA_MENIT = int(os.environ.get("VESSELAPI_QUOTA_PAUSE_MIN") or "360")
_kuota_blok_sampai = 0.0      # waktu time.monotonic() sampai kapan panggilan dihentikan


class _KuotaHabis:
    """Pengganti respons saat panggilan ditahan (tidak menyentuh jaringan)."""
    status_code = 429
    headers = {}
    text = "API monthly quota exceeded (ditahan oleh aplikasi)"

    def json(self):
        return {"error": {"type": "rate_limit_error", "message": "API monthly quota exceeded", "code": "rate_limit_exceeded"}}


def kuota_reset():
    """Buka tahanan kuota (dipakai tes manual admin supaya benar-benar menyentuh VesselAPI, mis. setelah paket dinaikkan)."""
    global _kuota_blok_sampai
    _kuota_blok_sampai = 0.0


def kuota_sisa_menit():
    """Berapa menit lagi panggilan VesselAPI ditahan karena kuota habis (0 = jalan normal)."""
    import time as _t
    return max(0, int((_kuota_blok_sampai - _t.monotonic()) / 60) + (1 if _kuota_blok_sampai > _t.monotonic() else 0))


def _vesselapi_get(path, params, timeout=15):
    """HTTP GET ke VesselAPI (blocking; dipanggil via asyncio.to_thread).
    timeout: (connect, read) — query satelit bisa lambat, jadi proses latar
    belakang (warm) boleh kasih read timeout lebih panjang.
    Kalau kuota bulanan habis (429), panggilan berikutnya ditahan KUOTA_JEDA_MENIT menit."""
    global _kuota_blok_sampai
    import time as _t
    import requests
    if _kuota_blok_sampai > _t.monotonic():
        return _KuotaHabis()
    headers = {"Authorization": f"Bearer {vesselapi_key()}"}
    r = requests.get(f"{VESSELAPI_URL}{path}", params=params, headers=headers, timeout=timeout)
    if r.status_code == 429:
        try:
            msg = str(r.json())
        except Exception:
            msg = r.text or ""
        if "quota" in msg.lower():
            _kuota_blok_sampai = _t.monotonic() + KUOTA_JEDA_MENIT * 60
            logger.warning("[ais] VesselAPI: kuota bulanan habis — panggilan ditahan %s menit.", KUOTA_JEDA_MENIT)
    return r


def _pluck(js, need_key):
    """Cari objek data di dalam respons VesselAPI, apa pun bentuk envelope-nya.
    VesselAPI membungkus, mis. {"vesselPosition": {...}} / {"vesselEta": {...}}.
    1) kalau field ada di top-level -> pakai itu; 2) cek pembungkus yang dikenal;
    3) fallback: pindai semua nilai dict 1 level, ambil yang punya need_key."""
    if not isinstance(js, dict):
        return None
    if js.get(need_key) is not None:
        return js
    for k in ("vesselPosition", "vesselEta", "vesselInfo", "data", "position",
              "eta", "result", "vessel"):
        v = js.get(k)
        if isinstance(v, dict) and v.get(need_key) is not None:
            return v
    for v in js.values():  # fallback generik: pembungkus apa pun namanya
        if isinstance(v, dict) and v.get(need_key) is not None:
            return v
    return None


def _num(v):
    if v is None:
        return None
    try:
        return float(v)
    except Exception:
        return None


def _parse_ts(s):
    if not s:
        return None
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return t
    except Exception:
        return None


def staleness(position_timestamp):
    """Hitung umur posisi + kategori kesegaran. TIDAK pernah menyebut LIVE
    kalau bukan fresh."""
    t = _parse_ts(position_timestamp)
    if not t:
        return {"age_seconds": None, "freshness": "unknown"}
    age = (datetime.now(timezone.utc) - t).total_seconds()
    if age < 0:
        age = 0
    if age <= FRESH_MAX:
        f = "fresh"
    elif age <= RECENT_MAX:
        f = "recent"
    else:
        f = "stale"
    return {"age_seconds": int(age), "freshness": f}


def public_ais(doc):
    """Normalisasi dokumen cache -> data model publik + info staleness.
    Return None kalau belum ada data posisi."""
    if not doc or doc.get("latitude") is None or doc.get("longitude") is None:
        return None
    ts = doc.get("position_timestamp") or (None if doc.get("ts_unverified") else doc.get("updated_at"))
    st = staleness(ts)
    return {
        "ship_name": doc.get("ship_name") or "",
        "imo": doc.get("imo") or "",
        "mmsi": doc.get("mmsi") or "",
        "latitude": doc.get("latitude"),
        "longitude": doc.get("longitude"),
        "speed": doc.get("speed"),
        "course": doc.get("course"),
        "heading": doc.get("heading"),
        "destination": doc.get("destination") or "",
        "eta": doc.get("eta") or "",
        "draught": doc.get("draught"),
        "nav_status": doc.get("nav_status"),
        "nav_status_text": _nav_display(doc.get("nav_status"), doc.get("speed")),
        "berthed_at": doc.get("berthed_at") or "",
        "position_timestamp": ts,
        "source": doc.get("source") or "",
        "age_seconds": st["age_seconds"],
        "freshness": st["freshness"],
        # Hanya posisi FRESH yang boleh disebut live; selainnya = posisi terakhir yang terdeteksi.
        "is_live": st["freshness"] == "fresh",
        "position_label": "Live" if st["freshness"] == "fresh" else "Posisi Terakhir Terdeteksi",
        "last_checked_at": doc.get("last_checked_at") or "",
    }


def _doc_age_seconds(doc):
    if not doc:
        return None
    st = staleness(doc.get("position_timestamp") or (None if doc.get("ts_unverified") else doc.get("updated_at")))
    return st["age_seconds"]


# Kode status navigasi AIS: 5 = Sandar (moored di dermaga), 0/8 = Berlayar.
_NAV_MOORED = 5
_NAV_UNDERWAY = {0, 8}
# Ambang kecepatan (knot): kapal JELAS berlayar kalau >= _SAILING_SPEED, dan
# dianggap benar-benar diam (boleh dihitung sandar) kalau <= _MOORED_MAX_SPEED.
# Kru kapal sering lupa update nav_status AIS, jadi kecepatan lebih dipercaya.
_SAILING_SPEED = 3.0
_MOORED_MAX_SPEED = 1.0


def _nav_int(v):
    try:
        return int(v) if v is not None else None
    except Exception:
        return None


def _nav_display(nav_status, speed):
    """Teks status navigasi yang 'nalar': kecepatan mengalahkan nav_status AIS.
    Kapal ngebut (>= _SAILING_SPEED knot) -> 'Berlayar' walau AIS masih bilang
    'Sandar' (data nav sering basi / tak di-update kru)."""
    sp = _num(speed)
    if sp is not None and sp >= _SAILING_SPEED:
        return nav_status_text(0)  # "Berlayar (mesin)"
    return nav_status_text(nav_status)


async def _apply_berth_state(db, doc):
    """Deteksi SANDAR otomatis dari status navigasi AIS — tanpa input manual.
    Alur akurat (mengikuti jaringan AIS):
      1. Kapal berlayar (nav_status 0/8) -> tandai `sailing`, hapus catatan
         sandar lama (siap mencatat kedatangan berikutnya).
      2. Kapal Sandar (nav_status 5) SETELAH sempat berlayar -> catat
         `berthed_at` = waktu posisi (= tanggal kapal tiba & sandar).
    Dengan syarat 'harus sempat berlayar dulu', sandar di pelabuhan asal
    (sebelum berangkat) tidak salah dihitung sebagai tiba. Return dokumen
    (mungkin sudah diperbarui)."""
    if not doc:
        return doc
    mmsi = str(doc.get("mmsi") or "").strip()
    if not mmsi:
        return doc
    ns = _nav_int(doc.get("nav_status"))
    sp = _num(doc.get("speed"))
    if ns is None and sp is None:
        return doc
    # Kecepatan mengalahkan nav_status (kru sering lupa update AIS):
    moving = sp is not None and sp >= _SAILING_SPEED
    slow = sp is None or sp <= _MOORED_MAX_SPEED
    underway = (ns in _NAV_UNDERWAY) or moving
    moored = (ns == _NAV_MOORED) and slow  # sandar hanya kalau nav=5 DAN memang diam
    sailing = bool(doc.get("sailing"))
    has_berth = bool(doc.get("berthed_at"))
    set_upd, unset_upd = {}, {}
    if underway:
        if not sailing:
            set_upd["sailing"] = True
        if has_berth:
            unset_upd["berthed_at"] = ""
    elif moored:
        if sailing and not has_berth:
            when = (doc.get("position_timestamp") or doc.get("updated_at")
                    or datetime.now(timezone.utc).isoformat())
            set_upd["berthed_at"] = when
            set_upd["sailing"] = False
    if not set_upd and not unset_upd:
        return doc
    ops = {}
    if set_upd:
        ops["$set"] = set_upd
    if unset_upd:
        ops["$unset"] = unset_upd
    try:
        await db.ais_positions.update_one({"mmsi": mmsi}, ops)
        for k, v in set_upd.items():
            doc[k] = v
        for k in unset_upd:
            doc.pop(k, None)
    except Exception as e:
        logger.warning("[ais] berth-state gagal: %s", e)
    return doc


_last_exist_check = {}      # ident -> monotonic; cek "kapal dikenal?" paling sering sekali per 6 jam (hemat kuota)
_EXIST_INTERVAL = 6 * 3600


async def _bedakan_404(db, ident, idtype, timeout=15):
    """Posisi 404: bedakan KAPAL TIDAK DITEMUKAN (IMO/MMSI salah) vs SINYAL AIS TIDAK ADA (kapal dikenal, tapi tak ada posisi).
    Satu panggilan detail kapal (/vessel/{id}); hasil tak meyakinkan -> 'no_position' (jujur: tidak diklaim salah satunya)."""
    import time as _t
    now_m = _t.monotonic()
    last = _last_exist_check.get(ident)
    prev = await ais_audit.get_status(db, ident)
    if last is not None and now_m - last < _EXIST_INTERVAL and prev and prev.get("state") in ("not_found", "no_signal"):
        return prev["state"]
    _last_exist_check[ident] = now_m
    try:
        r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}", {"filter.idType": idtype}, timeout)
    except Exception as e:
        await ais_audit.log_call(db, ident, "/vessel", ais_audit.classify_http(exc=e))
        return "no_position"
    if isinstance(r, _KuotaHabis):
        return "no_position"
    await ais_audit.log_call(db, ident, "/vessel", ais_audit.classify_http(r.status_code), r.status_code, getattr(r, "headers", None))
    if r.status_code == 200:
        return "no_signal"
    if r.status_code == 404:
        return "not_found"
    return "no_position"


async def _vesselapi_refresh(db, mmsi, imo, timeout=15, manual=False):
    """Ambil posisi (+ETA) 1 kapal dari VesselAPI dan simpan ke cache.
    On-demand + throttle supaya kuota hemat. Return dokumen cache terbaru / None.
    Aman kalau key kosong (langsung None).
    timeout: read timeout VesselAPI; proses latar belakang (warm) kasih lebih
    panjang karena query satelit lambat, render halaman tetap pakai default."""
    if not vesselapi_enabled():
        return None
    ident = (mmsi or imo or "").strip()
    if not ident:
        return None
    idtype = "mmsi" if mmsi else "imo"
    import time as _t
    now_m = _t.monotonic()
    _lp = _last_pos_fetch.get(ident)
    if _lp is not None and now_m - _lp < _MIN_FETCH_INTERVAL:
        return None  # baru saja diambil — jangan boros kuota
    _last_pos_fetch[ident] = now_m

    # Daftar percobaan query. Kalau mode satelit nyala, coba SATELIT dulu; kalau
    # balik kosong/404/error (mis. kapal lagi SANDAR di pelabuhan — posisinya cuma
    # ada di jaringan AIS DARAT/terestrial, bukan satelit), FALLBACK ke query
    # terestrial (tanpa filter.sat) — persis sumber yang bikin situs AIS publik
    # tetap dapet posisi kapal sandar/dekat pantai. Kalau mode satelit mati,
    # langsung query terestrial seperti perilaku lama.
    base = {"filter.idType": idtype}
    attempts = []
    if _vesselapi_use_sat():
        sat = dict(base)
        sat["filter.sat"] = "true"
        sat["filter.satLookbackMinutes"] = str(VESSELAPI_SAT_LOOKBACK)  # aman di Free
        # NB: filter.satMaxAgeMinutes sengaja TIDAK dikirim (khusus paket berbayar;
        # di Free bikin 403). Default server (60 mnt) tetap berlaku.
        attempts.append(("satelit", sat))
        attempts.append(("terestrial", dict(base)))   # fallback saat satelit kosong
    else:
        attempts.append(("terestrial", dict(base)))

    r = None
    pos = None
    why = "no_position"          # alasan terakhir kalau tak ada posisi (untuk log audit)
    http = None
    saw_404 = False
    for label, params in attempts:
        try:
            r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/position", params, timeout)
        except Exception as e:
            logger.warning("[ais] VesselAPI position (%s) gagal utk %s: %s", label, ident, e)
            why = ais_audit.classify_http(exc=e)
            await ais_audit.log_call(db, ident, "/position", why)
            continue
        http = getattr(r, "status_code", None)
        cls = ais_audit.classify_http(http)
        if not isinstance(r, _KuotaHabis):          # panggilan yang ditahan aplikasi TIDAK memakai kuota provider
            await ais_audit.log_call(db, ident, "/position", cls, http, getattr(r, "headers", None))
        if isinstance(r, _KuotaHabis) or http == 429:
            why = "quota"
            continue
        if http == 404:
            logger.info("[ais] VesselAPI (%s): belum ada posisi untuk %s (404).", label, ident)
            why = "no_position"
            saw_404 = True
            continue
        if http != 200:
            logger.warning("[ais] VesselAPI position (%s) HTTP %s utk %s.", label, http, ident)
            why = cls            # auth | api_error
            continue
        try:
            cand = _pluck(r.json(), "latitude")
        except Exception:
            cand = None
        if cand and cand.get("latitude") is not None and cand.get("longitude") is not None:
            pos = cand
            break   # dapet posisi (dari satelit ATAU terestrial) — pakai ini
        why = "no_position"
    if not pos or pos.get("latitude") is None or pos.get("longitude") is None:
        state = why
        if why == "no_position" and saw_404:
            state = await _bedakan_404(db, ident, idtype, timeout)     # not_found | no_signal | no_position
        await ais_audit.log_attempt(db, ident, why, http=http, provider="vesselapi", manual=manual)
        await ais_audit.set_status(db, ident, state, http=http)
        return None

    now = datetime.now(timezone.utc).isoformat()
    src = "vesselapi-satellite" if (r.headers.get("X-Data-Source") == "satellite") else "vesselapi"
    key_mmsi = str(pos.get("mmsi") or mmsi or "").strip()
    if not key_mmsi:
        return None
    upd = {"mmsi": key_mmsi, "source": src, "updated_at": now,
           "latitude": _num(pos.get("latitude")), "longitude": _num(pos.get("longitude"))}
    if pos.get("imo"):
        upd["imo"] = str(pos.get("imo"))
    if pos.get("vessel_name"):
        upd["ship_name"] = str(pos.get("vessel_name")).strip()
    if _num(pos.get("sog")) is not None:
        upd["speed"] = _num(pos.get("sog"))
    if _num(pos.get("cog")) is not None:
        upd["course"] = _num(pos.get("cog"))
    _hd = _num(pos.get("heading"))
    if _hd is not None and 0 <= _hd < 360:   # 511 = "tidak tersedia" di AIS — jangan disimpan sbg arah
        upd["heading"] = _hd
    if pos.get("nav_status") is not None:
        try:
            upd["nav_status"] = int(pos.get("nav_status"))
        except Exception:
            pass
    # Waktu posisi HARUS dari provider. Tanpa timestamp, posisi ditolak (jangan dianggap "sekarang" —
    # itu membuat posisi lama tampak segar). Posisi yang lebih tua/sama dari cache juga tidak menimpa.
    prov_ts = pos.get("timestamp")
    prov_dt = _parse_ts(prov_ts)
    if not prov_dt:
        # Provider tak menyertakan waktu: posisi tetap disimpan tapi ditandai TIDAK TERVERIFIKASI
        # (kesegaran "unknown" -> tidak pernah disebut live, bukan dianggap "baru saja").
        upd["position_timestamp"] = None
        upd["ts_unverified"] = True
        upd["last_checked_at"] = now
        try:
            await db.ais_positions.update_one({"mmsi": key_mmsi}, {"$set": upd}, upsert=True)
            await ais_audit.log_attempt(db, ident, "no_timestamp", http=http, provider="vesselapi", manual=manual, source=src)
            await ais_audit.set_status(db, ident, "ok", http=http)
            return await db.ais_positions.find_one({"mmsi": key_mmsi}, {"_id": 0})
        except Exception as e:
            logger.warning("[ais] VesselAPI upsert gagal: %s", e)
            return None
    try:
        cur = await db.ais_positions.find_one({"mmsi": key_mmsi}, {"_id": 0, "position_timestamp": 1, "latitude": 1})
    except Exception:
        cur = None
    cur_dt = _parse_ts(cur.get("position_timestamp")) if cur and cur.get("latitude") is not None else None
    if cur_dt and prov_dt <= cur_dt:
        outcome = "same" if prov_dt == cur_dt else "older"
        try:
            await db.ais_positions.update_one({"mmsi": key_mmsi}, {"$set": {"last_checked_at": now}})
            cur = await db.ais_positions.find_one({"mmsi": key_mmsi}, {"_id": 0})
        except Exception:
            pass
        await ais_audit.log_attempt(db, ident, outcome, http=http, provider="vesselapi", manual=manual,
                                    provider_ts=str(prov_ts), cache_ts=str(cur.get("position_timestamp")) if cur else None)
        await ais_audit.set_status(db, ident, "ok", http=http)
        return cur
    upd["position_timestamp"] = str(prov_ts)
    upd["ts_unverified"] = False
    upd["last_checked_at"] = now

    # ETA/tujuan/draught — endpoint terpisah, throttle lebih longgar (jarang berubah)
    _le = _last_eta_fetch.get(ident)
    if _le is None or now_m - _le >= _ETA_FETCH_INTERVAL:
        _last_eta_fetch[ident] = now_m
        try:
            re = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/eta", {"filter.idType": idtype}, timeout)
            if not isinstance(re, _KuotaHabis):
                await ais_audit.log_call(db, ident, "/eta", ais_audit.classify_http(re.status_code), re.status_code, getattr(re, "headers", None))
            if re.status_code == 200:
                eta = _pluck(re.json(), "destination") or _pluck(re.json(), "eta") or {}
                if isinstance(eta, dict):
                    dest = (eta.get("destination") or "").strip() if eta.get("destination") else ""
                    if dest:
                        upd["destination"] = dest
                    ev = eta.get("eta")
                    if ev:
                        upd["eta"] = str(ev)
                    dr = _num(eta.get("draught"))
                    if dr is not None:
                        upd["draught"] = dr
        except Exception as e:
            logger.info("[ais] VesselAPI eta lewati: %s", e)

    try:
        await db.ais_positions.update_one({"mmsi": key_mmsi}, {"$set": upd}, upsert=True)
        await ais_audit.log_attempt(db, ident, "updated", http=http, provider="vesselapi", manual=manual,
                                    provider_ts=str(prov_ts), source=src)
        await ais_audit.set_status(db, ident, "ok", http=http)
        return await db.ais_positions.find_one({"mmsi": key_mmsi}, {"_id": 0})
    except Exception as e:
        logger.warning("[ais] VesselAPI upsert gagal: %s", e)
        return None


def _vf_pick(arr):
    """Ambil objek AIS dari respons VesselFinder /vessels (array of {AIS, ...})."""
    if isinstance(arr, dict):
        arr = arr.get("vessels") or arr.get("data") or [arr]
    rec = arr[0] if isinstance(arr, list) and arr else None
    if not isinstance(rec, dict):
        return None
    ais = rec.get("AIS")
    if isinstance(ais, dict):
        return ais
    return rec  # sebagian respons datar tanpa pembungkus 'AIS'


async def _vesselfinder_refresh(db, mmsi, imo, timeout=15):
    """Ambil posisi 1 kapal dari VesselFinder API (sumber sama dgn vesselfinder.com)
    dan simpan ke cache. On-demand + throttle (hemat kredit). Terrestrial default
    (sat=0, 1 kredit); sat=1 opsional (10 kredit) via VESSELFINDER_USE_SAT.
    Aman kalau key kosong (langsung None)."""
    if not vesselfinder_enabled():
        return None
    ident = (mmsi or imo or "").strip()
    if not ident:
        return None
    import time as _t
    now_m = _t.monotonic()
    tkey = "vf:" + ident
    _lp = _last_pos_fetch.get(tkey)
    if _lp is not None and now_m - _lp < _MIN_FETCH_INTERVAL:
        return None  # baru saja diambil — jangan boros kredit
    _last_pos_fetch[tkey] = now_m

    params = {"extradata": "voyage"}
    if mmsi:
        params["mmsi"] = str(mmsi)
    elif imo:
        params["imo"] = str(imo)
    if _vesselfinder_use_sat():
        params["sat"] = "1"
    try:
        r = await asyncio.to_thread(_vesselfinder_get, params, timeout)
    except Exception as e:
        logger.warning("[ais] VesselFinder gagal utk %s: %s", ident, e)
        return None
    if r.status_code != 200:
        logger.warning("[ais] VesselFinder HTTP %s utk %s.", r.status_code, ident)
        return None
    try:
        ais = _vf_pick(r.json())
    except Exception:
        ais = None
    if not isinstance(ais, dict):
        return None
    lat, lon = _num(ais.get("LATITUDE")), _num(ais.get("LONGITUDE"))
    if lat is None or lon is None:
        return None

    now = datetime.now(timezone.utc).isoformat()
    src = "vesselfinder-satellite" if str(ais.get("SRC") or "").upper().startswith("SAT") else "vesselfinder"
    key_mmsi = str(ais.get("MMSI") or mmsi or "").strip()
    if not key_mmsi:
        return None
    upd = {"mmsi": key_mmsi, "source": src, "updated_at": now, "latitude": lat, "longitude": lon}
    if ais.get("IMO"):
        upd["imo"] = str(ais.get("IMO"))
    nm = str(ais.get("NAME") or "").strip()
    if nm:
        upd["ship_name"] = nm
    if _num(ais.get("SPEED")) is not None:
        upd["speed"] = _num(ais.get("SPEED"))
    if _num(ais.get("COURSE")) is not None:
        upd["course"] = _num(ais.get("COURSE"))
    hd = _num(ais.get("HEADING"))
    if hd is not None and hd != 511:
        upd["heading"] = hd
    if ais.get("NAVSTAT") is not None:
        try:
            upd["nav_status"] = int(ais.get("NAVSTAT"))
        except Exception:
            pass
    dest = str(ais.get("DESTINATION") or "").strip()
    if dest:
        upd["destination"] = dest
    if ais.get("ETA"):
        upd["eta"] = str(ais.get("ETA"))
    dr = _num(ais.get("DRAUGHT"))
    if dr is not None:
        upd["draught"] = dr
    upd["position_timestamp"] = _vf_ts(ais.get("TIMESTAMP")) or now
    try:
        await db.ais_positions.update_one({"mmsi": key_mmsi}, {"$set": upd}, upsert=True)
        return await db.ais_positions.find_one({"mmsi": key_mmsi}, {"_id": 0})
    except Exception as e:
        logger.warning("[ais] VesselFinder upsert gagal: %s", e)
        return None


# Status leg: nilai kanonik "Menunggu"/"Berlangsung"/"Selesai" (default Menunggu).
_LEG_ACTIVE_RE = re.compile(r"berlangsung|berjalan|berangkat|sedang|on\s*trip|in\s*transit", re.I)
_LEG_DONE_RE = re.compile(r"selesai|tiba|delivered|done|complete|arrived", re.I)


def _leg_ship_id(lg):
    """(mmsi, imo) leg sebagai string ter-strip; ('','') kalau bukan/tak ada."""
    lg = lg or {}
    return (str(lg.get("mmsi") or "").strip(), str(lg.get("imo") or "").strip())


def _leg_is_ship(lg):
    """Leg kapal kalau tipe diawali 'Kapal' ATAU punya mmsi/imo."""
    lg = lg or {}
    mmsi, imo = _leg_ship_id(lg)
    if mmsi or imo:
        return True
    return str(lg.get("tipe") or "").strip().lower().startswith("kapal")


def _leg_status_kind(lg):
    st = str((lg or {}).get("status") or "").strip()
    if _LEG_DONE_RE.search(st):
        return "done"
    if _LEG_ACTIVE_RE.search(st):
        return "active"
    return "waiting"


def pick_active_ship_leg(legs):
    """Pilih leg KAPAL sesuai leg yang sedang AKTIF/Berlangsung — bukan sekadar
    kapal pertama. Generik (tanpa hardcode nama kapal):
      1. Kalau leg 'Berlangsung' itu sendiri leg kapal (ada mmsi/imo) -> pakai itu.
      2. Kalau leg aktif bukan kapal (mis. Self Drive) -> kapal terdekat BERIKUTNYA
         (leg kapal index >= aktif), else kapal terakhir SEBELUM leg aktif.
      3. Kalau tak ada leg 'Berlangsung' -> kapal pada leg 'Selesai' terakhir,
         else leg kapal pertama (kompatibel perilaku lama / 1 kapal per trip).
    Return leg dict terpilih, atau None kalau tak ada leg kapal ber-mmsi/imo."""
    legs = [lg or {} for lg in (legs or [])]
    ship_idx = [i for i, lg in enumerate(legs) if _leg_is_ship(lg) and any(_leg_ship_id(lg))]
    if not ship_idx:
        return None
    kinds = [_leg_status_kind(lg) for lg in legs]
    # Ambil leg 'Berlangsung' TERAKHIR (paling jauh progresnya) — tahan banting
    # kalau leg sebelumnya lupa ditandai 'Selesai' (mis. Leg2 & Leg3 dua-duanya
    # Berlangsung -> pakai Leg3 yang lebih current).
    active_i = next((i for i in range(len(kinds) - 1, -1, -1) if kinds[i] == "active"), None)
    if active_i is not None:
        if active_i in ship_idx:
            return legs[active_i]
        ahead = [i for i in ship_idx if i >= active_i]
        if ahead:
            return legs[min(ahead)]
        behind = [i for i in ship_idx if i < active_i]
        if behind:
            return legs[max(behind)]
    done_ship = [i for i in ship_idx if kinds[i] == "done"]
    if done_ship:
        return legs[max(done_ship)]
    return legs[ship_idx[0]]


async def manual_refresh(db, legs, admin=False):
    """Tombol "Perbarui posisi": benar-benar meminta data baru ke provider (bukan baca cache).
    Dibatasi cooldown persisten per kapal (AIS_MANUAL_COOLDOWN_MIN, default 30 mnt; admin 5 mnt) dan
    jeda kuota provider. Tidak pernah membuat/menggeser koordinat sendiri.
    Return {status, message, retry_after, ship_ais}; status: updated|unchanged|cooldown|quota|no_provider|no_ship|no_data."""
    lg = pick_active_ship_leg(legs)
    if not lg:
        return {"status": "no_ship", "message": "Trip ini belum punya kapal ber-MMSI/IMO.", "retry_after": 0}
    mmsi, imo = _leg_ship_id(lg)
    ident = mmsi or imo
    if not admin and _leg_status_kind(lg) == "done":
        return {"status": "selesai", "retry_after": 0,
                "message": "Pengiriman laut kapal ini sudah selesai; posisi tidak diperbarui lagi. Posisi terakhir tetap tersimpan."}
    if not (vesselapi_enabled() or vesselfinder_enabled()):
        return {"status": "no_provider", "message": "Provider AIS belum aktif.", "retry_after": 0}
    left = await ais_audit.cooldown_left_seconds(db, ident, minutes=(_MIN_FETCH_INTERVAL // 60) if admin else None)
    if left > 0:
        return {"status": "cooldown", "retry_after": left,
                "message": f"Posisi baru saja diminta. Coba lagi {max(1, (left + 59) // 60)} menit lagi."}
    if vesselapi_enabled() and kuota_sisa_menit() > 0 and not vesselfinder_enabled():
        return {"status": "quota", "retry_after": kuota_sisa_menit() * 60,
                "message": "Kuota provider AIS sedang habis; posisi terakhir tetap ditampilkan."}
    before = None
    try:
        before = await db.ais_positions.find_one({"mmsi": mmsi} if mmsi else {"imo": imo}, {"_id": 0})
    except Exception:
        pass
    b_ts = (before or {}).get("position_timestamp")
    _last_pos_fetch.pop(ident, None)
    # catat percobaan manual SEBELUM memanggil provider (cooldown berlaku walau provider error)
    await ais_audit.log_attempt(db, ident, "manual_request", manual=True)
    fresh = None
    try:
        if vesselapi_enabled():
            fresh = await _vesselapi_refresh(db, mmsi, imo, timeout=(5, 25), manual=True)
        if not fresh and vesselfinder_enabled():
            fresh = await _vesselfinder_refresh(db, mmsi, imo)
    except Exception as e:
        logger.warning("[ais] manual refresh %s gagal: %s", ident, e)
    doc = fresh or before
    doc = await _apply_berth_state(db, doc)
    out = {"ship_ais": public_ais(doc), "retry_after": ais_audit.MANUAL_COOLDOWN_MIN * 60}
    if fresh and fresh.get("position_timestamp") and fresh.get("position_timestamp") != b_ts:
        out.update(status="updated", message="Posisi terbaru dari provider diterima.")
    elif fresh:
        out.update(status="unchanged", message="Provider belum punya posisi yang lebih baru dari yang tampil.")
    else:
        out.update(status="quota" if kuota_sisa_menit() > 0 else "no_data",
                   message="Kuota provider habis." if kuota_sisa_menit() > 0 else "Provider belum mengirim posisi baru untuk kapal ini.")
    return out


def konfigurasi():
    """Konfigurasi AIS efektif (tanpa nilai rahasia) — buat audit Railway env vars."""
    return {
        "vesselapi_key_terisi": vesselapi_enabled(),
        "vesselapi_satelit": _vesselapi_use_sat(),
        "vesselapi_sat_lookback_menit": VESSELAPI_SAT_LOOKBACK,
        "vesselfinder_key_terisi": vesselfinder_enabled(),
        "aisstream_key_terisi": provider_enabled(),
        "auto_refresh_berjalan": auto_refresh_running(),
        "auto_refresh_aktif": _auto_refresh_enabled(),
        "jam_terbatas": sorted(refresh_hours()) if refresh_hours() else None,
        "interval_pembawa_kendaraan_menit": INTERVAL_CARRYING_MIN,
        "interval_kapal_berikutnya_menit": INTERVAL_UPCOMING_MIN,
        "anggaran_panggilan_bulan": budget_month() or None,
        "pelanggan_memicu_panggilan": customer_refresh_enabled(),
        "cooldown_tombol_menit": ais_audit.MANUAL_COOLDOWN_MIN,
        "kuota_ditahan_menit": kuota_sisa_menit(),
    }


async def kuota(db):
    """Monitoring pemakaian API: bulan/hari ini, berhasil vs gagal per kelas, sisa kuota (bila provider mengirim header)."""
    u = await ais_audit.usage(db)
    bm = budget_month()
    u["anggaran_bulan"] = bm or None
    u["sisa_anggaran"] = max(0, bm - u["bulan"]["total"]) if bm else None
    u["kuota_ditahan_menit"] = kuota_sisa_menit()
    return u


async def armada(db):
    """Admin: semua kapal yang dipantau — prioritas, identitas valid?, posisi/umur, status penyebab, percobaan terakhir; plus konfigurasi & kuota."""
    tg = await ship_targets(db)
    rows = []
    for ident, e in tg.items():
        doc = None
        try:
            doc = await db.ais_positions.find_one({"mmsi": e["mmsi"]} if e["mmsi"] else {"imo": e["imo"]}, {"_id": 0})
            if not doc and e["mmsi"] and e["imo"]:
                doc = await db.ais_positions.find_one({"imo": e["imo"]}, {"_id": 0})
        except Exception:
            pass
        pub = public_ais(doc)
        stt = await ais_audit.get_status(db, ident)
        rows.append({**e, "jumlah_trip": len(e["trips"]), "kapal": e["name"], "trips": e["trips"][:5],
                     "masalah_identitas": ais_audit.identity_issues(e["mmsi"], e["imo"]),
                     "nama_di_ais": (pub or {}).get("ship_name") or "",
                     "freshness": (pub or {}).get("freshness") or "none",
                     "age_seconds": (pub or {}).get("age_seconds"),
                     "position_timestamp": (pub or {}).get("position_timestamp"),
                     "status": (stt or {}).get("state") or "pending",
                     "status_pesan": ais_audit.PESAN.get((stt or {}).get("state") or "pending", ""),
                     "terakhir_diperiksa": (stt or {}).get("last_checked_at") or "",
                     "percobaan_terakhir": await ais_audit.last_attempts(db, ident, 3)})
    rows.sort(key=lambda r: (0 if r["prio"] == "carrying" else 1, -(r["age_seconds"] if r["age_seconds"] is not None else 10**9)))
    return {"kapal": rows, "kuota_habis_menit": kuota_sisa_menit(), "jadwal": jadwal_info(),
            "cooldown_manual_menit": ais_audit.MANUAL_COOLDOWN_MIN,
            "konfigurasi": konfigurasi(), "kuota": await kuota(db)}


async def uji_kapal(db, nama="", mmsi="", imo="", live=False):
    """Uji satu kapal (mis. FAJAR BAHARI II): identitas tersimpan di leg, validitas, cache, status & percobaan terakhir.
    live=True: ikut menembak provider SEKARANG (memakai kuota) lewat refresh manual dan mengembalikan hasil klasifikasinya."""
    out = {"nama": nama, "ditemukan_di_leg": []}
    nm = str(nama or "").strip().lower()
    if nm and not (mmsi or imo):
        try:
            async for t in db.trips.find({"legs": {"$exists": True}}, {"_id": 0, "trip_id": 1, "legs": 1}):
                for lg in (t.get("legs") or []):
                    if nm in str((lg or {}).get("kapal") or "").lower() and _leg_is_ship(lg):
                        m, i = _leg_ship_id(lg)
                        out["ditemukan_di_leg"].append({"trip_id": t.get("trip_id"), "kapal": lg.get("kapal"), "mmsi": m, "imo": i,
                                                        "status_leg": lg.get("status"), "prioritas": "carrying" if _leg_status_kind(lg) == "active" else ("done" if _leg_status_kind(lg) == "done" else "upcoming")})
        except Exception as e:
            out["error"] = str(e)
        uniq = {(x["mmsi"], x["imo"]) for x in out["ditemukan_di_leg"]}
        if len(uniq) == 1:
            mmsi, imo = next(iter(uniq))
        elif not uniq:
            out["kesimpulan"] = "Tidak ada leg kapal dengan nama itu di Route Leg."
            return out
        else:
            out["kesimpulan"] = "Nama kapal itu dipakai dengan beberapa pasang IMO/MMSI berbeda — samakan datanya."
            return out
    mmsi, imo = str(mmsi or "").strip(), str(imo or "").strip()
    ident = mmsi or imo
    out.update({"mmsi": mmsi, "imo": imo, "masalah_identitas": ais_audit.identity_issues(mmsi, imo),
                "konfigurasi": konfigurasi()})
    try:
        doc = await db.ais_positions.find_one({"mmsi": mmsi} if mmsi else {"imo": imo}, {"_id": 0})
        if not doc and mmsi and imo:
            doc = await db.ais_positions.find_one({"imo": imo}, {"_id": 0})
    except Exception:
        doc = None
    out["cache"] = public_ais(doc)
    out["status"] = await ais_audit.get_status(db, ident)
    out["percobaan_terakhir"] = await ais_audit.last_attempts(db, ident, 8)
    if live:
        legs = [{"tipe": "Kapal", "kapal": nama, "mmsi": mmsi, "imo": imo, "status": "Berlangsung"}]
        kuota_reset()
        out["refresh_live"] = await manual_refresh(db, legs, admin=True)
        out["status_setelah"] = await ais_audit.get_status(db, ident)
    st = (out.get("status_setelah") or out.get("status") or {}).get("state")
    out["kesimpulan"] = ais_audit.PESAN.get(st or "pending", "") or ("Posisi valid tersedia." if out["cache"] else "Belum pernah dicek.")
    return out


def jadwal_info():
    """Info jadwal pembaruan buat ditampilkan ke pelanggan (None kalau tanpa jadwal)."""
    hrs = refresh_hours()
    if not hrs:
        return None
    zona = {420: "WIB", 480: "WITA", 540: "WIT"}.get(AIS_TZ_OFFSET_MIN)
    if zona is None:
        h = AIS_TZ_OFFSET_MIN / 60
        zona = f"UTC{h:+g}"
    return {"jam": sorted(hrs), "zona": zona}


async def position_for_legs(db, legs):
    """Ambil identitas kapal dari leg AKTIF (mmsi/imo) + posisi AIS dari cache.
    Dipanggil oleh view per-trip supaya SELALU scoped ke trip pemiliknya
    (tidak ada query MMSI bebas dari publik). Kapal mengikuti leg yang sedang
    'Berlangsung' (multi-leg: bisa ganti kapal per leg). Return None kalau tidak
    ada leg kapal ber-mmsi/imo."""
    lg = pick_active_ship_leg(legs)
    if not lg:
        return None
    mmsi, imo = _leg_ship_id(lg)
    chosen = {"ship_name": str(lg.get("kapal") or "").strip(), "mmsi": mmsi, "imo": imo}
    doc = None
    try:
        if chosen["mmsi"]:
            doc = await db.ais_positions.find_one({"mmsi": chosen["mmsi"]}, {"_id": 0})
        if not doc and chosen["imo"]:
            doc = await db.ais_positions.find_one({"imo": chosen["imo"]}, {"_id": 0})
    except Exception as e:
        logger.warning("[ais] lookup gagal: %s", e)

    # On-demand refresh via VesselAPI kalau cache kosong / basi (hemat kuota via throttle).
    # Default MATI untuk pelanggan (AIS_CUSTOMER_REFRESH=off): halaman tracking cuma baca cache,
    # yang menyegarkan cache adalah jadwal otomatis, jadi jumlah pembuka halaman tidak menambah pemakaian kuota.
    if vesselapi_enabled() and customer_refresh_enabled():
        age = _doc_age_seconds(doc)
        if doc is None or age is None or age > VESSELAPI_MAX_AGE_MIN * 60:
            fresh = await _vesselapi_refresh(db, chosen["mmsi"], chosen["imo"])
            if fresh:
                doc = fresh

    # Fallback terakhir: VesselFinder API (sumber sama dgn vesselfinder.com) kalau
    # masih kosong/basi — paling ampuh utk kapal sandar/pesisir (terrestrial).
    # Dipanggil cuma kalau provider sebelumnya belum dapat → hemat kredit.
    if vesselfinder_enabled() and customer_refresh_enabled():
        age = _doc_age_seconds(doc)
        if doc is None or age is None or age > VESSELAPI_MAX_AGE_MIN * 60:
            fresh = await _vesselfinder_refresh(db, chosen["mmsi"], chosen["imo"])
            if fresh:
                doc = fresh

    # Deteksi sandar otomatis (nav_status) sebelum dikirim ke publik.
    doc = await _apply_berth_state(db, doc)

    stt = await ais_audit.get_status(db, chosen["mmsi"] or chosen["imo"])
    return {
        "ship_name": chosen["ship_name"],
        "mmsi": chosen["mmsi"],
        "imo": chosen["imo"],
        "provider_enabled": any_provider_enabled(),
        "ais": public_ais(doc),
        "status": ais_audit.status_publik(stt, any_provider_enabled()),   # sebab "belum ada data": api gagal / kuota / tidak ditemukan / tanpa sinyal
        "pemantauan": {"mode": "24 jam", "interval_menit": plan_intervals(1, 0)[0]},
        "jadwal": jadwal_info(),      # mis. {"jam": [8,10,12,14,16], "zona": "WIB"} -> catatan "diperbarui 5x sehari" di halaman tracking
    }


async def warm_ships(db, legs):
    """Begitu admin menyimpan leg dengan MMSI/IMO baru, langsung ambil posisi
    kapal dari VesselAPI (on-demand) supaya kapal LANGSUNG muncul di cache —
    tidak perlu nunggu worker aisstream refresh (max 60 dtk) atau pelanggan buka
    halaman tracking. Best-effort: aman kalau VesselAPI mati / belum ada posisi.
    Dipanggil non-blocking (asyncio.create_task) dari endpoint simpan legs."""
    if not vesselapi_enabled():
        return
    seen = set()
    for lg in (legs or []):
        if _leg_status_kind(lg or {}) == "done":      # pengiriman laut selesai: tidak menarik posisi lagi (hemat kuota)
            continue
        mmsi, imo = _leg_ship_id(lg or {})
        key = mmsi or imo
        if not key or key in seen:
            continue
        seen.add(key)
        try:     # hemat kuota: kapal yang posisinya sudah ada di cache (< WARM_MAX_AGE_MIN) tidak diambil lagi tiap simpan leg
            doc = None
            if mmsi:
                doc = await db.ais_positions.find_one({"mmsi": mmsi}, {"_id": 0})
            if not doc and imo:
                doc = await db.ais_positions.find_one({"imo": imo}, {"_id": 0})
            age = _doc_age_seconds(doc) if (doc and doc.get("latitude") is not None) else None
            if age is not None and age <= WARM_MAX_AGE_MIN * 60:
                continue
        except Exception:
            pass
        try:
            if not await ais_audit.get_status(db, key):
                await ais_audit.set_status(db, key, "pending")
        except Exception:
            pass
        try:
            # read timeout lebih panjang: warm jalan di latar belakang (tidak
            # memblok respons simpan leg), jadi query satelit yang lambat tetap
            # sempat selesai dan posisi masuk cache.
            await _vesselapi_refresh(db, mmsi, imo, timeout=(5, 40))
        except Exception as e:
            logger.warning("[ais] warm_ships gagal utk %s: %s", key, e)


async def active_mmsis(db):
    """Kumpulkan MMSI dari leg kapal semua trip (yang akan kita 'tonton')."""
    out = set()
    try:
        cur = db.trips.find({"legs.mmsi": {"$exists": True}}, {"legs.mmsi": 1})
        async for t in cur:
            for lg in (t.get("legs") or []):
                m = str((lg or {}).get("mmsi") or "").strip()
                if m:
                    out.add(m)
    except Exception as e:
        logger.warning("[ais] active_mmsis gagal: %s", e)
    return list(out)


def _fmt_eta(eta):
    """AIS ETA {Month,Day,Hour,Minute} -> 'DD-MM HH:MM' (tanpa tahun). Kosong = ''."""
    if not isinstance(eta, dict):
        return ""
    mo, d, h, mi = eta.get("Month"), eta.get("Day"), eta.get("Hour"), eta.get("Minute")
    if not mo and not d:
        return ""
    try:
        return f"{int(d):02d}-{int(mo):02d} {int(h):02d}:{int(mi):02d}"
    except Exception:
        return ""


def _meta_time(meta):
    """meta.time_utc (mis. '2021-05-27 15:20:24.653 +0000 UTC') -> ISO."""
    s = (meta or {}).get("time_utc")
    if not s:
        return None
    s = str(s).replace(" UTC", "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S.%f %z", "%Y-%m-%d %H:%M:%S %z"):
        try:
            return datetime.strptime(s, fmt).astimezone(timezone.utc).isoformat()
        except Exception:
            continue
    return None


async def _handle(db, msg, watch):
    mt = msg.get("MessageType")
    meta = msg.get("MetaData") or {}
    mmsi = str(meta.get("MMSI") or "").strip()
    if not mmsi or mmsi not in watch:
        return
    now = datetime.now(timezone.utc).isoformat()
    upd = {"mmsi": mmsi, "source": "aisstream", "updated_at": now}
    name = (meta.get("ShipName") or "").strip()
    if name:
        upd["ship_name"] = name
    inner = (msg.get("Message") or {})
    if mt == "PositionReport":
        pr = inner.get("PositionReport") or {}
        lat = meta.get("latitude")
        lon = meta.get("longitude")
        if lat is None:
            lat = pr.get("Latitude")
        if lon is None:
            lon = pr.get("Longitude")
        if lat is None or lon is None:
            return
        try:
            upd["latitude"] = float(lat)
            upd["longitude"] = float(lon)
        except Exception:
            return
        if pr.get("Sog") is not None:
            try: upd["speed"] = float(pr["Sog"])
            except Exception: pass
        if pr.get("Cog") is not None:
            try: upd["course"] = float(pr["Cog"])
            except Exception: pass
        th = pr.get("TrueHeading")
        if th is not None and th != 511:
            try: upd["heading"] = float(th)
            except Exception: pass
        ns = pr.get("NavigationalStatus")
        if ns is not None:
            try: upd["nav_status"] = int(ns)
            except Exception: pass
        upd["position_timestamp"] = _meta_time(meta) or now
    elif mt == "ShipStaticData":
        sd = inner.get("ShipStaticData") or {}
        imo = sd.get("ImoNumber")
        if imo:
            upd["imo"] = str(imo)
        dest = (sd.get("Destination") or "").strip()
        if dest:
            upd["destination"] = dest
        eta = _fmt_eta(sd.get("Eta"))
        if eta:
            upd["eta"] = eta
        dr = sd.get("MaximumStaticDraught")
        if dr is not None:
            try: upd["draught"] = float(dr)
            except Exception: pass
    else:
        return
    try:
        await db.ais_positions.update_one({"mmsi": mmsi}, {"$set": upd}, upsert=True)
    except Exception as e:
        logger.warning("[ais] upsert gagal: %s", e)


async def _run(db):
    """Worker latar belakang: connect ke aisstream, tonton MMSI armada, simpan
    posisi ke cache. Aman kalau key kosong (langsung berhenti)."""
    key = api_key()
    if not key:
        logger.info("[ais] AISSTREAM_API_KEY belum diset — worker tidak jalan (fallback aktif).")
        return
    try:
        import websockets  # lazy import; hanya perlu kalau worker jalan
    except Exception as e:
        logger.warning("[ais] library websockets tidak tersedia: %s", e)
        return
    import time
    while True:
        watch = set(await active_mmsis(db))
        if not watch:
            await asyncio.sleep(60)
            continue
        try:
            async with websockets.connect(AISSTREAM_URL, ping_interval=20, ping_timeout=25, max_size=2 ** 22) as ws:
                sub = {
                    "APIKey": key,
                    "BoundingBoxes": INDONESIA_BBOX,
                    "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
                }
                await ws.send(json.dumps(sub))
                logger.info("[ais] terhubung. menonton %d kapal.", len(watch))
                last_refresh = time.monotonic()
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except Exception:
                        continue
                    await _handle(db, msg, watch)
                    # Refresh daftar MMSI yang dipantau tiap 60 dtk supaya kapal
                    # yang baru diinput admin cepat ikut terpantau (dulu 300 dtk).
                    if time.monotonic() - last_refresh > 60:
                        watch = set(await active_mmsis(db))
                        last_refresh = time.monotonic()
        except Exception as e:
            logger.warning("[ais] koneksi terputus: %s — reconnect 15s.", e)
            await asyncio.sleep(15)


def worker_running() -> bool:
    return bool(_worker_task and not _worker_task.done())


async def diag(db):
    """Diagnostik AIS (read-only, TANPA menampilkan API key). configured=yes/no."""
    watched = await active_mmsis(db)
    cache_count = 0
    sample = []
    try:
        cache_count = await db.ais_positions.count_documents({})
        cur = db.ais_positions.find({}, {"_id": 0, "mmsi": 1, "ship_name": 1, "imo": 1, "position_timestamp": 1}).limit(10)
        async for d in cur:
            st = staleness(d.get("position_timestamp"))
            sample.append({
                "mmsi": d.get("mmsi"), "ship_name": d.get("ship_name"), "imo": d.get("imo"),
                "position_timestamp": d.get("position_timestamp"), "freshness": st["freshness"],
            })
    except Exception as e:
        logger.warning("[ais] diag gagal: %s", e)
    return {
        "configured": provider_enabled(),          # aisstream: yes/no saja — bukan nilai key
        "worker_running": worker_running(),
        "vesselapi_configured": vesselapi_enabled(),   # VesselAPI: yes/no saja
        "vesselapi_sat": _vesselapi_use_sat(),
        "vesselapi_kuota_habis_menit": kuota_sisa_menit(),   # >0 = kuota bulanan habis, panggilan ditahan sekian menit lagi
        "vesselapi_sat_lookback_min": VESSELAPI_SAT_LOOKBACK,   # jendela umur posisi satelit (menit)
        "auto_refresh_running": auto_refresh_running(),
        "vesselfinder_configured": vesselfinder_enabled(),   # VesselFinder: yes/no saja
        "vesselfinder_sat": _vesselfinder_use_sat(),
        "watched_mmsi_count": len(watched),
        "watched_sample": watched[:20],
        "cache_count": cache_count,
        "cache_sample": sample,
    }


async def probe_vesselfinder(mmsi, imo=None):
    """Diagnostik: panggil VesselFinder /vessels mentah untuk lihat status + bentuk
    respons (TANPA menampilkan userkey). Terrestrial (sat=0) seperti sumber publik."""
    if not vesselfinder_enabled():
        return {"error": "VESSELFINDER_API_KEY belum diset di backend"}
    params = {"extradata": "voyage"}
    if str(mmsi or "").strip():
        params["mmsi"] = str(mmsi).strip()
    elif str(imo or "").strip():
        params["imo"] = str(imo).strip()
    else:
        return {"error": "tidak ada mmsi/imo untuk diuji"}
    try:
        r = await asyncio.to_thread(_vesselfinder_get, params, 15)
        try:
            body = r.json()
        except Exception:
            body = {"_text": (r.text or "")[:800]}
        return {
            "status": r.status_code,
            "ratelimit_remaining": r.headers.get("X-RateLimit-Remaining"),
            "has_position": bool(isinstance(_vf_pick(body), dict) and _num(_vf_pick(body).get("LATITUDE")) is not None),
            "body": body,
        }
    except Exception as e:
        return {"error": str(e)}


async def probe_vesselapi(mmsi, imo=None, sat=False, primary_only=False):
    """Diagnostik: panggil VesselAPI /position mentah untuk lihat status + bentuk
    respons (TANPA menampilkan API key). Default: coba mmsi dulu, lalu imo kalau
    belum 200 (perilaku lama). sat=True → ikut filter satelit (sama dgn jalur
    halaman tracking). primary_only=True → cukup 1 call ke ident yang DIPAKAI app
    (mmsi kalau ada, kalau tidak imo) — hemat kuota."""
    if not vesselapi_enabled():
        return {"error": "VESSEL_API_KEY belum diset di backend"}
    cands = (("mmsi", mmsi, "mmsi"), ("imo", imo, "imo"))
    if primary_only:
        first = next((c for c in cands if str(c[1] or "").strip()), None)
        cands = (first,) if first else ()
    out = {}
    for label, ident, idtype in cands:
        ident = str(ident or "").strip()
        if not ident:
            continue
        params = {"filter.idType": idtype}
        if sat:
            params["filter.sat"] = "true"
            params["filter.satLookbackMinutes"] = str(VESSELAPI_SAT_LOOKBACK)
        try:
            r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/position", params)
            try:
                body = r.json()
            except Exception:
                body = {"_text": (r.text or "")[:800]}
            out[label] = {
                "id": ident,
                "mode": "satelit" if sat else "darat",
                "status": r.status_code,
                "ratelimit_remaining": r.headers.get("X-RateLimit-Remaining"),
                "x_data_source": r.headers.get("X-Data-Source"),
                "ditahan": isinstance(r, _KuotaHabis),   # True = tidak dikirim ke VesselAPI (kuota habis ditahan aplikasi)
                "body": body,
            }
            if r.status_code == 200:
                break
        except Exception as e:
            out[label] = {"id": ident, "mode": "satelit" if sat else "darat", "error": str(e)}
    return out or {"error": "tidak ada mmsi/imo untuk diuji"}


def _summarize_probe(pr):
    """Ringkas hasil probe_vesselapi jadi info aman (TANPA key, TANPA dump body
    besar): per idtype → {idtype, id, status, has_position, source, ratelimit}."""
    out = []
    if not isinstance(pr, dict):
        return out
    for label in ("mmsi", "imo"):
        d = pr.get(label)
        if not isinstance(d, dict):
            continue
        has_pos = False
        body = d.get("body")
        try:
            p = _pluck(body, "latitude") if isinstance(body, dict) else None
            has_pos = bool(p and p.get("latitude") is not None)
        except Exception:
            has_pos = False
        out.append({
            "idtype": label, "id": d.get("id"), "mode": d.get("mode"), "status": d.get("status"),
            "has_position": has_pos, "source": d.get("x_data_source"),
            "ratelimit_remaining": d.get("ratelimit_remaining"),
            "ditahan": bool(d.get("ditahan")),
            "error": d.get("error"),
        })
    if pr.get("error") and not out:
        out.append({"error": pr.get("error")})
    return out


async def trace(db, probe_missing=True, max_probe=8):
    """TRACE per kapal dari Route Leg (read-only, TANPA API key, TANPA ubah data).
    Untuk tiap leg kapal (punya mmsi/imo) di semua trip: identitas, status leg,
    apakah MMSI dipantau worker, apakah ada posisi di cache (+kesegaran), dan —
    khusus kapal yang BELUM ada posisi — hasil probe VesselAPI (status 200/404/…)
    biar jelas 'provider belum punya posisi' vs 'ada masalah'. Probe dibatasi
    (max_probe) biar hemat kuota."""
    watched = set(await active_mmsis(db))
    rows, seen = [], set()
    try:
        cur = db.trips.find({"legs": {"$exists": True}}, {"_id": 0, "trip_id": 1, "order_id": 1, "legs": 1})
        async for t in cur:
            for lg in (t.get("legs") or []):
                if not _leg_is_ship(lg):
                    continue
                mmsi, imo = _leg_ship_id(lg)
                if not (mmsi or imo):
                    continue
                k = (t.get("trip_id"), mmsi or imo, str((lg or {}).get("route_leg_id") or ""))
                if k in seen:
                    continue
                seen.add(k)
                rows.append({
                    "trip_id": t.get("trip_id"), "order_id": t.get("order_id"),
                    "kapal": str((lg or {}).get("kapal") or "").strip(),
                    "mmsi": mmsi, "imo": imo,
                    "leg_status": str((lg or {}).get("status") or "").strip(),
                    "leg_kind": _leg_status_kind(lg),
                    "watched": bool(mmsi) and mmsi in watched,
                })
    except Exception as e:
        logger.warning("[ais] trace scan gagal: %s", e)

    probes_left = max_probe if (probe_missing and (vesselapi_enabled() or vesselfinder_enabled())) else 0
    probe_cache = {}   # ident kapal (mmsi/imo) -> hasil probe; 1 kapal dites SEKALI walau muncul di banyak trip
    for r in rows:
        doc = None
        try:
            if r["mmsi"]:
                doc = await db.ais_positions.find_one({"mmsi": r["mmsi"]}, {"_id": 0})
            if not doc and r["imo"]:
                doc = await db.ais_positions.find_one({"imo": r["imo"]}, {"_id": 0})
        except Exception:
            doc = None
        pub = public_ais(doc)
        r["cache"] = bool(doc)
        r["cache_has_position"] = bool(pub)
        r["freshness"] = pub.get("freshness") if pub else None
        r["age_seconds"] = (pub.get("age_seconds") if pub else _doc_age_seconds(doc))
        r["provider"] = None
        # Probe provider berbayar HANYA utk kapal yang belum ada posisi (bermasalah).
        if not pub and (probe_missing and (vesselapi_enabled() or vesselfinder_enabled())):
            ident = r["mmsi"] or r["imo"]
            if ident in probe_cache:
                r["provider"] = probe_cache[ident]
                r["provider_shared"] = True     # hasil sama dgn baris kapal yang sama di atas
            elif probes_left > 0:
                probes_left -= 1
                prov = []
                if vesselapi_enabled():
                    # Darat dulu (probe lama), lalu satelit kalau mode satelit nyala —
                    # meniru jalur halaman tracking. 1 call per mode ke ident yang dipakai app.
                    for use_sat in ((False, True) if _vesselapi_use_sat() else (False,)):
                        try:
                            prov += _summarize_probe(await probe_vesselapi(r["mmsi"], r["imo"], sat=use_sat, primary_only=True))
                        except Exception as e:
                            prov.append({"idtype": "vesselapi", "mode": "satelit" if use_sat else "darat", "error": str(e)[:160]})
                if vesselfinder_enabled():
                    try:
                        vf = await probe_vesselfinder(r["mmsi"], r["imo"])
                        prov.append({
                            "idtype": "vesselfinder", "id": ident,
                            "status": vf.get("status"), "has_position": vf.get("has_position"),
                            "source": "vesselfinder", "ratelimit_remaining": vf.get("ratelimit_remaining"),
                            "error": vf.get("error"),
                        })
                    except Exception as e:
                        prov.append({"idtype": "vesselfinder", "error": str(e)[:160]})
                probe_cache[ident] = prov
                r["provider"] = prov
    # urut: yang belum ada posisi di atas, lalu by nama
    rows.sort(key=lambda x: (x["cache_has_position"], x.get("kapal") or ""))
    return {
        "vesselapi_configured": vesselapi_enabled(),
        "aisstream_configured": provider_enabled(),
        "worker_running": worker_running(),
        "watched_count": len(watched),
        "ship_count": len(rows),
        "probed": max_probe - probes_left if (probe_missing and (vesselapi_enabled() or vesselfinder_enabled())) else 0,
        "ships": rows,
    }


# ── Cek otomatis berkala (background) ───────────────────────────────────────
# Kapal yang legnya "Berlangsung" tapi belum/ tidak punya posisi segar dicek ke
# provider (VesselAPI → VesselFinder) secara berkala, TANPA nunggu ada yang buka
# halaman tracking. Dicek SEKALI per kapal unik (bukan per unit/trip) dan jaraknya
# makin lama kalau terus kosong (hemat kuota call): 1 jam → 2 → 4 → maks 6 jam.
# Mati total kalau tidak ada provider berbayar, atau env AIS_AUTO_REFRESH=off.
AUTO_REFRESH_TICK = int(os.environ.get("AIS_AUTO_REFRESH_TICK") or "600")   # detik antar putaran
_AUTO_BACKOFF = (1800, 3600, 7200, 14400)   # backoff kegagalan beruntun: 30 mnt → 1 → 2 → maks 4 jam (kapal pembawa kendaraan tetap dipantau malam hari)
_auto_task = None


# ── Target pemantauan & anggaran kuota ───────────────────────────────────────
# Prioritas: "carrying" = leg kapal BERLANGSUNG (kapal sedang membawa kendaraan pelanggan),
#            "upcoming" = leg kapal belum selesai (Menunggu) pada trip yang masih jalan -> posisi sudah siap
#            saat kendaraan naik kapal, dan data kapal baru/IMO salah ketahuan lebih awal.
INTERVAL_CARRYING_MIN = int(os.environ.get("AIS_INTERVAL_CARRYING_MIN") or "120")
INTERVAL_UPCOMING_MIN = int(os.environ.get("AIS_INTERVAL_UPCOMING_MIN") or "480")
_CALLS_PER_CHECK = 1.3          # posisi (1) + sebagian eta/fallback; dipakai utk menghitung anggaran
_TRIP_DONE_RE = re.compile(r"selesai|delivered|completed|dibatalkan|batal|cancel", re.I)


def budget_month():
    """Kuota panggilan per bulan dari paket (env AIS_BUDGET_MONTH). 0/kosong = tidak dibatasi (pakai interval dasar)."""
    try:
        return max(0, int(float(os.environ.get("AIS_BUDGET_MONTH") or "0")))
    except Exception:
        return 0


def plan_intervals(n_carry, n_up, budget=None, now=None):
    """(menit_carrying, menit_upcoming|None). Tanpa anggaran: interval dasar. Dengan anggaran: kapal yang membawa
    kendaraan dapat sampai 75% dari jatah harian (aman 90% kuota), sisanya kapal berikutnya; kalau jatah habis,
    kapal 'upcoming' dijeda (None) tapi kapal pembawa kendaraan tetap dipantau."""
    import calendar
    b = budget_month() if budget is None else budget
    ic, iu = float(INTERVAL_CARRYING_MIN), float(INTERVAL_UPCOMING_MIN)
    if not b or (n_carry + n_up) == 0:
        return int(ic), int(iu)
    now = now or datetime.now(timezone.utc)
    days = calendar.monthrange(now.year, now.month)[1]
    daily = b * 0.9 / days
    carry_need = n_carry * _CALLS_PER_CHECK * 1440 / ic
    cap_c = daily * (0.75 if n_up else 1.0)
    if n_carry and carry_need > cap_c:
        ic = n_carry * _CALLS_PER_CHECK * 1440 / cap_c
        carry_need = cap_c
    ic = max(float(_MIN_FETCH_INTERVAL // 60), ic)
    up_daily = daily - (n_carry * _CALLS_PER_CHECK * 1440 / ic if n_carry else 0)
    if n_up:
        if up_daily <= 0:
            return int(ic), None
        iu = max(iu, n_up * _CALLS_PER_CHECK * 1440 / up_daily)
    return int(ic), int(iu)


def trip_selesai(t):
    """Pengiriman sudah selesai (serah terima selesai / status trip selesai / leg terakhir selesai): kapalnya tak perlu dipantau lagi."""
    t = t or {}
    if (t.get("progress") or {}).get("handover_complete") or _TRIP_DONE_RE.search(str(t.get("status") or "")):
        return True
    legs = t.get("legs") or []
    return bool(legs) and _leg_status_kind(legs[-1]) == "done"


async def ship_targets(db):
    """Semua kapal yang perlu dipantau: {ident: {mmsi, imo, name, prio, trips}} — prio 'carrying' mengalahkan 'upcoming'."""
    out = {}
    try:
        async for t in db.trips.find({"legs": {"$exists": True}}, {"_id": 0, "trip_id": 1, "legs": 1, "progress": 1, "status": 1}):
            if trip_selesai(t):
                continue
            for lg in (t.get("legs") or []):
                if not _leg_is_ship(lg):
                    continue
                kind = _leg_status_kind(lg)
                if kind == "done":
                    continue
                mmsi, imo = _leg_ship_id(lg)
                ident = mmsi or imo
                if not ident:
                    continue
                prio = "carrying" if kind == "active" else "upcoming"
                e = out.get(ident)
                if e is None:
                    e = out[ident] = {"ident": ident, "mmsi": mmsi, "imo": imo, "name": str(lg.get("kapal") or "").strip(),
                                      "prio": prio, "trips": []}
                elif prio == "carrying":
                    e["prio"] = "carrying"
                e["trips"].append(t.get("trip_id"))
    except Exception as e:
        logger.warning("[ais] ship_targets gagal: %s", e)
    # Satu kapal = satu target (satu request per siklus) walau ada leg yang hanya mengisi IMO dan leg lain MMSI+IMO.
    by_imo = {e["imo"]: k for k, e in out.items() if e["mmsi"] and e["imo"]}
    for k in [k for k, e in out.items() if not e["mmsi"] and e["imo"] in by_imo]:
        e = out.pop(k)
        tgt = out[by_imo[e["imo"]]]
        tgt["trips"] += e["trips"]
        if e["prio"] == "carrying":
            tgt["prio"] = "carrying"
    return out


async def refresh_aktif_sekarang(db, max_ships=10):
    """Admin: ambil posisi SEKARANG untuk kapal yang dipantau (pembawa kendaraan lebih dulu), tanpa menunggu jadwal.
    Membuka tahanan kuota dan jeda per-kapal lebih dulu. Kalau panggilan pertama masih ditolak karena kuota
    habis, sisanya ditahan lagi (tidak memboroskan). Return daftar hasil per kapal."""
    kuota_reset()
    tg = await ship_targets(db)
    order = sorted(tg.values(), key=lambda e: 0 if e["prio"] == "carrying" else 1)
    hasil = []
    for e in order[:max_ships]:
        ident, mmsi, imo = e["ident"], e["mmsi"], e["imo"]
        row = {"ident": ident, "kapal": e["name"], "prioritas": e["prio"], "ok": False, "freshness": None, "age_seconds": None, "catatan": ""}
        if kuota_sisa_menit() > 0:
            row["catatan"] = "ditahan (kuota VesselAPI habis)"
            hasil.append(row)
            continue
        _last_pos_fetch.pop(ident, None)
        fresh = None
        try:
            if vesselapi_enabled():
                fresh = await _vesselapi_refresh(db, mmsi, imo, timeout=(5, 30), manual=True)
            if not fresh and vesselfinder_enabled():
                fresh = await _vesselfinder_refresh(db, mmsi, imo)
        except Exception as ex:
            row["catatan"] = f"error: {ex}"
        if fresh and fresh.get("latitude") is not None:
            st = staleness(fresh.get("position_timestamp") or (None if fresh.get("ts_unverified") else fresh.get("updated_at")))
            row.update({"ok": st["freshness"] != "stale", "freshness": st["freshness"], "age_seconds": st["age_seconds"]})
            if not row["ok"]:
                row["catatan"] = "posisi dari provider masih lama"
        elif not row["catatan"]:
            stt = await ais_audit.get_status(db, ident)
            row["catatan"] = ais_audit.PESAN.get((stt or {}).get("state") or "", "") or "provider belum punya posisi kapal ini"
        hasil.append(row)
    return {"hasil": hasil, "kapal_aktif": len(tg), "kuota_habis_menit": kuota_sisa_menit()}


def _auto_backoff_seconds(fails):
    """Jeda sebelum cek ulang setelah `fails` kali gagal berturut-turut."""
    n = max(int(fails or 1), 1)
    return _AUTO_BACKOFF[min(n, len(_AUTO_BACKOFF)) - 1]


def _auto_refresh_enabled():
    off = (os.environ.get("AIS_AUTO_REFRESH") or "on").strip().lower() in ("off", "0", "false", "no")
    return (vesselapi_enabled() or vesselfinder_enabled()) and not off


def auto_refresh_running():
    return bool(_auto_task and not _auto_task.done())


async def auto_refresh_cycle(db, state, now_m, max_ships=10, now_utc=None):
    """Satu putaran pemantauan otomatis (24 jam). `state` = {ident: {"fails","next"}} (in-memory, hanya backoff gagal),
    `now_m` = time.monotonic(). Waktu pengecekan terakhir tersimpan di DB (ais_ship_status), jadi deploy/restart
    tidak memicu panggilan beruntun.
    - kapal yang belum pernah dicek -> langsung dicoba (tidak menunggu jadwal);
    - kapal pembawa kendaraan ("carrying") dicek tiap ~AIS_INTERVAL_CARRYING_MIN, kapal berikutnya ("upcoming") lebih jarang;
    - anggaran kuota (AIS_BUDGET_MONTH) melebarkan interval otomatis; kapal pembawa kendaraan selalu didahulukan;
    - AIS_REFRESH_HOURS (opsional) membatasi ke jam tertentu, tiap kapal sekali per slot."""
    res = {"candidates": 0, "attempted": 0, "ok": 0, "fail": 0, "skipped_fresh": 0, "skipped_backoff": 0,
           "skipped_slot": 0, "skipped_interval": 0, "paused_budget": False, "outside_schedule": False}
    now_u = now_utc or datetime.now(timezone.utc)
    slot = None
    if refresh_hours() is not None:
        slot = current_slot(now_u)
        if slot is None:                 # di luar jam jadwal (hanya bila AIS_REFRESH_HOURS diisi)
            res["outside_schedule"] = True
            return res
    tg = await ship_targets(db)
    res["candidates"] = len(tg)
    if not tg:
        return res
    n_c = sum(1 for e in tg.values() if e["prio"] == "carrying")
    iv_c, iv_u = plan_intervals(n_c, len(tg) - n_c, now=now_u)
    res["interval_carrying_min"], res["interval_upcoming_min"] = iv_c, iv_u
    bm = budget_month()
    if bm:
        try:
            u = await ais_audit.usage(db, now_u)
            if u["bulan"]["total"] >= bm * 0.98:
                res["paused_budget"] = True
                return res
        except Exception:
            pass
    max_age = VESSELAPI_MAX_AGE_MIN * 60
    order = sorted(tg.values(), key=lambda e: 0 if e["prio"] == "carrying" else 1)
    for e in order:
        if res["attempted"] >= max_ships:
            break
        ident, mmsi, imo, prio = e["ident"], e["mmsi"], e["imo"], e["prio"]
        if prio == "upcoming" and iv_u is None:
            res["skipped_interval"] += 1
            continue
        doc = None
        try:
            if mmsi:
                doc = await db.ais_positions.find_one({"mmsi": mmsi}, {"_id": 0})
            if not doc and imo:
                doc = await db.ais_positions.find_one({"imo": imo}, {"_id": 0})
        except Exception:
            doc = None
        age = _doc_age_seconds(doc) if (doc and doc.get("latitude") is not None) else None
        if age is not None and age <= max_age:
            state.pop(ident, None)
            res["skipped_fresh"] += 1
            continue
        if slot is not None and state.get(("slot", ident)) == slot:
            res["skipped_slot"] += 1     # sudah dicek di slot jam ini
            continue
        stt = await ais_audit.get_status(db, ident)
        if stt and stt.get("last_checked_at"):             # pernah dicek -> hormati interval prioritas
            try:
                lc = datetime.fromisoformat(str(stt["last_checked_at"]).replace("Z", "+00:00"))
                if (now_u - lc).total_seconds() < (iv_c if prio == "carrying" else iv_u) * 60:
                    res["skipped_interval"] += 1
                    continue
            except Exception:
                pass
        st = state.get(ident)
        if st and now_m < st["next"]:
            res["skipped_backoff"] += 1
            continue
        res["attempted"] += 1
        if slot is not None:
            state[("slot", ident)] = slot
        fresh = None
        try:
            if vesselapi_enabled():
                fresh = await _vesselapi_refresh(db, mmsi, imo)
            if not fresh and vesselfinder_enabled():
                fresh = await _vesselfinder_refresh(db, mmsi, imo)
        except Exception as ex:
            logger.warning("[ais] auto-refresh %s gagal: %s", ident, ex)
            fresh = None
        if not vesselapi_enabled():                    # jalur VesselFinder saja: catat waktu cek supaya interval berlaku
            await ais_audit.set_status(db, ident, "ok" if fresh else "no_position")
        fage = _doc_age_seconds(fresh) if (fresh and fresh.get("latitude") is not None) else None
        if fage is not None and fage <= max_age:      # dapat posisi yang benar-benar segar
            state.pop(ident, None)
            res["ok"] += 1
        else:                                          # kosong / masih basi -> backoff kegagalan
            fails = (st["fails"] if st else 0) + 1
            state[ident] = {"fails": fails, "next": now_m + _auto_backoff_seconds(fails)}
            res["fail"] += 1
    return res


async def _auto_refresh_run(db):
    import time
    state = {}
    await asyncio.sleep(120)          # biar server selesai start dulu
    while True:
        try:
            from datetime import datetime, timezone
            r = await auto_refresh_cycle(db, state, time.monotonic(), now_utc=datetime.now(timezone.utc))
            if r["attempted"]:
                logger.info("[ais] auto-refresh: %s", r)
        except Exception as e:
            logger.warning("[ais] auto-refresh error: %s", e)
        await asyncio.sleep(AUTO_REFRESH_TICK)


def start_auto_refresh(db):
    """Start cek otomatis berkala sekali. Aman dipanggil berkali-kali / tanpa key."""
    global _auto_task
    if not _auto_refresh_enabled():
        logger.info("[ais] auto-refresh tidak aktif (tanpa provider berbayar atau AIS_AUTO_REFRESH=off).")
        return
    if _auto_task and not _auto_task.done():
        return
    try:
        _auto_task = asyncio.create_task(_auto_refresh_run(db))
        logger.info("[ais] auto-refresh dimulai (cek tiap %ss; jadwal jam %s, zona UTC%+d menit; pelanggan memicu panggilan: %s).",
                    AUTO_REFRESH_TICK, sorted(refresh_hours()) if refresh_hours() else "selalu", AIS_TZ_OFFSET_MIN, customer_refresh_enabled())
    except Exception as e:
        logger.warning("[ais] gagal start auto-refresh: %s", e)


def start_worker(db):
    """Start worker sekali. Aman dipanggil walau key kosong (langsung no-op)."""
    global _worker_task
    if not provider_enabled():
        logger.info("[ais] provider tidak aktif (tanpa key) — Fleet pakai fallback link eksternal.")
        return
    if _worker_task and not _worker_task.done():
        return
    try:
        _worker_task = asyncio.create_task(_run(db))
        logger.info("[ais] worker aisstream dimulai.")
    except Exception as e:
        logger.warning("[ais] gagal start worker: %s", e)
