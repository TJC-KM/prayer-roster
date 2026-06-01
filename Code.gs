/**
 * 每週禱告認領表 — 後端 v2
 * 三種認領：only this week / 每週固定(無限) / 指定 N 週。
 * 圖以 base64 存儲存格供顯示，同時備份一份到 Drive。
 * 刪除 / 換圖以「姓名相符」驗證。
 */

// ⬇⬇⬇ 把這裡換成你的試算表 ID（網址 /d/ 與 /edit 中間那一長串） ⬇⬇⬇
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID';
// ⬆⬆⬆ ────────────────────────────────────────────────── ⬆⬆⬆

const SHEET_NAME  = '認領紀錄v2'; // v2 新結構，與舊 7 欄分頁不相容，故用新分頁
const PRAYER_SHEET = '代禱事項';   // 單一共用代禱文字，存於另一頁籤
const FOLDER_NAME = '禱告認領簽名';
const DAY_LABELS  = ['日', '一', '二', '三', '四', '五', '六']; // 0=週日 ... 6=週六

// 欄位（1-indexed）：A id, B 建立時間, C 類型, D 起始週, E 週數, F 星期, G 姓名, H 圖, I 圖連結, J fileId, K 狀態, L 禱告目標
const COL = { id:1, created:2, type:3, start:4, weeks:5, day:6, name:7, img:8, link:9, fileId:10, status:11, goal:12 };
const HEADERS = ['id','建立時間','類型','起始週','週數(0=無限)','星期(0-6)','姓名','圖','圖檔連結','fileId','狀態','禱告目標'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('每週禱告認領表')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

/** 前端 POST 入口：依 action 分派，統一回傳 {ok, data} / {ok:false, error} */
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    let data;
    switch (req.action) {
      case 'init':       data = getInitialData(); break;
      case 'getSignups': data = getSignups(req.week); break;
      case 'submit':     data = submitSignup(req.day, req.name, req.img, req.mode, req.weeks, req.goal, req.week); break;
      case 'remove':     data = removeSignup(req.id, req.name); break;
      case 'replaceImg': data = replaceImage(req.id, req.name, req.img); break;
      case 'editGoal':   data = editGoal(req.id, req.name, req.goal); break;
      case 'getPrayer':  data = getPrayer(); break;
      case 'savePrayer': data = savePrayer(req.text); break;
      case 'migrateImages': data = migrateImagesToDrive(); break;
      case 'exportAll':  data = exportAll(); break;
      default: throw new Error('未知的動作：' + req.action);
    }
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    return jsonOut_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  // 起始週欄(D)固定純文字，避免 Sheet 把 'yyyy-MM-dd' 自動轉成日期儲存格
  sh.getRange('D2:D').setNumberFormat('@');
  return sh;
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

/* ---------- 週次工具 ---------- */

/** 任一日期 → 該週「週日」的 yyyy-MM-dd */
function weekKeyOf_(date) {
  const tz = Session.getScriptTimeZone();
  const dow = Number(Utilities.formatDate(date, tz, 'u')) % 7; // u:1=Mon..7=Sun → %7 使週日=0
  const sunday = new Date(date.getTime() - dow * 86400000);
  return Utilities.formatDate(sunday, tz, 'yyyy-MM-dd');
}
function currentWeekKey_() { return weekKeyOf_(new Date()); }

/** 'yyyy-MM-dd' 或 Date → 乾淨的 'yyyy-MM-dd' 字串 */
function normWeek_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim();
}

/** 'yyyy-MM-dd' → 本地 Date（當天 00:00） */
function parseKey_(key) {
  const p = String(key).split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** weekKey → 顯示用標籤，例如「5/24–5/30」 */
function weekLabel_(weekKey) {
  const sun = parseKey_(weekKey);
  const sat = new Date(sun.getTime() + 6 * 86400000);
  return (sun.getMonth() + 1) + '/' + sun.getDate() + '–' + (sat.getMonth() + 1) + '/' + sat.getDate();
}

/** 兩個週日之間相差幾週（target - start），可為負 */
function weeksDiff_(startKey, targetKey) {
  const ms = parseKey_(targetKey).getTime() - parseKey_(startKey).getTime();
  return Math.round(ms / (7 * 86400000));
}

/** 某筆認領在指定週是否該顯示 */
function rowVisibleOn_(row, targetKey) {
  if (String(row[COL.status - 1]) !== 'active') return false;
  const start = normWeek_(row[COL.start - 1]);
  if (!start) return false;
  const weeks = Number(row[COL.weeks - 1]) || 0; // 0 = 無限
  const diff = weeksDiff_(start, targetKey);
  if (diff < 0) return false;
  return weeks === 0 || diff < weeks;
}

/** 該筆的徽章文字 */
function badgeOf_(type, weeks) {
  if (type === 'fixed') return '固定';
  if (type === 'nweeks') return (Number(weeks) || 0) + '週';
  return '';
}

/* ---------- 讀取 ---------- */

/** 指定週次的七天認領清單（含固定/N週自動展開） */
function getSignups(weekKey) {
  weekKey = weekKey || currentWeekKey_();
  const sh = getSheet_();
  const last = sh.getLastRow();
  const result = { 0:[],1:[],2:[],3:[],4:[],5:[],6:[] };
  if (last < 2) return result;
  const rows = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const tz = Session.getScriptTimeZone();
  rows.forEach(function (row) {
    if (!rowVisibleOn_(row, weekKey)) return;
    const day = Number(row[COL.day - 1]);
    if (!result[day]) return;
    const type = String(row[COL.type - 1]);
    result[day].push({
      id: row[COL.id - 1],
      name: row[COL.name - 1],
      time: row[COL.created - 1] ? Utilities.formatDate(new Date(row[COL.created - 1]), tz, 'MM/dd HH:mm') : '',
      img: row[COL.img - 1],
      goal: row[COL.goal - 1] || '',
      type: type,
      badge: badgeOf_(type, row[COL.weeks - 1])
    });
  });
  return result;
}

/** 週次清單（最早到本週，含有任一認領的週；本週一定列出） */
const FUTURE_WEEKS = 8; // 往後可預先報名/檢視的週數（約兩個月）

function getWeekList() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  const cur = currentWeekKey_();
  const tz = Session.getScriptTimeZone();
  const rows = (last >= 2) ? sh.getRange(2, 1, last - 1, HEADERS.length).getValues() : [];

  // 最早起始週（過去也納入有資料的週）
  let minKey = cur;
  rows.forEach(function (row) {
    const s = normWeek_(row[COL.start - 1]);
    if (s && s < minKey) minKey = s;
  });
  // 未來上限 = 本週 + FUTURE_WEEKS 週
  const futureLimit = Utilities.formatDate(
    new Date(parseKey_(cur).getTime() + FUTURE_WEEKS * 7 * 86400000), tz, 'yyyy-MM-dd');

  const out = [];
  let k = minKey;
  let guard = 0;
  while (k <= futureLimit && guard < 600) {
    const isCur = (k === cur);
    const isFuture = (k > cur);
    const hasAny = rows.some(function (row) { return rowVisibleOn_(row, k); });
    // 過去週要有資料才列；本週與未來週一律列出（可預先報名）
    if (hasAny || isCur || isFuture) {
      out.push({ key: k, label: weekLabel_(k), isCurrent: isCur, isFuture: isFuture });
    }
    const next = new Date(parseKey_(k).getTime() + 7 * 86400000);
    k = Utilities.formatDate(next, tz, 'yyyy-MM-dd');
    guard++;
  }
  return out.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
}

function getInitialData() {
  const cur = currentWeekKey_();
  return { currentWeek: cur, weeks: getWeekList(), signups: getSignups(cur), prayer: getPrayer() };
}

/* ---------- 代禱事項（單一共用文字，存 代禱事項 頁籤 A1） ---------- */

function getPrayerSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(PRAYER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PRAYER_SHEET);
    sh.getRange('A1').setValue('');
    sh.getRange('B1').setValue(''); // 最後更新時間
  }
  return sh;
}

function getPrayer() {
  const sh = getPrayerSheet_();
  return {
    text: String(sh.getRange('A1').getValue() || ''),
    updated: sh.getRange('B1').getValue()
      ? Utilities.formatDate(new Date(sh.getRange('B1').getValue()), Session.getScriptTimeZone(), 'MM/dd HH:mm')
      : ''
  };
}

function savePrayer(text) {
  text = (text == null ? '' : String(text)).slice(0, 5000);
  const sh = getPrayerSheet_();
  sh.getRange('A1').setValue(text);
  sh.getRange('B1').setValue(new Date());
  return getPrayer();
}

/* ---------- 寫入 ---------- */

function decodeMode_(mode, weeks) {
  // 回傳 {type, weeks}
  if (mode === 'fixed') return { type: 'fixed', weeks: 0 };
  if (mode === 'nweeks') {
    const n = Math.max(1, Math.min(520, Math.floor(Number(weeks) || 0)));
    if (n < 1) throw new Error('週數需 ≥ 1');
    return { type: 'nweeks', weeks: n };
  }
  return { type: 'once', weeks: 1 };
}

/** Drive fileId → 可內嵌的縮圖網址 */
function driveImgUrl_(fileId) {
  return 'https://lh3.googleusercontent.com/d/' + fileId;
}

/**
 * 存圖：PNG 存到 Drive，一律回傳 Drive 內嵌連結（不再把 base64 塞進儲存格，縮小查詢回應）。
 * 回傳 { cell, link, fileId }；cell = 前端 <img src> 用的 Drive 連結。
 */
function saveImage_(name, day, week, imageDataUrl) {
  if (!imageDataUrl) return { cell: '', link: '', fileId: '' };
  if (imageDataUrl.indexOf('data:image/png;base64,') !== 0) throw new Error('圖片格式無效');
  const b64 = imageDataUrl.split(',')[1];
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = week + '_週' + DAY_LABELS[day] + '_' + (name || '匿名') + '_' + stamp + '.png';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', fileName);
  const file = getFolder_().createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  const url = driveImgUrl_(file.getId());
  return { cell: url, link: file.getUrl(), fileId: file.getId() };
}

/**
 * 一次性遷移：把舊的 base64 圖（H 欄）轉存成 Drive 連結。冪等，已是連結的跳過。
 * 透過 action=migrateImages 觸發。回傳處理筆數。
 */
function migrateImagesToDrive() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return { migrated: 0, total: 0 };
  const n = last - 1;
  const imgs = sh.getRange(2, COL.img, n, 1).getValues();
  const ids  = sh.getRange(2, COL.fileId, n, 1).getValues();
  let migrated = 0;
  for (let i = 0; i < n; i++) {
    const cell = String(imgs[i][0] || '');
    if (cell.indexOf('data:image/png;base64,') !== 0) continue; // 只處理 base64
    let fileId = String(ids[i][0] || '');
    try {
      if (fileId) {
        // 已有備份檔，直接設公開並改連結
        DriveApp.getFileById(fileId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } else {
        // 沒有 fileId，重新存一份
        const b64 = cell.split(',')[1];
        const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'migrated_' + (i + 2) + '.png');
        const file = getFolder_().createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        fileId = file.getId();
        sh.getRange(i + 2, COL.fileId).setValue(fileId);
      }
      sh.getRange(i + 2, COL.img).setValue(driveImgUrl_(fileId));
      migrated++;
    } catch (e) { /* 單筆失敗略過，不中斷 */ }
  }
  return { migrated: migrated, total: n };
}

/** 匯出整張認領表 + 代禱事項，供搬遷到其它後端（D1）使用 */
function exportAll() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  const rows = [];
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
    data.forEach(function (r) {
      rows.push({
        id: String(r[COL.id - 1]),
        created: r[COL.created - 1] ? new Date(r[COL.created - 1]).getTime() : 0,
        type: String(r[COL.type - 1]),
        start: normWeek_(r[COL.start - 1]),
        weeks: Number(r[COL.weeks - 1]) || 0,
        day: Number(r[COL.day - 1]),
        name: String(r[COL.name - 1]),
        img: String(r[COL.img - 1] || ''),
        goal: String(r[COL.goal - 1] || ''),
        status: String(r[COL.status - 1] || 'active')
      });
    });
  }
  return { rows: rows, prayer: getPrayer() };
}

/** 報名：day 0-6、name、img(可空)、mode('once'|'fixed'|'nweeks')、weeks(N) */
function submitSignup(day, name, img, mode, weeks, goal, week) {
  day = Number(day);
  name = (name || '').toString().trim().slice(0, 30);
  goal = (goal == null ? '' : String(goal)).trim().slice(0, 200);
  if (day < 0 || day > 6) throw new Error('星期錯誤');
  if (!name) throw new Error('請輸入稱呼');
  if (img && img.indexOf('data:image/png;base64,') !== 0) throw new Error('簽名圖無效');

  const m = decodeMode_(mode, weeks);
  const cur = currentWeekKey_();
  week = normWeek_(week) || cur;
  if (week < cur) throw new Error('不能報名過去的週次');
  const saved = saveImage_(name, day, week, img);

  getSheet_().appendRow([
    Utilities.getUuid(), new Date(), m.type, week, m.weeks, day, name,
    saved.cell, saved.link, saved.fileId, 'active', goal
  ]);
  return getSignups(week);
}

/** 找某 id 的列號（1-indexed），找不到回 -1 */
function findRowById_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const ids = sh.getRange(2, COL.id, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return -1;
}

/** 刪除（標記 removed），需姓名相符 */
function removeSignup(id, name) {
  const sh = getSheet_();
  const r = findRowById_(sh, id);
  if (r < 0) throw new Error('找不到該筆認領');
  const rowName = String(sh.getRange(r, COL.name).getValue()).trim();
  if (rowName !== (name || '').toString().trim()) throw new Error('姓名不符，無法刪除');
  sh.getRange(r, COL.status).setValue('removed');
  return getSignups(currentWeekKey_());
}

/** 換圖，需姓名相符 */
function replaceImage(id, name, img) {
  if (!img || img.indexOf('data:image/png;base64,') !== 0) throw new Error('新圖無效');
  const sh = getSheet_();
  const r = findRowById_(sh, id);
  if (r < 0) throw new Error('找不到該筆認領');
  const rowName = String(sh.getRange(r, COL.name).getValue()).trim();
  if (rowName !== (name || '').toString().trim()) throw new Error('姓名不符，無法換圖');

  const day = Number(sh.getRange(r, COL.day).getValue());
  const week = normWeek_(sh.getRange(r, COL.start).getValue());
  const saved = saveImage_(rowName, day, week, img);
  sh.getRange(r, COL.img).setValue(saved.cell);
  sh.getRange(r, COL.link).setValue(saved.link);
  sh.getRange(r, COL.fileId).setValue(saved.fileId);
  return getSignups(currentWeekKey_());
}

/** 修改個人禱告目標，需姓名相符 */
function editGoal(id, name, goal) {
  goal = (goal == null ? '' : String(goal)).trim().slice(0, 200);
  const sh = getSheet_();
  const r = findRowById_(sh, id);
  if (r < 0) throw new Error('找不到該筆認領');
  const rowName = String(sh.getRange(r, COL.name).getValue()).trim();
  if (rowName !== (name || '').toString().trim()) throw new Error('姓名不符，無法修改');
  sh.getRange(r, COL.goal).setValue(goal);
  return getSignups(currentWeekKey_());
}
