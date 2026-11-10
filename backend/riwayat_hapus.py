"""HAPUS PERMANEN riwayat pembayaran lama yang sudah LUNAS (tab Selesai) — logika murni, tanpa I/O.

Aturan keselamatan (semuanya dicek di sini, bukan di tampilan):
  * Hanya pembayaran yang SELURUH unit alokasinya sudah lunas.
  * Hanya pembayaran bertanggal <= `sampai` (batas tanggal wajib diisi pemanggil).
  * Unit lunas ikut dihapus bersama pembayarannya (data lama sudah ada di sistem lain). Supaya angka
    unit lain tidak ikut bergeser, SEMUA pembayaran yang menyentuh sebuah unit harus ikut dipilih;
    kalau ada pembayaran lain yang menyentuh unit itu, operasi DIBLOKIR (bukan dihapus sebagian).
  * Pembayaran rekon yang sudah dibatalkan (reversed) tidak dihitung/diubah.
Kunci pembayaran sama dengan riwayat_clear: rk:<rekon_payment.id> | tx:<batch_id|payment.id>.
"""


def _rk_units(p):
    return [a.get("job_id") for a in (p.get("allocations") or []) if a.get("job_id") and (a.get("amount") or 0) > 0]


def _rk_allocated(p):
    amt = p.get("amount") or 0
    return amt > 0 and sum((a.get("amount") or 0) for a in (p.get("allocations") or [])) >= amt


def plan(doc, keys, settled_ids, sampai):
    """Hitung dampak penghapusan. Return dict: ok, blokir[], dampak{}, unit_ids, rekon_ids.
    `settled_ids` = himpunan id unit yang lunas (dihitung server dari angka yang sama dengan tab Selesai)."""
    keys = list(dict.fromkeys(str(k) for k in (keys or []) if k))
    blokir = []
    if not keys:
        return {"ok": False, "blokir": ["Pilih minimal 1 pembayaran"], "dampak": {}, "unit_ids": [], "rekon_ids": []}
    if not sampai:
        return {"ok": False, "blokir": ["Batas tanggal ('sampai') wajib diisi"], "dampak": {}, "unit_ids": [], "rekon_ids": []}
    jobs = {j.get("id"): j for j in (doc.get("jobs") or [])}
    rks = {p.get("id"): p for p in (doc.get("rekon_payments") or []) if p.get("id")}
    # peta: kunci pembayaran -> {unit}, dan unit -> {kunci pembayaran yang menyentuhnya}
    key_units, unit_keys, key_info = {}, {}, {}
    for pid, p in rks.items():
        if p.get("status") == "reversed":
            continue
        k = f"rk:{pid}"
        us = set(_rk_units(p))
        key_units[k] = us
        key_info[k] = {"kind": "rekon", "tanggal": str(p.get("tanggal") or "")[:10], "amount": p.get("amount") or 0, "alloc": _rk_allocated(p)}
        for u in us:
            unit_keys.setdefault(u, set()).add(k)
    for jid, j in jobs.items():
        for p in (j.get("payments") or []):
            kk = p.get("batch_id") or p.get("id")
            if not kk:
                continue
            k = f"tx:{kk}"
            key_units.setdefault(k, set()).add(jid)
            unit_keys.setdefault(jid, set()).add(k)
            inf = key_info.setdefault(k, {"kind": "manual", "tanggal": "", "amount": 0, "alloc": True})
            inf["amount"] += p.get("amount") or 0
            td = str(p.get("tanggal") or "")[:10]
            if td > inf["tanggal"]:
                inf["tanggal"] = td
    units, rekon_ids = set(), []
    for k in keys:
        if k not in key_info:
            blokir.append(f"Pembayaran {k} tidak ditemukan (atau sudah dibatalkan/dihapus)")
            continue
        inf = key_info[k]
        if not inf["alloc"]:
            blokir.append(f"Pembayaran {k} belum teralokasi penuh ke unit — tidak dihapus")
        if inf["tanggal"] and inf["tanggal"] > sampai:
            blokir.append(f"Pembayaran {k} tanggal {inf['tanggal']} melewati batas {sampai}")
        if not key_units.get(k):
            blokir.append(f"Pembayaran {k} tidak terhubung ke unit — tidak dihapus lewat jalur ini")
        units |= key_units.get(k, set())
        if k.startswith("rk:"):
            rekon_ids.append(k[3:])
    ks = set(keys)
    for u in sorted(units):
        if u not in settled_ids:
            blokir.append(f"Unit {(jobs.get(u) or {}).get('nopol') or u} belum lunas — pembayaran yang menyentuhnya tidak boleh dihapus")
        lain = sorted(unit_keys.get(u, set()) - ks)
        if lain:
            blokir.append(f"Unit {(jobs.get(u) or {}).get('nopol') or u} juga dibayar oleh pembayaran lain yang tidak dipilih: {', '.join(lain[:3])}. Pilih semuanya sekaligus atau jangan hapus.")
    units_list = sorted(units)
    tot_unit = sum((jobs[u].get("total_harga") or 0) for u in units_list if u in jobs)
    rk_tot = sum(key_info[k]["amount"] for k in keys if k.startswith("rk:") and k in key_info)
    mn_tot = sum(key_info[k]["amount"] for k in keys if k.startswith("tx:") and k in key_info)
    return {"ok": not blokir, "blokir": blokir, "unit_ids": units_list, "rekon_ids": rekon_ids,
            "dampak": {"jumlah_unit": len(units_list), "total_tagihan_unit": tot_unit,
                       "pembayaran_rekon": len(rekon_ids), "total_rekon": rk_tot,
                       "pembayaran_manual": len([k for k in keys if k.startswith("tx:")]), "total_manual": mn_tot}}


def apply(doc, p, keys):
    """Hasil dokumen SETELAH hapus (input tidak dimutasi): jobs, rekon_payments, riwayat_clear, selesai_sembunyi."""
    u = set(p["unit_ids"]); r = set(p["rekon_ids"]); ks = set(keys)
    return {
        "jobs": [j for j in (doc.get("jobs") or []) if j.get("id") not in u],
        "rekon_payments": [x for x in (doc.get("rekon_payments") or []) if x.get("id") not in r],
        "riwayat_clear": [e for e in (doc.get("riwayat_clear") or []) if e.get("key") not in ks],
        "selesai_sembunyi": [e for e in (doc.get("selesai_sembunyi") or []) if not (isinstance(e, dict) and e.get("job_id") in u)],
    }
