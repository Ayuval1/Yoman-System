// בדיקות ל-api/google-auth-start.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/google-auth-start.js';
import { fakeSql, captureConsole, req, FAKE_SECRET } from './helpers.js';
import { CONFIG, assertNoSecrets, CLIENT_SECRET } from './google-fixtures.js';
import { SCOPES } from '../lib/google.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const post = (headers = H) => req('https://x.test/api/google-auth-start', { method: 'POST', headers });
const run = (r, deps = {}) => handle(r, { sql: fakeSql(), secret: FAKE_SECRET, config: CONFIG, makeState: () => 'STATE-FIXED-1234567890', ...deps });

describe('google-auth-start: שיטות ואימות', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    test(`${method} - 405 עם JSON`, async () => {
      const res = await run(req('https://x.test/', { method, headers: H }));
      assert.equal(res.status, 405);
      assert.equal((await res.json()).reason, 'method_not_allowed');
    });
  }
  test('בלי סוד / שגוי / אורכים שונים - 401 ושום שמירה', async () => {
    const sql = fakeSql();
    for (const headers of [{}, { 'x-intake-secret': 'no' }, { 'x-intake-secret': FAKE_SECRET + '1' }, { 'x-intake-secret': 'z'.repeat(9999) }]) {
      const res = await run(post(headers), { sql });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).reason, 'unauthorized');
    }
    assert.equal(sql.calls.length, 0);
  });
  test('סוד לא מוגדר בשרת - 401', async (t) => {
    captureConsole(t);
    for (const secret of [undefined, '', null]) assert.equal((await run(post({}), { secret })).status, 401);
  });
});

describe('google-auth-start: הגדרות', () => {
  test('חסרים משתני סביבה - 500 config_missing עם שמות בלבד', async (t) => {
    const cap = captureConsole(t);
    const res = await run(post(), { config: { redirectUri: 'x' } });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.reason, 'config_missing');
    for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENC_KEY']) assert.ok(body.message.includes(name));
    assert.ok(cap.text().includes('GOOGLE_CLIENT_ID'));
  });
  test('חסר רק TOKEN_ENC_KEY - מדווח עליו בלבד', async (t) => {
    captureConsole(t);
    const res = await run(post(), { config: { ...CONFIG, encKeyRaw: undefined } });
    const body = await res.json();
    assert.ok(body.message.includes('TOKEN_ENC_KEY'));
    assert.ok(!body.message.includes('GOOGLE_CLIENT_ID'));
  });
});

describe('google-auth-start: יצירת בקשת חיבור', () => {
  test('הצלחה: 200 עם { url } בלבד, ו-state נשמר במסד', async () => {
    const sql = fakeSql();
    const res = await run(post(), { sql });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(Object.keys(body), ['url']);
    assert.match(sql.calls[0].text, /INSERT INTO google_oauth_states/);
    assert.equal(sql.calls[0].values[0], 'STATE-FIXED-1234567890');
  });
  test('ה-url מכיל את ה-state, ה-client_id, ה-redirect והסקופים - ובלי הסוד', async () => {
    const body = await (await run(post())).json();
    const u = new URL(body.url);
    assert.equal(u.searchParams.get('state'), 'STATE-FIXED-1234567890');
    assert.equal(u.searchParams.get('client_id'), CONFIG.clientId);
    assert.equal(u.searchParams.get('redirect_uri'), CONFIG.redirectUri);
    assert.equal(u.searchParams.get('scope'), SCOPES.join(' '));
    assert.ok(!body.url.includes(CLIENT_SECRET));
  });
  test('שתי קריאות עם generateState האמיתי נותנות state שונה', async () => {
    const sql = fakeSql();
    const mk = () => handle(post(), { sql, secret: FAKE_SECRET, config: CONFIG });
    await mk();
    await mk();
    assert.notEqual(sql.calls[0].values[0], sql.calls[1].values[0]);
    assert.ok(sql.calls[0].values[0].length >= 43);
  });
  test('כשל בשמירת state - 500 db_error בלי לחשוף את ה-state או הודעת השגיאה', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql(() => { throw Object.assign(new Error('relation does not exist STATE-FIXED-1234567890'), { name: 'NeonDbError' }); });
    const res = await run(post(), { sql });
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.ok(text.includes('db_error'));
    assert.ok(!text.includes('STATE-FIXED'));
    assert.ok(!cap.text().includes('STATE-FIXED'));
  });
  test('אין דליפת סודות בלוג בהצלחה ובכשל', async (t) => {
    const cap = captureConsole(t);
    await run(post());
    await run(post(), { sql: fakeSql(() => { throw new Error('x'); }) });
    assertNoSecrets(assert, cap.text(), [FAKE_SECRET]);
  });
});
