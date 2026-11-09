import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";

/* Enterprise Finance — Rekap Supplier, Riwayat Pembayaran, Detail Alokasi.
   Tema terang yang TERISOLASI (semua gaya di bawah .sf-root); tema aplikasi lain tidak berubah.
   Semua angka berasal dari GET /admin/suppliers/{id}/finance (susunan ulang data yang sudah ada). */
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const rp = (n) => {
  const v = Math.round(Number(n) || 0);
  const s = "Rp " + Math.abs(v).toLocaleString("id-ID");
  return v < 0 ? `(${s})` : s;
};
const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); return m ? `${m[3]} ${BLN[+m[2] - 1]} ${m[1]}` : "-"; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dtWaktu = (s) => { try { const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`); return `${String(d.getDate()).padStart(2, "0")} ${BLN[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; } catch { return String(s || ""); } };
const split = (no) => { const i = String(no).indexOf("/"); return i < 0 ? [no, ""] : [no.slice(0, i), no.slice(i + 1)]; };

const INV_ST = { lunas: ["Lunas", "ok"], sebagian: ["Sebagian", "navy"], belum: ["Belum dibayar", "gray"], selisih: ["Selisih", "red"], draft: ["Draft", "gray"] };
const VER = {
  belum_diverifikasi: ["Belum Diverifikasi", "gray"], menunggu_konfirmasi: ["Menunggu Konfirmasi Supplier", "navy"],
  terverifikasi_supplier: ["Terverifikasi Supplier", "ok"], ada_selisih: ["Ada Selisih", "red"],
};

const SF_CSS = `
.sf-root{--navy:#0F2A5C;--gold:#C9973A;--ink:#0B1220;--mut:#5B6678;--ln:#E3E8EF;--bg:#F5F7FA;--hd:#F3F5F8;--ok:#0B6B43;--okbg:#E6F4EC;--red:#B42318;--redbg:#FDECEA;
 position:fixed;inset:0;z-index:2000;background:var(--bg);color:var(--ink);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;line-height:1.45;overflow-y:auto;-webkit-font-smoothing:antialiased}
.sf-root *{box-sizing:border-box}
.sf-top{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--ln);padding:12px 16px;display:flex;align-items:center;gap:10px}
.sf-top:after{content:"";position:absolute;left:0;bottom:-1px;width:56px;height:2px;background:var(--gold)}
.sf-top .t{font-size:17px;font-weight:700;color:var(--navy)}.sf-top .s{font-size:12.5px;color:var(--mut)}
.sf-x{margin-left:auto;font:inherit;font-size:14px;font-weight:600;color:var(--navy);background:#fff;border:1px solid #B8C4DA;border-radius:8px;padding:8px 14px;min-height:40px}
.sf-wrap{max-width:1100px;margin:0 auto;padding:14px 16px 40px}
.sf-tabs{display:flex;gap:6px;margin:0 0 12px;border-bottom:1px solid var(--ln)}
.sf-tab{font:inherit;font-size:14.5px;font-weight:600;color:var(--mut);background:none;border:none;border-bottom:2px solid transparent;padding:10px 12px;margin-bottom:-1px}
.sf-tab.on{color:var(--navy);border-bottom-color:var(--navy)}
.sf-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}
.sf-bar label{font-size:12.5px;color:var(--mut)}
.sf-in{font:inherit;font-size:14.5px;color:var(--ink);background:#fff;border:1px solid #C9D2E0;border-radius:8px;padding:9px 10px;min-height:42px;width:100%}
.sf-btn{font:inherit;font-size:14px;font-weight:600;color:var(--navy);background:#fff;border:1px solid #B8C4DA;border-radius:8px;padding:9px 14px;min-height:42px;cursor:pointer}
.sf-btn.pri{background:var(--navy);border-color:var(--navy);color:#fff}
.sf-btn[disabled]{opacity:.5;cursor:default}
.sf-kpis{display:grid;grid-template-columns:repeat(5,1fr);background:#fff;border:1px solid var(--ln);border-radius:10px}
.sf-kpi{padding:14px 16px;border-right:1px solid var(--ln);display:grid;grid-template-columns:1fr;grid-template-areas:"l" "v" "n";align-content:start}.sf-kpi:last-child{border-right:0}
.sf-kpi .l{grid-area:l}.sf-kpi .v{grid-area:v}.sf-kpi .n{grid-area:n}
.sf-kpi .l{font-size:12.5px;color:var(--mut);font-weight:500}
.sf-kpi .v{font-size:19px;font-weight:700;margin-top:4px;color:var(--navy);font-variant-numeric:tabular-nums;white-space:nowrap}
.sf-kpi .v.red{color:var(--red)}.sf-kpi .v.ok{color:var(--ok)}.sf-kpi .v.gray{color:var(--mut);font-size:15px}
.sf-kpi .n{font-size:12px;color:var(--mut);margin-top:2px}
.sf-sec{font-size:13px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4px;margin:20px 0 8px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.sf-sec span{font-size:12.5px;font-weight:500;color:var(--mut);text-transform:none;letter-spacing:0}
.sf-card{background:#fff;border:1px solid var(--ln);border-radius:10px;padding:12px 14px}
.sf-tw{background:#fff;border:1px solid var(--ln);border-radius:10px;overflow-x:auto;-webkit-overflow-scrolling:touch}
.sf-root table{width:100%;border-collapse:collapse;font-size:14px}
.sf-root th{background:var(--hd);color:#3B4A63;font-size:12.5px;font-weight:600;text-align:left;padding:10px 12px;border-bottom:1px solid var(--ln);white-space:nowrap}
.sf-root td{padding:11px 12px;border-bottom:1px solid var(--ln);vertical-align:top}
.sf-root tr:last-child td{border-bottom:0}
.sf-root .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.sf-root tfoot td{background:var(--hd);font-weight:700;border-top:1px solid #CBD3E0}
.sf-inv{font-weight:600;color:var(--navy)}
.sf-sub{font-size:12.5px;color:var(--mut)}
.sf-sticky{position:sticky;left:0;background:#fff;box-shadow:1px 0 0 var(--ln);min-width:122px;max-width:122px}
.sf-root th.sf-sticky,.sf-root tfoot td.sf-sticky{background:var(--hd)}
.sf-root th.sf-sticky{white-space:normal;width:122px;min-width:122px;max-width:122px;line-height:1.25}
.sf-root td.sf-sticky{width:122px;white-space:normal;overflow-wrap:anywhere}
.sf-chip{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 9px;border-radius:999px;border:1px solid var(--ln);white-space:nowrap}
.sf-chip.ok{color:var(--ok);background:var(--okbg);border-color:#BFE3CF}.sf-chip.red{color:var(--red);background:var(--redbg);border-color:#F5C2BC}
.sf-chip.navy{color:var(--navy);background:#fff;border-color:#B8C4DA}.sf-chip.gray{color:var(--mut);background:var(--hd)}
.sf-red{color:var(--red)}.sf-ok{color:var(--ok)}
.sf-note{font-size:12.5px;color:var(--mut);margin-top:8px}
.sf-kv{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:2px 12px;padding:10px 0;border-bottom:1px solid var(--ln)}.sf-kv:last-child{border-bottom:0}
.sf-kv .k{flex:1 1 150px;min-width:0}.sf-kv .v{margin-left:auto;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.sf-list{background:#fff;border:1px solid var(--ln);border-radius:10px}
.sf-tx{padding:12px 14px;border-bottom:1px solid var(--ln)}.sf-tx:last-child{border-bottom:0}
.sf-tx .r1{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.sf-tx .amt{font-size:18px;font-weight:700;color:var(--navy);font-variant-numeric:tabular-nums}
.sf-tx .d{font-size:14.5px;font-weight:600}
.sf-tx .meta{display:grid;grid-template-columns:1fr auto;gap:2px 10px;margin-top:6px;font-size:13.5px}
.sf-tx .meta .k{color:var(--mut)}.sf-tx .meta .vv{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.sf-tx .ft{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;flex-wrap:wrap}
.sf-sheet-bg{position:fixed;inset:0;z-index:2100;background:rgba(11,18,32,.45);display:flex;align-items:flex-end;justify-content:center}
.sf-sheet{background:#fff;width:100%;max-width:640px;max-height:92vh;overflow-y:auto;border-radius:16px 16px 0 0;box-shadow:0 -10px 30px rgba(15,42,92,.25)}
.sf-sheet .hd{position:sticky;top:0;background:#fff;padding:14px 16px 10px;border-bottom:1px solid var(--ln);display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.sf-sheet .hd b{font-size:16px;color:var(--navy)}
.sf-sheet .bd{padding:14px 16px 22px}
.sf-f{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}.sf-f label{font-size:12.5px;color:var(--mut);font-weight:600}
.sf-g2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sf-hit{display:flex;gap:10px;align-items:flex-start;padding:10px 4px;border-bottom:1px solid var(--ln)}
.sf-warn{background:var(--redbg);border:1px solid #F5C2BC;color:var(--red);border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:10px}
.sf-st-m{display:none}
@media (max-width:700px){
.sf-kpis{grid-template-columns:1fr}
.sf-kpi{border-right:0;border-bottom:1px solid var(--ln);grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"l v" "n v";column-gap:10px;align-items:center;padding:12px 12px}
.sf-kpi .l,.sf-kpi .n{overflow-wrap:anywhere;min-width:0}
.sf-kpi:last-child{border-bottom:0}.sf-kpi .v{font-size:18px;margin-top:0;text-align:right}.sf-kpi .n{margin-top:0}
.sf-root th.sf-sticky,.sf-root td.sf-sticky{width:136px;min-width:136px;max-width:136px}
.sf-col-st{display:none}.sf-st-m{display:block;margin-top:4px}
}
`;

const Chip = ({ m }) => <span className={`sf-chip ${m[1]}`}>{m[0]}</span>;
const Kpi = ({ l, v, cls, n }) => <div className="sf-kpi"><div className="l">{l}</div><div className={`v ${cls || ""}`}>{v}</div>{n ? <div className="n">{n}</div> : null}</div>;

function Sheet({ title, sub, onClose, children }) {
  return (
    <div className="sf-sheet-bg" onClick={onClose}>
      <div className="sf-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="hd"><b>{title}</b><span className="sf-sub">{sub}</span><button className="sf-btn" style={{ minHeight: 34, padding: "4px 10px" }} onClick={onClose}>Tutup</button></div>
        <div className="bd">{children}</div>
      </div>
    </div>
  );
}

export default function SupplierFinance({ supplier, adminPin, onClose, flash, onChanged, onPdfFallback }) {
  const headers = { "x-admin-pin": adminPin };
  const [cut, setCut] = useState(today());
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("rekap");
  const [detail, setDetail] = useState(null);       // key transfer
  const [lengkapi, setLengkapi] = useState(false);
  const [saldoOpen, setSaldoOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const note = (m) => (flash ? flash(m) : window.alert(m));

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await axios.get(`${API}/admin/suppliers/${supplier.id}/finance`, { headers, params: { cutoff: cut } });
      setData(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal memuat data finance."); }
  }, [supplier.id, cut, adminPin]); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const pdfBlob = async () => {
    const r = await axios.get(`${API}/admin/suppliers/${supplier.id}/ringkasan-pdf`, { headers, params: { cutoff: cut }, responseType: "blob", timeout: 90000 });
    return r.data;
  };
  const doPdf = async (mode) => {
    setPdfBusy(true);
    try {
      const blob = await pdfBlob();
      const nama = `Ringkasan-Supplier-${(supplier.nama || "supplier").replace(/[^\w-]+/g, "_")}-${cut}.pdf`;
      if (mode === "wa") {
        const f = new File([blob], nama, { type: "application/pdf" });
        if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: nama }); } catch { /* dibatalkan */ } }
        else { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nama; a.click(); note("PDF diunduh. Kirim dari unduhan lewat WhatsApp."); }
      } else {
        window.open(URL.createObjectURL(blob), "_blank");
      }
    } catch (e) {
      if (e?.response?.status === 503 && onPdfFallback) { note("PDF server belum siap, memakai cetak browser."); onPdfFallback(); }
      else note("Gagal membuat PDF. Coba lagi.");
    }
    setPdfBusy(false);
  };

  const [xlsBusy, setXlsBusy] = useState(false);
  const doExcel = async () => {
    setXlsBusy(true);
    try {
      const r = await axios.get(`${API}/admin/suppliers/${supplier.id}/ringkasan-excel`, { headers, params: { cutoff: cut }, responseType: "blob", timeout: 60000 });
      const a = document.createElement("a"); a.href = URL.createObjectURL(r.data);
      a.download = `Rekap-Supplier-${(supplier.nama || "supplier").replace(/[^\w-]+/g, "_")}-${cut}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
      note("Excel diunduh.");
    } catch { note("Gagal membuat Excel. Coba lagi."); }
    setXlsBusy(false);
  };

  const S = data?.ringkasan;
  const R = data?.rekonsiliasi;
  const afterChange = async () => { await load(); if (onChanged) onChanged(); };

  return (
    <div className="sf-root" data-testid="sf-root">
      <style>{SF_CSS}</style>
      <div className="sf-top">
        <div><div className="t">Rekap Supplier</div><div className="s">{supplier.nama} · cut-off {tgl(cut)}</div></div>
        <button className="sf-x" onClick={onClose} data-testid="sf-close">Tutup</button>
      </div>
      <div className="sf-wrap">
        {err && <div className="sf-warn">{String(err)}</div>}
        <div className="sf-tabs">
          <button className={`sf-tab ${tab === "rekap" ? "on" : ""}`} onClick={() => setTab("rekap")} data-testid="sf-tab-rekap">Rekap</button>
          <button className={`sf-tab ${tab === "riwayat" ? "on" : ""}`} onClick={() => setTab("riwayat")} data-testid="sf-tab-riwayat">Riwayat Pembayaran</button>
        </div>
        {!data && !err && <div className="sf-note">Memuat…</div>}
        {data && tab === "rekap" && (<>
          <div className="sf-bar">
            <div style={{ minWidth: 150 }}><label>Tanggal cut-off</label><input className="sf-in" type="date" value={cut} onChange={(e) => setCut(e.target.value || today())} data-testid="sf-cutoff" /></div>
            <div style={{ flex: 1 }} />
            <button className="sf-btn pri" disabled={pdfBusy} onClick={() => doPdf("buka")} data-testid="sf-pdf">{pdfBusy ? "Membuat PDF…" : "PDF A4"}</button>
            <button className="sf-btn" disabled={pdfBusy} onClick={() => doPdf("wa")} data-testid="sf-pdf-wa">Kirim WhatsApp</button>
            <button className="sf-btn" disabled={xlsBusy} onClick={doExcel} data-testid="sf-excel">{xlsBusy ? "Membuat Excel…" : "Excel"}</button>
          </div>
          <div className="sf-kpis" data-testid="sf-kpis">
            <Kpi l="Total Tagihan Supplier" v={rp(S.tagihan)} n={`${S.invoice_n} invoice${S.unit_perlu_dilengkapi ? ` + ${S.unit_perlu_dilengkapi} unit tanpa nomor` : ""}`} />
            <Kpi l="Total Pembayaran" v={rp(S.terbayar)} cls="ok" n={`dari transfer ${rp(S.transfer_aktual)}`} />
            <Kpi l="Sisa Tagihan" v={rp(S.sisa)} n="setelah alokasi" />
            <Kpi l="Belum Dialokasikan" v={rp(S.belum_dialokasikan)} n={`${data.transfers.filter((t) => t.belum_dialokasikan > 0 && t.jenis !== "biaya_admin").length} transfer`} />
            {R.status === "belum_direkonsiliasi"
              ? <Kpi l="Selisih Rekonsiliasi" v="Belum Direkonsiliasi" cls="gray" n="saldo supplier belum diinput" />
              : <Kpi l="Selisih Rekonsiliasi" v={rp(R.selisih)} cls={R.selisih ? "red" : "ok"} n={R.status === "cocok" ? "cocok dengan supplier" : "Alyssa − supplier"} />}
          </div>
          {data.anomali.filter((a) => a.jenis !== "alokasi_ke_unit_tidak_ada").length > 0 && <div className="sf-warn" style={{ marginTop: 10 }}>Perhatian: {data.anomali.filter((a) => a.jenis !== "alokasi_ke_unit_tidak_ada").length} transfer memiliki alokasi melebihi nominal transfer atau biaya admin yang dialokasikan. Data tidak diubah; mohon diperiksa.</div>}
          {data.anomali.filter((a) => a.jenis === "alokasi_ke_unit_tidak_ada").map((a, i) => (
            <div key={i} className="sf-warn" style={{ marginTop: 10 }}>Perhatian: transfer tanggal {tgl(a.tanggal)} punya alokasi {rp(a.teralokasi)} ke unit yang sudah tidak ada pada supplier ini (id unit {a.unit_id}). Nominal ini <b>tidak dihitung</b> sebagai pembayaran invoice, sama seperti perhitungan lama. Data tidak diubah; mohon diperiksa.</div>
          ))}

          <div className="sf-sec">Rekonsiliasi Saldo <span>per cut-off {tgl(R.cutoff || cut)}</span></div>
          <div className="sf-card" data-testid="sf-rekon">
            <div data-testid="sf-rekon-rows">
              <div className="sf-kv"><span className="k">Saldo menurut Alyssa</span><span className="v"><b>{R.saldo_alyssa == null ? "-" : rp(R.saldo_alyssa)}</b></span></div>
              <div className="sf-kv"><span className="k">Saldo menurut supplier</span><span className="v"><b>{R.saldo_supplier == null ? "Belum diinput" : rp(R.saldo_supplier)}</b></span></div>
              <div className="sf-kv"><span className="k">Selisih (Alyssa − supplier)</span><span className="v">{R.selisih == null ? <Chip m={["Belum Direkonsiliasi", "gray"]} /> : <b className={R.selisih ? "sf-red" : "sf-ok"}>{rp(R.selisih)}</b>}</span></div>
            </div>
            <div style={{ marginTop: 10 }}><button className="sf-btn" onClick={() => setSaldoOpen(true)} data-testid="sf-saldo-open">{R.saldo_supplier == null ? "Input saldo supplier" : "Perbarui saldo supplier"}</button></div>
            {R.status === "selisih" && (<>
              <div className="sf-note">{R.arah}</div>
              {R.cocok_nominal.length > 0 && <div className="sf-note"><b>Nominal yang sama dengan selisih:</b> {R.cocok_nominal.map((c) => c.keterangan).join("; ")}.</div>}
              <div className="sf-sec" style={{ marginTop: 14 }}>Kemungkinan penyebab <span>dari data, bukan kesimpulan</span></div>
              <div className="sf-tw"><table><thead><tr><th>Keterangan</th><th className="num">Nominal</th></tr></thead><tbody>
                {R.penyebab.length === 0 && <tr><td colSpan="2" className="sf-sub">Tidak ada kandidat dari data. Periksa laporan supplier.</td></tr>}
                {R.penyebab.map((c, i) => <tr key={i}><td>{c.keterangan}{c.tanggal ? <div className="sf-sub">{tgl(c.tanggal)}</div> : null}</td><td className="num">{rp(c.nominal)}</td></tr>)}
              </tbody></table></div>
            </>)}
          </div>

          <div className="sf-sec">Tagihan per Invoice Supplier <span>{data.invoices.length} invoice · geser tabel →</span></div>
          <div className="sf-tw" data-testid="sf-invoices"><table style={{ minWidth: 800 }}>
            <thead><tr><th className="sf-sticky">No. Invoice Supplier</th><th>Tanggal</th><th>Unit / Rute</th><th className="num">Tagihan</th><th className="num">Terbayar</th><th className="num">Sisa</th><th className="sf-col-st">Status</th></tr></thead>
            <tbody>
              {data.invoices.map((i) => { const [a, b] = split(i.no); return (
                <tr key={i.key}>
                  <td className="sf-sticky sf-inv">{a}{b ? <div className="sf-sub" style={{ fontWeight: 400 }}>{b}</div> : null}<span className="sf-st-m"><Chip m={INV_ST[i.status] || [i.status, "gray"]} />{i.duplikat.length > 0 && <div className="sf-sub sf-red" style={{ fontWeight: 400 }}>Periksa nomor</div>}</span></td>
                  <td style={{ whiteSpace: "nowrap" }}>{tgl(i.tanggal)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{i.unit} unit<div className="sf-sub">{i.rute.slice(0, 2).join("; ")}{i.rute.length > 2 ? " …" : ""}</div></td>
                  <td className="num">{rp(i.tagihan)}</td><td className="num">{rp(i.terbayar)}</td>
                  <td className={`num ${i.status === "selisih" ? "sf-red" : ""}`}><b>{rp(i.sisa)}</b></td>
                  <td className="sf-col-st"><Chip m={INV_ST[i.status] || [i.status, "gray"]} />{i.duplikat.length > 0 && <div className="sf-sub sf-red">Periksa nomor: {i.duplikat.join("; ")}</div>}</td>
                </tr>); })}
              {data.perlu_dilengkapi.unit > 0 && (
                <tr data-testid="sf-perlu">
                  <td className="sf-sticky sf-inv sf-red">Tanpa nomor invoice<span className="sf-st-m"><button className="sf-chip red" style={{ cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600 }} onClick={() => setLengkapi(true)} data-testid="sf-lengkapi-open-m">Perlu Dilengkapi</button></span></td><td>-</td><td>{data.perlu_dilengkapi.unit} unit</td>
                  <td className="num">{rp(data.perlu_dilengkapi.tagihan)}</td><td className="num">{rp(data.perlu_dilengkapi.terbayar)}</td><td className="num"><b>{rp(data.perlu_dilengkapi.sisa)}</b></td>
                  <td className="sf-col-st"><button className="sf-chip red" style={{ cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 600 }} onClick={() => setLengkapi(true)} data-testid="sf-lengkapi-open">Perlu Dilengkapi</button></td>
                </tr>)}
              {data.invoices.length === 0 && data.perlu_dilengkapi.unit === 0 && <tr><td colSpan="7" className="sf-sub">Belum ada tagihan.</td></tr>}
            </tbody>
            <tfoot><tr><td className="sf-sticky">Total</td><td /><td /><td className="num">{rp(S.tagihan)}</td><td className="num">{rp(S.terbayar)}</td><td className="num">{rp(S.sisa)}</td><td className="sf-col-st" /></tr></tfoot>
          </table></div>
          <div className="sf-note">Terbayar = pembayaran yang sudah dialokasikan ke invoice. Transfer yang belum dialokasikan ({rp(S.belum_dialokasikan)}) tidak mengurangi sisa tagihan sampai dialokasikan.{S.penyesuaian > 0 ? ` Penyesuaian kompensasi ${rp(S.penyesuaian)} sudah termasuk dalam Terbayar.` : ""}</div>
        </>)}

        {data && tab === "riwayat" && (<>
          <div className="sf-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 14px", marginBottom: 12 }}>
            <div><div className="sf-sub">Total transfer aktual</div><div style={{ fontSize: 17, fontWeight: 700, color: "var(--navy)" }}>{rp(S.transfer_aktual)}</div></div>
            <div><div className="sf-sub">Teralokasi ke invoice</div><div style={{ fontSize: 17, fontWeight: 700 }} className="sf-ok">{rp(S.teralokasi)}</div></div>
            <div><div className="sf-sub">Belum dialokasikan</div><div style={{ fontSize: 17, fontWeight: 700 }} className={S.belum_dialokasikan ? "sf-red" : ""}>{rp(S.belum_dialokasikan)}</div></div>
            {S.biaya_admin_bank > 0 && <div><div className="sf-sub">Biaya admin bank</div><div style={{ fontSize: 17, fontWeight: 700 }}>{rp(S.biaya_admin_bank)}</div></div>}
          </div>
          <div className="sf-sec">Transaksi Transfer <span>{data.transfers.length} transaksi</span></div>
          <div className="sf-list" data-testid="sf-transfers">
            {data.transfers.length === 0 && <div className="sf-tx sf-sub">Belum ada transfer.</div>}
            {data.transfers.map((t) => (
              <div className="sf-tx" key={t.key}>
                <div className="r1"><div><div className="d">{tgl(t.tanggal)}</div><div className="sf-sub">Ref. {t.ref || "-"}{t.jenis === "biaya_admin" ? " · biaya admin bank" : ""}</div></div><div className="amt">{rp(t.nominal)}</div></div>
                <div className="meta">
                  <span className="k">Invoice dibayar</span><span className="vv">{t.invoice_n} invoice</span>
                  <span className="k">Total teralokasi</span><span className="vv">{rp(t.teralokasi)}</span>
                  <span className="k">Belum dialokasikan</span><span className={`vv ${t.belum_dialokasikan > 0 && t.jenis !== "biaya_admin" ? "sf-red" : ""}`}>{rp(t.belum_dialokasikan)}</span>
                </div>
                <div className="ft"><Chip m={VER[t.verifikasi] || [t.verifikasi_label, "gray"]} /><button className="sf-btn" onClick={() => setDetail(t.key)} data-testid={`sf-detail-${t.key}`}>Detail</button></div>
              </div>))}
          </div>
          <div className="sf-note">Status "diterima" hanya berarti pembayaran berhasil. Persetujuan alokasi oleh supplier dicatat di status verifikasi.</div>
        </>)}
      </div>

      {detail && data && <DetailSheet t={data.transfers.find((x) => x.key === detail)} supplier={supplier} headers={headers} onClose={() => setDetail(null)} onSaved={afterChange} note={note} />}
      {lengkapi && data && <LengkapiSheet supplier={supplier} headers={headers} onClose={() => setLengkapi(false)} onSaved={afterChange} note={note} />}
      {saldoOpen && <SaldoSheet supplier={supplier} headers={headers} cut={cut} onClose={() => setSaldoOpen(false)} onSaved={afterChange} note={note} />}
    </div>
  );
}

function FilePick({ file, setFile, label }) {
  const ref = useRef(null);
  return (
    <div className="sf-f">
      <label>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="sf-btn" onClick={() => ref.current && ref.current.click()}>Pilih file</button>
        <span className="sf-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file ? file.name : "Belum ada file"}</span>
      </div>
      <input ref={ref} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setFile((e.target.files && e.target.files[0]) || null)} />
    </div>
  );
}

function DetailSheet({ t, supplier, headers, onClose, onSaved, note }) {
  const [status, setStatus] = useState(t ? t.verifikasi : "belum_diverifikasi");
  const [cat, setCat] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!t) return null;
  const simpan = async () => {
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("key", t.key); fd.append("status", status); fd.append("catatan", cat);
      if (file) fd.append("bukti", file);
      await axios.patch(`${API}/admin/suppliers/${supplier.id}/verifikasi-transfer`, fd, { headers });
      note("Status verifikasi disimpan"); setCat(""); setFile(null); await onSaved();
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal menyimpan status."); }
    setBusy(false);
  };
  return (
    <Sheet title="Detail Transfer" sub={tgl(t.tanggal)} onClose={onClose}>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--navy)", fontVariantNumeric: "tabular-nums" }}>{rp(t.nominal)}</div>
      <div className="sf-sub" style={{ marginTop: 4 }}>Ref. bank {t.ref || "-"} · <Chip m={VER[t.verifikasi] || [t.verifikasi_label, "gray"]} /></div>
      <div className="sf-sec" style={{ marginTop: 16 }}>Alokasi ke Invoice Supplier</div>
      <div className="sf-tw"><table data-testid="sf-alokasi"><thead><tr><th>No. Invoice Supplier</th><th className="num">Dialokasikan</th></tr></thead><tbody>
        {t.alokasi.length === 0 && <tr><td colSpan="2" className="sf-sub">Belum dialokasikan ke invoice mana pun.</td></tr>}
        {t.alokasi.map((a) => <tr key={a.invoice_key}><td className="sf-inv">{a.invoice_no || <span className="sf-red">Tanpa nomor invoice</span>}<div className="sf-sub" style={{ fontWeight: 400 }}>{a.unit} unit</div></td><td className="num"><b>{rp(a.jumlah)}</b></td></tr>)}
      </tbody><tfoot>
        <tr><td>Total teralokasi</td><td className="num">{rp(t.teralokasi)}</td></tr>
        <tr><td>Belum dialokasikan</td><td className={`num ${t.belum_dialokasikan ? "sf-red" : ""}`}>{rp(t.belum_dialokasikan)}</td></tr>
      </tfoot></table></div>
      <div className="sf-sec">Penelusuran</div>
      <div className="sf-tw"><table><tbody>
        <tr><td className="sf-sub">Bukti transfer</td><td className="num">{t.bukti_url ? <a href={t.bukti_url} target="_blank" rel="noreferrer" style={{ color: "var(--navy)", fontWeight: 600 }}>Lihat bukti</a> : "Belum ada"}</td></tr>
        <tr><td className="sf-sub">Nomor referensi bank</td><td className="num"><b>{t.ref || "-"}</b></td></tr>
        <tr><td className="sf-sub">Konfirmasi supplier</td><td className="num">{VER[t.verifikasi] ? VER[t.verifikasi][0] : t.verifikasi_label}</td></tr>
      </tbody></table></div>
      <div className="sf-sec">Verifikasi Supplier</div>
      <div className="sf-card">
        {err && <div className="sf-warn">{String(err)}</div>}
        <div className="sf-f"><label>Status</label>
          <select className="sf-in" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="sf-ver-status">
            {Object.keys(VER).map((k) => <option key={k} value={k}>{VER[k][0]}</option>)}
          </select></div>
        <div className="sf-f"><label>Catatan / referensi konfirmasi</label><textarea className="sf-in" rows={2} value={cat} onChange={(e) => setCat(e.target.value)} placeholder="mis. WA supplier 5 Nov, saldo disetujui" data-testid="sf-ver-cat" /></div>
        <FilePick file={file} setFile={setFile} label="Bukti (opsional bila ada catatan)" />
        <button className="sf-btn pri" disabled={busy} onClick={simpan} data-testid="sf-ver-save">{busy ? "Menyimpan…" : "Simpan status"}</button>
        <div className="sf-note">Hanya admin yang dapat mengubah. Setiap perubahan tercatat pada riwayat di bawah. Nominal dan alokasi tidak berubah.</div>
      </div>
      {t.verifikasi_riwayat.length > 0 && (<>
        <div className="sf-sec">Riwayat Perubahan Status</div>
        <div className="sf-list">{t.verifikasi_riwayat.slice().reverse().map((r, i) => (
          <div className="sf-tx" key={i}><div className="r1"><div className="d">{(VER[r.ke] || [r.ke])[0]}</div><div className="sf-sub">{dtWaktu(r.pada)}</div></div>
            <div className="sf-sub">dari {(VER[r.dari] || [r.dari])[0]} · oleh {r.oleh}{r.catatan ? ` · ${r.catatan}` : ""}{r.bukti_url ? " · " : ""}{r.bukti_url ? <a href={r.bukti_url} target="_blank" rel="noreferrer">bukti</a> : null}</div></div>))}
        </div></>)}
    </Sheet>
  );
}

function SaldoSheet({ supplier, headers, cut, onClose, onSaved, note }) {
  const [c, setC] = useState(cut);
  const [saldo, setSaldo] = useState("");
  const [cat, setCat] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const simpan = async () => {
    const n = parseInt(String(saldo).replace(/[^0-9-]/g, ""), 10);
    if (Number.isNaN(n)) { setErr("Isi saldo menurut supplier (angka)."); return; }
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("cutoff", c); fd.append("saldo", String(n)); fd.append("catatan", cat);
      if (file) fd.append("bukti", file);
      await axios.post(`${API}/admin/suppliers/${supplier.id}/saldo-supplier`, fd, { headers });
      note("Saldo supplier disimpan"); await onSaved(); onClose();
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal menyimpan."); }
    setBusy(false);
  };
  return (
    <Sheet title="Saldo Menurut Supplier" sub={supplier.nama} onClose={onClose}>
      {err && <div className="sf-warn">{String(err)}</div>}
      <div className="sf-f"><label>Tanggal cut-off laporan supplier</label><input className="sf-in" type="date" value={c} onChange={(e) => setC(e.target.value)} /></div>
      <div className="sf-f"><label>Saldo utang menurut supplier (Rp)</label><input className="sf-in" inputMode="numeric" value={saldo} onChange={(e) => setSaldo(e.target.value)} placeholder="mis. 34700000" data-testid="sf-saldo-val" /></div>
      <div className="sf-f"><label>Catatan</label><input className="sf-in" value={cat} onChange={(e) => setCat(e.target.value)} placeholder="mis. laporan supplier per 31 Okt" /></div>
      <FilePick file={file} setFile={setFile} label="Laporan / bukti saldo supplier (opsional)" />
      <button className="sf-btn pri" disabled={busy} onClick={simpan} data-testid="sf-saldo-save">{busy ? "Menyimpan…" : "Simpan saldo supplier"}</button>
      <div className="sf-note">Riwayat input tersimpan; input baru tidak menghapus yang lama.</div>
    </Sheet>
  );
}

function LengkapiSheet({ supplier, headers, onClose, onSaved, note }) {
  const [q, setQ] = useState(""); const [dari, setDari] = useState(""); const [sampai, setSampai] = useState(""); const [nominal, setNominal] = useState("");
  const [kosong, setKosong] = useState(true);
  const [rows, setRows] = useState([]); const [sel, setSel] = useState({});
  const [nomor, setNomor] = useState(""); const [timpa, setTimpa] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const cari = useCallback(async () => {
    try {
      const params = { q, kosong };
      if (dari) params.dari = dari; if (sampai) params.sampai = sampai;
      const n = parseInt(String(nominal).replace(/[^0-9]/g, ""), 10); if (!Number.isNaN(n)) params.nominal = n;
      const r = await axios.get(`${API}/admin/suppliers/${supplier.id}/cari-unit`, { headers, params });
      setRows(r.data.items || []);
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal mencari."); }
  }, [q, dari, sampai, nominal, kosong, supplier.id]); // eslint-disable-line
  useEffect(() => { const h = setTimeout(cari, 250); return () => clearTimeout(h); }, [cari]);
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const simpan = async (konfirm) => {
    setBusy(true); setErr("");
    try {
      const r = await axios.patch(`${API}/admin/suppliers/${supplier.id}/no-invoice`, { job_ids: ids, no_invoice: nomor, timpa, konfirmasi_duplikat: !!konfirm }, { headers });
      note(`${r.data.diubah} unit diberi nomor invoice`); setSel({}); await onSaved(); await cari();
    } catch (e) {
      const d = e?.response?.data?.detail;
      if (e?.response?.status === 409 && d && d.perlu_konfirmasi) { if (window.confirm(`${d.pesan}\n\nTetap pakai nomor ini?`)) { setBusy(false); return simpan(true); } }
      else setErr(typeof d === "string" ? d : "Gagal menyimpan nomor invoice.");
    }
    setBusy(false);
  };
  return (
    <Sheet title="Lengkapi Nomor Invoice" sub={supplier.nama} onClose={onClose}>
      <div className="sf-note" style={{ marginTop: 0, marginBottom: 10 }}>Cari unit lama, centang, lalu isi nomor invoice asli dari supplier. Hanya nomor yang disimpan; nominal dan pembayaran tidak berubah.</div>
      {err && <div className="sf-warn">{String(err)}</div>}
      <div className="sf-g2">
        <div className="sf-f"><label>No. unit / polisi / rangka / rute</label><input className="sf-in" value={q} onChange={(e) => setQ(e.target.value)} placeholder="B1234 / Makassar" data-testid="sf-cari-q" /></div>
        <div className="sf-f"><label>Nominal tagihan unit (Rp)</label><input className="sf-in" inputMode="numeric" value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="mis. 12000000" /></div>
        <div className="sf-f"><label>Tanggal dari</label><input className="sf-in" type="date" value={dari} onChange={(e) => setDari(e.target.value)} /></div>
        <div className="sf-f"><label>Tanggal sampai</label><input className="sf-in" type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></div>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14, marginBottom: 6 }}><input type="checkbox" checked={kosong} onChange={(e) => setKosong(e.target.checked)} /> Hanya yang belum bernomor</label>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0" }}>
        <b style={{ fontSize: 13 }}>{rows.length} unit ditemukan · {ids.length} dipilih</b>
        <button className="sf-btn" style={{ minHeight: 34, padding: "4px 10px" }} onClick={() => setSel(rows.every((r) => sel[r.id]) ? {} : Object.fromEntries(rows.map((r) => [r.id, true])))}>Pilih semua</button>
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto", borderTop: "1px solid var(--ln)" }} data-testid="sf-cari-hasil">
        {rows.length === 0 && <div className="sf-sub" style={{ padding: 12 }}>Tidak ada unit yang cocok.</div>}
        {rows.map((r) => (
          <label key={r.id} className="sf-hit">
            <input type="checkbox" checked={!!sel[r.id]} onChange={(e) => setSel((s) => ({ ...s, [r.id]: e.target.checked }))} style={{ width: 18, height: 18, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{r.nopol || r.no_rangka || "(tanpa nomor unit)"} <span className="sf-sub" style={{ fontWeight: 400 }}>· {r.vehicle_type}</span></div>
              <div className="sf-sub">{r.rute} · {tgl(r.tanggal)}{r.no_invoice_supplier ? ` · Inv ${r.no_invoice_supplier}` : ""}</div>
            </div>
            <div className="num" style={{ fontWeight: 700 }}>{rp(r.tagihan)}</div>
          </label>))}
      </div>
      <div className="sf-f" style={{ marginTop: 14 }}><label>Nomor invoice supplier (sesuai invoice asli)</label><input className="sf-in" value={nomor} onChange={(e) => setNomor(e.target.value)} placeholder="mis. INV-0987/CBL/X/2026" data-testid="sf-cari-nomor" /></div>
      <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, marginBottom: 10 }}><input type="checkbox" checked={timpa} onChange={(e) => setTimpa(e.target.checked)} /> Timpa nomor yang sudah ada</label>
      <button className="sf-btn pri" disabled={busy || !ids.length || !nomor.trim()} onClick={() => simpan(false)} data-testid="sf-cari-simpan">{busy ? "Menyimpan…" : `Simpan nomor untuk ${ids.length} unit`}</button>
    </Sheet>
  );
}
