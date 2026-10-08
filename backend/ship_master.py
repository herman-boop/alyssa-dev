"""
Master kapal — data STATIS kapal (panjang, lebar, tipe) yang tidak datang dari
AIS posisi. Disimpan sekali per kapal, dikunci MMSI (utama) atau IMO.

Koleksi `ship_master` (1 dokumen per kapal):
  key        "mmsi:<9 digit>" atau "imo:<7 digit>"  (unik)
  mmsi, imo, name, ship_type, length_m, width_m, updated_at

Additif: tidak mengubah koleksi/kolom lain. Tidak ada delete (data boleh
dikoreksi lewat upsert, tidak dihapus).
"""
import re
from datetime import datetime, timezone

COLL = "ship_master"
MAX_LEN_M = 500.0     # kapal terbesar di dunia ±400 m
MAX_WIDTH_M = 80.0


def _digits(v):
    return re.sub(r"\D", "", str(v or ""))


def make_key(mmsi, imo):
    m, i = _digits(mmsi), _digits(imo)
    if len(m) == 9:
        return f"mmsi:{m}"
    if len(i) == 7:
        return f"imo:{i}"
    return ""


def _num(v, lo, hi, label):
    if v is None or str(v).strip() == "":
        return None
    try:
        n = float(str(v).replace(",", "."))
    except Exception:
        raise ValueError(f"{label} harus angka")
    if not (lo < n <= hi):
        raise ValueError(f"{label} di luar batas wajar (0–{hi:g} m)")
    return round(n, 2)


def clean_payload(p):
    """Validasi & normalisasi input admin. Raise ValueError (pesan Indonesia)."""
    p = p or {}
    m, i = _digits(p.get("mmsi")), _digits(p.get("imo"))
    if m and len(m) != 9:
        raise ValueError("MMSI harus 9 digit")
    if i and len(i) != 7:
        raise ValueError("IMO harus 7 digit")
    key = make_key(m, i)
    if not key:
        raise ValueError("Isi MMSI (9 digit) atau IMO (7 digit)")
    ship_type = re.sub(r"[<>]", "", str(p.get("ship_type") or "")).strip()[:60]
    name = re.sub(r"[<>]", "", str(p.get("name") or "")).strip()[:80]
    return {
        "key": key, "mmsi": m, "imo": i, "name": name, "ship_type": ship_type,
        "length_m": _num(p.get("length_m"), 0, MAX_LEN_M, "Panjang"),
        "width_m": _num(p.get("width_m"), 0, MAX_WIDTH_M, "Lebar"),
    }


def public_master(doc):
    """Field yang boleh tampil ke pelanggan. None kalau tidak ada data berguna."""
    if not doc:
        return None
    out = {"length_m": doc.get("length_m"), "width_m": doc.get("width_m"),
           "ship_type": doc.get("ship_type") or ""}
    return out if (out["length_m"] is not None or out["width_m"] is not None or out["ship_type"]) else None


async def lookup(db, mmsi, imo):
    """MMSI dicoba dulu, lalu IMO. Return dokumen (tanpa _id) atau None."""
    for k in (make_key(mmsi, ""), make_key("", imo)):
        if k:
            d = await getattr(db, COLL).find_one({"key": k}, {"_id": 0})
            if d:
                return d
    return None


async def upsert(db, payload):
    doc = clean_payload(payload)
    doc["updated_at"] = datetime.now(timezone.utc).isoformat()
    await getattr(db, COLL).update_one({"key": doc["key"]}, {"$set": doc}, upsert=True)
    return doc


async def list_all(db, limit=500):
    return await getattr(db, COLL).find({}, {"_id": 0}).sort("name", 1).to_list(limit)
