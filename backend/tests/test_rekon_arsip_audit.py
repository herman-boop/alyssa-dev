"""Arsip supplier (soft delete), log audit append-only, alokasi yatim, deteksi 'Perlu Rekonsiliasi'. Semua BACA/ARSIP, tanpa hapus pembayaran."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_arsip")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server, rekon_orphans, supplier_audit


def _sup(sid="S1", nama="AHMAD TAUFDIQ", jobs=None, rekon=None, **kw):
    return {"id": sid, "nama": nama, "jobs": jobs if jobs is not None else [], "rekon_payments": rekon or [], **kw}


def _job(jid, total=1_000_000, **kw):
    return {"id": jid, "total_harga": total, "payments": [], "nopol": "B1" + jid, "asal_kota": "JKT", "tujuan_kota": "MDN", **kw}


def _rp(pid, btid, amount=10_000_000, allocs=None, **kw):
    return {"id": pid, "bank_transaction_id": btid, "amount": amount, "tanggal": "2026-10-01", "status": "active",
            "allocations": allocs or [], "source": "rekon-bank", **kw}


def _imp(btid, sid="S1", pid="P1", amount=10_000_000, status="processed", **kw):
    return {"bank_transaction_id": btid, "idempotency_key": btid, "status": status, "supplier_id": sid, "rekon_payment_id": pid,
            "amount": amount, "tanggal": "2026-10-01", "supplier_name": "AHMAD TAUFDIQ", "source": "rekon-bank", **kw}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    yield TestClient(server.app), db, run
    loop.close()


def _snap(db, run):
    return {c: run(db[c].find({}, {"_id": 0}).to_list(1000)) for c in ("supplier_profiles", "bank_payment_imports")}


# ── arsip supplier ───────────────────────────────────────────────────────────

def test_hapus_supplier_dengan_pembayaran_diarsipkan_bukan_dihapus(env):
    c, db, run = env
    sup = _sup(jobs=[_job("J1")], rekon=[_rp("P1", "B1", allocs=[{"job_id": "J1", "amount": 1_000_000}])])
    run(db.supplier_profiles.insert_one(copy.deepcopy(sup)))
    run(db.bank_payment_imports.insert_one(_imp("B1")))
    r = c.delete("/api/admin/suppliers/S1", params={"alasan": "bikin ulang rekap"})
    assert r.status_code == 200 and r.json()["arsip"] is True
    d = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    assert d["status"] == "archived" and d["archive_reason"] == "bikin ulang rekap"
    assert d["jobs"] == sup["jobs"] and d["rekon_payments"] == sup["rekon_payments"]      # semua utuh
    assert run(db.bank_payment_imports.find_one({"bank_transaction_id": "B1"}, {"_id": 0}))["status"] == "processed"
    log = run(db.supplier_audit_log.find({"action": "supplier.archive"}, {"_id": 0}).to_list(10))
    assert len(log) == 1 and log[0]["supplier_id"] == "S1" and log[0]["reason"] == "bikin ulang rekap" and log[0]["extra"]["jumlah_rekon"] == 1
    # tidak tampil di daftar aktif, tampil di daftar arsip
    assert [x["id"] for x in c.get("/api/admin/suppliers").json()["items"]] == []
    assert [x["id"] for x in c.get("/api/admin/suppliers", params={"arsip": "true"}).json()["items"]] == ["S1"]


def test_supplier_tanpa_riwayat_pembayaran_dihapus_dan_snapshot_ke_audit(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(_sup("S2", "KOSONG", jobs=[_job("J9")])))
    r = c.delete("/api/admin/suppliers/S2")
    assert r.status_code == 200 and r.json()["arsip"] is False
    assert run(db.supplier_profiles.find_one({"id": "S2"})) is None
    log = run(db.supplier_audit_log.find_one({"action": "supplier.delete"}, {"_id": 0}))
    assert log["before"]["jobs"][0]["id"] == "J9"            # snapshot lengkap bisa dipulihkan
    assert c.delete("/api/admin/suppliers/NOPE").status_code == 404


def test_supplier_dengan_baris_impor_bank_saja_tetap_diarsipkan(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(_sup("S3", "TANPA PAY")))
    run(db.bank_payment_imports.insert_one(_imp("B3", sid="S3", pid="PX")))
    assert c.delete("/api/admin/suppliers/S3").json()["arsip"] is True
    assert run(db.supplier_profiles.find_one({"id": "S3"}))["status"] == "archived"


def test_pulihkan_dan_nama_sama_setelah_arsip_membuat_profil_baru(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(_sup(rekon=[_rp("P1", "B1")])))
    c.delete("/api/admin/suppliers/S1")
    baru = c.post("/api/admin/suppliers", json={"nama": "ahmad taufdiq"}).json()
    assert baru["id"] != "S1" and baru.get("status") != "archived"       # profil kembar baru, yang lama tetap arsip
    assert c.post("/api/admin/suppliers/S1/pulihkan").status_code == 200
    d = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    assert "status" not in d and d["rekon_payments"][0]["id"] == "P1"
    assert c.post("/api/admin/suppliers/S1/pulihkan").status_code == 400            # sudah aktif
    assert run(db.supplier_audit_log.count_documents({"action": "supplier.restore"})) == 1


# ── hapus unit / pembayaran manual: jejak audit ─────────────────────────────

def test_hapus_unit_menyimpan_snapshot_dan_melaporkan_alokasi_tertinggal(env):
    c, db, run = env
    j = _job("J1", payments=[{"id": "m1", "amount": 300_000, "tanggal": "2026-10-02"}])
    run(db.supplier_profiles.insert_one(_sup(jobs=[j, _job("J2")], rekon=[_rp("P1", "B1", allocs=[{"job_id": "J1", "amount": 1_000_000}])])))
    r = c.delete("/api/admin/suppliers/S1/jobs/J1", params={"alasan": "impor ulang"})
    assert r.status_code == 200 and r.json()["alokasi_rekon_tertinggal"][0]["bank_transaction_id"] == "B1"
    log = run(db.supplier_audit_log.find_one({"action": "job.delete"}, {"_id": 0}))
    assert log["job_id"] == "J1" and log["before"]["payments"][0]["amount"] == 300_000 and log["reason"] == "impor ulang"
    # pembayaran bank (rekon) tidak tersentuh
    assert run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))["rekon_payments"][0]["allocations"][0]["job_id"] == "J1"
    assert c.delete("/api/admin/suppliers/S1/jobs/ZZ").status_code == 404


def test_hapus_pembayaran_manual_menyimpan_snapshot(env):
    c, db, run = env
    j = _job("J1", payments=[{"id": "m1", "amount": 300_000, "batch_id": "T1"}, {"id": "m2", "amount": 200_000, "batch_id": "T1"}])
    run(db.supplier_profiles.insert_one(_sup(jobs=[j])))
    assert c.delete("/api/admin/suppliers/S1/payments/T1", params={"alasan": "salah tanggal"}).status_code == 200
    log = run(db.supplier_audit_log.find_one({"action": "payment.delete"}, {"_id": 0}))
    assert sorted(p["amount"] for p in log["before"]) == [200_000, 300_000] and log["extra"]["jumlah_baris"] == 2
    j2 = _job("J2", payments=[{"id": "m9", "amount": 50_000}])
    run(db.supplier_profiles.update_one({"id": "S1"}, {"$push": {"jobs": j2}}))
    assert c.delete("/api/admin/suppliers/S1/jobs/J2/payments/m9").status_code == 200
    assert run(db.supplier_audit_log.count_documents({"action": "payment.delete"})) == 2


def test_log_audit_append_only_tidak_ada_jalur_hapus(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(_sup(rekon=[_rp("P1", "B1")])))
    c.delete("/api/admin/suppliers/S1")
    items = c.get("/api/admin/supplier-audit", params={"supplier_id": "S1"}).json()["items"]
    assert len(items) == 1 and items[0]["action"] == "supplier.archive"
    entry_id = items[0]["id"]
    for m in ("delete", "put", "patch"):
        assert getattr(c, m)(f"/api/admin/supplier-audit/{entry_id}").status_code in (404, 405)
    assert run(db.supplier_audit_log.count_documents({})) == 1


# ── perhitungan: alokasi yatim tidak menghilangkan uang ─────────────────────

def test_alokasi_ke_unit_yang_dihapus_masuk_belum_dialokasikan(env):
    c, db, run = env
    sup = _sup(jobs=[_job("J1"), _job("J2")], rekon=[_rp("P1", "B1", amount=1_500_000, allocs=[{"job_id": "J1", "amount": 1_000_000}, {"job_id": "J2", "amount": 500_000}])])
    ov = server._supplier_rekon_overview(sup)
    assert ov["total_rekon"] == 1_500_000 and ov["total_rekon_allocated"] == 1_500_000 and ov["total_unallocated"] == 0 and ov["total_alokasi_yatim"] == 0
    assert ov["rekon_payments"][0]["link_status"] == "tertaut"
    sup["jobs"] = [_job("J2")]                                   # J1 dihapus / impor ulang
    ov = server._supplier_rekon_overview(sup)
    assert ov["alloc_by_job"] == {"J2": 500_000}
    assert ov["total_rekon_allocated"] == 500_000 and ov["total_unallocated"] == 1_000_000     # tidak lagi 'hilang'
    assert ov["total_alokasi_yatim"] == 1_000_000
    p = ov["rekon_payments"][0]
    assert p["alokasi_yatim"] == 1_000_000 and p["unallocated"] == 1_000_000 and p["link_status"] == "perlu_hubungkan_ulang"


def test_angka_tanpa_yatim_sama_persis_dengan_sebelumnya(env):
    sup = _sup(jobs=[_job("J1"), _job("J2")], rekon=[_rp("P1", "B1", amount=2_000_000, allocs=[{"job_id": "J1", "amount": 700_000}]),
                                                      _rp("P2", "B2", amount=500_000, status="reversed", allocs=[{"job_id": "J2", "amount": 500_000}]),
                                                      _rp("P3", "B3", amount=300_000)])
    ov = server._supplier_rekon_overview(sup)
    assert (ov["total_rekon"], ov["total_rekon_allocated"], ov["total_unallocated"], ov["alloc_by_job"]) == (2_300_000, 700_000, 1_600_000, {"J1": 700_000})
    assert [p["alloc_status"] for p in ov["rekon_payments"]] == ["partial", "unallocated"]


# ── deteksi Perlu Rekonsiliasi (baca-saja) ──────────────────────────────────

def test_perlu_rekonsiliasi_semua_kelas_dan_tidak_menulis(env):
    c, db, run = env
    # supplier S1: ada, pembayaran P1 beralokasi ke unit yang sudah dihapus (J-LAMA), P3 belum dialokasikan & tersembunyi
    run(db.supplier_profiles.insert_one(_sup("S1", jobs=[_job("J2")], riwayat_clear=[{"key": "rk:P3", "status": "cleared"}],
        rekon=[_rp("P1", "B1", allocs=[{"job_id": "J-LAMA", "amount": 10_000_000}]), _rp("P3", "B3", amount=5_000_000)])))
    run(db.supplier_profiles.insert_one(_sup("S9", "ARSIP", status="archived", rekon=[_rp("P9", "B9")])))
    run(db.bank_payment_imports.insert_many([
        _imp("B1", pid="P1"), _imp("B3", pid="P3", amount=5_000_000),
        _imp("B2", sid="0c2408c0", pid="P2", amount=10_000_000, supplier_name="AHMAD TAUFDIQ"),          # supplier dihapus
        _imp("B4", sid="S1", pid="PX", amount=2_000_000),                                                  # pembayaran tidak ada di profil
        _imp("B9", sid="S9", pid="P9"), _imp("B5", status="reversed"), _imp("B6", status="supplier_not_found")]))
    run(db.supplier_audit_log.insert_one({"id": "a1", "action": "job.delete", "supplier_id": "S1", "job_id": "J-LAMA",
                                          "before": {"id": "J-LAMA", "no_invoice_supplier": "INV-77", "nopol": "B1234XYZ", "asal_kota": "JKT", "tujuan_kota": "MDN", "total_harga": 10_000_000}}))
    before = _snap(db, run)
    r = c.get("/api/admin/rekon/perlu-rekonsiliasi").json()
    kelas = {x["bank_transaction_id"]: x["kelas"] for x in r["items"]}
    assert kelas == {"B1": "alokasi_yatim", "B2": "supplier_hilang", "B4": "pembayaran_hilang"}
    assert r["ringkasan"]["perlu_tindakan"] == 3 and r["ringkasan"]["nominal"] == 22_000_000
    b1 = next(x for x in r["items"] if x["bank_transaction_id"] == "B1")
    assert b1["ref_dokumen_lama"][0]["no_invoice"] == "INV-77" and b1["ref_dokumen_lama"][0]["alokasi"] == 10_000_000
    assert b1["nominal"] == 10_000_000 and b1["tanggal"] == "2026-10-01" and b1["supplier_nama_lama"] == "AHMAD TAUFDIQ" and b1["link_status"] == "perlu_hubungkan_ulang"
    semua = {x["bank_transaction_id"]: x["kelas"] for x in c.get("/api/admin/rekon/perlu-rekonsiliasi", params={"semua": "true"}).json()["items"]}
    assert semua["B3"] == "belum_dialokasikan" and semua["B9"] == "supplier_diarsipkan" and "B5" not in semua and "B6" not in semua
    assert _snap(db, run) == before                                         # BACA-SAJA
    only = c.get("/api/admin/rekon/perlu-rekonsiliasi", params={"supplier_id": "0c2408c0"}).json()["items"]
    assert [x["bank_transaction_id"] for x in only] == ["B2"]


def test_agregat_dan_dupe_tidak_menghitung_supplier_arsip(env):
    c, db, run = env
    lunas = _job("J1", no_invoice_supplier="INV-1", payments=[{"id": "m1", "amount": 1_000_000}])
    run(db.supplier_profiles.insert_one(_sup("S1", jobs=[lunas], rekon=[_rp("P1", "B1")])))
    run(db.supplier_profiles.insert_one(_sup("S2", "BARU")))
    assert {x["job_id"] for x in c.get("/api/admin/suppliers/pricelist").json()["items"]} == {"J1"}      # kontrol: aktif -> ikut
    assert run(server._invoice_dipakai_supplier_lain("S2")) == {"INV-1"} or run(server._invoice_dipakai_supplier_lain("S2")) is not None
    c.delete("/api/admin/suppliers/S1")                                                                    # S1 punya pembayaran -> arsip
    assert c.get("/api/admin/suppliers/pricelist").json()["items"] == []
    assert run(server._invoice_dipakai_supplier_lain("S2")) == set()
