// בדיקות ל-api/google-auth-callback.js: החזרה מ-Google אחרי ההסכמה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/google-auth-callback.js';
import { SCOPES, decryptToken } from '../lib/google.js';
import { fakeSql, captureConsole, req, jsonResponse } from './helpers.js';
import { CONFIG, KEY, KEY_B64, googleFetch, assertNoSecrets, REFRESH_TOKEN, AUTH_CODE, ACCESS_TOKEN, CLIENT_SECRET } from './google-fixtures.js';

const STATE = 'S'.repeat(43);
const cbUrl = (params = {}) => {
  const u = new URL('https://app.test/api/google-auth-callback');
  for (const [k, v] of Object.entries({ state: STATE, code: AUTH_CODE, ...params })) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
};
const get = (params) => req(cbUrl(params));
// sql: state תקף כברירת מחדל
const okSql = (extra) => fakeSql((text, values, i) => {
  if (extra) { const r = extra(text, values, i); if (r !== undefined) return r; }
  if (text.startsWith('UPDATE google_oauth_states')) return [{ state: STATE }];
  return [];
});
const run = (r, deps = {}) => handle(r, { sql: okSql(), config: CONFIG, fetchImpl: googleFetch(), now: () => Date.parse('2026-10-07T10:00:00Z'), ...deps });

describe('google-auth-callback: שיטות והגדרות', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      assert.equal((await run(req(cbUrl(), { method }))).status, 405);
    });
  }
  test('חסרים משתני סביבה - 500, שמות בלבד', async (t) => {
    captureConsole(t);
    const res = await run(get(), { config: { ...CONFIG, clientSecret: undefined } });
    assert.equal(res.status, 500);
    const html = await res.text();
    assert.ok(html.includes('GOOGLE_CLIENT_SECRET'));
  });
  test('מפתח הצפנה פגום - 500 בלי חשיפת הערך', async (t) => {
    const cap = captureConsole(t);
    const res = await run(get(), { config: { ...CONFIG, encKeyRaw: 'not-a-valid-key-value' } });
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes('not-a-valid-key-value'));
    assert.ok(!cap.text().includes('not-a-valid-key-value'));
  });
});

describe('google-auth-callback: בדיקת state', () => {
  test('בלי state בכלל - 400 ושום פנייה ל-Google', async () => {
    const f = googleFetch();
    const res = await run(get({ state: undefined }), { fetchImpl: f });
    assert.equal(res.status, 400);
    assert.equal(f.calls.length, 0);
  });
  test('state לא קיים - 400 not_found ושום פנייה ל-Google', async () => {
    const f = googleFetch();
    const sql = fakeSql(() => []);
    const res = await run(get(), { sql, fetchImpl: f });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /לא נמצאה/);
    assert.equal(f.calls.length, 0);
  });
  test('state שפג - הודעת תפוגה', async () => {
    const sql = fakeSql((text) => (text.startsWith('UPDATE') ? [] : [{ expires_at: '2026-10-07T09:00:00Z', used_at: null }]));
    const res = await run(get(), { sql });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /פגה/);
  });
  test('state שכבר נוצל - הודעת "כבר נוצלה" (הגנה מ-replay)', async () => {
    const sql = fakeSql((text) => (text.startsWith('UPDATE') ? [] : [{ expires_at: '2026-10-07T11:00:00Z', used_at: '2026-10-07T09:55:00Z' }]));
    const f = googleFetch();
    const res = await run(get(), { sql, fetchImpl: f });
    assert.match(await res.text(), /כבר נוצלה/);
    assert.equal(f.calls.length, 0);
  });
  test('הפעלה כפולה של אותה כתובת: הראשונה מצליחה והשנייה נדחית', async () => {
    let used = false;
    const sql = fakeSql((text) => {
      if (text.startsWith('UPDATE google_oauth_states')) { if (used) return []; used = true; return [{ state: STATE }]; }
      if (text.startsWith('SELECT')) return [{ expires_at: '2026-10-07T11:00:00Z', used_at: '2026-10-07T10:00:00Z' }];
      return [];
    });
    const f = googleFetch();
    assert.equal((await run(get(), { sql, fetchImpl: f })).status, 200);
    assert.equal((await run(get(), { sql, fetchImpl: f })).status, 400);
    assert.equal(f.calls.length, 1);
  });
  test('state קצר/ארוך מדי - נדחה בלי לגעת במסד', async () => {
    for (const state of ['short', 'x'.repeat(201)]) {
      const sql = fakeSql();
      assert.equal((await run(get({ state }), { sql })).status, 400);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('כשל במסד בבדיקת state - 500', async (t) => {
    captureConsole(t);
    const res = await run(get(), { sql: fakeSql(() => { throw new Error('db'); }) });
    assert.equal(res.status, 500);
  });
  test('מסמך: ה-state נצרך לפני בדיקת הקוד/שגיאה, כך שניסיון נכשל שורף אותו', async () => {
    const sql = okSql();
    await run(get({ code: undefined }), { sql });
    assert.equal(sql.find('UPDATE google_oauth_states').length, 1);
  });
});

describe('google-auth-callback: קוד ושגיאות מ-Google', () => {
  test('המשתמש סירב (error=access_denied) - 400 ואין הד של הערך', async () => {
    const res = await run(get({ error: '<script>alert(1)</script>', code: undefined }));
    assert.equal(res.status, 400);
    const html = await res.text();
    assert.ok(!html.includes('script'));
    assert.ok(!html.includes('alert'));
  });
  test('בלי code / code ריק / code ארוך מ-2048 - 400 בלי פנייה ל-Google', async () => {
    for (const code of [undefined, '', 'c'.repeat(2049)]) {
      const f = googleFetch();
      const res = await run(get({ code }), { fetchImpl: f });
      assert.equal(res.status, 400);
      assert.equal(f.calls.length, 0);
    }
  });
  test('code באורך 2048 בדיוק עובר', async () => {
    assert.equal((await run(get({ code: 'c'.repeat(2048) }))).status, 200);
  });
  test('ה-code נשלח ל-Google כמו שהוא (גם עם תווים מיוחדים)', async () => {
    const f = googleFetch();
    await run(get({ code: '4/0A&x=y z' }), { fetchImpl: f });
    assert.equal(new URLSearchParams(f.calls[0].options.body).get('code'), '4/0A&x=y z');
  });
  test('Google מחזיר invalid_grant - 502 כללי', async (t) => {
    captureConsole(t);
    const f = googleFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) });
    const res = await run(get(), { fetchImpl: f });
    assert.equal(res.status, 502);
  });
  test('שגיאות 401/403/429/500 מ-Google - 502 ושום שמירה', async (t) => {
    captureConsole(t);
    for (const status of [401, 403, 429, 500, 503]) {
      const sql = okSql();
      const res = await run(get(), { sql, fetchImpl: googleFetch({ token: new Response('x', { status }) }) });
      assert.equal(res.status, 502, String(status));
      assert.equal(sql.find('INSERT INTO google_credentials').length, 0);
    }
  });
  test('timeout / שגיאת רשת - 502 ושום שמירה', async (t) => {
    captureConsole(t);
    for (const err of [Object.assign(new Error('t'), { name: 'TimeoutError' }), new TypeError('fetch failed')]) {
      const sql = okSql();
      const res = await run(get(), { sql, fetchImpl: googleFetch({ token: err }) });
      assert.equal(res.status, 502);
      assert.equal(sql.find('INSERT INTO google_credentials').length, 0);
    }
  });
  test('אין refresh_token - הודעה ייעודית, 502, ושום שמירה', async (t) => {
    captureConsole(t);
    const sql = okSql();
    const res = await run(get(), { sql, fetchImpl: googleFetch({ token: jsonResponse({ access_token: ACCESS_TOKEN, scope: SCOPES.join(' ') }) }) });
    assert.equal(res.status, 502);
    assert.match(await res.text(), /אישור חידוש/);
    assert.equal(sql.find('INSERT INTO google_credentials').length, 0);
  });
  test('חסר סקופ (הסכמה חלקית) - 400 ולא נשמר שום דבר', async () => {
    const sql = okSql();
    const res = await run(get(), { sql, fetchImpl: googleFetch({ token: jsonResponse({ access_token: 'a', refresh_token: 'r', scope: SCOPES[0] }) }) });
    assert.equal(res.status, 400);
    assert.equal(sql.find('INSERT INTO google_credentials').length, 0);
  });
  test('scope חסר לגמרי בתשובה - 400', async () => {
    const res = await run(get(), { fetchImpl: googleFetch({ token: jsonResponse({ access_token: 'a', refresh_token: 'r' }) }) });
    assert.equal(res.status, 400);
  });
  test('סקופים נוספים מעבר לנדרש - מתקבלים', async () => {
    const res = await run(get(), { fetchImpl: googleFetch({ token: jsonResponse({ access_token: 'a', refresh_token: 'r', scope: `${SCOPES.join(' ')} openid` }) }) });
    assert.equal(res.status, 200);
  });
});

describe('google-auth-callback: שמירה', () => {
  test('הצלחה: 200 "מחובר" ו-refresh token נשמר מוצפן שמתפענח חזרה', async () => {
    const sql = okSql();
    const res = await run(get(), { sql });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /מחובר/);
    const ins = sql.find('INSERT INTO google_credentials')[0];
    assert.equal(ins.values[0], 'primary');
    assert.notEqual(ins.values[1], REFRESH_TOKEN);
    assert.ok(!ins.values.some((v) => String(v).includes(REFRESH_TOKEN)));
    assert.equal(decryptToken(ins.values[1], KEY), REFRESH_TOKEN);
    assert.equal(ins.values[2], SCOPES.join(' '));
  });
  test('access token לעולם לא נשמר', async () => {
    const sql = okSql();
    await run(get(), { sql });
    assert.ok(!JSON.stringify(sql.calls).includes(ACCESS_TOKEN));
  });
  test('חיבור מחדש הוא upsert שמנקה שגיאה (ON CONFLICT), בלי מחיקה', async () => {
    const sql = okSql();
    await run(get(), { sql });
    const q = sql.find('INSERT INTO google_credentials')[0].text;
    assert.match(q, /ON CONFLICT \(account\) DO UPDATE/);
    assert.match(q, /last_error = NULL/);
    assert.ok(!sql.calls.some((c) => /DELETE/i.test(c.text)));
  });
  test('כשל בשמירה - 500 והלוג לא כולל טוקנים', async (t) => {
    const cap = captureConsole(t);
    const sql = okSql((text) => { if (text.startsWith('INSERT INTO google_credentials')) throw new Error(`insert failed ${REFRESH_TOKEN}`); });
    const res = await run(get(), { sql });
    assert.equal(res.status, 500);
    assertNoSecrets(assert, cap.text() + (await res.text()));
  });
});

describe('google-auth-callback: אבטחת הדף', () => {
  test('כותרות: no-store, no-referrer, html utf-8', async () => {
    const res = await run(get());
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  });
  test('ערכי state/code/error מהכתובת לעולם לא מוחזרים בדף (אין XSS מוחזר)', async () => {
    const evil = '"><img src=x onerror=alert(1)>';
    for (const params of [{ state: evil }, { code: evil }, { error: evil }, { state: STATE, code: evil, error: evil }]) {
      const html = await (await run(get(params))).text();
      assert.ok(!html.includes('onerror'), JSON.stringify(params));
      assert.ok(!html.includes('<img'), JSON.stringify(params));
    }
  });
  test('אף מסלול לא חושף code, טוקנים, סוד לקוח או מפתח - לא בדף ולא בלוג', async (t) => {
    const cap = captureConsole(t);
    const pages = [];
    pages.push(await (await run(get())).text());
    pages.push(await (await run(get({ code: undefined }))).text());
    pages.push(await (await run(get(), { fetchImpl: googleFetch({ token: jsonResponse({ error: 'invalid_grant', error_description: AUTH_CODE }, 400) }) })).text());
    pages.push(await (await run(get(), { fetchImpl: googleFetch({ token: new TypeError(`boom ${CLIENT_SECRET} ${AUTH_CODE}`) }) })).text());
    pages.push(await (await run(get(), { sql: fakeSql(() => { throw new Error(`${KEY_B64}`); }) })).text());
    assertNoSecrets(assert, pages.join('\n') + cap.text());
  });
  test('HTML תקין: lang=he ו-dir=rtl', async () => {
    const html = await (await run(get())).text();
    assert.match(html, /<html lang="he" dir="rtl">/);
  });
});
