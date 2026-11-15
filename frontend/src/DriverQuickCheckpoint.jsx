/*
  Foto Checkpoint CEPAT untuk driver (mis. car carrier): buka link /cp/{trip_id} -> satu ketukan -> kamera ->
  cek foto -> KIRIM. Tanpa form, tanpa login, tanpa menu lain.
  Memakai endpoint yang SAMA dengan halaman driver biasa (POST /api/trips/{trip}/photos/daily), jadi foto langsung
  tercatat sebagai checkpoint harian trip itu. Satu foto per hari (server menolak yang kedua); kiriman ulang aman
  karena memakai client_id yang sama.
*/
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { stampPhoto } from "./DriverCheckpoint";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const C = { bg: "#0A0E1A", card: "#131A2C", line: "#1E293B", ink: "#F1F5F9", mute: "#94A3B8", green: "#16a34a", greenSoft: "#22C55E", gold: "#D4A847", red: "#f85149", blue: "#2563EB" };

export const wibTanggal = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
export const wibJam = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(11, 16);
const tglId = (iso) => iso.split("-").reverse().join("/");
const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : `cp-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* Pesan yang bisa dibaca driver dari galat server/jaringan. Mengembalikan { sudah, pesan }. */
export function pesanGalat(e) {
  const st = e && e.response && e.response.status;
  const d = e && e.response && e.response.data && e.response.data.detail;
  if (st === 409) return { sudah: true, pesan: "Foto hari ini sudah terkirim." };
  if (st === 404) return { sudah: false, pesan: "Link ini tidak dikenal. Minta link baru ke admin." };
  if (st === 413) return { sudah: false, pesan: "Foto terlalu besar. Coba foto ulang." };
  if (st) return { sudah: false, pesan: (typeof d === "string" && d) || `Gagal mengirim (kode ${st}). Coba lagi.` };
  return { sudah: false, pesan: "Tidak ada sinyal / gagal terhubung. Foto masih tersimpan, tekan KIRIM lagi kalau sinyal sudah ada." };
}

export default function DriverQuickCheckpoint() {
  const tripId = useMemo(() => decodeURIComponent((window.location.pathname.split("/cp/")[1] || "").replace(/\/$/, "").split("?")[0]), []);
  const [trip, setTrip] = useState(null);
  const [fase, setFase] = useState("muat");      // muat | siap | pratinjau | kirim | selesai | tidakada
  const [foto, setFoto] = useState(null);        // File siap kirim
  const [url, setUrl] = useState("");
  const [pesan, setPesan] = useState("");
  const [gps, setGps] = useState(null);
  const [diambil, setDiambil] = useState(null);  // ms waktu foto diambil
  const cid = useRef(uid());
  const inp = useRef(null);

  const sudahHariIni = (t) => ((t && t.daily_checkpoints) || []).some((c) => c.date === wibTanggal());

  useEffect(() => {
    if (!tripId) { setFase("tidakada"); return; }
    axios.get(`${API}/trips/${encodeURIComponent(tripId)}`, { timeout: 15000 })
      .then((r) => { setTrip(r.data); setFase(sudahHariIni(r.data) ? "selesai" : "siap"); })
      .catch((e) => { if (e.response && e.response.status === 404) setFase("tidakada"); else setFase("siap"); });
    // Lokasi: dicoba diam-diam di latar belakang; kalau ditolak, foto tetap bisa dikirim.
    try {
      if (navigator.geolocation) navigator.geolocation.getCurrentPosition(
        (p) => setGps({ lat: p.coords.latitude, lng: p.coords.longitude }), () => {}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    } catch (e) { /* abaikan */ }
  }, [tripId]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const pilih = useCallback(async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!f) return;
    const t = Date.now();
    setPesan(""); setFase("kirim");
    const nopol = (trip && trip.nopol) || "";
    const lines = [`CHECKPOINT ${nopol}`.trim(), `${tglId(wibTanggal(t))}  ${wibJam(t)} WIB`, gps ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}` : ""].filter(Boolean);
    const stamped = await stampPhoto(f, lines);    // beri cap tanggal/jam/lokasi + kecilkan ukuran
    setFoto(stamped); setDiambil(t); setUrl(URL.createObjectURL(stamped)); setFase("pratinjau");
  }, [trip, gps]);

  const kirim = async () => {
    if (!foto || fase === "kirim") return;
    setFase("kirim"); setPesan("");
    const fd = new FormData();
    fd.append("foto", foto);
    fd.append("client_id", cid.current);
    fd.append("taken_at", new Date(diambil || Date.now()).toISOString());
    if (gps) { fd.append("lat", String(gps.lat)); fd.append("lng", String(gps.lng)); }
    try {
      await axios.post(`${API}/trips/${encodeURIComponent(tripId)}/photos/daily`, fd, { timeout: 60000 });
      setFase("selesai");
    } catch (err) {
      const g = pesanGalat(err);
      if (g.sudah) { setFase("selesai"); return; }
      setPesan(g.pesan); setFase("pratinjau");
    }
  };

  const ulang = () => { setFoto(null); if (url) URL.revokeObjectURL(url); setUrl(""); setPesan(""); cid.current = uid(); setFase("siap"); };
  const btn = (bg, extra) => ({ display: "block", width: "100%", boxSizing: "border-box", padding: "20px 16px", borderRadius: 16, border: "none", background: bg, color: "#fff", fontSize: 20, fontWeight: 800, textAlign: "center", cursor: "pointer", ...extra });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", display: "flex", flexDirection: "column", padding: 18, boxSizing: "border-box" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: C.gold, fontWeight: 800, letterSpacing: 1 }}>ALYSSA LOGISTIK</div>
        <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>Foto Checkpoint</div>
        {trip && <div style={{ fontSize: 14, color: C.mute, marginTop: 4 }}>{[trip.nopol, trip.route].filter(Boolean).join(" · ")}</div>}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, maxWidth: 520, width: "100%", margin: "0 auto" }}>
        {fase === "muat" && <div style={{ textAlign: "center", color: C.mute }}>Memuat…</div>}

        {fase === "tidakada" && <div data-testid="cp-tidakada" style={{ textAlign: "center", color: C.red, fontSize: 17, fontWeight: 700 }}>Link ini tidak dikenal.<br /><span style={{ color: C.mute, fontSize: 14, fontWeight: 500 }}>Minta link baru ke admin.</span></div>}

        {fase === "siap" && (
          <>
            <label style={btn(C.green, { padding: "44px 16px", fontSize: 24 })} data-testid="cp-ambil">
              📷 FOTO CHECKPOINT
              <input ref={inp} type="file" accept="image/*" capture="environment" onChange={pilih} style={{ display: "none" }} data-testid="cp-input" />
            </label>
            <div style={{ textAlign: "center", color: C.mute, fontSize: 14 }}>Ketuk tombol hijau, foto kendaraan, lalu tekan KIRIM.</div>
            {!gps && <div style={{ textAlign: "center", color: C.mute, fontSize: 12 }}>Aktifkan lokasi di HP kalau diminta supaya posisi tercatat.</div>}
          </>
        )}

        {(fase === "pratinjau" || fase === "kirim") && url && (
          <>
            <img src={url} alt="Foto checkpoint" style={{ width: "100%", maxHeight: "56vh", objectFit: "contain", borderRadius: 14, background: "#000" }} data-testid="cp-foto" />
            {pesan && <div data-testid="cp-pesan" style={{ background: "#2d1214", border: `1px solid ${C.red}`, color: "#ffb4ae", borderRadius: 12, padding: "10px 12px", fontSize: 14 }}>{pesan}</div>}
            <button onClick={kirim} disabled={fase === "kirim"} data-testid="cp-kirim" style={btn(fase === "kirim" ? "#475569" : C.green)}>{fase === "kirim" ? "Mengirim…" : "✅ KIRIM"}</button>
            <button onClick={ulang} disabled={fase === "kirim"} data-testid="cp-ulang" style={{ background: "none", border: "none", color: C.mute, fontSize: 15, textDecoration: "underline", cursor: "pointer", padding: 8 }}>Foto ulang</button>
          </>
        )}
        {fase === "kirim" && !url && <div style={{ textAlign: "center", color: C.mute }}>Menyiapkan foto…</div>}

        {fase === "selesai" && (
          <div data-testid="cp-selesai" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 72 }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: C.greenSoft, marginTop: 6 }}>Foto checkpoint terkirim</div>
            <div style={{ color: C.mute, fontSize: 15, marginTop: 8 }}>{tglId(wibTanggal())} · Terima kasih. Hati-hati di jalan.</div>
          </div>
        )}
      </div>
    </div>
  );
}
