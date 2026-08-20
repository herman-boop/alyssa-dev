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

export async function printPenawaran(rows, meta) {
  const w = window.open("", "_blank"); // buka dulu (dalam gesture klik) biar nggak keblok popup
  const { nama_pt, ttdNama, ttdJabatan, stempel, tanggal, insVal, insRate, withPpn, taxIncl, withPph } = meta || {};
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtTgl = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "-");
  const now = new Date();
  // Tanggal penawaran: pakai input manual kalau ada (yyyy-mm-dd), fallback hari ini.
  const tglPakai = tanggal ? `${tanggal}T00:00:00` : now.toISOString();
  const noDoc = await nextDocNo("penawaran", "PH"); // nomor auto-increment
  // Subtotal pengiriman = jumlah seluruh Harga Satuan semua baris.
  const subtotal = (rows || []).reduce((s, e) => s + (e.harga_deal || 0), 0);
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
  const body = (rows || []).map((e, i) => {
    const satuan = e.harga_deal || 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(e.rute || "-")}</b>${e.catatan ? `<div class="ph-note">${esc(e.catatan)}</div>` : ""}</td>
      <td>${esc(e.moda || "-")}</td>
      <td>${esc(e.tipe_kendaraan || "-")}</td>
      <td class="r">${fRp(satuan)}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 12px; }
    .ph-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:16px; }
    .ph-billto .lbl { font-size:10px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .ph-billto .val { font-size:16px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-meta-table { border-collapse:collapse; font-size:11.5px; }
    .ph-meta-table td { padding:3px 0; }
    .ph-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .ph-meta-table td:last-child { font-weight:700; text-align:right; }
    table.ph { width:100%; border-collapse:collapse; margin-bottom:14px; }
    table.ph thead { display:table-header-group; }        /* header diulang tiap halaman */
    table.ph tfoot { display:table-row-group; }            /* baris TOTAL muncul sekali di akhir */
    table.ph tr { break-inside:avoid; page-break-inside:avoid; }  /* baris tidak pecah 2 halaman */
    table.ph th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.3px; color:#fff; background:${DOC_BRAND.navy}; font-weight:700; padding:5px 7px; white-space:nowrap; }
    table.ph th.r { text-align:right; } table.ph th.c { text-align:center; }
    table.ph td { padding:4px 7px; font-size:9px; line-height:1.35; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.ph tbody tr:nth-child(even) td { background:${DOC_BRAND.paperMist}; }
    table.ph td.c { text-align:center; } table.ph td.r { text-align:right; white-space:nowrap; }
    table.ph .ph-note { font-size:8px; color:${DOC_BRAND.muted}; font-style:italic; margin-top:2px; font-weight:400; }
    table.ph tfoot .ph-total td { border-top:2px solid ${DOC_BRAND.navy}; border-bottom:none; padding:7px 7px; font-size:10px; background:#fff; }
    table.ph tfoot .ph-total .lbl { text-align:right; font-weight:800; letter-spacing:.3px; color:${DOC_BRAND.ink}; }
    table.ph tfoot .ph-total .val { text-align:right; font-weight:800; white-space:nowrap; color:${DOC_BRAND.ink}; }
    .ph-breakdown { margin:0 0 14px auto; width:320px; max-width:64%; }
    .ph-breakdown .bd-row { display:flex; justify-content:space-between; gap:14px; font-size:11px; padding:5px 2px; border-bottom:1px solid ${DOC_BRAND.line}; }
    .ph-breakdown .bd-row span:first-child { color:${DOC_BRAND.muted}; }
    .ph-breakdown .bd-row span:last-child { font-weight:700; color:${DOC_BRAND.ink}; white-space:nowrap; }
    .ph-breakdown .bd-row.minus span:last-child { color:#b45309; }
    .ph-breakdown .bd-row.grand { border-top:2px solid ${DOC_BRAND.navy}; border-bottom:none; margin-top:2px; padding-top:7px; }
    .ph-breakdown .bd-row.grand span { font-size:13px; font-weight:900; color:${DOC_BRAND.ink}; }
    .ph-pay-box { display:flex; align-items:center; gap:14px; padding:14px 18px; background:${DOC_BRAND.paperMist}; border-radius:8px; margin-bottom:14px; }
    .ph-pay-badge { width:46px; height:46px; border-radius:8px; background:#0054a6; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; flex-shrink:0; }
    .ph-pay-num { font-size:17px; font-weight:900; letter-spacing:1px; color:${DOC_BRAND.ink}; }
    .ph-pay-name { font-size:11px; color:${DOC_BRAND.muted}; margin-top:2px; }
    .ph-valid { font-size:11px; color:${DOC_BRAND.muted}; line-height:1.7; margin-bottom:8px; }
    .ph-valid b { color:${DOC_BRAND.ink}; }
    .ph-sign-row { display:flex; justify-content:flex-end; margin-top:30px; }
    .ph-sign-cell { width:280px; text-align:center; }
    .ph-sign-lbl { font-size:11px; color:${DOC_BRAND.muted}; margin-bottom:6px; }
    .ph-sign-stamp { height:86px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
    .ph-sign-stamp img { max-height:86px; max-width:220px; object-fit:contain; }
    .ph-sign-stamp.empty { height:60px; }
    .ph-sign-pt { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-sign-name { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; margin-top:2px; }
    .ph-sign-jab { font-size:10.5px; color:${DOC_BRAND.muted}; margin-top:2px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    @page { size: A4 portrait; margin: 8mm; }
    @media print { @page { size: A4 portrait; margin: 8mm; } }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "PENAWARAN HARGA" })}
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
    <table class="ph">
      <thead><tr>
        <th class="c" style="width:24px">No</th><th>Rute</th>
        <th style="width:100px">Moda</th><th style="width:96px">Tipe Kendaraan</th><th class="r" style="width:132px">Harga Satuan</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot>
        <tr class="ph-total">
          <td class="lbl" colspan="4">${hasBreakdown ? "SUBTOTAL PENGIRIMAN" : "TOTAL"}</td>
          <td class="val">${fRp(subtotal)}</td>
        </tr>
      </tfoot>
    </table>
    ${hasBreakdown ? `<div class="ph-breakdown">
      <div class="bd-row"><span>${ppnOn && incl ? "DPP (Dasar Pengenaan Pajak)" : "Subtotal Pengiriman"}</span><span>${fRp(ppnOn && incl ? dpp : subtotal)}</span></div>
      ${ppnOn ? `<div class="bd-row"><span>PPN 1,1%${incl ? " (sudah termasuk)" : ""}</span><span>${fRp(ppn)}</span></div>` : ""}
      ${pph ? `<div class="bd-row minus"><span>Potongan PPh 23 (2%)</span><span>- ${fRp(pph)}</span></div>` : ""}
      ${premi ? `<div class="bd-row"><span>Premi Asuransi (${fRp(insBase)} &times; ${rate}%)</span><span>${fRp(premi)}</span></div>` : ""}
      <div class="bd-row grand"><span>GRAND TOTAL</span><span>${fRp(grandTotal)}</span></div>
    </div>` : ""}
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

  const list = rows || [];
  const openModal = () => { setSelIdx(new Set(list.map((_, i) => i))); setCari(""); setOpen(true); };
  const match = (e) => {
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return `${e.rute || ""} ${e.moda || ""} ${e.tipe_kendaraan || ""} ${e.catatan || ""}`.toLowerCase().includes(q);
  };

  // Live preview rincian (ikut baris yang dicentang).
  const onlyDigits = (s) => String(s || "").replace(/[^0-9]/g, "");
  const pvSub = list.filter((_, i) => selIdx.has(i)).reduce((s, e) => s + (e.harga_deal || 0), 0);
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
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", fontFamily: "'Segoe UI',Arial,sans-serif" }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: navy, marginBottom: 3 }}>Cetak Penawaran Resmi</div>
            <div style={{ fontSize: 11.5, color: gray, marginBottom: 16 }}>Centang rute yang mau dicetak (mis. pisahin yang Kalimantan), isi penanda tangan &amp; stempel. Format A4, huruf besar — tajam buat di-screenshot / print.</div>

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

            <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${border}`, borderRadius: 8, marginBottom: 16 }}>
              {list.map((e, i) => ({ e, i })).filter(({ e }) => match(e)).map(({ e, i }) => {
                const on = selIdx.has(i);
                return (
                  <label key={i}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: on ? "#f0fdf4" : "#fff" }}>
                    <input type="checkbox" checked={on}
                      onChange={() => setSelIdx((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                      style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.rute || "-"}</div>
                      <div style={{ fontSize: 10.5, color: gray }}>{e.tipe_kendaraan || "-"} · {fRp(e.harga_deal)}</div>
                    </div>
                  </label>
                );
              })}
              {list.length === 0 && <div style={{ padding: 14, textAlign: "center", color: gray, fontSize: 12 }}>Belum ada rute</div>}
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>TANGGAL PENAWARAN</label>
            <input type="date" value={tglPenawaran} onChange={(e) => setTglPenawaran(e.target.value)} data-testid="penawaran-tanggal"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            {/* ── RINCIAN BIAYA & PAJAK (opsional, kaya invoice) ── */}
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
                const sel = list.filter((_, i) => selIdx.has(i));
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                printPenawaran(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel, tanggal: tglPenawaran, insVal, insRate, withPpn, taxIncl, withPph });
                setOpen(false);
              }}
                style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: gold, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>🖨️ Cetak A4 ({selIdx.size})</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
