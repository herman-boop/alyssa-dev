import { useEffect, useState, useMemo } from "react";
import axios from "axios";
import "./OrderStatus.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const STATUS_STEPS = [
  { key: "NEW",        label: "Pesanan Diterima",   sub: "Tim kami sedang memproses pesanan Anda" },
  { key: "DISPATCHED", label: "Driver Disiapkan",    sub: "Driver dan kendaraan telah ditetapkan" },
  { key: "ON_TRIP",    label: "Dalam Perjalanan",    sub: "Kendaraan sedang dalam perjalanan menuju tujuan" },
  { key: "DELIVERED",  label: "Terkirim",            sub: "Kendaraan telah tiba di tujuan dengan selamat" },
];
const STATUS_ORDER = ["NEW", "DISPATCHED", "ON_TRIP", "DELIVERED"];

function Logo({ size = 44 }) {
  return <img src="/logo.png" alt="PT Alyssa Auto Logistik" width={size} height={size} style={{ objectFit: "contain" }} />;
}

function IcoCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M2.5 7L5.5 10L11.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IcoClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 4.5V8l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
function IcoTruck() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <rect x="1" y="5.5" width="10" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M11 8.5h3l2.5 3.5V14h-5.5V8.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="4.5" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <circle cx="13.5" cy="14" r="1.5" stroke="currentColor" strokeWidth="1.3"/>
    </svg>
  );
}
function IcoCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <rect x="5" y="5" width="8" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M3 10V3h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}
function IcoWA() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden>
      <path fillRule="evenodd" clipRule="evenodd" d="M8.5 1C4.36 1 1 4.36 1 8.5c0 1.32.36 2.56.98 3.63L1 16l4.02-.95A7.49 7.49 0 0 0 8.5 16C12.64 16 16 12.64 16 8.5S12.64 1 8.5 1zm-1.8 4.1a.7.7 0 0 0-.54.28l-.17.23c-.32.44-.32 1.06.01 1.56l.64 1c.14.21.3.4.49.56l1.17.91c.32.25.74.3 1.1.11l.51-.25a.34.34 0 0 0 .06-.58l-1.03-.79a.34.34 0 0 0-.47.06l-.21.28-.92-.72a3.5 3.5 0 0 1-.39-.43l-.53-.82a.34.34 0 0 0 .03-.46l.21-.26a.34.34 0 0 0-.05-.49l-.79-.69a.7.7 0 0 0-.46-.18z" fill="currentColor"/>
    </svg>
  );
}
function IcoX() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 6l6 6M12 6l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}
function IcoArrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
      <path d="M3 7.5h9M8.5 4l3.5 3.5L8.5 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function readOrderId() {
  const u = new URL(window.location.href);
  const seg = u.pathname.match(/^\/status\/(.+)/);
  return seg ? decodeURIComponent(seg[1]) : u.searchParams.get("order_id") || "";
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("id-ID", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

export default function CustomerOrderStatus() {
  const orderId = useMemo(readOrderId, []);
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!orderId) {
      setError("ID pesanan tidak ditemukan dalam URL.");
      setLoading(false);
      return;
    }
    axios.get(`${API}/orders/${orderId}`)
      .then(r => setOrder(r.data))
      .catch(() => setError("Pesanan tidak ditemukan. Pastikan ID pesanan sudah benar."))
      .finally(() => setLoading(false));
  }, [orderId]);

  const copyId = () => {
    navigator.clipboard?.writeText(orderId || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isCancelled = order?.status === "CANCELLED";
  const currentStep = isCancelled ? -1 : STATUS_ORDER.indexOf(order?.status || "NEW");

  if (loading) {
    return (
      <div className="os-root">
        <div className="os-loading-screen">
          <div className="os-spinner" />
          <div className="os-loading-text">Memuat status pesanan...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="os-root">
        <header className="os-topbar">
          <a href="/" className="os-brand">
            <Logo size={40} />
            <div className="os-brand-name">PT Alyssa Auto Logistik</div>
          </a>
        </header>
        <div className="os-error-state" data-testid="os-error">
          <div className="os-error-icon"><IcoX /></div>
          <h2 className="os-error-title">Pesanan Tidak Ditemukan</h2>
          <p className="os-error-sub">{error}</p>
          <a href="/" className="os-btn os-btn-primary">Kembali ke Beranda</a>
          <a href="/order" className="os-btn os-btn-ghost">Buat Pesanan Baru</a>
        </div>
      </div>
    );
  }

  const waText = `Halo Admin Alyssa, saya ingin menanyakan status pesanan saya.\nID Pesanan: ${orderId}\nNama: ${order?.customer_nama || ""}`;

  return (
    <div className="os-root" data-testid="os-root">
      <header className="os-topbar">
        <a href="/" className="os-brand">
          <Logo size={40} />
          <div className="os-brand-name">PT Alyssa Auto Logistik</div>
        </a>
      </header>

      <main className="os-main">

        {/* Order ID Card */}
        <div className="os-id-card os-fade-up" data-testid="os-id-card">
          <div className="os-id-label">ID Pesanan</div>
          <div className="os-id-row">
            <div className="os-id-val" data-testid="os-order-id">{orderId}</div>
            <button className="os-copy-btn" onClick={copyId} data-testid="btn-copy-id">
              <IcoCopy />
              <span>{copied ? "Tersalin" : "Salin"}</span>
            </button>
          </div>
          <div className="os-id-date">Dibuat {fmtDate(order.created_at)}</div>
        </div>

        {/* Status Badge */}
        <div
          className={`os-status-badge os-fade-up os-status-${(order.status || "NEW").toLowerCase()}`}
          data-testid="os-status-badge"
          style={{ animationDelay: "60ms" }}
        >
          {isCancelled ? (
            <><IcoX /> Pesanan Dibatalkan</>
          ) : currentStep === 3 ? (
            <><IcoCheck /> Kendaraan Terkirim</>
          ) : currentStep === 2 ? (
            <><IcoTruck /> Sedang Dalam Perjalanan</>
          ) : currentStep === 1 ? (
            <><IcoClock /> Driver Sedang Disiapkan</>
          ) : (
            <><IcoClock /> Menunggu Konfirmasi Admin</>
          )}
        </div>

        {/* Timeline */}
        {!isCancelled && (
          <section className="os-card os-fade-up" style={{ animationDelay: "120ms" }}>
            <div className="os-card-title">Progress Pengiriman</div>
            <div className="os-timeline">
              {STATUS_STEPS.map((step, idx) => {
                const done = idx <= currentStep;
                const active = idx === currentStep;
                return (
                  <div
                    key={step.key}
                    className={`os-step${done ? " os-step-done" : ""}${active ? " os-step-active" : ""}`}
                    data-testid={`step-${step.key}`}
                  >
                    <div className="os-step-left">
                      <div className="os-step-node">
                        {done ? <IcoCheck /> : <span className="os-step-num">{idx + 1}</span>}
                      </div>
                      {idx < STATUS_STEPS.length - 1 && (
                        <div className={`os-step-line${done ? " os-step-line-done" : ""}`} />
                      )}
                    </div>
                    <div className="os-step-info">
                      <div className="os-step-label">{step.label}</div>
                      {active && <div className="os-step-sub">{step.sub}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Tracking Banner — shown once trip exists and is ON_TRIP or DELIVERED */}
        {order.trip_id && currentStep >= 2 && (
          <div className="os-track-banner os-fade-up" style={{ animationDelay: "180ms" }} data-testid="os-track-banner">
            <div className="os-track-ico"><IcoTruck /></div>
            <div className="os-track-text">
              <div className="os-track-title">Lacak Kendaraan Real-Time</div>
              <div className="os-track-sub">Pantau posisi dan foto perjalanan kendaraan Anda</div>
            </div>
            <a href={`/track/${order.trip_id}`} className="os-btn os-btn-accent" data-testid="btn-track">
              Lacak <IcoArrow />
            </a>
          </div>
        )}

        {/* Order Details */}
        <section className="os-card os-fade-up" style={{ animationDelay: "200ms" }}>
          <div className="os-card-title">Detail Pesanan</div>
          <div className="os-rows">
            <div className="os-row">
              <div className="os-row-k">Rute</div>
              <div className="os-row-v">{order.asal_kota} → {order.tujuan_kota}</div>
            </div>
            {order.tipe_kendaraan && (
              <div className="os-row">
                <div className="os-row-k">Kendaraan</div>
                <div className="os-row-v">{order.tipe_kendaraan}</div>
              </div>
            )}
            {order.nopol && (
              <div className="os-row">
                <div className="os-row-k">No. Polisi</div>
                <div className="os-row-v os-mono">{order.nopol}</div>
              </div>
            )}
            {order.no_rangka && (
              <div className="os-row">
                <div className="os-row-k">No. Rangka</div>
                <div className="os-row-v os-mono">{order.no_rangka}</div>
              </div>
            )}
            <div className="os-row">
              <div className="os-row-k">Pelanggan</div>
              <div className="os-row-v">{order.customer_nama}</div>
            </div>
            {order.customer_hp && (
              <div className="os-row">
                <div className="os-row-k">No. HP</div>
                <div className="os-row-v">{order.customer_hp}</div>
              </div>
            )}
          </div>
        </section>

        {/* Actions */}
        <div className="os-actions os-fade-up" style={{ animationDelay: "260ms" }}>
          <a
            href={`https://wa.me/628186311350?text=${encodeURIComponent(waText)}`}
            target="_blank"
            rel="noreferrer"
            className="os-btn os-btn-wa"
            data-testid="btn-wa"
          >
            <IcoWA /> Hubungi Admin via WhatsApp
          </a>
          <a href="/order" className="os-btn os-btn-ghost">Buat Pesanan Baru</a>
        </div>

        <p className="os-footer-note">
          Simpan ID pesanan sebagai referensi. Hubungi <strong>0818 631 135</strong> jika ada pertanyaan.
        </p>
      </main>

      <footer className="os-footer">
        PT Alyssa Auto Logistik &middot; 0818 631 135
      </footer>
    </div>
  );
}
