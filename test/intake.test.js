// בדיקות ל-api/intake.js: קליטת הודעה מהקיצור.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handle as handleReal } from '../api/intake.js';
// שלב 8.2א-3: ברירת המחדל של handle היא שליחה אמיתית לתור; הבדיקות הישנות לא נוגעות בו, ולכן כאן תור מדומה שאינו עושה כלום.
const handle = (request, deps) => handleReal(request, { sendQueue: async () => {}, ...deps });

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
  // המקור נשמר תמיד, גם כפילות (שתי הכנסות עם hash זהה). זיהוי הכפילות ("כבר קיבלתי") נעשה אחרי השמירה, ב-lib/intake-process.js (test/intake-process.test.js).
  test('אותה הודעה פעמיים - hash זהה, ושתי ההכנסות נשמרות (הכפילות מזוהה בעיבוד ולא בשמירה)', async () => {
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

// ---------------------------------------------------------------------------
// שלב 8.2א-1 (docs/08-chapter8/47, "8.2א-1 נתונים ושרת"): שדה הערוץ. "קריטריון N" = קריטריון הקבלה N בטבלת 8.2א-1 של 47.
// ---------------------------------------------------------------------------
describe('intake: שדה הערוץ (שלב 8.2א-1)', () => {
  const SRC_ID = '11111111-1111-4111-8111-111111111111';
  const SATURDAY = new Date('2026-10-10T08:00:00Z'); // מחר = ראשון 11.10.2026
  // פקודת השמירה של הקיצור, תו בתו כפי שהייתה לפני השלב (אחרי כיווץ רווחים של fakeSql).
  const SHORTCUT_INSERT = "INSERT INTO sources (channel, sender, raw_content, content_hash, received_at) VALUES ('shortcut', ?, ?, ?, now()) RETURNING id, received_at";
  const APP_INSERT = "INSERT INTO sources (channel, sender, raw_content, content_hash, received_at) VALUES ('app', ?, ?, ?, now()) RETURNING id, received_at";
  // מסד מדומה: השמירה מחזירה שורה, מערכת השעות ריקה, ואפשר לסמן כפילות.
  const db = ({ duplicate = false } = {}) => fakeSql((text) => {
    if (text.includes('INTO sources')) return [{ id: SRC_ID, received_at: SATURDAY }];
    if (text.includes('FROM sources s JOIN sources p')) return duplicate ? [{ found: 1 }] : [];
    return [];
  });
  const send = (fields, sql, extra = {}) => handle(formRequest(fields, { headers: H }), { sql, secret: FAKE_SECRET, ...extra });

  test('קריטריון 7: בלי שדה ערוץ: פקודת השמירה, הפרמטרים, הסטטוס, הכותרת והתשובה זהים לקיצור של לפני השלב', async (t) => {
    captureConsole(t); // מערכת שעות ריקה במסד המדומה: loadTimetable כותב הודעה קבועה
    const expected = [
      ['מחר יש מבחן במתמטיקה', {}, 'נרשם · מבחן · מתמטיקה · ראשון 11.10'],
      ['שלום מה נשמע', {}, 'התקבל'],
      ['יש מבחן', {}, 'התקבל'],
      ['מחר יש מבחן במתמטיקה', { duplicate: true }, 'כבר קיבלתי'],
    ];
    for (const [text, options, body] of expected) {
      const sql = db(options);
      const res = await send({ text, sender: 'כותב' }, sql);
      assert.equal(res.status, 200, text);
      assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
      assert.equal(await res.text(), body, text);
      assert.equal(sql.calls[0].text, SHORTCUT_INSERT);
      assert.deepEqual(sql.calls[0].values, ['כותב', text, sha(text)]);
    }
  });

  test('קריטריון 7: ערוץ ריק או shortcut במפורש = בדיוק כמו בלי שדה (אותה פקודה, אותה תשובה, אותו רישום מדידה)', async (t) => {
    captureConsole(t);
    const run = async (fields) => {
      const sql = db();
      const res = await send({ text: 'מחר יש מבחן במתמטיקה', ...fields }, sql);
      return { status: res.status, body: await res.text(), calls: sql.calls.map((c) => [c.text, c.values]) };
    };
    const base = await run({});
    assert.deepEqual(await run({ channel: '' }), base);
    assert.deepEqual(await run({ channel: 'shortcut' }), base);
    assert.ok(base.calls.some(([text]) => text.includes('INTO intake_outcomes')), 'הקיצור נרשם במדידה');
  });

  test('קריטריון 7: ערוץ app נשמר כ-app ומועבר לצינור כ-app', async () => {
    let seen;
    const sql = db();
    const res = await send({ text: 'שלום', channel: 'app' }, sql, { processor: async ({ source }) => { seen = source; return { status: 'unclassified', reply: 'התקבל' }; } });
    assert.equal(res.status, 200);
    assert.equal(sql.calls[0].text, APP_INSERT);
    assert.deepEqual(sql.calls[0].values, [null, 'שלום', sha('שלום')]);
    assert.equal(seen.channel, 'app');
  });

  test('קריטריון 7: ערוץ app דרך הצינור האמיתי: מטופל כמוקלד (שאלת "מה זה?" נכתבת)', async (t) => {
    captureConsole(t);
    const sql = db();
    const res = await send({ text: 'מחר אין שיעור אנגלית', channel: 'app' }, sql);
    assert.equal(await res.text(), 'התקבל');
    const question = sql.calls.find((c) => c.text.startsWith('WITH q AS'));
    assert.ok(question, 'נכתבה שאלת "מה זה?"');
    assert.deepEqual(question.values, ['מה זה?', SRC_ID]);
  });

  test('קריטריון 7: כל ערך אחר בשדה הערוץ: 400 "לא נשלח, נסה שוב." ושום דבר לא נשמר', async () => {
    for (const channel of ['App', 'APP', 'Shortcut', 'telegram', 'calendar', 'system', ' app', 'app ', 'null']) {
      const sql = db();
      const res = await send({ text: 'שלום', channel }, sql);
      assert.equal(res.status, 400, channel);
      assert.equal(await res.text(), 'לא נשלח, נסה שוב.');
      assert.equal(sql.calls.length, 0, channel);
    }
    const form = new FormData();
    form.append('text', 'שלום');
    form.append('channel', new Blob(['app'], { type: 'text/plain' }), 'c.txt');
    const sql = db();
    const res = await handle(new Request('https://x.test/', { method: 'POST', headers: H, body: form }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 400, 'קובץ במקום טקסט');
    assert.equal(sql.calls.length, 0);
  });

  test('intake_outcomes (46, D17): הודעת app לא יוצרת שורה, בכל סטטוס ובכל כשל', async (t) => {
    captureConsole(t);
    const processors = [
      async () => ({ status: 'recorded', reply: 'נרשם · בדיקה' }),
      async () => ({ status: 'unclassified', reply: 'התקבל' }),
      async () => ({ status: 'duplicate', reply: 'כבר קיבלתי' }),
      async () => ({ status: 'skipped', reply: 'התקבל' }),
      async () => undefined,
      async () => { throw new Error('x'); },
      async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); },
    ];
    for (const processor of processors) {
      const sql = db();
      const res = await send({ text: 'שלום', channel: 'app' }, sql, { processor });
      assert.equal(res.status, 200);
      assert.equal(sql.find('INTO intake_outcomes').length, 0);
    }
    // ובצינור האמיתי, גם כשהודעה מוקלדת נרשמה
    const sql = db();
    await send({ text: 'מחר יש מבחן במתמטיקה', channel: 'app' }, sql);
    assert.equal(sql.find('INTO facts').length, 1);
    assert.equal(sql.find('INTO intake_outcomes').length, 0);
  });
});

// ---------------------------------------------------------------------------
// שלב 8.2א-3 (docs/08-chapter8/47, "8.2א-3"): התראה מאוגדת. שליחה לתור אחרי העיבוד, רק להודעה שהועברה שנרשמה. "קריטריון N" = קריטריון הקבלה N בטבלת 8.2א-3.
// ---------------------------------------------------------------------------
describe('intake: התראה מאוגדת לתור (שלב 8.2א-3)', () => {
  const SRC_ID = '22222222-2222-4222-8222-222222222222';
  const SATURDAY = new Date('2026-10-10T08:00:00Z');
  const db = () => fakeSql((text) => (text.includes('INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY }] : []));
  const recorded = async () => ({ status: 'recorded', reply: 'נרשם · בדיקה' });
  // תור מדומה: רושם כל שליחה.
  const fakeQueue = (behavior) => {
    const sendQueue = async (...args) => { sendQueue.calls.push(args); if (behavior) return behavior(); };
    sendQueue.calls = [];
    return sendQueue;
  };
  const NOW = new Date(1792000090 * 1000); // בתוך החלון שמתחיל ב-1792000080
  const send = (fields, extra = {}) => handle(formRequest(fields, { headers: H }), { sql: db(), secret: FAKE_SECRET, now: () => NOW, ...extra });

  test('קריטריון 3: הודעה שהועברה שנכתבה לה בועת "נרשם": נשלחת הודעת notify אחת לנושא daily-slots, עם מפתח אידמפוטנטיות לפי החלון', async () => {
    const sendQueue = fakeQueue();
    const res = await send({ text: 'הודעה מומצאת' }, { processor: recorded, sendQueue });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם · בדיקה');
    assert.equal(sendQueue.calls.length, 1);
    const [topic, message, options] = sendQueue.calls[0];
    assert.equal(topic, 'daily-slots');
    assert.deepEqual(message, { kind: 'notify', slotKey: 'notify-1792000080', targetAt: new Date(1792000205 * 1000).toISOString() });
    assert.deepEqual(options, { delaySeconds: 115, retentionSeconds: 115 + 86400, idempotencyKey: 'notify-1792000080' });
  });
  test('קריטריון 1: שלוש הודעות באותו חלון: אותו slotKey ואותו מפתח אידמפוטנטיות; הודעה בחלון הבא: מפתח חדש', async () => {
    const sendQueue = fakeQueue();
    for (const sec of [1792000081, 1792000100, 1792000199]) await send({ text: 'א' }, { processor: recorded, sendQueue, now: () => new Date(sec * 1000) });
    assert.equal(sendQueue.calls.length, 3);
    assert.deepEqual([...new Set(sendQueue.calls.map(([, m]) => m.slotKey))], ['notify-1792000080']);
    assert.deepEqual([...new Set(sendQueue.calls.map(([, , o]) => o.idempotencyKey))], ['notify-1792000080']);
    await send({ text: 'ב' }, { processor: recorded, sendQueue, now: () => new Date(1792000200 * 1000) });
    assert.equal(sendQueue.calls[3][1].slotKey, 'notify-1792000200');
  });
  test('קריטריון 3: הודעה מוקלדת (app) לעולם לא נשלחת לתור, גם כשנרשמה', async () => {
    const sendQueue = fakeQueue();
    const res = await send({ text: 'הודעה מומצאת', channel: 'app' }, { processor: recorded, sendQueue });
    assert.equal(res.status, 200);
    assert.equal(sendQueue.calls.length, 0);
  });
  test('סטטוסים אחרים של הקיצור לא נשלחים לתור: unclassified, duplicate, skipped, כשל, תקיעה, בלי תוצאה', async (t) => {
    captureConsole(t);
    const processors = [
      async () => ({ status: 'unclassified', reply: 'התקבל' }),
      async () => ({ status: 'duplicate', reply: 'כבר קיבלתי' }),
      async () => ({ status: 'skipped', reply: 'התקבל' }),
      async () => undefined,
      async () => { throw new Error('x'); },
      async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); },
    ];
    for (const processor of processors) {
      const sendQueue = fakeQueue();
      const res = await send({ text: 'הודעה מומצאת' }, { processor, sendQueue });
      assert.equal(res.status, 200);
      assert.equal(sendQueue.calls.length, 0);
    }
  });
  test('דרך הצינור האמיתי: הודעה שהועברה ונרשמה נשלחת לתור; מוקלדת שנרשמה לא', async (t) => {
    captureConsole(t);
    const forwarded = fakeQueue();
    const resA = await send({ text: 'מחר יש מבחן במתמטיקה' }, { sendQueue: forwarded });
    assert.equal(await resA.text(), 'נרשם · מבחן · מתמטיקה · ראשון 11.10');
    assert.equal(forwarded.calls.length, 1);
    const typed = fakeQueue();
    const resB = await send({ text: 'מחר יש מבחן במתמטיקה', channel: 'app' }, { sendQueue: typed });
    assert.equal(await resB.text(), 'נרשם · מבחן · מתמטיקה · ראשון 11.10');
    assert.equal(typed.calls.length, 0);
  });
  test('קריטריון 4: כשל בשליחה לתור (זריקה, דחייה או זריקה סינכרונית) לא משנה את התשובה לקיצור תו בתו, והשגיאה נרשמת בשמה בלבד', async (t) => {
    const logged = captureConsole(t);
    const ok = await send({ text: 'הודעה מומצאת' }, { processor: recorded, sendQueue: fakeQueue() });
    const okBody = await ok.text();
    const failures = [
      () => { throw Object.assign(new Error('סוד-בהודעת-שגיאה'), { name: 'QueueDownError' }); },
      () => Promise.reject(Object.assign(new Error('סוד-בהודעת-שגיאה'), { name: 'QueueDownError' })),
    ];
    for (const failure of failures) {
      const res = await send({ text: 'הודעה מומצאת' }, { processor: recorded, sendQueue: fakeQueue(failure) });
      assert.equal(res.status, ok.status);
      assert.equal(res.headers.get('content-type'), ok.headers.get('content-type'));
      assert.equal(await res.text(), okBody);
    }
    const syncThrow = await send({ text: 'הודעה מומצאת' }, { processor: recorded, sendQueue: () => { throw new Error('sync'); } });
    assert.equal(await syncThrow.text(), okBody);
    assert.match(logged.text(), /QueueDownError/);
    assert.doesNotMatch(logged.text(), /סוד-בהודעת-שגיאה|הודעה מומצאת/);
  });
  test('כשל בתור לא מפריע לרישום תוצאת העיבוד (intake_outcomes נכתב לפני השליחה)', async (t) => {
    captureConsole(t);
    const order = [];
    const tracking = fakeSql((text) => {
      if (text.includes('INTO intake_outcomes')) order.push('outcome');
      return text.includes('INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY }] : [];
    });
    await handle(formRequest({ text: 'הודעה מומצאת' }, { headers: H }), {
      sql: tracking, secret: FAKE_SECRET, now: () => NOW, processor: recorded,
      sendQueue: async () => { order.push('queue'); throw new Error('x'); },
    });
    assert.deepEqual(order, ['outcome', 'queue']);
  });
});
