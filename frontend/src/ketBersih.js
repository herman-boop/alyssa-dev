/*
  Rapikan keterangan baris faktur: "UNIT NOPOL (ASAL–TUJUAN)<br>No. Rangka: X".
  Data unit sering terisi dobel (mis. model "SDT 85 CU.M | T58512-2611112" + nopol "T58512-2611112" + rangka "SDT 85 CU.M"),
  sehingga di faktur teksnya muncul dua kali. Di sini:
   - kata/nomor di bagian unit yang sudah muncul sebelumnya dibuang (nopol yang sudah ada di model);
   - "No. Rangka" dibuang bila isinya sudah ada di teks unit.
  Hanya tampilan keterangan; data PO/unit tidak diubah. Rangka asli (VIN) tidak pernah ada di teks unit, jadi tetap tampil.
*/
const norm = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function ketBersih(ket) {
  const s = String(ket == null ? "" : ket);
  const m = s.match(/^(.*?)\s*(\([^()]*\))\s*(?:<br\s*\/?>\s*No\.?\s*Rangka:\s*([^<]*))?$/i);
  if (!m) return s;
  const kept = [];
  let seen = "";
  for (const tok of m[1].split(/\s+/).filter(Boolean)) {
    const n = norm(tok);
    if (n.length >= 6 && seen.includes(n)) continue;   // sudah tertulis (utuh) di depannya
    kept.push(tok);
    seen += n;
  }
  const unit = kept.join(" ");
  const rangka = String(m[3] || "").trim();
  const nr = norm(rangka), nu = norm(unit);
  // Rangka dianggap dobel bila utuh ada di teks unit, ATAU semua kata/nomornya sudah ada di teks unit
  // (mis. kotak Rangka berisi "T58512-2611111 SDT 85 CU.M"). VIN asli tidak ada di teks unit, jadi tetap tampil.
  const semuaAda = rangka.split(/\s+/).filter(Boolean).every((t) => { const n = norm(t); return !n || nu.includes(n); });
  const pakaiRangka = rangka && !(nr.length >= 5 && (nu.includes(nr) || semuaAda));
  return `${unit}${unit ? " " : ""}${m[2]}${pakaiRangka ? `<br>No. Rangka: ${rangka}` : ""}`;
}
