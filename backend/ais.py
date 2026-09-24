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


def api_key() -> str:
    """API key aisstream — HANYA dari env backend. Jangan pernah diekspos."""
    return (os.environ.get("AISSTREAM_API_KEY") or "").strip()


def provider_enabled() -> bool:
    return bool(api_key())


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
        "position_timestamp": ts,
        "source": doc.get("source") or "",
        "age_seconds": st["age_seconds"],
        "freshness": st["freshness"],
    }


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
    return {
        "ship_name": chosen["ship_name"],
        "mmsi": chosen["mmsi"],
        "imo": chosen["imo"],
        "provider_enabled": provider_enabled(),
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
        "configured": provider_enabled(),          # yes/no saja — bukan nilai key
        "worker_running": worker_running(),
        "watched_mmsi_count": len(watched),
        "watched_sample": watched[:20],
        "cache_count": cache_count,
        "cache_sample": sample,
    }


def start_worker(db):
    """Start worker sekali. Aman dipanggil walau key kosong (langsung no-op)."""
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
