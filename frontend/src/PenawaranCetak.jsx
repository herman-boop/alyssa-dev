/* eslint-disable */
// Komponen bersama: tombol + modal "Cetak Penawaran Resmi (A4)".
// Dipakai di halaman customer (CustomerPricePage) DAN halaman admin Kalkulator
// (CostCalculator). Bisa centang rute (pisahin per wilayah, mis. Kalimantan),
// isi nama + jabatan + stempel. Output A4 gaya invoice, huruf besar.
import { useState } from "react";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter, nextDocNo } from "./docTheme";

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
function routeFinalMetode(e) {
  const sel = routeFinalOption(e);
  return sel ? (sel.metode || "-") : (e.moda || "-");
}

export async function printPenawaran(rows, meta) {
  const w = window.open("", "_blank"); // buka dulu (dalam gesture klik) biar nggak keblok popup
  const { nama_pt, ttdNama, ttdJabatan, stempel, tanggal, insVal, insRate, withPpn, taxIncl, withPph } = meta || {};
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
  const subtotal = isDraft ? 0 : (rows || []).reduce((s, e) => s + routeFinalHarga(e), 0);
  // ── Pajak (mirip invoice): PPN 1,1% + toggle "harga sudah termasuk" + potong PPh 23 2% ──
  const ppnOn = !!withPpn, incl = !!taxIncl, pphOn = !!withPph;
  const dpp = (ppnOn && incl) ? Math.round(subtotal / 1.011) : subtotal;
  const ppn = !ppnOn ? 0 : (incl ? subtotal - dpp : Math.round(subtotal * 0.011));
  const pph = pphOn ? Math.round(dpp * 0.02) : 0;
  const shipTotal = (incl ? subtotal : subtotal + ppn) - pph;
  // ── Asuransi (DI LUAR pajak): premi = nilai pertanggungan × rate% ──
  const insBase = Number(String(insVal ?? "").replace(/[^0-9]/g, "")) || 0;
  const rate = (insRate === 0 || insRate) ? Number(insRate) : 0.15;
  const premi = insBase > 0 ? Math.round(insBase * (rate / 100)) : 0;
  const grandTotal = shipTotal + premi;
  const hasBreakdown = ppnOn || pph > 0 || premi > 0;
  // Tiap rute = 1 <tbody> supaya 1 rute tidak pecah antar-halaman & tetap 1 item.
  const body = (rows || []).map((e, i) => {
    const opts = routeOptions(e);
    const catatanHtml = e.catatan ? `<div class="ph-note">${esc(e.catatan)}</div>` : "";
    // DRAFT + punya opsi → listing alternatif (○), TANPA Total Rute (customer pilih 1).
    if (isDraft && opts.length) {
      const main = `<tr class="ph-main">
        <td class="c">${i + 1}</td>
        <td><b>${esc(e.rute || "-")}</b>${catatanHtml}</td>
        <td>${opts.length > 1 ? "Opsi Pengiriman" : esc(opts[0].metode || "-")}</td>
        <td>${esc(e.tipe_kendaraan || "-")}</td>
        <td class="r ph-opt-hint">pilih salah satu</td>
      </tr>`;
      const subs = opts.map((o) => `<tr class="ph-sub">
        <td></td>
        <td colspan="3" class="ph-sub-k">○ ${esc(o.metode || "-")}${o.catatan ? ` <span class="ph-sub-note">(${esc(o.catatan)})</span>` : ""}</td>
        <td class="r ph-sub-v">${fRp(o.harga || 0)}</td>
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
      <td class="r">${fRp(harga)}</td>
    </tr>`;
    return `<tbody class="ph-route">${main}</tbody>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
  <style>
    ${DOC_BASE_CSS}
    /* Visual language disamain dgn Ringkasan Selisih Harga: navy divider, section
       gold-bar, table header mist+teks gelap, row rapat, summary navy box. */
    body { font-size: 11px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    .ph-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:14px; }
    .ph-billto .lbl { font-size:10px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .ph-billto .val { font-size:15px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-meta-table { border-collapse:collapse; font-size:11px; }
    .ph-meta-table td { padding:3px 0; }
    .ph-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .ph-meta-table td:last-child { font-weight:700; text-align:right; }
    .ph-sec { display:flex; align-items:center; gap:7px; margin:16px 0 6px; }
    .ph-sec .bar { width:3px; height:13px; background:${DOC_BRAND.gold}; border-radius:2px; }
    .ph-sec .txt { font-size:10.5px; font-weight:800; color:${DOC_BRAND.ink}; letter-spacing:.5px; text-transform:uppercase; }
    table.ph { width:100%; border-collapse:collapse; margin-bottom:2px; }
    table.ph thead { display:table-header-group; }        /* header diulang tiap halaman */
    table.ph tbody tr { break-inside:avoid; page-break-inside:avoid; }  /* baris tidak pecah 2 halaman */
    table.ph th { text-align:left; font-size:8px; text-transform:uppercase; letter-spacing:.3px; color:#334155; background:${DOC_BRAND.paperMist}; font-weight:700; padding:4px 7px; white-space:nowrap; border-bottom:1.5px solid #cbd5e1; }
    table.ph th.r { text-align:right; } table.ph th.c { text-align:center; }
    table.ph td { padding:3.5px 7px; font-size:9.5px; line-height:1.2; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.ph td.c { text-align:center; } table.ph td.r { text-align:right; white-space:nowrap; }
    table.ph .ph-note { font-size:8px; color:${DOC_BRAND.muted}; font-style:italic; margin-top:1px; font-weight:400; }
    /* 1 rute = 1 tbody: main row + sub-row komponen; jangan pecah antar halaman. */
    table.ph tbody.ph-route { break-inside:avoid; page-break-inside:avoid; }
    table.ph tr.ph-main td { border-bottom:none; }
    table.ph tr.ph-sub td { border-bottom:none; padding-top:1px; padding-bottom:1px; }
    table.ph .ph-sub-k { padding-left:20px !important; font-size:8.5px; color:${DOC_BRAND.muted}; }
    table.ph .ph-sub-note { font-style:italic; }
    table.ph .ph-sub-v { font-size:8.5px; color:${DOC_BRAND.muted}; white-space:nowrap; }
    table.ph tr.ph-subtotal td { border-bottom:1px solid ${DOC_BRAND.line}; padding-top:2px; padding-bottom:4px; }
    table.ph .ph-subtotal-k { text-align:right; font-size:8.5px; font-weight:700; color:${DOC_BRAND.ink}; letter-spacing:.2px; text-transform:uppercase; }
    table.ph .ph-subtotal-v { font-weight:800; font-size:9.5px; color:${DOC_BRAND.ink}; white-space:nowrap; }
    table.ph .ph-opt-hint { font-size:8px; font-style:italic; color:${DOC_BRAND.muted}; font-weight:400; }
    .ph-draft-note { font-size:9.5px; color:${DOC_BRAND.muted}; line-height:1.6; background:${DOC_BRAND.paperMist}; border:1px solid ${DOC_BRAND.line}; border-left:3px solid ${DOC_BRAND.gold}; border-radius:6px; padding:8px 12px; margin:8px 0 2px; }
    .ph-draft-note b { color:${DOC_BRAND.ink}; }
    .ph-bar { display:flex; justify-content:space-between; align-items:center; border-top:2px solid ${DOC_BRAND.navy}; padding:6px 4px 0; margin-top:2px; }
    .ph-bar .lbl { font-weight:900; font-size:10.5px; color:${DOC_BRAND.navy}; text-transform:uppercase; letter-spacing:.3px; }
    .ph-bar .val { font-weight:900; font-size:11.5px; color:${DOC_BRAND.ink}; }
    .ph-sum { width:62%; max-width:340px; margin:8px 0 0 auto; break-inside:avoid; page-break-inside:avoid; }
    .ph-sum .row { display:flex; justify-content:space-between; padding:4px 2px; font-size:10px; border-bottom:1px solid ${DOC_BRAND.line}; }
    .ph-sum .row .k { color:#333; text-transform:uppercase; letter-spacing:.3px; font-weight:600; font-size:9px; }
    .ph-sum .row .v { font-weight:700; color:${DOC_BRAND.ink}; white-space:nowrap; }
    .ph-sum .row.minus .v { color:#b45309; }
    .ph-grand { margin-top:7px; background:${DOC_BRAND.navy}; border-radius:8px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center; }
    .ph-grand .k { font-size:9px; font-weight:700; letter-spacing:.6px; color:#e8c98a; text-transform:uppercase; }
    .ph-grand .v { font-size:17px; font-weight:900; color:#fff; white-space:nowrap; }
    .ph-pay-box { display:flex; align-items:center; gap:14px; padding:12px 16px; background:${DOC_BRAND.paperMist}; border:1px solid ${DOC_BRAND.line}; border-radius:8px; margin:14px 0; break-inside:avoid; }
    .ph-pay-badge { width:44px; height:44px; border-radius:8px; background:${DOC_BRAND.navy}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:12px; flex-shrink:0; }
    .ph-pay-num { font-size:16px; font-weight:900; letter-spacing:1px; color:${DOC_BRAND.ink}; }
    .ph-pay-name { font-size:10.5px; color:${DOC_BRAND.muted}; margin-top:2px; }
    .ph-valid { font-size:9.5px; color:${DOC_BRAND.muted}; line-height:1.6; margin-bottom:8px; }
    .ph-valid b { color:${DOC_BRAND.ink}; }
    .ph-sign-row { display:flex; justify-content:flex-end; margin-top:26px; break-inside:avoid; page-break-inside:avoid; }
    .ph-sign-cell { width:280px; text-align:center; }
    .ph-sign-lbl { font-size:11px; color:${DOC_BRAND.muted}; margin-bottom:6px; }
    .ph-sign-stamp { height:86px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
    .ph-sign-stamp img { max-height:86px; max-width:220px; object-fit:contain; }
    .ph-sign-stamp.empty { height:60px; }
    .ph-sign-pt { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-sign-name { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; margin-top:2px; }
    .ph-sign-jab { font-size:10.5px; color:${DOC_BRAND.muted}; margin-top:2px; }
    @page { size: A4 portrait; margin: 8mm; }
    @media print { @page { size: A4 portrait; margin: 8mm; } thead{display:table-header-group;} tbody tr{break-inside:avoid;} .avoid-break{break-inside:avoid;page-break-inside:avoid;} }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: isDraft ? "PENAWARAN HARGA (OPSI)" : "PENAWARAN HARGA" })}
    <div class="ph-meta-row">
      <div class="ph-billto">
        <div class="lbl">Kepada Yth.</div>
        <div class="val">${esc(nama_pt || "&nbsp;")}</div>
      </div>
      <table class="ph-meta-table">
        <tr><td>No. Penawaran</td><td>${noDoc}</td></tr>
        <tr><td>Tanggal</td><td>${fmtTgl(tglPakai)}</td></tr>
        <tr><td>Berlaku</td><td>7 hari sejak tanggal</td></tr>
      </table>
    </div>
    <div class="ph-sec"><span class="bar"></span><span class="txt">${isDraft ? "Opsi Harga — Pilih Salah Satu Metode" : "Rincian Penawaran"}</span></div>
    <table class="ph">
      <thead><tr>
        <th class="c" style="width:24px">No</th><th>Rute</th>
        <th style="width:100px">Metode</th><th style="width:96px">Tipe Kendaraan</th><th class="r" style="width:132px">Harga</th>
      </tr></thead>
      ${body}
    </table>
    ${isDraft ? `
    <div class="ph-draft-note">Ini penawaran <b>opsi harga</b>. Setiap rute menampilkan beberapa alternatif metode — silakan pilih <b>salah satu</b> per rute. Total &amp; pajak dihitung pada penawaran resmi setelah metode dipilih.</div>
    ` : `
    <div class="ph-bar"><span class="lbl">${hasBreakdown ? "Subtotal Pengiriman" : "Total"}</span><span class="val">${fRp(subtotal)}</span></div>
    ${hasBreakdown ? `
    <div class="ph-sec"><span class="bar"></span><span class="txt">Ringkasan Biaya</span></div>
    <div class="ph-sum">
      <div class="row"><span class="k">${ppnOn && incl ? "DPP (Dasar Pengenaan Pajak)" : "Subtotal Pengiriman"}</span><span class="v">${fRp(ppnOn && incl ? dpp : subtotal)}</span></div>
      ${ppnOn ? `<div class="row"><span class="k">PPN 1,1%${incl ? " (sudah termasuk)" : ""}</span><span class="v">${fRp(ppn)}</span></div>` : ""}
      ${pph ? `<div class="row minus"><span class="k">Potongan PPh 23 (2%)</span><span class="v">- ${fRp(pph)}</span></div>` : ""}
      ${premi ? `<div class="row"><span class="k">Premi Asuransi (${fRp(insBase)} &times; ${rate}%)</span><span class="v">${fRp(premi)}</span></div>` : ""}
      <div class="ph-grand"><span class="k">Grand Total</span><span class="v">${fRp(grandTotal)}</span></div>
    </div>` : ""}
    `}
    <div class="ph-pay-box">
      <div class="ph-pay-badge">${DOC_BRAND.bank.name}</div>
      <div>
        <div class="ph-pay-num">${DOC_BRAND.bank.norek}</div>
        <div class="ph-pay-name">Cabang ${DOC_BRAND.bank.cabang} &middot; a.n. ${DOC_BRAND.bank.an}</div>
      </div>
    </div>
    <div class="ph-valid">
      <b>Catatan:</b> Harga di atas berlaku 7 (tujuh) hari sejak tanggal penawaran &amp; dapat berubah sewaktu-waktu mengikuti kondisi operasional. Untuk konfirmasi hubungi <b>0818 631 135</b>.
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
    ${docFooter({ docNo: `Penawaran ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  if (w) { w.document.write(html); w.document.close(); }
}

// Tombol + modal. `rows` = daftar entri harga (rute, moda, tipe_kendaraan,
// harga_deal, asuransi, catatan, tanggal). `namaPt` = nama pelanggan.
export function PenawaranCetakButton({ rows, namaPt, style }) {
  const [open, setOpen] = useState(false);
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("");
  const [stempel, setStempel] = useState("");
  const [tglPenawaran, setTglPenawaran] = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10); // hari ini (lokal), yyyy-mm-dd
  });
  const [selIdx, setSelIdx] = useState(() => new Set());
  const [cari, setCari] = useState("");
  // Rincian biaya & pajak (opsional) — mirip invoice
  const [insVal, setInsVal] = useState("");        // nilai pertanggungan asuransi (angka)
  const [insRate, setInsRate] = useState("0.15");  // rate asuransi (%)
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
  const routeFinal = (i, e) => { const o = optOf(i); if (!o.length) return e.harga_deal || 0; return pNum(o[selOf(i)].harga); };
  const addOpt = (i, seed) => setOptMap((m) => ({ ...m, [i]: [...(m[i] || []), seed || { metode: "Self Drive", harga: "", catatan: "" }] }));
  const setOpt = (i, ki, patch) => setOptMap((m) => ({ ...m, [i]: (m[i] || []).map((x, idx) => (idx === ki ? { ...x, ...patch } : x)) }));
  const delOpt = (i, ki) => setOptMap((m) => ({ ...m, [i]: (m[i] || []).filter((_, idx) => idx !== ki) }));
  const tarikOpt = (i, e) => { if (optOf(i).length) return; addOpt(i, { metode: e.moda || "Lainnya", harga: String(e.harga_deal || ""), catatan: "" }); setExpanded((s) => new Set(s).add(i)); };
  const toggleExpand = (i) => setExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const list = rows || [];
  const openModal = () => { setSelIdx(new Set(list.map((_, i) => i))); setCari(""); setOptMap({}); setSelMap({}); setExpanded(new Set()); setOpen(true); };
  const match = (e) => {
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return `${e.rute || ""} ${e.moda || ""} ${e.tipe_kendaraan || ""} ${e.catatan || ""}`.toLowerCase().includes(q);
  };

  // Live preview rincian (ikut baris yang dicentang).
  const onlyDigits = (s) => String(s || "").replace(/[^0-9]/g, "");
  // Subtotal preview hanya di mode FINAL (draft = opsi, tidak dijumlah).
  const pvSub = mode === "draft" ? 0 : list.reduce((s, e, i) => (selIdx.has(i) ? s + routeFinal(i, e) : s), 0);
  const pvDpp = (withPpn && taxIncl) ? Math.round(pvSub / 1.011) : pvSub;
  const pvPpn = !withPpn ? 0 : (taxIncl ? pvSub - pvDpp : Math.round(pvSub * 0.011));
  const pvPph = withPph ? Math.round(pvDpp * 0.02) : 0;
  const pvShip = (taxIncl ? pvSub : pvSub + pvPpn) - pvPph;
  const pvInsBase = Number(onlyDigits(insVal)) || 0;
  const pvRate = insRate === "" ? 0 : Number(insRate);
  const pvPremi = pvInsBase > 0 ? Math.round(pvInsBase * (pvRate / 100)) : 0;
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
                              <select value={k.metode} onChange={(ev) => setOpt(i, ki, { metode: ev.target.value })} data-testid={`pnw-opt-metode-${i}-${ki}`}
                                style={{ flex: "1 1 110px", minWidth: 0, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12 }}>
                                {METODE_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                              <input inputMode="numeric" value={k.harga ? Number(pNum(k.harga)).toLocaleString("id-ID") : ""} onChange={(ev) => setOpt(i, ki, { harga: ev.target.value.replace(/[^0-9]/g, "") })} placeholder="Harga" data-testid={`pnw-opt-harga-${i}-${ki}`}
                                style={{ flex: "1 1 90px", minWidth: 0, padding: "6px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 12, textAlign: "right" }} />
                              <button onClick={() => delOpt(i, ki)} title="Hapus opsi"
                                style={{ flexShrink: 0, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "5px 8px", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>✕</button>
                            </div>
                            <input value={k.catatan || ""} onChange={(ev) => setOpt(i, ki, { catatan: ev.target.value })} placeholder="Catatan (opsional)"
                              style={{ width: "100%", boxSizing: "border-box", marginTop: 4, padding: "5px 8px", borderRadius: 7, border: `1px solid ${border}`, fontSize: 11 }} />
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

            {/* ── RINCIAN BIAYA & PAJAK — hanya mode FINAL (draft = opsi, tanpa total) ── */}
            {mode === "final" && (
            <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 12, marginBottom: 12, background: "#fafbfc" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: navy, marginBottom: 8, letterSpacing: 0.3 }}>RINCIAN BIAYA & PAJAK (opsional)</div>

              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>Asuransi — Nilai Pertanggungan × Rate</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input inputMode="numeric" value={insVal ? Number(onlyDigits(insVal)).toLocaleString("id-ID") : ""} onChange={(e) => setInsVal(onlyDigits(e.target.value))} placeholder="mis. 300.000.000" data-testid="penawaran-ins-val"
                  style={{ flex: 2, boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, minWidth: 0 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 90 }}>
                  <input inputMode="decimal" value={insRate} onChange={(e) => setInsRate(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="penawaran-ins-rate"
                    style={{ width: "100%", boxSizing: "border-box", padding: "9px 8px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, textAlign: "right" }} />
                  <span style={{ fontSize: 12, color: gray, fontWeight: 700 }}>%</span>
                </div>
              </div>
              <div style={{ fontSize: 10.5, color: gray, marginBottom: 10 }}>Premi = Nilai × rate{pvPremi > 0 ? ` = ${fRp(pvPremi)}` : ""}. Kosongkan Nilai = tanpa asuransi. Asuransi TIDAK kena pajak.</div>

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
              <button onClick={() => {
                const sel = list.map((e, i) => ({ e, i })).filter(({ i }) => selIdx.has(i)).map(({ e, i }) => {
                  const options = optOf(i)
                    .map((k) => ({ metode: (k.metode || "Lainnya"), harga: pNum(k.harga), catatan: (k.catatan || "").trim() }))
                    .filter((k) => k.harga > 0 || k.metode);
                  // options = ALTERNATIF (tidak dijumlah). `selected` = index opsi terpilih (mode final).
                  return { ...e, options, selected: options.length ? selOf(i) : -1 };
                });
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                printPenawaran(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel, tanggal: tglPenawaran, insVal, insRate, withPpn, taxIncl, withPph, mode });
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
