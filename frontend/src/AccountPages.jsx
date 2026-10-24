import { useEffect, useState } from "react";
import axios from "axios";

/* Halaman publik akun: /undangan/<token> (buat password) dan /masuk (login). */
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const TOKEN_KEY = "aal_user_token";

const WRAP = { minHeight: "100vh", background: "#0d1117", color: "#e6edf3", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: "inherit" };
const CARD = { width: "100%", maxWidth: 380, background: "#11161f", border: "1px solid #232a36", borderRadius: 14, padding: 20, boxSizing: "border-box" };
const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "11px 12px", color: "#e6edf3", fontSize: 15, outline: "none", width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
const L = { fontSize: 11, color: "#8b949e", display: "block", margin: "12px 0 4px", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { width: "100%", marginTop: 16, padding: "12px 16px", borderRadius: 9, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 15, cursor: "pointer" };

const saveToken = (t) => { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) { /* abaikan */ } };

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

  const submit = async () => {
    setErr("");
    if (pw.length < 8) { setErr("Password minimal 8 karakter"); return; }
    if (pw !== pw2) { setErr("Konfirmasi password tidak sama"); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API}/auth/accept-invite`, { token, password: pw, nama });
      saveToken(r.data.token);
      setState("done");
    } catch (e) { setErr(e.response?.data?.detail || "Gagal membuat akun"); } finally { setBusy(false); }
  };

  return (
    <div style={WRAP}><div style={CARD} data-testid="invite-page">
      <div style={{ fontWeight: 800, fontSize: 18 }}>Alyssa Auto Logistik</div>
      {state === "loading" ? <div style={{ marginTop: 14, color: "#8b949e" }}>Memeriksa link…</div> : null}
      {state === "bad" ? <div style={{ marginTop: 14, color: "#f85149" }}>Link undangan tidak valid atau sudah kedaluwarsa. Minta link baru ke Pemilik.</div> : null}
      {state === "done" ? (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: "#3fb950", fontWeight: 800 }}>✓ Akun aktif</div>
          <div style={{ color: "#8b949e", fontSize: 13, marginTop: 6 }}>Password sudah tersimpan. Lain kali masuk lewat halaman Masuk dengan email dan password ini.</div>
          <button style={BTN} onClick={() => { window.location.href = "/admin"; }}>Ke dashboard</button>
        </div>
      ) : null}
      {state === "ok" ? (
        <div>
          <div style={{ color: "#8b949e", fontSize: 13, marginTop: 6 }}>Buat password untuk akun {info.role_label}.</div>
          <label style={L}>Email</label><input style={{ ...I, opacity: 0.7 }} readOnly value={info.email} />
          <label style={L}>Nama</label><input style={I} value={nama} onChange={(e) => setNama(e.target.value)} data-testid="inv-nama" />
          <label style={L}>Password (min. 8 karakter)</label><input style={I} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="inv-pw" />
          <label style={L}>Ulangi password</label><input style={I} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} data-testid="inv-pw2" />
          {err ? <div style={{ color: "#f85149", fontSize: 13, marginTop: 10 }}>{err}</div> : null}
          <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={submit} data-testid="inv-submit">Buat akun</button>
        </div>
      ) : null}
    </div></div>
  );
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
    <div style={WRAP}><form style={CARD} onSubmit={submit} data-testid="login-page">
      <div style={{ fontWeight: 800, fontSize: 18 }}>Masuk</div>
      <label style={L}>Email</label><input style={I} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" />
      <label style={L}>Password</label><input style={I} type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="login-pw" />
      {err ? <div style={{ color: "#f85149", fontSize: 13, marginTop: 10 }}>{err}</div> : null}
      <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} type="submit" data-testid="login-submit">Masuk</button>
    </form></div>
  );
}
