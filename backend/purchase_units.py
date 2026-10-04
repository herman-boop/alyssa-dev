"""Helper murni (tanpa dependency) buat alur Pembelian/tarik unit dari PO.

Dipisah dari server.py biar bisa di-unit-test tanpa import FastAPI/motor.
Satu-satunya aturan di sini: cegah 1 unit ketarik 2x ke supplier yang SAMA
(antar supplier tetap boleh — konsep leg/rute beda).
"""
from typing import Optional


def find_pulled_unit(jobs, order_id, order_unit_id) -> Optional[dict]:
    """Return job yang SUDAH menarik unit (order_id + order_unit_id) ini, atau None.

    Keduanya harus ada (truthy) biar dihitung — job lama tanpa referensi unit
    (order_unit_id kosong) TIDAK pernah bikin false-positive.
    """
    if not order_id or not order_unit_id:
        return None
    for j in (jobs or []):
        if j.get("order_id") == order_id and j.get("order_unit_id") == order_unit_id:
            return j
    return None
