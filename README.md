# Alyssa Driver Checkpoint v1.0

Premium logistics ops platform untuk **PT Alyssa Auto Logistik** — designed for driver borongan. Navy + Gold premium UI, mobile-first, **no driver login**.

## Quick Start

### 6 Routes
| URL                                     | Audience          | Auth         |
|-----------------------------------------|-------------------|--------------|
| `/?order=1`                             | Customer (public) | None         |
| `/?trip=<id>&driver=<id>&nopol=<nopol>` | Driver            | URL is key   |
| `/?track=<id>`                          | Customer          | URL is key   |
| `/?bastk=<id>`                          | Admin / Customer  | URL is key   |
| `/?admin=1`                             | Internal admin    | `ADMIN_PIN`  |
| `/?guide=1`                             | Tutorial onboarding | None       |

### Admin Login
- URL: `/?admin=1`
- PIN: `345374` (default for testing — **CHANGE in production** via `ADMIN_PIN` env var)

### Demo Data
3 NEW demo orders + TRIP-POD-DEMO with BASTK seeded. Use `/?bastk=TRIP-POD-DEMO` to see premium PDF with QR.

---

## Operation Cheatsheet (admin)

### Lifecycle
1. **Customer fills `/?order=1`** → status `NEW`
2. **Admin opens `/?admin=1`** → finds order → **🚚 Konversi → Trip** (assign driver_id + UJ) → status `DISPATCHED`
3. **Driver opens `/?trip=<id>&driver=<id>`** → SOP + 5 foto wajib + daily checkpoint dengan GPS
4. **Admin marks ▶ On-Trip** when journey starts → status `ON_TRIP`
5. **Customer opens `/?track=<id>`** to follow real-time (PoD card live)
6. **At delivery**: admin opens `/?bastk=<id>` → fill damage marks + signatures → Download PDF A4 (with QR for verification)
7. **Admin marks ✓ Delivered** → status `DELIVERED`

### Export laporan bulanan
1. Buka `/?admin=1`
2. Set DARI 2026-XX-01, SAMPAI 2026-XX-31
3. (Optional) Filter status DELIVERED
4. Klik **📥 Export CSV** → download Excel-ready CSV

---

## Production Deploy

See `/app/PRODUCTION_DEPLOY.md` for full guide. **TL;DR:**

```bash
# 1. Set strong PIN
sed -i 's/ADMIN_PIN=.*/ADMIN_PIN="<strong-6-digit-pin>"/' /app/backend/.env

# 2. Restrict CORS to production domain
sed -i 's|CORS_ORIGINS="\*"|CORS_ORIGINS="https://app.alyssa.co.id"|' /app/backend/.env

# 3. Restart
sudo supervisorctl restart backend

# 4. Create Mongo indexes (one-time)
python3 /app/scripts/create_indexes.py

# 5. (Optional) Configure Odoo XML-RPC
# Edit /app/backend/.env: ODOO_URL, ODOO_DB, ODOO_USER, ODOO_KEY

# 6. Schedule daily backup (cron)
0 2 * * * /app/scripts/backup_mongo.sh /backups
```

---

## Tech Stack
- **Frontend**: React 19, Tailwind, Lucide icons, react-leaflet, jspdf, html2canvas, qrcode.react, axios
- **Backend**: FastAPI, Motor (async MongoDB), Pydantic v2, xmlrpc.client (stdlib for Odoo)
- **Storage**: MongoDB (managed by Emergent), local filesystem for uploads (move to S3 for multi-pod)
- **Auth**: Simple PIN via `X-Admin-Pin` header. URL-based access for driver/customer (no login).

## Tests
- **143/143 backend pytest pass**
- Frontend lint clean, deployment_agent PASS
- Mobile responsive verified 375×812

## Documentation
- `RELEASE_v1.0.md` — Release notes
- `PRODUCTION_DEPLOY.md` — Full deploy guide + env vars + DB indexes + backup runbook
- `INTEGRATION_PO_ADMIN_PHP.md` — PHP integration snippets (legacy system)
- `memory/PRD.md`, `memory/CHANGELOG.md`, `memory/test_credentials.md`
- `backend/.env.example`, `frontend/.env.example` — env templates
- `scripts/create_indexes.py`, `scripts/backup_mongo.sh` — ops scripts

## License
Proprietary · PT Alyssa Auto Logistik · 2026
