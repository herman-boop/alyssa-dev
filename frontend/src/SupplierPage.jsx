import { useState, useEffect, useRef, useMemo } from "react";
import axios from "axios";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter } from "./docTheme";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/* Cetak Ringkasan Supplier sebagai A4 (teks vektor, kaya Penawaran) — tajam
   walau di-screenshot & kirim WhatsApp, huruf kecil biar muat. */
function printSupplierA4(sup, jobsOverride) {
  if (!sup) return;
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
  const now = new Date();
  const tgl = now.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
  const noDoc = `RPS/AAL/${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(2)}/${now.getFullYear()}`;
  // jobsOverride = unit yang dicentang. Kalau kosong -> semua unit. Total selalu
  // dihitung dari unit yang benar-benar dicetak (biar cocok sama isi tabel).
  const jobs = (jobsOverride && jobsOverride.length) ? jobsOverride : (sup.jobs || []);
  const gHarga = jobs.reduce((s, j) => s + (j.total_harga || 0), 0);
  const gBayar = jobs.reduce((s, j) => s + (j.total_terbayar || 0), 0);
  const gSisa = gHarga - gBayar;
  const body = jobs.map((j, i) => {
    const nopol = j.nopol || j.no_rangka || "-";
    const rute = `${j.asal_kota || "-"} → ${j.tujuan_kota || "-"}`;
    const lunas = (j.sisa || 0) <= 0;
    return `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(nopol)}</b><div class="rp-note">${esc(j.vehicle_type || "Unit")}</div></td>
      <td>${esc(rute)}</td>
      <td class="r">${rp(j.total_harga)}</td>
      <td class="r">${rp(j.total_terbayar)}</td>
      <td class="r"><b>${rp(j.sisa)}</b></td>
      <td class="c"><span class="rp-st ${lunas ? "y" : "n"}">${lunas ? "Lunas" : "Sisa"}</span></td>
    </tr>`;
  }).join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noDoc}</title>
  <style>
    ${DOC_BASE_CSS}
    body { font-size: 11px; }
    .doc-sheet { padding: 0; max-width: 210mm; }
    .rps-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:14px; }
    .rps-billto .lbl { font-size:10px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .rps-billto .val { font-size:15px; font-weight:800; color:${DOC_BRAND.ink}; }
    .rps-meta-table { border-collapse:collapse; font-size:11px; }
    .rps-meta-table td { padding:3px 0; } .rps-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .rps-meta-table td:last-child { font-weight:700; text-align:right; }
    table.rps { width:100%; border-collapse:collapse; margin-bottom:14px; }
    table.rps thead { display:table-header-group; } table.rps tfoot { display:table-row-group; }
    table.rps tr { break-inside:avoid; page-break-inside:avoid; }
    table.rps th { text-align:left; font-size:8.5px; text-transform:uppercase; letter-spacing:.3px; color:#fff; background:${DOC_BRAND.navy}; font-weight:700; padding:5px 7px; white-space:nowrap; }
    table.rps th.r { text-align:right; } table.rps th.c { text-align:center; }
    table.rps td { padding:4px 7px; font-size:9px; line-height:1.35; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.rps tbody tr:nth-child(even) td { background:${DOC_BRAND.paperMist}; }
    table.rps td.c { text-align:center; } table.rps td.r { text-align:right; white-space:nowrap; }
    table.rps .rp-note { font-size:8px; color:${DOC_BRAND.muted}; margin-top:2px; }
    table.rps tfoot .tot td { border-top:2px solid ${DOC_BRAND.navy}; border-bottom:none; padding:7px 7px; font-size:10px; font-weight:800; background:#fff; }
    table.rps tfoot .tot .lbl { text-align:right; }
    .rps-note { font-size:10px; color:${DOC_BRAND.muted}; line-height:1.7; }
    @page { size:A4 portrait; margin:8mm; }
    @media print { @page { size:A4 portrait; margin:8mm; } }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "RINGKASAN SUPPLIER" })}
    <div class="rps-meta-row">
      <div class="rps-billto"><div class="lbl">Supplier</div><div class="val">${esc(sup.nama || "-")}</div></div>
      <table class="rps-meta-table">
        <tr><td>No. Dokumen</td><td>${noDoc}</td></tr>
        <tr><td>Tanggal</td><td>${tgl}</td></tr>
        <tr><td>Jumlah Unit</td><td>${jobs.length}</td></tr>
      </table>
    </div>
    <table class="rps">
      <thead><tr>
        <th class="c" style="width:24px">No</th><th>No. Polisi / Unit</th><th>Rute</th>
        <th class="r" style="width:92px">Total Harga</th><th class="r" style="width:92px">Terbayar</th><th class="r" style="width:92px">Sisa</th><th class="c" style="width:52px">Status</th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr class="tot">
        <td class="lbl" colspan="3">TOTAL</td>
        <td class="r">${rp(gHarga)}</td><td class="r">${rp(gBayar)}</td><td class="r">${rp(gSisa)}</td><td></td>
      </tr></tfoot>
    </table>
    <div class="rps-note"><b>Catatan:</b> Ringkasan pembayaran ke supplier. "Sisa" = Total Harga − Terbayar. Konfirmasi: <b>${DOC_BRAND.phone}</b>.</div>
    ${docFooter({ docNo: `Ringkasan ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
}

/* ── util ── */
function fRp(n) { return "Rp " + (Number(n) || 0).toLocaleString("id-ID"); }
function pNum(s) { const n = parseInt(String(s || "").replace(/[^0-9]/g, ""), 10); return isNaN(n) ? 0 : n; }
function onlyDigits(s) { return String(s || "").replace(/[^0-9]/g, ""); }
function fmtRpInput(s) { const d = onlyDigits(s); return d ? Number(d).toLocaleString("id-ID") : ""; }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function fDate(s) { if (!s) return ""; const [y, m, d] = String(s).slice(0, 10).split("-"); if (!y || !m || !d) return s; return `${d}/${m}/${y}`; }
function statusOf(job) { if ((job.sisa || 0) <= 0) return "lunas"; if ((job.total_terbayar || 0) > 0) return "sebagian"; return "belum"; }

/* ── style tokens (dark financial) ── */
const C = { bg: "#0d1117", card: "#161b22", line: "#21262d", inpBg: "#0d1117", inpLine: "#30363d",
  ink: "#e6edf3", mute: "#8b949e", gold: "#EF9F27", green: "#3fb950", yellow: "#e6b450", red: "#f85149", blue: "#58a6ff" };
const I = { background: C.inpBg, border: `1px solid ${C.inpLine}`, borderRadius: 10, padding: "12px 14px", color: C.ink, fontSize: 16, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
const L = { fontSize: 11, color: C.mute, display: "block", marginBottom: 5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "13px 18px", borderRadius: 10, border: "none", background: C.gold, color: "#1a1208", fontWeight: 800, fontSize: 15, cursor: "pointer", minHeight: 48 };
const BTN_GHOST = { padding: "11px 16px", borderRadius: 10, border: `1px solid ${C.inpLine}`, background: "none", color: "#c9d1d9", fontWeight: 700, fontSize: 14, cursor: "pointer", minHeight: 44 };

const ST = { belum: { t: "Belum Bayar", c: C.red, bg: "#2d1214" }, sebagian: { t: "Sebagian", c: C.yellow, bg: "#2a2410" }, lunas: { t: "Lunas", c: C.green, bg: "#0d2818" } };
function Badge({ status }) {
  const m = ST[status] || ST.belum;
  return <span style={{ fontSize: 11, fontWeight: 800, color: m.c, background: m.bg, borderRadius: 20, padding: "3px 10px", whiteSpace: "nowrap" }}>{m.t}</span>;
}

export default function SupplierPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [selected, setSelected] = useState(null);
  const debounceRef = useRef(null);
  const [toast, setToast] = useState("");
  const [listRefreshTick, setListRefreshTick] = useState(0);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); };

  const [tab, setTab] = useState("pembayaran"); // default: Pembayaran (dipakai tiap hari)
  const [filter, setFilter] = useState("semua");
  const [menuOpen, setMenuOpen] = useState(false);

  // search supplier — instan (internet banking style), tanpa klik Search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try { const r = await axios.get(`${API}/admin/suppliers`, { params: { q: query }, headers }); setDropdown(r.data.items || []); }
      catch { setDropdown([]); }
    }, 250);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line
  }, [query, listRefreshTick]);

  const reloadSelected = async (id) => {
    try { const r = await axios.get(`${API}/admin/suppliers/${id}`, { headers }); setSelected(r.data); }
    catch { flash("Gagal memuat data supplier"); }
  };
  const selectSupplier = async (s) => { setDropdown([]); setQuery(s.nama); setPaySel({}); await reloadSelected(s.id); };
  const createOrOpenSupplier = async () => {
    if (!query.trim()) { flash("Masukkan nama supplier dulu"); return; }
    try {
      const r = await axios.post(`${API}/admin/suppliers`, { nama: query.trim() }, { headers });
      setQuery(r.data.nama); await reloadSelected(r.data.id); setListRefreshTick((t) => t + 1); flash("Supplier tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan supplier"); }
  };
  // Auto-simpan: selesai ngetik nama baru (blur/Enter) langsung kesimpen —
  // nggak perlu klik tombol. Kalau namanya udah ada, langsung dibuka (backend
  // create_supplier balikin yang sudah ada, jadi nggak dobel). Delay biar klik
  // dropdown menang.
  const autoSaveSupplier = () => setTimeout(() => {
    const nama = query.trim();
    if (selected || nama.length < 2) return;
    const exact = dropdown.find((s) => (s.nama || "").trim().toLowerCase() === nama.toLowerCase());
    if (exact) { selectSupplier(exact); return; }
    createOrOpenSupplier();
  }, 250);

  const jobs = useMemo(() => selected?.jobs || [], [selected]);
  const unpaidJobs = useMemo(() => jobs.filter((j) => (j.sisa || 0) > 0), [jobs]);
  const lastPayDate = useMemo(() => {
    let d = "";
    jobs.forEach((j) => (j.payments || []).forEach((p) => { if ((p.tanggal || "") > d) d = p.tanggal; }));
    return d;
  }, [jobs]);

  /* ═══ TAB PEMBAYARAN (Mekari-style: pilih tagihan → 1 nominal → alokasi) ═══ */
  const [paySel, setPaySel] = useState({}); // job_id -> true
  const [payAmount, setPayAmount] = useState("");
  const [payTanggal, setPayTanggal] = useState(todayStr());
  const [payMetode, setPayMetode] = useState("Transfer");
  const [payCatatan, setPayCatatan] = useState("");
  const [payBukti, setPayBukti] = useState(null);
  const [paySaving, setPaySaving] = useState(false);
  const payFileRef = useRef();

  const selectedPayJobs = useMemo(() => unpaidJobs.filter((j) => paySel[j.id]), [unpaidJobs, paySel]);
  const totalSelSisa = useMemo(() => selectedPayJobs.reduce((s, j) => s + (j.sisa || 0), 0), [selectedPayJobs]);
  const allUnpaidChecked = unpaidJobs.length > 0 && unpaidJobs.every((j) => paySel[j.id]);

  const togglePay = (id) => setPaySel((s) => ({ ...s, [id]: !s[id] }));
  const selectAllUnpaid = () => {
    if (allUnpaidChecked) { setPaySel({}); return; }
    const n = {}; unpaidJobs.forEach((j) => { n[j.id] = true; }); setPaySel(n);
  };
  // Quick payment
  const qpLunas = () => setPayAmount(String(totalSelSisa));
  const qpDP = (pct) => setPayAmount(String(Math.round(totalSelSisa * pct)));
  const qpManual = () => setPayAmount("");

  const doBatchPay = async () => {
    const ids = selectedPayJobs.map((j) => j.id);
    if (!ids.length) { flash("Centang tagihan yang mau dibayar dulu"); return; }
    const amt = pNum(payAmount);
    if (amt <= 0) { flash("Isi / pilih nominal pembayaran dulu"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("supplier_id", selected.id);
      fd.append("job_ids", ids.join(","));
      fd.append("amount", String(amt));
      fd.append("tanggal", payTanggal || todayStr());
      fd.append("metode", payMetode);
      fd.append("catatan", payCatatan.trim());
      if (payBukti) fd.append("bukti", payBukti);
      const r = await axios.post(`${API}/vendor-mobile/pay-batch`, fd, { headers });
      setPaySel({}); setPayAmount(""); setPayCatatan(""); setPayBukti(null); if (payFileRef.current) payFileRef.current.value = "";
      await reloadSelected(selected.id);   // update total/sisa/status tanpa refresh halaman
      setListRefreshTick((t) => t + 1);
      const applied = (r.data?.applied || []).length;
      flash(`Pembayaran ${fRp(r.data?.total_dibayar || amt)} tersimpan → ${applied} tagihan diupdate`);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan pembayaran"); }
    finally { setPaySaving(false); }
  };

  /* ═══ Tambah unit manual (modal) ═══ */
  const blankJobForm = { vehicle_type: "", nopol: "", no_rangka: "", asal_kota: "", tujuan_kota: "", total_harga: "", catatan: "", tanggal: todayStr() };
  const [manualOpen, setManualOpen] = useState(false);
  const [jobForm, setJobForm] = useState(blankJobForm);
  const [jobSaving, setJobSaving] = useState(false);
  const addJob = async () => {
    if (!selected) return;
    const harga = pNum(jobForm.total_harga);
    if (harga <= 0) { flash("Total harga wajib diisi"); return; }
    setJobSaving(true);
    try {
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
        vehicle_type: jobForm.vehicle_type.trim(), nopol: jobForm.nopol.trim(), no_rangka: jobForm.no_rangka.trim(),
        asal_kota: jobForm.asal_kota.trim(), tujuan_kota: jobForm.tujuan_kota.trim(),
        total_harga: harga, catatan: jobForm.catatan.trim(), tanggal: jobForm.tanggal || todayStr(),
      }, { headers });
      setJobForm(blankJobForm); setManualOpen(false);
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); flash("Unit ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah unit"); }
    finally { setJobSaving(false); }
  };

  /* ═══ Tarik unit dari Order (modal) ═══ */
  const [tarikOpen, setTarikOpen] = useState(false);
  const [tarikOrders, setTarikOrders] = useState([]);
  const [tarikQ, setTarikQ] = useState("");
  const [tarikLoading, setTarikLoading] = useState(false);
  const [tarikSel, setTarikSel] = useState({});
  const [tarikSaving, setTarikSaving] = useState(false);
  const orderUnitsOf = (o) => {
    const arr = (Array.isArray(o.units) && o.units.length) ? o.units
      : [{ unit_id: "legacy", vehicle_type: o.vehicle_type, tipe_model: o.tipe_model, nopol: o.nopol, no_rangka: o.no_rangka }];
    return arr.map((u, i) => ({
      key: `${o.order_id}:${u.unit_id || u.nopol || i}`,
      vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan",
      nopol: (u.nopol || "").toUpperCase(), no_rangka: (u.no_rangka || "").toUpperCase(),
      asal_kota: o.asal_kota || "", tujuan_kota: o.tujuan_kota || "", customer: o.customer_nama || "",
    }));
  };
  // Ambil order dari master admin PO. Kirim kata kunci ke server (q) biar
  // nyari di SELURUH order (bukan cuma 100 terbaru) — cocok no PO, no rangka,
  // nama pelanggan, asal/tujuan. Server nyari juga di dalam units[].
  const fetchTarik = async (qStr) => {
    setTarikLoading(true);
    try {
      const params = { limit: 500 };
      if (qStr && qStr.trim()) params.q = qStr.trim();
      const r = await axios.get(`${API}/admin/orders`, { headers, params });
      setTarikOrders(r.data?.items || []);
    } catch { flash("Gagal memuat order"); setTarikOrders([]); }
    finally { setTarikLoading(false); }
  };
  const openTarik = async () => {
    if (!selected) { flash("Pilih supplier dulu"); return; }
    setTarikOpen(true); setTarikSel({}); setTarikQ("");
    fetchTarik("");
  };
  // Debounce: tiap ketik di search, cari ulang ke server (biar master penuh kepakai).
  useEffect(() => {
    if (!tarikOpen) return;
    const t = setTimeout(() => fetchTarik(tarikQ), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tarikQ, tarikOpen]);
  const toggleTarik = (row) => setTarikSel((s) => { const n = { ...s }; if (n[row.key]) delete n[row.key]; else n[row.key] = { ...row, total_harga: "" }; return n; });
  const setTarikHarga = (key, val) => setTarikSel((s) => ({ ...s, [key]: { ...s[key], total_harga: val } }));
  const tarikRows = tarikOrders.flatMap(orderUnitsOf).filter((row) => {
    const q = tarikQ.trim().toLowerCase(); if (!q) return true;
    return `${row.nopol} ${row.no_rangka} ${row.vehicle_type} ${row.asal_kota} ${row.tujuan_kota} ${row.customer}`.toLowerCase().includes(q);
  });
  const tarikSelArr = Object.values(tarikSel);
  const tarikTotal = tarikSelArr.reduce((s, r) => s + pNum(r.total_harga), 0);
  const doTarik = async () => {
    const valid = tarikSelArr.filter((r) => pNum(r.total_harga) > 0);
    if (!valid.length) { flash("Centang unit & isi Total Harga (HPP) dulu"); return; }
    setTarikSaving(true);
    try {
      for (const r of valid) {
        await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
          vehicle_type: r.vehicle_type, nopol: r.nopol, no_rangka: r.no_rangka,
          asal_kota: r.asal_kota, tujuan_kota: r.tujuan_kota, total_harga: pNum(r.total_harga), catatan: "", tanggal: todayStr(),
        }, { headers });
      }
      setTarikOpen(false); setTarikSel({});
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); flash(`${valid.length} unit ditarik dari order`);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tarik unit"); }
    finally { setTarikSaving(false); }
  };

  /* ═══ Detail unit (modal): riwayat + catat bayar/kompensasi + hapus ═══ */
  const [detailJob, setDetailJob] = useState(null); // job object
  const [dpTipe, setDpTipe] = useState("transfer");
  const [dpAmount, setDpAmount] = useState("");
  const [dpTanggal, setDpTanggal] = useState(todayStr());
  const [dpCatatan, setDpCatatan] = useState("");
  const [dpFile, setDpFile] = useState(null);
  const [dpKomp, setDpKomp] = useState({ vehicle: "", nounit: "", asal: "", tujuan: "" });
  const [dpSaving, setDpSaving] = useState(false);
  const dpFileRef = useRef();
  const openDetail = (job) => {
    setDetailJob(job); setDpTipe("transfer"); setDpAmount(""); setDpTanggal(todayStr()); setDpCatatan(""); setDpFile(null);
    setDpKomp({ vehicle: "", nounit: "", asal: "", tujuan: "" });
  };
  const detailJobLive = useMemo(() => detailJob && jobs.find((j) => j.id === detailJob.id), [detailJob, jobs]);
  const submitDetailPay = async () => {
    const job = detailJob; if (!job) return;
    const amt = pNum(dpAmount);
    if (amt <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setDpSaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", amt); fd.append("catatan", dpCatatan.trim()); fd.append("tanggal", dpTanggal || todayStr()); fd.append("tipe", dpTipe);
      if (dpTipe === "kompensasi") {
        fd.append("kompensasi_vehicle_type", dpKomp.vehicle.trim()); fd.append("kompensasi_no_unit", dpKomp.nounit.trim());
        fd.append("kompensasi_asal_kota", dpKomp.asal.trim()); fd.append("kompensasi_tujuan_kota", dpKomp.tujuan.trim());
      }
      if (dpFile) fd.append("bukti", dpFile);
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs/${job.id}/payments`, fd, { headers });
      setDpAmount(""); setDpCatatan(""); setDpFile(null); if (dpFileRef.current) dpFileRef.current.value = "";
      await reloadSelected(selected.id); setListRefreshTick((t) => t + 1);
      flash(dpTipe === "kompensasi" ? "Kompensasi tercatat" : "Pembayaran tercatat");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan"); }
    finally { setDpSaving(false); }
  };
  const deletePayment = async (jobId, paymentId) => {
    if (!window.confirm("Hapus catatan pembayaran ini?")) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/payments/${paymentId}`, { headers }); await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); }
    catch { flash("Gagal hapus pembayaran"); }
  };
  const deleteJob = async (jobId) => {
    if (!window.confirm("Hapus unit ini beserta semua riwayat pembayarannya?")) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}`, { headers }); setDetailJob(null); await reloadSelected(selected.id); setListRefreshTick((t) => t + 1); }
    catch { flash("Gagal hapus unit"); }
  };

  /* ═══ Edit / hapus supplier (3-titik) ═══ */
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ jenis: "", no_hp: "", catatan: "" });
  const openEdit = () => { setEditForm({ jenis: selected.jenis || "", no_hp: selected.no_hp || "", catatan: selected.catatan || "" }); setEditOpen(true); setMenuOpen(false); };
  const saveEdit = async () => {
    try { await axios.patch(`${API}/admin/suppliers/${selected.id}`, editForm, { headers }); setEditOpen(false); await reloadSelected(selected.id); flash("Supplier diupdate"); }
    catch (e) { flash(e?.response?.data?.detail || "Gagal update"); }
  };
  const deleteSupplier = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Hapus supplier "${selected.nama}" beserta semua unit & riwayat pembayaran? Tidak bisa dibatalkan.`)) return;
    try { await axios.delete(`${API}/admin/suppliers/${selected.id}`, { headers }); setSelected(null); setQuery(""); setListRefreshTick((t) => t + 1); flash("Supplier dihapus"); }
    catch { flash("Gagal hapus supplier"); }
  };
  const addProject = async () => {
    setMenuOpen(false);
    try { await axios.post(`${API}/admin/suppliers/${selected.id}/projects`, {}, { headers }); await reloadSelected(selected.id); flash("Projek baru dibuat"); }
    catch { flash("Gagal bikin projek"); }
  };

  const resolveUrl = (u) => { if (!u) return ""; if (u.startsWith("http")) return u; return `${BACKEND_URL}${u}`; };

  /* ═══ Riwayat transaksi: group payments by batch_id ═══ */
  const txns = useMemo(() => {
    const map = {};
    jobs.forEach((job) => (job.payments || []).forEach((p) => {
      const key = p.batch_id || p.id;
      if (!map[key]) map[key] = { key, tanggal: p.tanggal || "", metode: p.metode || (p.tipe === "kompensasi" ? "Kompensasi" : "Transfer"), catatan: p.catatan || "", bukti_url: p.bukti_url || "", total: 0, allocs: [] };
      map[key].total += p.amount || 0;
      if (p.bukti_url && !map[key].bukti_url) map[key].bukti_url = p.bukti_url;
      if (p.catatan && !map[key].catatan) map[key].catatan = p.catatan;
      map[key].allocs.push({ jobId: job.id, nopol: job.nopol || job.no_rangka || "-", vehicle: job.vehicle_type || "Unit", rute: `${job.asal_kota || "-"} → ${job.tujuan_kota || "-"}`, amount: p.amount || 0, tipe: p.tipe });
    }));
    return Object.values(map).sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
  }, [jobs]);
  const [txnDetail, setTxnDetail] = useState(null);

  /* ═══ Dokumen: semua bukti ═══ */
  const dokumens = useMemo(() => {
    const out = [];
    jobs.forEach((job) => (job.payments || []).forEach((p) => { if (p.bukti_url) out.push({ id: p.id, url: p.bukti_url, tanggal: p.tanggal, amount: p.amount, nopol: job.nopol || job.no_rangka || "-", metode: p.metode || p.tipe }); }));
    return out.sort((a, b) => (b.tanggal || "").localeCompare(a.tanggal || ""));
  }, [jobs]);

  const filteredJobs = useMemo(() => filter === "semua" ? jobs : jobs.filter((j) => statusOf(j) === filter), [jobs, filter]);

  const TABS = [{ k: "pembayaran", t: "Pembayaran" }, { k: "tagihan", t: "Tagihan" }, { k: "riwayat", t: "Riwayat" }, { k: "dokumen", t: "Dokumen" }];

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 12px 120px", color: C.ink }}>
      {/* ── Search supplier (instan) ── */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
        <label style={L}>Cari / Buat Supplier</label>
        <div style={{ position: "relative" }}>
          <input style={I} value={query} onChange={(e) => { setQuery(e.target.value); setSelected(null); }} onBlur={autoSaveSupplier} onKeyDown={(e) => { if (e.key === "Enter") autoSaveSupplier(); }} placeholder="Ketik nama supplier… (mis. PT PEL) — otomatis tersimpan" data-testid="sup-search" />
          {!selected && dropdown.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: 10, marginTop: 4, zIndex: 30, maxHeight: 300, overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
              {dropdown.map((s) => (
                <div key={s.id} onClick={() => selectSupplier(s)} style={{ padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", gap: 10 }} data-testid={`sup-option-${s.id}`}>
                  <span style={{ fontWeight: 700 }}>{s.nama}</span>
                  <span style={{ color: C.mute, fontSize: 12 }}>{s.jumlah_unit || 0} unit · sisa {fRp(s.grand_sisa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && query.trim() && (
          <button style={{ ...BTN, marginTop: 10 }} onClick={createOrOpenSupplier} data-testid="sup-create">+ Buat / Buka "{query.trim()}"</button>
        )}
      </div>

      {selected && (
        <>
          {/* ── HEADER: nama + status + 3 summary card + 3-titik ── */}
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 18, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {selected.nama}
                  <span style={{ fontSize: 10, fontWeight: 800, color: C.green, background: "#0d2818", borderRadius: 12, padding: "2px 8px" }}>● Aktif</span>
                </div>
                <div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                  {selected.jenis || "Supplier"}{selected.no_hp ? ` · ${selected.no_hp}` : ""}
                  {unpaidJobs.length > 0 && <span> · <b style={{ color: C.red }}>{unpaidJobs.length} tagihan belum lunas</b></span>}
                  {lastPayDate && <span> · bayar terakhir {fDate(lastPayDate)}</span>}
                </div>
              </div>
              <div style={{ position: "relative", flexShrink: 0 }}>
                <button onClick={() => setMenuOpen((v) => !v)} style={{ ...BTN_GHOST, padding: "8px 12px", fontSize: 18, lineHeight: 1 }} data-testid="sup-menu" aria-label="Menu">⋮</button>
                {menuOpen && (
                  <div style={{ position: "absolute", top: "110%", right: 0, background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: 10, minWidth: 180, overflow: "hidden", zIndex: 40, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
                    {[
                      { t: "🖨️ Cetak Rekap A4", on: () => { setMenuOpen(false); printSupplierA4(selected); }, },
                      { t: "📁 Projek Baru", on: addProject },
                      { t: "✏️ Edit Supplier", on: openEdit },
                      { t: "🗑️ Hapus Supplier", on: deleteSupplier, danger: true },
                    ].map((m, i) => (
                      <button key={i} onClick={m.on} style={{ display: "block", width: "100%", textAlign: "left", padding: "11px 14px", background: "none", border: "none", borderBottom: i < 3 ? `1px solid ${C.line}` : "none", color: m.danger ? C.red : C.ink, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>{m.t}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* 3 summary card sejajar */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 14 }}>
              {[
                { lbl: "Total Tagihan", val: selected.grand_total_harga, c: C.ink },
                { lbl: "Terbayar", val: selected.grand_total_terbayar, c: C.green },
                { lbl: "Sisa", val: selected.grand_sisa, c: (selected.grand_sisa > 0 ? C.red : C.green) },
              ].map((s, i) => (
                <div key={i} style={{ background: C.inpBg, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 10px" }}>
                  <div style={{ fontSize: 10, color: C.mute, textTransform: "uppercase", letterSpacing: ".4px", fontWeight: 700 }}>{s.lbl}</div>
                  <div style={{ fontSize: 15, fontWeight: 900, color: s.c, marginTop: 4, textAlign: "right", wordBreak: "break-word" }}>{fRp(s.val)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── TABS ── */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
            {TABS.map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)} data-testid={`sup-tab-${t.k}`}
                style={{ flex: "1 0 auto", padding: "10px 14px", borderRadius: 10, border: `1px solid ${tab === t.k ? C.gold : C.line}`, background: tab === t.k ? "#2a1f0d" : C.card, color: tab === t.k ? C.gold : C.mute, fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                {t.t}
              </button>
            ))}
          </div>

          {/* ═══ TAB PEMBAYARAN ═══ */}
          {tab === "pembayaran" && (
            <div>
              {unpaidJobs.length === 0 ? (
                <div style={{ textAlign: "center", padding: 40, color: C.mute, background: C.card, border: `1px solid ${C.line}`, borderRadius: 14 }}>🎉 Semua tagihan supplier ini sudah lunas.</div>
              ) : (
                <>
                  <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 6 }}>
                      <input type="checkbox" checked={allUnpaidChecked} onChange={selectAllUnpaid} style={{ width: 20, height: 20 }} data-testid="sup-pay-all" />
                      <span style={{ fontWeight: 800, fontSize: 14 }}>Pilih Semua Belum Lunas ({unpaidJobs.length})</span>
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                      {unpaidJobs.map((j) => {
                        const on = !!paySel[j.id];
                        return (
                          <label key={j.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${on ? C.gold : C.line}`, background: on ? "#1a1408" : C.inpBg, cursor: "pointer" }} data-testid={`sup-pay-row-${j.id}`}>
                            <input type="checkbox" checked={on} onChange={() => togglePay(j.id)} style={{ width: 20, height: 20, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{j.nopol || j.no_rangka || "(tanpa nopol)"} <span style={{ color: C.mute, fontWeight: 400 }}>· {j.vehicle_type || "Unit"}</span></div>
                              <div style={{ fontSize: 12, color: C.mute }}>{j.asal_kota || "-"} → {j.tujuan_kota || "-"}</div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 15, fontWeight: 900, color: C.red }}>{fRp(j.sisa)}</div>
                              <Badge status={statusOf(j)} />
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Form pembayaran */}
                  <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={() => qpDP(0.5)} data-testid="sup-qp-dp">+ DP 50%</button>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={qpLunas} data-testid="sup-qp-lunas">+ Bayar Lunas</button>
                      <button style={{ ...BTN_GHOST, flex: 1, minWidth: 90 }} onClick={qpManual} data-testid="sup-qp-manual">+ Manual</button>
                    </div>
                    <label style={L}>Nominal Pembayaran</label>
                    <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden", marginBottom: 12 }}>
                      <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
                      <input inputMode="numeric" value={fmtRpInput(payAmount)} onChange={(e) => setPayAmount(onlyDigits(e.target.value))} placeholder="0" data-testid="sup-pay-amount"
                        style={{ border: "none", background: "none", color: C.ink, fontSize: 22, fontWeight: 800, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                      <div><label style={L}>Tanggal</label><input type="date" style={I} value={payTanggal} onChange={(e) => setPayTanggal(e.target.value)} /></div>
                      <div><label style={L}>Metode</label>
                        <select style={I} value={payMetode} onChange={(e) => setPayMetode(e.target.value)}>
                          <option>Transfer</option><option>Tunai</option><option>Lainnya</option>
                        </select>
                      </div>
                    </div>
                    <input style={{ ...I, marginBottom: 10 }} placeholder="Catatan (opsional)" value={payCatatan} onChange={(e) => setPayCatatan(e.target.value)} />
                    <input ref={payFileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayBukti(e.target.files?.[0] || null)} />
                    <button style={{ ...BTN_GHOST, width: "100%" }} onClick={() => payFileRef.current?.click()}>{payBukti ? `📎 ${payBukti.name.slice(0, 28)}` : "📎 Upload Bukti Transfer"}</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ═══ TAB TAGIHAN ═══ */}
          {tab === "tagihan" && (
            <div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <button style={{ ...BTN, flex: 1, minWidth: 150 }} onClick={openTarik} data-testid="sup-tarik-open">+ Tarik Unit dari PO</button>
                <button style={{ ...BTN_GHOST, flex: 1, minWidth: 130 }} onClick={() => { setJobForm(blankJobForm); setManualOpen(true); }} data-testid="sup-manual-open">+ Tambah Manual</button>
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto" }}>
                {[["semua", "Semua"], ["belum", "Belum Bayar"], ["sebagian", "Sebagian"], ["lunas", "Lunas"]].map(([k, t]) => (
                  <button key={k} onClick={() => setFilter(k)} style={{ padding: "7px 12px", borderRadius: 20, border: `1px solid ${filter === k ? C.gold : C.line}`, background: filter === k ? "#2a1f0d" : C.card, color: filter === k ? C.gold : C.mute, fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer" }}>{t}</button>
                ))}
              </div>
              {filteredJobs.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Tidak ada tagihan.</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {filteredJobs.map((j) => (
                  <div key={j.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }} data-testid={`sup-job-${j.id}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 15 }}>{j.nopol || j.no_rangka || "(tanpa nopol)"}</div>
                        <div style={{ fontSize: 12, color: C.mute }}>{j.vehicle_type || "Unit"} · {j.asal_kota || "-"} → {j.tujuan_kota || "-"}</div>
                        {j.catatan && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{j.catatan}</div>}
                      </div>
                      <Badge status={statusOf(j)} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
                      <span style={{ color: C.mute }}>Total</span><span style={{ fontWeight: 700 }}>{fRp(j.total_harga)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: C.mute }}>Terbayar</span><span style={{ color: C.green, fontWeight: 700 }}>{fRp(j.total_terbayar)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 2 }}>
                      <span style={{ color: C.mute }}>Sisa</span><span style={{ fontWeight: 900, color: j.sisa > 0 ? C.red : C.green }}>{fRp(j.sisa)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      {j.sisa > 0 && <button style={{ ...BTN, flex: 1 }} onClick={() => { setPaySel({ [j.id]: true }); setPayAmount(String(j.sisa)); setTab("pembayaran"); }} data-testid={`sup-bayar-${j.id}`}>Bayar</button>}
                      <button style={{ ...BTN_GHOST, flex: 1 }} onClick={() => openDetail(j)} data-testid={`sup-detail-${j.id}`}>Lihat Detail</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ TAB RIWAYAT (timeline) ═══ */}
          {tab === "riwayat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {txns.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Belum ada pembayaran.</div>}
              {txns.map((tx) => (
                <button key={tx.key} onClick={() => setTxnDetail(tx)} style={{ textAlign: "left", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, cursor: "pointer", color: C.ink }} data-testid={`sup-txn-${tx.key}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, color: C.mute }}>{fDate(tx.tanggal)}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2 }}>{tx.metode}{tx.allocs.length > 1 ? ` · ${tx.allocs.length} unit` : ""}{tx.bukti_url ? " · 📎" : ""}</div>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: C.green }}>{fRp(tx.total)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* ═══ TAB DOKUMEN ═══ */}
          {tab === "dokumen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {dokumens.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.mute }}>Belum ada bukti transfer terupload.</div>}
              {dokumens.map((d) => (
                <a key={d.id} href={resolveUrl(d.url)} target="_blank" rel="noreferrer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, textDecoration: "none", color: C.ink }}>
                  <div><div style={{ fontWeight: 700, fontSize: 13 }}>📎 {d.nopol} · {d.metode}</div><div style={{ fontSize: 12, color: C.mute }}>{fDate(d.tanggal)}</div></div>
                  <div style={{ fontWeight: 800, color: C.green }}>{fRp(d.amount)}</div>
                </a>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Sticky bottom bar (tab Pembayaran) ── */}
      {selected && tab === "pembayaran" && unpaidJobs.length > 0 && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50, background: C.card, borderTop: `1px solid ${C.inpLine}`, padding: "12px 16px calc(env(safe-area-inset-bottom) + 12px)", boxShadow: "0 -6px 24px rgba(0,0,0,.4)" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.mute }}>{selectedPayJobs.length} tagihan · dipilih {fRp(totalSelSisa)}</div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{fRp(pNum(payAmount))}</div>
            </div>
            <button style={{ ...BTN, flex: "0 0 auto", minWidth: 170 }} onClick={doBatchPay} disabled={paySaving || !selectedPayJobs.length || pNum(payAmount) <= 0} data-testid="sup-pay-save">
              {paySaving ? "Menyimpan…" : "💾 Simpan Pembayaran"}
            </button>
          </div>
        </div>
      )}

      {/* ── Modal: Tarik dari PO ── */}
      {tarikOpen && (
        <Modal title="Tarik Unit dari PO" onClose={() => setTarikOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setTarikOpen(false)}>Batal</button><button style={BTN} onClick={doTarik} disabled={tarikSaving} data-testid="sup-tarik-save">{tarikSaving ? "Menarik…" : `Tarik ${tarikSelArr.length} Unit${tarikTotal > 0 ? ` · ${fRp(tarikTotal)}` : ""}`}</button></>}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Centang unit, isi HPP (biaya ke supplier ini). Unit, nopol, customer &amp; rute otomatis dari PO.</div>
          <input style={{ ...I, marginBottom: 10 }} placeholder="🔎 cari: no PO / no rangka / nama pelanggan / asal / tujuan" value={tarikQ} onChange={(e) => setTarikQ(e.target.value)} data-testid="sup-tarik-search" />
          {tarikLoading ? <div style={{ padding: 20, textAlign: "center", color: C.mute }}>Memuat…</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {tarikRows.map((row) => {
                const on = !!tarikSel[row.key];
                return (
                  <div key={row.key} style={{ border: `1px solid ${on ? C.gold : C.line}`, borderRadius: 10, padding: 12, background: on ? "#1a1408" : C.inpBg }}>
                    <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                      <input type="checkbox" checked={on} onChange={() => toggleTarik(row)} style={{ width: 20, height: 20, marginTop: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{row.nopol || row.no_rangka || "(tanpa nopol)"} · {row.vehicle_type}</div>
                        <div style={{ fontSize: 12, color: C.mute }}>{row.asal_kota} → {row.tujuan_kota}{row.customer ? ` · ${row.customer}` : ""}</div>
                      </div>
                    </label>
                    {on && <div style={{ marginTop: 8 }}><input style={I} inputMode="numeric" placeholder="HPP / Total Harga ke supplier (Rp)" value={fmtRpInput(tarikSel[row.key].total_harga)} onChange={(e) => setTarikHarga(row.key, onlyDigits(e.target.value))} /></div>}
                  </div>
                );
              })}
              {tarikRows.length === 0 && <div style={{ padding: 16, textAlign: "center", color: C.mute, fontSize: 12 }}>Tidak ada order.</div>}
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Tambah Manual ── */}
      {manualOpen && (
        <Modal title="Tambah Unit Manual" onClose={() => setManualOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setManualOpen(false)}>Batal</button><button style={BTN} onClick={addJob} disabled={jobSaving} data-testid="sup-job-save">{jobSaving ? "Menyimpan…" : "Simpan Unit"}</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input style={I} placeholder="Tipe kendaraan" value={jobForm.vehicle_type} onChange={(e) => setJobForm((f) => ({ ...f, vehicle_type: e.target.value }))} data-testid="sup-job-vehicle" />
            <input style={I} placeholder="No. Polisi (kosongkan kalau mobil baru)" value={jobForm.nopol} onChange={(e) => setJobForm((f) => ({ ...f, nopol: e.target.value.toUpperCase() }))} data-testid="sup-job-nopol" />
            <input style={I} placeholder="No. Rangka" value={jobForm.no_rangka} onChange={(e) => setJobForm((f) => ({ ...f, no_rangka: e.target.value.toUpperCase() }))} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input style={I} placeholder="Kota asal" value={jobForm.asal_kota} onChange={(e) => setJobForm((f) => ({ ...f, asal_kota: e.target.value }))} />
              <input style={I} placeholder="Kota tujuan" value={jobForm.tujuan_kota} onChange={(e) => setJobForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
            </div>
            <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden" }}>
              <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
              <input inputMode="numeric" value={fmtRpInput(jobForm.total_harga)} onChange={(e) => setJobForm((f) => ({ ...f, total_harga: onlyDigits(e.target.value) }))} placeholder="Total harga / HPP" data-testid="sup-job-harga" style={{ border: "none", background: "none", color: C.ink, fontSize: 16, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
            </div>
            <input type="date" style={I} value={jobForm.tanggal} onChange={(e) => setJobForm((f) => ({ ...f, tanggal: e.target.value }))} />
            <input style={I} placeholder="Catatan (opsional)" value={jobForm.catatan} onChange={(e) => setJobForm((f) => ({ ...f, catatan: e.target.value }))} />
          </div>
        </Modal>
      )}

      {/* ── Modal: Detail unit (riwayat + catat bayar/kompensasi) ── */}
      {detailJob && detailJobLive && (
        <Modal title={`${detailJobLive.nopol || detailJobLive.no_rangka || "Unit"} · ${detailJobLive.vehicle_type || ""}`} onClose={() => setDetailJob(null)}
          foot={<button style={{ ...BTN_GHOST, color: C.red, borderColor: C.red }} onClick={() => deleteJob(detailJobLive.id)}>🗑️ Hapus Unit</button>}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Total</span><b>{fRp(detailJobLive.total_harga)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Terbayar</span><b style={{ color: C.green }}>{fRp(detailJobLive.total_terbayar)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><span style={{ color: C.mute }}>Sisa</span><b style={{ color: detailJobLive.sisa > 0 ? C.red : C.green }}>{fRp(detailJobLive.sisa)}</b></div>

          {(detailJobLive.payments || []).length > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 10, marginBottom: 12 }}>
              <div style={{ ...L }}>Riwayat</div>
              {detailJobLive.payments.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "6px 0", borderBottom: `1px solid ${C.line}` }}>
                  <span><span style={{ color: C.mute }}>{fDate(p.tanggal)}</span> — {fRp(p.amount)}{p.tipe === "kompensasi" && <span style={{ color: C.blue }}> · 🚗 Kompensasi</span>}{p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: C.blue }}>📎</a>}</span>
                  <button onClick={() => deletePayment(detailJobLive.id, p.id)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontSize: 12 }}>Hapus</button>
                </div>
              ))}
            </div>
          )}

          {detailJobLive.sisa > 0 && (
            <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button onClick={() => setDpTipe("transfer")} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", border: `1px solid ${dpTipe === "transfer" ? C.gold : C.line}`, background: dpTipe === "transfer" ? "#2a1f0d" : "none", color: dpTipe === "transfer" ? C.gold : C.mute }}>💵 Transfer</button>
                <button onClick={() => setDpTipe("kompensasi")} style={{ flex: 1, padding: 10, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer", border: `1px solid ${dpTipe === "kompensasi" ? C.blue : C.line}`, background: dpTipe === "kompensasi" ? "#0d1b2a" : "none", color: dpTipe === "kompensasi" ? C.blue : C.mute }}>🚗 Kompensasi</button>
              </div>
              {dpTipe === "kompensasi" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <input style={I} placeholder="Tipe kendaraan" value={dpKomp.vehicle} onChange={(e) => setDpKomp((k) => ({ ...k, vehicle: e.target.value }))} />
                  <input style={I} placeholder="No. Pol / Rangka" value={dpKomp.nounit} onChange={(e) => setDpKomp((k) => ({ ...k, nounit: e.target.value.toUpperCase() }))} />
                  <input style={I} placeholder="Kota asal" value={dpKomp.asal} onChange={(e) => setDpKomp((k) => ({ ...k, asal: e.target.value }))} />
                  <input style={I} placeholder="Kota tujuan" value={dpKomp.tujuan} onChange={(e) => setDpKomp((k) => ({ ...k, tujuan: e.target.value }))} />
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", border: `1px solid ${C.inpLine}`, borderRadius: 10, background: C.inpBg, overflow: "hidden", marginBottom: 8 }}>
                <span style={{ padding: "0 12px", fontWeight: 800, color: C.mute }}>Rp</span>
                <input inputMode="numeric" value={fmtRpInput(dpAmount)} onChange={(e) => setDpAmount(onlyDigits(e.target.value))} placeholder={dpTipe === "kompensasi" ? "Nilai unit" : "Jumlah bayar"} style={{ border: "none", background: "none", color: C.ink, fontSize: 18, fontWeight: 700, padding: "12px 12px 12px 0", width: "100%", outline: "none" }} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                <input type="date" style={I} value={dpTanggal} onChange={(e) => setDpTanggal(e.target.value)} />
                <input style={I} placeholder="Catatan" value={dpCatatan} onChange={(e) => setDpCatatan(e.target.value)} />
              </div>
              <input ref={dpFileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setDpFile(e.target.files?.[0] || null)} />
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...BTN_GHOST, flex: 1 }} onClick={() => dpFileRef.current?.click()}>{dpFile ? `📎 ${dpFile.name.slice(0, 16)}` : "📎 Bukti"}</button>
                <button style={{ ...BTN, flex: 2 }} onClick={submitDetailPay} disabled={dpSaving}>{dpSaving ? "Menyimpan…" : "Simpan"}</button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Edit supplier ── */}
      {editOpen && (
        <Modal title="Edit Supplier" onClose={() => setEditOpen(false)}
          foot={<><button style={BTN_GHOST} onClick={() => setEditOpen(false)}>Batal</button><button style={BTN} onClick={saveEdit}>Simpan</button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div><label style={L}>Jenis</label><input style={I} value={editForm.jenis} onChange={(e) => setEditForm((f) => ({ ...f, jenis: e.target.value }))} placeholder="mis. Jasa Supir" /></div>
            <div><label style={L}>No. HP</label><input style={I} value={editForm.no_hp} onChange={(e) => setEditForm((f) => ({ ...f, no_hp: e.target.value }))} /></div>
            <div><label style={L}>Catatan</label><input style={I} value={editForm.catatan} onChange={(e) => setEditForm((f) => ({ ...f, catatan: e.target.value }))} /></div>
          </div>
        </Modal>
      )}

      {/* ── Modal: Detail transaksi (alokasi) ── */}
      {txnDetail && (
        <Modal title="Detail Pembayaran" onClose={() => setTxnDetail(null)}
          foot={<button style={BTN_GHOST} onClick={() => setTxnDetail(null)}>Tutup</button>}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Tanggal</span><b>{fDate(txnDetail.tanggal)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: C.mute }}>Metode</span><b>{txnDetail.metode}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span style={{ color: C.mute }}>Total</span><b style={{ color: C.green, fontSize: 17 }}>{fRp(txnDetail.total)}</b></div>
          {txnDetail.catatan && <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Catatan: {txnDetail.catatan}</div>}
          <div style={{ ...L }}>Dialokasikan ke ({txnDetail.allocs.length} unit)</div>
          {txnDetail.allocs.map((a, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${C.line}` }}>
              <span>{a.nopol} <span style={{ color: C.mute }}>· {a.rute}</span></span>
              <b>{fRp(a.amount)}</b>
            </div>
          ))}
          {txnDetail.bukti_url && <a href={resolveUrl(txnDetail.bukti_url)} target="_blank" rel="noreferrer" style={{ ...BTN_GHOST, display: "block", textAlign: "center", marginTop: 12, textDecoration: "none" }}>📎 Lihat Bukti Transfer</a>}
        </Modal>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 90, left: "50%", transform: "translateX(-50%)", background: "#1a2233", border: `1px solid ${C.gold}`, color: C.gold, padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 700, zIndex: 999, maxWidth: "90%", textAlign: "center" }}>{toast}</div>
      )}
    </div>
  );
}

/* ── Bottom-sheet / modal responsif (mobile = nempel bawah) ── */
function Modal({ title, onClose, children, foot }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 620, maxHeight: "92vh", display: "flex", flexDirection: "column", background: C.card, border: `1px solid ${C.inpLine}`, borderRadius: "18px 18px 0 0", }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 16px 10px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: C.ink }}>{title}</div>
          <button onClick={onClose} style={{ background: "#21262d", border: "none", borderRadius: "50%", width: 34, height: 34, color: C.ink, fontSize: 15, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>{children}</div>
        {foot && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px calc(env(safe-area-inset-bottom) + 14px)", borderTop: `1px solid ${C.line}` }}>{foot}</div>}
      </div>
    </div>
  );
}
