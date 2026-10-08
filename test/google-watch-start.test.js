// בדיקות ל-api/google-watch-start.js: פתיחת ערוצי watch לכל יומן עם הרשאת owner/writer.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/google-watch-start.js';
import { verifyChannelToken, WATCH_ADDRESS } from '../lib/google.js';
import { fakeSql, captureConsole, req, jsonResponse, FAKE_SECRET } from './helpers.js';
import { CONFIG, KEY, googleFetch, encRefresh, assertNoSecrets, CALENDARS, CAL_NAMES, ACCESS_TOKEN } from './google-fixtures.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const post = (headers = H) => req('https://x.test/api/google-watch-start', { method: 'POST', headers });
// activeFor: קבוצת calendar_id שיש להם כבר ערוץ פעיל
function mkSql({ activeFor = [], onQuery } = {}) {
  return fakeSql((text, values, i) => {
    if (onQuery) { const r = onQuery(text, values, i); if (r !== undefined) return r; }
    if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
    if (text.includes('FROM google_watch_channels')) return activeFor.includes(values[0]) ? [{ id: 1 }] : [];
    return [];
  });
}
let counter = 0;
const run = (r, deps = {}) => handle(r, {
  sql: mkSql(), secret: FAKE_SECRET, config: CONFIG, fetchImpl: googleFetch(),
  makeChannelId: () => `channel-${++counter}`, address: WATCH_ADDRESS, ...deps,
});
const inserts = (sql) => sql.find('INSERT INTO google_watch_channels');

describe('google-watch-start: שיטות ואימות', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => assert.equal((await run(req('https://x.test/', { method, headers: H }))).status, 405));
  }
  test('סוד חסר/שגוי/באורך שונה - 401 בלי שום גישה', async () => {
    const sql = mkSql();
    const f = googleFetch();
    for (const headers of [{}, { 'x-intake-secret': 'no' }, { 'x-intake-secret': `${FAKE_SECRET}!` }, { 'x-intake-secret': 'a'.repeat(5000) }]) {
      assert.equal((await run(post(headers), { sql, fetchImpl: f })).status, 401);
    }
    assert.equal(sql.calls.length, 0);
    assert.equal(f.calls.length, 0);
  });
  test('סוד לא מוגדר בשרת - 401', async (t) => {
    captureConsole(t);
    for (const secret of [undefined, '']) assert.equal((await run(post({}), { secret })).status, 401);
  });
});

describe('google-watch-start: הגדרות וחיבור', () => {
  test('חסרים משתנים - 500 config_missing', async (t) => {
    captureConsole(t);
    const res = await run(post(), { config: { ...CONFIG, clientSecret: '' } });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).reason, 'config_missing');
  });
  test('מפתח הצפנה לא תקין - 500', async (t) => {
    captureConsole(t);
    assert.equal((await run(post(), { config: { ...CONFIG, encKeyRaw: 'AAAA' } })).status, 500);
  });
  test('כשל מסד בקריאת חיבור - 500 db_error', async (t) => {
    captureConsole(t);
    const res = await run(post(), { sql: fakeSql(() => { throw new Error('x'); }) });
    assert.equal((await res.json()).reason, 'db_error');
  });
  test('אין חיבור - 409 not_connected', async () => {
    assert.equal((await run(post(), { sql: fakeSql(() => []) })).status, 409);
  });
  test('פענוח נכשל - 500 decrypt_failed', async () => {
    const sql = fakeSql(() => [{ refresh_token_enc: 'garbage' }]);
    const res = await run(post(), { sql });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).reason, 'decrypt_failed');
  });
  test('invalid_grant ברענון - 502', async (t) => {
    captureConsole(t);
    const res = await run(post(), { fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).reason, 'invalid_grant');
  });
  test('כשל זמני ברענון (500/429/timeout/רשת) - 502 refresh_failed', async (t) => {
    captureConsole(t);
    for (const token of [new Response('x', { status: 500 }), new Response('x', { status: 429 }), Object.assign(new Error('t'), { name: 'TimeoutError' }), new Error('n')]) {
      const res = await run(post(), { fetchImpl: googleFetch({ token }) });
      assert.equal((await res.json()).reason, 'refresh_failed');
    }
  });
  test('401/403 מרשימת היומנים - calendar_forbidden; אחרים - calendar_failed', async (t) => {
    captureConsole(t);
    for (const status of [401, 403]) {
      assert.equal((await (await run(post(), { fetchImpl: googleFetch({ list: new Response('{}', { status }) }) })).json()).reason, 'calendar_forbidden');
    }
    for (const status of [429, 500]) {
      assert.equal((await (await run(post(), { fetchImpl: googleFetch({ list: new Response('{}', { status }) }) })).json()).reason, 'calendar_failed');
    }
  });
  test('אין פתיחת ערוץ כשהרשימה נכשלה', async (t) => {
    captureConsole(t);
    const f = googleFetch({ list: new Response('{}', { status: 500 }) });
    const sql = mkSql();
    await run(post(), { fetchImpl: f, sql });
    assert.equal(f.calls.filter((c) => c.url.includes('/events/watch')).length, 0);
    assert.equal(inserts(sql).length, 0);
  });
});

describe('google-watch-start: פתיחת ערוצים', () => {
  test('owner ו-writer נפתחים, reader מדולג; ספירות נכונות', async () => {
    const sql = mkSql();
    const f = googleFetch();
    const res = await run(post(), { sql, fetchImpl: f });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total_calendars, 3);
    assert.equal(body.skipped_read_only, 1);
    assert.equal(body.created, 2);
    assert.equal(body.already_active, 0);
    assert.equal(body.failed, 0);
    assert.equal(f.calls.filter((c) => c.url.includes('/events/watch')).length, 2);
    assert.equal(inserts(sql).length, 2);
  });
  test('תפקידים אחרים (freeBusyReader, reader, חסר) ויומן בלי id - מדולגים', async () => {
    const items = [
      { id: 'a', accessRole: 'freeBusyReader' }, { id: 'b', accessRole: 'reader' }, { id: 'c' },
      { accessRole: 'owner' }, { id: 5, accessRole: 'owner' }, { id: 'd', accessRole: 'OWNER' },
    ];
    const f = googleFetch({ list: jsonResponse({ items }) });
    const body = await (await run(post(), { fetchImpl: f })).json();
    assert.equal(body.created, 0);
    assert.equal(body.skipped_read_only, 6);
    assert.equal(f.calls.filter((c) => c.url.includes('/events/watch')).length, 0);
  });
  test('הערוץ נרשם ב-Google עם כתובת ה-webhook, מזהה ו-HMAC שמאומת עם המפתח', async () => {
    const f = googleFetch();
    const sql = mkSql();
    await run(post(), { sql, fetchImpl: f });
    const watchCall = f.calls.find((c) => c.url.includes('/events/watch'));
    const sent = JSON.parse(watchCall.options.body);
    assert.equal(sent.type, 'web_hook');
    assert.equal(sent.address, WATCH_ADDRESS);
    assert.equal(verifyChannelToken(sent.token, sent.id, KEY), true);
    assert.equal(verifyChannelToken(sent.token, `${sent.id}x`, KEY), false);
    assert.equal(inserts(sql)[0].values[1], sent.id);
  });
  test('שורת הערוץ נשמרת עם calendar_id, channel_id, resource_id ו-expiration ISO', async () => {
    const sql = mkSql();
    await run(post(), { sql });
    const [calendarId, channelId, resourceId, expiration] = inserts(sql)[0].values;
    assert.equal(calendarId, CALENDARS[0].id);
    assert.match(channelId, /^channel-/);
    assert.match(resourceId, /^res-/);
    assert.equal(expiration, '2026-11-07T10:00:00.000Z');
  });
  test('בלי expiration מ-Google - נשמר NULL', async () => {
    const sql = mkSql();
    const f = googleFetch({ watch: jsonResponse({ resourceId: 'R' }) });
    const body = await (await run(post(), { sql, fetchImpl: f })).json();
    assert.equal(inserts(sql)[0].values[3], null);
    assert.equal(body.results[0].expiration, null);
  });
  test('שני יומנים - מזהי ערוץ שונים וטוקנים שונים', async () => {
    const f = googleFetch();
    await run(post(), { fetchImpl: f });
    const sent = f.calls.filter((c) => c.url.includes('/events/watch')).map((c) => JSON.parse(c.options.body));
    assert.notEqual(sent[0].id, sent[1].id);
    assert.notEqual(sent[0].token, sent[1].token);
  });
  test('אין יומנים בכלל - 200 עם אפסים', async () => {
    const body = await (await run(post(), { fetchImpl: googleFetch({ list: jsonResponse({ items: [] }) }) })).json();
    assert.deepEqual(body, { total_calendars: 0, skipped_read_only: 0, created: 0, already_active: 0, failed: 0, results: [] });
  });
});

describe('google-watch-start: אידמפוטנטיות', () => {
  test('יומן עם ערוץ פעיל מדולג - בלי פנייה ל-Google ובלי INSERT', async () => {
    const sql = mkSql({ activeFor: [CALENDARS[0].id, CALENDARS[1].id] });
    const f = googleFetch();
    const body = await (await run(post(), { sql, fetchImpl: f })).json();
    assert.equal(body.already_active, 2);
    assert.equal(body.created, 0);
    assert.equal(f.calls.filter((c) => c.url.includes('/events/watch')).length, 0);
    assert.equal(inserts(sql).length, 0);
    assert.deepEqual(body.results.map((r) => r.status), ['already_active', 'already_active']);
  });
  test('שאילתת הבדיקה: לא נעצר, ותפוגה ריקה או עתידית', async () => {
    const sql = mkSql();
    await run(post(), { sql });
    const q = sql.find('FROM google_watch_channels')[0].text;
    assert.match(q, /stopped_at IS NULL/);
    assert.match(q, /expiration IS NULL OR expiration > now\(\)/);
  });
  test('הרצה שנייה עם מסד זיכרון: הראשונה יוצרת, השנייה מדלגת', async () => {
    const rows = new Set();
    const sql = fakeSql((text, values) => {
      if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
      if (text.includes('FROM google_watch_channels')) return rows.has(values[0]) ? [{ id: 1 }] : [];
      if (text.startsWith('INSERT INTO google_watch_channels')) { rows.add(values[0]); return []; }
      return [];
    });
    const f = googleFetch();
    const first = await (await run(post(), { sql, fetchImpl: f })).json();
    const second = await (await run(post(), { sql, fetchImpl: f })).json();
    assert.equal(first.created, 2);
    assert.equal(second.created, 0);
    assert.equal(second.already_active, 2);
  });
});

describe('google-watch-start: כשלים חלקיים', () => {
  test('watch נכשל ביומן אחד - האחרים ממשיכים', async (t) => {
    captureConsole(t);
    const f = googleFetch({ watch: (url, o, i) => (url.includes('private-cal-id-1') ? new Response('{}', { status: 403 }) : jsonResponse({ resourceId: `r${i}` })) });
    const body = await (await run(post(), { fetchImpl: f })).json();
    assert.equal(body.created, 1);
    assert.equal(body.failed, 1);
    assert.deepEqual(body.results[0], { index: 0, ok: false, reason: 'http_error (403)' });
    assert.equal(body.results[1].ok, true);
  });
  test('סיבות כשל של watch: 429, 5xx, timeout, רשת, bad_response', async (t) => {
    captureConsole(t);
    const cases = [
      [new Response('{}', { status: 429 }), 'http_error (429)'], [new Response('{}', { status: 503 }), 'http_error (503)'],
      [Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout'], [new Error('x'), 'network'],
      [jsonResponse({}), 'bad_response (200)'], [jsonResponse({ error: 'push_webhook_url_not_https' }, 400), 'push_webhook_url_not_https (400)'],
    ];
    for (const [watch, reason] of cases) {
      const body = await (await run(post(), { fetchImpl: googleFetch({ watch }) })).json();
      assert.equal(body.failed, 2, reason);
      assert.equal(body.results[0].reason, reason);
    }
  });
  test('כשל INSERT אחרי שהערוץ נפתח אצל Google - מדווח db_insert_failed וממשיך', async (t) => {
    captureConsole(t);
    const sql = mkSql({ onQuery: (text) => { if (text.startsWith('INSERT INTO google_watch_channels')) throw new Error('constraint'); } });
    const body = await (await run(post(), { sql })).json();
    assert.equal(body.failed, 2);
    assert.equal(body.results[0].reason, 'db_insert_failed');
  });
  test('כשל בשאילתת הבדיקה - unexpected_error ליומן, האחרים ממשיכים', async (t) => {
    captureConsole(t);
    let n = 0;
    const sql = mkSql({ onQuery: (text) => { if (text.includes('FROM google_watch_channels') && n++ === 0) throw new Error('blip'); } });
    const body = await (await run(post(), { sql })).json();
    assert.equal(body.results[0].reason, 'unexpected_error');
    assert.equal(body.results[1].status, 'created');
  });
  test('expiration מופרך (ענק) - הערוץ נשמר עם NULL ומסומן expiration_unusable, בלי כשל', async (t) => {
    captureConsole(t);
    const sql = mkSql();
    const f = googleFetch({ watch: () => jsonResponse({ resourceId: 'R', expiration: '1e30' }) });
    const res = await run(post(), { sql, fetchImpl: f });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.created, 2);
    assert.equal(body.failed, 0);
    assert.equal(inserts(sql).length, 2);
    assert.equal(inserts(sql)[0].values[3], null);
    assert.deepEqual(body.results[0], { index: 0, ok: true, status: 'created', expiration: null, expiration_unusable: true });
  });
  test('expiration בגבול התקף האחרון (8.64e15) נשמר רגיל; מעליו - NULL', async (t) => {
    captureConsole(t);
    const ok = mkSql();
    await run(post(), { sql: ok, fetchImpl: googleFetch({ watch: () => jsonResponse({ resourceId: 'R', expiration: '8640000000000000' }) }) });
    assert.equal(inserts(ok)[0].values[3], '+275760-09-13T00:00:00.000Z');
    const over = mkSql();
    await run(post(), { sql: over, fetchImpl: googleFetch({ watch: () => jsonResponse({ resourceId: 'R', expiration: '8640000000000001' }) }) });
    assert.equal(inserts(over)[0].values[3], null);
  });
});

describe('google-watch-start: פרטיות', () => {
  test('התשובה לא מכילה שמות יומנים, מזהי יומנים, ערוצים, resourceId, טוקנים או סודות', async () => {
    const res = await run(post());
    const text = await res.text();
    assertNoSecrets(assert, text, [...CAL_NAMES, ...CALENDARS.map((c) => c.id), 'channel-', 'res-', 'google.com', FAKE_SECRET]);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
  test('התשובה כוללת רק index וסטטוסים', async () => {
    const body = await (await run(post())).json();
    for (const r of body.results) {
      for (const key of Object.keys(r)) assert.ok(['index', 'ok', 'status', 'reason', 'expiration', 'expiration_unusable'].includes(key), key);
    }
  });
  test('בכל כשל: הלוג והתשובה נקיים מטוקנים, שמות יומנים וסודות', async (t) => {
    const cap = captureConsole(t);
    const texts = [];
    const scenarios = [
      { fetchImpl: googleFetch({ watch: new Error(`Bearer ${ACCESS_TOKEN} ${CAL_NAMES[0]} ${CALENDARS[0].id}`) }) },
      { fetchImpl: googleFetch({ watch: new Response(JSON.stringify({ error: CAL_NAMES[1] }), { status: 400 }) }) },
      { fetchImpl: googleFetch({ list: new Error(ACCESS_TOKEN) }) },
      { sql: mkSql({ onQuery: (text) => { if (text.startsWith('INSERT INTO google_watch')) throw new Error(`${CAL_NAMES[0]} ${CALENDARS[0].id}`); } }) },
      { sql: fakeSql(() => { throw new Error(CAL_NAMES[2]); }) },
    ];
    for (const s of scenarios) texts.push(await (await run(post(), s)).text());
    assertNoSecrets(assert, texts.join('\n') + cap.text(), [...CAL_NAMES, ...CALENDARS.map((c) => c.id)]);
  });
});
