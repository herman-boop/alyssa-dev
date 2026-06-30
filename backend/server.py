from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form, Header, Depends, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os, logging, uuid, shutil, asyncio, io
import requests as _requests
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone, timedelta
from odoo_client import OdooClient

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

ALLOWED_IMG = {'.jpg', '.jpeg', '.png', '.webp', '.heic'}
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

    for w in warnings:
        logging.warning(w)


_validate_env_on_startup()

app = FastAPI()
api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)

# ----- Admin PIN guard (simple, env-driven) -----
def require_admin_pin(x_admin_pin: Optional[str] = Header(default=None, alias="X-Admin-Pin")) -> bool:
    """Require X-Admin-Pin header matching ADMIN_PIN env var. Empty env disables admin endpoints."""
    expected = (os.environ.get("ADMIN_PIN") or "").strip()
    if not expected:
        raise HTTPException(503, "Admin disabled (ADMIN_PIN env not set)")
    if not x_admin_pin or x_admin_pin.strip() != expected:
        raise HTTPException(401, "Invalid or missing admin PIN")
    return True


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

SUPABASE_URL    = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY    = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "fleet-photos").strip()

def _save_upload(trip_id: str, sub: str, file: UploadFile, allowed: set) -> str:
    ext = Path(file.filename or "").suffix.lower()
    if not ext or ext not in allowed:
        ext = MIME_TO_EXT.get((file.content_type or "").split(";")[0].strip().lower(), ext)
    if ext not in allowed:
        raise HTTPException(400, f"Format file tidak didukung: {file.content_type or ext}")

    fname = f"{uuid.uuid4().hex}{ext}"
    storage_path = f"{trip_id}/{sub}/{fname}"
    content_type = (file.content_type or "application/octet-stream").split(";")[0].strip()
    data = file.file.read()

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
        folder = UPLOAD_DIR / trip_id / sub
        folder.mkdir(parents=True, exist_ok=True)
        fpath = folder / fname
        with fpath.open("wb") as f:
            f.write(data)
        return f"/api/uploads/{trip_id}/{sub}/{fname}"


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
async def upload_resi(trip_id: str, foto: UploadFile = File(...)):
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    url = _save_upload(trip_id, "handover/resi", foto, ALLOWED_IMG | ALLOWED_DOC)
    entry = {"url": url, "ts": datetime.now(timezone.utc).isoformat()}
    await db.trips.update_one(
        {"trip_id": trip_id},
        {"$set": {"handover.resi": entry, "updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    await _maybe_notify_handover_complete(trip_id)
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
VALID_VEHICLE_TYPES = {
    # Tipe utama
    "Sedan", "MPV / SUV", "MPV / SUV Lainnya", "Pickup / Double Cabin",
    "Truck Box", "Truck Bak", "Dump Truck", "Truck Tangki", "Concrete Pump",
    "Fire Truck", "Motor", "Excavator", "Grader", "Dozer", "Vibro Roller",
    "Forklift", "Dump Crawler",
    # Toyota
    "Toyota Avanza", "Toyota Veloz", "Toyota Rush", "Toyota Fortuner",
    "Toyota Kijang Innova", "Toyota Innova Zenix", "Toyota Raize",
    "Toyota Yaris Cross", "Toyota Alphard", "Toyota Vellfire", "Toyota Hilux",
    # Daihatsu
    "Daihatsu Xenia", "Daihatsu Terios", "Daihatsu Rocky", "Daihatsu Sigra",
    "Daihatsu Ayla", "Daihatsu Gran Max",
    # Honda
    "Honda BR-V", "Honda HR-V", "Honda CR-V", "Honda Mobilio", "Honda Brio",
    "Honda WR-V", "Honda Pilot",
    # Mitsubishi
    "Mitsubishi Xpander", "Mitsubishi Xpander Cross", "Mitsubishi Pajero Sport",
    "Mitsubishi Outlander", "Mitsubishi Eclipse Cross", "Mitsubishi L300",
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
}
VALID_DAMAGE_CODES = {"RSK", "B", "P", "PC", "CL", "L"}


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
        if vt and vt not in VALID_VEHICLE_TYPES:
            raise HTTPException(400, f"vehicle_type tidak valid. Pilihan: {sorted(VALID_VEHICLE_TYPES)}")
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
@api_router.get("/public/trips/{trip_id}")
async def public_trip(trip_id: str):
    """Read-only view untuk pelanggan. Hanya field aman yang ter-expose."""
    doc = await db.trips.find_one({"trip_id": trip_id})
    if not doc:
        raise HTTPException(404, "Trip not found")
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


@api_router.get("/odoo/ping")
async def odoo_ping():
    """Diagnostic: report Odoo client status. Safe to call always.
    When env empty → enabled=false. When set → tries server.version() (no auth).
    """
    return OdooClient().ping()


# ---------- Customer Order Form (v2.6b) ----------
class OrderBody(BaseModel):
    # Kendaraan
    vehicle_type: str
    nopol: str = ""
    no_rangka: str = ""
    warna: str = ""
    tahun: str = ""
    km: str = ""
    kondisi: str = "Bekas"
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


@api_router.post("/orders")
async def create_order(payload: OrderBody):
    """Create a customer order (v2.6b). Validates + persists + fires Odoo webhook.
    Compatibility layer: returns order_id; does NOT auto-create trip yet (admin still triggers via PO).
    """
    vt = (payload.vehicle_type or "").strip()
    if vt and vt not in VALID_VEHICLE_TYPES:
        raise HTTPException(400, f"vehicle_type tidak valid. Pilihan: {sorted(VALID_VEHICLE_TYPES)}")
    if not (payload.asal_kota or "").strip():
        raise HTTPException(400, "asal_kota wajib diisi")
    if not (payload.tujuan_kota or "").strip():
        raise HTTPException(400, "tujuan_kota wajib diisi")
    if not (payload.customer_nama or "").strip():
        raise HTTPException(400, "customer_nama wajib diisi")
    if not (payload.customer_hp or "").strip():
        raise HTTPException(400, "customer_hp wajib diisi")

    order_id = f"ORD-{uuid.uuid4().hex[:10].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "order_id": order_id,
        "status": "NEW",                # NEW → CONFIRMED → DISPATCHED → COMPLETED → CANCELLED
        "vehicle_type": vt,
        "nopol": (payload.nopol or "").strip()[:20],
        "no_rangka": (payload.no_rangka or "").strip()[:40],
        "warna": (payload.warna or "").strip()[:40],
        "tahun": (payload.tahun or "").strip()[:6],
        "km": (payload.km or "").strip()[:12],
        "kondisi": (payload.kondisi or "Bekas").strip()[:20],
        "asal_kota": payload.asal_kota.strip()[:80],
        "asal_alamat": (payload.asal_alamat or "").strip()[:300],
        "pickup_date": (payload.pickup_date or "").strip()[:10],
        "pickup_time": (payload.pickup_time or "").strip()[:5],
        "pickup_pic": (payload.pickup_pic or "").strip()[:120],
        "pickup_hp": (payload.pickup_hp or "").strip()[:30],
        "tujuan_kota": payload.tujuan_kota.strip()[:80],
        "tujuan_alamat": (payload.tujuan_alamat or "").strip()[:300],
        "delivery_pic": (payload.delivery_pic or "").strip()[:120],
        "delivery_hp": (payload.delivery_hp or "").strip()[:30],
        "customer_nama": payload.customer_nama.strip()[:120],
        "customer_hp": payload.customer_hp.strip()[:30],
        "customer_email": (payload.customer_email or "").strip()[:120],
        "catatan": (payload.catatan or "").strip()[:500],
        "trip_id": None,                 # filled when admin converts order → trip
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
    return doc


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
    return doc


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
        items.append(d)
    return {"count": len(items), "items": items}


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
            "pic":     (order.get("delivery_pic") or order.get("pickup_pic") or "")[:120],
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


def _odoo_line_desc(order: dict, order_id: str, trip_id: str) -> str:
    """Build a human-readable order-line description from the customer's real input."""
    route = f"{order.get('asal_kota','')} → {order.get('tujuan_kota','')}".strip(" →")
    head = f"Pengiriman {order.get('vehicle_type','Kendaraan')} | {route}".strip()
    parts = [head]
    veh = []
    if order.get("nopol"):  veh.append(f"Nopol {order['nopol']}")
    if order.get("warna"):  veh.append(order["warna"])
    if order.get("tahun"):  veh.append(f"Th {order['tahun']}")
    if order.get("no_rangka"): veh.append(f"Rangka {order['no_rangka']}")
    if veh:
        parts.append(" · ".join(veh))
    if order.get("pickup_date"):
        parts.append(f"Pickup: {order['pickup_date']} {order.get('pickup_time','')}".strip())
    if order.get("catatan"):
        parts.append(f"Catatan: {order['catatan']}")
    parts.append(f"Ref: {order_id}" + (f" / {trip_id}" if trip_id else ""))
    return "\n".join(parts)


async def _odoo_sync_order(order_id: str, trip_id: str, order: dict, price: float = 0.0) -> dict:
    """Best-effort real Odoo XML-RPC sync.
    - Find/creates res.partner (customer) with address from the order.
    - Creates sale.order linked to partner with origin=order_id AND a real order
      line (service product + route/vehicle description + price).
    - Idempotent: reuses existing sale.order for this origin; if that SO has no
      lines yet, backfills one so old empty SOs get fixed on re-click.
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
        product_id = await _odoo_service_product_id(odoo)
        line_desc = _odoo_line_desc(order, order_id, trip_id)

        def _build_line():
            vals = {"name": line_desc, "product_uom_qty": 1, "price_unit": float(price or 0)}
            if product_id:
                vals["product_id"] = product_id
            return [(0, 0, vals)]

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
                await asyncio.to_thread(
                    odoo.call, "sale.order", "write", [[sale_id], {"order_line": _build_line()}],
                )
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
                "note": note,
                "order_line": _build_line(),
            }],
        )
        if sale_id:
            logger.info(f"[odoo:sync_order:ok] order={order_id} trip={trip_id} partner={partner_id} sale={sale_id}")
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
        items.append(d)
    return {"count": len(items), "items": items}


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
                {"order_id": rx},
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
        if vt and vt not in VALID_VEHICLE_TYPES:
            raise HTTPException(400, f"vehicle_type tidak valid. Pilihan: {sorted(VALID_VEHICLE_TYPES)}")
        upd["vehicle_type"] = vt
    if payload.nopol is not None:
        upd["nopol"] = payload.nopol.strip()[:20]
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
    if tid and ("vehicle_type" in upd or "nopol" in upd):
        tupd = {"updated_at": upd["updated_at"]}
        if "vehicle_type" in upd:
            tupd["vehicle_type"] = upd["vehicle_type"]
            tupd["tipe_kendaraan"] = upd["vehicle_type"]
        if "nopol" in upd and upd["nopol"]:
            tupd["nopol"] = upd["nopol"]
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
    """Simpan/update array legs pada trip. Tiap leg: {tipe, asal, tujuan, kapal, eta, status}."""
    trip = await db.trips.find_one({"trip_id": trip_id})
    if not trip:
        raise HTTPException(404, "Trip not found")
    now = datetime.utcnow().isoformat()
    await db.trips.update_one({"trip_id": trip_id}, {"$set": {"legs": body.legs, "updated_at": now}})
    return {"ok": True, "trip_id": trip_id, "legs_count": len(body.legs)}


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
    sync = await _odoo_sync_order(order_id, trip_id or "", order, price=body.price)
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
    doc["harga_history"] = (doc.get("harga_history") or [])[-20:]
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
        "tanggal": datetime.utcnow().isoformat(),
    }
    await db.pelanggan_profiles.update_one(
        {"id": pelanggan_id},
        {"$push": {"harga_history": {"$each": [entry], "$slice": -100}}}
    )
    updated = await db.pelanggan_profiles.find_one({"id": pelanggan_id}, {"_id": 0})
    updated["harga_history"] = (updated.get("harga_history") or [])[-20:]
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
    history = (doc.get("harga_history") or [])[-10:]
    safe_history = [
        {
            "rute": h.get("rute"),
            "harga_deal": h.get("harga_deal"),
            "tipe_kendaraan": h.get("tipe_kendaraan"),
            "tanggal": h.get("tanggal"),
            "asuransi": h.get("asuransi", 0),
            "catatan": h.get("catatan", ""),
        }
        for h in history
    ]
    safe_history.reverse()
    return {"nama_pt": doc["nama_pt"], "harga_history": safe_history}


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
