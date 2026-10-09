/*
  Helper murni untuk "History Leg": normalisasi status leg + hitung progres.
  Sumber data: array `legs` milik trip (status Menunggu / Berlangsung / Selesai),
  yang diubah lewat modul Route Leg / driver.
*/

export const LEG_STATE = { DONE: "selesai", ACTIVE: "berlangsung", WAIT: "menunggu" };

export function legState(leg) {
  const s = String((leg && leg.status) || "").toLowerCase();
  if (/selesai|sampai|done|delivered/.test(s)) return LEG_STATE.DONE;
  if (/berlangsung|berangkat|jalan|ongoing|progress/.test(s)) return LEG_STATE.ACTIVE;
  return LEG_STATE.WAIT;
}

export function normalizeLegs(legs) {
  return (Array.isArray(legs) ? legs : []).map((l, i) => ({
    key: l.route_leg_id || `${i}-${l.asal || ""}-${l.tujuan || ""}`,
    no: i + 1,
    asal: (l.asal || "").trim() || "—",
    tujuan: (l.tujuan || "").trim() || "—",
    tipe: l.tipe || "",
    kapal: l.kapal || "",
    state: legState(l),
  }));
}

export function legProgress(items) {
  const total = items.length;
  const done = items.filter((x) => x.state === LEG_STATE.DONE).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return { total, done, pct };
}

export function progressText({ total, done, pct }) {
  return total ? `Progress Pengiriman: ${pct}% (${done} dari ${total} Leg selesai)` : "Belum ada leg";
}
