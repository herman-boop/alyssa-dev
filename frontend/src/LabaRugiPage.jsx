import { useEffect, useMemo, useState, useCallback } from "react";
import axios from "axios";
import { DOC_ENTITIES } from "./docTheme";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const C = { bg: "#0b0f17", card: "#0e1420", line: "#1a2130", ink: "#e6edf3", mute: "#8b949e", gold: "#b392f0", green: "#3fb950", red: "#f85149" };
const fRp = (n) => "Rp " + new Intl.NumberFormat("id-ID").format(Number(n || 0));
const entName = (id) => id === "none" ? "Belum diisi" : (DOC_ENTITIES[id]?.footerName || id);
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function LabaRugiPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = useMemo(() => ({ "x-admin-pin": adminPin }), [adminPin]);
  const now = new Date();
  const [dari, setDari] = useState(`${now.getFullYear()}-01-01`);
  const [sampai, setSampai] = useState(todayStr());
  const [entity, setEntity] = useState("");      // "" = semua
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setErr("");
    try {
      const params = {};
      if (dari) params.date_from = dari;
      if (sampai) params.date_to = sampai;
      if (entity) params.entity_id = entity;
      const r = await axios.get(`${API}/admin/reports/laba-rugi`, { params, headers });
      setData(r.data);
    } catch (e) { setErr(e?.response?.data?.detail || e?.message || "Gagal memuat"); setData(null); }
    finally { setBusy(false); }
  }, [dari, sampai, entity, headers]);

  useEffect(() => { load(); }, [load]);

  const setMonth = () => { const d = new Date(); setDari(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`); setSampai(todayStr()); };
  const setYear = () => { const y = new Date().getFullYear(); setDari(`${y}-01-01`); setSampai(`${y}-12-31`); };

  const g = data?.grand_total;
  const perEntity = data?.per_entity || {};
  const entKeys = Object.keys(perEntity);

  const Row = ({ label, val, bold, color, indent }) => (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.line}`, paddingLeft: indent ? 16 : 0 }}>
      <span style={{ color: bold ? C.ink : C.mute, fontWeight: bold ? 800 : 600, fontSize: bold ? 14 : 13 }}>{label}</span>
      <b style={{ color: color || C.ink, fontSize: bold ? 15 : 13.5 }}>{fRp(val)}</b>
    </div>
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div><div style={{ fontSize: 11, color: C.mute, marginBottom: 4 }}>Dari</div><input type="date" value={dari} onChange={(e) => setDari(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontSize: 12 }} data-testid="lr-dari" /></div>
          <div><div style={{ fontSize: 11, color: C.mute, marginBottom: 4 }}>Sampai</div><input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontSize: 12 }} data-testid="lr-sampai" /></div>
          <div><div style={{ fontSize: 11, color: C.mute, marginBottom: 4 }}>Entitas</div>
            <select value={entity} onChange={(e) => setEntity(e.target.value)} style={{ padding: "7px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.ink, fontSize: 12 }} data-testid="lr-entity">
              <option value="">Semua (PT + CV)</option>
              {Object.entries(DOC_ENTITIES).map(([id, e]) => <option key={id} value={id}>{e.footerName || id}</option>)}
              <option value="none">Belum diisi</option>
            </select>
          </div>
          <button onClick={setMonth} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.mute, fontSize: 11.5, cursor: "pointer" }}>Bulan ini</button>
          <button onClick={setYear} style={{ padding: "7px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.bg, color: C.mute, fontSize: 11.5, cursor: "pointer" }}>Tahun ini</button>
          <button onClick={load} disabled={busy} style={{ padding: "7px 14px", borderRadius: 8, border: `1px solid ${C.gold}`, background: "#1a1033", color: C.gold, fontWeight: 700, fontSize: 12, cursor: "pointer" }} data-testid="lr-refresh">{busy ? "…" : "Muat"}</button>
        </div>
      </div>

      {err && <div style={{ color: C.red, fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {g && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Ringkasan {entity ? `· ${entName(entity)}` : "· Semua Entitas"} · {data.periode?.dari || "…"} s/d {data.periode?.sampai || "…"}</div>
          <Row label="Pendapatan (Penjualan)" val={g.pendapatan} color={C.green} />
          <Row label="− HPP (biaya langsung)" val={g.hpp} indent />
          <Row label="= Laba Kotor" val={g.laba_kotor} bold color={g.laba_kotor >= 0 ? C.green : C.red} />
          <Row label="− Biaya / Beban (operasional)" val={g.biaya} indent />
          <Row label="= Laba Bersih (operasional)" val={g.laba_bersih} bold color={g.laba_bersih >= 0 ? C.green : C.red} />
        </div>
      )}

      {entKeys.length > 1 && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "16px 18px" }}>
          <div style={{ fontSize: 12, color: C.mute, marginBottom: 10 }}>Rincian per Entitas (PT & CV tidak dicampur)</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
              <thead><tr style={{ color: C.mute, textAlign: "right" }}>
                <th style={{ textAlign: "left", padding: "6px 8px" }}>Entitas</th>
                <th style={{ padding: "6px 8px" }}>Pendapatan</th><th style={{ padding: "6px 8px" }}>HPP</th>
                <th style={{ padding: "6px 8px" }}>Laba Kotor</th><th style={{ padding: "6px 8px" }}>Biaya</th><th style={{ padding: "6px 8px" }}>Laba Bersih</th>
              </tr></thead>
              <tbody>
                {entKeys.map((k) => { const v = perEntity[k]; return (
                  <tr key={k} style={{ borderTop: `1px solid ${C.line}`, textAlign: "right", color: C.ink }}>
                    <td style={{ textAlign: "left", padding: "6px 8px", fontWeight: 700 }}>{entName(k)}</td>
                    <td style={{ padding: "6px 8px" }}>{fRp(v.pendapatan)}</td><td style={{ padding: "6px 8px" }}>{fRp(v.hpp)}</td>
                    <td style={{ padding: "6px 8px", color: v.laba_kotor >= 0 ? C.green : C.red }}>{fRp(v.laba_kotor)}</td>
                    <td style={{ padding: "6px 8px" }}>{fRp(v.biaya)}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 800, color: v.laba_bersih >= 0 ? C.green : C.red }}>{fRp(v.laba_bersih)}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: C.mute, marginTop: 12, lineHeight: 1.6 }}>
        Angka dari transaksi aktual: Pendapatan = harga deal (invoice) order, HPP = biaya unit ke supplier, Biaya = pencatatan Biaya/Beban. Transaksi yang entitasnya belum diisi masuk grup <b>Belum diisi</b> — isi entity PT/CV di Pesanan &amp; di detail unit Supplier agar laporan per-PT/CV akurat.
      </div>
    </div>
  );
}
