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
export function cariKertas(gray, w, h) {
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
  mask = close(mask, w, h, Math.max(2, Math.round(Math.min(w, h) / 60)));
  const comp = terbesar(mask, w, h);
  if (!comp) return null;
  const luas = comp.area / (w * h);
  if (luas < 0.15) return null;
  // 4 sudut = titik ekstrem pada diagonal (x+y, x-y)
  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity;
  let pTL = null, pBR = null, pTR = null, pBL = null;
  for (const p of comp.pts) {
    const x = p % w, y = (p / w) | 0, s = x + y, d = x - y;
    if (s < tl) { tl = s; pTL = [x, y]; }
    if (s > br) { br = s; pBR = [x, y]; }
    if (d > tr) { tr = d; pTR = [x, y]; }
    if (d < bl) { bl = d; pBL = [x, y]; }
  }
  const quad = [pTL, pTR, pBR, pBL].map(([x, y]) => [x / (w - 1), y / (h - 1)]);
  return { quad, luas };
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

/* Hapus bayangan/warna kertas (bagi dengan latar yang diperkirakan), naikkan kontras, lalu pertajam (unsharp 3x3). */
export function bersihkan(img) {
  const { width: w, height: h, data } = img;
  // luminansi latar: kecilkan ke blok ~ w/32 lalu ambil blok terang (persentil) -> bilinear
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
      let v = data[i + c] * (250 / Math.max(60, bgAt(x, y, c)));                                             // putihkan kertas
      v = 255 * Math.pow(Math.min(1, Math.max(0, v / 255)), 1.35);         // gelapkan tinta, kertas tetap putih
      out[i + c] = v;
    }
    out[i + 3] = 255;
  }
  // unsharp: out + 0.9*(out - blur3x3)
  const res = new Uint8ClampedArray(out.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        s += out[(yy * w + xx) * 4 + c]; n++;
      }
      res[i + c] = out[i + c] + 0.9 * (out[i + c] - s / n);
    }
    res[i + 3] = 255;
  }
  return new ImageData(res, w, h);
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", q));

/* Foto dokumen (File) -> File JPEG A4 tegak & tajam. Gagal -> kembalikan file asli. */
export async function scanDokumen(file, { lebar = 1654 } = {}) {      // 1654 x 2339 px = A4 @ 200 dpi
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
    const hit = cariKertas(gray, sw, sh);
    let quad = hit && masukAkal(hit.quad, hit.luas) ? hit.quad : [[0, 0], [1, 0], [1, 1], [0, 1]];   // tak ketemu -> pakai seluruh foto
    const pts = quad.map(([x, y]) => [x * (W - 1), y * (H - 1)]);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const wd = (d(pts[0], pts[1]) + d(pts[3], pts[2])) / 2, ht = (d(pts[0], pts[3]) + d(pts[1], pts[2])) / 2;
    const portrait = ht >= wd;
    const r = Math.max(wd, ht) / Math.max(1, Math.min(wd, ht));
    const rasio = r > 1.49 ? RASIO_F4 : RASIO_A4;                        // kertas F4/folio (330 mm) vs A4 (297 mm), pilih yang paling dekat
    const outW = portrait ? lebar : Math.round(lebar * rasio), outH = portrait ? Math.round(lebar * rasio) : lebar;
    const hasil = bersihkan(warp(sd, W, H, pts, outW, outH));
    const out = document.createElement("canvas"); out.width = outW; out.height = outH;
    out.getContext("2d").putImageData(hasil, 0, 0);
    const blob = await toBlob(out, 0.9);
    if (!blob) return file;
    const nama = String(file.name || "dokumen").replace(/\.[^.]+$/, "") + "-scan.jpg";
    return new File([blob], nama, { type: "image/jpeg" });
  } catch (e) {
    return file;
  }
}
