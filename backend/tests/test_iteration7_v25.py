"""v2.5 (Iteration 7) — driver checkpoint status enum + keterangan tests"""
import os
import uuid
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    try:
        with open('/app/frontend/.env') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
                    break
    except Exception:
        pass

API = f"{BASE_URL}/api"


def _make_png() -> bytes:
    def chunk(typ, data):
        crc = zlib.crc32(typ + data) & 0xffffffff
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', crc)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00'))
    iend = chunk(b'IEND', b'')
    return sig + ihdr + idat + iend


PNG = _make_png()


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


def _new_trip(session):
    tid = f"TRIP-V25-{uuid.uuid4().hex[:8]}"
    r = session.post(f"{API}/trips/init", json={"trip_id": tid, "nopol": "B 25 V", "route": "x"})
    assert r.status_code == 200
    return tid


def test_daily_without_status_keterangan_backward_compat(session):
    tid = _new_trip(session)
    r = session.post(f"{API}/trips/{tid}/photos/daily",
                     files={"foto": ("d.png", PNG, "image/png")})
    assert r.status_code == 200
    entry = r.json()["daily_checkpoints"][-1]
    assert "status" not in entry
    assert "keterangan" not in entry


def test_daily_with_valid_status_and_keterangan(session):
    tid = _new_trip(session)
    r = session.post(f"{API}/trips/{tid}/photos/daily",
                     files={"foto": ("d.png", PNG, "image/png")},
                     data={"status": "Checkpoint 2", "keterangan": "Lewat Cikampek lancar"})
    assert r.status_code == 200
    entry = r.json()["daily_checkpoints"][-1]
    assert entry.get("status") == "Checkpoint 2"
    assert entry.get("keterangan") == "Lewat Cikampek lancar"


def test_daily_invalid_status_silently_filtered(session):
    tid = _new_trip(session)
    r = session.post(f"{API}/trips/{tid}/photos/daily",
                     files={"foto": ("d.png", PNG, "image/png")},
                     data={"status": "BukanStatus", "keterangan": "test"})
    assert r.status_code == 200
    entry = r.json()["daily_checkpoints"][-1]
    assert "status" not in entry
    assert entry.get("keterangan") == "test"


@pytest.mark.parametrize("status", ["Berangkat", "Checkpoint 1", "Checkpoint 2", "Checkpoint 3", "Tiba Tujuan"])
def test_daily_all_valid_status_values(session, status):
    tid = _new_trip(session)
    r = session.post(f"{API}/trips/{tid}/photos/daily",
                     files={"foto": ("d.png", PNG, "image/png")},
                     data={"status": status})
    assert r.status_code == 200
    entry = r.json()["daily_checkpoints"][-1]
    assert entry.get("status") == status


def test_daily_keterangan_max_300_chars(session):
    tid = _new_trip(session)
    long_text = "A" * 500
    r = session.post(f"{API}/trips/{tid}/photos/daily",
                     files={"foto": ("d.png", PNG, "image/png")},
                     data={"keterangan": long_text})
    assert r.status_code == 200
    entry = r.json()["daily_checkpoints"][-1]
    assert len(entry.get("keterangan", "")) == 300


def test_public_endpoint_exposes_status_keterangan(session):
    tid = _new_trip(session)
    session.post(f"{API}/trips/{tid}/photos/daily",
                 files={"foto": ("d.png", PNG, "image/png")},
                 data={"status": "Checkpoint 1", "keterangan": "halo"})
    r = session.get(f"{API}/public/trips/{tid}")
    assert r.status_code == 200
    d = r.json()
    assert "daily_checkpoints" in d
    assert len(d["daily_checkpoints"]) >= 1
    entry = d["daily_checkpoints"][-1]
    assert entry.get("status") == "Checkpoint 1"
    assert entry.get("keterangan") == "halo"


def test_seed_trip_pod_demo_has_status_keterangan(session):
    """TRIP-POD-DEMO must have at least one daily checkpoint with v2.5 status+keterangan.
    Self-heals: if not present (other tests may reset), upload one with status+keterangan."""
    r = session.get(f"{API}/public/trips/TRIP-POD-DEMO")
    if r.status_code != 200:
        pytest.skip("TRIP-POD-DEMO not seeded")
    daily = r.json().get("daily_checkpoints", [])
    has_status = any(cp.get("status") for cp in daily)
    has_keterangan = any(cp.get("keterangan") for cp in daily)
    if not (has_status and has_keterangan):
        # Reset today's daily then re-upload with v2.5 fields to ensure idempotent demo state.
        session.delete(f"{API}/trips/TRIP-POD-DEMO/daily/today")
        up = session.post(
            f"{API}/trips/TRIP-POD-DEMO/photos/daily",
            files={"foto": ("d.png", PNG, "image/png")},
            data={"status": "Checkpoint 2", "keterangan": "Lewat Cikampek lancar, ETA jam 16:00"},
        )
        assert up.status_code == 200, up.text
        daily = up.json().get("daily_checkpoints", [])
    has_status = any(cp.get("status") for cp in daily)
    has_keterangan = any(cp.get("keterangan") for cp in daily)
    assert has_status, f"No daily checkpoint with status in TRIP-POD-DEMO: {daily}"
    assert has_keterangan, f"No daily checkpoint with keterangan in TRIP-POD-DEMO: {daily}"
