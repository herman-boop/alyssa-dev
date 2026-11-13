/*
  Daftar Harga — tabel gaya spreadsheet (baris per harga), filter per kolom di atas, urut dengan klik judul kolom,
  ringkasan hasil (jumlah / terendah / median / tertinggi) dan ekspor CSV hasil filter.
  Hanya tampilan: tidak mengubah data apa pun. Fungsi murni (filterSortRows, ringkasHarga, toCsv) diekspor untuk diuji.
*/
import { useMemo, useState } from "react";
import { PenawaranCetakButton, METODE_LIST } from "./PenawaranCetak";

const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const tg = (t) => (t ? String(t).slice(0, 10).split("-").reverse().join("/") : "");
const low = (s) => String(s == null ? "" : s).toLowerCase();

/* Kolom per mode. get = nilai teks untuk filter/urut; num = nilai angka (harga). */
export const COLS = {
  jual: [
    { key: "asal", label: "Asal", get: (r) => r.asal, filter: "text", w: 120 },
    { key: "tujuan", label: "Tujuan", get: (r) => r.tujuan, filter: "text", w: 120 },
    { key: "harga", label: "Harga / unit", get: (r) => r.harga, num: true, filter: "range", w: 130, right: true },
    { key: "kendaraan", label: "Kendaraan", get: (r) => r.vehicle_type, filter: "text", w: 190 },
    { key: "pihak", label: "Pelanggan", get: (r) => r.customer, filter: "text", w: 170 },
    { key: "tanggal", label: "Tanggal", get: (r) => String(r.tanggal || "").slice(0, 10), filter: "text", w: 96, fmt: tg },
    { key: "no", label: "No. Invoice", get: (r) => r.no_invoice, filter: "text", w: 150 },
  ],
  beli: [
    { key: "asal", label: "Asal", get: (r) => r.asal, filter: "text", w: 120 },
    { key: "tujuan", label: "Tujuan", get: (r) => r.tujuan, filter: "text", w: 120 },
    { key: "harga", label: "Harga / unit", get: (r) => r.harga, num: true, filter: "range", w: 130, right: true },
    { key: "kendaraan", label: "Kendaraan", get: (r) => r.vehicle_type, filter: "text", w: 190 },
    { key: "pihak", label: "Supplier", get: (r) => r.supplier_nama, filter: "text", w: 170 },
    { key: "nopol", label: "Nopol", get: (r) => r.nopol, filter: "text", w: 110 },
    { key: "tanggal", label: "Tanggal", get: (r) => String(r.tanggal || "").slice(0, 10), filter: "text", w: 96, fmt: tg },
  ],
};

/* filters = { [kolom]: teks, hargaMin: "", hargaMax: "" }. Semua syarat berlaku bersamaan (DAN). */
export function filterSortRows(rows, cols, filters, sort) {
  const f = filters || {};
  const min = Number(String(f.hargaMin || "").replace(/\D/g, "")) || 0;
  const max = Number(String(f.hargaMax || "").replace(/\D/g, "")) || 0;
  const texts = cols.filter((c) => c.filter === "text" && String(f[c.key] || "").trim()).map((c) => [c, low(f[c.key]).trim()]);
  let out = (rows || []).filter((r) => {
    if (min && !(Number(r.harga) >= min)) return false;
    if (max && !(Number(r.harga) <= max)) return false;
    return texts.every(([c, q]) => low(c.get(r)).includes(q));
  });
  if (sort && sort.key) {
    const c = cols.find((x) => x.key === sort.key);
    if (c) {
      const dir = sort.dir === "desc" ? -1 : 1;
      out = out.slice().sort((a, b) => {
        const x = c.get(a), y = c.get(b);
        const cmp = c.num ? (Number(x) || 0) - (Number(y) || 0) : String(x == null ? "" : x).localeCompare(String(y == null ? "" : y), "id", { sensitivity: "base" });
        return cmp * dir;
      });
    }
  }
  return out;
}

export function ringkasHarga(rows) {
  const hs = (rows || []).map((r) => Number(r.harga) || 0).filter((h) => h > 0).sort((a, b) => a - b);
  if (!hs.length) return { n: (rows || []).length, min: 0, median: 0, max: 0 };
  const m = Math.floor(hs.length / 2);
  return { n: rows.length, min: hs[0], median: hs.length % 2 ? hs[m] : Math.round((hs[m - 1] + hs[m]) / 2), max: hs[hs.length - 1] };
}

export function toCsv(rows, cols) {
  const q = (v) => { const s = String(v == null ? "" : v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = cols.map((c) => q(c.label)).join(";");
  const body = (rows || []).map((r) => cols.map((c) => q(c.num ? Number(c.get(r)) || 0 : (c.fmt ? c.fmt(c.get(r)) : c.get(r)))).join(";"));
  return [head, ...body].join("\r\n");
}

/* Rapikan teks kendaraan untuk penawaran: buang nopol dan nomor rangka (data pelanggan lain tidak ikut tercetak). */
export function bersihKendaraan(v) {
  return String(v == null ? "" : v)
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, " ")
    .replace(/\b[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{1,3}\b/g, " ")
    .replace(/\s*[-–]\s*$/g, "").replace(/\s+/g, " ").trim();
}

/* Baris tercentang -> entri penawaran (format PenawaranCetakButton). Mode beli: HPP + margin% (naik ke ribuan, seperti kalkulator).
   Entri kembar (rute + kendaraan + harga sama) digabung jadi satu. */
export function rowsKePenawaran(rows, selIdx, mode, marginPct, moda) {
  const m = Number(marginPct) || 0;
  const seen = new Set(), out = [];
  [...selIdx].sort((a, b) => a - b).forEach((i) => {
    const r = rows[i]; if (!r) return;
    const base = Number(r.harga) || 0; if (base <= 0) return;
    const harga = mode === "beli" ? Math.ceil((base * (1 + m / 100)) / 1000) * 1000 : base;
    const rute = r.asal && r.tujuan ? `${r.asal} → ${r.tujuan}` : (r.rute || r.asal || r.tujuan || "-");
    const tipe = bersihKendaraan(r.vehicle_type);
    const k = `${rute}|${tipe}|${harga}|${moda || ""}`;
    if (seen.has(k)) return; seen.add(k);
    out.push({ rute, moda: String(moda || ""), tipe_kendaraan: tipe, harga_deal: harga, catatan: "", tanggal: String(r.tanggal || "").slice(0, 10) });
  });
  return out;
}

const CSS = `
.dhg-wrap{border:1px solid #30363d;border-radius:12px;overflow:hidden;background:#0d1117}
.dhg-scroll{overflow:auto;max-height:68vh;-webkit-overflow-scrolling:touch}
.dhg-table{border-collapse:separate;border-spacing:0;width:100%;font-size:13px;color:#e6edf3;font-variant-numeric:tabular-nums}
.dhg-table th,.dhg-table td{padding:8px 10px;border-bottom:1px solid #1c2433;white-space:nowrap;text-align:left}
.dhg-table thead th{position:sticky;background:#111826;z-index:2}
.dhg-th{top:0;height:34px;line-height:18px;box-sizing:border-box;font-weight:800;font-size:11.5px;letter-spacing:.4px;text-transform:uppercase;color:#9fb0c8;cursor:pointer;user-select:none}
.dhg-th:hover{color:#fff}
.dhg-flt{top:34px;height:42px;box-sizing:border-box;padding:5px 6px!important;border-bottom:2px solid #EF9F27!important}
.dhg-flt input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid #30363d;background:#0d1117;color:#e6edf3;font-size:12px;outline:none}
.dhg-flt input:focus{border-color:#EF9F27}
.dhg-table tbody tr:nth-child(even){background:rgba(255,255,255,.025)}
.dhg-table tbody tr:hover{background:rgba(239,159,39,.10)}
.dhg-r{text-align:right!important}
.dhg-ck{width:38px;min-width:38px;text-align:center!important;padding:6px 4px!important}
.dhg-ck input{width:16px;height:16px;accent-color:#EF9F27;cursor:pointer}
.dhg-table tbody tr.dhg-on{background:rgba(239,159,39,.16)}
.dhg-act{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px;border-bottom:1px solid #EF9F27;background:#1a1405}
.dhg-act input.dhg-in{padding:7px 9px;border-radius:6px;border:1px solid #5a4a1a;background:#0d1117;color:#e6edf3;font-size:12.5px;outline:none;min-width:180px}
.dhg-price{font-weight:800;color:#f5f7fb}
.dhg-sum{display:flex;gap:8px;flex-wrap:wrap;padding:10px;border-bottom:1px solid #1c2433;background:#0b1220}
.dhg-chip{background:#111826;border:1px solid #22304a;border-radius:10px;padding:6px 12px;min-width:92px}
.dhg-chip b{display:block;font-size:14px;color:#f5f7fb}.dhg-chip span{font-size:10.5px;color:#8b98ad;text-transform:uppercase;letter-spacing:.4px}
.dhg-bar{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:8px 10px;flex-wrap:wrap}
.dhg-btn{background:#111826;border:1px solid #30363d;color:#e6edf3;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}
.dhg-btn:hover{border-color:#EF9F27}
`;

export default function DaftarHargaGrid({ rows, mode }) {
  const cols = COLS[mode] || COLS.jual;
  const [filters, setFilters] = useState({});
  const [sort, setSort] = useState({ key: "tanggal", dir: "desc" });
  const [limit, setLimit] = useState(200);
  const [pilih, setPilih] = useState(() => new Set());   // indeks baris (di `rows`) yang dicentang; bertahan walau filter diganti
  const [kepada, setKepada] = useState("");
  const [margin, setMargin] = useState("10");
  const [moda, setModa] = useState("");   // moda untuk SEMUA baris yang dicentang ("" = kosong, diisi di form penawaran)
  const idx = useMemo(() => new Map((rows || []).map((r, i) => [r, i])), [rows]);
  const shown = useMemo(() => filterSortRows(rows, cols, filters, sort), [rows, cols, filters, sort]);
  const sum = useMemo(() => ringkasHarga(shown), [shown]);
  const setF = (k) => (e) => { setFilters((p) => ({ ...p, [k]: e.target.value })); setLimit(200); };
  const clickSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "harga" || k === "tanggal" ? "desc" : "asc" }));
  const toggle = (r) => setPilih((s) => { const n = new Set(s); const i = idx.get(r); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const semuaTercentang = shown.length > 0 && shown.every((r) => pilih.has(idx.get(r)));
  const toggleSemua = () => setPilih((s) => { const n = new Set(s); if (semuaTercentang) shown.forEach((r) => n.delete(idx.get(r))); else shown.forEach((r) => n.add(idx.get(r))); return n; });
  const entriPenawaran = useMemo(() => rowsKePenawaran(rows || [], pilih, mode, margin, moda), [rows, pilih, mode, margin, moda]);
  const aktif = Object.values(filters).some((v) => String(v || "").trim());
  const unduh = () => {
    try {
      const blob = new Blob(["﻿" + toCsv(shown, cols)], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = `daftar-harga-${mode === "jual" ? "jual" : "beli"}.csv`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch (e) { window.alert("Gagal mengunduh."); }
  };
  const arrow = (k) => (sort.key === k ? (sort.dir === "asc" ? " ▲" : " ▼") : "");
  return (
    <div className="dhg-wrap" data-testid="dhg">
      <style>{CSS}</style>
      <div className="dhg-sum">
        <div className="dhg-chip"><b data-testid="dhg-n">{sum.n.toLocaleString("id-ID")}</b><span>baris</span></div>
        <div className="dhg-chip"><b>{rp(sum.min)}</b><span>terendah</span></div>
        <div className="dhg-chip"><b>{rp(sum.median)}</b><span>median</span></div>
        <div className="dhg-chip"><b>{rp(sum.max)}</b><span>tertinggi</span></div>
      </div>
      {pilih.size > 0 && (
        <div className="dhg-act" data-testid="dhg-act">
          <b style={{ color: "#EF9F27", fontSize: 13 }} data-testid="dhg-picked">{pilih.size} dicentang</b>
          <input className="dhg-in" placeholder="Kepada (nama pelanggan)" value={kepada} onChange={(e) => setKepada(e.target.value)} data-testid="dhg-kepada" />
          <label style={{ fontSize: 12, color: "#d9c58a", display: "flex", alignItems: "center", gap: 6 }}>Moda
            <select className="dhg-in" style={{ minWidth: 0 }} value={moda} onChange={(e) => setModa(e.target.value)} data-testid="dhg-moda">
              <option value="">(isi nanti di form)</option>
              {METODE_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          {mode === "beli" && (
            <label style={{ fontSize: 12, color: "#d9c58a", display: "flex", alignItems: "center", gap: 6 }}>Margin %
              <input className="dhg-in" style={{ minWidth: 0, width: 64 }} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="dhg-margin" />
            </label>
          )}
          <span data-testid="dhg-penawaran-wrap"><PenawaranCetakButton rows={entriPenawaran} namaPt={kepada} style={{ padding: "8px 14px", fontSize: 12 }} /></span>
          <button className="dhg-btn" onClick={() => setPilih(new Set())} data-testid="dhg-kosongkan">Kosongkan centang</button>
          <span style={{ fontSize: 11.5, color: "#a89868", flexBasis: "100%" }}>
            {mode === "beli" ? "Harga Beli + margin dijadikan harga penawaran. " : "Harga yang pernah ditagih dipakai sebagai harga penawaran. "}
            {entriPenawaran.length} rute akan masuk ke form penawaran (entri kembar digabung); moda, harga, jumlah unit, dan asuransi masih bisa diubah di sana.
          </span>
        </div>
      )}
      <div className="dhg-bar">
        <span style={{ fontSize: 12, color: "#8b98ad" }}>{aktif ? "Filter aktif" : "Ketik di baris filter untuk menyaring"} · klik judul kolom untuk mengurutkan</span>
        <span style={{ display: "flex", gap: 8 }}>
          {aktif && <button className="dhg-btn" onClick={() => { setFilters({}); setLimit(200); }} data-testid="dhg-reset">Reset filter</button>}
          <button className="dhg-btn" onClick={unduh} data-testid="dhg-csv">⬇ CSV (hasil filter)</button>
        </span>
      </div>
      <div className="dhg-scroll">
        <table className="dhg-table">
          <thead>
            <tr><th className="dhg-th dhg-ck" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={semuaTercentang} onChange={toggleSemua} title="Centang semua hasil filter" data-testid="dhg-all" /></th>{cols.map((c) => <th key={c.key} className={"dhg-th" + (c.right ? " dhg-r" : "")} style={{ minWidth: c.w }} onClick={() => clickSort(c.key)}>{c.label}{arrow(c.key)}</th>)}</tr>
            <tr><th className="dhg-flt" />{cols.map((c) => (
              <th key={c.key} className="dhg-flt">
                {c.filter === "range" ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input inputMode="numeric" placeholder="min" value={filters.hargaMin || ""} onChange={setF("hargaMin")} data-testid="dhg-f-min" />
                    <input inputMode="numeric" placeholder="maks" value={filters.hargaMax || ""} onChange={setF("hargaMax")} data-testid="dhg-f-max" />
                  </div>
                ) : <input placeholder="filter…" value={filters[c.key] || ""} onChange={setF(c.key)} data-testid={`dhg-f-${c.key}`} />}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {shown.slice(0, limit).map((r, i) => (
              <tr key={(r.doc_id || r.job_id || "") + ":" + i} data-testid="dhg-row" className={pilih.has(idx.get(r)) ? "dhg-on" : ""}>
                <td className="dhg-ck"><input type="checkbox" checked={pilih.has(idx.get(r))} onChange={() => toggle(r)} data-testid="dhg-ck" /></td>
                {cols.map((c) => {
                  const v = c.get(r);
                  return <td key={c.key} className={(c.right ? "dhg-r " : "") + (c.key === "harga" ? "dhg-price" : "")} title={c.num ? undefined : String(v || "")} style={c.key === "kendaraan" || c.key === "pihak" ? { maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" } : undefined}>
                    {c.num ? rp(v) : (c.fmt ? c.fmt(v) : (v || "—"))}
                  </td>;
                })}
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={cols.length + 1} style={{ textAlign: "center", padding: 28, color: "#8b98ad" }}>{(rows || []).length ? "Tidak ada baris yang cocok dengan filter." : "Belum ada data harga."}</td></tr>}
          </tbody>
        </table>
      </div>
      {shown.length > limit && (
        <div style={{ padding: 10, textAlign: "center", borderTop: "1px solid #1c2433" }}>
          <button className="dhg-btn" onClick={() => setLimit((l) => l + 300)} data-testid="dhg-more">Tampilkan {Math.min(300, shown.length - limit)} baris lagi ({limit.toLocaleString("id-ID")} dari {shown.length.toLocaleString("id-ID")})</button>
        </div>
      )}
    </div>
  );
}
