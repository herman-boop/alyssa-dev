"""
Insentif checkpoint driver (borongan): bonus per foto checkpoint yang valid, dicatat otomatis
ke antrean pembayaran supaya admin tinggal cek foto lalu bayar. TIDAK ada uang keluar otomatis.

Memakai nilai `bonus_daily` trip yang sudah ada (menu "Atur Bonus Driver") dan hanya aktif kalau
trip diberi tanda `bonus_daily_bayar` = True (default mati, jadi trip lain tidak terpengaruh).

Koleksi `driver_incentives` (1 dokumen per checkpoint, key "<trip_id>:<checkpoint_id>", anti dobel):
  status: "menunggu" -> "dibayar" | "ditolak"  (bisa dibuka lagi ke "menunggu")
"""
from datetime import datetime, timezone

COLL = "driver_incentives"
STATUSES = ("menunggu", "dibayar", "ditolak")


def _now():
    return datetime.now(timezone.utc).isoformat()


def enabled(trip):
    return bool(trip.get("bonus_daily_bayar")) and int(trip.get("bonus_daily") or 0) > 0


def make_doc(trip, cp):
    return {
        "id": "INS-" + str(cp.get("id") or "")[:12],
        "key": f"{trip.get('trip_id')}:{cp.get('id')}",
        "trip_id": trip.get("trip_id"),
        "cp_id": cp.get("id"),
        "date": cp.get("date"),
        "status_cp": cp.get("status") or "",
        "alamat": cp.get("alamat") or "",
        "lat": cp.get("lat"), "lng": cp.get("lng"),
        "foto_url": cp.get("url"),
        "driver_nama": (trip.get("nama_driver") or "").strip(),
        "nopol": (trip.get("nopol") or "").strip(),
        "amount": int(trip.get("bonus_daily") or 0),
        "status": "menunggu",
        "catatan": "", "bukti_url": None, "paid_at": None,
        "created_at": _now(),
    }


async def maybe_create(db, trip, cp):
    """Buat antrean untuk 1 checkpoint. Idempoten. Mengembalikan dokumen baru atau None."""
    if not enabled(trip) or not cp.get("id"):
        return None
    doc = make_doc(trip, cp)
    if await db[COLL].find_one({"key": doc["key"]}):
        return None
    await db[COLL].insert_one(dict(doc))
    return doc


async def backfill(db, trip):
    """Saat fitur baru dinyalakan: kreditkan checkpoint yang sudah ada. Mengembalikan jumlah baru."""
    n = 0
    for cp in trip.get("daily_checkpoints") or []:
        if await maybe_create(db, trip, cp):
            n += 1
    return n


async def list_items(db, status=None, q=None):
    items = []
    async for d in db[COLL].find({}):
        d = {k: v for k, v in d.items() if k != "_id"}
        if status and d.get("status") != status:
            continue
        if q:
            blob = f"{d.get('driver_nama','')} {d.get('nopol','')} {d.get('trip_id','')}".lower()
            if q.strip().lower() not in blob:
                continue
        items.append(d)
    items.sort(key=lambda x: (x.get("date") or "", x.get("created_at") or ""), reverse=True)
    per = {}
    for d in items:
        if d["status"] != "menunggu":
            continue
        k = d.get("driver_nama") or "(tanpa nama)"
        e = per.setdefault(k, {"driver_nama": k, "count": 0, "total": 0})
        e["count"] += 1
        e["total"] += int(d.get("amount") or 0)
    return {"items": items, "per_driver": sorted(per.values(), key=lambda e: -e["total"]),
            "total_menunggu": sum(e["total"] for e in per.values())}


async def set_status(db, item_id, status, catatan="", bukti_url=None):
    if status not in STATUSES:
        raise ValueError("Status tidak valid")
    d = await db[COLL].find_one({"id": item_id})
    if not d:
        raise KeyError("Insentif tidak ditemukan")
    catatan = (catatan or "").strip()[:300]
    if status == "ditolak" and not catatan:
        raise ValueError("Alasan penolakan wajib diisi")
    if status == "dibayar" and d.get("status") == "dibayar":
        raise ValueError("Sudah ditandai dibayar")
    upd = {"status": status, "catatan": catatan}
    if status == "dibayar":
        upd["paid_at"] = _now()
        if bukti_url:
            upd["bukti_url"] = bukti_url
    elif status == "menunggu":
        upd.update({"paid_at": None, "bukti_url": None, "catatan": ""})
    await db[COLL].update_one({"id": item_id}, {"$set": upd})
    d = await db[COLL].find_one({"id": item_id})
    return {k: v for k, v in d.items() if k != "_id"}
