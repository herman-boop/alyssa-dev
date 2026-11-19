"""Penawaran arsip -> nama pelanggan + riwayat harga di Kalkulator HPP."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_ps")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import penawaran_simpan as ps
import server

UNITS = [{"rute": "Jakarta → Medan", "moda": "-", "tipe_kendaraan": "Innova Zenix G Hybrid CVT", "harga_deal": 8500000},
         {"rute": "Jakarta → Palembang", "moda": "Self Drive", "tipe_kendaraan": "Innova Zenix G Hybrid CVT", "harga_deal": 7000000},
         {"rute": "Jakarta → Tual", "moda": "", "tipe_kendaraan": "Veloz", "harga_deal": 0},           # tanpa harga
         {"rute": "", "moda": "", "tipe_kendaraan": "X", "harga_deal": 1000}]                          # tanpa rute


def test_bangun_entri_moda_harga_dan_kembar():
    e, lewat = ps.bangun_entri(UNITS, "Kapal Laut", [])
    assert [(x["rute"], x["moda"], x["harga_deal"]) for x in e] == [("Jakarta → Medan", "Kapal Laut", 8500000), ("Jakarta → Palembang", "Self Drive", 7000000)]
    assert lewat == 2
    ada = [{"rute": "jakarta → medan", "tipe_kendaraan": "innova zenix g hybrid cvt", "moda": "Kapal Laut", "harga_deal": 8500000}]
    e2, lewat2 = ps.bangun_entri(UNITS, "Kapal Laut", ada)
    assert len(e2) == 1 and lewat2 == 3                                        # Medan kembar dilewati


@pytest.fixture()
def env(monkeypatch):
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", mdb)
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    run(mdb.doc_history.insert_one({"id": "DOC-1", "jenis": "penawaran", "no_dokumen": "PH0255", "customer": "", "judul": "- · 4 rute · Opsi Harga",
                                    "meta": {"nama_pt": "", "mode": "draft"}, "units": [dict(u) for u in UNITS]}))
    run(mdb.doc_history.insert_one({"id": "DOC-2", "jenis": "invoice", "no_dokumen": "INV", "units": []}))
    return mdb, run, TestClient(server.app)


def test_simpan_pelanggan_baru_dan_arsip_diperbarui(env):
    mdb, run, c = env
    r = c.post("/api/admin/doc-history/DOC-1/simpan-ke-kalkulator", json={"nama_pt": "  pt sahabat  multi logistik ", "moda": "Kapal Laut"})
    assert r.status_code == 200
    j = r.json()
    assert j["baru"] is True and j["ditambah"] == 2 and j["dilewati"] == 2 and j["nama_pt"] == "pt sahabat multi logistik"
    prof = run(mdb.pelanggan_profiles.find_one({"id": j["pelanggan_id"]}))
    assert [(h["rute"], h["moda"], h["harga_deal"]) for h in prof["harga_history"]] == [("Jakarta → Medan", "Kapal Laut", 8500000), ("Jakarta → Palembang", "Self Drive", 7000000)]
    d = run(mdb.doc_history.find_one({"id": "DOC-1"}))
    assert d["customer"] == "pt sahabat multi logistik" and d["meta"]["nama_pt"] == "pt sahabat multi logistik"
    assert d["judul"].startswith("pt sahabat multi logistik · 4 rute") and d["units"][0]["moda"] == "Kapal Laut" and d["units"][1]["moda"] == "Self Drive"


def test_simpan_dua_kali_tidak_menggandakan(env):
    mdb, run, c = env
    c.post("/api/admin/doc-history/DOC-1/simpan-ke-kalkulator", json={"nama_pt": "PT X", "moda": "Kapal Laut"})
    r = c.post("/api/admin/doc-history/DOC-1/simpan-ke-kalkulator", json={"nama_pt": "pt x", "moda": "Kapal Laut"})     # nama sama beda huruf
    j = r.json()
    assert j["baru"] is False and j["ditambah"] == 0
    assert run(mdb.pelanggan_profiles.count_documents({})) == 1


def test_validasi(env):
    mdb, run, c = env
    assert c.post("/api/admin/doc-history/DOC-1/simpan-ke-kalkulator", json={"nama_pt": "  "}).status_code == 400
    assert c.post("/api/admin/doc-history/NONE/simpan-ke-kalkulator", json={"nama_pt": "PT X"}).status_code == 404
    assert c.post("/api/admin/doc-history/DOC-2/simpan-ke-kalkulator", json={"nama_pt": "PT X"}).status_code == 400
