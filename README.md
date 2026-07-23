# Roomilly - 智慧空房管理平台

一個純前端的旅宿客房狀態管理模擬系統，提供「旅客前台」與「員工後台」兩種模式，可即時查看、篩選、模擬預訂與管理客房狀態。

## ✨ 功能特色

- **雙模式切換**：一鍵切換「旅客前台」與「員工後台」視角
- **旅客前台**
  - 依入住／退房日期、房型篩選空房
  - 關鍵字搜尋房號、房名、設備標籤
  - 線上模擬預訂空房，並於側邊欄查看「我的模擬預訂」清單與總價
  - 可隨時取消已模擬的預訂
- **員工後台**
  - 儀表板即時統計空房 / 已訂 / 整理中房數
  - 直接切換房間狀態（空房 ↔ 已訂 ↔ 維護整理）
  - 新增全新客房（房號、名稱、房型、價格、設備標籤）
- **即時通知**：所有操作皆有 Toast 提示訊息回饋

## 📁 檔案結構

```
roomilly/
├── index.html   # 頁面結構 (HTML)
├── style.css    # 自訂樣式 (CSS，Tailwind 以外的補充樣式)
├── script.js    # 應用邏輯 (JS：Supabase 存取、渲染、互動事件)
├── schema.sql   # Supabase 資料庫結構 / RLS 政策 / RPC 函式
└── README.md    # 本說明文件
```

> 檔案需放在**同一層目錄**下才能正常載入，`index.html` 透過相對路徑引用 `style.css` 與 `script.js`。

## 🛠 技術棧

- **Tailwind CSS**（CDN 版本，用於版面與樣式）
- **Font Awesome 6**（圖示）
- **Google Fonts**：Quicksand / Nunito
- 原生 **JavaScript**（無框架、無建置流程）
- **Supabase**：資料庫（Postgres）+ Auth 員工登入 + Realtime 即時同步

## 🔌 Supabase 串接設定

本專案已改為**真實串接 Supabase**，房間資料、預訂狀態皆存於雲端資料庫，並支援跨分頁/跨使用者即時同步。

### 權限設計

| 對象 | 權限 |
|------|------|
| 旅客前台 | 公開瀏覽所有房間（SELECT），無需登入；透過 `book_room()` / `cancel_booking()` 兩個 RPC 函式模擬預訂與退訂 |
| 員工後台 | 需以 Supabase Auth 帳密登入，登入後才能新增房間、修改房況（INSERT / UPDATE / DELETE） |

安全機制以 **RLS（Row Level Security）+ RPC 函式**達成：房間資料表本身只開放已登入員工寫入；旅客的預訂/取消動作則透過 `security definer` 的資料庫函式，在函式內部限制「只能把空房改成已訂」「只能取消已訂改回空房」，旅客無法任意竄改其他欄位。

### 建置步驟

1. **建立資料表與函式**
   打開 Supabase Dashboard → **SQL Editor**，貼上並執行 `schema.sql` 整份內容。這會建立 `rooms` 資料表、RLS 政策、`book_room()` / `cancel_booking()` 函式，並灌入預設的 6 筆種子房源。

2. **建立員工登入帳號**
   到 Supabase Dashboard → **Authentication → Users → Add user**，手動建立至少一組員工的信箱＋密碼（不開放自助註冊，避免任何人都能變成員工）。

3.（選用）**開啟 Realtime 即時同步**
   到 Supabase Dashboard → **Database → Replication**，將 `rooms` 資料表的 Realtime 開關打開。開啟後，員工在後台變更房況、旅客完成預訂，會即時同步到所有開著的分頁/裝置。若不開啟，資料仍會正確寫入，只是需要手動整理頁面才會看到別人造成的變化。

4. **填入專案金鑰**
   到 Supabase Dashboard → **Project Settings → API**，複製 `Project URL` 與 `anon public` key，貼到 `script.js` 最上方：

   ```js
   const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```

   > `anon public` key 設計上就是可以放在前端程式碼裡公開的（真正的存取控制交給 RLS 負責），請不要誤用 `service_role` key。

5. **開啟頁面**
   用瀏覽器打開 `index.html`（或部署到任意靜態網站託管服務）即可使用。

### 登入狀態的小提醒

`script.js` 中 Supabase 的登入狀態設定為 `persistSession: false`，也就是**不使用瀏覽器儲存機制保存登入狀態**，重新整理頁面後員工需要重新登入。這是刻意的簡化，避免和某些預覽環境（例如瀏覽器沙盒）對瀏覽器儲存 API 的限制衝突。若你把專案部署到自己的網站正式使用，且想要「登入後重新整理頁面仍保持登入」，可以把這個選項改回：

```js
auth: { persistSession: true }
```

## 🚀 使用方式

直接用瀏覽器開啟 `index.html` 即可運行（記得先完成上方的 Supabase 設定，否則會讀不到房間資料）。

```bash
# 或使用簡易本地伺服器（可選）
cd roomflow
python3 -m http.server 8000
# 瀏覽器開啟 http://localhost:8000
```

## 🖱 操作說明

| 模式 | 可執行動作 |
|------|-----------|
| 旅客前台 | 選擇入住/退房日期 → 篩選房型/搜尋 → 點擊「立即預訂」模擬下訂（無需登入） |
| 員工後台 | 點擊「員工後台」→ 輸入 Supabase 帳密登入 → 查看房況統計、切換房間狀態、新增客房、登出 |

## ⚠️ 注意事項

- 這是一個**教學/原型等級**的權限設計，適合展示與內部使用；正式上線前建議額外加上：速率限制（避免惡意連續呼叫 `book_room`）、更嚴謹的員工角色管理（例如自訂 `role` 欄位區分店長／櫃檯）、以及信箱驗證等機制。
- `anon` 角色可以呼叫 `book_room` / `cancel_booking`，任何知道房號的人理論上都能操作預訂，這與原本純前端展示版本的信任假設一致；如需更嚴謹的旅客身份綁定（例如「只能取消自己訂的房」），需要額外設計旅客帳號或訂單驗證碼機制。

---
© 2026 Roomilly 空房管理平台