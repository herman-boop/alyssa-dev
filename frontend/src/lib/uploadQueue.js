/*
  Antrean unggah foto checkpoint driver: tahan refresh, tahan sinyal jelek.

  Masalah lama: foto hanya hidup di memori halaman. Kalau unggahan menggantung
  ("Mengupload..." terus) lalu driver me-refresh, foto hilang dan tidak pernah
  sampai ke admin.

  Sekarang: foto ASLI disimpan dulu di IndexedDB (HP driver) sebelum diproses atau
  dikirim. Pengiriman berjalan di latar dengan batas waktu di setiap tahap dan
  dicoba ulang otomatis sampai berhasil. Server memakai `client_id` supaya kirim
  ulang tidak membuat foto dobel.

  Fungsi di sini murni (tanpa React) agar mudah dites.
*/

const DB_NAME = "aal-driver-uploads";
const STORE = "queue";
let memory = [];              // cadangan kalau IndexedDB tidak tersedia (mis. mode privat)

export function newId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* lanjut */ }
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* Jalankan `promise`, tapi paling lama `ms`. Telat atau gagal -> `fallback` (nilai atau fungsi).
   Dipakai agar satu tahap yang macet tidak pernah menahan seluruh unggahan. */
export function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const fb = () => (typeof fallback === "function" ? fallback() : fallback);
    const t = setTimeout(() => { if (!done) { done = true; resolve(fb()); } }, ms);
    Promise.resolve(promise).then(
      (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(fb()); } }
    );
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === "undefined") return reject(new Error("no idb"));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb error"));
      req.onblocked = () => reject(new Error("idb blocked"));
    } catch (e) { reject(e); }
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const st = tx.objectStore(STORE);
      let out;
      try { out = fn(st); } catch (e) { reject(e); return; }
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error || new Error("tx error"));
      tx.onabort = () => reject(tx.error || new Error("tx abort"));
    });
  } finally { try { db.close(); } catch (e) { /* abaikan */ } }
}

export async function add(item) {
  try { await withStore("readwrite", (st) => st.put(item)); }
  catch (e) { memory = memory.filter((x) => x.id !== item.id).concat([item]); }
  return item;
}

export async function list(tripId) {
  let rows = [];
  try { rows = (await withStore("readonly", (st) => st.getAll())) || []; }
  catch (e) { rows = []; }
  const seen = new Set(rows.map((r) => r.id));
  rows = rows.concat(memory.filter((m) => !seen.has(m.id)));
  return rows
    .filter((r) => !tripId || r.tripId === tripId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function remove(id) {
  memory = memory.filter((x) => x.id !== id);
  try { await withStore("readwrite", (st) => st.delete(id)); } catch (e) { /* abaikan */ }
}

export async function update(id, patch) {
  const cur = (await list()).find((x) => x.id === id);
  if (!cur) return null;
  const next = Object.assign({}, cur, patch);
  await add(next);
  return next;
}

/* Interval tunggu sebelum percobaan berikutnya: 3 dtk, 6, 12, ... maksimal 60 dtk. */
export function backoffMs(attempts) {
  return Math.min(60000, 3000 * Math.pow(2, Math.max(0, attempts - 1)));
}

/* Klasifikasi hasil kirim:
     sukses -> { ok:true }                       (hapus dari antrean)
     409    -> { ok:true, already:true }         (checkpoint hari itu memang sudah tercatat)
     4xx lain (kecuali 408/429) -> { ok:false, fatal:true }  (jangan diulang terus-menerus)
     jaringan / timeout / 5xx   -> { ok:false }  (coba lagi nanti) */
export function classify(err, response) {
  if (response) return { ok: true, trip: response.data };
  const status = err && err.response && err.response.status;
  if (status === 409) return { ok: true, already: true };
  if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
    const detail = err.response.data && err.response.data.detail;
    return { ok: false, fatal: true, reason: typeof detail === "string" ? detail : "Ditolak server (" + status + ")" };
  }
  const reason = status ? "Server sibuk (" + status + ")" : (err && err.code === "ECONNABORTED" ? "Koneksi lambat (timeout)" : "Tidak ada sinyal");
  return { ok: false, reason };
}

/* Timeout kirim menyesuaikan ukuran file (asumsi minimal ~20 KB/dtk), antara 45 dtk dan 5 menit.
   File besar (PDF BASTK) tidak boleh gagal terus hanya karena batas waktu terlalu pendek. */
export function timeoutFor(size) {
  const n = Number(size) || 0;
  return Math.min(300000, Math.max(45000, Math.round(n / 20)));
}

export const SLOT_NAMES = { depan: "Depan", belakang: "Belakang", kiri: "Kiri", kanan: "Kanan", spidometer: "Spidometer" };

/* Nama ramah untuk banner: "Foto checkpoint", "Foto awal (Depan)", "BASTK", "Foto resi". */
export function labelOf(item) {
  const k = (item && item.kind) || "daily";
  if (k === "initial") return "Foto awal" + (item.slot ? " (" + (SLOT_NAMES[item.slot] || item.slot) + ")" : "");
  if (k === "bastk") return "BASTK";
  if (k === "resi") return "Foto resi";
  return "Foto checkpoint";
}

/* Endpoint + field form per jenis unggahan.
     daily   -> /photos/daily          (1 foto/hari; client_id agar kirim ulang tidak dobel)
     initial -> /photos/initial        (menimpa isian slot yang sama; aman diulang)
     bastk   -> /photos/handover-bastk (menambah lembar; client_id agar tidak dobel)
     resi    -> /photos/handover-resi  (menimpa; aman diulang) */
export function buildRequest(item) {
  const k = item.kind || "daily";
  const fd = new FormData();
  const name = item.name || "foto.jpg";
  fd.append("foto", item.blob instanceof File ? item.blob : new File([item.blob], name, { type: item.type || "image/jpeg" }));
  const m = item.meta || {};
  let path;
  if (k === "initial") {
    path = "photos/initial";
    fd.append("slot", item.slot);
  } else if (k === "bastk") {
    path = "photos/handover-bastk";
    fd.append("client_id", item.id);
  } else if (k === "resi") {
    path = "photos/handover-resi";
    if (m.noResi) fd.append("no_resi", m.noResi);
  } else {
    path = "photos/daily";
    fd.append("client_id", item.id);
    if (item.takenAt) fd.append("taken_at", new Date(item.takenAt).toISOString());
    if (m.gps) { fd.append("lat", String(m.gps.lat)); fd.append("lng", String(m.gps.lng)); }
    if (m.alamat) fd.append("alamat", m.alamat);
    if (m.status) fd.append("status", m.status);
    if (m.keterangan) fd.append("keterangan", m.keterangan);
  }
  return { path, fd };
}

/* Kirim 1 item antrean. `axios` dan `api` diberikan pemanggil. */
export async function sendItem(item, { axios, api, timeout }) {
  const { path, fd } = buildRequest(item);
  const size = item.blob && item.blob.size;
  try {
    const r = await axios.post(`${api}/trips/${item.tripId}/${path}`, fd, { timeout: timeout || timeoutFor(size) });
    return classify(null, r);
  } catch (e) {
    return classify(e, null);
  }
}

/* Nama lama (checkpoint harian) dipertahankan. */
export const sendDaily = sendItem;
