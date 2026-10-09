/*
  Pemetaan data pesanan admin -> props ShareableSummaryCard. Fungsi murni (tanpa React).

  Tahap progres kartu (4): 0 Baru, 1 Driver Berangkat, 2 Kapal, 3 Sampai & Dokumen.
  Diturunkan dari hasil computeProgress() di AdminDashboard (supaya konsisten dengan
  timeline yang sudah ada) plus status leg kapal (Berlangsung/Selesai = sudah di kapal).
*/

const KNOWN_STATUS = ["NEW", "DISPATCHED", "ON_TRIP", "DELIVERED", "CANCELLED"];
export const STAGE_LABELS_KAPAL = ["Baru", "Driver Berangkat", "Kapal", "Sampai & Dokumen"];
export const STAGE_LABELS_DARAT = ["Baru", "Driver Berangkat", "Perjalanan", "Sampai & Dokumen"];

const isKapalLeg = (l) => String((l && l.tipe) || "").startsWith("Kapal");

export function stageFromProgress(done, legs) {
  const d = done || {};
  const ls = Array.isArray(legs) ? legs : [];
  const onShip = ls.some((l) => isKapalLeg(l) && /^(berlangsung|selesai)$/i.test(String(l.status || "")));
  if (d.sampai || d.dokumen) return 3;
  if (d.kapal || onShip) return 2;
  if (d.berangkat || d.driver) return 1;
  return 0;
}

const WIB = "Asia/Jakarta";
export function fmtUpdated(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("id-ID", { timeZone: WIB, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return `${p.day} ${p.month} ${p.year}, ${p.hour}.${p.minute} WIB`;
}

export function summaryPropsFromOrder(order, progress) {
  const o = order || {};
  const legs = Array.isArray(o.legs) ? o.legs : [];
  const kapalLeg = legs.find((l) => isKapalLeg(l) && l.kapal) || legs.find(isKapalLeg) || null;
  const units = Array.isArray(o.units) ? o.units : [];
  const baseUnit = (o.vehicle_type || (units[0] && units[0].vehicle_type) || "").trim();
  const extra = units.length > 1 ? ` (+${units.length - 1} unit)` : "";
  return {
    kategori: "penjualan",           // pesanan = pendapatan (warna emerald)
    nomorPo: o.order_id || "",
    customer: o.customer_nama || "",
    unit: baseUnit ? baseUnit + extra : "",
    nopol: o.nopol || (units[0] && units[0].nopol) || "",
    asal: o.asal_kota || "",
    tujuan: o.tujuan_kota || "",
    status: KNOWN_STATUS.includes(o.status) ? o.status : "NEW",
    stage: stageFromProgress(progress && progress.done, legs),
    stageLabels: kapalLeg ? STAGE_LABELS_KAPAL : STAGE_LABELS_DARAT,
    driver: o.nama_driver || "",
    kapal: kapalLeg ? String(kapalLeg.kapal || "").trim() : "",
    diperbarui: fmtUpdated(o.updated_at || o.created_at),
  };
}
