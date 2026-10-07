/* eslint-disable */
/* RINGKASAN SELISIH HARGA — cetak A4 sisi-browser (teks vektor, tanpa server/Chromium), format sama
   dengan Ringkasan Supplier. Presentasi saja: membaca data PIC yang sudah tersimpan. */
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const fTgl = (s) => { if (!s) return "-"; const [y, m, d] = String(s).slice(0, 10).split("-"); return y && m && d ? `${d}/${m}/${y}` : s; };

export function selisihAutoDocNo(d) {
  const now = d ? new Date(d) : new Date();
  return `RSH/AAL/${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(2)}/${now.getFullYear()}`;
}

/* Riwayat pembayaran = TRANSAKSI BANK aktual: 1 transfer (batch_id) yang dibagi ke beberapa tagihan = 1 baris. */
export function selisihPayments(tagihan) {
  const map = new Map(), order = [];
  (tagihan || []).forEach((tg) => (tg.payments || []).forEach((p) => {
    const key = p.batch_id || p.id;
    if (!map.has(key)) { map.set(key, { tanggal: p.tanggal || "", amount: 0 }); order.push(key); }
    const b = map.get(key);
    b.amount += Number(p.amount) || 0;
    if (!b.tanggal && p.tanggal) b.tanggal = p.tanggal;
  }));
  return order.map((k) => map.get(k)).sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
}

export function selisihA4Html(pic, opts = {}) {
  const tagihan = pic.tagihan || [];
  const noDoc = (opts.noDoc && String(opts.noDoc).trim()) || selisihAutoDocNo();
  const tgl = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const totalSelisih = Number(pic.grand_total_selisih) || tagihan.reduce((s, t) => s + (Number(t.total_selisih) || 0), 0);
  const totalBayar = Number(pic.grand_total_terbayar) || tagihan.reduce((s, t) => s + (Number(t.total_terbayar) || 0), 0);
  const sisa = pic.grand_sisa != null ? Number(pic.grand_sisa) : totalSelisih - totalBayar;
  const lunas = totalSelisih > 0 && sisa <= 0;
  const unitCount = tagihan.reduce((s, t) => s + (t.items || []).length, 0);
  const pays = selisihPayments(tagihan);

  const groups = tagihan.map((tg) => {
    const its = tg.items || [];
    const rows = its.map((it, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(it.vehicle_type || "—")}</b>${it.no_unit ? `<div class="rp-note">${esc(it.no_unit)}</div>` : ""}</td>
      <td>${esc(it.asal_kota || "—")} → ${esc(it.tujuan_kota || "—")}</td>
      <td class="r">${rp(it.harga_deal)}</td><td class="r">${rp(it.harga_invoice)}</td><td class="r"><b>${rp(it.selisih)}</b></td></tr>`).join("");
    const lunasTg = !!tg.lunas;
    return `<tr class="grp"><td colspan="6"><div class="grp-in"><span class="gname">${esc(tg.no_invoice || "(tanpa nomor)")}</span><span class="gunit">${its.length} UNIT${tg.catatan ? ` · ${esc(tg.catatan)}` : ""}</span></div></td></tr>
      ${rows || `<tr><td colspan="6" class="c" style="color:#64748b">Belum ada unit.</td></tr>`}
      <tr class="grpsub"><td class="lbl" colspan="3">Subtotal · ${esc(tg.no_invoice || "(tanpa nomor)")}</td>
        <td class="r" colspan="2">Dibayar ${rp(tg.total_terbayar)} · Sisa <b>${rp(tg.sisa)}</b></td>
        <td class="r"><b>${rp(tg.total_selisih)}</b> <span class="rp-st ${lunasTg ? "y" : "n"}">${lunasTg ? "Lunas" : "Belum"}</span></td></tr>`;
  }).join("");

  const payBody = pays.map((p, i) => `<tr><td class="c">${String(i + 1).padStart(2, "0")}</td><td>${fTgl(p.tanggal)}</td>
      <td class="r"><b>${rp(p.amount)}</b></td><td class="r"><span class="pill-ok">Diterima</span></td></tr>`).join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(noDoc)}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 11px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    .rps-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:14px; }
    .rps-billto .lbl { font-size:10px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .rps-billto .val { font-size:15px; font-weight:800; color:${DOC_BRAND.ink}; }
    .rps-meta-table { border-collapse:collapse; font-size:11px; }
    .rps-meta-table td { padding:3px 0; } .rps-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .rps-meta-table td:last-child { font-weight:700; text-align:right; }
    .rps-sec { margin:18px 0 7px; padding-bottom:4px; border-bottom:1px solid #c3ccd8; break-after:avoid; page-break-after:avoid; }
    .rps-sec .txt { font-size:10px; font-weight:800; color:${DOC_BRAND.ink}; letter-spacing:1.2px; text-transform:uppercase; }
    table.rps { width:100%; border-collapse:collapse; margin-bottom:4px; }
    table.rps thead { display:table-header-group; }
    table.rps tbody tr, table.rps tfoot tr { break-inside:avoid; page-break-inside:avoid; }
    table.rps th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.4px; color:#475569; background:#fff; font-weight:700; padding:4px 7px; white-space:nowrap; border-bottom:1px solid #94a3b8; }
    table.rps th.r { text-align:right; } table.rps th.c { text-align:center; }
    table.rps td { padding:4px 7px; font-size:9.5px; line-height:1.2; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.rps td.c { text-align:center; } table.rps td.r { text-align:right; white-space:nowrap; }
    .rp-note { font-size:8px; color:#475569; margin-top:1px; }
    .rp-st { font-size:8px; font-weight:700; } .rp-st.y { color:#0f7a4d; } .rp-st.n { color:#b45309; }
    .pill-ok { display:inline-block; font-size:8px; font-weight:700; color:#0f7a4d; background:#e7f6ee; border:1px solid #b6e2ca; border-radius:20px; padding:1px 8px; }
    table.rps tr.grp td { padding:7px 2px 4px; border-top:1px solid #c3ccd8; border-bottom:1px solid #e3e6ec; background:#fff; }
    table.rps tr.grp { break-after:avoid; page-break-after:avoid; }
    table.rps tr.grp .grp-in { display:flex; justify-content:space-between; align-items:baseline; gap:12px; }
    table.rps tr.grp .gname { font-size:10.5px; font-weight:800; letter-spacing:.4px; text-transform:uppercase; }
    table.rps tr.grp .gunit { font-size:8.5px; font-weight:700; color:#475569; letter-spacing:.5px; }
    table.rps tr.grpsub td { background:#fbfcfd; color:#334155; font-weight:700; font-size:8.5px; border-bottom:1px solid #94a3b8; }
    table.rps tr.grpsub .lbl { text-align:right; }
    table.rps tfoot .tot td { border-top:1.5px solid ${DOC_BRAND.ink}; border-bottom:none; padding:6px 7px; font-size:10px; font-weight:800; }
    .rps-bar { display:flex; justify-content:space-between; align-items:baseline; border-top:1px solid #94a3b8; padding:6px 4px 0; margin-top:2px; }
    .rps-bar .lbl { font-weight:700; font-size:9px; color:#475569; text-transform:uppercase; letter-spacing:.6px; } .rps-bar .val { font-weight:800; font-size:11px; }
    .rps-sum { width:62%; max-width:330px; margin:10px 0 0 auto; }
    .rps-sum .row { display:flex; justify-content:space-between; align-items:baseline; padding:4px 2px; font-size:10px; }
    .rps-sum .row .k { color:#334155; font-weight:600; font-size:9px; } .rps-sum .row .v { font-weight:700; }
    .rps-sum .row.sisa { border-top:1px solid #94a3b8; margin-top:3px; padding-top:8px; }
    .rps-sum .row.sisa .k { font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; color:${DOC_BRAND.ink}; }
    .rps-sum .row.sisa .v { font-size:17px; font-weight:900; line-height:1.05; }
    .rps-sum .badge-row { text-align:right; margin-top:6px; }
    .rps-pill { display:inline-block; font-size:8.5px; font-weight:800; letter-spacing:.6px; border-radius:20px; padding:2px 10px; text-transform:uppercase; }
    .rps-pill.ok { color:#0f7a4d; background:#e7f6ee; border:1px solid #b6e2ca; } .rps-pill.due { color:#b45309; background:#fdf3e3; border:1px solid #f0d59b; }
    .avoid-break { break-inside:avoid; page-break-inside:avoid; }
    .rps-note { font-size:8.5px; color:#475569; line-height:1.6; margin-top:14px; }
    @page { size:A4 portrait; margin:8mm; }
    @media print { @page { size:A4 portrait; margin:8mm; } }
    @media screen and (max-width: 640px) { body { font-size: 12px; padding:8px; } table.rps td, table.rps th { font-size: 11px; } .rps-meta-row { flex-direction: column; gap:8px; } }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "RINGKASAN SELISIH HARGA" })}
    <div class="rps-meta-row">
      <div class="rps-billto"><div class="lbl">PIC Purchasing</div><div class="val">${esc(pic.nama || "-")}</div></div>
      <table class="rps-meta-table">
        <tr><td>No. Dokumen</td><td>${esc(noDoc)}</td></tr>
        <tr><td>Tanggal</td><td>${tgl}</td></tr>
        <tr><td>Jumlah Tagihan / Unit</td><td>${tagihan.length} / ${unitCount}</td></tr>
      </table>
    </div>

    <div class="rps-sec"><span class="txt">Rincian Tagihan (per No. Invoice)</span></div>
    <table class="rps">
      <thead><tr><th class="c" style="width:22px">No</th><th>Unit</th><th>Asal → Tujuan</th>
        <th class="r" style="width:84px">Harga Deal</th><th class="r" style="width:84px">Harga Invoice</th><th class="r" style="width:96px">Selisih</th></tr></thead>
      <tbody>${groups || `<tr><td colspan="6" class="c" style="color:#64748b">Belum ada tagihan.</td></tr>`}</tbody>
      <tfoot><tr class="tot"><td class="r" colspan="5">TOTAL SELISIH</td><td class="r">${rp(totalSelisih)}</td></tr></tfoot>
    </table>

    <div class="rps-sec"><span class="txt">Riwayat Pembayaran</span></div>
    <table class="rps">
      <thead><tr><th class="c" style="width:30px">No</th><th>Tanggal Transfer</th><th class="r" style="width:130px">Nominal</th><th class="r" style="width:76px">Status</th></tr></thead>
      <tbody>${payBody || `<tr><td colspan="4" class="c" style="color:#64748b">Belum ada pembayaran.</td></tr>`}</tbody>
    </table>
    <div class="rps-bar"><span class="lbl">Total Pembayaran</span><span class="val">${rp(totalBayar)}</span></div>

    <div class="rps-sec avoid-break"><span class="txt">Posisi Akhir</span></div>
    <div class="rps-sum avoid-break">
      <div class="row"><span class="k">Total Selisih</span><span class="v">${rp(totalSelisih)}</span></div>
      <div class="row"><span class="k">Total Pembayaran</span><span class="v">${rp(totalBayar)}</span></div>
      <div class="row sisa"><span class="k">${lunas ? "Lunas" : "Sisa Yang Harus Ditransfer"}</span><span class="v">${rp(Math.max(0, sisa))}</span></div>
      <div class="badge-row"><span class="rps-pill ${lunas ? "ok" : "due"}">${lunas ? "Lunas" : "Belum Lunas"}</span></div>
    </div>
    <div class="rps-note"><b>Catatan:</b> Selisih = Harga Invoice &minus; Harga Deal per unit, dicatat &amp; ditransfer per tagihan (No. Invoice). Riwayat pembayaran = transaksi transfer aktual (1 transfer = 1 baris). Sisa = Total Selisih &minus; Total Pembayaran. Terima kasih atas kerja sama dan kepercayaannya.</div>
    ${docFooter({ docNo: `Selisih Harga ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
}

export function printSelisihA4(pic, opts) {
  if (!pic) return;
  const html = selisihA4Html(pic, opts);
  const w = window.open("", "aal_print"); w.document.write(html); w.document.close();
}
