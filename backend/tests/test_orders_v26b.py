"""v2.6b — Customer Orders API + Odoo ping diagnostic."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://fleet-location-app-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- POST /api/orders ----------
class TestCreateOrder:
    def test_valid_minimal(self, s):
        body = {
            "vehicle_type": "MPV",
            "asal_kota": "Jakarta",
            "tujuan_kota": "Bandung",
            "customer_nama": "TEST_PT Aman",
            "customer_hp": "0818000111",
        }
        r = s.post(f"{API}/orders", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "NEW"
        assert d["order_id"].startswith("ORD-")
        assert len(d["order_id"]) == 14  # ORD- + 10 hex upper
        assert d["created_at"] and d["updated_at"]
        assert d["asal_kota"] == "Jakarta" and d["tujuan_kota"] == "Bandung"

    def test_valid_empty_vehicle_type(self, s):
        body = {
            "vehicle_type": "",
            "asal_kota": "Solo",
            "tujuan_kota": "Yogyakarta",
            "customer_nama": "TEST_NoVT",
            "customer_hp": "0818222333",
        }
        r = s.post(f"{API}/orders", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["vehicle_type"] == ""

    def test_invalid_vehicle_type(self, s):
        body = {
            "vehicle_type": "Helikopter",
            "asal_kota": "Jakarta",
            "tujuan_kota": "Bandung",
            "customer_nama": "TEST_x",
            "customer_hp": "0818000222",
        }
        r = s.post(f"{API}/orders", json=body)
        assert r.status_code == 400

    @pytest.mark.parametrize("field", ["asal_kota", "tujuan_kota", "customer_nama", "customer_hp"])
    def test_missing_required(self, s, field):
        body = {
            "vehicle_type": "Sedan",
            "asal_kota": "A",
            "tujuan_kota": "B",
            "customer_nama": "TEST_n",
            "customer_hp": "0818",
        }
        body[field] = ""
        r = s.post(f"{API}/orders", json=body)
        assert r.status_code == 400, f"{field} should fail with 400 got {r.status_code}"

    def test_truncation(self, s):
        body = {
            "vehicle_type": "Truck Box",
            "asal_kota": "X" * 200,
            "tujuan_kota": "Y" * 200,
            "asal_alamat": "A" * 500,
            "catatan": "C" * 1000,
            "customer_nama": "N" * 300,
            "customer_hp": "0" * 80,
            "no_rangka": "R" * 100,
        }
        r = s.post(f"{API}/orders", json=body)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["asal_kota"]) == 80
        assert len(d["tujuan_kota"]) == 80
        assert len(d["asal_alamat"]) == 300
        assert len(d["catatan"]) == 500
        assert len(d["customer_nama"]) == 120
        assert len(d["customer_hp"]) == 30
        assert len(d["no_rangka"]) == 40


# ---------- GET /api/orders ----------
class TestListOrders:
    def test_list_default(self, s):
        r = s.get(f"{API}/orders")
        assert r.status_code == 200
        d = r.json()
        assert "count" in d and "items" in d
        assert isinstance(d["items"], list)
        assert d["count"] == len(d["items"])
        # newest first
        if len(d["items"]) >= 2:
            assert d["items"][0]["created_at"] >= d["items"][1]["created_at"]

    def test_list_limit(self, s):
        r = s.get(f"{API}/orders?limit=1")
        assert r.status_code == 200
        assert len(r.json()["items"]) <= 1

    def test_list_filter_status_new(self, s):
        r = s.get(f"{API}/orders?status=NEW")
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it["status"] == "NEW"

    def test_list_filter_status_no_match(self, s):
        r = s.get(f"{API}/orders?status=COMPLETED")
        assert r.status_code == 200
        # may be empty if no completed orders
        for it in r.json()["items"]:
            assert it["status"] == "COMPLETED"


# ---------- GET /api/orders/{id} ----------
class TestGetOrder:
    def test_get_existing(self, s):
        # create one
        body = {
            "vehicle_type": "Sedan", "asal_kota": "JKT", "tujuan_kota": "BDG",
            "customer_nama": "TEST_Get", "customer_hp": "08180001",
        }
        c = s.post(f"{API}/orders", json=body).json()
        oid = c["order_id"]
        r = s.get(f"{API}/orders/{oid}")
        assert r.status_code == 200
        assert r.json()["order_id"] == oid
        assert r.json()["customer_nama"] == "TEST_Get"

    def test_get_404(self, s):
        r = s.get(f"{API}/orders/ORD-NOTFOUND00")
        assert r.status_code == 404


# ---------- Odoo ping ----------
class TestOdooPing:
    def test_ping_returns_disabled_when_no_env(self, s):
        r = s.get(f"{API}/odoo/ping")
        assert r.status_code == 200, r.text
        d = r.json()
        # Either disabled (default in this env) or enabled if user filled env
        if not d.get("enabled"):
            assert "reason" in d
            assert "missing" in d["reason"].lower()


# ---------- Regression: existing endpoints intact ----------
class TestRegression:
    def test_root_v26b(self, s):
        r = s.get(f"{API}/")
        assert r.status_code == 200
        assert "v" in r.json()

    def test_trip_get_demo(self, s):
        r = s.get(f"{API}/trips/TRIP-POD-DEMO")
        # Either exists from seed or 404; both are fine for regression
        assert r.status_code in (200, 404)

    def test_public_demo(self, s):
        r = s.get(f"{API}/public/trips/TRIP-POD-DEMO")
        assert r.status_code in (200, 404)

    def test_trip_init_idempotent(self, s):
        body = {"trip_id": "TEST_TRIP_REG_V26B", "nopol": "B 9999 REG", "route": "JKT-BDG"}
        r1 = s.post(f"{API}/trips/init", json=body)
        assert r1.status_code == 200
        r2 = s.post(f"{API}/trips/init", json=body)
        assert r2.status_code == 200
        assert r1.json()["trip_id"] == r2.json()["trip_id"]
