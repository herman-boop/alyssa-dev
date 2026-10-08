/*
  Mapper data "Lihat Posisi Kapal" — fungsi murni (tanpa React) supaya mudah dites
  dan dipakai ulang dari layar mana pun.

  Sumber: `ship_ais` dari view tracking ({ ship_name, mmsi, imo, ais:{...} }) +
  leg kapal aktif ({ asal, tujuan, ... }). Field yang memang tidak dikirim AIS
  (panjang, lebar, tipe kapal) dibiarkan null -> UI menampilkan "—", tidak dikarang.
*/

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const toDate = (v) => {
  if (!v) return null;
  const s = String(v);
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00` : s);
  return isNaN(d.getTime()) ? null : d;
};

export const WIB = "Asia/Jakarta";

/* "08 Okt 2026 14:32 WIB" — kosong kalau tanggal tidak valid. */
export function fmtDateTimeWib(v) {
  const d = toDate(v);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: WIB, day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce((a, p) => { a[p.type] = p.value; return a; }, {});
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute} WIB`;
}

/* Umur data: 90 -> "1 menit lalu", 7200 -> "2 jam lalu". */
export function ageText(sec) {
  if (sec == null || !Number.isFinite(Number(sec))) return "";
  const s = Math.max(0, Number(sec));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}

/* -6.2 -> "6.2000° S", 106.8 -> "106.8000° E" */
export function fmtCoord(v, axis) {
  const n = num(v);
  if (n === null) return "";
  const hemi = axis === "lat" ? (n < 0 ? "S" : "N") : (n < 0 ? "W" : "E");
  return `${Math.abs(n).toFixed(4)}° ${hemi}`;
}

/* 5° -> "N", 92 -> "E" (16 arah dipadatkan ke 8). */
export function compass(deg) {
  const n = num(deg);
  if (n === null) return "";
  const names = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
  return names[Math.round((((n % 360) + 360) % 360) / 45) % 8];
}

/* Arah ikon: heading valid (0-359) diutamakan, kalau tidak pakai course. */
export function vesselRotation(heading, course) {
  const h = num(heading);
  if (h !== null && h >= 0 && h < 360) return h;
  const c = num(course);
  return c !== null && c >= 0 && c < 360 ? c : 0;
}

/* Bangun props VesselPositionView dari ship_ais + leg aktif. Return null kalau
   belum ada koordinat (tidak ada yang bisa digambar di peta). */
export function buildVesselView(shipAis, leg, extra) {
  const a = shipAis && shipAis.ais ? shipAis.ais : null;
  const lat = a ? num(a.latitude) : null;
  const lon = a ? num(a.longitude) : null;
  if (lat === null || lon === null) return null;
  const ex = extra || {};
  return {
    name: (shipAis.ship_name || a.ship_name || "KAPAL").toString(),
    mmsi: shipAis.mmsi || a.mmsi || "",
    imo: shipAis.imo || a.imo || "",
    lat, lon,
    speed: num(a.speed),
    course: num(a.course),
    heading: num(a.heading),
    navStatus: a.nav_status_text || "",
    origin: (leg && leg.asal) || "",
    destination: (leg && leg.tujuan) || a.destination || "",
    eta: a.eta || "",
    ata: a.berthed_at || "",
    draught: num(a.draught),
    length: num(ex.length),
    width: num(ex.width),
    shipType: ex.shipType || "",
    receivedAt: a.position_timestamp || "",
    ageSeconds: num(a.age_seconds),
    freshness: a.freshness || "unknown",
  };
}
