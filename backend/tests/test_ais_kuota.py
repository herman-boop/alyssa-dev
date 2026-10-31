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
