#!/usr/bin/env python3
"""
run_dedup_audit.py — Jalankan AUDIT dedup (READ-ONLY) di LUAR production.

Tujuan: dapat angka LIVE tanpa deploy & tanpa menyentuh DB produksi. Cukup
EKSPOR collection (read-only) ke JSON, lalu jalankan skrip ini secara lokal.

Cara ekspor (read-only, tidak mengubah apa pun), contoh mongoexport:
  mongoexport --uri "$MONGO_URL" --db "$DB_NAME" --collection supplier_profiles --jsonArray --out supplier_profiles.json
  mongoexport --uri "$MONGO_URL" --db "$DB_NAME" --collection contacts          --jsonArray --out contacts.json
  # opsional (biar hitungan referensi akurat):
  mongoexport ... --collection bank_payment_imports --jsonArray --out bank_payment_imports.json
  mongoexport ... --collection permintaan_harga      --jsonArray --out permintaan_harga.json

Jalankan:
  python3 run_dedup_audit.py supplier_profiles.json contacts.json [bank_payment_imports.json] [permintaan_harga.json]

TIDAK menulis/menghapus apa pun. Hanya membaca JSON & mencetak ringkasan.
"""
import sys, json, asyncio, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/
import supplier_dedup as D


def _load(path):
    if not path or not os.path.exists(path):
        return []
    txt = open(path, encoding="utf-8").read().strip()
    if not txt:
        return []
    try:
        data = json.loads(txt)
        return data if isinstance(data, list) else [data]
    except json.JSONDecodeError:
        # NDJSON (satu dokumen per baris)
        return [json.loads(ln) for ln in txt.splitlines() if ln.strip()]


def _mval(dv, cond):
    if isinstance(cond, dict):
        if "$ne" in cond and dv == cond["$ne"]:
            return False
        return True
    return dv == cond


class _Cur:
    def __init__(self, d): self._d = d
    def sort(self, *a, **k): return self
    def limit(self, n): self._d = self._d[:n]; return self
    def __aiter__(self): self._i = 0; return self
    async def __anext__(self):
        if self._i >= len(self._d): raise StopAsyncIteration
        x = self._d[self._i]; self._i += 1; return x


class _Coll:
    def __init__(self, docs=None): self.docs = [dict(x) for x in (docs or [])]
    @staticmethod
    def _m(d, f): return all(_mval(d.get(k), v) for k, v in (f or {}).items())
    async def count_documents(self, f): return len([d for d in self.docs if self._m(d, f)])
    async def find_one(self, f, proj=None):
        for d in self.docs:
            if self._m(d, f):
                r = dict(d); r.pop("_id", None); return r
        return None
    def find(self, f=None, proj=None):
        return _Cur([{k: v for k, v in d.items() if k != "_id"} for d in self.docs if self._m(d, f or {})])


class _DB:
    def __init__(self, cols): object.__setattr__(self, "c", cols)
    def __getitem__(self, n): return self.c.setdefault(n, _Coll())
    def __getattr__(self, n): return object.__getattribute__(self, "c").setdefault(n, _Coll())


def _rp(n): return "Rp " + format(int(n or 0), ",d").replace(",", ".")


async def main(argv):
    sup = _load(argv[1] if len(argv) > 1 else None)
    con = _load(argv[2] if len(argv) > 2 else None)
    imp = _load(argv[3] if len(argv) > 3 else None)
    per = _load(argv[4] if len(argv) > 4 else None)
    db = _DB({"supplier_profiles": _Coll(sup), "contacts": _Coll(con),
              "bank_payment_imports": _Coll(imp), "permintaan_harga": _Coll(per)})

    print("=" * 64)
    print("AUDIT DEDUP SUPPLIER (read-only)")
    print("=" * 64)
    a = await D.audit_duplicates(db)
    print(f"Total Supplier           : {a['total_suppliers']}")
    print(f"Kandidat grup duplikat   : {a['candidate_groups']}")
    print(f"  - bisa disarankan merge: {a['auto_suggestable_groups']}")
    print(f"  - perlu review (ambigu): {a['needs_review_groups']}")
    print(f"Record kosong/tak dipakai: {a['empty_unused_count']}")
    for g in a["groups"]:
        print(f"\n  [{g['confidence'].upper()}] basis={g['basis']} nama={g['names']}")
        print(f"    saran master: {g['suggested_master_id']}  (needs_review={g['needs_review']})")
        for m in g["members"]:
            u = m["usage"]
            star = " ★MASTER" if m["is_suggested_master"] else ""
            print(f"      - {m['supplier_id']} '{m['nama']}' hp={m['no_hp']} | job={u['jobs']} pay={u['payments_count']}({_rp(u['payments_sum'])}) rekon={u['rekon_payments']} import={u['import_refs']} minta={u['permintaan_refs']}{star}")
        if g["conflicts"]:
            print(f"    KONFLIK: {g['conflicts']}")

    print("\n" + "=" * 64)
    print("AUDIT DEDUP CONTACTS (read-only)")
    print("=" * 64)
    c = await D.audit_contacts(db)
    print(f"Total Contacts           : {c['total_contacts']}")
    print(f"Kandidat grup duplikat   : {c['candidate_groups']}")
    print(f"  - high confidence      : {c['high_confidence']}")
    print(f"  - medium confidence    : {c['medium_confidence']}")
    print(f"  - perlu review         : {c['needs_review_groups']}")
    print(f"Contact kosong           : {c['empty_count']}")
    for g in c["groups"]:
        print(f"\n  [{g['confidence'].upper()}] jenis={g['jenis']} basis={g['basis']} nama={g['names']} saran_master={g['suggested_master_id']}")
        for m in g["members"]:
            star = " ★MASTER" if m["is_suggested_master"] else ""
            print(f"      - {m['contact_id']} '{m['nama']}' hp={m['no_hp']} email={m['email']} lengkap={m['completeness']}{star}")
        if g["conflicts"]:
            print(f"    KONFLIK: {g['conflicts']}")

    print("\nSelesai. TIDAK ada data yang diubah.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    asyncio.run(main(sys.argv))
