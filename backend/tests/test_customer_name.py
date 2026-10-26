"""Nama pelanggan tunggal: kunci penyamaan & tulisan resmi."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import customer_name as cn  # noqa: E402

VARIAN_TRANSKON = [
    "PT. Transkon Jaya, Tbk", "PT. TRANSKON JAYA,TBK", "PT.Transkon Jaya, TBK",
    "PT.TRANSKON JAYA,TBK", "pt transkon jaya tbk", "  PT   Transkon   Jaya  TBK ",
]


def test_semua_varian_satu_kunci_dan_satu_tulisan():
    assert len({cn.name_key(v) for v in VARIAN_TRANSKON}) == 1
    assert {cn.canon_display(v) for v in VARIAN_TRANSKON} == {"PT TRANSKON JAYA TBK"}


def test_beda_badan_usaha_tetap_beda():
    assert cn.name_key("PT Maju Jaya") != cn.name_key("CV Maju Jaya")
    assert cn.canon_display("CV. Maju Jaya") == "CV MAJU JAYA"


def test_tanda_baca_lain():
    assert cn.canon_display("PT. A.B.C Logistik & Sons") == "PT ABC LOGISTIK & SONS"
    assert cn.canon_display("") == "" and cn.name_key(None) == ""


def test_resolve_pakai_nama_master_bila_kunci_cocok():
    master = ["PT. Transkon Jaya, Tbk", "CV Lain"]
    assert cn.resolve("PTTRANSKON JAYA TBK", master) == "PT TRANSKON JAYA TBK"
    assert cn.resolve("PT.Transkon Jaya,TBK", []) == "PT TRANSKON JAYA TBK"
    assert cn.resolve("PT Baru Sekali", master) == "PT BARU SEKALI"
