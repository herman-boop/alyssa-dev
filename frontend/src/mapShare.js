/*
  Gambar peta TAJAM untuk dikirim ke WhatsApp (bukan screenshot layar yang buram).
  Peta digambar ulang ke <canvas> beresolusi tinggi (>= 2x, tile ditarik satu zoom lebih rapat),
  lengkap dengan rute, penanda unit/kapal, dan judul. Hanya presentasi: tidak mengubah data apa pun.

  Dipakai oleh CustomerTracking. Fungsi murni (tanpa React); projeksi Web Mercator standar.
*/
import { MAP_TILE_URL, MAP_LABEL_URL, MAP_MAX_NATIVE_ZOOM } from "./mapTheme";

const TILE = 256;
const worldPx = (lat, lng, z) => {
  const s = TILE * Math.pow(2, z);
  const x = ((lng + 180) / 360) * s;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
  return [x, y];
};

const fillUrl = (tpl, z, x, y) => tpl.replace("{z}", z).replace("{x}", x).replace("{y}", y);

const loadImg = (src, timeoutMs = 12000) => new Promise((resolve) => {
  const im = new Image();
  im.crossOrigin = "anonymous";
  const t = setTimeout(() => resolve(null), timeoutMs);
  im.onload = () => { clearTimeout(t); resolve(im); };
  im.onerror = () => { clearTimeout(t); resolve(null); };
  im.src = src;
});

/* Tarik & gambar semua tile yang menutupi kanvas. Mengembalikan jumlah tile berhasil/gagal. */
async function drawTiles(ctx, tpl, { cx, cy, zView, zTile, W, H, scale }) {
  const k = Math.pow(2, zView - zTile);            // ukuran 1 tile (css px) pada zoom tampilan
  const [wx, wy] = worldPx(cx[0], cx[1], zView);   // titik tengah dalam piksel dunia (css px)
  const left = wx - W / 2, top = wy - H / 2;
  const t0x = Math.floor((left / (TILE * k))), t1x = Math.floor(((left + W) / (TILE * k)));
  const t0y = Math.floor((top / (TILE * k))), t1y = Math.floor(((top + H) / (TILE * k)));
  const n = Math.pow(2, zTile);
  const jobs = [];
  for (let ty = t0y; ty <= t1y; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = t0x; tx <= t1x; tx++) {
      const txw = ((tx % n) + n) % n;               // bungkus bujur
      jobs.push(loadImg(fillUrl(tpl, zTile, txw, ty)).then((im) => ({ im, tx, ty })));
    }
  }
  const res = await Promise.all(jobs);
  let ok = 0, gagal = 0;
  res.forEach(({ im, tx, ty }) => {
    if (!im) { gagal += 1; return; }
    ok += 1;
    const dx = (tx * TILE * k - left) * scale, dy = (ty * TILE * k - top) * scale;
    const sz = TILE * k * scale;
    ctx.drawImage(im, Math.round(dx) - 0.5, Math.round(dy) - 0.5, Math.ceil(sz) + 1, Math.ceil(sz) + 1);
  });
  return { ok, gagal };
}

const roundRect = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
};

/*
  opts:
    center [lat,lng], zoom (boleh pecahan), width/height (css px peta di layar), scale (>=2),
    route [[lat,lng]...], checkpoints [{pos:[lat,lng], n:number, latest:boolean}],
    ship {pos:[lat,lng], name} | null,
    title, lines[] (baris info di header), footer (teks kecil di bawah)
  Mengembalikan { blob, tileOk, tileGagal }. Melempar Error bila kanvas tidak bisa diekspor (CORS).
*/
export async function renderMapImage(opts) {
  const { center, zoom, route = [], checkpoints = [], ship = null, title = "", lines = [], footer = "" } = opts;
  const W = Math.max(320, Math.round(opts.width || 800)), H = Math.max(320, Math.round(opts.height || 600));
  const scale = Math.max(2, Math.min(3, opts.scale || 2));
  const zTile = Math.max(0, Math.min(MAP_MAX_NATIVE_ZOOM, Math.ceil(zoom + Math.log2(scale))));
  const cnv = document.createElement("canvas");
  cnv.width = Math.round(W * scale); cnv.height = Math.round(H * scale);
  const ctx = cnv.getContext("2d");
  ctx.fillStyle = "#e9edf1"; ctx.fillRect(0, 0, cnv.width, cnv.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";

  const common = { cx: center, zView: zoom, zTile, W, H, scale };
  const base = await drawTiles(ctx, MAP_TILE_URL, common);
  const lab = await drawTiles(ctx, MAP_LABEL_URL, common);

  const [wx, wy] = worldPx(center[0], center[1], zoom);
  const P = (ll) => { const [x, y] = worldPx(ll[0], ll[1], zoom); return [(x - (wx - W / 2)) * scale, (y - (wy - H / 2)) * scale]; };
  const S = scale;

  // Rute (garis putus abu tua)
  if (route.length > 1) {
    ctx.save(); ctx.strokeStyle = "#475569"; ctx.globalAlpha = 0.9; ctx.lineWidth = 2.5 * S; ctx.setLineDash([6 * S, 7 * S]);
    ctx.lineJoin = "round"; ctx.beginPath();
    route.forEach((ll, i) => { const [x, y] = P(ll); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.restore();
  }
  // Checkpoint bernomor
  checkpoints.forEach((cp) => {
    const [x, y] = P(cp.pos);
    ctx.beginPath(); ctx.arc(x, y, 11 * S, 0, Math.PI * 2);
    ctx.fillStyle = cp.latest ? "#EF9F27" : "#0F2A5C"; ctx.fill();
    ctx.lineWidth = 2.5 * S; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.fillStyle = cp.latest ? "#1a1208" : "#fff"; ctx.font = `700 ${11 * S}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(cp.n), x, y + 0.5 * S);
  });
  // Kapal + label nama
  if (ship) {
    const [x, y] = P(ship.pos);
    ctx.beginPath(); ctx.arc(x, y, 16 * S, 0, Math.PI * 2); ctx.fillStyle = "rgba(31,111,235,.18)"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, 9 * S, 0, Math.PI * 2); ctx.fillStyle = "#1f6feb"; ctx.fill();
    ctx.lineWidth = 3 * S; ctx.strokeStyle = "#fff"; ctx.stroke();
    if (ship.name) {
      ctx.font = `800 ${13 * S}px system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      const label = `MV ${ship.name}`; const tw = ctx.measureText(label).width;
      const bx = x + 16 * S, by = y - 13 * S, bw = tw + 18 * S, bh = 26 * S;
      roundRect(ctx, bx, by, bw, bh, 6 * S); ctx.fillStyle = "#0F2A5C"; ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillText(label, bx + 9 * S, by + bh / 2 + 0.5 * S);
    }
  }

  // Header (judul + info)
  const hdrH = (16 + 22 + lines.length * 18 + 12) * S;
  const grad = ctx.createLinearGradient(0, 0, 0, hdrH);
  grad.addColorStop(0, "rgba(255,255,255,.96)"); grad.addColorStop(1, "rgba(255,255,255,.90)");
  ctx.fillStyle = grad; ctx.fillRect(0, 0, cnv.width, hdrH);
  ctx.fillStyle = "#C9973A"; ctx.fillRect(0, hdrH - 2 * S, cnv.width, 2 * S);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#0F2A5C"; ctx.font = `800 ${17 * S}px system-ui, sans-serif`; ctx.fillText(title, 14 * S, 30 * S);
  ctx.fillStyle = "#334155"; ctx.font = `600 ${12.5 * S}px system-ui, sans-serif`;
  lines.forEach((ln, i) => ctx.fillText(ln, 14 * S, (30 + 20 + i * 18) * S - 4 * S));

  // Footer (tautan + atribusi)
  const ftH = 24 * S;
  ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fillRect(0, cnv.height - ftH, cnv.width, ftH);
  ctx.fillStyle = "#475569"; ctx.font = `500 ${10.5 * S}px system-ui, sans-serif`; ctx.textBaseline = "middle";
  ctx.textAlign = "left"; ctx.fillText(footer, 12 * S, cnv.height - ftH / 2);
  ctx.textAlign = "right"; ctx.fillText("Peta © Esri · OpenStreetMap", cnv.width - 12 * S, cnv.height - ftH / 2);

  const blob = await new Promise((res, rej) => {
    try { cnv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob kosong"))), "image/jpeg", 0.95); }
    catch (e) { rej(e); }
  });
  return { blob, tileOk: base.ok + lab.ok, tileGagal: base.gagal + lab.gagal };
}
