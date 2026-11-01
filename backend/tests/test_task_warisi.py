import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import task_rules as TR


def test_pilih_dan_warisi():
    lama = [
        {"token": "B", "route_leg_id": "L2", "photos": [{"id": 1}]},                       # leg lain
        {"token": "C", "route_leg_id": "L1"},                                              # leg ini tapi kosong
        {"token": "A", "route_leg_id": "L1", "photos": [{"id": 9}], "checkpoints": [{"checkpoint_id": "c1"}], "extra_inputs": {"x": 1}},
    ]
    prev = TR.pilih_sebelumnya(lama, "L1", 0)
    assert prev["token"] == "A"
    baru = TR.warisi_riwayat({"token": "N", "status": "belum_dibuka", "photos": [], "documents": [], "checkpoints": [], "extra_inputs": {}}, prev)
    assert baru["token"] == "N" and baru["photos"] == [{"id": 9}] and baru["checkpoints"][0]["checkpoint_id"] == "c1"
    assert baru["status"] == "dikerjakan" and baru["extra_inputs"] == {"x": 1}
    assert TR.pilih_sebelumnya(lama, "L9", 3) is None
    d = {"token": "N", "photos": []}
    assert TR.warisi_riwayat(d, None) is d
