/* eslint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { VEHICLE_TYPE_LIST } from "@/VehicleSketches";
import CostCalculator from "@/CostCalculator";
import DriverData from "@/DriverData";
import SupplierPage from "@/SupplierPage";
import SelisihPage from "@/SelisihPage";
import KompensasiPage from "@/KompensasiPage";
import MobileVendorPayment from "@/MobileVendorPayment";
import PermintaanHargaPage from "@/PermintaanHargaPage";
import { DOC_BRAND, DOC_BASE_CSS, docHeader, docFooter, terbilangRupiah, nextDocNo } from "@/docTheme";
import "@/App.css";
import "@/Driver.css";
import "@/Admin.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const PIN_KEY = "aal_admin_pin";

// navigator.clipboard.writeText() silently rejects on some mobile browsers /
// in-app webviews (no permission prompt, no error shown) -- callers that
// don't await it end up showing "✓ Copied" even though nothing was copied.
// Tries the modern Clipboard API first, then falls back to a hidden
// execCommand("copy") textarea (kept ON-SCREEN but invisible -- some mobile
// browsers can't select/copy an element positioned off-screen), then as a
// last resort a prompt with the text pre-selected so the user can copy
// manually. Returns true only when a copy actually happened.
function tryExecCommandCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari needs this explicitly
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  if (tryExecCommandCopy(text)) return true;
  window.prompt("Nggak bisa auto-copy di browser ini. Salin manual teks di bawah:", text);
  return false;
}

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

const fmtRp = (n) => {
  if (n == null || n === "" || isNaN(Number(n))) return "—";
  return "Rp " + Number(n).toLocaleString("id-ID");
};

const fmtDateShort = (s) => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return "—"; }
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
const IcoGift     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="8" width="18" height="4"/><rect x="5" y="12" width="14" height="9"/><line x1="12" y1="8" x2="12" y2="21"/><path d="M12 8c-1.5-3-5-4-5 0"/><path d="M12 8c1.5-3 5-4 5 0"/></svg>;
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
  const [driverFilter, setDriverFilter] = useState("");
  const [custFilter, setCustFilter] = useState(""); // pilih konsumen dari dropdown (nggak usah ngetik)
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [convertModal, setConvertModal] = useState(null);
  const [odooModal, setOdooModal] = useState(null);
  const [legsModal, setLegsModal] = useState(null);
  const [bonusModal, setBonusModal] = useState(null);
  const [toast, setToast] = useState("");
  // Keranjang unit lintas-PO → Jadwal Pengiriman Gabungan
  const [jadwalCart, setJadwalCart] = useState([]); // [{order_id, customer_nama, asal_kota, tujuan_kota, unit}]
  const [showJadwalGab, setShowJadwalGab] = useState(false);
  const [showInvoiceGab, setShowInvoiceGab] = useState(false);
  const cartHas = useCallback((uid) => jadwalCart.some((c) => c.unit?.unit_id === uid), [jadwalCart]);
  const toggleCartUnit = useCallback((order, unit) => {
    setJadwalCart((c) => c.some((x) => x.unit?.unit_id === unit.unit_id)
      ? c.filter((x) => x.unit?.unit_id !== unit.unit_id)
      : [...c, { order_id: order.order_id, customer_nama: order.customer_nama, asal_kota: order.asal_kota, tujuan_kota: order.tujuan_kota, unit }]);
  }, []);
  const cartSetOrderUnits = useCallback((order, add) => {
    const units = Array.isArray(order.units) ? order.units : [];
    setJadwalCart((c) => {
      const others = c.filter((x) => x.order_id !== order.order_id);
      if (!add) return others;
      const rows = units.map((unit) => ({ order_id: order.order_id, customer_nama: order.customer_nama, asal_kota: order.asal_kota, tujuan_kota: order.tujuan_kota, unit }));
      return [...others, ...rows];
    });
  }, []);
  const clearCart = useCallback(() => setJadwalCart([]), []);
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

  const saveBonus = async (tripId, body) => {
    try {
      await axios.patch(`${API}/admin/trips/${tripId}/bonus`, body, { headers });
      flash("Bonus tersimpan");
      setBonusModal(null);
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

  const [fixingHeic, setFixingHeic] = useState(false);
  const fixHeicPhotos = async () => {
    if (!window.confirm("Perbaiki semua foto lama yang tersimpan format HEIC (broken image) jadi JPEG? Proses ini aman dijalankan berkali-kali.")) return;
    setFixingHeic(true);
    try {
      const r = await axios.post(`${API}/admin/migrate-heic`, null, { headers });
      const { trips_scanned, count } = r.data;
      flash(count > 0 ? `Beres! ${count} trip diperbaiki (dari ${trips_scanned} discan)` : `Tidak ada foto HEIC ditemukan (dari ${trips_scanned} trip discan)`);
    } catch (e) { flash("Gagal perbaiki foto: " + (e?.response?.data?.detail || "error")); }
    finally { setFixingHeic(false); }
  };

  const driverOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.nama_driver).filter(Boolean))).sort(),
    [orders]
  );
  const customerOptions = useMemo(
    () => Array.from(new Set(orders.map((o) => o.customer_nama).filter(Boolean))).sort((a, b) => a.localeCompare(b, "id")),
    [orders]
  );
  const visibleOrders = orders.filter((o) =>
    (!driverFilter || o.nama_driver === driverFilter) &&
    (!custFilter || o.customer_nama === custFilter)
  );
  const anyFilterActive = !!(search || statusFilter || dateFrom || dateTo || driverFilter || custFilter);
  const resetFilters = () => { setSearch(""); setStatusFilter(""); setDateFrom(""); setDateTo(""); setDriverFilter(""); setCustFilter(""); };

  const SECTION_META = {
    pesanan:      { title: "Dashboard", sub: "Ringkasan semua aktivitas pengiriman kendaraan" },
    kalkulator:   { title: "Kalkulator HPP", sub: "Hitung harga pokok & margin per rute" },
    drivers:      { title: "Driver", sub: "Kelola data driver & dokumen" },
    koordinator:  { title: "Koordinator", sub: "Kelola akun koordinator lapangan" },
    supplier:     { title: "Supplier", sub: "Kelola unit titipan & selisih harga supplier" },
    selisih:      { title: "Selisih Harga", sub: "Bandingkan HPP vs harga deal pelanggan" },
    "pembayaran-vendor": { title: "Pembayaran Vendor", sub: "Bayar beberapa PO per vendor sekaligus (Keuangan)" },
    kompensasi:   { title: "Kompensasi", sub: "Kompensasi hutang piutang antar pihak" },
    "minta-harga":{ title: "Minta Harga", sub: "Permintaan harga ke perwakilan supplier" },
    laporan:      { title: "Laporan", sub: "Ringkasan performa & ekspor data" },
    pengaturan:   { title: "Pengaturan", sub: "Preferensi tampilan & akun admin" },
    "route-leg":  { title: "Route Leg", sub: "Rute & leg pengiriman per order" },
    kendaraan:    { title: "Kendaraan", sub: "Daftar kendaraan yang pernah dikirim" },
    dokumen:      { title: "Dokumen", sub: "BASTK, resi, dan dokumen pengiriman" },
    histori:      { title: "Histori Dokumen", sub: "Arsip Invoice & Jadwal yang pernah dicetak — cetak ulang atau hapus" },
  };
  const section = SECTION_META[activeTab] || SECTION_META.pesanan;

  return (
    <div className="adm-shell" data-testid="adm-dashboard" style={{ display: "flex", minHeight: "100vh", background: "#0a0e14" }}>
      {/* Saran metode angkut untuk kolom Nama Kapal — ketik "self"/"carrier"/"towing"
          langsung nyaring, sisanya (nama kapal / rute) diketik manual. */}
      <datalist id="kapal-dl">{["Self Drive", "Car Carrier", "Towing", "Kapal", "Self Loader", "Low Bed", "Trucking", "Container"].map((n) => <option key={n} value={n} />)}</datalist>
      <div className={`adm-sidebar-backdrop${sidebarOpen ? " open" : ""}`} onClick={() => setSidebarOpen(false)} />
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

      <div className="adm-main" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopHeader
          title={section.title}
          sub={section.sub}
          search={activeTab === "pesanan" ? search : ""}
          onSearch={activeTab === "pesanan" ? setSearch : undefined}
          onExport={exportCsv}
          onRefresh={loadAll}
          profileMenuOpen={profileMenuOpen}
          setProfileMenuOpen={setProfileMenuOpen}
          onLogout={onLogout}
          onOpenSidebar={() => setSidebarOpen(true)}
          dark={dark}
          onToggleTheme={() => { toggleTheme(); setDark((d) => !d); }}
        />

        <div className="adm-content-wrap" style={{ padding: "22px 28px 40px", maxWidth: 1180, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>

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
              <code style={{ flex: "1 1 100%", minWidth: 0, fontSize: 13, color: "#e6edf3", background: "#0d1117", padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", wordBreak: "break-all", boxSizing: "border-box" }}>
                {window.location.origin}/daftar-driver
              </code>
              <button onClick={() => copyToClipboard(`${window.location.origin}/daftar-driver`)}
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

      {activeTab === "supplier" && (
        <SupplierPage />
      )}

      {activeTab === "selisih" && (
        <SelisihPage />
      )}

      {activeTab === "kompensasi" && (
        <KompensasiPage />
      )}

      {activeTab === "pembayaran-vendor" && (
        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <MobileVendorPayment embedded />
        </div>
      )}

      {activeTab === "minta-harga" && (
        <PermintaanHargaPage />
      )}

      {activeTab === "laporan" && (
        <LaporanPage stats={stats} onExportCsv={exportCsv} />
      )}

      {activeTab === "pengaturan" && (
        <PengaturanPage dark={dark} onToggleTheme={() => { toggleTheme(); setDark(d => !d); }} onLogout={onLogout} fixHeicPhotos={fixHeicPhotos} fixingHeic={fixingHeic} />
      )}

      {activeTab === "route-leg" && (
        <ComingSoon icon="🧭" title="Route Leg" note="Detail rute & leg per pengiriman bisa dibuka lewat tombol “Detail Pengiriman” di setiap kartu pesanan pada tab Dashboard." />
      )}

      {activeTab === "kendaraan" && (
        <ComingSoon icon="🚚" title="Kendaraan" note="Daftar kendaraan terpusat akan segera hadir. Untuk saat ini, data kendaraan bisa dilihat per pesanan di tab Dashboard." />
      )}

      {activeTab === "dokumen" && (
        <ComingSoon icon="📄" title="Dokumen" note="Dokumen BASTK & resi bisa dilihat lewat tab Dokumen di dalam “Detail Pengiriman” tiap pesanan." />
      )}

      {activeTab === "histori" && (
        <HistoriDokumen headers={headers} />
      )}

      {activeTab === "pesanan" && <>

      {/* ── Metric row ── */}
      {stats && (
        <section className="adm-metric-row" style={{ display: "flex", gap: 12, marginBottom: 18, overflowX: "auto", paddingBottom: 2 }} data-testid="adm-stats">
          <MetricCard label="Total Pesanan" value={stats.total} icon="📋" />
          {STATUS_LIST.map((s) => (
            <MetricCard
              key={s}
              label={STATUS_LABEL[s].txt}
              value={stats.by_status?.[s] || 0}
              tone={STATUS_TONE[s]}
              onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
              active={statusFilter === s}
              testid={`adm-stat-${s.toLowerCase()}`}
            />
          ))}
        </section>
      )}

      {/* ── Link Form Pesanan (compact card) ── */}
      <LinkCardMini
        title="Link Form Pesanan"
        sub="Bagikan link ini ke customer untuk membuat pesanan"
        link={`${window.location.origin}/order`}
      />

      {/* ── Link Panduan Pelanggan (compact card) ── */}
      <LinkCardMini
        title="Link Panduan Pelanggan"
        sub="Kirim ke pelanggan yang lagi kirim kendaraan — panduan tahap demi tahap"
        link={`${window.location.origin}/panduan-kirim`}
      />

      {/* ── Filters (satu baris) ── */}
      <section className="adm-filterbar-v2" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 18 }}>
        <div className="adm-search-wrap" style={{ flex: "1 1 240px", minWidth: 200 }}>
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
          <option value="">Semua Status</option>
          {STATUS_LIST.map((s) => <option key={s} value={s}>{STATUS_LABEL[s].txt}</option>)}
        </select>
        <div className="adm-date-range">
          <input type="date" className="adm-date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} max={dateTo || undefined} data-testid="adm-date-from" title="Dari tanggal" />
          <span style={{ color: "#8b949e", fontSize: 12 }}>~</span>
          <input type="date" className="adm-date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} min={dateFrom || undefined} data-testid="adm-date-to" title="Sampai tanggal" />
        </div>
        <select
          className="adm-status-sel"
          value={custFilter}
          onChange={(e) => setCustFilter(e.target.value)}
          data-testid="adm-customer-filter"
          title="Pilih konsumen"
        >
          <option value="">Semua Konsumen</option>
          {customerOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="adm-status-sel"
          value={driverFilter}
          onChange={(e) => setDriverFilter(e.target.value)}
          data-testid="adm-driver-filter"
        >
          <option value="">Semua Driver</option>
          {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {anyFilterActive && (
          <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" onClick={resetFilters} data-testid="adm-filter-reset">
            <IcoX /> Reset
          </button>
        )}
      </section>

      {/* ── Bar pilih-cepat: 1 klik masukin SEMUA unit di daftar ini ke keranjang jadwal.
           Gabung sama search customer → tarik semua unit 1 pelanggan tanpa centang satu-satu. ── */}
      {!loading && !error && visibleOrders.length > 0 && (() => {
        const allUnits = visibleOrders.flatMap((o) => (Array.isArray(o.units) ? o.units : []));
        const total = allUnits.length;
        const allSel = total > 0 && allUnits.every((u) => cartHas(u.unit_id));
        const setAll = (add) => setJadwalCart((c) => {
          const visIds = new Set(allUnits.map((u) => u.unit_id));
          const kept = c.filter((x) => !visIds.has(x.unit?.unit_id));
          if (!add) return kept;
          const rows = [];
          visibleOrders.forEach((o) => (Array.isArray(o.units) ? o.units : []).forEach((unit) =>
            rows.push({ order_id: o.order_id, customer_nama: o.customer_nama, asal_kota: o.asal_kota, tujuan_kota: o.tujuan_kota, unit })));
          return [...kept, ...rows];
        });
        return (
          <div className="adm-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 14px", marginBottom: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, color: "var(--text-mute)", fontWeight: 700 }}>
              {search.trim() ? <>Hasil "{search.trim()}": </> : null}{visibleOrders.length} PO · {total} unit
            </div>
            <button className="adm-btn adm-btn-sm adm-btn-gold" onClick={() => setAll(!allSel)} data-testid="adm-selectall-units">
              {allSel ? "✕ Batalkan pilih semua" : `☑️ Pilih semua unit → keranjang jadwal (${total})`}
            </button>
          </div>
        );
      })()}

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
        {!loading && !error && visibleOrders.length === 0 && (
          <div className="adm-empty" data-testid="adm-empty">
            <div className="adm-empty-ico"><IcoInbox /></div>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:6, color:"var(--text-2)" }}>
              Tidak ada pesanan
            </div>
            <div>{statusFilter ? `dengan status "${STATUS_LABEL[statusFilter]?.txt}"` : "yang cocok dengan filter saat ini."}</div>
          </div>
        )}
        {visibleOrders.map((o, idx) => (
          <OrderCard
            key={o.order_id}
            order={o}
            idx={idx}
            onConvert={() => setConvertModal(o)}
            onPatch={(body) => patchOrder(o.order_id, body)}
            onOdoo={doOdoo}
            onDelete={() => deleteOrder(o.order_id)}
            onOpenLegs={() => setLegsModal({ tripId: o.trip_id, order: o })}
            onOpenBonus={() => setBonusModal({ tripId: o.trip_id, order: o })}
            headers={headers}
            kordList={kordList}
            cartHas={cartHas}
            onToggleCartUnit={toggleCartUnit}
            onCartSetOrderUnits={cartSetOrderUnits}
          />
        ))}
      </section>

      {jadwalCart.length > 0 && (
        <div className="adm-cartbar" data-testid="adm-cartbar">
          <div className="adm-cartbar-info">✅ <b>{jadwalCart.length} unit</b> dipilih</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="adm-btn adm-btn-sm" onClick={clearCart}>Kosongkan</button>
            <button className="adm-btn adm-btn-sm adm-btn-blue" onClick={() => setShowInvoiceGab(true)} data-testid="adm-cartbar-invoice">Buat Invoice Gabungan</button>
            <button className="adm-btn adm-btn-sm adm-btn-gold" onClick={() => setShowJadwalGab(true)} data-testid="adm-cartbar-jadwal">Buat Jadwal Gabungan</button>
          </div>
        </div>
      )}
      {showJadwalGab && (
        <JadwalGabunganModal
          cart={jadwalCart}
          headers={headers}
          onClose={() => setShowJadwalGab(false)}
          onDone={() => { setShowJadwalGab(false); }}
        />
      )}
      {showInvoiceGab && (
        <InvoiceGabunganModal
          cart={jadwalCart}
          headers={headers}
          onClose={() => setShowInvoiceGab(false)}
          onDone={() => { setShowInvoiceGab(false); }}
        />
      )}

      {toast && <div className="adm-toast" data-testid="adm-toast">{toast}</div>}
      {bonusModal && (
        <BonusModal
          tripId={bonusModal.tripId}
          order={bonusModal.order}
          headers={headers}
          onClose={() => setBonusModal(null)}
          onSave={(body) => saveBonus(bonusModal.tripId, body)}
        />
      )}
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
        <TripDetailModal
          tripId={legsModal.tripId}
          order={legsModal.order}
          onClose={() => setLegsModal(null)}
          onSave={(legs) => saveLegs(legsModal.tripId, legs)}
          headers={headers}
        />
      )}

      </>}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   DESIGN TOKENS — enterprise dashboard shell
════════════════════════════════════════ */
const TONE = {
  navy:    { bg: "#0f1a2e", fg: "#5b8def", ring: "#1d3a63" },
  blue:    { bg: "#0d2340", fg: "#60a5fa", ring: "#1f6feb" },
  green:   { bg: "#0d2a10", fg: "#3fb950", ring: "#238636" },
  orange:  { bg: "#2d2410", fg: "#EF9F27", ring: "#7a5c14" },
  red:     { bg: "#2d1414", fg: "#f85149", ring: "#7a2020" },
  purple:  { bg: "#1f1530", fg: "#a78bfa", ring: "#4c2f7a" },
};
const STATUS_TONE = { NEW: "orange", DISPATCHED: "blue", ON_TRIP: "purple", DELIVERED: "green", CANCELLED: "red" };
const SIDEBAR_ICON = {
  pesanan: "▦", "route-leg": "🧭", drivers: "👤", supplier: "🌿", koordinator: "🧑‍💼",
  kendaraan: "🚙", dokumen: "📄", histori: "🗂️", laporan: "📑", kalkulator: "🧮", selisih: "📊",
  kompensasi: "🔄", "minta-harga": "📩", pengaturan: "⚙️", "pembayaran-vendor": "🏢",
};

/* ════════════════════════════════════════
   SIDEBAR
════════════════════════════════════════ */
const SIDEBAR_PRIMARY = [
  { key: "pesanan", label: "Dashboard" },
  { key: "pesanan", label: "Pesanan" },
  { key: "route-leg", label: "Route Leg" },
  { key: "drivers", label: "Driver" },
  { key: "supplier", label: "Supplier" },
  { key: "koordinator", label: "Koordinator" },
  { key: "kendaraan", label: "Kendaraan" },
  { key: "dokumen", label: "Dokumen" },
  { key: "histori", label: "Histori Dokumen" },
  { key: "laporan", label: "Laporan" },
];
const SIDEBAR_TOOLS = [
  { key: "kalkulator", label: "Kalkulator HPP" },
  { key: "selisih", label: "Selisih Harga" },
  { key: "pembayaran-vendor", label: "Pembayaran Vendor" },
  { key: "kompensasi", label: "Kompensasi" },
  { key: "minta-harga", label: "Minta Harga" },
];

function Sidebar({ activeTab, setActiveTab, open, onNavigate }) {
  const NavItem = ({ item, i }) => (
    <button
      key={`${item.key}-${i}`}
      onClick={() => { setActiveTab(item.key); if (onNavigate) onNavigate(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 14px", marginBottom: 2,
        border: "none", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, textAlign: "left",
        background: activeTab === item.key ? "rgba(91,141,239,0.14)" : "transparent",
        color: activeTab === item.key ? "#dbe6ff" : "#8b98ab",
        transition: "background .12s, color .12s",
      }}
      onMouseEnter={(e) => { if (activeTab !== item.key) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
      onMouseLeave={(e) => { if (activeTab !== item.key) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ fontSize: 14, width: 18, textAlign: "center", flexShrink: 0, opacity: activeTab === item.key ? 1 : 0.75 }}>{SIDEBAR_ICON[item.key] || "•"}</span>
      {item.label}
    </button>
  );

  return (
    <aside className={`adm-sidebar${open ? " open" : ""}`} style={{ width: 232, flexShrink: 0, background: "#0b0f17", borderRight: "1px solid #1a2130", display: "flex", flexDirection: "column", padding: "18px 12px", position: "sticky", top: 0, height: "100vh", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px 20px" }}>
        <Logo size={30} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#e6edf3", lineHeight: 1.15 }}>PT Alyssa</div>
          <div style={{ fontSize: 10, color: "#6b7688", lineHeight: 1.15 }}>Auto Logistik</div>
        </div>
      </div>

      <nav style={{ flex: 1 }}>
        {SIDEBAR_PRIMARY.map((item, i) => <NavItem item={item} i={i} key={i} />)}

        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: "#495267", textTransform: "uppercase", margin: "18px 10px 8px" }}>Tools</div>
        {SIDEBAR_TOOLS.map((item, i) => <NavItem item={item} i={i} key={i} />)}
      </nav>

      <div>
        <NavItem item={{ key: "pengaturan", label: "Pengaturan" }} i={0} />
        <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "linear-gradient(135deg, #0f1a2e, #131c2c)", border: "1px solid #1a2334" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#dbe6ff" }}>PT Alyssa Auto Logistik</div>
          <div style={{ fontSize: 10, color: "#6b7688", marginTop: 2 }}>Internal Control Panel</div>
        </div>
      </div>
    </aside>
  );
}

/* ════════════════════════════════════════
   TOP HEADER
════════════════════════════════════════ */
function TopHeader({ title, sub, search, onSearch, onExport, onRefresh, profileMenuOpen, setProfileMenuOpen, onLogout, onOpenSidebar, dark, onToggleTheme }) {
  const iconBtn = { width: 34, height: 34, borderRadius: 8, border: "1px solid #1f2937", background: "#111826", color: "#9aa4b6", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 14, flexShrink: 0 };
  return (
    <header className="adm-topheader-v2" style={{ padding: "18px 28px", borderBottom: "1px solid #171e2c", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", background: "#0a0e14" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <button className="adm-hamburger" onClick={onOpenSidebar} style={{ ...iconBtn, display: "none" }} aria-label="Buka menu" data-testid="adm-hamburger">☰</button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 19, fontWeight: 800, color: "#f2f5fa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</div>
          <div style={{ fontSize: 12, color: "#6b7688", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {onSearch && (
          <div className="adm-input-fluid" style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#5b6577", fontSize: 12 }}>⌕</span>
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Cari pesanan..."
              className="adm-input-fluid"
              style={{ width: 200, padding: "8px 12px 8px 28px", borderRadius: 8, border: "1px solid #1f2937", background: "#111826", color: "#e6edf3", fontSize: 12.5, outline: "none", boxSizing: "border-box" }}
            />
          </div>
        )}
        <a href="?guide=1" target="_blank" rel="noreferrer" style={iconBtn} title="Tutorial" data-testid="adm-tutorial-link">📖</a>
        <button style={iconBtn} title="Export CSV" onClick={onExport} data-testid="adm-export-csv">⬇</button>
        <button style={iconBtn} title="Refresh" onClick={onRefresh} data-testid="adm-refresh">↻</button>
        {onToggleTheme && (
          <button style={iconBtn} title="Mode gelap / terang" onClick={onToggleTheme} data-testid="adm-theme-toggle">{dark ? "☀️" : "🌙"}</button>
        )}
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setProfileMenuOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px 5px 5px", borderRadius: 20, border: "1px solid #1f2937", background: "#111826", cursor: "pointer" }}
          >
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "linear-gradient(135deg,#5b8def,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff" }}>A</div>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "#e6edf3", lineHeight: 1.1 }}>Admin</div>
              <div style={{ fontSize: 9.5, color: "#6b7688", lineHeight: 1.1 }}>Super Admin</div>
            </div>
          </button>
          {profileMenuOpen && (
            <div style={{ position: "absolute", top: "110%", right: 0, background: "#111826", border: "1px solid #1f2937", borderRadius: 10, minWidth: 150, overflow: "hidden", zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,.4)" }}>
              <button
                onClick={() => { setProfileMenuOpen(false); onLogout(); }}
                style={{ width: "100%", padding: "10px 14px", border: "none", background: "none", color: "#f85149", fontSize: 12.5, fontWeight: 700, textAlign: "left", cursor: "pointer" }}
                data-testid="adm-logout"
              >
                🚪 Keluar
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

/* ════════════════════════════════════════
   METRIC CARD
════════════════════════════════════════ */
function MetricCard({ label, value, icon, tone, onClick, active, testid }) {
  const t = TONE[tone] || { bg: "#111826", fg: "#e6edf3", ring: "#1f2937" };
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      data-testid={testid}
      style={{
        flex: "1 1 140px", minWidth: 130, display: "flex", alignItems: "center", gap: 10,
        padding: "12px 14px", borderRadius: 12, background: "#0e1420",
        border: `1px solid ${active ? t.ring : "#1a2130"}`, cursor: onClick ? "pointer" : "default",
        boxShadow: active ? `0 0 0 1px ${t.ring}` : "none", transition: "border-color .12s",
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 9, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
        {icon || "●"}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: "#f2f5fa", lineHeight: 1.1 }}>{value}</div>
        <div style={{ fontSize: 10.5, color: "#6b7688", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   LINK CARD (compact)
════════════════════════════════════════ */
function LinkCardMini({ title, sub, link }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 12, background: "#0e1420", border: "1px solid #1a2130", marginBottom: 18, flexWrap: "wrap" }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: "#0d2340", color: "#60a5fa", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>🔗</div>
      <div style={{ minWidth: 0, flex: "0 1 auto" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e6edf3" }}>{title}</div>
        <div style={{ fontSize: 10.5, color: "#6b7688", marginTop: 1 }}>{sub}</div>
      </div>
      <code style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12, color: "#9aa4b6", background: "#0a0e14", padding: "7px 12px", borderRadius: 7, border: "1px solid #1a2130", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", boxSizing: "border-box" }}>{link}</code>
      <button
        onClick={async () => { const ok = await copyToClipboard(link); if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); } }}
        style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: copied ? "#238636" : "#1f6feb", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}
      >
        {copied ? "✓ Copied" : "Copy Link"}
      </button>
    </div>
  );
}

/* ════════════════════════════════════════
   PROGRESS TIMELINE — Baru → Driver → Berangkat → Kapal → Sampai → Dokumen
════════════════════════════════════════ */
const PROGRESS_STEPS = [
  { key: "baru", label: "Baru" },
  { key: "driver", label: "Driver" },
  { key: "berangkat", label: "Berangkat" },
  { key: "kapal", label: "Kapal" },
  { key: "sampai", label: "Sampai" },
  { key: "dokumen", label: "Dokumen" },
];

function computeProgress(order) {
  const legs = Array.isArray(order.legs) ? order.legs : [];
  const hasKapalLeg = legs.some((l) => (l.tipe || "").startsWith("Kapal"));
  const kapalDone = legs.some((l) => (l.tipe || "").startsWith("Kapal") && l.status === "Selesai");
  const berangkatDone = order.status === "ON_TRIP" || order.status === "DELIVERED" || (legs[0] && legs[0].status && legs[0].status !== "Menunggu");
  const done = {
    baru: true,
    driver: !!(order.driver_id || order.nama_driver),
    berangkat: !!berangkatDone,
    kapal: hasKapalLeg ? kapalDone : !!berangkatDone,
    sampai: order.status === "DELIVERED",
    dokumen: order.status === "DELIVERED",
  };
  let idx = -1;
  PROGRESS_STEPS.forEach((s, i) => { if (done[s.key]) idx = i; });
  return { done, currentIdx: idx };
}

function ProgressTimeline({ order }) {
  const { done, currentIdx } = computeProgress(order);
  const cancelled = order.status === "CANCELLED";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 260 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, color: "#5b6577", textTransform: "uppercase" }}>Progress</div>
      <div style={{ display: "flex", alignItems: "center" }}>
        {PROGRESS_STEPS.map((s, i) => {
          const isDone = done[s.key] && !cancelled;
          const isCurrent = i === currentIdx && !cancelled;
          const color = cancelled ? "#3a3f4a" : isDone ? (i === PROGRESS_STEPS.length - 1 && isDone ? "#3fb950" : "#5b8def") : "#2a3140";
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", flex: i < PROGRESS_STEPS.length - 1 ? 1 : "0 0 auto" }}>
              <div title={s.label} style={{
                width: isCurrent ? 12 : 9, height: isCurrent ? 12 : 9, borderRadius: "50%",
                background: isDone ? color : "transparent", border: `2px solid ${color}`,
                boxShadow: isCurrent ? `0 0 0 3px ${color}33` : "none", flexShrink: 0,
              }} />
              {i < PROGRESS_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: done[PROGRESS_STEPS[i + 1].key] && !cancelled ? color : "#232a38", minWidth: 14 }} />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {PROGRESS_STEPS.map((s) => (
          <span key={s.key} style={{ fontSize: 9, color: "#5b6577", flex: 1, textAlign: "center" }}>{s.label}</span>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   LAPORAN PAGE
════════════════════════════════════════ */
function LaporanPage({ stats, onExportCsv }) {
  if (!stats) return <div style={{ color: "#6b7688", fontSize: 13, padding: 40, textAlign: "center" }}>Memuat data...</div>;
  return (
    <div>
      <div className="adm-metric-row" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <MetricCard label="Total Pesanan" value={stats.total} icon="📋" />
        {STATUS_LIST.map((s) => (
          <MetricCard key={s} label={STATUS_LABEL[s].txt} value={stats.by_status?.[s] || 0} tone={STATUS_TONE[s]} />
        ))}
      </div>
      <div style={{ padding: 20, borderRadius: 12, background: "#0e1420", border: "1px solid #1a2130", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e6edf3" }}>Ekspor Data Pesanan</div>
          <div style={{ fontSize: 11.5, color: "#6b7688", marginTop: 3 }}>Unduh seluruh data pesanan (sesuai filter aktif) dalam format CSV.</div>
        </div>
        <button onClick={onExportCsv} style={{ padding: "10px 18px", borderRadius: 9, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>⬇ Export CSV</button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   PENGATURAN PAGE
════════════════════════════════════════ */
function PengaturanPage({ dark, onToggleTheme, onLogout, fixHeicPhotos, fixingHeic }) {
  const row = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderRadius: 12, background: "#0e1420", border: "1px solid #1a2130", marginBottom: 12, gap: 12, flexWrap: "wrap" };
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={row}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e6edf3" }}>Tampilan</div>
          <div style={{ fontSize: 11.5, color: "#6b7688", marginTop: 3 }}>Ganti antara mode terang dan gelap.</div>
        </div>
        <button onClick={onToggleTheme} style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #1f2937", background: "#111826", color: "#e6edf3", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          {dark ? "☀️ Mode Terang" : "🌙 Mode Gelap"}
        </button>
      </div>
      <div style={row}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e6edf3" }}>Perbaiki Foto HEIC</div>
          <div style={{ fontSize: 11.5, color: "#6b7688", marginTop: 3 }}>Konversi foto lama format HEIC (broken image) jadi JPEG.</div>
        </div>
        <button onClick={fixHeicPhotos} disabled={fixingHeic} style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #1f2937", background: "#111826", color: "#e6edf3", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          {fixingHeic ? "⏳ Memperbaiki..." : "🩹 Perbaiki Sekarang"}
        </button>
      </div>
      <div style={row}>
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "#e6edf3" }}>Akun</div>
          <div style={{ fontSize: 11.5, color: "#6b7688", marginTop: 3 }}>Keluar dari sesi admin ini.</div>
        </div>
        <button onClick={onLogout} style={{ padding: "9px 16px", borderRadius: 9, border: "1px solid #7a2020", background: "none", color: "#f85149", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
          🚪 Keluar
        </button>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   COMING SOON PLACEHOLDER
════════════════════════════════════════ */
function ComingSoon({ icon, title, note }) {
  return (
    <div style={{ textAlign: "center", padding: "70px 20px", color: "#6b7688" }}>
      <div style={{ fontSize: 42, marginBottom: 14 }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#e6edf3", marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 12.5, maxWidth: 420, margin: "0 auto", lineHeight: 1.6 }}>{note}</div>
    </div>
  );
}

/* ════════════════════════════════════════
   ORDER CARD
════════════════════════════════════════ */
const ALBUM_STAGES = [
  { key: "asal", label: "Asal", icon: "📍" },
  { key: "kapal", label: "Di Kapal", icon: "⚓" },
  { key: "tujuan", label: "Tujuan", icon: "🏁" },
  { key: "dokumen", label: "Dokumen", icon: "📄" },
];

/* ── Duplikat PO → biaya Vendor/Supplier (mirip "Duplikat transaksi" Mekari) ──
   Ambil unit & rute dari PO, pilih vendor (tersimpan / baru), isi harga vendor
   manual, simpan jadi supplier job. Reuse endpoint supplier yang sudah ada. */
function DuplicateVendorModal({ order, headers, onClose }) {
  const units = (Array.isArray(order.units) && order.units.length)
    ? order.units
    : [{ unit_id: "legacy", vehicle_type: order.vehicle_type, tipe_model: order.tipe_model, nopol: order.nopol, no_rangka: order.no_rangka }];
  const rute = `${order.asal_kota || "—"} → ${order.tujuan_kota || "—"}`;
  const rpID = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

  const [supQ, setSupQ] = useState("");
  const [supList, setSupList] = useState([]);
  const [supSel, setSupSel] = useState(null);   // {id, nama} tersimpan, atau {id:null, nama} baru
  const [rows, setRows] = useState(() => units.map((u, i) => ({
    key: u.unit_id || u.nopol || i,
    checked: true,
    vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim(),
    nopol: (u.nopol || "").toUpperCase(),
    no_rangka: (u.no_rangka || "").toUpperCase(),
    harga: "",
    asal: order.asal_kota || "",       // default dari PO, bisa diedit
    tujuan: order.tujuan_kota || "",   // default dari PO, bisa diedit
    catatan: "",
  })));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/suppliers`, { params: supQ.trim() ? { q: supQ.trim() } : {}, headers });
        if (alive) setSupList(r.data?.items || []);
      } catch { if (alive) setSupList([]); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [supQ]); // eslint-disable-line

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => r.key === key ? { ...r, ...patch } : r));
  const hargaNum = (s) => parseInt(String(s || "").replace(/[^0-9]/g, ""), 10) || 0;
  const checkedRows = rows.filter((r) => r.checked && hargaNum(r.harga) > 0);
  const canSave = !!(supSel && (supSel.id || supSel.nama)) && checkedRows.length > 0 && !saving;

  const doSave = async () => {
    setSaving(true);
    try {
      let sid = supSel.id;
      if (!sid) {
        const r = await axios.post(`${API}/admin/suppliers`, { nama: supSel.nama, jenis: "", no_hp: "", catatan: "" }, { headers });
        sid = r.data?.id;
      }
      if (!sid) throw new Error("supplier");
      for (const r of checkedRows) {
        await axios.post(`${API}/admin/suppliers/${sid}/jobs`, {
          vehicle_type: r.vehicle_type || "Kendaraan",
          nopol: r.nopol, no_rangka: r.no_rangka,
          asal_kota: (r.asal || "").trim(), tujuan_kota: (r.tujuan || "").trim(),
          total_harga: hargaNum(r.harga),
          catatan: (r.catatan || "").trim() || `Duplikat dari ${order.order_id}`, tanggal: "",
        }, { headers });
      }
      setDone(true);
    } catch (e) {
      alert(e?.response?.data?.detail || "Gagal duplikat ke vendor");
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="adm-vars">
    <div className="adm-modal-bg" onClick={onClose} data-testid={`adm-dupvendor-modal-${order.order_id}`}>
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">🏢 Duplikat ke Vendor</div>
            <div className="adm-modal-sub">{order.order_id} · {rute}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="adm-modal-body">
          {done ? (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div style={{ fontSize: 40 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 16, margin: "8px 0" }}>Tersimpan ke vendor {supSel.nama}</div>
              <div style={{ fontSize: 13, color: "var(--text-mute)", marginBottom: 16 }}>{checkedRows.length} unit masuk jadi biaya vendor. Cek di menu Supplier / Pembayaran Vendor.</div>
              <button className="adm-btn adm-btn-gold" onClick={onClose}>Selesai</button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mute)", marginBottom: 6, textTransform: "uppercase" }}>Vendor / Supplier</div>
                {supSel ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#12233a", border: "1px solid #1f6feb", borderRadius: 8, padding: "10px 12px" }}>
                    <span style={{ fontWeight: 700 }}>🏢 {supSel.nama}{!supSel.id && <span style={{ color: "#e6b450", fontSize: 12 }}> (baru)</span>}</span>
                    <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => setSupSel(null)}>Ganti</button>
                  </div>
                ) : (
                  <>
                    <input className="adm-input" style={{ width: "100%" }} placeholder="Ketik nama vendor untuk cari / buat baru…" value={supQ} onChange={(e) => setSupQ(e.target.value)} data-testid="adm-dupvendor-search" />
                    {supList.length > 0 && (
                      <div style={{ border: "1px solid #21262d", borderRadius: 8, marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                        {supList.map((s) => (
                          <button key={s.id} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", background: "none", border: "none", borderBottom: "1px solid #21262d", color: "#e6edf3", cursor: "pointer" }}
                            onClick={() => setSupSel({ id: s.id, nama: s.nama })}>
                            🏢 {s.nama} <span style={{ color: "#8b949e", fontSize: 12 }}>· sisa {rpID(s.grand_sisa)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {supQ.trim() && (
                      <button className="adm-btn adm-btn-gold adm-btn-xs" style={{ marginTop: 8 }} onClick={() => setSupSel({ id: null, nama: supQ.trim() })}>+ Buat vendor baru "{supQ.trim()}"</button>
                    )}
                  </>
                )}
              </div>

              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-mute)", marginBottom: 6, textTransform: "uppercase" }}>Unit dari PO ini · isi harga, rute bisa diubah</div>
              {rows.map((r) => (
                <div key={r.key} style={{ padding: "10px 0", borderTop: "1px solid #21262d" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={r.checked} onChange={() => setRow(r.key, { checked: !r.checked })} style={{ width: 16, height: 16, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{r.vehicle_type || "Kendaraan"}{r.nopol ? ` · ${r.nopol}` : ""}</div>
                    </div>
                  </label>
                  {r.checked && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, marginLeft: 26 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <input className="adm-input" placeholder="Kota asal" value={r.asal}
                          onChange={(e) => setRow(r.key, { asal: e.target.value })} data-testid={`adm-dupvendor-asal-${r.key}`} />
                        <input className="adm-input" placeholder="Kota tujuan" value={r.tujuan}
                          onChange={(e) => setRow(r.key, { tujuan: e.target.value })} data-testid={`adm-dupvendor-tujuan-${r.key}`} />
                      </div>
                      <input className="adm-input adm-mono" inputMode="numeric" placeholder="Harga vendor (Rp)" value={r.harga}
                        onChange={(e) => setRow(r.key, { harga: e.target.value.replace(/[^0-9]/g, "") })} data-testid={`adm-dupvendor-harga-${r.key}`} />
                      {/* Catatan pindah ke bawah asal-tujuan & harga, full-width, tetap di blok unit ini */}
                      <input className="adm-input" placeholder="Catatan (opsional)" value={r.catatan}
                        onChange={(e) => setRow(r.key, { catatan: e.target.value })} data-testid={`adm-dupvendor-catatan-${r.key}`} />
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
        {!done && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 16px", borderTop: "1px solid #21262d" }}>
            <button className="adm-btn adm-btn-ghost" onClick={onClose}>Batal</button>
            <button className="adm-btn adm-btn-gold" disabled={!canSave} onClick={doSave} data-testid="adm-dupvendor-save">
              {saving ? "Menyimpan…" : `Simpan ${checkedRows.length} unit ke vendor`}
            </button>
          </div>
        )}
      </div>
    </div>
    </div>
  ), document.body);
}

function OrderCard({ order, idx, onConvert, onPatch, onOdoo, onDelete, onOpenLegs, onOpenBonus, headers, kordList = [], cartHas = () => false, onToggleCartUnit = () => {}, onCartSetOrderUnits = () => {} }) {
  const [uploadingStage, setUploadingStage] = useState(null); // stage key lagi upload
  const [expanded, setExpanded] = useState(false);
  const [copiedPo, setCopiedPo] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [showJadwal, setShowJadwal] = useState(false);
  const [showTrip360, setShowTrip360] = useState(false);
  const [showDupVendor, setShowDupVendor] = useState(false);
  const albumFileRefs = useRef({});

  const units = Array.isArray(order.units) ? order.units : [];
  const uSum = order.unit_summary || null;
  const allUnitsSelected = units.length > 0 && units.every((u) => cartHas(u.unit_id));

  const copyPoText = async (e) => {
    e.stopPropagation();
    const model = (order.vehicle_type || "").trim().split(/\s+/).slice(1).join(" ") || order.vehicle_type || "—";
    const rute = `${(order.asal_kota || "").toUpperCase()}-${(order.tujuan_kota || "").toUpperCase()}`;
    const text = [model, order.nopol || "—", order.no_rangka || "—", rute].join(" ");
    const ok = await copyToClipboard(text);
    if (ok) { setCopiedPo(true); setTimeout(() => setCopiedPo(false), 1800); }
  };

  const uploadFotoAlbum = async (stage, files) => {
    if (!order.trip_id || !files?.length) return;
    const catatan = window.prompt(
      `Catatan buat foto ${ALBUM_STAGES.find(s => s.key === stage)?.label || stage} ini (opsional, misal nama kapal):`,
      ""
    );
    if (catatan === null) return; // batal
    setUploadingStage(stage);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("foto", file);
        fd.append("stage", stage);
        fd.append("uploaded_by", "admin");
        if (catatan.trim()) fd.append("catatan", catatan.trim());
        await axios.post(`${API}/trips/${order.trip_id}/album`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      }
      alert(`${files.length} foto berhasil diupload ke album ${ALBUM_STAGES.find(s => s.key === stage)?.label || stage}`);
    } catch { alert("Gagal upload foto"); }
    setUploadingStage(null);
  };

  const printSuratJalan = () => {
    const tgl = new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const noSurat = `AAL-${order.order_id?.slice(-6) || "000000"}`;
    // M3 = P x L x T (cm) / 1.000.000 — dihitung otomatis dari dimensi yang diisi di form pesanan.
    const p = parseFloat(order.panjang), l = parseFloat(order.lebar), t = parseFloat(order.tinggi);
    const m3 = (p > 0 && l > 0 && t > 0) ? ((p * l * t) / 1_000_000).toFixed(3) : "";
    // Kiriman cargo/barang umum pakai isi_kiriman; kiriman kendaraan pakai vehicle_type+nopol.
    const isiContents = (order.isi_kiriman || "").trim()
      || `${order.vehicle_type || ""} ${order.nopol ? "· " + order.nopol : ""}`.trim();
    const jmlColly = (order.jumlah_colly || "").trim() || "1";
    // 2 lembar identik ditumpuk 1 halaman A4 (lebar A4, tinggi A4/2 per lembar) biar sekali
    // cetak langsung dapet 2 rangkap (arsip kantor + tanda terima) tanpa buang kertas kosong.
    const renderCopy = (copyLabel) => `
    <div class="outer">
      <div class="copy-tag">${copyLabel}</div>
      <!-- HEADER -->
      <div class="header">
        <div class="logo-box">
          <div class="logo-name">PT. ALYSSA<br>AUTO LOGISTIK</div>
          <div class="logo-tagline">Logistic on going</div>
          <div class="logo-addr">Jl Enim Raya 2 No 86<br>Jakarta Utara, DKI Jakarta 14330<br>Telp: 0818 631 135</div>
        </div>
        <div class="title-box">
          <div class="title-main">SURAT TANDA TERIMA KIRIMAN BARANG</div>
          <div class="title-sub">CONSIGNMENT NOTE</div>
          <div style="text-align:center;margin-top:6px"><div class="no-box">${noSurat}</div></div>
          <div style="text-align:right;font-size:9px;margin-top:4px;color:#555">Tanggal: ${tgl}</div>
        </div>
      </div>

      <!-- INFO BARIS 1 -->
      <div class="info-row">
        <div class="info-cell" style="flex:2">
          <div class="lbl">Dari / Shipper</div>
          <div class="val">PT. ALYSSA AUTO LOGISTIK</div>
        </div>
        <div class="info-cell" style="flex:2">
          <div class="lbl">Kepada / Consignee</div>
          <div class="val">${order.customer_nama || "&nbsp;"}</div>
        </div>
        <div class="info-cell" style="flex:1">
          <div class="lbl">Ref. PO / SL No.</div>
          <div class="val">${order.order_id || "&nbsp;"}</div>
        </div>
      </div>

      <!-- INFO BARIS 2 -->
      <div class="info-row">
        <div class="info-cell">
          <div class="lbl">Rute / Route</div>
          <div class="val">${order.asal_kota || "—"} → ${order.tujuan_kota || "—"}</div>
        </div>
        <div class="info-cell">
          <div class="lbl">No. Polisi / Plate No.</div>
          <div class="val">${order.nopol || "&nbsp;"}</div>
        </div>
        <div class="info-cell">
          <div class="lbl">Tipe Kendaraan</div>
          <div class="val">${order.vehicle_type || "&nbsp;"}</div>
        </div>
        <div class="info-cell">
          <div class="lbl">No. Rangka / Chassis</div>
          <div class="val">${order.no_rangka || "&nbsp;"}</div>
        </div>
      </div>

      <!-- TABEL ISI -->
      <table>
        <thead><tr>
          <th class="td-no">#</th>
          <th>Jml Jns Colly / No. of Pieces</th>
          <th>Tipe / Pak</th>
          <th>Berat / Weight (kg)</th>
          <th class="td-isi">Isi Menurut Pengirim / Contents</th>
          <th>Warna / Color</th>
          <th>P (cm)</th>
          <th>L (cm)</th>
          <th>T (cm)</th>
          <th>M3</th>
        </tr></thead>
        <tbody>
          <tr>
            <td class="td-no">1</td>
            <td style="text-align:center">${jmlColly}</td>
            <td>Unit</td>
            <td></td>
            <td class="td-isi">${isiContents}</td>
            <td>${order.warna || ""}</td>
            <td style="text-align:center">${order.panjang || ""}</td>
            <td style="text-align:center">${order.lebar || ""}</td>
            <td style="text-align:center">${order.tinggi || ""}</td>
            <td style="text-align:center;font-weight:700">${m3}</td>
          </tr>
          <tr><td class="td-no">2</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>

      <!-- SERVICE -->
      <div class="service-box">
        <span class="svc-lbl">Services:</span>
        <div class="svc-opt"><div class="chk"></div> Vessel</div>
        <div class="svc-opt"><div class="chk"></div> Flight</div>
        <div class="svc-opt"><div class="chk checked"></div> Truck / Self Drive</div>
        <div class="svc-opt"><div class="chk"></div> Kapal RoRo</div>
      </div>

      <!-- TANDA TANGAN -->
      <div class="sign-row">
        <div class="sign-cell">
          <div class="sign-lbl">Pengirim / Shipper</div>
          <div class="sign-space"></div>
          <div class="sign-name">PT. Alyssa Auto Logistik</div>
        </div>
        <div class="sign-cell">
          <div class="sign-lbl">Driver / Supir</div>
          <div class="sign-space"></div>
          <div class="sign-name">${order.nama_driver || order.driver_id || "_____________"}</div>
        </div>
        <div class="sign-cell">
          <div class="sign-lbl">Penerima / Received</div>
          <div class="sign-space"></div>
          <div class="sign-name">${order.customer_nama || "_____________"}</div>
        </div>
        <div class="sign-cell">
          <div class="sign-lbl">Tgl Terima / Date Received</div>
          <div class="sign-space"></div>
          <div class="sign-name">_____________</div>
        </div>
      </div>

      <!-- CATATAN -->
      <div class="catatan">
        <b>CATATAN / NOTES:</b> Barang yang dikirim sudah diperiksa dan sesuai dengan keterangan di atas.
        Kerusakan/kehilangan yang disebabkan bukan karena kelalaian PT. Alyssa Auto Logistik tidak menjadi tanggung jawab perusahaan.
        &nbsp;|&nbsp; <i>Goods have been inspected and match the description above.</i>
      </div>
    </div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Surat Jalan ${noSurat}</title>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #fff; }
      .sheet { display: flex; flex-direction: column; height: 285mm; padding: 6mm; gap: 4mm; }
      .copy-slot { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; }
      .cutline { display: flex; align-items: center; gap: 8px; color: #888; font-size: 9px; flex: 0 0 auto; }
      .cutline .dash { flex: 1; border-top: 1px dashed #999; }
      .outer { border: 2px solid #000; width: 100%; flex: 1; display: flex; flex-direction: column; position: relative; }
      .copy-tag { position: absolute; top: 4px; right: 8px; font-size: 8px; font-weight: 700; color: #666; letter-spacing: .5px; text-transform: uppercase; }
      .header { display: flex; border-bottom: 2px solid #000; }
      .logo-box { width: 200px; border-right: 2px solid #000; padding: 8px 10px; display: flex; flex-direction: column; justify-content: center; }
      .logo-name { font-size: 14px; font-weight: 900; color: #000; letter-spacing: 1px; line-height: 1.2; }
      .logo-tagline { font-size: 8px; color: #333; margin-top: 3px; font-style: italic; }
      .logo-addr { font-size: 8px; color: #333; margin-top: 4px; line-height: 1.4; }
      .title-box { flex: 1; padding: 8px 12px; }
      .title-main { font-size: 13px; font-weight: 900; text-align: center; letter-spacing: 1px; }
      .title-sub { font-size: 10px; text-align: center; color: #333; margin-top: 2px; font-style: italic; }
      .no-box { border: 1px solid #000; display: inline-block; padding: 2px 10px; margin-top: 6px; font-size: 14px; font-weight: 900; letter-spacing: 2px; }
      .info-row { display: flex; border-bottom: 1px solid #000; }
      .info-cell { flex: 1; border-right: 1px solid #000; padding: 5px 8px; }
      .info-cell:last-child { border-right: none; }
      .lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #555; letter-spacing: .5px; }
      .val { font-size: 11px; font-weight: 600; margin-top: 2px; min-height: 18px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #e8e8e8; border: 1px solid #000; padding: 5px 6px; font-size: 9px; text-align: center; font-weight: 700; text-transform: uppercase; }
      td { border: 1px solid #000; padding: 5px 6px; font-size: 11px; min-height: 36px; vertical-align: top; }
      .td-no { text-align: center; width: 30px; }
      .td-isi { width: 40%; }
      .service-box { border-bottom: 1px solid #000; padding: 6px 8px; display: flex; gap: 20px; align-items: center; }
      .svc-lbl { font-size: 9px; font-weight: 700; text-transform: uppercase; margin-right: 8px; }
      .svc-opt { display: flex; align-items: center; gap: 4px; font-size: 10px; }
      .chk { width: 12px; height: 12px; border: 1px solid #000; display: inline-block; }
      .chk.checked { background: #000; }
      .sign-row { display: flex; border-top: 1px solid #000; }
      .sign-cell { flex: 1; border-right: 1px solid #000; padding: 6px 8px; }
      .sign-cell:last-child { border-right: none; }
      .sign-lbl { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #555; }
      .sign-space { height: 40px; }
      .sign-name { font-size: 9px; border-top: 1px solid #555; margin-top: 4px; padding-top: 2px; color: #333; }
      .catatan { padding: 6px 8px; border-top: 1px solid #000; font-size: 9px; color: #333; line-height: 1.5; }
      @media print { @page { margin: 0; size: A4 portrait; } body { padding: 0; } }
    </style></head><body>
    <div class="sheet">
      <div class="copy-slot">${renderCopy("Lembar 1 — Arsip Kantor")}</div>
      <div class="cutline"><span class="dash"></span>&nbsp;✂ potong di sini&nbsp;<span class="dash"></span></div>
      <div class="copy-slot">${renderCopy("Lembar 2 — Tanda Terima")}</div>
    </div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  };

  // wrapper tipis: pakai fungsi modul biar bisa dicetak ulang dari Histori
  const printInvoice = (lines, withTax, extra) =>
    printInvoiceDoc(lines, withTax, { ...(extra || {}), customer_nama: order.customer_nama, order_id: order.order_id });
  const printJadwal = (meta, units) =>
    printJadwalDoc({ ...(meta || {}), customer_nama: order.customer_nama, order_id: order.order_id, asal_kota: order.asal_kota, tujuan_kota: order.tujuan_kota }, units);

  const [editDriver, setEditDriver] = useState(false);
  const [driverDraft, setDriverDraft] = useState(order.driver_id || "");
  const [editNama, setEditNama] = useState(false);
  const [namaDraft, setNamaDraft] = useState(order.nama_driver || "");
  const [editVehicle, setEditVehicle] = useState(false);
  const [vtDraft, setVtDraft] = useState(order.vehicle_type || "");
  const [nopolDraft, setNopolDraft] = useState(order.nopol || "");
  const [editRangka, setEditRangka] = useState(false);
  const [rangkaDraft, setRangkaDraft] = useState(order.no_rangka || "");
  const [editColly, setEditColly] = useState(false);
  const [collyDraft, setCollyDraft] = useState(order.jumlah_colly || "");
  const [editArrival, setEditArrival] = useState(false);
  const [arrivalDraft, setArrivalDraft] = useState(order.pickup_arrival || "");
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
  const saveRangka = async () => { await onPatch({ no_rangka: rangkaDraft.trim().toUpperCase() }); setEditRangka(false); };
  const saveColly = async () => { await onPatch({ jumlah_colly: collyDraft.replace(/[^0-9]/g, "") }); setEditColly(false); };
  const saveArrival = async () => { await onPatch({ pickup_arrival: arrivalDraft }); setEditArrival(false); };
  // ── Status WhatsApp konfirmasi + kirim ulang ──
  const [waStatus, setWaStatus] = useState(order.wa_status || "belum_dikirim");
  const [waErr, setWaErr] = useState(order.wa_error || "");
  const [waBusy, setWaBusy] = useState(false);
  const WA_VIEW = {
    terkirim:      { txt: "Terkirim",      cls: "adm-pill", color: "#3fb950" },
    dikirim_ulang: { txt: "Dikirim ulang", cls: "adm-pill", color: "#3fb950" },
    gagal:         { txt: "Gagal",         cls: "adm-pill", color: "#f85149" },
    belum_dikirim: { txt: "Belum dikirim", cls: "adm-pill", color: "#8b949e" },
  };
  const resendWa = async () => {
    setWaBusy(true);
    try {
      const r = await axios.post(`${API}/admin/orders/${order.order_id}/resend-wa`, {}, { headers });
      setWaStatus(r.data?.wa_status || "dikirim_ulang");
      setWaErr(r.data?.wa_error || "");
    } catch (e) {
      alert(e?.response?.data?.detail || "Gagal kirim ulang WhatsApp");
    } finally { setWaBusy(false); }
  };
  // Format ISO datetime-local ("2026-07-29T14:30") / tanggal ("2026-07-29") jadi "29/07/2026 14:30"
  const fmtDT = (s) => {
    if (!s) return "";
    const [d, t] = String(s).split("T");
    const p = String(d).split("-");
    if (p.length !== 3) return s;
    return `${p[2]}/${p[1]}/${p[0]}${t ? ` ${t}` : ""}`;
  };
  const jadwalDiminta = (order.pickup_date || order.pickup_time)
    ? `${fmtDT(order.pickup_date) || "—"}${order.pickup_time ? ` ${order.pickup_time}` : ""}`.trim()
    : "";

  return (
    <article
      data-status={order.status}
      data-testid={`adm-order-${order.order_id}`}
      style={{ animationDelay: `${idx * 40}ms`, background: "#0e1420", border: "1px solid #1a2130", borderRadius: 14, marginBottom: 12, overflow: "hidden", borderLeft: `3px solid ${TONE[STATUS_TONE[order.status]]?.fg || "#2a3140"}` }}
    >
      {/* Compact summary row — always visible */}
      <div
        onClick={() => setExpanded((v) => !v)}
        className="adm-order-summary"
        style={{ display: "flex", alignItems: "center", gap: 20, padding: "14px 18px", cursor: "pointer", flexWrap: "wrap" }}
        data-testid={`adm-order-summary-${order.order_id}`}
      >
        <div style={{ minWidth: 150 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="adm-mono" style={{ fontSize: 12.5, fontWeight: 800, color: "#e6edf3" }}>{order.order_id}</span>
            <span className={`adm-chip ${lbl.cls}`} data-testid={`adm-status-${order.order_id}`}>{lbl.txt}</span>
          </div>
          <div style={{ fontSize: 11, color: "#6b7688", marginTop: 4 }}>{order.customer_nama || "—"}</div>
          <div style={{ fontSize: 10.5, color: "#495267", marginTop: 1 }}>{order.customer_hp || "—"}</div>
        </div>

        <div style={{ minWidth: 130 }}>
          <div style={{ fontSize: 11.5, color: "#c9d1d9", fontWeight: 600 }}>{order.vehicle_type || "—"}</div>
          <div style={{ fontSize: 10.5, color: "#6b7688", marginTop: 3 }}>{order.nopol || "belum di-assign"}</div>
          {order.no_rangka && <div style={{ fontSize: 9.5, color: "#495267", marginTop: 1 }}>{order.no_rangka}</div>}
        </div>

        <div style={{ minWidth: 130 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: "#5b6577", textTransform: "uppercase" }}>Rute</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3", marginTop: 2 }}>{order.asal_kota || "—"}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#e6edf3" }}>↓ {order.tujuan_kota || "—"}</div>
        </div>

        <div style={{ minWidth: 110 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, color: "#5b6577", textTransform: "uppercase" }}>Driver</div>
          <div style={{ fontSize: 11.5, color: order.nama_driver ? "#c9d1d9" : "#495267", marginTop: 3, fontStyle: order.nama_driver ? "normal" : "italic" }}>
            {order.nama_driver || "Belum di-assign"}
          </div>
        </div>

        <ProgressTimeline order={order} />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 10.5, color: "#495267", textAlign: "right" }}>{fmtDate(order.created_at)}</div>
          <button
            onClick={copyPoText}
            title="Salin buat PO Jurnal Mekari (Model · Nopol · Rangka · Rute)"
            style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${copiedPo ? "#238636" : "#1f2937"}`, background: copiedPo ? "#0d2a10" : "#111826", color: copiedPo ? "#3fb950" : "#9aa4b6", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            data-testid={`adm-order-copy-po-${order.order_id}`}
          >
            {copiedPo ? "✓ Tersalin" : "📋 Copy PO"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #1f2937", background: "#111826", color: "#9aa4b6", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
            data-testid={`adm-order-toggle-${order.order_id}`}
          >
            {expanded ? "Tutup ↑" : "Buka →"}
          </button>
        </div>
      </div>

      {expanded && (
      <div style={{ borderTop: "1px solid #1a2130" }}>
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
                {order.nopol
                  ? <span className="adm-pill adm-mono">{order.nopol}</span>
                  : <i className="adm-mute">nopol belum diisi</i>}
                <button className="adm-link" onClick={() => setEditVehicle(true)} data-testid={`adm-vehicle-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>
        <div className="adm-field-row">
          <div className="adm-field-key">No Rangka</div>
          <div className="adm-field-val">
            {editRangka ? (
              <span className="adm-driver-edit-row">
                <input
                  className="adm-input-inline adm-mono"
                  value={rangkaDraft}
                  onChange={(e) => setRangkaDraft(e.target.value.toUpperCase())}
                  placeholder="MHKA..."
                  autoFocus
                  data-testid={`adm-rangka-input-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveRangka} data-testid={`adm-rangka-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditRangka(false); setRangkaDraft(order.no_rangka || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.no_rangka
                  ? <span className="adm-pill adm-mono">{order.no_rangka}</span>
                  : <i className="adm-mute">belum diisi</i>}
                <button className="adm-link" onClick={() => setEditRangka(true)} data-testid={`adm-rangka-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>

        {/* ── F1: Daftar Unit (Unit Master) ── */}
        {units.length > 0 && (
          <div className="adm-units" style={{ gridColumn: "1 / -1" }} data-testid={`adm-units-${order.order_id}`}>
            <div className="adm-units-hd">
              <span className="adm-units-title">Unit dalam PO ini ({units.length})</span>
              {uSum && (
                <div className="adm-units-sum">
                  <span className="adm-usum">Belum trip <b>{uSum.belum_trip}</b></span>
                  <span className="adm-usum">Berjalan <b>{uSum.berjalan}</b></span>
                  <span className="adm-usum">Selesai <b>{uSum.selesai}</b></span>
                  <span className="adm-usum">Belum invoice <b>{uSum.belum_invoice}</b></span>
                  <span className="adm-usum">Sudah invoice <b>{uSum.sudah_invoice}</b></span>
                </div>
              )}
            </div>
            {units.length > 1 && (
              <label className="adm-unit-all">
                <input type="checkbox" checked={allUnitsSelected} onChange={() => onCartSetOrderUnits(order, !allUnitsSelected)} data-testid={`adm-units-all-${order.order_id}`} />
                Pilih semua unit PO ini → keranjang jadwal
              </label>
            )}
            <div className="adm-unit-list">
              {units.map((u, i) => (
                <label key={u.unit_id} className={`adm-unit-item${cartHas(u.unit_id) ? " sel" : ""}`} data-testid={`adm-unit-item-${order.order_id}-${i}`}>
                  <input type="checkbox" checked={cartHas(u.unit_id)} onChange={() => onToggleCartUnit(order, u)} />
                  <span className="adm-unit-no">{i + 1}</span>
                  <span className="adm-unit-main">
                    <span className="adm-unit-veh">{u.vehicle_type || "—"}{u.tipe_model ? ` · ${u.tipe_model}` : ""}</span>
                    <span className="adm-unit-sub">{u.nopol || "nopol —"}{u.no_rangka ? ` · ${u.no_rangka}` : ""}{u.warna || u.tahun ? ` · ${u.warna || "—"}/${u.tahun || "—"}` : ""}</span>
                  </span>
                  <span className="adm-unit-tags">
                    <span className="adm-utag trip">{u.status_perjalanan || "Belum Dijadwalkan"}</span>
                    <span className="adm-utag inv">{u.status_invoice || "Belum Ditagih"}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Jadwal jemput: diminta pelanggan (read-only) + aktual driver sampai (dicatat admin) ── */}
        <div className="adm-field-row adm-full">
          <div className="adm-field-key">🕒 Jadwal Jemput (diminta)</div>
          <div className="adm-field-val">
            {jadwalDiminta
              ? <span className="adm-pill adm-mono">{jadwalDiminta}</span>
              : <i className="adm-mute">belum diisi pelanggan</i>}
          </div>
        </div>
        <div className="adm-field-row adm-full">
          <div className="adm-field-key">🚚 Driver Sampai Lokasi (aktual)</div>
          <div className="adm-field-val">
            {editArrival ? (
              <span className="adm-driver-edit-row">
                <input
                  className="adm-input-inline"
                  type="datetime-local"
                  value={arrivalDraft}
                  onChange={(e) => setArrivalDraft(e.target.value)}
                  autoFocus
                  data-testid={`adm-arrival-input-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveArrival} data-testid={`adm-arrival-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditArrival(false); setArrivalDraft(order.pickup_arrival || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.pickup_arrival
                  ? <span className="adm-pill adm-mono">{fmtDT(order.pickup_arrival)}</span>
                  : <i className="adm-mute">belum dicatat</i>}
                <button className="adm-link" onClick={() => { setArrivalDraft(order.pickup_arrival || ""); setEditArrival(true); }} data-testid={`adm-arrival-edit-${order.order_id}`}><IcoPencil /></button>
              </span>
            )}
          </div>
        </div>
        <div className="adm-field-row adm-full">
          <div className="adm-field-key">💬 WhatsApp Konfirmasi</div>
          <div className="adm-field-val">
            <span className="adm-driver-row">
              <span className="adm-pill" style={{ color: (WA_VIEW[waStatus] || WA_VIEW.belum_dikirim).color }} data-testid={`adm-wa-status-${order.order_id}`}>
                {(WA_VIEW[waStatus] || WA_VIEW.belum_dikirim).txt}
              </span>
              <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={resendWa} disabled={waBusy} data-testid={`adm-wa-resend-${order.order_id}`}>
                {waBusy ? "Mengirim…" : "🔁 Kirim Ulang"}
              </button>
            </span>
            {waStatus === "gagal" && waErr && (
              <div style={{ fontSize: 11, color: "#f0a742", marginTop: 4 }} data-testid={`adm-wa-error-${order.order_id}`}>
                Alasan: {waErr}
              </div>
            )}
          </div>
        </div>

        <div className="adm-field-row">
          <div className="adm-field-key">Jumlah Colly</div>
          <div className="adm-field-val">
            {editColly ? (
              <span className="adm-driver-edit-row">
                <input
                  className="adm-input-inline adm-mono"
                  inputMode="numeric"
                  value={collyDraft}
                  onChange={(e) => setCollyDraft(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Cth: 3"
                  autoFocus
                  data-testid={`adm-colly-input-${order.order_id}`}
                />
                <button className="adm-btn adm-btn-gold adm-btn-xs" onClick={saveColly} data-testid={`adm-colly-save-${order.order_id}`}>OK</button>
                <button className="adm-btn adm-btn-ghost adm-btn-xs" onClick={() => { setEditColly(false); setCollyDraft(order.jumlah_colly || ""); }}><IcoX /></button>
              </span>
            ) : (
              <span className="adm-driver-row">
                {order.jumlah_colly
                  ? <span className="adm-pill adm-mono">{order.jumlah_colly}</span>
                  : <i className="adm-mute">belum diisi</i>}
                <button className="adm-link" onClick={() => setEditColly(true)} data-testid={`adm-colly-edit-${order.order_id}`}><IcoPencil /></button>
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
          <button className="adm-btn adm-btn-blue adm-btn-sm" onClick={() => setShowTrip360(true)} data-testid={`adm-trip360-${order.order_id}`}>
            <IcoRoute /> Trip 360
          </button>
        )}
        {order.trip_id && (
          <button className="adm-btn adm-btn-ghost adm-btn-sm" onClick={onOpenBonus} data-testid={`adm-bonus-${order.order_id}`}>
            <IcoGift /> Bonus
          </button>
        )}
        {linkDriver && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkDriver} target="_blank" rel="noreferrer" data-testid={`adm-link-driver-${order.order_id}`}>Driver</a>}
        {linkTrack  && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkTrack}  target="_blank" rel="noreferrer" data-testid={`adm-link-track-${order.order_id}`}>Track</a>}
        {linkBastk  && <a className="adm-btn adm-btn-ghost adm-btn-sm" href={linkBastk}  target="_blank" rel="noreferrer" data-testid={`adm-link-bastk-${order.order_id}`}>BASTK</a>}
        {order.trip_id && ALBUM_STAGES.map(({ key, label, icon }) => (
          <span key={key}>
            <input
              ref={(el) => { albumFileRefs.current[key] = el; }}
              type="file"
              accept={key === "dokumen" ? "image/*,application/pdf" : "image/*"}
              multiple
              style={{ display: "none" }}
              onChange={(e) => uploadFotoAlbum(key, e.target.files)}
            />
            <button className="adm-btn adm-btn-sm" onClick={() => albumFileRefs.current[key]?.click()} disabled={uploadingStage === key}
              style={{ background: "#1a3a5c", border: "1px solid #1f6feb", color: "#60a5fa" }}
              title={`Upload foto ke album ${label} (kalau driver belum sempat)`}>
              {uploadingStage === key ? "Uploading..." : `${icon} ${label}`}
            </button>
          </span>
        ))}
        <button className="adm-btn adm-btn-sm" onClick={() => printSuratJalan()}
          style={{ background: "#1a2e1a", border: "1px solid #3fb950", color: "#3fb950" }}>
          📄 Surat Jalan
        </button>
        <button className="adm-btn adm-btn-sm" onClick={(e) => { e.stopPropagation(); setShowInvoice(true); }} data-testid={`adm-invoice-${order.order_id}`}
          style={{ background: "#1a2e3a", border: "1px solid #58a6ff", color: "#58a6ff" }}>
          🧾 Invoice
        </button>
        <button className="adm-btn adm-btn-sm" onClick={(e) => { e.stopPropagation(); setShowJadwal(true); }} data-testid={`adm-jadwal-${order.order_id}`}
          style={{ background: "#2a2410", border: "1px solid #d4a847", color: "#e6b450" }}>
          🚢 Jadwal Pengiriman
        </button>
        <button className="adm-btn adm-btn-sm" onClick={(e) => { e.stopPropagation(); setShowDupVendor(true); }} data-testid={`adm-dupvendor-${order.order_id}`}
          style={{ background: "#241a2e", border: "1px solid #a371f7", color: "#c9a2ff" }}>
          🏢 Duplikat ke Vendor
        </button>
        {showDupVendor && (
          <DuplicateVendorModal order={order} headers={headers} onClose={() => setShowDupVendor(false)} />
        )}
        {showJadwal && (
          <JadwalModal
            order={order}
            headers={headers}
            onClose={() => setShowJadwal(false)}
            onPrint={(meta, units) => {
              const noDoc = printJadwal(meta, units);
              saveDocHistory({
                jenis: "jadwal", no_dokumen: noDoc, customer: order.customer_nama || "",
                judul: `${order.customer_nama || "-"} · ${(units || []).length} unit`,
                meta: { ...meta, customer_nama: order.customer_nama, order_id: order.order_id, asal_kota: order.asal_kota, tujuan_kota: order.tujuan_kota, no_dokumen: noDoc },
                units, order_ids: [order.order_id],
              }, headers);
            }}
          />
        )}
        {showInvoice && (
          <InvoiceModal
            order={order}
            headers={headers}
            onClose={() => setShowInvoice(false)}
            onPrint={async (lines, withTax, extra) => {
              const noInv = await printInvoice(lines, withTax, extra);
              saveDocHistory({
                jenis: "invoice", no_dokumen: noInv, customer: order.customer_nama || "",
                judul: `${order.customer_nama || "-"} · ${(lines || []).length} baris`,
                meta: { ...(extra || {}), customer_nama: order.customer_nama, order_id: order.order_id, withTax: !!withTax, no_invoice: noInv },
                lines, order_ids: [order.order_id],
              }, headers);
              setShowInvoice(false);
            }}
          />
        )}
        {showTrip360 && (
          <Trip360Modal
            order={order}
            headers={headers}
            onClose={() => setShowTrip360(false)}
            onEditLegs={() => { setShowTrip360(false); onOpenLegs(); }}
            onPrintSuratJalan={() => printSuratJalan()}
            onOpenInvoice={() => { setShowTrip360(false); setShowInvoice(true); }}
          />
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
      </div>
      )}
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
   BONUS MODAL — edit bonus_daily/bonus_kerajinan untuk trip yang
   sudah jalan. Nilai ini awalnya cuma bisa diisi sekali waktu convert
   (form Convert cuma tampil selagi order.status == NEW), jadi kalau mau
   di-nol-in / diubah setelah trip aktif dulu nggak ada tempatnya.
════════════════════════════════════════ */
function BonusModal({ tripId, order, headers, onClose, onSave }) {
  const [loading, setLoading] = useState(true);
  const [bd, setBd] = useState("0");
  const [bk, setBk] = useState("0");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/trips/${tripId}`)
      .then((r) => {
        if (!alive) return;
        setBd(String(r.data?.bonus_daily ?? 0));
        setBk(String(r.data?.bonus_kerajinan ?? 0));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tripId]);

  const submit = async () => {
    setSubmitting(true);
    await onSave({ bonus_daily: parseInt(bd || "0", 10), bonus_kerajinan: parseInt(bk || "0", 10) });
    setSubmitting(false);
  };

  return (
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-bonus-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title"><IcoGift /> Atur Bonus Driver</div>
            <div className="adm-modal-sub">{order.order_id} &middot; {order.nama_driver || "Driver belum diisi"}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup"><IcoX /></button>
        </div>
        <div className="adm-modal-body">
          {loading ? (
            <div className="adm-mute">Memuat nilai bonus saat ini...</div>
          ) : (
            <div className="adm-form-grid">
              <Field label="Bonus Harian" hint="Per foto checkpoint terkirim">
                <input type="number" min="0" className="adm-input" value={bd} onChange={(e) => setBd(e.target.value)} data-testid="adm-bonus-daily" />
              </Field>
              <Field label="Bonus Kerajinan" hint="Dicairkan di Tahap 3">
                <input type="number" min="0" className="adm-input" value={bk} onChange={(e) => setBk(e.target.value)} data-testid="adm-bonus-kerajinan" />
              </Field>
            </div>
          )}
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={submitting}>Batal</button>
          <button className="adm-btn adm-btn-gold" onClick={submit} disabled={submitting || loading} data-testid="adm-bonus-submit">
            {submitting ? "Menyimpan..." : "Simpan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   INVOICE MODAL
════════════════════════════════════════ */
function InvoiceModal({ order, headers, onClose, onPrint }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  // Unit dari PO (F1). Fallback 1 unit dari field legacy kalau belum ada units[].
  const orderUnits = (Array.isArray(order.units) && order.units.length)
    ? order.units
    : [{ unit_id: "legacy", vehicle_type: order.vehicle_type, tipe_model: order.tipe_model, nopol: order.nopol, no_rangka: order.no_rangka, warna: order.warna, tahun: order.tahun, status_invoice: "Belum Ditagih" }];
  const [rows, setRows] = useState(() => orderUnits.map((u) => ({
    unit_id: u.unit_id,
    // unit yang sudah diinvoice default TIDAK dicentang (cegah dobel)
    checked: (u.status_invoice || "Belum Ditagih") === "Belum Ditagih",
    harga: "",
  })));
  const [withTax, setWithTax] = useState(true);
  const [taxInclusive, setTaxInclusive] = useState(false); // true = harga SUDAH termasuk 1.1% (pajak dipecah dari dalam)
  const [jatuhTempo, setJatuhTempo] = useState(todayIso);
  const [metode, setMetode] = useState("Cash on Delivery");
  const [pesan, setPesan] = useState("");
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("Finance & Accounting Controller");
  const [stempel, setStempel] = useState(null); // dataURL gambar stempel/ttd digital

  const onStempel = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { alert("Stempel harus berupa gambar (PNG/JPG)."); return; }
    if (f.size > 3 * 1024 * 1024) { alert("Ukuran gambar maksimal 3MB."); return; }
    const r = new FileReader();
    r.onload = () => setStempel(r.result);
    r.readAsDataURL(f);
  };

  const hargaNum = (s) => parseInt(String(s || "").replace(/[^0-9]/g, ""), 10) || 0;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  const unitKet = (u) => {
    const veh = `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan";
    const rute = `(${order.asal_kota || "—"}–${order.tujuan_kota || "—"})`;
    const rangka = u.no_rangka ? `<br>No. Rangka: ${u.no_rangka}` : "";
    return `${veh}${u.nopol ? " " + u.nopol : ""} ${rute}${rangka}`;
  };

  const subtotal = rows.reduce((s, r) => s + (r.checked ? hargaNum(r.harga) : 0), 0);
  // taxInclusive: harga yg diketik SUDAH termasuk 1.1% → pajak dipecah dari dalam (Total = subtotal).
  // else (default): 1.1% ditambah di atas harga (Total = subtotal + ppn).
  const dpp = withTax && taxInclusive ? Math.round(subtotal / 1.011) : subtotal;
  const ppn = !withTax ? 0 : (taxInclusive ? subtotal - dpp : Math.round(subtotal * 0.011));
  const total = taxInclusive ? subtotal : subtotal + ppn;
  const checkedCount = rows.filter((r) => r.checked && hargaNum(r.harga) > 0).length;
  const fRp = (n) => "Rp " + n.toLocaleString("id-ID");

  const submit = () => {
    const lines = rows
      .map((r, i) => ({ r, u: orderUnits[i] }))
      .filter(({ r }) => r.checked && hargaNum(r.harga) > 0)
      .map(({ r, u }) => ({ nama: "Jasa Pengiriman", ket: unitKet(u), qty: 1, harga: hargaNum(r.harga) }));
    if (!lines.length) return;
    // Buka jendela cetak DULU di dalam gesture klik (kalau di-await, mobile blokir popup).
    onPrint(lines, withTax, { jatuhTempo, metode, pesan, ttdNama, ttdJabatan, stempel, taxInclusive });
    // Tandai unit sudah diinvoice di belakang layar (best-effort).
    const ids = rows.filter((r) => r.checked && hargaNum(r.harga) > 0 && r.unit_id !== "legacy").map((r) => r.unit_id);
    if (ids.length && headers) {
      axios.post(`${API}/admin/orders/${order.order_id}/units/mark-invoiced`, { unit_ids: ids }, { headers }).catch(() => {});
    }
  };

  return createPortal((
    <div className="adm-vars">
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-invoice-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">🧾 Buat Invoice</div>
            <div className="adm-modal-sub">{order.order_id} &middot; {order.customer_nama || "—"}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="adm-modal-body">
          <div className="adm-modal-info" style={{ marginBottom: 14 }}>
            {order.asal_kota || "—"} &rarr; {order.tujuan_kota || "—"} · <strong>{orderUnits.length} unit</strong> di PO ini
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, marginBottom: 8 }}>Unit yang Ditagih &amp; Harga (per unit)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {rows.map((r, i) => {
              const u = orderUnits[i];
              const invoiced = (u.status_invoice || "Belum Ditagih") !== "Belum Ditagih";
              return (
                <div key={u.unit_id} className="adm-invu" data-testid={`adm-invu-${i}`}>
                  <input type="checkbox" checked={r.checked} onChange={(e) => setRow(i, { checked: e.target.checked })} data-testid={`adm-invu-check-${i}`} style={{ width: 16, height: 16, accentColor: "#58a6ff", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {i + 1}. {u.vehicle_type || "—"}{u.tipe_model ? ` · ${u.tipe_model}` : ""}
                      {invoiced && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: "var(--gold-xl)", background: "var(--gold-bg)", padding: "1px 6px", borderRadius: 4 }}>SUDAH DIINVOICE</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>{u.nopol || "nopol —"}{u.no_rangka ? ` · ${u.no_rangka}` : ""}</div>
                  </div>
                  <div className="adm-invu-harga">
                    <span>Rp</span>
                    <input inputMode="numeric" value={r.harga ? hargaNum(r.harga).toLocaleString("id-ID") : ""} placeholder="0"
                      onChange={(e) => setRow(i, { harga: e.target.value, checked: hargaNum(e.target.value) > 0 ? true : r.checked })} data-testid={`adm-invu-harga-${i}`} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Jatuh Tempo</span>
              <input type="date" className="adm-input" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)} data-testid="adm-invoice-tempo" />
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Metode Pembayaran</span>
              <select className="adm-input" value={metode} onChange={(e) => setMetode(e.target.value)} data-testid="adm-invoice-metode">
                <option>Cash on Delivery</option>
                <option>Transfer Bank</option>
              </select>
            </label>
          </div>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Pesan / Catatan (opsional)</span>
            <input type="text" className="adm-input" value={pesan} onChange={(e) => setPesan(e.target.value)} placeholder="contoh: Door to door" data-testid="adm-invoice-pesan" />
          </label>

          {/* ── Penandatangan + stempel digital ── */}
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, marginBottom: 8 }}>Penandatangan</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <label style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Nama</span>
                <input type="text" className="adm-input" value={ttdNama} onChange={(e) => setTtdNama(e.target.value)} placeholder="contoh: Ulpah" data-testid="adm-invoice-ttd-nama" />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Jabatan</span>
                <input type="text" className="adm-input" value={ttdJabatan} onChange={(e) => setTtdJabatan(e.target.value)} placeholder="contoh: Finance & Accounting Controller" data-testid="adm-invoice-ttd-jabatan" />
              </label>
            </div>
            <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Stempel / Tanda Tangan Digital (opsional — PNG/JPG)</span>
            {stempel ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={stempel} alt="stempel" style={{ height: 60, borderRadius: 6, border: "1px solid var(--border)", background: "#fff", padding: 4 }} />
                <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => setStempel(null)} data-testid="adm-invoice-stempel-clear">Hapus stempel</button>
              </div>
            ) : (
              <input type="file" accept="image/*" className="adm-input" onChange={onStempel} data-testid="adm-invoice-stempel" />
            )}
            <div style={{ fontSize: 10.5, color: "var(--text-mute)", marginTop: 6 }}>Disarankan gambar latar transparan (PNG). Muncul di atas nama penandatangan pada invoice.</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={withTax}
              onChange={(e) => setWithTax(e.target.checked)}
              style={{ accentColor: "#58a6ff", width: 16, height: 16 }}
              data-testid="adm-invoice-tax"
            />
            <span>Kenakan PPN Logistik (1.1%)</span>
          </label>
          {withTax && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer", paddingLeft: 26 }}>
              <input
                type="checkbox"
                checked={taxInclusive}
                onChange={(e) => setTaxInclusive(e.target.checked)}
                style={{ accentColor: "#58a6ff", width: 16, height: 16 }}
                data-testid="adm-invoice-tax-inclusive"
              />
              <span style={{ fontSize: 13 }}>Harga sudah termasuk pajak 1.1% <span style={{ color: "var(--text-mute)" }}>(pajak dipecah dari dalam, total nggak nambah)</span></span>
            </label>
          )}
          {subtotal > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--text-3)" }}><span>{withTax && taxInclusive ? `DPP (${checkedCount} unit)` : `Subtotal (${checkedCount} unit)`}</span><span>{fRp(withTax && taxInclusive ? dpp : subtotal)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--text-3)" }}><span>PPN 1.1%{withTax && taxInclusive ? " (termasuk)" : ""}</span><span>{withTax ? fRp(ppn) : "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 0", marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 800 }}><span>Total</span><span>{fRp(total)}</span></div>
            </div>
          )}
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Batal</button>
          <button className="adm-btn adm-btn-blue" onClick={submit} disabled={checkedCount === 0} data-testid="adm-invoice-submit">
            {`Cetak Invoice${checkedCount > 1 ? ` (${checkedCount} unit)` : ""}`}
          </button>
        </div>
      </div>
    </div>
    </div>
  ), document.body);
}

/* ════════════════════════════════════════
   JADWAL PENGIRIMAN MODAL — tarik unit dari PO, isi kapal/ETD, cetak A4
════════════════════════════════════════ */
function jpAddDays(iso, n) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !n) return "";
  const dt = new Date(iso + "T00:00:00"); dt.setDate(dt.getDate() + Number(n));
  return dt.toISOString().slice(0, 10);
}
function jpFmt(iso) { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—"; const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; }

function JadwalModal({ order, headers, onClose, onPrint }) {
  const units = (Array.isArray(order.units) && order.units.length) ? order.units : [];
  const [pelabuhanAsal, setPelabuhanAsal] = useState(order.pelabuhan_asal || order.asal_kota || "");
  const [tanggalSiap, setTanggalSiap] = useState(order.tanggal_siap || order.pickup_date || "");
  const [catatan, setCatatan] = useState(order.catatan_jadwal || "");
  const [rows, setRows] = useState(() => units.map((u) => ({
    unit_id: u.unit_id, tujuan: u.tujuan || "", no_mesin: u.no_mesin || "",
    nama_kapal: u.nama_kapal || "", etd: u.etd || "", transit_hari: u.transit_hari || "",
  })));
  const [bulk, setBulk] = useState({ nama_kapal: "", etd: "", transit_hari: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const setRow = (i, patch) => setRows((rs) => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  const applyBulk = () => setRows((rs) => rs.map((r) => ({
    ...r,
    nama_kapal: bulk.nama_kapal || r.nama_kapal,
    etd: bulk.etd || r.etd,
    transit_hari: bulk.transit_hari !== "" ? bulk.transit_hari : r.transit_hari,
  })));

  const payload = () => ({
    tanggal_siap: tanggalSiap || "", catatan_jadwal: catatan || "", pelabuhan_asal: pelabuhanAsal || "",
    units: rows.map((r) => ({ unit_id: r.unit_id, tujuan: r.tujuan, no_mesin: r.no_mesin, nama_kapal: r.nama_kapal, etd: r.etd, transit_hari: parseInt(r.transit_hari, 10) || 0 })),
  });

  const save = async () => {
    setSaving(true); setErr("");
    try { await axios.patch(`${API}/admin/orders/${order.order_id}/jadwal`, payload(), { headers }); }
    catch (e) { setErr(e?.response?.data?.detail || "Gagal menyimpan jadwal."); setSaving(false); return false; }
    setSaving(false); return true;
  };

  const printRows = () => units.map((u, i) => ({
    ...u,
    tujuan: rows[i]?.tujuan || u.tujuan,
    no_mesin: rows[i]?.no_mesin || u.no_mesin,
    nama_kapal: rows[i]?.nama_kapal || "",
    etd: rows[i]?.etd || "",
    transit_hari: parseInt(rows[i]?.transit_hari, 10) || 0,
  }));

  const doPrint = () => {
    // Cetak dulu di dalam gesture klik (mobile blokir popup kalau nunggu await), simpan di belakang layar.
    onPrint({ tanggal_siap: tanggalSiap, catatan_jadwal: catatan, pelabuhan_asal: pelabuhanAsal }, printRows());
    save();
    onClose();
  };

  if (!units.length) {
    return createPortal((
      <div className="adm-vars">
      <div className="adm-modal-bg" onClick={onClose}>
        <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
          <div className="adm-modal-head"><div className="adm-modal-title">🚢 Jadwal Pengiriman</div><button className="adm-modal-close" onClick={onClose}>✕</button></div>
          <div className="adm-modal-body"><div style={{ fontSize: 13, color: "var(--text-mute)" }}>PO ini belum punya unit. Tidak ada yang bisa dijadwalkan.</div></div>
        </div>
      </div>
      </div>
    ), document.body);
  }

  return createPortal((
    <div className="adm-vars">
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-jadwal-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">🚢 Jadwal Pengiriman</div>
            <div className="adm-modal-sub">{order.order_id} · {order.customer_nama || "—"} · {units.length} unit</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="adm-modal-body">
          {err && <div className="t360-fin-err" style={{ marginBottom: 12 }}>{err}</div>}

          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 150 }}>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Pelabuhan Asal</span>
              <input className="adm-input" value={pelabuhanAsal} onChange={(e) => setPelabuhanAsal(e.target.value)} placeholder="Pelabuhan Surabaya" data-testid="adm-jadwal-asal" />
            </label>
            <label style={{ flex: 1, minWidth: 150 }}>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Tanggal Siap Unit</span>
              <input type="date" className="adm-input" value={tanggalSiap} onChange={(e) => setTanggalSiap(e.target.value)} data-testid="adm-jadwal-siap" />
            </label>
          </div>

          <div className="jm-list">
            {rows.map((r, i) => {
              const u = units[i];
              const eta = jpAddDays(r.etd, parseInt(r.transit_hari, 10) || 0);
              return (
                <div key={r.unit_id} className="jm-unit" data-testid={`adm-jadwal-unit-${i}`}>
                  <div className="jm-unit-hd">{i + 1}. {u.vehicle_type || "—"}{u.tipe_model ? ` · ${u.tipe_model}` : ""} <span className="jm-nopol">{u.nopol || "nopol —"}</span></div>
                  <div className="jm-grid">
                    <label>Tujuan<input className="adm-input" value={r.tujuan} onChange={(e) => setRow(i, { tujuan: e.target.value.toUpperCase() })} placeholder={order.tujuan_kota || "kota tujuan"} data-testid={`adm-jadwal-tujuan-${i}`} /></label>
                    <label>No. Mesin<input className="adm-input" value={r.no_mesin} onChange={(e) => setRow(i, { no_mesin: e.target.value.toUpperCase() })} placeholder="2GDXXXX" data-testid={`adm-jadwal-mesin-${i}`} /></label>
                    <label>Nama Kapal<input list="kapal-dl" className="adm-input" value={r.nama_kapal} onChange={(e) => setRow(i, { nama_kapal: e.target.value })} placeholder="Serasi V" /></label>
                    <label>Kapal Berangkat<input type="date" className="adm-input" value={r.etd} onChange={(e) => setRow(i, { etd: e.target.value })} /></label>
                    <label>Transit (hr)<input inputMode="numeric" className="adm-input" value={r.transit_hari} onChange={(e) => setRow(i, { transit_hari: e.target.value.replace(/\D/g, "") })} placeholder="4" /></label>
                    <div className="jm-eta">Estimasi Tiba<b>{eta ? jpFmt(eta) : "—"}</b></div>
                  </div>
                </div>
              );
            })}
          </div>

          <label style={{ display: "block", marginTop: 12 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Catatan Jadwal (opsional)</span>
            <input className="adm-input" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. muat di gudang Tanjung Perak" data-testid="adm-jadwal-catatan" />
          </label>
          <div style={{ fontSize: 10.5, color: "var(--text-mute)", marginTop: 8, lineHeight: 1.5 }}>
            ⚓ Estimasi Tiba dihitung <b>sejak kapal berangkat</b> (ETD + transit), bukan dari serah terima di pelabuhan. Catatan ini tercetak di dokumen.
          </div>
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Tutup</button>
          <button className="adm-btn" onClick={save} disabled={saving} data-testid="adm-jadwal-save">{saving ? "…" : "Simpan"}</button>
          <button className="adm-btn adm-btn-gold" onClick={doPrint} disabled={saving} data-testid="adm-jadwal-print">🖨️ Simpan &amp; Cetak</button>
        </div>
      </div>
    </div>
    </div>
  ), document.body);
}

/* ════════════════════════════════════════
   HISTORI DOKUMEN — simpan tiap dokumen yang dicetak (fire-and-forget)
════════════════════════════════════════ */
function saveDocHistory(rec, headers) {
  try {
    axios.post(`${API}/admin/doc-history`, rec, { headers }).catch(() => {});
  } catch (e) { /* jangan sampai ganggu cetak */ }
}

const DOC_HIST_FILTERS = [
  { key: "", label: "Semua" },
  { key: "invoice", label: "Invoice" },
  { key: "jadwal", label: "Jadwal Pengiriman" },
  { key: "jadwal_gabungan", label: "Jadwal Gabungan" },
];
const DOC_HIST_BADGE = {
  invoice: { txt: "Invoice", bg: "rgba(91,141,239,0.18)", fg: "#9dbcff" },
  jadwal: { txt: "Jadwal", bg: "rgba(51,181,124,0.18)", fg: "#7ee0af" },
  jadwal_gabungan: { txt: "Jadwal Gabungan", bg: "rgba(201,151,58,0.20)", fg: "#e6c375" },
};

function HistoriDokumen({ headers }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const q = filter ? `?jenis=${encodeURIComponent(filter)}` : "";
      const { data } = await axios.get(`${API}/admin/doc-history${q}`, { headers });
      setItems(data.items || []);
    } catch (e) {
      setErr("Gagal memuat histori dokumen.");
    } finally { setLoading(false); }
  }, [filter, headers]);

  useEffect(() => { load(); }, [load]);

  const reprint = (rec) => {
    if (rec.jenis === "invoice") {
      printInvoiceDoc(rec.lines, rec.meta?.withTax, rec.meta || {});
    } else if (rec.jenis === "jadwal") {
      printJadwalDoc(rec.meta || {}, rec.units || []);
    } else if (rec.jenis === "jadwal_gabungan") {
      printJadwalGabungan(rec.meta || {}, rec.units || []);
    }
  };

  const del = async (rec) => {
    if (!window.confirm(`Hapus dokumen ini dari histori?\n\n${rec.no_dokumen || rec.jenis_label}\n${rec.customer || ""}`)) return;
    // optimistic
    setItems((xs) => xs.filter((x) => x.id !== rec.id));
    try {
      await axios.delete(`${API}/admin/doc-history/${rec.id}`, { headers });
    } catch (e) {
      alert("Gagal menghapus. Muat ulang halaman.");
      load();
    }
  };

  const fmtWhen = (iso) => {
    if (!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) +
        " · " + d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    } catch { return iso.slice(0, 16).replace("T", " "); }
  };

  const countUnits = (rec) =>
    rec.jenis === "invoice" ? `${(rec.lines || []).length} baris` : `${(rec.units || []).length} unit`;

  return (
    <div className="adm-dochist" data-testid="adm-dochist">
      <div className="adm-dochist-filters">
        {DOC_HIST_FILTERS.map((f) => (
          <button key={f.key || "all"}
            className={`adm-dochist-chip${filter === f.key ? " active" : ""}`}
            onClick={() => setFilter(f.key)} data-testid={`dochist-filter-${f.key || "all"}`}>
            {f.label}
          </button>
        ))}
        <button className="adm-dochist-chip" onClick={load} title="Muat ulang" style={{ marginLeft: "auto" }}>↻</button>
      </div>

      {loading ? (
        <div className="adm-dochist-empty">Memuat…</div>
      ) : err ? (
        <div className="adm-dochist-empty" style={{ color: "#e06b6b" }}>{err}</div>
      ) : items.length === 0 ? (
        <div className="adm-dochist-empty">
          <div style={{ fontSize: 30, marginBottom: 8 }}>🗂️</div>
          Belum ada dokumen tersimpan.<br />
          <span style={{ fontSize: 12, opacity: 0.75 }}>Setiap kali kamu cetak Invoice atau Jadwal Pengiriman, otomatis muncul di sini.</span>
        </div>
      ) : (
        <div className="adm-dochist-list">
          {items.map((rec) => {
            const badge = DOC_HIST_BADGE[rec.jenis] || { txt: rec.jenis_label || rec.jenis, bg: "rgba(255,255,255,0.08)", fg: "#cbd5e1" };
            return (
              <div key={rec.id} className="adm-dochist-row" data-testid="dochist-row">
                <span className="adm-dochist-badge" style={{ background: badge.bg, color: badge.fg }}>{badge.txt}</span>
                <div className="adm-dochist-main">
                  <div className="adm-dochist-no">{rec.no_dokumen || "(tanpa nomor)"}</div>
                  <div className="adm-dochist-sub">
                    {rec.customer || "—"} · {countUnits(rec)}
                    {rec.order_ids?.length > 1 ? ` · ${rec.order_ids.length} PO` : ""}
                  </div>
                </div>
                <div className="adm-dochist-when">{fmtWhen(rec.created_at)}</div>
                <div className="adm-dochist-actions">
                  <button className="adm-btn adm-btn-ghost adm-dochist-btn" onClick={() => reprint(rec)} data-testid="dochist-print">🖨️ Cetak ulang</button>
                  <button className="adm-btn adm-dochist-btn adm-dochist-del" onClick={() => del(rec)} data-testid="dochist-del">🗑️ Hapus</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Cetak Faktur/Invoice (fungsi modul, bisa dicetak ulang dari Histori) ──
   extra: { customer_nama, order_id, jatuhTempo, metode, pesan, ttdNama,
            ttdJabatan, stempel, no_invoice? }  → return nomor faktur */
async function printInvoiceDoc(lines, withTax, extra) {
  extra = extra || {};
  // Back-compat: kalau dipanggil dengan angka tunggal, bungkus jadi 1 baris.
  if (typeof lines === "number") lines = [{ nama: "Jasa Pengiriman", ket: "", qty: 1, harga: lines }];
  lines = (lines || []).filter((l) => (l.harga || 0) > 0);
  if (!lines.length) return "";
  const w = window.open("", "_blank"); // buka dulu (gesture) biar nggak keblok popup
  const { jatuhTempo, metode, pesan, ttdNama, ttdJabatan, stempel, taxInclusive } = extra;
  const subtotal = lines.reduce((s, l) => s + (l.harga || 0) * (l.qty || 1), 0);
  // taxInclusive: harga SUDAH termasuk 1.1% → pajak dipecah dari dalam (total = subtotal).
  const dpp = withTax && taxInclusive ? Math.round(subtotal / 1.011) : subtotal;
  const ppn = !withTax ? 0 : (taxInclusive ? subtotal - dpp : Math.round(subtotal * 0.011));
  const total = taxInclusive ? subtotal : subtotal + ppn;
  const fRp = (n) => n.toLocaleString("id-ID") + ",00";
  const fmtTgl = (iso) => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
  const todayIso = new Date().toISOString().slice(0, 10);
  const tgl = fmtTgl(todayIso);
  const noInvoice = extra.no_invoice || await nextDocNo("invoice", "INV"); // nomor auto-increment

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${noInvoice}</title>
  <style>
    ${DOC_BASE_CSS}
    .inv-meta-row { display:flex; justify-content:space-between; gap:24px; margin-bottom:16px; }
    .inv-billto .lbl { font-size:9px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.5px; margin-bottom:4px; }
    .inv-billto .val { font-size:14px; font-weight:800; color:${DOC_BRAND.ink}; }
    .inv-meta-table { border-collapse:collapse; font-size:10.5px; }
    .inv-meta-table td { padding:2.5px 0; }
    .inv-meta-table td:first-child { color:${DOC_BRAND.muted}; padding-right:18px; white-space:nowrap; }
    .inv-meta-table td:last-child { font-weight:700; text-align:right; }
    .inv-total-bar { display:flex; justify-content:space-between; align-items:center; background:${DOC_BRAND.navyDeep}; color:#fff; padding:10px 16px; border-radius:6px; margin-bottom:18px; }
    .inv-total-bar span:first-child { font-size:10.5px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; opacity:.85; }
    .inv-total-bar span:last-child { font-size:15px; font-weight:900; }
    table.inv-items { width:100%; border-collapse:collapse; margin-bottom:14px; }
    table.inv-items thead { display:table-header-group; }
    table.inv-items tr { break-inside:avoid; page-break-inside:avoid; }
    table.inv-items th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.4px; color:${DOC_BRAND.muted}; font-weight:700; padding:7px 8px; border-bottom:1.5px solid ${DOC_BRAND.navy}; }
    table.inv-items td { padding:10px 8px; font-size:11px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; background:${DOC_BRAND.paperMist}; }
    table.inv-items .num { text-align:right; }
    .inv-summary { display:flex; justify-content:space-between; gap:24px; margin-bottom:18px; }
    .inv-note { flex:1; font-size:10px; color:${DOC_BRAND.muted}; line-height:1.7; }
    .inv-note b { color:${DOC_BRAND.ink}; }
    .inv-totals-box { width:230px; }
    .inv-totals-box .row { display:flex; justify-content:space-between; padding:5px 0; font-size:10.5px; color:${DOC_BRAND.muted}; }
    .inv-totals-box .row.grand { border-top:1.5px solid ${DOC_BRAND.navy}; margin-top:4px; padding-top:8px; font-size:13px; font-weight:900; color:${DOC_BRAND.navy}; }
    .inv-pay-box { display:flex; align-items:center; gap:12px; padding:12px 16px; background:${DOC_BRAND.paperMist}; border-radius:8px; margin-bottom:20px; }
    .inv-pay-badge { width:40px; height:40px; border-radius:7px; background:${DOC_BRAND.navy}; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:10px; flex-shrink:0; }
    .inv-pay-num { font-size:14px; font-weight:900; letter-spacing:.5px; color:${DOC_BRAND.ink}; }
    .inv-pay-name { font-size:9.5px; color:${DOC_BRAND.muted}; margin-top:1px; }
    .inv-sign-row { display:flex; justify-content:flex-end; margin-top:26px; }
    .inv-sign-cell { width:260px; text-align:center; position:relative; }
    .inv-sign-lbl { font-size:10px; color:${DOC_BRAND.muted}; margin-bottom:6px; }
    .inv-sign-stamp { height:78px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
    .inv-sign-stamp img { max-height:78px; max-width:200px; object-fit:contain; }
    .inv-sign-stamp.empty { height:56px; }
    .inv-sign-pt { font-size:11px; font-weight:800; color:${DOC_BRAND.ink}; }
    .inv-sign-name { font-size:11px; font-weight:800; color:${DOC_BRAND.ink}; margin-top:2px; }
    .inv-sign-jab { font-size:9.5px; color:${DOC_BRAND.muted}; margin-top:2px; }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "FAKTUR / INVOICE" })}
    <div class="inv-meta-row">
      <div class="inv-billto">
        <div class="lbl">Ditagihkan Kepada</div>
        <div class="val">${extra.customer_nama || "&nbsp;"}</div>
      </div>
      <table class="inv-meta-table">
        <tr><td>Faktur #</td><td>${noInvoice}</td></tr>
        <tr><td>Tanggal</td><td>${tgl}</td></tr>
        <tr><td>Jatuh Tempo</td><td>${fmtTgl(jatuhTempo)}</td></tr>
        <tr><td>Metode Pembayaran</td><td>${metode || "Cash on Delivery"}</td></tr>
        <tr><td>No. Pesanan</td><td>${extra.order_id || "—"}</td></tr>
      </table>
    </div>
    <div class="inv-total-bar"><span>Total Tagihan</span><span>Rp ${fRp(total)}</span></div>
    <table class="inv-items">
      <thead><tr><th style="width:26px">No</th><th>Nama Barang</th><th>Keterangan</th><th>Qty</th><th>Harga Satuan (Rp)</th><th>Jumlah (Rp)</th></tr></thead>
      <tbody>
        ${lines.map((l, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${l.nama || "Jasa Pengiriman"}</td>
          <td>${l.ket || "&nbsp;"}</td>
          <td class="num">${l.qty || 1}</td>
          <td class="num">${fRp(l.harga)}</td>
          <td class="num">${fRp((l.harga || 0) * (l.qty || 1))}</td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="inv-summary">
      <div class="inv-note">
        ${pesan ? `<b>Pesan:</b> ${pesan}<br>` : ""}
        <b>Jumlah Unit:</b> ${lines.length}<br>
        <b>Terbilang:</b> <i>${terbilangRupiah(total)}</i>
      </div>
      <div class="inv-totals-box">
        <div class="row"><span>${withTax && taxInclusive ? "DPP (Dasar Pengenaan Pajak)" : "Subtotal"}</span><span>Rp ${fRp(withTax && taxInclusive ? dpp : subtotal)}</span></div>
        <div class="row"><span>PPN Logistik (1.1%)${withTax && taxInclusive ? " — termasuk" : ""}</span><span>${withTax ? "Rp " + fRp(ppn) : "—"}</span></div>
        <div class="row grand"><span>TOTAL</span><span>Rp ${fRp(total)}</span></div>
      </div>
    </div>
    <div class="inv-pay-box">
      <div class="inv-pay-badge">${DOC_BRAND.bank.name}</div>
      <div>
        <div class="inv-pay-num">${DOC_BRAND.bank.norek}</div>
        <div class="inv-pay-name">Cabang ${DOC_BRAND.bank.cabang} &middot; a.n. ${DOC_BRAND.bank.an}</div>
      </div>
    </div>
    <div class="inv-sign-row">
      <div class="inv-sign-cell">
        <div class="inv-sign-lbl">Hormat Kami,</div>
        <div class="inv-sign-stamp ${stempel ? "" : "empty"}">${stempel ? `<img src="${stempel}" alt="stempel">` : ""}</div>
        <div class="inv-sign-pt">PT. Alyssa Auto Logistik</div>
        ${ttdNama ? `<div class="inv-sign-name">( ${ttdNama} )</div>` : ""}
        ${ttdJabatan ? `<div class="inv-sign-jab">${ttdJabatan}</div>` : ""}
      </div>
    </div>
    ${docFooter({ docNo: `Faktur ${noInvoice}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  if (w) { w.document.write(html); w.document.close(); }
  return noInvoice;
}

/* ── Cetak Jadwal Pengiriman per-PO (fungsi modul, bisa dicetak ulang) ──
   meta: { customer_nama, order_id, asal_kota, tujuan_kota, pelabuhan_asal,
           tanggal_siap, catatan_jadwal, no_dokumen? }  → return no dokumen */
function printJadwalDoc(meta, units) {
  meta = meta || {};
  const rows = (units || []).filter(Boolean);
  if (!rows.length) return "";
  const fmtTgl = (iso) => { if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—"; const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`; };
  const addDays = (iso, n) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso) || !n) return "";
    const dt = new Date(iso + "T00:00:00"); dt.setDate(dt.getDate() + Number(n));
    return dt.toISOString().slice(0, 10);
  };
  const noDoc = meta.no_dokumen || `JP/AAL/${(meta.order_id || "").slice(-4) || "0000"}/${new Date().getFullYear()}`;
  const asal = meta.pelabuhan_asal || meta.asal_kota || "—";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Jadwal Pengiriman ${meta.order_id || ""}</title>
  <style>
    ${DOC_BASE_CSS}
    .jp-meta { display:flex; justify-content:space-between; gap:24px; margin-bottom:12px; font-size:10.5px; }
    .jp-meta .lbl { font-size:8.5px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.4px; }
    .jp-meta .val { font-size:12px; font-weight:800; color:${DOC_BRAND.ink}; }
    .jp-meta table td { padding:2px 0; }
    .jp-meta table td:first-child { color:${DOC_BRAND.muted}; padding-right:14px; white-space:nowrap; }
    .jp-meta table td:last-child { font-weight:700; text-align:right; }
    table.jp { width:100%; border-collapse:collapse; margin-bottom:10px; }
    table.jp thead { display:table-header-group; }
    table.jp tr { break-inside:avoid; page-break-inside:avoid; }
    table.jp th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.2px; color:#fff; background:${DOC_BRAND.navy}; font-weight:700; padding:7px 7px; }
    table.jp td { padding:7px 7px; font-size:10.5px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.jp tbody tr:nth-child(even) td { background:${DOC_BRAND.paperMist}; }
    table.jp .c { text-align:center; }
    table.jp .mono { font-family:${DOC_BRAND.mono || "monospace"}; }
    .jp-note { border:1px solid ${DOC_BRAND.gold || "#d4a847"}; background:#fdf6e6; border-radius:6px; padding:10px 14px; font-size:10.5px; color:${DOC_BRAND.ink}; margin-top:8px; line-height:1.65; }
    .jp-note b { color:#8a6d10; }
    @page { size:A4; margin:12mm; }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "JADWAL PENGIRIMAN" })}
    <div class="jp-meta">
      <div>
        <div class="lbl">Pelanggan</div>
        <div class="val">${meta.customer_nama || "&nbsp;"}</div>
        <div style="font-size:10px;color:${DOC_BRAND.muted};margin-top:3px">Pelabuhan Asal: <b style="color:${DOC_BRAND.ink}">${asal}</b> &middot; ${rows.length} unit</div>
      </div>
      <table>
        <tr><td>No. Dokumen</td><td>${noDoc}</td></tr>
        <tr><td>No. Pesanan</td><td>${meta.order_id || "—"}</td></tr>
        <tr><td>Tanggal Siap Unit</td><td>${fmtTgl(meta.tanggal_siap)}</td></tr>
        <tr><td>Dicetak</td><td>${fmtTgl(new Date().toISOString().slice(0, 10))}</td></tr>
      </table>
    </div>
    <table class="jp">
      <thead><tr>
        <th class="c" style="width:22px">No</th><th>Unit / Tipe</th><th>No. Polisi</th><th>No. Rangka</th><th>No. Mesin</th>
        <th>Tujuan</th><th>Nama Kapal</th><th>Kapal Berangkat</th><th>Estimasi Tiba</th>
      </tr></thead>
      <tbody>
        ${rows.map((u, i) => {
          const eta = addDays(u.etd, u.transit_hari);
          const tj = u.tujuan || meta.tujuan_kota || "—";
          const veh = `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "—";
          return `<tr>
            <td class="c">${i + 1}</td>
            <td>${veh}</td>
            <td class="mono">${u.nopol || "—"}</td>
            <td class="mono">${u.no_rangka || "—"}</td>
            <td class="mono">${u.no_mesin || "—"}</td>
            <td>${tj}</td>
            <td>${u.nama_kapal || "—"}</td>
            <td>${fmtTgl(u.etd)}</td>
            <td><b>${eta ? fmtTgl(eta) : "—"}</b>${u.transit_hari ? ` <span style="color:${DOC_BRAND.muted};font-size:9px">(${u.transit_hari} hr)</span>` : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="jp-note">
      <b>Catatan penting:</b> Estimasi perjalanan laut dihitung sejak <b>KAPAL BERANGKAT</b>, bukan dari pengambilan/serah terima unit di pelabuhan. Estimasi Tiba = Tanggal Kapal Berangkat + lama pelayaran. Jadwal dapat berubah mengikuti kondisi cuaca &amp; operasional pelayaran.
      ${meta.catatan_jadwal ? `<br><br><b>Catatan tambahan:</b> ${meta.catatan_jadwal}` : ""}
    </div>
    ${docFooter({ docNo: `Jadwal ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  return noDoc;
}

/* ════════════════════════════════════════
   JADWAL PENGIRIMAN GABUNGAN — kumpulin unit lintas-PO ke 1 A4 (gold)
════════════════════════════════════════ */
function printJadwalGabungan(meta, units) {
  const rows = (units || []).filter(Boolean);
  if (!rows.length) return "";
  const noDoc = meta.no_dokumen || `JP/AAL/GAB-${new Date().toISOString().slice(0,10).replace(/-/g,"").slice(2)}/${new Date().getFullYear()}`;
  const asal = meta.pelabuhan_asal || "—";
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Jadwal Pengiriman Gabungan</title>
  <style>
    ${DOC_BASE_CSS}
    .doc-brand-name { color:${DOC_BRAND.gold} !important; }
    .doc-title { color:${DOC_BRAND.gold} !important; }
    .jp-meta { display:flex; justify-content:space-between; gap:24px; margin-bottom:12px; font-size:10.5px; }
    .jp-meta .lbl { font-size:8.5px; font-weight:700; text-transform:uppercase; color:${DOC_BRAND.muted}; letter-spacing:.4px; }
    .jp-meta .val { font-size:12px; font-weight:800; color:${DOC_BRAND.ink}; }
    .jp-meta table td { padding:2px 0; }
    .jp-meta table td:first-child { color:${DOC_BRAND.muted}; padding-right:14px; white-space:nowrap; }
    .jp-meta table td:last-child { font-weight:700; text-align:right; }
    table.jp { width:100%; border-collapse:collapse; margin-bottom:10px; }
    table.jp thead { display:table-header-group; }
    table.jp tr { break-inside:avoid; page-break-inside:avoid; }
    table.jp th { text-align:left; font-size:9px; text-transform:uppercase; letter-spacing:.2px; color:#fff; background:${DOC_BRAND.gold}; font-weight:700; padding:7px 7px; }
    table.jp td { padding:7px 7px; font-size:10.5px; border-bottom:1px solid ${DOC_BRAND.line}; vertical-align:top; }
    table.jp tbody tr:nth-child(even) td { background:#fbf6ea; }
    table.jp .c { text-align:center; }
    table.jp .mono { font-family:${DOC_BRAND.mono || "monospace"}; }
    .jp-note { border:1px solid ${DOC_BRAND.gold}; background:#fdf6e6; border-radius:6px; padding:10px 14px; font-size:10.5px; color:${DOC_BRAND.ink}; margin-top:8px; line-height:1.65; }
    .jp-note b { color:#8a6d10; }
    @page { size:A4; margin:12mm; }
  </style></head><body>
  <div class="doc-sheet">
    ${docHeader({ docTitle: "JADWAL PENGIRIMAN" })}
    <div class="jp-meta">
      <div>
        <div class="lbl">Pelanggan</div>
        <div class="val">${meta.customer_nama || "&nbsp;"}</div>
        <div style="font-size:10px;color:${DOC_BRAND.muted};margin-top:3px">Pelabuhan Asal: <b style="color:${DOC_BRAND.ink}">${asal}</b> &middot; ${rows.length} unit</div>
      </div>
      <table>
        <tr><td>No. Dokumen</td><td>${noDoc}</td></tr>
        <tr><td>Tanggal Siap Unit</td><td>${jpFmt(meta.tanggal_siap)}</td></tr>
        <tr><td>Dicetak</td><td>${jpFmt(new Date().toISOString().slice(0,10))}</td></tr>
      </table>
    </div>
    <table class="jp">
      <thead><tr>
        <th class="c" style="width:22px">No</th><th>Unit / Tipe</th><th>No. Polisi</th><th>No. Rangka</th><th>No. Mesin</th>
        <th>Tujuan</th><th>Nama Kapal</th><th>Kapal Berangkat</th><th>Estimasi Tiba</th>
      </tr></thead>
      <tbody>
        ${rows.map((u, i) => {
          const eta = jpAddDays(u.etd, u.transit_hari);
          const veh = `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "—";
          return `<tr>
            <td class="c">${i + 1}</td>
            <td>${veh}</td>
            <td class="mono">${u.nopol || "—"}</td>
            <td class="mono">${u.no_rangka || "—"}</td>
            <td class="mono">${u.no_mesin || "—"}</td>
            <td>${u.tujuan || "—"}</td>
            <td>${u.nama_kapal || "—"}</td>
            <td>${jpFmt(u.etd)}</td>
            <td><b>${eta ? jpFmt(eta) : "—"}</b>${u.transit_hari ? ` <span style="color:${DOC_BRAND.muted};font-size:9px">(${u.transit_hari} hr)</span>` : ""}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="jp-note">
      <b>Catatan penting:</b> Estimasi perjalanan laut dihitung sejak <b>KAPAL BERANGKAT</b>, bukan dari pengambilan/serah terima unit di pelabuhan. Estimasi Tiba = Tanggal Kapal Berangkat + lama pelayaran. Jadwal dapat berubah mengikuti kondisi cuaca &amp; operasional pelayaran.
      ${meta.catatan_jadwal ? `<br><br><b>Catatan tambahan:</b> ${meta.catatan_jadwal}` : ""}
    </div>
    ${docFooter({ docNo: `Jadwal ${noDoc}` })}
  </div>
  <script>window.onload=()=>window.print()<\/script>
  </body></html>`;
  const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  return noDoc;
}

function JadwalGabunganModal({ cart, headers, onClose, onDone }) {
  const customers = Array.from(new Set(cart.map((c) => c.customer_nama).filter(Boolean)));
  const [pelabuhanAsal, setPelabuhanAsal] = useState(cart[0]?.asal_kota || "");
  const [tanggalSiap, setTanggalSiap] = useState("");
  const [catatan, setCatatan] = useState("");
  const [rows, setRows] = useState(() => cart.map((c) => ({
    order_id: c.order_id, unit: c.unit,
    tujuan: c.unit?.tujuan || c.tujuan_kota || "",
    no_mesin: c.unit?.no_mesin || "",
    nama_kapal: c.unit?.nama_kapal || "", etd: c.unit?.etd || "", transit_hari: c.unit?.transit_hari || "",
  })));
  const [bulk, setBulk] = useState({ nama_kapal: "", etd: "", transit_hari: "" });

  const [ordered, setOrdered] = useState(false); // sudah ngikut urutan dokumen lama?

  const setRow = (i, patch) => setRows((rs) => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  const applyBulk = () => setRows((rs) => rs.map((r) => ({
    ...r, nama_kapal: bulk.nama_kapal || r.nama_kapal, etd: bulk.etd || r.etd,
    transit_hari: bulk.transit_hari !== "" ? bulk.transit_hari : r.transit_hari,
  })));

  // Geser 1 unit ke atas/bawah (kalau mau atur manual).
  const uKey = (u) => `${u?.nopol || ""}|${u?.no_rangka || ""}`;
  const move = (i, dir) => setRows((rs) => {
    const j = i + dir;
    if (j < 0 || j >= rs.length) return rs;
    const c = rs.slice(); [c[i], c[j]] = [c[j], c[i]]; return c;
  });

  // Ikutin urutan dokumen lama: ambil Jadwal Gabungan terakhir customer ini,
  // urutkan baris sesuai dokumen itu (biar nggak usah urutin ulang tiap cetak).
  useEffect(() => {
    if (customers.length !== 1) return;
    let alive = true;
    axios.get(`${API}/admin/doc-history?jenis=jadwal_gabungan`, { headers })
      .then(({ data }) => {
        if (!alive) return;
        const recs = (data.items || []).filter((r) => (r.customer || "") === customers[0]);
        if (!recs.length) return;
        recs.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
        const seq = (recs[0].units || []).map((u) => uKey(u));
        if (!seq.length) return;
        const idx = new Map(seq.map((k, i) => [k, i]));
        setRows((rs) => {
          const dec = rs.map((r, i) => ({ r, i, k: uKey(r.unit) }));
          dec.sort((a, b) => {
            const ai = idx.has(a.k) ? idx.get(a.k) : 1e9 + a.i;
            const bi = idx.has(b.k) ? idx.get(b.k) : 1e9 + b.i;
            return ai - bi;
          });
          return dec.map((x) => x.r);
        });
        setOrdered(true);
      })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const docUnits = () => rows.map((r) => ({
    vehicle_type: r.unit?.vehicle_type, tipe_model: r.unit?.tipe_model, nopol: r.unit?.nopol,
    no_rangka: r.unit?.no_rangka, no_mesin: r.no_mesin || r.unit?.no_mesin, tujuan: r.tujuan,
    nama_kapal: r.nama_kapal, etd: r.etd, transit_hari: parseInt(r.transit_hari, 10) || 0,
  }));

  const persist = () => {
    // simpan per-order (kelompokkan baris menurut order_id) — fire-and-forget
    const byOrder = {};
    rows.forEach((r) => { (byOrder[r.order_id] = byOrder[r.order_id] || []).push(r); });
    Object.entries(byOrder).forEach(([oid, rs]) => {
      axios.patch(`${API}/admin/orders/${oid}/jadwal`, {
        tanggal_siap: tanggalSiap || "", catatan_jadwal: catatan || "", pelabuhan_asal: pelabuhanAsal || "",
        units: rs.map((r) => ({ unit_id: r.unit?.unit_id, tujuan: r.tujuan, no_mesin: r.no_mesin, nama_kapal: r.nama_kapal, etd: r.etd, transit_hari: parseInt(r.transit_hari, 10) || 0 })),
      }, { headers }).catch(() => {});
    });
  };

  const doPrint = () => {
    const gabMeta = { customer_nama: customers.length === 1 ? customers[0] : `${customers.length} customer`, pelabuhan_asal: pelabuhanAsal, tanggal_siap: tanggalSiap, catatan_jadwal: catatan };
    const units = docUnits();
    const noDoc = printJadwalGabungan(gabMeta, units);
    const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)));
    saveDocHistory({
      jenis: "jadwal_gabungan", no_dokumen: noDoc, customer: gabMeta.customer_nama,
      judul: `${gabMeta.customer_nama} · ${units.length} unit · ${orderIds.length} PO`,
      meta: { ...gabMeta, no_dokumen: noDoc }, units, order_ids: orderIds,
    }, headers);
    persist();
    onDone();
  };

  return createPortal((
    <div className="adm-vars">
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-jadwalgab-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">🚢 Jadwal Pengiriman Gabungan</div>
            <div className="adm-modal-sub">{cart.length} unit dari {new Set(cart.map((c) => c.order_id)).size} PO{customers.length === 1 ? ` · ${customers[0]}` : ` · ${customers.length} customer`}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="adm-modal-body">
          {customers.length > 1 && <div className="t360-fin-err" style={{ marginBottom: 12, background: "var(--gold-bg)", borderColor: "var(--gold-bd)", color: "var(--gold-xl)" }}>Catatan: unit dari {customers.length} customer berbeda tercampur di 1 dokumen.</div>}
          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ flex: 1, minWidth: 150 }}>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Pelabuhan Asal</span>
              <input className="adm-input" value={pelabuhanAsal} onChange={(e) => setPelabuhanAsal(e.target.value)} placeholder="Pelabuhan Surabaya" data-testid="adm-jadwalgab-asal" />
            </label>
            <label style={{ flex: 1, minWidth: 150 }}>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Tanggal Siap Unit</span>
              <input type="date" className="adm-input" value={tanggalSiap} onChange={(e) => setTanggalSiap(e.target.value)} />
            </label>
          </div>
          {/* Isi cepat: set kapal + tanggal berangkat + transit SEKALIGUS ke semua unit
              (biar nggak edit satu-satu). Kosongin yg nggak mau diubah. */}
          <div style={{ border: "1px dashed var(--gold-bd)", borderRadius: 9, padding: "10px 12px", marginBottom: 14, background: "var(--gold-bg)" }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--gold-xl)", marginBottom: 8 }}>⚡ Isi cepat → semua unit sekaligus (nggak usah edit satu-satu)</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ flex: 2, minWidth: 130 }}><span style={{ display: "block", fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>Nama Kapal</span>
                <input list="kapal-dl" className="adm-input" value={bulk.nama_kapal} onChange={(e) => setBulk((b) => ({ ...b, nama_kapal: e.target.value }))} placeholder="KM Serasi V" data-testid="adm-jadwalgab-bulk-kapal" /></label>
              <label style={{ flex: 1, minWidth: 120 }}><span style={{ display: "block", fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>Kapal Berangkat</span>
                <input type="date" className="adm-input" value={bulk.etd} onChange={(e) => setBulk((b) => ({ ...b, etd: e.target.value }))} data-testid="adm-jadwalgab-bulk-etd" /></label>
              <label style={{ width: 90 }}><span style={{ display: "block", fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>Transit (jam)</span>
                <input inputMode="numeric" className="adm-input" value={bulk.transit_hari} onChange={(e) => setBulk((b) => ({ ...b, transit_hari: e.target.value.replace(/\D/g, "") }))} placeholder="4" data-testid="adm-jadwalgab-bulk-transit" /></label>
              <button className="adm-btn adm-btn-sm adm-btn-gold" onClick={applyBulk} data-testid="adm-jadwalgab-bulk-apply">Terapkan ke semua</button>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-mute)", marginBottom: 8 }}>
            {ordered ? "✅ Urutan ngikutin dokumen terakhir yang lo cetak. " : ""}Geser pakai ↑/↓ kalau mau atur — urutan kesimpen otomatis pas cetak.
          </div>
          <div className="jm-list">
            {rows.map((r, i) => {
              const u = r.unit || {};
              const eta = jpAddDays(r.etd, parseInt(r.transit_hari, 10) || 0);
              return (
                <div key={u.unit_id || i} className="jm-unit">
                  <div className="jm-unit-hd" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ flex: 1 }}>{i + 1}. {u.vehicle_type || "—"}{u.tipe_model ? ` · ${u.tipe_model}` : ""} <span className="jm-nopol">{u.nopol || "nopol —"} · {r.order_id}</span></span>
                    <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" style={{ padding: "2px 7px" }} disabled={i === 0} onClick={() => move(i, -1)} title="Naik" data-testid={`adm-jadwalgab-up-${i}`}>↑</button>
                    <button type="button" className="adm-btn adm-btn-ghost adm-btn-sm" style={{ padding: "2px 7px" }} disabled={i === rows.length - 1} onClick={() => move(i, 1)} title="Turun" data-testid={`adm-jadwalgab-down-${i}`}>↓</button>
                  </div>
                  <div className="jm-grid">
                    <label>Tujuan<input className="adm-input" value={r.tujuan} onChange={(e) => setRow(i, { tujuan: e.target.value.toUpperCase() })} placeholder="kota tujuan" /></label>
                    <label>No. Mesin<input className="adm-input" value={r.no_mesin} onChange={(e) => setRow(i, { no_mesin: e.target.value.toUpperCase() })} placeholder="2GDXXXX" /></label>
                    <label>Nama Kapal<input list="kapal-dl" className="adm-input" value={r.nama_kapal} onChange={(e) => setRow(i, { nama_kapal: e.target.value })} placeholder="KM Serasi V" /></label>
                    <label>Kapal Berangkat<input type="date" className="adm-input" value={r.etd} onChange={(e) => setRow(i, { etd: e.target.value })} /></label>
                    <label>Transit (hr)<input inputMode="numeric" className="adm-input" value={r.transit_hari} onChange={(e) => setRow(i, { transit_hari: e.target.value.replace(/\D/g, "") })} placeholder="4" /></label>
                    <div className="jm-eta">Estimasi Tiba<b>{eta ? jpFmt(eta) : "—"}</b></div>
                  </div>
                </div>
              );
            })}
          </div>
          <label style={{ display: "block", marginTop: 12 }}>
            <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 700 }}>Catatan Jadwal (opsional)</span>
            <input className="adm-input" value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. muat di gudang Tanjung Perak" />
          </label>
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Tutup</button>
          <button className="adm-btn adm-btn-gold" onClick={doPrint} data-testid="adm-jadwalgab-print">🖨️ Cetak Jadwal ({rows.length} unit)</button>
        </div>
      </div>
    </div>
    </div>
  ), document.body);
}

/* ════════════════════════════════════════
   INVOICE GABUNGAN — tarik unit lintas-PO dari keranjang → 1 invoice
   (harga per unit, PPN opsional, pesan, penandatangan). Pakai generator
   printInvoiceDoc yang sama dengan invoice per-PO.
════════════════════════════════════════ */
function InvoiceGabunganModal({ cart, headers, onClose, onDone }) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const customers = Array.from(new Set(cart.map((c) => c.customer_nama).filter(Boolean)));
  const [rows, setRows] = useState(() => cart.map((c) => ({
    order_id: c.order_id, customer_nama: c.customer_nama,
    asal_kota: c.asal_kota, tujuan_kota: c.tujuan_kota, unit: c.unit, harga: "",
  })));
  // Auto-isi harga dari harga deal PO (cuma PO 1 unit biar akurat) — biar nggak ketik manual
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/admin/deal-prices`, { headers }).then((r) => {
      if (!alive) return;
      const dp = r.data?.prices || {};
      setRows((rs) => rs.map((row) => {
        const d = dp[row.order_id];
        return (!row.harga && d && d.units === 1 && d.price > 0) ? { ...row, harga: String(d.price) } : row;
      }));
    }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line
  const [withTax, setWithTax] = useState(true);
  const [taxInclusive, setTaxInclusive] = useState(false); // true = harga SUDAH termasuk 1.1%
  const [jatuhTempo, setJatuhTempo] = useState(todayIso);
  const [metode, setMetode] = useState("Cash on Delivery");
  const [pesan, setPesan] = useState("");
  const [ttdNama, setTtdNama] = useState("");
  const [ttdJabatan, setTtdJabatan] = useState("Finance & Accounting Controller");
  const [stempel, setStempel] = useState(null);

  const onStempel = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { alert("Stempel harus berupa gambar (PNG/JPG)."); return; }
    if (f.size > 3 * 1024 * 1024) { alert("Ukuran gambar maksimal 3MB."); return; }
    const r = new FileReader();
    r.onload = () => setStempel(r.result);
    r.readAsDataURL(f);
  };

  const hargaNum = (s) => parseInt(String(s || "").replace(/[^0-9]/g, ""), 10) || 0;
  const setRow = (i, patch) => setRows((rs) => rs.map((r, x) => x === i ? { ...r, ...patch } : r));
  const unitKet = (r) => {
    const u = r.unit || {};
    const veh = `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan";
    const rute = `(${r.asal_kota || "—"}–${r.tujuan_kota || "—"})`;
    const rangka = u.no_rangka ? `<br>No. Rangka: ${u.no_rangka}` : "";
    return `${veh}${u.nopol ? " " + u.nopol : ""} ${rute}${rangka}`;
  };

  const subtotal = rows.reduce((s, r) => s + hargaNum(r.harga), 0);
  const dpp = withTax && taxInclusive ? Math.round(subtotal / 1.011) : subtotal;
  const ppn = !withTax ? 0 : (taxInclusive ? subtotal - dpp : Math.round(subtotal * 0.011));
  const total = taxInclusive ? subtotal : subtotal + ppn;
  const okCount = rows.filter((r) => hargaNum(r.harga) > 0).length;
  const fRp = (n) => "Rp " + n.toLocaleString("id-ID");

  const doPrint = async () => {
    const lines = rows.filter((r) => hargaNum(r.harga) > 0)
      .map((r) => ({ nama: "Jasa Pengiriman", ket: unitKet(r), qty: 1, harga: hargaNum(r.harga) }));
    if (!lines.length) { alert("Isi harga minimal 1 unit dulu."); return; }
    const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter(Boolean)));
    const cust = customers.length === 1 ? customers[0] : `${customers.length} customer`;
    const extra = { jatuhTempo, metode, pesan, ttdNama, ttdJabatan, stempel, taxInclusive, customer_nama: cust, order_id: orderIds.join(", ") };
    const noInv = await printInvoiceDoc(lines, withTax, extra); // nomor auto-increment dari server
    saveDocHistory({
      jenis: "invoice", no_dokumen: noInv, customer: cust,
      judul: `${cust} · ${lines.length} unit · ${orderIds.length} PO`,
      meta: { ...extra, withTax: !!withTax, no_invoice: noInv }, lines, order_ids: orderIds,
    }, headers);
    // tandai unit sudah diinvoice (kelompokkan per order) — best-effort
    const byOrder = {};
    rows.filter((r) => hargaNum(r.harga) > 0 && r.unit?.unit_id && r.unit.unit_id !== "legacy")
      .forEach((r) => { (byOrder[r.order_id] = byOrder[r.order_id] || []).push(r.unit.unit_id); });
    Object.entries(byOrder).forEach(([oid, ids]) => {
      if (ids.length) axios.post(`${API}/admin/orders/${oid}/units/mark-invoiced`, { unit_ids: ids }, { headers }).catch(() => {});
    });
    onDone();
  };

  return createPortal((
    <div className="adm-vars">
    <div className="adm-modal-bg" onClick={onClose} data-testid="adm-invgab-modal">
      <div className="adm-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="adm-modal-head">
          <div>
            <div className="adm-modal-title">🧾 Invoice Gabungan</div>
            <div className="adm-modal-sub">{cart.length} unit dari {new Set(cart.map((c) => c.order_id)).size} PO{customers.length === 1 ? ` · ${customers[0]}` : ` · ${customers.length} customer`}</div>
          </div>
          <button className="adm-modal-close" onClick={onClose} aria-label="Tutup">✕</button>
        </div>
        <div className="adm-modal-body">
          {customers.length > 1 && <div className="t360-fin-err" style={{ marginBottom: 12, background: "var(--gold-bg)", borderColor: "var(--gold-bd)", color: "var(--gold-xl)" }}>Catatan: unit dari {customers.length} customer berbeda tercampur di 1 invoice.</div>}
          <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, marginBottom: 8 }}>Unit yang Ditagih &amp; Harga (per unit)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            {rows.map((r, i) => {
              const u = r.unit || {};
              return (
                <div key={u.unit_id || i} className="adm-invu">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {i + 1}. {u.vehicle_type || "—"}{u.tipe_model ? ` · ${u.tipe_model}` : ""}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-mute)", fontFamily: "var(--mono)" }}>{u.nopol || "nopol —"} · {r.order_id}</div>
                  </div>
                  <div className="adm-invu-harga">
                    <span>Rp</span>
                    <input inputMode="numeric" value={r.harga ? hargaNum(r.harga).toLocaleString("id-ID") : ""} placeholder="0"
                      onChange={(e) => setRow(i, { harga: e.target.value })} data-testid={`adm-invgab-harga-${i}`} />
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Jatuh Tempo</span>
              <input type="date" className="adm-input" value={jatuhTempo} onChange={(e) => setJatuhTempo(e.target.value)} />
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Metode Pembayaran</span>
              <select className="adm-input" value={metode} onChange={(e) => setMetode(e.target.value)}>
                <option>Cash on Delivery</option>
                <option>Transfer Bank</option>
              </select>
            </label>
          </div>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-3)", marginBottom: 5, fontWeight: 700 }}>Pesan / Catatan (opsional)</span>
            <input type="text" className="adm-input" value={pesan} onChange={(e) => setPesan(e.target.value)} placeholder="contoh: Door to door" />
          </label>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 700, marginBottom: 8 }}>Penandatangan</div>
            <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
              <label style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Nama</span>
                <input type="text" className="adm-input" value={ttdNama} onChange={(e) => setTtdNama(e.target.value)} placeholder="contoh: Ulpah" />
              </label>
              <label style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Jabatan</span>
                <input type="text" className="adm-input" value={ttdJabatan} onChange={(e) => setTtdJabatan(e.target.value)} placeholder="contoh: Finance & Accounting Controller" />
              </label>
            </div>
            <span style={{ display: "block", fontSize: 11, color: "var(--text-mute)", marginBottom: 5, fontWeight: 600 }}>Stempel / Tanda Tangan Digital (opsional — PNG/JPG)</span>
            {stempel ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={stempel} alt="stempel" style={{ height: 60, borderRadius: 6, border: "1px solid var(--border)", background: "#fff", padding: 4 }} />
                <button className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => setStempel(null)}>Hapus stempel</button>
              </div>
            ) : (
              <input type="file" accept="image/*" className="adm-input" onChange={onStempel} />
            )}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={withTax} onChange={(e) => setWithTax(e.target.checked)} style={{ accentColor: "#58a6ff", width: 16, height: 16 }} data-testid="adm-invgab-tax" />
            <span>Kenakan PPN Logistik (1.1%)</span>
          </label>
          {withTax && (
            <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, cursor: "pointer", paddingLeft: 26 }}>
              <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} style={{ accentColor: "#58a6ff", width: 16, height: 16 }} data-testid="adm-invgab-tax-inclusive" />
              <span style={{ fontSize: 13 }}>Harga sudah termasuk pajak 1.1% <span style={{ color: "var(--text-mute)" }}>(pajak dipecah dari dalam, total nggak nambah)</span></span>
            </label>
          )}
          {subtotal > 0 && (
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--text-3)" }}><span>{withTax && taxInclusive ? `DPP (${okCount} unit)` : `Subtotal (${okCount} unit)`}</span><span>{fRp(withTax && taxInclusive ? dpp : subtotal)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", color: "var(--text-3)" }}><span>PPN 1.1%{withTax && taxInclusive ? " (termasuk)" : ""}</span><span>{withTax ? fRp(ppn) : "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 0", marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 800 }}><span>Total</span><span>{fRp(total)}</span></div>
            </div>
          )}
        </div>
        <div className="adm-modal-foot">
          <button className="adm-btn adm-btn-ghost" onClick={onClose}>Batal</button>
          <button className="adm-btn adm-btn-blue" onClick={doPrint} disabled={okCount === 0} data-testid="adm-invgab-print">🧾 Cetak Invoice ({okCount} unit)</button>
        </div>
      </div>
    </div>
    </div>
  ), document.body);
}

/* ════════════════════════════════════════
   ODOO MODAL
════════════════════════════════════════ */
function OdooModal({ order, orderId, headers, onClose }) {
  const [withInvoice, setWithInvoice] = useState(false);
  const [price, setPrice] = useState("");
  const [taxMode, setTaxMode] = useState("logistik"); // "logistik" | "no_tax"
  const [priceIncludesTax, setPriceIncludesTax] = useState(false);
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
        {
          with_invoice: withInvoice,
          price: priceNum,
          tax_mode: taxMode,
          price_includes_tax: taxMode === "logistik" ? priceIncludesTax : false,
        },
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
              <div style={{ marginBottom:14 }}>
                <span style={{ display:"block", fontSize:12, color:"var(--text-3)", marginBottom:5, fontWeight:700 }}>Pajak</span>
                <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                  <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                    <input
                      type="radio"
                      name="odoo-tax-mode"
                      checked={taxMode === "logistik"}
                      onChange={() => setTaxMode("logistik")}
                      style={{ accentColor:"#7c3aed", width:16, height:16 }}
                      data-testid="adm-odoo-tax-logistik"
                    />
                    <span>PPn Logistik (1.1%)</span>
                  </label>
                  <label style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
                    <input
                      type="radio"
                      name="odoo-tax-mode"
                      checked={taxMode === "no_tax"}
                      onChange={() => setTaxMode("no_tax")}
                      style={{ accentColor:"#7c3aed", width:16, height:16 }}
                      data-testid="adm-odoo-tax-none"
                    />
                    <span>Tanpa Pajak — pengiriman fretail</span>
                  </label>
                </div>
                {taxMode === "logistik" && (
                  <label style={{ display:"flex", alignItems:"center", gap:10, marginTop:8, cursor:"pointer" }}>
                    <input
                      type="checkbox"
                      checked={priceIncludesTax}
                      onChange={(e) => setPriceIncludesTax(e.target.checked)}
                      style={{ accentColor:"#7c3aed", width:16, height:16 }}
                      data-testid="adm-odoo-price-incl-tax"
                    />
                    <span>Harga di atas sudah termasuk PPN</span>
                  </label>
                )}
              </div>
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

const LEG_TIPE = ["Self Drive", "Kapal RoRo", "Kapal Kontainer", "Car Carrier", "Towing", "Self Loader", "Lainnya"];
const LEG_STATUS = ["Menunggu", "Berlangsung", "Selesai"];
const TIPE_ICON = { "Self Drive": "🚗", "Kapal RoRo": "🚢", "Kapal Kontainer": "🚢", "Car Carrier": "🚛", "Towing": "🔗", "Self Loader": "🏗", "Lainnya": "📦" };

const DETAIL_TABS = [
  { key: "rute", label: "Rute Leg", icon: "🧭" },
  { key: "petugas", label: "Petugas", icon: "👷" },
  { key: "foto", label: "Foto", icon: "📸" },
  { key: "checkpoint", label: "Checkpoint", icon: "📍" },
  { key: "dokumen", label: "Dokumen", icon: "📄" },
  { key: "ringkasan", label: "Ringkasan", icon: "📊" },
];

// Status link tugas petugas (Fase 2) — warna + label
const TASK_STATUS_META = {
  belum_dibuka:  { t: "Belum Dibuka",  c: "#8b949e", bg: "#1c2128" },
  sudah_dibuka:  { t: "Sudah Dibuka",  c: "#60a5fa", bg: "#0d2340" },
  dikerjakan:    { t: "Sedang Dikerjakan", c: "#EF9F27", bg: "#2d2410" },
  menunggu:      { t: "Menunggu Kelengkapan", c: "#e6b450", bg: "#2a2410" },
  selesai:       { t: "Selesai",       c: "#3fb950", bg: "#0d2a10" },
  kedaluwarsa:   { t: "Kedaluwarsa",   c: "#f85149", bg: "#2d1214" },
  dinonaktifkan: { t: "Dinonaktifkan", c: "#f85149", bg: "#2d1214" },
};

const LEG_STATUS_COLOR = {
  "Menunggu":    { bg: "#2d2410", color: "#EF9F27", border: "#7a5c14" },
  "Berlangsung": { bg: "#0d2340", color: "#60a5fa", border: "#1f6feb" },
  "Selesai":     { bg: "#0d2a10", color: "#3fb950", border: "#238636" },
};

const ICON_BTN = { background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 5, padding: "3px 7px", cursor: "pointer", fontSize: 11 };
const MINI_LABEL = { fontSize: 10, color: "#8b949e", fontWeight: 600, display: "block" };
const MINI_INPUT = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "6px 9px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", marginTop: 3, boxSizing: "border-box", fontFamily: "inherit" };
const SOLID_BTN_BLUE = { padding: "8px", borderRadius: 7, border: "none", background: "#1f6feb", color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 };
const GHOST_BTN_BLUE = { padding: "8px", borderRadius: 7, border: "1px solid #1f6feb", background: "transparent", color: "#60a5fa", cursor: "pointer", fontSize: 11, fontWeight: 700 };

function resolveTripUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${BACKEND_URL}${url}`;
}

function fmtTs(s) {
  if (!s) return "—";
  try {
    const d = new Date(s);
    return d.toLocaleString("id-ID", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " WIB";
  } catch { return "—"; }
}

function Checklist({ items }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, margin: "10px 0" }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: it.done ? "#3fb950" : "#8b949e" }}>
          <span style={{ width: 15, height: 15, borderRadius: "50%", background: it.done ? "#0d2a10" : "#0d1117", border: `1px solid ${it.done ? "#238636" : "#30363d"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, flexShrink: 0 }}>{it.done ? "✓" : ""}</span>
          {it.label}
        </div>
      ))}
    </div>
  );
}

function TabSkeleton() {
  return <div style={{ textAlign: "center", padding: 40, color: "#8b949e", fontSize: 12 }}>Memuat data...</div>;
}
function TabEmpty({ text }) {
  return <div style={{ textAlign: "center", padding: 40, color: "#484f58", fontSize: 12 }}>{text}</div>;
}

/* ════════════════════════════════════════
   TRIP 360 — pusat kontrol satu pengiriman
   Semua data 1 trip dalam 1 halaman: header ringkas + 6 tab
   (Overview / Route Leg / Keuangan / Dokumen / Aktivitas / Tracking).
   Baca dari GET /public/trips/{id} (endpoint yang sama dipakai tracking
   customer) + object order yang udah ada -- TANPA endpoint/back-end baru.
   Aksi cetak (Surat Jalan/Invoice) & edit leg dilempar via callback ke
   OrderCard yang udah punya fungsinya, biar nggak duplikasi.
════════════════════════════════════════ */
const T360_ICONS = {
  overview:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  routeleg:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="5" cy="19" r="2.2"/><circle cx="19" cy="5" r="2.2"/><path d="M5 16.8V13a4 4 0 0 1 4-4h1a4 4 0 0 0 4-4V7.2"/></svg>,
  keuangan:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5S9.2 9 12 9s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>,
  dokumen:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v5h5M8 13h8M8 17h5"/></svg>,
  aktivitas: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>,
  tracking:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.4"/></svg>,
  camera:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h3l2-2h6l2 2h3v13H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>,
  pin:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-6-5.4-6-9.6A6 6 0 0 1 12 5a6 6 0 0 1 6 6.4C18 15.6 12 21 12 21z"/><circle cx="12" cy="11" r="2"/></svg>,
  pinplus:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><path d="M12 8v4M10 10h4"/></svg>,
  doc:       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 13h6M9 17h4"/></svg>,
  upload:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4M8 8l4-4 4 4M5 20h14"/></svg>,
  bill:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/></svg>,
  wallet:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5.5c0-1.9-2.2-3.5-5-3.5s-5 1.6-5 3.5S9.2 9 12 9s5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/></svg>,
  clock:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  bell:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>,
  warn:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 1 21h22z"/><path d="M12 9v5M12 17.5v.01"/></svg>,
  check:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/></svg>,
  user:      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/></svg>,
  truck:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="13" height="10" rx="1"/><path d="M14 9h3.5L21 12.5V16h-7"/><circle cx="5" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/></svg>,
};

const T360_TIPE_ICON = { "Self Drive": "🚗", "Kapal RoRo": "⚓", "Kapal RO-RO": "⚓", "Container": "📦", "Car Carrier": "🚚", "Towing": "🛻" };

// stage album yang paling relevan buat tiap leg (buat upload checkpoint & hitung foto)
function t360StageForLeg(l) {
  const t = (l?.tipe || "").toLowerCase();
  if (t.startsWith("kapal")) return "kapal";
  return "asal";
}

function T360_Empty({ text, sub, actionLabel, onAction }) {
  return (
    <div className="t360-empty">
      <div style={{ display: "flex", justifyContent: "center" }}>{T360_ICONS.doc}</div>
      <div className="t360-empty-t">{text}</div>
      {sub && <div className="t360-empty-s">{sub}</div>}
      {actionLabel && onAction && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          <button className="adm-btn adm-btn-sm adm-btn-blue" onClick={onAction} data-testid="t360-empty-action">{actionLabel}</button>
        </div>
      )}
    </div>
  );
}

function Trip360Modal({ order, headers, onClose, onEditLegs, onPrintSuratJalan, onOpenInvoice }) {
  const [detail, setDetail] = useState(null);
  const [phase, setPhase] = useState("loading"); // loading | ready | error
  const [tab, setTab] = useState("overview");
  const [lightbox, setLightbox] = useState(null);
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [finance, setFinance] = useState(null); // ringkasan keuangan trip (Sprint Finance 1)
  const cpInputRef = useRef(null);
  const docInputRef = useRef(null);

  const flash = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const fetchDetail = useCallback(() => {
    if (!order?.trip_id) { setPhase("error"); return; }
    setPhase((p) => (p === "ready" ? p : "loading"));
    axios.get(`${API}/public/trips/${order.trip_id}`)
      .then((r) => { setDetail(r.data); setPhase("ready"); })
      .catch(() => setPhase((p) => (p === "ready" ? p : "error")));
  }, [order?.trip_id]);

  useEffect(() => { let alive = true; if (alive) fetchDetail(); return () => { alive = false; }; }, [fetchDetail]);

  // Keuangan trip — satu sumber, dipakai Overview & tab Keuangan bareng.
  const fetchFinance = useCallback(() => {
    if (!order?.trip_id) return;
    axios.get(`${API}/admin/trips/${order.trip_id}/finance`, { headers })
      .then((r) => setFinance(r.data))
      .catch(() => { /* diam — tab Keuangan tetap punya fallback */ });
  }, [order?.trip_id, headers]);

  useEffect(() => { fetchFinance(); }, [fetchFinance]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const legs = useMemo(() => {
    if (Array.isArray(detail?.legs) && detail.legs.length) return detail.legs;
    if (Array.isArray(order?.legs) && order.legs.length) return order.legs;
    return [];
  }, [detail, order]);

  const album = detail?.album || {};
  const albumCount = (album.asal?.length || 0) + (album.kapal?.length || 0) + (album.tujuan?.length || 0) + (album.dokumen?.length || 0);
  const checkpoints = detail?.daily_checkpoints || [];
  const bastk = detail?.handover?.bastk || [];
  const resi = detail?.handover?.resi;
  const docReady = { bastk: bastk.length > 0, resi: !!resi?.url };
  const docCount = bastk.length + (resi?.url ? 1 : 0);

  const { done: progDone, currentIdx } = computeProgress({ ...order, legs });
  const activeLeg = legs.find((l) => l.status && l.status !== "Menunggu" && l.status !== "Selesai") || legs.find((l) => l.status !== "Selesai") || null;
  const activeLegIdx = activeLeg ? legs.indexOf(activeLeg) : -1;
  const holder = activeLeg?.driver || order.nama_driver || order.driver_id || "Belum di-assign";
  const holderRole = activeLeg ? (t360StageForLeg(activeLeg) === "kapal" ? "Petugas Kapal" : "Driver Darat") : "";
  const supplierAktif = activeLeg?.kapal || legs.map((l) => l.kapal).filter(Boolean)[0] || "—";
  const doneLegs = legs.filter((l) => l.status === "Selesai").length;

  const statusMeta = {
    NEW:        { txt: "Baru", cls: "info" },
    DISPATCHED: { txt: "Dispatched", cls: "info" },
    ON_TRIP:    { txt: "On Trip", cls: "ontrip" },
    DELIVERED:  { txt: "Selesai", cls: "ok" },
    CANCELLED:  { txt: "Batal", cls: "wait" },
  }[order.status] || { txt: order.status || "—", cls: "wait" };

  const TABS = [
    { key: "overview", label: "Overview", icon: "overview" },
    { key: "routeleg", label: "Route Leg", icon: "routeleg", count: legs.length || undefined },
    { key: "keuangan", label: "Keuangan", icon: "keuangan" },
    { key: "dokumen", label: "Dokumen", icon: "dokumen", count: docCount || undefined },
    { key: "aktivitas", label: "Aktivitas", icon: "aktivitas" },
    { key: "tracking", label: "Tracking", icon: "tracking", count: checkpoints.length || undefined },
  ];

  const runUpload = async (stage, files, label) => {
    const list = files ? Array.from(files) : [];
    if (!list.length || !order.trip_id) return;
    setBusy(true);
    try {
      for (const file of list) {
        const fd = new FormData();
        fd.append("foto", file);
        fd.append("stage", stage);
        fd.append("uploaded_by", "admin");
        await axios.post(`${API}/trips/${order.trip_id}/album`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      }
      flash(`${list.length} foto ${label} terunggah`);
      fetchDetail();
    } catch { flash("Gagal upload foto"); }
    setBusy(false);
  };

  const qaCheckpoint = () => { if (!busy) cpInputRef.current?.click(); };
  const qaDokumen = () => { if (!busy) docInputRef.current?.click(); };
  const qaTagih = () => onOpenInvoice();
  const qaBayarVendor = () => { setTab("keuangan"); flash("Pembayaran vendor per-trip menyusul di Financial Command Center"); };

  const stop = (e) => e.stopPropagation();

  return createPortal((
    <div className="adm-vars">
    <div className="t360-bg" onClick={onClose} data-testid="trip360-modal">
      <div className="t360-shell" onClick={stop}>

        {/* ── COMPACT HEADER ── */}
        <div className="t360-head">
          <div className="t360-head-bar">
            <div className="t360-idl">
              <span className={`t360-pill ${statusMeta.cls}`}><span className="dot" />{statusMeta.txt}{activeLegIdx >= 0 && legs.length > 1 ? ` · Leg ${activeLegIdx + 1}/${legs.length}` : ""}</span>
              <span className="t360-name" title={order.customer_nama}>{order.customer_nama || "Tanpa Nama"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span className="t360-ids">{order.order_id} · {order.trip_id}</span>
              <button className="t360-close" onClick={onClose} aria-label="Tutup" data-testid="trip360-close">✕</button>
            </div>
          </div>

          <div className="t360-facts-c">
            <div className="thf"><div className="k">Kendaraan</div><div className="v" title={order.vehicle_type}>{order.vehicle_type || order.isi_kiriman || "—"} {order.nopol ? <small>· {order.nopol}</small> : null}</div></div>
            <div className="thf"><div className="k">Pemegang Unit</div><div className="v" title={holder}>{holder} {holderRole ? <small>· {holderRole}</small> : null}</div></div>
            <div className="thf"><div className="k">Koordinator</div><div className="v">{order.koordinator_nama || order.koordinator_id || "—"}</div></div>
            <div className="thf"><div className="k">Supplier Aktif</div><div className="v" title={supplierAktif}>{supplierAktif}</div></div>
            <div className="thf"><div className="k">Customer</div><div className="v" title={order.customer_nama}>{order.customer_nama || "—"}</div></div>
            <div className="thf"><div className="k">Dibuat</div><div className="v">{fmtDateShort(order.created_at)}</div></div>
          </div>

          <div className="t360-qa">
            <button className="t360-qabtn primary" onClick={qaCheckpoint} disabled={busy} data-testid="t360-qa-checkpoint">{T360_ICONS.pinplus}Tambah Checkpoint</button>
            <button className="t360-qabtn" onClick={qaDokumen} disabled={busy} data-testid="t360-qa-dokumen">{T360_ICONS.upload}Upload Dokumen</button>
            <button className="t360-qabtn gold" onClick={qaTagih} data-testid="t360-qa-tagih">{T360_ICONS.bill}Tagih Customer</button>
            <button className="t360-qabtn green" onClick={qaBayarVendor} data-testid="t360-qa-bayar">{T360_ICONS.wallet}Bayar Vendor</button>
            <input ref={cpInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { runUpload(t360StageForLeg(activeLeg), e.target.files, "checkpoint"); e.target.value = ""; }} />
            <input ref={docInputRef} type="file" accept="image/*" multiple hidden onChange={(e) => { runUpload("dokumen", e.target.files, "dokumen"); e.target.value = ""; }} />
          </div>

          <div className="t360-prog-thin">
            <div className="t360-prog-track">
              {PROGRESS_STEPS.map((s, i) => {
                const isDone = progDone[s.key] && order.status !== "CANCELLED";
                const isActive = i === currentIdx && order.status !== "CANCELLED" && order.status !== "DELIVERED";
                return (
                  <div key={s.key} className={`t360-pstep ${isDone ? "done" : ""} ${isActive ? "active" : ""}`}>
                    <div className="t360-pdot">{isDone ? "✓" : ""}</div>
                    <div className="t360-plbl">{s.label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── TAB BAR ── */}
        <div className="t360-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} className={`t360-tab ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)} data-testid={`trip360-tab-${t.key}`}>
              {T360_ICONS[t.icon]}<span>{t.label}</span>{t.count ? <span className="cnt">{t.count}</span> : null}
            </button>
          ))}
        </div>

        {/* ── BODY ── */}
        <div className="t360-body">
          {phase === "loading" && <div className="t360-empty"><div className="t360-empty-t">Memuat data trip…</div></div>}
          {phase === "error" && <T360_Empty text="Gagal memuat data trip" sub="Coba tutup lalu buka lagi. Kalau tetap gagal, cek koneksi internet." />}

          {phase === "ready" && tab === "overview" && (
            <Trip360Overview order={order} detail={detail} legs={legs} albumCount={albumCount} checkpoints={checkpoints} docReady={docReady} activeLeg={activeLeg} activeLegIdx={activeLegIdx} holder={holder} holderRole={holderRole} finance={finance} setTab={setTab} onEditLegs={onEditLegs} onOpenInvoice={onOpenInvoice} />
          )}
          {phase === "ready" && tab === "routeleg" && (
            <Trip360RouteLeg legs={legs} album={album} checkpoints={checkpoints} bastk={bastk} activeLegIdx={activeLegIdx} onEditLegs={onEditLegs} />
          )}
          {phase === "ready" && tab === "keuangan" && (
            <Trip360Keuangan order={order} legs={legs} headers={headers} finance={finance} onFinance={setFinance} onOpenInvoice={onOpenInvoice} />
          )}
          {phase === "ready" && tab === "dokumen" && (
            <Trip360Dokumen order={order} detail={detail} bastk={bastk} resi={resi} album={album} albumCount={albumCount} docReady={docReady} onPrintSuratJalan={onPrintSuratJalan} onOpenInvoice={onOpenInvoice} onUploadResi={qaDokumen} onView={setLightbox} />
          )}
          {phase === "ready" && tab === "aktivitas" && (
            <Trip360Aktivitas order={order} detail={detail} checkpoints={checkpoints} />
          )}
          {phase === "ready" && tab === "tracking" && (
            <Trip360Tracking checkpoints={checkpoints} onView={setLightbox} />
          )}
        </div>
      </div>

      {toast && <div className="t360-toast" data-testid="t360-toast">{toast}</div>}

      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, zIndex: 240, background: "rgba(0,0,0,.9)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
    </div>
  ), document.body);
}

/* ── Overview = Command Center ── */
function Trip360Overview({ order, detail, legs, albumCount, checkpoints, docReady, activeLeg, activeLegIdx, holder, holderRole, finance, setTab, onEditLegs, onOpenInvoice }) {
  // PRIORITAS — hanya dari data operasional nyata (angka keuangan menyusul di Financial CC)
  const prio = [];
  const noDriver = !order.driver_id && !order.nama_driver && !(activeLeg && activeLeg.driver);
  if (["NEW", "DISPATCHED", "ON_TRIP"].includes(order.status) && legs.length === 0) {
    prio.push({ sev: "red", ic: "🗺️", tag: "Kritis", t: "Rute belum disusun", s: "Trip belum punya leg. Susun rute dulu supaya bisa di-assign & dilacak.", act: "Kelola Leg →", onClick: onEditLegs });
  }
  if (["NEW", "DISPATCHED", "ON_TRIP"].includes(order.status) && noDriver) {
    prio.push({ sev: "red", ic: "🧑‍✈️", tag: "Kritis", t: "Driver / petugas belum ditugaskan", s: "Belum ada driver aktif untuk trip ini. Assign lewat Kelola Leg.", act: "Assign →", onClick: onEditLegs });
  }
  if (order.status === "DELIVERED" && !docReady.bastk) {
    prio.push({ sev: "orange", ic: "📄", tag: "Segera", t: "Trip selesai tapi BASTK belum diunggah", s: "Serah terima belum terdokumentasi. Minta driver upload atau upload manual.", act: "Ke Dokumen →", onClick: () => setTab("dokumen") });
  }
  if (order.status === "ON_TRIP" && activeLeg && t360StageForLeg(activeLeg) === "kapal" && checkpoints.length === 0) {
    prio.push({ sev: "yellow", ic: "📍", tag: "Perhatian", t: "Leg kapal berjalan, belum ada checkpoint", s: "Unit sedang di kapal tapi belum ada update lokasi dari lapangan.", act: "Ingatkan →", onClick: () => setTab("tracking") });
  }
  if (order.status === "ON_TRIP" && checkpoints.length === 0 && legs.length > 0 && !(activeLeg && t360StageForLeg(activeLeg) === "kapal")) {
    prio.push({ sev: "yellow", ic: "📍", tag: "Perhatian", t: "Belum ada checkpoint dari lapangan", s: "Trip sedang berjalan tapi driver belum mengirim titik lokasi manapun.", act: "Ke Tracking →", onClick: () => setTab("tracking") });
  }

  const recent = buildTrip360Activity(order, detail, checkpoints).slice(0, 3);

  return (
    <>
      <div className="t360-sec">Prioritas — Tindakan Berikutnya</div>
      {prio.length === 0 ? (
        <div className="t360-card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="t360-pr-ic" style={{ background: "var(--green-bg)", color: "var(--green)" }}>{T360_ICONS.check}</span>
          <div>
            <div className="t360-pr-t">Tidak ada tindakan mendesak</div>
            <div className="t360-pr-s">Semua sinyal operasional trip ini normal. Prioritas keuangan otomatis menyusul saat Financial Command Center aktif.</div>
          </div>
        </div>
      ) : (
        <div className="t360-prio">
          {prio.map((p, i) => (
            <div key={i} className={`t360-pr ${p.sev}`}>
              <div className="t360-pr-ic">{p.ic}</div>
              <div className="t360-pr-b"><div className="t360-pr-t">{p.t}</div><div className="t360-pr-s">{p.s}</div></div>
              <span className="t360-pr-tag">{p.tag}</span>
              <button className="t360-pr-act" onClick={p.onClick}>{p.act}</button>
            </div>
          ))}
        </div>
      )}

      <div className="t360-sec">Keuangan Trip</div>
      <div className="t360-grid2">
        <div className="t360-card">
          <div className="t360-card-hd"><span className="t360-card-title">{T360_ICONS.keuangan}Invoice &amp; Piutang</span>{finance?.has_invoice && <span className={`t360-chip ${T360_STATUS_CLS[finance.invoice_status] || "wait"}`}>{finance.invoice_status}</span>}</div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 22, fontWeight: 800, color: finance?.has_invoice ? "var(--text)" : "var(--text-mute)" }}>{finance?.has_invoice ? fmtRp(finance.invoice_total) : "Belum diatur"}</div>
          {finance?.has_invoice ? (
            <>
              <div className="t360-bar" style={{ margin: "8px 0 8px" }}><div className="t360-bar-f" style={{ width: `${finance.pay_pct}%` }} /></div>
              <div className="t360-pay-row"><span className="k">Sudah Diterima</span><span className="v" style={{ color: "var(--green)" }}>{fmtRp(finance.total_diterima)}</span></div>
              <div className="t360-pay-row"><span className="k">Sisa Piutang</span><span className="v" style={{ color: finance.sisa_piutang > 0 ? "var(--gold-xl)" : "var(--green)" }}>{fmtRp(finance.sisa_piutang)}</span></div>
              <div style={{ marginTop: 10 }}><button className="t360-qabtn green" onClick={() => setTab("keuangan")} style={{ padding: "7px 12px" }}>{T360_ICONS.wallet}Catat Pembayaran</button></div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11.5, color: "var(--text-mute)", margin: "6px 0 12px" }}>Isi nilai invoice di tab Keuangan supaya profit &amp; piutang terhitung otomatis.</div>
              <button className="t360-qabtn gold" onClick={onOpenInvoice} style={{ padding: "7px 12px" }} data-testid="t360-ov-invoice">{T360_ICONS.bill}Buat / Tagih Invoice</button>
            </>
          )}
        </div>
        <div className="t360-card">
          <div className="t360-card-hd"><span className="t360-card-title">{T360_ICONS.keuangan}HPP &amp; Profit</span><button className="t360-card-link" onClick={() => setTab("keuangan")}>Rincian →</button></div>
          <div className="t360-pay-row"><span className="k">Biaya Vendor ({finance?.entered_vendor || 0})</span><span className="v">{fmtRp(finance?.vendor_total)}</span></div>
          <div className="t360-pay-row"><span className="k">Biaya Driver</span><span className="v">{fmtRp(finance?.driver_cost?.total)}</span></div>
          <div className="t360-pay-row" style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 2 }}><span className="k" style={{ fontWeight: 800, color: "var(--text)" }}>Total HPP</span><span className="v">{fmtRp(finance?.hpp_total)}</span></div>
          <div className="t360-pay-row"><span className="k" style={{ fontWeight: 800, color: "var(--text)" }}>Profit</span><span className="v" style={{ color: finance?.profit == null ? "var(--text-mute)" : finance.profit >= 0 ? "var(--green)" : "var(--red)" }}>{finance?.has_invoice ? fmtRp(finance.profit) : "isi invoice dulu"}</span></div>
          {finance?.expected_vendor > 0 && !finance?.hpp_complete && (
            <div className="t360-note" style={{ marginTop: 10 }}>
              {T360_ICONS.warn}
              <div><div className="t">HPP belum lengkap — {finance.entered_vendor} dari {finance.expected_vendor} biaya vendor</div><div className="s">Profit masih estimasi sampai semua biaya vendor (dari leg) terinput. Lengkapi di tab Keuangan.</div></div>
            </div>
          )}
        </div>
      </div>

      <div className="t360-sec">Kelengkapan Dokumen</div>
      <div className="t360-docmeter">
        <span className={`t360-docit ${docReady.bastk ? "done" : "miss"}`}><span className="st">{docReady.bastk ? "✓" : "·"}</span>BASTK</span>
        <span className="t360-docit ondemand"><span className="st">↧</span>Surat Jalan</span>
        <span className="t360-docit ondemand"><span className="st">↧</span>Invoice</span>
        <span className={`t360-docit ${docReady.resi ? "done" : "miss"}`}><span className="st">{docReady.resi ? "✓" : "·"}</span>Resi</span>
        <span className="t360-docit miss"><span className="st">·</span>PoD</span>
      </div>

      <div className="t360-sec">Ringkasan Trip</div>
      <div className="t360-grid2">
        <div className="t360-card">
          <div className="t360-card-hd"><span className="t360-card-title">{T360_ICONS.user}Customer</span></div>
          <div className="t360-kv"><span className="t360-kv-k">Nama</span><span className="t360-kv-v">{order.customer_nama || "—"}</span></div>
          <div className="t360-kv"><span className="t360-kv-k">No. HP</span><span className="t360-kv-v">{order.customer_hp || "—"}</span></div>
          {order.customer_email && <div className="t360-kv"><span className="t360-kv-k">Email</span><span className="t360-kv-v">{order.customer_email}</span></div>}
          <div className="t360-kv"><span className="t360-kv-k">Rute</span><span className="t360-kv-v">{order.asal_kota || "—"} → {order.tujuan_kota || "—"}</span></div>
        </div>
        <div className="t360-card">
          <div className="t360-card-hd">
            <span className="t360-card-title">{T360_ICONS.truck}Kendaraan &amp; Tim</span>
            <button className="t360-card-link" onClick={() => setTab("routeleg")}>Route Leg →</button>
          </div>
          <div className="t360-kv"><span className="t360-kv-k">Kendaraan</span><span className="t360-kv-v">{order.vehicle_type || order.isi_kiriman || "—"}</span></div>
          <div className="t360-kv"><span className="t360-kv-k">No. Rangka</span><span className="t360-kv-v">{order.no_rangka || "—"}</span></div>
          <div className="t360-kv"><span className="t360-kv-k">Pemegang Unit</span><span className="t360-kv-v">{holder}{holderRole ? ` (${holderRole})` : ""}</span></div>
          <div className="t360-kv"><span className="t360-kv-k">Koordinator</span><span className="t360-kv-v">{order.koordinator_nama || order.koordinator_id || "—"}</span></div>
        </div>
      </div>

      <div className="t360-sec">Aktivitas Terbaru</div>
      <div className="t360-card">
        {recent.length === 0 ? <div style={{ fontSize: 11.5, color: "var(--text-mute)" }}>Belum ada aktivitas tercatat.</div> : recent.map((a, i) => (
          <div key={i} className="t360-log" style={{ paddingTop: i ? undefined : 4 }}>
            <div className={`t360-log-ic ${a.type}`}>{a.ic}</div>
            <div className="t360-log-body">
              <div className="t360-log-text">{a.text}</div>
              <div className="t360-log-m"><span>👤 {a.actor}</span><span>🕐 {fmtTs(a.ts)}</span></div>
            </div>
          </div>
        ))}
        {recent.length > 0 && <button className="t360-card-link" style={{ marginTop: 8 }} onClick={() => setTab("aktivitas")}>Lihat semua aktivitas →</button>}
      </div>
    </>
  );
}

/* ── Route Leg (dengan Pemegang Unit) ── */
function Trip360RouteLeg({ legs, album, checkpoints, bastk, activeLegIdx, onEditLegs }) {
  if (legs.length === 0) return <T360_Empty text="Belum ada rute leg" sub="Rute belum disusun untuk trip ini." actionLabel="✎ Kelola Leg" onAction={onEditLegs} />;
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="adm-btn adm-btn-sm adm-btn-blue" onClick={onEditLegs} data-testid="trip360-edit-legs">✎ Kelola Leg</button>
      </div>
      <div className="t360-rail">
        {legs.map((l, i) => {
          const status = l.status || "Menunggu";
          const cls = status === "Selesai" ? "done" : (i === activeLegIdx || status !== "Menunggu") ? "active" : "";
          const isActive = i === activeLegIdx;
          const ic = T360_TIPE_ICON[l.tipe] || "📍";
          const holderState = status === "Selesai" ? "(selesai)" : isActive ? "(sekarang)" : "(berikutnya)";
          const legAlbum = (album[t360StageForLeg(l)] || []).length;
          return (
            <div key={i} className={`t360-leg ${cls}`}>
              <div className="t360-leg-num">{ic}</div>
              <div className="t360-leg-body">
                <div className="t360-leg-hd">
                  <span className="t360-leg-route">Leg {i + 1} · {l.tipe} — {l.asal || "?"} → {l.tujuan || "?"}</span>
                  <span className={`t360-chip ${status === "Selesai" ? "ok" : status !== "Menunggu" ? "info" : "wait"}`}>{status}</span>
                </div>
                <div className="t360-holder">
                  <div className="t360-holder-av">{ic}</div>
                  <div>
                    <div className="lbl">Pemegang Unit {holderState}</div>
                    <div className="nm">{l.driver || "Belum di-assign"}{l.driver ? ` · ${t360StageForLeg(l) === "kapal" ? "Petugas Kapal" : "Driver Darat"}` : ""}</div>
                  </div>
                  {isActive && <span className="now">● Sekarang</span>}
                </div>
                <div className="t360-leg-meta">
                  <div><div className="k">Kapal / Ekspedisi</div><div className="v">{l.kapal || "—"}</div></div>
                  <div><div className="k">Marking</div><div className="v">{l.marking || "—"}</div></div>
                  <div><div className="k">ETA</div><div className="v">{l.eta ? fmtDateShort(l.eta) : "—"}</div></div>
                </div>
                <div className="t360-leg-counts">
                  <span className="t360-count">{T360_ICONS.camera} Album ({legAlbum})</span>
                  <span className="t360-count">{T360_ICONS.pin} Checkpoint ({i === 0 ? checkpoints.length : 0})</span>
                  <span className="t360-count">{T360_ICONS.doc} Dokumen ({i === legs.length - 1 ? bastk.length : 0})</span>
                </div>
                {l.catatan && <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 10, fontStyle: "italic" }}>“{l.catatan}”</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Keuangan (fase 1: jujur — modul finansial per-trip belum aktif) ── */
const T360_KATEGORI = ["Kapal / RoRo", "Towing / Trucking", "Ekspedisi", "Bongkar / Muat", "Karoseri", "BBM / Tol", "Lainnya"];
const T360_METODE = ["Transfer BCA", "Transfer Bank Lain", "Tunai", "Giro / Cek", "QRIS", "Lainnya"];
const T360_STATUS_CLS = { "Lunas": "ok", "Sebagian": "warn", "Belum Bayar": "bad", "Belum Ada Invoice": "wait" };
const T360_KAT_ICON = { "Kapal / RoRo": "⚓", "Towing / Trucking": "🚚", "Ekspedisi": "📦", "Bongkar / Muat": "🏗️", "Karoseri": "🔧", "BBM / Tol": "⛽", "Lainnya": "•" };
const t360Digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");
const t360FmtInput = (s) => { const d = t360Digits(s); return d ? Number(d).toLocaleString("id-ID") : ""; };

/* ── Keuangan (Sprint Finance 1: Biaya Vendor → HPP → Profit, semua dari data trip) ── */
function Trip360Keuangan({ order, legs, headers, finance, onFinance, onOpenInvoice }) {
  const tripId = order.trip_id;
  const [phase, setPhase] = useState(finance ? "ready" : "loading"); // loading|ready|error
  const [invEdit, setInvEdit] = useState(false);
  const [invVal, setInvVal] = useState("");
  const [savingInv, setSavingInv] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ vendor_name: "", kategori: "Kapal / RoRo", jumlah: "", jatuh_tempo: "", no_invoice_vendor: "", catatan: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [showPay, setShowPay] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", tanggal: "", metode: "Transfer BCA", catatan: "" });
  const [payFile, setPayFile] = useState(null);
  const [savingPay, setSavingPay] = useState(false);
  const payFileRef = useRef(null);

  const apply = useCallback((data) => { onFinance?.(data); setPhase("ready"); }, [onFinance]);

  // daftar supplier existing buat saran (D1: Trip nulis ke Supplier yang sama)
  useEffect(() => {
    axios.get(`${API}/admin/suppliers`, { headers })
      .then((r) => setSuppliers((r.data?.items || []).map((s) => s.nama).filter(Boolean)))
      .catch(() => {});
  }, [headers]);

  useEffect(() => {
    if (finance) { setPhase("ready"); return; }
    if (!tripId) { setPhase("error"); return; }
    axios.get(`${API}/admin/trips/${tripId}/finance`, { headers })
      .then((r) => apply(r.data))
      .catch(() => setPhase("error"));
  }, [tripId, headers, finance, apply]);

  const fin = finance;

  const saveInvoice = async () => {
    const n = parseInt(t360Digits(invVal), 10) || 0;
    setSavingInv(true); setErr("");
    try {
      const r = await axios.patch(`${API}/admin/trips/${tripId}/finance/invoice`, { invoice_total: n }, { headers });
      apply(r.data); setInvEdit(false);
    } catch { setErr("Gagal menyimpan nilai invoice."); }
    setSavingInv(false);
  };

  const addCost = async () => {
    const jumlah = parseInt(t360Digits(form.jumlah), 10) || 0;
    if (!form.vendor_name.trim()) { setErr("Nama vendor wajib diisi."); return; }
    if (jumlah <= 0) { setErr("Jumlah biaya harus lebih dari 0."); return; }
    setSaving(true); setErr("");
    try {
      const r = await axios.post(`${API}/admin/trips/${tripId}/finance/costs`, {
        vendor_name: form.vendor_name.trim(), kategori: form.kategori, jumlah,
        jatuh_tempo: form.jatuh_tempo || null, no_invoice_vendor: form.no_invoice_vendor.trim() || null,
        catatan: form.catatan.trim(),
      }, { headers });
      apply(r.data);
      setShowAdd(false); setForm({ vendor_name: "", kategori: "Kapal / RoRo", jumlah: "", jatuh_tempo: "", no_invoice_vendor: "", catatan: "" });
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal menyimpan biaya vendor."); }
    setSaving(false);
  };

  const delCost = async (id) => {
    if (!window.confirm("Hapus biaya vendor ini dari trip?")) return;
    setBusyId(id);
    try { const r = await axios.delete(`${API}/admin/trips/${tripId}/finance/costs/${id}`, { headers }); apply(r.data); }
    catch { setErr("Gagal menghapus biaya."); }
    setBusyId(null);
  };

  const addPayment = async () => {
    const amt = parseInt(t360Digits(payForm.amount), 10) || 0;
    if (amt <= 0) { setErr("Jumlah pembayaran harus lebih dari 0."); return; }
    setSavingPay(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("amount", amt);
      if (payForm.tanggal) fd.append("tanggal", payForm.tanggal);
      fd.append("metode", payForm.metode);
      if (payForm.catatan.trim()) fd.append("catatan", payForm.catatan.trim());
      if (payFile) fd.append("bukti", payFile);
      const r = await axios.post(`${API}/admin/trips/${tripId}/finance/payments`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      apply(r.data);
      setShowPay(false); setPayForm({ amount: "", tanggal: "", metode: "Transfer BCA", catatan: "" }); setPayFile(null);
      if (payFileRef.current) payFileRef.current.value = "";
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal mencatat pembayaran."); }
    setSavingPay(false);
  };

  const delPayment = async (id) => {
    if (!window.confirm("Hapus pembayaran ini?")) return;
    setBusyId(id);
    try { const r = await axios.delete(`${API}/admin/trips/${tripId}/finance/payments/${id}`, { headers }); apply(r.data); }
    catch { setErr("Gagal menghapus pembayaran."); }
    setBusyId(null);
  };

  if (phase === "loading") return <div className="t360-empty"><div className="t360-empty-t">Memuat keuangan trip…</div></div>;
  if (phase === "error" || !fin) return <T360_Empty text="Gagal memuat keuangan trip" sub="Coba buka lagi tab ini. Pastikan PIN admin masih aktif." />;

  const dc = fin.driver_cost || {};
  const hasInvoice = fin.has_invoice;
  const profit = fin.profit;
  const profitColor = profit == null ? "var(--text-mute)" : profit >= 0 ? "var(--green)" : "var(--red)";
  const legVendors = legs.map((l) => (l.kapal || "").trim()).filter(Boolean);

  return (
    <>
      {/* ── Ringkasan: Invoice · HPP · Profit ── */}
      <div className="t360-grid3" style={{ marginBottom: 14 }}>
        <div className="t360-card">
          <div className="t360-money-k">Nilai Invoice (Jasa)</div>
          {invEdit ? (
            <div style={{ marginTop: 8 }}>
              <div className="t360-fin-inp">
                <span>Rp</span>
                <input autoFocus inputMode="numeric" value={invVal} placeholder="0"
                  onChange={(e) => setInvVal(t360FmtInput(e.target.value))}
                  onKeyDown={(e) => { if (e.key === "Enter") saveInvoice(); }} data-testid="t360-inv-input" />
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="t360-qabtn primary" style={{ padding: "7px 12px" }} disabled={savingInv} onClick={saveInvoice} data-testid="t360-inv-save">{savingInv ? "Menyimpan…" : "Simpan"}</button>
                <button className="t360-qabtn" style={{ padding: "7px 12px" }} onClick={() => setInvEdit(false)}>Batal</button>
              </div>
            </div>
          ) : (
            <>
              <div className="t360-money" style={{ color: hasInvoice ? "var(--text)" : "var(--text-mute)" }} data-testid="t360-inv-value">{hasInvoice ? fmtRp(fin.invoice_total) : "Belum diatur"}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button className="t360-qabtn" style={{ padding: "6px 11px" }} onClick={() => { setInvVal(fin.invoice_total ? t360FmtInput(fin.invoice_total) : ""); setInvEdit(true); }} data-testid="t360-inv-edit">{hasInvoice ? "✎ Ubah" : "+ Isi nilai"}</button>
                <button className="t360-qabtn gold" style={{ padding: "6px 11px" }} onClick={onOpenInvoice}>🧾 Cetak</button>
              </div>
            </>
          )}
        </div>
        <div className="t360-card">
          <div className="t360-money-k">HPP / Total Biaya</div>
          <div className="t360-money">{fmtRp(fin.hpp_total)}</div>
          <div style={{ marginTop: 10 }}>
            {fin.expected_vendor > 0 && (
              <span className={`t360-chip ${fin.hpp_complete ? "ok" : "warn"}`}>{fin.hpp_complete ? "HPP lengkap" : `HPP ${fin.entered_vendor}/${fin.expected_vendor} vendor`}</span>
            )}
            {fin.expected_vendor === 0 && <span className="t360-chip wait">{fin.entered_vendor} biaya vendor</span>}
          </div>
        </div>
        <div className="t360-card">
          <div className="t360-money-k">Profit (Invoice − HPP)</div>
          <div className="t360-money" style={{ color: profitColor }} data-testid="t360-profit">{hasInvoice ? fmtRp(profit) : "—"}</div>
          <div style={{ marginTop: 10 }}>
            {!hasInvoice ? <span className="t360-chip wait">Isi nilai invoice dulu</span>
              : !fin.hpp_complete ? <span className="t360-chip warn">Estimasi · margin {fin.margin_pct}%</span>
              : <span className="t360-chip ok">Final · margin {fin.margin_pct}%</span>}
          </div>
        </div>
      </div>

      {err && <div className="t360-fin-err">{err}</div>}

      {/* ── Pembayaran Customer / Piutang (Sprint Finance 2) ── */}
      <div className="t360-card" style={{ marginBottom: 14 }}>
        <div className="t360-card-hd">
          <span className="t360-card-title">{T360_ICONS.bill}Pembayaran Customer</span>
          <span className={`t360-chip ${T360_STATUS_CLS[fin.invoice_status] || "wait"}`} data-testid="t360-inv-status">{fin.invoice_status}</span>
        </div>
        {!hasInvoice ? (
          <div style={{ fontSize: 11.5, color: "var(--text-mute)", padding: "4px 0 8px" }}>Isi <b>Nilai Invoice</b> dulu di atas, baru pembayaran customer &amp; piutang bisa dicatat.</div>
        ) : (
          <>
            <div className="t360-bar"><div className="t360-bar-f" style={{ width: `${fin.pay_pct}%` }} /></div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-mute)", marginBottom: 10 }}>
              <span>{fin.pay_pct}% terbayar</span>
              <span>sisa piutang <b className="mono" style={{ color: fin.sisa_piutang > 0 ? "var(--gold-xl)" : "var(--green)" }}>{fmtRp(fin.sisa_piutang)}</b></span>
            </div>
            <div className="t360-pay-row"><span className="k">Total Invoice</span><span className="v">{fmtRp(fin.invoice_total)}</span></div>
            <div className="t360-pay-row"><span className="k">Sudah Diterima</span><span className="v" style={{ color: "var(--green)" }} data-testid="t360-diterima">{fmtRp(fin.total_diterima)}</span></div>
            <div className="t360-pay-row"><span className="k">Sisa Piutang</span><span className="v" style={{ color: fin.sisa_piutang > 0 ? "var(--gold-xl)" : "var(--green)" }}>{fmtRp(fin.sisa_piutang)}</span></div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="t360-qabtn green" style={{ padding: "7px 12px" }} disabled={!hasInvoice} onClick={() => { setShowPay((v) => !v); setErr(""); }} data-testid="t360-add-payment">{showPay ? "Tutup" : "+ Catat Pembayaran"}</button>
        </div>

        {showPay && hasInvoice && (
          <div className="t360-fin-form" data-testid="t360-payment-form">
            <div className="t360-fin-row">
              <label>Jumlah diterima (Rp)
                <div className="t360-fin-inp"><span>Rp</span><input inputMode="numeric" value={payForm.amount} placeholder="0" onChange={(e) => setPayForm((f) => ({ ...f, amount: t360FmtInput(e.target.value) }))} data-testid="t360-pay-amount" /></div>
              </label>
              <label style={{ maxWidth: 170 }}>Tanggal <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(default hari ini)</span>
                <input type="date" value={payForm.tanggal} onChange={(e) => setPayForm((f) => ({ ...f, tanggal: e.target.value }))} />
              </label>
            </div>
            <div className="t360-fin-row">
              <label style={{ maxWidth: 190 }}>Metode
                <select value={payForm.metode} onChange={(e) => setPayForm((f) => ({ ...f, metode: e.target.value }))}>
                  {T360_METODE.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label>Catatan <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(opsional)</span>
                <input value={payForm.catatan} placeholder="mis. DP 40% via BCA a.n. Irvan" onChange={(e) => setPayForm((f) => ({ ...f, catatan: e.target.value }))} />
              </label>
            </div>
            <label>Bukti transfer <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(opsional — foto / PDF)</span>
              <input ref={payFileRef} type="file" accept="image/*,application/pdf" onChange={(e) => setPayFile(e.target.files?.[0] || null)} data-testid="t360-pay-bukti" />
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="t360-qabtn primary" style={{ padding: "8px 14px" }} disabled={savingPay} onClick={addPayment} data-testid="t360-pay-save">{savingPay ? "Menyimpan…" : "Simpan Pembayaran"}</button>
            </div>
          </div>
        )}

        {hasInvoice && (fin.customer_payments || []).length > 0 && (
          <div className="t360-fin-list" style={{ marginTop: 6 }}>
            {fin.customer_payments.map((p) => (
              <div key={p.id} className="t360-fin-item" data-testid="t360-payment-item">
                <div className="t360-fin-ic" style={{ background: "var(--green-bg)" }}>💵</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t360-fin-nm">{p.metode}{p.bukti_url ? <button className="t360-src" style={{ marginLeft: 6, cursor: "pointer", border: "none" }} onClick={() => window.open(resolveTripUrl(p.bukti_url), "_blank")}>Lihat bukti</button> : <span className="t360-src" style={{ marginLeft: 6, opacity: .6 }}>tanpa bukti</span>}</div>
                  <div className="t360-fin-meta">{fmtDateShort(p.tanggal)}{p.catatan ? ` · ${p.catatan}` : ""}</div>
                </div>
                <div className="t360-fin-amt" style={{ color: "var(--green)" }}>{fmtRp(p.amount)}</div>
                <button className="t360-fin-del" disabled={busyId === p.id} onClick={() => delPayment(p.id)} title="Hapus pembayaran" aria-label="Hapus">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Rincian Biaya (HPP) ── */}
      <div className="t360-card" style={{ marginBottom: 14 }}>
        <div className="t360-card-hd">
          <span className="t360-card-title">{T360_ICONS.wallet}Biaya Vendor</span>
          <button className="t360-qabtn primary" style={{ padding: "6px 11px" }} onClick={() => { setShowAdd((v) => !v); setErr(""); }} data-testid="t360-add-cost">{showAdd ? "Tutup" : "+ Tambah Biaya"}</button>
        </div>

        {showAdd && (
          <div className="t360-fin-form" data-testid="t360-cost-form">
            <div className="t360-fin-row">
              <label>Supplier / Vendor
                <input value={form.vendor_name} placeholder="pilih / ketik — dibuat kalau belum ada"
                  list="t360-vendor-hint"
                  onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))} data-testid="t360-cost-vendor" />
                <datalist id="t360-vendor-hint">{Array.from(new Set([...suppliers, ...legVendors])).map((v, i) => <option key={i} value={v} />)}</datalist>
              </label>
              <label style={{ maxWidth: 150 }}>Kategori
                <select value={form.kategori} onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}>
                  {T360_KATEGORI.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </label>
            </div>
            <div className="t360-fin-row">
              <label>Jumlah (Rp)
                <div className="t360-fin-inp"><span>Rp</span><input inputMode="numeric" value={form.jumlah} placeholder="0" onChange={(e) => setForm((f) => ({ ...f, jumlah: t360FmtInput(e.target.value) }))} data-testid="t360-cost-jumlah" /></div>
              </label>
              <label style={{ maxWidth: 170 }}>Jatuh tempo <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(opsional)</span>
                <input type="date" value={form.jatuh_tempo} onChange={(e) => setForm((f) => ({ ...f, jatuh_tempo: e.target.value }))} />
              </label>
            </div>
            <div className="t360-fin-row">
              <label>No. invoice vendor <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(opsional)</span>
                <input value={form.no_invoice_vendor} placeholder="mis. INV-PN/07/221" onChange={(e) => setForm((f) => ({ ...f, no_invoice_vendor: e.target.value }))} />
              </label>
              <label>Catatan <span style={{ color: "var(--text-mute)", fontWeight: 400 }}>(opsional)</span>
                <input value={form.catatan} placeholder="mis. tarif kapal Priok–Bitung" onChange={(e) => setForm((f) => ({ ...f, catatan: e.target.value }))} />
              </label>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--text-mute)" }}>Kendaraan, nopol, rangka, rute &amp; customer terisi otomatis dari trip. Biaya ini tersimpan di modul <b>Supplier</b> (di-tag trip ini) — muncul juga di halaman Supplier, tanpa input ulang.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="t360-qabtn primary" style={{ padding: "8px 14px" }} disabled={saving} onClick={addCost} data-testid="t360-cost-save">{saving ? "Menyimpan…" : "Simpan Biaya"}</button>
            </div>
          </div>
        )}

        {fin.vendor_costs.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "var(--text-mute)", padding: "6px 0" }}>
            Belum ada biaya vendor. {legVendors.length > 0 ? `Dari leg terbaca: ${legVendors.join(", ")} — tambahkan biayanya supaya HPP & profit terhitung.` : "Tambahkan biaya kapal/towing/ekspedisi untuk membentuk HPP."}
          </div>
        ) : (
          <div className="t360-fin-list">
            {fin.vendor_costs.map((c) => (
              <div key={c.id} className="t360-fin-item" data-testid="t360-cost-item">
                <div className="t360-fin-ic">{T360_KAT_ICON[c.kategori] || "•"}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t360-fin-nm">{c.vendor_name} <span className="t360-src" style={{ marginLeft: 4 }}>Supplier</span></div>
                  <div className="t360-fin-meta">{c.kategori}{c.no_invoice_vendor ? ` · ${c.no_invoice_vendor}` : ""}{c.jatuh_tempo ? ` · tempo ${fmtDateShort(c.jatuh_tempo)}` : ""}{c.catatan ? ` · ${c.catatan}` : ""}</div>
                </div>
                <div className="t360-fin-amt">{fmtRp(c.jumlah)}</div>
                <button className="t360-fin-del" disabled={busyId === c.id} onClick={() => delCost(c.id)} title="Hapus biaya" aria-label="Hapus">✕</button>
              </div>
            ))}
            <div className="t360-fin-item t360-fin-sub">
              <div className="t360-fin-ic" style={{ background: "transparent" }} />
              <div style={{ flex: 1 }}><div className="t360-fin-nm">Subtotal Biaya Vendor</div></div>
              <div className="t360-fin-amt">{fmtRp(fin.vendor_total)}</div>
              <div style={{ width: 26 }} />
            </div>
          </div>
        )}
      </div>

      {/* ── Biaya Driver (otomatis dari data trip) ── */}
      <div className="t360-card" style={{ marginBottom: 14 }}>
        <div className="t360-card-hd">
          <span className="t360-card-title">{T360_ICONS.truck}Biaya Driver <span className="t360-src">otomatis dari data trip</span></span>
          <span className="t360-fin-amt" style={{ fontSize: 14 }}>{fmtRp(dc.total)}</span>
        </div>
        <div className="t360-fin-drv">
          <div><span>Uang Jalan</span><b>{fmtRp(dc.uj)}</b></div>
          <div><span>Termin 1</span><b>{fmtRp(dc.t1)}</b></div>
          <div><span>Termin 2</span><b>{fmtRp(dc.t2)}</b></div>
          <div><span>Termin 3</span><b>{fmtRp(dc.t3)}</b></div>
        </div>
        {(dc.bonus_daily > 0 || dc.bonus_kerajinan > 0) && (
          <div className="t360-note" style={{ marginTop: 12 }}>
            {T360_ICONS.warn}
            <div><div className="t">Bonus tidak dihitung otomatis ke HPP</div><div className="s">Bonus harian ({fmtRp(dc.bonus_daily)}/hari) &amp; kerajinan ({fmtRp(dc.bonus_kerajinan)}) tergantung jumlah hari &amp; performa driver saat pencairan. Kalau nilainya sudah pasti, tambahkan sebagai satu baris di Biaya Vendor (kategori Lainnya) supaya ikut HPP.</div></div>
          </div>
        )}
      </div>

      {/* ── Catatan cara kerja ── */}
      <div className="t360-card">
        <div className="t360-note" style={{ margin: 0 }}>
          {T360_ICONS.check}
          <div>
            <div className="t">Satu sumber data — tidak ada input ganda</div>
            <div className="s">
              Biaya vendor yang kamu input di sini <b>tersimpan di modul Supplier</b> (di-tag trip ini), jadi satu-satunya sumber biaya vendor —
              otomatis muncul di halaman Supplier sebagai kewajiban, tanpa diketik ulang. HPP = Biaya Vendor + Biaya Driver (uang jalan &amp; termin,
              sudah ada di trip). Profit = Nilai Invoice − HPP, muncul otomatis begitu invoice diisi. Pembayaran vendor (hutang), pembayaran customer
              (piutang), Kompensasi, Selisih Harga, cash flow &amp; “Saldo Aman Digunakan” menyusul di Sprint berikutnya — semuanya terhubung ke trip ini.
              Mekari Jurnal tetap pembukuan resmi &amp; pajak; FleetLocation sumber data operasionalnya.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Dokumen ── */
function Trip360Dokumen({ order, detail, bastk, resi, album, albumCount, docReady, onPrintSuratJalan, onOpenInvoice, onUploadResi, onView }) {
  const bastkUrl = bastk[0] ? resolveTripUrl(bastk[0].url) : null;
  const resiUrl = resi?.url ? resolveTripUrl(resi.url) : null;
  const readyCount = 2 + (docReady.bastk ? 1 : 0) + (docReady.resi ? 1 : 0); // Surat Jalan + Invoice selalu bisa dibuat
  const cards = [
    { name: "Surat Jalan", sub: "Consignment note pengiriman", state: "ondemand", action: () => onPrintSuratJalan(), actionLabel: "Cetak", primary: true },
    { name: "Invoice / Faktur", sub: "Tagihan jasa pengiriman", state: "ondemand", action: () => onOpenInvoice(), actionLabel: "Buat", primary: true },
    { name: "BASTK", sub: bastk.length ? `${bastk.length} halaman terunggah` : "Belum diunggah driver", state: docReady.bastk ? "done" : "miss", action: bastkUrl ? () => window.open(bastkUrl, "_blank") : null, actionLabel: "Lihat" },
    { name: "Resi JNE / J&T", sub: resi?.no_resi || (resiUrl ? "Foto resi terunggah" : "Belum diunggah"), state: docReady.resi ? "done" : "miss", action: resiUrl ? () => window.open(resiUrl, "_blank") : onUploadResi, actionLabel: resiUrl ? "Lihat" : "Upload" },
    { name: "Album Foto", sub: `${albumCount} foto perjalanan`, state: albumCount > 0 ? "done" : "miss", action: null, actionLabel: "Lihat di bawah" },
    { name: "Proof of Delivery", sub: "Menyusul — generator belum dibuat", state: "miss", action: null, actionLabel: "Segera" },
  ];
  const chipFor = (st) => st === "done" ? <span className="t360-chip ok">Tersedia</span> : st === "ondemand" ? <span className="t360-chip info">Siap Dibuat</span> : <span className="t360-chip wait">Belum Ada</span>;
  return (
    <>
      <div className="t360-sec">Kelengkapan Dokumen — {readyCount} dari 5 siap</div>
      <div className="t360-docmeter" style={{ marginBottom: 16 }}>
        <span className={`t360-docit ${docReady.bastk ? "done" : "miss"}`}><span className="st">{docReady.bastk ? "✓" : "·"}</span>BASTK</span>
        <span className="t360-docit ondemand"><span className="st">↧</span>Surat Jalan</span>
        <span className="t360-docit ondemand"><span className="st">↧</span>Invoice</span>
        <span className={`t360-docit ${docReady.resi ? "done" : "miss"}`}><span className="st">{docReady.resi ? "✓" : "·"}</span>Resi</span>
        <span className="t360-docit miss"><span className="st">·</span>PoD</span>
      </div>

      <div className="t360-grid4">
        {cards.map((c, i) => (
          <div key={i} className="t360-doc">
            <div className="t360-doc-ico">{T360_ICONS.doc}</div>
            <div>
              <div className="t360-doc-name">{c.name}</div>
              <div className="t360-doc-sub">{c.sub}</div>
            </div>
            <div>{chipFor(c.state)}</div>
            <div className="t360-doc-actions">
              <button className={`t360-doc-btn ${c.primary ? "primary" : ""}`} disabled={!c.action} onClick={c.action || undefined}>{c.actionLabel}</button>
            </div>
          </div>
        ))}
      </div>

      {albumCount > 0 && (
        <>
          <div className="t360-seclbl">Album Foto Perjalanan</div>
          {["asal", "kapal", "tujuan", "dokumen"].map((stage) => {
            const photos = album[stage] || [];
            if (!photos.length) return null;
            const label = { asal: "📍 Asal", kapal: "⚓ Di Kapal", tujuan: "🏁 Tujuan", dokumen: "📄 Dokumen" }[stage];
            return (
              <div key={stage} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-2)", marginBottom: 8 }}>{label} ({photos.length})</div>
                <div className="t360-photos">
                  {photos.map((p, j) => (
                    <img key={j} src={resolveTripUrl(p.url)} alt="" className="t360-photo" onClick={() => onView(resolveTripUrl(p.url))} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

/* ── Aktivitas (dengan tipe + icon + actor/tanggal/jam) ── */
function buildTrip360Activity(order, detail, checkpoints) {
  const ev = [];
  if (order.created_at) ev.push({ ts: order.created_at, type: "status", ic: "🆕", text: `Trip dibuat dari pesanan ${order.order_id}`, actor: "Admin" });
  (Array.isArray(detail?.legs) ? detail.legs : []).forEach((l, i) => {
    if (l.driver && (l.assigned_at || order.created_at)) {
      ev.push({ ts: l.assigned_at || order.created_at, type: "assign", ic: "🧑‍✈️", text: `${l.driver} ditugaskan ke Leg ${i + 1} (${l.tipe})`, actor: order.koordinator_nama || "Koordinator" });
    }
  });
  (checkpoints || []).forEach((cp) => {
    const ts = cp.ts || cp.timestamp || cp.created_at;
    if (ts) ev.push({ ts, type: "cp", ic: "📍", text: `Checkpoint dilaporkan${cp.catatan ? ` — ${cp.catatan}` : cp.status ? ` — ${cp.status}` : ""}`, actor: cp.reported_by || "Driver" });
  });
  const album = detail?.album || {};
  ["asal", "kapal", "tujuan", "dokumen"].forEach((stage) => {
    (album[stage] || []).forEach((p) => {
      const ts = p.ts || p.uploaded_at || p.created_at;
      if (ts) ev.push({ ts, type: "cp", ic: "📷", text: `Foto ${stage} diunggah${p.catatan ? ` — ${p.catatan}` : ""}`, actor: p.uploaded_by || "Driver" });
    });
  });
  (detail?.handover?.bastk || []).forEach((b) => {
    const ts = b.ts || b.uploaded_at || b.created_at;
    if (ts) ev.push({ ts, type: "doc", ic: "📄", text: "Dokumen BASTK diunggah", actor: "Driver" });
  });
  const resiTs = detail?.handover?.resi?.ts || detail?.handover?.resi?.uploaded_at;
  if (resiTs) ev.push({ ts: resiTs, type: "doc", ic: "📄", text: "Foto resi pengiriman diunggah", actor: "Driver" });
  return ev.filter((e) => e.ts).sort((a, b) => new Date(b.ts) - new Date(a.ts));
}

function Trip360Aktivitas({ order, detail, checkpoints }) {
  const events = buildTrip360Activity(order, detail, checkpoints);
  if (events.length === 0) return <T360_Empty text="Belum ada aktivitas tercatat" sub="Aktivitas muncul otomatis saat driver kirim checkpoint, upload foto, atau dokumen." />;
  return (
    <div className="t360-card" style={{ padding: "6px 18px" }}>
      {events.map((e, i) => (
        <div key={i} className="t360-log">
          <div className={`t360-log-ic ${e.type}`}>{e.ic}</div>
          <div className="t360-log-body">
            <div className="t360-log-text">{e.text}</div>
            <div className="t360-log-m"><span>👤 {e.actor}</span><span>📅 {fmtDateShort(e.ts)}</span><span>🕐 {fmtTs(e.ts)}</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Tracking ── */
function Trip360Tracking({ checkpoints, onView }) {
  const cps = [...(checkpoints || [])].reverse();
  const withLoc = cps.filter((c) => c.lat != null && c.lng != null);
  const last = cps[0];
  if (cps.length === 0) return <T360_Empty text="Belum ada data lokasi" sub="Lokasi muncul saat driver mengirim checkpoint dengan GPS aktif dari aplikasi driver." />;
  return (
    <div className="t360-grid2">
      <div className="t360-card" style={{ height: "fit-content" }}>
        <div className="t360-card-hd"><span className="t360-card-title">{T360_ICONS.tracking}Lokasi Terakhir</span></div>
        {last ? (
          <>
            <div className="t360-kv"><span className="t360-kv-k">Waktu</span><span className="t360-kv-v">{fmtTs(last.ts || last.timestamp || last.created_at)}</span></div>
            {last.status && <div className="t360-kv"><span className="t360-kv-k">Status</span><span className="t360-kv-v">{last.status}</span></div>}
            {last.catatan && <div className="t360-kv"><span className="t360-kv-k">Catatan</span><span className="t360-kv-v">{last.catatan}</span></div>}
            {last.lat != null && last.lng != null ? (
              <div style={{ marginTop: 10 }}>
                <a className="adm-btn adm-btn-sm adm-btn-blue" href={`https://www.google.com/maps?q=${last.lat},${last.lng}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>📍 Buka di Google Maps</a>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 10 }}>Checkpoint terakhir tanpa data GPS.</div>
            )}
          </>
        ) : <div style={{ fontSize: 11.5, color: "var(--text-mute)" }}>—</div>}
        {withLoc.length > 0 && <div style={{ fontSize: 10.5, color: "var(--text-mute)", marginTop: 12 }}>{withLoc.length} dari {cps.length} checkpoint punya titik GPS.</div>}
      </div>

      <div className="t360-card">
        <div className="t360-card-hd"><span className="t360-card-title">{T360_ICONS.pin}Riwayat Checkpoint</span></div>
        {cps.map((cp, i) => (
          <div key={cp.id || i} className="t360-cp">
            {cp.url ? (
              <img className="t360-cp-thumb" src={resolveTripUrl(cp.url)} alt="" onClick={() => onView(resolveTripUrl(cp.url))} style={{ cursor: "pointer" }} />
            ) : (
              <div className="t360-cp-thumb" />
            )}
            <div className="t360-cp-body">
              <div className="t360-cp-loc">{cp.catatan || cp.status || `Checkpoint ${cps.length - i}`}</div>
              <div className="t360-cp-time">{fmtTs(cp.ts || cp.timestamp || cp.created_at)}</div>
              {cp.lat != null && cp.lng != null && (
                <a className="t360-cp-map" href={`https://www.google.com/maps?q=${cp.lat},${cp.lng}`} target="_blank" rel="noreferrer">📍 Buka lokasi</a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   TRIP DETAIL MODAL — Route Leg workflow, redesigned
   Setiap leg jadi Workflow Card (header+status, rute, checklist,
   galeri mini, link ke actor, catatan). Tab Foto/Checkpoint/Dokumen/
   Ringkasan baca data read-only dari GET /public/trips/{id} (endpoint
   yang sama dipakai halaman tracking customer) -- tanpa endpoint baru.
════════════════════════════════════════ */
function TripDetailModal({ tripId, order, onClose, onSave, headers }) {
  const [legs, setLegs] = useState(() => {
    if (Array.isArray(order?.legs) && order.legs.length > 0) return order.legs;
    return [
      { tipe: "Self Drive", asal: order?.asal_kota || "", tujuan: "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_bayangan: "", kord_bayangan_hp: "", catatan: "" },
      { tipe: "Kapal RoRo",  asal: "", tujuan: "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_kapal: "", kord_kapal_hp: "", catatan: "" },
      { tipe: "Self Drive", asal: "", tujuan: order?.tujuan_kota || "", kapal: "", eta: "", status: "Menunggu", driver: "", driver_hp: "", kord_bayangan: "", kord_bayangan_hp: "", catatan: "" },
    ];
  });
  const [saving, setSaving] = useState(false);
  const [copiedLeg, setCopiedLeg] = useState(null);
  const [multiUnitModal, setMultiUnitModal] = useState(null); // { leg, selectedOrders: [] }
  const [multiUnitSearch, setMultiUnitSearch] = useState("");
  const [allOrders, setAllOrders] = useState([]);
  const [activeTab, setActiveTab] = useState("rute");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!tripId) { setDetailLoading(false); return undefined; }
    setDetailLoading(true);
    axios.get(`${API}/public/trips/${tripId}`)
      .then(r => { if (alive) setDetail(r.data); })
      .catch(() => {})
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [tripId]);

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

  // Bikin LINK TUGAS ber-token (scoped) buat 1 leg, simpan petugas ke master,
  // lalu salin teks WhatsApp berisi link /task/{token}. Petugas cuma lihat
  // tugasnya (unit, lokasi, instruksi, checklist) — nggak ada harga/leg lain.
  const jenisForLeg = (leg, i, n) => {
    const t = leg.tipe || "";
    if (/^kapal/i.test(t)) return "Kapal";
    if (/car carrier/i.test(t)) return "Car Carrier";
    if (/towing/i.test(t)) return "Towing";
    if (/self drive/i.test(t)) return i === n - 1 ? "Self Drive Tujuan" : "Self Drive";
    return "Lainnya";
  };
  const copyLegLink = async (leg, i, jenisOverride) => {
    if (!tripId) return;
    const n = legs.length;
    const isKapal = /^kapal/i.test(leg.tipe || "");
    const pNama = (isKapal ? leg.kord_kapal : leg.driver) || "";
    const pHp = (isKapal ? leg.kord_kapal_hp : leg.driver_hp) || "";
    const pTipe = isKapal ? "Petugas Kapal" : "Driver";
    // jenisOverride = peran eksplisit yg dipilih admin (Self Drive / Self Drive Asal /
    // Self Drive Tujuan). Kalau nggak dikasih → auto dari tipe leg.
    const jenis = jenisOverride || jenisForLeg(leg, i, n);
    // units snapshot (aman — nopol/tipe/rangka aja)
    const units = (Array.isArray(order?.units) && order.units.length)
      ? order.units.map((u) => ({ nopol: u.nopol || "", vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim(), no_rangka: u.no_rangka || "" }))
      : [{ nopol: order?.nopol || "", vehicle_type: order?.vehicle_type || "", no_rangka: order?.no_rangka || "" }];
    try {
      // simpan petugas ke master (biar bisa dipakai ulang) — best-effort
      let petugas_id = null;
      if (pNama) {
        try { const pr = await axios.post(`${API}/admin/petugas`, { nama: pNama, no_hp: pHp, tipe: pTipe }, { headers }); petugas_id = pr.data?.petugas_id || null; } catch {}
      }
      const r = await axios.post(`${API}/admin/trips/${tripId}/legs/${i}/task-link`, {
        petugas_id, petugas_nama: pNama, petugas_hp: pHp, tipe_petugas: pTipe,
        jenis, asal: leg.asal || "", tujuan: leg.tujuan || "", kapal: leg.kapal || "", voyage: leg.voyage || "",
        instruksi: leg.instruksi || leg.catatan || "", units,
      }, { headers });
      const token = r.data?.token;
      if (!token) throw new Error("no token");
      setLeg(i, { task_token: token });
      const link = `${window.location.origin}/task/${token}`;
      const namaP = pNama || (isKapal ? "Petugas Kapal" : `Driver Leg ${i + 1}`);
      const rute = `${leg.asal || "—"} → ${leg.tujuan || "—"}`;
      const nopol = units.map((u) => u.nopol).filter(Boolean).join(", ") || "-";
      const teks = `Halo Pak/Bu ${namaP} 👋\n\nTugas: ${jenis}\nLokasi: ${rute}\nUnit: ${nopol}\n\nBuka link tugas ini buat lihat instruksi & upload foto:\n🔗 ${link}\n\nInfo: PT Alyssa Auto Logistik · 0818 631 135`;
      const ok = await copyToClipboard(teks);
      const copyKey = jenisOverride === "Self Drive" ? `${i}-full`
        : jenisOverride === "Self Drive Asal" ? `${i}-asal`
        : jenisOverride === "Self Drive Tujuan" ? `${i}-tujuan` : i;
      if (ok) { setCopiedLeg(copyKey); setTimeout(() => setCopiedLeg(null), 2200); }
    } catch (e) {
      alert("Gagal bikin link tugas. Simpan Leg dulu (pastikan trip sudah ada), lalu coba lagi.");
    }
  };

  const setLeg = (i, patch) => setLegs(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLeg = () => setLegs(ls => [...ls, { tipe: "Self Drive", asal: "", tujuan: "", kapal: "", eta: "", status: "Menunggu", catatan: "" }]);
  const delLeg = (i) => setLegs(ls => ls.filter((_, idx) => idx !== i));
  const moveLeg = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= legs.length) return;
    const arr = [...legs]; [arr[i], arr[j]] = [arr[j], arr[i]]; setLegs(arr);
  };

  const submit = async () => { setSaving(true); await onSave(legs); setSaving(false); };

  const routeStops = legs.length ? [
    { label: legs[0].asal || order?.asal_kota || "—", icon: "📍" },
    ...legs.map((l, i) => ({ label: l.tujuan || "—", icon: i === legs.length - 1 ? "🏁" : (TIPE_ICON[legs[i + 1]?.tipe] || "📍") })),
  ] : [];

  return (
    <>
    <div className="adm-modal-bg" onClick={onClose}>
      <div className="adm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 780, maxHeight: "92vh", overflowY: "auto", padding: 0 }}>

        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "flex-start", position: "sticky", top: 0, background: "#161b22", zIndex: 5 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#e6edf3" }}>Detail Pengiriman</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#60a5fa", background: "#0d2340", border: "1px solid #1f6feb", borderRadius: 10, padding: "2px 8px" }}>#{order?.order_id}</span>
            </div>
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 4 }}>{order?.asal_kota} → {order?.tujuan_kota} · {legs.length} Leg</div>
          </div>
          <button className="adm-modal-close" onClick={onClose}><IcoX /></button>
        </div>

        {/* Route Timeline */}
        <div style={{ padding: "14px 22px", borderBottom: "1px solid #21262d", overflowX: "auto" }}>
          <div style={{ display: "flex", alignItems: "flex-start", minWidth: "max-content" }}>
            {routeStops.map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 70 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#0d1117", border: "2px solid #30363d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{s.icon}</div>
                  <div style={{ fontSize: 10, color: "#c9d1d9", fontWeight: 700, textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>{s.label}</div>
                </div>
                {i < routeStops.length - 1 && <div style={{ width: 32, height: 2, background: "#30363d", margin: "15px 0 0" }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 4, padding: "10px 22px 0", borderBottom: "1px solid #21262d", overflowX: "auto" }}>
          {DETAIL_TABS.map(t => (
            <button key={t.key} onClick={() => setActiveTab(t.key)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap",
                background: activeTab === t.key ? "#0d1117" : "transparent",
                color: activeTab === t.key ? "#EF9F27" : "#8b949e",
                borderBottom: activeTab === t.key ? "2px solid #EF9F27" : "2px solid transparent" }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab body */}
        <div style={{ padding: "18px 22px" }}>
          {activeTab === "rute" && (
            <RuteLegTab
              legs={legs} setLeg={setLeg} addLeg={addLeg} delLeg={delLeg} moveLeg={moveLeg}
              order={order} tripId={tripId} headers={headers}
              detail={detail}
              copiedLeg={copiedLeg} copyLegLink={copyLegLink}
              openMultiUnit={openMultiUnit} printKartuMuat={printKartuMuat}
            />
          )}
          {activeTab === "petugas" && <PetugasTaskTab tripId={tripId} headers={headers} />}
          {activeTab === "foto" && <FotoTab detail={detail} loading={detailLoading} onView={setLightbox} />}
          {activeTab === "checkpoint" && <CheckpointTab detail={detail} loading={detailLoading} onView={setLightbox} />}
          {activeTab === "dokumen" && <DokumenTab detail={detail} loading={detailLoading} />}
          {activeTab === "ringkasan" && <RingkasanTab legs={legs} detail={detail} />}
        </div>

        {/* Footer */}
        <div className="adm-modal-foot" style={{ position: "sticky", bottom: 0, background: "#161b22" }}>
          <button className="adm-btn adm-btn-ghost" onClick={onClose} disabled={saving}>Tutup</button>
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

    {/* Lightbox foto */}
    {lightbox && (
      <div onClick={() => setLightbox(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
        <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
      </div>
    )}
    </>
  );
}

/* ── Tab: Rute Leg — kartu workflow per leg ── */
function RuteLegTab({ legs, setLeg, addLeg, delLeg, moveLeg, order, tripId, headers, detail, copiedLeg, copyLegLink, openMultiUnit, printKartuMuat }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {legs.map((leg, i) => {
        const isKapal = leg.tipe && leg.tipe.startsWith("Kapal");
        const statusColor = LEG_STATUS_COLOR[leg.status] || LEG_STATUS_COLOR["Menunggu"];
        const albumStage = isKapal ? "kapal" : (i === 0 ? "asal" : (i === legs.length - 1 ? "tujuan" : null));
        const albumPhotos = albumStage ? (detail?.album?.[albumStage] || []) : [];

        return (
          <div key={i} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" }}>
            {/* 1. Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#12161c", borderBottom: "1px solid #21262d" }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "#1c2128", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{TIPE_ICON[leg.tipe] || "📦"}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#e6edf3" }}>Leg {i + 1} · {leg.tipe}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 10, background: statusColor.bg, color: statusColor.color, border: `1px solid ${statusColor.border}` }}>{leg.status}</span>
                </div>
                {leg.eta && <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>ETA {new Date(leg.eta).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}</div>}
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button onClick={() => moveLeg(i, -1)} disabled={i === 0} title="Naik" style={ICON_BTN}>↑</button>
                <button onClick={() => moveLeg(i, 1)} disabled={i === legs.length - 1} title="Turun" style={ICON_BTN}>↓</button>
                <button onClick={() => delLeg(i)} title="Hapus leg" style={{ ...ICON_BTN, color: "#f85149", borderColor: "#f85149" }}>✕</button>
              </div>
            </div>

            <div style={{ padding: 16 }}>
              {/* 2. Route */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                <label style={MINI_LABEL}>Asal
                  <input style={MINI_INPUT} value={leg.asal} onChange={e => setLeg(i, { asal: e.target.value })} placeholder="Pelabuhan / Kota" />
                </label>
                <label style={MINI_LABEL}>Tujuan
                  <input style={MINI_INPUT} value={leg.tujuan} onChange={e => setLeg(i, { tujuan: e.target.value })} placeholder="Pelabuhan / Kota" />
                </label>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                <label style={MINI_LABEL}>Tipe
                  <select style={MINI_INPUT} value={leg.tipe} onChange={e => setLeg(i, { tipe: e.target.value })}>
                    {LEG_TIPE.map(t => <option key={t}>{t}</option>)}
                  </select>
                </label>
                <label style={MINI_LABEL}>Status
                  <select style={MINI_INPUT} value={leg.status} onChange={e => setLeg(i, { status: e.target.value })}>
                    {LEG_STATUS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </label>
                <label style={MINI_LABEL}>ETA
                  <input type="date" style={MINI_INPUT} value={leg.eta} onChange={e => setLeg(i, { eta: e.target.value })} />
                </label>
              </div>

              {/* 4. Checklist + field khusus tipe */}
              {isKapal ? (
                <div style={{ background: "#0d1a2d", border: "1px solid #1f3a5a", borderRadius: 9, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 800, marginBottom: 8, letterSpacing: .5 }}>🚢 INFO KAPAL</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <label style={MINI_LABEL}>Nama Kapal
                      <input list="kapal-dl" style={MINI_INPUT} value={leg.kapal || ""} onChange={e => setLeg(i, { kapal: e.target.value })} placeholder="KM Mutiara Persada" />
                    </label>
                    <label style={MINI_LABEL}>Marking / Kode
                      <input style={MINI_INPUT} value={leg.marking || ""} onChange={e => setLeg(i, { marking: e.target.value })} placeholder="AAL-001" />
                    </label>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                    <label style={MINI_LABEL}>Koordinator Kapal
                      <input style={MINI_INPUT} value={leg.kord_kapal || ""} onChange={e => setLeg(i, { kord_kapal: e.target.value })} placeholder="Nama" />
                    </label>
                    <label style={MINI_LABEL}>HP Koordinator
                      <input style={MINI_INPUT} value={leg.kord_kapal_hp || ""} onChange={e => setLeg(i, { kord_kapal_hp: e.target.value })} placeholder="08xx-xxxx" />
                    </label>
                  </div>
                  <Checklist items={[
                    { done: !!leg.kapal, label: "Nama kapal diisi" },
                    { done: !!leg.marking, label: "Marking / kode ekspedisi diisi" },
                    { done: albumPhotos.length > 0, label: `Foto di kapal (${albumPhotos.length})` },
                  ]} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
                    <button type="button" onClick={() => printKartuMuat(leg, order)} style={SOLID_BTN_BLUE}>🖨️ Kartu Muat (1 Unit)</button>
                    <button type="button" onClick={() => openMultiUnit(leg)} style={GHOST_BTN_BLUE}>📋 Kartu Muat Multi Unit</button>
                  </div>
                  {/* 6. Link petugas pelabuhan */}
                  <div style={{ marginTop: 10, padding: "10px 12px", background: "#0a1628", border: "1px solid #1f3a5a", borderRadius: 7 }}>
                    <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 6 }}>LINK PETUGAS PELABUHAN</div>
                    <div style={{ fontSize: 10, color: "#4a6fa5", marginBottom: 8 }}>Kirim ke petugas pelabuhan buat upload foto kendaraan masuk / di dalam / bongkar kapal.</div>
                    <button type="button" onClick={() => copyLegLink(leg, i)} disabled={!tripId}
                      style={{ ...SOLID_BTN_BLUE, width: "100%", background: copiedLeg === i ? "#2ea043" : "#1f6feb" }}>
                      {copiedLeg === i ? "✓ Tersalin!" : "🔗 Salin Link Petugas Pelabuhan"}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: "#0a1628", border: "1px solid #1f3a5a", borderRadius: 9, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 800, marginBottom: 8, letterSpacing: .5 }}>🚗 DRIVER</div>
                  <DriverAutocomplete
                    value={leg.driver || ""}
                    hp={leg.driver_hp || ""}
                    onChange={(val) => setLeg(i, { driver: val })}
                    onSelect={(nama, hp) => setLeg(i, { driver: nama, driver_hp: hp })}
                    headers={headers}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0 6px" }}>
                    <label style={MINI_LABEL}>Koordinator Bayangan
                      <input style={MINI_INPUT} value={leg.kord_bayangan || ""} onChange={e => setLeg(i, { kord_bayangan: e.target.value })} placeholder="Nama · agen/pawang driver" />
                    </label>
                    <label style={MINI_LABEL}>HP Koordinator
                      <input style={MINI_INPUT} value={leg.kord_bayangan_hp || ""} onChange={e => setLeg(i, { kord_bayangan_hp: e.target.value })} placeholder="08xx-xxxx" />
                    </label>
                  </div>
                  <Checklist items={[
                    { done: !!leg.driver, label: "Driver ditugaskan" },
                    { done: (detail?.daily_count || 0) > 0, label: `Checkpoint harian terisi (${detail?.daily_count || 0})` },
                    { done: albumPhotos.length > 0, label: `Foto ${albumStage === "asal" ? "asal" : "tujuan"} (${albumPhotos.length})` },
                  ]} />
                  {/* 6. Link driver — pilih PERAN eksplisit biar checklist pas & nggak ketuker */}
                  <div style={{ marginTop: 6, padding: "10px 12px", background: "#0d1117", border: "1px solid #21262d", borderRadius: 7 }}>
                    <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 3 }}>LINK DRIVER LEG {i + 1}</div>
                    <div style={{ fontSize: 9.5, color: "#6b7688", marginBottom: 8, lineHeight: 1.4 }}>
                      Pilih peran → checklist otomatis nyesuaiin. <b>Self Drive full</b> = 1 driver asal→tujuan (nyebrang sendiri). <b>Driver Asal</b>/<b>Tujuan</b> = buat rute kapal/antar-pulau.
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <button type="button" onClick={() => copyLegLink(leg, i, "Self Drive")} disabled={!tripId}
                        style={{ ...SOLID_BTN_BLUE, width: "100%", background: copiedLeg === `${i}-full` ? "#2ea043" : "#1f6feb" }}>
                        {copiedLeg === `${i}-full` ? "✓ Tersalin!" : "🔗 Link Self Drive (full: asal→tujuan)"}
                      </button>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <button type="button" onClick={() => copyLegLink(leg, i, "Self Drive Asal")} disabled={!tripId}
                          style={{ ...GHOST_BTN_BLUE, background: copiedLeg === `${i}-asal` ? "#2ea043" : "transparent", color: copiedLeg === `${i}-asal` ? "#fff" : "#60a5fa" }}>
                          {copiedLeg === `${i}-asal` ? "✓ Tersalin" : "📍 Driver Asal"}
                        </button>
                        <button type="button" onClick={() => copyLegLink(leg, i, "Self Drive Tujuan")} disabled={!tripId}
                          style={{ ...GHOST_BTN_BLUE, background: copiedLeg === `${i}-tujuan` ? "#2ea043" : "transparent", color: copiedLeg === `${i}-tujuan` ? "#fff" : "#60a5fa" }}>
                          {copiedLeg === `${i}-tujuan` ? "✓ Tersalin" : "🏁 Driver Tujuan"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 5. Galeri mini leg ini */}
              {albumStage && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 6, letterSpacing: .5 }}>GALERI ({albumPhotos.length})</div>
                  {albumPhotos.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#484f58", padding: "4px 0" }}>Belum ada foto.</div>
                  ) : (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {albumPhotos.slice(0, 4).map((p, pi) => (
                        <img key={pi} src={resolveTripUrl(p.url)} alt="" style={{ width: 56, height: 56, borderRadius: 7, objectFit: "cover", border: "1px solid #21262d" }} />
                      ))}
                      {albumPhotos.length > 4 && (
                        <div style={{ width: 56, height: 56, borderRadius: 7, background: "#0d1117", border: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#8b949e", fontWeight: 700 }}>
                          +{albumPhotos.length - 4}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 7. Catatan Leg */}
              <label style={MINI_LABEL}>Catatan Leg
                <textarea style={{ ...MINI_INPUT, minHeight: 50, resize: "vertical", fontFamily: "inherit" }} value={leg.catatan || ""} onChange={e => setLeg(i, { catatan: e.target.value })} placeholder="Catatan tambahan buat leg ini (opsional)" />
              </label>
            </div>
          </div>
        );
      })}
      <button onClick={addLeg} style={{ width: "100%", padding: "10px", border: "1px dashed #30363d", borderRadius: 9, background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>+ Tambah Leg</button>
    </div>
  );
}

/* ── Tab: Petugas — Trip → Route Leg → Petugas → Checkpoint → Foto (Fase 3) ──
   Kartu status link tugas (Fase 2) + tombol Salin/WA/Nonaktifkan/Buat Ulang,
   plus checkpoint terstruktur per leg (foto + GPS + waktu). */
function PetugasTaskTab({ tripId, headers }) {
  const [tasks, setTasks] = useState([]);
  const [cps, setCps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    if (!tripId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [a, b] = await Promise.all([
        axios.get(`${API}/admin/leg-tasks`, { params: { trip_id: tripId }, headers }),
        axios.get(`${API}/admin/trips/${tripId}/leg-checkpoints`, { headers }),
      ]);
      setTasks(a.data?.items || []);
      setCps(b.data?.items || []);
    } catch { /* diamkan */ }
    setLoading(false);
  }, [tripId, headers]);
  useEffect(() => { load(); }, [load]);

  const linkOf = (tk) => `${window.location.origin}/task/${tk}`;
  const salin = async (tk) => { try { await navigator.clipboard.writeText(linkOf(tk)); setCopied(tk); setTimeout(() => setCopied(""), 1600); } catch {} };
  const waShare = (t) => {
    const txt = `Halo ${t.petugas_nama || "Petugas"}, ini link tugas ${t.jenis || ""} Anda:\n${linkOf(t.token)}\n\nBuka lewat HP, ikuti checklist & upload foto. Terima kasih.`;
    const hp = (t.petugas_hp || "").replace(/\D/g, "").replace(/^0/, "62");
    window.open(hp ? `https://wa.me/${hp}?text=${encodeURIComponent(txt)}` : `https://wa.me/?text=${encodeURIComponent(txt)}`, "_blank");
  };
  const nonaktif = async (tk) => { if (!window.confirm("Nonaktifkan link tugas ini? Petugas nggak bisa buka lagi.")) return; setBusy(tk); try { await axios.post(`${API}/admin/leg-tasks/${tk}/disable`, {}, { headers }); await load(); } catch {} setBusy(""); };
  const buatUlang = async (tk) => { if (!window.confirm("Buat ulang link? Link lama mati, isi tugas tetap.")) return; setBusy(tk); try { await axios.post(`${API}/admin/leg-tasks/${tk}/regen`, {}, { headers }); await load(); } catch {} setBusy(""); };

  const fmtTs = (s) => { if (!s) return "—"; try { return new Date(s).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return s; } };

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "#8b949e" }}>Memuat petugas…</div>;
  if (tasks.length === 0) return (
    <div style={{ padding: 30, textAlign: "center", color: "#8b949e" }}>
      Belum ada link tugas petugas.<br /><span style={{ fontSize: 11, color: "#6b7688" }}>Bikin di tab <b>Rute Leg</b> → assign petugas → Salin Link Tugas.</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tasks.map((t) => {
        const meta = TASK_STATUS_META[t.status] || TASK_STATUS_META.belum_dibuka;
        const done = (t.checklist || []).filter((c) => c.done).length;
        const total = (t.checklist || []).length;
        const legCps = cps.filter((c) => c.leg_index === t.leg_index || (t.route_leg_id && c.route_leg_id === t.route_leg_id));
        return (
          <div key={t.token} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "#12161c", borderBottom: "1px solid #21262d", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#e6edf3" }}>Leg {(t.leg_index ?? 0) + 1} · {t.jenis || "—"}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 10, background: meta.bg, color: meta.c }}>{meta.t}</span>
                </div>
                <div style={{ fontSize: 11, color: "#8b949e", marginTop: 3 }}>
                  👷 {t.petugas_nama || "—"}{t.petugas_hp ? ` · ${t.petugas_hp}` : ""}{t.tipe_petugas ? ` · ${t.tipe_petugas}` : ""}
                </div>
                <div style={{ fontSize: 10.5, color: "#6b7688", marginTop: 2 }}>Checklist: {done}/{total} · Dibuka: {fmtTs(t.opened_at)}</div>
              </div>
            </div>
            {/* actions */}
            <div style={{ display: "flex", gap: 6, padding: "10px 14px", flexWrap: "wrap" }}>
              <button onClick={() => salin(t.token)} disabled={t.disabled} style={{ ...SOLID_BTN_BLUE, flex: "1 1 120px", background: copied === t.token ? "#2ea043" : "#1f6feb", opacity: t.disabled ? 0.5 : 1 }}>{copied === t.token ? "✓ Tersalin" : "🔗 Salin Link"}</button>
              <button onClick={() => waShare(t)} disabled={t.disabled} style={{ ...GHOST_BTN_BLUE, flex: "1 1 110px", opacity: t.disabled ? 0.5 : 1 }}>💬 WhatsApp</button>
              {!t.disabled
                ? <button onClick={() => nonaktif(t.token)} disabled={busy === t.token} style={{ flex: "1 1 120px", padding: "8px", borderRadius: 7, background: "transparent", border: "1px solid #5a1d1d", color: "#f85149", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{busy === t.token ? "…" : "⛔ Nonaktifkan"}</button>
                : <button onClick={() => buatUlang(t.token)} disabled={busy === t.token} style={{ flex: "1 1 120px", padding: "8px", borderRadius: 7, background: "transparent", border: "1px solid #7a5c14", color: "#EF9F27", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>{busy === t.token ? "…" : "♻️ Buat Ulang"}</button>}
            </div>
            {/* serah terima indikator — leg selesai → admin bisa lanjut aktifkan leg berikutnya (jangan auto) */}
            {t.status === "selesai" && (
              <div style={{ margin: "0 14px 10px", padding: "8px 12px", background: "#0d2a10", border: "1px solid #238636", borderRadius: 8, fontSize: 11.5, color: "#3fb950", fontWeight: 700 }}>
                ✓ Serah terima leg ini SELESAI — silakan aktifkan / buat link leg berikutnya secara manual.
              </div>
            )}
            {/* input dari petugas (kapal/voyage/ETD/ETA/penerima/ttd) */}
            {(() => {
              const x = t.extra_inputs || {};
              const rows = [
                ["Nama Kapal", x.nama_kapal], ["Voyage", x.voyage],
                ["Estimasi Berangkat", x.etd], ["Estimasi Tiba", x.eta],
                ["Nama Penerima", x.penerima_nama], ["No. HP Penerima", x.penerima_hp],
              ].filter(([, v]) => v);
              if (!rows.length && !x.penerima_ttd) return null;
              return (
                <div style={{ margin: "0 14px 10px", padding: "8px 12px", background: "#12161c", border: "1px solid #21262d", borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 6, letterSpacing: .5 }}>INPUT PETUGAS</div>
                  {rows.map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5, padding: "2px 0" }}>
                      <span style={{ color: "#8b949e" }}>{k}</span><span style={{ color: "#e6edf3", fontWeight: 700, textAlign: "right" }}>{v}</span>
                    </div>
                  ))}
                  {x.penerima_ttd && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 3 }}>Tanda Tangan Penerima</div>
                      <img src={x.penerima_ttd} alt="ttd" style={{ maxWidth: 200, background: "#fff", borderRadius: 6, border: "1px solid #21262d" }} />
                    </div>
                  )}
                </div>
              );
            })()}
            {/* checkpoints */}
            <div style={{ padding: "0 14px 14px" }}>
              <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 6, letterSpacing: .5 }}>CHECKPOINT ({legCps.length})</div>
              {legCps.length === 0 ? (
                <div style={{ fontSize: 11, color: "#484f58" }}>Belum ada foto dari petugas.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {legCps.map((c) => (
                    <div key={c.checkpoint_id} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#12161c", border: "1px solid #21262d", borderRadius: 8, padding: 8 }}>
                      {c.url && <img src={resolveTripUrl(c.url)} alt="" style={{ width: 54, height: 54, borderRadius: 7, objectFit: "cover", border: "1px solid #21262d", flexShrink: 0 }} />}
                      <div style={{ flex: 1, minWidth: 0, fontSize: 11 }}>
                        <div style={{ color: "#c9d1d9" }}>{fmtTs(c.ts)}{c.catatan ? ` · ${c.catatan}` : ""}</div>
                        {c.lat != null && c.lng != null
                          ? <a href={`https://www.google.com/maps?q=${c.lat},${c.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#60a5fa", marginTop: 3, display: "inline-block" }}>📍 {parseFloat(c.lat).toFixed(4)}, {parseFloat(c.lng).toFixed(4)} · Buka Maps</a>
                          : <div style={{ fontSize: 10, color: "#6b7688", marginTop: 3 }}>📍 Lokasi tidak tersedia</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Tab: Foto — galeri per stage (asal/kapal/tujuan/dokumen) ── */
function FotoTab({ detail, loading, onView }) {
  if (loading) return <TabSkeleton />;
  if (!detail) return <TabEmpty text="Data foto belum tersedia." />;
  const album = detail.album || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {ALBUM_STAGES.map(stage => {
        const photos = album[stage.key] || [];
        return (
          <div key={stage.key}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#e6edf3", marginBottom: 8 }}>{stage.icon} {stage.label} <span style={{ color: "#8b949e", fontWeight: 600 }}>({photos.length})</span></div>
            {photos.length === 0 ? (
              <div style={{ fontSize: 11, color: "#484f58" }}>Belum ada foto.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                {photos.map((p, i) => (
                  <div key={i} onClick={() => onView(resolveTripUrl(p.url))} style={{ cursor: "pointer" }}>
                    <img src={resolveTripUrl(p.url)} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover", border: "1px solid #21262d" }} />
                    {p.catatan && <div style={{ fontSize: 9, color: "#8b949e", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.catatan}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Tab: Checkpoint — timeline checkpoint harian ── */
function CheckpointTab({ detail, loading, onView }) {
  if (loading) return <TabSkeleton />;
  if (!detail) return <TabEmpty text="Data checkpoint belum tersedia." />;
  const cps = [...(detail.daily_checkpoints || [])].reverse();
  if (cps.length === 0) return <TabEmpty text="Belum ada checkpoint harian." />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {cps.map((cp, i) => (
        <div key={cp.id || i} style={{ display: "flex", gap: 12, background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 12 }}>
          {cp.url ? (
            <img onClick={() => onView(resolveTripUrl(cp.url))} src={resolveTripUrl(cp.url)} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0, cursor: "pointer" }} />
          ) : (
            <div style={{ width: 56, height: 56, borderRadius: 8, background: "#161b22", flexShrink: 0 }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {cp.status && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 10, background: "#0d2340", color: "#60a5fa", border: "1px solid #1f6feb" }}>{cp.status}</span>}
              <span style={{ fontSize: 11, color: "#8b949e" }}>{fmtTs(cp.ts || cp.timestamp || cp.created_at)}</span>
            </div>
            {cp.catatan && <div style={{ fontSize: 11, color: "#c9d1d9", marginTop: 5 }}>{cp.catatan}</div>}
            {cp.lat != null && cp.lng != null && (
              <a href={`https://www.google.com/maps?q=${cp.lat},${cp.lng}`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#60a5fa", marginTop: 5, display: "inline-block" }}>
                📍 {parseFloat(cp.lat).toFixed(4)}, {parseFloat(cp.lng).toFixed(4)} · Buka Maps
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Tab: Dokumen — BASTK + Resi ── */
function DokumenTab({ detail, loading }) {
  if (loading) return <TabSkeleton />;
  if (!detail) return <TabEmpty text="Data dokumen belum tersedia." />;
  const bastk = detail.handover?.bastk || [];
  const resi = detail.handover?.resi;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#e6edf3", marginBottom: 8 }}>📄 BASTK <span style={{ color: "#8b949e", fontWeight: 600 }}>({bastk.length})</span></div>
        {bastk.length === 0 ? <div style={{ fontSize: 11, color: "#484f58" }}>Belum ada dokumen BASTK.</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
            {bastk.map((b, i) => {
              const isPdf = /\.pdf$/i.test(b.url || "");
              return (
                <a key={i} href={resolveTripUrl(b.url)} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                  {isPdf ? (
                    <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, border: "1px solid #21262d", background: "#0d1117", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>📕</div>
                  ) : (
                    <img src={resolveTripUrl(b.url)} alt="" style={{ width: "100%", aspectRatio: "1", borderRadius: 8, objectFit: "cover", border: "1px solid #21262d" }} />
                  )}
                </a>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#e6edf3", marginBottom: 8 }}>🧾 Resi</div>
        {!resi?.url ? <div style={{ fontSize: 11, color: "#484f58" }}>Belum ada foto resi.</div> : (
          <a href={resolveTripUrl(resi.url)} target="_blank" rel="noreferrer" style={{ display: "inline-flex", gap: 10, alignItems: "center", background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 10, textDecoration: "none" }}>
            <img src={resolveTripUrl(resi.url)} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover" }} />
            <div>
              <div style={{ fontSize: 11, color: "#e6edf3", fontWeight: 700 }}>{resi.no_resi || "No. resi belum diisi"}</div>
              <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>Klik buat lihat foto</div>
            </div>
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Ringkasan — statistik + status semua leg ── */
function RingkasanTab({ legs, detail }) {
  const doneLegs = legs.filter(l => l.status === "Selesai").length;
  const pct = legs.length ? Math.round((doneLegs / legs.length) * 100) : 0;
  const stats = [
    { label: "Total Leg", val: legs.length },
    { label: "Leg Selesai", val: doneLegs },
    { label: "Checkpoint Harian", val: detail?.daily_count ?? "—" },
    { label: "Foto Awal", val: detail ? `${detail.initial_done ?? 0}/5` : "—" },
  ];
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 18 }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#EF9F27" }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
          <span>Progress Keseluruhan</span><span style={{ color: "#EF9F27", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div style={{ height: 8, background: "#0d1117", borderRadius: 5, overflow: "hidden", border: "1px solid #21262d" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "#EF9F27" }} />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {legs.map((l, i) => {
          const sc = LEG_STATUS_COLOR[l.status] || LEG_STATUS_COLOR["Menunggu"];
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "#0d1117", border: "1px solid #21262d", borderRadius: 8, padding: "9px 12px" }}>
              <span style={{ fontSize: 15 }}>{TIPE_ICON[l.tipe] || "📦"}</span>
              <div style={{ flex: 1, fontSize: 12, color: "#e6edf3", fontWeight: 700 }}>Leg {i + 1} · {l.asal || "—"} → {l.tujuan || "—"}</div>
              <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 10, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}>{l.status}</span>
            </div>
          );
        })}
      </div>
    </div>
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
        <button onClick={async () => { const ok = await copyToClipboard(portalUrl); if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
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
