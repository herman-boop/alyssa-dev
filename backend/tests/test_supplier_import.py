"""Impor invoice supplier: berhasil, duplikat, gagal di tengah proses, nominal salah, kecocokan PO, idempotensi.
Memakai kasus nyata AHMAD TAUFDIQ (10 unit, Rp45.600.000). Semua data uji ada di Mongo TIRUAN (bukan production)."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_import")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server
import supplier_import as SI

TAG = "TAGIHAN PENGIRIMAN JUNI–JULI 2026"


def kasus_rows():
    def r(tgl, vt, ident, asal, tuju, harga, tambahan=None, field="nopol"):
        return {"tanggal": tgl, "vehicle_type": vt, field: ident, "asal_kota": asal, "tujuan_kota": tuju, "harga_dasar": harga,
                "tambahan": tambahan or []}
    pick = [{"label": "Biaya pengambilan", "amount": 1_400_000}]
    return [
        r("2026-06-20", "Tronton Dump", "S 8625 HN", "Surabaya", "Makassar", 10_600_000, pick),
        r("2026-06-20", "Tronton Dump", "S 8614 HN", "Surabaya", "Makassar", 10_600_000, pick),
        r("2026-06-25", "Raize", "G 1037 NK", "Surabaya", "Makassar", 3_900_000),
        r("2026-06-28", "Grand Max", "121252", "Surabaya", "Lembar", 2_300_000, field="no_rangka"),
        r("2026-06-28", "Grand Max", "121258", "Surabaya", "Lembar", 2_300_000, field="no_rangka"),
        r("2026-06-28", "Grand Max", "121248", "Surabaya", "Lembar", 2_300_000, field="no_rangka"),
        r("2026-06-28", "Grand Max", "121251", "Surabaya", "Lembar", 2_300_000, field="no_rangka"),
        r("2026-06-30", "Terios", "B 2307 KRO", "Surabaya", "Makassar", 3_900_000),
        r("2026-07-01", "Veloz", "009503", "Surabaya", "Lombok", 2_300_000, field="no_rangka"),
        r("2026-07-03", "CR-V", "B 1089 EJF", "Surabaya", "Lombok", 2_300_000),
    ]


def body(**kw):
    b = {"key": "k-ahmad-1", "tag": TAG, "rows": kasus_rows(), "total_invoice": 45_600_000,
         "source": {"nama": "invoice-ahmad.pdf", "ukuran": 1234, "sha256": "a" * 64}}
    b.update(kw)
    return b


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "AHMAD TAUFDIQ", "projects": [], "jobs": [], "rekon_payments": []}))
    run(db.supplier_profiles.insert_one({"id": "s2", "nama": "SUPPLIER LAIN", "projects": [], "rekon_payments": [],
         "jobs": [{"id": "x1", "nopol": "B 2307 KRO", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "total_harga": 1, "payments": [], "tanggal": "2026-05-01"}]}))
    run(db.orders.insert_many([
        {"order_id": "PO-1", "customer_nama": "PT UT", "asal_kota": "Surabaya", "tujuan_kota": "Makassar",
         "units": [{"unit_id": "u1", "nopol": "S 8625 HN", "vehicle_type": "Tronton"}]},
        {"order_id": "PO-2", "customer_nama": "PT KCI", "asal_kota": "Surabaya", "tujuan_kota": "Lombok",
         "units": [{"unit_id": "u2", "no_rangka": "MHKA1234567009503", "vehicle_type": "Veloz"}]},
        {"order_id": "PO-3", "customer_nama": "PT X", "asal_kota": "Jakarta", "tujuan_kota": "Bandung",
         "units": [{"unit_id": "u3", "nopol": "B 2307 KRO", "vehicle_type": "Terios"}]},
    ]))
    yield TestClient(server.app), db, run
    loop.close()


def sup(db, run):
    return run(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def post(c, **kw):
    return c.post("/api/admin/suppliers/s1/import-invoice", json=body(**kw))


# ── Berhasil: kasus nyata AHMAD TAUFDIQ ─────────────────────────────────────
def test_impor_berhasil_kasus_ahmad_taufdiq(env):
    c, db, run = env
    r = post(c)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["jumlah_unit"] == 10 and j["total"] == 45_600_000 and j["sudah_diimpor"] is False
    assert j["batch_no"].startswith("IMP-")
    d = sup(db, run)
    assert len(d["jobs"]) == 10                                   # satu kendaraan = satu record unit
    api = c.get("/api/admin/suppliers/s1").json()                  # lewat perhitungan existing (tidak diubah)
    assert api["grand_total_harga"] == 45_600_000 and api["grand_total_terbayar"] == 0 and api["grand_sisa"] == 45_600_000
    for jb in api["jobs"]:
        assert jb["payments"] == [] and jb["status"] == "belum"   # tidak pernah otomatis lunas
        assert jb["no_invoice_supplier"] == ""                    # tidak ada nomor invoice palsu
        assert jb["import_batch_no"] == j["batch_no"] and jb["tag"] == TAG
    tr = [x for x in api["jobs"] if x["nopol"] in ("S 8625 HN", "S 8614 HN")]
    assert len(tr) == 2 and all(x["harga_deal"] == 10_600_000 and x["tambahan_total"] == 1_400_000 and x["total_harga"] == 12_000_000 for x in tr)
    assert sum(x["total_harga"] for x in tr) == 24_000_000
    gm = [x for x in api["jobs"] if x["vehicle_type"] == "Grand Max"]
    assert len(gm) == 4 and sum(x["total_harga"] for x in gm) == 9_200_000
    # identitas 6 digit: BUKAN noka lengkap -> perlu dikonfirmasi (Grand Max x4 + Veloz)
    lemah = [x for x in api["jobs"] if x["ident_status"] == "perlu_konfirmasi"]
    assert len(lemah) == 5 and {x["no_rangka"] for x in lemah} == {"121252", "121258", "121248", "121251", "009503"}
    assert all(x["nopol"] == "" for x in lemah)
    # riwayat impor: siapa, kapan, sumber file, hasil pencocokan
    e = d["import_riwayat"][0]
    assert e["status"] == "berhasil" and e["oleh"] and e["at"] and e["sumber"]["nama"] == "invoice-ahmad.pdf"
    assert e["jumlah_unit"] == 10 and e["perlu_konfirmasi"] == 5 and set(e["pencocokan"]) == {"cocok", "beda_rute", "kemungkinan", "tidak_ada"}
    h = c.get("/api/admin/suppliers/s1/import-riwayat").json()
    assert h["riwayat"][0]["batch_no"] == j["batch_no"] and h["gagal"] == []


# ── Idempoten ───────────────────────────────────────────────────────────────
def test_permintaan_diulang_tidak_menggandakan_tagihan(env):
    c, db, run = env
    a = post(c).json()
    b = post(c)
    assert b.status_code == 200 and b.json()["sudah_diimpor"] is True and b.json()["batch_no"] == a["batch_no"]
    assert b.json()["job_ids"] == a["job_ids"]
    assert len(sup(db, run)["jobs"]) == 10 and len(sup(db, run)["import_riwayat"]) == 1


def test_kunci_turunan_otomatis_bila_klien_tidak_mengirim_key(env):
    c, db, run = env
    b = body(); b.pop("key")
    r1 = c.post("/api/admin/suppliers/s1/import-invoice", json=b); r2 = c.post("/api/admin/suppliers/s1/import-invoice", json=b)
    assert r1.status_code == 200 and r2.json()["sudah_diimpor"] is True and len(sup(db, run)["jobs"]) == 10


# ── Duplikat ────────────────────────────────────────────────────────────────
def test_file_yang_sama_ditolak_dan_unit_dobel_ditolak(env):
    c, db, run = env
    assert post(c).status_code == 200
    r = post(c, key="k-lain")                                      # file sama, kunci beda
    assert r.status_code == 422 and any("sudah pernah diimpor" in x for x in r.json()["detail"]["errors"])
    r = post(c, key="k-lain2", source={"nama": "foto.jpg", "ukuran": 9, "sha256": "b" * 64})   # file beda, unit sama + rute sama
    errs = r.json()["detail"]["errors"]
    assert r.status_code == 422 and sum("duplikat" in x for x in errs) == 10
    assert len(sup(db, run)["jobs"]) == 10                         # tidak ada yang masuk
    # unit sama di RUTE BEDA bukan duplikat
    rows = kasus_rows()[:1]; rows[0]["tujuan_kota"] = "Lombok"
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "k3", "rows": rows, "source": {"sha256": "c" * 64}})
    assert r.status_code == 200 and len(sup(db, run)["jobs"]) == 11


def test_duplikat_dalam_satu_invoice_ditolak_kecuali_diizinkan(env):
    c, db, run = env
    rows = kasus_rows(); rows.append(copy.deepcopy(rows[2]))       # Raize G 1037 NK dua kali
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "d1", "rows": rows})
    assert r.status_code == 422 and any("baris 3" in x for x in r.json()["detail"]["errors"])
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "d2", "rows": rows, "izinkan_duplikat": [10]})
    assert r.status_code == 200 and r.json()["jumlah_unit"] == 11


# ── Gagal di tengah proses ──────────────────────────────────────────────────
def test_gagal_menyimpan_tidak_menyisakan_data_setengah_dan_aman_diulang(env, monkeypatch):
    c, db, run = env
    state = {"rusak": True}

    class Koleksi:
        def __init__(self, k): self._k = k
        def __getattr__(self, n): return getattr(self._k, n)
        async def update_one(self, filter, update, *a, **k):
            if state["rusak"] and "$push" in update and "jobs" in update["$push"]:
                raise RuntimeError("koneksi putus di tengah penyimpanan")
            return await self._k.update_one(filter, update, *a, **k)

    class Db:
        def __getattr__(self, n): return Koleksi(getattr(db, n)) if n == "supplier_profiles" else getattr(db, n)
    monkeypatch.setattr(server, "db", Db())
    r = post(c)
    assert r.status_code == 500 and "Tidak ada unit yang masuk" in r.json()["detail"]["pesan"]
    d = sup(db, run)
    assert d["jobs"] == [] and not d.get("import_riwayat")        # tidak ada unit, tidak ada catatan sukses
    assert d["import_gagal"][0]["status"] == "gagal"              # error tercatat
    state["rusak"] = False                                         # koneksi pulih -> ulangi dengan kunci sama
    r = post(c)
    assert r.status_code == 200 and r.json()["sudah_diimpor"] is False
    d = sup(db, run)
    assert len(d["jobs"]) == 10 and len(d["import_riwayat"]) == 1


# ── Nominal salah ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("ubah,kata", [
    (lambda b: b.update(total_invoice=45_000_000), "tidak sama dengan total invoice"),
    (lambda b: b["rows"][2].update(harga_dasar=-5), "negatif"),
    (lambda b: b["rows"][2].update(harga_dasar=39_000_000_000), "tidak wajar"),
    (lambda b: b["rows"][2].update(tanggal="25-06-2026"), "tanggal"),
    (lambda b: b["rows"][0].update(tambahan=[{"label": "x", "amount": -1}]), "biaya tambahan"),
    (lambda b: b["rows"][3].update(no_rangka="", nopol="", vehicle_type=""), "identitas kendaraan kosong"),
])
def test_nominal_atau_data_salah_ditolak_tanpa_menyimpan(env, ubah, kata):
    c, db, run = env
    b = body(); ubah(b)
    r = c.post("/api/admin/suppliers/s1/import-invoice", json=b)
    assert r.status_code == 422 and any(kata in x for x in r.json()["detail"]["errors"]), r.text
    d = sup(db, run)
    assert d["jobs"] == [] and not d.get("import_riwayat")
    assert d["import_gagal"][0]["status"] == "ditolak"


def test_selisih_total_boleh_dilewati_dengan_konfirmasi_eksplisit(env):
    c, db, run = env
    r = post(c, total_invoice=45_000_000, izinkan_selisih_total=True)
    assert r.status_code == 200 and r.json()["total"] == 45_600_000


# ── Kecocokan PO ────────────────────────────────────────────────────────────
def test_kecocokan_po_identitas_rute_dan_sebagian(env):
    c, db, run = env
    r = post(c)
    assert r.status_code == 200
    jobs = {x["no_rangka"] or x["nopol"]: x for x in sup(db, run)["jobs"]}
    assert jobs["S 8625 HN"]["order_id"] == "PO-1" and jobs["S 8625 HN"]["po_status"] == "cocok"
    assert jobs["B 2307 KRO"]["po_status"] == "cocok_beda_rute" and jobs["B 2307 KRO"]["order_id"] == "PO-3"
    assert jobs["009503"]["po_status"] == "kemungkinan" and jobs["009503"]["order_id"] is None     # hanya 6 digit: tidak ditautkan otomatis
    assert jobs["G 1037 NK"]["po_status"] == "tidak_ada"
    pc = sup(db, run)["import_riwayat"][0]["pencocokan"]
    assert pc == {"cocok": 1, "beda_rute": 1, "kemungkinan": 1, "tidak_ada": 7}
    assert any("hanya cocok sebagian" in w for w in r.json()["peringatan"])


def test_kecocokan_sebagian_ditautkan_hanya_setelah_dikonfirmasi(env):
    c, db, run = env
    r = post(c, konfirmasi_po=[8])
    assert r.status_code == 200
    v = [x for x in sup(db, run)["jobs"] if x["no_rangka"] == "009503"][0]
    assert v["order_id"] == "PO-2" and v["po_status"] == "dikonfirmasi"


# ── Nomor invoice: tidak dikarang ───────────────────────────────────────────
def test_nomor_invoice_hanya_bila_ada_di_dokumen(env):
    c, db, run = env
    assert post(c).status_code == 200
    assert all(x["no_invoice_supplier"] == "" and x["import_batch_no"] for x in sup(db, run)["jobs"])
    baris = kasus_rows()[2]; baris["tujuan_kota"] = "Lombok"      # rute lain -> bukan duplikat
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "n2", "rows": [baris], "no_invoice": " INV/2026/0042 ",
               "source": {"sha256": "d" * 64}, "tag": "x"})
    assert r.status_code == 200
    new = [x for x in sup(db, run)["jobs"] if x["import_id"] == "n2"][0]
    assert new["no_invoice_supplier"] == "INV/2026/0042"


# ── Pratinjau (parse-invoice) memakai AI yang di-mock ───────────────────────
def test_preview_menampilkan_harga_dasar_tambahan_identitas_po_dan_duplikat_lain(env, monkeypatch):
    c, db, run = env
    ai = {"rows": [
        {"vehicle_type": "Tronton Dump", "nopol": "S 8625 HN", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "harga_satuan": 10_600_000,
         "biaya_tambahan": [{"label": "Biaya pengambilan", "amount": 1_400_000}], "total_harga": 12_000_000, "tanggal": "2026-06-20"},
        {"vehicle_type": "Grand Max", "nopol": "121252", "asal_kota": "Surabaya", "tujuan_kota": "Lembar", "total_harga": 2_300_000},
        {"vehicle_type": "Terios", "nopol": "B 2307 KRO", "asal_kota": "Surabaya", "tujuan_kota": "Makassar", "total_harga": 3_900_000},
    ], "no_invoice": "", "total_invoice": 18_200_000}
    monkeypatch.setattr(server, "_parse_invoice_ai", lambda data, media: ai)
    r = c.post("/api/admin/suppliers/s1/parse-invoice", files={"file": ("inv.pdf", b"%PDF-1.4 contoh", "application/pdf")})
    assert r.status_code == 200, r.text
    j = r.json()
    a, b, t = j["rows"]
    assert a["harga_dasar"] == 10_600_000 and a["total_harga"] == 12_000_000 and a["tambahan"][0]["amount"] == 1_400_000 and a["po_status"] == "cocok"
    assert b["ident_status"] == "perlu_konfirmasi" and b["no_rangka"] == "121252" and b["nopol"] == ""
    assert t["duplikat_supplier_lain"] == ["SUPPLIER LAIN"]
    assert j["sumber"]["nama"] == "inv.pdf" and len(j["sumber"]["sha256"]) == 64 and j["file_sudah_diimpor"] is None
    # Setelah diimpor, file yang sama dikenali di preview berikutnya
    rows = [{**x, "tambahan": x.get("tambahan", [])} for x in j["rows"][:2]]
    c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "p1", "rows": rows, "source": j["sumber"]})
    r2 = c.post("/api/admin/suppliers/s1/parse-invoice", files={"file": ("inv.pdf", b"%PDF-1.4 contoh", "application/pdf")})
    assert r2.json()["file_sudah_diimpor"]["batch_no"].startswith("IMP-")


# ── Unit murni ──────────────────────────────────────────────────────────────
def test_identitas_enam_digit_bukan_noka_lengkap():
    assert SI.classify_identity("", "121252")[2] == "perlu_konfirmasi"
    assert SI.classify_identity("121252", "")[:3] == ("", "121252", "perlu_konfirmasi")      # angka di kolom plat dipindah
    assert SI.classify_identity("S 8625 HN", "")[2] == "ok"
    assert SI.classify_identity("", "MHKA1234567890123")[2] == "ok"
    assert SI.classify_identity("", "")[2] == "kosong"


def test_format_lama_total_sudah_termasuk_tambahan_tetap_didukung():
    r = SI.normalize_row({"nopol": "S 8625 HN", "total_harga": 12_000_000, "tambahan": [{"label": "Ambil", "amount": 1_400_000}]})
    assert r["harga_dasar"] == 10_600_000 and r["total_harga"] == 12_000_000
    r = SI.normalize_row({"nopol": "B 1 A", "total_harga": "Rp 2.300.000"})
    assert r["harga_dasar"] == 2_300_000
