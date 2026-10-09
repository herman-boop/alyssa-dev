"""
Kas & Bank: akun (bank / kas tunai / dompet seperti Saldo Flip) dan mutasinya. Saldo SELALU dihitung ulang:
  saldo = saldo_awal + total masuk - total keluar   (mutasi berstatus void tidak dihitung)

Koleksi:
  cash_accounts  {id, nama, jenis: bank|kas|ewallet, entity_id, saldo_awal, sistem, aktif, created_at}
  cash_txns      {id, account_id, tanggal, arah: masuk|keluar, amount, keterangan, kategori, ref, key,
                  transfer_id, bukti_url, void, void_alasan, created_at}

Prinsip: tidak ada hapus (koreksi = void dengan alasan), mutasi otomatis memakai `key` unik supaya tidak dobel,
pindah saldo antar akun = 2 mutasi bertautan (transfer_id) yang di-void bersamaan. Modul ini tidak mengubah
data keuangan lain; hanya mencatat mutasi.
"""
import re
import uuid
from datetime import datetime, timezone

ACCOUNTS = "cash_accounts"
TXNS = "cash_txns"
JENIS = ("bank", "kas", "ewallet")
MAX_RP = 100_000_000_000


def _now():
    return datetime.now(timezone.utc).isoformat()


def _gid(prefix):
    return prefix + uuid.uuid4().hex[:10]


def _s(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _norm(v):
    return re.sub(r"\s+", " ", str(v or "")).strip().lower()


def _amount(v, label="Nominal", allow_zero=False):
    try:
        n = int(round(float(str(v if v is not None else 0).replace(".", "").replace(",", "."))))
    except Exception:
        raise ValueError(f"{label} harus angka")
    if n < 0 or n > MAX_RP or (n == 0 and not allow_zero):
        raise ValueError(f"{label} harus lebih dari 0" if n <= 0 else f"{label} di luar batas")
    return n


def _date(v, today):
    s = str(v or "").strip()[:10]
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else today


def _pub(d):
    return {k: v for k, v in d.items() if k != "_id"}


async def create_account(db, nama, jenis="bank", saldo_awal=0, entity_id="", sistem=""):
    nama = _s(nama, 80)
    if not nama:
        raise ValueError("Nama akun wajib diisi")
    if jenis not in JENIS:
        raise ValueError("Jenis akun harus bank, kas, atau ewallet")
    async for a in db[ACCOUNTS].find({}):
        if _norm(a.get("nama")) == _norm(nama):
            raise ValueError("Nama akun sudah ada")
    doc = {"id": _gid("ACC-"), "nama": nama, "jenis": jenis, "entity_id": _s(entity_id, 40),
           "saldo_awal": _amount(saldo_awal or 0, "Saldo awal", allow_zero=True),
           "sistem": sistem, "aktif": True, "created_at": _now()}
    await db[ACCOUNTS].insert_one(dict(doc))
    return doc


async def ensure_system_account(db, sistem, nama, jenis="ewallet"):
    """Akun bawaan sistem (mis. 'flip' = Saldo Flip). Dibuat sekali saat dibutuhkan, saldo awal 0."""
    async for a in db[ACCOUNTS].find({"sistem": sistem}):
        return _pub(a)
    try:
        return await create_account(db, nama, jenis, 0, "", sistem)
    except ValueError:      # nama sudah dipakai akun manual -> pakai nama berbeda
        return await create_account(db, nama + " (sistem)", jenis, 0, "", sistem)


async def _txns_of(db, account_id=None, include_void=False):
    rows = []
    async for t in db[TXNS].find({}):
        if account_id and t.get("account_id") != account_id:
            continue
        if t.get("void") and not include_void:
            continue
        rows.append(_pub(t))
    return rows


async def list_accounts(db):
    accs = [_pub(a) async for a in db[ACCOUNTS].find({})]
    tx = await _txns_of(db)
    out = []
    for a in sorted(accs, key=lambda x: x.get("created_at") or ""):
        masuk = sum(t["amount"] for t in tx if t["account_id"] == a["id"] and t["arah"] == "masuk")
        keluar = sum(t["amount"] for t in tx if t["account_id"] == a["id"] and t["arah"] == "keluar")
        out.append(dict(a, masuk=masuk, keluar=keluar, saldo=int(a.get("saldo_awal") or 0) + masuk - keluar))
    return {"items": out, "total_saldo": sum(a["saldo"] for a in out if a.get("aktif", True))}


async def add_txn(db, account_id, arah, amount, tanggal, keterangan, today, bukti_url=None, kategori="manual", ref=None, key=None, transfer_id=None):
    if arah not in ("masuk", "keluar"):
        raise ValueError("Arah harus masuk atau keluar")
    if not await db[ACCOUNTS].find_one({"id": account_id}):
        raise KeyError("Akun tidak ditemukan")
    if key:
        old = await db[TXNS].find_one({"key": key, "void": False})
        if old:
            return _pub(old), False          # sudah tercatat: tidak dobel
    doc = {"id": _gid("TX-"), "account_id": account_id, "tanggal": _date(tanggal, today), "arah": arah,
           "amount": _amount(amount), "keterangan": _s(keterangan, 200), "kategori": kategori, "ref": ref or {},
           "key": key or "", "transfer_id": transfer_id or "", "bukti_url": bukti_url or None,
           "void": False, "void_alasan": "", "created_at": _now()}
    await db[TXNS].insert_one(dict(doc))
    return doc, True


async def transfer(db, from_id, to_id, amount, tanggal, keterangan, today, biaya_admin=0, bukti_url=None):
    """Pindah saldo antar akun (mis. top up Saldo Flip dari Mandiri). Biaya admin (opsional) = keluar tambahan dari akun asal."""
    if from_id == to_id:
        raise ValueError("Akun asal dan tujuan tidak boleh sama")
    for i in (from_id, to_id):
        if not await db[ACCOUNTS].find_one({"id": i}):
            raise KeyError("Akun tidak ditemukan")
    amt = _amount(amount)
    fee = _amount(biaya_admin, "Biaya admin", allow_zero=True) if str(biaya_admin).strip() else 0
    tid = _gid("TRF-")
    ket = _s(keterangan, 200) or "Pindah saldo"
    a, _ = await add_txn(db, from_id, "keluar", amt, tanggal, ket, today, bukti_url, "transfer", transfer_id=tid)
    b, _ = await add_txn(db, to_id, "masuk", amt, tanggal, ket, today, bukti_url, "transfer", transfer_id=tid)
    f = None
    if fee:
        f, _ = await add_txn(db, from_id, "keluar", fee, tanggal, "Biaya admin: " + ket, today, None, "biaya_admin", transfer_id=tid)
    return {"transfer_id": tid, "keluar": a, "masuk": b, "biaya_admin": f}


async def void_txn(db, txn_id, alasan, allow_auto=False):
    t = await db[TXNS].find_one({"id": txn_id})
    if not t:
        raise KeyError("Mutasi tidak ditemukan")
    if t.get("void"):
        raise ValueError("Mutasi sudah dibatalkan")
    if t.get("key") and not allow_auto:
        raise ValueError("Mutasi otomatis dari Insentif Driver. Batalkan lewat menu Insentif Driver (Buka lagi)")
    alasan = _s(alasan, 200)
    if not alasan:
        raise ValueError("Alasan pembatalan wajib diisi")
    n = 0
    async for x in db[TXNS].find({}):
        if x["id"] == txn_id or (t.get("transfer_id") and x.get("transfer_id") == t["transfer_id"]):
            if not x.get("void"):
                await db[TXNS].update_one({"id": x["id"]}, {"$set": {"void": True, "void_alasan": alasan}})
                n += 1
    return {"voided": n}


async def list_txns(db, account_id, date_from=None, date_to=None, include_void=False):
    acc = await db[ACCOUNTS].find_one({"id": account_id})
    if not acc:
        raise KeyError("Akun tidak ditemukan")
    rows = await _txns_of(db, account_id, include_void=True)
    rows.sort(key=lambda x: (x.get("tanggal") or "", x.get("created_at") or ""))
    run = int(acc.get("saldo_awal") or 0)
    for r in rows:
        if not r.get("void"):
            run += r["amount"] if r["arah"] == "masuk" else -r["amount"]
        r["saldo_setelah"] = run
    out = [r for r in rows if (include_void or not r.get("void"))
           and (not date_from or (r.get("tanggal") or "") >= date_from) and (not date_to or (r.get("tanggal") or "") <= date_to)]
    out.reverse()
    return {"account": _pub(acc), "items": out, "saldo": run}


# ── Integrasi Insentif Driver ───────────────────────────────────────────────
def ins_key(item_id):
    return "ins:" + str(item_id)


async def post_incentive(db, item, account_id, today, bukti_url=None):
    """Insentif ditandai dibayar -> mutasi keluar dari akun. Idempoten per insentif."""
    return await add_txn(db, account_id, "keluar", item.get("amount") or 0, (item.get("paid_at") or "")[:10] or today, 
                         f"Insentif checkpoint {item.get('driver_nama') or ''} {item.get('date') or ''}".strip(), today,
                         bukti_url, "insentif", {"type": "insentif", "id": item.get("id"), "trip_id": item.get("trip_id")}, ins_key(item.get("id")))


async def void_incentive(db, item_id, alasan="Insentif dibuka lagi"):
    t = await db[TXNS].find_one({"key": ins_key(item_id), "void": False})
    if not t:
        return {"voided": 0}
    return await void_txn(db, t["id"], alasan, allow_auto=True)
