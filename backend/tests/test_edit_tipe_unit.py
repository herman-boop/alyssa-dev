"""Edit tipe satu unit di PO (vehicle_type + tipe_model)."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_etu")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server


def _unit(uid, vt="SIDE DUMP", tm=""):
    return {"unit_id": uid, "vehicle_type": vt, "tipe_model": tm, "no_rangka": "R" + uid, "nopol": "B " + uid}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(db.orders.insert_one({"order_id": "O1", "customer_nama": "PT X", "vehicle_type": "SIDE DUMP", "units": [_unit("U1")]}))
    run(db.orders.insert_one({"order_id": "O2", "customer_nama": "PT X", "units": [_unit("A", tm="LAMA"), _unit("B", tm="TETAP")]}))
    yield TestClient(server.app), db, run
    loop.close()


def test_ubah_tipe_po_satu_unit_ikut_field_legacy(env):
    c, db, run = env
    r = c.patch("/api/admin/orders/O1", json={"unit_id": "U1", "unit_tipe_model": "  FH16 + SDT 85 "})
    assert r.status_code == 200, r.text
    o = run(db.orders.find_one({"order_id": "O1"}))
    assert o["units"][0]["tipe_model"] == "FH16 + SDT 85" and o["tipe_model"] == "FH16 + SDT 85" and o["units"][0]["vehicle_type"] == "SIDE DUMP"
    assert o["units"][0]["no_rangka"] == "RU1"


def test_po_banyak_unit_hanya_unit_terpilih(env):
    c, db, run = env
    assert c.patch("/api/admin/orders/O2", json={"unit_id": "A", "unit_tipe_model": "FH16"}).status_code == 200
    o = run(db.orders.find_one({"order_id": "O2"}))
    assert [u["tipe_model"] for u in o["units"]] == ["FH16", "TETAP"] and "tipe_model" not in o


def test_ganti_vehicle_type_validasi(env):
    c, db, run = env
    assert c.patch("/api/admin/orders/O1", json={"unit_id": "U1", "unit_vehicle_type": "NGAWUR-XYZ"}).status_code == 400
    assert c.patch("/api/admin/orders/O1", json={"unit_id": "NOPE", "unit_tipe_model": "x"}).status_code == 404
    assert run(db.orders.find_one({"order_id": "O1"}))["units"][0]["vehicle_type"] == "SIDE DUMP"
