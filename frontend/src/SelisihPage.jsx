import { useState, useEffect, useRef } from "react";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;

function fRp(n) {
  n = Number(n) || 0;
  return "Rp " + n.toLocaleString("id-ID");
}
function pNum(s) {
  const n = parseInt(String(s || "").replace(/[^0-9]/g, ""), 10);
  return isNaN(n) ? 0 : n;
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fDate(s) {
  if (!s) return "";
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" };
const L = { fontSize: 11, color: "#8b949e", display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN_GHOST = { padding: "9px 16px", borderRadius: 8, border: "1px solid #30363d", background: "none", color: "#c9d1d9", fontWeight: 700, fontSize: 13, cursor: "pointer" };

export default function SelisihPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [selected, setSelected] = useState(null); // full PIC doc w/ tagihan
  const debounceRef = useRef(null);
  const [toast, setToast] = useState("");
  const [listRefreshTick, setListRefreshTick] = useState(0);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/selisih`, { params: { q: query }, headers });
        setDropdown(r.data.items || []);
      } catch { setDropdown([]); }
    }, 300);
  }, [query, listRefreshTick]);

  const reloadSelected = async (id) => {
    try {
      const r = await axios.get(`${API}/admin/selisih/${id}`, { headers });
      setSelected(r.data);
    } catch { flash("Gagal memuat data PIC"); }
  };

  const selectPic = async (s) => {
    setDropdown([]);
    setQuery(s.nama);
    await reloadSelected(s.id);
  };

  const createOrOpenPic = async () => {
    if (!query.trim()) { flash("Masukkan nama PIC dulu"); return; }
    try {
      const r = await axios.post(`${API}/admin/selisih`, { nama: query.trim() }, { headers });
      setQuery(r.data.nama);
      await reloadSelected(r.data.id);
      setListRefreshTick((t) => t + 1);
      flash("PIC tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan PIC"); }
  };

  const deletePic = async () => {
    if (!selected) return;
    if (!window.confirm(`Hapus PIC "${selected.nama}" beserta semua tagihan & riwayat pembayarannya? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await axios.delete(`${API}/admin/selisih/${selected.id}`, { headers });
      setSelected(null);
      setQuery("");
      setListRefreshTick((t) => t + 1);
      flash("PIC dihapus");
    } catch { flash("Gagal hapus PIC"); }
  };

  // ── Tagihan (No Invoice) form ──
  const [tagihanForm, setTagihanForm] = useState({ no_invoice: "", catatan: "" });
  const [tagihanSaving, setTagihanSaving] = useState(false);
  const addTagihan = async () => {
    if (!selected) return;
    if (!tagihanForm.no_invoice.trim()) { flash("No Invoice wajib diisi"); return; }
    setTagihanSaving(true);
    try {
      await axios.post(`${API}/admin/selisih/${selected.id}/tagihan`, {
        no_invoice: tagihanForm.no_invoice.trim(),
        catatan: tagihanForm.catatan.trim(),
      }, { headers });
      setTagihanForm({ no_invoice: "", catatan: "" });
      await reloadSelected(selected.id);
      flash("Tagihan ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah tagihan"); }
    finally { setTagihanSaving(false); }
  };
  const deleteTagihan = async (tagihanId) => {
    if (!window.confirm("Hapus tagihan ini beserta semua unit & riwayat pembayarannya?")) return;
    try {
      await axios.delete(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}`, { headers });
      await reloadSelected(selected.id);
    } catch { flash("Gagal hapus tagihan"); }
  };

  // ── Item (unit/pengiriman) form, per-tagihan ──
  const [itemFormOpen, setItemFormOpen] = useState(null); // tagihan_id lagi buka form tambah unit
  const [itemForm, setItemForm] = useState({ vehicle_type: "", no_unit: "", asal_kota: "", tujuan_kota: "", harga_deal: "", harga_invoice: "" });
  const [itemSaving, setItemSaving] = useState(false);
  const openItemForm = (tagihanId) => { setItemFormOpen(tagihanId); setItemForm({ vehicle_type: "", no_unit: "", asal_kota: "", tujuan_kota: "", harga_deal: "", harga_invoice: "" }); };
  const addItem = async (tagihanId) => {
    const deal = pNum(itemForm.harga_deal);
    const inv = pNum(itemForm.harga_invoice);
    if (deal <= 0 || inv <= 0) { flash("Harga Deal & Harga Invoice wajib diisi"); return; }
    setItemSaving(true);
    try {
      await axios.post(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}/items`, {
        vehicle_type: itemForm.vehicle_type.trim(),
        no_unit: itemForm.no_unit.trim(),
        asal_kota: itemForm.asal_kota.trim(),
        tujuan_kota: itemForm.tujuan_kota.trim(),
        harga_deal: deal,
        harga_invoice: inv,
      }, { headers });
      setItemFormOpen(null);
      await reloadSelected(selected.id);
      flash("Unit ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah unit"); }
    finally { setItemSaving(false); }
  };
  const deleteItem = async (tagihanId, itemId) => {
    if (!window.confirm("Hapus unit ini?")) return;
    try {
      await axios.delete(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}/items/${itemId}`, { headers });
      await reloadSelected(selected.id);
    } catch { flash("Gagal hapus unit"); }
  };

  // ── Tarik unit dari Order (kaya Invoice Gabungan): unit/rute auto, tinggal isi harga ──
  const [tarikOpen, setTarikOpen] = useState(null); // tagihan_id yang lagi buka modal tarik
  const [tarikOrders, setTarikOrders] = useState([]);
  const [tarikQ, setTarikQ] = useState("");
  const [tarikLoading, setTarikLoading] = useState(false);
  const [tarikSel, setTarikSel] = useState({}); // key -> {..., harga_deal, harga_invoice}
  const [tarikSaving, setTarikSaving] = useState(false);
  const [dealPrices, setDealPrices] = useState({}); // order_id -> { price, units }

  const orderUnitsOf = (o) => {
    const arr = (Array.isArray(o.units) && o.units.length) ? o.units
      : [{ unit_id: "legacy", vehicle_type: o.vehicle_type, tipe_model: o.tipe_model, nopol: o.nopol, no_rangka: o.no_rangka }];
    const dp = dealPrices[o.order_id];
    // auto-isi Harga Deal cuma buat PO 1 unit (biar akurat; multi-unit total, dibiarin kosong)
    const suggest = (dp && dp.units === 1 && dp.price > 0) ? String(dp.price) : "";
    return arr.map((u, i) => ({
      key: `${o.order_id}:${u.unit_id || u.nopol || i}`,
      vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan",
      no_unit: (u.nopol || u.no_rangka || "").toUpperCase(),
      nopol: (u.nopol || "").toUpperCase(), no_rangka: (u.no_rangka || "").toUpperCase(),
      asal_kota: o.asal_kota || "", tujuan_kota: o.tujuan_kota || "", customer: o.customer_nama || "",
      suggestDeal: suggest,
    }));
  };

  const openTarik = async (tagihanId) => {
    setTarikOpen(tagihanId); setTarikSel({}); setTarikQ(""); setTarikLoading(true);
    try {
      const [ro, rp] = await Promise.all([
        axios.get(`${API}/admin/orders`, { headers }),
        axios.get(`${API}/admin/deal-prices`, { headers }).catch(() => ({ data: { prices: {} } })),
      ]);
      setTarikOrders(ro.data?.items || []);
      setDealPrices(rp.data?.prices || {});
    } catch { flash("Gagal memuat order"); setTarikOrders([]); }
    finally { setTarikLoading(false); }
  };

  const toggleTarik = (row) => setTarikSel((s) => {
    const n = { ...s };
    if (n[row.key]) delete n[row.key]; else n[row.key] = { ...row, harga_deal: row.suggestDeal || "", harga_invoice: "" };
    return n;
  });
  const setTarikField = (key, field, val) => setTarikSel((s) => ({ ...s, [key]: { ...s[key], [field]: val } }));

  const doTarik = async (tagihanId) => {
    const valid = Object.values(tarikSel).filter((r) => pNum(r.harga_deal) > 0 && pNum(r.harga_invoice) > 0);
    if (!valid.length) { flash("Centang unit & isi Harga Deal + Harga Invoice dulu"); return; }
    setTarikSaving(true);
    try {
      for (const r of valid) {
        await axios.post(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}/items`, {
          vehicle_type: r.vehicle_type, no_unit: r.no_unit,
          asal_kota: r.asal_kota, tujuan_kota: r.tujuan_kota,
          harga_deal: pNum(r.harga_deal), harga_invoice: pNum(r.harga_invoice),
        }, { headers });
      }
      setTarikOpen(null); setTarikSel({});
      await reloadSelected(selected.id);
      flash(`${valid.length} unit ditarik ke tagihan`);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tarik unit"); }
    finally { setTarikSaving(false); }
  };

  const tarikRows = tarikOrders.flatMap(orderUnitsOf).filter((row) => {
    const q = tarikQ.trim().toLowerCase();
    if (!q) return true;
    return `${row.no_unit} ${row.nopol} ${row.no_rangka} ${row.vehicle_type} ${row.asal_kota} ${row.tujuan_kota} ${row.customer}`.toLowerCase().includes(q);
  });

  // ── Payment form (per tagihan) ──
  const [payOpen, setPayOpen] = useState(null); // tagihan_id lagi buka form bayar
  const [payAmount, setPayAmount] = useState("");
  const [payCatatan, setPayCatatan] = useState("");
  const [payTanggal, setPayTanggal] = useState(todayStr());
  const [payFile, setPayFile] = useState(null);
  const [paySaving, setPaySaving] = useState(false);
  const fileRef = useRef();

  const openPay = (tagihanId) => { setPayOpen(tagihanId); setPayAmount(""); setPayCatatan(""); setPayTanggal(todayStr()); setPayFile(null); };

  const submitPay = async (tagihanId) => {
    const amt = pNum(payAmount);
    if (amt <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", amt);
      fd.append("catatan", payCatatan.trim());
      fd.append("tanggal", payTanggal || todayStr());
      if (payFile) fd.append("bukti", payFile);
      await axios.post(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}/payments`, fd, { headers });
      setPayOpen(null);
      await reloadSelected(selected.id);
      flash("Pembayaran tercatat, sisa otomatis dikurangi");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan pembayaran"); }
    finally { setPaySaving(false); }
  };

  const deletePayment = async (tagihanId, paymentId) => {
    if (!window.confirm("Hapus catatan pembayaran ini?")) return;
    try {
      await axios.delete(`${API}/admin/selisih/${selected.id}/tagihan/${tagihanId}/payments/${paymentId}`, { headers });
      await reloadSelected(selected.id);
    } catch { flash("Gagal hapus pembayaran"); }
  };

  const resolveUrl = (u) => {
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return `${BACKEND_URL}${u}`;
  };

  const [ringkasanBusy, setRingkasanBusy] = useState(false);
  const downloadRingkasan = async () => {
    if (!selected) return;
    setRingkasanBusy(true);
    try {
      const r = await axios.get(`${API}/admin/selisih/${selected.id}/ringkasan/pdf`, { headers, responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ringkasan-Selisih-${selected.nama.replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("Ringkasan PDF A4 diunduh — siap dikirim / dicetak");
    } catch (e) { flash("Gagal buat ringkasan, coba lagi"); }
    finally { setRingkasanBusy(false); }
  };

  return (
    <div style={{ maxWidth: 900, margin: "12px auto 0", padding: "0 16px 40px" }}>
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>📊 Selisih Harga</div>
        <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 14 }}>
          Buat harga yang di-upping pas invoice ke pelanggan — selisih antara Harga Deal dan Harga Invoice
          punya PIC purchasing, dicatat &amp; ditransfer per Tagihan (No Invoice), bisa dicicil.
        </div>

        <label style={L}>Cari / Buat PIC Purchasing</label>
        <div style={{ position: "relative" }}>
          <input
            style={I}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Ketik nama PIC untuk mencari atau membuat baru..."
            data-testid="sel-search"
          />
          {!selected && dropdown.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 240, overflowY: "auto" }}>
              {dropdown.map((s) => (
                <div key={s.id} onClick={() => selectPic(s)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #21262d", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 10 }} data-testid={`sel-option-${s.id}`}>
                  <span style={{ fontWeight: 700 }}>{s.nama}</span>
                  <span style={{ color: "#8b949e", fontSize: 11 }}>{s.jumlah_tagihan || 0} tagihan · sisa {fRp(s.grand_sisa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && query.trim() && (
          <button style={{ ...BTN, marginTop: 10 }} onClick={createOrOpenPic} data-testid="sel-create">
            + Buat/Buka "{query.trim()}"
          </button>
        )}
      </div>

      {selected && (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{selected.nama}</div>
              <div style={{ fontSize: 11, color: "#8b949e" }}>PIC Purchasing {selected.no_hp && `· ${selected.no_hp}`}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={downloadRingkasan} disabled={ringkasanBusy} data-testid="sel-ringkasan-download">
                  {ringkasanBusy ? "⏳ Membuat..." : "📄 Download Ringkasan"}
                </button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#f85149", borderColor: "#f85149" }} onClick={deletePic} data-testid="sel-delete">
                  🗑 Hapus PIC
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, textAlign: "right" }}>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Total Selisih</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{fRp(selected.grand_total_selisih)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Terbayar</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "#3fb950" }}>{fRp(selected.grand_total_terbayar)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Sisa</div>
                <div style={{ fontWeight: 900, fontSize: 14, color: selected.grand_sisa > 0 ? "#f85149" : "#3fb950" }}>{fRp(selected.grand_sisa)}</div>
              </div>
            </div>
          </div>

          {/* Form tambah tagihan baru */}
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: "#EF9F27" }}>+ Tagihan Baru (No Invoice)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={I} placeholder="No. Invoice" value={tagihanForm.no_invoice} onChange={(e) => setTagihanForm((f) => ({ ...f, no_invoice: e.target.value }))} data-testid="sel-tagihan-noinv" />
              <input style={I} placeholder="Catatan (opsional)" value={tagihanForm.catatan} onChange={(e) => setTagihanForm((f) => ({ ...f, catatan: e.target.value }))} />
            </div>
            <button style={BTN} onClick={addTagihan} disabled={tagihanSaving} data-testid="sel-tagihan-save">
              {tagihanSaving ? "Menyimpan..." : "Simpan Tagihan"}
            </button>
          </div>

          {/* Daftar tagihan */}
          {(selected.tagihan || []).length === 0 && (
            <div style={{ textAlign: "center", padding: 20, color: "#8b949e", fontSize: 13 }}>Belum ada tagihan buat PIC ini.</div>
          )}
          {(selected.tagihan || []).map((tg) => (
            <div key={tg.id} style={{ border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 14 }} data-testid={`sel-tagihan-${tg.id}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>🧾 {tg.no_invoice || "(tanpa nomor)"}</span>
                  {tg.lunas ? (
                    <span style={{ background: "#0d2818", color: "#3fb950", borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 800 }}>✓ Lunas</span>
                  ) : (
                    <span style={{ background: "#2d1a1a", color: "#f85149", borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 800 }}>Belum Lunas</span>
                  )}
                  {tg.catatan && <span style={{ fontSize: 11, color: "#8b949e" }}>{tg.catatan}</span>}
                </div>
                <button onClick={() => deleteTagihan(tg.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11 }}>Hapus Tagihan</button>
              </div>

              {/* Tabel unit/item */}
              {(tg.items || []).length > 0 && (
                <div style={{ overflowX: "auto", marginBottom: 8 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ color: "#8b949e", textAlign: "left" }}>
                        <th style={{ padding: "4px 6px", fontWeight: 700 }}>Unit</th>
                        <th style={{ padding: "4px 6px", fontWeight: 700 }}>Asal → Tujuan</th>
                        <th style={{ padding: "4px 6px", fontWeight: 700, textAlign: "right" }}>Harga Deal</th>
                        <th style={{ padding: "4px 6px", fontWeight: 700, textAlign: "right" }}>Harga Invoice</th>
                        <th style={{ padding: "4px 6px", fontWeight: 700, textAlign: "right" }}>Selisih</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tg.items.map((it) => (
                        <tr key={it.id} style={{ borderTop: "1px solid #21262d" }} data-testid={`sel-item-${it.id}`}>
                          <td style={{ padding: "6px" }}>{it.vehicle_type || "—"}{it.no_unit && <div style={{ color: "#8b949e", fontSize: 11 }}>{it.no_unit}</div>}</td>
                          <td style={{ padding: "6px" }}>{it.asal_kota || "—"} &rarr; {it.tujuan_kota || "—"}</td>
                          <td style={{ padding: "6px", textAlign: "right" }}>{fRp(it.harga_deal)}</td>
                          <td style={{ padding: "6px", textAlign: "right" }}>{fRp(it.harga_invoice)}</td>
                          <td style={{ padding: "6px", textAlign: "right", fontWeight: 800, color: "#EF9F27" }}>{fRp(it.selisih)}</td>
                          <td style={{ padding: "6px", textAlign: "right" }}>
                            <button onClick={() => deleteItem(tg.id, it.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Form tambah unit ke tagihan ini */}
              {itemFormOpen === tg.id ? (
                <div style={{ background: "#0d1117", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <input style={I} placeholder="Tipe kendaraan" value={itemForm.vehicle_type} onChange={(e) => setItemForm((f) => ({ ...f, vehicle_type: e.target.value }))} data-testid={`sel-item-vehicle-${tg.id}`} />
                    <input style={I} placeholder="No. Pol / No. Rangka" value={itemForm.no_unit} onChange={(e) => setItemForm((f) => ({ ...f, no_unit: e.target.value.toUpperCase() }))} data-testid={`sel-item-nounit-${tg.id}`} />
                    <input style={I} placeholder="Kota asal" value={itemForm.asal_kota} onChange={(e) => setItemForm((f) => ({ ...f, asal_kota: e.target.value }))} />
                    <input style={I} placeholder="Kota tujuan" value={itemForm.tujuan_kota} onChange={(e) => setItemForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
                    <input style={I} inputMode="numeric" placeholder="Harga Deal (Rp)" value={itemForm.harga_deal} onChange={(e) => setItemForm((f) => ({ ...f, harga_deal: e.target.value }))} data-testid={`sel-item-deal-${tg.id}`} />
                    <input style={I} inputMode="numeric" placeholder="Harga Invoice (Rp)" value={itemForm.harga_invoice} onChange={(e) => setItemForm((f) => ({ ...f, harga_invoice: e.target.value }))} data-testid={`sel-item-invoice-${tg.id}`} />
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button style={BTN} onClick={() => addItem(tg.id)} disabled={itemSaving} data-testid={`sel-item-save-${tg.id}`}>
                      {itemSaving ? "Menyimpan..." : "Simpan Unit"}
                    </button>
                    <button style={BTN_GHOST} onClick={() => setItemFormOpen(null)}>Batal</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <button style={{ ...BTN_GHOST, fontSize: 12, padding: "6px 12px" }} onClick={() => openItemForm(tg.id)} data-testid={`sel-item-open-${tg.id}`}>+ Tambah Unit</button>
                  <button style={{ ...BTN, fontSize: 12, padding: "6px 12px" }} onClick={() => openTarik(tg.id)} data-testid={`sel-tarik-open-${tg.id}`}>📥 Tarik dari Order</button>
                </div>
              )}

              {/* Totals row */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 16, fontSize: 12, padding: "6px 0", borderTop: "1px solid #21262d" }}>
                <span style={{ color: "#8b949e" }}>Selisih: <b style={{ color: "#e6edf3" }}>{fRp(tg.total_selisih)}</b></span>
                <span style={{ color: "#3fb950" }}>Terbayar: <b>{fRp(tg.total_terbayar)}</b></span>
                <span style={{ color: tg.sisa > 0 ? "#f85149" : "#3fb950", fontWeight: 900 }}>Sisa: {fRp(tg.sisa)}</span>
              </div>

              {/* Riwayat pembayaran */}
              {(tg.payments || []).length > 0 && (
                <div style={{ marginTop: 8, borderTop: "1px solid #21262d", paddingTop: 8 }}>
                  {tg.payments.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", color: "#c9d1d9" }}>
                      <span>
                        <span style={{ color: "#8b949e" }}>{fDate(p.tanggal)}</span> — {fRp(p.amount)} {p.catatan && <span style={{ color: "#8b949e" }}>— {p.catatan}</span>}
                        {p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "#58a6ff" }}>📎 bukti</a>}
                      </span>
                      <button onClick={() => deletePayment(tg.id, p.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {payOpen === tg.id ? (
                  <div style={{ width: "100%", background: "#0d1117", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <input style={{ ...I, flex: 1, minWidth: 120 }} inputMode="numeric" placeholder="Jumlah bayar (Rp)" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus data-testid={`sel-pay-amount-${tg.id}`} />
                      <input style={{ ...I, flex: 1, minWidth: 120 }} placeholder="Catatan" value={payCatatan} onChange={(e) => setPayCatatan(e.target.value)} />
                      <input type="date" style={{ ...I, flex: 1, minWidth: 140 }} value={payTanggal} onChange={(e) => setPayTanggal(e.target.value)} data-testid={`sel-pay-date-${tg.id}`} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayFile(e.target.files?.[0] || null)} />
                      <button style={BTN_GHOST} onClick={() => fileRef.current?.click()}>
                        {payFile ? `📎 ${payFile.name.slice(0, 20)}` : "📎 Upload Bukti Transfer"}
                      </button>
                      <button style={BTN} onClick={() => submitPay(tg.id)} disabled={paySaving} data-testid={`sel-pay-save-${tg.id}`}>
                        {paySaving ? "Menyimpan..." : "Simpan Pembayaran"}
                      </button>
                      <button style={BTN_GHOST} onClick={() => setPayOpen(null)}>Batal</button>
                    </div>
                  </div>
                ) : (
                  <button style={BTN} onClick={() => openPay(tg.id)} data-testid={`sel-pay-open-${tg.id}`}>+ Catat Bayar</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tarikOpen && (
        <div onClick={() => setTarikOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", background: "#0d1117", border: "1px solid #30363d", borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>📥 Tarik Unit dari Order</div>
              <button onClick={() => setTarikOpen(null)} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 10 }}>Centang unit, isi Harga Deal &amp; Harga Invoice. Unit &amp; rute otomatis dari order.</div>
            <input style={I} placeholder="🔎 cari nopol / no rangka / customer / asal / tujuan…" value={tarikQ} onChange={(e) => setTarikQ(e.target.value)} />
            {tarikLoading ? <div style={{ padding: 20, textAlign: "center", color: "#8b949e" }}>Memuat…</div> : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: "46vh", overflowY: "auto" }}>
                {tarikRows.map((row) => {
                  const on = !!tarikSel[row.key];
                  return (
                    <div key={row.key} style={{ border: `1px solid ${on ? "#EF9F27" : "#21262d"}`, borderRadius: 8, padding: 10, background: on ? "#1a1408" : "#161b22" }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => toggleTarik(row)} style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{row.no_unit || "(tanpa nopol)"} · {row.vehicle_type}</div>
                          <div style={{ fontSize: 11, color: "#8b949e" }}>{row.asal_kota} → {row.tujuan_kota}{row.customer ? ` · ${row.customer}` : ""}</div>
                        </div>
                      </label>
                      {on && (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <input style={{ ...I, flex: 1 }} inputMode="numeric" placeholder="Harga Deal (Rp)" value={tarikSel[row.key].harga_deal} onChange={(e) => setTarikField(row.key, "harga_deal", e.target.value)} />
                          <input style={{ ...I, flex: 1 }} inputMode="numeric" placeholder="Harga Invoice (Rp)" value={tarikSel[row.key].harga_invoice} onChange={(e) => setTarikField(row.key, "harga_invoice", e.target.value)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {tarikRows.length === 0 && <div style={{ padding: 16, textAlign: "center", color: "#8b949e", fontSize: 12 }}>Tidak ada order.</div>}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button style={BTN_GHOST} onClick={() => setTarikOpen(null)}>Batal</button>
              <button style={BTN} onClick={() => doTarik(tarikOpen)} disabled={tarikSaving} data-testid="sel-tarik-save">
                {tarikSaving ? "Menarik…" : `Tarik ${Object.keys(tarikSel).length} Unit`}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1a2233", border: "1px solid #EF9F27", color: "#EF9F27", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
