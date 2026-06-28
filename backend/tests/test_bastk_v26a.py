"""Backend tests for BASTK v2.6a — vehicle type, damage marks, customer_data, signatures, catatan + public read."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://fleet-location-app-2.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"
TRIP_ID = "TRIP-POD-DEMO"


@pytest.fixture(scope="module")
def trip_exists():
    r = requests.get(f"{API}/trips/{TRIP_ID}")
    if r.status_code != 200:
        # init
        requests.post(f"{API}/trips/init", json={
            "trip_id": TRIP_ID, "nopol": "B 1234 POD", "route": "Jakarta-Bandung",
        })
    return True


# ---- vehicle_type validation ----
def test_invalid_vehicle_type_returns_400(trip_exists):
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json={"vehicle_type": "XYZ"})
    assert r.status_code == 400


def test_valid_vehicle_type_saved(trip_exists):
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json={"vehicle_type": "Truck Box"})
    assert r.status_code == 200
    assert r.json().get("vehicle_type") == "Truck Box"
    # persist check
    g = requests.get(f"{API}/public/trips/{TRIP_ID}").json()
    assert g.get("vehicle_type") == "Truck Box"


def test_all_20_vehicle_types_accepted(trip_exists):
    types = ["Sedan", "MPV", "SUV", "Pickup", "Double Cabin", "CDD", "Truck Box",
             "Dump Truck", "Tangki", "Tronton", "Box Besar", "Canter", "Canter Pemadam",
             "Motor 2 Roda", "Motor 3 Roda", "Forklift", "Excavator", "Dozer",
             "Grader", "Vibro Roller"]
    assert len(types) == 20
    for t in types:
        r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json={"vehicle_type": t})
        assert r.status_code == 200, f"Failed for {t}"


# ---- damage_marks filtering / clamping ----
def test_damage_marks_invalid_code_filtered(trip_exists):
    payload = {
        "damage_marks": [
            {"code": "RSK", "x": 10, "y": 20},
            {"code": "XX", "x": 30, "y": 40},
            {"code": "B", "x": 50, "y": 60},
        ]
    }
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    marks = r.json().get("damage_marks") or []
    codes = [m["code"] for m in marks]
    assert "XX" not in codes
    assert "RSK" in codes and "B" in codes
    assert len(marks) == 2


def test_damage_marks_xy_clamped(trip_exists):
    payload = {
        "damage_marks": [
            {"code": "P", "x": 150, "y": -20},
            {"code": "PC", "x": -5, "y": 250},
        ]
    }
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    marks = r.json().get("damage_marks") or []
    assert len(marks) == 2
    for m in marks:
        assert 0.0 <= m["x"] <= 100.0
        assert 0.0 <= m["y"] <= 100.0
    assert marks[0]["x"] == 100.0 and marks[0]["y"] == 0.0
    assert marks[1]["x"] == 0.0 and marks[1]["y"] == 100.0


def test_all_6_damage_codes_valid(trip_exists):
    codes = ["RSK", "B", "P", "PC", "CL", "L"]
    payload = {"damage_marks": [{"code": c, "x": 50, "y": 50} for c in codes]}
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    saved = [m["code"] for m in r.json().get("damage_marks") or []]
    assert set(saved) == set(codes)


# ---- customer_data whitelist + truncate ----
def test_customer_data_whitelist_and_truncate(trip_exists):
    long_alamat = "A" * 500
    payload = {"customer_data": {
        "nama": "PT TEST", "hp": "08111111111", "alamat": long_alamat,
        "pic": "John", "warna": "Hitam", "tahun": "2024",
        "km": "12345", "kondisi": "Bekas",
        "evil_field": "DROP TABLE",
    }}
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    cd = r.json().get("customer_data") or {}
    assert "evil_field" not in cd
    assert cd["nama"] == "PT TEST"
    assert len(cd["alamat"]) == 300  # truncated
    assert cd["kondisi"] == "Bekas"


# ---- signatures ----
def test_signatures_dataurl_only(trip_exists):
    payload = {"signatures": {
        "driver": "data:image/png;base64,iVBORw0KGgo=",
        "customer": "invalid",
        "admin": "data:image/jpeg;base64,/9j/4AAQ=",
    }}
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    sigs = r.json().get("signatures") or {}
    assert sigs.get("driver", "").startswith("data:image")
    assert sigs.get("admin", "").startswith("data:image")
    # customer should NOT be set to "invalid"
    assert sigs.get("customer") != "invalid"


# ---- catatan ----
def test_catatan_truncate_500(trip_exists):
    payload = {"catatan": "Z" * 800}
    r = requests.post(f"{API}/trips/{TRIP_ID}/bastk", json=payload)
    assert r.status_code == 200
    assert len(r.json().get("bastk_catatan") or "") == 500


# ---- public endpoint exposes BASTK fields ----
def test_public_endpoint_exposes_bastk_fields(trip_exists):
    requests.post(f"{API}/trips/{TRIP_ID}/bastk", json={
        "vehicle_type": "Tronton",
        "catatan": "test public expose",
        "customer_data": {"nama": "PT Public", "hp": "0811",
                          "alamat": "Jl Test", "pic": "", "warna": "",
                          "tahun": "", "km": "", "kondisi": "Baru"},
    })
    r = requests.get(f"{API}/public/trips/{TRIP_ID}")
    assert r.status_code == 200
    body = r.json()
    for key in ("vehicle_type", "damage_marks", "customer_data", "signatures", "bastk_catatan"):
        assert key in body, f"missing {key} in public endpoint"
    assert body["vehicle_type"] == "Tronton"
    assert body["bastk_catatan"] == "test public expose"
    assert body["customer_data"]["nama"] == "PT Public"


# ---- 404 case ----
def test_bastk_unknown_trip_404():
    r = requests.post(f"{API}/trips/NOPE-NOTFOUND-XYZ/bastk", json={"vehicle_type": "Sedan"})
    assert r.status_code == 404


# ---- regression: existing endpoints still work ----
def test_regression_get_trip_works(trip_exists):
    r = requests.get(f"{API}/trips/{TRIP_ID}")
    assert r.status_code == 200
    assert r.json().get("trip_id") == TRIP_ID


def test_regression_trip_init_idempotent():
    r = requests.post(f"{API}/trips/init", json={
        "trip_id": TRIP_ID, "nopol": "B 1234 POD", "route": "Jakarta-Bandung",
    })
    assert r.status_code == 200
    assert r.json().get("trip_id") == TRIP_ID


def test_regression_public_endpoint_basic_fields(trip_exists):
    r = requests.get(f"{API}/public/trips/{TRIP_ID}")
    assert r.status_code == 200
    body = r.json()
    for key in ("trip_id", "nopol", "route", "nama_driver", "album",
                "handover", "daily_checkpoints", "initial_done", "progress"):
        assert key in body
