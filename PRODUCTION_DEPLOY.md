# Production Deploy Guide — Alyssa Driver Checkpoint v1.0

> **STABLE > PRODUCTION > PREMIUM.** Feature freeze in effect.

## 1. Environment Variables

### Frontend (`/app/frontend/.env`)
| Variable                 | Purpose                                         | Example / Default                                |
|--------------------------|-------------------------------------------------|--------------------------------------------------|
| `REACT_APP_BACKEND_URL`  | Public URL of backend API (no trailing slash)   | `https://fleet-location-app-2.preview.emergentagent.com` |
| `WDS_SOCKET_PORT`        | Dev hot-reload socket port (managed by platform)| `443`                                            |

### Backend (`/app/backend/.env`)
| Variable           | Required?  | Purpose                                                                 |
|--------------------|------------|-------------------------------------------------------------------------|
| `MONGO_URL`        | ✅ Required | MongoDB connection string (auto-managed in production).                 |
| `DB_NAME`          | ✅ Required | Mongo database name (auto-managed in production).                       |
| `CORS_ORIGINS`     | ✅ Required | Comma-separated origins, or `*` for all (use specific in prod).         |
| `ADMIN_PIN`        | ⚠️ MUST CHANGE | PIN for `/?admin=1`. Default `0000` — **change before launch!**     |
| `ODOO_WEBHOOK_URL` | Optional   | Generic POST webhook for order/handover events. Empty = no-op.          |
| `ODOO_URL`         | Optional   | Odoo server URL for real XML-RPC sync. Empty = skip.                    |
| `ODOO_DB`          | Optional   | Odoo database name.                                                     |
| `ODOO_USER`        | Optional   | Odoo API user email/login.                                              |
| `ODOO_KEY`         | Optional   | Odoo API Key (Settings → Users → API Keys).                             |

### Production checklist
- [ ] Set `ADMIN_PIN` to a strong 4-6 digit PIN (rotate periodically).
- [ ] Set `CORS_ORIGINS` to your production frontend URL only (not `*`).
- [ ] Verify `MONGO_URL` points to production cluster (with auth + replica set).
- [ ] (Optional) Fill `ODOO_*` env when ready — XML-RPC sync auto-enables.
- [ ] Run `curl ${URL}/api/odoo/ping` → expect `{"enabled":false}` until Odoo configured.
- [ ] Run `curl -X POST ${URL}/api/admin/auth -d '{"pin":"<new-pin>"}'` → expect `{"ok":true}`.

---

## 2. Database Schema

### Collections
- **`trips`** — driver lifecycle (initial photos, daily checkpoints, album, BASTK, handover, cair, xendit, odoo_synced).
- **`orders`** — customer order forms (NEW → DISPATCHED → ON_TRIP → DELIVERED, CANCELLED).
- **`status_check`** — legacy/internal, untouched.

### Indexes (recommended for production scale)
Run once in Mongo shell after first deploy:
```js
db.trips.createIndex({ trip_id: 1 }, { unique: true })
db.trips.createIndex({ created_at: -1 })
db.trips.createIndex({ "daily_checkpoints.date": -1 })
db.orders.createIndex({ order_id: 1 }, { unique: true })
db.orders.createIndex({ created_at: -1 })
db.orders.createIndex({ status: 1, created_at: -1 })
db.orders.createIndex({ trip_id: 1 }, { sparse: true })
```

### Backup strategy
Daily automated dump:
```bash
mongodump --uri="${MONGO_URL}" --db="${DB_NAME}" --out="/backups/$(date +%Y%m%d)"
# Keep 30 days, compress
find /backups -mtime +30 -exec rm -rf {} +
```
Restore single document:
```bash
mongorestore --uri="${MONGO_URL}" --db="${DB_NAME}" --collection=trips /backups/20260622/test_database/trips.bson
```

---

## 3. Routes & Demo URLs

| Route                                     | Audience    | Auth                  |
|-------------------------------------------|-------------|-----------------------|
| `/?trip=<id>[&driver=<id>]`               | Driver      | None (URL is the key) |
| `/?track=<id>`                            | Customer    | None (URL is the key) |
| `/?bastk=<id>`                            | Admin/Cust  | None (URL is the key) |
| `/?order=1`                               | Public      | None                  |
| `/?admin=1`                               | Internal    | `ADMIN_PIN`           |
| `/api/odoo/ping`                          | Diagnostic  | None                  |

Demo seed (always available):
- TRIP-POD-DEMO (Driver Demo PoD, B 1234 POD, Jakarta-Bandung)
- TRIP-DEMO-001 / TRIP-DEMO-002 (legacy)

---

## 4. Monitoring & Logs

- Backend logs: `/var/log/supervisor/backend.*.log` (rotated by supervisor).
- Frontend logs: `/var/log/supervisor/frontend.*.log`.
- Key log signals:
  - `[odoo:skip]` — Odoo notify hook (expected when ODOO_* empty)
  - `[odoo:sync_order:skip]` — XML-RPC sync skipped (expected when env empty)
  - `[odoo:auth_fail]` — Odoo credentials wrong (rotate API key)
  - `[odoo:call_fail]` — Odoo unreachable / mapping error

---

## 5. Operational Runbook

### Change admin PIN
```bash
# Edit backend/.env
ADMIN_PIN="8472"
sudo supervisorctl restart backend
# All admin sessions auto-logged-out on next request
```

### Reset a stuck trip
```bash
# Mongo shell
db.trips.updateOne(
  { trip_id: "TRIP-XYZ" },
  { $set: { daily_checkpoints: [], initial_photos: {} } }
)
```

### Cancel an order (without UI)
```bash
curl -X PATCH -H "X-Admin-Pin: <PIN>" -H "Content-Type: application/json" \
  -d '{"status":"CANCELLED"}' \
  ${URL}/api/admin/orders/ORD-XXXXXXXXXX
```

### Force re-sync to Odoo
Triggered automatically on order convert. Manually:
```bash
# Implement /admin/orders/{id}/resync-odoo if needed in future
# For now: re-convert (idempotent) → returns existing trip_id without overwrite
curl -X POST -H "Content-Type: application/json" \
  ${URL}/api/orders/ORD-XXX/convert
```

---

## 6. Known Limitations (v1.0)

- **Single-admin PIN auth** — no multi-user roles. JWT upgrade in roadmap P3.
- **Xendit mocked** — payment disbursement awaits PT legalitas.
- **Odoo XML-RPC scaffold** — creates `res.partner` + `sale.order` only (no order_line/UoM mapping).
- **No in-app notifications** — driver reminder is browser banner only; WhatsApp/email share is roadmap P3.
- **No image upload backup** — uploaded photos stored locally on backend pod; survives pod restart but not multi-pod scale-out. Move to S3 if you scale beyond 1 backend pod.

---

## 7. Version History
See `/app/memory/CHANGELOG.md` for full release notes. v1.0 = v2.6d.1 + this guide.
