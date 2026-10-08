// בדיקות ל-api/intake.js: קליטת הודעה מהקיצור.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handle } from '../api/intake.js';
import { fakeSql, captureConsole, formRequest, req, FAKE_SECRET } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('intake: שיטות HTTP', () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    test(`${method} נדחה ב-405 ושום דבר לא נשמר`, async () => {
      const sql = fakeSql();
      const res = await handle(req('https://x.test/api/intake', { method, headers: H }), { sql, secret: FAKE_SECRET });
      assert.equal(res.status, 405);
      assert.equal(sql.calls.length, 0);
    });
  }
  test('405 נבדק לפני הסוד (גם בלי סוד בכלל)', async () => {
    const res = await handle(req('https://x.test/', { method: 'GET' }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.status, 405);
  });
});

describe('intake: אימות סוד', () => {
  test('בלי כותרת סוד - 401 ושום דבר לא נשמר', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'שלום' }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 401);
    assert.equal(await res.text(), 'Unauthorized');
    assert.equal(sql.calls.length, 0);
  });
  test('סוד שגוי - 401', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'שלום' }, { headers: { 'x-intake-secret': 'wrong' } }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 401);
    assert.equal(sql.calls.length, 0);
  });
  test('סוד שגוי באורך שונה / ארוך מאוד / ריק - 401 בלי קריסה (מסלול timing-safe)', async () => {
    for (const bad of ['', 'a', FAKE_SECRET + 'x', FAKE_SECRET.slice(0, -1), 'x'.repeat(10000)]) {
      const res = await handle(formRequest({ text: 'שלום' }, { headers: { 'x-intake-secret': bad } }), { sql: fakeSql(), secret: FAKE_SECRET });
      assert.equal(res.status, 401, `סוד באורך ${bad.length}`);
    }
  });
  test('סוד שמשתנה רק באות אחת - 401', async () => {
    const almost = FAKE_SECRET.slice(0, -1) + 'X';
    const res = await handle(formRequest({ text: 'שלום' }, { headers: { 'x-intake-secret': almost } }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.status, 401);
  });
  test('אותיות גדולות/קטנות בסוד חשובות', async () => {
    const res = await handle(formRequest({ text: 'שלום' }, { headers: { 'x-intake-secret': FAKE_SECRET.toUpperCase() } }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.status, 401);
  });
  test('סוד לא מוגדר בשרת - נכשל סגור (401) גם כשהכותרת ריקה', async (t) => {
    const cap = captureConsole(t);
    for (const secret of [undefined, '', null]) {
      const sql = fakeSql();
      const res = await handle(formRequest({ text: 'שלום' }, { headers: { 'x-intake-secret': '' } }), { sql, secret });
      assert.equal(res.status, 401);
      assert.equal(sql.calls.length, 0);
    }
    assert.match(cap.text(), /INTAKE_SECRET/);
  });
  test('הסוד לא נחשף בתשובת דחייה', async () => {
    const res = await handle(formRequest({ text: 'x' }, { headers: { 'x-intake-secret': 'bad' } }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.ok(!(await res.text()).includes(FAKE_SECRET));
  });
  test('סוד נכון עובר', async () => {
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'התקבל');
  });
});

describe('intake: קלט ותקינות', () => {
  test('הודעה תקינה נשמרת עם sender, hash ו-channel=shortcut', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'לקנות חלב', sender: 'יובל' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /INSERT INTO sources/);
    assert.match(sql.calls[0].text, /'shortcut'/);
    assert.deepEqual(sql.calls[0].values, ['יובל', 'לקנות חלב', sha('לקנות חלב')]);
  });
  test('בלי sender - נשמר NULL', async () => {
    const sql = fakeSql();
    await handle(formRequest({ text: 'היי' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(sql.calls[0].values[0], null);
  });
  test('sender ריק - נשמר NULL', async () => {
    const sql = fakeSql();
    await handle(formRequest({ text: 'היי', sender: '' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(sql.calls[0].values[0], null);
  });
  test('בלי שדה text - 400 ושום דבר לא נשמר', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ sender: 'x' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('text ריק - 400', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: '' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('text כקובץ (לא מחרוזת) - 400', async () => {
    const form = new FormData();
    form.append('text', new Blob(['תוכן'], { type: 'text/plain' }), 'a.txt');
    const sql = fakeSql();
    const res = await handle(new Request('https://x.test/', { method: 'POST', headers: H, body: form }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('גוף ריק לגמרי - 400', async () => {
    const sql = fakeSql();
    const res = await handle(new Request('https://x.test/', { method: 'POST', headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('JSON במקום Form - 400', async () => {
    const sql = fakeSql();
    const r = new Request('https://x.test/', { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: '{"text":"hi"}' });
    const res = await handle(r, { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400);
    assert.equal(sql.calls.length, 0);
  });
  test('Form פגום (multipart בלי מבנה אמיתי) - 400 בלי קריסה', async () => {
    const r = new Request('https://x.test/', { method: 'POST', headers: { ...H, 'content-type': 'multipart/form-data; boundary=zzz' }, body: 'not a real multipart body' });
    const res = await handle(r, { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.status, 400);
  });
  test('urlencoded רגיל מתקבל', async () => {
    const sql = fakeSql();
    const r = new Request('https://x.test/', {
      method: 'POST',
      headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ text: 'שלום עולם' }).toString(),
    });
    const res = await handle(r, { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(sql.calls[0].values[1], 'שלום עולם');
  });
  test('עברית, אימוג׳י ותווים מורכבים נשמרים בדיוק כפי שהם', async () => {
    const text = 'אימון ריצה 🏃‍♂️ 5K — מחר ב־16:00 «ציטוט» ñ 日本語';
    const sql = fakeSql();
    await handle(formRequest({ text }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(sql.calls[0].values[1], text);
    assert.equal(sql.calls[0].values[2], sha(text));
  });
  test('רווחים בלבד נשמרים כמות שהם (אין trim) - התנהגות מתועדת', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: '   ' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(sql.calls[0].values[1], '   ');
  });
  test('טקסט עם בייט NULL לא קורס ונשמר כפי שהוא', async () => {
    const text = 'a\u0000b';
    const sql = fakeSql();
    const res = await handle(formRequest({ text }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(sql.calls[0].values[1], text);
  });
  test('ניסיון SQL injection נשמר כערך (פרמטר), לא משנה את תבנית השאילתה', async () => {
    const evil = "'); DROP TABLE sources; --";
    const sql = fakeSql();
    await handle(formRequest({ text: evil, sender: evil }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.ok(!sql.calls[0].text.includes('DROP'));
    assert.equal(sql.calls[0].values[1], evil);
  });
  test('הודעה בגודל התקרה בדיוק (100,000 תווים) נשמרת במלואה', async () => {
    const text = 'א'.repeat(100_000);
    const sql = fakeSql();
    const res = await handle(formRequest({ text }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(sql.calls[0].values[1].length, 100_000);
  });
  test('הודעה מעל התקרה (100,001 תווים) נדחית ב-413 ושום דבר לא נשמר', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'א'.repeat(100_001) }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 413);
    assert.equal(sql.calls.length, 0);
  });
  test('הודעה ענקית (1M תווים) נדחית ב-413 בלי לקרוס', async () => {
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'א'.repeat(1_000_000) }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 413);
    assert.equal(sql.calls.length, 0);
  });
  test('שדות text כפולים - נלקח הראשון', async () => {
    const form = new FormData();
    form.append('text', 'ראשון');
    form.append('text', 'שני');
    const sql = fakeSql();
    await handle(new Request('https://x.test/', { method: 'POST', headers: H, body: form }), { sql, secret: FAKE_SECRET });
    assert.equal(sql.calls[0].values[1], 'ראשון');
  });
});

describe('intake: כפילויות', () => {
  test('אותה הודעה פעמיים - hash זהה (אין dedupe בשלב 1, תיעוד: שתי הכנסות)', async () => {
    const sql = fakeSql();
    await handle(formRequest({ text: 'זהה' }, { headers: H }), { sql, secret: FAKE_SECRET });
    await handle(formRequest({ text: 'זהה' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(sql.calls.length, 2);
    assert.equal(sql.calls[0].values[2], sql.calls[1].values[2]);
  });
  test('הודעות שונות - hash שונה', async () => {
    const sql = fakeSql();
    await handle(formRequest({ text: 'א' }, { headers: H }), { sql, secret: FAKE_SECRET });
    await handle(formRequest({ text: 'ב' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.notEqual(sql.calls[0].values[2], sql.calls[1].values[2]);
  });
});

describe('intake: כשלים ופרטיות', () => {
  test('כשל במסד - 500, רישום ב-call_log, והתוכן לא בלוג וגם לא בתשובה', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes('INTO sources')) throw new Error('connection refused');
      return [];
    });
    const res = await handle(formRequest({ text: 'תוכן-פרטי-מאוד' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 500);
    const body = await res.text();
    assert.ok(!body.includes('תוכן-פרטי-מאוד'));
    assert.equal(sql.find('INTO call_log').length, 1);
    assert.ok(sql.find('INTO call_log')[0].values.includes('connection refused'));
    assert.ok(!cap.text().includes('תוכן-פרטי-מאוד'));
    assert.ok(!cap.text().includes(FAKE_SECRET));
  });
  test('גם call_log נכשל - עדיין 500 נקי, בלי קריסה', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql(() => { throw new Error('db down'); });
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 500);
    assert.equal(cap.lines.length, 2);
  });
  test('שגיאה שאינה Error (מחרוזת / undefined / null / מספר) לא קורסת', async () => {
    for (const thrown of ['boom', undefined, null, 42]) {
      const sql = fakeSql(() => { throw thrown; });
      const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql, secret: FAKE_SECRET });
      assert.equal(res.status, 500);
    }
  });
  test('כל התשובות הן text/plain עם charset utf-8', async () => {
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: fakeSql(), secret: FAKE_SECRET });
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  });
});
