import { useMemo } from "react";
import { Marker } from "react-leaflet";
import L from "leaflet";
import { freshnessDot } from "./mapTheme";

/*
  Marker kapal + kartu info melayang (gaya aplikasi pelacak maritim).
  - Ikon PANAH MERAH yang berputar sesuai HEADING dari backend (fallback: course/COG).
  - Posisi marker ikut berubah otomatis saat data backend diperbarui (polling halaman).
  - Kartu info (ShipCard) melayang di atas peta: terbuka otomatis, ditutup dengan ×, dibuka lagi dengan ketuk ikon kapal.
    Dibuat sebagai overlay (bukan popup Leaflet) supaya tidak menggeser peta / menutupi ikon di layar HP yang pendek.
  Semua isi kartu murni dari data backend (ship_ais.ais + trip). Tidak ada data contoh.
*/

const num = (v) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v));

/* Status kapal dari kecepatan AIS: Speed > 0.5 kn = Berlayar (hijau, berdenyut), <= 0.5 kn = Berlabuh / Sandar (oranye).
   Posisi basi (stale) atau speed kosong = tidak ada status (abu-abu), supaya tidak menyesatkan. */
export const BATAS_BERLAYAR_KN = 0.5;
export function statusKapal(info) {
  const sp = num(info && info.speed);
  if (sp == null || (info && info.freshness === "stale")) return null;
  return sp > BATAS_BERLAYAR_KN
    ? { key: "berlayar", label: "Berlayar", color: "#16a34a", soft: "#e7f6ee", border: "#b6e2ca", tone: "green" }
    : { key: "berlabuh", label: "Berlabuh", color: "#d97706", soft: "#fdf3e3", border: "#f0d59b", tone: "amber" };
}

/* Arah panah: heading (0-359; 511 = tidak tersedia) dulu, lalu course (360 = tidak tersedia). */
export function arahKapal(info) {
  const hd = num(info && info.heading);
  if (hd != null && hd >= 0 && hd < 360) return hd;
  const cg = num(info && info.course);
  if (cg != null && cg >= 0 && cg < 360) return cg;
  return null;
}

function buildIcon(info, freshness, name) {
  const S = 34;
  const st = statusKapal(info);
  const fill = st ? st.color : "#94a3b8";                         // basi / tanpa speed: abu netral
  const rot = freshness === "stale" ? null : arahKapal(info);     // posisi basi: arah lama bisa menyesatkan
  const dot = freshnessDot(freshness);
  const shadow = "filter:drop-shadow(0 2px 3px rgba(15,23,42,.5));";
  // Panah runcing menghadap heading (berlayar maupun berlabuh); tanpa heading -> bulatan.
  const glyph = rot != null
    ? `<svg viewBox="0 0 24 24" width="${S}" height="${S}" style="display:block;transform:rotate(${rot}deg);${shadow}">
         <path d="M12 1.5 L19 21.5 L12 17 L5 21.5 Z" fill="${fill}" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
       </svg>`
    : `<svg viewBox="0 0 24 24" width="${S}" height="${S}" style="display:block;${shadow}">
         <circle cx="12" cy="12" r="7" fill="${fill}" stroke="#ffffff" stroke-width="1.8"/>
       </svg>`;
  const pulse = st && st.key === "berlayar" ? `<span class="ship-pulse" style="background:${fill}"></span>` : "";
  const label = name
    ? `<div style="position:absolute;left:${S - 4}px;top:4px;pointer-events:none;white-space:nowrap;background:#fff;color:#0f172a;
         border:1px solid #cbd5e1;border-radius:4px;padding:1px 6px;font:700 10px Inter,system-ui,sans-serif;box-shadow:0 1px 3px rgba(0,0,0,.3);">
         <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${dot};margin-right:4px;"></span>${name}</div>`
    : "";
  return L.divIcon({
    html: `<div class="ship-ic" style="position:relative;width:${S}px;height:${S}px;">${pulse}${glyph}${label}</div>`,
    className: "ship-divicon",        // tanpa kotak putih bawaan Leaflet (lihat .ship-divicon di Tracking.css)
    iconSize: [S, S],
    iconAnchor: [S / 2, S / 2],       // titik tengah ikon tepat di koordinat kapal
    popupAnchor: [0, -S / 2],
  });
}

/* -5.3641, 130.0465  (derajat desimal) */
export function fmtKoordinat(lat, lng) {
  const a = num(lat), b = num(lng);
  if (a == null || b == null) return "—";
  return `${a.toFixed(4)}, ${b.toFixed(4)}`;
}

/* ISO -> "15/11/2026 13:07 WIB" */
export function fmtWaktuWib(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = {};
  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute} WIB`;
}

const K = { color: "#64748b", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".3px" };
const V = { color: "#0f172a", fontWeight: 700, fontSize: 12.5, wordBreak: "break-word", lineHeight: 1.25 };

export function ShipMarker({ position, info, shipName, onToggle }) {
  const rot = arahKapal(info);
  // Ikon dibangun ulang HANYA bila tampilannya berubah.
  const icon = useMemo(
    () => buildIcon(info, info.freshness, shipName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rot, info.speed, info.freshness, shipName, statusKapal(info) && statusKapal(info).key]
  );
  return <Marker position={position} icon={icon} eventHandlers={{ click: onToggle }} />;
}

function Cell({ k, children, span }) {
  return <div style={{ gridColumn: span ? "1 / -1" : undefined, minWidth: 0 }}><div style={K}>{k}</div><div style={V}>{children}</div></div>;
}

export function ShipCard({ info, shipName, origin, destination, unit, umurText, badge, onClose }) {
  const sp = num(info.speed);
  const cg = num(info.course);
  const speedCourse = [
    sp != null ? `${String(sp).replace(".", ",")} kn` : null,
    cg != null && cg < 360 ? `course: ${Math.round(cg)}°` : null,
  ].filter(Boolean).join("; ");
  const waktu = fmtWaktuWib(info.position_timestamp);
  const st = statusKapal(info);
  return (
    <section className="fs-card" data-testid="ship-card" aria-label="Info kapal">
      <button type="button" className="fs-card-x" aria-label="Tutup kartu" onClick={onClose}>×</button>
      <div className="fs-card-title">{(shipName || "Kapal") + " - ALYSSA LOGISTIK"}</div>
      <div className="fs-card-grid">
        <Cell k="Koordinat"><span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtKoordinat(info.latitude, info.longitude)}</span></Cell>
        <Cell k="Speed & Course">{speedCourse || "—"}</Cell>
        {st ? <Cell k="Status"><span className="fs-chip" style={{ color: st.color, background: st.soft, borderColor: st.border }} data-testid="ship-status-chip">{st.label}</span>{info.nav_status_text ? <span style={{ fontWeight: 500, color: "#64748b" }}> · {info.nav_status_text}</span> : null}</Cell>
          : (info.nav_status_text ? <Cell k="Status">{info.nav_status_text}</Cell> : null)}
        {(origin || destination) ? <Cell k="Origin / Destination">{origin || "—"} → {destination || "—"}</Cell> : null}
        {unit ? <Cell k="Unit" span>{unit}</Cell> : null}
      </div>
      <div className="fs-card-foot">
        <span style={{ color: badge && badge.color, fontWeight: 700 }}>{badge ? badge.label : ""}</span>
        {waktu ? <> · Pembaruan: <b>{waktu}</b></> : null}
        {umurText ? <> ({umurText})</> : null}
      </div>
    </section>
  );
}
