"""Link tugas menampilkan nama driver/petugas yang dipilih admin di input leg (live), bukan hanya snapshot."""
import task_rules as TR


def _t(**k):
    return {"tipe_tugas": "driver_tujuan", "route_leg_id": "R1", "leg_index": 0, "petugas_nama": "", **k}


def test_nama_dari_leg_live_mengalahkan_snapshot():
    legs = [{"route_leg_id": "R1", "driver": "BUDI SANTOSO"}]
    assert TR.nama_petugas(legs, _t(petugas_nama="LAMA")) == "BUDI SANTOSO"


def test_link_dibuat_sebelum_driver_dipilih_tetap_dapat_nama():
    legs = [{"route_leg_id": "R1", "driver": "KUSTRIYANTO"}]
    assert TR.nama_petugas(legs, _t()) == "KUSTRIYANTO"


def test_cadangan_snapshot_lalu_nama_driver_trip():
    assert TR.nama_petugas([{"route_leg_id": "R1"}], _t(petugas_nama="SNAP")) == "SNAP"
    assert TR.nama_petugas([{"route_leg_id": "R1"}], _t(), "DRV TRIP") == "DRV TRIP"
    assert TR.nama_petugas([], _t(tipe_tugas="pelabuhan_asal"), "DRV TRIP") == ""   # nama driver trip hanya utk peran driver


def test_peran_kapal_pakai_koordinator_kapal():
    legs = [{"route_leg_id": "R1", "driver": "X", "kord_kapal": "PAK KORD"}]
    assert TR.nama_petugas(legs, _t(tipe_tugas="kapal")) == "PAK KORD"
    assert TR.nama_petugas(legs, _t(tipe_tugas="driver_asal")) == "X"


def test_cocok_leg_lewat_index_bila_tanpa_route_leg_id():
    legs = [{"driver": "A"}, {"driver": "B"}]
    assert TR.nama_petugas(legs, {"tipe_tugas": "driver_full", "leg_index": 1}) == "B"


def test_leg_rombongan_pakai_daftar_driver_bukan_supplier():
    sup = [{"route_leg_id": "R1", "kepala_rombongan": {"nama": "PT SUPPLIER X"}}]        # blok SUPPLIER bukan nama driver
    assert TR.nama_petugas(sup, _t()) == ""
    dr = [{"route_leg_id": "R1", "kepala_rombongan": {"nama": "PT SUPPLIER X"},
           "drivers": [{"driver": "Andi"}, {"driver": "ANDI"}, {"driver": "Budi"}, {"driver": "Citra"}, {"driver": "Dedi"}]}]
    assert TR.nama_petugas(dr, _t()) == "Andi, Budi, Citra +1"
    assert TR.nama_petugas(dr, _t(tipe_tugas="kapal")) == ""      # peran kapal tidak memakai daftar driver
    assert TR.nama_petugas([{"route_leg_id": "R1", "driver": "SOLO", "drivers": [{"driver": "Z"}]}], _t()) == "SOLO"


# ── endpoint publik: nama di halaman link ikut leg ──
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_tn")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server


def test_endpoint_menampilkan_nama_driver_dari_leg(monkeypatch):
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", mdb)
    loop = asyncio.new_event_loop()
    loop.run_until_complete(mdb.trips.insert_one({"trip_id": "TRIP-1", "legs": [{"route_leg_id": "R1", "driver": "AMRAN HARAHAP", "status": "Berlangsung"}]}))
    loop.run_until_complete(mdb.leg_tasks.insert_one({"token": "tok1", "trip_id": "TRIP-1", "route_leg_id": "R1", "leg_index": 0,
                                                       "tipe_tugas": "driver_tujuan", "petugas_nama": "", "status": "belum_dibuka", "units": []}))
    r = TestClient(server.app).get("/api/public/task/tok1")
    assert r.status_code == 200 and r.json()["petugas_nama"] == "AMRAN HARAHAP"
