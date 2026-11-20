"""Duplikat PO untuk pelanggan lain (mis. 1 pengiriman ditagih ke 2 PT dengan harga berbeda).
Fungsi murni: membentuk PO salinan dari PO asal. Salinan hanya untuk PENAGIHAN/pencatatan di Admin PO:
tanpa trip, tanpa driver, tanpa WhatsApp, status unit direset. PO asal tidak diubah."""

SALIN_PO = (
    "km", "kondisi", "panjang", "lebar", "tinggi", "isi_kiriman", "jumlah_colly",
    "asal_kota", "asal_alamat", "pickup_date", "pickup_time", "pickup_pic", "pickup_hp",
    "tujuan_kota", "tujuan_alamat", "delivery_pic", "delivery_hp",
    "customer_hp", "customer_email", "entity_id",
)
SALIN_UNIT = ("vehicle_type", "tipe_model", "nopol", "no_rangka", "no_mesin", "warna", "tahun", "tujuan", "nama_kapal", "etd", "transit_hari")


def _rapi(v):
    return " ".join(str(v if v is not None else "").split())


def kelompokkan(items):
    """[{order_id, unit_id}] -> {order_id: [unit_id,...]} (urutan terjaga, tanpa kembar). unit_id kosong = semua unit PO itu."""
    out = {}
    for i in items or []:
        if not isinstance(i, dict) or not i.get("order_id"):
            continue
        oid = str(i["order_id"])
        lst = out.setdefault(oid, [])
        uid = str(i.get("unit_id") or "")
        if uid and uid not in lst:
            lst.append(uid)
    return out


def bangun_salinan(order, unit_ids, customer_nama, order_id_baru, unit_id_baru, now, status_default, status_invoice):
    """-> dokumen order baru. unit_ids kosong = semua unit. unit_id_baru: fungsi pembuat id unit."""
    asal_units = [u for u in (order.get("units") or []) if isinstance(u, dict)]
    if not asal_units:   # PO lama tanpa units[]: bentuk 1 unit dari field kendaraan legacy
        asal_units = [{k: order.get(k, "") for k in SALIN_UNIT}]
    pilih = [u for u in asal_units if (not unit_ids) or u.get("unit_id") in unit_ids]
    units = []
    for u in pilih:
        n = {k: u.get(k, "" if k != "transit_hari" else 0) for k in SALIN_UNIT}
        n.update({"unit_id": unit_id_baru(), "catatan": "", "status_perjalanan": status_default, "status_invoice": status_invoice, "created_at": now, "updated_at": now})
        units.append(n)
    if not units:
        return None
    doc = {k: order.get(k, "") for k in SALIN_UNIT[:6]}   # mirror unit pertama ke field legacy (surat jalan / invoice)
    doc["vehicle_type"], doc["nopol"], doc["no_rangka"] = units[0]["vehicle_type"], units[0]["nopol"], units[0]["no_rangka"]
    doc["warna"], doc["tahun"] = units[0]["warna"], units[0]["tahun"]
    for k in SALIN_PO:
        doc[k] = order.get(k, "")
    doc.update({
        "order_id": order_id_baru, "status": "NEW", "units": units, "jumlah_unit": len(units),
        "customer_nama": _rapi(customer_nama)[:120],
        "catatan": f"Duplikat dari {order.get('order_id')} ({_rapi(order.get('customer_nama'))}) untuk penagihan terpisah"[:500],
        "duplikat_dari": order.get("order_id"),
        "trip_id": None, "wa_status": "dilewati_duplikat", "wa_to": "", "wa_attempts": 0,
        "created_at": now, "updated_at": now,
    })
    return doc
