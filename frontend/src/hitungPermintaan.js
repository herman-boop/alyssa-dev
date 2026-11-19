/* Hitungan murni untuk "Upload Permintaan Harga": HPP + margin -> Biaya Pengiriman, dan entri penawaran. */

/* HPP + margin%, dibulatkan ke atas ribuan (sama seperti kalkulator & Daftar Harga). */
export function hargaDariHpp(hpp, marginPct) {
  const h = Number(hpp) || 0;
  if (h <= 0) return 0;
  return Math.ceil((h * (1 + (Number(marginPct) || 0) / 100)) / 1000) * 1000;
}

/* Harga akhir baris: isian manual admin > harga yang sudah tertulis di lembar pelanggan > 0.
   HPP TIDAK mengisi otomatis (hanya acuan); admin memakainya per baris ("pakai HPP + margin") atau sekaligus ("Isi dari HPP + margin"). */
export function hargaBaris(r, marginPct, manual) {
  const m = manual == null || manual === "" ? null : Number(String(manual).replace(/\D/g, ""));
  if (m != null && !isNaN(m) && m > 0) return m;
  return Number(r.harga) > 0 ? Number(r.harga) : 0;
}

/* Baris yang punya HPP (acuan), apa pun tingkat kecocokannya. */
export const punyaHpp = (r) => !!r && Number(r.hpp) > 0;

/* Isian manual untuk semua baris ber-HPP yang belum diisi: { indeks: "1.234.000" } (HPP + margin). */
export function isiDariHpp(rows, marginPct, manualSekarang) {
  const out = { ...(manualSekarang || {}) };
  (rows || []).forEach((r, i) => {
    if (punyaHpp(r) && (out[i] == null || out[i] === "")) out[i] = hargaDariHpp(r.hpp, marginPct).toLocaleString("id-ID");
  });
  return out;
}

/* Entri untuk PenawaranCetakButton ({rute, moda, tipe_kendaraan, harga_deal, ...}). Baris tanpa harga dilewati. */
/* Gabung metode yang dicentang (urut sesuai daftar) + isian ketik manual -> "Kapal Laut + Car Carrier". */
export function gabungModa(dicentang, urutan, manualText) {
  const pilih = new Set(dicentang || []);
  const hasil = (urutan || []).filter((m) => pilih.has(m));
  const teks = String(manualText || "").trim();
  if (teks) hasil.push(teks);
  return hasil.join(" + ");
}

/* modaBaris: { indeksBaris: "Kapal Laut + Car Carrier" } (atau string tunggal untuk semua baris). */
export function entriPenawaran(rows, marginPct, manualMap, modaBaris) {
  const seen = new Set(), out = [];
  (rows || []).forEach((r, i) => {
    const harga = hargaBaris(r, marginPct, (manualMap || {})[i]);
    if (harga <= 0) return;
    const rute = r.asal && r.tujuan ? `${r.asal} → ${r.tujuan}` : (r.tujuan || r.asal || "-");
    const moda = typeof modaBaris === "string" ? modaBaris : ((modaBaris || {})[i] || "");
    const k = `${rute}|${r.tipe}|${harga}|${moda}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ rute, moda: String(moda), tipe_kendaraan: r.tipe || "", harga_deal: harga, catatan: "", tanggal: "" });
  });
  return out;
}
