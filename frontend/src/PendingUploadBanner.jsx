import { useEffect, useState } from "react";
import { labelOf } from "@/lib/uploadQueue";

/*
  Banner status foto checkpoint yang belum sampai ke server.
  Tampil selama masih ada foto di antrean HP (tetap muncul setelah refresh), supaya
  driver tahu fotonya AMAN dan tidak perlu mengambil ulang. Murni presentasi.
*/
export default function PendingUploadBanner({ items, busy, onRetry }) {
  const first = items && items[0];
  const [thumb, setThumb] = useState("");

  useEffect(() => {
    if (!first || !first.blob) { setThumb(""); return undefined; }
    let url = "";
    try { url = URL.createObjectURL(first.blob); setThumb(url); } catch (e) { setThumb(""); }
    return () => { if (url) { try { URL.revokeObjectURL(url); } catch (e) { /* abaikan */ } } };
  }, [first && first.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!first) return null;
  const blocked = !!first.blocked;
  const tone = blocked
    ? { bg: "#2A1113", bd: "#E5484D", fg: "#FFB4B6" }
    : busy
      ? { bg: "#0D2340", bd: "#3B82F6", fg: "#BFDBFE" }
      : { bg: "#2B1D0E", bd: "#EF9F27", fg: "#FDE2B0" };
  const label = labelOf(first);
  const title = blocked
    ? `${label} belum bisa dikirim`
    : busy ? `Mengirim ${label.toLowerCase()}…` : `${label} aman tersimpan di HP`;
  const sub = blocked
    ? `${first.lastError || "Ditolak server"}. Hubungi admin; file tetap tersimpan di HP.`
    : busy ? "Jangan tutup halaman ini sampai selesai."
      : `Menunggu sinyal, dikirim otomatis${first.lastError ? ` (${first.lastError})` : ""}.`;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="pending-upload-banner"
      style={{
        position: "fixed", left: 10, right: 10, top: "calc(env(safe-area-inset-top, 0px) + 10px)", zIndex: 9999,
        maxWidth: 540, margin: "0 auto", display: "flex", alignItems: "center", gap: 12,
        background: tone.bg, border: `1.5px solid ${tone.bd}`, borderRadius: 14, padding: "10px 12px",
        boxShadow: "0 8px 28px rgba(0,0,0,.45)", color: "#fff", fontFamily: "inherit",
      }}
    >
      {thumb ? (
        <img src={thumb} alt={`${label} yang menunggu terkirim`} onError={() => setThumb("")} style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover", flex: "none", border: "1px solid rgba(255,255,255,.25)" }} />
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.25 }}>
          {title}{items.length > 1 ? ` (${items.length})` : ""}
        </div>
        <div style={{ fontSize: 12, color: tone.fg, lineHeight: 1.35, marginTop: 2 }}>{sub}</div>
      </div>
      {!busy ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="pending-upload-retry"
          style={{ flex: "none", border: 0, borderRadius: 10, padding: "9px 12px", background: "#fff", color: "#0A1330", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}
        >
          {blocked ? "Coba lagi" : "Kirim sekarang"}
        </button>
      ) : null}
    </div>
  );
}
