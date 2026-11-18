/* Teks pesan WhatsApp untuk link tugas driver/petugas: sebut nama dan unit (nopol / no. rangka) supaya jelas
   siapa harus memfoto unit yang mana. Fungsi murni. */

const rapi = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

/* Nama untuk link tingkat leg: driver leg > nama driver anggota rombongan > NAMA DRIVER di PO > driver_id berisi nama. */
export function namaUntukLink(order, leg) {
  const l = leg || {};
  const dasar = rapi(l.driver) || rapi(l.petugas_nama);
  if (dasar) return dasar.toUpperCase();
  const anggota = [];
  for (const d of Array.isArray(l.drivers) ? l.drivers : []) {
    const n = rapi(d && d.driver).toUpperCase();
    if (n && !anggota.includes(n)) anggota.push(n);
  }
  if (anggota.length) return anggota.slice(0, 3).join(", ") + (anggota.length > 3 ? ` +${anggota.length - 3}` : "");
  const o = order || {};
  const po = rapi(o.nama_driver);
  if (po) return po.toUpperCase();
  const did = rapi(o.driver_id);
  return did && !/^DRV-[A-Z0-9]+$/i.test(did) ? did.toUpperCase() : "";
}

/* Satu baris unit: "SIDE DUMP FH16 · B 1234 XYZ · No. Rangka YV2RP90D1TA381470". */
export function barisUnit(u) {
  const x = u || {};
  return [rapi(x.vehicle_type), rapi(x.nopol), rapi(x.no_rangka) ? `No. Rangka ${rapi(x.no_rangka).toUpperCase()}` : ""].filter(Boolean).join(" · ");
}

export function pesanLinkTugas({ nama, units, link }) {
  const n = rapi(nama);
  const us = (Array.isArray(units) ? units : []).map(barisUnit).filter(Boolean);
  const unit = us.length ? `\nUnit: ${us[0]}${us.length > 1 ? ` (+${us.length - 1} unit lain)` : ""}` : "";
  return `Nanti tolong foto kendaraannya ya Pak${n ? " " + n : ""} 🙏${unit}\nSaya kirimkan KAMERA di bawah ini. Bapak tinggal:\n📷 Pencet tulisan biru ini → langsung buka kamera → foto.\n\n${link}`;
}
