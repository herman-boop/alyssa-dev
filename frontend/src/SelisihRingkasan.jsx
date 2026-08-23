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

/* Branding samain dgn PDF Supplier: navy + aksen gold, teks hitam/navy, tabel
   putih/abu tipis, checkmark kecil, minim badge warna-warni. */
const navy = "#0f2a5c";
const navyDeep = "#0a1e42";
const gold = "#c9973a";
const ink = "#111827";
const gray = "#6b7280";
const border = "#e3e6ec";
const mist = "#f7f8fa";

function SectionHeader({ title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "22px 0 10px" }}>
      <div style={{ width: 4, height: 15, background: gold, borderRadius: 2 }} />
      <div style={{ fontWeight: 800, fontSize: 12.5, color: ink, letterSpacing: 0.5, textTransform: "uppercase" }}>{title}</div>
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
  // RIWAYAT PEMBAYARAN = transaksi aktual (cocok rekening koran). 1 record = 1 baris,
  // TIDAK di-merge walau tanggal sama. Urut kronologis by tanggal (stable -> tanggal
  // sama tetap urutan pencatatan). Tanpa nomor invoice di kolom keterangan.
  const payments = [];
  tagihanList.forEach((tg) => (tg.payments || []).forEach((p) => payments.push({ tanggal: p.tanggal || "", amount: p.amount || 0 })));
  payments.sort((a, b) => String(a.tanggal).localeCompare(String(b.tanggal)));
  // Group visual per tanggal transfer (data TIDAK di-merge — tiap record tetap 1 baris).
  // Dipakai buat: subtotal per tanggal + wrapper break-inside:avoid biar 1 tanggal
  // tidak kepotong antar halaman. TOTAL PEMBAYARAN tetap dari sum record (bukan subtotal).
  const payByDate = [];
  const _pm = new Map();
  payments.forEach((p) => {
    const d = p.tanggal || "";
    if (!_pm.has(d)) { _pm.set(d, []); payByDate.push(d); }
    _pm.get(d).push(p);
  });

  const totalSelisih = data.grand_total_selisih || 0;
  const totalBayar = data.grand_total_terbayar || 0;
  const sisa = data.grand_sisa || 0;
  const lunasAll = totalSelisih > 0 && sisa <= 0;
  const todayFmt = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });

  const th = { textAlign: "left", padding: "7px 9px", color: "#334155", fontWeight: 700, fontSize: 9, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1.5px solid #cbd5e1`, background: mist };
  const td = { padding: "7px 9px", borderBottom: `1px solid ${border}`, fontSize: 11 };
  // Gaya compact bank-statement khusus tabel Riwayat Pembayaran (row rapat, font kecil tajam).
  const thC = { textAlign: "left", padding: "5px 8px", color: "#334155", fontWeight: 700, fontSize: 8, textTransform: "uppercase", letterSpacing: 0.3, borderBottom: `1.2px solid #cbd5e1`, background: mist };
  const tdC = { padding: "3.5px 8px", borderBottom: `1px solid #eef0f4`, fontSize: 9.5, lineHeight: 1.2 };
  const subTd = { padding: "3.5px 8px", borderTop: `1px solid ${border}`, borderBottom: `1px solid ${border}`, background: "#fbfcfe", fontSize: 9, color: "#334155" };

  return (
    <div data-testid="ringkasan-ready" style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "Arial, 'Helvetica Neue', 'Segoe UI', sans-serif" }}>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        @media print {
          [data-testid="ringkasan-ready"]{ background:#fff !important; padding:0 !important; display:block !important; min-height:0 !important; }
          [data-testid="ringkasan-card"]{ width:100% !important; border-radius:0 !important; padding:0 !important; box-shadow:none !important; }
          /* Tabel boleh pecah antar halaman, TAPI thead repeat & tiap grup (tbody/row) utuh */
          table{ page-break-inside:auto; }
          thead{ display:table-header-group; }
          tbody{ page-break-inside:avoid; break-inside:avoid; }
          tr, .avoid-break { page-break-inside:avoid; break-inside:avoid; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div data-testid="ringkasan-card" style={{ width: 600, background: "#fff", borderRadius: 14, padding: 32, color: ink }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `2.5px solid ${navy}`, paddingBottom: 14, marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: 21, fontWeight: 900, color: navy, letterSpacing: 0.4 }}>RINGKASAN SELISIH HARGA</div>
            <div style={{ fontSize: 9, color: gold, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>PT Alyssa Auto Logistik</div>
            <div style={{ fontSize: 12, color: gray, marginTop: 4 }}>PIC Purchasing — <b style={{ color: ink }}>{data.nama}</b></div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11 }}>
            <div style={{ color: gray }}>Tanggal</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{todayFmt}</div>
            <div style={{ color: gray }}>Disusun Oleh</div>
            <div style={{ fontWeight: 700 }}>Admin Keuangan</div>
          </div>
        </div>

        {/* Section 1: Rincian Tagihan (grouped per No Invoice, tanpa badge di header) */}
        <SectionHeader title="Rincian Tagihan" />
        {tagihanList.length === 0 && (
          <div style={{ padding: 14, textAlign: "center", color: gray, fontSize: 12 }}>Belum ada tagihan.</div>
        )}
        {tagihanList.map((tg) => (
          <div key={tg.id} style={{ marginBottom: 16 }} className="avoid-break">
            {/* Header group: cukup nomor invoice, TANPA badge lunas/belum lunas */}
            <div style={{ fontWeight: 800, fontSize: 12, color: navy, marginBottom: 5, paddingLeft: 2 }}>
              {tg.no_invoice || "(tanpa nomor)"}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Unit</th>
                  <th style={th}>Asal → Tujuan</th>
                  <th style={{ ...th, textAlign: "right" }}>Harga Deal</th>
                  <th style={{ ...th, textAlign: "right" }}>Harga Invoice</th>
                  <th style={{ ...th, textAlign: "right" }}>Selisih</th>
                </tr>
              </thead>
              <tbody>
                {(tg.items || []).map((it) => (
                  <tr key={it.id}>
                    <td style={td}>
                      {it.vehicle_type || "—"}{it.no_unit && <div style={{ color: gray, fontSize: 10 }}>{it.no_unit}</div>}
                    </td>
                    <td style={td}>{it.asal_kota || "—"} → {it.tujuan_kota || "—"}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fRp(it.harga_deal)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{fRp(it.harga_invoice)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700, color: navy }}>{fRp(it.selisih)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Subtotal group: Selisih / Sudah Dibayar / Sisa + status kecil di akhir */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
              <div style={{ width: 300 }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 2px", fontSize: 11 }}>
                  <span style={{ color: gray }}>Subtotal Selisih</span><span style={{ fontWeight: 700 }}>{fRp(tg.total_selisih)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 2px", fontSize: 11 }}>
                  <span style={{ color: gray }}>Sudah Dibayar</span><span style={{ fontWeight: 700 }}>{fRp(tg.total_terbayar)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 2px", fontSize: 11.5, borderTop: `1px solid ${border}` }}>
                  <span style={{ fontWeight: 700, color: ink }}>Sisa</span>
                  <span style={{ fontWeight: 800, color: tg.sisa > 0 ? "#b42318" : navy }}>{fRp(tg.sisa)}</span>
                </div>
                <div style={{ textAlign: "right", marginTop: 4 }}>
                  {tg.lunas
                    ? <span style={{ color: "#0f7a4d", fontWeight: 800, fontSize: 11 }}>&#10003; LUNAS</span>
                    : <span style={{ color: gray, fontWeight: 600, fontSize: 10 }}>Status: Belum Lunas</span>}
                </div>
              </div>
            </div>
          </div>
        ))}
        {/* Total selisih keseluruhan — clean bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${navy}`, padding: "9px 4px 0", marginTop: 4 }}>
          <span style={{ fontWeight: 900, fontSize: 12.5, color: navy, textTransform: "uppercase", letterSpacing: 0.3 }}>Total Selisih</span>
          <span style={{ fontWeight: 900, fontSize: 13.5, color: ink }}>{fRp(totalSelisih)}</span>
        </div>

        {/* Section 2: Riwayat Pembayaran (transaksi aktual, tanpa nomor invoice) */}
        <SectionHeader title="Riwayat Pembayaran" />
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead style={{ display: "table-header-group" }}>
            <tr>
              <th style={{ ...thC, width: 30 }}>No.</th>
              <th style={thC}>Tanggal Transfer</th>
              <th style={{ ...thC, textAlign: "right", width: 130 }}>Nominal</th>
              <th style={{ ...thC, textAlign: "center", width: 74 }}>Status</th>
            </tr>
          </thead>
          {payments.length === 0 && (
            <tbody><tr><td colSpan={4} style={{ ...tdC, textAlign: "center", color: gray }}>Belum ada pembayaran.</td></tr></tbody>
          )}
          {(() => {
            let no = 0;
            return payByDate.map((d) => {
              const rows = _pm.get(d);
              const sub = rows.reduce((s, p) => s + p.amount, 0);
              // Satu tbody per tanggal + break-inside:avoid -> 1 group tanggal tidak
              // kepotong antar halaman; thead di atas otomatis repeat tiap halaman.
              return (
                <tbody key={d} style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                  {rows.map((p, k) => {
                    no += 1;
                    return (
                      <tr key={k}>
                        <td style={{ ...tdC, fontWeight: 700, color: navy }}>{String(no).padStart(2, "0")}</td>
                        <td style={{ ...tdC, fontWeight: 600 }}>{fDate(p.tanggal)}</td>
                        <td style={{ ...tdC, textAlign: "right", fontWeight: 700 }}>{fRp(p.amount)}</td>
                        <td style={{ ...tdC, textAlign: "center", color: "#0f7a4d", fontWeight: 700, fontSize: 9 }}>&#10003; Diterima</td>
                      </tr>
                    );
                  })}
                  {rows.length > 1 && (
                    <tr>
                      <td style={subTd}></td>
                      <td style={{ ...subTd, fontWeight: 700, textAlign: "right" }}>Subtotal {fDate(d)}</td>
                      <td style={{ ...subTd, textAlign: "right", fontWeight: 800, color: navy }}>{fRp(sub)}</td>
                      <td style={subTd}></td>
                    </tr>
                  )}
                </tbody>
              );
            });
          })()}
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `2px solid ${navy}`, padding: "9px 4px 0", marginTop: 4 }}>
          <span style={{ fontWeight: 900, fontSize: 12.5, color: navy, textTransform: "uppercase", letterSpacing: 0.3 }}>Total Pembayaran</span>
          <span style={{ fontWeight: 900, fontSize: 13.5, color: ink }}>{fRp(totalBayar)}</span>
        </div>

        {/* Section 3: Posisi Akhir — status keseluruhan (dominan), jangan kepotong */}
        <div className="avoid-break" style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
        <SectionHeader title="Posisi Akhir" />
        <div style={{ width: "64%", maxWidth: 360, marginLeft: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 2px", fontSize: 11.5, borderBottom: `1px solid ${border}` }}>
            <span style={{ color: "#333", textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3, fontWeight: 600 }}>Total Selisih</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalSelisih)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 2px", fontSize: 11.5, borderBottom: `1px solid ${border}` }}>
            <span style={{ color: "#333", textTransform: "uppercase", fontSize: 10.5, letterSpacing: 0.3, fontWeight: 600 }}>Total Pembayaran</span>
            <span style={{ fontWeight: 700 }}>{fRp(totalBayar)}</span>
          </div>
          <div style={{ marginTop: 10, background: navy, borderRadius: 9, padding: "13px 16px" }}>
            {lunasAll ? (
              <div style={{ color: "#fff", fontWeight: 900, fontSize: 20, letterSpacing: 0.5 }}>&#10003; LUNAS</div>
            ) : (
              <>
                <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.7, color: "#e8c98a", textTransform: "uppercase" }}>Sisa Yang Harus Ditransfer</div>
                <div style={{ fontSize: 23, fontWeight: 900, color: "#fff", marginTop: 2, lineHeight: 1.05 }}>{fRp(sisa)}</div>
              </>
            )}
          </div>
        </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 10.5, color: gray }}>Terima kasih atas kerja sama dan kepercayaannya.</div>
      </div>
    </div>
  );
}
