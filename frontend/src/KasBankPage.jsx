import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";

/*
  Kas & Bank: akun (bank / kas tunai / dompet seperti Saldo Flip), saldo, mutasi, pindah saldo.
  Saldo = saldo awal + masuk - keluar (dihitung server). Tidak ada hapus: koreksi = batalkan (void) dengan alasan.
*/
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;
const rp = (n) => (n < 0 ? "-" : "") + "Rp " + Math.abs(Number(n) || 0).toLocaleString("id-ID");
const media = (u) => (!u ? "" : /^https?:\/\//.test(u) ? (u.includes("/storage/v1/object/public/") ? `${API}/media?u=${encodeURIComponent(u)}` : u) : `${BACKEND_URL}${u}`);
const JENIS = [["bank", "Bank"], ["kas", "Kas tunai"], ["ewallet", "Dompet / e-wallet"]];

const card = { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 14 };
const inp = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
const lbl = { fontSize: 11, color: "#8b949e", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", display: "block", marginBottom: 4 };
const btn = (bg, fg) => ({ padding: "8px 14px", borderRadius: 8, border: "none", background: bg, color: fg, fontWeight: 800, fontSize: 12.5, cursor: "pointer" });

export default function KasBankPage() {
  const headers = useMemo(() => ({ "x-admin-pin": typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "" }), []);
  const [accs, setAccs] = useState({ items: [], total_saldo: 0 });
  const [sel, setSel] = useState("");
  const [tx, setTx] = useState(null);
  const [form, setForm] = useState(null);       // { mode: "akun"|"masuk"|"keluar"|"pindah", ... }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ t: "", err: false });

  const loadAccs = useCallback(async () => {
    try { const r = await axios.get(`${API}/admin/kas/accounts`, { headers }); setAccs(r.data); return r.data; }
    catch (e) { setMsg({ t: e.response?.data?.detail || "Gagal memuat akun", err: true }); return null; }
  }, [headers]);
  const loadTx = useCallback(async (id) => {
    if (!id) { setTx(null); return; }
    try { const r = await axios.get(`${API}/admin/kas/accounts/${id}/txns`, { headers }); setTx(r.data); }
    catch (e) { setMsg({ t: e.response?.data?.detail || "Gagal memuat mutasi", err: true }); }
  }, [headers]);
  useEffect(() => { loadAccs(); }, [loadAccs]);
  useEffect(() => { loadTx(sel); }, [sel, loadTx]);

  const refresh = async () => { await loadAccs(); await loadTx(sel); };
  const err = (e, d) => setMsg({ t: e.response?.data?.detail || d, err: true });

  const submit = async () => {
    setBusy(true); setMsg({ t: "", err: false });
    try {
      if (form.mode === "akun") {
        const r = await axios.post(`${API}/admin/kas/accounts`, { nama: form.nama, jenis: form.jenis, saldo_awal: form.saldo_awal }, { headers });
        setSel(r.data.id);
      } else if (form.mode === "pindah") {
        const fd = new FormData();
        fd.append("from_id", form.from_id); fd.append("to_id", form.to_id); fd.append("amount", form.amount || "");
        fd.append("tanggal", form.tanggal || ""); fd.append("keterangan", form.keterangan || ""); fd.append("biaya_admin", form.biaya_admin || "0");
        if (form.file) fd.append("bukti", form.file);
        await axios.post(`${API}/admin/kas/transfer`, fd, { headers, timeout: 60000 });
      } else {
        const fd = new FormData();
        fd.append("account_id", sel); fd.append("arah", form.mode); fd.append("amount", form.amount || "");
        fd.append("tanggal", form.tanggal || ""); fd.append("keterangan", form.keterangan || "");
        if (form.file) fd.append("bukti", form.file);
        await axios.post(`${API}/admin/kas/txns`, fd, { headers, timeout: 60000 });
      }
      setForm(null); setMsg({ t: "Tersimpan", err: false }); await refresh();
    } catch (e) { err(e, "Gagal menyimpan"); }
    finally { setBusy(false); }
  };

  const doVoid = async (t) => {
    const alasan = window.prompt("Alasan membatalkan mutasi ini:");
    if (alasan == null) return;
    try { await axios.post(`${API}/admin/kas/txns/${t.id}/void`, { alasan }, { headers }); setMsg({ t: "Mutasi dibatalkan", err: false }); await refresh(); }
    catch (e) { err(e, "Gagal membatalkan"); }
  };

  const F = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const active = accs.items.find((a) => a.id === sel);
  const title = { akun: "Akun baru", masuk: "Catat uang masuk", keluar: "Catat uang keluar", pindah: "Pindah saldo antar akun" };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", color: "#e6edf3" }} data-testid="kas-page">
      <p style={{ fontSize: 12.5, color: "#8b949e", margin: "0 0 12px" }}>
        Saldo bank, kas, dan dompet (mis. Saldo Flip). Top up Flip = <b>Pindah saldo</b> dari bank ke Saldo Flip. Transfer insentif driver lewat Flip otomatis mengurangi Saldo Flip.
      </p>

      <div style={{ ...card, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div><div style={lbl}>Total saldo semua akun</div><div style={{ fontSize: 22, fontWeight: 900 }} data-testid="kas-total">{rp(accs.total_saldo)}</div></div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={btn("#EF9F27", "#1a1208")} onClick={() => setForm({ mode: "akun", nama: "", jenis: "bank", saldo_awal: "" })} data-testid="kas-btn-akun">+ Akun</button>
          <button type="button" style={btn("#1D4ED8", "#fff")} disabled={accs.items.length < 2} onClick={() => setForm({ mode: "pindah", from_id: sel || accs.items[0]?.id, to_id: "", amount: "", tanggal: "", keterangan: "Top up", biaya_admin: "" })} data-testid="kas-btn-pindah">Pindah Saldo</button>
        </div>
      </div>

      {msg.t ? <div role="status" style={{ ...card, marginBottom: 12, color: msg.err ? "#d2a8ff" : "#79c0ff" }} data-testid="kas-msg">{msg.t}</div> : null}

      {form ? (
        <div style={{ ...card, marginBottom: 12, borderColor: "#1D4ED8" }} data-testid="kas-form">
          <div style={{ fontWeight: 800, marginBottom: 10 }}>{title[form.mode]}{form.mode !== "akun" && form.mode !== "pindah" && active ? ` · ${active.nama}` : ""}</div>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {form.mode === "akun" ? (
              <>
                <label><span style={lbl}>Nama akun</span><input style={inp} value={form.nama} onChange={F("nama")} placeholder="mis. BCA PT Alyssa" data-testid="kas-f-nama" /></label>
                <label><span style={lbl}>Jenis</span><select style={inp} value={form.jenis} onChange={F("jenis")} data-testid="kas-f-jenis">{JENIS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span style={lbl}>Saldo awal (Rp)</span><input style={inp} inputMode="numeric" value={form.saldo_awal} onChange={F("saldo_awal")} placeholder="0" data-testid="kas-f-saldo" /></label>
              </>
            ) : (
              <>
                {form.mode === "pindah" ? (
                  <>
                    <label><span style={lbl}>Dari akun</span><select style={inp} value={form.from_id} onChange={F("from_id")} data-testid="kas-f-from">{accs.items.map((a) => <option key={a.id} value={a.id}>{a.nama}</option>)}</select></label>
                    <label><span style={lbl}>Ke akun</span><select style={inp} value={form.to_id} onChange={F("to_id")} data-testid="kas-f-to"><option value="">— pilih —</option>{accs.items.filter((a) => a.id !== form.from_id).map((a) => <option key={a.id} value={a.id}>{a.nama}</option>)}</select></label>
                  </>
                ) : null}
                <label><span style={lbl}>Nominal (Rp)</span><input style={inp} inputMode="numeric" value={form.amount} onChange={F("amount")} data-testid="kas-f-amount" /></label>
                <label><span style={lbl}>Tanggal (kosong = hari ini)</span><input type="date" style={inp} value={form.tanggal || ""} onChange={F("tanggal")} /></label>
                {form.mode === "pindah" ? <label><span style={lbl}>Biaya admin (opsional)</span><input style={inp} inputMode="numeric" value={form.biaya_admin} onChange={F("biaya_admin")} data-testid="kas-f-fee" /></label> : null}
                <label style={{ gridColumn: "1 / -1" }}><span style={lbl}>Keterangan</span><input style={inp} value={form.keterangan} onChange={F("keterangan")} data-testid="kas-f-ket" /></label>
                <label style={{ gridColumn: "1 / -1" }}><span style={lbl}>Bukti (JPG/PNG/PDF, opsional)</span><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files && e.target.files[0] }))} style={{ fontSize: 12.5, color: "#c9d1d9" }} /></label>
              </>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" disabled={busy} onClick={submit} style={btn("#1D4ED8", "#fff")} data-testid="kas-f-submit">{busy ? "Menyimpan…" : "Simpan"}</button>
            <button type="button" onClick={() => setForm(null)} style={btn("#21262d", "#c9d1d9")}>Batal</button>
          </div>
        </div>
      ) : null}

      {accs.items.length === 0 ? <div style={{ ...card, textAlign: "center", color: "#8b949e" }} data-testid="kas-empty">Belum ada akun. Tap "+ Akun" untuk mulai (mis. BCA PT, Mandiri pribadi, Saldo Flip, Kas tunai).</div> : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginBottom: 14 }} data-testid="kas-accounts">
          {accs.items.map((a) => (
            <button key={a.id} type="button" onClick={() => setSel(a.id)} data-testid={`kas-acc-${a.id}`}
              style={{ ...card, textAlign: "left", cursor: "pointer", color: "#e6edf3", borderColor: sel === a.id ? "#EF9F27" : "#30363d" }}>
              <div style={{ fontSize: 12, color: "#8b949e", fontWeight: 700 }}>{(JENIS.find(([k]) => k === a.jenis) || [, a.jenis])[1]}{a.sistem ? " · otomatis" : ""}</div>
              <div style={{ fontWeight: 800, fontSize: 15, margin: "2px 0" }}>{a.nama}</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: a.saldo < 0 ? "#d2a8ff" : "#e6edf3" }} data-testid={`kas-saldo-${a.id}`}>{rp(a.saldo)}</div>
            </button>
          ))}
        </div>
      )}

      {active && tx ? (
        <div data-testid="kas-mutasi">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 800 }}>Mutasi · {active.nama}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={btn("#21262d", "#79c0ff")} onClick={() => setForm({ mode: "masuk", amount: "", tanggal: "", keterangan: "" })} data-testid="kas-btn-masuk">+ Masuk</button>
              <button type="button" style={btn("#21262d", "#d2a8ff")} onClick={() => setForm({ mode: "keluar", amount: "", tanggal: "", keterangan: "" })} data-testid="kas-btn-keluar">+ Keluar</button>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: "#8b949e", marginBottom: 8 }}>Saldo awal {rp(active.saldo_awal)}</div>
          {tx.items.length === 0 ? <div style={{ ...card, color: "#8b949e", textAlign: "center" }}>Belum ada mutasi.</div> : (
            <div style={{ display: "grid", gap: 8 }}>
              {tx.items.map((t) => (
                <div key={t.id} style={{ ...card, padding: 12 }} data-testid={`kas-tx-${t.id}`} data-arah={t.arah}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <b style={{ color: t.arah === "masuk" ? "#79c0ff" : "#d2a8ff" }}>{t.arah === "masuk" ? "+" : "−"} {rp(t.amount)}</b>
                    <span style={{ fontSize: 12.5, color: "#8b949e" }}>{t.tanggal} · saldo {rp(t.saldo_setelah)}</span>
                  </div>
                  <div style={{ fontSize: 13, marginTop: 3 }}>{t.keterangan || "—"} {t.kategori && t.kategori !== "manual" ? <span style={{ color: "#8b949e" }}>· {t.kategori.replace("_", " ")}</span> : null}</div>
                  <div style={{ marginTop: 6, display: "flex", gap: 10, alignItems: "center" }}>
                    {t.bukti_url ? <a href={media(t.bukti_url)} target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff", fontSize: 12.5 }}>Lihat bukti</a> : null}
                    {!t.key ? <button type="button" onClick={() => doVoid(t)} style={{ ...btn("#21262d", "#c9d1d9"), padding: "4px 10px" }} data-testid={`kas-void-${t.id}`}>Batalkan</button> : <span style={{ fontSize: 12, color: "#8b949e" }}>otomatis dari Insentif Driver</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
