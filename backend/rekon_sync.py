"""
rekon_sync.py — Integrasi PEMBAYARAN SUPPLIER dari Audit Rekon (Felis-Alyssa).

TERISOLASI dari server.py. `alyssa-dev` menerima transaksi bank yang SUDAH
dikonfirmasi (supplier benar) di Felis, lalu otomatis mencatat Pembayaran
Supplier memakai ledger EXISTING — TANPA membuat sistem keuangan kedua.

MODEL PEMBAYARAN REKON (revisi):
  Pembayaran rekon disimpan di LEVEL SUPPLIER: supplier_profiles.rekon_payments[]
  (BUKAN job dummy 'bucket' bertotal 0 — itu bikin Sisa job minus & membingungkan).
  Tiap pembayaran:
    { id, amount, tanggal, bank_transaction_id, source:"rekon-bank",
      allocations:[{job_id, amount}], status:"active"|"reversed", rekon:{...} }

  - Uang dianggap SUDAH ditransfer ke supplier begitu masuk (muncul di Riwayat).
  - TAPI tidak dianggap membayar PO/job tertentu sebelum `allocations` dikonfirmasi.
  - Alokasi (allocate_payment) hanya mengubah `allocations` — TIDAK membuat
    pembayaran baru & TIDAK mengubah bank_transaction_id.
  - Total alokasi tidak boleh > nominal pembayaran.
  Perhitungan "Sudah Transfer / Dialokasikan / Belum Dialokasikan" + efek ke
  Sisa job dihitung di server (_supplier_rekon_overview + _supplier_job_totals
  extra_paid).

ANTI-DUPLIKAT (DB-enforced): collection `bank_payment_imports`, UNIQUE
`bank_transaction_id`. 1 btid → maks 1 pembayaran. Retry/dobel → already_processed.

Koneksi HTTP ke Felis BELUM ada (kontrak belum final) — lihat rekon_felis_client.py.
"""

import uuid
import re
import logging
from datetime import datetime, timezone

try:
    from pymongo.errors import DuplicateKeyError
except BaseException:  # pragma: no cover - fallback kalau pymongo tak bisa di-import
    class DuplicateKeyError(Exception):
        pass

logger = logging.getLogger("rekon")

IMPORTS_COLLECTION = "bank_payment_imports"

_CONTRACT_FIELDS = (
    "idempotency_key", "supplier_id", "supplier_name_display", "tanggal",
    "nominal", "source_entity", "source_account_number", "beneficiary_bank_code",
    "deskripsi_bank", "referensi", "bank_transaction_sidik", "alokasi",
)
_FINAL_STATUS = ("processed", "reversed")


def _now_iso():
    return datetime.now(timezone.utc).isoformat()


def _gen_id():
    return uuid.uuid4().hex[:8]


def _to_int(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def _valid_date(v):
    s = str(v or "").strip()
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else datetime.now(timezone.utc).strftime("%Y-%m-%d")


async def ensure_indexes(db):
    await db[IMPORTS_COLLECTION].create_index("bank_transaction_id", unique=True)
    await db[IMPORTS_COLLECTION].create_index("status")
    try:
        await db.supplier_profiles.create_index("id")
    except Exception as e:  # pragma: no cover
        logger.warning("[rekon] gagal index supplier_profiles.id: %s", e)


def _pick_contract(payload):
    return {k: payload[k] for k in _CONTRACT_FIELDS if k in payload}


def _clean_allocations(alok, valid_job_ids, max_amount):
    """Normalisasi alokasi terkonfirmasi dari payload → list {job_id, amount}.
    Hanya terima job_id yang valid di supplier & amount>0, dan cumulative ≤ max_amount.
    Return (allocations_bersih, total). Tidak melempar error — yang tak valid diabaikan."""
    items = []
    if isinstance(alok, dict):
        items = [alok]
    elif isinstance(alok, list):
        items = alok
    out, total = [], 0
    for a in items:
        if not isinstance(a, dict):
            continue
        jid = str(a.get("job_id") or "").strip()
        amt = _to_int(a.get("amount"))
        if not jid or jid not in valid_job_ids or amt <= 0:
            continue
        if total + amt > max_amount:
            amt = max_amount - total  # clamp supaya tidak lebih dari nominal
        if amt <= 0:
            continue
        out.append({"job_id": jid, "amount": amt})
        total += amt
        if total >= max_amount:
            break
    return out, total


def _find_existing_rekon_payment(sup, btid):
    """Cek apakah pembayaran rekon dgn btid ini sudah ada (self-heal)."""
    for p in (sup.get("rekon_payments") or []):
        if p.get("bank_transaction_id") == btid:
            return p.get("id")
    # jaga-jaga data lama yg sempat masuk jobs[].payments
    for j in (sup.get("jobs") or []):
        for p in (j.get("payments") or []):
            if p.get("bank_transaction_id") == btid:
                return p.get("id")
    return None


async def ingest_transaction(db, payload):
    """1 transaksi bank terkonfirmasi → 1 pembayaran supplier (idempoten).
    status: created | already_processed | reversed | supplier_not_found | error."""
    payload = dict(payload or {})
    btid = str(payload.get("bank_transaction_id") or "").strip()
    if not btid:
        return {"status": "error", "error": "bank_transaction_id wajib diisi"}

    now_iso = _now_iso()
    base_rec = {"bank_transaction_id": btid, "status": "processing", "source": "rekon-bank",
                "created_at": now_iso, "updated_at": now_iso, "raw_payload": payload}
    base_rec.update(_pick_contract(payload))
    try:
        await db[IMPORTS_COLLECTION].insert_one(dict(base_rec))
    except DuplicateKeyError:
        existing = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
        st = (existing or {}).get("status")
        if st in _FINAL_STATUS:
            return {"status": "already_processed" if st == "processed" else "reversed",
                    "bank_transaction_id": btid, "import": existing}

    async def _fail(status, **extra):
        await db[IMPORTS_COLLECTION].update_one(
            {"bank_transaction_id": btid}, {"$set": {"status": status, "updated_at": _now_iso(), **extra}})
        return {"status": status, "bank_transaction_id": btid, **extra}

    sid = str(payload.get("supplier_id") or "").strip()
    if not sid:
        return await _fail("supplier_not_found", reason="supplier_id kosong")
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0})
    # Alias/merge mapping: kalau supplier_id adalah duplikat yang sudah di-merge,
    # redirect ke canonical supplier_id. JANGAN mapping ke ID duplikat/inactive.
    hops = 0
    while sup and sup.get("status") == "merged" and sup.get("merged_into") and hops < 10:
        sid = sup["merged_into"]
        sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0})
        hops += 1
    if not sup:
        return await _fail("supplier_not_found", supplier_id=sid,
                           reason="supplier_id tidak ada di master alyssa-dev")

    # Self-heal
    existing_pid = _find_existing_rekon_payment(sup, btid)
    if existing_pid:
        await db[IMPORTS_COLLECTION].update_one(
            {"bank_transaction_id": btid},
            {"$set": {"status": "processed", "supplier_id": sid, "rekon_payment_id": existing_pid,
                      "updated_at": _now_iso(), "processed_at": _now_iso()}})
        return {"status": "already_processed", "bank_transaction_id": btid,
                "supplier_id": sid, "rekon_payment_id": existing_pid}

    amount = _to_int(payload.get("nominal"))
    if amount <= 0:
        return await _fail("error", reason="nominal harus lebih dari 0")

    # Alokasi pra-konfirmasi (opsional) dari payload — job_id harus valid di supplier.
    valid_job_ids = {j.get("id") for j in (sup.get("jobs") or [])}
    allocations, alloc_total = _clean_allocations(payload.get("alokasi"), valid_job_ids, amount)

    pid = _gen_id()
    rekon_payment = {
        "id": pid,
        "amount": amount,
        "tanggal": _valid_date(payload.get("tanggal")),
        "source": "rekon-bank",
        "bank_transaction_id": btid,
        "catatan": str(payload.get("deskripsi_bank") or payload.get("referensi") or "").strip()[:300],
        "allocations": allocations,
        "status": "active",
        "created_at": now_iso,
        "rekon": {
            "source_entity": payload.get("source_entity") or "",
            "source_account_number": payload.get("source_account_number") or "",
            "beneficiary_bank_code": payload.get("beneficiary_bank_code") or "",
            "referensi": payload.get("referensi") or "",
            "bank_transaction_sidik": payload.get("bank_transaction_sidik") or "",
            "supplier_name_display": payload.get("supplier_name_display") or "",
        },
    }
    rekon_payments = list(sup.get("rekon_payments") or [])
    rekon_payments.append(rekon_payment)
    await db.supplier_profiles.update_one({"id": sid}, {"$set": {"rekon_payments": rekon_payments}})

    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "processed", "supplier_id": sid, "rekon_payment_id": pid, "amount": amount,
                  "allocated": alloc_total, "updated_at": _now_iso(), "processed_at": _now_iso()}})
    return {"status": "created", "bank_transaction_id": btid, "supplier_id": sid,
            "supplier_nama": sup.get("nama"), "rekon_payment_id": pid, "amount": amount,
            "allocated": alloc_total, "unallocated": amount - alloc_total}


async def allocate_payment(db, supplier_id, rekon_payment_id, allocations):
    """Alokasikan (atau re-alokasi) 1 pembayaran rekon ke 1+ tagihan/job.
    - TIDAK membuat pembayaran baru, TIDAK mengubah bank_transaction_id.
    - Total alokasi ≤ nominal pembayaran.
    - `allocations` = list [{job_id, amount}] (set lengkap, mengganti yang lama).
    """
    sup = await db.supplier_profiles.find_one({"id": supplier_id}, {"_id": 0})
    if not sup:
        return {"error": "Supplier tidak ditemukan"}
    rps = list(sup.get("rekon_payments") or [])
    idx = next((i for i, p in enumerate(rps) if p.get("id") == rekon_payment_id), None)
    if idx is None:
        return {"error": "Pembayaran rekon tidak ditemukan"}
    if rps[idx].get("status") == "reversed":
        return {"error": "Pembayaran sudah dibatalkan (reversed)"}
    amount = rps[idx].get("amount") or 0
    valid_job_ids = {j.get("id") for j in (sup.get("jobs") or [])}
    cleaned, total = [], 0
    for a in (allocations or []):
        jid = str((a or {}).get("job_id") or "").strip()
        amt = _to_int((a or {}).get("amount"))
        if not jid or jid not in valid_job_ids:
            return {"error": f"job_id tidak valid: {jid or '(kosong)'}"}
        if amt <= 0:
            return {"error": "amount alokasi harus > 0"}
        total += amt
        cleaned.append({"job_id": jid, "amount": amt})
    if total > amount:
        return {"error": f"Total alokasi ({total}) melebihi nominal pembayaran ({amount})"}
    rps[idx]["allocations"] = cleaned
    await db.supplier_profiles.update_one({"id": supplier_id}, {"$set": {"rekon_payments": rps}})
    return {"ok": True, "rekon_payment_id": rekon_payment_id, "amount": amount,
            "allocated": total, "unallocated": amount - total,
            "alloc_status": "allocated" if (amount > 0 and total >= amount) else ("partial" if total > 0 else "unallocated")}


async def reverse_import(db, bank_transaction_id, reason=""):
    """Koreksi/pembatalan: tandai pembayaran rekon `reversed` (keluar dari
    perhitungan) + import jadi `reversed` (final, tak bisa re-import diam-diam).
    Audit trail + bank_transaction_id dipertahankan."""
    btid = str(bank_transaction_id or "").strip()
    rec = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
    if not rec:
        return {"status": "not_found", "bank_transaction_id": btid}
    if rec.get("status") == "reversed":
        return {"status": "already_reversed", "bank_transaction_id": btid}
    if rec.get("status") != "processed":
        return {"status": "nothing_to_reverse", "bank_transaction_id": btid, "current": rec.get("status")}

    sid = rec.get("supplier_id")
    pid = rec.get("rekon_payment_id")
    snapshot = None
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0}) if sid else None
    if sup:
        rps = list(sup.get("rekon_payments") or [])
        for p in rps:
            if p.get("id") == pid:
                snapshot = dict(p)
                p["status"] = "reversed"
                p["reversed_at"] = _now_iso()
                p["reversal_reason"] = str(reason or "")[:300]
                break
        await db.supplier_profiles.update_one({"id": sid}, {"$set": {"rekon_payments": rps}})

    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "reversed", "reversed_at": _now_iso(), "updated_at": _now_iso(),
                  "reversal_reason": str(reason or "")[:300], "reversed_payment_snapshot": snapshot}})
    return {"status": "reversed", "bank_transaction_id": btid, "supplier_id": sid,
            "rekon_payment_id": pid, "removed": snapshot is not None}
