/*
  Laporan Rekonsiliasi Bank <-> Tagihan untuk satu supplier/orang (BACA-SAJA).
  Memanggil GET /admin/rekon/rekonsiliasi-supplier. Tidak ada tombol yang mengubah data di layar ini.
  Menampilkan semua profil kembar (aktif / arsip), tiap transaksi bank, pasangan kemungkinan salinan, dan ringkasan.
*/
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const C = { card: "#161b22", line: "#21262d", ink: "#e6edf3", mute: "#8b949e", gold: "#EF9F27", green: "#3fb950", red: "#f85149", blue: "#58a6ff" };
const rp = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const KELAS = {
  tertaut: ["Tertaut", C.green], belum_dialokasikan: ["Belum dialokasikan", C.gold], tersembunyi: ["Tersembunyi (Clear)", C.mute],
  supplier_hilang: ["Perlu Rekonsiliasi · supplier dihapus", C.red], pembayaran_hilang: ["Perlu Rekonsiliasi · pembayaran hilang", C.red],
  alokasi_yatim: ["Perlu Hubungkan Ulang", C.red], perlu_verifikasi: ["Perlu Verifikasi (ditahan)", C.gold],
  supplier_diarsipkan: ["Supplier diarsipkan", C.blue], dibatalkan: ["Dibatalkan", C.mute],
};

function Kartu({ k, v, c, sub }) {
  return (
    <div style={{ background: "#0d1117", border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 10px" }}>
      <div style={{ fontSize: 9.5, color: C.mute, textTransform: "uppercase", fontWeight: 700, letterSpacing: ".3px" }}>{k}</div>
      <div style={{ fontSize: 14, fontWeight: 900, color: c || C.ink, textAlign: "right", marginTop: 3 }}>{v}</div>
      {sub ? <div style={{ fontSize: 10, color: C.mute, textAlign: "right" }}>{sub}</div> : null}
    </div>
  );
}

export default function RekonLaporan({ nama, supplierId, headers, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const hdr = useRef(headers);          // objek headers dibuat ulang tiap render induk; jangan jadi pemicu muat ulang
  useEffect(() => {
    let alive = true;
    axios.get(`${API}/admin/rekon/rekonsiliasi-supplier`, { headers: hdr.current, params: { nama, supplier_ids: supplierId || "" } })
      .then((r) => { if (alive) setD(r.data); })
      .catch((e) => { if (alive) setErr(e?.response?.data?.detail || "Gagal memuat laporan"); });
    return () => { alive = false; };
  }, [nama, supplierId]);
  const s = d && d.ringkasan;
  return createPortal((
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 9999, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: 12 }} onClick={onClose} data-testid="rekon-laporan">
      <div style={{ background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 14, width: "100%", maxWidth: 920, padding: 14 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: C.gold }}>🏦 Rekonsiliasi Bank · {nama}</div>
            <div style={{ fontSize: 11, color: C.mute }}>Hanya membaca. Tidak ada pembayaran, alokasi, atau saldo yang diubah dari layar ini.</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: `1px solid ${C.line}`, color: C.ink, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 700 }} aria-label="Tutup">✕</button>
        </div>
        {err && <div style={{ color: C.red, marginTop: 10 }}>❌ {err}</div>}
        {!d && !err && <div style={{ color: C.mute, marginTop: 14 }}>Memuat…</div>}
        {d && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 12 }}>
              <Kartu k="Transaksi bank (sah)" v={rp(s.bank.nominal)} sub={`${s.bank.jumlah} transaksi`} />
              <Kartu k="Terdeteksi salinan" v={rp(s.salinan_terdeteksi.nominal)} c={s.salinan_terdeteksi.jumlah ? C.gold : C.ink} sub={`${s.salinan_terdeteksi.jumlah} transaksi`} />
              <Kartu k="Bank tanpa salinan (perkiraan)" v={rp(s.bank_tanpa_salinan_perkiraan)} />
              <Kartu k="Tersembunyi (Clear)" v={rp(s.tersembunyi.nominal)} sub={`${s.tersembunyi.jumlah} transaksi · ${s.tersembunyi.salinan_terdeteksi.jumlah} salinan`} />
              <Kartu k="Tagihan aktif (net)" v={rp(s.tagihan_aktif.net_transfer)} sub={`${s.tagihan_aktif.unit} unit · ${s.tagihan_aktif.belum_lunas} belum lunas`} />
              <Kartu k="Teralokasi ke tagihan aktif" v={rp(s.selisih.teralokasi_ke_tagihan_aktif)} c={C.green} />
              <Kartu k="Sisa tagihan aktif" v={rp(s.tagihan_aktif.sisa)} c={s.tagihan_aktif.sisa > 0 ? C.red : C.green} />
              <Kartu k="Bank tanpa salinan − tagihan" v={rp(s.selisih.bank_tanpa_salinan_vs_net_transfer)} />
            </div>
            {(s.catatan || []).map((x, i) => <div key={i} style={{ fontSize: 12, color: C.gold, marginTop: 8 }}>⚠️ {x}</div>)}

            <div style={{ fontSize: 12.5, fontWeight: 800, margin: "14px 0 6px" }}>Profil terkait ({d.profil.length})</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead><tr style={{ color: C.mute, textAlign: "left" }}>{["ID", "Nama", "Status", "Unit", "Net transfer", "Terbayar", "Sisa", "Rekon", "Belum alokasi", "Yatim", "Tersembunyi"].map((h) => <th key={h} style={{ padding: "4px 6px", fontSize: 10, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
                <tbody>{d.profil.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${C.line}`, opacity: p.aktif ? 1 : 0.7 }}>
                    <td style={{ padding: "5px 6px", fontFamily: "monospace" }}>{p.id}</td><td style={{ padding: "5px 6px" }}>{p.nama}</td>
                    <td style={{ padding: "5px 6px", color: p.aktif ? C.green : C.blue }}>{p.aktif ? "aktif" : p.status}</td><td style={{ padding: "5px 6px" }}>{p.jumlah_unit}</td>
                    <td style={{ padding: "5px 6px" }}>{rp(p.net_transfer)}</td><td style={{ padding: "5px 6px" }}>{rp(p.terbayar)}</td><td style={{ padding: "5px 6px" }}>{rp(p.sisa)}</td>
                    <td style={{ padding: "5px 6px" }}>{p.rekon_aktif.jumlah} · {rp(p.rekon_aktif.nominal)}</td><td style={{ padding: "5px 6px" }}>{rp(p.rekon_aktif.belum_dialokasikan)}</td>
                    <td style={{ padding: "5px 6px" }}>{rp(p.rekon_aktif.alokasi_yatim)}</td><td style={{ padding: "5px 6px" }}>{p.tersembunyi.jumlah} · {rp(p.tersembunyi.nominal)}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: 12.5, fontWeight: 800, margin: "14px 0 6px" }}>Transaksi bank ({d.transaksi.length})</div>
            <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky", top: 0, background: C.card }}><tr style={{ color: C.mute, textAlign: "left" }}>{["Tanggal", "ID transaksi", "Nominal", "Import", "Ada di profil", "Alokasi sah", "Yatim", "Kelas", "Salinan?"].map((h) => <th key={h} style={{ padding: "4px 6px", fontSize: 10, textTransform: "uppercase" }}>{h}</th>)}</tr></thead>
                <tbody>{d.transaksi.map((t) => {
                  const k = KELAS[t.kelas] || [t.kelas || "—", C.mute];
                  return (
                    <tr key={t.bank_transaction_id} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>{t.tanggal}</td><td style={{ padding: "5px 6px", fontFamily: "monospace", fontSize: 11 }}>{t.bank_transaction_id}</td>
                      <td style={{ padding: "5px 6px", whiteSpace: "nowrap" }}>{rp(t.nominal)}</td><td style={{ padding: "5px 6px" }}>{t.status_import}</td>
                      <td style={{ padding: "5px 6px", fontFamily: "monospace", fontSize: 11 }}>{t.ada_di_profil || "—"}</td><td style={{ padding: "5px 6px" }}>{rp(t.alokasi_sah)}</td><td style={{ padding: "5px 6px" }}>{rp(t.alokasi_yatim)}</td>
                      <td style={{ padding: "5px 6px", color: k[1], fontWeight: 700 }}>{k[0]}{t.tersembunyi ? " · tersembunyi" : ""}</td>
                      <td style={{ padding: "5px 6px", fontSize: 11 }}>{t.salinan_dari ? `salinan dari ${t.salinan_dari}` : (t.kemungkinan_salinan.length ? "ada pasangan (perlu keputusan)" : "")}</td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: C.mute, marginTop: 10 }}>
              "Salinan dari" hanya dugaan berdasarkan sidik (tanggal, nominal, rekening sumber, referensi/rekening tujuan). Keputusan duplikat dan penghubungan ulang dilakukan Super Admin / Finance Approver lewat persetujuan terpisah.
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
