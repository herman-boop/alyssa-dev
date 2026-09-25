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
# Modular: kalau VESSELAPI_KEY diisi, posisi diambil on-demand via REST saat
# halaman tracking dibuka & cache sudah basi. Hemat kuota (tidak polling 24 jam).
# Terrestrial default; satelit hanya kalau VESSELAPI_USE_SAT=true + ada kredit.
VESSELAPI_URL = "https://api.vesselapi.com/v1"
# Umur maksimum posisi cache (menit) sebelum coba refresh dari VesselAPI:
VESSELAPI_MAX_AGE_MIN = int(os.environ.get("VESSELAPI_MAX_AGE_MIN") or "45")
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
    return (os.environ.get("VESSELAPI_KEY") or "").strip()


def vesselapi_enabled() -> bool:
    return bool(vesselapi_key())


def any_provider_enabled() -> bool:
    return provider_enabled() or vesselapi_enabled()


def _vesselapi_use_sat() -> bool:
    return (os.environ.get("VESSELAPI_USE_SAT") or "").strip().lower() in ("1", "true", "yes", "on")


def _vesselapi_get(path, params):
    """HTTP GET ke VesselAPI (blocking; dipanggil via asyncio.to_thread)."""
    import requests
    headers = {"Authorization": f"Bearer {vesselapi_key()}"}
    return requests.get(f"{VESSELAPI_URL}{path}", params=params, headers=headers, timeout=15)


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
        "nav_status_text": nav_status_text(doc.get("nav_status")),
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


async def _vesselapi_refresh(db, mmsi, imo):
    """Ambil posisi (+ETA) 1 kapal dari VesselAPI dan simpan ke cache.
    On-demand + throttle supaya kuota hemat. Return dokumen cache terbaru / None.
    Aman kalau key kosong (langsung None)."""
    if not vesselapi_enabled():
        return None
    ident = (mmsi or imo or "").strip()
    if not ident:
        return None
    idtype = "mmsi" if mmsi else "imo"
    import time as _t
    now_m = _t.monotonic()
    if now_m - _last_pos_fetch.get(ident, 0) < _MIN_FETCH_INTERVAL:
        return None  # baru saja diambil — jangan boros kuota
    _last_pos_fetch[ident] = now_m

    params = {"filter.idType": idtype}
    if _vesselapi_use_sat():
        params["filter.sat"] = "true"
    try:
        r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/position", params)
    except Exception as e:
        logger.warning("[ais] VesselAPI position gagal: %s", e)
        return None
    if r.status_code == 404:
        logger.info("[ais] VesselAPI: belum ada posisi untuk %s (404).", ident)
        return None
    if r.status_code != 200:
        logger.warning("[ais] VesselAPI position HTTP %s untuk %s.", r.status_code, ident)
        return None
    try:
        pos = _pluck(r.json(), "latitude")
    except Exception:
        pos = None
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
    if now_m - _last_eta_fetch.get(ident, 0) >= _ETA_FETCH_INTERVAL:
        _last_eta_fetch[ident] = now_m
        try:
            re = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/eta", {"filter.idType": idtype})
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


async def position_for_legs(db, legs):
    """Ambil identitas kapal dari leg (mmsi/imo) + posisi AIS dari cache.
    Dipanggil oleh view per-trip supaya SELALU scoped ke trip pemiliknya
    (tidak ada query MMSI bebas dari publik). Return None kalau tidak ada
    leg kapal ber-mmsi/imo."""
    chosen = None
    for lg in (legs or []):
        lg = lg or {}
        mmsi = str(lg.get("mmsi") or "").strip()
        imo = str(lg.get("imo") or "").strip()
        if mmsi or imo:
            chosen = {"ship_name": str(lg.get("kapal") or "").strip(), "mmsi": mmsi, "imo": imo}
            if mmsi:
                break
    if not chosen:
        return None
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

    return {
        "ship_name": chosen["ship_name"],
        "mmsi": chosen["mmsi"],
        "imo": chosen["imo"],
        "provider_enabled": any_provider_enabled(),
        "ais": public_ais(doc),
    }


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
                    if time.monotonic() - last_refresh > 300:
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
        "watched_mmsi_count": len(watched),
        "watched_sample": watched[:20],
        "cache_count": cache_count,
        "cache_sample": sample,
    }


async def probe_vesselapi(mmsi, imo=None):
    """Diagnostik: panggil VesselAPI /position mentah untuk lihat status + bentuk
    respons (TANPA menampilkan API key). Coba mmsi dulu, lalu imo kalau 404."""
    if not vesselapi_enabled():
        return {"error": "VESSELAPI_KEY belum diset di backend"}
    out = {}
    for label, ident, idtype in (("mmsi", mmsi, "mmsi"), ("imo", imo, "imo")):
        ident = str(ident or "").strip()
        if not ident:
            continue
        try:
            r = await asyncio.to_thread(_vesselapi_get, f"/vessel/{ident}/position", {"filter.idType": idtype})
            try:
                body = r.json()
            except Exception:
                body = {"_text": (r.text or "")[:800]}
            out[label] = {
                "id": ident,
                "status": r.status_code,
                "ratelimit_remaining": r.headers.get("X-RateLimit-Remaining"),
                "x_data_source": r.headers.get("X-Data-Source"),
                "body": body,
            }
            if r.status_code == 200:
                break
        except Exception as e:
            out[label] = {"id": ident, "error": str(e)}
    return out or {"error": "tidak ada mmsi/imo untuk diuji"}


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
