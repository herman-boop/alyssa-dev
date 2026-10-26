"""Pengingat lembut ke driver."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import driver_notif as dn  # noqa: E402
from test_nama_kembar import Coll, DB  # noqa: E402


class C2(Coll):
    async def find_one(self, q, proj=None):
        for d in self.docs:
            if self._m(d, q):
                return dict(d)
        return None

    async def update_one(self, q, upd, upsert=False):
        for d in self.docs:
            if self._m(d, q):
                d.update(upd["$set"])
                return
        if upsert:
            self.docs.append(dict(upd["$set"]))


def run(c):
    return asyncio.run(c)


def mk():
    db = DB()
    db.c["driver_wa"] = C2([{"key": "achmad reza", "driver_nama": "Achmad Reza", "no_hp": "6281234567890"}])
    db.c["driver_reminders"] = C2([])
    return db


def sender(ok=True):
    sent = []
    async def f(to, msg):
        sent.append((to, msg))
        return {"ok": ok, "error": None if ok else "boom"}
    return f, sent


def test_pesan_sopan_dan_sapaan():
    t = dn.build_reminder("Achmad Reza", "Hilux Rangga", "ORD-1", "BASTK belum diunggah.", hour=9)
    assert t.startswith("Selamat pagi Achmad Reza") and "dengan lembut" in t and "BASTK belum diunggah." in t
    assert "Selamat malam" in dn.build_reminder("", "", "O", "x", hour=20)


def test_kirim_lalu_cooldown():
    db = mk(); f, sent = sender()
    r = run(dn.remind(db, "ACHMAD  REZA", "", "Hilux", "ORD-1", "BASTK belum diunggah.", f))
    assert r["status"] == "terkirim" and len(sent) == 1 and sent[0][0] == "6281234567890"
    r2 = run(dn.remind(db, "Achmad Reza", "", "Hilux", "ORD-1", "BASTK belum diunggah.", f))
    assert r2["status"] == "sudah" and len(sent) == 1                       # tidak dobel
    later = datetime.now(timezone.utc) + timedelta(minutes=31)
    r3 = run(dn.remind(db, "Achmad Reza", "", "Hilux", "ORD-1", "BASTK belum diunggah.", f, now=later))
    assert r3["status"] == "terkirim" and len(sent) == 2                    # lewat jeda boleh lagi


def test_tanpa_nomor_pakai_hp_cadangan_atau_kembalikan_teks():
    db = mk(); f, sent = sender()
    r = run(dn.remind(db, "Budi", "", "Hilux", "ORD-2", "x", f))
    assert r["status"] == "tanpa_nomor" and r["text"] and not sent
    r = run(dn.remind(db, "Budi", "0812 3456 7891", "Hilux", "ORD-2", "x", f))
    assert r["status"] == "terkirim" and sent[0][0] == "6281234567891"


def test_gagal_kirim_tercatat_dan_boleh_coba_lagi():
    db = mk(); f, sent = sender(ok=False)
    r = run(dn.remind(db, "Achmad Reza", "", "Hilux", "ORD-3", "x", f))
    assert r["status"] == "gagal"
    f2, sent2 = sender()
    assert run(dn.remind(db, "Achmad Reza", "", "Hilux", "ORD-3", "x", f2))["status"] == "terkirim"
