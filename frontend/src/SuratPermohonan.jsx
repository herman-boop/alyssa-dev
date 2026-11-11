/*
  Surat Permohonan Pembayaran — dibuat dari data INVOICE di Histori Dokumen.
  Format mengikuti surat contoh perusahaan: kop, Perihal, "Kepada Yth. Bagian Keuangan <pelanggan>",
  rincian, TOTAL PERMOHONAN TRANSFER + terbilang, rekening resmi, penutup, TTD + stempel + materai.
  Hanya presentasi + arsip: tidak mengubah invoice, pembayaran, atau angka apa pun.
  Fungsi murni (buildSuratHtml / suratDefaults) dipisah dari komponen supaya mudah diuji.
*/
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { DOC_BRAND, DOC_BASE_CSS, getEntity, terbilangRupiah, nextDocNo } from "./docTheme";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const LS_KEY = "aal_surat_permohonan_v1";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const fmtTanggal = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]} ${BULAN[Number(m[2]) - 1] || m[2]} ${m[1]}` : "";
};
const fmtRp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const huruf = (s) => { const t = String(s || "").toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const bersih = (s) => String(s || "").replace(/\s*·?\s*Rangka:[^·]*/gi, "").replace(/\s+/g, " ").trim();   // rangka tidak perlu di surat

/* Baris rincian dari invoice: [[label, teks], ...]. Satu baris invoice → bentuk kunci/nilai seperti surat contoh. */
export function rincianRows(rec) {
  const lines = (Array.isArray(rec && rec.lines) ? rec.lines : []).filter((l) => (Number(l.harga) || 0) > 0);
  const m = (rec && rec.meta) || {};
  const qtyTotal = lines.reduce((s, l) => s + (Number(l.qty) || 1), 0);
  const rows = [];
  const rute = m.asal_kota && m.tujuan_kota ? `${m.asal_kota} - ${m.tujuan_kota}` : "";
  if (lines.length <= 1) {
    const l = lines[0] || {};
    if (rute || l.ket) rows.push(["Rute Pengiriman", rute || bersih(l.ket)]);
    if (l.nama) rows.push(["Jenis Kendaraan", l.nama]);
    if (m.moda) rows.push(["Moda Pengiriman", m.moda]);
    if (lines.length) rows.push(["Jumlah Kendaraan", `${qtyTotal} Unit`]);
  } else {
    const daftar = lines.map((l) => `${esc(l.nama || "Jasa Pengiriman")}${bersih(l.ket) ? ` — ${esc(bersih(l.ket))}` : ""} (${Number(l.qty) || 1} unit)`);
    rows.push(["Rincian Pengiriman", { html: daftar.map((x) => `<div class="li">• ${x}</div>`).join("") }]);
    if (m.moda) rows.push(["Moda Pengiriman", m.moda]);
    rows.push(["Jumlah Kendaraan", `${qtyTotal} Unit`]);
  }
  return rows;
}

/* Nilai bawaan form dari record invoice + ringkasan pembayaran ({total, diterima, sisa}). */
export function suratDefaults(rec, pay, saved) {
  const s = saved || {};
  const ent = getEntity((rec && rec.meta && rec.meta.entity_id) || undefined);
  const isPT = ent.id === "pt-alyssa";
  const sisa = pay && pay.sisa > 0 ? pay.sisa : (pay ? pay.total : 0);
  return {
    kota: s.kota || "Cilegon",
    tanggal: new Date().toISOString().slice(0, 10),
    perihal: "Permohonan Transfer Pembayaran",
    kepada: (rec && (rec.customer || (rec.meta && rec.meta.customer_nama))) || "",
    nominal: Math.max(0, Math.round(sisa || 0)),
    bankNama: isPT ? DOC_BRAND.bank.name : (s.bankNama || ""),
    bankNorek: isPT ? DOC_BRAND.bank.norek : (s.bankNorek || ""),
    bankAn: isPT ? DOC_BRAND.bank.an : (s.bankAn || ""),
    bankCabang: isPT ? DOC_BRAND.bank.cabang : (s.bankCabang || ""),
    ttdNama: s.ttdNama || "Hermansyah",
    pakaiStempel: true,
  };
}

/* HTML surat A4 lengkap. `o` = { rec, pay, kota, tanggal, perihal, kepada, nominal, bank*, ttdNama, stempel(dataURL|null), noSurat, preview } */
export function buildSuratHtml(o) {
  const rec = o.rec || {};
  const m = rec.meta || {};
  const ent = getEntity(m.entity_id || undefined);
  const tglInv = fmtTanggal(m.tanggalInvoice || (rec.created_at || "").slice(0, 10));
  const noInv = rec.no_dokumen || m.no_invoice || "";
  const pay = o.pay || null;
  const rows = rincianRows(rec);
  const rowsInv = [["Nomor Invoice", noInv]];
  if (tglInv) rowsInv.push(["Tanggal Invoice", tglInv]);
  const rowsAmt = [];
  if (pay && pay.diterima > 0) {
    rowsAmt.push(["Nilai Invoice", fmtRp(pay.total)]);
    rowsAmt.push(["Sudah Diterima", fmtRp(pay.diterima)]);
  }
  const kv = (arr) => arr.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${v && v.html ? v.html : esc(v)}</td></tr>`).join("");
  const nominal = Math.max(0, Math.round(Number(o.nominal) || 0));
  const bankOk = o.bankNorek || o.bankNama;
  const stempel = o.stempel || null;
  const tglSurat = fmtTanggal(o.tanggal);
  const ttd = `
    <div class="ttd">
      <div>Hormat kami,</div>
      <div class="pt">${esc(ent.name.replace(/\./g, ".").toUpperCase())}</div>
      <div class="sig">${stempel
        ? `<img src="${esc(stempel)}" alt="TTD, stempel, dan materai" />`
        : `<div class="meterai">Meterai<br/>(bila perlu)</div>`}</div>
      <div class="nm">( ${esc(o.ttdNama || "")} )</div>
    </div>`;
  const pv = o.preview
    ? `<div class="pv-bar"><span>Pratinjau surat — belum tersimpan di Histori Dokumen</span><button onclick="window.print()">🖨️ Cetak / Simpan PDF</button></div>` : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(o.perihal || "Surat Permohonan Pembayaran")} ${esc(noInv)}</title>
<style>
${DOC_BASE_CSS}
@page { size: A4 portrait; margin: 12mm 16mm; }
body { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 12px; color:#000; line-height:1.45; }
.doc-sheet { padding:0; max-width:178mm; margin:0 auto; }
.kop { display:flex; align-items:center; gap:14px; padding:0 0 8px; border-bottom:2.5px solid ${DOC_BRAND.gold}; margin-bottom:14px; }
.kop img { width:54px; height:54px; object-fit:contain; }
.kop .n { font-size:22px; font-weight:900; color:${DOC_BRAND.navy}; letter-spacing:.2px; line-height:1.1; }
.kop .t { font-size:12px; font-weight:700; color:${DOC_BRAND.gold}; margin-top:2px; }
.tgl { text-align:right; margin-bottom:12px; }
.hal b { font-weight:800; }
.kpd { margin:10px 0 14px; }
p { margin:0 0 8px; text-align:justify; }
table.kv { border-collapse:collapse; margin:6px 0 12px; width:100%; }
table.kv td { padding:3px 0; vertical-align:top; font-size:12px; }
table.kv td.k { width:36%; color:#444; }
table.kv td.v { font-weight:600; }
table.kv .li { font-weight:600; margin-bottom:2px; }
.total { display:flex; align-items:baseline; gap:18px; margin:14px 0 2px; font-weight:800; }
.total .l { color:${DOC_BRAND.navy}; font-size:13px; letter-spacing:.2px; }
.total .a { color:${DOC_BRAND.navy}; font-size:19px; }
.terb { font-style:italic; font-size:11.5px; margin-bottom:14px; }
.bank { margin:6px 0 12px; }
.bank .bn { color:${DOC_BRAND.navy}; font-weight:800; font-size:13px; margin-bottom:3px; }
.bank table td { padding:1px 0; } .bank td.k { width:110px; }
.bank td.v { font-weight:700; }
.ttd { margin-top:12px; margin-left:auto; width:240px; break-inside:avoid; page-break-inside:avoid; }
.ttd .pt { font-weight:800; margin-top:2px; }
.ttd .sig { height:84px; position:relative; display:flex; align-items:center; }
.ttd .sig img { max-height:96px; max-width:240px; object-fit:contain; }
.ttd .meterai { border:1px dashed #888; color:#777; font-size:10px; width:64px; height:52px; display:flex; align-items:center; justify-content:center; text-align:center; line-height:1.2; margin-left:6px; }
.ttd .nm { font-weight:800; }
.foot { margin-top:16px; padding-top:6px; border-top:1.5px solid ${DOC_BRAND.gold}; font-size:9.5px; color:#444; display:flex; justify-content:space-between; }
.warn { color:#b00020; font-weight:700; }
.pv-bar { position:sticky; top:0; z-index:5; display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 14px; background:#0F2A5C; color:#fff; font:600 13px Arial,sans-serif; }
.pv-bar button { font:inherit; font-weight:800; padding:7px 14px; border:none; border-radius:8px; background:#fff; color:#0F2A5C; cursor:pointer; }
@media print { .pv-bar { display:none; } }
</style></head><body>${pv}
<div class="doc-sheet">
  <div class="kop"><img src="${esc(ent.logo || "/logo.png")}" alt="Logo"/><div><div class="n">${esc(ent.name)}</div><div class="t">${esc(ent.tagline || DOC_BRAND.tagline)}</div></div></div>
  <div class="tgl">${esc(o.kota || "")}, ${esc(tglSurat)}</div>
  <div class="hal"><b>Perihal</b> : ${esc(o.perihal || "Permohonan Transfer Pembayaran")}</div>
  <div class="kpd"><b>Kepada Yth.</b><br/><b>Bagian Keuangan ${esc(o.kepada || "")}</b><br/>di Tempat</div>
  <p>Dengan hormat,</p>
  <p>Sehubungan dengan jasa pengiriman kendaraan yang kami laksanakan, bersama ini kami mengajukan permohonan transfer pembayaran berdasarkan Invoice No. ${esc(noInv)}${tglInv ? ` tanggal ${esc(tglInv)}` : ""}, dengan rincian sebagai berikut:</p>
  <table class="kv">${kv(rowsInv)}${kv(rows)}${kv(rowsAmt)}</table>
  <div class="total"><span class="l">TOTAL PERMOHONAN TRANSFER</span><span class="a">${fmtRp(nominal)}</span></div>
  <div class="terb">Terbilang: ${esc(huruf(terbilangRupiah(nominal)))}.</div>
  <p>Pembayaran dapat ditransfer melalui rekening resmi perusahaan berikut:</p>
  <div class="bank">${bankOk ? `
    <div class="bn">BANK ${esc(String(o.bankNama || "").toUpperCase())}</div>
    <table><tr><td class="k">No. Rekening</td><td class="v">: ${esc(o.bankNorek)}</td></tr>
    <tr><td class="k">Atas Nama</td><td class="v">: ${esc(o.bankAn)}</td></tr>
    ${o.bankCabang ? `<tr><td class="k">Cabang</td><td>: ${esc(o.bankCabang)}</td></tr>` : ""}</table>` : `<div class="warn">Rekening belum diisi.</div>`}</div>
  <p>Mohon agar bukti transfer dapat disampaikan setelah pembayaran dilakukan untuk keperluan konfirmasi dan administrasi kami.</p>
  <p>Demikian surat permohonan ini kami sampaikan. Atas perhatian dan kerja sama Bapak/Ibu, kami mengucapkan terima kasih.</p>
  ${ttd}
  <div class="foot"><span><b>${esc(ent.footerName || ent.name)}</b> &nbsp;|&nbsp; ${esc(ent.tagline || DOC_BRAND.tagline)}</span><span>${esc(o.noSurat || "")}</span></div>
</div>
${o.preview ? "" : `<script>window.onload=function(){ Promise.race([ (document.fonts && document.fonts.ready) || Promise.resolve(), new Promise(function(r){ setTimeout(r, 1200); }) ]).then(function(){ window.print(); }); }<\/script>`}
</body></html>`;
}

function bukaJendela(html) {
  const w = window.open("", "aal_print");
  if (w) { w.document.write(html); w.document.close(); }
  return !!w;
}

/* Cetak ulang dari Histori Dokumen (nomor & isi tersimpan sama; tidak mengarsipkan lagi). */
export function cetakUlangSurat(rec, stempelBawaan) {
  const m = rec.meta || {};
  const inv = m.invoice_rec || {};
  const html = buildSuratHtml({
    rec: { ...inv, no_dokumen: m.invoice_no || inv.no_dokumen, customer: rec.customer, meta: { ...(inv.meta || {}), entity_id: m.entity_id } },
    pay: m.pay || null, kota: m.kota, tanggal: m.tanggal, perihal: m.perihal, kepada: m.kepada || rec.customer,
    nominal: m.nominal, bankNama: m.bankNama, bankNorek: m.bankNorek, bankAn: m.bankAn, bankCabang: m.bankCabang,
    ttdNama: m.ttdNama, stempel: m.tanpaStempel ? null : stempelBawaan, noSurat: rec.no_dokumen,
  });
  return bukaJendela(html);
}

export default function SuratPermohonanModal({ rec, pay, headers, stempelBawaan, onClose, onSaved }) {
  const saved = useMemo(() => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } }, []);
  const [f, setF] = useState(() => suratDefaults(rec, pay, saved));
  const [busy, setBusy] = useState(false);
  const stempelRec = (rec.meta && rec.meta.stempel) || null;
  const stempel = f.pakaiStempel ? (stempelRec || stempelBawaan || null) : null;
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "number" ? Number(e.target.value) : e.target.value }));
  const dasar = () => ({ rec, pay, ...f, stempel });
  const lbl = { display: "block", fontSize: 12, fontWeight: 700, margin: "10px 0 4px", color: "var(--muted, #8b949e)" };
  const cekForm = () => {
    if (!f.kepada.trim()) return "Nama pelanggan (Kepada) wajib diisi";
    if (!(f.nominal > 0)) return "Nominal permohonan harus lebih dari 0";
    if (!f.bankNorek.trim()) return "Nomor rekening wajib diisi";
    if (!f.tanggal) return "Tanggal surat wajib diisi";
    return "";
  };
  const preview = () => { const e = cekForm(); if (e) { alert(e); return; } bukaJendela(buildSuratHtml({ ...dasar(), preview: true })); };
  const cetak = async () => {
    const e = cekForm(); if (e) { alert(e); return; }
    setBusy(true);
    const w = window.open("", "aal_print");          // buka dulu (gesture) supaya tidak diblok popup
    try {
      const noSurat = await nextDocNo("spp", "SPP");
      const html = buildSuratHtml({ ...dasar(), noSurat });
      if (w) { w.document.write(html); w.document.close(); }
      try { localStorage.setItem(LS_KEY, JSON.stringify({ kota: f.kota, ttdNama: f.ttdNama, bankNama: f.bankNama, bankNorek: f.bankNorek, bankAn: f.bankAn, bankCabang: f.bankCabang })); } catch {}
      const invMeta = { ...(rec.meta || {}) }; delete invMeta.stempel;
      await axios.post(`${API}/admin/doc-history`, {
        jenis: "permohonan_bayar", no_dokumen: noSurat, customer: f.kepada,
        judul: `${f.kepada} · ${fmtRp(f.nominal)} · Inv ${rec.no_dokumen || ""}`,
        meta: {
          invoice_no: rec.no_dokumen, invoice_id: rec.id, entity_id: (rec.meta && rec.meta.entity_id) || undefined,
          kota: f.kota, tanggal: f.tanggal, perihal: f.perihal, kepada: f.kepada, nominal: f.nominal,
          bankNama: f.bankNama, bankNorek: f.bankNorek, bankAn: f.bankAn, bankCabang: f.bankCabang, ttdNama: f.ttdNama,
          tanpaStempel: !stempel, pay: pay || null,
          invoice_rec: { no_dokumen: rec.no_dokumen, lines: rec.lines || [], meta: invMeta },
        },
        order_ids: rec.order_ids || [],
      }, { headers });
      if (onSaved) onSaved(noSurat);
      onClose();
    } catch (err) {
      alert("Surat sudah terbuka untuk dicetak, tetapi gagal tersimpan di Histori Dokumen. Coba lagi bila perlu.");
    } finally { setBusy(false); }
  };

  return createPortal((
    <div className="adm-vars">
      <div className="adm-modal-bg" onClick={onClose} data-testid="surat-modal">
        <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
          <div className="adm-modal-head">
            <div>
              <div className="adm-modal-title">📄 Surat Permohonan Pembayaran</div>
              <div className="adm-modal-sub">Dari invoice {rec.no_dokumen} · {rec.customer || ""}</div>
            </div>
            <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
          </div>
          <div className="adm-modal-body">
            <label style={lbl}>Kepada Yth. (Bagian Keuangan …)</label>
            <input className="adm-input" value={f.kepada} onChange={set("kepada")} data-testid="surat-kepada" />
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>Kota</label><input className="adm-input" value={f.kota} onChange={set("kota")} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Tanggal surat</label><input type="date" className="adm-input" value={f.tanggal} onChange={set("tanggal")} /></div>
            </div>
            <label style={lbl}>Perihal</label>
            <input className="adm-input" value={f.perihal} onChange={set("perihal")} />
            <label style={lbl}>Total permohonan transfer (Rp)</label>
            <input type="number" className="adm-input" value={f.nominal} onChange={set("nominal")} data-testid="surat-nominal" />
            {pay ? (
              <div style={{ fontSize: 11.5, color: "var(--muted, #8b949e)", marginTop: 4 }}>
                Invoice {fmtRp(pay.total)}{pay.diterima > 0 ? ` · sudah diterima ${fmtRp(pay.diterima)} · sisa ${fmtRp(pay.sisa)}` : " · belum ada pembayaran"}. Bawaan = sisa tagihan; boleh diubah (mis. DP).
              </div>
            ) : null}
            <label style={lbl}>Rekening tujuan</label>
            <div style={{ display: "flex", gap: 10 }}>
              <input className="adm-input" style={{ flex: 1 }} placeholder="Bank (BCA)" value={f.bankNama} onChange={set("bankNama")} />
              <input className="adm-input" style={{ flex: 2 }} placeholder="No. rekening" value={f.bankNorek} onChange={set("bankNorek")} data-testid="surat-norek" />
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <input className="adm-input" style={{ flex: 2 }} placeholder="Atas nama" value={f.bankAn} onChange={set("bankAn")} />
              <input className="adm-input" style={{ flex: 1 }} placeholder="Cabang" value={f.bankCabang} onChange={set("bankCabang")} />
            </div>
            <label style={lbl}>Penandatangan</label>
            <input className="adm-input" value={f.ttdNama} onChange={set("ttdNama")} />
            <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" checked={f.pakaiStempel} onChange={(e) => setF((p) => ({ ...p, pakaiStempel: e.target.checked }))} data-testid="surat-stempel" />
              Pakai gambar TTD + stempel + materai {stempelRec || stempelBawaan ? "(tersedia)" : "(belum ada — pasang lewat 🖋️ TTD di faktur)"}
            </label>
            <div style={{ fontSize: 11.5, color: "var(--muted, #8b949e)", marginTop: 4 }}>
              Kosongkan centang untuk cetak polos (stempel dan materai basah ditempel manual).
            </div>
          </div>
          <div className="adm-modal-foot">
            <button className="adm-btn adm-btn-ghost" disabled={busy} onClick={preview} data-testid="surat-preview">👁️ Pratinjau</button>
            <button className="adm-btn adm-btn-gold" disabled={busy} onClick={cetak} data-testid="surat-cetak">{busy ? "Menyiapkan…" : "🖨️ Cetak & Simpan"}</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
