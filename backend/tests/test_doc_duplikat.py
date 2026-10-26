"""Nomor faktur dobel + label nama di Histori Dokumen."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import doc_duplikat as dd  # noqa: E402
import nama_kembar as nk  # noqa: E402
from test_nama_kembar import Coll, DB  # noqa: E402


def run(c):
    return asyncio.run(c)


def make():
    db = DB()
    mk = lambda i, no, t, pay=None, cust="PT. TRANSKON JAYA TBK.": {
        "id": i, "jenis": "invoice", "no_dokumen": no, "created_at": t, "customer": cust,
        "lines": [{"harga": 9000000, "qty": 1}] * 9, "payments": pay or [], "meta": {"customer_nama": cust, "stempel": "x" if i == "B" else ""}}
    db.c["doc_history"] = Coll([
        mk("A", "INV0171", "2026-10-19T16:10"), mk("B", "INV0171", "2026-10-22T01:53"), mk("C", "INV0171", "2026-10-26T14:53"),
        mk("D", "INV0186", "2026-10-26T13:04"),
        mk("E", "INV0200", "2026-10-20", pay=[{"amount": 5}]), mk("F", "INV0200", "2026-10-27"),
    ])
    return db


def test_list_dan_saran():
    g = {x["no_dokumen"]: x for x in run(dd.list_dups(make()))}
    assert set(g) == {"INV0171", "INV0200"}                       # INV0186 tunggal tidak ikut
    assert g["INV0171"]["saran_pertahankan"] == "C"               # tanpa pembayaran → terbaru
    assert g["INV0200"]["saran_pertahankan"] == "E"               # yang punya pembayaran dipertahankan
    assert g["INV0171"]["items"][0]["subtotal"] == 81000000


def test_pratinjau_lalu_terapkan_dengan_cadangan():
    db = make()
    p = run(dd.bereskan(db, "INV0171", dry_run=True))
    assert p["dihapus"] == 2 and len(db.c["doc_history"].docs) == 6
    run(dd.bereskan(db, "INV0171", keep_id="C", dry_run=False))
    left = {d["id"] for d in db.c["doc_history"].docs}
    assert left == {"C", "D", "E", "F"}
    assert {d["id"] for d in db.c[dd.DELETED].docs} == {"A", "B"}   # dipindah, bukan hilang
    try:
        run(dd.bereskan(db, "INV0171"))
        assert False
    except LookupError:
        pass


def test_pembayaran_tidak_boleh_hilang():
    db = make()
    try:
        run(dd.bereskan(db, "INV0200", keep_id="F", dry_run=False))   # E punya pembayaran, tidak boleh dihapus
        assert False
    except ValueError:
        pass
    assert len(db.c["doc_history"].docs) == 6
    try:
        run(dd.bereskan(db, "INV0171", keep_id="ZZZ"))
        assert False
    except ValueError:
        pass


def test_label_nama_histori_ikut_rapi_tanpa_ubah_isi_dokumen():
    db = make()
    db.c["doc_history"].docs[0]["customer"] = "PT.TRANSKON JAYA,TBK"
    db.c["doc_history"].docs[0]["meta"]["customer_nama"] = "PT.TRANSKON JAYA,TBK"
    g = run(nk.list_groups(db, "pelanggan"))
    assert g and g[0]["total_docs"] == 6
    res = run(nk.merge_group(db, "pttranskonjayatbk", "PT TRANSKON JAYA TBK", dry_run=False))
    assert res["dokumen_label_diubah"] >= 1
    d0 = db.c["doc_history"].docs[0]
    assert d0["customer"] == "PT TRANSKON JAYA TBK"                     # label daftar rapi
    assert d0["meta"]["customer_nama"] == "PT.TRANSKON JAYA,TBK"        # isi dokumen cetak tidak diubah
    assert d0["lines"][0]["harga"] == 9000000
