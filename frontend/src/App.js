import "@/App.css";
import { useMemo } from "react";
import DriverCheckpoint from "@/DriverCheckpoint";
import CustomerTracking from "@/CustomerTracking";
import BASTKPage from "@/BASTKPage";
import CustomerOrderForm from "@/CustomerOrderForm";
import CustomerOrderStatus from "@/CustomerOrderStatus";
import AdminDashboard from "@/AdminDashboard";
import OperationGuide from "@/OperationGuide";
import Homepage from "@/Homepage";
import CostCalculator from "@/CostCalculator";
import DriverData from "@/DriverData";
import DriverRegister from "@/DriverRegister";
import KoordinatorPage from "@/KoordinatorPage";
import CustomerPricePage from "@/CustomerPricePage";
import SupplierRingkasan from "@/SupplierRingkasan";
import SelisihRingkasan from "@/SelisihRingkasan";
import KompensasiRingkasan from "@/KompensasiRingkasan";
import SupplierQuoteFill from "@/SupplierQuoteFill";
import CustomerGuidePage from "@/CustomerGuidePage";

// Resolve path segment: /track/TRIP-XXX -> "TRIP-XXX"
function pathSegment(pathname, prefix) {
  const seg = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
  return seg.replace(/^\//, "").split("?")[0].trim();
}

function App() {
  const { route, redirect } = useMemo(() => {
    const u = new URL(window.location.href);
    const p = u.pathname.replace(/\/$/, "") || "/";
    const sp = u.searchParams;

    // ── Path-based routing (new scheme) ────────────────────────────
    if (p === "/order")             return { route: "order" };
    if (p === "/admin")             return { route: "admin" };
    if (p === "/kalkulator")        return { route: "kalkulator" };
    if (p === "/drivers")           return { route: "drivers" };
    if (p === "/daftar-driver")     return { route: "daftar-driver" };
    if (p === "/guide")             return { route: "guide" };
    if (p === "/koordinator")       return { route: "koordinator" };
    if (p === "/panduan-kirim")     return { route: "panduan-kirim" };
    if (p.startsWith("/harga/"))     return { route: "harga" };
    if (p.startsWith("/track/"))    return { route: "track" };
    if (p.startsWith("/trip/"))     return { route: "driver" };
    if (p.startsWith("/bastk/"))    return { route: "bastk" };
    if (p.startsWith("/status/"))   return { route: "status" };
    if (p.startsWith("/supplier-ringkasan/")) return { route: "supplier-ringkasan" };
    if (p.startsWith("/selisih-ringkasan/")) return { route: "selisih-ringkasan" };
    if (p.startsWith("/kompensasi-ringkasan/")) return { route: "kompensasi-ringkasan" };
    if (p.startsWith("/minta-harga/")) return { route: "minta-harga" };

    // ── Legacy query-param redirect to new paths ────────────────────
    if (sp.get("guide") !== null)   return { redirect: "/guide" };
    if (sp.get("admin") !== null)   return { redirect: "/admin" };
    if (sp.get("order") !== null)   return { redirect: "/order" };

    const bastk = sp.get("bastk");
    if (bastk) return { redirect: `/bastk/${bastk}` };

    const track = sp.get("track");
    if (track) return { redirect: `/track/${track}` };

    const trip = sp.get("trip");
    if (trip) {
      // Keep extra params (nopol, driver, etc) when redirecting
      const extras = new URLSearchParams();
      ["nopol","driver","route","tipe","rangka","uj","b1","b2","b3","legs"].forEach(k => {
        const v = sp.get(k);
        if (v) extras.set(k, v);
      });
      const qs = extras.toString() ? `?${extras.toString()}` : "";
      return { redirect: `/trip/${trip}${qs}` };
    }

    // ── Root → Homepage ─────────────────────────────────────────────
    if (p === "/") return { route: "home" };

    return { route: "home" };
  }, []);

  // Execute redirect (replaces history so back-button works cleanly)
  if (redirect) {
    window.location.replace(redirect);
    return null;
  }

  if (route === "home")   return <Homepage />;
  if (route === "guide")  return <OperationGuide />;
  if (route === "admin")  return <AdminDashboard />;
  if (route === "kalkulator") return <CostCalculator />;
  if (route === "drivers")        return <DriverData />;
  if (route === "daftar-driver")  return <DriverRegister />;
  if (route === "order")  return <CustomerOrderForm />;
  if (route === "status") return <CustomerOrderStatus />;
  if (route === "bastk")  return <BASTKPage />;
  if (route === "track")  return <CustomerTracking />;
  if (route === "driver") return <DriverCheckpoint />;
  if (route === "koordinator") return <KoordinatorPage />;
  if (route === "harga") return <CustomerPricePage />;
  if (route === "supplier-ringkasan") return <SupplierRingkasan />;
  if (route === "selisih-ringkasan") return <SelisihRingkasan />;
  if (route === "kompensasi-ringkasan") return <KompensasiRingkasan />;
  if (route === "minta-harga") return <SupplierQuoteFill />;
  if (route === "panduan-kirim") return <CustomerGuidePage />;
  return <Homepage />;
}

export default App;
