"""
Supplier per Leg & Pembayaran Supplier.

Koleksi `leg_supplier` (1 dokumen per leg trip, key "<trip_id>:<route_leg_id>"):
  supplier {supplier_id, nama, pic, no_hp, email, bank, no_rekening}
  harga_deal            biaya utama supplier untuk leg ini
  extras[]              biaya tambahan {id,label,amount} (BBM, tol, dst) -> menambah HPP leg
  kompensasi[]          {id,amount,tanggal,catatan,bukti_url}
  transfers[]           {id,amount,tanggal,catatan,bukti_url}
  dept {supplier_id, job_id}   tautan ke job di Departemen Supplier (supplier_profiles)

RUMUS = sistem Kompensasi Hutang Piutang (netting 2 arah, sama dengan Ringkasan Kompensasi):
  Kewajiban Alyssa -> Supplier  = Harga Deal + Biaya Tambahan
  Kewajiban Supplier -> Alyssa  = Kompensasi
  Sisa Alyssa    = Kewajiban Alyssa -> Supplier - Total Transfer
  Outstanding    = Sisa Alyssa - Kompensasi   (positif: Alyssa masih bayar; negatif: Supplier wajib bayar ke Alyssa)

SINKRON (additif, logika lama tidak diubah; hanya item bertanda src="leg" yang dikelola):
  1. Departemen Supplier: satu job di supplier_profiles[supplier].jobs (ditandai `leg_ref`):
     total_harga = Harga Deal; tambahan = biaya tambahan; payments = transfer + kompensasi
     (kompensasi = payment tipe "kompensasi"). Rumus lama _supplier_job_totals -> sisa SAMA.
  2. Kompensasi Hutang Piutang (kompensasi_profiles[pihak] by nama supplier):
     items kita_ke_mereka = Harga Deal + biaya tambahan; items mereka_ke_kita = kompensasi;
     payments kita_bayar_mereka = transfer. _kompensasi_totals -> sisa = -Outstanding.
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
    kita = deal + extras                 # kewajiban Alyssa -> Supplier
    sisa_kita = kita - trf               # setelah dikurangi transfer
    out = sisa_kita - komp               # setelah dipotong kompensasi (kewajiban Supplier -> Alyssa)
    return {"harga_deal": deal, "biaya_tambahan": extras, "kompensasi": komp,
            "kewajiban_alyssa": kita, "kewajiban_supplier": komp, "total_tagihan": kita,
            "total_transfer": trf, "sisa_alyssa": sisa_kita, "outstanding": out,
            "arah": "alyssa_bayar" if out > 0 else ("supplier_bayar" if out < 0 else "lunas"),
            "hpp_leg": kita}


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
    payments = [{"id": "leg-" + x["id"], "amount": int(x["amount"]), "catatan": x.get("catatan", ""),
                 "bukti_url": x.get("bukti_url"), "tanggal": x.get("tanggal"), "tipe": "transfer", "src": "leg"}
                for x in rec.get("transfers") or []]
    # kompensasi = pembayaran non-tunai (memotong sisa) -> persis cara lama Departemen Supplier
    payments += [{"id": "leg-" + x["id"], "amount": int(x["amount"]), "catatan": x.get("catatan", ""),
                  "bukti_url": x.get("bukti_url"), "tanggal": x.get("tanggal"), "tipe": "kompensasi", "src": "leg",
                  "kompensasi_unit": {"vehicle_type": "", "no_unit": "", "asal_kota": "", "tujuan_kota": ""}}
                 for x in rec.get("kompensasi") or []]
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


async def _komp_pihak(db, nama, no_hp, gen_id):
    want = _norm(nama)
    async for s in db.kompensasi_profiles.find({}, {"id": 1, "nama": 1}):
        if _norm(s.get("nama")) == want:
            return await db.kompensasi_profiles.find_one({"id": s["id"]}, {"_id": 0})
    doc = {"id": gen_id(), "nama": nama, "no_hp": no_hp or "", "catatan": "",
           "created_at": datetime.utcnow().isoformat(), "items": []}
    await db.kompensasi_profiles.insert_one(doc)
    return dict(doc)


def _strip_leg(doc, ref):
    doc["items"] = [i for i in doc.get("items") or [] if not (i.get("src") == "leg" and i.get("leg_ref") == ref)]
    doc["payments"] = [p for p in doc.get("payments") or [] if not (p.get("src") == "leg" and p.get("leg_ref") == ref)]
    return doc


async def sync_to_kompensasi(db, rec, ctx, h):
    """Dorong data leg ke modul Kompensasi Hutang Piutang (netting 2 arah)."""
    sup = rec["supplier"]
    if not sup.get("nama"):
        return rec
    ref = rec["key"]
    old = (rec.get("komp") or {}).get("pihak_id")
    pihak = await _komp_pihak(db, sup["nama"], sup.get("no_hp"), h["gen_komp_id"])
    if old and old != pihak["id"]:
        op = await db.kompensasi_profiles.find_one({"id": old}, {"_id": 0})
        if op:
            _strip_leg(op, ref)
            await db.kompensasi_profiles.update_one({"id": old}, {"$set": {"items": op["items"], "payments": op["payments"]}})
    _strip_leg(pihak, ref)
    rute = (ctx.get("asal") or "") + " → " + (ctx.get("tujuan") or "")
    base = {"vehicle_type": ctx.get("vehicle_type") or "", "no_unit": (ctx.get("nopol") or "").upper(),
            "asal_kota": ctx.get("asal") or "", "tujuan_kota": ctx.get("tujuan") or "", "src": "leg", "leg_ref": ref}
    today = h["today"]()
    items = []
    if int(rec.get("harga_deal") or 0) > 0:
        items.append(dict(base, id="leg-deal-" + rec["route_leg_id"][:8], arah="kita_ke_mereka", tanggal=today,
                          keterangan="Harga deal leg " + rute, nilai=int(rec["harga_deal"]), catatan="", bukti_url=None))
    for x in rec.get("extras") or []:
        items.append(dict(base, id="leg-" + x["id"], arah="kita_ke_mereka", tanggal=today,
                          keterangan=x["label"], nilai=int(x["amount"]), catatan="", bukti_url=None))
    for x in rec.get("kompensasi") or []:
        items.append(dict(base, id="leg-" + x["id"], arah="mereka_ke_kita", tanggal=x.get("tanggal") or today,
                          keterangan="Kompensasi" + ((": " + x["catatan"]) if x.get("catatan") else ""),
                          nilai=int(x["amount"]), catatan=x.get("catatan", ""), bukti_url=x.get("bukti_url")))
    pays = [{"id": "leg-" + x["id"], "arah": "kita_bayar_mereka", "jumlah": int(x["amount"]), "tanggal": x.get("tanggal"),
             "catatan": x.get("catatan", ""), "bukti_url": x.get("bukti_url"), "src": "leg", "leg_ref": ref,
             "created_at": rec.get("updated_at") or datetime.utcnow().isoformat()} for x in rec.get("transfers") or []]
    await db.kompensasi_profiles.update_one({"id": pihak["id"]}, {"$set": {
        "items": (pihak.get("items") or []) + items, "payments": (pihak.get("payments") or []) + pays}})
    rec["komp"] = {"pihak_id": pihak["id"]}
    return rec


async def _sync_all(db, rec, ctx, h):
    rec = await sync_to_dept(db, rec, ctx, h)
    return await sync_to_kompensasi(db, rec, ctx, h)


# ── Operasi ─────────────────────────────────────────────────────────────────
async def save_profile(db, trip_id, leg_id, payload, ctx, h):
    rec = await get(db, trip_id, leg_id)
    rec["supplier"] = clean_supplier(payload.get("supplier"))
    rec["harga_deal"] = _money(payload.get("harga_deal"), "Harga deal")
    rec["extras"] = clean_extras(payload.get("extras"))
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await _sync_all(db, rec, ctx, h)
    return view(await _save(db, rec))


async def add_payment(db, trip_id, leg_id, tipe, amount, tanggal, catatan, bukti_url, ctx, h, bukti_nama=""):
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
    item = {"id": _gid(), "amount": amt, "tanggal": tgl, "catatan": _s(catatan, 300), "bukti_url": bukti_url or None,
            "bukti_nama": _s(bukti_nama, 120) if bukti_url else ""}
    rec["transfers" if tipe == "transfer" else "kompensasi"].append(item)
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await _sync_all(db, rec, ctx, h)
    return view(await _save(db, rec))


async def delete_payment(db, trip_id, leg_id, pid, ctx, h):
    rec = await get(db, trip_id, leg_id)
    n0 = len(rec["transfers"]) + len(rec["kompensasi"])
    rec["transfers"] = [x for x in rec["transfers"] if x["id"] != pid]
    rec["kompensasi"] = [x for x in rec["kompensasi"] if x["id"] != pid]
    if len(rec["transfers"]) + len(rec["kompensasi"]) == n0:
        raise KeyError("Pembayaran tidak ditemukan")
    rec["updated_at"] = datetime.utcnow().isoformat()
    rec = await _sync_all(db, rec, ctx, h)
    return view(await _save(db, rec))
