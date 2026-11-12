"""Daftar Harga JUAL: harga per unit yang SUDAH DITAGIH ke pelanggan, diambil dari invoice di Histori Dokumen.
Logika murni (tanpa I/O) supaya mudah diuji. Hanya membaca: tidak mengubah invoice mana pun.

Format baris invoice (dibuat InvoiceModal): ket = "<kendaraan> <nopol> (<Asal>–<Tujuan>)<br>No. Rangka: …",
harga = harga PER UNIT, qty = jumlah unit."""
import re

_DASH = r"[–—-]"
_ROUTE = re.compile(r"\(\s*([^()]*?[^()\s])\s*" + _DASH + r"\s*([^()]*?[^()\s])\s*\)")


def _plain(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(s or "")).replace("&amp;", "&")).strip()


def parse_ket(ket):
    """-> (kendaraan, asal, tujuan). Rute tidak terbaca -> asal/tujuan kosong."""
    t = _plain(ket)
    m = _ROUTE.search(t)
    if not m:
        return t, "", ""
    veh = re.sub(r"No\.?\s*Rangka:.*$", "", t[:m.start()], flags=re.I).strip()
    return veh, m.group(1).strip(), m.group(2).strip()


def rows_from_invoices(invoices, limit=5000):
    """invoices = dokumen doc_history jenis 'invoice'. Return baris harga jual, terbaru dulu.
    Dibuang: invoice asuransi (bukan ongkir), baris tanpa harga, dan duplikat (nomor invoice + uraian + harga sama)."""
    out, seen = [], set()
    for d in invoices or []:
        meta = d.get("meta") or {}
        if str(meta.get("tipe") or "").lower() == "asuransi":
            continue
        no = str(d.get("no_dokumen") or meta.get("no_invoice") or "")
        tgl = str(meta.get("tanggalInvoice") or d.get("created_at") or "")[:10]
        for l in (d.get("lines") or []):
            try:
                harga = int(round(float(l.get("harga") or 0)))
            except (TypeError, ValueError):
                continue
            if harga <= 0:
                continue
            veh, asal, tuj = parse_ket(l.get("ket"))
            if not (asal and tuj):
                asal, tuj = (meta.get("asal_kota") or "").strip(), (meta.get("tujuan_kota") or "").strip()
            key = (no, _plain(l.get("ket")), harga)
            if key in seen:
                continue
            seen.add(key)
            out.append({"doc_id": d.get("id"), "no_invoice": no, "customer": d.get("customer") or meta.get("customer_nama") or "",
                        "tanggal": tgl, "asal": asal, "tujuan": tuj,
                        "rute": f"{asal} → {tuj}" if asal and tuj else (asal or tuj or "-"),
                        "vehicle_type": veh or str(l.get("nama") or ""), "harga": harga,
                        "qty": int(l.get("qty") or 1)})
    out.sort(key=lambda r: r["tanggal"], reverse=True)
    return out[:limit]
