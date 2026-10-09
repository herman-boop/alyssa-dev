import { useEffect, useState } from "react";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;

const FIELDS = [["pic", "PIC Supplier", "Nama PIC"], ["no_hp", "No HP", "08xx…"], ["email", "Email", "email@supplier.id"], ["bank", "Bank", "mis. BCA"], ["no_rekening", "Nomor Rekening", "Nomor rekening"]];
const LABEL = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#1E3A8A]";
const INPUT = "w-full rounded-lg border border-[#BFDBFE] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0B1B3A] placeholder:font-normal placeholder:text-[#64748B] focus:border-[#1D4ED8] focus:outline focus:outline-2 focus:outline-[#BFDBFE]";

/*
  Bagian SUPPLIER di modul Leg (tema cerah): pilih Nama Supplier dari Master Kontak Supplier,
  lalu PIC, No HP, Email, Bank, Nomor Rekening terisi otomatis (tetap bisa diedit).
  Tersimpan di leg.supplier_info (ikut autosave Route Leg); dipakai sebagai isian awal modul "Supplier ➔".
*/
export default function LegSupplierFields({ info, onChange, headers, index = 0 }) {
  const [list, setList] = useState([]);
  const cur = info || {};

  useEffect(() => {
    let alive = true;
    axios.get(`${API}/admin/contacts`, { params: { jenis: "supplier" }, headers })
      .then((r) => alive && setList(r.data.items || []))
      .catch(() => {});
    return () => { alive = false; };
  }, [headers]);

  const pick = (id) => {
    const c = list.find((x) => x.id === id);
    if (!c) { onChange({ nama: "", pic: "", no_hp: "", email: "", bank: "", no_rekening: "", contact_id: "" }); return; }
    onChange({ contact_id: c.id, nama: c.nama, pic: c.pic || "", no_hp: c.no_hp || "", email: c.email || "", bank: c.bank || "", no_rekening: c.no_rekening || "" });
  };
  const known = list.some((c) => c.id === cur.contact_id);

  return (
    <div className="mt-2 rounded-lg border border-[#BFDBFE] bg-white p-3" data-testid={`leg-supplier-fields-${index}`}>
      <label className="block">
        <span className={LABEL}>Nama Supplier</span>
        <select className={INPUT} value={known ? cur.contact_id : ""} onChange={(e) => pick(e.target.value)} data-testid={`leg-supplier-select-${index}`}>
          <option value="">{cur.nama && !known ? `${cur.nama} (belum ada di Master)` : "— Pilih dari Master Supplier —"}</option>
          {list.map((c) => <option key={c.id} value={c.id}>{c.nama}</option>)}
        </select>
      </label>
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
