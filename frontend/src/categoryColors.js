/*
  Warna kategori utama sistem (sumber tunggal):
    Penjualan     -> Emerald (#22C55E)  : pendapatan / cuan
    Pembelian     -> Biru laut (#0EA5E9): senada dengan warna tracking jalur laut
    Biaya / Beban -> Ungu neon (#A855F7): pengeluaran

  main : warna persis untuk titik, garis, dan latar badge
  ink  : teks gelap di atas badge `main` (kontras tinggi)
  text : varian lebih gelap dari hue yang sama untuk TEKS di atas latar putih (kontras >= 4.5:1)
  soft : tint sangat muda untuk latar putih
  chip : kelas Tailwind literal untuk badge (ditulis utuh supaya terdeteksi Tailwind)
*/
export const CATEGORY = {
  penjualan: { key: "penjualan", label: "Penjualan", main: "#22C55E", ink: "#052E16", text: "#15803D", soft: "#DCFCE7", chip: "bg-[#22C55E] text-[#052E16]" },
  pembelian: { key: "pembelian", label: "Pembelian", main: "#0EA5E9", ink: "#082F49", text: "#0369A1", soft: "#E0F2FE", chip: "bg-[#0EA5E9] text-[#082F49]" },
  biaya:     { key: "biaya",     label: "Biaya / Beban", main: "#A855F7", ink: "#12032B", text: "#7E22CE", soft: "#F3E8FF", chip: "bg-[#A855F7] text-[#12032B]" },
};

const BY_GROUP_TITLE = { "Penjualan": "penjualan", "Pembelian": "pembelian", "Biaya / Beban": "biaya" };

export function categoryOfGroupTitle(title) {
  return CATEGORY[BY_GROUP_TITLE[title]] || null;
}

/* Kategori dari key tab, menurut grup sidebar (satu sumber dengan menu). null kalau bukan 3 kategori utama. */
export function categoryOfTab(tabKey, groups) {
  for (const g of groups || []) {
    if ((g.items || []).some((i) => i.key === tabKey)) return categoryOfGroupTitle(g.title);
  }
  return null;
}
