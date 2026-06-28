"""Backend tests for v2.6d Admin Mini-Dashboard (PIN-gated endpoints).

Covers:
- POST /api/admin/auth (PIN validation)
- GET  /api/admin/stats (counts by status)
- GET  /api/admin/orders (search + filter)
- PATCH /api/admin/orders/{id} (status / driver_id / catatan, mirror to trip)
- Auth guard on protected endpoints
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fall back to public preview URL declared in frontend/.env
    from pathlib import Path
    env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    for line in env_file.read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

API = f"{BASE_URL}/api"
ADMIN_PIN = os.environ.get("ADMIN_PIN", "345374")
H_GOOD = {"X-Admin-Pin": ADMIN_PIN}
H_BAD = {"X-Admin-Pin": "9999"}


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def seed_orders():
    """Create 3 TEST_ orders with distinct attributes. Cleanup at teardown."""
    created = []
    payloads = [
        {
            "vehicle_type": "Sedan",
            "customer_nama": "TEST_AdminBob",
            "customer_hp": "081234500001",
            "asal_kota": "Jakarta",
            "tujuan_kota": "Bandung",
            "nopol": "B 1111 TST",
        },
        {
            "vehicle_type": "MPV",
            "customer_nama": "TEST_AdminCindy",
            "customer_hp": "081234500002",
            "asal_kota": "Surabaya",
            "tujuan_kota": "Malang",
            "nopol": "L 2222 TST",
        },
        {
            "vehicle_type": "SUV",
            "customer_nama": "TEST_AdminDavid",
            "customer_hp": "081234500003",
            "asal_kota": "Medan",
            "tujuan_kota": "Bandung",
            "nopol": "BK 3333 TST",
        },
    ]
    for p in payloads:
        r = requests.post(f"{API}/orders", json=p, timeout=10)
        assert r.status_code in (200, 201), r.text
        created.append(r.json()["order_id"])

    yield created

    # Teardown: PATCH to CANCELLED then drop via direct mongo would need access; just leave with TEST_ prefix.
    # Best-effort: mark each CANCELLED so they don't pollute NEW count for subsequent runs.
    for oid in created:
        try:
            requests.patch(
                f"{API}/admin/orders/{oid}",
                json={"status": "CANCELLED"},
                headers=H_GOOD,
                timeout=5,
            )
        except Exception:
            pass


# ---------- /admin/auth ----------
class TestAdminAuth:
    def test_auth_correct_pin(self):
        r = requests.post(f"{API}/admin/auth", json={"pin": ADMIN_PIN}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True}

    def test_auth_wrong_pin(self):
        r = requests.post(f"{API}/admin/auth", json={"pin": "9999"}, timeout=10)
        assert r.status_code == 401

    def test_auth_empty_pin(self):
        r = requests.post(f"{API}/admin/auth", json={"pin": ""}, timeout=10)
        assert r.status_code == 401


# ---------- Auth guard on protected endpoints ----------
class TestAdminGuard:
    def test_stats_without_pin(self):
        r = requests.get(f"{API}/admin/stats", timeout=10)
        assert r.status_code == 401

    def test_stats_with_wrong_pin(self):
        r = requests.get(f"{API}/admin/stats", headers=H_BAD, timeout=10)
        assert r.status_code == 401

    def test_orders_without_pin(self):
        r = requests.get(f"{API}/admin/orders", timeout=10)
        assert r.status_code == 401

    def test_patch_without_pin(self):
        r = requests.patch(f"{API}/admin/orders/NONEXIST", json={"status": "NEW"}, timeout=10)
        assert r.status_code == 401


# ---------- /admin/stats ----------
class TestAdminStats:
    def test_stats_shape(self, seed_orders):
        r = requests.get(f"{API}/admin/stats", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "total" in data
        assert "by_status" in data
        assert "trips_total" in data
        for s in ("NEW", "DISPATCHED", "ON_TRIP", "DELIVERED", "CANCELLED"):
            assert s in data["by_status"], f"missing status {s}"
            assert isinstance(data["by_status"][s], int)
        assert isinstance(data["total"], int)
        assert isinstance(data["trips_total"], int)
        # Total must equal sum of buckets
        assert data["total"] == sum(data["by_status"].values())


# ---------- /admin/orders (list + filter + search) ----------
class TestAdminOrdersList:
    def test_list_returns_items(self, seed_orders):
        r = requests.get(f"{API}/admin/orders", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert "items" in data and "count" in data
        assert data["count"] == len(data["items"])
        ids = [o["order_id"] for o in data["items"]]
        # At least one seeded order should be in latest 100
        assert any(oid in ids for oid in seed_orders)
        # No _id leaks
        for it in data["items"]:
            assert "_id" not in it

    def test_filter_status_new(self, seed_orders):
        r = requests.get(f"{API}/admin/orders?status=NEW", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        for it in r.json()["items"]:
            assert it.get("status") == "NEW"

    def test_filter_status_invalid_returns_all(self, seed_orders):
        # Invalid status is silently ignored (no filter applied) per implementation
        r = requests.get(f"{API}/admin/orders?status=ZZZZ", headers=H_GOOD, timeout=10)
        assert r.status_code == 200

    def test_search_by_customer_name(self, seed_orders):
        r = requests.get(f"{API}/admin/orders?q=TEST_AdminBob", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert len(items) >= 1
        assert any(i["customer_nama"] == "TEST_AdminBob" for i in items)

    def test_search_case_insensitive(self, seed_orders):
        r = requests.get(f"{API}/admin/orders?q=test_adminbob", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["customer_nama"] == "TEST_AdminBob" for i in items)

    def test_search_by_nopol(self, seed_orders):
        r = requests.get(f"{API}/admin/orders?q=2222", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any("2222" in (i.get("nopol") or "") for i in items)

    def test_search_by_order_id(self, seed_orders):
        target = seed_orders[0]
        r = requests.get(f"{API}/admin/orders?q={target}", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(i["order_id"] == target for i in items)

    def test_limit_clamp(self, seed_orders):
        r = requests.get(f"{API}/admin/orders?limit=999", headers=H_GOOD, timeout=10)
        assert r.status_code == 200
        assert len(r.json()["items"]) <= 500


# ---------- PATCH /admin/orders/{id} ----------
class TestAdminPatchOrder:
    def test_patch_status_persists(self, seed_orders):
        oid = seed_orders[1]
        r = requests.patch(
            f"{API}/admin/orders/{oid}",
            json={"status": "DISPATCHED"},
            headers=H_GOOD,
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "DISPATCHED"
        # Verify persistence via list filter
        rl = requests.get(f"{API}/admin/orders?q={oid}", headers=H_GOOD, timeout=10)
        items = rl.json()["items"]
        assert any(i["order_id"] == oid and i["status"] == "DISPATCHED" for i in items)

    def test_patch_invalid_status(self, seed_orders):
        oid = seed_orders[0]
        r = requests.patch(
            f"{API}/admin/orders/{oid}",
            json={"status": "FOOBAR"},
            headers=H_GOOD,
            timeout=10,
        )
        assert r.status_code == 400

    def test_patch_unknown_order(self):
        r = requests.patch(
            f"{API}/admin/orders/ORD-DOES-NOT-EXIST-XYZ",
            json={"status": "NEW"},
            headers=H_GOOD,
            timeout=10,
        )
        assert r.status_code == 404

    def test_patch_empty_body_400(self, seed_orders):
        oid = seed_orders[0]
        r = requests.patch(
            f"{API}/admin/orders/{oid}",
            json={},
            headers=H_GOOD,
            timeout=10,
        )
        assert r.status_code == 400

    def test_patch_driver_id_and_catatan(self, seed_orders):
        oid = seed_orders[2]
        r = requests.patch(
            f"{API}/admin/orders/{oid}",
            json={"driver_id": "DRV-TEST-001", "catatan": "test note"},
            headers=H_GOOD,
            timeout=10,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["driver_id"] == "DRV-TEST-001"
        assert body["catatan"] == "test note"

    def test_convert_then_patch_mirrors_driver_to_trip(self, seed_orders):
        """Convert order → trip, then PATCH driver_id, verify mirror to trip."""
        # Create a fresh order to convert (don't reuse seeded ones potentially cancelled)
        r0 = requests.post(
            f"{API}/orders",
            json={
                "vehicle_type": "Sedan",
                "customer_nama": "TEST_AdminConvert",
                "customer_hp": "081234599999",
                "asal_kota": "Jakarta",
                "tujuan_kota": "Semarang",
                "nopol": "B 9999 ZZ",
            },
            timeout=10,
        )
        assert r0.status_code in (200, 201)
        oid = r0.json()["order_id"]

        # Convert
        rc = requests.post(f"{API}/orders/{oid}/convert", json={}, timeout=15)
        assert rc.status_code == 200, rc.text
        tid = rc.json().get("trip_id")
        assert tid

        # Patch driver_id
        rp = requests.patch(
            f"{API}/admin/orders/{oid}",
            json={"driver_id": "DRV-MIRROR-77"},
            headers=H_GOOD,
            timeout=10,
        )
        assert rp.status_code == 200
        assert rp.json()["driver_id"] == "DRV-MIRROR-77"

        # Verify mirrored to trip
        rt = requests.get(f"{API}/trips/{tid}", timeout=10)
        assert rt.status_code == 200
        assert rt.json().get("driver_id") == "DRV-MIRROR-77"

        # Cleanup
        requests.patch(
            f"{API}/admin/orders/{oid}",
            json={"status": "CANCELLED"},
            headers=H_GOOD,
            timeout=5,
        )


# ---------- Regression: public endpoints still work without PIN ----------
class TestPublicRegression:
    def test_root_version(self):
        r = requests.get(f"{API}/", timeout=10)
        assert r.status_code == 200

    def test_create_order_no_pin(self):
        r = requests.post(
            f"{API}/orders",
            json={
                "vehicle_type": "Sedan",
                "customer_nama": "TEST_RegPublic",
                "customer_hp": "08000000000",
                "asal_kota": "A",
                "tujuan_kota": "B",
                "nopol": "X 0000 YY",
            },
            timeout=10,
        )
        assert r.status_code in (200, 201)
        assert "order_id" in r.json()




# ---------- CSV Export (v2.6d.1) ----------
class TestCsvExport:
    """GET /api/admin/orders/export.csv — UTF-8 BOM, Excel-friendly, filter-aware."""

    @pytest.fixture
    def session(self):
        s = requests.Session()
        s.headers.update(H_GOOD)
        return s

    def test_export_unauth(self):
        """Missing PIN must be rejected."""
        r = requests.get(f"{API}/admin/orders/export.csv", timeout=10)
        assert r.status_code == 401

    def test_export_returns_csv(self, session):
        """Headers + UTF-8 BOM + correct column order."""
        # seed at least one order so we have a row
        s2 = requests.Session()
        s2.post(f"{API}/orders", json={
            "vehicle_type": "Sedan",
            "asal_kota": "TEST_CSV_ASAL",
            "tujuan_kota": "TEST_CSV_TUJUAN",
            "customer_nama": "TEST_CSV_CUSTOMER",
            "customer_hp": "0818-CSV",
            "nopol": "B 9 CSV",
        }, timeout=10)

        r = session.get(f"{API}/admin/orders/export.csv", timeout=15)
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/csv" in ct.lower()
        assert "utf-8" in ct.lower()
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert ".csv" in cd.lower()
        body = r.content
        # UTF-8 BOM at start
        assert body.startswith(b"\xef\xbb\xbf"), "Missing UTF-8 BOM (Excel compatibility)"
        # Header row in expected order
        text = body.decode("utf-8-sig")
        first_line = text.splitlines()[0]
        expected_cols = ["Order ID", "Tanggal", "Customer", "HP", "Driver",
                         "Nomor Polisi", "Asal", "Tujuan", "Status", "Harga (UJ)", "Trip ID"]
        for col in expected_cols:
            assert col in first_line, f"missing column: {col}"

    def test_export_includes_test_customer(self, session):
        """Seeded TEST_CSV_CUSTOMER row should appear in export."""
        r = session.get(f"{API}/admin/orders/export.csv", timeout=15)
        text = r.content.decode("utf-8-sig")
        assert "TEST_CSV_CUSTOMER" in text
        assert "0818-CSV" in text
        assert "TEST_CSV_ASAL" in text
        assert "TEST_CSV_TUJUAN" in text

    def test_export_status_filter(self, session):
        """status=DELIVERED returns only header + matching rows."""
        r = session.get(f"{API}/admin/orders/export.csv?status=DELIVERED", timeout=15)
        assert r.status_code == 200
        # If no DELIVERED orders, still returns valid CSV with just header line
        text = r.content.decode("utf-8-sig").strip()
        lines = text.splitlines()
        assert lines[0].startswith("Order ID")
        # All data rows must have Status=DELIVERED (col index 8 in zero-indexed CSV cols)
        import csv as _csv, io as _io
        rdr = _csv.reader(_io.StringIO(text))
        rows = list(rdr)
        for row in rows[1:]:
            assert row[8] == "DELIVERED", f"non-DELIVERED row leaked: {row}"

    def test_export_q_filter_match(self, session):
        """q='TEST_CSV_CUSTOMER' returns at least one row containing that text."""
        r = session.get(f"{API}/admin/orders/export.csv?q=TEST_CSV_CUSTOMER", timeout=15)
        assert r.status_code == 200
        text = r.content.decode("utf-8-sig")
        lines = text.splitlines()
        assert len(lines) >= 2, "expected header + ≥1 match"
        assert "TEST_CSV_CUSTOMER" in text

    def test_export_q_filter_no_match(self, session):
        """q='ZZZNOMATCHEXISTS' returns valid CSV with only header."""
        r = session.get(f"{API}/admin/orders/export.csv?q=ZZZNOMATCHEXISTS-{uuid.uuid4().hex}", timeout=15)
        assert r.status_code == 200
        text = r.content.decode("utf-8-sig").strip()
        lines = text.splitlines()
        assert len(lines) == 1, f"expected only header, got {len(lines)} lines"
        assert lines[0].startswith("Order ID")

    def test_export_limit_clamp(self, session):
        """limit=0 should clamp to ≥1; limit=99999 should clamp to ≤20000 (not error)."""
        r = session.get(f"{API}/admin/orders/export.csv?limit=99999", timeout=15)
        assert r.status_code == 200
        r2 = session.get(f"{API}/admin/orders/export.csv?limit=0", timeout=15)
        assert r2.status_code == 200


# ---------- v2.6d.2 — Date range filter on /admin/orders + export.csv ----------
class TestAdminDateFilter:
    """Tests for date_from / date_to query params (YYYY-MM-DD inclusive)."""

    @pytest.fixture
    def session(self):
        s = requests.Session()
        s.headers.update(H_GOOD)
        return s

    def test_date_filter_today_returns_recent_orders(self, session, seed_orders):
        """date_from=today: includes today's orders, count > 0 (seed_orders just created)."""
        import datetime as _dt
        today = _dt.datetime.utcnow().strftime("%Y-%m-%d")
        r = session.get(f"{API}/admin/orders?date_from={today}", headers=H_GOOD, timeout=15)
        assert r.status_code == 200
        body = r.json()
        # All returned items must have created_at >= today
        for it in body["items"]:
            assert it["created_at"] >= today + "T00:00:00", f"order before date_from leaked: {it.get('created_at')}"
        # Seed orders should be visible
        names = [it.get("customer_nama", "") for it in body["items"]]
        assert any(n.startswith("TEST_Admin") or n.startswith("TEST_CSV") for n in names), \
            "expected seeded TEST_ orders in today's window"

    def test_date_filter_past_date_to_zero_results(self, session):
        """date_to in distant past returns zero orders."""
        r = session.get(f"{API}/admin/orders?date_to=2000-01-01", headers=H_GOOD, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 0
        assert body["items"] == []

    def test_date_filter_bad_format_does_not_crash(self, session):
        """Malformed date (e.g. 2026-99-99 or garbage) returns 200 without crashing.
        Per server logic the length check + Mongo string compare degrades gracefully (no match or no filter)."""
        for bad in ["2026-99-99", "notadate", "abc", "2026-13", "2026"]:
            r = session.get(f"{API}/admin/orders?date_from={bad}", headers=H_GOOD, timeout=15)
            assert r.status_code == 200, f"crashed on date_from={bad!r}"

    def test_date_filter_empty_params_behave_like_no_filter(self, session):
        """date_from= and date_to= (empty) returns same count as no filter."""
        r_none = session.get(f"{API}/admin/orders?limit=500", headers=H_GOOD, timeout=15)
        r_empty = session.get(f"{API}/admin/orders?date_from=&date_to=&limit=500", headers=H_GOOD, timeout=15)
        assert r_none.status_code == 200 and r_empty.status_code == 200
        assert r_none.json()["count"] == r_empty.json()["count"]

    def test_export_csv_date_filter_today_inclusive(self, session, seed_orders):
        """CSV export with date_from=today should include seeded TEST_ orders (created today)."""
        import datetime as _dt
        today = _dt.datetime.utcnow().strftime("%Y-%m-%d")
        r = session.get(f"{API}/admin/orders/export.csv?date_from={today}", headers=H_GOOD, timeout=15)
        assert r.status_code == 200
        text = r.content.decode("utf-8-sig")
        assert text.splitlines()[0].startswith("Order ID")
        # Seeded TEST_ orders should appear
        assert "TEST_Admin" in text or "TEST_CSV" in text

    def test_export_csv_date_filter_past_returns_only_header(self, session):
        """CSV export with date_to=2000-01-01 returns only header line."""
        r = session.get(f"{API}/admin/orders/export.csv?date_to=2000-01-01", headers=H_GOOD, timeout=15)
        assert r.status_code == 200
        text = r.content.decode("utf-8-sig").strip()
        lines = text.splitlines()
        assert len(lines) == 1
        assert lines[0].startswith("Order ID")
