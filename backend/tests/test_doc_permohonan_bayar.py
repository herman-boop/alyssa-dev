"""Surat Permohonan Pembayaran diarsipkan di Histori Dokumen sebagai jenis baru; jenis lama tidak terganggu."""
import os, sys, asyncio
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017"); os.environ.setdefault("DB_NAME", "test_spp")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
pytest.importorskip("mongomock_motor"); pytest.importorskip("fastapi")
from mongomock_motor import AsyncMongoMockClient
from fastapi.testclient import TestClient
import server


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["t"])
    return TestClient(server.app)


def test_simpan_dan_filter_permohonan_bayar(client):
    inv = client.post("/api/admin/doc-history", json={"jenis": "invoice", "no_dokumen": "INV1", "customer": "PT A", "lines": [{"nama": "Jasa", "qty": 1, "harga": 100}]})
    assert inv.status_code == 200
    r = client.post("/api/admin/doc-history", json={
        "jenis": "permohonan_bayar", "no_dokumen": "SPP0001", "customer": "PT A", "judul": "PT A · Rp 100 · Inv INV1",
        "meta": {"invoice_no": "INV1", "nominal": 100, "kepada": "PT A"}})
    assert r.status_code == 200 and r.json()["jenis_label"] == "Surat Permohonan Pembayaran"
    daftar = client.get("/api/admin/doc-history", params={"jenis": "permohonan_bayar"}).json()["items"]
    assert [d["no_dokumen"] for d in daftar] == ["SPP0001"] and daftar[0]["meta"]["nominal"] == 100
    semua = client.get("/api/admin/doc-history").json()["items"]
    assert {d["jenis"] for d in semua} == {"invoice", "permohonan_bayar"}      # invoice tidak tersentuh


def test_jenis_tak_dikenal_tetap_ditolak(client):
    assert client.post("/api/admin/doc-history", json={"jenis": "sembarang", "no_dokumen": "X"}).status_code == 400
