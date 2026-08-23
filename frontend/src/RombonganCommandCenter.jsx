/* eslint-disable */
// Command Center Kepala Rombongan — 1 link assignment-level (Fase 2, P0).
// Read-only operasional + Daily Report. TANPA data finansial. Mobile-first.
import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const C = {
  bg: "#0b1220", card: "#121a2b", card2: "#0e1626", line: "#1e2b45", ink: "#e8eefc",
  mute: "#8ea0c4", gold: "#e8c98a", navy: "#0f2a5c", green: "#3fb950", amber: "#e6b450", red: "#f87171", blue: "#5b9dff",
};
const fDate = (s) => { if (!s) return "—"; const d = String(s).slice(0, 10).split("-"); return d.length === 3 ? `${d[2]}/${d[1]}/${d[0]}` : s; };

// SOP per fase — checklist visual (statis, P1 tapi ringan)
const SOP = [
  { fase: "ASAL", items: ["Cek kendaraan", "Foto 4 sisi", "Foto speedometer/odometer", "Foto ban serep", "Foto lokasi dokumen", "Scan BASTK awal", "Serah terima pihak asal", "Checkpoint keberangkatan"] },
  { fase: "PERJALANAN", items: ["Update checkpoint harian", "Foto kondisi kendaraan", "Laporkan kendala", "Update posisi"] },
  { fase: "PELABUHAN / KAPAL", items: ["Foto masuk pelabuhan", "Foto kendaraan di area pelabuhan", "Foto kendaraan naik kapal", "Input nama kapal/voyage (bila ada)"] },
  { fase: "TUJUAN", items: ["Foto 4 sisi", "Foto speedometer/odometer", "Scan BASTK akhir", "Foto serah terima", "Nama + HP penerima", "Tanda tangan penerima"] },
  { fase: "DOKUMEN KEMBALI", items: ["BASTK", "Surat Jalan", "PoD", "Dokumen tambahan", "Status dokumen diterima kantor"] },
];
const PHASES = ["ASAL", "PERJALANAN", "TRANSIT/KAPAL", "TUJUAN", "DOKUMEN KEMBALI"];

export default function RombonganCommandCenter() {
  const token = useMemo(() => window.location.pathname.replace(/^\/rombongan\//, "").split("?")[0].replace(/\/$/, ""), []);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("home"); // home | sop | report
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unit_nopol: "", driver: "", status: "Dalam Perjalanan", lokasi: "", catatan: "", kendala: "" });
  const [flash, setFlash] = useState("");

  const load = () => axios.get(`${API}/public/rombongan/${token}`).then((r) => setData(r.data)).catch((e) => setErr(e?.response?.data?.detail || "Link tidak valid / dinonaktifkan"));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  if (err) return <Shell><div style={{ padding: 30, textAlign: "center", color: C.red, fontWeight: 700 }}>{err}</div></Shell>;
  if (!data) return <Shell><div style={{ padding: 30, textAlign: "center", color: C.mute }}>Memuat Command Center…</div></Shell>;

  const units = data.units || [];
  const legs = data.legs || [];
  const album = data.album || {};
  const handover = data.handover || {};
  const repToday = data.reports_today || [];
  const jamClose = data.jam_close || "20:00";
  const nowHHMM = (data.server_wib || "").slice(11, 16);
  const reportedNopol = new Set(repToday.map((r) => (r.unit_nopol || "").toUpperCase()));
  const belumReport = units.filter((u) => !reportedNopol.has((u.nopol || "").toUpperCase()));
  const sudahSampai = units.filter((u) => /sampai|tiba|selesai/i.test(u.status || "")).length;
  const dalamJalan = units.filter((u) => /jalan|berangkat|transit|kapal/i.test(u.status || "")).length;
  const docReturned = (handover.bastk || []).length > 0 || (album.dokumen || []).length > 0;

  // progress perjalanan (coarse, dari album/checkpoint)
  const done = {
    "ASAL": (album.asal || []).length > 0 || (data.daily_checkpoints || []).length > 0,
    "PERJALANAN": (data.daily_checkpoints || []).length > 0,
    "TRANSIT/KAPAL": (album.kapal || []).length > 0,
    "TUJUAN": (album.tujuan || []).length > 0,
    "DOKUMEN KEMBALI": docReturned,
  };
  const curPhaseIdx = Math.max(0, PHASES.map((p) => done[p]).lastIndexOf(true));

  const reportLate = repToday.length > 0 && repToday.some((r) => r.late);
  const semuaReport = units.length > 0 && belumReport.length === 0;
  const lewatClose = nowHHMM && nowHHMM > jamClose;

  const submitReport = async () => {
    if (!form.unit_nopol) { setFlash("Pilih unit dulu"); setTimeout(() => setFlash(""), 2000); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/public/rombongan/${token}/report`, form);
      setFlash(r.data?.late ? "✓ Report tersimpan (Terlambat)" : "✓ Report tersimpan");
      setForm({ unit_nopol: "", driver: "", status: "Dalam Perjalanan", lokasi: "", catatan: "", kendala: "" });
      await load(); setTab("home");
    } catch (e) { setFlash(e?.response?.data?.detail || "Gagal simpan report"); }
    finally { setBusy(false); setTimeout(() => setFlash(""), 2500); }
  };

  const Card = ({ label, val, color }) => (
    <div style={{ background: C.card2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", flex: 1, minWidth: 90 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: color || C.ink, lineHeight: 1 }}>{val}</div>
      <div style={{ fontSize: 10.5, color: C.mute, marginTop: 4, textTransform: "uppercase", letterSpacing: .3 }}>{label}</div>
    </div>
  );

  return (
    <Shell>
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.line}`, background: `linear-gradient(180deg, ${C.navy}, ${C.card})` }}>
        <div style={{ fontSize: 10.5, color: C.gold, fontWeight: 800, letterSpacing: .8, textTransform: "uppercase" }}>PT Alyssa Auto Logistik</div>
        <div style={{ fontSize: 17, fontWeight: 900, color: "#fff", marginTop: 2 }}>Command Center Kepala Rombongan</div>
        <div style={{ fontSize: 13, color: C.ink, marginTop: 6 }}>Nama: <b style={{ color: "#fff" }}>{data.kepala?.nama || "—"}</b></div>
        <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{data.rute}</div>
        <div style={{ fontSize: 12, color: C.ink, marginTop: 8, fontWeight: 700 }}>
          {units.length} Unit · <span style={{ color: C.green }}>{sudahSampai} Sampai</span> · <span style={{ color: C.blue }}>{dalamJalan} Jalan</span> · <span style={{ color: C.amber }}>{belumReport.length} Perlu Update</span>
        </div>
      </div>

      {/* Progress perjalanan besar */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.line}`, overflowX: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", minWidth: "max-content", gap: 4 }}>
          {PHASES.map((p, i) => (
            <div key={p} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 26, height: 26, borderRadius: "50%", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 900,
                  background: i <= curPhaseIdx ? C.gold : C.card2, color: i <= curPhaseIdx ? C.navy : C.mute, border: `1px solid ${i <= curPhaseIdx ? C.gold : C.line}` }}>{i <= curPhaseIdx ? "✓" : i + 1}</div>
                <div style={{ fontSize: 8.5, color: i <= curPhaseIdx ? C.ink : C.mute, marginTop: 3, maxWidth: 62 }}>{p}</div>
              </div>
              {i < PHASES.length - 1 && <div style={{ width: 20, height: 2, background: i < curPhaseIdx ? C.gold : C.line }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Jam close banner */}
      <div style={{ padding: "10px 16px", background: semuaReport ? "#0d2818" : lewatClose ? "#2d1214" : C.card2, borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: C.mute }}>Jam close report: <b style={{ color: C.ink }}>{jamClose} WIB</b></span>
        <span style={{ fontSize: 12, fontWeight: 800, color: semuaReport ? C.green : lewatClose ? C.red : C.amber }}>
          {semuaReport ? "✓ Report Hari Ini Selesai" : lewatClose ? "⚠ TERLAMBAT REPORT" : `Report: ${units.length - belumReport.length}/${units.length}`}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, background: C.bg, zIndex: 2 }}>
        {[["home", "🏠 Home"], ["report", "📝 Report Hari Ini"], ["sop", "✅ SOP Kerja"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "11px 6px", border: "none", background: "none", cursor: "pointer", fontSize: 12, fontWeight: 800, color: tab === k ? C.gold : C.mute, borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent" }}>{l}</button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {tab === "home" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <Card label="Total Unit" val={units.length} />
              <Card label="Dalam Perjalanan" val={dalamJalan} color={C.blue} />
              <Card label="Sudah Sampai" val={sudahSampai} color={C.green} />
              <Card label="Perlu Update" val={belumReport.length} color={C.amber} />
              <Card label="Dok. Belum Kembali" val={docReturned ? 0 : "—"} color={docReturned ? C.green : C.amber} />
            </div>

            <SectionTitle>Tugas Hari Ini</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
              {belumReport.length > 0 && <Alert c={C.amber}>⚠ {belumReport.length} unit belum report hari ini</Alert>}
              {!docReturned && <Alert c={C.amber}>⚠ Dokumen belum dikembalikan</Alert>}
              {semuaReport && <Alert c={C.green}>✓ Semua unit sudah report hari ini</Alert>}
              {belumReport.length === 0 && docReturned && <Alert c={C.green}>✓ Semua tugas hari ini lengkap</Alert>}
            </div>

            <SectionTitle>Unit Rombongan ({units.length})</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {units.map((u, i) => {
                const rep = repToday.find((r) => (r.unit_nopol || "").toUpperCase() === (u.nopol || "").toUpperCase());
                return (
                  <div key={i} style={{ background: C.card2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{u.nopol || "(tanpa nopol)"} <span style={{ color: C.mute, fontWeight: 500, fontSize: 12 }}>· {u.vehicle_type || "Unit"}</span></div>
                        <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>Driver: {u.driver || "—"}</div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap",
                        background: rep ? (rep.late ? "#2a2410" : "#0d2818") : "#2a2410", color: rep ? (rep.late ? C.amber : C.green) : C.amber }}>
                        {rep ? (rep.late ? "⚠ Report Telat" : "✓ Sudah Report") : "Belum Report"}
                      </span>
                    </div>
                    {rep && (rep.lokasi || rep.status || rep.kendala) && (
                      <div style={{ fontSize: 11, color: C.mute, marginTop: 6, borderTop: `1px solid ${C.line}`, paddingTop: 6 }}>
                        {rep.status && <span>Status: <b style={{ color: C.ink }}>{rep.status}</b> · </span>}
                        {rep.lokasi && <span>Lokasi: {rep.lokasi} · </span>}
                        {rep.kendala && <span style={{ color: C.amber }}>Kendala: {rep.kendala}</span>}
                        <span style={{ display: "block", marginTop: 2, color: C.mute }}>jam {rep.submitted_hhmm || ""}</span>
                      </div>
                    )}
                    <button onClick={() => { setForm((f) => ({ ...f, unit_nopol: u.nopol || "", driver: u.driver || "" })); setTab("report"); }}
                      style={{ marginTop: 8, width: "100%", padding: "7px", borderRadius: 8, border: `1px solid ${C.blue}`, background: "transparent", color: C.blue, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      📝 Report unit ini
                    </button>
                  </div>
                );
              })}
              {units.length === 0 && <div style={{ color: C.mute, fontSize: 12, textAlign: "center", padding: 16 }}>Belum ada unit.</div>}
            </div>
          </>
        )}

        {tab === "report" && (
          <>
            <SectionTitle>Report Hari Ini</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Field label="Unit / Nopol">
                <select style={INP} value={form.unit_nopol} onChange={(e) => { const u = units.find((x) => x.nopol === e.target.value); setForm((f) => ({ ...f, unit_nopol: e.target.value, driver: u?.driver || f.driver })); }}>
                  <option value="">— Pilih unit —</option>
                  {units.map((u, i) => <option key={i} value={u.nopol}>{u.nopol || "(tanpa nopol)"} · {u.vehicle_type || ""}</option>)}
                </select>
              </Field>
              <Field label="Driver"><input style={INP} value={form.driver} onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))} placeholder="Nama driver" /></Field>
              <Field label="Status">
                <select style={INP} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  {["Persiapan / Asal", "Dalam Perjalanan", "Transit / Pelabuhan", "Naik Kapal", "Sudah Sampai", "Serah Terima Selesai"].map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Lokasi Saat Ini"><input style={INP} value={form.lokasi} onChange={(e) => setForm((f) => ({ ...f, lokasi: e.target.value }))} placeholder="mis. Rest area KM 120 / Pelabuhan Bitung" /></Field>
              <Field label="Catatan"><textarea style={{ ...INP, minHeight: 60 }} value={form.catatan} onChange={(e) => setForm((f) => ({ ...f, catatan: e.target.value }))} placeholder="Update kondisi / progres" /></Field>
              <Field label="Kendala (kalau ada)"><textarea style={{ ...INP, minHeight: 50 }} value={form.kendala} onChange={(e) => setForm((f) => ({ ...f, kendala: e.target.value }))} placeholder="mis. macet, cuaca, kerusakan" /></Field>
              <div style={{ fontSize: 11, color: C.mute }}>Jam close {jamClose} WIB. Lewat jam itu report tetap bisa disimpan tapi ditandai <b style={{ color: C.amber }}>Terlambat</b>.</div>
              <button onClick={submitReport} disabled={busy} style={{ padding: "13px", borderRadius: 10, border: "none", background: C.gold, color: C.navy, fontWeight: 900, fontSize: 14, cursor: "pointer" }}>{busy ? "Menyimpan…" : "Simpan Report Hari Ini"}</button>
            </div>
          </>
        )}

        {tab === "sop" && (
          <>
            <SectionTitle>SOP Kerja (per fase)</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {SOP.map((s) => (
                <div key={s.fase} style={{ background: C.card2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: C.gold, marginBottom: 8, letterSpacing: .5 }}>{s.fase}</div>
                  {s.items.map((it, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12.5, color: C.ink }}>
                      <span style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid ${C.mute}`, flexShrink: 0 }} />{it}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {flash && <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: C.navy, color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, zIndex: 50 }}>{flash}</div>}
      <div style={{ textAlign: "center", padding: "18px 16px 26px", fontSize: 10.5, color: C.mute }}>PT Alyssa Auto Logistik · Command Center Kepala Rombongan</div>
    </Shell>
  );
}

const INP = { width: "100%", boxSizing: "border-box", background: "#0b1220", border: "1px solid #26365a", borderRadius: 9, padding: "11px 12px", color: "#e8eefc", fontSize: 14, outline: "none", fontFamily: "inherit" };
function Field({ label, children }) { return <label style={{ display: "block" }}><div style={{ fontSize: 11, color: "#8ea0c4", fontWeight: 700, marginBottom: 4, textTransform: "uppercase", letterSpacing: .3 }}>{label}</div>{children}</label>; }
function SectionTitle({ children }) { return <div style={{ fontSize: 12, fontWeight: 900, color: "#e8c98a", textTransform: "uppercase", letterSpacing: .5, margin: "4px 0 10px" }}>{children}</div>; }
function Alert({ c, children }) { return <div style={{ background: "#0e1626", border: `1px solid ${c}44`, borderLeft: `3px solid ${c}`, borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "#e8eefc" }}>{children}</div>; }
function Shell({ children }) {
  return <div style={{ minHeight: "100vh", background: "#0b1220", color: "#e8eefc", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
    <div style={{ maxWidth: 480, margin: "0 auto", background: "#0b1220", minHeight: "100vh" }}>{children}</div>
  </div>;
}
