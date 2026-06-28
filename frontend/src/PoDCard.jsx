import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/* Resolve foto URL — Supabase URLs sudah absolute, lainnya prepend backendUrl */
function resolveUrl(backendUrl, url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${backendUrl}${url}`;
}

const STATUS_COLOR = {
  "Berangkat":     { bg: "#0C2D52", color: "#60A5FA", border: "#2563EB" },
  "Checkpoint 1":  { bg: "#0F2A1C", color: "#56d364", border: "#2ea043" },
  "Checkpoint 2":  { bg: "#0F2A1C", color: "#56d364", border: "#2ea043" },
  "Checkpoint 3":  { bg: "#0F2A1C", color: "#56d364", border: "#2ea043" },
  "Tiba Tujuan":   { bg: "#2B1D0E", color: "#D4A847", border: "#EF9F27" },
};

const podIcon = L.divIcon({
  className: "pod-pin",
  html: `<div class="pod-pin-ring"></div><div class="pod-pin-dot"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDateID(iso) {
  if (!iso) return "—";
  try { const d = new Date(iso); return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`; } catch { return "—"; }
}
function fmtTimeWIB(iso) {
  if (!iso) return "—";
  try { const d = new Date(iso); return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false }) + " WIB"; } catch { return "—"; }
}

function MapAutoSize({ mapRef }) {
  useEffect(() => {
    if (mapRef.current) { setTimeout(() => mapRef.current.invalidateSize(), 100); }
  }, [mapRef]);
  return null;
}

export default function PoDCard({ photo, backendUrl, namaDriver, nopol, dayIndex = 0 }) {
  const hasGps = photo && typeof photo.lat === "number" && typeof photo.lng === "number";
  const center = useMemo(() => hasGps ? [photo.lat, photo.lng] : null, [hasGps, photo?.lat, photo?.lng]);
  const cardRef = useRef(null);
  const mapRef = useRef(null);
  const [generating, setGenerating] = useState(false);
  const statusInfo = photo?.status ? (STATUS_COLOR[photo.status] || STATUS_COLOR["Berangkat"]) : null;

  const downloadPDF = async () => {
    if (!cardRef.current) return;
    setGenerating(true);
    try {
      const canvas = await html2canvas(cardRef.current, {
        backgroundColor: "#0A1628",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      // Header
      pdf.setFillColor(10, 22, 40);
      pdf.rect(0, 0, pageWidth, 24, "F");
      pdf.setTextColor(212, 168, 71);
      pdf.setFontSize(14);
      pdf.setFont("helvetica", "bold");
      pdf.text("PT ALYSSA AUTO LOGISTIK", pageWidth / 2, 10, { align: "center" });
      pdf.setFontSize(9);
      pdf.setTextColor(150, 168, 200);
      pdf.text("Proof of Delivery — Driver Checkpoint", pageWidth / 2, 16, { align: "center" });
      pdf.setFontSize(8);
      pdf.text("0818 631 135 · alyssalogistik.co.id", pageWidth / 2, 21, { align: "center" });
      // Card image
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const imgW = pageWidth - 30;
      const imgH = (canvas.height / canvas.width) * imgW;
      const safeH = Math.min(imgH, pageHeight - 60);
      pdf.addImage(imgData, "JPEG", 15, 30, imgW, safeH);
      // Footer
      pdf.setTextColor(110, 130, 160);
      pdf.setFontSize(8);
      pdf.text(`Dicetak: ${new Date().toLocaleString("id-ID")}`, 15, pageHeight - 8);
      pdf.text("Halaman 1 / 1", pageWidth - 15, pageHeight - 8, { align: "right" });
      pdf.save(`PoD-${nopol || "AAL"}-CP${dayIndex + 1}.pdf`);
    } catch (e) {
      alert("Gagal generate PDF: " + e.message);
    } finally { setGenerating(false); }
  };

  return (
    <article className="pod-card" data-testid="pod-card">
      <div ref={cardRef}>
        <div className="pod-photo-wrap">
          <a href={resolveUrl(backendUrl, photo.url)} target="_blank" rel="noreferrer" className="pod-photo-link">
            <img src={resolveUrl(backendUrl, photo.url)} alt={`Checkpoint ${dayIndex + 1}`} className="pod-photo" crossOrigin="anonymous" />
          </a>
          <div className="pod-photo-badge">CP-{dayIndex + 1}</div>
          {statusInfo && (
            <div
              className="pod-status-chip"
              style={{ background: statusInfo.bg, color: statusInfo.color, borderColor: statusInfo.border }}
              data-testid="pod-status-chip"
            >
              {photo.status}
            </div>
          )}
        </div>
        <div className="pod-map-wrap">
          {hasGps ? (
            <MapContainer
              key={`map-${photo.id || photo.ts}`}
              center={center} zoom={15}
              scrollWheelZoom={false} dragging={false} zoomControl={false}
              doubleClickZoom={false} touchZoom={false}
              style={{ height: "100%", width: "100%" }}
              ref={mapRef}
              data-testid="pod-map"
            >
              <TileLayer attribution='&copy; OSM' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={center} icon={podIcon}>
                <Popup>{photo.lat.toFixed(5)}, {photo.lng.toFixed(5)}</Popup>
              </Marker>
              <MapAutoSize mapRef={mapRef} />
            </MapContainer>
          ) : (
            <div className="pod-map-no-gps">
              <div className="pod-map-no-gps-icon">📍</div>
              <div>Lokasi GPS tidak dicatat</div>
            </div>
          )}
        </div>
        <div className="pod-info">
          <div className="pod-info-line">
            <div className="pod-info-item"><span className="pod-info-ico">👤</span><span className="pod-info-val">{namaDriver || "—"}</span></div>
            <div className="pod-info-item"><span className="pod-info-ico">🚗</span><span className="pod-info-val pod-info-mono">{nopol || "—"}</span></div>
          </div>
          <div className="pod-info-line">
            <div className="pod-info-item"><span className="pod-info-ico">📅</span><span className="pod-info-val pod-info-mono">{fmtDateID(photo.ts)}</span></div>
            <div className="pod-info-item"><span className="pod-info-ico">🕒</span><span className="pod-info-val pod-info-mono">{fmtTimeWIB(photo.ts)}</span></div>
          </div>
          {photo.keterangan && (
            <div className="pod-keterangan" data-testid="pod-keterangan">📝 {photo.keterangan}</div>
          )}
          {hasGps && (
            <div className="pod-coord" data-testid="pod-coord">
              <span className="pod-info-ico">🗺️</span>
              <a href={`https://www.google.com/maps?q=${photo.lat},${photo.lng}`} target="_blank" rel="noreferrer" className="pod-coord-link" data-testid="pod-gmaps-link">
                {photo.lat.toFixed(5)}, {photo.lng.toFixed(5)} → Buka Google Maps
              </a>
            </div>
          )}
        </div>
      </div>
      <button className="pod-pdf-btn" onClick={downloadPDF} disabled={generating} data-testid="btn-pod-pdf">
        {generating ? "📄 Membuat PDF..." : "💾 Download PoD PDF"}
      </button>
    </article>
  );
}
