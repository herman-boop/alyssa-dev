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

ANTI-DUPLIKAT (DB-enforced): collection `bank_payment_imports`, UNIQUE pada
`bank_transaction_id` DAN `idempotency_key` (kontrak Felis: keduanya bernilai
sama = id baris transaksi bank fisik). 1 btid → maks 1 pembayaran. Retry/dobel →
already_processed. `bank_transaction_sidik` TIDAK dipakai sebagai kunci idempotency
(bisa sama untuk 2 baris fisik berbeda) — hanya untuk audit/pencocokan manual.

PEMISAHAN PT/CV: tiap pembayaran menyimpan `source_entity`
(PT_ALYSSA_AUTO_LOGISTIK | CV_ALYSSA_TRANS_UTAMA) sebagai field kelas satu.
Pembukuan "Sudah Transfer/Dialokasikan/Belum Dialokasikan" dipisah per
(supplier_id, source_entity) di _supplier_rekon_overview.

Koneksi HTTP ke Felis ada di rekon_felis_client.py (adapter READY/ACK/KOREKSI).
Field mengikuti KONTRAK FINAL Felis (3 Okt 2026).
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

# Entitas sumber dana yang SAH menurut kontrak. Tidak ada nilai lain / bawaan.
VALID_ENTITIES = ("PT_ALYSSA_AUTO_LOGISTIK", "CV_ALYSSA_TRANS_UTAMA")

# Map entitas rekon (kontrak) → id entitas DOKUMEN (dipakai modul expenses /
# docTheme). Dipakai saat 1 transaksi bank diposting jadi Biaya/Beban: entity
# WAJIB ikut rekening sumber (PT/CV), tidak boleh ketik ulang / salah.
DOC_ENTITY_MAP = {
    "PT_ALYSSA_AUTO_LOGISTIK": "pt-alyssa",
    "CV_ALYSSA_TRANS_UTAMA": "cv-alyssa-trans",
}

# Status import yang BOLEH diposting jadi Biaya: transaksi yang BUKAN pembayaran
# supplier (tidak ketemu supplier / error). processed=supplier, reversed, dan
# posted_expense TIDAK boleh (anti double-post).
EXPENSE_ELIGIBLE_STATUS = ("supplier_not_found", "error")

# Field kontrak Felis yang disimpan apa adanya di import record (audit/telusur).
_CONTRACT_FIELDS = (
    "idempotency_key", "bank_transaction_id", "bank_transaction_sidik",
    "supplier_id", "supplier_name",
    "source_entity", "source_entity_label", "source_account_number",
    "beneficiary_bank_code", "beneficiary_name_raw",
    "bank_account_number", "bank_account_name",
    "tanggal", "nominal", "deskripsi_bank", "referensi_bank", "alokasi",
)
_FINAL_STATUS = ("processed", "reversed")

# Status hasil ingest yang berarti "tersimpan permanen" → BOLEH di-ACK ke Felis.
# supplier_not_found / error / processing TIDAK di-ACK (biar muncul lagi di READY).
ACK_OK_STATUSES = ("created", "already_processed", "reversed")


def pick_ack_ids(items, results):
    """Dari hasil ingest satu batch, pilih transaksi_id yang BOLEH di-ACK.
    transaksi_id = idempotency_key (== bank_transaction_id). Hanya yang sudah
    tersimpan permanen (ACK_OK_STATUSES). Murni (tanpa I/O) supaya mudah diuji."""
    ids = []
    for it, r in zip(items or [], results or []):
        if (r or {}).get("status") in ACK_OK_STATUSES:
            tid = ((it or {}).get("idempotency_key") or (it or {}).get("bank_transaction_id")
                   or (r or {}).get("bank_transaction_id"))
            if tid:
                ids.append(str(tid))
    return ids


def waterfall_allocations(job_sisa, amount):
    """AUTO-ALOKASI: bagikan `amount` ke daftar (job_id, sisa) BERURUTAN sampai
    uang habis. Tidak pernah melebihi sisa tiap job, total ≤ amount. Sisa uang
    (kalau amount > total sisa) dibiarkan (tetap Belum Dialokasikan).
    Murni/tanpa I/O supaya mudah diuji. Return list [{job_id, amount}]."""
    out = []
    remaining = _to_int(amount)
    for jid, sisa in (job_sisa or []):
        if remaining <= 0:
            break
        s = _to_int(sisa)
        jid = str(jid or "").strip()
        if not jid or s <= 0:
            continue
        give = min(remaining, s)
        if give <= 0:
            continue
        out.append({"job_id": jid, "amount": give})
        remaining -= give
    return out


def smart_allocations(jobs, amount, max_groups=14):
    """PEMBAGIAN PINTAR pembayaran Rekon ke tagihan supplier (PURE, tanpa I/O).
    jobs = [(job_id, sisa, project_id)] BERURUTAN. project_id = FAKTUR supplier
    (1 faktur = 1 projek, boleh banyak unit); unit tanpa projek dianggap faktur
    sendiri. Urutan keputusan — dari sinyal paling kuat:
      1) `faktur_pas`: ada kombinasi faktur UTUH yang total sisanya == nominal
         (tepat 1 kombinasi) → lunaskan semua unit di faktur2 itu.
      2) `unit_pas`: tepat 1 unit yang sisanya == nominal → unit itu.
      3) `berurutan`: waterfall dari tagihan paling atas (perilaku lama).
    Kalau ada >1 kombinasi pas (ambigu) → tidak menebak, jatuh ke `berurutan` +
    catatan. Tidak pernah melebihi sisa unit; total ≤ nominal.
    Return {"allocations": [{job_id, amount}], "method": str, "note": str}."""
    amt = _to_int(amount)
    rows = []
    for j, sisa, pid in (jobs or []):
        jid = str(j or "").strip()
        sv = _to_int(sisa)
        if jid and sv > 0:
            rows.append((jid, sv, str(pid or "").strip()))
    if amt <= 0 or not rows:
        return {"allocations": [], "method": "kosong", "note": "Tidak ada tagihan belum lunas, atau nominal 0."}

    groups, order = {}, []
    for jid, sv, pid in rows:
        key = pid or ("_u:" + jid)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append((jid, sv))
    totals = [sum(sv for _, sv in groups[k]) for k in order]
    n = len(order)

    ambiguous = False
    if n <= max_groups:
        sols = []
        for mask in range(1, 1 << n):
            t = 0
            for i in range(n):
                if (mask >> i) & 1:
                    t += totals[i]
                    if t > amt:
                        break
            if t == amt:
                sols.append(mask)
                if len(sols) > 1:
                    break
        if len(sols) == 1:
            allocs = []
            for i in range(n):
                if (sols[0] >> i) & 1:
                    allocs += [{"job_id": jid, "amount": sv} for jid, sv in groups[order[i]]]
            nf = bin(sols[0]).count("1")
            return {"allocations": allocs, "method": "faktur_pas",
                    "note": f"Nominal pas dengan sisa {nf} faktur ({len(allocs)} unit) — dilunaskan."}
        if len(sols) > 1:
            ambiguous = True

    cand = [jid for jid, sv, _ in rows if sv == amt]
    if len(cand) == 1:
        return {"allocations": [{"job_id": cand[0], "amount": amt}], "method": "unit_pas",
                "note": "Nominal pas dengan sisa 1 unit — dilunaskan."}
    if len(cand) > 1:
        ambiguous = True

    allocs = waterfall_allocations([(jid, sv) for jid, sv, _ in rows], amt)
    note = "Tidak ada faktur/unit yang nominalnya pas — dibagi berurutan dari tagihan paling atas."
    if ambiguous:
        note = "Ada lebih dari 1 kombinasi faktur/unit yang nominalnya pas (ambigu) — dibagi berurutan; periksa manual."
    left = amt - sum(a["amount"] for a in allocs)
    if left > 0:
        note += f" Sisa {left:,} belum teralokasi (melebihi total tagihan).".replace(",", ".")
    return {"allocations": allocs, "method": "berurutan", "note": note}


# Field aman yang ditampilkan di preview (TANPA token/credential).
_PREVIEW_FIELDS = (
    "bank_transaction_id", "supplier_id", "supplier_name", "source_entity",
    "tanggal", "nominal", "beneficiary_name_raw", "deskripsi_bank", "alokasi",
)


async def preview_item(db, payload):
    """READ-ONLY: perlihatkan apa yang AKAN terjadi untuk 1 item READY, TANPA
    menyimpan, TANPA ACK, TANPA mengubah supplier/import/Felis. Hanya SELECT.

    Mengembalikan field aman (lihat _PREVIEW_FIELDS) + `would_status` = perkiraan
    hasil kalau nanti diproses: would_create | already_processed | reversed |
    supplier_not_found | error. Tidak menulis apa pun ke DB."""
    payload = dict(payload or {})
    out = {k: payload.get(k) for k in _PREVIEW_FIELDS}
    # alokasi selalu tampil sebagai array (kontrak).
    if not isinstance(out.get("alokasi"), list):
        out["alokasi"] = [out["alokasi"]] if isinstance(out.get("alokasi"), dict) else []

    btid = str(payload.get("bank_transaction_id") or payload.get("idempotency_key") or "").strip()
    sid = str(payload.get("supplier_id") or "").strip()
    entity = str(payload.get("source_entity") or "").strip()
    amount = _to_int(payload.get("nominal"))

    # Cek status import yang sudah ada (read-only).
    rec = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0, "status": 1}) if btid else None
    st = (rec or {}).get("status")
    # Cek supplier di master (read-only) — match canonical, tanpa matching nama.
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0, "id": 1, "nama": 1}) if sid else None

    if not btid:
        would = "error"; reason = "bank_transaction_id/idempotency_key kosong"
    elif st == "processed":
        would = "already_processed"; reason = "sudah pernah tersimpan (tidak akan dobel)"
    elif st == "reversed":
        would = "reversed"; reason = "sudah pernah dibatalkan (final)"
    elif not sid or not sup:
        would = "supplier_not_found"; reason = "supplier_id tidak ada di master alyssa-dev (tidak akan dibuat baru, tidak akan di-ACK)"
    elif entity not in VALID_ENTITIES:
        would = "error"; reason = f"source_entity tidak sah: {entity or '(kosong)'}"
    elif amount <= 0:
        would = "error"; reason = "nominal harus > 0"
    else:
        would = "would_create"
        reason = ("akan disimpan sebagai Unallocated Payment"
                  if not out["alokasi"] else "akan disimpan (alokasi hanya catatan audit)")

    out["supplier_found"] = bool(sup)
    out["supplier_nama_master"] = (sup or {}).get("nama")   # nama resmi di alyssa-dev (verifikasi)
    out["would_status"] = would
    out["note"] = reason
    return out


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
    # Kontrak: pasang UNIQUE pada idempotency_key (nilainya == bank_transaction_id).
    # sparse supaya record lama tanpa field ini tidak bentrok.
    try:
        await db[IMPORTS_COLLECTION].create_index("idempotency_key", unique=True, sparse=True)
    except Exception as e:  # pragma: no cover
        logger.warning("[rekon] gagal unique index idempotency_key: %s", e)
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
    # Kontrak: idempotency_key == bank_transaction_id (sengaja sama). Pakai salah
    # satu secara konsisten; kalau cuma satu yang ada, pakai yang ada.
    btid = str(payload.get("bank_transaction_id") or payload.get("idempotency_key") or "").strip()
    idem = str(payload.get("idempotency_key") or btid or "").strip()
    if not btid:
        return {"status": "error", "error": "bank_transaction_id/idempotency_key wajib diisi"}

    now_iso = _now_iso()
    base_rec = {"bank_transaction_id": btid, "idempotency_key": idem,
                "status": "processing", "source": "rekon-bank",
                "created_at": now_iso, "updated_at": now_iso, "raw_payload": payload}
    base_rec.update(_pick_contract(payload))
    base_rec["bank_transaction_id"] = btid   # jangan ketimpa _pick_contract
    base_rec["idempotency_key"] = idem
    try:
        await db[IMPORTS_COLLECTION].insert_one(dict(base_rec))
    except DuplicateKeyError:
        existing = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
        st = (existing or {}).get("status")
        if st in _FINAL_STATUS:
            return {"status": "already_processed" if st == "processed" else "reversed",
                    "bank_transaction_id": btid, "import": existing}
        # Sudah diposting sebagai Biaya/Beban → JANGAN jadikan pembayaran supplier
        # (anti double-post). Transaksi tetap milik Biaya sampai di-reverse.
        if st == "posted_expense":
            return {"status": "already_processed", "bank_transaction_id": btid,
                    "reason": "transaksi sudah diposting sebagai Biaya/Beban",
                    "import": existing}

    async def _fail(status, **extra):
        await db[IMPORTS_COLLECTION].update_one(
            {"bank_transaction_id": btid}, {"$set": {"status": status, "updated_at": _now_iso(), **extra}})
        return {"status": status, "bank_transaction_id": btid, **extra}

    sid = str(payload.get("supplier_id") or "").strip()
    if not sid:
        return await _fail("supplier_not_found", reason="supplier_id kosong")
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0})
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

    # Entitas sumber dana WAJIB & harus dikenali (PT/CV). Tidak ada bawaan —
    # menggabungkan entitas = pembukuan satu PT tampak dibayar uang PT lain.
    entity = str(payload.get("source_entity") or "").strip()
    if entity not in VALID_ENTITIES:
        return await _fail("error", supplier_id=sid,
                           reason=f"source_entity tidak sah: {entity or '(kosong)'}")

    # alokasi KONTRAK = keterangan audit ({tipe,ref,nominal}) — BUKAN alokasi job.
    # Pembayaran MASUK sebagai Unallocated (allocations=[]); penautan ke PO/job
    # dilakukan manual lewat allocate_payment. Tidak pernah memaksa PO/invoice.
    alokasi_note = payload.get("alokasi")
    if not isinstance(alokasi_note, list):
        alokasi_note = [alokasi_note] if isinstance(alokasi_note, dict) else []

    pid = _gen_id()
    rekon_payment = {
        "id": pid,
        "amount": amount,
        "tanggal": _valid_date(payload.get("tanggal")),
        "source": "rekon-bank",
        "bank_transaction_id": btid,
        "idempotency_key": idem,
        # Entitas kelas satu → pembukuan PT/CV dipisah di overview.
        "source_entity": entity,
        # deskripsi_bank = sumber otoritatif (apa adanya dari bank).
        "catatan": str(payload.get("deskripsi_bank") or "").strip()[:300],
        "allocations": [],          # Unallocated saat masuk; alloc manual kemudian.
        "status": "active",
        "created_at": now_iso,
        "rekon": {
            "source_entity": entity,
            "source_entity_label": payload.get("source_entity_label") or "",
            "source_account_number": payload.get("source_account_number") or "",  # rek PT/CV SENDIRI
            "beneficiary_bank_code": payload.get("beneficiary_bank_code") or "",
            # beneficiary_name_raw = hasil urai teks bank, BISA MELESET → audit saja,
            # TIDAK PERNAH jadi identitas supplier.
            "beneficiary_name_raw": payload.get("beneficiary_name_raw") or "",
            "bank_account_number": payload.get("bank_account_number"),   # kontrak: selalu null
            "bank_account_name": payload.get("bank_account_name"),       # kontrak: selalu null
            "referensi_bank": payload.get("referensi_bank") or "",
            "bank_transaction_sidik": payload.get("bank_transaction_sidik") or "",  # audit, BUKAN kunci
            "supplier_name_display": payload.get("supplier_name") or "",  # tampilan saja
            "alokasi_note": alokasi_note,   # keterangan audit; tidak dihitung sbg total
        },
    }
    rekon_payments = list(sup.get("rekon_payments") or [])
    rekon_payments.append(rekon_payment)
    await db.supplier_profiles.update_one({"id": sid}, {"$set": {"rekon_payments": rekon_payments}})

    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "processed", "supplier_id": sid, "source_entity": entity,
                  "rekon_payment_id": pid, "amount": amount, "allocated": 0,
                  "updated_at": _now_iso(), "processed_at": _now_iso()}})
    return {"status": "created", "bank_transaction_id": btid, "supplier_id": sid,
            "source_entity": entity, "supplier_nama": sup.get("nama"),
            "rekon_payment_id": pid, "amount": amount,
            "allocated": 0, "unallocated": amount}


_BANK_FEE_RE = re.compile(r"\bBIAYA\s*(TXN|TRX|TRANSAKSI|ADM|ADMIN)\b", re.IGNORECASE)


def is_bank_fee(payment):
    """True kalau pembayaran Rekon ini BIAYA ADMIN BANK (mis. 'BIF BIAYA TXN KE 002 ...'),
    bukan transfer ke supplier. Biaya admin ditanggung kita → tidak boleh dihitung sebagai
    pembayaran tagihan supplier. Berdasar deskripsi bank (catatan) — murni, tanpa I/O."""
    p = payment or {}
    text = " ".join(str(x or "") for x in (p.get("catatan"), (p.get("rekon") or {}).get("referensi_bank")))
    return bool(_BANK_FEE_RE.search(text))


def plan_tembak_semua(rows, payments, chosen_ids, release_fee=True):
    """TEMBAK SEMUA (PURE): arahkan SEMUA pembayaran Rekon aktif (kecuali biaya admin bank)
    ke unit yang dicentang, berurutan menurut tanggal, tiap pembayaran pakai pembagian pintar
    atas SISA yang tersisa. Alokasi LAMA tiap pembayaran diganti total (dilepas dari unit lain).
    Biaya admin bank: alokasinya dilepas (tidak dihitung sebagai pembayaran supplier).
    rows = [(job_id, sisa_tanpa_alokasi_pembayaran_ini, project_id)] — sisa dihitung dengan
    alokasi semua pembayaran target DIKELUARKAN. Return (payments_baru, ringkasan)."""
    chosen = set(chosen_ids or [])
    remaining, order = {}, []
    for jid, sisa, pid in rows:
        if jid in chosen and (sisa or 0) > 0:
            remaining[jid] = int(sisa); order.append((jid, pid))
    new = [dict(p) for p in (payments or [])]
    targets = [p for p in new if p.get("status") != "reversed" and not is_bank_fee(p) and _to_int(p.get("amount")) > 0]
    targets.sort(key=lambda p: str(p.get("tanggal") or ""))
    per, total_alloc, total_amount = [], 0, 0
    for p in targets:
        amt = _to_int(p.get("amount"))
        res = smart_allocations([(j, remaining[j], pid) for j, pid in order if remaining.get(j, 0) > 0], amt)
        allocs = res["allocations"]
        for a in allocs:
            remaining[a["job_id"]] -= a["amount"]
        p["allocations"] = allocs
        got = sum(a["amount"] for a in allocs)
        total_alloc += got; total_amount += amt
        per.append({"id": p.get("id"), "amount": amt, "allocated": got, "method": res.get("method"), "units": len(allocs)})
    released = 0
    if release_fee:
        for p in new:
            if p.get("status") != "reversed" and is_bank_fee(p) and (p.get("allocations") or []):
                p["allocations"] = []; released += 1
    return new, {"payments": per, "allocated": total_alloc, "amount": total_amount,
                 "unallocated": total_amount - total_alloc,
                 "fee_count": sum(1 for p in new if p.get("status") != "reversed" and is_bank_fee(p)),
                 "fee_released": released,
                 "sisa_unit": sum(v for v in remaining.values() if v > 0),
                 "units_open": sum(1 for v in remaining.values() if v > 0)}


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


async def restore_import(db, bank_transaction_id):
    """Pulihkan pembayaran rekon yang sudah di-Reverse (salah reverse / mau diulang
    alokasinya). Pembayaran kembali AKTIF sebagai Belum Dialokasikan — alokasi lama
    sengaja DIKOSONGKAN (tidak dipakai ulang) supaya dibagi ulang dengan benar.
    Audit trail dipertahankan (reversed_at/alasan tetap, ditambah restored_at)."""
    btid = str(bank_transaction_id or "").strip()
    rec = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
    if not rec:
        return {"status": "not_found", "bank_transaction_id": btid}
    if rec.get("status") != "reversed":
        return {"status": "not_reversed", "bank_transaction_id": btid, "current": rec.get("status")}
    sid, pid = rec.get("supplier_id"), rec.get("rekon_payment_id")
    sup = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0}) if sid else None
    if not sup:
        return {"status": "supplier_not_found", "bank_transaction_id": btid}
    rps = list(sup.get("rekon_payments") or [])
    hit = None
    for p in rps:
        if p.get("id") == pid and p.get("status") == "reversed":
            hit = p
            break
    if hit is None:
        return {"status": "payment_not_found", "bank_transaction_id": btid}
    hit["status"] = "active"
    hit["allocations"] = []
    hit["restored_at"] = _now_iso()
    await db.supplier_profiles.update_one({"id": sid}, {"$set": {"rekon_payments": rps}})
    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"status": "processed", "restored_at": _now_iso(), "updated_at": _now_iso()}})
    return {"status": "restored", "bank_transaction_id": btid, "supplier_id": sid,
            "rekon_payment_id": pid, "amount": hit.get("amount")}


# ── Routing transaksi bank → Biaya/Beban (expenses) ─────────────────────────
def doc_entity_for(source_entity):
    """Map entitas rekon (PT_ALYSSA_AUTO_LOGISTIK/CV_ALYSSA_TRANS_UTAMA) → id
    entitas dokumen (pt-alyssa/cv-alyssa-trans). "" kalau tidak dikenal."""
    return DOC_ENTITY_MAP.get(str(source_entity or "").strip(), "")


def can_post_as_expense(imp):
    """(ok, reason) — PURE. Boleh posting transaksi bank jadi Biaya kalau BUKAN
    pembayaran supplier & belum jadi Biaya (anti double-post)."""
    if not imp:
        return False, "transaksi tidak ditemukan"
    if imp.get("expense_id") or imp.get("status") == "posted_expense":
        return False, "transaksi sudah diposting sebagai Biaya/Beban"
    st = imp.get("status")
    if st == "processed":
        return False, "transaksi sudah jadi pembayaran Supplier (tidak bisa jadi Biaya)"
    if st == "reversed":
        return False, "transaksi sudah di-reverse"
    if st not in EXPENSE_ELIGIBLE_STATUS:
        return False, f"status '{st or '(kosong)'}' belum bisa diposting sebagai Biaya"
    return True, ""


def routing_bucket(imp):
    """Klasifikasi routing 1 transaksi bank (PURE) untuk ringkasan yang jelas:
      supplier    → sudah jadi pembayaran supplier (status processed)
      biaya       → sudah diposting Biaya/Beban (posted_expense)
      reversed    → dibatalkan
      unallocated → belum ditentukan (supplier_not_found/error/processing/lainnya)
    """
    st = (imp or {}).get("status")
    if st == "processed":
        return "supplier"
    if st == "posted_expense":
        return "biaya"
    if st == "reversed":
        return "reversed"
    return "unallocated"


def import_amount(imp):
    """Nominal transaksi dari import record (kontrak: field 'nominal'), fallback
    'amount' atau raw_payload.nominal. Tidak ketik ulang — selalu dari bank."""
    for v in (imp.get("nominal"), imp.get("amount"), (imp.get("raw_payload") or {}).get("nominal")):
        n = _to_int(v)
        if n > 0:
            return n
    return 0


async def mark_import_as_expense(db, btid, expense_id):
    """Tandai transaksi CONSUMED sebagai Biaya (anti double-post)."""
    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": str(btid or "").strip()},
        {"$set": {"status": "posted_expense", "consumed_as": "expense",
                  "expense_id": expense_id, "updated_at": _now_iso(), "posted_expense_at": _now_iso()}})


async def unmark_import_expense(db, btid):
    """Balikin transaksi ke Unallocated (supplier_not_found) setelah expense di-void."""
    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": str(btid or "").strip()},
        {"$set": {"status": "supplier_not_found", "consumed_as": None,
                  "expense_id": None, "updated_at": _now_iso()}})


async def apply_correction(db, bank_transaction_id, supplier_id_baru, reason=""):
    """KOREKSI: pindahkan 1 pembayaran rekon dari supplier lama → supplier_id_baru.

    Dipakai saat Owner Felis mengubah supplier_id SESUDAH transaksi ditarik.
    alyssa-dev sudah mencatat pembayaran ke supplier lama; pindahkan ke yang baru.

    VALIDASI (tidak memindahkan buta):
      - import record ada & berstatus 'processed'.
      - supplier_id_baru ADA di master alyssa-dev (jangan buat supplier baru).
      - pembayaran rekon dgn btid ini benar-benar ada & 'active' di supplier lama.
    Alokasi di-reset (job lama milik supplier lama, tidak valid untuk yang baru) —
    penautan ulang dilakukan manual. Tidak menyentuh nominal/btid.
    Return status: moved | same_supplier | not_found | not_processed |
                   supplier_baru_not_found | payment_not_found | reversed.
    """
    btid = str(bank_transaction_id or "").strip()
    sid_baru = str(supplier_id_baru or "").strip()
    rec = await db[IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid}, {"_id": 0})
    if not rec:
        return {"status": "not_found", "bank_transaction_id": btid}
    if rec.get("status") != "processed":
        return {"status": "not_processed", "bank_transaction_id": btid, "current": rec.get("status")}
    sid_lama = rec.get("supplier_id")
    pid = rec.get("rekon_payment_id")
    if not sid_baru:
        return {"status": "supplier_baru_not_found", "bank_transaction_id": btid, "reason": "supplier_id_baru kosong"}
    if sid_baru == sid_lama:
        return {"status": "same_supplier", "bank_transaction_id": btid, "supplier_id": sid_lama}

    sup_baru = await db.supplier_profiles.find_one({"id": sid_baru}, {"_id": 0})
    if not sup_baru:
        return {"status": "supplier_baru_not_found", "bank_transaction_id": btid, "supplier_id_baru": sid_baru}

    sup_lama = await db.supplier_profiles.find_one({"id": sid_lama}, {"_id": 0}) if sid_lama else None
    if not sup_lama:
        return {"status": "payment_not_found", "bank_transaction_id": btid, "reason": "supplier lama tidak ada"}

    rps_lama = list(sup_lama.get("rekon_payments") or [])
    moved = None
    keep = []
    for p in rps_lama:
        if p.get("id") == pid or p.get("bank_transaction_id") == btid:
            moved = dict(p)
        else:
            keep.append(p)
    if not moved:
        return {"status": "payment_not_found", "bank_transaction_id": btid, "supplier_id_lama": sid_lama}
    if moved.get("status") == "reversed":
        return {"status": "reversed", "bank_transaction_id": btid}

    # Reset alokasi (job_id milik supplier lama) + catat jejak koreksi.
    moved["allocations"] = []
    moved["corrected_from"] = sid_lama
    moved["corrected_at"] = _now_iso()
    if reason:
        moved["correction_reason"] = str(reason)[:300]

    rps_baru = list(sup_baru.get("rekon_payments") or [])
    rps_baru.append(moved)

    await db.supplier_profiles.update_one({"id": sid_lama}, {"$set": {"rekon_payments": keep}})
    await db.supplier_profiles.update_one({"id": sid_baru}, {"$set": {"rekon_payments": rps_baru}})
    await db[IMPORTS_COLLECTION].update_one(
        {"bank_transaction_id": btid},
        {"$set": {"supplier_id": sid_baru, "supplier_id_lama": sid_lama,
                  "corrected_at": _now_iso(), "updated_at": _now_iso()}})
    return {"status": "moved", "bank_transaction_id": btid, "rekon_payment_id": pid,
            "supplier_id_lama": sid_lama, "supplier_id_baru": sid_baru, "amount": moved.get("amount")}
