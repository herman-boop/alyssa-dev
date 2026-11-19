"""Penawaran yang sudah dicetak (arsip Histori Dokumen) -> entri harga di Kalkulator HPP pelanggan.
Fungsi murni: membentuk entri harga_history dari baris penawaran, melewati yang kosong/kembar."""

BATAS_RIWAYAT = 300


def _rapi(v):
    return " ".join(str(v if v is not None else "").split())


def _harga(u):
    for k in ("harga_deal", "harga"):
        try:
            h = int(round(float(u.get(k) or 0)))
        except (TypeError, ValueError):
            h = 0
        if h > 0:
            return h
    return 0


def _moda_ada(m):
    m = _rapi(m)
    return "" if m in ("", "-", "—") else m[:120]


def _kunci(rute, tipe, moda, harga):
    return (_rapi(rute).lower(), _rapi(tipe).lower(), _moda_ada(moda).lower(), int(harga))


def bangun_entri(units, moda_baru="", riwayat_ada=None):
    """-> (entri, jumlah_dilewati). Moda baru dipakai untuk baris yang modanya kosong / '-'.
    Dilewati: tanpa harga, tanpa rute/tipe, atau kembar (rute + tipe + moda + harga sama) dengan riwayat yang sudah ada."""
    ada = {_kunci(h.get("rute"), h.get("tipe_kendaraan"), h.get("moda"), h.get("harga_deal") or 0) for h in (riwayat_ada or [])}
    entri, lewat = [], 0
    for u in units or []:
        if not isinstance(u, dict):
            lewat += 1
            continue
        harga, rute, tipe = _harga(u), _rapi(u.get("rute")), _rapi(u.get("tipe_kendaraan"))
        if harga <= 0 or not rute or not tipe:
            lewat += 1
            continue
        moda = _moda_ada(u.get("moda")) or _moda_ada(moda_baru)
        k = _kunci(rute, tipe, moda, harga)
        if k in ada:
            lewat += 1
            continue
        ada.add(k)
        try:
            asuransi = max(0, int(round(float(u.get("asuransi") or 0))))
        except (TypeError, ValueError):
            asuransi = 0
        entri.append({"rute": rute, "tipe_kendaraan": tipe[:80], "moda": moda, "harga_deal": harga,
                      "catatan": _rapi(u.get("catatan"))[:300], "asuransi": asuransi})
    return entri, lewat
