"""Daftar Harga: rute /admin/suppliers/pricelist tidak lagi tertangkap {supplier_id}; Daftar Harga JUAL dari invoice."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_pl")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server
import pricelist_jual as pj


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    return TestClient(server.app), db, loop.run_until_complete


def test_parse_ket_rute_dan_kendaraan():
    assert pj.parse_ket("Toyota Hilux B 1234 XYZ (Jakarta–Batam)<br>No. Rangka: MR0ABC") == ("Toyota Hilux B 1234 XYZ", "Jakarta", "Batam")
    assert pj.parse_ket("Kendaraan (Surabaya - Lombok)")[1:] == ("Surabaya", "Lombok")
    assert pj.parse_ket("Tanpa rute") == ("Tanpa rute", "", "")


def test_rows_dari_invoice_buang_asuransi_nol_dan_duplikat():
    inv = [
        {"id": "a", "no_dokumen": "INV1", "customer": "PT A", "created_at": "2026-11-01T00:00:00Z", "meta": {"tanggalInvoice": "2026-11-02"},
         "lines": [{"nama": "Jasa", "ket": "Hilux B 1 AA (Jakarta–Batam)", "qty": 1, "harga": 9300000},
                   {"nama": "Jasa", "ket": "Hilux B 1 AA (Jakarta–Batam)", "qty": 1, "harga": 9300000},      # dobel
                   {"nama": "Jasa", "ket": "Xenia (Jakarta–Medan)", "qty": 2, "harga": 0}]},               # harga 0
        {"id": "b", "no_dokumen": "INV2", "customer": "PT B", "created_at": "2026-10-01T00:00:00Z", "meta": {"asal_kota": "Surabaya", "tujuan_kota": "Kupang"},
         "lines": [{"nama": "Jasa Pengiriman", "ket": "Strada", "qty": 1, "harga": 6000000}]},              # rute dari meta
        {"id": "c", "no_dokumen": "INV3", "customer": "PT C", "meta": {"tipe": "asuransi"}, "lines": [{"nama": "Asuransi", "ket": "x (A–B)", "harga": 1000}]},
    ]
    r = pj.rows_from_invoices(inv)
    assert [(x["no_invoice"], x["rute"], x["harga"], x["tanggal"]) for x in r] == [
        ("INV1", "Jakarta → Batam", 9300000, "2026-11-02"), ("INV2", "Surabaya → Kupang", 6000000, "2026-10-01")]


def test_endpoint_harga_jual_baca_saja(env):
    c, db, run = env
    run(db.doc_history.insert_one({"id": "d1", "jenis": "invoice", "no_dokumen": "INV9", "customer": "PT Z", "created_at": "2026-11-05T00:00:00Z",
                                   "meta": {}, "lines": [{"nama": "Jasa", "ket": "Hilux (Jakarta–Batam)", "qty": 1, "harga": 9300000}]}))
    run(db.doc_history.insert_one({"id": "d2", "jenis": "jadwal", "no_dokumen": "J1", "lines": [{"harga": 5}]}))
    awal = run(db.doc_history.count_documents({}))
    r = c.get("/api/admin/doc-history-pricelist")
    assert r.status_code == 200 and [(x["rute"], x["harga"], x["customer"]) for x in r.json()["items"]] == [("Jakarta → Batam", 9300000, "PT Z")]
    assert run(db.doc_history.count_documents({})) == awal


def test_pricelist_supplier_tidak_lagi_404(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "AHMAD", "jobs": [
        {"id": "j1", "asal_kota": "Surabaya", "tujuan_kota": "Lombok", "total_harga": 2300000, "tanggal": "2026-07-20",
         "payments": [{"id": "p", "amount": 2300000}]},
        {"id": "j2", "asal_kota": "A", "tujuan_kota": "B", "total_harga": 1000, "tanggal": "2026-07-21", "payments": []}]}))
    r = c.get("/api/admin/suppliers/pricelist")
    assert r.status_code == 200, r.text
    assert [(x["rute"], x["harga"]) for x in r.json()["items"]] == [("Surabaya → Lombok", 2300000)]      # hanya yang lunas
    assert c.get("/api/admin/suppliers/tidak-ada").status_code == 404                                  # rute {supplier_id} tetap bekerja
