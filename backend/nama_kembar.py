"""
Nama kembar (Langkah 2): gabungkan penulisan nama pelanggan yang dobel menjadi satu nama resmi.

Cakupan yang DIUBAH (dengan pratinjau dulu):
  - orders.customer_nama            → nama resmi (nama lama disimpan di customer_nama_sebelumnya)
  - contacts (jenis pelanggan)      → 1 baris dipertahankan (paling lama, dilengkapi dari yang lain);
                                      baris lain dipindah ke `contacts_merged_backup`, bukan dihapus permanen
  - pelanggan_profiles.nama_pt      → diganti hanya kalau ada TEPAT 1 profil di kelompok itu
                                      (lebih dari 1 = ada harga terpisah, dilaporkan "perlu manual", tidak disentuh)
TIDAK diubah: arsip dokumen (doc_history/invoice yang sudah terbit), snapshot BASTK, harga, nominal apa pun.
Setiap penggabungan dicatat di `nama_merge_log`.
"""
import uuid
from datetime import datetime, timezone

import customer_name as cn

BACKUP = "contacts_merged_backup"
LOG = "nama_merge_log"
FILL_FIELDS = ("perusahaan", "no_hp", "email", "alamat", "catatan")


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _collect(db):
    """key -> {"orders": {raw: n}, "contacts": [doc], "profiles": [doc]}"""
    groups = {}

    def g(key):
        return groups.setdefault(key, {"orders": {}, "contacts": [], "profiles": []})

    async for o in db.orders.find({}, {"_id": 0, "customer_nama": 1}):
        raw = o.get("customer_nama") or ""   # persis seperti di DB (spasi tepi ikut) supaya update cocok
        k = cn.name_key(raw)
        if k:
            d = g(k)["orders"]
            d[raw] = d.get(raw, 0) + 1
    async for c in db.contacts.find({"jenis": "pelanggan"}, {"_id": 0}):
        k = cn.name_key(c.get("nama"))
        if k:
            g(k)["contacts"].append(c)
    async for p in db.pelanggan_profiles.find({}, {"_id": 0, "id": 1, "nama_pt": 1}):
        k = cn.name_key(p.get("nama_pt"))
        if k:
            g(k)["profiles"].append(p)
    return groups


def _variants(grp):
    v = {}
    for raw, n in grp["orders"].items():
        raw = raw.strip()
        v.setdefault(raw, {"nama": raw, "orders": 0, "contacts": 0, "profiles": 0})["orders"] += n
    for c in grp["contacts"]:
        raw = (c.get("nama") or "").strip()
        v.setdefault(raw, {"nama": raw, "orders": 0, "contacts": 0, "profiles": 0})["contacts"] += 1
    for p in grp["profiles"]:
        raw = (p.get("nama_pt") or "").strip()
        v.setdefault(raw, {"nama": raw, "orders": 0, "contacts": 0, "profiles": 0})["profiles"] += 1
    return sorted(v.values(), key=lambda x: (-x["orders"], x["nama"]))


async def list_groups(db):
    out = []
    for key, grp in (await _collect(db)).items():
        vs = _variants(grp)
        if len(vs) < 2:
            continue
        out.append({
            "key": key,
            "saran_nama_resmi": cn.canon_display(vs[0]["nama"]),
            "variants": vs,
            "total_orders": sum(x["orders"] for x in vs),
            "total_contacts": sum(x["contacts"] for x in vs),
            "total_profiles": sum(x["profiles"] for x in vs),
        })
    out.sort(key=lambda x: -x["total_orders"])
    return out


async def merge_group(db, key, nama_resmi, dry_run=True, by="pemilik"):
    nama_resmi = " ".join((nama_resmi or "").split())[:120]
    if not nama_resmi:
        raise ValueError("Nama resmi wajib diisi")
    if cn.name_key(nama_resmi) != key:
        raise ValueError("Nama resmi harus ejaan yang sama dengan kelompok ini (hanya beda titik, koma, spasi, huruf besar/kecil)")
    grp = (await _collect(db)).get(key)
    if not grp or len(_variants(grp)) < 1:
        raise LookupError("Kelompok nama tidak ditemukan")

    raw_order_names = [r for r in grp["orders"] if r != nama_resmi]
    order_n = sum(grp["orders"][r] for r in raw_order_names)
    contacts = sorted(grp["contacts"], key=lambda c: c.get("created_at") or "")
    keeper = contacts[0] if contacts else None
    removed = contacts[1:]
    profile_ok = len(grp["profiles"]) == 1
    profile_rename = profile_ok and (grp["profiles"][0].get("nama_pt") or "").strip() != nama_resmi
    plan = {
        "nama_resmi": nama_resmi,
        "orders_diubah": order_n,
        "kontak_dipertahankan": 1 if keeper else 0,
        "kontak_digabung_dihapus": len(removed),
        "profil_harga_diubah": 1 if profile_rename else 0,
        "profil_harga_perlu_manual": len(grp["profiles"]) if len(grp["profiles"]) > 1 else 0,
        "dry_run": bool(dry_run),
    }
    if dry_run:
        return plan

    for raw in raw_order_names:
        await db.orders.update_many(
            {"customer_nama": raw},
            {"$set": {"customer_nama": nama_resmi, "customer_nama_sebelumnya": raw}},
        )
    removed_ids = []
    if keeper:
        upd = {"nama": nama_resmi}
        for f in FILL_FIELDS:
            if not (keeper.get(f) or "").strip():
                for o in removed:
                    if (o.get(f) or "").strip():
                        upd[f] = o[f]
                        break
        await db.contacts.update_one({"id": keeper["id"]}, {"$set": upd})
        for o in removed:
            await db[BACKUP].insert_one({**o, "merged_into": keeper["id"], "merged_at": _now(), "alasan": "nama kembar"})
            await db.contacts.delete_one({"id": o["id"]})
            removed_ids.append(o["id"])
    if profile_rename:
        await db.pelanggan_profiles.update_one(
            {"id": grp["profiles"][0]["id"]},
            {"$set": {"nama_pt": nama_resmi, "nama_pt_sebelumnya": grp["profiles"][0].get("nama_pt")}},
        )
    await db[LOG].insert_one({
        "id": "NM-" + uuid.uuid4().hex[:10], "key": key, "nama_resmi": nama_resmi, "at": _now(), "by": by,
        "varian_order": raw_order_names, "kontak_dihapus": removed_ids, **{k: v for k, v in plan.items() if k != "dry_run"},
    })
    return {**plan, "dry_run": False}
