import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const FIELDS = [["pic", "PIC Supplier", "Nama PIC"], ["no_hp", "No HP", "08xx…"], ["email", "Email", "email@supplier.id"], ["bank", "Bank", "mis. BCA"], ["no_rekening", "Nomor Rekening", "Nomor rekening"]];
const LABEL = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#1E3A8A]";
const INPUT = "w-full rounded-lg border border-[#BFDBFE] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1B3A] placeholder:font-normal placeholder:text-[#64748B] focus:border-[#1D4ED8] focus:outline focus:outline-2 focus:outline-[#BFDBFE]";

const norm = (s) => String(s || "").toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

/*
  Bagian SUPPLIER di modul Leg (tema cerah): ketik / pilih Nama Supplier (cari cepat dari Master Kontak Supplier
  + modul Supplier), lalu PIC, No HP, Email, Bank, Nomor Rekening terisi otomatis (tetap bisa diedit).
  Nama yang sudah diisi di kolom atas ("hint") ikut dicocokkan: 1 nama yang persis sama -> langsung terisi,
  mirip -> muncul saran, belum ada -> tombol "Simpan ke Master Supplier".
  Tersimpan di leg.supplier_info (ikut autosave Route Leg); dipakai sebagai isian awal modul "Supplier ➔".
*/
export default function LegSupplierFields({ info, onChange, headers, index = 0, hint = "" }) {
  const [contacts, setContacts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const autoFor = useRef("");
  const cur = info || {};

  useEffect(() => {
    let alive = true;
    Promise.all([
      axios.get(`${API}/admin/contacts`, { params: { jenis: "supplier" }, headers }).then((r) => r.data.items || []).catch(() => []),
      axios.get(`${API}/admin/suppliers`, { headers }).then((r) => r.data.items || []).catch(() => []),
    ]).then(([c, p]) => { if (alive) { setContacts(c); setProfiles(p); setLoaded(true); } });
    return () => { alive = false; };
  }, [headers]);

  // gabungan: Master Kontak dulu, lalu supplier di modul Supplier yang belum ada di kontak
  const entries = useMemo(() => {
    const seen = new Set();
    const out = [];
    contacts.forEach((c) => { const k = norm(c.nama); if (k && !seen.has(k)) { seen.add(k); out.push({ kind: "kontak", id: c.id, nama: c.nama, c }); } });
    profiles.forEach((p) => { const k = norm(p.nama); if (k && !seen.has(k)) { seen.add(k); out.push({ kind: "profil", id: "", nama: p.nama, c: { no_hp: p.no_hp || "" } }); } });
    return out.sort((a, b) => a.nama.localeCompare(b.nama));
  }, [contacts, profiles]);

  const fill = (e) => {
    const c = e.c || {};
    onChange({ contact_id: e.id || "", nama: e.nama, pic: c.pic || "", no_hp: c.no_hp || "", email: c.email || "", bank: c.bank || "", no_rekening: c.no_rekening || "" });
    setOpen(false); setErr("");
  };

  const typed = String(cur.nama || "");
  const q = norm(typed);
  const matches = useMemo(() => {
    if (!q) return entries.slice(0, 8);
    const starts = entries.filter((e) => norm(e.nama).startsWith(q));
    const has = entries.filter((e) => !norm(e.nama).startsWith(q) && norm(e.nama).includes(q));
    return [...starts, ...has].slice(0, 8);
  }, [entries, q]);

  // Nama dari kolom atas: cocokkan sekali per nama
  const h = norm(hint);
  const exact = useMemo(() => (h ? entries.filter((e) => norm(e.nama) === h) : []), [entries, h]);
  const similar = useMemo(() => (h ? entries.filter((e) => norm(e.nama) !== h && (norm(e.nama).includes(h) || h.includes(norm(e.nama)))).slice(0, 4) : []), [entries, h]);
  useEffect(() => {
    if (!loaded || !h || cur.nama || cur.contact_id) return;
    if (autoFor.current === h) return;
    if (exact.length === 1) { autoFor.current = h; fill(exact[0]); }
    // eslint-disable-next-line
  }, [loaded, h, exact, cur.nama, cur.contact_id]);

  const known = !!cur.contact_id && contacts.some((c) => c.id === cur.contact_id);
  const showHint = loaded && h && !cur.nama && !cur.contact_id && exact.length !== 1;

  const saveToMaster = async (nama) => {
    const nm = String(nama || "").trim();
    if (!nm) return;
    setBusy(true); setErr("");
    try {
      const body = { nama: nm, jenis: "supplier", pic: cur.pic || "", no_hp: cur.no_hp || "", email: cur.email || "", bank: cur.bank || "", no_rekening: cur.no_rekening || "" };
      const r = await axios.post(`${API}/admin/contacts`, body, { headers });
      const c = r.data;
      setContacts((l) => [...l, c]);
      onChange({ contact_id: c.id, nama: c.nama });
    } catch (e) { setErr(e?.response?.data?.detail || "Gagal simpan ke Master Supplier"); }
    setBusy(false);
  };

  const sameContact = entries.find((e) => e.kind === "kontak" && norm(e.nama) === q);
  const canSave = typed.trim() && !cur.contact_id && !sameContact;

  return (
    <div className="mt-2 rounded-lg border border-[#BFDBFE] bg-white p-3" data-testid={`leg-supplier-fields-${index}`}>
      {showHint && (
        <div className="mb-2 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-2 text-[11px] text-[#78350F]" data-testid={`leg-supplier-hint-${index}`}>
          <div className="font-bold">“{hint}” belum terhubung ke Master Supplier.</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {similar.map((e) => (
              <button key={e.kind + e.nama} type="button" onClick={() => fill(e)} className="rounded-full border border-[#1D4ED8] bg-white px-2.5 py-1 font-bold text-[#1D4ED8]">Pakai: {e.nama}</button>
            ))}
            <button type="button" disabled={busy} onClick={() => { onChange({ nama: hint }); saveToMaster(hint); }} className="rounded-full bg-[#1D4ED8] px-2.5 py-1 font-bold text-white disabled:opacity-60" data-testid={`leg-supplier-hint-save-${index}`}>
              {busy ? "Menyimpan…" : `Simpan “${hint}” ke Master Supplier`}
            </button>
          </div>
        </div>
      )}
      <div className="relative">
        <label className="block">
          <span className={LABEL}>Nama Supplier</span>
          <input
            className={INPUT} value={typed} placeholder="Ketik nama supplier… (cari cepat dari Master)" autoComplete="off"
            onChange={(e) => { setErr(""); onChange({ nama: e.target.value, contact_id: "" }); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
            data-testid={`leg-supplier-select-${index}`}
          />
        </label>
        {open && matches.length > 0 && (
          <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[#BFDBFE] bg-white shadow-lg" data-testid={`leg-supplier-list-${index}`}>
            {matches.map((e) => (
              <li key={e.kind + e.nama}>
                <button type="button" onMouseDown={(ev) => ev.preventDefault()} onClick={() => fill(e)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-semibold text-[#0B1B3A] hover:bg-[#EFF6FF]">
                  <span>{e.nama}</span>
                  {e.kind === "profil" && <span className="text-[10px] font-bold text-[#92400E]">dari modul Supplier</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {typed && !known && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[#475569]">
          <span>{cur.contact_id ? "" : "Belum terhubung ke Master Supplier."}</span>
          {sameContact && !cur.contact_id && (
            <button type="button" onClick={() => fill(sameContact)} className="rounded-full border border-[#1D4ED8] px-2.5 py-0.5 font-bold text-[#1D4ED8]" data-testid={`leg-supplier-link-${index}`}>Hubungkan ke Master</button>
          )}
          {canSave && (
            <button type="button" disabled={busy} onClick={() => saveToMaster(typed)} className="rounded-full border border-[#1D4ED8] px-2.5 py-0.5 font-bold text-[#1D4ED8] disabled:opacity-60" data-testid={`leg-supplier-save-${index}`}>
              {busy ? "Menyimpan…" : "Simpan ke Master Supplier"}
            </button>
          )}
        </div>
      )}
      {err && <div className="mt-1 text-[11px] font-bold text-[#B91C1C]">{err}</div>}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {FIELDS.map(([k, lbl, ph]) => (
          <label key={k} className={k === "no_rekening" ? "sm:col-span-2" : ""}>
            <span className={LABEL}>{lbl}</span>
            <input className={INPUT} value={cur[k] || ""} placeholder={ph} onChange={(e) => onChange({ [k]: e.target.value })} data-testid={`leg-supplier-${k}-${index}`} />
          </label>
        ))}
      </div>
    </div>
  );
}
