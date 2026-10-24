import axios from "axios";

/* Sisipkan token akun (kalau ada) ke semua panggilan /api. PIN admin lama tetap jalan:
   backend memeriksa token dulu, lalu PIN. Tanpa token, perilaku lama tidak berubah. */
export const USER_TOKEN_KEY = "aal_user_token";

axios.interceptors.request.use((config) => {
  try {
    const t = localStorage.getItem(USER_TOKEN_KEY);
    const url = String(config.url || "");
    if (t && url.includes("/api/")) {
      config.headers = config.headers || {};
      if (!config.headers.Authorization && !config.headers.authorization) {
        config.headers.Authorization = `Bearer ${t}`;
      }
    }
  } catch (e) { /* storage tidak tersedia */ }
  return config;
});
