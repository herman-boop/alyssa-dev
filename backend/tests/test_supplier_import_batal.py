"""Pembatalan batch impor: preview dampak, diblokir bila ada pembayaran/alokasi/perubahan, jejak audit, pembatalan ulang aman."""
import os, sys, asyncio, copy
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_batal")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server
from test_supplier_import import kasus_rows, TAG


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop()
    run = loop.run_until_complete
    lama = {"id": "lama1", "project_id": "p1", "nopol": "B 9 LAMA", "asal_kota": "A", "tujuan_kota": "B", "total_harga": 777_000, "tanggal": "2026-05-01",
            "payments": [{"id": "pl", "amount": 100_000, "tanggal": "2026-05-02", "tipe": "transfer"}]}
    run(db.supplier_profiles.insert_one({"id": "s1", "nama": "AHMAD TAUFDIQ", "projects": [{"id": "p1", "nama": "Projek 1", "status": "open"}], "jobs": [lama],
                                         "rekon_payments": [{"id": "r1", "amount": 5_000_000, "tanggal": "2026-07-05", "status": "active", "allocations": []}]}))
    yield TestClient(server.app), db, run


def sup(db, run):
    return run(db.supplier_profiles.find_one({"id": "s1"}, {"_id": 0}))


def impor(c, key="b1", total=True):
    b = {"key": key, "tag": TAG, "rows": kasus_rows(), "source": {"nama": "inv.pdf", "ukuran": 1, "sha256": "e" * 64}}
    if total:
        b["total_invoice"] = 45_600_000
    r = c.post("/api/admin/suppliers/s1/import-invoice", json=b)
    assert r.status_code == 200, r.text
    return r.json()


def batal(c, key="b1", **kw):
    b = {"konfirmasi": True, "alasan": "Salah supplier, invoice milik pihak lain"}; b.update(kw)
    return c.post(f"/api/admin/suppliers/s1/import-riwayat/{key}/batalkan", json=b)


def test_preview_dampak_dan_pembatalan_bersih(env):
    c, db, run = env
    impor(c)
    awal = sup(db, run)
    pv = c.get("/api/admin/suppliers/s1/import-riwayat/b1/batal-preview").json()
    assert pv["boleh"] is True and pv["dampak"] == {"jumlah_unit": 10, "total_tagihan": 45_600_000} and pv["blokir"] == []
    assert sup(db, run) == awal                                      # preview tidak mengubah apa pun
    r = batal(c)
    assert r.status_code == 200 and r.json()["jumlah_unit_dihapus"] == 10 and r.json()["total_tagihan_berkurang"] == 45_600_000
    d = sup(db, run)
    assert [j["id"] for j in d["jobs"]] == ["lama1"] and d["jobs"][0]["payments"] == awal["jobs"][0]["payments"]   # unit & pembayaran lama utuh
    assert d["rekon_payments"] == awal["rekon_payments"]
    e = d["import_riwayat"][0]
    assert e["status"] == "dibatalkan" and e["dibatalkan"]["oleh"] and "Salah supplier" in e["dibatalkan"]["alasan"]
    au = d["import_dibatalkan"][0]                                   # jejak audit: salinan lengkap unit yang dibatalkan
    assert au["jumlah_unit"] == 10 and len(au["unit_dibatalkan"]) == 10 and au["alasan"] and au["oleh"] and au["batch_no"] == e["batch_no"]
    assert {u["nopol"] or u["no_rangka"] for u in au["unit_dibatalkan"]} >= {"S 8625 HN", "121252"}


def test_pembatalan_ulang_tidak_berbuat_apa_apa(env):
    c, db, run = env
    impor(c)
    assert batal(c).status_code == 200
    setelah = sup(db, run)
    r = batal(c)
    assert r.status_code == 200 and r.json()["sudah_dibatalkan"] is True
    assert sup(db, run) == setelah and len(setelah["import_dibatalkan"]) == 1
    assert c.get("/api/admin/suppliers/s1/import-riwayat/b1/batal-preview").json()["sudah_dibatalkan"] is True


def test_diblokir_bila_unit_sudah_ada_pembayaran(env):
    c, db, run = env
    j = impor(c)
    jid = j["job_ids"][2]
    assert c.post(f"/api/admin/suppliers/s1/jobs/{jid}/payments", data={"amount": "1000000", "tanggal": "2026-07-10", "tipe": "transfer"}).status_code == 200
    awal = sup(db, run)
    pv = c.get("/api/admin/suppliers/s1/import-riwayat/b1/batal-preview").json()
    assert pv["boleh"] is False and len(pv["blokir"]) == 1 and "pembayaran" in pv["blokir"][0]["alasan"][0]
    r = batal(c)
    assert r.status_code == 409 and "diblokir" in r.json()["detail"]["pesan"]
    d = sup(db, run)
    assert len(d["jobs"]) == 11 and d["jobs"] == awal["jobs"] and d["import_riwayat"][0]["status"] == "berhasil" and not d.get("import_dibatalkan")


def test_diblokir_bila_ada_alokasi_transfer_ke_unit(env):
    c, db, run = env
    j = impor(c)
    run(db.supplier_profiles.update_one({"id": "s1", "rekon_payments.id": "r1"}, {"$set": {"rekon_payments.$.allocations": [{"job_id": j["job_ids"][0], "amount": 1_000_000}]}}))
    pv = c.get("/api/admin/suppliers/s1/import-riwayat/b1/batal-preview").json()
    assert pv["boleh"] is False and "alokasi" in pv["blokir"][0]["alasan"][0]
    assert batal(c).status_code == 409 and len(sup(db, run)["jobs"]) == 11


def test_diblokir_bila_nominal_diubah_setelah_impor(env):
    c, db, run = env
    j = impor(c)
    assert c.post(f"/api/admin/suppliers/s1/jobs/{j['job_ids'][0]}/tambahan", json={"label": "Tol", "amount": 5000}).status_code == 200
    pv = c.get("/api/admin/suppliers/s1/import-riwayat/b1/batal-preview").json()
    assert pv["boleh"] is False and "diubah setelah impor" in pv["blokir"][0]["alasan"][0]
    assert batal(c).status_code == 409


def test_wajib_konfirmasi_dan_alasan(env):
    c, db, run = env
    impor(c)
    assert c.post("/api/admin/suppliers/s1/import-riwayat/b1/batalkan", json={"alasan": "salah"}).status_code == 400
    assert c.post("/api/admin/suppliers/s1/import-riwayat/b1/batalkan", json={"konfirmasi": True, "alasan": "x"}).status_code == 400
    assert c.post("/api/admin/suppliers/s1/import-riwayat/nope/batalkan", json={"konfirmasi": True, "alasan": "alasan cukup"}).status_code == 404
    assert len(sup(db, run)["jobs"]) == 11


def test_batch_lain_tidak_tersentuh_dan_impor_ulang_dengan_kunci_baru_boleh(env):
    c, db, run = env
    impor(c, "b1")
    rows = [{"nopol": "Z 1 QQ", "vehicle_type": "T", "asal_kota": "A", "tujuan_kota": "B", "harga_dasar": 10}]
    assert c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "b2", "rows": rows, "source": {"sha256": "f" * 64}}).status_code == 200
    assert batal(c, "b1").status_code == 200
    d = sup(db, run)
    assert sorted(j["id"] for j in d["jobs"] if j.get("import_id") == "b2") and len(d["jobs"]) == 2    # b2 + unit lama
    # kunci lama yang sudah dibatalkan tidak dipakai lagi (tidak menghidupkan batch yang dibatalkan)
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "b1", "rows": kasus_rows(), "source": {"sha256": "9" * 64}})
    assert r.status_code == 409 and "sudah dibatalkan" in r.json()["detail"]
    assert len(sup(db, run)["jobs"]) == 2
    # impor ulang invoice yang sama (file sama) dengan kunci BARU sesudah dibatalkan: boleh
    r = c.post("/api/admin/suppliers/s1/import-invoice", json={"key": "b3", "rows": kasus_rows(), "source": {"sha256": "e" * 64}})
    assert r.status_code == 200 and r.json()["jumlah_unit"] == 10 and len(sup(db, run)["jobs"]) == 12


def test_pembatalan_berbenturan_dengan_pembayaran_baru_tidak_menghapus_unit_berbayar(env, monkeypatch):
    """Pembayaran masuk setelah preview: pembatalan harus membaca ulang & diblokir (CAS), bukan menghapus unit berbayar."""
    c, db, run = env
    j = impor(c)
    asli = server.SI.batal_preview
    n = {"i": 0}

    def preview_basi(doc, key):             # panggilan pertama dikira bersih, padahal pembayaran masuk lalu
        n["i"] += 1
        r = asli(doc, key)
        if n["i"] == 1:
            c.post(f"/api/admin/suppliers/s1/jobs/{j['job_ids'][1]}/payments", data={"amount": "1", "tanggal": "2026-07-10", "tipe": "transfer"})
        return r
    monkeypatch.setattr(server.SI, "batal_preview", preview_basi)
    r = batal(c)
    assert r.status_code == 409, r.text
    d = sup(db, run)
    assert len(d["jobs"]) == 11 and next(x for x in d["jobs"] if x["id"] == j["job_ids"][1])["payments"][0]["amount"] == 1
