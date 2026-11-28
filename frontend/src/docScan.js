/*
  Scan dokumen otomatis (sisi browser, tanpa AI/server) untuk foto surat/PO/resi:
  1) cari 4 sudut kertas, 2) luruskan (perspektif) jadi A4 tegak, 3) hapus bayangan/kuning kertas + pertajam.
  Gagal / bukan foto / PDF -> kembalikan file asli (tidak pernah merusak upload).
*/
import { loadBitmap, homografi } from "./dokumenScan";

export const RASIO_A4 = Math.SQRT2;          // 297 / 210
export const RASIO_F4 = 330 / 210;

/* Ambang Otsu pada histogram 0..255. */
export function otsu(gray) {
  const h = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  const total = gray.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += h[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * h[t];
    const mB = sB / wB, mF = (sum - sB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/* Komponen terhubung terbesar di mask biner (4-tetangga, tanpa rekursi). Mengembalikan {pts:[idx], area}. */
function terbesar(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let bestStart = -1, bestArea = 0;
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || seen[s]) continue;
    let sp = 0, area = 0; stack[sp++] = s; seen[s] = 1;
    while (sp) {
      const p = stack[--sp]; area++;
      const x = p % w, y = (p / w) | 0;
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (area > bestArea) { bestArea = area; bestStart = s; }
  }
  if (bestStart < 0) return null;
  // kumpulkan ulang titik komponen terbesar
  const comp = new Uint8Array(w * h); const pts = [];
  let sp = 0; stack[sp++] = bestStart; comp[bestStart] = 1;
  while (sp) {
    const p = stack[--sp]; pts.push(p);
    const x = p % w, y = (p / w) | 0;
    if (x > 0 && mask[p - 1] && !comp[p - 1]) { comp[p - 1] = 1; stack[sp++] = p - 1; }
    if (x < w - 1 && mask[p + 1] && !comp[p + 1]) { comp[p + 1] = 1; stack[sp++] = p + 1; }
    if (y > 0 && mask[p - w] && !comp[p - w]) { comp[p - w] = 1; stack[sp++] = p - w; }
    if (y < h - 1 && mask[p + w] && !comp[p + w]) { comp[p + w] = 1; stack[sp++] = p + w; }
  }
  return { pts, area: bestArea };
}

/* Isi lubang kecil (teks gelap di kertas terang) lewat close sederhana: dilate lalu erode radius r. */
function close(mask, w, h, r) {
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const pass = (src, dst, val) => {           // 1D separable max/min
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = val ? 0 : 1;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; const v = src[y * w + xx]; if (val ? v : !v) { hit = val ? 1 : 0; break; } }
      tmp[y * w + x] = hit;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = val ? 0 : 1;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; const v = tmp[yy * w + x]; if (val ? v : !v) { hit = val ? 1 : 0; break; } }
      dst[y * w + x] = hit;
    }
  };
  pass(mask, out, 1);                          // dilate
  const d = out.slice();
  pass(d, out, 0);                             // erode
  return out;
}

/* gray: Uint8Array w*h  ->  { quad:[[x,y]*4 pecahan 0..1 urut KA,KN,KB,KiB], luas:pecahan } | null */
/* Blur kotak terpisah (radius r) pada gambar skala abu-abu: meleburkan bintik kecil (pola kain/meja) tapi tidak tepi kertas. */
export function haluskan(gray, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0, n = 0;
    for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { acc += gray[y * w + x]; n++; }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      const a = x - r, b = x + r + 1;
      if (a >= 0) { acc -= gray[y * w + a]; n--; }
      if (b < w) { acc += gray[y * w + b]; n++; }
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0, n = 0;
    for (let y = -r; y <= r; y++) if (y >= 0 && y < h) { acc += tmp[y * w + x]; n++; }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      const a = y - r, b = y + r + 1;
      if (a >= 0) { acc -= tmp[a * w + x]; n--; }
      if (b < h) { acc += tmp[b * w + x]; n++; }
    }
  }
  return out;
}

export function cariKertas(gray0, w, h, rgba) {
  const gray = haluskan(gray0, w, h, 3);
  const med = (arr) => { const a = Array.from(arr).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 128; };
  // pembanding: cincin tepi foto (latar atau pinggir kertas) vs pusat foto (hampir pasti kertas)
  const rt = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const ring = [], center = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x < rt || y < rt || x >= w - rt || y >= h - rt) ring.push(gray[y * w + x]);
    else if (x > w * 0.3 && x < w * 0.7 && y > h * 0.3 && y < h * 0.7) center.push(gray[y * w + x]);
  }
  const mc = med(center), mr = med(ring);
  const mirip = ring.filter((v) => Math.abs(v - mc) <= 45).length / ring.length;
  // Tepi foto mirip pusat -> kertas memenuhi bingkai (tak ada latar): pakai seluruh foto, jangan tebak sudut.
  if (mirip >= 0.65) return { quad: [[0, 0], [1, 0], [1, 1], [0, 1]], luas: 1, penuh: true };
  const th = (mc + mr) / 2;                                  // batas di tengah antara latar dan kertas
  const terang = mc >= mr;                                   // kertas biasanya lebih terang dari meja, tapi dukung sebaliknya
  let mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = (terang ? gray[i] > th : gray[i] <= th) ? 1 : 0;
  // Syarat warna: kertas punya warna (kromatisitas) seperti kertas di tengah foto; kain/meja terang tapi beda warna (mis. denim biru) dibuang.
  if (rgba && terang) {
    const cr = [], cb = [];
    for (let y = Math.floor(h * 0.3); y < h * 0.7; y += 2) for (let x = Math.floor(w * 0.3); x < w * 0.7; x += 2) {
      const i = (y * w + x) * 4, t = rgba[i] + rgba[i + 1] + rgba[i + 2] || 1;
      if (gray[y * w + x] > th) { cr.push(rgba[i] / t); cb.push(rgba[i + 2] / t); }
    }
    if (cr.length > 20) {
      const r0 = med(cr), b0 = med(cb);
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i] || gray[i] > 235) continue;                       // sangat terang (sorot/kertas putih over-expose) tetap kertas
        const t = rgba[i * 4] + rgba[i * 4 + 1] + rgba[i * 4 + 2] || 1;
        if (Math.hypot(rgba[i * 4] / t - r0, rgba[i * 4 + 2] / t - b0) > 0.07) mask[i] = 0;
      }
    }
  }
  mask = close(mask, w, h, Math.max(2, Math.round(Math.min(w, h) / 60)));
  { const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;      // buka: buang tonjolan tipis (selip kertas kecil, bayangan)
    const c2 = close(inv, w, h, Math.max(2, Math.round(Math.min(w, h) / 80))); for (let i = 0; i < mask.length; i++) mask[i] = c2[i] ? 0 : 1; }
  const comp = terbesar(mask, w, h);
  if (!comp) return null;
  const luas = comp.area / (w * h);
  if (luas < 0.15) return null;
  // Tepi kertas: titik batas komponen -> cangkang cembung -> sederhanakan jadi 4 sudut yang MEMBUNGKUS kertas
  // (sisi-sisinya mengikuti tepi kertas asli, tahan terhadap lipatan/tepi melengkung/kertas miring).
  const inC = new Uint8Array(w * h); for (const q of comp.pts) inC[q] = 1;
  const batas = [];
  for (const q of comp.pts) {
    const x = q % w, y = (q / w) | 0;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !inC[q - 1] || !inC[q + 1] || !inC[q - w] || !inC[q + w]) batas.push([x, y]);
  }
  const quad4 = quadDariCangkang(cangkang(batas));
  if (!quad4) return null;
  const quad = quad4.map(([x, y]) => [Math.min(1, Math.max(0, x / (w - 1))), Math.min(1, Math.max(0, y / (h - 1)))]);
  return { quad, luas, mask: inC, w, h };
}

/* Cangkang cembung (Andrew monotone chain), urutan searah jarum jam di koordinat layar (y ke bawah). */
export function cangkang(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = []; for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  const up = []; for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

/* Cangkang -> 4 sudut: berulang buang sisi yang penambahan luasnya paling kecil (perpanjang dua sisi tetangganya sampai bertemu). */
export function quadDariCangkang(hull) {
  let P = hull.map((q) => [q[0], q[1]]);
  if (P.length < 4) return null;
  const inter = (a, b, c, d) => {
    const x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1], x3 = c[0], y3 = c[1], x4 = d[0], y4 = d[1];
    const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(den) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  };
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  while (P.length > 4) {
    const n = P.length; let best = null;
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], d = P[(i + 2) % n];
      const x = inter(a, b, c, d);
      if (!x) continue;
      // titik potong harus di "luar" sisi b-c (arah menjauhi pusat), kalau tidak sisi ini tak bisa dibuang
      const ab = [b[0] - a[0], b[1] - a[1]], dc = [c[0] - d[0], c[1] - d[1]];
      if ((x[0] - b[0]) * ab[0] + (x[1] - b[1]) * ab[1] < 0 || (x[0] - c[0]) * dc[0] + (x[1] - c[1]) * dc[1] < 0) continue;
      const add = tri(b, x, c);
      if (!best || add < best.add) best = { i, x, add };
    }
    if (!best) return null;
    const i = best.i, j = (i + 1) % n;
    const Q = [];
    for (let k = 0; k < n; k++) { if (k === j) continue; Q.push(k === i ? best.x : P[k]); }
    P = Q;
  }
  // urut: mulai dari sudut kiri-atas (x+y terkecil), searah jarum jam -> KiAt, KaAt, KaBw, KiBw
  let s0 = 0; for (let k = 1; k < 4; k++) if (P[k][0] + P[k][1] < P[s0][0] + P[s0][1]) s0 = k;
  return [P[s0], P[(s0 + 1) % 4], P[(s0 + 2) % 4], P[(s0 + 3) % 4]];
}

function luasQuad(q) { let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; }

/* Kualitas sudut: konveks & tidak melenceng (jaga dari sudut ngaco). */
function masukAkal(q, luasMask) {
  const a = luasQuad(q);
  if (a < 0.15) return false;
  if (a < luasMask * 0.6) return false;
  const rasio = (() => { const d = (p, r) => Math.hypot(p[0] - r[0], p[1] - r[1]); const wd = (d(q[0], q[1]) + d(q[3], q[2])) / 2, ht = (d(q[0], q[3]) + d(q[1], q[2])) / 2; return ht > 0 ? wd / ht : 0; })();
  return rasio > 0.25 && rasio < 4;
}

/* Warp perspektif quad(piksel) -> kanvas outW x outH (bilinear). Mengembalikan ImageData. */
function warp(srcData, W, H, pts, outW, outH) {
  const hm = homografi(pts);
  const o = new Uint8ClampedArray(outW * outH * 4);
  for (let v = 0; v < outH; v++) {
    const t = (v + 0.5) / outH;
    for (let u = 0; u < outW; u++) {
      const s = (u + 0.5) / outW;
      const dn = hm.g * s + hm.h * t + 1;
      const x = (hm.a * s + hm.b * t + hm.c) / dn - 0.5, y = (hm.d * s + hm.e * t + hm.f) / dn - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const xa = Math.min(W - 1, Math.max(0, x0)), xb = Math.min(W - 1, Math.max(0, x0 + 1));
      const ya = Math.min(H - 1, Math.max(0, y0)), yb = Math.min(H - 1, Math.max(0, y0 + 1));
      const i00 = (ya * W + xa) * 4, i10 = (ya * W + xb) * 4, i01 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
      const oi = (v * outW + u) * 4;
      for (let ch = 0; ch < 3; ch++) o[oi + ch] = srcData[i00 + ch] * (1 - fx) * (1 - fy) + srcData[i10 + ch] * fx * (1 - fy) + srcData[i01 + ch] * (1 - fx) * fy + srcData[i11 + ch] * fx * fy;
      o[oi + 3] = 255;
    }
  }
  return new ImageData(o, outW, outH);
}

/* Blur kotak (radius r, tepi direplikasi) pada kanal Float32 w*h. O(n) lewat jumlah berjalan. */
export function blurKotak(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[o + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[o + x] = acc / n;
      acc += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/* Putihkan kertas & buang bayangan/warna latar (bagi dengan warna kertas per blok), tinta digelapkan. -> RGBA Uint8ClampedArray */
function putihkan(img) {
  const { width: w, height: h, data } = img;
  const bs = Math.max(8, Math.round(Math.max(w, h) / 40));
  const gw = Math.ceil(w / bs), gh = Math.ceil(h / bs);
  const bg = new Float32Array(gw * gh * 3);          // warna kertas per kanal R,G,B per blok -> buang bayangan DAN stik warna (kebiruan/kekuningan)
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) for (let c = 0; c < 3; c++) {
    const vals = [];
    for (let y = gy * bs; y < Math.min(h, (gy + 1) * bs); y += 2) for (let x = gx * bs; x < Math.min(w, (gx + 1) * bs); x += 2) vals.push(data[(y * w + x) * 4 + c]);
    vals.sort((a, b) => a - b);
    bg[(gy * gw + gx) * 3 + c] = vals[Math.floor(vals.length * 0.9)] || 255;   // persentil 90 = warna kertas, abaikan teks gelap
  }
  const bgAt = (x, y, c) => {
    const fx = Math.min(gw - 1, Math.max(0, x / bs - 0.5)), fy = Math.min(gh - 1, Math.max(0, y / bs - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    const g = (xx, yy) => bg[(yy * gw + xx) * 3 + c];
    return g(x0, y0) * (1 - ax) * (1 - ay) + g(x1, y0) * ax * (1 - ay) + g(x0, y1) * (1 - ax) * ay + g(x1, y1) * ax * ay;
  };
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let v = data[i + c] * (252 / Math.max(60, bgAt(x, y, c)));
      v = 255 * Math.pow(Math.min(1, Math.max(0, v / 255)), 1.5);          // kertas tetap putih, tinta/abu-abu lebih gelap
      out[i + c] = v;
    }
    out[i + 3] = 255;
  }
  return out;
}

/* Pertajam (unsharp mask) tiap kanal; radius kotak ~1-2 px. */
function pertajam(rgba, w, h, amount, r) {
  const res = new Uint8ClampedArray(rgba.length);
  const ch = new Float32Array(w * h);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < w * h; i++) ch[i] = rgba[i * 4 + c];
    const b = blurKotak(blurKotak(ch, w, h, r), w, h, r);
    for (let i = 0; i < w * h; i++) res[i * 4 + c] = ch[i] + amount * (ch[i] - b[i]);
  }
  for (let i = 0; i < w * h; i++) res[i * 4 + 3] = 255;
  return res;
}

/* Mode WARNA: kertas putih bersih + teks/gambar tajam. */
export function bersihkan(img, { tepi = true } = {}) {
  const { width: w, height: h } = img;
  const dasar = putihkan(img);
  const L0 = luminansi(dasar, w, h);
  const hasil = pertajam(dasar, w, h, 1.5, 1);
  if (tepi) bersihkanTepi(hasil, L0, w, h);
  return new ImageData(hasil, w, h);
}

/* Mode HITAM-PUTIH (seperti mesin scan kantor): teks hitam pekat di atas kertas putih, tepi halus tanpa bergerigi.
   Ambang adaptif terhadap rata-rata lokal, jadi bayangan/noda tidak ikut jadi hitam. */
export function hitamPutih(img, { tepi = true } = {}) {
  const { width: w, height: h } = img;
  const rgba = putihkan(img);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  const lembut = blurKotak(blurKotak(L, w, h, 1), w, h, 1);
  const Ls = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) Ls[i] = L[i] + 1.1 * (L[i] - lembut[i]);                 // pertajam tepi huruf dulu
  const R = Math.max(14, Math.round(w / 30));
  const M = blurKotak(blurKotak(Ls, w, h, R), w, h, Math.max(4, R >> 1));                  // rata-rata lokal (latar)
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const rasio = Ls[i] / Math.max(40, M[i]);
    let t = (rasio - 0.70) / (0.90 - 0.70); t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = t * t * (3 - 2 * t);                                                                 // smoothstep: tepi halus
    const v = t * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  if (tepi) bersihkanTepi(out, L, w, h);
  return new ImageData(out, w, h);
}

/* Buang sisa latar (kain/meja) di pinggir hasil scan. Per baris/kolom, dari tepi ke dalam: selama jendela 10 px belum "putih kertas"
   (rata-rata kecerahan < 215 setelah dinormalkan), itu masih latar dan diputihkan. Berhenti di margin kertas putih pertama, jadi isi
   dokumen yang dekat tepi tidak ikut terhapus. Maksimal 8% dari lebar/tinggi; kedalaman diratakan antar baris tetangga. */
export function bersihkanTepi(rgba, L, w, h) {
  const WIN = 10, BATAS_X = Math.floor(w * 0.08), BATAS_Y = Math.floor(h * 0.08), PUTIH = 215 * WIN;
  const kedalaman = (batas, at) => {                           // at(d) = kecerahan piksel ke-d dari tepi
    let acc = 0; for (let k = 0; k < WIN; k++) acc += at(k);
    for (let d = 0; d < batas; d++) {
      if (acc >= PUTIH) return d ? Math.min(batas, d + 1) : 0;
      acc += at(d + WIN) - at(d);
    }
    return batas;
  };
  const ratakan = (arr, r) => { const o = new Int32Array(arr.length); for (let i = 0; i < arr.length; i++) { let m = 0; for (let k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k++) if (arr[k] > m) m = arr[k]; o[i] = m; } return o; };
  const rY = Math.max(20, Math.round(h * 0.012)), rX = Math.max(20, Math.round(w * 0.012));
  const kiri = new Int32Array(h), kanan = new Int32Array(h), atas = new Int32Array(w), bawah = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    kiri[y] = kedalaman(BATAS_X, (d) => (d < w ? L[y * w + d] : 255));
    kanan[y] = kedalaman(BATAS_X, (d) => (d < w ? L[y * w + w - 1 - d] : 255));
  }
  for (let x = 0; x < w; x++) {
    atas[x] = kedalaman(BATAS_Y, (d) => (d < h ? L[d * w + x] : 255));
    bawah[x] = kedalaman(BATAS_Y, (d) => (d < h ? L[(h - 1 - d) * w + x] : 255));
  }
  const kiriR = ratakan(kiri, rY), kananR = ratakan(kanan, rY), atasR = ratakan(atas, rX), bawahR = ratakan(bawah, rX);
  const putih = (x, y) => { const i = (y * w + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 255; };
  for (let y = 0; y < h; y++) { for (let x = 0; x < kiriR[y]; x++) putih(x, y); for (let x = 0; x < kananR[y]; x++) putih(w - 1 - x, y); }
  for (let x = 0; x < w; x++) { for (let y = 0; y < atasR[x]; y++) putih(x, y); for (let y = 0; y < bawahR[x]; y++) putih(x, h - 1 - y); }
}

function luminansi(rgba, w, h) {
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return L;
}

/* ── Perataan teks otomatis (dewarp ringan) ────────────────────────────────────────────────────────────────
   Halaman yang difoto sering miring dan sedikit melengkung/bergelombang (lipatan, kertas melengkung). Kemiringan baris teks
   diukur per sel (kisi 6x10) lewat profil proyeksi pada banyak sudut; sudut median = kemiringan seluruh halaman (diputar balik),
   selisih per sel = lengkungan (diintegrasikan ke arah horizontal jadi pergeseran vertikal per piksel). Satu kali resampling. */
const KISI_X = 6, KISI_Y = 10, SUDUT_MAKS = 4, LANGKAH = 0.25;

function inkKecil(img, target = 700) {
  const { width: w, height: h, data } = img;
  const f = Math.max(1, Math.floor(w / target)), dw = Math.floor(w / f), dh = Math.floor(h / f);
  const g = new Float32Array(dw * dh);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    let t = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) { const i = ((y * f + yy) * w + (x * f + xx)) * 4; t += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; }
    g[y * dw + x] = t / (f * f);
  }
  const m = blurKotak(g, dw, dh, Math.max(6, Math.round(dw / 60)));
  const ink = new Uint8Array(dw * dh);
  for (let i = 0; i < ink.length; i++) ink[i] = m[i] > 60 && g[i] < 0.78 * m[i] ? 1 : 0;
  return { ink, dw, dh };
}

/* Sudut (derajat) baris teks pada satu sel, atau null bila tidak cukup tinta / tidak ada puncak yang jelas. */
function sudutSel(ink, dw, x0, x1, y0, y1) {
  const xs = [], ys = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink[y * dw + x]) { xs.push(x); ys.push(y - y0); }
  if (xs.length < 150) return null;
  const cx = (x0 + x1) / 2, H = y1 - y0, off = H, hist = new Float32Array(H * 3);
  let best = -1, bestA = 0, sum = 0, n = 0;
  for (let a = -SUDUT_MAKS; a <= SUDUT_MAKS + 1e-6; a += LANGKAH) {
    const t = Math.tan((a * Math.PI) / 180); hist.fill(0);
    for (let k = 0; k < xs.length; k++) { const yy = Math.round(ys[k] - t * (xs[k] - cx)) + off; if (yy >= 0 && yy < hist.length) hist[yy]++; }
    let sc = 0; for (let k = 0; k < hist.length; k++) sc += hist[k] * hist[k];
    sum += sc; n++;
    if (sc > best) { best = sc; bestA = a; }
  }
  if (best / (sum / n) < 1.12) return null;            // puncak tidak jelas -> bukan baris teks
  if (Math.abs(bestA) >= SUDUT_MAKS - 1e-6) return null;  // di tepi rentang -> tak bisa dipercaya
  return bestA;
}

export function ukurKemiringan(img) {
  const { ink, dw, dh } = inkKecil(img);
  const cw = dw / KISI_X, ch = dh / KISI_Y, sel = new Array(KISI_X * KISI_Y).fill(null);
  for (let j = 0; j < KISI_Y; j++) for (let i = 0; i < KISI_X; i++) sel[j * KISI_X + i] = sudutSel(ink, dw, Math.round(i * cw), Math.round((i + 1) * cw), Math.round(j * ch), Math.round((j + 1) * ch));
  const valid = sel.filter((v) => v !== null);
  if (valid.length < 8) return null;
  const sorted = valid.slice().sort((a, b) => a - b), med = sorted[sorted.length >> 1];
  // sebaran kemiringan sel jauh dari median -> bukan dokumen teks rata; jangan dipaksa
  const sisa = sel.map((v) => (v === null ? null : v - med));
  const field = sisa.map((v) => (v === null ? 0 : v)); const isi = sisa.map((v) => v !== null);
  for (let it = 0; it < 30; it++) {                    // isi sel kosong dari tetangga (difusi)
    let berubah = false;
    for (let j = 0; j < KISI_Y; j++) for (let i = 0; i < KISI_X; i++) {
      const k = j * KISI_X + i; if (isi[k]) continue;
      let t = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= KISI_X || jj >= KISI_Y) continue; const kk = jj * KISI_X + ii; if (isi[kk]) { t += field[kk]; c++; } }
      if (c) { field[k] = t / c; isi[k] = true; berubah = true; }
    }
    if (!berubah) break;
  }
  const hal = field.slice();                           // haluskan 1x (rata-rata 3x3)
  for (let j = 0; j < KISI_Y; j++) for (let i = 0; i < KISI_X; i++) {
    let t = 0, c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= KISI_X || jj >= KISI_Y) continue; t += field[jj * KISI_X + ii]; c++; }
    hal[j * KISI_X + i] = t / c;
  }
  return { theta: med, field: hal, valid: valid.length };
}

/* Terapkan koreksi: putar -theta lalu geser vertikal per piksel agar baris teks lurus. Mengembalikan ImageData baru (atau yang sama bila tak perlu). */
export function luruskanTeks(img, { klem = false } = {}) {      // klem: isi area kosong di tepi dengan piksel terdekat (bukan putih) supaya pembersih tepi tetap bekerja pada foto di atas latar lain
  const ukur = ukurKemiringan(img);
  if (!ukur) return img;
  const { theta, field } = ukur, { width: w, height: h, data } = img;
  const rad = (theta * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad), cx = (w - 1) / 2, cy = (h - 1) / 2;
  const maxF = Math.max(...field.map(Math.abs));
  if (Math.abs(theta) < 0.15 && maxF < 0.2) return img;                  // sudah cukup lurus
  // medan kemiringan halus pada kisi 48x64, diintegrasikan ke arah x dari kolom tengah -> tabel pergeseran dy (piksel)
  const NX = 48, NY = 64, dyT = new Float32Array(NX * NY);
  const slopeAt = (fx, fy) => {                                              // bilinear pada kisi kasar (koordinat 0..1)
    const gx = Math.min(KISI_X - 1, Math.max(0, fx * KISI_X - 0.5)), gy = Math.min(KISI_Y - 1, Math.max(0, fy * KISI_Y - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(KISI_X - 1, x0 + 1), y1 = Math.min(KISI_Y - 1, y0 + 1), ax = gx - x0, ay = gy - y0;
    const F = (i, j) => field[j * KISI_X + i];
    const deg = F(x0, y0) * (1 - ax) * (1 - ay) + F(x1, y0) * ax * (1 - ay) + F(x0, y1) * (1 - ax) * ay + F(x1, y1) * ax * ay;
    return Math.tan((deg * Math.PI) / 180);
  };
  const mid = (NX - 1) / 2, dxPx = w / (NX - 1);
  for (let j = 0; j < NY; j++) {
    const fy = j / (NY - 1);
    let acc = 0; dyT[j * NX + Math.round(mid)] = 0;
    for (let i = Math.round(mid) + 1; i < NX; i++) { acc += slopeAt((i - 0.5) / (NX - 1), fy) * dxPx; dyT[j * NX + i] = acc; }
    acc = 0;
    for (let i = Math.round(mid) - 1; i >= 0; i--) { acc -= slopeAt((i + 0.5) / (NX - 1), fy) * dxPx; dyT[j * NX + i] = acc; }
  }
  const dyAt = (X, Y) => {
    const gx = (X / (w - 1)) * (NX - 1), gy = (Y / (h - 1)) * (NY - 1);
    const x0 = Math.min(NX - 2, Math.floor(gx)), y0 = Math.min(NY - 2, Math.floor(gy)), ax = gx - x0, ay = gy - y0;
    const D = (i, j) => dyT[j * NX + i];
    return D(x0, y0) * (1 - ax) * (1 - ay) + D(x0 + 1, y0) * ax * (1 - ay) + D(x0, y0 + 1) * (1 - ax) * ay + D(x0 + 1, y0 + 1) * ax * ay;
  };
  // warna kertas di pinggir (median per kanal) untuk mengisi area kosong hasil putaran: bukan putih murni, supaya normalisasi tidak menganggap bayangan di tepi sebagai tinta
  const papan = [255, 255, 255];
  { const band = Math.max(3, Math.round(Math.min(w, h) * 0.004)), vals = [[], [], []];
    for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) { if (x < band || y < band || x >= w - band || y >= h - band) for (let c = 0; c < 3; c++) vals[c].push(data[(y * w + x) * 4 + c]); }
    for (let c = 0; c < 3; c++) { vals[c].sort((a, b) => a - b); papan[c] = vals[c].length ? vals[c][vals[c].length >> 1] : 255; } }
  const out = new Uint8ClampedArray(data.length);
  for (let Y = 0; Y < h; Y++) for (let X = 0; X < w; X++) {
    const xr = X - cx, yr = Y - cy;
    let xs = cx + cos * xr - sin * yr, ys = cy + sin * xr + cos * yr + dyAt(X, Y);
    const o = (Y * w + X) * 4;
    if (xs < 0 || ys < 0 || xs > w - 1 || ys > h - 1) {
      if (!klem) { out[o] = papan[0]; out[o + 1] = papan[1]; out[o + 2] = papan[2]; out[o + 3] = 255; continue; }
      xs = Math.min(w - 1, Math.max(0, xs)); ys = Math.min(h - 1, Math.max(0, ys));
    }
    const x0 = Math.floor(xs), y0 = Math.floor(ys), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = xs - x0, fy = ys - y0;
    const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
    for (let c = 0; c < 3; c++) out[o + c] = data[i00 + c] * (1 - fx) * (1 - fy) + data[i10 + c] * fx * (1 - fy) + data[i01 + c] * (1 - fx) * fy + data[i11 + c] * fx * fy;
    out[o + 3] = 255;
  }
  return new ImageData(out, w, h);
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", q));

/* Foto dokumen (File) -> File JPEG A4 tegak & tajam. Gagal -> kembalikan file asli. */
export async function scanDokumen(file, { lebar = 0, mode = "bw", luruskan = true, debug = null } = {}) {      // lebar 0 = otomatis (1240..2000 px sesuai resolusi foto); mode: "bw" hitam-putih tajam | "warna"
  try {
    if (!file || !/^image\//.test(file.type || "") || /heic|heif/i.test(file.type || "")) return file;
    const bmp = await loadBitmap(file);
    const W0 = bmp.width || bmp.naturalWidth, H0 = bmp.height || bmp.naturalHeight;
    const k0 = Math.min(1, 2800 / Math.max(W0, H0));
    const W = Math.round(W0 * k0), H = Math.round(H0 * k0);
    const src = document.createElement("canvas"); src.width = W; src.height = H;
    const sctx = src.getContext("2d", { willReadFrequently: true }); sctx.drawImage(bmp, 0, 0, W, H);
    const sd = sctx.getImageData(0, 0, W, H).data;
    // deteksi pada versi kecil (sisi panjang <= 480)
    const ks = Math.min(1, 480 / Math.max(W, H)), sw = Math.max(8, Math.round(W * ks)), sh = Math.max(8, Math.round(H * ks));
    const sm = document.createElement("canvas"); sm.width = sw; sm.height = sh;
    const mctx = sm.getContext("2d", { willReadFrequently: true }); mctx.drawImage(src, 0, 0, sw, sh);
    const md = mctx.getImageData(0, 0, sw, sh).data;
    const gray = new Uint8Array(sw * sh);
    for (let i = 0; i < gray.length; i++) gray[i] = 0.299 * md[i * 4] + 0.587 * md[i * 4 + 1] + 0.114 * md[i * 4 + 2];
    const hit = cariKertas(gray, sw, sh, md);
    let quad = hit && masukAkal(hit.quad, hit.luas) ? hit.quad : [[0, 0], [1, 0], [1, 1], [0, 1]];   // tak ketemu -> pakai seluruh foto
    const cx = quad.reduce((t, q) => t + q[0], 0) / 4, cy = quad.reduce((t, q) => t + q[1], 0) / 4;
    const kk = hit && !hit.penuh ? 0.988 : 1;                                   // masuk sedikit dari tepi kertas: buang sisa latar gelap/bayangan di pinggir
    const pts = quad.map(([x, y]) => [(cx + (x - cx) * kk) * (W - 1), (cy + (y - cy) * kk) * (H - 1)]);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const wd = (d(pts[0], pts[1]) + d(pts[3], pts[2])) / 2, ht = (d(pts[0], pts[3]) + d(pts[1], pts[2])) / 2;
    if (debug) { debug.hit = hit ? { quad: hit.quad, luas: hit.luas, penuh: !!hit.penuh } : null; debug.pakai = quad; debug.pts = pts; debug.W = W; debug.H = H; debug.sw = sw; debug.sh = sh; debug.small = sm; debug.mask = hit && hit.mask; }
    const portrait = ht >= wd;
    const r = Math.max(wd, ht) / Math.max(1, Math.min(wd, ht));
    const rasio = r > 1.49 ? RASIO_F4 : RASIO_A4;                        // kertas F4/folio (330 mm) vs A4 (297 mm), pilih yang paling dekat
    const dasar = lebar || Math.min(2000, Math.max(1240, Math.round(Math.min(wd, ht) / k0)));   // jangan membesar jauh melebihi detail asli foto
    const outW = portrait ? dasar : Math.round(dasar * rasio), outH = portrait ? Math.round(dasar * rasio) : dasar;
    const warped0 = warp(sd, W, H, pts, outW, outH);
    const tepi = !!(hit && !hit.penuh);            // bersihkan sisa latar di pinggir hanya bila kertas terdeteksi di atas latar lain; kalau kertas memenuhi bingkai, tepi dibiarkan (isi bisa menempel ke tepi)
    const warped = luruskan ? luruskanTeks(warped0, { klem: tepi }) : warped0;       // ratakan baris teks yang miring/melengkung
    const hasil = mode === "warna" ? bersihkan(warped, { tepi }) : hitamPutih(warped, { tepi });
    const out = document.createElement("canvas"); out.width = outW; out.height = outH;
    out.getContext("2d").putImageData(hasil, 0, 0);
    const blob = await toBlob(out, 0.92);
    if (!blob) return file;
    const nama = String(file.name || "dokumen").replace(/\.[^.]+$/, "") + "-scan.jpg";
    return new File([blob], nama, { type: "image/jpeg" });
  } catch (e) {
    return file;
  }
}
