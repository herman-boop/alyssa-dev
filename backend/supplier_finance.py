"""Modul Finance Supplier (Rekap, Riwayat, Rekonsiliasi, Verifikasi) — fungsi MURNI tanpa DB.

Semua fungsi hanya MEMBACA data supplier yang sudah dihitung oleh _supplier_job_totals /
_supplier_rekon_overview di server.py (angka TIDAK dihitung ulang dengan rumus lain), lalu menyusunnya
per Nomor Invoice Supplier dan per transfer. Tidak ada fungsi di sini yang mengubah nominal historis.

Istilah:
  tagihan     = net_transfer unit (basis sisa transfer yang sudah ada)
  terbayar    = total_terbayar unit (pembayaran manual + alokasi rekon)
  transfer    = uang yang benar-benar keluar (pembayaran manual batch + pembayaran rekon bank)
  teralokasi  = bagian transfer yang sudah menempel ke unit/invoice
  belum dialokasikan = transfer - teralokasi (tidak pernah negatif)
"""
import re
from datetime import date, datetime

VERIF_STATUS = ("belum_diverifikasi", "menunggu_konfirmasi", "terverifikasi_supplier", "ada_selisih")
VERIF_LABEL = {
    "belum_diverifikasi": "Belum Diverifikasi",
    "menunggu_konfirmasi": "Menunggu Konfirmasi Supplier",
    "terverifikasi_supplier": "Terverifikasi Supplier",
    "ada_selisih": "Ada Selisih",
}
SPREAD_DUPLIKAT_HARI = 31   # nomor invoice yang sama tapi tanggal unit terpaut > ini ditandai "kemungkinan duplikat"


def norm_inv(s):
    """Normalisasi nomor invoice untuk pengelompokan (spasi & huruf besar/kecil diabaikan)."""
    return re.sub(r"\s+", " ", str(s or "").strip()).upper()


def _d(s):
    try:
        return datetime.strptime(str(s or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def _i(v):
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


def _rute(j):
    a, t = (j.get("asal_kota") or "").strip(), (j.get("tujuan_kota") or "").strip()
    return f"{a or '-'} → {t or '-'}"


# ── Rekap per Nomor Invoice Supplier ─────────────────────────────────────────

def build_invoices(jobs, used_elsewhere=None, flagged_invoices=None):
    """jobs = unit yang SUDAH dihitung (net_transfer, total_terbayar, tanggal, no_invoice_supplier).
    Unit tanpa nomor TIDAK digabung jadi satu invoice palsu: dilaporkan terpisah (perlu_dilengkapi).
    used_elsewhere = set nomor (ter-normalisasi) yang juga dipakai supplier LAIN → ditandai duplikat.
    flagged_invoices = set nomor (ter-normalisasi) yang punya transfer berstatus 'ada_selisih'."""
    used_elsewhere = used_elsewhere or set()
    flagged_invoices = flagged_invoices or set()
    groups, missing = {}, []
    for j in jobs or []:
        k = norm_inv(j.get("no_invoice_supplier"))
        if not k:
            missing.append(j)
            continue
        groups.setdefault(k, []).append(j)
    invoices = []
    for k, js in groups.items():
        tagih = sum(_i(j.get("net_transfer")) for j in js)
        bayar = sum(_i(j.get("total_terbayar")) for j in js)
        tgls = sorted(t for t in (_d(j.get("tanggal")) for j in js) if t)
        spread = (tgls[-1] - tgls[0]).days if len(tgls) > 1 else 0
        rutes = []
        for j in js:
            r = _rute(j)
            if r not in rutes:
                rutes.append(r)
        sisa = tagih - bayar
        dup = []
        if k in used_elsewhere:
            dup.append("dipakai supplier lain")
        if spread > SPREAD_DUPLIKAT_HARI:
            dup.append(f"tanggal unit terpaut {spread} hari")
        if tagih <= 0:
            st = "draft"
        elif sisa < 0:
            st = "selisih"           # dibayar melebihi tagihan
        elif sisa == 0:
            st = "lunas"
        elif bayar > 0:
            st = "sebagian"
        else:
            st = "belum"
        if k in flagged_invoices and st != "draft":
            st = "selisih"
        invoices.append({
            "key": k, "no": str(js[0].get("no_invoice_supplier")).strip(),
            "tanggal": tgls[0].isoformat() if tgls else "", "unit": len(js), "rute": rutes,
            "tagihan": tagih, "terbayar": bayar, "sisa": sisa, "status": st,
            "duplikat": dup, "job_ids": [j.get("id") for j in js],
        })
    invoices.sort(key=lambda x: (x["tanggal"], x["no"]))
    perlu = {
        "unit": len(missing),
        "tagihan": sum(_i(j.get("net_transfer")) for j in missing),
        "terbayar": sum(_i(j.get("total_terbayar")) for j in missing),
        "job_ids": [j.get("id") for j in missing],
    }
    perlu["sisa"] = perlu["tagihan"] - perlu["terbayar"]
    return invoices, perlu


# ── Daftar transfer & alokasi ────────────────────────────────────────────────

def build_transfers(jobs, rekon_payments, verifikasi=None, is_fee=None):
    """Satu baris per TRANSFER nyata. Sumber:
       - pembayaran manual di unit (dikelompokkan batch_id; tanpa batch → 1 baris per pembayaran),
       - pembayaran rekon bank (alokasi per unit ada di allocations).
    Pembayaran 'kompensasi' (unit pengganti) bukan transfer → dilaporkan sebagai penyesuaian.
    Biaya admin bank (is_fee) dipisah: tidak dialokasikan ke tagihan supplier."""
    verifikasi = verifikasi or {}
    is_fee = is_fee or (lambda p: False)
    job_by_id = {j.get("id"): j for j in (jobs or [])}

    def _alok_rows(per_job):
        rows = {}
        for jid, amt in per_job.items():
            j = job_by_id.get(jid) or {}
            k = norm_inv(j.get("no_invoice_supplier")) or "_none"
            r = rows.setdefault(k, {"invoice_key": k, "invoice_no": (str(j.get("no_invoice_supplier") or "").strip() or None),
                                    "jumlah": 0, "unit": 0, "job_ids": []})
            r["jumlah"] += amt
            r["unit"] += 1
            r["job_ids"].append(jid)
        return sorted(rows.values(), key=lambda r: (r["invoice_no"] is None, r["invoice_no"] or ""))

    transfers, penyesuaian = [], []
    manual = {}
    for j in jobs or []:
        for p in (j.get("payments") or []):
            amt = _i(p.get("amount"))
            if amt <= 0:
                continue
            if (p.get("tipe") or "transfer") == "kompensasi":
                penyesuaian.append({"id": p.get("id"), "tanggal": p.get("tanggal") or "", "nominal": amt,
                                    "catatan": p.get("catatan") or "", "job_id": j.get("id")})
                continue
            key = "tx:" + str(p.get("batch_id") or p.get("id"))
            t = manual.setdefault(key, {"key": key, "jenis": "manual", "tanggal": p.get("tanggal") or "",
                                        "bank": p.get("bank") or "", "ref": p.get("no_referensi") or "",
                                        "bukti_url": p.get("bukti_url") or "", "catatan": p.get("catatan") or "",
                                        "per_job": {}, "nominal": 0})
            t["nominal"] += amt
            t["per_job"][j.get("id")] = t["per_job"].get(j.get("id"), 0) + amt
            for f, src in (("bank", "bank"), ("ref", "no_referensi"), ("bukti_url", "bukti_url")):
                if p.get(src) and not t[f]:
                    t[f] = p.get(src)
    for t in manual.values():
        transfers.append(t)
    for p in (rekon_payments or []):
        if p.get("status") == "reversed":
            continue
        amt = _i(p.get("amount"))
        per_job = {}
        for a in (p.get("allocations") or []):
            if a.get("job_id") and _i(a.get("amount")) > 0:
                per_job[a["job_id"]] = per_job.get(a["job_id"], 0) + _i(a.get("amount"))
        rk = p.get("rekon") or {}
        transfers.append({
            "key": "rk:" + str(p.get("id")), "jenis": "biaya_admin" if is_fee(p) else "rekon",
            "tanggal": p.get("tanggal") or "", "bank": rk.get("beneficiary_bank_code") or "",
            "ref": rk.get("referensi_bank") or p.get("bank_transaction_id") or "",
            "bukti_url": p.get("bukti_url") or "", "catatan": p.get("catatan") or "",
            "per_job": per_job, "nominal": amt,
        })
    out = []
    for t in transfers:
        per_job = t.pop("per_job")
        alok = _alok_rows(per_job)
        teralokasi = sum(per_job.values())
        v = verifikasi.get(t["key"]) or {}
        t.update({
            "alokasi": alok, "invoice_n": len([a for a in alok if a["invoice_key"] != "_none"]),
            "teralokasi": teralokasi, "belum_dialokasikan": max(0, t["nominal"] - teralokasi),
            "lebih_alokasi": max(0, teralokasi - t["nominal"]),   # harus 0; >0 = anomali data
            "verifikasi": v.get("status") or "belum_diverifikasi",
            "verifikasi_label": VERIF_LABEL.get(v.get("status") or "belum_diverifikasi"),
            "verifikasi_riwayat": v.get("riwayat") or [],
        })
        out.append(t)
    out.sort(key=lambda t: (t["tanggal"], t["key"]), reverse=True)
    penyesuaian.sort(key=lambda p: p["tanggal"], reverse=True)
    return out, penyesuaian


def totals(invoices, perlu, transfers, penyesuaian):
    nyata = [t for t in transfers if t["jenis"] != "biaya_admin"]
    fee = [t for t in transfers if t["jenis"] == "biaya_admin"]
    transfer_total = sum(t["nominal"] for t in nyata)
    teralokasi = sum(t["teralokasi"] for t in nyata)
    tagih = sum(i["tagihan"] for i in invoices) + perlu["tagihan"]
    bayar = sum(i["terbayar"] for i in invoices) + perlu["terbayar"]
    return {
        "tagihan": tagih, "terbayar": bayar, "sisa": tagih - bayar,
        "transfer_aktual": transfer_total, "teralokasi": teralokasi,
        "belum_dialokasikan": sum(t["belum_dialokasikan"] for t in nyata),
        "penyesuaian": sum(p["nominal"] for p in penyesuaian),
        "biaya_admin_bank": sum(t["nominal"] for t in fee),
        "biaya_admin_dialokasikan": sum(t["teralokasi"] for t in fee),   # harus 0; >0 = biaya admin ikut menutup tagihan supplier (anomali)
        "invoice_n": len(invoices), "unit_perlu_dilengkapi": perlu["unit"],
    }


def anomali(transfers):
    """Daftar kejanggalan data (TIDAK memperbaiki apa pun): alokasi melebihi nilai transfer."""
    out = [{"jenis": "alokasi_melebihi_transfer", "key": t["key"], "tanggal": t["tanggal"], "nominal": t["nominal"],
            "teralokasi": t["teralokasi"], "kelebihan": t["lebih_alokasi"]} for t in transfers if t["lebih_alokasi"] > 0]
    out += [{"jenis": "biaya_admin_dialokasikan_ke_tagihan", "key": t["key"], "tanggal": t["tanggal"], "nominal": t["nominal"],
             "teralokasi": t["teralokasi"], "kelebihan": t["teralokasi"]} for t in transfers if t["jenis"] == "biaya_admin" and t["teralokasi"] > 0]
    return out


def _alok_valid(p, ids):
    """Alokasi rekon yang DIHITUNG sebagai pembayaran: sama persis dengan perhitungan lama (_supplier_rekon_overview):
    hanya nominal > 0 dan hanya ke unit yang memang ada pada supplier ini."""
    return sum(_i(a.get("amount")) for a in (p.get("allocations") or [])
               if a.get("job_id") in ids and _i(a.get("amount")) > 0)


def alokasi_yatim(jobs, rekon_payments):
    """Alokasi pembayaran rekon ke unit yang TIDAK ADA di supplier ini (mis. unit dihapus/dipindah).
    Perhitungan lama mengabaikannya; di sini hanya DILAPORKAN, data tidak diubah."""
    ids = {j.get("id") for j in (jobs or [])}
    out = []
    for p in (rekon_payments or []):
        if p.get("status") == "reversed":
            continue
        for a in (p.get("allocations") or []):
            if a.get("job_id") and a.get("job_id") not in ids and _i(a.get("amount")) > 0:
                out.append({"jenis": "alokasi_ke_unit_tidak_ada", "key": "rk:" + str(p.get("id")), "tanggal": p.get("tanggal") or "",
                            "nominal": _i(p.get("amount")), "unit_id": a.get("job_id"), "teralokasi": _i(a.get("amount")),
                            "kelebihan": _i(a.get("amount"))})
    return out


# ── Rekonsiliasi saldo (Alyssa vs supplier) ──────────────────────────────────

def saldo_alyssa(jobs, rekon_payments, cutoff):
    """Saldo utang menurut Alyssa pada tanggal cut-off (inklusif):
         tagihan unit bertanggal <= cutoff  −  pembayaran bertanggal <= cutoff
       pembayaran = pembayaran manual unit + alokasi pembayaran rekon (tanggal rekon payment)."""
    c = _d(cutoff)
    if not c:
        return None
    tagih = sum(_i(j.get("net_transfer")) for j in (jobs or []) if (_d(j.get("tanggal")) or date.min) <= c)
    bayar = 0
    ids = {j.get("id") for j in (jobs or [])}
    for j in jobs or []:
        for p in (j.get("payments") or []):
            if (_d(p.get("tanggal")) or date.min) <= c:
                bayar += _i(p.get("amount"))
    for p in (rekon_payments or []):
        if p.get("status") == "reversed" or (_d(p.get("tanggal")) or date.min) > c:
            continue
        bayar += _alok_valid(p, ids)
    return tagih - bayar


def rekonsiliasi(jobs, rekon_payments, transfers, invoices, perlu, saldo_entries, cutoff=None):
    """Bandingkan saldo Alyssa dengan saldo menurut supplier pada cut-off yang SAMA.
    Belum ada saldo supplier → status 'belum_direkonsiliasi' (BUKAN selisih 0)."""
    entries = sorted([e for e in (saldo_entries or []) if _d(e.get("cutoff"))], key=lambda e: e["cutoff"])
    if cutoff:
        entry = next((e for e in reversed(entries) if e["cutoff"] == cutoff), None)
        use_cut = cutoff
    else:
        entry = entries[-1] if entries else None
        use_cut = entry["cutoff"] if entry else None
    out = {"cutoff": use_cut, "status": "belum_direkonsiliasi", "saldo_alyssa": None, "saldo_supplier": None,
           "selisih": None, "penyebab": [], "cocok_nominal": [], "catatan": "", "riwayat_saldo": entries}
    if not use_cut:
        return out
    sa = saldo_alyssa(jobs, rekon_payments, use_cut)
    out["saldo_alyssa"] = sa
    if not entry:
        return out
    ss = _i(entry.get("saldo"))
    out.update({"saldo_supplier": ss, "selisih": sa - ss, "catatan": entry.get("catatan") or "",
                "bukti_url": entry.get("bukti_url") or "", "diinput_oleh": entry.get("oleh") or "",
                "diinput_pada": entry.get("pada") or ""})
    out["status"] = "cocok" if sa - ss == 0 else "selisih"
    if sa - ss == 0:
        return out
    c = _d(use_cut)
    cand = []                      # SEMUA kandidat (dipakai mencari nominal yang persis sama dengan selisih)
    for t in transfers:
        if t["jenis"] == "biaya_admin" or (_d(t["tanggal"]) or date.max) > c:
            continue
        if t["verifikasi"] != "terverifikasi_supplier" and t["teralokasi"] > 0:
            cand.append({"jenis": "transfer_belum_dikonfirmasi", "ref": t["key"], "tanggal": t["tanggal"], "status": t["verifikasi"],
                         "nominal": t["teralokasi"], "keterangan": f"Transfer {t['ref'] or t['key']} ({t['verifikasi_label']})"})
        if t["belum_dialokasikan"] > 0:
            cand.append({"jenis": "transfer_belum_dialokasikan", "ref": t["key"], "tanggal": t["tanggal"],
                         "nominal": t["belum_dialokasikan"], "keterangan": f"Transfer {t['ref'] or t['key']} belum dialokasikan ke invoice"})
    for i in invoices:
        if (_d(i["tanggal"]) or date.max) <= c and i["sisa"] != 0:
            cand.append({"jenis": "invoice_belum_lunas", "ref": i["no"], "tanggal": i["tanggal"],
                         "nominal": i["sisa"], "keterangan": f"Invoice {i['no']}: sisa {rp(i['sisa'])}"})
    if perlu["unit"]:
        cand.append({"jenis": "unit_tanpa_nomor_invoice", "ref": f"{perlu['unit']} unit", "tanggal": "",
                     "nominal": perlu["tagihan"], "keterangan": f"{perlu['unit']} unit belum punya nomor invoice supplier"})
    sel = abs(sa - ss)
    out["cocok_nominal"] = [c_ for c_ in cand if abs(c_["nominal"]) == sel]
    # Tampilan ringkas: transfer yang BELUM DIVERIFIKASI digabung jadi satu baris (tidak membanjiri daftar);
    # transfer yang sudah ditandai menunggu/ada selisih tetap tampil satu per satu.
    belum = [c_ for c_ in cand if c_["jenis"] == "transfer_belum_dikonfirmasi" and c_["status"] == "belum_diverifikasi"]
    view = [c_ for c_ in cand if c_ not in belum]
    if belum:
        view.append({"jenis": "transfer_belum_diverifikasi", "ref": f"{len(belum)} transfer", "tanggal": "", "nominal": sum(c_["nominal"] for c_ in belum),
                     "keterangan": f"{len(belum)} transfer belum diverifikasi supplier (supplier mungkin belum mengakui pembayaran ini)",
                     "rincian": [{"ref": c_["ref"], "tanggal": c_["tanggal"], "nominal": c_["nominal"]} for c_ in belum]})
    order = {"transfer_belum_dialokasikan": 0, "transfer_belum_dikonfirmasi": 1, "transfer_belum_diverifikasi": 2, "invoice_belum_lunas": 3, "unit_tanpa_nomor_invoice": 4}
    view.sort(key=lambda x: (x not in out["cocok_nominal"], order.get(x["jenis"], 9), x["tanggal"]))
    out["penyebab"] = view
    out["arah"] = "Saldo Alyssa lebih tinggi dari saldo supplier." if sa > ss else "Saldo Alyssa lebih rendah dari saldo supplier."
    return out


# ── Verifikasi transfer (status + bukti + riwayat) ──────────────────────────

def apply_verifikasi(entry, status, catatan, bukti_url, oleh, now_iso):
    """Ubah status verifikasi 1 transfer. Return (entry_baru, error). Wajib bukti ATAU catatan;
    setiap perubahan dicatat di riwayat (tidak pernah menimpa riwayat lama)."""
    if status not in VERIF_STATUS:
        return None, f"Status tidak dikenal. Pilih salah satu: {', '.join(VERIF_STATUS)}"
    catatan = (catatan or "").strip()[:500]
    if not catatan and not bukti_url:
        return None, "Isi catatan atau lampirkan bukti untuk mengubah status verifikasi."
    if status == "terverifikasi_supplier" and not bukti_url and len(catatan) < 8:
        return None, "Terverifikasi Supplier wajib bukti (lampiran) atau catatan referensi konfirmasi minimal 8 karakter."
    cur = dict(entry or {})
    dari = cur.get("status") or "belum_diverifikasi"
    if dari == status and not bukti_url:
        return None, "Status sama dengan sebelumnya. Lampirkan bukti baru bila ingin mencatat konfirmasi tambahan."
    riwayat = list(cur.get("riwayat") or [])
    riwayat.append({"dari": dari, "ke": status, "catatan": catatan, "bukti_url": bukti_url or "", "oleh": oleh, "pada": now_iso})
    cur.update({"status": status, "catatan": catatan, "bukti_url": bukti_url or cur.get("bukti_url") or "",
                "oleh": oleh, "pada": now_iso, "riwayat": riwayat})
    return cur, None


# ── Melengkapi nomor invoice pada data lama ─────────────────────────────────

def plan_no_invoice(jobs, job_ids, nomor, tanggal_invoice=None, timpa=False, used_elsewhere=None):
    """Rencana (TANPA menyimpan) memberi nomor invoice ke unit lama. Hanya field nomor yang disentuh;
    nominal/pembayaran tidak pernah diubah. Return dict {updates:[{job_id,dari,ke}], warnings, errors}."""
    nomor_clean = re.sub(r"\s+", " ", str(nomor or "").strip())[:60]
    res = {"updates": [], "warnings": [], "errors": [], "nomor": nomor_clean}
    if not nomor_clean:
        res["errors"].append("Nomor invoice supplier wajib diisi.")
        return res
    by_id = {j.get("id"): j for j in (jobs or [])}
    ids = [i for i in dict.fromkeys(job_ids or []) if i]
    if not ids:
        res["errors"].append("Pilih minimal 1 unit.")
        return res
    k = norm_inv(nomor_clean)
    existing = [j for j in (jobs or []) if norm_inv(j.get("no_invoice_supplier")) == k and j.get("id") not in ids]
    if existing:
        res["warnings"].append(f"Nomor ini sudah dipakai {len(existing)} unit lain di supplier ini; unit yang dipilih digabung ke invoice yang sama.")
        tg = [t for t in (_d(j.get("tanggal")) for j in existing) if t]
        tn = [t for t in (_d(by_id[i].get("tanggal")) for i in ids if i in by_id) if t]
        if tg and tn and (max(tg + tn) - min(tg + tn)).days > SPREAD_DUPLIKAT_HARI:
            res["warnings"].append(f"Tanggal unit terpaut lebih dari {SPREAD_DUPLIKAT_HARI} hari dari unit lain pada nomor ini: kemungkinan nomor duplikat.")
    if k in (used_elsewhere or set()):
        res["warnings"].append("Nomor ini juga dipakai supplier lain: kemungkinan nomor duplikat.")
    for jid in ids:
        j = by_id.get(jid)
        if not j:
            res["errors"].append(f"Unit tidak ditemukan: {jid}")
            continue
        dari = str(j.get("no_invoice_supplier") or "").strip()
        if dari and norm_inv(dari) != k and not timpa:
            res["errors"].append(f"Unit {j.get('nopol') or j.get('no_rangka') or jid} sudah bernomor '{dari}'. Centang 'Timpa' bila memang ingin mengganti.")
            continue
        if norm_inv(dari) == k:
            continue
        res["updates"].append({"job_id": jid, "dari": dari, "ke": nomor_clean})
    return res


def cari_unit(jobs, q="", dari=None, sampai=None, nominal=None, nominal_min=None, nominal_max=None, kosong=False, limit=200):
    """Cari unit untuk mencocokkan data lama dengan invoice asli: teks (no polisi/rangka/tipe/rute/no invoice/catatan),
    rentang tanggal, nominal (tagihan unit; tepat atau rentang), dan filter 'belum bernomor'."""
    ql = (q or "").strip().lower()
    d1, d2 = _d(dari), _d(sampai)
    out = []
    for j in jobs or []:
        if kosong and norm_inv(j.get("no_invoice_supplier")):
            continue
        if ql:
            hay = " ".join(str(j.get(f) or "") for f in ("nopol", "no_rangka", "vehicle_type", "asal_kota", "tujuan_kota", "no_invoice_supplier", "catatan", "tag")).lower()
            if ql not in hay:
                continue
        t = _d(j.get("tanggal"))
        if (d1 and (not t or t < d1)) or (d2 and (not t or t > d2)):
            continue
        n = _i(j.get("net_transfer"))
        if nominal not in (None, "") and n != _i(nominal):
            continue
        if nominal_min not in (None, "") and n < _i(nominal_min):
            continue
        if nominal_max not in (None, "") and n > _i(nominal_max):
            continue
        out.append({"id": j.get("id"), "nopol": j.get("nopol") or "", "no_rangka": j.get("no_rangka") or "",
                    "vehicle_type": j.get("vehicle_type") or "", "rute": _rute(j), "tanggal": j.get("tanggal") or "",
                    "tagihan": n, "terbayar": _i(j.get("total_terbayar")), "sisa": n - _i(j.get("total_terbayar")),
                    "no_invoice_supplier": j.get("no_invoice_supplier") or "",
                    "perlu_dilengkapi": not norm_inv(j.get("no_invoice_supplier"))})
    out.sort(key=lambda x: (x["tanggal"], x["nopol"] or x["no_rangka"]))
    return out[:limit]


def build_finance(jobs, rekon_payments, verifikasi=None, saldo_entries=None, cutoff=None, is_fee=None, used_elsewhere=None):
    """Paket lengkap untuk layar Rekap + Riwayat + PDF."""
    transfers, penyesuaian = build_transfers(jobs, rekon_payments, verifikasi, is_fee)
    flagged = set()
    for t in transfers:
        if t["verifikasi"] == "ada_selisih":
            flagged.update(a["invoice_key"] for a in t["alokasi"] if a["invoice_key"] != "_none")
    invoices, perlu = build_invoices(jobs, used_elsewhere=used_elsewhere, flagged_invoices=flagged)
    tot = totals(invoices, perlu, transfers, penyesuaian)
    rekon = rekonsiliasi(jobs, rekon_payments, transfers, invoices, perlu, saldo_entries, cutoff)
    return {"ringkasan": tot, "invoices": invoices, "perlu_dilengkapi": perlu, "transfers": transfers,
            "penyesuaian": penyesuaian, "rekonsiliasi": rekon, "anomali": anomali(transfers) + alokasi_yatim(jobs, rekon_payments)}


# ── Ringkasan periode (saldo awal → saldo akhir) ─────────────────────────────

def ringkasan_periode(jobs, rekon_payments, dari, cutoff):
    """Saldo awal + tagihan baru − pembayaran − penyesuaian = saldo akhir, dengan aturan tanggal yang SAMA
    dengan saldo_alyssa (jadi saldo akhir selalu == saldo_alyssa(cutoff))."""
    d1, c = _d(dari), _d(cutoff)
    if not d1 or not c or d1 > c:
        return None
    awal = saldo_alyssa(jobs, rekon_payments, (d1.fromordinal(d1.toordinal() - 1)).isoformat())
    tagihan = bayar = komp = 0
    ids_all = {j.get("id") for j in (jobs or [])}
    for j in jobs or []:
        if d1 <= (_d(j.get("tanggal")) or date.min) <= c:
            tagihan += _i(j.get("net_transfer"))
        for p in (j.get("payments") or []):
            if d1 <= (_d(p.get("tanggal")) or date.min) <= c:
                if (p.get("tipe") or "transfer") == "kompensasi":
                    komp += _i(p.get("amount"))
                else:
                    bayar += _i(p.get("amount"))
    for p in rekon_payments or []:
        if p.get("status") == "reversed":
            continue
        if d1 <= (_d(p.get("tanggal")) or date.min) <= c:
            bayar += _alok_valid(p, ids_all)
    akhir = awal + tagihan - bayar - komp
    return {"dari": d1.isoformat(), "cutoff": c.isoformat(), "saldo_awal": awal, "tagihan_baru": tagihan,
            "pembayaran": bayar, "penyesuaian": komp, "saldo_akhir": akhir}


# ── PDF A4 (HTML siap cetak; dirender Chromium server → teks vector) ─────────
import base64
import html as _html

PDF_CSS = """
@page{size:A4;margin:16mm 14mm 18mm 14mm}
:root{--navy:#0F2A5C;--gold:#C9973A;--ink:#0B1220;--mut:#5B6678;--ok:#0B6B43;--red:#B42318}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);font-size:10pt;line-height:1.4}
.hd{display:flex;align-items:center;gap:12px;padding-bottom:8px;border-bottom:1.2pt solid var(--gold);margin-bottom:10px}
.hd img{height:42px}.hd .co{font-size:14pt;font-weight:700;color:var(--navy)}.hd .tg{font-size:8.5pt;color:var(--gold);font-weight:600}
h1{font-size:15pt;color:var(--navy);margin:6px 0 8px}
.id{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;font-size:9.5pt;margin-bottom:10px}.id b{color:var(--navy)}
.h2{font-size:10pt;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.4pt;margin:14px 0 5px;break-after:avoid}
table{width:100%;border-collapse:collapse;font-size:8.6pt;border:.6pt solid #CBD3E0}
th{font-size:8pt;padding:5px 6px;background:#F3F5F8;border-bottom:.6pt solid #CBD3E0;text-align:left;color:#3B4A63;font-weight:600}
td{padding:5px 6px;border-bottom:.4pt solid #E3E8EF;vertical-align:top}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
thead{display:table-header-group}tfoot{display:table-row-group}tr{break-inside:avoid}tr.tall{break-inside:auto}
tfoot td{background:#F3F5F8;color:var(--navy);font-weight:700;border-top:.8pt solid var(--navy)}
.sum td{font-size:9.5pt}.sum tr:last-child td{font-weight:700;color:var(--navy);border-top:.8pt solid var(--navy);background:#F3F5F8}
.inv{font-weight:600;color:var(--navy);font-size:8.3pt}
table.fx{table-layout:fixed}td,th{overflow-wrap:anywhere;padding-left:4pt;padding-right:4pt}.nw{white-space:nowrap}table.fx td.num,table.fx th.num{padding-right:5pt;font-size:8.2pt}table.fx th.num{white-space:normal}
.sub{color:var(--mut);font-size:8pt}
.st{font-weight:600;white-space:nowrap}.st.ok{color:var(--ok)}.st.red{color:var(--red)}.st.navy{color:var(--navy)}.st.gray{color:var(--mut)}
.box{border:.6pt solid #CBD3E0;padding:6px 8px;font-size:9pt;margin-top:8px;break-inside:avoid}
.box.warn{border-color:#E7B4AE}
.red{color:var(--red)}
.foot{font-size:8pt;color:var(--mut);margin-top:12px}
"""
_ST = {"lunas": ("Lunas", "ok"), "sebagian": ("Sebagian", "navy"), "belum": ("Belum dibayar", "gray"),
       "selisih": ("Selisih", "red"), "draft": ("Draft", "gray")}
_VR = {"belum_diverifikasi": "gray", "menunggu_konfirmasi": "navy", "terverifikasi_supplier": "ok", "ada_selisih": "red"}
_BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def rp(n):
    n = _i(n)
    s = "Rp " + f"{abs(n):,}".replace(",", ".")
    return f"({s})" if n < 0 else s


def ang(n):
    """Angka rupiah tanpa awalan 'Rp' (satuan ada di judul kolom) — negatif dalam kurung."""
    n = _i(n)
    t = f"{abs(n):,}".replace(",", ".")
    return f"({t})" if n < 0 else t


def tgl_id(s, panjang=False):
    d = _d(s)
    if not d:
        return "-"
    return f"{d.day:02d} {_BLN[d.month - 1]} {d.year}"


def _e(x):
    return _html.escape(str(x if x is not None else ""))


def render_pdf_html(sup_nama, no_dok, fin, periode, logo_path=None):
    """fin = build_finance(...); periode = ringkasan_periode(...). Semua teks di-escape."""
    logo = ""
    if logo_path:
        try:
            with open(logo_path, "rb") as f:
                logo = "data:image/png;base64," + base64.b64encode(f.read()).decode()
        except OSError:
            logo = ""
    t, inv, perlu, trf, rek = fin["ringkasan"], fin["invoices"], fin["perlu_dilengkapi"], fin["transfers"], fin["rekonsiliasi"]
    rows = []
    for i in inv:
        lab, cls = _ST.get(i["status"], (i["status"], "gray"))
        dup = f'<div class="sub red">Periksa nomor: {_e("; ".join(i["duplikat"]))}</div>' if i["duplikat"] else ""
        rows.append(f'<tr><td class="inv">{_e(i["no"])}{dup}</td><td style="white-space:nowrap">{tgl_id(i["tanggal"])}</td>'
                    f'<td>{i["unit"]} unit<br><span class="sub">{_e("; ".join(i["rute"][:2]))}{" …" if len(i["rute"]) > 2 else ""}</span></td>'
                    f'<td class="num">{ang(i["tagihan"])}</td><td class="num">{ang(i["terbayar"])}</td><td class="num">{ang(i["sisa"])}</td>'
                    f'<td><span class="st {cls}">{lab}</span></td></tr>')
    if perlu["unit"]:
        rows.append(f'<tr><td class="inv red">Tanpa nomor invoice</td><td>-</td><td>{perlu["unit"]} unit</td><td class="num">{ang(perlu["tagihan"])}</td>'
                    f'<td class="num">{ang(perlu["terbayar"])}</td><td class="num">{ang(perlu["sisa"])}</td><td><span class="st red">Perlu Dilengkapi</span></td></tr>')
    trows = []
    for x in trf:
        al = "<br>".join(f'{_e(a["invoice_no"] or "Tanpa nomor")} · <span class="nw">{a["jumlah"]:,}</span>'.replace(",", ".") for a in x["alokasi"]) or "—"
        trows.append(f'<tr{" class=tall" if len(x["alokasi"]) > 6 else ""}><td style="white-space:nowrap">{tgl_id(x["tanggal"])}</td><td>{_e(x["ref"] or "-")}</td>'
                     f'<td class="num">{ang(x["nominal"])}</td><td style="font-size:8pt">{al}</td><td class="num">{ang(x["teralokasi"])}</td>'
                     f'<td class="num">{ang(x["belum_dialokasikan"])}</td><td><span class="st {_VR.get(x["verifikasi"], "gray")}">{_e(x["verifikasi_label"])}</span>'
                     f'{"<br><span class=sub>Biaya admin bank</span>" if x["jenis"] == "biaya_admin" else ""}</td></tr>')
    if rek["status"] == "belum_direkonsiliasi":
        rekbox = ('<div class="box"><b>Status rekonsiliasi: Belum Direkonsiliasi.</b> Saldo menurut supplier belum diinput, '
                  f'sehingga selisih belum dapat dihitung. Saldo menurut Alyssa per {tgl_id(rek["cutoff"])}: <b>{rp(rek["saldo_alyssa"]) if rek["saldo_alyssa"] is not None else "-"}</b>.</div>')
    else:
        pb = "".join(f'<tr><td>{_e(c["keterangan"])}</td><td class="num">{rp(c["nominal"])}</td></tr>' for c in rek["penyebab"][:10])
        rekbox = (f'<div class="box{" warn" if rek["status"] == "selisih" else ""}"><b>Status rekonsiliasi: {"Cocok" if rek["status"] == "cocok" else "Ada Selisih"}</b> — cut-off {tgl_id(rek["cutoff"])}.'
                  f'<table style="margin-top:6px"><tbody><tr><td>Saldo menurut Alyssa</td><td class="num">{rp(rek["saldo_alyssa"])}</td></tr>'
                  f'<tr><td>Saldo menurut supplier</td><td class="num">{rp(rek["saldo_supplier"])}</td></tr>'
                  f'<tr><td><b>Selisih (Alyssa − supplier)</b></td><td class="num {"red" if rek["selisih"] else ""}"><b>{rp(rek["selisih"])}</b></td></tr></tbody></table>'
                  + (f'<div class="h2" style="margin-top:8px">Kemungkinan penyebab (dari data)</div><table><tbody>{pb}</tbody></table>' if pb else "") + '</div>')
    pr = periode or {}
    return f"""<!doctype html><meta charset="utf-8"><style>{PDF_CSS}</style><body>
<div class="hd">{f'<img src="{logo}">' if logo else ''}<div><div class="co">PT. ALYSSA AUTO LOGISTIK</div><div class="tg">Spesialis Pengiriman Kendaraan</div></div></div>
<h1>RINGKASAN SUPPLIER</h1>
<div class="id"><div>Supplier: <b>{_e(sup_nama)}</b></div><div>No. Dokumen: <b>{_e(no_dok)}</b></div>
<div>Periode: <b>{tgl_id(pr.get("dari"))} – {tgl_id(pr.get("cutoff"))}</b></div><div>Tanggal cut-off: <b>{tgl_id(pr.get("cutoff"))}</b></div></div>
<div class="h2">Ringkasan Saldo</div>
<table class="sum"><tbody><tr><td>Saldo awal</td><td class="num">{rp(pr.get("saldo_awal", 0))}</td></tr>
<tr><td>Tagihan baru</td><td class="num">{rp(pr.get("tagihan_baru", 0))}</td></tr>
<tr><td>Pembayaran teralokasi</td><td class="num">({rp(pr.get("pembayaran", 0))})</td></tr>
<tr><td>Penyesuaian (kompensasi)</td><td class="num">({rp(pr.get("penyesuaian", 0))})</td></tr>
<tr><td>Saldo akhir</td><td class="num">{rp(pr.get("saldo_akhir", 0))}</td></tr></tbody></table>
<div class="box">Total transfer aktual <b>{rp(t["transfer_aktual"])}</b>; teralokasi ke invoice <b>{rp(t["teralokasi"])}</b>; belum dialokasikan <b>{rp(t["belum_dialokasikan"])}</b>.
{f' Biaya admin bank {rp(t["biaya_admin_bank"])} tidak dialokasikan ke tagihan.' if t["biaya_admin_bank"] else ''}</div>
{rekbox}
<div class="h2">Tagihan per Nomor Invoice Supplier</div>
<table class="fx"><colgroup><col style="width:21%"><col style="width:11.5%"><col style="width:17.5%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:13.5%"><col style="width:9.5%"></colgroup>
<thead><tr><th>No. Invoice Supplier</th><th>Tanggal</th><th>Unit / Rute</th><th class="num">Tagihan (Rp)</th><th class="num">Terbayar (Rp)</th><th class="num">Sisa (Rp)</th><th>Status</th></tr></thead><tbody>
{''.join(rows) or '<tr><td colspan="7" class="sub">Belum ada tagihan.</td></tr>'}</tbody>
<tfoot><tr><td colspan="3">Total</td><td class="num">{ang(t["tagihan"])}</td><td class="num">{ang(t["terbayar"])}</td><td class="num">{ang(t["sisa"])}</td><td></td></tr></tfoot></table>
<div class="h2">Riwayat Transfer dan Alokasi Pembayaran</div>
<table class="fx"><colgroup><col style="width:12%"><col style="width:12%"><col style="width:12%"><col style="width:24%"><col style="width:12%"><col style="width:12%"><col style="width:16%"></colgroup>
<thead><tr><th>Tgl Transfer</th><th>Ref. Bank</th><th class="num">Nominal Transfer (Rp)</th><th>Dialokasikan ke Invoice (Rp)</th><th class="num">Teralokasi (Rp)</th><th class="num">Belum Alokasi (Rp)</th><th>Verifikasi</th></tr></thead><tbody>
{''.join(trows) or '<tr><td colspan="7" class="sub">Belum ada transfer.</td></tr>'}</tbody>
<tfoot><tr><td colspan="2">Total</td><td class="num">{ang(t["transfer_aktual"])}</td><td></td><td class="num">{ang(t["teralokasi"])}</td><td class="num">{ang(t["belum_dialokasikan"])}</td><td></td></tr></tfoot></table>
<div class="foot"><b>Catatan:</b> Status transfer "diterima" hanya menunjukkan pembayaran berhasil; persetujuan alokasi oleh supplier tercatat pada kolom Verifikasi. Total transfer aktual dibedakan dari pembayaran yang dialokasikan ke invoice. Angka bersumber dari data aplikasi dan tidak diubah oleh tampilan.</div>
</body>"""


PDF_FOOTER = ('<div style="width:100%;font-size:8px;font-family:Inter,Arial,sans-serif;color:#5B6678;padding:0 14mm;display:flex;justify-content:space-between">'
              '<span>PT. Alyssa Auto Logistik · Ringkasan Supplier</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>')


# ── Audit invarian (READ-ONLY): bandingkan tampilan baru dengan angka existing ─────────────────────

def audit(raw_jobs, rekon_payments, computed_jobs, existing, fin):
    """Daftar pelanggaran invarian (kosong = semua cocok). `existing` = angka dari get_supplier yang sudah berjalan:
       {grand_total_terbayar, grand_sisa, total_transferred}. Tidak memperbaiki apa pun."""
    v = []
    S = fin["ringkasan"]
    raw_pay = [p for j in (raw_jobs or []) for p in (j.get("payments") or [])]
    # 1) tidak ada pembayaran manual yang hilang / terhitung dua kali
    manual_total = sum(_i(p.get("amount")) for p in raw_pay if _i(p.get("amount")) > 0)
    manual_pos = sum(1 for p in raw_pay if _i(p.get("amount")) > 0)
    tr_manual = [t for t in fin["transfers"] if t["jenis"] == "manual"]
    nominal_manual = sum(t["nominal"] for t in tr_manual) + sum(p["nominal"] for p in fin["penyesuaian"])
    if nominal_manual != manual_total:
        v.append(f"pembayaran manual: laporan {nominal_manual} != data {manual_total}")
    # 2) pembayaran rekon bank
    rk_active = [p for p in (rekon_payments or []) if p.get("status") != "reversed"]
    rk_nominal = sum(_i(p.get("amount")) for p in rk_active)
    tr_rk = sum(t["nominal"] for t in fin["transfers"] if t["jenis"] in ("rekon", "biaya_admin"))
    if rk_nominal != tr_rk:
        v.append(f"pembayaran rekon: laporan {tr_rk} != data {rk_nominal}")
    if len([t for t in fin["transfers"] if t["jenis"] in ("rekon", "biaya_admin")]) != len(rk_active):
        v.append("jumlah transfer rekon berbeda dari data (hilang atau ganda)")
    # 3) angka existing
    if S["terbayar"] != _i(existing.get("grand_total_terbayar")):
        v.append(f"terbayar: laporan {S['terbayar']} != existing {existing.get('grand_total_terbayar')}")
    if S["sisa"] != _i(existing.get("grand_sisa")):
        v.append(f"sisa: laporan {S['sisa']} != existing {existing.get('grand_sisa')}")
    tot_uang = S["transfer_aktual"] + S["penyesuaian"] + S["biaya_admin_bank"]
    if tot_uang != _i(existing.get("total_transferred")):
        v.append(f"total uang keluar: laporan {tot_uang} != existing {existing.get('total_transferred')}")
    # 4) alokasi tidak melebihi transfer, dan kekekalan
    for t in fin["transfers"]:
        if t["lebih_alokasi"] > 0:
            v.append(f"alokasi melebihi transfer: {t['key']}")
    if S["transfer_aktual"] != S["teralokasi"] + S["belum_dialokasikan"]:
        v.append("transfer aktual != teralokasi + belum dialokasikan")
    if S["biaya_admin_dialokasikan"] > 0:
        v.append(f"biaya admin bank ikut dialokasikan ke tagihan: {S['biaya_admin_dialokasikan']}")
    # 5) saldo cut-off jauh ke depan harus sama dengan sisa existing
    sa = saldo_alyssa(computed_jobs, rekon_payments, "2999-12-31")
    if sa != _i(existing.get("grand_sisa")):
        v.append(f"saldo Alyssa (cut-off jauh) {sa} != sisa existing {existing.get('grand_sisa')}")
    return v
