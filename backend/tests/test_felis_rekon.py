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
import ship_master as SM
import leg_supplier as LSP
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

    async def to_list(self, n=None):
        return list(self._docs[:n] if n else self._docs)

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


async def test_vendor_trip_search_fast():
    """Pencarian trip di 'Catat Bayar Vendor': 1 query trip + 1 query order (tidak N+1),
    nopol cocok walau beda spasi/huruf, kosong = trip terbaru. Kode ASLI server.py (AST)."""
    print("test_vendor_trip_search_fast")
    import ast, re as _re, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    want = {"_route_split", "_rute_str", "_trip_ctx_from", "_norm_cari", "vendor_mobile_trips"}
    code = "\n".join(ast.get_source_segment(src, n) for n in ast.parse(src).body
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want)
    code = code.replace('@api_router.get("/vendor-mobile/trips", dependencies=[Depends(require_vendor_pin)])\n', "")

    class _DB:
        pass
    d = _DB(); d.trips = FakeColl(); d.orders = FakeColl()
    ns = {"re": _re, "Optional": typing.Optional, "db": d}
    exec(code, ns)
    calls = {"find_one": 0}
    orig = d.orders.find_one
    async def counting(*a, **k):
        calls["find_one"] += 1
        return await orig(*a, **k)
    d.orders.find_one = counting
    await d.trips.insert_one({"trip_id": "T1", "nopol": "", "route": "Jakarta-Makassar", "created_at": "2026-10-01"})
    await d.trips.insert_one({"trip_id": "T2", "nopol": "D 55 XY", "route": "Surabaya-Ternate", "created_at": "2026-10-02",
                              "customer_data": {"nama": "CV Trans Mandiri"}})
    await d.orders.insert_one({"trip_id": "T1", "order_id": "O1", "nopol": "b1737kyz", "vehicle_type": "Terios",
                               "customer_nama": "PT Maju", "asal_kota": "Jakarta", "tujuan_kota": "Makassar"})
    r = (await ns["vendor_mobile_trips"](q="B 1737"))["items"]
    ok(len(r) == 1 and r[0]["trip_id"] == "T1" and r[0]["nopol"] == "B1737KYZ", "nopol dari PO ketemu walau beda spasi/huruf")
    ok(r[0]["vehicle"] == "Terios" and r[0]["customer"] == "PT Maju", "tipe unit & customer dari PO ikut")
    r = (await ns["vendor_mobile_trips"](q="trans mandiri"))["items"]
    ok(len(r) == 1 and r[0]["trip_id"] == "T2", "cari by customer dari trip tanpa PO")
    r = (await ns["vendor_mobile_trips"](q=""))["items"]
    ok([x["trip_id"] for x in r] == ["T1", "T2"] or [x["trip_id"] for x in r] == ["T2", "T1"], "kosong → daftar trip (terbaru) tampil")
    ok(len((await ns["vendor_mobile_trips"](q="", limit=1))["items"]) == 1, "limit dihormati")
    ok(calls["find_one"] == 0, "tidak ada query order per-trip (bukan N+1)")
    ok((await ns["vendor_mobile_trips"](q="tidakada"))["items"] == [], "tak cocok → kosong")


async def test_tembak_rekon_ke_unit_terpilih():
    """Tembak Rekon dari Rekap: pembayaran dibagi HANYA ke unit yang dicentang (pintar), unit
    yang sudah lunas dilewati, alokasi ke unit lain tak tersentuh. Kode ASLI endpoint (AST)."""
    print("test_tembak_rekon_ke_unit_terpilih")
    import ast, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "rekon_tembak_to_units")
    code = ast.get_source_segment(src, node)
    class _HTTP(Exception):
        def __init__(self, status_code, detail=""): self.status_code = status_code; self.detail = detail
    class _DB: pass
    d = _DB(); d.supplier_profiles = FakeColl()
    # 19 unit terpilih (faktur pas 57,5jt) + unit lain; unit "L0" sudah lunas (sisa 0)
    A = [7500000, 2400000, 2500000, 3000000, 7500000, 2500000, 4500000, 2400000, 250000, 2700000, 1500000, 3000000, 1000000, 3200000, 3700000]
    jobs = [{"id": f"A{i}"} for i in range(15)] + [{"id": "B0"}, {"id": "C0"}, {"id": "D0"}, {"id": "E0"}, {"id": "L0"}, {"id": "X0"}]
    rows = [(f"A{i}", v, "PA") for i, v in enumerate(A)] + [("B0", 250000, "PB"), ("C0", 2500000, "PC"), ("D0", 3700000, "PD"), ("E0", 3400000, "PE"), ("L0", 0, "PL"), ("X0", 9000000, "PX")]
    await d.supplier_profiles.insert_one({"id": "S1", "jobs": jobs, "rekon_payments": [
        {"id": "RP1", "amount": 57500000, "allocations": [{"job_id": "X0", "amount": 100000}]},
        {"id": "RPR", "amount": 1, "status": "reversed"}]})
    ns = {"db": d, "rekon_sync": R, "HTTPException": _HTTP, "Body": lambda *a, **k: None, "Dict": typing.Dict, "Any": typing.Any,
          "_rekon_job_rows": lambda sup, own=None: rows, "Optional": typing.Optional}
    exec(code, ns)
    fn = ns["rekon_tembak_to_units"]
    chosen = [f"A{i}" for i in range(15)] + ["B0", "C0", "D0", "E0"]
    # alokasi lama ke X0 (100rb) ikut mengurangi ruang → total harus muat
    r = await fn("S1", "RP1", {"job_ids": chosen})
    pay = (await d.supplier_profiles.find_one({"id": "S1"}))["rekon_payments"][0]
    ids = {a["job_id"] for a in pay["allocations"]}
    ok(r["ok"] and r["allocated"] + 100000 <= 57500000, "total (alokasi baru + yang dipertahankan) ≤ nominal")
    ok("X0" in ids and any(a["job_id"] == "X0" and a["amount"] == 100000 for a in pay["allocations"]), "alokasi ke unit LAIN (X0) dipertahankan")
    ok(all(i in chosen or i == "X0" for i in ids), "alokasi baru hanya ke unit yang dicentang")
    ok("L0" not in ids, "unit sudah lunas dilewati")
    # tanpa alokasi lama → faktur pas
    await d.supplier_profiles.update_one({"id": "S1"}, {"$set": {"rekon_payments": [{"id": "RP1", "amount": 57500000}, {"id": "RPR", "amount": 1, "status": "reversed"}]}})
    r = await fn("S1", "RP1", {"job_ids": chosen})
    ok(r["method"] == "faktur_pas" and r["units"] == 19 and r["allocated"] == 57500000 and r["unallocated"] == 0, "57,5jt → 19 unit terpilih, pas, tanpa sisa")
    # semua terpilih sudah lunas
    r = await fn("S1", "RP1", {"job_ids": ["L0"]})
    ok(r["allocated"] == 0 and r["method"] == "kosong", "unit terpilih sudah lunas → tidak ada yang dialokasikan, ada catatan")
    for bad, code_ in ((("S1", "RP1", {"job_ids": []}), 400), (("S1", "RPR", {"job_ids": ["A0"]}), 400), (("S1", "ZZ", {"job_ids": ["A0"]}), 404), (("NOPE", "RP1", {"job_ids": ["A0"]}), 404)):
        try:
            await fn(*bad); got = None
        except _HTTP as e:
            got = e.status_code
        ok(got == code_, f"error {code_} untuk input tidak valid")


async def test_vendor_pay_rute_override():
    """Catat Pembayaran: asal/tujuan leg bisa diubah dari rute trip. Kosong → pakai rute trip.
    Kode ASLI _add_trip_supplier_job (AST) dengan helper di-stub."""
    print("test_vendor_pay_rute_override")
    import ast, re as _re, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "_add_trip_supplier_job")
    code = ast.get_source_segment(src, node)
    class _DB: pass
    d = _DB(); d.supplier_profiles = FakeColl()
    await d.supplier_profiles.insert_one({"id": "S1", "nama": "FABLI", "jobs": []})
    async def _ensure(sup): return sup
    async def _ctx(trip): return {"vehicle_type": "Avanza", "nopol": "B1737DOI", "no_rangka": "", "asal_kota": "LUWUK", "tujuan_kota": "JAKARTA",
                                  "trip_id": "T1", "order_id": "O1", "customer_id": "C1", "customer_nama": "PT X"}
    ns = {"db": d, "re": _re, "Optional": typing.Optional, "HTTPException": Exception, "_ensure_supplier_projects": _ensure,
          "_get_or_create_active_project": lambda sup: ("P1", []), "_gen_supplier_id": lambda: "J1", "today_wib": lambda: "2026-10-07",
          "_trip_auto_context": _ctx, "_find_or_create_supplier": None}
    exec(code, ns)
    fn = ns["_add_trip_supplier_job"]
    r = await fn({"trip_id": "T1"}, supplier_id="S1", kategori="Driver", jumlah=1000)
    ok(r["job"]["asal_kota"] == "LUWUK" and r["job"]["tujuan_kota"] == "JAKARTA", "tanpa override → rute trip")
    ns["_gen_supplier_id"] = lambda: "J2"
    r = await fn({"trip_id": "T1"}, supplier_id="S1", kategori="Driver", jumlah=1000, asal_kota="  Makassar ", tujuan_kota="")
    ok(r["job"]["asal_kota"] == "Makassar" and r["job"]["tujuan_kota"] == "JAKARTA", "asal diubah (di-trim), tujuan kosong → tetap rute trip")
    r = await fn({"trip_id": "T1"}, supplier_id="S1", kategori="Driver", jumlah=1000, asal_kota="Luwuk", tujuan_kota="Palu")
    ok(r["job"]["asal_kota"] == "Luwuk" and r["job"]["tujuan_kota"] == "Palu", "kedua kota bisa diubah (leg ≠ rute penuh)")


async def test_rekon_other_payments():
    """Daftar rekon aktif di vendor LAIN (read-only) buat sheet Tembak Rekon; pindah lewat
    apply_correction (sudah diuji). Kode ASLI endpoint (AST)."""
    print("test_rekon_other_payments")
    import ast, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "rekon_other_payments")
    code = ast.get_source_segment(src, node)
    class _DB: pass
    d = _DB(); d.supplier_profiles = FakeColl()
    await d.supplier_profiles.insert_one({"id": "M", "nama": "MARTHEN", "rekon_payments": []})
    await d.supplier_profiles.insert_one({"id": "T", "nama": "Ahmad Taupiq", "rekon_payments": [
        {"id": "p1", "amount": 57500000, "tanggal": "2026-10-05", "bank_transaction_id": "B1", "allocations": [{"job_id": "x", "amount": 1000000}]},
        {"id": "p2", "amount": 1000, "tanggal": "2026-09-01", "bank_transaction_id": "B2", "status": "reversed"}]})
    await d.supplier_profiles.insert_one({"id": "Z", "nama": "Z", "rekon_payments": [{"id": "p3", "amount": 5, "tanggal": "2026-10-06", "bank_transaction_id": "B3"}]})
    orig = d.supplier_profiles.find
    d.supplier_profiles.find = lambda f=None, proj=None: orig({})   # fake tak paham "rekon_payments.0"
    ns = {"db": d, "Optional": typing.Optional}
    exec(code, ns)
    r = (await ns["rekon_other_payments"](exclude_supplier_id="M"))["items"]
    ok([x["id"] for x in r] == ["p3", "p1"], "aktif di vendor lain saja, terbaru dulu, reversed tak ikut")
    p1 = next(x for x in r if x["id"] == "p1")
    ok(p1["supplier_nama"] == "Ahmad Taupiq" and p1["alloc_status"] == "partial" and p1["allocated"] == 1000000, "nama vendor & status alokasi benar")
    r2 = (await ns["rekon_other_payments"](exclude_supplier_id="T"))["items"]
    ok([x["id"] for x in r2] == ["p3"], "vendor yang dikecualikan tidak ikut")


async def test_tembak_semua():
    """Tembak SEMUA: semua rekon aktif → unit terpilih, biaya admin bank dikecualikan (dilepas),
    alokasi lama ke unit lain diganti, total tak melebihi nominal/sisa. Fungsi murni asli."""
    print("test_tembak_semua")
    ok(R.is_bank_fee({"catatan": "BIF BIAYA TXN KE 002 MARTHEN RUNTURAMBI KBB"}), "BIAYA TXN = biaya admin bank")
    ok(R.is_bank_fee({"catatan": "BIAYA ADM BULANAN"}) and not R.is_bank_fee({"catatan": "BIF TRANSFER KE 002 MARTHEN RUNTURAMBI KBB"}), "transfer biasa bukan biaya")
    ok(not R.is_bank_fee({}) and not R.is_bank_fee(None), "kosong aman")
    # 3 unit terpilih (U1 5jt, U2 3jt, U3 2jt) + 1 unit lain (X 9jt) yang salah dibayar rekon lama
    rows = [("X", 9000000, "PX"), ("U1", 5000000, "PA"), ("U2", 3000000, "PA"), ("U3", 2000000, "PB")]
    pays = [
        {"id": "f1", "amount": 2500, "tanggal": "2026-08-18", "catatan": "BIF BIAYA TXN KE 002 MARTHEN", "allocations": [{"job_id": "U1", "amount": 2500}]},
        {"id": "t1", "amount": 5000000, "tanggal": "2026-08-18", "catatan": "BIF TRANSFER KE 002 MARTHEN", "allocations": [{"job_id": "X", "amount": 5000000}]},
        {"id": "t2", "amount": 3000000, "tanggal": "2026-08-19", "catatan": "BIF TRANSFER KE 002 MARTHEN", "allocations": []},
        {"id": "t3", "amount": 2000000, "tanggal": "2026-08-20", "catatan": "BIF TRANSFER KE 002 MARTHEN", "allocations": []},
        {"id": "r1", "amount": 123, "status": "reversed", "catatan": "x"},
    ]
    new, sm = R.plan_tembak_semua(rows, pays, ["U1", "U2", "U3"])
    by = {p["id"]: p for p in new}
    ok(by["f1"]["allocations"] == [] and sm["fee_released"] == 1 and sm["fee_count"] == 1, "biaya admin dilepas dari tagihan & dihitung sbg biaya")
    ok(by["t1"]["allocations"] == [{"job_id": "U1", "amount": 5000000}], "5jt pas ke U1 (bukan ke unit lain X)")
    ok(by["t2"]["allocations"] == [{"job_id": "U2", "amount": 3000000}] and by["t3"]["allocations"] == [{"job_id": "U3", "amount": 2000000}], "3jt→U2, 2jt→U3")
    ok(not any(a["job_id"] == "X" for p in new for a in (p.get("allocations") or [])), "tidak ada yang ke unit di luar centang")
    ok(sm["allocated"] == 10000000 and sm["unallocated"] == 0 and sm["sisa_unit"] == 0 and sm["units_open"] == 0, "total 10jt = tagihan 10jt, lunas semua, tanpa sisa")
    ok(by["r1"].get("status") == "reversed" and "allocations" not in by["r1"], "rekon reversed tidak disentuh")
    # uang kurang dari tagihan → sisa unit tetap terbuka; uang lebih → sisa uang belum dialokasikan
    new2, sm2 = R.plan_tembak_semua(rows, [{"id": "a", "amount": 4000000, "tanggal": "2026-08-01", "catatan": "TRANSFER"}], ["U1", "U2", "U3"])
    ok(sm2["allocated"] == 4000000 and sm2["sisa_unit"] == 6000000, "uang < tagihan → sisa tagihan terbuka")
    new3, sm3 = R.plan_tembak_semua(rows, [{"id": "a", "amount": 12000000, "tanggal": "2026-08-01", "catatan": "TRANSFER"}], ["U1", "U2", "U3"])
    ok(sm3["allocated"] == 10000000 and sm3["unallocated"] == 2000000, "uang > tagihan → selisih tetap belum dialokasikan")
    ok(sm["released_other_units"] == 1 and sm["released_other_amount"] == 5000000, "dampak: alokasi lama 5jt ke unit LUAR centang (X) akan dilepas")
    ok(sm["open_units"] == [] and sm["units_total"] == 3, "tidak ada unit yang tersisa terbuka")
    _o, smo = R.plan_tembak_semua(rows, [{"id": "a", "amount": 4000000, "tanggal": "2026-08-01", "catatan": "TRANSFER"}], ["U1", "U2", "U3"])
    ok(sorted(x["job_id"] for x in smo["open_units"]) == ["U2", "U3"] or sorted(x["job_id"] for x in smo["open_units"]) == ["U1", "U2", "U3"], "unit yang masih terbuka disebutkan (buat diagnosa 'kenapa kurang')")
    ok(sum(x["sisa"] for x in smo["open_units"]) == smo["sisa_unit"], "jumlah sisa unit terbuka konsisten")
    _, sm4 = R.plan_tembak_semua(rows, pays, ["U1", "U2", "U3"], release_fee=False)
    ok(sm4["fee_released"] == 0, "release_fee=False → alokasi biaya admin dibiarkan")


async def test_pisah_faktur():
    """Pisah unit ke faktur (projek) baru: pindah project_id saja, closed kalau lunas, open di depan
    kalau belum, idempoten. Modul murni asli supplier_faktur."""
    print("test_pisah_faktur")
    import supplier_faktur as SF
    jobs = [{"id": f"J{i}", "project_id": "P0", "total_harga": 100} for i in range(5)] + [{"id": "K0", "project_id": "P9"}]
    projects = [{"id": "P0", "nama": "Projek 1", "status": "open"}, {"id": "P9", "nama": "Projek 9", "status": "open"}]
    chosen = {"J0", "J1", "J2"}
    ok(SF.reusable_project(jobs, projects, chosen) is None, "unit belum sendiri di projeknya → belum bisa dipakai ulang")
    nj, np_, pr = SF.move_to_new_project(jobs, projects, chosen, "PN", "FP-AAL-000777", None, True, "2026-10-07T00:00:00")
    by = {j["id"]: j for j in nj}
    ok(all(by[i]["project_id"] == "PN" for i in chosen) and all(by[i]["project_id"] == "P0" for i in ("J3", "J4")) and by["K0"]["project_id"] == "P9", "hanya unit terpilih pindah projek")
    ok(pr["no_faktur"] == "FP-AAL-000777" and pr["nama"] == "FP-AAL-000777" and pr["status"] == "closed" and pr["closed_at"], "faktur otomatis, nama default = no faktur, lunas → closed")
    ok(np_[-1]["id"] == "PN" and [p["id"] for p in np_[:2]] == ["P0", "P9"], "projek lunas ditaruh di belakang; projek aktif lama tak berubah")
    ok(by["J0"]["total_harga"] == 100 and jobs[0]["project_id"] == "P0", "nominal tak berubah & data asli tak dimutasi")
    nj2, np2, pr2 = SF.move_to_new_project(jobs, projects, chosen, "PN", "FP-AAL-000778", "Faktur Marthen", False, "t")
    ok(pr2["status"] == "open" and np2[0]["id"] == "PN" and pr2["nama"] == "Faktur Marthen", "belum lunas → open, di DEPAN (bukan projek aktif penampung unit baru)")
    again = SF.reusable_project(nj, np_, chosen)
    ok(again is not None and again["id"] == "PN", "tekan lagi → pakai faktur yang sama (idempoten, tak bikin nomor baru)")
    ok(SF.reusable_project(nj, np_, {"J0", "J1"}) is None, "sebagian unit faktur → tidak dipakai ulang")


async def test_imports_exclude_compact():
    """Daftar impor rekon: exclude_status membuang 1 status (jejak = bukan 'processed'); compact
    mengirim proyeksi tanpa raw_payload. Kode ASLI endpoint (AST)."""
    print("test_imports_exclude_compact")
    import ast, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "rekon_list_imports")
    code = ast.get_source_segment(src, node)
    seen = {}
    class _Coll(FakeColl):
        def find(self, filt=None, proj=None):
            seen["proj"] = proj
            return super().find(filt, proj)
    class _DB(dict): pass
    d = _DB(); d[R.IMPORTS_COLLECTION] = _Coll()
    for i, st in enumerate(["processed", "reversed", "supplier_not_found", "processed", "posted_expense"]):
        await d[R.IMPORTS_COLLECTION].insert_one({"bank_transaction_id": f"b{i}", "status": st, "raw_payload": {"x": 1}, "created_at": f"2026-10-0{i+1}"})
    ns = {"db": d, "rekon_sync": R, "Optional": typing.Optional}
    exec(code, ns)
    fn = ns["rekon_list_imports"]
    r = await fn(exclude_status="processed", compact=True)
    ok(sorted(x["status"] for x in r["items"]) == ["posted_expense", "reversed", "supplier_not_found"], "exclude_status=processed → hanya yang BUKAN pembayaran aktif")
    ok(seen["proj"] == {"_id": 0, "raw_payload": 0}, "compact → proyeksi tanpa raw_payload")
    r = await fn()
    ok(len(r["items"]) == 5 and seen["proj"] == {"_id": 0}, "default tetap sama (semua status, penuh) — backward-compatible")
    r = await fn(status="reversed", exclude_status="processed")
    ok([x["status"] for x in r["items"]] == ["reversed"], "status eksplisit menang atas exclude_status")


async def test_riwayat_clear():
    """Clear/Arsip Riwayat Pembayaran: hanya field aditif riwayat_clear; jobs/rekon_payments/alokasi/
    status TIDAK berubah; idempoten; bisa dikembalikan; jejak audit tersimpan; kunci tak dikenal ditolak.
    Modul murni + endpoint ASLI (AST)."""
    print("test_riwayat_clear")
    import ast, copy, typing
    import riwayat_clear as RC
    doc = {"id": "S1", "nama": "MARTHEN",
           "jobs": [{"id": "J1", "total_harga": 100, "payments": [{"id": "p1", "batch_id": "B1", "amount": 60}, {"id": "p2", "batch_id": "B1", "amount": 40}, {"id": "p3", "amount": 5}]}],
           "rekon_payments": [{"id": "r1", "amount": 100, "allocations": [{"job_id": "J1", "amount": 100}]}, {"id": "r2", "amount": 2500, "status": "reversed"}]}
    vk = RC.valid_keys(doc)
    ok(vk == {"rk:r1": "rekon", "rk:r2": "rekon", "tx:B1": "manual", "tx:p3": "manual"}, "kunci riwayat: rekon per id, manual per batch (1 batch = 1 transaksi)")
    e1 = RC.apply_clear([], ["rk:r1", "tx:B1"], vk, "2026-10-08T00:00:00", "Admin")
    ok(RC.cleared_keys(e1) == {"rk:r1", "tx:B1"} and e1[0]["cleared_by"] == "Admin" and e1[0]["history"][0]["action"] == "clear", "clear: status + cleared_at/by + history")
    e1b = RC.apply_clear(e1, ["rk:r1"], vk, "2026-10-08T01:00:00", "X")
    ok(e1b == e1 and len(e1b) == 2, "clear ulang = idempoten (tidak dobel, tidak menimpa)")
    e2 = RC.apply_unclear(e1, ["tx:B1"], "2026-10-08T02:00:00", "Admin")
    ok(RC.cleared_keys(e2) == {"rk:r1"} and [x for x in e2 if x["key"] == "tx:B1"][0]["status"] == "restored", "kembalikan dari clear → muncul lagi di daftar utama")
    ok([h["action"] for h in [x for x in e2 if x["key"] == "tx:B1"][0]["history"]] == ["clear", "restore"], "jejak audit clear→restore tersimpan")
    e3 = RC.apply_clear(e2, ["tx:B1"], vk, "2026-10-08T03:00:00", "Admin")
    ok(RC.cleared_keys(e3) == {"rk:r1", "tx:B1"} and len([x for x in e3 if x["key"] == "tx:B1"][0]["history"]) == 3, "clear lagi setelah restore: 1 entri, riwayat 3 aksi")
    ok(e1 != [] and RC.cleared_keys([]) == set() and RC.apply_unclear([], ["x"], "t", "a") == [], "kosong aman")

    # endpoint asli
    class _HTTP(Exception):
        def __init__(self, status_code, detail=""): self.status_code = status_code; self.detail = detail
    class _DB: pass
    d = _DB(); d.supplier_profiles = FakeColl()
    await d.supplier_profiles.insert_one(copy.deepcopy(doc))
    node = next(n for n in ast.parse(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()).body
                if isinstance(n, ast.AsyncFunctionDef) and n.name == "_riwayat_clear_op")
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    ns = {"db": d, "HTTPException": _HTTP, "riwayat_clear": RC, "datetime": __import__("datetime").datetime}
    exec(ast.get_source_segment(src, node), ns)
    op = ns["_riwayat_clear_op"]
    before = copy.deepcopy(await d.supplier_profiles.find_one({"id": "S1"}))
    r = await op("S1", {"keys": ["rk:r1", "tx:B1"], "by": "Admin"}, False)
    after = await d.supplier_profiles.find_one({"id": "S1"})
    ok(r["cleared"] == ["rk:r1", "tx:B1"] and "riwayat_clear" in after, "endpoint clear: tersimpan di riwayat_clear")
    ok(after["jobs"] == before["jobs"] and after["rekon_payments"] == before["rekon_payments"], "jobs (pembayaran/alokasi/status) & rekon_payments TIDAK berubah sama sekali")
    r = await op("S1", {"keys": ["tx:B1"]}, True)
    ok(r["cleared"] == ["rk:r1"], "endpoint unclear: tx:B1 kembali")
    for body, code in (({"keys": []}, 400), ({"keys": ["rk:tidakada"]}, 400)):
        try:
            await op("S1", body, False); got = None
        except _HTTP as e:
            got = e.status_code
        ok(got == code, f"input tidak valid → {code}")
    try:
        await op("ZZ", {"keys": ["rk:r1"]}, False); got = None
    except _HTTP as e:
        got = e.status_code
    ok(got == 404, "supplier tak ada → 404")


async def test_selisih_ringkasan_auth():
    """Download Ringkasan Selisih: data endpoint tidak lagi selalu 401 di mode admin TERBUKA;
    mode terkunci tetap wajib PIN yang cocok. Kode ASLI server.py (AST)."""
    print("test_selisih_ringkasan_auth")
    import ast, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    want = {"_admin_locked", "_admin_is_open", "selisih_ringkasan_data"}
    code = "\n".join(ast.get_source_segment(src, n) for n in ast.parse(src).body
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in want)
    class _HTTP(Exception):
        def __init__(self, status_code, detail=""): self.status_code = status_code; self.detail = detail
    class _DB: pass
    d = _DB(); d.selisih_profiles = FakeColl()
    await d.selisih_profiles.insert_one({"id": "P1", "nama": "RACHMAT", "tagihan": [{"id": "T1", "items": []}]})
    ns = {"os": os, "db": d, "HTTPException": _HTTP, "Optional": typing.Optional, "Query": lambda *a, **k: None, "Header": lambda *a, **k: None,
          "_selisih_tagihan_totals": lambda t: {**t, "total_selisih": 0, "total_terbayar": 0, "sisa": 0}}
    exec(code, ns)
    fn = ns["selisih_ringkasan_data"]
    saved = {k: os.environ.get(k) for k in ("ADMIN_LOCK", "ADMIN_PIN")}
    async def call(pin):
        try:
            return (await fn("P1", pin))["nama"]
        except _HTTP as e:
            return e.status_code
    try:
        os.environ.pop("ADMIN_LOCK", None); os.environ.pop("ADMIN_PIN", None)
        ok(await call("") == "RACHMAT", "mode terbuka (tanpa PIN & tanpa lock): data ringkasan terbaca (sebelumnya 401)")
        os.environ["ADMIN_PIN"] = "1234"
        ok(await call("") == "RACHMAT", "ADMIN_PIN ada tapi ADMIN_LOCK mati (terbuka): tetap terbaca")
        os.environ["ADMIN_LOCK"] = "1"
        ok(await call("") == 401 and await call("0000") == 401, "terkunci: PIN kosong/salah → 401")
        ok(await call("1234") == "RACHMAT", "terkunci: PIN benar → terbaca")
    finally:
        for k, v in saved.items():
            if v is None: os.environ.pop(k, None)
            else: os.environ[k] = v


async def test_edit_invoice_lines():
    """Edit/Tambah Unit invoice: baris diganti, No. Invoice/payments/meta TIDAK berubah, edit_log tercatat,
    validasi input. Kode ASLI endpoint (AST)."""
    print("test_edit_invoice_lines")
    import ast, copy, typing, datetime as _dt
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "edit_invoice_lines")
    class _HTTP(Exception):
        def __init__(self, status_code, detail=""): self.status_code = status_code; self.detail = detail
    class _C(FakeColl):
        async def update_one(self, filt, update, upsert=False):
            for d in self.docs:
                if self._match(d, filt):
                    d.update((update or {}).get("$set") or {})
                    for k, v in ((update or {}).get("$push") or {}).items():
                        d.setdefault(k, []).append(v)
                    return types.SimpleNamespace(modified_count=1)
            return types.SimpleNamespace(modified_count=0)
    class _DB: pass
    d = _DB(); d.doc_history = _C()
    base = {"id": "DOC-1", "jenis": "invoice", "no_dokumen": "INV0156_08102026_2026", "customer": "PT ASDP", "meta": {"withTax": True},
            "payments": [{"id": "p1", "amount": 1000}], "order_ids": ["O1"],
            "lines": [{"nama": "Jasa Pengiriman", "ket": "Rush B 1", "qty": 1, "harga": 10500000}]}
    await d.doc_history.insert_one(copy.deepcopy(base))
    ns = {"db": d, "HTTPException": _HTTP, "Dict": typing.Dict, "Any": typing.Any, "Body": lambda *a, **k: None,
          "datetime": _dt.datetime, "timezone": _dt.timezone}
    exec(ast.get_source_segment(src, node), ns)
    fn = ns["edit_invoice_lines"]
    new_lines = base["lines"] + [{"nama": "Jasa Pengiriman", "ket": "Rush B 2<br>No. Rangka: X", "qty": 1, "harga": "8500000"}]
    r = await fn("DOC-1", {"lines": new_lines, "order_ids": ["O1", "O2"], "by": "Admin"})
    ok(len(r["lines"]) == 2 and r["lines"][1]["harga"] == 8500000, "unit ditambah, harga dinormalisasi ke angka")
    ok(r["no_dokumen"] == base["no_dokumen"] and r["payments"] == base["payments"] and r["meta"] == base["meta"] and r["customer"] == "PT ASDP", "No. Invoice, pembayaran, meta, customer TIDAK berubah")
    ok(r["order_ids"] == ["O1", "O2"] and r["judul"] == "PT ASDP · 2 unit · 2 PO", "order_ids & judul ikut")
    ok(len(r["edit_log"]) == 1 and r["edit_log"][0]["unit_sebelum"] == 1 and r["edit_log"][0]["unit_sesudah"] == 2, "jejak edit tercatat")
    for body, code in (({"lines": []}, 400), ({"lines": [{"harga": -1}]}, 400), ({"lines": [{"harga": "abc"}]}, 400), ({"lines": ["x"]}, 400)):
        try:
            await fn("DOC-1", body); got = None
        except _HTTP as e:
            got = e.status_code
        ok(got == code, f"input tidak valid → {code}")
    try:
        await fn("ZZ", {"lines": new_lines}); got = None
    except _HTTP as e:
        got = e.status_code
    ok(got == 404, "invoice tak ada → 404")


async def test_sync_single_unit_vehicle():
    """PO 1 unit: nopol/no. rangka hasil edit manual (level order) dipakai di units[0] untuk Invoice;
    PO multi-unit & nilai kosong tidak disentuh. Fungsi ASLI server.py (AST)."""
    print("test_sync_single_unit_vehicle")
    import ast, typing
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_sync_single_unit_vehicle")
    ns = {}
    exec(ast.get_source_segment(src, node), ns)
    f = ns["_sync_single_unit_vehicle"]
    o = {"order_id": "O1", "nopol": "B 1618 DOF", "no_rangka": "MHKE8FB2JPK017102",
         "units": [{"unit_id": "u1", "nopol": "B 1620 DOF", "no_rangka": "MHKE8FB2JPK017072", "vehicle_type": "Rush"}]}
    r = f(o)
    ok(r["units"][0]["nopol"] == "B 1618 DOF" and r["units"][0]["no_rangka"] == "MHKE8FB2JPK017102", "1 unit: nopol & no. rangka hasil edit dipakai di units[0] (invoice benar)")
    ok(r["units"][0]["unit_id"] == "u1" and r["units"][0]["vehicle_type"] == "Rush", "field unit lain tidak berubah")
    multi = {"order_id": "O2", "nopol": "B 1", "units": [{"nopol": "B 9"}, {"nopol": "B 8"}]}
    ok(f(dict(multi))["units"] == multi["units"], "PO multi-unit tidak disentuh")
    blank = {"order_id": "O3", "nopol": "", "no_rangka": " ", "units": [{"nopol": "B 5", "no_rangka": "R5"}]}
    ok(f(blank)["units"][0]["nopol"] == "B 5" and blank["units"][0]["no_rangka"] == "R5", "level-order kosong → units[0] dipertahankan")
    same = {"nopol": "b 5", "units": [{"nopol": "B 5"}]}
    ok(f(same)["units"][0]["nopol"] == "B 5", "nilai sama (beda huruf besar/kecil) → tidak ditimpa")
    ok(f(None) is None and f({"units": None}) == {"units": None}, "input kosong aman")


async def test_ship_master():
    print("\n== master kapal (panjang/lebar/tipe) ==")
    db = FakeDB()
    ok(SM.make_key("525019123", "") == "mmsi:525019123", "key MMSI 9 digit")
    ok(SM.make_key("12", "9512345") == "imo:9512345", "MMSI tak valid → fallback IMO 7 digit")
    ok(SM.make_key("", "") == "", "tanpa identitas → key kosong")
    for bad, msg in (({"mmsi": "123"}, "MMSI harus 9 digit"), ({"imo": "12"}, "IMO harus 7 digit"), ({}, "Isi MMSI"),
                     ({"mmsi": "525019123", "length_m": "abc"}, "harus angka"),
                     ({"mmsi": "525019123", "length_m": 9999}, "di luar batas"),
                     ({"mmsi": "525019123", "width_m": -3}, "di luar batas")):
        try:
            SM.clean_payload(bad); ok(False, f"harus ditolak: {bad}")
        except ValueError as e:
            ok(msg in str(e), f"ditolak: {msg}")
    d = await SM.upsert(db, {"mmsi": "525019123", "name": "KM <b>MUTIARA", "ship_type": "Passenger / Ro-Ro", "length_m": "78,5", "width_m": 14})
    ok(d["length_m"] == 78.5 and d["width_m"] == 14.0 and "<" not in d["name"], "upsert: koma desimal diterima, tag HTML dibuang")
    await SM.upsert(db, {"mmsi": "525019123", "length_m": 80})
    ok(len(db.ship_master.docs) == 1 and db.ship_master.docs[0]["length_m"] == 80.0, "upsert kedua mengoreksi dokumen yang sama (tanpa duplikat)")
    got = await SM.lookup(db, "525019123", "")
    ok(got and got["length_m"] == 80.0, "lookup via MMSI")
    ok(await SM.lookup(db, "000000000", "") is None, "lookup tak ada → None")
    pub = SM.public_master(got)
    ok(set(pub) == {"length_m", "width_m", "ship_type"}, "public_master hanya field aman")
    ok(SM.public_master({"mmsi": "525019123"}) is None, "master tanpa data berguna → None")
    ok(len(await SM.list_all(db)) == 1, "list_all")


async def test_leg_supplier():
    """Supplier per Leg: rumus (Kompensasi MENAMBAH tagihan), sinkron ke Departemen Supplier
    (angka _supplier_job_totals ASLI = angka modul leg), item non-leg tak tersentuh, ganti supplier."""
    print("\n== supplier per leg & pembayaran supplier ==")
    import ast, uuid as _uuid
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "_supplier_job_totals")
    ns = {"PPN_RATE_DEFAULT": 1.1, "PPH23_RATE_DEFAULT": 2.0, "ledger_status": LS}
    exec(ast.get_source_segment(src, node), ns)
    job_totals = ns["_supplier_job_totals"]

    db = FakeDB()
    async def ensure(doc):
        if not doc.get("projects"):
            doc["projects"] = [{"id": "p1", "nama": "Projek 1", "status": "open"}]
        return doc
    def active(doc):
        ps = list(doc.get("projects") or [])
        return ps[-1]["id"], ps
    n = [0]
    def gid():
        n[0] += 1; return f"g{n[0]:03d}"
    h = {"gen_id": gid, "today": lambda: "2026-10-09", "ensure_projects": ensure, "active_project": active}
    ctx = {"order_id": "ORD-1", "customer_nama": "PT X", "vehicle_type": "Truck", "nopol": "b 1234 xyz", "no_rangka": "", "asal": "Cilegon", "tujuan": "Port Jakarta"}

    # input
    for bad, msg in (({"harga_deal": "abc"}, "harus angka"), ({"harga_deal": -5}, "di luar batas"),
                     ({"harga_deal": 1, "extras": [{"label": "", "amount": 5}]}, "Keterangan"),
                     ({"harga_deal": 1, "extras": [{"label": "Tol", "amount": 0}]}, "Nominal")):
        try:
            await LSP.save_profile(db, "T1", "L1", dict(bad, supplier={"nama": "CV Laut"}), ctx, h); ok(False, f"harus ditolak {bad}")
        except ValueError as e:
            ok(msg in str(e), f"ditolak: {msg}")
    ok(not db.leg_supplier.docs and not db.supplier_profiles.docs, "input salah tidak menulis apa pun")

    sup = {"nama": "CV Laut Biru", "pic": "Budi", "no_hp": "0812", "email": "b@x.id", "bank": "BCA", "no_rekening": "123-456"}
    r = await LSP.save_profile(db, "T1", "L1", {"supplier": sup, "harga_deal": "10.000.000", "extras": [{"label": "BBM", "amount": 500000}, {"label": "Tol", "amount": 250000}]}, ctx, h)
    ok(r["totals"]["total_tagihan"] == 10750000 and r["totals"]["outstanding"] == 10750000, "tagihan = deal + tambahan")
    ok(r["totals"]["hpp_leg"] == 10750000, "biaya tambahan masuk HPP leg")
    prof = db.supplier_profiles.docs[0]
    ok(prof["nama"] == "CV Laut Biru" and prof["bank"] == "BCA" and prof["pic"] == "Budi", "profil supplier dibuat + data bank/PIC tersimpan")
    ok(len(prof["jobs"]) == 1 and prof["jobs"][0]["total_harga"] == 10000000 and prof["jobs"][0]["nopol"] == "B 1234 XYZ", "job Departemen Supplier dibuat")

    r = await LSP.add_payment(db, "T1", "L1", "kompensasi", 1000000, "2026-10-05", "Unit Avanza", "http://x/k.jpg", ctx, h, bukti_nama="kompensasi.jpg")
    ok(r["kompensasi"][0]["bukti_nama"] == "kompensasi.jpg", "nama file bukti tersimpan")
    ok(r["totals"]["kompensasi"] == 1000000 and r["totals"]["total_tagihan"] == 11750000, "kompensasi MENAMBAH total tagihan")
    r = await LSP.add_payment(db, "T1", "L1", "transfer", 4000000, "", "DP", "http://x/t.pdf", ctx, h)
    ok(r["totals"]["total_transfer"] == 4000000 and r["totals"]["outstanding"] == 7750000, "outstanding = total tagihan - transfer")
    ok(r["transfers"][0]["tanggal"] == "2026-10-09", "tanggal kosong → hari ini")

    prof = db.supplier_profiles.docs[0]
    jt = job_totals(prof["jobs"][0])
    ok(jt["total_harga"] == 11750000 and jt["total_terbayar"] == 4000000, "Departemen Supplier: total & terbayar sama")
    ok(jt["sisa_transfer"] == 7750000 if "sisa_transfer" in jt else (jt["net_transfer"] - jt["total_terbayar"]) == 7750000, "Departemen Supplier: sisa = outstanding modul leg")
    ok(any(t.get("kind") == "kompensasi" and t["bukti_url"] == "http://x/k.jpg" for t in prof["jobs"][0]["tambahan"]), "kompensasi tercermin sebagai tambahan (bukti ikut)")

    # item non-leg di job tidak tersentuh + simpan ulang idempoten (tanpa dobel)
    prof["jobs"][0]["payments"].append({"id": "manual1", "amount": 111, "tipe": "transfer"})
    prof["jobs"][0]["tambahan"].append({"id": "man2", "label": "Manual", "amount": 222})
    r = await LSP.save_profile(db, "T1", "L1", {"supplier": dict(sup, supplier_id=prof["id"]), "harga_deal": 10000000, "extras": [{"id": r["extras"][0]["id"], "label": "BBM", "amount": 500000}, {"label": "Tol", "amount": 250000}]}, ctx, h)
    prof = db.supplier_profiles.docs[0]
    ids = [p["id"] for p in prof["jobs"][0]["payments"]]
    ok(len(prof["jobs"]) == 1 and "manual1" in ids and len([i for i in ids if i.startswith("leg-")]) == 1, "simpan ulang: tanpa job/pembayaran dobel, item manual aman")
    ok(any(t["id"] == "man2" for t in prof["jobs"][0]["tambahan"]) and len([t for t in prof["jobs"][0]["tambahan"] if t.get("src") == "leg"]) == 3, "tambahan manual aman, item leg = 2 biaya + 1 kompensasi")
    ok(len(db.supplier_profiles.docs) == 1, "supplier tidak diduplikasi (cocok by id / nama)")

    # hapus pembayaran
    tid = r["transfers"][0]["id"]
    r = await LSP.delete_payment(db, "T1", "L1", tid, ctx, h)
    ok(r["totals"]["total_transfer"] == 0 and r["totals"]["outstanding"] == 11750000, "hapus transfer → outstanding naik lagi")
    ok(all(p["id"] != "leg-" + tid for p in db.supplier_profiles.docs[0]["jobs"][0]["payments"]), "hapus tersinkron ke Departemen Supplier")
    try:
        await LSP.delete_payment(db, "T1", "L1", "nope", ctx, h); ok(False, "harus 404")
    except KeyError:
        ok(True, "hapus id tak ada → KeyError (404)")
    try:
        await LSP.add_payment(db, "T1", "L2", "transfer", 5, "", "", None, ctx, h); ok(False, "tanpa supplier harus ditolak")
    except ValueError as e:
        ok("Supplier dulu" in str(e), "bayar sebelum supplier diisi ditolak")
    try:
        await LSP.add_payment(db, "T1", "L1", "transfer", 0, "", "", None, ctx, h); ok(False, "0 ditolak")
    except ValueError:
        ok(True, "jumlah 0 ditolak")

    # ganti supplier: job leg pindah, supplier lama bersih
    await LSP.save_profile(db, "T1", "L1", {"supplier": {"nama": "PT Samudra"}, "harga_deal": 9000000, "extras": []}, ctx, h)
    old, new = db.supplier_profiles.docs[0], db.supplier_profiles.docs[1]
    ok(new["nama"] == "PT Samudra" and len(new["jobs"]) == 1 and new["jobs"][0]["total_harga"] == 9000000, "supplier baru punya job leg")
    ok(not any(j.get("leg_ref") for j in old["jobs"]) and not any(t.get("src") == "leg" for j in old["jobs"] for t in j.get("tambahan", [])), "item leg dilepas dari supplier lama")
    ok(any(p["id"] == "manual1" for j in old["jobs"] for p in j["payments"]), "data manual di supplier lama tetap ada")
    rec = (await LSP.get(db, "T1", "L1"))
    ok(rec["dept"]["supplier_id"] == new["id"], "tautan dept menunjuk supplier baru")


async def test_daily_upload_idempotent():
    """Upload checkpoint harian: kiriman ulang (client_id sama) tidak dobel, foto antre
    yang terkirim terlambat dicatat pada waktu foto diambil, aturan 1 foto/hari tetap.
    Kode ASLI endpoint (AST)."""
    print("test_daily_upload_idempotent")
    import ast, typing
    from datetime import datetime, timezone, timedelta
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "upload_daily_photo")
    code = ast.get_source_segment(src, node)
    WIB_ = timezone(timedelta(hours=7))

    class _HTTP(Exception):
        def __init__(self, status_code, detail=""):
            self.status_code, self.detail = status_code, detail

    class _Trips:
        def __init__(self): self.docs = [{"trip_id": "T1", "daily_checkpoints": []}]
        async def find_one(self, f, proj=None):
            for d in self.docs:
                if all(d.get(k) == v for k, v in f.items()):
                    return json_copy(d)
            return None
        async def update_one(self, f, upd):
            for d in self.docs:
                if all(d.get(k) == v for k, v in f.items()):
                    for k, v in (upd.get("$push") or {}).items(): d.setdefault(k, []).append(v)
                    d.update(upd.get("$set") or {})

    import copy as _copy
    json_copy = _copy.deepcopy
    class _DB: pass
    d = _DB(); d.trips = _Trips()
    saved = []
    def _save(trip_id, sub, f, allowed): saved.append(1); return "/media/%s.jpg" % len(saved)
    def _pub(doc): doc.pop("_id", None); return doc
    ns = {"db": d, "Optional": typing.Optional, "UploadFile": object, "File": lambda *a, **k: None, "Form": lambda *a, **k: None,
          "HTTPException": _HTTP, "uuid": __import__("uuid"), "datetime": datetime, "timezone": timezone, "timedelta": timedelta,
          "WIB": WIB_, "today_wib": lambda: datetime.now(WIB_).strftime("%Y-%m-%d"),
          "_save_upload": _save, "ALLOWED_IMG": {".jpg"}, "trip_doc_to_public": _pub}
    exec(code, ns)
    up = ns["upload_daily_photo"]
    today = datetime.now(WIB_).strftime("%Y-%m-%d")

    r = await up("T1", foto=object(), lat=1.5, lng=124.8, status="Berangkat", keterangan=" ok ", alamat=None, client_id="c1", taken_at=None)
    ok(len(r["daily_checkpoints"]) == 1 and r["daily_checkpoints"][0]["client_id"] == "c1" and r["daily_checkpoints"][0]["date"] == today, "upload pertama tercatat + client_id")
    n = len(saved)
    r = await up("T1", foto=object(), lat=None, lng=None, status=None, keterangan=None, alamat=None, client_id="c1", taken_at=None)
    ok(len(r["daily_checkpoints"]) == 1 and len(saved) == n, "kiriman ulang client_id sama: tidak dobel & file tidak disimpan lagi")
    try:
        await up("T1", foto=object(), lat=None, lng=None, status=None, keterangan=None, alamat=None, client_id="c2", taken_at=None)
        ok(False, "foto kedua hari ini harus ditolak")
    except _HTTP as e:
        ok(e.status_code == 409, "foto lain di hari yang sama tetap 409")
    # foto antre kemarin, terkirim hari ini: dicatat pada tanggal & waktu foto diambil
    y = datetime.now(timezone.utc) - timedelta(days=1)
    r = await up("T1", foto=object(), lat=None, lng=None, status=None, keterangan=None, alamat=None, client_id="c3", taken_at=y.isoformat().replace("+00:00", "Z"))
    cps = r["daily_checkpoints"]
    ok(len(cps) == 2 and cps[1]["date"] == y.astimezone(WIB_).strftime("%Y-%m-%d") and cps[1]["ts"].startswith(y.isoformat()[:16]), "foto kemarin dicatat sesuai waktu pengambilan")
    for label, ta in (("5 hari lalu", (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()),
                      ("masa depan", (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()),
                      ("tidak valid", "bukan-tanggal")):
        try:
            await up("T1", foto=object(), lat=None, lng=None, status=None, keterangan=None, alamat=None, client_id="cx-" + label, taken_at=ta)
            ok(False, "taken_at tidak wajar harus diabaikan -> 409: " + label)
        except _HTTP as e:
            ok(e.status_code == 409, "taken_at %s diabaikan (pakai waktu server)" % label)
    # klien lama (tanpa client_id/taken_at) tetap jalan
    d.trips.docs.append({"trip_id": "T2", "daily_checkpoints": []})
    r = await up("T2", foto=object(), lat=None, lng=None, status=None, keterangan=None, alamat=None, client_id=None, taken_at=None)
    ok(len(r["daily_checkpoints"]) == 1 and "client_id" not in r["daily_checkpoints"][0], "klien lama tanpa client_id tetap berfungsi")


async def test_bastk_upload_idempotent():
    """BASTK: kiriman ulang (client_id sama) tidak menambah lembar; batas 6 lembar tetap; klien lama jalan.
    Kode ASLI endpoint (AST)."""
    print("test_bastk_upload_idempotent")
    import ast, typing, copy
    from datetime import datetime, timezone
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server.py"), encoding="utf-8").read()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.AsyncFunctionDef) and n.name == "upload_bastk")
    code = ast.get_source_segment(src, node)
    class _HTTP(Exception):
        def __init__(self, status_code, detail=""): self.status_code, self.detail = status_code, detail
    class _Trips:
        def __init__(self): self.docs = [{"trip_id": "T1", "handover": {"bastk": []}}]
        async def find_one(self, f, proj=None):
            for d in self.docs:
                if all(d.get(k) == v for k, v in f.items()): return copy.deepcopy(d)
        async def update_one(self, f, upd):
            for d in self.docs:
                if all(d.get(k) == v for k, v in f.items()):
                    for k, v in (upd.get("$push") or {}).items():
                        a, b = k.split("."); d.setdefault(a, {}).setdefault(b, []).append(v)
                    d.update(upd.get("$set") or {})
    class _DB: pass
    d = _DB(); d.trips = _Trips()
    saved = []
    async def _notify(tid): pass
    ns = {"db": d, "Optional": typing.Optional, "UploadFile": object, "File": lambda *a, **k: None, "Form": lambda *a, **k: None,
          "HTTPException": _HTTP, "uuid": __import__("uuid"), "datetime": datetime, "timezone": timezone,
          "_save_upload": lambda *a: (saved.append(1), "/media/b%d.jpg" % len(saved))[1], "ALLOWED_IMG": {".jpg"}, "ALLOWED_DOC": {".pdf"},
          "_maybe_notify_handover_complete": _notify, "trip_doc_to_public": lambda x: (x.pop("_id", None), x)[1]}
    exec(code, ns)
    up = ns["upload_bastk"]
    r = await up("T1", foto=object(), client_id="k1")
    ok(len(r["handover"]["bastk"]) == 1 and r["handover"]["bastk"][0]["client_id"] == "k1", "lembar pertama tercatat + client_id")
    n = len(saved)
    r = await up("T1", foto=object(), client_id="k1")
    ok(len(r["handover"]["bastk"]) == 1 and len(saved) == n, "kiriman ulang client_id sama: tidak dobel, file tidak disimpan lagi")
    r = await up("T1", foto=object(), client_id="k2")
    ok(len(r["handover"]["bastk"]) == 2, "lembar berbeda (client_id lain) tetap ditambahkan")
    r = await up("T1", foto=object(), client_id=None)
    ok(len(r["handover"]["bastk"]) == 3 and "client_id" not in r["handover"]["bastk"][2], "klien lama tanpa client_id tetap berfungsi")
    for i in range(3): await up("T1", foto=object(), client_id="m%d" % i)
    try:
        await up("T1", foto=object(), client_id="k-baru"); ok(False, "lembar ke-7 harus ditolak")
    except _HTTP as e:
        ok(e.status_code == 400, "batas 6 lembar tetap berlaku")
    r = await up("T1", foto=object(), client_id="k1")
    ok(len(r["handover"]["bastk"]) == 6, "kiriman ulang saat sudah penuh tetap sukses (bukan error)")


async def main():
    for t in (test_leg_supplier, test_bastk_upload_idempotent, test_daily_upload_idempotent, test_ship_master, test_sync_single_unit_vehicle, test_edit_invoice_lines, test_selisih_ringkasan_auth, test_riwayat_clear, test_imports_exclude_compact, test_pisah_faktur, test_tembak_semua, test_rekon_other_payments, test_vendor_pay_rute_override, test_tembak_rekon_ke_unit_terpilih, test_vendor_trip_search_fast, test_smart_allocation_and_restore, test_vendor_pin_embedded, test_auto_refresh_cycle, test_trace_probe_dedupe_sat, test_invoice_payments, test_ingest_basic, test_idempotent, test_idempotency_key_only,
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
