import os, sys, types
_REQ = sys.modules.get("requests")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ais


class _R:
    def __init__(self, code, js):
        self.status_code, self._js, self.headers, self.text = code, js, {}, str(js)

    def json(self):
        return self._js


def test_kuota_habis_menahan_panggilan(monkeypatch=None):
    calls = []
    fake = types.SimpleNamespace(get=lambda *a, **k: (calls.append(1), _R(429, {"error": {"message": "API monthly quota exceeded"}}))[1])
    sys.modules["requests"] = fake
    os.environ["VESSEL_API_KEY"] = "x"
    ais._kuota_blok_sampai = 0.0
    r1 = ais._vesselapi_get("/vessel/1/position", {})
    r2 = ais._vesselapi_get("/vessel/2/position", {})
    assert r1.status_code == 429 and r2.status_code == 429
    assert len(calls) == 1                    # panggilan kedua ditahan, tidak ke jaringan
    assert ais.kuota_sisa_menit() > 0
    ais._kuota_blok_sampai = 0.0
    assert ais.kuota_sisa_menit() == 0


def test_429_lain_tidak_memblok():
    sys.modules["requests"] = types.SimpleNamespace(get=lambda *a, **k: _R(429, {"error": {"message": "too many requests per second"}}))
    ais._kuota_blok_sampai = 0.0
    ais._vesselapi_get("/x", {})
    assert ais.kuota_sisa_menit() == 0


def teardown_module(module):
    if _REQ is not None:
        sys.modules["requests"] = _REQ
    else:
        sys.modules.pop("requests", None)
    ais._kuota_blok_sampai = 0.0


def test_kuota_reset_membuka_tahanan():
    ais._kuota_blok_sampai = 10 ** 12
    assert ais.kuota_sisa_menit() > 0
    ais.kuota_reset()
    assert ais.kuota_sisa_menit() == 0


def test_refresh_aktif_sekarang():
    import asyncio

    class _Cur:
        def __init__(self, rows):
            self.rows = rows

        def __aiter__(self):
            self._it = iter(self.rows)
            return self

        async def __anext__(self):
            try:
                return next(self._it)
            except StopIteration:
                raise StopAsyncIteration

    class _Trips:
        def find(self, *a, **k):
            return _Cur([{"legs": [{"tipe": "Kapal RoRo", "kapal": "KAL ECO", "mmsi": "525015993", "status": "Berlangsung"},
                                   {"tipe": "Kapal RoRo", "kapal": "SELESAI", "mmsi": "111111111", "status": "Selesai"}]}])

    db = types.SimpleNamespace(trips=_Trips())
    from datetime import datetime, timezone
    async def fake(db_, mmsi, imo, timeout=15):
        return {"latitude": -5.7, "longitude": 107.2, "position_timestamp": datetime.now(timezone.utc).isoformat()}
    orig, orig_en = ais._vesselapi_refresh, ais.vesselapi_enabled
    ais._vesselapi_refresh, ais.vesselapi_enabled = fake, (lambda: True)
    try:
        ais._kuota_blok_sampai = 10 ** 12          # ditahan → harus dibuka dulu
        r = asyncio.run(ais.refresh_aktif_sekarang(db))
    finally:
        ais._vesselapi_refresh, ais.vesselapi_enabled = orig, orig_en
        ais._kuota_blok_sampai = 0.0
    assert r["kapal_aktif"] == 1 and r["hasil"][0]["ok"] and r["hasil"][0]["kapal"] == "KAL ECO"
