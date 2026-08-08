/* eslint-disable */
/* ============================================================
   PT Alyssa Auto Logistik — shared print-document design system.
   Used by every printed/PDF document generator (Invoice, BASTK, Surat
   Jalan, Surat Pengantar Driver, ...) so they all share one identity:
   same logo, colors, fonts, header, and footer, instead of each
   document inventing its own look. Inspired by the clean/premium
   layout of the Mekari invoice the company already uses for billing —
   not a copy, but the same instinct: lots of white space, one accent
   color, a confident dark "total" bar, clear typographic hierarchy.
   ============================================================ */

export const DOC_BRAND = {
  name: "PT. ALYSSA AUTO LOGISTIK",
  tagline: "Spesialis Pengiriman Kendaraan",
  address: "Jl Enim Raya 2 No 86, Jakarta Utara, DKI Jakarta 14330",
  phone: "0818 631 135",
  npwp: "26.981.990.0-042.000",
  bank: { name: "BCA", cabang: "Tanjung Priok", norek: "0072-8902-71", an: "PT ALYSSA AUTO LOGISTIK" },
  navy: "#0f2a5c",
  navyDeep: "#0a1e42",
  gold: "#c9973a",
  // Semua TEKS dokumen cetak = hitam pekat (#000) supaya tajam di printer laser
  // & inkjet. Warna biru/emas dipertahankan HANYA untuk elemen non-teks:
  // background header, garis dekoratif, kotak TOTAL, badge bank.
  ink: "#000000",
  muted: "#000000",
  line: "#e3e6ec",
  paperMist: "#f7f8fa",
};

export const DOC_BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  /* Paksa browser mempertahankan warna asli (navy header, badge, zebra) saat
     dicetak / Save as PDF — tanpa ini latar warna di-strip walau "Background
     graphics" tidak dicentang, sehingga teks putih di atas navy jadi hilang. */
  html { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  /* Ketajaman teks: font sistem asli (vektor di PDF), antialias & presisi geometri,
     TANPA transform/scale/zoom/opacity/filter di area teks. */
  html, body, .doc-sheet, .doc-sheet * {
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    text-rendering: geometricPrecision;
  }
  body { font-family: Arial, "Helvetica Neue", Helvetica, "Segoe UI", Roboto, sans-serif; font-size: 11px; color: ${DOC_BRAND.ink}; background: #fff; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .doc-sheet { padding: 14mm 14mm 10mm; max-width: 210mm; margin: 0 auto; }
  .doc-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding-bottom:14px; border-bottom:2.5px solid ${DOC_BRAND.navy}; margin-bottom:16px; }
  .doc-brand { display:flex; align-items:center; gap:12px; }
  .doc-brand img { width:46px; height:46px; object-fit:contain; flex-shrink:0; }
  .doc-brand-name { font-size:15px; font-weight:900; color:#000; letter-spacing:.3px; }
  .doc-brand-tag { font-size:9px; color:${DOC_BRAND.gold}; font-weight:700; text-transform:uppercase; letter-spacing:.6px; margin-top:1px; }
  .doc-addr { text-align:right; font-size:9.5px; color:${DOC_BRAND.muted}; line-height:1.6; }
  .doc-title { font-size:20px; font-weight:900; color:#000; letter-spacing:.5px; text-align:right; margin-bottom:2px; }
  .doc-footer { display:flex; justify-content:space-between; align-items:center; padding-top:10px; margin-top:20px; border-top:1px solid ${DOC_BRAND.line}; font-size:8.5px; color:${DOC_BRAND.muted}; }
  @media print {
    @page { margin:0; size:A4 portrait; }
    body { padding:0; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`;

/* Header block: logo + nama perusahaan di kiri, alamat + judul dokumen di kanan. */
export function docHeader({ logoUrl = "/logo.png", docTitle, docSub }) {
  return `
    <div class="doc-header">
      <div class="doc-brand">
        <img src="${logoUrl}" alt="Logo" />
        <div>
          <div class="doc-brand-name">${DOC_BRAND.name}</div>
          <div class="doc-brand-tag">${docSub || DOC_BRAND.tagline}</div>
        </div>
      </div>
      <div>
        <div class="doc-title">${docTitle}</div>
        <div class="doc-addr">
          ${DOC_BRAND.address}<br/>
          Telp: ${DOC_BRAND.phone}<br/>
          NPWP: ${DOC_BRAND.npwp}
        </div>
      </div>
    </div>`;
}

export function docFooter({ docNo = "", centerText = DOC_BRAND.tagline }) {
  return `
    <div class="doc-footer">
      <span>${docNo}</span>
      <span>${centerText}</span>
      <span>PT Alyssa Auto Logistik</span>
    </div>`;
}

/* ── Terbilang: angka Rupiah -> teks bahasa Indonesia (buat baris "Terbilang" di invoice/kwitansi) ── */
const _SATUAN = ["", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan",
  "Sepuluh", "Sebelas", "Dua Belas", "Tiga Belas", "Empat Belas", "Lima Belas", "Enam Belas",
  "Tujuh Belas", "Delapan Belas", "Sembilan Belas"];

function _terbilangGroup(n) {
  if (n === 0) return "";
  if (n < 20) return _SATUAN[n];
  if (n < 100) {
    const puluh = Math.floor(n / 10), sisa = n % 10;
    return (puluh === 1 ? "Sepuluh" : `${_SATUAN[puluh]} Puluh`) + (sisa ? ` ${_SATUAN[sisa]}` : "");
  }
  if (n < 1000) {
    const ratus = Math.floor(n / 100), sisa = n % 100;
    return (ratus === 1 ? "Seratus" : `${_SATUAN[ratus]} Ratus`) + (sisa ? ` ${_terbilangGroup(sisa)}` : "");
  }
  return "";
}

/* ── Nomor dokumen auto-increment (Invoice / Penawaran) ──
   Ambil nomor urut yang persist dari backend (/api/doc-seq), lalu format:
   PREFIX + 4-digit urut + _DDMMYYYY_YYYY  (mis. INV0001_29072026_2026).
   Kalau server nggak kebaca, fallback ke jam:menit:detik biar tetap jalan &
   nggak pernah bentrok. */
export async function nextDocNo(type, prefix) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  const datePart = `${dd}${mm}${yyyy}`;
  try {
    const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
    const r = await fetch(`${API}/doc-seq`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (!r.ok) throw new Error("seq");
    const d = await r.json();
    const seq = String(d.seq || 1).padStart(4, "0");
    return `${prefix}${seq}_${datePart}_${yyyy}`;
  } catch {
    const t = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0") + String(now.getSeconds()).padStart(2, "0");
    return `${prefix}${t}_${datePart}_${yyyy}`;
  }
}

export function terbilangRupiah(nominal) {
  let n = Math.floor(Math.abs(Number(nominal) || 0));
  if (n === 0) return "Nol Rupiah";
  const groups = [];
  const scales = ["", "Ribu", "Juta", "Miliar", "Triliun"];
  let scaleIdx = 0;
  while (n > 0) {
    const g = n % 1000;
    if (g > 0) {
      let text = _terbilangGroup(g);
      if (scaleIdx === 1 && g === 1) text = "Seribu";
      else if (scales[scaleIdx]) text = `${text} ${scales[scaleIdx]}`;
      groups.unshift(text);
    }
    n = Math.floor(n / 1000);
    scaleIdx++;
  }
  return `${groups.join(" ")} Rupiah`.replace(/\s+/g, " ").trim();
}
