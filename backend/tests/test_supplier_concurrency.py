"""Dua admin bekerja bersamaan pada supplier yang sama: tidak boleh ada unit, pembayaran, atau tambahan yang hilang.
Interleaving dipaksa dengan 'gerbang' pada find_one agar kedua permintaan membaca data lama LEBIH DULU sebelum salah satunya menulis
(kondisi balapan terburuk). Semua di Mongo TIRUAN."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_conc")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi"); pytest.importorskip("httpx")
import httpx
from mongomock_motor import AsyncMongoMockClient
import server
import supplier_import as SI


class Gerbang:
    """Tahan N pembaca pertama sampai semuanya sudah membaca (memaksa 'baca-baca-tulis-tulis')."""
    def __init__(self, n):
        self.n, self.hadir, self.ev, self.aktif = n, 0, asyncio.Event(), True

    async def tunggu(self):
        if not self.aktif:
            return
        self.hadir += 1
        if self.hadir >= self.n:
            self.aktif = False; self.ev.set()
        else:
            await self.ev.wait()


def pasang_db(monkeypatch, db, gerbang=None, cas_dimatikan=False):
    class Koleksi:
        def __init__(self, k): self._k = k
        def __getattr__(self, n): return getattr(self._k, n)
        async def find_one(self, flt, *a, **kw):
            d = await self._k.find_one(flt, *a, **kw)
            if gerbang and isinstance(flt, dict) and flt.get("id") == "s1" and d is not None:
                d = copy.deepcopy(d)
                await gerbang.tunggu()
            return d

    class Db:
        def __getattr__(self, n): return Koleksi(getattr(db, n)) if n == "supplier_profiles" else getattr(db, n)
    monkeypatch.setattr(server, "db", Db())
    if cas_dimatikan:       # perilaku LAMA: tulis ulang tanpa memeriksa versi (hanya untuk kontrol)
        async def lama(supplier_id, ver, fields):
            await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": fields})
        monkeypatch.setattr(server, "_jobs_commit", lama)


def klien():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://t")


def seed(db, run, n_unit=3):
    jobs = [{"id": f"j{i}", "project_id": "p1", "nopol": f"B{i}", "vehicle_type": "X", "asal_kota": "A", "tujuan_kota": f"K{i}", "total_harga": 1_000_000,
             "tanggal": "2026-06-01", "tambahan": [], "payments": [{"id": f"pay{i}", "amount": 100_000 * (i + 1), "tanggal": "2026-06-02", "tipe": "transfer"}]} for i in range(n_unit)]
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "S", "projects": [{"id": "p1", "nama": "Projek 1", "status": "open"}], "jobs": jobs,
                                         "rekon_payments": [{"id": "r1", "amount": 5, "tanggal": "2026-06-03", "status": "active", "allocations": []}]}))
    return jobs


@pytest.fixture()
def env():
    db = AsyncMongoMockClient()["t"]
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    jobs = seed(db, run)
    yield db, run, jobs
    loop.close()


def doc(db, run):
    return run(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def riwayat_bayar(d):
    return {j["id"]: copy.deepcopy(j["payments"]) for j in d["jobs"] if j["id"].startswith("j")}


def unit_body(nopol):
    return {"vehicle_type": "Baru", "nopol": nopol, "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "total_harga": 2_000_000}


# ── KONTROL: pola lama (tulis ulang tanpa CAS) memang menimpa -> harness benar-benar mendeteksi balapan ──
def test_kontrol_pola_lama_menimpa_perubahan_admin_lain(env, monkeypatch):
    db, run, _ = env
    pasang_db(monkeypatch, db, Gerbang(2), cas_dimatikan=True)

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(
                c.post("/api/admin/suppliers/s1/jobs/j0/tambahan", json={"label": "A", "amount": 1000}),
                c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "B", "amount": 2000}))
    r = run(skenario())
    assert all(x.status_code == 200 for x in r)
    d = doc(db, run)
    n = sum(len(j["tambahan"]) for j in d["jobs"])
    assert n == 1, "kontrol: tanpa CAS, salah satu tambahan HILANG (lost update) -> harness valid"


# ── Perbaikan: dua admin menambah unit bersamaan ────────────────────────────
def test_dua_admin_menambah_unit_bersamaan_tidak_ada_yang_hilang(env, monkeypatch):
    db, run, jobs0 = env
    sebelum = riwayat_bayar(doc(db, run))
    pasang_db(monkeypatch, db, Gerbang(2))

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(c.post("/api/admin/suppliers/s1/jobs", json=unit_body("N 1111 AA")),
                                        c.post("/api/admin/suppliers/s1/jobs", json=unit_body("N 2222 BB")))
    r = run(skenario())
    assert [x.status_code for x in r] == [200, 200]
    d = doc(db, run)
    assert {j["nopol"] for j in d["jobs"]} >= {"N 1111 AA", "N 2222 BB", "B0", "B1", "B2"} and len(d["jobs"]) == 5
    assert riwayat_bayar(d) == sebelum                              # pembayaran & riwayat tidak berubah
    assert d["rekon_payments"][0]["id"] == "r1"
    assert d["jobs_ver"] == 2


def test_impor_dan_tambah_unit_manual_bersamaan(env, monkeypatch):
    db, run, _ = env
    sebelum = riwayat_bayar(doc(db, run))
    pasang_db(monkeypatch, db, Gerbang(2))
    rows = [{"nopol": f"S {i}000 HN", "vehicle_type": "T", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "harga_dasar": 1_000_000 + i} for i in range(1, 11)]

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "imp1", "rows": rows, "source": {"sha256": "z" * 64}}),
                                        c.post("/api/admin/suppliers/s1/jobs", json=unit_body("N 3333 CC")))
    r = run(skenario())
    assert [x.status_code for x in r] == [200, 200], [x.text for x in r]
    d = doc(db, run)
    assert len(d["jobs"]) == 3 + 10 + 1 and riwayat_bayar(d) == sebelum
    assert len(d["import_riwayat"]) == 1 and sum(1 for j in d["jobs"] if j.get("import_id") == "imp1") == 10


# ── Perbaikan: edit baca-ubah-tulis berbenturan dengan impor ────────────────
def test_edit_tambahan_berbenturan_dengan_impor_diulang_tanpa_menimpa(env, monkeypatch):
    db, run, _ = env
    sebelum = riwayat_bayar(doc(db, run))
    pasang_db(monkeypatch, db, Gerbang(2))
    rows = [{"nopol": f"S {i}000 HN", "vehicle_type": "T", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "harga_dasar": 1_000_000} for i in range(1, 6)]

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(c.post("/api/admin/suppliers/s1/jobs/j0/tambahan", json={"label": "Tol", "amount": 5000}),
                                        c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "imp2", "rows": rows}))
    r = run(skenario())
    assert [x.status_code for x in r] == [200, 200], [x.text for x in r]
    d = doc(db, run)
    assert len(d["jobs"]) == 3 + 5                                   # impor tidak tertimpa edit
    assert [t["amount"] for t in next(j for j in d["jobs"] if j["id"] == "j0")["tambahan"]] == [5000]   # edit tidak hilang
    assert riwayat_bayar(d) == sebelum


def test_dua_edit_pada_unit_berbeda_keduanya_tersimpan(env, monkeypatch):
    db, run, _ = env
    pasang_db(monkeypatch, db, Gerbang(2))

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(c.post("/api/admin/suppliers/s1/jobs/j0/tambahan", json={"label": "A", "amount": 1000}),
                                        c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "B", "amount": 2000}))
    assert all(x.status_code == 200 for x in run(skenario()))
    d = doc(db, run)
    assert [len(j["tambahan"]) for j in d["jobs"]] == [1, 1, 0]


def test_endpoint_unggah_file_yang_berbenturan_menjadi_409_tanpa_menimpa(env, monkeypatch):
    db, run, _ = env
    sebelum = riwayat_bayar(doc(db, run))
    pasang_db(monkeypatch, db, Gerbang(2))

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(
                c.post("/api/admin/suppliers/s1/jobs/j2/payments", data={"amount": "50000", "tipe": "transfer", "tanggal": "2026-06-10"}),
                c.post("/api/admin/suppliers/s1/jobs", json=unit_body("N 4444 DD")))
    r = run(skenario())
    kode = sorted(x.status_code for x in r)
    d = doc(db, run)
    assert 200 in kode and any(n["nopol"] == "N 4444 DD" for n in d["jobs"]), [x.text for x in r]
    pay_j2 = next(j for j in d["jobs"] if j["id"] == "j2")["payments"]
    if kode == [200, 409]:                                           # pembayaran bentrok: ditolak jelas, tidak ada yang tertimpa
        assert pay_j2 == sebelum["j2"]
    else:                                                            # atau berhasil bersih
        assert len(pay_j2) == len(sebelum["j2"]) + 1
    assert len(d["jobs"]) == 4 and {k: v for k, v in riwayat_bayar(d).items() if k != "j2"} == {k: v for k, v in sebelum.items() if k != "j2"}


# ── Migrasi lazy saat membaca tidak boleh menimpa impor yang sedang masuk ───
def test_migrasi_lazy_get_supplier_tidak_menimpa_impor(env, monkeypatch):
    db, run, _ = env
    d0 = doc(db, run)
    for j in d0["jobs"]:                                              # unit lama (sebelum fitur Projek): tanpa project_id
        j.pop("project_id", None)
    run(db.supplier_profiles.update_one({"id": "s1"}, {"$set": {"jobs": d0["jobs"], "projects": []}}))
    pasang_db(monkeypatch, db, Gerbang(2))
    rows = [{"nopol": f"S {i}000 HN", "vehicle_type": "T", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "harga_dasar": 1_000_000} for i in range(1, 4)]

    async def skenario():
        async with klien() as c:
            return await asyncio.gather(c.get("/api/admin/suppliers/s1"),
                                        c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "imp3", "rows": rows}))
    r = run(skenario())
    assert [x.status_code for x in r] == [200, 200], [x.text for x in r]
    d = doc(db, run)
    assert len(d["jobs"]) == 3 + 3                                    # impor tidak hilang walau GET sempat mencoba migrasi


def test_banyak_penulis_bersamaan_tanpa_gerbang(env, monkeypatch):
    db, run, _ = env
    sebelum = riwayat_bayar(doc(db, run))
    pasang_db(monkeypatch, db, None)

    async def skenario():
        async with klien() as c:
            tugas = [c.post("/api/admin/suppliers/s1/jobs", json=unit_body(f"M {i} AA")) for i in range(15)]
            tugas += [c.post("/api/admin/suppliers/s1/import-invoice", json={"key": f"k{i}", "rows": [{"nopol": f"Z {i} QQ", "vehicle_type": "T", "asal_kota": "A", "tujuan_kota": "B", "harga_dasar": 10}]}) for i in range(15)]
            tugas += [c.post(f"/api/admin/suppliers/s1/jobs/j{i % 3}/tambahan", json={"label": f"t{i}", "amount": 100}) for i in range(9)]
            return await asyncio.gather(*tugas)
    r = run(skenario())
    assert all(x.status_code == 200 for x in r), [x.text for x in r if x.status_code != 200][:2]
    d = doc(db, run)
    assert len(d["jobs"]) == 3 + 15 + 15 and sum(len(j.get("tambahan") or []) for j in d["jobs"]) == 9
    assert riwayat_bayar(d) == sebelum
