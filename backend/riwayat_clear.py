"""CLEAR / ARSIP Riwayat Pembayaran Supplier — logika murni (tanpa I/O).

Hanya menandai item riwayat sebagai 'cleared' di field aditif `riwayat_clear[]` pada dokumen
supplier. TIDAK menghapus/mengubah transaksi bank, rekon_payments, jobs[].payments, alokasi PO,
maupun status pembayaran. Setiap entri menyimpan jejak (history) supaya audit trail utuh dan
bisa dikembalikan.

Kunci item riwayat:
  rk:<rekon_payment.id>            → pembayaran Rekon (Audit Rekon Bank)
  tx:<batch_id | payment.id>       → transaksi pembayaran manual (1 batch = 1 transaksi)
"""


def valid_keys(doc):
    """Semua kunci riwayat yang ADA di dokumen supplier ini → jenisnya."""
    out = {}
    for p in (doc.get("rekon_payments") or []):
        if p.get("id"):
            out[f"rk:{p['id']}"] = "rekon"
    for j in (doc.get("jobs") or []):
        for p in (j.get("payments") or []):
            k = p.get("batch_id") or p.get("id")
            if k:
                out[f"tx:{k}"] = "manual"
    return out


def cleared_keys(entries):
    """Kunci yang SEDANG ter-clear (status 'cleared')."""
    return {e.get("key") for e in (entries or []) if e.get("status") == "cleared"}


def apply_clear(entries, keys, kinds, now_iso, by):
    """Tandai `keys` sebagai cleared. Idempoten. Return list entri baru (input tidak dimutasi)."""
    new = [dict(e, history=list(e.get("history") or [])) for e in (entries or [])]
    idx = {e.get("key"): e for e in new}
    for k in keys:
        e = idx.get(k)
        if e is None:
            e = {"key": k, "kind": kinds.get(k, ""), "status": "cleared", "cleared_at": now_iso,
                 "cleared_by": by, "history": [{"action": "clear", "at": now_iso, "by": by}]}
            new.append(e); idx[k] = e
        elif e.get("status") != "cleared":
            e.update({"status": "cleared", "cleared_at": now_iso, "cleared_by": by})
            e["history"].append({"action": "clear", "at": now_iso, "by": by})
    return new


def apply_unclear(entries, keys, now_iso, by):
    """Kembalikan `keys` dari clear (status 'restored'; jejak tetap disimpan). Idempoten."""
    new = [dict(e, history=list(e.get("history") or [])) for e in (entries or [])]
    ks = set(keys)
    for e in new:
        if e.get("key") in ks and e.get("status") == "cleared":
            e.update({"status": "restored", "restored_at": now_iso, "restored_by": by})
            e["history"].append({"action": "restore", "at": now_iso, "by": by})
    return new
