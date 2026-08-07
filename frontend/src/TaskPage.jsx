import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { CropModal, stampPhoto, reverseGeocode } from "./DriverCheckpoint";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/* Halaman petugas — logbook operasional (mobile, 1 tangan). Dibuka dari link
   tugas /task/{token}. Config-driven: tab/instruksi/checkpoint/dokumen nyesuaiin
   peran (driver asal/tujuan, petugas pelabuhan/kapal). Akses ter-scope: cuma
   data token ini (foto/checkpoint/dokumen dia). Nggak ada harga/HPP/leg lain. */
const C = {
  bg: "#0d1117", card: "#161b22", line: "#21262d", ink: "#e6edf3", mute: "#8b949e",
  blue: "#1f6feb", blueSoft: "#58a6ff", green: "#238636", greenSoft: "#3fb950",
  gray: "#21262d", red: "#f85149",
};
const TAB_META = {
  foto: { icon: "📷", label: "Foto" },
  checkpoint: { icon: "📍", label: "Checkpoint" },
  dokumen: { icon: "📄", label: "Dokumen" },
  scan: { icon: "📄", label: "Scan" },
  info_kapal: { icon: "🚢", label: "Info Kapal" },
};

export default function TaskPage() {
  const token = (window.location.pathname.split("/task/")[1] || "").replace(/\/$/, "").split("?")[0];
  const [task, setTask] = useState(null);
  const [phase, setPhase] = useState("load"); // load | ok | error | disabled | notfound
  const [errMsg, setErrMsg] = useState("");
  const [tab, setTab] = useState("foto");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [extra, setExtra] = useState({});
  const [cp, setCp] = useState(null);     // sheet checkpoint: {jenis, catatan, geo, alamat, file, previewUrl}
  const [scan, setScan] = useState(null); // {url, file, doc_type} → CropModal
  const albumInput = useRef(null);
  const cpInput = useRef(null);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/public/task/${token}`);
      setTask(r.data);
      setExtra(r.data.extra_inputs || {});
      setTab((r.data.tabs && r.data.tabs[0]) || "foto");
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
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  /* ── ALBUM: 1 tombol kamera → semua foto masuk album (geotag) ── */
  const onAlbumPick = async (files) => {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    setBusy(true);
    const geo = await getGeo();
    let okc = 0;
    for (const file of arr) {
      let up = file;
      try {
        const lines = [new Date().toLocaleString("id-ID"), geo ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : "Lokasi tidak tersedia"];
        up = await stampPhoto(file, lines);
      } catch { up = file; }
      try {
        const fd = new FormData();
        fd.append("foto", up);
        const r = await axios.post(`${API}/public/task/${token}/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
        setTask(r.data); okc++;
      } catch { /* lanjut */ }
    }
    setBusy(false);
    flash(okc ? `✓ ${okc} foto masuk album` : "Gagal upload, coba lagi");
    if (albumInput.current) albumInput.current.value = "";
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
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("jenis", cp.jenis);
      fd.append("catatan", cp.catatan || "");
      fd.append("alamat", cp.alamat && cp.alamat !== "Lokasi tidak tersedia" ? cp.alamat : "");
      if (cp.geo) { fd.append("lat", cp.geo.lat); fd.append("lng", cp.geo.lng); fd.append("acc", cp.geo.acc); }
      if (cp.file) { let up = cp.file; try { up = await stampPhoto(cp.file, [cp.jenis, new Date().toLocaleString("id-ID")]); } catch {} fd.append("foto", up); }
      const r = await axios.post(`${API}/public/task/${token}/checkpoint`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTask(r.data); setCp(null); flash("✓ Checkpoint tersimpan");
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

  const wrap = { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)" };
  if (phase === "load") return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>Memuat tugas…</div>;
  if (phase === "notfound") return <Centered wrap={wrap} icon="🔗" title="Link tidak ditemukan" sub="Link tugas salah atau sudah dihapus." />;
  if (phase === "disabled") return <Centered wrap={wrap} icon="⛔" title="Link dinonaktifkan" sub="Hubungi admin PT Alyssa Auto Logistik." />;
  if (phase === "error") return <Centered wrap={wrap} icon="⚠️" title="Gagal memuat" sub={errMsg} />;

  const tabs = task.tabs && task.tabs.length ? task.tabs : ["foto", "checkpoint", "dokumen"];
  const unit0 = (task.units || [])[0] || {};
  const bigBtn = { width: "100%", padding: "16px", borderRadius: 12, border: "none", background: C.blue, color: "#fff", fontWeight: 800, fontSize: 16, cursor: "pointer", minHeight: 56, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 };

  return (
    <div style={wrap}>
      {/* Header ringkas */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: "14px 16px calc(env(safe-area-inset-top) + 0px)", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ fontSize: 11, color: C.blueSoft, fontWeight: 800 }}>PT ALYSSA AUTO LOGISTIK</div>
        <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>Tugas: {task.role_label || task.tipe_petugas}</div>
        <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>{unit0.vehicle_type || "Kendaraan"} · {unit0.nopol || unit0.no_rangka || "-"}</div>
        <div style={{ fontSize: 12, color: C.mute, marginTop: 1 }}>{task.asal || "—"}{task.tujuan ? ` → ${task.tujuan}` : ""}{task.petugas_nama ? ` · ${task.petugas_nama}` : ""}</div>
        <StatusBadge status={task.status} />
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, padding: "10px 12px", background: C.card, borderBottom: `1px solid ${C.line}`, position: "sticky", top: 0, zIndex: 15, overflowX: "auto" }}>
        {tabs.map((k) => {
          const m = TAB_META[k] || { icon: "•", label: k };
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} style={{ flex: "1 0 auto", padding: "10px 10px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800, minHeight: 44, whiteSpace: "nowrap", background: on ? C.blue : C.gray, color: on ? "#fff" : C.mute }}>
              {m.icon} {m.label}
            </button>
          );
        })}
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* ── TAB FOTO ── */}
        {tab === "foto" && (
          <>
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
              <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginBottom: 6 }}>Foto yang harus diambil:</div>
              <div style={{ fontSize: 13, color: C.ink, lineHeight: 1.7 }}>
                {(task.foto_instruksi || []).map((s, i) => <div key={i}>• {s}</div>)}
              </div>
            </div>
            <input ref={albumInput} type="file" accept="image/*" capture="environment" multiple style={{ display: "none" }} onChange={(e) => onAlbumPick(e.target.files)} />
            <button style={bigBtn} disabled={busy} onClick={() => albumInput.current?.click()}>📷 {task.foto_title || "Tambah Foto"}</button>
            <div className="keep-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
              {(task.photos || []).slice().reverse().map((p) => (
                <img key={p.id} src={resolveUrl(p.url)} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover", border: `1px solid ${C.line}` }} />
              ))}
            </div>
            {(task.photos || []).length === 0 && <div style={{ textAlign: "center", color: C.mute, fontSize: 12, padding: 8 }}>Belum ada foto.</div>}
          </>
        )}

        {/* ── TAB CHECKPOINT (timeline) ── */}
        {tab === "checkpoint" && (
          <>
            <button style={bigBtn} disabled={busy} onClick={openCheckpoint}>📍 Tambah Checkpoint</button>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(task.checkpoints || []).slice().reverse().map((c) => (
                <div key={c.checkpoint_id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, display: "flex", gap: 10 }}>
                  {c.url && <img src={resolveUrl(c.url)} alt="" style={{ width: 54, height: 54, borderRadius: 8, objectFit: "cover", flexShrink: 0, border: `1px solid ${C.line}` }} />}
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
          style={{ width: "100%", padding: 16, borderRadius: 12, border: "none", background: task.status === "selesai" ? C.green : C.greenSoft, color: "#fff", fontWeight: 900, fontSize: 16, cursor: "pointer", minHeight: 56 }}>
          {task.status === "selesai" ? "✅ Tugas Selesai" : "✅ Tandai Tugas Selesai"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: C.mute, padding: "4px 0 20px" }}>PT Alyssa Auto Logistik · Logbook Operasional</div>
      </div>

      {/* Sheet checkpoint */}
      {cp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 60, display: "flex", alignItems: "flex-end" }} onClick={() => !busy && setCp(null)}>
          <div style={{ width: "100%", maxWidth: 560, margin: "0 auto", background: C.card, borderRadius: "16px 16px 0 0", padding: 16, paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 16, fontWeight: 900, marginBottom: 4 }}>📍 Tambah Checkpoint</div>
            <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>{cp.alamat || "Mengambil lokasi…"}{cp.geo ? ` · ${cp.geo.lat.toFixed(5)}, ${cp.geo.lng.toFixed(5)}` : ""}</div>
            <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, marginBottom: 6 }}>Jenis checkpoint</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {(task.allowed_checkpoint_types || []).map((j) => (
                <button key={j} onClick={() => setCp((c) => ({ ...c, jenis: j }))} style={{ padding: "9px 12px", borderRadius: 20, border: `1px solid ${cp.jenis === j ? C.blue : C.line}`, background: cp.jenis === j ? C.blue : "none", color: cp.jenis === j ? "#fff" : C.ink, fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 40 }}>{j}</button>
              ))}
            </div>
            <input ref={cpInput} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => cpPickFoto(e.target.files?.[0])} />
            <button onClick={() => cpInput.current?.click()} style={{ width: "100%", padding: 12, borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 48, marginBottom: 8 }}>{cp.previewUrl ? "✓ Foto siap · ganti" : "📷 Tambah Foto (opsional)"}</button>
            {cp.previewUrl && <img src={cp.previewUrl} alt="" style={{ width: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 8, marginBottom: 8 }} />}
            <textarea value={cp.catatan} onChange={(e) => setCp((c) => ({ ...c, catatan: e.target.value }))} placeholder="Catatan (opsional)" style={{ width: "100%", background: "#0d1117", border: `1px solid ${C.line}`, borderRadius: 8, padding: "11px 12px", color: C.ink, fontSize: 15, outline: "none", boxSizing: "border-box", minHeight: 56, resize: "vertical", marginBottom: 12, fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setCp(null)} disabled={busy} style={{ flex: 1, padding: 14, borderRadius: 10, border: `1px solid ${C.line}`, background: "none", color: C.mute, fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 52 }}>Batal</button>
              <button onClick={saveCheckpoint} disabled={busy} style={{ flex: 2, padding: 14, borderRadius: 10, border: "none", background: C.greenSoft, color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", minHeight: 52 }}>{busy ? "Menyimpan…" : "Simpan Checkpoint"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Scan dokumen (reuse CropModal existing) */}
      {scan && (
        <CropModal url={scan.url} file={scan.file} onCancel={() => setScan(null)} onConfirm={(pdfFile) => uploadDoc(scan.doc_type, pdfFile)} />
      )}

      {toast && <div style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: "#1c2128", color: C.ink, padding: "10px 18px", borderRadius: 24, fontSize: 13, fontWeight: 700, border: `1px solid ${C.line}`, zIndex: 100 }}>{toast}</div>}
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
  if (u.startsWith("http")) return u;
  return `${BACKEND_URL}${u.startsWith("/") ? "" : "/"}${u}`;
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
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
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

function StatusBadge({ status }) {
  const map = {
    belum_dibuka: { t: "Belum Dibuka", c: "#8b949e", bg: "#21262d" },
    sudah_dibuka: { t: "Sudah Dibuka", c: "#58a6ff", bg: "#0d2847" },
    dikerjakan: { t: "Sedang Dikerjakan", c: "#e6b450", bg: "#2a2410" },
    menunggu: { t: "Menunggu Kelengkapan", c: "#e6b450", bg: "#2a2410" },
    selesai: { t: "Selesai", c: "#3fb950", bg: "#0d2818" },
    dinonaktifkan: { t: "Dinonaktifkan", c: "#f85149", bg: "#2d1214" },
    kedaluwarsa: { t: "Kedaluwarsa", c: "#f85149", bg: "#2d1214" },
  };
  const s = map[status] || map.belum_dibuka;
  return <span style={{ display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 12, background: s.bg, color: s.c }}>{s.t}</span>;
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
