"""Upload permintaan harga: baca Excel/CSV, cocokkan HPP, tulis Excel hasil."""
import io, os, sys
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_ph")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("openpyxl"); pytest.importorskip("fastapi")
from openpyxl import Workbook, load_workbook
from fastapi.testclient import TestClient
import permintaan_harga as ph
import server


def _xlsx(rows, header=("No.", "Tipe Kendaraan", "Lokasi Pengambilan", "Lokasi Pengiriman", "Biaya Pengiriman"), judul=True):
    wb = Workbook(); ws = wb.active
    if judul:
        ws.append(["PERMINTAAN HARGA"]); ws.append([])
    ws.append(list(header))
    for r in rows:
        ws.append(r)
    b = io.BytesIO(); wb.save(b)
    return b.getvalue()


def test_baca_xlsx_dengan_judul_dan_total():
    d = _xlsx([[1, "Innova Zenix G Hybrid CVT", "Jakarta", "Medan", None], [2, "Veloz V", "Jakarta", "Makasar", "Rp 1.500.000"], ["Total", "", "", "", ""]])
    r = ph.baca_xlsx(d)
    assert [x["tujuan"] for x in r] == ["Medan", "Makasar"]
    assert r[0]["harga"] == 0 and r[1]["harga"] == 1500000        # "Biaya Pengiriman" = harga, bukan tujuan


def test_baca_csv_titik_koma():
    r = ph.baca_csv("No;Tipe;Asal;Tujuan;Harga\n1;Hilux;Jakarta;Medan;2.000.000\n".encode())
    assert r == [{"no": "1", "tipe": "Hilux", "asal": "Jakarta", "tujuan": "Medan", "harga": 2000000}]


def test_header_tidak_ada_gagal_kosong():
    assert ph.parse_tabel([["a", "b"], [1, 2]]) == []


def test_cocokkan_kendaraan_lalu_rute_lalu_kosong():
    beli = [{"asal": "Jakarta", "tujuan": "Makassar", "vehicle_type": "Toyota Veloz Q", "harga": 3000000},
            {"asal": "Jakarta", "tujuan": "Medan", "vehicle_type": "Hilux", "harga": 5000000},
            {"asal": "jakarta", "tujuan": "Medan", "vehicle_type": "Innova Zenix", "harga": 6000000},
            {"asal": "jakarta", "tujuan": "Medan", "vehicle_type": "Innova Zenix", "harga": 8000000}]
    req = [{"tipe": "Veloz V Hybrid CVT", "asal": "Jakarta", "tujuan": "Makasar"},       # alias Makasar -> Makassar
           {"tipe": "Innova Zenix G Hybrid CVT", "asal": "Jakarta", "tujuan": "Medan"},
           {"tipe": "Fortuner", "asal": "Jakarta", "tujuan": "Medan"},
           {"tipe": "Innova", "asal": "Jakarta", "tujuan": "Ambon"}]
    m = ph.cocokkan(req, beli)
    assert (m[0]["cocok"], m[0]["hpp"]) == ("kendaraan", 3000000)
    assert (m[1]["cocok"], m[1]["hpp"], m[1]["n"]) == ("kendaraan", 7000000, 2)           # median 2 harga Innova
    assert (m[2]["cocok"], m[2]["n"]) == ("rute", 3)                                      # kendaraan beda -> median rute
    assert (m[3]["cocok"], m[3]["hpp"]) == ("", 0)


def test_ke_xlsx_kolom_biaya_terisi():
    d = ph.ke_xlsx([{"tipe": "Hilux", "asal": "Jakarta", "tujuan": "Medan", "harga": 2500000}, {"tipe": "X", "asal": "A", "tujuan": "B", "harga": 0}], "PT X")
    ws = load_workbook(io.BytesIO(d)).active
    vals = [[c.value for c in r] for r in ws.iter_rows(min_row=3)]
    assert vals[0] == ["No.", "Tipe Kendaraan", "Lokasi Pengambilan", "Lokasi Pengiriman", "Biaya Pengiriman"]
    assert vals[1][4] == 2500000 and vals[2][4] is None


def test_endpoint_unggah_dan_unduh(monkeypatch):
    async def fake_pl(limit=0):
        return {"items": [{"asal": "Jakarta", "tujuan": "Medan", "vehicle_type": "Hilux", "harga": 5000000}]}
    monkeypatch.setattr(server, "supplier_pricelist", fake_pl)
    c = TestClient(server.app)
    d = _xlsx([[1, "Hilux", "Jakarta", "Medan", None], [2, "Hilux", "Jakarta", "Ambon", None]])
    r = c.post("/api/admin/penawaran/permintaan-harga", files={"file": ("p.xlsx", d, "application/octet-stream")})
    assert r.status_code == 200
    j = r.json()
    assert j["total"] == 2 and j["cocok"] == 1 and j["tanpa_hpp"] == 1 and j["rows"][0]["hpp"] == 5000000
    r2 = c.post("/api/admin/penawaran/permintaan-harga/xlsx", json={"rows": [{"tipe": "Hilux", "asal": "Jakarta", "tujuan": "Medan", "harga": 6000000}], "judul": "PT X"})
    assert r2.status_code == 200 and r2.content[:2] == b"PK"
    assert c.post("/api/admin/penawaran/permintaan-harga", files={"file": ("a.txt", b"x", "text/plain")}).status_code == 400
    assert c.post("/api/admin/penawaran/permintaan-harga", files={"file": ("k.xlsx", _xlsx([], header=("a", "b")), "application/octet-stream")}).status_code == 422
