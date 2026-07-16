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

export default function KompensasiPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [selected, setSelected] = useState(null); // full rekanan doc w/ items
  const debounceRef = useRef(null);
  const [toast, setToast] = useState("");
  const [listRefreshTick, setListRefreshTick] = useState(0);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/kompensasi`, { params: { q: query }, headers });
        setDropdown(r.data.items || []);
      } catch { setDropdown([]); }
    }, 300);
    // eslint-disable-next-line
  }, [query, listRefreshTick]);

  const reloadSelected = async (id) => {
    try {
      const r = await axios.get(`${API}/admin/kompensasi/${id}`, { headers });
      setSelected(r.data);
    } catch { flash("Gagal memuat data rekanan"); }
  };

  const selectRekanan = async (s) => {
    setDropdown([]);
    setQuery(s.nama);
    await reloadSelected(s.id);
  };

  const createOrOpenRekanan = async () => {
    if (!query.trim()) { flash("Masukkan nama supplier dulu"); return; }
    try {
      const r = await axios.post(`${API}/admin/kompensasi`, { nama: query.trim() }, { headers });
      setQuery(r.data.nama);
      await reloadSelected(r.data.id);
      setListRefreshTick((t) => t + 1);
      flash("Supplier tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan supplier"); }
  };

  const deleteRekanan = async () => {
    if (!selected) return;
    if (!window.confirm(`Hapus supplier "${selected.nama}" beserta semua rincian kompensasinya? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await axios.delete(`${API}/admin/kompensasi/${selected.id}`, { headers });
      setSelected(null);
      setQuery("");
      setListRefreshTick((t) => t + 1);
      flash("Supplier dihapus");
    } catch { flash("Gagal hapus supplier"); }
  };

  // ── Form tambah item (rincian kompensasi, 2 arah) ──
  const blankItemForm = { arah: "kita_ke_mereka", tanggal: todayStr(), keterangan: "", vehicle_type: "", no_unit: "", asal_kota: "", tujuan_kota: "", nilai: "", catatan: "" };
  const [itemForm, setItemForm] = useState(blankItemForm);
  const [itemFile, setItemFile] = useState(null);
  const [itemSaving, setItemSaving] = useState(false);
  const fileRef = useRef();

  const addItem = async () => {
    if (!selected) return;
    const nilai = pNum(itemForm.nilai);
    if (nilai <= 0) { flash("Nilai wajib diisi"); return; }
    setItemSaving(true);
    try {
      const fd = new FormData();
      fd.append("arah", itemForm.arah);
      fd.append("tanggal", itemForm.tanggal || todayStr());
      fd.append("keterangan", itemForm.keterangan.trim());
      fd.append("vehicle_type", itemForm.vehicle_type.trim());
      fd.append("no_unit", itemForm.no_unit.trim());
      fd.append("asal_kota", itemForm.asal_kota.trim());
      fd.append("tujuan_kota", itemForm.tujuan_kota.trim());
      fd.append("nilai", nilai);
      fd.append("catatan", itemForm.catatan.trim());
      if (itemFile) fd.append("bukti", itemFile);
      await axios.post(`${API}/admin/kompensasi/${selected.id}/items`, fd, { headers });
      setItemForm({ ...blankItemForm, arah: itemForm.arah });
      setItemFile(null);
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash("Rincian kompensasi ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah rincian"); }
    finally { setItemSaving(false); }
  };

  const deleteItem = async (itemId) => {
    if (!window.confirm("Hapus rincian kompensasi ini?")) return;
    try {
      const r = await axios.delete(`${API}/admin/kompensasi/${selected.id}/items/${itemId}`, { headers });
      setSelected(r.data);
      setListRefreshTick((t) => t + 1);
    } catch { flash("Gagal hapus rincian"); }
  };

  // ── Form catat pembayaran (transfer nyata yang mengurangi sisa) ──
  const blankPayForm = { arah: "kita_bayar_mereka", jumlah: "", tanggal: todayStr(), catatan: "" };
  const [payForm, setPayForm] = useState(blankPayForm);
  const [payFile, setPayFile] = useState(null);
  const [paySaving, setPaySaving] = useState(false);
  const payFileRef = useRef();

  const addPayment = async () => {
    if (!selected) return;
    const jumlah = pNum(payForm.jumlah);
    if (jumlah <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("arah", payForm.arah);
      fd.append("jumlah", jumlah);
      fd.append("tanggal", payForm.tanggal || todayStr());
      fd.append("catatan", payForm.catatan.trim());
      if (payFile) fd.append("bukti", payFile);
      const r = await axios.post(`${API}/admin/kompensasi/${selected.id}/payments`, fd, { headers });
      setSelected(r.data);
      setPayForm({ ...blankPayForm, arah: payForm.arah });
      setPayFile(null);
      setListRefreshTick((t) => t + 1);
      flash("Pembayaran tercatat, sisa otomatis dikurangi");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan pembayaran"); }
    finally { setPaySaving(false); }
  };

  const deletePayment = async (paymentId) => {
    if (!window.confirm("Hapus catatan pembayaran ini?")) return;
    try {
      const r = await axios.delete(`${API}/admin/kompensasi/${selected.id}/payments/${paymentId}`, { headers });
      setSelected(r.data);
      setListRefreshTick((t) => t + 1);
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
      const r = await axios.get(`${API}/admin/kompensasi/${selected.id}/ringkasan/image`, { headers, responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ringkasan-Kompensasi-${selected.nama.replace(/[^a-z0-9]+/gi, "-")}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("Ringkasan diunduh — siap dikirim ke WhatsApp");
    } catch (e) { flash("Gagal buat ringkasan, coba lagi"); }
    finally { setRingkasanBusy(false); }
  };

  const itemsKita = (selected?.items || []).filter((i) => i.arah === "kita_ke_mereka");
  const itemsMereka = (selected?.items || []).filter((i) => i.arah === "mereka_ke_kita");

  const renderItemRow = (it) => (
    <div key={it.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 12, padding: "8px 0", borderTop: "1px solid #21262d" }} data-testid={`komp-item-${it.id}`}>
      <div>
        <div style={{ color: "#e6edf3", fontWeight: 700 }}>
          {it.keterangan || (it.vehicle_type ? it.vehicle_type : "Rincian kompensasi")}
          {it.no_unit && <span style={{ color: "#8b949e", fontWeight: 400 }}> · {it.no_unit}</span>}
        </div>
        <div style={{ color: "#8b949e", fontSize: 11, marginTop: 2 }}>
          {fDate(it.tanggal)}
          {(it.asal_kota || it.tujuan_kota) && ` · ${it.asal_kota || "?"} → ${it.tujuan_kota || "?"}`}
          {it.catatan && ` · ${it.catatan}`}
          {it.bukti_url && <a href={resolveUrl(it.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "#58a6ff" }}>📎 bukti</a>}
        </div>
      </div>
      <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
        <div style={{ fontWeight: 800, color: "#EF9F27" }}>{fRp(it.nilai)}</div>
        <button onClick={() => deleteItem(it.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11, marginTop: 2 }}>Hapus</button>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: "12px auto 0", padding: "0 16px 40px" }}>
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>🔄 Kompensasi Hutang Piutang</div>
        <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 14 }}>
          Buat supplier yang saling kirim unit/invoice (2 arah) — catat rincian kewajiban Alyssa Logistik ke supplier,
          dan rincian kewajiban supplier ke Alyssa Logistik, sisa kewajiban dihitung otomatis dari selisihnya.
        </div>

        <label style={L}>Cari / Buat Supplier</label>
        <div style={{ position: "relative" }}>
          <input
            style={I}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Ketik nama supplier (PT/perusahaan) untuk mencari atau membuat baru..."
            data-testid="komp-search"
          />
          {!selected && dropdown.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 240, overflowY: "auto" }}>
              {dropdown.map((s) => (
                <div key={s.id} onClick={() => selectRekanan(s)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #21262d", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 10 }} data-testid={`komp-option-${s.id}`}>
                  <span style={{ fontWeight: 700 }}>{s.nama}</span>
                  <span style={{ color: "#8b949e", fontSize: 11 }}>{s.jumlah_item || 0} rincian · sisa {fRp(s.sisa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && query.trim() && (
          <button style={{ ...BTN, marginTop: 10 }} onClick={createOrOpenRekanan} data-testid="komp-create">
            + Buat/Buka "{query.trim()}"
          </button>
        )}
      </div>

      {selected && (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{selected.nama}</div>
              <div style={{ fontSize: 11, color: "#8b949e" }}>Supplier {selected.no_hp && `· ${selected.no_hp}`}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={downloadRingkasan} disabled={ringkasanBusy} data-testid="komp-ringkasan-download">
                  {ringkasanBusy ? "⏳ Membuat..." : "📄 Download Ringkasan Terperinci"}
                </button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#f85149", borderColor: "#f85149" }} onClick={deleteRekanan} data-testid="komp-delete">
                  🗑 Hapus Supplier
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, textAlign: "right", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Kewajiban Alyssa Logistik</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{fRp(selected.total_kita)}</div>
                {selected.dibayar_kita > 0 && <div style={{ fontSize: 9, color: "#3fb950" }}>dibayar {fRp(selected.dibayar_kita)}</div>}
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Kewajiban Supplier</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{fRp(selected.total_mereka)}</div>
                {selected.dibayar_mereka > 0 && <div style={{ fontSize: 9, color: "#3fb950" }}>dibayar {fRp(selected.dibayar_mereka)}</div>}
              </div>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Sisa Kewajiban</div>
                <div style={{ fontWeight: 900, fontSize: 14, color: selected.sisa >= 0 ? "#3fb950" : "#f85149" }}>
                  {fRp(Math.abs(selected.sisa))}
                  <div style={{ fontSize: 9, fontWeight: 600, color: "#8b949e" }}>{selected.sisa >= 0 ? "supplier → Alyssa Logistik" : "Alyssa Logistik → supplier"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Form catat pembayaran */}
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: "#3fb950" }}>💰 Catat Pembayaran (transfer nyata, mengurangi sisa)</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button type="button" onClick={() => setPayForm((f) => ({ ...f, arah: "kita_bayar_mereka" }))}
                style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                  border: payForm.arah === "kita_bayar_mereka" ? "2px solid #EF9F27" : "1px solid #30363d",
                  background: payForm.arah === "kita_bayar_mereka" ? "#2a1f0d" : "none", color: payForm.arah === "kita_bayar_mereka" ? "#EF9F27" : "#8b949e" }}
                data-testid="komp-pay-arah-kita">
                💸 Kita Bayar ke {selected.nama}
              </button>
              <button type="button" onClick={() => setPayForm((f) => ({ ...f, arah: "mereka_bayar_kita" }))}
                style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                  border: payForm.arah === "mereka_bayar_kita" ? "2px solid #58a6ff" : "1px solid #30363d",
                  background: payForm.arah === "mereka_bayar_kita" ? "#0d1b2a" : "none", color: payForm.arah === "mereka_bayar_kita" ? "#58a6ff" : "#8b949e" }}
                data-testid="komp-pay-arah-mereka">
                💰 {selected.nama} Bayar ke Kita
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={I} inputMode="numeric" placeholder="Jumlah bayar (Rp)" value={payForm.jumlah} onChange={(e) => setPayForm((f) => ({ ...f, jumlah: e.target.value }))} data-testid="komp-pay-jumlah" />
              <input type="date" style={I} value={payForm.tanggal} onChange={(e) => setPayForm((f) => ({ ...f, tanggal: e.target.value }))} />
              <input style={{ ...I, gridColumn: "1 / span 2" }} placeholder="Catatan (opsional, misal no. referensi transfer)" value={payForm.catatan} onChange={(e) => setPayForm((f) => ({ ...f, catatan: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={payFileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayFile(e.target.files?.[0] || null)} />
              <button style={BTN_GHOST} onClick={() => payFileRef.current?.click()}>
                {payFile ? `📎 ${payFile.name.slice(0, 20)}` : "📎 Upload Bukti Transfer"}
              </button>
              <button style={{ ...BTN, background: "#3fb950", color: "#04240d" }} onClick={addPayment} disabled={paySaving} data-testid="komp-pay-save">
                {paySaving ? "Menyimpan..." : "Simpan Pembayaran"}
              </button>
            </div>

            {(selected.payments || []).length > 0 && (
              <div style={{ marginTop: 14, borderTop: "1px solid #21262d", paddingTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#8b949e", marginBottom: 6, textTransform: "uppercase" }}>Riwayat Pembayaran</div>
                {[...(selected.payments || [])].reverse().map((p) => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, fontSize: 12, padding: "7px 0", borderTop: "1px solid #21262d" }} data-testid={`komp-payment-${p.id}`}>
                    <div>
                      <div style={{ color: "#e6edf3", fontWeight: 700 }}>
                        {p.arah === "kita_bayar_mereka" ? `💸 Kita → ${selected.nama}` : `💰 ${selected.nama} → Kita`}
                      </div>
                      <div style={{ color: "#8b949e", fontSize: 11, marginTop: 2 }}>
                        {fDate(p.tanggal)}
                        {p.catatan && ` · ${p.catatan}`}
                        {p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 6, color: "#58a6ff" }}>📎 bukti</a>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <div style={{ fontWeight: 800, color: "#3fb950" }}>{fRp(p.jumlah)}</div>
                      <button onClick={() => deletePayment(p.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11, marginTop: 2 }}>Hapus</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form tambah rincian kompensasi */}
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: "#EF9F27" }}>+ Tambah Rincian Kompensasi</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <button type="button" onClick={() => setItemForm((f) => ({ ...f, arah: "kita_ke_mereka" }))}
                style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                  border: itemForm.arah === "kita_ke_mereka" ? "2px solid #EF9F27" : "1px solid #30363d",
                  background: itemForm.arah === "kita_ke_mereka" ? "#2a1f0d" : "none", color: itemForm.arah === "kita_ke_mereka" ? "#EF9F27" : "#8b949e" }}
                data-testid="komp-arah-kita">
                📤 Alyssa Logistik → Supplier
              </button>
              <button type="button" onClick={() => setItemForm((f) => ({ ...f, arah: "mereka_ke_kita" }))}
                style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                  border: itemForm.arah === "mereka_ke_kita" ? "2px solid #58a6ff" : "1px solid #30363d",
                  background: itemForm.arah === "mereka_ke_kita" ? "#0d1b2a" : "none", color: itemForm.arah === "mereka_ke_kita" ? "#58a6ff" : "#8b949e" }}
                data-testid="komp-arah-mereka">
                📥 Supplier → Alyssa Logistik
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={I} placeholder="Keterangan / No. Invoice" value={itemForm.keterangan} onChange={(e) => setItemForm((f) => ({ ...f, keterangan: e.target.value }))} data-testid="komp-item-keterangan" />
              <input type="date" style={I} value={itemForm.tanggal} onChange={(e) => setItemForm((f) => ({ ...f, tanggal: e.target.value }))} data-testid="komp-item-tanggal" />
              <input style={I} placeholder="Tipe kendaraan (opsional)" value={itemForm.vehicle_type} onChange={(e) => setItemForm((f) => ({ ...f, vehicle_type: e.target.value }))} />
              <input style={I} placeholder="No. Pol / No. Rangka (opsional)" value={itemForm.no_unit} onChange={(e) => setItemForm((f) => ({ ...f, no_unit: e.target.value.toUpperCase() }))} />
              <input style={I} placeholder="Kota asal (opsional)" value={itemForm.asal_kota} onChange={(e) => setItemForm((f) => ({ ...f, asal_kota: e.target.value }))} />
              <input style={I} placeholder="Kota tujuan (opsional)" value={itemForm.tujuan_kota} onChange={(e) => setItemForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
              <input style={I} inputMode="numeric" placeholder="Nilai kompensasi (Rp)" value={itemForm.nilai} onChange={(e) => setItemForm((f) => ({ ...f, nilai: e.target.value }))} data-testid="komp-item-nilai" />
              <input style={I} placeholder="Catatan (opsional)" value={itemForm.catatan} onChange={(e) => setItemForm((f) => ({ ...f, catatan: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setItemFile(e.target.files?.[0] || null)} />
              <button style={BTN_GHOST} onClick={() => fileRef.current?.click()}>
                {itemFile ? `📎 ${itemFile.name.slice(0, 20)}` : "📎 Upload Bukti (opsional)"}
              </button>
              <button style={BTN} onClick={addItem} disabled={itemSaving} data-testid="komp-item-save">
                {itemSaving ? "Menyimpan..." : "Simpan Rincian"}
              </button>
            </div>
          </div>

          {/* Dua daftar rincian, per arah */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#EF9F27", marginBottom: 4 }}>📤 Kewajiban Alyssa Logistik → {selected.nama}</div>
              {itemsKita.length === 0 && <div style={{ fontSize: 12, color: "#8b949e", padding: "8px 0" }}>Belum ada rincian.</div>}
              {itemsKita.map(renderItemRow)}
              {itemsKita.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "2px solid #21262d", fontWeight: 800, fontSize: 12 }}>
                  <span>Total</span><span>{fRp(selected.total_kita)}</span>
                </div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 12, color: "#58a6ff", marginBottom: 4 }}>📥 Kewajiban {selected.nama} → Alyssa Logistik</div>
              {itemsMereka.length === 0 && <div style={{ fontSize: 12, color: "#8b949e", padding: "8px 0" }}>Belum ada rincian.</div>}
              {itemsMereka.map(renderItemRow)}
              {itemsMereka.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "2px solid #21262d", fontWeight: 800, fontSize: 12 }}>
                  <span>Total</span><span>{fRp(selected.total_mereka)}</span>
                </div>
              )}
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
