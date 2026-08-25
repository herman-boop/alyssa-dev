import { useState, useEffect, useMemo } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";

function pNum(s) {
  const n = parseInt(String(s || "").replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
function fRp(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}

export default function SupplierQuoteFill() {
  const token = useMemo(() => window.location.pathname.replace(/^\/minta-harga\//, "").split("?")[0].trim(), []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError("Link tidak valid"); setLoading(false); return; }
    axios.get(`${API}/minta-harga/${token}`)
      .then((r) => {
        setData(r.data);
        const v = {};
        (r.data.rows || []).forEach((row) => { if (row.harga) v[row.id] = String(row.harga); });
        setValues(v);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.response?.data?.detail || "Link tidak valid atau sudah kadaluarsa");
        setLoading(false);
      });
  }, [token]);

  const setVal = (id, v) => setValues((prev) => ({ ...prev, [id]: v.replace(/[^0-9]/g, "") }));

  const submit = async () => {
    const rowsToSend = Object.entries(values)
      .filter(([, v]) => pNum(v) > 0)
      .map(([id, v]) => ({ id, harga: pNum(v) }));
    if (rowsToSend.length === 0) {
      window.alert("Isi harga minimal 1 rute dulu ya.");
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API}/minta-harga/${token}/submit`, { rows: rowsToSend });
      setDone(true);
    } catch (e) {
      window.alert(e?.response?.data?.detail || "Gagal mengirim, coba lagi.");
    }
    setSaving(false);
  };

  const wrap = { background: "#f3f4f6", minHeight: "100vh", fontFamily: "'Segoe UI', Arial, sans-serif", color: "#1f2937" };

  if (loading) {
    return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: gray }}>Memuat...</div>;
  }
  if (error || !data) {
    return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: "#dc2626", padding: 24, textAlign: "center" }}>{error || "Data tidak ditemukan"}</div>;
  }

  if (done) {
    return (
      <div style={{ ...wrap, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 900, color: navy, marginBottom: 8 }}>Terima Kasih!</div>
        <div style={{ fontSize: 14, color: gray, maxWidth: 320 }}>Harga sudah terkirim ke PT Alyssa Auto Logistik. Bisa tutup halaman ini.</div>
      </div>
    );
  }

  const rows = data.rows || [];
  const filledCount = rows.filter((r) => pNum(values[r.id]) > 0).length;

  return (
    <div style={wrap}>
      <div style={{ background: navy, color: "#fff", padding: "22px 20px 26px" }}>
        <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 600 }}>PERMINTAAN HARGA</div>
        <div style={{ fontSize: 21, fontWeight: 900, marginTop: 4 }}>Halo, {data.nama_supplier} 👋</div>
        <div style={{ fontSize: 13, opacity: 0.9, marginTop: 8, lineHeight: 1.5 }}>
          Mohon bantu isi harga untuk rute-rute di bawah ini. Cukup ketik angka harga per rute, lalu tekan tombol Kirim di bawah.
        </div>
        {data.catatan && (
          <div style={{ marginTop: 10, background: "rgba(255,255,255,0.12)", borderRadius: 8, padding: "8px 12px", fontSize: 12.5 }}>📌 {data.catatan}</div>
        )}
      </div>

      <div style={{ padding: "18px 16px 100px", maxWidth: 480, margin: "0 auto" }}>
        <div style={{ fontSize: 12, color: gray, fontWeight: 700, marginBottom: 10 }}>{filledCount} / {rows.length} rute sudah diisi</div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {rows.map((row, idx) => (
            <div key={row.id} style={{ background: "#fff", border: `1px solid ${border}`, borderRadius: 16, padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: gray, fontWeight: 700, marginBottom: 4 }}>RUTE {idx + 1}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: "#1f2937", lineHeight: 1.3 }}>{row.asal} <span style={{ color: navy }}>→</span> {row.tujuan}</div>
              <div style={{ display: "inline-block", marginTop: 6, fontSize: 12, fontWeight: 700, color: navy, background: "#eff6ff", borderRadius: 8, padding: "3px 10px" }}>🚚 {row.tipe_kendaraan}</div>{row.moda ? <div style={{ display: "inline-block", marginTop: 6, marginLeft: 6, fontSize: 12, fontWeight: 700, color: "#0f7a4d", background: "#ecfdf5", borderRadius: 8, padding: "3px 10px" }}>🚢 {row.moda}</div> : null}

              <div style={{ marginTop: 14 }}>
                <label style={{ fontSize: 12, color: gray, fontWeight: 700, display: "block", marginBottom: 6 }}>Harga (Rp)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="cth: 3500000"
                  value={values[row.id] ? Number(values[row.id]).toLocaleString("id-ID") : ""}
                  onChange={(e) => setVal(row.id, e.target.value)}
                  style={{ width: "100%", fontSize: 20, fontWeight: 800, padding: "14px 16px", borderRadius: 12, border: `2px solid ${pNum(values[row.id]) > 0 ? "#22c55e" : border}`, outline: "none", color: "#111827", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${border}`, padding: "14px 16px", boxShadow: "0 -4px 16px rgba(0,0,0,0.08)" }}>
        <button
          onClick={submit}
          disabled={saving}
          style={{ width: "100%", maxWidth: 480, margin: "0 auto", display: "block", background: saving ? "#93a5c9" : navy, color: "#fff", fontSize: 16, fontWeight: 800, border: "none", borderRadius: 14, padding: "16px 0", cursor: saving ? "default" : "pointer" }}
        >
          {saving ? "Mengirim..." : `Kirim Harga (${filledCount})`}
        </button>
      </div>
    </div>
  );
}
