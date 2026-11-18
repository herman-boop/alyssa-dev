"""Scan foto KTP & SIM driver (AI vision) -> data form + kotak potong kartu.

Murni fungsi: prompt, pemanggilan API (post bisa disuntik utk tes), dan normalisasi hasil.
Tidak menyentuh database. Foto asli tidak disimpan di sini; frontend memotong tiap kartu
dari foto yang sama lalu mengunggah hasil potongan lewat endpoint foto driver yang sudah ada.
"""
import base64
import json
import re

PROMPT = (
    "Foto ini berisi KTP Indonesia dan/atau SIM Indonesia (bisa keduanya dalam satu foto, atas-bawah atau kiri-kanan, "
    "bisa miring/berdebu/sedikit buram). Balas HANYA dengan JSON valid, tanpa penjelasan, bentuk:\n"
    '{"ktp":{"ada":false,"box":[0,0,1,1],"nik":"","nama":"","alamat":""},'
    '"sim":{"ada":false,"box":[0,0,1,1],"no_sim":"","golongan":"","nama":"","alamat":""}}\n'
    "Aturan:\n"
    "- ada = true bila kartu itu terlihat di foto.\n"
    "- box = [x, y, lebar, tinggi] persegi panjang yang membungkus SELURUH kartu itu (tepi kartu, bukan seluruh foto), "
    "dalam pecahan 0..1 terhadap lebar dan tinggi foto. Longgarkan sedikit (sekitar 1-2%) supaya tepi kartu tidak terpotong.\n"
    "- nik = 16 digit NIK di KTP, tulis angka saja. no_sim = nomor SIM (12-14 digit, boleh tanda hubung seperti tercetak).\n"
    "- golongan = golongan SIM seperti tercetak (A, B I, B II, C, D, B I Umum, B II Umum, dst).\n"
    "- nama = nama persis seperti tercetak. alamat = alamat di kartu itu; untuk KTP gabungkan Alamat, RT/RW, Kel/Desa, Kecamatan, "
    "dan kota/kabupaten dari kepala kartu, dipisah koma.\n"
    "- JANGAN menebak. Angka atau huruf yang tidak terbaca jelas dikosongkan; jangan melengkapi digit yang hilang."
)

ALLOWED_MEDIA = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 8 * 1024 * 1024


def call_ai(data: bytes, media_type: str, key: str, model: str, post) -> dict:
    """Panggil API Anthropic (vision). `post` = requests.post (disuntik supaya bisa dites).
    Mengembalikan dict mentah dari AI; melempar ValueError(pesan) bila gagal."""
    b64 = base64.b64encode(data).decode()
    try:
        r = post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": model, "max_tokens": 1500,
                  "messages": [{"role": "user", "content": [
                      {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                      {"type": "text", "text": PROMPT}]}]},
            timeout=90,
        )
    except Exception as e:  # jaringan
        raise ValueError(f"Gagal menghubungi layanan AI: {e}")
    if r.status_code != 200:
        raise ValueError(f"Layanan AI menolak permintaan (kode {r.status_code}). Cek ANTHROPIC_API_KEY / model.")
    txt = "".join(c.get("text", "") for c in (r.json().get("content") or []) if c.get("type") == "text").strip()
    a, b = txt.find("{"), txt.rfind("}")
    try:
        return json.loads(txt[a:b + 1])
    except Exception:
        raise ValueError("Foto tidak terbaca. Coba foto lebih terang/lurus, kartu penuh di dalam foto.")


def _digits(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def _box(v):
    """[x,y,w,h] pecahan 0..1 valid, atau None (frontend lalu memakai seluruh foto)."""
    try:
        x, y, w, h = [float(t) for t in v]
    except Exception:
        return None
    x, y = max(0.0, min(1.0, x)), max(0.0, min(1.0, y))
    w, h = min(w, 1.0 - x), min(h, 1.0 - y)
    if w < 0.15 or h < 0.1:          # terlalu kecil = tidak masuk akal
        return None
    if w * h > 0.97:                 # hampir seluruh foto = tidak ada potongan berarti
        return None
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]


_GOL = [  # urutan penting: B II sebelum B I
    (re.compile(r"\bB\s*(II|2)\b", re.I), "B2"),
    (re.compile(r"\bB\s*(I|1)\b", re.I), "B1"),
    (re.compile(r"^\s*A\b", re.I), "A"),
    (re.compile(r"^\s*C\b", re.I), "C"),
    (re.compile(r"^\s*D\b", re.I), "D"),
]


def golongan_ke_tipe(g) -> str:
    """'B II Umum' / 'BIIumum' -> 'B2'. Tidak dikenal -> ''. (Pilihan form: A, B1, B2, C, D)"""
    s = str(g or "").strip()
    s = re.sub(r"(?i)(II|I)(umum)", r"\1 \2", s)      # 'BIIumum' -> 'BII umum'
    s = re.sub(r"(?i)^B(II|I)\b", lambda m: "B " + m.group(1), s)   # 'BII' -> 'B II'
    for rx, t in _GOL:
        if rx.search(s):
            return t
    return ""


def normalisasi(raw: dict) -> dict:
    """Hasil AI mentah -> {fields, ktp:{ada,box}, sim:{ada,box}, peringatan:[...]}. Selalu aman dipakai form."""
    raw = raw if isinstance(raw, dict) else {}
    ktp, sim = (raw.get("ktp") or {}), (raw.get("sim") or {})
    warn = []
    fields = {}

    nik = _digits(ktp.get("nik"))
    if nik:
        fields["no_ktp"] = nik
        if len(nik) != 16:
            warn.append(f"NIK terbaca {len(nik)} digit (seharusnya 16) — periksa ulang.")
    no_sim = re.sub(r"[^0-9\-]", "", str(sim.get("no_sim") or "")).strip("-")
    if no_sim:
        fields["no_sim"] = no_sim
        if not 12 <= len(_digits(no_sim)) <= 14:
            warn.append("Nomor SIM terbaca tidak lazim (bukan 12-14 digit) — periksa ulang.")
    tipe = golongan_ke_tipe(sim.get("golongan"))
    if tipe:
        fields["tipe_sim"] = tipe
    elif str(sim.get("golongan") or "").strip():
        warn.append(f"Golongan SIM '{sim.get('golongan')}' tidak dikenali — pilih tipe SIM manual.")

    nama = " ".join(str(ktp.get("nama") or sim.get("nama") or "").split()).upper()
    if nama:
        fields["nama"] = nama
    n_ktp = " ".join(str(ktp.get("nama") or "").split()).upper()
    n_sim = " ".join(str(sim.get("nama") or "").split()).upper()
    if n_ktp and n_sim and n_ktp != n_sim:
        warn.append(f"Nama di KTP ('{n_ktp}') dan SIM ('{n_sim}') berbeda — periksa.")
    alamat = " ".join(str(ktp.get("alamat") or sim.get("alamat") or "").split())
    if alamat:
        fields["alamat"] = alamat.upper()

    return {
        "fields": fields,
        "ktp": {"ada": bool(ktp.get("ada")), "box": _box(ktp.get("box"))},
        "sim": {"ada": bool(sim.get("ada")), "box": _box(sim.get("box"))},
        "peringatan": warn,
    }
