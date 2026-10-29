"""
Riwayat Aktivitas akun (ala Mekari): siapa melakukan apa dan kapan.
Dicatat otomatis oleh middleware untuk setiap perubahan data (POST/PUT/PATCH/DELETE) yang sukses dan
dilakukan lewat akun. Yang tidak membawa token akun (mis. driver lewat link) tidak dicatat.
"""
import re
import uuid
from datetime import datetime, timezone

COLL = "activity_log"
SKIP = re.compile(r"^/(admin/(auth|aktivitas|tugas-saya|kpi/saya)|auth/)")
_M = ("POST", "PUT", "PATCH", "DELETE")

# (metode, pola path relatif /api, teks aksi, grup ref). Urutan penting: yang spesifik di atas.
RULES = [
    ("POST", r"^/orders/([^/]+)/convert$", "Konversi pesanan ke Trip", 1),
    ("POST", r"^/admin/trips/([^/]+)/checkpoint-manual$", "Input checkpoint manual", 1),
    ("DELETE", r"^/admin/trips/([^/]+)/checkpoint-manual/[^/]+$", "Hapus checkpoint manual", 1),
    ("PATCH", r"^/admin/trips/([^/]+)/legs$", "Mengatur leg perjalanan", 1),
    ("POST", r"^/admin/trips/([^/]+)/legs/[^/]+/task-link$", "Membuat link tugas untuk petugas/driver", 1),
    ("POST", r"^/admin/driver-wa/ingatkan$", "Mengirim pengingat ke driver", None),
    ("POST", r"^/admin/drivers/([^/]+)/foto/([^/]+)$", "Upload foto driver", 1),
    ("POST", r"^/admin/drivers$", "Menambah data driver", None),
    ("PUT", r"^/admin/drivers/([^/]+)$", "Mengubah data driver", 1),
    ("PATCH", r"^/admin/drivers/([^/]+)$", "Mengubah data driver", 1),
    ("POST", r"^/trips/([^/]+)/album$", "Upload foto album", 1),
    ("POST", r"^/trips/([^/]+)/photos/handover-bastk$", "Upload BASTK", 1),
    ("POST", r"^/trips/([^/]+)/photos/handover-resi$", "Upload foto resi", 1),
    ("POST", r"^/trips/([^/]+)/bastk$", "Menyimpan data BASTK", 1),
    ("POST", r"^/admin/kpi/submit/([^/]+)$", "Submit trip untuk poin", 1),
    ("POST", r"^/admin/kpi/tinjau/([^/]+)$", "Meninjau trip (KPI)", 1),
    ("POST", r"^/admin/kpi/bayar$", "Menandai pekan KPI sudah dibayar", None),
    ("PATCH", r"^/admin/orders/([^/]+)$", "Mengubah pesanan", 1),
    ("POST", r"^/admin/doc-history$", "Menyimpan dokumen ke Histori", None),
]


def label(method, path):
    """(aksi, ref) untuk request ini, atau None kalau tidak perlu dicatat."""
    m = (method or "").upper()
    p = path[4:] if (path or "").startswith("/api/") else (path or "")
    if m not in _M or SKIP.match(p):
        return None
    for mm, pat, teks, g in RULES:
        if m == mm:
            r = re.match(pat, p)
            if r:
                return teks, (r.group(g) if g else "")
    if p.startswith("/admin/"):
        seg = p.split("/")[2] if len(p.split("/")) > 2 else "data"
        return f"Mengubah data ({seg})", ""
    return None


async def catat(db, user, method, path, status_code):
    if status_code >= 400 or not user:
        return False
    lb = label(method, path)
    if not lb:
        return False
    aksi, ref = lb
    await db[COLL].insert_one({
        "id": uuid.uuid4().hex, "ts": datetime.now(timezone.utc).isoformat(),
        "user_id": user.get("user_id"), "nama": user.get("nama") or user.get("email") or "",
        "role": user.get("role"), "aksi": aksi, "ref": ref, "method": method.upper(), "path": path,
    })
    return True


async def daftar(db, user_id=None, limit=100, sebelum=None):
    """Terbaru dulu. user_id=None → semua akun (hanya Pemilik)."""
    q = {}
    if user_id:
        q["user_id"] = user_id
    if sebelum:
        q["ts"] = {"$lt": sebelum}
    n = max(1, min(int(limit or 100), 300))
    rows = []
    async for d in db[COLL].find(q, {"_id": 0}).sort("ts", -1).limit(n):
        d.pop("_id", None)
        rows.append(d)
    return rows
