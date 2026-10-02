"""
rekon_sync.py — Integrasi PEMBAYARAN SUPPLIER dari Audit Rekon (Felis-Alyssa).

TERISOLASI dari server.py. `alyssa-dev` menerima transaksi bank yang SUDAH
dikonfirmasi (supplier benar) di Felis, lalu otomatis membuat Pembayaran
Supplier memakai mekanisme EXISTING:

    supplier_profiles.jobs[].payments[]   ← single source of truth

TIDAK membuat ledger kedua. Riwayat / Sudah Transfer / Sisa Transfer otomatis
ikut karena semuanya dihitung ulang dari payments[] (_supplier_job_totals).

ANTI-DUPLIKAT (DB-enforced):
  Collection `bank_payment_imports` dengan UNIQUE index pada `bank_transaction_id`.
  1 bank_transaction_id  →  maksimum 1 pembayaran supplier.
  Pemanggilan berulang / retry / dobel-klik → `already_processed`, tidak bikin
  pembayaran kedua. Tidak mengandalkan nama supplier / tanggal+nominal / cek
  frontend.

CATATAN: koneksi HTTP keluar ke Felis (endpoint + auth) BELUM ada di sini —
kontraknya belum final. Fungsi `ingest_transaction` adalah pintu masuk data
(dipanggil endpoint /admin/rekon/ingest, atau nanti oleh puller Felis). Lihat
rekon_felis_client.py untuk adapter (stub) yang tinggal disambung.
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

# Field kontrak yang disimpan apa adanya (buat audit/telusur balik ke bank).
_CONTRACT_FIELDS = (
    "idempotency_key", "supplier_id", "supplier_name_display", "tanggal",
    "nominal", "source_entity", "source_account_number", "beneficiary_bank_code",
    "deskripsi_bank", "referensi", "bank_transaction_sidik", "alokasi",
)

# Status pembayaran yang dianggap final (tidak boleh dibuat ulang).
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
    """UNIQUE index anti-duplikat + index bantu. Dipanggil saat startup.
    Aman kalau sudah ada (idempotent). Tidak menyentuh collection lain."""
    await db[IMPORTS_COLLECTION].create_index("bank_transaction_id", unique=True)
    await db[IMPORTS_COLLECTION].create_index("status")
    # index bantu lookup supplier by id (non-unique, aman untuk data existing)
    try:
        await db.supplier_profiles.create_index("id")
    except Exception as e:  # pragma: no cover
        logger.warning("[rekon] gagal index supplier_profiles.id: %s", e)


def _pick_contract(payload):
    """Ambil hanya field kontrak yang dikenal (buang sisanya ke raw_payload)."""
    out = {}
    for k in _CONTRACT_FIELDS:
        if k in payload:
            out[k] = payload[k]
    return out


def _bucket_job_id(sup):
    """Cari job 'bucket' untuk pembayaran yang BELUM dialokasi (unallocated).
    Return job_id kalau sudah ada, else None."""
    for j in (sup.get("jobs") or []):
        if j.get("rekon_bucket"):
            return j.get("id")
    return None


def _make_bucket_job(now_iso):
    return {
        "id": _gen_id(),
        "rekon_bucket": True,
        "kategori": "Pembayaran Rekon (belum dialokasi)",
        "nopol": "",
        "vehicle_type": "Pembayaran Rekon Bank",
        "total_harga": 0,          # tanpa tagihan — murni penampung pembayaran
        "harga_deal": 0,
        "payments": [],
        "tambahan": [],
        "created_at": now_iso,
        "source": "rekon-bank",
    }


def _resolve_target_job_id(sup, payload, now_iso):
    """Tentukan job tujuan pembayaran:
      1) alokasi terkonfirmasi membawa job_id yang valid di supplier ini → pakai itu.
      2) selain itu → job 'bucket' unallocated (dibuat kalau belum ada).
    JANGAN menebak unit dari nama/nominal. Return (job_id, jobs_mutated_or_None).
    """
    jobs = list(sup.get("jobs") or [])
    valid_ids = {j.get("id") for j in jobs}

    # 1) alokasi → job_id eksplisit (format fleksibel: list[{job_id,...}] atau {job_id})
    alok = payload.get("alokasi")
    cand = None
    if isinstance(alok, dict):
        cand = alok.get("job_id")
    elif isinstance(alok, list) and alok:
        first = alok[0]
        if isinstance(first, dict):
            cand = first.get("job_id")
        elif isinstance(first, str):
            cand = first
    cand = str(cand).strip() if cand else ""
    if cand and cand in valid_ids:
        return cand, None

    # 2) bucket unallocated
    bid = _bucket_job_id(sup)
    if bid:
        return bid, None
    bucket = _make_bucket_job(now_iso)
    jobs.append(bucket)
    return bucket["id"], jobs


async def _find_existing_payment(sup, btid):
    """Self-heal: cek apakah pembayaran dgn bank_transaction_id ini SUDAH ada
    di salah satu job supplier (kalau import record sempat gagal update)."""
    for j in (sup.get("jobs") or []):
        for p in (j.get("payments") or []):
            if p.get("bank_transaction_id") == btid:
                return j.get("id"), p.get("id")
    return None, None


async def ingest_transaction(db, payload):
    """Proses 1 transaksi bank terkonfirmasi → 1 pembayaran supplier (idempoten).

    Return dict `result` dengan field `status` salah satu:
      - "created"            : pembayaran baru dibuat.
      - "already_processed"  : bank_transaction_id sudah pernah → tidak dibuat ulang.
      - "reversed"           : sudah pernah dibuat lalu dibatalkan → tidak dibuat ulang.
      - "supplier_not_found" : supplier_id tidak ada di master → perlu cek manusia.
      - "error"              : payload tidak valid.
    """
    payload = dict(payload or {})
    btid = str(payload.get("bank_transaction_id") or "").strip()
    if not btid:
        return {"status": "error", "error": "bank_transaction_id wajib diisi"}

    now_iso = _now_iso()

    # ── 1) LOCK anti-duplikat via UNIQUE insert ──────────────────────────────
    base_rec = {
        "bank_transaction_id": btid,
        "status": "processing",
        "source": "rekon-bank",
        "created_at": now_iso,
        "updated_at": now_iso,
        "raw_payload": payload,
    }
    base_rec.update(_pick_contract(payload))
    try:
        await db[IMPORTS_COLLECTION].insert_one(dict(base_rec))
        locked_new = True
    except DuplicateKeyError:
        locked_new = False
        existing = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
        st = (existing or {}).get("status")
        if st in _FINAL_STATUS:
            # Sudah final → JANGAN buat pembayaran kedua.
            return {"status": "already_processed" if st == "processed" else "reversed",
                    "bank_transaction_id": btid, "import": existing}
        # status 'processing'/'supplier_not_found'/'error' → boleh dicoba ulang.

    async def _fail(status, **extra):
        await db[IMPORTS_COLLECTION].update_one(
            {"bank_transaction_id": btid},
            {"$set": {"status": status, "updated_at": _now_iso(), **extra}},
        )
        return {"status": status, "bank_transaction_id": btid, **extra}

    # ── 2) Validasi supplier_id di master alyssa-dev ─────────────────────────
    sid = str(payload.get("supplier_id") or "").strip()
    if not sid:
        return await _fail("supplier_not_found", reason="supplier_id kosong")
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0})
    if not sup:
        return await _fail("supplier_not_found", supplier_id=sid,
                           reason="supplier_id tidak ada di master alyssa-dev")

    # ── 3) Self-heal: pembayaran dgn btid ini mungkin sudah ada ──────────────
    ej, ep = await _find_existing_payment(sup, btid)
    if ej and ep:
        await db[IMPORTS_COLLECTION].update_one(
            {"bank_transaction_id": btid},
            {"$set": {"status": "processed", "supplier_id": sid, "job_id": ej,
                      "payment_id": ep, "updated_at": _now_iso(), "processed_at": _now_iso()}},
        )
        return {"status": "already_processed", "bank_transaction_id": btid,
                "supplier_id": sid, "job_id": ej, "payment_id": ep}

    # ── 4) Validasi nominal ──────────────────────────────────────────────────
    amount = _to_int(payload.get("nominal"))
    if amount <= 0:
        return await _fail("error", reason="nominal harus lebih dari 0")

    # ── 5) Tentukan job tujuan (alokasi terkonfirmasi atau bucket) ───────────
    # reload fresh supaya tidak menimpa perubahan lain
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0})
    job_id, mutated_jobs = _resolve_target_job_id(sup, payload, now_iso)
    jobs = mutated_jobs if mutated_jobs is not None else list(sup.get("jobs") or [])
    idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
    if idx is None:
        return await _fail("error", reason="job tujuan tidak ditemukan")

    # ── 6) Buat payment di ledger EXISTING ───────────────────────────────────
    catatan = str(payload.get("deskripsi_bank") or payload.get("referensi") or "").strip()[:300]
    payment_id = _gen_id()
    payment = {
        "id": payment_id,
        "amount": amount,
        "tanggal": _valid_date(payload.get("tanggal")),
        "tipe": "transfer",
        "catatan": catatan,
        "bukti_url": None,
        "metode": "Transfer",
        # provenance — biar bisa ditelusuri balik ke transaksi bank asal:
        "source": "rekon-bank",
        "bank_transaction_id": btid,
        "rekon": {
            "source_entity": payload.get("source_entity") or "",
            "source_account_number": payload.get("source_account_number") or "",
            "beneficiary_bank_code": payload.get("beneficiary_bank_code") or "",
            "referensi": payload.get("referensi") or "",
            "bank_transaction_sidik": payload.get("bank_transaction_sidik") or "",
            "supplier_name_display": payload.get("supplier_name_display") or "",
        },
    }
    jobs[idx].setdefault("payments", []).append(payment)
    await db.supplier_profiles.update_one({"id": sid}, {"$set": {"jobs": jobs}})

    # ── 7) Finalisasi import record ──────────────────────────────────────────
    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "processed", "supplier_id": sid, "job_id": job_id,
                  "payment_id": payment_id, "amount": amount,
                  "updated_at": _now_iso(), "processed_at": _now_iso()}},
    )
    return {"status": "created", "bank_transaction_id": btid, "supplier_id": sid,
            "supplier_nama": sup.get("nama"), "job_id": job_id, "payment_id": payment_id,
            "amount": amount, "unallocated": bool(mutated_jobs is not None or
                                                  any(j.get("id") == job_id and j.get("rekon_bucket") for j in jobs))}


async def reverse_import(db, bank_transaction_id, reason=""):
    """Koreksi/pembatalan: hapus pembayaran dari ledger TAPI simpan snapshot +
    tandai import record `reversed` (audit trail dipertahankan). Setelah di-reverse,
    bank_transaction_id TIDAK bisa tiba-tiba ter-import lagi jadi pembayaran baru
    tanpa koreksi eksplisit (status 'reversed' = final)."""
    btid = str(bank_transaction_id or "").strip()
    rec = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
    if not rec:
        return {"status": "not_found", "bank_transaction_id": btid}
    if rec.get("status") == "reversed":
        return {"status": "already_reversed", "bank_transaction_id": btid}
    if rec.get("status") != "processed":
        return {"status": "nothing_to_reverse", "bank_transaction_id": btid, "current": rec.get("status")}

    sid = rec.get("supplier_id")
    job_id = rec.get("job_id")
    payment_id = rec.get("payment_id")
    snapshot = None
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0}) if sid else None
    if sup:
        jobs = list(sup.get("jobs") or [])
        idx = next((i for i, j in enumerate(jobs) if j.get("id") == job_id), None)
        if idx is not None:
            keep = []
            for p in (jobs[idx].get("payments") or []):
                if p.get("id") == payment_id:
                    snapshot = p
                else:
                    keep.append(p)
            jobs[idx]["payments"] = keep
            await db.supplier_profiles.update_one({"id": sid}, {"$set": {"jobs": jobs}})

    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "reversed", "reversed_at": _now_iso(), "updated_at": _now_iso(),
                  "reversal_reason": str(reason or "")[:300], "reversed_payment_snapshot": snapshot}},
    )
    return {"status": "reversed", "bank_transaction_id": btid, "supplier_id": sid,
            "job_id": job_id, "payment_id": payment_id, "removed": snapshot is not None}
