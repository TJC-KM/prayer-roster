-- 每週禱告認領 — D1 schema
-- 對應原 GAS 試算表「認領紀錄v2」11+1 欄結構

CREATE TABLE IF NOT EXISTS signups (
  id        TEXT PRIMARY KEY,
  created   INTEGER NOT NULL,         -- epoch ms（建立時間）
  type      TEXT NOT NULL,            -- once | fixed | nweeks
  start     TEXT NOT NULL,            -- 起始週 yyyy-MM-dd（該週週日）
  weeks     INTEGER NOT NULL DEFAULT 1, -- 0 = 無限
  day       INTEGER NOT NULL,         -- 0=週日 ... 6=週六
  name      TEXT NOT NULL,
  img       TEXT DEFAULT '',          -- Drive 連結（舊資料）或 'd1:<id>'（新圖存 image_blobs）
  goal      TEXT DEFAULT '',
  status    TEXT NOT NULL DEFAULT 'active'  -- active | removed
);

CREATE INDEX IF NOT EXISTS idx_signups_status_start ON signups(status, start);

-- 新報名的簽名圖（base64）。清單查詢不讀此表，由 /img?id= 端點單獨服務。
CREATE TABLE IF NOT EXISTS image_blobs (
  signup_id TEXT PRIMARY KEY,
  data_url  TEXT NOT NULL,            -- data:image/png;base64,....
  FOREIGN KEY (signup_id) REFERENCES signups(id)
);

-- 單一共用代禱事項（只有一列，id=1）
CREATE TABLE IF NOT EXISTS prayer (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  text    TEXT DEFAULT '',
  updated INTEGER                     -- epoch ms
);
INSERT OR IGNORE INTO prayer (id, text, updated) VALUES (1, '', NULL);
