# CHANGELOG — Alyssa Driver Checkpoint

## [v1.0.1] — Feb 2026 (Tutorial Operasional)
### Added
- **`OperationGuide.jsx` + `Guide.css`** — new route `/?guide=1` with onboarding card UI.
- **19 cards** total across 3 categories (Driver 6, Admin 8, Customer 5).
- Premium navy+gold theme: gold gradient big number, emoji icon, numbered step bullets, italic tip with 💡 lightbulb.
- Stepper navigation (Sebelumnya / Berikutnya), clickable dots indicator, animated progress bar.
- **PDF A4 print**: offscreen multi-page generation via jsPDF + html2canvas; filename `Tutorial-Operasional-Alyssa-v1.0.pdf`.
- **Admin shortcut**: "📘 Tutorial" link added to Admin Dashboard topbar.
- Mobile-first responsive (390×844 verified).

### Notes
- Zero backend changes (pure frontend feature).
- No schema impact.
- All 143 backend pytest still pass.
- Bahasa Indonesia language throughout for non-technical user onboarding.

---

## [v1.0] — Feb 2026 (PRODUCTION RELEASE) 🚀
### Added
- **Date range filter** in Admin Dashboard (DARI/SAMPAI inputs + Reset filter button) — integrates with both list view + CSV export.
- Backend `_admin_orders_filter()` extended with `date_from` / `date_to` params (ISO lexicographic compare on `created_at`, inclusive end-of-day on date_to).
- HTML5 date input min/max attrs prevent invalid date combos at UI level.
- Reset filter button appears when any of (search, status, dateFrom, dateTo) is set; clears all 4 simultaneously.

### Production Hardening
- `/app/PRODUCTION_DEPLOY.md` — full env vars table, DB index commands, backup runbook, operational runbook.
- `/app/RELEASE_v1.0.md` — release notes + deploy checklist.

### Tests
- 6 new date-filter tests in `test_admin_v26d.py::TestAdminDateFilter`.
- Full suite **143/143 pass**.

### Feature Freeze
Per user direction. Remaining backlog deferred to v1.1+.

---

## [v2.6d.1] — Feb 2026 (CSV Export)
### Added
- **`GET /api/admin/orders/export.csv`** (PIN-gated) — filter-aware (status + q) UTF-8 BOM CSV export, Excel-compatible.
  - Columns: Order ID, Tanggal (WIB dd-mm-yyyy HH:MM), Customer, HP, Driver, Nomor Polisi, Asal, Tujuan, Status, Harga (UJ, from linked trip), Trip ID.
  - Batch-loads trip uj values for performance.
  - Filename pattern: `alyssa-orders-YYYYMMDD.csv`.
  - Limit clamped 1..20000.
- **"📥 Export CSV"** gold button in Admin Dashboard topbar — uses current `search` + `statusFilter` state, triggers blob download, "CSV diunduh" toast.

### Refactored
- Shared `_admin_orders_filter()` helper used by both `/admin/orders` and `/admin/orders/export.csv` (DRY).

### Tests
- 7 new CSV export tests in `test_admin_v26d.py` (BOM, headers, status filter, q match, no-match, limit clamp, auth).
- Full suite **137/137 pass**.

---

## [v2.6d] — Feb 2026 (Admin Mini-Dashboard)
### Added
- **`/?admin=1`** new route → `AdminDashboard.jsx` (450 lines) + `Admin.css`.
- **PIN gate** via `ADMIN_PIN` env (default `0000` for testing). No JWT, no session — header `X-Admin-Pin` per request. PIN cached in `localStorage` (key `aal_admin_pin`) + re-auth on mount.
- **Stat strip** (6 tiles): Total + 5 status counts. Clickable filters with active highlight.
- **Search + Filter**: case-insensitive regex search across order_id/customer_nama/HP/asal/tujuan/nopol + status dropdown.
- **Order cards**: status chip, customer/route/vehicle/trip_id/driver rows, action footer with state-aware buttons.
- **Convert modal**: prefilled customer info + form (driver_id, UJ/T1/T2/T3, bonus_daily/bonus_kerajinan). One-click POST `/api/orders/{id}/convert`. Now mirrors driver_id to order doc (was trip-only).
- **Status workflow**: NEW → DISPATCHED (via convert) → ON_TRIP → DELIVERED, CANCELLED terminal. Toggle buttons + Batal.
- **Inline driver assign**: ✎ pencil → input + OK/×. Saves to order + mirrors to linked trip.
- **Mobile responsive**: 2-col stats, wrapped actions, sticky topbar+filters.
- New endpoints: `POST /api/admin/auth`, `GET /api/admin/stats`, `GET /api/admin/orders?status=&q=&limit=`, `PATCH /api/admin/orders/{id}` (status/driver_id/catatan).

### Fixed
- Convert endpoint: `driver_id` from convert payload now written to **both** trip + order (data consistency nit reported by testing agent).
- Version assertion in `test_orders_v26c_convert.py` made forward-compatible (`startswith("2.6")`).

### Tests
- New `backend/tests/test_admin_v26d.py` — 24 tests (auth 3, guard 4, stats 1, list/filter/search 8, patch 6, regression 2).
- Full suite **130/130 pass**.

---

## [v2.6c] — Feb 2026
### Added
- **QR Verifikasi panel** in BASTK print area (`BASTKPage.jsx` + `BASTK.css`):
  - QR code SVG via `qrcode.react@4.2.0` with center logo (AAL bendera) + level=H error correction.
  - Encodes `${origin}/?track=<trip_id>` — scan → langsung halaman tracking real-time pelanggan.
  - Metadata box: No. BASTK (`BASTK/YYYYMM/XXXXXX`), Trip ID, No. Polisi, Tanggal Cetak, Verifikasi URL.
  - Anti-fake corner accents (gold L-brackets) + italic verification note.
- **`POST /api/orders/{order_id}/convert`** — bridge order → trip (idempotent):
  - Creates trip with `trip_id` (default `TRIP-<order_id>`) pre-filled from order (route, nopol, vehicle_type, customer_data).
  - Sets `order.status=DISPATCHED` + `order.trip_id`.
  - Adds `trip.source_order_id` backlink.
  - 409 collision check when trip_id already used.
  - 404 if order not found.
- **Real Odoo XML-RPC sync** (`_odoo_sync_order` in server.py):
  - Best-effort fire-and-forget after `/convert`.
  - When `ODOO_URL/DB/USER/KEY` env all set → creates `res.partner` + `sale.order` in Odoo.
  - When empty → graceful skip (logs `[odoo:sync_order:skip]`), never raises.
  - Order doc gets `odoo: {partner_id, sale_order_id, ts}` field on success.

### Tests
- New `backend/tests/test_orders_v26c_convert.py` — 13 tests.
- Full suite **106/106 pass**.

---

## [v2.6b] — Feb 2026
### Added
- `CustomerOrderForm.jsx` — 4-step wizard at `/?order=1` (Kendaraan → Asal → Tujuan → Konfirmasi).
- `Order.css` — premium Navy + Gold theme matching driver palette.
- `POST /api/orders` — creates order with validation, server-side truncation, ID `ORD-{10 hex upper}`.
- `GET /api/orders[?status=&limit=]` — list orders newest-first, limit clamped 1..200.
- `GET /api/orders/{order_id}` — order detail (404 if not found).
- `GET /api/odoo/ping` — diagnostic for Odoo XML-RPC config.
- `backend/odoo_client.py` — `OdooClient` stub class. Env-gated XML-RPC via stdlib. Fire-and-forget when keys empty.
- Env placeholders in `backend/.env`: `ODOO_URL`, `ODOO_DB`, `ODOO_USER`, `ODOO_KEY`.
- `notify_odoo("order.created", ...)` fired on every new order.
- `INTEGRATION_PO_ADMIN_PHP.md` sections 6 & 7 (BASTK link + Order form snippets).

### Tests
- New `backend/tests/test_orders_v26b.py` — 19 tests (POST validation, GET filters, Odoo ping, regression).
- Full suite **93/93 pass**.

---

## [v2.6a] — Feb 2026
### Added
- `BASTKPage.jsx` (~452 lines) — full premium A4 PDF generator at `/?bastk=<trip_id>`.
- `VehicleSketches.jsx` — 20 SVG vehicle sketches + `DAMAGE_CODES` (6 codes).
- `BASTK.css` — Navy + Gold print-area + dark editor.
- `POST /api/trips/{trip_id}/bastk` — partial update for vehicle_type/damage_marks/customer_data/signatures/catatan.
- Public endpoint exposes BASTK fields for customer tracking read-only.
- Routing in `App.js`: new `bastk` route.
- jspdf + html2canvas npm dependencies.

### Fixed
- Stale `v='2.4'` assertions in `test_driver_checkpoint.py` and `test_iteration6_pod.py` (now version-agnostic).
- TRIP-POD-DEMO seed self-heals daily checkpoint status+keterangan.

### Tests
- New `backend/tests/test_bastk_v26a.py` — 14 tests.

---

## [v2.5] — Earlier 2026
### Added
- Status enum on daily upload (Berangkat / CP1 / CP2 / CP3 / Tiba Tujuan).
- Optional 300-char keterangan per checkpoint.
- Reminder banner driver dashboard (06:00 WIB countdown).
- PoD PDF download per checkpoint.
- Status chip + keterangan display in PoD card.

---

## [v2.4] — Premium UI Pass
### Added
- Proof of Delivery card (premium, full PoD info).
- Theme migration to Navy + Gold palette.

---

## [v2.3]
- UI redesign — Navy & Gold dark premium.

## [v2.2]
- Album foto 4 tahap (asal/kapal/tujuan/dokumen).
- Customer Tracking page (read-only).

## [v2.1]
- Sinkronisasi PO Admin (trip_id), Xendit stub, Odoo webhook hook.

## [v2.0]
- Driver Checkpoint pivot: name + SOP + 5 initial photos + daily GPS.

## [v1.x]
- Leaflet + OSM live map, manifest form, nopol + driver checkpoint MVP.
