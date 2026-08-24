import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/* Cetak Ringkasan Supplier sebagai A4 (teks vektor, kaya Penawaran) — tajam
   walau di-screenshot & kirim WhatsApp, huruf kecil biar muat. */
export function supplierAutoDocNo(d) {
  const now = d ? new Date(d) : new Date();
  return `RPS/AAL/${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(2)}/${now.getFullYear()}`;
}
export function printSupplierA4(sup, jobsOverride, noDocOverride, tglOverride) {
  if (!sup) return;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
  const now = new Date();
  const tgl = (tglOverride ? new Date(`${tglOverride}T00:00:00`) : now).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const noDoc = (noDocOverride && String(noDocOverride).trim()) || supplierAutoDocNo();
  // FORMAT SUPPLIER = laporan TAGIHAN ONGKOS SUPPLIER (source of truth = data
  // supplier existing: total_harga / terbayar / sisa). BUKAN modul Selisih Harga.
  const jobs = (jobsOverride && jobsOverride.length) ? jobsOverride : (sup.jobs || []);
  const sisaOf = (j) => (j.sisa != null ? j.sisa : ((j.total_harga || 0) - (j.total_terbayar || 0)));
  const gHarga = jobs.reduce((s, j) => s + (j.total_harga || 0), 0);   // TOTAL TAGIHAN supplier
  // RIWAYAT PEMBAYARAN = transaksi bank AKTUAL. 1 transfer (batch_id) yang dialokasikan
  // ke beberapa unit = 1 baris (nominal transfer asli), JANGAN dipecah per unit.
  const _bankMap = new Map();
  const _bankOrder = [];
  jobs.forEach((j) => (j.payments || []).forEach((p) => {
    const key = p.batch_id || p.id;
    if (!_bankMap.has(key)) { _bankMap.set(key, { tanggal: p.tanggal || "", amount: 0 }); _bankOrder.push(key); }
    const b = _bankMap.get(key);
    b.amount += (p.amount || 0);
    if (!b.tanggal && p.tanggal) b.tanggal = p.tanggal;
  }));
  const payTx = _bankOrder.map((k) => _bankMap.get(k)).sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  const gBayar = jobs.reduce((s, j) => s + (j.payments || []).reduce((a, p) => a + (p.amount || 0), 0), 0);
  const gSisa = gHarga - gBayar;          // SISA = Total Tagihan - Total Pembayaran
  const over = gSisa < 0;                 // pembayaran > tagihan -> Lebih Bayar
  const lunas = gHarga > 0 && gSisa === 0;

  // Grouping per Projek (existing dipertahankan).
  const projList = sup.projects || [];
  const projOrder = projList.map((p) => p.id);
  const byPid = new Map();
  jobs.forEach((j) => { const pid = j.project_id || "_none"; if (!byPid.has(pid)) byPid.set(pid, []); byPid.get(pid).push(j); });
  const pids = [...projOrder.filter((id) => byPid.has(id)), ...[...byPid.keys()].filter((id) => !projOrder.includes(id))];
  const nameOf = (pid) => pid === "_none" ? "Tanpa Grup" : ((projList.find((x) => x.id === pid) || {}).nama || "Grup");
  const multi = pids.length > 1;
  let idx = 0;
  const rowHtml = (j) => {
    idx++;
    const nopol = j.nopol || j.no_rangka || "-";
    const rute = `${j.asal_kota || "-"} → ${j.tujuan_kota || "-"}`;
    const jl = sisaOf(j) <= 0;
    return `<tr>
      <td class="c">${idx}</td>
      <td><b>${esc(nopol)}</b><div class="rp-note">${esc(j.vehicle_type || "Unit")}</div></td>
      <td>${esc(rute)}</td>
      <td class="r">${rp(j.total_harga)}</td>
      <td class="r">${rp(j.total_terbayar || 0)}</td>
      <td class="r"><b>${rp(sisaOf(j))}</b></td>
      <td class="c"><span class="rp-st ${jl ? "y" : "n"}">${jl ? "Lunas" : "Sisa"}</span></td>
    </tr>`;
  };
  const body = pids.map((pid) => {
    const gj = byPid.get(pid);
    const sH = gj.reduce((s, j) => s + (j.total_harga || 0), 0);
    const sB = gj.reduce((s, j) => s + (j.total_terbayar || 0), 0);
    const head = multi ? `<tr class="grp"><td class="c">📁</td><td colspan="2"><b>${esc(nameOf(pid))}</b> · ${gj.length} unit</td><td class="r">${rp(sH)}</td><td class="r">${rp(sB)}</td><td class="r"><b>${rp(sH - sB)}</b></td><td></td></tr>` : "";
    const rows = gj.map(rowHtml).join("");
    const sub = multi ? `<tr class="grpsub"><td class="lbl" colspan="3">Subtotal ${esc(nameOf(pid))}</td><td class="r">${rp(sH)}</td><td class="r">${rp(sB)}</td><td class="r">${rp(sH - sB)}</td><td></td></tr>` : "";
    return head + rows + sub;
  }).join("");

  const payBody = payTx.map((p, i) => `<tr>
      <td class="c">${String(i + 1).padStart(2, "0")}</td>
      <td>${fDate(p.tanggal) || "-"}</td>
      <td class="r"><b>${rp(p.amount)}</b></td>
      <td class="c gd">&#10003; Diterima</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
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
    .rps-sec { display:flex; align-items:center; gap:7px; margin:16px 0 6px; }
    .rps-sec .bar { width:3px; height:13px; background:${DOC_BRAND.gold}; border-radius:2px; }
    .rps-sec .txt { font-size:10.5px; font-weight:800; color:${DOC_BRAND.ink}; letter-spacing:.5px; text-transform:uppercase; }
    table.rps { width:100%; border-collapse:collapse; margin-bottom:4px; }
    table.rps thead { display:table-header-group; }
    table.rps tbody tr, table.rps tfoot tr { break-inside:avoid; page-break-inside:avoid; }
    table.rps th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.3px; color:#334155; background:#f1f5f9; font-weight:700; padding:4px 7px; white-space:nowrap; border-bottom:1.5px solid #cbd5e1; }
    table.rps th.r { text-align:right; } table.rps th.c { text-align:center; }
    table.rps td { padding:3.5px 7px; font-size:9.5px; line-height:1.2; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.rps td.c { text-align:center; } table.rps td.r { text-align:right; white-space:nowrap; }
    table.rps td.gd { color:#0f7a4d; font-weight:700; font-size:9px; }
    table.rps .rp-note { font-size:8px; color:${DOC_BRAND.muted}; margin-top:1px; }
    table.rps .rp-st { font-size:8px; font-weight:800; border-radius:20px; padding:1px 8px; }
    table.rps .rp-st.y { background:#dcfce7; color:#166534; } table.rps .rp-st.n { background:#fef3c7; color:#92400e; }
    table.rps tr.grp td { background:#eef2f7; color:${DOC_BRAND.navy}; font-weight:800; font-size:9px; padding:4px 7px; border-top:1px solid #cbd5e1; border-bottom:1px solid #cbd5e1; }
    table.rps tr.grp td:first-child { border-left:3px solid ${DOC_BRAND.gold}; }
    table.rps tr.grpsub td { background:#f8fafc; color:#334155; font-weight:800; font-size:8.5px; border-bottom:1.5px solid #94a3b8; }
    table.rps tr.grpsub .lbl { text-align:right; }
    table.rps tfoot .tot td { border-top:2px solid ${DOC_BRAND.navy}; border-bottom:none; padding:6px 7px; font-size:10px; font-weight:900; background:#fff; color:${DOC_BRAND.ink}; }
    table.rps tfoot .tot .lbl { text-align:right; }
    .rps-bar { display:flex; justify-content:space-between; align-items:center; border-top:2px solid ${DOC_BRAND.navy}; padding:6px 4px 0; margin-top:2px; }
    .rps-bar .lbl { font-weight:900; font-size:10.5px; color:${DOC_BRAND.navy}; text-transform:uppercase; letter-spacing:.3px; }
    .rps-bar .val { font-weight:900; font-size:11.5px; color:${DOC_BRAND.ink}; }
    /* Ringkasan akhir — Sisa dominan (navy box), samain karakter dgn Ringkasan Selisih */
    .rps-sum { width:62%; max-width:340px; margin:8px 0 0 auto; }
    .rps-sum .row { display:flex; justify-content:space-between; padding:4px 2px; font-size:10px; border-bottom:1px solid ${DOC_BRAND.line}; }
    .rps-sum .row .k { color:#333; text-transform:uppercase; letter-spacing:.3px; font-weight:600; font-size:9px; }
    .rps-sum .row .v { font-weight:700; }
    .rps-sisa { margin-top:7px; background:${over ? "#7a3b0f" : DOC_BRAND.navy}; border-radius:8px; padding:10px 14px; }
    .rps-sisa .k { font-size:8.5px; font-weight:700; letter-spacing:.7px; color:#e8c98a; text-transform:uppercase; }
    .rps-sisa .v { font-size:18px; font-weight:900; color:#fff; margin-top:1px; line-height:1.05; }
    .rps-sisa .lunas { font-size:17px; font-weight:900; color:#fff; letter-spacing:.5px; }
    .rps-note { font-size:9.5px; color:${DOC_BRAND.muted}; line-height:1.6; margin-top:12px; }
    @page { size:A4 portrait; margin:8mm; }
    @media print { @page { size:A4 portrait; margin:8mm; } thead{display:table-header-group;} tbody tr{break-inside:avoid;} .avoid-break{break-inside:avoid;page-break-inside:avoid;} }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "RINGKASAN SUPPLIER" })}
    <div class="rps-meta-row">
      <div class="rps-billto"><div class="lbl">Supplier</div><div class="val">${esc(sup.nama || "-")}</div></div>
      <table class="rps-meta-table">
        <tr><td>No. Dokumen</td><td>${noDoc}</td></tr>
        <tr><td>Tanggal</td><td>${tgl}</td></tr>
        <tr><td>Jumlah Unit</td><td>${jobs.length}</td></tr>
      </table>
    </div>

    <div class="rps-sec"><span class="bar"></span><span class="txt">Rincian Tagihan Supplier</span></div>
    <table class="rps">
      <thead><tr>
        <th class="c" style="width:22px">No</th><th>No. Polisi / Unit</th><th>Rute</th>
        <th class="r" style="width:86px">Total Harga</th><th class="r" style="width:82px">Terbayar</th><th class="r" style="width:82px">Sisa</th><th class="c" style="width:46px">Status</th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="7" class="c" style="color:${DOC_BRAND.muted}">Belum ada unit.</td></tr>`}</tbody>
      <tfoot><tr class="tot"><td class="lbl" colspan="3">TOTAL</td><td class="r">${rp(gHarga)}</td><td class="r">${rp(gBayar)}</td><td class="r">${rp(gSisa)}</td><td></td></tr></tfoot>
    </table>

    <div class="rps-sec"><span class="bar"></span><span class="txt">Riwayat Pembayaran</span></div>
    <table class="rps">
      <thead><tr>
        <th class="c" style="width:30px">No.</th><th>Tanggal Transfer</th>
        <th class="r" style="width:130px">Nominal</th><th class="c" style="width:80px">Status</th>
      </tr></thead>
      <tbody>${payBody || `<tr><td colspan="4" class="c" style="color:${DOC_BRAND.muted}">Belum ada pembayaran.</td></tr>`}</tbody>
    </table>
    <div class="rps-bar"><span class="lbl">Total Pembayaran</span><span class="val">${rp(gBayar)}</span></div>

    <div class="rps-sec avoid-break"><span class="bar"></span><span class="txt">Ringkasan</span></div>
    <div class="rps-sum avoid-break">
      <div class="row"><span class="k">Total Tagihan Supplier</span><span class="v">${rp(gHarga)}</span></div>
      <div class="row"><span class="k">Total Pembayaran</span><span class="v">${rp(gBayar)}</span></div>
      <div class="rps-sisa">
        ${over
          ? `<div class="k">Lebih Bayar (Overpayment)</div><div class="v">${rp(Math.abs(gSisa))}</div>`
          : lunas
            ? `<div class="lunas">&#10003; LUNAS</div>`
            : `<div class="k">Sisa Yang Harus Ditransfer</div><div class="v">${rp(gSisa)}</div>`}
      </div>
      <div style="text-align:right; margin-top:6px; font-size:9.5px; font-weight:700; color:${over ? "#b45309" : lunas ? "#0f7a4d" : DOC_BRAND.muted}">
        Status: ${over ? "OVERPAYMENT" : lunas ? "LUNAS" : "BELUM LUNAS"}
      </div>
    </div>

    <div class="rps-note"><b>Catatan:</b> Ringkasan tagihan ke supplier. Sisa = Total Tagihan Supplier &minus; Total Pembayaran. Riwayat pembayaran = transaksi transfer aktual (1 transfer = 1 baris). Konfirmasi: <b>${DOC_BRAND.phone}</b>.</div>
    ${docFooter({ docNo: `Ringkasan ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "aal_print"); w.document.write(html); w.document.close();
}

/* FORMAT 2 — KEPALA ROMBONGAN / DRIVER. Sumber data SAMA (jobs + payments),
   cuma presentation lebih sederhana + riwayat DP/pelunasan kronologis.
   Total Ongkos / Terbayar / Sisa IDENTIK dengan format Perusahaan. */
export function printDriverRekapA4(sup, jobsOverride, noDocOverride, tglOverride) {
  if (!sup) return;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
  const now = new Date();
  const tgl = (tglOverride ? new Date(`${tglOverride}T00:00:00`) : now).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const noDoc = (noDocOverride && String(noDocOverride).trim()) || supplierAutoDocNo();
  const jobs = (jobsOverride && jobsOverride.length) ? jobsOverride : (sup.jobs || []);
  const gHarga = jobs.reduce((s, j) => s + (j.total_harga || 0), 0);   // Total Ongkos (deal + tambahan)
  // TOTAL PEMBAYARAN = SUM seluruh record payment aktual (= jumlah baris yang
  // ditampilkan di Riwayat Pembayaran). Dihitung langsung dari payments biar
  // tidak pernah nyimpang dari transaksi yang tampil.
  const gBayar = jobs.reduce((s, j) => s + (j.payments || []).reduce((a, p) => a + (p.amount || 0), 0), 0);
  const gSisa = gHarga - gBayar;
  const lunas = gSisa <= 0;

  // Render 1 unit -> baris utama + sub-row biaya tambahan. Nomor urut global (rowNo).
  let rowNo = 0;
  const renderUnit = (j) => {
    rowNo += 1;
    const unit = j.nopol || j.no_rangka || "-";
    const rute = `${j.asal_kota || "-"} → ${j.tujuan_kota || "-"}`;
    // Harga deal awal (tanpa tambahan). Fallback: kalau field harga_deal belum ada
    // (data lama), hitung dari total efektif dikurangi total tambahan.
    const tbh = j.tambahan || [];
    const tbhTotal = tbh.reduce((s, t) => s + (t.amount || 0), 0);
    const base = (j.harga_deal != null) ? j.harga_deal : ((j.total_harga || 0) - tbhTotal);
    const baseRow = `<tr>
      <td class="c">${rowNo}</td>
      <td><b>${esc(unit)}</b><div class="dr-note">${esc(j.vehicle_type || "Unit")}</div></td>
      <td>${esc(rute)}</td>
      <td class="r">${rp(base)}</td>
    </tr>`;
    // Sub-row biaya tambahan milik unit di atasnya (indent + ↳ + aksen gold tipis).
    const addRows = tbh.map((t) => `<tr class="dr-add">
      <td class="c"></td>
      <td colspan="2" class="dr-add-lbl">&#8627; ${esc(t.label)}</td>
      <td class="r">${rp(t.amount)}</td>
    </tr>`).join("");
    return baseRow + addRows;
  };
  // TAG / JUDUL KELOMPOK: kelompokkan unit per tag (urutan kemunculan pertama).
  // Tag = pembatas visual (navy + aksen gold), SATU header per tag, seluruh unit
  // di bawahnya. Unit tanpa tag -> tampil normal tanpa header. Grouping ini murni
  // visual: TIDAK mengubah harga/total/ongkos/payment/sisa (itu dari gHarga/gBayar).
  const _tagOrder = [];
  const _tagMap = new Map();
  jobs.forEach((j) => {
    const tg = (j.tag || "").trim();
    if (!_tagMap.has(tg)) { _tagMap.set(tg, []); _tagOrder.push(tg); }
    _tagMap.get(tg).push(j);
  });
  const jobRows = _tagOrder.map((tg) => {
    const rowsHtml = _tagMap.get(tg).map(renderUnit).join("");
    if (!tg) return rowsHtml; // tanpa tag -> tanpa header
    return `<tr class="dr-tag"><td colspan="4">${esc(tg)}</td></tr>` + rowsHtml;
  }).join("");

  // RIWAYAT PEMBAYARAN = transaksi pembayaran AKTUAL (cocok 1:1 dgn rekening koran).
  // Sumber = record `payments` existing. 1 transfer ke banyak unit disimpan sbg
  // beberapa record ber-batch_id sama -> digabung jadi SATU transaksi (dijumlahkan),
  // JANGAN dipecah per unit & JANGAN diberi label DP. Transaksi beda (walau tanggal
  // sama) tetap baris terpisah. Urut kronologis by tanggal; tanggal sama -> urutan
  // pencatatan dipertahankan (encounter order + stable sort).
  const _txMap = new Map();
  const _txOrder = [];
  jobs.forEach((j) => (j.payments || []).forEach((p) => {
    const key = p.batch_id || p.id;
    if (!_txMap.has(key)) { _txMap.set(key, { tanggal: p.tanggal || "", amount: 0 }); _txOrder.push(key); }
    _txMap.get(key).amount += (p.amount || 0);
  }));
  const payTx = _txOrder.map((k) => _txMap.get(k));
  payTx.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  const payRows = payTx.map((t, i) => `<div class="pay-row">
      <span class="pay-chk">&#10003;</span>
      <span class="pay-no">${String(i + 1).padStart(2, "0")}</span>
      <span class="pay-date2">${fDate(t.tanggal) || "-"}</span>
      <span class="pay-amt">${rp(t.amount)}</span>
    </div>`).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 12px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    .dr-kr { margin: 4px 0 10px; font-size: 13px; } .dr-kr b { color:${DOC_BRAND.ink}; }
    .dr-meta { display:flex; justify-content:space-between; font-size:11px; color:${DOC_BRAND.muted}; margin-bottom:8px; }
    .dr-sec { font-size:11px; font-weight:800; color:${DOC_BRAND.ink}; letter-spacing:.4px; margin:16px 0 6px; text-transform:uppercase; }
    table.dr { width:100%; border-collapse:collapse; }
    table.dr th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.3px; color:#334155; background:#f1f5f9; font-weight:700; padding:6px 8px; border-bottom:1.5px solid #cbd5e1; }
    table.dr th.r { text-align:right; } table.dr th.c { text-align:center; }
    table.dr td { padding:6px 8px; font-size:10px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.dr td.c { text-align:center; } table.dr td.r { text-align:right; white-space:nowrap; }
    table.dr .dr-note { font-size:8px; color:${DOC_BRAND.muted}; margin-top:2px; }
    table.dr tfoot td { border-top:2px solid #334155; border-bottom:none; font-weight:800; font-size:11px; padding:7px 8px; }
    /* Header Tag/Judul Kelompok: pembatas navy + aksen gold (bukan row unit biasa) */
    table.dr tr.dr-tag td { background:${DOC_BRAND.navy}; color:#ffffff; font-weight:800; font-size:10.5px; letter-spacing:.6px; text-transform:uppercase; padding:8px 11px; border-left:4px solid ${DOC_BRAND.gold}; border-bottom:none; }
    /* Sub-row biaya tambahan: indent + aksen gold tipis, hemat ruang */
    table.dr tr.dr-add td { padding:3px 8px; background:#fbf7ef; border-bottom:1px solid ${DOC_BRAND.line}; }
    table.dr tr.dr-add .dr-add-lbl { padding-left:18px; font-size:9px; font-weight:600; color:#8a6d1f; border-left:2px solid ${DOC_BRAND.gold}; }
    table.dr tr.dr-add td.r { font-size:9px; font-weight:700; color:${DOC_BRAND.ink}; }
    .dr-pel { color:#065f46; }
    .dr-sum { width:62%; max-width:340px; margin:12px 0 0 auto; }
    .dr-sum .row { display:flex; justify-content:space-between; padding:6px 2px; font-size:12px; border-bottom:1px solid ${DOC_BRAND.line}; }
    .dr-sum .row span:last-child { font-weight:700; color:${DOC_BRAND.ink}; }
    .dr-sum .row.tot { border-top:2px solid ${DOC_BRAND.navy}; border-bottom:none; margin-top:2px; padding-top:8px; }
    .dr-sum .row.tot span { font-size:15px; font-weight:900; }
    .dr-status { display:inline-block; font-size:11px; font-weight:800; border-radius:6px; padding:3px 12px; }
    .dr-status.y { background:#d1fae5; color:#065f46; } .dr-status.n { background:#fef2f2; color:#991b1b; }

    /* ── Section header dgn gold accent bar ── */
    .dr-sec2 { display:flex; align-items:center; gap:8px; margin:18px 0 8px; }
    .dr-sec2 .bar { width:4px; height:15px; background:${DOC_BRAND.gold}; border-radius:2px; flex-shrink:0; }
    .dr-sec2 .txt { font-size:11px; font-weight:800; color:${DOC_BRAND.ink}; letter-spacing:.5px; text-transform:uppercase; }

    /* ── Riwayat Pembayaran (list transaksi aktual, cocok rekening koran) ── */
    .pay-box { border:1px solid ${DOC_BRAND.line}; border-radius:9px; overflow:hidden; }
    .pay-box .pay-head { background:${DOC_BRAND.paperMist}; border-bottom:1px solid ${DOC_BRAND.line}; border-top:3px solid ${DOC_BRAND.gold}; padding:6px 14px; display:flex; align-items:center; gap:10px; }
    .pay-box .pay-head span { font-size:8.5px !important; font-weight:700 !important; color:#334155 !important; letter-spacing:.4px; text-transform:uppercase; }
    .pay-row { display:flex; align-items:center; gap:10px; padding:8px 14px; border-bottom:1px solid #eef0f4; }
    .pay-row:last-child { border-bottom:none; }
    .pay-chk { color:${DOC_BRAND.gold}; font-weight:900; font-size:12px; width:13px; flex-shrink:0; text-align:center; }
    .pay-no { font-weight:800; color:${DOC_BRAND.navy}; font-size:11px; width:26px; flex-shrink:0; }
    .pay-date2 { font-weight:700; color:${DOC_BRAND.ink}; font-size:11.5px; flex:1; letter-spacing:.2px; white-space:nowrap; }
    .pay-amt { font-weight:800; color:${DOC_BRAND.ink}; font-size:11.5px; text-align:right; white-space:nowrap; min-width:108px; }
    .pay-empty { padding:12px 14px; color:${DOC_BRAND.muted}; font-size:10px; text-align:center; }
    .pay-total { display:flex; align-items:center; gap:10px; padding:9px 14px; border-top:2px solid ${DOC_BRAND.navy}; background:${DOC_BRAND.paperMist}; }
    .pay-total .pay-chk { font-size:13px; }
    .pay-total-lbl { flex:1; font-weight:900; font-size:11.5px; color:${DOC_BRAND.navy}; letter-spacing:.3px; text-transform:uppercase; }
    .pay-total-amt { font-weight:900; font-size:13.5px; color:${DOC_BRAND.ink}; white-space:nowrap; }

    /* ── Ringkasan (hierarki jelas, Sisa dominan) ── */
    .sum2 { width:64%; max-width:348px; margin:10px 0 0 auto; }
    .sum2-line { display:flex; justify-content:space-between; align-items:baseline; padding:7px 2px; border-bottom:1px solid ${DOC_BRAND.line}; }
    .sum2-k { font-size:10.5px; color:#333; font-weight:600; letter-spacing:.3px; text-transform:uppercase; }
    .sum2-v { font-size:12.5px; font-weight:700; color:${DOC_BRAND.ink}; white-space:nowrap; }
    .sum2-sisa { margin-top:10px; background:${DOC_BRAND.navy}; border-radius:9px; padding:13px 16px; }
    .sum2-sisa-k { font-size:9.5px; font-weight:700; letter-spacing:.7px; color:#e8c98a; text-transform:uppercase; }
    .sum2-sisa-v { font-size:23px; font-weight:900; color:#ffffff; margin-top:2px; line-height:1.05; }
    .sum2-badge { display:inline-block; margin-top:10px; font-size:10px; font-weight:800; border-radius:6px; padding:4px 13px; letter-spacing:.5px; }
    .sum2-badge.y { background:#e8c98a; color:${DOC_BRAND.navyDeep}; }
    .sum2-badge.n { background:#ffffff; color:${DOC_BRAND.navy}; }

    @page { size:A4 portrait; margin:10mm; }
    @media print { @page { size:A4 portrait; margin:10mm; } }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "REKAP PEKERJAAN & PEMBAYARAN DRIVER" })}
    <div class="dr-kr">Kepala Rombongan : <b>${esc(sup.nama || "-")}</b></div>
    <div class="dr-meta"><span>No. Dokumen: <b>${noDoc}</b></span><span>Tanggal: <b>${tgl}</b> &middot; ${jobs.length} unit</span></div>

    <div class="dr-sec">Rincian Pekerjaan</div>
    <table class="dr">
      <thead><tr><th class="c" style="width:26px">No</th><th>Nopol / Unit</th><th>Rute</th><th class="r" style="width:120px">Ongkos</th></tr></thead>
      <tbody>${jobRows}</tbody>
      <tfoot><tr><td colspan="3" class="r">TOTAL ONGKOS</td><td class="r">${rp(gHarga)}</td></tr></tfoot>
    </table>

    <div class="dr-sec2"><span class="bar"></span><span class="txt">Riwayat Pembayaran</span></div>
    <div class="pay-box">
      <div class="pay-head"><span class="pay-chk"></span><span class="pay-no">No.</span><span class="pay-date2">Tanggal Transfer</span><span class="pay-amt">Nominal</span></div>
      ${payRows || `<div class="pay-empty">Belum ada pembayaran</div>`}
      <div class="pay-total">
        <span class="pay-chk">&#10003;</span>
        <span class="pay-total-lbl">Total Pembayaran</span>
        <span class="pay-total-amt">${rp(gBayar)}</span>
      </div>
    </div>

    <div class="dr-sec2"><span class="bar"></span><span class="txt">Ringkasan</span></div>
    <div class="sum2">
      <div class="sum2-line"><span class="sum2-k">Total Ongkos</span><span class="sum2-v">${rp(gHarga)}</span></div>
      <div class="sum2-line"><span class="sum2-k">Total Pembayaran</span><span class="sum2-v">${rp(gBayar)}</span></div>
      <div class="sum2-sisa">
        <div class="sum2-sisa-k">Sisa Pembayaran</div>
        <div class="sum2-sisa-v">${rp(gSisa)}</div>
        <span class="sum2-badge ${lunas ? "y" : "n"}">${lunas ? "&#10003; STATUS: LUNAS" : "STATUS: BELUM LUNAS"}</span>
      </div>
    </div>
    ${docFooter({ docNo: `Rekap Driver ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "aal_print"); w.document.write(html); w.document.close();
}

/* ── util ── */
function fRp(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
function pNum(s) { const n = parseInt(String(s || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; }
function onlyDigits(s) { return String(s || "").replace(/[^0-9]/g, ""); }
function fmtRpInput(s) { const d = onlyDigits(s); return d ? Number(d).toLocaleString("id-ID") : ""; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function fDate(s) { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); if (!y || !m || !d) return s; return `${d}/${m}/${y}`; }
function statusOf(job) { if ((job.sisa || 0) <= 0) return "lunas"; if ((job.total_terbayar || 0) > 0) return "sebagian"; return "belum"; }

/* ── style tokens (dark financial) ── */
const C = { bg: "#0d1117", card: "#161b22", line: "#21262d", inpBg: "#0d1117", inpLine: "#30363d",
  ink: "#e6edf3", mute: "#8b949e", gold: "#EF9F27", green: "#3fb950", yellow: "#e6b450", red: "#f85149", blue: "#58a6ff" };
const I = { background: C.inpBg, border: `1px solid ${C.inpLine}`, borderRadius: 10, padding: "12px 14px", color: C.ink, fontSize: 16, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
const L = { fontSize: 11, color: C.mute, display: "block", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "13px 18px", borderRadius: 10, border: "none", background: C.gold, color: "#1a1208", fontWeight: 800, fontSize: 15, cursor: "pointer", minHeight: 48 };
const BTN_GHOST = { padding: "11px 16px", borderRadius: 10, border: `1px solid ${C.inpLine}`, background: "none", color: "#c9d1d9", fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 44 };

const ST = { belum: { t: "Belum Bayar", c: C.red, bg: "#2d1214" }, sebagian: { t: "Sebagian", c: C.yellow, bg: "#2a2410" }, lunas: { t: "Lunas", c: C.green, bg: "#0d2818" } };
function Badge({ status }) {
  const m = ST[status] || ST.belum;
  return <span style={{ fontSize: 11, fontWeight: 800, color: m.c, background: m.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>{m.t}</span>;
}

export default function SupplierPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);
  const selectingRef = useRef(false); // lagi klik saran → jangan auto-bikin baru
  const autoSaveTimer = useRef(null);
  const [toast, setToast] = useState("");
  const [listRefreshTick, setListRefreshTick] = useState(0);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); };

  const [tab, setTab] = useState("pembayaran"); // default: Pembayaran (dipakai tiap hari)
  const [filter, setFilter] = useState("semua");
  const [menuOpen, setMenuOpen] = useState(false);
  // Rekap supplier: No. Dokumen (auto/manual) + cetak / simpan ke Histori Dokumen
  const [rekapOpen, setRekapOpen] = useState(false);
  const [rekapNo, setRekapNo] = useState("");
  const [rekapProj, setRekapProj] = useState("all");   // "all" = semua projek (dipisah), atau id projek tertentu
  const [rekapSel, setRekapSel] = useState(() => new Set()); // id unit yang dicentang utk dicetak/simpan
  const [rekapSaving, setRekapSaving] = useState(false);
  const [formatChooser, setFormatChooser] = useState(null); // { jobs, noDoc, tgl } saat pilih format cetak
  const [rekapTgl, setRekapTgl] = useState("");             // tanggal laporan (bisa diubah manual)
  const openRekap = () => {
    setMenuOpen(false); setRekapNo(supplierAutoDocNo()); setRekapProj("all"); setRekapTgl(todayStr());
    setRekapSel(new Set((selected?.jobs || []).map((j) => j.id))); // default: semua unit dicentang
    setRekapOpen(true);
  };
  // Unit dalam scope projek terpilih (buat ditampilkan di checklist).
  const rekapJobs = () => {
    const all = selected?.jobs || [];
    return rekapProj === "all" ? all : all.filter((j) => (j.project_id || "_none") === rekapProj);
  };
  // Ganti scope projek -> otomatis centang semua unit di scope baru.
  const changeRekapProj = (pid) => {
    setRekapProj(pid);
    const all = selected?.jobs || [];
    const scope = pid === "all" ? all : all.filter((j) => (j.project_id || "_none") === pid);
    setRekapSel(new Set(scope.map((j) => j.id)));
  };
  const toggleRekapUnit = (id) => setRekapSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // Unit final yang benar-benar dicetak/disimpan = scope ∩ dicentang.
  const chosenJobs = () => rekapJobs().filter((j) => rekapSel.has(j.id));
  const rekapProjName = () => (selected?.projects || []).find((p) => p.id === rekapProj)?.nama || "";
  const saveRekapHistori = async () => {
    if (!selected) return;
    const jobs = chosenJobs();
    if (!jobs.length) { flash("Centang minimal 1 unit dulu"); return; }
    setRekapSaving(true);
    try {
      const gHarga = jobs.reduce((s, j) => s + (j.total_harga || 0), 0);
      const gBayar = jobs.reduce((s, j) => s + (j.total_terbayar || 0), 0);
      const noDoc = (rekapNo.trim() || supplierAutoDocNo());
      const suffix = rekapProj === "all" ? "" : ` · ${rekapProjName()}`;
      await axios.post(`${API}/admin/doc-history`, {
        jenis: "supplier", no_dokumen: noDoc, customer: selected.nama || "",
        judul: `${selected.nama || "-"}${suffix} · ${jobs.length} unit · Rp ${gHarga.toLocaleString("id-ID")}`,
        meta: { supplier_nama: selected.nama, no_dokumen: noDoc, tanggal: rekapTgl, total_harga: gHarga, total_terbayar: gBayar, sisa: gHarga - gBayar, jumlah_unit: jobs.length, projek: rekapProj === "all" ? "Semua" : rekapProjName() },
        units: jobs,
      }, { headers });
      flash("✓ Rekap supplier disimpan ke Histori Dokumen");
      setRekapOpen(false);
    } catch { flash("Gagal menyimpan rekap"); } finally { setRekapSaving(false); }
  };

  // search supplier — instan (internet banking style), tanpa klik Search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try { const r = await axios.get(`${API}/admin/suppliers`, { params: { q: query }, headers }); setDropdown(r.data.items || []); }
      catch { setDropdown([]); }
    }, 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line
  }, [query, listRefreshTick]);

  const reloadSelected = async (id) => {
    try { const r = await axios.get(`${API}/admin/suppliers/${id}`, { headers }); setSelected(r.data); }
    catch { flash("Gagal memuat data supplier"); }
  };
  const selectSupplier = async (s) => { clearTimeout(autoSaveTimer.current); setDropdown([]); setQuery(s.nama); setPaySel({}); await reloadSelected(s.id); };
  const createOrOpenSupplier = async () => {
    if (!query.trim()) { flash("Masukkan nama supplier dulu"); return; }
    try {
      const r = await axios.post(`${API}/admin/suppliers`, { nama: query.trim() }, { headers });
      setQuery(r.data.nama); await reloadSelected(r.data.id); setListRefreshTick((t) => t + 1); flash("Supplier tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan supplier"); }
  };
  // Auto-simpan: selesai ngetik nama baru (blur/Enter) langsung kesimpen —
  // nggak perlu klik tombol. Kalau namanya udah ada, langsung dibuka (backend
  // create_supplier balikin yang sudah ada, jadi nggak dobel). Delay biar klik
  // dropdown menang.
  const autoSaveSupplier = () => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (selectingRef.current) { selectingRef.current = false; return; } // baru klik saran
      const nama = query.trim();
      if (selected || nama.length < 2) return;
      const exact = dropdown.find((s) => (s.nama || "").trim().toLowerCase() === nama.toLowerCase());
      if (exact) { selectSupplier(exact); return; }
      // Masih ada saran yg cocok → jangan bikin nama setengah jadi. User tinggal
      // klik saran, atau tekan tombol "+ Buat / Buka" kalau memang mau bikin baru.
      if (dropdown.length > 0) return;
      createOrOpenSupplier();
    }, 250);
  };

  const jobs = useMemo(() => selected?.jobs || [], [selected]);
  const unpaidJobs = useMemo(() => jobs.filter((j) => (j.sisa || 0) > 0), [jobs]);
  const lastPayDate = useMemo(() => {
    let d = "";
    jobs.forEach((j) => (j.payments || []).forEach((p) => { if ((p.tanggal || "") > d) d = p.tanggal; }));
    return d;
  }, [jobs]);

  /* ═══ TAB PEMBAYARAN (Mekari-style: pilih tagihan → 1 nominal → alokasi) ═══ */
  const [paySel, setPaySel] = useState({}); // job_id -> true
  const [payAmount, setPayAmount] = useState("");
  const [payTanggal, setPayTanggal] = useState(todayStr());
  const [payMetode, setPayMetode] = useState("Transfer");
  const [payCatatan, setPayCatatan] = useState("");
  const [payBukti, setPayBukti] = useState(null);
  const [paySaving, setPaySaving] = useState(false);
  const payFileRef = useRef();

  const selectedPayJobs = useMemo(() => unpaidJobs.filter((j) => paySel[j.id]), [unpaidJobs, paySel]);
  const totalSelSisa = useMemo(() => selectedPayJobs.reduce((s, j) => s + (j.sisa || 0), 0), [selectedPayJobs]);
  const allUnpaidChecked = unpaidJobs.length > 0 && unpaidJobs.every((j) => paySel[j.id]);

  const togglePay = (id) => setPaySel((s) => ({ ...s, [id]: !s[id] }));
  const selectAllUnpaid = () => {
    if (allUnpaidChecked) { setPaySel({}); return; }
    const n = {}; unpaidJobs.forEach((j) => { n[j.id] = true; }); setPaySel(n);
  };
  // Quick payment
  const qpLunas = () => setPayAmount(String(totalSelSisa));
  const qpDP = (pct) => setPayAmount(String(Math.round(totalSelSisa * pct)));
  const qpManual = () => setPayAmount("");

  const doBatchPay = async () => {
    const ids = selectedPayJobs.map((j) => j.id);
    if (!ids.length) { flash("Centang tagihan yang mau dibayar dulu"); return; }
    const amt = pNum(payAmount);
    if (amt <= 0) { flash("Isi / pilih nominal pembayaran dulu"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("supplier_id", selected.id);
      fd.append("job_ids", ids.join(","));
      fd.append("amount", String(amt));
      fd.append("tanggal", payTanggal || todayStr());
      fd.append("metode", payMetode);
      fd.append("catatan", payCatatan.trim());
      if (payBukti) fd.append("bukti", payBukti);
      const r = await axios.post(`${API}/vendor-mobile/pay-batch`, fd, { headers });
      setPaySel({}); setPayAmount(""); setPayCatatan(""); setPayBukti(null); if (payFileRef.current) payFileRef.current.value = "";
      await reloadSelected(selected.id);   // update total/sisa/status tanpa refresh halaman
      setListRefreshTick((t) => t + 1);
      const applied = (r.data?.applied || []).length;
      flash(`Pembayaran ${fRp(r.data?.total_dibayar || amt)} tersimpan → ${applied} tagihan diupdate`);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan pembayaran"); }
    finally { setPaySaving(false); }
  };

  /* ═══ Tambah unit manual (modal) ═══ */
  const blankJobForm = { vehicle_type: "", nopol: "", no_rangka: "", asal_kota: "", tujuan_kota: "", total_harga: "", catatan: "", tanggal: todayStr() };
  const [manualOpen, setManualOpen] = useState(false);
  const [jobForm, setJobForm] = useState(blankJobForm);
  const [jobSaving, setJobSaving] = useState(false);
  // Pilihan projek tujuan saat Tarik / Tambah unit. "" = projek aktif (otomatis),
  // "__new__" = bikin projek baru dgn nama manual, atau id projek yg sudah ada.
  const [jobProjSel, setJobProjSel] = useState("");
  const [jobProjNew, setJobProjNew] = useState("");
  // Tag/Judul Kelompok laporan (pembatas visual PDF) — TERPISAH dari Scope Project.
  const [jobTag, setJobTag] = useState("");
  const resetProjPicker = () => { setJobProjSel(""); setJobProjNew(""); setJobTag(""); };
  // Input Tag/Judul Kelompok — dipakai di modal Tarik & Tambah Manual.
  const renderTagInput = () => (
    <div>
      <div style={{ ...L }}>Tag / Judul Kelompok Laporan <span style={{ textTransform: "none", fontWeight: 400 }}>(opsional)</span></div>
      <input style={I} value={jobTag} onChange={(e) => setJobTag(e.target.value)} placeholder="mis. Pengiriman Sulawesi 0001 / BL 02/SLS-14B" data-testid="sup-job-tag" list="sup-tag-list" />
      {(() => { const tags = [...new Set((selected?.jobs || []).map((j) => (j.tag || "").trim()).filter(Boolean))]; return tags.length ? <datalist id="sup-tag-list">{tags.map((t) => <option key={t} value={t} />)}</datalist> : null; })()}
      <div style={{ fontSize: 11, color: C.mute, marginTop: 4 }}>Cuma pembatas/judul kelompok di PDF. Tidak mengubah harga, total, atau pembayaran.</div>
    </div>
  );
  // Kembalikan project_id tujuan. Kalau user pilih "Projek Baru", bikin dulu lalu
  // pakai id-nya. Throw kalau nama projek baru kosong (biar handler batal).
  const resolveTargetProjectId = async () => {
    if (jobProjSel === "__new__") {
      const nm = jobProjNew.trim();
      if (!nm) { flash("Isi nama projek baru dulu"); const err = new Error("nama projek kosong"); err.__projErr = true; throw err; }
      const r = await axios.post(`${API}/admin/suppliers/${selected.id}/projects`, { nama: nm }, { headers });
      return r.data?.id || null;
    }
    return jobProjSel || null; // "" -> backend pilih projek aktif
  };
  // Dropdown pilih/ketik projek — dipakai di modal Tarik & Tambah Manual.
  const renderProjPicker = () => (
    <div>
      <div style={{ ...L }}>Masukkan ke Projek</div>
      <select style={I} value={jobProjSel} onChange={(e) => setJobProjSel(e.target.value)} data-testid="sup-job-proj">
        <option value="">📂 Projek aktif (otomatis)</option>
        {(selected?.projects || []).map((p) => <option key={p.id} value={p.id}>📁 {p.nama}</option>)}
        <option value="__new__">➕ Projek Baru (ketik nama)…</option>
      </select>
      {jobProjSel === "__new__" && (
        <input style={{ ...I, marginTop: 8 }} placeholder="Nama projek baru (mis. Proyek Tambang Berau / PT San Traktor)"
          value={jobProjNew} onChange={(e) => setJobProjNew(e.target.value)} data-testid="sup-job-proj-new" autoFocus />
      )}
    </div>
  );
  const addJob = async () => {
    if (!selected) return;
    const harga = pNum(jobForm.total_harga);
    if (harga <= 0) { flash("Total harga wajib diisi"); return; }
    setJobSaving(true);
    try {
      const projectId = await resolveTargetProjectId();
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
        vehicle_type: jobForm.vehicle_type.trim(), nopol: jobForm.nopol.trim(), no_rangka: jobForm.no_rangka.trim(),
        asal_kota: jobForm.asal_kota.trim(), tujuan_kota: jobForm.tujuan_kota.trim(),
        total_harga: harga, catatan: jobForm.catatan.trim(), tanggal: jobForm.tanggal || todayStr(),
        project_id: projectId, tag: jobTag.trim(),
      }, { headers });
      setJobForm(blankJobForm); setManualOpen(false); resetProjPicker();
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); flash("Unit ditambahkan");
    } catch (e) { if (!e?.__projErr) flash(e?.response?.data?.detail || "Gagal tambah unit"); }
    finally { setJobSaving(false); }
  };

  /* ═══ Tarik unit dari Order (modal) ═══ */
  const [tarikOpen, setTarikOpen] = useState(false);
  const [tarikOrders, setTarikOrders] = useState([]);
  const [tarikQ, setTarikQ] = useState("");
  const [tarikLoading, setTarikLoading] = useState(false);
  const [tarikSel, setTarikSel] = useState({});
  const [tarikSaving, setTarikSaving] = useState(false);
  const orderUnitsOf = (o) => {
    const arr = (Array.isArray(o.units) && o.units.length) ? o.units
      : [{ unit_id: "legacy", vehicle_type: o.vehicle_type, tipe_model: o.tipe_model, nopol: o.nopol, no_rangka: o.no_rangka }];
    return arr.map((u, i) => ({
      key: `${o.order_id}:${u.unit_id || u.nopol || i}`,
      vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan",
      nopol: (u.nopol || "").toUpperCase(), no_rangka: (u.no_rangka || "").toUpperCase(),
      asal_kota: o.asal_kota || "", tujuan_kota: o.tujuan_kota || "", customer: o.customer_nama || "",
    }));
  };
  // Ambil order dari master admin PO. Kirim kata kunci ke server (q) biar
  // nyari di SELURUH order (bukan cuma 100 terbaru) — cocok no PO, no rangka,
  // nama pelanggan, asal/tujuan. Server nyari juga di dalam units[].
  const fetchTarik = async (qStr) => {
    setTarikLoading(true);
    try {
      const params = { limit: 500 };
      if (qStr && qStr.trim()) params.q = qStr.trim();
      const r = await axios.get(`${API}/admin/orders`, { headers, params });
      setTarikOrders(r.data?.items || []);
    } catch { flash("Gagal memuat order"); setTarikOrders([]); }
    finally { setTarikLoading(false); }
  };
  const openTarik = async () => {
    if (!selected) { flash("Pilih supplier dulu"); return; }
    setTarikOpen(true); setTarikSel({}); setTarikQ(""); resetProjPicker();
    fetchTarik("");
  };
  // Debounce: tiap ketik di search, cari ulang ke server (biar master penuh kepakai).
  useEffect(() => {
    if (!tarikOpen) return;
    const t = setTimeout(() => fetchTarik(tarikQ), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarikQ, tarikOpen]);
  const toggleTarik = (row) => setTarikSel((s) => { const n = { ...s }; if (n[row.key]) delete n[row.key]; else n[row.key] = { ...row, total_harga: "" }; return n; });
  const setTarikHarga = (key, val) => setTarikSel((s) => ({ ...s, [key]: { ...s[key], total_harga: val } }));
  const tarikRows = tarikOrders.flatMap(orderUnitsOf).filter((row) => {
    const q = tarikQ.trim().toLowerCase(); if (!q) return true;
    return `${row.nopol} ${row.no_rangka} ${row.vehicle_type} ${row.asal_kota} ${row.tujuan_kota} ${row.customer}`.toLowerCase().includes(q);
  });
  const tarikSelArr = Object.values(tarikSel);
  const tarikTotal = tarikSelArr.reduce((s, r) => s + pNum(r.total_harga), 0);
  const doTarik = async () => {
    const valid = tarikSelArr.filter((r) => pNum(r.total_harga) > 0);
    if (!valid.length) { flash("Centang unit & isi Total Harga (HPP) dulu"); return; }
    setTarikSaving(true);
    try {
      const projectId = await resolveTargetProjectId(); // bikin projek baru sekali (kalau dipilih)
      for (const r of valid) {
        await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
          vehicle_type: r.vehicle_type, nopol: r.nopol, no_rangka: r.no_rangka,
          asal_kota: r.asal_kota, tujuan_kota: r.tujuan_kota, total_harga: pNum(r.total_harga), catatan: "", tanggal: todayStr(),
          project_id: projectId, tag: jobTag.trim(),
        }, { headers });
      }
      setTarikOpen(false); setTarikSel({}); resetProjPicker();
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); flash(`${valid.length} unit ditarik dari order`);
    } catch (e) { if (!e?.__projErr) flash(e?.response?.data?.detail || "Gagal tarik unit"); }
    finally { setTarikSaving(false); }
  };

  /* ═══ Detail unit (modal): riwayat + catat bayar/kompensasi + hapus ═══ */
  const [detailJob, setDetailJob] = useState(null); // job object
  const [dpTipe, setDpTipe] = useState("transfer");
  const [dpAmount, setDpAmount] = useState("");
  const [dpTanggal, setDpTanggal] = useState(todayStr());
  const [dpCatatan, setDpCatatan] = useState("");
  const [dpFile, setDpFile] = useState(null);
  const [dpKomp, setDpKomp] = useState({ vehicle: "", nounit: "", asal: "", tujuan: "" });
  const [dpSaving, setDpSaving] = useState(false);
  const dpFileRef = useRef();
  const openDetail = (job) => {
    setDetailJob(job); setDpTipe("transfer"); setDpAmount(""); setDpTanggal(todayStr()); setDpCatatan(""); setDpFile(null);
    setDpKomp({ vehicle: "", nounit: "", asal: "", tujuan: "" });
    setTbhLabel(""); setTbhAmount("");
    setDetailTag(job.tag || "");
  };
  const detailJobLive = useMemo(() => detailJob && jobs.find((j) => j.id === detailJob.id), [detailJob, jobs]);
  const submitDetailPay = async () => {
    const job = detailJob; if (!job) return;
    const amt = pNum(dpAmount);
    if (amt <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setDpSaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", amt); fd.append("catatan", dpCatatan.trim()); fd.append("tanggal", dpTanggal || todayStr()); fd.append("tipe", dpTipe);
      if (dpTipe === "kompensasi") {
        fd.append("kompensasi_vehicle_type", dpKomp.vehicle.trim()); fd.append("kompensasi_no_unit", dpKomp.nounit.trim());
        fd.append("kompensasi_asal_kota", dpKomp.asal.trim()); fd.append("kompensasi_tujuan_kota", dpKomp.tujuan.trim());
      }
      if (dpFile) fd.append("bukti", dpFile);
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs/${job.id}/payments`, fd, { headers });
      setDpAmount(""); setDpCatatan(""); setDpFile(null); if (dpFileRef.current) dpFileRef.current.value = "";
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1);
      flash(dpTipe === "kompensasi" ? "Kompensasi tercatat" : "Pembayaran tercatat");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan"); }
    finally { setDpSaving(false); }
  };
  const deletePayment = async (jobId, paymentId) => {
    if (!window.confirm("Hapus catatan pembayaran ini?")) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/payments/${paymentId}`, { headers }); await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); }
    catch { flash("Gagal hapus pembayaran"); }
  };
  /* ═══ Biaya tambahan per unit (nambah tagihan, terpisah dari harga deal) ═══ */
  const [tbhLabel, setTbhLabel] = useState("");
  const [tbhAmount, setTbhAmount] = useState("");
  const [tbhSaving, setTbhSaving] = useState(false);
  const addTambahan = async () => {
    const job = detailJob; if (!job) return;
    const label = tbhLabel.trim(); const amount = pNum(tbhAmount);
    if (!label) { flash("Isi keterangan biaya tambahan"); return; }
    if (amount <= 0) { flash("Isi nominal biaya tambahan"); return; }
    setTbhSaving(true);
    try {
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs/${job.id}/tambahan`, { label, amount }, { headers });
      setTbhLabel(""); setTbhAmount("");
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1);
      flash("✓ Biaya tambahan ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah biaya"); }
    finally { setTbhSaving(false); }
  };
  const deleteTambahan = async (jobId, tambahanId) => {
    if (!window.confirm("Hapus biaya tambahan ini?")) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/tambahan/${tambahanId}`, { headers }); await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); }
    catch { flash("Gagal hapus biaya tambahan"); }
  };
  /* ═══ Tag/Judul Kelompok laporan per unit (pembatas visual PDF) ═══ */
  const [detailTag, setDetailTag] = useState("");
  const [tagSaving, setTagSaving] = useState(false);
  const saveJobTag = async () => {
    const job = detailJob; if (!job) return;
    setTagSaving(true);
    try {
      await axios.patch(`${API}/admin/suppliers/${selected.id}/jobs/${job.id}/tag`, { tag: detailTag.trim() }, { headers });
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1);
      flash("✓ Tag kelompok tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan tag"); }
    finally { setTagSaving(false); }
  };
  const deleteJob = async (jobId) => {
    if (!window.confirm("Hapus unit ini beserta semua riwayat pembayarannya?")) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}`, { headers }); setDetailJob(null); await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); }
    catch { flash("Gagal hapus unit"); }
  };

  /* ═══ Edit / hapus supplier (3-titik) ═══ */
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ jenis: "", no_hp: "", catatan: "" });
  const openEdit = () => { setEditForm({ jenis: selected.jenis || "", no_hp: selected.no_hp || "", catatan: selected.catatan || "" }); setEditOpen(true); setMenuOpen(false); };
  const saveEdit = async () => {
    try { await axios.patch(`${API}/admin/suppliers/${selected.id}`, editForm, { headers }); setEditOpen(false); await reloadSelected(selected.id); flash("Supplier diupdate"); }
    catch (e) { flash(e?.response?.data?.detail || "Gagal update"); }
  };
  const deleteSupplier = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Hapus supplier "${selected.nama}" beserta semua unit & riwayat pembayaran? Tidak bisa dibatalkan.`)) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}`, { headers }); setSelected(null); setQuery(""); setListRefreshTick((t) => t + 1); flash("Supplier dihapus"); }
    catch { flash("Gagal hapus supplier"); }
  };
  const addProject = async () => {
    setMenuOpen(false);
    const raw = window.prompt("Nama projek baru (mis. Proyek Tambang Berau / PT San Traktor):", "");
    if (raw === null) return;               // batal
    const nama = raw.trim();                // kosong -> backend auto "Projek N"
    try { await axios.post(`${API}/admin/suppliers/${selected.id}/projects`, { nama }, { headers }); await reloadSelected(selected.id); flash(nama ? `Projek "${nama}" dibuat` : "Projek baru dibuat"); }
    catch { flash("Gagal bikin projek"); }
  };
  const renameProject = async (g) => {
    if (!selected || !g || g.id === "_none") return;
    const nama = window.prompt("Ganti nama projek:", g.nama || "");
    if (nama === null) return;               // batal
    if (!nama.trim()) { flash("Nama projek tidak boleh kosong"); return; }
    try { await axios.patch(`${API}/admin/suppliers/${selected.id}/projects/${g.id}/rename`, { nama: nama.trim() }, { headers }); await reloadSelected(selected.id); flash("Nama projek diperbarui"); }
    catch (e) { flash(e?.response?.data?.detail || "Gagal ganti nama projek"); }
  };

  const resolveUrl = (u) => {
    if (!u) return "";
    if (u.startsWith("http")) {
      // Bukti/dokumen di Supabase kadang ke-serve dgn mime salah (octet-stream)
      // -> browser nolak render -> blank. Lewatkan proxy backend biar Content-Type
      // dipaksa benar & tampil inline.
      if (u.includes("/storage/v1/object/public/")) return `${API}/media?u=${encodeURIComponent(u)}`;
      return u;
    }
    return `${BACKEND_URL}${u}`;
  };

  /* ═══ Riwayat transaksi: group payments by batch_id ═══ */
  const txns = useMemo(() => {
    const map = {};
    jobs.forEach((job) => (job.payments || []).forEach((p) => {
      const key = p.batch_id || p.id;
      if (!map[key]) map[key] = { key, tanggal: p.tanggal || "", metode: p.metode || (p.tipe === "kompensasi" ? "Kompensasi" : "Transfer"), catatan: p.catatan || "", bukti_url: p.bukti_url || "", total: 0, allocs: [] };
      map[key].total += p.amount || 0;
      if (p.bukti_url && !map[key].bukti_url) map[key].bukti_url = p.bukti_url;
      if (p.catatan && !map[key].catatan) map[key].catatan = p.catatan;
      map[key].allocs.push({ jobId: job.id, nopol: job.nopol || job.no_rangka || "-", vehicle: job.vehicle_type || "Unit", rute: `${job.asal_kota || "-"} → ${job.tujuan_kota || "-"}`, amount: p.amount || 0, tipe: p.tipe });
    }));
    return Object.values(map).sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
  }, [jobs]);
  const [txnDetail, setTxnDetail] = useState(null);
  const [txnBuktiSaving, setTxnBuktiSaving] = useState(false);
  const txnBuktiRef = useRef();
  // Tempel/ganti bukti transfer ke transaksi yang sudah tercatat (telat upload).
  const uploadTxnBukti = async (file) => {
    if (!file || !txnDetail || !selected) return;
    setTxnBuktiSaving(true);
    try {
      const fd = new FormData();
      fd.append("bukti", file);
      const r = await axios.post(`${API}/admin/suppliers/${selected.id}/payments/${txnDetail.key}/bukti`, fd, { headers });
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1);
      setTxnDetail((t) => (t ? { ...t, bukti_url: r.data?.bukti_url || t.bukti_url } : t));
      flash("✓ Bukti transfer tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal upload bukti"); }
    finally { setTxnBuktiSaving(false); if (txnBuktiRef.current) txnBuktiRef.current.value = ""; }
  };

  /* ═══ Dokumen: semua bukti ═══ */
  const dokumens = useMemo(() => {
    const out = [];
    jobs.forEach((job) => (job.payments || []).forEach((p) => { if (p.bukti_url) out.push({ id: p.id, url: p.bukti_url, tanggal: p.tanggal, amount: p.amount, nopol: job.nopol || job.no_rangka || "-", metode: p.metode || p.tipe }); }));
    return out.sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
  }, [jobs]);

  const filteredJobs = useMemo(() => filter === "semua" ? jobs : jobs.filter((j) => statusOf(j) === filter), [jobs, filter]);
  // Kelompokkan tagihan per Grup/Projek biar nggak campur (urut sesuai daftar projek).
  const jobsGrouped = useMemo(() => {
    const projs = selected?.projects || [];
    const map = new Map();
    projs.forEach((p) => map.set(p.id, { id: p.id, nama: p.nama, status: p.status, jobs: [] }));
    filteredJobs.forEach((j) => {
      const pid = j.project_id || "_none";
      if (!map.has(pid)) map.set(pid, { id: pid, nama: pid === "_none" ? "Tanpa Grup" : "Grup", status: "open", jobs: [] });
      map.get(pid).jobs.push(j);
    });
    return Array.from(map.values()).filter((g) => g.jobs.length > 0);
  }, [filteredJobs, selected]);

  const TABS = [{ k: "pembayaran", t: "Pembayaran" }, { k: "tagihan", t: "Tagihan" }, { k: "riwayat", t: "Riwayat" }, { k: "dokumen", t: "Dokumen" }];

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 12px 120px", color: C.ink }}>
      {/* ── Search supplier (instan) ── */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <label style={L}>Cari / Buat Supplier</label>
        <div style={{ position: "relative" }}>
          <input style={I} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} onBlur={autoSaveSupplier} onKeyDown={(e) => { if (e.key === "Enter") autoSaveSupplier(); }} placeholder="Ketik nama supplier… (mis. PT PEL) — otomatis tersimpan" data-testid="sup-search" />
          {!selected && dropdown.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: 10, marginTop: 4, zIndex: 30, maxHeight: 300, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
              {dropdown.map((s) => (
                <div key={s.id} onMouseDown={(e) => { e.preventDefault(); selectingRef.current = true; selectSupplier(s); }} style={{ padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", gap: 10 }} data-testid={`sup-option-${s.id}`}>
                  <span style={{ fontWeight: 700 }}>{s.nama}</span>
                  <span style={{ color: C.mute, fontSize: 12 }}>{s.jumlah_unit || 0} unit · sisa {fRp(s.grand_sisa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && query.trim() && (
          <button style={{ ...BTN, marginTop: 10 }} onClick={createOrOpenSupplier} data-testid="sup-create">+ Buat / Buka "{query.trim()}"</button>
        )}
      </div>

      {selected && (
        <>
          {/* ── HEADER: nama + status + 3 summary card + 3-titik ── */}
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {selected.nama}
                  <span style={{ fontSize: 10, fontWeight: 800, color: C.green, background: "#0d2818", borderRadius: 12, padding: "2px 8px" }}>● Aktif</span>
                </div>
                <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                  {selected.jenis || "Supplier"}{selected.no_hp ? ` · ${selected.no_hp}` : ""}
                  {unpaidJobs.length > 0 && <span> · <b style={{ color: C.red }}>{unpaidJobs.length} tagihan belum lunas</b></span>}
                  {lastPayDate && <span> · bayar terakhir {fDate(lastPayDate)}</span>}
                </div>
              </div>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setMenuOpen((v) => !v)} style={{ ...BTN_GHOST, padding: "8px 12px", fontSize: 18, lineHeight: 1 }} data-testid="sup-menu" aria-label="Menu">⋮</button>
                {menuOpen && (
                  <div style={{ position: "absolute", top: "110%", right: 0, background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: 10, minWidth: 180, overflow: "hidden", zIndex: 40, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
                    {[
                      { t: "🧾 Rekap A4 (No. + Simpan)", on: openRekap, },
                      { t: "📁 Projek Baru", on: addProject },
                      { t: "✏️ Edit Supplier", on: openEdit },
                      { t: "🗑️ Hapus Supplier", on: deleteSupplier, danger: true },
                    ].map((m, i) => (
                      <button key={i} onClick={m.on} style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 14px", background: "none", border: "none", borderBottom: i < 3 ? `1px solid ${C.line}` : "none", color: m.danger ? C.red : C.ink, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{m.t}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* 3 summary card sejajar */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
              {[
                { lbl: "Total Tagihan", val: selected.grand_total_harga, c: C.ink },
                { lbl: "Terbayar", val: selected.grand_total_terbayar, c: C.green },
                { lbl: "Sisa", val: selected.grand_sisa, c: (selected.grand_sisa > 0 ? C.red : C.green) },
              ].map((s, i) => (
                <div key={i} style={{ background: C.inpBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 10px" }}>
                  <div style={{ fontSize: 10, color: C.mute, textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 700 }}>{s.lbl}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: s.c, marginTop: 4, textAlign: "right", wordBreak: "break-word" }}>{fRp(s.val)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── TABS ── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} data-testid={`sup-tab-${t.k}`}
                style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 10, border: `1px solid ${tab === t.k ? C.gold : C.line}`, background: tab === t.k ? "#2a1f0d" : C.card, color: tab === t.k ? C.gold : C.mute, fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                {t.t}
              </button>
            ))}
          </div>

          {/* ═══ TAB PEMBAYARAN ═══ */}
          {tab === "pembayaran" && (
            <div>
              {unpaidJobs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: C.mute, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14 }}>🎉 Semua tagihan supplier ini sudah lunas.</div>
              ) : (
                <>
                  <div style={{ background: "#0d1b2a", border: `1px solid ${C.blue}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 12, color: C.mute }}>
                    <b style={{ color: C.ink }}>Bayar borongan</b> — centang beberapa PO, 1 nominal dibagi otomatis. Mau bayar <b style={{ color: C.ink }}>1 PO aja</b>? Ke tab <b style={{ color: C.ink }}>Tagihan</b> → tombol <b style={{ color: C.ink }}>💵 Bayar PO Ini</b> (tanpa centang).
                  </div>
                  <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 6 }}>
                      <input type="checkbox" checked={allUnpaidChecked} onChange={selectAllUnpaid} style={{ width: 20, height: 20 }} data-testid="sup-pay-all" />
                      <span style={{ fontWeight: 800, fontSize: 14 }}>Pilih Semua Belum Lunas ({unpaidJobs.length})</span>
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {unpaidJobs.map((j) => {
                        const on = !!paySel[j.id];
                        return (
                          <label key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${on ? C.gold : C.line}`, background: on ? "#1a1408" : C.inpBg, cursor: "pointer" }} data-testid={`sup-pay-row-${j.id}`}>
                            <input type="checkbox" checked={on} onChange={() => togglePay(j.id)} style={{ width: 20, height: 20, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{j.nopol || j.no_rangka || "(tanpa nopol)"} <span style={{ color: C.mute, fontWeight: 400 }}>· {j.vehicle_type || "Unit"}</span></div>
                              <div style={{ fontSize: 12, color: C.mute }}>{j.asal_kota || "-"} → {j.tujuan_kota || "-"}</div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 900, color: C.red }}>{fRp(j.sisa)}</div>
                              <Badge status={statusOf(j)} />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form pembayaran */}
                  <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={() => qpDP(0.5)} data-testid="sup-qp-dp">+ DP 50%</button>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={qpLunas} data-testid="sup-qp-lunas">+ Bayar Lunas</button>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={qpManual} data-testid="sup-qp-manual">+ Manual</button>
                    </div>
                    <label style={L}>Nominal Pembayaran</label>
                    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden", marginBottom: 12 }}>
                      <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
                      <input inputMode="numeric" value={fmtRpInput(payAmount)} onChange={(e) => setPayAmount(onlyDigits(e.target.value))} placeholder="0" data-testid="sup-pay-amount"
                        style={{ border: "none", background: "none", color: C.ink, fontSize: 22, fontWeight: 800, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <div><label style={L}>Tanggal</label><input type="date" style={I} value={payTanggal} onChange={(e) => setPayTanggal(e.target.value)} /></div>
                      <div><label style={L}>Metode</label>
                        <select style={I} value={payMetode} onChange={(e) => setPayMetode(e.target.value)}>
                          <option>Transfer</option><option>Tunai</option><option>Lainnya</option>
                        </select>
                      </div>
                    </div>
                    <input style={{ ...I, marginBottom: 10 }} placeholder="Catatan (opsional)" value={payCatatan} onChange={(e) => setPayCatatan(e.target.value)} />
                    <input ref={payFileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayBukti(e.target.files?.[0] || null)} />
                    <button style={{ ...BTN_GHOST, width: "100%" }} onClick={() => payFileRef.current?.click()}>{payBukti ? `📎 ${payBukti.name.slice(0, 28)}` : "📎 Upload Bukti Transfer"}</button>
                    {/* Tombol simpan di dalam form (deket) — biar nggak perlu turun ke bar bawah.
                        Selalu bisa diklik; kalau belum lengkap, doBatchPay kasih pesannya. */}
                    <button style={{ ...BTN, width: "100%", marginTop: 12, opacity: (selectedPayJobs.length && pNum(payAmount) > 0) ? 1 : 0.6 }} onClick={doBatchPay} disabled={paySaving} data-testid="sup-pay-save-inline">
                      {paySaving ? "Menyimpan…" : selectedPayJobs.length ? `💾 Simpan Pembayaran · ${selectedPayJobs.length} tagihan` : "💾 Centang tagihan dulu"}
                    </button>
                    {!selectedPayJobs.length && <div style={{ fontSize: 11, color: C.mute, textAlign: "center", marginTop: 6 }}>Centang tagihan di atas dulu, terus isi nominal.</div>}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ TAB TAGIHAN ═══ */}
          {tab === "tagihan" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button style={{ ...BTN, flex: 1, minWidth: 150 }} onClick={openTarik} data-testid="sup-tarik-open">+ Tarik Unit dari PO</button>
                <button style={{ ...BTN_GHOST, flex: 1, minWidth: 130 }} onClick={() => { setJobForm(blankJobForm); resetProjPicker(); setManualOpen(true); }} data-testid="sup-manual-open">+ Tambah Manual</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
                {[["semua", "Semua"], ["belum", "Belum Bayar"], ["sebagian", "Sebagian"], ["lunas", "Lunas"]].map(([k, t]) => (
                  <button key={k} onClick={() => setFilter(k)} style={{ padding: "7px 12px", borderRadius: 20, border: `1px solid ${filter === k ? C.gold : C.line}`, background: filter === k ? "#2a1f0d" : C.card, color: filter === k ? C.gold : C.mute, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}>{t}</button>
                ))}
              </div>
              {filteredJobs.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Tidak ada tagihan.</div>}
              {jobsGrouped.map((g) => {
                const gSisa = g.jobs.reduce((s, j) => s + (j.sisa || 0), 0);
                const gTotal = g.jobs.reduce((s, j) => s + (j.total_harga || 0), 0);
                return (
                <div key={g.id} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", background: "#1a1f2e", border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 800, fontSize: 13, color: C.gold, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📁 {g.nama}</span>
                      {g.id !== "_none" && (
                        <button onClick={() => renameProject(g)} title="Ganti nama projek" data-testid={`sup-rename-proj-${g.id}`}
                          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1 }}>✏️</button>
                      )}
                      <span style={{ color: C.mute, fontWeight: 600, whiteSpace: "nowrap" }}>· {g.jobs.length} unit</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.mute, whiteSpace: "nowrap" }}>Total {fRp(gTotal)} · Sisa <b style={{ color: gSisa > 0 ? C.red : C.green }}>{fRp(gSisa)}</b></div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.jobs.map((j) => (
                  <div key={j.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }} data-testid={`sup-job-${j.id}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{j.nopol || j.no_rangka || "(tanpa nopol)"}</div>
                        <div style={{ fontSize: 12, color: C.mute }}>{j.vehicle_type || "Unit"} · {j.asal_kota || "-"} → {j.tujuan_kota || "-"}</div>
                        {j.catatan && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{j.catatan}</div>}
                      </div>
                      <Badge status={statusOf(j)} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: C.mute }}>Total</span><span style={{ fontWeight: 700 }}>{fRp(j.total_harga)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: C.mute }}>Terbayar</span><span style={{ color: C.green, fontWeight: 700 }}>{fRp(j.total_terbayar)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 2 }}>
                      <span style={{ color: C.mute }}>Sisa</span><span style={{ fontWeight: 900, color: j.sisa > 0 ? C.red : C.green }}>{fRp(j.sisa)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      {/* Opsi 1: bayar PO ini langsung (tanpa centang) — buka form bayar, jumlah = sisa, tinggal atur tanggal. */}
                      {j.sisa > 0 && <button style={{ ...BTN, flex: 1 }} onClick={() => { openDetail(j); setDpAmount(String(j.sisa)); }} data-testid={`sup-bayar-${j.id}`}>💵 Bayar PO Ini</button>}
                      <button style={{ ...BTN_GHOST, flex: 1 }} onClick={() => openDetail(j)} data-testid={`sup-detail-${j.id}`}>Lihat Detail</button>
                    </div>
                  </div>
                ))}
              </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ TAB RIWAYAT (timeline) ═══ */}
          {tab === "riwayat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {txns.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Belum ada pembayaran.</div>}
              {txns.map((tx) => (
                <button key={tx.key} onClick={() => setTxnDetail(tx)} style={{ textAlign: "left", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, cursor: "pointer", color: C.ink }} data-testid={`sup-txn-${tx.key}`}>
                  {/* Card utama = TRANSAKSI BANK: tanggal + nominal + status. Unit cuma helper kecil. */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.mute }}>{fDate(tx.tanggal)}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, marginTop: 2 }}>{(tx.metode === "Kompensasi" ? "Kompensasi" : "Transfer")} diterima</div>
                      <div style={{ fontSize: 11.5, color: C.mute, marginTop: 3 }}>Dialokasikan ke {tx.allocs.length} unit{tx.bukti_url ? " · 📎 bukti" : ""}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 17, fontWeight: 900, color: C.green }}>{fRp(tx.total)}</div>
                      <div style={{ fontSize: 11.5, fontWeight: 800, color: C.green, marginTop: 3 }}>✓ Diterima</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ═══ TAB DOKUMEN ═══ */}
          {tab === "dokumen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {dokumens.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Belum ada bukti transfer terupload.</div>}
              {dokumens.map((d) => (
                <a key={d.id} href={resolveUrl(d.url)} target="_blank" rel="noreferrer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, textDecoration: "none", color: C.ink }}>
                  <div><div style={{ fontWeight: 700, fontSize: 13 }}>📎 {d.nopol} · {d.metode}</div><div style={{ fontSize: 12, color: C.mute }}>{fDate(d.tanggal)}</div></div>
                  <div style={{ fontWeight: 800, color: C.green }}>{fRp(d.amount)}</div>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Sticky bottom bar (tab Pembayaran) ── */}
      {selected && tab === "pembayaran" && unpaidJobs.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: C.card, borderTop: `1px solid ${C.inpLine}`, padding: "12px 16px calc(env(safe-area-inset-bottom) + 12px)", boxShadow: "0 -6px 24px rgba(0,0,0,.4)" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.mute }}>{selectedPayJobs.length} tagihan · dipilih {fRp(totalSelSisa)}</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{fRp(pNum(payAmount))}</div>
            </div>
            <button style={{ ...BTN, flex: "0 0 auto", minWidth: 170, opacity: (selectedPayJobs.length && pNum(payAmount) > 0) ? 1 : 0.6 }} onClick={doBatchPay} disabled={paySaving} data-testid="sup-pay-save">
              {paySaving ? "Menyimpan…" : "💾 Simpan Pembayaran"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Tarik dari PO ── */}
      {tarikOpen && (
        <Modal title="Tarik Unit dari PO" onClose={() => setTarikOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setTarikOpen(false)}>Batal</button><button style={BTN} onClick={doTarik} disabled={tarikSaving} data-testid="sup-tarik-save">{tarikSaving ? "Menarik…" : `Tarik ${tarikSelArr.length} Unit${tarikTotal > 0 ? ` · ${fRp(tarikTotal)}` : ""}`}</button></>}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Centang unit, isi HPP (biaya ke supplier ini). Unit, nopol, customer &amp; rute otomatis dari PO.</div>
          <input style={{ ...I, marginBottom: 10 }} placeholder="🔎 cari: no PO / no rangka / nama pelanggan / asal / tujuan" value={tarikQ} onChange={(e) => setTarikQ(e.target.value)} data-testid="sup-tarik-search" />
          <div style={{ marginBottom: 12 }}>{renderProjPicker()}</div>
          <div style={{ marginBottom: 12 }}>{renderTagInput()}</div>
          {tarikLoading ? <div style={{ padding: 20, textAlign: "center", color: C.mute }}>Memuat…</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tarikRows.map((row) => {
                const on = !!tarikSel[row.key];
                return (
                  <div key={row.key} style={{ border: `1px solid ${on ? C.gold : C.line}`, borderRadius: 10, padding: 12, background: on ? "#1a1408" : C.inpBg }}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => toggleTarik(row)} style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{row.nopol || row.no_rangka || "(tanpa nopol)"} · {row.vehicle_type}</div>
                        <div style={{ fontSize: 12, color: C.mute }}>{row.asal_kota} → {row.tujuan_kota}{row.customer ? ` · ${row.customer}` : ""}</div>
                      </div>
                    </label>
                    {on && <div style={{ marginTop: 8 }}><input style={I} inputMode="numeric" placeholder="HPP / Total Harga ke supplier (Rp)" value={fmtRpInput(tarikSel[row.key].total_harga)} onChange={(e) => setTarikHarga(row.key, onlyDigits(e.target.value))} /></div>}
                  </div>
                );
              })}
              {tarikRows.length === 0 && <div style={{ padding: 16, textAlign: "center", color: C.mute, fontSize: 12 }}>Tidak ada order.</div>}
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Rekap A4 (No. Dokumen + Cetak/Simpan) ── */}
      {rekapOpen && selected && (
        <Modal title="Rekap Supplier — No. Dokumen" onClose={() => setRekapOpen(false)}
          foot={<>
            <button style={BTN_GHOST} onClick={() => setRekapOpen(false)}>Batal</button>
            <button style={BTN_GHOST} onClick={() => { const j = chosenJobs(); if (!j.length) { flash("Centang minimal 1 unit dulu"); return; } setFormatChooser({ jobs: j, noDoc: rekapNo, tgl: rekapTgl }); }} data-testid="sup-rekap-print">🖨️ Cetak</button>
            <button style={BTN} onClick={saveRekapHistori} disabled={rekapSaving} data-testid="sup-rekap-save">{rekapSaving ? "Menyimpan…" : "💾 Simpan ke Histori"}</button>
          </>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ ...L }}>No. Dokumen (otomatis — bisa diubah manual)</div>
              <input style={I} value={rekapNo} onChange={(e) => setRekapNo(e.target.value)} placeholder="RPS/AAL/..." data-testid="sup-rekap-no" />
              <div style={{ fontSize: 11, color: C.mute, marginTop: 4 }}>Kosongkan = otomatis ({supplierAutoDocNo()}). Isi manual untuk samakan dengan nomor lain.</div>
            </div>
            <div>
              <div style={{ ...L }}>Tanggal Laporan (bisa diubah manual)</div>
              <input style={I} type="date" value={rekapTgl} onChange={(e) => setRekapTgl(e.target.value)} data-testid="sup-rekap-tgl" />
              <div style={{ fontSize: 11, color: C.mute, marginTop: 4 }}>Default hari ini. Ubah kalau mau tanggal laporan berbeda.</div>
            </div>
            {(selected.projects || []).length > 1 && (
              <div>
                <div style={{ ...L }}>Scope Projek</div>
                <select style={I} value={rekapProj} onChange={(e) => changeRekapProj(e.target.value)} data-testid="sup-rekap-proj">
                  <option value="all">Semua Projek (dipisah per grup)</option>
                  {(selected.projects || []).map((p) => (
                    <option key={p.id} value={p.id}>📁 {p.nama}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Pilih unit yang mau dicetak — centang berapa aja */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div style={{ ...L, margin: 0 }}>Unit yang dicetak — {chosenJobs().length}/{rekapJobs().length}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 11 }} onClick={() => setRekapSel(new Set(rekapJobs().map((j) => j.id)))}>Semua</button>
                  <button style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 11 }} onClick={() => setRekapSel(new Set())}>Kosongkan</button>
                </div>
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.inpLine}`, borderRadius: 10 }}>
                {rekapJobs().length === 0 && <div style={{ padding: 14, textAlign: "center", color: C.mute, fontSize: 12 }}>Belum ada unit.</div>}
                {rekapJobs().map((j) => {
                  const on = rekapSel.has(j.id);
                  const pname = (selected.projects || []).find((p) => p.id === j.project_id)?.nama;
                  return (
                    <label key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderBottom: `1px solid ${C.line}`, cursor: "pointer", background: on ? "#12261a" : "transparent" }} data-testid={`sup-rekap-unit-${j.id}`}>
                      <input type="checkbox" checked={on} onChange={() => toggleRekapUnit(j.id)} style={{ width: 17, height: 17, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{j.nopol || j.no_rangka || "(tanpa nopol)"} <span style={{ color: C.mute, fontWeight: 500 }}>· {j.vehicle_type || "Unit"}</span></div>
                        <div style={{ fontSize: 11, color: C.mute }}>{j.asal_kota || "-"} → {j.tujuan_kota || "-"} · {fRp(j.total_harga)}{rekapProj === "all" && pname ? ` · 📁 ${pname}` : ""}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={{ fontSize: 12.5, color: C.mute }}>
              Supplier: <b style={{ color: C.ink }}>{selected.nama}</b> · {chosenJobs().length} unit dipilih · Total Rp {chosenJobs().reduce((s, j) => s + (j.total_harga || 0), 0).toLocaleString("id-ID")}
            </div>
            <div style={{ fontSize: 11.5, color: C.mute }}>💾 Simpan = masuk ke <b style={{ color: C.ink }}>Histori Dokumen</b> (bisa dicetak ulang). 🖨️ Cetak = langsung print A4.</div>
          </div>
        </Modal>
      )}

      {/* ── Bottom sheet: Pilih Format Laporan (muncul saat klik Cetak) ── */}
      {formatChooser && selected && (
        <div onClick={() => setFormatChooser(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10001, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 460, background: C.card, borderRadius: "16px 16px 0 0", padding: "16px 16px 22px", boxShadow: "0 -8px 30px rgba(0,0,0,0.5)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 4, background: C.line, margin: "0 auto 14px" }} />
            <div style={{ fontWeight: 900, fontSize: 16, color: C.ink, marginBottom: 3 }}>Pilih Format Laporan</div>
            <div style={{ fontSize: 12, color: C.mute, marginBottom: 16 }}>Data sama persis — cuma tampilan PDF-nya beda.</div>

            <button data-testid="sup-format-perusahaan"
              onClick={() => { printSupplierA4(selected, formatChooser.jobs, formatChooser.noDoc, formatChooser.tgl); setFormatChooser(null); setRekapOpen(false); }}
              style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", marginBottom: 10, borderRadius: 12, border: `1px solid ${C.line}`, background: C.inpBg, color: C.ink, cursor: "pointer" }}>
              <span style={{ fontSize: 26, flexShrink: 0 }}>🏢</span>
              <span><div style={{ fontWeight: 800, fontSize: 14 }}>Perusahaan / Supplier</div><div style={{ fontSize: 11.5, color: C.mute, marginTop: 1 }}>Format formal untuk pelayaran &amp; perusahaan</div></span>
            </button>

            <button data-testid="sup-format-driver"
              onClick={() => { printDriverRekapA4(selected, formatChooser.jobs, formatChooser.noDoc, formatChooser.tgl); setFormatChooser(null); setRekapOpen(false); }}
              style={{ width: "100%", textAlign: "left", display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", marginBottom: 14, borderRadius: 12, border: `1px solid ${C.gold}`, background: "#1a1400", color: C.ink, cursor: "pointer" }}>
              <span style={{ fontSize: 26, flexShrink: 0 }}>🚚</span>
              <span><div style={{ fontWeight: 800, fontSize: 14, color: C.gold }}>Kepala Rombongan / Driver</div><div style={{ fontSize: 11.5, color: C.mute, marginTop: 1 }}>Format sederhana dengan riwayat pembayaran</div></span>
            </button>

            <button onClick={() => setFormatChooser(null)}
              style={{ width: "100%", padding: "11px", borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.mute, fontWeight: 700, cursor: "pointer" }}>Batal</button>
          </div>
        </div>
      )}

      {/* ── Modal: Tambah Manual ── */}
      {manualOpen && (
        <Modal title="Tambah Unit Manual" onClose={() => setManualOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setManualOpen(false)}>Batal</button><button style={BTN} onClick={addJob} disabled={jobSaving} data-testid="sup-job-save">{jobSaving ? "Menyimpan…" : "Simpan Unit"}</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {renderProjPicker()}
            {renderTagInput()}
            <input style={I} placeholder="Tipe kendaraan" value={jobForm.vehicle_type} onChange={(e) => setJobForm((f) => ({ ...f, vehicle_type: e.target.value }))} data-testid="sup-job-vehicle" />
            <input style={I} placeholder="No. Polisi (kosongkan kalau mobil baru)" value={jobForm.nopol} onChange={(e) => setJobForm((f) => ({ ...f, nopol: e.target.value.toUpperCase() }))} data-testid="sup-job-nopol" />
            <input style={I} placeholder="No. Rangka" value={jobForm.no_rangka} onChange={(e) => setJobForm((f) => ({ ...f, no_rangka: e.target.value.toUpperCase() }))} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input style={I} placeholder="Kota asal" value={jobForm.asal_kota} onChange={(e) => setJobForm((f) => ({ ...f, asal_kota: e.target.value }))} />
              <input style={I} placeholder="Kota tujuan" value={jobForm.tujuan_kota} onChange={(e) => setJobForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden" }}>
              <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
              <input inputMode="numeric" value={fmtRpInput(jobForm.total_harga)} onChange={(e) => setJobForm((f) => ({ ...f, total_harga: onlyDigits(e.target.value) }))} placeholder="Total harga / HPP" data-testid="sup-job-harga" style={{ border: "none", background: "none", color: C.ink, fontSize: 16, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
            </div>
            <input type="date" style={I} value={jobForm.tanggal} onChange={(e) => setJobForm((f) => ({ ...f, tanggal: e.target.value }))} />
            <input style={I} placeholder="Catatan (opsional)" value={jobForm.catatan} onChange={(e) => setJobForm((f) => ({ ...f, catatan: e.target.value }))} />
          </div>
        </Modal>
      )}

      {/* ── Modal: Detail unit (riwayat + catat bayar/kompensasi) ── */}
      {detailJob && detailJobLive && (
        <Modal title={`${detailJobLive.nopol || detailJobLive.no_rangka || "Unit"} · ${detailJobLive.vehicle_type || ""}`} onClose={() => setDetailJob(null)}
          foot={<button style={{ ...BTN_GHOST, color: C.red, borderColor: C.red }} onClick={() => deleteJob(detailJobLive.id)}>🗑️ Hapus Unit</button>}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Total</span><b>{fRp(detailJobLive.total_harga)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Terbayar</span><b style={{ color: C.green }}>{fRp(detailJobLive.total_terbayar)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span style={{ color: C.mute }}>Sisa</span><b style={{ color: detailJobLive.sisa > 0 ? C.red : C.green }}>{fRp(detailJobLive.sisa)}</b></div>

          {/* ── Biaya tambahan per unit (nambah tagihan, terpisah dari harga deal) ── */}
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginBottom: 12 }}>
            <div style={{ ...L }}>Rincian Ongkos & Biaya Tambahan</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "5px 0", color: C.ink }}>
              <span style={{ color: C.mute }}>Harga Deal</span><b>{fRp(detailJobLive.harga_deal != null ? detailJobLive.harga_deal : detailJobLive.total_harga)}</b>
            </div>
            {(detailJobLive.tambahan || []).map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "5px 0", borderTop: `1px dashed ${C.line}` }}>
                <span style={{ color: C.gold }}>↳ {t.label}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b>{fRp(t.amount)}</b>
                  <button onClick={() => deleteTambahan(detailJobLive.id, t.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Hapus</button>
                </span>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input style={{ ...I, flex: 1.4 }} placeholder="Keterangan (mis. Tambahan BBM)" value={tbhLabel} onChange={(e) => setTbhLabel(e.target.value)} data-testid="sup-tbh-label" />
              <input style={{ ...I, flex: 1 }} inputMode="numeric" placeholder="Nominal" value={fmtRpInput(tbhAmount)} onChange={(e) => setTbhAmount(onlyDigits(e.target.value))} data-testid="sup-tbh-amount" />
              <button style={{ ...BTN, padding: "0 16px", minWidth: 56 }} disabled={tbhSaving} onClick={addTambahan} data-testid="sup-tbh-add">{tbhSaving ? "…" : "+"}</button>
            </div>
            <div style={{ fontSize: 11, color: C.mute, marginTop: 5 }}>Biaya tambahan nambah Total &amp; Sisa unit ini. Harga deal awal tetap.</div>
          </div>

          {/* ── Tag / Judul Kelompok laporan (pembatas visual PDF, tidak ikut hitungan) ── */}
          <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginBottom: 12 }}>
            <div style={{ ...L }}>Tag / Judul Kelompok Laporan</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input style={{ ...I, flex: 1 }} value={detailTag} onChange={(e) => setDetailTag(e.target.value)} placeholder="mis. Pengiriman Sulawesi 0001 / BL 02/SLS-14B" data-testid="sup-detail-tag" list="sup-tag-list" />
              <button style={{ ...BTN, padding: "0 16px" }} disabled={tagSaving || detailTag.trim() === (detailJobLive.tag || "").trim()} onClick={saveJobTag} data-testid="sup-detail-tag-save">{tagSaving ? "…" : "Simpan"}</button>
            </div>
            <div style={{ fontSize: 11, color: C.mute, marginTop: 5 }}>Unit dengan tag sama tampil di bawah satu header di PDF. Kosongkan = tanpa tag. Tidak mengubah hitungan.</div>
          </div>

          {(detailJobLive.payments || []).length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginBottom: 12 }}>
              <div style={{ ...L }}>Riwayat</div>
              {detailJobLive.payments.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span><span style={{ color: C.mute }}>{fDate(p.tanggal)}</span> — {fRp(p.amount)}{p.tipe === "kompensasi" && <span style={{ color: C.blue }}> · 🚗 Kompensasi</span>}{p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: C.blue }}>📎</a>}</span>
                  <button onClick={() => deletePayment(detailJobLive.id, p.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Hapus</button>
                </div>
              ))}
            </div>
          )}

          {detailJobLive.sisa > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => setDpTipe("transfer")} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", border: `1px solid ${dpTipe === "transfer" ? C.gold : C.line}`, background: dpTipe === "transfer" ? "#2a1f0d" : "none", color: dpTipe === "transfer" ? C.gold : C.mute }}>💵 Transfer</button>
                <button onClick={() => setDpTipe("kompensasi")} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", border: `1px solid ${dpTipe === "kompensasi" ? C.blue : C.line}`, background: dpTipe === "kompensasi" ? "#0d1b2a" : "none", color: dpTipe === "kompensasi" ? C.blue : C.mute }}>🚗 Kompensasi</button>
              </div>
              {dpTipe === "kompensasi" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input style={I} placeholder="Tipe kendaraan" value={dpKomp.vehicle} onChange={(e) => setDpKomp((k) => ({ ...k, vehicle: e.target.value }))} />
                  <input style={I} placeholder="No. Pol / Rangka" value={dpKomp.nounit} onChange={(e) => setDpKomp((k) => ({ ...k, nounit: e.target.value.toUpperCase() }))} />
                  <input style={I} placeholder="Kota asal" value={dpKomp.asal} onChange={(e) => setDpKomp((k) => ({ ...k, asal: e.target.value }))} />
                  <input style={I} placeholder="Kota tujuan" value={dpKomp.tujuan} onChange={(e) => setDpKomp((k) => ({ ...k, tujuan: e.target.value }))} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden", marginBottom: 8 }}>
                <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
                <input inputMode="numeric" value={fmtRpInput(dpAmount)} onChange={(e) => setDpAmount(onlyDigits(e.target.value))} placeholder={dpTipe === "kompensasi" ? "Nilai unit" : "Jumlah bayar"} style={{ border: "none", background: "none", color: C.ink, fontSize: 18, fontWeight: 700, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input type="date" style={I} value={dpTanggal} onChange={(e) => setDpTanggal(e.target.value)} />
                <input style={I} placeholder="Catatan" value={dpCatatan} onChange={(e) => setDpCatatan(e.target.value)} />
              </div>
              <input ref={dpFileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setDpFile(e.target.files?.[0] || null)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...BTN_GHOST, flex: 1 }} onClick={() => dpFileRef.current?.click()}>{dpFile ? `📎 ${dpFile.name.slice(0, 16)}` : "📎 Bukti"}</button>
                <button style={{ ...BTN, flex: 2 }} onClick={submitDetailPay} disabled={dpSaving}>{dpSaving ? "Menyimpan…" : "Simpan"}</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Edit supplier ── */}
      {editOpen && (
        <Modal title="Edit Supplier" onClose={() => setEditOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setEditOpen(false)}>Batal</button><button style={BTN} onClick={saveEdit}>Simpan</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div><label style={L}>Jenis</label><input style={I} value={editForm.jenis} onChange={(e) => setEditForm((f) => ({ ...f, jenis: e.target.value }))} placeholder="mis. Jasa Supir" /></div>
            <div><label style={L}>No. HP</label><input style={I} value={editForm.no_hp} onChange={(e) => setEditForm((f) => ({ ...f, no_hp: e.target.value }))} /></div>
            <div><label style={L}>Catatan</label><input style={I} value={editForm.catatan} onChange={(e) => setEditForm((f) => ({ ...f, catatan: e.target.value }))} /></div>
          </div>
        </Modal>
      )}

      {/* ── Modal: Detail transaksi (alokasi) ── */}
      {txnDetail && (
        <Modal title="Detail Pembayaran" onClose={() => setTxnDetail(null)}
          foot={<button style={BTN_GHOST} onClick={() => setTxnDetail(null)}>Tutup</button>}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Tanggal</span><b>{fDate(txnDetail.tanggal)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Metode</span><b>{txnDetail.metode}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span style={{ color: C.mute }}>Total</span><b style={{ color: C.green, fontSize: 17 }}>{fRp(txnDetail.total)}</b></div>
          {txnDetail.catatan && <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Catatan: {txnDetail.catatan}</div>}
          <div style={{ ...L }}>Dialokasikan ke ({txnDetail.allocs.length} unit)</div>
          {txnDetail.allocs.map((a, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
              <span>{a.nopol} <span style={{ color: C.mute }}>· {a.rute}</span></span>
              <b>{fRp(a.amount)}</b>
            </div>
          ))}
          {(() => {
            const totalAlokasi = txnDetail.allocs.reduce((s, a) => s + (a.amount || 0), 0);
            const beda = totalAlokasi - (txnDetail.total || 0);
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "8px 0 4px", fontWeight: 800 }}>
                  <span>Total Alokasi</span><b>{fRp(totalAlokasi)}</b>
                </div>
                {beda === 0 ? (
                  <div style={{ fontSize: 12, fontWeight: 800, color: C.green }}>✓ Alokasi sesuai</div>
                ) : (
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.red, background: "#2d1214", border: `1px solid ${C.red}`, borderRadius: 8, padding: "8px 10px", marginTop: 4 }}>
                    ⚠ Alokasi tidak sama dengan nominal transfer. Selisih: {fRp(Math.abs(beda))} ({beda > 0 ? "alokasi lebih besar" : "alokasi lebih kecil"}).
                  </div>
                )}
              </>
            );
          })()}
          {txnDetail.bukti_url && <a href={resolveUrl(txnDetail.bukti_url)} target="_blank" rel="noreferrer" style={{ ...BTN_GHOST, display: "block", textAlign: "center", marginTop: 12, textDecoration: "none" }}>📎 Lihat Bukti Transfer</a>}
          <input ref={txnBuktiRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => uploadTxnBukti(e.target.files?.[0] || null)} data-testid="sup-txn-bukti-file" />
          <button style={{ ...(txnDetail.bukti_url ? BTN_GHOST : BTN), width: "100%", marginTop: txnDetail.bukti_url ? 8 : 12 }} disabled={txnBuktiSaving} onClick={() => txnBuktiRef.current?.click()} data-testid="sup-txn-bukti-upload">
            {txnBuktiSaving ? "Mengunggah…" : (txnDetail.bukti_url ? "🔄 Ganti Bukti Transfer" : "📎 Upload Bukti Transfer")}
          </button>
          {!txnDetail.bukti_url && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 6, textAlign: "center" }}>Belum ada bukti — bisa diupload sekarang biar lengkap.</div>}
        </Modal>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#1a2233", border: `1px solid ${C.gold}`, color: C.gold, padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, zIndex: 999, maxWidth: "90%", textAlign: "center" }}>{toast}</div>
      )}
    </div>
  );
}

/* ── Bottom-sheet / modal responsif (mobile = nempel bawah) ── */
function Modal({ title, onClose, children, foot }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, maxHeight: "92vh", display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: "18px 18px 0 0", }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px 10px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: "#21262d", border: "none", borderRadius: "50%", width: 34, height: 34, color: C.ink, fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>{children}</div>
        {foot && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px calc(env(safe-area-inset-bottom) + 14px)", borderTop: `1px solid ${C.line}` }}>{foot}</div>}
      </div>
    </div>
  );
}
