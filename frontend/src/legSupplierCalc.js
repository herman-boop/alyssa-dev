/* Rumus Supplier per Leg = sistem Kompensasi Hutang Piutang (netting 2 arah), sama dengan backend leg_supplier.compute:
     Kewajiban Alyssa -> Supplier = Harga Deal + Biaya Tambahan
     Kewajiban Supplier -> Alyssa = Kompensasi (memotong)
     Sisa Alyssa = Kewajiban Alyssa -> Supplier - Total Transfer
     Outstanding = Sisa Alyssa - Kompensasi  (positif: Alyssa masih bayar; negatif: Supplier wajib bayar ke Alyssa) */
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
  const kita = deal + tambahan;
  const sisaKita = kita - trf;
  const out = sisaKita - komp;
  return {
    harga_deal: deal, biaya_tambahan: tambahan, kompensasi: komp, kewajiban_alyssa: kita, kewajiban_supplier: komp,
    total_transfer: trf, sisa_alyssa: sisaKita, outstanding: out, hpp_leg: kita,
    arah: out > 0 ? "alyssa_bayar" : out < 0 ? "supplier_bayar" : "lunas",
  };
}

export const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

export function sisaText(t, nama) {
  const who = nama || "Supplier";
  if (t.arah === "supplier_bayar") return `SISA KEWAJIBAN: ${who} masih wajib bayar ${rp(-t.outstanding)} ke Alyssa Logistik`;
  if (t.arah === "alyssa_bayar") return `SISA KEWAJIBAN: Alyssa Logistik masih wajib bayar ${rp(t.outstanding)} ke ${who}`;
  return "SISA KEWAJIBAN: Lunas, tidak ada sisa";
}

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
