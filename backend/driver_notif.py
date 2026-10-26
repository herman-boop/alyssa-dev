"""
Notifikasi WhatsApp ke driver begitu insentif checkpoint-nya DIBAYAR (manual maupun lewat Flip).

Supaya admin tidak perlu mengabari driver satu-satu: setelah item ditandai "dibayar", driver otomatis
menerima 1 pesan ringkas (total + tanggal checkpoint). Aturan keselamatan:
  - Nomor WA driver disimpan sekali di koleksi `driver_wa` (kunci = nama driver, tanpa beda huruf besar/kecil).
    Tidak ada nomor -> tidak ada pesan (pembayaran tetap jalan).
  - Anti dobel: tiap item "diklaim" secara atomik (field `wa_notif`) sebelum kirim, jadi pesan yang sama
    tidak terkirim dua kali walau dua jalur (Bayar manual / refresh Flip) terpanggil bersamaan atau diulang.
  - Gagal kirim tidak pernah menggagalkan pembayaran; hasilnya hanya dicatat di item (`wa_notif`).
Modul murni (tanpa import server): pengirim WA dioper dari luar.
"""
import re
from datetime import datetime, timezone

COLL = "driver_wa"
ITEMS = "driver_incentives"
SIGN = "Alyssa Logistik"
MAX_TGL = 6


def norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def wa_number(no_hp):
    """08xx / +62xx / 62xx -> 62xxxx kalau valid (mulai 628, 10-15 digit), selain itu ''."""
    n = "".join(ch for ch in str(no_hp or "") if ch.isdigit())
    if n.startswith("0"):
        n = "62" + n[1:]
    return n if n.startswith("628") and 10 <= len(n) <= 15 else ""


def rp(n):
    return "Rp " + f"{int(n or 0):,}".replace(",", ".")


def _tgl(s):
    try:
        d = datetime.strptime(str(s)[:10], "%Y-%m-%d")
        return f"{d.day:02d}/{d.month:02d}"
    except ValueError:
        return ""


def build_message(driver_nama, items):
    """Pesan ke driver: total + jumlah titik + tanggal checkpoint (maks. 6, sisanya 'dst')."""
    total = sum(int(i.get("amount") or 0) for i in items)
    tgls = sorted({t for t in (_tgl(i.get("date")) for i in items) if t})
    nama = (driver_nama or "").strip() or "Driver"
    lines = [f"Halo {nama},", "", f"Insentif checkpoint Anda sebesar {rp(total)} ({len(items)} titik) sudah ditransfer."]
    if tgls:
        lines.append("Tanggal: " + ", ".join(tgls[:MAX_TGL]) + (" dst" if len(tgls) > MAX_TGL else ""))
    lines += ["Mohon dicek di rekening Anda. Terima kasih.", "", f"- {SIGN}"]
    return "\n".join(lines)


async def get_number(db, driver_nama):
    d = await db[COLL].find_one({"key": norm(driver_nama)})
    return wa_number((d or {}).get("no_hp"))


async def list_numbers(db):
    out = []
    async for d in db[COLL].find({}):
        if d.get("no_hp"):
            out.append({"key": d.get("key"), "driver_nama": d.get("driver_nama"), "no_hp": d.get("no_hp")})
    return out


async def save_number(db, driver_nama, no_hp):
    """Simpan / ganti nomor WA driver. Kosong = hapus (notif mati untuk driver itu)."""
    key = norm(driver_nama)
    if not key:
        raise ValueError("Nama driver wajib diisi")
    raw = str(no_hp or "").strip()
    n = wa_number(raw) if raw else ""
    if raw and not n:
        raise ValueError("Nomor WA tidak valid. Contoh: 081234567890")
    await db[COLL].update_one({"key": key}, {"$set": {"key": key, "driver_nama": (driver_nama or "").strip()[:120],
                                                       "no_hp": n, "updated_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"driver_nama": (driver_nama or "").strip(), "no_hp": n}


async def notify_paid(db, items, send):
    """Kirim notif untuk item yang BARU ditandai dibayar. `send` = async (to, message) -> {"ok": bool}.
    Return: {nama_driver: "terkirim" | "tanpa_nomor" | "sudah" | "gagal"}. Tidak pernah raise."""
    groups = {}
    for it in items or []:
        groups.setdefault(norm(it.get("driver_nama")), []).append(it)
    result = {}
    for key, rows in groups.items():
        nama = (rows[0].get("driver_nama") or "").strip()
        label = nama or "(tanpa nama)"
        try:
            to = await get_number(db, nama)
            if not to:
                result[label] = "tanpa_nomor"
                continue
            claimed = []
            for it in rows:   # klaim atomik: hanya item yang belum pernah diklaim yang ikut pesan ini
                r = await db[ITEMS].update_one({"id": it.get("id"), "wa_notif": None}, {"$set": {"wa_notif": "klaim"}})
                if getattr(r, "modified_count", 0):
                    claimed.append(it)
            if not claimed:
                result[label] = "sudah"
                continue
            res = await send(to, build_message(nama, claimed))
            good = bool(res and res.get("ok"))
            stamp = {"wa_notif": "terkirim" if good else "gagal", "wa_notif_at": datetime.now(timezone.utc).isoformat()}
            if not good:
                stamp["wa_notif_error"] = str((res or {}).get("error") or "gagal kirim")[:200]
            for it in claimed:
                await db[ITEMS].update_one({"id": it.get("id")}, {"$set": stamp})
            result[label] = "terkirim" if good else "gagal"
        except Exception:
            result[label] = "gagal"
    return result


# ── Pengingat lembut ke driver (admin tekan tombol di dasbor) ──
REMIND = "driver_reminders"
REMIND_COOLDOWN_MIN = 30


def _sapaan(hour):
    h = 8 if hour is None else int(hour)
    return "Selamat pagi" if h < 11 else "Selamat siang" if h < 15 else "Selamat sore" if h < 18 else "Selamat malam"


def build_reminder(driver_nama, unit, order_id, butir, hour=None):
    """Pesan sopan: minta tolong, bukan menegur. Memberi ruang kalau ada kendala."""
    nama = (driver_nama or "").strip() or "Pak/Bu"
    unit = (unit or "").strip() or "unit"
    return "\n".join([
        f"{_sapaan(hour)} {nama}, semoga sehat selalu 🙏", "",
        f"Mohon maaf mengganggu. Kami ingin mengingatkan dengan lembut untuk {unit} (order {order_id}):",
        f"• {(butir or '').strip()}", "",
        "Kalau sudah dikerjakan, mohon kabari kami ya. Kalau ada kendala di jalan, tidak apa-apa, langsung kabari saja supaya kami bisa bantu.", "",
        "Terima kasih banyak 🙏", f"- {SIGN}",
    ])


async def remind(db, driver_nama, hp_cadangan, unit, order_id, butir, send, now=None, hour=None):
    """Kirim 1 pengingat. Nomor dari `driver_wa` (kunci nama), kalau kosong pakai hp_cadangan.
    Anti-spam: butir yang sama untuk order yang sama tidak dikirim ulang < REMIND_COOLDOWN_MIN menit.
    Return {status: terkirim|gagal|tanpa_nomor|sudah, to, text}. Tidak pernah raise."""
    now = now or datetime.now(timezone.utc)
    text = build_reminder(driver_nama, unit, order_id, butir, hour)
    try:
        to = await get_number(db, driver_nama) or wa_number(hp_cadangan)
        if not to:
            return {"status": "tanpa_nomor", "to": "", "text": text}
        key = f"{order_id}|{norm(butir)}"
        last = await db[REMIND].find_one({"key": key, "status": "terkirim"})
        if last:
            try:
                age = (now - datetime.fromisoformat(str(last.get("sent_at")).replace("Z", "+00:00"))).total_seconds() / 60
            except ValueError:
                age = 9999
            if age < REMIND_COOLDOWN_MIN:
                return {"status": "sudah", "to": to, "text": text}
        res = await send(to, text)
        good = bool(res and res.get("ok"))
        await db[REMIND].update_one({"key": key}, {"$set": {
            "key": key, "order_id": order_id, "driver_nama": (driver_nama or "").strip(), "butir": butir,
            "status": "terkirim" if good else "gagal", "sent_at": now.isoformat(),
            "error": "" if good else str((res or {}).get("error") or "gagal kirim")[:200]}}, upsert=True)
        return {"status": "terkirim" if good else "gagal", "to": to, "text": text}
    except Exception:
        return {"status": "gagal", "to": "", "text": text}
