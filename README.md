# Roomilly - 智慧空房管理平台

一個純前端的旅宿客房狀態管理模擬系統，提供「旅客前台」與「員工後台」兩種模式，可即時查看、篩選、模擬預訂與管理客房狀態。

## ✨ 功能特色

- **雙模式切換**：一鍵切換「旅客前台」與「員工後台」視角
- **旅客會員系統（JWT 登入）**
  - 信箱／密碼註冊與登入，登入後取得 JWT 存取權杖
  - **未登入只能瀏覽，登入後才能訂房**（前端擋 + 資料庫端強制驗證）
  - 權杖保存於瀏覽器並自動續期，重新整理頁面仍維持登入
  - 訂房紀錄綁定帳號，換裝置登入也看得到；且只能取消自己訂的房
- **旅客前台**
  - 依入住／退房日期、房型篩選空房
  - 關鍵字搜尋房號、房名、設備標籤
  - 線上預訂空房，並於側邊欄查看「我的預訂」清單與總價
  - 可隨時取消自己的預訂
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

本專案已**真實串接 Supabase**，房間資料、預訂狀態皆存於雲端資料庫，並支援跨分頁/跨使用者即時同步。

### 權限設計

| 對象 | 權限 |
|------|------|
| 未登入訪客（`anon`） | 只能公開瀏覽所有房間（SELECT）。**不能訂房** —— 資料庫已 `revoke` 掉 `anon` 對 `book_room()` / `cancel_booking()` 的執行權限 |
| 旅客會員（`authenticated`） | 登入取得 JWT 後，可透過 `book_room()` 訂房、`cancel_booking()` 退訂；**只能取消 `booked_by` 等於自己 uid 的房間** |
| 員工（列於 `staff` 資料表） | 可直接新增房間、修改房況、刪除（INSERT / UPDATE / DELETE），也可代客取消任何預訂 |

安全機制以 **RLS（Row Level Security）+ `security definer` RPC 函式**達成：

- `rooms` 資料表本身只開放**員工**寫入，其他人一律唯讀。
- 旅客的預訂／取消動作走資料庫函式，函式第一件事就是檢查 `auth.uid()`：**沒有帶有效 JWT 就直接 `raise exception '請先登入會員才能訂房'`**。前端的「登入後即可預訂」按鈕鎖只是體驗，就算有人繞過前端直接打 API 也訂不到房。
- 函式內部只允許「vacant → booked」「booked → vacant」這兩種轉換，旅客無法竄改房價、房名等其他欄位。

> **員工身分認定**：員工名單放在獨立的 `staff` 資料表，並以 `is_staff()` 函式判斷。刻意**不**使用 `user_metadata` 內的 `role` 欄位 —— 那是使用者自己就能改的資料，開放旅客自助註冊後，任何人都能把自己標成 staff。

### 建置步驟

1. **建立資料表與函式**
   打開 Supabase Dashboard → **SQL Editor**，貼上並執行 `schema.sql` 整份內容。這會建立 `rooms`／`staff` 資料表、RLS 政策、`is_staff()` / `book_room()` / `cancel_booking()` 函式，並灌入預設的 6 筆種子房源。整份 SQL 可重複執行。

   > ⚠️ 這一步是必要的。若沒執行，`is_staff()` 不存在，員工後台會一律判定為「沒有員工權限」而無法進入（刻意 fail closed）。

2. **開放旅客自助註冊**
   到 Supabase Dashboard → **Authentication → Providers → Email**，確認 Email 供應商為啟用狀態。
   若希望註冊後可以直接登入訂房（不必收驗證信），把 **Confirm email** 關閉；保持開啟也可以，前端會提示使用者「請至信箱點擊驗證連結後再登入」。

3. **建立員工帳號並加入 staff 名單**
   先到 **Authentication → Users → Add user** 建立員工的信箱＋密碼，接著到 **SQL Editor** 執行（信箱換成實際的員工信箱）：

   ```sql
   insert into public.staff (user_id, email)
   select id, email from auth.users where email = 'staff@example.com'
   on conflict (user_id) do nothing;
   ```

   只有出現在 `staff` 資料表裡的帳號才能進入員工後台；自助註冊的旅客帳號即使登入成功，點「員工後台」也只會看到「此帳號沒有員工權限」。

4.（選用）**開啟 Realtime 即時同步**
   到 Supabase Dashboard → **Database → Replication**，將 `rooms` 資料表的 Realtime 開關打開。開啟後，員工在後台變更房況、旅客完成預訂，會即時同步到所有開著的分頁/裝置。若不開啟，資料仍會正確寫入，只是需要手動整理頁面才會看到別人造成的變化。

5. **填入專案金鑰**
   到 Supabase Dashboard → **Project Settings → API**，複製 `Project URL` 與 `anon public` key，貼到 `script.js` 最上方：

   ```js
   const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
   ```

   > `anon public` key 設計上就是可以放在前端程式碼裡公開的（真正的存取控制交給 RLS 負責），請不要誤用 `service_role` key。

6. **開啟頁面**
   用瀏覽器打開 `index.html`（或部署到任意靜態網站託管服務）即可使用。

### 🔑 JWT 登入流程說明

1. 旅客在頁首點「會員登入」→ 以信箱密碼登入／註冊，呼叫 Supabase Auth 的 `signInWithPassword()` / `signUp()`。
2. 登入成功後，Supabase 回傳一組 **JWT access token**（內含 `sub` = 使用者 uid、`role` = `authenticated`、`exp` 到期時間）與 refresh token。
3. supabase-js 會把權杖存進 `localStorage`（key：`roomilly-auth`），並在**之後每一個 API 請求自動附上** `Authorization: Bearer <JWT>`；到期前也會自動用 refresh token 續期。
4. 資料庫端收到請求後解開 JWT，`auth.uid()` 便是該旅客的 uid：
   - `book_room()` 先檢查 `auth.uid() is null` → 未登入直接擋下。
   - 訂房成功時把 `booked_by` 寫成該 uid，因此「我的預訂」是跟著帳號走的。
   - `cancel_booking()` 要求 `booked_by = auth.uid()`，旅客動不了別人的訂房。
5. 登出時呼叫 `signOut()` 清掉 localStorage 內的權杖；其他分頁也會透過 `onAuthStateChange` 一起同步登出狀態。

> 本專案的 `persistSession` 已設為 `true`（重新整理仍保持登入）。若你的預覽環境（例如某些瀏覽器沙盒）禁用 localStorage 導致登入異常，可在 `script.js` 最上方改回 `persistSession: false`，代價是每次重新整理都要重新登入。

## 🚀 使用方式

直接開啟 [https://billydayo.github.io/hoteltest/] 即可使用，無需下載或安裝任何東西。

## 🖱 操作說明

| 模式 | 可執行動作 |
|------|-----------|
| 旅客前台（未登入） | 瀏覽、篩選、搜尋所有客房；卡片按鈕顯示「登入後即可預訂」，點下去會跳出會員登入視窗 |
| 旅客前台（已登入） | 選擇入住/退房日期 → 篩選房型/搜尋 → 點擊「立即預訂」下訂 → 於側邊欄查看「我的預訂」與總價 → 可隨時退訂自己的房間 |
| 員工後台 | 點擊「員工後台」→ 輸入員工帳密登入（需在 `staff` 名單內）→ 查看房況統計、切換房間狀態、新增客房、登出 |

小提醒：未登入時點「立即預訂」，系統會記住你想訂的那間房，**登入完成後自動接續開啟預訂確認視窗**，不用再找一次。

## ⚠️ 注意事項

- 這是一個**教學/原型等級**的權限設計，適合展示與內部使用；正式上線前建議額外加上：速率限制（避免已登入帳號惡意連續呼叫 `book_room`）、更嚴謹的員工角色管理（例如在 `staff` 表加 `role` 欄位區分店長／櫃檯），以及強制信箱驗證。
- 目前「一個房間同時只有一筆預訂」，房況是單一 `status` 欄位而非依日期區間管理，因此**日期篩選只影響顯示與寫入的日期欄位，不會做跨日期的空房計算**。若要支援「同一間房不同日期分別可訂」，需要另外建立 `bookings` 訂單資料表並改以日期區間判斷是否重疊。
- 一個帳號同時是旅客身分與（若列於 `staff`）員工身分；前後台共用同一組 JWT session，登出會同時登出兩邊。

---
© 2026 Roomilly 空房管理平台