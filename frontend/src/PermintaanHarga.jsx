/*
  Upload Permintaan Harga: unggah lembar harga dari pelanggan (Excel/CSV, atau foto/PDF) -> baris terisi otomatis,
  HPP diambil dari harga beli supplier, admin menyetel MARGIN -> Biaya Pengiriman terisi -> unduh Excel / buat penawaran.
  Tidak menyimpan apa pun ke database; semua angka bisa diubah per baris sebelum dipakai.
*/
import { useMemo, useRef, useState } from "react";
import axios from "axios";
import { PenawaranCetakButton, METODE_LIST } from "./PenawaranCetak";
import { hargaBaris, entriPenawaran, hargaDariHpp, perkiraan } from "./hitungPermintaan";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const rp = (n) => (Number(n) > 0 ? "Rp " + Number(n).toLocaleString("id-ID") : "—");
const IN = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "6px 9px", color: "#e6edf3", fontSize: 12.5, outline: "none", fontFamily: "inherit" };
const BTN = { padding: "8px 14px", borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3", fontWeight: 700, fontSize: 12.5, cursor: "pointer" };

export default function PermintaanHarga({ headers }) {
  const [rows, setRows] = useState([]);
  const [info, setInfo] = useState({ nama: "", total: 0, cocok: 0, tanpa: 0 });
  const [margin, setMargin] = useState("10");
  const [kepada, setKepada] = useState("");
  const [moda, setModa] = useState("");
  const [manual, setManual] = useState({});          // { indeksBaris: "isian admin" }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const fileRef = useRef(null);

  const unggah = async (f) => {
    if (!f) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", f);
      const r = await axios.post(`${API}/admin/penawaran/permintaan-harga`, fd, { headers, timeout: 180000 });
      setRows(r.data.rows || []); setManual({});
      setInfo({ nama: f.name, total: r.data.total, cocok: r.data.cocok, tanpa: r.data.tanpa_hpp });
    } catch (e) {
      setErr(e?.response?.data?.detail || "Gagal membaca file. Coba Excel/CSV.");
    } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const harga = useMemo(() => rows.map((r, i) => hargaBaris(r, margin, manual[i])), [rows, margin, manual]);
  const entri = useMemo(() => entriPenawaran(rows, margin, manual, moda), [rows, margin, manual, moda]);
  const kosong = harga.filter((h) => h <= 0).length;

  const unduhExcel = async () => {
    try {
      const body = { judul: kepada ? `Penawaran ${kepada}` : "Penawaran harga", rows: rows.map((r, i) => ({ tipe: r.tipe, asal: r.asal, tujuan: r.tujuan, harga: harga[i] })) };
      const r = await axios.post(`${API}/admin/penawaran/permintaan-harga/xlsx`, body, { headers, responseType: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(r.data);
      a.download = `penawaran-${(kepada || "harga").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1500);
    } catch { setErr("Gagal membuat file Excel."); }
  };

  const badge = (r) => r.cocok === "kendaraan" ? { t: `kendaraan sama · ${r.n}x`, c: "#3fb950" } : r.cocok === "rute" ? { t: `rute sama (kendaraan lain) · ${r.n}x`, c: "#d29922" } : r.cocok === "wilayah" ? { t: `tujuan sama, asal sekitar Jakarta · ${r.n}x`, c: "#d29922" } : { t: "belum ada HPP", c: "#f85149" };

  return (
    <div data-testid="ph" style={{ border: "1px solid #2b3445", borderRadius: 10, background: "#0f1520", color: "#e6edf3", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", flexWrap: "wrap" }}>
        <b style={{ color: "#EF9F27", fontSize: 13.5 }}>📤 Upload Permintaan Harga</b>
        <span style={{ fontSize: 11.5, color: "#8b98ad", flex: 1, minWidth: 180 }}>Unggah lembar dari pelanggan (Excel/CSV/foto/PDF). HPP terisi otomatis, Anda tinggal setel margin.</span>
        <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,image/*,application/pdf" style={{ display: "none" }} onChange={(e) => unggah(e.target.files[0])} data-testid="ph-file" />
        <button style={{ ...BTN, background: "#EF9F27", color: "#000", border: "none" }} disabled={busy} onClick={() => fileRef.current && fileRef.current.click()} data-testid="ph-pilih">{busy ? "Membaca…" : rows.length ? "Ganti file" : "Pilih file"}</button>
        {rows.length > 0 && <button style={BTN} onClick={() => setOpen((o) => !o)}>{open ? "Ciutkan" : "Buka"}</button>}
      </div>
      {err && <div style={{ padding: "0 12px 10px", color: "#f85149", fontSize: 12.5 }} data-testid="ph-err">❌ {err}</div>}
      {rows.length > 0 && open && (
        <div style={{ padding: "0 12px 12px" }}>
          <div style={{ fontSize: 12, color: "#8b98ad", marginBottom: 8 }} data-testid="ph-ringkas">
            <b style={{ color: "#e6edf3" }}>{info.nama}</b> · {info.total} baris · <span style={{ color: "#3fb950" }}>{info.cocok} ada HPP</span> · <span style={{ color: info.tanpa ? "#f85149" : "#8b98ad" }}>{info.tanpa} belum ada HPP</span>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: "#d9c58a", display: "flex", alignItems: "center", gap: 6 }}>Margin %
              <input style={{ ...IN, width: 70 }} inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value.replace(/[^0-9.]/g, ""))} data-testid="ph-margin" />
            </label>
            <input style={{ ...IN, minWidth: 170 }} placeholder="Kepada (nama pelanggan)" value={kepada} onChange={(e) => setKepada(e.target.value)} data-testid="ph-kepada" />
            <select style={IN} value={moda} onChange={(e) => setModa(e.target.value)} data-testid="ph-moda">
              <option value="">Moda (isi nanti)</option>
              {METODE_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button style={BTN} onClick={unduhExcel} data-testid="ph-excel">⬇ Excel (Biaya Pengiriman terisi)</button>
            <span data-testid="ph-penawaran-wrap"><PenawaranCetakButton rows={entri} namaPt={kepada} style={{ padding: "8px 14px", fontSize: 12.5 }} /></span>
          </div>
          {kosong > 0 && <div style={{ fontSize: 12, color: "#d29922", marginBottom: 8 }} data-testid="ph-kosong">⚠️ {kosong} baris belum punya harga (isi manual di kolom Biaya Pengiriman). Baris itu tidak ikut ke penawaran.</div>}
          <div style={{ maxHeight: 420, overflow: "auto", border: "1px solid #1c2433", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, color: "#e6edf3", background: "#0f1520" }}>
              <thead><tr style={{ position: "sticky", top: 0, background: "#161b22", color: "#8b98ad", textAlign: "left" }}>
                {["No", "Tipe Kendaraan", "Pengambilan", "Pengiriman", "HPP", "Biaya Pengiriman"].map((h) => <th key={h} style={{ padding: "7px 8px", fontSize: 11, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const b = badge(r);
                  return (
                    <tr key={i} data-testid="ph-row" style={{ borderTop: "1px solid #1c2433", color: "#e6edf3" }}>
                      <td style={{ padding: "6px 8px", color: "#8b98ad" }}>{r.no || i + 1}</td>
                      <td style={{ padding: "6px 8px" }}>{r.tipe}</td>
                      <td style={{ padding: "6px 8px" }}>{r.asal}</td>
                      <td style={{ padding: "6px 8px" }}>{r.tujuan}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                        <div>{rp(r.hpp)}</div>
                        <div style={{ fontSize: 10.5, color: b.c }} title={r.n > 1 ? `Median dari ${r.n} harga (terendah ${rp(r.min)}, tertinggi ${rp(r.max)})` : ""}>{b.t}</div>
                        {perkiraan(r) && manual[i] == null && (
                          <button type="button" style={{ ...BTN, padding: "2px 8px", fontSize: 10.5, marginTop: 3 }} onClick={() => setManual((m) => ({ ...m, [i]: hargaDariHpp(r.hpp, margin).toLocaleString("id-ID") }))} data-testid="ph-pakai">pakai HPP + margin</button>
                        )}
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <input style={{ ...IN, width: 130, textAlign: "right", fontWeight: 700, borderColor: manual[i] ? "#EF9F27" : "#30363d" }} inputMode="numeric"
                          value={manual[i] != null ? manual[i] : (harga[i] > 0 ? harga[i].toLocaleString("id-ID") : "")}
                          placeholder="isi manual"
                          onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setManual((m) => { const n = { ...m }; if (v) n[i] = Number(v).toLocaleString("id-ID"); else delete n[i]; return n; }); }}
                          data-testid="ph-harga" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: "#a89868", marginTop: 8 }}>Biaya Pengiriman = HPP + margin, dibulatkan ke atas ribuan. Kolom HPP memakai median harga beli supplier (lunas): rute yang sama, lalu tujuan yang sama dari asal sekitar Jakarta (Cikarang, Bekasi, dll); kendaraan yang serupa diprioritaskan. Baris oranye = perkiraan: Biaya Pengiriman sengaja dikosongkan (isi manual, atau tekan “pakai HPP + margin”). Hanya baris hijau (kendaraan sama) terisi otomatis. Isian manual berbingkai oranye.</div>
        </div>
      )}
    </div>
  );
}
