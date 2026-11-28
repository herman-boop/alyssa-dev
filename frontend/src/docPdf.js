/*
  PDF A4 dari hasil scan (JPEG), dibuat sepenuhnya di browser tanpa pustaka tambahan.
  Tiap halaman = 1 gambar JPEG yang dimuat apa adanya (DCTDecode), diskalakan muat di A4 dan ditengahkan.
  Halaman portrait -> A4 tegak; gambar landscape -> A4 mendatar.
*/
const A4 = [595.28, 841.89];                       // poin (1/72 inci)
const enc = new TextEncoder();

/* Baca lebar/tinggi/jumlah komponen dari header JPEG (penanda SOFn). */
export function infoJpeg(u8) {
  if (!u8 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < u8.length) {
    if (u8[i] !== 0xff) { i++; continue; }
    const m = u8[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (u8[i + 5] << 8) | u8[i + 6], w: (u8[i + 7] << 8) | u8[i + 8], n: u8[i + 9] };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    i += 2 + ((u8[i + 2] << 8) | u8[i + 3]);
  }
  return null;
}

const f2 = (n) => Number(n).toFixed(2);

/* files: array File/Blob JPEG -> Blob application/pdf (1 halaman per gambar). Melempar Error bila bukan JPEG yang didukung. */
export async function buatPdfA4(files) {
  const imgs = [];
  for (const f of files) {
    const u8 = new Uint8Array(await f.arrayBuffer());
    const info = infoJpeg(u8);
    if (!info || !info.w || !info.h || (info.n !== 1 && info.n !== 3)) throw new Error("Format gambar tidak didukung untuk PDF");
    imgs.push({ u8, ...info });
  }
  if (!imgs.length) throw new Error("Tidak ada halaman");
  const parts = []; const offs = []; let pos = 0;
  const push = (x) => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  const N = imgs.length;
  push("%PDF-1.4\n"); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  offs[1] = pos; push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  const kids = imgs.map((_, i) => `${3 + 3 * i} 0 R`).join(" ");
  offs[2] = pos; push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${N} >>\nendobj\n`);
  imgs.forEach((im, i) => {
    const pg = 3 + 3 * i, ct = pg + 1, ig = pg + 2;
    const land = im.w > im.h;
    const pw = land ? A4[1] : A4[0], ph = land ? A4[0] : A4[1];
    const k = Math.min(pw / im.w, ph / im.h), sw = im.w * k, sh = im.h * k, x = (pw - sw) / 2, y = (ph - sh) / 2;
    offs[pg] = pos;
    push(`${pg} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(pw)} ${f2(ph)}] /Resources << /XObject << /Im0 ${ig} 0 R >> >> /Contents ${ct} 0 R >>\nendobj\n`);
    const cs = `q ${f2(sw)} 0 0 ${f2(sh)} ${f2(x)} ${f2(y)} cm /Im0 Do Q\n`;
    offs[ct] = pos;
    push(`${ct} 0 obj\n<< /Length ${cs.length} >>\nstream\n${cs}endstream\nendobj\n`);
    offs[ig] = pos;
    push(`${ig} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.n === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.u8.length} >>\nstream\n`);
    push(im.u8); push("\nendstream\nendobj\n");
  });
  const total = 3 + 3 * N, xrefAt = pos;
  let xr = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xr += `${String(offs[n]).padStart(10, "0")} 00000 n \n`;
  push(xr + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}

export const namaPdf = (nama) => String(nama || "dokumen").replace(/\.[^.]+$/, "").replace(/-scan$/i, "") + "-scan.pdf";
