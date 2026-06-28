import { useState, useEffect, useRef, useCallback } from "react";
import "./Homepage.css";

/* ─── Dark mode ─────────────────────────────────────── */
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

/* ─── Animated counter ──────────────────────────────── */
function useCounter(target, duration, active) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = null;
    const step = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setVal(Math.floor(ease * target));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [active, target, duration]);
  return val;
}

/* ─── SVG Icons ─────────────────────────────────────── */
const IcoSun = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const IcoMoon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const IcoTruck = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="3" width="15" height="13" rx="1"/>
    <path d="M16 8h4l3 5v3h-7V8z"/>
    <circle cx="5.5" cy="18.5" r="2.5"/>
    <circle cx="18.5" cy="18.5" r="2.5"/>
  </svg>
);
const IcoShield = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);
const IcoPin = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);
const IcoDoc = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IcoCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IcoArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="5" y1="12" x2="19" y2="12"/>
    <polyline points="12 5 19 12 12 19"/>
  </svg>
);
const IcoSearch = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IcoPhone = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.64 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.55 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l.88-.88a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
);
const IcoStar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
);

/* ─── Data ─────────────────────────────────────────── */
const FEATURES = [
  { icon: <IcoTruck />, title: "Pengiriman Nationwide", body: "Armada carrier modern menjangkau seluruh wilayah Indonesia dengan jadwal penjemputan yang fleksibel sesuai kebutuhan Anda." },
  { icon: <IcoPin />, title: "Tracking Real-Time", body: "Pantau posisi kendaraan kapan saja via kode resi unik — tanpa aplikasi tambahan, langsung dari browser." },
  { icon: <IcoShield />, title: "Asuransi Komprehensif", body: "Setiap pengiriman dilindungi asuransi kargo penuh. Kendaraan Anda aman dan terjamin sejak penjemputan." },
  { icon: <IcoDoc />, title: "Dokumen BAST-K Digital", body: "Berita acara serah terima digital tersimpan aman, bisa diakses dan ditandatangani kapan pun dari mana pun." },
];

const STEPS = [
  { n: "01", title: "Isi Formulir Online", body: "Lengkapi data pengiriman dan kendaraan Anda secara online — selesai dalam 3 menit." },
  { n: "02", title: "Konfirmasi & Jadwal", body: "Tim kami menghubungi Anda dalam 1x24 jam untuk konfirmasi dan jadwal penjemputan." },
  { n: "03", title: "Pengiriman & Tracking", body: "Kendaraan dikirim dengan carrier terpercaya. Pantau status kapan saja via kode resi." },
  { n: "04", title: "Tiba & Serah Terima", body: "Kendaraan tiba, BAST-K digital dikirim otomatis. Pengiriman selesai, aman dan terdokumentasi." },
];

const PERKS = [
  "Berpengalaman 12+ tahun di industri",
  "Asuransi kargo inklusif di setiap pengiriman",
  "Tracking 24/7 via kode resi unik",
  "Dokumen BAST-K digital terenkripsi",
  "Support responsif via WhatsApp",
  "Harga transparan, tanpa biaya tersembunyi",
];

/* ─── Main Component ────────────────────────────────── */
export default function Homepage() {
  const [dark, toggleDark] = useDarkMode();
  const [trackCode, setTrackCode] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const statsRef = useRef(null);
  const [statsIn, setStatsIn] = useState(false);

  const c1 = useCounter(2500, 1800, statsIn);
  const c2 = useCounter(98,   1400, statsIn);
  const c3 = useCounter(15,   1200, statsIn);
  const c4 = useCounter(12,   1000, statsIn);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setStatsIn(true); obs.disconnect(); } },
      { threshold: 0.25 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const doTrack = () => {
    const v = trackCode.trim();
    if (v) window.location.href = `/track/${encodeURIComponent(v)}`;
  };

  return (
    <div className="hp">
      {/* ══ HEADER ══════════════════════════════════════ */}
      <header className={`hp-hdr${scrolled ? " hp-hdr--up" : ""}`}>
        <div className="hp-hdr-inner">
          <a href="/" className="hp-brand">
            <svg viewBox="0 0 40 40" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
              <rect x="19" y="7" width="2" height="25" fill="#D4A847"/>
              <path d="M21,5 L35,12 L21,19 Z" fill="#2563EB"/>
              <circle cx="20" cy="5" r="3.5" fill="#D4A847"/>
              <ellipse cx="20" cy="33" rx="11" ry="3.5" fill="#2563EB" opacity="0.18"/>
            </svg>
            <span className="hp-brand-name">AAL<span className="hp-brand-suffix">ogistik</span></span>
          </a>

          <nav className="hp-nav" aria-label="Main navigation">
            <a href="#fitur" className="hp-nav-a">Fitur</a>
            <a href="#cara-kerja" className="hp-nav-a">Cara Kerja</a>
            <a href="#lacak-resi" className="hp-nav-a">Tracking</a>
          </nav>

          <div className="hp-hdr-right">
            <button className="hp-theme" onClick={toggleDark} aria-label="Ganti tema">
              {dark ? <IcoSun /> : <IcoMoon />}
            </button>
            <a href="/order" className="hp-pill hp-pill--blue">
              Kirim Sekarang <IcoArrow />
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* ══ HERO ════════════════════════════════════════ */}
        <section className="hp-hero">
          <div className="hp-hero-bg">
            <div className="hp-orb hp-orb-1" />
            <div className="hp-orb hp-orb-2" />
            <div className="hp-orb hp-orb-3" />
            <div className="hp-grid-lines" aria-hidden="true" />
          </div>

          <div className="hp-hero-body">
            <div className="hp-hero-badge">
              <span className="hp-badge-pulse" />
              Layanan Pengiriman Kendaraan No.1
            </div>

            <h1 className="hp-h1">
              <span className="hp-h1-ln hp-h1-ln-1">Kirim Kendaraan</span>
              <span className="hp-h1-ln hp-h1-ln-2">
                <mark className="hp-mark">Aman</mark> &amp; <mark className="hp-mark">Terpantau</mark>
              </span>
              <span className="hp-h1-ln hp-h1-ln-3">ke Seluruh Indonesia</span>
            </h1>

            <p className="hp-hero-p">
              Solusi pengiriman kendaraan profesional dengan pelacakan real-time,
              asuransi komprehensif, dan dokumen digital. Premium, transparan, terpercaya.
            </p>

            <div className="hp-hero-btns">
              <a href="/order" className="hp-pill hp-pill--blue hp-pill--lg">
                Mulai Pengiriman <IcoArrow />
              </a>
              <a href="#cara-kerja" className="hp-pill hp-pill--ghost hp-pill--lg">
                Cara Kerja
              </a>
            </div>

            <div className="hp-hero-trust">
              <span className="hp-stars">
                {[...Array(5)].map((_, i) => <IcoStar key={i} />)}
              </span>
              <span className="hp-trust-txt">Dipercaya 2.500+ pelanggan di Indonesia</span>
            </div>
          </div>
        </section>

        {/* ══ TRACK BAR ═══════════════════════════════════ */}
        <section className="hp-track" id="lacak-resi">
          <div className="hp-w">
            <div className="hp-track-card">
              <span className="hp-track-label">
                <IcoPin /> Lacak Pengiriman
              </span>
              <div className="hp-track-row">
                <div className="hp-track-iw">
                  <IcoSearch />
                  <input
                    className="hp-track-inp"
                    type="text"
                    placeholder="Masukkan kode resi..."
                    value={trackCode}
                    onChange={(e) => setTrackCode(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && doTrack()}
                  />
                </div>
                <button className="hp-pill hp-pill--blue" onClick={doTrack}>
                  Lacak
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ══ STATS ═══════════════════════════════════════ */}
        <section className="hp-stats" ref={statsRef}>
          <div className="hp-w">
            <div className="hp-stats-row">
              {[
                { val: `${c1.toLocaleString("id-ID")}+`, lbl: "Kendaraan Terkirim" },
                { val: `${c2}%`,                          lbl: "Tingkat Kepuasan" },
                { val: `${c3}+`,                          lbl: "Kota Tujuan" },
                { val: `${c4}+`,                          lbl: "Tahun Pengalaman" },
              ].map((s, i) => (
                <div className="hp-stat" key={i}>
                  <div className="hp-stat-v">{s.val}</div>
                  <div className="hp-stat-l">{s.lbl}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ══ FEATURES ════════════════════════════════════ */}
        <section className="hp-features" id="fitur">
          <div className="hp-w">
            <div className="hp-sec-hd">
              <div className="hp-sec-tag">Keunggulan Layanan</div>
              <h2 className="hp-h2">Standar premium,<br/>harga transparan</h2>
              <p className="hp-sec-p">
                Setiap aspek pengiriman dirancang untuk memberikan ketenangan pikiran
                dan pengalaman terbaik.
              </p>
            </div>
            <div className="hp-feat-grid">
              {FEATURES.map((f, i) => (
                <article className="hp-feat-card" key={i} style={{ "--i": i }}>
                  <div className="hp-feat-ico">{f.icon}</div>
                  <h3 className="hp-feat-title">{f.title}</h3>
                  <p className="hp-feat-p">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ══ HOW IT WORKS ════════════════════════════════ */}
        <section className="hp-how" id="cara-kerja">
          <div className="hp-w">
            <div className="hp-how-layout">
              <div className="hp-how-left">
                <div className="hp-sec-tag">Cara Kerja</div>
                <h2 className="hp-h2">4 langkah<br/>mudah dan cepat</h2>
                <p className="hp-sec-p">
                  Dari pemesanan hingga kendaraan tiba — kami pastikan setiap
                  langkah berjalan lancar dan terdokumentasi.
                </p>
                <ul className="hp-perks">
                  {PERKS.map((p, i) => (
                    <li className="hp-perk" key={i}>
                      <span className="hp-perk-ico"><IcoCheck /></span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hp-how-right">
                {STEPS.map((s, i) => (
                  <div className="hp-step" key={i} style={{ "--i": i }}>
                    <div className="hp-step-n">{s.n}</div>
                    <div className="hp-step-bd">
                      <div className="hp-step-title">{s.title}</div>
                      <div className="hp-step-p">{s.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ══ CTA ═════════════════════════════════════════ */}
        <section className="hp-cta">
          <div className="hp-w">
            <div className="hp-cta-card">
              <div className="hp-cta-glow" />
              <h2 className="hp-cta-title">Siap kirim kendaraan Anda?</h2>
              <p className="hp-cta-p">
                Isi formulir online dalam 3 menit. Tim kami segera menghubungi
                untuk konfirmasi penjemputan.
              </p>
              <div className="hp-cta-btns">
                <a href="/order" className="hp-pill hp-pill--white hp-pill--lg">
                  Pesan Sekarang <IcoArrow />
                </a>
                <a
                  href="https://wa.me/6285156830050"
                  target="_blank"
                  rel="noreferrer"
                  className="hp-pill hp-pill--outline-white hp-pill--lg"
                >
                  <IcoPhone /> WhatsApp
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ══ FOOTER ══════════════════════════════════════ */}
      <footer className="hp-foot">
        <div className="hp-w">
          <div className="hp-foot-inner">
            <div className="hp-foot-brand">
              <a href="/" className="hp-brand" style={{ marginBottom: 10 }}>
                <svg viewBox="0 0 40 40" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
                  <rect x="19" y="7" width="2" height="25" fill="#D4A847"/>
                  <path d="M21,5 L35,12 L21,19 Z" fill="#2563EB"/>
                  <circle cx="20" cy="5" r="3.5" fill="#D4A847"/>
                </svg>
                <span className="hp-brand-name">AAL<span className="hp-brand-suffix">ogistik</span></span>
              </a>
              <p className="hp-foot-tagline">
                PT Alyssa Auto Logistik<br/>
                Pengiriman kendaraan terpercaya sejak 2012.
              </p>
            </div>
            <div className="hp-foot-links">
              <div className="hp-foot-col">
                <div className="hp-foot-col-hd">Layanan</div>
                <a href="/order">Kirim Kendaraan</a>
                <a href="#lacak-resi">Lacak Resi</a>
              </div>
              <div className="hp-foot-col">
                <div className="hp-foot-col-hd">Dukungan</div>
                <a href="https://wa.me/6285156830050" target="_blank" rel="noreferrer">WhatsApp Support</a>
                <a href="/guide">Panduan Operasional</a>
              </div>
            </div>
          </div>
          <div className="hp-foot-btm">
            © 2025 PT Alyssa Auto Logistik. Seluruh hak cipta dilindungi.
          </div>
        </div>
      </footer>
    </div>
  );
}
