import { useEffect, useState, useCallback } from "react";
import axios from "axios";

/*
  Pengaturan Pengguna (admin): daftar pengguna, undang lewat link sekali pakai,
  ubah peran, nonaktifkan, hapus. Pemilik tidak bisa dihapus/dinonaktifkan.
  Tahap 1: pengelolaan akun. Pembatasan menu per peran menyusul (Tahap 2).
*/
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
const L = { fontSize: 11, color: "#8b949e", display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN2 = { padding: "6px 10px", borderRadius: 7, border: "1px solid #30363d", background: "#1c2128", color: "#e6edf3", fontWeight: 700, fontSize: 12, cursor: "pointer" };
const STATUS_TXT = { aktif: ["Aktif", "#3fb950"], undangan: ["Menunggu aktivasi", "#d29922"], nonaktif: ["Nonaktif", "#f85149"] };
const ROLE_HELP = {
  admin_ops_1: "Pesanan (PO), Minta Harga, Supplier, Kalkulator HPP & Daftar Harga. Tanpa keuangan.",
  admin_ops_2: "Route Leg, trip & link driver, Driver, Koordinator, Kendaraan, Master Kapal, tracking, upload manual. Tanpa keuangan.",
  keuangan: "Kas & Bank, biaya, insentif, pembayaran supplier, invoice, laporan. Lainnya hanya lihat.",
  pembaca: "Hanya melihat, tanpa keuangan.",
};
const EMPTY = { email: "", nama: "", role: "admin_ops_1", access_days: "" };

export default function UsersPage() {
  const getHeaders = () => {
    const h = {};
    try {
      const t = localStorage.getItem("aal_user_token");
      if (t) h.Authorization = `Bearer ${t}`;
      h["x-admin-pin"] = localStorage.getItem("aal_admin_pin") || "";
    } catch (e) { /* storage tidak tersedia */ }
    return h;
  };
  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState({});
  const [invitable, setInvitable] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ t: "", err: false });
  const [link, setLink] = useState(null); // { email, url }
  const [enforce, setEnforce] = useState(null); // null = belum dimuat

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/users`, { headers: getHeaders() });
      setItems(r.data.items || []);
      setRoles(r.data.roles || {});
      setInvitable(r.data.invitable || []);
      try {
        const en = await axios.get(`${API}/admin/users/enforce`, { headers: getHeaders() });
        setEnforce(!!en.data.enabled);
      } catch (e) { /* abaikan */ }
    } catch (e) {
      setMsg({ t: e.response?.data?.detail || "Gagal memuat pengguna", err: true });
    }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const fail = (e, fallback) => setMsg({ t: e.response?.data?.detail || fallback, err: true });
  const showLink = (email, path) => setLink({ email, url: `${window.location.origin}${path}` });

  const invite = async () => {
    setBusy(true); setMsg({ t: "", err: false });
    try {
      const body = { email: f.email, nama: f.nama, role: f.role, access_days: f.access_days ? parseInt(f.access_days, 10) : null };
      const r = await axios.post(`${API}/admin/users/invite`, body, { headers: getHeaders() });
      showLink(r.data.user.email, r.data.invite_path);
      setF(EMPTY);
      setMsg({ t: "✓ Undangan dibuat. Kirim link di bawah ke orangnya.", err: false });
      load();
    } catch (e) { fail(e, "Gagal membuat undangan"); } finally { setBusy(false); }
  };

  const reinvite = async (u) => {
    try {
      const r = await axios.post(`${API}/admin/users/${u.user_id}/invite-link`, {}, { headers: getHeaders() });
      showLink(u.email, r.data.invite_path);
      setMsg({ t: "", err: false });
    } catch (e) { fail(e, "Gagal membuat link"); }
  };

  const patch = async (u, body) => {
    try {
      await axios.patch(`${API}/admin/users/${u.user_id}`, body, { headers: getHeaders() });
      setMsg({ t: "✓ Tersimpan", err: false });
      load();
    } catch (e) { fail(e, "Gagal menyimpan"); }
  };

  const remove = async (u) => {
    if (!window.confirm(`Hapus akun ${u.email}? Orang ini langsung tidak bisa masuk lagi.`)) return;
    try {
      await axios.delete(`${API}/admin/users/${u.user_id}`, { headers: getHeaders() });
      setMsg({ t: "✓ Akun dihapus", err: false });
      load();
    } catch (e) { fail(e, "Gagal menghapus"); }
  };

  const toggleEnforce = async () => {
    const next = !enforce;
    const ask = next
      ? "Nyalakan WAJIB LOGIN? Setelah ini semua orang harus masuk dengan akun (atau PIN admin). Pastikan akun Pemilik sudah bisa masuk."
      : "Matikan wajib login? Admin kembali seperti semula (terbuka atau PIN).";
    if (!window.confirm(ask)) return;
    try {
      const r = await axios.put(`${API}/admin/users/enforce`, { enabled: next }, { headers: getHeaders() });
      setEnforce(!!r.data.enabled);
      setMsg({ t: next ? "✓ Wajib login aktif" : "✓ Wajib login dimatikan", err: false });
    } catch (e) { fail(e, "Gagal mengubah"); }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setMsg({ t: "✓ Link disalin", err: false }); }
    catch (e) { window.prompt("Salin link ini:", text); }
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 14px", color: "#e6edf3" }} data-testid="users-page">
      {enforce !== null ? (
        <div style={{ background: enforce ? "#0f2417" : "#2a1d0a", border: `1px solid ${enforce ? "#1f6f3f" : "#6b4a14"}`, borderRadius: 12, padding: 14, marginBottom: 12 }} data-testid="usr-enforce-box">
          <div style={{ fontWeight: 800 }}>{enforce ? "🔒 Wajib login akun: AKTIF" : "🔓 Wajib login akun: belum aktif"}</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
            {enforce
              ? "Semua orang harus masuk dengan akun atau PIN admin. Peran membatasi menu dan data yang bisa dibuka."
              : "Admin masih bisa dibuka tanpa akun (seperti sekarang). Nyalakan setelah akun Pemilik bisa masuk lewat halaman Masuk."}
          </div>
          <button style={{ ...BTN2, marginTop: 8 }} onClick={toggleEnforce} data-testid="usr-enforce-toggle">{enforce ? "Matikan" : "Nyalakan wajib login"}</button>
        </div>
      ) : null}

      <div style={{ background: "#11161f", border: "1px solid #232a36", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>Undang pengguna</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          <div><label style={L}>Email</label><input style={I} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="nama@gmail.com" data-testid="usr-email" /></div>
          <div><label style={L}>Nama</label><input style={I} value={f.nama} onChange={(e) => setF({ ...f, nama: e.target.value })} placeholder="Nama pengguna" data-testid="usr-nama" /></div>
          <div><label style={L}>Peran</label>
            <select style={I} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="usr-role">
              {invitable.map((r) => <option key={r} value={r}>{roles[r] || r}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: "1/-1", fontSize: 11.5, color: "#8b949e", marginTop: -4 }} data-testid="usr-role-help">{ROLE_HELP[f.role] || ""} Pelanggan &amp; supplier baru hanya bisa diinput Pemilik.</div>
          <div><label style={L}>Batas akses (hari, opsional)</label><input style={I} inputMode="numeric" value={f.access_days} onChange={(e) => setF({ ...f, access_days: e.target.value.replace(/\D/g, "") })} placeholder="kosong = tanpa batas" data-testid="usr-days" /></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={invite} data-testid="usr-invite">✉️ Buat link undangan</button>
          {msg.t ? <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.err ? "#f85149" : "#3fb950" }}>{msg.t}</span> : null}
        </div>
        <div style={{ fontSize: 11.5, color: "#8b949e", marginTop: 8 }}>
          Link berlaku 7 hari dan hanya bisa dipakai sekali. Orangnya membuat password sendiri, jadi password tidak pernah lewat sini.
        </div>
      </div>

      {link ? (
        <div style={{ marginTop: 12, background: "#0f2417", border: "1px solid #1f6f3f", borderRadius: 12, padding: 14 }} data-testid="usr-link-box">
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Link untuk {link.email}</div>
          <input style={{ ...I, fontFamily: "monospace", fontSize: 12 }} readOnly value={link.url} onFocus={(e) => e.target.select()} data-testid="usr-link" />
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button style={BTN2} onClick={() => copy(link.url)}>📋 Salin</button>
            <a style={{ ...BTN2, textDecoration: "none", display: "inline-block" }} target="_blank" rel="noreferrer"
              href={`https://wa.me/?text=${encodeURIComponent(`Halo, ini link untuk membuat akun Alyssa Auto Logistik (berlaku 7 hari, sekali pakai): ${link.url}`)}`}>💬 Kirim lewat WhatsApp</a>
            <button style={BTN2} onClick={() => setLink(null)}>Tutup</button>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 14, fontSize: 12, color: "#8b949e", fontWeight: 700 }}>{items.length} pengguna</div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((u) => {
          const st = STATUS_TXT[u.status] || [u.status, "#8b949e"];
          return (
            <div key={u.user_id} style={{ background: "#11161f", border: "1px solid #232a36", borderRadius: 10, padding: "10px 12px" }} data-testid={`usr-row-${u.user_id}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5 }}>{u.nama || "(tanpa nama)"} {u.is_owner ? <span style={{ fontSize: 11, color: "#EF9F27" }}>· Pemilik</span> : null}</div>
                  <div style={{ fontSize: 12, color: "#8b949e", wordBreak: "break-all" }}>{u.email}</div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: st[1] }}>{st[0]}</div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                {u.is_owner ? (
                  <span style={{ fontSize: 12, color: "#8b949e" }}>Peran: Pemilik (tetap)</span>
                ) : (
                  <select style={{ ...I, width: "auto", padding: "6px 8px", fontSize: 12 }} value={u.role} onChange={(e) => patch(u, { role: e.target.value })} data-testid={`usr-role-${u.user_id}`}>
                    {invitable.map((r) => <option key={r} value={r}>{roles[r] || r}</option>)}
                  </select>
                )}
                {!u.has_password && u.status !== "nonaktif" ? <button style={BTN2} onClick={() => reinvite(u)}>🔗 {u.is_owner ? "Link aktivasi Pemilik" : "Buat ulang link"}</button> : null}
                {u.has_password && !u.is_owner && u.status !== "nonaktif" ? <button style={BTN2} onClick={() => reinvite(u)} data-testid={`usr-reset-${u.user_id}`}>🔑 Reset password</button> : null}
                {!u.is_owner && u.status === "aktif" ? <button style={BTN2} onClick={() => patch(u, { status: "nonaktif" })}>⏸ Nonaktifkan</button> : null}
                {!u.is_owner && u.status === "nonaktif" ? <button style={BTN2} onClick={() => patch(u, { status: "aktif" })}>▶ Aktifkan</button> : null}
                {!u.is_owner ? <button style={{ ...BTN2, color: "#f85149" }} onClick={() => remove(u)} data-testid={`usr-del-${u.user_id}`}>🗑 Hapus</button> : null}
              </div>
              {u.access_expires_at ? <div style={{ fontSize: 11, color: "#8b949e", marginTop: 6 }}>Akses sampai {new Date(u.access_expires_at).toLocaleDateString("id-ID")}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
