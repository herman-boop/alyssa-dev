import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./VesselPositionView.css";
import {
  OCEAN_TILE_URL, OCEAN_LABEL_URL, OCEAN_MAX_NATIVE_ZOOM, MAP_ATTR, freshnessDot,
} from "./mapTheme";
import {
  fmtCoord, fmtDateTimeWib, ageText, compass, vesselRotation,
} from "./vesselPositionData";

/*
  Layar "Lihat Posisi Kapal" bergaya aplikasi pelacak kapal publik:
  peta laut di atas, kartu informasi kapal di bawah (di layar lebar: kiri-kanan).

  Props:
    vessel     : hasil buildVesselView() (lihat vesselPositionData.js)
    onClose    : () => void
    landmarks  : [{ name, lat, lon }] opsional — penanda tempat (mis. Kota Manado)
  Semua nilai yang tidak diketahui ditampilkan "—" (tidak dikarang).
*/

const DASH = "—";

function shipIcon(v) {
  const rot = vesselRotation(v.heading, v.course);
  const col = freshnessDot(v.freshness);
  const moving = (v.speed || 0) >= 0.5;
  const glyph = moving
    ? `<svg viewBox="0 0 32 32" width="34" height="34" style="transform:rotate(${rot}deg)" aria-hidden="true">
         <path d="M16 2 L24 27 L16 22.5 L8 27 Z" fill="#1d4ed8" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
       </svg>`
    : `<svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
         <rect x="8" y="8" width="16" height="16" rx="3" fill="#d97706" stroke="#fff" stroke-width="1.8"/>
       </svg>`;
  return L.divIcon({
    className: "vpos-ship",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    html: `<div class="vpos-ship-wrap"><span class="vpos-pulse" style="--c:${col}"></span>${glyph}</div>`,
  });
}

function landmarkIcon(name) {
  const safe = String(name).replace(/[<>&"]/g, "");
  return L.divIcon({
    className: "vpos-lm",
    iconSize: [0, 0],
    html: `<div class="vpos-lm-pin"><i></i><span>${safe}</span></div>`,
  });
}

/* Pusatkan ulang peta ke kapal (dipakai tombol target). */
function Recenter({ pos, nonce }) {
  const map = useMap();
  useEffect(() => { map.setView(pos, Math.max(map.getZoom(), 8), { animate: true }); }, [nonce]); // eslint-disable-line
  return null;
}

/* Leaflet butuh invalidateSize setelah layout flex selesai. */
function FixSize() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 120);
    const onR = () => map.invalidateSize();
    window.addEventListener("resize", onR);
    return () => { clearTimeout(t); window.removeEventListener("resize", onR); };
  }, [map]);
  return null;
}

function Row({ k, v, strong }) {
  const empty = v === null || v === undefined || v === "";
  return (
    <div className="vpos-row">
      <span className="vpos-k">{k}</span>
      <span className={`vpos-v${strong ? " strong" : ""}${empty ? " empty" : ""}`}>{empty ? DASH : v}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="vpos-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export default function VesselPositionView({ vessel, onClose, landmarks = [] }) {
  const v = vessel;
  const pos = useMemo(() => [v.lat, v.lon], [v.lat, v.lon]);
  const icon = useMemo(() => shipIcon(v), [v.heading, v.course, v.speed, v.freshness]); // eslint-disable-line
  const [nonce, setNonce] = useNonce();

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose && onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const speed = v.speed != null ? `${v.speed.toFixed(1)} knot` : null;
  const course = v.course != null ? `${Math.round(v.course)}° ${compass(v.course)}` : null;
  const dim = (n) => (n != null ? `${n} m` : null);
  const received = fmtDateTimeWib(v.receivedAt);
  const age = ageText(v.ageSeconds);
  const live = v.freshness === "fresh";

  return (
    <div className="vpos" role="dialog" aria-modal="true" aria-label={`Posisi kapal ${v.name}`} data-testid="vpos">
      <div className="vpos-map" data-testid="vpos-map">
        <MapContainer center={pos} zoom={8} minZoom={3} maxZoom={14} zoomControl={false} attributionControl style={{ height: "100%", width: "100%" }}>
          <TileLayer url={OCEAN_TILE_URL} attribution={MAP_ATTR} maxNativeZoom={OCEAN_MAX_NATIVE_ZOOM} />
          <TileLayer url={OCEAN_LABEL_URL} maxNativeZoom={OCEAN_MAX_NATIVE_ZOOM} />
          {landmarks.map((l) => (
            <Marker key={l.name} position={[l.lat, l.lon]} icon={landmarkIcon(l.name)} interactive={false} />
          ))}
          <Marker position={pos} icon={icon}>
            <Tooltip permanent direction="right" offset={[18, 0]} className="vpos-name">{v.name}</Tooltip>
          </Marker>
          <FixSize />
          <Recenter pos={pos} nonce={nonce} />
        </MapContainer>

        <button type="button" className="vpos-back" onClick={onClose} aria-label="Kembali" data-testid="vpos-close">‹</button>
        <button type="button" className="vpos-target" onClick={setNonce} aria-label="Pusatkan ke kapal" data-testid="vpos-recenter">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
      </div>

      <aside className="vpos-card" data-testid="vpos-card">
        <div className="vpos-grip" aria-hidden="true" />
        <header className="vpos-head">
          <div className="vpos-title">
            <h2>{v.name}</h2>
            <div className="vpos-ids">
              {v.mmsi ? <span>MMSI {v.mmsi}</span> : null}
              {v.imo ? <span>IMO {v.imo}</span> : null}
            </div>
          </div>
          <span className={`vpos-badge ${live ? "live" : v.freshness}`} data-testid="vpos-fresh">
            <i style={{ background: freshnessDot(v.freshness) }} />
            {live ? "LIVE" : age || "Posisi terakhir"}
          </span>
        </header>

        <div className="vpos-hero">
          <div><b>{speed || DASH}</b><small>Kecepatan</small></div>
          <div><b>{course || DASH}</b><small>Haluan</small></div>
          <div><b>{v.navStatus || DASH}</b><small>Status</small></div>
        </div>

        <Section title="Posisi">
          <Row k="Latitude" v={fmtCoord(v.lat, "lat")} strong />
          <Row k="Longitude" v={fmtCoord(v.lon, "lon")} strong />
          <Row k="Speed" v={speed} />
          <Row k="Course" v={course} />
          <Row k="Status Navigasi" v={v.navStatus} />
        </Section>

        <Section title="Pelayaran">
          <div className="vpos-route" data-testid="vpos-route">
            <div><small>Asal</small><b>{v.origin || DASH}</b></div>
            <span aria-hidden="true">➜</span>
            <div><small>Tujuan</small><b>{v.destination || DASH}</b></div>
          </div>
          <Row k="ETA" v={fmtDateTimeWib(v.eta)} />
          <Row k="ATA" v={fmtDateTimeWib(v.ata)} />
        </Section>

        <Section title="Data Kapal">
          <Row k="Draught" v={v.draught != null ? `${v.draught} m` : null} />
          <Row k="Panjang" v={dim(v.length)} />
          <Row k="Lebar" v={dim(v.width)} />
          <Row k="Tipe Kapal" v={v.shipType} />
        </Section>

        <footer className="vpos-foot" data-testid="vpos-received">
          Info diterima: <b>{received || DASH}</b>{age ? ` · ${age}` : ""}
          {!live ? <div className="vpos-note">Bukan real-time — posisi terakhir yang tertangkap AIS.</div> : null}
        </footer>
      </aside>
    </div>
  );
}

/* Counter kecil untuk memicu Recenter tanpa state boolean. */
function useNonce() {
  const [n, set] = useState(0);
  return [n, () => set((x) => x + 1)];
}
