import { useState } from "react";
import axios from "axios";

/* Monitoring Vessel API (admin): armada kapal yang dipantau, penyebab "belum ada data" (dibedakan), konfigurasi efektif
   (tanpa nilai rahasia), pemakaian kuota (berhasil/gagal/sisa), dan uji satu kapal (mis. FAJAR BAHARI II).
   "Armada" murni baca (tanpa kuota); "Uji live" menembak provider 1x (memakai kuota). */
const OUT = {
  updated: "posisi baru diterima", same: "provider: posisi sama", older: "provider: posisi lebih lama (diabaikan)",
  no_position: "provider tak punya posisi", http_error: "error HTTP provider", timeout: "timeout", quota: "kuota/ditahan", auth: "API key/paket ditolak",
  no_timestamp: "tanpa waktu dari provider", manual_request: "permintaan manual", not_found: "kapal tidak ditemukan", api_error: "API gagal",
};
const ST = {
  ok: ["Normal", "#3fb950"], pending: ["Belum dicek", "#8b949e"], not_found: ["Kapal tidak ditemukan", "#f85149"], no_signal: ["Tanpa sinyal AIS", "#d29922"],
  no_position: ["Posisi belum ada (tak pasti)", "#d29922"], quota: ["Kuota habis", "#f85149"], auth: ["Key/paket ditolak", "#f85149"],
  api_error: ["API gagal", "#f85149"], timeout: ["Timeout API", "#f0883e"], disabled: ["Integrasi mati", "#f85149"],
};
const FR = { fresh: ["Live", "#3fb950"], recent: ["Terakhir", "#d29922"], stale: ["Posisi Terakhir Terdeteksi", "#f0883e"], unknown: ["Waktu tak terverifikasi", "#d29922"], none: ["Belum ada posisi", "#8b949e"] };
const umur = (s) => (s == null ? "—" : s < 3600 ? `${Math.floor(s / 60)} mnt` : s < 86400 ? `${Math.floor(s / 3600)} jam` : `${Math.floor(s / 86400)} hari`);
const wkt = (iso) => (iso ? String(iso).slice(0, 16).replace("T", " ") + " UTC" : "—");
const box = { background: "#0a0e16", border: "1px solid #1a2130", borderRadius: 8, padding: 10, marginBottom: 8, fontSize: 12, color: "#c9d1d9" };

function Kuota({ k }) {
  if (!k) return null;
  const b = k.bulan || {}, h = k.hari || {};
  const gagal = (x) => (x.total || 0) - (x.ok || 0);
  return (
    <div style={box} data-testid="ais-kuota">
      <b>Pemakaian API</b>
      <div style={{ marginTop: 4 }}>Bulan ini: <b>{b.total || 0}</b> request · berhasil <b style={{ color: "#3fb950" }}>{b.ok || 0}</b> · gagal <b style={{ color: gagal(b) ? "#f85149" : "#8b949e" }}>{gagal(b)}</b>
        {" "}(kuota habis {b.quota || 0}, ditolak {b.auth || 0}, API error {(b.api_error || 0) + (b.timeout || 0)}, kapal tak ditemukan {b.not_found || 0})</div>
      <div>Hari ini: <b>{h.total || 0}</b> request · berhasil {h.ok || 0} · gagal {gagal(h)}</div>
      <div style={{ color: "#8b949e", marginTop: 3 }}>
        Sisa kuota (header provider): <b>{k.sisa_kuota != null ? `${k.sisa_kuota}${k.batas_kuota ? ` / ${k.batas_kuota}` : ""}` : "tidak dikirim provider"}</b>
        {k.anggaran_bulan ? <> · anggaran diset {k.anggaran_bulan}/bln, sisa {k.sisa_anggaran}</> : " · anggaran bulanan belum diset (env AIS_BUDGET_MONTH)"}
        {k.kuota_ditahan_menit ? <> · <b style={{ color: "#f85149" }}>ditahan {k.kuota_ditahan_menit} mnt</b></> : null}
      </div>
    </div>
  );
}

function Konfig({ c }) {
  if (!c) return null;
  const y = (v) => (v ? "✅" : "❌");
  return (
    <div style={box} data-testid="ais-konfig">
      <b>Konfigurasi efektif (Railway env)</b>
      <div style={{ marginTop: 4 }}>VESSEL_API_KEY {y(c.vesselapi_key_terisi)} · satelit {y(c.vesselapi_satelit)} · VesselFinder {y(c.vesselfinder_key_terisi)} · aisstream {y(c.aisstream_key_terisi)}</div>
      <div>Scheduler {y(c.auto_refresh_berjalan)}{c.jam_terbatas ? ` (dibatasi jam ${c.jam_terbatas.join(", ")})` : " 24 jam"} · interval pembawa kendaraan {c.interval_pembawa_kendaraan_menit} mnt · kapal berikutnya {c.interval_kapal_berikutnya_menit} mnt · tombol pelanggan jeda {c.cooldown_tombol_menit} mnt</div>
    </div>
  );
}

export default function AisArmadaPanel({ apiBase, headers }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [nama, setNama] = useState("");
  const [uji, setUji] = useState(null);
  const [ujiBusy, setUjiBusy] = useState(false);
  const run = async () => {
    setBusy(true); setData(null);
    try { const r = await axios.get(`${apiBase}/admin/ais/armada`, { headers }); setData(r.data); }
    catch (e) { setData({ error: e?.response?.status || "gagal" }); }
    finally { setBusy(false); }
  };
  const ujiKapal = async (live) => {
    if (!nama.trim()) return;
    if (live && !window.confirm("Tembak provider AIS sekarang untuk kapal ini? (memakai ±1–3 request kuota)")) return;
    setUjiBusy(true); setUji(null);
    try { const r = await axios.post(`${apiBase}/admin/ais/uji-kapal`, { nama: nama.trim(), live }, { headers }); setUji(r.data); }
    catch (e) { setUji({ kesimpulan: `Gagal: ${e?.response?.status || e.message}` }); }
    finally { setUjiBusy(false); }
  };
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #1a2130", paddingTop: 12 }} data-testid="ais-armada">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#8b949e" }}>Monitoring Vessel API: armada dipantau · penyebab tak ada data · kuota · konfigurasi (tanpa memakai kuota).</div>
        <button onClick={run} disabled={busy} style={{ padding: "8px 14px", borderRadius: 9, border: "1px solid #1f6feb", background: "#0d1a2e", color: "#79c0ff", fontWeight: 700, fontSize: 12, cursor: "pointer" }} data-testid="ais-armada-run">
          {busy ? "⏳ Memeriksa..." : "🚢 Armada & Kuota"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Uji kapal: mis. FAJAR BAHARI II" data-testid="ais-uji-nama"
          style={{ flex: "1 1 180px", minWidth: 0, padding: "8px 10px", borderRadius: 8, border: "1px solid #1f2937", background: "#0a0e16", color: "#e6edf3", fontSize: 12.5 }} />
        <button onClick={() => ujiKapal(false)} disabled={ujiBusy || !nama.trim()} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #30363d", background: "#111826", color: "#c9d1d9", fontWeight: 700, fontSize: 12, cursor: "pointer" }} data-testid="ais-uji-cek">Cek data</button>
        <button onClick={() => ujiKapal(true)} disabled={ujiBusy || !nama.trim()} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #6e40c9", background: "#1a1033", color: "#b392f0", fontWeight: 700, fontSize: 12, cursor: "pointer" }} data-testid="ais-uji-live">Uji live (pakai kuota)</button>
      </div>
      {uji && (
        <div style={{ ...box, marginTop: 8 }} data-testid="ais-uji-hasil">
          <b>{uji.kesimpulan || "—"}</b>
          {uji.mmsi || uji.imo ? <div style={{ color: "#8b949e", marginTop: 3 }}>MMSI {uji.mmsi || "—"} · IMO {uji.imo || "—"}</div> : null}
          {(uji.masalah_identitas || []).map((m, i) => <div key={i} style={{ color: "#f0883e" }}>⚠ {m}</div>)}
          {(uji.ditemukan_di_leg || []).length > 1 ? <div style={{ color: "#8b949e" }}>{uji.ditemukan_di_leg.length} leg memakai nama ini.</div> : null}
          {uji.cache ? <div style={{ color: "#8b949e" }}>Cache: {uji.cache.latitude}, {uji.cache.longitude} · {uji.cache.position_label} · {umur(uji.cache.age_seconds)}</div> : <div style={{ color: "#8b949e" }}>Belum ada posisi di cache.</div>}
          {(uji.percobaan_terakhir || []).slice(0, 4).map((p, i) => <div key={i} style={{ color: "#8b949e" }}>• {OUT[p.outcome] || p.outcome}{p.http ? ` (HTTP ${p.http})` : ""} · {wkt(p.at)}</div>)}
          {uji.konfigurasi ? <Konfig c={uji.konfigurasi} /> : null}
        </div>
      )}

      {data && data.error && <div style={{ marginTop: 10, fontSize: 12, color: "#f85149" }}>Gagal: {String(data.error)}</div>}
      {data && !data.error && (
        <div style={{ marginTop: 10 }}>
          <Konfig c={data.konfigurasi} />
          <Kuota k={data.kuota} />
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 8 }}>{(data.kapal || []).length} kapal dipantau (pembawa kendaraan lebih dulu){data.kuota_habis_menit ? ` · kuota ditahan ${data.kuota_habis_menit} mnt` : ""}</div>
          {(data.kapal || []).map((k) => {
            const [lbl, col] = FR[k.freshness] || FR.none;
            const [slbl, scol] = ST[k.status] || ST.pending;
            const last = (k.percobaan_terakhir || [])[0];
            return (
              <div key={k.ident} style={box}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>{k.kapal || k.nama_di_ais || k.ident} <span style={{ fontWeight: 600, fontSize: 10.5, color: k.prio === "carrying" ? "#58a6ff" : "#8b949e" }}>{k.prio === "carrying" ? "● membawa kendaraan" : "○ berikutnya"}</span></b>
                  <span style={{ color: col, fontWeight: 700 }}>{lbl} · {umur(k.age_seconds)}</span>
                </div>
                <div style={{ color: "#8b949e", marginTop: 3 }}>MMSI {k.mmsi || "—"} · IMO {k.imo || "—"} · {k.jumlah_trip} trip{k.nama_di_ais && k.kapal && k.nama_di_ais.toLowerCase() !== k.kapal.toLowerCase() ? ` · nama di AIS: ${k.nama_di_ais}` : ""}</div>
                <div style={{ marginTop: 3 }}>Status: <b style={{ color: scol }}>{slbl}</b> · diperiksa {wkt(k.terakhir_diperiksa)}</div>
                {(k.masalah_identitas || []).map((m, i) => <div key={i} style={{ color: "#f0883e", marginTop: 3 }}>⚠ {m}</div>)}
                {last ? <div style={{ color: "#8b949e", marginTop: 3 }}>Refresh terakhir: {OUT[last.outcome] || last.outcome}{last.http ? ` (HTTP ${last.http})` : ""} · {wkt(last.at)}</div> : null}
              </div>
            );
          })}
          {(data.kapal || []).length === 0 && <div style={{ fontSize: 12, color: "#6b7681" }}>Tidak ada kapal yang dipantau (leg kapal belum selesai).</div>}
        </div>
      )}
    </div>
  );
}
