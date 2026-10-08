import { useRef, useState } from "react";
import ShareableSummaryCard from "./ShareableSummaryCard";

/*
  Pembungkus kartu ringkasan untuk halaman detail pesanan admin:
  kartu di dalam bingkai ~390 px (lebar layar HP, rasio pas untuk WhatsApp) + tombol
  "Download Gambar" dan "Bagikan". Kartu dibuka dulu otomatis saat diekspor supaya
  rincian dan progres ikut tertangkap, lalu dikembalikan ke keadaan semula.
  Gambar dibuat 3x (lebar 1170 px) agar tajam saat dibuka di HP.
*/
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export default function OrderSummaryShare({ card, fileName = "ringkasan-pesanan" }) {
  const frameRef = useRef(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState("");   // "" | "download" | "share"
  const [msg, setMsg] = useState("");

  const capture = async () => {
    const el = frameRef.current;
    if (!el) return null;
    const wasOpen = open;
    if (!wasOpen) { setOpen(true); await wait(380); }   // tunggu animasi buka selesai
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: "#F8FAFC", scale: 3, useCORS: true, logging: false });
      return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    } finally {
      if (!wasOpen) setOpen(false);
    }
  };

  const saveBlob = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${fileName}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const run = async (kind) => {
    setBusy(kind); setMsg("");
    try {
      const blob = await capture();
      if (!blob) throw new Error("kosong");
      if (kind === "share") {
        const file = new File([blob], `${fileName}.png`, { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: card.nomorPo || "Ringkasan pesanan" }); }
          catch (e) { if (e && e.name !== "AbortError") throw e; }
          return;
        }
        setMsg("Perangkat ini belum bisa membagikan gambar langsung, gambar diunduh.");
      }
      saveBlob(blob);
    } catch (e) {
      setMsg("Gagal membuat gambar. Coba lagi.");
    } finally { setBusy(""); }
  };

  const btn = "rounded-xl px-4 py-2.5 text-sm font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500 disabled:opacity-60";
  return (
    <div className="w-full" data-testid="order-summary-share">
      <div ref={frameRef} className="mx-auto w-full max-w-[390px] bg-slate-50 p-3" data-testid="summary-frame">
        <ShareableSummaryCard {...card} open={open} onOpenChange={setOpen} />
      </div>
      <div className="mx-auto mt-3 flex w-full max-w-[390px] flex-wrap items-center gap-2 px-3">
        <button type="button" disabled={!!busy} onClick={() => run("download")} className={`${btn} bg-cyan-500 text-white hover:bg-cyan-600`} data-testid="summary-download">
          {busy === "download" ? "Membuat gambar..." : "Download Gambar"}
        </button>
        <button type="button" disabled={!!busy} onClick={() => run("share")} className={`${btn} border border-sky-300 bg-white text-sky-700 hover:bg-sky-50`} data-testid="summary-share">
          {busy === "share" ? "Menyiapkan..." : "Bagikan"}
        </button>
        {msg ? <p className="w-full text-xs font-semibold text-slate-300" role="status">{msg}</p> : null}
      </div>
    </div>
  );
}
