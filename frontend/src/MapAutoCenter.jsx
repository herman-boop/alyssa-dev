import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/*
  Auto-center peta Leaflet saat halaman dibuka.

  Masalah yang diperbaiki:
  1. Ukuran kontainer berubah SETELAH peta dibuat (layout flex, font, panel) →
     Leaflet menghitung tengah dengan ukuran lama → kapal tidak di tengah.
     Solusi: invalidateSize() berulang (setTimeout), saat window resize, dan
     ResizeObserver pada kontainer, lalu pusatkan ulang.
  2. Posisi kapal (AIS) datang belakangan dari refresh berikutnya → dulu peta
     terkunci di checkpoint. Solusi: kapal selalu dipusatkan sekali begitu muncul.
  Semua pemusatan otomatis BERHENTI begitu pengguna menyentuh peta (geser/zoom/ketuk),
  jadi pengguna tidak pernah "ditarik balik".
*/
export const REGIONAL_ZOOM = 7;   // 1 posisi: konteks regional
export const SHIP_ZOOM = 8;       // fokus ke kapal (kapal + kota/pelabuhan terdekat terbaca)
export const FIT_MAX_ZOOM = 9;    // banyak titik berdekatan: jangan lebih dekat dari ini
const SETTLE_MS = [0, 120, 350, 900];   // jadwal invalidateSize setelah mount

export function MapFitter({ positions, shipPos }) {
  const map = useMap();
  const fitted = useRef("");            // "" | "pos" | "ship"
  const touched = useRef(false);        // pengguna sudah berinteraksi
  const shipRef = useRef(null);
  shipRef.current = shipPos && shipPos.length === 2 ? shipPos : null;

  // Tandai interaksi pengguna (bukan setView programatik).
  useEffect(() => {
    const el = map.getContainer();
    const mark = () => { touched.current = true; };
    const evs = ["pointerdown", "wheel", "touchstart", "keydown"];
    evs.forEach((e) => el.addEventListener(e, mark, { passive: true }));
    return () => evs.forEach((e) => el.removeEventListener(e, mark));
  }, [map]);

  // Perbaiki ukuran + pusatkan ulang ke kapal selama pengguna belum menyentuh peta.
  useEffect(() => {
    const settle = () => {
      try {
        map.invalidateSize({ animate: false });
        if (!touched.current && shipRef.current) {
          map.setView(shipRef.current, SHIP_ZOOM, { animate: false });
        }
      } catch (e) {}
    };
    const timers = SETTLE_MS.map((ms) => setTimeout(settle, ms));
    window.addEventListener("resize", settle);
    let ro = null;
    try {
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(settle);
        ro.observe(map.getContainer());
      }
    } catch (e) {}
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", settle);
      if (ro) ro.disconnect();
    };
  }, [map]);

  // Auto-fit: kapal diprioritaskan, dan dipusatkan sekali begitu posisinya ada.
  useEffect(() => {
    if (touched.current) return;
    try {
      if (shipRef.current) {
        if (fitted.current !== "ship") {
          map.invalidateSize({ animate: false });
          map.setView(shipRef.current, SHIP_ZOOM, { animate: false });
          fitted.current = "ship";
        }
        return;
      }
      if (fitted.current || !positions || positions.length === 0) return;
      map.invalidateSize({ animate: false });
      if (positions.length === 1) {
        map.setView(positions[0], REGIONAL_ZOOM, { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(positions), { padding: [50, 50], maxZoom: FIT_MAX_ZOOM, animate: false });
      }
      fitted.current = "pos";
    } catch (e) {}
  }, [map, positions, shipPos]);

  return null;
}
