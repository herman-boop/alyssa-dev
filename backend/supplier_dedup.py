"""
supplier_dedup.py — Audit & merge DUPLIKAT Master Supplier (alyssa-dev).

Tujuan: 1 supplier nyata = 1 master record = 1 supplier_id permanen.
Nama BUKAN identifier (dua supplier beda boleh senama) → nama cuma dipakai cari
KANDIDAT, bukan vonis duplikat.

Prinsip aman (sesuai brief):
- AUDIT dulu (read-only), hasilkan daftar kandidat + saran master + konflik.
- Merge MANUAL & eksplisit (pilih canonical + duplicate_ids). Default DRY-RUN.
- JANGAN auto-merge kasus ambigu (nama sama tapi no_hp beda = kemungkinan beda
  supplier → needs_review, tidak disarankan merge).
- Reversible: snapshot penuh canonical + tiap duplikat + daftar referensi eksternal
  disimpan di `supplier_merge_log` → bisa di-unmerge.
- Tidak mengubah nominal/tanggal/no-invoice/pembayaran/HPP. Yang dipindah hanya
  KEPEMILIKAN (jobs/rekon_payments/projects embedded) + REFERENSI supplier_id
  eksternal (bank_payment_imports, permintaan_harga).

Transaksi supplier EMBEDDED di supplier_profiles (jobs[].payments[], rekon_payments[]).
Trip/order TIDAK menyimpan supplier_id (HPP baca via scan supplier_profiles), jadi
merge = pindah embedded + repoint 2 collection eksternal saja.
"""

import re
import uuid
import logging
from datetime import datetime, timezone

logger = logging.getLogger("dedup")

MERGE_LOG = "supplier_merge_log"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _gen_id():
    return uuid.uuid4().hex[:12]


def _norm_name(s):
    s = str(s or "").lower().strip()
    s = s.replace(".", " ")
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def _norm_phone(s):
    d = re.sub(r"\D", "", str(s or ""))
    if d.startswith("0"):
        d = "62" + d[1:]
    return d


def _payments_count_sum(sup):
    cnt = tot = 0
    for j in (sup.get("jobs") or []):
        for p in (j.get("payments") or []):
            cnt += 1
            tot += p.get("amount") or 0
    return cnt, tot


async def usage(db, sup):
    """Hitung seberapa 'terpakai' sebuah supplier (buat pilih master & keamanan hapus)."""
    jobs = sup.get("jobs") or []
    pay_cnt, pay_sum = _payments_count_sum(sup)
    rekon = [p for p in (sup.get("rekon_payments") or [])]
    sid = sup.get("id")
    imports = await db.bank_payment_imports.count_documents({"supplier_id": sid})
    permintaan = await db.permintaan_harga.count_documents({"supplier_id": sid})
    ref_total = len(jobs) + pay_cnt + len(rekon) + imports + permintaan
    completeness = sum(1 for k in ("no_hp", "catatan", "jenis") if str(sup.get(k) or "").strip())
    return {
        "jobs": len(jobs), "payments_count": pay_cnt, "payments_sum": pay_sum,
        "rekon_payments": len(rekon), "import_refs": imports, "permintaan_refs": permintaan,
        "ref_total": ref_total, "completeness": completeness,
        "empty_unused": ref_total == 0,
    }


def _master_score(u, sup):
    # Prioritas: PO/job > payment > rekon/invoice > referensi eksternal > kelengkapan.
    return (u["jobs"] * 1000 + u["payments_count"] * 500 + u["payments_sum"] // 1000
            + u["rekon_payments"] * 300 + (u["import_refs"] + u["permintaan_refs"]) * 200
            + u["completeness"] * 10)


async def audit_duplicates(db):
    """READ-ONLY. Kelompokkan kandidat duplikat + saran master + konflik.
    TIDAK mengubah data apa pun."""
    sups = []
    async for s in db.supplier_profiles.find({"status": {"$ne": "merged"}}, {"_id": 0}):
        sups.append(s)
    total = len(sups)

    # index usage sekali
    u_by_id = {}
    for s in sups:
        u_by_id[s["id"]] = await usage(db, s)

    def _group(key_fn):
        g = {}
        for s in sups:
            k = key_fn(s)
            if not k:
                continue
            g.setdefault(k, []).append(s)
        return {k: v for k, v in g.items() if len(v) > 1}

    by_name = _group(lambda s: _norm_name(s.get("nama")))
    by_phone = _group(lambda s: _norm_phone(s.get("no_hp")))

    groups = []
    seen_group_keys = set()

    def _emit(members, basis):
        ids = tuple(sorted(m["id"] for m in members))
        if ids in seen_group_keys:
            return
        seen_group_keys.add(ids)
        phones = {_norm_phone(m.get("no_hp")) for m in members if _norm_phone(m.get("no_hp"))}
        names = {_norm_name(m.get("nama")) for m in members}
        # confidence
        if basis == "phone" and len(phones) == 1:
            confidence = "high"            # no_hp identik (sinyal kuat)
        elif basis == "name" and len(phones) <= 1:
            confidence = "high" if phones else "medium"
        elif basis == "name" and len(phones) > 1:
            confidence = "needs_review"    # nama sama, telepon beda → mungkin BEDA supplier
        else:
            confidence = "medium"
        ranked = sorted(members, key=lambda m: _master_score(u_by_id[m["id"]], m), reverse=True)
        master = ranked[0]
        conflicts = []
        if len({_norm_phone(m.get("no_hp")) for m in members if _norm_phone(m.get("no_hp"))}) > 1:
            conflicts.append({"field": "no_hp", "values": sorted({m.get("no_hp") for m in members if (m.get("no_hp") or "").strip()})})
        groups.append({
            "basis": basis,
            "confidence": confidence,
            "names": sorted(names),
            "suggested_master_id": master["id"],
            "suggested_master_reason": "penggunaan terbanyak (PO/job, payment, referensi) + data terlengkap",
            "conflicts": conflicts,
            "needs_review": confidence == "needs_review",
            "members": [{
                "supplier_id": m["id"], "nama": m.get("nama"), "no_hp": m.get("no_hp") or "",
                "created_at": m.get("created_at"), "usage": u_by_id[m["id"]],
                "is_suggested_master": m["id"] == master["id"],
            } for m in ranked],
        })

    for members in by_name.values():
        _emit(members, "name")
    for members in by_phone.values():
        # hanya emit kalau belum tercakup grup nama
        _emit(members, "phone")

    empty_unused = [{"supplier_id": s["id"], "nama": s.get("nama")} for s in sups if u_by_id[s["id"]]["empty_unused"]]

    return {
        "total_suppliers": total,
        "candidate_groups": len(groups),
        "needs_review_groups": sum(1 for g in groups if g["needs_review"]),
        "auto_suggestable_groups": sum(1 for g in groups if not g["needs_review"]),
        "empty_unused_count": len(empty_unused),
        "empty_unused": empty_unused[:200],
        "groups": groups,
        "note": "READ-ONLY. Nama sama ≠ otomatis duplikat. Merge tetap manual & dry-run dulu. "
                "Supplier master belum menyimpan no_rek/npwp/email/alamat → sinyal dedup saat ini: nama + no_hp.",
    }


async def _collect_external_refs(db, sid):
    imports = [d["bank_transaction_id"] async for d in
               db.bank_payment_imports.find({"supplier_id": sid}, {"_id": 0, "bank_transaction_id": 1})]
    permintaan = [d["id"] async for d in
                  db.permintaan_harga.find({"supplier_id": sid}, {"_id": 0, "id": 1})]
    return imports, permintaan


async def merge_suppliers(db, canonical_id, duplicate_ids, dry_run=True, reason="", by="admin"):
    """Gabungkan duplicate_ids → canonical_id. Default DRY-RUN (tidak menulis).
    Reversible: snapshot penuh disimpan di supplier_merge_log."""
    canonical_id = str(canonical_id or "").strip()
    dups = [str(d or "").strip() for d in (duplicate_ids or []) if str(d or "").strip() and str(d).strip() != canonical_id]
    dups = list(dict.fromkeys(dups))  # unik, buang canonical
    if not canonical_id or not dups:
        return {"error": "canonical_id dan minimal 1 duplicate_id (berbeda) wajib"}

    canonical = await db.supplier_profiles.find_one({"id": canonical_id}, {"_id": 0})
    if not canonical:
        return {"error": f"canonical {canonical_id} tidak ditemukan"}

    plan = {"canonical_id": canonical_id, "canonical_nama": canonical.get("nama"),
            "dry_run": dry_run, "duplicates": [], "fill_fields": {}, "warnings": []}
    dup_docs = []
    for did in dups:
        d = await db.supplier_profiles.find_one({"id": did}, {"_id": 0})
        if not d:
            plan["warnings"].append(f"duplicate {did} tidak ditemukan — dilewati")
            continue
        if d.get("status") == "merged":
            plan["warnings"].append(f"duplicate {did} sudah merged — dilewati")
            continue
        imports, permintaan = await _collect_external_refs(db, did)
        dup_docs.append(d)
        plan["duplicates"].append({
            "supplier_id": did, "nama": d.get("nama"),
            "move_jobs": len(d.get("jobs") or []),
            "move_rekon_payments": len(d.get("rekon_payments") or []),
            "move_projects": len(d.get("projects") or []),
            "repoint_imports": imports, "repoint_permintaan": permintaan,
        })

    # Field yang bisa diisi ke master kalau master kosong (TIDAK menimpa yang beda).
    for k in ("no_hp", "jenis", "catatan", "ringkasan_catatan"):
        if not str(canonical.get(k) or "").strip():
            for d in dup_docs:
                if str(d.get(k) or "").strip():
                    plan["fill_fields"][k] = d.get(k)
                    break
    # Konflik (beda non-kosong) → simpan sbg alias/review, jangan timpa.
    for k in ("no_hp",):
        cv = str(canonical.get(k) or "").strip()
        others = {str(d.get(k) or "").strip() for d in dup_docs if str(d.get(k) or "").strip()}
        diff = {o for o in others if o and o != cv}
        if cv and diff:
            plan["warnings"].append(f"konflik {k}: master='{cv}' vs {sorted(diff)} → dipertahankan di master, lainnya disimpan sbg alias_{k}")

    if dry_run or not dup_docs:
        return {"status": "dry_run" if dry_run else "noop", "plan": plan}

    # ── EKSEKUSI (branch/test; production nunggu ACC) ──
    log_id = _gen_id()
    log = {"id": log_id, "at": _now(), "reason": str(reason or "")[:300], "by": by,
           "canonical_id": canonical_id, "canonical_before": dict(canonical),
           "duplicates": [], "status": "active"}

    new_jobs = list(canonical.get("jobs") or [])
    new_rekon = list(canonical.get("rekon_payments") or [])
    new_projects = list(canonical.get("projects") or [])
    proj_ids = {p.get("id") for p in new_projects}
    aliases = list(canonical.get("aliases") or [])
    merged_from = list(canonical.get("merged_from") or [])
    alias_phones = list(canonical.get("alias_no_hp") or [])

    for d in dup_docs:
        did = d["id"]
        new_jobs += (d.get("jobs") or [])
        new_rekon += (d.get("rekon_payments") or [])
        for p in (d.get("projects") or []):
            if p.get("id") not in proj_ids:
                new_projects.append(p); proj_ids.add(p.get("id"))
        if _norm_name(d.get("nama")) != _norm_name(canonical.get("nama")) and d.get("nama") not in aliases:
            aliases.append(d.get("nama"))
        dcv = str(d.get("no_hp") or "").strip()
        if dcv and dcv != str(canonical.get("no_hp") or "").strip() and dcv not in alias_phones:
            alias_phones.append(dcv)
        imports, permintaan = await _collect_external_refs(db, did)
        if imports:
            await db.bank_payment_imports.update_many({"supplier_id": did}, {"$set": {"supplier_id": canonical_id}})
        if permintaan:
            await db.permintaan_harga.update_many({"supplier_id": did}, {"$set": {"supplier_id": canonical_id}})
        merged_from.append({"id": did, "nama": d.get("nama"), "at": _now()})
        log["duplicates"].append({"id": did, "before": dict(d),
                                  "repointed_imports": imports, "repointed_permintaan": permintaan})
        # Jadikan tombstone: kosongkan embedded (sudah pindah) + tandai merged → redirect.
        await db.supplier_profiles.update_one({"id": did}, {"$set": {
            "status": "merged", "merged_into": canonical_id, "merged_at": _now(),
            "jobs": [], "rekon_payments": [], "projects": [],
        }})

    cu = {"jobs": new_jobs, "rekon_payments": new_rekon, "projects": new_projects,
          "aliases": aliases, "merged_from": merged_from, "alias_no_hp": alias_phones}
    cu.update(plan["fill_fields"])
    await db.supplier_profiles.update_one({"id": canonical_id}, {"$set": cu})
    await db[MERGE_LOG].insert_one(dict(log))

    return {"status": "merged", "canonical_id": canonical_id, "merged": [d["id"] for d in dup_docs],
            "log_id": log_id, "reversible": True, "plan": plan}


async def unmerge(db, log_id):
    """Kembalikan hasil merge (reversible) dari snapshot di supplier_merge_log."""
    log = await db[MERGE_LOG].find_one({"id": log_id}, {"_id": 0})
    if not log:
        return {"error": "merge log tidak ditemukan"}
    if log.get("status") == "reverted":
        return {"status": "already_reverted", "log_id": log_id}
    cid = log["canonical_id"]

    async def _restore(id_, before):
        before = dict(before); before.pop("_id", None)
        cur = await db.supplier_profiles.find_one({"id": id_}, {"_id": 0}) or {}
        unset = {k: "" for k in cur.keys() if k not in before}  # buang field yg ditambah merge
        ops = {"$set": before}
        if unset:
            ops["$unset"] = unset
        await db.supplier_profiles.update_one({"id": id_}, ops)

    # restore canonical (persis spt sebelum merge)
    await _restore(cid, log["canonical_before"])
    # restore tiap duplikat + repoint balik referensi eksternal
    for dd in log.get("duplicates", []):
        await _restore(dd["id"], dd["before"])
        for btid in dd.get("repointed_imports", []):
            await db.bank_payment_imports.update_one({"bank_transaction_id": btid}, {"$set": {"supplier_id": dd["id"]}})
        for pid in dd.get("repointed_permintaan", []):
            await db.permintaan_harga.update_one({"id": pid}, {"$set": {"supplier_id": dd["id"]}})
    await db[MERGE_LOG].update_one({"id": log_id}, {"$set": {"status": "reverted", "reverted_at": _now()}})
    return {"status": "reverted", "log_id": log_id, "canonical_id": cid,
            "restored_duplicates": [d["id"] for d in log.get("duplicates", [])]}


async def resolve_canonical_id(db, supplier_id):
    """Ikuti rantai merged_into → supplier_id canonical. Dipakai integrasi Rekon
    supaya ID duplikat lama tetap nyambung ke master (alias mapping)."""
    sid = str(supplier_id or "").strip()
    seen = set()
    while sid and sid not in seen:
        seen.add(sid)
        d = await db.supplier_profiles.find_one({"id": sid}, {"_id": 0, "status": 1, "merged_into": 1})
        if not d or d.get("status") != "merged" or not d.get("merged_into"):
            return sid
        sid = d.get("merged_into")
    return sid
