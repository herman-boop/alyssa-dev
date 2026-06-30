/* eslint-disable */
import { useState, useEffect } from "react";
import axios from "axios";

function fRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

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

  const bg = "#0d1117";
  const card = { background: "#161b22", border: "1px solid #21262d", borderRadius: 10, padding: 20, marginBottom: 16 };

  if (loading) {
    return (
      <div style={{ background: bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#8b949e", fontSize: 14 }}>
        Memuat data...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ background: bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: "#f85149", fontSize: 14 }}>
        {error || "Data tidak ditemukan"}
      </div>
    );
  }

  const history = data.harga_history || [];

  const exportExcel = () => {
    const tglExport = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const rows = [
      [`Penawaran Harga — ${data.nama_pt}`],
      [`PT ALYSSA AUTO LOGISTIK`, "", "", "", "", `Diterbitkan: ${tglExport}`],
      [],
      ["Tanggal", "Rute", "Moda Pengiriman", "Tipe Kendaraan", "Harga", "Asuransi", "Catatan"],
      ...history.map(e => [
        e.tanggal ? new Date(e.tanggal).toLocaleDateString("id-ID") : "-",
        e.rute || "-",
        e.moda || "-",
        e.tipe_kendaraan || "-",
        e.harga_deal || 0,
        e.asuransi && e.asuransi > 0 ? "Sudah termasuk" : "Belum termasuk",
        e.catatan || "",
      ]),
      [],
      ["* Harga berlaku 7 hari sejak tanggal penawaran. Hubungi: 0818 631 135"],
    ];
    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
    const BOM = "﻿";
    const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Penawaran_${data.nama_pt.replace(/\s+/g,"_")}_${tglExport.replace(/\s/g,"")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: bg, color: "#e6edf3", minHeight: "100vh", padding: 20 }}>
      {/* Header */}
      <div style={{ borderBottom: "2px solid #EF9F27", paddingBottom: 16, marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#EF9F27", letterSpacing: ".5px" }}>PT ALYSSA AUTO LOGISTIK</div>
          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>Solusi Transportasi &amp; Logistik Kendaraan</div>
        </div>
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#e6edf3" }}>Penawaran Harga</div>
          <div style={{ fontSize: 12, color: "#EF9F27", fontWeight: 600 }}>{data.nama_pt}</div>
          {history.length > 0 && (
            <button onClick={exportExcel}
              style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid #2ea043", background: "#0d2818", color: "#3fb950", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              📥 Download Excel
            </button>
          )}
        </div>
      </div>

      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#EF9F27", marginBottom: 14, textTransform: "uppercase", letterSpacing: ".5px" }}>
          Daftar Harga — {data.nama_pt}
        </div>

        {history.length === 0 ? (
          <div style={{ color: "#8b949e", fontSize: 13, padding: "20px 0", textAlign: "center" }}>Belum ada data penawaran</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#21262d" }}>
                  {["Tanggal", "Rute", "Moda", "Tipe Kendaraan", "Harga"].map((th) => (
                    <th key={th} style={{ padding: "8px 10px", textAlign: "left", color: "#8b949e", fontWeight: 600, border: "1px solid #30363d" }}>{th}</th>
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
                    <tr key={i} style={{ background: i % 2 === 1 ? "#0d1117" : "transparent" }}>
                      <td style={{ padding: "8px 10px", border: "1px solid #21262d", color: "#8b949e", fontSize: 11 }}>{tgl}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #21262d", fontWeight: 600 }}>
                        {entry.rute}
                        {entry.catatan && <div style={{ fontSize: 10, color: "#8b949e", marginTop: 3, fontStyle: "italic" }}>{entry.catatan}</div>}
                      </td>
                      <td style={{ padding: "8px 10px", border: "1px solid #21262d", color: "#58a6ff", fontSize: 11, fontWeight: 600 }}>{entry.moda || "—"}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #21262d", color: "#8b949e", fontSize: 11 }}>{entry.tipe_kendaraan}</td>
                      <td style={{ padding: "8px 10px", border: "1px solid #21262d", textAlign: "right" }}>
                        <div style={{ fontWeight: 800, color: "#EF9F27", fontSize: 13 }}>{fRp(entry.harga_deal)}</div>
                        <div style={{ fontSize: 10, marginTop: 3, color: sudahAsuransi ? "#3fb950" : "#f85149", fontWeight: 600 }}>
                          {sudahAsuransi ? "✓ Sudah termasuk asuransi" : "⚠ Belum termasuk asuransi"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16, padding: "10px 14px", background: "#0d1117", borderRadius: 8, border: "1px solid #30363d", fontSize: 11, color: "#8b949e", lineHeight: 1.6 }}>
          ⚠ Harga berlaku 7 hari sejak tanggal penawaran. Hubungi kami untuk konfirmasi: <strong style={{ color: "#e6edf3" }}>0818 631 135</strong>
        </div>
      </div>
    </div>
  );
}
