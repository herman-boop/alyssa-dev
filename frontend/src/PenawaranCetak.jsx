/* eslint-disable */
// Komponen bersama: tombol + modal "Cetak Penawaran Resmi (A4)".
// Dipakai di halaman customer (CustomerPricePage) DAN halaman admin Kalkulator
// (CostCalculator). Bisa centang rute (pisahin per wilayah, mis. Kalimantan),
// isi nama + jabatan + stempel. Output A4 gaya invoice, huruf besar.
import { useState } from "react";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";

function fRp(n) {
  if (!n && n !== 0) return "-";
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";
const gold = "#b8860b";

export function printPenawaran(rows, meta) {
  const { nama_pt, ttdNama, ttdJabatan, stempel } = meta || {};
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtTgl = (iso) => (iso ? new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" }) : "-");
  const now = new Date();
  const noDoc = `PH/AAL/${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(2)}/${now.getFullYear()}`;
  const body = (rows || []).map((e, i) => {
    const sudah = e.asuransi && e.asuransi > 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${fmtTgl(e.tanggal)}</td>
      <td><b>${esc(e.rute || "-")}</b>${e.catatan ? `<div class="ph-note">${esc(e.catatan)}</div>` : ""}</td>
      <td>${esc(e.moda || "-")}</td>
      <td>${esc(e.tipe_kendaraan || "-")}</td>
      <td class="r"><b>${fRp(e.harga_deal)}</b></td>
      <td class="c"><span class="ph-ins ${sudah ? "y" : "n"}">${sudah ? "Termasuk" : "Belum"}</span></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 12px; }
    .ph-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:16px; }
    .ph-billto .lbl { font-size:10px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .ph-billto .val { font-size:16px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-meta-table { border-collapse:collapse; font-size:11.5px; }
    .ph-meta-table td { padding:3px 0; }
    .ph-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .ph-meta-table td:last-child { font-weight:700; text-align:right; }
    table.ph { width:100%; border-collapse:collapse; margin-bottom:16px; }
    table.ph thead { display:table-header-group; }
    table.ph tr { break-inside:avoid; page-break-inside:avoid; }
    table.ph th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px; color:#fff; background:${DOC_BRAND.navy}; font-weight:700; padding:9px 9px; }
    table.ph th.r { text-align:right; } table.ph th.c { text-align:center; }
    table.ph td { padding:11px 9px; font-size:12.5px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.ph tbody tr:nth-child(even) td { background:${DOC_BRAND.paperMist}; }
    table.ph td.c { text-align:center; } table.ph td.r { text-align:right; }
    table.ph .ph-note { font-size:10.5px; color:${DOC_BRAND.muted}; font-style:italic; margin-top:3px; font-weight:400; }
    .ph-ins { display:inline-block; font-size:10px; font-weight:800; border-radius:12px; padding:3px 9px; white-space:nowrap; }
    .ph-ins.y { background:#d1fae5; color:#065f46; } .ph-ins.n { background:#fef2f2; color:#991b1b; }
    .ph-pay-box { display:flex; align-items:center; gap:14px; padding:14px 18px; background:${DOC_BRAND.paperMist}; border-radius:8px; margin-bottom:14px; }
    .ph-pay-badge { width:46px; height:46px; border-radius:8px; background:#0054a6; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:13px; flex-shrink:0; }
    .ph-pay-num { font-size:17px; font-weight:900; letter-spacing:1px; color:${DOC_BRAND.ink}; }
    .ph-pay-name { font-size:11px; color:${DOC_BRAND.muted}; margin-top:2px; }
    .ph-valid { font-size:11px; color:${DOC_BRAND.muted}; line-height:1.7; margin-bottom:8px; }
    .ph-valid b { color:${DOC_BRAND.ink}; }
    .ph-sign-row { display:flex; justify-content:flex-end; margin-top:30px; }
    .ph-sign-cell { width:280px; text-align:center; }
    .ph-sign-lbl { font-size:11px; color:${DOC_BRAND.muted}; margin-bottom:6px; }
    .ph-sign-stamp { height:86px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
    .ph-sign-stamp img { max-height:86px; max-width:220px; object-fit:contain; }
    .ph-sign-stamp.empty { height:60px; }
    .ph-sign-pt { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; }
    .ph-sign-name { font-size:12.5px; font-weight:800; color:${DOC_BRAND.ink}; margin-top:2px; }
    .ph-sign-jab { font-size:10.5px; color:${DOC_BRAND.muted}; margin-top:2px; }
    @page { size:A4; margin:12mm; }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "PENAWARAN HARGA" })}
    <div class="ph-meta-row">
      <div class="ph-billto">
        <div class="lbl">Kepada Yth.</div>
        <div class="val">${esc(nama_pt || "&nbsp;")}</div>
      </div>
      <table class="ph-meta-table">
        <tr><td>No. Penawaran</td><td>${noDoc}</td></tr>
        <tr><td>Tanggal</td><td>${fmtTgl(now.toISOString())}</td></tr>
        <tr><td>Berlaku</td><td>7 hari sejak tanggal</td></tr>
      </table>
    </div>
    <table class="ph">
      <thead><tr>
        <th class="c" style="width:26px">No</th><th style="width:92px">Tanggal</th><th>Rute</th>
        <th>Moda</th><th>Tipe Kendaraan</th><th class="r">Harga</th><th class="c">Asuransi</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="ph-pay-box">
      <div class="ph-pay-badge">${DOC_BRAND.bank.name}</div>
      <div>
        <div class="ph-pay-num">${DOC_BRAND.bank.norek}</div>
        <div class="ph-pay-name">Cabang ${DOC_BRAND.bank.cabang} &middot; a.n. ${DOC_BRAND.bank.an}</div>
      </div>
    </div>
    <div class="ph-valid">
      <b>Catatan:</b> Harga di atas berlaku 7 (tujuh) hari sejak tanggal penawaran &amp; dapat berubah sewaktu-waktu mengikuti kondisi operasional. Untuk konfirmasi hubungi <b>0818 631 135</b>.
    </div>
    <div class="ph-sign-row">
      <div class="ph-sign-cell">
        <div class="ph-sign-lbl">Hormat Kami,</div>
        <div class="ph-sign-stamp ${stempel ? "" : "empty"}">${stempel ? `<img src="${stempel}" alt="stempel">` : ""}</div>
        <div class="ph-sign-pt">PT. Alyssa Auto Logistik</div>
        ${ttdNama ? `<div class="ph-sign-name">( ${esc(ttdNama)} )</div>` : ""}
        ${ttdJabatan ? `<div class="ph-sign-jab">${esc(ttdJabatan)}</div>` : ""}
      </div>
    </div>
    ${docFooter({ docNo: `Penawaran ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
}

// Tombol + modal. `rows` = daftar entri harga (rute, moda, tipe_kendaraan,
// harga_deal, asuransi, catatan, tanggal). `namaPt` = nama pelanggan.
export function PenawaranCetakButton({ rows, namaPt, style }) {
  const [open, setOpen] = useState(false);
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("");
  const [stempel, setStempel] = useState("");
  const [selIdx, setSelIdx] = useState(() => new Set());
  const [cari, setCari] = useState("");

  const list = rows || [];
  const openModal = () => { setSelIdx(new Set(list.map((_, i) => i))); setCari(""); setOpen(true); };
  const match = (e) => {
    const q = cari.trim().toLowerCase();
    if (!q) return true;
    return `${e.rute || ""} ${e.moda || ""} ${e.tipe_kendaraan || ""} ${e.catatan || ""}`.toLowerCase().includes(q);
  };

  return (
    <>
      <button onClick={openModal}
        style={{ padding: "5px 12px", borderRadius: 7, border: `1px solid ${gold}`, background: "#fffbeb", color: "#92610b", fontSize: 11, fontWeight: 800, cursor: "pointer", ...style }}>
        🖨️ Cetak Penawaran Resmi
      </button>

      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 22, boxShadow: "0 20px 60px rgba(0,0,0,0.4)", fontFamily: "'Segoe UI',Arial,sans-serif" }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: navy, marginBottom: 3 }}>Cetak Penawaran Resmi</div>
            <div style={{ fontSize: 11.5, color: gray, marginBottom: 16 }}>Centang rute yang mau dicetak (mis. pisahin yang Kalimantan), isi penanda tangan &amp; stempel. Format A4, huruf besar — tajam buat di-screenshot / print.</div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: gray }}>PILIH RUTE — {selIdx.size} dari {list.length} dipilih</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setSelIdx(new Set(list.map((_, i) => i)))}
                  style={{ fontSize: 10.5, fontWeight: 700, color: navy, background: "#eff6ff", border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Semua</button>
                <button onClick={() => setSelIdx(new Set())}
                  style={{ fontSize: 10.5, fontWeight: 700, color: gray, background: "#f9fafb", border: `1px solid ${border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>Kosongkan</button>
              </div>
            </div>

            <input value={cari} onChange={(e) => setCari(e.target.value)} placeholder="🔎 cari rute… (mis. kalimantan)"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 12.5, marginBottom: 6 }} />
            {cari.trim() && (
              <button onClick={() => setSelIdx(new Set(list.map((e, i) => (match(e) ? i : -1)).filter((i) => i >= 0)))}
                style={{ fontSize: 11, fontWeight: 700, color: "#92610b", background: "#fffbeb", border: `1px solid ${gold}`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", marginBottom: 8 }}>
                ✓ Centang cuma yang cocok "{cari.trim()}"
              </button>
            )}

            <div style={{ maxHeight: 200, overflowY: "auto", border: `1px solid ${border}`, borderRadius: 8, marginBottom: 16 }}>
              {list.map((e, i) => ({ e, i })).filter(({ e }) => match(e)).map(({ e, i }) => {
                const on = selIdx.has(i);
                return (
                  <label key={i}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: on ? "#f0fdf4" : "#fff" }}>
                    <input type="checkbox" checked={on}
                      onChange={() => setSelIdx((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                      style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "#1f2937", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.rute || "-"}</div>
                      <div style={{ fontSize: 10.5, color: gray }}>{e.tipe_kendaraan || "-"} · {fRp(e.harga_deal)}</div>
                    </div>
                  </label>
                );
              })}
              {list.length === 0 && <div style={{ padding: 14, textAlign: "center", color: gray, fontSize: 12 }}>Belum ada rute</div>}
            </div>

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>NAMA PENANDA TANGAN</label>
            <input value={ttdNama} onChange={(e) => setTtdNama(e.target.value)} placeholder="mis. Alyssa Herman"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>JABATAN</label>
            <input value={ttdJabatan} onChange={(e) => setTtdJabatan(e.target.value)} placeholder="mis. Direktur Utama"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `1px solid ${border}`, fontSize: 13, marginBottom: 12 }} />

            <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: gray, marginBottom: 4 }}>STEMPEL DIGITAL (opsional)</label>
            <input type="file" accept="image/*"
              onChange={(e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const r = new FileReader();
                r.onload = () => setStempel(r.result);
                r.readAsDataURL(f);
              }}
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12, marginBottom: stempel ? 8 : 16 }} />
            {stempel && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <img src={stempel} alt="stempel" style={{ height: 48, maxWidth: 120, objectFit: "contain", border: `1px solid ${border}`, borderRadius: 6, padding: 3 }} />
                <button onClick={() => setStempel("")} style={{ fontSize: 11, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>Hapus</button>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setOpen(false)}
                style={{ padding: "9px 16px", borderRadius: 8, border: `1px solid ${border}`, background: "#fff", color: gray, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>Batal</button>
              <button onClick={() => {
                const sel = list.filter((_, i) => selIdx.has(i));
                if (!sel.length) { alert("Centang minimal 1 rute dulu bro."); return; }
                printPenawaran(sel, { nama_pt: namaPt, ttdNama, ttdJabatan, stempel });
                setOpen(false);
              }}
                style={{ padding: "9px 18px", borderRadius: 8, border: "none", background: gold, color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>🖨️ Cetak A4 ({selIdx.size})</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
