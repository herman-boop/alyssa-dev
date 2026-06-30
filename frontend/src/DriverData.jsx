/* eslint-disable */
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;
const PIN_KEY = "aal_admin_pin";

const TIPE_SIM = ["A", "B1", "B2", "C", "D"];
const STATUS_OPTS = ["aktif", "nonaktif"];

/* ── helpers ── */
const fmtDate = (s) => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }); } catch { return s; }
};

/* ── icons ── */
const IcoSearch  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IcoPlus    = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IcoPencil  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IcoTrash   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>;
const IcoX       = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IcoRefresh = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>;
const IcoCamera  = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
const IcoId      = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>;
const IcoPrint   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>;

const S = {
  root: { fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#0d1117", color: "#e6edf3", minHeight: "100vh" },
  topbar: { background: "#161b22", borderBottom: "1px solid #21262d", padding: "12px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  title: { fontSize: 16, fontWeight: 800, color: "#EF9F27", flex: 1 },
  btn: (bg, color = "#fff") => ({ padding: "7px 14px", borderRadius: 7, border: "none", background: bg, color, cursor: "pointer", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }),
  btnGhost: { padding: "7px 14px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 },
  input: { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "7px 10px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" },
  label: { fontSize: 10, color: "#8b949e", display: "block", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" },
  card: { background: "#161b22", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden" },
  pill: (c) => ({ display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, background: c === "aktif" ? "#1a4a2a" : "#2d1a1a", color: c === "aktif" ? "#56d364" : "#f85149", border: `1px solid ${c === "aktif" ? "#2ea043" : "#f85149"}` }),
};

/* ── Cetak Surat: search & pick driver ── */
function PrintSuratSearch({ drivers, onPrint, headers }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [printing, setPrinting] = useState(null);
  const ref = useRef();

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const results = q.trim().length >= 2
    ? drivers.filter(d =>
        d.nama?.toLowerCase().includes(q.toLowerCase()) ||
        (d.no_ktp || "").slice(-4).includes(q.replace(/\D/g, ""))
      ).slice(0, 8)
    : [];

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#1c2128", border: "1px solid #30363d", borderRadius: 7, padding: "6px 10px" }}>
        <IcoPrint />
        <input
          style={{ background: "none", border: "none", outline: "none", color: "#e6edf3", fontSize: 12, width: 180, fontFamily: "inherit" }}
          placeholder="Cetak surat — ketik nama / 4 digit KTP"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {q && <button onClick={() => { setQ(""); setOpen(false); }} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer", padding: 0, display: "flex" }}><IcoX /></button>}
      </div>
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, zIndex: 999, boxShadow: "0 8px 24px #0008", overflow: "hidden" }}>
          {results.map(d => (
            <button key={d.driver_id} onClick={async () => {
              setPrinting(d.driver_id);
              try {
                // Fetch detail lengkap agar foto_ktp/foto_sim tersedia
                const r = await axios.get(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${d.driver_id}`, { headers });
                onPrint(r.data);
              } catch { onPrint(d); }
              finally { setPrinting(null); setQ(""); setOpen(false); }
            }}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "none", border: "none", borderBottom: "1px solid #21262d", color: "#e6edf3", cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 20 }}>👤</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{d.nama}</div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>{d.driver_id} · KTP: {d.no_ktp ? `****${d.no_ktp.slice(-4)}` : "—"} · SIM {d.tipe_sim || "—"}</div>
              </div>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#EF9F27", fontWeight: 700 }}>{printing === d.driver_id ? "⏳..." : "🖨 Cetak"}</span>
            </button>
          ))}
        </div>
      )}
      {open && q.trim().length >= 2 && results.length === 0 && (
        <div style={{ position: "absolute", top: "110%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, zIndex: 999, padding: "12px", fontSize: 12, color: "#8b949e", textAlign: "center" }}>
          Tidak ditemukan
        </div>
      )}
    </div>
  );
}

export default function DriverData({ embedded = false }) {
  const [pin] = useState(() => localStorage.getItem(PIN_KEY) || "");
  const headers = { "X-Admin-Pin": pin };

  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null); // null | { mode:"add"|"edit", driver? }
  const [detail, setDetail] = useState(null); // driver for foto/detail view

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2500); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.q = search.trim();
      if (filterStatus) params.status = filterStatus;
      const r = await axios.get(`${API}/admin/drivers`, { headers, params });
      setDrivers(r.data.items || []);
    } catch { flash("Gagal memuat data"); }
    finally { setLoading(false); }
  }, [search, filterStatus, pin]);

  useEffect(() => { load(); }, [load]);

  const deleteDriver = async (driverId, nama) => {
    if (!window.confirm(`Hapus driver "${nama}"? Data tidak bisa dikembalikan.`)) return;
    try {
      await axios.delete(`${API}/admin/drivers/${driverId}`, { headers });
      flash("Driver dihapus");
      load();
    } catch { flash("Gagal hapus"); }
  };

  const printSurat = (drv) => {
    const tgl = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Surat Pengantar Driver</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #222; padding: 30px 40px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #BA7517; padding-bottom: 12px; margin-bottom: 20px; }
      .co { font-size: 16px; font-weight: 800; color: #BA7517; }
      .co-sub { font-size: 9px; color: #666; margin-top: 2px; }
      h2 { font-size: 14px; text-align: center; margin-bottom: 20px; text-decoration: underline; letter-spacing: 1px; }
      .info-grid { display: grid; grid-template-columns: 140px 1fr; gap: 6px 0; margin-bottom: 20px; }
      .info-grid .k { color: #555; }
      .info-grid .v { font-weight: 600; }
      .info-grid .sep { grid-column: 1/-1; border-bottom: 1px dashed #ddd; margin: 4px 0; }
      .note { background: #fffbe6; border: 1px solid #ffe066; border-radius: 6px; padding: 10px 14px; font-size: 10px; color: #7a5700; margin-bottom: 20px; }
      .stamp-area { margin-top: 36px; display: flex; justify-content: flex-end; align-items: center; gap: 16px; }
      .stamp-box { border: 3px solid #BA7517; border-radius: 50%; width: 90px; height: 90px; display: flex; align-items: center; justify-content: center; opacity: 0.85; }
      .stamp-box img { width: 70px; height: 70px; object-fit: contain; }
      .foto-row { display: flex; gap: 16px; margin-bottom: 20px; }
      .foto-box { text-align: center; }
      .foto-box img { width: 120px; height: 80px; object-fit: cover; border: 1px solid #ddd; border-radius: 4px; display: block; image-orientation: from-image; }
      .foto-box .flbl { font-size: 9px; color: #666; margin-top: 4px; }
      @media print { @page { margin: 15mm; } }
    </style></head><body>
    <div class="header">
      <div><div class="co">PT ALYSSA AUTO LOGISTIK</div><div class="co-sub">Solusi Transportasi &amp; Logistik Kendaraan</div></div>
      <div style="text-align:right;font-size:9px;color:#666">Diterbitkan: ${tgl}</div>
    </div>
    <h2>SURAT PENGANTAR DRIVER</h2>
    <div class="info-grid">
      <span class="k">Nama Driver</span><span class="v">: ${drv.nama}</span>
      <div class="sep"></div>
      <span class="k">No. KTP</span><span class="v">: ${drv.no_ktp || "—"}</span>
      <span class="k">No. SIM</span><span class="v">: ${drv.no_sim || "—"} ${drv.tipe_sim ? `(SIM ${drv.tipe_sim})` : ""}</span>
      <div class="sep"></div>
      <span class="k">ID Driver</span><span class="v">: ${drv.driver_id}</span>
      <span class="k">Status</span><span class="v">: ${drv.status?.toUpperCase()}</span>
    </div>
    ${drv.foto_selfie || drv.foto_ktp || drv.foto_sim ? `
    <div class="foto-row">
      ${drv.foto_selfie ? `<div class="foto-box"><img src="${drv.foto_selfie}" /><div class="flbl">Foto Driver</div></div>` : ""}
      ${drv.foto_ktp ? `<div class="foto-box"><img src="${drv.foto_ktp}" /><div class="flbl">Foto KTP</div></div>` : ""}
      ${drv.foto_sim ? `<div class="foto-box"><img src="${drv.foto_sim}" /><div class="flbl">Foto SIM</div></div>` : ""}
    </div>` : ""}
    <div class="note">Surat ini menyatakan bahwa driver tersebut di atas adalah tenaga pengiriman resmi dari PT Alyssa Auto Logistik dan berwenang untuk melakukan pengiriman kendaraan atas nama perusahaan.</div>
    <div class="stamp-area">
      <div style="text-align:right;font-size:9px;color:#888;line-height:1.6">Diterbitkan oleh<br><strong style="color:#BA7517">PT Alyssa Auto Logistik</strong><br>${tgl}</div>
      <div class="stamp-box"><img src="${window.location.origin}/logo.png" alt="Stempel" /></div>
    </div>
    <script>window.onload=()=>window.print()<\/script>
    </body></html>`;
    const w = window.open("", "_blank"); w.document.write(html); w.document.close();
  };

  return (
    <div style={{ ...S.root, minHeight: embedded ? "unset" : "100vh" }}>
      {/* Topbar */}
      <div style={{ ...S.topbar, ...(embedded ? { background: "transparent", borderBottom: "1px solid #21262d", paddingLeft: 0 } : {}) }}>
        {!embedded && <div style={S.title}>👷 Data Driver</div>}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: "#8b949e" }}><IcoSearch /></span>
          <input style={{ ...S.input, paddingLeft: 30, width: 220 }} placeholder="Cari nama, ID, HP..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select style={{ ...S.input, width: 130 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Semua Status</option>
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Nonaktif</option>
        </select>
        <PrintSuratSearch drivers={drivers} onPrint={printSurat} headers={headers} />
        <button style={S.btn("#2ea043")} onClick={() => setModal({ mode: "add" })}><IcoPlus /> Tambah Driver</button>
        <button style={S.btnGhost} onClick={load}><IcoRefresh /> Refresh</button>
        {!embedded && <a href="/admin" style={{ ...S.btnGhost, textDecoration: "none" }}>← Admin</a>}
      </div>

      {/* Stats bar */}
      <div style={{ display: "flex", gap: 12, padding: "14px 20px", borderBottom: "1px solid #21262d" }}>
        {[
          { label: "Total Driver", val: drivers.length, color: "#e6edf3" },
          { label: "Aktif", val: drivers.filter(d => d.status === "aktif").length, color: "#56d364" },
          { label: "Nonaktif", val: drivers.filter(d => d.status !== "aktif").length, color: "#f85149" },
        ].map(s => (
          <div key={s.label} style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 8, padding: "10px 16px", minWidth: 100 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 10, color: "#8b949e", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ padding: "16px 20px" }}>
        {loading && <div style={{ color: "#8b949e", padding: 40, textAlign: "center" }}>Memuat...</div>}
        {!loading && drivers.length === 0 && (
          <div style={{ textAlign: "center", padding: 60, color: "#8b949e" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>👷</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Belum ada driver</div>
            <div style={{ fontSize: 12 }}>Klik "Tambah Driver" untuk mulai input data</div>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
          {drivers.map(drv => (
            <DriverCard key={drv.driver_id} drv={drv}
              onEdit={() => setModal({ mode: "edit", driver: drv })}
              onDelete={() => deleteDriver(drv.driver_id, drv.nama)}
              onDetail={() => setDetail(drv)}
              onPrint={() => printSurat(drv)}
            />
          ))}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: "#2ea043", color: "#fff", padding: "10px 20px", borderRadius: 8, fontWeight: 700, fontSize: 13, zIndex: 999, boxShadow: "0 4px 20px rgba(0,0,0,.4)" }}>
          {toast}
        </div>
      )}

      {/* Modal tambah/edit */}
      {modal && <DriverModal mode={modal.mode} driver={modal.driver} headers={headers} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); flash(modal.mode === "add" ? "Driver ditambahkan!" : "Data tersimpan!"); }} />}

      {/* Detail / foto modal */}
      {detail && <DetailModal drv={detail} headers={headers} onClose={() => { setDetail(null); load(); }} onPrint={() => printSurat(detail)} flash={flash} />}
    </div>
  );
}

/* ── Driver Card ── */
function DriverCard({ drv, onEdit, onDelete, onDetail, onPrint }) {
  return (
    <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, overflow: "hidden", transition: "border-color .2s" }}
      onMouseEnter={e => e.currentTarget.style.borderColor = "#EF9F27"}
      onMouseLeave={e => e.currentTarget.style.borderColor = "#21262d"}
    >
      {/* Top strip */}
      <div style={{ background: "#0d1117", padding: "14px 16px", display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: "50%", overflow: "hidden", border: "2px solid #30363d", flexShrink: 0, background: "#21262d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>
          {drv.foto_selfie ? <img src={drv.foto_selfie} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : "👤"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#e6edf3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{drv.nama}</div>
          <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{drv.driver_id}</div>
          <div style={{ marginTop: 5 }}><span style={S.pill(drv.status)}>{drv.status}</span>{drv.tipe_sim && <span style={{ marginLeft: 6, fontSize: 10, color: "#EF9F27", fontWeight: 700 }}>SIM {drv.tipe_sim}</span>}</div>
        </div>
      </div>

      {/* Info rows */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #21262d" }}>
        {drv.no_hp && <InfoRow ico="📱" val={drv.no_hp} />}
        {drv.no_ktp && <InfoRow ico="🪪" val={`KTP: ${drv.no_ktp}`} />}
        {drv.no_sim && <InfoRow ico="🚗" val={`SIM: ${drv.no_sim}`} />}
        {drv.alamat && <InfoRow ico="📍" val={drv.alamat} muted />}
        <InfoRow ico="📅" val={`Bergabung ${fmtDate(drv.created_at)}`} muted />
      </div>

      {/* Foto chips */}
      <div style={{ padding: "0 16px 10px", display: "flex", gap: 6 }}>
        {["selfie", "ktp", "sim"].map(slot => (
          <span key={slot} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: drv[`foto_${slot}`] ? "#1a4a2a" : "#21262d", color: drv[`foto_${slot}`] ? "#56d364" : "#484f58", border: `1px solid ${drv[`foto_${slot}`] ? "#2ea043" : "#30363d"}` }}>
            {slot === "selfie" ? "📸 Foto" : slot === "ktp" ? "🪪 KTP" : "🚗 SIM"} {drv[`foto_${slot}`] ? "✓" : "—"}
          </span>
        ))}
      </div>

      {/* Actions */}
      <div style={{ padding: "10px 16px", borderTop: "1px solid #21262d", display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={{ ...S.btn("#EF9F27", "#000"), fontSize: 11, padding: "5px 10px" }} onClick={onDetail}><IcoCamera /> Foto & Detail</button>
        <button style={{ ...S.btn("none", "#8b949e"), border: "1px solid #30363d", fontSize: 11, padding: "5px 10px" }} onClick={onEdit}><IcoPencil /> Edit</button>
        <button style={{ ...S.btn("none", "#8b949e"), border: "1px solid #30363d", fontSize: 11, padding: "5px 10px" }} onClick={onPrint}><IcoPrint /> Surat</button>
        <button style={{ ...S.btn("none", "#f85149"), border: "1px solid #f85149", fontSize: 11, padding: "5px 10px", marginLeft: "auto" }} onClick={onDelete}><IcoTrash /></button>
      </div>
    </div>
  );
}

function InfoRow({ ico, val, muted }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 5, fontSize: 11, color: muted ? "#8b949e" : "#e6edf3" }}>
      <span style={{ flexShrink: 0 }}>{ico}</span>
      <span style={{ wordBreak: "break-word" }}>{val}</span>
    </div>
  );
}

/* ── Driver Modal (Tambah / Edit) ── */
function DriverModal({ mode, driver, headers, onClose, onSaved }) {
  const [form, setForm] = useState({ nama: "", no_hp: "", no_ktp: "", no_sim: "", tipe_sim: "B1", alamat: "", status: "aktif", ...driver });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.nama.trim()) { alert("Nama wajib diisi"); return; }
    setSaving(true);
    try {
      if (mode === "add") await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers`, form, { headers });
      else await axios.patch(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${driver.driver_id}`, form, { headers });
      onSaved();
    } catch (e) { alert("Gagal: " + (e?.response?.data?.detail || "error")); }
    finally { setSaving(false); }
  };

  const I = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "7px 10px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" };
  const L2 = { fontSize: 10, color: "#8b949e", display: "block", marginBottom: 3, fontWeight: 600 };
  const G = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 500, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#EF9F27" }}>{mode === "add" ? "Tambah Driver Baru" : `Edit — ${driver.nama}`}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}><IcoX /></button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Nama Lengkap *</label>
            <input style={I} value={form.nama} onChange={e => set("nama", e.target.value)} placeholder="Budi Santoso" autoFocus />
          </div>
          <div style={G}>
            <div><label style={L2}>No. HP</label><input style={I} value={form.no_hp} onChange={e => set("no_hp", e.target.value)} placeholder="0812..." /></div>
            <div><label style={L2}>Status</label><select style={I} value={form.status} onChange={e => set("status", e.target.value)}>{STATUS_OPTS.map(s => <option key={s}>{s}</option>)}</select></div>
          </div>
          <div style={G}>
            <div><label style={L2}>No. KTP</label><input style={I} value={form.no_ktp} onChange={e => set("no_ktp", e.target.value)} placeholder="3271..." /></div>
            <div><label style={L2}>No. SIM</label><input style={I} value={form.no_sim} onChange={e => set("no_sim", e.target.value)} placeholder="..." /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Tipe SIM</label>
            <div style={{ display: "flex", gap: 6 }}>
              {TIPE_SIM.map(t => (
                <button key={t} onClick={() => set("tipe_sim", t)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${form.tipe_sim === t ? "#EF9F27" : "#30363d"}`, background: form.tipe_sim === t ? "#2b1d0e" : "none", color: form.tipe_sim === t ? "#EF9F27" : "#8b949e", cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={L2}>Alamat</label>
            <textarea style={{ ...I, resize: "none" }} rows={2} value={form.alamat} onChange={e => set("alamat", e.target.value)} placeholder="Alamat domisili driver" />
          </div>
        </div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid #21262d", display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Batal</button>
          <button onClick={submit} disabled={saving} style={{ padding: "8px 20px", borderRadius: 7, border: "none", background: "#EF9F27", color: "#000", cursor: "pointer", fontSize: 12, fontWeight: 800 }}>
            {saving ? "Menyimpan..." : mode === "add" ? "Tambah Driver" : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail / Foto Modal ── */
function DetailModal({ drv, headers, onClose, onPrint, flash }) {
  const fileRefs = { selfie: useRef(), ktp: useRef(), sim: useRef() };
  const [uploading, setUploading] = useState(null);
  const [localDrv, setLocalDrv] = useState(drv);

  const uploadFoto = async (slot, file) => {
    if (!file) return;
    setUploading(slot);
    const fd = new FormData(); fd.append("foto", file);
    try {
      const r = await axios.post(`${process.env.REACT_APP_BACKEND_URL}/api/admin/drivers/${drv.driver_id}/foto/${slot}`, fd, { headers: { ...headers, "Content-Type": "multipart/form-data" } });
      setLocalDrv(d => ({ ...d, [`foto_${slot}`]: r.data.url }));
      flash("Foto berhasil diupload!");
    } catch { flash("Gagal upload foto"); }
    finally { setUploading(null); }
  };

  const SLOTS = [
    { key: "selfie", label: "Foto Driver", ico: "📸" },
    { key: "ktp",    label: "Foto KTP",    ico: "🪪" },
    { key: "sim",    label: "Foto SIM",    ico: "🚗" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: "#EF9F27" }}>Foto & Detail — {localDrv.nama}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={onPrint} style={{ ...S.btn("#30363d", "#e6edf3"), fontSize: 11, padding: "5px 10px" }}><IcoPrint /> Surat Pengantar</button>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", cursor: "pointer" }}><IcoX /></button>
          </div>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {SLOTS.map(sl => (
              <div key={sl.key} style={{ textAlign: "center" }}>
                <div style={{ width: "100%", aspectRatio: "4/3", background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 8, cursor: "pointer", position: "relative" }}
                  onClick={() => fileRefs[sl.key].current?.click()}>
                  {localDrv[`foto_${sl.key}`]
                    ? <img src={localDrv[`foto_${sl.key}`]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontSize: 32 }}>{sl.ico}</span>}
                  <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: ".2s" }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 1} onMouseLeave={e => e.currentTarget.style.opacity = 0}>
                    <IcoCamera />
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>{sl.label}</div>
                <button onClick={() => fileRefs[sl.key].current?.click()} disabled={uploading === sl.key}
                  style={{ fontSize: 10, padding: "4px 10px", borderRadius: 6, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", width: "100%" }}>
                  {uploading === sl.key ? "Uploading..." : localDrv[`foto_${sl.key}`] ? "Ganti Foto" : "Upload"}
                </button>
                <input ref={fileRefs[sl.key]} type="file" accept="image/*" style={{ display: "none" }} onChange={e => uploadFoto(sl.key, e.target.files[0])} />
              </div>
            ))}
          </div>

          <div style={{ background: "#0d1117", borderRadius: 8, padding: 14 }}>
            {[
              ["ID Driver", localDrv.driver_id], ["Nama", localDrv.nama], ["No. HP", localDrv.no_hp || "—"],
              ["No. KTP", localDrv.no_ktp || "—"], ["No. SIM", localDrv.no_sim ? `${localDrv.no_sim} (SIM ${localDrv.tipe_sim || "?"})` : "—"],
              ["Alamat", localDrv.alamat || "—"], ["Status", localDrv.status], ["Bergabung", fmtDate(localDrv.created_at)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 12, borderBottom: "1px solid #21262d", padding: "7px 0", fontSize: 12 }}>
                <span style={{ color: "#8b949e", width: 100, flexShrink: 0 }}>{k}</span>
                <span style={{ fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
