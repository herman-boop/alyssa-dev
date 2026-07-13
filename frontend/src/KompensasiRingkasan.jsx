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

function ItemTable({ items, emptyLabel }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr style={{ background: "#f8fafc" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Tanggal</th>
          <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Keterangan</th>
          <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Unit</th>
          <th style={{ textAlign: "left", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Rute</th>
          <th style={{ textAlign: "right", padding: "6px 8px", color: gray, fontWeight: 700, borderBottom: `1px solid ${border}` }}>Nilai</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 && (
          <tr><td colSpan={5} style={{ padding: 12, textAlign: "center", color: gray }}>{emptyLabel}</td></tr>
        )}
        {items.map((it) => (
          <tr key={it.id}>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>{fDate(it.tanggal)}</td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>
              {it.keterangan || "—"}
              {it.catatan && <div style={{ fontSize: 10, color: gray }}>{it.catatan}</div>}
            </td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>
              {it.vehicle_type || "—"}{it.no_unit && <div style={{ color: gray, fontSize: 10 }}>{it.no_unit}</div>}
            </td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}` }}>
              {(it.asal_kota || it.tujuan_kota) ? `${it.asal_kota || "?"} → ${it.tujuan_kota || "?"}` : "—"}
            </td>
            <td style={{ padding: "6px 8px", borderBottom: `1px solid ${border}`, textAlign: "right", fontWeight: 700, color: navy }}>{fRp(it.nilai)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function KompensasiRingkasan() {
  const params = useMemo(() => {
    const parts = window.location.pathname.split("/").filter(Boolean); // ["kompensasi-ringkasan", id]
    const id = parts[1] || "";
    const sp = new URLSearchParams(window.location.search);
    return { id, pin: sp.get("pin") || "" };
  }, []);

  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/admin/kompensasi/${params.id}/ringkasan`, { params: { pin: params.pin } });
        setData(r.data);
      } catch (e) {
        setError(e?.response?.data?.detail || "Gagal memuat data ringkasan");
      }
    })();
  }, [params]);

  if (error) return <div style={{ padding: 40, color: "#dc2626", fontFamily: "sans-serif" }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, fontFamily: "sans-serif", color: "#6b7280" }}>Memuat...</div>;

  const items = data.items || [];
  const itemsKita = items.filter((i) => i.arah === "kita_ke_mereka").sort((a, b) => String(a.tanggal || "").localeCompare(String(b.tanggal || "")));
  const itemsMereka = items.filter((i) => i.arah === "mereka_ke_kita").sort((a, b) => String(a.tanggal || "").localeCompare(String(b.tanggal || "")));

  const totalKita = data.total_kita || 0;
  const totalMereka = data.total_mereka || 0;
  const sisa = data.sisa || 0;
  const rekananNama = data.nama || "Rekanan";
  const todayFmt = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div data-testid="ringkasan-ready" style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div data-testid="ringkasan-card" style={{ width: 600, background: "#fff", borderRadius: 14, padding: 32, color: "#1f2937" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `3px solid ${navy}`, paddingBottom: 16, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: navy, letterSpacing: 0.3 }}>RINGKASAN KOMPENSASI HUTANG PIUTANG</div>
            <div style={{ fontSize: 12, color: gray, marginTop: 4 }}>Rekanan — {rekananNama}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: gray }}>📅 Tanggal</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{todayFmt}</div>
            <div style={{ color: gray }}>👤 Disusun Oleh</div>
            <div style={{ fontWeight: 700 }}>Admin Keuangan</div>
          </div>
        </div>

        {/* Section 1: Rincian Kewajiban Kita -> Rekanan */}
        <SectionHeader num="1" title={`RINCIAN KEWAJIBAN KITA → ${rekananNama.toUpperCase()}`} />
        <ItemTable items={itemsKita} emptyLabel="Belum ada rincian." />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#fef2f2", borderRadius: 8, padding: "10px 14px", marginTop: 4, fontWeight: 800, fontSize: 13, color: "#991b1b" }}>
          <span>📤 TOTAL KEWAJIBAN KITA</span>
          <span>{fRp(totalKita)}</span>
        </div>

        {/* Section 2: Rincian Kewajiban Rekanan -> Kita */}
        <SectionHeader num="2" title={`RINCIAN KEWAJIBAN ${rekananNama.toUpperCase()} → KITA`} />
        <ItemTable items={itemsMereka} emptyLabel="Belum ada rincian." />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ecfdf5", borderRadius: 8, padding: "10px 14px", marginTop: 4, fontWeight: 800, fontSize: 13, color: "#065f46" }}>
          <span>📥 TOTAL KEWAJIBAN {rekananNama.toUpperCase()}</span>
          <span>{fRp(totalMereka)}</span>
        </div>

        {/* Section 3: Posisi Akhir / Netting */}
        <SectionHeader num="3" title="POSISI AKHIR (SISA KEWAJIBAN)" />
        <div style={{ border: `1px solid ${border}`, borderRadius: 10, padding: 14, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ color: gray }}>Kewajiban Kita Terhadap {rekananNama}</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalKita)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${border}` }}>
            <span style={{ color: gray }}>Kewajiban {rekananNama} Terhadap Kita</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalMereka)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, background: sisa >= 0 ? "#ecfdf5" : "#fef2f2", borderRadius: 8, padding: "12px 14px" }}>
            <span style={{ fontWeight: 800, fontSize: 12, color: sisa >= 0 ? "#065f46" : "#991b1b" }}>
              💳 SISA KEWAJIBAN {sisa >= 0 ? `${rekananNama.toUpperCase()} KEPADA KITA` : `KITA KEPADA ${rekananNama.toUpperCase()}`}
            </span>
            <span style={{ fontWeight: 900, fontSize: 18, color: sisa >= 0 ? "#059669" : "#dc2626" }}>{fRp(Math.abs(sisa))}</span>
          </div>
        </div>

        <div style={{ marginTop: 16, background: "#eff6ff", borderRadius: 8, padding: 12, fontSize: 11, color: "#374151", display: "flex", gap: 8 }}>
          <span>📋</span>
          <span>
            Berdasarkan rincian kewajiban kita sebesar {fRp(totalKita)} dan kewajiban {rekananNama} sebesar {fRp(totalMereka)},{" "}
            {sisa > 0
              ? `maka masih terdapat sisa kewajiban ${rekananNama} kepada kita sebesar ${fRp(sisa)}.`
              : sisa < 0
                ? `maka masih terdapat sisa kewajiban kita kepada ${rekananNama} sebesar ${fRp(Math.abs(sisa))}.`
                : "kedua kewajiban sudah impas (nihil)."}
          </span>
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: gray }}>Terima kasih atas kerja sama dan kepercayaannya.</div>
      </div>
    </div>
  );
}
