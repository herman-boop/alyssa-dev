import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import axios from "axios";
import "@/App.css";
import "@/Driver.css";
import PoDCard from "@/PoDCard";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/* Resolve foto URL — Supabase URLs sudah absolute, lainnya prepend BACKEND_URL */
function resolveUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${BACKEND_URL}${url}`;
}

/* Alamat bertingkat (desa → kecamatan → kabupaten → provinsi) dari koordinat,
   bahasa Indonesia. Best-effort; gagal/timeout → []. */
async function reverseGeocode(lat, lng) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=id&lat=${lat}&lon=${lng}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } }
    );
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const a = j.address || {};
    const lines = [];
    const desa = a.village || a.hamlet || a.neighbourhood || a.residential || a.quarter;
    if (desa) lines.push(desa);
    const kec = a.city_district || a.municipality || a.subdistrict || a.district || a.town || a.suburb;
    if (kec && kec !== desa) lines.push(/^kecamatan/i.test(kec) ? kec : `Kecamatan ${kec}`);
    const kab = a.county || a.city || a.regency || a.state_district;
    if (kab) lines.push(kab);
    if (a.state) lines.push(a.state);
    if (lines.length === 0 && j.display_name) {
      return j.display_name.split(",").slice(0, 3).map((s) => s.trim()).filter(Boolean);
    }
    return lines;
  } catch {
    return [];
  }
}

/* Scan dokumen premium: enhance kontras + tajamkan teks biar terbaca jelas */
function scanEnhance(file) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file); };
      img.onload = () => {
        try {
          const maxW = 2048;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(objUrl);

          // Get pixel data
          const imageData = ctx.getImageData(0, 0, w, h);
          const d = imageData.data;

          // Auto-level: find min/max brightness
          let minL = 255, maxL = 0;
          for (let i = 0; i < d.length; i += 4) {
            const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
            if (lum < minL) minL = lum;
            if (lum > maxL) maxL = lum;
          }
          const range = maxL - minL || 1;

          // Enhance: stretch contrast + boost clarity
          for (let i = 0; i < d.length; i += 4) {
            // Auto-level each channel
            d[i]   = Math.min(255, Math.max(0, ((d[i]   - minL) / range) * 255));
            d[i+1] = Math.min(255, Math.max(0, ((d[i+1] - minL) / range) * 255));
            d[i+2] = Math.min(255, Math.max(0, ((d[i+2] - minL) / range) * 255));

            // Contrast boost (S-curve)
            for (let c = 0; c < 3; c++) {
              let v = d[i+c] / 255;
              v = v < 0.5 ? 2*v*v : 1 - Math.pow(-2*v+2,2)/2; // ease
              // Extra punch: stretch toward white/black
              v = Math.pow(v, 0.85);
              d[i+c] = Math.min(255, Math.max(0, Math.round(v * 255)));
            }
          }
          ctx.putImageData(imageData, 0, 0);

          canvas.toBlob(
            (blob) => resolve(blob
              ? new File([blob], (file.name||"scan").replace(/\.\w+$/,"") + "_scan.jpg", { type: "image/jpeg" })
              : file),
            "image/jpeg", 0.92
          );
        } catch { URL.revokeObjectURL(objUrl); resolve(file); }
      };
      img.src = objUrl;
    } catch { resolve(file); }
  });
}

/* ── OpenCV.js lazy-loader (sekali, cached oleh browser) ── */
let _cvPromise = null;
function loadOpenCV() {
  if (window.cv && window.cv.Mat) return Promise.resolve(window.cv);
  if (_cvPromise) return _cvPromise;
  _cvPromise = new Promise((resolve, reject) => {
    const done = () => {
      if (window.cv && window.cv.Mat) return resolve(window.cv);
      // cv ada tapi runtime belum init
      if (window.cv) window.cv["onRuntimeInitialized"] = () => resolve(window.cv);
      else reject(new Error("cv missing"));
    };
    let s = document.getElementById("opencv-js");
    if (s) { s.addEventListener("load", done); if (window.cv) done(); return; }
    s = document.createElement("script");
    s.id = "opencv-js";
    s.async = true;
    s.src = "https://docs.opencv.org/4.10.0/opencv.js";
    s.onload = done;
    s.onerror = () => reject(new Error("gagal load opencv"));
    document.body.appendChild(s);
    // safety timeout 20s
    setTimeout(() => { if (!(window.cv && window.cv.Mat)) reject(new Error("timeout opencv")); }, 20000);
  });
  return _cvPromise;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

/* Modal scanner: auto-deteksi 4 sudut (OpenCV) + geser manual + perspective transform + filter. */
function CropModal({ url, file, onCancel, onConfirm }) {
  const imgRef = useRef(null);
  // 4 sudut bebas (quad) dlm fraksi 0..1
  const [corners, setCorners] = useState({ tl: { x: 0.06, y: 0.06 }, tr: { x: 0.94, y: 0.06 }, br: { x: 0.94, y: 0.94 }, bl: { x: 0.06, y: 0.94 } });
  const [busy, setBusy] = useState(false);
  const [cvState, setCvState] = useState("loading"); // loading | ready | manual
  const [mode, setMode] = useState("magic"); // color | bw | magic
  const [work, setWork] = useState({ url, file }); // gambar kerja (bisa dirotate)
  const drag = useRef(null);
  const workRef = useRef(work);
  workRef.current = work;

  // Bersihkan objectURL hasil rotasi saat modal ditutup
  useEffect(() => () => { if (workRef.current.url !== url) { try { URL.revokeObjectURL(workRef.current.url); } catch {} } }, [url]);

  // Load OpenCV + auto-deteksi tepi
  useEffect(() => {
    let alive = true;
    loadOpenCV()
      .then((cv) => { if (!alive) return; setCvState("ready"); autoDetect(cv); })
      .catch(() => { if (alive) setCvState("manual"); });
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [work.url]);

  const autoDetect = async (cv) => {
    try {
      const img = await loadImg(work.url);
      const MAXW = 900;
      const sc = img.naturalWidth > MAXW ? MAXW / img.naturalWidth : 1;
      const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const cnv = document.createElement("canvas"); cnv.width = w; cnv.height = h;
      cnv.getContext("2d").drawImage(img, 0, 0, w, h);
      const src = cv.imread(cnv);
      const gray = new cv.Mat(); cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      const edges = new cv.Mat(); cv.Canny(gray, edges, 60, 180);
      const k = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.dilate(edges, edges, k);
      const contours = new cv.MatVector(); const hier = new cv.Mat();
      cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      let best = null, bestArea = w * h * 0.15; // minimal 15% area
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const peri = cv.arcLength(c, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * peri, true);
        if (approx.rows === 4) {
          const area = Math.abs(cv.contourArea(approx));
          if (area > bestArea) { bestArea = area; if (best) best.delete(); best = approx; }
          else approx.delete();
        } else approx.delete();
        c.delete();
      }
      if (best) {
        const pts = [];
        for (let i = 0; i < 4; i++) pts.push({ x: best.data32S[i * 2] / w, y: best.data32S[i * 2 + 1] / h });
        // urutkan: tl,tr,br,bl
        pts.sort((a, b) => a.y - b.y);
        const top = pts.slice(0, 2).sort((a, b) => a.x - b.x);
        const bot = pts.slice(2, 4).sort((a, b) => a.x - b.x);
        setCorners({ tl: top[0], tr: top[1], br: bot[1], bl: bot[0] });
        best.delete();
      }
      src.delete(); gray.delete(); edges.delete(); k.delete(); contours.delete(); hier.delete();
    } catch { /* biarkan default kotak */ }
  };

  const move = (e) => {
    if (!drag.current || !imgRef.current) return;
    if (e.cancelable) { try { e.preventDefault(); } catch {} }
    const r = imgRef.current.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const pt = (e.touches && e.touches[0]) ? e.touches[0] : e;
    if (pt.clientX == null || pt.clientY == null) return;
    let fx = (pt.clientX - r.left) / r.width, fy = (pt.clientY - r.top) / r.height;
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
    fx = Math.min(1, Math.max(0, fx)); fy = Math.min(1, Math.max(0, fy));
    const key = drag.current;
    setCorners((c) => ({ ...c, [key]: { x: fx, y: fy } }));
  };
  const end = () => { drag.current = null; };

  const rotate90 = async () => {
    setBusy(true);
    try {
      const img = await loadImg(work.url);
      const w = img.naturalWidth, h = img.naturalHeight;
      const cnv = document.createElement("canvas"); cnv.width = h; cnv.height = w;
      const ctx = cnv.getContext("2d");
      ctx.translate(h, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(img, 0, 0);
      const blob = await new Promise((r) => cnv.toBlob(r, "image/jpeg", 0.95));
      const nf = blob ? new File([blob], "rot.jpg", { type: "image/jpeg" }) : work.file;
      const nurl = URL.createObjectURL(nf);
      if (work.url !== url) URL.revokeObjectURL(work.url);
      setCorners({ tl: { x: 0.06, y: 0.06 }, tr: { x: 0.94, y: 0.06 }, br: { x: 0.94, y: 0.94 }, bl: { x: 0.06, y: 0.94 } });
      setWork({ url: nurl, file: nf });
    } catch {}
    setBusy(false);
  };

  // filter enhancement pada canvas (dipakai utk mode manual & sbagai finishing)
  const enhance = (ctx, w, h) => {
    if (mode === "color") return;
    const id = ctx.getImageData(0, 0, w, h), d = id.data;
    if (mode === "bw") {
      // grayscale + threshold adaptif sederhana (rata2 global)
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const thr = (sum / (d.length / 4)) * 0.92;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const v = g < thr ? 0 : 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
    } else { // magic: normalize kontras + sedikit boost
      let mn = 255, mx = 0;
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; if (g < mn) mn = g; if (g > mx) mx = g; }
      const rng = mx - mn || 1;
      for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
        let v = ((d[i + c] - mn) / rng) * 255;
        v = Math.pow(Math.min(1, Math.max(0, v / 255)), 0.8) * 255;
        d[i + c] = Math.min(255, Math.max(0, v));
      }
    }
    ctx.putImageData(id, 0, 0);
  };

  const doScan = async () => {
    setBusy(true);
    try {
      const img = await loadImg(work.url);
      const W = img.naturalWidth, H = img.naturalHeight;
      const p = {
        tl: [corners.tl.x * W, corners.tl.y * H], tr: [corners.tr.x * W, corners.tr.y * H],
        br: [corners.br.x * W, corners.br.y * H], bl: [corners.bl.x * W, corners.bl.y * H],
      };
      const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const outW = Math.round(Math.max(dist(p.tl, p.tr), dist(p.bl, p.br)));
      const outH = Math.round(Math.max(dist(p.tl, p.bl), dist(p.tr, p.br)));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, outW); canvas.height = Math.max(1, outH);
      const ctx = canvas.getContext("2d");

      if (cvState === "ready" && window.cv && window.cv.Mat) {
        // Perspective transform via OpenCV
        const cv = window.cv;
        const cnv0 = document.createElement("canvas"); cnv0.width = W; cnv0.height = H;
        cnv0.getContext("2d").drawImage(img, 0, 0);
        const src = cv.imread(cnv0);
        const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [p.tl[0], p.tl[1], p.tr[0], p.tr[1], p.br[0], p.br[1], p.bl[0], p.bl[1]]);
        const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outW, 0, outW, outH, 0, outH]);
        const M = cv.getPerspectiveTransform(srcTri, dstTri);
        const dst = new cv.Mat();
        cv.warpPerspective(src, dst, M, new cv.Size(outW, outH), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        cv.imshow(canvas, dst);
        src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
        enhance(ctx, outW, outH);
      } else {
        // Fallback manual: crop bounding-box dari 4 sudut
        const xs = [p.tl[0], p.tr[0], p.br[0], p.bl[0]], ys = [p.tl[1], p.tr[1], p.br[1], p.bl[1]];
        const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs), y1 = Math.max(...ys);
        const cw = Math.max(1, Math.round(x1 - x0)), ch = Math.max(1, Math.round(y1 - y0));
        canvas.width = cw; canvas.height = ch;
        ctx.drawImage(img, x0, y0, cw, ch, 0, 0, cw, ch);
        enhance(ctx, cw, ch);
      }
      const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.95));
      const out = blob ? new File([blob], (file.name || "resi").replace(/\.\w+$/, "") + "_scan.jpg", { type: "image/jpeg" }) : file;
      onConfirm(out);
    } catch { onConfirm(file); }
  };

  const H = (key) => (
    <div onMouseDown={(e) => { e.preventDefault(); drag.current = key; }}
      onTouchStart={() => { drag.current = key; }}
      style={{ position: "absolute", width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: "50%", background: "#EF9F27", border: "3px solid #fff", boxShadow: "0 0 6px rgba(0,0,0,.7)", touchAction: "none", cursor: "grab", left: `${corners[key].x * 100}%`, top: `${corners[key].y * 100}%` }} />
  );
  const poly = `${corners.tl.x * 100},${corners.tl.y * 100} ${corners.tr.x * 100},${corners.tr.y * 100} ${corners.br.x * 100},${corners.br.y * 100} ${corners.bl.x * 100},${corners.bl.y * 100}`;
  const modeBtn = (m, lbl) => (
    <button onClick={() => setMode(m)} disabled={busy}
      style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
        border: mode === m ? "2px solid #EF9F27" : "1px solid #555", background: mode === m ? "#3a2c10" : "none", color: mode === m ? "#EF9F27" : "#bbb" }}>{lbl}</button>
  );

  return (
    <div onMouseMove={move} onMouseUp={end} onMouseLeave={end} onTouchMove={move} onTouchEnd={end} onTouchCancel={end}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.94)", zIndex: 9999, display: "flex", flexDirection: "column", padding: 12, touchAction: "none", overscrollBehavior: "contain", userSelect: "none" }}>
      <div style={{ color: "#fff", textAlign: "center", fontWeight: 800, fontSize: 13, padding: "4px 0 8px" }}>
        {cvState === "loading" ? "⏳ Menyiapkan auto-scan..." : cvState === "ready" ? "Sudut terdeteksi otomatis — geser untuk pas" : "Geser 4 sudut ke tepi dokumen"}
      </div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
        <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", lineHeight: 0 }}>
          <img ref={imgRef} src={work.url} alt="scan" style={{ maxWidth: "100%", maxHeight: "64vh", display: "block", pointerEvents: "none" }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <polygon points={poly} fill="rgba(239,159,39,0.12)" stroke="#EF9F27" strokeWidth="0.6" strokeDasharray="2 1.5" vectorEffect="non-scaling-stroke" />
          </svg>
          {H("tl")}{H("tr")}{H("br")}{H("bl")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, padding: "8px 0 6px" }}>
        {modeBtn("color", "🌈 Warna")}{modeBtn("magic", "✨ Magic")}{modeBtn("bw", "📄 B&W")}
        <button onClick={rotate90} disabled={busy} style={{ flex: 1, padding: "7px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer", border: "1px solid #555", background: "none", color: "#bbb" }}>🔄 Putar</button>
      </div>
      <div style={{ display: "flex", gap: 8, padding: "2px 0 4px" }}>
        <button onClick={onCancel} disabled={busy} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #555", background: "none", color: "#ccc", fontWeight: 700, fontSize: 13 }}>Batal</button>
        <button onClick={() => onConfirm(file)} disabled={busy} style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #888", background: "none", color: "#fff", fontWeight: 700, fontSize: 13 }}>Pakai Full</button>
        <button onClick={doScan} disabled={busy} style={{ flex: 1.5, padding: "12px", borderRadius: 10, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 900, fontSize: 13 }}>{busy ? "..." : "✂ Scan & Lanjut"}</button>
      </div>
    </div>
  );
}

/* "Cap" foto: bakar lokasi + waktu ke dalam gambar (mirip GPS Map Camera).
   `lines` ditulis di bar bawah. Gagal apa pun → kembalikan file asli. */
function stampPhoto(file, lines) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      img.onerror = () => { URL.revokeObjectURL(objUrl); resolve(file); };
      img.onload = () => {
        try {
          const maxW = 1280;
          const scale = img.width > maxW ? maxW / img.width : 1;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);

          const rows = (lines || []).filter(Boolean);
          if (rows.length) {
            const fs = Math.max(19, Math.round(w * 0.038));
            const fsHead = Math.round(fs * 1.15);
            const lh = Math.round(fs * 1.42);
            const pad = Math.round(w * 0.024);
            const barH = lh * rows.length + pad * 1.8 + Math.round(fs * 0.35);
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillRect(0, h - barH, w, barH);
            ctx.fillStyle = "#D4A847";
            ctx.fillRect(0, h - barH, Math.max(4, Math.round(w * 0.012)), barH);
            ctx.textBaseline = "top";
            ctx.shadowColor = "rgba(0,0,0,0.85)";
            ctx.shadowBlur = Math.round(fs * 0.25);
            let y = h - barH + pad * 0.9;
            rows.forEach((ln, i) => {
              const big = i === 0;
              ctx.font = `${big ? 700 : 500} ${big ? fsHead : fs}px sans-serif`;
              ctx.fillStyle = "#FFFFFF";
              ctx.fillText(ln, pad * 1.6, y);
              y += big ? Math.round(fsHead * 1.42) : lh;
            });
            ctx.shadowColor = "transparent";
            ctx.shadowBlur = 0;
          }
          URL.revokeObjectURL(objUrl);
          canvas.toBlob(
            (blob) => resolve(blob
              ? new File([blob], (file.name || "checkpoint").replace(/\.\w+$/, "") + "_geotag.jpg", { type: "image/jpeg" })
              : file),
            "image/jpeg", 0.9
          );
        } catch { URL.revokeObjectURL(objUrl); resolve(file); }
      };
      img.src = objUrl;
    } catch { resolve(file); }
  });
}

const ID_MONTHS = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
const ID_DAYS = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];

const SLOT_LABELS = {
  depan: "Tampak Depan",
  belakang: "Tampak Belakang",
  kiri: "Sisi Kiri",
  kanan: "Sisi Kanan",
  spidometer: "Dashboard / Spidometer",
};
const SLOT_ORDER = ["depan", "belakang", "kiri", "kanan", "spidometer"];

// Urutan & panduan wizard foto awal (dituntun satu per satu untuk driver).
const SLOT_GUIDE_ORDER = ["depan", "kiri", "belakang", "kanan", "spidometer"];
const SLOT_GUIDE = {
  depan:      { emoji: "🚗", title: "Foto DEPAN Mobil",     tips: ["Berdiri di depan mobil", "Pastikan nopol kelihatan jelas"] },
  kiri:       { emoji: "🚙", title: "Foto SAMPING KIRI",    tips: ["Ambil dari sisi kiri mobil", "Seluruh badan mobil masuk"] },
  belakang:   { emoji: "🚗", title: "Foto BELAKANG Mobil",  tips: ["Berdiri di belakang mobil", "Plat belakang terlihat jelas"] },
  kanan:      { emoji: "🚙", title: "Foto SAMPING KANAN",   tips: ["Ambil dari sisi kanan mobil", "Seluruh badan mobil masuk"] },
  spidometer: { emoji: "🎛️", title: "Foto SPIDOMETER",      tips: ["Foto dashboard / odometer", "Angka KM terlihat jelas"] },
};

const SOP_POINTS = [
  { title: "CEK FISIK", body: "Cek oli, air radiator, lampu, dan ban (termasuk ban serep) sebelum berangkat." },
  { title: "FOTO UNIT", body: "Wajib upload foto 4 sisi mobil + foto dashboard bensin sebelum gas." },
  { title: "UPDATE FOTO JALUR", body: "Klik tombol hijau setiap hari antara jam 06.00 – 18.00 sore. Foto lokasi wajib terkirim dalam window waktu tersebut. Dapat Rp 30.000 per foto!" },
  { title: "ATURAN KABIN", body: "Dilarang merokok di dalam mobil. Dilarang beri tumpangan orang asing. Kecepatan tol max 80–100 km/jam." },
  { title: "PENAMPILAN", body: "Wajib berpakaian rapi dan sopan saat bertemu pelanggan di tujuan." },
  { title: "ATURAN FINISH", body: "Mobil WAJIB DICUCI BERSIH dan bensin/solar minimal sisa 1 BAR sebelum serah terima ke konsumen." },
  { title: "DOKUMEN AMAN", body: "Foto BASTK yang ditandatangani konsumen + foto resi ekspedisi asli agar sisa uang jalan langsung cair via Xendit." },
];

function pad(n) { return String(n).padStart(2, "0"); }
function fmtIDR(n) { return "Rp " + (Number(n)||0).toLocaleString("id-ID"); }
function albumStageLabel(s) {
  return { asal: "Asal", kapal: "Dalam Kapal", tujuan: "Tujuan", dokumen: "Dokumen" }[s] || s;
}
function albumStageIcon(_s) { return null; }
const ALBUM_STAGES = ["asal", "kapal", "tujuan", "dokumen"];

function Logo({ size = 96 }) {
  return <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={size} height={size} style={{ objectFit: "contain" }} />;
}
function todayIso() {
  // Tampilan tanggal lokal browser (WIB di mobile user)
  const d = new Date();
  return `${pad(d.getDate())} ${ID_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function readURLParams() {
  const u = new URL(window.location.href);
  const q = u.searchParams;
  // New: /trip/{trip_id} — extra params still come from query string
  const pathSeg = u.pathname.match(/^\/trip\/(.+)/);
  const tripFromPath = pathSeg ? decodeURIComponent(pathSeg[1]) : "";
  let legs = [];
  try {
    const raw = q.get("legs");
    if (raw) legs = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(legs)) legs = [];
  } catch { legs = []; }
  return {
    trip:   tripFromPath || q.get("trip") || "",
    driver: q.get("driver") || "",
    route:  q.get("route")  || "",
    nopol:  q.get("nopol")  || "",
    tipe:   q.get("tipe")   || "",
    rangka: q.get("rangka") || "",
    uj:     parseInt(q.get("uj")  || "0") || 0,
    t1:     parseInt(q.get("t1")  || "0") || 0,
    t2:     parseInt(q.get("t2")  || "0") || 0,
    t3:     parseInt(q.get("t3")  || "0") || 0,
    legs,
  };
}

// A "real" plate is a non-empty nopol that isn't the TBD placeholder for new cars.
const isRealPlate = (np) => !!np && !/^TBD-/i.test(np);

export default function DriverCheckpoint() {
  const params = useMemo(readURLParams, []);
  const [now, setNow] = useState(new Date());
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [celebration, setCelebration] = useState(false);

  const [showSOP, setShowSOP] = useState(false);
  const [namaInput, setNamaInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  const [uploadingSlot, setUploadingSlot] = useState(null);
  const [uploadingDaily, setUploadingDaily] = useState(false);
  const [dailyStatus, setDailyStatus] = useState("Berangkat");
  const [dailyNote, setDailyNote] = useState("");
  const [gpsState, setGpsState] = useState("unknown"); // granted | denied | prompt | unknown
  const cachedGps = useRef(null); // posisi terakhir dari watchPosition
  const [gpsOnboarding, setGpsOnboarding] = useState(() => {
    // Tampilkan onboarding kalau GPS belum pernah diizinkan di device ini
    try { return localStorage.getItem("aal_gps_granted") !== "1"; } catch { return true; }
  });

  // Pantau izin lokasi agar bisa tuntun driver menyalakan GPS.
  useEffect(() => {
    let perm;
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" })
        .then((res) => { perm = res; setGpsState(res.state); res.onchange = () => setGpsState(res.state); })
        .catch(() => {});
    }
    return () => { if (perm) perm.onchange = null; };
  }, []);

  // watchPosition di background — simpan posisi terbaru ke cachedGps, jalan terus selama sesi
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        cachedGps.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsState("granted");
        try { localStorage.setItem("aal_gps_granted", "1"); } catch {}
        setGpsOnboarding(false);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const requestGps = () => {
    if (!("geolocation" in navigator)) { setGpsState("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        cachedGps.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsState("granted");
        setGpsOnboarding(false);
        try { localStorage.setItem("aal_gps_granted", "1"); } catch {}
        showToast("GPS aktif! Foto checkpoint siap dicatat.");
      },
      (err) => {
        setGpsState(err && err.code === 1 ? "denied" : "prompt");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };
  const [uploadingBastk, setUploadingBastk] = useState(false);
  const [uploadingResi, setUploadingResi] = useState(false);
  const [cairingTahap, setCairingTahap] = useState(0);
  const [cropData, setCropData] = useState(null); // { url, file, onDone }

  const fileRefs = useRef({});

  // Buka modal crop untuk gambar; PDF langsung lanjut tanpa crop
  // Luruskan orientasi EXIF -> JPEG upright, supaya preview & crop tidak kebalik.
  const normalizeImage = async (file) => {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.95));
      return blob ? new File([blob], (file.name || "img").replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
    } catch { return file; }
  };

  const openCrop = async (file, onDone) => {
    if (!file) return;
    // PDF -> skip crop. Sisanya (termasuk foto kamera yg type-nya kosong) -> crop.
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    if (isPdf) { onDone(file); return; }
    const norm = await normalizeImage(file);
    setCropData({ url: URL.createObjectURL(norm), file: norm, onDone });
  };

  // Real-time clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Init trip on mount (idempotent)
  useEffect(() => {
    if (!params.trip || (!params.nopol && !params.rangka)) {
      setError("Link tidak lengkap. Hubungi admin via WA 0818-631-135.");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const res = await axios.post(`${API}/trips/init`, {
          trip_id: params.trip,
          driver_id: params.driver,
          nopol: params.nopol,
          route: params.route,
          uj: params.uj,
          t1: params.t1,
          t2: params.t2,
          t3: params.t3,
          tipe_kendaraan: params.tipe,
          no_rangka: params.rangka,
          legs: params.legs,
        });
        setTrip(res.data);
      } catch (e) {
        setError("Gagal memuat data perjalanan. Coba refresh halaman.");
      } finally {
        setLoading(false);
      }
    })();
  }, [params]);

  const showToast = (msg, type="ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  const showCelebration = () => {
    setCelebration(true);
    setTimeout(() => setCelebration(false), 5000);
  };

  const reload = async () => {
    if (!trip?.trip_id) return;
    try {
      const r = await axios.get(`${API}/trips/${trip.trip_id}`);
      setTrip(r.data);
    } catch {}
  };

  const submitNama = async () => {
    const n = namaInput.trim();
    if (!n) { showToast("Isi nama dulu ya", "err"); return; }
    setSavingName(true);
    try {
      const r = await axios.post(`${API}/trips/${trip.trip_id}/driver-name`, { nama: n });
      setTrip(r.data);
      showToast("Halo " + n + ", semangat ya!");
    } catch {
      showToast("Gagal simpan nama. Coba lagi.", "err");
    } finally { setSavingName(false); }
  };

  const markSOP = async () => {
    try {
      await axios.post(`${API}/trips/${trip.trip_id}/sop-read`);
      setTrip((t) => ({ ...t, sop_read: true }));
      setShowSOP(false);
      showToast("Mantap, SOP sudah dibaca!");
    } catch {}
  };

  const triggerFile = (key) => {
    const el = fileRefs.current[key];
    if (el) { el.value = ""; el.click(); }
  };

  // Ambil GPS (best-effort) + cap lokasi & waktu ke dalam foto.
  // Dipakai untuk foto awal wizard dan checkpoint harian.
  const geotagPhoto = async (file) => {
    // Coba dapat posisi fresh, fallback ke cachedGps dari watchPosition
    const gps = await new Promise((resolve) => {
      if (!("geolocation" in navigator)) return resolve(cachedGps.current);
      const timer = setTimeout(() => resolve(cachedGps.current), 5000);
      navigator.geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        () => { clearTimeout(timer); resolve(cachedGps.current); },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 }
      );
    });
    const now = new Date();
    const tgl = now.toLocaleDateString("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric" });
    const jam = now.toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/[:.]/g, ".");
    const lines = [`${tgl} ${jam} WIB`];
    if (gps) {
      const addr = await reverseGeocode(gps.lat, gps.lng);
      addr.forEach((l) => lines.push(l));
      if (addr.length === 0) lines.push(`${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`);
    }
    if (trip?.nopol) lines.push(trip.nopol);
    const stamped = await stampPhoto(file, lines);
    return { file: stamped, gps };
  };

  const uploadInitial = async (slot, file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Foto terlalu besar (max 8MB)", "err"); return; }
    setUploadingSlot(slot);
    try {
      const { file: stamped } = await geotagPhoto(file);
      const fd = new FormData();
      fd.append("slot", slot);
      fd.append("foto", stamped);
      const r = await axios.post(`${API}/trips/${trip.trip_id}/photos/initial`, fd);
      setTrip(r.data);
      showToast("Foto " + SLOT_LABELS[slot] + " tersimpan");
    } catch (e) {
      showToast("Upload gagal. Coba lagi.", "err");
    } finally { setUploadingSlot(null); }
  };

  const uploadDaily = async (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Foto terlalu besar (max 8MB)", "err"); return; }
    setUploadingDaily(true);
    try {
      const { file: stamped, gps } = await geotagPhoto(file);
      const fd = new FormData();
      fd.append("foto", stamped);
      if (gps) {
        fd.append("lat", String(gps.lat));
        fd.append("lng", String(gps.lng));
      }
      if (dailyStatus) fd.append("status", dailyStatus);
      if (dailyNote.trim()) fd.append("keterangan", dailyNote.trim());
      const r = await axios.post(`${API}/trips/${trip.trip_id}/photos/daily`, fd);
      setTrip(r.data);
      showToast(gps
        ? "Checkpoint + lokasi terkirim! Bonus Rp 30.000 diproses."
        : "Checkpoint terkirim (tanpa GPS). Bonus Rp 30.000 diproses.");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Upload gagal";
      showToast(msg, "err");
    } finally { setUploadingDaily(false); }
  };

  const uploadBastk = async (file) => {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { showToast("File terlalu besar (max 15MB)", "err"); return; }
    setUploadingBastk(true);
    showToast("Memproses scan dokumen...");
    try {
      const enhanced = file.type.startsWith("image/") ? await scanEnhance(file) : file;
      const fd = new FormData();
      fd.append("foto", enhanced);
      const prevComplete = !!(trip?.handover?.bastk && trip?.handover?.resi);
      const r = await axios.post(`${API}/trips/${trip.trip_id}/photos/handover-bastk`, fd);
      setTrip(r.data);
      if (!prevComplete && r.data?.handover?.bastk && r.data?.handover?.resi) {
        showCelebration();
      } else {
        showToast("BASTK terupload");
      }
    } catch (e) {
      const msg = e?.response?.data?.detail || "Upload gagal";
      showToast(msg, "err");
    } finally { setUploadingBastk(false); }
  };

  const uploadResi = async (file) => {
    if (!file) return;
    setUploadingResi(true);
    showToast("Memproses scan dokumen...");
    try {
      const enhanced = file.type.startsWith("image/") ? await scanEnhance(file) : file;
      const fd = new FormData();
      fd.append("foto", enhanced);
      const prevComplete = !!(trip?.handover?.bastk && trip?.handover?.resi);
      const r = await axios.post(`${API}/trips/${trip.trip_id}/photos/handover-resi`, fd);
      setTrip(r.data);
      if (!prevComplete && r.data?.handover?.bastk && r.data?.handover?.resi) {
        showCelebration();
      } else {
        showToast("Foto Resi terupload");
      }
    } catch (e) {
      showToast("Upload gagal", "err");
    } finally { setUploadingResi(false); }
  };

  const requestCair = async (tahap) => {
    setCairingTahap(tahap);
    try {
      const r = await axios.post(`${API}/trips/${trip.trip_id}/cair`, { tahap });
      setTrip(r.data);
      showToast("Tahap " + tahap + " diajukan. Admin akan transfer.");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Belum bisa cair";
      showToast(msg, "err");
    } finally { setCairingTahap(0); }
  };

  const [albumStage, setAlbumStage] = useState("asal");
  const [albumUploading, setAlbumUploading] = useState(false);
  const uploadAlbum = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (albumStage !== "dokumen" && isPdf) {
      showToast("PDF cuma boleh di tab Dokumen", "err");
      return;
    }
    if (file.size > 15 * 1024 * 1024) { showToast("File terlalu besar (max 15MB)", "err"); return; }
    setAlbumUploading(true);
    try {
      const fd = new FormData();
      fd.append("stage", albumStage);
      fd.append("foto", file);
      fd.append("uploaded_by", "driver");
      const r = await axios.post(`${API}/trips/${trip.trip_id}/album`, fd);
      setTrip(r.data);
      showToast("Foto " + albumStageLabel(albumStage) + " terupload");
    } catch (e) {
      const msg = e?.response?.data?.detail || "Upload gagal";
      showToast(msg, "err");
    } finally { setAlbumUploading(false); }
  };
  const deleteAlbum = async (stage, photoId) => {
    if (!window.confirm("Hapus foto ini?")) return;
    try {
      const r = await axios.delete(`${API}/trips/${trip.trip_id}/album/${stage}/${photoId}`);
      setTrip(r.data);
      showToast("Foto dihapus");
    } catch {
      showToast("Gagal hapus", "err");
    }
  };

  const resetToday = async () => {
    if (!window.confirm("Reset foto hari ini? (testing only)")) return;
    try {
      const r = await axios.delete(`${API}/trips/${trip.trip_id}/daily/today`);
      setTrip(r.data);
      showToast("Foto hari ini direset");
    } catch {}
  };

  const shareWA = () => {
    const phone = "6281863115";
    const txt = `Halo Admin, lapor posisi unit ${trip?.nopol}.\nNama: ${trip?.nama_driver || "-"}\nRute: ${trip?.route || "-"}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(txt)}`, "_blank");
  };

  // ── GPS ONBOARDING — fullscreen, muncul sekali sampai GPS diizinkan ──
  if (gpsOnboarding && gpsState !== "granted") {
    return (
      <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#0d1117", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ background: "#161b22", padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, borderBottom: "1px solid #21262d" }}>
          <Logo size={36} />
          <div style={{ fontWeight: 800, fontSize: 15, color: "#EF9F27" }}>Alyssa Auto Logistik</div>
        </div>

        <div style={{ flex: 1, padding: "28px 20px", display: "flex", flexDirection: "column" }}>
          {/* Title */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <div style={{ fontSize: 52, marginBottom: 12 }}>📍</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#FFD060", lineHeight: 1.2, marginBottom: 8 }}>
              AKTIFKAN LOKASI DULU
            </div>
            <div style={{ fontSize: 15, color: "#8b949e", lineHeight: 1.5 }}>
              Wajib sekali saja — setelah itu GPS aktif terus otomatis
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
            {[
              { no: "1", judul: "TAP TOMBOL KUNING DI BAWAH", isi: "Nanti muncul kotak izin dari HP kamu" },
              { no: "2", judul: 'PILIH "SAAT APLIKASI DIGUNAKAN"', isi: "Bukan Hanya kali ini — bukan Jangan izinkan" },
              { no: "3", judul: "SELESAI — GPS AKTIF TERUS", isi: "Semua foto checkpoint otomatis tercatat lokasinya" },
            ].map(s => (
              <div key={s.no} style={{ display: "flex", gap: 16, alignItems: "flex-start", background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ minWidth: 44, height: 44, borderRadius: 10, background: "#EF9F27", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 22 }}>{s.no}</div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 900, color: "#e6edf3", marginBottom: 4 }}>{s.judul}</div>
                  <div style={{ fontSize: 13, color: "#8b949e", lineHeight: 1.5 }}>{s.isi}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Warning box */}
          <div style={{ background: "#2d1a1a", border: "1px solid #f85149", borderRadius: 10, padding: "12px 16px", marginBottom: 24, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#f85149", fontWeight: 700, lineHeight: 1.5 }}>
              Kalau tidak diizinkan → foto tidak ada GPS → pelanggan komplain → bonus tidak cair
            </div>
          </div>

          {gpsState === "denied" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ background: "#3B0A0A", border: "2px solid #f85149", borderRadius: 12, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: 900, color: "#FF6B6B", marginBottom: 8 }}>LOKASI DIBLOKIR</div>
                <div style={{ fontSize: 14, color: "#F5C6C6", lineHeight: 1.6 }}>
                  Buka <b>Setelan HP → Aplikasi → Browser → Izin → Lokasi → Izinkan</b><br/>lalu kembali ke sini dan muat ulang halaman
                </div>
              </div>
              <button onClick={() => window.location.reload()} style={{ padding: "16px", borderRadius: 12, border: "none", background: "#f85149", color: "#fff", fontWeight: 900, fontSize: 17, cursor: "pointer" }}>
                MUAT ULANG SETELAH IZIN DIBERIKAN
              </button>
            </div>
          ) : (
            <button onClick={requestGps} style={{ padding: "20px", borderRadius: 14, border: "none", background: "#EF9F27", color: "#000", fontWeight: 900, fontSize: 19, cursor: "pointer", boxShadow: "0 4px 20px #EF9F2755" }}>
              TAP DI SINI — IZINKAN LOKASI
            </button>
          )}

          <div style={{ textAlign: "center", marginTop: 16, fontSize: 12, color: "#484f58" }}>
            Izin lokasi hanya dipakai untuk cap foto checkpoint · Tidak disimpan ke server lain
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="drv-loading">Memuat…</div>;
  }
  if (error) {
    return (
      <div className="drv-root">
        <header className="drv-header">
          <div className="drv-brand">
            <Logo size={36} />
            <div>
              <div className="drv-brand-name">Driver Checkpoint</div>
              <div className="drv-brand-sub">Alyssa Auto Logistik</div>
            </div>
          </div>
        </header>
        <div style={{ textAlign:"center", padding:"48px 24px" }} data-testid="drv-error">
          <div style={{ marginBottom:16 }}>
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none"><circle cx="28" cy="28" r="26" stroke="#D4A847" strokeWidth="2"/><path d="M28 17v14M28 37h.01" stroke="#D4A847" strokeWidth="2.5" strokeLinecap="round"/></svg>
          </div>
          <h2 style={{ color:"#D4A847", marginBottom:8 }}>Link Tidak Valid</h2>
          <p style={{ color:"#8aa3c4", marginBottom:4 }}>{error}</p>
          <p style={{ color:"#8aa3c4", marginBottom:24 }}>Minta link yang benar dari admin PT Alyssa Auto Logistik.</p>
          <a href="/" style={{ color:"#D4A847", textDecoration:"none", marginRight:16 }}>← Beranda</a>
          <a href="https://wa.me/628186311350" target="_blank" rel="noreferrer"
             style={{ background:"#16a34a", color:"#fff", padding:"8px 16px", borderRadius:8, textDecoration:"none", fontSize:14 }}>
            Hubungi via WhatsApp
          </a>
        </div>
      </div>
    );
  }
  if (!trip) {
    return <div className="drv-error">Trip tidak ditemukan.</div>;
  }

  // ===== STEP 1: NAMA (full-screen, premium) =====
  if (!trip.nama_driver) {
    return (
      <div className="drv-root drv-step-screen" data-testid="drv-name-screen">
        <div className="drv-step-card" data-testid="name-card">
          <Logo size={100} />
          <div className="drv-step-brand">ALYSSA LOGISTIK</div>
          <div className="drv-step-form">
            <div className="drv-step-greet">Halo Driver!</div>
            <div className="drv-step-greet-sub">Masukkan nama lengkap sesuai KTP</div>
            <label className="drv-step-label" htmlFor="drv-nama-input">NAMA LENGKAP</label>
            <input
              id="drv-nama-input"
              type="text"
              placeholder="Nama sesuai KTP"
              value={namaInput}
              onChange={(e) => setNamaInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitNama(); }}
              className="drv-step-input"
              autoComplete="name"
              autoFocus
              data-testid="input-nama"
            />
            <button
              className="drv-step-cta"
              onClick={submitNama}
              disabled={savingName}
              data-testid="btn-save-nama"
            >
              {savingName ? "Menyimpan..." : "Lanjut →"}
            </button>
            <div className="drv-step-footnote">Data rekening akan diisi oleh admin</div>
          </div>
          {(isRealPlate(trip.nopol) || trip.no_rangka) && (
            <div className="drv-step-trip-pill" data-testid="drv-step-nopol">
              <span>UNIT</span><b>{isRealPlate(trip.nopol) ? trip.nopol : `Rangka ${trip.no_rangka}`}</b>
            </div>
          )}
        </div>
        {toast && (
          <div className={`drv-toast ${toast.type === "err" ? "drv-toast-err" : "drv-toast-ok"}`} data-testid="toast">
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  // ===== STEP 2: SOP (full-screen, forced) =====
  if (!trip.sop_read) {
    return (
      <div className="drv-root drv-step-screen drv-step-sop" data-testid="drv-sop-screen">
        <div className="drv-sop-banner">
          <div className="drv-sop-warn">!</div>
          <div className="drv-sop-banner-title">WAJIB BACA SEBELUM JALAN!</div>
          <div className="drv-sop-banner-sub">7 PERINTAH DRIVER ALYSSA</div>
        </div>
        <ol className="drv-sop-points">
          {SOP_POINTS.map((p, i) => (
            <li key={i} className="drv-sop-point">
              <div className="drv-sop-num">{i + 1}</div>
              <div className="drv-sop-body"><b>{p.title}:</b> {p.body}</div>
            </li>
          ))}
        </ol>
        <div className="drv-sop-emergency">
          <div className="drv-sop-emergency-icon">!</div>
          <div className="drv-sop-emergency-text">
            <b>DARURAT:</b> Jika mobil mogok atau ada kendala berat, <b>DILARANG</b> bongkar/perbaiki sendiri tanpa izin kantor! Hubungi admin: <b>0818 631 135</b>
          </div>
        </div>
        <button className="drv-sop-accept" onClick={markSOP} data-testid="btn-sop-ok">
          <span className="drv-sop-accept-emoji">✓</span>
          <div className="drv-sop-accept-text">
            <div className="drv-sop-accept-main">Saya Sudah Baca &amp; Setuju</div>
            <div className="drv-sop-accept-sub">Tap tombol ini untuk lanjut</div>
          </div>
        </button>
        {toast && (
          <div className={`drv-toast ${toast.type === "err" ? "drv-toast-err" : "drv-toast-ok"}`} data-testid="toast">
            {toast.msg}
          </div>
        )}
      </div>
    );
  }

  const hh = pad(now.getHours()), mm = pad(now.getMinutes()), ss = pad(now.getSeconds());
  const dayName = ID_DAYS[now.getDay()];

  const initial = trip.initial_photos || {};
  const initialDone = SLOT_ORDER.filter((s) => initial[s]).length;
  const allInitialDone = initialDone === 5;

  const daily = trip.daily_checkpoints || [];
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  })();
  const todayDone = daily.some((c) => c.date === todayStr);
  const dailyCount = daily.length;
  const totalBonusDaily = dailyCount * (trip.bonus_daily || 30000);

  const handover = trip.handover || { bastk: [], resi: null };
  const bastkList = handover.bastk || [];
  const resi = handover.resi;
  const handoverDone = bastkList.length > 0 && !!resi;

  const cair = trip.cair || {};

  return (
    <div className="drv-root" data-testid="drv-root">
      {/* HEADER */}
      <header className="drv-header" data-testid="drv-header">
        <div className="drv-brand">
          <Logo size={36} />
          <div>
            <div className="drv-brand-name">Alyssa Logistik</div>
            <div className="drv-brand-sub">Driver Checkpoint</div>
          </div>
        </div>
        <div className="drv-clock" data-testid="drv-clock">
          <span className="drv-clock-time">{hh}:{mm}:{ss}</span>
          <span className="drv-clock-date">{dayName}, {todayIso()}</span>
        </div>
      </header>

      {/* TRIP INFO BANNER */}
      <section className="drv-trip-banner" data-testid="trip-banner">
        <div className="drv-nopol-wrap">
          <div className="drv-nopol-lbl">{isRealPlate(trip.nopol) ? "Nomor Polisi" : "No. Rangka"}</div>
          <div className="drv-nopol" data-testid="drv-nopol">
            {isRealPlate(trip.nopol) ? trip.nopol : (trip.no_rangka || trip.nopol || "—")}
          </div>
          {trip.tipe_kendaraan && (
            <div className="drv-tipe" data-testid="drv-tipe">
              {trip.tipe_kendaraan}
              {isRealPlate(trip.nopol) && trip.no_rangka ? <span className="drv-rangka"> · Rangka {trip.no_rangka}</span> : null}
            </div>
          )}
          {trip.route && <div className="drv-route">{trip.route}</div>}
        </div>
        <div className="drv-greet">
          <div className="drv-greet-lbl">Halo,</div>
          <div className="drv-greet-name" data-testid="drv-greet-name">{trip.nama_driver}</div>
        </div>
      </section>

      {/* PENGUMUMAN: AKTIFKAN GPS */}
      {gpsState !== "granted" ? (
        <section style={{ margin: "0 0 0", background: gpsState === "denied" ? "#3B0A0A" : "#2B1A00", borderBottom: `4px solid ${gpsState === "denied" ? "#f85149" : "#D4A847"}`, padding: "20px 20px 24px" }} data-testid="gps-banner">

          <div style={{ fontSize: 22, fontWeight: 900, color: gpsState === "denied" ? "#FF6B6B" : "#FFD060", marginBottom: 6, lineHeight: 1.2 }}>
            {gpsState === "denied" ? "GPS DIBLOKIR — HARUS DIIZINKAN" : "AKTIFKAN LOKASI SEKARANG"}
          </div>
          <div style={{ fontSize: 15, color: "#EAD9B0", marginBottom: 20, lineHeight: 1.5 }}>
            Foto checkpoint WAJIB pakai GPS. Kalau tidak aktif, lokasi tidak tercatat dan bisa kena teguran admin.
          </div>

          {gpsState === "denied" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                "BUKA Setelan di HP kamu",
                "Cari menu APLIKASI atau IZIN APLIKASI",
                "Pilih nama Browser kamu (Chrome / Firefox dll)",
                "Tap IZIN lalu tap LOKASI",
                "Pilih IZINKAN SAAT MENGGUNAKAN APLIKASI",
                "Kembali ke halaman ini lalu MUAT ULANG",
              ].map((txt, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 36, height: 36, borderRadius: 8, background: "#f85149", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18 }}>{i + 1}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#F5C6C6", lineHeight: 1.4, paddingTop: 6 }}>{txt}</div>
                </div>
              ))}
              <button onClick={() => window.location.reload()} style={{ marginTop: 8, width: "100%", padding: "16px", background: "#f85149", color: "#fff", border: "none", borderRadius: 12, fontWeight: 900, fontSize: 17, cursor: "pointer" }}>
                MUAT ULANG SETELAH IZIN DIBERIKAN
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                "Geser layar HP dari ATAS KE BAWAH buka notifikasi cepat",
                "Cari tulisan LOKASI lalu TAP sampai menyala atau aktif",
                "Kembali ke halaman ini lalu tekan tombol kuning di bawah",
                "Muncul kotak izin — pilih yang PALING ATAS yaitu IZINKAN",
              ].map((txt, i) => (
                <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 36, height: 36, borderRadius: 8, background: "#D4A847", color: "#1A1206", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18 }}>{i + 1}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#EAD9B0", lineHeight: 1.4, paddingTop: 6 }}>{txt}</div>
                </div>
              ))}
              <button onClick={requestGps} style={{ marginTop: 8, width: "100%", padding: "16px", background: "#D4A847", color: "#1A1206", border: "none", borderRadius: 12, fontWeight: 900, fontSize: 17, cursor: "pointer" }} data-testid="btn-gps">
                TAP DI SINI UNTUK IZINKAN LOKASI
              </button>
            </div>
          )}
        </section>
      ) : (
        <div style={{ margin: "0 16px 14px", background: "#13351F", border: "1px solid #2ea043", borderRadius: 12, padding: "12px 16px", color: "#56d364", fontSize: 15, fontWeight: 700 }} data-testid="gps-ok">
          LOKASI AKTIF — foto checkpoint otomatis tercatat koordinatnya
        </div>
      )}

      {/* RUTE PENGIRIMAN (LEGS) */}
      {trip.nama_driver && Array.isArray(trip.legs) && trip.legs.length > 0 && (
        <section className="drv-card" data-testid="legs-card">
          <div className="drv-card-head"><span>Rute Pengiriman</span></div>
          <div className="drv-card-body drv-legs">
            {trip.legs.map((leg, i) => (
              <div key={i} className="drv-leg-row" data-testid={`leg-${i}`}>
                <div className="drv-leg-num">{i + 1}</div>
                <div className="drv-leg-info">
                  <div className="drv-leg-jalur">{leg.jalur || "—"}</div>
                  <div className="drv-leg-route">
                    <span>{leg.asal || "?"}</span>
                    <span className="drv-leg-arrow">→</span>
                    <span>{leg.tujuan || "?"}</span>
                  </div>
                  {leg.kapal && <div className="drv-leg-vendor">{leg.kapal}</div>}
                </div>
                <span className={`drv-leg-status drv-leg-status-${(leg.status||"menunggu").toLowerCase().replace(/\s+/g,"-")}`}>
                  {leg.status || "Menunggu"}
                </span>
              </div>
            ))}
            <div className="drv-note">Status leg di-update oleh admin saat unit jalan/tiba. Driver fokus upload foto &amp; dokumen.</div>
          </div>
        </section>
      )}

      {/* BACA ULANG SOP (kecil, opsional) */}
      <section className="drv-card" data-testid="sop-card">
        <div className="drv-card-head">
          <span>SOP Driver</span>
          <span className="drv-pill drv-pill-ok">Sudah Dibaca</span>
        </div>
        <div className="drv-card-body">
          <button className="drv-btn drv-btn-ghost" onClick={() => setShowSOP(true)} data-testid="btn-baca-sop">
            Baca Ulang SOP
          </button>
        </div>
      </section>

      {/* INITIAL PHOTOS (5 foto wajib) */}
      {trip.nama_driver && (
        <section className="drv-card" data-testid="initial-card">
          <div className="drv-card-head">
            <span>Foto Awal Wajib ({initialDone}/5)</span>
            {allInitialDone && <span className="drv-pill drv-pill-ok">Lengkap</span>}
          </div>
          <div className="drv-card-body">
            {/* input kamera tersembunyi untuk tiap slot */}
            {SLOT_GUIDE_ORDER.map((slot) => (
              <input
                key={slot}
                ref={(el) => fileRefs.current[`init-${slot}`] = el}
                type="file" accept="image/*"
                onChange={(e) => uploadInitial(slot, e.target.files?.[0])}
                style={{ display: "none" }}
              />
            ))}

            {!allInitialDone ? (() => {
              const idx = SLOT_GUIDE_ORDER.findIndex((s) => !initial[s]);
              const slot = SLOT_GUIDE_ORDER[idx];
              const g = SLOT_GUIDE[slot];
              const isUp = uploadingSlot === slot;
              const doneSlots = SLOT_GUIDE_ORDER.filter((s) => initial[s]);
              return (
                <div data-testid="init-wizard">
                  <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                    {SLOT_GUIDE_ORDER.map((s, i) => (
                      <div key={s} style={{ flex: 1, height: 6, borderRadius: 4, background: initial[s] ? "#56d364" : (i === idx ? "#D4A847" : "rgba(255,255,255,0.13)") }} />
                    ))}
                  </div>
                  <div style={{ textAlign: "center", color: "#9FB2CC", fontSize: 13, marginBottom: 4 }}>Foto {idx + 1} dari 5</div>
                  <div style={{ textAlign: "center", fontSize: 64, lineHeight: 1.1, margin: "6px 0" }}>{g.emoji}</div>
                  <div style={{ textAlign: "center", fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 12 }}>{g.title}</div>
                  <div style={{ background: "rgba(212,168,71,0.08)", border: "1.5px solid #D4A847", borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
                    {g.tips.map((tip, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, color: "#EAD9B0", fontSize: 14.5, padding: "3px 0" }}>
                        <span style={{ fontSize: 16 }}>{i === 0 ? "📍" : "📸"}</span><b>{tip}</b>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => triggerFile(`init-${slot}`)}
                    disabled={isUp}
                    style={{ width: "100%", padding: "15px", background: "#1DB954", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 17, cursor: "pointer" }}
                    data-testid={`btn-slot-${slot}`}
                  >
                    📸 {isUp ? "Mengirim..." : "Ambil Foto Sekarang"}
                  </button>
                  {doneSlots.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                      {doneSlots.map((s) => (
                        <button key={s} onClick={() => triggerFile(`init-${s}`)} title={`Ganti ${SLOT_LABELS[s]}`}
                          style={{ position: "relative", border: "1.5px solid #2ea043", borderRadius: 8, padding: 0, background: "none", cursor: "pointer", width: 58, height: 58, overflow: "hidden" }}>
                          <img src={resolveUrl(initial[s].url)} alt={s} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                          <span style={{ position: "absolute", top: 2, right: 2, background: "#2ea043", color: "#fff", borderRadius: "50%", width: 16, height: 16, fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="drv-note" style={{ marginTop: 14 }}>Setelah 5 foto lengkap, Tahap 1 (Rp {(trip.t1||0).toLocaleString("id-ID")}) langsung cair.</div>
                </div>
              );
            })() : (
              <div data-testid="init-done">
                <div style={{ textAlign: "center", color: "#56d364", fontSize: 15, fontWeight: 700, marginBottom: 12 }}>✓ Semua 5 foto sudah lengkap!</div>
                <div className="drv-slot-grid">
                  {SLOT_GUIDE_ORDER.map((slot) => (
                    <div key={slot} className="drv-slot drv-slot-done" data-testid={`slot-${slot}`}>
                      <img src={resolveUrl(initial[slot].url)} alt={slot} />
                      <div className="drv-slot-check">✓</div>
                      <button className="drv-slot-overlay" onClick={() => triggerFile(`init-${slot}`)} data-testid={`btn-slot-${slot}`}>
                        <div className="drv-slot-label">{SLOT_LABELS[slot]}</div>
                        <div className="drv-slot-cta">Ganti Foto</div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ALBUM PERJALANAN (Asal / Dalam Kapal / Tujuan / Dokumen) */}
      {trip.nama_driver && (
        <section className="drv-card" data-testid="album-card">
          <div className="drv-card-head">
            <span>Album Perjalanan</span>
            <span className="drv-pill drv-pill-ready">{(trip.album?.[albumStage] || []).length} foto</span>
          </div>
          <div className="drv-album-tabs" role="tablist">
            {ALBUM_STAGES.map((s) => (
              <button
                key={s}
                role="tab"
                className={`drv-album-tab ${albumStage === s ? "active" : ""}`}
                onClick={() => setAlbumStage(s)}
                data-testid={`album-tab-${s}`}
              >
                <span>{albumStageLabel(s)}</span>
                <span className="drv-album-tab-count">{(trip.album?.[s] || []).length}</span>
              </button>
            ))}
          </div>
          <div className="drv-card-body">
            <input
              ref={(el) => fileRefs.current["album"] = el}
              type="file"
              accept={albumStage === "dokumen" ? "image/*,application/pdf" : "image/*"}
              capture={undefined}
              onChange={(e) => uploadAlbum(e.target.files?.[0])}
              style={{ display: "none" }}
            />
            {(trip.album?.[albumStage] || []).length === 0 ? (
              <div className="drv-album-empty">
                <div>Belum ada foto {albumStageLabel(albumStage)}.</div>
              </div>
            ) : (
              <div className="drv-album-grid" data-testid={`album-grid-${albumStage}`}>
                {(trip.album[albumStage] || []).map((p) => {
                  const isPdf = (p.url || "").toLowerCase().endsWith(".pdf");
                  return (
                    <div key={p.id} className="drv-album-item" data-testid={`album-item-${p.id}`}>
                      <a href={resolveUrl(p.url)} target="_blank" rel="noreferrer">
                        {isPdf
                          ? <div className="drv-doc-pdf">PDF</div>
                          : <img src={resolveUrl(p.url)} alt={albumStage} />}
                      </a>
                      <button
                        className="drv-album-del"
                        onClick={() => deleteAlbum(albumStage, p.id)}
                        data-testid={`btn-del-${p.id}`}
                        title="Hapus foto"
                      >×</button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              className="drv-btn drv-btn-blue drv-btn-block"
              onClick={() => triggerFile("album")}
              disabled={albumUploading}
              data-testid={`btn-album-upload-${albumStage}`}
            >
              {albumUploading
                ? "Mengupload..."
                : (albumStage === "dokumen"
                    ? "Tambah Foto / PDF Dokumen"
                    : `Tambah Foto ${albumStageLabel(albumStage)}`)}
            </button>
            <div className="drv-note">
              {albumStage === "dokumen"
                ? "Upload foto/PDF dokumen seperti surat jalan, BAST, copy STNK, dll. Admin & pelanggan akan lihat di sini."
                : "Foto di tahap ini langsung muncul di PO Admin & dilihat pelanggan via link tracking."}
            </div>
          </div>
        </section>
      )}

      {/* REMINDER 06:00 WIB — kalau hari ini belum upload */}
      {trip.nama_driver && allInitialDone && !todayDone && (() => {
        const wibNow = new Date(Date.now() + (new Date().getTimezoneOffset() + 7 * 60) * 60000);
        const wibHour = wibNow.getHours();
        const isWindow = wibHour >= 6 && wibHour < 18;
        const isLate = wibHour >= 18;
        return (
          <section className={`drv-reminder ${isLate ? "drv-reminder-late" : (isWindow ? "drv-reminder-now" : "drv-reminder-soon")}`} data-testid="daily-reminder">
            <div className="drv-reminder-icon">{isLate ? "!" : (isWindow ? "CAM" : "~")}</div>
            <div className="drv-reminder-text">
              <b>
                {isLate ? "TERLAMBAT! Foto deadline lewat" : (isWindow ? "WAKTUNYA FOTO CHECKPOINT" : "Reminder Besok Pagi")}
              </b>
              <div>
                {isLate
                  ? "Window 06:00–18:00 WIB sudah lewat. Tetap foto sekarang untuk catat lokasi, tapi bonus harian besok ya."
                  : (isWindow
                      ? `Window aktif sampai 18:00 WIB. Sisa ${17 - wibHour} jam lagi. Tap kamera di bawah!`
                      : "Jangan lupa foto checkpoint besok jam 06:00–18:00 WIB untuk dapat bonus Rp 30.000.")}
              </div>
            </div>
          </section>
        );
      })()}

      {/* DAILY CHECKPOINT */}
      {trip.nama_driver && allInitialDone && (
        <section className="drv-card drv-card-checkpoint" data-testid="daily-card">
          <div className="drv-checkpoint-stats">
            <div className="drv-checkpoint-count" data-testid="daily-count">{dailyCount}</div>
            <div className="drv-checkpoint-lbl">Foto Checkpoint Terkirim</div>
            <div className="drv-checkpoint-bonus">Total bonus foto: <b>{fmtIDR(totalBonusDaily)}</b></div>
          </div>

          <input
            ref={(el) => fileRefs.current["daily"] = el}
            type="file"
            accept="image/*"
            onChange={(e) => uploadDaily(e.target.files?.[0])}
            style={{ display: "none" }}
          />

          {/* Status + keterangan inputs (sebelum tap tombol kamera) */}
          {!todayDone && (
            <div className="drv-daily-form" data-testid="daily-status-form">
              <label className="drv-step-label">STATUS PERJALANAN</label>
              <select
                className="drv-step-input"
                value={dailyStatus}
                onChange={(e) => setDailyStatus(e.target.value)}
                data-testid="select-daily-status"
              >
                <option value="Berangkat">Berangkat</option>
                <option value="Checkpoint 1">Checkpoint 1</option>
                <option value="Checkpoint 2">Checkpoint 2</option>
                <option value="Checkpoint 3">Checkpoint 3</option>
                <option value="Tiba Tujuan">Tiba Tujuan</option>
              </select>
              <label className="drv-step-label" style={{ marginTop: 8 }}>KETERANGAN (OPSIONAL)</label>
              <input
                type="text"
                className="drv-step-input"
                placeholder="Cth: Sudah lewat Cikampek, lalin lancar"
                value={dailyNote}
                onChange={(e) => setDailyNote(e.target.value)}
                maxLength={200}
                data-testid="input-daily-note"
              />
            </div>
          )}

          <button
            className={`drv-daily-btn ${todayDone ? "drv-daily-done" : ""}`}
            onClick={() => !todayDone && triggerFile("daily")}
            disabled={uploadingDaily || todayDone}
            data-testid="btn-daily"
          >
            <div className="drv-daily-icon">
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden><path d="M4 10.5c0-1.1.9-2 2-2h1.5l1.5-2.5h10L20.5 8.5H22c1.1 0 2 .9 2 2V21c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V10.5z" stroke="currentColor" strokeWidth="1.8"/><circle cx="14" cy="15" r="3.5" stroke="currentColor" strokeWidth="1.8"/></svg>
            </div>
            <div className="drv-daily-text">
              {uploadingDaily ? "Mengupload..." : (todayDone ? "SUDAH HARI INI ✅" : "BELUM HARI INI")}
            </div>
          </button>

          {todayDone ? (
            <div className="drv-alert drv-alert-ok">
              <b>✓ Foto hari ini sudah terkirim!</b>
              <div>Bonus Rp 30.000 sedang diproses. Foto lagi besok jam 06.00 – 18.00 sore.</div>
            </div>
          ) : (
            <div className="drv-alert drv-alert-info">
              <b>Belum ada foto hari ini.</b>
              <div>Foto depan kendaraan (NoPol kelihatan) untuk klaim bonus Rp 30.000.</div>
            </div>
          )}

          <button className="drv-btn drv-btn-wa" onClick={shareWA} data-testid="btn-wa">Kirim Lokasi ke Admin via WA</button>
          <button className="drv-btn drv-btn-tester" onClick={resetToday} data-testid="btn-reset-today">↺ Reset Foto Hari Ini (tester)</button>

          <div className="drv-bonus-kerajinan">
            <div className="drv-bonus-lbl">BONUS KERAJINAN</div>
            <div className="drv-bonus-amt">+{fmtIDR(trip.bonus_kerajinan || 150000)}</div>
            <div className="drv-bonus-note">Kalau rajin foto tiap hari sampai tiba</div>
          </div>
        </section>
      )}

      {/* PROOF OF DELIVERY (Daily checkpoint list with map+info) */}
      {trip.nama_driver && daily.length > 0 && (
        <section className="drv-card" data-testid="pod-card-list">
          <div className="drv-card-head">
            <span>Proof of Delivery</span>
            <span className="drv-pill drv-pill-ok">{daily.length} checkpoint</span>
          </div>
          <div className="drv-card-body drv-pod-list">
            {[...daily].slice().reverse().map((cp, i) => (
              <PoDCard
                key={cp.id}
                photo={cp}
                backendUrl={BACKEND_URL}
                namaDriver={trip.nama_driver}
                nopol={trip.nopol}
                dayIndex={daily.length - 1 - i}
              />
            ))}
          </div>
        </section>
      )}

      {/* PENCAIRAN UANG JALAN */}
      {trip.nama_driver && (
        <section className="drv-card" data-testid="cair-card">
          <div className="drv-card-head"><span>Pencairan Uang Jalan</span></div>
          <div className="drv-card-body drv-cair-list">
            <TahapCard
              num={1}
              color="green"
              title="Tahap 1 — Cair Saat Mulai"
              amount={trip.t1}
              note="Upload 5 foto kendaraan awal — langsung cair"
              cair={!!cair["1"]}
              ready={allInitialDone}
              onCair={() => requestCair(1)}
              loading={cairingTahap === 1}
              testid="tahap-1"
            />
            <TahapCard
              num={2}
              color="blue"
              title="Tahap 2 — Tengah Jalan"
              amount={trip.t2}
              note="Sudah jalan beberapa hari dengan foto rutin"
              cair={!!cair["2"]}
              ready={dailyCount >= 2}
              onCair={() => requestCair(2)}
              loading={cairingTahap === 2}
              testid="tahap-2"
            />
            <TahapCard
              num={3}
              color="gold"
              title="Tahap 3 — Saat Tiba + Bonus"
              amount={trip.t3}
              extra={trip.bonus_kerajinan}
              note="Upload BASTK & Resi dulu untuk cair Tahap 3"
              cair={!!cair["3"]}
              ready={handoverDone}
              onCair={() => requestCair(3)}
              loading={cairingTahap === 3}
              testid="tahap-3"
            />
          </div>
        </section>
      )}

      {/* HANDOVER (BASTK + Resi) */}
      {trip.nama_driver && (
        <section className="drv-card" data-testid="handover-card">
          <div className="drv-card-head">
            <span>Serah Terima Akhir</span>
            {handoverDone && <span className="drv-pill drv-pill-ok">Lengkap ✓</span>}
          </div>
          <div className="drv-card-body">

            {/* PANDUAN VISUAL SERAH TERIMA */}
            {!handoverDone && (
              <div style={{ background: "#0a1628", border: "1.5px solid #EF9F27", borderRadius: 14, padding: "18px 16px", marginBottom: 20 }}>
                <div style={{ color: "#EF9F27", fontWeight: 900, fontSize: 15, marginBottom: 14, textTransform: "uppercase", letterSpacing: 1 }}>
                  PANDUAN SERAH TERIMA — 3 LANGKAH
                </div>

                {/* Step 1 */}
                <div style={{ display: "flex", gap: 14, marginBottom: 16, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 36, height: 36, background: bastkList.length > 0 ? "#1DB954" : "#EF9F27", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#000", flexShrink: 0 }}>
                    {bastkList.length > 0 ? "✓" : "1"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: bastkList.length > 0 ? "#1DB954" : "#fff", marginBottom: 4 }}>
                      FOTO SURAT BASTK
                    </div>
                    <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                      Minta pelanggan <b style={{ color: "#fff" }}>tanda tangan + stempel</b> di surat BASTK.<br/>
                      Letakkan surat di permukaan datar, <b style={{ color: "#fff" }}>foto seluruh halaman jelas terbaca</b>.<br/>
                      Kalau ada 2 lembar, foto masing-masing.
                    </div>
                    {/* Visual mock of document */}
                    <div style={{ marginTop: 10, background: "#fff", borderRadius: 8, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                      <div style={{ width: 44, height: 58, background: "#f0f0f0", border: "1.5px solid #ccc", borderRadius: 4, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", padding: "4px 0" }}>
                        <div style={{ width: 32, height: 3, background: "#999", borderRadius: 2, marginBottom: 3 }} />
                        <div style={{ width: 28, height: 3, background: "#999", borderRadius: 2, marginBottom: 3 }} />
                        <div style={{ width: 20, height: 3, background: "#EF9F27", borderRadius: 2, marginBottom: 5 }} />
                        <div style={{ width: 18, height: 10, background: "#e74c3c", borderRadius: 2, opacity: 0.7 }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#333", lineHeight: 1.7 }}>
                        <div>✔ Tanda tangan terlihat</div>
                        <div>✔ Stempel ada</div>
                        <div>✔ Tulisan terbaca jelas</div>
                        <div>✔ Semua sudut masuk frame</div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div style={{ display: "flex", gap: 14, marginBottom: 16, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 36, height: 36, background: "#1a2740", border: "2px solid #2a4a7f", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: "#7fa8d4", flexShrink: 0 }}>
                    2
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: "#fff", marginBottom: 4 }}>KIRIM BERKAS ASLI via JNE / J&T</div>
                    <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                      Masukkan <b style={{ color: "#fff" }}>BASTK asli + copy STNK</b> ke dalam amplop.<br/>
                      Kirim ke kantor PT Alyssa dalam <b style={{ color: "#EF9F27" }}>1–2 hari kerja</b> setelah serah terima.<br/>
                      Alamat tujuan: <b style={{ color: "#fff" }}>tanyakan ke admin via WA 0818 631 135</b>
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 36, height: 36, background: resi ? "#1DB954" : "#1a2740", border: resi ? "none" : "2px solid #2a4a7f", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 18, color: resi ? "#000" : "#7fa8d4", flexShrink: 0 }}>
                    {resi ? "✓" : "3"}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 15, color: resi ? "#1DB954" : "#fff", marginBottom: 4 }}>FOTO RESI PENGIRIMAN</div>
                    <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.6 }}>
                      Setelah paket dikirim, <b style={{ color: "#fff" }}>foto struk/resi dari JNE atau J&T</b>.<br/>
                      Upload foto resi di bawah — <b style={{ color: "#EF9F27" }}>Tahap 3 langsung cair!</b>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* BASTK UPLOAD */}
            <div className="drv-handover-block">
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 15, color: bastkList.length > 0 ? "#1DB954" : "#fff" }}>
                  {bastkList.length > 0 ? "✓ BASTK Terupload" : "LANGKAH 1 — Foto BASTK"}
                </div>
                <span style={{ fontSize: 12, color: "#888" }}>({bastkList.length}/6 foto)</span>
              </div>
              {bastkList.length === 0 && (
                <div style={{ background: "#0d1a0d", border: "1px dashed #2ea043", borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: "#aaa", lineHeight: 1.7 }}>
                  Foto surat BASTK yang sudah <b style={{ color: "#fff" }}>ditandatangani pelanggan dan ada stempelnya</b>. Kalau ada 2 halaman, foto keduanya.
                </div>
              )}
              <div className="drv-doc-grid">
                {bastkList.map((b) => (
                  <a key={b.id} href={resolveUrl(b.url)} target="_blank" rel="noreferrer" className="drv-doc-thumb">
                    {b.url.toLowerCase().endsWith(".pdf") ? <div className="drv-doc-pdf">PDF</div> : <img src={resolveUrl(b.url)} alt="bastk" />}
                  </a>
                ))}
                {bastkList.length < 6 && (
                  <>
                    <input
                      ref={(el) => fileRefs.current["bastk"] = el}
                      type="file"
                      accept="image/*,application/pdf"
                      capture="environment"
                      onChange={(e) => uploadBastk(e.target.files?.[0])}
                      style={{ display: "none" }}
                    />
                    <button onClick={() => triggerFile("bastk")} disabled={uploadingBastk} data-testid="btn-add-bastk"
                      style={{ width: "100%", padding: "18px 14px", background: "#0d2a0d", border: "2.5px dashed #2ea043", borderRadius: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                      <div style={{ fontSize: 36 }}>📷</div>
                      <div style={{ background: "#2ea043", color: "#fff", fontWeight: 900, fontSize: 15, padding: "6px 18px", borderRadius: 8, letterSpacing: 1 }}>
                        {uploadingBastk ? "Upload..." : "▼ FOTO SCAN DI SINI ▼"}
                      </div>
                      <div style={{ fontSize: 11, color: "#aaa" }}>Tap untuk buka kamera / galeri</div>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* RESI UPLOAD */}
            <div className="drv-handover-block">
              <div style={{ fontWeight: 800, fontSize: 15, color: resi ? "#1DB954" : "#fff", marginBottom: 6 }}>
                {resi ? "✓ Resi Terupload" : "LANGKAH 3 — Foto Resi JNE / J&T"}
              </div>
              {!resi && (
                <div style={{ background: "#1a1400", border: "1px dashed #EF9F27", borderRadius: 10, padding: "12px 14px", marginBottom: 12, fontSize: 13, color: "#aaa", lineHeight: 1.7 }}>
                  Setelah kirim berkas via ekspedisi, <b style={{ color: "#EF9F27" }}>foto struk resinya</b>. Pastikan <b style={{ color: "#fff" }}>nomor resi dan nama tujuan kelihatan</b>.
                </div>
              )}
              <input
                ref={(el) => fileRefs.current["resi"] = el}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                onChange={(e) => openCrop(e.target.files?.[0], uploadResi)}
                style={{ display: "none" }}
              />
              {resi ? (
                <div className="drv-resi-done">
                  <a href={resolveUrl(resi.url)} target="_blank" rel="noreferrer">
                    {resi.url.toLowerCase().endsWith(".pdf") ? <div className="drv-doc-pdf">PDF</div> : <img src={resolveUrl(resi.url)} alt="resi" />}
                  </a>
                  <button className="drv-btn drv-btn-ghost" onClick={() => triggerFile("resi")} disabled={uploadingResi} data-testid="btn-replace-resi">
                    {uploadingResi ? "Upload..." : "Ganti Foto"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => triggerFile("resi")}
                  disabled={uploadingResi}
                  data-testid="btn-upload-resi"
                  style={{ width: "100%", padding: "18px 14px", background: "#1a1400", border: "2.5px dashed #EF9F27", borderRadius: 14, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
                >
                  <div style={{ fontSize: 36 }}>🧾</div>
                  <div style={{ background: "#EF9F27", color: "#000", fontWeight: 900, fontSize: 15, padding: "6px 18px", borderRadius: 8, letterSpacing: 1 }}>
                    {uploadingResi ? "Uploading..." : "▼ FOTO SCAN DI SINI ▼"}
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>Tap untuk buka kamera / galeri</div>
                </button>
              )}
            </div>

            {/* STATUS SERAH TERIMA */}
            {handoverDone && (
              <div style={{ background: "#0d1a0d", border: "2px solid #1DB954", borderRadius: 14, padding: "16px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#1DB954", marginBottom: 6 }}>SERAH TERIMA LENGKAP!</div>
                <div style={{ fontSize: 13, color: "#aaa", lineHeight: 1.7 }}>
                  BASTK & Resi sudah terupload.<br/>
                  Admin sedang memproses pencairan <b style={{ color: "#EF9F27" }}>Tahap 3 + Bonus</b>.
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="drv-footer">
        PT Alyssa Auto Logistik · 0818 631 135<br/>
        <span style={{ opacity: 0.55 }}>v2.4 Driver Checkpoint</span>
      </footer>

      {/* SOP MODAL — Premium full-screen design */}
      {showSOP && (
        <div className="drv-sop-overlay" data-testid="sop-modal">
          <div className="drv-sop-screen">
            <div className="drv-sop-banner">
              <div className="drv-sop-warn">!</div>
              <div className="drv-sop-banner-title">WAJIB BACA SEBELUM JALAN!</div>
              <div className="drv-sop-banner-sub">7 PERINTAH DRIVER ALYSSA</div>
            </div>
            <ol className="drv-sop-points">
              {SOP_POINTS.map((p, i) => (
                <li key={i} className="drv-sop-point">
                  <div className="drv-sop-num">{i + 1}</div>
                  <div className="drv-sop-body">
                    <b>{p.title}:</b> {p.body}
                  </div>
                </li>
              ))}
            </ol>
            <div className="drv-sop-emergency">
              <div className="drv-sop-emergency-icon">!</div>
              <div className="drv-sop-emergency-text">
                <b>DARURAT:</b> Jika mobil mogok atau ada kendala berat, <b>DILARANG</b> bongkar/perbaiki sendiri tanpa izin kantor! Hubungi admin: <b>0818 631 135</b>
              </div>
            </div>
            <button className="drv-sop-accept" onClick={markSOP} data-testid="btn-sop-ok">
              <span className="drv-sop-accept-emoji">✓</span>
              <div className="drv-sop-accept-text">
                <div className="drv-sop-accept-main">Saya Sudah Baca &amp; Setuju</div>
                <div className="drv-sop-accept-sub">Tap tombol ini untuk lanjut</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* CELEBRATION BANNER */}
      {celebration && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          background: "linear-gradient(135deg, #1a7a3c, #2ea043)",
          color: "#fff", textAlign: "center",
          padding: "22px 20px",
          boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          fontSize: 17, fontWeight: 800, letterSpacing: 0.3,
        }}>
          🎉 SELESAI! Berkas lengkap. Bonus Rp 30.000 diproses admin!
        </div>
      )}

      {/* TOAST */}
      {toast && (
        <div className={`drv-toast ${toast.type === "err" ? "drv-toast-err" : "drv-toast-ok"}`} data-testid="toast">
          {toast.msg}
        </div>
      )}
      {cropData && (
        <CropModal
          url={cropData.url}
          file={cropData.file}
          onCancel={() => { URL.revokeObjectURL(cropData.url); setCropData(null); }}
          onConfirm={(out) => { URL.revokeObjectURL(cropData.url); const done = cropData.onDone; setCropData(null); done(out); }}
        />
      )}
    </div>
  );
}

function TahapCard({ num, color, title, amount, extra, note, cair, ready, onCair, loading, testid }) {
  const colorCls = `drv-tahap-${color}`;
  return (
    <div className={`drv-tahap ${colorCls} ${cair ? "drv-tahap-cair" : ""}`} data-testid={testid}>
      <div className="drv-tahap-head">
        <div className="drv-tahap-title">{title}</div>
        <span className={`drv-pill ${cair ? "drv-pill-ok" : (ready ? "drv-pill-ready" : "drv-pill-wait")}`}>
          {cair ? "Cair" : (ready ? "Siap" : "Belum")}
        </span>
      </div>
      <div className="drv-tahap-amt">
        {fmtIDR(amount)}
        {extra > 0 && <span className="drv-tahap-extra"> (+{fmtIDR(extra)} bonus)</span>}
      </div>
      <div className="drv-tahap-note">{note}</div>
      {cair ? (
        <div className="drv-tahap-status drv-tahap-status-cair">✓ Sudah Cair {fmtIDR(amount + (extra||0))}</div>
      ) : (
        <button
          className={`drv-btn drv-btn-block drv-btn-${color}`}
          onClick={onCair}
          disabled={!ready || loading}
          data-testid={`btn-${testid}`}
        >
          {loading ? "Memproses..." : (ready ? `Cairkan Tahap ${num}` : "Belum bisa cair")}
        </button>
      )}
    </div>
  );
}
