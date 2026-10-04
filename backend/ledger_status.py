"""
ledger_status.py — status pembayaran tagihan supplier dari LEDGER (pure, tanpa DB).

Satu sumber kebenaran untuk label Belum Dibayar / Sebagian Dibayar / Lunas.
Status DIHITUNG dari angka ledger (net transfer vs total terbayar) — terbayar
sudah termasuk alokasi pembayaran Rekon (extra_paid). JADI: begitu pembayaran
Rekon dialokasikan ke sebuah job, status otomatis naik (belum → sebagian →
lunas) tanpa input manual.
"""


def tagihan_status(dpp, net_transfer, terbayar):
    """Return salah satu: 'draft' | 'belum' | 'sebagian' | 'lunas'.

    - draft    : harga belum lengkap (dpp <= 0)
    - belum    : belum ada pembayaran teralokasi
    - sebagian : sudah bayar sebagian (0 < terbayar < net_transfer)
    - lunas    : terbayar >= net_transfer (kewajiban transfer supplier selesai)
    """
    if (dpp or 0) <= 0:
        return "draft"
    t = terbayar or 0
    if t <= 0:
        return "belum"
    if t < (net_transfer or 0):
        return "sebagian"
    return "lunas"


# Label ramah-pengguna (dipakai UI). draft = harga belum lengkap.
STATUS_LABEL = {
    "draft": "Harga Belum Lengkap",
    "belum": "Belum Dibayar",
    "sebagian": "Sebagian Dibayar",
    "lunas": "Lunas",
}


def status_label(status):
    return STATUS_LABEL.get(status, status)
