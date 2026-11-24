"""Selesaikan transaksi READY yang 'menempel' (supplier lama sudah dihapus): preview baca-saja, persetujuan Finance Approver,
simpan permanen lalu ACK, idempoten, duplikat ditahan, tanpa ACK bila gagal simpan, audit."""
import os, sys, asyncio, uuid
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_menempel")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server, rekon_sync, app_users as au

N = 15_000_000
BT = "BT-STUCK-1"
PW = "Rahasia123"


def ready_item(btid=BT, sid="0c2408c0", nominal=N, **kw):
    d = {"bank_transaction_id": btid, "idempotency_key": btid, "supplier_id": sid, "supplier_name": "AHMAD TAUFDIQ", "nominal": nominal,
         "tanggal": "2026-11-11", "source_entity": "PT_ALYSSA_AUTO_LOGISTIK", "source_account_number": "123", "referensi_bank": "1111/FTSCY/WS95051",
         "deskripsi_bank": "TRSF E-BANKING DB 1111/FTSCY/WS95051 15000000.00 Pembayaran AHMAD TAUFDIQ", "alokasi": []}
    d.update(kw)
    return d


class FakeFelis:
    def __init__(self, items, ack_error=False):
        self.items, self.acks, self.ack_error = items, [], ack_error

    async def fetch_ready(self, **kw):
        return {"batch": "BATCH-1", "jumlah": len(self.items), "data": [dict(i) for i in self.items]}

    async def ack(self, batch, ids):
        if self.ack_error:
            raise server.rekon_felis_client.FelisError("timeout")
        self.acks.append((batch, list(ids)))
        return {"ok": True}


@pytest.fixture()
def env(monkeypatch):
    db = AsyncMongoMockClient()["t"]
    monkeypatch.setattr(server, "db", db)
    from pymongo.errors import DuplicateKeyError as _D
    monkeypatch.setattr(rekon_sync, "DuplicateKeyError", _D)
    loop = asyncio.new_event_loop(); run = loop.run_until_complete
    run(rekon_sync.ensure_indexes(db))
    fel = FakeFelis([ready_item()])
    monkeypatch.setattr(server.rekon_felis_client, "is_configured", lambda: True)
    monkeypatch.setattr(server.rekon_felis_client, "fetch_ready", fel.fetch_ready)
    monkeypatch.setattr(server.rekon_felis_client, "ack", fel.ack)
    run(db.supplier_profiles.insert_one({"id": "S-BARU", "nama": "AHMAD TAUFDIQ", "jobs": [], "rekon_payments": []}))
    yield TestClient(server.app), db, run, fel
    loop.close()


def akun(run, db, role="pemilik", approver=None):
    uid = uuid.uuid4().hex
    u = {"user_id": uid, "email": f"{uid[:6]}@x.id", "nama": role, "role": role, "status": "aktif", "pw_hash": au.hash_pw(PW)}
    if approver is not None:
        u["finance_approver"] = approver
    run(db[au.COLL].insert_one(dict(u)))
    return {"Authorization": "Bearer " + run(au.issue_token(db, u))}


def snap(db, run):
    return {c: run(db[c].find({}, {"_id": 0}).to_list(1000)) for c in ("supplier_profiles", "bank_payment_imports", "supplier_audit_log")}


P = "/api/admin/rekon/menempel/preview"
A = "/api/admin/rekon/menempel/terapkan"


def preview(c, target="S-BARU", btid=BT):
    return c.post(P, json={"bank_transaction_id": btid, "target_supplier_id": target})


def body(pv, **kw):
    b = {"bank_transaction_id": BT, "target_supplier_id": "S-BARU", "preview_token": pv["token"], "alasan": "Supplier lama terhapus, impor ulang invoice",
         "password": PW, "identitas_diverifikasi": True}
    b.update(kw)
    return b


def test_preview_baca_saja(env):
    c, db, run, fel = env
    before = snap(db, run)
    r = preview(c)
    assert r.status_code == 200
    pv = r.json()
    assert snap(db, run) == before and fel.acks == []                                        # tidak menulis, tidak ACK
    assert pv["supplier_lama"] == {"supplier_id": "0c2408c0", "ada": False, "status": "tidak_ada"}
    assert pv["identitas_supplier"] == "sama" and pv["transaksi"]["nominal"] == N and pv["hasil_bila_diterapkan"] == "disimpan_belum_dialokasikan"
    assert "_item" not in pv


def test_preview_penolakan(env):
    c, db, run, fel = env
    assert preview(c, btid="TIDAK-ADA").status_code == 404                                   # tidak lagi READY
    assert preview(c, target="ZZ").status_code == 404
    run(db.supplier_profiles.insert_one({"id": "0c2408c0", "nama": "LAMA", "jobs": []}))
    assert preview(c).status_code == 409                                                     # supplier lama masih ada -> pakai Tarik biasa
    run(db.supplier_profiles.delete_one({"id": "0c2408c0"}))
    run(db.supplier_profiles.update_one({"id": "S-BARU"}, {"$set": {"status": "archived"}}))
    assert preview(c).status_code == 409                                                     # tujuan diarsipkan
    run(db.supplier_profiles.update_one({"id": "S-BARU"}, {"$set": {"status": "active"}}))
    run(db.bank_payment_imports.insert_one({"bank_transaction_id": BT, "idempotency_key": BT, "status": "processed"}))
    assert preview(c).status_code == 409                                                     # sudah processed -> Hubungkan Ulang


def test_terapkan_otorisasi_dan_pagar(env):
    c, db, run, fel = env
    pv = preview(c).json()
    before = snap(db, run)
    assert c.post(A, json=body(pv)).status_code == 401                                       # tanpa akun
    non = akun(run, db, role="admin_ops_1")
    assert c.post(A, json=body(pv), headers=non).status_code == 403                          # bukan approver
    ok = akun(run, db)
    assert c.post(A, json=body(pv, password="salah"), headers=ok).status_code == 401
    assert c.post(A, json=body(pv, alasan="x"), headers=ok).status_code == 400
    assert c.post(A, json=body(pv, identitas_diverifikasi=False), headers=ok).status_code == 400
    assert c.post(A, json=body(pv, preview_token="palsu"), headers=ok).status_code == 409
    assert snap(db, run) == before and fel.acks == []                                        # tidak ada yang tertulis / ACK


def test_terapkan_simpan_ack_audit_idempoten(env):
    c, db, run, fel = env
    pv = preview(c).json()
    h = akun(run, db)
    r = c.post(A, json=body(pv), headers=h)
    assert r.status_code == 200 and r.json()["status"] == "created" and r.json()["acked"] is True
    assert fel.acks == [("BATCH-1", [BT])]                                                   # ACK tepat satu kali, hanya transaksi ini
    s = run(db.supplier_profiles.find_one({"id": "S-BARU"}))
    assert [p["amount"] for p in s["rekon_payments"]] == [N] and s["rekon_payments"][0]["allocations"] == []   # Belum Dialokasikan
    imp = run(db.bank_payment_imports.find_one({"bank_transaction_id": BT}))
    assert imp["status"] == "processed" and imp["supplier_id"] == "S-BARU" and imp["supplier_id_lama"] == "0c2408c0"
    au_log = run(db.supplier_audit_log.find({"action": "rekon.menempel_selesai"}, {"_id": 0}).to_list(10))
    assert len(au_log) == 1 and au_log[0]["bank_transaction_id"] == BT and au_log[0]["extra"]["token"] == pv["token"]
    r2 = c.post(A, json=body(pv), headers=h)                                                 # token sama tidak diterapkan dua kali
    assert r2.status_code == 200 and r2.json().get("sudah_diterapkan") is True
    assert len(fel.acks) == 1 and len(run(db.supplier_profiles.find_one({"id": "S-BARU"}))["rekon_payments"]) == 1


def test_data_berubah_sejak_preview(env):
    c, db, run, fel = env
    pv = preview(c).json()
    fel.items[0]["tanggal"] = "2026-11-12"                                                   # Felis mengubah data setelah preview
    r = c.post(A, json=body(pv), headers=akun(run, db))
    assert r.status_code == 409 and fel.acks == []


def test_kemungkinan_duplikat_ditahan_tapi_tersimpan_dan_di_ack(env):
    c, db, run, fel = env
    run(db.bank_payment_imports.insert_one({"bank_transaction_id": "B-LAIN", "idempotency_key": "B-LAIN", "status": "processed", "tanggal": "2026-11-11",
                                            "amount": N, "supplier_id": "S-BARU", "source_account_number": "123", "referensi_bank": "1111/FTSCY/WS95051",
                                            "raw_payload": {"nominal": N}, "nominal": N, "source_entity": "PT_ALYSSA_AUTO_LOGISTIK"}))
    pv = preview(c).json()
    assert pv["kemungkinan_duplikat"] and pv["hasil_bila_diterapkan"] == "ditahan_perlu_verifikasi"
    r = c.post(A, json=body(pv), headers=akun(run, db))
    assert r.status_code == 200 and r.json()["perlu_verifikasi"] is True and r.json()["acked"] is True
    s = run(db.supplier_profiles.find_one({"id": "S-BARU"}))
    assert not s.get("rekon_payments") and len(s["rekon_payments_tahan"]) == 1               # tidak ikut total, tidak dihapus


def test_gagal_simpan_tidak_ack(env):
    c, db, run, fel = env
    fel.items[0]["source_entity"] = "ENTITAS_NGAWUR"
    pv = preview(c).json()
    r = c.post(A, json=body(pv), headers=akun(run, db))
    assert r.status_code == 422 and fel.acks == []
    assert not run(db.supplier_profiles.find_one({"id": "S-BARU"})).get("rekon_payments")


def test_ack_gagal_data_tetap_tersimpan(env):
    c, db, run, fel = env
    fel.ack_error = True
    pv = preview(c).json()
    r = c.post(A, json=body(pv), headers=akun(run, db))
    assert r.status_code == 200 and r.json()["acked"] is False and "ACK gagal" in r.json()["peringatan"]
    assert len(run(db.supplier_profiles.find_one({"id": "S-BARU"}))["rekon_payments"]) == 1
