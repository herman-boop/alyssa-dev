"""Uji acak (property test): laporan Finance baru harus SELALU konsisten dengan angka existing (get_supplier),
tidak boleh menghilangkan/menggandakan pembayaran, dan membacanya tidak boleh mengubah data."""
import os, sys, copy, random, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_sf_audit")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server

KOTA = ["Cikarang", "Jakarta", "Surabaya", "Makassar", "Lombok", "Manado"]


def rand_supplier(rng, sid):
    jobs = []
    for i in range(rng.randint(1, 14)):
        j = {"id": f"{sid}-j{i}", "nopol": f"B{rng.randint(1000, 9999)}XY", "vehicle_type": "Unit",
             "asal_kota": rng.choice(KOTA), "tujuan_kota": rng.choice(KOTA),
             "total_harga": rng.choice([0, 1_500_000, 2_300_000, 10_000_000, 12_345_000]),
             "tanggal": f"2026-{rng.randint(1, 11):02d}-{rng.randint(1, 28):02d}", "payments": [],
             "tambahan": [{"id": "t", "label": "TOL", "amount": rng.choice([0, 100_000, 3_900])}] if rng.random() < .3 else []}
        if rng.random() < .75:
            j["no_invoice_supplier"] = rng.choice(["INV-1", "inv-1", " INV-2 ", "INV-3/X/2026", "SPL/06"])
        if rng.random() < .25:
            j.update({"ppn_enabled": True, "ppn_rate": 11.0})
        if rng.random() < .2:
            j.update({"pph23_enabled": True, "pph23_rate": 2.0})
        jobs.append(j)
    # pembayaran manual (batch bisa mencakup beberapa unit) + kompensasi
    for b in range(rng.randint(0, 4)):
        bid = f"{sid}-b{b}"; tgl = f"2026-{rng.randint(1, 11):02d}-{rng.randint(1, 28):02d}"
        for j in rng.sample(jobs, rng.randint(1, min(3, len(jobs)))):
            j["payments"].append({"id": f"{bid}-{j['id']}", "amount": rng.choice([500_000, 1_000_000, 2_300_000, 7_777]),
                                  "tanggal": tgl, "tipe": rng.choice(["transfer", "transfer", "transfer", "kompensasi"]),
                                  "batch_id": bid, "no_referensi": f"REF{b}"})
    rps = []
    for r in range(rng.randint(0, 5)):
        amt = rng.choice([1_000_000, 5_000_000, 12_000_000, 6_500])
        allocs, left = [], amt
        for j in rng.sample(jobs, rng.randint(0, min(4, len(jobs)))):
            a = min(left, rng.choice([500_000, 1_000_000, 4_000_000]))
            if a > 0:
                allocs.append({"job_id": j["id"], "amount": a}); left -= a
        fee = amt == 6_500
        rps.append({"id": f"{sid}-r{r}", "amount": amt, "tanggal": f"2026-{rng.randint(1, 11):02d}-{rng.randint(1, 28):02d}",
                    "status": rng.choice(["active", "active", "active", "reversed"]), "bank_transaction_id": f"BTX{sid}{r}",
                    "catatan": "BIF BIAYA TXN KE 002 TRSF" if fee else "TRSF SUPPLIER", "allocations": [] if fee else allocs,
                    "rekon": {"referensi_bank": f"RB{r}"}})
    return {"id": sid, "nama": f"Supplier {sid}", "jobs": jobs, "rekon_payments": rps, "projects": [], "created_at": "2026-01-01"}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    c = TestClient(server.app)
    yield c, db, loop
    loop.close()


def test_acak_300_supplier_konsisten_dengan_existing_dan_tidak_mengubah_data(env):
    c, db, loop = env
    rng = random.Random(20261107)
    docs = [rand_supplier(rng, f"s{i}") for i in range(300)]
    loop.run_until_complete(db.supplier_profiles.insert_many(copy.deepcopy(docs)))
    # supplier lengkap sebelum dibaca laporan (setelah _ensure_supplier_projects dari get_supplier) bisa menulis 'projects'; bandingkan hanya field keuangan
    before = {d["id"]: copy.deepcopy(d) for d in docs}
    r = c.get("/api/admin/finance-audit?limit=2000")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["diperiksa"] == 300
    assert out["ok"], out["detail"][:3]
    for d in docs[:60]:        # tiap endpoint finance dipanggil, hasilnya tidak mengubah data
        assert c.get(f"/api/admin/suppliers/{d['id']}/finance").status_code == 200
    after = {x["id"]: x for x in loop.run_until_complete(db.supplier_profiles.find({}, {"_id": 0}).to_list(None))}
    for sid, b in before.items():
        a = after[sid]
        assert a["rekon_payments"] == b["rekon_payments"], sid
        for jb, ja in zip(b["jobs"], a["jobs"]):
            assert ja["payments"] == jb["payments"] and ja["total_harga"] == jb["total_harga"], sid


def test_audit_menangkap_data_janggal(env):
    c, db, loop = env
    d = rand_supplier(random.Random(1), "bad")
    d["jobs"][0]["id"] = "bad-j0"
    d["rekon_payments"] = [{"id": "x1", "amount": 1_000_000, "tanggal": "2026-10-01", "status": "active", "bank_transaction_id": "B1",
                            "catatan": "TRSF", "allocations": [{"job_id": "bad-j0", "amount": 1_500_000}], "rekon": {}},
                           {"id": "x2", "amount": 6_500, "tanggal": "2026-10-01", "status": "active", "bank_transaction_id": "B2",
                            "catatan": "BIF BIAYA TXN KE 002", "allocations": [{"job_id": "bad-j0", "amount": 6_500}], "rekon": {}}]
    loop.run_until_complete(db.supplier_profiles.insert_one(d))
    out = c.get("/api/admin/finance-audit").json()
    assert not out["ok"]
    teks = " ".join(out["detail"][0]["pelanggaran"])
    assert "alokasi melebihi transfer" in teks and "biaya admin bank ikut dialokasikan" in teks
