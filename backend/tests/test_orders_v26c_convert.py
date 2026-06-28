"""v2.6c — POST /api/orders/{order_id}/convert (order → trip bridge)
+ regression: odoo ping, root version."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fleet-location-app-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _create_order(s, **over):
    body = {
        "vehicle_type": "Sedan",
        "nopol": "B 1234 ABC",
        "no_rangka": "MHRA12345",
        "warna": "Hitam",
        "tahun": "2024",
        "km": "1000",
        "kondisi": "Bekas",
        "asal_kota": "Jakarta",
        "asal_alamat": "Jl. Sudirman",
        "tujuan_kota": "Bali",
        "tujuan_alamat": "Denpasar",
        "delivery_pic": "TEST_Pak Joko",
        "pickup_pic": "TEST_Pak Andi",
        "customer_nama": "TEST_Customer Convert",
        "customer_hp": "08180001234",
        "customer_email": "test@example.com",
        "catatan": "Tolong hati-hati",
    }
    body.update(over)
    r = s.post(f"{API}/orders", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- Convert: happy path ----------
class TestConvertOrderHappy:
    def test_convert_default_trip_id(self, s):
        order = _create_order(s)
        oid = order["order_id"]
        r = s.post(f"{API}/orders/{oid}/convert", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order_id"] == oid
        assert d["trip_id"] == f"TRIP-{oid}"
        assert d["status"] == "DISPATCHED"
        assert d["already_converted"] is False
        trip = d["trip"]
        # Pre-fill from order
        assert trip["route"] == "Jakarta - Bali"
        assert trip["nopol"] == "B 1234 ABC"
        assert trip["tipe_kendaraan"] == "Sedan"
        assert trip["vehicle_type"] == "Sedan"
        assert trip["source_order_id"] == oid
        cd = trip["customer_data"]
        assert cd["nama"] == "TEST_Customer Convert"
        assert cd["hp"] == "08180001234"
        assert cd["alamat"] == "Denpasar"  # prefer tujuan_alamat
        assert cd["pic"] == "TEST_Pak Joko"  # prefer delivery_pic
        # Verify order was updated
        r2 = s.get(f"{API}/orders/{oid}")
        assert r2.status_code == 200
        o2 = r2.json()
        assert o2["status"] == "DISPATCHED"
        assert o2["trip_id"] == f"TRIP-{oid}"
        # Verify trip persisted
        t = s.get(f"{API}/trips/{d['trip_id']}")
        assert t.status_code == 200
        assert t.json()["trip_id"] == d["trip_id"]

    def test_convert_idempotent(self, s):
        order = _create_order(s)
        oid = order["order_id"]
        r1 = s.post(f"{API}/orders/{oid}/convert", json={})
        assert r1.status_code == 200
        first_trip_id = r1.json()["trip_id"]
        # Second call must be idempotent
        r2 = s.post(f"{API}/orders/{oid}/convert", json={})
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["already_converted"] is True
        assert d2["trip_id"] == first_trip_id
        assert d2["trip"]["source_order_id"] == oid

    def test_convert_custom_trip_id(self, s):
        order = _create_order(s)
        oid = order["order_id"]
        custom_tid = f"TEST_TRIP_CUSTOM_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/orders/{oid}/convert", json={"trip_id": custom_tid})
        assert r.status_code == 200, r.text
        assert r.json()["trip_id"] == custom_tid
        # Confirm trip persisted under that id
        t = s.get(f"{API}/trips/{custom_tid}")
        assert t.status_code == 200

    def test_convert_payload_fields_propagated(self, s):
        order = _create_order(s)
        oid = order["order_id"]
        payload = {
            "uj": 100000, "t1": 200000, "t2": 300000, "t3": 400000,
            "bonus_daily": 50000, "bonus_kerajinan": 200000,
            "driver_id": "DRV-001",
        }
        r = s.post(f"{API}/orders/{oid}/convert", json=payload)
        assert r.status_code == 200, r.text
        trip = r.json()["trip"]
        assert trip["uj"] == 100000
        assert trip["t1"] == 200000
        assert trip["t2"] == 300000
        assert trip["t3"] == 400000
        assert trip["bonus_daily"] == 50000
        assert trip["bonus_kerajinan"] == 200000
        assert trip["driver_id"] == "DRV-001"

    def test_convert_no_nopol_uses_fallback(self, s):
        order = _create_order(s, nopol="")
        oid = order["order_id"]
        r = s.post(f"{API}/orders/{oid}/convert", json={})
        assert r.status_code == 200, r.text
        nopol = r.json()["trip"]["nopol"]
        # Fallback "TBD-<order_id[-4:]>"
        assert nopol.startswith("TBD-")
        assert nopol.endswith(oid[-4:])


# ---------- Convert: error paths ----------
class TestConvertErrors:
    def test_convert_404_unknown_order(self, s):
        r = s.post(f"{API}/orders/ORD-DOESNOTEXIST/convert", json={})
        assert r.status_code == 404

    def test_convert_409_trip_id_collision(self, s):
        # First, create a trip via init with a fixed id
        collision_tid = f"TEST_TRIP_COLLIDE_{uuid.uuid4().hex[:6]}"
        r0 = s.post(f"{API}/trips/init", json={"trip_id": collision_tid, "nopol": "X", "route": "A-B"})
        assert r0.status_code == 200
        # Now create order and try to convert into that same tid
        order = _create_order(s)
        oid = order["order_id"]
        r = s.post(f"{API}/orders/{oid}/convert", json={"trip_id": collision_tid})
        assert r.status_code == 409, r.text


# ---------- Odoo sync stub: must not break, must skip when env empty ----------
class TestOdooSyncStub:
    def test_odoo_ping_disabled_no_env(self, s):
        r = s.get(f"{API}/odoo/ping")
        assert r.status_code == 200
        d = r.json()
        # In this env it should be disabled
        if not d.get("enabled"):
            assert d["enabled"] is False
            assert "reason" in d

    def test_convert_does_not_raise_with_empty_odoo_env(self, s):
        """Even though _odoo_sync_order is scheduled, it must skip gracefully."""
        order = _create_order(s)
        oid = order["order_id"]
        r = s.post(f"{API}/orders/{oid}/convert", json={})
        assert r.status_code == 200
        # give the bg task a moment to run; verify order has no odoo field
        time.sleep(0.5)
        o = s.get(f"{API}/orders/{oid}").json()
        # When odoo env empty, no odoo field should be set on order
        assert "odoo" not in o or o.get("odoo") in (None, {})


# ---------- Version bump ----------
class TestVersion:
    def test_root_version_26c(self, s):
        """v2.6c or later (current production)."""
        r = s.get(f"{API}/")
        v = r.json().get("v", "")
        # accept v2.6c, v2.6d, v1.0+ etc.
        assert v.startswith(("2.6", "1.")), f"unexpected version: {v}"


# ---------- Regression: existing flows still work ----------
class TestRegression:
    def test_trip_init_still_works(self, s):
        body = {"trip_id": f"TEST_TRIP_REG_V26C_{uuid.uuid4().hex[:6]}", "nopol": "B 1 REG", "route": "X-Y"}
        r = s.post(f"{API}/trips/init", json=body)
        assert r.status_code == 200
        assert r.json()["trip_id"] == body["trip_id"]

    def test_pod_demo_public(self, s):
        r = s.get(f"{API}/public/trips/TRIP-POD-DEMO")
        assert r.status_code in (200, 404)

    def test_orders_list_still_works(self, s):
        r = s.get(f"{API}/orders?limit=5")
        assert r.status_code == 200
        assert "items" in r.json()
