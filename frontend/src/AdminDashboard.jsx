/* eslint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { VEHICLE_TYPE_LIST } from "@/VehicleSketches";
import CostCalculator from "@/CostCalculator";
import DriverData from "@/DriverData";
import "@/App.css";
import "@/Driver.css";
import "@/Admin.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const PIN_KEY = "aal_admin_pin";

const STATUS_LIST = ["NEW", "DISPATCHED", "ON_TRIP", "DELIVERED", "CANCELLED"];
const STATUS_LABEL = {
  NEW:        { txt: "Baru",       cls: "adm-chip-new"  },
  DISPATCHED: { txt: "Dispatched", cls: "adm-chip-disp" },
  ON_TRIP:    { txt: "On-Trip",    cls: "adm-chip-trip" },
  DELIVERED:  { txt: "Delivered",  cls: "adm-chip-done" },
  CANCELLED:  { txt: "Batal",      cls: "adm-chip-cancel" },
};

const fmtDate = (s) => {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" });
  } catch { return s; }
};

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
  try { localStorage.setItem("aal-theme", isDark ? "light" : "dark"); } catch (_) {}
}

/* ── Logo ── */
function Logo({ size = 100 }) {
  return <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={size} height={size} style={{ objectFit: "contain" }} />;
}

/* ── SVG icons ── */
const IcoBook     = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>;
const IcoDownload = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IcoRefresh  = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
const IcoLogout   = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>;
const IcoTruck    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
const IcoPlay     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
const IcoCheck    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IcoX        = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcoTrash    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
const IcoPencil   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IcoSearch   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IcoInbox    = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
const IcoSun      = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>;
const IcoMoon     = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>;
const IcoOdoo     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><circle cx="8" cy="10" r="2"/><circle cx="16" cy="10" r="2"/><path d="M10 10h4"/></svg>;
const IcoCalc     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="10" y2="18"/><line x1="14" y1="18" x2="16" y2="18"/></svg>;
const IcoRoute    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 17V9a6 6 0 0 1 6-6h1"/><path d="M18 7v8a6 6 0 0 1-6 6h-1"/></svg>;
const IcoList     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>;

/* ════════════════════════════════════════
   ROOT
════════════════════════════════════════ */
export default function AdminDashboard() {
  const [pin, setPin] = useState(() => localStorage.getItem(PIN_KEY) || "");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authing, setAuthing] = useState(false);

  useEffect(() => {
    const cached = localStorage.getItem(PIN_KEY) || "";
    if (!cached) return;
    (async () => {
      try {
        const r = await axios.post(`${API}/admin/auth`, { pin: cached });
        if (r.data?.ok) setAuthed(true);
      } catch { localStorage.removeItem(PIN_KEY); setPin(""); }
    })();
  }, []);

  const doLogin = async () => {
    setAuthing(true); setAuthError("");
    try {
      await axios.post(`${API}/admin/auth`, { pin: pin.trim() });
      localStorage.setItem(PIN_KEY, pin.trim());
      setAuthed(true);
    } catch (e) {
      setAuthError(e?.response?.data?.detail || "PIN salah");
    } finally { setAuthing(false); }
  };

  const logout = () => { localStorage.removeItem(PIN_KEY); setPin(""); setAuthed(false); };

  if (!authed) return <PinScreen pin={pin} setPin={setPin} doLogin={doLogin} authing={authing} authError={authError} />;
  return <Dashboard pin={pin} onLogout={logout} />;
}

/* ════════════════════════════════════════
   PIN SCREEN
════════════════════════════════════════ */
function PinScreen({ pin, setPin, doLogin, authing, authError }) {
  return (
    <div className="adm-root">
      <div className="adm-pin-wrap" data-testid="adm-pin-wrap">
        <div className="adm-pin-card">
          <div className="adm-pin-logo-wrap">
            <Logo size={96} />
          </div>
          <h1 className="adm-pin-title">Admin Dashboard</h1>
          <p className="adm-pin-sub">PT Alyssa Auto Logistik · Internal Control</p>
          <div className="adm-pin-divider" />
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doLogin(); }}
            className="adm-pin-input"
            placeholder="••••"
            data-testid="adm-pin-input"
            maxLength={20}
          />
          {authError && <div className="adm-pin-err" data-testid="adm-pin-err">{authError}</div>}
          <button
            className="adm-pin-btn"
            onClick={doLogin}
            disabled={authing || !pin}
            data-testid="adm-pin-submit"
          >
            {authing ? "Memverifikasi..." : "Masuk ke Dashboard"}
          </button>
          <div className="adm-pin-hint">Hubungi admin sistem jika lupa PIN.</div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════ */
function Dashboard({ pin, onLogout }) {
  const headers = useMemo(() => ({ "X-Admin-Pin": pin }), [pin]);
  const [dark, setDark] = useState(() => document.documentElement.getAttribute("data-theme") === "dark");
  const [activeTab, setActiveTab] = useState("pesanan");
  const [stats, setStats] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [convertModal, setConvertModal] = useState(null);
  const [odooModal, setOdooModal] = useState(null);
  const [legsModal, setLegsModal] = useState(null);
  const [toast, setToast] = useState("");
  const [kordList, setKordList] = useState([]);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2600); };

  const loadAll = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.q = search.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const [s, o] = await Promise.all([
        axios.get(`${API}/admin/stats`, { headers }),
        axios.get(`${API}/admin/orders`, { headers, params }),
      ]);
      setStats(s.data);
      setOrders(o.data?.items || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Gagal memuat data");
    } finally { setLoading(false); }
  }, [headers, statusFilter, search, dateFrom, dateTo]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    axios.get(`${API}/admin/koordinators`, { headers })
      .then(r => setKordList(r.data.items || []))
      .catch(() => {});
  }, [headers]);

  const patchOrder = async (orderId, body) => {
    try {
      await axios.patch(`${API}/admin/orders/${orderId}`, body, { headers });
      flash("Tersimpan");
      await loadAll();
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const deleteOrder = async (orderId) => {
    try {
      await axios.delete(`${API}/admin/orders/${orderId}`, { headers });
      flash("Order dihapus");
      await loadAll();
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const doOdoo = (orderId) => {
    const order = orders.find(o => o.order_id === orderId);
    setOdooModal({ orderId, order });
  };

  const saveLegs = async (tripId, legs) => {
    try {
      await axios.patch(`${API}/admin/trips/${tripId}/legs`, { legs }, { headers });
      flash("Rute leg tersimpan");
      setLegsModal(null);
      await loadAll();
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const doConvert = async (orderId, body) => {
    try {
      const r = await axios.post(`${API}/orders/${orderId}/convert`, body, { headers });
      flash(`Trip dibuat: ${r.data.trip_id}`);
      setConvertModal(null);
      await loadAll();
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const exportCsv = async () => {
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (search.trim()) params.q = search.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo)   params.date_to   = dateTo;
      const r = await axios.get(`${API}/admin/orders/export.csv`, { headers, params, responseType: "blob" });
      const blob = new Blob([r.data], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `alyssa-orders-${new Date().toISOString().slice(0,10).replace(/-/g,"")}.csv`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("CSV diunduh");
    } catch (e) { flash("Gagal export: " + (e?.response?.data?.detail || "error")); }
  };

  return (
    <div className="adm-root" data-testid="adm-dashboard">

      {/* ── Topbar ── */}
      <header className="adm-topbar">
        <div className="adm-topbar-left">
          <div className="adm-topbar-logo">
            <Logo size={38} />
          </div>
          <div className="adm-topbar-info">
            <div className="adm-topbar-title">Admin Control</div>
            <div className="adm-topbar-sub">PT Alyssa Auto Logistik</div>
          </div>
        </div>
        <div className="adm-topbar-actions">
          <a href="?guide=1" target="_blank" rel="noreferrer" className="adm-btn adm-btn-ghost adm-btn-sm" data-testid="adm-tutorial-link">
            <IcoBook /> Tutorial
          </a>
          <button className="adm-btn adm-btn-gold adm-btn-sm" onClick={exportCsv} data-testid="adm-export-csv">
            <IcoDownload /> Export CSV
          </button>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={loadAll} data-testid="adm-refresh">
            <IcoRefresh /> Refresh
          </button>
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onLogout} data-testid="adm-logout">
            <IcoLogout /> Keluar
          </button>
          <button
            className="theme-toggle"
            onClick={() => { toggleTheme(); setDark(d => !d); }}
            aria-label="Toggle dark mode"
            style={{ marginLeft: 2 }}
          >
            {dark ? <IcoSun /> : <IcoMoon />}
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div style={{ display: "flex", gap: 4, padding: "10px 16px 0", borderBottom: "1px solid var(--border)", background: "var(--bg-2)" }}>
        <button
          onClick={() => setActiveTab("pesanan")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: activeTab === "pesanan" ? "var(--bg-card)" : "transparent",
            color: activeTab === "pesanan" ? "var(--gold)" : "var(--text-3)",
            borderBottom: activeTab === "pesanan" ? "2px solid var(--gold)" : "2px solid transparent" }}
        ><IcoList /> Pesanan</button>
        <button
          onClick={() => setActiveTab("kalkulator")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: activeTab === "kalkulator" ? "var(--bg-card)" : "transparent",
            color: activeTab === "kalkulator" ? "var(--gold)" : "var(--text-3)",
            borderBottom: activeTab === "kalkulator" ? "2px solid var(--gold)" : "2px solid transparent" }}
        ><IcoCalc /> Kalkulator HPP</button>
        <button
          onClick={() => setActiveTab("drivers")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: activeTab === "drivers" ? "var(--bg-card)" : "transparent",
            color: activeTab === "drivers" ? "var(--gold)" : "var(--text-3)",
            borderBottom: activeTab === "drivers" ? "2px solid var(--gold)" : "2px solid transparent" }}
        >👷 Data Driver</button>
        <button
          onClick={() => setActiveTab("koordinator")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700,
            background: activeTab === "koordinator" ? "var(--bg-card)" : "transparent",
            color: activeTab === "koordinator" ? "var(--gold)" : "var(--text-3)",
            borderBottom: activeTab === "koordinator" ? "2px solid var(--gold)" : "2px solid transparent" }}
        >🧑‍💼 Koordinator</button>
      </div>

      {activeTab === "kalkulator" && (
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <CostCalculator />
        </div>
      )}

      {activeTab === "drivers" && (
        <>
          <div style={{ maxWidth: 900, margin: "12px auto 0", padding: "0 16px" }}>
            <div style={{ background: "#1a4a2a", border: "1px solid #2ea043", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "#56d364", fontWeight: 700 }}>🔗 Link Daftar Driver:</span>
              <code style={{ flex: 1, fontSize: 13, color: "#e6edf3", background: "#0d1117", padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", wordBreak: "break-all" }}>
                {window.location.origin}/daftar-driver
              </code>
              <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/daftar-driver`)}
                style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #2ea043", background: "none", color: "#56d364", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                📋 Salin
              </button>
            </div>
          </div>
          <DriverData embedded />
        </>
      )}

      {activeTab === "koordinator" && (
        <KordManageTab headers={headers} />
      )}

      {activeTab === "pesanan" && <>

      {/* ── Link Form Pesanan ── */}
      <div style={{ maxWidth: 960, margin: "12px auto 0", padding: "0 16px" }}>
        <div style={{ background: "#1a2d4a", border: "1px solid #1f6feb", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "#60a5fa", fontWeight: 700 }}>🔗 Link Form Pesanan:</span>
          <code style={{ flex: 1, fontSize: 13, color: "#e6edf3", background: "#0d1117", padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", wordBreak: "break-all" }}>
            {window.location.origin}/order
          </code>
          <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/order`)}
            style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #1f6feb", background: "none", color: "#60a5fa", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            📋 Salin
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      {stats && (
        <section className="adm-stats" data-testid="adm-stats">
          <StatTile label="Total Pesanan" value={stats.total} />
          {STATUS_LIST.map((s) => (
            <StatTile
              key={s}
              label={STATUS_LABEL[s].txt}
              value={stats.by_status?.[s] || 0}
              cls={STATUS_LABEL[s].cls}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              active={statusFilter === s}
              testid={`adm-stat-${s.toLowerCase()}`}
            />
          ))}
        </section>
      )}

      {/* ── Filters ── */}
      <section className="adm-filters">
        <div className="adm-search-wrap">
          <span className="adm-search-ico"><IcoSearch /></span>
          <input
            type="search"
            className="adm-search"
            placeholder="Cari nama, HP, kota, nopol, atau ID order..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="adm-search"
          />
        </div>
        <select
          className="adm-status-sel"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="adm-status-filter"
        >
          <option value="">Semua status</option>
          {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABEL[s].txt}</option>)}
        </select>
        <div className="adm-date-range">
          <label className="adm-date-lbl">Dari</label>
          <input type="date" className="adm-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo || undefined} data-testid="adm-date-from" />
          <label className="adm-date-lbl">Sampai</label>
          <input type="date" className="adm-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom || undefined} data-testid="adm-date-to" />
        </div>
        {(search || statusFilter || dateFrom || dateTo) && (
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={() => { setSearch(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); }} data-testid="adm-filter-reset">
            <IcoX /> Reset
          </button>
        )}
      </section>

      {/* ── List ── */}
      <section className="adm-list" data-testid="adm-list">
        {loading && [1,2,3].map(i => (
          <div key={i} className="adm-card" style={{ padding: 18 }}>
            <div style={{ display:"flex", gap:10, marginBottom:14 }}>
              <div className="adm-skel" style={{ width:120, height:18 }} />
              <div className="adm-skel" style={{ width:80, height:18 }} />
              <div className="adm-skel" style={{ width:100, height:14, marginLeft:"auto" }} />
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px 20px" }}>
              {[140,110,160,90].map((w,j) => <div key={j} className="adm-skel" style={{ height:36 }} />)}
            </div>
          </div>
        ))}
        {error && <div className="adm-error" data-testid="adm-list-err">{error}</div>}
        {!loading && !error && orders.length === 0 && (
          <div className="adm-empty" data-testid="adm-empty">
            <div className="adm-empty-ico"><IcoInbox /></div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:6, color:"var(--text-2)" }}>
              Tidak ada pesanan
            </div>
            <div>{statusFilter ? `dengan status "${STATUS_LABEL[statusFilter]?.txt}"` : "yang cocok dengan filter saat ini."}</div>
          </div>
        )}
        {orders.map((o, idx) => (
          <OrderCard
            key={o.order_id}
            order={o}
            idx={idx}
            onConvert={() => setConvertModal(o)}
            onPatch={(body) => patchOrder(o.order_id, body)}
            onOdoo={doOdoo}
            onDelete={() => deleteOrder(o.order_id)}
            onOpenLegs={() => setLegsModal({ tripId: o.trip_id, order: o })}
            headers={headers}
            kordList={kordList}
          />
        ))}
      </section>

      {toast && <div className="adm-toast" data-testid="adm-toast">{toast}</div>}
      {convertModal && (
        <ConvertModal
          order={convertModal}
          onClose={() => setConvertModal(null)}
          onSubmit={(body) => doConvert(convertModal.order_id, body)}
        />
      )}
      {odooModal && (
        <OdooModal
          order={odooModal.order}
          orderId={odooModal.orderId}
          headers={headers}
          onClose={() => setOdooModal(null)}
        />
      )}
      {legsModal && (
        <LegsModal
          tripId={legsModal.tripId}
          order={legsModal.order}
          onClose={() => setLegsModal(null)}
          onSave={(legs) => saveLegs(legsModal.tripId, legs)}
          headers={headers}
        />
      )}

      </>}
    </div>
  );
}

/* ════════════════════════════════════════
   STAT TILE
════════════════════════════════════════ */
function StatTile({ label, value, cls = "", onClick, active, testid }) {
  return (
    <div
      className={`adm-stat ${cls} ${onClick ? "adm-stat-clickable" : ""} ${active ? "adm-stat-active" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-testid={testid}
    >
      <div className="adm-stat-val">{value}</div>
      <div className="adm-stat-lbl">{label}</div>
    </div>
  );
}

/* ════════════════════════════════════════
   ORDER CARD
════════════════════════════════════════ */
function OrderCard({ order, idx, onConvert, onPatch, onOdoo, onDelete, onOpenLegs, headers, kordList = [] }) {
  const [uploadingKapal, setUploadingKapal] = useState(false);
  const kapalFileRef = useRef();

  const uploadFotoKapal = async (files) => {
    if (!order.trip_id || !files?.length) return;
    setUploadingKapal(true);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("stage", "kapal");
        await axios.post(`${API}/trips/${order.trip_id}/album`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      }
      alert(`${files.length} foto berhasil diupload ke album Di Kapal`);
    } catch { alert("Gagal upload foto"); }
    setUploadingKapal(false);
  };

  const [editDriver, setEditDriver] = useState(false);
  const [driverDraft, setDriverDraft] = useState(order.driver_id || "");
  const [editNama, setEditNama] = useState(false);
  const [namaDraft, setNamaDraft] = useState(order.nama_driver || "");
  const [editVehicle, setEditVehicle] = useState(false);
  const [vtDraft, setVtDraft] = useState(order.vehicle_type || "");
  const [nopolDraft, setNopolDraft] = useState(order.nopol || "");
  const [kordDraft, setKordDraft] = useState(order.koordinator_id || "");
  const [kordSaving, setKordSaving] = useState(false);
  const lbl = STATUS_LABEL[order.status] || { txt: order.status, cls: "adm-chip-new" };

  const activeKords = kordList.filter(k => k.aktif !== false);

  const saveKord = async (selectedId) => {
    if (!order.trip_id) return;
    const kord = kordList.find(k => k.id === selectedId);
    if (!kord) return;
    setKordSaving(true);
    try {
      await axios.patch(`${API}/admin/trips/${order.trip_id}/koordinator`, {
        koordinator_id: kord.id,
        koordinator_nama: kord.nama,
        koordinator_hp: "",
      }, { headers });
      setKordDraft(selectedId);
    } catch (e) {
      alert(e?.response?.data?.detail || "Gagal simpan koordinator");
    } finally { setKordSaving(false); }
  };

  const saveVehicle = async () => {
    await onPatch({ vehicle_type: vtDraft, nopol: nopolDraft.trim() });
    setEditVehicle(false);
  };

  const linkDriver = order.trip_id ? (() => {
    const p = new URLSearchParams();
    if (order.driver_id) p.set("driver", order.driver_id);
    if (order.nopol)     p.set("nopol", order.nopol);
    if (order.no_rangka) p.set("rangka", order.no_rangka);
    const qs = p.toString();
    return `/trip/${order.trip_id}${qs ? `?${qs}` : ""}`;
  })() : null;
  const linkTrack = order.trip_id ? `/track/${order.trip_id}` : null;
  const linkBastk = order.trip_id ? `/bastk/${order.trip_id}` : null;

  const saveDriver = async () => { await onPatch({ driver_id: driverDraft }); setEditDriver(false); };
  const saveNama = async () => { await onPatch({ nama_driver: namaDraft.trim() }); setEditNama(false); };

  return (
    <article
      className="adm-card"
      data-status={order.status}
      data-testid={`adm-order-${order.order_id}`}
      style={{ animationDelay: `${idx * 40}ms` }}
    >
      {/* Head */}
      <header className="adm-card-head">
        <div className="adm-card-id-row">
          <span className="adm-card-id adm-mono">{order.order_id}</span>
          <span className={`adm-chip ${lbl.cls}`} data-testid={`adm-status-${order.order_id}`}>{lbl.txt}</span>
        </div>
        <div className="adm-card-date">{fmtDate(order.created_at)}</div>
      </header>

      {/* Body — 2-col grid */}
      <div className="adm-card-body">
        <div className="adm-field-row">
          <div className="adm-field-key">Pelanggan</div>
          <div className="adm-field-val">
            {order.customer_nama || "—"} &middot; {order.customer_hp || "—"}
          </div>
        </div>
        <div className="adm-field-row">
          <div className="adm-field-key">Rute</div>
          <div className="adm-field-val">
            {order.asal_kota || "—"} &rarr; {order.tujuan_kota || "—"}
          </div>
        </div>
        <div className="adm-field-row">
          <div className="adm-field-key">Kendaraan</div>
          <div className="adm-field-val">
            {editVehicle ? (
              <span className="adm-driver-edit-row" style={{ flexWrap: "wrap" }}>
                <select
                  className="adm-input-inline"
                  value={vtDraft}
                  onChange={(e) => setVtDraft(e.target.value)}
                  data-testid={`adm-vehicle-type-${order.order_id}`}
                >
                  <option value="">— Tipe —</option>
                  {VEHICLE_TYPE_LIST.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                <input
                  className="adm-input-inline adm-mono"
                  value={nopolDraft}
                  onChange={(e) => setNopolDraft(e.target.value.toUpperCase())}
                  placeholder="B 1234 ABC"
                  data-testid={`adm-vehicle-nopol-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveVehicle} data-testid={`adm-vehicle-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditVehicle(false); setVtDraft(order.vehicle_type || ""); setNopolDraft(order.nopol || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.vehicle_type || "—"}
                {order.nopol && <span className="adm-pill adm-mono">{order.nopol}</span>}
                <button className="adm-link" onClick={() => setEditVehicle(true)} data-testid={`adm-vehicle-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>
        {order.trip_id && (
          <div className="adm-field-row">
            <div className="adm-field-key">Trip ID</div>
            <div className="adm-field-val adm-mono">{order.trip_id}</div>
          </div>
        )}
        <div className="adm-field-row adm-full">
          <div className="adm-field-key">Driver</div>
          <div className="adm-field-val">
            {editDriver ? (
              <span className="adm-driver-edit-row">
                <input
                  className="adm-input-inline adm-mono"
                  value={driverDraft}
                  onChange={(e) => setDriverDraft(e.target.value)}
                  placeholder="DRV-XXXX"
                  autoFocus
                  data-testid={`adm-driver-input-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveDriver} data-testid={`adm-driver-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditDriver(false); setDriverDraft(order.driver_id || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.driver_id
                  ? <span className="adm-pill adm-mono">{order.driver_id}</span>
                  : <i className="adm-mute">belum di-assign</i>}
                <button className="adm-link" onClick={() => setEditDriver(true)} data-testid={`adm-driver-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>
        <div className="adm-field-row adm-full">
          <div className="adm-field-key">Nama Driver</div>
          <div className="adm-field-val">
            {editNama ? (
              <span className="adm-driver-edit-row">
                <input
                  className="adm-input-inline"
                  value={namaDraft}
                  onChange={(e) => setNamaDraft(e.target.value)}
                  placeholder="Nama lengkap driver"
                  autoFocus
                  data-testid={`adm-nama-input-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveNama} data-testid={`adm-nama-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditNama(false); setNamaDraft(order.nama_driver || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.nama_driver
                  ? <span className="adm-pill">{order.nama_driver}</span>
                  : <i className="adm-mute">belum diisi</i>}
                <button className="adm-link" onClick={() => setEditNama(true)} data-testid={`adm-nama-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>
        {order.trip_id && (
          <div className="adm-field-row adm-full">
            <div className="adm-field-key">Koordinator</div>
            <div className="adm-field-val">
              {activeKords.length > 0 ? (
                <span className="adm-driver-row">
                  <select
                    className="adm-input-inline"
                    value={kordDraft}
                    onChange={e => saveKord(e.target.value)}
                    disabled={kordSaving}
                    style={{ minWidth: 160 }}
                  >
                    <option value="">— Pilih koordinator —</option>
                    {activeKords.map(k => <option key={k.id} value={k.id}>{k.nama}</option>)}
                  </select>
                  {kordSaving && <span style={{ fontSize: 11, color: "#8b949e" }}>Menyimpan...</span>}
                  {!kordSaving && kordDraft && (
                    <span className="adm-pill" style={{ marginLeft: 4 }}>
                      {(kordList.find(k => k.id === kordDraft) || {}).nama || kordDraft}
                    </span>
                  )}
                  {!kordSaving && !kordDraft && order.koordinator && (
                    <span className="adm-mute" style={{ fontSize: 11, marginLeft: 4 }}>{order.koordinator}</span>
                  )}
                </span>
              ) : (
                <i className="adm-mute">
                  {order.koordinator || "belum ditugaskan"}
                </i>
              )}
            </div>
          </div>
        )}
        {Array.isArray(order.attachments) && order.attachments.length > 0 && (
          <div className="adm-field-row adm-full">
            <div className="adm-field-key">Berkas</div>
            <div className="adm-field-val" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {order.attachments.map((a, i) => (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="adm-pill"
                  style={{ textDecoration: "none", cursor: "pointer" }}
                  title={a.filename}
                >
                  📎 {a.filename || `Berkas ${i + 1}`}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <footer className="adm-card-foot">
        {order.status === "NEW" && (
          <button className="adm-btn adm-btn-gold adm-btn-sm" onClick={onConvert} data-testid={`adm-convert-${order.order_id}`}>
            <IcoTruck /> Konversi ke Trip
          </button>
        )}
        {order.status === "DISPATCHED" && (
          <button className="adm-btn adm-btn-blue adm-btn-sm" onClick={() => onPatch({ status: "ON_TRIP" })} data-testid={`adm-mark-ontrip-${order.order_id}`}>
            <IcoPlay /> Mark On-Trip
          </button>
        )}
        {order.status === "ON_TRIP" && (
          <button className="adm-btn adm-btn-green adm-btn-sm" onClick={() => onPatch({ status: "DELIVERED" })} data-testid={`adm-mark-delivered-${order.order_id}`}>
            <IcoCheck /> Mark Delivered
          </button>
        )}
        {order.trip_id && (
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onOpenLegs} data-testid={`adm-legs-${order.order_id}`}>
            <IcoRoute /> Rute Leg
          </button>
        )}
        {linkDriver && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkDriver} target="_blank" rel="noreferrer" data-testid={`adm-link-driver-${order.order_id}`}>Driver</a>}
        {linkTrack  && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkTrack}  target="_blank" rel="noreferrer" data-testid={`adm-link-track-${order.order_id}`}>Track</a>}
        {linkBastk  && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkBastk}  target="_blank" rel="noreferrer" data-testid={`adm-link-bastk-${order.order_id}`}>BASTK</a>}
        {order.trip_id && (
          <>
            <input ref={kapalFileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => uploadFotoKapal(e.target.files)} />
            <button className="adm-btn adm-btn-sm" onClick={() => kapalFileRef.current?.click()} disabled={uploadingKapal}
              style={{ background: "#1a3a5c", border: "1px solid #1f6feb", color: "#60a5fa" }}>
              {uploadingKapal ? "Uploading..." : "⚓ Upload Di Kapal"}
            </button>
          </>
        )}
        {order.trip_id && (
          <button className="adm-btn adm-btn-purple adm-btn-sm" onClick={() => onOdoo(order.order_id)} data-testid={`adm-odoo-${order.order_id}`}>
            <IcoOdoo /> Odoo
          </button>
        )}
        {!["DELIVERED","CANCELLED"].includes(order.status) && (
          <button className="adm-btn adm-btn-danger adm-btn-sm" onClick={() => { if (window.confirm("Batalkan order ini?")) onPatch({ status: "CANCELLED" }); }} data-testid={`adm-cancel-${order.order_id}`}>
            <IcoX /> Batal
          </button>
        )}
        <button
          className="adm-btn adm-btn-danger adm-btn-sm"
          style={{ background: "#791F1F", borderColor: "#A32D2D" }}
          onClick={() => { if (window.confirm(`Hapus PERMANEN order ${order.order_id}${order.trip_id ? " + trip-nya" : ""}? Tidak bisa dikembalikan.`)) onDelete(); }}
          data-testid={`adm-delete-${order.order_id}`}
        >
          <IcoTrash /> Hapus
        </button>
      </footer>
    </article>
  );
}

/* ════════════════════════════════════════
   CONVERT MODAL
════════════════════════════════════════ */
function ConvertModal({ order, onClose, onSubmit }) {
  const [driverId, setDriverId] = useState("");
  const [uj, setUj]   = useState("0");
  const [t1, setT1]   = useState("0");
  const [t2, setT2]   = useState("0");
  const [t3, setT3]   = useState("0");
  const [bd, setBd]   = useState("30000");
  const [bk, setBk]   = useState("150000");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    await onSubmit({
      driver_id: driverId.trim() || undefined,
      uj: parseInt(uj||"0",10), t1: parseInt(t1||"0",10),
      t2: parseInt(t2||"0",10), t3: parseInt(t3||"0",10),
      bonus_daily: parseInt(bd||"0",10), bonus_kerajinan: parseInt(bk||"0",10),
    });
    setSubmitting(false);
  };

  return (
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-convert-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">Konversi Pesanan ke Trip</div>
            <div className="adm-modal-sub">{order.order_id}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup"><IcoX /></button>
        </div>
        <div className="adm-modal-body">
          <div className="adm-modal-info">
            <strong>{order.customer_nama}</strong> &middot; {order.asal_kota} &rarr; {order.tujuan_kota}
            <br /><span className="adm-mute">{order.vehicle_type || "—"} {order.nopol || ""}</span>
          </div>
          <div className="adm-form-grid">
            <Field label="Driver ID" hint="Opsional. Bisa diisi nanti.">
              <input className="adm-input" value={driverId} onChange={(e) => setDriverId(e.target.value)} placeholder="DRV-001" data-testid="adm-modal-driver" />
            </Field>
            <Field label="Uang Jalan (UJ)">
              <input type="number" min="0" className="adm-input" value={uj} onChange={(e) => setUj(e.target.value)} data-testid="adm-modal-uj" />
            </Field>
            <Field label="Tahap 1 (T1)">
              <input type="number" min="0" className="adm-input" value={t1} onChange={(e) => setT1(e.target.value)} data-testid="adm-modal-t1" />
            </Field>
            <Field label="Tahap 2 (T2)">
              <input type="number" min="0" className="adm-input" value={t2} onChange={(e) => setT2(e.target.value)} data-testid="adm-modal-t2" />
            </Field>
            <Field label="Tahap 3 (T3)">
              <input type="number" min="0" className="adm-input" value={t3} onChange={(e) => setT3(e.target.value)} data-testid="adm-modal-t3" />
            </Field>
            <Field label="Bonus Harian">
              <input type="number" min="0" className="adm-input" value={bd} onChange={(e) => setBd(e.target.value)} />
            </Field>
            <Field label="Bonus Kerajinan">
              <input type="number" min="0" className="adm-input" value={bk} onChange={(e) => setBk(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={submitting}>Batal</button>
          <button className="adm-btn adm-btn-gold" onClick={submit} disabled={submitting} data-testid="adm-modal-submit">
            {submitting ? "Memproses..." : "Konversi Sekarang"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   ODOO MODAL
════════════════════════════════════════ */
function OdooModal({ order, orderId, headers, onClose }) {
  const [withInvoice, setWithInvoice] = useState(false);
  const [price, setPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { message, odoo_url }
  const [err, setErr] = useState("");

  const priceNum = parseInt((price || "").replace(/[^0-9]/g, ""), 10) || 0;
  const priceFmt = priceNum ? priceNum.toLocaleString("id-ID") : "";

  const doSync = async () => {
    setLoading(true); setErr("");
    try {
      const r = await axios.post(
        `${API}/admin/orders/${orderId}/odoo-sync`,
        { with_invoice: withInvoice, price: priceNum },
        { headers }
      );
      setResult(r.data);
    } catch (e) {
      setErr("Error: " + (e?.response?.data?.detail || "gagal"));
    } finally { setLoading(false); }
  };

  const openOdoo = () => {
    if (result?.odoo_url) window.open(result.odoo_url, "_blank", "noopener");
    onClose();
  };

  const label = order
    ? `${order.order_id} - ${order.customer_nama || "—"}`
    : orderId;

  return (
    <div className="adm-modal-bg" onClick={!loading ? onClose : undefined} data-testid="adm-odoo-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">Kirim ke Odoo</div>
            <div className="adm-modal-sub">{label}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup" disabled={loading}><IcoX /></button>
        </div>
        <div className="adm-modal-body">
          {!result ? (
            <>
              {order && (
                <div className="adm-modal-info" style={{ marginBottom:14 }}>
                  <strong>{order.vehicle_type || "Kendaraan"}</strong> · {order.asal_kota || "—"} &rarr; {order.tujuan_kota || "—"}
                  {order.nopol ? <span className="adm-mute"> · {order.nopol}</span> : null}
                </div>
              )}
              <label style={{ display:"block", marginBottom:14 }}>
                <span style={{ display:"block", fontSize:12, color:"var(--text-3)", marginBottom:5, fontWeight:700 }}>Harga Jual (Rp)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="adm-input"
                  value={priceFmt}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="contoh: 30.380.000"
                  data-testid="adm-odoo-price"
                />
                <span style={{ display:"block", fontSize:11, color:"var(--text-3)", marginTop:4 }}>
                  Harga yang disepakati pelanggan. Kosongkan kalau mau isi manual di Odoo.
                </span>
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, cursor:"pointer" }}>
                <input type="checkbox" checked={true} readOnly style={{ accentColor:"#7c3aed", width:16, height:16 }} />
                <span>Sales Order — PO jadi SO di Odoo</span>
              </label>
              <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                <input type="checkbox" checked={withInvoice} onChange={(e) => setWithInvoice(e.target.checked)} style={{ accentColor:"#7c3aed", width:16, height:16 }} />
                <span>Customer Invoice — Tagihan ke pelanggan</span>
              </label>
              {err && <div style={{ marginTop:12, color:"#ef4444", fontSize:13 }}>{err}</div>}
            </>
          ) : (
            <>
              <div style={{ color:"#22c55e", fontWeight:700, fontSize:14, marginBottom:8 }}>
                ✓ {result.message}
              </div>
              {result.steps?.map((s, i) => (
                <div key={i} style={{ fontSize:12, color:"var(--text-3)", marginBottom:4 }}>• {s}</div>
              ))}
            </>
          )}
        </div>
        <div className="adm-modal-foot">
          {!result ? (
            <>
              <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={loading}>Batal</button>
              <button className="adm-btn adm-btn-purple" onClick={doSync} disabled={loading}>
                {loading ? "Mengirim..." : "Kirim Sekarang"}
              </button>
            </>
          ) : (
            <>
              <button className="adm-btn adm-btn-ghost" onClick={onClose}>Tutup</button>
              {result.odoo_url && (
                <button className="adm-btn adm-btn-purple" onClick={openOdoo}>
                  Selesai — Buka di Odoo
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DRIVER AUTOCOMPLETE
════════════════════════════════════════ */
function DriverAutocomplete({ value, hp, onChange, onSelect, headers }) {
  const [q, setQ] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [timer, setTimer] = useState(null);

  const search = (val) => {
    setQ(val);
    onChange(val, hp);
    if (timer) clearTimeout(timer);
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/drivers`, { params: { q: val }, headers });
        setResults(r.data.items || []);
        setOpen(true);
      } catch { setResults([]); }
    }, 300);
    setTimer(t);
  };

  const pick = (drv) => {
    setQ(drv.nama);
    setResults([]);
    setOpen(false);
    onSelect(drv.nama, drv.no_hp || "");
  };

  const IL2 = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "5px 8px", color: "#e6edf3", fontSize: 11, outline: "none", width: "100%" };
  return (
    <div style={{ position: "relative" }}>
      <input
        style={IL2}
        value={q}
        onChange={e => search(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Cari nama driver..."
      />
      {hp && <div style={{ fontSize: 10, color: "#60a5fa", marginTop: 3 }}>HP: {hp}</div>}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 5, zIndex: 100, maxHeight: 160, overflowY: "auto" }}>
          {results.map(drv => (
            <div
              key={drv.driver_id}
              onMouseDown={() => pick(drv)}
              style={{ padding: "6px 10px", cursor: "pointer", fontSize: 11, borderBottom: "1px solid #21262d" }}
            >
              <span style={{ color: "#e6edf3" }}>{drv.nama}</span>
              {drv.no_hp && <span style={{ color: "#8b949e", marginLeft: 8 }}>{drv.no_hp}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   LEGS MODAL
════════════════════════════════════════ */
const LEG_TIPE = ["Self Drive", "Kapal RoRo", "Kapal Kontainer", "Car Carrier", "Towing", "Self Loader", "Lainnya"];
const LEG_STATUS = ["Menunggu", "Berlangsung", "Selesai"];

function LegsModal({ tripId, order, onClose, onSave, headers }) {
  const [legs, setLegs] = useState(() => {
    if (Array.isArray(order?.legs) && order.legs.length > 0) return order.legs;
    return [
      { tipe: "Self Drive", asal: order?.asal_kota || "", tujuan: "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_bayangan: "", kord_bayangan_hp: "" },
      { tipe: "Kapal RoRo",  asal: "", tujuan: "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_kapal: "", kord_kapal_hp: "" },
      { tipe: "Self Drive", asal: "", tujuan: order?.tujuan_kota || "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_bayangan: "", kord_bayangan_hp: "" },
    ];
  });
  const [saving, setSaving] = useState(false);
  const [copiedLeg, setCopiedLeg] = useState(null);
  const [multiUnitModal, setMultiUnitModal] = useState(null); // { leg, selectedOrders: [] }
  const [multiUnitSearch, setMultiUnitSearch] = useState("");
  const [allOrders, setAllOrders] = useState([]);

  // Load semua orders untuk pilih multi-unit
  const openMultiUnit = async (leg) => {
    try {
      const r = await axios.get(`${API}/admin/orders`, { headers });
      setAllOrders(r.data?.items || r.data || []);
    } catch {}
    setMultiUnitModal({ leg, selected: [{ nopol: order?.nopol, vehicle_type: order?.vehicle_type, no_rangka: order?.no_rangka, warna: order?.warna }] });
  };

  const printKartuMuatMulti = (leg, units) => {
    const tgl = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const eta = leg.eta ? new Date(leg.eta).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";
    const unitRows = units.map((u, idx) => `
      <tr>
        <td style="padding:8px 10px;font-weight:900;font-size:13px">${idx+1}</td>
        <td style="padding:8px 10px;font-weight:800">${u.nopol || u.vehicle_type || "—"}</td>
        <td style="padding:8px 10px">${u.vehicle_type || "—"}</td>
        <td style="padding:8px 10px;font-size:11px;color:#555">${u.no_rangka || "—"}</td>
        <td style="padding:8px 10px">${u.warna || "—"}</td>
      </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kartu Muat</title>
    <style>
      body{font-family:Arial,sans-serif;margin:0;padding:12px;background:#fff;color:#1a1a1a}
      .head{background:#1a1a2e;color:#fff;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-radius:8px 8px 0 0}
      .head-title{color:#fff;font-size:14px;font-weight:800;letter-spacing:1px}
      .head-sub{color:#fff8e1;font-size:10px;margin-top:2px}
      .marking-box{background:#1a1a2e;padding:12px 16px;text-align:center;border-bottom:2px dashed #BA7517}
      .marking-lbl{font-size:10px;color:#aaa;letter-spacing:2px;text-transform:uppercase}
      .marking-val{font-size:32px;font-weight:900;color:#FFD060;letter-spacing:4px;font-family:monospace}
      .kapal-val{font-size:14px;color:#e0e0e0;margin-top:4px;font-weight:700}
      .route-box{background:#fffbe6;border:1px solid #ffe066;border-radius:6px;padding:8px 14px;margin:10px 14px;text-align:center}
      .route-txt{font-size:14px;font-weight:900;color:#7a5700}
      table{width:100%;border-collapse:collapse;margin:10px 0}
      th{background:#f5f5f5;padding:8px 10px;text-align:left;font-size:11px;color:#555;border-bottom:2px solid #ddd}
      tr:nth-child(even){background:#fafafa}
      .foot{background:#f8f8f8;padding:8px 16px;font-size:10px;color:#888;text-align:center;border-top:1px solid #eee;margin-top:8px}
      @media print{@page{margin:8mm;size:A5 landscape}body{padding:0}}
    </style></head><body>
    <div class="head">
      <div><div class="head-title">PT ALYSSA AUTO LOGISTIK</div><div class="head-sub">KARTU MUAT KENDARAAN — ${units.length} UNIT</div></div>
      <div style="color:#fff8e1;font-size:10px;text-align:right">${tgl}</div>
    </div>
    <div class="marking-box">
      <div class="marking-lbl">MARKING / KODE EKSPEDISI</div>
      <div class="marking-val">${leg.marking || "—"}</div>
      <div class="kapal-val">⚓ ${leg.kapal || "Nama kapal belum diisi"}</div>
    </div>
    <div class="route-box">
      <div class="route-txt">${leg.asal || "—"} &nbsp;→&nbsp; ${leg.tujuan || "—"}</div>
      <div style="font-size:11px;color:#a07000;margin-top:2px">Estimasi Tiba: ${eta} &nbsp;·&nbsp; Total: ${units.length} unit</div>
    </div>
    <table>
      <thead><tr><th>#</th><th>No. Polisi</th><th>Tipe Kendaraan</th><th>No. Rangka</th><th>Warna</th></tr></thead>
      <tbody>${unitRows}</tbody>
    </table>
    <div class="foot">Pengirim: PT. ALYSSA AUTO LOGISTIK &nbsp;·&nbsp; Hub admin: 0818 631 135 &nbsp;·&nbsp; Siapkan area penerimaan sebelum kapal tiba</div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
    setMultiUnitModal(null);
  };

  const printKartuMuat = (leg, ord) => {
    const tgl = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const eta = leg.eta ? new Date(leg.eta).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "—";
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kartu Muat</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; background: #fff; padding: 20px; }
      .card { border: 3px solid #BA7517; border-radius: 12px; max-width: 420px; margin: 0 auto; overflow: hidden; }
      .head { background: #BA7517; padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; }
      .head-title { color: #fff; font-size: 13px; font-weight: 800; letter-spacing: 1px; }
      .head-sub { color: #fff8e1; font-size: 10px; margin-top: 2px; }
      .marking-box { background: #1a1a2e; padding: 16px 18px; text-align: center; border-bottom: 2px dashed #BA7517; }
      .marking-lbl { font-size: 10px; color: #aaa; letter-spacing: 2px; text-transform: uppercase; }
      .marking-val { font-size: 36px; font-weight: 900; color: #FFD060; letter-spacing: 4px; margin-top: 4px; font-family: monospace; }
      .kapal-val { font-size: 15px; color: #e0e0e0; margin-top: 6px; font-weight: 700; }
      .body { padding: 16px 18px; }
      .row { display: flex; justify-content: space-between; padding: 7px 0; border-bottom: 1px solid #f0f0f0; }
      .row:last-child { border-bottom: none; }
      .rk { font-size: 11px; color: #888; }
      .rv { font-size: 12px; font-weight: 800; color: #1a1a1a; text-align: right; max-width: 60%; }
      .route-box { background: #fffbe6; border: 1px solid #ffe066; border-radius: 7px; padding: 10px 14px; margin: 12px 0 4px; text-align: center; }
      .route-txt { font-size: 14px; font-weight: 900; color: #7a5700; letter-spacing: .5px; }
      .eta-txt { font-size: 11px; color: #a07000; margin-top: 3px; }
      .foot { background: #f8f8f8; padding: 10px 18px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #eee; }
      @media print { @page { margin: 10mm; size: A6 portrait; } body { padding: 0; } }
    </style></head><body>
    <div class="card">
      <div class="head">
        <div>
          <div class="head-title">PT ALYSSA AUTO LOGISTIK</div>
          <div class="head-sub">KARTU MUAT KENDARAAN</div>
        </div>
        <div style="color:#fff8e1;font-size:10px;text-align:right">${tgl}</div>
      </div>
      <div class="marking-box">
        <div class="marking-lbl">MARKING / KODE EKSPEDISI</div>
        <div class="marking-val">${leg.marking || "—"}</div>
        <div class="kapal-val">⚓ ${leg.kapal || "Nama kapal belum diisi"}</div>
      </div>
      <div class="body">
        <div class="route-box">
          <div class="route-txt">${leg.asal || "—"} &nbsp;→&nbsp; ${leg.tujuan || "—"}</div>
          <div class="eta-txt">Estimasi Tiba: ${eta}</div>
        </div>
        <div class="row"><span class="rk">Tipe Kendaraan</span><span class="rv">${ord?.vehicle_type || "—"}</span></div>
        <div class="row"><span class="rk">No. Polisi</span><span class="rv">${ord?.nopol || "—"}</span></div>
        <div class="row"><span class="rk">No. Rangka</span><span class="rv">${ord?.no_rangka || "—"}</span></div>
        <div class="row"><span class="rk">Warna</span><span class="rv">${ord?.warna || "—"}</span></div>
        <div class="row"><span class="rk">Pengirim</span><span class="rv">PT. ALYSSA AUTO LOGISTIK</span></div>
      </div>
      <div class="foot">Siapkan area penerimaan sebelum kapal tiba &nbsp;·&nbsp; Hub admin: 0818 631 135</div>
    </div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  };

  const copyLegLink = (leg, i) => {
    const base = window.location.origin;
    const p = new URLSearchParams({
      trip: tripId,
      nopol: order?.nopol || order?.vehicle_type || "",
      driver: leg.driver || `Driver Leg ${i + 1}`,
      route: `${leg.asal} → ${leg.tujuan}`,
      tipe: leg.tipe,
    });
    if (order?.no_rangka) p.set("rangka", order.no_rangka);
    const link = `${base}/trip/${tripId}?${p.toString()}`;
    const isKapal = leg.tipe && leg.tipe.startsWith("Kapal");
    const namaDriver = leg.driver || `Driver Leg ${i + 1}`;
    const rute = `${leg.asal || "—"} → ${leg.tujuan || "—"}`;
    const nopol = order?.nopol || order?.vehicle_type || "";

    let panduan;
    if (isKapal) {
      panduan = `1. Foto kendaraan 5 sisi sebelum berangkat\n2. Foto mobil di dalam pelabuhan`;
    } else {
      panduan = `1. Foto kendaraan 5 sisi sebelum berangkat\n2. Foto checkpoint tiap hari jam 06.00–18.00 WIB`;
    }

    const teks = `Halo Pak ${namaDriver} 👋\n\nPengiriman: ${rute}\nKendaraan: ${nopol}\n\n🔗 ${link}\n\nPanduan:\n${panduan}\n\nInfo: PT Alyssa Auto Logistik · 0818 631 135`;

    navigator.clipboard.writeText(teks);
    setCopiedLeg(i);
    setTimeout(() => setCopiedLeg(null), 2000);
  };

  const setLeg = (i, patch) => setLegs(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLeg = () => setLegs(ls => [...ls, { tipe: "Self Drive", asal: "", tujuan: "", kapal: "", eta: "", status: "Menunggu" }]);
  const delLeg = (i) => setLegs(ls => ls.filter((_, idx) => idx !== i));
  const moveLeg = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= legs.length) return;
    const arr = [...legs]; [arr[i], arr[j]] = [arr[j], arr[i]]; setLegs(arr);
  };

  const submit = async () => { setSaving(true); await onSave(legs); setSaving(false); };

  const IL = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, padding: "5px 8px", color: "#e6edf3", fontSize: 11, outline: "none", width: "100%" };
  const TIPE_ICON = { "Self Drive": "🚗", "Kapal RoRo": "🚢", "Kapal Kontainer": "🚢", "Car Carrier": "🚛", "Towing": "🔗", "Self Loader": "🏗", "Lainnya": "📦" };

  return (
    <>
    <div className="adm-modal-bg" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title"><IcoRoute /> Atur Rute Leg</div>
            <div className="adm-modal-sub">{tripId} · {order?.asal_kota} → {order?.tujuan_kota}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose}><IcoX /></button>
        </div>
        <div className="adm-modal-body">
          {legs.map((leg, i) => (
            <div key={i} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 8, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 16 }}>{TIPE_ICON[leg.tipe] || "📦"}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#EF9F27" }}>Leg {i + 1}</span>
                <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
                  <button onClick={() => moveLeg(i, -1)} disabled={i === 0} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 11 }}>↑</button>
                  <button onClick={() => moveLeg(i, 1)} disabled={i === legs.length - 1} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 11 }}>↓</button>
                  <button onClick={() => delLeg(i)} style={{ background: "none", border: "1px solid #f85149", color: "#f85149", borderRadius: 4, padding: "2px 6px", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: "#8b949e" }}>Tipe
                  <select style={{ ...IL, marginTop: 2 }} value={leg.tipe} onChange={e => setLeg(i, { tipe: e.target.value })}>
                    {LEG_TIPE.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 10, color: "#8b949e" }}>Status
                  <select style={{ ...IL, marginTop: 2 }} value={leg.status} onChange={e => setLeg(i, { status: e.target.value })}>
                    {LEG_STATUS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 10, color: "#8b949e" }}>ETA
                  <input type="date" style={{ ...IL, marginTop: 2 }} value={leg.eta} onChange={e => setLeg(i, { eta: e.target.value })} />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                <label style={{ fontSize: 10, color: "#8b949e" }}>Asal
                  <input style={{ ...IL, marginTop: 2 }} value={leg.asal} onChange={e => setLeg(i, { asal: e.target.value })} placeholder="Pelabuhan / Kota" />
                </label>
                <label style={{ fontSize: 10, color: "#8b949e" }}>Tujuan
                  <input style={{ ...IL, marginTop: 2 }} value={leg.tujuan} onChange={e => setLeg(i, { tujuan: e.target.value })} placeholder="Pelabuhan / Kota" />
                </label>
              </div>
              {(leg.tipe.startsWith("Kapal") || leg.tipe === "Car Carrier" || leg.tipe === "Towing") && (
                <div style={{ background: "#0d1a2d", border: "1px solid #1f3a5a", borderRadius: 7, padding: "10px 10px 8px", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 8 }}>INFO KAPAL / EKSPEDISI</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>Nama Kapal
                      <input style={{ ...IL, marginTop: 2 }} value={leg.kapal || ""} onChange={e => setLeg(i, { kapal: e.target.value })} placeholder="KM Mutiara Persada" />
                    </label>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>Marking / Kode Ekspedisi
                      <input style={{ ...IL, marginTop: 2 }} value={leg.marking || ""} onChange={e => setLeg(i, { marking: e.target.value })} placeholder="AAL-001 / JKT-MKS" />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <button type="button" onClick={() => printKartuMuat(leg, order)}
                      style={{ padding: "7px", borderRadius: 6, border: "none", background: "#1f6feb", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                      🖨️ 1 Unit
                    </button>
                    <button type="button" onClick={() => openMultiUnit(leg)}
                      style={{ padding: "7px", borderRadius: 6, border: "1px solid #1f6feb", background: "transparent", color: "#60a5fa", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                      📋 Multi Unit
                    </button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>Koordinator Kapal
                      <input style={{ ...IL, marginTop: 2 }} value={leg.kord_kapal || ""} onChange={e => setLeg(i, { kord_kapal: e.target.value })} placeholder="Nama koordinator kapal" />
                    </label>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>HP Koordinator Kapal
                      <input style={{ ...IL, marginTop: 2 }} value={leg.kord_kapal_hp || ""} onChange={e => setLeg(i, { kord_kapal_hp: e.target.value })} placeholder="08xx-xxxx" />
                    </label>
                  </div>
                </div>
              )}
              {/* Field driver + link hanya untuk leg yang dikemudikan orang */}
              {!leg.tipe.startsWith("Kapal") && leg.tipe !== "Kapal RoRo" && (
                <div style={{ marginTop: 6, padding: "8px 10px", background: "#0a1628", border: "1px solid #1f3a5a", borderRadius: 6 }}>
                  <label style={{ fontSize: 10, color: "#60a5fa", display: "block", marginBottom: 4, fontWeight: 700 }}>NAMA DRIVER LEG INI</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <DriverAutocomplete
                        value={leg.driver || ""}
                        hp={leg.driver_hp || ""}
                        onChange={(val, prevHp) => setLeg(i, { driver: val })}
                        onSelect={(nama, hp) => setLeg(i, { driver: nama, driver_hp: hp })}
                        headers={headers}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => copyLegLink(leg, i)}
                      disabled={!tripId}
                      style={{ padding: "5px 10px", borderRadius: 5, border: "none", background: copiedLeg === i ? "#2ea043" : "#1f6feb", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", alignSelf: "flex-start" }}>
                      {copiedLeg === i ? "✓ Tersalin!" : "Salin Link"}
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: "#4a6fa5", marginTop: 4 }}>Kirim link ini ke driver yang bertugas di leg {i + 1}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>Koordinator Bayangan
                      <input style={{ ...IL, marginTop: 2 }} value={leg.kord_bayangan || ""} onChange={e => setLeg(i, { kord_bayangan: e.target.value })} placeholder="Nama · 0812-xxxx (agen/pawang driver)" />
                    </label>
                    <label style={{ fontSize: 10, color: "#8b949e" }}>HP Koordinator Bayangan
                      <input style={{ ...IL, marginTop: 2 }} value={leg.kord_bayangan_hp || ""} onChange={e => setLeg(i, { kord_bayangan_hp: e.target.value })} placeholder="08xx-xxxx" />
                    </label>
                  </div>
                </div>
              )}
            </div>
          ))}
          <button onClick={addLeg} style={{ width: "100%", padding: "8px", border: "1px dashed #30363d", borderRadius: 7, background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12 }}>+ Tambah Leg</button>
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={saving}>Batal</button>
          <button className="adm-btn adm-btn-gold" onClick={submit} disabled={saving}>
            {saving ? "Menyimpan..." : "Simpan Rute"}
          </button>
        </div>
      </div>
    </div>

    {/* Modal pilih multi-unit untuk Kartu Muat */}
    {multiUnitModal && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>📋 Kartu Muat Multi-Unit</div>
              <div style={{ color: "#8b949e", fontSize: 11, marginTop: 2 }}>Pilih unit yang ikut di kapal yang sama</div>
            </div>
            <button onClick={() => setMultiUnitModal(null)} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 18 }}>✕</button>
          </div>
          <div style={{ background: "#0d1117", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 11, color: "#60a5fa" }}>
            ⚓ {multiUnitModal.leg.kapal || "—"} &nbsp;|&nbsp; {multiUnitModal.leg.asal} → {multiUnitModal.leg.tujuan} &nbsp;|&nbsp; Marking: <b>{multiUnitModal.leg.marking || "—"}</b>
          </div>
          <input
            value={multiUnitSearch}
            onChange={e => setMultiUnitSearch(e.target.value)}
            placeholder="Cari nopol (B 9564) atau 5 digit rangka (21258)..."
            style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: "1px solid #30363d", background: "#0d1117", color: "#e6edf3", fontSize: 12, marginBottom: 10, boxSizing: "border-box" }}
          />
          {/* Counter + reset */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#8b949e" }}>Dipilih: <b style={{ color: "#3fb950" }}>{multiUnitModal.selected.length} unit</b></div>
            {multiUnitModal.selected.length > 1 && (
              <button onClick={() => setMultiUnitModal(m => ({ ...m, selected: [m.selected[0]] }))}
                style={{ background: "none", border: "1px solid #f85149", borderRadius: 5, color: "#f85149", fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>
                Reset Pilihan
              </button>
            )}
          </div>
          {/* Unit yang sedang dibuka — selalu masuk */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 6, letterSpacing: 1 }}>UNIT AKTIF (otomatis masuk)</div>
            <div style={{ background: "#0d2a0d", border: "1px solid #238636", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "#3fb950" }}>
              ✓ {order?.nopol || order?.vehicle_type} &nbsp;·&nbsp; {order?.vehicle_type} &nbsp;·&nbsp; Rangka: {order?.no_rangka || "—"}
            </div>
          </div>
          {/* Pilih unit lain */}
          <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 6, letterSpacing: 1 }}>TAMBAH UNIT LAIN</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            {(() => {
              const selNopols = new Set(multiUnitModal.selected.map(s => s.nopol).filter(Boolean));
              const baseList = allOrders.filter(o => o.nopol && o.nopol !== order?.nopol);
              const q = multiUnitSearch.trim().toLowerCase().replace(/\s/g, "");
              const matchQ = (o) => {
                if (!q) return true;
                const nopol = (o.nopol || "").toLowerCase().replace(/\s/g, "");
                const rangka = (o.no_rangka || "").toLowerCase();
                return nopol.includes(q) || rangka.slice(-5).includes(q) || rangka.includes(q);
              };
              const selectedList = baseList.filter(o => selNopols.has(o.nopol));
              const unselectedList = baseList.filter(o => !selNopols.has(o.nopol) && matchQ(o));
              const renderItem = (o) => {
                const isSel = selNopols.has(o.nopol);
                return (
                  <div key={o.nopol} onClick={() => {
                    setMultiUnitModal(m => ({
                      ...m,
                      selected: isSel
                        ? m.selected.filter(s => s.nopol !== o.nopol)
                        : [...m.selected, { nopol: o.nopol, vehicle_type: o.vehicle_type, no_rangka: o.no_rangka, warna: o.warna }]
                    }));
                  }} style={{ cursor: "pointer", background: isSel ? "#0d2a0d" : "#0d1117", border: `1px solid ${isSel ? "#238636" : "#21262d"}`, borderRadius: 7, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <div>
                      <span style={{ color: isSel ? "#3fb950" : "#e6edf3", fontWeight: 700, fontSize: 12 }}>{o.nopol}</span>
                      <span style={{ color: "#8b949e", fontSize: 11, marginLeft: 8 }}>{o.vehicle_type}</span>
                      <div style={{ color: "#6e7681", fontSize: 10, marginTop: 2 }}>Rangka: {o.no_rangka || "—"} &nbsp;·&nbsp; {o.pelanggan || ""}</div>
                    </div>
                    <div style={{ fontSize: 16, color: isSel ? "#3fb950" : "#8b949e", fontWeight: 700 }}>{isSel ? "✓" : "+"}</div>
                  </div>
                );
              };
              return (
                <>
                  {selectedList.length > 0 && <div style={{ fontSize: 10, color: "#3fb950", marginBottom: 4, letterSpacing: 1, fontWeight: 700 }}>✓ SUDAH DIPILIH</div>}
                  {selectedList.map(renderItem)}
                  {unselectedList.length > 0 && <div style={{ fontSize: 10, color: "#8b949e", margin: "8px 0 4px", letterSpacing: 1 }}>{q ? "HASIL PENCARIAN" : "SEMUA ORDER"}</div>}
                  {unselectedList.map(renderItem)}
                  {selectedList.length === 0 && unselectedList.length === 0 && <div style={{ color: "#6e7681", fontSize: 12, textAlign: "center", padding: 16 }}>Tidak ada order ditemukan</div>}
                </>
              );
            })()}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setMultiUnitModal(null)} style={{ flex: 1, padding: "9px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12 }}>Batal</button>
            <button onClick={() => printKartuMuatMulti(multiUnitModal.leg, multiUnitModal.selected)}
              style={{ flex: 2, padding: "9px", borderRadius: 7, border: "none", background: "#1f6feb", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
              🖨️ Cetak {multiUnitModal.selected.length} Unit
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}


function Field({ label, hint, children }) {
  return (
    <label className="adm-field">
      <span className="adm-field-lbl">{label}</span>
      {children}
      {hint && <span className="adm-field-hint">{hint}</span>}
    </label>
  );
}

/* ════════════════════════════════════════
   KOORDINATOR MANAGEMENT TAB
════════════════════════════════════════ */
function KordManageTab({ headers }) {
  const [kords, setKords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newNama, setNewNama] = useState("");
  const [newPw, setNewPw] = useState("");
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [resetId, setResetId] = useState(null);
  const [resetPw, setResetPw] = useState("");
  const [toast, setToast] = useState("");
  const [copied, setCopied] = useState(false);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2400); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/koordinators`, { headers });
      setKords(r.data.items || []);
    } catch {} finally { setLoading(false); }
  }, [headers]);

  useEffect(() => { load(); }, [load]);

  const addKord = async () => {
    setAddErr("");
    if (!newNama.trim()) { setAddErr("Nama diperlukan"); return; }
    if (!newPw) { setAddErr("Password diperlukan"); return; }
    setAdding(true);
    try {
      await axios.post(`${API}/admin/koordinators`, { nama: newNama.trim(), password: newPw }, { headers });
      setNewNama(""); setNewPw("");
      flash("Koordinator ditambahkan");
      await load();
    } catch (e) {
      setAddErr(e?.response?.data?.detail || "Gagal menambahkan");
    } finally { setAdding(false); }
  };

  const deactivate = async (id) => {
    if (!window.confirm("Nonaktifkan koordinator ini?")) return;
    try {
      await axios.delete(`${API}/admin/koordinators/${id}`, { headers });
      flash("Dinonaktifkan");
      await load();
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const doResetPw = async (id) => {
    if (!resetPw) { flash("Isi password baru dulu"); return; }
    try {
      await axios.post(`${API}/admin/koordinators/${id}/reset-password`, { password: resetPw }, { headers });
      flash("Password direset");
      setResetId(null); setResetPw("");
    } catch (e) { flash("Gagal: " + (e?.response?.data?.detail || "error")); }
  };

  const portalUrl = `${window.location.origin}/koordinator`;

  const IL = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "8px 10px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%" };

  return (
    <div style={{ maxWidth: 700, margin: "20px auto", padding: "0 16px" }}>
      {/* Link portal */}
      <div style={{ background: "#1a2d4a", border: "1px solid #1f6feb", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontSize: 13, color: "#60a5fa", fontWeight: 700 }}>🔗 Portal Koordinator:</span>
        <code style={{ flex: 1, fontSize: 13, color: "#e6edf3", background: "#0d1117", padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", wordBreak: "break-all" }}>{portalUrl}</code>
        <button onClick={() => { navigator.clipboard.writeText(portalUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #1f6feb", background: "none", color: copied ? "#2ea043" : "#60a5fa", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
          {copied ? "✓ Tersalin" : "📋 Salin"}
        </button>
      </div>

      {/* Add form */}
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: "18px 20px", marginBottom: 20 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#EF9F27", marginBottom: 14 }}>Tambah Koordinator</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>Nama</div>
            <input style={IL} value={newNama} onChange={e => setNewNama(e.target.value)} placeholder="Nama koordinator" />
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>Password</div>
            <input style={IL} type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Password awal" onKeyDown={e => e.key === "Enter" && addKord()} />
          </div>
        </div>
        {addErr && <div style={{ color: "#f85149", fontSize: 12, marginBottom: 8 }}>{addErr}</div>}
        <button onClick={addKord} disabled={adding} style={{ padding: "8px 20px", background: "#EF9F27", color: "#0d1117", border: "none", borderRadius: 7, fontWeight: 800, fontSize: 13, cursor: "pointer", opacity: adding ? 0.6 : 1 }}>
          {adding ? "Menambahkan..." : "+ Tambah"}
        </button>
      </div>

      {/* List */}
      <div style={{ fontSize: 13, fontWeight: 800, color: "#8b949e", marginBottom: 10 }}>
        Daftar Koordinator {loading ? "(memuat...)" : `(${kords.length})`}
      </div>
      {kords.map(k => (
        <div key={k.id} style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "12px 16px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#e6edf3" }}>{k.nama}</span>
              <span style={{ marginLeft: 10, fontSize: 11, color: k.aktif ? "#2ea043" : "#f85149", background: k.aktif ? "#0a2a14" : "#2a0a0a", border: `1px solid ${k.aktif ? "#2ea04344" : "#f8514944"}`, borderRadius: 4, padding: "2px 7px", fontWeight: 700 }}>
                {k.aktif ? "Aktif" : "Nonaktif"}
              </span>
              {k.first_login && <span style={{ marginLeft: 6, fontSize: 10, color: "#d29922", background: "#2a1e00", border: "1px solid #d2992244", borderRadius: 4, padding: "2px 6px" }}>Belum login</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setResetId(resetId === k.id ? null : k.id); setResetPw(""); }}
                style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                Reset PW
              </button>
              {k.aktif && (
                <button onClick={() => deactivate(k.id)} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid #f85149", background: "none", color: "#f85149", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                  Nonaktifkan
                </button>
              )}
            </div>
          </div>
          {resetId === k.id && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...IL, flex: 1 }}
                type="text"
                placeholder="Password baru"
                value={resetPw}
                onChange={e => setResetPw(e.target.value)}
                onKeyDown={e => e.key === "Enter" && doResetPw(k.id)}
                autoFocus
              />
              <button onClick={() => doResetPw(k.id)} style={{ padding: "8px 14px", borderRadius: 6, border: "none", background: "#EF9F27", color: "#0d1117", cursor: "pointer", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>Simpan</button>
              <button onClick={() => setResetId(null)} style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12 }}>Batal</button>
            </div>
          )}
        </div>
      ))}
      {!loading && kords.length === 0 && (
        <div style={{ textAlign: "center", padding: "30px 0", color: "#8b949e", fontSize: 13 }}>Belum ada koordinator.</div>
      )}
      {toast && <div className="adm-toast">{toast}</div>}
    </div>
  );
}
