"""Deteksi pembayaran bank yang referensinya terputus ("Perlu Rekonsiliasi") — logika MURNI, hanya membaca.

Latar belakang: pembayaran rekon disimpan DI DALAM dokumen supplier. Bila supplier dihapus / diarsipkan, atau unit
tujuan alokasi dihapus (mis. impor ulang invoice), pembayaran bisa tertinggal tanpa tujuan. Modul ini
mengklasifikasi tiap baris `bank_payment_imports` tanpa mengubah apa pun.

Kelas (kelas):
  supplier_hilang        import processed, supplier_id tidak ada di supplier_profiles
  supplier_diarsipkan    supplier ada tetapi diarsipkan (info; pembayaran aman)
  pembayaran_hilang      supplier ada, tetapi pembayaran rekon bertanda import ini tidak ada di dokumennya
  alokasi_yatim          pembayaran ada, sebagian/seluruh alokasinya menunjuk unit yang tidak ada
  belum_dialokasikan     pembayaran ada, tidak ada alokasi sama sekali (info)
  tersembunyi            pembayaran ada dan di-"Clear" dari Riwayat (tetap dihitung; hanya disembunyikan)
Status tampilan (link_status): perlu_rekonsiliasi | perlu_hubungkan_ulang | info
"""

KELAS_PERLU = ("supplier_hilang", "pembayaran_hilang", "alokasi_yatim")
LABEL = {
    "supplier_hilang": "Perlu Rekonsiliasi",
    "pembayaran_hilang": "Perlu Rekonsiliasi",
    "alokasi_yatim": "Perlu Hubungkan Ulang",
    "supplier_diarsipkan": "Supplier Diarsipkan",
    "belum_dialokasikan": "Belum Dialokasikan",
    "tersembunyi": "Tersembunyi (Clear)",
}


def _i(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def _cleared(sup):
    return {e.get("key") for e in (sup.get("riwayat_clear") or []) if e.get("status") == "cleared"}


def _job_ref(j):
    return {"job_id": j.get("id"), "no_invoice": j.get("no_invoice_supplier") or j.get("no_invoice") or "",
            "unit": j.get("nopol") or j.get("no_rangka") or "",
            "rute": " → ".join([x for x in (j.get("asal_kota"), j.get("tujuan_kota")) if x]),
            "total": _i(j.get("total_harga"))}


def _ref_lama(job_id, audit_jobs):
    """Referensi dokumen lama untuk job yang sudah tidak ada, dari snapshot log audit (job.delete)."""
    snap = (audit_jobs or {}).get(job_id)
    return _job_ref(snap) if snap else {"job_id": job_id, "no_invoice": "", "unit": "", "rute": "", "total": 0}


def klasifikasi(imports, suppliers_by_id, audit_jobs=None):
    """-> list baris. `imports` = baris bank_payment_imports (dict). `suppliers_by_id` = {id: dokumen supplier}.
    `audit_jobs` = {job_id: snapshot job} dari log audit (opsional)."""
    rows = []
    for imp in imports or []:
        if imp.get("status") != "processed":
            continue
        btid = imp.get("bank_transaction_id")
        sid = imp.get("supplier_id") or ""
        nominal = _i(imp.get("amount") or imp.get("nominal"))
        base = {
            "bank_transaction_id": btid, "idempotency_key": imp.get("idempotency_key") or btid,
            "nominal": nominal, "tanggal": imp.get("tanggal") or "", "supplier_id_lama": sid,
            "supplier_nama_lama": imp.get("supplier_name") or (imp.get("raw_payload") or {}).get("supplier_name") or "",
            "rekon_payment_id": imp.get("rekon_payment_id"), "source_entity": imp.get("source_entity") or "",
            "referensi_bank": imp.get("referensi_bank") or "",
        }
        sup = (suppliers_by_id or {}).get(sid)
        if sup is None:
            rows.append({**base, "kelas": "supplier_hilang", "label": LABEL["supplier_hilang"], "link_status": "perlu_rekonsiliasi",
                         "ref_dokumen_lama": [], "saran": "Pulihkan ke profil supplier yang benar lewat Hubungkan Ulang."})
            continue
        base["supplier_nama_lama"] = base["supplier_nama_lama"] or sup.get("nama") or ""
        if sup.get("status") == "archived":
            rows.append({**base, "kelas": "supplier_diarsipkan", "label": LABEL["supplier_diarsipkan"], "link_status": "info",
                         "ref_dokumen_lama": [], "saran": "Pembayaran aman di profil arsip. Pulihkan profil atau hubungkan ke profil aktif bila perlu."})
            continue
        pay = next((p for p in (sup.get("rekon_payments") or [])
                    if (imp.get("rekon_payment_id") and p.get("id") == imp.get("rekon_payment_id")) or p.get("bank_transaction_id") == btid), None)
        if pay is None:
            rows.append({**base, "kelas": "pembayaran_hilang", "label": LABEL["pembayaran_hilang"], "link_status": "perlu_rekonsiliasi",
                         "ref_dokumen_lama": [], "saran": "Import tercatat tetapi pembayaran tidak ada di profil. Perlu pemulihan dari snapshot (raw_payload)."})
            continue
        if pay.get("status") == "reversed":
            continue
        job_ids = {j.get("id") for j in (sup.get("jobs") or [])}
        allocs = [a for a in (pay.get("allocations") or []) if a.get("job_id") and _i(a.get("amount")) > 0]
        yatim = [a for a in allocs if a["job_id"] not in job_ids]
        tersembunyi = f"rk:{pay.get('id')}" in _cleared(sup)
        if yatim:
            rows.append({**base, "kelas": "alokasi_yatim", "label": LABEL["alokasi_yatim"], "link_status": "perlu_hubungkan_ulang",
                         "tersembunyi": tersembunyi, "nominal_yatim": sum(_i(a.get("amount")) for a in yatim),
                         "ref_dokumen_lama": [{**_ref_lama(a["job_id"], audit_jobs), "alokasi": _i(a.get("amount"))} for a in yatim],
                         "saran": "Unit tujuan sudah tidak ada. Hubungkan ulang ke invoice/unit yang sesuai."})
        elif not allocs:
            rows.append({**base, "kelas": "belum_dialokasikan", "label": LABEL["belum_dialokasikan"], "link_status": "info",
                         "tersembunyi": tersembunyi, "ref_dokumen_lama": [], "saran": "Alokasikan ke invoice."})
        elif tersembunyi:
            rows.append({**base, "kelas": "tersembunyi", "label": LABEL["tersembunyi"], "link_status": "info",
                         "tersembunyi": True, "ref_dokumen_lama": [], "saran": "Disembunyikan dari Riwayat; tetap dihitung."})
    return rows


def ringkas(rows):
    out = {"jumlah": len(rows), "nominal": sum(r["nominal"] for r in rows), "per_kelas": {}}
    for r in rows:
        k = out["per_kelas"].setdefault(r["kelas"], {"jumlah": 0, "nominal": 0})
        k["jumlah"] += 1
        k["nominal"] += r["nominal"]
    out["perlu_tindakan"] = sum(1 for r in rows if r["kelas"] in KELAS_PERLU)
    return out
