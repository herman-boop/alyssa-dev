"""Duplikat PO ke pelanggan lain."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_pod")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("fastapi"); pytest.importorskip("mongomock_motor")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import po_duplikat as pd
import server

ASAL = {"order_id": "ORD-A", "customer_nama": "PT RUNA PERSADA", "customer_hp": "0812", "asal_kota": "CIKARANG", "tujuan_kota": "MUSI BANYU ASIN",
        "status": "DISPATCHED", "trip_id": "T1", "driver_id": "DRV-1", "nama_driver": "Budi", "wa_status": "terkirim", "entity_id": "pt-alyssa",
        "units": [{"unit_id": "U1", "vehicle_type": "SIDE DUMP", "nopol": "B 1", "no_rangka": "R1", "status_perjalanan": "Selesai", "status_invoice": "Lunas", "nama_kapal": "KM X", "etd": "2026-11-01", "transit_hari": 3},
                  {"unit_id": "U2", "vehicle_type": "SIDE DUMP", "nopol": "B 2", "no_rangka": "R2"}]}


def _bikin(uids):
    n = iter(range(100))
    return pd.bangun_salinan(ASAL, set(uids), "PT VOLVO", "ORD-NEW", lambda: f"UNIT-{next(n)}", "now", "Belum Dijadwalkan", "Belum Ditagih")


def test_salinan_direset_dan_hanya_unit_terpilih():
    d = _bikin(["U2"])
    assert d["order_id"] == "ORD-NEW" and d["customer_nama"] == "PT VOLVO" and d["duplikat_dari"] == "ORD-A"
    assert [u["no_rangka"] for u in d["units"]] == ["R2"] and d["jumlah_unit"] == 1 and d["no_rangka"] == "R2"
    assert d["trip_id"] is None and d["status"] == "NEW" and "driver_id" not in d and "nama_driver" not in d
    assert d["units"][0]["unit_id"] != "U2" and d["units"][0]["status_invoice"] == "Belum Ditagih"
    assert d["asal_kota"] == "CIKARANG" and d["entity_id"] == "pt-alyssa" and d["wa_status"] != "terkirim"


def test_jadwal_ikut_status_direset_dan_asal_tak_berubah():
    d = _bikin(["U1"])
    u = d["units"][0]
    assert (u["nama_kapal"], u["etd"], u["transit_hari"]) == ("KM X", "2026-11-01", 3) and u["status_perjalanan"] == "Belum Dijadwalkan"
    assert ASAL["units"][0]["status_invoice"] == "Lunas" and ASAL["trip_id"] == "T1"


def test_unit_kosong_ambil_semua_dan_tak_ada_unit():
    assert _bikin([])["jumlah_unit"] == 2
    assert _bikin(["XX"]) is None


def test_endpoint_membuat_po_baru_di_admin_list(monkeypatch):
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", mdb)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(mdb.orders.insert_one(dict(ASAL)))
    run(mdb.orders.insert_one({**ASAL, "_id": None, "order_id": "ORD-B", "units": [{"unit_id": "U9", "vehicle_type": "SIDE DUMP", "no_rangka": "R9"}]}))
    c = TestClient(server.app)
    r = c.post("/api/admin/orders/duplikat", json={"items": [{"order_id": "ORD-A", "unit_id": "U1"}, {"order_id": "ORD-B", "unit_id": "U9"}], "customer_nama": "PT VOLVO"})
    assert r.status_code == 200, r.text
    j = r.json(); assert j["dibuat"] == 2 and j["unit"] == 2
    rows = run(mdb.orders.find({"customer_nama": "PT VOLVO"}, {"_id": 0}).to_list(10))
    assert len(rows) == 2 and {o["duplikat_dari"] for o in rows} == {"ORD-A", "ORD-B"}
    assert run(mdb.orders.count_documents({"customer_nama": "PT RUNA PERSADA"})) == 2   # PO asal utuh
    assert c.post("/api/admin/orders/duplikat", json={"items": [{"order_id": "NOPE"}], "customer_nama": "X"}).status_code == 404
    assert c.post("/api/admin/orders/duplikat", json={"items": [{"order_id": "ORD-A"}], "customer_nama": " "}).status_code == 400
