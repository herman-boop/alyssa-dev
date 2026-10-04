"""
pnl.py — Laporan Laba Rugi (Profit & Loss), bagian MURNI (tanpa DB).

Rumus:
    Pendapatan − HPP            = Laba Kotor
    Laba Kotor − Biaya/Beban    = Laba Bersih (operasional)

Angka berasal dari transaksi aktual (dihitung di server dari orders/trips untuk
Pendapatan, supplier jobs untuk HPP, expenses untuk Biaya). Modul ini hanya
filter periode/entitas + agregasi akhir, supaya bisa diuji tanpa MongoDB.
"""
import re

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def in_period(d, date_from=None, date_to=None):
    """True kalau tanggal `d` (YYYY-MM-DD / ISO) ada dalam [date_from, date_to]
    inklusif. Tanggal tidak valid → hanya ikut kalau TIDAK ada filter periode
    (biar data tanpa tanggal tidak bocor ke laporan ber-periode)."""
    s = str(d or "")[:10]
    if not _DATE.match(s):
        return not (date_from or date_to)
    if date_from and s < date_from:
        return False
    if date_to and s > date_to:
        return False
    return True


def entity_key(e, valid):
    """Normalisasi key entitas untuk pengelompokan: entitas sah apa adanya,
    selain itu 'none' (belum diisi) — JANGAN menebak PT/CV."""
    return e if e in valid else "none"


def entity_match(e, want, valid):
    """Apakah entitas `e` lolos filter `want` ('' = semua, 'none' = belum diisi,
    atau id entitas tertentu)."""
    e = e or ""
    if not want:
        return True
    if want == "none":
        return entity_key(e, valid) == "none"
    return e == want


def compute_pnl(agg):
    """agg: {ent_key: {pendapatan, hpp, biaya}} → lengkapi laba_kotor & laba_bersih
    per entitas + grand_total. Semua int; tidak pernah mencampur antar entitas."""
    per_entity, grand = {}, {"pendapatan": 0, "hpp": 0, "laba_kotor": 0, "biaya": 0, "laba_bersih": 0}
    for k, v in (agg or {}).items():
        p = int(v.get("pendapatan") or 0)
        h = int(v.get("hpp") or 0)
        b = int(v.get("biaya") or 0)
        lk = p - h
        lb = lk - b
        per_entity[k] = {"pendapatan": p, "hpp": h, "laba_kotor": lk, "biaya": b, "laba_bersih": lb}
        grand["pendapatan"] += p
        grand["hpp"] += h
        grand["biaya"] += b
    grand["laba_kotor"] = grand["pendapatan"] - grand["hpp"]
    grand["laba_bersih"] = grand["laba_kotor"] - grand["biaya"]
    return {"per_entity": per_entity, "grand_total": grand}
