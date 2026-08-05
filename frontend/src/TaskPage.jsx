import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/* Halaman petugas (mobile-first) — dibuka dari link tugas /task/{token}.
   Akses ter-scope: petugas cuma lihat tugasnya (unit, lokasi, instruksi,
   checklist, foto yang DIA upload). Nggak ada harga/HPP/leg lain. */
export default function TaskPage() {
  const token = (window.location.pathname.split("/task/")[1] || "").replace(/\/$/, "").split("?")[0];
  const [task, setTask] = useState(null);
  const [phase, setPhase] = useState("load"); // load | ok | error | disabled | notfound
  const [errMsg, setErrMsg] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [toast, setToast] = useState("");
  const [extra, setExtra] = useState({});
  const fileRefs = useRef({});

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2200); };

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

  // Ambil GPS (best-effort). Kalau ditolak → tetap upload tanpa lokasi.
  const getGeo = () => new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  });

  const doUpload = async (item, file) => {
    if (!file) return;
    setBusyKey(item.key);
    const geo = await getGeo();
    try {
      const fd = new FormData();
      fd.append("foto", file);
      fd.append("checklist_key", item.key);
      if (geo) { fd.append("lat", geo.lat); fd.append("lng", geo.lng); fd.append("acc", geo.acc); }
      const r = await axios.post(`${API}/public/task/${token}/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setTask(r.data);
      flash(geo ? "✓ Foto + lokasi terkirim" : "✓ Foto terkirim (lokasi tidak tersedia)");
    } catch (e) {
      flash(e?.response?.data?.detail || "Gagal upload, coba lagi");
    } finally { setBusyKey(null); }
  };

  const saveExtra = async (selesai) => {
    setBusyKey("__submit");
    try {
      const r = await axios.post(`${API}/public/task/${token}/submit`, { extra_inputs: extra, selesai });
      setTask(r.data);
      flash(selesai ? "✓ Tugas ditandai selesai" : "✓ Tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan"); }
    finally { setBusyKey(null); }
  };

  const C = {
    bg: "#0d1117", card: "#161b22", line: "#21262d", ink: "#e6edf3", mute: "#8b949e",
    gold: "#EF9F27", green: "#3fb950", blue: "#58a6ff",
  };
  const wrap = { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" };

  if (phase === "load") return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>Memuat tugas…</div>;
  if (phase === "notfound") return <Centered wrap={wrap} icon="🔗" title="Link tidak ditemukan" sub="Link tugas salah atau sudah dihapus." />;
  if (phase === "disabled") return <Centered wrap={wrap} icon="⛔" title="Link dinonaktifkan" sub="Hubungi admin PT Alyssa Auto Logistik." />;
  if (phase === "error") return <Centered wrap={wrap} icon="⚠️" title="Gagal memuat" sub={errMsg} />;

  const jenis = task.jenis || "Tugas";
  const isKapal = /kapal/i.test(jenis);
  const isTujuanAkhir = /self drive tujuan/i.test(jenis) || /tujuan akhir/i.test(jenis);
  const doneCount = (task.checklist || []).filter((c) => c.done).length;
  const total = (task.checklist || []).length;

  return (
    <div style={wrap}>
      {/* Header */}
      <div style={{ background: C.card, borderBottom: `1px solid ${C.line}`, padding: "14px 16px" }}>
        <div style={{ fontSize: 12, color: C.gold, fontWeight: 800 }}>PT ALYSSA AUTO LOGISTIK</div>
        <div style={{ fontSize: 18, fontWeight: 900, marginTop: 2 }}>Tugas Anda: {task.tipe_petugas || jenis}</div>
        {task.petugas_nama && <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>Petugas: {task.petugas_nama}</div>}
        <StatusBadge status={task.status} />
      </div>

      <div style={{ maxWidth: 560, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Unit */}
        <Section C={C} title="Unit / Kendaraan">
          {(task.units || []).map((u, i) => (
            <div key={i} style={{ padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>{u.nopol || u.no_rangka || "(tanpa nopol)"}</div>
              <div style={{ fontSize: 12, color: C.mute }}>{u.vehicle_type || "Kendaraan"}{u.no_rangka ? ` · Rangka ${u.no_rangka}` : ""}</div>
            </div>
          ))}
        </Section>

        {/* Lokasi */}
        <Section C={C} title="Lokasi Tugas">
          <div style={{ fontSize: 14, fontWeight: 700 }}>{task.asal || "—"} {task.tujuan ? `→ ${task.tujuan}` : ""}</div>
          {(task.kapal || task.voyage) && <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>Kapal: {task.kapal || "—"}{task.voyage ? ` · Voyage ${task.voyage}` : ""}</div>}
        </Section>

        {/* Instruksi */}
        {task.instruksi && (
          <Section C={C} title="Instruksi Admin">
            <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{task.instruksi}</div>
          </Section>
        )}

        {/* Checklist foto */}
        <Section C={C} title={`Checklist Foto (${doneCount}/${total})`}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(task.checklist || []).map((it) => {
              const photos = (task.photos || []).filter((p) => p.checklist_key === it.key);
              const busy = busyKey === it.key;
              return (
                <div key={it.key} style={{ border: `1px solid ${it.done ? C.green : C.line}`, borderRadius: 10, padding: 10, background: it.done ? "#0d2818" : "#0d1117" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{it.done ? "✅" : "⬜"}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{it.label}</span>
                  </div>
                  {photos.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {photos.map((p) => (
                        <img key={p.id} src={resolveUrl(p.url)} alt="" style={{ width: 54, height: 54, borderRadius: 7, objectFit: "cover", border: `1px solid ${C.line}` }} />
                      ))}
                    </div>
                  )}
                  <input ref={(el) => (fileRefs.current[it.key] = el)} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                    onChange={(e) => { doUpload(it, e.target.files?.[0]); e.target.value = ""; }} />
                  <button onClick={() => fileRefs.current[it.key]?.click()} disabled={busy}
                    style={{ width: "100%", padding: "12px", borderRadius: 9, border: "none", background: busy ? "#30363d" : (it.done ? "#1f6feb" : C.gold), color: it.done ? "#fff" : "#1a1208", fontWeight: 800, fontSize: 14, cursor: "pointer", minHeight: 46 }}>
                    {busy ? "Mengirim…" : it.done ? "📷 Ambil Ulang / Tambah" : "📷 Ambil Foto"}
                  </button>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Input tambahan (kapal / penerima) */}
        {isKapal && (
          <Section C={C} title="Info Kapal">
            <Field C={C} label="Nama Kapal" value={extra.nama_kapal || task.kapal || ""} onChange={(v) => setExtra((x) => ({ ...x, nama_kapal: v }))} />
            <Field C={C} label="Nomor Voyage" value={extra.voyage || task.voyage || ""} onChange={(v) => setExtra((x) => ({ ...x, voyage: v }))} />
            <Field C={C} label="Estimasi Berangkat" type="date" value={extra.etd || ""} onChange={(v) => setExtra((x) => ({ ...x, etd: v }))} />
            <Field C={C} label="Estimasi Tiba" type="date" value={extra.eta || ""} onChange={(v) => setExtra((x) => ({ ...x, eta: v }))} />
          </Section>
        )}
        {isTujuanAkhir && (
          <Section C={C} title="Serah Terima Customer">
            <Field C={C} label="Nama Penerima" value={extra.penerima_nama || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_nama: v }))} />
            <Field C={C} label="No. HP Penerima" value={extra.penerima_hp || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_hp: v }))} />
            <div style={{ fontSize: 12, color: C.mute, fontWeight: 700, margin: "4px 0 6px" }}>Tanda Tangan Penerima</div>
            <SignaturePad C={C} value={extra.penerima_ttd || ""} onChange={(v) => setExtra((x) => ({ ...x, penerima_ttd: v }))} />
          </Section>
        )}

        {/* Catatan + submit */}
        <Section C={C} title="Catatan & Status">
          <Field C={C} label="Catatan (opsional)" value={extra.catatan || ""} onChange={(v) => setExtra((x) => ({ ...x, catatan: v }))} textarea />
          <button onClick={() => saveExtra(false)} disabled={busyKey === "__submit"}
            style={{ width: "100%", padding: 12, borderRadius: 9, border: `1px solid ${C.line}`, background: "none", color: C.ink, fontWeight: 700, fontSize: 14, cursor: "pointer", marginBottom: 8, minHeight: 46 }}>
            💾 Simpan Catatan
          </button>
          <button onClick={() => saveExtra(true)} disabled={busyKey === "__submit" || task.status === "selesai"}
            style={{ width: "100%", padding: 14, borderRadius: 10, border: "none", background: task.status === "selesai" ? "#238636" : C.green, color: "#fff", fontWeight: 900, fontSize: 15, cursor: "pointer", minHeight: 50 }}>
            {task.status === "selesai" ? "✅ Tugas Selesai" : "✅ Tandai Tugas Selesai"}
          </button>
        </Section>

        <div style={{ textAlign: "center", fontSize: 11, color: C.mute, padding: "8px 0 24px" }}>
          PT Alyssa Auto Logistik · Spesialis Pengiriman Kendaraan
        </div>
      </div>

      {toast && <div style={{ position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", background: "#1c2128", color: C.ink, padding: "10px 18px", borderRadius: 24, fontSize: 13, fontWeight: 700, border: `1px solid ${C.line}`, zIndex: 100 }}>{toast}</div>}
    </div>
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
        style={{ width: "100%", height: 140, background: "#fff", borderRadius: 8, border: `1px solid ${C.line}`, touchAction: "none", display: value && !canvasRef.current ? "none" : "block" }} />
      {value && <img src={value} alt="ttd" style={{ display: "none" }} />}
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
