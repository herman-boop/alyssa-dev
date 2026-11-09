"""Ekspor Excel Rekap Supplier (murni: menerima hasil `supplier_finance.build_finance` + unit; tidak menghitung ulang apa pun).
Tema: navy header, aksen gold tipis. Angka disimpan sebagai angka (bukan teks) agar bisa dijumlah di Excel."""
from io import BytesIO
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

NAVY, GOLD, GRAY = "0F2A5C", "C9973A", "F3F5F8"
RP = '#,##0;[Red](#,##0)'
_ST = {"lunas": "Lunas", "sebagian": "Sebagian", "belum": "Belum Dibayar", "selisih": "Selisih", "draft": "Draft"}


def _head(ws, row, titles, widths):
    for i, (t, w) in enumerate(zip(titles, widths), start=1):
        c = ws.cell(row=row, column=i, value=t)
        c.font = Font(bold=True, color="FFFFFF", name="Calibri"); c.fill = PatternFill("solid", fgColor=NAVY)
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[row].height = 30
    for i in range(1, len(titles) + 1):
        ws.cell(row=row, column=i).border = Border(bottom=Side(style="medium", color=GOLD))
    ws.freeze_panes = f"A{row + 1}"


def _title(ws, text, sub):
    ws["A1"] = text; ws["A1"].font = Font(bold=True, size=14, color=NAVY)
    ws["A2"] = sub; ws["A2"].font = Font(size=10, color="5B6678")


def _num(ws, row, cols):
    for c in cols:
        ws.cell(row=row, column=c).number_format = RP


def build_workbook(supplier_nama, cutoff, fin, jobs, dibuat=""):
    wb = Workbook()
    S = fin["ringkasan"]; rk = fin["rekonsiliasi"]

    # 1. Ringkasan
    ws = wb.active; ws.title = "Ringkasan"
    _title(ws, f"Rekap Supplier — {supplier_nama}", f"Per cut-off {cutoff or '-'}" + (f" · dibuat {dibuat}" if dibuat else ""))
    rows = [("Total Tagihan Supplier", S["tagihan"]), ("Total Pembayaran", S["terbayar"]), ("Sisa Tagihan", S["sisa"]),
            ("Pembayaran Belum Dialokasikan", S["belum_dialokasikan"]), ("Transfer Aktual", S["transfer_aktual"]),
            ("Penyesuaian / Kompensasi", S["penyesuaian"]), ("Biaya Admin Bank (terpisah)", S["biaya_admin_bank"])]
    _head(ws, 4, ["Keterangan", "Nominal (Rp)"], [38, 22])
    for i, (k, v) in enumerate(rows, start=5):
        ws.cell(row=i, column=1, value=k); ws.cell(row=i, column=2, value=v); _num(ws, i, [2])
    r = 5 + len(rows) + 1
    ws.cell(row=r, column=1, value="Rekonsiliasi saldo").font = Font(bold=True, color=NAVY)
    if rk.get("status") == "belum_direkonsiliasi" or rk.get("saldo_supplier") is None:
        ws.cell(row=r + 1, column=1, value="Saldo menurut Alyssa"); ws.cell(row=r + 1, column=2, value=rk.get("saldo_alyssa")); _num(ws, r + 1, [2])
        ws.cell(row=r + 2, column=1, value="Selisih rekonsiliasi"); ws.cell(row=r + 2, column=2, value="Belum Direkonsiliasi (saldo supplier belum diinput)")
    else:
        ws.cell(row=r + 1, column=1, value="Saldo menurut Alyssa"); ws.cell(row=r + 1, column=2, value=rk["saldo_alyssa"])
        ws.cell(row=r + 2, column=1, value="Saldo menurut supplier"); ws.cell(row=r + 2, column=2, value=rk["saldo_supplier"])
        ws.cell(row=r + 3, column=1, value="Selisih (Alyssa − supplier)"); ws.cell(row=r + 3, column=2, value=rk["selisih"])
        _num(ws, r + 1, [2]); _num(ws, r + 2, [2]); _num(ws, r + 3, [2])
    if fin.get("anomali"):
        ws.cell(row=r + 5, column=1, value=f"Perhatian: {len(fin['anomali'])} anomali data (lihat aplikasi). Data tidak diubah.").font = Font(color="B42318", bold=True)

    # 2. Invoice
    wi = wb.create_sheet("Invoice")
    _title(wi, "Tagihan per Invoice Supplier", supplier_nama)
    _head(wi, 4, ["No. Invoice Supplier", "Tanggal", "Unit", "Rute", "Tagihan (Rp)", "Terbayar (Rp)", "Sisa (Rp)", "Status", "Catatan"], [30, 12, 8, 34, 16, 16, 16, 14, 34])
    n = 5
    for inv in fin["invoices"]:
        wi.append([inv["no"], inv.get("tanggal") or "", inv["unit"], "; ".join(inv.get("rute") or []), inv["tagihan"], inv["terbayar"], inv["sisa"],
                   _ST.get(inv["status"], inv["status"]), ("Periksa nomor: " + "; ".join(str(d) for d in inv["duplikat"])) if inv.get("duplikat") else ""])
        _num(wi, n, [5, 6, 7]); n += 1
    pl = fin.get("perlu_dilengkapi") or {}
    if pl.get("unit"):
        wi.append(["Tanpa nomor invoice (Perlu Dilengkapi)", "", pl["unit"], "", pl["tagihan"], pl["terbayar"], pl["sisa"], "Perlu Dilengkapi", ""])
        _num(wi, n, [5, 6, 7]); n += 1
    wi.cell(row=n, column=1, value="TOTAL").font = Font(bold=True)
    for c, k in ((5, "tagihan"), (6, "terbayar"), (7, "sisa")):
        wi.cell(row=n, column=c, value=S[k]); wi.cell(row=n, column=c).font = Font(bold=True); wi.cell(row=n, column=c).number_format = RP
        wi.cell(row=n, column=c).fill = PatternFill("solid", fgColor=GRAY)

    # 3. Unit
    wu = wb.create_sheet("Unit")
    _title(wu, "Daftar Unit", supplier_nama)
    _head(wu, 4, ["Tanggal", "No. Polisi / Rangka", "Tipe", "Rute", "No. Invoice Supplier", "Batch Impor", "Tagihan (Rp)", "Terbayar (Rp)", "Sisa (Rp)", "Status"],
          [12, 24, 22, 32, 26, 22, 16, 16, 16, 14])
    n = 5
    for j in sorted(jobs, key=lambda x: (x.get("tanggal") or "", x.get("nopol") or "")):
        net = j.get("net_transfer") if j.get("net_transfer") is not None else (j.get("total_harga") or 0)
        sisa = j.get("sisa") if j.get("sisa") is not None else net - (j.get("total_terbayar") or 0)
        st = "Lunas" if (sisa <= 0 and net > 0) else ("Sebagian" if (j.get("total_terbayar") or 0) > 0 else ("Draft" if net <= 0 else "Belum Dibayar"))
        wu.append([j.get("tanggal") or "", j.get("nopol") or j.get("no_rangka") or "", j.get("vehicle_type") or "",
                   f"{j.get('asal_kota') or '-'} → {j.get('tujuan_kota') or '-'}", j.get("no_invoice_supplier") or "", j.get("import_batch_no") or "",
                   net, j.get("total_terbayar") or 0, sisa, st])
        _num(wu, n, [7, 8, 9]); n += 1

    # 4. Riwayat Pembayaran
    wp = wb.create_sheet("Riwayat Pembayaran")
    _title(wp, "Riwayat Pembayaran (1 transfer = 1 baris)", supplier_nama)
    _head(wp, 4, ["Tanggal", "Jenis", "Bank", "Referensi", "Nominal (Rp)", "Teralokasi (Rp)", "Belum Dialokasikan (Rp)", "Verifikasi Supplier", "Catatan"],
          [12, 14, 10, 26, 16, 16, 20, 26, 36])
    n = 5
    for t in fin["transfers"]:
        wp.append([t.get("tanggal") or "", t["jenis"], t.get("bank") or "", t.get("ref") or "", t["nominal"], t["teralokasi"], t["belum_dialokasikan"],
                   t.get("verifikasi_label") or "", t.get("catatan") or ""])
        _num(wp, n, [5, 6, 7]); n += 1

    # 5. Alokasi
    wa = wb.create_sheet("Alokasi")
    _title(wa, "Alokasi Transfer ke Nomor Invoice Supplier", supplier_nama)
    _head(wa, 4, ["Tanggal Transfer", "Referensi", "Nominal Transfer (Rp)", "No. Invoice Supplier", "Unit", "Alokasi (Rp)"], [16, 26, 20, 32, 8, 16])
    n = 5
    for t in fin["transfers"]:
        for a in t.get("alokasi") or []:
            wa.append([t.get("tanggal") or "", t.get("ref") or t["key"], t["nominal"], a.get("invoice_no") or "Tanpa nomor invoice", a.get("unit"), a.get("jumlah")])
            _num(wa, n, [3, 6]); n += 1
        if (t.get("belum_dialokasikan") or 0) > 0:
            wa.append([t.get("tanggal") or "", t.get("ref") or t["key"], t["nominal"], "(belum dialokasikan)", "", t["belum_dialokasikan"]])
            _num(wa, n, [3, 6]); n += 1
    buf = BytesIO(); wb.save(buf)
    return buf.getvalue()
