// בדיקות ל-lib/garmin-store.js ול-lib/ops/garmin-sync.js (בלוק 5 חלק ב): שמירת הטוקנים מוצפנים, רענון ושמירה תמיד, משיכה יומית,
// טבלה חסרה, ובועה אחת ביום כשהחיבור נפל. בלי רשת ובלי מסד: fetch ו-sql מזויפים. כל הטוקנים מומצאים.
// ה-SQL לא רץ מול Postgres: הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole, fakeFetch, fakeSql, jsonResponse, randomKeyB64, FAKE_CRON } from './helpers.js';
import { decryptToken, encryptToken, parseEncKey } from '../lib/google.js';
import {
  GARMIN_DOWN_TEXT, GARMIN_PULL_FAILED_TEXT, GARMIN_DOWN_ENTITY, getAccessToken, isMissingTable, loadGarminItemsForDate, notifyGarminDown, saveTokens, upsertItems,
} from '../lib/garmin-store.js';
import { connectHandle, statusHandle, syncHandle } from '../lib/ops/garmin-sync.js';
import ops, { TASKS } from '../api/ops.js';

const KEY_B64 = randomKeyB64();
const KEY = parseEncKey(KEY_B64);
const NOW = new Date('2026-11-22T13:00:00.000Z'); // 15:00 בישראל
const nowMs = NOW.getTime();
const jwt = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;
const FRESH = { access_token: jwt(nowMs / 1000 + 3600), refresh_token: 'ref-FAKE-secret-1', client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2' };
const STALE = { ...FRESH, access_token: jwt(nowMs / 1000 + 60) };
const credRow = (tokens, extra = {}) => ({ tokens_enc: encryptToken(JSON.stringify(tokens), KEY), updated_at: NOW, last_ok_at: null, last_error: null, ...extra });
const missingTable = () => Object.assign(new Error('relation "garmin_credentials" does not exist'), { code: '42P01' });
const auth = { authorization: `Bearer ${FAKE_CRON}` };
const request = (task, { method = 'GET', headers = auth, body } = {}) => new Request(`https://x.test/api/ops?task=${task}`, { method, headers, body });

// sql מזויף שמחזיר שורת חיבור לשאילתת הטעינה.
const sqlWith = (row, overrides = () => undefined) => fakeSql((text, values) => {
  const custom = overrides(text, values);
  if (custom !== undefined) return custom;
  if (text.startsWith('SELECT tokens_enc')) return row ? [row] : [];
  if (text.includes('INSERT INTO messages')) return [{ id: 'm1' }];
  if (text.includes('INSERT INTO garmin_credentials')) return [{ account: 'primary' }];
  return [];
});

describe('garmin-store: טבלה חסרה', () => {
  test('42P01 או ההודעה על טבלת garmin_ = חסרה; טבלה אחרת לא', () => {
    assert.equal(isMissingTable({ code: '42P01' }), true);
    assert.equal(isMissingTable(new Error('relation "garmin_items" does not exist')), true);
    assert.equal(isMissingTable(new Error('relation "tasks" does not exist')), false);
    assert.equal(isMissingTable(new Error('boom')), false);
  });
});

describe('garmin-store: שמירה וטעינה', () => {
  test('saveTokens בחיבור: upsert מוצפן, מנקה last_error; הטוקנים לא בטקסט הפקודה', async () => {
    const sql = fakeSql();
    await saveTokens(sql, KEY, FRESH, { nowIso: NOW.toISOString() });
    const [call] = sql.find('INSERT INTO garmin_credentials');
    assert.ok(call.text.includes('ON CONFLICT (account) DO UPDATE'));
    assert.ok(call.text.includes('last_error = NULL'));
    const enc = call.values.find((v) => typeof v === 'string' && v.startsWith('v1.'));
    assert.deepEqual(JSON.parse(decryptToken(enc, KEY)), FRESH);
    assert.ok(!JSON.stringify(call.values).includes('ref-FAKE-secret-1'));
  });

  test('getAccessToken: טוקן טרי = בלי רענון ובלי כתיבה', async () => {
    const sql = sqlWith(credRow(FRESH));
    const fetchImpl = fakeFetch(() => { throw new Error('לא אמור לקרוא'); });
    const result = await getAccessToken({ sql, key: KEY, fetchImpl, nowMs });
    assert.deepEqual(result, { ok: true, accessToken: FRESH.access_token, refreshed: false });
    assert.equal(sql.find('UPDATE garmin_credentials').length, 0);
  });

  test('getAccessToken: קרוב לתפוגה = רענון, והסט המלא נשמר מוצפן תמיד, בשמירה מותנית על הסט הישן (upsert, RETURNING)', async () => {
    const row = credRow(STALE);
    const sql = sqlWith(row);
    const fetchImpl = fakeFetch(() => jsonResponse({ access_token: 'acc-NEW' }));
    const result = await getAccessToken({ sql, key: KEY, fetchImpl, nowMs });
    assert.deepEqual(result, { ok: true, accessToken: 'acc-NEW', refreshed: true });
    const [save] = sql.find('INSERT INTO garmin_credentials');
    assert.ok(save.text.includes('ON CONFLICT (account) DO UPDATE'));
    assert.ok(save.text.includes('WHERE garmin_credentials.tokens_enc ='));
    assert.ok(save.text.includes('RETURNING'));
    assert.ok(save.values.includes(row.tokens_enc), 'התנאי על הסט הישן');
    const enc = save.values.find((v) => typeof v === 'string' && v.startsWith('v1.') && v !== row.tokens_enc);
    assert.deepEqual(JSON.parse(decryptToken(enc, KEY)), { ...STALE, access_token: 'acc-NEW' });
    assert.equal(sql.find('UPDATE garmin_credentials SET tokens_enc').length, 0);
  });

  test('getAccessToken: forceRefresh מרענן גם טוקן טרי', async () => {
    const sql = sqlWith(credRow(FRESH));
    const fetchImpl = fakeFetch(() => jsonResponse({ access_token: 'acc-NEW' }));
    const result = await getAccessToken({ sql, key: KEY, fetchImpl, nowMs, forceRefresh: true });
    assert.equal(result.accessToken, 'acc-NEW');
    assert.equal(fetchImpl.calls.length, 1);
  });

  test('getAccessToken: שמירה נכשלה פעם אחת = ניסיון שמירה שני מצליח', async () => {
    let attempts = 0;
    const sql = sqlWith(credRow(STALE), (text) => {
      if (text.includes('INSERT INTO garmin_credentials')) { attempts += 1; if (attempts === 1) throw new Error('db'); return [{ account: 'primary' }]; }
    });
    const result = await getAccessToken({ sql, key: KEY, fetchImpl: fakeFetch(() => jsonResponse({ access_token: 'acc-NEW' })), nowMs });
    assert.deepEqual(result, { ok: true, accessToken: 'acc-NEW', refreshed: true });
    assert.equal(attempts, 2);
  });

  test('getAccessToken: שמירה נכשלה פעמיים = ממשיכים עם הטוקן החדש, saveFailed', async () => {
    const sql = sqlWith(credRow(STALE), (text) => { if (text.includes('INSERT INTO garmin_credentials')) throw new Error('db'); });
    const result = await getAccessToken({ sql, key: KEY, fetchImpl: fakeFetch(() => jsonResponse({ access_token: 'acc-NEW' })), nowMs });
    assert.deepEqual(result, { ok: true, accessToken: 'acc-NEW', refreshed: true, saveFailed: true });
    assert.equal(sql.find('INSERT INTO garmin_credentials').length, 2);
  });

  test('getAccessToken: מרוץ (0 שורות: ריצה אחרת כבר החליפה) = טוענים את הסט השמור וממשיכים איתו, בלי לדרוס', async () => {
    const theirs = { ...FRESH, access_token: 'acc-THEIRS' };
    let loads = 0;
    const sql = sqlWith(null, (text) => {
      if (text.startsWith('SELECT tokens_enc')) { loads += 1; return [loads === 1 ? credRow(STALE) : credRow(theirs)]; }
      if (text.includes('INSERT INTO garmin_credentials')) return [];
    });
    const result = await getAccessToken({ sql, key: KEY, fetchImpl: fakeFetch(() => jsonResponse({ access_token: 'acc-MINE' })), nowMs });
    assert.deepEqual(result, { ok: true, accessToken: 'acc-THEIRS', refreshed: true, reloaded: true });
    assert.equal(sql.find('INSERT INTO garmin_credentials').length, 1);
  });

  test('getAccessToken: רענון נדחה = auth, בלי ניסיון שני', async () => {
    const sql = sqlWith(credRow(STALE));
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));
    const result = await getAccessToken({ sql, key: KEY, fetchImpl, nowMs });
    assert.deepEqual(result, { ok: false, reason: 'refresh_auth_rejected (400)', auth: true });
    assert.equal(fetchImpl.calls.length, 1);
  });

  test('getAccessToken: אין שורה / טבלה חסרה / פענוח נכשל', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ access_token: 'acc-NEW' }));
    assert.deepEqual(await getAccessToken({ sql: sqlWith(null), key: KEY, fetchImpl, nowMs }), { ok: false, reason: 'not_connected', auth: false });
    assert.deepEqual(await getAccessToken({ sql: fakeSql(() => { throw missingTable(); }), key: KEY, fetchImpl, nowMs }), { ok: false, reason: 'table_missing', auth: false });
    assert.deepEqual(await getAccessToken({ sql: sqlWith({ tokens_enc: 'v1.bad' }), key: KEY, fetchImpl, nowMs }), { ok: false, reason: 'decrypt_failed', auth: false });
  });

  test('upsertItems: פקודה לכל פריט, ON CONFLICT על garmin_id, fetched_at מהשעון המוזרק', async () => {
    const sql = fakeSql();
    const item = { garmin_id: 'cal:9', kind: 'planned', item_date: '2026-11-23', title: 'אינטרוולים', sport: 'running', duration_sec: 2700, starts_at: null };
    assert.equal(await upsertItems(sql, [item, { ...item, garmin_id: 'cal:10' }], NOW.toISOString()), 2);
    const calls = sql.find('INSERT INTO garmin_items');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].text.includes('ON CONFLICT (garmin_id) DO UPDATE'));
    assert.deepEqual(calls[0].values, ['cal:9', 'planned', '2026-11-23', 'אינטרוולים', 'running', 2700, null, NOW.toISOString()]);
  });

  test('loadGarminItemsForDate: לפי תאריך; טבלה חסרה = רשימה ריקה; כשל אחר נזרק', async () => {
    const row = { garmin_id: 'act:1', kind: 'done', item_date: '2026-11-22', title: 't', sport: 'running', duration_sec: 100, starts_at: NOW, fetched_at: NOW };
    const sql = fakeSql(() => [row]);
    assert.deepEqual(await loadGarminItemsForDate(sql, '2026-11-22'), [row]);
    assert.ok(sql.calls[0].text.includes('FROM garmin_items WHERE item_date ='));
    assert.deepEqual(sql.calls[0].values, ['2026-11-22']);
    assert.deepEqual(await loadGarminItemsForDate(fakeSql(() => { throw missingTable(); }), '2026-11-22'), []);
    await assert.rejects(loadGarminItemsForDate(fakeSql(() => { throw new Error('db'); }), '2026-11-22'));
  });

  test('notifyGarminDown: בועת update אחת ביום ישראלי (NOT EXISTS לפי היום), עם הנוסח הקבוע', async () => {
    const sql = fakeSql(() => [{ id: 'm1' }]);
    assert.equal(await notifyGarminDown(sql, { today: '2026-11-22', nowIso: NOW.toISOString() }), true);
    const [call] = sql.calls;
    assert.ok(call.text.includes('INSERT INTO messages'));
    assert.ok(call.text.includes("'update'"));
    assert.ok(call.text.includes(`entity_type = '${GARMIN_DOWN_ENTITY}'`));
    assert.ok(call.text.includes("AT TIME ZONE 'Asia/Jerusalem'"));
    assert.ok(call.values.includes(GARMIN_DOWN_TEXT));
    assert.ok(call.values.includes('2026-11-22'));
    assert.equal(GARMIN_DOWN_TEXT, 'החיבור ל-Garmin נפל. צריך להתחבר מחדש מהמחשב.');
    assert.equal(await notifyGarminDown(fakeSql(() => []), { today: '2026-11-22', nowIso: NOW.toISOString() }), false);
  });

  test('notifyGarminDown עם auth=false: נוסח "המשיכה נכשלה", אותה בדיקת יום אחד (בועה אחת ביום בסך הכול)', async () => {
    const sql = fakeSql(() => [{ id: 'm1' }]);
    assert.equal(await notifyGarminDown(sql, { today: '2026-11-22', nowIso: NOW.toISOString(), auth: false }), true);
    const [call] = sql.calls;
    assert.ok(call.values.includes(GARMIN_PULL_FAILED_TEXT));
    assert.ok(!call.values.includes(GARMIN_DOWN_TEXT));
    assert.ok(call.text.includes(`WHERE entity_type = '${GARMIN_DOWN_ENTITY}'`));
    assert.equal(GARMIN_PULL_FAILED_TEXT, 'המשיכה מ-Garmin נכשלה היום. אנסה שוב מחר.');
  });
});

describe('ops: garmin-connect', () => {
  const deps = (sql) => ({ sql, secret: FAKE_CRON, encKeyRaw: KEY_B64 });
  const post = (body, headers = auth) => request('garmin-connect', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('POST עם סט תקין: נשמר מוצפן; התשובה בלי טוקנים', async () => {
    const sql = fakeSql();
    const response = await connectHandle(post(FRESH), deps(sql));
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { ok: true, connected: true });
    assert.ok(!text.includes('ref-FAKE'));
    assert.equal(sql.find('INSERT INTO garmin_credentials').length, 1);
  });

  test('בלי סוד 401; סוד שגוי 401; GET 405; PATCH 405', async () => {
    const sql = fakeSql();
    assert.equal((await connectHandle(post(FRESH, {}), deps(sql))).status, 401);
    assert.equal((await connectHandle(post(FRESH, { authorization: 'Bearer nope' }), deps(sql))).status, 401);
    assert.equal((await connectHandle(request('garmin-connect'), deps(sql))).status, 405);
    assert.equal((await connectHandle(request('garmin-connect', { method: 'PATCH' }), deps(sql))).status, 405);
    assert.equal((await connectHandle(request('garmin-connect'), { sql, secret: undefined, encKeyRaw: KEY_B64 })).status, 401);
    assert.equal(sql.calls.length, 0);
  });

  test('גוף פגום / חסר שדה / ארוך מדי = 400; בלי מפתח הצפנה = 500; טבלה חסרה = 503 table_missing', async () => {
    const sql = fakeSql();
    assert.equal((await connectHandle(request('garmin-connect', { method: 'POST', body: '{bad' }), deps(sql))).status, 400);
    assert.equal((await connectHandle(post({ ...FRESH, refresh_token: '' }), deps(sql))).status, 400);
    assert.equal((await connectHandle(request('garmin-connect', { method: 'POST', body: 'x'.repeat(20000) }), deps(sql))).status, 400);
    const noKey = await connectHandle(post(FRESH), { sql, secret: FAKE_CRON, encKeyRaw: undefined });
    assert.equal(noKey.status, 500);
    assert.deepEqual(await noKey.json(), { ok: false, reason: 'config_missing' });
    const missing = await connectHandle(post(FRESH), deps(fakeSql(() => { throw missingTable(); })));
    assert.equal(missing.status, 503);
    assert.deepEqual(await missing.json(), { ok: false, reason: 'table_missing' });
  });
});

describe('ops: garmin-status', () => {
  test('מחובר: קודים ותאריכים בלבד, בלי טוקנים', async () => {
    const sql = sqlWith(credRow(FRESH, { last_ok_at: NOW, last_error: 'schedule:forbidden (403)' }));
    const response = await statusHandle(request('garmin-status'), { sql, secret: FAKE_CRON, encKeyRaw: KEY_B64 });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), {
      ok: true, connected: true, config_ok: true, updated_at: NOW.toISOString(), last_ok_at: NOW.toISOString(), last_error: 'schedule:forbidden (403)',
    });
    assert.ok(!text.includes('v1.'));
  });

  test('לא מחובר; טבלה חסרה; בלי מפתח = config_ok false', async () => {
    const off = await statusHandle(request('garmin-status'), { sql: sqlWith(null), secret: FAKE_CRON, encKeyRaw: undefined });
    assert.deepEqual(await off.json(), { ok: true, connected: false, config_ok: false });
    const missing = await statusHandle(request('garmin-status'), { sql: fakeSql(() => { throw missingTable(); }), secret: FAKE_CRON, encKeyRaw: KEY_B64 });
    assert.deepEqual(await missing.json(), { ok: false, reason: 'table_missing' });
  });

  test('POST 405; בלי סוד 401', async () => {
    const sql = fakeSql();
    assert.equal((await statusHandle(request('garmin-status', { method: 'POST' }), { sql, secret: FAKE_CRON })).status, 405);
    assert.equal((await statusHandle(request('garmin-status', { headers: {} }), { sql, secret: FAKE_CRON })).status, 401);
  });
});

describe('ops: garmin-sync', () => {
  const okFetch = () => fakeFetch((url) => {
    if (url.includes('activitylist')) return jsonResponse([{ activityId: 1, startTimeLocal: '2026-11-22 06:00:00', activityName: 'ריצה' }]);
    if (url.includes('calendar-service')) return jsonResponse({ calendarItems: [{ itemType: 'workout', id: 9, date: '2026-11-23', title: 'אינטרוולים' }] });
    return jsonResponse([]);
  });
  const deps = (sql, fetchImpl) => ({ sql, secret: FAKE_CRON, encKeyRaw: KEY_B64, fetchImpl, now: () => NOW });

  test('הצלחה: פריטים נשמרים, last_ok_at, שורת probe_log עם ספירות בלבד, בלי בועה', async (t) => {
    const log = captureConsole(t);
    const sql = sqlWith(credRow(FRESH));
    const response = await syncHandle(request('garmin-sync'), deps(sql, okFetch()));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { ok: true, planned: 1, done: 1, stored: 2, failures: [], bubble: false });
    assert.equal(sql.find('INSERT INTO garmin_items').length, 2);
    assert.equal(sql.find('SET last_ok_at').length, 1);
    const [probe] = sql.find('INSERT INTO probe_log');
    assert.ok(probe.text.includes("'garmin-sync'"));
    assert.equal(probe.values[0], true);
    assert.equal(probe.values[1], 'planned=1 done=1 stored=2');
    assert.equal(sql.find('INSERT INTO messages').length, 0);
    assert.ok(!log.text().includes('אינטרוולים'));
  });

  test('רענון נדחה: last_error, בועה אחת, ובלי קריאות API', async () => {
    const sql = sqlWith(credRow(STALE));
    const fetchImpl = fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.deepEqual(body, { ok: false, reason: 'refresh_auth_rejected (400)', bubble: true });
    assert.equal(fetchImpl.calls.length, 1);
    const [mark] = sql.find('SET last_error');
    assert.ok(mark.values.includes('refresh_auth_rejected (400)'));
    const bubbles = sql.find('INSERT INTO messages');
    assert.equal(bubbles.length, 1);
    assert.ok(bubbles[0].values.includes(GARMIN_DOWN_TEXT));
  });

  test('בועה כבר נשלחה היום (NOT EXISTS לא החזיר שורה): bubble false', async () => {
    const sql = sqlWith(credRow(STALE), (text) => (text.includes('INSERT INTO messages') ? [] : undefined));
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fakeFetch(() => jsonResponse({}, 401))))).json();
    assert.equal(body.bubble, false);
  });

  test('401 מה-API גם אחרי רענון אחד: נשמר מה שהגיע, last_error, ובועת auth', async () => {
    const sql = sqlWith(credRow(FRESH));
    const fetchImpl = fakeFetch((url) => {
      if (url.includes('diauth')) return jsonResponse({ access_token: 'acc-NEW' });
      return url.includes('activitylist') ? new Response('', { status: 401 }) : jsonResponse({ calendarItems: [] });
    });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.equal(body.ok, false);
    assert.equal(body.bubble, true);
    assert.deepEqual(body.failures, ['activities:auth_rejected (401)']);
    assert.equal(sql.find('SET last_ok_at').length, 0);
    assert.equal(fetchImpl.calls.filter((c) => c.url.includes('diauth')).length, 1, 'רענון אחד בלבד');
    assert.ok(sql.find('INSERT INTO messages')[0].values.includes(GARMIN_DOWN_TEXT));
  });

  test('401 מה-API, רענון אחד מצליח: אותה קריאה שוב עם הטוקן החדש, ok', async () => {
    const sql = sqlWith(credRow(FRESH));
    const fetchImpl = fakeFetch((url, options) => {
      if (url.includes('diauth')) return jsonResponse({ access_token: 'acc-NEW' });
      if (options.headers.authorization !== 'Bearer acc-NEW') return new Response('', { status: 401 });
      return jsonResponse(url.includes('calendar-service') ? { calendarItems: [] } : []);
    });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.equal(body.ok, true);
    assert.equal(body.bubble, false);
    assert.equal(sql.find('INSERT INTO garmin_credentials').length, 1, 'הסט החדש נשמר');
  });

  test('שמירה אחרי רענון נכשלה פעמיים: המשיכה ממשיכה, save_failed, ובועת auth (מחר ייכשל)', async () => {
    const sql = sqlWith(credRow(STALE), (text) => { if (text.includes('INSERT INTO garmin_credentials')) throw new Error('db'); });
    const fetchImpl = fakeFetch((url) => {
      if (url.includes('diauth')) return jsonResponse({ access_token: 'acc-NEW' });
      if (url.includes('activitylist')) return jsonResponse([{ activityId: 1, startTimeLocal: '2026-11-22 06:00:00' }]);
      return jsonResponse(url.includes('calendar-service') ? { calendarItems: [] } : []);
    });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'save_failed');
    assert.equal(body.stored, 1);
    assert.equal(body.bubble, true);
    assert.ok(sql.find('INSERT INTO messages')[0].values.includes(GARMIN_DOWN_TEXT));
    assert.ok(sql.find('SET last_error')[0].values.some((v) => String(v).startsWith('save_failed')));
  });

  test('403 (Cloudflare?), 429 ורשת: last_error, ובועת "המשיכה נכשלה" (03-scheduling-rules: כל כשל = הודעה), בלי ניסיון חוזר', async () => {
    for (const make of [() => new Response('', { status: 403 }), () => new Response('', { status: 429 }), () => { throw new Error('net'); }]) {
      const sql = sqlWith(credRow(FRESH));
      const fetchImpl = fakeFetch(make);
      const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
      assert.equal(body.ok, false);
      assert.equal(body.bubble, true);
      assert.equal(sql.find('SET last_error').length, 1);
      const bubbles = sql.find('INSERT INTO messages');
      assert.equal(bubbles.length, 1);
      assert.ok(bubbles[0].values.includes(GARMIN_PULL_FAILED_TEXT));
    }
    const blocked = fakeFetch(() => new Response('', { status: 429 }));
    await syncHandle(request('garmin-sync'), deps(sqlWith(credRow(FRESH)), blocked));
    assert.equal(blocked.calls.length, 1);
  });

  test('רענון נכשל ברשת (לא auth): בועת "המשיכה נכשלה"', async () => {
    const sql = sqlWith(credRow(STALE));
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fakeFetch(() => { throw new Error('net'); })))).json();
    assert.deepEqual(body, { ok: false, reason: 'refresh_network', bubble: true });
    assert.ok(sql.find('INSERT INTO messages')[0].values.includes(GARMIN_PULL_FAILED_TEXT));
  });

  test('לא מחובר: ok false, בלי בועה (לא כשל: עוד לא התחברו) ובלי fetch', async () => {
    const sql = sqlWith(null);
    const fetchImpl = fakeFetch(() => { throw new Error('לא אמור לקרוא'); });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.deepEqual(body, { ok: false, reason: 'not_connected', bubble: false });
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(sql.find('INSERT INTO messages').length, 0);
  });

  test('garmin_credentials חסרה: table_missing, בלי בועה (מצב הקמה), בלי fetch ובלי last_error', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('INSERT INTO messages')) return [{ id: 'm1' }];
      if (!text.includes('probe_log')) throw missingTable();
      return [];
    });
    const fetchImpl = fakeFetch(() => { throw new Error('לא אמור לקרוא'); });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, fetchImpl))).json();
    assert.deepEqual(body, { ok: false, reason: 'table_missing', bubble: false });
    assert.equal(fetchImpl.calls.length, 0);
    assert.equal(sql.find('SET last_error').length, 0);
    assert.equal(sql.find('INSERT INTO messages').length, 0);
    assert.equal(sql.find('INSERT INTO probe_log').length, 1);
  });

  test('garmin_items חסרה (credentials קיימת): table_missing', async () => {
    const sql = sqlWith(credRow(FRESH), (text) => { if (text.includes('INSERT INTO garmin_items')) throw Object.assign(new Error('relation "garmin_items" does not exist'), { code: '42P01' }); });
    const body = await (await syncHandle(request('garmin-sync'), deps(sql, okFetch()))).json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, 'table_missing');
    assert.equal(body.bubble, false);
    assert.equal(sql.find('INSERT INTO messages').length, 0);
    assert.ok(sql.find('SET last_error')[0].values.includes('table_missing'));
  });

  test('בלי מפתח הצפנה: config_missing בלי בועה (מצב הקמה), עם last_error ו-probe_log; POST 405; בלי סוד 401', async () => {
    const sql = fakeSql((text) => (text.includes('INSERT INTO messages') ? [{ id: 'm1' }] : []));
    const noKey = await syncHandle(request('garmin-sync'), { ...deps(sql, okFetch()), encKeyRaw: undefined });
    assert.deepEqual(await noKey.json(), { ok: false, reason: 'config_missing', bubble: false });
    assert.equal(sql.find('INSERT INTO messages').length, 0);
    assert.ok(sql.find('SET last_error')[0].values.includes('config_missing'));
    assert.equal(sql.find('INSERT INTO probe_log').length, 1);
    assert.equal((await syncHandle(request('garmin-sync', { method: 'POST' }), deps(sql, okFetch()))).status, 405);
    assert.equal((await syncHandle(request('garmin-sync', { headers: {} }), deps(sql, okFetch()))).status, 401);
  });

  test('פרטיות: טוקנים לא בתשובה ולא בלוג גם בכשל', async (t) => {
    const log = captureConsole(t);
    const sql = sqlWith(credRow(STALE));
    const response = await syncHandle(request('garmin-sync'), deps(sql, fakeFetch(() => { throw new Error('ref-FAKE-secret-1 in message'); })));
    const text = await response.text();
    assert.ok(!text.includes('ref-FAKE'));
    assert.ok(!log.text().includes('ref-FAKE'));
  });

  // בלוק 5: החלת הפריטים על אימוני 4fitness (lib/garmin-apply.js) בסוף משיכה מוצלחת בלבד. כשל בה לא מכשיל את המשיכה.
  test('משיכה מוצלחת: applyItems נקרא פעם אחת, אחרי השמירה, עם fetched_at של המשיכה', async () => {
    const sql = sqlWith(credRow(FRESH));
    const calls = [];
    const applyItems = async (args) => {
      calls.push({ ...args, storedBefore: sql.find('INSERT INTO garmin_items').length });
      return { ok: true };
    };
    const body = await (await syncHandle(request('garmin-sync'), { ...deps(sql, okFetch()), applyItems })).json();
    assert.equal(body.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, sql);
    assert.equal(calls[0].fetchedAt, NOW.toISOString());
    assert.equal(calls[0].storedBefore, 2);
  });

  test('applyItems נכשל או זורק: המשיכה עדיין ok, ונרשם קוד בלבד', async (t) => {
    const log = captureConsole(t);
    for (const applyItems of [async () => ({ ok: false, reason: 'db_error' }), async () => { throw new Error('אינטרוולים'); }]) {
      const sql = sqlWith(credRow(FRESH));
      const body = await (await syncHandle(request('garmin-sync'), { ...deps(sql, okFetch()), applyItems })).json();
      assert.deepEqual(body, { ok: true, planned: 1, done: 1, stored: 2, failures: [], bubble: false });
    }
    assert.ok(log.text().includes('db_error'));
    assert.ok(!log.text().includes('אינטרוולים'));
  });

  test('בועת "Garmin נפל" שנכתבה: דחיפה אחת; בועה שכבר נשלחה היום: בלי דחיפה', async () => {
    const pushes = [];
    const push = async (args) => { pushes.push(args); return { sent: true }; };
    const fetchImpl = () => fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, 400));
    const written = await (await syncHandle(request('garmin-sync'), { ...deps(sqlWith(credRow(STALE)), fetchImpl()), push })).json();
    assert.equal(written.bubble, true);
    assert.equal(pushes.length, 1);
    const skippedSql = sqlWith(credRow(STALE), (text) => (text.includes('INSERT INTO messages') ? [] : undefined));
    const skipped = await (await syncHandle(request('garmin-sync'), { ...deps(skippedSql, fetchImpl()), push })).json();
    assert.equal(skipped.bubble, false);
    assert.equal(pushes.length, 1);
  });

  test('משיכה מוצלחת: אותה דחיפה מועברת ל-applyItems; בלי בועה אין דחיפה', async () => {
    const pushes = [];
    const push = async () => { pushes.push(1); return { sent: true }; };
    let got;
    await syncHandle(request('garmin-sync'), { ...deps(sqlWith(credRow(FRESH)), okFetch()), push, applyItems: async (args) => { got = args.push; return { ok: true }; } });
    assert.equal(got, push);
    assert.equal(pushes.length, 0);
  });

  test('משיכה שנכשלה (חלקית): applyItems לא נקרא', async () => {
    const sql = sqlWith(credRow(FRESH));
    let called = 0;
    const fetchImpl = fakeFetch((url) => (url.includes('activitylist') ? new Response('', { status: 500 }) : jsonResponse({ calendarItems: [] })));
    const body = await (await syncHandle(request('garmin-sync'), { ...deps(sql, fetchImpl), applyItems: async () => { called += 1; return { ok: true }; } })).json();
    assert.equal(body.ok, false);
    assert.equal(called, 0);
  });
});

describe('ops: שלוש המשימות רשומות', () => {
  test('garmin-connect, garmin-status, garmin-sync ב-TASKS', () => {
    for (const name of ['garmin-connect', 'garmin-status', 'garmin-sync']) assert.equal(typeof TASKS[name]?.fetch, 'function', name);
  });

  test('דרך api/ops.js: בלי סוד 401', async () => {
    for (const name of ['garmin-connect', 'garmin-status', 'garmin-sync']) {
      const method = name === 'garmin-connect' ? 'POST' : 'GET';
      assert.equal((await ops.fetch(request(name, { method, headers: {} }))).status, 401, name);
    }
  });
});
