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

/* Satu foto -> { fields, peringatan, ktp: Blob|null, sim: Blob|null }. `post(blob)` memanggil endpoint scan. */
export async function scanFoto(file, post) {
  const bmp = await loadBitmap(file);
  const kecil = await downscaleJpeg(bmp);
  const r = await post(kecil);
  const out = { fields: r.fields || {}, peringatan: r.peringatan || [], ktp: null, sim: null };
  for (const k of ["ktp", "sim"]) {
    if (r[k] && r[k].ada) out[k] = await cropJpeg(bmp, r[k].box);
  }
  return out;
}
