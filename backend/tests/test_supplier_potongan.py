"""Potongan per unit (uang tiket yang sudah diambil driver): mengurangi Total & Sisa, tidak menyentuh pembayaran."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_potongan")
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
    doc = {"id": "s1", "nama": "S", "projects": [], "rekon_payments": [],
           "jobs": [{"id": "j1", "nopol": "B1", "total_harga": 12_000_000, "tanggal": "2026-11-08", "tambahan": [],
                     "payments": [{"id": "p1", "amount": 1_000_000, "tanggal": "2026-11-08", "tipe": "transfer"}]}]}
    loop.run_until_complete(db.supplier_profiles.insert_one(doc))
    yield TestClient(server.app), db, loop
    loop.close()


def test_potongan_mengurangi_total_dan_sisa_pembayaran_tetap(env):
    c, db, loop = env
    r = c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "Uang tiket driver", "amount": 500_000, "jenis": "potongan"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["total_harga"] == 11_500_000 and j["sisa"] == 10_500_000 and j["total_terbayar"] == 1_000_000
    assert j["harga_deal"] == 12_000_000                      # harga deal awal tetap
    d = loop.run_until_complete(db.supplier_profiles.find_one({"id": "s1"}))
    assert d["jobs"][0]["payments"][0]["amount"] == 1_000_000 and d["jobs"][0]["tambahan"][0]["amount"] == -500_000


def test_tambahan_biasa_tetap_menambah_dan_nominal_negatif_ditolak(env):
    c, _db, _l = env
    r = c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "BBM", "amount": 900_000})
    assert r.json()["total_harga"] == 12_900_000
    assert c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "x", "amount": -100}).status_code == 400


def test_potongan_melebihi_total_ditolak_dan_bisa_dihapus(env):
    c, _db, _l = env
    assert c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "x", "amount": 13_000_000, "jenis": "potongan"}).status_code == 400
    r = c.post("/api/admin/suppliers/s1/jobs/j1/tambahan", json={"label": "tiket", "amount": 500_000, "jenis": "potongan"})
    tid = None
    from_db = c.get("/api/admin/suppliers/s1").json()["jobs"][0]["tambahan"]
    tid = from_db[0]["id"]
    assert c.delete(f"/api/admin/suppliers/s1/jobs/j1/tambahan/{tid}").status_code == 200
    assert c.get("/api/admin/suppliers/s1").json()["jobs"][0]["total_harga"] == 12_000_000
