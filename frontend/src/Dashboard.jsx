import { useEffect, useState, useRef, useCallback } from "react";
import "@/App.css";
import "@/Dashboard.css";
import axios from "axios";
import { MapPin, Plus, Truck, Clock, Navigation, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon paths (Leaflet + webpack)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const liveIcon = L.divIcon({
  className: "live-marker",
  html: `<div class="pulse-ring"></div><div class="pulse-dot"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

const checkpointIcon = L.divIcon({
  className: "chk-marker",
  html: `<div class="chk-dot"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const ID_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const ID_DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

function pad(n) { return String(n).padStart(2, "0"); }

function FlyTo({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [position, map]);
  return null;
}

export default function Dashboard() {
  const [now, setNow] = useState(new Date());
  const [position, setPosition] = useState(null); // [lat,lng]
  const [gpsError, setGpsError] = useState(null);
  const [accuracy, setAccuracy] = useState(null);

  const [manifest, setManifest] = useState(null);
  const [checkpoints, setCheckpoints] = useState([]);

  const [form, setForm] = useState({
    no_pol: "",
    nama_driver: "",
    asal: "",
    tujuan: "",
    muatan: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [addingChk, setAddingChk] = useState(false);
  const [toast, setToast] = useState(null);

  const watchIdRef = useRef(null);

  // Real-time clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Geolocation watch
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setGpsError("Browser tidak mendukung Geolocation.");
      // Fallback ke Jakarta
      setPosition([-6.2, 106.8166]);
      return;
    }
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 };
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setAccuracy(pos.coords.accuracy);
        setGpsError(null);
      },
      (err) => {
        setGpsError(err.message || "Tidak dapat mengakses GPS. Menggunakan posisi default.");
        setPosition((p) => p || [-6.2, 106.8166]);
      },
      opts
    );
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // Load active manifest + checkpoints on mount
  useEffect(() => {
    (async () => {
      try {
        const m = await axios.get(`${API}/manifests/active`);
        if (m.data) {
          setManifest(m.data);
          setForm((f) => ({ ...f, no_pol: m.data.no_pol }));
          const chk = await axios.get(`${API}/checkpoints`, { params: { manifest_id: m.data.id } });
          setCheckpoints(chk.data || []);
        }
      } catch (e) { console.error(e); }
    })();
  }, []);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2600);
  };

  const submitManifest = async (e) => {
    e.preventDefault();
    if (!form.no_pol.trim() || !form.nama_driver.trim()) {
      showToast("No Pol dan Nama Driver wajib diisi.", "err");
      return;
    }
    setSubmitting(true);
    try {
      const res = await axios.post(`${API}/manifests`, form);
      setManifest(res.data);
      setCheckpoints([]);
      showToast("Manifes perjalanan aktif.");
    } catch (err) {
      showToast("Gagal menyimpan manifes.", "err");
    } finally {
      setSubmitting(false);
    }
  };

  const completeManifest = async () => {
    if (!manifest) return;
    try {
      await axios.post(`${API}/manifests/${manifest.id}/complete`);
      setManifest(null);
      setCheckpoints([]);
      showToast("Manifes diselesaikan.");
    } catch { showToast("Gagal menyelesaikan manifes.", "err"); }
  };

  const addCheckpoint = useCallback(async () => {
    if (!position) { showToast("Posisi GPS belum tersedia.", "err"); return; }
    setAddingChk(true);
    try {
      const payload = {
        manifest_id: manifest?.id || null,
        no_pol: manifest?.no_pol || form.no_pol || null,
        lat: position[0],
        lng: position[1],
        label: `CP-${checkpoints.length + 1}`,
      };
      const res = await axios.post(`${API}/checkpoints`, payload);
      setCheckpoints((prev) => [res.data, ...prev]);
      showToast("Checkpoint tercatat.");
    } catch {
      showToast("Gagal menambah checkpoint.", "err");
    } finally {
      setAddingChk(false);
    }
  }, [position, manifest, checkpoints.length, form.no_pol]);

  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const dayName = ID_DAYS[now.getDay()];
  const dateStr = `${pad(now.getDate())} ${ID_MONTHS[now.getMonth()]} ${now.getFullYear()}`;

  const polyline = [...checkpoints].reverse().map((c) => [c.lat, c.lng]);

  return (
    <div className="dash-root" data-testid="dashboard-root">
      {/* HEADER */}
      <header className="dash-header" data-testid="dash-header">
        <div className="dash-header-inner">
          <div className="brand">
            <div className="brand-mark"><Navigation size={18} /></div>
            <div>
              <div className="brand-title">FLEET / LIVE TRACK</div>
              <div className="brand-sub">Driver Checkpoint Console</div>
            </div>
          </div>
          <div className="clock" data-testid="realtime-clock">
            <Clock size={16} className="clock-icon" />
            <span className="clock-time" data-testid="clock-time">{hh}:{mm}:{ss}</span>
            <span className="clock-sep">|</span>
            <span className="clock-date" data-testid="clock-date">{dayName}, {dateStr}</span>
          </div>
        </div>
      </header>

      {/* MAIN GRID */}
      <main className="dash-grid">
        {/* MAP CARD */}
        <section className="card map-card" data-testid="map-card">
          <div className="card-head">
            <div className="card-head-left">
              <MapPin size={16} />
              <span>Live Map</span>
            </div>
            <div className="card-head-right">
              {position ? (
                <span className="coord-chip" data-testid="coord-chip">
                  {position[0].toFixed(5)}, {position[1].toFixed(5)}
                  {accuracy && <span className="acc">  ±{Math.round(accuracy)}m</span>}
                </span>
              ) : (
                <span className="coord-chip muted">Mencari GPS…</span>
              )}
            </div>
          </div>
          <div className="map-wrap" data-testid="leaflet-map">
            {position ? (
              <MapContainer
                center={position}
                zoom={15}
                scrollWheelZoom={true}
                style={{ height: "520px", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; OpenStreetMap'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <FlyTo position={position} />
                <Marker position={position} icon={liveIcon}>
                  <Popup>Posisi saat ini</Popup>
                </Marker>
                {checkpoints.map((c) => (
                  <Marker key={c.id} position={[c.lat, c.lng]} icon={checkpointIcon}>
                    <Popup>
                      <b>{c.label || "Checkpoint"}</b><br />
                      {new Date(c.timestamp).toLocaleString("id-ID")}
                    </Popup>
                  </Marker>
                ))}
                {polyline.length > 1 && (
                  <Polyline positions={polyline} pathOptions={{ color: "#09090B", weight: 3, dashArray: "6 8" }} />
                )}
              </MapContainer>
            ) : (
              <div className="map-loading">Mengaktifkan GPS…</div>
            )}
          </div>
          {gpsError && (
            <div className="map-footnote" data-testid="gps-warning">
              <AlertCircle size={14} /> {gpsError}
            </div>
          )}
        </section>

        {/* SIDEBAR */}
        <aside className="sidebar">
          {/* No Pol + Active manifest */}
          <div className="card nopol-card" data-testid="nopol-card">
            <div className="nopol-label">NOMOR POLISI</div>
            <div className="nopol-value" data-testid="nopol-display">
              {manifest?.no_pol || form.no_pol || "—"}
            </div>
            {manifest ? (
              <div className="manifest-summary" data-testid="active-manifest">
                <div className="row"><span>Driver</span><b>{manifest.nama_driver}</b></div>
                <div className="row"><span>Rute</span><b>{manifest.asal} → {manifest.tujuan}</b></div>
                <div className="row"><span>Muatan</span><b>{manifest.muatan || "-"}</b></div>
                <button className="btn btn-ghost" onClick={completeManifest} data-testid="btn-complete-manifest">
                  Selesaikan Manifes
                </button>
              </div>
            ) : (
              <div className="manifest-empty">Belum ada manifes aktif. Isi form di bawah.</div>
            )}
          </div>

          {/* Manifest form */}
          {!manifest && (
            <form className="card form-card" onSubmit={submitManifest} data-testid="form-manifest">
              <div className="card-head">
                <div className="card-head-left"><FileText size={16} /><span>Manifes Perjalanan</span></div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>No Pol</span>
                  <input
                    type="text"
                    value={form.no_pol}
                    onChange={(e) => setForm({ ...form, no_pol: e.target.value.toUpperCase() })}
                    placeholder="B 1234 ABC"
                    data-testid="input-nopol"
                  />
                </label>
                <label className="field">
                  <span>Nama Driver</span>
                  <input
                    type="text"
                    value={form.nama_driver}
                    onChange={(e) => setForm({ ...form, nama_driver: e.target.value })}
                    placeholder="Budi Santoso"
                    data-testid="input-driver"
                  />
                </label>
                <label className="field">
                  <span>Asal</span>
                  <input
                    type="text"
                    value={form.asal}
                    onChange={(e) => setForm({ ...form, asal: e.target.value })}
                    placeholder="Jakarta"
                    data-testid="input-asal"
                  />
                </label>
                <label className="field">
                  <span>Tujuan</span>
                  <input
                    type="text"
                    value={form.tujuan}
                    onChange={(e) => setForm({ ...form, tujuan: e.target.value })}
                    placeholder="Bandung"
                    data-testid="input-tujuan"
                  />
                </label>
                <label className="field full">
                  <span>Muatan</span>
                  <input
                    type="text"
                    value={form.muatan}
                    onChange={(e) => setForm({ ...form, muatan: e.target.value })}
                    placeholder="Elektronik 1.2 ton"
                    data-testid="input-muatan"
                  />
                </label>
              </div>
              <button className="btn btn-dark" type="submit" disabled={submitting} data-testid="btn-submit-manifest">
                <Truck size={16} /> {submitting ? "Menyimpan..." : "Mulai Perjalanan"}
              </button>
            </form>
          )}

          {/* Checkpoint button */}
          <button
            className="btn btn-cta"
            onClick={addCheckpoint}
            disabled={addingChk || !position}
            data-testid="btn-add-checkpoint"
          >
            <Plus size={18} /> {addingChk ? "Mencatat..." : "Tambah Checkpoint"}
          </button>

          {/* Timeline */}
          <div className="card timeline-card" data-testid="checkpoint-timeline">
            <div className="card-head">
              <div className="card-head-left"><CheckCircle2 size={16} /><span>Driver Checkpoint</span></div>
              <span className="count-chip" data-testid="checkpoint-count">{checkpoints.length}</span>
            </div>
            {checkpoints.length === 0 ? (
              <div className="timeline-empty" data-testid="checkpoint-empty">Belum ada checkpoint.</div>
            ) : (
              <ol className="timeline">
                {checkpoints.map((c, idx) => {
                  const d = new Date(c.timestamp);
                  const stamp = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} • ${pad(d.getDate())} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
                  return (
                    <li key={c.id} className="timeline-item" style={{ animationDelay: `${idx * 40}ms` }} data-testid={`checkpoint-item-${idx}`}>
                      <div className="node" />
                      <div className="ti-body">
                        <div className="ti-top">
                          <b>{c.label || `CP-${checkpoints.length - idx}`}</b>
                          <span className="ti-time">{stamp}</span>
                        </div>
                        <div className="ti-coord">
                          {c.lat.toFixed(5)}, {c.lng.toFixed(5)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </aside>
      </main>

      {toast && (
        <div className={`toast ${toast.type === "err" ? "toast-err" : "toast-ok"}`} data-testid="toast">
          {toast.msg}
        </div>
      )}
    </div>
  );
}
