import { useEffect, useState, useCallback } from "react";
import axios from "axios";

/*
  Nama Kembar (hanya Pemilik): satu perusahaan yang tertulis dengan banyak ejaan
  ("PT. Transkon Jaya, Tbk" / "PT.TRANSKON JAYA,TBK" / ...). Pilih 1 nama resmi, lihat
  pratinjau, lalu gabungkan. Yang berubah hanya tulisan nama di PO, Kontak, dan Daftar Pelanggan;
  invoice yang sudah terbit, harga, dan nominal tidak disentuh.
*/
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN2 = { padding: "8px 12px", borderRadius: 8, border: "1px solid #30363d", background: "#1c2128", color: "#e6edf3", fontWeight: 700, fontSize: 12.5, cursor: "pointer" };

export default function NamaKembarPage() {
  const getHeaders = () => {
    const h = {};
    try {
      const t = localStorage.getItem("aal_user_token");
      if (t) h.Authorization = `Bearer ${t}`;
      h["x-admin-pin"] = localStorage.getItem("aal_admin_pin") || "";
    } catch (e) { /* storage tidak tersedia */ }
    return h;
  };
  const [groups, setGroups] = useState(null);
  const [names, setNames] = useState({});   // key -> nama resmi (input)
  const [plans, setPlans] = useState({});   // key -> hasil pratinjau
  const [msg, setMsg] = useState({ t: "", err: false });
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/nama-kembar`, { headers: getHeaders() });
      const gs = r.data.groups || [];
      setGroups(gs);
      setNames((n) => { const x = { ...n }; gs.forEach((g) => { if (!x[g.key]) x[g.key] = g.saran_nama_resmi; }); return x; });
    } catch (e) {
      setMsg({ t: e.response?.data?.detail || "Gagal memuat (hanya Pemilik yang bisa membuka ini)", err: true });
      setGroups([]);
    }
  }, []); // eslint-disable-line
  useEffect(() => { load(); }, [load]);

  const call = async (g, dry) => {
    setBusy(g.key); setMsg({ t: "", err: false });
    try {
      const r = await axios.post(`${API}/admin/nama-kembar/gabung`, { key: g.key, nama_resmi: names[g.key], dry_run: dry }, { headers: getHeaders() });
      if (dry) setPlans((p) => ({ ...p, [g.key]: r.data }));
      else {
        setMsg({ t: `✓ Digabung jadi "${r.data.nama_resmi}"`, err: false });
        setPlans((p) => { const x = { ...p }; delete x[g.key]; return x; });
        load();
      }
    } catch (e) {
      setMsg({ t: e.response?.data?.detail || "Gagal", err: true });
    } finally { setBusy(""); }
  };
  const apply = (g) => {
    const p = plans[g.key];
    if (!p) return;
    if (!window.confirm(`Gabungkan jadi "${p.nama_resmi}"?\n\n${p.orders_diubah} PO diubah namanya\n${p.kontak_digabung_dihapus} kontak kembar digabung (disimpan di cadangan)\n${p.profil_harga_diubah} profil harga diganti namanya\n\nHarga dan invoice yang sudah terbit tidak berubah.`)) return;
    call(g, false);
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "16px 14px", color: "#e6edf3" }} data-testid="nama-kembar">
      <div style={{ fontSize: 12.5, color: "#8b949e", marginBottom: 12 }}>
        Satu perusahaan tertulis dengan beberapa ejaan. Pilih satu nama resmi, tekan <b>Pratinjau</b>, lalu <b>Gabungkan</b>.
        Yang berubah hanya tulisan nama di PO, Kontak, dan Daftar Pelanggan. Invoice yang sudah terbit, harga, dan nominal tidak disentuh.
      </div>
      {msg.t ? <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: msg.err ? "#f85149" : "#3fb950" }}>{msg.t}</div> : null}
      {groups === null ? <div style={{ color: "#8b949e" }}>Memuat…</div> : null}
      {groups && groups.length === 0 && !msg.err ? <div style={{ color: "#3fb950", fontWeight: 700 }}>✓ Tidak ada nama kembar. Semua sudah rapi.</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {(groups || []).map((g) => {
          const p = plans[g.key];
          return (
            <div key={g.key} style={{ background: "#11161f", border: "1px solid #232a36", borderRadius: 12, padding: 14 }} data-testid={`nk-${g.key}`}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>{g.variants.length} tulisan · {g.total_orders} PO · {g.total_contacts} kontak</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {g.variants.map((v) => (
                  <div key={v.nama} style={{ fontSize: 12.5, color: "#c9d1d9", display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ wordBreak: "break-word" }}>{v.nama || "(kosong)"}</span>
                    <span style={{ color: "#8b949e", whiteSpace: "nowrap" }}>{v.orders} PO · {v.contacts} kontak{v.profiles ? ` · ${v.profiles} profil` : ""}</span>
                  </div>
                ))}
              </div>
              <label style={{ fontSize: 11, color: "#8b949e", fontWeight: 700, textTransform: "uppercase" }}>Nama resmi</label>
              <input style={{ ...I, marginTop: 4 }} value={names[g.key] || ""} onChange={(e) => { setNames({ ...names, [g.key]: e.target.value }); setPlans((x) => { const y = { ...x }; delete y[g.key]; return y; }); }} data-testid={`nk-nama-${g.key}`} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={BTN2} disabled={busy === g.key} onClick={() => call(g, true)} data-testid={`nk-preview-${g.key}`}>🔍 Pratinjau</button>
                {p ? <button style={BTN} disabled={busy === g.key} onClick={() => apply(g)} data-testid={`nk-apply-${g.key}`}>✅ Gabungkan</button> : null}
              </div>
              {p ? (
                <div style={{ marginTop: 10, fontSize: 12.5, background: "#0f1722", border: "1px solid #232a36", borderRadius: 8, padding: "8px 10px" }} data-testid={`nk-plan-${g.key}`}>
                  Akan berubah: <b>{p.orders_diubah}</b> PO diganti namanya · <b>{p.kontak_digabung_dihapus}</b> kontak kembar digabung · <b>{p.profil_harga_diubah}</b> profil harga diganti namanya
                  {p.profil_harga_perlu_manual ? <div style={{ color: "#d29922", marginTop: 4 }}>⚠ Ada {p.profil_harga_perlu_manual} profil harga terpisah. Tidak disentuh, perlu dirapikan manual.</div> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
