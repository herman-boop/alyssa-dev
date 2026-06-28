# PO Admin PHP — Integration Snippets (v2.6d.1)

Snippet siap copy-paste ke `po-admin.php` lu (existing). Ganti `REACT_APP_URL` dengan URL React app (PREVIEW atau PRODUCTION).

## 1. Konstanta URL (di awal `<script>`)

Tambah baris ini di sebelah `BASE_URL` yang sudah ada:

```js
// URL React app (driver + tracking)
var REACT_APP_URL = 'https://fleet-location-app-2.emergent.host';
// Untuk preview testing pakai:
// var REACT_APP_URL = 'https://fleet-location-app-2.preview.emergentagent.com';
```

## 2. Ganti tombol "Kirim CP" (function `kirimLinkCheckpoint`)

**REPLACE** function existing dengan ini — link sekarang arahin ke React app baru + push field `tipe`, `rangka`, `legs`:

```js
function kirimLinkCheckpoint(el){
  var poId=el.dataset.po, unitId=el.dataset.unit, nopol=el.dataset.nopol;
  var uj=parseInt(el.dataset.uj)||3500000;
  var t1=parseInt(el.dataset.t1)||Math.floor(uj*0.5);
  var t2=parseInt(el.dataset.t2)||Math.floor(uj*0.3);
  var t3=parseInt(el.dataset.t3)||(uj-Math.floor(uj*0.5)-Math.floor(uj*0.3));
  var route=el.dataset.route||nopol;
  var tipe=el.dataset.tipe||'';
  var rangka=el.dataset.rangka||'';
  var legsRaw=el.dataset.legs||'[]';

  var tripId='TRIP-'+poId+'-'+unitId;
  var link=REACT_APP_URL + '/?trip=' + encodeURIComponent(tripId)
    + '&driver=DRV-' + encodeURIComponent(unitId)
    + '&nopol=' + encodeURIComponent(nopol)
    + '&route=' + encodeURIComponent(route)
    + '&tipe='  + encodeURIComponent(tipe)
    + '&rangka=' + encodeURIComponent(rangka)
    + '&uj=' + uj + '&t1=' + t1 + '&t2=' + t2 + '&t3=' + t3
    + '&legs=' + encodeURIComponent(legsRaw);

  var lines=[
    'Halo Pak/Bu Driver,', '',
    'Link perjalanan unit '+nopol+':', link, '',
    'Pencairan Uang Jalan:',
    'Tahap 1: Rp '+t1.toLocaleString('id-ID')+' — cair saat 5 foto awal lengkap',
    'Tahap 2: Rp '+t2.toLocaleString('id-ID')+' — cair tengah jalan',
    'Tahap 3: Rp '+t3.toLocaleString('id-ID')+' — cair saat tiba', '',
    '🎁 Bonus: Foto checkpoint harian = Rp 30.000 langsung cair!', '',
    'Buka link → isi nama → baca SOP → foto unit → daily checkpoint tiap pagi.', '',
    'PT Alyssa Auto Logistik | 0818 631 135'
  ];
  window.open('https://wa.me/?text='+encodeURIComponent(lines.join('\n')),'_blank');
}
```

Untuk pakainya, tombol "Kirim CP" harus punya data attribute baru (`data-tipe`, `data-rangka`, `data-legs`). Update tombol di render PO:

```js
'<button ... data-po="'+po.id+'" data-unit="'+u.id+'" data-nopol="'+u.nopol+'"'
+' data-tipe="'+(u.tipe||'').replace(/"/g,'&quot;')+'"'
+' data-rangka="'+(u.rangka||'').replace(/"/g,'&quot;')+'"'
+' data-route="'+(legs.length?(legs[0].asal||'')+' - '+(legs[legs.length-1].tujuan||''):po.no_po)+'"'
+' data-uj="'+ujData+'" data-t1="'+t1Data+'" data-t2="'+t2Data+'" data-t3="'+t3Data+'"'
+' data-legs="'+JSON.stringify(legs||[]).replace(/"/g,'&quot;')+'"'
+' onclick="kirimLinkCheckpoint(this)">Kirim CP</button>'
```

## 3. **BARU** — Tombol "Copy Link Tracking" untuk pelanggan

Tambah function ini di `<script>`:

```js
function copyLinkTracking(po_id, unit_id, no_po, pelanggan, nopol){
  var tripId='TRIP-'+po_id+'-'+unit_id;
  var url=REACT_APP_URL + '/?track=' + encodeURIComponent(tripId);

  // Kalau mau langsung ke WA pelanggan, edit lines berikut + nomor HP:
  var lines=[
    'Halo '+pelanggan+',', '',
    'Berikut link tracking pengiriman '+nopol+':', url, '',
    'Anda bisa lihat foto, lokasi GPS, dan dokumen serah terima secara real-time.',
    'Halaman auto-refresh tiap 30 detik.', '',
    'Terima kasih telah mempercayai layanan kami.',
    'PT Alyssa Auto Logistik | 0818 631 135'
  ];
  // Copy ke clipboard
  navigator.clipboard.writeText(url).then(function(){
    if(confirm('Link tracking di-copy!\n\n'+url+'\n\nMau langsung buka WhatsApp share?')){
      window.open('https://wa.me/?text='+encodeURIComponent(lines.join('\n')),'_blank');
    }
  });
}
```

Tambah tombolnya di render PO Admin (di samping tombol "Copy Link" existing):

```js
// Di dalam unitsHtml, di sebelah delBtn atau "Kirim CP":
+'<button style="background:#0c2d3a;border:1px solid #38bdf8;color:#38bdf8;'
+'font-size:11px;padding:3px 9px;border-radius:6px;cursor:pointer;font-weight:600"'
+' onclick="copyLinkTracking(\''+po.id+'\',\''+u.id+'\',\''+po.no_po+'\',\''+(po.pelanggan||'').replace(/'/g,"\\'")+'\',\''+u.nopol+'\')">'
+'📦 Copy Link Tracking</button>'
```

## 4. (Opsional) — Aktifkan Odoo webhook

Set environment variable di backend `.env`:
```
ODOO_WEBHOOK_URL=https://alyssalogistik.co.id/odoo-proxy.php
```

Backend akan POST ke endpoint itu setiap kali ada event:
- `trip.initial_complete` — 5 foto awal selesai
- `trip.handover_complete` — BASTK + Resi terupload
- `trip.cair` — tiap tahap pencairan dipicu

Body format:
```json
{
  "event": "trip.cair",
  "data": { "trip_id": "...", "nopol": "...", "nama_driver": "...", "tahap": 1, "amount": 1750000, "bonus": 0, "total": 1750000 },
  "ts": "2026-06-22T08:30:00+00:00"
}
```

## 5. (Saat Xendit legalitas done) — Real disbursement

Backend `xendit_disburse()` di `server.py` saat ini MOCKED. Ganti isi function dengan:

```python
import xendit_python
xendit_python.api_key = os.environ['XENDIT_API_KEY']

@api_router.post("/trips/{trip_id}/xendit/disburse")
async def xendit_disburse(trip_id: str, payload: CairBody):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip: raise HTTPException(404, "Trip not found")
    # Map tahap → amount + driver bank account (admin must fill driver_bank in trip doc)
    amount = trip[f"t{payload.tahap}"]
    bank = trip.get("driver_bank", {})  # {bank_code, account_number, account_holder}
    result = xendit_python.Disbursement.create(
        external_id=f"trip-{trip_id}-t{payload.tahap}",
        bank_code=bank["bank_code"],
        account_holder_name=bank["account_holder"],
        account_number=bank["account_number"],
        description=f"UJ Tahap {payload.tahap} - {trip.get('nopol')}",
        amount=amount,
    )
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {
        f"xendit.t{payload.tahap}": {"id": result.id, "status": result.status, "ts": datetime.now(timezone.utc).isoformat()}
    }})
    return {"disbursement_id": result.id, "status": result.status, "tahap": payload.tahap}
```

UI driver page tidak perlu diubah.

---

## 6. (v2.6a) — Link BASTK Premium

Tombol cetak BASTK (PDF A4) per trip — bisa di-add di kolom "Aksi" PO Admin:
```js
function bukaBASTK(tripId){
  window.open(REACT_APP_URL + '/?bastk=' + encodeURIComponent(tripId), '_blank');
}
```
Halaman BASTK auto-load data trip via `GET /api/public/trips/<trip_id>`, lalu admin/customer:
- pilih tipe kendaraan (20 opsi),
- klik area sketsa untuk menandai kerusakan (6 kode: RSK/B/P/PC/CL/L),
- isi data pelanggan + catatan,
- driver & customer tanda tangan via canvas,
- klik **⬇ Download PDF A4** untuk file `BASTK-<nopol>.pdf` print-ready.

Semua data BASTK tersimpan di `trips.{vehicle_type, damage_marks, customer_data, signatures, bastk_catatan}` via `POST /api/trips/<trip_id>/bastk` (partial update, fully additive — schema lama tetap valid).

---

## 7. (v2.6b) — Customer Order Form & Endpoint Orders

Public form pemesanan pelanggan (4-step wizard) live di:
```
{REACT_APP_URL}/?order=1
```
Embed sebagai link di website utama / WhatsApp footer / business card. Pelanggan mengisi:
1. **Kendaraan** — tipe (20 enum) + nopol/rangka/warna/tahun/km/kondisi.
2. **Asal** — kota + alamat + tgl & jam pickup + PIC.
3. **Tujuan** — kota + alamat + PIC penerima.
4. **Konfirmasi** — nama PT/personal + HP + email + catatan.

Submit POST → `/api/orders` → tersimpan dengan `status=NEW`, `order_id=ORD-XXXXXXXXXX`. Admin bisa:
- List semua orders: `GET /api/orders?status=NEW&limit=50`
- Detail satu order: `GET /api/orders/<order_id>`
- Konversi order → trip via UI PO Admin existing (set `trip_id` lewat update doc — bisa langsung MongoDB shell atau bikin endpoint mini).

### Event Odoo `order.created`
Setiap order baru auto-fire webhook (kalau `ODOO_WEBHOOK_URL` di-set):
```json
{
  "event": "order.created",
  "data": {
    "order_id": "ORD-AB12CD34EF",
    "customer": {"nama":"PT X","hp":"08...","email":"..."},
    "vehicle": {"type":"Truck Box","nopol":"..."},
    "route": "Jakarta → Surabaya",
    "pickup": {"date":"2026-07-01","time":"09:00"}
  },
  "ts": "2026-06-22T..."
}
```

### Odoo XML-RPC (real SDK) — saat siap
Backend ada `OdooClient` stub (env-gated). Set di `backend/.env`:
```
ODOO_URL=https://alyssa-odoo.example.com
ODOO_DB=alyssa_prod
ODOO_USER=api@alyssa.co.id
ODOO_KEY=your-api-key-from-odoo-user-settings
```
Cek koneksi: `GET /api/odoo/ping` (return enabled+server_version saat env terisi). Belum auto-create record Odoo — scaffold disiapkan, tinggal call `odoo.call("sale.order", "create", [...])` di handler `create_order` saat business mapping sudah disetujui.

---

## Catatan Stabilitas
Semua endpoint baru bersifat **additive**. Tidak ada schema breaking. Existing PO Admin PHP flow tetap berfungsi tanpa modifikasi sampai poin 5. Poin 6, 7 & 8 opsional.

---

## 8. (v2.6c) — Convert Order → Trip + Real Odoo XML-RPC

### One-click conversion: order pelanggan → trip driver
Setelah pelanggan submit form di `/?order=1`, admin bisa konversi jadi trip aktif (driver bisa langsung mulai checkpoint, customer langsung dapat link tracking).

```js
async function convertOrderToTrip(orderId, opts = {}) {
  // opts boleh berisi: trip_id, driver_id, uj, t1, t2, t3, bonus_daily, bonus_kerajinan
  const r = await fetch(`${API_BASE}/api/orders/${orderId}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts || {}),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.json();
  // → { order_id, trip_id, status:"DISPATCHED", trip:{...}, already_converted:false }
}

// Contoh tombol di PO Admin "Konversi Pesanan"
async function onClickConvert(orderId) {
  const trip_id = prompt("Trip ID (kosongkan untuk auto-generate)") || undefined;
  const driver_id = prompt("Driver ID (opsional)") || undefined;
  const uj = parseInt(prompt("Uang Jalan (Rp)") || "0", 10);
  try {
    const res = await convertOrderToTrip(orderId, { trip_id, driver_id, uj });
    alert(`Berhasil! Trip: ${res.trip_id}\nLink driver: /?trip=${res.trip_id}\nLink customer: /?track=${res.trip_id}`);
  } catch (e) { alert("Gagal: " + e.message); }
}
```

### Sifat penting:
- **Idempotent**: kalau order sudah dikonversi sebelumnya, re-call return trip yang sama (`already_converted: true`). Aman buat di-klik dua kali.
- **Pre-filled**: trip baru otomatis berisi route (asal→tujuan), nopol, vehicle_type, no_rangka, customer_data dari order. Driver tinggal mulai cek poin foto wajib.
- **Backlink**: `trip.source_order_id` = order_id, untuk audit.
- **Status update**: order otomatis `status: NEW → DISPATCHED`, `order.trip_id` ter-set.

### Real Odoo XML-RPC (env-gated)

Saat user isi credentials di `backend/.env`, fungsi `_odoo_sync_order` akan auto-fire setelah convert:
- Cari `res.partner` by name; create kalau tidak ada (name+phone+email+customer_rank=1).
- Create `sale.order` dengan: `partner_id`, `origin=order_id`, `client_order_ref=trip_id`, `note` lengkap (route, vehicle, pickup, catatan).
- Pada sukses, MongoDB `orders.{order_id}.odoo = {partner_id, sale_order_id, ts}`.

```bash
# backend/.env (saat ready)
ODOO_URL=https://odoo.alyssa.co.id
ODOO_DB=alyssa_prod
ODOO_USER=api@alyssa.co.id
ODOO_KEY=xxxxxxxxxxxxxxxxxxxxxxx   # dari Settings → Users → API Keys

# Verifikasi koneksi:
curl https://your-app.example.com/api/odoo/ping
# expected (configured): {"enabled":true,"server_version":{...},"db":"...","user":"..."}
# expected (empty):       {"enabled":false,"reason":"missing ODOO_URL/DB/USER/KEY env vars"}
```

Belum diset? Tidak masalah — `_odoo_sync_order` skip dengan log `[odoo:sync_order:skip]` dan tidak pernah crash. Workflow tetap jalan (webhook `notify_odoo` masih fire kalau `ODOO_WEBHOOK_URL` di-set).

### QR Verifikasi BASTK (v2.6c)
Setiap PDF BASTK sekarang membawa QR code yang scan langsung ke `/?track=<trip_id>` — bisa dipakai pelanggan untuk verifikasi keaslian dokumen + buka real-time tracking dari kertas cetakan. No integration kerja tambahan di PHP — tinggal cetak.

---

## 9. (v2.6d) — Admin Mini-Dashboard

Tidak perlu integrasi PHP sama sekali. Admin tinggal akses:
```
{REACT_APP_URL}/?admin=1
```
Login pakai PIN dari env `ADMIN_PIN` (default `0000` — **WAJIB diganti sebelum production!**).

### Cara ganti PIN admin
1. Edit `backend/.env`:
   ```
   ADMIN_PIN=8472   # PIN 4-6 digit, contoh
   ```
2. Restart backend (`sudo supervisorctl restart backend`).
3. Semua admin yang sedang login otomatis di-logout pada request berikutnya (auto-redirect ke PIN screen).

### Fitur Admin Dashboard
- **Stats**: 6 tile (Total + 5 status) — klik untuk filter cepat.
- **Search**: cari di order_id, nama, HP, kota asal/tujuan, nopol.
- **Filter status**: NEW / DISPATCHED / ON_TRIP / DELIVERED / CANCELLED.
- **Konversi → Trip**: tombol gold 1-klik buka modal, isi driver_id + nominal UJ/T1/T2/T3, submit → trip dibuat, status order jadi DISPATCHED, link Driver/Track/BASTK otomatis muncul.
- **Status workflow**: tombol biru ▶ Mark On-Trip, hijau ✓ Mark Delivered. Manual update tanpa perlu DB shell.
- **Assign Driver**: pencil ✎ di samping driver_id, edit inline, save → mirror ke trip terkait.
- **Cancel order**: tombol merah ✕ dengan konfirmasi.

### Disable admin endpoints
Set `ADMIN_PIN=""` (empty) di `backend/.env` — semua `/api/admin/*` return 503. Berguna untuk app yang hanya dipakai driver/customer (admin akses lewat PO Admin PHP existing).

### Admin API (untuk dipanggil dari PHP juga jika perlu)
Semua endpoint butuh header `X-Admin-Pin: <PIN>`:
```bash
# List orders
curl -H "X-Admin-Pin: 0000" {URL}/api/admin/orders?status=NEW&q=jakarta

# Update status
curl -X PATCH -H "X-Admin-Pin: 0000" -H "Content-Type: application/json" \
  -d '{"status":"ON_TRIP"}' \
  {URL}/api/admin/orders/ORD-XXXXXXXXXX

# Stats
curl -H "X-Admin-Pin: 0000" {URL}/api/admin/stats

# Export CSV (Excel-compatible UTF-8 BOM)
curl -H "X-Admin-Pin: 0000" -OJ \
  "{URL}/api/admin/orders/export.csv?status=DELIVERED&q=jakarta"
# Filename: alyssa-orders-YYYYMMDD.csv
# Columns: Order ID, Tanggal, Customer, HP, Driver, Nomor Polisi, Asal, Tujuan, Status, Harga (UJ), Trip ID
```
