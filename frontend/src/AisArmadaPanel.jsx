import { useState } from "react";
import axios from "axios";

/* Audit armada: semua kapal pada leg aktif — identitas MMSI/IMO valid?, umur posisi, hasil percobaan refresh terakhir.
   Murni baca (GET /admin/ais/armada); tidak memakai kuota provider. */
const OUT = {
  updated: "posisi baru diterima", same: "provider: posisi sama", older: "provider: posisi lebih lama (diabaikan)",
  no_position: "provider tak punya posisi", http_error: "error HTTP provider", timeout: "timeout", quota: "kuota/ditahan",
  no_timestamp: "tanpa waktu dari provider", manual_request: "permintaan manual",
};
const FR = { fresh: ["Live", "#3fb950"], recent: ["Terakhir", "#d29922"], stale: ["Posisi Terakhir Terdeteksi", "#f85149"], unknown: ["Waktu tak terverifikasi", "#d29922"], none: ["Belum ada posisi", "#8b949e"] };
const umur = (s) => (s == null ? "—" : s < 3600 ? `${Math.floor(s / 60)} mnt` : s < 86400 ? `${Math.floor(s / 3600)} jam` : `${Math.floor(s / 86400)} hari`);

export default function AisArmadaPanel({ apiBase, headers }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setData(null);
    try { const r = await axios.get(`${apiBase}/admin/ais/armada`, { headers }); setData(r.data); }
    catch (e) { setData({ error: e?.response?.status || "gagal" }); }
    finally { setBusy(false); }
  };
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #1a2130", paddingTop: 12 }} data-testid="ais-armada">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#8b949e" }}>Armada kapal aktif: identitas valid? · umur posisi · hasil refresh terakhir (tanpa kuota).</div>
        <button onClick={run} disabled={busy} style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #1f6feb", background: "#0d1a2e", color: "#79c0ff", fontWeight: 700, fontSize: 12, cursor: "pointer" }} data-testid="ais-armada-run">
          {busy ? "⏳ Memeriksa..." : "🚢 Armada Kapal Aktif"}
        </button>
      </div>
      {data && data.error && <div style={{ marginTop: 10, fontSize: 12, color: "#f85149" }}>Gagal: {String(data.error)}</div>}
      {data && !data.error && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>
            {(data.kapal || []).length} kapal aktif{data.kuota_habis_menit ? ` · kuota ditahan ${data.kuota_habis_menit} mnt` : ""}
            {data.jadwal ? ` · jadwal otomatis jam ${data.jadwal.jam.join(", ")} ${data.jadwal.zona}` : ""} · tombol pelanggan: jeda {data.cooldown_manual_menit} mnt/kapal
          </div>
          {(data.kapal || []).map((k) => {
            const [lbl, col] = FR[k.freshness] || FR.none;
            const last = (k.percobaan_terakhir || [])[0];
            return (
              <div key={k.ident} style={{ background: "#0a0e16", border: "1px solid #1a2130", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 12, color: "#c9d1d9" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>{k.kapal || k.nama_di_ais || k.ident}</b>
                  <span style={{ color: col, fontWeight: 700 }}>{lbl} · {umur(k.age_seconds)}</span>
                </div>
                <div style={{ color: "#8b949e", marginTop: 3 }}>MMSI {k.mmsi || "—"} · IMO {k.imo || "—"} · {k.jumlah_trip} trip{k.nama_di_ais && k.kapal && k.nama_di_ais.toLowerCase() !== k.kapal.toLowerCase() ? ` · nama di AIS: ${k.nama_di_ais}` : ""}</div>
                {(k.masalah_identitas || []).map((m, i) => <div key={i} style={{ color: "#f0883e", marginTop: 3 }}>⚠ {m}</div>)}
                {last ? <div style={{ color: "#8b949e", marginTop: 3 }}>Refresh terakhir: {OUT[last.outcome] || last.outcome}{last.http ? ` (HTTP ${last.http})` : ""} · {String(last.at).slice(0, 16).replace("T", " ")} UTC</div> : <div style={{ color: "#8b949e", marginTop: 3 }}>Belum ada percobaan refresh tercatat.</div>}
              </div>
            );
          })}
          {(data.kapal || []).length === 0 && <div style={{ fontSize: 12, color: "#6b7681" }}>Tidak ada kapal pada leg "Berlangsung".</div>}
        </div>
      )}
    </div>
  );
}
