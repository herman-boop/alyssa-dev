/* eslint-disable */

const navy = "#1e3a8a";
const gray = "#6b7280";
const border = "#e5e7eb";
const gold = "#b8860b";

const STEPS = [
  {
    icon: "📋",
    title: "Sebelum Kendaraan Dijemput",
    items: [
      "Siapkan STNK (asli atau fotokopi, sesuai kesepakatan dengan admin)",
      "Kosongkan barang-barang pribadi dari dalam kendaraan",
      "Disarankan foto kondisi kendaraan sendiri sebagai arsip pribadi Anda",
    ],
  },
  {
    icon: "🚗",
    title: "Saat Serah Terima di Awal",
    items: [
      "Driver kami akan memfoto kondisi kendaraan (depan, belakang, kiri, kanan) sebelum berangkat",
      "Foto ini menjadi acuan pengecekan kondisi saat kendaraan sampai di tujuan",
    ],
  },
  {
    icon: "📍",
    title: "Selama Perjalanan",
    items: [
      "Pantau status kendaraan Anda secara real-time lewat link tracking yang dikirim admin",
      "Tidak perlu install aplikasi atau membuat akun — cukup buka link-nya",
      "Bisa melihat driver yang bertugas, rute, checkpoint, dan foto perjalanan",
    ],
  },
  {
    icon: "✅",
    title: "Saat Kendaraan Tiba",
    items: [
      "Cek kondisi kendaraan bersama driver di lokasi tujuan",
      "BASTK (Berita Acara Serah Terima Kendaraan) diisi secara digital, lengkap dengan sketsa kondisi kendaraan",
      "Tanda tangan di BASTK sebagai bukti serah terima yang sah",
    ],
  },
  {
    icon: "🔍",
    title: "Verifikasi & Simpan Bukti",
    items: [
      "Setiap BASTK punya QR code unik — scan untuk verifikasi keaslian dokumen kapan saja",
      "Simpan salinan BASTK sebagai bukti pengiriman Anda",
      "Ada pertanyaan? Hubungi admin kami di 0818 631 135",
    ],
  },
];

export default function CustomerGuidePage() {
  return (
    <div style={{ background: "#f3f4f6", minHeight: "100vh", padding: 24, display: "flex", justifyContent: "center", fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 720, background: "#fff", borderRadius: 14, padding: 32, color: "#1f2937" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, borderBottom: `3px solid ${navy}`, paddingBottom: 16, marginBottom: 22 }}>
          <img src="/logo.png" alt="Logo" width={52} height={52} style={{ objectFit: "contain" }} />
          <div>
            <div style={{ fontSize: 19, fontWeight: 900, color: gold, letterSpacing: 0.6 }}>PT ALYSSA AUTO LOGISTIK</div>
            <div style={{ fontSize: 11, color: gray, marginTop: 2 }}>Solusi Transportasi &amp; Logistik Kendaraan</div>
            <div style={{ display: "inline-block", marginTop: 8, fontSize: 11, fontWeight: 800, color: navy, background: "#eff6ff", borderRadius: 4, padding: "3px 10px", letterSpacing: 0.4 }}>
              PANDUAN PENGIRIMAN KENDARAAN
            </div>
          </div>
        </div>

        <div style={{ fontSize: 13.5, color: gray, lineHeight: 1.7, marginBottom: 26 }}>
          Terima kasih sudah mempercayakan pengiriman kendaraan Anda kepada kami. Berikut tahapan yang perlu Anda ketahui, dari sebelum kendaraan dijemput sampai serah terima selesai.
        </div>

        {/* Steps */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {STEPS.map((step, i) => (
            <div key={i} style={{ border: `1px solid ${border}`, borderRadius: 12, padding: "18px 20px", display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ minWidth: 40, height: 40, borderRadius: "50%", background: navy, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 17, flexShrink: 0 }}>
                {i + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>{step.icon}</span>
                  <span style={{ fontWeight: 800, fontSize: 14.5, color: "#1f2937" }}>{step.title}</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
                  {step.items.map((it, j) => (
                    <li key={j} style={{ fontSize: 12.8, color: gray, lineHeight: 1.6 }}>{it}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 26, background: "#eff6ff", borderRadius: 8, padding: 14, fontSize: 12, color: "#374151", display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span>📞</span>
          <span>Butuh bantuan atau ada pertanyaan seputar pengiriman? Hubungi kami di <strong>0818 631 135</strong>.</span>
        </div>
        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: gray }}>Terima kasih atas kepercayaan Anda kepada PT Alyssa Auto Logistik.</div>
      </div>
    </div>
  );
}
