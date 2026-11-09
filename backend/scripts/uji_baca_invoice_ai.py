#!/usr/bin/env python
"""Uji pembacaan invoice dengan AI SUNGGUHAN (bukan mock) memakai invoice contoh AHMAD TAUFDIQ (data tiruan).
Jalankan di STAGING/lokal dengan ANTHROPIC_API_KEY terpasang; TIDAK menyentuh database:

    cd backend && ANTHROPIC_API_KEY=... MONGO_URL=mongodb://x DB_NAME=t python scripts/uji_baca_invoice_ai.py [file.pdf]

Memeriksa hasil bacaan AI -> normalisasi impor (supplier_import) terhadap target kasus: 10 unit, Rp45.600.000, biaya pengambilan
Tronton Rp1.400.000/unit, identitas 6 digit ditandai perlu konfirmasi, tidak ada nomor invoice karangan. Kode keluar 0 = lulus."""
import os, sys, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("MONGO_URL", "mongodb://x"); os.environ.setdefault("DB_NAME", "t")
import server
import supplier_import as SI

path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures", "invoice-contoh-ahmad.pdf")
data = open(path, "rb").read()
res = server._parse_invoice_ai(data, "application/pdf")
rows = [SI.normalize_row(r) for r in (res.get("rows") or [])]
total = sum(r["total_harga"] for r in rows)
cek = []
def ok(nama, kondisi, info=""):
    cek.append((nama, bool(kondisi), info))
ok("10 unit terbaca (satu kendaraan = satu baris)", len(rows) == 10, f"{len(rows)} unit")
ok("total Rp45.600.000", total == 45_600_000, f"Rp{total:,}")
tr = [r for r in rows if SI.nk(r["nopol"]) in ("S8625HN", "S8614HN")]
ok("2 unit Tronton @ Rp10.600.000 + biaya pengambilan Rp1.400.000", len(tr) == 2 and all(r["harga_dasar"] == 10_600_000 and sum(t["amount"] for t in r["tambahan"]) == 1_400_000 for r in tr), str([(r["nopol"], r["harga_dasar"], r["tambahan"]) for r in tr]))
lemah = [r for r in rows if r["ident_status"] == "perlu_konfirmasi"]
ok("identitas 6 digit ditandai perlu konfirmasi (5 unit)", {r["no_rangka"] for r in lemah} >= {"121252", "121258", "121248", "121251", "009503"}, str(sorted(r["no_rangka"] for r in lemah)))
ok("nomor invoice supplier tidak dikarang", not str(res.get("no_invoice") or "").strip(), repr(res.get("no_invoice")))
ok("tanpa duplikat dalam invoice", len({SI.row_key(r) for r in rows}) == len(rows))
for n, b, i in cek:
    print(("LULUS " if b else "GAGAL ") + n + (f"  [{i}]" if i else ""))
print(json.dumps(res, ensure_ascii=False)[:600])
sys.exit(0 if all(b for _, b, _ in cek) else 1)
