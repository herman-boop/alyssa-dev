"""Sidik duplikat transaksi bank ("Perlu Verifikasi"), otorisasi Super Admin / Finance Approver, autentikasi ulang, audit.
Tidak ada penghapusan / penggabungan otomatis; nominal bank tidak pernah berubah."""
import os, sys, asyncio, copy, uuid
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_dup")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server, rekon_dup, rekon_sync, app_users as au

SRC = "1234567890"


def tx(btid, ref="", tanggal="2026-10-01", nominal=10_000_000, sumber=SRC, supplier_id="S1", **kw):
    return {"bank_transaction_id": btid, "idempotency_key": btid, "supplier_id": supplier_id, "supplier_name": "AHMAD TAUFDIQ",
            "source_entity": "PT_ALYSSA_AUTO_LOGISTIK", "source_account_number": sumber, "tanggal": tanggal, "nominal": nominal,
            "referensi_bank": ref, "deskripsi_bank": "TRSF AHMAD TAUFDIQ", "alokasi": [], **kw}


# ── sidik (murni) ────────────────────────────────────────────────────────────

def test_tingkat_kasus_fc5edba6_vs_db9bafcb_perlu_verifikasi():
    a = tx("fc5edba6", ref="0110/FTSCY/WS95001")          # Cetakan Mutasi
    b = tx("db9bafcb", ref="")                            # e-statement tanpa referensi
    assert rekon_dup.tingkat(b, a) == ("perlu_verifikasi", [])
    assert rekon_dup.tingkat(a, b) == ("perlu_verifikasi", [])


def test_tingkat_kuat_hanya_dengan_bukti_identitas():
    assert rekon_dup.tingkat(tx("a", ref="0110/FTSCY/WS95"), tx("b", ref="0110 FTSCY WS95"))[0] == "kuat"          # referensi sama (dinormalisasi)
    assert rekon_dup.tingkat(tx("a", bank_account_number="777", beneficiary_bank_code="BCA"),
                             tx("b", bank_account_number="777", beneficiary_bank_code="BCA"))[0] == "kuat"          # rekening tujuan + bank
    assert rekon_dup.tingkat(tx("a", bank_account_number="777"), tx("b", bank_account_number="777"))[0] == "perlu_verifikasi"   # tanpa kode bank


def test_tingkat_bukan_kandidat():
    base = tx("a", ref="R1")
    assert rekon_dup.tingkat(base, tx("b", ref="R2")) is None                              # referensi jelas beda -> dua transfer
    assert rekon_dup.tingkat(base, tx("b", ref="R1", tanggal="2026-10-02")) is None        # tanggal beda
    assert rekon_dup.tingkat(base, tx("b", ref="R1", nominal=9_000_000)) is None           # nominal beda
    assert rekon_dup.tingkat(base, tx("b", ref="R1", sumber="999")) is None                # rekening sumber beda
    assert rekon_dup.tingkat(base, tx("b", ref="R1", sumber="")) is None                   # sumber tidak diketahui
    assert rekon_dup.tingkat(base, tx("a", ref="R1")) is None                              # transaksi yang sama
    assert rekon_dup.tingkat(tx("a", bank_account_number="1"), tx("b", bank_account_number="2")) is None
    assert rekon_dup.tingkat(tx("a", beneficiary_bank_code="BCA"), tx("b", beneficiary_bank_code="BRI")) is None
    assert rekon_dup.tingkat(tx("a", nominal=0), tx("b", nominal=0)) is None


def test_sidik_bukan_bukti_dan_cari_pasangan():
    imps = [dict(tx("A", ref="X"), status="processed", amount=10_000_000), dict(tx("B", ref=""), status="processed", amount=10_000_000),
            dict(tx("C", ref="Y"), status="processed", amount=10_000_000), dict(tx("D", tanggal="2026-11-01"), status="processed", amount=10_000_000),
            dict(tx("E", ref=""), status="reversed", amount=10_000_000)]
    pairs = {(p["a"], p["b"]): p["tingkat"] for p in rekon_dup.cari_pasangan(imps)}
    assert pairs == {("A", "B"): "perlu_verifikasi", ("B", "C"): "perlu_verifikasi"}      # A-C beda referensi; E dibatalkan; D beda tanggal


# ── ingest: ditahan, tidak dihitung, tidak dihapus ──────────────────────────

@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    from pymongo.errors import DuplicateKeyError as _RealDup       # test_felis_rekon mengganti rekon_sync.DuplicateKeyError secara global
    monkeypatch.setattr(rekon_sync, "DuplicateKeyError", _RealDup)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(rekon_sync.ensure_indexes(db))                   # UNIQUE bank_transaction_id + idempotency_key (seperti produksi)
    run(db.supplier_profiles.insert_one({"id": "S1", "nama": "AHMAD TAUFDIQ", "jobs": [], "rekon_payments": []}))
    yield TestClient(server.app), db, run
    loop.close()


def test_transfer_kedua_yang_kemungkinan_ganda_ditahan_dan_tidak_dihitung(env):
    c, db, run = env
    r1 = run(rekon_sync.ingest_transaction(db, tx("fc5edba6", ref="0110/FTSCY/WS95001")))
    r2 = run(rekon_sync.ingest_transaction(db, tx("db9bafcb", ref="")))
    assert r1["status"] == "created" and not r1.get("perlu_verifikasi")
    assert r2["status"] == "created" and r2["perlu_verifikasi"] is True and r2["kandidat"][0]["bank_transaction_id"] == "fc5edba6"
    sup = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    assert [p["bank_transaction_id"] for p in sup["rekon_payments"]] == ["fc5edba6"]                  # hanya yang pertama dihitung
    assert [p["bank_transaction_id"] for p in sup["rekon_payments_tahan"]] == ["db9bafcb"] and sup["rekon_payments_tahan"][0]["amount"] == 10_000_000
    ov = server._supplier_rekon_overview(sup)
    assert ov["total_rekon"] == 10_000_000 and ov["total_perlu_verifikasi"] == 10_000_000 and len(ov["perlu_verifikasi"]) == 1
    imp = run(db.bank_payment_imports.find_one({"bank_transaction_id": "db9bafcb"}, {"_id": 0}))
    assert imp["status"] == "processed" and imp["dup_status"] == "perlu_verifikasi" and imp["dup_kandidat"] == ["fc5edba6"]
    assert rekon_sync.pick_ack_ids([tx("db9bafcb")], [r2]) == ["db9bafcb"]                              # tersimpan permanen -> boleh di-ACK
    # tarik ulang idempoten: tidak menahan/menghitung dua kali
    assert run(rekon_sync.ingest_transaction(db, tx("db9bafcb")))["status"] == "already_processed"
    assert len(run(db.supplier_profiles.find_one({"id": "S1"}))["rekon_payments_tahan"]) == 1


def test_dua_transfer_berbeda_referensi_tidak_ditahan(env):
    c, db, run = env
    run(rekon_sync.ingest_transaction(db, tx("A", ref="REF-1")))
    r = run(rekon_sync.ingest_transaction(db, tx("B", ref="REF-2")))
    assert r["status"] == "created" and not r.get("perlu_verifikasi")
    assert len(run(db.supplier_profiles.find_one({"id": "S1"}))["rekon_payments"]) == 2


def test_laporan_perlu_rekonsiliasi_memuat_yang_ditahan_bukan_pembayaran_hilang(env):
    c, db, run = env
    run(rekon_sync.ingest_transaction(db, tx("fc5edba6", ref="R")))
    run(rekon_sync.ingest_transaction(db, tx("db9bafcb")))
    items = c.get("/api/admin/rekon/perlu-rekonsiliasi").json()["items"]
    assert [(x["bank_transaction_id"], x["kelas"]) for x in items] == [("db9bafcb", "perlu_verifikasi")]
    d = c.get("/api/admin/suppliers/S1").json()
    assert d["total_transferred"] == 10_000_000 and d["total_perlu_verifikasi"] == 10_000_000 and len(d["perlu_verifikasi"]) == 1
    pairs = c.get("/api/admin/rekon/kemungkinan-duplikat").json()
    assert pairs["count"] == 1 and pairs["pasangan"][0]["tingkat"] == "perlu_verifikasi"


# ── otorisasi + autentikasi ulang + keputusan ───────────────────────────────

def _user(run, db, role, pw="Rahasia123", approver=None, nama=None):
    uid = uuid.uuid4().hex
    u = {"user_id": uid, "email": f"{uid[:6]}@x.id", "nama": nama or role, "role": role, "status": "aktif", "pw_hash": au.hash_pw(pw)}
    if approver is not None:
        u["finance_approver"] = approver
    run(db[au.COLL].insert_one(dict(u)))
    return u, {"Authorization": "Bearer " + run(au.issue_token(db, u))}


def _siap_ganda(run, db):
    run(rekon_sync.ingest_transaction(db, tx("fc5edba6", ref="0110/FTSCY/WS95001")))
    run(rekon_sync.ingest_transaction(db, tx("db9bafcb")))


BODY = {"keputusan": "duplikat", "alasan": "Satu transfer BCA 01/10/2026 tercatat dua kali, sudah dicek di mutasi", "password": "Rahasia123", "duplikat_dari": "fc5edba6"}
URL = "/api/admin/rekon/verifikasi/db9bafcb/putuskan"


def test_otorisasi_backend_pin_dan_peran_lain_ditolak(env):
    c, db, run = env
    _siap_ganda(run, db)
    assert c.post(URL, json=BODY).status_code == 401                                              # tanpa akun
    os.environ["ADMIN_PIN"] = "1234"
    try:
        assert c.post(URL, json=BODY, headers={"X-Admin-Pin": "1234"}).status_code == 401         # PIN tidak cukup
    finally:
        os.environ.pop("ADMIN_PIN", None)
    _, h_ops = _user(run, db, "admin_ops_1"); assert c.post(URL, json=BODY, headers=h_ops).status_code == 403
    _, h_keu = _user(run, db, "keuangan"); assert c.post(URL, json=BODY, headers=h_keu).status_code == 403          # keuangan tanpa penunjukan
    _, h_flag_salah = _user(run, db, "admin_ops_2", approver=True); assert c.post(URL, json=BODY, headers=h_flag_salah).status_code == 403   # bendera di peran lain tidak berlaku
    assert run(db.bank_payment_imports.find_one({"bank_transaction_id": "db9bafcb"}))["status"] == "processed"      # tidak ada yang berubah
    assert run(db.supplier_audit_log.count_documents({"action": "dup.duplikat"})) == 0


def test_reauth_password_salah_dan_kunci(env):
    c, db, run = env
    _siap_ganda(run, db)
    owner, h = _user(run, db, "pemilik")
    salah = dict(BODY, password="salah")
    for _ in range(4):
        assert c.post(URL, json=salah, headers=h).status_code == 401
    assert c.post(URL, json=salah, headers=h).status_code == 401           # kelima: terkunci mulai berikutnya
    assert c.post(URL, json=BODY, headers=h).status_code == 423            # password benar pun ditolak saat terkunci
    assert run(db.bank_payment_imports.find_one({"bank_transaction_id": "db9bafcb"}))["status"] == "processed"


def test_validasi_input_sebelum_apa_pun_berubah(env):
    c, db, run = env
    _siap_ganda(run, db)
    _, h = _user(run, db, "pemilik")
    assert c.post(URL, json=dict(BODY, alasan="x"), headers=h).status_code == 400
    assert c.post(URL, json=dict(BODY, keputusan="hapus"), headers=h).status_code == 400
    assert c.post(URL, json=dict(BODY, duplikat_dari=""), headers=h).status_code == 400
    assert c.post(URL, json=dict(BODY, duplikat_dari="db9bafcb"), headers=h).status_code == 400          # tidak boleh dirinya sendiri
    assert c.post(URL, json=dict(BODY, duplikat_dari="TIDAK-ADA"), headers=h).status_code == 409
    assert c.post("/api/admin/rekon/verifikasi/NOPE/putuskan", json=BODY, headers=h).status_code == 404
    assert run(db.supplier_audit_log.count_documents({})) == 0


def test_putuskan_duplikat_batalkan_salinan_pertahankan_yang_asli(env):
    c, db, run = env
    _siap_ganda(run, db)
    approver, h = _user(run, db, "keuangan", approver=True, nama="Finance A")
    r = c.post(URL, json=BODY, headers=h)
    assert r.status_code == 200 and r.json()["dipertahankan"] == "fc5edba6" and r.json()["tingkat"] == "perlu_verifikasi"
    sup = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    assert [(p["bank_transaction_id"], p["status"], p["amount"]) for p in sup["rekon_payments"]] == [("fc5edba6", "active", 10_000_000)]     # asli utuh
    assert sup["rekon_payments_tahan"][0]["status"] == "reversed" and sup["rekon_payments_tahan"][0]["amount"] == 10_000_000                    # nominal tidak berubah
    i2 = run(db.bank_payment_imports.find_one({"bank_transaction_id": "db9bafcb"}, {"_id": 0}))
    assert i2["status"] == "reversed" and i2["idempotency_key"] == "db9bafcb" and i2["duplikat_dari"] == "fc5edba6"        # idempotency_key tidak dilepas
    assert run(db.bank_payment_imports.find_one({"bank_transaction_id": "fc5edba6"}))["status"] == "processed"
    log = run(db.supplier_audit_log.find_one({"action": "dup.duplikat"}, {"_id": 0}))
    assert log["by"] == "Finance A" and log["bank_transaction_id"] == "db9bafcb" and log["extra"]["dipertahankan"] == "fc5edba6" and log["reason"].startswith("Satu transfer")
    # tarik ulang tetap tidak membuat dobel
    assert run(rekon_sync.ingest_transaction(db, tx("db9bafcb")))["status"] == "reversed"
    # tidak boleh saling membatalkan
    assert c.post("/api/admin/rekon/verifikasi/fc5edba6/putuskan", json=dict(BODY, duplikat_dari="db9bafcb"), headers=h).status_code == 409
    assert c.post(URL, json=BODY, headers=h).status_code == 409                                                            # sudah reversed


def test_putuskan_bukan_duplikat_menghitung_pembayaran_tanpa_auto_alokasi(env):
    c, db, run = env
    _siap_ganda(run, db)
    _, h = _user(run, db, "pemilik")
    r = c.post(URL, json={"keputusan": "bukan_duplikat", "alasan": "Dua transfer terpisah, terbukti dari saldo mutasi", "password": "Rahasia123"}, headers=h)
    assert r.status_code == 200 and r.json()["nominal"] == 10_000_000
    sup = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    assert sorted(p["bank_transaction_id"] for p in sup["rekon_payments"]) == ["db9bafcb", "fc5edba6"] and not sup.get("rekon_payments_tahan")
    moved = next(p for p in sup["rekon_payments"] if p["bank_transaction_id"] == "db9bafcb")
    assert moved["status"] == "active" and moved["allocations"] == [] and moved["dup_status"] == "terverifikasi_berbeda" and moved["dup_verified_by"]
    ov = server._supplier_rekon_overview(sup)
    assert ov["total_rekon"] == 20_000_000 and ov["total_unallocated"] == 20_000_000 and ov["total_perlu_verifikasi"] == 0
    assert c.post(URL, json={"keputusan": "bukan_duplikat", "alasan": "ulang lagi", "password": "Rahasia123"}, headers=h).status_code == 409   # tidak lagi ditahan
    assert run(db.supplier_audit_log.count_documents({"action": "dup.bukan_duplikat"})) == 1


def test_pembayaran_yang_sudah_dihitung_bisa_diputuskan_duplikat_dengan_alokasi_tersimpan_di_audit(env):
    """Kasus yang sudah terlanjur masuk (keduanya dihitung, kedua dialokasikan): batalkan salinan, snapshot alokasi tersimpan."""
    c, db, run = env
    run(db.supplier_profiles.update_one({"id": "S1"}, {"$set": {"jobs": [{"id": "J1", "total_harga": 25_000_000, "payments": []}]}}))
    for b, ref in (("fc5edba6", "R1"), ("db9bafcb", "")):
        r = run(rekon_sync.ingest_transaction(db, tx(b, ref=ref)))
    # paksa keadaan "sudah terlanjur dihitung": pindahkan yang ditahan ke rekon_payments dengan alokasi
    sup = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))
    held = dict(sup["rekon_payments_tahan"][0], status="active"); held.pop("dup_status"); held["allocations"] = [{"job_id": "J1", "amount": 10_000_000}]
    run(db.supplier_profiles.update_one({"id": "S1"}, {"$set": {"rekon_payments": sup["rekon_payments"] + [held], "rekon_payments_tahan": []}}))
    run(db.bank_payment_imports.update_one({"bank_transaction_id": "db9bafcb"}, {"$unset": {"dup_status": "", "dup_kandidat": ""}}))
    _, h = _user(run, db, "pemilik")
    assert c.post(URL, json=BODY, headers=h).status_code == 200
    log = run(db.bank_payment_imports.find_one({"bank_transaction_id": "db9bafcb"}, {"_id": 0}))
    assert log["status"] == "reversed" and log["reversed_payment_snapshot"]["allocations"] == [{"job_id": "J1", "amount": 10_000_000}]
    ov = server._supplier_rekon_overview(run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0})))
    assert ov["total_rekon"] == 10_000_000 and ov["alloc_by_job"] == {}           # alokasi salinan lepas dari perhitungan


def test_penunjukan_finance_approver_hanya_pemilik(env):
    c, db, run = env
    keu, _ = _user(run, db, "keuangan"); ops, _ = _user(run, db, "admin_ops_1")
    _, h_owner = _user(run, db, "pemilik", nama="Owner")
    assert c.patch(f"/api/admin/users/{keu['user_id']}/finance-approver", json={"aktif": True}).status_code == 403                     # tanpa akun
    _, h_keu = _user(run, db, "keuangan", approver=True)
    assert c.patch(f"/api/admin/users/{keu['user_id']}/finance-approver", json={"aktif": True}, headers=h_keu).status_code == 403     # approver tidak boleh menunjuk
    assert c.patch(f"/api/admin/users/{ops['user_id']}/finance-approver", json={"aktif": True}, headers=h_owner).status_code == 400    # hanya peran Keuangan
    r = c.patch(f"/api/admin/users/{keu['user_id']}/finance-approver", json={"aktif": True}, headers=h_owner)
    assert r.status_code == 200 and r.json()["user"]["finance_approver"] is True
    assert au.is_finance_approver(run(db[au.COLL].find_one({"user_id": keu["user_id"]})))
    c.patch(f"/api/admin/users/{keu['user_id']}/finance-approver", json={"aktif": False}, headers=h_owner)
    assert not au.is_finance_approver(run(db[au.COLL].find_one({"user_id": keu["user_id"]})))
    assert run(db.supplier_audit_log.count_documents({"action": {"$in": ["approver.designate", "approver.revoke"]}})) == 2
