import { useRef, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const TIPE_SIM = ["A", "B1", "B2", "C", "D"];

const Logo = () => <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={56} height={56} style={{ objectFit: "contain" }} />;

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "10px 14px", color: "#e6edf3", fontSize: 14, outline: "none", width: "100%", fontFamily: "inherit" };
const L = { fontSize: 12, color: "#8b949e", display: "block", marginBottom: 5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" };

export default function DriverRegister() {
  const [step, setStep] = useState("form"); // form | foto | done
  const [driverId, setDriverId] = useState(null);
  const [form, setForm] = useState({ nama: "", no_hp: "", no_ktp: "", no_sim: "", tipe_sim: "B1", alamat: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [uploads, setUploads] = useState({ ktp: null, sim: null });
  const [previews, setPreviews] = useState({ ktp: null, sim: null });
  const [uploading, setUploading] = useState(null);
  const [uploadDone, setUploadDone] = useState({ ktp: false, sim: false });
  const refs = { ktp: useRef(), sim: useRef() };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submitForm = async () => {
    if (!form.nama.trim() || !form.no_hp.trim()) { setError("Nama dan No. HP wajib diisi"); return; }
    setError(""); setSubmitting(true);
    try {
      const r = await axios.post(`${API}/driver-register`, form);
      setDriverId(r.data.driver_id);
      setStep("foto");
    } catch (e) { setError(e?.response?.data?.detail || "Gagal mengirim data. Coba lagi."); }
    finally { setSubmitting(false); }
  };

  const pickFile = (slot, file) => {
    if (!file) return;
    setUploads(u => ({ ...u, [slot]: file }));
    const url = URL.createObjectURL(file);
    setPreviews(p => ({ ...p, [slot]: url }));
  };

  const compressImage = async (file) => {
    const MAX = 1200;
    // createImageBitmap otomatis baca EXIF orientation → tidak muter sendiri
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    let w = bitmap.width, h = bitmap.height;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
      else { w = Math.round(w * MAX / h); h = MAX; }
    }
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return new Promise(resolve =>
      canvas.toBlob(blob => resolve(new File([blob], file.name, { type: "image/jpeg" })), "image/jpeg", 0.78)
    );
  };

  const uploadFoto = async (slot) => {
    if (!uploads[slot]) return;
    setUploading(slot);
    try {
      const compressed = await compressImage(uploads[slot]);
      const fd = new FormData(); fd.append("foto", compressed);
      await axios.post(`${API}/driver-register/${driverId}/foto/${slot}`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setUploadDone(d => ({ ...d, [slot]: true }));
    } catch { setError(`Gagal upload foto ${slot}. Coba lagi.`); }
    finally { setUploading(null); }
  };

  const SLOTS = [
    { key: "ktp", label: "Foto KTP", desc: "Pastikan seluruh teks KTP terbaca", ico: "🪪" },
    { key: "sim", label: "Foto SIM", desc: "Foto SIM sesuai tipe yang dipilih", ico: "🚗" },
  ];

  const allUploaded = SLOTS.every(s => uploadDone[s.key]);

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#0d1117", color: "#e6edf3", minHeight: "100vh" }}>

      {/* Header */}
      <header style={{ background: "#161b22", borderBottom: "1px solid #21262d", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <Logo />
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#e6edf3" }}>PT Alyssa Auto Logistik</div>
          <div style={{ fontSize: 12, color: "#8b949e" }}>Formulir Pendaftaran Driver</div>
        </div>
      </header>

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "24px 16px" }}>

        {/* Step: Form data diri */}
        {step === "form" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>👷</div>
              <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Daftar sebagai Driver</h1>
              <p style={{ fontSize: 13, color: "#8b949e" }}>Isi data diri dengan benar. Tim Alyssa akan memverifikasi data Anda.</p>
            </div>

            <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 20 }}>

              <div style={{ marginBottom: 14 }}>
                <label style={L}>Nama Lengkap <span style={{ color: "#f85149" }}>*</span></label>
                <input style={I} value={form.nama} onChange={e => set("nama", e.target.value)} placeholder="Budi Santoso" autoFocus />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={L}>No. HP / WhatsApp <span style={{ color: "#f85149" }}>*</span></label>
                <input style={I} type="tel" value={form.no_hp} onChange={e => set("no_hp", e.target.value)} placeholder="0812-3456-7890" />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={L}>No. KTP</label>
                  <input style={I} value={form.no_ktp} onChange={e => set("no_ktp", e.target.value)} placeholder="32710..." />
                </div>
                <div>
                  <label style={L}>No. SIM</label>
                  <input style={I} value={form.no_sim} onChange={e => set("no_sim", e.target.value)} placeholder="..." />
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={L}>Tipe SIM</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {TIPE_SIM.map(t => (
                    <button key={t} type="button" onClick={() => set("tipe_sim", t)}
                      style={{ padding: "7px 16px", borderRadius: 8, border: `2px solid ${form.tipe_sim === t ? "#EF9F27" : "#30363d"}`, background: form.tipe_sim === t ? "#2b1d0e" : "none", color: form.tipe_sim === t ? "#EF9F27" : "#8b949e", cursor: "pointer", fontWeight: 700, fontSize: 14 }}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <label style={L}>Alamat Domisili</label>
                <textarea style={{ ...I, resize: "none" }} rows={3} value={form.alamat} onChange={e => set("alamat", e.target.value)} placeholder="Jl. Contoh No. 1, Kota..." />
              </div>

              {error && <div style={{ background: "#2d1a1a", border: "1px solid #f85149", borderRadius: 8, padding: "10px 14px", color: "#f85149", fontSize: 13, marginBottom: 14 }}>{error}</div>}

              <button onClick={submitForm} disabled={submitting}
                style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: submitting ? "#30363d" : "#EF9F27", color: "#000", cursor: submitting ? "not-allowed" : "pointer", fontSize: 15, fontWeight: 800 }}>
                {submitting ? "Mengirim..." : "Lanjut → Upload Foto"}
              </button>
            </div>
          </div>
        )}

        {/* Step: Upload foto */}
        {step === "foto" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
              <h1 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Upload Foto Dokumen</h1>
              <p style={{ fontSize: 13, color: "#8b949e" }}>Upload foto KTP dan SIM kamu. Pastikan foto jelas dan tidak buram.</p>
              <div style={{ marginTop: 10, display: "inline-block", background: "#1a4a2a", border: "1px solid #2ea043", borderRadius: 8, padding: "5px 14px", fontSize: 11, color: "#56d364", fontWeight: 700 }}>
                ID Driver: {driverId}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {SLOTS.map(sl => (
              <div key={sl.key} style={{ background: "#161b22", border: `1px solid ${uploadDone[sl.key] ? "#2ea043" : "#21262d"}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 20 }}>{sl.ico}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{sl.label}</div>
                    {uploadDone[sl.key]
                      ? <div style={{ fontSize: 11, color: "#56d364" }}>✓ Terupload</div>
                      : <div style={{ fontSize: 11, color: "#8b949e" }}>{sl.desc}</div>}
                  </div>
                </div>

                {previews[sl.key]
                  ? <img src={previews[sl.key]} alt="" style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 7, marginBottom: 8, border: "1px solid #30363d" }} />
                  : <div style={{ width: "100%", height: 110, borderRadius: 7, marginBottom: 8, border: "1px dashed #30363d", display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: 24 }}>📷</div>
                }

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button type="button" onClick={() => refs[sl.key].current?.click()}
                    style={{ padding: "8px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#e6edf3", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                    {previews[sl.key] ? "Ganti" : "📂 Pilih Foto"}
                  </button>
                  {previews[sl.key] && !uploadDone[sl.key] && (
                    <button type="button" onClick={() => uploadFoto(sl.key)} disabled={uploading === sl.key}
                      style={{ padding: "8px", borderRadius: 7, border: "none", background: uploading === sl.key ? "#30363d" : "#2ea043", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                      {uploading === sl.key ? "Mengompres & Upload..." : "⬆ Upload"}
                    </button>
                  )}
                </div>
                <input ref={refs[sl.key]} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={e => pickFile(sl.key, e.target.files[0])} />
              </div>
            ))}
            </div>

            {error && <div style={{ background: "#2d1a1a", border: "1px solid #f85149", borderRadius: 8, padding: "10px 14px", color: "#f85149", fontSize: 13, marginBottom: 14 }}>{error}</div>}

            <button onClick={() => setStep("done")} disabled={!allUploaded && false}
              style={{ width: "100%", padding: "13px", borderRadius: 10, border: "none", background: allUploaded ? "#EF9F27" : "#2ea043", color: "#000", cursor: "pointer", fontSize: 15, fontWeight: 800, marginTop: 8 }}>
              {allUploaded ? "✅ Selesai — Kirim Pendaftaran" : "Selesai (Lewati foto yang belum siap)"}
            </button>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div style={{ textAlign: "center", padding: "40px 0" }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 10, color: "#56d364" }}>Pendaftaran Terkirim!</h1>
            <p style={{ fontSize: 14, color: "#8b949e", lineHeight: 1.6, marginBottom: 20 }}>
              Data kamu sudah diterima tim PT Alyssa Auto Logistik.<br />
              Kami akan menghubungi kamu via WhatsApp untuk konfirmasi.
            </p>
            <div style={{ background: "#161b22", border: "1px solid #2ea043", borderRadius: 12, padding: "16px 20px", marginBottom: 24, display: "inline-block" }}>
              <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>ID Driver kamu</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#EF9F27", letterSpacing: 2 }}>{driverId}</div>
              <div style={{ fontSize: 11, color: "#8b949e", marginTop: 4 }}>Simpan ID ini untuk referensi</div>
            </div>
            <div style={{ fontSize: 13, color: "#8b949e" }}>
              Ada pertanyaan? Hubungi admin via WhatsApp:<br />
              <a href="https://wa.me/6281863113500" style={{ color: "#EF9F27", fontWeight: 700 }}>0818-6311-3500</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
