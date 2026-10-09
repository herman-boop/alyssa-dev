import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { calcTotals, historyOf, isPdf, rp, toInt } from "./legSupplierCalc";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

/*
  Supplier per Leg & Pembayaran Supplier (tombol "Supplier ➔" di footer kartu pesanan).
  Per leg: supplier (auto-isi dari Master Kontak), Harga Deal, biaya tambahan, pembayaran
  Transfer / Kompensasi + bukti, dan histori. Simpan = sinkron ke Departemen Supplier (backend).
  Tema cerah putih-biru kontras tinggi.
*/

const INK = "text-[#0B1B3A]";
const LABEL = "mb-1 block text-xs font-bold uppercase tracking-wide text-[#1E3A8A]";
const INPUT = "w-full rounded-lg border border-[#93C5FD] bg-white px-3 py-2 text-sm font-semibold text-[#0B1B3A] placeholder:font-normal placeholder:text-[#64748B] focus:border-[#1D4ED8] focus:outline focus:outline-2 focus:outline-[#BFDBFE]";
const BTN = "rounded-lg px-4 py-2 text-sm font-extrabold transition disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} bg-[#1D4ED8] text-white hover:bg-[#1E40AF]`;
const BTN_GHOST = `${BTN} border border-[#93C5FD] bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]`;

function mediaUrl(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url.includes("/storage/v1/object/public/") ? `${API}/media?u=${encodeURIComponent(url)}` : url;
  return `${BACKEND_URL}${url}`;
}

const blankSup = { supplier_id: "", nama: "", pic: "", no_hp: "", email: "", bank: "", no_rekening: "" };

function Money({ value, onChange, placeholder, testid }) {
  const n = toInt(value);
  return (
    <div className="flex items-center rounded-lg border border-[#93C5FD] bg-white focus-within:border-[#1D4ED8] focus-within:outline focus-within:outline-2 focus-within:outline-[#BFDBFE]">
      <span className="pl-3 text-sm font-extrabold text-[#1E3A8A]">Rp</span>
      <input
        inputMode="numeric" value={n ? n.toLocaleString("id-ID") : ""} placeholder={placeholder || "0"}
        onChange={(e) => onChange(toInt(e.target.value))} data-testid={testid}
        className="w-full rounded-lg bg-transparent px-2 py-2 text-sm font-bold text-[#0B1B3A] outline-none placeholder:font-normal placeholder:text-[#64748B]"
      />
    </div>
  );
}

function SupplierPicker({ value, onType, onPick, headers }) {
  const [res, setRes] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const search = (v, delay) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/contacts`, { params: { jenis: "supplier", q: (v || "").trim() || undefined }, headers });
        setRes((r.data.items || []).slice(0, 8)); setOpen(true);
      } catch { setRes([]); }
    }, delay);
  };
  const type = (v) => { onType(v); search(v, 250); };
  return (
    <div className="relative">
      <input className={INPUT} value={value} onChange={(e) => type(e.target.value)} onFocus={() => (res.length ? setOpen(true) : search(value, 0))}
        onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Pilih / cari dari Master Supplier" data-testid="ls-nama" autoComplete="off" />
      {open && res.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[#93C5FD] bg-white shadow-lg" role="listbox">
          {res.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-[#EFF6FF]" onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(c); setOpen(false); }} data-testid={`ls-pick-${c.id}`}>
                <span className="block text-sm font-extrabold text-[#0B1B3A]">{c.nama}</span>
                <span className="block text-xs font-medium text-[#475569]">{[c.no_hp, c.bank, c.no_rekening].filter(Boolean).join(" · ") || "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function BuktiPreview({ url, onClose }) {
  const src = mediaUrl(url);
  return createPortal(
    <div className="fixed inset-0 z-[10002] grid place-items-center bg-[#0B1B3A]/70 p-4" onClick={onClose} data-testid="ls-preview">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#BFDBFE] px-4 py-3">
          <p className={`text-sm font-extrabold ${INK}`}>Bukti Pembayaran</p>
          <button type="button" onClick={onClose} className={BTN_GHOST} data-testid="ls-preview-close">Tutup</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#F1F5F9] p-3">
          {isPdf(url) ? <iframe title="Bukti PDF" src={src} className="h-[70vh] w-full rounded-lg bg-white" /> : <img src={src} alt="Bukti pembayaran" className="mx-auto max-h-[75vh] rounded-lg object-contain" />}
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function LegSupplierModal({ order, headers, onClose }) {
  const tripId = order.trip_id;
  const [legs, setLegs] = useState([]);
  const [sel, setSel] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [rec, setRec] = useState(null);
  const [sup, setSup] = useState(blankSup);
  const [deal, setDeal] = useState(0);
  const [extras, setExtras] = useState([]);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("transfer");
  const [pay, setPay] = useState({ amount: 0, tanggal: "", catatan: "", file: null });
  const [preview, setPreview] = useState("");
  const fileRef = useRef(null);

  const leg = legs[sel];
  const legId = leg && leg.route_leg_id;

  const hydrate = useCallback((r, legInfo) => {
    setRec(r);
    const fromLeg = !(r.supplier && r.supplier.nama) && legInfo && legInfo.nama ? { nama: legInfo.nama, pic: legInfo.pic || "", no_hp: legInfo.no_hp || "", email: legInfo.email || "", bank: legInfo.bank || "", no_rekening: legInfo.no_rekening || "" } : {};
    setSup({ ...blankSup, ...(r.supplier || {}), ...fromLeg });
    setDeal(r.harga_deal || 0);
    setExtras((r.extras || []).map((x) => ({ ...x })));
  }, []);

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/admin/trips/${tripId}/legs`, { headers })
      .then((r) => {
        if (!alive) return;
        const ls = Array.isArray(r.data) ? r.data : (r.data.legs || []);
        setLegs(ls);
        const first = ls.findIndex((l) => l.status !== "Selesai");
        setSel(first >= 0 ? first : 0);
        setPhase(ls.length ? "ready" : "empty");
      })
      .catch(() => alive && setPhase("error"));
    return () => { alive = false; };
  }, [tripId, headers]);

  useEffect(() => {
    if (!legId) return undefined;
    let alive = true;
    setRec(null); setMsg(null);
    axios.get(`${API}/admin/trips/${tripId}/legs/${legId}/supplier`, { headers })
      .then((r) => alive && hydrate(r.data, leg && leg.supplier_info))
      .catch(() => alive && setMsg({ t: "err", s: "Gagal memuat data supplier leg ini." }));
    return () => { alive = false; };
  }, [tripId, legId, headers, hydrate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !preview) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, preview]);

  const totals = useMemo(() => calcTotals({ harga_deal: deal, extras, kompensasi: rec && rec.kompensasi, transfers: rec && rec.transfers }), [deal, extras, rec]);
  const history = useMemo(() => historyOf(rec), [rec]);
  const saved = !!(rec && rec.supplier && rec.supplier.nama);

  const pickContact = (c) => setSup((s) => ({ ...s, nama: c.nama, pic: c.pic || s.pic, no_hp: c.no_hp || s.no_hp, email: c.email || s.email, bank: c.bank || s.bank, no_rekening: c.no_rekening || s.no_rekening, supplier_id: "" }));
  const setExtra = (i, patch) => setExtras((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  const save = async () => {
    if (!sup.nama.trim()) { setMsg({ t: "err", s: "Nama supplier wajib diisi." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await axios.put(`${API}/admin/trips/${tripId}/legs/${legId}/supplier`, { supplier: sup, harga_deal: deal, extras: extras.filter((x) => x.label.trim() || toInt(x.amount)) }, { headers });
      hydrate(r.data);
      setMsg({ t: "ok", s: "Terkirim dan tersinkron ke Departemen Supplier." });
    } catch (e) { setMsg({ t: "err", s: (e.response && e.response.data && e.response.data.detail) || "Gagal menyimpan. Coba lagi." }); }
    finally { setBusy(false); }
  };

  const addPayment = async () => {
    if (!toInt(pay.amount)) { setMsg({ t: "err", s: "Isi Jumlah Bayar." }); return; }
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("tipe", tab); fd.append("amount", String(toInt(pay.amount)));
      if (pay.tanggal) fd.append("tanggal", pay.tanggal);
      if (pay.catatan) fd.append("catatan", pay.catatan);
      if (pay.file) fd.append("bukti", pay.file);
      const r = await axios.post(`${API}/admin/trips/${tripId}/legs/${legId}/supplier/payments`, fd, { headers, timeout: 120000 });
      setRec(r.data);
      setPay({ amount: 0, tanggal: "", catatan: "", file: null });
      if (fileRef.current) fileRef.current.value = "";
      setMsg(r.data.bukti_warning ? { t: "err", s: r.data.bukti_warning } : { t: "ok", s: tab === "transfer" ? "Transfer dicatat." : "Kompensasi dicatat." });
    } catch (e) { setMsg({ t: "err", s: (e.response && e.response.data && e.response.data.detail) || "Gagal mencatat pembayaran." }); }
    finally { setBusy(false); }
  };

  const delPayment = async (p) => {
    if (!window.confirm(`Hapus ${p.tipe === "transfer" ? "transfer" : "kompensasi"} ${rp(p.amount)}?`)) return;
    try {
      const r = await axios.delete(`${API}/admin/trips/${tripId}/legs/${legId}/supplier/payments/${p.id}`, { headers });
      setRec(r.data);
    } catch { setMsg({ t: "err", s: "Gagal menghapus." }); }
  };

  const download = async (p) => {
    try {
      const r = await axios.get(mediaUrl(p.bukti_url), { responseType: "blob" });
      const ext = isPdf(p.bukti_url) ? "pdf" : ((p.bukti_url.split("?")[0].match(/\.(\w{2,4})$/) || [])[1] || "jpg");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(r.data); a.download = `bukti-${p.tipe}-${p.tanggal || p.id}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { window.open(mediaUrl(p.bukti_url), "_blank", "noopener"); }
  };

  const Stat = ({ k, v, strong, accent }) => (
    <div className={`flex items-center justify-between py-1.5 ${strong ? "border-t border-[#93C5FD] pt-2.5" : ""}`}>
      <span className={`text-sm ${strong ? "font-extrabold" : "font-semibold"} text-[#1E3A8A]`}>{k}</span>
      <span className={`font-mono text-sm tabular-nums ${strong ? "text-base font-black" : "font-bold"} ${accent ? "text-[#1D4ED8]" : INK}`}>{v}</span>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#0B1B3A]/60 p-0 sm:p-4" onClick={onClose} data-testid="ls-modal">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-white font-sans sm:h-auto sm:max-h-[94vh] sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-3 border-b border-[#BFDBFE] bg-[#EFF6FF] px-5 py-4">
          <div className="min-w-0">
            <h2 className={`text-lg font-black ${INK}`}>Supplier per Leg &amp; Pembayaran</h2>
            <p className="truncate text-xs font-bold text-[#1E3A8A]">{order.order_id}{order.customer_nama ? ` · ${order.customer_nama}` : ""}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" data-testid="ls-close" className="grid h-9 w-9 flex-none place-items-center rounded-full border border-[#93C5FD] bg-white text-lg font-bold text-[#1D4ED8] hover:bg-[#DBEAFE]">×</button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {phase === "loading" ? <p className="py-10 text-center text-sm font-semibold text-[#475569]">Memuat leg…</p> : null}
          {phase === "error" ? <p className="py-10 text-center text-sm font-bold text-[#1E3A8A]">Gagal memuat leg. Tutup dan coba lagi.</p> : null}
          {phase === "empty" ? <p className="py-10 text-center text-sm font-bold text-[#1E3A8A]" data-testid="ls-empty">Belum ada leg. Susun rute dulu lewat Kelola Leg.</p> : null}

          {phase === "ready" ? (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Pilih leg">
                {legs.map((l, i) => (
                  <button key={l.route_leg_id || i} type="button" role="tab" aria-selected={i === sel} onClick={() => setSel(i)} data-testid={`ls-leg-${i + 1}`}
                    className={`flex-none rounded-full border px-3 py-1.5 text-xs font-extrabold ${i === sel ? "border-[#1D4ED8] bg-[#1D4ED8] text-white" : "border-[#93C5FD] bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]"}`}>
                    Leg {i + 1} · {l.asal || "—"} → {l.tujuan || "—"}
                  </button>
                ))}
              </div>

              {!rec ? <p className="py-6 text-center text-sm font-semibold text-[#475569]">Memuat data supplier…</p> : (
                <>
                  <section aria-label="Supplier" className="rounded-xl border border-[#BFDBFE] p-4">
                    <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-[#1D4ED8]">Supplier</h3>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2"><span className={LABEL}>Nama Supplier</span>
                        <SupplierPicker value={sup.nama} headers={headers} onType={(v) => setSup((s) => ({ ...s, nama: v, supplier_id: "" }))} onPick={pickContact} /></div>
                      {[["pic", "PIC", "Nama PIC"], ["no_hp", "No HP", "08xx…"], ["email", "Email", "email@supplier.id"], ["bank", "Bank", "mis. BCA"], ["no_rekening", "No Rekening", "Nomor rekening"]].map(([k, lbl, ph]) => (
                        <label key={k} className={k === "no_rekening" ? "sm:col-span-2" : ""}><span className={LABEL}>{lbl}</span>
                          <input className={INPUT} value={sup[k] || ""} placeholder={ph} onChange={(e) => setSup((s) => ({ ...s, [k]: e.target.value }))} data-testid={`ls-${k}`} /></label>
                      ))}
                    </div>
                  </section>

                  <section aria-label="Biaya" className="rounded-xl border border-[#BFDBFE] p-4">
                    <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-[#1D4ED8]">Biaya Leg</h3>
                    <span className={LABEL}>Harga Deal (Biaya Utama Supplier)</span>
                    <Money value={deal} onChange={setDeal} testid="ls-deal" />
                    <div className="mt-4 space-y-2" data-testid="ls-extras">
                      {extras.map((x, i) => (
                        <div key={x.id || i} className="grid grid-cols-[1fr_9rem_2.25rem] items-center gap-2">
                          <input className={INPUT} value={x.label} placeholder="BBM, Tol, dll" onChange={(e) => setExtra(i, { label: e.target.value })} data-testid={`ls-extra-label-${i}`} />
                          <Money value={x.amount} onChange={(v) => setExtra(i, { amount: v })} testid={`ls-extra-amount-${i}`} />
                          <button type="button" aria-label="Hapus biaya tambahan" onClick={() => setExtras((a) => a.filter((_, k) => k !== i))} className="h-9 rounded-lg border border-[#93C5FD] text-[#1D4ED8] hover:bg-[#EFF6FF]">×</button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={() => setExtras((a) => [...a, { label: "", amount: 0 }])} className={`${BTN_GHOST} mt-3`} data-testid="ls-add-extra">+ Tambah Biaya Tambahan</button>
                    <p className="mt-2 text-xs font-semibold text-[#475569]">Biaya tambahan otomatis menambah HPP leg: <b className={INK}>{rp(totals.hpp_leg)}</b></p>
                    <div className="mt-4 flex items-center gap-3">
                      <button type="button" onClick={save} disabled={busy} className={BTN_PRIMARY} data-testid="ls-save">{busy ? "Menyimpan…" : "Simpan & Kirim"}</button>
                    </div>
                  </section>

                  <section aria-label="Ringkasan tagihan" className="rounded-xl border-2 border-[#1D4ED8] bg-[#EFF6FF] px-4 py-3" data-testid="ls-summary">
                    <Stat k="Harga Deal" v={rp(totals.harga_deal)} />
                    <Stat k="Biaya Tambahan" v={rp(totals.biaya_tambahan)} />
                    <Stat k="Kompensasi" v={rp(totals.kompensasi)} />
                    <Stat k="Total Tagihan" v={rp(totals.total_tagihan)} strong />
                    <Stat k="Total Transfer" v={rp(totals.total_transfer)} />
                    <Stat k="Outstanding" v={rp(totals.outstanding)} strong accent />
                  </section>

                  <section aria-label="Pembayaran" className="rounded-xl border border-[#BFDBFE] p-4">
                    <div className="mb-3 grid grid-cols-2 gap-2" role="tablist">
                      {[["transfer", "💰 Transfer"], ["kompensasi", "🚗 Kompensasi"]].map(([k, l]) => (
                        <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`ls-tab-${k}`}
                          className={`rounded-lg border px-3 py-2 text-sm font-extrabold ${tab === k ? "border-[#1D4ED8] bg-[#1D4ED8] text-white" : "border-[#93C5FD] bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]"}`}>{l}</button>
                      ))}
                    </div>
                    {!saved ? <p className="mb-3 rounded-lg bg-[#DBEAFE] px-3 py-2 text-xs font-bold text-[#1E3A8A]">Simpan Supplier dulu sebelum mencatat pembayaran.</p> : null}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label><span className={LABEL}>Jumlah Bayar</span><Money value={pay.amount} onChange={(v) => setPay((p) => ({ ...p, amount: v }))} testid="ls-pay-amount" /></label>
                      <label><span className={LABEL}>Tanggal</span><input type="date" className={INPUT} value={pay.tanggal} onChange={(e) => setPay((p) => ({ ...p, tanggal: e.target.value }))} data-testid="ls-pay-date" /></label>
                      <label className="sm:col-span-2"><span className={LABEL}>Catatan</span><input className={INPUT} value={pay.catatan} placeholder={tab === "transfer" ? "mis. DP 50%" : "mis. Unit pengganti Avanza"} onChange={(e) => setPay((p) => ({ ...p, catatan: e.target.value }))} data-testid="ls-pay-note" /></label>
                      <label className="sm:col-span-2"><span className={LABEL}>Upload Bukti File (JPG/PNG/PDF)</span>
                        <input ref={fileRef} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e) => setPay((p) => ({ ...p, file: e.target.files && e.target.files[0] }))} data-testid="ls-pay-file"
                          className="w-full rounded-lg border border-dashed border-[#60A5FA] bg-[#F8FAFC] px-3 py-2 text-sm font-semibold text-[#0B1B3A] file:mr-3 file:rounded-md file:border-0 file:bg-[#DBEAFE] file:px-3 file:py-1 file:text-xs file:font-extrabold file:text-[#1D4ED8]" /></label>
                    </div>
                    <button type="button" onClick={addPayment} disabled={busy || !saved} className={`${BTN_PRIMARY} mt-3`} data-testid="ls-pay-submit">{tab === "transfer" ? "Catat Transfer" : "Catat Kompensasi"}</button>
                  </section>

                  <section aria-label="Histori pembayaran">
                    <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-[#1D4ED8]">Histori Pembayaran</h3>
                    {history.length === 0 ? <p className="text-sm font-semibold text-[#475569]" data-testid="ls-history-empty">Belum ada pembayaran.</p> : (
                      <ol className="relative m-0 list-none p-0" data-testid="ls-history">
                        {history.map((p, i) => (
                          <li key={p.id} className="relative flex gap-3 pb-4 last:pb-0" data-testid={`ls-hist-${p.id}`} data-tipe={p.tipe}>
                            {i < history.length - 1 ? <span className="absolute bottom-0 left-[7px] top-4 w-px bg-[#BFDBFE]" aria-hidden="true" /> : null}
                            <span className={`relative z-10 mt-1 h-4 w-4 flex-none rounded-full border-2 border-white ${p.tipe === "transfer" ? "bg-[#1D4ED8]" : "bg-[#7C3AED]"} shadow-[0_0_0_2px_#BFDBFE]`} />
                            <div className="min-w-0 flex-1 rounded-xl border border-[#BFDBFE] bg-white px-3 py-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className={`text-xs font-extrabold uppercase ${p.tipe === "transfer" ? "text-[#1D4ED8]" : "text-[#6D28D9]"}`}>{p.tipe === "transfer" ? "💰 Transfer" : "🚗 Kompensasi"} · {p.tanggal}</span>
                                <span className={`font-mono text-sm font-black ${INK}`}>{rp(p.amount)}</span>
                              </div>
                              {p.catatan ? <p className="mt-0.5 break-words text-xs font-medium text-[#475569]">{p.catatan}</p> : null}
                              {p.bukti_url ? <p className="mt-0.5 break-all text-xs font-semibold text-[#1E3A8A]" data-testid={`ls-file-${p.id}`}>📎 {p.bukti_nama || p.bukti_url.split("?")[0].split("/").pop()}</p> : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                {p.bukti_url ? (
                                  <>
                                    <button type="button" onClick={() => setPreview(p.bukti_url)} className={`${BTN_GHOST} !px-3 !py-1 !text-xs`} data-testid={`ls-view-${p.id}`}>👁 Lihat Bukti</button>
                                    <button type="button" onClick={() => download(p)} className={`${BTN_GHOST} !px-3 !py-1 !text-xs`} data-testid={`ls-dl-${p.id}`}>⬇ Unduh Bukti</button>
                                  </>
                                ) : <span className="text-xs font-semibold text-[#64748B]">Tanpa bukti</span>}
                                <button type="button" onClick={() => delPayment(p)} className="ml-auto rounded-lg px-2 py-1 text-xs font-bold text-[#475569] hover:bg-[#F1F5F9]" aria-label="Hapus pembayaran">Hapus</button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              )}
            </>
          ) : null}
        </div>

        {msg ? (
          <div role="status" className={`border-t px-5 py-2 text-sm font-bold ${msg.t === "ok" ? "border-[#BFDBFE] bg-[#DBEAFE] text-[#1E3A8A]" : "border-[#C4B5FD] bg-[#EDE9FE] text-[#4C1D95]"}`} data-testid="ls-msg">{msg.s}</div>
        ) : null}
      </div>
      {preview ? <BuktiPreview url={preview} onClose={() => setPreview("")} /> : null}
    </div>,
    document.body
  );
}
