/*
  Tema peta corporate/enterprise fleet tracking (presentation only).
  Basemap: Esri "Light Gray Canvas" — GRATIS, tanpa API key.
  - World_Light_Gray_Base   : landmass abu lembut + jalan sangat subtle (tanpa label)
  - World_Light_Gray_Reference: overlay transparan berisi label kota/pelabuhan + batas
  Coastline & area pelabuhan tetap jelas (penting untuk RORO), noise POI minim.

  Dipakai bersama oleh CustomerTracking, Dashboard, PoDCard supaya konsisten &
  gampang ganti provider cukup di satu tempat.

  Catatan lisensi: wajib menampilkan attribution "Esri" (sudah di-set di bawah).
*/

export const MAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
export const MAP_LABEL_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}";
export const MAP_ATTR =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';

// Esri Canvas native maksimal ~zoom 16; Leaflet upscale halus sampai 19.
export const MAP_MAX_ZOOM = 19;
export const MAP_MAX_NATIVE_ZOOM = 16;

// Garis rute corporate: tipis & elegan (bukan biru neon).
export const ROUTE_COLOR = "#475569";   // slate-600
export const ROUTE_WEIGHT = 2.5;
export const ROUTE_OPACITY = 0.9;
export const ROUTE_DASH = "6 7";

// Warna indikator kesegaran AIS (dot kecil di label — bukan mewarnai kapal).
export function freshnessDot(freshness) {
  if (freshness === "fresh") return "#16a34a";   // hijau
  if (freshness === "recent") return "#d97706";  // amber
  return "#94a3b8";                               // stale/unknown: abu netral (tidak mencolok)
}
