"""Tab Selesai: sembunyikan/kembalikan unit lunas. Hanya field aditif yang berubah; nominal, pembayaran, alokasi, total & sisa tetap."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_selesai")
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
    doc = {"id": "s1", "nama": "S", "projects": [],
           "rekon_payments": [{"id": "r1", "amount": 5_000_000, "tanggal": "2026-11-01", "status": "active", "allocations": [{"job_id": "j1", "amount": 5_000_000}]}],
           "jobs": [{"id": "j1", "nopol": "B1", "total_harga": 5_000_000, "tanggal": "2026-11-01", "payments": []},
                    {"id": "j2", "nopol": "B2", "total_harga": 3_000_000, "tanggal": "2026-11-02", "payments": [{"id": "p", "amount": 1_000_000, "tanggal": "2026-11-03", "tipe": "transfer"}]}]}
    loop.run_until_complete(db.supplier_profiles.insert_one(copy.deepcopy(doc)))
    yield TestClient(server.app), db, loop, doc
    loop.close()


def _keuangan(d):
    # project_id diisi otomatis oleh GET supplier lama (migrasi lazy yang sudah ada), bukan oleh endpoint ini -> diabaikan.
    jobs = [{k: v for k, v in j.items() if k != "project_id"} for j in d["jobs"]]
    return {"jobs": jobs, "rekon_payments": d["rekon_payments"]}


def test_sembunyikan_dan_kembalikan_tidak_mengubah_data_keuangan(env):
    c, db, loop, awal = env
    r = c.post("/api/admin/suppliers/s1/selesai/sembunyikan", json={"job_ids": ["j1"]})
    assert r.status_code == 200 and [e["job_id"] for e in r.json()["selesai_sembunyi"]] == ["j1"]
    d = loop.run_until_complete(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))
    assert _keuangan(d) == _keuangan(awal)                       # nominal/pembayaran/alokasi persis sama
    got = c.get("/api/admin/suppliers/s1").json()
    assert [e["job_id"] for e in got["selesai_sembunyi"]] == ["j1"] and got["grand_total_harga"] == 8_000_000
    # idempoten + kembalikan
    c.post("/api/admin/suppliers/s1/selesai/sembunyikan", json={"job_ids": ["j1"]})
    assert len(c.get("/api/admin/suppliers/s1").json()["selesai_sembunyi"]) == 1
    r = c.post("/api/admin/suppliers/s1/selesai/kembalikan", json={"job_ids": ["j1"]})
    assert r.json()["selesai_sembunyi"] == []
    d = loop.run_until_complete(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))
    assert _keuangan(d) == _keuangan(awal)


def test_unit_tidak_dikenal_atau_kosong_ditolak(env):
    c, *_ = env
    assert c.post("/api/admin/suppliers/s1/selesai/sembunyikan", json={"job_ids": ["xx"]}).status_code == 400
    assert c.post("/api/admin/suppliers/s1/selesai/sembunyikan", json={"job_ids": []}).status_code == 400
    assert c.post("/api/admin/suppliers/nope/selesai/sembunyikan", json={"job_ids": ["j1"]}).status_code == 404
