/* eslint-disable */
// Komponen bersama: tombol + modal "Cetak Penawaran Resmi (A4)".
// Dipakai di halaman customer (CustomerPricePage) DAN halaman admin Kalkulator
// (CostCalculator). Bisa centang rute (pisahin per wilayah, mis. Kalimantan),
// isi nama + jabatan + stempel. Output A4 gaya invoice, huruf besar.
import { useState } from "react";
import { DOC_BRAND, nextDocNo } from "./docTheme";

// Pilihan rate premi asuransi (% dari nilai pertanggungan) — default 0,15%.
const INS_RATE_OPTIONS = [
  { value: "0.15", label: "0,15% — Standar (default)" },
  { value: "0.135", label: "0,135% — Diskon / Khusus" },
];
// Template tampilan penawaran. "standar" = desain navy-gold yang sudah berjalan (tidak diubah).
export const PENAWARAN_TEMPLATES = [
  { value: "standar", label: "Standar (navy · gold · light blue)" },
  { value: "corporate", label: "Corporate Signature (minimalis, abu-abu muda)" },
  { value: "classic", label: "Corporate Classic (judul besar, tanpa kotak total)" },
];
const TPL_LS_KEY = "aal_penawaran_tpl_v1";
function loadTpl() { try { const v = localStorage.getItem(TPL_LS_KEY); return PENAWARAN_TEMPLATES.some((t) => t.value === v) ? v : "standar"; } catch { return "standar"; } }
function saveTpl(v) { try { localStorage.setItem(TPL_LS_KEY, v); } catch {} }
const fRate = (r) => String(r).replace(".", ",");   // tampil gaya Indonesia (0,135)

function fRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";
const gold = "#b8860b";

// Opsi harga/metode per rute. PENTING: opsi = ALTERNATIF (customer pilih salah
// satu), BUKAN komponen yang dijumlahkan. Tidak ada SUM antar-opsi.
const METODE_LIST = ["Self Drive", "Kapal Laut", "Container", "Car Carrier", "Towing", "Self Loader", "Low Bed", "Handling / Pelabuhan", "Lainnya"];
function routeOptions(e) {
  return Array.isArray(e && e.options) ? e.options.filter((o) => (String(o.metode || "").trim() || (Number(o.harga) || 0) > 0)) : [];
}
// Nilai FINAL 1 rute = harga opsi terpilih (kalau ada opsi) atau harga_deal (simple).
// Tidak pernah menjumlahkan antar-opsi.
function routeFinalOption(e) {
  const opts = routeOptions(e);
  if (!opts.length) return null;
  const idx = (typeof e.selected === "number" && e.selected >= 0 && e.selected < opts.length) ? e.selected : 0;
  return opts[idx];
}
function routeFinalHarga(e) {
  const sel = routeFinalOption(e);
  return sel ? (Number(sel.harga) || 0) : (e.harga_deal || 0);
}
// Jumlah unit per rute (default 1). Harga opsi = harga PER UNIT; jumlah = harga × unit.
function routeQty(e) { const q = Math.floor(Number(e && e.qty)); return q >= 1 ? q : 1; }
function routeFinalMetode(e) {
  const sel = routeFinalOption(e);
  return sel ? (sel.metode || "-") : (e.moda || "-");
}

// Membangun HTML penawaran. forImage=true → tanpa dialog cetak & lebar kontainer tetap (dirender jadi gambar).
async function buildPenawaran(rows, meta, forImage) {
  const { nama_pt, ttdNama, ttdJabatan, stempel, tanggal, insVal, insRate, withPpn, taxIncl, withPph, catatan } = meta || {};
  const classic = (meta && meta.template) === "classic";   // template Corporate Classic
  const corp = classic || (meta && meta.template) === "corporate";   // keluarga Corporate (Signature & Classic)
  const preview = !!(meta && meta.preview);               // tampilkan dulu, cetak lewat tombol
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtTgl = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "-");
  const now = new Date();
  // Tanggal penawaran: pakai input manual kalau ada (yyyy-mm-dd), fallback hari ini.
  const tglPakai = tanggal ? `${tanggal}T00:00:00` : now.toISOString();
  const noDoc = await nextDocNo("penawaran", "PH"); // nomor auto-increment
  // Mode: "draft" = Opsi Harga (alternatif per rute, TANPA total gabungan) ·
  //       "final" = Resmi (1 opsi terpilih per rute → baru total dihitung).
  const isDraft = (meta && meta.mode) === "draft";
  // Subtotal (hanya FINAL) = jumlah HARGA FINAL tiap rute (opsi terpilih / simple).
  // Tidak pernah menjumlahkan antar-opsi.
  const subtotal = isDraft ? 0 : (rows || []).reduce((s, e) => s + routeFinalHarga(e) * routeQty(e), 0);
  const hasQty = (rows || []).some((e) => routeQty(e) > 1);   // kolom Unit / Harga per unit / Jumlah hanya muncul kalau ada rute > 1 unit
  // ── Pajak (mirip invoice): PPN 1,1% + toggle "harga sudah termasuk" + potong PPh 23 2% ──
  const ppnOn = !!withPpn, incl = !!taxIncl, pphOn = !!withPph;
  const dpp = (ppnOn && incl) ? Math.round(subtotal / 1.011) : subtotal;
  const ppn = !ppnOn ? 0 : (incl ? subtotal - dpp : Math.round(subtotal * 0.011));
  const pph = pphOn ? Math.round(dpp * 0.02) : 0;
  const shipTotal = (incl ? subtotal : subtotal + ppn) - pph;
  // ── Asuransi (DI LUAR pajak): premi = nilai pertanggungan × rate% ──
  // PER BARIS (tiap unit/rute punya nilai pertanggungan sendiri, mis. Terios 190jt, HRV 150jt):
  // premi tiap baris dibulatkan SENDIRI-SENDIRI, lalu total premi = jumlah premi baris —
  // jadi angka di kolom tabel & di ringkasan selalu persis sama. Fallback lama: 1 nilai global (insVal).
  const rate = (insRate === 0 || insRate) ? Number(insRate) : 0.15;
  const rowNilai = (e) => Number(e && e.insNilai) || 0;
  // nilai pertanggungan diisi PER UNIT; premi baris = premi 1 unit (dibulatkan) × jumlah unit
  const rowPremi = (e) => { const n = rowNilai(e); return n > 0 ? Math.round(n * (rate / 100)) * routeQty(e) : 0; };
  const perRow = !isDraft && (rows || []).some((e) => rowNilai(e) > 0);
  // Mode DRAFT (opsi harga): asuransi per METODE (tiap opsi punya nilai pertanggungan sendiri) → kolom "Premi Asuransi"
  // per baris opsi (per unit, tanpa total & pajak). Rute tanpa opsi memakai nilai pertanggungan rute.
  const optPremi = (o) => { const n = Number(o && o.ins) || 0; return n > 0 ? Math.round(n * (rate / 100)) : 0; };
  const draftIns = isDraft && (rows || []).some((e) => { const op = routeOptions(e); return op.length ? op.some((o) => optPremi(o) > 0) : rowNilai(e) > 0; });
  // Sel "Premi Asuransi" + sel "Total" (harga + premi, per unit). Baris tanpa asuransi: "-" di keduanya.
  const premiCellDraft = (nilai, harga) => nilai > 0
    ? `<td class="r">${fRp(Math.round(nilai * (rate / 100)))}<div class="ph-note">Nilai Pertanggungan ${fRp(nilai)}</div></td><td class="r"><b>${fRp((Number(harga) || 0) + Math.round(nilai * (rate / 100)))}</b></td>`
    : `<td class="r">-</td><td class="r">-</td>`;
  const insBase = perRow
    ? (rows || []).reduce((s, e) => s + rowNilai(e) * routeQty(e), 0)
    : (Number(String(insVal ?? "").replace(/[^0-9]/g, "")) || 0);
  const premi = perRow
    ? (rows || []).reduce((s, e) => s + rowPremi(e), 0)
    : (insBase > 0 ? Math.round(insBase * (rate / 100)) : 0);
  const grandTotal = shipTotal + premi;
  const hasBreakdown = ppnOn || pph > 0 || premi > 0;
  // ── Kolom TEMPLATE LAMA (menyamping): No | Rute | Moda | Tipe Kendaraan | [Unit] | [Premi] | Harga | [Jumlah] ──
  const showQty = hasQty && !isDraft;
  const ncols = 5 + (showQty ? 2 : 0) + (perRow ? 1 : 0) + (draftIns ? 2 : 0);
  // Lebar halaman PDF mengikuti jumlah kolom: kolom sedikit → halaman sempit → huruf besar di HP;
  // kolom banyak (Unit + Premi + Jumlah) → halaman lebih lebar supaya Rute & Moda tidak terlalu turun baris.
  const pageMm = 210;   // A4 portrait (sesuai desain navy-gold)
  const contW = Math.round((pageMm - 10) * 3.78) + 48;   // lebar kontainer saat dirender jadi gambar (isi = lebar halaman PDF)
  const padat = ncols >= 8;                 // kasus terpadat (Unit + Premi + Jumlah): font 13px, kolom angka lebih ramping
  const fs = padat ? 13 : 14;
  // Lebar kolom (px, table-layout fixed): Rute = sisa. Kolom angka cukup lebar supaya "Rp 20.000.000" tidak meluber.
  const colW = draftIns ? [34, null, 92, 98, 108, 124, 112] : [34, null, padat ? 88 : 112, padat ? 84 : 116].concat(showQty ? [40] : [], [padat ? 108 : 132], perRow ? [padat ? 132 : 170] : [], showQty ? [padat ? 112 : 134] : []);
  const colgroup = `<colgroup>${colW.map((w) => (w ? `<col style="width:${w}px">` : "<col>")).join("")}</colgroup>`;
  // Tiap rute = 1 <tbody> supaya 1 rute tidak pecah antar-halaman & tetap 1 item.
  const body = (rows || []).map((e, i) => {
    const opts = routeOptions(e);
    const catatanHtml = e.catatan ? `<div class="ph-note">${esc(e.catatan)}</div>` : "";
    // DRAFT + punya opsi → listing alternatif (○), TANPA Total Rute (customer pilih 1).
    if (isDraft && opts.length) {
      const main = `<tr class="ph-main">
        <td class="c">${i + 1}</td>
        <td><b>${esc(e.rute || "-")}</b>${routeQty(e) > 1 ? `<div class="ph-note">Jumlah ${routeQty(e)} unit (harga per unit)</div>` : ""}${catatanHtml}</td>
        <td>${opts.length > 1 ? "Opsi Pengiriman" : esc(opts[0].metode || "-")}</td>
        <td>${esc(e.tipe_kendaraan || "-")}</td>
        <td class="r ph-opt-hint">pilih salah satu</td>
        ${draftIns ? "<td></td><td></td>" : ""}
      </tr>`;
      const subs = opts.map((o) => `<tr class="ph-sub">
        <td></td>
        <td colspan="3" class="ph-sub-k">○ ${esc(o.metode || "-")}${o.catatan ? ` <span class="ph-sub-note">(${esc(o.catatan)})</span>` : ""}</td>
        <td class="r ph-sub-v">${fRp(o.harga || 0)}</td>
        ${draftIns ? premiCellDraft(Number(o.ins) || 0, o.harga) : ""}
      </tr>`).join("");
      return `<tbody class="ph-route">${main}${subs}</tbody>`;
    }
    // FINAL (atau simple / 1 opsi) → 1 baris: metode + harga terpilih.
    const harga = isDraft ? (e.harga_deal || 0) : routeFinalHarga(e);
    const metode = isDraft ? (e.moda || "-") : routeFinalMetode(e);
    const main = `<tr class="ph-main-single">
      <td class="c">${i + 1}</td>
      <td><b>${esc(e.rute || "-")}</b>${catatanHtml}</td>
      <td>${esc(metode)}</td>
      <td>${esc(e.tipe_kendaraan || "-")}</td>
      ${showQty ? `<td class="c">${routeQty(e)}</td>` : ""}
      <td class="r"><b>${fRp(harga)}</b></td>
      ${(isDraft && draftIns) ? premiCellDraft(rowNilai(e), harga) : ""}
      ${perRow ? `<td class="r">${rowPremi(e) > 0 ? `${fRp(rowPremi(e))}<div class="ph-note">Nilai Pertanggungan ${fRp(rowNilai(e))}${routeQty(e) > 1 ? " / unit" : ""}</div>` : "-"}</td>` : ""}
      ${showQty ? `<td class="r"><b>${fRp(harga * routeQty(e))}</b></td>` : ""}
    </tr>`;
    return `<tbody class="ph-route">${main}</tbody>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${noDoc}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    html, body, .pdf-container, .pdf-container * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: geometricPrecision; }
    body { font-family: 'Inter', 'SF Pro Text', -apple-system, Helvetica, Arial, sans-serif; font-size: 13px; color: #212121; background: #ffffff; }
    /* Kartu mobile: lebar maksimal 650px supaya padat & besar saat dilihat di HP. */
    .pdf-container { width: 100%; max-width: ${Math.round((pageMm - 10) * 3.78)}px; margin: 0 auto; padding: 24px; background: #ffffff; }
    :root { --navy:#0F2A5C; --gold:#C9973A; --lb:#E3F0FA; --ink:#1B2433; --mut:#4A5568; --ln:#DCE6F2; }
    .ph-head { display:flex; align-items:center; gap:16px; padding-bottom:16px; border-bottom:2px solid var(--gold); margin-bottom:16px; }
    .ph-head img { width:66px; height:66px; object-fit:contain; flex-shrink:0; filter:drop-shadow(0 2px 2.5px rgba(15,42,92,.38)) drop-shadow(0 0 .5px rgba(15,42,92,.3)); }   /* logo asli, sedikit timbul */
    .ph-head .sep { width:2px; align-self:stretch; background:var(--gold); margin:4px 0; }
    .ph-pt { font-size:26px; font-weight:800; color:var(--navy); line-height:1.15; letter-spacing:.2px; }
    .ph-tag { font-size:16px; font-weight:700; color:var(--gold); margin-top:4px; }
    .ph-title { font-size:30px; font-weight:800; color:var(--navy); letter-spacing:.3px; margin:0 0 8px; }
    .ph-info { margin-bottom:16px; }
    .ph-line { display:grid; grid-template-columns:200px 22px 1fr; align-items:start; padding:5px 4px; font-size:15px; color:var(--ink); }
    .ph-line .c { font-weight:500; }
    .ph-line .v { font-weight:700; text-align:right; }
    .ph-total { display:flex; justify-content:space-between; align-items:center; border-radius:12px; padding:0 0 0 20px; margin:6px 0 20px; min-height:62px; overflow:hidden;
      background:linear-gradient(105deg, var(--lb) 0%, var(--lb) 63%, #F1DFA6 63.2%, #D4A94B 100%); }
    .ph-total .lbl { font-size:18px; font-weight:800; color:var(--navy); }
    .ph-total .val { font-size:28px; font-weight:800; color:var(--ink); padding:12px 22px 12px 60px; white-space:nowrap; }
    .ph-sec { font-size:18px; font-weight:800; color:var(--navy); text-transform:uppercase; margin:16px 0 8px; padding-left:12px; border-left:5px solid var(--gold); line-height:1.1; }
    table.ph { width:100%; border-collapse:separate; border-spacing:0; table-layout:fixed; border:1px solid var(--ln); border-radius:10px; overflow:hidden; }
    table.ph thead { display:table-header-group; }        /* header diulang tiap halaman */
    table.ph th, table.ph td { padding:12px 8px; border-bottom:1px solid var(--ln); border-right:1px solid var(--ln); text-align:left; vertical-align:top; overflow-wrap:anywhere; }
    table.ph th:last-child, table.ph td:last-child { border-right:none; }
    table.ph th { vertical-align:middle; overflow-wrap:normal; background:var(--lb); color:var(--navy); font-weight:800; font-size:14px; border-bottom:1px solid var(--ln); border-right:none; }
    table.ph td { font-size:${fs}px; font-weight:500; color:var(--ink); line-height:1.35; }
    table.ph th.c, table.ph td.c { padding-left:4px; padding-right:4px; white-space:nowrap; }
    table.ph td b { font-weight:700; }
    table.ph th.r, table.ph td.r { text-align:right; } table.ph th.c, table.ph td.c { text-align:center; }
    table.ph td.r { white-space:nowrap; overflow-wrap:normal; }
    table.ph .ph-note { font-size:12px; color:var(--mut); font-style:italic; margin-top:2px; font-weight:400; white-space:normal; overflow-wrap:break-word; line-height:1.3; }
    table.ph tbody.ph-route { break-inside:avoid; page-break-inside:avoid; }
    table.ph tbody tr { break-inside:avoid; page-break-inside:avoid; }
    table.ph tbody:last-of-type tr:last-child td { border-bottom:none; }
    table.ph tr.ph-main td { border-bottom:none; padding-bottom:4px; }
    table.ph tr.ph-sub td { border-bottom:none; padding-top:2px; padding-bottom:2px; }
    table.ph .ph-sub-k { padding-left:16px !important; font-size:${fs}px; color:var(--ink); font-weight:500; }
    table.ph .ph-sub-note { font-style:italic; color:var(--mut); }
    table.ph .ph-sub-v { font-size:${fs}px; font-weight:700; white-space:nowrap; }
    table.ph .ph-opt-hint { font-size:12px; font-style:italic; color:var(--mut); font-weight:500; }
    .ph-draft-note { font-size:13px; color:var(--ink); line-height:1.6; background:var(--lb); border-left:4px solid var(--gold); border-radius:8px; padding:12px 14px; margin:12px 0 2px; }
    .ph-sum { margin:0; break-inside:avoid; page-break-inside:avoid; }
    .ph-sum .row { display:flex; justify-content:space-between; gap:12px; padding:9px 8px; font-size:15px; border-bottom:1px solid var(--ln); }
    .ph-sum .row .k { color:var(--ink); font-weight:500; }
    .ph-sum .row .v { font-weight:700; color:var(--ink); white-space:nowrap; }
    .ph-sum .row.minus .v { color:#b45309; }
    .ph-grand { margin-top:14px; border-radius:12px; padding:0 0 0 22px; min-height:62px; display:flex; justify-content:space-between; align-items:center; gap:12px; overflow:hidden;
      background:linear-gradient(105deg, var(--navy) 0%, var(--navy) 63%, #F1DFA6 63.2%, #D4A94B 100%); }
    .ph-grand .k { font-size:20px; font-weight:800; color:#ffffff; text-transform:uppercase; }
    .ph-grand .v { font-size:28px; font-weight:800; color:var(--ink); white-space:nowrap; padding:12px 22px 12px 60px; }
    .ph-pay-box { display:flex; align-items:center; gap:16px; padding:14px 18px; background:var(--lb); border-radius:12px; margin:16px 0 10px; break-inside:avoid; }
    .ph-pay-badge { font-weight:900; font-style:italic; font-size:26px; color:#1565C0; padding-right:16px; border-right:2px solid var(--gold); line-height:1.1; flex-shrink:0; }
    .ph-pay-num { font-size:22px; font-weight:800; letter-spacing:.5px; color:var(--ink); }
    .ph-pay-name { font-size:14px; font-weight:500; color:var(--ink); margin-top:2px; }
    .ph-valid { font-size:14px; font-weight:500; color:var(--ink); line-height:1.6; margin-bottom:8px; }
    .ph-valid b { font-weight:700; }
    .ph-valid b.cat { color:var(--gold); }
    .ph-sign-row { display:flex; justify-content:flex-end; margin-top:10px; break-inside:avoid; page-break-inside:avoid; }
    .ph-sign-cell { width:260px; text-align:center; }
    .ph-sign-lbl { font-size:14px; font-weight:500; color:var(--ink); margin-bottom:6px; }
    .ph-sign-stamp { height:70px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
    .ph-sign-stamp img { max-height:86px; max-width:220px; object-fit:contain; }
    .ph-sign-stamp.empty { height:56px; }
    .ph-sign-pt, .ph-sign-name { font-size:14px; font-weight:700; color:var(--ink); }
    .ph-sign-name { margin-top:2px; font-weight:500; }
    .ph-sign-jab { font-size:13px; font-weight:500; color:var(--mut); margin-top:2px; }
    .ph-foot { display:flex; justify-content:space-between; gap:8px; padding-top:8px; margin-top:12px; border-top:2px solid var(--gold); font-size:12px; font-weight:500; color:var(--mut); }
    /* ── Corporate Classic: judul besar, tanpa kotak Total Nilai, kotak BCA tanpa latar, gold lebih hangat ── */
    body.tpl-classic { --gold:#E0A526; }
    body.tpl-classic .ph-title { margin:6px 0 10px; }
    body.tpl-classic .ph-info { margin-top:6px; margin-bottom:34px; }
    body.tpl-corp.tpl-classic .ph-pay-box { background:transparent; padding:10px 4px; margin:20px 0 12px; }
    body.tpl-classic .ph-pay-badge { font-size:30px; }
    .pv-bar { position:sticky; top:0; z-index:5; display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 14px; background:#0F2A5C; color:#fff; font-size:13px; font-weight:600; }
    .pv-bar button { font:inherit; font-weight:800; padding:7px 14px; border:none; border-radius:8px; background:#fff; color:#0F2A5C; cursor:pointer; }
    @media print { .pv-bar { display:none; } }
    /* ── Template Corporate Signature: putih, navy, abu-abu sangat muda; gold hanya garis tipis & tagline. Tanpa gradasi. ── */
    body.tpl-corp { --lb:#F3F5F8; --ln:#E3E7ED; }
    body.tpl-corp .ph-head img { filter:none; }
    body.tpl-corp .ph-info { margin-top:22px; margin-bottom:12px; }
    body.tpl-corp .ph-total { background:var(--lb); padding-left:20px; margin:8px 0 22px; }
    body.tpl-corp .ph-total .val { color:var(--navy); padding:12px 22px; }
    body.tpl-corp table.ph { border-color:var(--ln); }
    body.tpl-corp table.ph th { background:var(--lb); }
    body.tpl-corp .ph-sum { margin-top:18px; }
    body.tpl-corp .ph-grand { background:var(--navy); padding-right:22px; }
    body.tpl-corp .ph-grand .v { color:#fff; padding:0 0 0 16px; border-left:3px solid var(--gold); line-height:1.4; }
    body.tpl-corp .ph-pay-box { background:var(--lb); }
    /* Halaman PDF dibuat sempit (lebar mengikuti jumlah kolom) → saat dibuka/di-screenshot di HP teksnya besar, bukan mengecil ke lebar A4. */
    @page { size: A4 portrait; margin: 8mm; }
    @media print { .pdf-container { padding: 0; max-width: none; } }
    ${forImage ? `body { width: ${contW}px; } .pdf-container { width: ${contW}px; max-width: none; margin: 0; padding: 24px; }` : ""}
  </style></head><body class="${corp ? "tpl-corp" : "tpl-std"}${classic ? " tpl-classic" : ""}">
  ${preview ? `<div class="pv-bar"><span>Preview — ${noDoc}</span><button onclick="window.print()">🖨️ Cetak / Simpan PDF</button></div>` : ""}
  <div class="pdf-container">
    <div class="ph-head">
      <img src="/logo.png" alt="Logo">
      <div class="sep"></div>
      <div>
        <div class="ph-pt">${DOC_BRAND.name}</div>
        <div class="ph-tag">${DOC_BRAND.tagline}</div>
      </div>
    </div>
    ${corp && !classic && !isDraft ? "" : `<div class="ph-title">${isDraft ? "PENAWARAN HARGA (OPSI)" : "PENAWARAN HARGA"}</div>`}
    <div class="ph-info">
      <div class="ph-line"><span>Kepada Yth.</span><span class="c">:</span><span class="v">${esc(nama_pt || "-")}</span></div>
      <div class="ph-line"><span>Periode Penawaran</span><span class="c">:</span><span class="v">${fmtTgl(tglPakai)} (Berlaku 7 Hari)</span></div>
      <div class="ph-line"><span>No. Penawaran</span><span class="c">:</span><span class="v">${noDoc}</span></div>
    </div>
    ${isDraft || classic ? "" : `<div class="ph-total"><span class="lbl">Total Nilai Penawaran</span><span class="val">${fRp(grandTotal)}</span></div>`}
    ${corp && !isDraft ? "" : `<div class="ph-sec">${isDraft ? "Opsi Harga — Pilih Salah Satu Metode" : "Rincian Penawaran"}</div>`}
    <table class="ph">
      ${colgroup}
      <thead><tr>
        <th class="c">No</th><th>Rute</th><th>Moda</th><th>Tipe Kendaraan</th>${showQty ? `<th class="c">Unit</th>` : ""}<th class="r">${showQty ? "Harga / Unit" : "Harga"}</th>${perRow ? `<th class="r">Premi Asuransi</th>` : ""}${draftIns ? `<th class="r">Premi Asuransi</th><th class="r">Total</th>` : ""}${showQty ? `<th class="r">Jumlah</th>` : ""}
      </tr></thead>
      ${body}
    </table>
    ${isDraft ? `
    <div class="ph-draft-note">Ini penawaran <b>opsi harga</b>. Setiap rute menampilkan beberapa alternatif metode — silakan pilih <b>salah satu</b> per rute. Total &amp; pajak dihitung pada penawaran resmi setelah metode dipilih.</div>
    ` : `
    ${corp ? "" : `<div class="ph-sec">Ringkasan Biaya</div>`}
    <div class="ph-sum">
      <div class="row"><span class="k">${ppnOn && incl ? "DPP (Dasar Pengenaan Pajak)" : "Subtotal Pengiriman"}</span><span class="v">${fRp(ppnOn && incl ? dpp : subtotal)}</span></div>
      ${ppnOn ? `<div class="row"><span class="k">PPN 1,1%${incl ? " (sudah termasuk)" : ""}</span><span class="v">${fRp(ppn)}</span></div>` : ""}
      ${pph ? `<div class="row minus"><span class="k">Potongan PPh 23 (2%)</span><span class="v">- ${fRp(pph)}</span></div>` : ""}
      ${premi ? `<div class="row"><span class="k">${perRow ? "Total Premi Asuransi" : "Premi Asuransi"} (${fRp(insBase)} &times; ${fRate(rate)}%)</span><span class="v">${fRp(premi)}</span></div>` : ""}
    </div>
    <div class="ph-grand"><span class="k">Grand Total</span><span class="v">${fRp(grandTotal)}</span></div>
    `}
    <div class="ph-pay-box">
      <div class="ph-pay-badge">${DOC_BRAND.bank.name}</div>
      <div>
        <div class="ph-pay-num">${DOC_BRAND.bank.norek}</div>
        <div class="ph-pay-name">Cabang ${DOC_BRAND.bank.cabang} &middot; a.n. ${DOC_BRAND.bank.an}</div>
      </div>
    </div>
    ${catatan && String(catatan).trim() ? `<div class="ph-valid"><b>Keterangan:</b> ${esc(String(catatan).trim()).replace(/\n/g, "<br>")}</div>` : ""}
    <div class="ph-valid">
      <b class="cat">Catatan:</b> Harga di atas berlaku 7 (tujuh) hari sejak tanggal penawaran &amp; dapat berubah sewaktu-waktu mengikuti kondisi operasional. Untuk konfirmasi hubungi <b>0818 631 135</b>.
    </div>
    <div class="ph-sign-row">
      <div class="ph-sign-cell">
        <div class="ph-sign-lbl">Hormat Kami,</div>
        <div class="ph-sign-stamp ${stempel ? "" : "empty"}">${stempel ? `<img src="${stempel}" alt="stempel">` : ""}</div>
        <div class="ph-sign-pt">PT. Alyssa Auto Logistik</div>
        ${ttdNama ? `<div class="ph-sign-name">( ${esc(ttdNama)} )</div>` : ""}
        ${ttdJabatan ? `<div class="ph-sign-jab">${esc(ttdJabatan)}</div>` : ""}
      </div>
    </div>
    <div class="ph-foot"><span>Penawaran ${noDoc}</span><span>${DOC_BRAND.tagline}</span></div>
  </div>
  ${forImage || preview ? "" : `  <script>
    // Tunggu font Inter siap (maks 1,5 dtk) supaya hasil cetak memakai font yang tajam, lalu buka dialog cetak.
    Promise.race([ (document.fonts && document.fonts.ready) || Promise.resolve(), new Promise(function(r){ setTimeout(r, 1500); }) ]).then(function(){ window.print(); });
  <\/script>`}
  </body></html>`;
  return { html, noDoc, contW };
}

export async function printPenawaran(rows, meta) {
  const w = window.open("", "_blank"); // buka dulu (dalam gesture klik) biar nggak keblok popup
  const { html } = await buildPenawaran(rows, meta, false);
  if (w) { w.document.write(html); w.document.close(); }
}

// Preview: buka dokumen tanpa dialog cetak; ada tombol Cetak / Simpan PDF di bagian atas.
export async function previewPenawaran(rows, meta) {
  const w = window.open("", "_blank");
  const { html } = await buildPenawaran(rows, { ...(meta || {}), preview: true }, false);
  if (w) { w.document.write(html); w.document.close(); }
}

// Render HTML ke PNG tajam (scale hingga 3x) lewat iframe tersembunyi — untuk dikirim lewat WhatsApp.
export async function htmlKePng(html, lebar, selector = ".pdf-container") {
  const { default: html2canvas } = await import("html2canvas");
  const fr = document.createElement("iframe");
  fr.setAttribute("aria-hidden", "true");
  fr.style.cssText = `position:fixed;left:-99999px;top:0;width:${lebar}px;height:900px;border:0`;
  document.body.appendChild(fr);
  try {
    await new Promise((res) => { fr.onload = res; fr.srcdoc = html; });
    const d = fr.contentDocument;
    try { await Promise.race([d.fonts.ready, new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* lanjut dengan font bawaan */ }
    await Promise.all(Array.from(d.images).map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));
    const el = d.querySelector(selector);
    const h = el.scrollHeight;
    fr.style.height = h + "px";
    // batas aman ukuran kanvas browser HP (±16 juta piksel)
    const scale = Math.max(1.5, Math.min(3, Math.sqrt(15000000 / (lebar * h))));
    const canvas = await html2canvas(el, { scale, backgroundColor: "#ffffff", useCORS: true, logging: false, width: el.offsetWidth, windowWidth: lebar });
    return await new Promise((res) => canvas.toBlob(res, "image/png"));
  } finally { fr.remove(); }
}

// Simpan penawaran sebagai gambar PNG (dibagikan langsung ke WhatsApp bila perangkat mendukung, kalau tidak diunduh).
export async function simpanPenawaranGambar(rows, meta) {
  const { html, noDoc, contW } = await buildPenawaran(rows, meta, true);
  const blob = await htmlKePng(html, contW);
  if (!blob) throw new Error("gambar kosong");
  return await bagikanPng(blob, noDoc, `Penawaran ${noDoc}`);
}

// Bagikan PNG lewat Web Share (WhatsApp, dsb) bila didukung; kalau tidak, diunduh. → "dibagikan" | "batal" | "diunduh"
export async function bagikanPng(blob, noDoc, judul) {
  const nama = String(noDoc).replace(/[^\w.-]+/g, "_");
  const file = new File([blob], `${nama}.png`, { type: "image/png" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: judul }); return "dibagikan"; }
    catch (e) { if (e && e.name === "AbortError") return "batal"; /* gagal bagikan → unduh saja */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${nama}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "diunduh";
}

// Tombol + modal. `rows` = daftar entri harga (rute, moda, tipe_kendaraan,
// harga_deal, asuransi, catatan, tanggal). `namaPt` = nama pelanggan.
export function PenawaranCetakButton({ rows, namaPt, style }) {
  const [open, setOpen] = useState(false);
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("");
  const [stempel, setStempel] = useState("");
  const [catatanUmum, setCatatanUmum] = useState(""); // catatan bebas (mis. Door to door) → tampil di penawaran
  const [tglPenawaran, setTglPenawaran] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10); // hari ini (lokal), yyyy-mm-dd
  });
  const [selIdx, setSelIdx] = useState(() => new Set());
  const [gambarBusy, setGambarBusy] = useState(false);
  const [cari, setCari] = useState("");
  // Rincian biaya & pajak (opsional) — mirip invoice
  const [qtyMap, setQtyMap] = useState({});       // jumlah unit PER RUTE (key = index, value = digit; kosong = 1)
  const [insMap, setInsMap] = useState({});       // nilai pertanggungan asuransi PER RUTE/UNIT (key = index, value = digit)
  const [tpl, setTplState] = useState(loadTpl);   // template tampilan (diingat di browser ini)
  const setTpl = (v) => { setTplState(v); saveTpl(v); };
  const [insRate, setInsRate] = useState("0.15");  // rate asuransi (%) — sama untuk semua baris
  const [withPpn, setWithPpn] = useState(false);   // kenakan PPN 1,1%
  const [taxIncl, setTaxIncl] = useState(false);   // harga sudah termasuk PPN
  const [withPph, setWithPph] = useState(false);   // potong PPh 23 (2%)
  // Mode Penawaran: "draft" = Opsi Harga (alternatif per rute, TANPA total) ·
  //                 "final" = Resmi (1 opsi terpilih per rute → baru total dihitung).
  const [mode, setMode] = useState("draft");
  // Opsi harga per rute (khusus Penawaran ini, tidak mengubah data sumber).
  // key = index rute di `list`; value = [{metode, harga, catatan}] (ALTERNATIF, tidak dijumlah).
  const [optMap, setOptMap] = useState({});
  const [selMap, setSelMap] = useState({});          // index opsi terpilih per rute (mode final)
  const [expanded, setExpanded] = useState(() => new Set());
  const pNum = (s) => Number(String(s || "").replace(/[^0-9]/g, "")) || 0;
  const optOf = (i) => optMap[i] || [];
  const selOf = (i) => { const o = optOf(i); if (!o.length) return -1; const s = selMap[i]; return (typeof s === "number" && s >= 0 && s < o.length) ? s : 0; };
  // Harga FINAL 1 rute (mode final) = opsi terpilih atau harga_deal. TIDAK menjumlah opsi.
  const qtyOf = (i, e) => { const q = Math.floor(Number(onlyDigits0(qtyMap[i]))); return q >= 1 ? q : (Math.floor(Number(e && e.qty)) >= 1 ? Math.floor(Number(e.qty)) : 1); };
  const onlyDigits0 = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "");
  const routeFinal = (i, e) => { const o = optOf(i); if (!o.length) return e.harga_deal || 0; return pNum(o[selOf(i)].harga); };
  const addOpt = (i, seed) => setOptMap((m) => ({ ...m, [i]: [...(m[i] || []), seed || { metode: "Self Drive", harga: "", catatan: "" }] }));
  const setOpt = (i, ki, patch) => setOptMap((m) => ({ ...m, [i]: (m[i] || []).map((x, idx) => (idx === ki ? { ...x, ...patch } : x)) }));
  const delOpt = (i, ki) => setOptMap((m) => ({ ...m, [i]: (m[i] || []).filter((_, idx) => idx !== ki) }));
  const tarikOpt = (i, e) => { if (optOf(i).length) return; addOpt(i, { metode: e.moda || "Lainnya", harga: String(e.harga_deal || ""), catatan: "" }); setExpanded((s) => new Set(s).add(i)); };
  const toggleExpand = (i) => setExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const list = rows || [];
  const openModal = () => { setSelIdx(new Set(list.map((_, i) => i))); setCari(""); setOptMap({}); setSelMap({}); setInsMap({}); setQtyMap({}); setExpanded(new Set()); setOpen(true); };
  const match = (e) => {
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return `${e.rute || ""} ${e.moda || ""} ${e.tipe_kendaraan || ""} ${e.catatan || ""}`.toLowerCase().includes(q);
  };

  // Live preview rincian (ikut baris yang dicentang).
  const onlyDigits = (s) => String(s || "").replace(/[^0-9]/g, "");
  // Subtotal preview hanya di mode FINAL (draft = opsi, tidak dijumlah).
  const pvSub = mode === "draft" ? 0 : list.reduce((s, e, i) => (selIdx.has(i) ? s + routeFinal(i, e) * qtyOf(i, e) : s), 0);
  const pvDpp = (withPpn && taxIncl) ? Math.round(pvSub / 1.011) : pvSub;
  const pvPpn = !withPpn ? 0 : (taxIncl ? pvSub - pvDpp : Math.round(pvSub * 0.011));
  const pvPph = withPph ? Math.round(pvDpp * 0.02) : 0;
  const pvShip = (taxIncl ? pvSub : pvSub + pvPpn) - pvPph;
  const pvRate = insRate === "" ? 0 : Number(insRate);
  const rowIns = (i) => Number(onlyDigits(insMap[i])) || 0;                       // nilai pertanggungan baris i
  const rowPremiPv = (i) => { const n = rowIns(i); return n > 0 ? Math.round(n * (pvRate / 100)) * qtyOf(i, list[i]) : 0; };   // nilai per unit × rate × jumlah unit
  // Total premi = jumlah premi tiap baris YANG DICENTANG (dibulatkan per baris, sama dgn hasil cetak).
  const pvInsBase = list.reduce((s, _e, i) => (selIdx.has(i) ? s + rowIns(i) * qtyOf(i, _e) : s), 0);
  const pvPremi = list.reduce((s, _e, i) => (selIdx.has(i) ? s + rowPremiPv(i) : s), 0);
  const pvGrand = pvShip + pvPremi;
  const anyBreakdown = withPpn || pvPph > 0 || pvPremi > 0;

  return (
    <>
      <button onClick={openModal}
        style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${gold}`, background: "#fffbeb", color: "#92610b", fontSize: 11, fontWeight: 800, cursor: "pointer", ...style }}>
        🖨️ Cetak Penawaran Resmi
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="pnw-modal"
            style={{ width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", fontFamily: "'Segoe UI',Arial,sans-serif" }}>
            {/* Paksa teks value input GELAP & jelas (anti pucat) di semua tema/browser,
                placeholder tetap abu. Override rule global/dark-theme yang bikin value hilang. */}
            <style>{`
              .pnw-modal input, .pnw-modal textarea, .pnw-modal select {
                color:#111827 !important; -webkit-text-fill-color:#111827 !important;
                opacity:1 !important; background:#fff !important; caret-color:#111827;
              }
              .pnw-modal input::placeholder, .pnw-modal textarea::placeholder {
                color:#9ca3af !important; -webkit-text-fill-color:#9ca3af !important; opacity:1 !important;
              }
            `}</style>
            <datalist id="pnw-metode-dl">{METODE_LIST.map((m) => <option key={m} value={m} />)}</datalist>
            <div style={{ fontSize: 16, fontWeight: 900, color: navy, marginBottom: 3 }}>Cetak Penawaran</div>
            <div style={{ fontSize: 11.5, color: gray, marginBottom: 12 }}>Centang rute yang mau dicetak, isi penanda tangan &amp; stempel. Format A4, tajam buat di-screenshot / print.</div>

            {/* Mode: Draft (Opsi Harga) vs Final (Resmi) */}
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[["draft", "📝 Draft — Opsi Harga", "Beberapa alternatif metode per rute. Tanpa total."], ["final", "✅ Final — Resmi", "1 metode terpilih per rute → total & pajak dihitung."]].map(([k, t, d]) => (
                <button key={k} onClick={() => setMode(k)} data-testid={`pnw-mode-${k}`}
                  style={{ flex: 1, textAlign: "left", padding: "9px 11px", borderRadius: 9, cursor: "pointer",
                    border: `1.5px solid ${mode === k ? navy : border}`, background: mode === k ? "#eff6ff" : "#fff" }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: mode === k ? navy : "#374151" }}>{t}</div>
                  <div style={{ fontSize: 10, color: gray, marginTop: 2, lineHeight: 1.3 }}>{d}</div>
                </button>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: gray }}>PILIH RUTE — {selIdx.size} dari {list.length} dipilih</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setSelIdx(new Set(list.map((_, i) => i)))}
                  style={{ fontSize: 10.5, fontWeight: 700, color: navy, background: "#eff6ff", border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Semua</button>
                <button onClick={() => setSelIdx(new Set())}
                  style={{ fontSize: 10.5, fontWeight: 700, color: gray, background: "#f9fafb", border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Kosongkan</button>
              </div>
            </div>

            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="🔎 cari rute… (mis. kalimantan)"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 12.5, marginBottom: 6 }} />
            {cari.trim() && (
              <button onClick={() => setSelIdx(new Set(list.map((e, i) => (match(e) ? i : -1)).filter((i) => i >= 0)))}
                style={{ fontSize: 11, fontWeight: 700, color: "#92610b", background: "#fffbeb", border: `1px solid ${gold}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginBottom: 8 }}>
                ✓ Centang cuma yang cocok "{cari.trim()}"
              </button>
            )}

            <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${border}`, borderRadius: 8, marginBottom: 16 }}>
              {list.map((e, i) => ({ e, i })).filter(({ e }) => match(e)).map(({ e, i }) => {
                const on = selIdx.has(i);
                const opts = optOf(i);
                const isOpen = expanded.has(i);
                const sub = opts.length
                  ? (mode === "final"
                      ? `${opts[selOf(i)]?.metode || "-"} · ${fRp(routeFinal(i, e))} (terpilih)`
                      : `${opts.length} opsi metode`)
                  : `${e.moda || e.tipe_kendaraan || "-"} · ${fRp(e.harga_deal)}`;
                return (
                  <div key={i} style={{ borderBottom: "1px solid #f1f5f9", background: on ? "#f0fdf4" : "#fff" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
                      <input type="checkbox" checked={on}
                        onChange={() => setSelIdx((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                        style={{ width: 16, height: 16, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.rute || "-"}</div>
                        <div style={{ fontSize: 10.5, color: gray }}>{e.tipe_kendaraan || "-"} · {sub}</div>
                      </div>
                      <button onClick={() => toggleExpand(i)} data-testid={`pnw-opt-toggle-${i}`}
                        style={{ fontSize: 10.5, fontWeight: 700, color: navy, background: "#eff6ff", border: `1px solid ${border}`, borderRadius: 6, padding: "4px 8px", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {isOpen ? "▲ Opsi" : `▾ Opsi${opts.length ? ` (${opts.length})` : ""}`}
                      </button>
                    </div>
                    {on && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px 36px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10.5, color: gray, fontWeight: 700, whiteSpace: "nowrap" }}>🚗 Jumlah unit</span>
                        <input inputMode="numeric" value={qtyMap[i] ?? ""} onChange={(ev) => setQtyMap((m) => ({ ...m, [i]: onlyDigits0(ev.target.value) }))}
                          placeholder="1" data-testid={`pnw-qty-${i}`}
                          style={{ width: 64, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12, textAlign: "right" }} />
                        <span style={{ fontSize: 10.5, color: gray }}>unit{qtyOf(i, e) > 1 ? ` · harga dikalikan ${qtyOf(i, e)}` : ""}</span>
                      </div>
                    )}
                    {on && (mode === "final" || opts.length === 0) && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px 36px", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10.5, color: gray, fontWeight: 700, whiteSpace: "nowrap" }}>🛡️ Asuransi — nilai pertanggungan</span>
                        <input inputMode="numeric" value={insMap[i] ? Number(onlyDigits(insMap[i])).toLocaleString("id-ID") : ""}
                          onChange={(ev) => { const d = onlyDigits(ev.target.value); setInsMap((m) => ({ ...m, [i]: d })); }}
                          placeholder="mis. 190.000.000" data-testid={`pnw-ins-${i}`}
                          style={{ flex: "1 1 120px", minWidth: 0, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12, textAlign: "right" }} />
                        <span style={{ fontSize: 11, fontWeight: 800, color: navy, whiteSpace: "nowrap" }} data-testid={`pnw-ins-premi-${i}`}>{rowPremiPv(i) > 0 ? `Premi ${fRp(rowPremiPv(i))}` : ""}</span>
                      </div>
                    )}
                    {isOpen && (
                      <div style={{ padding: "4px 10px 10px 36px", background: "#fafbfc" }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: gray, textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 6 }}>Opsi Harga / Metode <span style={{ textTransform: "none", fontWeight: 400 }}>(alternatif — customer pilih 1, tidak dijumlah)</span></div>
                        {opts.length === 0 && <div style={{ fontSize: 11, color: gray, marginBottom: 6 }}>Belum ada opsi — pakai harga satuan {fRp(e.harga_deal)}. Tambah opsi kalau mau kasih beberapa pilihan metode.</div>}
                        {opts.map((k, ki) => {
                          const picked = mode === "final" && selOf(i) === ki;
                          return (
                          <div key={ki} style={{ marginBottom: 8, padding: mode === "final" ? "6px 6px 6px 4px" : 0, border: mode === "final" ? `1px solid ${picked ? "#16a34a" : border}` : "none", borderRadius: 8, background: picked ? "#f0fdf4" : "transparent" }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              {mode === "final" && (
                                <input type="radio" name={`pnw-sel-${i}`} checked={picked} onChange={() => setSelMap((m) => ({ ...m, [i]: ki }))} title="Pilih metode ini" data-testid={`pnw-opt-pick-${i}-${ki}`} style={{ width: 15, height: 15, flexShrink: 0 }} />
                              )}
                              {/* Metode: input bebas + saran (datalist) — bisa pilih preset ATAU ketik manual (mis. Car Carrier / kombinasi) */}
                              <input value={k.metode} onChange={(ev) => setOpt(i, ki, { metode: ev.target.value })} data-testid={`pnw-opt-metode-${i}-${ki}`}
                                list="pnw-metode-dl" placeholder="metode (pilih / ketik)"
                                style={{ flex: "1 1 110px", minWidth: 0, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12 }} />
                              <input inputMode="numeric" value={k.harga ? Number(pNum(k.harga)).toLocaleString("id-ID") : ""} onChange={(ev) => setOpt(i, ki, { harga: ev.target.value.replace(/[^0-9]/g, "") })} placeholder="Harga" data-testid={`pnw-opt-harga-${i}-${ki}`}
                                style={{ flex: "1 1 90px", minWidth: 0, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12, textAlign: "right" }} />
                              <button onClick={() => delOpt(i, ki)} title="Hapus opsi"
                                style={{ flexShrink: 0, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕</button>
                            </div>
                            <input value={k.catatan || ""} onChange={(ev) => setOpt(i, ki, { catatan: ev.target.value })} placeholder="Catatan (opsional)"
                              style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: "5px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 11 }} />
                            {mode === "draft" && (
                              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 10.5, color: gray, fontWeight: 700, whiteSpace: "nowrap" }}>🛡️ Asuransi — nilai pertanggungan</span>
                                <input inputMode="numeric" value={k.ins ? Number(onlyDigits(k.ins)).toLocaleString("id-ID") : ""}
                                  onChange={(ev) => setOpt(i, ki, { ins: onlyDigits(ev.target.value) })}
                                  placeholder="kosong = tanpa asuransi" data-testid={`pnw-opt-ins-${i}-${ki}`}
                                  style={{ flex: "1 1 120px", minWidth: 0, padding: "5px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 11, textAlign: "right" }} />
                                <span style={{ fontSize: 11, fontWeight: 800, color: navy, whiteSpace: "nowrap" }}>{Number(onlyDigits(k.ins)) > 0 ? `Premi ${fRp(Math.round(Number(onlyDigits(k.ins)) * (pvRate / 100)))}` : ""}</span>
                              </div>
                            )}
                          </div>
                          );
                        })}
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button onClick={() => addOpt(i)} data-testid={`pnw-opt-add-${i}`}
                            style={{ fontSize: 11, fontWeight: 700, color: navy, background: "#eff6ff", border: `1px solid ${border}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>+ Tambah Opsi</button>
                          {opts.length === 0 && (e.harga_deal || e.moda) ? (
                            <button onClick={() => tarikOpt(i, e)} data-testid={`pnw-opt-tarik-${i}`}
                              style={{ fontSize: 11, fontWeight: 700, color: "#92610b", background: "#fffbeb", border: `1px solid ${gold}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>⇩ Tarik harga saat ini</button>
                          ) : null}
                        </div>
                        {opts.length > 0 && mode === "final" && (
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 6, borderTop: `1px dashed ${border}`, fontSize: 12, fontWeight: 800, color: navy }}>
                            <span>Harga Terpilih ({opts[selOf(i)]?.metode || "-"})</span><span>{fRp(routeFinal(i, e))}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {list.length === 0 && <div style={{ padding: 14, textAlign: "center", color: gray, fontSize: 12 }}>Belum ada rute</div>}
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>TANGGAL PENAWARAN</label>
            <input type="date" value={tglPenawaran} onChange={(e) => setTglPenawaran(e.target.value)} data-testid="penawaran-tanggal"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>TEMPLATE TAMPILAN</label>
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} data-testid="penawaran-template"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12, background: "#fff" }}>
              {PENAWARAN_TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>

            {/* ── ASURANSI untuk mode DRAFT: rate + keterangan (premi tampil per rute, tanpa total & pajak) ── */}
            {mode === "draft" && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 12, marginBottom: 12, background: "#fafbfc" }} data-testid="penawaran-draft-asuransi">
              <div style={{ fontSize: 11, fontWeight: 800, color: navy, marginBottom: 8, letterSpacing: 0.3 }}>ASURANSI (opsional)</div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>Asuransi — Rate (sama untuk semua baris)</label>
              <div style={{ marginBottom: 6, maxWidth: 260 }}>
                <select value={String(insRate)} onChange={(e) => setInsRate(e.target.value)} data-testid="penawaran-ins-rate"
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 8px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, background: "#fff" }}>
                  {INS_RATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 10.5, color: gray }}>Asuransi diisi <b>per metode</b>: buka <b>▾ Opsi</b> pada rute, lalu isi nilai pertanggungan di tiap metode (kosong = tanpa asuransi). Di penawaran opsi, premi tampil sebagai kolom <b>Premi Asuransi</b> per metode — tanpa total & pajak. Rute tanpa opsi: isi nilai pertanggungan langsung di rute.</div>
            </div>
            )}

            {/* ── RINCIAN BIAYA & PAJAK — hanya mode FINAL (draft = opsi, tanpa total) ── */}
            {mode === "final" && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 12, marginBottom: 12, background: "#fafbfc" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: navy, marginBottom: 8, letterSpacing: 0.3 }}>RINCIAN BIAYA & PAJAK (opsional)</div>

              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>Asuransi — Rate (sama untuk semua baris)</label>
              <div style={{ marginBottom: 6, maxWidth: 260 }}>
                <select value={String(insRate)} onChange={(e) => setInsRate(e.target.value)} data-testid="penawaran-ins-rate"
                  style={{ width: "100%", boxSizing: "border-box", padding: "9px 8px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, background: "#fff" }}>
                  {INS_RATE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 10.5, color: gray, marginBottom: 10 }}>Nilai pertanggungan diisi <b>per unit</b> di daftar rute di atas (kolom 🛡️ Asuransi). Premi tiap baris = nilai × rate × jumlah unit, total premi = jumlah semua baris yang dicentang{pvPremi > 0 ? ` = ${fRp(pvPremi)} (nilai total ${fRp(pvInsBase)})` : ""}. Baris tanpa nilai = tanpa asuransi. Asuransi TIDAK kena pajak.</div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#111827", marginBottom: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={withPpn} onChange={(e) => setWithPpn(e.target.checked)} style={{ width: 16, height: 16 }} data-testid="penawaran-ppn" />
                Kenakan PPN 1,1%
              </label>
              {withPpn && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#374151", margin: "0 0 6px 24px", cursor: "pointer" }}>
                  <input type="checkbox" checked={taxIncl} onChange={(e) => setTaxIncl(e.target.checked)} style={{ width: 15, height: 15 }} data-testid="penawaran-taxincl" />
                  Harga sudah termasuk pajak 1,1% (dipecah dari dalam)
                </label>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "#111827", marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={withPph} onChange={(e) => setWithPph(e.target.checked)} style={{ width: 16, height: 16 }} data-testid="penawaran-pph" />
                Potong PPh 23 (2%)
              </label>

              {anyBreakdown && (
                <div style={{ borderTop: `1px dashed ${border}`, paddingTop: 8, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: gray }}><span>{withPpn && taxIncl ? "DPP" : "Subtotal Pengiriman"}</span><span>{fRp(withPpn && taxIncl ? pvDpp : pvSub)}</span></div>
                  {withPpn && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: gray }}><span>PPN 1,1%{taxIncl ? " (termasuk)" : ""}</span><span>{fRp(pvPpn)}</span></div>}
                  {pvPph > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: "#b45309" }}><span>Potong PPh 23 (2%)</span><span>- {fRp(pvPph)}</span></div>}
                  {pvPremi > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", color: gray }}><span>Premi Asuransi</span><span>{fRp(pvPremi)}</span></div>}
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 0", fontWeight: 900, color: navy, fontSize: 13, borderTop: `1px solid ${border}`, marginTop: 4 }}><span>GRAND TOTAL</span><span>{fRp(pvGrand)}</span></div>
                </div>
              )}
            </div>
            )}

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>CATATAN (tampil di penawaran)</label>
            <textarea value={catatanUmum} onChange={(e) => setCatatanUmum(e.target.value)} rows={3} data-testid="penawaran-catatan"
              placeholder="mis. Harga Door to Door, sudah termasuk BBM & tol, belum termasuk asuransi, dll"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12, resize: "vertical", fontFamily: "inherit" }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>NAMA PENANDA TANGAN</label>
            <input value={ttdNama} onChange={(e) => setTtdNama(e.target.value)} placeholder="mis. Alyssa Herman"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>JABATAN</label>
            <input value={ttdJabatan} onChange={(e) => setTtdJabatan(e.target.value)} placeholder="mis. Direktur Utama"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>STEMPEL DIGITAL (opsional)</label>
            <input type="file" accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setStempel(r.result);
                r.readAsDataURL(f);
              }}
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, marginBottom: stempel ? 8 : 16 }} />
            {stempel && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <img src={stempel} alt="stempel" style={{ height: 48, maxWidth: 120, objectFit: "contain", border: `1px solid ${border}`, borderRadius: 6, padding: 3 }} />
                <button onClick={() => setStempel("")} style={{ fontSize: 11, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>Hapus</button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${border}`, background: "#fff", color: gray, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Batal</button>
              <button disabled={gambarBusy} onClick={async () => {
                const sel = list.map((e, i) => ({ e, i })).filter(({ i }) => selIdx.has(i)).map(({ e, i }) => {
                  const options = optOf(i)
                    .map((k) => ({ metode: (k.metode || "Lainnya"), harga: pNum(k.harga), catatan: (k.catatan || "").trim(), ins: Number(onlyDigits(k.ins)) || 0 }))
                    .filter((k) => k.harga > 0 || k.metode);
                  return { ...e, options, selected: options.length ? selOf(i) : -1, insNilai: rowIns(i), qty: qtyOf(i, e) };
                });
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                setGambarBusy(true);
                try {
                  const r = await simpanPenawaranGambar(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel, tanggal: tglPenawaran, insRate, withPpn, taxIncl, withPph, mode, catatan: catatanUmum, template: tpl });
                  if (r !== "batal") setOpen(false);
                } catch (e) { alert("Gagal membuat gambar. Coba lagi."); }
                setGambarBusy(false);
              }}
                title="Simpan penawaran sebagai gambar PNG tajam untuk dikirim lewat WhatsApp"
                data-testid="penawaran-simpan-gambar"
                style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", fontSize: 12.5, fontWeight: 800, cursor: gambarBusy ? "default" : "pointer", opacity: gambarBusy ? 0.6 : 1 }}>{gambarBusy ? "Membuat gambar…" : "🖼️ Simpan sebagai Gambar (WhatsApp)"}</button>
              <button onClick={() => {
                const sel = list.map((e, i) => ({ e, i })).filter(({ i }) => selIdx.has(i)).map(({ e, i }) => {
                  const options = optOf(i)
                    .map((k) => ({ metode: (k.metode || "Lainnya"), harga: pNum(k.harga), catatan: (k.catatan || "").trim(), ins: Number(onlyDigits(k.ins)) || 0 }))
                    .filter((k) => k.harga > 0 || k.metode);
                  return { ...e, options, selected: options.length ? selOf(i) : -1, insNilai: rowIns(i), qty: qtyOf(i, e) };
                });
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                previewPenawaran(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel, tanggal: tglPenawaran, insRate, withPpn, taxIncl, withPph, mode, catatan: catatanUmum, template: tpl });
              }}
                data-testid="penawaran-preview"
                style={{ padding: "9px 14px", borderRadius: 8, border: `1px solid ${navy}`, background: "#eff6ff", color: navy, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>👁️ Preview</button>
              <button onClick={() => {
                const sel = list.map((e, i) => ({ e, i })).filter(({ i }) => selIdx.has(i)).map(({ e, i }) => {
                  const options = optOf(i)
                    .map((k) => ({ metode: (k.metode || "Lainnya"), harga: pNum(k.harga), catatan: (k.catatan || "").trim(), ins: Number(onlyDigits(k.ins)) || 0 }))
                    .filter((k) => k.harga > 0 || k.metode);
                  // options = ALTERNATIF (tidak dijumlah). `selected` = index opsi terpilih (mode final).
                  return { ...e, options, selected: options.length ? selOf(i) : -1, insNilai: rowIns(i), qty: qtyOf(i, e) };
                });
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                printPenawaran(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel, tanggal: tglPenawaran, insRate, withPpn, taxIncl, withPph, mode, catatan: catatanUmum, template: tpl });
                setOpen(false);
              }}
                style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: gold, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>🖨️ {mode === "draft" ? "Cetak Opsi Harga" : "Cetak Resmi"} ({selIdx.size})</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
