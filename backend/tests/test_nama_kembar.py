"""Gabung nama pelanggan kembar: pratinjau, penerapan, perlindungan data."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import nama_kembar as nk  # noqa: E402


class Coll:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _m(d, q):
        for k, v in q.items():
            if d.get(k) != v:
                return False
        return True

    def find(self, q=None, proj=None):
        rows = [dict(d) for d in self.docs if self._m(d, q or {})]

        class Cur:
            def __aiter__(s):
                s.it = iter(rows)
                return s

            async def __anext__(s):
                try:
                    return next(s.it)
                except StopIteration:
                    raise StopAsyncIteration
        return Cur()

    async def update_many(self, q, upd):
        for d in self.docs:
            if self._m(d, q):
                d.update(upd["$set"])

    async def update_one(self, q, upd):
        for d in self.docs:
            if self._m(d, q):
                d.update(upd["$set"])
                return

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def delete_one(self, q):
        for i, d in enumerate(self.docs):
            if self._m(d, q):
                del self.docs[i]
                return


class DB:
    def __init__(self):
        self.c = {}

    def __getattr__(self, k):
        return self.c.setdefault(k, Coll())

    def __getitem__(self, k):
        return self.c.setdefault(k, Coll())


def make_db():
    db = DB()
    names = ["PT. Transkon Jaya, Tbk", "PT. Transkon Jaya, Tbk", "PT. TRANSKON JAYA,TBK", "PT.Transkon Jaya, TBK ", "PT Lain Sekali"]
    db.c["orders"] = Coll([{"order_id": f"O{i}", "customer_nama": n, "harga": 100} for i, n in enumerate(names)])
    db.c["contacts"] = Coll([
        {"id": "C1", "nama": "PT. Transkon Jaya, Tbk", "jenis": "pelanggan", "no_hp": "", "email": "a@x.com", "created_at": "2026-01-01"},
        {"id": "C2", "nama": "PT. TRANSKON JAYA,TBK", "jenis": "pelanggan", "no_hp": "0813", "email": "", "created_at": "2026-02-01"},
        {"id": "C3", "nama": "PT.Transkon Jaya, TBK", "jenis": "pelanggan", "no_hp": "", "email": "", "created_at": "2026-03-01"},
        {"id": "S1", "nama": "PT Transkon Jaya TBK", "jenis": "supplier"},
    ])
    db.c["pelanggan_profiles"] = Coll([{"id": "P1", "nama_pt": "PT. Transkon Jaya, Tbk"}])
    return db


def run(c):
    return asyncio.run(c)


def test_list_hanya_kelompok_kembar():
    groups = run(nk.list_groups(make_db()))
    assert len(groups) == 1
    g = groups[0]
    assert g["key"] == "pttranskonjayatbk"
    assert g["total_orders"] == 4 and g["total_contacts"] == 3 and g["total_profiles"] == 1
    assert g["saran_nama_resmi"] == "PT TRANSKON JAYA TBK"


def test_pratinjau_tidak_mengubah_data():
    db = make_db()
    plan = run(nk.merge_group(db, "pttranskonjayatbk", "PT TRANSKON JAYA TBK", dry_run=True))
    assert plan["orders_diubah"] == 4 and plan["kontak_digabung_dihapus"] == 2 and plan["profil_harga_diubah"] == 1
    assert [o["customer_nama"] for o in db.c["orders"].docs][0] == "PT. Transkon Jaya, Tbk"
    assert len(db.c["contacts"].docs) == 4 and not db.c.get(nk.LOG)


def test_terapkan():
    db = make_db()
    res = run(nk.merge_group(db, "pttranskonjayatbk", "PT TRANSKON JAYA TBK", dry_run=False))
    assert res["dry_run"] is False
    names = {o["customer_nama"] for o in db.c["orders"].docs}
    assert names == {"PT TRANSKON JAYA TBK", "PT Lain Sekali"}
    assert all(o["harga"] == 100 for o in db.c["orders"].docs)          # nominal tidak tersentuh
    assert db.c["orders"].docs[2]["customer_nama_sebelumnya"] == "PT. TRANSKON JAYA,TBK"
    cts = {c["id"]: c for c in db.c["contacts"].docs}
    assert set(cts) == {"C1", "S1"}                                     # supplier tidak disentuh
    assert cts["C1"]["nama"] == "PT TRANSKON JAYA TBK" and cts["C1"]["no_hp"] == "0813" and cts["C1"]["email"] == "a@x.com"
    assert {c["id"] for c in db.c[nk.BACKUP].docs} == {"C2", "C3"}      # dipindah, bukan hilang
    assert db.c["pelanggan_profiles"].docs[0]["nama_pt"] == "PT TRANSKON JAYA TBK"
    assert len(db.c[nk.LOG].docs) == 1
    # idempoten: ulangi = tidak ada yang berubah lagi
    again = run(nk.merge_group(db, "pttranskonjayatbk", "PT TRANSKON JAYA TBK", dry_run=True))
    assert again["orders_diubah"] == 0 and again["kontak_digabung_dihapus"] == 0 and again["profil_harga_diubah"] == 0


def test_validasi_dan_profil_ganda():
    db = make_db()
    for bad in ("", "PT BEDA SAMA SEKALI"):
        try:
            run(nk.merge_group(db, "pttranskonjayatbk", bad, dry_run=True))
            assert False
        except ValueError:
            pass
    db.c["pelanggan_profiles"].docs.append({"id": "P2", "nama_pt": "PT TRANSKON JAYA TBK"})
    plan = run(nk.merge_group(db, "pttranskonjayatbk", "PT TRANSKON JAYA TBK", dry_run=False))
    assert plan["profil_harga_perlu_manual"] == 2 and plan["profil_harga_diubah"] == 0
    assert db.c["pelanggan_profiles"].docs[0]["nama_pt"] == "PT. Transkon Jaya, Tbk"  # tidak disentuh
    try:
        run(nk.merge_group(db, "tidakada", "TIDAK ADA", dry_run=True))
        assert False
    except (ValueError, LookupError):
        pass


def make_supplier_db():
    db = DB()
    db.c["contacts"] = Coll([
        {"id": "S1", "nama": "CV. Maju Jaya", "jenis": "supplier", "no_hp": "", "created_at": "2026-01-01"},
        {"id": "S2", "nama": "CV Maju Jaya", "jenis": "supplier", "no_hp": "0812", "created_at": "2026-02-01"},
        {"id": "S3", "nama": "CV.MAJU JAYA", "jenis": "supplier", "no_hp": "", "created_at": "2026-03-01"},
        {"id": "C1", "nama": "CV Maju Jaya", "jenis": "pelanggan", "created_at": "2026-01-01"},   # pelanggan tidak ikut
    ])
    db.c["supplier_profiles"] = Coll([{"id": "SP1", "nama": "CV. Maju Jaya", "jobs": [{"harga": 1}]}])
    return db


def test_supplier_dan_pelanggan_terpisah():
    db = make_supplier_db()
    sg = run(nk.list_groups(db, "supplier"))
    assert len(sg) == 1 and sg[0]["total_contacts"] == 3 and sg[0]["total_profiles"] == 1
    assert run(nk.list_groups(db, "pelanggan")) == []        # 1 kontak pelanggan saja, tidak kembar
    try:
        run(nk.list_groups(db, "lain"))
        assert False
    except ValueError:
        pass
    res = run(nk.merge_group(db, "cvmajujaya", "CV MAJU JAYA", dry_run=False, jenis="supplier"))
    assert res["kontak_digabung_dihapus"] == 2 and res["profil_harga_diubah"] == 1
    ids = {c["id"]: c for c in db.c["contacts"].docs}
    assert set(ids) == {"S1", "C1"} and ids["S1"]["nama"] == "CV MAJU JAYA" and ids["S1"]["no_hp"] == "0812"
    assert ids["C1"]["nama"] == "CV Maju Jaya"               # pelanggan tidak tersentuh
    sp = db.c["supplier_profiles"].docs[0]
    assert sp["nama"] == "CV MAJU JAYA" and sp["jobs"] == [{"harga": 1}]   # tagihan/pekerjaan tidak tersentuh


def test_gabung_semua():
    db = make_db()
    db.c["orders"].docs.append({"order_id": "X1", "customer_nama": "PT. Maju-Jaya", "harga": 5})
    db.c["orders"].docs.append({"order_id": "X2", "customer_nama": "PT Maju Jaya", "harga": 5})
    pre = run(nk.merge_all(db, "pelanggan", dry_run=True))
    assert pre["kelompok"] == 2 and pre["orders_diubah"] >= 5 and not pre["gagal"]
    assert any(o["customer_nama"] == "PT. Transkon Jaya, Tbk" for o in db.c["orders"].docs)   # pratinjau tidak mengubah
    done = run(nk.merge_all(db, "pelanggan", dry_run=False))
    assert done["dry_run"] is False and done["kelompok"] == 2
    names = {o["customer_nama"] for o in db.c["orders"].docs}
    assert "PT TRANSKON JAYA TBK" in names and "PT. Transkon Jaya, Tbk" not in names
    assert all(o["harga"] in (100, 5) for o in db.c["orders"].docs)
    assert run(nk.list_groups(db, "pelanggan")) == [] or all(len(g["variants"]) >= 2 for g in run(nk.list_groups(db, "pelanggan")))
