import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import { LEG_STATE, normalizeLegs, legProgress, progressText } from "./legHistory";

const API = `${process.env.REACT_APP_BACKEND_URL || ""}/api`;
const POLL_MS = 10000;
const CLOSE_MS = 300;

/*
  History Leg: tombol kecil di kartu tracking + bottom sheet riwayat leg.
  Status tiap leg dibaca langsung dari data trip (modul Route Leg / driver):
  dimuat saat sheet dibuka, di-refresh tiap 10 detik selama terbuka dan saat tab kembali aktif,
  jadi perubahan Menunggu / Berlangsung / Selesai ikut muncul tanpa tutup-buka.
  Palet: cyan #24C8E8, biru #47BDF5, ungu #8A3FFC, garis #D9E1EA. Tanpa hijau/merah/kuning.
*/

const BADGE = {
  [LEG_STATE.DONE]:   { label: "Selesai",     dot: "bg-[#24C8E8]", pill: "bg-[#E7FAFD] text-[#0E7C93]", mark: "●" },
  [LEG_STATE.ACTIVE]: { label: "Berlangsung", dot: "bg-[#8A3FFC]", pill: "bg-[#F1EBFF] text-[#6D28D9]", mark: "●" },
  [LEG_STATE.WAIT]:   { label: "Menunggu",    dot: "bg-[#BFC8D4]", pill: "bg-[#F4F6F8] text-[#7B8794]", mark: "○" },
};

function useLiveLegs(tripId, open, fallbackLegs) {
  const [live, setLive] = useState(null);
  const [err, setErr] = useState(false);
  const fetchLegs = useCallback(() => {
    if (!tripId) return;
    axios.get(`${API}/public/trips/${tripId}`)
      .then((r) => { setLive(Array.isArray(r.data && r.data.legs) ? r.data.legs : []); setErr(false); })
      .catch(() => setErr(true));
  }, [tripId]);
  useEffect(() => {
    if (!open) return undefined;
    fetchLegs();
    const t = setInterval(fetchLegs, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible") fetchLegs(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [open, fetchLegs]);
  // data live menang kalau sudah ada; selama belum, pakai legs dari kartu
  const legs = live && live.length ? live : fallbackLegs;
  return { legs, err };
}

function Sheet({ tripId, order, onClose, shown }) {
  const { legs, err } = useLiveLegs(tripId, true, order && order.legs);
  const items = normalizeLegs(legs);
  const prog = legProgress(items);
  const [dragY, setDragY] = useState(0);
  const start = useRef(null);

  const onDown = (e) => { start.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (start.current != null) setDragY(Math.max(0, e.clientY - start.current)); };
  const onUp = () => {
    const far = dragY > 90;
    start.current = null; setDragY(0);
    if (far) onClose();
  };

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="history-leg-root">
      <div
        className={`absolute inset-0 bg-[#1F2937]/40 transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Riwayat Pengiriman"
        data-testid="history-leg-sheet"
        style={{ transform: shown ? `translateY(${dragY}px)` : "translateY(100%)", transition: dragY ? "none" : undefined }}
        className="absolute inset-x-0 bottom-0 mx-auto flex h-[80vh] w-full max-w-xl flex-col rounded-t-3xl border border-b-0 border-[#D9E1EA] bg-white text-[#1F2937] shadow-[0_-18px_50px_-18px_rgba(36,200,232,0.45)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        <div
          className="flex-none cursor-grab touch-none px-5 pb-2 pt-3 active:cursor-grabbing"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          <div className="mx-auto h-1.5 w-11 rounded-full bg-[#D9E1EA]" aria-hidden="true" />
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-extrabold leading-tight text-[#1F2937]">Riwayat Pengiriman</h2>
              <p className="truncate text-xs font-semibold text-[#7B8794]">{order && order.order_id}{order && order.customer_nama ? ` · ${order.customer_nama}` : ""}</p>
            </div>
            <button
              type="button" onClick={onClose} onPointerDown={(e) => e.stopPropagation()}
              aria-label="Tutup riwayat pengiriman" data-testid="history-leg-close"
              className="grid h-10 w-10 flex-none place-items-center rounded-full border border-[#D9E1EA] bg-white text-[#1F2937] hover:bg-[#F4F6F8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24C8E8]"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#D9E1EA] px-5 py-5">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm font-semibold text-[#7B8794]" data-testid="history-leg-empty">Belum ada leg untuk pesanan ini.</p>
          ) : (
            <ol className="m-0 list-none p-0" data-testid="history-leg-timeline">
              {items.map((it, i) => {
                const b = BADGE[it.state];
                const last = i === items.length - 1;
                return (
                  <li key={it.key} className="relative flex gap-3 pb-6 last:pb-0" data-state={it.state} data-testid={`history-leg-${it.no}`}>
                    {!last ? <span className="absolute bottom-0 left-[9px] top-5 w-px bg-[#D9E1EA]" aria-hidden="true" /> : null}
                    <span className="relative z-10 mt-1 grid h-5 w-5 flex-none place-items-center rounded-full bg-white">
                      <span className={`block h-3 w-3 rounded-full ${it.state === LEG_STATE.WAIT ? "border-2 border-[#BFC8D4] bg-white" : b.dot} ${it.state === LEG_STATE.ACTIVE ? "shadow-[0_0_0_4px_rgba(138,63,252,0.18)]" : ""}`} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-extrabold leading-none ${b.pill}`}>
                        {b.mark} Leg {it.no} {b.label}
                      </span>
                      <p className="mt-2 break-words text-[15px] font-bold leading-snug text-[#1F2937]">
                        {it.asal} <span className="font-black text-[#47BDF5]" aria-hidden="true">→</span> {it.tujuan}
                      </p>
                      {(it.tipe || it.kapal) ? <p className="mt-0.5 text-xs font-medium text-[#7B8794]">{[it.tipe, it.kapal].filter(Boolean).join(" · ")}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <footer className="flex-none border-t border-[#D9E1EA] bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4" data-testid="history-leg-footer">
          <p className="text-sm font-extrabold text-[#1F2937]" data-testid="history-leg-progress-text">{progressText(prog)}</p>
          <div
            className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-[#EEF2F6]"
            role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={prog.pct} aria-label="Progress pengiriman"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#24C8E8] to-[#8A3FFC] transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${prog.pct}%` }}
              data-testid="history-leg-bar"
            />
          </div>
          {err ? <p className="mt-2 text-[11px] font-semibold text-[#7B8794]">Koneksi terputus, menampilkan data terakhir.</p> : null}
        </footer>
      </section>
    </div>
  );
}

export default function HistoryLegButton({ order, className = "" }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const timer = useRef(null);

  const openSheet = (e) => {
    if (e) e.stopPropagation();
    clearTimeout(timer.current);
    setMounted(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
  };
  const closeSheet = useCallback(() => {
    setShown(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMounted(false), CLOSE_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!mounted) return undefined;
    const onKey = (e) => { if (e.key === "Escape") closeSheet(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [mounted, closeSheet]);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        aria-haspopup="dialog"
        data-testid={`history-leg-btn-${order.order_id}`}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#D9E1EA] bg-white px-3 py-1.5 text-xs font-bold leading-none text-[#1F2937] transition hover:border-[#24C8E8] hover:bg-[#E7FAFD] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#24C8E8] ${className}`}
      >
        History Leg
        <svg className="h-3.5 w-3.5 text-[#24C8E8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      {mounted ? createPortal(<Sheet tripId={order.trip_id} order={order} onClose={closeSheet} shown={shown} />, document.body) : null}
    </>
  );
}
