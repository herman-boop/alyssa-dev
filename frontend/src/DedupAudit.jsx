import { useEffect, useMemo, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const C = { bg: "#0a0e14", card: "#111826", line: "#1c2433", ink: "#e6edf3", mute: "#8b949e",
  gold: "#EF9F27", green: "#3fb950", red: "#f85149", blue: "#58a6ff" };
const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const badge = (c) => ({ high: C.green, medium: C.gold, needs_review: C.red }[c] || C.mute);

export default function DedupAudit() {
  const pin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = useMemo(() => ({ "x-admin-pin": pin }), [pin]);
  const [sup, setSup] = useState(null);
  const [con, setCon] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const [s, c] = await Promise.all([
        axios.get(`${API}/admin/suppliers/dedup/audit`, { headers }),
        axios.get(`${API}/admin/contacts/dedup/audit`, { headers }),
      ]);
      setSup(s.data); setCon(c.data);
    } catch (e) {
      setErr(e?.response?.status === 401 || e?.response?.status === 403
        ? "Butuh login admin (PIN). Buka /admin & login dulu, lalu buka halaman ini lagi."
        : (e?.response?.data?.detail || e.message || "Gagal memuat"));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const mapping = useMemo(() => {
    const out = [];
    (sup?.groups || []).forEach((g) => {
      if (g.needs_review) return;
      (g.members || []).forEach((m) => { if (!m.is_suggested_master) out.push({ old_id: m.supplier_id, canonical_id: g.suggested_master_id, nama: m.nama, kind: "supplier", confidence: g.confidence }); });
    });
    (con?.groups || []).forEach((g) => {
      if (g.needs_review) return;
      (g.members || []).forEach((m) => { if (!m.is_suggested_master) out.push({ old_id: m.contact_id, canonical_id: g.suggested_master_id, nama: m.nama, kind: "contact", confidence: g.confidence }); });
    });
    return out;
  }, [sup, con]);

  const copyJson = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ suppliers: sup, contacts: con, mapping }, null, 2)); alert("JSON audit tersalin — tempel ke chat untuk saya rapikan."); }
    catch { alert("Gagal menyalin."); }
  };

  const wrap = { minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif", padding: "18px 16px 60px" };
  const box = { background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginBottom: 14 };
  const kv = (k, v, c) => (<div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}><span style={{ color: C.mute }}>{k}</span><b style={{ color: c || C.ink }}>{v}</b></div>);

  if (loading) return <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>Memuat audit (read-only)…</div>;
  if (err) return <div style={wrap}><div style={{ ...box, borderColor: C.red }}><b style={{ color: C.red }}>⚠️ {err}</b><div style={{ marginTop: 10 }}><button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "none", color: C.ink, cursor: "pointer" }}>Coba lagi</button></div></div></div>;

  const Group = ({ g, kind }) => (
    <div style={{ ...box, marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
        <div style={{ fontWeight: 800 }}>{(g.names || []).join(" / ") || "—"} <span style={{ fontSize: 11, color: C.mute }}>· basis {g.basis}{g.jenis ? ` · ${g.jenis}` : ""}</span></div>
        <span style={{ fontSize: 11, fontWeight: 800, color: badge(g.confidence) }}>{g.confidence.toUpperCase()}</span>
      </div>
      <div style={{ fontSize: 11.5, color: C.mute, marginTop: 2 }}>Saran master (canonical): <b style={{ color: C.blue }}>{g.suggested_master_id}</b></div>
      {(g.members || []).map((m) => {
        const id = m.supplier_id || m.contact_id; const u = m.usage;
        return (
          <div key={id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderTop: `1px solid ${C.line}`, fontSize: 12.5, flexWrap: "wrap" }}>
            <div><b>{m.is_suggested_master ? "★ " : ""}{id}</b> <span style={{ color: C.mute }}>{m.nama}{m.no_hp ? ` · ${m.no_hp}` : ""}{m.email ? ` · ${m.email}` : ""}</span></div>
            {u ? <div style={{ color: C.mute }}>job {u.jobs} · bayar {u.payments_count} ({rp(u.payments_sum)}) · rekon {u.rekon_payments} · ref {u.import_refs + u.permintaan_refs}</div>
               : <div style={{ color: C.mute }}>lengkap {m.completeness}</div>}
          </div>
        );
      })}
      {g.conflicts && g.conflicts.length > 0 && <div style={{ fontSize: 11.5, color: C.red, marginTop: 6 }}>⚠️ Konflik (perlu review): {JSON.stringify(g.conflicts)}</div>}
      {g.needs_review && <div style={{ fontSize: 11.5, color: C.red, marginTop: 4 }}>NEEDS REVIEW — jangan merge otomatis (kemungkinan beda {kind}).</div>}
    </div>
  );

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>🔎 Audit Duplikat (READ-ONLY)</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={load} style={{ padding: "8px 14px", borderRadius: 8, border: `1px solid ${C.line}`, background: "none", color: C.ink, cursor: "pointer", fontWeight: 700 }}>↻ Muat ulang</button>
            <button onClick={copyJson} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: C.gold, color: "#1a1208", cursor: "pointer", fontWeight: 800 }}>📋 Salin JSON</button>
          </div>
        </div>
        <div style={{ fontSize: 12, color: C.mute, marginBottom: 14 }}>Laporan ini hanya membaca data — tidak ada merge/hapus/perubahan. Kirim hasil "Salin JSON" ke chat untuk dirapikan & di-ACC sebelum tindakan apa pun.</div>

        <div style={box}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>📦 SUPPLIER</div>
          {kv("Total Supplier", sup?.total_suppliers)}
          {kv("Kandidat grup duplikat", sup?.candidate_groups)}
          {kv("Bisa disarankan merge", sup?.auto_suggestable_groups, C.green)}
          {kv("Perlu review (ambigu)", sup?.needs_review_groups, C.red)}
          {kv("Record kosong/tak dipakai", sup?.empty_unused_count, C.gold)}
        </div>
        {(sup?.groups || []).map((g, i) => <Group key={i} g={g} kind="supplier" />)}
        {(sup?.empty_unused || []).length > 0 && (
          <div style={box}><div style={{ fontWeight: 800, marginBottom: 6, color: C.gold }}>Record kosong / tak pernah dipakai (aman dihapus)</div>
            <div style={{ fontSize: 12, color: C.mute }}>{sup.empty_unused.map((e) => `${e.supplier_id} (${e.nama})`).join(", ")}</div></div>
        )}

        <div style={box}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>📇 CONTACTS</div>
          {kv("Total Contacts", con?.total_contacts)}
          {kv("Kandidat grup duplikat", con?.candidate_groups)}
          {kv("High confidence", con?.high_confidence, C.green)}
          {kv("Medium confidence", con?.medium_confidence, C.gold)}
          {kv("Perlu review", con?.needs_review_groups, C.red)}
          {kv("Contact kosong", con?.empty_count, C.gold)}
        </div>
        {(con?.groups || []).map((g, i) => <Group key={i} g={g} kind="contact" />)}

        <div style={box}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>🔗 Mapping disarankan: old_id → canonical_id ({mapping.length})</div>
          {mapping.length === 0 ? <div style={{ fontSize: 12, color: C.mute }}>Tidak ada (atau semua perlu review).</div> :
            mapping.map((m, i) => (
              <div key={i} style={{ fontSize: 12.5, padding: "4px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <code style={{ color: C.red }}>{m.old_id}</code> → <code style={{ color: C.green }}>{m.canonical_id}</code>
                <span style={{ color: C.mute }}> · {m.kind} · {m.nama} · {m.confidence}</span>
              </div>
            ))}
          <div style={{ fontSize: 11, color: C.mute, marginTop: 8 }}>Mapping ini SARAN saja. Belum ada yang di-merge. Tunggu ACC Anda.</div>
        </div>
      </div>
    </div>
  );
}
