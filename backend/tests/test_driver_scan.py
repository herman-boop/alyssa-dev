"""Scan KTP/SIM driver: normalisasi hasil AI + endpoint (AI dimock, tanpa jaringan)."""
import driver_scan as ds


class _R:
    def __init__(self, status=200, text=""):
        self.status_code = status
        self._t = text
    def json(self):
        return {"content": [{"type": "text", "text": self._t}]}


AI_OK = ('```json\n{"ktp":{"ada":true,"box":[0.01,0.52,0.98,0.46],"nik":"3174 0914 0572 0005","nama":"Kustriyanto",'
         '"alamat":"Jl Contoh 1, RT 001/005, Kalimulya, Cilodong, Kota Depok"},'
         '"sim":{"ada":true,"box":[0.01,0.17,0.98,0.34],"no_sim":"1232-7205-000453","golongan":"BII umum",'
         '"nama":"KUSTRIYANTO","alamat":"Asr Yon Zikon"}}\n```')


def test_normalisasi_lengkap():
    raw = ds.call_ai(b"x", "image/jpeg", "k", "m", lambda *a, **k: _R(200, AI_OK))
    n = ds.normalisasi(raw)
    f = n["fields"]
    assert f["no_ktp"] == "3174091405720005"
    assert f["no_sim"] == "1232-7205-000453"
    assert f["tipe_sim"] == "B2"
    assert f["nama"] == "KUSTRIYANTO"
    assert f["alamat"].startswith("JL CONTOH 1")          # alamat KTP diutamakan
    assert n["ktp"]["box"] == [0.01, 0.52, 0.98, 0.46] and n["sim"]["box"][1] == 0.17
    assert n["peringatan"] == []


def test_nik_bukan_16_digit_diberi_peringatan_tanpa_menebak():
    n = ds.normalisasi({"ktp": {"ada": True, "nik": "31740914057200", "nama": "A"}})
    assert n["fields"]["no_ktp"] == "31740914057200"       # apa adanya, tidak dilengkapi
    assert any("NIK" in w for w in n["peringatan"])


def test_nama_beda_dan_golongan_asing():
    n = ds.normalisasi({"ktp": {"nama": "BUDI"}, "sim": {"nama": "BUDI S", "golongan": "ZZ"}})
    assert "tipe_sim" not in n["fields"]
    assert sum("berbeda" in w or "tidak dikenali" in w for w in n["peringatan"]) == 2


def test_box_tidak_valid_jadi_none():
    for b in ([0, 0, 1, 1], [0.2, 0.2, 0.05, 0.05], "x", None, [0.9, 0.9, 0.5, 0.5]):
        assert ds._box(b) is None
    assert ds._box([0.1, 0.1, 0.5, 0.3]) == [0.1, 0.1, 0.5, 0.3]


def test_ai_gagal():
    import pytest
    with pytest.raises(ValueError):
        ds.call_ai(b"x", "image/jpeg", "k", "m", lambda *a, **k: _R(401))
    with pytest.raises(ValueError):
        ds.call_ai(b"x", "image/jpeg", "k", "m", lambda *a, **k: _R(200, "bukan json"))
    assert ds.normalisasi(None)["fields"] == {}


# ── endpoint (admin PIN terbuka di tes, sama seperti test_doc_permohonan_bayar) ──
import os, sys
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_scan")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("fastapi")
from fastapi.testclient import TestClient
import server


@pytest.fixture()
def client():
    return TestClient(server.app)


def _kirim(client, content=b"\xff\xd8\xff", ctype="image/jpeg"):
    return client.post("/api/admin/drivers/scan-dokumen", files={"foto": ("a.jpg", content, ctype)})


def test_endpoint_tanpa_key_503(client, monkeypatch):
    monkeypatch.setattr(server, "ANTHROPIC_API_KEY", "")
    assert _kirim(client).status_code == 503


def test_endpoint_format_salah_400(client, monkeypatch):
    monkeypatch.setattr(server, "ANTHROPIC_API_KEY", "sk-ant-x")
    assert _kirim(client, ctype="application/pdf").status_code == 400


def test_endpoint_sukses_tidak_menyimpan(client, monkeypatch):
    monkeypatch.setattr(server, "ANTHROPIC_API_KEY", "sk-ant-x")
    monkeypatch.setattr(server._requests, "post", lambda *a, **k: _R(200, AI_OK))
    r = _kirim(client)
    assert r.status_code == 200
    j = r.json()
    assert j["fields"]["no_ktp"] == "3174091405720005" and j["sim"]["box"] and j["ktp"]["box"]


def test_sim_baru_nomornya_nik_16_digit_tanpa_peringatan():
    n = ds.normalisasi({"ktp": {"ada": True, "nik": "3602241708940002", "nama": "A"},
                        "sim": {"ada": True, "no_sim": "3602241708940002", "golongan": "B II Umum", "nama": "A"}})
    assert n["fields"]["no_sim"] == "3602241708940002" and n["peringatan"] == []
    n2 = ds.normalisasi({"sim": {"no_sim": "12345"}})
    assert any("Nomor SIM" in w for w in n2["peringatan"])


def test_sudut_valid_dan_tidak_valid():
    ok = [[0.1, 0.1], [0.6, 0.12], [0.58, 0.4], [0.09, 0.38]]
    assert ds._sudut(ok) == ok
    assert ds._sudut([[0.1, 0.1], [0.6, 0.1], [0.1, 0.4], [0.6, 0.4]]) is None      # menyilang (urutan salah)
    assert ds._sudut([[0.1, 0.1], [0.2, 0.1], [0.2, 0.15], [0.1, 0.15]]) is None    # terlalu kecil
    assert ds._sudut([[0.1, 0.1], [0.6, 0.1]]) is None and ds._sudut("x") is None
    n = ds.normalisasi({"ktp": {"ada": True, "sudut": ok, "box": [0.05, 0.05, 0.6, 0.4]}})
    assert n["ktp"]["sudut"] == ok and n["sim"]["sudut"] is None
