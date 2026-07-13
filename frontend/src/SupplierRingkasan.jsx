import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

function fRp(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}
function fDate(s) {
  if (!s) return "—";
  const datePart = String(s).slice(0, 10);
  const [y, m, d] = datePart.split("-");
  if (!y || !m || !d) return datePart;
  return `${d}/${m}/${y}`;
}

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";

function SectionHeader({ num, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 10px" }}>
      <div style={{ width: 24, height: 24, borderRadius: 6, background: navy, color: "#fff", fontWeight: 800, fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>{num}</div>
      <div style={{ fontWeight: 800, fontSize: 13, color: navy, letterSpacing: 0.3 }}>{title}</div>
    </div>
  );
}

export default function SupplierRingkasan() {
  const params = useMemo(() => {
    const parts = window.location.pathname.split("/").filter(Boolean); // ["supplier-ringkasan", id]
    const id = parts[1] || "";
    const sp = new URLSearchParams(window.location.search);
    return { id, pin: sp.get("pin") || "" };
  }, []);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/admin/suppliers/${params.id}/ringkasan`, { params: { pin: params.pin } });
        setData(r.data);
      } catch (e) {
        setError(e?.response?.data?.detail || "Gagal memuat data ringkasan");
      }
    })();
  }, [params]);

  if (error) return <div style={{ padding: 40, color: "#dc2626", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "sans-serif", color: "#6b7280" }}>Memuat...</div>;

  const jobs = data.jobs || [];
  const payments = [];
  jobs.forEach((job) => {
    (job.payments || []).forEach((p) => {
      payments.push({ ...p, jobLabel: [job.vehicle_type, job.nopol].filter(Boolean).join(" ") });
    });
  });
  payments.sort((a, b) => String(a.tanggal || "").localeCompare(String(b.tanggal || "")));

  const totalTagihan = data.grand_total_harga || 0;
  const totalBayar = data.grand_total_terbayar || 0;
  const sisa = data.grand_sisa || 0;
  const todayFmt = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div data-testid="ringkasan-ready" style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div data-testid="ringkasan-card" style={{ width: 600, background: "#fff", borderRadius: 14, padding: 32, color: "#1f2937" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${navy}`, paddingBottom: 16, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: navy, letterSpacing: 0.4 }}>RINGKASAN PEMBAYARAN</div>
            <div style={{ fontSize: 12, color: gray, marginTop: 4 }}>Rekapitulasi Pembelian &amp; Transfer — {data.nama}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: gray }}>📅 Tanggal</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{todayFmt}</div>
            <div style={{ color: gray }}>👤 Disusun Oleh</div>
            <div style={{ fontWeight: 700 }}>Admin Keuangan</div>
          </div>
        </div>

        {/* Section 1: Rincian Pembelian */}
        <SectionHeader num="1" title="RINCIAN PEMBELIAN" />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>URAIAN</th>
              <th style={{ textAlign: "right", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>JUMLAH (IDR)</th>
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr><td colSpan={2} style={{ padding: 14, textAlign: "center", color: gray }}>Belum ada unit.</td></tr>
            )}
            {jobs.map((job) => (
              <tr key={job.id}>
                <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, verticalAlign: "top" }}>
                  <div style={{ display: "flex", gap: 10 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: "#dbeafe", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>🚗</div>
                    <div>
                      <div style={{ fontWeight: 700 }}>
                        {job.vehicle_type || "Unit"}{(job.asal_kota || job.tujuan_kota) && ` — ${job.asal_kota || "?"} → ${job.tujuan_kota || "?"}`}
                      </div>
                      <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>
                        {[job.nopol, job.no_rangka].filter(Boolean).join(" · ") || "—"}
                      </div>
                      {job.catatan && <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>{job.catatan}</div>}
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px", borderBottom: `1px solid ${border}`, textAlign: "right", fontWeight: 700, verticalAlign: "top" }}>{fRp(job.total_harga)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginTop: 8, fontWeight: 800, fontSize: 13, color: navy }}>
          <span>🧮 TOTAL RINCIAN PEMBELIAN</span>
          <span>{fRp(totalTagihan)}</span>
        </div>

        {/* Section 2: Riwayat Pembayaran */}
        <SectionHeader num="2" title="RIWAYAT PEMBAYARAN" />
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              <th style={{ textAlign: "left", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>NO</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>TANGGAL</th>
              <th style={{ textAlign: "left", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>KETERANGAN</th>
              <th style={{ textAlign: "right", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>NOMINAL (IDR)</th>
              <th style={{ textAlign: "center", padding: "8px 10px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr><td colSpan={5} style={{ padding: 14, textAlign: "center", color: gray }}>Belum ada pembayaran.</td></tr>
            )}
            {payments.map((p, i) => (
              <tr key={p.id}>
                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}` }}>{i + 1}</td>
                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}` }}>{fDate(p.tanggal)}</td>
                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}` }}>
                  {p.catatan || `Transfer ${p.jobLabel}`.trim()}
                  {jobs.length > 1 && p.jobLabel && <div style={{ fontSize: 10, color: gray }}>{p.jobLabel}</div>}
                </td>
                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, textAlign: "right", fontWeight: 700 }}>{fRp(p.amount)}</td>
                <td style={{ padding: "8px 10px", borderBottom: `1px solid ${border}`, textAlign: "center" }}>
                  <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 12, padding: "3px 10px", fontSize: 10, fontWeight: 800 }}>✓ Berhasil</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginTop: 8, fontWeight: 800, fontSize: 13, color: navy }}>
          <span>🏛 TOTAL PEMBAYARAN</span>
          <span>{fRp(totalBayar)}</span>
        </div>

        {/* Section 3: Posisi Akhir */}
        <SectionHeader num="3" title="POSISI AKHIR" />
        <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 14, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ color: gray }}>Total Tagihan (Rincian Pembelian)</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalTagihan)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${border}` }}>
            <span style={{ color: gray }}>Total Pembayaran</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalBayar)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, background: sisa > 0 ? "#fef2f2" : "#ecfdf5", borderRadius: 8, padding: "12px 14px" }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: sisa > 0 ? "#991b1b" : "#065f46" }}>💳 SISA PEMBAYARAN YANG HARUS DIBAYAR</span>
            <span style={{ fontWeight: 900, fontSize: 18, color: sisa > 0 ? "#dc2626" : "#059669" }}>{fRp(sisa)}</span>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#eff6ff", borderRadius: 8, padding: 12, fontSize: 11, color: "#374151", display: "flex", gap: 8 }}>
          <span>📋</span>
          <span>
            Berdasarkan total tagihan sebesar {fRp(totalTagihan)} dan total pembayaran yang telah diterima sebesar {fRp(totalBayar)},{" "}
            {sisa > 0
              ? `maka masih terdapat sisa pembayaran sebesar ${fRp(sisa)} yang perlu diselesaikan.`
              : "pembayaran sudah lunas."}
          </span>
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: gray }}>Terima kasih atas kerja sama dan kepercayaannya.</div>
      </div>
    </div>
  );
}
