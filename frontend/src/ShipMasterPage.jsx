import { useEffect, useState, useCallback } from "react";
import axios from "axios";

/*
  Master Kapal (admin): panjang, lebar & tipe kapal per MMSI/IMO.
  Data ini tampil di layar "Lihat Posisi Kapal" pelanggan. Tidak ada tombol hapus:
  koreksi = simpan ulang dengan MMSI/IMO yang sama.
*/
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
const L = { fontSize: 11, color: "#8b949e", display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const EMPTY = { name: "", mmsi: "", imo: "", ship_type: "", length_m: "", width_m: "" };

export default function ShipMasterPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };
  const [items, setItems] = useState([]);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ t: "", err: false });

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/ship-master`, { headers });
      setItems(r.data.items || []);
    } catch (e) {
      setMsg({ t: e.response?.data?.detail || "Gagal memuat master kapal", err: true });
    }
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    setBusy(true); setMsg({ t: "", err: false });
    try {
      await axios.put(`${API}/admin/ship-master`, f, { headers });
      setMsg({ t: "✓ Tersimpan", err: false });
      setF(EMPTY);
      load();
    } catch (e) {
      setMsg({ t: e.response?.data?.detail || "Gagal menyimpan", err: true });
    } finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "16px 14px", color: "#e6edf3" }} data-testid="ship-master">
      <div style={{ background: "#11161f", border: "1px solid #232a36", borderRadius: 12, padding: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>{f.mmsi || f.imo ? "Tambah / koreksi kapal" : "Tambah kapal"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <div style={{ gridColumn: "1/-1" }}><label style={L}>Nama kapal</label><input style={I} value={f.name} onChange={set("name")} placeholder="KM MUTIARA FERINDO" data-testid="sm-name" /></div>
          <div><label style={L}>MMSI (9 digit)</label><input style={I} inputMode="numeric" value={f.mmsi} onChange={set("mmsi")} data-testid="sm-mmsi" /></div>
          <div><label style={L}>IMO (7 digit)</label><input style={I} inputMode="numeric" value={f.imo} onChange={set("imo")} data-testid="sm-imo" /></div>
          <div><label style={L}>Panjang (m)</label><input style={I} inputMode="decimal" value={f.length_m} onChange={set("length_m")} data-testid="sm-length" /></div>
          <div><label style={L}>Lebar (m)</label><input style={I} inputMode="decimal" value={f.width_m} onChange={set("width_m")} data-testid="sm-width" /></div>
          <div style={{ gridColumn: "1/-1" }}><label style={L}>Tipe kapal</label><input style={I} value={f.ship_type} onChange={set("ship_type")} placeholder="Passenger / Ro-Ro" data-testid="sm-type" /></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
          <button style={{ ...BTN, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={save} data-testid="sm-save">💾 Simpan</button>
          {msg.t ? <span style={{ fontSize: 12.5, fontWeight: 700, color: msg.err ? "#f85149" : "#3fb950" }}>{msg.t}</span> : null}
        </div>
        <div style={{ fontSize: 11.5, color: "#8b949e", marginTop: 8 }}>Isi MMSI atau IMO. Simpan lagi dengan MMSI/IMO yang sama untuk mengoreksi data.</div>
      </div>

      <div style={{ marginTop: 14, fontSize: 12, color: "#8b949e", fontWeight: 700 }}>{items.length} kapal tersimpan</div>
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((k) => (
          <button key={k.key} type="button" onClick={() => setF({ name: k.name || "", mmsi: k.mmsi || "", imo: k.imo || "", ship_type: k.ship_type || "", length_m: k.length_m ?? "", width_m: k.width_m ?? "" })}
            style={{ textAlign: "left", background: "#11161f", border: "1px solid #232a36", borderRadius: 10, padding: "10px 12px", color: "#e6edf3", cursor: "pointer" }} data-testid={`sm-row-${k.key}`}>
            <div style={{ fontWeight: 800, fontSize: 13.5 }}>{k.name || "(tanpa nama)"}</div>
            <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
              {k.mmsi ? `MMSI ${k.mmsi}` : ""}{k.mmsi && k.imo ? " · " : ""}{k.imo ? `IMO ${k.imo}` : ""}
              {" — "}{k.length_m != null ? `${k.length_m} m` : "—"} × {k.width_m != null ? `${k.width_m} m` : "—"}{k.ship_type ? ` · ${k.ship_type}` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
