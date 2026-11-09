"""
Impor invoice supplier — logika MURNI (tanpa DB, tanpa jaringan) agar mudah diuji.

Dipakai oleh endpoint `POST /admin/suppliers/{id}/import-invoice` (server.py). Prinsip:
  - Satu kendaraan = satu record unit (`jobs[]` supplier yang sudah ada; tidak ada koleksi/DB baru).
  - Nomor invoice supplier TIDAK pernah dibuat/ditebak. Bila invoice tidak bernomor, unit diberi
    nomor BATCH IMPOR internal (`import_batch_no`, mis. IMP-20261109-A1B2C) di field terpisah.
  - Identitas hanya digit (mis. 6 digit) BUKAN nomor rangka lengkap: ditandai `perlu_konfirmasi`.
  - Validasi dilakukan SEMUA dulu; baru satu penulisan atomik. Tidak ada data setengah masuk.
  - Tidak pernah membuat pembayaran / mengubah status lunas (payments selalu []).
"""
import re
import hashlib
from datetime import date

MAX_ROWS = 300
MAX_HARGA = 2_000_000_000          # batas kewajaran per unit (Rp 2 miliar) -> di atasnya dianggap nominal salah
_PLAT = re.compile(r"^[A-Z]{1,2}\d{1,4}[A-Z]{0,3}$")
_VIN = re.compile(r"^[A-HJ-NPR-Z0-9]{17}$")


def nk(v):
    """Kunci pembanding: huruf besar + hanya A-Z0-9."""
    return re.sub(r"[^A-Z0-9]", "", str(v or "").upper())


def _int(v, default=0):
    try:
        if isinstance(v, str):
            s = v.strip().replace("Rp", "").replace("rp", "").replace(" ", "")
            if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):
                s = s.replace(".", "").replace(",", ".")
            elif re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", s):
                s = s.replace(",", "")
            else:
                s = s.replace(",", ".")
            return int(round(float(s)))
        return int(round(float(v)))
    except Exception:
        return default


def _date_ok(s):
    s = str(s or "").strip()[:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return ""
    try:
        y, m, d = (int(x) for x in s.split("-"))
        date(y, m, d)
        return s
    except Exception:
        return ""


def classify_identity(nopol, no_rangka):
    """Kembalikan (nopol, no_rangka, status, catatan).
    status: 'ok' | 'perlu_konfirmasi' | 'kosong'.
    Identitas yang hanya angka (mis. '121252') bukan nomor rangka lengkap -> perlu_konfirmasi;
    ditaruh di no_rangka (bukan nopol) supaya tidak dikira plat."""
    nopol = re.sub(r"\s+", " ", str(nopol or "").strip().upper())
    rangka = re.sub(r"\s+", " ", str(no_rangka or "").strip().upper())
    if nopol and nk(nopol).isdigit():          # AI menaruh angka saja di kolom plat -> pindahkan
        rangka, nopol = rangka or nopol, ""
    if not nopol and not rangka:
        return "", "", "kosong", "Identitas kendaraan (nopol/noka) tidak ada."
    notes = []
    status = "ok"
    if nopol and not _PLAT.match(nk(nopol)):
        status = "perlu_konfirmasi"
        notes.append(f"Nopol '{nopol}' tidak berpola plat Indonesia, mohon dicek.")
    if rangka:
        k = nk(rangka)
        if k.isdigit() and len(k) < 17:
            status = "perlu_konfirmasi"
            notes.append(f"'{rangka}' hanya {len(k)} digit: bukan nomor rangka lengkap, perlu dikonfirmasi.")
        elif not _VIN.match(k):
            status = "perlu_konfirmasi"
            notes.append(f"Nomor rangka '{rangka}' tidak berpola 17 karakter, mohon dicek.")
    return nopol, rangka, status, " ".join(notes)


def normalize_row(raw):
    """Ubah satu baris (dari AI atau hasil edit admin di preview) ke bentuk baku.
    Kompatibel dengan format lama (hanya `total_harga`, biaya tambahan sudah tergabung)."""
    raw = raw or {}
    nopol, rangka, ist, icat = classify_identity(raw.get("nopol"), raw.get("no_rangka"))
    tambahan = []
    for t in (raw.get("tambahan") if isinstance(raw.get("tambahan"), list) else raw.get("biaya_tambahan")) or []:
        if isinstance(t, dict):
            amt = _int(t.get("amount"))
            if amt != 0:
                tambahan.append({"label": (str(t.get("label") or "Biaya tambahan").strip() or "Biaya tambahan")[:80], "amount": amt})
    if raw.get("harga_dasar") not in (None, ""):
        dasar = _int(raw.get("harga_dasar"))
    elif raw.get("harga_satuan") not in (None, ""):
        dasar = _int(raw.get("harga_satuan"))
    else:
        dasar = _int(raw.get("total_harga")) - sum(t["amount"] for t in tambahan)   # format lama: total sudah termasuk tambahan
    return {
        "vehicle_type": str(raw.get("vehicle_type") or "").strip()[:80],
        "nopol": nopol, "no_rangka": rangka, "ident_status": ist, "ident_catatan": icat,
        "asal_kota": str(raw.get("asal_kota") or "").strip()[:80],
        "tujuan_kota": str(raw.get("tujuan_kota") or "").strip()[:80],
        "tanggal": _date_ok(raw.get("tanggal")),
        "harga_dasar": dasar, "tambahan": tambahan,
        "total_harga": dasar + sum(t["amount"] for t in tambahan),
        "catatan": str(raw.get("catatan") or "").strip()[:500],
    }


def row_key(row):
    """Kunci duplikat: unit yang SAMA di rute yang SAMA (unit sama rute beda = perjalanan lain, bukan dobel).
    Identitas lemah (hanya angka) ikut menyertakan tanggal agar tidak salah menandai ganda."""
    ident = nk(row.get("nopol")) or nk(row.get("no_rangka"))
    if not ident:
        return None
    rute = (nk(row.get("asal_kota")), nk(row.get("tujuan_kota")))
    lemah = nk(row.get("no_rangka")).isdigit() and not nk(row.get("nopol"))
    return (ident, rute, row.get("tanggal") or "") if lemah else (ident, rute)


def existing_keys(jobs):
    out = set()
    for j in jobs or []:
        for fld in ("nopol", "no_rangka"):
            r = {"nopol": j.get("nopol") if fld == "nopol" else "", "no_rangka": j.get("no_rangka") if fld == "no_rangka" else "",
                 "asal_kota": j.get("asal_kota"), "tujuan_kota": j.get("tujuan_kota"), "tanggal": j.get("tanggal")}
            k = row_key(r)
            if k:
                out.add(k)
    return out


def _route_match(a_asal, a_tuj, b_asal, b_tuj):
    def one(x, y):
        x, y = nk(x), nk(y)
        return bool(x and y and (x == y or x in y or y in x))
    ok_tuj = one(a_tuj, b_tuj)
    ok_asal = one(a_asal, b_asal) if (nk(a_asal) and nk(b_asal)) else True
    return ok_tuj and ok_asal


def match_po(row, candidates):
    """Cocokkan 1 baris dengan kandidat PO. `candidates` = [(order, unit)] (dict) hasil pencarian DB.
    Status:
      cocok          : identitas persis sama + rute sama
      cocok_beda_rute: identitas persis sama tetapi rute berbeda (cek manual)
      kemungkinan    : hanya cocok 6 digit terakhir nomor rangka (WAJIB dikonfirmasi admin)
      tidak_ada      : tidak ada PO
    """
    idents = [x for x in (nk(row.get("nopol")), nk(row.get("no_rangka"))) if x]
    best = None
    for o, u in candidates or []:
        o, u = o or {}, u or {}
        keys = [nk(u.get("nopol")), nk(u.get("no_rangka")), nk(o.get("nopol")), nk(o.get("no_rangka"))]
        keys = [k for k in keys if k]
        exact = any(i in keys for i in idents)
        partial = (not exact) and any(i.isdigit() and 4 <= len(i) < 17 and any(k.endswith(i) for k in keys if len(k) >= 17) for i in idents)
        if not (exact or partial):
            continue
        rute = _route_match(row.get("asal_kota"), row.get("tujuan_kota"), o.get("asal_kota"), o.get("tujuan_kota"))
        status = ("cocok" if rute else "cocok_beda_rute") if exact else "kemungkinan"
        rank = {"cocok": 0, "cocok_beda_rute": 1, "kemungkinan": 2}[status]
        if best is None or rank < best[0]:
            best = (rank, status, o, u)
    if not best:
        return {"status": "tidak_ada"}
    _, status, o, u = best
    return {"status": status, "order_id": o.get("order_id") or "", "unit_id": str(u.get("unit_id") or ""),
            "customer": o.get("customer_nama") or "", "asal_kota": o.get("asal_kota") or "", "tujuan_kota": o.get("tujuan_kota") or "",
            "nopol": str(u.get("nopol") or "").upper(), "no_rangka": str(u.get("no_rangka") or "").upper()}


def source_sha(data: bytes) -> str:
    return hashlib.sha256(data or b"").hexdigest()


def make_key(supplier_id, source, rows):
    """Kunci idempotensi turunan bila klien tidak mengirim (hash isi yang sama = permintaan yang sama)."""
    base = "|".join([str(supplier_id), str((source or {}).get("sha256") or ""),
                     ";".join(sorted(f"{nk(r.get('nopol')) or nk(r.get('no_rangka'))}:{nk(r.get('asal_kota'))}:{nk(r.get('tujuan_kota'))}:{r['total_harga']}" for r in rows))])
    return "auto-" + hashlib.sha256(base.encode()).hexdigest()[:32]


def batch_no(key, today):
    return f"IMP-{today.replace('-', '')}-{hashlib.sha1(key.encode()).hexdigest()[:5].upper()}"


def unit_sig(job):
    """Sidik jari data keuangan sebuah unit saat diimpor (untuk mendeteksi perubahan SETELAH impor)."""
    tam = sorted(int(t.get("amount") or 0) for t in (job.get("tambahan") or []))
    raw = f"{int(job.get('total_harga') or 0)}|{tam}|{bool(job.get('ppn_enabled'))}|{bool(job.get('pph23_enabled'))}|{nk(job.get('nopol'))}|{nk(job.get('no_rangka'))}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


def batal_preview(doc, key):
    """Dampak pembatalan sebuah batch impor (TANPA menulis apa pun). Pembatalan diblokir bila ada unit yang sudah punya
    pembayaran, alokasi transfer, keterkaitan transaksi lain, atau data keuangan yang diubah setelah impor."""
    entry = next((e for e in (doc.get("import_riwayat") or []) if e.get("key") == key), None)
    if not entry:
        return {"ada": False}
    if entry.get("status") == "dibatalkan":
        return {"ada": True, "sudah_dibatalkan": True, "batch_no": entry.get("batch_no"), "boleh": False, "unit": [], "blokir": [],
                "dibatalkan": entry.get("dibatalkan") or {}}
    sig = {x.get("job_id"): x.get("sig") for x in (entry.get("unit") or [])}
    by_id = {j.get("id"): j for j in (doc.get("jobs") or [])}
    alok = set()
    for p in (doc.get("rekon_payments") or []):
        for a in (p.get("allocations") or []):
            if a.get("job_id"):
                alok.add(a["job_id"])
    units, blokir = [], []
    for jid in sig:
        j = by_id.get(jid)
        if j is None:
            units.append({"job_id": jid, "unit": "(sudah tidak ada)", "total": 0, "ada": False})
            continue
        total = int(j.get("total_harga") or 0) + sum(int(t.get("amount") or 0) for t in (j.get("tambahan") or []))
        u = {"job_id": jid, "unit": j.get("nopol") or j.get("no_rangka") or j.get("vehicle_type") or jid, "total": total, "ada": True}
        units.append(u)
        why = []
        pays = j.get("payments") or []
        if pays:
            why.append(f"{len(pays)} pembayaran tercatat (Rp{sum(int(p.get('amount') or 0) for p in pays):,})".replace(",", "."))
        if jid in alok:
            why.append("ada alokasi transfer ke unit ini")
        if j.get("leg_ref") or j.get("trip_id"):
            why.append("terkait Leg/Trip")
        if j.get("selisih_deal") or j.get("selisih_invoice"):
            why.append("selisih harga sudah diisi")
        if j.get("import_id") != key:
            why.append("unit bukan bagian dari batch ini")
        if sig.get(jid) and unit_sig(j) != sig[jid]:
            why.append("nominal/biaya tambahan/pajak diubah setelah impor")
        if why:
            blokir.append({"job_id": jid, "unit": u["unit"], "alasan": why})
    ada = [u for u in units if u["ada"]]
    return {"ada": True, "sudah_dibatalkan": False, "batch_no": entry.get("batch_no"), "boleh": bool(ada) and not blokir,
            "unit": units, "blokir": blokir,
            "dampak": {"jumlah_unit": len(ada), "total_tagihan": sum(u["total"] for u in ada)},
            "oleh": entry.get("oleh"), "at": entry.get("at"), "sumber": entry.get("sumber") or {}}


class ImportError_(Exception):
    def __init__(self, errors, warnings=None):
        super().__init__("; ".join(errors))
        self.errors, self.warnings = errors, warnings or []


def build_plan(supplier_id, doc, body, *, today, now_iso, by, new_id, po_matches=None, project_id=None, projects=None):
    """Validasi SEMUA lalu susun unit + catatan riwayat. TIDAK menulis apa pun.
    Melempar ImportError_ bila ada kesalahan yang memblokir. Mengembalikan dict:
      {key, entry, jobs, projects, warnings, idempotent_entry}
    body: {key?, rows[], tag, no_invoice, tanggal_invoice, total_invoice, source{}, izinkan_duplikat[], izinkan_selisih_total, izinkan_file_ulang}
    """
    errors, warnings = [], []
    rows_in = body.get("rows") if isinstance(body.get("rows"), list) else []
    if not rows_in:
        raise ImportError_(["Tidak ada unit untuk disimpan."])
    if len(rows_in) > MAX_ROWS:
        raise ImportError_([f"Terlalu banyak unit ({len(rows_in)}); maksimal {MAX_ROWS} per impor."])
    rows = [normalize_row(r) for r in rows_in]
    source = body.get("source") if isinstance(body.get("source"), dict) else {}
    source = {"nama": str(source.get("nama") or "")[:200], "ukuran": _int(source.get("ukuran")), "sha256": str(source.get("sha256") or "")[:64]}
    key = str(body.get("key") or "").strip()[:80] or make_key(supplier_id, source, rows)

    # Idempoten: kunci yang sama sudah berhasil -> kembalikan hasil lama, tidak menulis apa pun.
    for e in (doc.get("import_riwayat") or []):
        if e.get("key") == key and e.get("status") == "berhasil":
            return {"key": key, "entry": e, "jobs": [], "projects": None, "warnings": [], "idempotent_entry": e}

    # File yang sama pernah diimpor ke supplier ini?
    if source["sha256"] and not body.get("izinkan_file_ulang"):
        for e in (doc.get("import_riwayat") or []):
            if e.get("status") == "berhasil" and (e.get("sumber") or {}).get("sha256") == source["sha256"]:
                errors.append(f"File invoice ini sudah pernah diimpor ({e.get('batch_no')}, {e.get('at', '')[:10]}). Impor ulang ditolak agar tagihan tidak ganda.")
                break

    allow_dup = {int(i) for i in (body.get("izinkan_duplikat") or []) if str(i).lstrip("-").isdigit()}
    confirm_po = {int(i) for i in (body.get("konfirmasi_po") or []) if str(i).lstrip("-").isdigit()}
    exist = existing_keys(doc.get("jobs") or [])
    seen = {}
    tgl_inv = _date_ok(body.get("tanggal_invoice"))
    jobs_idx = []
    for i, r in enumerate(rows):
        n = i + 1
        lbl = r["nopol"] or r["no_rangka"] or f"baris {n}"
        if r["ident_status"] == "kosong" and not r["vehicle_type"]:
            errors.append(f"Baris {n}: identitas kendaraan kosong (nopol/noka dan jenis kendaraan).")
        if r["harga_dasar"] < 0:
            errors.append(f"Baris {n} ({lbl}): harga dasar negatif.")
        if any(t["amount"] <= 0 for t in r["tambahan"]):
            errors.append(f"Baris {n} ({lbl}): biaya tambahan harus lebih dari 0.")
        if r["total_harga"] > MAX_HARGA:
            errors.append(f"Baris {n} ({lbl}): nominal Rp{r['total_harga']:,} tidak wajar (> Rp2 miliar). Cek titik/koma.".replace(",", "."))
        if r["total_harga"] == 0:
            warnings.append(f"Baris {n} ({lbl}): harga 0, unit masuk sebagai Draft (harga belum lengkap).")
        raw_tgl = (rows_in[i] or {}).get("tanggal")
        if str(raw_tgl or "").strip() and not r["tanggal"]:
            errors.append(f"Baris {n} ({lbl}): format tanggal '{raw_tgl}' tidak valid (harus YYYY-MM-DD).")
        if r["ident_status"] == "perlu_konfirmasi":
            warnings.append(f"Baris {n} ({lbl}): {r['ident_catatan']}")
        k = row_key(r)
        if k:
            if k in exist and i not in allow_dup:
                errors.append(f"Baris {n} ({lbl}): unit yang sama di rute yang sama sudah ada di tagihan supplier ini (duplikat).")
            if k in seen and i not in allow_dup:
                errors.append(f"Baris {n} ({lbl}): sama dengan baris {seen[k] + 1} dalam invoice ini (duplikat).")
            seen.setdefault(k, i)
        po = (po_matches or {}).get(i) or {"status": "tidak_ada"}
        if po.get("status") == "cocok_beda_rute":
            warnings.append(f"Baris {n} ({lbl}): PO {po.get('order_id')} ditemukan tetapi rutenya berbeda.")
        if po.get("status") == "kemungkinan":
            warnings.append(f"Baris {n} ({lbl}): hanya cocok sebagian dengan PO {po.get('order_id')}; hubungan PO tidak disimpan sebelum dikonfirmasi.")
        jobs_idx.append((i, r, po))

    total = sum(r["total_harga"] for r in rows)
    inv_total = _int(body.get("total_invoice"))
    if inv_total > 0 and inv_total != total and not body.get("izinkan_selisih_total"):
        errors.append(f"Total unit Rp{total:,} tidak sama dengan total invoice Rp{inv_total:,} (selisih Rp{abs(total - inv_total):,}). Periksa nominal.".replace(",", "."))
    if errors:
        raise ImportError_(errors, warnings)

    bno = batch_no(key, today)
    no_inv = re.sub(r"\s+", " ", str(body.get("no_invoice") or "").strip())[:60]
    tag = (str(body.get("tag") or "").strip() or (f"Invoice {no_inv}" if no_inv else f"Impor {bno}"))[:60]
    jobs, ringkas = [], []
    for i, r, po in jobs_idx:
        link = po if (po.get("status") in ("cocok", "cocok_beda_rute") or (po.get("status") == "kemungkinan" and i in confirm_po)) else {}
        job = {
            "id": new_id(), "project_id": project_id,
            "vehicle_type": r["vehicle_type"], "nopol": r["nopol"], "no_rangka": r["no_rangka"],
            "asal_kota": r["asal_kota"], "tujuan_kota": r["tujuan_kota"],
            "total_harga": r["harga_dasar"],                  # harga deal; biaya tambahan dirinci di `tambahan`
            "tambahan": [{"id": new_id(), "label": t["label"], "amount": t["amount"], "created_at": now_iso} for t in r["tambahan"]],
            "catatan": r["catatan"], "tanggal": r["tanggal"] or tgl_inv or today,
            "tag": tag, "no_invoice_supplier": no_inv,       # kosong bila invoice tidak bernomor (TIDAK dikarang)
            "import_batch_no": bno, "import_id": key,
            "ident_status": r["ident_status"], "ident_catatan": r["ident_catatan"],
            "entity_id": "", "selisih_deal": None, "selisih_invoice": None,
            "order_id": link.get("order_id") or None, "customer_ref": link.get("customer") or "",
            "po_status": ("dikonfirmasi" if link and po.get("status") == "kemungkinan" else po.get("status", "tidak_ada")),
            "ppn_enabled": False, "ppn_rate": None, "pph23_enabled": False, "pph23_rate": None,
            "payments": [],                                  # impor TIDAK pernah membuat pembayaran / status lunas
        }
        jobs.append(job)
        ringkas.append({"job_id": job["id"], "unit": r["nopol"] or r["no_rangka"] or r["vehicle_type"], "total": r["total_harga"],
                        "ident_status": r["ident_status"], "po_status": job["po_status"], "order_id": link.get("order_id") or "", "sig": unit_sig(job)})
    entry = {
        "id": new_id(), "key": key, "batch_no": bno, "status": "berhasil", "oleh": by, "at": now_iso,
        "sumber": source, "no_invoice": no_inv, "tanggal_invoice": tgl_inv, "tag": tag,
        "jumlah_unit": len(jobs), "total": total, "total_invoice_dokumen": inv_total or None,
        "pencocokan": {"cocok": sum(1 for x in ringkas if x["po_status"] == "cocok"),
                       "beda_rute": sum(1 for x in ringkas if x["po_status"] == "cocok_beda_rute"),
                       "kemungkinan": sum(1 for x in ringkas if x["po_status"] in ("kemungkinan", "dikonfirmasi")),
                       "tidak_ada": sum(1 for x in ringkas if x["po_status"] == "tidak_ada")},
        "perlu_konfirmasi": sum(1 for x in ringkas if x["ident_status"] == "perlu_konfirmasi"),
        "unit": ringkas, "peringatan": warnings[:50],
    }
    return {"key": key, "entry": entry, "jobs": jobs, "projects": projects, "warnings": warnings, "idempotent_entry": None}
