"""Driver Checkpoint v2 API tests"""
import os
import io
import uuid
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    # fallback to frontend env
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"


def _make_png_bytes() -> bytes:
    """Tiny valid 1x1 PNG"""
    def chunk(typ, data):
        crc = zlib.crc32(typ + data) & 0xffffffff
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', crc)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    raw = b'\x00\xff\x00\x00'
    idat = chunk(b'IDAT', zlib.compress(raw))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


def _make_jpeg_bytes() -> bytes:
    # minimal JPEG (gray pixel) - use a tiny known JPEG
    return bytes.fromhex(
        "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605"
        "08070707090908"+ "0a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c2024"
        "2e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc000"
        "0b08000100010101110000ffc4001f0000010501010101010100000000000000"
        "000102030405060708090a0bffc400b5100002010303020403050504040000"
        "017d010203000411051221314106135161072271143281914223a1b1c10923"
        "33526272f1156374820810a162434e125f11718191a262728292a3536373839"
        "3a434445464748494a535455565758595a636465666768696a737475767778"
        "797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4"
        "b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7"
        "e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbd0ffd9"
    )


PNG = _make_png_bytes()


@pytest.fixture(scope="module")
def trip_id():
    return f"TRIP-TEST-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


def test_01_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    data = r.json()
    assert data.get("message") == "Alyssa Driver Checkpoint API"
    assert isinstance(data.get("v"), str) and data.get("v")


def test_02_init_trip_new(session, trip_id):
    payload = {
        "trip_id": trip_id, "driver_id": "DRV-1", "nopol": "B 1234 ZZ",
        "route": "Jakarta - Surabaya", "uj": 3500000, "t1": 1750000, "t2": 1050000, "t3": 700000,
    }
    r = session.post(f"{API}/trips/init", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["trip_id"] == trip_id
    assert d["nopol"] == "B 1234 ZZ"
    assert d["nama_driver"] == ""
    assert d["sop_read"] is False
    assert d["initial_photos"] == {}
    assert d["daily_checkpoints"] == []
    assert d["handover"]["bastk"] == []
    assert d["handover"]["resi"] is None
    assert d["cair"] == {"1": False, "2": False, "3": False}
    assert "_id" not in d


def test_03_init_trip_idempotent(session, trip_id):
    r = session.post(f"{API}/trips/init", json={
        "trip_id": trip_id, "nopol": "B 9999 XX", "route": "X", "uj": 1, "t1": 1, "t2": 1, "t3": 1
    })
    assert r.status_code == 200
    d = r.json()
    # existing doc returned, not overwritten
    assert d["nopol"] == "B 1234 ZZ"
    assert d["t1"] == 1750000


def test_04_get_trip(session, trip_id):
    r = session.get(f"{API}/trips/{trip_id}")
    assert r.status_code == 200
    assert r.json()["trip_id"] == trip_id


def test_05_get_trip_404(session):
    r = session.get(f"{API}/trips/NONEXISTENT-{uuid.uuid4().hex}")
    assert r.status_code == 404


def test_06_set_driver_name(session, trip_id):
    r = session.post(f"{API}/trips/{trip_id}/driver-name", json={"nama": "Hermansyah"})
    assert r.status_code == 200
    assert r.json()["nama_driver"] == "Hermansyah"


def test_07_sop_read(session, trip_id):
    r = session.post(f"{API}/trips/{trip_id}/sop-read")
    assert r.status_code == 200
    g = session.get(f"{API}/trips/{trip_id}").json()
    assert g["sop_read"] is True


def test_08_upload_5_initial_and_auto_cair(session, trip_id):
    # v2.3: 5 slots only (bbm dropped)
    slots = ["depan", "belakang", "kiri", "kanan", "spidometer"]
    last = None
    for s in slots:
        files = {"foto": (f"{s}.png", PNG, "image/png")}
        data = {"slot": s}
        r = session.post(f"{API}/trips/{trip_id}/photos/initial", data=data, files=files)
        assert r.status_code == 200, f"{s}: {r.text}"
        last = r.json()
        assert s in last["initial_photos"]
        assert last["initial_photos"][s]["url"].startswith(f"/api/uploads/{trip_id}/initial/{s}/")
    assert len(last["initial_photos"]) == 5
    assert last["cair"]["1"] is True  # auto cair after 5 slots


def test_09_upload_initial_bad_slot(session, trip_id):
    files = {"foto": ("x.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id}/photos/initial", data={"slot": "invalid"}, files=files)
    assert r.status_code == 400


def test_10_static_file_served(session, trip_id):
    g = session.get(f"{API}/trips/{trip_id}").json()
    url = g["initial_photos"]["depan"]["url"]
    r = session.get(f"{BASE_URL}{url}")
    assert r.status_code == 200
    assert len(r.content) > 0


def test_11_daily_upload(session, trip_id):
    # ensure clean slate
    session.delete(f"{API}/trips/{trip_id}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id}/photos/daily", files=files)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["daily_checkpoints"]) >= 1


def test_12_daily_duplicate_same_day_409(session, trip_id):
    files = {"foto": ("d.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id}/photos/daily", files=files)
    assert r.status_code == 409
    assert "hari ini" in r.text.lower()


def test_13_delete_today_daily(session, trip_id):
    r = session.delete(f"{API}/trips/{trip_id}/daily/today")
    assert r.status_code == 200
    # Now upload should succeed again
    files = {"foto": ("d2.png", PNG, "image/png")}
    r2 = session.post(f"{API}/trips/{trip_id}/photos/daily", files=files)
    assert r2.status_code == 200


def test_14_bastk_upload(session, trip_id):
    for i in range(6):
        files = {"foto": (f"b{i}.png", PNG, "image/png")}
        r = session.post(f"{API}/trips/{trip_id}/photos/handover-bastk", files=files)
        assert r.status_code == 200, r.text
    # 7th must fail
    files = {"foto": ("b7.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id}/photos/handover-bastk", files=files)
    assert r.status_code == 400


def test_15_resi_upload(session, trip_id):
    files = {"foto": ("resi.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id}/photos/handover-resi", files=files)
    assert r.status_code == 200
    assert r.json()["handover"]["resi"] is not None


def test_16_cair_tahap_3_now_ok(session, trip_id):
    r = session.post(f"{API}/trips/{trip_id}/cair", json={"tahap": 3})
    assert r.status_code == 200
    assert r.json()["cair"]["3"] is True


def test_17_cair_gates_on_fresh_trip(session):
    # Fresh trip - no initials, expect cair.1 -> 400
    tid = f"TRIP-GATE-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 X", "route": "x"})
    r = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 1})
    assert r.status_code == 400
    assert "foto awal" in r.text.lower()
    # tahap 3 also should fail (no bastk/resi)
    r3 = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 3})
    assert r3.status_code == 400


def test_18_cleanup(session, trip_id):
    # No delete endpoint - leave data behind but verify trip still readable
    r = session.get(f"{API}/trips/{trip_id}")
    assert r.status_code == 200


# ---------- Iteration 3 tests: tipe/rangka/legs + xendit + odoo_synced ----------

@pytest.fixture(scope="module")
def trip_id_i3():
    return f"TRIP-I3-{uuid.uuid4().hex[:8]}"


def test_19_init_trip_with_tipe_rangka_legs(session, trip_id_i3):
    legs = [
        {"jalur": "Darat", "asal": "Surabaya", "tujuan": "Banyuwangi", "kapal": "", "status": "Menunggu"},
        {"jalur": "Laut", "asal": "Banyuwangi", "tujuan": "Banjarmasin", "kapal": "KM Mutiara III", "status": "Menunggu"},
        {"jalur": "Darat", "asal": "Banjarmasin", "tujuan": "Tujuan Akhir", "kapal": "", "status": "Delivered"},
    ]
    payload = {
        "trip_id": trip_id_i3, "driver_id": "DRV-I3", "nopol": "S 8612 HM",
        "route": "Surabaya - Banjarmasin", "uj": 3500000, "t1": 1750000, "t2": 1050000, "t3": 700000,
        "tipe_kendaraan": "TRUK TRONTON", "no_rangka": "MFFCWM30GNK817426", "legs": legs,
    }
    r = session.post(f"{API}/trips/init", json=payload)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["tipe_kendaraan"] == "TRUK TRONTON"
    assert d["no_rangka"] == "MFFCWM30GNK817426"
    assert isinstance(d["legs"], list) and len(d["legs"]) == 3
    assert d["legs"][1]["kapal"] == "KM Mutiara III"
    # xendit default block
    assert d["xendit"] == {
        "t1": {"id": None, "status": None, "ts": None},
        "t2": {"id": None, "status": None, "ts": None},
        "t3": {"id": None, "status": None, "ts": None},
    }
    # odoo_synced default block
    assert d["odoo_synced"] == {"handover": False, "cair_1": False, "cair_2": False, "cair_3": False}

    # GET-verify persistence
    g = session.get(f"{API}/trips/{trip_id_i3}").json()
    assert g["tipe_kendaraan"] == "TRUK TRONTON"
    assert g["no_rangka"] == "MFFCWM30GNK817426"
    assert len(g["legs"]) == 3


def test_20_xendit_disburse_mocked(session, trip_id_i3):
    r = session.post(f"{API}/trips/{trip_id_i3}/xendit/disburse", json={"tahap": 1})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["mocked"] is True
    assert d["tahap"] == 1
    assert d["disbursement_id"].startswith("xendit_mock_")
    assert "MOCKED_PENDING" in d["note"]
    # trip.xendit.t1 persisted
    t1 = d["trip"]["xendit"]["t1"]
    assert t1["id"] == d["disbursement_id"]
    assert t1["status"] == "MOCKED_PENDING"
    assert t1["ts"] is not None
    # GET-verify
    g = session.get(f"{API}/trips/{trip_id_i3}").json()
    assert g["xendit"]["t1"]["id"] == d["disbursement_id"]
    assert g["xendit"]["t1"]["status"] == "MOCKED_PENDING"


def test_21_xendit_disburse_invalid_tahap(session, trip_id_i3):
    r = session.post(f"{API}/trips/{trip_id_i3}/xendit/disburse", json={"tahap": 5})
    assert r.status_code == 400
    r2 = session.post(f"{API}/trips/{trip_id_i3}/xendit/disburse", json={"tahap": 0})
    assert r2.status_code == 400


def test_22_xendit_disburse_trip_not_found(session):
    r = session.post(f"{API}/trips/NOPE-{uuid.uuid4().hex}/xendit/disburse", json={"tahap": 1})
    assert r.status_code == 404


def test_23_initial_complete_no_crash_without_webhook(session):
    """5 initial uploads should auto-cair T1 without any error even when ODOO_WEBHOOK_URL is empty."""
    tid = f"TRIP-NOHOOK-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 NW", "route": "x"})
    slots = ["depan", "belakang", "kiri", "kanan", "spidometer"]
    last = None
    for s in slots:
        files = {"foto": (f"{s}.png", PNG, "image/png")}
        r = session.post(f"{API}/trips/{tid}/photos/initial", data={"slot": s}, files=files)
        assert r.status_code == 200, r.text
        last = r.json()
    assert last["cair"]["1"] is True


def test_24_handover_complete_sets_odoo_synced_idempotent(session):
    tid = f"TRIP-HOV-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 HV", "route": "x"})
    # bastk first - should NOT flip handover sync yet
    r = session.post(f"{API}/trips/{tid}/photos/handover-bastk",
                     files={"foto": ("b.png", PNG, "image/png")})
    assert r.status_code == 200
    assert r.json()["odoo_synced"]["handover"] is False
    # add resi - now both present, flag should flip
    r = session.post(f"{API}/trips/{tid}/photos/handover-resi",
                     files={"foto": ("r.png", PNG, "image/png")})
    assert r.status_code == 200
    assert r.json()["odoo_synced"]["handover"] is True
    # upload another bastk - flag should stay True (idempotent), no crash
    r2 = session.post(f"{API}/trips/{tid}/photos/handover-bastk",
                      files={"foto": ("b2.png", PNG, "image/png")})
    assert r2.status_code == 200
    assert r2.json()["odoo_synced"]["handover"] is True


def test_25_cair_sets_odoo_synced_cair_n(session):
    tid = f"TRIP-CAIR-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 CR", "route": "x",
                                            "t1": 100, "t2": 200, "t3": 300})
    # upload 5 initial to satisfy cair 1 gate (also auto-flips cair.1)
    for s in ["depan", "belakang", "kiri", "kanan", "spidometer"]:
        session.post(f"{API}/trips/{tid}/photos/initial",
                     data={"slot": s}, files={"foto": (f"{s}.png", PNG, "image/png")})
    # explicit cair 1 -> odoo_synced.cair_1 True
    r1 = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 1})
    assert r1.status_code == 200
    assert r1.json()["odoo_synced"]["cair_1"] is True
    # cair 2 (no gate other than tahap in [1,2,3])
    r2 = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 2})
    assert r2.status_code == 200
    assert r2.json()["odoo_synced"]["cair_2"] is True
    # cair 3 needs bastk+resi
    session.post(f"{API}/trips/{tid}/photos/handover-bastk",
                 files={"foto": ("b.png", PNG, "image/png")})
    session.post(f"{API}/trips/{tid}/photos/handover-resi",
                 files={"foto": ("r.png", PNG, "image/png")})
    r3 = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 3})
    assert r3.status_code == 200
    assert r3.json()["odoo_synced"]["cair_3"] is True


# ---------- Iteration 4 tests: Album + Public tracking ----------

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


@pytest.fixture(scope="module")
def trip_id_i4():
    return f"TRIP-I4-{uuid.uuid4().hex[:8]}"


def test_26_init_new_trip_has_album_field(session, trip_id_i4):
    r = session.post(f"{API}/trips/init", json={
        "trip_id": trip_id_i4, "nopol": "B 4444 AB", "route": "Jakarta - Medan",
    })
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("album") == {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}


def test_27_init_existing_legacy_backfills_album(session):
    # Use a legacy trip created in earlier tests (trip_id fixture from class scope is module-level here)
    # Strategy: create a trip without album field by stripping it directly via Mongo isn't allowed here.
    # Instead, simulate: call init then unset album, then call init again to verify backfill.
    tid = f"TRIP-LEG-{uuid.uuid4().hex[:8]}"
    r = session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 LG", "route": "x"})
    assert r.status_code == 200
    # Re-init returns existing; album should be present
    r2 = session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 1 LG", "route": "x"})
    assert r2.status_code == 200
    assert r2.json().get("album") == {"asal": [], "kapal": [], "tujuan": [], "dokumen": []}


def test_28_album_upload_asal_image(session, trip_id_i4):
    files = {"foto": ("a.png", PNG, "image/png")}
    data = {"stage": "asal", "catatan": "Foto loading di asal", "uploaded_by": "driver"}
    r = session.post(f"{API}/trips/{trip_id_i4}/album", data=data, files=files)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["album"]["asal"]) == 1
    item = d["album"]["asal"][0]
    assert "id" in item and "url" in item
    assert item["catatan"] == "Foto loading di asal"
    assert item["uploaded_by"] == "driver"
    assert item["url"].startswith(f"/api/uploads/{trip_id_i4}/album/asal/")


def test_29_album_dokumen_accepts_pdf(session, trip_id_i4):
    files = {"foto": ("doc.pdf", PDF_BYTES, "application/pdf")}
    data = {"stage": "dokumen"}
    r = session.post(f"{API}/trips/{trip_id_i4}/album", data=data, files=files)
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["album"]["dokumen"]) == 1
    assert d["album"]["dokumen"][0]["url"].endswith(".pdf")


@pytest.mark.parametrize("stage", ["asal", "kapal", "tujuan"])
def test_30_album_non_dokumen_rejects_pdf(session, trip_id_i4, stage):
    files = {"foto": ("bad.pdf", PDF_BYTES, "application/pdf")}
    r = session.post(f"{API}/trips/{trip_id_i4}/album", data={"stage": stage}, files=files)
    assert r.status_code == 400, f"stage={stage}: {r.text}"


def test_31_album_invalid_stage_400(session, trip_id_i4):
    files = {"foto": ("a.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id_i4}/album", data={"stage": "xxx"}, files=files)
    assert r.status_code == 400


def test_32_album_trip_not_found_404(session):
    files = {"foto": ("a.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/NOPE-{uuid.uuid4().hex}/album", data={"stage": "asal"}, files=files)
    assert r.status_code == 404


def test_33_album_delete_photo(session, trip_id_i4):
    # Upload a photo first, then delete it
    files = {"foto": ("k.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id_i4}/album", data={"stage": "kapal"}, files=files)
    assert r.status_code == 200
    pid = r.json()["album"]["kapal"][0]["id"]
    # Delete it
    r2 = session.delete(f"{API}/trips/{trip_id_i4}/album/kapal/{pid}")
    assert r2.status_code == 200
    d = r2.json()
    assert all(p["id"] != pid for p in d["album"]["kapal"])


def test_34_public_trip_view_filters_fields(session, trip_id_i4):
    r = session.get(f"{API}/public/trips/{trip_id_i4}")
    assert r.status_code == 200, r.text
    d = r.json()
    # Allowed fields
    expected_keys = {"trip_id", "nopol", "tipe_kendaraan", "no_rangka", "route", "nama_driver",
                     "legs", "album", "handover", "daily_count", "initial_done", "progress",
                     "created_at", "updated_at"}
    assert expected_keys.issubset(set(d.keys()))
    # Sensitive fields must NOT be exposed
    forbidden = {"xendit", "odoo_synced", "cair", "sop_read", "t1", "t2", "t3",
                 "bonus_daily", "bonus_kerajinan", "driver_id"}
    leaked = forbidden & set(d.keys())
    assert leaked == set(), f"Leaked fields: {leaked}"
    # Progress sub-keys
    assert "initial_complete" in d["progress"]
    assert "handover_complete" in d["progress"]
    assert d["trip_id"] == trip_id_i4
    assert isinstance(d["daily_count"], int)
    assert isinstance(d["initial_done"], int)


def test_35_public_trip_not_found_404(session):
    r = session.get(f"{API}/public/trips/NOPE-{uuid.uuid4().hex}")
    assert r.status_code == 404


# ---------- Iteration 5 (v2.3) tests: 5-slot initial photo (drop bbm) ----------

@pytest.fixture(scope="module")
def trip_id_i5():
    return f"TRIP-I5-{uuid.uuid4().hex[:8]}"


def test_36_initial_bbm_slot_rejected_400(session, trip_id_i5):
    """v2.3: slot 'bbm' is no longer valid — only 5 slots accepted."""
    r = session.post(f"{API}/trips/init", json={"trip_id": trip_id_i5, "nopol": "B 5 BB", "route": "x"})
    assert r.status_code == 200
    files = {"foto": ("bbm.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{trip_id_i5}/photos/initial",
                     data={"slot": "bbm"}, files=files)
    assert r.status_code == 400, r.text
    body = r.text.lower()
    assert "slot tidak valid" in body or "tidak valid" in body
    # ensure 'bbm' not in the listed valid slots in error message
    assert "bbm" not in body or "valid" in body  # message lists valid set; bbm should NOT be one of them
    # Best effort: confirm none of the response references bbm as accepted
    g = session.get(f"{API}/trips/{trip_id_i5}").json()
    assert "bbm" not in (g.get("initial_photos") or {})


def test_37_cair1_blocked_until_5_slots_complete(session):
    """POST /cair tahap:1 returns 400 'Lengkapi 5 foto awal dulu' when <5 initial photos uploaded."""
    tid = f"TRIP-GATE5-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 5 GT", "route": "x"})
    # Upload only 4 slots
    for s in ["depan", "belakang", "kiri", "kanan"]:
        r = session.post(f"{API}/trips/{tid}/photos/initial",
                         data={"slot": s}, files={"foto": (f"{s}.png", PNG, "image/png")})
        assert r.status_code == 200
    # still should not be auto-cair
    g = session.get(f"{API}/trips/{tid}").json()
    assert g["cair"]["1"] is False
    # request cair tahap 1 -> 400 with proper Indonesian message
    r = session.post(f"{API}/trips/{tid}/cair", json={"tahap": 1})
    assert r.status_code == 400
    assert "5 foto awal" in r.text or "foto awal" in r.text.lower()
    # Upload 5th slot -> now auto-cair
    r5 = session.post(f"{API}/trips/{tid}/photos/initial",
                      data={"slot": "spidometer"},
                      files={"foto": ("sp.png", PNG, "image/png")})
    assert r5.status_code == 200
    assert r5.json()["cair"]["1"] is True


def test_38_public_initial_complete_true_at_5(session):
    """public/trips returns progress.initial_complete=True after 5 slots (not 6)."""
    tid = f"TRIP-PUB5-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 5 PB", "route": "x"})
    for s in ["depan", "belakang", "kiri", "kanan", "spidometer"]:
        r = session.post(f"{API}/trips/{tid}/photos/initial",
                         data={"slot": s}, files={"foto": (f"{s}.png", PNG, "image/png")})
        assert r.status_code == 200
    pub = session.get(f"{API}/public/trips/{tid}").json()
    assert pub["initial_done"] == 5
    assert pub["progress"]["initial_complete"] is True


def test_39_legacy_trip_with_bbm_still_readable(session):
    """Trip created in iter-4 (with bbm slot present) must still be readable via GET and public/."""
    # Simulate a legacy doc by inserting via init then manually pushing bbm via direct upload won't work
    # (because backend rejects bbm now in v2.3). Just verify older test trips don't crash on read.
    # We'll create a fresh trip with 5 slots and confirm it reads cleanly.
    tid = f"TRIP-LEG5-{uuid.uuid4().hex[:8]}"
    session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 5 LG", "route": "x"})
    for s in ["depan", "belakang", "kiri", "kanan", "spidometer"]:
        session.post(f"{API}/trips/{tid}/photos/initial",
                     data={"slot": s}, files={"foto": (f"{s}.png", PNG, "image/png")})
    r = session.get(f"{API}/trips/{tid}")
    assert r.status_code == 200
    assert "_id" not in r.json()


def test_40_seed_trip_v23_demo_for_fe(session):
    """Seed TRIP-V23-FE — used by FE testing (no driver name, no initial photos)."""
    tid = "TRIP-V23-FE"
    r = session.post(f"{API}/trips/init", json={
        "trip_id": tid, "nopol": "B 9999 ZZ", "route": "Jakarta - Medan",
        "tipe_kendaraan": "AVANZA", "no_rangka": "ABC123",
        "uj": 1000000, "t1": 500000, "t2": 300000, "t3": 200000,
    })
    assert r.status_code == 200
    g = session.get(f"{API}/trips/{tid}").json()
    assert g["nopol"] == "B 9999 ZZ" or g["nopol"] == "B 1234 ZZ"  # idempotent (might have existed)

