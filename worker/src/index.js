/**
 * 每週禱告認領 — Cloudflare Worker 後端（D1）
 * 取代原 Google Apps Script。前端以 POST text/plain JSON {action,...} 呼叫，
 * 統一回傳 {ok, data} / {ok:false, error}。
 *
 * 時區：台灣 UTC+8（無日光節約），週次以「該週週日」的 yyyy-MM-dd 為索引。
 */

const TZ_OFFSET_MS = 8 * 3600 * 1000; // UTC+8
const DAY = 86400000;
const FUTURE_WEEKS = 8;

/* ---------- 時間/週次工具（以 UTC+8 計算） ---------- */
function nowTW() { return new Date(Date.now() + TZ_OFFSET_MS); } // 取 UTC 部位即等於台灣時間
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtDate(d) { // 用 UTC getter（因已平移）→ yyyy-MM-dd
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}
function fmtTime(epochMs) { // MM/dd HH:mm（台灣）
  const d = new Date(epochMs + TZ_OFFSET_MS);
  return pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}
function weekKeyOf(d) { // d 為「已平移成台灣」的 Date；回傳該週週日
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const sunday = new Date(d.getTime() - dow * DAY);
  return fmtDate(sunday);
}
function currentWeekKey() { return weekKeyOf(nowTW()); }
function parseKey(key) { // yyyy-MM-dd → epoch（UTC 當天 00:00）
  const p = String(key).split('-');
  return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function normWeek(v) { return String(v == null ? '' : v).trim(); }
function weekLabel(key) {
  const sun = new Date(parseKey(key));
  const sat = new Date(parseKey(key) + 6 * DAY);
  return (sun.getUTCMonth() + 1) + '/' + sun.getUTCDate() + '–' + (sat.getUTCMonth() + 1) + '/' + sat.getUTCDate();
}
function weeksDiff(startKey, targetKey) {
  return Math.round((parseKey(targetKey) - parseKey(startKey)) / (7 * DAY));
}
function badgeOf(type, weeks) {
  if (type === 'fixed') return '固定';
  if (type === 'nweeks') return (Number(weeks) || 0) + '週';
  return '';
}
function rowVisibleOn(row, targetKey) {
  if (row.status !== 'active') return false;
  const start = normWeek(row.start);
  if (!start) return false;
  const weeks = Number(row.weeks) || 0;
  const diff = weeksDiff(start, targetKey);
  if (diff < 0) return false;
  return weeks === 0 || diff < weeks;
}
function uuid() { return crypto.randomUUID(); }

/* ---------- 讀取 ---------- */
async function allRows(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, created, type, start, weeks, day, name, img, goal, status FROM signups'
  ).all();
  return results || [];
}

function toClient(row) {
  return {
    id: row.id,
    name: row.name,
    time: row.created ? fmtTime(Number(row.created)) : '',
    img: imgUrl(row),
    goal: row.goal || '',
    type: row.type,
    badge: badgeOf(row.type, row.weeks)
  };
}

// img 欄位：'d1:<id>' → 由本 Worker /img 端點服務；其餘（Drive 連結或空）原樣回傳
function imgUrl(row) {
  const v = String(row.img || '');
  if (v.indexOf('d1:') === 0) return './img?id=' + encodeURIComponent(row.id);
  return v;
}

async function getSignups(env, weekKey) {
  weekKey = weekKey || currentWeekKey();
  const result = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const rows = await allRows(env);
  rows.forEach(row => {
    if (!rowVisibleOn(row, weekKey)) return;
    const day = Number(row.day);
    if (!result[day]) return;
    result[day].push(toClient(row));
  });
  return result;
}

async function getWeekList(env) {
  const cur = currentWeekKey();
  const rows = await allRows(env);
  let minKey = cur;
  rows.forEach(row => { const s = normWeek(row.start); if (s && s < minKey) minKey = s; });
  const futureLimit = fmtDate(new Date(parseKey(cur) + FUTURE_WEEKS * 7 * DAY));

  const out = [];
  let k = minKey, guard = 0;
  while (k <= futureLimit && guard < 600) {
    const isCur = (k === cur);
    const isFuture = (k > cur);
    const hasAny = rows.some(row => rowVisibleOn(row, k));
    if (hasAny || isCur || isFuture) out.push({ key: k, label: weekLabel(k), isCurrent: isCur, isFuture: isFuture });
    k = fmtDate(new Date(parseKey(k) + 7 * DAY));
    guard++;
  }
  return out.sort((a, b) => a.key < b.key ? 1 : -1);
}

async function getPrayer(env) {
  const row = await env.DB.prepare('SELECT text, updated FROM prayer WHERE id=1').first();
  return { text: (row && row.text) || '', updated: (row && row.updated) ? fmtTime(Number(row.updated)) : '' };
}

async function getInitialData(env) {
  return {
    currentWeek: currentWeekKey(),
    weeks: await getWeekList(env),
    signups: await getSignups(env, currentWeekKey()),
    prayer: await getPrayer(env)
  };
}

/* ---------- 寫入 ---------- */
function decodeMode(mode, weeks) {
  if (mode === 'fixed') return { type: 'fixed', weeks: 0 };
  if (mode === 'nweeks') {
    const n = Math.max(1, Math.min(520, Math.floor(Number(weeks) || 0)));
    return { type: 'nweeks', weeks: n };
  }
  return { type: 'once', weeks: 1 };
}

async function submitSignup(env, day, name, img, mode, weeks, goal, week) {
  day = Number(day);
  name = (name || '').toString().trim().slice(0, 30);
  goal = (goal == null ? '' : String(goal)).trim().slice(0, 200);
  if (day < 0 || day > 6) throw new Error('星期錯誤');
  if (!name) throw new Error('請輸入稱呼');
  if (img && img.indexOf('data:image/png;base64,') !== 0) throw new Error('簽名圖無效');

  const m = decodeMode(mode, weeks);
  const cur = currentWeekKey();
  week = normWeek(week) || cur;
  if (week < cur) throw new Error('不能報名過去的週次');

  const id = uuid();
  const imgRef = img ? 'd1:' + id : '';
  await env.DB.prepare(
    'INSERT INTO signups (id, created, type, start, weeks, day, name, img, goal, status) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(id, Date.now(), m.type, week, m.weeks, day, name, imgRef, goal, 'active').run();
  if (img) {
    await env.DB.prepare('INSERT INTO image_blobs (signup_id, data_url) VALUES (?, ?)').bind(id, img).run();
  }
  return await getSignups(env, week);
}

async function rowById(env, id) {
  return await env.DB.prepare('SELECT * FROM signups WHERE id=?').bind(id).first();
}

async function removeSignup(env, id, name) {
  const row = await rowById(env, id);
  if (!row) throw new Error('找不到該筆認領');
  if (String(row.name).trim() !== (name || '').toString().trim()) throw new Error('姓名不符，無法刪除');
  await env.DB.prepare("UPDATE signups SET status='removed' WHERE id=?").bind(id).run();
  return await getSignups(env, currentWeekKey());
}

async function replaceImage(env, id, name, img) {
  if (!img || img.indexOf('data:image/png;base64,') !== 0) throw new Error('新圖無效');
  const row = await rowById(env, id);
  if (!row) throw new Error('找不到該筆認領');
  if (String(row.name).trim() !== (name || '').toString().trim()) throw new Error('姓名不符，無法換圖');
  await env.DB.prepare('INSERT OR REPLACE INTO image_blobs (signup_id, data_url) VALUES (?, ?)').bind(id, img).run();
  await env.DB.prepare("UPDATE signups SET img=? WHERE id=?").bind('d1:' + id, id).run();
  return await getSignups(env, currentWeekKey());
}

async function editGoal(env, id, name, goal) {
  goal = (goal == null ? '' : String(goal)).trim().slice(0, 200);
  const row = await rowById(env, id);
  if (!row) throw new Error('找不到該筆認領');
  if (String(row.name).trim() !== (name || '').toString().trim()) throw new Error('姓名不符，無法修改');
  await env.DB.prepare('UPDATE signups SET goal=? WHERE id=?').bind(goal, id).run();
  return await getSignups(env, currentWeekKey());
}

async function savePrayer(env, text) {
  text = (text == null ? '' : String(text)).slice(0, 5000);
  await env.DB.prepare('UPDATE prayer SET text=?, updated=? WHERE id=1').bind(text, Date.now()).run();
  return await getPrayer(env);
}

/* ---------- HTTP 入口 ---------- */
const JSON_HEADERS = {
  'Content-Type': 'application/json;charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function jsonOut(obj) { return new Response(JSON.stringify(obj), { headers: JSON_HEADERS }); }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: JSON_HEADERS });

    // 圖片端點：GET /img?id=<signupId>
    if (request.method === 'GET' && url.pathname.endsWith('/img')) {
      const id = url.searchParams.get('id');
      if (!id) return new Response('missing id', { status: 400 });
      const row = await env.DB.prepare('SELECT data_url FROM image_blobs WHERE signup_id=?').bind(id).first();
      if (!row || !row.data_url) return new Response('not found', { status: 404 });
      const b64 = String(row.data_url).split(',')[1] || '';
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' }
      });
    }

    if (request.method === 'GET') {
      return new Response('PrayerRoster Worker OK', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    try {
      const req = await request.json();
      let data;
      switch (req.action) {
        case 'init':       data = await getInitialData(env); break;
        case 'getSignups': data = await getSignups(env, req.week); break;
        case 'submit':     data = await submitSignup(env, req.day, req.name, req.img, req.mode, req.weeks, req.goal, req.week); break;
        case 'remove':     data = await removeSignup(env, req.id, req.name); break;
        case 'replaceImg': data = await replaceImage(env, req.id, req.name, req.img); break;
        case 'editGoal':   data = await editGoal(env, req.id, req.name, req.goal); break;
        case 'getPrayer':  data = await getPrayer(env); break;
        case 'savePrayer': data = await savePrayer(env, req.text); break;
        default: throw new Error('未知的動作：' + req.action);
      }
      return jsonOut({ ok: true, data });
    } catch (err) {
      return jsonOut({ ok: false, error: (err && err.message) ? err.message : String(err) });
    }
  }
};
