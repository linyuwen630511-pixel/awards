/* =====================================================================
   雲端資料庫連線設定（唯一需要修改的檔案）
   請依 README.md「步驟 2」到 Supabase 專案的 Settings → API Keys 複製：
     SUPABASE_URL ：Project URL，例如 https://abcdefghijk.supabase.co
     SUPABASE_KEY ：Publishable key（sb_publishable_ 開頭）或舊版 anon public key
   這兩個值本來就是公開給瀏覽器使用的，可以放在 GitHub 上；
   真正的安全保護在資料庫端（supabase/schema.sql）。
   ⚠️ 絕對不要填入 secret key 或 service_role key。
   ===================================================================== */
window.AWARDS_CONFIG = {
  SUPABASE_URL: 'https://supabase.com/dashboard/project/aihtxmbjhzkktdiboomy/settings/api-keys',
  SUPABASE_KEY: 'sb_publishable_mCVLI8eEvC8blN9dib9Wcw_kWpTAvt6',

  /* 選填：正式投票網址（QR Code 會連到這裡的 vote.html）。
     留空則自動使用目前網站網址，例如 https://帳號.github.io/awards/ */
  PUBLIC_SITE_URL: ''
};
