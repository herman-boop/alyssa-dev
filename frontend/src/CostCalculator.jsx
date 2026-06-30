/* eslint-disable */
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import axios from "axios";

/* Port dari cost-calculator.html (app lama). Logika hitung 1:1:
   HPP + Margin bertingkat + Proteksi Risiko + Bunga Dana Talang. */

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const API = `${BACKEND_URL}/api`;
const LEG_TYPES = ["Self Drive", "Kapal Laut", "Car Carrier", "Towing", "Self Loader", "Low Bed", "Bongkar/Muat", "Trucking", "Lainnya"];
const TIPE_OPTS = [
  "Kendaraan Kecil Biasa", "Kendaraan Kecil Medium", "Truck Ringan D4 Std", "Truck Ringan D4 Long",
  "Truck Sedang D6 Std", "Truck Sedang D6 Long", "Truck Besar F6 Std", "Truck Besar F6 Long",
  "Tronton T10 Std", "Tronton T10 Long", "Avanza, Veloz, Rush", "Innova Zenix", "Lainnya (custom)",
];
const TIERS = ["<1jt", "1-3jt", "3-8jt", "8-15jt", "15-25jt", ">25jt"];
const MIN_MARGIN_RAWAN = 6;
const DEFAULT_MARGIN = {
  e1: "20", e2: "12", e3: "9", e4: "6", e5: "4", e6: "2.5",
  e21: "15", e22: "10", e23: "7", e24: "5", e25: "3", e26: "2",
  s1: "30", s2: "18", s3: "15", s4: "10", s5: "7", s6: "5",
  s21: "25", s22: "15", s23: "12", s24: "8", s25: "6", s26: "4",
  c1: "55", c2: "40", c3: "32", c4: "25", c5: "18", c6: "12",
  c21: "45", c22: "35", c23: "28", c24: "22", c25: "15", c26: "10",
};

function pNum(s) {
  if (!s) return 0;
  s = String(s).trim().replace(/[Rp ]/g, "");
  if (!s || s === "-") return 0;
  if (s.indexOf(".") >= 0 && s.indexOf(",") >= 0) s = s.split(".").join("").replace(",", ".");
  else if (s.indexOf(",") >= 0) { const p = s.split(","); s = (p.length === 2 && p[1].length <= 2) ? s.replace(",", ".") : s.split(",").join(""); }
  else if (s.split(".").length > 2) s = s.split(".").join("");
  s = s.replace(/[^0-9.-]/g, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}
function fRp(n) { if (!n && n !== 0) return "-"; return "Rp " + Math.round(n).toLocaleString("id-ID"); }

function tierOf(hpp) {
  if (hpp < 1000000) return 0;
  if (hpp < 3000000) return 1;
  if (hpp < 8000000) return 2;
  if (hpp < 15000000) return 3;
  if (hpp < 25000000) return 4;
  return 5;
}
function proteksi(hpp, pct, isRawan) {
  if (isRawan && hpp >= 15000000) return Math.max(pct, MIN_MARGIN_RAWAN);
  return pct;
}
function hitungHarga(hpp, isRawan, M) {
  const tier = tierOf(hpp);
  const sx = ["1", "2", "3", "4", "5", "6"][tier];
  const g = (id) => proteksi(hpp, parseFloat(M[id]) || 0, isRawan);
  const ep = g("e" + sx), ep2 = g("e2" + sx), sp = g("s" + sx), sp2 = g("s2" + sx), cp = g("c" + sx), cp2 = g("c2" + sx);
  const ceil = (v) => Math.ceil(v / 1000) * 1000;
  return {
    hpp, tier,
    eksp: ceil(hpp * (1 + ep / 100)), eksp2: ceil(hpp * (1 + ep2 / 100)),
    sales: ceil(hpp * (1 + sp / 100)), sales2: ceil(hpp * (1 + sp2 / 100)),
    corp: ceil(hpp * (1 + cp / 100)), corp2: ceil(hpp * (1 + cp2 / 100)),
    ep, ep2, sp, sp2, cp, cp2,
  };
}

const I = { background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, padding: "7px 10px", color: "#e6edf3", fontSize: 12, outline: "none", width: "100%", fontFamily: "inherit" };
const LBL = { fontSize: 10, color: "#8b949e", display: "block", marginBottom: 3, fontWeight: 500 };
const CARD = { background: "#161b22", border: "1px solid #21262d", borderRadius: 10, padding: 14, marginBottom: 12 };
const TITLE = { fontSize: 12, fontWeight: 700, color: "#EF9F27", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".5px" };

function marginColor(m) {
  if (m > 15) return "#56d364";
  if (m >= 8) return "#fbbf24";
  return "#f85149";
}

export default function CostCalculator() {
  const [asal, setAsal] = useState("");
  const [tujuan, setTujuan] = useState("");
  const [tipe, setTipe] = useState(TIPE_OPTS[0]);
  const [top, setTop] = useState("cash");
  const [risiko, setRisiko] = useState("normal");
  const [admin, setAdmin] = useState("0");
  const [asuransi, setAsuransi] = useState("0");
  const [lain, setLain] = useState("0");
  const [catatan, setCatatan] = useState("");
  const [moda, setModa] = useState("");
  const [legs, setLegs] = useState([{ id: 1, type: "Self Drive", cost: "" }, { id: 2, type: "Kapal Laut", cost: "" }, { id: 3, type: "Self Drive", cost: "" }]);
  const [nextId, setNextId] = useState(4);
  const [M, setM] = useState(DEFAULT_MARGIN);
  const [savedMsg, setSavedMsg] = useState(false);
  const [listSaved, setListSaved] = useState(false);
  const [simpanModal, setSimpanModal] = useState(null); // { hargaOptions }
  const [simpanPilihan, setSimpanPilihan] = useState(null);
  const [routeList, setRouteList] = useState(() => {
    try { const raw = localStorage.getItem("alyssa_routelist"); return raw ? JSON.parse(raw) : []; } catch { return []; }
  });

  // Pelanggan state
  const [ptQuery, setPtQuery] = useState("");
  const [ptDropdown, setPtDropdown] = useState([]);
  const [selectedPt, setSelectedPt] = useState(null); // full pelanggan doc
  const [ptSaving, setPtSaving] = useState(false);
  const [ptSaveMsg, setPtSaveMsg] = useState("");
  const [ptLinkCopied, setPtLinkCopied] = useState(false);
  const debounceRef = useRef(null);

  const adminPin = typeof window !== "undefined" ? (localStorage.getItem("aal_admin_pin") || "") : "";

  useEffect(() => {
    try { const raw = localStorage.getItem("alyssa_margin"); if (raw) setM((m) => ({ ...m, ...JSON.parse(raw) })); } catch (e) {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem("alyssa_routelist", JSON.stringify(routeList)); } catch (e) {}
  }, [routeList]);

  // Debounced PT search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (ptQuery.length < 2) { setPtDropdown([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`${API}/admin/pelanggan`, {
          params: { q: ptQuery },
          headers: { "x-admin-pin": adminPin },
        });
        setPtDropdown(res.data.items || []);
      } catch (e) {
        setPtDropdown([]);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [ptQuery, adminPin]);

  const selectPt = async (pt) => {
    setPtDropdown([]);
    setPtQuery(pt.nama_pt);
    // Load full doc with history
    try {
      const res = await axios.get(`${API}/admin/pelanggan/${pt.id}`, {
        headers: { "x-admin-pin": adminPin },
      });
      const full = res.data;
      setSelectedPt(full);
      // Load margin_khusus into M if set
      if (full.margin_khusus && Object.keys(full.margin_khusus).length > 0) {
        setM((m) => ({ ...m, ...full.margin_khusus }));
      }
      // Load harga_history ke routeList supaya bisa lanjut dari no terakhir
      if (full.harga_history && full.harga_history.length > 0) {
        const fromHistory = full.harga_history.map(h => ({
          asal: h.asal || "", tujuan: h.tujuan || "", tipe: h.tipe || "",
          top: h.top || "cash", risiko: h.risiko || "normal",
          hpp: h.hpp || 0, eksp: h.harga_eksp || 0, eksp2: h.harga_eksp2 || 0,
          sales: h.harga_sales || 0, sales2: h.harga_sales2 || 0,
          corp: h.harga_corp || 0, corp2: h.harga_corp2 || 0,
          catatan: h.catatan || ""
        }));
        setRouteList(fromHistory);
      }
    } catch (e) {
      setSelectedPt(pt);
    }
  };

  const createNewPt = async () => {
    if (!ptQuery.trim()) { alert("Masukkan nama PT terlebih dahulu"); return; }
    try {
      const res = await axios.post(`${API}/admin/pelanggan`,
        { nama_pt: ptQuery.trim() },
        { headers: { "x-admin-pin": adminPin } }
      );
      setSelectedPt(res.data);
      setPtDropdown([]);
    } catch (e) {
      alert("Gagal membuat PT: " + (e.response?.data?.detail || e.message));
    }
  };

  const clearPt = () => {
    setSelectedPt(null);
    setPtQuery("");
    setPtDropdown([]);
    setPtSaveMsg("");
  };

  const doSimpanPenawaran = async () => {
    if (!selectedPt || !routeList.length) return;
    setPtSaving(true);
    try {
      let lastRes = null;
      for (const r of routeList) {
        const res = await axios.post(
          `${API}/admin/pelanggan/${selectedPt.id}/harga`,
          {
            rute: `${r.asal}→${r.tujuan}`,
            asal: r.asal, tujuan: r.tujuan, tipe: r.tipe,
            hpp: r.hpp, harga_deal: r.price_deal || r.corp || 0,
            tipe_kendaraan: r.tipe, catatan: r.catatan || "",
            asuransi: r.asuransi || 0, moda: r.moda || "",
            price_lbl: r.price_lbl || "",
            harga_eksp: r.eksp, harga_eksp2: r.eksp2,
            harga_sales: r.sales, harga_sales2: r.sales2,
            harga_corp: r.corp, harga_corp2: r.corp2,
          },
          { headers: { "x-admin-pin": adminPin } }
        );
        lastRes = res.data;
      }
      if (lastRes) setSelectedPt(lastRes);
      setRouteList([]);
      setPtSaveMsg(`✓ ${routeList.length} rute tersimpan ke ${selectedPt.nama_pt}!`);
      setTimeout(() => setPtSaveMsg(""), 4000);
    } catch (e) {
      alert("Gagal simpan: " + (e.response?.data?.detail || e.message));
    } finally {
      setPtSaving(false);
    }
  };

  const simpanPenawaran = () => {
    if (!selectedPt || !calc.hppFinal) return;
    const h = calc.h;
    setSimpanModal({
      options: [
        { lbl: "Eksp 1", val: h.eksp, color: "#56d364" },
        { lbl: "Eksp 2", val: h.eksp2, color: "#34d399" },
        { lbl: "Sales 1", val: h.sales, color: "#EF9F27" },
        { lbl: "Sales 2", val: h.sales2, color: "#fbbf24" },
        { lbl: "Corp 1", val: h.corp, color: "#58a6ff" },
        { lbl: "Corp 2", val: h.corp2, color: "#a78bfa" },
      ]
    });
    setSimpanPilihan(null);
  };

  const salinLinkHarga = () => {
    if (!selectedPt) return;
    const link = `${window.location.origin}/harga/${selectedPt.token}`;
    navigator.clipboard.writeText(link).then(() => {
      setPtLinkCopied(true);
      setTimeout(() => setPtLinkCopied(false), 2500);
    });
  };

  const isRawan = risiko === "rawan";
  const isTempo = top === "tempo30";

  const calc = useMemo(() => {
    let hppVendor = 0;
    const comps = [];
    legs.forEach((l) => { const v = pNum(l.cost); if (v > 0) { comps.push({ name: l.type, cost: v }); hppVendor += v; } });
    const a = pNum(admin), as = pNum(asuransi), ln = pNum(lain);
    hppVendor += a + as + ln;
    const bunga = isTempo ? Math.round(hppVendor * 0.05) : 0;
    const hppFinal = hppVendor + bunga;
    const h = hppFinal > 0 ? hitungHarga(hppFinal, isRawan, M) : null;
    return { comps, a, as, ln, hppVendor, bunga, hppFinal, h };
  }, [legs, admin, asuransi, lain, isTempo, isRawan, M]);

  const setLeg = (id, patch) => setLegs((ls) => ls.map((l) => l.id === id ? { ...l, ...patch } : l));
  const addLeg = (type = "Self Drive") => { setLegs((ls) => [...ls, { id: nextId, type, cost: "" }]); setNextId((n) => n + 1); };
  const delLeg = (id) => setLegs((ls) => ls.filter((l) => l.id !== id));
  const setMargin = (id, v) => setM((m) => ({ ...m, [id]: v }));

  const saveMargin = () => { try { localStorage.setItem("alyssa_margin", JSON.stringify(M)); } catch (e) {} setSavedMsg(true); setTimeout(() => setSavedMsg(false), 2000); };
  const saveList = () => { try { localStorage.setItem("alyssa_routelist", JSON.stringify(routeList)); } catch (e) {} setListSaved(true); setTimeout(() => setListSaved(false), 2000); };

  const [addModal, setAddModal] = useState(null); // { hargaOptions, routeData }
  const [addPilihan, setAddPilihan] = useState(null);

  const addToList = () => {
    if (!asal.trim() || !tujuan.trim()) { alert("Isi Asal dan Tujuan dulu!"); return; }
    if (!calc.hppFinal) { alert("Isi minimal 1 komponen biaya dulu!"); return; }
    const h = calc.h;
    setAddModal({
      routeData: {
        asal: asal.trim(), tujuan: tujuan.trim(), tipe, top: isTempo ? "Tempo 30hr" : "Cash",
        risiko: isRawan ? "Rawan" : "Normal", catatan: catatan.trim(), hpp: calc.hppFinal, asuransi: calc.as || 0,
        moda: moda.trim(),
        eksp: h.eksp, eksp2: h.eksp2, sales: h.sales, sales2: h.sales2, corp: h.corp, corp2: h.corp2,
      },
      options: [
        { lbl: "Eksp 1", val: h.eksp, color: "#56d364" },
        { lbl: "Eksp 2", val: h.eksp2, color: "#34d399" },
        { lbl: "Sales 1", val: h.sales, color: "#EF9F27" },
        { lbl: "Sales 2", val: h.sales2, color: "#fbbf24" },
        { lbl: "Corp 1", val: h.corp, color: "#58a6ff" },
        { lbl: "Corp 2", val: h.corp2, color: "#a78bfa" },
      ]
    });
    setAddPilihan(null);
  };

  const confirmAddToList = () => {
    if (!addModal || !addPilihan) return;
    setRouteList((rl) => [...rl, { ...addModal.routeData, price_deal: addPilihan.val, price_lbl: addPilihan.lbl }]);
    setAddModal(null); setAddPilihan(null);
    setAsal(""); setTujuan(""); setCatatan(""); setTop("cash"); setRisiko("normal"); setModa("");
    setLegs((ls) => ls.map((l) => ({ ...l, cost: "" }))); setAdmin("0"); setAsuransi("0"); setLain("0");
  };

  const delRoute = (i) => setRouteList((rl) => rl.filter((_, idx) => idx !== i));
  const clearList = () => { if (window.confirm("Hapus semua rute?")) setRouteList([]); };

  const deleteHargaPT = async (hargaId) => {
    if (!selectedPt) return;
    if (!window.confirm("Hapus data harga ini?")) return;
    try {
      const res = await axios.delete(`${API}/admin/pelanggan/${selectedPt.id}/harga/${hargaId}`, { headers: { "x-admin-pin": adminPin } });
      setSelectedPt(res.data);
      const fromHistory = (res.data.harga_history || []).map(h => ({
        asal: h.asal || (h.rute||"").split("→")[0]||"", tujuan: h.tujuan || (h.rute||"").split("→")[1]||"",
        tipe: h.tipe || "", top: h.top || "cash", risiko: h.risiko || "normal",
        hpp: h.hpp || 0, eksp: h.harga_eksp||0, eksp2: h.harga_eksp2||0,
        sales: h.harga_sales||0, sales2: h.harga_sales2||0, corp: h.harga_corp||0, corp2: h.harga_corp2||0,
        catatan: h.catatan||"", price_deal: h.harga_deal||0, price_lbl: h.price_lbl||""
      }));
      setRouteList(fromHistory);
    } catch { alert("Gagal hapus"); }
  };

  const deletePT = async () => {
    if (!selectedPt) return;
    if (!window.confirm(`Hapus PT "${selectedPt.nama_pt}" beserta semua data harga?\nTidak bisa dibatalkan!`)) return;
    try {
      await axios.delete(`${API}/admin/pelanggan/${selectedPt.id}`, { headers: { "x-admin-pin": adminPin } });
      setSelectedPt(null); setPtQuery(""); setRouteList([]);
    } catch (e) { alert("Gagal hapus PT: " + (e.response?.data?.detail || e.message)); }
  };

  const exportCSV = () => {
    if (!routeList.length) return;
    const rows = routeList.map((r) => [r.asal, r.tujuan, r.tipe, r.top, r.risiko, r.hpp, r.eksp, r.eksp2, r.sales, r.sales2, r.corp, r.corp2, '"' + (r.catatan || "") + '"'].join(",")).join("\n");
    const blob = new Blob(["Asal,Tujuan,Tipe,TOP,Risiko,HPP,Eksp1,Eksp2,Sales1,Sales2,Corp1,Corp2,Catatan\n" + rows], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hpp-alyssa.csv"; a.click();
  };

  // segmen: "eksp" | "sales" | "corp" | "all"
  const printPDF = (segmen) => {
    if (!routeList.length) return;
    const tgl = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });

    const P = "Harga Pengiriman";
    const CFG = {
      eksp_a:  { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "eksp",  lbl: P, c: "#1a7f37" }] },
      eksp_b:  { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "eksp2", lbl: P, c: "#1a7f37" }] },
      sales_a: { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "sales",  lbl: P, c: "#9a5000" }] },
      sales_b: { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "sales2", lbl: P, c: "#9a5000" }] },
      corp_a:  { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "corp",  lbl: P, c: "#0550ae" }] },
      corp_b:  { title: "DAFTAR HARGA PENGIRIMAN", cols: [{ key: "corp2", lbl: P, c: "#6e40c9" }] },
      all:     { title: "REKAP HARGA INTERNAL", cols: [
        { key: "eksp", lbl: "Eksp 1", c: "#1a7f37" }, { key: "eksp2", lbl: "Eksp 2", c: "#1a7f37" },
        { key: "sales", lbl: "Sales 1", c: "#9a5000" }, { key: "sales2", lbl: "Sales 2", c: "#9a5000" },
        { key: "corp", lbl: "Corp 1", c: "#0550ae" }, { key: "corp2", lbl: "Corp 2", c: "#6e40c9" },
      ]},
    };
    const cfg = CFG[segmen];
    const thCols = cfg.cols.map(c => `<th style="color:#fff;background:#BA7517">${c.lbl}</th>`).join("");
    const rows = routeList.map((r, i) => {
      const priceCols = cfg.cols.map(c => `<td class="money" style="color:${c.c}">${fRp(r[c.key])}</td>`).join("");
      const noAsuransi = !r.asuransi || r.asuransi === 0;
      const catatanFull = [r.catatan, noAsuransi ? "⚠ Harga belum termasuk asuransi" : ""].filter(Boolean).join(" · ");
      return `<tr class="${i % 2 === 1 ? "alt" : ""}">
        <td class="num">${i + 1}</td>
        <td>${r.asal}</td><td>${r.tujuan}</td>
        <td class="small">${r.tipe}</td>
        <td class="small">${r.top}${r.risiko === "Rawan" ? "<br><span class='badge'>Rawan</span>" : ""}</td>
        ${priceCols}
        <td class="small${noAsuransi ? " no-asu" : ""}">${catatanFull || "-"}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>${cfg.title} - PT Alyssa Auto Logistik</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 10px; color: #222; background: #fff; padding: 20px 24px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #BA7517; padding-bottom: 10px; margin-bottom: 14px; }
      .co-name { font-size: 15px; font-weight: 800; color: #BA7517; letter-spacing: .5px; }
      .co-sub { font-size: 9px; color: #666; margin-top: 2px; }
      .doc-title { font-size: 13px; font-weight: 700; text-align: right; }
      .doc-date { font-size: 9px; color: #666; text-align: right; margin-top: 2px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
      th { background: #BA7517; color: #fff; padding: 5px 6px; text-align: center; font-size: 9px; border: 1px solid #a86612; }
      td { padding: 4px 6px; border: 1px solid #ddd; vertical-align: top; }
      tr.alt td { background: #fdf9f3; }
      .num { text-align: center; color: #999; width: 22px; }
      .small { font-size: 8.5px; color: #555; }
      .money { text-align: right; font-weight: 700; white-space: nowrap; font-size: 10.5px; }
      .badge { background: #f97316; color: #fff; font-size: 7px; padding: 1px 4px; border-radius: 3px; }
      .no-asu { color: #c05621 !important; font-weight: 600; }
      .footer { border-top: 1px solid #ddd; padding-top: 8px; font-size: 8.5px; color: #999; display: flex; justify-content: space-between; }
      @media print { body { padding: 10px 14px; } @page { margin: 12mm 10mm; size: A4 landscape; } }
    </style></head><body>
    <div class="header">
      <div><div class="co-name">PT ALYSSA AUTO LOGISTIK</div><div class="co-sub">Solusi Transportasi &amp; Logistik Kendaraan</div></div>
      <div><div class="doc-title">${cfg.title}</div><div class="doc-date">Diterbitkan: ${tgl}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>#</th><th>Asal</th><th>Tujuan</th><th>Tipe Kendaraan</th><th>TOP / Kondisi</th>
        ${thCols}<th>Catatan</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="footer">
      <span>Harga berlaku sesuai kondisi aktual di lapangan. Hubungi kami untuk konfirmasi.</span>
      <span>Total ${routeList.length} rute — PT Alyssa Auto Logistik</span>
    </div>
    <script>window.onload = () => { window.print(); }<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
  };

  const h = calc.h;
  const tl = h ? ` (${TIERS[h.tier]})${isRawan && calc.hppFinal >= 15000000 ? " *min6%" : ""}` : "";
  const MGROUPS = [
    { key: "e", label: "Eksp1%", color: "#56d364" }, { key: "e2", label: "Eksp2%", color: "#34d399" },
    { key: "s", label: "Sales1%", color: "#EF9F27" }, { key: "s2", label: "Sales2%", color: "#fbbf24" },
    { key: "c", label: "Corp1%", color: "#58a6ff" }, { key: "c2", label: "Corp2%", color: "#a78bfa" },
  ];
  const RESULTS = h ? [
    { lbl: "Eksp 1", val: h.eksp, m: h.ep, c: "#56d364" }, { lbl: "Eksp 2", val: h.eksp2, m: h.ep2, c: "#34d399" },
    { lbl: "Sales 1", val: h.sales, m: h.sp, c: "#EF9F27" }, { lbl: "Sales 2", val: h.sales2, m: h.sp2, c: "#fbbf24" },
    { lbl: "Corp 1", val: h.corp, m: h.cp, c: "#58a6ff" }, { lbl: "Corp 2", val: h.corp2, m: h.cp2, c: "#a78bfa" },
  ] : [];

  const ptHistory = selectedPt ? [...(selectedPt.harga_history || [])].reverse().slice(0, 10) : [];

  return (
    <div style={{ fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", background: "#0d1117", color: "#e6edf3", minHeight: "100vh", padding: 16 }}>

      {/* Modal pilih harga saat Tambah ke List */}
      {addModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, width: "100%", maxWidth: 420, padding: 20 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#fff", marginBottom: 4 }}>+ Tambah ke List — Pilih Harga</div>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 14 }}>{addModal.routeData.asal} → {addModal.routeData.tujuan} &nbsp;·&nbsp; HPP: {fRp(addModal.routeData.hpp)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
              {addModal.options.map(opt => (
                <div key={opt.lbl} onClick={() => setAddPilihan(opt)}
                  style={{ cursor: "pointer", padding: "12px 10px", borderRadius: 8, border: `2px solid ${addPilihan?.lbl === opt.lbl ? opt.color : "#30363d"}`, background: addPilihan?.lbl === opt.lbl ? "rgba(255,255,255,0.05)" : "#0d1117", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4 }}>{opt.lbl}</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: opt.color }}>{fRp(opt.val)}</div>
                  <div style={{ fontSize: 10, color: "#6e7681", marginTop: 2 }}>margin {fRp(opt.val - addModal.routeData.hpp)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setAddModal(null)} style={{ flex: 1, padding: 9, borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer" }}>Batal</button>
              <button onClick={confirmAddToList} disabled={!addPilihan}
                style={{ flex: 2, padding: 9, borderRadius: 7, border: "none", background: addPilihan ? "#2ea043" : "#21262d", color: addPilihan ? "#fff" : "#484f58", cursor: addPilihan ? "pointer" : "not-allowed", fontWeight: 700 }}>
                {addPilihan ? `✓ Masukkan ${addPilihan.lbl} — ${fRp(addPilihan.val)}` : "Pilih harga dulu"}
              </button>
            </div>
          </div>
        </div>
      )}

      <h1 style={{ fontSize: 17, fontWeight: 700, marginBottom: 3 }}>Cost <span style={{ color: "#BA7517" }}>Calculator</span></h1>
      <p style={{ fontSize: 12, color: "#8b949e", marginBottom: 16 }}>HPP + Margin + Proteksi Risiko + Bunga Dana Talang</p>

      {/* ── Nama PT Section ── */}
      <div style={{ ...CARD, marginBottom: 12 }}>
        <div style={TITLE}>Nama PT / Pelanggan Korporat</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", position: "relative" }}>
          <div style={{ flex: 1, position: "relative" }}>
            {selectedPt ? (
              <div style={{ ...I, display: "flex", alignItems: "center", gap: 8, background: "#0d2818", border: "1px solid #2ea043", cursor: "default" }}>
                <span style={{ color: "#3fb950", fontWeight: 700, fontSize: 13 }}>✓</span>
                <span style={{ fontWeight: 700, color: "#e6edf3", fontSize: 13 }}>{selectedPt.nama_pt}</span>
                <button onClick={() => { setSelectedPt(null); setPtQuery(""); }}
                  style={{ marginLeft: "auto", background: "none", border: "none", color: "#8b949e", cursor: "pointer", fontSize: 11, padding: "0 4px" }}>Ganti PT</button>
              </div>
            ) : (
              <input
                style={I}
                value={ptQuery}
                onChange={(e) => setPtQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && ptDropdown.length > 0) selectPt(ptDropdown[0]); }}
                placeholder="Ketik nama PT untuk mencari atau membuat baru..."
                autoFocus
              />
            )}
            {ptDropdown.length > 0 && (
              <div style={{ position: "absolute", top: "100%", left: 0, right: 0, background: "#161b22", border: "1px solid #30363d", borderRadius: 6, zIndex: 100, maxHeight: 200, overflowY: "auto" }}>
                {ptDropdown.map((pt) => (
                  <div key={pt.id} onClick={() => selectPt(pt)}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #21262d" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#21262d"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontWeight: 600 }}>{pt.nama_pt}</span>
                    {pt.pic_nama && <span style={{ color: "#8b949e", marginLeft: 8, fontSize: 11 }}>PIC: {pt.pic_nama}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {!selectedPt && ptQuery.length >= 2 && (
            <button onClick={createNewPt}
              style={{ padding: "7px 14px", borderRadius: 6, border: "1px dashed #EF9F27", background: "none", color: "#EF9F27", fontSize: 11, cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>
              + PT Baru
            </button>
          )}
        </div>

        {selectedPt && (
          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ background: "#0d3320", border: "1px solid #2ea043", borderRadius: 20, padding: "4px 14px", fontSize: 12, color: "#56d364", fontWeight: 700 }}>
              ✓ {selectedPt.nama_pt}
            </span>
            {selectedPt.pic_nama && <span style={{ fontSize: 11, color: "#8b949e" }}>PIC: {selectedPt.pic_nama} {selectedPt.pic_hp && `· ${selectedPt.pic_hp}`}</span>}
            <button onClick={salinLinkHarga}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #30363d", background: "none", color: ptLinkCopied ? "#56d364" : "#8b949e", fontSize: 11, cursor: "pointer" }}>
              {ptLinkCopied ? "✓ Link Tersalin!" : "🔗 Salin Link Harga"}
            </button>
            <button onClick={deletePT}
              style={{ padding: "4px 12px", borderRadius: 6, border: "1px solid #f85149", background: "none", color: "#f85149", fontSize: 11, cursor: "pointer" }}>
              🗑 Hapus PT
            </button>
          </div>
        )}
      </div>

      <div style={CARD}>
        <div style={TITLE}>Data Rute &amp; Kondisi</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div><label style={LBL}>Kota Asal</label><input style={I} value={asal} onChange={(e) => setAsal(e.target.value)} placeholder="Jakarta" /></div>
          <div><label style={LBL}>Kota Tujuan</label><input style={I} value={tujuan} onChange={(e) => setTujuan(e.target.value)} placeholder="Banjarmasin" /></div>
          <div><label style={LBL}>Tipe Kendaraan</label><select style={I} value={tipe} onChange={(e) => setTipe(e.target.value)}>{TIPE_OPTS.map((t) => <option key={t}>{t}</option>)}</select></div>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={LBL}>Moda Pengiriman <span style={{ color: "#6e7681", fontWeight: 400 }}>(otomatis dari komponen biaya, bisa diedit)</span></label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["Self Drive","Kapal Laut","Car Carrier","Towing","Self Loader","Low Bed"].map(m => (
              <button key={m} type="button" onClick={() => setModa(prev => {
                const parts = prev ? prev.split(" + ").map(s=>s.trim()).filter(Boolean) : [];
                return parts.includes(m) ? parts.filter(p=>p!==m).join(" + ") : [...parts, m].join(" + ");
              })}
                style={{ padding: "4px 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", fontWeight: 600,
                  background: moda.includes(m) ? "#1f3a5f" : "none",
                  border: moda.includes(m) ? "1px solid #58a6ff" : "1px solid #30363d",
                  color: moda.includes(m) ? "#58a6ff" : "#6e7681" }}>
                {m}
              </button>
            ))}
            {moda && <button type="button" onClick={() => setModa("")} style={{ padding: "4px 8px", borderRadius: 5, fontSize: 10, cursor: "pointer", background: "none", border: "1px solid #f85149", color: "#f85149" }}>✕ Reset</button>}
          </div>
          {moda && <div style={{ marginTop: 4, fontSize: 11, color: "#58a6ff" }}>→ {moda}</div>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div><label style={LBL}>Term of Payment</label>
            <select style={I} value={top} onChange={(e) => setTop(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="tempo30">Tempo 30 Hari (+5% bunga dana talang)</option>
            </select>
          </div>
          <div><label style={LBL}>Kategori Risiko Rute</label>
            <select style={I} value={risiko} onChange={(e) => setRisiko(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="rawan">Rawan Delay / Alat Berat (+min 6% margin &gt;15jt)</option>
            </select>
          </div>
        </div>
        {isTempo && <div style={{ background: "#0c2d3a", border: "1px solid #0ea5e9", borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 11, color: "#38bdf8" }}>Tempo 30 Hari aktif — harga jual ditambah 5% dari HPP sebagai beban bunga dana talang</div>}
        {isRawan && <div style={{ background: "#2b1d0e", border: "1px solid #EF9F27", borderRadius: 8, padding: "10px 14px", marginBottom: 10, fontSize: 11, color: "#EF9F27" }}>Rute Rawan aktif — margin minimum 6% untuk HPP di atas Rp 15 juta</div>}

        <div style={{ ...TITLE, marginTop: 10 }}>Komponen Biaya (HPP)</div>
        <div>
          {legs.map((l) => (
            <div key={l.id} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 6, alignItems: "center", marginBottom: 6 }}>
              <select style={{ ...I, fontSize: 11 }} value={l.type} onChange={(e) => setLeg(l.id, { type: e.target.value })}>{LEG_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              <input style={{ ...I, textAlign: "right" }} value={l.cost} onChange={(e) => setLeg(l.id, { cost: e.target.value })} placeholder="0" />
              <button onClick={() => delLeg(l.id)} style={{ background: "none", border: "1px solid #f85149", color: "#f85149", padding: "4px 8px", borderRadius: 5, cursor: "pointer", fontSize: 11 }}>X</button>
            </div>
          ))}
        </div>
        <button onClick={() => addLeg()} style={{ background: "none", border: "1px dashed #30363d", color: "#8b949e", fontSize: 11, padding: "6px 10px", borderRadius: 6, cursor: "pointer", marginTop: 4, width: "100%" }}>+ Tambah Komponen Biaya</button>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
          <div><label style={LBL}>Biaya Admin/Handling</label><input style={I} value={admin} onChange={(e) => setAdmin(e.target.value)} /></div>
          <div><label style={LBL}>Biaya Asuransi</label><input style={I} value={asuransi} onChange={(e) => setAsuransi(e.target.value)} /></div>
          <div><label style={LBL}>Biaya Lainnya</label><input style={I} value={lain} onChange={(e) => setLain(e.target.value)} /></div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={LBL}>Catatan (tampil di daftar harga pelanggan)</label>
          <textarea style={{ ...I, resize: "none", lineHeight: 1.4 }} rows={2} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="Contoh: Sudah termasuk biaya penyeberangan Merak-Bakauheni" />
        </div>
      </div>

      <div style={{ background: "#0d1117", border: "1px solid #21262d", borderRadius: 8, padding: 10, marginBottom: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {MGROUPS.map((grp) => (
          <span key={grp.key} style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 10, color: grp.color, whiteSpace: "nowrap" }}>{grp.label}:</span>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <span key={n} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center" }}>
                {grp.key === "e" && <span style={{ fontSize: 9, color: "#484f58", whiteSpace: "nowrap" }}>{TIERS[n - 1]}</span>}
                <input type="number" value={M[grp.key + n]} onChange={(e) => setMargin(grp.key + n, e.target.value)}
                  style={{ width: 38, background: "#161b22", border: "1px solid #30363d", borderRadius: 4, padding: "3px 4px", color: "#e6edf3", fontSize: 11, textAlign: "center", outline: "none" }} />
              </span>
            ))}
            <span style={{ color: "#30363d", margin: "0 2px" }}>|</span>
          </span>
        ))}
        <button onClick={saveMargin} style={{ padding: "3px 8px", borderRadius: 5, border: "1px solid #2ea043", background: savedMsg ? "#2ea043" : "none", color: savedMsg ? "#fff" : "#56d364", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>{savedMsg ? "Tersimpan!" : "Simpan Margin"}</button>
      </div>

      {calc.hppFinal > 0 && (
        <div style={{ ...CARD }}>
          <div style={TITLE}>Ringkasan HPP</div>
          {calc.comps.map((c, i) => <Row key={i} l={c.name} v={fRp(c.cost)} />)}
          {calc.a > 0 && <Row l="Admin/Handling" v={fRp(calc.a)} />}
          {calc.as > 0 && <Row l="Asuransi" v={fRp(calc.as)} />}
          {calc.ln > 0 && <Row l="Lainnya" v={fRp(calc.ln)} />}
          <Row l="Total HPP Vendor" v={fRp(calc.hppVendor)} />
          {calc.bunga > 0 && <Row l="+ Beban Bunga Tempo 30hr (5%)" v={fRp(calc.bunga)} color="#38bdf8" />}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "2px solid #EF9F27" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#EF9F27" }}>Total HPP Final</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#EF9F27" }}>{fRp(calc.hppFinal)}</span>
          </div>
        </div>
      )}

      {h && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          {RESULTS.map((r) => (
            <div key={r.lbl} style={{ background: "#161b22", border: `1px solid ${r.c}`, borderRadius: 8, padding: 12, textAlign: "center" }}>
              <div style={{ fontSize: 10, color: r.c, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".5px" }}>{r.lbl}</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: r.c }}>{fRp(r.val)}</div>
              <div style={{ fontSize: 10, marginTop: 3, color: r.c, fontWeight: 600 }}>margin {fRp(r.val - calc.hppFinal)} ({r.m}%){tl}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={addToList} style={{ padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "none", background: "#2ea043", color: "#fff" }}>+ Tambah ke List</button>
        <button onClick={() => { setAsal(""); setTujuan(""); setCatatan(""); setTop("cash"); setRisiko("normal"); setAdmin("0"); setAsuransi("0"); setLain("0"); setLegs([{ id: nextId, type: "Self Drive", cost: "" }, { id: nextId + 1, type: "Kapal Laut", cost: "" }, { id: nextId + 2, type: "Self Drive", cost: "" }]); setNextId((n) => n + 3); }} style={{ padding: "8px 16px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700, background: "none", border: "1px solid #30363d", color: "#8b949e" }}>Reset Form</button>
      </div>

      {/* List rute yg belum disimpan ke DB */}
      {routeList.length > 0 && (
        <div style={{ background: "#161b22", border: "1px solid #238636", borderRadius: 10, marginBottom: 12 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#3fb950" }}>📋 List Rute ({routeList.length}) — Belum Disimpan</span>
            <button onClick={clearList} style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, background: "none", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer" }}>Clear</button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#21262d" }}>
                {["#","Asal","Tujuan","Moda","HPP","Harga Deal","Tipe Harga",""].map((th,i) => <th key={i} style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 600 }}>{th}</th>)}
              </tr></thead>
              <tbody>
                {routeList.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid #21262d" }}>
                    <td style={{ padding: "6px 8px", color: "#6e7681" }}>{i+1}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{r.asal}</td>
                    <td style={{ padding: "6px 8px", fontWeight: 700 }}>{r.tujuan}</td>
                    <td style={{ padding: "6px 8px", color: "#58a6ff", fontSize: 10 }}>{r.moda || "—"}</td>
                    <td style={{ padding: "6px 8px", color: "#8b949e" }}>{fRp(r.hpp)}</td>
                    <td style={{ padding: "6px 8px", color: "#3fb950", fontWeight: 700 }}>{fRp(r.price_deal)}</td>
                    <td style={{ padding: "6px 8px", color: "#8b949e", fontSize: 10 }}>{r.price_lbl}</td>
                    <td style={{ padding: "6px 8px" }}><button onClick={() => delRoute(i)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer" }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedPt && (
            <div style={{ padding: "10px 14px", borderTop: "1px solid #21262d", display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={doSimpanPenawaran} disabled={ptSaving}
                style={{ padding: "9px 18px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "none", background: ptSaving ? "#21262d" : "#1f6feb", color: "#fff" }}>
                {ptSaving ? "Menyimpan..." : `💾 Simpan ke Penawaran ${selectedPt.nama_pt} (${routeList.length} rute)`}
              </button>
              {ptSaveMsg && <span style={{ fontSize: 12, color: "#56d364", fontWeight: 700 }}>{ptSaveMsg}</span>}
            </div>
          )}
          {!selectedPt && <div style={{ padding: "8px 14px", fontSize: 11, color: "#f85149" }}>⚠ Pilih PT dulu di atas untuk menyimpan penawaran</div>}
        </div>
      )}

      {false && routeList.length > 0 && (
        <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #21262d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>List Rute</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={saveList} style={{ padding: "5px 12px", fontSize: 11, borderRadius: 7, border: "none", background: listSaved ? "#2ea043" : "#1f6feb", color: "#fff", cursor: "pointer", fontWeight: 700 }}>{listSaved ? "✓ Tersimpan!" : "💾 Simpan"}</button>
              <span style={{ color: "#484f58", fontSize: 10, alignSelf: "center" }}>Eksp:</span>
              <button onClick={() => printPDF("eksp_a")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "none", background: "#1a7f37", color: "#fff", cursor: "pointer", fontWeight: 700 }}>🖨 A</button>
              <button onClick={() => printPDF("eksp_b")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "1px solid #1a7f37", background: "none", color: "#56d364", cursor: "pointer", fontWeight: 700 }}>🖨 B</button>
              <span style={{ color: "#484f58", fontSize: 10, alignSelf: "center" }}>Sales:</span>
              <button onClick={() => printPDF("sales_a")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "none", background: "#9a5000", color: "#fff", cursor: "pointer", fontWeight: 700 }}>🖨 A</button>
              <button onClick={() => printPDF("sales_b")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "1px solid #9a5000", background: "none", color: "#EF9F27", cursor: "pointer", fontWeight: 700 }}>🖨 B</button>
              <span style={{ color: "#484f58", fontSize: 10, alignSelf: "center" }}>Corp:</span>
              <button onClick={() => printPDF("corp_a")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "none", background: "#0550ae", color: "#fff", cursor: "pointer", fontWeight: 700 }}>🖨 A</button>
              <button onClick={() => printPDF("corp_b")} style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "1px solid #6e40c9", background: "none", color: "#a78bfa", cursor: "pointer", fontWeight: 700 }}>🖨 B</button>
              <button onClick={() => printPDF("all")}   style={{ padding: "5px 9px", fontSize: 11, borderRadius: 7, border: "1px solid #30363d", background: "none", color: "#8b949e", cursor: "pointer", fontWeight: 700 }}>🖨 Rekap</button>
              <button onClick={exportCSV} style={{ padding: "5px 12px", fontSize: 11, borderRadius: 7, border: "none", background: "#BA7517", color: "#FAEEDA", cursor: "pointer", fontWeight: 700 }}>Export CSV</button>
              <button onClick={clearList} style={{ padding: "5px 12px", fontSize: 11, borderRadius: 7, background: "none", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer", fontWeight: 700 }}>Clear</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#21262d" }}>
                {["Asal", "Tujuan", "Tipe", "TOP", "Risiko", "HPP Final", "Eksp1", "Eksp2", "Sales1", "Sales2", "Corp1", "Corp2", "Catatan", ""].map((th, i) => (
                  <th key={i} style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 600, border: "1px solid #30363d" }}>{th}</th>
                ))}
              </tr></thead>
              <tbody>
                {routeList.map((r, i) => (
                  <tr key={i}>
                    <td style={TD}>{r.asal}</td><td style={TD}>{r.tujuan}</td>
                    <td style={{ ...TD, color: "#8b949e", fontSize: 10 }}>{r.tipe}</td>
                    <td style={{ ...TD, fontSize: 10 }}>{r.top}</td>
                    <td style={{ ...TD, fontSize: 10 }}>{r.risiko}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#8b949e" }}>{fRp(r.hpp)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#56d364" }}>{fRp(r.eksp)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#34d399" }}>{fRp(r.eksp2)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#EF9F27" }}>{fRp(r.sales)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#fbbf24" }}>{fRp(r.sales2)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#58a6ff" }}>{fRp(r.corp)}</td>
                    <td style={{ ...TD, textAlign: "right", color: "#a78bfa" }}>{fRp(r.corp2)}</td>
                    <td style={{ ...TD, color: "#8b949e", fontSize: 10, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.catatan || ""}>{r.catatan || "-"}</td>
                    <td style={{ ...TD, textAlign: "center" }}><button onClick={() => delRoute(i)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 12 }}>X</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Price History PT (dari DB) ── */}
      {selectedPt && ptHistory.length > 0 && (
        <div style={{ ...CARD, marginTop: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={TITLE}>📋 Daftar Harga — {selectedPt.nama_pt} ({ptHistory.length} rute)</div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ background: "#21262d" }}>
                {["#","Tanggal","Rute","Tipe Kendaraan","Harga Deal","Margin %",""].map((th) => (
                  <th key={th} style={{ padding: "6px 8px", textAlign: "left", color: "#8b949e", fontWeight: 600, border: "1px solid #30363d" }}>{th}</th>
                ))}
              </tr></thead>
              <tbody>
                {ptHistory.map((entry, i) => {
                  const mc = marginColor(entry.margin_aktual || 0);
                  const tgl = entry.tanggal ? new Date(entry.tanggal).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) : "-";
                  return (
                    <tr key={entry.id || i} style={{ borderTop: "1px solid #21262d" }}>
                      <td style={{ ...TD, color: "#6e7681" }}>{ptHistory.length - i}</td>
                      <td style={{ ...TD, fontSize: 10, color: "#8b949e" }}>{tgl}</td>
                      <td style={TD}>{entry.rute}</td>
                      <td style={{ ...TD, fontSize: 10, color: "#8b949e" }}>{entry.tipe_kendaraan}</td>
                      <td style={{ ...TD, textAlign: "right", color: "#e6edf3", fontWeight: 700 }}>{fRp(entry.harga_deal)}</td>
                      <td style={{ ...TD, textAlign: "center", color: mc, fontWeight: 700 }}>{entry.margin_aktual}%</td>
                      <td style={TD}><button onClick={() => deleteHargaPT(entry.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 14 }}>🗑</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const TD = { padding: "5px 8px", border: "1px solid #21262d", fontWeight: 600 };
function Row({ l, v, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid #21262d", fontSize: 12 }}>
      <span style={{ color: color || "#8b949e" }}>{l}</span>
      <span style={{ fontWeight: 600, textAlign: "right", color: color || "#e6edf3" }}>{v}</span>
    </div>
  );
}
