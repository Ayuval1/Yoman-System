// בדיקות ל-api/push-subscribe.js: רישום מנוי דחיפה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/push-subscribe.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const P256 = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const EP = 'https://web.push.apple.com/SECRET-ENDPOINT-TOKEN';
const goodBody = () => ({ endpoint: EP, keys: { p256dh: P256, auth: AUTH } });
const post = (body, headers = H) => jsonRequest(body, { headers });
const run = (r, sql = fakeSql(), extra = {}) => handle(r, { sql, secret: FAKE_SECRET, ...extra });

describe('push-subscribe: שיטות ואימות', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      const sql = fakeSql();
      const res = await run(req('https://x.test/', { method, headers: H }), sql);
      assert.equal(res.status, 405);
      assert.equal(sql.calls.length, 0);
    });
  }
  test('בלי סוד - 401', async () => {
    const sql = fakeSql();
    const res = await run(post(goodBody(), {}), sql);
    assert.equal(res.status, 401);
    assert.equal(sql.calls.length, 0);
  });
  test('סוד שגוי / באורכים שונים - 401', async () => {
    for (const bad of ['x', '', FAKE_SECRET + '1', 'y'.repeat(9999)]) {
      assert.equal((await run(post(goodBody(), { 'x-intake-secret': bad }))).status, 401);
    }
  });
  test('סוד לא מוגדר בשרת - 401 (נכשל סגור)', async (t) => {
    captureConsole(t);
    assert.equal((await run(post(goodBody(), { 'x-intake-secret': '' }), fakeSql(), { secret: '' })).status, 401);
    assert.equal((await run(post(goodBody()), fakeSql(), { secret: undefined })).status, 401);
  });
});

describe('push-subscribe: ולידציה של הגוף', () => {
  test('JSON פגום - 400', async () => {
    for (const bad of ['{', 'not json', '', '{"a":', "{'a':1}"]) {
      const sql = fakeSql();
      const res = await run(post(bad), sql);
      assert.equal(res.status, 400, bad);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('JSON תקין שאינו אובייקט (null, מחרוזת, מספר, מערך) - 400', async () => {
    for (const body of ['null', '"abc"', '5', '[]', 'true']) {
      const sql = fakeSql();
      assert.equal((await run(post(body), sql)).status, 400, body);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('גוף גדול מ-4096 תווים - 400', async () => {
    const big = { ...goodBody(), junk: 'x'.repeat(5000) };
    const sql = fakeSql();
    assert.equal((await run(post(big), sql)).status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('גוף של בדיוק 4096 תווים עובר את בדיקת הגודל', async () => {
    const base = JSON.stringify({ ...goodBody(), j: '' });
    const body = JSON.stringify({ ...goodBody(), j: 'x'.repeat(4096 - base.length) });
    assert.equal(body.length, 4096);
    assert.equal((await run(post(body))).status, 200);
  });
  test('גוף של 4097 תווים - 400', async () => {
    const base = JSON.stringify({ ...goodBody(), j: '' });
    const body = JSON.stringify({ ...goodBody(), j: 'x'.repeat(4097 - base.length) });
    assert.equal(body.length, 4097);
    assert.equal((await run(post(body))).status, 400);
  });
  test('endpoint מארח זר - 400 ושום דבר לא נשמר', async () => {
    const sql = fakeSql();
    const res = await run(post({ ...goodBody(), endpoint: 'https://evil.example/x' }), sql);
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('מפתחות חסרים / פגומים - 400', async () => {
    for (const keys of [undefined, null, {}, { p256dh: 'short', auth: AUTH }, { p256dh: P256, auth: 'x' }]) {
      assert.equal((await run(post({ endpoint: EP, keys }))).status, 400);
    }
  });
  test('תשובת 400 לא מחזירה את ה-endpoint או המפתחות', async () => {
    const res = await run(post({ endpoint: 'https://evil.example/SECRETPATH', keys: { p256dh: P256, auth: AUTH } }));
    const text = await res.text();
    assert.ok(!text.includes('SECRETPATH'));
    assert.ok(!text.includes(P256));
  });
  test('גוף בעברית ו-Unicode - לא קורס', async () => {
    const res = await run(post({ endpoint: 'https://web.push.apple.com/א', keys: { p256dh: P256, auth: AUTH }, extra: '🏃\u0000' }));
    assert.ok([200, 400].includes(res.status));
  });
});

describe('push-subscribe: שמירה ואידמפוטנטיות', () => {
  test('מנוי תקין - 200 "נרשם" ו-upsert עם הערכים הנכונים', async () => {
    const sql = fakeSql();
    const res = await run(post(goodBody()), sql);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם');
    assert.match(sql.calls[0].text, /INSERT INTO push_subscriptions/);
    assert.deepEqual(sql.calls[0].values, [EP, P256, AUTH]);
  });
  test('השאילתה היא upsert (ON CONFLICT) שמחזיר מנוי ל-active ומנקה retry_after', async () => {
    const sql = fakeSql();
    await run(post(goodBody()), sql);
    assert.match(sql.calls[0].text, /ON CONFLICT \(endpoint\) DO UPDATE/);
    assert.match(sql.calls[0].text, /status = 'active'/);
    assert.match(sql.calls[0].text, /retry_after = NULL/);
  });
  test('רישום חוזר של אותו מנוי - שתי בקשות זהות, אותה שורה (אין מחיקה)', async () => {
    const sql = fakeSql();
    await run(post(goodBody()), sql);
    await run(post(goodBody()), sql);
    assert.equal(sql.calls.length, 2);
    assert.deepEqual(sql.calls[0].values, sql.calls[1].values);
    assert.ok(sql.calls.every((c) => !/DELETE/i.test(c.text)));
  });
  test('ה-endpoint והמפתחות עוברים כפרמטרים ולא נדבקים לטקסט השאילתה', async () => {
    const sql = fakeSql();
    await run(post({ endpoint: "https://web.push.apple.com/'; DROP TABLE x;--", keys: { p256dh: P256, auth: AUTH } }), sql);
    assert.ok(sql.calls.every((c) => !c.text.includes('DROP')));
  });
});

describe('push-subscribe: כשלים ופרטיות', () => {
  test('כשל במסד - 500, והלוג לא מכיל endpoint, מפתחות או את הודעת השגיאה', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql(() => { throw Object.assign(new Error(`duplicate ${EP} ${P256}`), { name: 'NeonDbError' }); });
    const res = await run(post(goodBody()), sql);
    assert.equal(res.status, 500);
    const out = cap.text() + (await res.text());
    assert.ok(!out.includes('SECRET-ENDPOINT-TOKEN'));
    assert.ok(!out.includes(P256));
    assert.ok(!out.includes(AUTH));
    assert.ok(!out.includes(FAKE_SECRET));
  });
  test('שגיאה שאינה Error לא קורסת', async (t) => {
    captureConsole(t);
    const res = await run(post(goodBody()), fakeSql(() => { throw undefined; }));
    assert.equal(res.status, 500);
  });
  test('תשובת הצלחה לא כוללת את הנתונים', async () => {
    const res = await run(post(goodBody()));
    const text = await res.text();
    assert.ok(!text.includes('apple'));
    assert.ok(!text.includes(AUTH));
  });
});
