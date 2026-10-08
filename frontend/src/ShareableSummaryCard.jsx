import { useId, useState } from "react";

/*
  Shareable Summary Card: kartu ringkasan pengiriman yang enak di-screenshot / dibagikan.
  Tema CERAH, BERSIH, TAJAM: dasar putih, aksen biru laut menyala, teks navy pekat,
  badge status cerah, progres bergradasi biru laut -> ungu neon, pembungkus
  buka-tutup dengan border biru muda tajam.

  Murni presentasi (tanpa fetch). Semua data lewat props; nilai kosong tidak ditampilkan.
    status : "NEW" | "DISPATCHED" | "ON_TRIP" | "DELIVERED"
    stage  : 0..3 (Baru, Driver Berangkat, Kapal, Sampai & Dokumen). Kosong -> diturunkan dari status.
*/

const STAGES = ["Baru", "Driver Berangkat", "Kapal", "Sampai & Dokumen"];
const STAGE_BY_STATUS = { NEW: 0, DISPATCHED: 1, ON_TRIP: 2, DELIVERED: 3 };

const BADGES = {
  NEW:        { text: "BARU",       cls: "bg-sky-50 text-sky-800 ring-1 ring-sky-300", dot: "bg-sky-500" },
  DISPATCHED: { text: "DISPATCHED", cls: "bg-violet-600 text-white shadow-[0_0_16px_rgba(139,92,246,0.55)]", dot: "bg-white" },
  ON_TRIP:    { text: "ON-TRIP",    cls: "bg-lime-400 text-lime-950 shadow-[0_0_16px_rgba(163,230,53,0.75)]", dot: "bg-lime-950" },
  DELIVERED:  { text: "SAMPAI",     cls: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-300", dot: "bg-emerald-500" },
};

function IcoShip() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 17c1.2 1.2 2.4 1.2 3.6 0s2.4-1.2 3.6 0 2.4 1.2 3.6 0 2.4-1.2 3.6 0 2.4 1.2 3.6 0" />
      <path d="M5 14l1.5-5h11L19 14" />
      <path d="M12 9V4h3" />
    </svg>
  );
}

function IcoArrow() {
  return (
    <svg className="h-6 w-full min-w-[56px] text-cyan-500 drop-shadow-[0_0_6px_rgba(34,211,238,0.7)]" viewBox="0 0 120 24" fill="none" aria-hidden="true" preserveAspectRatio="none">
      <path d="M2 12h104" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
      <path d="M98 4l16 8-16 8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
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

export default function ShareableSummaryCard({
  nopol, unit, asal, tujuan, status = "NEW", stage, driver, kapal, jadwal, nomorOrder, diperbarui,
  defaultOpen = true,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const badge = BADGES[status] || BADGES.NEW;
  const cur = Math.max(0, Math.min(STAGES.length - 1, Number.isInteger(stage) ? stage : (STAGE_BY_STATUS[status] ?? 0)));
  const pct = cur / (STAGES.length - 1);

  const rows = [
    ["Driver", driver], ["Kapal", kapal], ["Jadwal", jadwal], ["No. Order", nomorOrder],
  ].filter(([, v]) => v);

  return (
    <section
      className="w-full max-w-md overflow-hidden rounded-2xl border border-sky-300 bg-white font-sans text-slate-950 shadow-[0_10px_30px_-14px_rgba(14,165,233,0.45)]"
      data-testid="summary-card"
    >
      {/* Kepala: selalu terlihat. Baris 1: label + status + tombol. Baris 2: nopol utuh (tidak dipotong). */}
      <header className="bg-gradient-to-b from-sky-50/80 to-white px-4 pb-4 pt-3">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-cyan-50 text-cyan-600 ring-1 ring-cyan-200" aria-hidden="true">
            <IcoShip />
          </span>
          <p className="min-w-0 flex-1 text-xs font-bold uppercase leading-tight tracking-[0.14em] text-cyan-700">Ringkasan Pengiriman</p>
          <span className={`inline-flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold tracking-wide ${badge.cls}`} data-testid="summary-badge">
            <span className={`h-2 w-2 rounded-full ${badge.dot}`} aria-hidden="true" />
            {badge.text}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Tutup rincian pengiriman" : "Buka rincian pengiriman"}
            data-testid="summary-toggle"
            className="grid h-10 w-10 flex-none place-items-center rounded-full border border-sky-200 bg-white text-sky-600 transition hover:bg-sky-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-500"
          >
            <IcoChevron open={open} />
          </button>
        </div>
        <h3 className="mt-3 break-words text-3xl font-extrabold leading-tight tracking-tight text-slate-950" data-testid="summary-nopol">{nopol || "-"}</h3>
        {unit ? <p className="mt-0.5 break-words text-sm font-medium text-slate-600">{unit}</p> : null}
      </header>

      {/* Isi yang bisa dibuka-tutup (grid-rows 0fr -> 1fr = animasi tinggi tanpa JS) */}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="overflow-hidden">
          <div className="space-y-5 border-t border-sky-100 p-4" aria-hidden={!open}>
            {/* Rute */}
            {(asal || tujuan) ? (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3" data-testid="summary-route">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Asal</p>
                  <p className="text-base font-extrabold leading-snug text-slate-950">{asal || "-"}</p>
                </div>
                <div className="w-20 sm:w-28"><IcoArrow /></div>
                <div className="min-w-0 text-right">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Tujuan</p>
                  <p className="text-base font-extrabold leading-snug text-slate-950">{tujuan || "-"}</p>
                </div>
              </div>
            ) : null}

            {/* Progres: gradasi biru laut -> ungu neon */}
            <div data-testid="summary-progress">
              <ol className="relative grid grid-cols-4" aria-label="Tahap pengiriman">
                <span className="absolute left-[12.5%] right-[12.5%] top-[15px] h-1.5 rounded-full bg-slate-200" aria-hidden="true" />
                {pct > 0 ? (
                  <span
                    className="absolute left-[12.5%] top-[15px] h-1.5 rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 shadow-[0_0_10px_rgba(99,102,241,0.55)]"
                    style={{ width: `${pct * 75}%`, backgroundSize: `${(100 / pct)}% 100%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {STAGES.map((label, i) => {
                  const done = i < cur;
                  const now = i === cur;
                  return (
                    <li key={label} className="relative flex flex-col items-center gap-2 text-center" aria-current={now ? "step" : undefined}>
                      <span
                        className={[
                          "relative z-10 grid h-8 w-8 place-items-center rounded-full text-xs font-extrabold",
                          done ? "bg-gradient-to-br from-cyan-400 to-purple-500 text-white" : "",
                          now ? "bg-white text-purple-700 ring-[3px] ring-cyan-400 shadow-[0_0_0_5px_rgba(34,211,238,0.22),0_0_18px_rgba(34,211,238,0.7)]" : "",
                          !done && !now ? "border-2 border-slate-300 bg-white text-slate-500" : "",
                        ].join(" ")}
                      >
                        {done ? <IcoCheck /> : i + 1}
                      </span>
                      <span className={`text-xs leading-tight ${now ? "font-extrabold text-slate-950" : done ? "font-semibold text-slate-700" : "font-medium text-slate-500"}`}>
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>

            {/* Rincian */}
            {rows.length ? (
              <dl className="divide-y divide-sky-100 rounded-xl border border-sky-100 bg-slate-50" data-testid="summary-details">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <dt className="text-sm font-medium text-slate-600">{k}</dt>
                    <dd className="text-right text-sm font-bold text-slate-950">{v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-sky-100 pt-3 text-xs font-semibold text-slate-500">
              <span className="font-extrabold tracking-wide text-cyan-700">PT ALYSSA AUTO LOGISTIK</span>
              {diperbarui ? <span>Diperbarui {diperbarui}</span> : null}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
