"""Konfirmasi Harga: deal vs invoice per unit -> Excel."""
import io, os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_kh")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("openpyxl"); pytest.importorskip("fastapi"); pytest.importorskip("mongomock_motor")
from openpyxl import load_workbook
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import konfirmasi_harga as kh
import server

O1 = {"order_id": "O1", "asal_kota": "JAKARTA", "tujuan_kota": "MEDAN", "units": [{"unit_id": "u1", "nopol": "B 9520 KAW", "no_rangka": "MHCPHR54CNJ516232", "vehicle_type": "MPV", "tipe_model": "Innova"}]}
O2 = {"order_id": "O2", "units": [{"unit_id": "a", "no_rangka": "YV2RP90D1TA381470"}, {"unit_id": "b", "no_rangka": "YV2RP90DXTA381483"}]}
INV = [{"no_dokumen": "INV-1", "order_ids": ["O1"], "lines": [{"ket": "MPV B 9520 KAW (JKT–MDN)<br>No. Rangka: MHCPHR54CNJ516232", "harga": 4500000, "qty": 1}]},
       {"no_dokumen": "INV-2", "order_ids": ["O2"], "lines": [{"ket": "SIDE DUMP No. Rangka: YV2RP90D1TA381470", "harga": 9000000}, {"ket": "SIDE DUMP No. Rangka: YV2RP90DXTA381483", "harga": 9500000}]}]


def test_hitung_dan_urutan():
    items = [{"order_id": "O1", "unit_id": "u1"}, {"order_id": "O2", "unit_id": "b"}, {"order_id": "O2", "unit_id": "a"}]
    r = kh.hitung(items, {"O1": O1, "O2": O2}, {"O1": 5000000, "O2": 18000000}, INV)
    assert [x["no"] for x in r] == [1, 2, 3]
    assert (r[0]["nopol"], r[0]["deal"], r[0]["invoice"]) == ("B 9520 KAW", 5000000, 4500000)
    assert (r[1]["nopol"], r[1]["deal"], r[1]["invoice"], r[1]["rata"]) == ("YV2RP90DXTA381483", 9000000, 9500000, True)   # nopol kosong -> no rangka
    assert r[2]["invoice"] == 9000000


def test_tanpa_data_kosong_bukan_nol_palsu():
    r = kh.hitung([{"order_id": "O3", "no_rangka": "ZZZ"}], {}, {}, INV)
    assert r[0]["deal"] == 0 and r[0]["invoice"] == 0


def test_cadangan_po_satu_unit_tanpa_rangka():
    o = {"order_id": "O9", "units": [{"unit_id": "x", "nopol": "D 1 A"}]}
    inv = [{"no_dokumen": "I9", "order_ids": ["O9"], "lines": [{"ket": "Jasa angkut", "harga": 3000000}]}]
    assert kh.hitung([{"order_id": "O9", "unit_id": "x"}], {"O9": o}, {}, inv)[0]["invoice"] == 3000000


def test_excel_selisih_rumus_dan_total():
    r = kh.hitung([{"order_id": "O1", "unit_id": "u1"}], {"O1": O1}, {"O1": 5000000}, INV)
    ws = load_workbook(io.BytesIO(kh.ke_xlsx(r, "PT X"))).active
    rows = [[c.value for c in row] for row in ws.iter_rows(min_row=3)]
    assert rows[0] == ["NO", "NO POL", "NO RANGKA", "TIPE UNIT", "ASAL", "TUJUAN", "HARGA DEAL", "HARGA INVOICE", "SELISIH"]
    assert rows[1][:8] == [1, "B 9520 KAW", "MHCPHR54CNJ516232", "MPV Innova", "JAKARTA", "MEDAN", 5000000, 4500000]
    assert rows[1][8] == '=IF(OR(G4="",H4=""),"",G4-H4)'
    assert rows[2][1] == "TOTAL" and rows[2][6] == "=SUM(G4:G4)" and rows[2][8] == "=SUM(I4:I4)"


def test_endpoint(monkeypatch):
    mdb = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", mdb)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(mdb.orders.insert_one(dict(O1))); run(mdb.trips.insert_one({"trip_id": "T1", "order_id": "O1", "finance": {"invoice_total": 5000000}}))
    run(mdb.doc_history.insert_one({"jenis": "invoice", **INV[0]}))
    c = TestClient(server.app)
    r = c.post("/api/admin/konfirmasi-harga/xlsx", json={"items": [{"order_id": "O1", "unit_id": "u1"}], "judul": "PT X"})
    assert r.status_code == 200 and r.content[:2] == b"PK"
    ws = load_workbook(io.BytesIO(r.content)).active
    assert [ws.cell(row=4, column=k).value for k in (1, 2, 5, 6, 7, 8)] == [1, "B 9520 KAW", "JAKARTA", "MEDAN", 5000000, 4500000]
    assert c.post("/api/admin/konfirmasi-harga/xlsx", json={"items": []}).status_code == 400
