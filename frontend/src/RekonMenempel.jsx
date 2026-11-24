/* Selesaikan transaksi READY Felis yang "menempel" (supplier lama sudah dihapus):
   pilih profil supplier yang benar -> preview baca-saja -> persetujuan (Super Admin / Finance Approver + password + alasan)
   -> tersimpan sebagai Belum Dialokasikan + ACK ke Felis, jadi hilang dari READY. */
import { useEffect, useState } from "react";
import axios from "axios";

const rp = (n) => "Rp " + new Intl.NumberFormat("id-ID").format(Number(n || 0));
const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const pesan = (e) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (d && d.pesan) return d.pesan;
  return e?.message || "Gagal";
};

export default function RekonMenempel({ api, headers, item, onClose, onDone }) {
  const [daftar, setDaftar] = useState([]);
  const [q, setQ] = useState(item.supplier_name || "");
  const [pilih, setPilih] = useState(null);
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [alasan, setAlasan] = useState("");
  const [pw, setPw] = useState("");
  const [oke, setOke] = useState(false);
  const [hasil, setHasil] = useState(null);

  useEffect(() => {
    let batal = false;
    axios.get(`${api}/admin/suppliers`, { params: { q: q.trim() }, headers })
      .then((r) => { if (!batal) setDaftar((r.data?.items || []).slice(0, 30)); })
      .catch(() => { if (!batal) setDaftar([]); });
    return () => { batal = true; };
  }, [q]);   // eslint-disable-line

  const preview = async (sup) => {
    setPilih(sup); setPv(null); setErr(""); setOke(false); setBusy(true);
    try {
      const { data } = await axios.post(`${api}/admin/rekon/menempel/preview`, { bank_transaction_id: item.bank_transaction_id, target_supplier_id: sup.id }, { headers });
      setPv(data);
    } catch (e) { setErr(pesan(e)); }
    setBusy(false);
  };
  const terapkan = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await axios.post(`${api}/admin/rekon/menempel/terapkan`, {
        bank_transaction_id: item.bank_transaction_id, target_supplier_id: pilih.id, preview_token: pv.token,
        alasan, password: pw, identitas_diverifikasi: oke,
      }, { headers });
      setHasil(data); setPw("");
      if (onDone) onDone();
    } catch (e) {
      const s = e?.response?.status;
      setErr(s === 401 ? `${pesan(e)} (masuk dulu memakai akun Super Admin / Finance Approver, bukan hanya PIN)` : pesan(e));
    }
    setBusy(false);
  };

  const warnaId = { sama: "#3fb950", mirip: "#f0a742", beda: "#f85149" }[pv?.identitas_supplier] || "#8b949e";
  const box = { background: "#0a0e16", border: "1px solid #1a2130", borderRadius: 8, padding: 10, marginTop: 8, fontSize: 12.5, color: "#c9d1d9", lineHeight: 1.7 };
  const inp = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #2a3344", background: "#0d1117", color: "#e6edf3", fontSize: 13 };
  const siap = pv && alasan.trim().length >= 5 && pw && oke && !busy && !hasil;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} data-testid="rekon-menempel" style={{ background: "#0d1117", border: "1px solid #2a3344", borderRadius: 12, padding: 16, width: "100%", maxWidth: 560, maxHeight: "92vh", overflowY: "auto", color: "#e6edf3" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>🔗 Selesaikan transaksi yang menempel</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 18, cursor: "pointer" }}>✕</button>
        </div>
        <div style={box}>
          <div><b>{rp(item.nominal)}</b> · {item.tanggal || "-"} · {item.source_entity || "-"}</div>
          <div style={{ color: "#8b949e" }}>nama bank: {item.supplier_name || item.beneficiary_name_raw || "-"} · supplier lama: <b>{item.supplier_id || "-"}</b> (sudah tidak ada)</div>
          <div style={{ fontSize: 11, color: "#6b7688" }}>id: {item.bank_transaction_id}</div>
        </div>

        {!hasil && (<>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#8b949e", margin: "12px 0 4px" }}>1. PILIH PROFIL SUPPLIER YANG BENAR</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="cari nama supplier" style={inp} data-testid="rekon-menempel-cari" />
          <div style={{ maxHeight: 150, overflowY: "auto", marginTop: 6, border: "1px solid #1a2130", borderRadius: 8 }}>
            {daftar.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#6b7688" }}>Tidak ada supplier cocok.</div>}
            {daftar.map((s) => (
              <div key={s.id} onClick={() => preview(s)} data-testid={`rekon-menempel-pilih-${s.id}`}
                style={{ padding: "8px 10px", cursor: "pointer", fontSize: 12.5, borderBottom: "1px solid #131a27", background: pilih?.id === s.id ? "#12301d" : "transparent" }}>
                <b>{s.nama}</b>{norm(s.nama) === norm(item.supplier_name) ? <span style={{ color: "#3fb950" }}> · nama sama dengan bank</span> : null}
                <span style={{ color: "#6b7688" }}> · {(s.jobs || []).length} tagihan · {s.id}</span>
              </div>
            ))}
          </div>
        </>)}

        {busy && !pv && <div style={{ marginTop: 10, fontSize: 12, color: "#8b949e" }}>Memeriksa…</div>}
        {pv && (
          <div style={box} data-testid="rekon-menempel-preview">
            <div style={{ fontWeight: 800 }}>2. PRATINJAU (belum ada yang disimpan)</div>
            <div>Akan disimpan di: <b>{pv.supplier_tujuan.nama}</b> <span style={{ color: "#6b7688" }}>({pv.supplier_tujuan.supplier_id})</span></div>
            <div>Kecocokan nama dengan bank: <b style={{ color: warnaId }}>{pv.identitas_supplier}</b></div>
            <div>Hasil: <b>{pv.hasil_bila_diterapkan === "ditahan_perlu_verifikasi" ? "ditahan sebagai Perlu Verifikasi (kemungkinan transfer ganda)" : "masuk Belum Dialokasikan"}</b></div>
            {(pv.kemungkinan_duplikat || []).length > 0 && (
              <div style={{ color: "#f0a742" }}>⚠ Mirip transaksi: {pv.kemungkinan_duplikat.map((k) => `${k.bank_transaction_id} (${k.tingkat})`).join(", ")}. Tidak dihapus/digabung; diputuskan terpisah.</div>
            )}
            <div style={{ color: "#8b949e" }}>{pv.catatan}</div>
          </div>
        )}

        {pv && !hasil && (<>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#8b949e", margin: "12px 0 4px" }}>3. PERSETUJUAN (Super Admin / Finance Approver)</div>
          <textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="Alasan (min. 5 huruf), mis. supplier lama terhapus saat impor ulang" rows={2} style={inp} data-testid="rekon-menempel-alasan" />
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password akun kamu (autentikasi ulang)" style={{ ...inp, marginTop: 6 }} data-testid="rekon-menempel-pw" autoComplete="current-password" />
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, fontSize: 12.5 }}>
            <input type="checkbox" checked={oke} onChange={(e) => setOke(e.target.checked)} data-testid="rekon-menempel-oke" style={{ marginTop: 3 }} />
            <span>Saya sudah memverifikasi bahwa profil <b>{pv.supplier_tujuan.nama}</b> adalah supplier yang benar untuk transaksi ini.</span>
          </label>
          <button onClick={terapkan} disabled={!siap} data-testid="rekon-menempel-terapkan"
            style={{ marginTop: 10, padding: "9px 16px", borderRadius: 9, border: "1px solid #2ea043", background: siap ? "#0d2a17" : "#11161f", color: siap ? "#3fb950" : "#4b5563", fontWeight: 800, fontSize: 12.5, cursor: siap ? "pointer" : "default" }}>
            {busy ? "⏳ Memproses…" : "✅ Selesaikan & hilangkan dari READY"}
          </button>
        </>)}

        {err && <div style={{ marginTop: 10, fontSize: 12.5, color: "#f85149" }} data-testid="rekon-menempel-err">{err}</div>}
        {hasil && (
          <div style={{ ...box, borderColor: "#2ea043" }} data-testid="rekon-menempel-hasil">
            <div style={{ color: "#3fb950", fontWeight: 800 }}>{hasil.sudah_diterapkan ? "Sudah pernah diterapkan." : "✓ Tersimpan."}</div>
            {hasil.perlu_verifikasi && <div style={{ color: "#f0a742" }}>Ditahan sebagai Perlu Verifikasi (tidak ikut total) sampai diputuskan.</div>}
            <div>ACK ke Felis: <b>{hasil.acked ? "berhasil, transaksi tidak lagi READY" : "belum"}</b></div>
            {hasil.peringatan && <div style={{ color: "#f0a742" }}>{hasil.peringatan}</div>}
            <button onClick={onClose} style={{ marginTop: 8, padding: "7px 14px", borderRadius: 8, border: "1px solid #2a3344", background: "#161b22", color: "#e6edf3", cursor: "pointer" }}>Tutup</button>
          </div>
        )}
      </div>
    </div>
  );
}
