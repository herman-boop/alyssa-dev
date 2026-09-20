/* eslint-disable */
/* ============================================================
   REUSABLE REPORT / LAPORAN TEMPLATE — A4 resmi, independen dari
   tampilan dashboard. Dipakai bareng oleh semua laporan yang punya
   tombol Cetak / Simpan PDF / Simpan Gambar (PNG).

   Tujuan (standar output dokumen baru):
   - Cetak A4  : buka dokumen A4 bersih (tanpa sidebar/navbar/tombol) lalu print.
   - Simpan PDF: dokumen A4 vector/text (bukan screenshot). Di browser =
                 print → "Save as PDF"; nama file sudah di-set lewat <title>.
   - Simpan PNG: render dari LAYOUT dokumen (bukan screenshot UI), resolusi
                 tinggi, multi-halaman → file _halaman-1.png, _halaman-2.png, dst.
   - Kop/header/footer MENGIKUTI entitas aktif (PT/CV) — tidak hard-code.
   - Header tabel diulang tiap halaman, ada nomor halaman, periode, tanggal cetak,
     format Rupiah konsisten.

   Kontrak pemakaian:
     printReport({ entity, title, periode, columns, rows, totalRow, footNote, orientation, filename })
     saveReportPNG({ ...sama... })
   dengan:
     columns  = [{ label, align?: 'left'|'right'|'center', width?: '90px', money?: bool }]
     rows     = [[cell, cell, ...], ...]  (selaras urutan columns; money=true → cell angka)
     totalRow = [{ colspan?, text?, money?, value? , align? }]  (opsional, jadi <tfoot>)
   ============================================================ */
import { getActiveEntity } from "@/docTheme";
import html2canvas from "html2canvas";

const esc = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const fmtRp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const cellText = (c, col) => (col && col.money) ? fmtRp(c) : esc(c);
const todayLabel = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/* Kop entitas (dipakai di print & PNG) — logo + nama + alamat + judul + meta. */
function reportKop(entity, { title, periode, printedAt }) {
  const npwpLine = entity.npwp ? `NPWP: ${esc(entity.npwp)}<br/>` : "";
  return `
  <div class="rpt-kop">
    <div class="rpt-kop-l">
      <img class="rpt-logo" src="${esc(entity.logo || "/logo.png")}" alt="" onerror="this.style.display='none'"/>
      <div>
        <div class="rpt-ent-name">${esc(entity.name)}</div>
        <div class="rpt-ent-tag">${esc(entity.tagline || "")}</div>
        <div class="rpt-ent-addr">${esc(entity.address || "")}${entity.phone ? " · Telp: " + esc(entity.phone) : ""}<br/>${npwpLine}</div>
      </div>
    </div>
    <div class="rpt-kop-r">
      <div class="rpt-title">${esc(title)}</div>
      <div class="rpt-meta">Periode: <b>${esc(periode || "-")}</b></div>
      <div class="rpt-meta">Dicetak: ${esc(printedAt)}</div>
    </div>
  </div>`;
}

function reportCSS(orientation) {
  const size = orientation === "landscape" ? "A4 landscape" : "A4 portrait";
  return `
  * { margin:0; padding:0; box-sizing:border-box; }
  html { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  html, body, .rpt-sheet, .rpt-sheet * { -webkit-font-smoothing:antialiased; -moz-osx-font-smoothing:grayscale; text-rendering:geometricPrecision; }
  body { font-family: Arial, "Helvetica Neue", Helvetica, "Segoe UI", Roboto, sans-serif; color:#000; background:#fff; -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
  .rpt-sheet { padding: 0; }
  .rpt-kop { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; border-bottom:2px solid #0f2a5c; padding-bottom:10px; margin-bottom:12px; }
  .rpt-kop-l { display:flex; align-items:center; gap:12px; }
  .rpt-logo { width:46px; height:46px; object-fit:contain; }
  .rpt-ent-name { font-size:15px; font-weight:900; color:#000; letter-spacing:.3px; }
  .rpt-ent-tag { font-size:9px; font-weight:700; color:#c9973a; text-transform:uppercase; letter-spacing:.6px; margin-top:1px; }
  .rpt-ent-addr { font-size:9px; color:#000; line-height:1.5; margin-top:3px; }
  .rpt-kop-r { text-align:right; }
  .rpt-title { font-size:17px; font-weight:900; color:#000; letter-spacing:.4px; }
  .rpt-meta { font-size:10px; color:#000; margin-top:2px; }
  table.rpt { width:100%; border-collapse:collapse; font-size:10px; }
  table.rpt thead { display:table-header-group; }
  table.rpt tfoot { display:table-row-group; }
  table.rpt tr { break-inside:avoid; page-break-inside:avoid; }
  table.rpt th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.3px; color:#1f2937; background:#eef2f7; font-weight:800; padding:6px 8px; border:1px solid #c3ccd8; white-space:nowrap; }
  table.rpt td { padding:5px 8px; border:1px solid #d7dde6; color:#000; vertical-align:top; }
  table.rpt th.r, table.rpt td.r { text-align:right; white-space:nowrap; }
  table.rpt th.c, table.rpt td.c { text-align:center; }
  table.rpt tbody tr:nth-child(even) td { background:#f7f9fb; }
  table.rpt tfoot td { border:1px solid #94a3b8; background:#eef2f7; font-weight:900; font-size:10.5px; color:#000; padding:7px 8px; }
  table.rpt tfoot td.r { text-align:right; }
  .rpt-note { margin-top:12px; font-size:8.5px; color:#475569; line-height:1.6; }
  .rpt-foot { margin-top:14px; padding-top:8px; border-top:1px solid #e3e6ec; display:flex; justify-content:space-between; font-size:8.5px; color:#475569; }
  @page { size:${size}; margin:12mm; }
  @page { @bottom-center { content:"Halaman " counter(page) " dari " counter(pages); font-size:9px; color:#555; } }
  @media print { .rpt-sheet { padding:0; } .rpt-foot .rpt-pageno { display:none; } }
  `;
}

function tableHTML(columns, rows, totalRow) {
  const thead = `<thead><tr>${columns.map((col) => {
    const a = col.align === "right" ? "r" : col.align === "center" ? "c" : "";
    const w = col.width ? ` style="width:${col.width}"` : "";
    return `<th class="${a}"${w}>${esc(col.label)}</th>`;
  }).join("")}</tr></thead>`;
  const tbody = `<tbody>${rows.map((row) => `<tr>${row.map((c, i) => {
    const col = columns[i] || {};
    const a = (col.money || col.align === "right") ? "r" : col.align === "center" ? "c" : "";
    return `<td class="${a}">${cellText(c, col)}</td>`;
  }).join("")}</tr>`).join("")}</tbody>`;
  let tfoot = "";
  if (totalRow && totalRow.length) {
    tfoot = `<tfoot><tr>${totalRow.map((c) => {
      const a = (c.money || c.align === "right") ? "r" : c.align === "center" ? "c" : "";
      const span = c.colspan ? ` colspan="${c.colspan}"` : "";
      const txt = c.money ? fmtRp(c.value) : esc(c.text != null ? c.text : (c.value != null ? c.value : ""));
      return `<td class="${a}"${span}>${txt}</td>`;
    }).join("")}</tr></tfoot>`;
  }
  return `<table class="rpt">${thead}${tbody}${tfoot}</table>`;
}

/* Build 1 full A4 print document (bisa multi-halaman otomatis via CSS). */
export function buildReportHTML(opts) {
  const entity = opts.entity || getActiveEntity();
  const printedAt = opts.printedAt || todayLabel();
  const orientation = opts.orientation || "portrait";
  const kop = reportKop(entity, { title: opts.title, periode: opts.periode, printedAt });
  const table = tableHTML(opts.columns || [], opts.rows || [], opts.totalRow);
  const note = opts.footNote ? `<div class="rpt-note">${esc(opts.footNote)}</div>` : "";
  const foot = `<div class="rpt-foot"><span>${esc(entity.footerName || entity.name)}</span><span class="rpt-pageno">${esc(opts.title)}</span></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.filename || opts.title)}</title>
  <style>${reportCSS(orientation)}</style></head>
  <body><div class="rpt-sheet">${kop}${table}${note}${foot}</div></body></html>`;
}

/* CETAK A4 / SIMPAN PDF — buka dokumen bersih lalu panggil print.
   Nama file PDF default mengikuti <title> (opts.filename). */
export function printReport(opts) {
  const html = buildReportHTML(opts);
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open(); w.document.write(html); w.document.close();
  const go = () => { try { w.focus(); w.print(); } catch (e) {} };
  // tunggu logo/render sebentar biar tidak kepotong
  if (w.document.readyState === "complete") setTimeout(go, 350);
  else w.onload = () => setTimeout(go, 350);
  return true;
}

/* SIMPAN GAMBAR (PNG) — render dari LAYOUT dokumen A4 (offscreen), bukan
   screenshot UI. Multi-halaman → beberapa PNG bernomor. */
export async function saveReportPNG(opts) {
  const entity = opts.entity || getActiveEntity();
  const printedAt = opts.printedAt || todayLabel();
  const orientation = opts.orientation || "portrait";
  const columns = opts.columns || [];
  const rows = opts.rows || [];
  const baseName = (opts.filename || opts.title || "laporan").replace(/[\\/:*?"<>|]+/g, "-");

  // A4 @ ~96dpi (px). Landscape tukar sisi.
  const A4W = orientation === "landscape" ? 1123 : 794;
  const A4H = orientation === "landscape" ? 794 : 1123;
  // Paginate baris: halaman pertama lebih sedikit (kop makan tempat).
  const firstRows = orientation === "landscape" ? 14 : 22;
  const nextRows = orientation === "landscape" ? 20 : 30;
  const chunks = [];
  let i = 0;
  while (i < rows.length) {
    const take = chunks.length === 0 ? firstRows : nextRows;
    chunks.push(rows.slice(i, i + take));
    i += take;
  }
  if (!chunks.length) chunks.push([]);

  const scale = Math.min(3, Math.max(2, Math.ceil((window.devicePixelRatio || 1) * 2)));
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;z-index:-1;background:#fff;";
  document.body.appendChild(host);

  const files = [];
  try {
    for (let p = 0; p < chunks.length; p++) {
      const isLast = p === chunks.length - 1;
      const kop = reportKop(entity, { title: opts.title, periode: opts.periode, printedAt });
      const table = tableHTML(columns, chunks[p], isLast ? opts.totalRow : null);
      const note = (isLast && opts.footNote) ? `<div class="rpt-note">${esc(opts.footNote)}</div>` : "";
      const pageInfo = `Halaman ${p + 1} dari ${chunks.length}`;
      const foot = `<div class="rpt-foot"><span>${esc(entity.footerName || entity.name)}</span><span>${pageInfo}</span></div>`;
      const page = document.createElement("div");
      page.innerHTML = `<style>${reportCSS(orientation)}</style>
        <div class="rpt-sheet" style="width:${A4W}px;min-height:${A4H}px;box-sizing:border-box;background:#fff;padding:40px 40px 48px;">${kop}${table}${note}${foot}</div>`;
      host.appendChild(page);
      const target = page.querySelector(".rpt-sheet");
      // beri waktu logo termuat
      await new Promise((r) => setTimeout(r, 120));
      const canvas = await html2canvas(target, { scale, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const dataUrl = canvas.toDataURL("image/png");
      const fname = chunks.length > 1 ? `${baseName}_halaman-${p + 1}.png` : `${baseName}.png`;
      files.push({ fname, dataUrl });
      host.removeChild(page);
    }
  } finally {
    document.body.removeChild(host);
  }

  // Trigger download tiap file (kasih jeda kecil supaya browser tidak blokir batch).
  for (let k = 0; k < files.length; k++) {
    const a = document.createElement("a");
    a.href = files[k].dataUrl; a.download = files[k].fname;
    document.body.appendChild(a); a.click(); a.remove();
    if (k < files.length - 1) await new Promise((r) => setTimeout(r, 400));
  }
  return files.length;
}
