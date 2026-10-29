import { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";

/*
  Aktivitas & KPI.
  - Semua akun operasional: Riwayat Aktivitas (siapa melakukan apa, kapan).
  - Admin Operasional 2 (rekrutan baru): Tugas Saya + KPI pekan ini (poin per trip, grafik, Submit).
  - Pemilik: pilih akun, tinjau trip (BASTK belum jelas / klaim / tolak checkpoint), tandai pekan sudah dibayar.
  Aturan poin: 1 trip mulus = 1 poin = Rp 50.000; pekan dihitung Minggu 09:00 WIB, dibayar Senin 09:00.
*/
const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const C = { hijau: "#3fb950", kuning: "#e3b341", merah: "#f85149", proses: "#8b98ab" };
const LBL = { hijau: "Hijau", kuning: "Kuning", merah: "Merah", proses: "Proses" };
const CARD = { background: "#11161f", border: "1px solid #232a36", borderRadius: 12, padding: 14, marginBottom: 14 };
const H3 = { fontSize: 11.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "#8b949e", margin: "0 0 10px" };
const BTN = { padding: "8px 14px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 12.5, cursor: "pointer" };
const BTN2 = { padding: "7px 12px", borderRadius: 8, border: "1px solid #30363d", background: "#1c2128", color: "#e6edf3", fontWeight: 700, fontSize: 12, cursor: "pointer" };
const IN = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "8px 10px", color: "#e6edf3", fontSize: 13, outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const poinTxt = (n) => String(Number(n) || 0).replace(".", ",");
const fmtWaktu = (iso) => {
  try { return new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }); } catch { return iso || ""; }
};
const fmtTgl = (iso) => {
  try { return new Date(iso).toLocaleString("id-ID", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }); } catch { return iso || ""; }
};
const wibDate = (iso) => { try { return new Date(new Date(iso).getTime() + 7 * 3600e3).toISOString().slice(0, 10); } catch { return ""; } };

function getHeaders() {
  const h = {};
  try {
    const t = localStorage.getItem("aal_user_token");
    if (t) h.Authorization = `Bearer ${t}`;
    h["x-admin-pin"] = localStorage.getItem("aal_admin_pin") || "";
  } catch (e) { /* storage tidak tersedia */ }
  return h;
}
const errTxt = (e, d) => e?.response?.data?.detail || d;
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const fotoUrl = (u) => {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) return u.includes("/storage/v1/object/public/") ? `${API}/media?u=${encodeURIComponent(u)}` : u;
  return `${BACKEND_URL}${u}`;
};

/* Deretan gambar kecil; klik membuka ukuran penuh. PDF tampil sebagai kotak "PDF". */
function Galeri({ judul, items, kosong }) {
  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 700, marginBottom: 4 }}>{judul} ({items.length})</div>
      {items.length === 0 ? <div style={{ fontSize: 12, color: "#f85149" }}>{kosong}</div> : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {items.map((f, i) => {
            const u = fotoUrl(f.url);
            const pdf = /\.pdf(\?|$)/i.test(f.url || "");
            return (
              <a key={f.id || i} href={u} target="_blank" rel="noreferrer" title={f.cap || ""} style={{ position: "relative", width: 76, height: 76, borderRadius: 8, overflow: "hidden", background: "#1c2128", border: f.manual ? "2px solid #e3b341" : "1px solid #30363d", display: "flex", alignItems: "center", justifyContent: "center", color: "#8b949e", fontSize: 11, textDecoration: "none" }}>
                {pdf ? "PDF" : <img src={u} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                {f.cap ? <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,.65)", color: "#fff", fontSize: 9.5, textAlign: "center", padding: "1px 0" }}>{f.cap}</span> : null}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Grafik: batang bertumpuk per hari (Min–Sab) + total per warna ── */
function Grafik({ data }) {
  const t = data.totals || {};
  const total = (t.hijau || 0) + (t.kuning || 0) + (t.merah || 0) + (t.proses || 0);
  const mulai = new Date(data.mulai);
  const hari = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mulai.getTime() + i * 86400e3);
    return { tgl: wibDate(d.toISOString()), lbl: d.toLocaleDateString("id-ID", { weekday: "short", timeZone: "Asia/Jakarta" }), hijau: 0, kuning: 0, merah: 0 };
  });
  (data.trips || []).forEach((r) => {
    const h = hari.find((x) => x.tgl === wibDate(r.submitted_at));
    if (h && h[r.status] !== undefined) h[r.status] += 1;
  });
  const maks = Math.max(1, ...hari.map((h) => h.hijau + h.kuning + h.merah));
  return (
    <div data-testid="kpi-grafik">
      <div style={{ display: "flex", height: 18, borderRadius: 9, overflow: "hidden", background: "#1c2128", marginBottom: 8 }}>
        {["hijau", "kuning", "merah", "proses"].map((k) => (t[k] ? <div key={k} title={`${LBL[k]}: ${t[k]}`} style={{ width: `${(t[k] / Math.max(total, 1)) * 100}%`, background: C[k] }} /> : null))}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginBottom: 14 }}>
        {["hijau", "kuning", "merah", "proses"].map((k) => (
          <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: C[k] }} /> {LBL[k]} <b>{t[k] || 0}</b>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 90 }}>
        {hari.map((h) => {
          const n = h.hijau + h.kuning + h.merah;
          return (
            <div key={h.tgl} style={{ flex: 1, textAlign: "center", fontSize: 10.5, color: "#8b949e" }}>
              <div style={{ height: 64, display: "flex", flexDirection: "column-reverse", justifyContent: "flex-start", alignItems: "center" }}>
                {["hijau", "kuning", "merah"].map((k) => (h[k] ? <div key={k} style={{ width: "70%", height: `${(h[k] / maks) * 100}%`, background: C[k], minHeight: 4 }} /> : null))}
              </div>
              <div style={{ color: "#e6edf3", fontWeight: 700 }}>{n || ""}</div>
              <div>{h.lbl}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Tinjau 1 trip (Pemilik) ── */
function TinjauPanel({ row, onSaved, setMsg }) {
  const f = row.flags || {};
  const [bj, setBj] = useState(!!f.bastk_tidak_jelas);
  const [asalNo, setAsalNo] = useState(!!f.asal_tidak_sah);
  const [klaim, setKlaim] = useState(!!f.klaim);
  const [tolak, setTolak] = useState(!!f.ditolak);
  const [cat, setCat] = useState(f.catatan || "");
  const [tolakCp, setTolakCp] = useState(f.tolak_cp || []);
  const [trip, setTrip] = useState(null);
  const manual = (trip?.daily_checkpoints || []).filter((c) => c.manual);
  useEffect(() => {
    axios.get(`${API}/public/trips/${row.trip_id}`).then((r) => setTrip(r.data || {})).catch(() => setTrip({}));
  }, [row.trip_id]);
  const simpan = async () => {
    try {
      await axios.post(`${API}/admin/kpi/tinjau/${row.trip_id}`, { bastk_tidak_jelas: bj, asal_tidak_sah: asalNo, klaim, ditolak: tolak, catatan: cat, tolak_cp: tolakCp }, { headers: getHeaders() });
      setMsg({ t: "✓ Tinjauan disimpan", err: false });
      onSaved();
    } catch (e) { setMsg({ t: errTxt(e, "Gagal menyimpan tinjauan"), err: true }); }
  };
  const cb = (v, set, txt) => (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
      <input type="checkbox" checked={v} onChange={(e) => set(e.target.checked)} /> {txt}
    </label>
  );
  return (
    <div style={{ background: "#0d1117", border: "1px solid #232a36", borderRadius: 10, padding: 12, marginTop: 8 }}>
      {!trip ? <div style={{ fontSize: 12, color: "#8b949e" }}>Memuat foto…</div> : (
        <>
          <Galeri judul="Foto asal" items={(trip.album?.asal || []).map((a) => ({ id: a.id, url: a.url, cap: a.uploaded_by === "admin" ? "admin" : "" }))} kosong="Belum ada foto asal" />
          <Galeri judul="Checkpoint harian" items={(trip.daily_checkpoints || []).map((c) => ({ id: c.id, url: c.url, cap: (c.date || "").slice(5), manual: !!c.manual }))} kosong="Belum ada checkpoint" />
          <Galeri judul="BASTK" items={(trip.handover?.bastk || []).map((b) => ({ id: b.id, url: b.url }))} kosong="Belum ada BASTK" />
        </>
      )}
      {cb(asalNo, setAsalNo, "Foto asal tidak sah / bukan foto kendaraan (nilai jadi 0,5)")}
      {cb(bj, setBj, "BASTK belum jelas (nilai jadi 0,5)")}
      {cb(klaim, setKlaim, "Ada klaim (gugur, 0 poin)")}
      {cb(tolak, setTolak, "Tolak trip ini (gugur, 0 poin)")}
      {manual && manual.length > 0 && (
        <div style={{ margin: "8px 0" }}>
          <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 700, marginBottom: 4 }}>CHECKPOINT MANUAL (input akun)</div>
          {manual.map((c) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", cursor: "pointer" }}>
              <input type="checkbox" checked={tolakCp.includes(c.id)} onChange={(e) => setTolakCp((x) => (e.target.checked ? [...x, c.id] : x.filter((i) => i !== c.id)))} />
              Tolak · {c.date} {c.alamat ? `· ${c.alamat}` : ""}
              {c.url ? <a href={/^https?:/.test(c.url) ? c.url : `${API.replace(/\/api$/, "")}${c.url}`} target="_blank" rel="noreferrer" style={{ color: "#58a6ff" }}>foto</a> : null}
            </label>
          ))}
        </div>
      )}
      <input style={{ ...IN, width: "100%", margin: "6px 0 8px" }} placeholder="Catatan (opsional)" value={cat} onChange={(e) => setCat(e.target.value)} />
      <button style={BTN} onClick={simpan} data-testid="kpi-tinjau-simpan">Simpan tinjauan</button>
    </div>
  );
}

export default function KpiPage({ me }) {
  const role = me?.role || null;
  const isOwner = !role || role === "pemilik";
  const isOps2 = role === "admin_ops_2";
  const tampilKpi = isOwner || isOps2;
  const [minggu, setMinggu] = useState("");          // "" = pekan berjalan
  const [akun, setAkun] = useState([]);
  const [sel, setSel] = useState("");
  const [data, setData] = useState(null);
  const [tugas, setTugas] = useState(null);
  const [akt, setAkt] = useState(null);
  const [buka, setBuka] = useState("");
  const [msg, setMsg] = useState({ t: "", err: false });
  const [busy, setBusy] = useState("");

  const uid = isOwner ? sel : me?.user_id;

  const loadRingkasan = useCallback(async () => {
    if (!isOwner) return;
    try {
      const r = await axios.get(`${API}/admin/kpi/ringkasan`, { headers: getHeaders(), params: minggu ? { minggu } : {} });
      setAkun(r.data.akun || []);
      setSel((s) => s || (r.data.akun && r.data.akun[0] ? r.data.akun[0].user_id : ""));
    } catch (e) { setMsg({ t: errTxt(e, "Gagal memuat ringkasan"), err: true }); }
  }, [isOwner, minggu]);
  useEffect(() => { loadRingkasan(); }, [loadRingkasan]);

  const load = useCallback(async () => {
    const h = getHeaders();
    const ps = minggu ? { minggu } : {};
    if (tampilKpi && uid) {
      axios.get(`${API}/admin/kpi/saya`, { headers: h, params: { ...ps, user_id: uid } }).then((r) => setData(r.data)).catch((e) => { setData(null); setMsg({ t: errTxt(e, "Gagal memuat KPI"), err: true }); });
      axios.get(`${API}/admin/tugas-saya`, { headers: h, params: { user_id: uid } }).then((r) => setTugas(r.data.items || [])).catch(() => setTugas([]));
    }
    const ap = { limit: 80 };
    if (isOwner && uid) ap.user_id = uid;
    axios.get(`${API}/admin/aktivitas`, { headers: h, params: ap }).then((r) => setAkt(r.data.items || [])).catch(() => setAkt([]));
  }, [tampilKpi, uid, minggu, isOwner]);
  useEffect(() => { load(); }, [load]);

  const geser = (arah) => {
    const base = data?.key ? new Date(data.key + "T00:00:00Z") : new Date();
    base.setUTCDate(base.getUTCDate() + 7 * arah);
    setMinggu(base.toISOString().slice(0, 10));
  };

  const submit = async (tripId) => {
    setBusy(tripId); setMsg({ t: "", err: false });
    try {
      const r = await axios.post(`${API}/admin/kpi/submit/${tripId}`, {}, { headers: getHeaders() });
      setMsg({ t: r.data.sudah ? "Trip ini sudah di-submit sebelumnya" : `✓ Ter-submit: ${LBL[r.data.warna] || ""} (${poinTxt(r.data.poin)} poin)`, err: false });
      load(); loadRingkasan();
    } catch (e) { setMsg({ t: errTxt(e, "Gagal submit"), err: true }); }
    setBusy("");
  };
  const bayar = async () => {
    if (!data) return;
    if (!window.confirm(`Tandai pekan ini SUDAH DIBAYAR?\n${poinTxt(data.totals.poin)} poin = ${rp(data.totals.rupiah)}\nSetelah ini nilainya dikunci.`)) return;
    setBusy("bayar");
    try {
      await axios.post(`${API}/admin/kpi/bayar`, { user_id: uid, minggu: data.key }, { headers: getHeaders() });
      setMsg({ t: "✓ Pekan ditandai sudah dibayar", err: false });
      load(); loadRingkasan();
    } catch (e) { setMsg({ t: errTxt(e, "Gagal menandai dibayar"), err: true }); }
    setBusy("");
  };

  const t = data?.totals || {};
  const rows = useMemo(() => [...(data?.trips || []), ...(data?.proses || [])], [data]);
  const ICON = { konversi: "📦", leg: "🧭", driver: "🧑‍✈️", foto_asal: "📷", checkpoint: "📍", submit: "✅" };

  return (
    <div data-testid="kpi-page" style={{ maxWidth: 980 }}>
      {msg.t ? <div style={{ ...CARD, borderColor: msg.err ? "#f85149" : "#3fb950", color: msg.err ? "#f85149" : "#3fb950", fontSize: 13 }}>{msg.t}</div> : null}

      {tampilKpi && (
        <>
          <div style={{ ...CARD, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {isOwner && (
              <select style={{ ...IN, minWidth: 190 }} value={sel} onChange={(e) => setSel(e.target.value)} data-testid="kpi-akun">
                {akun.length === 0 ? <option value="">(belum ada akun Admin Operasional 2)</option> : null}
                {akun.map((a) => <option key={a.user_id} value={a.user_id}>{a.nama} · {poinTxt(a.totals?.poin)} poin</option>)}
              </select>
            )}
            <button style={BTN2} onClick={() => geser(-1)}>‹ Pekan lalu</button>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {data ? `${fmtTgl(data.mulai)} → ${fmtTgl(data.selesai)}` : "Memuat…"}
              <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 500 }}>Dibayar {data ? fmtTgl(data.bayar_pada) : ""} (Senin 09:00)</div>
            </div>
            <button style={BTN2} onClick={() => geser(1)}>Pekan depan ›</button>
            {minggu ? <button style={BTN2} onClick={() => setMinggu("")}>Pekan ini</button> : null}
          </div>

          {data && (
            <div style={CARD}>
              <h3 style={H3}>KPI {isOwner ? "akun terpilih" : "saya"} · {data.terbayar ? "SUDAH DIBAYAR" : "pekan berjalan"}</h3>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                <div style={{ flex: "1 1 130px" }}><div style={{ fontSize: 28, fontWeight: 900, color: "#EF9F27" }} data-testid="kpi-poin">{poinTxt(t.poin)}</div><div style={{ fontSize: 11, color: "#8b949e" }}>POIN</div></div>
                <div style={{ flex: "1 1 160px" }}><div style={{ fontSize: 28, fontWeight: 900, color: "#3fb950" }} data-testid="kpi-rupiah">{rp(t.rupiah)}</div><div style={{ fontSize: 11, color: "#8b949e" }}>YANG AKAN DIBAYAR</div></div>
                <div style={{ flex: "1 1 120px" }}><div style={{ fontSize: 28, fontWeight: 900 }}>{(t.hijau || 0) + (t.kuning || 0) + (t.merah || 0)}</div><div style={{ fontSize: 11, color: "#8b949e" }}>TRIP DI-SUBMIT</div></div>
                <div style={{ flex: "1 1 120px" }}><div style={{ fontSize: 28, fontWeight: 900, color: C.proses }}>{t.proses || 0}</div><div style={{ fontSize: 11, color: "#8b949e" }}>MASIH PROSES</div></div>
              </div>
              <Grafik data={data} />
              {isOwner && data.terbayar && <div style={{ marginTop: 12, fontSize: 12.5, color: "#3fb950" }}>✓ Dibayar {fmtWaktu(data.dibayar_pada)} oleh {data.dibayar_oleh}</div>}
              {isOwner && !data.terbayar && data.bisa_dibayar && (
                <button style={{ ...BTN, marginTop: 12 }} disabled={busy === "bayar"} onClick={bayar} data-testid="kpi-bayar">Tandai sudah dibayar · {rp(t.rupiah)}</button>
              )}
              {isOwner && !data.terbayar && !data.bisa_dibayar && <div style={{ marginTop: 12, fontSize: 12, color: "#8b949e" }}>Bisa ditandai dibayar setelah pekan ditutup (Minggu 09:00) dan ada trip ter-submit.</div>}
            </div>
          )}

          {data && (
            <div style={CARD}>
              <h3 style={H3}>Trip pekan ini</h3>
              {rows.length === 0 ? <div style={{ fontSize: 13, color: "#8b949e" }}>Belum ada trip.</div> : null}
              {rows.map((r) => {
                const proses = r.status === "proses";
                return (
                  <div key={r.trip_id} style={{ borderTop: "1px solid #1c2330", padding: "10px 0" }} data-testid="kpi-row">
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ background: C[r.status], color: "#0d1117", fontWeight: 800, fontSize: 11, borderRadius: 999, padding: "2px 10px", minWidth: 52, textAlign: "center" }}>{LBL[r.status]}</span>
                      <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{r.customer || "—"} <span style={{ color: "#8b949e", fontWeight: 500 }}>· {r.trip_id}</span></div>
                        <div style={{ fontSize: 11.5, color: "#8b949e" }}>{r.rute}{r.nopol ? ` · ${r.nopol}` : ""}{r.checkpoint_manual ? ` · ${r.checkpoint_manual} checkpoint manual` : ""}</div>
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 15, minWidth: 40, textAlign: "right" }}>{proses ? "—" : poinTxt(r.poin)}</div>
                      {proses && !data.terbayar && (
                        r.siap
                          ? <button style={BTN} disabled={busy === r.trip_id} onClick={() => submit(r.trip_id)} data-testid="kpi-submit">Submit</button>
                          : <span style={{ fontSize: 11.5, color: "#8b949e", maxWidth: 160 }}>{r.siap_alasan}</span>
                      )}
                      {isOwner && !proses && !data.terbayar && <button style={BTN2} onClick={() => setBuka(buka === r.trip_id ? "" : r.trip_id)}>Tinjau</button>}
                    </div>
                    <div style={{ fontSize: 12, marginTop: 4, color: proses ? "#8b949e" : C[r.status] }}>
                      {proses ? `Sementara: ${LBL[r.warna_sementara]} (${poinTxt(r.poin_sementara)} poin) — ` : ""}{(r.alasan || []).join(" · ")}
                    </div>
                    {buka === r.trip_id && <TinjauPanel row={r} setMsg={setMsg} onSaved={() => { setBuka(""); load(); }} />}
                  </div>
                );
              })}
            </div>
          )}

          <div style={CARD} data-testid="kpi-tugas">
            <h3 style={H3}>{isOwner ? "Tugas akun terpilih" : "Tugas saya"} {tugas ? `(${tugas.length})` : ""}</h3>
            {tugas && tugas.length === 0 ? <div style={{ fontSize: 13, color: "#3fb950" }}>✓ Tidak ada tugas yang menunggu.</div> : null}
            {(tugas || []).map((x, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderTop: i ? "1px solid #1c2330" : "none", fontSize: 13 }}>
                <span>{ICON[x.jenis] || "•"}</span>
                <div style={{ flex: 1 }}>{x.teks}<div style={{ fontSize: 11.5, color: "#8b949e" }}>{x.customer || ""} {x.trip_id ? `· ${x.trip_id}` : x.order_id ? `· ${x.order_id}` : ""}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={CARD} data-testid="kpi-aktivitas">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={H3}>Riwayat aktivitas {isOwner && !sel ? "(semua akun)" : ""}</h3>
          <button style={BTN2} onClick={load}>↻</button>
        </div>
        {akt && akt.length === 0 ? <div style={{ fontSize: 13, color: "#8b949e" }}>Belum ada aktivitas tercatat.</div> : null}
        {(akt || []).map((a) => (
          <div key={a.id} style={{ display: "flex", gap: 10, padding: "7px 0", borderTop: "1px solid #1c2330", fontSize: 13 }}>
            <div style={{ width: 106, flexShrink: 0, color: "#8b949e", fontSize: 11.5 }}>{fmtWaktu(a.ts)}</div>
            <div style={{ flex: 1 }}>
              {isOwner ? <b>{a.nama} </b> : null}{a.aksi}{a.ref ? <span style={{ color: "#8b949e" }}> · {a.ref}</span> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
