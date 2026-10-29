import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import belum_tagih as b


def po(oid, rk, st="NEW", cust="PT BRI Multifinance Indonesia"):
    return {"order_id": oid, "customer_nama": cust, "status": st, "created_at": "2026-10-01T00:00:00",
            "units": [{"no_rangka": rk, "nopol": "B1", "status_invoice": "Belum Ditagih"}]}


def test_hitung():
    orders = [po("O1", "MHKA1234567890"), po("O2", "MHKB9999999999"), po("O3", "MHKC1111111111", st="CANCELLED"),
              po("O4", "", ), po("O5", "XXX", cust="PT Lain"), po("O6", "MHKD2222222222")]
    inv = [{"jenis": "invoice", "customer": "BRI MULTIFINANCE INDONESIA", "order_ids": ["O4"],
            "lines": [{"ket": "Mobil rute A-B<br>No. Rangka: MHKA1234567890"}]},
           {"jenis": "invoice", "customer": "PT Lain", "order_ids": ["O6"], "lines": [{"ket": "No. Rangka: MHKD2222222222"}]}]
    rows, s = b.hitung(orders, inv, "BRI MULTIFINANCE")
    assert [r["order_id"] for r in rows] == ["O2", "O6"], rows
    assert s["unit_sudah_ditagih"] == 2 and s["invoice"] == 1
    x = b.ke_xlsx(rows, "t")
    assert x[:2] == b"PK"
