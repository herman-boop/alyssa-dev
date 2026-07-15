/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const PIN_KEY = "aal_admin_pin";

const TIPE_SIM = ["A", "B1", "B2", "C", "D"];
const STATUS_OPTS = ["aktif", "nonaktif"];

/* ── helpers ── */
const fmtDate = (s) => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); } catch { return s; }
};

/* ── Kesiapan operasional -- dihitung dari data yang beneran ada:
   kelengkapan profil, kelengkapan foto KTP/SIM, rekam jejak pengiriman,
   dan catatan warning/komplain yang dicatat manual oleh admin. ── */
function computeDriverStats(drv, orders) {
  const profileFields = [drv.no_hp, drv.no_ktp, drv.no_sim, drv.tipe_sim, drv.alamat];
  const profileFilled = profileFields.filter((v) => (v || "").toString().trim()).length;
  const fotoFilled = ["ktp", "sim"].filter((s) => drv[`foto_${s}`]).length;

  const myOrders = orders.filter((o) =>
    (o.driver_id && drv.driver_id && o.driver_id === drv.driver_id) ||
    (!o.driver_id && o.nama_driver && drv.nama && o.nama_driver.trim().toLowerCase() === drv.nama.trim().toLowerCase())
  );
  const selesai = myOrders.filter((o) => o.status === "DELIVERED").length;
  const totalDitugaskan = myOrders.length;

  const catatanLog = Array.isArray(drv.catatan_log) ? drv.catatan_log : [];
  const warningCount = catatanLog.filter((c) => c.jenis === "warning").length;
  const komplainCount = catatanLog.filter((c) => c.jenis === "komplain").length;
  const verified = drv.status !== "pending";

  const profilePct = (profileFilled / profileFields.length) * 100;
  const fotoPct = (fotoFilled / 2) * 100;
  const deliveryPct = totalDitugaskan > 0 ? (selesai / totalDitugaskan) * 100 : null;

  const parts = [profilePct, fotoPct];
  if (deliveryPct !== null) parts.push(deliveryPct);
  const baseScore = parts.reduce((a, b) => a + b, 0) / parts.length;
  const score = Math.round(Math.max(0, baseScore - warningCount * 8 - komplainCount * 12));

  let tier = "siap", tierLabel = "Siap Ditugaskan";
  if (score < 50) { tier = "belum"; tierLabel = "Data Belum Lengkap"; }
  else if (score < 85) { tier = "perlu"; tierLabel = "Perlu Dilengkapi"; }

  return { profileFilled, profileTotal: profileFields.length, fotoFilled, selesai, totalDitugaskan, warningCount, komplainCount, verified, score, tier, tierLabel };
}

const TIER_META = {
  siap:  { bg: "#0d2a10", color: "#3fb950", border: "#238636", label: "Siap Ditugaskan" },
  perlu: { bg: "#2d2410", color: "#EF9F27", border: "#7a5c14", label: "Perlu Dilengkapi" },
  belum: { bg: "#2d1414", color: "#f85149", border: "#7a2020", label: "Data Belum Lengkap" },
};

function CircularScore({ score, tier, size = 74 }) {
  const t = TIER_META[tier] || TIER_META.perlu;
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, score)) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#21262d" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.color} strokeWidth="6" strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset .4s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: size * 0.24, fontWeight: 800, color: "#e6edf3", lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: size * 0.11, color: "#6b7688", marginTop: 1 }}>/100</div>
      </div>
    </div>
  );
}

/* ── icons ── */
const IcoSearch  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IcoPlus    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IcoPencil  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IcoTrash   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
const IcoX       = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcoRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
const IcoCamera  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const IcoId      = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
const IcoPrint   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;

const S = {
  root: { fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#0d1117", color: "#e6edf3", minHeight: "100vh" },
  topbar: { background: "#161b22", borderBottom: "1px solid #21262d", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 16, fontWeight: 800, color: "#EF9F27", flex: 1 },
  btn: (bg, color = "#fff") => ({ padding: "7px 14px", borderRadius: 7, border: "none", background: bg, color, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }),
  btnGhost: { padding: "7px 14px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 },
  input: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "7px 10px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" },
  label: { fontSize: 10, color: "#8b949e", display: "block", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" },
  card: { background: "#161b22", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" },
  pill: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: c === "aktif" ? "#1a4a2a" : "#2d1a1a", color: c === "aktif" ? "#56d364" : "#f85149", border: `1px solid ${c === "aktif" ? "#2ea043" : "#f85149"}` }),
};

/* ── Cetak Surat: search & pick driver ── */
function PrintSuratSearch({ drivers, onPrint, headers }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = q.trim().length >= 2
    ? drivers.filter(d =>
        d.nama?.toLowerCase().includes(q.toLowerCase()) ||
        (d.no_ktp || "").slice(-4).includes(q.replace(/\D/g, ""))
      ).slice(0, 8)
    : [];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1c2128", border: "1px solid #30363d", borderRadius: 7, padding: "6px 10px" }}>
        <IcoPrint />
        <input
          style={{ background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, width: 180, fontFamily: "inherit" }}
          placeholder="Cetak surat — ketik nama / 4 digit KTP"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {q && <button onClick={() => { setQ(""); setOpen(false); }} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", padding: 0, display: "flex" }}><IcoX /></button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, zIndex: 999, boxShadow: "0 8px 24px #0008", overflow: "hidden" }}>
          {results.map(d => (
            <button key={d.driver_id} onClick={async () => {
              setPrinting(d.driver_id);
              try {
                // Fetch detail lengkap agar foto_ktp/foto_sim tersedia
                const r = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${d.driver_id}`, { headers });
                onPrint(r.data);
              } catch { onPrint(d); }
              finally { setPrinting(null); setQ(""); setOpen(false); }
            }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "none", border: "none", borderBottom: "1px solid #21262d", color: "#e6edf3", cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 20 }}>👤</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{d.nama}</div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>{d.driver_id} · KTP: {d.no_ktp ? `****${d.no_ktp.slice(-4)}` : "—"} · SIM {d.tipe_sim || "—"}</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#EF9F27", fontWeight: 700 }}>{printing === d.driver_id ? "⏳..." : "🖨 Cetak"}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && (
        <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, zIndex: 999, padding: "12px", fontSize: 12, color: "#8b949e", textAlign: "center" }}>
          Tidak ditemukan
        </div>
      )}
    </div>
  );
}

export default function DriverData({ embedded = false }) {
  const [pin] = useState(() => localStorage.getItem(PIN_KEY) || "");
  const headers = { "X-Admin-Pin": pin };

  const [drivers, setDrivers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSim, setFilterSim] = useState("");
  const [filterTier, setFilterTier] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null); // null | { mode:"add"|"edit", driver? }
  const [detail, setDetail] = useState(null); // driver for foto/detail view

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.q = search.trim();
      if (filterStatus) params.status = filterStatus;
      const [rDrivers, rOrders] = await Promise.all([
        axios.get(`${API}/admin/drivers`, { headers, params }),
        axios.get(`${API}/admin/orders`, { headers, params: { limit: 500 } }).catch(() => ({ data: { items: [] } })),
      ]);
      setDrivers(rDrivers.data.items || []);
      setOrders(rOrders.data.items || []);
    } catch { flash("Gagal memuat data"); }
    finally { setLoading(false); }
  }, [search, filterStatus, pin]);

  useEffect(() => { load(); }, [load]);

  const driversWithStats = drivers.map((d) => ({ ...d, _stats: computeDriverStats(d, orders) }));
  const visibleDrivers = driversWithStats.filter((d) =>
    (!filterSim || d.tipe_sim === filterSim) && (!filterTier || d._stats.tier === filterTier)
  );
  const tierCounts = driversWithStats.reduce((acc, d) => { acc[d._stats.tier] = (acc[d._stats.tier] || 0) + 1; return acc; }, {});

  const deleteDriver = async (driverId, nama) => {
    if (!window.confirm(`Hapus driver "${nama}"? Data tidak bisa dikembalikan.`)) return;
    try {
      await axios.delete(`${API}/admin/drivers/${driverId}`, { headers });
      flash("Driver dihapus");
      load();
    } catch { flash("Gagal hapus"); }
  };

  const printSurat = async (drv) => {
    const tgl = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const navy = "#1e3a8a", gray = "#6b7280", border = "#e5e7eb";
    const statusOk = (drv.status || "").toLowerCase() === "aktif";
    const cardBase = `background:#fff;border:1px solid ${border};border-radius:14px;padding:20px 22px;`;
    const row = (k, v) => `
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid ${border}">
        <span style="color:${gray};font-size:12px">${k}</span>
        <span style="font-weight:700;font-size:13px;color:#1f2937">${v}</span>
      </div>`;
    const fotoBox = (src, label) => src ? `
      <div style="flex:1;text-align:center">
        <div style="width:100%;height:170px;border:1px solid ${border};border-radius:10px;background:#f9fafb;display:flex;align-items:center;justify-content:center;overflow:hidden">
          <img src="${src}" crossorigin="anonymous" style="max-width:100%;max-height:100%;object-fit:contain;display:block" />
        </div>
        <div style="font-size:11px;color:${gray};margin-top:6px;font-weight:600">${label}</div>
      </div>` : "";
    const secHead = (num, title) => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:24px;height:24px;border-radius:6px;background:${navy};color:#fff;font-weight:800;font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">${num}</div>
        <div style="font-weight:800;font-size:13px;color:${navy};letter-spacing:0.3px">${title}</div>
      </div>`;
    const hasFoto = !!(drv.foto_ktp || drv.foto_sim);
    const nDok = 2, nPernyataan = hasFoto ? 3 : 2, nPengesahan = hasFoto ? 4 : 3;

    const container = document.createElement("div");
    container.style.cssText = "position:fixed;left:-9999px;top:0;width:700px;background:#fff;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;padding:6px;";
    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${navy};padding-bottom:14px;margin-bottom:18px">
        <div>
          <div style="font-size:21px;font-weight:900;color:${navy};letter-spacing:0.3px">SURAT PENGANTAR DRIVER</div>
          <div style="font-size:12px;color:${gray};margin-top:4px">PT Alyssa Auto Logistik — Solusi Transportasi &amp; Logistik Kendaraan</div>
        </div>
        <div style="text-align:right;font-size:11px;flex-shrink:0">
          <div style="color:${gray}">Diterbitkan</div>
          <div style="font-weight:700;margin-top:2px">${tgl}</div>
        </div>
      </div>

      <div style="${cardBase}margin-bottom:14px">
        ${secHead(1, "DATA DRIVER")}
        ${row("Nama Driver", drv.nama || "—")}
        ${row("No. KTP", drv.no_ktp || "—")}
        ${row("No. SIM", `${drv.no_sim || "—"}${drv.tipe_sim ? ` (SIM ${drv.tipe_sim})` : ""}`)}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0 0">
          <span style="color:${gray};font-size:12px">Status</span>
          <span style="font-weight:800;font-size:11px;padding:3px 10px;border-radius:12px;background:${statusOk ? "#d1fae5" : "#fef2f2"};color:${statusOk ? "#065f46" : "#991b1b"}">${(drv.status || "—").toUpperCase()}</span>
        </div>
      </div>

      ${hasFoto ? `
      <div style="${cardBase}margin-bottom:14px">
        ${secHead(nDok, "DOKUMEN &amp; FOTO")}
        <div style="display:flex;gap:14px">
          ${fotoBox(drv.foto_ktp, "Foto KTP")}
          ${fotoBox(drv.foto_sim, "Foto SIM")}
        </div>
      </div>` : ""}

      <div style="${cardBase}background:#eff6ff;margin-bottom:14px">
        ${secHead(nPernyataan, "PERNYATAAN")}
        <div style="font-size:12px;color:#374151;line-height:1.6">Surat ini menyatakan bahwa driver tersebut di atas adalah tenaga pengiriman resmi dari PT Alyssa Auto Logistik dan berwenang untuk melakukan pengiriman kendaraan atas nama perusahaan.</div>
      </div>

      <div style="${cardBase}">
        ${secHead(nPengesahan, "PENGESAHAN")}
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:12px;color:${gray};line-height:1.7">
            Diterbitkan oleh<br/><strong style="color:${navy};font-size:13px">PT Alyssa Auto Logistik</strong><br/>${tgl}
          </div>
          <div style="border:2px solid ${navy};border-radius:50%;width:74px;height:74px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#fff">
            <img src="${window.location.origin}/logo.png" crossorigin="anonymous" style="width:52px;height:52px;object-fit:contain" />
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(container);

    try {
      const imgs = Array.from(container.querySelectorAll("img"));
      await Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((res) => { img.onload = img.onerror = res; }))));
      await new Promise((r) => setTimeout(r, 60));

      const canvas = await html2canvas(container, { backgroundColor: "#ffffff", scale: 2, useCORS: true, logging: false });
      const imgData = canvas.toDataURL("image/jpeg", 0.95);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const usableW = pageW - margin * 2;
      const imgH = (canvas.height / canvas.width) * usableW;
      const finalH = Math.min(imgH, pageH - margin * 2);
      pdf.addImage(imgData, "JPEG", margin, margin, usableW, finalH, undefined, "FAST");
      pdf.save(`Surat-Pengantar-Driver-${(drv.nama || "driver").trim().replace(/\s+/g, "_")}.pdf`);
    } finally {
      document.body.removeChild(container);
    }
  };

  const anyDriverFilterActive = !!(search || filterStatus || filterSim || filterTier);
  const resetDriverFilters = () => { setSearch(""); setFilterStatus(""); setFilterSim(""); setFilterTier(""); };

  return (
    <div style={{ ...S.root, minHeight: embedded ? "unset" : "100vh" }}>
      {/* Header */}
      <div style={{ padding: embedded ? "0 0 4px" : "18px 20px 4px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          {!embedded && <div style={{ fontSize: 19, fontWeight: 800, color: "#f2f5fa" }}>Data Driver</div>}
          <div style={{ fontSize: 12, color: "#6b7688", marginTop: embedded ? 0 : 2 }}>Kelola profil driver &amp; kesiapan operasional</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <PrintSuratSearch drivers={drivers} onPrint={printSurat} headers={headers} />
          <button style={S.btn("#2ea043")} onClick={() => setModal({ mode: "add" })}><IcoPlus /> Tambah Driver</button>
          <button style={S.btnGhost} onClick={load}><IcoRefresh /> Refresh</button>
          {!embedded && <a href="/admin" style={{ ...S.btnGhost, textDecoration: "none" }}>← Admin</a>}
        </div>
      </div>

      {/* Metric row */}
      <div className="adm-metric-row" style={{ display: "flex", gap: 10, padding: "14px 20px", flexWrap: "wrap" }}>
        {[
          { label: "Total Driver", val: drivers.length, icon: "👤", color: "#e6edf3" },
          { label: "Aktif", val: drivers.filter(d => d.status === "aktif").length, icon: "🟢", color: "#56d364" },
          { label: "Nonaktif", val: drivers.filter(d => d.status !== "aktif").length, icon: "⭕", color: "#8b949e" },
          { label: "Siap Ditugaskan", val: tierCounts.siap || 0, icon: "✅", color: "#3fb950" },
          { label: "Perlu Dilengkapi", val: tierCounts.perlu || 0, icon: "⚠️", color: "#EF9F27" },
          { label: "Data Belum Lengkap", val: tierCounts.belum || 0, icon: "🚫", color: "#f85149" },
        ].map(s => (
          <div key={s.label} onClick={() => { if (s.label === "Aktif") setFilterStatus(filterStatus === "aktif" ? "" : "aktif"); if (s.label === "Nonaktif") setFilterStatus(filterStatus === "nonaktif" ? "" : "nonaktif"); if (s.label === "Siap Ditugaskan") setFilterTier(filterTier === "siap" ? "" : "siap"); if (s.label === "Perlu Dilengkapi") setFilterTier(filterTier === "perlu" ? "" : "perlu"); if (s.label === "Data Belum Lengkap") setFilterTier(filterTier === "belum" ? "" : "belum"); }}
            style={{ flex: "1 1 140px", minWidth: 130, display: "flex", alignItems: "center", gap: 10, background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: "12px 14px", cursor: ["Aktif","Nonaktif","Siap Ditugaskan","Perlu Dilengkapi","Data Belum Lengkap"].includes(s.label) ? "pointer" : "default" }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#0d1117", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
            <div>
              <div style={{ fontSize: 19, fontWeight: 800, color: s.color, lineHeight: 1.1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "#6b7688", marginTop: 2 }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="adm-filterbar-v2" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "0 20px 16px" }}>
        <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#8b949e" }}><IcoSearch /></span>
          <input style={{ ...S.input, paddingLeft: 30 }} placeholder="Cari nama, ID driver, nomor HP..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...S.input, width: 140 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Nonaktif</option>
        </select>
        <select style={{ ...S.input, width: 160 }} value={filterTier} onChange={e => setFilterTier(e.target.value)}>
          <option value="">Semua Kesiapan</option>
          <option value="siap">Siap Ditugaskan</option>
          <option value="perlu">Perlu Dilengkapi</option>
          <option value="belum">Data Belum Lengkap</option>
        </select>
        <select style={{ ...S.input, width: 130 }} value={filterSim} onChange={e => setFilterSim(e.target.value)}>
          <option value="">Semua SIM</option>
          {TIPE_SIM.map(t => <option key={t} value={t}>SIM {t}</option>)}
        </select>
        {anyDriverFilterActive && (
          <button style={S.btnGhost} onClick={resetDriverFilters}><IcoX /> Reset</button>
        )}
      </div>

      {/* Grid */}
      <div style={{ padding: "0 20px 20px" }}>
        {loading && <div style={{ color: "#8b949e", padding: 40, textAlign: "center" }}>Memuat...</div>}
        {!loading && visibleDrivers.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "#8b949e" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👷</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{drivers.length === 0 ? "Belum ada driver" : "Tidak ada driver yang cocok"}</div>
            <div style={{ fontSize: 12 }}>{drivers.length === 0 ? 'Klik "Tambah Driver" untuk mulai input data' : "Coba ubah filter di atas"}</div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {visibleDrivers.map(drv => (
            <DriverCard key={drv.driver_id} drv={drv} stats={drv._stats}
              onEdit={() => setModal({ mode: "edit", driver: drv })}
              onDelete={() => deleteDriver(drv.driver_id, drv.nama)}
              onDetail={() => setDetail(drv)}
              onPrint={() => printSurat(drv)}
            />
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#2ea043", color: "#fff", padding: "10px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}

      {/* Modal tambah/edit */}
      {modal && <DriverModal mode={modal.mode} driver={modal.driver} headers={headers} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); flash(modal.mode === "add" ? "Driver ditambahkan!" : "Data tersimpan!"); }} />}

      {/* Detail / foto modal */}
      {detail && <DetailModal drv={detail} headers={headers} onClose={() => { setDetail(null); load(); }} onPrint={() => printSurat(detail)} flash={flash} />}
    </div>
  );
}

/* ── Driver Card ── */
function initials(nama) {
  const parts = (nama || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = ["#1f6feb", "#8957e5", "#2ea043", "#d29922", "#db6d28", "#bf3989"];
function avatarColor(seed) {
  const s = (seed || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return AVATAR_COLORS[s % AVATAR_COLORS.length];
}

function DriverCard({ drv, stats, onEdit, onDelete, onDetail, onPrint }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const t = TIER_META[stats.tier] || TIER_META.perlu;
  const statItems = [
    { label: "Pengiriman Selesai", val: stats.selesai },
    { label: "Total Ditugaskan", val: stats.totalDitugaskan },
    { label: "Foto KTP/SIM", val: `${stats.fotoFilled}/2` },
    { label: "Data Profil", val: `${stats.profileFilled}/${stats.profileTotal}` },
  ];

  return (
    <div className="adm-driver-card" style={{ background: "#161b22", border: "1px solid #21262d", borderLeft: `3px solid ${t.color}`, borderRadius: 12, padding: "16px 18px", display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>

      {/* Identitas */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 220, flex: "1 1 220px" }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: avatarColor(drv.driver_id || drv.nama), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", position: "relative" }}>
          {initials(drv.nama)}
          <span title={drv.status === "aktif" ? "Aktif" : "Nonaktif"} style={{ position: "absolute", bottom: -2, right: -2, width: 13, height: 13, borderRadius: "50%", background: drv.status === "aktif" ? "#3fb950" : "#6b7688", border: "2px solid #161b22" }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{drv.nama}</div>
          <div style={{ fontSize: 10.5, color: "#8b949e", marginTop: 2 }}>{drv.driver_id}</div>
          <div style={{ marginTop: 5, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span style={S.pill(drv.status === "aktif" ? "aktif" : "nonaktif")}>{drv.status}</span>
            {drv.tipe_sim && <span style={{ fontSize: 10, color: "#EF9F27", fontWeight: 700, border: "1px solid #7a5c14", background: "#2b1d0e", borderRadius: 8, padding: "2px 7px" }}>SIM {drv.tipe_sim}</span>}
            <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 8, padding: "2px 7px", border: `1px solid ${stats.verified ? "#238636" : "#7a5c14"}`, background: stats.verified ? "#0d2a10" : "#2d2410", color: stats.verified ? "#3fb950" : "#EF9F27" }}>
              {stats.verified ? "✅ Terverifikasi" : "⏳ Belum Verifikasi"}
            </span>
          </div>
          {drv.no_hp && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 6 }}>📱 {drv.no_hp}</div>}
          {drv.alamat && <div style={{ fontSize: 10.5, color: "#6b7688", marginTop: 2, maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>📍 {drv.alamat}</div>}
          <div style={{ fontSize: 10, color: "#495267", marginTop: 2 }}>Bergabung {fmtDate(drv.created_at)}</div>
        </div>
      </div>

      {/* Skor performa */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: "#5b6577", textTransform: "uppercase" }}>Kesiapan</div>
        <CircularScore score={stats.score} tier={stats.tier} />
      </div>

      {/* Detail performa */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "6px 20px", flex: "1 1 200px", minWidth: 180 }}>
        {statItems.map((it) => (
          <div key={it.label}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#e6edf3" }}>{it.val}</div>
            <div style={{ fontSize: 9.5, color: "#6b7688" }}>{it.label}</div>
          </div>
        ))}
      </div>

      {/* Status kesiapan */}
      <div style={{ minWidth: 190, flex: "0 0 auto", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "10px 12px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: t.color }}>{t.label}</div>
        <div style={{ fontSize: 10, color: "#8b949e", marginTop: 4, lineHeight: 1.4 }}>
          {stats.warningCount === 0 && stats.komplainCount === 0
            ? (stats.tier === "siap" ? "Profil & rekam jejak lengkap." : stats.tier === "perlu" ? "Lengkapi foto/data profil driver." : "Data profil & foto masih minim.")
            : `⚠️ ${stats.warningCount} warning · 🚩 ${stats.komplainCount} komplain tercatat`}
        </div>
      </div>

      {/* Aksi */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto", position: "relative" }}>
        <button style={{ ...S.btn("#EF9F27", "#000"), fontSize: 11, padding: "6px 12px" }} onClick={onDetail}><IcoId /> Lihat Detail</button>
        <button style={{ ...S.btn("none", "#8b949e"), border: "1px solid #30363d", fontSize: 11, padding: "6px 10px" }} onClick={onEdit}><IcoPencil /> Edit</button>
        <button style={{ ...S.btn("none", "#8b949e"), border: "1px solid #30363d", fontSize: 11, padding: "6px 10px" }} onClick={onPrint}><IcoPrint /> Surat</button>
        <button onClick={() => setMenuOpen((v) => !v)} style={{ ...S.btn("none", "#8b949e"), border: "1px solid #30363d", fontSize: 13, padding: "6px 10px" }}>⋮</button>
        {menuOpen && (
          <div onMouseLeave={() => setMenuOpen(false)} style={{ position: "absolute", top: "110%", right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", zIndex: 20, minWidth: 130, boxShadow: "0 8px 24px #0008" }}>
            <button onClick={() => { setMenuOpen(false); onDelete(); }} style={{ width: "100%", padding: "9px 12px", border: "none", background: "none", color: "#f85149", fontSize: 11.5, fontWeight: 700, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <IcoTrash /> Hapus Driver
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Driver Modal (Tambah / Edit) ── */
function DriverModal({ mode, driver, headers, onClose, onSaved }) {
  const [form, setForm] = useState({ nama: "", no_hp: "", no_ktp: "", no_sim: "", tipe_sim: "B1", alamat: "", status: "aktif", ...driver });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.nama.trim()) { alert("Nama wajib diisi"); return; }
    setSaving(true);
    try {
      if (mode === "add") await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers`, form, { headers });
      else await axios.patch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${driver.driver_id}`, form, { headers });
      onSaved();
    } catch (e) { alert("Gagal: " + (e?.response?.data?.detail || "error")); }
    finally { setSaving(false); }
  };

  const I = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "7px 10px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" };
  const L2 = { fontSize: 10, color: "#8b949e", display: "block", marginBottom: 3, fontWeight: 600 };
  const G = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#EF9F27" }}>{mode === "add" ? "Tambah Driver Baru" : `Edit — ${driver.nama}`}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}><IcoX /></button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Nama Lengkap *</label>
            <input style={I} value={form.nama} onChange={e => set("nama", e.target.value)} placeholder="Budi Santoso" autoFocus />
          </div>
          <div style={G}>
            <div><label style={L2}>No. HP</label><input style={I} value={form.no_hp} onChange={e => set("no_hp", e.target.value)} placeholder="0812..." /></div>
            <div><label style={L2}>Status</label><select style={I} value={form.status} onChange={e => set("status", e.target.value)}>{STATUS_OPTS.map(s => <option key={s}>{s}</option>)}</select></div>
          </div>
          <div style={G}>
            <div><label style={L2}>No. KTP</label><input style={I} value={form.no_ktp} onChange={e => set("no_ktp", e.target.value)} placeholder="3271..." /></div>
            <div><label style={L2}>No. SIM</label><input style={I} value={form.no_sim} onChange={e => set("no_sim", e.target.value)} placeholder="..." /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Tipe SIM</label>
            <div style={{ display: "flex", gap: 6 }}>
              {TIPE_SIM.map(t => (
                <button key={t} onClick={() => set("tipe_sim", t)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${form.tipe_sim === t ? "#EF9F27" : "#30363d"}`, background: form.tipe_sim === t ? "#2b1d0e" : "none", color: form.tipe_sim === t ? "#EF9F27" : "#8b949e", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Alamat</label>
            <textarea style={{ ...I, resize: "none" }} rows={2} value={form.alamat} onChange={e => set("alamat", e.target.value)} placeholder="Alamat domisili driver" />
          </div>
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #21262d", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Batal</button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#EF9F27", color: "#000", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>
            {saving ? "Menyimpan..." : mode === "add" ? "Tambah Driver" : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail / Foto Modal ── */
function DetailModal({ drv, headers, onClose, onPrint, flash }) {
  const fileRefs = { ktp: useRef(), sim: useRef() };
  const [uploading, setUploading] = useState(null);
  const [localDrv, setLocalDrv] = useState(drv);
  const [catatanLog, setCatatanLog] = useState(drv.catatan_log || []);
  const [newJenis, setNewJenis] = useState("warning");
  const [newCatatan, setNewCatatan] = useState("");
  const [savingCatatan, setSavingCatatan] = useState(false);

  const uploadFoto = async (slot, file) => {
    if (!file) return;
    setUploading(slot);
    const fd = new FormData(); fd.append("foto", file);
    try {
      const r = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${drv.driver_id}/foto/${slot}`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      setLocalDrv(d => ({ ...d, [`foto_${slot}`]: r.data.url }));
      flash("Foto berhasil diupload!");
    } catch { flash("Gagal upload foto"); }
    finally { setUploading(null); }
  };

  const addCatatan = async () => {
    if (!newCatatan.trim()) return;
    setSavingCatatan(true);
    try {
      const r = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${drv.driver_id}/catatan`, { jenis: newJenis, catatan: newCatatan.trim() }, { headers });
      setCatatanLog(log => [...log, r.data]);
      setNewCatatan("");
      flash(newJenis === "warning" ? "Warning dicatat" : "Komplain dicatat");
    } catch { flash("Gagal simpan catatan"); }
    finally { setSavingCatatan(false); }
  };

  const deleteCatatan = async (catatanId) => {
    if (!window.confirm("Hapus catatan ini?")) return;
    try {
      await axios.delete(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${drv.driver_id}/catatan/${catatanId}`, { headers });
      setCatatanLog(log => log.filter(c => c.id !== catatanId));
      flash("Catatan dihapus");
    } catch { flash("Gagal hapus catatan"); }
  };

  const SLOTS = [
    { key: "ktp", label: "Foto KTP", ico: "🪪" },
    { key: "sim", label: "Foto SIM", ico: "🚗" },
  ];
  const verified = localDrv.status !== "pending";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#EF9F27" }}>Detail Driver — {localDrv.nama}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onPrint} style={{ ...S.btn("#30363d", "#e6edf3"), fontSize: 11, padding: "5px 10px" }}><IcoPrint /> Surat Pengantar</button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}><IcoX /></button>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          {/* Dokumen: hanya KTP & SIM */}
          <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, letterSpacing: .5, textTransform: "uppercase", marginBottom: 8 }}>Dokumen</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 16 }}>
            {SLOTS.map(sl => (
              <div key={sl.key} style={{ textAlign: "center" }}>
                <div style={{ width: "100%", aspectRatio: "4/3", background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, cursor: "pointer", position: "relative" }}
                  onClick={() => fileRefs[sl.key].current?.click()}>
                  {localDrv[`foto_${sl.key}`]
                    ? <img src={localDrv[`foto_${sl.key}`]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 32 }}>{sl.ico}</span>}
                  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: ".2s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                    <IcoCamera />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>{sl.label}</div>
                <button onClick={() => fileRefs[sl.key].current?.click()} disabled={uploading === sl.key}
                  style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", width: "100%" }}>
                  {uploading === sl.key ? "Uploading..." : localDrv[`foto_${sl.key}`] ? "Ganti Foto" : "Upload"}
                </button>
                <input ref={fileRefs[sl.key]} type="file" accept="image/*" style={{ display: "none" }} onChange={e => uploadFoto(sl.key, e.target.files[0])} />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: verified ? "#0d2a10" : "#2d2410", border: `1px solid ${verified ? "#238636" : "#7a5c14"}`, borderRadius: 8, padding: "9px 12px", marginBottom: 16 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: verified ? "#3fb950" : "#EF9F27" }}>Status Verifikasi Dokumen</span>
            <span style={{ fontSize: 11, fontWeight: 800, color: verified ? "#3fb950" : "#EF9F27" }}>{verified ? "✅ Terverifikasi" : "⏳ Belum Diverifikasi"}</span>
          </div>

          <div style={{ background: "#0d1117", borderRadius: 8, padding: 14, marginBottom: 20 }}>
            {[
              ["ID Driver", localDrv.driver_id], ["Nama", localDrv.nama], ["No. HP", localDrv.no_hp || "—"],
              ["No. KTP", localDrv.no_ktp || "—"], ["No. SIM", localDrv.no_sim ? `${localDrv.no_sim} (SIM ${localDrv.tipe_sim || "?"})` : "—"],
              ["Alamat", localDrv.alamat || "—"], ["Status", localDrv.status], ["Bergabung", fmtDate(localDrv.created_at)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 12, borderBottom: "1px solid #21262d", padding: "7px 0", fontSize: 12 }}>
                <span style={{ color: "#8b949e", width: 100, flexShrink: 0 }}>{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>

          {/* Warning & Komplain */}
          <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, letterSpacing: .5, textTransform: "uppercase", marginBottom: 8 }}>Warning &amp; Komplain</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
            {catatanLog.length === 0 && <div style={{ fontSize: 11, color: "#484f58" }}>Belum ada catatan warning/komplain.</div>}
            {[...catatanLog].reverse().map((c) => (
              <div key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: c.jenis === "warning" ? "#2d2410" : "#2d1414", border: `1px solid ${c.jenis === "warning" ? "#7a5c14" : "#7a2020"}`, borderRadius: 8, padding: "8px 10px" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: c.jenis === "warning" ? "#EF9F27" : "#f85149", flexShrink: 0, textTransform: "uppercase" }}>{c.jenis === "warning" ? "⚠️ Warning" : "🚩 Komplain"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: "#e6edf3" }}>{c.catatan}</div>
                  <div style={{ fontSize: 10, color: "#6b7688", marginTop: 2 }}>{fmtDate(c.tanggal)}</div>
                </div>
                <button onClick={() => deleteCatatan(c.id)} style={{ background: "none", border: "none", color: "#6b7688", cursor: "pointer", flexShrink: 0 }}><IcoX /></button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={newJenis} onChange={e => setNewJenis(e.target.value)} style={{ ...S.input, width: 110, flexShrink: 0 }}>
              <option value="warning">Warning</option>
              <option value="komplain">Komplain</option>
            </select>
            <input style={S.input} placeholder="Catatan singkat..." value={newCatatan} onChange={e => setNewCatatan(e.target.value)} onKeyDown={e => e.key === "Enter" && addCatatan()} />
            <button onClick={addCatatan} disabled={savingCatatan || !newCatatan.trim()} style={{ ...S.btn("#EF9F27", "#000"), fontSize: 11, padding: "7px 14px", flexShrink: 0 }}>
              {savingCatatan ? "..." : "+ Catat"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
