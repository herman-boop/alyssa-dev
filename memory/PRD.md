# PRD — Alyssa Driver Checkpoint (v1.0.1 — Tutorial Operasional)

## Current Status
**v1.0.1 SHIPPED — PRODUCTION READY.** 143/143 backend pytest pass, frontend 100% verified across **6 routes** (driver/track/bastk/order/admin/guide). Tutorial Operasional onboarding cards live untuk adopsi lapangan (driver/admin/customer yang gaptek). Mobile + print PDF A4 verified. See `/app/RELEASE_v1.0.md` for full release notes.

## Tech Stack
- React + Tailwind (custom theme Navy `#0A1628` + Gold `#D4A847`)
- FastAPI + Motor (Async MongoDB)
- Libraries: react-leaflet, jspdf, html2canvas, axios (frontend); xmlrpc.client stdlib (Odoo)

## App Structure (6 routes)
```
/?trip=<trip_id>[&driver=<id>][&nopol=<nopol>]  → DriverCheckpoint
/?track=<trip_id>                               → CustomerTracking
/?bastk=<trip_id>                               → BASTKPage (+ QR)
/?order=1                                       → CustomerOrderForm
/?admin=1                                       → AdminDashboard (PIN-gated)
/?guide=1                                       → OperationGuide (Tutorial)
```

## Feature Matrix

### v1.0.1 (NEW — Tutorial Operasional Cards)
- **`/?guide=1`** — onboarding card UI premium navy+gold untuk Driver/Admin/Customer yang gaptek.
- **3 kategori, 19 cards total**: Driver (6), Admin (8), Customer (5).
- Setiap card: icon emoji, nomor besar gradient gold, judul, 4-6 langkah bernomor, tip dengan 💡 icon.
- **Onboarding nav**: Sebelumnya/Berikutnya, dots indicator clickable, progress bar gradient.
- **Print PDF A4**: tombol "⬇ PDF A4" → multi-page PDF semua 19 cards layout 2-col grid + page-break-inside avoid. Filename `Tutorial-Operasional-Alyssa-v1.0.pdf`.
- **Admin shortcut**: tombol "📘 Tutorial" di Admin Dashboard topbar.
- Mobile responsive (390×844 verified).

### v2.6d.1 (CSV Export)
- **"📥 Export CSV"** button in Admin topbar.
- Endpoint `GET /api/admin/orders/export.csv?status=&q=&limit=` — UTF-8 BOM (Excel-compatible), 11 columns, filter-aware.
- Harga (UJ) auto-pulled from linked trip; batch-loaded for performance.

### v2.6d (Admin Mini-Dashboard)
- **PIN gate** (`ADMIN_PIN` env, default `0000`) via `X-Admin-Pin` header — no JWT, no session.
- **Stats strip** — 6 tiles: Total + 5 status counts, clickable filters.
- **Search + filter** — case-insensitive regex on customer_nama/hp/asal_kota/tujuan_kota/nopol/order_id + status dropdown.
- **Order cards** — Pelanggan/Rute/Kendaraan/Trip ID/Driver rows + status chip + actions footer.
- **1-click Convert → Trip** modal — driver_id (optional), UJ/T1/T2/T3, bonus_daily, bonus_kerajinan. Now mirrors driver_id to BOTH order + trip docs.
- **Status workflow** — NEW → DISPATCHED → ON_TRIP → DELIVERED, CANCELLED terminal. Inline buttons per state.
- **Inline driver assign** — ✎ pencil → input → OK, mirrors driver_id to linked trip.
- **Mobile responsive** — 2-col stats on mobile, card actions wrap, sticky topbar+filters.
- **localStorage PIN cache** (`aal_admin_pin`) with re-auth on mount for revocation safety.
- **Endpoints**: `POST /api/admin/auth`, `GET /api/admin/stats`, `GET /api/admin/orders`, `PATCH /api/admin/orders/{id}`.

### v2.6c (NEW)
- **QR Verifikasi BASTK**: scan-able QR (level=H, AAL logo center) pointing to `/?track=<trip_id>`. Metadata box dengan No. BASTK + Trip ID + No. Polisi + URL. Anti-fake corner accents.
- **`POST /api/orders/{id}/convert`**: idempotent order → trip bridge. Pre-fills route/nopol/vehicle/customer_data + sets `order.status=DISPATCHED`.
- **Real Odoo XML-RPC sync**: `_odoo_sync_order` best-effort `res.partner` + `sale.order` create. Env-gated, no-op when unconfigured, fire-and-forget.

### v2.6b (NEW)
- **CustomerOrderForm**: 4-step wizard (Kendaraan → Asal → Tujuan → Konfirmasi). All form fields with data-testid. Premium Navy+Gold stepper, gold-active step indicator, sticky bottom-nav. Success screen with order_id chip + "Buat Pesanan Lagi".
- **POST `/api/orders`**: validates vehicle_type against 20 enum (optional empty), requires asal_kota/tujuan_kota/customer_nama/customer_hp non-empty. Server-side truncation per field. Fires `notify_odoo("order.created", ...)` webhook.
- **GET `/api/orders?status=&limit=`**: list with status filter, newest-first, limit clamp 1..200.
- **GET `/api/orders/{order_id}`**: detail, 404 if not found.
- **OdooClient stub** (`backend/odoo_client.py`): env-gated XML-RPC (ODOO_URL/DB/USER/KEY). No-op when empty. `GET /api/odoo/ping` diagnostic endpoint.

### v2.6a
- **BASTK Premium PDF Generator** — A4 print-ready, multi-page split, html2canvas+jsPDF.
- **20 SVG vehicle sketches** (Sedan/MPV/SUV/Pickup/Double Cabin/CDD/Truck Box/Dump Truck/Tangki/Tronton/Box Besar/Canter/Canter Pemadam/Motor 2 Roda/Motor 3 Roda/Forklift/Excavator/Dozer/Grader/Vibro Roller).
- **Damage checklist hotspot** (6 codes RSK/B/P/PC/CL/L) — click-to-add markers.
- **Dual signature pad** (Driver + Customer), base64 PNG, persisted.
- **Customer data form** (whitelisted + truncated).

### v2.5
- Status enum (Berangkat/CP1/CP2/CP3/Tiba Tujuan) + keterangan (300 char)
- Reminder banner (06:00 WIB)
- PoD PDF download per checkpoint
- Status chip + keterangan box in PoD card

### v2.0-v2.4 (foundation)
- Driver flow: name → SOP read → 5 initial photos → daily GPS checkpoint
- Customer Tracking page (PoD card, album 4-stage, daily checkpoints)
- Xendit MOCKED stub
- Odoo webhook (notify_odoo, fire-and-forget)
- Trip init idempotent + legs support
- Album per stage (asal/kapal/tujuan/dokumen)

## DB Schema (additive, backward-compatible)
```js
// trips collection
{
  trip_id, driver_id, nopol, route, uj, t1, t2, t3, bonus_daily, bonus_kerajinan,
  tipe_kendaraan, no_rangka, legs,
  nama_driver, sop_read,
  initial_photos: { ... },
  daily_checkpoints: [{ id, date, url, ts, lat?, lng?, status?, keterangan? }],
  album: { asal:[], kapal:[], tujuan:[], dokumen:[] },
  handover: { bastk:[], resi:null },
  cair: { 1, 2, 3 },
  xendit: { t1, t2, t3 },           // MOCKED
  odoo_synced: { handover, cair_1, cair_2, cair_3 },
  // v2.6a additive:
  vehicle_type?,                     // enum: 20 types
  damage_marks?: [{ id, code, x%, y%, note? }],
  customer_data?: { nama, hp, alamat, pic, warna, tahun, km, kondisi },
  signatures?: { driver?, customer?, admin?, ts_* },
  bastk_catatan?,
  created_at, updated_at,
}

// orders collection (v2.6b NEW)
{
  order_id,                         // "ORD-{10 hex upper}"
  status,                           // "NEW" → CONFIRMED → DISPATCHED → COMPLETED → CANCELLED
  vehicle_type, nopol, no_rangka, warna, tahun, km, kondisi,
  asal_kota, asal_alamat, pickup_date, pickup_time, pickup_pic, pickup_hp,
  tujuan_kota, tujuan_alamat, delivery_pic, delivery_hp,
  customer_nama, customer_hp, customer_email, catatan,
  trip_id,                          // null until admin converts order → trip
  created_at, updated_at,
}
```

## Testing Status (Feb-2026)
- **Backend**: **137/137 pytest pass** (49 base + 10 v2.5 + 14 v2.6a + 19 v2.6b + 13 v2.6c + 31 v2.6d + 1 seed self-heal).
- **Frontend**: 100% — Admin Dashboard PIN gate, status workflow, search/filter, convert modal, **CSV export download**, mobile responsive (390px). All other routes regression clean.
- **Mocked APIs**: Xendit (legalitas pending), Odoo XML-RPC (env-gated, real SDK ready when credentials filled), notify_odoo webhook (no-op when ODOO_WEBHOOK_URL empty).

## Env (backend/.env)
```
MONGO_URL, DB_NAME, CORS_ORIGINS
ADMIN_PIN                            # required for /api/admin/* (default '0000')
ODOO_WEBHOOK_URL                     # optional generic webhook (no-op when empty)
ODOO_URL, ODOO_DB, ODOO_USER, ODOO_KEY  # XML-RPC real SDK (placeholders)
```

## Integration ke PO Admin PHP
File `/app/INTEGRATION_PO_ADMIN_PHP.md` lengkap dengan snippet untuk:
1. URL constant
2. `kirimLinkCheckpoint()` (driver link)
3. `copyLinkTracking()` (customer link)
4. Odoo webhook env
5. Xendit drop-in (saat legalitas)
6. BASTK link (v2.6a)
7. Customer Order Form + Orders endpoint + Odoo XML-RPC (v2.6b)

## Demo URLs (TRIP-POD-DEMO)
- Driver: `/?trip=TRIP-POD-DEMO&driver=DRV-DEMO`
- Customer: `/?track=TRIP-POD-DEMO`
- BASTK + QR: `/?bastk=TRIP-POD-DEMO` (seeded: Truck Box + 3 marks + Logistik Jaya)
- Order Form: `/?order=1` (fresh form, public)
- **Admin Dashboard**: `/?admin=1` (PIN: `0000` — ganti via `ADMIN_PIN` env sebelum production!)

## Roadmap (Backlog)
- **P1 ✅ DONE (v2.6c)**: Convert order → trip endpoint, Odoo XML-RPC scaffold.
- **P1 ✅ DONE (v2.6d)**: Admin Mini-Dashboard with PIN gate, search/filter, status workflow.
- **P2** Real Xendit (saat legalitas done) — drop-in via `INTEGRATION_PO_ADMIN_PHP.md` §5.
- **P2** Real Odoo product/UoM mapping (sale.order saat ini tanpa order_line).
- **P2** "Clear all marks" + sketch zoom/pan di BASTK editor.
- **P3** BASTK auto-share WhatsApp/email post-handover.
- **P3** Multi-language toggle (EN/ID).
- **P3** Upgrade 20 vehicle sketches → high-detail illustrations (5 referensi user diterima).
- **P3** Stronger admin auth (JWT + multi-user role) saat skala butuh.
