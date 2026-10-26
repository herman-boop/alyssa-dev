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
