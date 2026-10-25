import { useEffect, useState } from "react";
import axios from "axios";

/* Halaman publik akun: /undangan/<token> (buat password) dan /masuk (login).
   Tampilan terang, kartu putih di tengah, field Email/Password dengan ikon mata. */
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const TOKEN_KEY = "aal_user_token";

const WRAP = { minHeight: "100vh", background: "#f3f5f9", color: "#1f2937", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", boxSizing: "border-box" };
const CARD = { width: "100%", maxWidth: 400, background: "#fff", borderRadius: 10, boxShadow: "0 1px 3px rgba(16,24,40,.08), 0 8px 24px rgba(16,24,40,.06)", padding: "32px 28px 28px", boxSizing: "border-box" };
const H1 = { fontSize: 28, fontWeight: 700, margin: "28px 0 24px", color: "#111827" };
const LBL = { display: "block", fontSize: 15, fontWeight: 600, margin: "0 0 8px", color: "#111827" };
const INPUT = { width: "100%", boxSizing: "border-box", height: 48, border: "1px solid #d1d5db", borderRadius: 6, padding: "0 14px", fontSize: 16, color: "#111827", background: "#fff", outline: "none", fontFamily: "inherit" };
const BTN = { width: "100%", height: 48, marginTop: 8, border: "none", borderRadius: 6, background: "#0b5ec2", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const LINK = { color: "#1553cf", textDecoration: "none", fontSize: 16, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 };
const ERR = { color: "#b42318", background: "#fef3f2", border: "1px solid #fecdca", borderRadius: 6, padding: "10px 12px", fontSize: 14, margin: "0 0 14px" };
const saveToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* abaikan */ } };

function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <img src="/logo.png" alt="Alyssa Auto Logistik" width={52} height={52} style={{ objectFit: "contain" }} />
      <div style={{ lineHeight: 1.1 }}>
        <div style={{ fontSize: 13, color: "#6b7280", fontWeight: 600, letterSpacing: 0.3 }}>PT Alyssa</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#111827" }}>Auto Logistik</div>
      </div>
    </div>
  );
}

function Shell({ children, testid }) {
  return (
    <div style={WRAP}>
      <div style={CARD} data-testid={testid}>{children}</div>
      <div style={{ marginTop: 28, fontSize: 13, color: "#6b7280" }}>Alyssa Auto Logistik · Internal</div>
    </div>
  );
}

function Field({ label, type = "text", value, onChange, testid, autoComplete, readOnly, autoFocus }) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={LBL}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          style={{ ...INPUT, paddingRight: isPw ? 48 : 14, background: readOnly ? "#f3f4f6" : "#fff" }}
          type={isPw && show ? "text" : type} value={value} onChange={onChange} readOnly={readOnly}
          autoComplete={autoComplete} autoFocus={autoFocus} data-testid={testid}
          onFocus={(e) => { e.target.style.borderColor = "#0b5ec2"; e.target.style.boxShadow = "0 0 0 2px rgba(11,94,194,.15)"; }}
          onBlur={(e) => { e.target.style.borderColor = "#d1d5db"; e.target.style.boxShadow = "none"; }}
        />
        {isPw ? (
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
            style={{ position: "absolute", right: 6, top: 6, width: 36, height: 36, border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "#4b5563" }}>
            {show ? "🙈" : "👁️"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function InvitePage() {
  const token = window.location.pathname.split("/undangan/")[1]?.split("?")[0] || "";
  const [info, setInfo] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | bad | done
  const [nama, setNama] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    axios.get(`${API}/auth/invite/${encodeURIComponent(token)}`)
      .then((r) => { setInfo(r.data); setNama(r.data.nama || ""); setState("ok"); })
      .catch(() => setState("bad"));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    if (pw.length < 8) { setErr("Password minimal 8 karakter"); return; }
    if (pw !== pw2) { setErr("Konfirmasi password tidak sama"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/auth/accept-invite`, { token, password: pw, nama });
      saveToken(r.data.token);
      setState("done");
    } catch (ex) { setErr(ex.response?.data?.detail || "Gagal membuat akun"); } finally { setBusy(false); }
  };

  return (
    <Shell testid="invite-page">
      <Brand />
      {state === "loading" ? <p style={{ marginTop: 28, color: "#6b7280" }}>Memeriksa link…</p> : null}
      {state === "bad" ? <p style={{ ...ERR, marginTop: 28 }}>Link undangan tidak valid atau sudah kedaluwarsa. Minta link baru ke Pemilik.</p> : null}
      {state === "done" ? (
        <div>
          <h1 style={H1}>Akun aktif ✓</h1>
          <p style={{ color: "#4b5563", fontSize: 15, margin: "0 0 20px" }}>Password sudah tersimpan. Lain kali masuk lewat halaman Masuk dengan email dan password ini.</p>
          <button style={BTN} onClick={() => { window.location.href = "/admin"; }}>Ke dashboard</button>
        </div>
      ) : null}
      {state === "ok" ? (
        <form onSubmit={submit}>
          <h1 style={H1}>Buat password</h1>
          <p style={{ color: "#4b5563", fontSize: 15, margin: "-12px 0 20px" }}>Akun {info.role_label}</p>
          <Field label="Email" value={info.email} readOnly onChange={() => {}} />
          <Field label="Nama" value={nama} onChange={(e) => setNama(e.target.value)} testid="inv-nama" />
          <Field label="Password (min. 8 karakter)" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} testid="inv-pw" />
          <Field label="Ulangi password" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} testid="inv-pw2" />
          {err ? <div style={ERR}>{err}</div> : null}
          <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} type="submit" data-testid="inv-submit">Buat akun</button>
        </form>
      ) : null}
    </Shell>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lupa, setLupa] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await axios.post(`${API}/auth/login`, { email, password: pw });
      saveToken(r.data.token);
      window.location.href = "/admin";
    } catch (ex) { setErr(ex.response?.data?.detail || "Gagal masuk"); } finally { setBusy(false); }
  };

  return (
    <Shell testid="login-page">
      <Brand />
      <form onSubmit={submit}>
        <h1 style={H1}>Masuk</h1>
        <Field label="Email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} testid="login-email" />
        <Field label="Password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} testid="login-pw" />
        {err ? <div style={ERR} data-testid="login-err">{err}</div> : null}
        <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} type="submit" data-testid="login-submit">Masuk</button>
      </form>
      <div style={{ borderTop: "1px solid #e5e7eb", margin: "24px 0 18px" }} />
      <div style={{ textAlign: "center" }}>
        <button type="button" style={LINK} onClick={() => setLupa((v) => !v)} data-testid="login-lupa">Lupa password</button>
        <span style={{ color: "#9ca3af", margin: "0 10px" }}>•</span>
        <a href="/admin?pin=1" style={{ ...LINK, fontSize: 14, color: "#6b7280" }} data-testid="login-pin-darurat">PIN darurat</a>
      </div>
      {lupa ? (
        <p style={{ marginTop: 14, fontSize: 14, color: "#4b5563", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 6, padding: "10px 12px" }} data-testid="login-lupa-info">
          Hubungi Pemilik untuk mengatur ulang password. Pemilik akan mengirim link baru lewat WhatsApp.
        </p>
      ) : null}
    </Shell>
  );
}
