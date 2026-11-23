"""Log audit Supplier / Pembayaran (APPEND-ONLY).

Koleksi `supplier_audit_log`. Tidak ada fungsi/endpoint untuk mengubah atau menghapus entri.
Menyimpan SNAPSHOT (before/after) supaya data yang dihapus / dipindah masih bisa direkonstruksi,
termasuk pembayaran yang keluar dari dokumen supplier saat unit/pembayaran manual dihapus.

Aksi (action): supplier.archive | supplier.restore | supplier.delete (hanya supplier kosong) |
job.delete | payment.delete | payment.relink | alloc.move | invoice.reimport | rekon.reverse | dll.
"""
import uuid
from datetime import datetime, timezone

COLL = "supplier_audit_log"
MAX_REASON = 300


def _now():
    return datetime.now(timezone.utc).isoformat()


def make_entry(action, by, *, supplier_id="", job_id="", payment_id="", btid="", reason="",
               before=None, after=None, extra=None, now_iso=None):
    return {
        "id": uuid.uuid4().hex[:12],
        "at": now_iso or _now(),
        "by": str(by or "Admin")[:80],
        "action": str(action),
        "supplier_id": str(supplier_id or ""),
        "job_id": str(job_id or ""),
        "payment_id": str(payment_id or ""),
        "bank_transaction_id": str(btid or ""),
        "reason": str(reason or "")[:MAX_REASON],
        "before": before,
        "after": after,
        "extra": extra or {},
    }


async def write(db, action, by, **kw):
    """Tulis 1 entri. Dikembalikan entri yang ditulis (tanpa _id)."""
    e = make_entry(action, by, **kw)
    await db[COLL].insert_one(dict(e))
    return e


async def list_entries(db, *, supplier_id="", action="", btid="", limit=200):
    filt = {}
    if supplier_id:
        filt["supplier_id"] = supplier_id
    if action:
        filt["action"] = action
    if btid:
        filt["bank_transaction_id"] = btid
    out = []
    cur = db[COLL].find(filt, {"_id": 0}).sort("at", -1).limit(max(1, min(int(limit or 200), 1000)))
    async for d in cur:
        out.append(d)
    return out


def punya_riwayat_pembayaran(doc, jumlah_import=0):
    """True bila supplier punya jejak pembayaran apa pun (rekon bank, pembayaran manual di unit, atau baris impor bank)."""
    if jumlah_import:
        return True
    if doc.get("rekon_payments"):
        return True
    for j in (doc.get("jobs") or []):
        if j.get("payments"):
            return True
    return False
