import { useId, useState } from "react";
import { CATEGORY } from "./categoryColors";

/*
  Shareable Summary Card: ringkasan satu pesanan yang enak di-screenshot / dibagikan.
  Tema CERAH, BERSIH, TAJAM: dasar putih, aksen biru laut menyala, teks navy pekat,
  badge status cerah, progres bergradasi biru laut -> ungu neon.

  Murni presentasi (tanpa fetch). Nilai kosong tidak ditampilkan.
    status      : "NEW" | "DISPATCHED" | "ON_TRIP" | "DELIVERED" | "CANCELLED"
    stage       : 0..3 (Baru, Driver Berangkat, Kapal, Sampai & Dokumen)
    stageLabels : opsional, 4 label (mis. tanpa kapal: "Kapal" jadi "Perjalanan")
    open/onOpenChange : kontrol dari luar (opsional); kalau tidak diisi, kartu mengatur dirinya sendiri.
  Bagian atas (logo, nomor PO, status, rute) selalu terlihat; rincian dan progres bisa dibuka-tutup.
*/

export const DEFAULT_STAGE_LABELS = ["Baru", "Driver Berangkat", "Kapal", "Sampai & Dokumen"];
const STAGE_BY_STATUS = { NEW: 0, DISPATCHED: 1, ON_TRIP: 2, DELIVERED: 3 };

const BADGES = {
  NEW:        { text: "BARU",       cls: "bg-sky-50 text-sky-800 ring-1 ring-sky-300", dot: "bg-sky-500" },
  DISPATCHED: { text: "DISPATCHED", cls: "bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.55)]", dot: "bg-white" },
  ON_TRIP:    { text: "ON-TRIP",    cls: "bg-lime-400 text-lime-950 shadow-[0_0_16px_rgba(163,230,53,0.75)]", dot: "bg-lime-950" },
  DELIVERED:  { text: "SAMPAI",     cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300", dot: "bg-emerald-500" },
  CANCELLED:  { text: "BATAL",      cls: "bg-rose-50 text-rose-800 ring-1 ring-rose-300", dot: "bg-rose-500" },
};

function IcoArrow() {
  return (
    <svg className="h-6 w-full text-cyan-500" viewBox="0 0 120 24" fill="none" aria-hidden="true" preserveAspectRatio="none">
      <path d="M2 12h104" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M96 3l18 9-18 9" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IcoChevron({ open }) {
  return (
    <svg className={`h-5 w-5 transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IcoCheck() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  );
}

function Cell({ label, value, wide }) {
  return (
    <div className={`bg-white px-3.5 py-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold leading-snug text-slate-950">{value}</dd>
    </div>
  );
}

export default function ShareableSummaryCard({
  nomorPo, nopol, unit, customer, asal, tujuan, status = "NEW", stage, stageLabels,
  driver, kapal, jadwal, diperbarui, kategori,
  defaultOpen = true, open: openProp, onOpenChange,
}) {
  const [openState, setOpenState] = useState(defaultOpen);
  const controlled = typeof openProp === "boolean";
  const open = controlled ? openProp : openState;
  const toggle = () => {
    const next = !open;
    if (!controlled) setOpenState(next);
    if (onOpenChange) onOpenChange(next);
  };
  const panelId = useId();
  const cat = CATEGORY[kategori] || null;   // "penjualan" | "pembelian" | "biaya"
  const badge = BADGES[status] || BADGES.NEW;
  const labels = Array.isArray(stageLabels) && stageLabels.length === 4 ? stageLabels : DEFAULT_STAGE_LABELS;
  const cur = Math.max(0, Math.min(3, Number.isInteger(stage) ? stage : (STAGE_BY_STATUS[status] ?? 0)));
  const pct = cur / 3;

  const cells = [
    ["Pelanggan", customer, true],
    ["Unit Kendaraan", unit, false],
    ["Nomor Polisi", nopol, false],
    ["Driver", driver, false],
    ["Kapal", kapal, false],
    ["Jadwal", jadwal, false],
  ].filter(([, v]) => v);

  return (
    <section
      className="w-full overflow-hidden rounded-2xl border border-sky-300 bg-white font-sans text-slate-950 shadow-[0_10px_30px_-14px_rgba(14,165,233,0.45)]"
      data-testid="summary-card"
    >
      {/* Kepala: logo, nomor PO, status, tombol. Selalu terlihat. */}
      <header className="bg-gradient-to-b from-sky-50/80 to-white px-4 pb-3 pt-3">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="" crossOrigin="anonymous" className="h-9 w-9 flex-none rounded-lg object-contain" />
          <p className="min-w-0 flex-1 text-xs font-extrabold uppercase leading-tight tracking-[0.14em] text-cyan-700">PT Alyssa Auto Logistik</p>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Tutup rincian pesanan" : "Buka rincian pesanan"}
            data-html2canvas-ignore="true"
            data-testid="summary-toggle"
            className="grid h-10 w-10 flex-none place-items-center rounded-full border border-sky-200 bg-white text-sky-600 transition hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
          >
            <IcoChevron open={open} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Nomor PO</p>
              {cat ? (
                <span className={`inline-block rounded-full px-2 py-1 text-[10px] font-extrabold uppercase leading-none tracking-wider ${cat.chip}`} data-testid="summary-category" data-category={cat.key}>{cat.label}</span>
              ) : null}
            </div>
            <h3 className="break-all text-xl font-extrabold leading-tight tracking-tight text-slate-950" data-testid="summary-po">{nomorPo || nopol || "-"}</h3>
          </div>
          <span className={`relative inline-block flex-none whitespace-nowrap rounded-full py-2 pl-7 pr-3 text-xs font-extrabold leading-none tracking-wide ${badge.cls}`} data-testid="summary-badge">
            <span className={`absolute left-3 top-1/2 -mt-1 h-2 w-2 rounded-full ${badge.dot}`} aria-hidden="true" />
            {badge.text}
          </span>
        </div>
      </header>

      {/* Rute: besar dan tegas, ikut terlihat saat ringkasan ditutup. */}
      {(asal || tujuan) ? (
        <div className="border-t border-sky-100 px-4 py-4" data-testid="summary-route">
          <div className="grid grid-cols-[minmax(0,0.85fr)_2rem_minmax(0,1.15fr)] items-center gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Asal</p>
              <p className="text-lg font-black uppercase leading-tight tracking-tight text-slate-950 [overflow-wrap:break-word]">{asal || "-"}</p>
            </div>
            <div className="w-8"><IcoArrow /></div>
            <div className="min-w-0 text-right">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tujuan</p>
              <p className="text-lg font-black uppercase leading-tight tracking-tight text-slate-950 [overflow-wrap:break-word]">{tujuan || "-"}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Rincian + progres: bisa dibuka-tutup (grid-rows 0fr -> 1fr = animasi tinggi tanpa JS) */}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-5 border-t border-sky-100 p-4" aria-hidden={!open}>
            {cells.length ? (
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-sky-100 bg-sky-100" data-testid="summary-details">
                {cells.map(([k, v, wide]) => <Cell key={k} label={k} value={v} wide={wide} />)}
                {/* jumlah kolom ganjil -> isi petak kosong supaya tidak tampak kotak biru */}
                {cells.reduce((n, [, , wide]) => n + (wide ? 2 : 1), 0) % 2 === 1 ? <div className="bg-white" aria-hidden="true" /> : null}
              </dl>
            ) : null}

            <div data-testid="summary-progress">
              <ol className="relative grid grid-cols-4" aria-label="Tahap pengiriman">
                <span className="absolute left-[12.5%] right-[12.5%] top-[15px] h-1.5 rounded-full bg-slate-200" aria-hidden="true" />
                {pct > 0 ? (
                  <span
                    className="absolute left-[12.5%] top-[15px] h-1.5 rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 shadow-[0_0_10px_rgba(99,102,241,0.55)]"
                    style={{ width: `${pct * 75}%`, backgroundSize: `${100 / pct}% 100%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {labels.map((label, i) => {
                  const done = i < cur;
                  const now = i === cur;
                  return (
                    <li key={`${i}-${label}`} className="relative flex flex-col items-center gap-2 text-center" aria-current={now ? "step" : undefined}>
                      {now ? (
                        <span className="relative z-10 -m-1 rounded-full bg-cyan-200 p-1" aria-hidden="false">
                          <span className="grid h-8 w-8 place-items-center rounded-full border-[3px] border-cyan-400 bg-white text-xs font-extrabold leading-none text-purple-700">{i + 1}</span>
                        </span>
                      ) : (
                        <span
                          className={[
                            "relative z-10 grid h-8 w-8 place-items-center rounded-full text-xs font-extrabold leading-none",
                            done ? "bg-gradient-to-br from-cyan-400 to-purple-500 text-white" : "border-2 border-slate-300 bg-white text-slate-500",
                          ].join(" ")}
                        >
                          {done ? <IcoCheck /> : i + 1}
                        </span>
                      )}
                      <span className={`text-xs leading-tight ${now ? "font-extrabold text-slate-950" : done ? "font-semibold text-slate-700" : "font-medium text-slate-500"}`}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {diperbarui ? (
              <p className="border-t border-sky-100 pt-3 text-right text-xs font-semibold text-slate-500">Diperbarui {diperbarui}</p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
