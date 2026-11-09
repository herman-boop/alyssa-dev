"""Regresi: SEMUA endpoint lama yang menulis supplier_profiles.jobs tetap berfungsi setelah diberi compare-and-set (jobs_ver),
dan setiap penulisan menaikkan jobs_ver tanpa menyentuh unit/pembayaran lain."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_cas_ep")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    jobs = [{"id": f"j{i}", "project_id": "p1", "nopol": f"B{i}", "vehicle_type": "X", "asal_kota": "A", "tujuan_kota": "B", "total_harga": 1_000_000,
             "tanggal": "2026-06-01", "tambahan": [], "payments": []} for i in range(3)]
    jobs[2]["payments"] = [{"id": "keep", "amount": 300_000, "tanggal": "2026-06-02", "tipe": "transfer", "batch_id": "bk"}]
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "S", "projects": [{"id": "p1", "nama": "Projek 1", "status": "open"}], "jobs": jobs, "rekon_payments": []}))
    yield TestClient(server.app), db, run
    loop.close()


def D(db, run):
    return run(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def test_semua_endpoint_penulis_jobs_berfungsi_dan_menaikkan_versi(env):
    c, db, run = env
    ver = lambda: D(db, run).get("jobs_ver", 0)
    langkah = [
        ("pay manual", lambda: c.post("/api/admin/suppliers/s1/jobs/j0/payments", data={"amount": "100000", "tanggal": "2026-06-10", "tipe": "transfer"})),
        ("pay-batch", lambda: c.post("/api/admin/suppliers/s1/pay-batch", data={"job_ids": "j1", "amount": "250000", "tanggal": "2026-06-11"})),
        ("tag", lambda: c.patch("/api/admin/suppliers/s1/jobs/j0/tag", json={"tag": "Batch A"})),
        ("pajak", lambda: c.patch("/api/admin/suppliers/s1/jobs/j0/pajak", json={"ppn_enabled": True, "ppn_rate": 11.0})),
        ("selisih", lambda: c.patch("/api/admin/suppliers/s1/jobs/j0/selisih", json={"selisih_deal": 900000, "selisih_invoice": 1000000})),
        ("entity", lambda: c.patch("/api/admin/suppliers/s1/jobs/j0/entity", json={"entity_id": "cv-alyssa-trans"})),
        ("tambahan +", lambda: c.post("/api/admin/suppliers/s1/jobs/j0/tambahan", json={"label": "Tol", "amount": 5000})),
        ("potongan", lambda: c.post("/api/admin/suppliers/s1/jobs/j0/tambahan", json={"label": "Tiket", "amount": 1000, "jenis": "potongan"})),
        ("no-invoice", lambda: c.patch("/api/admin/suppliers/s1/no-invoice", json={"job_ids": ["j1"], "no_invoice": "INV-9"})),
        ("tambah unit", lambda: c.post("/api/admin/suppliers/s1/jobs", json={"vehicle_type": "Baru", "nopol": "N 1 A", "total_harga": 5})),
    ]
    prev = ver()
    for nama, fn in langkah:
        r = fn()
        assert r.status_code == 200, (nama, r.status_code, r.text[:200])
        assert ver() > prev, f"{nama}: jobs_ver harus naik"
        prev = ver()
    d = D(db, run)
    j0 = next(j for j in d["jobs"] if j["id"] == "j0")
    assert j0["tag"] == "Batch A" and j0["ppn_enabled"] is True and j0["entity_id"] == "cv-alyssa-trans"
    assert [t["amount"] for t in j0["tambahan"]] == [5000, -1000] and len(j0["payments"]) == 1
    assert next(j for j in d["jobs"] if j["id"] == "j1")["no_invoice_supplier"] == "INV-9"
    assert next(j for j in d["jobs"] if j["id"] == "j2")["payments"][0]["id"] == "keep"        # unit lain & pembayaran lama tak tersentuh
    # hapus: tambahan, pembayaran, transaksi, unit
    tid = j0["tambahan"][0]["id"]; pid = j0["payments"][0]["id"]
    assert c.delete(f"/api/admin/suppliers/s1/jobs/j0/tambahan/{tid}").status_code == 200
    assert c.delete(f"/api/admin/suppliers/s1/jobs/j0/payments/{pid}").status_code == 200
    j1 = next(j for j in D(db, run)["jobs"] if j["id"] == "j1")
    assert c.delete(f"/api/admin/suppliers/s1/payments/{j1['payments'][0]['batch_id']}").status_code == 200
    assert c.delete("/api/admin/suppliers/s1/jobs/j1").status_code == 200
    d = D(db, run)
    assert [j["id"] for j in d["jobs"] if j["id"].startswith("j")] == ["j0", "j2"] and d["jobs"][1]["payments"][0]["id"] == "keep"
    assert c.get("/api/admin/suppliers/s1").status_code == 200


def test_versi_basi_tidak_menimpa(env, monkeypatch):
    """Penulis yang membaca versi lama ditolak (CAS), bukan menimpa."""
    c, db, run = env
    async def uji():
        await server._jobs_commit("s1", 0, {"jobs": [{"id": "x"}]})       # baru: tulis dengan ver=0 -> bukan versi sekarang (field belum ada)
    with pytest.raises(server.JobsConflict):
        run(uji())
    assert len(D(db, run)["jobs"]) == 3
