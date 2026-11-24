"""Hubungkan ulang pembayaran: preview baca-saja, validasi nominal, kecocokan identitas, persetujuan Finance Approver, idempotensi, audit."""
import os, sys, asyncio, copy, uuid
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_relink")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server, rekon_relink as RL, rekon_sync, app_users as au

N = 10_000_000


def job(jid, inv="INV-77", nopol="B1234XYZ", total=N, asal="JKT", tujuan="MDN", **kw):
    return {"id": jid, "no_invoice_supplier": inv, "nopol": nopol, "total_harga": total, "asal_kota": asal, "tujuan_kota": tujuan, "payments": [], **kw}


def rp(pid="P1", btid="B1", amount=N, allocs=None, **kw):
    return {"id": pid, "bank_transaction_id": btid, "amount": amount, "tanggal": "2026-10-01", "status": "active", "source": "rekon-bank",
            "source_entity": "PT_ALYSSA_AUTO_LOGISTIK", "allocations": allocs or [], **kw}


def imp(btid="B1", sid="S-LAMA", pid="P1", amount=N, **kw):
    return {"bank_transaction_id": btid, "idempotency_key": btid, "status": "processed", "supplier_id": sid, "rekon_payment_id": pid, "amount": amount,
            "tanggal": "2026-10-01", "supplier_name": "AHMAD TAUFDIQ", "source_entity": "PT_ALYSSA_AUTO_LOGISTIK",
            "raw_payload": {"bank_transaction_id": btid, "nominal": amount, "tanggal": "2026-10-01", "supplier_name": "AHMAD TAUFDIQ", "deskripsi_bank": "TRSF AHMAD",
                            "source_entity": "PT_ALYSSA_AUTO_LOGISTIK", "source_account_number": "123", "referensi_bank": "0110/FTSCY/WS95"}, **kw}


# ── murni ────────────────────────────────────────────────────────────────────

def test_skor_dan_saran():
    ref = {"no_invoice": "INV-77", "unit": "B 1234 XYZ", "rute": "JKT → MDN", "total": N}
    assert RL.skor(ref, job("J")) == "kuat"
    assert RL.skor(ref, job("J", inv="")) == "kuat"                                              # unit + rute + total sama
    assert RL.skor(ref, job("J", nopol="D9999AA")) == "lemah"                                    # hanya nomor invoice sama
    assert RL.skor(ref, job("J", inv="X", nopol="D9999AA", total=1)) is None
    assert RL.skor(ref, job("J", inv="INV-77", nopol="D9999AA", total=1, asal="SBY")) == "lemah"
    s = RL.saran([ref], [job("A"), job("B", nopol="D1")])
    assert s[0]["status"] == "kuat_unik" and [k["job_id"] for k in s[0]["kandidat"]][0] == "A"
    assert RL.saran([ref], [job("A"), job("B")])[0]["status"] == "ambigu"                         # dua kandidat kuat -> tidak boleh otomatis
    assert RL.saran([ref], [job("B", nopol="D1")])[0]["status"] == "lemah"
    assert RL.saran([ref], [job("C", inv="Z", nopol="Q1", total=5)])[0]["status"] == "tidak_ada"


def test_validasi_nominal_dan_proposal():
    pr, errs = RL.normalisasi_proposals([{"job_id": "A", "amount": "4.000.000"}, {"job_id": "A", "amount": 1}, {"job_id": "", "amount": 1}, {"job_id": "B", "amount": 0}])
    assert pr == [{"job_id": "A", "amount": 1}] and len(errs) == 3                              # "4.000.000" bukan angka murni; job_id kosong; nominal nol
    assert RL.normalisasi_proposals([{"job_id": "A", "amount": 1}, {"job_id": "A", "amount": 2}])[1] == ["job ganda dalam usulan: A"]
    pr, errs = RL.normalisasi_proposals([{"job_id": "A", "amount": 6_000_000}, {"job_id": "B", "amount": 5_000_000}])
    assert not errs and RL.validasi(N, pr, {"A": 9e9, "B": 9e9}, {"A", "B"}) == [f"Total alokasi 11000000 melebihi nominal pembayaran {N}"]
    assert any("melebihi sisa" in e for e in RL.validasi(N, [{"job_id": "A", "amount": 6_000_000}], {"A": 1_000_000}, {"A"}))
    assert any("tidak ada" in e for e in RL.validasi(N, [{"job_id": "Z", "amount": 1}], {}, {"A"}))
    assert RL.token({"a": 1, "b": [1, 2]}) == RL.token({"b": [1, 2], "a": 1}) != RL.token({"a": 2, "b": [1, 2]})
    assert RL.identitas_ganda([job("A"), job("B"), job("C", nopol="Z9")]) == {"A", "B"}
    assert RL.identitas_supplier("AHMAD TAUFDIQ", "Ahmad Taufdiq") == "sama" and RL.identitas_supplier("AHMAD", "AHMAD TAUFDIQ") == "mirip" and RL.identitas_supplier("BUDI", "ANDI") == "beda"


# ── integrasi ────────────────────────────────────────────────────────────────

@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    from pymongo.errors import DuplicateKeyError as _D
    monkeypatch.setattr(rekon_sync, "DuplicateKeyError", _D)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(rekon_sync.ensure_indexes(db))
    yield TestClient(server.app), db, run
    loop.close()


def user(run, db, role="pemilik", pw="Rahasia123", approver=None):
    uid = uuid.uuid4().hex
    u = {"user_id": uid, "email": f"{uid[:6]}@x.id", "nama": role, "role": role, "status": "aktif", "pw_hash": au.hash_pw(pw)}
    if approver is not None:
        u["finance_approver"] = approver
    run(db[au.COLL].insert_one(dict(u)))
    return {"Authorization": "Bearer " + run(au.issue_token(db, u))}


def sup(sid, nama="AHMAD TAUFDIQ", jobs=None, rekon=None, **kw):
    return {"id": sid, "nama": nama, "jobs": jobs or [], "rekon_payments": rekon or [], **kw}


def snap(db, run):
    return {c: run(db[c].find({}, {"_id": 0}).to_list(1000)) for c in ("supplier_profiles", "bank_payment_imports", "supplier_audit_log")}


def apply_body(pv, proposals, **kw):
    b = {"bank_transaction_id": pv["bank_transaction_id"], "target_supplier_id": pv["supplier_tujuan"]["supplier_id"], "proposals": proposals,
         "preview_token": pv["token"], "alasan": "Impor ulang invoice, supplier lama dihapus", "password": "Rahasia123"}
    b.update(kw)
    return b


def skenario_yatim(run, db):
    """Supplier baru (hasil impor ulang) memegang pembayaran yang dulu dialokasikan ke unit J-LAMA (sudah dihapus); unit baru J-BARU identik."""
    ref = {"job_id": "J-LAMA", "no_invoice": "INV-77", "unit": "B1234XYZ", "rute": "JKT → MDN", "total": N}
    run(db.supplier_profiles.insert_one(sup("S-BARU", jobs=[job("J-BARU"), job("J-LAIN", inv="INV-99", nopol="D1111AA", total=2_000_000)],
                                           rekon=[rp(allocs=[{"job_id": "J-LAMA", "amount": N, "ref": ref}])])))
    run(db.bank_payment_imports.insert_one(imp(sid="S-BARU")))


def test_preview_alokasi_ulang_baca_saja_dan_usulan_kuat(env):
    c, db, run = env
    skenario_yatim(run, db)
    before = snap(db, run)
    pv = c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-BARU", "amount": N}]}).json()
    assert snap(db, run) == before                                                                   # BACA-SAJA
    assert pv["mode"] == "alokasi_ulang" and pv["boleh_diterapkan"] and not pv["errors"] and not pv["perlu_konfirmasi"] and pv["identitas_supplier"] == "sama"
    assert pv["pembayaran"]["nominal"] == N and pv["referensi_dokumen_lama"][0]["no_invoice"] == "INV-77"
    assert pv["usulan"][0]["status"] == "kuat_unik" and pv["usulan"][0]["kandidat"][0]["job_id"] == "J-BARU"
    assert pv["kecocokan"] == [{"job_id": "J-BARU", "kecocokan_dengan_referensi_lama": "kuat"}]
    assert pv["sebelum"]["supplier_tujuan"] == {"total_rekon": N, "teralokasi": 0, "belum_dialokasikan": N}          # alokasi yatim terlihat sebagai belum dialokasikan
    assert pv["sesudah"]["supplier_tujuan"] == {"total_rekon": N, "teralokasi": N, "belum_dialokasikan": 0}
    assert pv["unit"][0]["sisa_sebelum"] == N and pv["unit"][0]["sisa_sesudah"] == 0
    assert c.get("/api/admin/rekon/relink/saran", params={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU"}).json()["usulan"][0]["status"] == "kuat_unik"


def test_preview_validasi_nominal(env):
    c, db, run = env
    skenario_yatim(run, db)
    P = lambda props: c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": props}).json()
    assert not P([{"job_id": "J-BARU", "amount": N + 1}])["boleh_diterapkan"]                       # melebihi nominal / sisa unit
    assert any("melebihi" in e for e in P([{"job_id": "J-BARU", "amount": N}, {"job_id": "J-LAIN", "amount": 1}])["errors"])
    assert any("tidak ada" in e for e in P([{"job_id": "J-LAMA", "amount": 1}])["errors"])           # unit lama sudah tidak ada
    assert not P([])["boleh_diterapkan"]
    assert c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "NOPE", "target_supplier_id": "S-BARU", "proposals": []}).status_code == 404
    assert c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "ZZ", "proposals": []}).status_code == 404


def test_apply_otorisasi_dan_pagar(env):
    c, db, run = env
    skenario_yatim(run, db)
    pv = c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-BARU", "amount": N}]}).json()
    B = apply_body(pv, [{"job_id": "J-BARU", "amount": N}])
    U = "/api/admin/rekon/relink/apply"
    before = snap(db, run)
    assert c.post(U, json=B).status_code == 401                                                      # tanpa akun
    os.environ["ADMIN_PIN"] = "1234"
    try:
        assert c.post(U, json=B, headers={"X-Admin-Pin": "1234"}).status_code == 401                 # PIN tidak cukup
    finally:
        os.environ.pop("ADMIN_PIN", None)
    assert c.post(U, json=B, headers=user(run, db, "admin_ops_1")).status_code == 403
    assert c.post(U, json=B, headers=user(run, db, "keuangan")).status_code == 403                  # belum ditunjuk
    h = user(run, db, "keuangan", approver=True)
    assert c.post(U, json=dict(B, password="salah"), headers=h).status_code == 401
    assert c.post(U, json=dict(B, alasan="x"), headers=h).status_code == 400
    assert c.post(U, json=dict(B, preview_token="0" * 32), headers=h).status_code == 409             # token tidak cocok
    assert snap(db, run) == before                                                                   # tidak ada yang tertulis


def test_apply_alokasi_ulang_menyimpan_riwayat_dan_idempoten(env):
    c, db, run = env
    skenario_yatim(run, db)
    h = user(run, db, "pemilik")
    pv = c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-BARU", "amount": N}]}).json()
    B = apply_body(pv, [{"job_id": "J-BARU", "amount": N}])
    r = c.post("/api/admin/rekon/relink/apply", json=B, headers=h)
    assert r.status_code == 200 and r.json()["mode"] == "alokasi_ulang" and r.json()["sisa_belum_dialokasikan"] == 0
    s = run(db.supplier_profiles.find_one({"id": "S-BARU"}, {"_id": 0}))
    p = s["rekon_payments"][0]
    assert p["amount"] == N and [(a["job_id"], a["amount"]) for a in p["allocations"]] == [("J-BARU", N)] and p["allocations"][0]["ref"]["no_invoice"] == "INV-77"
    assert p["relink_history"][0]["dari"][0]["job_id"] == "J-LAMA" and p["relink_history"][0]["dari"][0]["amount"] == N     # alokasi lama tersimpan
    ov = server._supplier_rekon_overview(s)
    assert ov["total_rekon"] == N and ov["alloc_by_job"] == {"J-BARU": N} and ov["total_unallocated"] == 0 and ov["total_alokasi_yatim"] == 0
    log = run(db.supplier_audit_log.find_one({"action": "payment.relink"}, {"_id": 0}))
    assert log["bank_transaction_id"] == "B1" and log["reason"].startswith("Impor ulang") and log["before"]["alokasi_lama"][0]["job_id"] == "J-LAMA" and log["after"]["alokasi_baru"][0]["job_id"] == "J-BARU"
    # idempoten: kirim ulang -> tidak ada penulisan kedua
    snapshot = snap(db, run)
    r2 = c.post("/api/admin/rekon/relink/apply", json=B, headers=h)
    assert r2.status_code == 200 and r2.json()["sudah_diterapkan"] is True
    assert snap(db, run) == snapshot
    # token lama tidak bisa dipakai untuk keadaan baru (kedaluwarsa)
    pv2 = c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-LAIN", "amount": 2_000_000}]}).json()
    assert pv2["token"] != pv["token"]


def test_token_kedaluwarsa_bila_data_berubah_antara_preview_dan_apply(env):
    c, db, run = env
    skenario_yatim(run, db)
    h = user(run, db, "pemilik")
    pv = c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-BARU", "amount": N}]}).json()
    run(db.supplier_profiles.update_one({"id": "S-BARU", "jobs.id": "J-BARU"}, {"$set": {"jobs.$.payments": [{"id": "m1", "amount": 1_000_000}]}}))      # sisa unit berubah
    before = snap(db, run)
    r = c.post("/api/admin/rekon/relink/apply", json=apply_body(pv, [{"job_id": "J-BARU", "amount": N}]), headers=h)
    assert r.status_code in (409, 422) and snap(db, run) == before


def test_pulih_dari_import_untuk_supplier_yang_sudah_dihapus(env):
    """Kasus AHMAD TAUFDIQ: supplier lama (S-LAMA) sudah dihapus; pembayaran dipulihkan ke profil baru dari data import."""
    c, db, run = env
    run(db.supplier_profiles.insert_one(sup("S-BARU", jobs=[job("J-BARU")])))
    run(db.bank_payment_imports.insert_one(imp()))
    h = user(run, db, "pemilik")
    P = {"bank_transaction_id": "B1", "target_supplier_id": "S-BARU", "proposals": [{"job_id": "J-BARU", "amount": 4_000_000}]}
    pv = c.post("/api/admin/rekon/relink/preview", json=P).json()
    assert pv["mode"] == "pulih_dari_import" and pv["supplier_asal"]["ada"] is False and pv["pembayaran"]["nominal"] == N
    assert pv["perlu_verifikasi_identitas"] is True and not pv["perlu_konfirmasi"] and pv["sisa_belum_dialokasikan"] == 6_000_000
    assert pv["sebelum"]["supplier_tujuan"]["total_rekon"] == 0 and pv["sesudah"]["supplier_tujuan"] == {"total_rekon": N, "teralokasi": 4_000_000, "belum_dialokasikan": 6_000_000}
    B = apply_body(pv, P["proposals"])
    assert c.post("/api/admin/rekon/relink/apply", json=B, headers=h).status_code == 400                                         # identitas belum diverifikasi
    assert c.post("/api/admin/rekon/relink/apply", json=dict(B, identitas_diverifikasi=True), headers=h).status_code == 200
    s = run(db.supplier_profiles.find_one({"id": "S-BARU"}, {"_id": 0}))
    p = s["rekon_payments"][0]
    assert (p["id"], p["bank_transaction_id"], p["amount"], p["tanggal"], p["status"]) == ("P1", "B1", N, "2026-10-01", "active")      # nominal & id asli
    assert p["dipulihkan"]["by"] and p["rekon"]["referensi_bank"] == "0110/FTSCY/WS95"
    assert run(db.bank_payment_imports.find_one({"bank_transaction_id": "B1"}, {"_id": 0}))["supplier_id"] == "S-BARU"
    assert run(db.bank_payment_imports.count_documents({})) == 1 and run(db.supplier_profiles.count_documents({})) == 1          # tidak ada pembayaran dobel
    ov = server._supplier_rekon_overview(s)
    assert ov["total_rekon"] == N and ov["total_unallocated"] == 6_000_000


def test_pindah_antar_profil_kembar(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(sup("S-A", "AHMAD TAUFDIQ", rekon=[rp(allocs=[{"job_id": "J-GONE", "amount": N}])])))
    run(db.supplier_profiles.insert_one(sup("S-B", "Ahmad Taufdiq", jobs=[job("J1")])))
    run(db.bank_payment_imports.insert_one(imp(sid="S-A")))
    h = user(run, db, "pemilik")
    P = {"bank_transaction_id": "B1", "target_supplier_id": "S-B", "proposals": [{"job_id": "J1", "amount": N}]}
    pv = c.post("/api/admin/rekon/relink/preview", json=P).json()
    assert pv["mode"] == "pindah_supplier" and pv["identitas_supplier"] == "sama" and pv["sebelum"]["supplier_asal"]["total_rekon"] == N and pv["sesudah"]["supplier_asal"]["total_rekon"] == 0
    assert pv["perlu_verifikasi_identitas"] is True and "tidak punya identitas" in pv["perlu_konfirmasi"][0]        # alokasi lama tanpa identitas bisnis
    B = apply_body(pv, P["proposals"], identitas_diverifikasi=True)
    assert c.post("/api/admin/rekon/relink/apply", json=dict(B, identitas_diverifikasi=False, konfirmasi_ambigu=True), headers=h).status_code == 400
    assert c.post("/api/admin/rekon/relink/apply", json=B, headers=h).status_code == 400                           # perlu konfirmasi eksplisit
    r = c.post("/api/admin/rekon/relink/apply", json=dict(B, konfirmasi_ambigu=True), headers=h)
    assert r.status_code == 200, r.text
    a, b = (run(db.supplier_profiles.find_one({"id": x}, {"_id": 0})) for x in ("S-A", "S-B"))
    assert a["rekon_payments"] == [] and a["rekon_payments_dipindah"][0]["payment"]["allocations"][0]["job_id"] == "J-GONE" and a["rekon_payments_dipindah"][0]["ke_supplier"] == "S-B"
    assert b["rekon_payments"][0]["amount"] == N and b["rekon_payments"][0]["dipindah_dari"]["supplier_id"] == "S-A" and b["rekon_payments"][0]["allocations"][0]["job_id"] == "J1"
    i = run(db.bank_payment_imports.find_one({"bank_transaction_id": "B1"}, {"_id": 0}))
    assert i["supplier_id"] == "S-B" and i["supplier_id_lama"] == "S-A"
    assert sum(len(x.get("rekon_payments") or []) for x in (a, b)) == 1                                  # tetap SATU pembayaran


def test_pindah_ke_nama_beda_wajib_konfirmasi_dan_ambigu(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(sup("S-A", "AHMAD TAUFDIQ", rekon=[rp(allocs=[{"job_id": "J-GONE", "amount": N, "ref": {"no_invoice": "INV-77", "unit": "B1234XYZ", "rute": "JKT → MDN", "total": N}}])])))
    run(db.supplier_profiles.insert_one(sup("S-B", "CV LAIN", jobs=[job("J1"), job("J2")])))             # dua unit kembar -> ambigu
    run(db.bank_payment_imports.insert_one(imp(sid="S-A")))
    h = user(run, db, "pemilik")
    P = {"bank_transaction_id": "B1", "target_supplier_id": "S-B", "proposals": [{"job_id": "J1", "amount": N}]}
    pv = c.post("/api/admin/rekon/relink/preview", json=P).json()
    assert pv["identitas_supplier"] == "beda" and any("kembaran" in k for k in pv["perlu_konfirmasi"]) and pv["usulan"][0]["status"] == "ambigu"
    B = apply_body(pv, P["proposals"], identitas_diverifikasi=True)
    r = c.post("/api/admin/rekon/relink/apply", json=B, headers=h)
    assert r.status_code == 400 and "perlu_konfirmasi" in r.json()["detail"]
    assert c.post("/api/admin/rekon/relink/apply", json=dict(B, konfirmasi_ambigu=True), headers=h).status_code == 200


def test_ditolak_bila_arsip_reversed_atau_ditahan(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(sup("S-ARSIP", status="archived")))
    run(db.supplier_profiles.insert_one(sup("S-OK", jobs=[job("J1")], rekon=[rp(pid="PR", btid="BR", status="reversed"), rp(pid="PA", btid="BA")])))
    run(db.bank_payment_imports.insert_many([imp(btid="BR", sid="S-OK", pid="PR"), imp(btid="BA", sid="S-OK", pid="PA"), imp(btid="BH", sid="S-OK", pid="PH", dup_status="perlu_verifikasi")]))
    P = lambda b, t: c.post("/api/admin/rekon/relink/preview", json={"bank_transaction_id": b, "target_supplier_id": t, "proposals": []}).status_code
    assert P("BA", "S-ARSIP") == 409 and P("BR", "S-OK") == 409 and P("BH", "S-OK") == 409


def test_allocate_payment_menyimpan_identitas_bisnis(env):
    c, db, run = env
    run(db.supplier_profiles.insert_one(sup("S1", jobs=[job("J1")], rekon=[rp()])))
    assert run(rekon_sync.allocate_payment(db, "S1", "P1", [{"job_id": "J1", "amount": 4_000_000}]))["ok"]
    a = run(db.supplier_profiles.find_one({"id": "S1"}, {"_id": 0}))["rekon_payments"][0]["allocations"][0]
    assert a["job_id"] == "J1" and a["amount"] == 4_000_000 and a["ref"]["no_invoice"] == "INV-77" and a["ref"]["unit"] == "B1234XYZ" and a["ref"]["rute"] == "JKT → MDN"
