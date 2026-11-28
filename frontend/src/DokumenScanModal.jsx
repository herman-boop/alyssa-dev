/* Pratinjau scan dokumen sebelum diunggah (seperti aplikasi pemindai di HP):
   foto dipotong otomatis, diluruskan A4/F4, dibersihkan & dipertajam. Dua mode:
   - Hitam-putih (tajam): teks hitam pekat di atas kertas putih, layak untuk lampiran invoice/arsip perusahaan.
   - Warna: kertas putih bersih, warna asli (logo, stempel) dipertahankan.
   Admin lihat hasilnya, boleh pakai foto asli, lalu Simpan. */
import { useEffect, useRef, useState } from "react";
import { scanDokumen } from "./docScan";

const LS_MODE = "alyssa_scan_dokumen_mode";
const LS_ON = "alyssa_scan_dokumen_otomatis";
const bacaMode = () => { try { return localStorage.getItem(LS_MODE) === "warna" ? "warna" : "bw"; } catch (e) { return "bw"; } };
const bacaOn = () => { try { return localStorage.getItem(LS_ON) !== "0"; } catch (e) { return true; } };
const simpanLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* abaikan */ } };
const adalahFoto = (f) => /^image\//.test(f.type || "") && !/heic|heif/i.test(f.type || "");
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

export default function DokumenScanModal({ files, onSave, onClose }) {
  const [mode, setMode] = useState(bacaMode);
  const [auto, setAuto] = useState(bacaOn);
  // cache hasil per file per mode: { bw: {file,url}, warna: {file,url} | {gagal:true} }
  const [item, setItem] = useState(() => files.map((f) => ({ asli: f, foto: adalahFoto(f), urlAsli: adalahFoto(f) ? URL.createObjectURL(f) : "", cache: {}, proses: false, pakai: bacaOn() ? "scan" : "asli" })));
  const batal = useRef(false);
  const itemRef = useRef(item); itemRef.current = item;

  // Pindai berurutan (hemat memori HP) untuk mode yang dipilih; hasil per mode disimpan supaya ganti mode tidak mengulang.
  useEffect(() => {
    let live = true; batal.current = false;
    (async () => {
      for (let i = 0; i < files.length; i++) {
        if (!live || batal.current) return;
        const it = itemRef.current[i];
        if (!it.foto || it.cache[mode]) continue;
        setItem((a) => a.map((x, k) => (k === i ? { ...x, proses: true } : x)));
        const hasil = await scanDokumen(files[i], { mode });
        if (!live || batal.current) return;
        const ok = hasil && hasil !== files[i];
        const entri = ok ? { file: hasil, url: URL.createObjectURL(hasil) } : { gagal: true };
        setItem((a) => a.map((x, k) => (k === i ? { ...x, proses: false, cache: { ...x.cache, [mode]: entri } } : x)));
      }
    })();
    return () => { live = false; };
  }, [mode]);   // eslint-disable-line
  useEffect(() => () => { batal.current = true; itemRef.current.forEach((x) => { if (x.urlAsli) URL.revokeObjectURL(x.urlAsli); Object.values(x.cache).forEach((c) => c.url && URL.revokeObjectURL(c.url)); }); }, []);

  const ubahMode = (m) => { setMode(m); simpanLS(LS_MODE, m); };
  const ubahAuto = (v) => { setAuto(v); simpanLS(LS_ON, v ? "1" : "0"); setItem((a) => a.map((x) => ({ ...x, pakai: v ? "scan" : "asli" }))); };
  const pilih = (i, p) => setItem((a) => a.map((x, k) => (k === i ? { ...x, pakai: p } : x)));
  const hasilDari = (x) => (x.cache[mode] && x.cache[mode].file) || null;
  const efektif = (x) => (x.pakai === "scan" && hasilDari(x) ? "scan" : "asli");
  const sibuk = item.some((x) => x.foto && !x.cache[mode]);
  const simpan = () => onSave(item.map((x) => (efektif(x) === "scan" ? hasilDari(x) : x.asli)));

  const btn = (aktif) => ({ padding: "6px 10px", borderRadius: 8, border: `1px solid ${aktif ? "#1f6feb" : "#2a3344"}`, background: aktif ? "#0b1d3a" : "#0d1117", color: aktif ? "#58a6ff" : "#8b949e", fontWeight: 700, fontSize: 12, cursor: "pointer" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="scan-modal" style={{ background: "#0d1117", border: "1px solid #2a3344", borderRadius: 12, padding: 14, width: "100%", maxWidth: 760, maxHeight: "94vh", overflowY: "auto", color: "#e6edf3" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📄 Scan Dokumen</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 6px", fontSize: 12.5 }}>
          <input type="checkbox" checked={auto} onChange={(e) => ubahAuto(e.target.checked)} data-testid="scan-auto" />
          <span><b>Scan otomatis</b> (potong, luruskan A4, bersihkan bayangan, pertajam)</span>
        </label>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }} data-testid="scan-mode">
          <span style={{ fontSize: 11.5, color: "#8b949e", fontWeight: 700 }}>Mode:</span>
          <button onClick={() => ubahMode("bw")} style={btn(mode === "bw")} data-testid="scan-mode-bw" title="Teks hitam pekat di kertas putih — paling tajam, cocok untuk lampiran invoice/arsip">⚫⚪ Hitam-putih (tajam)</button>
          <button onClick={() => ubahMode("warna")} style={btn(mode === "warna")} data-testid="scan-mode-warna" title="Kertas putih bersih, warna asli (logo, stempel) dipertahankan">🎨 Warna</button>
        </div>
        {sibuk && auto && <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }} data-testid="scan-proses">⏳ Memindai…</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {item.map((x, i) => {
            const c = x.cache[mode];
            const pakaiScan = efektif(x) === "scan";
            const url = pakaiScan ? c.url : x.urlAsli;
            const ukuran = (pakaiScan ? c.file : x.asli).size;
            return (
              <div key={i} data-testid={`scan-item-${i}`} style={{ border: "1px solid #1a2130", borderRadius: 10, padding: 8, background: "#0a0e16" }}>
                <div style={{ height: 300, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", borderRadius: 6, overflow: "hidden" }}>
                  {url ? <img src={url} alt="" title="Ketuk untuk lihat ukuran penuh" onClick={() => window.open(url, "_blank")} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", cursor: "zoom-in" }} data-testid={`scan-img-${i}`} />
                    : <div style={{ color: "#444", fontSize: 12, padding: 10, textAlign: "center" }}>{!x.foto ? "PDF / format lain — diunggah apa adanya" : "…"}</div>}
                </div>
                <div style={{ fontSize: 11, color: "#8b949e", margin: "6px 0", wordBreak: "break-all" }}>{x.asli.name}{ukuran ? ` · ${kb(ukuran)}` : ""}</div>
                {x.foto && x.proses && !c && <div style={{ fontSize: 11.5, color: "#f0a742" }}>Memindai…</div>}
                {c && c.gagal && <div style={{ fontSize: 11.5, color: "#f0a742" }}>Scan tidak berhasil — pakai foto asli.</div>}
                {c && c.file && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => pilih(i, "scan")} style={btn(x.pakai === "scan")} data-testid={`scan-pakai-scan-${i}`}>Hasil scan</button>
                    <button onClick={() => pilih(i, "asli")} style={btn(x.pakai === "asli")} data-testid={`scan-pakai-asli-${i}`}>Foto asli</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={btn(false)}>Batal</button>
          <button onClick={simpan} disabled={sibuk && auto} data-testid="scan-simpan"
            style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid #2ea043", background: sibuk && auto ? "#11161f" : "#0d2a17", color: sibuk && auto ? "#4b5563" : "#3fb950", fontWeight: 800, fontSize: 12.5, cursor: sibuk && auto ? "default" : "pointer" }}>
            ✅ Simpan {item.length} dokumen
          </button>
        </div>
      </div>
    </div>
  );
}
