"""
rekon_felis_client.py — ADAPTER (stub) untuk PULL transaksi READY dari Felis-Alyssa.

Sengaja BELUM diimplementasikan: endpoint, auth, dan format "READY list" dari
Felis belum final (disiapkan Claude Alyssa di sisi Felis). File ini mengisolasi
titik sambung terakhir supaya nanti tinggal diisi tanpa menyentuh logika ingest.

Yang dibutuhkan dari Felis untuk mengaktifkan ini (lihat juga laporan):
  - FELIS_BASE_URL            : base URL API Felis (dari ENV, JANGAN hardcode)
  - FELIS_API_TOKEN           : token/kredensial (dari ENV)
  - endpoint daftar READY     : mis. GET {BASE}/rekon/ready  → list transaksi
  - endpoint mark consumed     : mis. POST {BASE}/rekon/{id}/consumed (opsional)
  - format payload per transaksi: lihat _CONTRACT_FIELDS di rekon_sync.py

Begitu kontrak final, implementasikan `fetch_ready()` (dan opsional
`mark_consumed()`), lalu panggil rekon_sync.ingest_transaction() per item.
"""

import os


def is_configured() -> bool:
    """True kalau ENV koneksi Felis sudah diisi. Dipakai endpoint 'pull' untuk
    memberi pesan jelas kalau belum siap (bukan error misterius)."""
    return bool((os.environ.get("FELIS_BASE_URL") or "").strip()
                and (os.environ.get("FELIS_API_TOKEN") or "").strip())


async def fetch_ready():
    """Ambil transaksi berstatus READY dari Felis.

    BELUM diimplementasikan — menunggu kontrak endpoint/auth dari Felis.
    Jangan menebak URL/format. Lempar NotImplementedError supaya jelas.
    """
    raise NotImplementedError(
        "Koneksi Felis belum dikonfigurasi/diimplementasikan. "
        "Butuh FELIS_BASE_URL + FELIS_API_TOKEN + kontrak endpoint READY dari Felis-Alyssa."
    )
