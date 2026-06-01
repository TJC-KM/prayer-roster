# PrayerRoster — Cloudflare Worker 後端（D1）

取代原 Google Apps Script。前端 `index.html` 的 `API_URL` 改指向此 Worker 的網址。

## 一次性部署步驟

> 需先 `npm install -g wrangler` 且 `wrangler login`（瀏覽器授權你的 Cloudflare 帳號）。

在 `worker/` 目錄下執行：

```bash
cd worker

# 1. 建立 D1 資料庫（會印出 database_id）
wrangler d1 create prayer-roster
#   → 把印出的 database_id 貼到 wrangler.toml 的 database_id

# 2. 建立資料表結構（遠端）
wrangler d1 execute prayer-roster --remote --file=schema.sql

# 3. 灌入從試算表匯出的現有資料（遠端）
wrangler d1 execute prayer-roster --remote --file=seed.sql

# 4. 部署 Worker
wrangler deploy
#   → 印出 https://prayer-roster.<你的子網域>.workers.dev
```

部署後把那個 workers.dev 網址填回 `index.html` 的 `API_URL`，commit + push。

## 架構
- 資料庫 = D1（SQLite），表 `signups` / `image_blobs` / `prayer`，見 `schema.sql`。
- 新報名的簽名圖：base64 存 `image_blobs`，前端 `<img>` 透過 `GET /img?id=<signupId>` 取得（清單查詢不含圖，回應極小）。
- 舊圖：沿用既有的 Google Drive 連結字串，原樣顯示。
- 時區：UTC+8 寫死，週次以該週週日 yyyy-MM-dd 為 key。
- action 與 GAS 完全一致：init / getSignups / submit / remove / replaceImg / editGoal / getPrayer / savePrayer。

## 之後改了程式碼怎麼重新部署
```bash
cd worker && wrangler deploy
```

## 查資料（取代打開試算表）
```bash
wrangler d1 execute prayer-roster --remote --command "SELECT name,start,type,status,goal FROM signups ORDER BY created DESC"
```
