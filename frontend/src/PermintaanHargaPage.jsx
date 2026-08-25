import { useState, useEffect, useCallback } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

function tryExecCommandCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.width = "1px";
    ta.style.height = "1px";
    ta.style.padding = "0";
    ta.style.border = "none";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length); // iOS Safari needs this explicitly
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  if (tryExecCommandCopy(text)) return true;
  window.prompt("Nggak bisa auto-copy di browser ini. Salin manual teks di bawah:", text);
  return false;
}

function fRp(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}
function fDate(s) {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; }
}

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" };
const L = { fontSize: 11, color: "#8b949e", display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN_GHOST = { padding: "9px 16px", borderRadius: 8, border: "1px solid #30363d", background: "none", color: "#c9d1d9", fontWeight: 700, fontSize: 13, cursor: "pointer" };

const STATUS_META = {
  pending:   { label: "Menunggu Diisi", bg: "#2d1a1a", color: "#f85149", border: "#f85149" },
  partial:   { label: "Sebagian Terisi", bg: "#3d2e0a", color: "#EF9F27", border: "#EF9F27" },
  submitted: { label: "Lengkap", bg: "#1a4a2a", color: "#56d364", border: "#2ea043" },
};

const MODA = ["Self Drive", "Kapal Laut / RORO", "Container", "Car Carrier", "Towing", "Self Loader", "Low Bed"];
function blankRow() { return { asal: "", tujuan: "", tipe_kendaraan: "", moda: "" }; }

export default function PermintaanHargaPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [namaSupplier, setNamaSupplier] = useState("");
  const [catatan, setCatatan] = useState("");
  const [rows, setRows] = useState([blankRow()]);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [toast, setToast] = useState("");
  const [lastLink, setLastLink] = useState("");
  const [templates, setTemplates] = useState([]);
  const [tplPick, setTplPick] = useState("");

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await axios.get(`${API}/admin/permintaan-harga`, { headers });
      setItems(r.data.items || []);
    } catch { /* noop */ }
    try {
      const t = await axios.get(`${API}/admin/permintaan-templates`, { headers });
      setTemplates(t.data.items || []);
    } catch { /* noop */ }
    setLoading(false);
  }, [adminPin]);

  useEffect(() => { load(); }, [load]);

  const scrollTop = () => { try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch { window.scrollTo(0, 0); } };

  // COPY PERMINTAAN: salin rute (tanpa harga) ke form, ganti supplier -> buat link baru.
  const copyRequest = (it) => {
    setRows((it.rows || []).map((r) => ({ asal: r.asal || "", tujuan: r.tujuan || "", tipe_kendaraan: r.tipe_kendaraan || "", moda: r.moda || "" })));
    setNamaSupplier(""); setCatatan(it.catatan || ""); setLastLink("");
    scrollTop();
    flash(`Rute disalin (${(it.rows || []).length}). Ganti nama supplier lalu Buat Link.`);
  };
  const usilTemplate = (tid) => {
    setTplPick(tid);
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    setRows((t.rows || []).map((r) => ({ asal: r.asal || "", tujuan: r.tujuan || "", tipe_kendaraan: r.tipe_kendaraan || "", moda: r.moda || "" })));
    setCatatan(t.catatan || ""); setLastLink("");
    flash(`Template "${t.nama}" dipakai. Isi nama supplier lalu Buat Link.`);
  };
  const saveAsTemplate = async (it) => {
    const nama = window.prompt("Nama template (mis. Sulawesi — Pickup/Double Cabin):", it ? `${it.nama_supplier} — ${(it.rows || []).length} rute` : "");
    if (nama === null) return;
    const src = it ? it.rows : rows;
    const tplRows = (src || []).filter((r) => r.asal && r.tujuan && r.tipe_kendaraan).map((r) => ({ asal: r.asal, tujuan: r.tujuan, tipe_kendaraan: r.tipe_kendaraan, moda: r.moda || "" }));
    if (!tplRows.length) { flash("Tidak ada rute untuk template"); return; }
    try { await axios.post(`${API}/admin/permintaan-templates`, { nama: nama.trim() || "Template", catatan: (it?.catatan || catatan || ""), rows: tplRows }, { headers }); flash("⭐ Template tersimpan"); load(); }
    catch (e) { flash(e?.response?.data?.detail || "Gagal simpan template"); }
  };
  const deleteTemplate = async (tid) => {
    if (!window.confirm("Hapus template ini?")) return;
    try { await axios.delete(`${API}/admin/permintaan-templates/${tid}`, { headers }); flash("Template dihapus"); load(); } catch { flash("Gagal hapus template"); }
  };

  const updateRow = (i, field, val) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, blankRow()]);
  const removeRow = (i) => setRows((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  const submit = async () => {
    if (!namaSupplier.trim()) { flash("Nama supplier wajib diisi"); return; }
    const validRows = rows.filter((r) => r.asal.trim() && r.tujuan.trim() && r.tipe_kendaraan.trim());
    if (validRows.length === 0) { flash("Isi minimal 1 rute (asal, tujuan, tipe kendaraan)"); return; }
    setSaving(true);
    try {
      const r = await axios.post(`${API}/admin/permintaan-harga`, { nama_supplier: namaSupplier.trim(), catatan: catatan.trim(), rows: validRows }, { headers });
      const link = `${window.location.origin}/minta-harga/${r.data.token}`;
      setLastLink(link);
      setNamaSupplier(""); setCatatan(""); setRows([blankRow()]);
      flash("Permintaan dibuat! Link siap dikirim ke perwakilan.");
      load();
    } catch (e) {
      flash(e?.response?.data?.detail || "Gagal membuat permintaan");
    }
    setSaving(false);
  };

  const deleteItem = async (id) => {
    if (!window.confirm("Hapus permintaan harga ini?")) return;
    try {
      await axios.delete(`${API}/admin/permintaan-harga/${id}`, { headers });
      flash("Permintaan dihapus");
      if (expanded === id) setExpanded(null);
      load();
    } catch { flash("Gagal hapus"); }
  };

  const copyLink = async (token) => {
    const link = `${window.location.origin}/minta-harga/${token}`;
    const ok = await copyToClipboard(link);
    if (ok) flash("Link disalin!");
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px" }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "#EF9F27" }}>📩 Minta Harga ke Supplier</div>
        <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
          Input rute yang butuh harga, kirim link ke perwakilan supplier (Sulawesi, Kalimantan, dll) — mereka tinggal buka link dan isi kolom harga, tanpa perlu login.
        </div>
      </div>

      {/* Form buat permintaan baru */}
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <label style={L}>Nama Supplier / Perwakilan</label>
            <input style={I} placeholder="cth: CV Barokah Sulawesi" value={namaSupplier} onChange={(e) => setNamaSupplier(e.target.value)} />
          </div>
          <div>
            <label style={L}>Catatan (opsional)</label>
            <input style={I} placeholder="cth: mohon isi paling lambat besok" value={catatan} onChange={(e) => setCatatan(e.target.value)} />
          </div>
        </div>

        {templates.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "#8b949e", fontWeight: 700 }}>⭐ Template:</span>
            <select style={{ ...I, width: "auto", minWidth: 200 }} value={tplPick} onChange={(e) => usilTemplate(e.target.value)}>
              <option value="">— Pakai template —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.nama} ({(t.rows || []).length} rute)</option>)}
            </select>
            {tplPick && <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 10px", color: "#f85149", borderColor: "#f85149" }} onClick={() => deleteTemplate(tplPick)}>🗑 Hapus template</button>}
          </div>
        )}

        <label style={L}>Rute yang Diminta Harga</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 8, alignItems: "center" }}>
              <input style={I} placeholder="Asal (cth: Makassar)" value={row.asal} onChange={(e) => updateRow(i, "asal", e.target.value)} />
              <input style={I} placeholder="Tujuan (cth: Manado)" value={row.tujuan} onChange={(e) => updateRow(i, "tujuan", e.target.value)} />
              <input style={I} placeholder="Tipe kendaraan (ketik manual)" value={row.tipe_kendaraan} onChange={(e) => updateRow(i, "tipe_kendaraan", e.target.value)} />
              <select style={I} value={row.moda || ""} onChange={(e) => updateRow(i, "moda", e.target.value)}>
                <option value="">Moda...</option>
                {MODA.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <button onClick={() => removeRow(i)} disabled={rows.length === 1}
                style={{ ...BTN_GHOST, padding: "9px 12px", color: rows.length === 1 ? "#484f58" : "#f85149", borderColor: rows.length === 1 ? "#30363d" : "#f85149", cursor: rows.length === 1 ? "not-allowed" : "pointer" }}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={BTN_GHOST} onClick={addRow}>+ Tambah Rute</button>
            <button style={BTN_GHOST} onClick={() => saveAsTemplate(null)}>⭐ Simpan sbg Template</button>
          </div>
          <button style={{ ...BTN, opacity: saving ? 0.6 : 1 }} onClick={submit} disabled={saving}>
            {saving ? "Membuat..." : "🔗 Buat Permintaan & Link"}
          </button>
        </div>

        {lastLink && (
          <div style={{ marginTop: 14, background: "#1a4a2a", border: "1px solid #2ea043", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, color: "#56d364", fontWeight: 700 }}>✅ Link siap:</span>
            <code style={{ flex: 1, fontSize: 12, color: "#e6edf3", background: "#0d1117", padding: "5px 10px", borderRadius: 6, border: "1px solid #30363d", wordBreak: "break-all", minWidth: 200 }}>{lastLink}</code>
            <button onClick={async () => { const ok = await copyToClipboard(lastLink); if (ok) flash("Link disalin!"); }} style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #2ea043", background: "none", color: "#56d364", cursor: "pointer", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>📋 Salin</button>
            <a href={`https://wa.me/?text=${encodeURIComponent("Mohon isi harga rute berikut ya: " + lastLink)}`} target="_blank" rel="noreferrer"
              style={{ padding: "6px 14px", borderRadius: 7, border: "1px solid #2ea043", background: "none", color: "#56d364", textDecoration: "none", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              💬 Kirim via WA
            </a>
          </div>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#2ea043", color: "#fff", padding: "10px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}

      {/* Daftar permintaan */}
      <div style={{ fontSize: 13, fontWeight: 800, color: "#e6edf3", marginBottom: 10 }}>Daftar Permintaan ({items.length})</div>
      {loading && <div style={{ color: "#8b949e", padding: 20, textAlign: "center", fontSize: 13 }}>Memuat...</div>}
      {!loading && items.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "#8b949e", fontSize: 13 }}>Belum ada permintaan harga.</div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it) => {
          const meta = STATUS_META[it.status] || STATUS_META.pending;
          const total = (it.rows || []).length;
          const filled = (it.rows || []).filter((r) => r.harga).length;
          const isOpen = expanded === it.id;
          return (
            <div key={it.id} style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: "#e6edf3" }}>{it.nama_supplier}{it.supplier_id && <span title="Terhubung ke supplier master" style={{ marginLeft: 6, fontSize: 10, color: "#56d364" }}>● master</span>}</div>
                  <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{it.req_no ? `${it.req_no} · ` : ""}{total} rute · {fDate(it.created_at)} · {filled}/{total} terisi</div>
                </div>
                <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 12, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>{meta.label}</span>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={() => setExpanded(isOpen ? null : it.id)}>{isOpen ? "Tutup" : "Lihat Harga"}</button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={() => copyLink(it.token)}>📋 Salin Link</button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`Mohon isi harga rute berikut ya: ${window.location.origin}/minta-harga/${it.token}`)}`} target="_blank" rel="noreferrer" style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#56d364", borderColor: "#2ea043", textDecoration: "none" }}>💬 WA</a>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#EF9F27", borderColor: "#EF9F27" }} onClick={() => copyRequest(it)}>📋 Copy Permintaan</button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={() => saveAsTemplate(it)}>⭐ Template</button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#f85149", borderColor: "#f85149" }} onClick={() => deleteItem(it.id)}>🗑</button>
              </div>
              {isOpen && (
                <div style={{ borderTop: "1px solid #21262d", padding: "10px 16px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: "#8b949e", textAlign: "left" }}>
                        <th style={{ padding: "6px 4px", fontWeight: 700 }}>Rute</th>
                        <th style={{ padding: "6px 4px", fontWeight: 700 }}>Tipe Kendaraan</th>
                        <th style={{ padding: "6px 4px", fontWeight: 700 }}>Moda</th>
                        <th style={{ padding: "6px 4px", fontWeight: 700, textAlign: "right" }}>Harga</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(it.rows || []).map((r) => (
                        <tr key={r.id} style={{ borderTop: "1px solid #21262d" }}>
                          <td style={{ padding: "7px 4px", color: "#e6edf3" }}>{r.asal} → {r.tujuan}</td>
                          <td style={{ padding: "7px 4px", color: "#c9d1d9" }}>{r.tipe_kendaraan}</td>
                          <td style={{ padding: "7px 4px", color: "#8b949e" }}>{r.moda || "—"}</td>
                          <td style={{ padding: "7px 4px", textAlign: "right", fontWeight: 800, color: r.harga ? "#56d364" : "#484f58" }}>{r.harga ? fRp(r.harga) : "Belum diisi"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
