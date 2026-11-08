import { useState, useEffect } from "react";
import axios from "axios";
import SupplierFinance from "./SupplierFinance";

/* Menu sidebar PEMBELIAN → Rekap Supplier.
   Hanya daftar pemilih supplier (membaca GET /admin/suppliers yang sudah ada, tanpa mengubah apa pun);
   rekap lengkapnya memakai komponen SupplierFinance yang sama dengan menu ⋮ di halaman Supplier. */
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const rp = (n) => "Rp " + Math.round(Number(n) || 0).toLocaleString("id-ID");

export default function RekapSupplierPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const [q, setQ] = useState("");
  const [items, setItems] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null);

  useEffect(() => {
    let off = false;
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/suppliers`, { params: q.trim() ? { q: q.trim() } : {}, headers: { "x-admin-pin": adminPin } });
        if (!off) { setItems(r.data.items || []); setErr(""); }
      } catch (e) { if (!off) setErr(e?.response?.data?.detail || "Gagal memuat daftar supplier."); }
    }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [q, adminPin]);

  return (
    <div data-testid="rekap-supplier-page" style={{ maxWidth: 920, margin: "0 auto" }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama supplier…" data-testid="rekap-supplier-search"
        style={{ width: "100%", padding: "11px 14px", borderRadius: 9, border: "1px solid #2a3547", background: "#0d1320", color: "#e6edf3", fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} />
      {err && <div style={{ color: "#f85149", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      {!items && !err && <div style={{ color: "#8b98ab", fontSize: 13 }}>Memuat…</div>}
      {items && items.length === 0 && <div style={{ color: "#8b98ab", fontSize: 13 }}>Supplier tidak ditemukan.</div>}
      {(items || []).map((s) => (
        <button key={s.id} onClick={() => setSel({ id: s.id, nama: s.nama })} data-testid={`rekap-supplier-row-${s.id}`}
          style={{ display: "block", width: "100%", textAlign: "left", padding: "12px 14px", marginBottom: 8, borderRadius: 10, border: "1px solid #1f2a3b", background: "#101826", color: "#e6edf3", cursor: "pointer" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <b style={{ fontSize: 14 }}>{s.nama}</b>
            <span style={{ fontSize: 11, color: "#8b98ab", whiteSpace: "nowrap" }}>{s.jumlah_unit || 0} unit</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", fontSize: 12, color: "#8b98ab", marginTop: 4 }}>
            <span>Tagihan <b style={{ color: "#c9d4e5" }}>{rp(s.grand_total_harga)}</b></span>
            <span>Terbayar <b style={{ color: "#c9d4e5" }}>{rp(s.grand_total_terbayar)}</b></span>
            <span>Sisa <b style={{ color: "#c9d4e5" }}>{rp(s.grand_sisa)}</b></span>
          </div>
        </button>
      ))}
      <div style={{ fontSize: 11, color: "#6b7681", marginTop: 6 }}>Angka pada daftar ini adalah angka lama (sebelum pajak), hanya untuk memilih supplier. Rekap lengkap ada di dalam.</div>
      {sel && <SupplierFinance supplier={sel} adminPin={adminPin} onClose={() => setSel(null)} onChanged={() => {}} onPdfFallback={() => { window.alert("PDF server belum siap. Buka halaman Supplier → pilih supplier → Rekap A4 untuk cetak dari browser."); }} />}
    </div>
  );
}
