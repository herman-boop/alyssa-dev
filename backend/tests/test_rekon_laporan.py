"""Laporan rekonsiliasi bank <-> tagihan per supplier (BACA-SAJA): kasus 'tiga transaksi tersembunyi' vs salinan, profil kembar, yatim."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_lap")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server

M = 1_000_000


def job(jid, total, **kw):
    return {"id": jid, "total_harga": total, "payments": [], "nopol": "B" + jid, "asal_kota": "JKT", "tujuan_kota": "MDN", **kw}


def rp(pid, btid, amount, allocs=None, **kw):
    return {"id": pid, "bank_transaction_id": btid, "amount": amount, "tanggal": "2026-10-01", "status": "active", "allocations": allocs or [], **kw}


def imp(btid, sid, pid, amount, tanggal="2026-10-01", ref="", status="processed", **kw):
    return {"bank_transaction_id": btid, "idempotency_key": btid, "status": status, "supplier_id": sid, "rekon_payment_id": pid, "amount": amount * M if amount < 10_000 else amount,
            "nominal": amount * M if amount < 10_000 else amount, "tanggal": tanggal, "referensi_bank": ref, "source_account_number": "123", "supplier_name": "AHMAD TAUFDIQ", **kw}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    yield TestClient(server.app), db, run
    loop.close()


def snap(db, run):
    return {c: run(db[c].find({}, {"_id": 0}).to_list(1000)) for c in ("supplier_profiles", "bank_payment_imports", "supplier_audit_log")}


def seed(run, db):
    run(db.supplier_profiles.insert_one({
        "id": "S-AKTIF", "nama": "AHMAD TAUFDIQ", "jobs": [job("J1", 10 * M), job("J2", 10 * M), job("J3", 5 * M)],
        "riwayat_clear": [{"key": "rk:P3", "status": "cleared"}],
        "rekon_payments": [rp("P1", "B1", 10 * M, [{"job_id": "J1", "amount": 10 * M}]), rp("P2", "B2", 5 * M), rp("P3", "B3", 10 * M)]}))
    run(db.supplier_profiles.insert_one({"id": "S-ARSIP", "nama": "Ahmad Taufdiq", "status": "archived", "jobs": [job("JA", 3 * M)], "rekon_payments": [rp("PA", "B5", 2 * M)]}))
    run(db.bank_payment_imports.insert_many([
        imp("B1", "S-AKTIF", "P1", 10, ref="0110/FTSCY/WS95"), imp("B2", "S-AKTIF", "P2", 5, tanggal="2026-10-05", ref="R2"),
        imp("B3", "S-AKTIF", "P3", 10, ref=""),                                           # salinan B1 (tersembunyi di Clear)
        imp("B4", "S-LAMA", "P4", 3, tanggal="2026-10-07"),                                # supplier dihapus -> yatim
        imp("B5", "S-ARSIP", "PA", 2, tanggal="2026-10-08", ref="R5"),
        imp("B6", "S-AKTIF", "P6", 7, status="reversed")]))


def test_laporan_memisahkan_salinan_tersembunyi_dari_pembayaran_sah_dan_baca_saja(env):
    c, db, run = env
    seed(run, db)
    before = snap(db, run)
    r = c.get("/api/admin/rekon/rekonsiliasi-supplier", params={"nama": "ahmad taufdiq"}).json()
    assert snap(db, run) == before                                                                       # BACA-SAJA
    prof = {p["id"]: p for p in r["profil"]}
    assert prof["S-AKTIF"]["aktif"] and not prof["S-ARSIP"]["aktif"] and prof["S-ARSIP"]["status"] == "archived"
    a = prof["S-AKTIF"]
    assert (a["total_invoice"], a["net_transfer"], a["terbayar"], a["sisa"], a["belum_lunas"]) == (25 * M, 25 * M, 10 * M, 15 * M, 2)
    assert a["rekon_aktif"]["nominal"] == 25 * M and a["rekon_aktif"]["teralokasi"] == 10 * M and a["rekon_aktif"]["belum_dialokasikan"] == 15 * M
    assert a["tersembunyi"] == {"jumlah": 1, "nominal": 10 * M}
    tx = {t["bank_transaction_id"]: t for t in r["transaksi"]}
    assert set(tx) == {"B1", "B2", "B3", "B4", "B5", "B6"}
    assert tx["B3"]["tersembunyi"] and tx["B3"]["salinan_dari"] == "B1" and tx["B1"]["salinan_dari"] is None and tx["B1"]["alokasi_sah"] == 10 * M
    assert tx["B3"]["kemungkinan_salinan"][0]["dengan"] == "B1" and tx["B3"]["kemungkinan_salinan"][0]["tingkat"] == "perlu_verifikasi"
    assert tx["B4"]["kelas"] == "supplier_hilang" and tx["B4"]["supplier_ada"] is False and tx["B5"]["kelas"] == "supplier_diarsipkan" and tx["B6"]["kelas"] == "dibatalkan"
    assert r["pasangan_duplikat"][0]["diduga_salinan"] == "B3" and r["pasangan_duplikat"][0]["diduga_asli"] == "B1"
    s = r["ringkasan"]
    assert s["bank"] == {"jumlah": 5, "nominal": 30 * M}                                                 # B6 reversed tidak dihitung
    assert s["tersembunyi"]["jumlah"] == 1 and s["tersembunyi"]["salinan_terdeteksi"] == {"jumlah": 1, "nominal": 10 * M}
    assert s["salinan_terdeteksi"] == {"jumlah": 1, "nominal": 10 * M} and s["bank_tanpa_salinan_perkiraan"] == 20 * M
    assert s["tagihan_aktif"]["net_transfer"] == 25 * M and s["tagihan_aktif"]["unit"] == 3                # profil arsip tidak masuk tagihan aktif
    assert s["selisih"]["bank_kasar_vs_net_transfer"] == 5 * M and s["selisih"]["bank_tanpa_salinan_vs_net_transfer"] == -5 * M
    assert s["selisih"]["teralokasi_ke_tagihan_aktif"] == 10 * M                                           # tidak mengasumsikan semua teralokasi
    assert any("1 transaksi tersembunyi" in x and "1 terdeteksi" in x for x in s["catatan"]) and any("terputus" in x for x in s["catatan"])


def test_tersembunyi_tanpa_pasangan_tetap_dihitung_dan_pasangan_tak_tentu_dicatat(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one({"id": "S1", "nama": "BUDI", "jobs": [job("J1", 9 * M)], "riwayat_clear": [{"key": "rk:PX", "status": "cleared"}],
                                          "rekon_payments": [rp("PX", "BX", 4 * M), rp("PA", "BA", 6 * M), rp("PB", "BB", 6 * M)]}))
    run(db.bank_payment_imports.insert_many([imp("BX", "S1", "PX", 4, tanggal="2026-09-01", supplier_name="BUDI"),
                                             imp("BA", "S1", "PA", 6, tanggal="2026-09-02", supplier_name="BUDI"), imp("BB", "S1", "PB", 6, tanggal="2026-09-02", supplier_name="BUDI")]))
    r = c.get("/api/admin/rekon/rekonsiliasi-supplier", params={"supplier_ids": "S1"}).json()
    s = r["ringkasan"]
    assert s["tersembunyi"] == {"jumlah": 1, "nominal": 4 * M, "salinan_terdeteksi": {"jumlah": 0, "nominal": 0}}
    assert s["salinan_terdeteksi"]["jumlah"] == 0 and s["bank_tanpa_salinan_perkiraan"] == s["bank"]["nominal"] == 16 * M                  # tidak ada nominal dibuang tanpa bukti
    assert r["pasangan_duplikat"][0]["diduga_salinan"] is None and any("belum bisa ditentukan" in x for x in s["catatan"])
    assert any("tetap dihitung" in x for x in s["catatan"])


def test_validasi_parameter(env):
    c, db, run = env
    assert c.get("/api/admin/rekon/rekonsiliasi-supplier").status_code == 400
    r = c.get("/api/admin/rekon/rekonsiliasi-supplier", params={"nama": "TIDAK ADA"}).json()
    assert r["profil"] == [] and r["transaksi"] == [] and r["ringkasan"]["bank"] == {"jumlah": 0, "nominal": 0}
