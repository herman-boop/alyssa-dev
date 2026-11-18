"""Upload permintaan harga pelanggan (Excel/CSV/foto) -> baris (tipe kendaraan, asal, tujuan) + HPP dari harga beli supplier.

Logika murni (tanpa database). Margin dan harga akhir dihitung di frontend (admin bisa mengubahnya per baris);
backend hanya membaca file, mencocokkan rute/kendaraan ke daftar harga beli, dan menulis file Excel hasil.
"""
import base64
import csv
import io
import json
import re
import statistics

# kata kunci judul kolom (huruf kecil). Urutan pengecekan penting: tujuan/asal sebelum 'tipe'.
_KUNCI = {
    "tujuan": ("pengiriman", "tujuan", "destination", "dest", "bongkar", "ke kota"),
    "asal": ("pengambilan", "asal", "origin", "pickup", "pick up", "muat", "dari"),
    "harga": ("biaya", "harga", "tarif", "price", "ongkir", "ongkos"),
    "tipe": ("tipe", "kendaraan", "unit", "jenis", "vehicle", "model"),
    "no": ("no",),
}


def _t(v):
    return " ".join(str(v if v is not None else "").split())


def _kolom(sel):
    s = _t(sel).lower()
    if not s:
        return None
    for f in ("harga", "tujuan", "asal", "tipe"):      # "Biaya Pengiriman" = harga, bukan tujuan
        if any(k in s for k in _KUNCI[f]):
            return f
    if re.fullmatch(r"no\.?|nomor|#", s):
        return "no"
    return None


def parse_tabel(baris2d):
    """list-of-list (sel mentah) -> list dict {no,tipe,asal,tujuan,harga}. Header dicari di 20 baris pertama."""
    baris2d = [list(r) for r in (baris2d or [])]
    for hi, r in enumerate(baris2d[:20]):
        peta = {}
        for ci, sel in enumerate(r):
            f = _kolom(sel)
            if f and f not in peta:
                peta[f] = ci
        if "tujuan" in peta and ("asal" in peta or "tipe" in peta) and len(peta) >= 3:
            out = []
            for r2 in baris2d[hi + 1:]:
                g = lambda f: _t(r2[peta[f]]) if f in peta and peta[f] < len(r2) else ""
                tujuan = g("tujuan")
                if not tujuan:
                    continue
                if re.match(r"(?i)^(total|jumlah|catatan|note)\b", tujuan) or re.match(r"(?i)^(total|jumlah)\b", g("no")):
                    continue
                out.append({"no": g("no"), "tipe": g("tipe"), "asal": g("asal"), "tujuan": tujuan,
                            "harga": _angka(g("harga"))})
            return out
    return []


def _angka(v):
    s = re.sub(r"[^\d,.\-]", "", str(v or ""))
    if not s:
        return 0
    if re.fullmatch(r"-?\d{1,3}([.,]\d{3})+", s):      # 1.500.000 / 1,500,000
        s = re.sub(r"[.,]", "", s)
    else:
        s = s.replace(",", ".")
    try:
        return max(0, int(round(float(s))))
    except ValueError:
        return 0


def baca_xlsx(data: bytes):
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = parse_tabel([list(r) for r in ws.iter_rows(values_only=True)])
        if rows:
            return rows
    return []


def baca_csv(data: bytes):
    txt = data.decode("utf-8-sig", errors="replace")
    delim = ";" if txt.count(";") > txt.count(",") else ("\t" if txt.count("\t") > txt.count(",") else ",")
    return parse_tabel(list(csv.reader(io.StringIO(txt), delimiter=delim)))


PROMPT_AI = (
    "Ini lembar permintaan harga pengiriman kendaraan dari pelanggan (tabel). Baca SEMUA baris data. Balas HANYA JSON valid: "
    '{"rows":[{"no":"1","tipe":"","asal":"","tujuan":"","harga":0}]}. '
    "tipe = tipe kendaraan, asal = lokasi pengambilan, tujuan = lokasi pengiriman, harga = angka Biaya Pengiriman bila sudah terisi, selain itu 0. "
    "Tulis persis seperti tertulis; jangan menebak; abaikan baris judul dan total."
)


def baca_ai(data: bytes, media_type: str, key: str, model: str, post):
    """Foto/PDF tabel -> baris. Melempar ValueError(pesan) bila gagal."""
    b64 = base64.b64encode(data).decode()
    block = ({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
             if media_type == "application/pdf"
             else {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}})
    try:
        r = post("https://api.anthropic.com/v1/messages",
                 headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                 json={"model": model, "max_tokens": 8000, "messages": [{"role": "user", "content": [block, {"type": "text", "text": PROMPT_AI}]}]},
                 timeout=120)
    except Exception as e:
        raise ValueError(f"Gagal menghubungi layanan AI: {e}")
    if r.status_code != 200:
        raise ValueError(f"Layanan AI menolak permintaan (kode {r.status_code}). Cek ANTHROPIC_API_KEY / model.")
    txt = "".join(c.get("text", "") for c in (r.json().get("content") or []) if c.get("type") == "text")
    a, b = txt.find("{"), txt.rfind("}")
    try:
        rows = json.loads(txt[a:b + 1]).get("rows") or []
    except Exception:
        raise ValueError("Tabel tidak terbaca. Pakai file Excel/CSV atau foto yang lebih jelas.")
    out = []
    for x in rows:
        if isinstance(x, dict) and _t(x.get("tujuan")):
            out.append({"no": _t(x.get("no")), "tipe": _t(x.get("tipe")), "asal": _t(x.get("asal")),
                        "tujuan": _t(x.get("tujuan")), "harga": _angka(x.get("harga"))})
    return out


# ── pencocokan ke harga beli ──
_ALIAS = {"makasar": "makassar", "jogja": "yogyakarta", "jogjakarta": "yogyakarta", "yogya": "yogyakarta",
          "djakarta": "jakarta", "dki jakarta": "jakarta", "banjarmasin": "banjarmasin"}


def norm_kota(s):
    s = re.sub(r"[^a-z0-9 ]+", "", str(s or "").lower().replace("-", " "))
    s = re.sub(r"^(kota|kab|kabupaten)\s+", "", " ".join(s.split()))
    s = _ALIAS.get(s, s)
    return s.replace(" ", "")


_GENERIK = {"hybrid", "cvt", "type", "tipe", "the", "new", "all", "dan", "mt", "at", "dc", "ps", "std"}


def token_kendaraan(s):
    return {w for w in re.findall(r"[a-z0-9]+", str(s or "").lower()) if len(w) >= 3 and w not in _GENERIK}


def cocokkan(baris, harga_beli):
    """Tiap baris permintaan -> HPP dari daftar harga beli (baris {asal,tujuan,vehicle_type,harga}).
    cocok: 'kendaraan' (rute + kendaraan serupa), 'rute' (rute sama, kendaraan lain), '' (tidak ada)."""
    per_rute = {}
    for h in harga_beli or []:
        try:
            hv = int(h.get("harga") or 0)
        except (TypeError, ValueError):
            continue
        if hv <= 0:
            continue
        per_rute.setdefault((norm_kota(h.get("asal")), norm_kota(h.get("tujuan"))), []).append((token_kendaraan(h.get("vehicle_type")), hv))
    out = []
    for b in baris or []:
        key = (norm_kota(b.get("asal")), norm_kota(b.get("tujuan")))
        cand = per_rute.get(key, [])
        tk = token_kendaraan(b.get("tipe"))
        sama = [hv for t, hv in cand if tk and t and len(tk & t) / len(tk) >= 0.5]
        pilih, cocok = (sama, "kendaraan") if sama else (([hv for _, hv in cand], "rute") if cand else ([], ""))
        r = dict(b)
        r.update({"hpp": int(statistics.median(pilih)) if pilih else 0, "n": len(pilih),
                  "min": min(pilih) if pilih else 0, "max": max(pilih) if pilih else 0, "cocok": cocok})
        out.append(r)
    return out


# ── hasil Excel (tata letak sama dengan lembar permintaan; kolom Biaya Pengiriman kuning) ──
def ke_xlsx(baris, judul=""):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    wb = Workbook()
    ws = wb.active
    ws.title = "Penawaran"
    r0 = 1
    if judul:
        ws["A1"] = judul
        ws["A1"].font = Font(bold=True, size=12)
        r0 = 3
    kepala = ["No.", "Tipe Kendaraan", "Lokasi Pengambilan", "Lokasi Pengiriman", "Biaya Pengiriman"]
    for ci, k in enumerate(kepala, 1):
        c = ws.cell(row=r0, column=ci, value=k)
        c.font = Font(bold=True)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.fill = PatternFill("solid", fgColor="FFFF00")
    tipis = Side(style="thin", color="000000")
    for i, b in enumerate(baris or [], 1):
        harga = int(b.get("harga") or 0)
        vals = [i, b.get("tipe", ""), b.get("asal", ""), b.get("tujuan", ""), harga if harga > 0 else None]
        for ci, v in enumerate(vals, 1):
            c = ws.cell(row=r0 + i, column=ci, value=v)
            c.border = Border(top=tipis, bottom=tipis, left=tipis, right=tipis)
            if ci == 5:
                c.fill = PatternFill("solid", fgColor="FFFF00")
                c.number_format = '#,##0'
            if ci == 1:
                c.alignment = Alignment(horizontal="center")
    for ci, w in enumerate((6, 28, 22, 22, 20), 1):
        ws.column_dimensions[ws.cell(row=r0, column=ci).column_letter].width = w
    ws.freeze_panes = ws.cell(row=r0 + 1, column=1)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
