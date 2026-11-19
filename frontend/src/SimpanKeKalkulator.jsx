/*
  Penawaran yang sudah dicetak -> beri nama pelanggan + moda, simpan rutenya ke Kalkulator HPP (riwayat harga pelanggan).
  Cetak ulang penawaran ikut memakai nama baru. Rute tanpa harga / yang sudah ada dilewati (server).
*/
import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { METODE_LIST } from "./PenawaranCetak";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const IN = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 7, padding: "9px 11px", color: "#e6edf3", fontSize: 13.5, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };

export default function SimpanKeKalkulator({ rec, headers, onClose, onDone }) {
  const [nama, setNama] = useState((rec.customer || "").trim());
  const [moda, setModa] = useState("");
  const [daftar, setDaftar] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [hasil, setHasil] = useState(null);

  useEffect(() => {
    axios.get(`${API}/admin/pelanggan`, { headers }).then((r) => setDaftar((r.data.items || []).map((p) => p.nama_pt))).catch(() => {});
  }, [headers]);

  const ringkas = useMemo(() => {
    const us = Array.isArray(rec.units) ? rec.units : [];
    const berharga = us.filter((u) => Number(u.harga_deal || u.harga) > 0).length;
    const tanpaModa = us.filter((u) => { const m = String(u.moda || "").trim(); return !m || m === "-"; }).length;
    return { total: us.length, berharga, tanpaModa };
  }, [rec]);

  const simpan = async () => {
    if (!nama.trim()) { setErr("Nama pelanggan wajib diisi."); return; }
    setBusy(true); setErr("");
    try {
      const r = await axios.post(`${API}/admin/doc-history/${rec.id}/simpan-ke-kalkulator`, { nama_pt: nama.trim(), moda }, { headers });
      setHasil(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal menyimpan. Coba lagi."); }
    setBusy(false);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 14 }} onClick={onClose} data-testid="skk">
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 460, maxHeight: "92vh", overflowY: "auto", color: "#e6edf3" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #21262d", fontWeight: 800, color: "#EF9F27", fontSize: 14 }}>💾 Simpan ke Kalkulator HPP</div>
        {!hasil ? (
          <div style={{ padding: 18, display: "grid", gap: 12 }}>
            <div style={{ fontSize: 12, color: "#8b98ad", lineHeight: 1.55 }}>Penawaran <b style={{ color: "#e6edf3" }}>{rec.no_dokumen}</b> · {ringkas.total} rute ({ringkas.berharga} berharga). Beri nama pelanggan; rute dan harganya disimpan sebagai riwayat harga pelanggan itu di Kalkulator HPP. Cetak ulang penawaran akan memakai nama ini.</div>
            <label style={{ fontSize: 12, color: "#d9c58a", display: "grid", gap: 4 }}>Nama pelanggan
              <input style={IN} list="skk-pelanggan" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="mis. PT Sahabat Multi Logistik" autoFocus data-testid="skk-nama" />
              <datalist id="skk-pelanggan">{daftar.map((n) => <option key={n} value={n} />)}</datalist>
              <span style={{ fontSize: 11, color: "#8b98ad" }}>Pilih dari daftar bila pelanggannya sudah ada di Kalkulator HPP; ketik nama baru untuk membuat pelanggan baru.</span>
            </label>
            <label style={{ fontSize: 12, color: "#d9c58a", display: "grid", gap: 4 }}>Moda / metode pengiriman {ringkas.tanpaModa ? `(untuk ${ringkas.tanpaModa} rute yang modanya masih kosong)` : "(semua rute sudah punya moda)"}
              <select style={IN} value={moda} onChange={(e) => setModa(e.target.value)} data-testid="skk-moda">
                <option value="">(biarkan kosong)</option>
                {METODE_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            {err && <div style={{ color: "#f85149", fontSize: 12.5 }} data-testid="skk-err">❌ {err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="adm-btn adm-btn-ghost" onClick={onClose}>Batal</button>
              <button className="adm-btn adm-btn-gold" disabled={busy || !ringkas.berharga} onClick={simpan} data-testid="skk-simpan">{busy ? "Menyimpan…" : "Simpan"}</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 18, display: "grid", gap: 12 }} data-testid="skk-hasil">
            <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              ✅ Tersimpan untuk <b>{hasil.nama_pt}</b>{hasil.baru ? " (pelanggan baru dibuat)" : ""}.<br />
              <b>{hasil.ditambah}</b> rute masuk ke riwayat harga{hasil.dilewati ? `, ${hasil.dilewati} dilewati (tanpa harga atau sudah ada)` : ""}.<br />
              <span style={{ color: "#8b98ad", fontSize: 12 }}>Buka tab Kalkulator HPP, pilih pelanggan ini untuk melihatnya.</span>
            </div>
            <div style={{ textAlign: "right" }}><button className="adm-btn adm-btn-gold" onClick={() => { onDone(hasil); onClose(); }} data-testid="skk-tutup">Selesai</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
