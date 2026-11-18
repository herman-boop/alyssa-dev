"""Konfirmasi Harga: unit PO yang dicentang -> NO | NO POL | HARGA DEAL | HARGA INVOICE | SELISIH (Excel).

HARGA DEAL    = harga deal pelanggan yang tersimpan di trip (finance.invoice_total, sama dengan fitur Selisih Harga).
                PO multi-unit: total dibagi rata per unit (tanda * di catatan bawah tabel).
HARGA INVOICE = harga per unit pada baris invoice di Histori Dokumen: dicocokkan lewat No. Rangka di keterangan baris;
                cadangan untuk PO 1 unit: satu-satunya baris invoice yang memuat order itu.
SELISIH       = HARGA DEAL - HARGA INVOICE (rumus Excel, jadi ikut berubah bila angka diedit).
Logika murni (tanpa I/O); hanya membaca.
"""
import io
import re


def _key(s):
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def _plain(s):
    return re.sub(r"<[^>]+>", " ", str(s or ""))


def _int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def harga_invoice(unit, order, invoices):
    """-> (harga per unit atau 0, no_invoice)."""
    rk = _key(unit.get("no_rangka") or order.get("no_rangka"))
    if len(rk) >= 6:
        for d in invoices or []:
            for l in d.get("lines") or []:
                if rk in _key(_plain(l.get("ket"))):
                    h = _int(l.get("harga"))
                    if h > 0:
                        return h, d.get("no_dokumen") or ""
    units = order.get("units") or []
    if len(units) <= 1:
        oid = str(order.get("order_id") or "")
        cocok = [d for d in (invoices or []) if oid and oid in [str(x) for x in (d.get("order_ids") or [])]]
        if len(cocok) == 1 and len(cocok[0].get("lines") or []) == 1:
            h = _int(cocok[0]["lines"][0].get("harga"))
            if h > 0:
                return h, cocok[0].get("no_dokumen") or ""
    return 0, ""


def hitung(items, orders_by_id, deal_by_order, invoices):
    """items = [{order_id, unit_id?, no_rangka?, nopol?}] sesuai urutan centang. -> list baris."""
    out = []
    for i, it in enumerate(items or [], 1):
        o = orders_by_id.get(it.get("order_id")) or {}
        units = o.get("units") or []
        u = next((x for x in units if it.get("unit_id") and x.get("unit_id") == it.get("unit_id")), None)
        if u is None:
            u = next((x for x in units if it.get("no_rangka") and _key(x.get("no_rangka")) == _key(it.get("no_rangka"))), None)
        u = u or {}
        total = _int((deal_by_order or {}).get(it.get("order_id")))
        n = len(units) or 1
        deal = int(round(total / n)) if total > 0 else 0
        inv, no_inv = harga_invoice(u, o, invoices)
        out.append({"no": i,
                    "nopol": (u.get("nopol") or it.get("nopol") or o.get("nopol") or u.get("no_rangka") or it.get("no_rangka") or o.get("no_rangka") or ""),
                    "deal": deal, "invoice": inv, "no_invoice": no_inv, "rata": n > 1 and deal > 0})
    return out


def ke_xlsx(baris, judul=""):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    wb = Workbook()
    ws = wb.active
    ws.title = "Konfirmasi Harga"
    r0 = 1
    if judul:
        ws["A1"] = judul
        ws["A1"].font = Font(bold=True, size=12)
        r0 = 3
    kepala = ["NO", "NO POL", "HARGA DEAL", "HARGA INVOICE", "SELISIH"]
    tipis = Side(style="thin", color="000000")
    for ci, k in enumerate(kepala, 1):
        c = ws.cell(row=r0, column=ci, value=k)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = Border(top=tipis, bottom=tipis, left=tipis, right=tipis)
    for i, b in enumerate(baris or []):
        r = r0 + 1 + i
        deal = b.get("deal") or None
        inv = b.get("invoice") or None
        vals = [b.get("no"), (b.get("nopol") or "") + ("*" if b.get("rata") else ""), deal, inv,
                f'=IF(OR(C{r}="",D{r}=""),"",C{r}-D{r})']
        for ci, v in enumerate(vals, 1):
            c = ws.cell(row=r, column=ci, value=v)
            c.border = Border(top=tipis, bottom=tipis, left=tipis, right=tipis)
            if ci >= 3:
                c.number_format = '#,##0;[Red]-#,##0'
            if ci == 1:
                c.alignment = Alignment(horizontal="center")
    n = len(baris or [])
    rt = r0 + 1 + n
    ws.cell(row=rt, column=2, value="TOTAL").font = Font(bold=True)
    for ci, col in ((3, "C"), (4, "D"), (5, "E")):
        c = ws.cell(row=rt, column=ci, value=f"=SUM({col}{r0 + 1}:{col}{rt - 1})" if n else None)
        c.font = Font(bold=True)
        c.number_format = '#,##0;[Red]-#,##0'
        c.border = Border(top=tipis, bottom=tipis, left=tipis, right=tipis)
    if any(b.get("rata") for b in baris or []):
        ws.cell(row=rt + 2, column=1, value="* Harga deal PO multi-unit dibagi rata per unit. Harga kosong = belum tercatat; isi manual, SELISIH ikut terhitung.").font = Font(italic=True, size=9)
    for ci, w in enumerate((6, 26, 18, 18, 16), 1):
        ws.column_dimensions[ws.cell(row=r0, column=ci).column_letter].width = w
    ws.freeze_panes = ws.cell(row=r0 + 1, column=1)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
