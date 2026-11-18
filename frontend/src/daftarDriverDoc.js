/* Dokumen "Daftar Driver": HTML untuk cetak/PDF dan gambar tajam (dibagikan ke WhatsApp). */
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";
import { KOLOM_DRIVER } from "./daftarDriver";
import { htmlKePng, bagikanPng } from "./PenawaranCetak";

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const tglId = (d = new Date()) => {
  const p = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d);
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return `${g("day")}-${g("month")}-${g("year")}`;
};

/* mode: "cetak" (otomatis buka dialog cetak) | "gambar" (huruf lebih besar, lebar tetap, tanpa skrip). */
export function htmlDaftarDriver(rows, mode = "cetak") {
  const gambar = mode === "gambar";
  const fs = gambar ? 14 : 11;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daftar Driver</title>
  <style>
    ${DOC_BASE_CSS}
    ${gambar ? ".doc-sheet { max-width:none; width:1000px; padding:28px 30px 20px; background:#fff; }" : ""}
    table.dd { width:100%; border-collapse:collapse; margin:12px 0; }
    table.dd th { text-align:left; font-size:${gambar ? 12 : 9.5}px; text-transform:uppercase; color:#fff; background:${DOC_BRAND.gold}; padding:${gambar ? 10 : 7}px 8px; }
    table.dd td { padding:${gambar ? 10 : 7}px 8px; font-size:${fs}px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; color:#111; }
    table.dd tbody tr:nth-child(even) td { background:#fbf6ea; }
    table.dd tr { break-inside:avoid; page-break-inside:avoid; }
    table.dd thead { display:table-header-group; }
    @page { size:A4; margin:12mm; }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "DAFTAR DRIVER" })}
    <div style="font-size:${fs}px;margin-bottom:6px">${rows.length} unit &middot; dicetak ${tglId()}</div>
    <table class="dd"><thead><tr>${KOLOM_DRIVER.map((k) => `<th>${k}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.no}</td><td><b>${esc(r.driver) || "—"}</b></td><td>${esc(r.asal)}</td><td>${esc(r.tujuan)}</td><td>${esc(r.ket)}</td><td>${esc(r.tipe)}</td><td>${esc(r.nopol)}</td></tr>`).join("")}</tbody></table>
    ${docFooter({ docNo: "Daftar Driver" })}
  </div>
  ${gambar ? "" : "<script>window.onload=()=>window.print()<\/script>"}
  </body></html>`;
}

/* Buat gambar tajam lalu bagikan lewat Web Share (WhatsApp) bila didukung; kalau tidak, diunduh. -> "dibagikan" | "batal" | "diunduh" */
export async function kirimGambarDaftarDriver(rows) {
  const blobs = await htmlKePng(htmlDaftarDriver(rows, "gambar"), 1000, ".doc-sheet");
  if (!blobs) throw new Error("gambar kosong");
  const tgl = tglId().split("-").reverse().join("");
  return bagikanPng(blobs, `daftar-driver-${tgl}`, "Daftar Driver");
}
