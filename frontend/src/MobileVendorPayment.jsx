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
const buktiHref = (url) => (!url ? "" : /^https?:\/\//.test(url) ? url : (process.env.REACT_APP_BACKEND_URL || "") + url);

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
export default function MobileVendorPayment() {
  const [pin, setPin] = useState(() => localStorage.getItem(PIN_KEY) || "");
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

  const headers = { "X-Admin-Pin": pin };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2600); };

  const doBootstrap = useCallback(async (usePin) => {
    setBooting(true); setPinErr("");
    try {
      const r = await axios.get(`${API}/vendor-mobile/bootstrap`, { headers: { "X-Admin-Pin": usePin } });
      setBoot({ kategori: r.data.kategori || [], metode: r.data.metode || [], vendors: r.data.vendors || [] });
      localStorage.setItem(PIN_KEY, usePin); setPin(usePin); setAuthed(true);
    } catch (e) {
      const code = e?.response?.status;
      setPinErr(code === 401 ? "PIN salah. Coba lagi." : "Gagal terhubung. Cek internet / server.");
      setAuthed(false);
    } finally { setBooting(false); }
  }, []);

  useEffect(() => { if (pin) doBootstrap(pin); }, []); // eslint-disable-line

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

      {screen === "home" && <HomeScreen go={setScreen} onLogout={logout} />}
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
        <SuccessScreen data={lastSuccess} onAgain={() => setScreen("form")} onHome={() => setScreen("home")} />
      )}
    </div>
  );
}

/* ══════════════ HOME (3 menu besar) ══════════════ */
function HomeScreen({ go, onLogout }) {
  const menus = [
    { key: "form", icon: "📝", title: "Catat Pembayaran", sub: "Input pembayaran ke vendor", cls: "vp-m-blue" },
    { key: "unpaid", icon: "⏳", title: "Belum Dibayar", sub: "Daftar tagihan vendor belum lunas", cls: "vp-m-gold" },
    { key: "history", icon: "🧾", title: "Riwayat Pembayaran", sub: "Lihat pembayaran yang sudah dicatat", cls: "vp-m-green" },
  ];
  return (
    <div className="vp-screen">
      <div className="vp-topbar vp-topbar-home">
        <div><div className="vp-hi">Halo 👋</div><div className="vp-brand">PT Alyssa Auto Logistik</div></div>
        <button className="vp-logout" onClick={onLogout}>Keluar</button>
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

  // Cari trip (debounce)
  useEffect(() => {
    if (isPrefill) return;
    const q = tripQ.trim();
    if (q.length < 1) { setTripResults([]); return; }
    let alive = true; setTripSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/vendor-mobile/trips`, { headers, params: { q } });
        if (alive) setTripResults(r.data.items || []);
      } catch { if (alive) setTripResults([]); }
      finally { if (alive) setTripSearching(false); }
    }, 350);
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
            <div className="vp-picked">
              <div>
                <div className="vp-picked-main">{trip?.nopol || "—"}</div>
                <div className="vp-picked-sub">{trip?.rute || ""}{trip?.trip_id ? ` · ${trip.trip_id}` : ""}</div>
              </div>
              {!isPrefill && <button className="vp-change" onClick={() => { setTrip(null); setTripQ(""); }}>Ganti</button>}
            </div>
          ) : (
            <>
              <input className="vp-input" inputMode="search" placeholder="Ketik nopol / trip / customer…"
                value={tripQ} onChange={(e) => setTripQ(e.target.value)} />
              {tripSearching && <div className="vp-hint">Mencari…</div>}
              {tripResults.length > 0 && (
                <div className="vp-results">
                  {tripResults.map((t) => (
                    <button key={t.trip_id} className="vp-result" onClick={() => { setTrip(t); setTripResults([]); setTripQ(""); }}>
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

/* ══════════════ SUCCESS ══════════════ */
function SuccessScreen({ data, onAgain, onHome }) {
  const d = data || {};
  return (
    <div className="vp-screen vp-center">
      <div className="vp-success">
        <div className="vp-success-check">✓</div>
        <div className="vp-success-title">Pembayaran Tersimpan</div>
        <div className="vp-success-amt">{fmtRp(d._nominal)}</div>
        <div className="vp-success-box">
          <Row k="Vendor" v={d._vendor || "-"} />
          <Row k="Nopol" v={d._nopol || "-"} />
          <Row k="Jenis Biaya" v={d._kategori || "-"} />
          <Row k="Tanggal" v={fmtTgl(d._tanggal)} />
          <Row k="Metode" v={d._metode || "-"} />
          {typeof d.sisa === "number" && <Row k="Sisa Tagihan" v={d.sisa > 0 ? fmtRp(d.sisa) : "LUNAS ✅"} />}
        </div>
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
    .vp-sheet-bg { position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:100; display:flex; align-items:flex-end; }
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

    /* Loading + toast */
    .vp-loading { position:fixed; inset:0; background:rgba(255,255,255,.6); z-index:200; display:flex; align-items:center; justify-content:center; }
    .vp-spinner { width:44px; height:44px; border:4px solid #d5d9e2; border-top-color:var(--vp-navy); border-radius:50%; animation:vpspin .8s linear infinite; }
    @keyframes vpspin { to { transform:rotate(360deg);} }
    .vp-toast { position:fixed; left:50%; bottom:calc(env(safe-area-inset-bottom) + 20px); transform:translateX(-50%); z-index:210;
      background:var(--vp-ink); color:#fff; font-size:14px; font-weight:600; padding:12px 18px; border-radius:12px; max-width:88%; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,.3); }
    `}</style>
  );
}
