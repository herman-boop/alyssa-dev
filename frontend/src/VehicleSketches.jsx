// 20 Vehicle Side-View Sketches — minimal line-art, gold + navy.
// Each sketch uses viewBox "0 0 400 200" and stroke="currentColor" so it inherits color.
import React from "react";

const baseProps = {
  viewBox: "0 0 400 200",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function Wheel({ cx, cy = 165, r = 18 }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} />
      <circle cx={cx} cy={cy} r={r * 0.45} />
      <circle cx={cx} cy={cy} r={2} fill="currentColor" />
    </g>
  );
}

// ---------- 1. Sedan ----------
export function SketchSedan(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M40 165 L60 130 L130 100 Q200 88 270 100 L340 130 L360 165 Z" />
      <path d="M120 100 L155 60 L240 60 L270 100" />
      <line x1="195" y1="60" x2="195" y2="100" />
      <Wheel cx={110} /><Wheel cx={300} />
    </svg>
  );
}

// ---------- 2. MPV ----------
export function SketchMPV(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M40 165 L50 120 L70 70 L320 70 L350 110 L360 165 Z" />
      <line x1="100" y1="70" x2="100" y2="165" />
      <line x1="180" y1="70" x2="180" y2="165" />
      <line x1="260" y1="70" x2="260" y2="165" />
      <Wheel cx={110} /><Wheel cx={310} />
    </svg>
  );
}

// ---------- 3. SUV ----------
export function SketchSUV(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 160 L50 120 L80 75 L320 75 L350 105 L370 160 Z" />
      <path d="M120 75 L150 50 L260 50 L290 75" />
      <line x1="205" y1="50" x2="205" y2="75" />
      <Wheel cx={110} r={22} /><Wheel cx={310} r={22} />
    </svg>
  );
}

// ---------- 4. Pickup ----------
export function SketchPickup(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 120 L70 70 L180 70 L195 120 L370 120 L370 165 Z" />
      <path d="M85 70 L110 50 L165 50 L180 70" />
      <line x1="195" y1="120" x2="195" y2="165" />
      <Wheel cx={110} /><Wheel cx={320} />
    </svg>
  );
}

// ---------- 5. Double Cabin ----------
export function SketchDoubleCabin(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 120 L70 70 L240 70 L255 120 L370 120 L370 165 Z" />
      <path d="M85 70 L115 50 L220 50 L240 70" />
      <line x1="162" y1="50" x2="162" y2="120" />
      <line x1="255" y1="120" x2="255" y2="165" />
      <Wheel cx={110} /><Wheel cx={320} />
    </svg>
  );
}

// ---------- 6. CDD (Colt Diesel Double) ----------
export function SketchCDD(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 110 L100 110 L100 60 L160 60 L160 110 L370 110 L370 165 Z" />
      <line x1="100" y1="110" x2="100" y2="165" />
      <line x1="160" y1="110" x2="160" y2="165" />
      <rect x="170" y="80" width="180" height="30" />
      <Wheel cx={70} /><Wheel cx={250} /><Wheel cx={300} />
    </svg>
  );
}

// ---------- 7. Truck Box ----------
export function SketchTruckBox(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 110 L90 110 L90 65 L150 65 L150 110 L150 165 Z" />
      <rect x="150" y="55" width="220" height="110" />
      <line x1="200" y1="55" x2="200" y2="165" />
      <line x1="280" y1="55" x2="280" y2="165" />
      <Wheel cx={65} /><Wheel cx={210} /><Wheel cx={330} />
    </svg>
  );
}

// ---------- 8. Dump Truck ----------
export function SketchDumpTruck(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 110 L90 110 L90 65 L150 65 L150 110 L150 165 Z" />
      <polygon points="155,110 370,110 370,55 200,55 155,90" />
      <Wheel cx={65} /><Wheel cx={220} /><Wheel cx={320} />
    </svg>
  );
}

// ---------- 9. Tangki ----------
export function SketchTangki(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 110 L90 110 L90 65 L150 65 L150 110 L150 165 Z" />
      <ellipse cx="270" cy="110" rx="120" ry="40" />
      <line x1="220" y1="78" x2="220" y2="142" />
      <line x1="270" y1="70" x2="270" y2="150" />
      <line x1="320" y1="78" x2="320" y2="142" />
      <Wheel cx={65} /><Wheel cx={230} /><Wheel cx={310} />
    </svg>
  );
}

// ---------- 10. Tronton ----------
export function SketchTronton(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M20 165 L30 115 L80 115 L80 65 L140 65 L140 115 L140 165 Z" />
      <rect x="140" y="60" width="240" height="105" />
      <line x1="200" y1="60" x2="200" y2="165" />
      <line x1="270" y1="60" x2="270" y2="165" />
      <line x1="335" y1="60" x2="335" y2="165" />
      <Wheel cx={55} r={16} /><Wheel cx={210} r={16} /><Wheel cx={250} r={16} />
      <Wheel cx={310} r={16} /><Wheel cx={350} r={16} />
    </svg>
  );
}

// ---------- 11. Box Besar ----------
export function SketchBoxBesar(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M20 165 L30 110 L85 110 L85 60 L145 60 L145 110 L145 165 Z" />
      <rect x="145" y="35" width="240" height="130" />
      <line x1="200" y1="35" x2="200" y2="165" />
      <line x1="270" y1="35" x2="270" y2="165" />
      <line x1="335" y1="35" x2="335" y2="165" />
      <Wheel cx={60} r={18} /><Wheel cx={220} r={18} /><Wheel cx={325} r={18} />
    </svg>
  );
}

// ---------- 12. Canter ----------
export function SketchCanter(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 115 L90 115 L90 75 L150 75 L150 115 L150 165 Z" />
      <rect x="150" y="80" width="200" height="85" />
      <line x1="220" y1="80" x2="220" y2="165" />
      <line x1="290" y1="80" x2="290" y2="165" />
      <Wheel cx={65} /><Wheel cx={310} />
    </svg>
  );
}

// ---------- 13. Canter Pemadam ----------
export function SketchCanterPemadam(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M30 165 L40 115 L90 115 L90 75 L150 75 L150 115 L150 165 Z" />
      <rect x="150" y="80" width="200" height="85" />
      {/* tangki air */}
      <ellipse cx="240" cy="115" rx="60" ry="22" />
      {/* light bar */}
      <rect x="90" y="65" width="60" height="10" />
      <circle cx="105" cy="70" r="3" fill="currentColor" />
      <circle cx="135" cy="70" r="3" fill="currentColor" />
      {/* tangga */}
      <line x1="170" y1="80" x2="350" y2="50" />
      <line x1="190" y1="74" x2="190" y2="56" />
      <line x1="240" y1="65" x2="240" y2="48" />
      <line x1="290" y1="57" x2="290" y2="40" />
      <Wheel cx={65} /><Wheel cx={310} />
    </svg>
  );
}

// ---------- 14. Motor 2 Roda ----------
export function SketchMotor2(p) {
  return (
    <svg {...baseProps} {...p}>
      {/* body */}
      <path d="M90 150 L150 150 L180 120 L250 120 L260 90 L280 90 L290 110 L310 150" />
      <path d="M140 150 L120 105 L90 105" /> {/* stang */}
      <line x1="180" y1="120" x2="200" y2="90" />
      <Wheel cx={100} r={30} /><Wheel cx={300} r={30} />
    </svg>
  );
}

// ---------- 15. Motor 3 Roda (Tossa/Viar) ----------
export function SketchMotor3(p) {
  return (
    <svg {...baseProps} {...p}>
      <path d="M70 150 L120 120 L150 95 L180 95 L200 110 L210 150" /> {/* depan */}
      <rect x="200" y="65" width="170" height="85" />  {/* bak belakang */}
      <line x1="270" y1="65" x2="270" y2="150" />
      <Wheel cx={90} r={22} /><Wheel cx={270} r={22} /><Wheel cx={340} r={22} />
    </svg>
  );
}

// ---------- 16. Forklift ----------
export function SketchForklift(p) {
  return (
    <svg {...baseProps} {...p}>
      {/* base */}
      <path d="M120 165 L140 115 L210 115 L240 100 L260 100 L260 165 Z" />
      {/* mast */}
      <line x1="100" y1="40" x2="100" y2="165" />
      <line x1="115" y1="40" x2="115" y2="165" />
      {/* fork */}
      <line x1="115" y1="155" x2="50" y2="155" />
      <line x1="115" y1="140" x2="50" y2="140" />
      <line x1="50" y1="155" x2="50" y2="138" />
      {/* cab */}
      <rect x="180" y="70" width="60" height="45" />
      <Wheel cx={170} /><Wheel cx={260} r={14} cy={170} />
    </svg>
  );
}

// ---------- 17. Excavator ----------
export function SketchExcavator(p) {
  return (
    <svg {...baseProps} {...p}>
      {/* track */}
      <rect x="40" y="150" width="280" height="25" rx="10" />
      <circle cx="65" cy="162" r="8" />
      <circle cx="120" cy="162" r="8" />
      <circle cx="200" cy="162" r="8" />
      <circle cx="270" cy="162" r="8" />
      {/* turret */}
      <path d="M110 150 L130 105 L240 105 L260 150 Z" />
      {/* boom */}
      <line x1="240" y1="110" x2="320" y2="50" />
      <line x1="320" y1="50" x2="370" y2="100" />
      {/* bucket */}
      <path d="M370 100 L390 130 L355 145 L350 115 Z" />
    </svg>
  );
}

// ---------- 18. Dozer ----------
export function SketchDozer(p) {
  return (
    <svg {...baseProps} {...p}>
      {/* track */}
      <rect x="60" y="135" width="260" height="30" rx="14" />
      <circle cx="85" cy="150" r="9" />
      <circle cx="180" cy="150" r="9" />
      <circle cx="295" cy="150" r="9" />
      {/* cab */}
      <path d="M160 135 L170 80 L250 80 L270 135 Z" />
      <line x1="220" y1="80" x2="220" y2="135" />
      {/* blade */}
      <path d="M50 165 L40 95 L65 95 L75 165 Z" />
      <line x1="60" y1="120" x2="160" y2="120" />
      {/* exhaust */}
      <rect x="270" y="60" width="10" height="35" />
    </svg>
  );
}

// ---------- 19. Grader ----------
export function SketchGrader(p) {
  return (
    <svg {...baseProps} {...p}>
      <rect x="30" y="115" width="80" height="40" />
      <rect x="110" y="80" width="100" height="75" />
      <line x1="150" y1="80" x2="150" y2="155" />
      {/* boom to blade */}
      <line x1="60" y1="115" x2="240" y2="155" />
      <line x1="180" y1="155" x2="270" y2="155" />
      {/* blade */}
      <line x1="230" y1="140" x2="290" y2="170" />
      <Wheel cx={65} r={14} cy={170} />
      <Wheel cx={130} r={14} cy={170} />
      <Wheel cx={195} r={14} cy={170} />
      <Wheel cx={340} r={20} />
    </svg>
  );
}

// ---------- 20. Vibro Roller ----------
export function SketchVibroRoller(p) {
  return (
    <svg {...baseProps} {...p}>
      {/* drum besar */}
      <circle cx={110} cy={140} r={45} />
      <circle cx={110} cy={140} r={30} />
      {/* body */}
      <rect x="155" y="80" width="105" height="80" />
      <line x1="200" y1="80" x2="200" y2="160" />
      {/* cab */}
      <path d="M170 80 L185 55 L235 55 L250 80" />
      <Wheel cx={300} r={26} cy={150} />
    </svg>
  );
}

/* SVG fallback (dipakai kalau gambar /vehicles/*.jpg gagal load). */
export const VEHICLE_SKETCH_MAP = {
  /* ── 16 bentuk unit (dropdown) ── */
  "Sedan": SketchSedan,
  "MPV / SUV": SketchMPV,
  "Pickup / Double Cabin": SketchDoubleCabin,
  "Truck Box": SketchTruckBox,
  "Truck Bak": SketchCDD,
  "Dump Truck": SketchDumpTruck,
  "Truck Tangki": SketchTangki,
  "Concrete Pump": SketchTruckBox,
  "Fire Truck": SketchCanterPemadam,
  "Motor": SketchMotor2,
  "Excavator": SketchExcavator,
  "Grader": SketchGrader,
  "Dozer": SketchDozer,
  "Vibro Roller": SketchVibroRoller,
  "Forklift": SketchForklift,
  "Dump Crawler": SketchDumpTruck,
  /* ── Tipe lama (backward-compat: data lama tetap render) ── */
  "MPV": SketchMPV,
  "SUV": SketchSUV,
  "Pickup": SketchPickup,
  "Double Cabin": SketchDoubleCabin,
  "CDD": SketchCDD,
  "Tangki": SketchTangki,
  "Tronton": SketchTronton,
  "Box Besar": SketchBoxBesar,
  "Canter": SketchCanter,
  "Canter Pemadam": SketchCanterPemadam,
  "Motor 2 Roda": SketchMotor2,
  "Motor 3 Roda": SketchMotor3,
  "Mobil Kecil Biasa": SketchSedan,
  "Mobil Kecil Medium": SketchSUV,
};

/* Daftar tipe untuk dropdown — 16 bentuk unit (cocok dgn sketsa). */
export const VEHICLE_TYPE_LIST = [
  "Sedan",
  // ── Toyota ──
  "Toyota Avanza",
  "Toyota Veloz",
  "Toyota Rush",
  "Toyota Fortuner",
  "Toyota Kijang Innova",
  "Toyota Innova Zenix",
  "Toyota Raize",
  "Toyota Yaris Cross",
  "Toyota Alphard",
  "Toyota Vellfire",
  "Toyota Hilux",
  // ── Daihatsu ──
  "Daihatsu Xenia",
  "Daihatsu Terios",
  "Daihatsu Rocky",
  "Daihatsu Sigra",
  "Daihatsu Ayla",
  "Daihatsu Gran Max",
  // ── Honda ──
  "Honda BR-V",
  "Honda HR-V",
  "Honda CR-V",
  "Honda Mobilio",
  "Honda Brio",
  "Honda WR-V",
  "Honda Pilot",
  // ── Mitsubishi ──
  "Mitsubishi Xpander",
  "Mitsubishi Xpander Cross",
  "Mitsubishi Pajero Sport",
  "Mitsubishi Outlander",
  "Mitsubishi Eclipse Cross",
  "Mitsubishi L300",
  // ── Wuling ──
  "Wuling Almaz",
  "Wuling Alvez",
  "Wuling Confero",
  "Wuling Air EV",
  "Wuling BinguoEV",
  // ── BYD ──
  "BYD Atto 3",
  "BYD Seal",
  "BYD Dolphin",
  "BYD Sealion 6",
  "BYD M6",
  // ── Suzuki ──
  "Suzuki Ertiga",
  "Suzuki XL7",
  "Suzuki Grand Vitara",
  "Suzuki Baleno",
  "Suzuki Ignis",
  "Suzuki Carry",
  // ── Lainnya ──
  "MPV / SUV Lainnya",
  "Pickup / Double Cabin",
  "Truck Box",
  "Truck Bak",
  "Dump Truck",
  "Truck Tangki",
  "Concrete Pump",
  "Fire Truck",
  "Motor",
  "Excavator",
  "Grader",
  "Dozer",
  "Vibro Roller",
  "Forklift",
  "Dump Crawler",
];

const TYPE_TO_FILENAME = {
  /* ── 16 bentuk unit → file di /vehicles/ ── */
  "Sedan":                  "sedan",
  "MPV / SUV":              "mpv-suv",
  "MPV / SUV Lainnya":      "mpv-suv",
  // Toyota
  "Toyota Avanza":          "mpv-suv",
  "Toyota Veloz":           "mpv-suv",
  "Toyota Rush":            "mpv-suv",
  "Toyota Fortuner":        "mpv-suv",
  "Toyota Kijang Innova":   "mpv-suv",
  "Toyota Innova Zenix":    "mpv-suv",
  "Toyota Raize":           "mpv-suv",
  "Toyota Yaris Cross":     "mpv-suv",
  "Toyota Alphard":         "mpv-suv",
  "Toyota Vellfire":        "mpv-suv",
  "Toyota Hilux":           "pickup",
  // Daihatsu
  "Daihatsu Xenia":         "mpv-suv",
  "Daihatsu Terios":        "mpv-suv",
  "Daihatsu Rocky":         "mpv-suv",
  "Daihatsu Sigra":         "mpv-suv",
  "Daihatsu Ayla":          "sedan",
  "Daihatsu Gran Max":      "pickup",
  // Honda
  "Honda BR-V":             "mpv-suv",
  "Honda HR-V":             "mpv-suv",
  "Honda CR-V":             "mpv-suv",
  "Honda Mobilio":          "mpv-suv",
  "Honda Brio":             "sedan",
  "Honda WR-V":             "mpv-suv",
  "Honda Pilot":            "mpv-suv",
  // Mitsubishi
  "Mitsubishi Xpander":     "mpv-suv",
  "Mitsubishi Xpander Cross": "mpv-suv",
  "Mitsubishi Pajero Sport":  "mpv-suv",
  "Mitsubishi Outlander":   "mpv-suv",
  "Mitsubishi Eclipse Cross": "mpv-suv",
  "Mitsubishi L300":        "pickup",
  // Wuling
  "Wuling Almaz":           "mpv-suv",
  "Wuling Alvez":           "mpv-suv",
  "Wuling Confero":         "mpv-suv",
  "Wuling Air EV":          "sedan",
  "Wuling BinguoEV":        "sedan",
  // BYD
  "BYD Atto 3":             "mpv-suv",
  "BYD Seal":               "sedan",
  "BYD Dolphin":            "sedan",
  "BYD Sealion 6":          "mpv-suv",
  "BYD M6":                 "mpv-suv",
  // Suzuki
  "Suzuki Ertiga":          "mpv-suv",
  "Suzuki XL7":             "mpv-suv",
  "Suzuki Grand Vitara":    "mpv-suv",
  "Suzuki Baleno":          "sedan",
  "Suzuki Ignis":           "sedan",
  "Suzuki Carry":           "pickup",
  "Pickup / Double Cabin":  "pickup",
  "Truck Box":              "truck-box",
  "Truck Bak":              "truck-bak",
  "Dump Truck":             "dump-truck",
  "Truck Tangki":           "tangki",
  "Concrete Pump":          "concrete-pump",
  "Fire Truck":             "fire-truck",
  "Motor":                  "motor",
  "Excavator":              "excavator",
  "Grader":                 "grader",
  "Dozer":                  "dozer",
  "Vibro Roller":           "vibro",
  "Forklift":               "forklift",
  "Dump Crawler":           "dump-crawler",
};

export function VehicleSketch({ type, className, style, color = "#D4A847", strokeWidth = 2 }) {
  const [imgOk, setImgOk] = React.useState(true);
  const filename = TYPE_TO_FILENAME[type];
  const imgUrl = filename ? `/vehicles/${filename}.jpg` : null;
  const Comp = VEHICLE_SKETCH_MAP[type];

  if (imgUrl && imgOk) {
    return (
      <div className={className} style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "#fff", ...style }}>
        <img
          src={imgUrl}
          alt={type}
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          onError={() => setImgOk(false)}
        />
      </div>
    );
  }

  if (!Comp) return null;
  return (
    <div className={className} style={{ color, ...style }}>
      <Comp width="100%" height="100%" strokeWidth={strokeWidth} />
    </div>
  );
}

export const DAMAGE_CODES = [
  { code: "RSK", label: "Rusak",     color: "#DC2626", bg: "#2d1515" },
  { code: "B",   label: "Baret",     color: "#F59E0B", bg: "#2b1d0e" },
  { code: "P",   label: "Penyok",    color: "#3B82F6", bg: "#0c2d52" },
  { code: "PC",  label: "Pecah",     color: "#A855F7", bg: "#1c103a" },
  { code: "CL",  label: "Cat Ulang", color: "#10B981", bg: "#0F2A1C" },
  { code: "L",   label: "Lainnya",   color: "#94A3C4", bg: "#1B2C46" },
];
