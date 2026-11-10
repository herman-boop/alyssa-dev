"""Hapus permanen pembayaran lama yang sudah lunas: pagar keselamatan, dampak, jejak arsip, tidak menyentuh data lain."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_hapus")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server

URL = "/api/admin/suppliers/s1/selesai/hapus-permanen"


def job(i, harga, payments=None, nopol=None):
    return {"id": i, "nopol": nopol or i.upper(), "asal_kota": "A", "tujuan_kota": "B", "total_harga": harga, "tanggal": "2026-03-01", "payments": payments or []}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    jobs = [
        job("u1", 4_750_000),                                                                   # lunas lewat rekon r1
        job("u2", 2_000_000, [{"id": "m1", "batch_id": "b1", "amount": 2_000_000, "tanggal": "2026-04-10"}]),   # lunas manual
        job("u3", 3_000_000),                                                                   # lunas, dibayar DUA rekon (r2+r3)
        job("u4", 9_000_000),                                                                   # BELUM lunas (rekon baru Juli)
        job("u5", 1_000_000, [{"id": "m5", "batch_id": "b5", "amount": 1_000_000, "tanggal": "2026-08-01"}]),   # lunas, bayar Agustus
    ]
    rk = [
        {"id": "r1", "amount": 4_750_000, "tanggal": "2026-01-27", "status": "active", "allocations": [{"job_id": "u1", "amount": 4_750_000}]},
        {"id": "r2", "amount": 1_000_000, "tanggal": "2026-02-01", "status": "active", "allocations": [{"job_id": "u3", "amount": 1_000_000}]},
        {"id": "r3", "amount": 2_000_000, "tanggal": "2026-02-02", "status": "active", "allocations": [{"job_id": "u3", "amount": 2_000_000}]},
        {"id": "r4", "amount": 5_000_000, "tanggal": "2026-07-03", "status": "active", "allocations": [{"job_id": "u4", "amount": 5_000_000}]},
        {"id": "r5", "amount": 777, "tanggal": "2026-01-02", "status": "reversed", "allocations": [{"job_id": "u1", "amount": 777}]},
    ]
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "AHMAD TAUFDIQ", "jobs": jobs, "rekon_payments": rk,
                                         "riwayat_clear": [{"key": "rk:r1", "status": "cleared"}], "selesai_sembunyi": [{"job_id": "u1"}, {"job_id": "u5"}]}))
    yield TestClient(server.app), db, run


def sup(db, run):
    return run(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def hapus(c, keys, **kw):
    b = {"keys": keys, "sampai": "2026-06-30"}; b.update(kw)
    return c.post(URL, json=b)


def test_dry_run_tidak_mengubah_apa_pun_dan_menghitung_dampak(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    r = hapus(c, ["rk:r1", "tx:b1"], dry_run=True)
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.json()["dampak"] == {"jumlah_unit": 2, "total_tagihan_unit": 6_750_000, "pembayaran_rekon": 1, "total_rekon": 4_750_000, "pembayaran_manual": 1, "total_manual": 2_000_000}
    assert sup(db, run) == awal


def test_hapus_bersih_unit_dan_pembayaran_lain_utuh_plus_arsip(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    r = hapus(c, ["rk:r1", "tx:b1", "rk:r2", "rk:r3"], konfirmasi="HAPUS")
    assert r.status_code == 200, r.text
    d = sup(db, run)
    assert [j["id"] for j in d["jobs"]] == ["u4", "u5"]                       # u1,u2,u3 hilang; u4,u5 utuh
    assert d["jobs"] == [j for j in awal["jobs"] if j["id"] in ("u4", "u5")]
    assert [x["id"] for x in d["rekon_payments"]] == ["r4", "r5"]            # rekon baru & reversed tidak tersentuh
    assert d["riwayat_clear"] == [] and d["selesai_sembunyi"] == [{"job_id": "u5"}]
    ar = run(db.supplier_hapus_arsip.find_one({"id": r.json()["arsip_id"]}, {"_id": 0}))
    assert {u["id"] for u in ar["unit_dihapus"]} == {"u1", "u2", "u3"} and {x["id"] for x in ar["rekon_dihapus"]} == {"r1", "r2", "r3"}


def test_tanpa_konfirmasi_ditolak_dan_data_utuh(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    assert hapus(c, ["rk:r1"]).status_code == 400
    assert hapus(c, ["rk:r1"], konfirmasi="hapus").status_code == 400
    assert sup(db, run) == awal and run(db.supplier_hapus_arsip.count_documents({})) == 0


def test_unit_dibayar_dua_pembayaran_diblokir_bila_hanya_satu_dipilih(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    r = hapus(c, ["rk:r2"], konfirmasi="HAPUS")
    assert r.status_code == 409 and "pembayaran lain" in r.text and "rk:r3" in r.text
    assert sup(db, run) == awal


def test_pembayaran_melewati_batas_tanggal_diblokir(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    r = hapus(c, ["tx:b5"], konfirmasi="HAPUS")                                # Agustus > 30 Juni
    assert r.status_code == 409 and "melewati batas" in r.text
    assert sup(db, run) == awal


def test_unit_belum_lunas_diblokir(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    r = hapus(c, ["rk:r4"], konfirmasi="HAPUS", sampai="2026-12-31")
    assert r.status_code == 409 and "belum lunas" in r.text
    assert sup(db, run) == awal


def test_batas_tanggal_wajib_dan_kunci_tidak_dikenal(env):
    c, db, run = env
    awal = copy.deepcopy(sup(db, run))
    assert c.post(URL, json={"keys": ["rk:r1"], "konfirmasi": "HAPUS"}).status_code == 409
    assert hapus(c, ["rk:nope"], konfirmasi="HAPUS").status_code == 409
    assert hapus(c, ["rk:r5"], konfirmasi="HAPUS").status_code == 409         # reversed tidak boleh dihapus lewat jalur ini
    assert sup(db, run) == awal


def test_ulang_setelah_terhapus_tidak_menghapus_lagi(env):
    c, db, run = env
    assert hapus(c, ["rk:r1"], konfirmasi="HAPUS").status_code == 200
    ada = sup(db, run)
    assert hapus(c, ["rk:r1"], konfirmasi="HAPUS").status_code == 409
    assert sup(db, run) == ada
