"""Laporan rekonsiliasi bank <-> tagihan per supplier/orang (BACA-SAJA, logika murni).

Memadukan semua profil yang cocok (aktif, diarsipkan, digabung; kembar nama) dengan semua transaksi bank terkait, lalu melaporkan:
  - tiap transaksi: status import, di profil mana, alokasi sah vs alokasi yatim, tersembunyi (Clear), ditahan, kelas;
  - pasangan kemungkinan salinan (sidik tanggal + nominal + rekening sumber + identitas pendukung) dan sisi mana yang tersembunyi;
  - ringkasan: total bank, nominal yang terdeteksi sebagai salinan, perkiraan total tanpa salinan, tagihan aktif, selisih.
TIDAK mengasumsikan semua transaksi bank teralokasi atau semuanya milik tagihan yang tampil. Tidak ada yang diubah.
"""
import rekon_dup
import rekon_orphans


def _i(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def _cleared(sup):
    return {e.get("key") for e in (sup.get("riwayat_clear") or []) if e.get("status") == "cleared"}


def susun(profiles, imports, hitung):
    """`profiles` = dokumen supplier; `imports` = baris bank_payment_imports; `hitung(sup)` -> (jobs_totals, overview) dari server
    (rumus yang SAMA dengan halaman Supplier). Return dict laporan."""
    by_id = {p["id"]: p for p in profiles}
    prof_out, tagihan = [], {"total_invoice": 0, "net_transfer": 0, "terbayar": 0, "sisa": 0, "belum_lunas": 0, "unit": 0}
    pay_loc = {}                      # btid -> {supplier_id, payment, cleared}
    for sup in profiles:
        aktif = sup.get("status") not in ("archived", "merged")
        jobs, rk = hitung(sup)
        cl = _cleared(sup)
        ids_job = {j.get("id") for j in (sup.get("jobs") or [])}
        row = {"id": sup["id"], "nama": sup.get("nama"), "status": sup.get("status") or "aktif", "aktif": aktif, "jumlah_unit": len(jobs),
               "total_invoice": sum(_i(j.get("total_invoice") if j.get("total_invoice") is not None else j.get("total_harga")) for j in jobs),
               "net_transfer": sum(_i(j.get("net_transfer") if j.get("net_transfer") is not None else j.get("total_harga")) for j in jobs),
               "terbayar": sum(_i(j.get("total_terbayar")) for j in jobs), "sisa": sum(_i(j.get("sisa_transfer") if j.get("sisa_transfer") is not None else j.get("sisa")) for j in jobs),
               "belum_lunas": sum(1 for j in jobs if _i(j.get("sisa_transfer") if j.get("sisa_transfer") is not None else j.get("sisa")) > 0),
               "rekon_aktif": {"jumlah": len(rk["rekon_payments"]), "nominal": rk["total_rekon"], "teralokasi": rk["total_rekon_allocated"],
                               "belum_dialokasikan": rk["total_unallocated"], "alokasi_yatim": rk.get("total_alokasi_yatim", 0)},
               "tersembunyi": {"jumlah": sum(1 for p in rk["rekon_payments"] if f"rk:{p.get('id')}" in cl),
                               "nominal": sum(_i(p.get("amount")) for p in rk["rekon_payments"] if f"rk:{p.get('id')}" in cl)},
               "ditahan": {"jumlah": len(rk.get("perlu_verifikasi") or []), "nominal": rk.get("total_perlu_verifikasi", 0)},
               "dibatalkan": sum(1 for p in (sup.get("rekon_payments") or []) if p.get("status") == "reversed"),
               "dipindah_keluar": len(sup.get("rekon_payments_dipindah") or [])}
        prof_out.append(row)
        if aktif:
            for k in ("total_invoice", "net_transfer", "terbayar", "sisa", "belum_lunas"):
                tagihan[k] += row[k]
            tagihan["unit"] += row["jumlah_unit"]
        for p in (sup.get("rekon_payments") or []):
            valid = sum(_i(a.get("amount")) for a in (p.get("allocations") or []) if a.get("job_id") in ids_job and _i(a.get("amount")) > 0)
            yatim = sum(_i(a.get("amount")) for a in (p.get("allocations") or []) if a.get("job_id") and a.get("job_id") not in ids_job and _i(a.get("amount")) > 0)
            pay_loc[p.get("bank_transaction_id")] = {"supplier_id": sup["id"], "payment": p, "tersembunyi": f"rk:{p.get('id')}" in cl, "valid": valid, "yatim": yatim}
        for p in (sup.get("rekon_payments_tahan") or []):
            pay_loc.setdefault(p.get("bank_transaction_id"), {"supplier_id": sup["id"], "payment": p, "tersembunyi": False, "valid": 0, "yatim": 0, "ditahan": True})

    kelas = {r["bank_transaction_id"]: r for r in rekon_orphans.klasifikasi(imports, by_id)}
    tx = []
    for imp in sorted(imports, key=lambda d: (str(d.get("tanggal") or ""), str(d.get("bank_transaction_id")))):
        btid = imp.get("bank_transaction_id")
        loc = pay_loc.get(btid) or {}
        sup = by_id.get(imp.get("supplier_id"))
        k = kelas.get(btid)
        tx.append({"bank_transaction_id": btid, "tanggal": imp.get("tanggal") or "", "nominal": _i(imp.get("amount") or imp.get("nominal")),
                   "status_import": imp.get("status"), "dup_status": imp.get("dup_status") or "", "referensi_bank": imp.get("referensi_bank") or "",
                   "supplier_import": imp.get("supplier_id"), "supplier_ada": sup is not None, "supplier_status": (sup or {}).get("status") or ("aktif" if sup else "tidak_ada"),
                   "ada_di_profil": loc.get("supplier_id"), "alokasi_sah": loc.get("valid", 0), "alokasi_yatim": loc.get("yatim", 0),
                   "tersembunyi": bool(loc.get("tersembunyi")), "ditahan": bool(loc.get("ditahan")),
                   "kelas": (k or {}).get("kelas") or ("dibatalkan" if imp.get("status") == "reversed" else ("tertaut" if loc.get("valid") else "")),
                   "salinan_dari": None, "kemungkinan_salinan": []})
    tx_by = {t["bank_transaction_id"]: t for t in tx}
    pasangan = []
    for pr in rekon_dup.cari_pasangan(imports):
        a, b = tx_by[pr["a"]], tx_by[pr["b"]]
        # sisi yang diduga salinan: yang tersembunyi/ditahan; bila keduanya sama -> tidak ditentukan (butuh keputusan Approver)
        skor = lambda t: (2 if t["ditahan"] else 0) + (1 if t["tersembunyi"] else 0)
        salinan = None
        if skor(a) != skor(b):
            salinan = a if skor(a) > skor(b) else b
        asli = b if salinan is a else a
        pasangan.append({**pr, "diduga_salinan": salinan["bank_transaction_id"] if salinan else None, "diduga_asli": asli["bank_transaction_id"] if salinan else None})
        for x, y in ((a, b), (b, a)):
            x["kemungkinan_salinan"].append({"dengan": y["bank_transaction_id"], "tingkat": pr["tingkat"], "bukti": pr["bukti"]})
        if salinan:
            salinan["salinan_dari"] = asli["bank_transaction_id"]

    proc = [t for t in tx if t["status_import"] == "processed"]
    teremban = [t for t in proc if t["tersembunyi"]]
    salinan_tersembunyi = [t for t in teremban if t["salinan_dari"]]
    salinan_nominal = sum(t["nominal"] for t in proc if t["salinan_dari"])
    bank_total = sum(t["nominal"] for t in proc)
    net = tagihan["net_transfer"]
    per_kelas = {}
    for t in tx:
        d = per_kelas.setdefault(t["kelas"] or "lainnya", {"jumlah": 0, "nominal": 0}); d["jumlah"] += 1; d["nominal"] += t["nominal"]
    catatan = []
    if teremban:
        catatan.append(f"{len(teremban)} transaksi tersembunyi (Clear) senilai Rp{sum(t['nominal'] for t in teremban):,}: {len(salinan_tersembunyi)} terdeteksi sebagai kemungkinan salinan dari transaksi lain "
                       f"(Rp{sum(t['nominal'] for t in salinan_tersembunyi):,}); sisanya tidak punya pasangan menurut sidik dan tetap dihitung sebagai pembayaran sah sampai diverifikasi.".replace(",", "."))
    if any(p["diduga_salinan"] is None for p in pasangan):
        catatan.append("Ada pasangan kemungkinan salinan yang belum bisa ditentukan sisi aslinya; perlu keputusan Super Admin / Finance Approver.")
    if any(t["kelas"] in ("supplier_hilang", "pembayaran_hilang", "alokasi_yatim") for t in tx):
        catatan.append("Ada pembayaran yang referensinya terputus (Perlu Rekonsiliasi / Perlu Hubungkan Ulang).")
    ringkas = {
        "bank": {"jumlah": len(proc), "nominal": bank_total},
        "per_kelas": per_kelas,
        "tersembunyi": {"jumlah": len(teremban), "nominal": sum(t["nominal"] for t in teremban),
                        "salinan_terdeteksi": {"jumlah": len(salinan_tersembunyi), "nominal": sum(t["nominal"] for t in salinan_tersembunyi)}},
        "salinan_terdeteksi": {"jumlah": sum(1 for t in proc if t["salinan_dari"]), "nominal": salinan_nominal},
        "bank_tanpa_salinan_perkiraan": bank_total - salinan_nominal,
        "tagihan_aktif": tagihan,
        "selisih": {"bank_kasar_vs_net_transfer": bank_total - net, "bank_tanpa_salinan_vs_net_transfer": bank_total - salinan_nominal - net,
                    "teralokasi_ke_tagihan_aktif": sum(t["alokasi_sah"] for t in proc if (by_id.get(t["ada_di_profil"]) or {}).get("status") not in ("archived", "merged"))},
        "catatan": catatan,
    }
    return {"profil": prof_out, "transaksi": tx, "pasangan_duplikat": pasangan, "ringkasan": ringkas}
