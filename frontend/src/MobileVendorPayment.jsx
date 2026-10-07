/* eslint-disable */
/* ════════════════════════════════════════════════════════════════════
   MOBILE — "Catat Bayar Vendor"  (route: /mobile/vendor-payment)
   Dibuat khusus buat pengguna yang tidak terbiasa komputer. Mobile-first,
   nyaman satu tangan, iPhone-safe (notch + home indicator via safe-area).
   HANYA untuk input & lihat pembayaran vendor — tidak ada menu admin,
   profit, invoice customer, route leg, atau tracking. Akses pakai PIN
   vendor (role terbatas di backend: grup /vendor-mobile/*).
   ════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { printSupplierA4, supplierAutoDocNo } from "./SupplierPage";

const API = (process.env.REACT_APP_BACKEND_URL || "") + "/api";
const PIN_KEY = "vp_pin";
const todayIso = () => new Date().toISOString().slice(0, 10);

const onlyDigits = (s) => String(s || "").replace(/[^0-9]/g, "");
const fmtRp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const fmtRpInput = (s) => { const d = onlyDigits(s); return d ? Number(d).toLocaleString("id-ID") : ""; };
const fmtTgl = (iso) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || "-";
  const [y, m, d] = iso.split("-"); return `${d}-${m}-${y}`;
};
const buktiHref = (url) => {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) {
    // Bukti Supabase kadang ke-serve dgn mime salah -> blank. Lewatkan proxy backend.
    if (url.includes("/storage/v1/object/public/")) return `${API}/media?u=${encodeURIComponent(url)}`;
    return url;
  }
  return (process.env.REACT_APP_BACKEND_URL || "") + url;
};

const fmtDateTime = () => {
  try {
    return new Date().toLocaleString("id-ID", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch (_) { return new Date().toLocaleString(); }
};

/* Buat gambar bukti pembayaran (PNG super-sampling → tajam, tidak blur).
   Return: Promise<{ blob, filename }>. Semua ukuran "logis", di-scale SC× biar
   render-nya tajam di layar HP retina. */
function makeReceiptBlob(receipt) {
  return new Promise((resolve, reject) => {
    try {
      const {
        title = "BUKTI PEMBAYARAN VENDOR",
        amount = 0,
        amountLabel = "Nominal Pembayaran",
        rows = [],
        listTitle = "",
        listItems = [],
        footnote = "",
        filename = "bukti-pembayaran",
      } = receipt || {};

      const SC = 4;                 // super-sampling → tajam / anti-blur
      const W = 430;                // lebar logis
      const PAD = 26;
      const CW = W - PAD * 2;
      const FF = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";
      const NAVY = "#0f2a5c", NAVY2 = "#0a1e42", GOLD = "#c9973a",
            INK = "#1f2430", MUTE = "#6b7280", LINE = "#e6e8ee", BG = "#ffffff";

      const mc = document.createElement("canvas");
      const m = mc.getContext("2d");
      const wrap = (text, maxW, w, s) => {
        m.font = `${w} ${s}px ${FF}`;
        const words = String(text == null ? "" : text).split(/\s+/);
        const lines = []; let cur = "";
        for (const word of words) {
          const t = cur ? cur + " " + word : word;
          if (m.measureText(t).width > maxW && cur) { lines.push(cur); cur = word; }
          else cur = t;
        }
        if (cur) lines.push(cur);
        return lines.length ? lines : [""];
      };

      const valW = CW - 130;
      const rowLays = rows.map((r) => {
        const lines = wrap(r.v, valW, "700", 13.5);
        return { k: r.k, lines, h: Math.max(28, lines.length * 18 + 10) };
      });
      const listLays = listItems.map((r) => {
        const lines = wrap(r.v, valW, "700", 12.5);
        return { k: r.k, lines, h: Math.max(24, lines.length * 17 + 8) };
      });

      const HEADER = 96;
      let H = HEADER + 22;
      H += 16 + 42 + 16;            // amount label + amount + gap
      H += 1 + 14;                  // divider
      rowLays.forEach((r) => (H += r.h));
      if (listLays.length) {
        H += 14 + 22;
        listLays.forEach((r) => (H += r.h));
      }
      H += 14;
      if (footnote) H += 28;
      H += 20;

      const cv = document.createElement("canvas");
      cv.width = Math.round(W * SC);
      cv.height = Math.round(H * SC);
      const c = cv.getContext("2d");
      c.scale(SC, SC);
      c.textBaseline = "alphabetic";
      c.fillStyle = BG; c.fillRect(0, 0, W, H);

      // header
      const grad = c.createLinearGradient(0, 0, W, HEADER);
      grad.addColorStop(0, NAVY); grad.addColorStop(1, NAVY2);
      c.fillStyle = grad; c.fillRect(0, 0, W, HEADER);
      c.fillStyle = GOLD; c.fillRect(0, HEADER - 4, W, 4);
      c.textAlign = "left"; c.fillStyle = "#fff";
      c.font = `800 17px ${FF}`;
      c.fillText("PT ALYSSA AUTO LOGISTIK", PAD, 40);
      c.fillStyle = "rgba(255,255,255,.85)";
      c.font = `700 11.5px ${FF}`;
      c.fillText(title, PAD, 62);
      // badge cek
      c.fillStyle = GOLD; c.font = `900 12px ${FF}`;
      c.textAlign = "right"; c.fillText("✓ LUNAS/CATAT", W - PAD, 40);
      c.textAlign = "left";

      let y = HEADER + 22;

      // nominal besar
      c.fillStyle = MUTE; c.font = `700 11px ${FF}`;
      c.fillText(String(amountLabel).toUpperCase(), PAD, y);
      y += 16;
      c.fillStyle = NAVY; c.font = `900 32px ${FF}`;
      c.fillText("Rp " + (Number(amount) || 0).toLocaleString("id-ID"), PAD, y + 26);
      y += 42 + 16;

      // divider
      c.strokeStyle = LINE; c.lineWidth = 1;
      c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke();
      y += 14;

      // rows
      rowLays.forEach((r) => {
        c.textAlign = "left"; c.fillStyle = MUTE; c.font = `600 12.5px ${FF}`;
        c.fillText(r.k, PAD, y + 16);
        c.textAlign = "right"; c.fillStyle = INK; c.font = `700 13.5px ${FF}`;
        let ly = y + 16;
        r.lines.forEach((ln) => { c.fillText(ln, W - PAD, ly); ly += 18; });
        y += r.h;
      });
      c.textAlign = "left";

      // list rincian PO (opsional)
      if (listLays.length) {
        y += 4;
        c.fillStyle = GOLD; c.fillRect(PAD, y, 3, 14);
        c.fillStyle = INK; c.font = `800 12px ${FF}`;
        c.fillText(String(listTitle || "RINCIAN").toUpperCase(), PAD + 10, y + 12);
        y += 22;
        listLays.forEach((r) => {
          c.textAlign = "left"; c.fillStyle = MUTE; c.font = `600 12px ${FF}`;
          c.fillText(r.k, PAD, y + 15);
          c.textAlign = "right"; c.fillStyle = INK; c.font = `700 12.5px ${FF}`;
          let ly = y + 15;
          r.lines.forEach((ln) => { c.fillText(ln, W - PAD, ly); ly += 17; });
          y += r.h;
        });
        c.textAlign = "left";
      }

      // footnote
      if (footnote) {
        y += 8;
        c.strokeStyle = LINE; c.beginPath(); c.moveTo(PAD, y); c.lineTo(W - PAD, y); c.stroke();
        y += 16;
        c.fillStyle = MUTE; c.font = `400 10.5px ${FF}`;
        c.fillText(footnote, PAD, y);
      }

      cv.toBlob((blob) => {
        if (!blob) { reject(new Error("blob null")); return; }
        resolve({ blob, filename: filename + ".png" });
      }, "image/png");
    } catch (e) { reject(e); }
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* Tombol: 1 klik → share gambar bukti ke WhatsApp (Web Share API + file).
   Fallback (device tidak support share file): unduh gambar + buka WhatsApp. */
function ReceiptActions({ receipt, flash }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await makeReceiptBlob(receipt);
      const file = new File([blob], filename, { type: blob.type });
      if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: "Bukti Pembayaran", text: receipt.shareText || "" });
          setBusy(false); return;
        } catch (e) {
          if (e && e.name === "AbortError") { setBusy(false); return; } // dibatalkan user
          // lanjut ke fallback
        }
      }
      downloadBlob(blob, filename);
      if (flash) flash("Gambar bukti tersimpan. Lampirkan ke chat WhatsApp ya.");
      const wa = "https://wa.me/?text=" + encodeURIComponent(receipt.shareText || "Bukti pembayaran vendor");
      window.open(wa, "_blank");
    } catch (e) {
      if (flash) flash("Gagal membuat gambar bukti");
    } finally { setBusy(false); }
  };
  const saveImg = async () => {
    setBusy(true);
    try {
      const { blob, filename } = await makeReceiptBlob(receipt);
      downloadBlob(blob, filename);
      if (flash) flash("Gambar bukti tersimpan.");
    } catch (e) {
      if (flash) flash("Gagal menyimpan gambar");
    } finally { setBusy(false); }
  };
  return (
    <>
      <button className="vp-btn vp-btn-wa" disabled={busy} onClick={share}>
        {busy ? "Menyiapkan…" : "💬 Kirim Bukti ke WhatsApp"}
      </button>
      <button className="vp-btn vp-btn-ghost" disabled={busy} onClick={saveImg}>🖼️ Simpan Gambar</button>
    </>
  );
}

/* ── Bottom sheet (pilih vendor / jenis biaya) ── */
function BottomSheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="vp-sheet-bg" onClick={onClose}>
      <div className="vp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="vp-sheet-grip" />
        <div className="vp-sheet-head"><span>{title}</span>
          <button className="vp-sheet-x" onClick={onClose} aria-label="Tutup">✕</button></div>
        <div className="vp-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ══════════════ ROOT ══════════════ */
export default function MobileVendorPayment({ embedded = false }) {
  // Kalau dipakai di dalam dashboard admin (embedded), pakai PIN admin yang
  // sudah tersimpan supaya tidak perlu login PIN dua kali.
  const [pin, setPin] = useState(() => localStorage.getItem(PIN_KEY) || (embedded ? (localStorage.getItem("aal_admin_pin") || "") : ""));
  const [authed, setAuthed] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinErr, setPinErr] = useState("");
  const [booting, setBooting] = useState(false);

  const [boot, setBoot] = useState({ kategori: [], metode: [], vendors: [] });
  const [screen, setScreen] = useState("home");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [prefill, setPrefill] = useState(null);       // dari "Belum Dibayar → Bayar"
  const [lastSuccess, setLastSuccess] = useState(null);

  // Mode gelap/terang (🌙/☀️). Standalone: kelola & simpan sendiri (key sama
  // dg halaman lain: "aal-theme"). Embedded di admin: ikut tema admin, tombol
  // disembunyiin biar nggak dobel.
  const [dark, setDark] = useState(() => {
    try { return (localStorage.getItem("aal-theme") || document.documentElement.getAttribute("data-theme")) === "dark"; }
    catch { return false; }
  });
  useEffect(() => {
    if (embedded) return;
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    try { localStorage.setItem("aal-theme", dark ? "dark" : "light"); } catch (_) {}
  }, [dark, embedded]);
  const toggleDark = () => setDark((d) => !d);

  // Dari dalam dashboard admin kirim penanda X-Admin-Embedded: server menerima tanpa PIN
  // kalau admin lagi mode terbuka (admin sudah masuk); kalau admin dikunci, PIN tetap dipakai.
  const embedHdr = embedded ? { "X-Admin-Embedded": "1" } : {};
  const headers = { "X-Admin-Pin": pin, ...embedHdr };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const doBootstrap = useCallback(async (usePin) => {
    setBooting(true); setPinErr("");
    try {
      const r = await axios.get(`${API}/vendor-mobile/bootstrap`, { headers: { "X-Admin-Pin": usePin, ...embedHdr } });
      setBoot({ kategori: r.data.kategori || [], metode: r.data.metode || [], vendors: r.data.vendors || [] });
      localStorage.setItem(PIN_KEY, usePin); setPin(usePin); setAuthed(true);
    } catch (e) {
      const code = e?.response?.status;
      setPinErr(code === 401 ? "PIN salah. Coba lagi." : "Gagal terhubung. Cek internet / server.");
      setAuthed(false);
    } finally { setBooting(false); }
  }, [embedded]);

  // Embedded di dashboard admin: coba bootstrap otomatis (header X-Admin-Embedded) →
  // tidak minta PIN dua kali saat admin mode terbuka. Kalau admin dikunci & PIN
  // tersimpan salah/kosong, bootstrap 401 dan gate PIN tetap muncul.
  useEffect(() => { if (pin || embedded) doBootstrap(pin); }, []); // eslint-disable-line

  const logout = () => { localStorage.removeItem(PIN_KEY); setPin(""); setAuthed(false); setPinInput(""); };

  if (!authed) {
    return (
      <div className="vp-root vp-center"><VpStyle />
        <div className="vp-gate">
          <div className="vp-gate-logo">🚚</div>
          <div className="vp-gate-title">Catat Bayar Vendor</div>
          <div className="vp-gate-sub">Masukkan PIN untuk masuk</div>
          <input className="vp-input vp-input-center" type="tel" inputMode="numeric" placeholder="PIN"
            value={pinInput} onChange={(e) => setPinInput(onlyDigits(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter" && pinInput) doBootstrap(pinInput); }} />
          {pinErr && <div className="vp-err">{pinErr}</div>}
          <button className="vp-btn vp-btn-primary" disabled={!pinInput || booting}
            onClick={() => doBootstrap(pinInput)}>{booting ? "Memeriksa…" : "Masuk"}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vp-root"><VpStyle />
      {loading && <div className="vp-loading"><div className="vp-spinner" /></div>}
      {toast && <div className="vp-toast">{toast}</div>}

      {screen === "home" && <HomeScreen go={setScreen} onLogout={logout} dark={dark} toggleDark={toggleDark} showThemeToggle={!embedded} />}
      {screen === "vendors" && (
        <VendorsScreen embedded={embedded} headers={headers} onBack={() => setScreen("home")} setLoading={setLoading} flash={flash} />
      )}
      {screen === "form" && (
        <FormScreen boot={boot} headers={headers} onBack={() => { setPrefill(null); setScreen("home"); }}
          setLoading={setLoading} flash={flash} prefill={prefill}
          onSuccess={(data) => { setLastSuccess(data); setPrefill(null); setScreen("success"); }} />
      )}
      {screen === "unpaid" && (
        <UnpaidScreen headers={headers} onBack={() => setScreen("home")} setLoading={setLoading} flash={flash}
          onPay={(item) => { setPrefill(item); setScreen("form"); }} />
      )}
      {screen === "history" && (
        <HistoryScreen headers={headers} onBack={() => setScreen("home")} setLoading={setLoading} flash={flash} />
      )}
      {screen === "success" && (
        <SuccessScreen data={lastSuccess} flash={flash} onAgain={() => setScreen("form")} onHome={() => setScreen("home")} />
      )}
    </div>
  );
}

/* ══════════════ HOME (3 menu besar) ══════════════ */
function HomeScreen({ go, onLogout, dark, toggleDark, showThemeToggle }) {
  const menus = [
    { key: "vendors", icon: "🏢", title: "Bayar per Vendor", sub: "Pilih vendor, centang PO, bayar sekaligus", cls: "vp-m-blue" },
    { key: "form", icon: "📝", title: "Catat Pembayaran", sub: "Input pembayaran ke vendor", cls: "vp-m-blue" },
    { key: "unpaid", icon: "⏳", title: "Belum Dibayar", sub: "Daftar tagihan vendor belum lunas", cls: "vp-m-gold" },
    { key: "history", icon: "🧾", title: "Riwayat Pembayaran", sub: "Lihat pembayaran yang sudah dicatat", cls: "vp-m-green" },
  ];
  return (
    <div className="vp-screen">
      <div className="vp-topbar vp-topbar-home">
        <div><div className="vp-hi">Halo 👋</div><div className="vp-brand">PT Alyssa Auto Logistik</div></div>
        <div style={{ display: "flex", gap: 8 }}>
          {showThemeToggle && (
            <button className="vp-logout" onClick={toggleDark} aria-label="Ganti tema" title="Mode gelap/terang">{dark ? "☀️" : "🌙"}</button>
          )}
          <button className="vp-logout" onClick={onLogout}>Keluar</button>
        </div>
      </div>
      <div className="vp-body">
        <div className="vp-menu-list">
          {menus.map((m) => (
            <button key={m.key} className={`vp-menu ${m.cls}`} onClick={() => go(m.key)}>
              <span className="vp-menu-ico">{m.icon}</span>
              <span className="vp-menu-txt"><span className="vp-menu-title">{m.title}</span>
                <span className="vp-menu-sub">{m.sub}</span></span>
              <span className="vp-menu-arrow">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ══════════════ FORM — Catat Pembayaran ══════════════ */
function FormScreen({ boot, headers, onBack, setLoading, flash, onSuccess, prefill }) {
  const isPrefill = !!(prefill && prefill.job_id);
  const [trip, setTrip] = useState(prefill ? { trip_id: prefill.trip_id, nopol: prefill.nopol, rute: prefill.rute } : null);
  const [asal, setAsal] = useState("");     // rute leg yang dibayar — bisa diubah (default dari trip)
  const [tujuan, setTujuan] = useState("");
  const pickTrip = (t) => { setTrip(t); setAsal(t?.asal || ""); setTujuan(t?.tujuan || ""); };
  const [tripQ, setTripQ] = useState("");
  const [tripResults, setTripResults] = useState([]);
  const [tripSearching, setTripSearching] = useState(false);
  const [vendor, setVendor] = useState(prefill ? { id: prefill.supplier_id, nama: prefill.supplier_nama } : null);
  const [kategori, setKategori] = useState(prefill?.kategori || "");
  const [nominal, setNominal] = useState(prefill?.sisa ? String(prefill.sisa) : "");
  const [tanggal, setTanggal] = useState(todayIso());
  const [metode, setMetode] = useState((boot.metode && boot.metode[0]) || "Transfer");
  const [catatan, setCatatan] = useState("");
  const [bukti, setBukti] = useState(null);
  const [buktiPreview, setBuktiPreview] = useState("");
  const [sheetVendor, setSheetVendor] = useState(false);
  const [sheetKat, setSheetKat] = useState(false);
  const [vendorFilter, setVendorFilter] = useState("");
  const [newVendor, setNewVendor] = useState("");
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef();

  // Cari trip: daftar trip terbaru di-load sekali (langsung tampil & difilter instan
  // saat ngetik), server dicari paralel (debounce pendek) buat trip yang lebih lama.
  const normCari = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const [tripRecent, setTripRecent] = useState([]);
  useEffect(() => {
    if (isPrefill) return;
    let alive = true;
    axios.get(`${API}/vendor-mobile/trips`, { headers, params: { limit: 50 } })
      .then((r) => { if (alive) setTripRecent(r.data.items || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line
  const tripLocal = (q) => {
    const n = normCari(q);
    return tripRecent.filter((t) =>
      normCari(`${t.trip_id} ${t.nopol} ${t.customer} ${t.rute}`).includes(n)).slice(0, 25);
  };
  useEffect(() => {
    if (isPrefill) return;
    const q = tripQ.trim();
    if (!q) { setTripResults([]); setTripSearching(false); return; }
    setTripResults(tripLocal(q));   // instan dari daftar terbaru
    let alive = true; setTripSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/vendor-mobile/trips`, { headers, params: { q } });
        if (alive) setTripResults(r.data.items || []);
      } catch { /* biarin hasil lokal */ }
      finally { if (alive) setTripSearching(false); }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
  }, [tripQ]); // eslint-disable-line

  const onPickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") { flash("File harus gambar / PDF"); return; }
    if (f.size > 8 * 1024 * 1024) { flash("Ukuran maksimal 8MB"); return; }
    setBukti(f);
    setBuktiPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : "");
  };

  const nominalNum = Number(onlyDigits(nominal)) || 0;
  const vendorLabel = vendor ? vendor.nama : "Pilih vendor";
  const canSave = nominalNum > 0 && !!vendor && (isPrefill || !!trip) && !!kategori;

  const vendorsFiltered = (boot.vendors || []).filter((v) =>
    !vendorFilter.trim() || (v.nama || "").toLowerCase().includes(vendorFilter.trim().toLowerCase()));

  const doSave = async () => {
    setConfirm(false); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("amount", String(nominalNum));
      fd.append("tanggal", tanggal);
      fd.append("metode", metode);
      fd.append("catatan", catatan);
      fd.append("kategori", kategori);
      if (isPrefill) { fd.append("supplier_id", prefill.supplier_id); fd.append("job_id", prefill.job_id); }
      else {
        fd.append("trip_id", trip.trip_id);
        if (asal.trim()) fd.append("asal_kota", asal.trim());
        if (tujuan.trim()) fd.append("tujuan_kota", tujuan.trim());
        if (vendor.id) fd.append("supplier_id", vendor.id);
        else fd.append("vendor_name", vendor.nama);
      }
      if (bukti) fd.append("bukti", bukti);
      const r = await axios.post(`${API}/vendor-mobile/pay`, fd, { headers });
      onSuccess({
        ...r.data, _nominal: nominalNum, _tanggal: tanggal, _metode: metode, _kategori: kategori,
        _vendor: vendor.nama, _nopol: (r.data.nopol || trip?.nopol || prefill?.nopol || "-"), _catatan: catatan,
      });
    } catch (e) {
      flash(e?.response?.data?.detail || "Gagal menyimpan pembayaran");
    } finally { setLoading(false); }
  };

  return (
    <div className="vp-screen">
      <div className="vp-topbar">
        <button className="vp-back" onClick={onBack}>‹ Kembali</button>
        <div className="vp-topbar-title">Catat Pembayaran</div>
        <div style={{ width: 64 }} />
      </div>

      <div className="vp-body vp-body-form">
        {/* Trip / Nopol */}
        <div className="vp-field">
          <label className="vp-label">Trip / Nomor Polisi</label>
          {isPrefill || trip ? (
            <>
            <div className="vp-picked">
              <div>
                <div className="vp-picked-main">{trip?.nopol || "—"}</div>
                {isPrefill
                  ? <div className="vp-picked-sub">{trip?.rute || ""}{trip?.trip_id ? ` · ${trip.trip_id}` : ""}</div>
                  : <div className="vp-picked-sub">{trip?.trip_id || ""}</div>}
              </div>
              {!isPrefill && <button className="vp-change" onClick={() => { setTrip(null); setTripQ(""); setAsal(""); setTujuan(""); }}>Ganti</button>}
            </div>
            {!isPrefill && (
              <div className="vp-rute-edit">
                <div className="vp-rute-col">
                  <label className="vp-label vp-label-sm">Asal</label>
                  <input className="vp-input" value={asal} onChange={(e) => setAsal(e.target.value)} placeholder="Kota asal" />
                </div>
                <span className="vp-rute-arrow">→</span>
                <div className="vp-rute-col">
                  <label className="vp-label vp-label-sm">Tujuan</label>
                  <input className="vp-input" value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Kota tujuan" />
                </div>
              </div>
            )}
            {!isPrefill && <div className="vp-hint">Rute leg yang dibayar — tap untuk ubah kalau beda dari rute trip.</div>}
            </>
          ) : (
            <>
              <input className="vp-input" inputMode="search" placeholder="Ketik nopol / trip / customer…"
                value={tripQ} onChange={(e) => setTripQ(e.target.value)}
                onFocus={() => { if (!tripQ.trim() && tripRecent.length) setTripResults(tripRecent.slice(0, 10)); }} />
              {tripSearching && tripResults.length === 0 && <div className="vp-hint">Mencari…</div>}
              {tripResults.length > 0 && (
                <div className="vp-results">
                  {tripResults.map((t) => (
                    <button key={t.trip_id} className="vp-result" onClick={() => { pickTrip(t); setTripResults([]); setTripQ(""); }}>
                      <div className="vp-result-main">{t.nopol || "(tanpa nopol)"} <span className="vp-result-veh">{t.vehicle}</span></div>
                      <div className="vp-result-sub">{t.rute} · {t.customer || "-"}</div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Vendor */}
        <div className="vp-field">
          <label className="vp-label">Vendor</label>
          <button className={`vp-select ${vendor ? "" : "vp-placeholder"}`} onClick={() => !isPrefill && setSheetVendor(true)} disabled={isPrefill}>
            {vendorLabel}<span className="vp-select-caret">▾</span>
          </button>
        </div>

        {/* Jenis biaya */}
        <div className="vp-field">
          <label className="vp-label">Jenis Biaya</label>
          <button className={`vp-select ${kategori ? "" : "vp-placeholder"}`} onClick={() => setSheetKat(true)}>
            {kategori || "Pilih jenis biaya"}<span className="vp-select-caret">▾</span>
          </button>
        </div>

        {/* Nominal */}
        <div className="vp-field">
          <label className="vp-label">Nominal Pembayaran</label>
          <div className="vp-rp">
            <span className="vp-rp-tag">Rp</span>
            <input className="vp-input vp-rp-input" inputMode="numeric" type="text" placeholder="0"
              value={fmtRpInput(nominal)} onChange={(e) => setNominal(onlyDigits(e.target.value))} />
          </div>
          {isPrefill && <div className="vp-hint">Sisa tagihan: {fmtRp(prefill.sisa)} — boleh bayar sebagian.</div>}
        </div>

        {/* Tanggal */}
        <div className="vp-field">
          <label className="vp-label">Tanggal Pembayaran</label>
          <input className="vp-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </div>

        {/* Metode */}
        <div className="vp-field">
          <label className="vp-label">Metode Pembayaran</label>
          <div className="vp-chips">
            {(boot.metode || ["Transfer", "Tunai", "Lainnya"]).map((m) => (
              <button key={m} className={`vp-chip ${metode === m ? "vp-chip-on" : ""}`} onClick={() => setMetode(m)}>{m}</button>
            ))}
          </div>
        </div>

        {/* Bukti */}
        <div className="vp-field">
          <label className="vp-label">Bukti Transfer (opsional)</label>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPickFile} />
          {bukti ? (
            <div className="vp-bukti">
              {buktiPreview ? <img src={buktiPreview} alt="bukti" className="vp-bukti-img" /> : <div className="vp-bukti-file">📄 {bukti.name}</div>}
              <button className="vp-bukti-rm" onClick={() => { setBukti(null); setBuktiPreview(""); if (fileRef.current) fileRef.current.value = ""; }}>Hapus</button>
            </div>
          ) : (
            <button className="vp-upload" onClick={() => fileRef.current && fileRef.current.click()}>📷 Ambil / Pilih Foto</button>
          )}
        </div>

        {/* Catatan */}
        <div className="vp-field">
          <label className="vp-label">Catatan (opsional)</label>
          <textarea className="vp-input vp-textarea" rows={2} placeholder="contoh: DP kapal Surabaya"
            value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </div>
        <div style={{ height: 12 }} />
      </div>

      {/* Sticky simpan */}
      <div className="vp-sticky">
        <button className="vp-btn vp-btn-primary" disabled={!canSave} onClick={() => setConfirm(true)}>💾 Simpan Pembayaran</button>
      </div>

      {/* Sheet vendor */}
      <BottomSheet open={sheetVendor} title="Pilih Vendor" onClose={() => setSheetVendor(false)}>
        <input className="vp-input" placeholder="Cari vendor…" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} />
        <div className="vp-sheet-list">
          {vendorsFiltered.map((v) => (
            <button key={v.id} className="vp-sheet-item" onClick={() => { setVendor(v); setSheetVendor(false); setVendorFilter(""); }}>{v.nama}</button>
          ))}
          {vendorsFiltered.length === 0 && <div className="vp-hint" style={{ padding: 8 }}>Vendor tidak ada.</div>}
        </div>
        <div className="vp-sheet-new">
          <input className="vp-input" placeholder="+ Vendor baru (ketik nama)" value={newVendor} onChange={(e) => setNewVendor(e.target.value)} />
          <button className="vp-btn vp-btn-ghost" disabled={!newVendor.trim()}
            onClick={() => { setVendor({ id: null, nama: newVendor.trim() }); setNewVendor(""); setSheetVendor(false); }}>Pakai</button>
        </div>
      </BottomSheet>

      {/* Sheet kategori */}
      <BottomSheet open={sheetKat} title="Jenis Biaya" onClose={() => setSheetKat(false)}>
        <div className="vp-sheet-list">
          {(boot.kategori || []).map((k) => (
            <button key={k} className="vp-sheet-item" onClick={() => { setKategori(k); setSheetKat(false); }}>{k}</button>
          ))}
        </div>
      </BottomSheet>

      {/* Konfirmasi */}
      <BottomSheet open={confirm} title="Konfirmasi Pembayaran" onClose={() => setConfirm(false)}>
        <div className="vp-confirm">
          <Row k="Nopol" v={trip?.nopol || prefill?.nopol || "-"} />
          {!isPrefill && (asal.trim() || tujuan.trim()) && <Row k="Rute" v={`${asal.trim() || "-"} → ${tujuan.trim() || "-"}`} />}
          <Row k="Vendor" v={vendor?.nama || "-"} />
          <Row k="Jenis Biaya" v={kategori || "-"} />
          <Row k="Nominal" v={fmtRp(nominalNum)} big />
          <Row k="Tanggal" v={fmtTgl(tanggal)} />
          <Row k="Metode" v={metode} />
        </div>
        <button className="vp-btn vp-btn-primary" onClick={doSave}>✅ Ya, Simpan</button>
        <button className="vp-btn vp-btn-ghost" onClick={() => setConfirm(false)}>Batal</button>
      </BottomSheet>
    </div>
  );
}

function Row({ k, v, big }) {
  return <div className="vp-crow"><span className="vp-crow-k">{k}</span><span className={`vp-crow-v ${big ? "vp-crow-big" : ""}`}>{v}</span></div>;
}

/* ══════════════ BELUM DIBAYAR ══════════════ */
function UnpaidScreen({ headers, onBack, setLoading, flash, onPay }) {
  const [items, setItems] = useState([]);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/vendor-mobile/unpaid`, { headers }); setItems(r.data.items || []); }
    catch { flash("Gagal memuat data"); } finally { setLoading(false); }
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  return (
    <div className="vp-screen">
      <div className="vp-topbar">
        <button className="vp-back" onClick={onBack}>‹ Kembali</button>
        <div className="vp-topbar-title">Belum Dibayar</div><div style={{ width: 64 }} />
      </div>
      <div className="vp-body">
        {items.length === 0 && <div className="vp-empty">🎉 Semua tagihan vendor sudah lunas.</div>}
        {items.map((it) => (
          <div key={it.job_id} className="vp-card">
            <div className="vp-card-top">
              <span className="vp-card-nopol">{it.nopol || "(tanpa nopol)"}</span>
              <span className="vp-card-kat">{it.kategori}</span>
            </div>
            <div className="vp-card-rute">{it.rute}</div>
            <div className="vp-card-vendor">🏢 {it.supplier_nama}</div>
            <div className="vp-card-money">
              <div><span className="vp-card-lbl">Sisa</span><span className="vp-card-sisa">{fmtRp(it.sisa)}</span></div>
              {it.terbayar > 0 && <div className="vp-card-part">Terbayar {fmtRp(it.terbayar)} dari {fmtRp(it.total_harga)}</div>}
            </div>
            <button className="vp-btn vp-btn-primary vp-btn-card" onClick={() => onPay(it)}>Bayar</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════ RIWAYAT ══════════════ */
function HistoryScreen({ headers, onBack, setLoading, flash }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);
  const load = useCallback(async (query) => {
    setLoading(true);
    try { const r = await axios.get(`${API}/vendor-mobile/history`, { headers, params: query ? { q: query } : {} }); setItems(r.data.items || []); }
    catch { flash("Gagal memuat riwayat"); } finally { setLoading(false); }
  }, []); // eslint-disable-line
  useEffect(() => { load(""); }, [load]);
  useEffect(() => { const t = setTimeout(() => load(q.trim()), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line

  return (
    <div className="vp-screen">
      <div className="vp-topbar">
        <button className="vp-back" onClick={onBack}>‹ Kembali</button>
        <div className="vp-topbar-title">Riwayat Pembayaran</div><div style={{ width: 64 }} />
      </div>
      <div className="vp-searchbar">
        <input className="vp-input" inputMode="search" placeholder="Cari vendor / nopol / trip…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="vp-body">
        {items.length === 0 && <div className="vp-empty">Belum ada pembayaran.</div>}
        {items.map((it) => (
          <button key={it.payment_id} className="vp-hcard" onClick={() => setDetail(it)}>
            <div className="vp-hcard-l">
              <div className="vp-hcard-vendor">{it.supplier_nama}</div>
              <div className="vp-hcard-sub">{it.nopol || "-"} · {it.kategori} · {fmtTgl(it.tanggal)}</div>
            </div>
            <div className="vp-hcard-r">
              <div className="vp-hcard-amt">{fmtRp(it.amount)}</div>
              <div className="vp-hcard-met">{it.metode}{it.bukti_url ? " · 📎" : ""}</div>
            </div>
          </button>
        ))}
      </div>

      <BottomSheet open={!!detail} title="Detail Pembayaran" onClose={() => setDetail(null)}>
        {detail && (
          <div className="vp-confirm">
            <Row k="Vendor" v={detail.supplier_nama} />
            <Row k="Nopol" v={detail.nopol || "-"} />
            <Row k="Rute" v={detail.rute} />
            <Row k="Jenis Biaya" v={detail.kategori} />
            <Row k="Nominal" v={fmtRp(detail.amount)} big />
            <Row k="Tanggal" v={fmtTgl(detail.tanggal)} />
            <Row k="Metode" v={detail.metode} />
            {detail.catatan ? <Row k="Catatan" v={detail.catatan} /> : null}
            {detail.bukti_url
              ? <a className="vp-btn vp-btn-ghost" href={buktiHref(detail.bukti_url)} target="_blank" rel="noreferrer">📎 Lihat Bukti Transfer</a>
              : <div className="vp-hint" style={{ textAlign: "center", marginTop: 8 }}>Tidak ada bukti transfer.</div>}
          </div>
        )}
      </BottomSheet>
    </div>
  );
}

/* ══════════════ BAYAR PER VENDOR (grouped + multi-select + batch) ══════════════ */
const STATUS_CHIP = {
  belum:    { txt: "Belum Dibayar", cls: "vp-st-belum" },
  sebagian: { txt: "Sebagian",      cls: "vp-st-sebagian" },
  lunas:    { txt: "Lunas",         cls: "vp-st-lunas" },
};

function VendorsScreen({ headers, onBack, setLoading, flash, embedded }) {
  const [mode, setMode] = useState("list");      // list | detail | pay | success
  const [vendors, setVendors] = useState([]);
  const [vendor, setVendor] = useState(null);    // vendor terpilih (dengan jobs)
  const [sel, setSel] = useState({});            // job_id -> true (PO dicentang)
  const [result, setResult] = useState(null);

  // form bayar
  const [nominal, setNominal] = useState("");
  const [tanggal, setTanggal] = useState(todayIso());
  const [metode, setMetode] = useState("Transfer");
  const [catatan, setCatatan] = useState("");
  const [bukti, setBukti] = useState(null);
  const [buktiPreview, setBuktiPreview] = useState("");
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef();

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await axios.get(`${API}/vendor-mobile/vendors-unpaid`, { headers }); setVendors(r.data.items || []); }
    catch { flash("Gagal memuat vendor"); } finally { setLoading(false); }
  }, []); // eslint-disable-line
  useEffect(() => { if (mode === "list") load(); }, [mode, load]);

  // Centangan PO diingat per vendor (tahan refresh/tutup tab) — tidak perlu klik 19 unit lagi.
  const SEL_KEY = (sid) => `vp-sel-${sid}`;
  const readSel = (v) => {
    try {
      const ids = JSON.parse(localStorage.getItem(SEL_KEY(v.supplier_id)) || "[]");
      const ok = new Set((v.jobs || []).filter((j) => (j.sisa || 0) > 0).map((j) => j.job_id));
      const out = {}; (Array.isArray(ids) ? ids : []).forEach((id) => { if (ok.has(id)) out[id] = true; });
      return out;
    } catch (_) { return {}; }
  };
  const openVendor = (v) => { setVendor(v); setSel(readSel(v)); setMode("detail"); };
  useEffect(() => {
    if (!vendor || mode !== "detail") return;
    try {
      const ids = Object.keys(sel).filter((k) => sel[k]);
      if (ids.length) localStorage.setItem(SEL_KEY(vendor.supplier_id), JSON.stringify(ids));
      else localStorage.removeItem(SEL_KEY(vendor.supplier_id));
    } catch (_) { /* storage diblokir: abaikan */ }
  }, [sel, vendor, mode]); // eslint-disable-line
  const payableJobs = (vendor?.jobs || []).filter((j) => (j.sisa || 0) > 0);
  const selJobs = payableJobs.filter((j) => sel[j.job_id]);
  const totalSel = selJobs.reduce((a, j) => a + (j.sisa || 0), 0);

  const toggle = (jid) => setSel((s) => ({ ...s, [jid]: !s[jid] }));
  const selectAll = () => {
    const all = payableJobs.length > 0 && payableJobs.every((j) => sel[j.job_id]);
    const next = {};
    if (!all) payableJobs.forEach((j) => { next[j.job_id] = true; });
    setSel(next);
  };

  // 🎯 Tembak Rekon (hanya dari dashboard admin): bagi pembayaran Rekon bank ke PO yang dicentang,
  // lalu cetak A4 Ringkasan Supplier untuk PO itu. Mengganti alokasi rekon itu saja — tidak
  // menyentuh pembayaran manual / rekon lain.
  const [tbOpen, setTbOpen] = useState(false);
  const [tbSup, setTbSup] = useState(null);      // dokumen supplier lengkap (rekon_payments, jobs)
  const [tbIds, setTbIds] = useState([]);        // PO yang ditembak (snapshot saat dibuka)
  const [tbBusy, setTbBusy] = useState("");
  const [tbMsg, setTbMsg] = useState("");
  const [tbDone, setTbDone] = useState(false);
  const [tbOther, setTbOther] = useState([]);    // rekon aktif yang tercatat di vendor LAIN
  const [tbOtherState, setTbOtherState] = useState("idle");   // idle | loading | done | error
  const [tbTrail, setTbTrail] = useState([]);    // jejak impor rekon yang BUKAN pembayaran aktif (reversed / error / dicatat sebagai biaya / supplier tak ketemu)
  const loadTbSup = async () => {
    const r = await axios.get(`${API}/admin/suppliers/${vendor.supplier_id}`, { headers });
    setTbSup(r.data);
    return r.data;
  };
  const openTembak = async () => {
    if (selJobs.length === 0) { flash("Centang minimal 1 PO dulu"); return; }
    setTbIds(selJobs.map((j) => j.job_id)); setTbMsg(""); setTbDone(false); setTbSup(null); setTbOpen(true);
    setTbOther([]); setTbOtherState("loading"); setTbTrail([]);
    try { await loadTbSup(); } catch { flash("Gagal memuat pembayaran Rekon"); setTbOpen(false); return; }
    try {
      const r = await axios.get(`${API}/admin/rekon/other-payments`, { headers, params: { exclude_supplier_id: vendor.supplier_id, limit: 60 } });
      setTbOther(r.data.items || []); setTbOtherState("done");
    } catch (_) { setTbOtherState("error"); }
    try {
      const r2 = await axios.get(`${API}/admin/rekon/imports`, { headers, params: { limit: 150 } });
      setTbTrail((r2.data.items || []).filter((x) => x.status && x.status !== "processed"));
    } catch (_) { setTbTrail([]); }
  };
  // Rekon tercatat di vendor lain → pindahkan ke vendor ini (jalur koreksi resmi), lalu tembak + PDF.
  const doPindahTembak = async (o) => {
    const ok = window.confirm(
      `Pindahkan rekon ${fmtRp(o.amount)} (${o.tanggal || "-"}) dari "${o.supplier_nama}" ke "${vendor.supplier_nama}"?\n\n` +
      `• Jejak pemindahan tersimpan (audit).\n` +
      `• Alokasi rekon ini di "${o.supplier_nama}" direset${o.allocated > 0 ? ` — unit di sana yang sudah terbayar ${fmtRp(o.allocated)} dari rekon ini kembali belum terbayar` : ""}.\n` +
      `• Setelah itu langsung dibagi ke ${tbIds.length} PO yang dicentang & PDF dibuka.`);
    if (!ok) return;
    setTbBusy(o.id); setTbMsg("");
    try {
      await axios.post(`${API}/admin/rekon/imports/${encodeURIComponent(o.bank_transaction_id)}/pindah`, { supplier_id_baru: vendor.supplier_id }, { headers });
      const doc = await loadTbSup();
      setTbOther((l) => l.filter((x) => x.id !== o.id));
      const pay = (doc.rekon_payments || []).find((x) => x.bank_transaction_id === o.bank_transaction_id);
      if (!pay) { setTbMsg("Dipindahkan, tapi pembayarannya tidak ditemukan — coba lagi."); return; }
      await doTembak(pay);
    } catch (e) { setTbMsg(e?.response?.data?.detail || "Gagal memindahkan rekon"); }
    finally { setTbBusy(""); }
  };
  // Tembak 1 pembayaran Rekon ke PO terpilih lalu LANGSUNG buka PDF A4 (kalau ada yang masuk).
  const doTembak = async (p) => {
    setTbBusy(p.id); setTbMsg("");
    try {
      const { data } = await axios.post(`${API}/admin/suppliers/${vendor.supplier_id}/rekon-payments/${p.id}/tembak`, { job_ids: tbIds }, { headers });
      const doc = await loadTbSup();
      setTbDone(data.allocated > 0);
      setTbMsg(data.allocated > 0
        ? `✓ ${fmtRp(data.allocated)} masuk ke ${data.units} PO${data.unallocated ? ` · sisa ${fmtRp(data.unallocated)} belum dialokasikan` : ""}${data.note ? ` — ${data.note}` : ""}`
        : (data.note || "Tidak ada PO yang bisa dibayar"));
      if (data.allocated > 0) cetakTembak(doc);
    } catch (e) { setTbMsg(e?.response?.data?.detail || "Gagal tembak rekon"); }
    finally { setTbBusy(""); }
  };
  // Dari jejak: pulihkan rekon yang di-Reverse (di vendor mana pun) → muncul lagi sebagai rekon aktif.
  const pulihkanJejak = async (t) => {
    if (!window.confirm(`Pulihkan rekon ${fmtRp(t.amount || t.nominal)}?\n\nKembali jadi Belum Dialokasikan di vendornya. Setelah itu muncul di daftar untuk ditembak / dipindah.`)) return;
    setTbBusy(t.bank_transaction_id); setTbMsg("");
    try {
      await axios.post(`${API}/admin/rekon/imports/${encodeURIComponent(t.bank_transaction_id)}/restore`, {}, { headers });
      await loadTbSup();
      const r = await axios.get(`${API}/admin/rekon/other-payments`, { headers, params: { exclude_supplier_id: vendor.supplier_id, limit: 60 } });
      setTbOther(r.data.items || []); setTbOtherState("done");
      setTbTrail((l) => l.filter((x) => x.bank_transaction_id !== t.bank_transaction_id));
      setTbMsg("✓ Dipulihkan — cek daftar rekon di atas.");
    } catch (e) { setTbMsg(e?.response?.data?.detail || "Gagal memulihkan"); }
    finally { setTbBusy(""); }
  };
  // Rekon yang pernah di-Reverse: Pulihkan + Tembak + PDF dalam 1 klik.
  const doPulihTembak = async (r) => {
    setTbBusy(r.id); setTbMsg("");
    try {
      await axios.post(`${API}/admin/rekon/imports/${encodeURIComponent(r.bank_transaction_id)}/restore`, {}, { headers });
      const doc = await loadTbSup();
      const pay = (doc.rekon_payments || []).find((x) => x.bank_transaction_id === r.bank_transaction_id);
      if (!pay) { setTbMsg("Dipulihkan, tapi pembayarannya tidak ditemukan — coba lagi."); return; }
      await doTembak(pay);
    } catch (e) { setTbMsg(e?.response?.data?.detail || "Gagal memulihkan rekon"); }
    finally { setTbBusy(""); }
  };
  const cetakTembak = (docArg) => {
    const doc = (docArg && docArg.jobs) ? docArg : tbSup;
    if (!doc) return;
    const ids = new Set(tbIds);
    const jobs = (doc.jobs || []).filter((j) => ids.has(j.id));
    if (!jobs.length) { flash("PO tidak ditemukan"); return; }
    printSupplierA4(doc, jobs, supplierAutoDocNo(), "");
  };
  const closeTembak = () => { setTbOpen(false); if (tbDone) { setMode("list"); } };

  const goPay = () => {
    if (selJobs.length === 0) { flash("Centang minimal 1 PO dulu"); return; }
    setNominal(String(totalSel));   // default = total sisa PO terpilih
    setTanggal(todayIso()); setMetode("Transfer"); setCatatan(""); setBukti(null); setBuktiPreview("");
    setMode("pay");
  };

  const onPickFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith("image/") && f.type !== "application/pdf") { flash("File harus gambar / PDF"); return; }
    if (f.size > 8 * 1024 * 1024) { flash("Ukuran maksimal 8MB"); return; }
    setBukti(f);
    setBuktiPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : "");
  };

  const nominalNum = Number(onlyDigits(nominal)) || 0;

  const doSave = async () => {
    setConfirm(false); setLoading(true);
    try {
      const fd = new FormData();
      fd.append("supplier_id", vendor.supplier_id);
      fd.append("job_ids", selJobs.map((j) => j.job_id).join(","));   // urutan = urutan bayar (waterfall)
      fd.append("amount", String(nominalNum));
      fd.append("tanggal", tanggal);
      fd.append("metode", metode);
      fd.append("catatan", catatan);
      if (bukti) fd.append("bukti", bukti);
      const r = await axios.post(`${API}/vendor-mobile/pay-batch`, fd, { headers });
      setResult({ ...r.data, _vendor: vendor.supplier_nama, _tanggal: tanggal, _metode: metode });
      setMode("success");
    } catch (e) {
      flash(e?.response?.data?.detail || "Gagal menyimpan pembayaran");
    } finally { setLoading(false); }
  };

  /* ── LIST vendor ── */
  if (mode === "list") {
    return (
      <div className="vp-screen">
        <div className="vp-topbar">
          <button className="vp-back" onClick={onBack}>‹ Kembali</button>
          <div className="vp-topbar-title">Bayar per Vendor</div><div style={{ width: 64 }} />
        </div>
        <div className="vp-body">
          {vendors.length === 0 && <div className="vp-empty">🎉 Semua tagihan vendor sudah lunas.</div>}
          {vendors.map((v) => (
            <button key={v.supplier_id} className="vp-card vp-vendor-card" onClick={() => openVendor(v)}>
              <div className="vp-card-top">
                <span className="vp-card-nopol">🏢 {v.supplier_nama}</span>
                <span className="vp-menu-arrow">›</span>
              </div>
              <div className="vp-card-rute">{v.jumlah_po} PO · Tagihan {fmtRp(v.total_tagihan)}</div>
              <div className="vp-card-money">
                <div><span className="vp-card-lbl">Sisa</span><span className="vp-card-sisa">{fmtRp(v.total_sisa)}</span></div>
                {v.total_terbayar > 0 && <div className="vp-card-part">Terbayar {fmtRp(v.total_terbayar)}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* ── DETAIL: centang PO ── */
  if (mode === "detail") {
    const allChecked = payableJobs.length > 0 && payableJobs.every((j) => sel[j.job_id]);
    return (
      <div className="vp-screen">
        <div className="vp-topbar">
          <button className="vp-back" onClick={() => setMode("list")}>‹ Kembali</button>
          <div className="vp-topbar-title">Pilih PO</div><div style={{ width: 64 }} />
        </div>
        <div className="vp-body" style={{ paddingBottom: 120 }}>
          <div className="vp-vendor-head">
            <div className="vp-vendor-name">🏢 {vendor.supplier_nama}</div>
            <div className="vp-vendor-sisa">Sisa total {fmtRp(vendor.total_sisa)}</div>
          </div>
          {payableJobs.length > 1 && (
            <button className="vp-selectall" onClick={selectAll}>{allChecked ? "☑ Batal pilih semua" : "◻ Pilih semua PO"}</button>
          )}
          {(vendor.jobs || []).map((j) => {
            const st = STATUS_CHIP[j.status] || STATUS_CHIP.belum;
            const disabled = (j.sisa || 0) <= 0;
            const on = !!sel[j.job_id];
            return (
              <div key={j.job_id} className={`vp-card vp-po-card ${on ? "vp-po-on" : ""} ${disabled ? "vp-po-off" : ""}`}
                onClick={() => !disabled && toggle(j.job_id)}>
                <div className="vp-po-row">
                  <span className={`vp-check ${on ? "vp-check-on" : ""} ${disabled ? "vp-check-dis" : ""}`}>{on ? "✓" : ""}</span>
                  <div style={{ flex: 1 }}>
                    <div className="vp-card-top" style={{ marginBottom: 2 }}>
                      <span className="vp-card-nopol">{j.nopol || "(tanpa nopol)"}</span>
                      <span className={`vp-stchip ${st.cls}`}>{st.txt}</span>
                    </div>
                    <div className="vp-card-rute">{j.rute} · {j.kategori}</div>
                    <div className="vp-po-money">
                      <span className="vp-po-sisa">Sisa {fmtRp(j.sisa)}</span>
                      {j.terbayar > 0 && <span className="vp-po-sub"> · terbayar {fmtRp(j.terbayar)} / {fmtRp(j.total_harga)}</span>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {payableJobs.length === 0 && <div className="vp-empty">Semua PO vendor ini sudah lunas 🎉</div>}
        </div>
        {/* Sticky total + bayar */}
        <div className="vp-sticky">
          <div className="vp-selbar">
            <div><div className="vp-selbar-lbl">{selJobs.length} PO dipilih</div><div className="vp-selbar-amt">{fmtRp(totalSel)}</div></div>
          </div>
          <button className="vp-btn vp-btn-primary" disabled={selJobs.length === 0} onClick={goPay}>💰 Bayar yang Dipilih</button>
          {embedded && <button className="vp-btn vp-btn-ghost" style={{ marginTop: 8 }} disabled={selJobs.length === 0} onClick={openTembak} data-testid="vp-tembak-open">🎯 Tembak Rekon ke yang Dipilih</button>}
        </div>
        <BottomSheet open={tbOpen} title={`Tembak Rekon · ${tbIds.length} PO`} onClose={closeTembak}>
          {!tbSup && <div className="vp-hint" style={{ textAlign: "center" }}>Memuat pembayaran Rekon…</div>}
          {tbSup && (tbSup.rekon_payments || []).length === 0 && (tbSup.rekon_reversed || []).length === 0 && (
            <div className="vp-hint" style={{ textAlign: "center" }}>Belum ada pembayaran Rekon untuk vendor ini.{tbOther.length > 0 ? " Tapi ada rekon yang tercatat di vendor lain — cek daftar di bawah." : " Tarik dulu dari Audit Rekon."}</div>
          )}
          {tbSup && (tbSup.rekon_payments || []).length === 0 && (tbSup.rekon_reversed || []).length > 0 && (
            <div className="vp-hint" style={{ textAlign: "center" }}>Rekon vendor ini sebelumnya dibatalkan (Reverse). Pulihkan langsung dari sini:</div>
          )}
          {tbSup && (tbSup.rekon_reversed || []).map((r) => (
            <div key={r.id} className="vp-card" style={{ marginBottom: 8, borderStyle: "dashed" }}>
              <div className="vp-card-top" style={{ marginBottom: 2 }}>
                <span className="vp-card-nopol">{fmtRp(r.amount)}</span>
                <span className="vp-card-rute" style={{ margin: 0 }}>↩️ Dibatalkan</span>
              </div>
              <div className="vp-card-rute">{r.tanggal || ""}{r.reversal_reason ? ` · ${r.reversal_reason}` : ""}</div>
              <button className="vp-btn vp-btn-primary" style={{ marginTop: 8 }} disabled={!!tbBusy} onClick={() => doPulihTembak(r)} data-testid={`vp-pulih-tembak-${r.id}`}>
                {tbBusy === r.id ? "Memproses…" : "↩️ Pulihkan + Tembak + PDF"}
              </button>
            </div>
          ))}
          {tbSup && (tbSup.rekon_payments || []).map((p) => (
            <div key={p.id} className="vp-card" style={{ marginBottom: 8 }}>
              <div className="vp-card-top" style={{ marginBottom: 2 }}>
                <span className="vp-card-nopol">{fmtRp(p.amount)}</span>
                <span className="vp-card-rute" style={{ margin: 0 }}>{p.alloc_status === "allocated" ? "Dialokasikan" : p.alloc_status === "partial" ? `Sebagian · sisa ${fmtRp(p.unallocated)}` : "Belum dialokasikan"}</span>
              </div>
              <div className="vp-card-rute">{p.tanggal || ""}{p.catatan ? ` · ${p.catatan}` : ""}</div>
              <button className="vp-btn vp-btn-primary" style={{ marginTop: 8 }} disabled={!!tbBusy} onClick={() => doTembak(p)} data-testid={`vp-tembak-${p.id}`}>
                {tbBusy === p.id ? "Menembak…" : "🎯 Tembak + Buka PDF"}
              </button>
            </div>
          ))}
          {tbSup && tbOtherState === "loading" && <div className="vp-hint" style={{ textAlign: "center", marginTop: 8 }}>Mencari rekon di vendor lain…</div>}
          {tbSup && tbOtherState === "done" && tbOther.length === 0 && (
            <div className="vp-hint" style={{ textAlign: "center", marginTop: 8 }}>Tidak ada rekon aktif di vendor lain juga — rekonnya belum masuk ke sistem. Tarik dulu dari Audit Rekon.</div>
          )}
          {tbSup && tbOtherState === "error" && <div className="vp-hint" style={{ textAlign: "center", marginTop: 8 }}>Gagal memeriksa rekon di vendor lain. Tutup lalu buka lagi.</div>}
          {tbOther.length > 0 && (
            <>
              <div className="vp-hint" style={{ margin: "10px 0 6px", fontWeight: 700 }}>
                Rekon yang tercatat di vendor LAIN ({tbOther.length}) — kalau uangnya untuk {vendor.supplier_nama}, pindahkan:
              </div>
              {tbOther.map((o) => {
                const match = o.amount === totalSel;
                return (
                  <div key={o.id} className="vp-card" style={{ marginBottom: 8, borderColor: match ? "var(--vp-navy)" : undefined }}>
                    <div className="vp-card-top" style={{ marginBottom: 2 }}>
                      <span className="vp-card-nopol">{fmtRp(o.amount)}{match ? " ✅" : ""}</span>
                      <span className="vp-card-rute" style={{ margin: 0 }}>{o.alloc_status === "allocated" ? "Dialokasikan" : o.alloc_status === "partial" ? "Sebagian" : "Belum dialokasikan"}</span>
                    </div>
                    <div className="vp-card-rute">📍 di <b>{o.supplier_nama}</b> · {o.tanggal || ""}{o.catatan ? ` · ${o.catatan}` : ""}</div>
                    {match && <div className="vp-hint">Nominal sama dengan total {tbIds.length} PO terpilih.</div>}
                    <button className="vp-btn vp-btn-ghost" style={{ marginTop: 8 }} disabled={!!tbBusy} onClick={() => doPindahTembak(o)} data-testid={`vp-pindah-${o.id}`}>
                      {tbBusy === o.id ? "Memproses…" : `➡️ Pindah ke ${vendor.supplier_nama} + Tembak + PDF`}
                    </button>
                  </div>
                );
              })}
            </>
          )}
          {tbTrail.length > 0 && (
            <>
              <div className="vp-hint" style={{ margin: "10px 0 6px", fontWeight: 700 }}>
                Jejak rekon yang BUKAN pembayaran aktif ({tbTrail.length}) — cari Rp{(totalSel).toLocaleString("id-ID")} di sini:
              </div>
              {tbTrail.map((t) => {
                const amt = Number(t.amount || t.nominal || (t.raw_payload || {}).nominal || 0);
                const lbl = { reversed: "↩️ Dibatalkan (Reverse)", supplier_not_found: "⚠️ Supplier tidak ketemu", error: "⚠️ Error", processing: "⏳ Belum selesai", posted_expense: "🧾 Dicatat sebagai biaya (bukan pembayaran supplier)" }[t.status] || t.status;
                const match = amt === totalSel;
                return (
                  <div key={t.bank_transaction_id} className="vp-card" style={{ marginBottom: 8, borderStyle: "dashed", borderColor: match ? "var(--vp-navy)" : undefined }}>
                    <div className="vp-card-top" style={{ marginBottom: 2 }}>
                      <span className="vp-card-nopol">{fmtRp(amt)}{match ? " ✅" : ""}</span>
                      <span className="vp-card-rute" style={{ margin: 0 }}>{lbl}</span>
                    </div>
                    <div className="vp-card-rute">{t.tanggal || (t.raw_payload || {}).tanggal || ""}{(t.supplier_name || (t.raw_payload || {}).supplier_name) ? ` · ${t.supplier_name || t.raw_payload.supplier_name}` : ""}</div>
                    {(t.deskripsi_bank || (t.raw_payload || {}).deskripsi_bank) && <div className="vp-hint">{String(t.deskripsi_bank || t.raw_payload.deskripsi_bank).slice(0, 90)}</div>}
                    {t.status === "reversed" && (
                      <button className="vp-btn vp-btn-ghost" style={{ marginTop: 8 }} disabled={!!tbBusy} onClick={() => pulihkanJejak(t)}>
                        {tbBusy === t.bank_transaction_id ? "Memproses…" : "↩️ Pulihkan rekon ini"}
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {tbMsg && <div className="vp-hint" style={{ margin: "8px 0", fontWeight: 700 }}>{tbMsg}</div>}
          {tbSup && <button className="vp-btn vp-btn-ghost" onClick={() => cetakTembak()} data-testid="vp-tembak-cetak">🖨️ Cetak A4 ({tbIds.length} PO)</button>}
          <div className="vp-hint" style={{ marginTop: 8 }}>Nominal dicocokkan ke faktur/PO yang pas (kalau tidak ada → berurutan), hanya ke PO yang dicentang.</div>
        </BottomSheet>
      </div>
    );
  }

  /* ── PAY: form bayar batch ── */
  if (mode === "pay") {
    return (
      <div className="vp-screen">
        <div className="vp-topbar">
          <button className="vp-back" onClick={() => setMode("detail")}>‹ Kembali</button>
          <div className="vp-topbar-title">Bayar Vendor</div><div style={{ width: 64 }} />
        </div>
        <div className="vp-body vp-body-form">
          <div className="vp-vendor-head">
            <div className="vp-vendor-name">🏢 {vendor.supplier_nama}</div>
            <div className="vp-vendor-sisa">{selJobs.length} PO · total sisa {fmtRp(totalSel)}</div>
          </div>

          <div className="vp-field">
            <label className="vp-label">Nominal Pembayaran</label>
            <div className="vp-rp">
              <span className="vp-rp-tag">Rp</span>
              <input className="vp-input vp-rp-input" inputMode="numeric" type="text" placeholder="0"
                value={fmtRpInput(nominal)} onChange={(e) => setNominal(onlyDigits(e.target.value))} />
            </div>
            <div className="vp-hint">Otomatis dibagi ke PO terpilih (yang paling atas didahulukan). Boleh kurang dari total (bayar sebagian).</div>
          </div>

          <div className="vp-field">
            <label className="vp-label">Tanggal Pembayaran</label>
            <input className="vp-input" type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </div>

          <div className="vp-field">
            <label className="vp-label">Metode Pembayaran</label>
            <div className="vp-chips">
              {["Transfer", "Tunai", "Lainnya"].map((m) => (
                <button key={m} className={`vp-chip ${metode === m ? "vp-chip-on" : ""}`} onClick={() => setMetode(m)}>{m}</button>
              ))}
            </div>
          </div>

          <div className="vp-field">
            <label className="vp-label">Bukti Transfer (opsional)</label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onPickFile} />
            {bukti ? (
              <div className="vp-bukti">
                {buktiPreview ? <img src={buktiPreview} alt="bukti" className="vp-bukti-img" /> : <div className="vp-bukti-file">📄 {bukti.name}</div>}
                <button className="vp-bukti-rm" onClick={() => { setBukti(null); setBuktiPreview(""); if (fileRef.current) fileRef.current.value = ""; }}>Hapus</button>
              </div>
            ) : (
              <button className="vp-upload" onClick={() => fileRef.current && fileRef.current.click()}>📷 Ambil / Pilih Foto</button>
            )}
          </div>

          <div className="vp-field">
            <label className="vp-label">Catatan (opsional)</label>
            <textarea className="vp-input vp-textarea" rows={2} placeholder="contoh: pelunasan 3 PO Surabaya"
              value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
          <div style={{ height: 12 }} />
        </div>
        <div className="vp-sticky">
          <button className="vp-btn vp-btn-primary" disabled={nominalNum <= 0} onClick={() => setConfirm(true)}>💾 Simpan Pembayaran</button>
        </div>

        <BottomSheet open={confirm} title="Konfirmasi Pembayaran" onClose={() => setConfirm(false)}>
          <div className="vp-confirm">
            <Row k="Vendor" v={vendor.supplier_nama} />
            <Row k="Jumlah PO" v={`${selJobs.length} PO`} />
            <Row k="Nominal" v={fmtRp(nominalNum)} big />
            <Row k="Tanggal" v={fmtTgl(tanggal)} />
            <Row k="Metode" v={metode} />
          </div>
          <button className="vp-btn vp-btn-primary" onClick={doSave}>✅ Ya, Simpan</button>
          <button className="vp-btn vp-btn-ghost" onClick={() => setConfirm(false)}>Batal</button>
        </BottomSheet>
      </div>
    );
  }

  /* ── SUCCESS ── */
  const r = result || {};
  const applied = r.applied || [];
  const receipt = {
    title: "BUKTI PEMBAYARAN VENDOR",
    amount: r.total_dibayar,
    amountLabel: "Total Dibayar",
    rows: [
      { k: "Vendor", v: r._vendor || "-" },
      { k: "Jumlah PO", v: `${applied.length} PO` },
      { k: "Tanggal", v: fmtTgl(r._tanggal) },
      { k: "Metode", v: r._metode || "-" },
      ...(r.sisa_nominal > 0 ? [{ k: "Kelebihan Nominal", v: fmtRp(r.sisa_nominal) + " (tidak terpakai)" }] : []),
    ],
    listTitle: "Rincian PO",
    listItems: applied.map((a) => ({
      k: a.nopol || "PO",
      v: `${fmtRp(a.dibayar)} · ${a.status === "lunas" ? "LUNAS" : "sebagian"}`,
    })),
    footnote: "Dibuat otomatis · " + fmtDateTime(),
    filename: "bukti-" + String(r._vendor || "vendor").replace(/[^a-zA-Z0-9]+/g, "-"),
    shareText:
      "*BUKTI PEMBAYARAN VENDOR*\nPT Alyssa Auto Logistik\n\n" +
      "Vendor: " + (r._vendor || "-") + "\n" +
      "Total Dibayar: " + fmtRp(r.total_dibayar) + "\n" +
      "Jumlah PO: " + applied.length + " PO\n" +
      "Tanggal: " + fmtTgl(r._tanggal) + "\n" +
      "Metode: " + (r._metode || "-") +
      (applied.length
        ? "\n\nRincian:\n" + applied.map((a) => "• " + (a.nopol || "PO") + ": " + fmtRp(a.dibayar) + (a.status === "lunas" ? " (LUNAS)" : " (sebagian)")).join("\n")
        : ""),
  };
  return (
    <div className="vp-screen vp-center">
      <div className="vp-success">
        <div className="vp-success-check">✓</div>
        <div className="vp-success-title">Pembayaran Tersimpan</div>
        <div className="vp-success-amt">{fmtRp(r.total_dibayar)}</div>
        {r.bukti_warning && <div className="vp-warn">⚠️ {r.bukti_warning}</div>}
        <div className="vp-success-box">
          <Row k="Vendor" v={r._vendor || "-"} />
          <Row k="Tanggal" v={fmtTgl(r._tanggal)} />
          <Row k="Metode" v={r._metode || "-"} />
          {applied.map((a) => (
            <Row key={a.job_id} k={a.nopol || "PO"} v={`${fmtRp(a.dibayar)} · ${a.status === "lunas" ? "LUNAS ✅" : "sebagian"}`} />
          ))}
          {r.sisa_nominal > 0 && <Row k="Kelebihan nominal" v={fmtRp(r.sisa_nominal) + " (tidak terpakai)"} />}
        </div>
        <ReceiptActions receipt={receipt} flash={flash} />
        <div style={{ height: 10 }} />
        <button className="vp-btn vp-btn-primary" onClick={() => { setResult(null); setSel({}); setMode("list"); }}>➕ Bayar Vendor Lain</button>
        <button className="vp-btn vp-btn-ghost" onClick={onBack}>Kembali ke Menu</button>
      </div>
    </div>
  );
}

/* ══════════════ SUCCESS ══════════════ */
function SuccessScreen({ data, flash, onAgain, onHome }) {
  const d = data || {};
  const sisaTxt = typeof d.sisa === "number" ? (d.sisa > 0 ? fmtRp(d.sisa) : "LUNAS") : null;
  const receipt = {
    title: "BUKTI PEMBAYARAN VENDOR",
    amount: d._nominal,
    amountLabel: "Nominal Pembayaran",
    rows: [
      { k: "Vendor", v: d._vendor || "-" },
      { k: "Nopol", v: d._nopol || "-" },
      { k: "Jenis Biaya", v: d._kategori || "-" },
      { k: "Tanggal", v: fmtTgl(d._tanggal) },
      { k: "Metode", v: d._metode || "-" },
      ...(d._catatan ? [{ k: "Catatan", v: d._catatan }] : []),
      ...(sisaTxt ? [{ k: "Sisa Tagihan", v: sisaTxt }] : []),
    ],
    footnote: "Dibuat otomatis · " + fmtDateTime(),
    filename: "bukti-" + String(d._nopol || d._vendor || "vendor").replace(/[^a-zA-Z0-9]+/g, "-"),
    shareText:
      "*BUKTI PEMBAYARAN VENDOR*\nPT Alyssa Auto Logistik\n\n" +
      "Vendor: " + (d._vendor || "-") + "\n" +
      "Nopol: " + (d._nopol || "-") + "\n" +
      "Jenis Biaya: " + (d._kategori || "-") + "\n" +
      "Nominal: " + fmtRp(d._nominal) + "\n" +
      "Tanggal: " + fmtTgl(d._tanggal) + "\n" +
      "Metode: " + (d._metode || "-") +
      (sisaTxt ? "\nSisa Tagihan: " + sisaTxt : ""),
  };
  return (
    <div className="vp-screen vp-center">
      <div className="vp-success">
        <div className="vp-success-check">✓</div>
        <div className="vp-success-title">Pembayaran Tersimpan</div>
        <div className="vp-success-amt">{fmtRp(d._nominal)}</div>
        {d.bukti_warning && <div className="vp-warn">⚠️ {d.bukti_warning}</div>}
        <div className="vp-success-box">
          <Row k="Vendor" v={d._vendor || "-"} />
          <Row k="Nopol" v={d._nopol || "-"} />
          <Row k="Jenis Biaya" v={d._kategori || "-"} />
          <Row k="Tanggal" v={fmtTgl(d._tanggal)} />
          <Row k="Metode" v={d._metode || "-"} />
          {typeof d.sisa === "number" && <Row k="Sisa Tagihan" v={d.sisa > 0 ? fmtRp(d.sisa) : "LUNAS ✅"} />}
        </div>
        <ReceiptActions receipt={receipt} flash={flash} />
        <div style={{ height: 10 }} />
        <button className="vp-btn vp-btn-primary" onClick={onAgain}>➕ Catat Pembayaran Lagi</button>
        <button className="vp-btn vp-btn-ghost" onClick={onHome}>Kembali ke Menu</button>
      </div>
    </div>
  );
}

/* ══════════════ STYLE (mobile-first, iPhone safe-area) ══════════════ */
function VpStyle() {
  return (
    <style>{`
    :root { --vp-navy:#0f2a5c; --vp-navy2:#0a1e42; --vp-gold:#c9973a; --vp-ink:#1f2430; --vp-mute:#6b7280; --vp-line:#e6e8ee; --vp-bg:#f4f6fa; }
    * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    .vp-root { min-height:100vh; min-height:100dvh; background:var(--vp-bg); color:var(--vp-ink);
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; font-size:16px; }
    .vp-center { display:flex; align-items:center; justify-content:center; padding:24px; }
    .vp-screen { display:flex; flex-direction:column; min-height:100vh; min-height:100dvh; }

    /* Topbar (aman notch) */
    .vp-topbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between;
      background:var(--vp-navy); color:#fff; padding:calc(env(safe-area-inset-top) + 12px) 14px 12px; }
    .vp-topbar-home { border-radius:0 0 18px 18px; }
    .vp-topbar-title { font-size:17px; font-weight:800; }
    .vp-hi { font-size:13px; opacity:.85; } .vp-brand { font-size:16px; font-weight:800; }
    .vp-back { background:rgba(255,255,255,.14); color:#fff; border:none; border-radius:10px; font-size:15px; font-weight:700; padding:10px 12px; min-height:44px; }
    .vp-logout { background:rgba(255,255,255,.14); color:#fff; border:none; border-radius:10px; font-size:14px; font-weight:700; padding:10px 14px; min-height:44px; }

    .vp-body { flex:1; padding:16px 16px calc(env(safe-area-inset-bottom) + 24px); overflow-y:auto; -webkit-overflow-scrolling:touch; }
    .vp-body-form { padding-bottom:110px; }

    /* Home menu */
    .vp-menu-list { display:flex; flex-direction:column; gap:14px; margin-top:6px; }
    .vp-menu { display:flex; align-items:center; gap:14px; width:100%; text-align:left; border:none; border-radius:18px;
      padding:20px 16px; background:#fff; box-shadow:0 4px 16px rgba(15,42,92,.08); min-height:88px; }
    .vp-menu-ico { font-size:34px; width:56px; height:56px; display:flex; align-items:center; justify-content:center; border-radius:14px; flex-shrink:0; }
    .vp-m-blue .vp-menu-ico { background:#e8f0ff; } .vp-m-gold .vp-menu-ico { background:#fdf3e0; } .vp-m-green .vp-menu-ico { background:#e6f7ec; }
    .vp-menu-txt { flex:1; display:flex; flex-direction:column; gap:3px; }
    .vp-menu-title { font-size:18px; font-weight:800; color:var(--vp-ink); }
    .vp-menu-sub { font-size:13.5px; color:var(--vp-mute); }
    .vp-menu-arrow { font-size:30px; color:var(--vp-mute); }

    /* Fields */
    .vp-field { margin-bottom:18px; }
    .vp-label { display:block; font-size:14px; font-weight:700; color:var(--vp-ink); margin-bottom:8px; }
    .vp-input { width:100%; font-size:16px; padding:14px 14px; border:1.5px solid var(--vp-line); border-radius:12px;
      background:#fff; color:var(--vp-ink); outline:none; min-height:52px; font-family:inherit; }
    .vp-input:focus { border-color:var(--vp-navy); }
    .vp-input-center { text-align:center; letter-spacing:4px; font-size:22px; }
    .vp-textarea { min-height:64px; resize:none; }
    .vp-hint { font-size:13px; color:var(--vp-mute); margin-top:6px; }
    .vp-err { color:#b42318; font-size:14px; margin:8px 0; text-align:center; }

    .vp-rp { display:flex; align-items:center; border:1.5px solid var(--vp-line); border-radius:12px; background:#fff; overflow:hidden; }
    .vp-rp:focus-within { border-color:var(--vp-navy); }
    .vp-rp-tag { padding:0 12px; font-weight:800; color:var(--vp-mute); font-size:16px; }
    .vp-rp-input { border:none; border-radius:0; font-size:22px; font-weight:800; padding-left:0; }

    .vp-select { width:100%; display:flex; align-items:center; justify-content:space-between; font-size:16px; padding:14px;
      border:1.5px solid var(--vp-line); border-radius:12px; background:#fff; color:var(--vp-ink); min-height:52px; font-weight:600; }
    .vp-select:disabled { opacity:.7; } .vp-placeholder { color:var(--vp-mute); font-weight:400; }
    .vp-select-caret { color:var(--vp-mute); }

    .vp-chips { display:flex; gap:10px; flex-wrap:wrap; }
    .vp-chip { flex:1; min-width:90px; font-size:16px; font-weight:700; padding:13px 10px; border-radius:12px;
      border:1.5px solid var(--vp-line); background:#fff; color:var(--vp-ink); min-height:50px; }
    .vp-chip-on { background:var(--vp-navy); color:#fff; border-color:var(--vp-navy); }

    .vp-upload { width:100%; font-size:16px; font-weight:700; padding:16px; border:1.5px dashed var(--vp-navy); border-radius:12px;
      background:#eef3fb; color:var(--vp-navy); min-height:56px; }
    .vp-bukti { display:flex; align-items:center; gap:12px; }
    .vp-bukti-img { height:70px; width:70px; object-fit:cover; border-radius:10px; border:1px solid var(--vp-line); }
    .vp-bukti-file { flex:1; font-size:14px; color:var(--vp-ink); }
    .vp-bukti-rm { background:#fdecec; color:#b42318; border:none; border-radius:10px; font-weight:700; padding:10px 14px; min-height:44px; }

    /* Trip results */
    .vp-results { margin-top:8px; border:1px solid var(--vp-line); border-radius:12px; overflow:hidden; background:#fff; }
    .vp-result { display:block; width:100%; text-align:left; padding:13px 14px; border:none; border-bottom:1px solid var(--vp-line); background:#fff; }
    .vp-result:last-child { border-bottom:none; }
    .vp-result-main { font-size:16px; font-weight:800; color:var(--vp-ink); }
    .vp-result-veh { font-size:12.5px; font-weight:600; color:var(--vp-mute); }
    .vp-result-sub { font-size:13px; color:var(--vp-mute); margin-top:2px; }
    .vp-picked { display:flex; align-items:center; justify-content:space-between; padding:14px; border:1.5px solid var(--vp-navy); border-radius:12px; background:#eef3fb; }
    .vp-rute-edit { display:flex; align-items:flex-end; gap:8px; margin-top:10px; }
    .vp-rute-col { flex:1; min-width:0; } .vp-rute-arrow { padding-bottom:16px; font-size:20px; color:var(--vp-mute); }
    .vp-label-sm { font-size:12px; margin-bottom:4px; }
    .vp-picked-main { font-size:17px; font-weight:800; } .vp-picked-sub { font-size:13px; color:var(--vp-mute); margin-top:2px; }
    .vp-change { background:#fff; border:1px solid var(--vp-line); border-radius:10px; padding:9px 12px; font-weight:700; min-height:44px; }

    /* Sticky bottom */
    .vp-sticky { position:sticky; bottom:0; background:linear-gradient(180deg, rgba(244,246,250,0) 0%, var(--vp-bg) 26%);
      padding:12px 16px calc(env(safe-area-inset-bottom) + 14px); }
    .vp-btn { width:100%; font-size:17px; font-weight:800; border:none; border-radius:14px; padding:16px; min-height:56px; font-family:inherit; }
    .vp-btn-primary { background:var(--vp-navy); color:#fff; box-shadow:0 6px 18px rgba(15,42,92,.28); }
    .vp-btn-primary:disabled { background:#aab4c6; box-shadow:none; }
    .vp-btn-ghost { background:#fff; color:var(--vp-ink); border:1.5px solid var(--vp-line); margin-top:10px; }
    .vp-btn-card { margin-top:12px; min-height:50px; font-size:16px; }

    /* Cards belum dibayar */
    .vp-card { background:#fff; border-radius:16px; padding:16px; margin-bottom:14px; box-shadow:0 3px 12px rgba(15,42,92,.07); }
    .vp-card-top { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
    .vp-card-nopol { font-size:17px; font-weight:800; }
    .vp-card-kat { font-size:12px; font-weight:800; color:var(--vp-gold); background:#fdf3e0; padding:4px 10px; border-radius:20px; }
    .vp-card-rute { font-size:14px; color:var(--vp-mute); }
    .vp-card-vendor { font-size:15px; font-weight:700; margin-top:6px; }
    .vp-card-money { margin-top:10px; }
    .vp-card-lbl { font-size:12px; color:var(--vp-mute); text-transform:uppercase; letter-spacing:.4px; margin-right:8px; }
    .vp-card-sisa { font-size:20px; font-weight:900; color:var(--vp-navy); }
    .vp-card-part { font-size:12.5px; color:var(--vp-mute); margin-top:3px; }

    /* Riwayat */
    .vp-searchbar { position:sticky; top:64px; z-index:15; background:var(--vp-bg); padding:12px 16px 4px; }
    .vp-hcard { display:flex; align-items:center; justify-content:space-between; width:100%; text-align:left;
      background:#fff; border:none; border-radius:14px; padding:14px; margin-bottom:12px; box-shadow:0 2px 10px rgba(15,42,92,.06); }
    .vp-hcard-vendor { font-size:16px; font-weight:800; } .vp-hcard-sub { font-size:12.5px; color:var(--vp-mute); margin-top:3px; }
    .vp-hcard-amt { font-size:16px; font-weight:900; color:var(--vp-navy); text-align:right; }
    .vp-hcard-met { font-size:12px; color:var(--vp-mute); text-align:right; margin-top:3px; }

    .vp-empty { text-align:center; color:var(--vp-mute); font-size:15px; padding:48px 20px; }

    /* Bottom sheet */
    .vp-sheet-bg { position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:150; display:flex; align-items:flex-end; }
    .vp-sheet { width:100%; background:#fff; border-radius:20px 20px 0 0; padding:8px 16px calc(env(safe-area-inset-bottom) + 18px);
      max-height:86vh; overflow-y:auto; animation:vpup .22s ease; }
    @keyframes vpup { from { transform:translateY(100%);} to { transform:translateY(0);} }
    .vp-sheet-grip { width:44px; height:5px; background:#d5d9e2; border-radius:3px; margin:6px auto 10px; }
    .vp-sheet-head { display:flex; align-items:center; justify-content:space-between; font-size:17px; font-weight:800; margin-bottom:12px; }
    .vp-sheet-x { background:#f0f2f6; border:none; border-radius:50%; width:36px; height:36px; font-size:15px; }
    .vp-sheet-list { display:flex; flex-direction:column; gap:2px; margin-top:8px; }
    .vp-sheet-item { text-align:left; width:100%; font-size:16.5px; font-weight:600; padding:16px 12px; border:none; background:#fff; border-bottom:1px solid var(--vp-line); min-height:54px; }
    .vp-sheet-new { display:flex; gap:8px; margin-top:14px; align-items:stretch; }
    .vp-sheet-new .vp-input { flex:1; } .vp-sheet-new .vp-btn { width:auto; padding:0 18px; }

    /* Confirm rows */
    .vp-confirm { margin-bottom:14px; }
    .vp-crow { display:flex; justify-content:space-between; gap:12px; padding:11px 0; border-bottom:1px solid var(--vp-line); }
    .vp-crow-k { font-size:14px; color:var(--vp-mute); } .vp-crow-v { font-size:15px; font-weight:700; text-align:right; }
    .vp-crow-big { font-size:20px; font-weight:900; color:var(--vp-navy); }

    /* Gate */
    .vp-gate { width:100%; max-width:340px; text-align:center; }
    .vp-gate-logo { font-size:56px; } .vp-gate-title { font-size:24px; font-weight:900; color:var(--vp-navy); margin-top:8px; }
    .vp-gate-sub { font-size:15px; color:var(--vp-mute); margin:6px 0 20px; }

    /* Success */
    .vp-success { width:100%; max-width:360px; text-align:center; }
    .vp-success-check { width:78px; height:78px; margin:0 auto 14px; border-radius:50%; background:#e6f7ec; color:#1a7f42;
      font-size:44px; font-weight:900; display:flex; align-items:center; justify-content:center; }
    .vp-success-title { font-size:21px; font-weight:900; } .vp-success-amt { font-size:30px; font-weight:900; color:var(--vp-navy); margin:6px 0 16px; }
    .vp-success-box { background:#fff; border-radius:16px; padding:6px 16px; margin-bottom:20px; box-shadow:0 3px 12px rgba(15,42,92,.07); text-align:left; }
    .vp-warn { background:#fdf3e0; color:#8a6d00; border:1px solid #e6b450; border-radius:12px; padding:10px 14px; font-size:13px; font-weight:600; line-height:1.4; margin:0 0 16px; text-align:left; }
    [data-theme="dark"] .vp-warn { background:#2a2410; color:#e6b450; border-color:#7a5c12; }

    /* Loading + toast */
    .vp-loading { position:fixed; inset:0; background:rgba(255,255,255,.6); z-index:200; display:flex; align-items:center; justify-content:center; }
    .vp-spinner { width:44px; height:44px; border:4px solid #d5d9e2; border-top-color:var(--vp-navy); border-radius:50%; animation:vpspin .8s linear infinite; }
    @keyframes vpspin { to { transform:rotate(360deg);} }
    .vp-toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 20px); transform:translateX(-50%); z-index:210;
      background:var(--vp-ink); color:#fff; font-size:14px; font-weight:600; padding:12px 18px; border-radius:12px; max-width:88%; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,.3); }

    /* Bayar per Vendor */
    .vp-vendor-card { display:block; width:100%; text-align:left; border:none; }
    .vp-vendor-head { background:#eef3fb; border:1.5px solid var(--vp-navy); border-radius:14px; padding:14px 16px; margin-bottom:14px; }
    .vp-vendor-name { font-size:18px; font-weight:900; color:var(--vp-navy); }
    .vp-vendor-sisa { font-size:13.5px; color:var(--vp-mute); margin-top:3px; }
    .vp-selectall { width:100%; text-align:left; background:#fff; border:1.5px solid var(--vp-line); border-radius:12px;
      padding:14px 16px; font-size:15px; font-weight:700; color:var(--vp-navy); margin-bottom:12px; min-height:50px; }
    .vp-po-card { padding:14px; }
    .vp-po-on { border:2px solid var(--vp-navy); background:#f5f9ff; }
    .vp-po-off { opacity:.55; }
    .vp-po-row { display:flex; align-items:flex-start; gap:12px; }
    .vp-check { flex-shrink:0; width:26px; height:26px; border-radius:8px; border:2px solid var(--vp-line); background:#fff;
      display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:900; color:#fff; margin-top:2px; }
    .vp-check-on { background:var(--vp-navy); border-color:var(--vp-navy); }
    .vp-check-dis { background:#eef0f4; border-color:#e0e3ea; }
    .vp-po-money { margin-top:6px; }
    .vp-po-sisa { font-size:17px; font-weight:900; color:var(--vp-navy); }
    .vp-po-sub { font-size:12.5px; color:var(--vp-mute); }
    .vp-stchip { font-size:11px; font-weight:800; padding:4px 10px; border-radius:20px; white-space:nowrap; }
    .vp-st-belum { color:#b42318; background:#fdecec; }
    .vp-st-sebagian { color:#8a6d00; background:#fdf3e0; }
    .vp-st-lunas { color:#1a7f42; background:#e6f7ec; }
    .vp-selbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; padding:0 2px; }
    .vp-selbar-lbl { font-size:13px; color:var(--vp-mute); }
    .vp-selbar-amt { font-size:22px; font-weight:900; color:var(--vp-navy); }

    /* ── Mode gelap (🌙) — dipicu data-theme="dark" di <html> ── */
    :root[data-theme="dark"] { --vp-bg:#0a0e14; --vp-ink:#e6edf3; --vp-mute:#8b949e; --vp-line:#21262d; --vp-navy:#1b3a6b; }
    [data-theme="dark"] .vp-menu,
    [data-theme="dark"] .vp-card,
    [data-theme="dark"] .vp-hcard,
    [data-theme="dark"] .vp-vendor-card,
    [data-theme="dark"] .vp-po-card,
    [data-theme="dark"] .vp-success-box,
    [data-theme="dark"] .vp-vendor-head,
    [data-theme="dark"] .vp-sheet { background:#161b22; }
    [data-theme="dark"] .vp-vendor-head { border-color:#1f6feb; }
    [data-theme="dark"] .vp-input,
    [data-theme="dark"] .vp-rp,
    [data-theme="dark"] .vp-select,
    [data-theme="dark"] .vp-chip,
    [data-theme="dark"] .vp-change,
    [data-theme="dark"] .vp-selectall,
    [data-theme="dark"] .vp-results,
    [data-theme="dark"] .vp-result,
    [data-theme="dark"] .vp-check,
    [data-theme="dark"] .vp-sheet-item { background:#0d1117; color:var(--vp-ink); border-color:var(--vp-line); }
    [data-theme="dark"] .vp-btn-ghost { background:#161b22; color:var(--vp-ink); border-color:var(--vp-line); }
    [data-theme="dark"] .vp-sheet-x { background:#21262d; color:var(--vp-ink); }
    [data-theme="dark"] .vp-upload { background:#12233a; }
    [data-theme="dark"] .vp-po-on,
    [data-theme="dark"] .vp-picked { background:#12233a; }
    [data-theme="dark"] .vp-sheet-grip { background:#30363d; }
    `}</style>
  );
}
