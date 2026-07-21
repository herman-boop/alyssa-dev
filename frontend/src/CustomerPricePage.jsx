/* eslint-disable */
import { useState, useEffect } from "react";
import axios from "axios";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";

function fRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

// Cetak PENAWARAN HARGA versi A4 formal (gaya template invoice — huruf lebih
// besar biar tajam di-screenshot, ada ruang stempel + nama + jabatan).
function printPenawaran(rows, meta) {
  const { nama_pt, ttdNama, ttdJabatan, stempel } = meta || {};
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtTgl = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "-");
  const now = new Date();
  const noDoc = `PH/AAL/${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(2)}/${now.getFullYear()}`;
  const body = (rows || []).map((e, i) => {
    const sudah = e.asuransi && e.asuransi > 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${fmtTgl(e.tanggal)}</td>
      <td><b>${esc(e.rute || "-")}</b>${e.catatan ? `<div class="ph-note">${esc(e.catatan)}</div>` : ""}</td>
      <td>${esc(e.moda || "-")}</td>
      <td>${esc(e.tipe_kendaraan || "-")}</td>
      <td class="r"><b>${fRp(e.harga_deal)}</b></td>
      <td class="c"><span class="ph-ins ${sudah ? "y" : "n"}">${sudah ? "Termasuk" : "Belum"}</span></td>
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
    table.ph { width:100%; border-collapse:collapse; margin-bottom:16px; }
    table.ph thead { display:table-header-group; }
    table.ph tr { break-inside:avoid; page-break-inside:avoid; }
    table.ph th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; color:#fff; background:${DOC_BRAND.navy}; font-weight:700; padding:9px 9px; }
    table.ph th.r { text-align:right; } table.ph th.c { text-align:center; }
    table.ph td { padding:11px 9px; font-size:12.5px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.ph tbody tr:nth-child(even) td { background:${DOC_BRAND.paperMist}; }
    table.ph td.c { text-align:center; } table.ph td.r { text-align:right; }
    table.ph .ph-note { font-size:10.5px; color:${DOC_BRAND.muted}; font-style:italic; margin-top:3px; font-weight:400; }
    .ph-ins { display:inline-block; font-size:10px; font-weight:800; border-radius:12px; padding:3px 9px; white-space:nowrap; }
    .ph-ins.y { background:#d1fae5; color:#065f46; } .ph-ins.n { background:#fef2f2; color:#991b1b; }
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
    @page { size:A4; margin:12mm; }
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
        <tr><td>Tanggal</td><td>${fmtTgl(now.toISOString())}</td></tr>
        <tr><td>Berlaku</td><td>7 hari sejak tanggal</td></tr>
      </table>
    </div>
    <table class="ph">
      <thead><tr>
        <th class="c" style="width:26px">No</th><th style="width:92px">Tanggal</th><th>Rute</th>
        <th>Moda</th><th>Tipe Kendaraan</th><th class="r">Harga</th><th class="c">Asuransi</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
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
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
}

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";
const gold = "#b8860b";

export default function CustomerPricePage() {
  const token = window.location.pathname.replace(/^\/harga\//, "").split("?")[0].trim();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCetak, setShowCetak] = useState(false);
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("");
  const [stempel, setStempel] = useState("");

  useEffect(() => {
    if (!token) { setError("Link tidak valid"); setLoading(false); return; }
    const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
    axios.get(`${BACKEND}/api/pelanggan/${token}`)
      .then((res) => { setData(res.data); setLoading(false); })
      .catch((e) => {
        setError(e.response?.data?.detail || "Link tidak valid atau sudah kadaluarsa");
        setLoading(false);
      });
  }, [token]);

  if (loading) {
    return (
      <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif", color: gray, fontSize: 14 }}>
        Memuat data...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: "#f3f4f6", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif", color: "#dc2626", fontSize: 14 }}>
        {error || "Data tidak ditemukan"}
      </div>
    );
  }

  const history = data.harga_history || [];
  const todayFmt = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  const exportExcel = () => {
    const tglExport = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const bodyRows = history.map(e => `
      <tr>
        <td>${e.tanggal ? esc(new Date(e.tanggal).toLocaleDateString("id-ID")) : "-"}</td>
        <td>${esc(e.rute || "-")}</td>
        <td>${esc(e.moda || "-")}</td>
        <td>${esc(e.tipe_kendaraan || "-")}</td>
        <td style="mso-number-format:'\\#\\,\\#\\#0';text-align:right">${e.harga_deal || 0}</td>
        <td>${e.asuransi && e.asuransi > 0 ? "Sudah termasuk" : "Belum termasuk"}</td>
        <td>${esc(e.catatan || "")}</td>
      </tr>`).join("");
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="utf-8"></head>
      <body>
      <table border="1">
        <tr><td colspan="7" style="font-weight:bold;font-size:14px">Penawaran Harga — ${esc(data.nama_pt)}</td></tr>
        <tr><td colspan="4" style="font-weight:bold">PT ALYSSA AUTO LOGISTIK</td><td colspan="3">Diterbitkan: ${esc(tglExport)}</td></tr>
        <tr></tr>
        <tr style="background:#EF9F27;color:#fff;font-weight:bold">
          <td>Tanggal</td><td>Rute</td><td>Moda Pengiriman</td><td>Tipe Kendaraan</td><td>Harga</td><td>Asuransi</td><td>Catatan</td>
        </tr>
        ${bodyRows}
        <tr></tr>
        <tr><td colspan="7">* Harga berlaku 7 hari sejak tanggal penawaran. Hubungi: 0818 631 135</td></tr>
      </table>
      </body></html>`;
    const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Penawaran_${data.nama_pt.replace(/\s+/g,"_")}_${tglExport.replace(/\s/g,"")}.xls`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 720, background: "#fff", borderRadius: 14, padding: 32, color: "#1f2937" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${navy}`, paddingBottom: 16, marginBottom: 6, flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <img src="/logo.png" alt="Logo" width={52} height={52} style={{ objectFit: "contain" }} />
            <div>
              <div style={{ fontSize: 19, fontWeight: 900, color: gold, letterSpacing: 0.6 }}>PT ALYSSA AUTO LOGISTIK</div>
              <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>Solusi Transportasi &amp; Logistik Kendaraan</div>
              <div style={{ display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 800, color: navy, background: "#eff6ff", borderRadius: 4, padding: "3px 10px", letterSpacing: 0.4 }}>PENAWARAN HARGA</div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: gray }}>📅 Tanggal</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{todayFmt}</div>
            <div style={{ color: gray }}>🏢 Untuk</div>
            <div style={{ fontWeight: 700 }}>{data.nama_pt}</div>
          </div>
        </div>

        {history.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button onClick={() => setShowCetak(true)}
              style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${gold}`, background: "#fffbeb", color: "#92610b", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              🖨️ Cetak Penawaran Resmi (A4)
            </button>
            <button onClick={exportExcel}
              style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${navy}`, background: "#eff6ff", color: navy, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              📥 Download Excel
            </button>
          </div>
        )}

        {showCetak && (
          <div onClick={() => setShowCetak(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()}
              style={{ width: "100%", maxWidth: 440, background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
              <div style={{ fontSize: 16, fontWeight: 900, color: navy, marginBottom: 3 }}>Cetak Penawaran Resmi</div>
              <div style={{ fontSize: 11.5, color: gray, marginBottom: 16 }}>Isi penanda tangan &amp; stempel (opsional). Format A4, huruf besar — tajam buat di-screenshot / print.</div>

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
                <button onClick={() => setShowCetak(false)}
                  style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${border}`, background: "#fff", color: gray, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Batal</button>
                <button onClick={() => { printPenawaran(history, { nama_pt: data.nama_pt, ttdNama, ttdJabatan, stempel }); setShowCetak(false); }}
                  style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: gold, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>🖨️ Cetak A4</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 10px" }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: navy, color: "#fff", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>1</div>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, letterSpacing: 0.3 }}>DAFTAR HARGA</div>
        </div>

        {history.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: gray, fontSize: 13 }}>Belum ada data penawaran</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {["Tanggal", "Rute", "Moda", "Tipe Kendaraan", "Harga"].map((th) => (
                    <th key={th} style={{ textAlign: th === "Harga" ? "right" : "left", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>{th}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => {
                  const tgl = entry.tanggal
                    ? new Date(entry.tanggal).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
                    : "-";
                  const sudahAsuransi = entry.asuransi && entry.asuransi > 0;
                  return (
                    <tr key={i}>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, color: gray, fontSize: 11, verticalAlign: "top" }}>{tgl}</td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, fontWeight: 700, verticalAlign: "top" }}>
                        {entry.rute}
                        {entry.catatan && <div style={{ fontSize: 11, color: gray, marginTop: 3, fontStyle: "italic" }}>{entry.catatan}</div>}
                      </td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, color: navy, fontSize: 11, fontWeight: 700, verticalAlign: "top" }}>{entry.moda || "—"}</td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, color: gray, fontSize: 11, verticalAlign: "top" }}>{entry.tipe_kendaraan}</td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, textAlign: "right", verticalAlign: "top" }}>
                        <div style={{ fontWeight: 800, color: navy, fontSize: 13 }}>{fRp(entry.harga_deal)}</div>
                        <div style={{ display: "inline-block", marginTop: 4, fontSize: 10, fontWeight: 800, borderRadius: 12, padding: "2px 8px",
                          background: sudahAsuransi ? "#d1fae5" : "#fef2f2", color: sudahAsuransi ? "#065f46" : "#991b1b" }}>
                          {sudahAsuransi ? "✓ Termasuk Asuransi" : "⚠ Belum Termasuk Asuransi"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 10px" }}>
          <div style={{ width: 24, height: 24, borderRadius: 6, background: navy, color: "#fff", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>2</div>
          <div style={{ fontWeight: 800, fontSize: 13, color: navy, letterSpacing: 0.3 }}>INFORMASI PEMBAYARAN</div>
        </div>
        <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 16, background: "linear-gradient(135deg, #eff6ff 0%, #ffffff 100%)", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 10, background: "#0054a6", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 16, letterSpacing: 0.5, flexShrink: 0 }}>BCA</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: "#1f2937", letterSpacing: 1 }}>0072-8902-71</div>
            <div style={{ fontSize: 12, color: gray, marginTop: 3 }}>a.n. PT ALYSSA AUTO LOGISTIK</div>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#eff6ff", borderRadius: 8, padding: 12, fontSize: 11, color: "#374151", display: "flex", gap: 8 }}>
          <span>📋</span>
          <span>Harga berlaku 7 hari sejak tanggal penawaran. Hubungi kami untuk konfirmasi: <strong>0818 631 135</strong></span>
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: gray }}>Terima kasih atas kerja sama dan kepercayaannya.</div>
      </div>
    </div>
  );
}
