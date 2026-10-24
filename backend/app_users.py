"""
Akun pengguna aplikasi (Tahap 1): Pemilik, undang lewat link sekali pakai,
login email+password, ubah peran, nonaktifkan, hapus.

Koleksi `app_users` (1 dokumen per pengguna):
  user_id, email (unik, huruf kecil), nama, role, status ("undangan"|"aktif"|"nonaktif"),
  pw_hash (bcrypt), invite_hash (sha256 token), invite_expires_at, access_expires_at,
  fail_count, locked_until, created_at, created_by, last_login

Additif: tidak mengubah PIN admin yang sudah ada dan tidak menyentuh koleksi lain.
Tahap 1 hanya untuk mengelola akun; pembatasan menu per peran menyusul (Tahap 2).
Password tidak pernah disimpan polos; token undangan hanya disimpan sebagai hash.
"""
import hashlib
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

COLL = "app_users"
SETTINGS = "app_settings"
OWNER_EMAIL = (os.environ.get("OWNER_EMAIL") or "syahh6260@gmail.com").strip().lower()
OWNER_NAME = "Hermansyah"
ROLES = {
    "pemilik": "Pemilik",
    "admin_operasional": "Admin Operasional",
    "keuangan": "Keuangan",
    "pembaca": "Pembaca",
}
INVITABLE = ("admin_operasional", "keuangan", "pembaca")
INVITE_DAYS = 7
TOKEN_HOURS = 12
MAX_FAIL = 5
LOCK_MINUTES = 15
MIN_PW = 8
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _now():
    return datetime.now(timezone.utc)


def _iso(dt):
    return dt.isoformat() if dt else None


def _parse(s):
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def norm_email(v):
    return (v or "").strip().lower()


def valid_email(v):
    return bool(_EMAIL_RE.match(norm_email(v))) and len(norm_email(v)) <= 120


def check_password(pw):
    pw = pw or ""
    if len(pw) < MIN_PW:
        raise ValueError(f"Password minimal {MIN_PW} karakter")
    if len(pw.encode("utf-8")) > 72:
        raise ValueError("Password terlalu panjang (maks 72 karakter)")


def hash_pw(pw):
    check_password(pw)
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_pw(pw, h):
    try:
        return bool(h) and bcrypt.checkpw((pw or "").encode("utf-8"), h.encode("ascii"))
    except Exception:
        return False


def _tok_hash(t):
    return hashlib.sha256((t or "").encode("utf-8")).hexdigest()


def public_user(d):
    if not d:
        return None
    return {
        "user_id": d.get("user_id"),
        "email": d.get("email"),
        "nama": d.get("nama") or "",
        "role": d.get("role"),
        "role_label": ROLES.get(d.get("role"), d.get("role")),
        "status": d.get("status"),
        "is_owner": d.get("role") == "pemilik",
        "has_password": bool(d.get("pw_hash")),
        "access_expires_at": d.get("access_expires_at"),
        "last_login": d.get("last_login"),
        "created_at": d.get("created_at"),
    }


async def _secret(db):
    doc = await db[SETTINGS].find_one_and_update(
        {"key": "user_jwt_secret"},
        {"$setOnInsert": {"key": "user_jwt_secret", "value": secrets.token_hex(32)}},
        upsert=True, return_document=True,
    )
    return doc["value"]


async def ensure_owner(db):
    try:
        await db[COLL].create_index("email", unique=True)
        await db[COLL].create_index("user_id", unique=True)
    except Exception:
        pass
    o = await db[COLL].find_one({"role": "pemilik"})
    if o:
        return o
    doc = {
        "user_id": uuid.uuid4().hex, "email": OWNER_EMAIL, "nama": OWNER_NAME, "role": "pemilik",
        "status": "undangan", "pw_hash": None, "invite_hash": None, "invite_expires_at": None,
        "access_expires_at": None, "fail_count": 0, "locked_until": None,
        "created_at": _iso(_now()), "created_by": "system", "last_login": None,
    }
    await db[COLL].insert_one(dict(doc))
    return doc


async def list_users(db):
    await ensure_owner(db)
    out = [public_user(d) async for d in db[COLL].find({}, {"_id": 0}).sort("created_at", 1)]
    return out


async def _new_invite(db, user_id):
    token = secrets.token_urlsafe(24)
    await db[COLL].update_one({"user_id": user_id}, {"$set": {
        "invite_hash": _tok_hash(token),
        "invite_expires_at": _iso(_now() + timedelta(days=INVITE_DAYS)),
    }})
    return token


async def invite(db, email, nama, role, access_days, by):
    await ensure_owner(db)
    email = norm_email(email)
    if not valid_email(email):
        raise ValueError("Email tidak valid")
    if role not in INVITABLE:
        raise ValueError("Peran tidak valid")
    if await db[COLL].find_one({"email": email}):
        raise ValueError("Email ini sudah terdaftar")
    exp = None
    if access_days not in (None, "", 0):
        try:
            n = int(access_days)
        except Exception:
            raise ValueError("Batas waktu akses harus angka hari")
        if not (1 <= n <= 3650):
            raise ValueError("Batas waktu akses 1 sampai 3650 hari")
        exp = _iso(_now() + timedelta(days=n))
    doc = {
        "user_id": uuid.uuid4().hex, "email": email, "nama": (nama or "").strip()[:80], "role": role,
        "status": "undangan", "pw_hash": None, "invite_hash": None, "invite_expires_at": None,
        "access_expires_at": exp, "fail_count": 0, "locked_until": None,
        "created_at": _iso(_now()), "created_by": by, "last_login": None,
    }
    await db[COLL].insert_one(dict(doc))
    token = await _new_invite(db, doc["user_id"])
    return public_user(doc), token


async def reinvite(db, user_id):
    u = await db[COLL].find_one({"user_id": user_id})
    if not u:
        raise LookupError("Pengguna tidak ditemukan")
    if u.get("pw_hash") and u.get("role") == "pemilik":
        raise ValueError("Akun Pemilik sudah punya password")
    if u.get("status") == "nonaktif":
        raise ValueError("Akun nonaktif; aktifkan dulu")
    return await _new_invite(db, user_id)


async def _by_token(db, token):
    if not token or len(token) < 20:
        return None
    u = await db[COLL].find_one({"invite_hash": _tok_hash(token)})
    if not u:
        return None
    exp = _parse(u.get("invite_expires_at"))
    if not exp or exp < _now() or u.get("status") == "nonaktif":
        return None
    return u


async def invite_info(db, token):
    u = await _by_token(db, token)
    if not u:
        return None
    return {"email": u["email"], "nama": u.get("nama") or "", "role_label": ROLES.get(u["role"], u["role"])}


async def accept_invite(db, token, password, nama):
    u = await _by_token(db, token)
    if not u:
        raise LookupError("Link undangan tidak valid atau sudah kedaluwarsa")
    h = hash_pw(password)
    upd = {"pw_hash": h, "status": "aktif", "invite_hash": None, "invite_expires_at": None,
           "fail_count": 0, "locked_until": None, "last_login": _iso(_now())}
    if (nama or "").strip():
        upd["nama"] = nama.strip()[:80]
    await db[COLL].update_one({"user_id": u["user_id"]}, {"$set": upd})
    u.update(upd)
    return u


def _access_ok(u):
    exp = _parse(u.get("access_expires_at"))
    return not (exp and exp < _now())


async def issue_token(db, u):
    payload = {"sub": u["user_id"], "role": u["role"], "exp": _now() + timedelta(hours=TOKEN_HOURS)}
    return jwt.encode(payload, await _secret(db), algorithm="HS256")


async def verify_token(db, token):
    try:
        data = jwt.decode(token, await _secret(db), algorithms=["HS256"])
    except Exception:
        return None
    u = await db[COLL].find_one({"user_id": data.get("sub")}, {"_id": 0})
    if not u or u.get("status") != "aktif" or not _access_ok(u):
        return None
    return u


async def login(db, email, password):
    await ensure_owner(db)
    bad = ValueError("Email atau password salah")
    u = await db[COLL].find_one({"email": norm_email(email)})
    if not u or not u.get("pw_hash"):
        raise bad
    lock = _parse(u.get("locked_until"))
    if lock and lock > _now():
        raise PermissionError("Terlalu banyak percobaan. Coba lagi 15 menit lagi.")
    if not verify_pw(password, u["pw_hash"]):
        n = int(u.get("fail_count") or 0) + 1
        upd = {"fail_count": n}
        if n >= MAX_FAIL:
            upd = {"fail_count": 0, "locked_until": _iso(_now() + timedelta(minutes=LOCK_MINUTES))}
        await db[COLL].update_one({"user_id": u["user_id"]}, {"$set": upd})
        raise bad
    if u.get("status") != "aktif":
        raise PermissionError("Akun belum aktif atau dinonaktifkan")
    if not _access_ok(u):
        raise PermissionError("Masa akses akun ini sudah habis")
    await db[COLL].update_one({"user_id": u["user_id"]}, {"$set": {"fail_count": 0, "locked_until": None, "last_login": _iso(_now())}})
    return u, await issue_token(db, u)


async def update_user(db, user_id, role=None, nama=None, status=None, access_days="__keep__"):
    u = await db[COLL].find_one({"user_id": user_id})
    if not u:
        raise LookupError("Pengguna tidak ditemukan")
    is_owner = u.get("role") == "pemilik"
    upd = {}
    if role is not None and role != u.get("role"):
        if is_owner:
            raise ValueError("Peran Pemilik tidak bisa diubah")
        if role not in INVITABLE:
            raise ValueError("Peran tidak valid")
        upd["role"] = role
    if nama is not None:
        upd["nama"] = nama.strip()[:80]
    if status is not None:
        if status not in ("aktif", "nonaktif"):
            raise ValueError("Status tidak valid")
        if is_owner and status != "aktif":
            raise ValueError("Akun Pemilik tidak bisa dinonaktifkan")
        if status == "aktif" and not u.get("pw_hash"):
            upd["status"] = "undangan"
        else:
            upd["status"] = status
    if access_days != "__keep__":
        if is_owner:
            raise ValueError("Akun Pemilik tidak punya batas waktu akses")
        if access_days in (None, "", 0):
            upd["access_expires_at"] = None
        else:
            n = int(access_days)
            if not (1 <= n <= 3650):
                raise ValueError("Batas waktu akses 1 sampai 3650 hari")
            upd["access_expires_at"] = _iso(_now() + timedelta(days=n))
    if not upd:
        raise ValueError("Tidak ada yang diubah")
    await db[COLL].update_one({"user_id": user_id}, {"$set": upd})
    u.update(upd)
    return public_user(u)


async def delete_user(db, user_id):
    u = await db[COLL].find_one({"user_id": user_id})
    if not u:
        raise LookupError("Pengguna tidak ditemukan")
    if u.get("role") == "pemilik":
        raise ValueError("Akun Pemilik tidak bisa dihapus")
    await db[COLL].delete_one({"user_id": user_id})
    return {"ok": True, "email": u.get("email")}
