import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { QRCodeSVG } from "qrcode.react";
import "@/App.css";
import "@/Driver.css";
import "@/BASTK.css";
import { VEHICLE_TYPE_LIST, VehicleSketch, DAMAGE_CODES } from "@/VehicleSketches";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDateID(iso) {
  if (!iso) return "—";
  try { const d = new Date(iso); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; } catch { return "—"; }
}

function readBastkId() {
  const u = new URL(window.location.href);
  // New: /bastk/{trip_id}
  const seg = u.pathname.match(/^\/bastk\/(.+)/);
  if (seg) return decodeURIComponent(seg[1]);
  // Legacy: ?bastk=
  return u.searchParams.get("bastk") || "";
}

function SignaturePad({ value, onChange, label }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(!!value);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#0A1628";
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
      setHasInk(true);
    }
  }, [value]);

  const pos = (e) => {
    const c = canvasRef.current.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - c.left) * (canvasRef.current.width / c.width), y: (t.clientY - c.top) * (canvasRef.current.height / c.height) };
  };
  const start = (e) => { e.preventDefault(); drawing.current = true; const ctx = canvasRef.current.getContext("2d"); const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e) => { if (!drawing.current) return; e.preventDefault(); const ctx = canvasRef.current.getContext("2d"); const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); setHasInk(true); };
  const end = () => { drawing.current = false; if (canvasRef.current) onChange?.(canvasRef.current.toDataURL("image/png")); };
  const clear = () => {
    const c = canvasRef.current; const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    setHasInk(false); onChange?.("");
  };

  return (
    <div className="bk-sig">
      <div className="bk-sig-label">{label}</div>
      <canvas
        ref={canvasRef} width={400} height={140}
        className="bk-sig-canvas"
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        data-testid={`sig-canvas-${label.toLowerCase().replace(/\s+/g,'-')}`}
      />
      <div className="bk-sig-actions">
        <span className="bk-sig-hint">{hasInk ? "✓ Sudah TTD" : "Tap & coret di area atas"}</span>
        <button type="button" className="bk-sig-clear" onClick={clear} data-testid={`sig-clear-${label.toLowerCase().replace(/\s+/g,'-')}`}>Hapus</button>
      </div>
    </div>
  );
}

export default function BASTKPage() {
  const tripId = useMemo(readBastkId, []);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [vehicleType, setVehicleType] = useState("");
  const [activeCode, setActiveCode] = useState("RSK");
  const [marks, setMarks] = useState([]);
  const [customer, setCustomer] = useState({ nama: "", hp: "", alamat: "", pic: "", warna: "", tahun: "", km: "", kondisi: "Bekas" });
  const [sigDriver, setSigDriver] = useState("");
  const [sigCustomer, setSigCustomer] = useState("");
  const [sigPenyerah, setSigPenyerah] = useState("");
  const [catatan, setCatatan] = useState("");

  const [saving, setSaving] = useState(false);
  const [gen, setGen] = useState(false);
  const [toast, setToast] = useState(null);
  const sketchAreaRef = useRef(null);
  const printAreaRef = useRef(null);

  const showToast = (msg, type = "ok") => { setToast({ msg, type }); setTimeout(() => setToast(null), 2400); };

  useEffect(() => {
    if (!tripId) { setError("Link BASTK tidak valid. Hubungi admin."); setLoading(false); return; }
    (async () => {
      try {
        const r = await axios.get(`${API}/public/trips/${tripId}`);
        setData(r.data);
        setVehicleType(r.data.vehicle_type || "");
        setMarks(Array.isArray(r.data.damage_marks) ? r.data.damage_marks : []);
        const cd = r.data.customer_data || {};
        setCustomer({
          nama: cd.nama || "", hp: cd.hp || "", alamat: cd.alamat || "",
          pic: cd.pic || "", warna: cd.warna || "", tahun: cd.tahun || "",
          km: cd.km || "", kondisi: cd.kondisi || "Bekas",
          penyerah_nama: cd.penyerah_nama || "", penyerah_hp: cd.penyerah_hp || "", penyerah_alamat: cd.penyerah_alamat || "",
          penerima_nama: cd.penerima_nama || cd.nama || "", penerima_hp: cd.penerima_hp || cd.hp || "", penerima_alamat: cd.penerima_alamat || cd.alamat || "",
        });
        const sigs = r.data.signatures || {};
        setSigDriver(sigs.driver || "");
        setSigCustomer(sigs.customer || "");
        setSigPenyerah(sigs.penyerah || "");
        setCatatan(r.data.bastk_catatan || "");
      } catch (e) { setError("Data trip tidak ditemukan."); }
      finally { setLoading(false); }
    })();
  }, [tripId]);

  const addMark = (e) => {
    if (!sketchAreaRef.current) return;
    const rect = sketchAreaRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMarks((prev) => [...prev, { id: Date.now() + "-" + Math.random().toString(36).slice(2,6), code: activeCode, x, y, note: "" }]);
  };
  const removeMark = (id) => setMarks((prev) => prev.filter((m) => m.id !== id));

  const saveBASTK = async () => {
    if (!tripId) return;
    setSaving(true);
    try {
      const body = {
        vehicle_type: vehicleType,
        damage_marks: marks,
        customer_data: customer,
        signatures: { driver: sigDriver, customer: sigCustomer, penyerah: sigPenyerah },
        catatan,
      };
      const r = await axios.post(`${API}/trips/${tripId}/bastk`, body);
      setData(r.data);
      showToast("BASTK tersimpan");
    } catch (e) {
      showToast("Gagal simpan BASTK", "err");
    } finally { setSaving(false); }
  };

  const downloadPDF = async () => {
    if (!printAreaRef.current) return;
    setGen(true);
    const el = printAreaRef.current;
    // Force A4 portrait width (210mm ≈ 794px @96dpi) saat capture, biar hasil PDF
    // selalu proporsi A4 walau driver buka di HP (layar sempit).
    const A4_W = 794;
    const prev = { width: el.style.width, maxWidth: el.style.maxWidth, margin: el.style.margin };
    try {
      // Simpan dulu sebelum print
      await saveBASTK();
      el.style.width = A4_W + "px";
      el.style.maxWidth = A4_W + "px";
      el.style.margin = "0";
      el.classList.add("bk-scan"); // font tebal + border tegas biar tajam saat discan ulang
      el.getBoundingClientRect(); // paksa reflow
      const canvas = await html2canvas(el, {
        backgroundColor: "#FFFFFF",
        scale: 3, useCORS: true, logging: false,
        width: A4_W, windowWidth: A4_W,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const imgData = canvas.toDataURL("image/jpeg", 0.98);
      // Paksa muat 1 halaman A4: scale konten agar lebar & tinggi pas dalam margin.
      const maxW = pw - 12;  // margin 6mm kiri-kanan
      const maxH = ph - 12;  // margin 6mm atas-bawah
      let w = maxW;
      let h = (canvas.height / canvas.width) * w;
      if (h > maxH) {           // kalau kepanjangan, kecilkan ikut tinggi
        h = maxH;
        w = (canvas.width / canvas.height) * h;
      }
      const x = (pw - w) / 2;   // center horizontal
      pdf.addImage(imgData, "JPEG", x, 6, w, h);
      const nopol = (data?.nopol || "AAL").replace(/\s+/g, "-");
      pdf.save(`BASTK-${nopol}.pdf`);
      showToast("PDF tersimpan");
    } catch (e) {
      showToast("Gagal generate PDF: " + e.message, "err");
    } finally {
      // Kembalikan style asli biar tampilan layar nggak ikut berubah
      el.classList.remove("bk-scan");
      el.style.width = prev.width;
      el.style.maxWidth = prev.maxWidth;
      el.style.margin = prev.margin;
      setGen(false);
    }
  };

  if (loading) return <div className="drv-loading">Memuat BASTK…</div>;
  if (error)   return <div className="drv-error" data-testid="bk-error">{error}</div>;
  if (!data)   return <div className="drv-error">Data tidak ditemukan.</div>;

  const todayStr = fmtDateID(new Date().toISOString());
  // BASTK No: BASTK/{YYYYMM}/{6-char-hash-tripid} — stable per trip, easy to print, hard to fake.
  const bastkNo = (() => {
    const tid = (data.trip_id || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const tail = tid.slice(-6).padStart(6, "0");
    const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0");
    return `BASTK/${y}${m}/${tail}`;
  })();
  const trackUrl = `${window.location.origin}/?track=${encodeURIComponent(data.trip_id || "")}`;

  return (
    <div className="bk-root" data-testid="bk-root">
      {/* Toolbar atas (di luar print area) */}
      <div className="bk-toolbar">
        <div className="bk-toolbar-brand">
          <img src="/logo.png" alt="AAL" width={32} height={32} style={{ objectFit: "contain" }} />
          <div className="bk-toolbar-title">BASTK — Berita Acara Serah Terima</div>
        </div>
        <div className="bk-toolbar-actions">
          <button className="bk-btn bk-btn-ghost" onClick={saveBASTK} disabled={saving} data-testid="btn-save-bastk">
            {saving ? "Simpan..." : "Simpan"}
          </button>
          <button className="bk-btn bk-btn-gold" onClick={downloadPDF} disabled={gen} data-testid="btn-download-bastk">
            {gen ? "Membuat PDF..." : "Download PDF A4"}
          </button>
        </div>
      </div>

      {/* PRINT AREA — yang masuk ke PDF */}
      <div className="bk-print" ref={printAreaRef} data-testid="bk-print">
        {/* HEADER */}
        <div className="bk-header">
          <div className="bk-header-left">
            <div className="bk-logo-box">
              <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={56} height={56} style={{ objectFit: "contain" }} />
            </div>
            <div>
              <div className="bk-brand-name">PT ALYSSA AUTO LOGISTIK</div>
              <div className="bk-brand-tag">Berita Acara Serah Terima Kendaraan</div>
              <div className="bk-brand-meta">alyssalogistik.co.id · 0818 631 135</div>
            </div>
          </div>
          <div className="bk-header-right">
            <div className="bk-doc-no">No. BASTK</div>
            <div className="bk-doc-no-val" data-testid="bk-doc-no">{bastkNo}</div>
            <div className="bk-doc-trip-id">Trip: <span className="bk-mono">{(data.trip_id || "").slice(0, 24)}</span></div>
            <div className="bk-doc-date">{todayStr}</div>
          </div>
        </div>

        {/* DATA KENDARAAN + PELANGGAN */}
        <div className="bk-grid-2">
          <section className="bk-panel">
            <div className="bk-panel-head">DATA KENDARAAN</div>
            <div className="bk-kv-grid">
              <div className="bk-kv"><span className="k">No. Polisi</span><span className="v bk-mono">{data.nopol || "—"}</span></div>
              <div className="bk-kv"><span className="k">Tipe</span><span className="v">{vehicleType || data.tipe_kendaraan || "—"}</span></div>
              <div className="bk-kv"><span className="k">No. Rangka</span><span className="v bk-mono">{data.no_rangka || "—"}</span></div>
              <div className="bk-kv"><span className="k">Warna</span><span className="v">{customer.warna || "—"}</span></div>
              <div className="bk-kv"><span className="k">Tahun</span><span className="v">{customer.tahun || "—"}</span></div>
              <div className="bk-kv"><span className="k">Kilometer</span><span className="v">{customer.km || "—"}</span></div>
              <div className="bk-kv"><span className="k">Kondisi</span><span className="v">{customer.kondisi || "—"}</span></div>
              <div className="bk-kv"><span className="k">PIC</span><span className="v">{customer.pic || "—"}</span></div>
              <div className="bk-kv bk-kv-full"><span className="k">Rute</span><span className="v">{data.route || "—"}</span></div>
            </div>
          </section>
          <div className="bk-party-col">
            <section className="bk-panel">
              <div className="bk-panel-head">PELANGGAN YANG MENYERAHKAN</div>
              <table className="bk-table">
                <tbody>
                  <tr><th>Nama</th><td>{customer.penyerah_nama || "—"}</td></tr>
                  <tr><th>No. HP</th><td>{customer.penyerah_hp || "—"}</td></tr>
                  <tr><th>Alamat</th><td className="bk-wrap">{customer.penyerah_alamat || "—"}</td></tr>
                </tbody>
              </table>
            </section>
            <section className="bk-panel">
              <div className="bk-panel-head">PELANGGAN YANG MENERIMA</div>
              <table className="bk-table">
                <tbody>
                  <tr><th>Nama</th><td>{customer.penerima_nama || "—"}</td></tr>
                  <tr><th>No. HP</th><td>{customer.penerima_hp || "—"}</td></tr>
                  <tr><th>Alamat</th><td className="bk-wrap">{customer.penerima_alamat || "—"}</td></tr>
                </tbody>
              </table>
            </section>
          </div>
        </div>

        {/* SKETSA + DAMAGE CHECKLIST */}
        <section className="bk-panel">
          <div className="bk-panel-head">SKETSA KENDARAAN &amp; CHECKLIST KERUSAKAN</div>
          <div className="bk-sketch-meta">
            <div className="bk-sketch-meta-item"><b>Tipe:</b> {vehicleType || "—"}</div>
            <div className="bk-sketch-meta-item"><b>Total tanda:</b> {marks.length}</div>
            <div className="bk-codes-row">
              {DAMAGE_CODES.map((c) => (
                <span key={c.code} className="bk-code-pill" style={{ background: c.bg, color: c.color, borderColor: c.color }}>
                  <b>{c.code}</b> = {c.label}
                </span>
              ))}
            </div>
          </div>
          <div
            ref={sketchAreaRef}
            className="bk-sketch-area"
            onClick={addMark}
            role="application"
            data-testid="bk-sketch-area"
          >
            {vehicleType ? (
              <VehicleSketch type={vehicleType} className="bk-sketch" color="#152238" strokeWidth={2.5} />
            ) : (
              <div className="bk-sketch-placeholder">Pilih tipe kendaraan di bawah untuk menampilkan sketsa</div>
            )}
            {marks.map((m) => {
              const code = DAMAGE_CODES.find((c) => c.code === m.code) || DAMAGE_CODES[0];
              return (
                <button
                  key={m.id}
                  type="button"
                  className="bk-mark"
                  style={{ left: `${m.x}%`, top: `${m.y}%`, background: code.color, color: "#fff", borderColor: code.color }}
                  onClick={(e) => { e.stopPropagation(); removeMark(m.id); }}
                  title={`${code.code} (klik untuk hapus)`}
                  data-testid={`bk-mark-${m.id}`}
                >
                  {m.code}
                </button>
              );
            })}
          </div>
          {marks.length > 0 && (
            <div className="bk-marks-summary">
              {DAMAGE_CODES.map((c) => {
                const n = marks.filter((m) => m.code === c.code).length;
                if (n === 0) return null;
                return (
                  <span key={c.code} className="bk-code-pill" style={{ background: c.bg, color: c.color, borderColor: c.color }}>
                    <b>{c.code}</b> × {n}
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* CATATAN */}
        <section className="bk-panel">
          <div className="bk-panel-head">CATATAN TAMBAHAN</div>
          <div className="bk-catatan-display">{catatan || "—"}</div>
        </section>

        {/* SYARAT & KETENTUAN */}
        <section className="bk-panel">
          <div className="bk-panel-head">SYARAT &amp; KETENTUAN</div>
          <ul className="bk-terms">
            <li><b>Resiko:</b> Kerusakan atau kehilangan tanpa asuransi ditanggung pemilik.</li>
            <li><b>Barang Konsumen:</b> Barang di dalam kendaraan bukan tanggung jawab logistik.</li>
            <li><b>Barang Terlarang:</b> Menjadi tanggung jawab penuh pemilik kendaraan.</li>
            <li><b>Larangan Keras:</b> Dilarang menitipkan barang ilegal di dalam unit.</li>
          </ul>
        </section>

        {/* QR VERIFIKASI + TRACKING */}
        <section className="bk-panel bk-qr-panel" data-testid="bk-qr-panel">
          <div className="bk-panel-head">VERIFIKASI &amp; TRACKING REAL-TIME</div>
          <div className="bk-qr-body">
            <div className="bk-qr-box">
              <div className="bk-qr-svg">
                <QRCodeSVG
                  value={trackUrl}
                  size={132}
                  level="H"
                  includeMargin={false}
                  bgColor="#FFFFFF"
                  fgColor="#0A1628"
                  imageSettings={{
                    src:
                      "data:image/svg+xml;utf8," +
                      encodeURIComponent(
                        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80">' +
                        '<circle cx="40" cy="40" r="38" fill="#0A1628"/>' +
                        '<ellipse cx="40" cy="62" rx="14" ry="3" fill="#D4A847"/>' +
                        '<rect x="39" y="28" width="2" height="34" fill="#D4A847"/>' +
                        '<path d="M41,26 L60,32 L41,40 Z" fill="#D4A847"/>' +
                        '</svg>'
                      ),
                    height: 28,
                    width: 28,
                    excavate: true,
                  }}
                />
              </div>
              <div className="bk-qr-cap">SCAN UNTUK LACAK</div>
            </div>
            <div className="bk-qr-meta">
              <div className="bk-qr-row">
                <span className="bk-qr-k">No. BASTK</span>
                <span className="bk-qr-v bk-mono" data-testid="bk-qr-bastk-no">{bastkNo}</span>
              </div>
              <div className="bk-qr-row">
                <span className="bk-qr-k">Trip ID</span>
                <span className="bk-qr-v bk-mono">{data.trip_id || "—"}</span>
              </div>
              <div className="bk-qr-row">
                <span className="bk-qr-k">No. Polisi</span>
                <span className="bk-qr-v bk-mono">{data.nopol || "—"}</span>
              </div>
              <div className="bk-qr-row">
                <span className="bk-qr-k">Tanggal Cetak</span>
                <span className="bk-qr-v">{todayStr}</span>
              </div>
              <div className="bk-qr-row">
                <span className="bk-qr-k">Verifikasi URL</span>
                <span className="bk-qr-v bk-qr-url bk-mono">{trackUrl}</span>
              </div>
              <div className="bk-qr-note">
                Dokumen ini terverifikasi digital. Scan QR untuk konfirmasi keaslian &amp; pantau perjalanan kendaraan secara real-time di sistem Alyssa Auto Logistik.
              </div>
            </div>
          </div>
        </section>

        {/* TANDA TANGAN */}
        <section className="bk-panel">
          <div className="bk-panel-head">TANDA TANGAN</div>
          <div className="bk-sig-grid">
            <div className="bk-sig-box">
              <div className="bk-sig-box-label">Menyerahkan / Customer</div>
              {sigPenyerah ? <img src={sigPenyerah} alt="ttd penyerah" className="bk-sig-img" /> : <div className="bk-sig-empty">(belum tanda tangan)</div>}
              <div className="bk-sig-line" />
              <div className="bk-sig-name">{customer.penyerah_nama || "—"}</div>
            </div>
            <div className="bk-sig-box">
              <div className="bk-sig-box-label">Driver / Ekspedisi</div>
              {sigDriver ? <img src={sigDriver} alt="ttd driver" className="bk-sig-img" /> : <div className="bk-sig-empty">(belum tanda tangan)</div>}
              <div className="bk-sig-line" />
              <div className="bk-sig-name">{data.nama_driver || "—"}</div>
            </div>
            <div className="bk-sig-box">
              <div className="bk-sig-box-label">Menerima / Customer</div>
              {sigCustomer ? <img src={sigCustomer} alt="ttd customer" className="bk-sig-img" /> : <div className="bk-sig-empty">(belum tanda tangan)</div>}
              <div className="bk-sig-line" />
              <div className="bk-sig-name">{customer.penerima_nama || customer.nama || "—"}</div>
            </div>
          </div>
        </section>

        <div className="bk-footer">
          Dokumen ini sah sebagai bukti serah terima kendaraan. PT Alyssa Auto Logistik · 0818 631 135 · Halaman cetak A4.
        </div>
      </div>

      {/* EDITOR (di luar print area) */}
      <div className="bk-editor">
        <section className="bk-edit-card">
          <div className="bk-edit-head">Tipe Kendaraan</div>
          <select className="drv-step-input" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} data-testid="select-vehicle-type">
            <option value="">— Pilih tipe —</option>
            {VEHICLE_TYPE_LIST.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Kode Kerusakan Aktif (tap sketsa untuk menandai)</div>
          <div className="bk-code-grid" data-testid="bk-code-grid">
            {DAMAGE_CODES.map((c) => (
              <button
                key={c.code}
                type="button"
                className={`bk-code-btn ${activeCode === c.code ? "active" : ""}`}
                style={{ background: c.bg, color: c.color, borderColor: c.color }}
                onClick={() => setActiveCode(c.code)}
                data-testid={`bk-code-${c.code}`}
              >
                <b>{c.code}</b><span>{c.label}</span>
              </button>
            ))}
          </div>
          <div className="bk-hint">Tap di area sketsa untuk menandai. Tap tanda untuk hapus.</div>
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Data Pelanggan</div>
          <div className="bk-form-grid">
            <CFld lbl="Nama / PT" v={customer.nama} on={(v) => setCustomer({ ...customer, nama: v })} testid="cust-nama" />
            <CFld lbl="No. HP"     v={customer.hp}    on={(v) => setCustomer({ ...customer, hp: v })}    testid="cust-hp" />
            <CFld lbl="PIC"        v={customer.pic}   on={(v) => setCustomer({ ...customer, pic: v })}   testid="cust-pic" />
            <CFld lbl="Alamat"     v={customer.alamat} on={(v) => setCustomer({ ...customer, alamat: v })} testid="cust-alamat" full />
            <CFld lbl="Warna"      v={customer.warna} on={(v) => setCustomer({ ...customer, warna: v })} testid="cust-warna" />
            <CFld lbl="Tahun"      v={customer.tahun} on={(v) => setCustomer({ ...customer, tahun: v })} testid="cust-tahun" />
            <CFld lbl="Kilometer"  v={customer.km}    on={(v) => setCustomer({ ...customer, km: v })}    testid="cust-km" />
            <div className="bk-field">
              <label>Kondisi</label>
              <select className="drv-step-input" value={customer.kondisi} onChange={(e) => setCustomer({ ...customer, kondisi: e.target.value })} data-testid="cust-kondisi">
                <option>Baru</option><option>Bekas</option>
              </select>
            </div>
          </div>
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Pelanggan Yang Menyerahkan</div>
          <div className="bk-form-grid">
            <CFld lbl="Nama"   v={customer.penyerah_nama}   on={(v) => setCustomer({ ...customer, penyerah_nama: v })}   testid="penyerah-nama" />
            <CFld lbl="No. HP" v={customer.penyerah_hp}     on={(v) => setCustomer({ ...customer, penyerah_hp: v })}     testid="penyerah-hp" />
            <CFld lbl="Alamat" v={customer.penyerah_alamat} on={(v) => setCustomer({ ...customer, penyerah_alamat: v })} testid="penyerah-alamat" full />
          </div>
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Pelanggan Yang Menerima</div>
          <div className="bk-form-grid">
            <CFld lbl="Nama"   v={customer.penerima_nama}   on={(v) => setCustomer({ ...customer, penerima_nama: v })}   testid="penerima-nama" />
            <CFld lbl="No. HP" v={customer.penerima_hp}     on={(v) => setCustomer({ ...customer, penerima_hp: v })}     testid="penerima-hp" />
            <CFld lbl="Alamat" v={customer.penerima_alamat} on={(v) => setCustomer({ ...customer, penerima_alamat: v })} testid="penerima-alamat" full />
          </div>
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Catatan Tambahan</div>
          <textarea
            className="drv-step-input"
            rows={3}
            maxLength={500}
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            placeholder="Cth: Spion kanan baret kecil, kondisi mesin normal, dll."
            data-testid="bk-catatan"
          />
        </section>

        <section className="bk-edit-card">
          <div className="bk-edit-head">Tanda Tangan</div>
          <div className="bk-sig-grid">
            <SignaturePad label="Menyerahkan / Customer" value={sigPenyerah} onChange={setSigPenyerah} />
            <SignaturePad label="Driver / Ekspedisi" value={sigDriver} onChange={setSigDriver} />
            <SignaturePad label="Menerima / Customer" value={sigCustomer} onChange={setSigCustomer} />
          </div>
        </section>
      </div>

      {toast && <div className={`drv-toast ${toast.type === "err" ? "drv-toast-err" : "drv-toast-ok"}`} data-testid="toast">{toast.msg}</div>}
    </div>
  );
}

function CFld({ lbl, v, on, testid, full }) {
  return (
    <div className={`bk-field ${full ? "bk-field-full" : ""}`}>
      <label>{lbl}</label>
      <input type="text" className="drv-step-input" value={v} onChange={(e) => on(e.target.value)} data-testid={testid} />
    </div>
  );
}
