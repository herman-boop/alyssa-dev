/* Daftar Driver per unit: NO | NAMA DRIVER | ASAL | TUJUAN | KET. | TIPE UNIT | NO POL.
   Fungsi murni: nama driver diambil dari data yang SUDAH ada (daftar driver rombongan di leg, driver leg, driver PO). */

const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/* Nama driver untuk 1 unit: baris rombongan di leg yang unit-nya sama (nopol / no rangka) > driver leg > driver PO. */
export function namaDriverUnit(order, unit) {
  const legs = Array.isArray(order && order.legs) ? order.legs : [];
  const ids = [key(unit && unit.nopol), key(unit && unit.no_rangka)].filter(Boolean);
  for (const l of legs) {
    for (const d of (l && l.drivers) || []) {
      const u = key(d && d.unit);
      const nm = String((d && d.driver) || "").trim();
      if (nm && u && ids.some((x) => x === u || (x.length >= 6 && u.includes(x)))) return nm.toUpperCase();
    }
  }
  for (const l of legs) {
    const nm = String((l && l.driver) || "").trim();
    if (nm) return nm.toUpperCase();
  }
  const po = String((order && order.nama_driver) || "").trim();
  if (po) return po.toUpperCase();
  // Chip DRIVER di kartu PO memakai driver_id; di banyak PO isinya sudah berupa nama (bukan kode master DRV-xxxx).
  const did = String((order && order.driver_id) || "").trim();
  return did && !/^DRV-[A-Z0-9]+$/i.test(did) ? did.toUpperCase() : "";
}

/* cart = [{order_id, asal_kota, tujuan_kota, unit}], orders = daftar PO. -> baris tabel. */
export function daftarDriverRows(cart, orders) {
  const byId = new Map((orders || []).map((o) => [o.order_id, o]));
  return (cart || []).filter(Boolean).map((c, i) => {
    const o = byId.get(c.order_id) || {};
    const u = c.unit || {};
    return {
      no: i + 1,
      driver: namaDriverUnit(o, u),
      asal: c.asal_kota || o.asal_kota || "",
      tujuan: u.tujuan || c.tujuan_kota || o.tujuan_kota || "",
      ket: "",
      tipe: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim(),
      nopol: u.nopol || u.no_rangka || "",
    };
  });
}

export const KOLOM_DRIVER = ["NO", "NAMA DRIVER", "ASAL", "TUJUAN", "KET.", "TIPE UNIT", "NO POL"];

export function daftarDriverCsv(rows) {
  const q = (v) => { const s = String(v == null ? "" : v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [KOLOM_DRIVER.join(";"), ...(rows || []).map((r) => [r.no, r.driver, r.asal, r.tujuan, r.ket, r.tipe, r.nopol].map(q).join(";"))].join("\r\n");
}
