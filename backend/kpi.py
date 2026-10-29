"""
KPI & poin Admin Operasional 2 (rekrutan baru). Admin Operasional 1 digaji bulanan, tidak ikut KPI.

Aturan (disepakati dengan Pemilik):
  - 1 trip "mulus" = 1 poin = Rp 50.000. Tidak ada batas minimal penukaran; dibayar tiap pekan.
  - Pekan dihitung Minggu 09:00 WIB sampai Minggu 09:00 berikutnya; pembayaran Senin 09:00.
  - Pemegang akun menekan Submit kalau trip sudah Selesai dan BASTK terunggah. Yang belum di-submit
    berstatus Proses dan tidak dihitung.
  - Penilaian otomatis saat submit/tinjau:
      MERAH (0 poin, gugur): trip dibatalkan, BASTK kosong, checkpoint tidak lengkap, ada klaim, atau ditolak Pemilik.
      KUNING (0,5 poin): foto asal kosong, atau BASTK ditandai "belum jelas" oleh Pemilik.
      HIJAU (1 poin): tidak ada cacat.
  - Checkpoint: trip self drive butuh minimal 1 checkpoint tiap tanggal (WIB), dari hari berangkat sampai hari
    serah terima. Trip yang memakai leg kapal cukup minimal 1 checkpoint (hari di kapal dilaporkan petugas kapal).
  - Checkpoint manual yang diinput pemegang akun sah, kecuali ditolak Pemilik saat tinjauan.
Modul murni terhadap `db` (tanpa import server) supaya mudah dites.
"""
from datetime import datetime, timedelta, timezone

WIB = timezone(timedelta(hours=7))
RUPIAH_PER_POIN = 50000
CUTOFF_JAM = 9
ROLE_KPI = "admin_ops_2"
SUBS = "kpi_submissions"
PAYOUTS = "kpi_payouts"
MAX_HARI = 60


def _now():
    return datetime.now(timezone.utc)


def _parse(v):
    if not v:
        return None
    try:
        d = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _wib_date(v):
    """Tanggal WIB (YYYY-MM-DD) dari ISO waktu, atau string tanggal polos."""
    s = str(v or "")
    if len(s) == 10 and s[4] == "-" and s[7] == "-":
        return s
    d = _parse(s)
    return d.astimezone(WIB).strftime("%Y-%m-%d") if d else None


# ───────────── pekan: Minggu 09:00 WIB → Minggu 09:00 WIB ─────────────
def week_start(now):
    w = now.astimezone(WIB)
    cand = w.replace(hour=CUTOFF_JAM, minute=0, second=0, microsecond=0) - timedelta(days=(w.weekday() + 1) % 7)
    if cand > w:
        cand -= timedelta(days=7)
    return cand


def week_info(start):
    end = start + timedelta(days=7)
    return {"key": start.strftime("%Y-%m-%d"), "mulai": start.isoformat(), "selesai": end.isoformat(),
            "bayar_pada": (end + timedelta(days=1)).isoformat()}


def week_from_key(key):
    d = datetime.strptime(str(key)[:10], "%Y-%m-%d").replace(hour=CUTOFF_JAM, tzinfo=WIB)
    return d


# ───────────── penilaian 1 trip ─────────────
def _days(start, end):
    a = datetime.strptime(start, "%Y-%m-%d")
    b = datetime.strptime(end, "%Y-%m-%d")
    out = []
    while a <= b and len(out) < MAX_HARI:
        out.append(a.strftime("%Y-%m-%d"))
        a += timedelta(days=1)
    return out


def periksa_trip(trip, order=None, flags=None):
    """Nilai 1 trip. Return {warna, poin, alasan, siap, siap_alasan, hari}."""
    flags = flags or {}
    trip = trip or {}
    order = order or {}
    legs = trip.get("legs") or order.get("legs") or []
    album = trip.get("album") or {}
    asal = album.get("asal") or []
    bastk = (trip.get("handover") or {}).get("bastk") or []
    tolak = set(flags.get("tolak_cp") or [])
    cps = [c for c in (trip.get("daily_checkpoints") or []) if c.get("id") not in tolak]
    dates = sorted({c.get("date") for c in cps if c.get("date")})
    kapal = any(str(l.get("tipe") or "").startswith("Kapal") for l in legs)

    merah, kuning = [], []
    status = order.get("status")
    if status == "CANCELLED":
        merah.append("Trip dibatalkan")
    if flags.get("ditolak"):
        merah.append("Ditolak Pemilik" + (f": {flags.get('catatan')}" if flags.get("catatan") else ""))
    if flags.get("klaim"):
        merah.append("Ada klaim" + (f": {flags.get('catatan')}" if flags.get("catatan") else ""))
    if not bastk:
        merah.append("BASTK belum diunggah")

    hari = {"butuh": 0, "ada": len(dates), "kosong": []}
    if not cps:
        merah.append("Belum ada checkpoint sama sekali")
    elif kapal:
        hari["butuh"] = 1
    else:
        starts = [dates[0]] + [d for d in (_wib_date(a.get("ts")) for a in asal) if d]
        start = min(starts)
        ends = [d for d in (_wib_date(b.get("ts")) for b in bastk) if d]
        end = min(ends) if ends else dates[-1]
        if end < start:
            end = start
        need = _days(start, end)
        kosong = [d for d in need if d not in dates]
        hari.update({"butuh": len(need), "kosong": kosong})
        if kosong:
            merah.append(f"Checkpoint tidak lengkap: butuh {len(need)} hari, tanggal kosong " + ", ".join(kosong))

    if not asal:
        kuning.append("Foto asal kosong")
    elif flags.get("asal_tidak_sah"):
        kuning.append("Foto asal tidak sah")
    if flags.get("bastk_tidak_jelas"):
        kuning.append("BASTK belum jelas")

    if status:
        siap = status == "DELIVERED" and bool(bastk)
        siap_alasan = "" if siap else ("Trip belum berstatus Selesai" if status != "DELIVERED" else "BASTK belum diunggah")
    else:
        siap = bool(bastk)
        siap_alasan = "" if siap else "BASTK belum diunggah"
    if status == "CANCELLED":
        siap, siap_alasan = False, "Trip dibatalkan"

    if merah:
        warna, poin, alasan = "merah", 0.0, merah
    elif kuning:
        warna, poin, alasan = "kuning", 0.5, kuning
    else:
        warna, poin, alasan = "hijau", 1.0, ["Mulus"]
    return {"warna": warna, "poin": poin, "alasan": alasan, "siap": siap, "siap_alasan": siap_alasan, "hari": hari}


# ───────────── akses data ─────────────
async def _all(cur):
    out = []
    async for d in cur:
        out.append(d)
    return out


async def _trip_order(db, trip_id):
    trip = await db.trips.find_one({"trip_id": trip_id}, {"_id": 0})
    if not trip:
        return None, None
    oid = trip.get("source_order_id")
    order = await db.orders.find_one({"order_id": oid}, {"_id": 0}) if oid else None
    return trip, order


def _row(trip, order, sub, ev):
    return {
        "trip_id": trip.get("trip_id"), "order_id": (order or {}).get("order_id") or trip.get("source_order_id"),
        "customer": (order or {}).get("customer_nama") or (trip.get("customer_data") or {}).get("nama") or "",
        "rute": trip.get("route") or "", "nopol": trip.get("nopol") or "",
        "status": ev["warna"] if sub else "proses",
        "warna_sementara": ev["warna"], "poin_sementara": ev["poin"], "poin": ev["poin"] if sub else 0.0,
        "alasan": ev["alasan"], "siap": ev["siap"], "siap_alasan": ev["siap_alasan"], "hari": ev["hari"],
        "submitted_at": (sub or {}).get("submitted_at"), "flags": (sub or {}).get("flags") or {},
        "checkpoint_manual": sum(1 for c in (trip.get("daily_checkpoints") or []) if c.get("manual")),
    }


async def submit(db, trip_id, user):
    """Pemegang akun menyerahkan trip untuk dinilai. Idempoten."""
    trip, order = await _trip_order(db, trip_id)
    if not trip:
        raise LookupError("Trip tidak ditemukan")
    owner = (trip.get("kpi_owner") or {}).get("user_id")
    if user.get("role") != "pemilik" and owner != user.get("user_id"):
        raise PermissionError("Trip ini bukan trip yang kamu kerjakan")
    old = await db[SUBS].find_one({"trip_id": trip_id}, {"_id": 0})
    if old:
        return {"ok": True, "sudah": True, "submitted_at": old.get("submitted_at")}
    ev = periksa_trip(trip, order, {})
    if not ev["siap"]:
        raise ValueError(ev["siap_alasan"] or "Trip belum siap di-submit")
    doc = {"trip_id": trip_id, "user_id": owner or user.get("user_id"), "nama": (trip.get("kpi_owner") or {}).get("nama") or user.get("nama"),
           "submitted_at": _now().isoformat(), "submitted_by": user.get("user_id"), "flags": {}}
    await db[SUBS].insert_one(dict(doc))
    return {"ok": True, "sudah": False, "submitted_at": doc["submitted_at"], "warna": ev["warna"], "poin": ev["poin"], "alasan": ev["alasan"]}


async def _paid(db, user_id, key):
    return await db[PAYOUTS].find_one({"user_id": user_id, "week_key": key}, {"_id": 0})


def _totals(rows, proses_n):
    t = {"hijau": 0, "kuning": 0, "merah": 0, "proses": proses_n, "poin": 0.0}
    for r in rows:
        t[r["status"]] = t.get(r["status"], 0) + 1
        t["poin"] += r["poin"]
    t["poin"] = round(t["poin"], 1)
    t["rupiah"] = int(round(t["poin"] * RUPIAH_PER_POIN))
    return t


async def minggu(db, user_id, start, now=None):
    """Ringkasan 1 pekan untuk 1 akun: trip ter-submit (berwarna) + trip yang masih Proses."""
    now = now or _now()
    info = week_info(start)
    end = start + timedelta(days=7)
    paid = await _paid(db, user_id, info["key"])
    if paid:
        return {**info, "terbayar": True, "dibayar_pada": paid.get("dibayar_pada"), "dibayar_oleh": paid.get("dibayar_oleh"),
                "totals": paid.get("totals"), "trips": paid.get("trips") or [], "proses": []}
    subs = [s for s in await _all(db[SUBS].find({"user_id": user_id}))
            if (d := _parse(s.get("submitted_at"))) and start <= d < end]
    rows = []
    for s in subs:
        trip, order = await _trip_order(db, s.get("trip_id"))
        if trip:
            rows.append(_row(trip, order, s, periksa_trip(trip, order, s.get("flags"))))
    rows.sort(key=lambda r: r.get("submitted_at") or "")
    proses = []
    if start == week_start(now):
        submitted_all = {s.get("trip_id") for s in await _all(db[SUBS].find({"user_id": user_id}))}
        for t in await _all(db.trips.find({"kpi_owner.user_id": user_id})):
            if t.get("trip_id") in submitted_all:
                continue
            oid = t.get("source_order_id")
            order = await db.orders.find_one({"order_id": oid}, {"_id": 0}) if oid else None
            if (order or {}).get("status") == "CANCELLED":
                continue
            proses.append(_row(t, order, None, periksa_trip(t, order, {})))
    return {**info, "terbayar": False, "totals": _totals(rows, len(proses)), "trips": rows, "proses": proses,
            "bisa_dibayar": now >= end and bool(rows)}


async def tinjau(db, trip_id, body, aktor):
    """Pemilik: tandai BASTK belum jelas / klaim / tolak checkpoint / tolak seluruhnya (sebelum pekan dibayar)."""
    sub = await db[SUBS].find_one({"trip_id": trip_id}, {"_id": 0})
    if not sub:
        raise LookupError("Trip ini belum di-submit")
    d = _parse(sub.get("submitted_at"))
    key = week_start(d).strftime("%Y-%m-%d")
    if await _paid(db, sub.get("user_id"), key):
        raise ValueError("Pekan ini sudah dibayar, tidak bisa diubah")
    flags = dict(sub.get("flags") or {})
    for k in ("bastk_tidak_jelas", "asal_tidak_sah", "klaim", "ditolak"):
        if k in body:
            flags[k] = bool(body[k])
    if "tolak_cp" in body:
        flags["tolak_cp"] = [str(x) for x in (body.get("tolak_cp") or [])][:60]
    if "catatan" in body:
        flags["catatan"] = str(body.get("catatan") or "")[:300]
    flags["ditinjau_oleh"] = aktor.get("nama") if aktor else "PIN admin"
    await db[SUBS].update_one({"trip_id": trip_id}, {"$set": {"flags": flags}})
    return {"ok": True, "flags": flags}


async def bayar(db, user_id, key, aktor, now=None):
    """Pemilik: tutup & tandai pekan sudah dibayar (menyimpan salinan nilai). Hanya setelah Minggu 09:00."""
    now = now or _now()
    start = week_from_key(key)
    if now < start + timedelta(days=7):
        raise ValueError("Pekan belum ditutup (batas Minggu 09:00)")
    old = await _paid(db, user_id, start.strftime("%Y-%m-%d"))
    if old:
        return {"ok": True, "sudah": True, "totals": old.get("totals")}
    data = await minggu(db, user_id, start, now)
    if not data["trips"]:
        raise ValueError("Tidak ada trip ter-submit di pekan ini")
    doc = {"user_id": user_id, "week_key": data["key"], "totals": data["totals"], "trips": data["trips"],
           "dibayar_pada": now.isoformat(), "dibayar_oleh": (aktor or {}).get("nama") or "PIN admin"}
    await db[PAYOUTS].insert_one(dict(doc))
    return {"ok": True, "sudah": False, "totals": data["totals"]}


async def ringkasan(db, start, now=None):
    """Semua akun KPI: total per pekan."""
    users = [u for u in await _all(db.app_users.find({"role": ROLE_KPI})) if u.get("status") == "aktif"]
    out = []
    for u in users:
        m = await minggu(db, u.get("user_id"), start, now)
        out.append({"user_id": u.get("user_id"), "nama": u.get("nama") or u.get("email"), "terbayar": m["terbayar"],
                    "totals": m["totals"], "bisa_dibayar": m.get("bisa_dibayar", False)})
    return out


# ───────────── Tugas Saya ─────────────
async def tugas_saya(db, user, today_wib):
    out = []
    for o in await _all(db.orders.find({"status": "NEW"})):
        if not o.get("trip_id"):
            out.append({"jenis": "konversi", "order_id": o.get("order_id"), "customer": o.get("customer_nama") or "",
                        "teks": "Pesanan baru belum dikonversi ke trip"})
    uid = user.get("user_id")
    submitted = {s.get("trip_id") for s in await _all(db[SUBS].find({"user_id": uid}))}
    for t in await _all(db.trips.find({"kpi_owner.user_id": uid})):
        tid = t.get("trip_id")
        if tid in submitted:
            continue
        oid = t.get("source_order_id")
        order = await db.orders.find_one({"order_id": oid}, {"_id": 0}) if oid else None
        status = (order or {}).get("status")
        if status == "CANCELLED":
            continue
        cust = (order or {}).get("customer_nama") or ""
        add = lambda jenis, teks: out.append({"jenis": jenis, "trip_id": tid, "order_id": oid, "customer": cust, "teks": teks})
        legs = t.get("legs") or (order or {}).get("legs") or []
        if not legs:
            add("leg", "Leg belum disetting")
        nama = (t.get("nama_driver") or "").strip()
        drv = None
        if t.get("driver_id"):
            drv = await db.drivers.find_one({"driver_id": t.get("driver_id")}, {"_id": 0})
        if not drv and nama:
            drv = await db.drivers.find_one({"nama": nama}, {"_id": 0})
        if not (nama or t.get("driver_id")):
            add("driver", "Driver belum ditugaskan")
        elif drv:
            kurang = [lbl for k, lbl in (("no_hp", "No. HP"), ("foto_ktp", "foto KTP"), ("foto_sim", "foto SIM")) if not drv.get(k)]
            if kurang:
                add("driver", f"Data driver {drv.get('nama') or nama} belum lengkap: " + ", ".join(kurang))
        elif nama:
            add("driver", f"Driver {nama} belum terdaftar di Data Driver (KTP, SIM, HP)")
        if not (t.get("album") or {}).get("asal"):
            add("foto_asal", "Foto asal belum ada")
        kapal = any(str(l.get("tipe") or "").startswith("Kapal") for l in legs)
        dates = {c.get("date") for c in (t.get("daily_checkpoints") or [])}
        if status == "ON_TRIP" and not kapal and today_wib not in dates:
            add("checkpoint", "Checkpoint hari ini belum ada")
        ev = periksa_trip(t, order, {})
        if ev["siap"]:
            add("submit", "Siap di-submit untuk poin")
    return out
