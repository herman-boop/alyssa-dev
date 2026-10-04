#!/usr/bin/env python3
"""
test_felis_rekon.py — Uji integrasi PEMBAYARAN SUPPLIER Felis → alyssa-dev.

Fokus: rekon_sync (ingest idempoten, supplier_not_found aman, pemisahan entitas,
Unallocated Payment, alokasi audit-only, reverse, koreksi) + rekon_felis_client
(adapter READY/ACK/KOREKSI/AKUI: URL, Bearer, parsing, 401/400).

Tanpa MongoDB sungguhan: pakai Fake async DB in-memory. Tanpa jaringan: `requests`
dipalsukan. Jalankan: python3 backend/tests/test_felis_rekon.py
"""
import os, sys, asyncio, types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/
import rekon_sync as R
from supplier_dedup import suggest_similar


# ── Fake async Mongo (cukup untuk yang dipakai rekon_sync) ───────────────────
class DupKey(Exception):
    pass


class FakeColl:
    def __init__(self):
        self.docs = []
        self._unique = set()

    async def create_index(self, key, unique=False, sparse=False):
        if unique:
            self._unique.add(key if isinstance(key, str) else str(key))
        return "idx"

    async def insert_one(self, doc):
        d = dict(doc)
        for uk in self._unique:
            if uk in d and d[uk] is not None:
                for ex in self.docs:
                    if ex.get(uk) == d[uk]:
                        raise DupKey(uk)
        self.docs.append(d)
        return types.SimpleNamespace(inserted_id="x")

    @staticmethod
    def _match(d, filt):
        return all(d.get(k) == v for k, v in (filt or {}).items())

    async def find_one(self, filt, proj=None):
        for d in self.docs:
            if self._match(d, filt):
                r = dict(d); r.pop("_id", None); return r
        return None

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self._match(d, filt):
                d.update((update or {}).get("$set") or {})
                return types.SimpleNamespace(modified_count=1)
        if upsert:
            nd = dict(filt); nd.update((update or {}).get("$set") or {}); self.docs.append(nd)
            return types.SimpleNamespace(modified_count=0, upserted_id="x")
        return types.SimpleNamespace(modified_count=0)


class FakeDB:
    def __init__(self):
        self._c = {}

    def __getitem__(self, name):
        return self._c.setdefault(name, FakeColl())

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._c.setdefault(name, FakeColl())


# Pakai DupKey kita sebagai DuplicateKeyError rekon_sync (sandbox: pymongo mati).
R.DuplicateKeyError = DupKey


def _payload(**over):
    p = {
        "idempotency_key": "7e94dd12-e63d-44d0-a840-3c93adcb89b3",
        "bank_transaction_id": "7e94dd12-e63d-44d0-a840-3c93adcb89b3",
        "bank_transaction_sidik": "21434c73ca5b56aca1118e0f1557d1bb",
        "supplier_id": "a3f9c1e2",
        "supplier_name": "MARTHEN RUTURAMBE",
        "source_entity": "PT_ALYSSA_AUTO_LOGISTIK",
        "source_entity_label": "PT Alyssa Auto Logistik",
        "source_account_number": "0072890271",
        "beneficiary_bank_code": "008",
        "beneficiary_name_raw": "HERMANSYAH KBB",
        "bank_account_number": None,
        "bank_account_name": None,
        "tanggal": "2026-09-17",
        "nominal": 5000000,
        "deskripsi_bank": "BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB",
        "referensi_bank": "FT26260917",
        "alokasi": [{"tipe": "CATATAN", "ref": "Pengiriman unit Surabaya Sep-26", "nominal": 5000000}],
    }
    p.update(over)
    return p


async def _seed_supplier(db, sid="a3f9c1e2", nama="MARTHEN RUTURAMBE", jobs=None):
    await db.supplier_profiles.insert_one({"id": sid, "nama": nama, "jobs": jobs or [], "rekon_payments": []})


PASS = 0


def ok(cond, msg):
    global PASS
    assert cond, "FAIL: " + msg
    PASS += 1
    print("  ok:", msg)


async def test_ingest_basic():
    print("test_ingest_basic")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db)
    r = await R.ingest_transaction(db, _payload())
    ok(r["status"] == "created", "transaksi baru → created")
    ok(r["source_entity"] == "PT_ALYSSA_AUTO_LOGISTIK", "entitas terbawa di hasil")
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    rps = sup["rekon_payments"]
    ok(len(rps) == 1, "1 pembayaran rekon tersimpan di level supplier")
    p = rps[0]
    ok(p["amount"] == 5000000, "nominal benar")
    ok(p["source_entity"] == "PT_ALYSSA_AUTO_LOGISTIK", "source_entity jadi field kelas satu")
    ok(p["allocations"] == [], "alokasi KONTRAK TIDAK jadi alokasi job → Unallocated")
    ok(p["rekon"]["alokasi_note"] and p["rekon"]["alokasi_note"][0]["tipe"] == "CATATAN",
       "alokasi kontrak disimpan sebagai catatan audit")
    ok(p["catatan"].startswith("BI-FAST"), "catatan = deskripsi_bank (otoritatif)")
    ok(p["rekon"]["beneficiary_name_raw"] == "HERMANSYAH KBB", "beneficiary_name_raw hanya di audit")
    ok(p["rekon"]["bank_transaction_sidik"] == "21434c73ca5b56aca1118e0f1557d1bb", "sidik disimpan utk audit")
    ok("sidik" not in p and p.get("bank_transaction_id") == _payload()["bank_transaction_id"],
       "kunci = bank_transaction_id, bukan sidik")


async def test_idempotent():
    print("test_idempotent")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db)
    r1 = await R.ingest_transaction(db, _payload())
    r2 = await R.ingest_transaction(db, _payload())           # kirim ulang persis
    ok(r1["status"] == "created" and r2["status"] == "already_processed",
       "kirim dua kali → kedua already_processed (tidak dobel)")
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    ok(len(sup["rekon_payments"]) == 1, "tetap 1 pembayaran (UNIQUE btid menahan)")


async def test_idempotency_key_only():
    print("test_idempotency_key_only")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db)
    p = _payload(); p.pop("bank_transaction_id")   # cuma idempotency_key
    r = await R.ingest_transaction(db, p)
    ok(r["status"] == "created", "pakai idempotency_key saja tetap jalan")
    r2 = await R.ingest_transaction(db, p)
    ok(r2["status"] == "already_processed", "idempotency_key juga menahan dobel")


async def test_supplier_not_found():
    print("test_supplier_not_found")
    db = FakeDB(); await R.ensure_indexes(db)  # TANPA seed supplier
    r = await R.ingest_transaction(db, _payload())
    ok(r["status"] == "supplier_not_found", "supplier_id tak ada → supplier_not_found")
    # tidak membuat supplier baru:
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    ok(sup is None, "TIDAK membuat supplier baru dari data penarikan")
    # masih retryable (status bukan final): seed lalu ingest lagi → created
    await _seed_supplier(db)
    r2 = await R.ingest_transaction(db, _payload())
    ok(r2["status"] == "created", "setelah supplier ada, penarikan ulang → created (retryable)")


async def test_entity_validation():
    print("test_entity_validation")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db)
    r = await R.ingest_transaction(db, _payload(source_entity="BUKAN_ENTITAS"))
    ok(r["status"] == "error", "source_entity tak dikenal → error (bukan bawaan)")
    r2 = await R.ingest_transaction(db, _payload(source_entity=""))
    ok(r2["status"] == "error", "source_entity kosong → error")


async def test_reverse():
    print("test_reverse")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db)
    await R.ingest_transaction(db, _payload())
    rv = await R.reverse_import(db, _payload()["bank_transaction_id"], reason="salah")
    ok(rv["status"] == "reversed", "reverse → reversed")
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    ok(sup["rekon_payments"][0]["status"] == "reversed", "pembayaran ditandai reversed")
    # re-ingest setelah reversed → tetap final (tidak hidup lagi diam-diam)
    r = await R.ingest_transaction(db, _payload())
    ok(r["status"] == "reversed", "re-ingest btid yang reversed → tetap reversed (final)")


async def test_allocate():
    print("test_allocate")
    jobs = [{"id": "job1"}, {"id": "job2"}]
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db, jobs=jobs)
    r = await R.ingest_transaction(db, _payload())
    pid = r["rekon_payment_id"]
    bad = await R.allocate_payment(db, "a3f9c1e2", pid, [{"job_id": "job1", "amount": 9999999}])
    ok(bad.get("error"), "alokasi melebihi nominal → ditolak")
    good = await R.allocate_payment(db, "a3f9c1e2", pid, [{"job_id": "job1", "amount": 2000000}])
    ok(good.get("ok") and good["allocated"] == 2000000 and good["unallocated"] == 3000000,
       "alokasi sebagian: allocated 2jt, unallocated 3jt")
    badjob = await R.allocate_payment(db, "a3f9c1e2", pid, [{"job_id": "ga-ada", "amount": 1000}])
    ok(badjob.get("error"), "alokasi ke job_id tak valid → ditolak")


async def test_koreksi():
    print("test_koreksi")
    db = FakeDB(); await R.ensure_indexes(db)
    await _seed_supplier(db, sid="a3f9c1e2", nama="SALAH")
    await _seed_supplier(db, sid="b1b1b1b1", nama="BENAR")
    await R.ingest_transaction(db, _payload())
    btid = _payload()["bank_transaction_id"]
    # supplier baru tidak ada → tolak
    bad = await R.apply_correction(db, btid, "zzzz9999")
    ok(bad["status"] == "supplier_baru_not_found", "supplier_id_baru tak ada → tolak (tak buat baru)")
    # pindah ke supplier benar
    mv = await R.apply_correction(db, btid, "b1b1b1b1", reason="salah pilih")
    ok(mv["status"] == "moved", "koreksi → pembayaran dipindah")
    lama = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    baru = await db.supplier_profiles.find_one({"id": "b1b1b1b1"})
    ok(len(lama["rekon_payments"]) == 0, "pembayaran hilang dari supplier lama")
    ok(len(baru["rekon_payments"]) == 1 and baru["rekon_payments"][0]["bank_transaction_id"] == btid,
       "pembayaran ada di supplier baru (btid sama)")
    ok(baru["rekon_payments"][0]["allocations"] == [], "alokasi di-reset setelah pindah supplier")
    # idempoten: apply lagi → same_supplier
    again = await R.apply_correction(db, btid, "b1b1b1b1")
    ok(again["status"] == "same_supplier", "apply ulang → same_supplier (idempoten)")


# ── Adapter Felis (fake requests) ────────────────────────────────────────────
class FakeResp:
    def __init__(self, status, payload=None):
        self.status_code = status
        self._payload = payload or {}
        self.headers = {}

    def json(self):
        return self._payload


def _install_fake_requests(captured, resp_by_method):
    fake = types.ModuleType("requests")

    def _get(url, params=None, headers=None, timeout=None):
        captured.append(("GET", url, params, headers, None))
        return resp_by_method.get(("GET", url.split("/integrasi/")[-1]), FakeResp(200, {}))

    def _post(url, data=None, headers=None, timeout=None):
        captured.append(("POST", url, None, headers, data))
        return resp_by_method.get(("POST", url.split("/integrasi/")[-1]), FakeResp(200, {}))

    fake.get = _get
    fake.post = _post
    sys.modules["requests"] = fake


async def test_felis_adapter():
    print("test_felis_adapter")
    import rekon_felis_client as F
    os.environ.pop("FELIS_API_TOKEN", None)
    os.environ["FELIS_BASE_URL"] = "https://felis-alyssa-production.up.railway.app/"
    os.environ["FELIS_TOKEN"] = "x" * 40  # nama ENV kontrak V2; ≥32 → configured
    ok(F.is_configured(), "ENV lengkap (FELIS_TOKEN) → configured")
    os.environ["FELIS_TOKEN"] = "short"
    ok(not F.is_configured(), "token < 32 char → dianggap tidak ada (mati)")
    os.environ["FELIS_TOKEN"] = "x" * 40
    # fallback nama lama masih diterima
    del os.environ["FELIS_TOKEN"]; os.environ["FELIS_API_TOKEN"] = "y" * 40
    ok(F.is_configured(), "fallback FELIS_API_TOKEN masih diterima")
    os.environ.pop("FELIS_API_TOKEN", None); os.environ["FELIS_TOKEN"] = "x" * 40

    cap = []
    _install_fake_requests(cap, {
        ("GET", "siap-tarik"): FakeResp(200, {"batch": "B1", "jumlah": 0, "data": []}),
        ("POST", "tandai-tertarik"): FakeResp(200, {"batch": "B1", "ditandai": 1,
                                                    "sudah_batch_lain": [], "tidak_dikenal": []}),
        ("GET", "koreksi"): FakeResp(200, {"jumlah": 0, "data": []}),
        ("POST", "koreksi/akui"): FakeResp(200, {"diakui": 1}),
    })
    ready = await F.fetch_ready(entitas="PT_ALYSSA_AUTO_LOGISTIK")
    ok(ready["batch"] == "B1", "READY parse batch")
    m, url, params, headers, _ = cap[-1]
    ok(m == "GET" and url.endswith("/api/integrasi/siap-tarik"), "URL READY benar (prefix /api)")
    ok(headers["Authorization"].startswith("Bearer "), "pakai Bearer token")
    ok("x" * 40 not in str(params), "token tidak bocor ke query")
    ok(params.get("entitas") == "PT_ALYSSA_AUTO_LOGISTIK", "param entitas diteruskan")

    ack = await F.ack("B1", ["id1", "id2"])
    ok(ack["ditandai"] == 1, "ACK parse respons")
    m, url, _, _, data = cap[-1]
    ok(url.endswith("/api/integrasi/tandai-tertarik") and "B1" in data and "id1" in data, "body ACK benar")

    kor = await F.fetch_koreksi()
    ok(kor["jumlah"] == 0, "KOREKSI parse")
    aku = await F.akui_koreksi(["id1"])
    ok(aku["diakui"] == 1, "AKUI parse")

    # 401 → error jelas (token tak sah)
    _install_fake_requests([], {("GET", "siap-tarik"): FakeResp(401, {"kode": "token_tidak_sah"})})
    try:
        await F.fetch_ready()
        ok(False, "401 harus melempar")
    except F.FelisError as e:
        ok("401" in str(e) or "tidak sah" in str(e).lower(), "401 → FelisError jelas")


async def test_pull_ack_selection():
    print("test_pull_ack_selection")
    # Simulasi batch READY: 1 supplier ada (created), 1 supplier TIDAK ada
    # (supplier_not_found). ACK harus HANYA utk yang tersimpan permanen.
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db, sid="a3f9c1e2")
    item_ok = _payload()
    item_bad = _payload(idempotency_key="b2a7f004", bank_transaction_id="b2a7f004",
                        supplier_id="tidak-ada")
    data = [item_ok, item_bad]
    results = [await R.ingest_transaction(db, it) for it in data]
    ack_ids = R.pick_ack_ids(data, results)
    ok(ack_ids == ["7e94dd12-e63d-44d0-a840-3c93adcb89b3"],
       "hanya transaksi tersimpan yang di-ACK; supplier_not_found TIDAK di-ACK")
    # supplier_not_found tetap retryable: muncul lagi di READY berikutnya →
    await _seed_supplier(db, sid="tidak-ada")
    r2 = await R.ingest_transaction(db, item_bad)
    ok(r2["status"] == "created", "yang tadi supplier_not_found, setelah master ada → created")
    # partial ACK: already_processed juga boleh di-ACK (idempoten)
    results2 = [await R.ingest_transaction(db, it) for it in data]
    ack2 = R.pick_ack_ids(data, results2)
    ok(set(ack2) == {"7e94dd12-e63d-44d0-a840-3c93adcb89b3", "b2a7f004"},
       "ACK ulang: created+already_processed dua-duanya ikut (aman, idempoten)")


async def test_preview_readonly():
    print("test_preview_readonly")
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db, sid="a3f9c1e2")
    # snapshot keadaan sebelum preview
    sup_before = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    imports_before = len(db["bank_payment_imports"].docs)

    pv = await R.preview_item(db, _payload())
    # field aman tampil, token TIDAK ada
    for f in ("bank_transaction_id", "supplier_id", "supplier_name", "source_entity",
              "tanggal", "nominal", "beneficiary_name_raw", "deskripsi_bank", "alokasi"):
        ok(f in pv, f"preview menampilkan {f}")
    ok("FELIS_TOKEN" not in str(pv) and "Bearer" not in str(pv), "preview tak membocorkan token/credential")
    ok(pv["would_status"] == "would_create", "supplier ada + valid → would_create")
    ok(pv["supplier_found"] is True and pv["supplier_nama_master"] == "MARTHEN RUTURAMBE",
       "preview tunjukkan nama master utk verifikasi")

    # BUKTI READ-ONLY: tidak ada tulisan ke DB
    sup_after = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    ok(sup_after.get("rekon_payments", []) == sup_before.get("rekon_payments", []) == [],
       "preview TIDAK menyimpan pembayaran")
    ok(len(db["bank_payment_imports"].docs) == imports_before == 0,
       "preview TIDAK membuat import record (tidak lock, tidak ACK)")

    # alokasi [] → tetap would_create (Unallocated)
    pv2 = await R.preview_item(db, _payload(alokasi=[]))
    ok(pv2["alokasi"] == [] and pv2["would_status"] == "would_create", "alokasi [] → would_create (Unallocated)")

    # supplier tak ada → would supplier_not_found (tanpa efek samping)
    pv3 = await R.preview_item(db, _payload(supplier_id="zzzz9999"))
    ok(pv3["would_status"] == "supplier_not_found" and pv3["supplier_found"] is False,
       "supplier tak ada → would supplier_not_found")
    none = await db.supplier_profiles.find_one({"id": "zzzz9999"})
    ok(none is None, "preview supplier_not_found TIDAK membuat supplier baru")

    # sudah processed → would already_processed
    await R.ingest_transaction(db, _payload())
    pv4 = await R.preview_item(db, _payload())
    ok(pv4["would_status"] == "already_processed", "yang sudah tersimpan → would already_processed")


async def test_waterfall_auto_alloc():
    print("test_waterfall_auto_alloc")
    # Pas: 700rb ke 2 PO @350rb → dua-duanya penuh.
    a = R.waterfall_allocations([("job1", 350000), ("job2", 350000)], 700000)
    ok(a == [{"job_id": "job1", "amount": 350000}, {"job_id": "job2", "amount": 350000}],
       "700rb → 2 PO @350rb: dua-duanya lunas (auto)")
    # Kurang: 500rb → job1 penuh (350rb), job2 sebagian (150rb).
    b = R.waterfall_allocations([("job1", 350000), ("job2", 350000)], 500000)
    ok(b == [{"job_id": "job1", "amount": 350000}, {"job_id": "job2", "amount": 150000}],
       "500rb → job1 lunas, job2 sebagian 150rb")
    # Lebih: 900rb → 2 PO penuh (700rb), sisa 200rb TIDAK dipaksa (tetap unallocated).
    c = R.waterfall_allocations([("job1", 350000), ("job2", 350000)], 900000)
    ok(sum(x["amount"] for x in c) == 700000, "900rb → alokasi max 700rb, sisa 200rb unallocated")
    # Job yg sudah lunas (sisa 0) dilewati.
    d = R.waterfall_allocations([("job1", 0), ("job2", 350000)], 350000)
    ok(d == [{"job_id": "job2", "amount": 350000}], "job sisa 0 dilewati, alokasi ke job2")
    # Tidak ada tagihan → tidak ada alokasi (uang tetap unallocated).
    e = R.waterfall_allocations([], 700000)
    ok(e == [], "tidak ada tagihan → alokasi kosong (tetap Belum Dialokasikan)")


async def test_dedup_suggest():
    """suggest_similar: dipakai dedup Supplier & Pelanggan (cegah master dobel)."""
    print("test_dedup_suggest")
    rows = [
        {"id": "a1", "nama": "PT ABC", "no_hp": "0811"},
        {"id": "a2", "nama": "CV Maju Jaya", "no_hp": ""},
        {"id": "a4", "nama": "PT Lama", "no_hp": "", "status": "merged"},
    ]
    for q in ("PT. ABC", "abc pt", "ABC", "  pt   abc "):
        c = suggest_similar(q, "", rows)
        ok(any(x["supplier_id"] == "a1" and x["confidence"] == "high" for x in c), f"'{q}' → mirip PT ABC (high)")
    ok(any(x["supplier_id"] == "a1" and x["confidence"] == "high" for x in suggest_similar("Toko X", "0811", rows)), "HP sama → high")
    ok(any(x["supplier_id"] == "a2" for x in suggest_similar("Maju", "", rows)), "'Maju' ⊂ 'CV Maju Jaya'")
    ok(suggest_similar("Sumber Rezeki", "", rows) == [], "nama beda total → tidak ada")
    ok(all(x["supplier_id"] != "a4" for x in suggest_similar("PT Lama", "", rows)), "merged dilewati")


async def main():
    for t in (test_ingest_basic, test_idempotent, test_idempotency_key_only,
              test_supplier_not_found, test_entity_validation, test_reverse,
              test_allocate, test_koreksi, test_pull_ack_selection,
              test_preview_readonly, test_waterfall_auto_alloc, test_dedup_suggest,
              test_felis_adapter):
        await t()
    print(f"\nSEMUA LULUS — {PASS} assertions.")


if __name__ == "__main__":
    asyncio.run(main())
