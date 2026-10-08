// בדיקות ל-lib/watch-renew.js (חידוש ערוצי watch) ולחיבורו ל-api/daily-check.js. בלי מסד ובלי רשת.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renewExpiringChannels } from '../lib/watch-renew.js';
import { handle } from '../api/daily-check.js';
import { fakeSql, captureConsole, req, jsonResponse } from './helpers.js';
import { CONFIG, KEY, googleFetch, encRefresh, assertNoSecrets, CALENDARS, CAL_NAMES, ACCESS_TOKEN } from './google-fixtures.js';
import { verifyChannelToken, WATCH_ADDRESS } from '../lib/google.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const NOW_MS = NOW.getTime();
const H = 3600000;
const D = 24 * H;
const CAL_A = CALENDARS[0].id; // owner
const CAL_B = CALENDARS[1].id; // writer
const CAL_RO = CALENDARS[2].id; // reader

// rows = שורות ערוצים פעילים { id, calendar_id, expiration }
function mkSql({ rows = [], onQuery } = {}) {
  return fakeSql((text, values) => {
    if (onQuery) { const r = onQuery(text, values); if (r !== undefined) return r; }
    if (text.startsWith('SELECT id, calendar_id')) return rows;
    if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
    return [];
  });
}
let counter = 0;
const renew = (deps = {}) => renewExpiringChannels({
  sql: mkSql(), config: CONFIG, fetchImpl: googleFetch(), nowMs: NOW_MS, makeChannelId: () => `new-channel-${++counter}`, ...deps,
});
const watchCalls = (f) => f.calls.filter((c) => c.url.includes('/events/watch'));
const inserts = (sql) => sql.find('INSERT INTO google_watch_channels');
const stops = (sql) => sql.find('UPDATE google_watch_channels SET stopped_at');
const row = (id, calendar_id, offsetMs) => ({ id, calendar_id, expiration: new Date(NOW_MS + offsetMs) });

describe('watch-renew: אין מה לחדש', () => {
  test('אין ערוצים בכלל - אפס קריאות ל-Google', async () => {
    const f = googleFetch();
    assert.deepEqual(await renew({ fetchImpl: f }), { renewed: 0, failed: 0, skipped: 0 });
    assert.equal(f.calls.length, 0);
  });
  test('ערוץ שפג בעוד יותר מ-48 שעות - אפס קריאות ל-Google ובלי כתיבה', async () => {
    const sql = mkSql({ rows: [row('1', CAL_A, 3 * D)] });
    const f = googleFetch();
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 0 });
    assert.equal(f.calls.length, 0);
    assert.equal(sql.calls.length, 1); // רק הקריאה
  });
  test('ערוץ עם תפוגה NULL - נחשב כיסוי, אין קריאות', async () => {
    const f = googleFetch();
    const sql = mkSql({ rows: [{ id: '1', calendar_id: CAL_A, expiration: null }] });
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 0 });
    assert.equal(f.calls.length, 0);
  });
});

describe('watch-renew: חידוש', () => {
  test('ערוץ שפג בעוד 24 שעות - נפתח חדש, נוסף INSERT, הישן נשאר פעיל (חפיפה)', async () => {
    const sql = mkSql({ rows: [row('old1', CAL_A, 24 * H)] });
    const f = googleFetch();
    const result = await renew({ sql, fetchImpl: f });
    assert.deepEqual(result, { renewed: 1, failed: 0, skipped: 0 });
    assert.equal(watchCalls(f).length, 1);
    const sent = JSON.parse(watchCalls(f)[0].options.body);
    assert.equal(sent.address, WATCH_ADDRESS);
    assert.equal(verifyChannelToken(sent.token, sent.id, KEY), true);
    assert.equal(inserts(sql).length, 1);
    const [calendarId, channelId, , expiration] = inserts(sql)[0].values;
    assert.equal(calendarId, CAL_A);
    assert.equal(channelId, sent.id);
    assert.equal(expiration, '2026-11-07T10:00:00.000Z');
    assert.equal(stops(sql).length, 0); // הישן עוד לא פג - לא נעצר (ה-webhook ממשיך לענות לו 200)
  });
  test('ערוץ שכבר פג ולא נעצר - מחדשים ואז מסמנים את הישן נעצר', async () => {
    const sql = mkSql({ rows: [row('old1', CAL_A, -2 * H)] });
    const result = await renew({ sql });
    assert.equal(result.renewed, 1);
    assert.equal(stops(sql).length, 1);
    assert.equal(stops(sql)[0].values[0], 'old1');
  });
  test('שני יומנים שעומדים לפוג - שני ערוצים חדשים, בלי רענון/רשימה כפולים', async () => {
    const sql = mkSql({ rows: [row('1', CAL_A, H), row('2', CAL_B, 2 * H)] });
    const f = googleFetch();
    const result = await renew({ sql, fetchImpl: f });
    assert.equal(result.renewed, 2);
    assert.equal(f.calls.length, 4); // token + calendarList + 2 watch
  });
  test('יומן שכבר חודש (ערוץ אחר פעיל מעבר ל-48 שעות) - מדולג, בלי Google', async () => {
    const sql = mkSql({ rows: [row('old', CAL_A, 5 * H), row('new', CAL_A, 6 * D)] });
    const f = googleFetch();
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 1 });
    assert.equal(f.calls.length, 0);
    assert.equal(inserts(sql).length, 0);
    assert.equal(stops(sql).length, 0); // הישן עוד לא פג
  });
  test('ריצה אחרי שהישן פג וכבר יש חלופה - הישן מסומן נעצר, בלי Google', async () => {
    const sql = mkSql({ rows: [row('old', CAL_A, -H), row('new', CAL_A, 6 * D)] });
    const f = googleFetch();
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 1 });
    assert.equal(f.calls.length, 0);
    assert.equal(stops(sql).length, 1);
    assert.equal(stops(sql)[0].values[0], 'old');
  });
  test('חידוש ואז ריצה שנייה על אותו מצב (מסד זיכרון) - לא נפתח ערוץ נוסף', async () => {
    const rows = [row('old', CAL_A, 3 * H)];
    const sql = fakeSql((text, values) => {
      if (text.startsWith('SELECT id, calendar_id')) return rows.filter((r) => !r.stopped);
      if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
      if (text.startsWith('INSERT INTO google_watch_channels')) { rows.push({ id: values[1], calendar_id: values[0], expiration: values[3] }); return []; }
      return [];
    });
    const f = googleFetch();
    assert.equal((await renew({ sql, fetchImpl: f })).renewed, 1);
    assert.equal((await renew({ sql, fetchImpl: f })).renewed, 0);
    assert.equal(watchCalls(f).length, 1);
  });
});

describe('watch-renew: יומנים שאי אפשר לחדש', () => {
  test('יומן שכבר לא ברשימה - מדולג בלי watch', async () => {
    const sql = mkSql({ rows: [row('1', 'gone-cal@x', H)] });
    const f = googleFetch();
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 1 });
    assert.equal(watchCalls(f).length, 0);
  });
  test('יומן שהפך לקריאה בלבד - מדולג בלי watch', async () => {
    const sql = mkSql({ rows: [row('1', CAL_RO, H)] });
    const f = googleFetch();
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 0, failed: 0, skipped: 1 });
    assert.equal(watchCalls(f).length, 0);
    assert.equal(inserts(sql).length, 0);
  });
});

describe('watch-renew: כשלים', () => {
  test('watch נכשל ביומן אחד - נספר failed, השני ממשיך, אין throw', async (t) => {
    captureConsole(t);
    const sql = mkSql({ rows: [row('1', CAL_A, H), row('2', CAL_B, H)] });
    const f = googleFetch({ watch: (url, o, i) => (url.includes('private-cal-id-1') ? new Response('{}', { status: 403 }) : jsonResponse({ resourceId: `r${i}`, expiration: '1790000000000' })) });
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 1, failed: 1, skipped: 0 });
    assert.equal(inserts(sql).length, 1);
  });
  test('רענון token נכשל - כל היומנים שצריכים חידוש נספרים failed עם reason קצר, בלי watch', async (t) => {
    captureConsole(t);
    const sql = mkSql({ rows: [row('1', CAL_A, H), row('2', CAL_B, H)] });
    const f = googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) });
    const result = await renew({ sql, fetchImpl: f });
    assert.deepEqual(result, { renewed: 0, failed: 2, skipped: 0, reason: 'invalid_grant (400)' });
    assert.equal(watchCalls(f).length, 0);
  });
  test('calendarList נכשל / אין חיבור / פענוח נכשל / config חסר', async (t) => {
    captureConsole(t);
    const rows = [row('1', CAL_A, H)];
    const a = await renew({ sql: mkSql({ rows }), fetchImpl: googleFetch({ list: new Response('{}', { status: 500 }) }) });
    assert.equal(a.failed, 1);
    assert.match(a.reason, /^calendarlist_http_error/);
    const b = await renew({ sql: mkSql({ rows, onQuery: (text) => (text.startsWith('SELECT refresh_token_enc') ? [] : undefined) }) });
    assert.equal(b.reason, 'not_connected');
    const c = await renew({ sql: mkSql({ rows, onQuery: (text) => (text.startsWith('SELECT refresh_token_enc') ? [{ refresh_token_enc: 'garbage' }] : undefined) }) });
    assert.equal(c.reason, 'decrypt_failed');
    const d = await renew({ sql: mkSql({ rows }), config: { ...CONFIG, clientSecret: '' } });
    assert.equal(d.reason, 'config_missing');
  });
  test('כשל INSERT אחרי שהערוץ נפתח - failed, בלי throw', async (t) => {
    captureConsole(t);
    const sql = mkSql({ rows: [row('old', CAL_A, -H)], onQuery: (text) => { if (text.startsWith('INSERT INTO')) throw new Error('constraint'); } });
    assert.deepEqual(await renew({ sql }), { renewed: 0, failed: 1, skipped: 0 });
    assert.equal(stops(sql).length, 0); // לא עוצרים את הישן כשהחדש לא נשמר
  });
  test('expiration מופרך (ענק) - נשמר NULL, נספר renewed, בלי throw', async (t) => {
    captureConsole(t);
    const sql = mkSql({ rows: [row('1', CAL_A, H)] });
    const f = googleFetch({ watch: () => jsonResponse({ resourceId: 'R', expiration: '1e30' }) });
    assert.deepEqual(await renew({ sql, fetchImpl: f }), { renewed: 1, failed: 0, skipped: 0 });
    assert.equal(inserts(sql)[0].values[3], null);
  });
  test('כשל בקריאת הערוצים מהמסד - זורק (daily-check עוטף)', async () => {
    await assert.rejects(renew({ sql: fakeSql(() => { throw new Error('db'); }) }));
  });
});

describe('daily-check: חיבור החידוש', () => {
  const SECRET = 'test-cron-secret';
  const authed = () => req('https://x.test/api/daily-check', { headers: { authorization: `Bearer ${SECRET}` } });
  // sql ל-daily-check: probe_log נרשם, שאילתת הסטטיסטיקה והחידוש מופרדות
  function dcSql({ rows = [], failRenewRead = false } = {}) {
    const logs = [];
    const sql = fakeSql((text, values) => {
      if (text.includes('INSERT INTO probe_log')) { logs.push({ probe: values[0], ok: values[1], detail: values[2] }); return []; }
      if (text.startsWith('SELECT id, calendar_id')) { if (failRenewRead) throw new Error(`boom ${CAL_A}`); return rows; }
      if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh(), obtained_at: '2026-10-12T12:00:00.000Z' }];
      if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
      if (text.includes('FROM google_watch_channels')) return [{ active: 0, earliest_expiration: null, last_notification_at: null, total_notifications: 0 }];
      return [];
    });
    sql.logs = logs;
    return sql;
  }
  const run = (deps) => handle(authed(), { secret: SECRET, config: CONFIG, now: () => NOW, makeChannelId: () => 'dc-channel', ...deps });

  test('אין מה לחדש: שורת probe_log שלישית עם אפסים, ו-Google נקרא רק ע"י בדיקת ה-token (2 קריאות)', async () => {
    const sql = dcSql();
    const f = googleFetch();
    const body = await (await run({ sql, fetchImpl: f })).json();
    assert.deepEqual(body.google_watch_renew, { ok: true, renewed: 0, failed: 0, skipped: 0, logged: true });
    assert.deepEqual(sql.logs.find((l) => l.probe === 'google-watch-renew-daily'), { probe: 'google-watch-renew-daily', ok: true, detail: 'renewed=0 failed=0 skipped=0' });
    assert.equal(sql.logs.length, 3);
    assert.equal(f.calls.length, 2);
    assert.equal(watchCalls(f).length, 0);
  });
  test('ערוץ שעומד לפוג: renewed=1 בתשובה ובלוג', async () => {
    const sql = dcSql({ rows: [row('1', CAL_A, H)] });
    const body = await (await run({ sql, fetchImpl: googleFetch() })).json();
    assert.equal(body.google_watch_renew.renewed, 1);
    assert.equal(sql.logs.find((l) => l.probe === 'google-watch-renew-daily').detail, 'renewed=1 failed=0 skipped=0');
  });
  test('כשל Google בחידוש: ok=false, failed נספר, reason קצר, 200, ושתי הבדיקות האחרות נרשמות', async (t) => {
    captureConsole(t);
    const sql = dcSql({ rows: [row('1', CAL_A, H)] });
    const f = googleFetch({ watch: new Response('{}', { status: 503 }) });
    const res = await run({ sql, fetchImpl: f });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.google_watch_renew.ok, false);
    assert.equal(body.google_watch_renew.failed, 1);
    assert.equal(sql.logs.length, 3);
    assert.equal(sql.logs.find((l) => l.probe === 'google-watch-renew-daily').ok, false);
  });
  test('חידוש שקורס (המסד נופל בקריאה): check_crashed, ושתי השורות האחרות נכתבות', async (t) => {
    captureConsole(t);
    const sql = dcSql({ failRenewRead: true });
    const res = await run({ sql, fetchImpl: googleFetch() });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.google_watch_renew.reason, 'check_crashed');
    assert.equal(sql.logs.length, 3);
    assert.equal(sql.logs.find((l) => l.probe === 'google-watch-renew-daily').detail, 'renewed=0 failed=0 skipped=0 reason=check_crashed');
  });
  test('פרטיות: אין מזהי יומנים/ערוצים/resource, שמות, tokens או סודות בתשובה, בלוג או ב-console', async (t) => {
    const cap = captureConsole(t);
    const texts = [];
    const scenarios = [
      { sql: dcSql({ rows: [row('1', CAL_A, H)] }), fetchImpl: googleFetch() },
      { sql: dcSql({ rows: [row('1', CAL_A, H)] }), fetchImpl: googleFetch({ watch: new Error(`${ACCESS_TOKEN} ${CAL_NAMES[0]} ${CAL_A}`) }) },
      { sql: dcSql({ rows: [row('1', CAL_A, H)] }), fetchImpl: googleFetch({ token: new Error(ACCESS_TOKEN) }) },
      { sql: dcSql({ failRenewRead: true }), fetchImpl: googleFetch() },
    ];
    for (const s of scenarios) {
      texts.push(await (await run(s)).text(), JSON.stringify(s.sql.logs));
    }
    assertNoSecrets(assert, texts.join('\n') + cap.text(), [...CAL_NAMES, ...CALENDARS.map((c) => c.id), 'dc-channel', 'new-channel', 'res-', SECRET]);
  });
});
