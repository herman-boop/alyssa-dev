import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { DOC_ENTITIES, DEFAULT_ENTITY_ID } from "./docTheme";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const C = {
  bg: "#0a0e14", card: "#0e1420", card2: "#111826", line: "#1a2130", ink: "#e6edf3",
  mute: "#8b949e", gold: "#EF9F27", blue: "#58a6ff", green: "#3fb950", red: "#f85149",
};
const I = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontSize: 13 };
const L = { fontSize: 11, fontWeight: 700, color: C.mute, marginBottom: 4, display: "block", letterSpacing: .3 };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: C.gold, color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN_GHOST = { padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "none", color: C.ink, fontWeight: 700, fontSize: 12.5, cursor: "pointer" };

const ENTITY_OPTS = Object.values(DOC_ENTITIES).map((e) => ({ id: e.id, name: e.footerName || e.name }));
const fRp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const fDate = (s) => { try { return new Date(`${s}T00:00:00`).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); } catch { return s || "—"; } };
const todayStr = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD lokal
const entityName = (id) => (DOC_ENTITIES[id]?.footerName) || id || "—";

export default function ExpensesPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = useMemo(() => ({ "x-admin-pin": adminPin }), [adminPin]);

  const [cats, setCats] = useState([]);
  const [items, setItems] = useState([]);
  const [totalActive, setTotalActive] = useState(0);
  const [summary, setSummary] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // filter
  const [fEntity, setFEntity] = useState("all");
  const [fDari, setFDari] = useState("");
  const [fSampai, setFSampai] = useState("");
  const [fKat, setFKat] = useState("");

  // form create
  const blankForm = () => ({ tanggal: todayStr(), entity_id: DEFAULT_ENTITY_ID, kategori: "", deskripsi: "", nominal: "", metode: "Transfer", referensi: "" });
  const [form, setForm] = useState(blankForm());
  const [editId, setEditId] = useState(null);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 2600); };
  const onlyDigits = (s) => String(s || "").replace(/\D/g, "");

  const loadCats = useCallback(async () => {
    try { const r = await axios.get(`${API}/admin/expense-categories`, { headers }); setCats(r.data.items || []); } catch {}
  }, [headers]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const params = { status: "active" };
      if (fEntity !== "all") params.entity_id = fEntity;
      if (fDari) params.date_from = fDari;
      if (fSampai) params.date_to = fSampai;
      if (fKat) params.kategori = fKat;
      const [lst, sum] = await Promise.all([
        axios.get(`${API}/admin/expenses`, { params, headers }),
        axios.get(`${API}/admin/expenses/summary`, { params: { entity_id: params.entity_id, date_from: params.date_from, date_to: params.date_to }, headers }),
      ]);
      setItems(lst.data.items || []); setTotalActive(lst.data.total_active || 0);
      setSummary(sum.data);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal memuat"); }
    finally { setBusy(false); }
  }, [headers, fEntity, fDari, fSampai, fKat]);

  useEffect(() => { loadCats(); }, [loadCats]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    const nominal = parseInt(onlyDigits(form.nominal) || "0", 10);
    if (!form.entity_id) { flash("Pilih PT/CV dulu"); return; }
    if (!form.kategori.trim()) { flash("Pilih/isi kategori dulu"); return; }
    if (nominal <= 0) { flash("Isi nominal dulu"); return; }
    setBusy(true);
    try {
      const body = { ...form, nominal };
      if (editId) await axios.patch(`${API}/admin/expenses/${editId}`, body, { headers });
      else await axios.post(`${API}/admin/expenses`, body, { headers });
      setForm(blankForm()); setEditId(null);
      flash(editId ? "✓ Perubahan disimpan" : "✓ Biaya dicatat");
      await load();
    } catch (e) { flash(e?.response?.data?.detail || "Gagal menyimpan"); }
    finally { setBusy(false); }
  };

  const startEdit = (e) => {
    setEditId(e.id);
    setForm({ tanggal: e.tanggal || todayStr(), entity_id: e.entity_id || DEFAULT_ENTITY_ID, kategori: e.kategori || "",
      deskripsi: e.deskripsi || "", nominal: String(e.nominal || ""), metode: e.metode || "Transfer", referensi: e.referensi || "" });
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch {}
  };

  const voidExpense = async (e) => {
    const reason = window.prompt(`Batalkan (void) biaya "${e.kategori}" ${fRp(e.nominal)}?\n\nData tidak dihapus (tetap tersimpan sebagai riwayat/audit). Alasan:`, "");
    if (reason === null) return;
    setBusy(true);
    try { await axios.post(`${API}/admin/expenses/${e.id}/void`, { reason }, { headers }); flash("✓ Biaya dibatalkan (void)"); await load(); }
    catch (err) { flash(err?.response?.data?.detail || "Gagal void"); }
    finally { setBusy(false); }
  };

  const addCategory = async () => {
    const nama = window.prompt("Nama kategori baru (mis. Parkir & Tol Kantor):", "");
    if (!nama || !nama.trim()) return;
    try { await axios.post(`${API}/admin/expense-categories`, { nama: nama.trim() }, { headers }); await loadCats(); flash("✓ Kategori ditambah"); }
    catch (e) { flash(e?.response?.data?.detail || "Gagal tambah kategori"); }
  };

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", color: C.ink }}>
      {msg && <div style={{ position: "sticky", top: 8, zIndex: 5, background: C.card2, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 13, fontWeight: 700 }}>{msg}</div>}

      <div style={{ fontSize: 12, color: C.mute, marginBottom: 14 }}>
        Biaya operasional perusahaan yang <b style={{ color: C.ink }}>tidak melekat ke satu order</b> (gaji, listrik, internet, sewa, dll).
        Terpisah dari HPP/Cost of Sales — tidak dihitung dobel.
      </div>

      {/* Ringkasan */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: "1 1 180px", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
          <div style={{ fontSize: 11, color: C.mute, fontWeight: 700 }}>TOTAL BIAYA (filter aktif)</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: C.gold, marginTop: 4 }}>{fRp(totalActive)}</div>
        </div>
        {summary && Object.keys(summary.per_entity || {}).map((eid) => (
          <div key={eid} style={{ flex: "1 1 160px", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 11, color: C.mute, fontWeight: 700 }}>{entityName(eid).toUpperCase()}</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{fRp(summary.per_entity[eid])}</div>
          </div>
        ))}
      </div>

      {/* Form input / edit */}
      <div style={{ background: C.card, border: `1px solid ${editId ? C.gold : C.line}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 12 }}>{editId ? "✏️ Koreksi Biaya" : "➕ Catat Biaya Baru"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <label>{<span style={L}>Tanggal</span>}<input type="date" style={I} value={form.tanggal} onChange={(e) => setForm({ ...form, tanggal: e.target.value })} data-testid="exp-tanggal" /></label>
          <label>{<span style={L}>Perusahaan (PT/CV)</span>}
            <select style={I} value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} data-testid="exp-entity">
              {ENTITY_OPTS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
          <label>{<span style={L}>Kategori</span>}
            <select style={I} value={form.kategori} onChange={(e) => { if (e.target.value === "__add") { addCategory(); return; } setForm({ ...form, kategori: e.target.value }); }} data-testid="exp-kategori">
              <option value="">— pilih —</option>
              {cats.map((c) => <option key={c.id} value={c.nama}>{c.nama}</option>)}
              <option value="__add">+ Tambah kategori…</option>
            </select>
          </label>
          <label>{<span style={L}>Nominal</span>}<input inputMode="numeric" style={I} value={form.nominal ? Number(onlyDigits(form.nominal)).toLocaleString("id-ID") : ""} onChange={(e) => setForm({ ...form, nominal: onlyDigits(e.target.value) })} placeholder="mis. 1.500.000" data-testid="exp-nominal" /></label>
          <label>{<span style={L}>Metode / Sumber</span>}<input style={I} value={form.metode} onChange={(e) => setForm({ ...form, metode: e.target.value })} placeholder="Transfer / Kas / dll" /></label>
          <label>{<span style={L}>No. Referensi (opsional)</span>}<input style={I} value={form.referensi} onChange={(e) => setForm({ ...form, referensi: e.target.value })} placeholder="mis. INV/VA" /></label>
          <label style={{ gridColumn: "1 / -1" }}>{<span style={L}>Keterangan</span>}<input style={I} value={form.deskripsi} onChange={(e) => setForm({ ...form, deskripsi: e.target.value })} placeholder="mis. Token listrik kantor Oktober" /></label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          {editId && <button style={BTN_GHOST} onClick={() => { setEditId(null); setForm(blankForm()); }}>Batal</button>}
          <button style={BTN} disabled={busy} onClick={submit} data-testid="exp-submit">{busy ? "…" : editId ? "💾 Simpan Perubahan" : "➕ Catat Biaya"}</button>
        </div>
      </div>

      {/* Filter */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ flex: "1 1 140px" }}><span style={L}>Perusahaan</span>
          <select style={I} value={fEntity} onChange={(e) => setFEntity(e.target.value)} data-testid="exp-filter-entity">
            <option value="all">Semua PT/CV</option>
            {ENTITY_OPTS.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label style={{ flex: "1 1 110px" }}><span style={L}>Dari</span><input type="date" style={I} value={fDari} onChange={(e) => setFDari(e.target.value)} /></label>
        <label style={{ flex: "1 1 110px" }}><span style={L}>Sampai</span><input type="date" style={I} value={fSampai} onChange={(e) => setFSampai(e.target.value)} /></label>
        <label style={{ flex: "1 1 140px" }}><span style={L}>Kategori</span>
          <select style={I} value={fKat} onChange={(e) => setFKat(e.target.value)}>
            <option value="">Semua kategori</option>
            {cats.map((c) => <option key={c.id} value={c.nama}>{c.nama}</option>)}
          </select>
        </label>
        <button style={BTN_GHOST} onClick={() => { setFEntity("all"); setFDari(""); setFSampai(""); setFKat(""); }}>Reset</button>
      </div>

      {/* List */}
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
        {items.length === 0 ? (
          <div style={{ padding: 28, textAlign: "center", color: C.mute, fontSize: 13 }}>{busy ? "Memuat…" : "Belum ada biaya pada filter ini."}</div>
        ) : items.map((e) => (
          <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "11px 14px", borderBottom: `1px solid ${C.line}`, flexWrap: "wrap" }} data-testid={`exp-row-${e.id}`}>
            <div style={{ flex: "1 1 220px", minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{e.kategori} <span style={{ fontSize: 11, color: C.mute, fontWeight: 600 }}>· {entityName(e.entity_id)}</span></div>
              <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>{fDate(e.tanggal)}{e.deskripsi ? ` · ${e.deskripsi}` : ""}{e.referensi ? ` · ref ${e.referensi}` : ""}{e.metode ? ` · ${e.metode}` : ""}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 800, whiteSpace: "nowrap" }}>{fRp(e.nominal)}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ ...BTN_GHOST, padding: "6px 10px" }} onClick={() => startEdit(e)} data-testid={`exp-edit-${e.id}`}>Edit</button>
              <button style={{ ...BTN_GHOST, padding: "6px 10px", color: C.red, borderColor: C.red }} onClick={() => voidExpense(e)} data-testid={`exp-void-${e.id}`}>Void</button>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: C.mute, marginTop: 12, lineHeight: 1.6 }}>
        Biaya ini akan masuk ke <b style={{ color: C.ink }}>Laba Operasional</b>: Pendapatan − HPP = Laba Kotor − Biaya Umum &amp; Administratif = Laba Operasional.
        Pembatalan memakai <b style={{ color: C.ink }}>Void</b> (bukan hapus) agar riwayat/audit tetap utuh.
      </div>
    </div>
  );
}
