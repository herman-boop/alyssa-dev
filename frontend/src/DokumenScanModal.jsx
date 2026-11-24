/* Pratinjau scan dokumen sebelum diunggah (seperti aplikasi pemindai di HP):
   foto dipotong otomatis, diluruskan A4/F4, dibersihkan & dipertajam; admin lihat hasilnya, boleh pakai foto asli, lalu Simpan. */
import { useEffect, useRef, useState } from "react";
import { scanDokumen } from "./docScan";

const LS = "alyssa_scan_dokumen_otomatis";
const bacaPref = () => { try { return localStorage.getItem(LS) !== "0"; } catch (e) { return true; } };
const simpanPref = (v) => { try { localStorage.setItem(LS, v ? "1" : "0"); } catch (e) { /* abaikan */ } };
const adalahFoto = (f) => /^image\//.test(f.type || "") && !/heic|heif/i.test(f.type || "");
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

export default function DokumenScanModal({ files, onSave, onClose }) {
  const [auto, setAuto] = useState(bacaPref);
  const [item, setItem] = useState(() => files.map((f) => ({ asli: f, scan: null, pakai: "asli", urlAsli: adalahFoto(f) ? URL.createObjectURL(f) : "", urlScan: "", status: adalahFoto(f) ? "antri" : "tanpa" })));
  const [selesai, setSelesai] = useState(false);
  const batal = useRef(false);

  // Pindai berurutan (hemat memori HP). Hasil per foto muncul begitu siap.
  useEffect(() => {
    batal.current = false;
    (async () => {
      for (let i = 0; i < files.length; i++) {
        if (batal.current) return;
        if (!adalahFoto(files[i])) continue;
        setItem((a) => a.map((x, k) => (k === i ? { ...x, status: "proses" } : x)));
        const hasil = await scanDokumen(files[i]);
        if (batal.current) return;
        const ok = hasil && hasil !== files[i];
        const url = ok ? URL.createObjectURL(hasil) : "";
        setItem((a) => a.map((x, k) => (k === i ? { ...x, scan: ok ? hasil : null, urlScan: url, status: ok ? "siap" : "gagal", pakai: ok && bacaPref() ? "scan" : "asli" } : x)));
      }
      setSelesai(true);
    })();
    return () => { batal.current = true; };
  }, []);   // eslint-disable-line
  useEffect(() => () => { item.forEach((x) => { if (x.urlAsli) URL.revokeObjectURL(x.urlAsli); if (x.urlScan) URL.revokeObjectURL(x.urlScan); }); }, []);   // eslint-disable-line

  const ubahAuto = (v) => {
    setAuto(v); simpanPref(v);
    setItem((a) => a.map((x) => (x.scan ? { ...x, pakai: v ? "scan" : "asli" } : x)));
  };
  const pilih = (i, p) => setItem((a) => a.map((x, k) => (k === i ? { ...x, pakai: p } : x)));
  const sibuk = item.some((x) => x.status === "antri" || x.status === "proses");
  const simpan = () => onSave(item.map((x) => (x.pakai === "scan" && x.scan ? x.scan : x.asli)));

  const btn = (aktif) => ({ padding: "6px 10px", borderRadius: 8, border: `1px solid ${aktif ? "#1f6feb" : "#2a3344"}`, background: aktif ? "#0b1d3a" : "#0d1117", color: aktif ? "#58a6ff" : "#8b949e", fontWeight: 700, fontSize: 12, cursor: "pointer" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 10 }} onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div onClick={(e) => e.stopPropagation()} data-testid="scan-modal" style={{ background: "#0d1117", border: "1px solid #2a3344", borderRadius: 12, padding: 14, width: "100%", maxWidth: 760, maxHeight: "94vh", overflowY: "auto", color: "#e6edf3" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>📄 Scan Dokumen</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0", fontSize: 12.5 }}>
          <input type="checkbox" checked={auto} onChange={(e) => ubahAuto(e.target.checked)} data-testid="scan-auto" />
          <span><b>Scan otomatis</b> (potong, luruskan A4, bersihkan bayangan, pertajam)</span>
        </label>
        {sibuk && <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 8 }} data-testid="scan-proses">⏳ Memindai {item.filter((x) => x.status === "siap" || x.status === "gagal").length + 1} / {item.filter((x) => x.status !== "tanpa").length}…</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
          {item.map((x, i) => {
            const url = x.pakai === "scan" && x.urlScan ? x.urlScan : x.urlAsli;
            return (
              <div key={i} data-testid={`scan-item-${i}`} style={{ border: "1px solid #1a2130", borderRadius: 10, padding: 8, background: "#0a0e16" }}>
                <div style={{ height: 260, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", borderRadius: 6, overflow: "hidden" }}>
                  {url ? <img src={url} alt="" title="Ketuk untuk lihat ukuran penuh" onClick={() => window.open(url, "_blank")} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", cursor: "zoom-in" }} data-testid={`scan-img-${i}`} />
                    : <div style={{ color: "#444", fontSize: 12, padding: 10, textAlign: "center" }}>{x.status === "tanpa" ? "PDF / format lain — diunggah apa adanya" : "…"}</div>}
                </div>
                <div style={{ fontSize: 11, color: "#8b949e", margin: "6px 0", wordBreak: "break-all" }}>{x.asli.name} · {kb((x.pakai === "scan" && x.scan ? x.scan : x.asli).size)}</div>
                {x.status === "proses" && <div style={{ fontSize: 11.5, color: "#f0a742" }}>Memindai…</div>}
                {x.status === "gagal" && <div style={{ fontSize: 11.5, color: "#f0a742" }}>Scan tidak berhasil — pakai foto asli.</div>}
                {x.scan && (
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
          <button onClick={simpan} disabled={sibuk} data-testid="scan-simpan"
            style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid #2ea043", background: sibuk ? "#11161f" : "#0d2a17", color: sibuk ? "#4b5563" : "#3fb950", fontWeight: 800, fontSize: 12.5, cursor: sibuk ? "default" : "pointer" }}>
            ✅ Simpan {item.length} dokumen
          </button>
        </div>
      </div>
    </div>
  );
}
