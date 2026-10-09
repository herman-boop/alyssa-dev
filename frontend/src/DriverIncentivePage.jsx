import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

/*
  Insentif Driver (borongan): bonus per foto checkpoint yang masuk, dicatat otomatis ke antrean ini.
  Admin cek foto + lokasi, lalu Bayar (transfer manual, bukti opsional) atau Tolak (mis. foto screenshot peta).
  TIDAK ada uang keluar otomatis dari aplikasi.
*/
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

const rp = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const media = (u) => {
  if (!u) return "";
  if (/^https?:\/\//.test(u)) return u.includes("/storage/v1/object/public/") ? `${API}/media?u=${encodeURIComponent(u)}` : u;
  return `${BACKEND_URL}${u}`;
};

const TABS = [["menunggu", "Menunggu"], ["dibayar", "Dibayar"], ["ditolak", "Ditolak"], ["riwayat", "Riwayat Transfer"]];
const BANKS = ["bca", "bni", "bri", "mandiri", "cimb", "permata", "danamon", "btn", "bsi"];   // kode bank Flip; cocokkan dengan dokumentasi Flip
const BADGE = {
  menunggu: { bg: "#E0F2FE", fg: "#075985", bd: "#7DD3FC" },
  dibayar: { bg: "#DCFCE7", fg: "#166534", bd: "#86EFAC" },
  ditolak: { bg: "#EDE9FE", fg: "#5B21B6", bd: "#C4B5FD" },
};

export default function DriverIncentivePage() {
  const headers = useMemo(() => ({ "x-admin-pin": typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "" }), []);
  const [tab, setTab] = useState("menunggu");
  const [q, setQ] = useState("");
  const [data, setData] = useState({ items: [], per_driver: [], total_menunggu: 0 });
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ t: "", err: false });
  const [payFor, setPayFor] = useState(null);
  const [payNote, setPayNote] = useState("");
  const [payAkun, setPayAkun] = useState("");    // akun kas yang dikurangi saat bayar manual
  const [akunList, setAkunList] = useState([]);
  const fileRef = useRef(null);
  // ── Transfer via Flip ──
  const [cfg, setCfg] = useState(null);
  const [fp, setFp] = useState(null);          // { driver, total, bank, acc, inq, confirm, result }
  const [logs, setLogs] = useState([]);

  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API}/admin/driver-incentives`, { headers, params: { status: tab, q: q || undefined } });
      setData(r.data);
    } catch (e) { setMsg({ t: e.response?.data?.detail || "Gagal memuat insentif", err: true }); }
  }, [headers, tab, q]);
  useEffect(() => { if (tab !== "riwayat") load(); }, [load, tab]);
  useEffect(() => { axios.get(`${API}/admin/payouts/config`, { headers }).then((r) => setCfg(r.data)).catch(() => setCfg(null)); }, [headers]);
  const loadLogs = useCallback(async () => {
    try { const r = await axios.get(`${API}/admin/payout-logs`, { headers, params: { kind: "disbursement" } }); setLogs(r.data.items || []); }
    catch (e) { setMsg({ t: e.response?.data?.detail || "Gagal memuat riwayat", err: true }); }
  }, [headers]);
  useEffect(() => { if (tab === "riwayat") loadLogs(); }, [tab, loadLogs]);

  useEffect(() => { axios.get(`${API}/admin/kas/accounts`, { headers }).then((r) => setAkunList(r.data.items || [])).catch(() => {}); }, [headers]);
  const errOf = (e, d) => e.response?.data?.detail || d;
  const openFlip = async (d) => {
    let bank = "bca", acc = "";
    try { const r = await axios.get(`${API}/admin/payouts/bank`, { headers, params: { driver: d.driver_nama } }); if (r.data.bank) { bank = r.data.bank.bank_code || bank; acc = r.data.bank.account_number || ""; } } catch (e) { /* abaikan */ }
    setFp({ driver: d.driver_nama, total: d.total, count: d.count, bank, acc, inq: null, confirm: "", result: null, busy: false, err: "" });
  };
  const cekRekening = async () => {
    setFp((f) => ({ ...f, busy: true, err: "", inq: null, confirm: "" }));
    try {
      const r = await axios.post(`${API}/admin/payouts/inquiry`, { driver_nama: fp.driver, bank_code: fp.bank, account_number: fp.acc }, { headers });
      setFp((f) => ({ ...f, busy: false, inq: r.data }));
    } catch (e) { setFp((f) => ({ ...f, busy: false, err: errOf(e, "Cek rekening gagal") })); }
  };
  const transfer = async () => {
    setFp((f) => ({ ...f, busy: true, err: "" }));
    try {
      const r = await axios.post(`${API}/admin/payouts/disburse`, { inquiry_id: fp.inq.inquiry_id, confirm_name: fp.confirm }, { headers, timeout: 60000 });
      setFp((f) => ({ ...f, busy: false, inq: null, result: r.data.log }));
      await load();
    } catch (e) { setFp((f) => ({ ...f, busy: false, err: errOf(e, "Transfer gagal") })); }
  };
  const refreshLog = async (id) => {
    try { await axios.post(`${API}/admin/payouts/${id}/refresh`, {}, { headers }); await loadLogs(); await load(); setMsg({ t: "Status diperbarui", err: false }); }
    catch (e) { setMsg({ t: errOf(e, "Gagal cek status"), err: true }); }
  };

  const act = async (id, path, form) => {
    setBusy(id); setMsg({ t: "", err: false });
    try {
      const r = await axios.post(`${API}/admin/driver-incentives/${id}/${path}`, form, { headers, timeout: 120000 });
      setMsg({ t: r.data.kas_warning || r.data.bukti_warning || "Tersimpan", err: !!(r.data.bukti_warning || r.data.kas_warning) });
      setPayFor(null); setPayNote("");
      await load();
    } catch (e) { setMsg({ t: e.response?.data?.detail || "Gagal menyimpan", err: true }); }
    finally { setBusy(""); }
  };

  const doPay = (id) => {
    const fd = new FormData();
    fd.append("catatan", payNote);
    if (payAkun) fd.append("akun_id", payAkun);
    const f = fileRef.current && fileRef.current.files && fileRef.current.files[0];
    if (f) fd.append("bukti", f);
    act(id, "bayar", fd);
  };
  const doReject = (id) => {
    const alasan = window.prompt("Alasan menolak (mis. foto screenshot peta, bukan foto lokasi):");
    if (alasan == null) return;
    if (!alasan.trim()) { setMsg({ t: "Alasan penolakan wajib diisi", err: true }); return; }
    const fd = new FormData(); fd.append("catatan", alasan);
    act(id, "tolak", fd);
  };

  const card = { background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 14 };
  const btn = (bg, fg) => ({ padding: "8px 14px", borderRadius: 8, border: "none", background: bg, color: fg, fontWeight: 800, fontSize: 12.5, cursor: "pointer" });

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", color: "#e6edf3" }} data-testid="insentif-page">
      <p style={{ fontSize: 12.5, color: "#8b949e", margin: "0 0 12px" }}>
        Bonus per foto checkpoint driver borongan. Aktifkan per trip lewat <b>Atur Bonus Driver</b>. Cek foto dulu sebelum bayar; pembayaran dilakukan manual.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {TABS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} data-testid={`insentif-tab-${k}`}
            style={{ ...btn(tab === k ? "#EF9F27" : "#21262d", tab === k ? "#1a1208" : "#c9d1d9"), border: "1px solid #30363d" }}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari driver / nopol / trip"
          style={{ flex: 1, minWidth: 180, background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="insentif-search" />
      </div>

      {cfg ? (
        <div data-testid="flip-banner" style={{ fontSize: 12, marginBottom: 10, color: cfg.enabled ? "#79c0ff" : "#8b949e" }}>
          {cfg.enabled ? `Transfer Flip aktif · mode ${cfg.env.toUpperCase()}${cfg.env === "sandbox" ? " (uji coba, uang tidak sungguhan)" : ""} · batas Rp ${Number(cfg.max_amount).toLocaleString("id-ID")} per transfer` : "Transfer Flip belum aktif. Pembayaran dilakukan manual."}
        </div>
      ) : null}

      {tab === "menunggu" && data.per_driver.length > 0 ? (
        <div style={{ ...card, marginBottom: 12 }} data-testid="insentif-summary">
          <div style={{ fontSize: 11, color: "#8b949e", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>Yang harus dibayar · total {rp(data.total_menunggu)}</div>
          {data.per_driver.map((d) => (
            <div key={d.driver_nama} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", fontSize: 13.5 }}>
              <span style={{ fontWeight: 700 }}>{d.driver_nama} <span style={{ color: "#8b949e", fontWeight: 500 }}>· {d.count} checkpoint</span></span>
              <span style={{ fontWeight: 800 }}>{rp(d.total)}
                {cfg && cfg.enabled ? <button type="button" onClick={() => openFlip(d)} style={{ ...btn("#1D4ED8", "#fff"), marginLeft: 10, padding: "5px 10px" }} data-testid={`flip-open-${d.driver_nama}`}>Transfer via Flip</button> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {fp ? (
        <div style={{ ...card, marginBottom: 12, borderColor: "#1D4ED8" }} data-testid="flip-panel">
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Transfer ke {fp.driver} · {fp.count} checkpoint · {rp(fp.total)}</div>
          {fp.result ? (
            <div data-testid="flip-result">
              <div style={{ fontWeight: 800, color: fp.result.status === "berhasil" ? "#79c0ff" : "#d2a8ff" }}>Status: {fp.result.status.replace("_", " ")}</div>
              {fp.result.error ? <div style={{ fontSize: 12.5, color: "#c9d1d9" }}>{fp.result.error}</div> : null}
              {fp.result.status === "tidak_pasti" ? <div style={{ fontSize: 12.5, color: "#c9d1d9" }}>Hasil belum pasti. Jangan transfer ulang. Cek di tab Riwayat Transfer.</div> : null}
              <button type="button" onClick={() => setFp(null)} style={{ ...btn("#21262d", "#c9d1d9"), marginTop: 8 }}>Tutup</button>
            </div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
                <input list="flip-banks" value={fp.bank} onChange={(e) => setFp({ ...fp, bank: e.target.value, inq: null })} placeholder="Kode bank" style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="flip-bank" />
                <datalist id="flip-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
                <input value={fp.acc} onChange={(e) => setFp({ ...fp, acc: e.target.value, inq: null })} placeholder="Nomor rekening" inputMode="numeric" style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="flip-acc" />
              </div>
              <button type="button" disabled={fp.busy || !fp.acc} onClick={cekRekening} style={{ ...btn("#21262d", "#79c0ff"), marginTop: 8 }} data-testid="flip-cek">{fp.busy && !fp.inq ? "Mengecek…" : "Cek Rekening"}</button>
              {fp.inq ? (
                <div style={{ marginTop: 10 }} data-testid="flip-inq">
                  <div style={{ fontSize: 12.5, color: "#8b949e" }}>Pemilik rekening {fp.inq.account_masked}:</div>
                  <div style={{ fontWeight: 900, fontSize: 16 }} data-testid="flip-holder">{fp.inq.account_holder}</div>
                  <input value={fp.confirm} onChange={(e) => setFp({ ...fp, confirm: e.target.value })} placeholder="Ketik ulang nama pemilik di atas untuk konfirmasi" style={{ width: "100%", boxSizing: "border-box", marginTop: 8, background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="flip-confirm" />
                  <button type="button" disabled={fp.busy || fp.confirm.trim().toLowerCase() !== fp.inq.account_holder.trim().toLowerCase()} onClick={transfer} style={{ ...btn("#1D4ED8", "#fff"), marginTop: 8 }} data-testid="flip-transfer">{fp.busy ? "Mengirim…" : `Transfer ${rp(fp.total)}`}</button>
                </div>
              ) : null}
              {fp.err ? <div style={{ marginTop: 8, color: "#d2a8ff", fontSize: 12.5 }} data-testid="flip-err">{fp.err}</div> : null}
              <button type="button" onClick={() => setFp(null)} style={{ ...btn("#21262d", "#c9d1d9"), marginTop: 8, marginLeft: fp.inq ? 8 : 0 }}>Batal</button>
            </>
          )}
        </div>
      ) : null}

      {msg.t ? <div role="status" style={{ ...card, marginBottom: 12, color: msg.err ? "#d2a8ff" : "#79c0ff" }} data-testid="insentif-msg">{msg.t}</div> : null}

      {tab === "riwayat" ? (
        logs.length === 0 ? <div style={{ ...card, color: "#8b949e", textAlign: "center" }} data-testid="riwayat-empty">Belum ada transfer.</div> : (
          <div style={{ display: "grid", gap: 10 }} data-testid="riwayat-list">
            {logs.map((l) => (
              <div key={l.id} style={card} data-testid={`riwayat-${l.id}`} data-status={l.status}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <b>{l.driver_nama} · {rp(l.amount)}</b>
                  <span style={{ fontWeight: 800, textTransform: "uppercase", fontSize: 12, color: l.status === "berhasil" ? "#79c0ff" : l.status === "gagal" ? "#d2a8ff" : "#EF9F27" }}>{l.status.replace("_", " ")}</span>
                </div>
                <div style={{ fontSize: 12.5, color: "#8b949e", marginTop: 3 }}>{(l.created_at || "").slice(0, 16).replace("T", " ")} · {l.bank_code.toUpperCase()} {l.account_masked} · a.n. {l.account_holder} · {l.env}</div>
                {l.error ? <div style={{ fontSize: 12.5, color: "#c9d1d9", marginTop: 3 }}>{l.error}</div> : null}
                {(l.status === "tidak_pasti" || l.status === "diproses") ? <button type="button" onClick={() => refreshLog(l.id)} style={{ ...btn("#21262d", "#79c0ff"), marginTop: 8 }} data-testid={`riwayat-refresh-${l.id}`}>Cek status ke Flip</button> : null}
              </div>
            ))}
          </div>
        )
      ) : null}

      {tab === "riwayat" ? null : data.items.length === 0 ? <div style={{ ...card, color: "#8b949e", textAlign: "center" }} data-testid="insentif-empty">Tidak ada data.</div> : (
        <div style={{ display: "grid", gap: 10 }} data-testid="insentif-list">
          {data.items.map((it) => {
            const b = BADGE[it.status] || BADGE.menunggu;
            return (
              <div key={it.id} style={{ ...card, display: "flex", gap: 12, flexWrap: "wrap" }} data-testid={`insentif-${it.id}`} data-status={it.status}>
                {it.foto_url ? (
                  <a href={media(it.foto_url)} target="_blank" rel="noopener noreferrer" aria-label="Buka foto checkpoint">
                    <img src={media(it.foto_url)} alt="Foto checkpoint" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 10, border: "1px solid #30363d" }} />
                  </a>
                ) : null}
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <b style={{ fontSize: 14.5 }}>{it.driver_nama || "(tanpa nama)"} {it.nopol ? <span style={{ color: "#8b949e", fontWeight: 500 }}>· {it.nopol}</span> : null}</b>
                    <span style={{ fontWeight: 900, fontSize: 15 }}>{rp(it.amount)}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "#8b949e", marginTop: 3 }}>{it.date}{it.status_cp ? ` · ${it.status_cp}` : ""} · Trip {it.trip_id}</div>
                  <div style={{ fontSize: 12.5, color: "#c9d1d9", marginTop: 3 }}>
                    {it.alamat || "Lokasi tidak tercatat"}
                    {it.lat != null && it.lng != null ? <> · <a href={`https://www.google.com/maps?q=${it.lat},${it.lng}`} target="_blank" rel="noopener noreferrer" style={{ color: "#58a6ff" }}>Lihat di peta</a></> : null}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <span style={{ background: b.bg, color: b.fg, border: `1px solid ${b.bd}`, borderRadius: 999, padding: "2px 10px", fontSize: 11.5, fontWeight: 800, textTransform: "uppercase" }}>{it.status}</span>
                    {it.catatan ? <span style={{ fontSize: 12, color: "#8b949e", marginLeft: 8 }}>{it.catatan}</span> : null}
                    {it.bukti_url ? <a href={media(it.bukti_url)} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#58a6ff", marginLeft: 8 }}>Lihat bukti bayar</a> : null}
                  </div>

                  {it.status === "menunggu" ? (
                    payFor === it.id ? (
                      <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                        <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Catatan (mis. transfer BCA)" style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="insentif-pay-note" />
                        <select value={payAkun} onChange={(e) => setPayAkun(e.target.value)} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 8, padding: "8px 12px", color: "#e6edf3", fontSize: 13 }} data-testid="insentif-pay-akun">
                          <option value="">Dibayar dari akun… (opsional, mengurangi saldo Kas & Bank)</option>
                          {akunList.map((a) => <option key={a.id} value={a.id}>{a.nama}</option>)}
                        </select>
                        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" style={{ fontSize: 12.5, color: "#c9d1d9" }} data-testid="insentif-pay-file" />
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" disabled={busy === it.id} onClick={() => doPay(it.id)} style={btn("#1D4ED8", "#fff")} data-testid="insentif-pay-confirm">{busy === it.id ? "Menyimpan…" : "Tandai Dibayar"}</button>
                          <button type="button" onClick={() => setPayFor(null)} style={btn("#21262d", "#c9d1d9")}>Batal</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                        <button type="button" onClick={() => { setPayFor(it.id); setPayNote(""); }} style={btn("#1D4ED8", "#fff")} data-testid={`insentif-bayar-${it.id}`}>Bayar</button>
                        <button type="button" disabled={busy === it.id} onClick={() => doReject(it.id)} style={btn("#21262d", "#d2a8ff")} data-testid={`insentif-tolak-${it.id}`}>Tolak</button>
                      </div>
                    )
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <button type="button" disabled={busy === it.id} onClick={() => act(it.id, "reset", new FormData())} style={btn("#21262d", "#c9d1d9")} data-testid={`insentif-reset-${it.id}`}>Buka lagi</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
