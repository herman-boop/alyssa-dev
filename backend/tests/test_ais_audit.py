"""Audit Live Tracking: validasi identitas, guard waktu provider, label stale, refresh manual + cooldown."""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import ais as AIS
import ais_audit as AU
from test_felis_rekon import FakeDB


def run(c):
    return asyncio.get_event_loop().run_until_complete(c) if False else asyncio.run(c)


class _R:
    def __init__(self, st, body=None):
        self.status_code = st; self._b = body or {}; self.headers = {}; self.text = ""
    def json(self): return self._b


def _patch(fake_get):
    saved = (AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled)
    AIS.vesselapi_enabled = lambda: True
    AIS._vesselapi_use_sat = lambda: False
    AIS.vesselfinder_enabled = lambda: False
    AIS._vesselapi_get = fake_get
    AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()
    return saved


def _restore(saved):
    AIS.vesselapi_enabled, AIS._vesselapi_use_sat, AIS._vesselapi_get, AIS.vesselfinder_enabled = saved
    AIS._last_pos_fetch.clear(); AIS._last_eta_fetch.clear()


def test_validasi_identitas():
    assert AU.validate_mmsi("525200343")[0]
    assert not AU.validate_mmsi("52520034")[0]
    assert not AU.validate_mmsi("999000111")[0]       # MID di luar 201-775
    assert AU.validate_imo("9074729")[0]
    assert not AU.validate_imo("9074728")[0]          # checksum salah
    assert AU.identity_issues("", "") == ["MMSI dan IMO sama-sama kosong"]


def test_posisi_lama_tidak_menimpa_dan_tidak_dianggap_live():
    old = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    older = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
    state = {"ts": old, "lat": -5.65}

    def fake_get(path, params, timeout=15):
        if path.endswith("/eta"):
            return _R(404)
        return _R(200, {"vesselPosition": {"mmsi": "525200343", "latitude": state["lat"], "longitude": 111.9, "timestamp": state["ts"], "sog": 13, "cog": 90}})

    async def go():
        db = FakeDB()
        d = await AIS._vesselapi_refresh(db, "525200343", "")
        assert d["latitude"] == -5.65
        pub = AIS.public_ais(d)
        assert pub["freshness"] == "stale" and pub["is_live"] is False
        assert pub["position_label"] == "Posisi Terakhir Terdeteksi"
        # provider membalas posisi LEBIH TUA -> cache tidak ditimpa
        AIS._last_pos_fetch.clear()
        state.update(ts=older, lat=-9.9)
        d2 = await AIS._vesselapi_refresh(db, "525200343", "")
        assert d2["latitude"] == -5.65
        # provider membalas posisi LEBIH BARU -> diterima
        AIS._last_pos_fetch.clear()
        newer = datetime.now(timezone.utc).isoformat()
        state.update(ts=newer, lat=-5.7)
        d3 = await AIS._vesselapi_refresh(db, "525200343", "")
        assert d3["latitude"] == -5.7 and AIS.public_ais(d3)["is_live"] is True
        outs = [r["outcome"] for r in db[AU.COLL]._d] if hasattr(db[AU.COLL], "_d") else None
        return outs

    saved = _patch(fake_get)
    try:
        asyncio.run(go())
    finally:
        _restore(saved)


def test_tanpa_timestamp_tidak_pernah_live():
    def fake_get(path, params, timeout=15):
        if path.endswith("/eta"):
            return _R(404)
        return _R(200, {"vesselPosition": {"mmsi": "525200343", "latitude": 1.0, "longitude": 2.0}})

    async def go():
        db = FakeDB()
        d = await AIS._vesselapi_refresh(db, "525200343", "")
        pub = AIS.public_ais(d)
        assert pub["freshness"] == "unknown" and pub["is_live"] is False
        assert AIS._doc_age_seconds(d) is None

    saved = _patch(fake_get)
    try:
        asyncio.run(go())
    finally:
        _restore(saved)


def test_refresh_manual_cooldown_dan_hasil():
    calls = []

    def fake_get(path, params, timeout=15):
        calls.append(path)
        if path.endswith("/eta"):
            return _R(404)
        return _R(200, {"vesselPosition": {"mmsi": "525200343", "latitude": 1.0, "longitude": 2.0,
                                           "timestamp": datetime.now(timezone.utc).isoformat(), "sog": 12, "cog": 90}})

    legs = [{"tipe": "Kapal RoRo", "kapal": "SHILOH SEJATI", "mmsi": "525200343", "status": "Berlangsung"}]

    async def go():
        db = FakeDB()
        r1 = await AIS.manual_refresh(db, legs)
        assert r1["status"] == "updated" and r1["ship_ais"]["is_live"] is True
        n = len(calls)
        r2 = await AIS.manual_refresh(db, legs)           # langsung lagi -> cooldown, tanpa panggilan provider
        assert r2["status"] == "cooldown" and r2["retry_after"] > 0 and len(calls) == n
        r3 = await AIS.manual_refresh(db, [{"tipe": "Self Drive"}])
        assert r3["status"] == "no_ship"

    saved = _patch(fake_get)
    try:
        asyncio.run(go())
    finally:
        _restore(saved)
