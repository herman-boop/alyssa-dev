"""
Transfer ke driver lewat Flip dengan pengaman berlapis. Semua uang keluar lewat fungsi di sini.

Alur WAJIB dua langkah (server yang menegakkan, bukan tampilan):
  1. inquiry(): cek rekening ke Flip -> dapat NAMA PEMILIK. Disimpan di payout_logs (kind="inquiry").
  2. disburse(): hanya boleh dengan inquiry yang SUKSES, masih segar (<=15 menit), dan admin mengetik ulang
     nama pemilik persis seperti hasil cek. Rekening + nominal dikunci dari inquiry & antrean insentif
     (nominal = jumlah item "menunggu" milik driver itu, dihitung server, bukan dikirim dari tampilan).

Anti dobel: log "disbursement" dibuat SEBELUM memanggil Flip, idempotency key = id log; satu inquiry hanya
bisa dipakai sekali. Hasil tidak pasti (timeout/5xx) -> status "tidak_pasti", item TIDAK ditandai dibayar,
tidak ada kirim ulang otomatis; admin cek lewat refresh().

Koleksi `payout_logs` (riwayat berhasil maupun gagal). Secret key tidak pernah disimpan. Nomor rekening
ditampilkan tersamarkan di daftar riwayat.
"""
import asyncio
import re
import uuid
from datetime import datetime, timezone, timedelta

import flip_client as F
import driver_incentive as DI
import cashbank as CB

COLL = "payout_logs"
BANKS = "driver_bank_accounts"
INQUIRY_TTL = timedelta(minutes=15)
BLOCK_MSG = {   # status akhir Flip selain SUCCESS: transfer diblokir (SUSPECTED sengaja diblokir walau Flip masih mengizinkan)
    "INVALID_ACCOUNT_NUMBER": "Nomor rekening tidak valid (bisa juga nomor virtual account). Periksa nomor dan kode bank.",
    "SUSPECTED_ACCOUNT": "Flip menandai rekening ini mencurigakan (indikasi penipuan). Transfer diblokir demi keamanan; pastikan rekeningnya benar.",
    "BLACK_LISTED": "Rekening ini masuk daftar hitam penipuan Flip. Transfer tidak diizinkan.",
}
POLL_TRIES = 5          # cek rekening Flip bersifat 2 tahap: jawaban pertama biasanya PENDING; tanya ulang sampai selesai
POLL_SLEEP = 2.5        # detik antar percobaan (total tunggu maks ±12 detik)


def _now():
    return datetime.now(timezone.utc)


def _iso(d=None):
    return (d or _now()).isoformat()


def _digits(v):
    return re.sub(r"\D", "", str(v or ""))


def mask(acc):
    a = _digits(acc)
    return ("*" * max(0, len(a) - 4)) + a[-4:] if a else ""


def _norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def _public(doc):
    out = {k: v for k, v in doc.items() if k not in ("_id", "response")}
    out["account_masked"] = mask(doc.get("account_number"))
    out.pop("account_number", None)
    return out


async def _run(fn, *a, **k):
    """Panggilan HTTP ke Flip bersifat blocking: jalankan di thread supaya server tidak macet."""
    return await asyncio.to_thread(lambda: fn(*a, **k))


async def get_bank(db, driver_nama):
    d = await db[BANKS].find_one({"key": _norm(driver_nama)})
    if not d:
        return None
    return {"driver_nama": d.get("driver_nama"), "bank_code": d.get("bank_code"), "account_number": d.get("account_number"),
            "account_holder": d.get("account_holder")}


async def _log(db, doc):
    await db[COLL].insert_one(dict(doc))
    return doc


async def _update(db, log_id, patch):
    patch = dict(patch, updated_at=_iso())
    await db[COLL].update_one({"id": log_id}, {"$set": patch})


def _pending_items(items, driver_nama):
    return [i for i in items if i.get("status") == "menunggu" and _norm(i.get("driver_nama")) == _norm(driver_nama)]


async def inquiry(db, http, driver_nama, bank_code, account_number):
    cfg = F.config()
    if not cfg["enabled"]:
        raise PermissionError("Transfer Flip belum diaktifkan (FLIP_PAYOUT_ENABLED)")
    bank_code = re.sub(r"[^a-z0-9_]", "", str(bank_code or "").lower())[:20]
    acc = _digits(account_number)
    if not driver_nama or not bank_code or not (5 <= len(acc) <= 24):
        raise ValueError("Nama driver, kode bank, dan nomor rekening (5-24 digit) wajib diisi")
    doc = {"id": "PLG-" + uuid.uuid4().hex[:10], "kind": "inquiry", "status": "diproses", "env": cfg["env"],
           "driver_nama": driver_nama.strip(), "bank_code": bank_code, "account_number": acc, "account_holder": "",
           "created_at": _iso(), "used": False}
    await _log(db, doc)
    try:
        r = await _run(F.inquiry, http, bank_code, acc, doc["id"])
        tries = 0
        while r["status"] in ("PENDING", "") and not r["account_holder"] and tries < POLL_TRIES:
            await asyncio.sleep(POLL_SLEEP)       # Flip: permintaan yang sama diulang -> hasil akhir dari cache
            r = await _run(F.inquiry, http, bank_code, acc, doc["id"])
            tries += 1
    except F.FlipError as e:
        await _update(db, doc["id"], {"status": "gagal", "error": str(e)[:200]})
        raise ValueError(f"Cek rekening gagal: {e}")
    except F.FlipUnknown as e:
        await _update(db, doc["id"], {"status": "gagal", "error": "Flip tidak merespons: " + str(e)})
        raise ValueError("Cek rekening gagal: Flip tidak merespons, coba lagi")
    if r["status"] == "PENDING" and not r["account_holder"]:
        await _update(db, doc["id"], {"status": "gagal", "error": "Flip masih memproses (PENDING). Coba Cek Rekening lagi beberapa detik lagi."})
        raise ValueError("Flip masih memproses cek rekening. Tunggu sebentar, lalu tap Cek Rekening lagi.")
    if r["status"] != F.INQUIRY_OK or not r["account_holder"]:
        msg = BLOCK_MSG.get(r["status"]) or f"Rekening tidak lolos verifikasi (status Flip: {r['status'] or '-'}). Cek kode bank dan nomor rekening."
        await _update(db, doc["id"], {"status": "gagal", "error": f"{msg} [{r['status'] or '-'}]"})
        raise ValueError(msg)
    await _update(db, doc["id"], {"status": "berhasil", "account_holder": r["account_holder"]})
    await db[BANKS].update_one({"key": _norm(driver_nama)}, {"$set": {"key": _norm(driver_nama), "driver_nama": driver_nama.strip(),
        "bank_code": bank_code, "account_number": acc, "account_holder": r["account_holder"], "verified_at": _iso()}}, upsert=True)
    return {"inquiry_id": doc["id"], "account_holder": r["account_holder"], "bank_code": bank_code,
            "account_masked": mask(acc), "expires_in_min": int(INQUIRY_TTL.total_seconds() // 60)}


async def disburse(db, http, inquiry_id, confirm_name, items_source, remark=""):
    """items_source: koroutin tanpa argumen yang mengembalikan semua item insentif (dari DI.list_items)."""
    cfg = F.config()
    if not cfg["enabled"]:
        raise PermissionError("Transfer Flip belum diaktifkan (FLIP_PAYOUT_ENABLED)")
    inq = await db[COLL].find_one({"id": inquiry_id, "kind": "inquiry"})
    if not inq or inq.get("status") != "berhasil":
        raise ValueError("Cek rekening dulu sebelum transfer")
    if inq.get("used"):
        raise ValueError("Hasil cek rekening ini sudah dipakai. Cek rekening lagi untuk transfer berikutnya")
    try:
        age = _now() - datetime.fromisoformat(inq["created_at"])
    except Exception:
        age = INQUIRY_TTL + timedelta(seconds=1)
    if age > INQUIRY_TTL:
        raise ValueError("Hasil cek rekening sudah kedaluwarsa (lebih dari 15 menit). Cek ulang")
    if _norm(confirm_name) != _norm(inq.get("account_holder")):
        raise ValueError("Nama pemilik rekening yang diketik tidak sama dengan hasil cek. Periksa lagi")
    items = _pending_items((await items_source())["items"], inq["driver_nama"])
    amount = sum(int(i.get("amount") or 0) for i in items)
    if amount <= 0:
        raise ValueError("Tidak ada insentif menunggu untuk driver ini")
    if amount > cfg["max_amount"]:
        raise ValueError(f"Nominal Rp {amount:,} melebihi batas per transfer Rp {cfg['max_amount']:,}".replace(",", "."))

    # kunci inquiry SEBELUM memanggil Flip (satu inquiry = satu transfer, anti klik ganda)
    claim = await db[COLL].update_one({"id": inquiry_id, "used": False}, {"$set": {"used": True, "updated_at": _iso()}})
    if getattr(claim, "modified_count", 1) == 0:
        raise ValueError("Hasil cek rekening ini sudah dipakai")
    log = {"id": "PLG-" + uuid.uuid4().hex[:10], "kind": "disbursement", "status": "diproses", "env": cfg["env"],
           "driver_nama": inq["driver_nama"], "bank_code": inq["bank_code"], "account_number": inq["account_number"],
           "account_holder": inq["account_holder"], "amount": amount, "remark": (remark or "Insentif checkpoint")[:18],
           "item_ids": [i["id"] for i in items], "inquiry_id": inquiry_id, "flip_id": "", "error": "",
           "created_at": _iso()}
    log["idempotency_key"] = log["id"]
    await _log(db, log)
    try:
        r = await _run(F.disburse, http, bank_code=log["bank_code"], account_number=log["account_number"], amount=amount,
                       remark=log["remark"], idempotency_key=log["idempotency_key"])
    except F.FlipError as e:
        await _update(db, log["id"], {"status": "gagal", "error": str(e)[:200]})
        return {"log": _public({**log, "status": "gagal", "error": str(e)[:200]}), "marked": 0}
    except F.FlipUnknown as e:
        await _update(db, log["id"], {"status": "tidak_pasti", "error": "Hasil tidak pasti: " + str(e)})
        return {"log": _public({**log, "status": "tidak_pasti", "error": "Hasil tidak pasti: " + str(e)}), "marked": 0}
    marked = 0
    if r["status"] == "berhasil":
        marked = await _mark_paid(db, log["item_ids"], log["id"], r["flip_id"], log["account_holder"])
    await _update(db, log["id"], {"status": r["status"], "flip_id": r["flip_id"], "error": r["reason"], "response": r["raw"]})
    return {"log": _public({**log, "status": r["status"], "flip_id": r["flip_id"], "error": r["reason"]}), "marked": marked}


async def _mark_paid(db, item_ids, log_id, flip_id, holder):
    n = 0
    acc = None
    for iid in item_ids:
        try:
            item = await DI.set_status(db, iid, "dibayar", f"Flip {flip_id} a.n. {holder} ({log_id})")
            n += 1
        except (ValueError, KeyError):
            continue
        try:   # kas: transfer Flip yang berhasil mengurangi akun "Saldo Flip" (gagal mencatat tidak boleh membatalkan pembayaran)
            acc = acc or await CB.ensure_system_account(db, "flip", "Saldo Flip", "ewallet")
            await CB.post_incentive(db, item, acc["id"], _now().strftime("%Y-%m-%d"))
        except Exception:
            pass
    return n


async def refresh(db, http, log_id):
    """Cek ulang transfer yang 'diproses' / 'tidak_pasti' ke Flip. Kalau ternyata berhasil, item ditandai dibayar."""
    log = await db[COLL].find_one({"id": log_id, "kind": "disbursement"})
    if not log:
        raise KeyError("Log transfer tidak ditemukan")
    if log.get("status") not in ("diproses", "tidak_pasti"):
        return {"log": _public(log), "marked": 0}
    try:
        r = await _run(F.check, http, log["idempotency_key"])
    except (F.FlipError, F.FlipUnknown) as e:
        raise ValueError(f"Gagal cek status ke Flip: {e}")
    marked = 0
    if r["status"] == "berhasil":
        marked = await _mark_paid(db, log.get("item_ids") or [], log["id"], r["flip_id"], log.get("account_holder", ""))
    await _update(db, log["id"], {"status": r["status"], "flip_id": r["flip_id"] or log.get("flip_id", ""), "error": r["reason"]})
    log = await db[COLL].find_one({"id": log_id})
    return {"log": _public(log), "marked": marked}


async def list_logs(db, kind=None, limit=100):
    rows = []
    async for d in db[COLL].find({}):
        if kind and d.get("kind") != kind:
            continue
        rows.append(_public(d))
    rows.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    return rows[:limit]
