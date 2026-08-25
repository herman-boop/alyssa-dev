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
// Bukti Supabase kadang ke-serve dgn mime salah → blank. Lewatkan proxy backend.
const resolveUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) return u.includes("/storage/v1/object/public/") ? `${API}/media?u=${encodeURIComponent(u)}` : u;
  return BACKEND_URL + u;
};
const upNopol = (s) => (s || "").toUpperCase().trim();

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
  const [tab, setTab] = useState("home"); // home | report | sop | dokumen
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ unit_nopol: "", driver: "", status: "Dalam Perjalanan", lokasi: "", catatan: "", kendala: "" });
  const [flash, setFlash] = useState("");
  const [detailUnit, setDetailUnit] = useState(null); // unit terpilih → drill-down (P1)
  const [allReports, setAllReports] = useState(null);  // null = belum di-load; [] = kosong
  const [repBusy, setRepBusy] = useState(false);

  const load = () => axios.get(`${API}/public/rombongan/${token}`).then((r) => setData(r.data)).catch((e) => setErr(e?.response?.data?.detail || "Link tidak valid / dinonaktifkan"));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  // Ambil SEMUA report (histori lintas hari) sekali — buat drill-down per unit.
  const ensureReports = async () => {
    if (allReports !== null || repBusy) return;
    setRepBusy(true);
    try { const r = await axios.get(`${API}/public/rombongan/${token}/reports`); setAllReports(r.data.items || []); }
    catch { setAllReports([]); }
    finally { setRepBusy(false); }
  };
  const openDetail = (u) => { setDetailUnit(u); ensureReports(); };

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
      setAllReports(null); // reset histori → di-load ulang saat buka detail
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
        {[["home", "🏠 Home"], ["report", "📝 Report"], ["dokumen", "📄 Dokumen"], ["sop", "✅ SOP"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "11px 4px", border: "none", background: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800, color: tab === k ? C.gold : C.mute, borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent" }}>{l}</button>
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
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button onClick={() => openDetail(u)}
                        style={{ flex: 1, padding: "7px", borderRadius: 8, border: `1px solid ${C.line}`, background: "transparent", color: C.ink, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        🔎 Detail
                      </button>
                      <button onClick={() => { setForm((f) => ({ ...f, unit_nopol: u.nopol || "", driver: u.driver || "" })); setTab("report"); }}
                        style={{ flex: 1, padding: "7px", borderRadius: 8, border: `1px solid ${C.blue}`, background: "transparent", color: C.blue, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        📝 Report
                      </button>
                    </div>
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

        {tab === "dokumen" && (
          <DokumenTab bastk={handover.bastk || []} resi={handover.resi} dokumen={album.dokumen || []} />
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

      {detailUnit && (
        <UnitDetail
          unit={detailUnit}
          reports={(allReports || []).filter((r) => upNopol(r.unit_nopol) === upNopol(detailUnit.nopol))}
          loading={repBusy && allReports === null}
          onReport={() => { setForm((f) => ({ ...f, unit_nopol: detailUnit.nopol || "", driver: detailUnit.driver || "" })); setDetailUnit(null); setTab("report"); }}
          onClose={() => setDetailUnit(null)}
        />
      )}

      {flash && <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: C.navy, color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 700, zIndex: 50 }}>{flash}</div>}
      <div style={{ textAlign: "center", padding: "18px 16px 26px", fontSize: 10.5, color: C.mute }}>PT Alyssa Auto Logistik · Command Center Kepala Rombongan</div>
    </Shell>
  );
}

// Thumbnail bukti (buka penuh di tab baru lewat proxy media biar ga blank).
function Thumb({ url, catatan }) {
  const src = resolveUrl(url);
  const isImg = !/\.pdf($|\?)/i.test(url || "");
  return (
    <a href={src} target="_blank" rel="noreferrer" title={catatan || "Lihat"}
      style={{ display: "block", width: 64, height: 64, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.line}`, background: C.card2, flexShrink: 0, textDecoration: "none" }}>
      {isImg
        ? <img src={src} alt={catatan || "bukti"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📄</div>}
    </a>
  );
}

function DocRow({ label, ok, count, items }) {
  return (
    <div style={{ background: C.card2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: C.ink }}>{label}</div>
        <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20, whiteSpace: "nowrap",
          background: ok ? "#0d2818" : "#2a2410", color: ok ? C.green : C.amber }}>
          {ok ? `✓ Diterima${count ? ` · ${count}` : ""}` : "⏳ Belum"}
        </span>
      </div>
      {items && items.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {items.map((it, i) => <Thumb key={it.id || i} url={it.url} catatan={it.catatan} />)}
        </div>
      )}
    </div>
  );
}

function DokumenTab({ bastk, resi, dokumen }) {
  const resiItems = resi ? [resi] : [];
  const allBack = bastk.length > 0 && !!resi; // BASTK + Resi/PoD lengkap = dokumen inti kembali
  return (
    <>
      <SectionTitle>Dokumen Kembali</SectionTitle>
      <div style={{ background: allBack ? "#0d2818" : C.card2, border: `1px solid ${allBack ? C.green + "66" : C.line}`, borderRadius: 10, padding: "11px 13px", marginBottom: 12, fontSize: 12.5, fontWeight: 700, color: allBack ? C.green : C.amber }}>
        {allBack ? "✓ Dokumen inti sudah kembali (BASTK + Resi/PoD)" : "⏳ Dokumen inti belum lengkap"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <DocRow label="BASTK (Berita Acara Serah Terima)" ok={bastk.length > 0} count={bastk.length} items={bastk} />
        <DocRow label="Resi / PoD (Proof of Delivery)" ok={!!resi} count={resiItems.length} items={resiItems} />
        <DocRow label="Dokumen Tambahan" ok={dokumen.length > 0} count={dokumen.length} items={dokumen} />
      </div>
      <div style={{ fontSize: 11, color: C.mute, marginTop: 12, lineHeight: 1.5 }}>
        Bukti dokumen di-upload oleh petugas/driver lewat link tugas masing-masing. Halaman ini menampilkan statusnya secara read-only.
      </div>
    </>
  );
}

// Drill-down 1 unit: info unit + riwayat report lintas hari (P1).
function UnitDetail({ unit, reports, loading, onReport, onClose }) {
  const sorted = [...reports].sort((a, b) => String(b.submitted_at || "").localeCompare(String(a.submitted_at || "")));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(3,7,15,.72)", zIndex: 60, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", background: C.card, borderTop: `2px solid ${C.gold}`, borderRadius: "16px 16px 0 0", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 900, color: C.ink }}>{unit.nopol || "(tanpa nopol)"}</div>
            <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{unit.vehicle_type || "Unit"}{unit.no_rangka ? ` · Rangka ${unit.no_rangka}` : ""}</div>
            <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>Driver: <b style={{ color: C.ink }}>{unit.driver || "—"}</b></div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.card2, color: C.ink, fontSize: 15, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ margin: "14px 0 10px", fontSize: 12, fontWeight: 900, color: C.gold, textTransform: "uppercase", letterSpacing: .5 }}>
          Riwayat Report ({sorted.length})
        </div>

        {loading && <div style={{ color: C.mute, fontSize: 12, padding: 12, textAlign: "center" }}>Memuat riwayat…</div>}
        {!loading && sorted.length === 0 && <div style={{ color: C.mute, fontSize: 12, padding: 12, textAlign: "center" }}>Belum ada report untuk unit ini.</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((r, i) => (
            <div key={r.id || i} style={{ background: C.card2, border: `1px solid ${C.line}`, borderLeft: `3px solid ${r.late ? C.amber : C.green}`, borderRadius: 8, padding: "9px 11px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: C.ink }}>{fDate(r.tanggal)} · {r.submitted_hhmm || ""}</span>
                {r.late && <span style={{ fontSize: 10, fontWeight: 800, color: C.amber, background: "#2a2410", padding: "2px 7px", borderRadius: 20 }}>Telat</span>}
              </div>
              <div style={{ fontSize: 12, color: C.ink, marginTop: 4 }}>
                {r.status && <div>Status: <b>{r.status}</b></div>}
                {r.lokasi && <div style={{ color: C.mute }}>Lokasi: {r.lokasi}</div>}
                {r.catatan && <div style={{ color: C.mute }}>Catatan: {r.catatan}</div>}
                {r.kendala && <div style={{ color: C.amber }}>Kendala: {r.kendala}</div>}
              </div>
            </div>
          ))}
        </div>

        <button onClick={onReport} style={{ marginTop: 14, width: "100%", padding: "12px", borderRadius: 10, border: "none", background: C.gold, color: C.navy, fontWeight: 900, fontSize: 13.5, cursor: "pointer" }}>
          📝 Report Unit Ini
        </button>
      </div>
    </div>
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
