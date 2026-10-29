"""KPI Admin Operasional 2: pekan, penilaian trip, submit, tinjau, bayar, riwayat aktivitas."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import aktivitas as ak  # noqa: E402
import kpi  # noqa: E402

WIB = kpi.WIB


def run(c):
    return asyncio.run(c)


def _get(d, path):
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    return d


class Cur:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, key, direction):
        self.rows.sort(key=lambda r: r.get(key) or "", reverse=direction < 0)
        return self

    def limit(self, n):
        self.rows = self.rows[:n]
        return self

    def __aiter__(self):
        self.it = iter(self.rows)
        return self

    async def __anext__(self):
        try:
            return dict(next(self.it))
        except StopIteration:
            raise StopAsyncIteration


class Coll:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]

    @staticmethod
    def _m(d, q):
        for k, v in q.items():
            got = _get(d, k)
            if isinstance(v, dict) and "$lt" in v:
                if not (got is not None and got < v["$lt"]):
                    return False
            elif got != v:
                return False
        return True

    def find(self, q=None, proj=None):
        return Cur([dict(d) for d in self.docs if self._m(d, q or {})])

    async def find_one(self, q, proj=None):
        for d in self.docs:
            if self._m(d, q):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd, upsert=False):
        for d in self.docs:
            if self._m(d, q):
                d.update(upd["$set"])
                return
        if upsert:
            self.docs.append({**q, **upd["$set"]})


class DB:
    def __init__(self):
        self.c = {}

    def __getattr__(self, k):
        return self.c.setdefault(k, Coll())

    def __getitem__(self, k):
        return self.c.setdefault(k, Coll())


# ── pekan ──
def test_batas_pekan_minggu_0900():
    f = lambda y, m, d, h, mi=0: kpi.week_start(datetime(y, m, d, h, mi, tzinfo=WIB)).strftime("%Y-%m-%d %H:%M")
    # 25 Okt 2026 = Minggu
    assert f(2026, 10, 25, 9) == "2026-10-25 09:00"       # tepat 09:00 → pekan baru
    assert f(2026, 10, 25, 8, 59) == "2026-10-18 09:00"   # sebelum 09:00 → masih pekan lama
    assert f(2026, 10, 26, 10) == "2026-10-25 09:00"      # Senin
    assert f(2026, 10, 31, 23) == "2026-10-25 09:00"      # Sabtu
    info = kpi.week_info(kpi.week_start(datetime(2026, 10, 28, 12, tzinfo=WIB)))
    assert info["key"] == "2026-10-25" and info["selesai"].startswith("2026-11-01T09:00") and info["bayar_pada"].startswith("2026-11-02T09:00")


# ── penilaian trip ──
def cp(date, id_=None, manual=False):
    return {"id": id_ or f"cp-{date}", "date": date, "ts": f"{date}T05:00:00+00:00", "url": "x", **({"manual": True} if manual else {})}


def trip4(dates=("2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"), asal=True, bastk=True, legs=None):
    return {
        "trip_id": "TRIP-1", "source_order_id": "ORD-1", "legs": legs if legs is not None else [{"tipe": "Self Drive"}],
        "album": {"asal": [{"id": "a", "ts": "2026-10-12T01:00:00+00:00"}] if asal else [], "kapal": [], "tujuan": [], "dokumen": []},
        "daily_checkpoints": [cp(d) for d in dates],
        "handover": {"bastk": [{"id": "b", "ts": "2026-10-15T09:00:00+00:00"}] if bastk else [], "resi": None},
    }


DELIV = {"order_id": "ORD-1", "status": "DELIVERED", "customer_nama": "PT BRI"}


def test_mulus_4_hari_hijau():
    ev = kpi.periksa_trip(trip4(), DELIV)
    assert ev["warna"] == "hijau" and ev["poin"] == 1.0 and ev["siap"]
    assert ev["hari"]["butuh"] == 4 and ev["hari"]["ada"] == 4


def test_checkpoint_bolong_gugur_merah():
    ev = kpi.periksa_trip(trip4(dates=("2026-10-12", "2026-10-14", "2026-10-15")), DELIV)
    assert ev["warna"] == "merah" and ev["poin"] == 0.0
    assert ev["hari"]["kosong"] == ["2026-10-13"] and "Checkpoint tidak lengkap" in ev["alasan"][0]


def test_foto_asal_kosong_kuning_setengah():
    ev = kpi.periksa_trip(trip4(asal=False), DELIV)
    assert ev["warna"] == "kuning" and ev["poin"] == 0.5 and ev["alasan"] == ["Foto asal kosong"]


def test_foto_asal_tidak_sah_kuning():
    ev = kpi.periksa_trip(trip4(), DELIV, {"asal_tidak_sah": True})
    assert ev["warna"] == "kuning" and ev["poin"] == 0.5 and ev["alasan"] == ["Foto asal tidak sah"]
    ev = kpi.periksa_trip(trip4(asal=False), DELIV, {"asal_tidak_sah": True})   # kosong tetap dilaporkan "kosong", tidak ganda
    assert ev["alasan"] == ["Foto asal kosong"]


def test_foto_asal_menentukan_hari_berangkat():
    # foto asal 12 Okt tapi checkpoint pertama baru 13 Okt → hari 12 kosong → merah
    ev = kpi.periksa_trip(trip4(dates=("2026-10-13", "2026-10-14", "2026-10-15")), DELIV)
    assert ev["warna"] == "merah" and ev["hari"]["kosong"] == ["2026-10-12"]


def test_bastk_belum_jelas_kuning_dan_tolak_cp_merah():
    ev = kpi.periksa_trip(trip4(), DELIV, {"bastk_tidak_jelas": True})
    assert ev["warna"] == "kuning" and "BASTK belum jelas" in ev["alasan"]
    ev = kpi.periksa_trip(trip4(), DELIV, {"tolak_cp": ["cp-2026-10-13"]})
    assert ev["warna"] == "merah"
    ev = kpi.periksa_trip(trip4(), DELIV, {"klaim": True, "catatan": "baret"})
    assert ev["warna"] == "merah" and "baret" in ev["alasan"][0]


def test_siap_submit_butuh_selesai_dan_bastk():
    assert not kpi.periksa_trip(trip4(), {**DELIV, "status": "ON_TRIP"})["siap"]
    ev = kpi.periksa_trip(trip4(bastk=False), DELIV)
    assert not ev["siap"] and ev["siap_alasan"] == "BASTK belum diunggah" and ev["warna"] == "merah"
    assert kpi.periksa_trip(trip4(), {**DELIV, "status": "CANCELLED"})["warna"] == "merah"


def test_trip_dengan_kapal_cukup_satu_checkpoint():
    t = trip4(dates=("2026-10-12",), legs=[{"tipe": "Self Drive"}, {"tipe": "Kapal RoRo"}])
    assert kpi.periksa_trip(t, DELIV)["warna"] == "hijau"
    t["daily_checkpoints"] = []
    assert kpi.periksa_trip(t, DELIV)["warna"] == "merah"


# ── alur: submit → pekan → tinjau → bayar ──
USER = {"user_id": "U2", "nama": "Rina", "email": "r@x.id", "role": "admin_ops_2", "status": "aktif"}


def mkdb():
    db = DB()
    t = trip4()
    t["kpi_owner"] = {"user_id": "U2", "nama": "Rina", "role": "admin_ops_2"}
    t2 = {**trip4(asal=False), "trip_id": "TRIP-2", "source_order_id": "ORD-2", "kpi_owner": {"user_id": "U2", "nama": "Rina"}}
    t3 = {**trip4(), "trip_id": "TRIP-3", "source_order_id": "ORD-3", "kpi_owner": {"user_id": "U2", "nama": "Rina"}}
    db.c["trips"] = Coll([t, t2, t3])
    db.c["orders"] = Coll([DELIV, {**DELIV, "order_id": "ORD-2"}, {**DELIV, "order_id": "ORD-3", "status": "ON_TRIP"}])
    db.c["app_users"] = Coll([USER, {"user_id": "O", "role": "pemilik", "status": "aktif", "nama": "Herman"}])
    return db


def test_submit_hanya_pemilik_trip_dan_harus_siap():
    db = mkdb()
    try:
        run(kpi.submit(db, "TRIP-3", USER)); assert False          # masih ON_TRIP
    except ValueError as e:
        assert "belum berstatus Selesai" in str(e)
    try:
        run(kpi.submit(db, "TRIP-1", {"user_id": "U9", "role": "admin_ops_2"})); assert False
    except PermissionError:
        pass
    r = run(kpi.submit(db, "TRIP-1", USER))
    assert r["ok"] and not r["sudah"] and r["warna"] == "hijau"
    assert run(kpi.submit(db, "TRIP-1", USER))["sudah"]               # idempoten
    assert len(db.c["kpi_submissions"].docs) == 1


def test_pekan_total_proses_dan_pembayaran():
    db = mkdb()
    run(kpi.submit(db, "TRIP-1", USER)); run(kpi.submit(db, "TRIP-2", USER))
    now = datetime.now(timezone.utc)
    start = kpi.week_start(now)
    m = run(kpi.minggu(db, "U2", start, now))
    assert m["totals"]["hijau"] == 1 and m["totals"]["kuning"] == 1 and m["totals"]["poin"] == 1.5
    assert m["totals"]["rupiah"] == 75000 and m["totals"]["proses"] == 1 and m["proses"][0]["trip_id"] == "TRIP-3"
    assert not m["bisa_dibayar"]                                        # pekan belum ditutup
    # pekan depan (Minggu 09:00 lewat) → boleh dibayar
    later = start + timedelta(days=7, hours=1)
    assert run(kpi.minggu(db, "U2", start, later))["bisa_dibayar"]
    try:
        run(kpi.bayar(db, "U2", m["key"], {"nama": "Herman"}, now)); assert False
    except ValueError as e:
        assert "belum ditutup" in str(e)
    r = run(kpi.bayar(db, "U2", m["key"], {"nama": "Herman"}, later))
    assert not r["sudah"] and r["totals"]["rupiah"] == 75000
    assert run(kpi.bayar(db, "U2", m["key"], {"nama": "Herman"}, later))["sudah"]
    # sesudah dibayar: nilai dibekukan & tinjauan ditolak
    assert run(kpi.minggu(db, "U2", start, later))["terbayar"]
    try:
        run(kpi.tinjau(db, "TRIP-1", {"klaim": True}, {"nama": "Herman"})); assert False
    except ValueError as e:
        assert "sudah dibayar" in str(e)


def test_tinjau_menurunkan_nilai():
    db = mkdb()
    run(kpi.submit(db, "TRIP-1", USER))
    run(kpi.tinjau(db, "TRIP-1", {"bastk_tidak_jelas": True}, {"nama": "Herman"}))
    now = datetime.now(timezone.utc)
    m = run(kpi.minggu(db, "U2", kpi.week_start(now), now))
    assert m["totals"]["kuning"] == 1 and m["totals"]["poin"] == 0.5


def test_ringkasan_hanya_akun_kpi():
    db = mkdb()
    run(kpi.submit(db, "TRIP-1", USER))
    now = datetime.now(timezone.utc)
    r = run(kpi.ringkasan(db, kpi.week_start(now), now))
    assert [x["user_id"] for x in r] == ["U2"] and r[0]["totals"]["poin"] == 1.0


def test_tugas_saya():
    db = mkdb()
    db.c["orders"].docs.append({"order_id": "ORD-9", "status": "NEW", "customer_nama": "PT X"})
    db.c["trips"].docs[2]["legs"] = []
    t = run(kpi.tugas_saya(db, USER, "2026-10-26"))
    teks = [(x["jenis"], x.get("trip_id")) for x in t]
    assert ("konversi", None) in teks
    assert ("leg", "TRIP-3") in teks and ("driver", "TRIP-1") in teks      # driver belum ditugaskan
    assert ("submit", "TRIP-1") in teks and ("checkpoint", "TRIP-3") in teks


# ── riwayat aktivitas ──
def test_label_aktivitas():
    assert ak.label("POST", "/api/orders/ORD-1/convert") == ("Konversi pesanan ke Trip", "ORD-1")
    assert ak.label("PATCH", "/api/admin/trips/TRIP-1/legs") == ("Mengatur leg perjalanan", "TRIP-1")
    assert ak.label("POST", "/api/trips/TRIP-1/album")[0] == "Upload foto album"
    assert ak.label("GET", "/api/admin/orders") is None
    assert ak.label("POST", "/api/admin/auth") is None
    assert ak.label("POST", "/api/admin/xyz/1")[0] == "Mengubah data (xyz)"
    assert ak.label("POST", "/api/trips/T/photos/daily") is None            # driver, bukan admin


def test_catat_dan_daftar():
    db = DB()
    assert run(ak.catat(db, USER, "POST", "/api/orders/ORD-1/convert", 200))
    assert not run(ak.catat(db, USER, "POST", "/api/orders/ORD-1/convert", 500))   # gagal tidak dicatat
    assert not run(ak.catat(db, None, "POST", "/api/orders/ORD-1/convert", 200))   # tanpa akun
    run(ak.catat(db, {"user_id": "U3", "nama": "Lain", "role": "pemilik"}, "PATCH", "/api/admin/orders/ORD-2", 200))
    mine = run(ak.daftar(db, "U2"))
    assert len(mine) == 1 and mine[0]["aksi"] == "Konversi pesanan ke Trip" and mine[0]["nama"] == "Rina"
    assert len(run(ak.daftar(db))) == 2


# ── hak akses peran ──
def test_hak_akses_kpi():
    try:
        import app_users as au
    except Exception:       # lingkungan tanpa bcrypt/jwt
        return
    c = au.can
    assert c("admin_ops_2", "POST", "/api/admin/kpi/submit/TRIP-1")
    assert c("admin_ops_2", "POST", "/api/admin/trips/TRIP-1/checkpoint-manual")
    assert not c("admin_ops_2", "POST", "/api/admin/kpi/tinjau/TRIP-1")
    assert not c("admin_ops_2", "POST", "/api/admin/kpi/bayar")
    assert not c("admin_ops_2", "POST", "/api/admin/kpi/pemilik/TRIP-1")
    assert not c("admin_ops_1", "POST", "/api/admin/kpi/submit/TRIP-1")
    assert c("pemilik", "POST", "/api/admin/kpi/bayar")
    assert c("admin_ops_1", "GET", "/api/admin/aktivitas")
