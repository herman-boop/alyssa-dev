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
# Jeda minimum antar-panggil VesselAPI untuk 1 kapal (detik) — cegah boros kuota:
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


def _vesselapi_get(path, params, timeout=15):
    """HTTP GET ke VesselAPI (blocking; dipanggil via asyncio.to_thread).
    timeout: (connect, read) — query satelit bisa lambat, jadi proses latar
    belakang (warm) boleh kasih read timeout lebih panjang."""
    import requests
    headers = {"Authorization": f"Bearer {vesselapi_key()}"}
    return requests.get(f"{VESSELAPI_URL}{path}", params=params, headers=headers, timeout=timeout)


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
    ts = doc.get("position_timestamp") or doc.get("updated_at")
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
    }


def _doc_age_seconds(doc):
    if not doc:
        return None
    st = staleness(doc.get("position_timestamp") or doc.get("updated_at"))
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


async def _vesselapi_refresh(db, mmsi, imo, timeout=15):
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
    for label, params in attempts:
        try:
            r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/position", params, timeout)
        except Exception as e:
            logger.warning("[ais] VesselAPI position (%s) gagal utk %s: %s", label, ident, e)
            continue
        if r.status_code == 404:
            logger.info("[ais] VesselAPI (%s): belum ada posisi untuk %s (404).", label, ident)
            continue
        if r.status_code != 200:
            logger.warning("[ais] VesselAPI position (%s) HTTP %s utk %s.", label, r.status_code, ident)
            continue
        try:
            cand = _pluck(r.json(), "latitude")
        except Exception:
            cand = None
        if cand and cand.get("latitude") is not None and cand.get("longitude") is not None:
            pos = cand
            break   # dapet posisi (dari satelit ATAU terestrial) — pakai ini
    if not pos or pos.get("latitude") is None or pos.get("longitude") is None:
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
    if _num(pos.get("heading")) is not None:
        upd["heading"] = _num(pos.get("heading"))
    if pos.get("nav_status") is not None:
        try:
            upd["nav_status"] = int(pos.get("nav_status"))
        except Exception:
            pass
    upd["position_timestamp"] = pos.get("timestamp") or now

    # ETA/tujuan/draught — endpoint terpisah, throttle lebih longgar (jarang berubah)
    _le = _last_eta_fetch.get(ident)
    if _le is None or now_m - _le >= _ETA_FETCH_INTERVAL:
        _last_eta_fetch[ident] = now_m
        try:
            re = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/eta", {"filter.idType": idtype}, timeout)
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

    # On-demand refresh via VesselAPI kalau cache kosong / basi (hemat kuota via throttle)
    if vesselapi_enabled():
        age = _doc_age_seconds(doc)
        if doc is None or age is None or age > VESSELAPI_MAX_AGE_MIN * 60:
            fresh = await _vesselapi_refresh(db, chosen["mmsi"], chosen["imo"])
            if fresh:
                doc = fresh

    # Fallback terakhir: VesselFinder API (sumber sama dgn vesselfinder.com) kalau
    # masih kosong/basi — paling ampuh utk kapal sandar/pesisir (terrestrial).
    # Dipanggil cuma kalau provider sebelumnya belum dapat → hemat kredit.
    if vesselfinder_enabled():
        age = _doc_age_seconds(doc)
        if doc is None or age is None or age > VESSELAPI_MAX_AGE_MIN * 60:
            fresh = await _vesselfinder_refresh(db, chosen["mmsi"], chosen["imo"])
            if fresh:
                doc = fresh

    # Deteksi sandar otomatis (nav_status) sebelum dikirim ke publik.
    doc = await _apply_berth_state(db, doc)

    return {
        "ship_name": chosen["ship_name"],
        "mmsi": chosen["mmsi"],
        "imo": chosen["imo"],
        "provider_enabled": any_provider_enabled(),
        "ais": public_ais(doc),
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
        mmsi, imo = _leg_ship_id(lg or {})
        key = mmsi or imo
        if not key or key in seen:
            continue
        seen.add(key)
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
