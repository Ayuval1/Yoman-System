// בדיקות לשלב M.1 של docs/09-security/46-prd-code-only-measurement.md: רישום תוצאת העיבוד ב-intake_outcomes (api/intake.js).
// שורת intake-daily של אותו שלב נבדקת ב-daily-check.test.js. בלי רשת ובלי מסד אמיתי: sql מזויף מ-helpers.js. כל הטקסטים מומצאים, בלי שמות אנשים.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן). הבדיקות מוודאות את טקסט הפקודה ואת הפרמטרים שלה;
// האילוץ UNIQUE וה-ON CONFLICT עצמם נשארים לאימות ב-Neon (ההוכחה החיה של M.1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { handle as handleReal, outcomeFor } from '../api/intake.js';
// שלב 8.2א-3: ברירת המחדל של handle היא שליחה אמיתית לתור; הבדיקות הישנות לא נוגעות בו, ולכן כאן תור מדומה שאינו עושה כלום.
const handle = (request, deps) => handleReal(request, { sendQueue: async () => {}, ...deps });

import { RECEIVED_REPLY, DUPLICATE_REPLY } from '../lib/intake-questions.js';
import { fakeSql, captureConsole, formRequest, timeoutError, FAKE_SECRET } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const TEXT = 'טקסט-פרטי-מומצא-לבדיקה';
const SENDER = 'שולח-מומצא-לבדיקה';
const HASH = createHash('sha256').update(TEXT, 'utf8').digest('hex');
const RECEIVED = new Date('2026-10-10T08:00:00Z'); // שבת; "מחר" = ראשון 11.10.2026
const OUTCOME_INSERT = 'INSERT INTO intake_outcomes (source_id, status, reason) VALUES (?::uuid, ?, ?) ON CONFLICT (source_id) DO NOTHING';

// sql מזויף: ה-INSERT ל-sources מחזיר שורה עם מזהה. onOutcome רץ בכתיבה ל-intake_outcomes (יכול לזרוק); extra עונה לשאר השאילתות.
function intakeSql({ id = SRC_ID, onOutcome = () => [], extra = () => undefined } = {}) {
  return fakeSql((text, values) => {
    if (text.includes('INTO sources')) return [{ id, received_at: RECEIVED }];
    if (text.includes('INTO intake_outcomes')) return onOutcome(text, values);
    return extra(text, values) ?? [];
  });
}
const outcomesOf = (sql) => sql.find('INTO intake_outcomes');
const send = (deps, fields = { text: TEXT, sender: SENDER }) => handle(formRequest(fields, { headers: H }), { secret: FAKE_SECRET, ...deps });
const returns = (value) => async () => value;
const throws = (thrown) => async () => { throw thrown; };
// שגיאת מסד מומצאת: ה-message מכיל בכוונה טקסט, שולח וסוד, כדי לוודא שרק ה-name נרשם.
const dbError = () => Object.assign(new Error(`insert failed ${TEXT} ${SENDER} ${FAKE_SECRET}`), { name: 'NeonDbError' });

describe('intake_outcomes: כל סטטוס של הצינור נרשם בשורה אחת', () => {
  for (const status of ['recorded', 'unclassified', 'duplicate']) {
    test(`${status}: שורה אחת עם הסטטוס, reason ריק (NULL)`, async () => {
      const sql = intakeSql();
      const res = await send({ sql, processor: returns({ status, reply: 'נרשם · בדיקה' }) });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'נרשם · בדיקה');
      assert.equal(outcomesOf(sql).length, 1);
      assert.equal(outcomesOf(sql)[0].text, OUTCOME_INSERT);
      assert.deepEqual(outcomesOf(sql)[0].values, [SRC_ID, status, null]);
    });
  }

  test('הרישום נעשה אחרי העיבוד, והוא הקריאה האחרונה למסד לפני התשובה', async () => {
    const order = [];
    const sql = intakeSql({ onOutcome: () => { order.push('outcome'); return []; } });
    await send({ sql, processor: async () => { order.push('processor'); return { status: 'recorded', reply: 'נרשם · בדיקה' }; } });
    assert.deepEqual(order, ['processor', 'outcome']);
    assert.match(sql.calls[0].text, /INSERT INTO sources/);
    assert.equal(sql.calls.at(-1).text, OUTCOME_INSERT);
    assert.equal(sql.calls.length, 2);
  });

  test('המזהה שנרשם הוא מזהה השורה שנשמרה ב-sources', async () => {
    const sql = intakeSql({ id: OTHER_ID });
    await send({ sql, processor: returns({ status: 'recorded', reply: 'נרשם · בדיקה' }) });
    assert.deepEqual(outcomesOf(sql)[0].values, [OTHER_ID, 'recorded', null]);
  });
});

describe('intake_outcomes: failed', () => {
  test('הצינור זורק (שגיאה מכל סוג, כולל זריקה סינכרונית): failed עם reason = error', async (t) => {
    captureConsole(t);
    for (const thrown of [new Error('x'), new TypeError('y'), 'מחרוזת', undefined, null, 7]) {
      const sql = intakeSql();
      const res = await send({ sql, processor: throws(thrown) });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), RECEIVED_REPLY);
      assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'error']]);
    }
    const sql = intakeSql();
    await send({ sql, processor: () => { throw new Error('sync'); } });
    assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'error']]);
  });

  test('הצינור זורק שגיאה בשם TimeoutError: failed עם reason = timeout', async (t) => {
    captureConsole(t);
    const sql = intakeSql();
    await send({ sql, processor: throws(timeoutError()) });
    assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'timeout']]);
  });

  test('H4: צינור שלא מסתיים, עם processTimeoutMs קצר - failed עם timeout, והתשובה "התקבל" ו-200', async (t) => {
    const cap = captureConsole(t);
    const sql = intakeSql();
    const startedAt = Date.now();
    const res = await send({ sql, processor: () => new Promise(() => {}), processTimeoutMs: 20 });
    assert.ok(Date.now() - startedAt < 2000, 'לא חיכינו לברירת המחדל של 5 שניות');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'timeout']]);
    assert.deepEqual(cap.lines, ['intake: עיבוד נכשל: TimeoutError']);
  });

  test('ברירת המחדל נשארת 5 שניות: ב-4,999 אין תשובה, ב-5,000 יש, והתוצאה timeout', async (t) => {
    captureConsole(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
    const sql = intakeSql();
    let res;
    send({ sql, processor: () => new Promise(() => {}) }).then((value) => { res = value; });
    await flush();
    t.mock.timers.tick(4999);
    await flush();
    assert.equal(res, undefined, 'עדיין ממתינים לעיבוד');
    assert.equal(outcomesOf(sql).length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.ok(res, 'התשובה חזרה אחרי 5 שניות');
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'timeout']]);
  });

  test('הצינור מחזיר ערך בלי status, או עם status לא מוכר: failed עם reason = error', async () => {
    for (const result of [undefined, null, {}, { reply: 'נרשם · בדיקה' }, { status: '' }, { status: 'something_else' }, { status: 5 }, { status: null }, 'recorded', ['recorded']]) {
      const sql = intakeSql();
      const res = await send({ sql, processor: returns(result) });
      assert.equal(res.status, 200);
      assert.deepEqual(outcomesOf(sql).map((call) => call.values), [[SRC_ID, 'failed', 'error']], JSON.stringify(result));
    }
  });
});

describe('intake_outcomes: מתי לא נרשמת שורה', () => {
  test('skipped: אין שורה, והתשובה כרגיל', async () => {
    const sql = intakeSql();
    const res = await send({ sql, processor: returns({ status: 'skipped', reply: RECEIVED_REPLY }) });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.equal(outcomesOf(sql).length, 0);
    assert.equal(sql.calls.length, 1); // רק ה-INSERT ל-sources
  });

  test('ערוץ שאינו הקיצור: אין שורה, בכל תוצאה ובכל כשל (הסינון לפי הערוץ ולא לפי skipped)', () => {
    for (const channel of ['app', 'calendar', 'system', 'file', '', undefined, null, 'SHORTCUT']) {
      for (const result of [{ status: 'recorded' }, { status: 'unclassified' }, { status: 'duplicate' }, { status: 'skipped' }, undefined, {}]) {
        assert.equal(outcomeFor({ channel, result }), null, `${channel} ${JSON.stringify(result)}`);
      }
      assert.equal(outcomeFor({ channel, result: null, failure: 'error' }), null);
      assert.equal(outcomeFor({ channel, result: null, failure: 'timeout' }), null);
    }
  });

  test('outcomeFor בערוץ הקיצור: טבלת המיפוי המלאה', () => {
    const shortcut = (result, failure) => outcomeFor({ channel: 'shortcut', result, failure });
    assert.deepEqual(shortcut({ status: 'recorded', reply: 'x' }), { status: 'recorded', reason: null });
    assert.deepEqual(shortcut({ status: 'unclassified' }), { status: 'unclassified', reason: null });
    assert.deepEqual(shortcut({ status: 'duplicate' }), { status: 'duplicate', reason: null });
    assert.equal(shortcut({ status: 'skipped' }), null);
    assert.deepEqual(shortcut(undefined), { status: 'failed', reason: 'error' });
    assert.deepEqual(shortcut({ status: 'failed' }), { status: 'failed', reason: 'error' }); // הצינור לא מחזיר failed; ערך לא מוכר
    assert.deepEqual(shortcut(null, 'error'), { status: 'failed', reason: 'error' });
    assert.deepEqual(shortcut(null, 'timeout'), { status: 'failed', reason: 'timeout' });
    // כשל גובר על תוצאה (לא אמור לקרות יחד, אבל לא נרשם recorded על עיבוד שזרק)
    assert.deepEqual(shortcut({ status: 'recorded' }, 'timeout'), { status: 'failed', reason: 'timeout' });
  });

  test('אין מזהה שורה אחרי השמירה: בלי עיבוד ובלי רישום (המקרה נספר ב-no_outcome)', async () => {
    for (const saved of [[], [{}], [{ id: null }], [{ id: '' }], undefined, null]) {
      let called = false;
      const sql = fakeSql((text) => (text.includes('INTO sources') ? saved : []));
      const res = await send({ sql, processor: async () => { called = true; return { status: 'recorded' }; } });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), RECEIVED_REPLY);
      assert.equal(called, false);
      assert.equal(sql.calls.length, 1);
    }
  });

  test('בקשה שנדחתה או שלא נשמרה (401, 400, 413, 500): אין רישום', async (t) => {
    captureConsole(t);
    const rejected = [
      [401, (sql) => handle(formRequest({ text: TEXT }, { headers: { 'x-intake-secret': 'wrong' } }), { sql, secret: FAKE_SECRET })],
      [400, (sql) => send({ sql }, { sender: SENDER })],
      [413, (sql) => send({ sql }, { text: 'א'.repeat(100_001) })],
    ];
    for (const [status, run] of rejected) {
      const sql = intakeSql();
      const res = await run(sql);
      assert.equal(res.status, status);
      assert.equal(sql.calls.length, 0, String(status));
    }
    const failing = fakeSql((text) => { if (text.includes('INTO sources')) throw new Error('down'); return []; });
    const res = await send({ sql: failing });
    assert.equal(res.status, 500);
    assert.equal(outcomesOf(failing).length, 0);
  });
});

describe('intake_outcomes: כתיבה אחת, ושורה אחת לכל מקור', () => {
  test('הפקודה היא INSERT אחד עם ON CONFLICT (source_id) DO NOTHING, בכל סוגי התוצאה', async (t) => {
    captureConsole(t);
    for (const processor of [returns({ status: 'recorded' }), returns({ status: 'duplicate' }), returns(undefined), throws(new Error('x'))]) {
      const sql = intakeSql();
      await send({ sql, processor });
      assert.equal(outcomesOf(sql).length, 1);
      assert.equal(outcomesOf(sql)[0].text, OUTCOME_INSERT);
      assert.match(outcomesOf(sql)[0].text, /ON CONFLICT \(source_id\) DO NOTHING$/);
    }
  });

  test('כתיבה כפולה לאותו מקור לא יוצרת שורה שנייה (מסד מדומה שאוכף ייחודיות על source_id)', async () => {
    // הדמיה: טבלה בזיכרון עם אילוץ ייחודיות. בלי ON CONFLICT ... DO NOTHING בפקודה, הכתיבה השנייה זורקת (כמו Postgres).
    const table = new Map();
    const onOutcome = (text, [sourceId, status, reason]) => {
      const tolerant = /ON CONFLICT \(source_id\) DO NOTHING/.test(text);
      if (table.has(sourceId)) {
        if (!tolerant) throw Object.assign(new Error('duplicate key value violates unique constraint'), { name: 'NeonDbError' });
        return [];
      }
      table.set(sourceId, { status, reason });
      return [];
    };
    const first = intakeSql({ onOutcome });
    const second = intakeSql({ onOutcome });
    const a = await send({ sql: first, processor: returns({ status: 'recorded', reply: 'נרשם · בדיקה' }) });
    const b = await send({ sql: second, processor: returns({ status: 'duplicate', reply: DUPLICATE_REPLY }) });
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(await b.text(), DUPLICATE_REPLY);
    assert.equal(table.size, 1);
    assert.deepEqual(table.get(SRC_ID), { status: 'recorded', reason: null }, 'השורה הראשונה נשארת, בלי עדכון');
  });

  test('העמודות שנכתבות קיימות ב-db/schema.sql, ו-source_id שם ייחודי (בלי זה ON CONFLICT לא עובד)', () => {
    const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
    const body = /CREATE TABLE IF NOT EXISTS intake_outcomes\s*\(([\s\S]*?)\n\);/.exec(schema)?.[1];
    assert.ok(body, 'הטבלה קיימת בסכמה');
    const columns = body.split('\n').map((line) => /^\s*(\w+)\s+\w+/.exec(line)?.[1]).filter(Boolean);
    for (const column of /\(([^)]*)\)/.exec(OUTCOME_INSERT)[1].split(',').map((c) => c.trim())) {
      assert.ok(columns.includes(column), column);
    }
    assert.match(body, /^\s*source_id\s+uuid\s+NOT NULL UNIQUE/m);
  });

  test('append-only (D5): בקוד אין UPDATE, DELETE, TRUNCATE או DROP על intake_outcomes', () => {
    const root = new URL('../', import.meta.url);
    const files = ['api', 'lib', 'lib/ops'].flatMap((dir) => readdirSync(new URL(`${dir}/`, root)).filter((name) => name.endsWith('.js')).map((name) => `${dir}/${name}`));
    assert.ok(files.includes('api/intake.js') && files.includes('lib/ops/daily-check.js'));
    const touching = [];
    for (const file of files) {
      const code = readFileSync(new URL(file, root), 'utf8').split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
      if (code.includes('intake_outcomes')) touching.push(file);
      assert.doesNotMatch(code, /\b(UPDATE|DELETE\s+FROM|TRUNCATE(\s+TABLE)?|DROP\s+TABLE)\s+(ONLY\s+)?intake_outcomes\b/i, file);
    }
    // M.2 (57): lib/review-view.js קורא את intake_outcomes לסיכום היום (קריאה בלבד: אין UPDATE ו-DELETE, נבדק למעלה); intake_checks הוא מה שנכתב שם.
    // C-1 (docs/08-chapter8/90): lib/closing-view.js קורא את intake_outcomes רק כדי לזהות כפילות ("לא הובנו" לא סופר אותה). קריאה בלבד.
    assert.deepEqual(touching.sort(), ['api/intake.js', 'lib/closing-view.js', 'lib/ops/daily-check.js', 'lib/review-view.js'], 'רק הקליטה כותבת; הספירה היומית, סיכום היום והסגירה קוראים');
  });
});

describe('intake_outcomes: כשל בכתיבת התוצאה לא משנה את תשובת הקיצור', () => {
  const scenarios = [
    ['recorded', returns({ status: 'recorded', reply: 'נרשם · מבחן · בדיקה' }), 'נרשם · מבחן · בדיקה'],
    ['duplicate', returns({ status: 'duplicate', reply: DUPLICATE_REPLY }), DUPLICATE_REPLY],
    ['unclassified', returns({ status: 'unclassified', reply: RECEIVED_REPLY }), RECEIVED_REPLY],
    ['הצינור זורק', throws(new Error('x')), RECEIVED_REPLY],
    ['הצינור מחזיר undefined (בלי status)', returns(undefined), RECEIVED_REPLY],
    ['הצינור מחזיר תשובה בלי status', returns({ reply: 'נרשם · בלי סטטוס' }), 'נרשם · בלי סטטוס'],
    ['הצינור מחזיר אובייקט ריק (בלי status)', returns({}), RECEIVED_REPLY],
  ];
  for (const [name, processor, expected] of scenarios) {
    test(`${name}: אותו סטטוס, אותו טקסט ואותה כותרת, עם כשל ובלי כשל`, async (t) => {
      captureConsole(t);
      const ok = await send({ sql: intakeSql(), processor });
      const failingSql = intakeSql({ onOutcome: () => { throw dbError(); } });
      const failed = await send({ sql: failingSql, processor });
      assert.equal(outcomesOf(failingSql).length, 1, 'הכתיבה נוסתה פעם אחת, בלי ניסיון חוזר');
      for (const res of [ok, failed]) {
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
      }
      assert.equal(await ok.text(), expected);
      assert.equal(await failed.text(), expected);
    });
  }

  test('לקונסול נכנס רק שם השגיאה: לא message, לא טקסט, לא שולח ולא סוד', async (t) => {
    const cap = captureConsole(t);
    await send({ sql: intakeSql({ onOutcome: () => { throw dbError(); } }), processor: returns({ status: 'recorded', reply: 'נרשם · בדיקה' }) });
    assert.deepEqual(cap.lines, ['intake: רישום התוצאה נכשל: NeonDbError']);
  });

  test('גם העיבוד וגם הרישום נכשלים: שתי שורות בקונסול, כל אחת עם שם שגיאה בלבד', async (t) => {
    const cap = captureConsole(t);
    const res = await send({
      sql: intakeSql({ onOutcome: () => { throw dbError(); } }),
      processor: throws(Object.assign(new Error(`pipeline ${TEXT}`), { name: 'PipelineError' })),
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(cap.lines, ['intake: עיבוד נכשל: PipelineError', 'intake: רישום התוצאה נכשל: NeonDbError']);
  });

  test('שגיאה שאינה Error בכתיבת התוצאה (מחרוזת / undefined / null / מספר) לא קורסת ולא נכנסת לקונסול', async (t) => {
    const cap = captureConsole(t);
    for (const thrown of [`boom ${TEXT}`, undefined, null, 42]) {
      const res = await send({ sql: intakeSql({ onOutcome: () => { throw thrown; } }), processor: returns({ status: 'recorded', reply: 'נרשם · בדיקה' }) });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'נרשם · בדיקה');
    }
    assert.equal(cap.lines.length, 4);
    assert.ok(!cap.text().includes(TEXT) && !cap.text().includes('boom'));
  });
});

describe('intake_outcomes: פרטיות (D7)', () => {
  test('הפרמטרים של הכתיבה הם מזהה המקור, סטטוס ו-reason בלבד: בלי טקסט ההודעה, בלי השולח ובלי ה-hash', async (t) => {
    const cap = captureConsole(t);
    const processors = [
      returns({ status: 'recorded', reply: `נרשם · ${TEXT}` }), // גם תשובה שמכילה טקסט לא מגיעה לטבלה
      returns({ status: 'unclassified', reply: RECEIVED_REPLY }),
      returns({ status: 'duplicate', reply: DUPLICATE_REPLY }),
      returns({ status: TEXT }), // status שאינו מוכר לא נכתב כמות שהוא
      returns(undefined),
      throws(new Error(`${TEXT} ${SENDER}`)),
      throws(Object.assign(new Error(TEXT), { name: 'TimeoutError' })),
    ];
    const allowed = new Set([SRC_ID, 'recorded', 'unclassified', 'duplicate', 'failed', 'error', 'timeout', null]);
    for (const processor of processors) {
      const sql = intakeSql();
      await send({ sql, processor });
      const [call] = outcomesOf(sql);
      assert.equal(call.values.length, 3);
      assert.equal(call.values[0], SRC_ID);
      for (const value of call.values) assert.ok(allowed.has(value), String(value));
      const written = JSON.stringify(call);
      for (const secret of [TEXT, SENDER, HASH, FAKE_SECRET]) assert.ok(!written.includes(secret));
    }
    for (const secret of [TEXT, SENDER, HASH, FAKE_SECRET]) assert.ok(!cap.text().includes(secret), 'גם בקונסול אין טקסט, שולח, hash או סוד');
  });

  test('הטקסט והשולח נשלחים למסד רק ב-INSERT ל-sources', async () => {
    const sql = intakeSql();
    await send({ sql, processor: returns({ status: 'recorded', reply: 'נרשם · בדיקה' }) });
    const carrying = sql.calls.filter((call) => call.values.includes(TEXT) || call.values.includes(SENDER));
    assert.equal(carrying.length, 1);
    assert.match(carrying[0].text, /INSERT INTO sources/);
  });
});

describe('intake_outcomes: מחובר לצינור האמיתי (processSource, בלי processor מוזרק)', () => {
  const lastOutcome = (sql) => outcomesOf(sql).map((call) => call.values);

  test('הודעה שהקוד מבין: recorded', async () => {
    const sql = intakeSql();
    const res = await send({ sql }, { text: 'מחר יש מבחן במתמטיקה' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /^נרשם · מבחן · מתמטיקה/);
    assert.deepEqual(lastOutcome(sql), [[SRC_ID, 'recorded', null]]);
  });

  test('הודעה שהקוד לא מבין: unclassified', async () => {
    const sql = intakeSql();
    const res = await send({ sql }, { text: 'שלום מה נשמע' });
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(lastOutcome(sql), [[SRC_ID, 'unclassified', null]]);
  });

  test('אותה הודעה שוב באותו יום: duplicate', async () => {
    const sql = intakeSql({ extra: (text) => (text.includes('FROM sources s JOIN sources p') ? [{ found: 1 }] : undefined) });
    const res = await send({ sql }, { text: 'מחר יש מבחן במתמטיקה' });
    assert.equal(await res.text(), DUPLICATE_REPLY);
    assert.deepEqual(lastOutcome(sql), [[SRC_ID, 'duplicate', null]]);
  });

  test('המקור כבר נתפס על ידי ריצה אחרת (claimed = 0, skipped): אין שורה', async () => {
    const sql = intakeSql({ extra: (text) => (text.includes('INTO facts') ? [{ claimed: 0, facts_written: 0, questions_written: 0 }] : undefined) });
    const res = await send({ sql }, { text: 'מחר יש מבחן במתמטיקה' });
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(lastOutcome(sql), []);
  });

  test('הפקודה האטומית של הצינור זורקת: failed עם error', async (t) => {
    captureConsole(t);
    const sql = intakeSql({ extra: (text) => { if (text.includes('INTO facts')) throw new Error('connection reset'); return undefined; } });
    const res = await send({ sql }, { text: 'מחר יש מבחן במתמטיקה' });
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.deepEqual(lastOutcome(sql), [[SRC_ID, 'failed', 'error']]);
  });
});
