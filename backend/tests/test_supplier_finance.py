import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import supplier_finance as sf


def job(jid, harga, inv="", tgl="2026-10-02", nopol="B1", payments=None, alloc=0, rute=("Cikarang", "Makassar")):
    """Job seperti keluaran _supplier_job_totals (net_transfer = harga tanpa pajak; terbayar = pembayaran + alokasi rekon)."""
    pays = payments or []
    return {"id": jid, "nopol": nopol, "no_invoice_supplier": inv, "tanggal": tgl, "net_transfer": harga,
            "total_terbayar": sum(p["amount"] for p in pays) + alloc, "payments": pays,
            "asal_kota": rute[0], "tujuan_kota": rute[1]}


def rk(pid, amount, tgl, allocs=None, ref="BCA-1"):
    return {"id": pid, "amount": amount, "tanggal": tgl, "status": "active", "bank_transaction_id": ref,
            "allocations": [{"job_id": j, "amount": a} for j, a in (allocs or [])]}


def conserved(res):
    """Pengaman: total transfer = teralokasi + belum dialokasikan; tidak ada alokasi melebihi transfer."""
    for t in res["transfers"]:
        if t["jenis"] == "biaya_admin":
            continue
        assert t["teralokasi"] + t["belum_dialokasikan"] == t["nominal"] or t["lebih_alokasi"] > 0
        assert t["lebih_alokasi"] == 0
    s = res["ringkasan"]
    assert s["transfer_aktual"] == s["teralokasi"] + s["belum_dialokasikan"]
    assert s["sisa"] == s["tagihan"] - s["terbayar"]


# 1) Satu transfer untuk beberapa invoice
def test_satu_transfer_banyak_invoice():
    jobs = [job("a", 10_000_000, "INV-1", alloc=10_000_000), job("b", 20_000_000, "INV-2", alloc=20_000_000),
            job("c", 5_000_000, "INV-3", alloc=5_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 35_000_000, "2026-10-20", [("a", 10_000_000), ("b", 20_000_000), ("c", 5_000_000)])])
    conserved(res)
    t = res["transfers"][0]
    assert t["invoice_n"] == 3 and t["teralokasi"] == 35_000_000 and t["belum_dialokasikan"] == 0
    assert sorted(a["jumlah"] for a in t["alokasi"]) == [5_000_000, 10_000_000, 20_000_000]
    assert all(i["status"] == "lunas" for i in res["invoices"])


# 2) Satu invoice dibayar beberapa kali
def test_satu_invoice_dibayar_beberapa_kali():
    pays = [{"id": "p1", "amount": 10_000_000, "tanggal": "2026-10-10", "batch_id": "b1"},
            {"id": "p2", "amount": 6_000_000, "tanggal": "2026-10-20", "batch_id": "b2"}]
    jobs = [job("a", 24_000_000, "INV-9", payments=pays, alloc=8_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 8_000_000, "2026-10-25", [("a", 8_000_000)])])
    conserved(res)
    assert len(res["transfers"]) == 3                      # 2 manual + 1 rekon
    inv = res["invoices"][0]
    assert inv["tagihan"] == 24_000_000 and inv["terbayar"] == 24_000_000 and inv["status"] == "lunas"
    assert res["ringkasan"]["transfer_aktual"] == 24_000_000


# 3) Pembayaran sebagian
def test_pembayaran_sebagian():
    jobs = [job("a", 72_000_000, "INV-5", alloc=60_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 60_000_000, "2026-10-20", [("a", 60_000_000)])])
    conserved(res)
    inv = res["invoices"][0]
    assert inv["status"] == "sebagian" and inv["sisa"] == 12_000_000
    assert res["ringkasan"]["sisa"] == 12_000_000


# 4) Pembayaran belum dialokasikan
def test_pembayaran_belum_dialokasikan():
    jobs = [job("a", 10_000_000, "INV-1", alloc=4_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 9_000_000, "2026-10-20", [("a", 4_000_000)]), rk("r2", 5_000_000, "2026-10-22")])
    conserved(res)
    s = res["ringkasan"]
    assert s["transfer_aktual"] == 14_000_000 and s["teralokasi"] == 4_000_000 and s["belum_dialokasikan"] == 10_000_000
    assert [t["belum_dialokasikan"] for t in res["transfers"]] == [5_000_000, 5_000_000]
    # Pembayaran belum dialokasikan TIDAK mengurangi sisa tagihan
    assert res["invoices"][0]["sisa"] == 6_000_000


def test_alokasi_melebihi_transfer_dilaporkan_bukan_diam():
    jobs = [job("a", 10_000_000, "INV-1", alloc=12_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 10_000_000, "2026-10-20", [("a", 12_000_000)])])
    assert res["anomali"] and res["anomali"][0]["kelebihan"] == 2_000_000
    assert res["transfers"][0]["belum_dialokasikan"] == 0          # tidak pernah negatif


def test_biaya_admin_bank_tidak_masuk_belum_dialokasikan():
    jobs = [job("a", 10_000_000, "INV-1", alloc=10_000_000)]
    rps = [rk("r1", 10_000_000, "2026-10-20", [("a", 10_000_000)]), rk("fee", 6_500, "2026-10-20")]
    res = sf.build_finance(jobs, rps, is_fee=lambda p: p["id"] == "fee")
    s = res["ringkasan"]
    assert s["belum_dialokasikan"] == 0 and s["biaya_admin_bank"] == 6_500 and s["transfer_aktual"] == 10_000_000


def test_kompensasi_adalah_penyesuaian_bukan_transfer():
    pays = [{"id": "k1", "amount": 3_000_000, "tanggal": "2026-10-12", "tipe": "kompensasi"}]
    jobs = [job("a", 10_000_000, "INV-1", payments=pays, alloc=7_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 7_000_000, "2026-10-20", [("a", 7_000_000)])])
    assert res["ringkasan"]["penyesuaian"] == 3_000_000 and res["ringkasan"]["transfer_aktual"] == 7_000_000
    assert res["invoices"][0]["status"] == "lunas"


# 5) Nomor invoice duplikat
def test_nomor_invoice_duplikat():
    jobs = [job("a", 1_000_000, " inv-77 ", tgl="2026-09-01"), job("b", 1_000_000, "INV-77", tgl="2026-10-20")]
    inv, _ = sf.build_invoices(jobs)
    assert len(inv) == 1 and inv[0]["unit"] == 2                      # spasi/huruf besar-kecil tidak memecah invoice
    assert any("terpaut" in d for d in inv[0]["duplikat"])           # tanggal terpaut > 31 hari ditandai
    inv2, _ = sf.build_invoices([job("a", 1, "INV-1")], used_elsewhere={"INV-1"})
    assert inv2[0]["duplikat"] == ["dipakai supplier lain"]
    plan = sf.plan_no_invoice([job("a", 1, "INV-77", tgl="2026-09-01"), job("b", 1, "", tgl="2026-10-30")], ["b"], "inv-77")
    assert plan["updates"] and any("duplikat" in w for w in plan["warnings"])   # peringatan, bukan penolakan


# 6) Saldo supplier berbeda dari sistem + status Belum Direkonsiliasi
def test_saldo_supplier_belum_diinput_bukan_nol():
    jobs = [job("a", 10_000_000, "INV-1", alloc=4_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 4_000_000, "2026-10-20", [("a", 4_000_000)])], cutoff="2026-10-31")
    r = res["rekonsiliasi"]
    assert r["status"] == "belum_direkonsiliasi" and r["selisih"] is None and r["saldo_supplier"] is None


def test_saldo_supplier_berbeda_dan_penyebab():
    jobs = [job("a", 10_000_000, "INV-1", alloc=4_000_000), job("b", 5_000_000, "INV-2")]
    rps = [rk("r1", 4_000_000, "2026-10-20", [("a", 4_000_000)]), rk("r2", 2_000_000, "2026-10-25")]
    entries = [{"cutoff": "2026-10-31", "saldo": 13_000_000, "oleh": "admin"}]
    res = sf.build_finance(jobs, rps, saldo_entries=entries, cutoff="2026-10-31")
    r = res["rekonsiliasi"]
    assert r["saldo_alyssa"] == 15_000_000 - 4_000_000 == 11_000_000
    assert r["status"] == "selisih" and r["selisih"] == -2_000_000
    jenis = {c["jenis"] for c in r["penyebab"]}
    assert "transfer_belum_dialokasikan" in jenis
    assert any(c["jenis"] == "transfer_belum_dialokasikan" and c["nominal"] == 2_000_000 for c in r["cocok_nominal"])


def test_saldo_cocok_dan_cutoff_menghormati_tanggal():
    jobs = [job("a", 10_000_000, "INV-1", tgl="2026-10-02"), job("b", 5_000_000, "INV-2", tgl="2026-11-05")]
    assert sf.saldo_alyssa(jobs, [], "2026-10-31") == 10_000_000       # tagihan setelah cut-off tidak dihitung
    res = sf.build_finance(jobs, [], saldo_entries=[{"cutoff": "2026-10-31", "saldo": 10_000_000}], cutoff="2026-10-31")
    assert res["rekonsiliasi"]["status"] == "cocok" and res["rekonsiliasi"]["selisih"] == 0


# 7) Invoice lama belum punya nomor
def test_invoice_lama_perlu_dilengkapi_dan_tidak_ubah_nominal():
    jobs = [job("a", 10_000_000, "", nopol="B1111XYZ", tgl="2026-06-20", alloc=3_000_000),
            job("b", 4_000_000, "", nopol="B2222XYZ", tgl="2026-06-25"), job("c", 1_000_000, "INV-1")]
    before = [dict(j) for j in jobs]
    inv, perlu = sf.build_invoices(jobs)
    assert perlu["unit"] == 2 and perlu["tagihan"] == 14_000_000 and perlu["terbayar"] == 3_000_000 and perlu["sisa"] == 11_000_000
    assert len(inv) == 1                                              # tidak ada invoice 'palsu' dari unit tanpa nomor
    plan = sf.plan_no_invoice(jobs, ["a", "b"], "SPL/06/2026")
    assert [u["job_id"] for u in plan["updates"]] == ["a", "b"] and not plan["errors"]
    assert jobs == before                                              # perencanaan tidak mengubah data
    # menimpa nomor yang sudah ada harus eksplisit
    p2 = sf.plan_no_invoice(jobs, ["c"], "LAIN")
    assert p2["errors"] and not p2["updates"]
    p3 = sf.plan_no_invoice(jobs, ["c"], "LAIN", timpa=True)
    assert p3["updates"][0]["dari"] == "INV-1"
    assert sf.plan_no_invoice(jobs, ["a"], "  ")["errors"]


def test_cari_unit_berdasarkan_nomor_tanggal_nominal():
    jobs = [job("a", 10_000_000, "", nopol="B1111XYZ", tgl="2026-06-20"), job("b", 4_000_000, "", nopol="B2222XYZ", tgl="2026-06-25"),
            job("c", 4_000_000, "INV-1", nopol="B3333XYZ", tgl="2026-07-01")]
    assert [r["id"] for r in sf.cari_unit(jobs, q="2222")] == ["b"]
    assert [r["id"] for r in sf.cari_unit(jobs, dari="2026-06-21", sampai="2026-06-30")] == ["b"]
    assert [r["id"] for r in sf.cari_unit(jobs, nominal=4_000_000)] == ["b", "c"]
    assert [r["id"] for r in sf.cari_unit(jobs, nominal=4_000_000, kosong=True)] == ["b"]
    assert [r["id"] for r in sf.cari_unit(jobs, nominal_min=5_000_000)] == ["a"]


# Verifikasi transfer
def test_verifikasi_wajib_bukti_atau_catatan_dan_riwayat():
    e, err = sf.apply_verifikasi({}, "menunggu_konfirmasi", "", "", "admin", "t1")
    assert err and e is None
    e, err = sf.apply_verifikasi({}, "menunggu_konfirmasi", "WA ke supplier 5 Nov", "", "admin", "t1")
    assert not err and e["status"] == "menunggu_konfirmasi" and len(e["riwayat"]) == 1
    e2, err = sf.apply_verifikasi(e, "terverifikasi_supplier", "ok", "", "admin", "t2")
    assert err                                                         # terverifikasi butuh bukti/catatan >= 8 huruf
    e2, err = sf.apply_verifikasi(e, "terverifikasi_supplier", "", "/uploads/konfirmasi.jpg", "admin", "t2")
    assert not err and [r["ke"] for r in e2["riwayat"]] == ["menunggu_konfirmasi", "terverifikasi_supplier"]
    assert e2["riwayat"][0]["pada"] == "t1"                            # riwayat lama tidak tertimpa
    _, err = sf.apply_verifikasi(e2, "terverifikasi_supplier", "x" * 10, "", "admin", "t3")
    assert err                                                         # status sama tanpa bukti baru
    _, err = sf.apply_verifikasi({}, "diterima", "x" * 10, "", "admin", "t")
    assert err                                                         # 'diterima' bukan status verifikasi


def test_status_transfer_tidak_otomatis_terverifikasi():
    jobs = [job("a", 10_000_000, "INV-1", alloc=10_000_000)]
    res = sf.build_finance(jobs, [rk("r1", 10_000_000, "2026-10-20", [("a", 10_000_000)])])
    assert res["transfers"][0]["verifikasi"] == "belum_diverifikasi"
    res = sf.build_finance(jobs, [rk("r1", 10_000_000, "2026-10-20", [("a", 10_000_000)])],
                           verifikasi={"rk:r1": {"status": "ada_selisih"}})
    assert res["transfers"][0]["verifikasi"] == "ada_selisih" and res["invoices"][0]["status"] == "selisih"


# Saldo & periode konsisten dengan angka existing
def test_saldo_akhir_periode_sama_dengan_saldo_alyssa_dan_sisa_total():
    pays = [{"id": "p1", "amount": 3_000_000, "tanggal": "2026-10-10", "batch_id": "b1"},
            {"id": "k1", "amount": 1_000_000, "tanggal": "2026-10-11", "tipe": "kompensasi"}]
    jobs = [job("a", 10_000_000, "INV-1", tgl="2026-09-20", payments=pays, alloc=2_000_000),
            job("b", 8_000_000, "INV-2", tgl="2026-10-15"), job("c", 4_000_000, "", tgl="2026-11-03")]
    rps = [rk("r1", 2_000_000, "2026-10-25", [("a", 2_000_000)])]
    sisa_total = sum(j["net_transfer"] - j["total_terbayar"] for j in jobs)
    assert sf.saldo_alyssa(jobs, rps, "2027-01-01") == sisa_total          # cut-off jauh ke depan == sisa total existing
    p = sf.ringkasan_periode(jobs, rps, "2026-10-01", "2026-10-31")
    assert p["saldo_akhir"] == sf.saldo_alyssa(jobs, rps, "2026-10-31")
    assert p["saldo_awal"] == 10_000_000 and p["tagihan_baru"] == 8_000_000
    assert p["pembayaran"] == 3_000_000 + 2_000_000 and p["penyesuaian"] == 1_000_000
    assert p["saldo_awal"] + p["tagihan_baru"] - p["pembayaran"] - p["penyesuaian"] == p["saldo_akhir"]


def test_rekon_dibatalkan_tidak_dihitung():
    jobs = [job("a", 10_000_000, "INV-1", alloc=0)]
    r = rk("r1", 10_000_000, "2026-10-20", [("a", 10_000_000)]); r["status"] = "reversed"
    res = sf.build_finance(jobs, [r])
    assert res["transfers"] == [] and res["ringkasan"]["transfer_aktual"] == 0
    assert sf.saldo_alyssa(jobs, [r], "2026-12-31") == 10_000_000


# 8) PDF panjang > 1 halaman: dirender Chromium sungguhan; header tabel berulang, nomor halaman, teks vector
def _banyak(n):
    jobs, rps = [], []
    for i in range(n):
        jobs.append(job(f"j{i}", 1_000_000 + i, f"INV-{1000 + i}/CBL/X/2026", tgl="2026-10-%02d" % (1 + i % 28), alloc=1_000_000 + i))
        rps.append(rk(f"r{i}", 1_000_000 + i, "2026-10-%02d" % (1 + i % 28), [(f"j{i}", 1_000_000 + i)], ref=f"BCA-{i}"))
    return jobs, rps


def test_pdf_panjang_banyak_halaman_dan_teks_vector():
    import asyncio, re, shutil
    pw = pytest_importorskip("playwright.async_api")
    exe = "/opt/pw-browsers/chromium"
    if not os.path.exists(exe):
        import pytest
        pytest.skip("chromium tidak tersedia")
    jobs, rps = _banyak(60)
    fin = sf.build_finance(jobs, rps)
    per = sf.ringkasan_periode(jobs, rps, "2026-10-01", "2026-10-31")
    logo = os.path.join(os.path.dirname(__file__), "..", "assets", "logo.png")
    html = sf.render_pdf_html("CV. <b>Contoh</b> & Co", "RPS/AAL/TEST", fin, per, logo_path=logo)
    assert "&lt;b&gt;Contoh&lt;/b&gt;" in html and "<b>Contoh</b>" not in html        # teks dinamis di-escape

    async def run():
        async with pw.async_playwright() as p:
            b = await p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
            pg = await b.new_page()
            await pg.set_content(html)
            data = await pg.pdf(format="A4", print_background=True, display_header_footer=True,
                                header_template="<span></span>", footer_template=sf.PDF_FOOTER,
                                margin={"top": "16mm", "bottom": "18mm", "left": "14mm", "right": "14mm"})
            await b.close()
            return data
    pdf = asyncio.run(run())
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf))
    assert pages >= 3, pages
    n_img = pdf.count(b"/Subtype /Image") + pdf.count(b"/Subtype/Image")
    assert n_img <= 2, n_img            # hanya logo (+ mask transparansinya); tabel/teks bukan gambar
    assert b"/Font" in pdf                                                               # teks vector (font tertanam), bukan screenshot
    # Baris Total tiap tabel hanya muncul SEKALI (di akhir tabel), bukan diulang di setiap halaman
    import subprocess, tempfile
    if shutil.which("pdftotext"):
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            f.write(pdf)
        txt = subprocess.run(["pdftotext", "-layout", f.name, "-"], capture_output=True, text=True).stdout
        os.unlink(f.name)
        assert txt.count("Halaman 1 dari") == 1 and f"dari {pages}" in txt
        tot = [ln.strip() for ln in txt.splitlines() if ln.strip().startswith("Total ") and not ln.strip().startswith("Total transfer aktual")]
        assert len(tot) == 2, f"Total harus tampil sekali per tabel (2 tabel): {tot}"
        assert txt.count("No. Invoice Supplier") >= 2          # header tabel berulang di halaman lanjutan
    out = os.environ.get("SF_PDF_OUT")
    if out:
        open(out, "wb").write(pdf)


def pytest_importorskip(name):
    import importlib, pytest
    try:
        return importlib.import_module(name)
    except ImportError:
        pytest.skip(f"{name} tidak tersedia")


def test_pdf_tabel_muat_lebar_halaman_tanpa_dikecilkan_otomatis():
    """Tabel tidak boleh lebih lebar dari area cetak: kalau lebih lebar, Chromium mengecilkan SELURUH halaman
    (teks jadi kecil). Diuji dengan nama kota & nomor invoice sangat panjang."""
    import asyncio, os
    pw = pytest_importorskip("playwright.async_api")
    exe = "/opt/pw-browsers/chromium"
    if not os.path.exists(exe):
        import pytest
        pytest.skip("chromium tidak tersedia")
    kota = ["Surabaya Tanjung Perak", "Banjarmasin Trisakti", "Makassar Hasanuddin", "Balikpapan Kariangau"]
    jobs, rps = [], []
    for i in range(40):
        jobs.append(job(f"j{i}", 2_345_678_901 if i % 5 == 0 else 2_300_000, f"INV-{1000 + i}/PT-CONTOH-BAHARI-LOGISTIK-NUSANTARA/XI/2026", tgl="2026-10-%02d" % (1 + i % 28),
                        alloc=2_000_000, rute=(kota[i % 4], kota[(i + 1) % 4])))
    for r in range(12):
        rps.append(rk(f"r{r}", 70_000_000, "2026-10-20", [(f"j{(r * 3 + k) % 40}", 2_000_000) for k in range(10)], ref=f"BCA-REF-PANJANG-SEKALI-{r:06d}"))
    fin = sf.build_finance(jobs, rps)
    html = sf.render_pdf_html("PT Supplier Dengan Nama Sangat Panjang Sekali Untuk Menguji", "RPS/AAL/TEST", fin,
                              sf.ringkasan_periode(jobs, rps, "2026-10-01", "2026-10-31"))

    async def ukur():
        async with pw.async_playwright() as p:
            b = await p.chromium.launch(executable_path=exe, args=["--no-sandbox"])
            pg = await b.new_page(viewport={"width": 689, "height": 1000})      # 689px = lebar area cetak A4 dengan margin 14mm
            await pg.set_content(html); await pg.emulate_media(media="print")
            r = await pg.evaluate("""() => ({
                tabel: [...document.querySelectorAll('table')].map(t => [Math.round(t.getBoundingClientRect().width), t.parentElement.clientWidth]),
                angka_terpotong: [...document.querySelectorAll('table.fx td,table.fx th')].filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent.trim().slice(0, 30))})""")
            await b.close()
            return r
    hasil = asyncio.run(ukur())
    for w, cw in hasil["tabel"]:
        assert w <= cw + 1, f"tabel {w}px lebih lebar dari area cetak {cw}px (halaman akan dikecilkan)"
    assert hasil["angka_terpotong"] == [], f"isi sel meluber dari selnya: {hasil['angka_terpotong'][:5]}"


# ── Kasus MARTHEN: alokasi rekon ke unit yang tidak ada ─────────────────────
def test_alokasi_ke_unit_tidak_ada_tidak_masuk_saldo_dan_dilaporkan():
    jobs = [{"id": "j1", "net_transfer": 10_000_000, "total_terbayar": 10_000_000, "tanggal": "2026-01-01", "payments": [], "nopol": "B1"}]
    rp = [{"id": "r1", "amount": 10_000_000, "tanggal": "2026-02-01", "status": "active",
           "allocations": [{"job_id": "j1", "amount": 6_500_000}, {"job_id": "HILANG", "amount": 3_500_000}]}]
    # saldo sama dengan perhitungan lama: hanya alokasi ke unit yang ada yang dihitung
    assert sf.saldo_alyssa(jobs, rp, "2999-12-31") == 3_500_000
    an = sf.alokasi_yatim(jobs, rp)
    assert len(an) == 1 and an[0]["unit_id"] == "HILANG" and an[0]["teralokasi"] == 3_500_000
    fin = sf.build_finance(jobs, rp, is_fee=lambda p: False)
    assert any(a["jenis"] == "alokasi_ke_unit_tidak_ada" for a in fin["anomali"])


def test_alokasi_negatif_tidak_dihitung_seperti_perhitungan_lama():
    jobs = [{"id": "j1", "net_transfer": 5_000_000, "total_terbayar": 0, "tanggal": "2026-01-01", "payments": []}]
    rp = [{"id": "r1", "amount": 1, "tanggal": "2026-02-01", "status": "active", "allocations": [{"job_id": "j1", "amount": -2_000_000}]}]
    assert sf.saldo_alyssa(jobs, rp, "2999-12-31") == 5_000_000
