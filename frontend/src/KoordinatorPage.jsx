/* eslint-disable */
import { useState, useEffect, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const LS_ID    = "aal_kord_id";
const LS_NAMA  = "aal_kord_nama";
const LS_FIRST = "aal_kord_first";
const LS_SOP   = "aal_kord_sop_ok";

const STATUS_LABEL = {
  NEW:        { txt: "Baru",       color: "#8b949e" },
  DISPATCHED: { txt: "Dispatched", color: "#d29922" },
  ON_TRIP:    { txt: "On-Trip",    color: "#1f6feb" },
  DELIVERED:  { txt: "Delivered",  color: "#2ea043" },
  CANCELLED:  { txt: "Batal",      color: "#f85149" },
};

const TIPE_ICON = {
  "Self Drive": "🚗",
  "Kapal RoRo": "🚢",
  "Kapal Kontainer": "🚢",
  "Car Carrier": "🚛",
  "Towing": "🔗",
  "Self Loader": "🏗",
  "Lainnya": "📦",
};

function waLink(hp) {
  if (!hp) return null;
  const digits = hp.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
  return `https://wa.me/${intl}`;
}

function ContactBtn({ label, hp }) {
  const link = waLink(hp);
  if (!link) return null;
  return (
    <a
      href={link}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "inline-block",
        padding: "5px 12px",
        borderRadius: 6,
        background: "#1a4731",
        color: "#2ea043",
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
        border: "1px solid #2ea043",
      }}
    >
      💬 {label}
    </a>
  );
}

function LegCard({ leg }) {
  const isKapal = leg.tipe && leg.tipe.startsWith("Kapal");
  return (
    <div style={{
      background: "#0d1117",
      border: "1px solid #21262d",
      borderRadius: 8,
      padding: "10px 12px",
      marginBottom: 6,
    }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 15 }}>{TIPE_ICON[leg.tipe] || "📦"}</span>
        <span style={{ fontWeight: 700, fontSize: 12, color: "#EF9F27" }}>{leg.tipe}</span>
        <span style={{ color: "#8b949e", fontSize: 11 }}>{leg.asal || "—"} → {leg.tujuan || "—"}</span>
        {leg.status && (
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#8b949e", background: "#161b22", borderRadius: 4, padding: "2px 6px" }}>{leg.status}</span>
        )}
      </div>
      {!isKapal && leg.driver && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 3 }}>DRIVER</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#e6edf3" }}>{leg.driver}</span>
            {leg.driver_hp && <span style={{ fontSize: 11, color: "#8b949e" }}>{leg.driver_hp}</span>}
            {leg.driver_hp && <ContactBtn label="Hubungi Driver" hp={leg.driver_hp} />}
          </div>
        </div>
      )}
      {!isKapal && leg.kord_bayangan && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 3 }}>KOORDINATOR BAYANGAN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#e6edf3" }}>{leg.kord_bayangan}</span>
            {leg.kord_bayangan_hp && <ContactBtn label="Hubungi Kord Bayangan" hp={leg.kord_bayangan_hp} />}
          </div>
        </div>
      )}
      {isKapal && leg.kapal && (
        <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>⚓ {leg.kapal}{leg.marking ? ` · ${leg.marking}` : ""}</div>
      )}
      {isKapal && leg.kord_kapal && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 10, color: "#60a5fa", fontWeight: 700, marginBottom: 3 }}>KOORDINATOR KAPAL</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#e6edf3" }}>{leg.kord_kapal}</span>
            {leg.kord_kapal_hp && <ContactBtn label="Hubungi Kord Kapal" hp={leg.kord_kapal_hp} />}
          </div>
        </div>
      )}
    </div>
  );
}

function DriverPerformanceWidget({ trip }) {
  const rate = trip.checkpoint_rate ?? 0;
  const days = trip.days_elapsed ?? 0;
  const handoverOk = trip.both_handover;

  // Color
  const color = rate >= 80 ? "#2ea043" : rate >= 50 ? "#d29922" : "#f85149";

  // Badge
  let badge = null;
  if (rate === 100 && handoverOk) {
    badge = { label: "⭐ BINTANG", color: "#EF9F27", bg: "#2a1f00" };
  } else if (rate >= 70 && handoverOk) {
    badge = { label: "✓ BAIK", color: "#2ea043", bg: "#0a2a14" };
  } else if (rate < 50) {
    badge = { label: "🔴 BERMASALAH", color: "#f85149", bg: "#2a0a0a" };
  } else {
    badge = { label: "⚠ PERLU DIKAWAL", color: "#d29922", bg: "#2a1e00" };
  }

  // Simple circular progress via SVG
  const R = 18;
  const C = 2 * Math.PI * R;
  const dash = C * (rate / 100);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      background: "#0d1117", border: "1px solid #21262d",
      borderRadius: 8, padding: "10px 12px", marginBottom: 8,
    }}>
      {/* Circular progress */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <svg width="44" height="44" viewBox="0 0 44 44">
          <circle cx="22" cy="22" r={R} fill="none" stroke="#21262d" strokeWidth="4" />
          <circle
            cx="22" cy="22" r={R}
            fill="none" stroke={color} strokeWidth="4"
            strokeDasharray={`${dash} ${C}`}
            strokeLinecap="round"
            transform="rotate(-90 22 22)"
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 800, color,
        }}>{rate}%</div>
      </div>
      {/* Stats */}
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 3 }}>PERFORMA DRIVER</div>
        <div style={{ fontSize: 11, color: "#e6edf3", marginBottom: 4 }}>
          Checkpoint: <span style={{ color, fontWeight: 700 }}>{rate}%</span>
          <span style={{ color: "#8b949e", marginLeft: 8 }}>Hari ke-{days}</span>
        </div>
        <span style={{
          display: "inline-block",
          background: badge.bg,
          color: badge.color,
          border: `1px solid ${badge.color}44`,
          borderRadius: 5,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
        }}>{badge.label}</span>
      </div>
    </div>
  );
}

function TripCard({ trip }) {
  const sl = STATUS_LABEL[trip.status] || { txt: trip.status, color: "#8b949e" };
  const handover = trip.handover || {};
  return (
    <div style={{
      background: "#161b22",
      border: "1px solid #30363d",
      borderRadius: 12,
      padding: "14px 16px",
      marginBottom: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: "#EF9F27", marginBottom: 2 }}>
            {trip.nopol || trip.vehicle_type || "—"}
          </div>
          <div style={{ fontSize: 12, color: "#e6edf3" }}>
            {trip.asal_kota || "—"} → {trip.tujuan_kota || "—"}
          </div>
          {trip.customer_nama && (
            <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>
              Pelanggan: {trip.customer_nama}
            </div>
          )}
        </div>
        <span style={{
          background: sl.color + "22",
          color: sl.color,
          border: `1px solid ${sl.color}44`,
          borderRadius: 6,
          padding: "3px 10px",
          fontSize: 11,
          fontWeight: 700,
        }}>{sl.txt}</span>
      </div>

      {/* Driver Performance Widget */}
      <DriverPerformanceWidget trip={trip} />

      {/* Handover status */}
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 11 }}>
          BASTK: <span style={{ color: handover.bastk ? "#2ea043" : "#f85149", fontWeight: 700 }}>{handover.bastk ? "✓" : "✗"}</span>
        </span>
        <span style={{ fontSize: 11 }}>
          Resi: <span style={{ color: handover.resi ? "#2ea043" : "#f85149", fontWeight: 700 }}>{handover.resi ? "✓" : "✗"}</span>
        </span>
        <span style={{ fontSize: 11, color: "#8b949e" }}>
          Checkpoint: {trip.daily_checkpoints_count || 0}
          {trip.last_checkpoint && <span> · Terakhir: {new Date(trip.last_checkpoint).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</span>}
        </span>
      </div>

      {/* Legs */}
      {Array.isArray(trip.legs) && trip.legs.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "#8b949e", fontWeight: 700, marginBottom: 6, letterSpacing: 1 }}>RUTE LEG</div>
          {trip.legs.map((leg, i) => <LegCard key={i} leg={leg} />)}
        </div>
      )}
    </div>
  );
}

/* ────── SOP Modal ────── */
function SopModal({ onOk }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "#0d1117",
      zIndex: 1000, overflowY: "auto",
      display: "flex", flexDirection: "column",
      fontFamily: "'Inter','Segoe UI',sans-serif",
      color: "#e6edf3",
    }}>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 20px 40px" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: "#EF9F27", fontWeight: 800, letterSpacing: 2 }}>PT. ALYSSA AUTO LOGISTIK</div>
          <div style={{ fontSize: 18, fontWeight: 900, marginTop: 6 }}>PANDUAN KOORDINATOR</div>
        </div>

        <Section title="PENDAHULUAN">
          Kamu adalah penghubung antara PT Alyssa dan driver di lapangan. Driver borongan punya cara kerja sendiri — tugas kamu bukan memerintah, tapi memastikan mereka tahu apa yang diharapkan dan diingatkan dengan cara yang baik.
          <br /><br />
          Satu pesan yang tepat waktu bisa mencegah satu komplain pelanggan.
        </Section>

        <Section title="PRINSIP DASAR">
          <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.8 }}>
            <li>Hubungi driver dengan sopan dan singkat — mereka sedang nyetir</li>
            <li>Kalau driver belum respons dalam 1 jam, hubungi koordinator bayangan</li>
            <li>Jangan panik duluan — cek dulu data di sistem sebelum eskalasi</li>
            <li>Pelanggan yang tenang = kamu yang proaktif update duluan</li>
          </ul>
        </Section>

        <Section title="ALUR HARIAN">
          <div style={{ lineHeight: 1.9 }}>
            <b style={{ color: "#EF9F27" }}>Pagi (07.00–09.00):</b> Cek dashboard — trip mana yang belum ada foto checkpoint hari ini. Kirim WA singkat ke driver.<br />
            <b style={{ color: "#EF9F27" }}>Sore (17.00):</b> Kalau belum ada foto — hubungi driver lagi. Tidak respons — hubungi koordinator bayangan.<br />
            <b style={{ color: "#EF9F27" }}>Malam (19.00):</b> Lapor ke admin: trip mana yang update, mana yang belum.
          </div>
        </Section>

        <Section title="SAAT TIBA DI TUJUAN">
          Ingatkan driver: minta pelanggan tanda tangan + stempel BASTK sebelum pisah, foto BASTK langsung upload, kirim berkas asli via JNE dalam 2 hari, foto resi lalu upload.
        </Section>

        <Section title="CARA MENGINGATKAN DRIVER">
          <div style={{ background: "#0a2a14", border: "1px solid #2ea04344", borderRadius: 7, padding: "10px 14px", marginBottom: 8, fontSize: 13 }}>
            ✓ "Pak, foto checkpoint-nya belum masuk. Kalau update-nya bagus, nama Bapak gw rekomendasikan untuk trip berikutnya."
          </div>
          <div style={{ background: "#2a0a0a", border: "1px solid #f8514944", borderRadius: 7, padding: "10px 14px", fontSize: 13, color: "#8b949e" }}>
            ✗ Jangan pakai nada perintah atau ancaman.
          </div>
        </Section>

        <button
          onClick={onOk}
          style={{
            width: "100%",
            marginTop: 32,
            padding: "14px",
            background: "#EF9F27",
            color: "#0d1117",
            border: "none",
            borderRadius: 10,
            fontSize: 15,
            fontWeight: 900,
            cursor: "pointer",
            letterSpacing: 1,
          }}
        >SAYA MENGERTI</button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#EF9F27", letterSpacing: 2, marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.7, color: "#c9d1d9" }}>{children}</div>
    </div>
  );
}

/* ────── Change Password Screen ────── */
function ChangePasswordScreen({ kordId, onSuccess, onCancel }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    if (!newPw.trim()) { setErr("Password baru tidak boleh kosong"); return; }
    if (newPw !== confirmPw) { setErr("Password tidak cocok"); return; }
    setLoading(true);
    try {
      await axios.post(`${API}/koordinator/change-password`, {
        kord_id: kordId,
        old_password: oldPw,
        new_password: newPw,
      });
      onSuccess();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Gagal mengganti password");
    } finally { setLoading(false); }
  };

  const S = {
    root: { minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'Inter','Segoe UI',sans-serif", padding: "0 0 40px" },
    header: { background: "#161b22", borderBottom: "1px solid #21262d", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 15, fontWeight: 800, color: "#EF9F27" },
    sub: { fontSize: 11, color: "#8b949e" },
    body: { maxWidth: 400, margin: "0 auto", padding: "20px 16px 0" },
    inp: { width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 7, padding: "10px 12px", color: "#e6edf3", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12 },
    btn: { width: "100%", background: "#EF9F27", color: "#0d1117", border: "none", borderRadius: 7, padding: "11px", fontWeight: 800, fontSize: 14, cursor: "pointer", marginBottom: 8 },
    card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: "28px 24px", marginTop: 40 },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div>
          <div style={S.title}>Ganti Password</div>
          <div style={S.sub}>Portal Koordinator</div>
        </div>
        {onCancel && (
          <button onClick={onCancel} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Kembali</button>
        )}
      </div>
      <div style={S.body}>
        <div style={S.card}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#EF9F27", marginBottom: 6 }}>Buat Password Baru</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 20 }}>
            {onCancel ? "Masukkan password lama dan buat password baru." : "Ini adalah login pertama Anda. Buat password baru untuk melanjutkan."}
          </div>
          {onCancel && (
            <input style={S.inp} type="password" placeholder="Password lama" value={oldPw} onChange={e => setOldPw(e.target.value)} />
          )}
          <input style={S.inp} type="password" placeholder="Password baru" value={newPw} onChange={e => setNewPw(e.target.value)} />
          <input style={S.inp} type="password" placeholder="Konfirmasi password baru" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          {err && <div style={{ color: "#f85149", fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <button style={{ ...S.btn, opacity: loading ? 0.6 : 1 }} onClick={submit} disabled={loading}>
            {loading ? "Menyimpan..." : "Simpan Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────── Login Screen ────── */
function LoginScreen({ onLogin }) {
  const [namaDraft, setNamaDraft] = useState("");
  const [pwDraft, setPwDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const doLogin = async () => {
    setErr("");
    if (!namaDraft.trim()) { setErr("Nama tidak boleh kosong"); return; }
    if (!pwDraft) { setErr("Password tidak boleh kosong"); return; }
    setLoading(true);
    try {
      const r = await axios.post(`${API}/koordinator/login`, { nama: namaDraft.trim(), password: pwDraft });
      onLogin(r.data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Login gagal");
    } finally { setLoading(false); }
  };

  const S = {
    root: { minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'Inter','Segoe UI',sans-serif" },
    header: { background: "#161b22", borderBottom: "1px solid #21262d", padding: "14px 20px" },
    title: { fontSize: 15, fontWeight: 800, color: "#EF9F27" },
    sub: { fontSize: 11, color: "#8b949e" },
    body: { maxWidth: 400, margin: "0 auto", padding: "20px 16px 0" },
    card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: "28px 24px", marginTop: 40 },
    inp: { width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 7, padding: "10px 12px", color: "#e6edf3", fontSize: 14, outline: "none", boxSizing: "border-box", marginBottom: 12 },
    btn: (active) => ({ width: "100%", background: active ? "#EF9F27" : "#30363d", color: active ? "#0d1117" : "#8b949e", border: "none", borderRadius: 7, padding: "11px", fontWeight: 800, fontSize: 14, cursor: active ? "pointer" : "default" }),
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.title}>Portal Koordinator</div>
        <div style={S.sub}>PT Alyssa Auto Logistik</div>
      </div>
      <div style={S.body}>
        <div style={S.card}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#EF9F27", marginBottom: 6 }}>Masuk sebagai Koordinator</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 20 }}>Masukkan nama dan password Anda.</div>
          <input style={S.inp} placeholder="Nama koordinator" value={namaDraft} onChange={e => setNamaDraft(e.target.value)} autoFocus />
          <input style={S.inp} type="password" placeholder="Password" value={pwDraft} onChange={e => setPwDraft(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} />
          {err && <div style={{ color: "#f85149", fontSize: 13, marginBottom: 10 }}>{err}</div>}
          <button style={S.btn(!loading && !!namaDraft.trim() && !!pwDraft)} onClick={doLogin} disabled={loading || !namaDraft.trim() || !pwDraft}>
            {loading ? "Masuk..." : "Masuk"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────── Dashboard ────── */
function Dashboard({ kordId, kordNama, onLogout, onChangePassword }) {
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    axios.get(`${API}/koordinator/trips`, { params: { kord_id: kordId } })
      .then(r => setTrips(r.data.items || []))
      .catch(e => setError(e?.response?.data?.detail || "Gagal memuat data"))
      .finally(() => setLoading(false));
  }, [kordId]);

  useEffect(() => { load(); }, [load]);

  const S = {
    root: { minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'Inter','Segoe UI',sans-serif", paddingBottom: 40 },
    header: { background: "#161b22", borderBottom: "1px solid #21262d", padding: "14px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" },
    title: { fontSize: 15, fontWeight: 800, color: "#EF9F27" },
    sub: { fontSize: 11, color: "#8b949e" },
    body: { maxWidth: 560, margin: "0 auto", padding: "20px 16px 0" },
  };

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div>
          <div style={S.title}>Portal Koordinator</div>
          <div style={S.sub}>{kordNama}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onChangePassword} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Ganti Password</button>
          <button onClick={onLogout} style={{ background: "none", border: "1px solid #30363d", color: "#8b949e", borderRadius: 6, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Keluar</button>
        </div>
      </div>
      <div style={S.body}>
        {loading && <div style={{ textAlign: "center", padding: "40px 0", color: "#8b949e" }}>Memuat data trip…</div>}
        {error && <div style={{ background: "#2d1117", border: "1px solid #f85149", borderRadius: 8, padding: "12px 16px", color: "#f85149", marginBottom: 16 }}>{error}</div>}
        {!loading && !error && trips.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#8b949e" }}>
            Tidak ada trip yang ditugaskan ke <b style={{ color: "#e6edf3" }}>{kordNama}</b>.
          </div>
        )}
        {trips.map(t => <TripCard key={t.trip_id} trip={t} />)}
      </div>
    </div>
  );
}

/* ────── Root ────── */
export default function KoordinatorPage() {
  const [kordId, setKordId] = useState(() => { try { return localStorage.getItem(LS_ID) || ""; } catch { return ""; } });
  const [kordNama, setKordNama] = useState(() => { try { return localStorage.getItem(LS_NAMA) || ""; } catch { return ""; } });
  const [firstLogin, setFirstLogin] = useState(() => { try { return localStorage.getItem(LS_FIRST) === "1"; } catch { return false; } });
  const [sopShown, setSopShown] = useState(() => { try { return !localStorage.getItem(LS_SOP); } catch { return false; } });
  const [screen, setScreen] = useState(() => {
    try {
      const id = localStorage.getItem(LS_ID);
      const fl = localStorage.getItem(LS_FIRST) === "1";
      if (!id) return "login";
      if (fl) return "changepassword";
      return "dashboard";
    } catch { return "login"; }
  });

  const handleLogin = ({ id, nama, first_login }) => {
    setKordId(id); setKordNama(nama); setFirstLogin(!!first_login);
    try {
      localStorage.setItem(LS_ID, id);
      localStorage.setItem(LS_NAMA, nama);
      localStorage.setItem(LS_FIRST, first_login ? "1" : "0");
    } catch {}
    if (first_login) {
      setScreen("changepassword");
    } else {
      // Show SOP once
      const sopOk = (() => { try { return !!localStorage.getItem(LS_SOP); } catch { return false; } })();
      if (!sopOk) { setSopShown(true); }
      setScreen("dashboard");
    }
  };

  const handleChangePasswordSuccess = () => {
    setFirstLogin(false);
    try { localStorage.setItem(LS_FIRST, "0"); } catch {}
    // Show SOP if first time
    const sopOk = (() => { try { return !!localStorage.getItem(LS_SOP); } catch { return false; } })();
    if (!sopOk) { setSopShown(true); }
    setScreen("dashboard");
  };

  const handleLogout = () => {
    try { localStorage.removeItem(LS_ID); localStorage.removeItem(LS_NAMA); localStorage.removeItem(LS_FIRST); } catch {}
    setKordId(""); setKordNama(""); setFirstLogin(false);
    setScreen("login");
  };

  const handleSopOk = () => {
    try { localStorage.setItem(LS_SOP, "1"); } catch {}
    setSopShown(false);
  };

  // SOP overlay over dashboard
  if (screen === "dashboard" && sopShown) {
    return <SopModal onOk={handleSopOk} />;
  }

  if (screen === "login") {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === "changepassword") {
    return (
      <ChangePasswordScreen
        kordId={kordId}
        onSuccess={handleChangePasswordSuccess}
        onCancel={firstLogin ? null : () => setScreen("dashboard")}
      />
    );
  }

  return (
    <Dashboard
      kordId={kordId}
      kordNama={kordNama}
      onLogout={handleLogout}
      onChangePassword={() => setScreen("changepassword")}
    />
  );
}
