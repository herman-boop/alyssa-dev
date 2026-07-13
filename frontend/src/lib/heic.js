/* Konversi foto HEIC/HEIF (format default kamera iPhone) ke JPEG di browser.
   Browser (Chrome/Edge/Firefox di Windows/Android) tidak bisa decode HEIC lewat
   Image/Canvas API, jadi tanpa ini foto driver dari iPhone tampil "broken image"
   di semua tempat (Fleet/Live Track, BASTK, dsb). Lazy-load heic2any dari CDN,
   sama seperti pola loadOpenCV() di DriverCheckpoint.jsx. */

let _heic2anyPromise = null;
function loadHeic2any() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (_heic2anyPromise) return _heic2anyPromise;
  _heic2anyPromise = new Promise((resolve, reject) => {
    let s = document.getElementById("heic2any-js");
    const done = () => {
      if (window.heic2any) resolve(window.heic2any);
      else reject(new Error("heic2any gagal load"));
    };
    if (s) { s.addEventListener("load", done); if (window.heic2any) done(); return; }
    s = document.createElement("script");
    s.id = "heic2any-js";
    s.async = true;
    s.src = "https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js";
    s.onload = done;
    s.onerror = () => reject(new Error("gagal load heic2any"));
    document.body.appendChild(s);
    setTimeout(() => { if (!window.heic2any) reject(new Error("timeout heic2any")); }, 15000);
  });
  return _heic2anyPromise;
}

export function isHeicFile(file) {
  if (!file) return false;
  const type = (file.type || "").toLowerCase();
  if (type === "image/heic" || type === "image/heif" || type === "image/heic-sequence" || type === "image/heif-sequence") return true;
  return /\.hei[cf]$/i.test(file.name || "");
}

/* HEIC/HEIF -> File JPEG. Format lain atau kalau gagal konversi -> file asli (best-effort). */
export async function convertHeicIfNeeded(file) {
  if (!isHeicFile(file)) return file;
  try {
    const heic2any = await loadHeic2any();
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], (file.name || "photo").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch (e) {
    console.warn("konversi HEIC gagal, pakai file asli:", e);
    return file;
  }
}
