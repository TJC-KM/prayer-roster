/**
 * 每週禱告認領表 — 後端（含歷史紀錄）
 * 資料存進指定的試算表，簽名圖另存一份到你 Drive 的「禱告認領簽名」資料夾。
 * 每筆報名以「該週週日日期」為週次索引，自動分週保存。
 */

// ⬇⬇⬇ 把這裡換成你的試算表 ID（網址 /d/ 與 /edit 中間那一長串） ⬇⬇⬇
const SPREADSHEET_ID = 'PASTE_YOUR_SPREADSHEET_ID';
// ⬆⬆⬆ ────────────────────────────────────────────────── ⬆⬆⬆

const SHEET_NAME  = '禱告認領';
const FOLDER_NAME = '禱告認領簽名';
const DAY_LABELS  = ['日', '一', '二', '三', '四', '五', '六']; // 0=週日 ... 6=週六

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
      case 'init':
        data = getInitialData();
        break;
      case 'getSignups':
        data = getSignups(req.week);
        break;
      case 'submit':
        data = submitSignup(req.day, req.name, req.img);
        break;
      default:
        throw new Error('未知的動作：' + req.action);
    }
    return jsonOut_({ ok: true, data: data });
  } catch (err) {
    return jsonOut_({ ok: false, error: (err && err.message) ? err.message : String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['時間', '週次', '星期(0-6)', '姓名', '簽名圖檔連結', 'fileId', '簽名(base64)']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

/** 取得某日期所屬「那一週週日」的 yyyy-MM-dd（台灣無日光節約，整數天運算安全） */
function weekKeyOf_(date) {
  const tz = Session.getScriptTimeZone();
  const dow = Number(Utilities.formatDate(date, tz, 'u')) % 7; // u: 1=Mon..7=Sun → %7 使週日=0
  const sunday = new Date(date.getTime() - dow * 86400000);
  return Utilities.formatDate(sunday, tz, 'yyyy-MM-dd');
}

function currentWeekKey_() {
  return weekKeyOf_(new Date());
}

/** weekKey(週日) → 顯示用標籤，例如「5/31–6/6」 */
function weekLabel_(weekKey) {
  const parts = weekKey.split('-');
  const sun = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  const sat = new Date(sun.getTime() + 6 * 86400000);
  return (sun.getMonth() + 1) + '/' + sun.getDate() + '–' + (sat.getMonth() + 1) + '/' + sat.getDate();
}

/** 回傳指定週次的七天報名清單；省略 weekKey 則用本週 */
function getSignups(weekKey) {
  weekKey = weekKey || currentWeekKey_();
  const sh = getSheet_();
  const last = sh.getLastRow();
  const result = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  if (last < 2) return result;
  const data = sh.getRange(2, 1, last - 1, 7).getValues();
  const tz = Session.getScriptTimeZone();
  data.forEach(function (row) {
    if (String(row[1]) !== weekKey) return;
    const day = Number(row[2]);
    if (result[day]) {
      result[day].push({
        name: row[3],
        time: row[0] ? Utilities.formatDate(new Date(row[0]), tz, 'MM/dd HH:mm') : '',
        img: row[6]
      });
    }
  });
  return result;
}

/** 回傳所有出現過的週次（新到舊），標記哪個是本週 */
function getWeekList() {
  const sh = getSheet_();
  const last = sh.getLastRow();
  const cur = currentWeekKey_();
  const set = {};
  set[cur] = true; // 本週一定列出，即使尚無人報名
  if (last >= 2) {
    sh.getRange(2, 2, last - 1, 1).getValues().forEach(function (r) {
      if (r[0]) set[String(r[0])] = true;
    });
  }
  return Object.keys(set).sort().reverse().map(function (k) {
    return { key: k, label: weekLabel_(k), isCurrent: k === cur };
  });
}

/** 首次載入用：一次回傳本週資訊、週次清單、本週報名 */
function getInitialData() {
  const cur = currentWeekKey_();
  return {
    currentWeek: cur,
    weeks: getWeekList(),
    signups: getSignups(cur)
  };
}

/** 報名（只記到本週）：dayIndex 0-6、name、imageDataUrl */
function submitSignup(dayIndex, name, imageDataUrl) {
  dayIndex = Number(dayIndex);
  name = (name || '').toString().trim().slice(0, 30);
  if (dayIndex < 0 || dayIndex > 6) throw new Error('星期錯誤');
  if (!imageDataUrl || imageDataUrl.indexOf('data:image/png;base64,') !== 0) {
    throw new Error('簽名無效，請重新簽名');
  }

  const b64 = imageDataUrl.split(',')[1];
  const week = currentWeekKey_();

  // 簽名 PNG 存 Drive 備份
  const folder = getFolder_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = week + '_週' + DAY_LABELS[dayIndex] + '_' + (name || '匿名') + '_' + stamp + '.png';
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', fileName);
  const file = folder.createFile(blob);

  // 寫一列到 Sheet
  getSheet_().appendRow([
    new Date(), week, dayIndex, name || '匿名',
    file.getUrl(), file.getId(), imageDataUrl
  ]);

  return getSignups(week);
}
