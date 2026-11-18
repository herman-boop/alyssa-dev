/* Hitungan murni untuk "Upload Permintaan Harga": HPP + margin -> Biaya Pengiriman, dan entri penawaran. */

/* HPP + margin%, dibulatkan ke atas ribuan (sama seperti kalkulator & Daftar Harga). */
export function hargaDariHpp(hpp, marginPct) {
  const h = Number(hpp) || 0;
  if (h <= 0) return 0;
  return Math.ceil((h * (1 + (Number(marginPct) || 0) / 100)) / 1000) * 1000;
}

/* Harga akhir baris i: isian manual admin > HPP+margin > harga yang sudah tertulis di lembar pelanggan > 0. */
export function hargaBaris(r, marginPct, manual) {
  const m = manual == null || manual === "" ? null : Number(String(manual).replace(/\D/g, ""));
  if (m != null && !isNaN(m) && m > 0) return m;
  const dariHpp = hargaDariHpp(r.hpp, marginPct);
  if (dariHpp > 0) return dariHpp;
  return Number(r.harga) > 0 ? Number(r.harga) : 0;
}

/* Entri untuk PenawaranCetakButton ({rute, moda, tipe_kendaraan, harga_deal, ...}). Baris tanpa harga dilewati. */
export function entriPenawaran(rows, marginPct, manualMap, moda) {
  const seen = new Set(), out = [];
  (rows || []).forEach((r, i) => {
    const harga = hargaBaris(r, marginPct, (manualMap || {})[i]);
    if (harga <= 0) return;
    const rute = r.asal && r.tujuan ? `${r.asal} → ${r.tujuan}` : (r.tujuan || r.asal || "-");
    const k = `${rute}|${r.tipe}|${harga}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ rute, moda: String(moda || ""), tipe_kendaraan: r.tipe || "", harga_deal: harga, catatan: "", tanggal: "" });
  });
  return out;
}
