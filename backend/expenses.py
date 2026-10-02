"""
expenses.py — BIAYA UMUM & ADMINISTRATIF (Expenses / Operating Expenses).

TERISOLASI dari server.py. Expenses = biaya OPERASIONAL perusahaan yang TIDAK
melekat langsung ke satu order/job/unit (gaji admin, listrik, internet, sewa,
ATK, biaya bank, langganan software, dll). BEDA dengan HPP / Cost of Sales
(biaya langsung per order → tetap di supplier_profiles.jobs + trip finance).

Dengan menaruh Expenses di collection TERPISAH (`expenses`), tidak ada overlap
dengan HPP → tidak mungkin double counting. Laba Rugi nantinya:
    Pendapatan − HPP = Laba Kotor − Expenses = Laba Operasional

Multi-entity: tiap expense wajib `entity_id` (mis. "pt-alyssa" / "cv-alyssa-trans")
— identifier yang SAMA dengan dokumen (docTheme.js), bukan nama tampilan.

Koreksi: TIDAK hard-delete. `void` = soft (status "void" + alasan + audit trail).
Kategori: dikelola di collection `expense_categories` (bisa tambah/nonaktif),
default hanya SARAN (di-seed sekali), bukan satu-satunya pilihan.
"""

import uuid
import re
import logging
from datetime import datetime, timezone

logger = logging.getLogger("expenses")

EXPENSES = "expenses"
CATEGORIES = "expense_categories"

# Mirror identifier entitas dari frontend docTheme.js (BUKAN nama tampilan).
# Validasi ringan supaya laporan per-entity tidak kotor karena typo.
KNOWN_ENTITIES = ("pt-alyssa", "cv-alyssa-trans")
DEFAULT_ENTITY = "pt-alyssa"

# Kategori default = SARAN awal (di-seed sekali). User bebas tambah/nonaktifkan.
_DEFAULT_CATEGORIES = [
    "Gaji & Admin Kantor", "Listrik", "Internet", "Sewa Kantor", "ATK",
    "Biaya Bank", "Langganan Software", "Biaya Administrasi", "Operasional Kantor",
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _gen_id():
    return uuid.uuid4().hex[:12]


def _to_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def _valid_date(v):
    s = str(v or "").strip()
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _norm_entity(v):
    s = str(v or "").strip()
    return s if s in KNOWN_ENTITIES else ""


async def ensure_indexes(db):
    """Index bantu (additive, aman). Tidak menyentuh collection existing."""
    await db[EXPENSES].create_index("id", unique=True)
    await db[EXPENSES].create_index([("entity_id", 1), ("tanggal", -1)])
    await db[EXPENSES].create_index("status")
    await db[CATEGORIES].create_index("id", unique=True)


async def seed_categories(db):
    """Seed kategori default SEKALI kalau masih kosong (idempoten)."""
    try:
        n = await db[CATEGORIES].count_documents({})
        if n:
            return
        now = _now()
        docs = [{"id": _gen_id(), "nama": c, "aktif": True, "created_at": now} for c in _DEFAULT_CATEGORIES]
        if docs:
            await db[CATEGORIES].insert_many(docs)
    except Exception as e:  # pragma: no cover
        logger.warning("[expenses] seed kategori gagal: %s", e)


# ── Kategori ────────────────────────────────────────────────────────────────
async def list_categories(db, include_inactive=False):
    filt = {} if include_inactive else {"aktif": {"$ne": False}}
    out = []
    async for d in db[CATEGORIES].find(filt, {"_id": 0}).sort("nama", 1):
        out.append(d)
    return out


async def add_category(db, nama):
    nama = str(nama or "").strip()[:60]
    if not nama:
        return {"error": "nama kategori wajib"}
    existing = await db[CATEGORIES].find_one(
        {"nama": re.compile(r"^\s*" + re.escape(nama) + r"\s*$", re.I)}, {"_id": 0})
    if existing:
        if existing.get("aktif") is False:
            await db[CATEGORIES].update_one({"id": existing["id"]}, {"$set": {"aktif": True}})
            existing["aktif"] = True
        return existing
    doc = {"id": _gen_id(), "nama": nama, "aktif": True, "created_at": _now()}
    await db[CATEGORIES].insert_one(dict(doc))
    return doc


async def update_category(db, cat_id, nama=None, aktif=None):
    upd = {}
    if nama is not None:
        nm = str(nama).strip()[:60]
        if nm:
            upd["nama"] = nm
    if aktif is not None:
        upd["aktif"] = bool(aktif)
    if not upd:
        return {"error": "tidak ada perubahan"}
    r = await db[CATEGORIES].update_one({"id": cat_id}, {"$set": upd})
    if not r.matched_count:
        return {"error": "kategori tidak ditemukan"}
    return await db[CATEGORIES].find_one({"id": cat_id}, {"_id": 0})


# ── Expenses ──────────────────────────────────────────────────────────────────
def _public(doc):
    if not doc:
        return doc
    d = dict(doc)
    d.pop("_id", None)
    return d


async def create_expense(db, payload, created_by="admin"):
    payload = dict(payload or {})
    entity_id = _norm_entity(payload.get("entity_id"))
    if not entity_id:
        return {"error": f"entity_id wajib & harus salah satu dari {list(KNOWN_ENTITIES)}"}
    nominal = _to_int(payload.get("nominal"))
    if nominal <= 0:
        return {"error": "nominal harus lebih dari 0"}
    kategori = str(payload.get("kategori") or "").strip()[:60]
    if not kategori:
        return {"error": "kategori wajib"}
    now = _now()
    doc = {
        "id": _gen_id(),
        "tanggal": _valid_date(payload.get("tanggal")),
        "entity_id": entity_id,
        "kategori": kategori,
        "deskripsi": str(payload.get("deskripsi") or "").strip()[:300],
        "nominal": nominal,
        "metode": str(payload.get("metode") or "").strip()[:40],
        "referensi": str(payload.get("referensi") or "").strip()[:80],
        "bukti_url": None,
        "status": "active",
        "created_by": str(created_by or "admin")[:60],
        "created_at": now,
        "updated_at": now,
        "audit": [{"action": "create", "at": now, "by": str(created_by or "admin")[:60]}],
    }
    await db[EXPENSES].insert_one(dict(doc))
    return _public(doc)


async def update_expense(db, expense_id, payload, by="admin"):
    doc = await db[EXPENSES].find_one({"id": expense_id})
    if not doc:
        return {"error": "expense tidak ditemukan"}
    if doc.get("status") == "void":
        return {"error": "expense sudah dibatalkan (void), tidak bisa diedit"}
    payload = dict(payload or {})
    upd, changes = {}, {}
    if "tanggal" in payload:
        upd["tanggal"] = _valid_date(payload.get("tanggal"))
    if "entity_id" in payload:
        e = _norm_entity(payload.get("entity_id"))
        if not e:
            return {"error": f"entity_id harus salah satu dari {list(KNOWN_ENTITIES)}"}
        upd["entity_id"] = e
    if "kategori" in payload:
        k = str(payload.get("kategori") or "").strip()[:60]
        if not k:
            return {"error": "kategori tidak boleh kosong"}
        upd["kategori"] = k
    if "deskripsi" in payload:
        upd["deskripsi"] = str(payload.get("deskripsi") or "").strip()[:300]
    if "nominal" in payload:
        n = _to_int(payload.get("nominal"))
        if n <= 0:
            return {"error": "nominal harus lebih dari 0"}
        upd["nominal"] = n
    if "metode" in payload:
        upd["metode"] = str(payload.get("metode") or "").strip()[:40]
    if "referensi" in payload:
        upd["referensi"] = str(payload.get("referensi") or "").strip()[:80]
    if not upd:
        return {"error": "tidak ada perubahan"}
    for k, v in upd.items():
        if doc.get(k) != v:
            changes[k] = {"from": doc.get(k), "to": v}
    now = _now()
    upd["updated_at"] = now
    await db[EXPENSES].update_one(
        {"id": expense_id},
        {"$set": upd, "$push": {"audit": {"action": "edit", "at": now, "by": str(by or "admin")[:60], "changes": changes}}},
    )
    return _public(await db[EXPENSES].find_one({"id": expense_id}))


async def void_expense(db, expense_id, reason="", by="admin"):
    """Koreksi SOFT — tidak hard-delete. status→void + alasan + audit trail.
    Expense void tidak ikut dihitung di total/laporan."""
    doc = await db[EXPENSES].find_one({"id": expense_id})
    if not doc:
        return {"error": "expense tidak ditemukan"}
    if doc.get("status") == "void":
        return {"status": "already_void", "id": expense_id}
    now = _now()
    await db[EXPENSES].update_one(
        {"id": expense_id},
        {"$set": {"status": "void", "void_reason": str(reason or "")[:300], "void_at": now, "updated_at": now},
         "$push": {"audit": {"action": "void", "at": now, "by": str(by or "admin")[:60], "reason": str(reason or "")[:300]}}},
    )
    return {"status": "void", "id": expense_id}


def _build_filter(entity_id=None, date_from=None, date_to=None, kategori=None, status="active"):
    filt = {}
    if status and status != "all":
        filt["status"] = status
    if entity_id and entity_id != "all":
        filt["entity_id"] = entity_id
    if kategori:
        filt["kategori"] = kategori
    dq = {}
    if date_from and re.match(r"^\d{4}-\d{2}-\d{2}$", date_from):
        dq["$gte"] = date_from
    if date_to and re.match(r"^\d{4}-\d{2}-\d{2}$", date_to):
        dq["$lte"] = date_to
    if dq:
        filt["tanggal"] = dq
    return filt


async def list_expenses(db, entity_id=None, date_from=None, date_to=None, kategori=None, status="active", limit=500):
    filt = _build_filter(entity_id, date_from, date_to, kategori, status)
    out = []
    cur = db[EXPENSES].find(filt, {"_id": 0}).sort("tanggal", -1).limit(max(1, min(limit, 2000)))
    async for d in cur:
        out.append(d)
    total = sum((d.get("nominal") or 0) for d in out if d.get("status") == "active")
    return {"items": out, "count": len(out), "total_active": total}


async def summary(db, entity_id=None, date_from=None, date_to=None):
    """Total expenses (status active) per entity & per kategori — buat Laba Rugi.
    Selalu TERPISAH dari HPP (collection berbeda) → tidak ada double counting."""
    filt = _build_filter(entity_id, date_from, date_to, None, "active")
    per_entity, per_kategori, grand = {}, {}, 0
    async for d in db[EXPENSES].find(filt, {"_id": 0}):
        amt = d.get("nominal") or 0
        grand += amt
        per_entity[d.get("entity_id")] = per_entity.get(d.get("entity_id"), 0) + amt
        per_kategori[d.get("kategori")] = per_kategori.get(d.get("kategori"), 0) + amt
    return {"grand_total": grand, "per_entity": per_entity, "per_kategori": per_kategori,
            "periode": {"dari": date_from or "", "sampai": date_to or ""}}
