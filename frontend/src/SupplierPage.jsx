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
  const [y, m, d] = String(s).slice(0, 10).split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

const I = { background: "#1c2128", border: "1px solid #30363d", borderRadius: 8, padding: "9px 12px", color: "#e6edf3", fontSize: 13, outline: "none", width: "100%", fontFamily: "inherit" };
const L = { fontSize: 11, color: "#8b949e", display: "block", marginBottom: 4, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px" };
const BTN = { padding: "9px 16px", borderRadius: 8, border: "none", background: "#EF9F27", color: "#1a1208", fontWeight: 800, fontSize: 13, cursor: "pointer" };
const BTN_GHOST = { padding: "9px 16px", borderRadius: 8, border: "1px solid #30363d", background: "none", color: "#c9d1d9", fontWeight: 700, fontSize: 13, cursor: "pointer" };

export default function SupplierPage() {
  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";
  const headers = { "x-admin-pin": adminPin };

  const [query, setQuery] = useState("");
  const [dropdown, setDropdown] = useState([]);
  const [selected, setSelected] = useState(null); // full supplier doc w/ jobs
  const debounceRef = useRef(null);
  const [toast, setToast] = useState("");
  const [listRefreshTick, setListRefreshTick] = useState(0);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 1) { setDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await axios.get(`${API}/admin/suppliers`, { params: { q: query }, headers });
        setDropdown(r.data.items || []);
      } catch { setDropdown([]); }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line
  }, [query, listRefreshTick]);

  const reloadSelected = async (id) => {
    try {
      const r = await axios.get(`${API}/admin/suppliers/${id}`, { headers });
      setSelected(r.data);
    } catch { flash("Gagal memuat data supplier"); }
  };

  const selectSupplier = async (s) => {
    setDropdown([]);
    setQuery(s.nama);
    await reloadSelected(s.id);
  };

  const createOrOpenSupplier = async () => {
    if (!query.trim()) { flash("Masukkan nama supplier dulu"); return; }
    try {
      const r = await axios.post(`${API}/admin/suppliers`, { nama: query.trim() }, { headers });
      setQuery(r.data.nama);
      await reloadSelected(r.data.id);
      setListRefreshTick((t) => t + 1);
      flash("Supplier tersimpan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan supplier"); }
  };

  // ── Job (unit) form ──
  const blankJobForm = { vehicle_type: "", nopol: "", no_rangka: "", asal_kota: "", tujuan_kota: "", total_harga: "", catatan: "", tanggal: todayStr() };
  const [jobForm, setJobForm] = useState(blankJobForm);
  const [jobSaving, setJobSaving] = useState(false);
  const addJob = async () => {
    if (!selected) return;
    const harga = pNum(jobForm.total_harga);
    if (harga <= 0) { flash("Total harga wajib diisi"); return; }
    setJobSaving(true);
    try {
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
        vehicle_type: jobForm.vehicle_type.trim(),
        nopol: jobForm.nopol.trim(),
        no_rangka: jobForm.no_rangka.trim(),
        asal_kota: jobForm.asal_kota.trim(),
        tujuan_kota: jobForm.tujuan_kota.trim(),
        total_harga: harga,
        catatan: jobForm.catatan.trim(),
        tanggal: jobForm.tanggal || todayStr(),
      }, { headers });
      setJobForm(blankJobForm);
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash("Unit ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah unit"); }
    finally { setJobSaving(false); }
  };

  // ── Tarik unit dari Order (kaya Selisih): unit/rute auto, tinggal isi Total Harga ──
  const [tarikOpen, setTarikOpen] = useState(false);
  const [tarikOrders, setTarikOrders] = useState([]);
  const [tarikQ, setTarikQ] = useState("");
  const [tarikLoading, setTarikLoading] = useState(false);
  const [tarikSel, setTarikSel] = useState({}); // key -> {..., total_harga}
  const [tarikSaving, setTarikSaving] = useState(false);

  const orderUnitsOf = (o) => {
    const arr = (Array.isArray(o.units) && o.units.length) ? o.units
      : [{ unit_id: "legacy", vehicle_type: o.vehicle_type, tipe_model: o.tipe_model, nopol: o.nopol, no_rangka: o.no_rangka }];
    return arr.map((u, i) => ({
      key: `${o.order_id}:${u.unit_id || u.nopol || i}`,
      vehicle_type: `${u.vehicle_type || ""}${u.tipe_model ? " " + u.tipe_model : ""}`.trim() || "Kendaraan",
      nopol: (u.nopol || "").toUpperCase(), no_rangka: (u.no_rangka || "").toUpperCase(),
      asal_kota: o.asal_kota || "", tujuan_kota: o.tujuan_kota || "", customer: o.customer_nama || "",
    }));
  };

  const openTarik = async () => {
    if (!selected) { flash("Pilih supplier dulu"); return; }
    setTarikOpen(true); setTarikSel({}); setTarikQ(""); setTarikLoading(true);
    try {
      const r = await axios.get(`${API}/admin/orders`, { headers });
      setTarikOrders(r.data?.items || []);
    } catch { flash("Gagal memuat order"); setTarikOrders([]); }
    finally { setTarikLoading(false); }
  };

  const toggleTarik = (row) => setTarikSel((s) => {
    const n = { ...s };
    if (n[row.key]) delete n[row.key]; else n[row.key] = { ...row, total_harga: "" };
    return n;
  });
  const setTarikHarga = (key, val) => setTarikSel((s) => ({ ...s, [key]: { ...s[key], total_harga: val } }));

  const doTarik = async () => {
    const valid = Object.values(tarikSel).filter((r) => pNum(r.total_harga) > 0);
    if (!valid.length) { flash("Centang unit & isi Total Harga dulu"); return; }
    setTarikSaving(true);
    try {
      for (const r of valid) {
        await axios.post(`${API}/admin/suppliers/${selected.id}/jobs`, {
          vehicle_type: r.vehicle_type, nopol: r.nopol, no_rangka: r.no_rangka,
          asal_kota: r.asal_kota, tujuan_kota: r.tujuan_kota,
          total_harga: pNum(r.total_harga), catatan: "", tanggal: todayStr(),
        }, { headers });
      }
      setTarikOpen(false); setTarikSel({});
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash(`${valid.length} unit ditarik dari order`);
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tarik unit"); }
    finally { setTarikSaving(false); }
  };

  const tarikRows = tarikOrders.flatMap(orderUnitsOf).filter((row) => {
    const q = tarikQ.trim().toLowerCase();
    if (!q) return true;
    return `${row.nopol} ${row.no_rangka} ${row.vehicle_type} ${row.asal_kota} ${row.tujuan_kota} ${row.customer}`.toLowerCase().includes(q);
  });

  const deleteJob = async (jobId) => {
    if (!window.confirm("Hapus unit ini beserta semua riwayat pembayarannya?")) return;
    try {
      await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}`, { headers });
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
    } catch { flash("Gagal hapus unit"); }
  };

  // ── Payment form (per job) — transfer cash biasa, atau kompensasi (supplier kirim unit) ──
  const [payOpen, setPayOpen] = useState(null); // job_id lagi buka form bayar
  const [payTipe, setPayTipe] = useState("transfer"); // "transfer" | "kompensasi"
  const [payAmount, setPayAmount] = useState("");
  const [payCatatan, setPayCatatan] = useState("");
  const [payTanggal, setPayTanggal] = useState(todayStr());
  const [payFile, setPayFile] = useState(null);
  const [kompVehicle, setKompVehicle] = useState("");
  const [kompNoUnit, setKompNoUnit] = useState("");
  const [kompAsal, setKompAsal] = useState("");
  const [kompTujuan, setKompTujuan] = useState("");
  const [paySaving, setPaySaving] = useState(false);
  const fileRef = useRef();

  const openPay = (jobId) => {
    setPayOpen(jobId); setPayTipe("transfer"); setPayAmount(""); setPayCatatan(""); setPayTanggal(todayStr()); setPayFile(null);
    setKompVehicle(""); setKompNoUnit(""); setKompAsal(""); setKompTujuan("");
  };

  const submitPay = async (jobId) => {
    const amt = pNum(payAmount);
    if (amt <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", amt);
      fd.append("catatan", payCatatan.trim());
      fd.append("tanggal", payTanggal || todayStr());
      fd.append("tipe", payTipe);
      if (payTipe === "kompensasi") {
        fd.append("kompensasi_vehicle_type", kompVehicle.trim());
        fd.append("kompensasi_no_unit", kompNoUnit.trim());
        fd.append("kompensasi_asal_kota", kompAsal.trim());
        fd.append("kompensasi_tujuan_kota", kompTujuan.trim());
      }
      if (payFile) fd.append("bukti", payFile);
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/payments`, fd, { headers });
      setPayOpen(null);
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash(payTipe === "kompensasi" ? "Kompensasi tercatat, sisa otomatis dikurangi" : "Pembayaran tercatat, sisa otomatis dikurangi");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal simpan pembayaran"); }
    finally { setPaySaving(false); }
  };

  const deletePayment = async (jobId, paymentId) => {
    if (!window.confirm("Hapus catatan pembayaran ini?")) return;
    try {
      await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/payments/${paymentId}`, { headers });
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
    } catch { flash("Gagal hapus pembayaran"); }
  };

  const resolveUrl = (u) => {
    if (!u) return "";
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return `${BACKEND_URL}${u}`;
  };

  const deleteSupplier = async () => {
    if (!selected) return;
    if (!window.confirm(`Hapus supplier "${selected.nama}" beserta semua unit & riwayat pembayarannya? Tindakan ini tidak bisa dibatalkan.`)) return;
    try {
      await axios.delete(`${API}/admin/suppliers/${selected.id}`, { headers });
      setSelected(null);
      setQuery("");
      setListRefreshTick((t) => t + 1);
      flash("Supplier dihapus");
    } catch { flash("Gagal hapus supplier"); }
  };

  // ── Projek (batch unit yang bisa di-close kalau udah lunas semua) ──
  const [projSaving, setProjSaving] = useState(false);
  const addProject = async () => {
    if (!selected) return;
    setProjSaving(true);
    try {
      await axios.post(`${API}/admin/suppliers/${selected.id}/projects`, {}, { headers });
      await reloadSelected(selected.id);
      flash("Projek baru dibuat — unit selanjutnya masuk ke sini");
    } catch { flash("Gagal bikin projek baru"); }
    finally { setProjSaving(false); }
  };
  const closeProject = async (projectId, sisa) => {
    const msg = sisa > 0
      ? `Projek ini masih ada sisa ${fRp(sisa)} yang belum kebayar. Tetap tutup projek?`
      : "Tutup projek ini (tandai lunas/selesai)?";
    if (!window.confirm(msg)) return;
    try {
      await axios.patch(`${API}/admin/suppliers/${selected.id}/projects/${projectId}/close`, {}, { headers });
      await reloadSelected(selected.id);
      flash("Projek ditutup");
    } catch { flash("Gagal tutup projek"); }
  };
  const reopenProject = async (projectId) => {
    try {
      await axios.patch(`${API}/admin/suppliers/${selected.id}/projects/${projectId}/reopen`, {}, { headers });
      await reloadSelected(selected.id);
      flash("Projek dibuka lagi");
    } catch { flash("Gagal buka projek"); }
  };

  const [ringkasanBusy, setRingkasanBusy] = useState(false);
  const downloadRingkasan = async () => {
    if (!selected) return;
    setRingkasanBusy(true);
    try {
      const r = await axios.get(`${API}/admin/suppliers/${selected.id}/ringkasan/image`, { headers, responseType: "blob" });
      const blob = new Blob([r.data], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Ringkasan-${selected.nama.replace(/[^a-z0-9]+/gi, "-")}.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("Ringkasan diunduh — siap dikirim ke WhatsApp");
    } catch (e) { flash("Gagal buat ringkasan, coba lagi"); }
    finally { setRingkasanBusy(false); }
  };

  return (
    <div style={{ maxWidth: 900, margin: "12px auto 0", padding: "0 16px 40px" }}>
      <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>💸 Pembayaran Supplier</div>
        <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 14 }}>
          Buat supplier jasa supir/SDM yang beda cara catetnya sama kita — per unit ada total harga,
          bisa dibayar bertahap (DP), upload bukti transfer, sisa kehitung otomatis.
        </div>

        <label style={L}>Cari / Buat Supplier</label>
        <div style={{ position: "relative" }}>
          <input
            style={I}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
            placeholder="Ketik nama supplier untuk mencari atau membuat baru..."
            data-testid="sup-search"
          />
          {!selected && dropdown.length > 0 && (
            <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 8, marginTop: 4, zIndex: 10, maxHeight: 240, overflowY: "auto" }}>
              {dropdown.map((s) => (
                <div key={s.id} onClick={() => selectSupplier(s)} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid #21262d", fontSize: 13, display: "flex", justifyContent: "space-between", gap: 10 }} data-testid={`sup-option-${s.id}`}>
                  <span style={{ fontWeight: 700 }}>{s.nama}</span>
                  <span style={{ color: "#8b949e", fontSize: 11 }}>{s.jumlah_unit || 0} unit · sisa {fRp(s.grand_sisa)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!selected && query.trim() && (
          <button style={{ ...BTN, marginTop: 10 }} onClick={createOrOpenSupplier} data-testid="sup-create">
            + Buat/Buka "{query.trim()}"
          </button>
        )}
      </div>

      {selected && (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{selected.nama}</div>
              <div style={{ fontSize: 11, color: "#8b949e" }}>{selected.jenis || "Supplier"} {selected.no_hp && `· ${selected.no_hp}`}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={downloadRingkasan} disabled={ringkasanBusy} data-testid="sup-ringkasan-download">
                  {ringkasanBusy ? "⏳ Membuat..." : "📄 Download Ringkasan"}
                </button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px" }} onClick={addProject} disabled={projSaving} data-testid="sup-project-add">
                  {projSaving ? "⏳..." : "📁 + Projek Baru"}
                </button>
                <button style={{ ...BTN_GHOST, fontSize: 11, padding: "6px 12px", color: "#f85149", borderColor: "#f85149" }} onClick={deleteSupplier} data-testid="sup-delete">
                  🗑 Hapus Supplier
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 16, textAlign: "right" }}>
              <div>
                <div style={{ fontSize: 10, color: "#8b949e" }}>Total Harga</div>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{fRp(selected.grand_total_harga)}</div>
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

          {/* Form tambah unit baru */}
          <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, color: "#EF9F27" }}>+ Tambah Unit</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={I} placeholder="Tipe kendaraan" value={jobForm.vehicle_type} onChange={(e) => setJobForm((f) => ({ ...f, vehicle_type: e.target.value }))} data-testid="sup-job-vehicle" />
              <input style={I} placeholder="No. Polisi (kalau mobil baru, kosongkan)" value={jobForm.nopol} onChange={(e) => setJobForm((f) => ({ ...f, nopol: e.target.value.toUpperCase() }))} data-testid="sup-job-nopol" />
              <input style={I} placeholder="No. Rangka" value={jobForm.no_rangka} onChange={(e) => setJobForm((f) => ({ ...f, no_rangka: e.target.value.toUpperCase() }))} data-testid="sup-job-rangka" />
              <input style={I} placeholder="Kota asal" value={jobForm.asal_kota} onChange={(e) => setJobForm((f) => ({ ...f, asal_kota: e.target.value }))} />
              <input style={I} placeholder="Kota tujuan" value={jobForm.tujuan_kota} onChange={(e) => setJobForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
              <input style={I} inputMode="numeric" placeholder="Total harga (Rp)" value={jobForm.total_harga} onChange={(e) => setJobForm((f) => ({ ...f, total_harga: e.target.value }))} data-testid="sup-job-harga" />
              <input type="date" style={I} value={jobForm.tanggal} onChange={(e) => setJobForm((f) => ({ ...f, tanggal: e.target.value }))} data-testid="sup-job-tanggal" />
              <input style={I} placeholder="Catatan (opsional)" value={jobForm.catatan} onChange={(e) => setJobForm((f) => ({ ...f, catatan: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={BTN} onClick={addJob} disabled={jobSaving} data-testid="sup-job-save">
                {jobSaving ? "Menyimpan..." : "Simpan Unit"}
              </button>
              <button style={BTN_GHOST} onClick={openTarik} data-testid="sup-tarik-open">📥 Tarik dari Order</button>
            </div>
          </div>

          {/* Daftar unit/job, dikelompokkan per Projek */}
          {(selected.projects || []).length === 0 && (
            <div style={{ textAlign: "center", padding: 20, color: "#8b949e", fontSize: 13 }}>Belum ada unit buat supplier ini.</div>
          )}
          {(selected.projects || []).map((proj) => {
            const jobs = (selected.jobs || []).filter((j) => j.project_id === proj.id);
            const projSisa = jobs.reduce((s, j) => s + (j.sisa || 0), 0);
            const isClosed = proj.status === "closed";
            return (
              <div key={proj.id} style={{ marginBottom: 18 }} data-testid={`sup-project-${proj.id}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, padding: "6px 2px", borderBottom: "1px solid #21262d" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 800, fontSize: 13 }}>📁 {proj.nama}</span>
                    {isClosed ? (
                      <span style={{ background: "#0d2818", color: "#3fb950", borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 800 }}>✓ Lunas</span>
                    ) : (
                      <span style={{ background: "#1a2233", color: "#58a6ff", borderRadius: 12, padding: "2px 10px", fontSize: 10, fontWeight: 800 }}>🟢 Aktif</span>
                    )}
                    {isClosed && projSisa > 0 && <span style={{ fontSize: 10, color: "#f85149" }}>(masih ada sisa {fRp(projSisa)})</span>}
                  </div>
                  {isClosed ? (
                    <button onClick={() => reopenProject(proj.id)} style={{ ...BTN_GHOST, fontSize: 11, padding: "5px 10px" }} data-testid={`sup-project-reopen-${proj.id}`}>🔓 Buka Lagi</button>
                  ) : (
                    <button onClick={() => closeProject(proj.id, projSisa)} style={{ ...BTN_GHOST, fontSize: 11, padding: "5px 10px" }} data-testid={`sup-project-close-${proj.id}`}>🔒 Close Projek</button>
                  )}
                </div>

                {jobs.length === 0 && <div style={{ fontSize: 12, color: "#8b949e", padding: "6px 2px" }}>Belum ada unit di projek ini.</div>}

                {jobs.map((job) => (
                  <div key={job.id} style={{ border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 10 }} data-testid={`sup-job-${job.id}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{job.vehicle_type || "—"} {job.nopol && <span style={{ color: "#8b949e" }}>· {job.nopol}</span>} {job.no_rangka && <span style={{ color: "#8b949e" }}>· {job.no_rangka}</span>}</div>
                        <div style={{ fontSize: 12, color: "#8b949e" }}>{job.asal_kota || "—"} &rarr; {job.tujuan_kota || "—"} {job.tanggal && <span style={{ marginLeft: 6 }}>· {fDate(job.tanggal)}</span>}</div>
                        {job.catatan && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{job.catatan}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: 11, color: "#8b949e" }}>Harga: {fRp(job.total_harga)}</div>
                        <div style={{ fontSize: 11, color: "#3fb950" }}>Terbayar: {fRp(job.total_terbayar)}</div>
                        <div style={{ fontSize: 13, fontWeight: 900, color: job.sisa > 0 ? "#f85149" : "#3fb950" }}>Sisa: {fRp(job.sisa)}</div>
                      </div>
                    </div>

                    {/* Riwayat pembayaran (transfer cash atau kompensasi kirim unit) */}
                    {(job.payments || []).length > 0 && (
                      <div style={{ marginTop: 10, borderTop: "1px solid #21262d", paddingTop: 8 }}>
                        {job.payments.map((p) => {
                          const ku = p.kompensasi_unit;
                          return (
                            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", color: "#c9d1d9" }}>
                              <span>
                                <span style={{ color: "#8b949e" }}>{fDate(p.tanggal)}</span> — {fRp(p.amount)}
                                {p.tipe === "kompensasi" ? (
                                  <span style={{ color: "#79c0ff" }}>
                                    {" "}— 🚗 Kompensasi{ku?.vehicle_type && `: ${ku.vehicle_type}`}{ku?.no_unit && ` · ${ku.no_unit}`}
                                    {(ku?.asal_kota || ku?.tujuan_kota) && ` (${ku?.asal_kota || "?"} → ${ku?.tujuan_kota || "?"})`}
                                  </span>
                                ) : (
                                  p.catatan && <span style={{ color: "#8b949e" }}>— {p.catatan}</span>
                                )}
                                {p.tipe === "kompensasi" && p.catatan && <span style={{ color: "#8b949e" }}> — {p.catatan}</span>}
                                {p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "#58a6ff" }}>📎 bukti</a>}
                              </span>
                              <button onClick={() => deletePayment(job.id, p.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      {payOpen === job.id ? (
                        <div style={{ width: "100%", background: "#0d1117", borderRadius: 8, padding: 10 }}>
                          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <button type="button" onClick={() => setPayTipe("transfer")}
                              style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                                border: payTipe === "transfer" ? "2px solid #EF9F27" : "1px solid #30363d",
                                background: payTipe === "transfer" ? "#2a1f0d" : "none", color: payTipe === "transfer" ? "#EF9F27" : "#8b949e" }}
                              data-testid={`sup-pay-tipe-transfer-${job.id}`}>
                              💵 Transfer Cash
                            </button>
                            <button type="button" onClick={() => setPayTipe("kompensasi")}
                              style={{ flex: 1, padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: "pointer",
                                border: payTipe === "kompensasi" ? "2px solid #58a6ff" : "1px solid #30363d",
                                background: payTipe === "kompensasi" ? "#0d1b2a" : "none", color: payTipe === "kompensasi" ? "#58a6ff" : "#8b949e" }}
                              data-testid={`sup-pay-tipe-kompensasi-${job.id}`}>
                              🚗 Kompensasi (Kirim Unit)
                            </button>
                          </div>
                          {payTipe === "kompensasi" && (
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                              <input style={I} placeholder="Tipe kendaraan" value={kompVehicle} onChange={(e) => setKompVehicle(e.target.value)} data-testid={`sup-komp-vehicle-${job.id}`} />
                              <input style={I} placeholder="No. Pol / No. Rangka" value={kompNoUnit} onChange={(e) => setKompNoUnit(e.target.value.toUpperCase())} data-testid={`sup-komp-nounit-${job.id}`} />
                              <input style={I} placeholder="Kota asal" value={kompAsal} onChange={(e) => setKompAsal(e.target.value)} />
                              <input style={I} placeholder="Kota tujuan" value={kompTujuan} onChange={(e) => setKompTujuan(e.target.value)} />
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                            <input style={{ ...I, flex: 1, minWidth: 120 }} inputMode="numeric" placeholder={payTipe === "kompensasi" ? "Nilai unit (Rp)" : "Jumlah bayar (Rp)"} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus data-testid={`sup-pay-amount-${job.id}`} />
                            <input style={{ ...I, flex: 1, minWidth: 120 }} placeholder="Catatan (opsional)" value={payCatatan} onChange={(e) => setPayCatatan(e.target.value)} />
                            <input type="date" style={{ ...I, flex: 1, minWidth: 140 }} value={payTanggal} onChange={(e) => setPayTanggal(e.target.value)} data-testid={`sup-pay-date-${job.id}`} />
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayFile(e.target.files?.[0] || null)} />
                            <button style={BTN_GHOST} onClick={() => fileRef.current?.click()}>
                              {payFile ? `📎 ${payFile.name.slice(0, 20)}` : (payTipe === "kompensasi" ? "📎 Upload Foto Unit (opsional)" : "📎 Upload Bukti Transfer")}
                            </button>
                            <button style={BTN} onClick={() => submitPay(job.id)} disabled={paySaving} data-testid={`sup-pay-save-${job.id}`}>
                              {paySaving ? "Menyimpan..." : "Simpan Pembayaran"}
                            </button>
                            <button style={BTN_GHOST} onClick={() => setPayOpen(null)}>Batal</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button style={BTN} onClick={() => openPay(job.id)} data-testid={`sup-pay-open-${job.id}`}>+ Catat Bayar</button>
                          <button style={{ ...BTN_GHOST, color: "#f85149", borderColor: "#f85149" }} onClick={() => deleteJob(job.id)}>Hapus Unit</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {tarikOpen && (
        <div onClick={() => setTarikOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 640, maxHeight: "88vh", overflowY: "auto", background: "#0d1117", border: "1px solid #30363d", borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontWeight: 800, fontSize: 15 }}>📥 Tarik Unit dari Order</div>
              <button onClick={() => setTarikOpen(false)} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 18, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 10 }}>Centang unit, isi Total Harga (biaya ke supplier ini). Unit &amp; rute otomatis dari order.</div>
            <input style={I} placeholder="🔎 cari nopol / rute / customer…" value={tarikQ} onChange={(e) => setTarikQ(e.target.value)} />
            {tarikLoading ? <div style={{ padding: 20, textAlign: "center", color: "#8b949e" }}>Memuat…</div> : (
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, maxHeight: "46vh", overflowY: "auto" }}>
                {tarikRows.map((row) => {
                  const on = !!tarikSel[row.key];
                  return (
                    <div key={row.key} style={{ border: `1px solid ${on ? "#EF9F27" : "#21262d"}`, borderRadius: 8, padding: 10, background: on ? "#1a1408" : "#161b22" }}>
                      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                        <input type="checkbox" checked={on} onChange={() => toggleTarik(row)} style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{row.nopol || row.no_rangka || "(tanpa nopol)"} · {row.vehicle_type}</div>
                          <div style={{ fontSize: 11, color: "#8b949e" }}>{row.asal_kota} → {row.tujuan_kota}{row.customer ? ` · ${row.customer}` : ""}</div>
                        </div>
                      </label>
                      {on && (
                        <div style={{ marginTop: 8 }}>
                          <input style={I} inputMode="numeric" placeholder="Total Harga ke supplier (Rp)" value={tarikSel[row.key].total_harga} onChange={(e) => setTarikHarga(row.key, e.target.value)} />
                        </div>
                      )}
                    </div>
                  );
                })}
                {tarikRows.length === 0 && <div style={{ padding: 16, textAlign: "center", color: "#8b949e", fontSize: 12 }}>Tidak ada order.</div>}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button style={BTN_GHOST} onClick={() => setTarikOpen(false)}>Batal</button>
              <button style={BTN} onClick={doTarik} disabled={tarikSaving} data-testid="sup-tarik-save">
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
