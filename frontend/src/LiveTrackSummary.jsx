/*
  Dock ringkasan Live Track (kompak, satu layar tanpa tab):
    [ NOPOL ............ (status pill) ]
    [ Kendaraan & Rute |  Checkpoint Driver ]
  Murni presentasi: semua data datang lewat props, tidak ada fetch / state.
  Nilai yang tidak diketahui tampil "—" (tidak dikarang).
*/
import "./LiveTrackSummary.css";

const DASH = "—";

function Item({ k, v, mono }) {
  const empty = v === null || v === undefined || v === "";
  return (
    <div className="lts-item">
      <span className="lts-k">{k}</span>
      <span className={`lts-v${mono ? " mono" : ""}${empty ? " empty" : ""}`}>{empty ? DASH : v}</span>
    </div>
  );
}

export default function LiveTrackSummary({
  nopol, driver, route, tipe, status, tone = "gray", done = false,
  speed, heading, lat, lon, cp, onOpenPhoto, onSelectCp, ship,
}) {
  const coord = lat != null && lon != null
    ? `${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}` : "";
  const spd = speed != null && speed !== "" ? `${speed} kn` : "";
  const hdg = heading != null && heading !== "" ? `${Math.round(heading)}°` : "";

  return (
    <section className="lts" data-testid="trk-vehicle">
      {/* Baris identitas + status */}
      <div className="lts-top">
        <div className="lts-id">
          <span className="lts-label">NOMOR POLISI</span>
          <b className="lts-nopol" data-testid="trk-nopol">{nopol || DASH}</b>
          {driver ? <span className="lts-driver">{driver}</span> : null}
        </div>
        <span className={`lts-pill lts-${tone}`} data-testid="lts-status">
          {done ? "✓" : <i className="lts-dot" />}
          {status}
        </span>
      </div>

      {/* Unit sedang di leg kapal + ada posisi AIS: tonjolkan kapalnya, 1 ketukan ke layar posisi */}
      {ship ? (
        <button type="button" className="lts-ship" onClick={ship.onOpen} data-testid="lts-ship">
          <span className="lts-ship-ic" aria-hidden="true">🚢</span>
          <span className="lts-ship-t">
            <small>{ship.atPort ? "Kapal masih di pelabuhan" : "Unit sedang di atas kapal"}</small>
            <b>{ship.name}</b>
          </span>
          <span className="lts-ship-go">Lihat Posisi ›</span>
        </button>
      ) : null}

      <div className="lts-grid">
        {/* Kiri: kendaraan & rute */}
        <div className="lts-card" data-testid="lts-vehicle">
          <h4>Kendaraan &amp; Rute</h4>
          <Item k="Rute" v={route} />
          <Item k="Tipe" v={tipe} />
          <Item k="Speed" v={spd} />
          <Item k="Heading" v={hdg} />
          <Item k="Koordinat" v={coord} mono />
        </div>

        {/* Kanan: checkpoint driver terakhir */}
        <div className="lts-card" data-testid="lts-cp">
          <h4>Checkpoint Driver{cp ? <em>CP-{cp.num}</em> : null}</h4>
          {cp ? (
            <>
              <Item k="Lokasi" v={cp.loc} />
              <Item k="Status" v={cp.status} />
              <Item k="Waktu" v={cp.time} />
              {cp.url ? (
                <button type="button" className="lts-thumb" onClick={() => onOpenPhoto && onOpenPhoto(cp)} aria-label="Buka foto checkpoint">
                  <img src={cp.url} alt={`Foto CP-${cp.num}`} loading="lazy" />
                </button>
              ) : (
                <div className="lts-nophoto">Tanpa foto</div>
              )}
              {onSelectCp ? <button type="button" className="lts-link" onClick={() => onSelectCp(cp)}>Lihat di peta</button> : null}
            </>
          ) : (
            <div className="lts-nophoto">Belum ada checkpoint</div>
          )}
        </div>
      </div>
    </section>
  );
}
