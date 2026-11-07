"""Uji API Finance Supplier dengan Mongo tiruan (mongomock-motor): memastikan endpoint hanya MENAMBAH
data (verifikasi, saldo supplier, nomor invoice) dan nominal/pembayaran historis tidak berubah."""
import os, sys, copy, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_sf")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor")
pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server


def _sup():
    pay = [{"id": "p1", "amount": 6_000_000, "tanggal": "2026-10-10", "tipe": "transfer", "batch_id": "b1", "no_referensi": "BCA-1"}]
    jobs = [
        {"id": "j1", "nopol": "B1111XYZ", "vehicle_type": "Avanza", "asal_kota": "Cikarang", "tujuan_kota": "Makassar", "total_harga": 10_000_000,
         "tanggal": "2026-10-02", "no_invoice_supplier": "INV-1", "payments": pay},
        {"id": "j2", "nopol": "B2222XYZ", "vehicle_type": "Rush", "asal_kota": "Cikarang", "tujuan_kota": "Makassar", "total_harga": 8_000_000,
         "tanggal": "2026-06-20", "payments": []},                                    # data lama: belum bernomor
        {"id": "j3", "nopol": "B3333XYZ", "vehicle_type": "Brio", "asal_kota": "Jakarta", "tujuan_kota": "Manado", "total_harga": 4_000_000,
         "tanggal": "2026-06-25", "payments": []},
    ]
    rps = [{"id": "r1", "amount": 9_000_000, "tanggal": "2026-10-20", "status": "active", "bank_transaction_id": "BTX1",
            "allocations": [{"job_id": "j1", "amount": 4_000_000}, {"job_id": "j2", "amount": 3_000_000}]}]
    return {"id": "s1", "nama": "CV Contoh", "jobs": jobs, "rekon_payments": rps, "projects": [], "created_at": "2026-01-01"}


@pytest.fixture()
def client(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    asyncio.get_event_loop_policy()
    loop = asyncio.new_event_loop()
    loop.run_until_complete(db.supplier_profiles.insert_one(_sup()))
    c = TestClient(server.app)
    c.loop, c.db = loop, db
    yield c
    loop.close()


def raw(c):
    return c.loop.run_until_complete(c.db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def test_finance_ringkasan_konsisten_dengan_angka_existing(client):
    r = client.get("/api/admin/suppliers/s1/finance?cutoff=2026-10-31")
    assert r.status_code == 200, r.text
    d = r.json()
    existing = client.get("/api/admin/suppliers/s1").json()
    assert d["ringkasan"]["tagihan"] == sum(j["net_transfer"] for j in existing["jobs"]) == 22_000_000
    assert d["ringkasan"]["terbayar"] == existing["grand_total_terbayar"] == 13_000_000      # 6jt manual + 7jt alokasi rekon
    assert d["ringkasan"]["sisa"] == existing["grand_sisa"]
    assert d["ringkasan"]["transfer_aktual"] == 15_000_000 and d["ringkasan"]["belum_dialokasikan"] == 2_000_000
    assert d["perlu_dilengkapi"]["unit"] == 2 and d["rekonsiliasi"]["status"] == "belum_direkonsiliasi"
    assert d["rekonsiliasi"]["selisih"] is None


def test_saldo_supplier_lalu_rekonsiliasi_selisih(client):
    r = client.post("/api/admin/suppliers/s1/saldo-supplier", data={"cutoff": "2026-10-31", "saldo": "7000000", "catatan": "laporan supplier 1 Nov"})
    assert r.status_code == 200, r.text
    d = client.get("/api/admin/suppliers/s1/finance?cutoff=2026-10-31").json()["rekonsiliasi"]
    assert d["saldo_alyssa"] == 22_000_000 - 13_000_000 == 9_000_000
    assert d["status"] == "selisih" and d["selisih"] == 2_000_000


def test_verifikasi_butuh_alasan_riwayat_dan_tidak_ubah_angka(client):
    before = raw(client)
    r = client.patch("/api/admin/suppliers/s1/verifikasi-transfer", data={"key": "rk:r1", "status": "menunggu_konfirmasi"})
    assert r.status_code == 400
    r = client.patch("/api/admin/suppliers/s1/verifikasi-transfer", data={"key": "rk:r1", "status": "menunggu_konfirmasi", "catatan": "kirim bukti ke supplier"})
    assert r.status_code == 200, r.text
    r = client.patch("/api/admin/suppliers/s1/verifikasi-transfer", data={"key": "tx:tidakada", "status": "ada_selisih", "catatan": "xxxxxxxxx"})
    assert r.status_code == 404
    after = raw(client)
    assert after["jobs"] == before["jobs"] and after["rekon_payments"] == before["rekon_payments"]      # tidak ada angka berubah
    tr = {t["key"]: t for t in client.get("/api/admin/suppliers/s1/finance").json()["transfers"]}
    assert tr["rk:r1"]["verifikasi"] == "menunggu_konfirmasi" and len(tr["rk:r1"]["verifikasi_riwayat"]) == 1
    assert tr["tx:b1"]["verifikasi"] == "belum_diverifikasi"                                              # 'diterima' bukan verifikasi


def test_lengkapi_nomor_invoice_lama_hanya_ubah_nomor(client):
    before = raw(client)
    r = client.patch("/api/admin/suppliers/s1/no-invoice", json={"job_ids": ["j2", "j3"], "no_invoice": "SPL/06/2026"})
    assert r.status_code == 200 and r.json()["diubah"] == 2, r.text
    after = raw(client)
    for b, a in zip(before["jobs"], after["jobs"]):
        for f in ("total_harga", "payments", "tanggal", "nopol", "tambahan"):
            assert a.get(f) == b.get(f), f                                                              # nominal & pembayaran tidak berubah
    assert after["jobs"][1]["no_invoice_supplier"] == "SPL/06/2026" and after["no_invoice_riwayat"][0]["dari"] == "" and after["no_invoice_riwayat"][0]["job_id"] == "j2"
    assert after["rekon_payments"] == before["rekon_payments"]
    d = client.get("/api/admin/suppliers/s1/finance").json()
    assert d["perlu_dilengkapi"]["unit"] == 0 and len(d["invoices"]) == 2
    # tidak boleh menimpa nomor yang sudah ada tanpa konfirmasi
    r = client.patch("/api/admin/suppliers/s1/no-invoice", json={"job_ids": ["j1"], "no_invoice": "LAIN"})
    assert r.status_code == 400


def test_cari_unit(client):
    r = client.get("/api/admin/suppliers/s1/cari-unit?kosong=true&dari=2026-06-01&sampai=2026-06-22").json()
    assert [x["id"] for x in r["items"]] == ["j2"]
    r = client.get("/api/admin/suppliers/s1/cari-unit?nominal=4000000").json()
    assert [x["id"] for x in r["items"]] == ["j3"]
    r = client.get("/api/admin/suppliers/s1/cari-unit?q=3333").json()
    assert [x["id"] for x in r["items"]] == ["j3"]


def test_nomor_dipakai_supplier_lain_butuh_konfirmasi(client):
    other = _sup(); other["id"] = "s2"; other["nama"] = "CV Lain"; other["jobs"][0]["id"] = "z1"
    other["jobs"][0]["no_invoice_supplier"] = "SPL/06/2026"
    client.loop.run_until_complete(client.db.supplier_profiles.insert_one(other))
    r = client.patch("/api/admin/suppliers/s1/no-invoice", json={"job_ids": ["j2"], "no_invoice": "spl/06/2026"})
    assert r.status_code == 409
    r = client.patch("/api/admin/suppliers/s1/no-invoice", json={"job_ids": ["j2"], "no_invoice": "spl/06/2026", "konfirmasi_duplikat": True})
    assert r.status_code == 200
    d = client.get("/api/admin/suppliers/s1/finance").json()
    assert any("supplier lain" in " ".join(i["duplikat"]) for i in d["invoices"])


def test_pdf_503_bila_chromium_belum_siap(client, monkeypatch):
    monkeypatch.setattr(server, "_browser", None)
    assert client.get("/api/admin/suppliers/s1/ringkasan-pdf").status_code == 503
