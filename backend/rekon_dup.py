"""Deteksi kemungkinan transaksi bank ganda (satu transfer fisik tercatat dua kali) — logika MURNI, tanpa DB.

Kasus nyata: satu transfer BCA dari dua sumber (Cetakan Mutasi dan e-statement) menjadi dua `bank_transaction_id`.
`bank_transaction_id` (idempotency) tetap kunci utama; modul ini hanya MENANDAI, tidak pernah menghapus/menggabungkan.

Sidik dasar (inti): tanggal + nominal + rekening sumber. Identitas pendukung: referensi bank, rekening tujuan,
identitas bank penerima, ID transaksi bank. Tanggal + nominal yang sama TIDAK cukup untuk menyimpulkan duplikat:
  tingkat "kuat"            inti sama DAN ada bukti identitas yang cocok (referensi sama, atau rekening tujuan + bank sama)
  tingkat "perlu_verifikasi" inti sama tetapi identitas belum cukup kuat (mis. salah satu tanpa referensi)
  None                      bukan kandidat: inti beda, atau identitas pendukung jelas BEDA (referensi berbeda di kedua sisi, rekening tujuan berbeda)
`bank_transaction_sidik` bisa sama untuk dua baris fisik berbeda, jadi TIDAK dipakai sebagai bukti.
"""
import re
import hashlib

_ALNUM = re.compile(r"[^A-Z0-9]")


def norm(s):
    return _ALNUM.sub("", str(s or "").upper())


def _i(v):
    try:
        return int(round(float(v)))
    except (TypeError, ValueError):
        return 0


def komponen(x):
    """Ambil komponen sidik dari payload Felis ATAU baris bank_payment_imports (field kontrak sama)."""
    return {
        "btid": str(x.get("bank_transaction_id") or x.get("idempotency_key") or ""),
        "tanggal": str(x.get("tanggal") or "")[:10],
        "nominal": _i(x.get("nominal") if x.get("nominal") is not None else x.get("amount")),
        "sumber": norm(x.get("source_account_number")),
        "referensi": norm(x.get("referensi_bank")),
        "tujuan": norm(x.get("bank_account_number")),
        "bank": norm(x.get("beneficiary_bank_code")),
    }


def sidik(x):
    """Hash inti (tanggal|nominal|rekening sumber) untuk pencarian cepat; BUKAN bukti duplikat."""
    k = komponen(x)
    return hashlib.sha1(f"{k['tanggal']}|{k['nominal']}|{k['sumber']}".encode()).hexdigest()[:16]


def tingkat(a, b):
    """-> None | 'kuat' | 'perlu_verifikasi' untuk dua transaksi (payload atau import)."""
    ka, kb = komponen(a), komponen(b)
    if not ka["btid"] or ka["btid"] == kb["btid"]:
        return None
    if not (ka["tanggal"] and ka["tanggal"] == kb["tanggal"] and ka["nominal"] > 0 and ka["nominal"] == kb["nominal"]):
        return None
    if ka["sumber"] != kb["sumber"]:
        return None                      # rekening sumber beda (atau salah satu kosong) -> bukan kandidat
    # bukti BEDA jelas -> dua transfer terpisah
    if ka["referensi"] and kb["referensi"] and ka["referensi"] != kb["referensi"]:
        return None
    if ka["tujuan"] and kb["tujuan"] and ka["tujuan"] != kb["tujuan"]:
        return None
    if ka["bank"] and kb["bank"] and ka["bank"] != kb["bank"]:
        return None
    bukti = []
    if ka["referensi"] and ka["referensi"] == kb["referensi"]:
        bukti.append("referensi bank sama")
    if ka["tujuan"] and ka["tujuan"] == kb["tujuan"] and ka["bank"] and ka["bank"] == kb["bank"]:
        bukti.append("rekening tujuan dan bank sama")
    return ("kuat" if bukti else "perlu_verifikasi"), bukti


def kandidat(payload, imports):
    """Kandidat duplikat untuk `payload` di antara `imports` (baris yang BELUM dibatalkan).
    -> list {bank_transaction_id, tingkat, bukti, nominal, tanggal}. Tingkat terkuat lebih dulu."""
    out = []
    for imp in imports or []:
        if imp.get("status") not in ("processed",):
            continue
        r = tingkat(payload, imp)
        if r:
            lvl, bukti = r
            k = komponen(imp)
            out.append({"bank_transaction_id": k["btid"], "tingkat": lvl, "bukti": bukti, "nominal": k["nominal"], "tanggal": k["tanggal"],
                        "referensi_bank": imp.get("referensi_bank") or ""})
    out.sort(key=lambda c: (c["tingkat"] != "kuat", c["bank_transaction_id"]))
    return out


def cari_pasangan(imports):
    """Pindai semua import `processed` -> pasangan yang saling berkandidat. Hanya-baca.
    -> list {a, b, tingkat, bukti, nominal, tanggal}; tiap pasangan sekali."""
    rows = [i for i in (imports or []) if i.get("status") == "processed"]
    grup = {}
    for i in rows:
        grup.setdefault(sidik(i), []).append(i)
    out = []
    for g in grup.values():
        for x in range(len(g)):
            for y in range(x + 1, len(g)):
                r = tingkat(g[x], g[y])
                if r:
                    k = komponen(g[x])
                    out.append({"a": k["btid"], "b": komponen(g[y])["btid"], "tingkat": r[0], "bukti": r[1],
                                "nominal": k["nominal"], "tanggal": k["tanggal"]})
    return out
