from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Header, Depends, Query, Body
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, shutil, asyncio, io, re
import requests as _requests
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone, timedelta
from odoo_client import OdooClient
from playwright.async_api import async_playwright

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_IMG = {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'}
ALLOWED_DOC = {'.pdf'}

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Optional Odoo webhook (admin can set this in backend/.env to e.g. https://alyssalogistik.co.id/odoo-proxy.php).
# When empty -> no-op (events only logged).
ODOO_WEBHOOK = os.environ.get("ODOO_WEBHOOK_URL", "").strip()

# WhatsApp pickup reminders via Fonnte (https://fonnte.com).
# FONNTE_TOKEN empty -> reminders are logged only (no-op), so dev/staging never sends real WA.
FONNTE_TOKEN     = os.environ.get("FONNTE_TOKEN", "").strip()
REMINDER_TARGET  = os.environ.get("REMINDER_TARGET", "087779270110").strip()
CRON_SECRET      = os.environ.get("CRON_SECRET", "").strip()

# ── WhatsApp provider abstraction (order confirmation / tracking) ──
# Satu abstraksi kirim WA dengan beberapa adapter; pilih via WA_PROVIDER.
#   WA_PROVIDER = fonnte (default) | meta | wablas
# Token/credensial HANYA disimpan di env backend, TIDAK PERNAH di frontend.
#   fonnte : FONNTE_TOKEN (dipakai bareng reminder di atas)
#   meta   : WA_TOKEN (access token), WA_PHONE_ID (phone number id), WA_TEMPLATE (opsional)
#   wablas : WABLAS_TOKEN, WABLAS_DOMAIN
# Kalau token provider kosong -> pesan cuma di-log (no-op), order tetap tersimpan.
WA_PROVIDER      = (os.environ.get("WA_PROVIDER", "fonnte").strip().lower() or "fonnte")
WA_TOKEN         = os.environ.get("WA_TOKEN", "").strip()
WA_PHONE_ID      = os.environ.get("WA_PHONE_ID", "").strip()
WA_TEMPLATE      = os.environ.get("WA_TEMPLATE", "").strip()
WABLAS_TOKEN     = os.environ.get("WABLAS_TOKEN", "").strip()
WABLAS_DOMAIN    = (os.environ.get("WABLAS_DOMAIN", "https://console.wablas.com").strip().rstrip("/"))

# Backend-generated PDF (BASTK) — Chromium headless via Playwright renders the
# real frontend page (same JSX/CSS as on-screen), then page.pdf() produces a
# genuine vector PDF. Jauh lebih konsisten daripada window.print() + dialog
# print bawaan Android, yang perilakunya beda-beda tergantung device/driver.
#
# Railway otomatis nyuntik RAILWAY_ENVIRONMENT_NAME ke tiap service yang
# di-deploy di sana — dipakai sebagai sinyal "ini jalan di Railway" supaya
# fallback localhost:3000 di bawah CUMA aktif pas dev lokal, TIDAK PERNAH di
# production (kalau di production FRONTEND_URL kosong, biarkan kosong &
# biar endpoint balas 503 dengan pesan jelas, daripada diam-diam nyasar ke
# localhost yang jelas salah di server).
#
# FRONTEND_URL sendiri harus diisi di Railway dashboard (backend service ->
# Variables) supaya otomatis ngikutin domain frontend produksi tanpa
# hardcode — pakai Reference Variable Railway:
#   FRONTEND_URL = https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}
# Railway resolve ini sendiri & auto-update kalau domain frontend berubah.
_ON_RAILWAY = bool(os.environ.get("RAILWAY_ENVIRONMENT_NAME") or os.environ.get("RAILWAY_ENVIRONMENT"))
FRONTEND_URL = os.environ.get("FRONTEND_URL", "").strip().rstrip("/")
if not FRONTEND_URL and not _ON_RAILWAY:
    FRONTEND_URL = "http://localhost:3000"
# Base URL publik untuk link tracking di pesan WhatsApp (halaman pelanggan).
# Urutan: PUBLIC_BASE_URL -> FRONTEND_URL -> domain produksi default.
PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL", "").strip().rstrip("/")
                   or FRONTEND_URL
                   or "https://alyssaautologistiks.up.railway.app")
# Override opsional untuk path executable Chromium (dev/sandbox saja — di
# production biarkan kosong, biar Playwright pakai browser hasil
# `playwright install chromium` saat build).
PLAYWRIGHT_CHROMIUM_PATH = os.environ.get("PLAYWRIGHT_CHROMIUM_PATH", "").strip() or None
_pw = None
_browser = None


def _validate_env_on_startup() -> None:
    """Production env hygiene — log warnings for unsafe defaults. Non-fatal."""
    warnings = []
    pin = (os.environ.get("ADMIN_PIN") or "").strip()
    if not pin:
        warnings.append("[ENV] ADMIN_PIN not set — /api/admin/* endpoints will return 503.")
    elif pin == "0000":
        warnings.append("[ENV] ADMIN_PIN is default '0000' — CHANGE before public production deploy!")
    elif len(pin) < 4:
        warnings.append(f"[ENV] ADMIN_PIN length {len(pin)} < 4 — consider stronger PIN.")

    cors = (os.environ.get("CORS_ORIGINS") or "").strip()
    if cors == "*":
        warnings.append("[ENV] CORS_ORIGINS='*' — acceptable for v1.0 launch, restrict to production domain post-launch.")
    elif not cors:
        warnings.append("[ENV] CORS_ORIGINS empty — all cross-origin requests will be blocked.")

    if not (os.environ.get("MONGO_URL") or "").strip():
        warnings.append("[ENV] MONGO_URL missing — backend will not start.")
    if not (os.environ.get("DB_NAME") or "").strip():
        warnings.append("[ENV] DB_NAME missing — backend will not start.")

    # Odoo: just informational
    odoo_keys = [k for k in ("ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_KEY") if (os.environ.get(k) or "").strip()]
    if odoo_keys and len(odoo_keys) < 4:
        warnings.append(f"[ENV] Partial Odoo config ({odoo_keys}) — all 4 required to enable XML-RPC sync.")

    if not FRONTEND_URL:
        warnings.append(
            "[ENV] FRONTEND_URL not set — GET /api/trips/{id}/bastk/pdf will return 503. "
            "Set it in Railway dashboard (backend service -> Variables) as a Reference "
            "Variable: FRONTEND_URL=https://${{<frontend-service-name>.RAILWAY_PUBLIC_DOMAIN}}"
        )

    for w in warnings:
        logging.warning(w)


_validate_env_on_startup()

app = FastAPI()
api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)


@app.on_event("startup")
async def _ensure_indexes():
    """Index created_at buat doc_history biar sort terbaru-dulu pakai index
    (nggak in-memory sort) — hindari error 32MB saat record bawa stempel besar."""
    try:
        await db.doc_history.create_index([("created_at", -1)])
    except Exception as e:
        logger.warning(f"[startup] gagal bikin index doc_history.created_at: {e}")


@app.on_event("startup")
async def _launch_pdf_browser():
    """Satu instance Chromium headless dipakai bersama untuk semua request
    PDF (page baru per-request, browser tetap hidup) — launch sekali di
    startup jauh lebih cepat daripada launch Chromium per-request."""
    global _pw, _browser
    if not FRONTEND_URL:
        logger.warning(
            "[pdf] FRONTEND_URL kosong — endpoint /bastk/pdf akan mengembalikan 503. "
            "Set di Railway dashboard (backend service -> Variables) sebagai Reference "
            "Variable: FRONTEND_URL=https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}"
        )
        return
    try:
        _pw = await async_playwright().start()
        _browser = await _pw.chromium.launch(
            executable_path=PLAYWRIGHT_CHROMIUM_PATH,
            args=["--no-sandbox"],
        )
        logger.info("[pdf] Chromium headless siap untuk generate BASTK PDF.")
    except Exception as e:
        logger.error(f"[pdf] Gagal launch Chromium: {e}")
        _pw, _browser = None, None

# ----- Admin PIN guard (simple, env-driven) -----
def require_admin_pin(x_admin_pin: Optional[str] = Header(default=None, alias="X-Admin-Pin")) -> bool:
    """Require X-Admin-Pin header matching ADMIN_PIN env var. Empty env disables admin endpoints."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected:
        raise HTTPException(503, "Admin disabled (ADMIN_PIN env not set)")
    if not x_admin_pin or x_admin_pin.strip() != expected:
        raise HTTPException(401, "Invalid or missing admin PIN")
    return True


def require_vendor_pin(x_admin_pin: Optional[str] = Header(default=None, alias="X-Admin-Pin")) -> bool:
    """Role khusus 'Catat Bayar Vendor' (mobile). Menerima VENDOR_PIN (akses
    terbatas: HANYA endpoint /vendor-mobile/*) atau ADMIN_PIN (admin penuh juga
    boleh). PIN vendor tidak bisa dipakai di endpoint admin lain karena hanya
    grup /vendor-mobile/* yang memakai dependency ini."""
    given = (x_admin_pin or "").strip()
    if not given:
        raise HTTPException(401, "Missing PIN")
    admin = (os.environ.get("ADMIN_PIN") or "").strip()
    vendor = (os.environ.get("VENDOR_PIN") or "").strip()
    if admin and given == admin:
        return True
    if vendor and given == vendor:
        return True
    raise HTTPException(401, "Invalid PIN")


# WIB timezone helper (UTC+7) for daily checkpoint
WIB = timezone(timedelta(hours=7))
def today_wib() -> str:
    return datetime.now(WIB).strftime("%Y-%m-%d")


async def notify_odoo(event: str, payload: dict) -> None:
    """Fire-and-forget event to admin's Odoo proxy. Never raises."""
    if not ODOO_WEBHOOK:
        logger.info(f"[odoo:skip] {event}: {payload}")
        return
    body = {"event": event, "data": payload, "ts": datetime.now(timezone.utc).isoformat()}
    def _post():
        try:
            _requests.post(ODOO_WEBHOOK, json=body, timeout=5)
        except Exception as e:
            logger.warning(f"[odoo:fail] {event}: {e}")
    try:
        await asyncio.to_thread(_post)
    except Exception as e:
        logger.warning(f"[odoo:dispatch_fail] {e}")


def _wa_normalize(no: str) -> str:
    """Indonesian local number -> Fonnte/E.164-ish format (08xx -> 628xx)."""
    n = "".join(ch for ch in (no or "") if ch.isdigit())
    if n.startswith("0"):
        n = "62" + n[1:]
    return n


async def send_whatsapp(target: str, message: str) -> bool:
    """Fire-and-forget WhatsApp via Fonnte. Never raises. Returns True if accepted by gateway."""
    to = _wa_normalize(target)
    if not FONNTE_TOKEN:
        logger.info(f"[wa:skip] (no FONNTE_TOKEN) to={to}: {message[:60]}")
        return False
    if not to:
        logger.warning("[wa:skip] empty target")
        return False
    def _post() -> bool:
        try:
            r = _requests.post(
                "https://api.fonnte.com/send",
                headers={"Authorization": FONNTE_TOKEN},
                data={"target": to, "message": message},
                timeout=10,
            )
            ok = r.status_code == 200 and (r.json() or {}).get("status", False)
            if not ok:
                logger.warning(f"[wa:fail] to={to} status={r.status_code} body={r.text[:200]}")
            return bool(ok)
        except Exception as e:
            logger.warning(f"[wa:fail] to={to}: {e}")
            return False
    try:
        return await asyncio.to_thread(_post)
    except Exception as e:
        logger.warning(f"[wa:dispatch_fail] {e}")
        return False


# ── WhatsApp valid-number check (Indonesia) ──
def _wa_valid_id(no: str) -> bool:
    """True kalau nomor HP Indonesia valid setelah dinormalisasi ke 62xxxx.
    Aturan: mulai '628', total 10-15 digit (mis. 628123456789)."""
    n = _wa_normalize(no)
    return n.startswith("628") and 10 <= len(n) <= 15


def _wa_send_sync(to: str, message: str) -> dict:
    """Blocking send lewat provider terpilih (WA_PROVIDER). Tidak pernah raise.
    Return: {ok: bool, message_id: str|None, error: str|None, provider: str}.
    Token cuma dibaca dari env backend — tidak pernah dari request/frontend."""
    prov = WA_PROVIDER
    try:
        if prov == "meta":
            if not (WA_TOKEN and WA_PHONE_ID):
                logger.info(f"[wa:skip] (meta creds kosong) to={to}")
                return {"ok": False, "message_id": None, "error": "meta_creds_missing", "provider": prov}
            r = _requests.post(
                f"https://graph.facebook.com/v19.0/{WA_PHONE_ID}/messages",
                headers={"Authorization": f"Bearer {WA_TOKEN}", "Content-Type": "application/json"},
                json={"messaging_product": "whatsapp", "to": to, "type": "text",
                      "text": {"preview_url": True, "body": message}},
                timeout=15,
            )
            body = {}
            try: body = r.json() or {}
            except Exception: pass
            if r.status_code // 100 == 2:
                mid = (((body.get("messages") or [{}])[0]) or {}).get("id")
                return {"ok": True, "message_id": mid, "error": None, "provider": prov}
            return {"ok": False, "message_id": None, "error": f"http {r.status_code}: {r.text[:200]}", "provider": prov}

        if prov == "wablas":
            if not WABLAS_TOKEN:
                logger.info(f"[wa:skip] (wablas token kosong) to={to}")
                return {"ok": False, "message_id": None, "error": "wablas_token_missing", "provider": prov}
            r = _requests.post(
                f"{WABLAS_DOMAIN}/api/send-message",
                headers={"Authorization": WABLAS_TOKEN},
                data={"phone": to, "message": message},
                timeout=15,
            )
            body = {}
            try: body = r.json() or {}
            except Exception: pass
            ok = r.status_code // 100 == 2 and bool(body.get("status", False) if isinstance(body, dict) else False)
            mid = None
            if isinstance(body, dict):
                data = body.get("data") or {}
                if isinstance(data, dict):
                    msgs = data.get("messages") or []
                    if msgs and isinstance(msgs, list):
                        mid = (msgs[0] or {}).get("id")
                    mid = mid or data.get("id")
            if ok:
                return {"ok": True, "message_id": mid, "error": None, "provider": prov}
            return {"ok": False, "message_id": None, "error": f"http {r.status_code}: {r.text[:200]}", "provider": prov}

        # default: fonnte
        if not FONNTE_TOKEN:
            logger.info(f"[wa:skip] (no FONNTE_TOKEN) to={to}: {message[:60]}")
            return {"ok": False, "message_id": None, "error": "fonnte_token_missing", "provider": "fonnte"}
        r = _requests.post(
            "https://api.fonnte.com/send",
            headers={"Authorization": FONNTE_TOKEN},
            data={"target": to, "message": message},
            timeout=15,
        )
        body = {}
        try: body = r.json() or {}
        except Exception: pass
        ok = r.status_code == 200 and bool(body.get("status", False))
        mid = None
        idv = body.get("id")
        if isinstance(idv, list) and idv:
            mid = str(idv[0])
        elif idv:
            mid = str(idv)
        if ok:
            return {"ok": True, "message_id": mid, "error": None, "provider": "fonnte"}
        return {"ok": False, "message_id": None, "error": f"http {r.status_code}: {r.text[:200]}", "provider": "fonnte"}
    except Exception as e:
        return {"ok": False, "message_id": None, "error": str(e)[:200], "provider": prov}


async def wa_send(to: str, message: str) -> dict:
    """Async wrapper untuk provider WA. Never raises."""
    try:
        return await asyncio.to_thread(_wa_send_sync, to, message)
    except Exception as e:
        logger.warning(f"[wa:dispatch_fail] {e}")
        return {"ok": False, "message_id": None, "error": str(e)[:200], "provider": WA_PROVIDER}


def _tracking_message(nama: str, resi: str, tracking_url: str) -> str:
    return (
        f"Halo Bapak/Ibu {nama or 'Pelanggan'},\n\n"
        "Terima kasih telah mempercayakan pengiriman kendaraan Anda kepada "
        "PT Alyssa Auto Logistik.\n\n"
        "Pesanan Anda telah berhasil dibuat.\n\n"
        f"Nomor Resi / Trip ID:\n{resi}\n\n"
        "Lacak status pengiriman melalui tautan berikut:\n"
        f"{tracking_url}\n\n"
        "Simpan pesan ini agar nomor resi dan link tracking mudah ditemukan kembali.\n\n"
        "PT Alyssa Auto Logistik\n"
        "Spesialis Pengiriman Kendaraan Seluruh Indonesia"
    )


def _wa_mask(no: str) -> str:
    """628123456789 -> 6281****6789 (buat ditampilkan di halaman sukses)."""
    n = _wa_normalize(no)
    if len(n) <= 8:
        return n
    return n[:4] + "*" * (len(n) - 8) + n[-4:]


async def send_tracking_whatsapp(order: dict, resend: bool = False) -> dict:
    """Kirim pesan konfirmasi + link tracking ke nomor WA pelanggan.
    - resi = order_id (langsung ada; tracking resolve lewat /public/trips fallback)
    - best-effort: order tetap tersimpan walau gagal
    - simpan status/message_id/waktu ke order (wa_*), idempotent lewat order_id
    Return dict field wa_* yang tersimpan."""
    order_id = order.get("order_id")
    to_raw = order.get("customer_hp") or ""
    now = datetime.now(timezone.utc).isoformat()

    # Validasi nomor — jangan kirim kalau tidak valid
    if not _wa_valid_id(to_raw):
        upd = {"wa_status": "gagal", "wa_error": "nomor WA tidak valid",
               "wa_to": _wa_normalize(to_raw), "wa_updated_at": now}
        await db.orders.update_one({"order_id": order_id}, {"$set": upd})
        return upd

    to = _wa_normalize(to_raw)
    resi = order_id
    tracking_url = f"{PUBLIC_BASE_URL}/?track={order_id}"
    msg = _tracking_message(order.get("customer_nama") or "", resi, tracking_url)

    res = await wa_send(to, msg)
    upd = {
        "wa_to": to,
        "wa_tracking_url": tracking_url,
        "wa_updated_at": now,
        "wa_message_id": res.get("message_id"),
        "wa_provider": res.get("provider"),
        "wa_attempts": int(order.get("wa_attempts") or 0) + 1,
    }
    if res.get("ok"):
        upd["wa_status"] = "dikirim_ulang" if resend else "terkirim"
        upd["wa_sent_at"] = now
        upd["wa_error"] = None
    else:
        upd["wa_status"] = "gagal"
        upd["wa_error"] = res.get("error") or "gagal kirim"
    await db.orders.update_one({"order_id": order_id}, {"$set": upd})
    return upd


# ---------- Models ----------
class TripInit(BaseModel):
    trip_id: str
    driver_id: Optional[str] = None
    nopol: str
    route: str = ""
    uj: int = 0
    t1: int = 0
    t2: int = 0
    t3: int = 0
    bonus_daily: int = 30000
    bonus_kerajinan: int = 150000
    tipe_kendaraan: str = ""
    no_rangka: str = ""
    legs: List[Dict[str, Any]] = []   # [{jalur, asal, tujuan, kapal, harga, status}]

class DriverName(BaseModel):
    nama: str

class CairBody(BaseModel):
    tahap: int   # 1, 2, or 3

class WAAction(BaseModel):
    nama: Optional[str] = None


def trip_doc_to_public(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------- Endpoints ----------
@api_router.get("/")
async def root():
    return {"message": "Alyssa Driver Checkpoint API", "v": "1.0"}


VALID_STAGES = {"asal", "kapal", "tujuan", "dokumen"}


@api_router.post("/trips/init")
async def init_trip(payload: TripInit):
    """Idempotent — buat trip kalau belum ada, kalau sudah ada return existing."""
    existing = await db.trips.find_one({"trip_id": payload.trip_id})
    if existing:
        # ensure album field exists for legacy docs created before v2.2
        if "album" not in existing:
            await db.trips.update_one(
                {"trip_id": payload.trip_id},
                {"$set": {"album": {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}}}
            )
            existing = await db.trips.find_one({"trip_id": payload.trip_id})
        return trip_doc_to_public(existing)
    doc = payload.model_dump()
    doc.update({
        "id": str(uuid.uuid4()),
        "nama_driver": "",
        "sop_read": False,
        "initial_photos": {},
        "daily_checkpoints": [],
        "handover": {"bastk": [], "resi": None},
        # Album foto per tahap perjalanan (selaras dengan PO Admin PHP existing)
        "album": {"asal": [], "kapal": [], "tujuan": [], "dokumen": []},
        "cair": {"1": False, "2": False, "3": False},
        "xendit": {
            "t1": {"id": None, "status": None, "ts": None},
            "t2": {"id": None, "status": None, "ts": None},
            "t3": {"id": None, "status": None, "ts": None},
        },
        "odoo_synced": {"handover": False, "cair_1": False, "cair_2": False, "cair_3": False},
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.trips.insert_one(doc)
    return trip_doc_to_public(doc)


@api_router.get("/trips/{trip_id}")
async def get_trip(trip_id: str):
    doc = await db.trips.find_one({"trip_id": trip_id})
    if not doc:
        raise HTTPException(404, "Trip not found")
    return trip_doc_to_public(doc)


@api_router.post("/trips/{trip_id}/driver-name")
async def set_driver_name(trip_id: str, payload: DriverName):
    nama = payload.nama.strip()
    if not nama:
        raise HTTPException(400, "Nama tidak boleh kosong")
    res = await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {"nama_driver": nama, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Trip not found")
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.post("/trips/{trip_id}/sop-read")
async def mark_sop_read(trip_id: str):
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"sop_read": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True}


MIME_TO_EXT = {
    "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
    "image/webp": ".webp", "image/heic": ".heic", "image/heif": ".heic",
    "application/pdf": ".pdf",
}

# Kebalikan MIME_TO_EXT: dipakai supaya Content-Type yang tersimpan ke Supabase
# selalu benar (bukan application/octet-stream). Kalau octet-stream, Supabase
# kirim header nosniff -> browser nolak render gambar -> bukti transfer blank.
EXT_TO_MIME = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif",
    ".pdf": "application/pdf",
}

SUPABASE_URL    = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY    = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "fleet-photos").strip()

def _is_heic(ext: str, content_type: str) -> bool:
    return ext in (".heic", ".heif") or content_type in ("image/heic", "image/heif")

def _convert_heic_bytes(data: bytes) -> bytes:
    """HEIC/HEIF -> JPEG bytes. Jaring pengaman server-side: browser Chrome/Edge/
    Firefox tidak bisa decode HEIC (format default kamera iPhone), jadi walaupun
    konversi di sisi browser gagal/dilewati, yang tersimpan di storage tidak
    pernah HEIC mentah."""
    import pillow_heif
    from PIL import Image
    heif = pillow_heif.read_heif(data)
    img = Image.frombytes(heif.mode, heif.size, heif.data, "raw")
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=90)
    return buf.getvalue()

def _store_bytes(entity_id: str, sub: str, data: bytes, ext: str, content_type: str) -> str:
    fname = f"{uuid.uuid4().hex}{ext}"
    storage_path = f"{entity_id}/{sub}/{fname}"

    if SUPABASE_URL and SUPABASE_KEY:
        # Upload ke Supabase Storage
        upload_url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{storage_path}"
        resp = _requests.post(
            upload_url,
            headers={
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            data=data,
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            logger.error(f"[supabase:upload_fail] {resp.status_code} {resp.text[:200]}")
            raise HTTPException(500, f"Gagal upload foto: {resp.status_code}")
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_BUCKET}/{storage_path}"
        logger.info(f"[supabase:upload_ok] {public_url}")
        return public_url
    else:
        # Fallback ke filesystem lokal (development)
        folder = UPLOAD_DIR / entity_id / sub
        folder.mkdir(parents=True, exist_ok=True)
        fpath = folder / fname
        with fpath.open("wb") as f:
            f.write(data)
        return f"/api/uploads/{entity_id}/{sub}/{fname}"

def _fetch_upload_bytes(url: str) -> bytes:
    if url.startswith("http://") or url.startswith("https://"):
        resp = _requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.content
    rel = url.split("/api/uploads/", 1)[-1]
    return (UPLOAD_DIR / rel).read_bytes()

def _save_upload(trip_id: str, sub: str, file: UploadFile, allowed: set) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if not ext or ext not in allowed:
        ext = MIME_TO_EXT.get((file.content_type or "").split(";")[0].strip().lower(), ext)
    if ext not in allowed:
        raise HTTPException(400, f"Format file tidak didukung: {file.content_type or ext}")

    # Content-Type ditentukan dari EKSTENSI (bukan cuma dari browser), supaya
    # tidak pernah tersimpan sebagai octet-stream. Browser kadang kirim file
    # tanpa mime type -> kalau dipakai apa adanya, gambar jadi blank pas dibuka.
    content_type = EXT_TO_MIME.get(ext) or (file.content_type or "application/octet-stream").split(";")[0].strip()
    data = file.file.read()

    if _is_heic(ext, content_type):
        try:
            data = _convert_heic_bytes(data)
            ext, content_type = ".jpg", "image/jpeg"
        except Exception as e:
            logger.warning(f"[heic] gagal convert server-side, simpan HEIC asli: {trip_id}/{sub}: {e}")

    return _store_bytes(trip_id, sub, data, ext, content_type)


@api_router.get("/media")
async def media_proxy(u: str):
    """Proxy gambar/PDF (bukti transfer, dokumen) dari Supabase dengan Content-Type
    yang benar + inline. Fungsinya: bukti lama yang ke-upload dengan mime type salah
    (application/octet-stream) tetap TAMPIL di browser, bukan blank. Hanya melayani
    URL storage milik kita sendiri (anti open-proxy / SSRF)."""
    if not u:
        raise HTTPException(400, "url kosong")
    ok = False
    if SUPABASE_URL and u.startswith(f"{SUPABASE_URL}/storage/v1/object/public/"):
        ok = True
    if not ok:
        raise HTTPException(400, "url tidak diizinkan")
    try:
        resp = _requests.get(u, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(502, f"gagal ambil file: {e}")
    ext = Path(u.split("?", 1)[0]).suffix.lower()
    ctype = EXT_TO_MIME.get(ext) or "application/octet-stream"
    return Response(
        content=resp.content,
        media_type=ctype,
        headers={"Content-Disposition": "inline", "Cache-Control": "public, max-age=86400"},
    )


@api_router.post("/trips/{trip_id}/photos/initial")
async def upload_initial_photo(trip_id: str, slot: str = Form(...), foto: UploadFile = File(...)):
    """slot in: depan, belakang, kiri, kanan, spidometer (5 wajib)"""
    valid_slots = {"depan", "belakang", "kiri", "kanan", "spidometer"}
    if slot not in valid_slots:
        raise HTTPException(400, f"Slot tidak valid. Pilihan: {valid_slots}")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    url = _save_upload(trip_id, f"initial/{slot}", foto, ALLOWED_IMG)
    entry = {"url": url, "ts": datetime.now(timezone.utc).isoformat()}
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {f"initial_photos.{slot}": entry, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    # auto-cair T1 kalau semua 6 initial sudah lengkap
    trip = await db.trips.find_one({"trip_id": trip_id})
    initial_complete_now = all(s in (trip.get("initial_photos") or {}) for s in valid_slots)
    if initial_complete_now and not trip.get("cair", {}).get("1"):
        await db.trips.update_one({"trip_id": trip_id}, {"$set": {"cair.1": True}})
        # Notify Odoo: initial complete + T1 auto-cair
        await notify_odoo("trip.initial_complete", {
            "trip_id": trip_id,
            "nopol": trip.get("nopol"),
            "nama_driver": trip.get("nama_driver"),
            "tahap": 1,
            "amount": trip.get("t1", 0),
        })
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.post("/trips/{trip_id}/photos/daily")
async def upload_daily_photo(
    trip_id: str,
    foto: UploadFile = File(...),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    status: Optional[str] = Form(None),  # Berangkat|Checkpoint 1|Checkpoint 2|Checkpoint 3|Tiba Tujuan
    keterangan: Optional[str] = Form(None),
    alamat: Optional[str] = Form(None),   # nama lokasi (reverse-geocode dari HP)
):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    today = today_wib()
    daily = trip.get("daily_checkpoints") or []
    if any(cp.get("date") == today for cp in daily):
        raise HTTPException(409, "Foto hari ini sudah terkirim")
    url = _save_upload(trip_id, "daily", foto, ALLOWED_IMG)
    entry = {
        "id": str(uuid.uuid4()),
        "date": today,
        "url": url,
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    if lat is not None and lng is not None:
        entry["lat"] = float(lat)
        entry["lng"] = float(lng)
    valid_status = {"Berangkat", "Checkpoint 1", "Checkpoint 2", "Checkpoint 3", "Tiba Tujuan"}
    if status and status in valid_status:
        entry["status"] = status
    if keterangan:
        entry["keterangan"] = keterangan.strip()[:300]
    if alamat:
        entry["alamat"] = alamat.strip()[:200]
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$push": {"daily_checkpoints": entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


async def _maybe_notify_handover_complete(trip_id: str):
    """Trigger Odoo notification once when both BASTK + Resi are present (idempotent)."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        return
    h = trip.get("handover") or {}
    if h.get("bastk") and h.get("resi") and not (trip.get("odoo_synced") or {}).get("handover"):
        await db.trips.update_one({"trip_id": trip_id}, {"$set": {"odoo_synced.handover": True}})
        await notify_odoo("trip.handover_complete", {
            "trip_id": trip_id,
            "nopol": trip.get("nopol"),
            "nama_driver": trip.get("nama_driver"),
            "tipe_kendaraan": trip.get("tipe_kendaraan"),
            "no_rangka": trip.get("no_rangka"),
            "bastk_count": len(h.get("bastk", [])),
            "resi_url": (h.get("resi") or {}).get("url"),
        })
        asyncio.create_task(_odoo_confirm_invoice(trip_id, trip))


@api_router.post("/trips/{trip_id}/photos/handover-bastk")
async def upload_bastk(trip_id: str, foto: UploadFile = File(...)):
    """BASTK: PDF atau gambar, max 6 file"""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    bastk = (trip.get("handover") or {}).get("bastk") or []
    if len(bastk) >= 6:
        raise HTTPException(400, "Maks 6 lembar BASTK")
    url = _save_upload(trip_id, "handover/bastk", foto, ALLOWED_IMG | ALLOWED_DOC)
    entry = {"id": str(uuid.uuid4()), "url": url, "ts": datetime.now(timezone.utc).isoformat()}
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$push": {"handover.bastk": entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _maybe_notify_handover_complete(trip_id)
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.post("/trips/{trip_id}/photos/handover-resi")
async def upload_resi(trip_id: str, foto: UploadFile = File(...), no_resi: Optional[str] = Form(None)):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    url = _save_upload(trip_id, "handover/resi", foto, ALLOWED_IMG | ALLOWED_DOC)
    entry = {"url": url, "ts": datetime.now(timezone.utc).isoformat()}
    if no_resi and no_resi.strip():
        entry["no_resi"] = no_resi.strip()[:60]
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {"handover.resi": entry, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _maybe_notify_handover_complete(trip_id)
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.delete("/trips/{trip_id}/handover/bastk/{item_id}")
async def delete_bastk(trip_id: str, item_id: str):
    """Hapus 1 lembar BASTK (admin bisa hapus hasil scan)."""
    res = await db.trips.update_one(
        {"trip_id": trip_id},
        {"$pull": {"handover.bastk": {"id": item_id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Trip not found")
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.delete("/trips/{trip_id}/handover/resi")
async def delete_resi_doc(trip_id: str):
    """Hapus foto Resi handover."""
    res = await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {"handover.resi": None, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Trip not found")
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.post("/trips/{trip_id}/cair")
async def request_cair(trip_id: str, payload: CairBody):
    if payload.tahap not in (1, 2, 3):
        raise HTTPException(400, "Tahap harus 1, 2, atau 3")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    # Aturan minimal — gate sederhana
    if payload.tahap == 1:
        if len(trip.get("initial_photos") or {}) < 5:
            raise HTTPException(400, "Lengkapi 5 foto awal dulu")
    elif payload.tahap == 3:
        h = trip.get("handover") or {}
        if not h.get("bastk") or not h.get("resi"):
            raise HTTPException(400, "Upload BASTK & Resi dulu")
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {f"cair.{payload.tahap}": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    # Notify Odoo (once per tahap)
    sync_key = f"cair_{payload.tahap}"
    if not (trip.get("odoo_synced") or {}).get(sync_key):
        await db.trips.update_one({"trip_id": trip_id}, {"$set": {f"odoo_synced.{sync_key}": True}})
        amount_field = {1: "t1", 2: "t2", 3: "t3"}[payload.tahap]
        bonus = trip.get("bonus_kerajinan", 0) if payload.tahap == 3 else 0
        await notify_odoo("trip.cair", {
            "trip_id": trip_id,
            "nopol": trip.get("nopol"),
            "nama_driver": trip.get("nama_driver"),
            "tahap": payload.tahap,
            "amount": trip.get(amount_field, 0),
            "bonus": bonus,
            "total": trip.get(amount_field, 0) + bonus,
        })
        asyncio.create_task(_odoo_log_expense(trip_id, trip, payload.tahap))
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


# ---------- Xendit stub (legalitas dalam proses) ----------
@api_router.post("/trips/{trip_id}/xendit/disburse")
async def xendit_disburse(trip_id: str, payload: CairBody):
    """MOCKED — Xendit belum aktif. Endpoint ini cuma persist mock disbursement record.
    Saat legalitas Xendit selesai, ganti body fungsi ini dengan call ke Xendit SDK/REST API."""
    if payload.tahap not in (1, 2, 3):
        raise HTTPException(400, "Tahap harus 1, 2, atau 3")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    mock_id = f"xendit_mock_{uuid.uuid4().hex[:12]}"
    update = {
        f"xendit.t{payload.tahap}.id": mock_id,
        f"xendit.t{payload.tahap}.status": "MOCKED_PENDING",
        f"xendit.t{payload.tahap}.ts": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.trips.update_one({"trip_id": trip_id}, {"$set": update})
    doc = await db.trips.find_one({"trip_id": trip_id})
    return {
        "mocked": True,
        "disbursement_id": mock_id,
        "tahap": payload.tahap,
        "note": "Xendit belum aktif (legalitas dalam proses). Status: MOCKED_PENDING.",
        "trip": trip_doc_to_public(doc),
    }


# ---------- BASTK (Berita Acara Serah Terima Kendaraan) — v2.6a ADDITIVE ----------
# Karoseri (body type) x chassis truk — "satu opsi per kombinasi", sinkron
# dengan TRUCK_KAROSERI_COMBOS di frontend/src/VehicleSketches.jsx.
_KAROSERI_VARIANTS = ["Bak", "Box", "Dumptruck", "Tangki", "Damkar"]
_CHASSIS_TRUCK = [
    "Canter FE 71 D4 STD", "Canter FE 71 D4 LONG", "Canter D6 STD",
    "Hino Ranger F6 STD", "Hino Ranger F6 LONG",
    "Hino 500 F6 STD", "Hino 500 F6 LONG",
    "Fuso Fighter FM 65 F6 STD", "Fuso Fighter FM 65 F6 LONG",
    "Isuzu Giga FTR F6 STD", "Isuzu Giga FTR F6 LONG",
    "Hino FM 260 JW T10 STD", "Hino FM 260 JW T10 LONG",
    "Fuso Fighter FN 62 T10 STD", "Fuso Fighter FN 62 T10 LONG",
    "Isuzu Giga FVM T10 STD", "Isuzu Giga FVM T10 LONG",
]
_TRUCK_KAROSERI_COMBOS = {
    f"{chassis} - {karoseri}"
    for chassis in _CHASSIS_TRUCK
    for karoseri in _KAROSERI_VARIANTS
}

VALID_VEHICLE_TYPES = _TRUCK_KAROSERI_COMBOS | {
    # Tipe utama
    "Sedan", "MPV / SUV", "MPV / SUV Lainnya", "Pickup / Double Cabin",
    "Concrete Pump", "Motor", "Excavator", "Grader", "Dozer", "Vibro Roller",
    "Forklift", "Dump Crawler",
    # Toyota
    "Toyota Avanza", "Toyota Veloz", "Toyota Rush", "Toyota Fortuner",
    "Toyota Kijang Innova", "Toyota Innova Zenix", "Toyota Raize",
    "Toyota Yaris Cross", "Toyota Alphard", "Toyota Vellfire", "Toyota Hilux",
    "Toyota Agya",
    # Daihatsu
    "Daihatsu Xenia", "Daihatsu Terios", "Daihatsu Rocky", "Daihatsu Sigra",
    "Daihatsu Ayla", "Daihatsu Gran Max",
    # Honda
    "Honda BR-V", "Honda HR-V", "Honda CR-V", "Honda Mobilio", "Honda Brio",
    "Honda WR-V", "Honda Pilot", "Honda Civic", "Honda City",
    # Mitsubishi
    "Mitsubishi Xpander", "Mitsubishi Xpander Cross", "Mitsubishi Pajero Sport",
    "Mitsubishi Outlander", "Mitsubishi Eclipse Cross", "Mitsubishi L300",
    "Mitsubishi Triton",
    # Wuling
    "Wuling Almaz", "Wuling Alvez", "Wuling Confero", "Wuling Air EV", "Wuling BinguoEV",
    # BYD
    "BYD Atto 3", "BYD Seal", "BYD Dolphin", "BYD Sealion 6", "BYD M6",
    # Suzuki
    "Suzuki Ertiga", "Suzuki XL7", "Suzuki Grand Vitara", "Suzuki Baleno",
    "Suzuki Ignis", "Suzuki Carry",
    # Tipe lama (backward-compat)
    "Mobil Kecil Biasa", "Mobil Kecil Medium",
    "Truck Ringan D4 Std", "Truck Ringan D4 Long",
    "Truck Sedang D6 Std", "Truck Sedang D6 Long",
    "Truck Besar F6 Std", "Truck Besar F6 Long",
    "Tronton T10 Std", "Tronton T10 Long",
    "Alat Berat 2 - 3,9 Ton", "Alat Berat 4 - 6,9 Ton", "Alat Berat 7 - 9,9 Ton",
    "Alat Berat 10 - 15,9 Ton", "Alat Berat 16 - 23,9 Ton", "Alat Berat 24 - 27,9 Ton",
    "Alat Berat 28 - 34,9 Ton", "Alat Berat 35 - 36,9 Ton", "Alat Berat 37 - 43,9 Ton",
    "Alat Berat 44 - 46,9 Ton", "Alat Berat 47 - 54,9 Ton",
    "MPV", "SUV", "Pickup", "Double Cabin", "CDD", "Tangki", "Tronton",
    "Box Besar", "Canter", "Canter Pemadam", "Motor 2 Roda", "Motor 3 Roda",
    "Truck Box", "Truck Bak", "Dump Truck", "Truck Tangki", "Fire Truck",
}
VALID_DAMAGE_CODES = {"RSK", "B", "P", "PC", "CL", "L"}


# Custom vehicle types -- admin bisa nambah tipe kendaraan baru manual dari
# Kalkulator HPP (dan tempat lain yang pakai list ini), tersimpan permanen di
# db.custom_vehicle_types, lalu otomatis muncul juga di dropdown form Pesanan.
# VALID_VEHICLE_TYPES di atas tetap dipertahankan sebagai daftar bawaan yang
# udah dikenal (biar nggak breaking); _all_valid_vehicle_types() adalah union
# dari itu + custom types yang disimpan admin.
async def _all_valid_vehicle_types() -> set:
    custom = set()
    async for t in db.custom_vehicle_types.find({}, {"_id": 0, "nama": 1}):
        if t.get("nama"):
            custom.add(t["nama"])
    return VALID_VEHICLE_TYPES | custom


class VehicleTypeBody(BaseModel):
    nama: str


@api_router.get("/vehicle-types")
async def list_custom_vehicle_types():
    """List tipe kendaraan custom yang udah ditambahkan admin (di luar daftar
    bawaan VALID_VEHICLE_TYPES), buat digabung ke dropdown di frontend."""
    items = []
    async for t in db.custom_vehicle_types.find({}, {"_id": 0}).sort("nama", 1):
        items.append(t["nama"])
    return {"items": items}


@api_router.post("/vehicle-types", dependencies=[Depends(require_admin_pin)])
async def add_custom_vehicle_type(body: VehicleTypeBody):
    """Tambah tipe kendaraan baru manual. Ditolak kalau nama sama (case-
    insensitive) udah ada -- baik di daftar bawaan maupun custom yang lain."""
    nama = body.nama.strip()
    if not nama:
        raise HTTPException(400, "Nama tipe kendaraan tidak boleh kosong")
    all_types = await _all_valid_vehicle_types()
    if nama.lower() in {t.lower() for t in all_types}:
        raise HTTPException(409, f"Tipe kendaraan '{nama}' sudah ada")
    doc = {"id": uuid.uuid4().hex[:8], "nama": nama, "created_at": datetime.utcnow().isoformat()}
    await db.custom_vehicle_types.insert_one(doc)
    return {"nama": nama}


# ── Histori Dokumen ─────────────────────────────────────────────────────────
# Arsip tiap dokumen yang dicetak admin (Invoice, Jadwal per-PO, Jadwal
# Gabungan). Menyimpan snapshot lengkap (meta + units/lines) supaya bisa
# dicetak ulang persis, plus tombol hapus. Fire-and-forget dari frontend.
DOC_JENIS = {"jadwal_gabungan", "jadwal", "invoice", "supplier"}
DOC_JENIS_LABEL = {
    "jadwal_gabungan": "Jadwal Gabungan",
    "jadwal": "Jadwal Pengiriman",
    "invoice": "Invoice / Faktur",
    "supplier": "Rekap Supplier",
}


class DocHistoryBody(BaseModel):
    jenis: str
    no_dokumen: Optional[str] = ""
    judul: Optional[str] = ""
    customer: Optional[str] = ""
    meta: Optional[dict] = None
    units: Optional[list] = None
    lines: Optional[list] = None
    order_ids: Optional[list] = None


@api_router.get("/admin/doc-history", dependencies=[Depends(require_admin_pin)])
async def list_doc_history(jenis: Optional[str] = None, limit: int = 300):
    """List arsip dokumen, terbaru dulu. Bisa difilter per jenis."""
    from fastapi.encoders import jsonable_encoder
    filt = {}
    if jenis and jenis in DOC_JENIS:
        filt["jenis"] = jenis
    # Inclusion projection: HANYA field ringan & pasti aman (tanpa gambar stempel
    # base64 & tanpa units yang bisa besar) supaya response nggak berat dan nggak
    # gagal serialisasi. Stempel/units lengkap diambil via endpoint detail pas cetak.
    proj = {
        "_id": 0, "id": 1, "jenis": 1, "jenis_label": 1, "no_dokumen": 1,
        "judul": 1, "customer": 1, "order_ids": 1, "created_at": 1, "lines": 1,
        "meta.tanggalInvoice": 1, "meta.jatuhTempo": 1, "meta.metode": 1,
        "meta.withTax": 1, "meta.withPph23": 1, "meta.taxInclusive": 1,
        "meta.asal_kota": 1, "meta.tujuan_kota": 1, "meta.order_id": 1,
        "meta.pesan": 1, "meta.no_invoice": 1, "meta.customer_nama": 1,
        "meta.ttdNama": 1, "meta.ttdJabatan": 1,
    }
    items = []
    # allow_disk_use=True: record lama bawa stempel base64 gede, sort by created_at
    # bisa lewat batas memori 32MB Mongo (error code 292) -> izinkan sort pakai disk.
    cur = db.doc_history.find(filt, proj).sort("created_at", -1).allow_disk_use(True).limit(max(1, min(1000, limit)))
    async for d in cur:
        try:
            items.append(jsonable_encoder(d))  # skip record yg bermasalah, jgn gagalin semua
        except Exception:
            continue
    return {"items": items}


@api_router.get("/admin/doc-history/{doc_id}", dependencies=[Depends(require_admin_pin)])
async def get_doc_history(doc_id: str):
    """Ambil 1 record arsip LENGKAP (termasuk stempel) — buat cetak ulang."""
    d = await db.doc_history.find_one({"id": doc_id}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Dokumen tidak ditemukan")
    return d


@api_router.post("/admin/doc-history", dependencies=[Depends(require_admin_pin)])
async def add_doc_history(body: DocHistoryBody):
    """Simpan 1 record arsip dokumen (dipanggil otomatis tiap cetak)."""
    if body.jenis not in DOC_JENIS:
        raise HTTPException(400, "Jenis dokumen tidak dikenal")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": "DOC-" + uuid.uuid4().hex[:10],
        "jenis": body.jenis,
        "jenis_label": DOC_JENIS_LABEL.get(body.jenis, body.jenis),
        "no_dokumen": (body.no_dokumen or "").strip()[:80],
        "judul": (body.judul or "").strip()[:200],
        "customer": (body.customer or "").strip()[:200],
        "meta": body.meta or {},
        "units": body.units or [],
        "lines": body.lines or [],
        "order_ids": body.order_ids or [],
        "created_at": now,
    }
    await db.doc_history.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.delete("/admin/doc-history/{doc_id}", dependencies=[Depends(require_admin_pin)])
async def delete_doc_history(doc_id: str):
    """Hapus 1 record arsip dokumen."""
    res = await db.doc_history.delete_one({"id": doc_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Dokumen tidak ditemukan")
    return {"ok": True, "id": doc_id}


# ── Kontak (buku alamat pelanggan & supplier) ────────────────────────────────
# Buku alamat sederhana, sinkron lintas device. Jenis: pelanggan / supplier.
CONTACT_JENIS = {"pelanggan", "supplier"}


def _norm_contact_name(s: str) -> str:
    import re as _re
    return _re.sub(r"\s+", " ", _re.sub(r"[.,]", "", (s or "").lower())).strip()


class ContactBody(BaseModel):
    nama: str
    jenis: Optional[str] = "pelanggan"
    perusahaan: Optional[str] = ""
    no_hp: Optional[str] = ""
    email: Optional[str] = ""
    alamat: Optional[str] = ""
    catatan: Optional[str] = ""


def _contact_doc(body: ContactBody) -> dict:
    jenis = body.jenis if body.jenis in CONTACT_JENIS else "pelanggan"
    return {
        "nama": (body.nama or "").strip()[:200],
        "jenis": jenis,
        "perusahaan": (body.perusahaan or "").strip()[:200],
        "no_hp": (body.no_hp or "").strip()[:40],
        "email": (body.email or "").strip()[:120],
        "alamat": (body.alamat or "").strip()[:400],
        "catatan": (body.catatan or "").strip()[:500],
    }


@api_router.get("/admin/contacts", dependencies=[Depends(require_admin_pin)])
async def list_contacts(jenis: Optional[str] = None, q: Optional[str] = None):
    """List kontak, urut nama. Filter optional per jenis & pencarian teks."""
    filt = {}
    if jenis and jenis in CONTACT_JENIS:
        filt["jenis"] = jenis
    if q:
        import re as _re
        rx = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
        filt["$or"] = [{"nama": rx}, {"perusahaan": rx}, {"no_hp": rx}, {"email": rx}]
    items = []
    async for c in db.contacts.find(filt, {"_id": 0}).sort("nama", 1):
        items.append(c)
    return {"count": len(items), "items": items}


@api_router.post("/admin/contacts", dependencies=[Depends(require_admin_pin)])
async def create_contact(body: ContactBody):
    if not (body.nama or "").strip():
        raise HTTPException(400, "nama wajib diisi")
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": "CT-" + uuid.uuid4().hex[:10], **_contact_doc(body), "created_at": now}
    await db.contacts.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.patch("/admin/contacts/{contact_id}", dependencies=[Depends(require_admin_pin)])
async def update_contact(contact_id: str, body: ContactBody):
    if not (body.nama or "").strip():
        raise HTTPException(400, "nama wajib diisi")
    res = await db.contacts.update_one({"id": contact_id}, {"$set": _contact_doc(body)})
    if res.matched_count == 0:
        raise HTTPException(404, "Kontak tidak ditemukan")
    doc = await db.contacts.find_one({"id": contact_id}, {"_id": 0})
    return doc


@api_router.delete("/admin/contacts/{contact_id}", dependencies=[Depends(require_admin_pin)])
async def delete_contact(contact_id: str):
    res = await db.contacts.delete_one({"id": contact_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Kontak tidak ditemukan")
    return {"ok": True, "id": contact_id}


@api_router.post("/admin/contacts/import-orders", dependencies=[Depends(require_admin_pin)])
async def import_contacts_from_orders():
    """Tarik pelanggan unik dari orders ke buku kontak (skip yang sudah ada,
    dedup by nama ternormalisasi). Ambil varian nama terpanjang + HP/email pertama."""
    existing = set()
    async for c in db.contacts.find({"jenis": "pelanggan"}, {"nama": 1}):
        existing.add(_norm_contact_name(c.get("nama")))
    seen = {}
    async for o in db.orders.find({}, {"customer_nama": 1, "customer_hp": 1, "customer_email": 1}):
        nm = (o.get("customer_nama") or "").strip()
        if not nm:
            continue
        k = _norm_contact_name(nm)
        if not k or k in existing:
            continue
        cur = seen.get(k)
        if not cur:
            seen[k] = {"nama": nm, "no_hp": (o.get("customer_hp") or "").strip(), "email": (o.get("customer_email") or "").strip()}
        else:
            if len(nm) > len(cur["nama"]):
                cur["nama"] = nm
            if not cur["no_hp"]:
                cur["no_hp"] = (o.get("customer_hp") or "").strip()
            if not cur["email"]:
                cur["email"] = (o.get("customer_email") or "").strip()
    now = datetime.now(timezone.utc).isoformat()
    docs = [{
        "id": "CT-" + uuid.uuid4().hex[:10], "nama": v["nama"][:200], "jenis": "pelanggan",
        "perusahaan": "", "no_hp": v["no_hp"][:40], "email": v["email"][:120], "alamat": "",
        "catatan": "", "created_at": now,
    } for v in seen.values()]
    if docs:
        await db.contacts.insert_many(docs)
    return {"imported": len(docs)}


@api_router.post("/admin/contacts/import-suppliers", dependencies=[Depends(require_admin_pin)])
async def import_contacts_from_suppliers():
    """Tarik supplier dari supplier_profiles ke buku kontak (skip yang sudah ada)."""
    existing = set()
    async for c in db.contacts.find({"jenis": "supplier"}, {"nama": 1}):
        existing.add(_norm_contact_name(c.get("nama")))
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    async for s in db.supplier_profiles.find({}, {"nama": 1, "no_hp": 1, "jenis": 1}):
        nm = (s.get("nama") or "").strip()
        k = _norm_contact_name(nm)
        if not nm or k in existing:
            continue
        existing.add(k)
        docs.append({
            "id": "CT-" + uuid.uuid4().hex[:10], "nama": nm[:200], "jenis": "supplier",
            "perusahaan": "", "no_hp": (s.get("no_hp") or "").strip()[:40], "email": "",
            "alamat": "", "catatan": (s.get("jenis") or "").strip()[:500], "created_at": now,
        })
    if docs:
        await db.contacts.insert_many(docs)
    return {"imported": len(docs)}


class BASTKBody(BaseModel):
    vehicle_type: Optional[str] = None
    damage_marks: Optional[List[Dict[str, Any]]] = None
    customer_data: Optional[Dict[str, Any]] = None
    signatures: Optional[Dict[str, Any]] = None  # {driver: dataURL?, customer: dataURL?, admin: dataURL?, ts_driver/customer/admin}
    catatan: Optional[str] = None


@api_router.post("/trips/{trip_id}/bastk")
async def upsert_bastk(trip_id: str, payload: BASTKBody):
    """Save BASTK fields. Semua field optional — partial update friendly.
    NO breaking change: existing trips tanpa field ini tetap valid."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    update = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.vehicle_type is not None:
        vt = payload.vehicle_type.strip()
        if vt and vt not in await _all_valid_vehicle_types():
            raise HTTPException(400, f"vehicle_type tidak valid")
        update["vehicle_type"] = vt
    if payload.damage_marks is not None:
        # filter only valid codes; coerce x/y to float; truncate note to 120
        clean = []
        for m in payload.damage_marks[:80]:  # cap 80 marks
            code = (m.get("code") or "").strip().upper()
            if code not in VALID_DAMAGE_CODES:
                continue
            try:
                x = float(m.get("x", 0)); y = float(m.get("y", 0))
            except Exception:
                continue
            clean.append({
                "id": m.get("id") or str(uuid.uuid4()),
                "code": code,
                "x": max(0.0, min(100.0, x)),  # percentage
                "y": max(0.0, min(100.0, y)),
                "note": (m.get("note") or "").strip()[:120],
            })
        update["damage_marks"] = clean
    if payload.customer_data is not None:
        # only whitelisted keys
        cd = payload.customer_data or {}
        update["customer_data"] = {
            "nama":     (cd.get("nama") or "").strip()[:120],
            "hp":       (cd.get("hp") or "").strip()[:30],
            "alamat":   (cd.get("alamat") or "").strip()[:300],
            "pic":      (cd.get("pic") or "").strip()[:120],
            "warna":    (cd.get("warna") or "").strip()[:40],
            "tahun":    (cd.get("tahun") or "").strip()[:6],
            "km":       (cd.get("km") or "").strip()[:12],
            "kondisi":  (cd.get("kondisi") or "").strip()[:20],
            "penyerah_nama":   (cd.get("penyerah_nama") or "").strip()[:120],
            "penyerah_hp":     (cd.get("penyerah_hp") or "").strip()[:30],
            "penyerah_alamat": (cd.get("penyerah_alamat") or "").strip()[:300],
            "penerima_nama":   (cd.get("penerima_nama") or "").strip()[:120],
            "penerima_hp":     (cd.get("penerima_hp") or "").strip()[:30],
            "penerima_alamat": (cd.get("penerima_alamat") or "").strip()[:300],
        }
    if payload.signatures is not None:
        sigs = payload.signatures or {}
        # store base64 dataURL strings — accept driver/customer/admin keys
        clean_sigs = {}
        for k in ("driver", "customer", "admin", "penyerah", "penerima"):
            v = sigs.get(k)
            if isinstance(v, str) and v.startswith("data:image"):
                clean_sigs[k] = v[:400_000]  # max ~400KB dataURL
                clean_sigs[f"ts_{k}"] = datetime.now(timezone.utc).isoformat()
        if clean_sigs:
            update["signatures"] = {**(trip.get("signatures") or {}), **clean_sigs}
    if payload.catatan is not None:
        update["bastk_catatan"] = (payload.catatan or "").strip()[:500]

    await db.trips.update_one({"trip_id": trip_id}, {"$set": update})
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.delete("/trips/{trip_id}/daily/today")
async def reset_today_daily(trip_id: str):
    """Tester only — reset foto hari ini supaya bisa upload ulang."""
    today = today_wib()
    await db.trips.update_one({"trip_id": trip_id}, {"$pull": {"daily_checkpoints": {"date": today}}})
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


# ---------- Album foto per tahap (Asal / Dalam Kapal / Tujuan / Dokumen) ----------
@api_router.post("/trips/{trip_id}/album")
async def upload_album_photo(
    trip_id: str,
    stage: str = Form(...),
    foto: UploadFile = File(...),
    catatan: str = Form(""),
    uploaded_by: str = Form("driver"),   # "driver" | "admin"
):
    """Upload foto ke album per tahap. Stage = asal|kapal|tujuan|dokumen.
    Dokumen menerima PDF + gambar; lainnya hanya gambar."""
    stage_norm = (stage or "").strip().lower()
    if stage_norm not in VALID_STAGES:
        raise HTTPException(400, f"Stage tidak valid. Pilihan: {sorted(VALID_STAGES)}")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    allowed = ALLOWED_IMG | ALLOWED_DOC if stage_norm == "dokumen" else ALLOWED_IMG
    url = _save_upload(trip_id, f"album/{stage_norm}", foto, allowed)
    entry = {
        "id": str(uuid.uuid4()),
        "url": url,
        "catatan": (catatan or "").strip(),
        "uploaded_by": uploaded_by or "driver",
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$push": {f"album.{stage_norm}": entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


@api_router.delete("/trips/{trip_id}/album/{stage}/{photo_id}")
async def delete_album_photo(trip_id: str, stage: str, photo_id: str):
    stage_norm = (stage or "").strip().lower()
    if stage_norm not in VALID_STAGES:
        raise HTTPException(400, "Stage tidak valid.")
    res = await db.trips.update_one(
        {"trip_id": trip_id},
        {"$pull": {f"album.{stage_norm}": {"id": photo_id}}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Trip not found")
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


# ---------- Public tracking (read-only untuk pelanggan) ----------
def _trip_public_view(doc: dict) -> dict:
    """Bentuk view read-only trip buat pelanggan (cuma field aman)."""
    h = doc.get("handover") or {}
    return {
        "trip_id": doc.get("trip_id"),
        "nopol": doc.get("nopol"),
        "tipe_kendaraan": doc.get("tipe_kendaraan", ""),
        "no_rangka": doc.get("no_rangka", ""),
        "route": doc.get("route", ""),
        "nama_driver": doc.get("nama_driver", ""),
        "legs": doc.get("legs", []),
        "album": doc.get("album", {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}),
        "handover": {
            "bastk": h.get("bastk", []),
            "resi": h.get("resi"),
        },
        "daily_count": len(doc.get("daily_checkpoints", []) or []),
        "daily_checkpoints": doc.get("daily_checkpoints", []) or [],
        "initial_done": len(doc.get("initial_photos", {}) or {}),
        "initial_photos": doc.get("initial_photos", {}) or {},
        # BASTK fields (v2.6a, optional)
        "vehicle_type": doc.get("vehicle_type", ""),
        "damage_marks": doc.get("damage_marks", []),
        "customer_data": doc.get("customer_data", {}),
        "signatures": doc.get("signatures", {}),
        "bastk_catatan": doc.get("bastk_catatan", ""),
        "progress": {
            "initial_complete": len(doc.get("initial_photos", {}) or {}) >= 5,
            "handover_complete": bool(h.get("bastk")) and bool(h.get("resi")),
        },
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def _public_order_fallback(track_id: str):
    """Fallback tracking sebelum order di-convert jadi trip: pelanggan tetap bisa
    buka link dari WA (resi = order_id) & lihat status 'pesanan diterima'.
    Terima order_id langsung atau bentuk 'TRIP-<order_id>'."""
    oid = track_id
    if oid.startswith("TRIP-"):
        oid = oid[len("TRIP-"):]
    o = await db.orders.find_one({"order_id": oid}, {"_id": 0})
    if not o:
        return None
    # Kalau order SUDAH di-convert jadi trip (punya trip_id), link WA yg pakai
    # order_id tetap harus nampilin trip beneran (foto album, checkpoint, dll) —
    # bukan view kosong. Resolve order_id → trip_id → trip.
    otid = o.get("trip_id")
    if otid and otid != track_id:
        trip = await db.trips.find_one({"trip_id": otid})
        if trip:
            return _trip_public_view(trip)
    route = f'{o.get("asal_kota","")} - {o.get("tujuan_kota","")}'.strip(" -") or "—"
    empty_album = {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}
    return {
        "trip_id": o.get("trip_id") or track_id,
        "order_id": o.get("order_id"),
        "pending": True,                       # belum jadi trip (belum di-dispatch admin)
        "status_order": o.get("status", "NEW"),
        "nopol": o.get("nopol", ""),
        "tipe_kendaraan": o.get("vehicle_type", ""),
        "no_rangka": o.get("no_rangka", ""),
        "route": route,
        "nama_driver": "",
        "legs": [],
        "album": empty_album,
        "handover": {"bastk": [], "resi": None},
        "daily_count": 0, "daily_checkpoints": [],
        "initial_done": 0, "initial_photos": {},
        "vehicle_type": o.get("vehicle_type", ""),
        "damage_marks": [], "customer_data": {}, "signatures": {}, "bastk_catatan": "",
        "pickup": {"date": o.get("pickup_date", ""), "time": o.get("pickup_time", "")},
        "progress": {"initial_complete": False, "handover_complete": False},
        "created_at": o.get("created_at"), "updated_at": o.get("updated_at"),
    }


# Peta album buat foto dari link petugas → bucket tracking (asal/kapal/tujuan)
_TASK_ALBUM_BUCKET = {
    "pelabuhan_asal": "asal", "pelabuhan_tujuan": "tujuan", "kapal": "kapal",
    "driver_asal": "asal", "driver_tujuan": "tujuan", "driver_full": "asal",
}


async def _merge_task_media(trip_id: str, view: dict):
    """Gabungin foto & dokumen dari SEMUA link tugas petugas ke album tracking,
    biar foto yg diupload lewat /task/{token} PASTI muncul di tracking pelanggan
    & admin — walau push langsung ke trip.album kelewat atau masuk bucket lain."""
    if not trip_id:
        return
    album = view.get("album") or {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}
    seen = set()
    for arr in album.values():
        for p in (arr or []):
            if p.get("url"):
                seen.add(p["url"])
    async for t in db.leg_tasks.find({"trip_id": trip_id}):
        bucket = _TASK_ALBUM_BUCKET.get(t.get("tipe_tugas"), t.get("album_key") or "asal")
        if bucket not in album:
            album[bucket] = []
        who = f"petugas:{t.get('petugas_nama', '')}"
        for p in (t.get("photos") or []):
            u = p.get("url")
            if u and u not in seen:
                album[bucket].append({"id": p.get("id"), "url": u, "catatan": p.get("catatan", ""), "uploaded_by": who, "ts": p.get("ts")})
                seen.add(u)
        for d in (t.get("documents") or []):
            u = d.get("url")
            if u and u not in seen:
                album.setdefault("dokumen", []).append({"id": d.get("id"), "url": u, "catatan": d.get("doc_type", ""), "uploaded_by": who, "ts": d.get("ts")})
                seen.add(u)
        # Foto dari CHECKPOINT (histori GPS) juga ikut masuk album — kalau petugas
        # cuma cek-point + foto (tanpa upload di tab Foto), fotonya tetap muncul
        # di tracking pelanggan & admin. Keterangan pakai jenis checkpoint-nya.
        for cp in (t.get("checkpoints") or []):
            u = cp.get("url")
            if u and u not in seen:
                ket = cp.get("jenis") or "Checkpoint"
                if cp.get("catatan"):
                    ket = f"{ket} — {cp.get('catatan')}"
                album[bucket].append({"id": cp.get("checkpoint_id"), "url": u, "catatan": ket, "uploaded_by": who, "ts": cp.get("ts")})
                seen.add(u)
    view["album"] = album


async def _merge_task_checkpoints(trip_id: str, view: dict):
    """Gabungin CHECKPOINT dari link petugas (collection leg_checkpoints) ke
    daily_checkpoints view — biar panel 'DRIVER CHECKPOINT', riwayat, & peta GPS
    di halaman tracking ikut nampilin checkpoint yang dikirim driver via link
    tugas (bukan cuma checkpoint app driver lama)."""
    if not trip_id:
        return
    daily = list(view.get("daily_checkpoints") or [])
    seen = {c.get("id") or c.get("checkpoint_id") for c in daily if (c.get("id") or c.get("checkpoint_id"))}
    added = False
    async for c in db.leg_checkpoints.find({"trip_id": trip_id}).sort("ts", 1):
        cid = c.get("checkpoint_id")
        if cid and cid in seen:
            continue
        item = {
            "id": cid,
            "ts": c.get("ts"),
            "status": c.get("jenis") or "Checkpoint",   # dipakai sbg label jenis di UI
            "keterangan": c.get("catatan") or "",
            "url": c.get("url"),
            "reported_by": c.get("petugas_nama") or "",
        }
        if c.get("lat") is not None and c.get("lng") is not None:
            item["lat"] = c.get("lat"); item["lng"] = c.get("lng")
            if c.get("acc") is not None:
                item["acc"] = c.get("acc")
        if c.get("alamat"):
            item["alamat"] = c.get("alamat")
        daily.append(item)
        if cid:
            seen.add(cid)
        added = True
    if added:
        daily.sort(key=lambda x: x.get("ts") or "")
        view["daily_checkpoints"] = daily
        view["daily_count"] = len(daily)


@api_router.get("/public/trips/{trip_id}")
async def public_trip(trip_id: str):
    """Read-only view untuk pelanggan. Hanya field aman yang ter-expose.
    Kalau trip belum ada (order belum di-convert), fallback ke data order biar
    link tracking dari pesan WhatsApp tetap valid."""
    doc = await db.trips.find_one({"trip_id": trip_id})
    real_trip_id = None
    if not doc:
        fb = await _public_order_fallback(trip_id)
        if not fb:
            raise HTTPException(404, "Trip not found")
        view = fb
        real_trip_id = fb.get("trip_id")
    else:
        view = _trip_public_view(doc)
        real_trip_id = doc.get("trip_id")
    await _merge_task_media(real_trip_id, view)
    await _merge_task_checkpoints(real_trip_id, view)
    return view


@api_router.get("/trips/{trip_id}/bastk/pdf")
async def bastk_pdf(trip_id: str):
    """Generate BASTK sebagai PDF vector asli (backend-rendered), pengganti
    window.print() + dialog print bawaan Android yang hasilnya tidak
    konsisten antar device. Chromium headless me-render halaman BASTK yang
    SAMA PERSIS dengan tampilan di layar (JSX/CSS asli produksi), lalu
    page.pdf() menghasilkan PDF dengan teks/garis/QR tetap vector (bukan
    screenshot raster) — kualitasnya setara PDF invoice Odoo/ERP dan tidak
    tergantung device/driver print pengguna.
    """
    doc = await db.trips.find_one({"trip_id": trip_id})
    if not doc:
        raise HTTPException(404, "Trip not found")
    if not FRONTEND_URL:
        raise HTTPException(
            503,
            "FRONTEND_URL belum diset di backend. Set di Railway dashboard (backend "
            "service -> Variables) sebagai Reference Variable: "
            "FRONTEND_URL=https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}",
        )
    if _browser is None:
        raise HTTPException(503, "PDF generator belum siap (Chromium gagal start saat startup).")

    page = await _browser.new_page(viewport={"width": 900, "height": 1400})
    try:
        await page.goto(f"{FRONTEND_URL}/bastk/{trip_id}", wait_until="networkidle", timeout=30_000)
        await page.wait_for_selector('[data-testid="bk-print"]', timeout=15_000)
        await page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")

        # Foto sketsa kendaraan (/vehicles/*.jpg) kadang gagal load pas race
        # dengan networkidle (request-nya sempat gagal/lambat), bikin PDF
        # ke-capture pas lagi fallback ke SVG generic. networkidle nggak
        # ngejamin gambar itu BERHASIL, cuma ngejamin network-nya udah diem.
        # Jadi cek eksplisit: kalau ada <img data-testid="bk-vehicle-photo">
        # tapi gagal load (naturalWidth 0), reload sekali & tunggu ulang.
        img_ok = await page.evaluate(
            """() => {
                const img = document.querySelector('[data-testid="bk-vehicle-photo"]');
                if (!img) return true; // nggak ada foto (vehicle_type nggak dikenal) -> ok, biarin SVG
                return img.complete && img.naturalWidth > 0;
            }"""
        )
        if not img_ok:
            logger.warning(f"[pdf] foto sketsa kendaraan gagal load, retry sekali: trip={trip_id}")
            await page.reload(wait_until="networkidle", timeout=30_000)
            await page.wait_for_selector('[data-testid="bk-print"]', timeout=15_000)

        await page.emulate_media(media="print")
        await page.wait_for_timeout(200)  # kasih waktu render ulang (QR/gambar) setelah emulate_media
        pdf_bytes = await page.pdf(
            format="A4",
            print_background=True,
            margin={"top": "5mm", "bottom": "5mm", "left": "5mm", "right": "5mm"},
        )
    except Exception as e:
        logger.error(f"[pdf] Gagal render BASTK PDF untuk trip {trip_id}: {e}")
        raise HTTPException(500, "Gagal membuat PDF, coba lagi.")
    finally:
        await page.close()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="BASTK-{trip_id}.pdf"'},
    )


@api_router.get("/odoo/ping")
async def odoo_ping():
    """Diagnostic: report Odoo client status. Safe to call always.
    When env empty → enabled=false. When set → tries server.version() (no auth).
    """
    return OdooClient().ping()


# ---------- Customer Order Form (v2.6b) ----------
class UnitBody(BaseModel):
    """1 kendaraan/unit di dalam sebuah PO (F1 — Unit Master)."""
    vehicle_type: str = ""
    tipe_model: str = ""
    nopol: str = ""
    no_rangka: str = ""
    no_mesin: str = ""
    warna: str = ""
    tahun: str = ""
    tujuan: str = ""     # tujuan per unit (1 PO bisa banyak tujuan)
    catatan: str = ""


class OrderBody(BaseModel):
    # Kendaraan (legacy single-unit — tetap didukung; dipakai jadi units[0] kalau
    # `units` tidak dikirim, untuk backward-compatibility form lama)
    vehicle_type: str = ""
    nopol: str = ""
    no_rangka: str = ""
    warna: str = ""
    tahun: str = ""
    km: str = ""
    kondisi: str = "Bekas"
    # F1 — Unit Master: daftar unit (multi-unit). Kalau kosong, dibentuk dari
    # field kendaraan legacy di atas.
    units: Optional[List[UnitBody]] = None
    # Dimensi kargo (cm) — dipakai buat hitung M3 otomatis di Surat Jalan
    panjang: str = ""
    lebar: str = ""
    tinggi: str = ""
    # Deskripsi barang — dipakai di Surat Jalan (kolom "Isi Menurut Pengirim")
    # buat kiriman cargo/barang umum (bukan kendaraan/alat berat).
    isi_kiriman: str = ""
    # Jumlah colly/koli (jumlah jenis kemasan) — dipakai di kolom "Jml Jns Colly"
    # di Surat Jalan, diisi manual (bisa 1, 3, 4, dst).
    jumlah_colly: str = ""
    # Asal
    asal_kota: str
    asal_alamat: str = ""
    pickup_date: str = ""        # ISO "YYYY-MM-DD"
    pickup_time: str = ""        # "HH:MM"
    pickup_pic: str = ""
    pickup_hp: str = ""
    # Tujuan
    tujuan_kota: str
    tujuan_alamat: str = ""
    delivery_pic: str = ""
    delivery_hp: str = ""
    # Customer
    customer_nama: str
    customer_hp: str
    customer_email: str = ""
    catatan: str = ""


# ── F1: Unit Master (units[] embedded di order) ──
UNIT_MAX_PER_ORDER = 20
UNIT_STATUS_PERJALANAN_DEFAULT = "Belum Dijadwalkan"  # → Berjalan → Selesai
UNIT_STATUS_INVOICE_DEFAULT = "Belum Ditagih"          # → Sudah Diinvoice → Dibayar Sebagian → Lunas


def _gen_unit_id() -> str:
    return "UNIT-" + uuid.uuid4().hex[:10].upper()


def _new_unit(src: dict, now: str) -> dict:
    """Bentuk 1 record unit dari data mentah (payload unit atau field legacy)."""
    return {
        "unit_id": _gen_unit_id(),
        "vehicle_type": (src.get("vehicle_type") or "").strip()[:80],
        "tipe_model": (src.get("tipe_model") or "").strip()[:120],
        "nopol": (src.get("nopol") or "").strip().upper()[:20],
        "no_rangka": (src.get("no_rangka") or "").strip().upper()[:40],
        "no_mesin": (src.get("no_mesin") or "").strip().upper()[:40],
        "warna": (src.get("warna") or "").strip()[:40],
        "tahun": (src.get("tahun") or "").strip()[:6],
        "tujuan": (src.get("tujuan") or "").strip()[:80],
        "catatan": (src.get("catatan") or "").strip()[:300],
        "status_perjalanan": UNIT_STATUS_PERJALANAN_DEFAULT,
        "status_invoice": UNIT_STATUS_INVOICE_DEFAULT,
        # ── jadwal pengiriman (diisi admin di PO) ──
        "nama_kapal": "",
        "etd": "",            # tanggal kapal berangkat (YYYY-MM-DD)
        "transit_hari": 0,    # lama pelayaran; ETA = etd + transit_hari
        "created_at": now,
        "updated_at": now,
    }


def _legacy_unit_src(order: dict) -> dict:
    """Ambil field kendaraan legacy dari order jadi 1 unit (units[0])."""
    return {
        "vehicle_type": order.get("vehicle_type") or "",
        "tipe_model": order.get("tipe_model") or "",
        "nopol": order.get("nopol") or "",
        "no_rangka": order.get("no_rangka") or "",
        "warna": order.get("warna") or "",
        "tahun": order.get("tahun") or "",
        "catatan": "",
    }


async def _ensure_order_units(order: dict) -> dict:
    """Lazy-migrate order lama: kalau belum punya units[], bentuk units[0] dari
    field legacy lalu simpan. Idempotent (order yang sudah punya units dilewati),
    dan aman per-order (error 1 order tidak menggagalkan yang lain)."""
    if not isinstance(order, dict):
        return order
    units = order.get("units")
    if isinstance(units, list) and len(units) > 0:
        return order
    try:
        now = order.get("created_at") or datetime.now(timezone.utc).isoformat()
        unit0 = _new_unit(_legacy_unit_src(order), now)
        order["units"] = [unit0]
        if order.get("order_id"):
            await db.orders.update_one(
                {"order_id": order["order_id"], "$or": [{"units": {"$exists": False}}, {"units": {"$size": 0}}]},
                {"$set": {"units": [unit0], "jumlah_unit": 1}},
            )
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[units:migrate] gagal untuk order {order.get('order_id')}: {e}")
    return order


def _order_unit_summary(order: dict) -> dict:
    """Ringkasan status unit untuk kartu PO admin."""
    units = order.get("units") or []
    total = len(units)
    berjalan = sum(1 for u in units if u.get("status_perjalanan") == "Berjalan")
    selesai = sum(1 for u in units if u.get("status_perjalanan") == "Selesai")
    belum_trip = sum(1 for u in units if (u.get("status_perjalanan") or UNIT_STATUS_PERJALANAN_DEFAULT) == UNIT_STATUS_PERJALANAN_DEFAULT)
    sudah_invoice = sum(1 for u in units if (u.get("status_invoice") or "") not in ("", UNIT_STATUS_INVOICE_DEFAULT))
    belum_invoice = total - sudah_invoice
    return {
        "total": total, "belum_trip": belum_trip, "berjalan": berjalan,
        "selesai": selesai, "belum_invoice": belum_invoice, "sudah_invoice": sudah_invoice,
    }


@api_router.post("/orders")
async def create_order(payload: OrderBody):
    """Create a customer order (v2.6b). Validates + persists + fires Odoo webhook.
    Compatibility layer: returns order_id; does NOT auto-create trip yet (admin still triggers via PO).
    F1: mendukung units[] (multi-unit). Kalau `units` kosong, dibentuk 1 unit dari field kendaraan legacy.
    """
    now = datetime.now(timezone.utc).isoformat()
    # Bentuk daftar unit — dari payload.units, atau dari field kendaraan legacy
    raw_units = [u.dict() for u in payload.units] if payload.units else []
    raw_units = [u for u in raw_units if any((u.get(k) or "").strip() for k in ("vehicle_type", "nopol", "no_rangka", "tipe_model"))]
    if not raw_units:
        raw_units = [_legacy_unit_src({
            "vehicle_type": payload.vehicle_type, "nopol": payload.nopol, "no_rangka": payload.no_rangka,
            "warna": payload.warna, "tahun": payload.tahun,
        })]
    if len(raw_units) > UNIT_MAX_PER_ORDER:
        raise HTTPException(400, f"Maksimal {UNIT_MAX_PER_ORDER} unit per PO via form. Lebih dari itu hubungi admin.")

    valid_types = await _all_valid_vehicle_types()
    for u in raw_units:
        vt_u = (u.get("vehicle_type") or "").strip()
        if vt_u and vt_u not in valid_types:
            raise HTTPException(400, f"vehicle_type tidak valid: {vt_u}")
    units = [_new_unit(u, now) for u in raw_units]

    if not (payload.asal_kota or "").strip():
        raise HTTPException(400, "asal_kota wajib diisi")
    if not (payload.tujuan_kota or "").strip():
        raise HTTPException(400, "tujuan_kota wajib diisi")
    if not (payload.customer_nama or "").strip():
        raise HTTPException(400, "customer_nama wajib diisi")
    if not (payload.customer_hp or "").strip():
        raise HTTPException(400, "customer_hp wajib diisi")

    # ── 1 unit = 1 PO terpisah ──
    # Tiap unit yang pelanggan tambah dijadikan order/PO sendiri (kartu terpisah
    # di admin) biar Surat Jalan & Invoice per-unit dan nggak numpuk di 1 tab.
    # Kalau perlu digabung, admin tetap bisa lewat Jadwal / Invoice Gabungan.
    # Field non-unit (asal/tujuan/customer/pickup/colly) di-share ke tiap PO.
    shared = {
        "km": (payload.km or "").strip()[:12],
        "kondisi": (payload.kondisi or "Bekas").strip()[:20],
        "panjang": (payload.panjang or "").strip()[:12],
        "lebar": (payload.lebar or "").strip()[:12],
        "tinggi": (payload.tinggi or "").strip()[:12],
        "isi_kiriman": (payload.isi_kiriman or "").strip()[:200],
        "jumlah_colly": (payload.jumlah_colly or "").strip()[:10],
        "asal_kota": payload.asal_kota.strip()[:80],
        "asal_alamat": (payload.asal_alamat or "").strip()[:120],
        "pickup_date": (payload.pickup_date or "").strip()[:10],
        "pickup_time": (payload.pickup_time or "").strip()[:5],
        "pickup_pic": (payload.pickup_pic or "").strip()[:120],
        "pickup_hp": (payload.pickup_hp or "").strip()[:30],
        "tujuan_kota": payload.tujuan_kota.strip()[:80],
        "tujuan_alamat": (payload.tujuan_alamat or "").strip()[:120],
        "delivery_pic": (payload.delivery_pic or "").strip()[:120],
        "delivery_hp": (payload.delivery_hp or "").strip()[:30],
        "customer_nama": payload.customer_nama.strip()[:120],
        "customer_hp": payload.customer_hp.strip()[:30],
        "customer_email": (payload.customer_email or "").strip()[:120],
        "catatan": (payload.catatan or "").strip()[:500],
    }
    created = []
    for u in units:
        order_id = f"ORD-{uuid.uuid4().hex[:10].upper()}"
        doc = {
            "order_id": order_id,
            "status": "NEW",                # NEW → CONFIRMED → DISPATCHED → COMPLETED → CANCELLED
            "units": [u],                   # F1 — 1 unit per PO
            "jumlah_unit": 1,
            # ── mirror unit ke field legacy (back-compat: Surat Jalan, trip convert, invoice) ──
            "vehicle_type": u["vehicle_type"],
            "nopol": u["nopol"],
            "no_rangka": u["no_rangka"],
            "warna": u["warna"],
            "tahun": u["tahun"],
            **shared,
            "trip_id": None,                 # filled when admin converts order → trip
            # ── status pengiriman WhatsApp konfirmasi (auto setelah order tersimpan) ──
            "wa_status": "belum_dikirim",    # belum_dikirim | terkirim | gagal | dikirim_ulang
            "wa_to": _wa_normalize(shared.get("customer_hp") or ""),
            "wa_attempts": 0,
            "created_at": now,
            "updated_at": now,
        }
        await db.orders.insert_one(doc)
        # Fire Odoo webhook (no-op when ODOO_WEBHOOK_URL empty — see notify_odoo)
        await notify_odoo("order.created", {
            "order_id": order_id,
            "customer": {"nama": doc["customer_nama"], "hp": doc["customer_hp"], "email": doc["customer_email"]},
            "vehicle": {"type": doc["vehicle_type"], "nopol": doc["nopol"]},
            "route": f'{doc["asal_kota"]} → {doc["tujuan_kota"]}',
            "pickup": {"date": doc["pickup_date"], "time": doc["pickup_time"]},
        })
        doc.pop("_id", None)
        created.append(doc)

    # Kirim WhatsApp konfirmasi + link tracking ke pelanggan — di background biar
    # submit tetap cepat. Best-effort: order sudah tersimpan, status kirim
    # disimpan per order (wa_*) & bisa dikirim ulang dari dashboard / halaman sukses.
    for d in created:
        asyncio.create_task(send_tracking_whatsapp(d))

    # Balikin order pertama (buat SuccessScreen) + daftar semua order_id yang
    # dibuat (frontend pakai buat upload berkas ke tiap PO).
    resp = dict(created[0])
    resp["orders_created"] = [d["order_id"] for d in created]
    resp["jumlah_pesanan"] = len(created)
    resp["wa_to_masked"] = _wa_mask(resp.get("customer_hp") or "")
    resp["wa_valid"] = _wa_valid_id(resp.get("customer_hp") or "")
    return resp


@api_router.post("/orders/{order_id}/attachment")
async def upload_order_attachment(order_id: str, file: UploadFile = File(...), label: str = Form("")):
    """Pelanggan/ekspedisi upload berkas scan (PDF/gambar) untuk order ini.
    Tersimpan di order.attachments[] dan tampil di admin dashboard."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    url = _save_upload(order_id, "berkas", file, ALLOWED_IMG | ALLOWED_DOC)
    entry = {
        "url": url,
        "filename": (file.filename or "berkas")[:120],
        "label": (label or "").strip()[:80],
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await db.orders.update_one(
        {"order_id": order_id},
        {"$push": {"attachments": entry}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    return entry


@api_router.get("/orders/{order_id}")
async def get_order(order_id: str):
    doc = await db.orders.find_one({"order_id": order_id})
    if not doc:
        raise HTTPException(404, "Order not found")
    doc.pop("_id", None)
    doc = await _ensure_order_units(doc)
    doc["unit_summary"] = _order_unit_summary(doc)
    return doc


def _wa_public_view(order: dict) -> dict:
    """Ringkasan status WA yang aman ditampilkan ke pelanggan (tanpa data sensitif)."""
    return {
        "order_id": order.get("order_id"),
        "wa_status": order.get("wa_status", "belum_dikirim"),
        "wa_to_masked": _wa_mask(order.get("wa_to") or order.get("customer_hp") or ""),
        "wa_sent_at": order.get("wa_sent_at"),
        "wa_valid": _wa_valid_id(order.get("customer_hp") or ""),
        "tracking_url": order.get("wa_tracking_url") or f"{PUBLIC_BASE_URL}/?track={order.get('order_id')}",
    }


@api_router.get("/orders/{order_id}/wa-status")
async def get_order_wa_status(order_id: str):
    """Status pengiriman WA untuk halaman sukses pelanggan (polling ringan)."""
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    return _wa_public_view(order)


def _wa_recent(order: dict, secs: int = 15) -> bool:
    """True kalau WA baru saja dikirim (<secs detik) — cegah kirim dobel karena
    tombol ditekan berulang."""
    ts = order.get("wa_updated_at") or order.get("wa_sent_at")
    if not ts:
        return False
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - t).total_seconds() < secs
    except Exception:
        return False


@api_router.post("/orders/{order_id}/resend-wa")
async def public_resend_wa(order_id: str):
    """Kirim ulang WA ke nomor yang TERSIMPAN di order (dipakai tombol di halaman
    sukses pelanggan). Anti-dobel: kalau baru saja terkirim, balikin status
    sekarang tanpa kirim lagi. Nomor tidak bisa diganti dari sini."""
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    if order.get("wa_status") in ("terkirim", "dikirim_ulang") and _wa_recent(order):
        return _wa_public_view(order)
    await send_tracking_whatsapp(order, resend=True)
    fresh = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    return _wa_public_view(fresh or order)


@api_router.post("/admin/orders/{order_id}/resend-wa", dependencies=[Depends(require_admin_pin)])
async def admin_resend_wa(order_id: str):
    """Admin kirim ulang WA konfirmasi/tracking dari dashboard."""
    order = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    if not order:
        raise HTTPException(404, "Order not found")
    upd = await send_tracking_whatsapp(order, resend=True)
    return {
        "ok": upd.get("wa_status") in ("terkirim", "dikirim_ulang"),
        "wa_error": upd.get("wa_error"),          # alasan gagal asli dari provider (buat admin)
        "wa_message_id": upd.get("wa_message_id"),
        **_wa_public_view({**order, **upd}),
    }


@api_router.get("/orders")
async def list_orders(limit: int = 50, status: Optional[str] = None):
    """Admin-friendly listing. Last 50 orders newest-first."""
    q = {}
    if status:
        q["status"] = status.strip().upper()[:20]
    cur = db.orders.find(q).sort("created_at", -1).limit(max(1, min(200, limit)))
    items = []
    async for d in cur:
        d.pop("_id", None)
        d = await _ensure_order_units(d)
        d["unit_summary"] = _order_unit_summary(d)
        items.append(d)
    return {"count": len(items), "items": items}


@api_router.post("/admin/orders/migrate-units", dependencies=[Depends(require_admin_pin)])
async def migrate_orders_units():
    """Migrasi one-off semua order lama → units[0] (idempotent, per-order aman).
    Field legacy TIDAK dihapus (jadi cadangan). Aman dijalankan berulang."""
    migrated, skipped, errors = 0, 0, 0
    sample = None
    async for d in db.orders.find({}):
        d.pop("_id", None)
        units = d.get("units")
        if isinstance(units, list) and len(units) > 0:
            skipped += 1
            continue
        try:
            await _ensure_order_units(d)
            migrated += 1
            if sample is None:
                sample = {"order_id": d.get("order_id"), "units": d.get("units")}
        except Exception as e:  # noqa: BLE001
            errors += 1
            logger.warning(f"[units:migrate-endpoint] {d.get('order_id')}: {e}")
    return {"migrated": migrated, "skipped": skipped, "errors": errors, "sample": sample}


class MarkInvoicedBody(BaseModel):
    unit_ids: List[str] = []
    status: str = "Sudah Diinvoice"   # atau "Belum Ditagih" untuk batal


@api_router.post("/admin/orders/{order_id}/units/mark-invoiced", dependencies=[Depends(require_admin_pin)])
async def mark_units_invoiced(order_id: str, body: MarkInvoicedBody):
    """Set status_invoice pada unit terpilih (dipakai saat invoice dicetak).
    Idempotent — set ke nilai yang sama tidak masalah."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    order = await _ensure_order_units(order)
    ids = set(body.unit_ids or [])
    status = (body.status or "Sudah Diinvoice").strip() or "Sudah Diinvoice"
    now = datetime.now(timezone.utc).isoformat()
    units = order.get("units") or []
    changed = 0
    for u in units:
        if u.get("unit_id") in ids:
            u["status_invoice"] = status
            u["updated_at"] = now
            changed += 1
    await db.orders.update_one({"order_id": order_id}, {"$set": {"units": units, "updated_at": now}})
    return {"ok": True, "changed": changed, "unit_summary": _order_unit_summary(order)}


class JadwalUnitBody(BaseModel):
    unit_id: str
    tujuan: Optional[str] = None
    no_mesin: Optional[str] = None
    nama_kapal: Optional[str] = None
    etd: Optional[str] = None          # YYYY-MM-DD
    transit_hari: Optional[int] = None


class JadwalBody(BaseModel):
    tanggal_siap: Optional[str] = None       # tanggal unit siap kirim
    catatan_jadwal: Optional[str] = None
    pelabuhan_asal: Optional[str] = None
    units: List[JadwalUnitBody] = []


@api_router.patch("/admin/orders/{order_id}/jadwal", dependencies=[Depends(require_admin_pin)])
async def set_order_jadwal(order_id: str, body: JadwalBody):
    """Simpan jadwal pengiriman: field per-unit (tujuan, no_mesin, nama kapal,
    ETD, lama transit) + info PO (tanggal siap, pelabuhan asal, catatan).
    Master (tujuan/no_mesin) & operasional (kapal/etd/transit) di satu tempat."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    order = await _ensure_order_units(order)
    now = datetime.now(timezone.utc).isoformat()
    patch_by_id = {u.unit_id: u for u in body.units}
    units = order.get("units") or []
    for u in units:
        p = patch_by_id.get(u.get("unit_id"))
        if not p:
            continue
        if p.tujuan is not None:       u["tujuan"] = p.tujuan.strip()[:80]
        if p.no_mesin is not None:     u["no_mesin"] = p.no_mesin.strip().upper()[:40]
        if p.nama_kapal is not None:   u["nama_kapal"] = p.nama_kapal.strip()[:80]
        if p.etd is not None:
            etd = p.etd.strip()
            u["etd"] = etd if re.match(r"^\d{4}-\d{2}-\d{2}$", etd) else ""
        if p.transit_hari is not None: u["transit_hari"] = max(0, int(p.transit_hari))
        u["updated_at"] = now
    upd = {"units": units, "updated_at": now}
    if body.tanggal_siap is not None:
        ts = body.tanggal_siap.strip()
        upd["tanggal_siap"] = ts if re.match(r"^\d{4}-\d{2}-\d{2}$", ts) else ""
    if body.catatan_jadwal is not None:
        upd["catatan_jadwal"] = body.catatan_jadwal.strip()[:500]
    if body.pelabuhan_asal is not None:
        upd["pelabuhan_asal"] = body.pelabuhan_asal.strip()[:120]
    await db.orders.update_one({"order_id": order_id}, {"$set": upd})
    doc = await db.orders.find_one({"order_id": order_id}, {"_id": 0})
    doc = await _ensure_order_units(doc)
    doc["unit_summary"] = _order_unit_summary(doc)
    return doc


class OrderConvertBody(BaseModel):
    trip_id: Optional[str] = None        # if empty, auto-generate from order_id
    driver_id: Optional[str] = None
    uj: int = 0
    t1: int = 0
    t2: int = 0
    t3: int = 0
    bonus_daily: int = 30000
    bonus_kerajinan: int = 150000


@api_router.post("/orders/{order_id}/convert")
async def convert_order_to_trip(order_id: str, payload: OrderConvertBody):
    """Bridge order → trip. Idempotent: if order.trip_id already set, return existing trip.
    Creates a trip with route/vehicle pre-filled from order; sets order.trip_id + status=DISPATCHED."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")

    # Idempotent: if order already converted, return existing trip
    existing_trip_id = order.get("trip_id")
    if existing_trip_id:
        existing = await db.trips.find_one({"trip_id": existing_trip_id})
        if existing:
            return {
                "order_id": order_id,
                "trip_id": existing_trip_id,
                "status": order.get("status"),
                "trip": trip_doc_to_public(existing),
                "already_converted": True,
            }

    # Derive trip_id
    trip_id = (payload.trip_id or "").strip() or f"TRIP-{order_id}"
    # Refuse if trip_id already used by another order/trip
    existing = await db.trips.find_one({"trip_id": trip_id})
    if existing:
        raise HTTPException(409, f"trip_id '{trip_id}' sudah dipakai. Sebutkan trip_id lain.")

    route = f'{order.get("asal_kota","")} - {order.get("tujuan_kota","")}'.strip(" -") or "—"
    nopol = (order.get("nopol") or "").strip() or f"TBD-{order_id[-4:]}"

    now = datetime.now(timezone.utc).isoformat()
    trip_doc = {
        "trip_id": trip_id,
        "id": str(uuid.uuid4()),
        "driver_id": (payload.driver_id or "").strip() or None,
        "nopol": nopol[:20],
        "route": route[:200],
        "uj": payload.uj, "t1": payload.t1, "t2": payload.t2, "t3": payload.t3,
        "bonus_daily": payload.bonus_daily, "bonus_kerajinan": payload.bonus_kerajinan,
        "tipe_kendaraan": order.get("vehicle_type", ""),
        "no_rangka": order.get("no_rangka", ""),
        "legs": [],
        "nama_driver": (order.get("nama_driver") or "").strip()[:120],
        "sop_read": False,
        "initial_photos": {},
        "daily_checkpoints": [],
        "handover": {"bastk": [], "resi": None},
        "album": {"asal": [], "kapal": [], "tujuan": [], "dokumen": []},
        "cair": {"1": False, "2": False, "3": False},
        "xendit": {
            "t1": {"id": None, "status": None, "ts": None},
            "t2": {"id": None, "status": None, "ts": None},
            "t3": {"id": None, "status": None, "ts": None},
        },
        "odoo_synced": {"handover": False, "cair_1": False, "cair_2": False, "cair_3": False},
        # Pre-fill BASTK customer_data from order so PDF auto-populated
        "customer_data": {
            "nama":    (order.get("customer_nama") or "")[:120],
            "hp":      (order.get("customer_hp") or "")[:30],
            "alamat":  (order.get("tujuan_alamat") or order.get("asal_alamat") or "")[:300],
            "pic":     (order.get("customer_nama") or order.get("delivery_pic") or order.get("pickup_pic") or "")[:120],
            "warna":   (order.get("warna") or "")[:40],
            "tahun":   (order.get("tahun") or "")[:6],
            "km":      (order.get("km") or "")[:12],
            "kondisi": (order.get("kondisi") or "Bekas")[:20],
            # Penyerah (lokasi jemput / asal) & Penerima (lokasi antar / tujuan)
            "penyerah_nama":   (order.get("pickup_pic") or order.get("customer_nama") or "")[:120],
            "penyerah_hp":     (order.get("pickup_hp") or order.get("customer_hp") or "")[:30],
            "penyerah_alamat": (order.get("asal_alamat") or "")[:300],
            "penerima_nama":   (order.get("delivery_pic") or order.get("customer_nama") or "")[:120],
            "penerima_hp":     (order.get("delivery_hp") or order.get("customer_hp") or "")[:30],
            "penerima_alamat": (order.get("tujuan_alamat") or "")[:300],
        },
        "vehicle_type": order.get("vehicle_type", ""),
        # Backlink to source order
        "source_order_id": order_id,
        "created_at": now,
        "updated_at": now,
    }
    await db.trips.insert_one(trip_doc)
    # Update order — include driver_id if provided in convert payload
    order_upd: dict = {"trip_id": trip_id, "status": "DISPATCHED", "updated_at": now}
    if payload.driver_id:
        order_upd["driver_id"] = payload.driver_id.strip()[:60]
    await db.orders.update_one(
        {"order_id": order_id},
        {"$set": order_upd},
    )
    # Fire Odoo sync (webhook + real XML-RPC if env present)
    await notify_odoo("order.converted", {
        "order_id": order_id, "trip_id": trip_id,
        "route": route, "nopol": nopol, "vehicle": order.get("vehicle_type"),
        "customer": {"nama": order.get("customer_nama"), "hp": order.get("customer_hp")},
    })
    # Real Odoo XML-RPC: create sale.order if configured (best-effort, fire-and-forget)
    asyncio.create_task(_odoo_sync_order(order_id, trip_id, order))

    doc_pub = trip_doc_to_public(trip_doc)
    return {
        "order_id": order_id,
        "trip_id": trip_id,
        "status": "DISPATCHED",
        "trip": doc_pub,
        "already_converted": False,
    }


ODOO_SERVICE_PRODUCT = "Jasa Pengiriman Kendaraan"


async def _odoo_service_product_id(odoo) -> Optional[int]:
    """Find (or create) a generic service product used as the SO line product."""
    pids = await asyncio.to_thread(
        odoo.call, "product.product", "search",
        [[["name", "=", ODOO_SERVICE_PRODUCT]]], {"limit": 1},
    )
    if pids:
        return pids[0]
    # type=service so no stock tracking; detailed_type required on some Odoo versions
    pid = await asyncio.to_thread(
        odoo.call, "product.product", "create",
        [{"name": ODOO_SERVICE_PRODUCT, "type": "service", "sale_ok": True, "list_price": 0.0}],
    )
    return pid


ODOO_VEHICLE_ATTRIBUTE = "JENIS KENDARAAN"

ODOO_LOGISTIK_TAX_NAME = "PPn Logistik (1.1%)"
ODOO_LOGISTIK_TAX_RATE = 0.011


async def _odoo_find_tax_id(odoo, name: str) -> Optional[int]:
    """Cari account.tax by exact name. Best-effort — None kalau nggak ketemu/error."""
    try:
        tax_ids = await asyncio.to_thread(
            odoo.call, "account.tax", "search",
            [[["name", "=", name]]], {"limit": 1},
        )
        return tax_ids[0] if tax_ids else None
    except Exception as e:
        logger.warning(f"[odoo:tax:exception] name={name}: {e}")
        return None


async def _odoo_post_internal_note(odoo, sale_id: int, note: str) -> None:
    """Log `note` sebagai chatter internal (mail.mt_note) di sale.order, BUKAN di
    field `note`/Terms & Conditions bawaan Odoo — field itu ikut ke-print di
    quotation/invoice PDF yang dikirim ke customer. Chatter log cuma keliatan
    di backend Odoo. Best-effort, never raises."""
    try:
        await asyncio.to_thread(
            odoo.call, "sale.order", "message_post",
            [[sale_id]], {"body": note.replace("\n", "<br/>"), "subtype_xmlid": "mail.mt_note"},
        )
    except Exception as e:
        logger.warning(f"[odoo:note:exception] sale_id={sale_id}: {e}")


async def _odoo_vehicle_variant_product_id(odoo, vehicle_type: str) -> Optional[int]:
    """Cari (atau buat) product.product varian dari "Jasa Pengiriman Kendaraan"
    sesuai vehicle_type, pakai product attribute "JENIS KENDARAAN" yang sudah ada
    di Odoo (Penjualan > Konfigurasi > Atribut). Best-effort: kalau attribute/
    template belum ada atau salah satu langkah gagal, fallback ke produk generik
    (_odoo_service_product_id) — SO tetap ke-buat walau variant-nya gagal."""
    vt = (vehicle_type or "").strip()
    base_product_id = await _odoo_service_product_id(odoo)
    if not vt or not base_product_id:
        return base_product_id

    try:
        # 1. Attribute "JENIS KENDARAAN" (sudah ada, dibuat manual di Odoo).
        attr_ids = await asyncio.to_thread(
            odoo.call, "product.attribute", "search",
            [[["name", "=", ODOO_VEHICLE_ATTRIBUTE]]], {"limit": 1},
        )
        if not attr_ids:
            logger.warning(f"[odoo:variant] attribute '{ODOO_VEHICLE_ATTRIBUTE}' tidak ditemukan, fallback ke produk generik")
            return base_product_id
        attr_id = attr_ids[0]

        # 2. Cari/buat attribute value sesuai vehicle_type persis.
        val_ids = await asyncio.to_thread(
            odoo.call, "product.attribute.value", "search",
            [[["attribute_id", "=", attr_id], ["name", "=", vt]]], {"limit": 1},
        )
        if val_ids:
            val_id = val_ids[0]
        else:
            val_id = await asyncio.to_thread(
                odoo.call, "product.attribute.value", "create",
                [{"name": vt, "attribute_id": attr_id}],
            )
        if not val_id:
            return base_product_id

        # 3. Template dari produk dasar.
        prod_rows = await asyncio.to_thread(
            odoo.call, "product.product", "read", [[base_product_id]], {"fields": ["product_tmpl_id"]},
        )
        if not prod_rows or not prod_rows[0].get("product_tmpl_id"):
            return base_product_id
        tmpl_id = prod_rows[0]["product_tmpl_id"][0]

        # 4. Pastikan template punya attribute line "JENIS KENDARAAN" yang include value ini.
        line_ids = await asyncio.to_thread(
            odoo.call, "product.template.attribute.line", "search",
            [[["product_tmpl_id", "=", tmpl_id], ["attribute_id", "=", attr_id]]], {"limit": 1},
        )
        if line_ids:
            line_id = line_ids[0]
            line_rows = await asyncio.to_thread(
                odoo.call, "product.template.attribute.line", "read", [[line_id]], {"fields": ["value_ids"]},
            )
            current_values = (line_rows[0].get("value_ids") or []) if line_rows else []
            if val_id not in current_values:
                await asyncio.to_thread(
                    odoo.call, "product.template.attribute.line", "write",
                    [[line_id], {"value_ids": [(4, val_id)]}],
                )
        else:
            await asyncio.to_thread(
                odoo.call, "product.template.attribute.line", "create",
                [{"product_tmpl_id": tmpl_id, "attribute_id": attr_id, "value_ids": [(6, 0, [val_id])]}],
            )

        # 5. Cari product.product varian yang match kombinasi value ini (Odoo
        #    auto-generate variant begitu attribute line di-update di step 4).
        variant_ids = await asyncio.to_thread(
            odoo.call, "product.product", "search",
            [[["product_tmpl_id", "=", tmpl_id],
              ["product_template_attribute_value_ids.product_attribute_value_id", "=", val_id]]],
            {"limit": 1},
        )
        if variant_ids:
            return variant_ids[0]
        logger.warning(f"[odoo:variant] varian utk '{vt}' belum ke-generate Odoo, fallback ke produk dasar")
        return base_product_id
    except Exception as e:
        logger.warning(f"[odoo:variant:exception] vehicle_type={vt}: {e}")
        return base_product_id


def _odoo_line_desc(order: dict, order_id: str, trip_id: str) -> str:
    """Build a tight, one-line order-line description — cuma detail unit
    kendaraan. Route/Pickup/Ref/Catatan customer udah ada di catatan internal
    SO (lihat `note` di _odoo_sync_order), jadi nggak diulang di kolom produk
    biar nggak boros (dan placeholder kosong kayak "-" nggak ikut ke-print)."""
    def clean(v):
        v = str(v or "").strip()
        return v if v and v not in ("-", "--", "—") else ""

    nopol = clean(order.get("nopol"))
    warna = clean(order.get("warna"))
    tahun = clean(order.get("tahun"))
    rangka = clean(order.get("no_rangka"))
    veh = []
    if nopol:  veh.append(f"Nopol {nopol}")
    if warna:  veh.append(warna)
    if tahun:  veh.append(f"Th {tahun}")
    if rangka: veh.append(f"Rangka {rangka}")
    return " · ".join(veh) if veh else (order.get("vehicle_type") or "Kendaraan")


async def _odoo_sync_order(
    order_id: str, trip_id: str, order: dict, price: float = 0.0,
    tax_mode: str = "logistik", price_includes_tax: bool = False,
) -> dict:
    """Best-effort real Odoo XML-RPC sync.
    - Find/creates res.partner (customer) with address from the order.
    - Creates sale.order linked to partner with origin=order_id AND a real order
      line (service product + route/vehicle description + price).
    - Idempotent: reuses existing sale.order for this origin; if that SO has no
      lines yet, backfills one so old empty SOs get fixed on re-click.
    - tax_mode: "logistik" (default, pakai PPn Logistik 1.1%) atau "no_tax"
      (baris tanpa pajak sama sekali — dipakai kadang buat pengiriman fretail).
    - price_includes_tax: kalau True, `price` dianggap harga jual sudah termasuk
      PPN, jadi price_unit yang dikirim ke Odoo di-back-calculate supaya total
      SO (setelah Odoo hitung pajak) tetep sama dengan `price` yang diinput.
    Returns {"ok": bool, "sale_id": int|None, "partner_id": int|None, "error": str|None}.
    No-op when OdooClient.enabled is False. Never raises."""
    odoo = OdooClient()
    if not odoo.enabled:
        logger.info(f"[odoo:sync_order:skip] order_id={order_id} (env not configured)")
        return {"ok": False, "sale_id": None, "partner_id": None, "error": "Odoo env not configured"}

    if not odoo.authenticate():
        logger.warning(f"[odoo:sync_order:auth_fail] order_id={order_id}")
        return {"ok": False, "sale_id": None, "partner_id": None, "error": "Gagal autentikasi ke Odoo (cek ODOO_DB/USER/KEY)"}

    try:
        product_id = await _odoo_vehicle_variant_product_id(odoo, order.get("vehicle_type"))
        line_desc = _odoo_line_desc(order, order_id, trip_id)

        unit_price = float(price or 0)
        tax_ids: Optional[List[int]] = None
        if tax_mode == "no_tax":
            tax_ids = []
        else:
            logistik_tax_id = await _odoo_find_tax_id(odoo, ODOO_LOGISTIK_TAX_NAME)
            if logistik_tax_id:
                tax_ids = [logistik_tax_id]
            if price_includes_tax and unit_price:
                unit_price = unit_price / (1 + ODOO_LOGISTIK_TAX_RATE)

        def _build_line(force_tax: bool = True):
            vals = {"name": line_desc, "product_uom_qty": 1, "price_unit": unit_price}
            if product_id:
                vals["product_id"] = product_id
            if force_tax and tax_ids is not None:
                vals["tax_id"] = [(6, 0, tax_ids)]
            return [(0, 0, vals)]

        # NB: sale.order punya 1 field `note` doang, dan itu sebenarnya field
        # "Terms & Conditions" yang IKUT KE-PRINT di quotation/invoice PDF customer
        # -- bukan internal-only. Jadi info operasional (route/pickup/ref/catatan)
        # nggak boleh taruh di situ; dipost sebagai chatter log note (mail.mt_note)
        # lewat _odoo_post_internal_note, yang cuma keliatan di backend Odoo.
        note = (
            f"Order: {order_id} | Trip: {trip_id}\n"
            f"Route: {order.get('asal_kota','')} → {order.get('tujuan_kota','')}\n"
            f"Vehicle: {order.get('vehicle_type','')} {order.get('nopol','')}\n"
            f"Pickup: {order.get('pickup_date','')} {order.get('pickup_time','')}\n"
            f"Catatan: {order.get('catatan','')}"
        )

        # 0. Idempotency — reuse existing sale.order for this origin if present.
        existing = await asyncio.to_thread(
            odoo.call, "sale.order", "search",
            [[["origin", "=", order_id]]], {"limit": 1},
        )
        if existing:
            sale_id = existing[0]
            # Backfill a line if the existing SO is empty (fixes old empty SOs).
            rows = await asyncio.to_thread(
                odoo.call, "sale.order", "read", [[sale_id]], {"fields": ["order_line"]},
            )
            has_lines = bool(rows and rows[0].get("order_line"))
            if not has_lines:
                wrote = await asyncio.to_thread(
                    odoo.call, "sale.order", "write", [[sale_id], {"order_line": _build_line()}],
                )
                if not wrote and tax_ids is not None:
                    # Kemungkinan tax record beda company/incompatible — retry tanpa override tax.
                    logger.warning(f"[odoo:sync_order:backfill_line_tax_retry] order={order_id} sale={sale_id}")
                    await asyncio.to_thread(
                        odoo.call, "sale.order", "write", [[sale_id], {"order_line": _build_line(force_tax=False)}],
                    )
                await _odoo_post_internal_note(odoo, sale_id, note)
                logger.info(f"[odoo:sync_order:backfill_line] order={order_id} sale={sale_id}")
            logger.info(f"[odoo:sync_order:reuse] order={order_id} sale={sale_id}")
            await db.orders.update_one(
                {"order_id": order_id},
                {"$set": {"odoo.sale_order_id": sale_id, "odoo.ts": datetime.now(timezone.utc).isoformat()}},
            )
            return {"ok": True, "sale_id": sale_id, "partner_id": None, "error": None}

        # 1. Find or create partner (with address from order).
        partner_name = (order.get("customer_nama") or "").strip() or f"Customer {order_id}"
        partner_hp = (order.get("customer_hp") or "").strip()
        partner_email = (order.get("customer_email") or "").strip()
        partner_street = (order.get("tujuan_alamat") or order.get("asal_alamat") or "").strip()
        partner_city = (order.get("tujuan_kota") or "").strip()

        partner_ids = await asyncio.to_thread(
            odoo.call, "res.partner", "search",
            [[["name", "=", partner_name]]], {"limit": 1},
        )
        if partner_ids:
            partner_id = partner_ids[0]
        else:
            partner_id = await asyncio.to_thread(
                odoo.call, "res.partner", "create",
                [{
                    "name": partner_name,
                    "phone": partner_hp or False,
                    "email": partner_email or False,
                    "street": partner_street or False,
                    "city": partner_city or False,
                    "customer_rank": 1,
                }],
            )
        if not partner_id:
            logger.warning(f"[odoo:sync_order:partner_fail] order_id={order_id}")
            return {"ok": False, "sale_id": None, "partner_id": None, "error": "Gagal membuat customer di Odoo"}

        # 2. Create sale.order WITH a real order line.
        sale_id = await asyncio.to_thread(
            odoo.call, "sale.order", "create",
            [{
                "partner_id": partner_id,
                "origin": order_id,
                "client_order_ref": trip_id,
                "order_line": _build_line(),
            }],
        )
        if not sale_id and tax_ids is not None:
            # Create gagal, kemungkinan tax record incompatible (beda company/dll).
            # Retry sekali tanpa override tax_id (ikut default pajak produk) biar
            # SO tetep ke-buat walau fitur tax-nya nggak jalan.
            logger.warning(f"[odoo:sync_order:create_tax_retry] order_id={order_id}")
            sale_id = await asyncio.to_thread(
                odoo.call, "sale.order", "create",
                [{
                    "partner_id": partner_id,
                    "origin": order_id,
                    "client_order_ref": trip_id,
                    "order_line": _build_line(force_tax=False),
                }],
            )
        if sale_id:
            logger.info(f"[odoo:sync_order:ok] order={order_id} trip={trip_id} partner={partner_id} sale={sale_id}")
            await _odoo_post_internal_note(odoo, sale_id, note)
            await db.orders.update_one(
                {"order_id": order_id},
                {"$set": {
                    "odoo": {"partner_id": partner_id, "sale_order_id": sale_id, "ts": datetime.now(timezone.utc).isoformat()},
                }},
            )
            return {"ok": True, "sale_id": sale_id, "partner_id": partner_id, "error": None}
        else:
            logger.warning(f"[odoo:sync_order:sale_fail] order_id={order_id}")
            return {"ok": False, "sale_id": None, "partner_id": partner_id, "error": "Gagal membuat sale.order di Odoo"}
    except Exception as e:
        logger.warning(f"[odoo:sync_order:exception] order_id={order_id}: {e}")
        return {"ok": False, "sale_id": None, "partner_id": None, "error": str(e)}


async def _odoo_confirm_invoice(trip_id: str, trip: dict) -> None:
    """Trip selesai (BASTK + Resi uploaded) → confirm sale.order → auto-create invoice di Odoo.
    Best-effort, never raises."""
    odoo = OdooClient()
    if not odoo.enabled:
        return
    try:
        order = await db.orders.find_one({"trip_id": trip_id})
        if not order:
            logger.info(f"[odoo:invoice:skip] no order linked to trip {trip_id}")
            return
        odoo_meta = order.get("odoo") or {}
        sale_id = odoo_meta.get("sale_order_id")
        if not sale_id:
            logger.info(f"[odoo:invoice:skip] no sale_order_id on order {order.get('order_id')}")
            return

        # Confirm the sale order (quotation → sales order)
        confirmed = await asyncio.to_thread(
            odoo.call, "sale.order", "action_confirm", [[sale_id]],
        )
        logger.info(f"[odoo:invoice:confirmed] sale_id={sale_id} trip={trip_id} result={confirmed}")

        # Create invoice from the confirmed SO
        invoice_ids = await asyncio.to_thread(
            odoo.call, "sale.order", "action_invoice_create", [[sale_id]], {"final": False},
        )
        if invoice_ids:
            logger.info(f"[odoo:invoice:created] invoice_ids={invoice_ids} sale_id={sale_id}")
            await db.orders.update_one(
                {"trip_id": trip_id},
                {"$set": {"odoo.invoice_ids": invoice_ids, "odoo.invoice_ts": datetime.now(timezone.utc).isoformat()}},
            )
        else:
            logger.info(f"[odoo:invoice:no_lines] sale_id={sale_id} — SO has no lines, skip invoice creation")
    except Exception as e:
        logger.warning(f"[odoo:invoice:exception] trip={trip_id}: {e}")


async def _odoo_log_expense(trip_id: str, trip: dict, tahap: int) -> None:
    """Pencairan uang jalan driver → catat sebagai hr.expense di Odoo (Pengeluaran).
    Best-effort, never raises."""
    odoo = OdooClient()
    if not odoo.enabled:
        return
    try:
        amount_field = {1: "t1", 2: "t2", 3: "t3"}[tahap]
        bonus = trip.get("bonus_kerajinan", 0) if tahap == 3 else 0
        amount = (trip.get(amount_field) or 0) + bonus
        if amount <= 0:
            return

        driver_name = (trip.get("nama_driver") or "").strip() or f"Driver {trip_id}"
        nopol = trip.get("nopol", "")
        label_tahap = {1: "Tahap 1 (Awal)", 2: "Tahap 2 (Tengah)", 3: "Tahap 3 (Selesai)"}[tahap]

        # Find or create employee record for this driver
        emp_ids = await asyncio.to_thread(
            odoo.call, "hr.employee", "search",
            [[["name", "=", driver_name]]], {"limit": 1},
        )
        if emp_ids:
            emp_id = emp_ids[0]
        else:
            emp_id = await asyncio.to_thread(
                odoo.call, "hr.employee", "create",
                [{"name": driver_name, "job_title": "Driver"}],
            )

        if not emp_id:
            logger.warning(f"[odoo:expense:emp_fail] driver={driver_name}")
            return

        # Find generic expense product "Uang Jalan Driver"
        prod_ids = await asyncio.to_thread(
            odoo.call, "product.product", "search",
            [[["name", "ilike", "Uang Jalan"]]], {"limit": 1},
        )
        product_id = prod_ids[0] if prod_ids else False

        expense_vals = {
            "name": f"Uang Jalan {label_tahap} — {nopol} ({trip_id})",
            "employee_id": emp_id,
            "total_amount": amount,
            "quantity": 1.0,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "description": f"Trip: {trip_id} | Nopol: {nopol} | Driver: {driver_name} | {label_tahap}",
        }
        if product_id:
            expense_vals["product_id"] = product_id

        expense_id = await asyncio.to_thread(
            odoo.call, "hr.expense", "create", [expense_vals],
        )
        if expense_id:
            logger.info(f"[odoo:expense:ok] expense_id={expense_id} trip={trip_id} tahap={tahap} amount={amount}")
            await db.trips.update_one(
                {"trip_id": trip_id},
                {"$set": {f"odoo_synced.expense_{tahap}": expense_id}},
            )
        else:
            logger.warning(f"[odoo:expense:fail] trip={trip_id} tahap={tahap}")
    except Exception as e:
        logger.warning(f"[odoo:expense:exception] trip={trip_id} tahap={tahap}: {e}")


# ---------- Admin Mini-Dashboard (v2.6d, PIN-gated) ----------
VALID_ORDER_STATUS = {"NEW", "DISPATCHED", "ON_TRIP", "DELIVERED", "CANCELLED"}


class AdminAuthBody(BaseModel):
    pin: str


@api_router.post("/admin/auth")
async def admin_auth(body: AdminAuthBody):
    """Validate PIN. Returns 200 if valid. Frontend stores PIN client-side."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected:
        raise HTTPException(503, "Admin disabled (ADMIN_PIN env not set)")
    if not body.pin or body.pin.strip() != expected:
        raise HTTPException(401, "Invalid PIN")
    return {"ok": True}


_HEIC_URL_RE = re.compile(r"\.hei[cf](\?|$)", re.I)


async def _migrate_entry_if_heic(trip_id: str, sub: str, entry: dict) -> bool:
    """entry punya key 'url'. Kalau url-nya HEIC/HEIF -> download, convert ke JPEG,
    upload ulang, dan entry['url'] diganti in-place. Return True kalau berubah."""
    url = (entry or {}).get("url") or ""
    if not _HEIC_URL_RE.search(url):
        return False
    try:
        data = _fetch_upload_bytes(url)
        jpg = _convert_heic_bytes(data)
        entry["url"] = _store_bytes(trip_id, sub, jpg, ".jpg", "image/jpeg")
        return True
    except Exception as e:
        logger.warning(f"[heic-migrate] gagal convert {trip_id}/{sub}: {e}")
        return False


@api_router.post("/admin/migrate-heic", dependencies=[Depends(require_admin_pin)])
async def migrate_heic_photos(trip_id: Optional[str] = Query(None)):
    """One-time perbaikan: scan foto yang sudah kadung tersimpan sebagai HEIC
    (sebelum konversi otomatis ada) dan convert jadi JPEG in-place. Idempotent -
    aman dipanggil berkali-kali, cuma foto yang masih HEIC yang diproses."""
    query = {"trip_id": trip_id} if trip_id else {}
    trips = await db.trips.find(query).to_list(length=None)
    updated_trips = []

    for trip in trips:
        tid = trip["trip_id"]
        changed = False

        initial = trip.get("initial_photos") or {}
        for slot, entry in initial.items():
            if isinstance(entry, dict) and await _migrate_entry_if_heic(tid, f"initial/{slot}", entry):
                changed = True

        daily = trip.get("daily_checkpoints") or []
        for entry in daily:
            if await _migrate_entry_if_heic(tid, "daily", entry):
                changed = True

        handover = trip.get("handover") or {}
        for entry in (handover.get("bastk") or []):
            if await _migrate_entry_if_heic(tid, "handover/bastk", entry):
                changed = True
        if handover.get("resi") and await _migrate_entry_if_heic(tid, "handover/resi", handover["resi"]):
            changed = True

        album = trip.get("album") or {}
        for stage, entries in album.items():
            for entry in (entries or []):
                if await _migrate_entry_if_heic(tid, f"album/{stage}", entry):
                    changed = True

        if changed:
            await db.trips.update_one({"trip_id": tid}, {"$set": {
                "initial_photos": initial,
                "daily_checkpoints": daily,
                "handover": handover,
                "album": album,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }})
            updated_trips.append(tid)

    return {"trips_scanned": len(trips), "trips_fixed": updated_trips, "count": len(updated_trips)}


@api_router.get("/admin/stats", dependencies=[Depends(require_admin_pin)])
async def admin_stats():
    """Counts by status. Used for dashboard chip badges."""
    counts = {s: 0 for s in VALID_ORDER_STATUS}
    pipeline = [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]
    async for d in db.orders.aggregate(pipeline):
        s = (d.get("_id") or "").upper()
        if s in counts:
            counts[s] = d["n"]
    total = sum(counts.values())
    trips_total = await db.trips.count_documents({})
    return {"total": total, "by_status": counts, "trips_total": trips_total}


@api_router.get("/admin/orders", dependencies=[Depends(require_admin_pin)])
async def admin_list_orders(
    limit: int = 100,
    status: Optional[str] = None,
    q: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Search + filter list for admin dashboard.
    - status: filter by single status (or empty = all)
    - q: case-insensitive search in customer_nama, customer_hp, asal_kota, tujuan_kota, nopol, order_id
    - date_from / date_to: YYYY-MM-DD (inclusive), filter on created_at
    Returns newest-first up to limit (clamped 1..500)."""
    filt = _admin_orders_filter(status, q, date_from, date_to)
    cur = db.orders.find(filt).sort("created_at", -1).limit(max(1, min(500, limit)))
    items = []
    async for d in cur:
        d.pop("_id", None)
        d = await _ensure_order_units(d)
        d["unit_summary"] = _order_unit_summary(d)
        items.append(d)
    return {"count": len(items), "items": items}


@api_router.get("/admin/deal-prices", dependencies=[Depends(require_admin_pin)])
async def admin_deal_prices():
    """Peta order_id -> { price, units }. price = harga deal customer yang
    tersimpan (trip.finance.invoice_total); units = jumlah unit di PO. Dipakai
    frontend buat auto-isi harga pas 'Tarik dari Order' (Invoice Gabungan &
    Selisih Harga) tanpa ketik manual — cuma auto buat PO 1 unit biar akurat
    (PO multi-unit invoice_total-nya total, jadi dibiarkan kosong)."""
    price_by_order = {}
    async for t in db.trips.find({}, {"_id": 0, "order_id": 1, "finance": 1}):
        oid = t.get("order_id")
        if oid:
            price_by_order[oid] = int((t.get("finance") or {}).get("invoice_total") or 0)
    out = {}
    async for o in db.orders.find({}, {"_id": 0, "order_id": 1, "units": 1}):
        oid = o.get("order_id")
        if not oid:
            continue
        units = o.get("units") or []
        out[oid] = {"price": price_by_order.get(oid, 0), "units": (len(units) if units else 1)}
    return {"prices": out}


class DocSeqBody(BaseModel):
    type: str = "doc"


@api_router.post("/doc-seq")
async def next_doc_seq(body: DocSeqBody):
    """Nomor urut dokumen (invoice/penawaran) yang auto-naik & tersimpan.
    Counter per-tipe di db.doc_counters, di-$inc atomik. Tanpa PIN karena
    cuma mengeluarkan angka urut (bukan data), dipakai dari halaman admin."""
    t = (body.type or "doc").strip().lower()[:20] or "doc"
    await db.doc_counters.update_one({"_id": t}, {"$inc": {"seq": 1}}, upsert=True)
    doc = await db.doc_counters.find_one({"_id": t})
    return {"type": t, "seq": int((doc or {}).get("seq") or 1)}


def _admin_orders_filter(
    status: Optional[str],
    q: Optional[str],
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
) -> dict:
    """Shared filter builder for /admin/orders and /admin/orders/export.csv.
    date_from/date_to: 'YYYY-MM-DD' inclusive. created_at stored as ISO string (UTC) — string compare safe because lexicographic == chronological for ISO 8601.
    """
    filt: dict = {}
    if status:
        s = status.strip().upper()
        if s and s in VALID_ORDER_STATUS:
            filt["status"] = s
    if q:
        qs = q.strip()
        if qs:
            import re as _re
            rx = _re.compile(_re.escape(qs), _re.IGNORECASE)
            filt["$or"] = [
                {"customer_nama": rx},
                {"customer_hp": rx},
                {"asal_kota": rx},
                {"tujuan_kota": rx},
                {"nopol": rx},
                {"no_rangka": rx},
                {"order_id": rx},
                # 1 unit = 1 PO: nopol/rangka sering ada di dalam units[], bukan top-level
                {"units.nopol": rx},
                {"units.no_rangka": rx},
            ]
    # Date range — created_at is ISO UTC; filter via lexicographic compare (chronological for ISO 8601)
    date_q: dict = {}
    if date_from:
        df = date_from.strip()[:10]
        if len(df) == 10:
            date_q["$gte"] = df + "T00:00:00"
    if date_to:
        dt = date_to.strip()[:10]
        if len(dt) == 10:
            # Inclusive end-of-day
            date_q["$lt"] = dt + "T23:59:59.999"
    if date_q:
        filt["created_at"] = date_q
    return filt


@api_router.get("/admin/orders/export.csv", dependencies=[Depends(require_admin_pin)])
async def admin_export_csv(
    status: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = 5000,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    """Export filtered orders to UTF-8 CSV (Excel-compatible, BOM prefixed).
    Columns: Order ID, Tanggal, Customer, HP, Driver, Nomor Polisi, Asal, Tujuan, Status, Harga (UJ), Trip ID.
    Harga is sourced from linked trip.uj when available (set during convert).
    Supports same filters as /admin/orders: status, q, date_from (YYYY-MM-DD), date_to (YYYY-MM-DD).
    """
    import csv as _csv
    import io as _io
    filt = _admin_orders_filter(status, q, date_from, date_to)
    cur = db.orders.find(filt).sort("created_at", -1).limit(max(1, min(20000, limit)))

    # Collect orders + linked trip_ids for batch lookup
    rows = []
    trip_ids = set()
    async for d in cur:
        d.pop("_id", None)
        rows.append(d)
        if d.get("trip_id"):
            trip_ids.add(d["trip_id"])

    # Batch-load trip uj values
    trip_uj_map: dict = {}
    if trip_ids:
        async for t in db.trips.find({"trip_id": {"$in": list(trip_ids)}}, {"trip_id": 1, "uj": 1, "_id": 0}):
            trip_uj_map[t.get("trip_id")] = t.get("uj", 0) or 0

    def _fmt_date(s: str) -> str:
        if not s: return ""
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            # Convert to WIB for human readability
            dt_wib = dt + timedelta(hours=7)
            return dt_wib.strftime("%d-%m-%Y %H:%M")
        except Exception:
            return s[:19]

    # Build CSV in-memory
    buf = _io.StringIO()
    # Excel detects encoding via BOM; semicolon delimiter is friendlier in id-ID Excel locale.
    # We use comma + UTF-8 BOM for broad compatibility.
    w = _csv.writer(buf, delimiter=",", quoting=_csv.QUOTE_MINIMAL, lineterminator="\r\n")
    w.writerow([
        "Order ID", "Tanggal", "Customer", "HP", "Driver",
        "Nomor Polisi", "Asal", "Tujuan", "Status", "Harga (UJ)", "Trip ID",
    ])
    for r in rows:
        tid = r.get("trip_id") or ""
        harga = trip_uj_map.get(tid, 0) if tid else 0
        w.writerow([
            r.get("order_id", ""),
            _fmt_date(r.get("created_at", "")),
            r.get("customer_nama", ""),
            r.get("customer_hp", ""),
            r.get("driver_id", "") or "",
            r.get("nopol", ""),
            r.get("asal_kota", ""),
            r.get("tujuan_kota", ""),
            r.get("status", ""),
            harga,
            tid,
        ])

    body = "\ufeff" + buf.getvalue()  # UTF-8 BOM for Excel
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    fname = f"alyssa-orders-{today}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{fname}"',
            "Cache-Control": "no-store",
        },
    )


class OrderPatchBody(BaseModel):
    status: Optional[str] = None
    driver_id: Optional[str] = None
    nama_driver: Optional[str] = None
    catatan: Optional[str] = None
    vehicle_type: Optional[str] = None
    nopol: Optional[str] = None
    no_rangka: Optional[str] = None
    jumlah_colly: Optional[str] = None
    pickup_arrival: Optional[str] = None  # aktual: kapan driver benar-benar sampai di lokasi jemput (ISO datetime-local)


@api_router.patch("/admin/orders/{order_id}", dependencies=[Depends(require_admin_pin)])
async def admin_patch_order(order_id: str, payload: OrderPatchBody):
    """Update order status and/or driver_id. Mirrors to linked trip when driver_id changes."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    upd: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.status is not None:
        s = payload.status.strip().upper()
        if s not in VALID_ORDER_STATUS:
            raise HTTPException(400, f"Invalid status. Valid: {sorted(VALID_ORDER_STATUS)}")
        upd["status"] = s
    if payload.driver_id is not None:
        upd["driver_id"] = payload.driver_id.strip()[:60]
    if payload.nama_driver is not None:
        upd["nama_driver"] = payload.nama_driver.strip()[:120]
    if payload.catatan is not None:
        upd["catatan"] = payload.catatan.strip()[:500]
    if payload.vehicle_type is not None:
        vt = payload.vehicle_type.strip()
        if vt and vt not in await _all_valid_vehicle_types():
            raise HTTPException(400, f"vehicle_type tidak valid")
        upd["vehicle_type"] = vt
    if payload.nopol is not None:
        upd["nopol"] = payload.nopol.strip()[:20]
    if payload.no_rangka is not None:
        upd["no_rangka"] = payload.no_rangka.strip()[:40]
    if payload.jumlah_colly is not None:
        upd["jumlah_colly"] = payload.jumlah_colly.strip()[:10]
    if payload.pickup_arrival is not None:
        upd["pickup_arrival"] = payload.pickup_arrival.strip()[:20]
    if len(upd) == 1:
        raise HTTPException(400, "No fields to update")
    await db.orders.update_one({"order_id": order_id}, {"$set": upd})

    # Mirror driver_id to linked trip
    tid = order.get("trip_id")
    if tid and "driver_id" in upd:
        await db.trips.update_one({"trip_id": tid}, {"$set": {"driver_id": upd["driver_id"], "updated_at": upd["updated_at"]}})
    # Mirror nama_driver to linked trip (shown on BASTK)
    if tid and "nama_driver" in upd:
        await db.trips.update_one({"trip_id": tid}, {"$set": {"nama_driver": upd["nama_driver"], "updated_at": upd["updated_at"]}})
    # Mirror vehicle changes to linked trip too
    if tid and ("vehicle_type" in upd or "nopol" in upd or "no_rangka" in upd):
        tupd = {"updated_at": upd["updated_at"]}
        if "vehicle_type" in upd:
            tupd["vehicle_type"] = upd["vehicle_type"]
            tupd["tipe_kendaraan"] = upd["vehicle_type"]
        if "nopol" in upd and upd["nopol"]:
            tupd["nopol"] = upd["nopol"]
        if "no_rangka" in upd:
            tupd["no_rangka"] = upd["no_rangka"]
        await db.trips.update_one({"trip_id": tid}, {"$set": tupd})

    # Reload
    fresh = await db.orders.find_one({"order_id": order_id})
    fresh.pop("_id", None)
    # Fire status event
    if "status" in upd:
        await notify_odoo("order.status_changed", {"order_id": order_id, "status": upd["status"], "trip_id": tid})
    return fresh


class LegsBody(BaseModel):
    legs: List[Dict[str, Any]] = []

@api_router.patch("/admin/trips/{trip_id}/legs", dependencies=[Depends(require_admin_pin)])
async def admin_patch_trip_legs(trip_id: str, body: LegsBody):
    """Simpan/update array legs (autosave). Tiap leg boleh bawa field bebas
    (kepala_rombongan, drivers[], dst). Server:
    - Stamp `route_leg_id` (DB ID persistent) ke leg yang belum punya.
    - PRESERVE field token/link existing (task_token, petugas_id, route_leg_id)
      dari data lama by route_leg_id supaya autosave/reopen TIDAK meregenerate link.
    Return legs final biar frontend sinkron ID-nya."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    old_by_id = {l.get("route_leg_id"): l for l in (trip.get("legs") or []) if l.get("route_leg_id")}
    legs = []
    for leg in (body.legs or []):
        leg = dict(leg)
        rid = leg.get("route_leg_id")
        if not rid:
            rid = str(uuid.uuid4())
            leg["route_leg_id"] = rid
        prev = old_by_id.get(rid) or {}
        # Jangan biarkan autosave menghapus token/link yang sudah dibuat.
        for keep in ("task_token", "petugas_id"):
            if not leg.get(keep) and prev.get(keep):
                leg[keep] = prev[keep]
        # stamp id tiap driver member yang belum punya
        drv = leg.get("drivers")
        if isinstance(drv, list):
            for d in drv:
                if isinstance(d, dict) and not d.get("id"):
                    d["id"] = str(uuid.uuid4())
        legs.append(leg)
    now = datetime.utcnow().isoformat()
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"legs": legs, "updated_at": now}})
    return {"ok": True, "trip_id": trip_id, "legs_count": len(legs), "legs": legs}


@api_router.get("/admin/trips/{trip_id}/legs", dependencies=[Depends(require_admin_pin)])
async def admin_get_trip_legs(trip_id: str):
    """Ambil legs lengkap (semua field admin) buat hydrate modal Route Leg saat
    dibuka lagi — reopen = data kembali persis. Stamp route_leg_id kalau ada leg
    lama yang belum punya (backward-compat), tanpa mengubah token."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    legs = trip.get("legs") or []
    changed = False
    for leg in legs:
        if not leg.get("route_leg_id"):
            leg["route_leg_id"] = str(uuid.uuid4()); changed = True
    if changed:
        await db.trips.update_one({"trip_id": trip_id}, {"$set": {"legs": legs}})
    return {"ok": True, "trip_id": trip_id, "legs": legs, "rombongan": trip.get("rombongan") or {}}


# ════════════════════════════════════════════════════════════════════
# ROUTE LEG — Petugas & Link Tugas (Fase 1)
# Master petugas (bisa dipakai ulang) + link tugas unik per-leg ber-token,
# akses ter-scope (petugas cuma lihat tugasnya), upload foto -> checkpoint.
# ════════════════════════════════════════════════════════════════════
import secrets as _secrets

# Checklist default per jenis leg (bisa diubah admin saat bikin link).
DEFAULT_LEG_CHECKLISTS = {
    # Self Drive FULL: 1 driver door-to-door (ambil di asal → antar ke tujuan, nyebrang
    # selat sendiri). Dapat checklist lengkap (pengambilan + serah terima).
    "Self Drive": [
        "Foto depan kendaraan", "Foto belakang kendaraan", "Foto sisi kanan", "Foto sisi kiri",
        "Foto speedometer", "Foto odometer", "Foto kondisi interior", "Foto kunci",
        "Foto BASTK / surat jalan", "Foto kerusakan (jika ada)",
        "Foto kendaraan sampai tujuan", "Foto serah terima customer", "Foto PoD / BASTK akhir",
    ],
    # Driver Asal (rute kapal/antar-pulau): CUMA foto pengambilan di asal. Biar driver
    # asal nggak masukin foto tujuan yang nggak relevan.
    "Self Drive Asal": [
        "Foto depan kendaraan", "Foto belakang kendaraan", "Foto sisi kanan", "Foto sisi kiri",
        "Foto speedometer", "Foto odometer", "Foto kondisi interior", "Foto kunci",
        "Foto BASTK / surat jalan", "Foto kerusakan (jika ada)",
    ],
    "Pelabuhan": [
        "Foto tiba di pelabuhan", "Foto di area antre", "Foto di area parkir pelabuhan",
        "Foto sebelum naik kapal", "Foto proses naik kapal", "Foto tiket/resi/manifest",
        "Foto nama kapal", "Foto tambahan",
    ],
    "Kapal": [
        "Foto kendaraan di dalam kapal", "Foto posisi parkir", "Foto pengamanan kendaraan",
        "Foto dek / lokasi", "Foto nama kapal",
    ],
    "Pelabuhan Tujuan": [
        "Foto turun dari kapal", "Foto kondisi setelah turun", "Foto di area pelabuhan tujuan",
        "Foto serah terima ke driver berikutnya", "Foto dokumen keluar pelabuhan",
    ],
    # Driver Tujuan: terima dari pelabuhan/driver sebelumnya → antar ke tujuan akhir.
    # Fokus kamera tujuan + dokumen + scan buat berkas.
    "Self Drive Tujuan": [
        "Foto saat diterima driver", "Foto 4 sisi kendaraan", "Foto speedometer/odometer",
        "Foto kendaraan sampai tujuan", "Foto serah terima customer", "Foto PoD / BASTK akhir",
        "Foto dokumen keluar / surat jalan", "Scan / foto berkas serah terima",
    ],
    "Towing": ["Foto kendaraan di towing", "Foto pengikatan", "Foto berangkat", "Foto tiba"],
    "Car Carrier": ["Foto kendaraan di carrier", "Foto pengikatan", "Foto berangkat", "Foto tiba"],
    "Handling": ["Foto proses handling", "Foto sebelum", "Foto sesudah"],
    "Lainnya": ["Foto 1", "Foto 2"],
}
VALID_PETUGAS_TIPE = {"Driver", "Petugas Pelabuhan", "Petugas Kapal", "Koordinator", "Lainnya"}
LEG_TASK_STATUS = {"belum_dibuka", "sudah_dibuka", "dikerjakan", "menunggu", "selesai", "kedaluwarsa", "dinonaktifkan"}

# ── ROLE CONFIG (logbook operasional per tahap) ─────────────────────
# Tiap tipe_tugas nentuin: album mana yg dipakai, tab yg muncul, instruksi foto
# (tulisan), jenis checkpoint yg boleh, & jenis dokumen. Halaman petugas
# di-render dari config ini (satu mesin, banyak peran). Akses di-scope: tiap
# token cuma balikin data-nya sendiri + tipe yg diizinkan (enforce 403).
ROLE_CONFIG = {
    "driver_asal": {
        "label": "Driver Asal", "petugas_tipe": "Driver", "album_key": "asal",
        "tabs": ["foto", "checkpoint", "dokumen"],
        "foto_title": "Tambah Foto Asal",
        "foto_instruksi": ["Depan kendaraan", "Belakang kendaraan", "Sisi kanan", "Sisi kiri",
                           "Speedometer / odometer", "Ban serep", "Lokasi penyimpanan dokumen kendaraan"],
        "checkpoint_types": ["Unit diterima", "Berangkat", "Tiba lokasi transit", "Masuk pelabuhan", "Serah ke petugas pelabuhan", "Lainnya"],
        "document_types": ["BASTK awal", "Surat Jalan", "Dokumen tambahan"],
    },
    "driver_tujuan": {
        "label": "Driver Tujuan", "petugas_tipe": "Driver", "album_key": "tujuan",
        "tabs": ["foto", "checkpoint", "scan"], "needs_penerima": True,
        "foto_title": "Tambah Foto Tujuan",
        "foto_instruksi": ["Depan kendaraan", "Belakang kendaraan", "Sisi kanan", "Sisi kiri",
                           "Speedometer / odometer", "Kendaraan sampai tujuan", "Serah terima kepada penerima"],
        "checkpoint_types": ["Unit diterima", "Berangkat dari pelabuhan/transit", "Dalam perjalanan", "Sampai tujuan", "Serah terima selesai", "Lainnya"],
        "document_types": ["BASTK akhir", "PoD", "Surat Jalan", "Dokumen akhir"],
    },
    "driver_full": {
        "label": "Driver (Self Drive)", "petugas_tipe": "Driver", "album_key": "asal",
        "tabs": ["foto", "checkpoint", "scan"], "needs_penerima": True,
        "foto_title": "Tambah Foto",
        "foto_instruksi": ["Depan", "Belakang", "Sisi kanan", "Sisi kiri", "Speedometer / odometer",
                           "Ban serep", "Kendaraan sampai tujuan", "Serah terima penerima"],
        "checkpoint_types": ["Unit diambil", "Berangkat", "Tiba lokasi transit", "Dalam perjalanan", "Sampai tujuan", "Serah terima selesai", "Lainnya"],
        "document_types": ["BASTK awal", "Surat Jalan", "BASTK akhir", "PoD", "Dokumen tambahan"],
    },
    "pelabuhan_asal": {
        "label": "Petugas Pelabuhan Asal", "petugas_tipe": "Petugas Pelabuhan", "album_key": "pelabuhan",
        "tabs": ["foto", "checkpoint", "dokumen"],
        "foto_title": "Tambah Foto Pelabuhan",
        "foto_instruksi": ["Kendaraan di luar pelabuhan (menuju masuk)", "Kendaraan tiba di pelabuhan",
                           "Area antre", "Area parkir", "Sebelum naik kapal", "Proses loading / naik kapal",
                           "Kendaraan sudah di dalam kapal", "Nama kapal", "Dokumen pelabuhan bila ada"],
        "checkpoint_types": ["Unit diterima", "Masuk pelabuhan", "Menunggu kapal", "Proses loading", "Naik kapal", "Kapal berangkat", "Serah ke petugas berikutnya"],
        "document_types": ["Dokumen pelabuhan", "Manifest", "Tiket / resi"],
    },
    "pelabuhan_tujuan": {
        "label": "Petugas Pelabuhan Tujuan", "petugas_tipe": "Petugas Pelabuhan", "album_key": "pelabuhan",
        "tabs": ["foto", "checkpoint", "dokumen"],
        "foto_title": "Tambah Foto Pelabuhan",
        "foto_instruksi": ["Kendaraan turun dari kapal", "Kondisi setelah turun", "Area pelabuhan tujuan",
                           "Serah terima ke driver berikutnya", "Dokumen keluar pelabuhan"],
        "checkpoint_types": ["Kapal tiba", "Kendaraan keluar kapal", "Keluar pelabuhan", "Serah ke driver tujuan", "Lainnya"],
        "document_types": ["Dokumen pelabuhan", "Manifest", "Tiket / resi"],
    },
    "kapal": {
        "label": "Petugas Kapal", "petugas_tipe": "Petugas Kapal", "album_key": "kapal",
        "tabs": ["foto", "checkpoint", "info_kapal"], "needs_info_kapal": True,
        "foto_title": "Tambah Foto Kapal",
        "foto_instruksi": ["Kendaraan sudah di kapal", "Posisi parkir kendaraan", "Pengamanan kendaraan",
                           "Lokasi / dek kendaraan", "Nama kapal"],
        "checkpoint_types": ["Kendaraan masuk kapal", "Kapal berangkat", "Transit", "Kapal tiba", "Kendaraan keluar kapal", "Serah ke petugas pelabuhan tujuan"],
        "document_types": [],
    },
}
DEFAULT_TIPE_TUGAS = "driver_asal"


def _role_cfg(tipe_tugas: str) -> dict:
    return ROLE_CONFIG.get(tipe_tugas or "", ROLE_CONFIG[DEFAULT_TIPE_TUGAS])


def _album_stage_for_jenis(jenis: str) -> str:
    j = (jenis or "").lower()
    if "kapal" in j:
        return "kapal"
    if "tujuan" in j:
        return "tujuan"
    return "asal"


def _petugas_public(p: dict) -> dict:
    return {
        "petugas_id": p.get("petugas_id"), "nama": p.get("nama", ""), "no_hp": p.get("no_hp", ""),
        "tipe": p.get("tipe", ""), "perusahaan": p.get("perusahaan", ""), "catatan": p.get("catatan", ""),
        "aktif": p.get("aktif", True),
    }


@api_router.get("/admin/petugas", dependencies=[Depends(require_admin_pin)])
async def list_petugas(q: Optional[str] = None, limit: int = 20):
    """Cari petugas (master) buat autocomplete di editor Route Leg."""
    import re
    filt = {}
    if q and q.strip():
        rx = re.compile(re.escape(q.strip()), re.IGNORECASE)
        filt = {"$or": [{"nama": rx}, {"no_hp": rx}, {"perusahaan": rx}]}
    items = []
    async for p in db.petugas_profiles.find(filt).sort("nama", 1).limit(max(1, min(50, limit))):
        p.pop("_id", None)
        items.append(_petugas_public(p))
    return {"items": items}


class PetugasBody(BaseModel):
    nama: str
    no_hp: str = ""
    tipe: str = "Driver"
    perusahaan: str = ""
    catatan: str = ""


@api_router.post("/admin/petugas", dependencies=[Depends(require_admin_pin)])
async def upsert_petugas(body: PetugasBody):
    """Buat / ambil petugas. Kalau nama+HP sama persis → pakai yang ada (nggak dobel)."""
    import re
    nama = (body.nama or "").strip()
    if not nama:
        raise HTTPException(400, "Nama petugas wajib diisi")
    no_hp = (body.no_hp or "").strip()
    tipe = body.tipe if body.tipe in VALID_PETUGAS_TIPE else "Lainnya"
    existing = await db.petugas_profiles.find_one({
        "nama": re.compile(f"^{re.escape(nama)}$", re.IGNORECASE),
        "no_hp": no_hp,
    })
    now = datetime.now(timezone.utc).isoformat()
    if existing:
        upd = {"tipe": tipe, "updated_at": now}
        if body.perusahaan.strip(): upd["perusahaan"] = body.perusahaan.strip()
        if body.catatan.strip(): upd["catatan"] = body.catatan.strip()
        await db.petugas_profiles.update_one({"petugas_id": existing["petugas_id"]}, {"$set": upd})
        existing.pop("_id", None)
        return _petugas_public({**existing, **upd})
    doc = {
        "petugas_id": str(uuid.uuid4()), "nama": nama[:120], "no_hp": no_hp[:30], "tipe": tipe,
        "perusahaan": body.perusahaan.strip()[:120], "catatan": body.catatan.strip()[:300],
        "aktif": True, "created_at": now, "updated_at": now,
    }
    await db.petugas_profiles.insert_one(doc)
    doc.pop("_id", None)
    return _petugas_public(doc)


def _leg_task_admin_view(t: dict) -> dict:
    """View lengkap buat admin (semua field task)."""
    t = dict(t); t.pop("_id", None)
    return t


def _leg_task_public_view(t: dict) -> dict:
    """View ter-scope buat petugas — TANPA harga/HPP/profit/invoice/leg lain.
    Cuma balikin data token ini sendiri (foto/checkpoint/dokumen dia)."""
    cfg = _role_cfg(t.get("tipe_tugas"))
    return {
        "token": t.get("token"),
        "tipe_tugas": t.get("tipe_tugas", DEFAULT_TIPE_TUGAS),
        "role_label": cfg["label"],
        "jenis": t.get("jenis", ""),
        "tipe_petugas": t.get("tipe_petugas", ""),
        "petugas_nama": t.get("petugas_nama", ""),
        "asal": t.get("asal", ""), "tujuan": t.get("tujuan", ""),
        "kapal": t.get("kapal", ""), "voyage": t.get("voyage", ""),
        "instruksi": t.get("instruksi", ""),
        # config peran (buat render tab/instruksi/kamera)
        "tabs": t.get("tabs", cfg["tabs"]),
        "foto_title": t.get("foto_title", cfg["foto_title"]),
        "foto_instruksi": t.get("foto_instruksi", cfg["foto_instruksi"]),
        "allowed_checkpoint_types": t.get("allowed_checkpoint_types", cfg["checkpoint_types"]),
        "allowed_document_types": t.get("allowed_document_types", cfg["document_types"]),
        "needs_penerima": bool(t.get("needs_penerima")),
        "needs_info_kapal": bool(t.get("needs_info_kapal")),
        "units": t.get("units", []),            # snapshot aman: nopol/tipe/rangka aja
        "status": t.get("status", "belum_dibuka"),
        "photos": t.get("photos", []),          # cuma foto album yg dia upload
        "documents": t.get("documents", []),    # cuma dokumen yg dia upload
        "checkpoints": t.get("checkpoints", []),# cuma checkpoint leg ini
        "checklist": t.get("checklist", []),    # legacy (masih dipakai admin lama)
        "extra_inputs": t.get("extra_inputs", {}),
        "perusahaan": "PT Alyssa Auto Logistik",
        "disabled": bool(t.get("disabled")),
    }


class LegTaskBody(BaseModel):
    petugas_id: Optional[str] = None
    petugas_nama: str = ""
    petugas_hp: str = ""
    tipe_petugas: str = "Driver"
    tipe_tugas: Optional[str] = None   # driver_asal | driver_tujuan | driver_full | pelabuhan_asal | pelabuhan_tujuan | kapal
    jenis: str = "Self Drive"
    asal: str = ""
    tujuan: str = ""
    kapal: str = ""
    voyage: str = ""
    instruksi: str = ""
    checklist: Optional[List[str]] = None       # label list; kalau None → default per jenis
    units: Optional[List[Dict[str, Any]]] = None  # [{nopol, vehicle_type, no_rangka}]
    unit_ids: Optional[List[str]] = None


@api_router.post("/admin/trips/{trip_id}/legs/{leg_index}/task-link", dependencies=[Depends(require_admin_pin)])
async def create_leg_task_link(trip_id: str, leg_index: int, body: LegTaskBody):
    """Bikin link tugas unik buat 1 leg. Token acak aman, nggak nampilin ID internal."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    legs = trip.get("legs") or []
    if leg_index < 0 or leg_index >= len(legs):
        raise HTTPException(400, "Leg index tidak valid")
    # tentukan tipe_tugas (peran) — dari body, atau map dari jenis (backward-compat)
    tipe_tugas = body.tipe_tugas
    if not tipe_tugas:
        j = (body.jenis or "").lower()
        if "kapal" in j: tipe_tugas = "kapal"
        elif "pelabuhan" in j and "tujuan" in j: tipe_tugas = "pelabuhan_tujuan"
        elif "pelabuhan" in j: tipe_tugas = "pelabuhan_asal"
        elif "self drive tujuan" in j: tipe_tugas = "driver_tujuan"
        elif "self drive asal" in j: tipe_tugas = "driver_asal"
        elif "self drive" in j: tipe_tugas = "driver_full"
        else: tipe_tugas = DEFAULT_TIPE_TUGAS
    cfg = _role_cfg(tipe_tugas)
    labels = body.checklist if body.checklist is not None else DEFAULT_LEG_CHECKLISTS.get(body.jenis, cfg["foto_instruksi"])
    checklist = [{"key": str(uuid.uuid4())[:8], "label": lb, "done": False} for lb in labels]
    # units snapshot (aman) — dari body, atau fallback dari trip (single unit)
    units = body.units or [{
        "nopol": trip.get("nopol", ""), "vehicle_type": trip.get("tipe_kendaraan", ""),
        "no_rangka": trip.get("no_rangka", ""),
    }]
    token = _secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc).isoformat()
    route_leg_id = legs[leg_index].get("route_leg_id") or str(uuid.uuid4())
    doc = {
        "token": token, "trip_id": trip_id, "leg_index": leg_index, "route_leg_id": route_leg_id,
        "petugas_id": body.petugas_id, "petugas_nama": (body.petugas_nama or "").strip(),
        "petugas_hp": (body.petugas_hp or "").strip(), "tipe_petugas": body.tipe_petugas or cfg["petugas_tipe"],
        "tipe_tugas": tipe_tugas,
        "jenis": body.jenis, "asal": (body.asal or "").strip(), "tujuan": (body.tujuan or "").strip(),
        "kapal": (body.kapal or "").strip(), "voyage": (body.voyage or "").strip(),
        "instruksi": (body.instruksi or "").strip(), "checklist": checklist,
        "units": units, "unit_ids": body.unit_ids or [],
        # scope + config peran (di-enforce di endpoint publik)
        "album_key": cfg["album_key"], "album_stage": cfg["album_key"],
        "tabs": cfg["tabs"], "foto_title": cfg["foto_title"], "foto_instruksi": cfg["foto_instruksi"],
        "allowed_checkpoint_types": cfg["checkpoint_types"], "allowed_document_types": cfg["document_types"],
        "needs_penerima": bool(cfg.get("needs_penerima")), "needs_info_kapal": bool(cfg.get("needs_info_kapal")),
        "status": "belum_dibuka", "disabled": False, "photos": [], "documents": [], "checkpoints": [], "extra_inputs": {},
        "created_at": now, "opened_at": None, "completed_at": None,
    }
    await db.leg_tasks.insert_one(doc)
    # simpan token + petugas ref ke leg (backward-compatible, cuma nambah field)
    legs[leg_index]["route_leg_id"] = route_leg_id
    legs[leg_index]["task_token"] = token
    if body.petugas_id:
        legs[leg_index]["petugas_id"] = body.petugas_id
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"legs": legs, "updated_at": now}})
    return {"ok": True, "token": token, "task": _leg_task_admin_view(doc)}


@api_router.get("/admin/leg-tasks", dependencies=[Depends(require_admin_pin)])
async def list_leg_tasks(trip_id: str):
    """Daftar task per-trip buat kartu di admin."""
    items = []
    async for t in db.leg_tasks.find({"trip_id": trip_id}).sort("leg_index", 1):
        items.append(_leg_task_admin_view(t))
    return {"items": items}


@api_router.post("/admin/leg-tasks/{token}/disable", dependencies=[Depends(require_admin_pin)])
async def disable_leg_task(token: str):
    r = await db.leg_tasks.find_one({"token": token})
    if not r:
        raise HTTPException(404, "Task tidak ditemukan")
    await db.leg_tasks.update_one({"token": token}, {"$set": {"disabled": True, "status": "dinonaktifkan"}})
    return {"ok": True}


@api_router.post("/admin/leg-tasks/{token}/regen", dependencies=[Depends(require_admin_pin)])
async def regen_leg_task(token: str):
    """Buat ulang token (link lama mati, isi task dipertahankan)."""
    r = await db.leg_tasks.find_one({"token": token})
    if not r:
        raise HTTPException(404, "Task tidak ditemukan")
    new_token = _secrets.token_urlsafe(16)
    await db.leg_tasks.update_one({"token": token}, {"$set": {"token": new_token, "disabled": False, "status": "belum_dibuka", "opened_at": None}})
    # update token di leg
    trip = await db.trips.find_one({"trip_id": r.get("trip_id")})
    if trip:
        legs = trip.get("legs") or []
        idx = r.get("leg_index")
        if isinstance(idx, int) and 0 <= idx < len(legs) and legs[idx].get("task_token") == token:
            legs[idx]["task_token"] = new_token
            await db.trips.update_one({"trip_id": r.get("trip_id")}, {"$set": {"legs": legs}})
    return {"ok": True, "token": new_token}


@api_router.get("/admin/trips/{trip_id}/leg-checkpoints", dependencies=[Depends(require_admin_pin)])
async def list_leg_checkpoints(trip_id: str):
    """Checkpoint terstruktur per leg (hasil upload petugas via link tugas) buat
    Trip 360 admin: Trip → Route Leg → Petugas → Checkpoint → Foto (+ GPS)."""
    names = {}
    async for p in db.petugas_profiles.find({}, {"_id": 0, "petugas_id": 1, "nama": 1}):
        names[p.get("petugas_id")] = p.get("nama", "")
    items = []
    async for c in db.leg_checkpoints.find({"trip_id": trip_id}).sort("ts", 1):
        c.pop("_id", None)
        if not c.get("petugas_nama"):
            c["petugas_nama"] = names.get(c.get("petugas_id"), "")
        items.append(c)
    return {"items": items, "total": len(items)}


@api_router.post("/admin/trips/{trip_id}/next-leg", dependencies=[Depends(require_admin_pin)])
async def add_next_leg(trip_id: str):
    """Lanjutkan Tahap Berikutnya: bikin Route Leg baru (asal = tujuan leg terakhir),
    histori tahap sebelumnya TETAP tersimpan, nggak minta input kendaraan ulang
    (data unit ada di level trip/order)."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    legs = trip.get("legs") or []
    prev = legs[-1] if legs else {}
    new_leg = {
        "route_leg_id": "RL-" + uuid.uuid4().hex[:8].upper(),
        "tipe": "Self Drive", "asal": (prev.get("tujuan") or ""), "tujuan": "",
        "kapal": "", "eta": "", "status": "Menunggu", "catatan": "",
    }
    legs.append(new_leg)
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"legs": legs, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"ok": True, "legs": legs, "new_index": len(legs) - 1}


# ══════════════════════════════════════════════════════════════════════════
# KEPALA ROMBONGAN — Command Center (Fase 2)
# 1 assignment-level token per trip (STABIL sepanjang perjalanan). Route Leg
# boleh nambah/berubah, token TIDAK berubah. Profile kepala rombongan disiapkan
# "reward-ready" (driver_id ref master + email/bank) tapi Reward belum dibangun.
# Tidak menyentuh flow driver/task/checkpoint/foto/dokumen existing.
# ══════════════════════════════════════════════════════════════════════════
def _wib_now():
    return datetime.now(timezone.utc) + timedelta(hours=7)

class RombonganLinkBody(BaseModel):
    driver_id: Optional[str] = None
    nama: str = ""
    no_hp: str = ""
    email: str = ""
    bank: str = ""
    no_rekening: str = ""
    nama_rekening: str = ""
    jam_close: Optional[str] = None   # "HH:MM" WIB

@api_router.post("/admin/trips/{trip_id}/rombongan-link", dependencies=[Depends(require_admin_pin)])
async def create_rombongan_link(trip_id: str, body: RombonganLinkBody):
    """Buat / ambil link Kepala Rombongan (1 token per trip). Kalau sudah ada &
    aktif -> token DIPERTAHANKAN (cuma update profil), TIDAK regenerate."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    rb = trip.get("rombongan") or {}
    prev = rb.get("kepala") or {}
    token = rb.get("token") if (rb.get("active") and rb.get("token")) else _secrets.token_urlsafe(16)
    kepala = {
        "driver_id": body.driver_id or prev.get("driver_id"),
        "nama": (body.nama or prev.get("nama") or "").strip(),
        "no_hp": (body.no_hp or prev.get("no_hp") or "").strip(),
        "email": (body.email or prev.get("email") or "").strip(),
        "bank": (body.bank or prev.get("bank") or "").strip(),
        "no_rekening": (body.no_rekening or prev.get("no_rekening") or "").strip(),
        "nama_rekening": (body.nama_rekening or prev.get("nama_rekening") or "").strip(),
    }
    jam_close = (body.jam_close or rb.get("jam_close") or "20:00").strip()
    new_rb = {**rb, "token": token, "active": True, "kepala": kepala, "jam_close": jam_close,
              "created_at": rb.get("created_at") or datetime.utcnow().isoformat(),
              "updated_at": datetime.utcnow().isoformat()}
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"rombongan": new_rb}})
    return {"ok": True, "token": token, "rombongan": new_rb}

@api_router.post("/admin/trips/{trip_id}/rombongan/regen", dependencies=[Depends(require_admin_pin)])
async def regen_rombongan_link(trip_id: str):
    """Ganti Kepala Rombongan: token lama mati, token baru dibuat (profil tetap)."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    rb = trip.get("rombongan") or {}
    old = rb.get("token")
    disabled = rb.get("disabled_tokens") or []
    if old:
        disabled.append(old)
    rb["token"] = _secrets.token_urlsafe(16)
    rb["active"] = True
    rb["disabled_tokens"] = disabled
    rb["updated_at"] = datetime.utcnow().isoformat()
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"rombongan": rb}})
    return {"ok": True, "token": rb["token"]}

@api_router.post("/admin/trips/{trip_id}/rombongan/disable", dependencies=[Depends(require_admin_pin)])
async def disable_rombongan_link(trip_id: str):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    rb = trip.get("rombongan") or {}
    rb["active"] = False
    rb["updated_at"] = datetime.utcnow().isoformat()
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"rombongan": rb}})
    return {"ok": True}

@api_router.patch("/admin/trips/{trip_id}/rombongan/jam-close", dependencies=[Depends(require_admin_pin)])
async def set_rombongan_jam_close(trip_id: str, body: dict = Body(...)):
    jam = str(body.get("jam_close") or "20:00").strip()
    if not re.match(r"^\d{2}:\d{2}$", jam):
        raise HTTPException(400, "Format jam harus HH:MM")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    rb = trip.get("rombongan") or {}
    rb["jam_close"] = jam
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"rombongan": rb}})
    return {"ok": True, "jam_close": jam}

def _rombongan_units(trip: dict) -> list:
    """Daftar unit rombongan (finance-free). Ambil dari trip.units kalau ada,
    fallback ke unit tunggal. Lengkapi driver dari legs.drivers kalau kosong."""
    src = trip.get("units") or []
    if not src:
        src = [{"nopol": trip.get("nopol") or "", "vehicle_type": trip.get("vehicle_type") or trip.get("tipe_kendaraan") or "",
                "no_rangka": trip.get("no_rangka") or "", "driver": trip.get("nama_driver") or ""}]
    out = []
    for u in src:
        out.append({
            "nopol": u.get("nopol") or "", "vehicle_type": u.get("vehicle_type") or u.get("tipe_model") or "",
            "no_rangka": u.get("no_rangka") or "", "driver": u.get("driver") or u.get("nama_driver") or "",
            "status": u.get("status") or "",
        })
    return out

@api_router.get("/public/rombongan/{token}")
async def public_rombongan(token: str):
    """Command Center Kepala Rombongan — scope 1 assignment. Semua unit/leg/
    checkpoint/foto/dokumen, TANPA data finansial (reuse view publik yang memang
    sudah finance-free). Token stabil: leg baru otomatis muncul di sini."""
    trip = await db.trips.find_one({"rombongan.token": token})
    if not trip:
        raise HTTPException(404, "Link Kepala Rombongan tidak ditemukan")
    rb = trip.get("rombongan") or {}
    if not rb.get("active"):
        raise HTTPException(410, "Link Kepala Rombongan sudah dinonaktifkan")
    tid = trip.get("trip_id")
    view = _trip_public_view(trip)
    await _merge_task_media(tid, view)
    await _merge_task_checkpoints(tid, view)
    now = _wib_now()
    tgl = now.strftime("%Y-%m-%d")
    reports = await db.rombongan_reports.find({"trip_id": tid, "tanggal": tgl}, {"_id": 0}).to_list(1000)
    kepala = rb.get("kepala") or {}
    return {
        "ok": True, "trip_id": tid,
        "perusahaan": "PT Alyssa Auto Logistik",
        "kepala": {"nama": kepala.get("nama", ""), "no_hp": kepala.get("no_hp", "")},  # NO finance
        "jam_close": rb.get("jam_close", "20:00"),
        "rute": view.get("route") or f'{trip.get("asal_kota","")} → {trip.get("tujuan_kota","")}'.strip(" →"),
        "legs": view.get("legs", []),
        "units": _rombongan_units(trip),
        "album": view.get("album", {}),
        "handover": view.get("handover", {}),
        "daily_checkpoints": view.get("daily_checkpoints", []),
        "reports_today": reports,
        "server_wib": now.isoformat(),
        "today": tgl,
    }

class RombonganReportBody(BaseModel):
    unit_nopol: str = ""
    driver: str = ""
    status: str = ""
    lokasi: str = ""
    catatan: str = ""
    kendala: str = ""

@api_router.post("/public/rombongan/{token}/report")
async def submit_rombongan_report(token: str, body: RombonganReportBody):
    """Daily report Kepala Rombongan per unit. Append-only (history utuh, jadi
    sumber validasi Point nanti). Tandai `late` kalau lewat jam close WIB."""
    trip = await db.trips.find_one({"rombongan.token": token})
    if not trip:
        raise HTTPException(404, "Link tidak ditemukan")
    rb = trip.get("rombongan") or {}
    if not rb.get("active"):
        raise HTTPException(410, "Link sudah dinonaktifkan")
    now = _wib_now()
    tgl = now.strftime("%Y-%m-%d")
    jam_close = rb.get("jam_close", "20:00")
    late = now.strftime("%H:%M") > jam_close
    rec = {
        "id": str(uuid.uuid4()), "trip_id": trip.get("trip_id"), "token": token,
        "tanggal": tgl, "unit_nopol": (body.unit_nopol or "").strip(),
        "driver": (body.driver or "").strip(), "status": (body.status or "").strip(),
        "lokasi": (body.lokasi or "").strip(), "catatan": (body.catatan or "").strip()[:500],
        "kendala": (body.kendala or "").strip()[:500],
        "submitted_at": now.isoformat(), "submitted_hhmm": now.strftime("%H:%M"),
        "late": late, "by": "kepala_rombongan",
    }
    await db.rombongan_reports.insert_one(rec)
    rec.pop("_id", None)
    return {"ok": True, "late": late, "tanggal": tgl, "report": rec}

@api_router.get("/public/rombongan/{token}/reports")
async def list_rombongan_reports(token: str, tanggal: Optional[str] = None):
    trip = await db.trips.find_one({"rombongan.token": token})
    if not trip:
        raise HTTPException(404, "Link tidak ditemukan")
    q = {"trip_id": trip.get("trip_id")}
    if tanggal:
        q["tanggal"] = tanggal
    items = await db.rombongan_reports.find(q, {"_id": 0}).sort("submitted_at", -1).to_list(2000)
    return {"ok": True, "items": items}


@api_router.get("/public/task/{token}")
async def public_get_task(token: str):
    """Halaman petugas — akses ter-scope, cuma data leg dia."""
    t = await db.leg_tasks.find_one({"token": token})
    if not t:
        raise HTTPException(404, "Link tugas tidak ditemukan")
    if t.get("disabled"):
        raise HTTPException(410, "Link tugas sudah dinonaktifkan")
    # tandai sudah dibuka (sekali)
    if t.get("status") == "belum_dibuka":
        now = datetime.now(timezone.utc).isoformat()
        await db.leg_tasks.update_one({"token": token}, {"$set": {"status": "sudah_dibuka", "opened_at": now}})
        t["status"] = "sudah_dibuka"
    return _leg_task_public_view(t)


@api_router.post("/public/task/{token}/upload")
async def public_task_upload(
    token: str,
    foto: UploadFile = File(...),
    catatan: str = Form(""),
):
    """ALBUM: petugas upload foto dokumentasi → task.photos + album leg (album_key
    token). TERPISAH dari checkpoint (album = dokumentasi, checkpoint = histori GPS)."""
    t = await db.leg_tasks.find_one({"token": token})
    if not t:
        raise HTTPException(404, "Link tugas tidak ditemukan")
    if t.get("disabled"):
        raise HTTPException(410, "Link tugas sudah dinonaktifkan")
    trip_id = t.get("trip_id")
    url = _save_upload(trip_id, f"leg/{t.get('leg_index')}/{token[:8]}", foto, ALLOWED_IMG | ALLOWED_DOC)
    now = datetime.now(timezone.utc).isoformat()
    photo = {"id": str(uuid.uuid4()), "url": url, "catatan": (catatan or "").strip()[:300], "ts": now, "source": "petugas"}
    stage = t.get("album_key") or t.get("album_stage") or "asal"   # scope: server yg nentuin, petugas nggak bisa milih
    await db.leg_tasks.update_one({"token": token}, {
        "$push": {"photos": photo},
        "$set": {"status": "dikerjakan", "updated_at": now},
    })
    await db.trips.update_one({"trip_id": trip_id}, {
        "$push": {f"album.{stage}": {"id": photo["id"], "url": url, "catatan": photo["catatan"], "uploaded_by": f"petugas:{t.get('petugas_nama','')}", "ts": now}},
        "$set": {"updated_at": now},
    })
    t = await db.leg_tasks.find_one({"token": token})
    return _leg_task_public_view(t)


@api_router.post("/public/task/{token}/checkpoint")
async def public_task_checkpoint(
    token: str,
    jenis: str = Form(...),
    catatan: str = Form(""),
    lat: Optional[float] = Form(None),
    lng: Optional[float] = Form(None),
    acc: Optional[float] = Form(None),
    alamat: str = Form(""),
    foto: Optional[UploadFile] = File(None),
):
    """CHECKPOINT: histori perjalanan ber-GPS (terpisah dari album). Jenis divalidasi
    ∈ allowed_checkpoint_types token → di luar itu 403. Foto opsional."""
    t = await db.leg_tasks.find_one({"token": token})
    if not t:
        raise HTTPException(404, "Link tugas tidak ditemukan")
    if t.get("disabled"):
        raise HTTPException(410, "Link tugas sudah dinonaktifkan")
    allowed = t.get("allowed_checkpoint_types") or _role_cfg(t.get("tipe_tugas"))["checkpoint_types"]
    if jenis not in allowed:
        raise HTTPException(403, "Jenis checkpoint di luar tugas Anda")
    trip_id = t.get("trip_id")
    now = datetime.now(timezone.utc).isoformat()
    url = None
    if foto is not None:
        url = _save_upload(trip_id, f"cp/{t.get('leg_index')}/{token[:8]}", foto, ALLOWED_IMG)
    cp = {
        "checkpoint_id": str(uuid.uuid4()), "trip_id": trip_id, "route_leg_id": t.get("route_leg_id"),
        "leg_index": t.get("leg_index"), "petugas_id": t.get("petugas_id"), "petugas_nama": t.get("petugas_nama", ""),
        "tipe_tugas": t.get("tipe_tugas"), "jenis": jenis, "status": "checkpoint", "ts": now,
        "catatan": (catatan or "").strip()[:300], "alamat": (alamat or "").strip()[:200],
        "url": url, "source": "petugas_link",
    }
    if lat is not None and lng is not None:
        cp["lat"] = float(lat); cp["lng"] = float(lng)
        if acc is not None: cp["acc"] = float(acc)
    await db.leg_checkpoints.insert_one(dict(cp))
    cp.pop("_id", None)
    await db.leg_tasks.update_one({"token": token}, {
        "$push": {"checkpoints": cp}, "$set": {"status": "dikerjakan", "updated_at": now},
    })
    t = await db.leg_tasks.find_one({"token": token})
    return _leg_task_public_view(t)


@api_router.post("/public/task/{token}/document")
async def public_task_document(
    token: str,
    doc_type: str = Form(...),
    berkas: UploadFile = File(...),
):
    """DOKUMEN: scan/foto berkas (BASTK/PoD/Surat Jalan). doc_type divalidasi ∈
    allowed_document_types token → di luar itu 403."""
    t = await db.leg_tasks.find_one({"token": token})
    if not t:
        raise HTTPException(404, "Link tugas tidak ditemukan")
    if t.get("disabled"):
        raise HTTPException(410, "Link tugas sudah dinonaktifkan")
    allowed = t.get("allowed_document_types") or _role_cfg(t.get("tipe_tugas"))["document_types"]
    if doc_type not in allowed:
        raise HTTPException(403, "Jenis dokumen di luar tugas Anda")
    trip_id = t.get("trip_id")
    url = _save_upload(trip_id, f"doc/{t.get('leg_index')}/{token[:8]}", berkas, ALLOWED_IMG | ALLOWED_DOC)
    now = datetime.now(timezone.utc).isoformat()
    doc = {"id": str(uuid.uuid4()), "doc_type": doc_type, "url": url, "ts": now, "source": "petugas"}
    await db.leg_tasks.update_one({"token": token}, {
        "$push": {"documents": doc}, "$set": {"status": "dikerjakan", "updated_at": now},
    })
    await db.trips.update_one({"trip_id": trip_id}, {
        "$push": {"album.dokumen": {"id": doc["id"], "url": url, "catatan": doc_type, "uploaded_by": f"petugas:{t.get('petugas_nama','')}", "ts": now}},
        "$set": {"updated_at": now},
    })
    t = await db.leg_tasks.find_one({"token": token})
    return _leg_task_public_view(t)


class TaskSubmitBody(BaseModel):
    extra_inputs: Optional[Dict[str, Any]] = None
    selesai: bool = False


@api_router.post("/public/task/{token}/submit")
async def public_task_submit(token: str, body: TaskSubmitBody):
    """Petugas simpan input tambahan (nama kapal/voyage/penerima/ttd) & tandai selesai."""
    t = await db.leg_tasks.find_one({"token": token})
    if not t:
        raise HTTPException(404, "Link tugas tidak ditemukan")
    if t.get("disabled"):
        raise HTTPException(410, "Link tugas sudah dinonaktifkan")
    now = datetime.now(timezone.utc).isoformat()
    upd = {"updated_at": now}
    if body.extra_inputs:
        merged = {**(t.get("extra_inputs") or {}), **body.extra_inputs}
        upd["extra_inputs"] = merged
    if body.selesai:
        upd["status"] = "selesai"; upd["completed_at"] = now
    else:
        if t.get("status") in ("belum_dibuka", "sudah_dibuka"):
            upd["status"] = "dikerjakan"
    await db.leg_tasks.update_one({"token": token}, {"$set": upd})
    t = await db.leg_tasks.find_one({"token": token})
    return _leg_task_public_view(t)


class KoordinatorBody(BaseModel):
    koordinator_id: Optional[str] = None
    koordinator_nama: Optional[str] = None
    koordinator_hp: Optional[str] = ""
    # Legacy fields kept for backward compat
    koordinator: Optional[str] = None

@api_router.patch("/admin/trips/{trip_id}/koordinator", dependencies=[Depends(require_admin_pin)])
async def admin_patch_trip_koordinator(trip_id: str, body: KoordinatorBody):
    """Set koordinator_id, koordinator_nama, koordinator_hp on a trip document."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    now = datetime.utcnow().isoformat()
    upd: dict = {"updated_at": now}
    # New-style fields
    if body.koordinator_id is not None:
        upd["koordinator_id"] = body.koordinator_id.strip()
    if body.koordinator_nama is not None:
        upd["koordinator_nama"] = body.koordinator_nama.strip()
        upd["koordinator"] = body.koordinator_nama.strip()  # keep legacy field in sync
    if body.koordinator_hp is not None:
        upd["koordinator_hp"] = (body.koordinator_hp or "").strip()
    # Legacy-only path (old frontend calling with just koordinator)
    if body.koordinator is not None and body.koordinator_nama is None:
        upd["koordinator"] = body.koordinator.strip()
        upd["koordinator_nama"] = body.koordinator.strip()
    await db.trips.update_one({"trip_id": trip_id}, {"$set": upd})
    return {"ok": True, "trip_id": trip_id}


class BonusBody(BaseModel):
    bonus_daily: Optional[int] = None
    bonus_kerajinan: Optional[int] = None

@api_router.patch("/admin/trips/{trip_id}/bonus", dependencies=[Depends(require_admin_pin)])
async def admin_patch_trip_bonus(trip_id: str, body: BonusBody):
    """Update bonus_daily / bonus_kerajinan pada trip yang SUDAH jalan.
    Sebelumnya nilai ini cuma bisa diisi sekali waktu convert order -> trip
    (form Convert cuma tampil selagi order.status == NEW) — jadi kalau mau
    di-nol-in / diubah setelah trip aktif, nggak ada endpoint yang nyimpen
    perubahannya. Endpoint ini nutup celah itu."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    upd: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.bonus_daily is not None:
        if body.bonus_daily < 0:
            raise HTTPException(400, "bonus_daily tidak boleh negatif")
        upd["bonus_daily"] = body.bonus_daily
    if body.bonus_kerajinan is not None:
        if body.bonus_kerajinan < 0:
            raise HTTPException(400, "bonus_kerajinan tidak boleh negatif")
        upd["bonus_kerajinan"] = body.bonus_kerajinan
    if len(upd) == 1:
        raise HTTPException(400, "No fields to update")
    await db.trips.update_one({"trip_id": trip_id}, {"$set": upd})
    doc = await db.trips.find_one({"trip_id": trip_id})
    return trip_doc_to_public(doc)


# ══════════════════════════════════════════════════════
# FINANCIAL COMMAND CENTER — Trip = single source of truth
# D1: Supplier (supplier_profiles.jobs[]) = SATU-SATUNYA sumber biaya vendor.
#     Trip 360 hanya MENULIS job ke supplier (di-tag trip_id) & MEMBACA balik
#     by trip_id — tidak ada biaya vendor tersimpan di dua tempat.
# D3: tiap komponen biaya/pendapatan punya `klasifikasi` supaya profit dihitung
#     tanpa double counting (Vendor Cost, Driver Cost, ... Pendapatan).
# Alur: Trip -> Supplier Job -> HPP Trip -> Profit -> Dashboard.
# ══════════════════════════════════════════════════════

VENDOR_KATEGORI = [
    "Kapal / RoRo", "Towing / Trucking", "Ekspedisi", "Bongkar / Muat",
    "Karoseri", "BBM / Tol", "Lainnya",
]


class TripInvoiceBody(BaseModel):
    invoice_total: int = 0


class TripVendorCostBody(BaseModel):
    vendor_name: Optional[str] = None      # nama supplier; dibuat kalau belum ada
    supplier_id: Optional[str] = None      # kalau sudah tahu supplier-nya
    kategori: Optional[str] = "Lainnya"
    jumlah: int = 0
    tanggal: Optional[str] = None
    jatuh_tempo: Optional[str] = None
    no_invoice_vendor: Optional[str] = None
    catatan: Optional[str] = ""


def _route_split(trip: dict):
    parts = [p.strip() for p in (trip.get("route") or "").split("-")]
    asal = parts[0] if len(parts) >= 1 else ""
    tujuan = parts[-1] if len(parts) >= 2 else ""
    return asal, tujuan


async def _find_or_create_supplier(nama: str) -> dict:
    """Cari supplier by nama (case-insensitive), atau bikin baru. Dipakai saat
    Trip 360 menambah biaya vendor tanpa harus buka halaman Supplier dulu."""
    import re as _re
    nama = (nama or "").strip()
    if not nama:
        raise HTTPException(400, "Nama supplier/vendor wajib diisi")
    existing = await db.supplier_profiles.find_one(
        {"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)}, {"_id": 0}
    )
    if existing:
        return existing
    doc = {
        "id": _gen_supplier_id(), "nama": nama, "jenis": "", "no_hp": "",
        "catatan": "", "created_at": datetime.utcnow().isoformat(), "jobs": [],
    }
    await db.supplier_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def _trip_auto_context(trip: dict) -> dict:
    """Data yang diisi OTOMATIS ke job supplier dari Trip/Order — tidak diketik
    ulang admin. Order (kalau ada) lebih lengkap soal kota & customer."""
    order = await db.orders.find_one({"trip_id": trip.get("trip_id")}, {"_id": 0})
    asal, tujuan = _route_split(trip)
    return {
        "trip_id": trip.get("trip_id"),
        "order_id": (order or {}).get("order_id") or trip.get("order_id"),
        "vehicle_type": (order or {}).get("vehicle_type") or trip.get("tipe_kendaraan") or trip.get("vehicle_type") or "",
        "nopol": ((order or {}).get("nopol") or trip.get("nopol") or "").upper(),
        "no_rangka": ((order or {}).get("no_rangka") or trip.get("no_rangka") or "").upper(),
        "asal_kota": (order or {}).get("asal_kota") or asal,
        "tujuan_kota": (order or {}).get("tujuan_kota") or tujuan,
        "customer_id": (order or {}).get("customer_id"),
        "customer_nama": (order or {}).get("customer_nama") or (trip.get("customer_data") or {}).get("nama") or "",
    }


async def _add_trip_supplier_job(trip: dict, *, vendor_name=None, supplier_id=None,
                                 kategori="Lainnya", jumlah=0, tanggal=None,
                                 jatuh_tempo=None, no_invoice_vendor=None, catatan="",
                                 route_leg_id=None) -> dict:
    """Tulis 1 biaya vendor sebagai supplier job, di-tag ke trip. Kendaraan/
    rute/customer diisi otomatis dari trip — bukan input ulang."""
    if supplier_id:
        sup = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
        if not sup:
            raise HTTPException(404, "Supplier tidak ditemukan")
    else:
        sup = await _find_or_create_supplier(vendor_name or "")
    sup = await _ensure_supplier_projects(sup)
    project_id, projects = _get_or_create_active_project(sup)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()
    jt = (jatuh_tempo or "").strip()
    if jt and not re.match(r"^\d{4}-\d{2}-\d{2}$", jt):
        jt = ""

    ctx = await _trip_auto_context(trip)
    job = {
        "id": _gen_supplier_id(),
        "project_id": project_id,
        # auto dari trip/order (D-prinsip: jangan ketik ulang)
        "vehicle_type": ctx["vehicle_type"],
        "nopol": ctx["nopol"],
        "no_rangka": ctx["no_rangka"],
        "asal_kota": ctx["asal_kota"],
        "tujuan_kota": ctx["tujuan_kota"],
        "total_harga": int(jumlah),
        "catatan": (catatan or "").strip(),
        "tanggal": tgl,
        "payments": [],
        # relasi Trip (D1) + klasifikasi (D3)
        "trip_id": ctx["trip_id"],
        "order_id": ctx["order_id"],
        "customer_id": ctx["customer_id"],
        "customer_nama": ctx["customer_nama"],
        "route_leg_id": route_leg_id,
        "kategori": (kategori or "Lainnya").strip()[:40] or "Lainnya",
        "jatuh_tempo": jt or None,
        "no_invoice_vendor": (no_invoice_vendor or "").strip()[:60] or None,
        "klasifikasi": "Vendor Cost",
        "source": "trip360",
    }
    upd = {"jobs": (sup.get("jobs") or []) + [job]}
    if projects != (sup.get("projects") or []):
        upd["projects"] = projects
    await db.supplier_profiles.update_one({"id": sup["id"]}, {"$set": upd})
    return {"supplier_id": sup["id"], "supplier_nama": sup["nama"], "job": job}


async def _migrate_trip_vendor_costs(trip: dict):
    """Data Sprint 1 lama (trip.finance.vendor_costs) dipindah jadi supplier job
    (D1) sekali jalan, lalu field-nya dihapus supaya tidak jadi sumber kedua."""
    fin = trip.get("finance") or {}
    old = fin.get("vendor_costs") or []
    if not old:
        return
    for c in old:
        try:
            await _add_trip_supplier_job(
                trip, vendor_name=c.get("vendor_name") or "Vendor",
                kategori=c.get("kategori") or "Lainnya", jumlah=int(c.get("jumlah") or 0),
                tanggal=c.get("tanggal"), jatuh_tempo=c.get("jatuh_tempo"),
                catatan=c.get("catatan") or "",
            )
        except Exception as e:
            logger.warning(f"[finance:migrate] gagal migrasi biaya trip {trip.get('trip_id')}: {e}")
    await db.trips.update_one({"trip_id": trip.get("trip_id")}, {"$unset": {"finance.vendor_costs": ""}})
    if isinstance(trip.get("finance"), dict):
        trip["finance"].pop("vendor_costs", None)


async def _trip_vendor_costs(trip_id: str) -> list:
    """Semua biaya vendor 1 trip = supplier job yang di-tag trip_id (D1)."""
    out = []
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        for j in (s.get("jobs") or []):
            if j.get("trip_id") != trip_id:
                continue
            terbayar = sum(int(p.get("amount") or 0) for p in (j.get("payments") or []))
            total = int(j.get("total_harga") or 0)
            out.append({
                "id": j.get("id"),
                "supplier_id": s.get("id"),
                "supplier_nama": s.get("nama"),
                "vendor_name": s.get("nama"),
                "kategori": j.get("kategori") or "Lainnya",
                "klasifikasi": j.get("klasifikasi") or "Vendor Cost",
                "jumlah": total,
                "terbayar": terbayar,
                "sisa": total - terbayar,
                "tanggal": j.get("tanggal"),
                "jatuh_tempo": j.get("jatuh_tempo"),
                "no_invoice_vendor": j.get("no_invoice_vendor"),
                "catatan": j.get("catatan") or "",
                "source": j.get("source") or "supplier",
            })
    return out


async def _trip_finance_summary(trip: dict) -> dict:
    """Ringkasan keuangan 1 trip — dihitung ulang tiap baca, dari data canonical
    (invoice di trip, biaya vendor di Supplier by trip_id, biaya driver di trip)."""
    await _migrate_trip_vendor_costs(trip)
    trip_id = trip.get("trip_id")
    fin = trip.get("finance") or {}
    invoice_total = int(fin.get("invoice_total") or 0)

    uj = int(trip.get("uj") or 0); t1 = int(trip.get("t1") or 0)
    t2 = int(trip.get("t2") or 0); t3 = int(trip.get("t3") or 0)
    driver_total = uj + t1 + t2 + t3

    vendor_costs = await _trip_vendor_costs(trip_id)
    vendor_total = sum(c["jumlah"] for c in vendor_costs)
    vendor_terbayar = sum(c["terbayar"] for c in vendor_costs)
    hpp_total = driver_total + vendor_total  # klasifikasi cost: Vendor Cost + Driver Cost

    has_invoice = invoice_total > 0
    profit = (invoice_total - hpp_total) if has_invoice else None
    margin_pct = round(profit / invoice_total * 100, 1) if (has_invoice and invoice_total > 0) else None

    legs = trip.get("legs") or []
    expected_vendor = sum(1 for l in legs if (l.get("kapal") or "").strip())
    entered_vendor = len(vendor_costs)
    hpp_complete = entered_vendor >= expected_vendor

    # ── Pembayaran customer (Sprint Finance 2) — piutang & status invoice ──
    customer_payments = fin.get("customer_payments") or []
    customer_payments = sorted(customer_payments, key=lambda p: (p.get("tanggal") or "", p.get("created_at") or ""))
    total_diterima = sum(int(p.get("amount") or 0) for p in customer_payments)
    sisa_piutang = (invoice_total - total_diterima) if has_invoice else 0
    pay_pct = round(min(total_diterima / invoice_total, 1) * 100, 1) if (has_invoice and invoice_total > 0) else 0
    if not has_invoice:
        invoice_status = "Belum Ada Invoice"
    elif total_diterima <= 0:
        invoice_status = "Belum Bayar"
    elif total_diterima < invoice_total:
        invoice_status = "Sebagian"
    else:
        invoice_status = "Lunas"

    return {
        "trip_id": trip_id,
        "invoice_total": invoice_total,
        "has_invoice": has_invoice,
        "driver_cost": {
            "uj": uj, "t1": t1, "t2": t2, "t3": t3, "total": driver_total,
            "klasifikasi": "Driver Cost",
            "bonus_daily": int(trip.get("bonus_daily") or 0),
            "bonus_kerajinan": int(trip.get("bonus_kerajinan") or 0),
        },
        "vendor_costs": vendor_costs,
        "vendor_total": vendor_total,
        "vendor_terbayar": vendor_terbayar,
        "vendor_sisa": vendor_total - vendor_terbayar,
        "hpp_total": hpp_total,
        "profit": profit,
        "margin_pct": margin_pct,
        "hpp_complete": hpp_complete,
        "expected_vendor": expected_vendor,
        "entered_vendor": entered_vendor,
        # ── customer money flow ──
        "customer_payments": customer_payments,
        "total_diterima": total_diterima,      # klasifikasi: Pendapatan (uang masuk)
        "sisa_piutang": sisa_piutang,
        "pay_pct": pay_pct,
        "invoice_status": invoice_status,
        # cash flow per-trip (uang masuk − uang keluar ke vendor)
        "cash_in": total_diterima,
        "cash_out": vendor_terbayar,
        "cash_net": total_diterima - vendor_terbayar,
    }


@api_router.get("/admin/trips/{trip_id}/finance", dependencies=[Depends(require_admin_pin)])
async def get_trip_finance(trip_id: str):
    trip = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(404, "Trip not found")
    return await _trip_finance_summary(trip)


@api_router.patch("/admin/trips/{trip_id}/finance/invoice", dependencies=[Depends(require_admin_pin)])
async def set_trip_invoice(trip_id: str, body: TripInvoiceBody):
    """Simpan nilai invoice (jasa) trip -> begitu ada, profit otomatis muncul.
    Nilai ini dibaca live oleh Selisih Harga (D4), tidak pernah dicopy."""
    if body.invoice_total < 0:
        raise HTTPException(400, "invoice_total tidak boleh negatif")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {"finance.invoice_total": int(body.invoice_total),
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    doc = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    return await _trip_finance_summary(doc)


@api_router.post("/admin/trips/{trip_id}/finance/costs", dependencies=[Depends(require_admin_pin)])
async def add_trip_vendor_cost(trip_id: str, body: TripVendorCostBody):
    """Tambah biaya vendor dari Trip 360 -> ditulis sebagai Supplier job (D1),
    di-tag trip_id, kendaraan/rute/customer auto dari trip. HPP & hutang vendor
    otomatis terbentuk; datanya langsung muncul di halaman Supplier."""
    if not (body.vendor_name or body.supplier_id):
        raise HTTPException(400, "Pilih supplier atau isi nama vendor")
    if body.jumlah <= 0:
        raise HTTPException(400, "Jumlah biaya harus lebih dari 0")
    trip = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    if not trip:
        raise HTTPException(404, "Trip not found")
    await _add_trip_supplier_job(
        trip, vendor_name=body.vendor_name, supplier_id=body.supplier_id,
        kategori=body.kategori or "Lainnya", jumlah=int(body.jumlah),
        tanggal=body.tanggal, jatuh_tempo=body.jatuh_tempo,
        no_invoice_vendor=body.no_invoice_vendor, catatan=body.catatan or "",
    )
    doc = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    return await _trip_finance_summary(doc)


@api_router.delete("/admin/trips/{trip_id}/finance/costs/{job_id}", dependencies=[Depends(require_admin_pin)])
async def delete_trip_vendor_cost(trip_id: str, job_id: str):
    """Hapus biaya vendor = hapus supplier job-nya (yang di-tag trip ini)."""
    target = None
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        for j in (s.get("jobs") or []):
            if j.get("id") == job_id and j.get("trip_id") == trip_id:
                target = s
                break
        if target:
            break
    if not target:
        raise HTTPException(404, "Biaya vendor tidak ditemukan untuk trip ini")
    new_jobs = [j for j in (target.get("jobs") or []) if j.get("id") != job_id]
    await db.supplier_profiles.update_one({"id": target["id"]}, {"$set": {"jobs": new_jobs}})
    doc = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    return await _trip_finance_summary(doc)


@api_router.get("/admin/finance/vendor-kategori", dependencies=[Depends(require_admin_pin)])
async def list_vendor_kategori():
    return {"items": VENDOR_KATEGORI}


# ── Sprint Finance 2: Pembayaran Customer (piutang, status invoice, cash-in) ──
PAYMENT_METODE = ["Transfer BCA", "Transfer Bank Lain", "Tunai", "Giro / Cek", "QRIS", "Lainnya"]


@api_router.get("/admin/finance/metode-pembayaran", dependencies=[Depends(require_admin_pin)])
async def list_metode_pembayaran():
    return {"items": PAYMENT_METODE}


# ══════════════════════════════════════════════════════
# MOBILE "CATAT BAYAR VENDOR" — role terbatas (VENDOR_PIN)
# Semua endpoint di grup ini hanya buat input/lihat pembayaran vendor.
# ══════════════════════════════════════════════════════
MOBILE_VENDOR_KATEGORI = ["Driver", "Kapal / Pelayaran", "Tol", "BBM", "Vendor", "Lainnya"]
MOBILE_VENDOR_METODE = ["Transfer", "Tunai", "Lainnya"]


def _rute_str(a: str, b: str) -> str:
    a = (a or "").strip(); b = (b or "").strip()
    if a and b: return f"{a} → {b}"
    return a or b or "-"


@api_router.get("/vendor-mobile/bootstrap", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_bootstrap():
    """Data awal buat form: kategori biaya, metode bayar, & daftar vendor."""
    vendors = []
    async for s in db.supplier_profiles.find({}, {"_id": 0, "id": 1, "nama": 1}).sort("nama", 1):
        if s.get("id"):
            vendors.append({"id": s["id"], "nama": s.get("nama") or "-"})
    return {"kategori": MOBILE_VENDOR_KATEGORI, "metode": MOBILE_VENDOR_METODE, "vendors": vendors}


@api_router.get("/vendor-mobile/trips", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_trips(q: Optional[str] = None, limit: int = 25):
    """Cari trip by nopol / trip_id / customer / kota. Ringkas buat picker."""
    ql = (q or "").strip().lower()
    out = []
    async for t in db.trips.find({}, {"_id": 0}).sort("created_at", -1):
        try:
            ctx = await _trip_auto_context(t)
        except Exception:
            ctx = {}
        nopol = ctx.get("nopol") or ""
        cust = ctx.get("customer_nama") or ""
        asal = ctx.get("asal_kota") or ""; tuj = ctx.get("tujuan_kota") or ""
        hay = f"{t.get('trip_id','')} {nopol} {cust} {asal} {tuj}".lower()
        if ql and ql not in hay:
            continue
        out.append({
            "trip_id": t.get("trip_id"), "nopol": nopol,
            "vehicle": ctx.get("vehicle_type") or "", "customer": cust,
            "rute": _rute_str(asal, tuj),
        })
        if len(out) >= limit:
            break
    return {"items": out}


@api_router.get("/vendor-mobile/unpaid", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_unpaid(limit: int = 200):
    """Semua tagihan vendor yang masih ada sisa (belum lunas), lintas vendor."""
    out = []
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        for j in (s.get("jobs") or []):
            jt = _supplier_job_totals(j)
            if (jt.get("sisa") or 0) > 0:
                out.append({
                    "supplier_id": s.get("id"), "supplier_nama": s.get("nama") or "-",
                    "job_id": j.get("id"), "trip_id": j.get("trip_id"),
                    "nopol": j.get("nopol") or "", "rute": _rute_str(j.get("asal_kota"), j.get("tujuan_kota")),
                    "kategori": j.get("kategori") or "Lainnya",
                    "total_harga": jt.get("total_harga") or 0,
                    "terbayar": jt.get("total_terbayar") or 0, "sisa": jt.get("sisa") or 0,
                    "tanggal": j.get("tanggal") or "",
                })
    out.sort(key=lambda x: x.get("tanggal") or "", reverse=True)
    return {"items": out[:limit]}


@api_router.get("/vendor-mobile/history", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_history(q: Optional[str] = None, limit: int = 200):
    """Riwayat pembayaran vendor terbaru (semua vendor)."""
    ql = (q or "").strip().lower()
    out = []
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        for j in (s.get("jobs") or []):
            for p in (j.get("payments") or []):
                row = {
                    "supplier_id": s.get("id"), "supplier_nama": s.get("nama") or "-",
                    "job_id": j.get("id"), "payment_id": p.get("id"),
                    "trip_id": j.get("trip_id"), "nopol": j.get("nopol") or "",
                    "rute": _rute_str(j.get("asal_kota"), j.get("tujuan_kota")),
                    "kategori": j.get("kategori") or "Lainnya",
                    "amount": p.get("amount") or 0, "tanggal": p.get("tanggal") or "",
                    "metode": p.get("metode") or (p.get("tipe") or "").title() or "-",
                    "bukti_url": p.get("bukti_url"), "catatan": p.get("catatan") or "",
                }
                if ql:
                    hay = f"{row['supplier_nama']} {row['nopol']} {row['trip_id'] or ''} {row['kategori']}".lower()
                    if ql not in hay:
                        continue
                out.append(row)
    out.sort(key=lambda x: (x.get("tanggal") or "", x.get("payment_id") or ""), reverse=True)
    return {"items": out[:limit]}


@api_router.post("/vendor-mobile/pay", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_pay(
    amount: int = Form(...),
    tanggal: Optional[str] = Form(None),
    metode: str = Form("Transfer"),
    catatan: str = Form(""),
    supplier_id: Optional[str] = Form(None),
    vendor_name: Optional[str] = Form(None),
    job_id: Optional[str] = Form(None),
    trip_id: Optional[str] = Form(None),
    kategori: str = Form("Lainnya"),
    bukti: Optional[UploadFile] = File(None),
):
    """Catat 1 pembayaran vendor. Dua mode:
    - Bayar tagihan yang sudah ada  -> kirim supplier_id + job_id.
    - Catat pembayaran baru          -> kirim trip_id + (supplier_id | vendor_name)
      + kategori; sistem bikin biaya vendor (supplier job) di trip itu lalu
      langsung dibayar sejumlah `amount`."""
    if amount <= 0:
        raise HTTPException(400, "Nominal harus lebih dari 0")

    if job_id and supplier_id:
        target_sid, target_jid = supplier_id, job_id
    else:
        if not trip_id:
            raise HTTPException(400, "Pilih trip / nomor polisi dulu")
        if not (supplier_id or (vendor_name or "").strip()):
            raise HTTPException(400, "Pilih vendor dulu")
        trip = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
        if not trip:
            raise HTTPException(404, "Trip tidak ditemukan")
        res = await _add_trip_supplier_job(
            trip, vendor_name=vendor_name, supplier_id=supplier_id,
            kategori=kategori, jumlah=int(amount), tanggal=tanggal, catatan=catatan,
        )
        target_sid, target_jid = res["supplier_id"], res["job"]["id"]

    sup = await db.supplier_profiles.find_one({"id": target_sid}, {"_id": 0})
    if not sup:
        raise HTTPException(404, "Vendor tidak ditemukan")
    jobs = sup.get("jobs") or []
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == target_jid), None)
    if idx is None:
        raise HTTPException(404, "Tagihan vendor tidak ditemukan")

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(target_sid, f"payment/{target_jid}", bukti, ALLOWED_IMG | ALLOWED_DOC)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    payment = {
        "id": _gen_supplier_id(), "amount": int(amount),
        "catatan": (catatan or "").strip()[:300], "bukti_url": bukti_url,
        "tanggal": tgl, "tipe": "transfer",
        "metode": (metode or "Transfer").strip()[:40], "source": "vendor-mobile",
    }
    jobs[idx].setdefault("payments", []).append(payment)
    await db.supplier_profiles.update_one({"id": target_sid}, {"$set": {"jobs": jobs}})
    jt = _supplier_job_totals(jobs[idx])
    return {
        "ok": True, "supplier_id": target_sid, "supplier_nama": sup.get("nama"),
        "job_id": target_jid, "payment": payment,
        "nopol": jobs[idx].get("nopol") or "", "kategori": jobs[idx].get("kategori") or "Lainnya",
        "total_harga": jt.get("total_harga") or 0, "terbayar": jt.get("total_terbayar") or 0,
        "sisa": jt.get("sisa") or 0,
    }


@api_router.get("/vendor-mobile/vendors-unpaid", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_vendors_unpaid(limit: int = 300):
    """Tagihan vendor DIKELOMPOKKAN per vendor (buat halaman 'Bayar per Vendor').
    Tiap vendor: ringkasan total tagihan/terbayar/sisa + daftar PO/job-nya
    (yang punya nilai tagihan) lengkap status per PO (belum/sebagian/lunas)."""
    vendors = []
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        jobs_out = []
        tot = terb = 0
        for j in (s.get("jobs") or []):
            jt = _supplier_job_totals(j)
            th = jt.get("total_harga") or 0
            if th <= 0:
                continue
            tb = jt.get("total_terbayar") or 0
            si = jt.get("sisa") or 0
            status = "lunas" if si <= 0 else ("sebagian" if tb > 0 else "belum")
            jobs_out.append({
                "job_id": j.get("id"), "trip_id": j.get("trip_id"),
                "nopol": j.get("nopol") or "", "rute": _rute_str(j.get("asal_kota"), j.get("tujuan_kota")),
                "kategori": j.get("kategori") or "Lainnya",
                "total_harga": th, "terbayar": tb, "sisa": si, "status": status,
                "tanggal": j.get("tanggal") or "",
            })
            tot += th
            terb += tb
        if not jobs_out:
            continue
        # PO belum lunas di atas, yang sisanya besar duluan
        jobs_out.sort(key=lambda x: (x["status"] == "lunas", -(x["sisa"] or 0)))
        vendors.append({
            "supplier_id": s.get("id"), "supplier_nama": s.get("nama") or "-",
            "total_tagihan": tot, "total_terbayar": terb, "total_sisa": tot - terb,
            "jumlah_po": len(jobs_out), "jobs": jobs_out,
        })
    # Vendor yang masih ada sisa tampil duluan, sisa terbesar di atas
    vendors.sort(key=lambda v: (v["total_sisa"] <= 0, -(v["total_sisa"] or 0)))
    return {"items": vendors[:limit]}


@api_router.post("/vendor-mobile/pay-batch", dependencies=[Depends(require_vendor_pin)])
async def vendor_mobile_pay_batch(
    supplier_id: str = Form(...),
    job_ids: str = Form(...),            # id job dipisah koma, urutan = urutan bayar
    amount: int = Form(...),
    tanggal: Optional[str] = Form(None),
    metode: str = Form("Transfer"),
    catatan: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """Bayar beberapa PO/job SATU vendor sekaligus dengan 1 nominal.
    Nominal didistribusi berurutan (waterfall): tiap PO dibayar sebesar
    min(sisa nominal, sisa PO) sampai nominal habis. Kalau nominal lebih besar
    dari total sisa, sisanya dikembalikan di 'sisa_nominal' (tidak overpay).
    Bukti transfer yang sama dipakai untuk semua cicilan (ditandai batch_id)."""
    if amount <= 0:
        raise HTTPException(400, "Nominal harus lebih dari 0")
    ids = [x.strip() for x in (job_ids or "").split(",") if x.strip()]
    if not ids:
        raise HTTPException(400, "Pilih minimal 1 PO")
    sup = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not sup:
        raise HTTPException(404, "Vendor tidak ditemukan")
    jobs = sup.get("jobs") or []

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(supplier_id, "payment/batch", bukti, ALLOWED_IMG | ALLOWED_DOC)

    batch_id = _gen_supplier_id()
    remaining = int(amount)
    applied = []
    for jid in ids:
        if remaining <= 0:
            break
        idx = next((i for i, j in enumerate(jobs) if j.get("id") == jid), None)
        if idx is None:
            continue
        sisa = _supplier_job_totals(jobs[idx]).get("sisa") or 0
        if sisa <= 0:
            continue
        pay_amt = min(remaining, sisa)
        payment = {
            "id": _gen_supplier_id(), "amount": int(pay_amt),
            "catatan": (catatan or "").strip()[:300], "bukti_url": bukti_url,
            "tanggal": tgl, "tipe": "transfer",
            "metode": (metode or "Transfer").strip()[:40],
            "source": "vendor-mobile-batch", "batch_id": batch_id,
        }
        jobs[idx].setdefault("payments", []).append(payment)
        remaining -= pay_amt
        njt = _supplier_job_totals(jobs[idx])
        applied.append({
            "job_id": jid, "nopol": jobs[idx].get("nopol") or "",
            "dibayar": int(pay_amt), "sisa": njt.get("sisa") or 0,
            "status": "lunas" if (njt.get("sisa") or 0) <= 0 else "sebagian",
        })
    if not applied:
        raise HTTPException(400, "Tidak ada tagihan yang bisa dibayar (mungkin sudah lunas)")
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return {
        "ok": True, "supplier_id": supplier_id, "supplier_nama": sup.get("nama"),
        "batch_id": batch_id, "total_dibayar": int(amount) - remaining,
        "sisa_nominal": remaining, "applied": applied,
    }


@api_router.post("/admin/trips/{trip_id}/finance/payments", dependencies=[Depends(require_admin_pin)])
async def add_customer_payment(
    trip_id: str,
    amount: int = Form(...),
    tanggal: Optional[str] = Form(None),
    metode: str = Form("Transfer BCA"),
    catatan: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """Catat 1 pembayaran customer (uang masuk) untuk trip -> piutang otomatis
    berkurang, status invoice & cash-in ikut berubah. Bukti transfer opsional.
    Klasifikasi: Pendapatan. Terhubung ke trip_id."""
    if amount <= 0:
        raise HTTPException(400, "Jumlah pembayaran harus lebih dari 0")
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(trip_id, "customer-payment", bukti, ALLOWED_IMG | ALLOWED_DOC)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()
    metode = metode.strip() or "Transfer BCA"

    payment = {
        "id": uuid.uuid4().hex[:8],
        "amount": int(amount),
        "tanggal": tgl,
        "metode": metode[:40],
        "catatan": (catatan or "").strip()[:300],
        "bukti_url": bukti_url,
        "klasifikasi": "Pendapatan",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$push": {"finance.customer_payments": payment},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    doc = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    return await _trip_finance_summary(doc)


@api_router.delete("/admin/trips/{trip_id}/finance/payments/{payment_id}", dependencies=[Depends(require_admin_pin)])
async def delete_customer_payment(trip_id: str, payment_id: str):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    res = await db.trips.update_one(
        {"trip_id": trip_id},
        {"$pull": {"finance.customer_payments": {"id": payment_id}},
         "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.modified_count == 0:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    doc = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    return await _trip_finance_summary(doc)


# ══════════════════════════════════════════════════════
# KOORDINATOR ACCOUNT SYSTEM
# ══════════════════════════════════════════════════════

def _gen_kord_id() -> str:
    return uuid.uuid4().hex[:8]

class KordCreateBody(BaseModel):
    nama: str
    password: str

class KordLoginBody(BaseModel):
    nama: str
    password: str

class KordChangePasswordBody(BaseModel):
    kord_id: str
    old_password: str
    new_password: str

class KordResetPasswordBody(BaseModel):
    password: str

@api_router.post("/admin/koordinators", dependencies=[Depends(require_admin_pin)])
async def create_koordinator(body: KordCreateBody):
    """Create a new koordinator account."""
    nama = body.nama.strip()
    if not nama:
        raise HTTPException(400, "Nama tidak boleh kosong")
    # case-insensitive uniqueness check
    import re as _re
    existing = await db.koordinators.find_one({"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)})
    if existing:
        raise HTTPException(409, "Nama sudah dipakai")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": _gen_kord_id(),
        "nama": nama,
        "password": body.password,
        "aktif": True,
        "first_login": True,
        "created_at": now,
    }
    await db.koordinators.insert_one(doc)
    return {"ok": True, "id": doc["id"], "nama": doc["nama"]}

@api_router.get("/admin/koordinators", dependencies=[Depends(require_admin_pin)])
async def list_koordinators():
    """List all koordinators (excluding password)."""
    items = []
    async for k in db.koordinators.find({}, {"_id": 0, "password": 0}).sort("created_at", -1):
        items.append(k)
    return {"count": len(items), "items": items}

@api_router.delete("/admin/koordinators/{kord_id}", dependencies=[Depends(require_admin_pin)])
async def deactivate_koordinator(kord_id: str):
    """Soft-delete: set aktif=False."""
    res = await db.koordinators.update_one({"id": kord_id}, {"$set": {"aktif": False}})
    if res.matched_count == 0:
        raise HTTPException(404, "Koordinator tidak ditemukan")
    return {"ok": True}

@api_router.post("/admin/koordinators/{kord_id}/reset-password", dependencies=[Depends(require_admin_pin)])
async def reset_koordinator_password(kord_id: str, body: KordResetPasswordBody):
    """Admin resets a koordinator password and forces first_login."""
    res = await db.koordinators.update_one({"id": kord_id}, {"$set": {"password": body.password, "first_login": True}})
    if res.matched_count == 0:
        raise HTTPException(404, "Koordinator tidak ditemukan")
    return {"ok": True}

@api_router.post("/koordinator/login")
async def koordinator_login(body: KordLoginBody):
    """Login for koordinator with nama + password."""
    import re as _re
    nama = (body.nama or "").strip()
    kord = await db.koordinators.find_one({"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)})
    if not kord or not kord.get("aktif"):
        raise HTTPException(401, "Nama atau password salah, atau akun tidak aktif")
    if kord.get("password") != body.password:
        raise HTTPException(401, "Nama atau password salah")
    return {"ok": True, "id": kord["id"], "nama": kord["nama"], "first_login": bool(kord.get("first_login", False))}

@api_router.post("/koordinator/change-password")
async def koordinator_change_password(body: KordChangePasswordBody):
    """Koordinator changes their own password."""
    kord = await db.koordinators.find_one({"id": body.kord_id})
    if not kord:
        raise HTTPException(404, "Akun tidak ditemukan")
    # Skip old password check on first login
    if not kord.get("first_login", False):
        if kord.get("password") != body.old_password:
            raise HTTPException(401, "Password lama salah")
    await db.koordinators.update_one({"id": body.kord_id}, {"$set": {"password": body.new_password, "first_login": False}})
    return {"ok": True}


def _compute_trip_stats(t: dict, order: dict) -> dict:
    """Compute checkpoint_rate, days_elapsed, on_time for a trip."""
    daily = t.get("daily_checkpoints") or []
    created_at_str = t.get("created_at") or order.get("created_at") or ""
    status = (order.get("status") or t.get("status") or "").upper()
    handover = t.get("handover") or {}
    both_handover = bool(handover.get("bastk")) and bool(handover.get("resi"))

    # Days elapsed
    days_elapsed = 0
    if created_at_str:
        try:
            start = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
            now_wib = datetime.now(WIB)
            days_elapsed = max(1, (now_wib.date() - start.date()).days + 1)
        except Exception:
            days_elapsed = 1

    # Checkpoint rate: unique dates in daily vs days elapsed
    cp_dates = set(cp.get("date") for cp in daily if cp.get("date"))
    if days_elapsed > 0:
        checkpoint_rate = round(len(cp_dates) / days_elapsed * 100)
        checkpoint_rate = min(100, checkpoint_rate)
    else:
        checkpoint_rate = 0

    # on_time: only applicable for DELIVERED trips
    on_time = None
    if status == "DELIVERED":
        estimated_days = t.get("estimated_days") or order.get("estimated_days")
        if estimated_days:
            on_time = days_elapsed <= int(estimated_days)
        else:
            on_time = True  # no estimate, assume on time

    return {
        "checkpoint_rate": checkpoint_rate,
        "days_elapsed": days_elapsed,
        "on_time": on_time,
        "both_handover": both_handover,
    }


@api_router.get("/koordinator/trips")
async def koordinator_trips(kord_id: Optional[str] = Query(None), nama: Optional[str] = Query(None)):
    """Return trips assigned to a koordinator by kord_id (or legacy nama). No auth required."""
    import re as _re
    if kord_id:
        cursor = db.trips.find({"koordinator_id": kord_id}, {"_id": 0})
    elif nama:
        rx = _re.compile(r"^\s*" + _re.escape(nama.strip()) + r"\s*$", _re.IGNORECASE)
        cursor = db.trips.find({"koordinator": rx}, {"_id": 0})
    else:
        raise HTTPException(400, "kord_id atau nama diperlukan")
    items = []
    async for t in cursor:
        # Enrich with order data
        order = await db.orders.find_one({"trip_id": t["trip_id"]}, {"_id": 0}) or {}
        daily = t.get("daily_checkpoints") or []
        legs = t.get("legs") or []
        handover = t.get("handover") or {}
        stats = _compute_trip_stats(t, order)
        items.append({
            "trip_id": t.get("trip_id"),
            "order_id": order.get("order_id") or t.get("order_id"),
            "asal_kota": order.get("asal_kota") or t.get("asal_kota"),
            "tujuan_kota": order.get("tujuan_kota") or t.get("tujuan_kota"),
            "vehicle_type": order.get("vehicle_type") or t.get("vehicle_type"),
            "nopol": order.get("nopol") or t.get("nopol"),
            "nama_driver": order.get("nama_driver") or t.get("nama_driver"),
            "status": order.get("status") or t.get("status"),
            "customer_nama": order.get("customer_nama"),
            "legs": legs,
            "daily_checkpoints_count": len(daily),
            "last_checkpoint": daily[-1].get("ts") if daily else None,
            "handover": {
                "bastk": bool(handover.get("bastk")),
                "resi": bool(handover.get("resi")),
            },
            "koordinator": t.get("koordinator"),
            "koordinator_id": t.get("koordinator_id"),
            "koordinator_nama": t.get("koordinator_nama"),
            "koordinator_hp": t.get("koordinator_hp"),
            "checkpoint_rate": stats["checkpoint_rate"],
            "days_elapsed": stats["days_elapsed"],
            "on_time": stats["on_time"],
            "both_handover": stats["both_handover"],
        })
    return {"count": len(items), "items": items}


@api_router.delete("/admin/orders/{order_id}", dependencies=[Depends(require_admin_pin)])
async def admin_delete_order(order_id: str):
    """Hapus permanen 1 order beserta trip tertaut (untuk membersihkan data dummy/uji).
    Catatan: foto yang sudah terupload ke storage tidak ikut terhapus."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    tid = order.get("trip_id")
    await db.orders.delete_one({"order_id": order_id})
    trip_deleted = False
    if tid:
        res = await db.trips.delete_one({"trip_id": tid})
        trip_deleted = res.deleted_count > 0
    logger.info(f"[admin:delete_order] {order_id} trip={tid} trip_deleted={trip_deleted}")
    return {"ok": True, "order_id": order_id, "trip_id": tid, "trip_deleted": trip_deleted}


class OdooSyncBody(BaseModel):
    with_invoice: bool = False
    price: float = 0.0
    tax_mode: str = "logistik"  # "logistik" (PPn Logistik 1.1%) | "no_tax"
    price_includes_tax: bool = False


@api_router.post("/admin/orders/{order_id}/odoo-sync", dependencies=[Depends(require_admin_pin)])
async def admin_odoo_sync(order_id: str, body: OdooSyncBody = OdooSyncBody()):
    """Manual Odoo sync untuk 1 order — re-trigger create sale.order + confirm invoice jika sudah ada trip."""
    order = await db.orders.find_one({"order_id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")

    trip_id = order.get("trip_id")
    steps = []

    odoo = OdooClient()
    odoo_enabled = odoo.enabled
    if not odoo_enabled:
        raise HTTPException(400, "Odoo belum dikonfigurasi (ODOO_URL/DB/USER/KEY kosong di Railway).")

    # Step 1: sync sale.order — AWAIT so we get the real sale_id and can report it.
    sync = await _odoo_sync_order(
        order_id, trip_id or "", order, price=body.price,
        tax_mode=body.tax_mode, price_includes_tax=body.price_includes_tax,
    )
    if not sync.get("ok"):
        raise HTTPException(502, f"Gagal sync ke Odoo: {sync.get('error') or 'unknown error'}")

    sale_id = sync.get("sale_id")
    steps.append(f"Sales Order #{sale_id} dibuat" if sale_id else "sale.order sync selesai")

    # Step 2: invoice — kalau admin centang "Customer Invoice", ATAU trip sudah selesai.
    want_invoice = body.with_invoice
    if trip_id and not want_invoice:
        trip = await db.trips.find_one({"trip_id": trip_id})
        h = (trip or {}).get("handover") or {}
        if h.get("bastk") and h.get("resi"):
            want_invoice = True
    if want_invoice and sale_id:
        confirmed = await asyncio.to_thread(odoo.call, "sale.order", "action_confirm", [[sale_id]])
        inv = await asyncio.to_thread(odoo.call, "sale.order", "_create_invoices", [[sale_id]])
        steps.append("Customer Invoice dibuat" if inv else "Sales Order dikonfirmasi (invoice kosong)")

    # Build direct URL to the Odoo sale.order form view (modern web client).
    odoo_url = f"{odoo.url}/odoo/sales/{sale_id}" if sale_id else f"{odoo.url}/odoo/sales"

    return {
        "message": f"OK: Sales Order #{sale_id} dibuat" if sale_id else "Odoo sync selesai",
        "order_id": order_id,
        "trip_id": trip_id,
        "odoo_enabled": odoo_enabled,
        "sale_id": sale_id,
        "odoo_url": odoo_url,
        "steps": steps,
    }


# ---------- Pickup WhatsApp reminders (H-3 / H-2 / H-1) ----------
# Called once a day by an external scheduler (Railway Cron / cron-job.org).
# Protected by X-Cron-Secret header matching CRON_SECRET env var.
REMINDER_ACTIVE_STATUS = {"NEW", "DISPATCHED"}  # not yet picked up


@api_router.post("/cron/pickup-reminders")
async def cron_pickup_reminders(x_cron_secret: str = Header(default="")):
    if not CRON_SECRET:
        raise HTTPException(503, "CRON_SECRET belum dikonfigurasi di server.")
    if x_cron_secret.strip() != CRON_SECRET:
        raise HTTPException(401, "Invalid cron secret.")

    now_wib = datetime.now(WIB)
    today = now_wib.date()
    sent_marker = today.isoformat()  # dedup: 1 reminder per order per calendar day (WIB)

    results = []
    sent_count = 0
    for offset in (3, 2, 1):
        target_date = (today + timedelta(days=offset)).isoformat()
        cursor = db.orders.find({
            "pickup_date": target_date,
            "status": {"$in": list(REMINDER_ACTIVE_STATUS)},
        })
        async for order in cursor:
            already = order.get("reminders_sent") or []
            if sent_marker in already:
                continue  # already reminded today
            label = f"H-{offset}"
            jam = order.get("pickup_time") or "-"
            msg = (
                f"🔔 *Pengingat Pickup ({label})*\n"
                f"Order: {order.get('order_id','-')}\n"
                f"Customer: {order.get('customer_nama','-')}\n"
                f"Jadwal: {target_date} {jam} WIB\n"
                f"Rute: {order.get('asal_kota','-')} → {order.get('tujuan_kota','-')}\n"
                f"Kendaraan: {order.get('vehicle_type') or order.get('nopol') or '-'}\n"
                f"PIC Pickup: {order.get('pickup_pic','-')} ({order.get('pickup_hp','-')})"
            )
            ok = await send_whatsapp(REMINDER_TARGET, msg)
            if ok:
                await db.orders.update_one(
                    {"order_id": order["order_id"]},
                    {"$addToSet": {"reminders_sent": sent_marker}},
                )
                sent_count += 1
            results.append({"order_id": order.get("order_id"), "label": label, "sent": ok})

    logger.info(f"[cron:pickup-reminders] date={sent_marker} sent={sent_count} matched={len(results)}")
    return {"date": sent_marker, "target": REMINDER_TARGET, "sent": sent_count, "details": results}


# ══════════════════════════════════════════════════════
# DATA DRIVER — CRUD
# ══════════════════════════════════════════════════════

def _gen_driver_id() -> str:
    return "DRV-" + uuid.uuid4().hex[:6].upper()

class DriverBody(BaseModel):
    nama: str
    no_hp: Optional[str] = ""
    no_ktp: Optional[str] = ""
    no_sim: Optional[str] = ""
    tipe_sim: Optional[str] = ""
    alamat: Optional[str] = ""
    status: Optional[str] = "aktif"

@api_router.post("/driver-register")
async def driver_self_register(body: DriverBody):
    """Form pendaftaran publik untuk driver — tidak butuh PIN admin."""
    now = datetime.utcnow().isoformat()
    doc = {
        "driver_id": _gen_driver_id(),
        "nama": body.nama.strip(),
        "no_hp": (body.no_hp or "").strip(),
        "no_ktp": (body.no_ktp or "").strip(),
        "no_sim": (body.no_sim or "").strip(),
        "tipe_sim": (body.tipe_sim or "").strip(),
        "alamat": (body.alamat or "").strip(),
        "status": "pending",
        "foto_ktp": None, "foto_sim": None, "foto_selfie": None,
        "created_at": now, "updated_at": now,
    }
    await db.drivers.insert_one(doc)
    doc.pop("_id", None)
    return {"ok": True, "driver_id": doc["driver_id"]}

@api_router.post("/driver-register/{driver_id}/foto/{slot}")
async def driver_register_foto(driver_id: str, slot: str, foto: UploadFile = File(...)):
    """Upload foto KTP/SIM/selfie dari form pendaftaran driver (tanpa PIN)."""
    if slot not in ("ktp", "sim", "selfie"):
        raise HTTPException(400, "Slot tidak valid")
    drv = await db.drivers.find_one({"driver_id": driver_id})
    if not drv: raise HTTPException(404, "Driver tidak ditemukan")
    url = _save_upload(driver_id, f"driver-{slot}", foto, {".jpg", ".jpeg", ".png", ".webp"})
    await db.drivers.update_one({"driver_id": driver_id}, {"$set": {f"foto_{slot}": url, "updated_at": datetime.utcnow().isoformat()}})
    return {"ok": True, "url": url}

@api_router.get("/admin/drivers", dependencies=[Depends(require_admin_pin)])
async def list_drivers(q: Optional[str] = None, status: Optional[str] = None):
    filt: dict = {}
    if status: filt["status"] = status
    if q:
        filt["$or"] = [
            {"nama": {"$regex": q, "$options": "i"}},
            {"no_hp": {"$regex": q, "$options": "i"}},
            {"driver_id": {"$regex": q, "$options": "i"}},
        ]
    docs = await db.drivers.find(filt, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": docs, "total": len(docs)}

@api_router.post("/admin/drivers", dependencies=[Depends(require_admin_pin)])
async def create_driver(body: DriverBody):
    now = datetime.utcnow().isoformat()
    doc = {
        "driver_id": _gen_driver_id(),
        "nama": body.nama.strip(),
        "no_hp": (body.no_hp or "").strip(),
        "no_ktp": (body.no_ktp or "").strip(),
        "no_sim": (body.no_sim or "").strip(),
        "tipe_sim": (body.tipe_sim or "").strip(),
        "alamat": (body.alamat or "").strip(),
        "status": body.status or "aktif",
        "foto_ktp": None, "foto_sim": None, "foto_selfie": None,
        "created_at": now, "updated_at": now,
    }
    await db.drivers.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.patch("/admin/drivers/{driver_id}", dependencies=[Depends(require_admin_pin)])
async def patch_driver(driver_id: str, body: DriverBody):
    drv = await db.drivers.find_one({"driver_id": driver_id})
    if not drv: raise HTTPException(404, "Driver tidak ditemukan")
    now = datetime.utcnow().isoformat()
    upd = {"nama": body.nama.strip(), "no_hp": (body.no_hp or "").strip(),
           "no_ktp": (body.no_ktp or "").strip(), "no_sim": (body.no_sim or "").strip(),
           "tipe_sim": (body.tipe_sim or "").strip(), "alamat": (body.alamat or "").strip(),
           "status": body.status or "aktif", "updated_at": now}
    await db.drivers.update_one({"driver_id": driver_id}, {"$set": upd})
    return {"ok": True}

@api_router.delete("/admin/drivers/{driver_id}", dependencies=[Depends(require_admin_pin)])
async def delete_driver(driver_id: str):
    res = await db.drivers.delete_one({"driver_id": driver_id})
    if res.deleted_count == 0: raise HTTPException(404, "Driver tidak ditemukan")
    return {"ok": True}

@api_router.post("/admin/drivers/{driver_id}/foto/{slot}", dependencies=[Depends(require_admin_pin)])
async def upload_driver_foto(driver_id: str, slot: str, foto: UploadFile = File(...)):
    """slot: ktp | sim | selfie"""
    if slot not in ("ktp", "sim", "selfie"):
        raise HTTPException(400, "Slot tidak valid")
    drv = await db.drivers.find_one({"driver_id": driver_id})
    if not drv: raise HTTPException(404, "Driver tidak ditemukan")
    url = _save_upload(driver_id, f"driver-{slot}", foto, {".jpg", ".jpeg", ".png", ".webp"})
    await db.drivers.update_one({"driver_id": driver_id}, {"$set": {f"foto_{slot}": url, "updated_at": datetime.utcnow().isoformat()}})
    return {"ok": True, "url": url}

@api_router.get("/admin/drivers/{driver_id}", dependencies=[Depends(require_admin_pin)])
async def get_driver(driver_id: str):
    drv = await db.drivers.find_one({"driver_id": driver_id}, {"_id": 0})
    if not drv: raise HTTPException(404, "Driver tidak ditemukan")
    return drv


class DriverCatatanBody(BaseModel):
    jenis: str  # "warning" | "komplain"
    catatan: str
    tanggal: Optional[str] = None


@api_router.post("/admin/drivers/{driver_id}/catatan", dependencies=[Depends(require_admin_pin)])
async def add_driver_catatan(driver_id: str, body: DriverCatatanBody):
    """Catatan warning/komplain manual per driver -- dicatat admin, dipakai
    buat riwayat performa driver (bukan sistem otomatis)."""
    if body.jenis not in ("warning", "komplain"):
        raise HTTPException(400, "Jenis harus 'warning' atau 'komplain'")
    catatan = body.catatan.strip()
    if not catatan:
        raise HTTPException(400, "Catatan tidak boleh kosong")
    drv = await db.drivers.find_one({"driver_id": driver_id})
    if not drv:
        raise HTTPException(404, "Driver tidak ditemukan")
    now = datetime.utcnow().isoformat()
    entry = {
        "id": uuid.uuid4().hex[:8],
        "jenis": body.jenis,
        "catatan": catatan,
        "tanggal": (body.tanggal or now)[:10],
        "created_at": now,
    }
    await db.drivers.update_one({"driver_id": driver_id}, {"$push": {"catatan_log": entry}, "$set": {"updated_at": now}})
    return entry


@api_router.delete("/admin/drivers/{driver_id}/catatan/{catatan_id}", dependencies=[Depends(require_admin_pin)])
async def delete_driver_catatan(driver_id: str, catatan_id: str):
    result = await db.drivers.update_one({"driver_id": driver_id}, {"$pull": {"catatan_log": {"id": catatan_id}}})
    if result.modified_count == 0:
        raise HTTPException(404, "Catatan tidak ditemukan")
    return {"ok": True}


# ══════════════════════════════════════════════════════
# PELANGGAN PROFILE SYSTEM (Customer Price Memory)
# ══════════════════════════════════════════════════════

import random as _random
import string as _string

def _gen_pelanggan_id() -> str:
    return uuid.uuid4().hex[:8]

def _gen_token(n: int = 12) -> str:
    chars = _string.ascii_letters + _string.digits
    return "".join(_random.choice(chars) for _ in range(n))

class PelangganCreateBody(BaseModel):
    nama_pt: str
    pic_nama: str = ""
    pic_hp: str = ""
    catatan: str = ""
    margin_khusus: dict = {}

class PelangganPatchBody(BaseModel):
    catatan: Optional[str] = None
    pic_nama: Optional[str] = None
    pic_hp: Optional[str] = None
    margin_khusus: Optional[dict] = None

class PelangganHargaBody(BaseModel):
    rute: str
    hpp: int
    harga_deal: int
    tipe_kendaraan: str
    catatan: str = ""
    asuransi: int = 0
    moda: str = ""

@api_router.post("/admin/pelanggan", dependencies=[Depends(require_admin_pin)])
async def create_pelanggan(body: PelangganCreateBody):
    """Create a new pelanggan profile or return existing (case-insensitive)."""
    import re as _re
    nama_pt = body.nama_pt.strip()
    if not nama_pt:
        raise HTTPException(400, "nama_pt tidak boleh kosong")
    existing = await db.pelanggan_profiles.find_one(
        {"nama_pt": _re.compile(r"^\s*" + _re.escape(nama_pt) + r"\s*$", _re.IGNORECASE)},
        {"_id": 0}
    )
    if existing:
        return existing
    now = datetime.utcnow().isoformat()
    doc = {
        "id": _gen_pelanggan_id(),
        "nama_pt": nama_pt,
        "pic_nama": body.pic_nama.strip(),
        "pic_hp": body.pic_hp.strip(),
        "catatan": body.catatan.strip(),
        "margin_khusus": body.margin_khusus or {},
        "token": _gen_token(12),
        "created_at": now,
        "harga_history": [],
    }
    await db.pelanggan_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api_router.get("/admin/pelanggan", dependencies=[Depends(require_admin_pin)])
async def list_pelanggan(q: Optional[str] = None):
    """List all pelanggan sorted by nama_pt, optional search by q."""
    import re as _re
    filt = {}
    if q:
        filt["nama_pt"] = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
    items = []
    async for p in db.pelanggan_profiles.find(filt, {"_id": 0, "harga_history": 0}).sort("nama_pt", 1):
        items.append(p)
    return {"count": len(items), "items": items}

@api_router.get("/admin/pelanggan/{pelanggan_id}", dependencies=[Depends(require_admin_pin)])
async def get_pelanggan(pelanggan_id: str):
    """Get full pelanggan document including last 20 harga_history."""
    doc = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    doc["harga_history"] = (doc.get("harga_history") or [])[-200:]
    return doc

@api_router.patch("/admin/pelanggan/{pelanggan_id}", dependencies=[Depends(require_admin_pin)])
async def patch_pelanggan(pelanggan_id: str, body: PelangganPatchBody):
    """Update catatan, pic_nama, pic_hp, margin_khusus."""
    upd = {}
    if body.catatan is not None: upd["catatan"] = body.catatan.strip()
    if body.pic_nama is not None: upd["pic_nama"] = body.pic_nama.strip()
    if body.pic_hp is not None: upd["pic_hp"] = body.pic_hp.strip()
    if body.margin_khusus is not None: upd["margin_khusus"] = body.margin_khusus
    if not upd:
        raise HTTPException(400, "Tidak ada field yang diupdate")
    res = await db.pelanggan_profiles.update_one({"id": pelanggan_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    return {"ok": True}

@api_router.post("/admin/pelanggan/{pelanggan_id}/harga", dependencies=[Depends(require_admin_pin)])
async def add_pelanggan_harga(pelanggan_id: str, body: PelangganHargaBody):
    """Push a new price record to harga_history."""
    doc = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    margin_aktual = round((body.harga_deal / body.hpp - 1) * 100, 1) if body.hpp else 0
    entry = {
        "id": _gen_pelanggan_id(),
        "rute": body.rute,
        "hpp": body.hpp,
        "harga_deal": body.harga_deal,
        "margin_aktual": margin_aktual,
        "tipe_kendaraan": body.tipe_kendaraan,
        "catatan": body.catatan.strip(),
        "asuransi": body.asuransi,
        "moda": body.moda,
        "tanggal": datetime.utcnow().isoformat(),
    }
    await db.pelanggan_profiles.update_one(
        {"id": pelanggan_id},
        {"$push": {"harga_history": {"$each": [entry], "$slice": -100}}}
    )
    updated = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    updated["harga_history"] = (updated.get("harga_history") or [])[-200:]
    return updated


class PelangganHargaPatchBody(BaseModel):
    harga_deal: int


@api_router.patch("/admin/pelanggan/{pelanggan_id}/harga/{harga_id}", dependencies=[Depends(require_admin_pin)])
async def patch_pelanggan_harga(pelanggan_id: str, harga_id: str, body: PelangganHargaPatchBody):
    """Ubah harga_deal 1 entry yang udah ada -- buat kasus pelanggan nego dan
    harga final beda dari hasil kalkulasi HPP+margin awal. margin_aktual
    dihitung ulang otomatis biar tetap konsisten sama harga_deal barunya."""
    if body.harga_deal <= 0:
        raise HTTPException(400, "harga_deal harus lebih dari 0")
    doc = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    history = doc.get("harga_history") or []
    idx = next((i for i, h in enumerate(history) if h.get("id") == harga_id), None)
    if idx is None:
        raise HTTPException(404, "Data harga tidak ditemukan")
    history[idx]["harga_deal"] = body.harga_deal
    hpp = history[idx].get("hpp") or 0
    history[idx]["margin_aktual"] = round((body.harga_deal / hpp - 1) * 100, 1) if hpp else 0
    await db.pelanggan_profiles.update_one({"id": pelanggan_id}, {"$set": {"harga_history": history}})
    updated = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    updated["harga_history"] = (updated.get("harga_history") or [])[-200:]
    return updated


@api_router.delete("/admin/pelanggan/{pelanggan_id}", dependencies=[Depends(require_admin_pin)])
async def delete_pelanggan(pelanggan_id: str):
    """Delete a pelanggan profile entirely."""
    result = await db.pelanggan_profiles.delete_one({"id": pelanggan_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    return {"ok": True}

@api_router.delete("/admin/pelanggan/{pelanggan_id}/harga", dependencies=[Depends(require_admin_pin)])
async def clear_pelanggan_harga(pelanggan_id: str):
    """Clear ALL price records for a pelanggan."""
    result = await db.pelanggan_profiles.update_one(
        {"id": pelanggan_id},
        {"$set": {"harga_history": []}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Pelanggan tidak ditemukan")
    updated = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    return updated

@api_router.delete("/admin/pelanggan/{pelanggan_id}/harga/{harga_id}", dependencies=[Depends(require_admin_pin)])
async def delete_pelanggan_harga(pelanggan_id: str, harga_id: str):
    """Remove one price record from harga_history by its id."""
    result = await db.pelanggan_profiles.update_one(
        {"id": pelanggan_id},
        {"$pull": {"harga_history": {"id": harga_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(404, "Data harga tidak ditemukan")
    updated = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    return updated

@api_router.get("/pelanggan/{token}")
async def public_pelanggan_harga(token: str):
    """Public endpoint — return PT name + last 10 price records (no HPP/margin)."""
    doc = await db.pelanggan_profiles.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Link tidak valid")
    history = (doc.get("harga_history") or [])[-200:]
    safe_history = [
        {
            "rute": h.get("rute"),
            "harga_deal": h.get("harga_deal"),
            "tipe_kendaraan": h.get("tipe_kendaraan"),
            "tanggal": h.get("tanggal"),
            "asuransi": h.get("asuransi", 0),
            "catatan": h.get("catatan", ""),
            "moda": h.get("moda", ""),
        }
        for h in history
    ]
    safe_history.reverse()
    return {"nama_pt": doc["nama_pt"], "harga_history": safe_history}


# ── Permintaan Harga Supplier ──────────────────────────────────────────
# Admin bikin daftar rute yang butuh harga dari perwakilan supplier di
# daerah (Sulawesi/Kalimantan dll). Link token dikirim ke perwakilan --
# mereka tinggal isi kolom harga per rute tanpa perlu login/PIN.

def _gen_permintaan_id() -> str:
    return uuid.uuid4().hex[:8]


class PermintaanHargaRowBody(BaseModel):
    asal: str
    tujuan: str
    tipe_kendaraan: str


class PermintaanHargaCreateBody(BaseModel):
    nama_supplier: str
    catatan: str = ""
    rows: List[PermintaanHargaRowBody]


@api_router.post("/admin/permintaan-harga", dependencies=[Depends(require_admin_pin)])
async def create_permintaan_harga(body: PermintaanHargaCreateBody):
    nama_supplier = body.nama_supplier.strip()
    if not nama_supplier:
        raise HTTPException(400, "Nama supplier tidak boleh kosong")
    rows_in = [r for r in body.rows if r.asal.strip() and r.tujuan.strip() and r.tipe_kendaraan.strip()]
    if not rows_in:
        raise HTTPException(400, "Minimal 1 rute (asal, tujuan, tipe kendaraan) harus diisi")
    now = datetime.utcnow().isoformat()
    doc = {
        "id": _gen_permintaan_id(),
        "nama_supplier": nama_supplier,
        "catatan": body.catatan.strip(),
        "token": _gen_token(12),
        "created_at": now,
        "status": "pending",
        "submitted_at": None,
        "rows": [
            {
                "id": uuid.uuid4().hex[:8],
                "asal": r.asal.strip(),
                "tujuan": r.tujuan.strip(),
                "tipe_kendaraan": r.tipe_kendaraan.strip(),
                "harga": None,
                "filled_at": None,
            }
            for r in rows_in
        ],
    }
    await db.permintaan_harga.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/admin/permintaan-harga", dependencies=[Depends(require_admin_pin)])
async def list_permintaan_harga():
    items = await db.permintaan_harga.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"items": items}


@api_router.get("/admin/permintaan-harga/{pid}", dependencies=[Depends(require_admin_pin)])
async def get_permintaan_harga(pid: str):
    doc = await db.permintaan_harga.find_one({"id": pid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Permintaan tidak ditemukan")
    return doc


@api_router.delete("/admin/permintaan-harga/{pid}", dependencies=[Depends(require_admin_pin)])
async def delete_permintaan_harga(pid: str):
    result = await db.permintaan_harga.delete_one({"id": pid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Permintaan tidak ditemukan")
    return {"ok": True}


@api_router.get("/minta-harga/{token}")
async def public_get_permintaan_harga(token: str):
    """Public endpoint (no PIN) -- dibuka perwakilan supplier lewat link."""
    doc = await db.permintaan_harga.find_one({"token": token}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Link tidak valid")
    return {
        "nama_supplier": doc["nama_supplier"],
        "catatan": doc.get("catatan", ""),
        "status": doc.get("status", "pending"),
        "rows": [
            {"id": r["id"], "asal": r["asal"], "tujuan": r["tujuan"], "tipe_kendaraan": r["tipe_kendaraan"], "harga": r.get("harga")}
            for r in doc.get("rows", [])
        ],
    }


class PermintaanHargaSubmitRow(BaseModel):
    id: str
    harga: int


class PermintaanHargaSubmitBody(BaseModel):
    rows: List[PermintaanHargaSubmitRow]


@api_router.post("/minta-harga/{token}/submit")
async def public_submit_permintaan_harga(token: str, body: PermintaanHargaSubmitBody):
    """Public endpoint (no PIN) -- perwakilan supplier submit harga yang udah diisi."""
    doc = await db.permintaan_harga.find_one({"token": token})
    if not doc:
        raise HTTPException(404, "Link tidak valid")
    rows = doc.get("rows", [])
    by_id = {r["id"]: r for r in rows}
    now = datetime.utcnow().isoformat()
    updated_any = False
    for item in body.rows:
        if item.id in by_id and item.harga and item.harga > 0:
            by_id[item.id]["harga"] = item.harga
            by_id[item.id]["filled_at"] = now
            updated_any = True
    if not updated_any:
        raise HTTPException(400, "Tidak ada harga yang diisi")
    all_filled = all(r.get("harga") for r in rows)
    new_status = "submitted" if all_filled else "partial"
    await db.permintaan_harga.update_one(
        {"token": token},
        {"$set": {"rows": rows, "status": new_status, "submitted_at": now}},
    )
    return {"ok": True, "status": new_status}


# ══════════════════════════════════════════════════════
# SUPPLIER PAYMENT SYSTEM (jasa supir/SDM per unit — DP bertahap,
# bukti transfer, sisa otomatis kehitung). Struktur & pola endpoint-nya
# sengaja disamain kayak Pelanggan Profile System di atas.
# ══════════════════════════════════════════════════════

def _gen_supplier_id() -> str:
    return uuid.uuid4().hex[:8]


def _supplier_job_totals(job: dict) -> dict:
    """Hitung total_terbayar & sisa dari daftar payments — bukan disimpan,
    dihitung ulang tiap read biar nggak pernah nyimpang dari data payments.

    Biaya tambahan per unit (job['tambahan'] = [{id,label,amount}]) NAMBAH tagihan:
    total efektif = harga deal awal + seluruh biaya tambahan. `harga_deal`
    dipertahankan supaya PDF Driver bisa memisahkan harga awal vs tambahan,
    sedangkan `total_harga` yang dikembalikan = nilai efektif (dipakai semua
    total/sisa/kartu supaya angka konsisten di mana-mana)."""
    terbayar = sum((p.get("amount") or 0) for p in (job.get("payments") or []))
    job = dict(job)
    base = job.get("total_harga") or 0
    tambahan = job.get("tambahan") or []
    tambahan_total = sum((t.get("amount") or 0) for t in tambahan)
    job["harga_deal"] = base
    job["tambahan_total"] = tambahan_total
    job["total_harga"] = base + tambahan_total
    job["total_terbayar"] = terbayar
    job["sisa"] = (base + tambahan_total) - terbayar
    # Selisih Harga (buat laporan format Supplier) — TERPISAH dari ongkos di atas,
    # tidak memengaruhi total_harga/sisa. Selisih = Harga Invoice - Harga Deal.
    job["selisih"] = (job.get("selisih_invoice") or 0) - (job.get("selisih_deal") or 0)
    return job


async def _ensure_supplier_projects(doc: dict) -> dict:
    """Migrasi lazy buat supplier lama (sebelum fitur Projek ada): job yang
    belum punya project_id di-assign ke 'Projek 1' yang auto-dibikin, sekali,
    lalu disimpan balik. Setelah ini, semua kode boleh asumsikan tiap job
    punya project_id dan supplier punya minimal 1 project."""
    jobs = doc.get("jobs") or []
    projects = doc.get("projects") or []
    orphan = [j for j in jobs if not j.get("project_id")]
    if not orphan:
        return doc
    if not projects:
        projects = [{
            "id": _gen_supplier_id(), "nama": "Projek 1", "status": "open",
            "created_at": doc.get("created_at") or datetime.utcnow().isoformat(),
            "closed_at": None,
        }]
    target_id = projects[0]["id"]
    for j in orphan:
        j["project_id"] = target_id
    await db.supplier_profiles.update_one({"id": doc["id"]}, {"$set": {"jobs": jobs, "projects": projects}})
    doc["jobs"] = jobs
    doc["projects"] = projects
    return doc


def _get_or_create_active_project(doc: dict):
    """Return (project_id, projects_list). Projek 'aktif' = projek open yang
    paling baru dibikin -- unit baru otomatis masuk ke situ. Kalau semua
    projek udah closed (atau belum ada sama sekali), auto-bikin projek baru."""
    projects = list(doc.get("projects") or [])
    open_projects = [p for p in projects if p.get("status") == "open"]
    if open_projects:
        return open_projects[-1]["id"], projects
    new_proj = {
        "id": _gen_supplier_id(), "nama": f"Projek {len(projects) + 1}", "status": "open",
        "created_at": datetime.utcnow().isoformat(), "closed_at": None,
    }
    projects.append(new_proj)
    return new_proj["id"], projects


class SupplierCreateBody(BaseModel):
    nama: str
    jenis: str = ""       # cth: "Jasa Supir", "SDM", "Lainnya" — bebas teks
    no_hp: str = ""
    catatan: str = ""


class SupplierPatchBody(BaseModel):
    jenis: Optional[str] = None
    no_hp: Optional[str] = None
    catatan: Optional[str] = None


class SupplierJobBody(BaseModel):
    vehicle_type: str = ""
    nopol: str = ""
    no_rangka: str = ""
    asal_kota: str = ""
    tujuan_kota: str = ""
    total_harga: int
    catatan: str = ""
    project_id: Optional[str] = None
    tanggal: Optional[str] = None   # manual date (YYYY-MM-DD); kosong = hari ini
    tag: str = ""                   # Tag/Judul Kelompok laporan (pembatas visual PDF; TIDAK ikut hitungan)
    selisih_deal: Optional[int] = None    # Harga Deal (buat laporan Selisih format Supplier)
    selisih_invoice: Optional[int] = None # Harga Invoice; Selisih = Invoice - Deal (rumus existing)


class SupplierProjectBody(BaseModel):
    nama: str = ""


@api_router.post("/admin/suppliers", dependencies=[Depends(require_admin_pin)])
async def create_supplier(body: SupplierCreateBody):
    """Create supplier baru, atau return yang udah ada (case-insensitive by nama)."""
    import re as _re
    nama = body.nama.strip()
    if not nama:
        raise HTTPException(400, "nama tidak boleh kosong")
    existing = await db.supplier_profiles.find_one(
        {"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)},
        {"_id": 0},
    )
    if existing:
        return existing
    now = datetime.utcnow().isoformat()
    doc = {
        "id": _gen_supplier_id(),
        "nama": nama,
        "jenis": body.jenis.strip(),
        "no_hp": body.no_hp.strip(),
        "catatan": body.catatan.strip(),
        "created_at": now,
        "jobs": [],
    }
    await db.supplier_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/admin/suppliers", dependencies=[Depends(require_admin_pin)])
async def list_suppliers(q: Optional[str] = None):
    """List semua supplier, urut nama, optional search by q. Ikutan hitung
    grand total (semua job) per supplier biar kelihatan di daftar tanpa
    perlu buka detail satu-satu."""
    import re as _re
    filt = {}
    if q:
        filt["nama"] = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
    items = []
    async for s in db.supplier_profiles.find(filt).sort("nama", 1):
        s.pop("_id", None)
        jobs = [_supplier_job_totals(j) for j in (s.get("jobs") or [])]
        s["grand_total_harga"] = sum(j.get("total_harga") or 0 for j in jobs)
        s["grand_total_terbayar"] = sum(j.get("total_terbayar") or 0 for j in jobs)
        s["grand_sisa"] = sum(j.get("sisa") or 0 for j in jobs)
        s["jumlah_unit"] = len(jobs)
        s.pop("jobs", None)  # daftar ringkas — detail job cuma di endpoint detail
        items.append(s)
    return {"count": len(items), "items": items}


@api_router.get("/admin/suppliers/{supplier_id}", dependencies=[Depends(require_admin_pin)])
async def get_supplier(supplier_id: str):
    """Detail supplier lengkap — semua job/unit + payments + grand total,
    dikelompokkan per Projek."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    doc = await _ensure_supplier_projects(doc)
    jobs = [_supplier_job_totals(j) for j in (doc.get("jobs") or [])]
    doc["jobs"] = jobs
    doc["projects"] = doc.get("projects") or []
    doc["grand_total_harga"] = sum(j.get("total_harga") or 0 for j in jobs)
    doc["grand_total_terbayar"] = sum(j.get("total_terbayar") or 0 for j in jobs)
    doc["grand_sisa"] = sum(j.get("sisa") or 0 for j in jobs)
    return doc


@api_router.patch("/admin/suppliers/{supplier_id}", dependencies=[Depends(require_admin_pin)])
async def patch_supplier(supplier_id: str, body: SupplierPatchBody):
    upd = {}
    if body.jenis is not None: upd["jenis"] = body.jenis.strip()
    if body.no_hp is not None: upd["no_hp"] = body.no_hp.strip()
    if body.catatan is not None: upd["catatan"] = body.catatan.strip()
    if not upd:
        raise HTTPException(400, "Tidak ada field yang diupdate")
    res = await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Supplier tidak ditemukan")
    return {"ok": True}


@api_router.delete("/admin/suppliers/{supplier_id}", dependencies=[Depends(require_admin_pin)])
async def delete_supplier(supplier_id: str):
    result = await db.supplier_profiles.delete_one({"id": supplier_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Supplier tidak ditemukan")
    return {"ok": True}


@api_router.post("/admin/suppliers/{supplier_id}/jobs", dependencies=[Depends(require_admin_pin)])
async def add_supplier_job(supplier_id: str, body: SupplierJobBody):
    """Tambah 1 unit/job baru buat supplier ini — misal 1 mobil 1 rute yang
    biayanya dibayar ke supplier ini, mulai dari 0 terbayar. Otomatis masuk ke
    Projek yang lagi aktif (open); kalau semua Projek udah closed, auto-bikin
    Projek baru."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    doc = await _ensure_supplier_projects(doc)
    if body.total_harga < 0:
        raise HTTPException(400, "total_harga tidak boleh negatif")

    projects = doc.get("projects") or []
    project_id = body.project_id if body.project_id and any(p["id"] == body.project_id for p in projects) else None
    if not project_id:
        project_id, projects = _get_or_create_active_project(doc)

    tgl = (body.tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    job = {
        "id": _gen_supplier_id(),
        "project_id": project_id,
        "vehicle_type": body.vehicle_type.strip(),
        "nopol": body.nopol.strip().upper(),
        "no_rangka": body.no_rangka.strip().upper(),
        "asal_kota": body.asal_kota.strip(),
        "tujuan_kota": body.tujuan_kota.strip(),
        "total_harga": body.total_harga,
        "catatan": body.catatan.strip(),
        "tanggal": tgl,
        "tag": (body.tag or "").strip()[:60],
        "selisih_deal": body.selisih_deal if (body.selisih_deal or 0) > 0 else None,
        "selisih_invoice": body.selisih_invoice if (body.selisih_invoice or 0) > 0 else None,
        "payments": [],
    }
    upd = {"jobs": (doc.get("jobs") or []) + [job]}
    if projects != (doc.get("projects") or []):
        upd["projects"] = projects
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": upd})
    return _supplier_job_totals(job)


@api_router.delete("/admin/suppliers/{supplier_id}/jobs/{job_id}", dependencies=[Depends(require_admin_pin)])
async def delete_supplier_job(supplier_id: str, job_id: str):
    result = await db.supplier_profiles.update_one(
        {"id": supplier_id}, {"$pull": {"jobs": {"id": job_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    return {"ok": True}


@api_router.patch("/admin/suppliers/{supplier_id}/jobs/{job_id}/tag", dependencies=[Depends(require_admin_pin)])
async def set_supplier_job_tag(supplier_id: str, job_id: str, body: dict = Body(...)):
    """Set/ubah Tag/Judul Kelompok laporan untuk 1 unit. Murni pembatas visual di
    PDF — TIDAK mengubah harga, total, payment, atau sisa. Kosongkan = tanpa tag."""
    tag = str(body.get("tag") or "").strip()[:60]
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    jobs[idx]["tag"] = tag
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[idx])


@api_router.patch("/admin/suppliers/{supplier_id}/jobs/{job_id}/selisih", dependencies=[Depends(require_admin_pin)])
async def set_supplier_job_selisih(supplier_id: str, job_id: str, body: dict = Body(...)):
    """Set Harga Deal & Harga Invoice per unit (buat laporan Selisih format Supplier).
    Selisih = Invoice - Deal (rumus existing). TIDAK mengubah ongkos/total_harga/
    payment/sisa ongkos. Kosong/0 = dihapus (unit tidak masuk hitungan selisih)."""
    def _num(v):
        try:
            n = int(v)
        except (TypeError, ValueError):
            n = 0
        return n if n > 0 else None
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    jobs[idx]["selisih_deal"] = _num(body.get("selisih_deal"))
    jobs[idx]["selisih_invoice"] = _num(body.get("selisih_invoice"))
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[idx])


@api_router.post("/admin/suppliers/{supplier_id}/projects", dependencies=[Depends(require_admin_pin)])
async def add_supplier_project(supplier_id: str, body: SupplierProjectBody):
    """Mulai Projek baru buat supplier ini -- unit yang ditambah sesudah ini
    otomatis masuk ke Projek baru ini (jadi yang paling baru = aktif)."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    doc = await _ensure_supplier_projects(doc)
    projects = doc.get("projects") or []
    nama = body.nama.strip() or f"Projek {len(projects) + 1}"
    new_proj = {
        "id": _gen_supplier_id(), "nama": nama, "status": "open",
        "created_at": datetime.utcnow().isoformat(), "closed_at": None,
    }
    projects = projects + [new_proj]
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"projects": projects}})
    return new_proj


@api_router.patch("/admin/suppliers/{supplier_id}/projects/{project_id}/close", dependencies=[Depends(require_admin_pin)])
async def close_supplier_project(supplier_id: str, project_id: str):
    """Tutup Projek (ditandai Lunas/selesai) -- bisa dipaksa walau masih ada
    sisa pembayaran (kesepakatan khusus admin)."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    projects = doc.get("projects") or []
    idx = next((i for i, p in enumerate(projects) if p.get("id") == project_id), None)
    if idx is None:
        raise HTTPException(404, "Projek tidak ditemukan")
    projects[idx]["status"] = "closed"
    projects[idx]["closed_at"] = datetime.utcnow().isoformat()
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"projects": projects}})
    return {"ok": True}


@api_router.patch("/admin/suppliers/{supplier_id}/projects/{project_id}/reopen", dependencies=[Depends(require_admin_pin)])
async def reopen_supplier_project(supplier_id: str, project_id: str):
    """Buka lagi Projek yang kadung ke-close (misal kepencet salah)."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    projects = doc.get("projects") or []
    idx = next((i for i, p in enumerate(projects) if p.get("id") == project_id), None)
    if idx is None:
        raise HTTPException(404, "Projek tidak ditemukan")
    projects[idx]["status"] = "open"
    projects[idx]["closed_at"] = None
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"projects": projects}})
    return {"ok": True}


@api_router.patch("/admin/suppliers/{supplier_id}/projects/{project_id}/rename", dependencies=[Depends(require_admin_pin)])
async def rename_supplier_project(supplier_id: str, project_id: str, body: SupplierProjectBody):
    """Ganti nama Projek (input manual). Nama kosong -> tolak biar nggak jadi blank."""
    nama = (body.nama or "").strip()
    if not nama:
        raise HTTPException(400, "Nama projek tidak boleh kosong")
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    projects = doc.get("projects") or []
    idx = next((i for i, p in enumerate(projects) if p.get("id") == project_id), None)
    if idx is None:
        raise HTTPException(404, "Projek tidak ditemukan")
    projects[idx]["nama"] = nama[:80]
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"projects": projects}})
    return projects[idx]


@api_router.get("/admin/suppliers/pricelist", dependencies=[Depends(require_admin_pin)])
async def supplier_pricelist(limit: int = 3000):
    """Daftar Harga: semua job supplier yang sudah LUNAS (sisa<=0 & ada harga)
    -> referensi harga aktual per rute (HPP). Dicari asal/tujuan di frontend."""
    out = []
    async for s in db.supplier_profiles.find({}, {"_id": 0}):
        snama = s.get("nama") or "-"
        for j in (s.get("jobs") or []):
            jt = _supplier_job_totals(j)
            total = jt.get("total_harga") or 0
            if total <= 0 or (jt.get("sisa") or 0) > 0:
                continue  # cuma yang LUNAS & ada harganya
            asal = (j.get("asal_kota") or "").strip()
            tuj = (j.get("tujuan_kota") or "").strip()
            out.append({
                "supplier_id": s.get("id"), "supplier_nama": snama,
                "job_id": j.get("id"),
                "asal": asal, "tujuan": tuj, "rute": _rute_str(asal, tuj),
                "vehicle_type": j.get("vehicle_type") or "",
                "nopol": j.get("nopol") or "",
                "harga": total,
                "tanggal": j.get("tanggal") or j.get("created_at") or "",
            })
    out.sort(key=lambda x: x.get("tanggal") or "", reverse=True)
    return {"items": out[:limit]}


@api_router.post("/admin/suppliers/{supplier_id}/jobs/{job_id}/payments", dependencies=[Depends(require_admin_pin)])
async def add_supplier_payment(
    supplier_id: str, job_id: str,
    amount: int = Form(...), catatan: str = Form(""),
    tanggal: Optional[str] = Form(None),
    tipe: str = Form("transfer"),   # "transfer" (cash) | "kompensasi" (supplier kirim unit sbg pengganti bayar)
    kompensasi_vehicle_type: str = Form(""),
    kompensasi_no_unit: str = Form(""),   # no pol / no rangka unit yg dikirim buat kompensasi
    kompensasi_asal_kota: str = Form(""),
    kompensasi_tujuan_kota: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """Catat 1 pembayaran (DP/cicilan) ke job/unit ini -- bisa transfer cash
    biasa, atau 'kompensasi' (supplier kirim unit/mobil ke kita sbg pengganti
    bayar, nilainya dipakai buat ngurangin sisa persis kayak transfer cash).
    Upload bukti opsional. Sisa otomatis kehitung ulang di response (nggak
    disimpan sbg field terpisah, biar nggak pernah nyimpang dari data
    payments yang beneran ada)."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    job_idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if job_idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    if amount <= 0:
        raise HTTPException(400, "amount harus lebih dari 0")
    tipe = tipe.strip().lower() if tipe.strip().lower() in ("transfer", "kompensasi") else "transfer"

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(supplier_id, f"payment/{job_id}", bukti, ALLOWED_IMG | ALLOWED_DOC)

    # Tanggal default = hari ini (WIB), tapi admin bisa pilih tanggal lain manual
    # (misal input telat / bayar beberapa hari lalu) lewat date picker di frontend.
    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    payment = {
        "id": _gen_supplier_id(),
        "amount": amount,
        "catatan": catatan.strip(),
        "bukti_url": bukti_url,
        "tanggal": tgl,
        "tipe": tipe,
    }
    if tipe == "kompensasi":
        payment["kompensasi_unit"] = {
            "vehicle_type": kompensasi_vehicle_type.strip(),
            "no_unit": kompensasi_no_unit.strip().upper(),
            "asal_kota": kompensasi_asal_kota.strip(),
            "tujuan_kota": kompensasi_tujuan_kota.strip(),
        }
    # Update seluruh array `jobs` sekaligus (bukan pakai positional operator
    # $ di nested array) -- lebih portable & nggak bergantung ke edge-case
    # implementasi $push/$pull nested tiap driver Mongo/mock.
    jobs[job_idx].setdefault("payments", []).append(payment)
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[job_idx])


@api_router.delete("/admin/suppliers/{supplier_id}/jobs/{job_id}/payments/{payment_id}", dependencies=[Depends(require_admin_pin)])
async def delete_supplier_payment(supplier_id: str, job_id: str, payment_id: str):
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    job_idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if job_idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    before = len(jobs[job_idx].get("payments") or [])
    jobs[job_idx]["payments"] = [p for p in (jobs[job_idx].get("payments") or []) if p.get("id") != payment_id]
    if len(jobs[job_idx]["payments"]) == before:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[job_idx])


@api_router.post("/admin/suppliers/{supplier_id}/payments/{txn_key}/bukti", dependencies=[Depends(require_admin_pin)])
async def attach_supplier_payment_bukti(
    supplier_id: str, txn_key: str,
    bukti: UploadFile = File(...),
):
    """Tempel / ganti bukti transfer ke pembayaran yang SUDAH tercatat (misal admin
    telat upload). `txn_key` = batch_id (kalau pembayaran 1 transaksi ke banyak unit)
    atau id payment tunggal. Bukti dipasang ke SEMUA baris payment yang cocok, biar
    satu transaksi tetap punya satu bukti yang sama. Data/nominal tidak diubah."""
    if not bukti or not bukti.filename:
        raise HTTPException(400, "File bukti wajib diisi")
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    # cari dulu ada nggak payment yang cocok (batch_id atau id == txn_key)
    matched = any(
        (p.get("batch_id") == txn_key or p.get("id") == txn_key)
        for j in jobs for p in (j.get("payments") or [])
    )
    if not matched:
        raise HTTPException(404, "Transaksi pembayaran tidak ditemukan")
    bukti_url = _save_upload(supplier_id, f"payment/{txn_key}", bukti, ALLOWED_IMG | ALLOWED_DOC)
    n = 0
    for j in jobs:
        for p in (j.get("payments") or []):
            if p.get("batch_id") == txn_key or p.get("id") == txn_key:
                p["bukti_url"] = bukti_url
                n += 1
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return {"ok": True, "bukti_url": bukti_url, "updated": n}


@api_router.post("/admin/suppliers/{supplier_id}/jobs/{job_id}/tambahan", dependencies=[Depends(require_admin_pin)])
async def add_supplier_job_tambahan(supplier_id: str, job_id: str, body: dict = Body(...)):
    """Tambah 1 biaya tambahan ke unit (keterangan free-text + nominal). Boleh lebih
    dari satu per unit. Disimpan TERPISAH dari harga deal (tidak menimpa). Nambah
    tagihan: total & sisa unit otomatis ikut naik. Histori payment tidak disentuh."""
    label = str(body.get("label") or "").strip()
    try:
        amount = int(body.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0
    if not label:
        raise HTTPException(400, "Keterangan biaya tambahan wajib diisi")
    if amount <= 0:
        raise HTTPException(400, "Nominal harus lebih dari 0")
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    item = {"id": _gen_supplier_id(), "label": label[:80], "amount": amount, "created_at": datetime.utcnow().isoformat()}
    jobs[idx].setdefault("tambahan", []).append(item)
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[idx])


@api_router.delete("/admin/suppliers/{supplier_id}/jobs/{job_id}/tambahan/{tambahan_id}", dependencies=[Depends(require_admin_pin)])
async def delete_supplier_job_tambahan(supplier_id: str, job_id: str, tambahan_id: str):
    """Hapus 1 biaya tambahan dari unit. Harga deal & histori payment tidak berubah."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = doc.get("jobs") or []
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if idx is None:
        raise HTTPException(404, "Unit/job tidak ditemukan")
    before = len(jobs[idx].get("tambahan") or [])
    jobs[idx]["tambahan"] = [t for t in (jobs[idx].get("tambahan") or []) if t.get("id") != tambahan_id]
    if len(jobs[idx]["tambahan"]) == before:
        raise HTTPException(404, "Biaya tambahan tidak ditemukan")
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"jobs": jobs}})
    return _supplier_job_totals(jobs[idx])


@api_router.get("/admin/suppliers/{supplier_id}/ringkasan")
async def supplier_ringkasan_data(supplier_id: str, pin: str = Query(...)):
    """Data buat halaman kartu Ringkasan Pembayaran (dirender Chromium headless
    jadi gambar). PIN dikirim lewat query karena yang manggil endpoint ini
    cuma browser headless internal (lihat supplier_ringkasan_image di bawah),
    bukan dari browser admin langsung -- makanya nggak lewat header X-Admin-Pin
    kayak endpoint admin lain."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected or pin.strip() != expected:
        raise HTTPException(401, "Invalid PIN")
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    jobs = [_supplier_job_totals(j) for j in (doc.get("jobs") or [])]
    doc["jobs"] = jobs
    doc["grand_total_harga"] = sum(j.get("total_harga") or 0 for j in jobs)
    doc["grand_total_terbayar"] = sum(j.get("total_terbayar") or 0 for j in jobs)
    doc["grand_sisa"] = sum(j.get("sisa") or 0 for j in jobs)
    return doc


@api_router.get("/admin/suppliers/{supplier_id}/ringkasan/image", dependencies=[Depends(require_admin_pin)])
async def supplier_ringkasan_image(supplier_id: str, x_admin_pin: str = Header(..., alias="X-Admin-Pin")):
    """Render kartu Ringkasan Pembayaran (frontend page) jadi PNG lewat Chromium
    headless -- sama seperti pola BASTK PDF, supaya hasilnya konsisten (bukan
    screenshot manual device driver) dan gampang dikirim ke WA/supplier."""
    doc = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Supplier tidak ditemukan")
    if not FRONTEND_URL:
        raise HTTPException(
            503,
            "FRONTEND_URL belum diset di backend. Set di Railway dashboard (backend "
            "service -> Variables) sebagai Reference Variable: "
            "FRONTEND_URL=https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}",
        )
    if _browser is None:
        raise HTTPException(503, "Generator gambar belum siap (Chromium gagal start saat startup).")

    page = await _browser.new_page(viewport={"width": 640, "height": 1200}, device_scale_factor=2)
    try:
        await page.goto(
            f"{FRONTEND_URL}/supplier-ringkasan/{supplier_id}?pin={x_admin_pin}",
            wait_until="networkidle", timeout=30_000,
        )
        await page.wait_for_selector('[data-testid="ringkasan-ready"]', timeout=15_000)
        await page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
        await page.wait_for_timeout(150)
        card = page.locator('[data-testid="ringkasan-card"]')
        img_bytes = await card.screenshot(type="png")
    except Exception as e:
        logger.error(f"[ringkasan] gagal render untuk supplier {supplier_id}: {e}")
        raise HTTPException(500, "Gagal membuat ringkasan, coba lagi.")
    finally:
        await page.close()

    fname = "".join(c for c in (doc.get("nama") or "supplier") if c.isalnum() or c in " -_").strip() or "supplier"
    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="Ringkasan-{fname}.png"'},
    )


# ══════════════════════════════════════════════════════
# SELISIH HARGA SYSTEM (harga di-upping pas invoice — selisih antara
# Harga Deal & Harga Invoice punya PIC purchasing, ditransfer balik ke
# PIC itu). Dicari/dibuat per nama PIC (kayak Supplier), tapi dikelompokkan
# per Tagihan (No Invoice) -- lunas/belum-nya dihitung per Tagihan, bukan
# gabungan semua tagihan kayak grand total Supplier.
# ══════════════════════════════════════════════════════

def _gen_selisih_id() -> str:
    return uuid.uuid4().hex[:8]


def _selisih_item_totals(item: dict) -> dict:
    item = dict(item)
    item["selisih"] = (item.get("harga_invoice") or 0) - (item.get("harga_deal") or 0)
    return item


def _selisih_tagihan_totals(tagihan: dict) -> dict:
    """Hitung total_selisih (dari semua item), total_terbayar & sisa (dari
    payments) -- semuanya dihitung ulang tiap read, nggak disimpan."""
    tagihan = dict(tagihan)
    items = [_selisih_item_totals(i) for i in (tagihan.get("items") or [])]
    tagihan["items"] = items
    total_selisih = sum(i["selisih"] for i in items)
    terbayar = sum((p.get("amount") or 0) for p in (tagihan.get("payments") or []))
    tagihan["total_selisih"] = total_selisih
    tagihan["total_terbayar"] = terbayar
    tagihan["sisa"] = total_selisih - terbayar
    tagihan["lunas"] = len(items) > 0 and tagihan["sisa"] <= 0
    return tagihan


class SelisihCreateBody(BaseModel):
    nama: str      # nama PIC/orang purchasing
    no_hp: str = ""
    catatan: str = ""


class SelisihPatchBody(BaseModel):
    no_hp: Optional[str] = None
    catatan: Optional[str] = None


class SelisihTagihanBody(BaseModel):
    no_invoice: str = ""
    catatan: str = ""


class SelisihItemBody(BaseModel):
    vehicle_type: str = ""
    no_unit: str = ""       # no pol ATAU no rangka, satu field bebas isi
    asal_kota: str = ""
    tujuan_kota: str = ""
    harga_deal: int = 0
    harga_invoice: int = 0


@api_router.post("/admin/selisih", dependencies=[Depends(require_admin_pin)])
async def create_selisih_pic(body: SelisihCreateBody):
    """Create PIC baru, atau return yang udah ada (case-insensitive by nama)."""
    import re as _re
    nama = body.nama.strip()
    if not nama:
        raise HTTPException(400, "nama tidak boleh kosong")
    existing = await db.selisih_profiles.find_one(
        {"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)},
        {"_id": 0},
    )
    if existing:
        return existing
    doc = {
        "id": _gen_selisih_id(),
        "nama": nama,
        "no_hp": body.no_hp.strip(),
        "catatan": body.catatan.strip(),
        "created_at": datetime.utcnow().isoformat(),
        "tagihan": [],
    }
    await db.selisih_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/admin/selisih", dependencies=[Depends(require_admin_pin)])
async def list_selisih_pic(q: Optional[str] = None):
    import re as _re
    filt = {}
    if q:
        filt["nama"] = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
    items = []
    async for s in db.selisih_profiles.find(filt).sort("nama", 1):
        s.pop("_id", None)
        tagihan = [_selisih_tagihan_totals(t) for t in (s.get("tagihan") or [])]
        s["grand_total_selisih"] = sum(t["total_selisih"] for t in tagihan)
        s["grand_total_terbayar"] = sum(t["total_terbayar"] for t in tagihan)
        s["grand_sisa"] = sum(t["sisa"] for t in tagihan)
        s["jumlah_tagihan"] = len(tagihan)
        s.pop("tagihan", None)
        items.append(s)
    return {"count": len(items), "items": items}


@api_router.get("/admin/selisih/{pic_id}", dependencies=[Depends(require_admin_pin)])
async def get_selisih_pic(pic_id: str):
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan = [_selisih_tagihan_totals(t) for t in (doc.get("tagihan") or [])]
    doc["tagihan"] = tagihan
    doc["grand_total_selisih"] = sum(t["total_selisih"] for t in tagihan)
    doc["grand_total_terbayar"] = sum(t["total_terbayar"] for t in tagihan)
    doc["grand_sisa"] = sum(t["sisa"] for t in tagihan)
    return doc


@api_router.patch("/admin/selisih/{pic_id}", dependencies=[Depends(require_admin_pin)])
async def patch_selisih_pic(pic_id: str, body: SelisihPatchBody):
    upd = {}
    if body.no_hp is not None: upd["no_hp"] = body.no_hp.strip()
    if body.catatan is not None: upd["catatan"] = body.catatan.strip()
    if not upd:
        raise HTTPException(400, "Tidak ada field yang diupdate")
    res = await db.selisih_profiles.update_one({"id": pic_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "PIC tidak ditemukan")
    return {"ok": True}


@api_router.delete("/admin/selisih/{pic_id}", dependencies=[Depends(require_admin_pin)])
async def delete_selisih_pic(pic_id: str):
    result = await db.selisih_profiles.delete_one({"id": pic_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "PIC tidak ditemukan")
    return {"ok": True}


@api_router.post("/admin/selisih/{pic_id}/tagihan", dependencies=[Depends(require_admin_pin)])
async def add_selisih_tagihan(pic_id: str, body: SelisihTagihanBody):
    """Tagihan = 1 No Invoice, isinya bisa beberapa unit/pengiriman (item).
    Lunas/belumnya dihitung per Tagihan ini, bukan gabungan semua tagihan."""
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan = {
        "id": _gen_selisih_id(),
        "no_invoice": body.no_invoice.strip(),
        "catatan": body.catatan.strip(),
        "created_at": datetime.utcnow().isoformat(),
        "items": [],
        "payments": [],
    }
    await db.selisih_profiles.update_one({"id": pic_id}, {"$push": {"tagihan": tagihan}})
    return _selisih_tagihan_totals(tagihan)


@api_router.delete("/admin/selisih/{pic_id}/tagihan/{tagihan_id}", dependencies=[Depends(require_admin_pin)])
async def delete_selisih_tagihan(pic_id: str, tagihan_id: str):
    result = await db.selisih_profiles.update_one(
        {"id": pic_id}, {"$pull": {"tagihan": {"id": tagihan_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(404, "Tagihan tidak ditemukan")
    return {"ok": True}


@api_router.post("/admin/selisih/{pic_id}/tagihan/{tagihan_id}/items", dependencies=[Depends(require_admin_pin)])
async def add_selisih_item(pic_id: str, tagihan_id: str, body: SelisihItemBody):
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan_list = doc.get("tagihan") or []
    idx = next((i for i, t in enumerate(tagihan_list) if t.get("id") == tagihan_id), None)
    if idx is None:
        raise HTTPException(404, "Tagihan tidak ditemukan")
    item = {
        "id": _gen_selisih_id(),
        "vehicle_type": body.vehicle_type.strip(),
        "no_unit": body.no_unit.strip().upper(),
        "asal_kota": body.asal_kota.strip(),
        "tujuan_kota": body.tujuan_kota.strip(),
        "harga_deal": body.harga_deal,
        "harga_invoice": body.harga_invoice,
    }
    tagihan_list[idx].setdefault("items", []).append(item)
    await db.selisih_profiles.update_one({"id": pic_id}, {"$set": {"tagihan": tagihan_list}})
    return _selisih_tagihan_totals(tagihan_list[idx])


@api_router.delete("/admin/selisih/{pic_id}/tagihan/{tagihan_id}/items/{item_id}", dependencies=[Depends(require_admin_pin)])
async def delete_selisih_item(pic_id: str, tagihan_id: str, item_id: str):
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan_list = doc.get("tagihan") or []
    idx = next((i for i, t in enumerate(tagihan_list) if t.get("id") == tagihan_id), None)
    if idx is None:
        raise HTTPException(404, "Tagihan tidak ditemukan")
    before = len(tagihan_list[idx].get("items") or [])
    tagihan_list[idx]["items"] = [i for i in (tagihan_list[idx].get("items") or []) if i.get("id") != item_id]
    if len(tagihan_list[idx]["items"]) == before:
        raise HTTPException(404, "Unit tidak ditemukan")
    await db.selisih_profiles.update_one({"id": pic_id}, {"$set": {"tagihan": tagihan_list}})
    return _selisih_tagihan_totals(tagihan_list[idx])


@api_router.post("/admin/selisih/{pic_id}/tagihan/{tagihan_id}/payments", dependencies=[Depends(require_admin_pin)])
async def add_selisih_payment(
    pic_id: str, tagihan_id: str,
    amount: int = Form(...), catatan: str = Form(""),
    tanggal: Optional[str] = Form(None),
    bukti: Optional[UploadFile] = File(None),
):
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan_list = doc.get("tagihan") or []
    idx = next((i for i, t in enumerate(tagihan_list) if t.get("id") == tagihan_id), None)
    if idx is None:
        raise HTTPException(404, "Tagihan tidak ditemukan")
    if amount <= 0:
        raise HTTPException(400, "amount harus lebih dari 0")

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(pic_id, f"selisih/{tagihan_id}", bukti, ALLOWED_IMG | ALLOWED_DOC)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    payment = {
        "id": _gen_selisih_id(),
        "amount": amount,
        "catatan": catatan.strip(),
        "bukti_url": bukti_url,
        "tanggal": tgl,
    }
    tagihan_list[idx].setdefault("payments", []).append(payment)
    await db.selisih_profiles.update_one({"id": pic_id}, {"$set": {"tagihan": tagihan_list}})
    return _selisih_tagihan_totals(tagihan_list[idx])


@api_router.post("/admin/selisih/{pic_id}/pay-batch", dependencies=[Depends(require_admin_pin)])
async def selisih_pay_batch(
    pic_id: str,
    tagihan_ids: str = Form(...),        # id tagihan dipisah koma, urutan = urutan bayar
    amount: int = Form(...),
    tanggal: Optional[str] = Form(None),
    catatan: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """Bayar beberapa tagihan selisih SATU PIC sekaligus dgn 1 nominal (kaya tools
    Supplier). Nominal didistribusi berurutan (waterfall): tiap tagihan dibayar
    min(sisa nominal, sisa tagihan) sampai nominal habis; tidak overpay. Bukti &
    tanggal sama dipakai utk semua cicilan (ditandai batch_id). Calculation selisih
    tidak berubah — cuma nambah record payment."""
    if amount <= 0:
        raise HTTPException(400, "Nominal harus lebih dari 0")
    ids = [x.strip() for x in (tagihan_ids or "").split(",") if x.strip()]
    if not ids:
        raise HTTPException(400, "Pilih minimal 1 tagihan")
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan_list = doc.get("tagihan") or []

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(pic_id, "selisih/batch", bukti, ALLOWED_IMG | ALLOWED_DOC)

    batch_id = _gen_selisih_id()
    remaining = int(amount)
    applied = []
    for tid in ids:
        if remaining <= 0:
            break
        idx = next((i for i, t in enumerate(tagihan_list) if t.get("id") == tid), None)
        if idx is None:
            continue
        sisa = _selisih_tagihan_totals(tagihan_list[idx]).get("sisa") or 0
        if sisa <= 0:
            continue
        pay_amt = min(remaining, sisa)
        payment = {
            "id": _gen_selisih_id(), "amount": int(pay_amt),
            "catatan": (catatan or "").strip()[:300], "bukti_url": bukti_url,
            "tanggal": tgl, "batch_id": batch_id, "source": "admin-batch",
        }
        tagihan_list[idx].setdefault("payments", []).append(payment)
        remaining -= pay_amt
        njt = _selisih_tagihan_totals(tagihan_list[idx])
        applied.append({
            "tagihan_id": tid, "no_invoice": tagihan_list[idx].get("no_invoice") or "",
            "dibayar": int(pay_amt), "sisa": njt.get("sisa") or 0,
            "lunas": (njt.get("sisa") or 0) <= 0,
        })
    if not applied:
        raise HTTPException(400, "Tidak ada tagihan yang bisa dibayar (mungkin sudah lunas)")
    await db.selisih_profiles.update_one({"id": pic_id}, {"$set": {"tagihan": tagihan_list}})
    return {
        "ok": True, "pic_id": pic_id, "batch_id": batch_id,
        "total_dibayar": int(amount) - remaining, "sisa_nominal": remaining, "applied": applied,
    }


@api_router.delete("/admin/selisih/{pic_id}/tagihan/{tagihan_id}/payments/{payment_id}", dependencies=[Depends(require_admin_pin)])
async def delete_selisih_payment(pic_id: str, tagihan_id: str, payment_id: str):
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan_list = doc.get("tagihan") or []
    idx = next((i for i, t in enumerate(tagihan_list) if t.get("id") == tagihan_id), None)
    if idx is None:
        raise HTTPException(404, "Tagihan tidak ditemukan")
    before = len(tagihan_list[idx].get("payments") or [])
    tagihan_list[idx]["payments"] = [p for p in (tagihan_list[idx].get("payments") or []) if p.get("id") != payment_id]
    if len(tagihan_list[idx]["payments"]) == before:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    await db.selisih_profiles.update_one({"id": pic_id}, {"$set": {"tagihan": tagihan_list}})
    return _selisih_tagihan_totals(tagihan_list[idx])


@api_router.get("/admin/selisih/{pic_id}/ringkasan")
async def selisih_ringkasan_data(pic_id: str, pin: str = Query(...)):
    """Data buat kartu Ringkasan Selisih Harga (dirender Chromium headless jadi
    gambar). PIN lewat query karena cuma dipanggil browser headless internal,
    sama polanya kayak supplier_ringkasan_data."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected or pin.strip() != expected:
        raise HTTPException(401, "Invalid PIN")
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    tagihan = [_selisih_tagihan_totals(t) for t in (doc.get("tagihan") or [])]
    doc["tagihan"] = tagihan
    doc["grand_total_selisih"] = sum(t["total_selisih"] for t in tagihan)
    doc["grand_total_terbayar"] = sum(t["total_terbayar"] for t in tagihan)
    doc["grand_sisa"] = sum(t["sisa"] for t in tagihan)
    return doc


@api_router.get("/admin/selisih/{pic_id}/ringkasan/image", dependencies=[Depends(require_admin_pin)])
async def selisih_ringkasan_image(pic_id: str, x_admin_pin: str = Header(..., alias="X-Admin-Pin")):
    """Render kartu Ringkasan Selisih Harga jadi PNG lewat Chromium headless --
    sama pola kayak supplier_ringkasan_image."""
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    if not FRONTEND_URL:
        raise HTTPException(
            503,
            "FRONTEND_URL belum diset di backend. Set di Railway dashboard (backend "
            "service -> Variables) sebagai Reference Variable: "
            "FRONTEND_URL=https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}",
        )
    if _browser is None:
        raise HTTPException(503, "Generator gambar belum siap (Chromium gagal start saat startup).")

    page = await _browser.new_page(viewport={"width": 640, "height": 1200}, device_scale_factor=2)
    try:
        await page.goto(
            f"{FRONTEND_URL}/selisih-ringkasan/{pic_id}?pin={x_admin_pin}",
            wait_until="networkidle", timeout=30_000,
        )
        await page.wait_for_selector('[data-testid="ringkasan-ready"]', timeout=15_000)
        await page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
        await page.wait_for_timeout(150)
        card = page.locator('[data-testid="ringkasan-card"]')
        img_bytes = await card.screenshot(type="png")
    except Exception as e:
        logger.error(f"[ringkasan] gagal render untuk PIC {pic_id}: {e}")
        raise HTTPException(500, "Gagal membuat ringkasan, coba lagi.")
    finally:
        await page.close()

    fname = "".join(c for c in (doc.get("nama") or "pic") if c.isalnum() or c in " -_").strip() or "pic"
    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="Ringkasan-Selisih-{fname}.png"'},
    )


@api_router.get("/admin/selisih/{pic_id}/ringkasan/pdf", dependencies=[Depends(require_admin_pin)])
async def selisih_ringkasan_pdf(pic_id: str, x_admin_pin: str = Header(..., alias="X-Admin-Pin")):
    """Render Ringkasan Selisih Harga jadi PDF A4 (paginasi rapi, teks vektor) --
    kaya laporan lain (Penawaran/Supplier), bukan PNG panjang."""
    doc = await db.selisih_profiles.find_one({"id": pic_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "PIC tidak ditemukan")
    if not FRONTEND_URL:
        raise HTTPException(503, "FRONTEND_URL belum diset di backend (Railway -> Variables).")
    if _browser is None:
        raise HTTPException(503, "Generator PDF belum siap (Chromium gagal start saat startup).")

    page = await _browser.new_page()
    try:
        await page.goto(
            f"{FRONTEND_URL}/selisih-ringkasan/{pic_id}?pin={x_admin_pin}",
            wait_until="networkidle", timeout=30_000,
        )
        await page.wait_for_selector('[data-testid="ringkasan-ready"]', timeout=15_000)
        await page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
        await page.emulate_media(media="print")
        await page.wait_for_timeout(200)
        pdf_bytes = await page.pdf(
            format="A4",
            print_background=True,
            margin={"top": "6mm", "bottom": "6mm", "left": "6mm", "right": "6mm"},
        )
    except Exception as e:
        logger.error(f"[selisih-pdf] gagal render PDF untuk PIC {pic_id}: {e}")
        raise HTTPException(500, "Gagal membuat PDF, coba lagi.")
    finally:
        await page.close()

    fname = "".join(c for c in (doc.get("nama") or "pic") if c.isalnum() or c in " -_").strip() or "pic"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="Ringkasan-Selisih-{fname}.pdf"'},
    )


# ══════════════════════════════════════════════════════
# KOMPENSASI HUTANG PIUTANG SYSTEM (netting utang-piutang 2 arah antara kita
# & 1 rekanan -- misal saling kirim unit/invoice, lalu diselisihkan jadi 1
# angka "sisa kewajiban", kayak surat pengajuan kompensasi hutang piutang.
# Beda sama Supplier (yg cuma 1 arah: kita berutang ke supplier) -- di sini
# dicatat 2 rincian: kewajiban KITA ke rekanan, & kewajiban REKANAN ke kita,
# lalu di-net.
# ══════════════════════════════════════════════════════

def _gen_kompensasi_id() -> str:
    return uuid.uuid4().hex[:8]


def _kompensasi_totals(doc: dict) -> dict:
    """Hitung total_kita (kewajiban kita ke rekanan), total_mereka (kewajiban
    rekanan ke kita), dikurangi pembayaran yang udah tercatat di masing-masing
    arah, lalu sisa (net, positif = rekanan masih berkewajiban ke kita) --
    dihitung ulang tiap read, nggak disimpan."""
    doc = dict(doc)
    items = doc.get("items") or []
    payments = doc.get("payments") or []
    total_kita = sum((i.get("nilai") or 0) for i in items if i.get("arah") == "kita_ke_mereka")
    total_mereka = sum((i.get("nilai") or 0) for i in items if i.get("arah") == "mereka_ke_kita")
    dibayar_kita = sum((p.get("jumlah") or 0) for p in payments if p.get("arah") == "kita_bayar_mereka")
    dibayar_mereka = sum((p.get("jumlah") or 0) for p in payments if p.get("arah") == "mereka_bayar_kita")
    outstanding_kita = total_kita - dibayar_kita
    outstanding_mereka = total_mereka - dibayar_mereka
    doc["total_kita"] = total_kita
    doc["total_mereka"] = total_mereka
    doc["dibayar_kita"] = dibayar_kita
    doc["dibayar_mereka"] = dibayar_mereka
    doc["outstanding_kita"] = outstanding_kita
    doc["outstanding_mereka"] = outstanding_mereka
    doc["sisa"] = outstanding_mereka - outstanding_kita
    return doc


class KompensasiCreateBody(BaseModel):
    nama: str      # nama rekanan/pihak
    no_hp: str = ""
    catatan: str = ""


class KompensasiPatchBody(BaseModel):
    no_hp: Optional[str] = None
    catatan: Optional[str] = None


@api_router.post("/admin/kompensasi", dependencies=[Depends(require_admin_pin)])
async def create_kompensasi_pihak(body: KompensasiCreateBody):
    """Create rekanan baru, atau return yang udah ada (case-insensitive by nama)."""
    import re as _re
    nama = body.nama.strip()
    if not nama:
        raise HTTPException(400, "nama tidak boleh kosong")
    existing = await db.kompensasi_profiles.find_one(
        {"nama": _re.compile(r"^\s*" + _re.escape(nama) + r"\s*$", _re.IGNORECASE)},
        {"_id": 0},
    )
    if existing:
        return existing
    doc = {
        "id": _gen_kompensasi_id(),
        "nama": nama,
        "no_hp": body.no_hp.strip(),
        "catatan": body.catatan.strip(),
        "created_at": datetime.utcnow().isoformat(),
        "items": [],
    }
    await db.kompensasi_profiles.insert_one(doc)
    doc.pop("_id", None)
    return doc


@api_router.get("/admin/kompensasi", dependencies=[Depends(require_admin_pin)])
async def list_kompensasi_pihak(q: Optional[str] = None):
    import re as _re
    filt = {}
    if q:
        filt["nama"] = _re.compile(_re.escape(q.strip()), _re.IGNORECASE)
    items = []
    async for s in db.kompensasi_profiles.find(filt).sort("nama", 1):
        s.pop("_id", None)
        s = _kompensasi_totals(s)
        s["jumlah_item"] = len(s.get("items") or [])
        s.pop("items", None)
        items.append(s)
    return {"count": len(items), "items": items}


@api_router.get("/admin/kompensasi/{pihak_id}", dependencies=[Depends(require_admin_pin)])
async def get_kompensasi_pihak(pihak_id: str):
    doc = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Rekanan tidak ditemukan")
    return _kompensasi_totals(doc)


@api_router.patch("/admin/kompensasi/{pihak_id}", dependencies=[Depends(require_admin_pin)])
async def patch_kompensasi_pihak(pihak_id: str, body: KompensasiPatchBody):
    upd = {}
    if body.no_hp is not None: upd["no_hp"] = body.no_hp.strip()
    if body.catatan is not None: upd["catatan"] = body.catatan.strip()
    if not upd:
        raise HTTPException(400, "Tidak ada field yang diupdate")
    res = await db.kompensasi_profiles.update_one({"id": pihak_id}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Rekanan tidak ditemukan")
    return {"ok": True}


@api_router.delete("/admin/kompensasi/{pihak_id}", dependencies=[Depends(require_admin_pin)])
async def delete_kompensasi_pihak(pihak_id: str):
    result = await db.kompensasi_profiles.delete_one({"id": pihak_id})
    if result.deleted_count == 0:
        raise HTTPException(404, "Rekanan tidak ditemukan")
    return {"ok": True}


@api_router.post("/admin/kompensasi/{pihak_id}/items", dependencies=[Depends(require_admin_pin)])
async def add_kompensasi_item(
    pihak_id: str,
    arah: str = Form(...),   # "kita_ke_mereka" | "mereka_ke_kita"
    tanggal: Optional[str] = Form(None),
    keterangan: str = Form(""),
    vehicle_type: str = Form(""),
    no_unit: str = Form(""),
    asal_kota: str = Form(""),
    tujuan_kota: str = Form(""),
    nilai: int = Form(...),
    catatan: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """1 baris rincian kompensasi -- 'kita_ke_mereka' = unit/kewajiban yang kita
    kirim/tanggung ke rekanan, 'mereka_ke_kita' = sebaliknya. Sisa dihitung
    otomatis dari selisih total kedua arah."""
    if arah not in ("kita_ke_mereka", "mereka_ke_kita"):
        raise HTTPException(400, "arah harus 'kita_ke_mereka' atau 'mereka_ke_kita'")
    if nilai <= 0:
        raise HTTPException(400, "nilai harus lebih dari 0")
    doc = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Rekanan tidak ditemukan")

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(pihak_id, "kompensasi", bukti, ALLOWED_IMG | ALLOWED_DOC)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    item = {
        "id": _gen_kompensasi_id(),
        "arah": arah,
        "tanggal": tgl,
        "keterangan": keterangan.strip(),
        "vehicle_type": vehicle_type.strip(),
        "no_unit": no_unit.strip().upper(),
        "asal_kota": asal_kota.strip(),
        "tujuan_kota": tujuan_kota.strip(),
        "nilai": nilai,
        "catatan": catatan.strip(),
        "bukti_url": bukti_url,
    }
    await db.kompensasi_profiles.update_one({"id": pihak_id}, {"$push": {"items": item}})
    updated = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    return _kompensasi_totals(updated)


@api_router.delete("/admin/kompensasi/{pihak_id}/items/{item_id}", dependencies=[Depends(require_admin_pin)])
async def delete_kompensasi_item(pihak_id: str, item_id: str):
    result = await db.kompensasi_profiles.update_one(
        {"id": pihak_id}, {"$pull": {"items": {"id": item_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(404, "Item tidak ditemukan")
    updated = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    return _kompensasi_totals(updated)


@api_router.post("/admin/kompensasi/{pihak_id}/payments", dependencies=[Depends(require_admin_pin)])
async def add_kompensasi_payment(
    pihak_id: str,
    arah: str = Form(...),   # "kita_bayar_mereka" | "mereka_bayar_kita"
    jumlah: int = Form(...),
    tanggal: Optional[str] = Form(None),
    catatan: str = Form(""),
    bukti: Optional[UploadFile] = File(None),
):
    """Catat pembayaran nyata (transfer) yang melunasi sebagian/semua sisa
    kewajiban di satu arah -- beda sama 'items' (yang mencatat rincian
    kewajiban/invoice), payment ini mengurangi outstanding di arah tsb."""
    if arah not in ("kita_bayar_mereka", "mereka_bayar_kita"):
        raise HTTPException(400, "arah harus 'kita_bayar_mereka' atau 'mereka_bayar_kita'")
    if jumlah <= 0:
        raise HTTPException(400, "jumlah harus lebih dari 0")
    doc = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Rekanan tidak ditemukan")

    bukti_url = None
    if bukti is not None and bukti.filename:
        bukti_url = _save_upload(pihak_id, "kompensasi-payment", bukti, ALLOWED_IMG | ALLOWED_DOC)

    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today_wib()

    payment = {
        "id": _gen_kompensasi_id(),
        "arah": arah,
        "jumlah": jumlah,
        "tanggal": tgl,
        "catatan": catatan.strip(),
        "bukti_url": bukti_url,
        "created_at": datetime.utcnow().isoformat(),
    }
    await db.kompensasi_profiles.update_one({"id": pihak_id}, {"$push": {"payments": payment}})
    updated = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    return _kompensasi_totals(updated)


@api_router.delete("/admin/kompensasi/{pihak_id}/payments/{payment_id}", dependencies=[Depends(require_admin_pin)])
async def delete_kompensasi_payment(pihak_id: str, payment_id: str):
    result = await db.kompensasi_profiles.update_one(
        {"id": pihak_id}, {"$pull": {"payments": {"id": payment_id}}}
    )
    if result.modified_count == 0:
        raise HTTPException(404, "Pembayaran tidak ditemukan")
    updated = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    return _kompensasi_totals(updated)


@api_router.get("/admin/kompensasi/{pihak_id}/ringkasan")
async def kompensasi_ringkasan_data(pihak_id: str, pin: str = Query(...)):
    """Data buat kartu Ringkasan Kompensasi (dirender Chromium headless jadi
    gambar). PIN lewat query karena cuma dipanggil browser headless internal,
    sama polanya kayak supplier/selisih ringkasan."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected or pin.strip() != expected:
        raise HTTPException(401, "Invalid PIN")
    doc = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Rekanan tidak ditemukan")
    return _kompensasi_totals(doc)


@api_router.get("/admin/kompensasi/{pihak_id}/ringkasan/image", dependencies=[Depends(require_admin_pin)])
async def kompensasi_ringkasan_image(pihak_id: str, x_admin_pin: str = Header(..., alias="X-Admin-Pin")):
    """Render kartu Ringkasan Kompensasi jadi PNG lewat Chromium headless --
    sama pola kayak supplier/selisih ringkasan image."""
    doc = await db.kompensasi_profiles.find_one({"id": pihak_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Rekanan tidak ditemukan")
    if not FRONTEND_URL:
        raise HTTPException(
            503,
            "FRONTEND_URL belum diset di backend. Set di Railway dashboard (backend "
            "service -> Variables) sebagai Reference Variable: "
            "FRONTEND_URL=https://${{<nama-service-frontend>.RAILWAY_PUBLIC_DOMAIN}}",
        )
    if _browser is None:
        raise HTTPException(503, "Generator gambar belum siap (Chromium gagal start saat startup).")

    page = await _browser.new_page(viewport={"width": 640, "height": 1200}, device_scale_factor=2)
    try:
        await page.goto(
            f"{FRONTEND_URL}/kompensasi-ringkasan/{pihak_id}?pin={x_admin_pin}",
            wait_until="networkidle", timeout=30_000,
        )
        await page.wait_for_selector('[data-testid="ringkasan-ready"]', timeout=15_000)
        await page.evaluate("document.fonts ? document.fonts.ready : Promise.resolve()")
        await page.wait_for_timeout(150)
        card = page.locator('[data-testid="ringkasan-card"]')
        img_bytes = await card.screenshot(type="png")
    except Exception as e:
        logger.error(f"[ringkasan] gagal render kompensasi untuk {pihak_id}: {e}")
        raise HTTPException(500, "Gagal membuat ringkasan, coba lagi.")
    finally:
        await page.close()

    fname = "".join(c for c in (doc.get("nama") or "rekanan") if c.isalnum() or c in " -_").strip() or "rekanan"
    return Response(
        content=img_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="Ringkasan-Kompensasi-{fname}.png"'},
    )


# ---------- Static file serving for uploads ----------
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/api/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.include_router(api_router)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    if _browser is not None:
        await _browser.close()
    if _pw is not None:
        await _pw.stop()
