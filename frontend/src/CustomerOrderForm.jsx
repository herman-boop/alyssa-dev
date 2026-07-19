import { useMemo, useState, useCallback } from "react";
import axios from "axios";
import "./Order.css";
import { VEHICLE_TYPE_LIST, VehicleSketch, useVehicleTypes } from "./VehicleSketches";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STEPS = [
  { key: "kendaraan", label: "Kendaraan" },
  { key: "asal",      label: "Penjemputan" },
  { key: "tujuan",    label: "Tujuan" },
  { key: "konfirmasi",label: "Konfirmasi" },
];

const KONDISI_OPTIONS = ["Bekas", "Baru"];

// F1 — Unit Master (multi-unit per PO)
const MAX_UNITS = 10;
const emptyUnit = () => ({ vehicle_type: "", tipe_model: "", nopol: "", no_rangka: "", warna: "", tahun: "", catatan: "" });

/* ── Dark mode ── */
function useDarkMode() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-theme") === "dark"
  );
  const toggle = useCallback(() => {
    const next = !dark;
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try { localStorage.setItem("aal-theme", next ? "dark" : "light"); } catch (_) {}
    setDark(next);
  }, [dark]);
  return [dark, toggle];
}

/* ── Icons ── */
const IcoSun = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const IcoMoon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const IcoCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IcoArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
  </svg>
);
const IcoBack = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
  </svg>
);
const IcoTruck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/>
    <circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>
  </svg>
);
const IcoPin = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);
const IcoFlag = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>
  </svg>
);
const IcoDoc = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);
const IcoSend = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);
const IcoCircleCheck = () => (
  <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/>
  </svg>
);

const STEP_ICONS = [<IcoTruck />, <IcoPin />, <IcoFlag />, <IcoDoc />];

/* ── Logo ── */
const Logo = ({ size = 56 }) => (
  <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={size} height={size} style={{ objectFit: "contain" }} />
);

/* ── Field wrapper ── */
function Field({ label, children, required, hint, full }) {
  return (
    <div className={`of-field${full ? " of-field--full" : ""}`}>
      <label className="of-label">
        {label}{required && <span className="of-req"> *</span>}
      </label>
      {children}
      {hint && <div className="of-hint">{hint}</div>}
    </div>
  );
}

/* ── Main component ── */
export default function CustomerOrderForm() {
  const { types: vehicleTypes } = useVehicleTypes();
  const [dark, toggleDark] = useDarkMode();
  const [step, setStep] = useState(0);
  const [shipmentType, setShipmentType] = useState("kendaraan"); // "kendaraan" | "cargo"
  const [data, setData] = useState({
    vehicle_type: "", nopol: "", warna: "", tahun: "", km: "", kondisi: "Bekas", no_rangka: "",
    panjang: "", lebar: "", tinggi: "", isi_kiriman: "", jumlah_colly: "",
    asal_kota: "", asal_alamat: "", pickup_date: "", pickup_time: "", pickup_pic: "", pickup_hp: "",
    tujuan_kota: "", tujuan_alamat: "", delivery_pic: "", delivery_hp: "",
    customer_nama: "", customer_hp: "", customer_email: "", catatan: "",
    units: [emptyUnit()],   // F1 — multi-unit
  });
  const [openUnit, setOpenUnit] = useState(0); // index card yang lagi kebuka
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]);  // berkas scan (PDF/gambar)

  // Semua input teks otomatis KAPITAL biar rapi — kecuali email (case-sensitive)
  // & vehicle_type (nilai dropdown yang harus persis cocok).
  const upc = (k, v) => (typeof v === "string" && k !== "customer_email" && k !== "vehicle_type") ? v.toUpperCase() : v;
  const set = (k, v) => setData((d) => ({ ...d, [k]: upc(k, v) }));
  const setUnit = (i, k, v) => setData((d) => ({ ...d, units: d.units.map((u, x) => x === i ? { ...u, [k]: upc(k, v) } : u) }));
  const addUnit = () => setData((d) => {
    if (d.units.length >= MAX_UNITS) return d;
    setOpenUnit(d.units.length);
    return { ...d, units: [...d.units, emptyUnit()] };
  });
  const removeUnit = (i) => setData((d) => {
    if (d.units.length <= 1) return d;
    const units = d.units.filter((_, x) => x !== i);
    setOpenUnit((o) => Math.max(0, Math.min(o, units.length - 1)));
    return { ...d, units };
  });

  const stepValid = useMemo(() => {
    if (step === 0) {
      return shipmentType === "kendaraan"
        ? (data.units.length > 0 && data.units.every((u) => !!u.vehicle_type))
        : !!data.isi_kiriman.trim();
    }
    if (step === 1) return !!data.asal_kota.trim();
    if (step === 2) return !!data.tujuan_kota.trim();
    if (step === 3) return !!data.customer_nama.trim() && !!data.customer_hp.trim();
    return true;
  }, [step, data, shipmentType]);

  const goNext = () => { if (stepValid && step < STEPS.length - 1) setStep(step + 1); };
  const goPrev = () => { if (step > 0) setStep(step - 1); };

  const submit = async () => {
    setError(""); setSubmitting(true);
    try {
      const payload = { ...data, units: shipmentType === "kendaraan" ? data.units : [] };
      const r = await axios.post(`${API}/orders`, payload);
      const orderId = r.data?.order_id;
      // Upload berkas scan (kalau ada) — best-effort, order tetap jadi walau upload gagal
      if (orderId && files.length) {
        for (const f of files) {
          try {
            const fd = new FormData();
            fd.append("file", f);
            await axios.post(`${API}/orders/${orderId}/attachment`, fd);
          } catch (_) { /* skip file gagal */ }
        }
      }
      setResult(r.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Gagal mengirim pesanan. Coba lagi.");
    } finally { setSubmitting(false); }
  };

  const addAnother = () => {
    // Reset hanya data kendaraan, sisanya (asal/tujuan/customer) tetap
    setData(d => ({ ...d, vehicle_type: "", nopol: "", warna: "", tahun: "", km: "", kondisi: "Bekas", no_rangka: "", panjang: "", lebar: "", tinggi: "", isi_kiriman: "", jumlah_colly: "", units: [emptyUnit()] }));
    setOpenUnit(0);
    setShipmentType("kendaraan");
    setFiles([]);
    setResult(null);
    setStep(0);
  };

  if (result) return <SuccessScreen order={result} prevData={data} onAddAnother={addAnother} />;

  return (
    <div className="of-root" data-testid="ord-root">

      {/* ── Header ── */}
      <header className="of-hdr">
        <div className="of-hdr-inner">
          <a href="/" className="of-brand">
            <Logo size={48} />
            <div className="of-brand-text">
              <div className="of-brand-name">PT Alyssa Auto Logistik</div>
              <div className="of-brand-sub">Form Pemesanan Pengiriman Kendaraan</div>
            </div>
          </a>
          <button className="of-theme" onClick={toggleDark} aria-label="Ganti tema">
            {dark ? <IcoSun /> : <IcoMoon />}
          </button>
        </div>
      </header>

      {/* ── Stepper ── */}
      <div className="of-stepper" data-testid="ord-stepper">
        <div className="of-stepper-inner">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              className={`of-step${i === step ? " of-step--active" : ""}${i < step ? " of-step--done" : ""}`}
              onClick={() => { if (i < step) setStep(i); }}
              data-testid={`ord-step-${s.key}`}
            >
              <span className="of-step-num">
                {i < step ? <IcoCheck /> : STEP_ICONS[i]}
              </span>
              <span className="of-step-label">{s.label}</span>
              {i < STEPS.length - 1 && <span className="of-step-line" />}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="of-body">
        <div className="of-body-inner">

          {/* Step 0 — Kendaraan */}
          {step === 0 && (
            <div className="of-card" key="kendaraan" data-testid="ord-card-kendaraan">
              <div className="of-card-hd">
                <span className="of-card-ico"><IcoTruck /></span>
                <div>
                  <div className="of-card-title">Data Kiriman</div>
                  <div className="of-card-sub">Kendaraan/alat berat, atau barang/cargo biasa?</div>
                </div>
              </div>

              <div className="of-shiptype-toggle" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <button type="button"
                  className={`of-shiptype-btn${shipmentType === "kendaraan" ? " of-shiptype-btn--active" : ""}`}
                  onClick={() => setShipmentType("kendaraan")}
                  data-testid="ord-shiptype-kendaraan"
                  style={{
                    flex: 1, padding: "12px 10px", borderRadius: 12, cursor: "pointer",
                    border: shipmentType === "kendaraan" ? "2px solid #D4A847" : "1px solid var(--of-border, #e5e7eb)",
                    background: shipmentType === "kendaraan" ? "#FDF6E6" : "#fff",
                    fontWeight: 700, fontSize: 14,
                  }}>
                  🚗 Kendaraan / Alat Berat
                </button>
                <button type="button"
                  className={`of-shiptype-btn${shipmentType === "cargo" ? " of-shiptype-btn--active" : ""}`}
                  onClick={() => setShipmentType("cargo")}
                  data-testid="ord-shiptype-cargo"
                  style={{
                    flex: 1, padding: "12px 10px", borderRadius: 12, cursor: "pointer",
                    border: shipmentType === "cargo" ? "2px solid #D4A847" : "1px solid var(--of-border, #e5e7eb)",
                    background: shipmentType === "cargo" ? "#FDF6E6" : "#fff",
                    fontWeight: 700, fontSize: 14,
                  }}>
                  📦 Cargo / Barang
                </button>
              </div>

              {shipmentType === "kendaraan" && (
                <div data-testid="ord-units">
                  {data.units.map((u, i) => {
                    const open = openUnit === i;
                    const label = u.vehicle_type ? `${u.vehicle_type}${u.tipe_model ? ` · ${u.tipe_model}` : ""}${u.nopol ? ` · ${u.nopol}` : ""}` : "Belum dipilih";
                    return (
                      <div key={i} className="of-unit-card" data-testid={`ord-unit-${i}`}>
                        <button type="button" className="of-unit-hd" onClick={() => setOpenUnit(open ? -1 : i)} data-testid={`ord-unit-toggle-${i}`}>
                          <span className="of-unit-badge">Unit {i + 1}</span>
                          <span className="of-unit-label">{label}</span>
                          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                            {data.units.length > 1 && (
                              <span role="button" tabIndex={0} className="of-unit-del"
                                onClick={(e) => { e.stopPropagation(); removeUnit(i); }}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); removeUnit(i); } }}
                                data-testid={`ord-unit-remove-${i}`} title="Hapus unit">✕</span>
                            )}
                            <span className="of-unit-chev">{open ? "▲" : "▼"}</span>
                          </span>
                        </button>
                        {open && (
                          <div className="of-unit-body">
                            <div className="of-grid">
                              <Field label="Tipe Kendaraan" required full>
                                <select className="of-inp" value={u.vehicle_type}
                                  onChange={(e) => setUnit(i, "vehicle_type", e.target.value)}
                                  data-testid={`ord-vehicle-type-${i}`}>
                                  <option value="">— Pilih tipe kendaraan —</option>
                                  {vehicleTypes.map((v) => <option key={v} value={v}>{v}</option>)}
                                </select>
                              </Field>
                              {u.vehicle_type && (
                                <div className="of-field--full" style={{ marginTop: 4 }}>
                                  <div style={{ border: "1px solid var(--of-border, #e5e7eb)", borderRadius: 12, background: "#fff", padding: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                                    <VehicleSketch type={u.vehicle_type} style={{ width: "100%", height: 180 }} />
                                    <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Sketsa referensi — {u.vehicle_type}</div>
                                  </div>
                                </div>
                              )}
                              <Field label="Tipe / Model">
                                <input type="text" className="of-inp" value={u.tipe_model}
                                  onChange={(e) => setUnit(i, "tipe_model", e.target.value)}
                                  placeholder="Cth: Dozer D6R XL" data-testid={`ord-tipe-model-${i}`} />
                              </Field>
                              <Field label="No. Polisi">
                                <input type="text" className="of-inp" value={u.nopol}
                                  onChange={(e) => setUnit(i, "nopol", e.target.value.toUpperCase())}
                                  placeholder="B 1234 ABC" data-testid={`ord-nopol-${i}`} />
                              </Field>
                              <Field label="No. Rangka">
                                <input type="text" className="of-inp" value={u.no_rangka}
                                  onChange={(e) => setUnit(i, "no_rangka", e.target.value.toUpperCase())}
                                  placeholder="MHFE1CD1XXXXX" data-testid={`ord-rangka-${i}`} />
                              </Field>
                              <Field label="Warna">
                                <input type="text" className="of-inp" value={u.warna}
                                  onChange={(e) => setUnit(i, "warna", e.target.value)}
                                  placeholder="Hitam" data-testid={`ord-warna-${i}`} />
                              </Field>
                              <Field label="Tahun">
                                <input type="text" className="of-inp" value={u.tahun} maxLength={4}
                                  onChange={(e) => setUnit(i, "tahun", e.target.value.replace(/\D/g, ""))}
                                  placeholder="2024" data-testid={`ord-tahun-${i}`} />
                              </Field>
                              <Field label="Catatan Unit" full hint="Opsional — kondisi khusus / kelengkapan unit ini.">
                                <input type="text" className="of-inp" value={u.catatan}
                                  onChange={(e) => setUnit(i, "catatan", e.target.value)}
                                  placeholder="Cth: kunci ada di dalam kabin" data-testid={`ord-unit-catatan-${i}`} />
                              </Field>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" className="of-add-unit" onClick={addUnit}
                    disabled={data.units.length >= MAX_UNITS} data-testid="ord-add-unit">
                    + Tambah Unit {data.units.length >= MAX_UNITS ? `(maks ${MAX_UNITS})` : ""}
                  </button>
                  {data.units.length >= MAX_UNITS && (
                    <div style={{ fontSize: 11.5, color: "#8a6d3b", marginTop: 8 }}>Maksimal {MAX_UNITS} unit lewat form. Lebih dari itu, hubungi admin PT Alyssa.</div>
                  )}
                </div>
              )}

              {shipmentType === "cargo" && (
                <div className="of-grid">
                  <Field label="Deskripsi Barang / Isi Kiriman" required full hint="Muncul di kolom Isi Menurut Pengirim di Surat Jalan.">
                    <input type="text" className="of-inp" value={data.isi_kiriman}
                      onChange={(e) => set("isi_kiriman", e.target.value)}
                      placeholder="Cth: 5 dus mesin cuci" maxLength={200} data-testid="ord-isi-kiriman" />
                  </Field>
                  <Field label="Panjang (cm)">
                    <input type="text" inputMode="decimal" className="of-inp" value={data.panjang}
                      onChange={(e) => set("panjang", e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="120" data-testid="ord-panjang" />
                  </Field>
                  <Field label="Lebar (cm)">
                    <input type="text" inputMode="decimal" className="of-inp" value={data.lebar}
                      onChange={(e) => set("lebar", e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="80" data-testid="ord-lebar" />
                  </Field>
                  <Field label="Tinggi (cm)">
                    <input type="text" inputMode="decimal" className="of-inp" value={data.tinggi}
                      onChange={(e) => set("tinggi", e.target.value.replace(/[^0-9.]/g, ""))}
                      placeholder="100" data-testid="ord-tinggi" />
                  </Field>
                </div>
              )}

              <div className="of-grid" style={{ marginTop: 4 }}>
                <Field label="Jumlah Colly" hint="Jumlah jenis kemasan/koli — muncul di kolom Jml Jns Colly di Surat Jalan.">
                  <input type="text" inputMode="numeric" className="of-inp" value={data.jumlah_colly}
                    onChange={(e) => set("jumlah_colly", e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="Cth: 3" data-testid="ord-jumlah-colly" />
                </Field>
              </div>
            </div>
          )}

          {/* Step 1 — Asal */}
          {step === 1 && (
            <div className="of-card" key="asal" data-testid="ord-card-asal">
              <div className="of-card-hd">
                <span className="of-card-ico"><IcoPin /></span>
                <div>
                  <div className="of-card-title">Lokasi Penjemputan</div>
                  <div className="of-card-sub">Dari mana kendaraan akan dijemput?</div>
                </div>
              </div>
              <div className="of-grid">
                <Field label="Kota Asal" required>
                  <input type="text" className="of-inp" value={data.asal_kota}
                    onChange={(e) => set("asal_kota", e.target.value)}
                    placeholder="Jakarta" data-testid="ord-asal-kota" />
                </Field>
                <Field label="Nama Jalan & Kecamatan" full hint={`Cukup nama jalan & kecamatan, alamat detail diminta driver di lokasi · ${data.asal_alamat.length}/60`}>
                  <textarea className="of-inp of-textarea" rows={2} value={data.asal_alamat} maxLength={60}
                    onChange={(e) => set("asal_alamat", e.target.value)}
                    placeholder="Jl. Sudirman, Kec. Tebet"
                    data-testid="ord-asal-alamat" />
                </Field>
                <Field label="Tanggal Pickup">
                  <input type="date" className="of-inp" value={data.pickup_date}
                    onChange={(e) => set("pickup_date", e.target.value)}
                    data-testid="ord-pickup-date" />
                </Field>
                <Field label="Jam Pickup">
                  <input type="time" className="of-inp" value={data.pickup_time}
                    onChange={(e) => set("pickup_time", e.target.value)}
                    data-testid="ord-pickup-time" />
                </Field>
                <Field label="PIC Penjemputan">
                  <input type="text" className="of-inp" value={data.pickup_pic}
                    onChange={(e) => set("pickup_pic", e.target.value)}
                    placeholder="Bpk. Andi" data-testid="ord-pickup-pic" />
                </Field>
                <Field label="No. HP PIC">
                  <input type="tel" className="of-inp" value={data.pickup_hp}
                    onChange={(e) => set("pickup_hp", e.target.value)}
                    placeholder="0818-1234" data-testid="ord-pickup-hp" />
                </Field>
              </div>
            </div>
          )}

          {/* Step 2 — Tujuan */}
          {step === 2 && (
            <div className="of-card" key="tujuan" data-testid="ord-card-tujuan">
              <div className="of-card-hd">
                <span className="of-card-ico"><IcoFlag /></span>
                <div>
                  <div className="of-card-title">Lokasi Pengiriman</div>
                  <div className="of-card-sub">Ke mana kendaraan akan dikirimkan?</div>
                </div>
              </div>
              <div className="of-grid">
                <Field label="Kota Tujuan" required>
                  <input type="text" className="of-inp" value={data.tujuan_kota}
                    onChange={(e) => set("tujuan_kota", e.target.value)}
                    placeholder="Surabaya" data-testid="ord-tujuan-kota" />
                </Field>
                <Field label="Nama Jalan & Kecamatan" full hint={`Cukup nama jalan & kecamatan, alamat detail diminta driver di lokasi · ${data.tujuan_alamat.length}/60`}>
                  <textarea className="of-inp of-textarea" rows={2} value={data.tujuan_alamat} maxLength={60}
                    onChange={(e) => set("tujuan_alamat", e.target.value)}
                    placeholder="Jl. Pemuda, Kec. Gubeng"
                    data-testid="ord-tujuan-alamat" />
                </Field>
                <Field label="PIC Penerima">
                  <input type="text" className="of-inp" value={data.delivery_pic}
                    onChange={(e) => set("delivery_pic", e.target.value)}
                    placeholder="Ibu Siti" data-testid="ord-delivery-pic" />
                </Field>
                <Field label="No. HP Penerima">
                  <input type="tel" className="of-inp" value={data.delivery_hp}
                    onChange={(e) => set("delivery_hp", e.target.value)}
                    placeholder="0818-5678" data-testid="ord-delivery-hp" />
                </Field>
              </div>
            </div>
          )}

          {/* Step 3 — Konfirmasi */}
          {step === 3 && (
            <div className="of-card" key="konfirmasi" data-testid="ord-card-konfirmasi">
              <div className="of-card-hd">
                <span className="of-card-ico"><IcoDoc /></span>
                <div>
                  <div className="of-card-title">Konfirmasi Pesanan</div>
                  <div className="of-card-sub">Isi data pemesan dan cek ringkasan</div>
                </div>
              </div>
              <div className="of-grid">
                <Field label="Nama / PT" required>
                  <input type="text" className="of-inp" value={data.customer_nama}
                    onChange={(e) => set("customer_nama", e.target.value)}
                    placeholder="PT Logistik Jaya" data-testid="ord-customer-nama" />
                </Field>
                <Field label="No. HP / WhatsApp" required>
                  <input type="tel" className="of-inp" value={data.customer_hp}
                    onChange={(e) => set("customer_hp", e.target.value)}
                    placeholder="0818-9876" data-testid="ord-customer-hp" />
                </Field>
                <Field label="Email" full>
                  <input type="email" className="of-inp" value={data.customer_email}
                    onChange={(e) => set("customer_email", e.target.value)}
                    placeholder="purchasing@perusahaan.com" data-testid="ord-customer-email" />
                </Field>
                <Field label="Catatan Tambahan" full hint="Maks. 500 karakter">
                  <textarea className="of-inp of-textarea" rows={3} value={data.catatan} maxLength={500}
                    onChange={(e) => set("catatan", e.target.value)}
                    placeholder="Cth: tolong dijemput sore, kunci ada di security."
                    data-testid="ord-catatan" />
                </Field>
                <Field label="Upload Berkas / Scan (opsional)" full hint="PDF atau foto — mis. STNK, surat jalan, dokumen ekspedisi. Bisa lebih dari satu.">
                  <input
                    type="file"
                    className="of-inp"
                    multiple
                    accept=".pdf,image/*"
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                    data-testid="ord-berkas"
                  />
                  {files.length > 0 && (
                    <div style={{ marginTop: 6, fontSize: 13, color: "#2563eb" }}>
                      {files.map((f, i) => <div key={i}>📎 {f.name}</div>)}
                    </div>
                  )}
                </Field>
              </div>

              {/* Summary */}
              <div className="of-summary">
                <div className="of-summary-hd">Ringkasan Pesanan</div>
                <div className="of-summary-body">
                  <SRow k="Pemesan"      v={`${data.customer_nama || "—"} ${data.customer_hp ? `· ${data.customer_hp}` : ""}`.trim()} />
                  {shipmentType === "kendaraan" ? (
                    <>
                      <SRow k="Jumlah Unit" v={<b>{data.units.length} unit</b>} />
                      {data.units.map((u, i) => (
                        <SRow key={i} k={`Unit ${i + 1}`} v={`${u.vehicle_type || "—"}${u.tipe_model ? ` · ${u.tipe_model}` : ""}${u.nopol ? ` · ${u.nopol}` : ""}${u.warna || u.tahun ? ` · ${u.warna || "—"}/${u.tahun || "—"}` : ""}`} />
                      ))}
                    </>
                  ) : (
                    <SRow k="Barang / Cargo" v={data.isi_kiriman || "—"} />
                  )}
                  {(data.panjang || data.lebar || data.tinggi) && (
                    <SRow k="Dimensi (P×L×T cm)" v={`${data.panjang || "—"} × ${data.lebar || "—"} × ${data.tinggi || "—"}`} />
                  )}
                  {data.jumlah_colly && <SRow k="Jumlah Colly" v={data.jumlah_colly} />}
                  <SRow k="Asal"         v={`${data.asal_kota}${data.asal_alamat ? ` — ${data.asal_alamat}` : ""}`} />
                  <SRow k="Jadwal"       v={`${data.pickup_date || "—"} ${data.pickup_time || ""}`.trim()} />
                  <SRow k="Tujuan"       v={`${data.tujuan_kota}${data.tujuan_alamat ? ` — ${data.tujuan_alamat}` : ""}`} />
                  <SRow k="PIC Penerima" v={`${data.delivery_pic || "—"} ${data.delivery_hp ? `· ${data.delivery_hp}` : ""}`.trim()} />
                </div>
              </div>

              {!stepValid && (
                <div className="of-error" data-testid="ord-missing" style={{ background:"#fff7ed", borderColor:"#fdba74", color:"#c2410c" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  Lengkapi dulu data pemesan: {[
                    !data.customer_nama.trim() && "Nama / PT",
                    !data.customer_hp.trim() && "No. HP / WhatsApp",
                  ].filter(Boolean).join(" & ")} — wajib diisi sebelum kirim.
                </div>
              )}

              {error && (
                <div className="of-error" data-testid="ord-error">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom nav ── */}
      <div className="of-nav">
        <div className="of-nav-inner">
          <button type="button" className="of-btn of-btn--ghost"
            onClick={goPrev} disabled={step === 0 || submitting}
            data-testid="ord-btn-prev">
            <IcoBack /> Kembali
          </button>

          {step < STEPS.length - 1 ? (
            <button type="button" className="of-btn of-btn--primary"
              onClick={goNext} disabled={!stepValid}
              data-testid="ord-btn-next">
              Lanjut <IcoArrow />
            </button>
          ) : (
            <button type="button" className="of-btn of-btn--primary"
              onClick={submit} disabled={!stepValid || submitting}
              data-testid="ord-btn-submit">
              {submitting
                ? <><span className="of-spinner" /> Mengirim...</>
                : <><IcoSend /> Kirim Pesanan</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SRow({ k, v }) {
  return (
    <div className="of-srow">
      <div className="of-sk">{k}</div>
      <div className="of-sv">{v || "—"}</div>
    </div>
  );
}

const IcoPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

function SuccessScreen({ order, prevData, onAddAnother }) {
  const trackUrl = order.trip_id ? `${window.location.origin}/track/${order.trip_id}` : "";
  return (
    <div className="of-root">
      <header className="of-hdr">
        <div className="of-hdr-inner">
          <a href="/" className="of-brand">
            <Logo size={44} />
            <div className="of-brand-text">
              <div className="of-brand-name">PT Alyssa Auto Logistik</div>
            </div>
          </a>
        </div>
      </header>
      <div className="of-success" data-testid="ord-success">
        <div className="of-success-ico"><IcoCircleCheck /></div>
        <h1 className="of-success-title">Pesanan Berhasil Dikirim</h1>
        <p className="of-success-sub">
          Tim Alyssa Auto Logistik akan menghubungi Anda dalam 1×24 jam untuk konfirmasi jadwal penjemputan.
        </p>
        <div className="of-success-card">
          <div className="of-success-card-hd">Detail Pesanan</div>
          <SRow k="ID Pesanan" v={<span className="of-mono" data-testid="ord-success-id">{order.order_id}</span>} />
          <SRow k="Status"     v={<span className="of-chip">{order.status}</span>} />
          <SRow k="Rute"       v={`${order.asal_kota} → ${order.tujuan_kota}`} />
          <SRow k="Kontak"     v={`${order.customer_nama} · ${order.customer_hp}`} />
        </div>

        {/* Tambah kendaraan lain — tujuan sama */}
        {onAddAnother && (
          <div style={{ background: "linear-gradient(135deg,#0f2d1f,#1a4a2a)", border: "1px solid #2ea043", borderRadius: 14, padding: "18px 20px", margin: "16px 0", textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#56d364", marginBottom: 4 }}>🚗 Kirim Kendaraan Lain?</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 12 }}>
              Data pickup &amp; tujuan sudah tersimpan — tinggal isi data kendaraan berikutnya.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {[
                { ico: "📍", val: `${prevData?.asal_kota || "—"}` },
                { ico: "🏁", val: `${prevData?.tujuan_kota || "—"}` },
                { ico: "📅", val: `${prevData?.pickup_date || "—"} ${prevData?.pickup_time || ""}`.trim() },
              ].map((item, i) => (
                <span key={i} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, background: "#0d1117", border: "1px solid #30363d", color: "#e6edf3" }}>
                  {item.ico} {item.val}
                </span>
              ))}
            </div>
            <button onClick={onAddAnother} className="of-btn of-btn--primary" style={{ width: "100%", justifyContent: "center" }}>
              <IcoPlus /> Tambah Kendaraan Lain ke Tujuan yang Sama
            </button>
          </div>
        )}

        <div className="of-success-actions">
          <a className="of-btn of-btn--primary" href={`/status/${order.order_id}`} data-testid="ord-success-status">
            Cek Status Pesanan <IcoArrow />
          </a>
          {trackUrl && (
            <a className="of-btn of-btn--secondary" href={trackUrl} data-testid="ord-success-track">
              Lacak Perjalanan <IcoArrow />
            </a>
          )}
          <a className="of-btn of-btn--ghost" href="?order=1" data-testid="ord-success-new">
            Buat Pesanan Baru (Tujuan Berbeda)
          </a>
        </div>
        <p className="of-success-meta">
          Simpan ID pesanan untuk referensi. Hubungi <strong>0818 631 135</strong> untuk bantuan.
        </p>
      </div>
    </div>
  );
}
