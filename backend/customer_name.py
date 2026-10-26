"""
Nama pelanggan tunggal (Langkah 1): satu perusahaan = satu tulisan, apa pun cara pelanggan mengetiknya.

- name_key():      kunci penyamaan = huruf kecil, hanya huruf & angka (titik, koma, spasi, tanda baca dibuang).
                   "PT. Transkon Jaya, Tbk" / "PT.TRANSKON JAYA,TBK" / "pt transkon jaya tbk" → "pttranskonjayatbk".
- canon_display(): tulisan resmi = HURUF BESAR, tanpa titik/koma, satu spasi antar kata
                   ("PT.Transkon Jaya, TBK" → "PT TRANSKON JAYA TBK").
Hanya menyamakan ejaan. "PT Maju Jaya" dan "CV Maju Jaya" tetap dianggap beda.
Tidak mengubah data lama; dipakai untuk nama baru dan pembanding saat menarik kontak.
"""
import re

_LEGAL_DOT = re.compile(r"\b(pt|cv|ud|pd|tbk|ltd|inc)\.", re.I)
_KEEP = re.compile(r"[^A-Z0-9 &/\-]")


def name_key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def canon_display(s):
    t = _LEGAL_DOT.sub(lambda m: m.group(1) + " ", (s or "").strip())
    t = t.replace(",", " ").replace(".", "")
    t = _KEEP.sub(" ", t.upper())
    return re.sub(r"\s+", " ", t).strip()


def resolve(typed, master_names):
    """Nama resmi untuk `typed`. Kalau kuncinya cocok dengan salah satu nama master
    (Daftar Pelanggan / Kontak), pakai tulisan resmi nama master itu."""
    disp = canon_display(typed)
    key = name_key(typed)
    if not key:
        return disp
    for m in master_names or []:
        if name_key(m) == key:
            return canon_display(m) or disp
    return disp
