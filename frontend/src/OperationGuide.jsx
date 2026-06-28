import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "@/App.css";
import "@/Driver.css";
import "@/Guide.css";

/* ============================================================
   Tutorial Operasional v1.0
   3 kategori (Driver, Admin, Customer), 18 cards total
   ============================================================ */

const CATEGORIES = [
  {
    key: "driver",
    label: "Driver",
    icon: "🚛",
    color: "gold",
    cards: [
      {
        icon: "🔑",
        title: "Login Driver",
        steps: [
          "Buka link WhatsApp yang dikirim admin",
          "Format link: alyssalogistik.co.id/?trip=...&driver=...&nopol=...",
          "Tidak perlu password — langsung masuk ke dashboard driver",
          "Pastikan GPS HP aktif (Pengaturan → Lokasi → On)",
        ],
        tip: "Simpan link di kontak WhatsApp biar gampang dibuka lagi.",
      },
      {
        icon: "🚀",
        title: "Mulai Perjalanan",
        steps: [
          "Baca SOP dengan teliti, klik 'Sudah Dibaca' setelah selesai",
          "Upload 5 foto wajib (Depan, Belakang, Kiri, Kanan, Dashboard)",
          "Pastikan foto jelas, terang, dan nomor polisi terlihat",
          "Setelah semua foto upload → siap berangkat",
        ],
        tip: "Foto awal jadi bukti kondisi kendaraan sebelum berangkat.",
      },
      {
        icon: "📍",
        title: "Tambah Checkpoint Harian",
        steps: [
          "Setiap hari, buka link driver di HP",
          "Klik 'Upload Foto Checkpoint Hari Ini'",
          "Ambil foto kendaraan dengan latar lokasi terlihat",
          "Pilih status: Berangkat / CP1 / CP2 / CP3 / Tiba Tujuan",
          "Tambahkan keterangan (opsional, max 300 huruf)",
          "Klik Simpan — GPS otomatis tercatat",
        ],
        tip: "Wajib upload minimal 1× sehari sebelum jam 06:00 WIB esoknya.",
      },
      {
        icon: "📷",
        title: "Upload Foto Album per Tahap",
        steps: [
          "Album dibagi 4 tahap: Asal, Dalam Kapal, Tujuan, Dokumen",
          "Klik tab tahap yang sesuai dengan lokasi sekarang",
          "Klik 'Tambah Foto' → pilih dari galeri atau ambil langsung",
          "Beri caption singkat (opsional)",
        ],
        tip: "Album bantu customer lihat progres perjalanan secara visual.",
      },
      {
        icon: "🏁",
        title: "Selesaikan Perjalanan",
        steps: [
          "Setelah sampai tujuan, pilih status 'Tiba Tujuan' di checkpoint",
          "Upload foto serah terima di tab 'Tujuan'",
          "Hubungi admin untuk proses BASTK + tanda tangan customer",
        ],
        tip: "Status 'Tiba Tujuan' otomatis trigger PoD card untuk customer.",
      },
      {
        icon: "📄",
        title: "Cek Proof of Delivery (PoD)",
        steps: [
          "Buka link driver — scroll ke bagian 'Riwayat Checkpoint'",
          "Klik 'Download PDF' pada checkpoint manapun untuk simpan bukti",
          "PoD bisa dipakai sebagai dokumentasi pengantaran",
        ],
        tip: "Customer juga bisa download PoD lewat link tracking mereka.",
      },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    icon: "👨‍💼",
    color: "blue",
    cards: [
      {
        icon: "📋",
        title: "Buka Admin Dashboard",
        steps: [
          "Buka link: alyssalogistik.co.id/?admin=1",
          "Masukkan PIN admin (default 345374 — wajib ganti pre-launch)",
          "Klik 'Masuk' — PIN tersimpan otomatis di browser",
          "Logout via tombol di pojok kanan atas",
        ],
        tip: "PIN bisa diganti di backend/.env oleh tim IT.",
      },
      {
        icon: "📝",
        title: "Buat Order Customer (Manual)",
        steps: [
          "Customer biasanya isi sendiri lewat /?order=1",
          "Kalau perlu input manual (telpon/walk-in), buka link order form",
          "Isi 4 step: Kendaraan, Asal, Tujuan, Data Pemesan",
          "Submit — order otomatis muncul di dashboard admin dengan status NEW",
        ],
        tip: "Order ID format: ORD-XXXXXXXXXX (10 karakter random).",
      },
      {
        icon: "🚚",
        title: "Assign Driver (Konversi → Trip)",
        steps: [
          "Cari order status 'Baru' di dashboard",
          "Klik tombol gold '🚚 Konversi → Trip'",
          "Isi Driver ID (cth: DRV-001), UJ, T1, T2, T3, bonus",
          "Klik 'Konversi Sekarang' — trip baru otomatis dibuat",
          "Status order berubah jadi DISPATCHED",
        ],
        tip: "Link driver + link customer otomatis aktif setelah konversi.",
      },
      {
        icon: "🛰️",
        title: "Monitor Live Tracking",
        steps: [
          "Klik tombol 'Track' pada order yang sudah DISPATCHED",
          "Akan terbuka halaman customer tracking (read-only)",
          "Lihat: status, checkpoint terakhir, GPS, album foto",
          "Refresh manual untuk update data terbaru",
        ],
        tip: "Tracking link bisa di-copy & kirim ke customer langsung.",
      },
      {
        icon: "📥",
        title: "Download PoD PDF",
        steps: [
          "Buka tracking link customer (tombol 'Track' di dashboard)",
          "Scroll ke kartu 'Proof of Delivery'",
          "Klik 'Download PDF' — file PoD A4 langsung tersimpan",
          "Bisa langsung dicetak atau diteruskan ke customer",
        ],
        tip: "PoD include status + lokasi GPS + keterangan + signatur.",
      },
      {
        icon: "📄",
        title: "Download BASTK PDF",
        steps: [
          "Klik tombol 'BASTK' di order card",
          "Isi tipe kendaraan, tandai kerusakan di sketsa SVG (klik area)",
          "Isi data pelanggan (nama, HP, alamat, PIC, warna, tahun, km)",
          "Driver & Customer tanda tangan di canvas",
          "Klik '⬇ Download PDF A4' — file print-ready siap",
        ],
        tip: "BASTK PDF bawa QR — scan langsung buka link tracking.",
      },
      {
        icon: "📊",
        title: "Export CSV Laporan Bulanan",
        steps: [
          "Di admin dashboard, set filter DARI dan SAMPAI sesuai bulan",
          "Filter tambahan (opsional): status, search kota/customer",
          "Klik '📥 Export CSV' di pojok kanan atas",
          "File alyssa-orders-YYYYMMDD.csv siap dibuka di Excel",
        ],
        tip: "CSV UTF-8 BOM — emoji & karakter Indonesia tampil normal.",
      },
      {
        icon: "✅",
        title: "Verifikasi Status Delivered",
        steps: [
          "Setelah customer terima kendaraan, klik 'Mark Delivered'",
          "Status order otomatis berubah jadi DELIVERED (chip hijau)",
          "BASTK & PoD sudah lengkap → siap arsip",
          "Untuk batal: klik 'Batal' — confirm dialog → status CANCELLED",
        ],
        tip: "Order DELIVERED tidak bisa di-undo. Pastikan dokumen lengkap dulu.",
      },
    ],
  },
  {
    key: "customer",
    label: "Customer",
    icon: "👨‍💻",
    color: "blue-soft",
    cards: [
      {
        icon: "🔗",
        title: "Buka Link Tracking",
        steps: [
          "Admin akan kirim link tracking via WhatsApp/email",
          "Format: alyssalogistik.co.id/?track=TRIP-XXXX",
          "Buka di browser HP/laptop — tanpa login",
          "Bookmark link untuk akses cepat",
        ],
        tip: "Link aman karena pakai trip_id unik sebagai kunci.",
      },
      {
        icon: "📍",
        title: "Lihat Posisi Kendaraan",
        steps: [
          "Halaman tracking tampilkan status terkini",
          "Indikator: Berangkat / CP1 / CP2 / CP3 / Tiba Tujuan",
          "Lokasi GPS terakhir tampil di peta",
          "Refresh halaman untuk update terbaru",
        ],
        tip: "Update biasanya setiap hari — minimal 1× pagi sebelum jam 06:00.",
      },
      {
        icon: "📸",
        title: "Lihat Checkpoint & Album Foto",
        steps: [
          "Scroll ke bagian 'Riwayat Checkpoint' untuk timeline harian",
          "Klik foto untuk lihat ukuran penuh",
          "Album dibagi 4 tahap: Asal, Dalam Kapal, Tujuan, Dokumen",
          "Foto driver upload langsung tampil setelah refresh",
        ],
        tip: "Semua foto tersimpan permanent — bisa diakses kapan saja.",
      },
      {
        icon: "⬇",
        title: "Download Proof of Delivery (PoD)",
        steps: [
          "Setelah status 'Tiba Tujuan', kartu PoD muncul di halaman",
          "Klik tombol 'Download PDF'",
          "File PoD A4 langsung tersimpan di HP/laptop",
          "Bisa dicetak atau dipakai sebagai dokumentasi internal",
        ],
        tip: "PoD bawa status + lokasi GPS + foto + signature driver.",
      },
      {
        icon: "📲",
        title: "Scan QR di BASTK PDF",
        steps: [
          "Admin akan kirim BASTK PDF setelah serah terima",
          "Buka PDF, lihat QR code di bagian 'Verifikasi & Tracking Real-Time'",
          "Scan QR pakai kamera HP / aplikasi QR scanner",
          "Otomatis buka link tracking real-time",
        ],
        tip: "QR code = bukti keaslian dokumen + akses tracking dari kertas.",
      },
    ],
  },
];


export default function OperationGuide() {
  const [category, setCategory] = useState("driver");
  const [idx, setIdx] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const cat = useMemo(() => CATEGORIES.find((c) => c.key === category), [category]);
  const card = cat.cards[idx];
  const total = cat.cards.length;
  const progressPct = Math.round(((idx + 1) / total) * 100);

  const switchCat = (k) => { setCategory(k); setIdx(0); };
  const next = () => { if (idx < total - 1) setIdx(idx + 1); };
  const prev = () => { if (idx > 0)         setIdx(idx - 1); };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const node = document.getElementById("guide-print");
      // Make all cards visible (override the single-card state for capture)
      node.classList.add("guide-print-mode");
      // Force layout
      await new Promise((r) => setTimeout(r, 200));

      const canvas = await html2canvas(node, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#0A1628",
        windowWidth: node.scrollWidth,
        windowHeight: node.scrollHeight,
      });

      const img = canvas.toDataURL("image/jpeg", 0.92);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let heightLeft = imgH;
      let position = 0;
      pdf.addImage(img, "JPEG", 0, position, pageW, imgH, undefined, "FAST");
      heightLeft -= pageH;
      while (heightLeft > 0) {
        position = heightLeft - imgH;
        pdf.addPage();
        pdf.addImage(img, "JPEG", 0, position, pageW, imgH, undefined, "FAST");
        heightLeft -= pageH;
      }
      pdf.save(`Tutorial-Operasional-Alyssa-v1.0.pdf`);

      node.classList.remove("guide-print-mode");
    } catch (e) {
      alert("Gagal generate PDF: " + (e?.message || "error"));
    } finally { setDownloading(false); }
  };

  return (
    <div className="gd-root" data-testid="gd-root">
      <header className="gd-header">
        <div className="gd-brand">
          <div className="gd-brand-logo">
            <svg viewBox="0 0 80 80" width="40" height="40">
              <ellipse cx="40" cy="62" rx="22" ry="6" fill="#0F5132"/>
              <rect x="39" y="20" width="2" height="42" fill="#D4A847"/>
              <path d="M41,18 L62,25 L41,34 Z" fill="#DC2626"/>
            </svg>
          </div>
          <div>
            <div className="gd-brand-name">Tutorial Operasional</div>
            <div className="gd-brand-tag">PT Alyssa Auto Logistik · v1.0</div>
          </div>
        </div>
        <button
          className="gd-btn gd-btn-gold gd-btn-sm"
          onClick={downloadPdf}
          disabled={downloading}
          data-testid="gd-download-pdf"
        >
          {downloading ? "Membuat PDF..." : "⬇ PDF A4"}
        </button>
      </header>

      {/* Category tabs */}
      <nav className="gd-tabs" data-testid="gd-tabs">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            className={`gd-tab ${category === c.key ? "active" : ""}`}
            onClick={() => switchCat(c.key)}
            data-testid={`gd-tab-${c.key}`}
          >
            <span className="gd-tab-icon">{c.icon}</span>
            <span className="gd-tab-label">{c.label}</span>
            <span className="gd-tab-count">{c.cards.length}</span>
          </button>
        ))}
      </nav>

      {/* Progress bar */}
      <div className="gd-progress" data-testid="gd-progress">
        <div className="gd-progress-bar" style={{ width: `${progressPct}%` }} />
        <span className="gd-progress-text">
          Langkah {idx + 1} dari {total}
        </span>
      </div>

      {/* Active card (single-card view for onboarding feel) */}
      <main className="gd-stage">
        <article className="gd-card" key={`${category}-${idx}`} data-testid={`gd-card-${category}-${idx}`}>
          <div className="gd-card-num">{String(idx + 1).padStart(2, "0")}</div>
          <div className="gd-card-icon">{card.icon}</div>
          <h2 className="gd-card-title">{card.title}</h2>
          <ol className="gd-card-steps">
            {card.steps.map((step, i) => (
              <li key={i}>
                <span className="gd-step-bullet">{i + 1}</span>
                <span className="gd-step-text">{step}</span>
              </li>
            ))}
          </ol>
          {card.tip && (
            <div className="gd-card-tip">
              <span className="gd-tip-icon">💡</span>
              <span className="gd-tip-text">{card.tip}</span>
            </div>
          )}
        </article>
      </main>

      {/* Nav */}
      <div className="gd-nav">
        <button
          className="gd-btn gd-btn-ghost"
          onClick={prev}
          disabled={idx === 0}
          data-testid="gd-prev"
        >← Sebelumnya</button>

        <div className="gd-dots">
          {cat.cards.map((_, i) => (
            <span
              key={i}
              className={`gd-dot ${i === idx ? "active" : ""} ${i < idx ? "done" : ""}`}
              onClick={() => setIdx(i)}
              data-testid={`gd-dot-${i}`}
            />
          ))}
        </div>

        <button
          className="gd-btn gd-btn-gold"
          onClick={next}
          disabled={idx === total - 1}
          data-testid="gd-next"
        >Berikutnya →</button>
      </div>

      {/* Hidden print-mode container (renders ALL cards for PDF) */}
      <div id="guide-print" className="gd-print-container" aria-hidden="true">
        <div className="gd-print-header">
          <h1>📘 Tutorial Operasional · PT Alyssa Auto Logistik</h1>
          <p>Panduan lengkap untuk Driver, Admin, dan Customer · v1.0</p>
        </div>
        {CATEGORIES.map((c) => (
          <section key={c.key} className="gd-print-section">
            <h2 className={`gd-print-cat gd-print-cat-${c.color}`}>
              <span>{c.icon}</span> {c.label.toUpperCase()}
            </h2>
            <div className="gd-print-cards">
              {c.cards.map((card, i) => (
                <div key={i} className="gd-print-card">
                  <div className="gd-print-card-head">
                    <span className="gd-print-num">{String(i + 1).padStart(2, "0")}</span>
                    <span className="gd-print-icon">{card.icon}</span>
                    <span className="gd-print-title">{card.title}</span>
                  </div>
                  <ol className="gd-print-steps">
                    {card.steps.map((step, si) => (
                      <li key={si}>{step}</li>
                    ))}
                  </ol>
                  {card.tip && (
                    <div className="gd-print-tip">💡 {card.tip}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
        <footer className="gd-print-footer">
          PT Alyssa Auto Logistik · alyssalogistik.co.id · 0818 631 135
          · Cetak A4 · {new Date().toLocaleDateString("id-ID", {day:"2-digit",month:"long",year:"numeric"})}
        </footer>
      </div>
    </div>
  );
}
