"""Hubungkan ulang pembayaran bank ke invoice/unit baru (setelah supplier/unit dihapus atau invoice diimpor ulang).
Logika MURNI (tanpa DB): identitas bisnis, skor kecocokan, usulan, validasi, token preview. Orkestrasi DB ada di server.py.

Prinsip:
  - Nominal transaksi bank asli TIDAK pernah berubah. Total alokasi <= nominal. Tiap alokasi <= sisa unit tujuan.
  - Alokasi lama dipertahankan (relink_history + snapshot audit), tidak ditimpa diam-diam.
  - Tidak ada penautan otomatis: sistem hanya MENGUSULKAN; kecocokan ambigu/lemah wajib dikonfirmasi eksplisit.
"""
import re
import json
import hashlib

_ALNUM = re.compile(r"[^A-Z0-9]")


def norm(s):
    return _ALNUM.sub("", str(s or "").upper())


def _i(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


# ── identitas bisnis invoice/unit ────────────────────────────────────────────

def ref_dari_job(j):
    """Identitas bisnis sebuah unit/invoice (disimpan di setiap alokasi supaya tetap terbaca bila unit dihapus)."""
    return {"job_id": j.get("id"), "no_invoice": j.get("no_invoice_supplier") or j.get("no_invoice") or "",
            "unit": j.get("nopol") or j.get("no_rangka") or "",
            "unit_alt": j.get("no_rangka") if j.get("nopol") else "",
            "rute": " → ".join([x for x in (j.get("asal_kota"), j.get("tujuan_kota")) if x]),
            "total": _i(j.get("total_harga"))}


def _unit_keys(j):
    return {k for k in (norm(j.get("nopol")), norm(j.get("no_rangka"))) if k}


def skor(ref, job):
    """Kecocokan identitas bisnis `ref` (dari alokasi lama) terhadap `job` (calon tujuan): 'kuat' | 'lemah' | None.
      kuat : nomor invoice sama DAN unit sama;  atau unit + rute + total sama
      lemah: salah satu saja yang cocok (invoice; atau unit + total; atau unit + rute)"""
    inv_ref, inv_job = norm(ref.get("no_invoice")), norm(job.get("no_invoice_supplier") or job.get("no_invoice"))
    inv_eq = bool(inv_ref and inv_job and inv_ref == inv_job)
    ukeys = {norm(ref.get("unit")), norm(ref.get("unit_alt"))} - {""}
    unit_eq = bool(ukeys & _unit_keys(job))
    rute_job = norm(" ".join([str(job.get("asal_kota") or ""), str(job.get("tujuan_kota") or "")]))
    rute_ref = norm(str(ref.get("rute") or "").replace("→", " "))
    rute_eq = bool(rute_ref and rute_job and rute_ref == rute_job)
    total_eq = bool(_i(ref.get("total")) > 0 and _i(ref.get("total")) == _i(job.get("total_harga")))
    if (inv_eq and unit_eq) or (unit_eq and rute_eq and total_eq):
        return "kuat"
    if inv_eq or (unit_eq and total_eq) or (unit_eq and rute_eq):
        return "lemah"
    return None


def saran(old_refs, jobs):
    """Usulan penautan: untuk tiap referensi lama -> kandidat unit tujuan. HANYA usulan.
    status: 'kuat_unik' (tepat satu kandidat kuat) | 'ambigu' (lebih dari satu kandidat di tingkat tertinggi) | 'lemah' | 'tidak_ada'."""
    out = []
    for ref in old_refs or []:
        kand = []
        for j in jobs or []:
            s = skor(ref, j)
            if s:
                kand.append({"job_id": j.get("id"), "skor": s, "no_invoice": j.get("no_invoice_supplier") or "", "unit": j.get("nopol") or j.get("no_rangka") or "",
                             "total": _i(j.get("total_harga"))})
        kand.sort(key=lambda k: (k["skor"] != "kuat", str(k["job_id"])))
        if not kand:
            st = "tidak_ada"
        elif kand[0]["skor"] == "kuat":
            st = "kuat_unik" if sum(1 for k in kand if k["skor"] == "kuat") == 1 else "ambigu"
        else:
            st = "ambigu" if len(kand) > 1 else "lemah"
        out.append({"ref": ref, "status": st, "kandidat": kand})
    return out


def identitas_ganda(jobs):
    """Set job_id yang punya 'kembaran' di tujuan: nomor invoice + unit sama dengan unit lain (mis. hasil impor ulang dobel)."""
    seen, ganda = {}, set()
    for j in jobs or []:
        inv = norm(j.get("no_invoice_supplier") or j.get("no_invoice"))
        for u in _unit_keys(j):
            k = (inv, u)
            if not inv:
                k = ("", u, norm(j.get("asal_kota")), norm(j.get("tujuan_kota")), _i(j.get("total_harga")))
            if k in seen:
                ganda.add(j.get("id")); ganda.add(seen[k])
            else:
                seen[k] = j.get("id")
    return ganda


def identitas_supplier(nama_a, nama_b, aliases_b=()):
    """Kecocokan nama supplier asal vs tujuan: 'sama' | 'mirip' | 'beda'. Hanya petunjuk; verifikasi tetap oleh admin."""
    a, b = norm(nama_a), norm(nama_b)
    if not a or not b:
        return "beda"
    if a == b or a in {norm(x) for x in (aliases_b or [])}:
        return "sama"
    return "mirip" if (a in b or b in a) else "beda"


# ── proposal alokasi ─────────────────────────────────────────────────────────

def normalisasi_proposals(raw):
    """-> (list [{job_id, amount}], errors). Menolak job ganda, nominal <= 0, bukan angka."""
    errs, out, seen = [], [], set()
    for a in raw or []:
        jid = str((a or {}).get("job_id") or "").strip()
        try:
            amt = int(round(float((a or {}).get("amount"))))
        except (TypeError, ValueError):
            amt = 0
        if not jid:
            errs.append("job_id kosong"); continue
        if amt <= 0:
            errs.append(f"nominal alokasi harus > 0 ({jid})"); continue
        if jid in seen:
            errs.append(f"job ganda dalam usulan: {jid}"); continue
        seen.add(jid)
        out.append({"job_id": jid, "amount": amt})
    return out, errs


def validasi(nominal, proposals, sisa_by_job, ada_jobs):
    """Validasi nominal. `sisa_by_job` = sisa tiap unit tujuan SEBELUM alokasi pembayaran ini (alokasi lamanya sudah dikeluarkan).
    -> list pesan error (kosong = lolos)."""
    errs = []
    total = sum(p["amount"] for p in proposals)
    if total > nominal:
        errs.append(f"Total alokasi {total} melebihi nominal pembayaran {nominal}")
    for p in proposals:
        if p["job_id"] not in ada_jobs:
            errs.append(f"Unit tujuan tidak ada di supplier tujuan: {p['job_id']}")
        elif p["amount"] > max(0, _i(sisa_by_job.get(p["job_id"]))):
            errs.append(f"Alokasi {p['amount']} melebihi sisa unit {p['job_id']} ({max(0, _i(sisa_by_job.get(p['job_id'])))})")
    return errs


def token(obj):
    """Token preview = hash isi (bukan rahasia): dipakai mendeteksi data berubah antara preview dan persetujuan."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str, ensure_ascii=False).encode()).hexdigest()[:32]


def bangun_pembayaran_dari_import(imp, now_iso, by="", alasan=""):
    """Bangun ulang pembayaran rekon dari baris import (raw_payload) untuk pembayaran yang hilang bersama supplier-nya.
    id dan bank_transaction_id dipertahankan; nominal = nominal import; Belum Dialokasikan."""
    raw = imp.get("raw_payload") or {}
    btid = imp.get("bank_transaction_id")
    nominal = _i(imp.get("amount") or imp.get("nominal") or raw.get("nominal"))
    return {
        "id": imp.get("rekon_payment_id") or hashlib.sha1(str(btid).encode()).hexdigest()[:8],
        "amount": nominal,
        "tanggal": str(imp.get("tanggal") or raw.get("tanggal") or "")[:10],
        "source": "rekon-bank", "bank_transaction_id": btid, "idempotency_key": imp.get("idempotency_key") or btid,
        "source_entity": imp.get("source_entity") or raw.get("source_entity") or "",
        "catatan": str(raw.get("deskripsi_bank") or imp.get("deskripsi_bank") or "")[:300],
        "allocations": [], "status": "active", "created_at": now_iso,
        "dipulihkan": {"dari": "bank_payment_imports", "at": now_iso, "by": by, "alasan": alasan[:300]},
        "rekon": {"source_entity": imp.get("source_entity") or raw.get("source_entity") or "",
                  "source_account_number": raw.get("source_account_number") or imp.get("source_account_number") or "",
                  "beneficiary_bank_code": raw.get("beneficiary_bank_code") or "",
                  "beneficiary_name_raw": raw.get("beneficiary_name_raw") or imp.get("beneficiary_name_raw") or "",
                  "bank_account_number": raw.get("bank_account_number"), "bank_account_name": raw.get("bank_account_name"),
                  "referensi_bank": raw.get("referensi_bank") or imp.get("referensi_bank") or "",
                  "bank_transaction_sidik": raw.get("bank_transaction_sidik") or "",
                  "supplier_name_display": raw.get("supplier_name") or imp.get("supplier_name") or "", "alokasi_note": []},
    }
