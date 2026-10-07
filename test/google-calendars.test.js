// בדיקות ל-api/google-calendars.js: רענון token וקריאת רשימת יומנים (קריאה בלבד).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/google-calendars.js';
import { fakeSql, captureConsole, req, jsonResponse, FAKE_SECRET } from './helpers.js';
import { CONFIG, KEY, googleFetch, encRefresh, assertNoSecrets, CALENDARS, CAL_NAMES, ACCESS_TOKEN } from './google-fixtures.js';
import { encryptToken } from '../lib/google.js';
import { randomBytes } from 'node:crypto';

const H = { 'x-intake-secret': FAKE_SECRET };
const get = (headers = H) => req('https://x.test/api/google-calendars', { headers });
const connectedSql = (extra) => fakeSql((text, values, i) => {
  if (extra) { const r = extra(text, values, i); if (r !== undefined) return r; }
  if (text.startsWith('SELECT refresh_token_enc')) return [{ refresh_token_enc: encRefresh() }];
  return [];
});
const run = (r, deps = {}) => handle(r, { sql: connectedSql(), secret: FAKE_SECRET, config: CONFIG, fetchImpl: googleFetch(), ...deps });
const lastErrors = (sql) => sql.find('SET last_error = ?').map((c) => c.values[0]);

describe('google-calendars: שיטות ואימות', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      assert.equal((await run(req('https://x.test/', { method, headers: H }))).status, 405);
    });
  }
  test('בלי סוד / שגוי / אורכים שונים - 401 וללא גישה למסד או ל-Google', async () => {
    const sql = connectedSql();
    const f = googleFetch();
    for (const headers of [{}, { 'x-intake-secret': 'no' }, { 'x-intake-secret': FAKE_SECRET.slice(1) }, { 'x-intake-secret': 'q'.repeat(9999) }]) {
      const res = await run(get(headers), { sql, fetchImpl: f });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).reason, 'unauthorized');
    }
    assert.equal(sql.calls.length, 0);
    assert.equal(f.calls.length, 0);
  });
  test('סוד לא מוגדר בשרת - 401', async (t) => {
    captureConsole(t);
    for (const secret of [undefined, '', null]) assert.equal((await run(get({}), { secret })).status, 401);
  });
});

describe('google-calendars: הגדרות', () => {
  test('חסרים משתנים - 500 config_missing', async (t) => {
    captureConsole(t);
    const res = await run(get(), { config: { ...CONFIG, clientId: undefined } });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).reason, 'config_missing');
  });
  test('מפתח הצפנה בגודל שגוי - 500 config_missing בלי חשיפת הערך', async (t) => {
    const cap = captureConsole(t);
    const bad = randomBytes(16).toString('base64');
    const res = await run(get(), { config: { ...CONFIG, encKeyRaw: bad } });
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes(bad));
    assert.ok(!cap.text().includes(bad));
  });
});

describe('google-calendars: מצבי חיבור', () => {
  test('כשל בקריאת החיבור מהמסד - 500 db_error', async (t) => {
    captureConsole(t);
    const res = await run(get(), { sql: fakeSql(() => { throw new Error('boom'); }) });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).reason, 'db_error');
  });
  test('אין שורת חיבור - 409 not_connected ואין פנייה ל-Google', async () => {
    const f = googleFetch();
    const res = await run(get(), { sql: fakeSql(() => []), fetchImpl: f });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).reason, 'not_connected');
    assert.equal(f.calls.length, 0);
  });
  test('פענוח נכשל (המפתח הוחלף) - 500 decrypt_failed ונרשם last_error', async () => {
    const sql = connectedSql((text) => (text.startsWith('SELECT') ? [{ refresh_token_enc: encryptToken('tok', randomBytes(32)) }] : undefined));
    const f = googleFetch();
    const res = await run(get(), { sql, fetchImpl: f });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).reason, 'decrypt_failed');
    assert.deepEqual(lastErrors(sql), ['decrypt_failed']);
    assert.equal(f.calls.length, 0);
  });
  test('ערך מוצפן פגום / null במסד - decrypt_failed ולא קריסה', async () => {
    for (const bad of ['garbage', null, '', 'v1.a.b.c']) {
      const sql = connectedSql((text) => (text.startsWith('SELECT') ? [{ refresh_token_enc: bad }] : undefined));
      const res = await run(get(), { sql });
      assert.equal((await res.json()).reason, 'decrypt_failed', String(bad));
    }
  });
  test('ערך מוצפן שעבר שינוי (tampered) - decrypt_failed', async () => {
    const parts = encRefresh().split('.');
    const b = Buffer.from(parts[3], 'base64url');
    b[0] ^= 1;
    parts[3] = b.toString('base64url');
    const sql = connectedSql((text) => (text.startsWith('SELECT') ? [{ refresh_token_enc: parts.join('.') }] : undefined));
    assert.equal((await (await run(get(), { sql })).json()).reason, 'decrypt_failed');
  });
});

describe('google-calendars: רענון token', () => {
  test('invalid_grant - 502 invalid_grant ונרשם last_error קצר', async (t) => {
    captureConsole(t);
    const sql = connectedSql();
    const res = await run(get(), { sql, fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).reason, 'invalid_grant');
    assert.deepEqual(lastErrors(sql), ['invalid_grant (400)']);
  });
  test('5xx / 429 / 401 / 403 מ-Google ברענון - 502 refresh_failed', async (t) => {
    captureConsole(t);
    for (const status of [401, 403, 429, 500, 502, 503]) {
      const sql = connectedSql();
      const res = await run(get(), { sql, fetchImpl: googleFetch({ token: new Response('x', { status }) }) });
      assert.equal(res.status, 502, String(status));
      assert.equal((await res.json()).reason, 'refresh_failed');
      assert.deepEqual(lastErrors(sql), [`http_error (${status})`]);
    }
  });
  test('timeout ושגיאת רשת ברענון - refresh_failed עם last_error מתאים', async (t) => {
    captureConsole(t);
    const cases = [[Object.assign(new Error('x'), { name: 'TimeoutError' }), 'timeout'], [new TypeError('fetch failed'), 'network']];
    for (const [err, code] of cases) {
      const sql = connectedSql();
      const res = await run(get(), { sql, fetchImpl: googleFetch({ token: err }) });
      assert.equal((await res.json()).reason, 'refresh_failed');
      assert.deepEqual(lastErrors(sql), [code]);
    }
  });
  test('כשל ברישום last_error לא מסתיר את השגיאה המקורית', async (t) => {
    captureConsole(t);
    const sql = connectedSql((text) => { if (text.includes('SET last_error')) throw new Error('write failed'); });
    const res = await run(get(), { sql, fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) });
    assert.equal(res.status, 502);
    assert.equal((await res.json()).reason, 'invalid_grant');
  });
  test('Google מחזיר 200 בלי access_token - refresh_failed', async (t) => {
    captureConsole(t);
    const res = await run(get(), { fetchImpl: googleFetch({ token: jsonResponse({}) }) });
    assert.equal((await res.json()).reason, 'refresh_failed');
  });
});

describe('google-calendars: קריאת היומנים', () => {
  test('הצלחה: 200 עם { calendars } בלבד, ובלי שדות עודפים', async () => {
    const res = await run(get());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['calendars']);
    assert.equal(body.calendars.length, 3);
    assert.deepEqual(Object.keys(body.calendars[0]).sort(), ['accessRole', 'id', 'summary']);
    assert.ok(!JSON.stringify(body).includes('"extra"'));
  });
  test('ה-refresh token מוחלף ב-access token ונשלח כ-Bearer, ולא מוחזר', async () => {
    const f = googleFetch();
    const res = await run(get(), { fetchImpl: f });
    const listCall = f.calls.find((c) => c.url.includes('calendarList'));
    assert.equal(listCall.options.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
    assertNoSecrets(assert, await res.text());
  });
  test('אחרי הצלחה: last_refresh_at מתעדכן ו-last_error מתנקה', async () => {
    const sql = connectedSql();
    await run(get(), { sql });
    assert.equal(sql.find('last_refresh_at = now(), last_error = NULL').length, 1);
  });
  test('כשל בעדכון last_refresh_at לא פוגע בתשובה', async (t) => {
    captureConsole(t);
    const sql = connectedSql((text) => { if (text.includes('last_refresh_at')) throw new Error('x'); });
    assert.equal((await run(get(), { sql })).status, 200);
  });
  test('אין יומנים - 200 עם רשימה ריקה', async () => {
    const res = await run(get(), { fetchImpl: googleFetch({ list: jsonResponse({}) }) });
    assert.deepEqual(await res.json(), { calendars: [] });
  });
  test('401/403 מהרשימה - 502 calendar_forbidden ו-last_error מתאים', async (t) => {
    captureConsole(t);
    for (const status of [401, 403]) {
      const sql = connectedSql();
      const res = await run(get(), { sql, fetchImpl: googleFetch({ list: new Response('{}', { status }) }) });
      assert.equal(res.status, 502);
      assert.equal((await res.json()).reason, 'calendar_forbidden');
      assert.deepEqual(lastErrors(sql), [`calendarlist_http_error (${status})`]);
    }
  });
  test('429/500/503 מהרשימה - 502 calendar_failed', async (t) => {
    captureConsole(t);
    for (const status of [404, 429, 500, 503]) {
      const res = await run(get(), { fetchImpl: googleFetch({ list: new Response('{}', { status }) }) });
      assert.equal(res.status, 502, String(status));
      assert.equal((await res.json()).reason, 'calendar_failed');
    }
  });
  test('timeout/רשת/JSON פגום ברשימה - calendar_failed', async (t) => {
    captureConsole(t);
    for (const list of [Object.assign(new Error('x'), { name: 'TimeoutError' }), new Error('net'), new Response('not json')]) {
      const res = await run(get(), { fetchImpl: googleFetch({ list }) });
      assert.equal((await res.json()).reason, 'calendar_failed');
    }
  });
});

describe('google-calendars: פרטיות בלוג ובשגיאות', () => {
  test('בכל תרחיש כשל: אין סודות, טוקנים או שמות יומנים בלוג ובתשובה', async (t) => {
    const cap = captureConsole(t);
    const bodies = [];
    const scenarios = [
      { fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant', error_description: ACCESS_TOKEN }, 400) }) },
      { fetchImpl: googleFetch({ token: new TypeError(`net ${ACCESS_TOKEN}`) }) },
      { fetchImpl: googleFetch({ list: new Response(JSON.stringify({ error: { message: CAL_NAMES[0] } }), { status: 403 }) }) },
      { fetchImpl: googleFetch({ list: new Error(`Bearer ${ACCESS_TOKEN} ${CAL_NAMES[0]}`) }) },
      { sql: fakeSql(() => { throw new Error(`db ${CAL_NAMES[1]}`); }) },
      { sql: connectedSql((text) => { if (text.includes('SET last_error')) throw new Error(ACCESS_TOKEN); }), fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) },
    ];
    for (const s of scenarios) bodies.push(await (await run(get(), s)).text());
    const everything = bodies.join('\n') + cap.text();
    assertNoSecrets(assert, everything, [...CAL_NAMES, ...CALENDARS.map((c) => c.id), FAKE_SECRET]);
  });
  test('הודעות כשל בעברית ומובנות: reason + message בכל תשובת שגיאה', async (t) => {
    captureConsole(t);
    const res = await run(get(), { sql: fakeSql(() => []) });
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ['message', 'reason']);
    assert.match(body.message, /[א-ת]/);
  });
  test('מפתח ההצפנה בשימוש הוא המפתח התואם: טוקן שהוצפן במפתח אחר לא מפוענח', async () => {
    const sql = connectedSql((text) => (text.startsWith('SELECT') ? [{ refresh_token_enc: encRefresh(KEY) }] : undefined));
    assert.equal((await run(get(), { sql })).status, 200);
  });
});
