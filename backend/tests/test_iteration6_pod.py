"""Iteration 6 (v2.4) — Proof of Delivery: lat/lng on daily checkpoint + public daily_checkpoints field."""
import os
import uuid
import pytest
import requests
from test_driver_checkpoint import PNG, BASE_URL, API


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


def _init(session, tid, **kw):
    payload = {"trip_id": tid, "nopol": "B 1 PD", "route": "x"}
    payload.update(kw)
    r = session.post(f"{API}/trips/init", json=payload)
    assert r.status_code == 200, r.text
    return r


def test_v24_root_returns_2_4(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert isinstance(r.json().get("v"), str) and r.json().get("v")


def test_daily_upload_without_latlng_backward_compat(session):
    tid = f"TRIP-PD-NOGPS-{uuid.uuid4().hex[:8]}"
    _init(session, tid)
    session.delete(f"{API}/trips/{tid}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    r = session.post(f"{API}/trips/{tid}/photos/daily", files=files)
    assert r.status_code == 200, r.text
    d = r.json()
    daily = d["daily_checkpoints"]
    assert len(daily) >= 1
    last = daily[-1]
    assert "id" in last and "url" in last and "date" in last and "ts" in last
    # lat/lng must NOT exist when not provided
    assert "lat" not in last, f"Unexpected lat field: {last}"
    assert "lng" not in last, f"Unexpected lng field: {last}"


def test_daily_upload_with_latlng_persists_float(session):
    tid = f"TRIP-PD-GPS-{uuid.uuid4().hex[:8]}"
    _init(session, tid)
    session.delete(f"{API}/trips/{tid}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    data = {"lat": "-6.2088", "lng": "106.8456"}
    r = session.post(f"{API}/trips/{tid}/photos/daily", files=files, data=data)
    assert r.status_code == 200, r.text
    d = r.json()
    last = d["daily_checkpoints"][-1]
    assert "lat" in last and "lng" in last
    assert isinstance(last["lat"], float)
    assert isinstance(last["lng"], float)
    assert last["lat"] == pytest.approx(-6.2088, abs=1e-6)
    assert last["lng"] == pytest.approx(106.8456, abs=1e-6)

    # GET-verify persistence
    g = session.get(f"{API}/trips/{tid}").json()
    last_g = g["daily_checkpoints"][-1]
    assert last_g["lat"] == pytest.approx(-6.2088, abs=1e-6)
    assert last_g["lng"] == pytest.approx(106.8456, abs=1e-6)


def test_public_returns_daily_checkpoints_array_with_gps(session):
    tid = f"TRIP-PD-PUB-{uuid.uuid4().hex[:8]}"
    _init(session, tid)
    session.delete(f"{API}/trips/{tid}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    data = {"lat": "-6.2088", "lng": "106.8456"}
    session.post(f"{API}/trips/{tid}/photos/daily", files=files, data=data)

    pub = session.get(f"{API}/public/trips/{tid}").json()
    assert "daily_checkpoints" in pub, f"Public must expose daily_checkpoints. Keys: {list(pub.keys())}"
    assert "daily_count" in pub  # legacy field also still present
    arr = pub["daily_checkpoints"]
    assert isinstance(arr, list) and len(arr) == 1
    cp = arr[0]
    # Required fields
    for k in ("id", "date", "url", "ts"):
        assert k in cp, f"Missing field {k} in public daily checkpoint: {cp}"
    # Optional lat/lng should be present here
    assert cp.get("lat") == pytest.approx(-6.2088, abs=1e-6)
    assert cp.get("lng") == pytest.approx(106.8456, abs=1e-6)


def test_public_old_entry_without_gps_remains_valid(session):
    tid = f"TRIP-PD-PUB-NOGPS-{uuid.uuid4().hex[:8]}"
    _init(session, tid)
    session.delete(f"{API}/trips/{tid}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    session.post(f"{API}/trips/{tid}/photos/daily", files=files)
    pub = session.get(f"{API}/public/trips/{tid}").json()
    arr = pub["daily_checkpoints"]
    assert isinstance(arr, list) and len(arr) == 1
    cp = arr[0]
    # Old entries: lat/lng may be missing entirely (backward compat)
    assert "lat" not in cp or cp.get("lat") is None
    assert "lng" not in cp or cp.get("lng") is None


def test_seed_trip_pod_demo(session):
    """Seed TRIP-POD-DEMO with one GPS-tagged daily checkpoint for FE testing."""
    tid = "TRIP-POD-DEMO"
    session.post(f"{API}/trips/init", json={
        "trip_id": tid, "nopol": "B 2024 PD", "route": "Jakarta - Surabaya",
        "tipe_kendaraan": "TRONTON", "no_rangka": "POD-DEMO-RANGKA",
        "uj": 3500000, "t1": 1750000, "t2": 1050000, "t3": 700000,
    })
    # set driver name
    session.post(f"{API}/trips/{tid}/driver-name", json={"nama": "Driver Demo PoD"})
    # ensure clean daily for today, then re-upload with GPS
    session.delete(f"{API}/trips/{tid}/daily/today")
    files = {"foto": ("d.png", PNG, "image/png")}
    data = {"lat": "-6.2088", "lng": "106.8456"}
    r = session.post(f"{API}/trips/{tid}/photos/daily", files=files, data=data)
    assert r.status_code == 200
    pub = session.get(f"{API}/public/trips/{tid}").json()
    assert len(pub["daily_checkpoints"]) >= 1
    last = pub["daily_checkpoints"][-1]
    assert last.get("lat") == pytest.approx(-6.2088, abs=1e-6)


def test_integration_doc_exists():
    """v2.4 admin PHP integration snippet doc must exist with all 5 sections."""
    path = "/app/INTEGRATION_PO_ADMIN_PHP.md"
    assert os.path.exists(path), f"Missing {path}"
    with open(path) as f:
        content = f.read()
    # Required snippet anchors
    assert "REACT_APP_URL" in content
    assert "kirimLinkCheckpoint" in content
    assert "copyLinkTracking" in content or "Copy Link Tracking" in content
    assert "ODOO_WEBHOOK_URL" in content
    assert "xendit_disburse" in content or "Xendit" in content
