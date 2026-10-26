"""
Nomor faktur dobel di Histori Dokumen: 1 nomor tersimpan lebih dari sekali (mis. cetak ulang / revisi
dengan nomor manual yang sama). Alat ini menampilkan kelompoknya dan merapikan dengan aman.

Aturan:
  - Yang dipertahankan: yang dipilih Pemilik/Keuangan; saran = satu-satunya yang punya pembayaran,
    kalau tidak ada = yang terbaru.
  - Yang punya PEMBAYARAN tidak pernah dihapus otomatis (ditolak) supaya catatan bayar tidak hilang.
  - Yang dihapus DIPINDAH ke `doc_history_deleted` (cadangan), bukan dihapus permanen.
"""
from datetime import datetime, timezone

DELETED = "doc_history_deleted"


def _subtotal(lines):
    return sum((int(l.get("harga") or 0)) * (int(l.get("qty") or 1)) for l in (lines or []))


def _row(d):
    pays = d.get("payments") or []
    return {
        "id": d.get("id"),
        "created_at": d.get("created_at"),
        "customer": d.get("customer") or "",
        "baris": len(d.get("lines") or []),
        "subtotal": _subtotal(d.get("lines")),
        "pembayaran_n": len(pays),
        "pembayaran_total": sum(int(p.get("amount") or 0) for p in pays),
        "stempel": bool((d.get("meta") or {}).get("stempel")),
    }


async def _groups(db):
    g = {}
    async for d in db.doc_history.find({"jenis": "invoice"}, {"_id": 0}):
        no = (d.get("no_dokumen") or "").strip()
        if no:
            g.setdefault(no, []).append(d)
    return {k: v for k, v in g.items() if len(v) > 1}


def _saran(docs):
    with_pay = [d for d in docs if d.get("payments")]
    if len(with_pay) == 1:
        return with_pay[0]["id"]
    return sorted(docs, key=lambda d: d.get("created_at") or "")[-1]["id"]


async def list_dups(db):
    out = []
    for no, docs in (await _groups(db)).items():
        docs = sorted(docs, key=lambda d: d.get("created_at") or "", reverse=True)
        out.append({"no_dokumen": no, "saran_pertahankan": _saran(docs), "items": [_row(d) for d in docs]})
    out.sort(key=lambda x: x["items"][0].get("created_at") or "", reverse=True)
    return out


async def bereskan(db, no_dokumen, keep_id=None, dry_run=True, by="pemilik"):
    docs = (await _groups(db)).get((no_dokumen or "").strip())
    if not docs:
        raise LookupError("Nomor ini tidak dobel (atau sudah dirapikan)")
    ids = {d["id"] for d in docs}
    keep = keep_id or _saran(docs)
    if keep not in ids:
        raise ValueError("Faktur yang dipertahankan bukan bagian dari nomor ini")
    hapus = [d for d in docs if d["id"] != keep]
    terlindungi = [d for d in hapus if d.get("payments")]
    if terlindungi:
        raise ValueError("Ada faktur dobel yang sudah punya catatan pembayaran. Pertahankan yang itu atau pindahkan pembayarannya dulu.")
    plan = {"no_dokumen": no_dokumen, "dipertahankan": keep, "dihapus": len(hapus), "dry_run": bool(dry_run)}
    if dry_run:
        return plan
    now = datetime.now(timezone.utc).isoformat()
    for d in hapus:
        await db[DELETED].insert_one({**d, "deleted_at": now, "deleted_by": by, "alasan": "nomor dobel", "dipertahankan": keep})
        await db.doc_history.delete_one({"id": d["id"]})
    return plan
