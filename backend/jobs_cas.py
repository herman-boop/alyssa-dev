"""Compare-and-set untuk array `supplier_profiles.jobs` (anti lost-update).
Setiap penulis `jobs` menaikkan penghitung `jobs_ver`; penulis baca-ubah-tulis hanya berhasil bila `jobs_ver`
belum berubah sejak ia membaca. Tanpa modul ini, dua admin yang mengedit bersamaan bisa saling menimpa seluruh array."""


class JobsConflict(Exception):
    """`jobs` sudah diubah penulis lain sejak dibaca; baca ulang lalu ulangi."""


class SupplierGone(Exception):
    pass


async def commit(db, supplier_id, ver, fields):
    """Tulis `fields` ($set) HANYA bila jobs_ver == ver (atau belum ada bila ver None), lalu jobs_ver += 1."""
    flt = {"id": supplier_id, "jobs_ver": ver if ver is not None else {"$exists": False}}
    res = await db.supplier_profiles.update_one(flt, {"$set": fields, "$inc": {"jobs_ver": 1}})
    if res.matched_count == 0:
        if not await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 1}):
            raise SupplierGone(supplier_id)
        raise JobsConflict()
