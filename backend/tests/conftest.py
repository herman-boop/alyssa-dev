"""Konfigurasi tes backend.

Tes "live" (test_driver_checkpoint, test_bastk_v26a, test_orders_v26b, test_orders_v26c_convert, test_iteration6_pod,
test_iteration7_v25, test_admin_v26d) memanggil SERVER YANG SEDANG BERJALAN lewat HTTP (REACT_APP_BACKEND_URL / URL preview lama)
dan membaca frontend/.env. Tanpa server itu mereka tidak bisa lulus (bukan bug kode). Agar hasil CI bermakna, file-file itu
DILEWATI secara eksplisit kecuali LIVE_API_URL diisi; alasan dicetak di header pytest. Tes lain tetap berjalan penuh.
"""
import os

LIVE_FILES = [
    "test_driver_checkpoint.py", "test_bastk_v26a.py", "test_orders_v26b.py", "test_orders_v26c_convert.py",
    "test_iteration6_pod.py", "test_iteration7_v25.py", "test_admin_v26d.py",
]
LIVE = bool(os.environ.get("LIVE_API_URL", "").strip())
if LIVE:
    os.environ.setdefault("REACT_APP_BACKEND_URL", os.environ["LIVE_API_URL"].strip())
else:
    collect_ignore = list(LIVE_FILES)


def pytest_report_header(config):
    if LIVE:
        return f"tes live: AKTIF melawan {os.environ['LIVE_API_URL']}"
    return f"tes live: {len(LIVE_FILES)} file DILEWATI (butuh server hidup; set LIVE_API_URL untuk menjalankan): " + ", ".join(LIVE_FILES)
