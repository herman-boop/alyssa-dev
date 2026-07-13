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
  const [jobForm, setJobForm] = useState({ vehicle_type: "", nopol: "", asal_kota: "", tujuan_kota: "", total_harga: "", catatan: "" });
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
        asal_kota: jobForm.asal_kota.trim(),
        tujuan_kota: jobForm.tujuan_kota.trim(),
        total_harga: harga,
        catatan: jobForm.catatan.trim(),
      }, { headers });
      setJobForm({ vehicle_type: "", nopol: "", asal_kota: "", tujuan_kota: "", total_harga: "", catatan: "" });
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash("Unit ditambahkan");
    } catch (e) { flash(e?.response?.data?.detail || "Gagal tambah unit"); }
    finally { setJobSaving(false); }
  };

  const deleteJob = async (jobId) => {
    if (!window.confirm("Hapus unit ini beserta semua riwayat pembayarannya?")) return;
    try {
      await axios.delete(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}`, { headers });
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
    } catch { flash("Gagal hapus unit"); }
  };

  // ── Payment form (per job) ──
  const [payOpen, setPayOpen] = useState(null); // job_id lagi buka form bayar
  const [payAmount, setPayAmount] = useState("");
  const [payCatatan, setPayCatatan] = useState("");
  const [payFile, setPayFile] = useState(null);
  const [paySaving, setPaySaving] = useState(false);
  const fileRef = useRef();

  const openPay = (jobId) => { setPayOpen(jobId); setPayAmount(""); setPayCatatan(""); setPayFile(null); };

  const submitPay = async (jobId) => {
    const amt = pNum(payAmount);
    if (amt <= 0) { flash("Jumlah bayar wajib diisi"); return; }
    setPaySaving(true);
    try {
      const fd = new FormData();
      fd.append("amount", amt);
      fd.append("catatan", payCatatan.trim());
      if (payFile) fd.append("bukti", payFile);
      await axios.post(`${API}/admin/suppliers/${selected.id}/jobs/${jobId}/payments`, fd, { headers });
      setPayOpen(null);
      await reloadSelected(selected.id);
      setListRefreshTick((t) => t + 1);
      flash("Pembayaran tercatat, sisa otomatis dikurangi");
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
              <input style={I} placeholder="No. Polisi" value={jobForm.nopol} onChange={(e) => setJobForm((f) => ({ ...f, nopol: e.target.value.toUpperCase() }))} data-testid="sup-job-nopol" />
              <input style={I} placeholder="Kota asal" value={jobForm.asal_kota} onChange={(e) => setJobForm((f) => ({ ...f, asal_kota: e.target.value }))} />
              <input style={I} placeholder="Kota tujuan" value={jobForm.tujuan_kota} onChange={(e) => setJobForm((f) => ({ ...f, tujuan_kota: e.target.value }))} />
              <input style={I} inputMode="numeric" placeholder="Total harga (Rp)" value={jobForm.total_harga} onChange={(e) => setJobForm((f) => ({ ...f, total_harga: e.target.value }))} data-testid="sup-job-harga" />
              <input style={I} placeholder="Catatan (opsional)" value={jobForm.catatan} onChange={(e) => setJobForm((f) => ({ ...f, catatan: e.target.value }))} />
            </div>
            <button style={BTN} onClick={addJob} disabled={jobSaving} data-testid="sup-job-save">
              {jobSaving ? "Menyimpan..." : "Simpan Unit"}
            </button>
          </div>

          {/* Daftar unit/job */}
          {(selected.jobs || []).length === 0 && (
            <div style={{ textAlign: "center", padding: 20, color: "#8b949e", fontSize: 13 }}>Belum ada unit buat supplier ini.</div>
          )}
          {(selected.jobs || []).map((job) => (
            <div key={job.id} style={{ border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 10 }} data-testid={`sup-job-${job.id}`}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{job.vehicle_type || "—"} {job.nopol && <span style={{ color: "#8b949e" }}>· {job.nopol}</span>}</div>
                  <div style={{ fontSize: 12, color: "#8b949e" }}>{job.asal_kota || "—"} &rarr; {job.tujuan_kota || "—"}</div>
                  {job.catatan && <div style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}>{job.catatan}</div>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#8b949e" }}>Harga: {fRp(job.total_harga)}</div>
                  <div style={{ fontSize: 11, color: "#3fb950" }}>Terbayar: {fRp(job.total_terbayar)}</div>
                  <div style={{ fontSize: 13, fontWeight: 900, color: job.sisa > 0 ? "#f85149" : "#3fb950" }}>Sisa: {fRp(job.sisa)}</div>
                </div>
              </div>

              {/* Riwayat pembayaran */}
              {(job.payments || []).length > 0 && (
                <div style={{ marginTop: 10, borderTop: "1px solid #21262d", paddingTop: 8 }}>
                  {job.payments.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, padding: "4px 0", color: "#c9d1d9" }}>
                      <span>
                        {fRp(p.amount)} {p.catatan && <span style={{ color: "#8b949e" }}>— {p.catatan}</span>}
                        {p.bukti_url && <a href={resolveUrl(p.bukti_url)} target="_blank" rel="noreferrer" style={{ marginLeft: 8, color: "#58a6ff" }}>📎 bukti</a>}
                      </span>
                      <button onClick={() => deletePayment(job.id, p.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {payOpen === job.id ? (
                  <div style={{ width: "100%", background: "#0d1117", borderRadius: 8, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                      <input style={{ ...I, flex: 1, minWidth: 120 }} inputMode="numeric" placeholder="Jumlah bayar (Rp)" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus data-testid={`sup-pay-amount-${job.id}`} />
                      <input style={{ ...I, flex: 1, minWidth: 120 }} placeholder="Catatan (mis. DP 1)" value={payCatatan} onChange={(e) => setPayCatatan(e.target.value)} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input ref={fileRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={(e) => setPayFile(e.target.files?.[0] || null)} />
                      <button style={BTN_GHOST} onClick={() => fileRef.current?.click()}>
                        {payFile ? `📎 ${payFile.name.slice(0, 20)}` : "📎 Upload Bukti Transfer"}
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
      )}

      {toast && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1a2233", border: "1px solid #EF9F27", color: "#EF9F27", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 999 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
