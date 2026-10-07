/* eslint-disable */
/* LAPORAN REKONSILIASI PEMBAYARAN SUPPLIER — 1 PDF gabungan untuk 1 proses/batch.
   Presentasi saja: data dari buildRekonReportData (membaca dokumen supplier yang sudah tersimpan). */
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";
import { buildRekonReportData } from "./rekonReportData";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rp = (n) => "Rp" + (Number(n) || 0).toLocaleString("id-ID");
const fTgl = (s) => { if (!s) return "-"; const [y, m, d] = String(s).slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : s; };

export function rekonReportHtml(sup, jobIds, opts = {}) {
  const d = buildRekonReportData(sup, jobIds);
  const now = new Date();
  const tglProses = `${String(now.getDate()).padStart(2, "0")}/${String(now.getMonth() + 1).padStart(2, "0")}/${now.getFullYear()}`;
  const ref = [d.fakturNo, `${d.tx.length} transfer bank`].filter(Boolean).join(" · ");
  const noDoc = opts.noDoc || `RKN/${d.supplier.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toUpperCase()}/${tglProses.replace(/\//g, "")}`;
  const r = d.ringkasan, t = d.total;

  const rowsB = d.rows.map((x) => `<tr>
      <td class="c">${x.no}</td><td>${esc(x.ref || "-")}</td><td><b>${esc(x.nopol || "-")}</b></td><td>${esc(x.rute)}</td>
      <td class="r">${rp(x.tagihan)}</td><td class="r">${rp(x.dibayar)}</td><td class="r">${rp(x.sisa)}</td>
      <td class="c"><span class="st st-${x.status === "Lunas" ? "y" : x.status === "Sebagian" ? "p" : "n"}">${x.status}</span></td></tr>`).join("");
  const rowsC = d.tx.map((x) => `<tr>
      <td class="c">${x.no}</td><td class="nw">${fTgl(x.tanggal)}</td>
      <td>${esc(x.ket)}${x.btx ? `<div class="sub">btx ${esc(x.btx)}</div>` : ""}</td>
      <td class="r">${rp(x.amount)}</td><td>${esc(x.status)}</td></tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Laporan Rekonsiliasi ${esc(d.supplier)}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 10.5px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    .meta { display:grid; grid-template-columns: 1fr 1fr; gap:3px 24px; margin:2px 0 8px; font-size:10px; }
    .meta div span { color:#475569; display:inline-block; min-width:118px; }
    .sec { margin:12px 0 5px; padding-bottom:3px; border-bottom:1px solid #c3ccd8; font-size:9.5px; font-weight:800; letter-spacing:1.1px; text-transform:uppercase; break-after:avoid; page-break-after:avoid; }
    table.rk { width:100%; border-collapse:collapse; }
    table.rk thead { display:table-header-group; }           /* header tabel diulang tiap halaman */
    table.rk tr { break-inside:avoid; page-break-inside:avoid; }
    table.rk th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.3px; color:#475569; font-weight:700; padding:3px 5px; border-bottom:1px solid #94a3b8; background:#fff; }
    table.rk td { padding:3px 5px; font-size:9px; line-height:1.25; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.rk th.r, table.rk td.r { text-align:right; white-space:nowrap; } table.rk th.c, table.rk td.c { text-align:center; } .nw { white-space:nowrap; }
    table.rk tfoot td { border-top:1.5px solid #000; border-bottom:none; font-weight:800; font-size:9.5px; padding:5px; }
    .sub { font-size:7.5px; color:#64748b; margin-top:1px; word-break:break-all; }
    .st { font-size:8px; font-weight:700; } .st-y { color:#0f7a4d; } .st-p { color:#b45309; } .st-n { color:#b91c1c; }
    .box { width:100%; border:1px solid #c9d2e0; border-radius:6px; padding:6px 10px; break-inside:avoid; page-break-inside:avoid; }
    .box .row { display:flex; justify-content:space-between; gap:12px; padding:3px 0; font-size:10px; }
    .box .row .k { color:#334155; } .box .row .v { font-weight:700; white-space:nowrap; }
    .box .row.big { border-top:1px solid #94a3b8; margin-top:3px; padding-top:6px; } .box .row.big .k { font-weight:800; text-transform:uppercase; } .box .row.big .v { font-size:14px; font-weight:900; }
    .warn { margin-top:5px; font-size:8.5px; color:#92400e; }
    .note { font-size:8px; color:#475569; line-height:1.55; margin-top:10px; }
    @page { size:A4 portrait; margin:8mm; }
    @media print { @page { size:A4 portrait; margin:8mm; } }
    @media screen and (max-width: 640px) { body { font-size: 12px; padding:8px; } .meta { grid-template-columns: 1fr; } table.rk td, table.rk th { font-size: 11px; } .sub { font-size:9px; } }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "LAPORAN REKONSILIASI", docSub: "Pembayaran Supplier" })}
    <div class="meta">
      <div><span>Supplier</span><b>${esc(d.supplier)}</b></div>
      <div><span>Tanggal proses</span>${tglProses}</div>
      <div><span>Batch/Referensi Rekon</span>${esc(ref || "-")}</div>
      <div><span>Entitas</span>${esc(d.entities.join(" / ") || "-")}</div>
      <div><span>No. Dokumen</span>${esc(noDoc)}</div>
    </div>

    <div class="sec">A. Ringkasan</div>
    <div class="box">
      <div class="row"><span class="k">Jumlah PO/unit yang dipilih</span><span class="v">${r.jumlahUnit}</span></div>
      <div class="row"><span class="k">Total tagihan sebelum pembayaran</span><span class="v">${rp(r.tagihan)}</span></div>
      <div class="row"><span class="k">Total transfer pokok supplier di batch ini</span><span class="v">${rp(r.trxPokok)}</span></div>
      <div class="row"><span class="k">Total pembayaran rekon yang berhasil dialokasikan ke PO</span><span class="v">${rp(r.dialokasi)}</span></div>
      ${r.manual > 0 ? `<div class="row"><span class="k">Pembayaran lain (manual/di luar rekon)</span><span class="v">${rp(r.manual)}</span></div>` : ""}
      <div class="row big"><span class="k">Sisa tagihan setelah rekon</span><span class="v">${rp(r.sisa)}</span></div>
    </div>

    <div class="sec">B. Daftar PO / Unit</div>
    <table class="rk">
      <thead><tr><th class="c" style="width:20px">No</th><th>No PO/Referensi</th><th>Nopol</th><th>Rute</th>
        <th class="r">Tagihan</th><th class="r">Dibayar</th><th class="r">Sisa</th><th class="c">Status</th></tr></thead>
      <tbody>${rowsB || `<tr><td colspan="8" class="c">Tidak ada unit.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4" class="r">TOTAL</td><td class="r">${rp(r.tagihan)}</td><td class="r">${rp(d.rows.reduce((a, x) => a + x.dibayar, 0))}</td><td class="r">${rp(r.sisa)}</td><td></td></tr></tfoot>
    </table>

    <div class="sec">C. Transaksi Bank / Rekon</div>
    <table class="rk">
      <thead><tr><th class="c" style="width:20px">No</th><th>Tanggal</th><th>Keterangan Bank</th><th class="r">Nominal</th><th>Status/Alokasi</th></tr></thead>
      <tbody>${rowsC || `<tr><td colspan="5" class="c">Belum ada transaksi bank yang dialokasikan ke PO ini.</td></tr>`}</tbody>
    </table>

    <div class="sec">D. Total</div>
    <div class="box">
      <div class="row"><span class="k">Total transfer pokok supplier</span><span class="v">${rp(t.trxPokok)}</span></div>
      <div class="row"><span class="k">Biaya admin bank${t.biayaAdminCount ? ` (${t.biayaAdminCount} transaksi, ditanggung Alyssa)` : ""}</span><span class="v">${rp(t.biayaAdmin)}</span></div>
      <div class="row"><span class="k">Total transaksi bank</span><span class="v">${rp(t.trxSemua)}</span></div>
      <div class="row"><span class="k">Total dialokasikan ke PO</span><span class="v">${rp(t.dialokasi)}</span></div>
      <div class="row big"><span class="k">Sisa keseluruhan supplier</span><span class="v">${rp(t.sisaSupplier)}</span></div>
      ${t.biayaAdminTeralokasi > 0 ? `<div class="warn">⚠ Biaya admin bank ${rp(t.biayaAdminTeralokasi)} masih tercatat teralokasi ke PO pada data tersimpan (tidak dihitung sebagai pembayaran supplier di laporan ini).</div>` : ""}
    </div>
    <div class="note"><b>Catatan:</b> Laporan ini merupakan representasi hasil rekon yang sudah tersimpan — tidak membuat/mengubah pembayaran maupun alokasi. Biaya admin bank bukan pembayaran supplier: tidak ditampilkan sebagai transaksi, hanya diringkas di bagian D. Sisa keseluruhan supplier mencakup seluruh tagihan supplier, bukan hanya PO dalam laporan ini.</div>
    ${docFooter({ docNo: `Rekonsiliasi ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  return html;
}

export function printRekonReport(sup, jobIds, opts) {
  if (!sup) return;
  const html = rekonReportHtml(sup, jobIds, opts);
  const w = window.open("", "aal_print"); w.document.write(html); w.document.close();
}
