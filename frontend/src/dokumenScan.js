/*
  Scan foto KTP/SIM driver (sisi browser): perkecil foto utk dikirim ke server (AI baca),
  lalu POTONG tiap kartu dari foto asli memakai kotak [x,y,w,h] (pecahan 0..1) hasil AI.
  Tidak ada yang disimpan di sini; pemanggil yang mengunggah potongan setelah admin memeriksa hasilnya.
*/
export async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* jatuh ke <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Foto tidak bisa dibuka (format HEIC? pakai JPG/PNG)")); im.src = url; });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", q));
const dims = (bmp) => [bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight];

/* Foto utuh, sisi terpanjang <= maxSide, JPEG (ringan utk dikirim ke AI). */
export async function downscaleJpeg(bmp, maxSide = 1600, q = 0.85) {
  const [w, h] = dims(bmp);
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return toBlob(c, q);
}

/* Potong kartu: box = [x,y,w,h] pecahan 0..1 (null = seluruh foto). Hasil JPEG, lebar maks maxW. */
export async function cropJpeg(bmp, box, maxW = 1200, q = 0.9) {
  const [W, H] = dims(bmp);
  const [bx, by, bw, bh] = Array.isArray(box) && box.length === 4 ? box : [0, 0, 1, 1];
  const sx = Math.round(bx * W), sy = Math.round(by * H);
  const sw = Math.max(1, Math.min(W - sx, Math.round(bw * W))), sh = Math.max(1, Math.min(H - sy, Math.round(bh * H)));
  const k = Math.min(1, maxW / sw);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return toBlob(c, q);
}

/* Luruskan kartu: ambil 4 sudut (pecahan 0..1; kiri-atas, kanan-atas, kanan-bawah, kiri-bawah) lalu "tarik" jadi
   persegi panjang tegak berukuran kartu ID-1 (KTP & SIM = 85,6 x 54 mm). Kartu miring/terputar/foto dari samping jadi lurus.
   Mengembalikan null bila sudut tidak masuk akal (rasio sisi jauh dari kartu) -> pemanggil jatuh ke potong kotak biasa. */
export const RASIO_KARTU = 85.6 / 53.98;

/* Homografi unit-square -> segi empat (Heckbert): (s,t) di [0,1]^2 -> titik di foto. */
export function homografi(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  return { a: x1 - x0 + g * x1, b: x3 - x0 + h * x3, c: x0, d: y1 - y0 + g * y1, e: y3 - y0 + h * y3, f: y0, g, h };
}

export function sudutPiksel(quad, W, H) {
  return quad.map(([x, y]) => [x * W, y * H]);
}

export function rasioSisi(pts) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (d(pts[0], pts[1]) + d(pts[3], pts[2])) / 2, h = (d(pts[0], pts[3]) + d(pts[1], pts[2])) / 2;
  return h > 0 ? w / h : 0;
}

export async function luruskanKartu(bmp, quad, outW = 1200, q = 0.92, margin = 0) {
  if (!Array.isArray(quad) || quad.length !== 4) return null;
  const [W0, H0] = dims(bmp);
  const k0 = Math.min(1, 2600 / Math.max(W0, H0));                 // batasi memori
  const W = Math.round(W0 * k0), H = Math.round(H0 * k0);
  const pts = sudutPiksel(quad, W, H);
  const ratio = rasioSisi(pts);                                      // sudut berurutan menurut teks kartu -> lebar > tinggi (sekitar 1,59)
  if (!(ratio >= 1.15 && ratio <= 2.2)) return null;
  const oW = outW, oH = Math.round(outW / RASIO_KARTU);
  const src = document.createElement("canvas"); src.width = W; src.height = H;
  const sctx = src.getContext("2d"); sctx.drawImage(bmp, 0, 0, W, H);
  const sd = sctx.getImageData(0, 0, W, H).data;
  const hm = homografi(pts);
  const out = document.createElement("canvas"); out.width = oW; out.height = oH;
  const octx = out.getContext("2d"); const od = octx.createImageData(oW, oH); const o = od.data;
  for (let v = 0; v < oH; v++) {
    const t = (v + 0.5) / oH;
    for (let u = 0; u < oW; u++) {
      const s = (u + 0.5) / oW;
      const dn = hm.g * s + hm.h * t + 1;
      const x = (hm.a * s + hm.b * t + hm.c) / dn - 0.5, y = (hm.d * s + hm.e * t + hm.f) / dn - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const xa = Math.min(W - 1, Math.max(0, x0)), xb = Math.min(W - 1, Math.max(0, x0 + 1));
      const ya = Math.min(H - 1, Math.max(0, y0)), yb = Math.min(H - 1, Math.max(0, y0 + 1));
      const i00 = (ya * W + xa) * 4, i10 = (ya * W + xb) * 4, i01 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
      const oi = (v * oW + u) * 4;
      for (let ch = 0; ch < 3; ch++) {
        o[oi + ch] = sd[i00 + ch] * (1 - fx) * (1 - fy) + sd[i10 + ch] * fx * (1 - fy) + sd[i01 + ch] * (1 - fx) * fy + sd[i11 + ch] * fx * fy;
      }
      o[oi + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return toBlob(out, q);
}

/* Satu foto -> { fields, peringatan, ktp: Blob|null, sim: Blob|null }. `post(blob)` memanggil endpoint scan. */
export async function scanFoto(file, post) {
  const bmp = await loadBitmap(file);
  const kecil = await downscaleJpeg(bmp);
  const r = await post(kecil);
  const out = { fields: r.fields || {}, peringatan: r.peringatan || [], ktp: null, sim: null };
  for (const k of ["ktp", "sim"]) {
    if (r[k] && r[k].ada) {
      let blob = null;
      try { blob = await luruskanKartu(bmp, r[k].sudut); } catch (e) { blob = null; }   // lurus + pas tepi kartu
      out[k] = blob || await cropJpeg(bmp, r[k].box);                                  // cadangan: potong kotak
    }
  }
  return out;
}
