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

export default function SelisihRingkasan() {
  const params = useMemo(() => {
    const parts = window.location.pathname.split("/").filter(Boolean); // ["selisih-ringkasan", id]
    const id = parts[1] || "";
    const sp = new URLSearchParams(window.location.search);
    return { id, pin: sp.get("pin") || "" };
  }, []);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/admin/selisih/${params.id}/ringkasan`, { params: { pin: params.pin } });
        setData(r.data);
      } catch (e) {
        setError(e?.response?.data?.detail || "Gagal memuat data ringkasan");
      }
    })();
  }, [params]);

  if (error) return <div style={{ padding: 40, color: "#dc2626", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "sans-serif", color: "#6b7280" }}>Memuat...</div>;

  const tagihanList = data.tagihan || [];
  const payments = [];
  tagihanList.forEach((tg) => {
    (tg.payments || []).forEach((p) => {
      payments.push({ ...p, noInvoice: tg.no_invoice || "(tanpa nomor)" });
    });
  });
  payments.sort((a, b) => String(a.tanggal || "").localeCompare(String(b.tanggal || "")));

  const totalSelisih = data.grand_total_selisih || 0;
  const totalBayar = data.grand_total_terbayar || 0;
  const sisa = data.grand_sisa || 0;
  const todayFmt = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div data-testid="ringkasan-ready" style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <style>{`
        @page { size: A4; margin: 0; }
        @media print {
          [data-testid="ringkasan-ready"]{ background:#fff !important; padding:0 !important; display:block !important; min-height:0 !important; }
          [data-testid="ringkasan-card"]{ width:100% !important; border-radius:0 !important; padding:8mm 7mm !important; box-shadow:none !important; }
          table{ page-break-inside:auto; }
          tr, thead, .avoid-break { page-break-inside:avoid; break-inside:avoid; }
        }
      `}</style>
      <div data-testid="ringkasan-card" style={{ width: 600, background: "#fff", borderRadius: 14, padding: 32, color: "#1f2937" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${navy}`, paddingBottom: 16, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 900, color: navy, letterSpacing: 0.4 }}>RINGKASAN SELISIH HARGA</div>
            <div style={{ fontSize: 12, color: gray, marginTop: 4 }}>PIC Purchasing — {data.nama}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: gray }}>📅 Tanggal</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{todayFmt}</div>
            <div style={{ color: gray }}>👤 Disusun Oleh</div>
            <div style={{ fontWeight: 700 }}>Admin Keuangan</div>
          </div>
        </div>

        {/* Section 1: Rincian Tagihan (grouped per No Invoice) */}
        <SectionHeader num="1" title="RINCIAN TAGIHAN" />
        {tagihanList.length === 0 && (
          <div style={{ padding: 14, textAlign: "center", color: gray, fontSize: 12 }}>Belum ada tagihan.</div>
        )}
        {tagihanList.map((tg) => (
          <div key={tg.id} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 12 }}>🧾 {tg.no_invoice || "(tanpa nomor)"}</span>
              {tg.lunas ? (
                <span style={{ background: "#d1fae5", color: "#065f46", borderRadius: 12, padding: "2px 8px", fontSize: 9, fontWeight: 800 }}>✓ LUNAS</span>
              ) : (
                <span style={{ background: "#fef2f2", color: "#991b1b", borderRadius: 12, padding: "2px 8px", fontSize: 9, fontWeight: 800 }}>BELUM LUNAS</span>
              )}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Unit</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Asal → Tujuan</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Harga Deal</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Harga Invoice</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Selisih</th>
                </tr>
              </thead>
              <tbody>
                {(tg.items || []).map((it) => (
                  <tr key={it.id}>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>
                      {it.vehicle_type || "—"}{it.no_unit && <div style={{ color: gray, fontSize: 10 }}>{it.no_unit}</div>}
                    </td>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>{it.asal_kota || "—"} → {it.tujuan_kota || "—"}</td>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}`, textAlign: "right" }}>{fRp(it.harga_deal)}</td>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}`, textAlign: "right" }}>{fRp(it.harga_invoice)}</td>
                    <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}`, textAlign: "right", fontWeight: 700, color: navy }}>{fRp(it.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 8px", fontSize: 11, fontWeight: 700, color: navy }}>
              Subtotal: {fRp(tg.total_selisih)}
            </div>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#eff6ff", borderRadius: 8, padding: "10px 14px", marginTop: 4, fontWeight: 800, fontSize: 13, color: navy }}>
          <span>🧮 TOTAL SELISIH</span>
          <span>{fRp(totalSelisih)}</span>
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
                  {p.catatan || `Transfer ${p.noInvoice}`}
                  <div style={{ fontSize: 10, color: gray }}>{p.noInvoice}</div>
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
            <span style={{ color: gray }}>Total Selisih (Semua Tagihan)</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalSelisih)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${border}` }}>
            <span style={{ color: gray }}>Total Pembayaran</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalBayar)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, background: sisa > 0 ? "#fef2f2" : "#ecfdf5", borderRadius: 8, padding: "12px 14px" }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: sisa > 0 ? "#991b1b" : "#065f46" }}>💳 SISA YANG HARUS DITRANSFER</span>
            <span style={{ fontWeight: 900, fontSize: 18, color: sisa > 0 ? "#dc2626" : "#059669" }}>{fRp(sisa)}</span>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#eff6ff", borderRadius: 8, padding: 12, fontSize: 11, color: "#374151", display: "flex", gap: 8 }}>
          <span>📋</span>
          <span>
            Berdasarkan total selisih sebesar {fRp(totalSelisih)} dan total pembayaran yang telah ditransfer sebesar {fRp(totalBayar)},{" "}
            {sisa > 0
              ? `maka masih terdapat sisa sebesar ${fRp(sisa)} yang perlu ditransfer.`
              : "seluruh selisih sudah ditransfer lunas."}
          </span>
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: gray }}>Terima kasih atas kerja sama dan kepercayaannya.</div>
      </div>
    </div>
  );
}
