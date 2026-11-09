"""Ekspor Excel Rekap Supplier: angka sama dengan laporan Finance di layar; hanya baca."""
import os, sys, asyncio, io
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_export")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi"); pytest.importorskip("openpyxl")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
from openpyxl import load_workbook
import server


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    doc = {"id": "s1", "nama": "AHMAD TAUFDIQ", "projects": [],
           "jobs": [{"id": "j1", "nopol": "S 8625 HN", "vehicle_type": "Tronton", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "total_harga": 12_000_000,
                     "tanggal": "2026-06-20", "no_invoice_supplier": "INV-1", "import_batch_no": "IMP-20261109-AAAAA",
                     "payments": [{"id": "p1", "amount": 5_000_000, "tanggal": "2026-07-05", "tipe": "transfer", "batch_id": "b1", "no_referensi": "REF1"}]},
                    {"id": "j2", "no_rangka": "121252", "vehicle_type": "Grand Max", "asal_kota": "Surabaya", "tujuan_kota": "Lembar", "total_harga": 2_300_000,
                     "tanggal": "2026-06-28", "payments": []}],
           "rekon_payments": [{"id": "r1", "amount": 3_000_000, "tanggal": "2026-07-06", "status": "active", "allocations": [], "rekon": {"referensi_bank": "BCA1"}}]}
    loop.run_until_complete(db.supplier_profiles.insert_one(doc))
    yield TestClient(server.app), db, loop
    loop.close()


def test_excel_berisi_angka_yang_sama_dengan_layar_dan_tidak_mengubah_data(env):
    c, db, loop = env
    awal = loop.run_until_complete(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))
    fin = c.get("/api/admin/suppliers/s1/finance").json()
    r = c.get("/api/admin/suppliers/s1/ringkasan-excel")
    assert r.status_code == 200 and "spreadsheetml" in r.headers["content-type"] and ".xlsx" in r.headers["content-disposition"]
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ["Ringkasan", "Invoice", "Unit", "Riwayat Pembayaran", "Alokasi"]
    ring = {row[0].value: row[1].value for row in wb["Ringkasan"].iter_rows(min_row=5, max_row=11)}
    S = fin["ringkasan"]
    assert ring["Total Tagihan Supplier"] == S["tagihan"] == 14_300_000
    assert ring["Total Pembayaran"] == S["terbayar"] == 5_000_000 and ring["Sisa Tagihan"] == S["sisa"] == 9_300_000
    assert ring["Pembayaran Belum Dialokasikan"] == S["belum_dialokasikan"] == 3_000_000
    inv = [[c.value for c in row] for row in wb["Invoice"].iter_rows(min_row=5, values_only=False)]
    assert inv[0][0] == "INV-1" and inv[0][4] == 12_000_000 and inv[0][5] == 5_000_000 and inv[0][6] == 7_000_000
    assert any(x[0] == "Tanpa nomor invoice (Perlu Dilengkapi)" and x[4] == 2_300_000 for x in inv)
    assert inv[-1][0] == "TOTAL" and inv[-1][4] == 14_300_000
    unit = [[c.value for c in row] for row in wb["Unit"].iter_rows(min_row=5, values_only=False)]
    assert len(unit) == 2 and {u[5] for u in unit} <= {"IMP-20261109-AAAAA", None, ""} and "IMP-20261109-AAAAA" in {u[5] for u in unit}
    pay = [[c.value for c in row] for row in wb["Riwayat Pembayaran"].iter_rows(min_row=5, values_only=False)]
    assert sorted(p[4] for p in pay) == [3_000_000, 5_000_000]
    assert isinstance(ring["Total Tagihan Supplier"], int)          # angka, bukan teks
    akhir = loop.run_until_complete(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))
    assert {k: v for k, v in akhir.items() if k != "projects"} == {k: v for k, v in awal.items() if k != "projects"}   # hanya baca


def test_excel_cutoff_salah_ditolak_dan_supplier_tak_ada_404(env):
    c, *_ = env
    assert c.get("/api/admin/suppliers/s1/ringkasan-excel?cutoff=besok").status_code == 400
    assert c.get("/api/admin/suppliers/nope/ringkasan-excel").status_code == 404
