/* eslint-disable */
import { useState, useEffect } from "react";
import axios from "axios";

function fRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
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
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button onClick={exportExcel}
              style={{ padding: "8px 16px", borderRadius: 8, border: `1px solid ${navy}`, background: "#eff6ff", color: navy, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              📥 Download Excel
            </button>
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
