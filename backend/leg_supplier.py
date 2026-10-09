"""
Supplier per Leg & Pembayaran Supplier.

Koleksi `leg_supplier` (1 dokumen per leg trip, key "<trip_id>:<route_leg_id>"):
  supplier {supplier_id, nama, pic, no_hp, email, bank, no_rekening}
  harga_deal            biaya utama supplier untuk leg ini
  extras[]              biaya tambahan {id,label,amount} (BBM, tol, dst) -> menambah HPP leg
  kompensasi[]          {id,amount,tanggal,catatan,bukti_url}
  transfers[]           {id,amount,tanggal,catatan,bukti_url}
  dept {supplier_id, job_id}   tautan ke job di Departemen Supplier (supplier_profiles)

RUMUS (sesuai keputusan pemilik; Kompensasi MENAMBAH tagihan):
  Total Tagihan = Harga Deal + Biaya Tambahan + Kompensasi
  Outstanding   = Total Tagihan - Total Transfer

SINKRON ke Departemen Supplier (additif, tidak mengubah logika lama): tiap simpan,
satu job di supplier_profiles[supplier].jobs (ditandai `leg_ref`) diperbarui:
  total_harga = Harga Deal; tambahan = biaya tambahan + kompensasi (src="leg");
  payments = transfer (src="leg"). Dengan begitu rumus lama
  (deal + tambahan - payments) menghasilkan angka yang SAMA dengan modul ini.
Item job yang bukan dari leg (src != "leg") tidak pernah disentuh.
"""
import re
import uuid
from datetime import datetime

COLL = "leg_supplier"
MAX_RP = 100_000_000_000


def key_of(trip_id, leg_id):
    return f"{trip_id}:{leg_id}"


def _s(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _money(v, label):
    try:
        n = int(round(float(str(v if v is not None else 0).replace(".", "").replace(",", "."))))
    except Exception:
        raise ValueError(f"{label} harus angka")
    if n < 0 or n > MAX_RP:
        raise ValueError(f"{label} di luar batas")
    return n


def _gid():
    return uuid.uuid4().hex[:8]


def clean_supplier(d):
    d = d or {}
    return {
        "supplier_id": _s(d.get("supplier_id"), 40),
        "nama": _s(d.get("nama"), 200),
        "pic": _s(d.get("pic"), 120),
        "no_hp": _s(d.get("no_hp"), 40),
        "email": _s(d.get("email"), 120),
        "bank": _s(d.get("bank"), 80),
        "no_rekening": re.sub(r"[^0-9A-Za-z\- ]", "", str(d.get("no_rekening") or ""))[:40].strip(),
    }


def clean_extras(items):
    out = []
    for x in (items or [])[:50]:
        label = _s((x or {}).get("label"), 80)
        amt = _money((x or {}).get("amount"), "Nominal biaya tambahan")
        if not label and not amt:
            continue
        if not label:
            raise ValueError("Keterangan biaya tambahan wajib diisi")
        if amt <= 0:
            raise ValueError("Nominal biaya tambahan harus lebih dari 0")
        out.append({"id": _s((x or {}).get("id"), 20) or _gid(), "label": label, "amount": amt})
    return out


def compute(rec):
    deal = int(rec.get("harga_deal") or 0)
    extras = sum(int(x.get("amount") or 0) for x in rec.get("extras") or [])
    komp = sum(int(x.get("amount") or 0) for x in rec.get("kompensasi") or [])
    trf = sum(int(x.get("amount") or 0) for x in rec.get("transfers") or [])
    total = deal + extras + komp
    return {"harga_deal": deal, "biaya_tambahan": extras, "kompensasi": komp,
            "total_tagihan": total, "total_transfer": trf, "outstanding": total - trf,
            "hpp_leg": deal + extras}


def blank(trip_id, leg_id):
    return {"key": key_of(trip_id, leg_id), "trip_id": trip_id, "route_leg_id": leg_id,
            "supplier": clean_supplier({}), "harga_deal": 0, "extras": [], "kompensasi": [],
            "transfers": [], "dept": {}}


def view(rec):
    out = {k: v for k, v in rec.items() if k != "_id"}
    out["totals"] = compute(rec)
    return out


async def get(db, trip_id, leg_id):
    rec = await db[COLL].find_one({"key": key_of(trip_id, leg_id)})
    return rec or blank(trip_id, leg_id)


async def _save(db, rec):
    rec = {k: v for k, v in rec.items() if k != "_id"}
    rec["updated_at"] = datetime.utcnow().isoformat()
    await db[COLL].update_one({"key": rec["key"]}, {"$set": rec}, upsert=True)
    return rec


# ── Sinkron ke Departemen Supplier ──────────────────────────────────────────
def _norm(n):
    return re.sub(r"\s+", " ", str(n or "")).strip().lower()


async def _resolve_profile(db, sup, gen_id):
    """Cari profil supplier: by supplier_id, lalu by nama (case-insensitive), kalau tak ada dibuat."""
    if sup.get("supplier_id"):
        p = await db.supplier_profiles.find_one({"id": sup["supplier_id"]}, {"_id": 0})
        if p:
            return p
    want = _norm(sup.get("nama"))
    async for s in db.supplier_profiles.find({}, {"id": 1, "nama": 1}):
        if _norm(s.get("nama")) == want:
            return await db.supplier_profiles.find_one({"id": s["id"]}, {"_id": 0})
    doc = {"id": gen_id(), "nama": sup["nama"], "jenis": "", "no_hp": sup.get("no_hp", ""),
           "catatan": "", "created_at": datetime.utcnow().isoformat(), "jobs": []}
    await db.supplier_profiles.insert_one(doc)
    return dict(doc)


def _leg_items(rec):
    """Item sisi Departemen Supplier yang berasal dari leg ini."""
    tambahan = [{"id": "leg-" + x["id"], "label": x["label"], "amount": int(x["amount"]), "src": "leg",
                 "created_at": rec.get("updated_at") or datetime.utcnow().isoformat()} for x in rec.get("extras") or []]
    tambahan += [{"id": "leg-" + x["id"], "label": ("Kompensasi: " + x["catatan"]) if x.get("catatan") else "Kompensasi",
                  "amount": int(x["amount"]), "src": "leg", "kind": "kompensasi", "bukti_url": x.get("bukti_url"),
                  "created_at": rec.get("updated_at") or datetime.utcnow().isoformat()} for x in rec.get("kompensasi") or []]
    payments = [{"id": "leg-" + x["id"], "amount": int(x["amount"]), "catatan": x.get("catatan", ""),
                 "bukti_url": x.get("bukti_url"), "tanggal": x.get("tanggal"), "tipe": "transfer", "src": "leg"}
                for x in rec.get("transfers") or []]
    return tambahan, payments


async def sync_to_dept(db, rec, ctx, h):
    """Dorong data leg ke job Departemen Supplier. h = {gen_id, today, ensure_projects, active_project}.
    Mengembalikan rec dengan `dept` terisi. Tanpa nama supplier -> tidak ada yang disinkron."""
    sup = rec["supplier"]
    if not sup.get("nama"):
        return rec
    ref = rec["key"]
    old = rec.get("dept") or {}
    prof = await _resolve_profile(db, sup, h["gen_id"])

    # supplier diganti: lepas item leg dari job lama
    if old.get("supplier_id") and old["supplier_id"] != prof["id"]:
        op = await db.supplier_profiles.find_one({"id": old["supplier_id"]}, {"_id": 0})
        if op:
            keep = []
            for j in op.get("jobs") or []:
                if j.get("leg_ref") != ref:
                    keep.append(j); continue
                j["tambahan"] = [t for t in j.get("tambahan") or [] if t.get("src") != "leg"]
                j["payments"] = [p for p in j.get("payments") or [] if p.get("src") != "leg"]
                if j["tambahan"] or j["payments"]:
                    j.pop("leg_ref", None); keep.append(j)
            await db.supplier_profiles.update_one({"id": op["id"]}, {"$set": {"jobs": keep}})

    prof = await h["ensure_projects"](prof)
    jobs = prof.get("jobs") or []
    job = next((j for j in jobs if j.get("leg_ref") == ref), None)
    projects = prof.get("projects") or []
    if job is None:
        pid, projects = h["active_project"](prof)
        job = {"id": h["gen_id"](), "project_id": pid, "leg_ref": ref, "tanggal": h["today"](), "tag": "",
               "entity_id": "", "selisih_deal": None, "selisih_invoice": None, "ppn_enabled": False,
               "ppn_rate": None, "pph23_enabled": False, "pph23_rate": None, "payments": [], "tambahan": [],
               "catatan": "Dari Leg: " + (ctx.get("asal") or "-") + " → " + (ctx.get("tujuan") or "-")}
        jobs.append(job)
    job["order_id"] = ctx.get("order_id") or None
    job["customer_ref"] = ctx.get("customer_nama") or ""
    job["vehicle_type"] = ctx.get("vehicle_type") or ""
    job["nopol"] = (ctx.get("nopol") or "").upper()
    job["no_rangka"] = (ctx.get("no_rangka") or "").upper()
    job["asal_kota"] = ctx.get("asal") or ""
    job["tujuan_kota"] = ctx.get("tujuan") or ""
    job["total_harga"] = int(rec.get("harga_deal") or 0)
    tambahan, payments = _leg_items(rec)
    job["tambahan"] = [t for t in job.get("tambahan") or [] if t.get("src") != "leg"] + tambahan
    job["payments"] = [p for p in job.get("payments") or [] if p.get("src") != "leg"] + payments

    upd = {"jobs": jobs, "projects": projects}
    for f_prof, f_sup in (("pic", "pic"), ("email", "email"), ("bank", "bank"), ("no_rekening", "no_rekening")):
        if sup.get(f_sup):
            upd[f_prof] = sup[f_sup]
    if sup.get("no_hp") and not prof.get("no_hp"):
        upd["no_hp"] = sup["no_hp"]
    await db.supplier_profiles.update_one({"id": prof["id"]}, {"$set": upd})
    rec["dept"] = {"supplier_id": prof["id"], "job_id": job["id"]}
    rec["supplier"]["supplier_id"] = prof["id"]
    return rec


# ── Operasi ─────────────────────────────────────────────────────────────────
async def save_profile(db, trip_id, leg_id, payload, ctx, h):
    rec = await get(db, trip_id, leg_id)
    rec["supplier"] = clean_supplier(payload.get("supplier"))
    rec["harga_deal"] = _money(payload.get("harga_deal"), "Harga deal")
    rec["extras"] = clean_extras(payload.get("extras"))
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await sync_to_dept(db, rec, ctx, h)
    return view(await _save(db, rec))


async def add_payment(db, trip_id, leg_id, tipe, amount, tanggal, catatan, bukti_url, ctx, h):
    if tipe not in ("transfer", "kompensasi"):
        raise ValueError("Tipe pembayaran harus transfer atau kompensasi")
    amt = _money(amount, "Jumlah bayar")
    if amt <= 0:
        raise ValueError("Jumlah bayar harus lebih dari 0")
    tgl = _s(tanggal, 10)
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = h["today"]()
    rec = await get(db, trip_id, leg_id)
    if not rec["supplier"].get("nama"):
        raise ValueError("Isi dan simpan Supplier dulu sebelum mencatat pembayaran")
    item = {"id": _gid(), "amount": amt, "tanggal": tgl, "catatan": _s(catatan, 300), "bukti_url": bukti_url or None}
    rec["transfers" if tipe == "transfer" else "kompensasi"].append(item)
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await sync_to_dept(db, rec, ctx, h)
    return view(await _save(db, rec))


async def delete_payment(db, trip_id, leg_id, pid, ctx, h):
    rec = await get(db, trip_id, leg_id)
    n0 = len(rec["transfers"]) + len(rec["kompensasi"])
    rec["transfers"] = [x for x in rec["transfers"] if x["id"] != pid]
    rec["kompensasi"] = [x for x in rec["kompensasi"] if x["id"] != pid]
    if len(rec["transfers"]) + len(rec["kompensasi"]) == n0:
        raise KeyError("Pembayaran tidak ditemukan")
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await sync_to_dept(db, rec, ctx, h)
    return view(await _save(db, rec))
