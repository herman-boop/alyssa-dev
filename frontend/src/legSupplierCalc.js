/* Rumus Supplier per Leg (sama dengan backend leg_supplier.compute; Kompensasi MENAMBAH tagihan):
     Total Tagihan = Harga Deal + Biaya Tambahan + Kompensasi
     Outstanding   = Total Tagihan - Total Transfer */
export function toInt(v) {
  const n = parseInt(String(v == null ? "" : v).replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

const sum = (arr) => (arr || []).reduce((t, x) => t + toInt(x && x.amount), 0);

export function calcTotals({ harga_deal, extras, kompensasi, transfers }) {
  const deal = toInt(harga_deal);
  const tambahan = sum(extras);
  const komp = sum(kompensasi);
  const trf = sum(transfers);
  const total = deal + tambahan + komp;
  return { harga_deal: deal, biaya_tambahan: tambahan, kompensasi: komp, total_tagihan: total, total_transfer: trf, outstanding: total - trf, hpp_leg: deal + tambahan };
}

export const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

/* Gabung transfer + kompensasi jadi satu timeline, terbaru di atas. */
export function historyOf(rec) {
  const rows = [
    ...((rec && rec.transfers) || []).map((x) => ({ ...x, tipe: "transfer" })),
    ...((rec && rec.kompensasi) || []).map((x) => ({ ...x, tipe: "kompensasi" })),
  ];
  return rows.sort((a, b) => String(b.tanggal || "").localeCompare(String(a.tanggal || "")));
}

export function isPdf(url) {
  return /\.pdf($|\?)/i.test(String(url || ""));
}
