"""Pembayaran customer per FAKTUR (doc_history jenis=invoice).

Faktur gabungan (mis. 5 PO sekaligus) ditagih sebagai 1 dokumen, jadi pembayaran
dicatat di level faktur: daftar `payments` di record faktur. ADDITIVE — total &
baris faktur asli tidak pernah diubah; sisa tagihan = total faktur − pembayaran.

Modul murni (tanpa DB/FastAPI) supaya gampang dites.
"""
import re
import uuid
from datetime import datetime, timezone

MAX_AMOUNT = 10 ** 13           # batas sanity (Rp 10 triliun)
DEFAULT_METODE = "Transfer BCA"


def make_payment(amount, tanggal="", metode="", catatan="", today="", now_iso=None):
    """Validasi + normalisasi 1 pembayaran. Raise ValueError (pesan Indonesia)
    kalau nominal tidak sah."""
    try:
        amt = int(amount)
    except (TypeError, ValueError):
        raise ValueError("Jumlah pembayaran tidak valid")
    if amt <= 0:
        raise ValueError("Jumlah pembayaran harus lebih dari 0")
    if amt > MAX_AMOUNT:
        raise ValueError("Jumlah pembayaran tidak masuk akal")
    tgl = (tanggal or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", tgl):
        tgl = today
    return {
        "id": "PAY-" + uuid.uuid4().hex[:8],
        "amount": amt,
        "tanggal": tgl,
        "metode": ((metode or "").strip() or DEFAULT_METODE)[:40],
        "catatan": (catatan or "").strip()[:300],
        "created_at": now_iso or datetime.now(timezone.utc).isoformat(),
    }


def total_paid(payments):
    """Jumlah semua pembayaran yang tercatat (abaikan entri rusak)."""
    t = 0
    for p in payments or []:
        try:
            t += int((p or {}).get("amount") or 0)
        except (TypeError, ValueError):
            continue
    return t


def summarize(total, payments):
    """Ringkasan tagihan: diterima, sisa, status.
    status: 'Belum Bayar' | 'Sebagian' | 'Lunas' | 'Lebih Bayar'."""
    total = int(total or 0)
    paid = total_paid(payments)
    sisa = total - paid
    if paid <= 0:
        status = "Belum Bayar"
    elif sisa > 0:
        status = "Sebagian"
    elif sisa == 0:
        status = "Lunas"
    else:
        status = "Lebih Bayar"
    return {"total": total, "diterima": paid, "sisa": sisa, "status": status}


def find_payment(payments, payment_id):
    """Cari 1 pembayaran by id (None kalau tidak ada)."""
    for p in payments or []:
        if (p or {}).get("id") == payment_id:
            return p
    return None


def kwitansi_no(seq, iso_date):
    """Nomor kwitansi: KWT0001_DDMMYYYY_YYYY (gaya sama dgn nomor faktur).
    iso_date = 'YYYY-MM-DD' (tanggal terbit)."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso_date or "")
    yyyy, mm, dd = m.groups() if m else ("0000", "00", "00")
    return f"KWT{int(seq):04d}_{dd}{mm}{yyyy}_{yyyy}"
