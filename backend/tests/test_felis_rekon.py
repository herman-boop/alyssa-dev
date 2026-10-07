#!/usr/bin/env python3
"""
test_felis_rekon.py — Uji integrasi PEMBAYARAN SUPPLIER Felis → alyssa-dev.

Fokus: rekon_sync (ingest idempoten, supplier_not_found aman, pemisahan entitas,
Unallocated Payment, alokasi audit-only, reverse, koreksi) + rekon_felis_client
(adapter READY/ACK/KOREKSI/AKUI: URL, Bearer, parsing, 401/400).

Tanpa MongoDB sungguhan: pakai Fake async DB in-memory. Tanpa jaringan: `requests`
dipalsukan. Jalankan: python3 backend/tests/test_felis_rekon.py
"""
import os, sys, asyncio, types, re

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/
import rekon_sync as R
from supplier_dedup import suggest_similar
import ledger_status as LS
import pnl as PNL
import ais as AIS
import invoice_payments as IP
import expenses as EXP


# ── Fake async Mongo (cukup untuk yang dipakai rekon_sync) ───────────────────
class DupKey(Exception):
    pass


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *a, **k):
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d
        return gen()


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
        for k, v in (filt or {}).items():
            if isinstance(v, dict):
                if "$exists" in v:
                    if "." in k:
                        top, sub = k.split(".", 1)
                        arr = d.get(top)
                        present = isinstance(arr, list) and any(
                            isinstance(x, dict) and x.get(sub) not in (None, "") for x in arr)
                    else:
                        present = (k in d and d.get(k) is not None)
                    if bool(v["$exists"]) != present:
                        return False
                if "$ne" in v and d.get(k) == v["$ne"]:
                    return False
            else:
                if d.get(k) != v:
                    return False
        return True

    def find(self, filt=None, proj=None):
        out = []
        for d in self.docs:
            if self._match(d, filt or {}):
                r = dict(d); r.pop("_id", None); out.append(r)
        return FakeCursor(out)

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


async def test_expenses_helpers():
    """Biaya/Beban (Fase 3): helper murni — validasi entity PT/CV, nominal, tanggal,
    filter. Memastikan Biaya terpisah & entity wajib jelas."""
    print("test_expenses_helpers")
    ok(EXP._norm_entity("pt-alyssa") == "pt-alyssa", "entity PT valid")
    ok(EXP._norm_entity("cv-alyssa-trans") == "cv-alyssa-trans", "entity CV valid")
    ok(EXP._norm_entity("ngawur") == "", "entity tak dikenal → ditolak (kosong)")
    ok(EXP._norm_entity("") == "", "entity kosong → ditolak")
    ok(EXP._to_int("150000") == 150000 and EXP._to_int("x") == 0, "nominal parse aman")
    ok(EXP._valid_date("2026-10-04") == "2026-10-04", "tanggal valid dipakai")
    ok(re.match(r"^\d{4}-\d{2}-\d{2}$", EXP._valid_date("ngawur")), "tanggal ngawur → hari ini (format benar)")
    # filter: void tidak ikut default; entity & periode tersaring
    f = EXP._build_filter(entity_id="pt-alyssa", date_from="2026-01-01", date_to="2026-12-31", kategori="Listrik", status="active")
    ok(f["status"] == "active" and f["entity_id"] == "pt-alyssa" and f["kategori"] == "Listrik", "filter entity/status/kategori")
    ok(f["tanggal"]["$gte"] == "2026-01-01" and f["tanggal"]["$lte"] == "2026-12-31", "filter periode")
    ok("status" not in EXP._build_filter(status="all"), "status=all → tidak difilter (lihat semua)")


async def test_rekon_to_biaya():
    """Rekon → Biaya/Beban: entity map (PT/CV), guard anti double-post,
    nominal dari bank, reversible void → Unallocated."""
    print("test_rekon_to_biaya")
    ok(R.doc_entity_for("PT_ALYSSA_AUTO_LOGISTIK") == "pt-alyssa", "PT → pt-alyssa")
    ok(R.doc_entity_for("CV_ALYSSA_TRANS_UTAMA") == "cv-alyssa-trans", "CV → cv-alyssa-trans")
    ok(R.doc_entity_for("ngawur") == "", "entity tak dikenal → kosong (ditolak)")
    ok(R.can_post_as_expense({"status": "supplier_not_found"})[0], "supplier_not_found → boleh Biaya")
    ok(not R.can_post_as_expense({"status": "processed"})[0], "processed (supplier) → tolak")
    ok(not R.can_post_as_expense({"status": "reversed"})[0], "reversed → tolak")
    ok(not R.can_post_as_expense({"status": "posted_expense", "expense_id": "x"})[0], "sudah Biaya → tolak (anti dobel)")
    ok(not R.can_post_as_expense(None)[0], "tidak ada → tolak")
    ok(R.import_amount({"nominal": 750000}) == 750000, "nominal dari import")
    ok(R.import_amount({"raw_payload": {"nominal": 400000}}) == 400000, "fallback raw_payload.nominal")
    # Integrasi (fake DB): transaksi tanpa supplier → supplier_not_found → Biaya → anti double-post
    db = FakeDB(); await R.ensure_indexes(db)
    btid = "bt-biaya-1"
    r = await R.ingest_transaction(db, _payload(bank_transaction_id=btid, idempotency_key=btid, supplier_id="", supplier_name=""))
    ok(r["status"] == "supplier_not_found", "tanpa supplier → supplier_not_found (kandidat Biaya)")
    imp = await db[R.IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid})
    ok(R.can_post_as_expense(imp)[0] and R.import_amount(imp) == 5000000, "import layak Biaya, nominal 5jt dari bank")
    await R.mark_import_as_expense(db, btid, "exp-1")
    imp2 = await db[R.IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid})
    ok(imp2["status"] == "posted_expense" and imp2["expense_id"] == "exp-1", "import CONSUMED sbg Biaya")
    ok(not R.can_post_as_expense(imp2)[0], "tidak bisa diposting Biaya 2x")
    await _seed_supplier(db)
    r2 = await R.ingest_transaction(db, _payload(bank_transaction_id=btid, idempotency_key=btid))
    ok(r2["status"] == "already_processed", "re-ingest transaksi Biaya → already_processed (bukan supplier)")
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    ok(len(sup.get("rekon_payments") or []) == 0, "anti double-post: TIDAK ada pembayaran supplier dibuat")
    await R.unmark_import_expense(db, btid)
    imp3 = await db[R.IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid})
    ok(imp3["status"] == "supplier_not_found" and not imp3.get("expense_id"), "void expense → transaksi balik Unallocated")
    ok(R.can_post_as_expense(imp3)[0], "setelah balik Unallocated → bisa dirute ulang")


async def test_tagihan_status_and_routing():
    """Fase 5: status tagihan dari ledger (Belum/Sebagian/Lunas) + klasifikasi routing."""
    print("test_tagihan_status_and_routing")
    # status murni (dpp, net_transfer, terbayar)
    ok(LS.tagihan_status(0, 0, 0) == "draft", "dpp 0 → draft")
    ok(LS.tagihan_status(5000000, 5000000, 0) == "belum", "terbayar 0 → Belum Dibayar")
    ok(LS.tagihan_status(5000000, 5000000, 2000000) == "sebagian", "bayar 2jt dari 5jt → Sebagian")
    ok(LS.tagihan_status(5000000, 5000000, 5000000) == "lunas", "bayar penuh → Lunas")
    ok(LS.tagihan_status(5000000, 5000000, 6000000) == "lunas", "lebih bayar → tetap Lunas")
    ok(LS.status_label("belum") == "Belum Dibayar" and LS.status_label("lunas") == "Lunas", "label ramah-pengguna")
    # Rekon alokasi MENGGERAKKAN status: terbayar = alokasi rekon (extra_paid)
    ok(LS.tagihan_status(5000000, 5000000, 3000000) == "sebagian", "alokasi rekon 3jt → Sebagian (otomatis)")
    # routing bucket
    ok(R.routing_bucket({"status": "processed"}) == "supplier", "processed → Supplier")
    ok(R.routing_bucket({"status": "posted_expense"}) == "biaya", "posted_expense → Biaya")
    ok(R.routing_bucket({"status": "supplier_not_found"}) == "unallocated", "supplier_not_found → Unallocated")
    ok(R.routing_bucket({"status": "error"}) == "unallocated", "error → Unallocated")
    ok(R.routing_bucket({"status": "reversed"}) == "reversed", "reversed → Reversed")
    # Integrasi: ingest → allocate → status mengikuti alokasi
    db = FakeDB(); await R.ensure_indexes(db)
    await _seed_supplier(db, jobs=[{"id": "jX", "total_harga": 5000000, "payments": []}])
    r = await R.ingest_transaction(db, _payload(nominal=5000000))
    pid = r["rekon_payment_id"]
    await R.allocate_payment(db, "a3f9c1e2", pid, [{"job_id": "jX", "amount": 2000000}])
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    alloc = sum(a["amount"] for p in sup["rekon_payments"] for a in (p.get("allocations") or []) if a["job_id"] == "jX")
    ok(alloc == 2000000 and LS.tagihan_status(5000000, 5000000, alloc) == "sebagian", "alokasi 2jt → job Sebagian Dibayar")
    await R.allocate_payment(db, "a3f9c1e2", pid, [{"job_id": "jX", "amount": 5000000}])
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    alloc2 = sum(a["amount"] for p in sup["rekon_payments"] for a in (p.get("allocations") or []) if a["job_id"] == "jX")
    ok(alloc2 == 5000000 and LS.tagihan_status(5000000, 5000000, alloc2) == "lunas", "alokasi penuh → job Lunas")


async def test_pnl():
    """Fase 6: Laba Rugi — filter periode/entitas + rumus Pendapatan−HPP−Biaya."""
    print("test_pnl")
    V = ("pt-alyssa", "cv-alyssa-trans")
    # periode
    ok(PNL.in_period("2026-06-15", "2026-01-01", "2026-12-31"), "dalam periode")
    ok(not PNL.in_period("2025-12-31", "2026-01-01", "2026-12-31"), "sebelum periode → keluar")
    ok(not PNL.in_period("2027-01-01", "2026-01-01", "2026-12-31"), "sesudah periode → keluar")
    ok(PNL.in_period("2026-06-15T10:00:00", "2026-06-01", "2026-06-30"), "ISO datetime diperlakukan by-date")
    ok(PNL.in_period("ngawur", None, None), "tanpa filter → tanggal invalid tetap ikut")
    ok(not PNL.in_period("ngawur", "2026-01-01", None), "ada filter → tanggal invalid dikecualikan")
    # entity
    ok(PNL.entity_key("pt-alyssa", V) == "pt-alyssa" and PNL.entity_key("", V) == "none", "entity_key normal/none")
    ok(PNL.entity_match("pt-alyssa", "", V), "want kosong → semua lolos")
    ok(PNL.entity_match("", "none", V) and not PNL.entity_match("pt-alyssa", "none", V), "filter 'none' = belum diisi")
    ok(PNL.entity_match("cv-alyssa-trans", "cv-alyssa-trans", V) and not PNL.entity_match("pt-alyssa", "cv-alyssa-trans", V), "filter entitas spesifik")
    # rumus
    r = PNL.compute_pnl({
        "pt-alyssa": {"pendapatan": 10000000, "hpp": 6000000, "biaya": 1500000},
        "cv-alyssa-trans": {"pendapatan": 4000000, "hpp": 3000000, "biaya": 200000},
    })
    pt = r["per_entity"]["pt-alyssa"]
    ok(pt["laba_kotor"] == 4000000, "PT Laba Kotor = 10jt − 6jt = 4jt")
    ok(pt["laba_bersih"] == 2500000, "PT Laba Bersih = 4jt − 1.5jt = 2.5jt")
    gt = r["grand_total"]
    ok(gt["pendapatan"] == 14000000 and gt["hpp"] == 9000000, "grand pendapatan/HPP dijumlah")
    ok(gt["laba_kotor"] == 5000000 and gt["laba_bersih"] == 3300000, "grand Laba Kotor 5jt, Bersih 3.3jt")
    neg = PNL.compute_pnl({"pt-alyssa": {"pendapatan": 1000000, "hpp": 1500000, "biaya": 100000}})
    ok(neg["grand_total"]["laba_bersih"] == -600000, "rugi → laba_bersih negatif (-600rb)")


async def test_ais_trace():
    """Patch G-1: trace per kapal (Route Leg → watchlist → cache → provider)."""
    print("test_ais_trace")
    # _summarize_probe (pure) — tanpa key, ringkas status + ada/tidak posisi
    pr = {"mmsi": {"id": "525701831", "status": 404, "body": {"_text": "not found"}},
          "imo": {"id": "1071056", "status": 200, "body": {"vesselPosition": {"latitude": 1.2, "longitude": 120.0}}}}
    s = AIS._summarize_probe(pr)
    ok(any(x["idtype"] == "mmsi" and x["status"] == 404 and not x["has_position"] for x in s), "probe MMSI 404 → kosong")
    ok(any(x["idtype"] == "imo" and x["status"] == 200 and x["has_position"] for x in s), "probe IMO 200 → ada posisi")
    # trace via fake DB (tanpa VesselAPI key → tidak probe)
    db = FakeDB()
    await db.trips.insert_one({"trip_id": "T1", "order_id": "O1", "legs": [
        {"route_leg_id": "l1", "tipe": "Self Drive", "status": "Berlangsung"},
        {"route_leg_id": "l2", "tipe": "Kapal RoRo", "kapal": "FAJAR BAHARI VIII", "mmsi": "525701831", "imo": "1071056", "status": "Berlangsung"},
        {"route_leg_id": "l3", "tipe": "Self Drive", "status": "Menunggu"},
    ]})
    await db.trips.insert_one({"trip_id": "T2", "legs": [
        {"route_leg_id": "m1", "tipe": "Kapal RoRo", "kapal": "KALIMANTAN ECO", "mmsi": "525015993", "status": "Selesai"},
    ]})
    await db.ais_positions.insert_one({"mmsi": "525015993", "ship_name": "KALIMANTAN ECO",
                                       "latitude": 1.0, "longitude": 118.0, "position_timestamp": "2026-10-06T00:00:00+00:00"})
    res = await AIS.trace(db, probe_missing=False)
    ships = {x["mmsi"]: x for x in res["ships"]}
    ok("525701831" in ships and "525015993" in ships, "dua kapal ter-trace dari Route Leg")
    fb = ships["525701831"]
    ok(fb["kapal"] == "FAJAR BAHARI VIII" and fb["imo"] == "1071056", "identitas dari leg (nama + IMO)")
    ok(fb["watched"] is True, "FAJAR BAHARI dipantau (leg punya MMSI)")
    ok(fb["cache_has_position"] is False, "FAJAR BAHARI belum ada posisi di cache")
    ok(ships["525015993"]["cache_has_position"] is True, "KALIMANTAN ECO ada posisi cache")
    ok(res["ship_count"] == 2 and res["probed"] == 0, "probe dilewati saat probe_missing=False")
    ok(res["watched_count"] == 2, "watchlist = 2 MMSI dari leg")


async def test_vesselapi_terrestrial_fallback():
    """Fallback terestrial: kalau query SATELIT kosong (mis. kapal lagi SANDAR di
    pelabuhan, posisi cuma ada di jaringan AIS darat), otomatis coba lagi TANPA
    filter.sat — posisi terestrial tetap ke-cache. Kalau satelit sudah ada posisi,
    terestrial TIDAK dipanggil (hemat kuota)."""
    print("test_vesselapi_terrestrial_fallback")

    class _Resp:
        def __init__(self, status, body=None, headers=None):
            self.status_code = status
            self._body = body or {}
            self.headers = headers or {}
        def json(self):
            return self._body

    calls = []

    def fake_get(path, params, timeout=15):
        calls.append((path, dict(params)))
        if path.endswith("/eta"):
            return _Resp(404)
        if params.get("filter.sat") == "true":
            return _Resp(404)   # satelit tak punya posisi kapal sandar
        return _Resp(200, {"vesselPosition": {
            "mmsi": "525701831", "imo": "1071056", "vessel_name": "FAJAR BAHARI VIII",
            "latitude": -6.02, "longitude": 106.92, "sog": 0.0}}, headers={})

    orig = (AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get)
    AIS.vesselapi_enabled = lambda: True
    AIS._vesselapi_use_sat = lambda: True
    AIS._vesselapi_get = fake_get
    AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()
    try:
        db = FakeDB()
        doc = await AIS._vesselapi_refresh(db, "525701831", "1071056")
        ok(doc is not None, "fallback: dapet posisi walau satelit kosong")
        ok(abs(doc["latitude"] + 6.02) < 1e-6 and abs(doc["longitude"] - 106.92) < 1e-6, "posisi dari query terestrial")
        ok(doc["source"] == "vesselapi", "source = vesselapi (terestrial), bukan satelit")
        pos_calls = [c for c in calls if c[0].endswith("/position")]
        ok(len(pos_calls) == 2, "dua percobaan query posisi (satelit → terestrial)")
        ok(pos_calls[0][1].get("filter.sat") == "true", "percobaan 1 = satelit")
        ok("filter.sat" not in pos_calls[1][1], "percobaan 2 = terestrial (tanpa filter.sat)")
        cached = await db.ais_positions.find_one({"mmsi": "525701831"})
        ok(cached is not None and cached.get("latitude") is not None, "posisi tersimpan di cache")

        # Satelit SUDAH ada posisi → terestrial tak perlu dipanggil.
        calls.clear(); AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()
        def fake_sat_ok(path, params, timeout=15):
            calls.append((path, dict(params)))
            if path.endswith("/eta"):
                return _Resp(404)
            return _Resp(200, {"vesselPosition": {"mmsi": "525005194", "latitude": 1.0, "longitude": 118.0}},
                         headers={"X-Data-Source": "satellite"})
        AIS._vesselapi_get = fake_sat_ok
        db2 = FakeDB()
        doc2 = await AIS._vesselapi_refresh(db2, "525005194", None)
        ok(doc2 is not None and doc2["source"] == "vesselapi-satellite", "satelit ada → source satelit")
        pos_calls2 = [c for c in calls if c[0].endswith("/position")]
        ok(len(pos_calls2) == 1, "satelit ada → tidak fallback (1 query posisi saja)")
    finally:
        AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get = orig
        AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()


async def test_vesselfinder_refresh():
    """Adapter VesselFinder: parse respons /vessels, simpan posisi ke cache,
    normalisasi timestamp, deteksi sumber terrestrial vs satelit, dormant tanpa key."""
    print("test_vesselfinder_refresh")

    # _vf_ts: normalisasi 'YYYY-MM-DD HH:MM:SS UTC' -> ISO
    ok(AIS._vf_ts("2026-10-06 13:40:00 UTC").startswith("2026-10-06T13:40:00"), "_vf_ts normalisasi UTC -> ISO")
    ok(AIS._vf_ts(None) is None, "_vf_ts kosong -> None")

    class _Resp:
        def __init__(self, status, body=None, headers=None):
            self.status_code = status; self._body = body; self.headers = headers or {}
        def json(self): return self._body

    # Dormant tanpa key
    saved = (AIS.vesselfinder_enabled, AIS._vesselfinder_use_sat, AIS._vesselfinder_get)
    AIS.vesselfinder_enabled = lambda: False
    try:
        ok(await AIS._vesselfinder_refresh(FakeDB(), "525701831", "1071056") is None, "tanpa key → dormant (None)")
    finally:
        AIS.vesselfinder_enabled = saved[0]

    calls = []
    def fake_get(params, timeout=15):
        calls.append(dict(params))
        return _Resp(200, [{"AIS": {
            "MMSI": 525701831, "IMO": 1071056, "NAME": "FAJAR BAHARI VIII",
            "LATITUDE": -6.05, "LONGITUDE": 106.92, "SPEED": 0.0, "COURSE": 180.0,
            "HEADING": 179, "NAVSTAT": 5, "DESTINATION": "JAKARTA",
            "ETA": "2026-10-06 10:50", "DRAUGHT": 3.6, "SRC": "TER",
            "TIMESTAMP": "2026-10-06 13:40:00 UTC"}}], headers={"X-RateLimit-Remaining": "9999"})

    AIS.vesselfinder_enabled = lambda: True
    AIS._vesselfinder_use_sat = lambda: False
    AIS._vesselfinder_get = fake_get
    AIS._last_pos_fetch.clear()
    try:
        db = FakeDB()
        doc = await AIS._vesselfinder_refresh(db, "525701831", "1071056")
        ok(doc is not None, "VesselFinder: dapet posisi")
        ok(abs(doc["latitude"] + 6.05) < 1e-6 and abs(doc["longitude"] - 106.92) < 1e-6, "lat/lon benar")
        ok(doc["source"] == "vesselfinder", "SRC TER → source vesselfinder (terrestrial)")
        ok(doc["ship_name"] == "FAJAR BAHARI VIII" and doc["imo"] == "1071056", "nama + IMO ke-parse")
        ok(doc["nav_status"] == 5 and doc["destination"] == "JAKARTA", "nav_status + tujuan ke-parse")
        ok(str(doc["position_timestamp"]).startswith("2026-10-06T13:40:00"), "timestamp ternormalisasi")
        ok(calls and calls[0].get("mmsi") == "525701831" and "sat" not in calls[0], "query pakai mmsi, sat OFF (hemat kredit)")
        cached = await db.ais_positions.find_one({"mmsi": "525701831"})
        ok(cached is not None and cached.get("latitude") is not None, "posisi tersimpan di cache")

        # Throttle: panggil kedua langsung → None (hemat kredit)
        doc2 = await AIS._vesselfinder_refresh(db, "525701831", "1071056")
        ok(doc2 is None and len(calls) == 1, "throttle: tak query lagi dalam interval")

        # SRC SAT → source satelit; sat=1 saat USE_SAT on
        AIS._vesselfinder_use_sat = lambda: True
        AIS._last_pos_fetch.clear(); calls.clear()
        def fake_sat(params, timeout=15):
            calls.append(dict(params))
            return _Resp(200, [{"AIS": {"MMSI": 525005194, "LATITUDE": 1.0, "LONGITUDE": 118.0, "SRC": "SAT", "TIMESTAMP": "2026-10-06 13:00:00 UTC"}}], headers={})
        AIS._vesselfinder_get = fake_sat
        d3 = await AIS._vesselfinder_refresh(FakeDB(), "525005194", None)
        ok(d3 is not None and d3["source"] == "vesselfinder-satellite", "SRC SAT → source satelit")
        ok(calls and calls[0].get("sat") == "1", "USE_SAT on → sat=1")
    finally:
        AIS.vesselfinder_enabled, AIS._vesselfinder_use_sat, AIS._vesselfinder_get = saved
        AIS._last_pos_fetch.clear()


async def test_smart_allocation_and_restore():
    """Pembagian pintar Rekon: nominal pas ke FAKTUR (projek) / unit; ambigu & tak ada
    yang pas → berurutan; + pulihkan rekon yang sudah di-Reverse."""
    print("test_smart_allocation_and_restore")
    # Skenario MARTHEN: 5 faktur (19 unit) yang di PDF + faktur lain yang juga belum lunas.
    jobs = []
    def add(pid, n, each):
        for i in range(n):
            jobs.append((f"{pid}-{i}", each, pid))
    add("A", 15, 0); jobs.clear()
    # A (BACHT SULAWESI): 15 unit total 47.650.000; B 250k; C 2.5jt; D 3.7jt; E 3.4jt
    A = [7500000, 2400000, 2500000, 3000000, 7500000, 2500000, 4500000, 2400000, 250000, 2700000, 1500000, 3000000, 1000000, 3200000, 3700000]
    ok(sum(A) == 47650000, "data uji: faktur A = 47.650.000")
    for i, v in enumerate(A): jobs.append((f"A{i}", v, "PA"))
    jobs += [("B0", 250000, "PB"), ("C0", 2500000, "PC"), ("D0", 3700000, "PD"), ("E0", 3400000, "PE")]
    # faktur LAIN (di atas urutan?) — dipasang SEBELUM agar waterfall lama salah sasaran
    other = [("X%d" % i, 2650000, "PX") for i in range(25)]   # 66.250.000 di faktur lain
    allj = other + jobs
    s = R.smart_allocations(allj, 57500000)
    ids = {a["job_id"] for a in s["allocations"]}
    ok(s["method"] == "faktur_pas" and len(s["allocations"]) == 19 and not any(i.startswith("X") for i in ids), "57,5jt = 5 faktur pas → tepat 19 unit (bukan faktur lain)")
    ok(sum(a["amount"] for a in s["allocations"]) == 57500000, "total teralokasi = 57.500.000")
    # waterfall lama akan salah sasaran (membayar faktur X dulu)
    old = R.waterfall_allocations([(j, v) for j, v, _ in allj], 57500000)
    ok(old[0]["job_id"].startswith("X"), "(pembanding) waterfall lama memang membayar faktur lain dulu")
    s = R.smart_allocations(allj, 47650000)
    ok(s["method"] == "faktur_pas" and len(s["allocations"]) == 15 and all(a["job_id"].startswith("A") for a in s["allocations"]), "47,65jt = faktur A saja (15 unit)")
    # unit tunggal pas
    s = R.smart_allocations([("u1", 1111111, "P1"), ("u2", 2222222, "P1"), ("u3", 5000000, "P2")], 2222222)
    ok(s["method"] == "unit_pas" and s["allocations"] == [{"job_id": "u2", "amount": 2222222}], "nominal = sisa 1 unit → unit itu")
    # tidak ada yang pas → berurutan (perilaku lama)
    s = R.smart_allocations([("u1", 1000000, "P1"), ("u2", 2000000, "P2")], 1500000)
    ok(s["method"] == "berurutan" and s["allocations"] == [{"job_id": "u1", "amount": 1000000}, {"job_id": "u2", "amount": 500000}], "tak ada yang pas → berurutan")
    # ambigu (2 faktur sama-sama 1jt) → jangan menebak
    s = R.smart_allocations([("a", 1000000, "P1"), ("b", 1000000, "P2")], 1000000)
    ok(s["method"] == "berurutan" and "ambigu" in s["note"], "2 faktur sama nominal → ambigu, jatuh ke berurutan + catatan")
    # nominal > total sisa → sisa tetap belum teralokasi
    s = R.smart_allocations([("a", 1000000, "P1")], 1500000)
    ok(s["method"] == "faktur_pas" or s["allocations"] == [{"job_id": "a", "amount": 1000000}], "tidak pernah melebihi sisa unit")
    s = R.smart_allocations([("a", 1000000, "P1"), ("b", 500000, "P2")], 2000000)
    ok(sum(x["amount"] for x in s["allocations"]) == 1500000 and "belum teralokasi" in s["note"], "nominal > total sisa → sisa dicatat belum teralokasi")
    ok(R.smart_allocations([], 100)["method"] == "kosong" and R.smart_allocations([("a", 5, "P")], 0)["method"] == "kosong", "kosong / nominal 0 aman")
    ok(R.smart_allocations([("a", 0, "P"), ("b", -5, "P")], 100)["allocations"] == [], "unit lunas / sisa negatif diabaikan")

    # ── Pulihkan rekon yang sudah di-Reverse ──
    jobs_db = [{"id": "job1"}, {"id": "job2"}]
    db = FakeDB(); await R.ensure_indexes(db); await _seed_supplier(db, jobs=jobs_db)
    r = await R.ingest_transaction(db, _payload())
    await R.allocate_payment(db, "a3f9c1e2", r["rekon_payment_id"], [{"job_id": "job1", "amount": 2000000}])
    btid = _payload()["bank_transaction_id"]
    ok((await R.restore_import(db, btid))["status"] == "not_reversed", "belum di-reverse → tidak bisa dipulihkan")
    await R.reverse_import(db, btid, reason="salah")
    rs = await R.restore_import(db, btid)
    ok(rs["status"] == "restored" and rs["amount"] == 5000000, "reverse → pulihkan: status restored")
    sup = await db.supplier_profiles.find_one({"id": "a3f9c1e2"})
    p = sup["rekon_payments"][0]
    ok(p["status"] == "active" and p["allocations"] == [] and p.get("restored_at"), "pembayaran aktif lagi, alokasi lama DIKOSONGKAN")
    imp = await db[R.IMPORTS_COLLECTION].find_one({"bank_transaction_id": btid})
    ok(imp["status"] == "processed" and imp.get("restored_at") and imp.get("reversed_at"), "import processed lagi, jejak reverse tetap ada")
    ok((await R.restore_import(db, btid))["status"] == "not_reversed", "pulihkan 2x → ditolak (tidak dobel)")
    ok((await R.restore_import(db, "tidak-ada"))["status"] == "not_found", "btid tak dikenal → not_found")
    # sesudah dipulihkan bisa dialokasikan ulang
    again = await R.allocate_payment(db, "a3f9c1e2", p["id"], [{"job_id": "job2", "amount": 5000000}])
    ok(again.get("ok") and again["allocated"] == 5000000, "setelah dipulihkan bisa dialokasikan ulang")


async def test_vendor_pin_embedded():
    """Penjaga PIN 'Catat Bayar Vendor': dari dalam dashboard admin (header X-Admin-Embedded)
    TIDAK minta PIN saat admin mode terbuka; halaman vendor mandiri tetap wajib PIN;
    saat admin dikunci PIN kembali wajib. Memakai kode ASLI server.py (diambil via AST)."""
    print("test_vendor_pin_embedded")
    import ast
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    want = {"_admin_locked", "_admin_is_open", "require_vendor_pin"}
    code = "\n".join(ast.get_source_segment(src, n) for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name in want)

    class _HTTPException(Exception):
        def __init__(self, status_code, detail=""): self.status_code = status_code; self.detail = detail
    ns = {"os": os, "Optional": __import__("typing").Optional, "Header": lambda **k: None, "HTTPException": _HTTPException}
    exec(code, ns)
    rv = ns["require_vendor_pin"]

    def call(pin=None, emb=None):
        try:
            return rv(x_admin_pin=pin, x_admin_embedded=emb) is True
        except _HTTPException as e:
            return e.status_code

    saved = {k: os.environ.get(k) for k in ("ADMIN_LOCK", "ADMIN_PIN", "VENDOR_PIN")}
    try:
        # Admin TERBUKA (ADMIN_LOCK mati) + PIN terpasang untuk halaman vendor
        os.environ.pop("ADMIN_LOCK", None); os.environ["ADMIN_PIN"] = "1234"; os.environ["VENDOR_PIN"] = "9999"
        ok(call("", "1") is True, "terbuka + dari dashboard admin: tanpa PIN diterima")
        ok(call(None, "1") is True, "terbuka + dashboard: header PIN tidak ada → diterima")
        ok(call("0000", "1") is True, "terbuka + dashboard: PIN lama/salah di browser tidak memblokir")
        ok(call("", None) == 401, "halaman vendor mandiri tanpa PIN → ditolak")
        ok(call("0000", None) == 401, "halaman vendor mandiri PIN salah → ditolak")
        ok(call("1234", None) is True and call("9999", None) is True, "ADMIN_PIN & VENDOR_PIN tetap diterima")
        # Admin DIKUNCI
        os.environ["ADMIN_LOCK"] = "1"
        ok(call("", "1") == 401, "terkunci + dashboard tanpa PIN → ditolak")
        ok(call("0000", "1") == 401, "terkunci + dashboard PIN salah → ditolak")
        ok(call("1234", "1") is True, "terkunci + dashboard + PIN admin benar → diterima")
        ok(call("", None) == 401 and call("9999", None) is True, "terkunci: halaman vendor tetap pakai PIN")
        # ADMIN_LOCK nyala tapi ADMIN_PIN kosong = admin terbuka (sama dgn require_admin_pin)
        os.environ.pop("ADMIN_PIN", None)
        ok(call("", "1") is True, "ADMIN_PIN kosong = admin terbuka → dashboard diterima")
        ok(call("", None) == 401, "...tapi halaman vendor mandiri tetap wajib PIN")
    finally:
        for k, v in saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v


async def test_auto_refresh_cycle():
    """Cek otomatis berkala: kapal 'Berlangsung' tanpa posisi segar dicek SEKALI per
    kapal unik, jeda makin lama kalau kosong, kapal segar dilewati, data basi bukan sukses."""
    print("test_auto_refresh_cycle")
    ok([AIS._auto_backoff_seconds(n) for n in (1, 2, 3, 4, 9)] == [3600, 7200, 14400, 21600, 21600], "jeda: 1j → 2j → 4j → 6j (maks)")

    from datetime import datetime, timezone, timedelta
    class _R:
        def __init__(self, st, body=None): self.status_code = st; self._b = body or {}; self.headers = {}; self.text = ""
        def json(self): return self._b
    calls = []
    mode = {"v": "404"}
    def fake_get(path, params, timeout=15):
        calls.append((path, dict(params)))
        if path.endswith("/eta"):
            return _R(404)
        if mode["v"] == "404":
            return _R(404)
        ts = datetime.now(timezone.utc).isoformat() if mode["v"] == "fresh" else (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
        return _R(200, {"vesselPosition": {"mmsi": "525200343", "latitude": 1.2, "longitude": 127.4, "timestamp": ts, "sog": 0.3}})

    db = FakeDB()
    # Mutiara: 3 trip 'Berlangsung' (kapal sama). KAPAL B: Berlangsung, hanya IMO. Menunggu: diabaikan.
    for tid in ("T1", "T2", "T3"):
        await db.trips.insert_one({"trip_id": tid, "legs": [{"route_leg_id": "l" + tid, "tipe": "Kapal RoRo", "kapal": "MUTIARA", "mmsi": "525200343", "imo": "9425021", "status": "Berlangsung"}]})
    await db.trips.insert_one({"trip_id": "T4", "legs": [{"route_leg_id": "l4", "tipe": "Kapal RoRo", "kapal": "B", "imo": "1234567", "status": "Berlangsung"}]})
    await db.trips.insert_one({"trip_id": "T5", "legs": [{"route_leg_id": "l5", "tipe": "Kapal RoRo", "kapal": "C", "mmsi": "525000009", "status": "Menunggu"}]})
    # Kapal D: Berlangsung tapi posisinya SUDAH segar → dilewati
    await db.trips.insert_one({"trip_id": "T6", "legs": [{"route_leg_id": "l6", "tipe": "Kapal RoRo", "kapal": "D", "mmsi": "525000007", "status": "Berlangsung"}]})
    await db.ais_positions.insert_one({"mmsi": "525000007", "latitude": 1.0, "longitude": 118.0, "position_timestamp": datetime.now(timezone.utc).isoformat()})

    saved = (AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled)
    AIS.vesselapi_enabled = lambda: True
    AIS._vesselapi_use_sat = lambda: False
    AIS.vesselfinder_enabled = lambda: False
    AIS._vesselapi_get = fake_get
    state = {}
    try:
        AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()
        r1 = await AIS.auto_refresh_cycle(db, state, 1000.0)
        ok(r1["candidates"] == 3, "kandidat = 3 kapal unik 'Berlangsung' (Menunggu diabaikan)")
        ok(r1["attempted"] == 2 and r1["skipped_fresh"] == 1, "2 dicek, 1 dilewati karena posisinya sudah segar")
        ok(r1["fail"] == 2 and r1["ok"] == 0, "provider kosong → 2 gagal")
        pos = [x for x in calls if x[0].endswith("/position")]
        ok(len(pos) == 2, "Mutiara dites SEKALI walau 3 trip (+ 1 kapal IMO-saja) = 2 call posisi")
        ok(state["525200343"]["fails"] == 1 and state["525200343"]["next"] == 1000.0 + 3600, "gagal pertama → cek ulang 1 jam lagi")

        calls.clear(); AIS._last_pos_fetch.clear()
        r2 = await AIS.auto_refresh_cycle(db, state, 1000.0 + 600)
        ok(r2["attempted"] == 0 and r2["skipped_backoff"] == 2 and not calls, "10 menit kemudian: masih masa jeda → tidak ada call")

        r3 = await AIS.auto_refresh_cycle(db, state, 1000.0 + 3601)
        ok(r3["attempted"] == 2 and state["525200343"]["fails"] == 2 and state["525200343"]["next"] == 1000.0 + 3601 + 7200, "lewat 1 jam: dicek lagi, gagal kedua → jeda 2 jam")

        # Provider balas posisi BASI (12 jam) → bukan sukses, tetap backoff
        mode["v"] = "stale"; AIS._last_pos_fetch.clear()
        r4 = await AIS.auto_refresh_cycle(db, state, 1000.0 + 3601 + 7300)
        ok(r4["ok"] == 0 and r4["fail"] == 2 and state["525200343"]["fails"] == 3, "posisi basi 12 jam ≠ sukses → jeda makin lama (3 jam…)")

        # Provider akhirnya balas posisi SEGAR → sukses, state dibersihkan, masuk cache
        mode["v"] = "fresh"; AIS._last_pos_fetch.clear()
        r5 = await AIS.auto_refresh_cycle(db, state, 1000.0 + 3601 + 7300 + 15000)
        ok(r5["ok"] >= 1 and "525200343" not in state, "posisi segar → sukses, state bersih")
        cached = await db.ais_positions.find_one({"mmsi": "525200343"})
        ok(cached is not None and cached.get("latitude") == 1.2, "posisi masuk cache (semua unit Mutiara ikut dapat)")

        # Batas per putaran
        state2 = {}
        for i in range(15):
            await db.trips.insert_one({"trip_id": f"X{i}", "legs": [{"route_leg_id": f"x{i}", "tipe": "Kapal RoRo", "kapal": f"K{i}", "imo": f"90000{i:02d}", "status": "Berlangsung"}]})
        mode["v"] = "404"; calls.clear(); AIS._last_pos_fetch.clear()
        r6 = await AIS.auto_refresh_cycle(db, state2, 5.0, max_ships=4)
        ok(r6["attempted"] == 4, "dibatasi max_ships per putaran")
    finally:
        AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled = saved
        AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()


async def test_trace_probe_dedupe_sat():
    """Trace per Kapal: 1 kapal dites SEKALI walau muncul di banyak trip, dan
    ikut tes jalur satelit (sama dgn halaman tracking). Hemat kuota provider."""
    print("test_trace_probe_dedupe_sat")

    class _R:
        def __init__(self, st): self.status_code = st; self.headers = {}; self.text = ""
        def json(self): return {}

    calls = []
    def fake_get(path, params, timeout=15):
        calls.append((path, dict(params)))
        return _R(404)

    db = FakeDB()
    # Mutiara Ferindo: 3 trip (MMSI+IMO sama); Kapal B: hanya IMO; Kapal C: sudah ada posisi di cache.
    for tid in ("T1", "T2", "T3"):
        await db.trips.insert_one({"trip_id": tid, "legs": [{"route_leg_id": "l-" + tid, "tipe": "Kapal RoRo", "kapal": "MUTIARA FERINDO V", "mmsi": "525200343", "imo": "9425021", "status": "Berlangsung"}]})
    await db.trips.insert_one({"trip_id": "T4", "legs": [{"route_leg_id": "l4", "tipe": "Kapal RoRo", "kapal": "KAPAL B", "imo": "1234567", "status": "Berlangsung"}]})
    await db.trips.insert_one({"trip_id": "T5", "legs": [{"route_leg_id": "l5", "tipe": "Kapal RoRo", "kapal": "KAPAL C", "mmsi": "525000001", "status": "Berlangsung"}]})
    await db.ais_positions.insert_one({"mmsi": "525000001", "latitude": 1.0, "longitude": 118.0, "position_timestamp": "2026-10-06T00:00:00+00:00"})

    saved = (AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled)
    AIS.vesselapi_enabled = lambda: True
    AIS._vesselapi_use_sat = lambda: True
    AIS.vesselfinder_enabled = lambda: False
    AIS._vesselapi_get = fake_get
    try:
        res = await AIS.trace(db, probe_missing=True, max_probe=8)
    finally:
        AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled = saved
    pos = [c for c in calls if c[0].endswith("/position")]
    ok(len(pos) == 4, "2 kapal unik x (darat + satelit) = 4 call (bukan per trip)")
    ok(res["probed"] == 2, "probed = jumlah kapal UNIK (2), bukan jumlah trip")
    m_calls = [c for c in pos if "/525200343/" in c[0]]
    ok(len(m_calls) == 2 and all(c[1].get("filter.idType") == "mmsi" for c in m_calls), "Mutiara: hanya ident MMSI yang dites (sama dgn app), 1x per mode")
    ok(sum(1 for c in m_calls if c[1].get("filter.sat") == "true") == 1 and sum(1 for c in m_calls if "filter.sat" not in c[1]) == 1, "Mutiara: 1 call darat + 1 call satelit")
    b_calls = [c for c in pos if "/1234567/" in c[0]]
    ok(len(b_calls) == 2 and all(c[1].get("filter.idType") == "imo" for c in b_calls), "Kapal B (IMO saja): dites via IMO")
    ships = {(x["kapal"], x["trip_id"]): x for x in res["ships"]}
    ok(all(ships[("MUTIARA FERINDO V", t)]["provider"] for t in ("T1", "T2", "T3")), "ketiga trip Mutiara dapat hasil provider")
    ok(sum(1 for t in ("T1", "T2", "T3") if ships[("MUTIARA FERINDO V", t)].get("provider_shared")) == 2, "2 dari 3 baris ditandai 'hasil dipakai bersama'")
    modes = sorted(p["mode"] for p in ships[("MUTIARA FERINDO V", "T1")]["provider"] if p.get("mode"))
    ok(modes == ["darat", "satelit"], "hasil memuat mode darat & satelit")
    ok(ships[("KAPAL C", "T5")]["provider"] is None, "kapal yang sudah ada posisi tidak dites")
    # Mode satelit mati → hanya darat
    calls.clear()
    AIS.vesselapi_enabled = lambda: True; AIS._vesselapi_use_sat = lambda: False
    AIS.vesselfinder_enabled = lambda: False; AIS._vesselapi_get = fake_get
    try:
        await AIS.trace(db, probe_missing=True, max_probe=8)
    finally:
        AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled = saved
    ok(len([c for c in calls if c[0].endswith("/position")]) == 2 and all("filter.sat" not in c[1] for c in calls), "satelit mati: 1 call darat per kapal unik")


async def test_invoice_payments():
    """Pembayaran customer per faktur: validasi, total, sisa & status."""
    print("test_invoice_payments")
    # Skenario nyata: faktur gabungan 5 PO = Rp54.600.000, customer bayar Rp8.500.000.
    p1 = IP.make_payment(8500000, "2026-10-07", "Transfer BCA", "DP awal", today="2026-10-07")
    ok(p1["amount"] == 8500000 and p1["tanggal"] == "2026-10-07", "pembayaran 8,5jt tercatat (nominal+tanggal)")
    ok(p1["metode"] == "Transfer BCA" and p1["catatan"] == "DP awal" and p1["id"].startswith("PAY-"), "metode, catatan, id")
    s = IP.summarize(54600000, [p1])
    ok(s["diterima"] == 8500000 and s["sisa"] == 46100000 and s["status"] == "Sebagian", "sisa 46,1jt, status Sebagian")
    # Cicilan kedua → akumulasi (rincian terpisah, total berkurang)
    p2 = IP.make_payment("46100000", "", "", "", today="2026-10-20")
    ok(p2["tanggal"] == "2026-10-20" and p2["metode"] == "Transfer BCA", "tanggal kosong → today; metode default")
    s2 = IP.summarize(54600000, [p1, p2])
    ok(s2["sisa"] == 0 and s2["status"] == "Lunas" and s2["diterima"] == 54600000, "dua cicilan → Lunas, sisa 0")
    # Belum bayar & lebih bayar
    ok(IP.summarize(1000000, [])["status"] == "Belum Bayar", "tanpa pembayaran → Belum Bayar")
    ok(IP.summarize(1000000, None)["sisa"] == 1000000, "payments None aman")
    sl = IP.summarize(1000000, [IP.make_payment(1500000, today="2026-10-07")])
    ok(sl["status"] == "Lebih Bayar" and sl["sisa"] == -500000, "kelebihan bayar terdeteksi (sisa negatif)")
    # Validasi input
    for bad in (0, -5, "abc", None, 10 ** 14):
        try:
            IP.make_payment(bad, today="2026-10-07"); okk = False
        except ValueError:
            okk = True
        ok(okk, f"nominal tak sah ditolak: {bad!r}")
    pj = IP.make_payment(100, "bukan-tanggal", "x" * 99, "c" * 999, today="2026-10-07")
    ok(pj["tanggal"] == "2026-10-07" and len(pj["metode"]) == 40 and len(pj["catatan"]) == 300, "tanggal rusak → today; teks dipotong")
    ok(IP.total_paid([{"amount": 5}, {"amount": "x"}, None, {"amount": 7}]) == 12, "entri rusak diabaikan")

    # Alur DB (fake): push → hitung → pull, faktur asli (lines/meta) TIDAK berubah.
    db = FakeDB()
    await db.doc_history.insert_one({"id": "DOC-1", "jenis": "invoice", "lines": [{"harga": 54600000, "qty": 1}], "meta": {"x": 1}})
    await db.doc_history.update_one({"id": "DOC-1"}, {"$set": {"payments": [p1]}})
    d = await db.doc_history.find_one({"id": "DOC-1"})
    ok(d["lines"][0]["harga"] == 54600000 and d["meta"] == {"x": 1}, "faktur asli tidak berubah")
    ok(IP.summarize(54600000, d["payments"])["sisa"] == 46100000, "sisa dihitung dari record faktur")

    # Kwitansi: nomor format + cari pembayaran
    ok(IP.kwitansi_no(1, "2026-10-07") == "KWT0001_07102026_2026", "nomor kwitansi format KWT0001_DDMMYYYY_YYYY")
    ok(IP.kwitansi_no(123, "2026-01-05") == "KWT0123_05012026_2026", "nomor kwitansi urut 3 digit")
    ok(IP.find_payment([p1, p2], p2["id"]) is p2 and IP.find_payment([p1], "x") is None and IP.find_payment(None, "x") is None, "find_payment")


async def main():
    for t in (test_smart_allocation_and_restore, test_vendor_pin_embedded, test_auto_refresh_cycle, test_trace_probe_dedupe_sat, test_invoice_payments, test_ingest_basic, test_idempotent, test_idempotency_key_only,
              test_supplier_not_found, test_entity_validation, test_reverse,
              test_allocate, test_koreksi, test_pull_ack_selection,
              test_preview_readonly, test_waterfall_auto_alloc, test_dedup_suggest,
              test_expenses_helpers, test_rekon_to_biaya, test_tagihan_status_and_routing,
              test_pnl, test_ais_trace, test_vesselapi_terrestrial_fallback,
              test_vesselfinder_refresh, test_felis_adapter):
        await t()
    print(f"\nSEMUA LULUS — {PASS} assertions.")


if __name__ == "__main__":
    asyncio.run(main())
