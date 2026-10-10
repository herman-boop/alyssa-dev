import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { Home, Camera, MapPin, FileText, Ship, Truck, ChevronRight, CheckCircle2, Circle } from "lucide-react";
import { CropModal, stampPhoto, reverseGeocode } from "./DriverCheckpoint";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/* Halaman petugas — logbook operasional (mobile, 1 tangan). Dibuka dari link
   tugas /task/{token}. Config-driven: tab/instruksi/checkpoint/dokumen nyesuaiin
   peran (driver asal/tujuan, petugas pelabuhan/kapal). Akses ter-scope: cuma
   data token ini (foto/checkpoint/dokumen dia). Nggak ada harga/HPP/leg lain. */
// Palet & gaya disamakan dengan halaman driver /trip (DriverCheckpoint → Beranda).
const C = {
  bg: "#0A0E1A", card: "#131A2C", line: "#1E293B", ink: "#F1F5F9", mute: "#94A3B8",
  blue: "#2563EB", blueSoft: "#60A5FA", green: "#166534", greenSoft: "#22C55E",
  gray: "#1E293B", red: "#f85149", chip: "#0C2D52",
};
const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";
const TAB_META = {
  beranda: { Icon: Home, label: "Beranda" },
  foto: { Icon: Camera, label: "Foto" },
  checkpoint: { Icon: MapPin, label: "Checkpoint" },
  dokumen: { Icon: FileText, label: "Dokumen" },
  scan: { Icon: FileText, label: "Scan" },
  info_kapal: { Icon: Ship, label: "Info Kapal" },
};

export default function TaskPage() {
  const token = (window.location.pathname.split("/task/")[1] || "").replace(/\/$/, "").split("?")[0];
  const [task, setTask] = useState(null);
  const [phase, setPhase] = useState("load"); // load | ok | error | disabled | notfound
  const [errMsg, setErrMsg] = useState("");
  const [tab, setTab] = useState("beranda");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [extra, setExtra] = useState({});
  const [cp, setCp] = useState(null);     // sheet checkpoint: {jenis, catatan, geo, alamat, file, previewUrl}
  const [scan, setScan] = useState(null); // {url, file, doc_type} → CropModal
  const [uploadErr, setUploadErr] = useState(""); // notif gagal upload foto (persisten, biar driver ga ngira kesimpen)
  const albumInput = useRef(null);
  const cpInput = useRef(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };
  // Checkpoint DRIVER wajib ada foto unit (supir mengira ikon kamera di "Tambah Checkpoint"
  // sudah memotret, padahal itu cuma membuka formulir → checkpoint tersimpan tanpa foto).
  const fotoWajib = /^driver/i.test((task && task.tipe_tugas) || "");

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/public/task/${token}`);
      setTask(r.data);
      setExtra(r.data.extra_inputs || {});
      setPhase("ok");
    } catch (e) {
      const s = e?.response?.status;
      if (s === 410) setPhase("disabled");
      else if (s === 404) setPhase("notfound");
      else { setErrMsg("Gagal memuat tugas. Coba muat ulang."); setPhase("error"); }
    }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const getGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });

  // ── Watermark WAJIB & seragam di SEMUA foto link driver ──
  // Setiap foto (album maupun checkpoint) selalu dicap: No. Pol unit + tanggal
  // (dd/mm/yyyy) + jam + lokasi (alamat/GPS). Head opsional = jenis checkpoint.
  const stampNopol = () => {
    const u = (task?.units || [])[0] || {};
    return u.nopol || u.no_rangka || "-";
  };
  const stampDateTime = () => {
    const now = new Date();
    const tgl = now.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
    const jam = now.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    return `${tgl} · ${jam}`;
  };
  const buildStampLines = (head, geo, alamat) => {
    const loc = (alamat && alamat !== "Lokasi tidak tersedia" && alamat !== "Lokasi terekam")
      ? alamat
      : (geo ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : "Lokasi GPS tidak aktif");
    const lines = [];
    if (head) lines.push(head);
    lines.push(`🚚 ${stampNopol()}`);
    lines.push(`📅 ${stampDateTime()}`);
    lines.push(`📍 ${loc}`);
    return lines;
  };

  /* ── ALBUM: 1 tombol kamera → langsung jepret → langsung upload ──
     INSTAN buat driver borongan: TANPA tanya catatan, TANPA blokir GPS.
     GPS best-effort: kalau aktif, lokasi ikut dicap; kalau tidak, foto tetap
     ter-upload (dicap "Lokasi GPS tidak aktif"). Cukup 1 klik. */
  const onAlbumPick = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setBusy(true); setUploadErr("");
    // Ambil GPS best-effort — JANGAN blokir upload kalau gagal/ditolak.
    let geo = null, alamat = "";
    try { geo = await getGeo(); } catch { geo = null; }
    if (geo) { try { alamat = await reverseGeocode(geo.lat, geo.lng); } catch { alamat = ""; } }
    let okc = 0, fail = 0, lastStatus = 0;
    for (const file of arr) {
      let up = file;
      try {
        up = await stampPhoto(file, buildStampLines("", geo, alamat));
      } catch { up = file; }
      try {
        const fd = new FormData();
        fd.append("foto", up);
        const r = await axios.post(`${API}/public/task/${token}/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        setTask(r.data); okc++;
      } catch (e) { fail++; lastStatus = e?.response?.status || lastStatus; }
    }
    setBusy(false);
    if (albumInput.current) albumInput.current.value = "";
    if (fail === 0) { flash(`✓ ${okc} foto masuk album`); return; }
    // Ada yang gagal → kasih notif JELAS & persisten (biar driver ga ngira kesimpen).
    const storageDown = lastStatus === 402 || lastStatus >= 500;
    setUploadErr(
      storageDown
        ? `❌ ${fail} foto GAGAL diupload — server penyimpanan foto lagi penuh/bermasalah. Foto BELUM tersimpan. Coba lagi nanti atau hubungi admin.`
        : `❌ ${fail} foto gagal diupload. Cek sinyal/koneksi lalu coba lagi.`
    );
    flash(okc ? `✓ ${okc} masuk · ⚠️ ${fail} gagal` : `❌ ${fail} foto gagal diupload`);
  };

  // Hapus 1 foto album (kalau salah upload) — dari task.photos + album trip.
  const delAlbumPhoto = async (p) => {
    if (!p?.id) return;
    if (!window.confirm("Hapus foto ini? Tidak bisa dikembalikan.")) return;
    setBusy(true);
    try {
      const r = await axios.delete(`${API}/public/task/${token}/upload/${p.id}`);
      setTask(r.data); flash("✓ Foto dihapus");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal hapus foto"); }
    setBusy(false);
  };

  /* ── CHECKPOINT: buka sheet → GPS+jam+kamera auto, catatan opsional → timeline ── */
  const openCheckpoint = async () => {
    setCp({ jenis: "", catatan: "", geo: null, alamat: "Mengambil lokasi…", file: null, previewUrl: null });
    const geo = await getGeo();
    let alamat = geo ? "" : "Lokasi tidak tersedia";
    if (geo) { try { alamat = await reverseGeocode(geo.lat, geo.lng); } catch { alamat = ""; } }
    setCp((c) => c ? { ...c, geo, alamat: alamat || (geo ? "Lokasi terekam" : "Lokasi tidak tersedia") } : c);
  };
  const cpPickFoto = (file) => {
    if (!file) return;
    setCp((c) => c ? { ...c, file, previewUrl: URL.createObjectURL(file) } : c);
  };
  const saveCheckpoint = async () => {
    if (!cp?.jenis) { flash("Pilih jenis checkpoint dulu"); return; }
    if (fotoWajib && !cp.file) { flash("📷 Foto unit WAJIB — tekan tombol “Ambil Foto Unit” dulu"); return; }
    // Petugas pelabuhan: GPS TIDAK wajib — cukup 1 foto jepret (di pelabuhan GPS
    // sering susah). Peran lain (driver): lokasi tetap wajib untuk tracking.
    const gpsOptional = /pelabuhan/i.test(task.tipe_tugas || "");
    let geo = cp.geo, alamat = cp.alamat;
    if (!geo) {
      flash("Mengambil lokasi GPS…");
      geo = await getGeo();
      if (geo) { try { alamat = await reverseGeocode(geo.lat, geo.lng); } catch {} setCp((c) => c ? { ...c, geo, alamat: alamat || "Lokasi terekam" } : c); }
    }
    if (!geo) {
      if (gpsOptional) {
        if (!cp.file) { flash("📷 Ambil foto dulu (lokasi GPS boleh kosong)"); return; }
        alamat = "Lokasi tidak tersedia";
      } else {
        flash("⚠️ Aktifkan izin Lokasi (GPS) dulu — lokasi WAJIB di checkpoint"); return;
      }
    }
    if (!cp.file && !window.confirm("Kirim checkpoint TANPA foto?\n\nOK = kirim tanpa foto\nBatal = kembali & ambil foto dulu")) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("jenis", cp.jenis);
      fd.append("catatan", cp.catatan || "");
      fd.append("alamat", alamat && alamat !== "Lokasi tidak tersedia" ? alamat : "");
      if (geo) { fd.append("lat", geo.lat); fd.append("lng", geo.lng); if (geo.acc != null) fd.append("acc", geo.acc); }
      if (cp.file) { let up = cp.file; try { up = await stampPhoto(cp.file, buildStampLines(cp.jenis, geo, alamat)); } catch {} fd.append("foto", up); }
      const r = await axios.post(`${API}/public/task/${token}/checkpoint`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTask(r.data); setCp(null);
      // Cek balasan server: kalau foto dikirim tapi checkpoint terbaru tak punya url → beri tahu jelas.
      const cps = (r.data && r.data.checkpoints) || [];
      const last = cps.length ? cps[cps.length - 1] : null;
      if (cp.file && last && !last.url) window.alert("⚠️ Checkpoint tersimpan, tapi FOTO-nya tidak ikut terkirim.\n\nUlangi checkpoint dengan foto, atau hubungi admin.");
      else flash(cp.file ? "✓ Checkpoint + foto tersimpan" : "✓ Checkpoint tersimpan (tanpa foto)");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan checkpoint"); }
    setBusy(false);
  };

  /* ── DOKUMEN: foto/scan → PDF (reuse CropModal) atau PDF langsung ── */
  const onDocPick = (doc_type, file) => {
    if (!file) return;
    if (file.type === "application/pdf") { uploadDoc(doc_type, file); return; }
    setScan({ url: URL.createObjectURL(file), file, doc_type }); // gambar → scan/crop dulu
  };
  const uploadDoc = async (doc_type, file) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("doc_type", doc_type); fd.append("berkas", file);
      const r = await axios.post(`${API}/public/task/${token}/document`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTask(r.data); flash("✓ Dokumen tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan dokumen"); }
    setBusy(false); setScan(null);
  };

  /* ── SIMPAN input (info kapal / penerima) + tandai selesai ── */
  const saveExtra = async (selesai) => {
    setBusy(true);
    try {
      const r = await axios.post(`${API}/public/task/${token}/submit`, { extra_inputs: extra, selesai });
      setTask(r.data); flash(selesai ? "✓ Tugas ditandai selesai" : "✓ Tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan"); }
    setBusy(false);
  };

  const wrap = { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: FONT, paddingBottom: "calc(env(safe-area-inset-bottom) + 110px)" };
  if (phase === "load") return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>Memuat tugas…</div>;
  if (phase === "notfound") return <Centered wrap={wrap} icon="🔗" title="Link tidak ditemukan" sub="Link tugas salah atau sudah dihapus." />;
  if (phase === "disabled") return <Centered wrap={wrap} icon="⛔" title="Link dinonaktifkan" sub="Hubungi admin PT Alyssa Auto Logistik." />;
  if (phase === "error") return <Centered wrap={wrap} icon="⚠️" title="Gagal memuat" sub={errMsg} />;

  const baseTabs = task.tabs && task.tabs.length ? task.tabs : ["foto", "checkpoint", "dokumen"];
  const ORDER = ["beranda", "checkpoint", "foto", "dokumen", "scan", "info_kapal"];
  const tabs = ["beranda", ...baseTabs].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  // Checklist & progres (sama seperti Beranda halaman driver); hanya dari data tugas ini.
  const steps = baseTabs.filter((k) => k !== "scan").map((k) => {
    const done = k === "foto" ? (task.photos || []).length > 0
      : k === "checkpoint" ? (task.checkpoints || []).length > 0
      : k === "dokumen" ? (task.documents || []).length > 0
      : k === "info_kapal" ? !!(extra.nama_kapal || task.kapal)
      : false;
    const label = { foto: "Foto Kendaraan", checkpoint: "Checkpoint", dokumen: "Dokumen", info_kapal: "Info Kapal" }[k] || k;
    return { key: k, label, done };
  });
  const selesai = task.status === "selesai";
  const doneCount = selesai ? steps.length : steps.filter((x) => x.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : (selesai ? 100 : 0);
  const nextStep = steps.find((x) => !x.done);
  const unit0 = (task.units || [])[0] || {};
  const bigBtn = { width: "100%", padding: "19px", borderRadius: 18, border: "none", background: C.blue, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", minHeight: 56, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, boxShadow: "0 10px 26px rgba(37,99,235,0.4)" };
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "Selamat Pagi" : hour < 15 ? "Selamat Siang" : hour < 18 ? "Selamat Sore" : "Selamat Malam";
  const who = String(task.petugas_nama || task.role_label || task.tipe_petugas || "Petugas").toUpperCase();
  const unitLabel = `${unit0.vehicle_type || "Kendaraan"} · ${unit0.nopol || unit0.no_rangka || "-"}`;
  const ruteLabel = `${task.asal || "—"}${task.tujuan ? ` → ${task.tujuan}` : ""}`;
  const chipBox = { width: 38, height: 38, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 20px 0" }}>
        {/* Sapaan */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 14, color: C.mute, fontWeight: 600 }}>{greeting},</div>
          <div style={{ fontSize: 27, fontWeight: 800, color: "#fff", marginTop: 2, letterSpacing: -0.3 }}>{who}</div>
        </div>
        {tab === "beranda" && (
          <div style={{ background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)", borderRadius: 24, padding: 24, marginBottom: 16, boxShadow: "0 10px 32px rgba(37,99,235,0.35)" }} data-testid="task-progress">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 }}>Progress Perjalanan</div>
                <div style={{ fontSize: 38, fontWeight: 900, color: "#fff", marginTop: 4, letterSpacing: -1 }}>{pct}%</div>
              </div>
              <div style={{ fontSize: 13, color: "#fff", fontWeight: 700, background: "rgba(255,255,255,0.18)", borderRadius: 12, padding: "7px 13px", whiteSpace: "nowrap" }}>{doneCount}/{steps.length} tugas</div>
            </div>
            <div style={{ marginTop: 18, height: 9, background: "rgba(255,255,255,0.22)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "#fff", borderRadius: 999, transition: "width .6s cubic-bezier(.4,0,.2,1)" }} />
            </div>
          </div>
        )}
        {/* Info rute & unit */}
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={chipBox}><MapPin size={19} color={C.blueSoft} /></div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#E2E8F0", lineHeight: 1.35 }}>{ruteLabel}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={chipBox}><Truck size={19} color={C.blueSoft} /></div>
            <div style={{ fontSize: 14, color: C.mute, fontWeight: 600 }}>{unitLabel}</div>
          </div>
        </div>
        {tab === "beranda" && (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginTop: 16 }} data-testid="task-checklist">
              <div style={{ fontSize: 12, fontWeight: 700, color: C.mute, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 16 }}>Checklist Tugas</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {steps.map((x) => (
                  <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {x.done || selesai ? <CheckCircle2 size={22} color="#22C55E" style={{ flexShrink: 0 }} /> : <Circle size={22} color="#475569" style={{ flexShrink: 0 }} />}
                    <div style={{ fontSize: 15, fontWeight: 600, color: x.done || selesai ? "#64748B" : "#E2E8F0", textDecoration: x.done || selesai ? "line-through" : "none" }}>{x.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => nextStep && setTab(nextStep.key)} disabled={!nextStep || selesai}
              style={{ width: "100%", marginTop: 16, padding: 19, borderRadius: 18, border: "none", background: (!nextStep || selesai) ? "#166534" : C.blue, color: "#fff", fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: (!nextStep || selesai) ? "default" : "pointer", boxShadow: (!nextStep || selesai) ? "none" : "0 10px 26px rgba(37,99,235,0.4)" }}
              data-testid="task-btn-lanjut">
              {(!nextStep || selesai) ? "Semua Tugas Selesai ✓" : `Lanjutkan: ${nextStep.label}`}
              {nextStep && !selesai && <ChevronRight size={20} />}
            </button>
          </>
        )}
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: "16px 20px 14px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── TAB FOTO ── */}
        {tab === "foto" && (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 18 }}>
              <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginBottom: 6 }}>Foto yang harus diambil:</div>
              <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.7 }}>
                {(task.foto_instruksi || []).map((s, i) => <div key={i}>• {s}</div>)}
              </div>
            </div>
            {uploadErr && (
              <div style={{ background: "#2d1214", border: `1px solid ${C.red}`, borderRadius: 12, padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-start" }}>
                <div style={{ flex: 1, fontSize: 13, color: "#ffb4ab", fontWeight: 700, lineHeight: 1.45 }}>{uploadErr}</div>
                <button onClick={() => setUploadErr("")} style={{ background: "none", border: "none", color: "#ffb4ab", fontSize: 16, cursor: "pointer", lineHeight: 1, flexShrink: 0 }} aria-label="Tutup">✕</button>
              </div>
            )}
            <input ref={albumInput} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => onAlbumPick(e.target.files)} />
            <button
              style={{ ...bigBtn, flexDirection: "column", gap: 4, padding: "20px 16px", minHeight: 92, fontSize: 19, lineHeight: 1.2 }}
              disabled={busy} onClick={() => albumInput.current?.click()} data-testid="btn-ambil-foto">
              <span style={{ fontSize: 34, lineHeight: 1 }}>📷</span>
              <span>{busy ? "Mengupload..." : "PENCET DI SINI UNTUK FOTO"}</span>
              {!busy && <span style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.9 }}>Buka kamera HP, lalu foto kendaraan</span>}
            </button>
            <div className="keep-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {(task.photos || []).slice().reverse().map((p) => (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ position: "relative" }}>
                    <SafeImg src={resolveUrl(p.url)} style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover", border: `1px solid ${C.line}` }} />
                    <button onClick={() => delAlbumPhoto(p)} disabled={busy} title="Hapus foto"
                      style={{ position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 7, border: "none", background: "rgba(180,30,30,.92)", color: "#fff", fontSize: 13, cursor: "pointer", lineHeight: 1 }}>🗑</button>
                  </div>
                  {p.catatan && <div style={{ fontSize: 10, color: C.ink, lineHeight: 1.3, wordBreak: "break-word" }} title={p.catatan}>📝 {p.catatan}</div>}
                </div>
              ))}
            </div>
            {(task.photos || []).length === 0 && <div style={{ textAlign: "center", color: C.mute, fontSize: 12, padding: 8 }}>Belum ada foto.</div>}
          </>
        )}

        {/* ── TAB CHECKPOINT (timeline) ── */}
        {tab === "checkpoint" && (
          <>
            <button style={bigBtn} disabled={busy} onClick={openCheckpoint}>📷 Tambah Checkpoint</button>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(task.checkpoints || []).slice().reverse().map((c) => (
                <div key={c.checkpoint_id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 14, display: "flex", gap: 12 }}>
                  {c.url && <SafeImg src={resolveUrl(c.url)} style={{ width: 54, height: 54, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: `1px solid ${C.line}` }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>{c.jenis}</div>
                    <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{c.ts ? new Date(c.ts).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</div>
                    {c.alamat && <div style={{ fontSize: 11.5, color: C.ink, marginTop: 2 }}>{c.alamat}</div>}
                    {c.catatan && <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{c.catatan}</div>}
                    {c.lat != null && c.lng != null
                      ? <a href={`https://www.google.com/maps?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.blueSoft, marginTop: 3, display: "inline-block" }}>📍 Lihat Map</a>
                      : <div style={{ fontSize: 11, color: C.mute, marginTop: 3 }}>📍 Lokasi tidak tersedia</div>}
                  </div>
                </div>
              ))}
              {(task.checkpoints || []).length === 0 && <div style={{ textAlign: "center", color: C.mute, fontSize: 12, padding: 8 }}>Belum ada checkpoint.</div>}
            </div>
          </>
        )}

        {/* ── TAB DOKUMEN / SCAN ── */}
        {(tab === "dokumen" || tab === "scan") && (
          <>
            <Section C={C} title="Upload / Scan Dokumen">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(task.allowed_document_types || []).map((dt) => (
                  <DocButton key={dt} C={C} label={dt} busy={busy} onPick={(f) => onDocPick(dt, f)} />
                ))}
                {(task.allowed_document_types || []).length === 0 && <div style={{ fontSize: 12, color: C.mute }}>Tidak ada dokumen untuk tugas ini.</div>}
              </div>
              {(task.documents || []).length > 0 && (
                <div className="keep-grid" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                  {(task.documents || []).slice().reverse().map((d) => (
                    <a key={d.id} href={resolveUrl(d.url)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                      <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, border: `1px solid ${C.line}`, background: "#0d1117", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: C.mute, fontSize: 10, padding: 4, textAlign: "center" }}>
                        <div style={{ fontSize: 22 }}>📄</div>{d.doc_type}
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </Section>

            {task.needs_penerima && (
              <Section C={C} title="Serah Terima Penerima">
                <Field C={C} label="Nama Penerima" value={extra.penerima_nama || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_nama: v }))} />
                <Field C={C} label="No. HP Penerima" value={extra.penerima_hp || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_hp: v }))} />
                <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, margin: "4px 0 6px" }}>Tanda Tangan Penerima</div>
                <SignaturePad C={C} value={extra.penerima_ttd || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_ttd: v }))} />
                <button onClick={() => saveExtra(false)} disabled={busy} style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 48 }}>💾 Simpan Data Penerima</button>
              </Section>
            )}
          </>
        )}

        {/* ── TAB INFO KAPAL ── */}
        {tab === "info_kapal" && (
          <Section C={C} title="Informasi Kapal">
            <Field C={C} label="Nama Kapal" value={extra.nama_kapal || task.kapal || ""} onChange={(v) => setExtra((x) => ({ ...x, nama_kapal: v }))} />
            <Field C={C} label="Nomor Voyage" value={extra.voyage || task.voyage || ""} onChange={(v) => setExtra((x) => ({ ...x, voyage: v }))} />
            <Field C={C} label="Pelabuhan Asal" value={extra.pel_asal || task.asal || ""} onChange={(v) => setExtra((x) => ({ ...x, pel_asal: v }))} />
            <Field C={C} label="Pelabuhan Tujuan" value={extra.pel_tujuan || task.tujuan || ""} onChange={(v) => setExtra((x) => ({ ...x, pel_tujuan: v }))} />
            <Field C={C} label="Estimasi Berangkat" type="date" value={extra.etd || ""} onChange={(v) => setExtra((x) => ({ ...x, etd: v }))} />
            <Field C={C} label="Estimasi Tiba" type="date" value={extra.eta || ""} onChange={(v) => setExtra((x) => ({ ...x, eta: v }))} />
            <button onClick={() => saveExtra(false)} disabled={busy} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 48 }}>💾 Simpan Info Kapal</button>
          </Section>
        )}

        {/* Selesai */}
        <button onClick={() => saveExtra(true)} disabled={busy || task.status === "selesai"}
          style={{ width: "100%", padding: 19, borderRadius: 18, border: "none", background: task.status === "selesai" ? C.green : "#16a34a", color: "#fff", fontWeight: 900, fontSize: 16, cursor: "pointer", minHeight: 56 }}>
          {task.status === "selesai" ? "✅ Tugas Selesai" : "✅ Tandai Tugas Selesai"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: C.mute, padding: "4px 0 20px" }}>PT Alyssa Auto Logistik · Logbook Operasional</div>
      </div>


      {/* Menu bawah (sama dengan halaman driver) */}
      <nav style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 500, maxWidth: 560, margin: "0 auto", background: "rgba(15,20,35,0.92)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 8px calc(10px + env(safe-area-inset-bottom))" }} data-testid="task-bottom-nav">
        {tabs.map((k) => {
          const m = TAB_META[k] || { Icon: FileText, label: k };
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} data-testid={`task-nav-${k}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: "6px 16px", borderRadius: 14, minWidth: 64, color: on ? C.blueSoft : "#64748B", transition: "color .2s ease" }}>
              <m.Icon size={22} strokeWidth={on ? 2.5 : 2} />
              <span style={{ fontSize: 11, fontWeight: on ? 700 : 600 }}>{m.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Sheet checkpoint */}
      {cp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 600, display: "flex", alignItems: "flex-end" }} onClick={() => !busy && setCp(null)}>
          <div style={{ width: "100%", maxWidth: 560, margin: "0 auto", background: C.card, borderRadius: "16px 16px 0 0", padding: 16, paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📍 Tambah Checkpoint</div>
            <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>{cp.alamat || "Mengambil lokasi…"}{cp.geo ? ` · ${cp.geo.lat.toFixed(5)}, ${cp.geo.lng.toFixed(5)}` : ""}</div>
            <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginBottom: 6 }}>Jenis checkpoint</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {(task.allowed_checkpoint_types || []).map((j) => (
                <button key={j} onClick={() => { setCp((c) => ({ ...c, jenis: j })); if (fotoWajib && !cp.file) cpInput.current?.click(); }} style={{ padding: "9px 12px", borderRadius: 20, border: `1px solid ${cp.jenis === j ? C.blue : C.line}`, background: cp.jenis === j ? C.blue : "none", color: cp.jenis === j ? "#fff" : C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 40 }}>{j}</button>
              ))}
            </div>
            <input ref={cpInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => cpPickFoto(e.target.files?.[0])} />
            {fotoWajib && !cp.previewUrl && <div style={{ fontSize: 12, color: C.mute, marginBottom: 6 }}>Foto unit WAJIB di setiap checkpoint (lokasi & jam otomatis ikut tercap di foto).</div>}
            <button onClick={() => cpInput.current?.click()} style={{ width: "100%", padding: 12, borderRadius: 10, border: `${fotoWajib && !cp.previewUrl ? 2 : 1}px solid ${fotoWajib && !cp.previewUrl ? C.blue : C.line}`, background: fotoWajib && !cp.previewUrl ? "rgba(88,166,255,.12)" : "none", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 48, marginBottom: 8 }}>{cp.previewUrl ? "✓ Foto siap · ganti" : (fotoWajib ? "📷 Ambil Foto Unit (wajib)" : "📷 Tambah Foto (opsional)")}</button>
            {cp.previewUrl && <img src={cp.previewUrl} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
            <textarea value={cp.catatan} onChange={(e) => setCp((c) => ({ ...c, catatan: e.target.value }))} placeholder="Catatan (opsional)" style={{ width: "100%", background: "#0d1117", border: `1px solid ${C.line}`, borderRadius: 8, padding: "11px 12px", color: C.ink, fontSize: 15, outline: "none", boxSizing: "border-box", minHeight: 56, resize: "vertical", marginBottom: 12, fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCp(null)} disabled={busy} style={{ flex: 1, padding: 14, borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.mute, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 52 }}>Batal</button>
              <button onClick={saveCheckpoint} disabled={busy} style={{ flex: 2, padding: 14, borderRadius: 10, border: "none", background: C.greenSoft, color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", minHeight: 52, opacity: fotoWajib && !cp.file ? 0.5 : 1 }}>{busy ? "Menyimpan…" : "Simpan Checkpoint"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Scan dokumen (reuse CropModal existing) */}
      {scan && (
        <CropModal url={scan.url} file={scan.file} onCancel={() => setScan(null)} onConfirm={(pdfFile) => uploadDoc(scan.doc_type, pdfFile)} />
      )}

      {toast && <div style={{ position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)", background: "#1c2128", color: C.ink, padding: "10px 18px", borderRadius: 24, fontSize: 13, fontWeight: 700, border: `1px solid ${C.line}`, zIndex: 100 }}>{toast}</div>}
    </div>
  );
}

function DocButton({ C, label, busy, onPick }) {
  const ref = useRef(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: "none" }} onChange={(e) => { onPick(e.target.files?.[0]); if (ref.current) ref.current.value = ""; }} />
      <button disabled={busy} onClick={() => ref.current?.click()} style={{ width: "100%", padding: "13px 14px", borderRadius: 10, border: `1px solid ${C.line}`, background: "#0d1117", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 50, textAlign: "left" }}>📄 {label}</button>
    </>
  );
}

function resolveUrl(u) {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) {
    // Bukti/foto Supabase kadang ke-serve dgn mime salah → blank. Lewatkan proxy backend.
    if (u.includes("/storage/v1/object/public/")) return `${API}/media?u=${encodeURIComponent(u)}`;
    return u;
  }
  return `${BACKEND_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

/* Thumbnail tahan-banting: kalau foto gagal dimuat (storage down/402),
   tampilkan placeholder jelas, BUKAN ikon gambar rusak yang bikin bingung. */
function SafeImg({ src, style }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div style={{ ...style, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0d1117", color: "#8b949e", fontSize: 9, textAlign: "center", padding: 4, boxSizing: "border-box" }}>
        <span style={{ fontSize: 16 }}>⚠️</span>
        <span style={{ marginTop: 2 }}>foto gagal dimuat</span>
      </div>
    );
  }
  return <img src={src} alt="" style={style} onError={() => setErr(true)} />;
}

/* Tanda tangan penerima — canvas gambar (touch/mouse), simpan sebagai data URL. */
function SignaturePad({ C, value, onChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);

  const pos = (e) => {
    const cv = canvasRef.current; const r = cv.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (cv.width / r.width), y: (t.clientY - r.top) * (cv.height / r.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return; e.preventDefault();
    const cv = canvasRef.current; const ctx = cv.getContext("2d"); const p = pos(e);
    ctx.strokeStyle = "#0d1117"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };
  const end = () => { if (!drawing.current) return; drawing.current = false; try { onChange(canvasRef.current.toDataURL("image/png")); } catch {} };
  const clear = () => { const cv = canvasRef.current; cv.getContext("2d").clearRect(0, 0, cv.width, cv.height); onChange(""); };

  return (
    <div>
      <canvas ref={canvasRef} width={600} height={200}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{ width: "100%", height: 140, background: "#fff", borderRadius: 8, border: `1px solid ${C.line}`, touchAction: "none" }} />
      <button type="button" onClick={clear} style={{ marginTop: 6, padding: "6px 12px", borderRadius: 7, border: `1px solid ${C.line}`, background: "none", color: C.mute, fontSize: 12, cursor: "pointer" }}>🗑 Hapus tanda tangan</button>
    </div>
  );
}

function Section({ C, title, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 18 }}>
      <div style={{ fontSize: 11, color: C.mute, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Field({ C, label, value, onChange, type = "text", textarea }) {
  const st = { width: "100%", background: "#0d1117", border: `1px solid ${C.line}`, borderRadius: 8, padding: "11px 12px", color: C.ink, fontSize: 15, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ display: "block", fontSize: 11, color: C.mute, marginBottom: 4, fontWeight: 700 }}>{label}</span>
      {textarea
        ? <textarea style={{ ...st, minHeight: 60, resize: "vertical" }} value={value} onChange={(e) => onChange(e.target.value)} />
        : <input type={type} style={st} value={value} onChange={(e) => onChange(e.target.value)} />}
    </label>
  );
}

function Centered({ wrap, icon, title, sub }) {
  return (
    <div style={{ ...wrap, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
      <div style={{ fontSize: 44, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "#8b949e", maxWidth: 300 }}>{sub}</div>
    </div>
  );
}
