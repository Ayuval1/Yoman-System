// בדיקות ל-lib/intake-process.js ולחיבורו ל-api/intake.js (שלב 8.2: צינור הקליטה, קוד בלבד).
// בלי רשת ובלי מסד אמיתי: sql מזויף מ-helpers.js. כל המשפטים מומצאים, בלי שמות אנשים וטלפונים.
// חשוב: ה-SQL עצמו לא הורץ מול Postgres אמיתי (אין מסד בסשן). הבדיקות מוודאות את מבנה הפקודות (פקודה אחת אטומית, עמודות קיימות בסכמה)
// ואת הזרימה סביבן; התנהגות ה-WITH/RETURNING והשוואת היום בשעון ישראל נשארות לאימות ב-Neon (ראה הדוח).
// 10.10.2026 הוא שבת, 11.10 ראשון, 12.10 שני, 13.10 שלישי. שעון ישראל בתאריכים האלה הוא UTC+3 (מעבר לשעון חורף ב-25.10.2026).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { processSource, pendingQuestion, answerQuestion, TYPE_FIELD, RECORD_CANDIDATE_RULES, MAX_PROCESSABLE_LENGTH } from '../lib/intake-process.js';
import { RECEIVED_REPLY, DUPLICATE_REPLY, UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { UNKNOWN_VALUE } from '../lib/intake-facts.js';
import { handle as handleReal } from '../api/intake.js';
// שלב 8.2א-3: ברירת המחדל של handle היא שליחה אמיתית לתור; הבדיקות הישנות לא נוגעות בו, ולכן כאן תור מדומה שאינו עושה כלום.
const handle = (request, deps) => handleReal(request, { sendQueue: async () => {}, ...deps });

import { fakeSql, captureConsole, formRequest, FAKE_SECRET } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const SRC_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const SATURDAY = new Date('2026-10-10T08:00:00Z'); // מחר = ראשון 11.10.2026
const THURSDAY = new Date('2026-10-08T08:00:00Z');
const SUNDAY_EVENING = new Date('2026-10-11T15:00:00Z'); // ראשון 11.10.2026 18:00 בישראל: "מחר" = שני 12.10

const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = {
  slots: [
    slot(1, 1, 'שיח אישי'), slot(1, 2, 'היסטוריה'), slot(1, 3, 'עברית'), slot(1, 4, 'תנ"ך'), slot(1, 5, 'אנגלית'), slot(1, 6, 'אנגלית'), slot(1, 7, 'מתמטיקה'),
    slot(2, 3, 'מתמטיקה'), slot(2, 4, 'מתמטיקה'), slot(2, 7, 'פיזיקה'), slot(2, 8, 'פיזיקה'), slot(2, 9, 'פיזיקה'),
  ],
};
// שורות מסד כפי שהדרייבר מחזיר (snake_case, time כ-HH:MM:SS), עבור loadTimetable
const DB_TIMETABLE_ROWS = TIMETABLE.slots.map((s) => ({
  weekday: s.weekday, period: s.period, starts_at: `${s.startsAt}:00`, ends_at: `${s.endsAt}:00`, subject: s.subject, teacher: s.teacher, room: s.room,
}));

const source = (text, over = {}) => ({ id: SRC_ID, channel: 'shortcut', raw_content: text, content_hash: typeof text === 'string' ? sha(text) : null, received_at: SATURDAY, ...over });
const fact = (field, value, origin = 'read') => ({ field, value, origin });

// sql מזויף שמדמה את המסד בקריאות של הצינור. extra(text, values) יכול לענות במקומו (undefined = ברירת המחדל).
function dbSql({ timetable = 'ok', duplicate = false, extra = () => undefined } = {}) {
  return fakeSql((text, values) => {
    const custom = extra(text, values);
    if (custom !== undefined) return custom;
    if (text.includes('FROM timetable_slots')) {
      if (timetable === 'fail') throw new Error('timetable connection reset');
      return timetable === 'empty' ? [] : DB_TIMETABLE_ROWS;
    }
    if (text.includes('FROM sources s JOIN sources p')) return duplicate ? [{ found: 1 }] : [];
    return [];
  });
}
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));
const atomicOf = (sql) => {
  const calls = sql.find('INTO facts');
  assert.equal(calls.length, 1, 'בדיוק פקודת כתיבה אחת של עובדות');
  return calls[0];
};
const jsonRowsOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && /^\[.*\]$/s.test(value)));
// סדר הפרמטרים בפקודת התשובה של answerQuestion (מאז שלב 8.2א-1: שורת תשובה, סימון מקור ובועה):
// [messageId, answerText, sourceId, certainty, rowsJson, sourceId, markProcessed, nextText, sourceId, attempt, nextText, bubble, sourceId, bubble, sourceId,
//  messageId, pattern, pattern, messageId, pattern]
const answerParams = (call) => {
  assert.equal(call.values.length, 20, 'מספר הפרמטרים בפקודת התשובה');
  return {
    messageId: call.values[0],
    answerText: call.values[1],
    sourceId: call.values[2],
    certainty: call.values[3],
    markProcessed: call.values[6],
    nextText: call.values[7],
    attempt: call.values[9],
    bubble: [call.values[11], call.values[13]],
    evidenceIds: [call.values[15], call.values[18]],
    pattern: [call.values[16], call.values[17], call.values[19]],
  };
};
const NONE_CREATED = { answerSourceId: null, bubbleId: null, questionId: null };

describe('processSource: מסלול מלא', () => {
  test('הודעה מובנת: פקודה אחת אטומית עם עובדות, שאלה ו-processed_at, והתשובה "נרשם · ..."', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('מחר יש מבחן במתמטיקה') });
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · מבחן · מתמטיקה · ראשון 11.10' });

    const call = atomicOf(sql);
    assert.ok(call.text.includes('INTO messages'));
    assert.ok(call.text.includes('processed_at'));
    assert.equal(writesOf(sql).length, 1, 'כל הכתיבות בפקודה אחת בלבד');
    assert.ok(!sql.calls.some((c) => /\bDELETE\b/i.test(c.text)), 'אין DELETE');

    assert.deepEqual(jsonRowsOf(call), [
      { field: TYPE_FIELD, value: 'exam', origin: 'read' },
      { field: 'subject', value: 'מתמטיקה', origin: 'read' },
      { field: 'date', value: '2026-10-11', origin: 'inferred' },
      { field: 'lesson', value: '7', origin: 'inferred' },
    ]);
    assert.ok(call.values.includes('probable'), 'confidence = הוודאות של ההודעה (התאריך הוסק מ"מחר")');
    assert.ok(call.values.includes(SRC_ID));
    assert.ok(call.values.includes('על איזה נושא?'), 'השאלה הראשונה בלבד: נושא');
    assert.ok(call.text.includes("'script'"), 'extracted_by = script');
    assert.ok(call.text.includes('NULL::text, NULL::uuid'), 'entity_type, entity_id ו-haiku_confidence נשארים NULL');
  });

  test('הודעה שלמה: certain, אין שאלה, ו"נרשם" עם תאריך מלא ויום', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('מבחן במתמטיקה ב-12.10 על שברים בשיעור 3') });
    assert.equal(result.reply, 'נרשם · מבחן · מתמטיקה · שני 12.10');
    const call = atomicOf(sql);
    assert.ok(call.values.includes('certain'));
    assert.ok(!call.values.some((v) => typeof v === 'string' && v.endsWith('?')), 'אין שאלה כשהכול נקרא');
    assert.equal(call.values.filter((v) => v === null).length, 2, 'טקסט השאלה (פעמיים בפקודה) הוא NULL');
  });

  test('"מידע קודם": סימן שאלה בהודעה מהקיצור לא מונע רישום כשנמצא סוג (03-intake-rules.md:157-174)', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('האם יש מבחן במתמטיקה מחר?') });
    assert.equal(result.status, 'recorded');
    assert.equal(result.reply, 'נרשם · מבחן · מתמטיקה · ראשון 11.10');
  });

  test('יום מקוצר: בלי מקצוע, בלי שאלה', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('מחר יום מקוצר') });
    assert.equal(result.reply, 'נרשם · יום מקוצר · ראשון 11.10');
    assert.deepEqual(jsonRowsOf(atomicOf(sql)).map((row) => row.field), [TYPE_FIELD, 'date']);
  });

  test('סוג נמצא אבל לא מובן (בלי תאריך ומקצוע): "התקבל", נרשם עם שאלה על תאריך', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('יש מבחן') });
    assert.deepEqual(result, { status: 'recorded', reply: RECEIVED_REPLY });
    const call = atomicOf(sql);
    assert.deepEqual(jsonRowsOf(call), [{ field: TYPE_FIELD, value: 'exam', origin: 'read' }]);
    assert.ok(call.values.includes('לאיזה תאריך?'), 'תאריך קודם: ממנו נגזרים כפתורי המקצוע');
  });

  test('השאלה הראשונה בלבד נכתבת, עם attempt=1, awaiting_reply, entity_type=source ובלי expires_at', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר מבחן') });
    const call = atomicOf(sql);
    assert.equal(call.values.filter((v) => v === 'איזה מקצוע?').length, 2, 'שאלה אחת (טקסט פעמיים בפקודה)');
    assert.match(call.text, /SELECT 'out', \?::text, 'question', now\(\), true, NULL::uuid, NULL::timestamptz, 'source', claim\.id, 1 FROM claim/);
  });
});

describe('processSource: לא מובן, ערוץ אחר וקלט פגום', () => {
  test('הודעה לא מובנת: "התקבל", בלי כתיבת עובדות ובלי processed_at', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('שלום מה נשמע') });
    assert.deepEqual(result, { status: 'unclassified', reply: RECEIVED_REPLY });
    assert.equal(writesOf(sql).length, 0);
    assert.ok(!writesOf(sql).some((c) => c.text.includes('processed_at')), 'processed_at נשאר NULL: אין כתיבה שמסמנת');
  });

  // מאז שלב 8.2א-1 ערוץ app מעובד (ה-describe "8.2א-1: ערוץ app" בסוף הקובץ), ולכן הוא יצא מהרשימה.
  test('ערוץ שאינו הקיצור ואינו app: skipped, בלי אף קריאה למסד', async () => {
    for (const channel of ['calendar', 'system', 'file', undefined, 'APP']) {
      const sql = dbSql();
      const result = await processSource({ sql, source: source('מחר יש מבחן במתמטיקה', { channel }) });
      assert.deepEqual(result, { status: 'skipped', reply: RECEIVED_REPLY }, channel);
      assert.equal(sql.calls.length, 0, channel);
    }
  });

  test('חותמת קליטה לא תקינה: unclassified בלי כתיבה (RangeError נתפס)', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('מחר יש מבחן במתמטיקה', { received_at: 'לא תאריך' }) });
    assert.equal(result.status, 'unclassified');
    assert.equal(writesOf(sql).length, 0);
  });

  test('קלט שגוי של המתכנת: חסר sql או source.id זורק TypeError', async () => {
    await assert.rejects(() => processSource({ source: source('x') }), TypeError);
    await assert.rejects(() => processSource({ sql: dbSql(), source: { channel: 'shortcut' } }), TypeError);
    await assert.rejects(() => processSource({ sql: dbSql() }), TypeError);
  });

  test('טקסט שאינו מחרוזת (NULL) נשמר כמקור ולא מסווג', async () => {
    const result = await processSource({ sql: dbSql(), source: source(null) });
    assert.equal(result.status, 'unclassified');
  });
});

// מודל קטן של היום הקלנדרי: מדמה את תנאי הכפילות של ה-SQL (אותו hash, אותו יום בשעון ישראל, קודמת לפי received_at ואז id) כדי לבדוק את הזרימה סביבו.
// "טופלה" (שלב 8.2א-1): processed_at מלא (processed שאינו false), או שיש לקודמת שורה ב-messages (messages: true).
const israelDay = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(date);
function sourcesModel(rows) {
  return (text, values) => {
    if (!text.includes('FROM sources s JOIN sources p')) return undefined;
    const me = rows.find((row) => row.id === values[0]);
    const earlier = rows.some((p) => p.id !== me.id && p.hash === me.hash && (p.processed !== false || p.messages === true) && israelDay(p.at) === israelDay(me.at)
      && (p.at < me.at || (p.at.getTime() === me.at.getTime() && p.id < me.id)));
    return earlier ? [{ found: 1 }] : [];
  };
}

describe('processSource: כפילות (I-21)', () => {
  const TEXT = 'מחר יש מבחן במתמטיקה';
  const at = (iso) => new Date(iso);

  test('אותו hash באותו יום: "כבר קיבלתי", בלי עובדות, והשורה מסומנת כמטופלת', async () => {
    const sql = dbSql({ duplicate: true });
    const result = await processSource({ sql, source: source(TEXT, { id: OTHER_ID }) });
    assert.deepEqual(result, { status: 'duplicate', reply: DUPLICATE_REPLY });
    assert.equal(sql.find('INTO facts').length, 0);
    assert.equal(sql.find('INTO messages').length, 0);
    const marks = writesOf(sql);
    assert.equal(marks.length, 1);
    assert.match(marks[0].text, /^UPDATE sources SET processed_at = now\(\) WHERE id = \?::uuid AND processed_at IS NULL$/);
  });

  test('השאילתה: אותו content_hash, אותו יום ב-Asia/Jerusalem, קודמת בלבד ולא השורה עצמה', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source(TEXT) });
    const query = sql.find('FROM sources s JOIN sources p')[0];
    assert.equal(sql.find('FROM sources s JOIN sources p').length, 1);
    for (const part of ['p.content_hash = s.content_hash', "AT TIME ZONE 'Asia/Jerusalem'", 'p.id <> s.id', "(p.processed_at IS NOT NULL OR EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = 'source' AND x.entity_id = p.id))", 'p.received_at < s.received_at', 'p.received_at = s.received_at AND p.id < s.id']) {
      assert.ok(query.text.includes(part), part);
    }
    assert.deepEqual(query.values, [SRC_ID]);
  });

  test('הראשונה מעובדת וההעתק באותו יום הוא הכפילות; ביום אחר מעובד', async () => {
    const rows = [
      { id: SRC_ID, hash: sha(TEXT), at: at('2026-10-10T08:00:00Z') },
      { id: OTHER_ID, hash: sha(TEXT), at: at('2026-10-10T12:00:00Z') },
      { id: MSG_ID, hash: sha(TEXT), at: at('2026-10-11T08:00:00Z') },
    ];
    const run = async (id) => processSource({ sql: dbSql({ extra: sourcesModel(rows) }), source: source(TEXT, { id }) });
    assert.equal((await run(SRC_ID)).status, 'recorded');
    assert.equal((await run(OTHER_ID)).status, 'duplicate');
    assert.equal((await run(MSG_ID)).status, 'recorded', 'יום אחר בלוח ישראל: לא כפילות');
  });

  test('יום אחר בלוח ישראל: אותו hash בלילה שלפני מחזור יום אינו כפילות', async () => {
    // 20:30Z = 23:30 בישראל ב-10.10; 21:30Z = 00:30 ב-11.10: אותו יום UTC, ימים שונים בישראל
    const rows = [
      { id: SRC_ID, hash: sha(TEXT), at: at('2026-10-10T20:30:00Z') },
      { id: OTHER_ID, hash: sha(TEXT), at: at('2026-10-10T21:30:00Z') },
    ];
    const second = await processSource({ sql: dbSql({ extra: sourcesModel(rows) }), source: source(TEXT, { id: OTHER_ID }) });
    assert.equal(second.status, 'recorded');
    // 21:30Z ב-9.10 = 00:30 ב-10.10; 20:30Z ב-10.10 = 23:30 ב-10.10: ימי UTC שונים, אותו יום בישראל
    const rows2 = [
      { id: SRC_ID, hash: sha(TEXT), at: at('2026-10-09T21:30:00Z') },
      { id: OTHER_ID, hash: sha(TEXT), at: at('2026-10-10T20:30:00Z') },
    ];
    const dup = await processSource({ sql: dbSql({ extra: sourcesModel(rows2) }), source: source(TEXT, { id: OTHER_ID }) });
    assert.equal(dup.status, 'duplicate');
  });

  test('hash שונה (טקסט שונה) באותו יום אינו כפילות', async () => {
    const rows = [
      { id: SRC_ID, hash: sha('טקסט אחר'), at: at('2026-10-10T08:00:00Z') },
      { id: OTHER_ID, hash: sha(TEXT), at: at('2026-10-10T09:00:00Z') },
    ];
    const result = await processSource({ sql: dbSql({ extra: sourcesModel(rows) }), source: source(TEXT, { id: OTHER_ID }) });
    assert.equal(result.status, 'recorded');
  });

  test('שוויון בחותמת הזמן: ה-id הקטן קודם (בדיוק אחת משתיים נחשבת כפילות)', async () => {
    const same = at('2026-10-10T08:00:00Z');
    const rows = [{ id: SRC_ID, hash: sha(TEXT), at: same }, { id: OTHER_ID, hash: sha(TEXT), at: same }];
    const run = (id) => processSource({ sql: dbSql({ extra: sourcesModel(rows) }), source: source(TEXT, { id }) });
    assert.equal((await run(SRC_ID)).status, 'recorded');
    assert.equal((await run(OTHER_ID)).status, 'duplicate');
  });

  test('כשל בסימון כפילות לא משנה את התשובה ולא זורק; הלוג בלי תוכן', async (t) => {
    const cap = captureConsole(t);
    const sql = dbSql({ duplicate: true, extra: (text) => { if (text.startsWith('UPDATE sources')) throw new Error('db down תוכן-פרטי'); return undefined; } });
    const result = await processSource({ sql, source: source(TEXT, { id: OTHER_ID }) });
    assert.equal(result.reply, DUPLICATE_REPLY);
    assert.ok(!cap.text().includes('תוכן-פרטי'));
  });

  test('כשל בבדיקת הכפילות עצמה: זורק (api/intake.js תופס), ובלי כתיבה', async () => {
    const sql = dbSql({ extra: (text) => { if (text.includes('FROM sources s JOIN sources p')) throw new Error('boom'); return undefined; } });
    await assert.rejects(() => processSource({ sql, source: source(TEXT) }), /boom/);
    assert.equal(writesOf(sql).length, 0);
  });
});

describe('processSource: מערכת השעות', () => {
  test('כשל בטעינה (המסד זורק): מעבדים בלי מערכת שעות, בלי קריסה, והלוג בלי תוכן', async (t) => {
    const cap = captureConsole(t);
    const sql = dbSql({ timetable: 'fail' });
    const result = await processSource({ sql, source: source('מחר יש מבחן במתמטיקה') });
    assert.equal(result.status, 'recorded');
    assert.equal(result.reply, 'נרשם · מבחן · מתמטיקה · ראשון 11.10');
    const call = atomicOf(sql);
    assert.deepEqual(jsonRowsOf(call).map((row) => row.field), [TYPE_FIELD, 'subject', 'date'], 'אין השלמת שיעור בלי מערכת שעות');
    assert.ok(call.values.includes('על איזה נושא?'));
    assert.ok(!cap.text().includes('connection reset') && !cap.text().includes('מבחן'));
  });

  test('אין טעינה במסד (טבלה ריקה): אותו דבר, ולא קורס', async (t) => {
    captureConsole(t);
    const result = await processSource({ sql: dbSql({ timetable: 'empty' }), source: source('מחר יש מבחן במתמטיקה') });
    assert.equal(result.status, 'recorded');
  });

  test('timetable שהועבר מבחוץ לא נטען מהמסד (גם null)', async () => {
    for (const timetable of [TIMETABLE, null]) {
      const sql = dbSql();
      await processSource({ sql, source: source('מחר יש מבחן במתמטיקה'), timetable });
      assert.equal(sql.find('FROM timetable_slots').length, 0);
    }
  });

  test('ללא timetable: נטען מהמסד פעם אחת, והשיעור מושלם', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר יש מבחן במתמטיקה') });
    assert.equal(sql.find('FROM timetable_slots').length, 1);
    assert.ok(jsonRowsOf(atomicOf(sql)).some((row) => row.field === 'lesson' && row.value === '7'));
  });
});

describe('pendingQuestion', () => {
  test('מקצוע חסר: שאלה עם כפתורי אותו יום ו"לא יודע", בלי כתיבה', () => {
    const question = pendingQuestion({ source: source('מחר מבחן'), facts: [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-11', 'inferred')], timetable: TIMETABLE });
    assert.deepEqual(question, {
      field: 'subject',
      text: 'איזה מקצוע?',
      buttons: ['שיח אישי', 'היסטוריה', 'עברית', 'תנ"ך', 'אנגלית', 'מתמטיקה', UNKNOWN_BUTTON],
      allowFreeText: true,
    });
  });

  test('שדות שכבר נשמרו יורדים: אחרי המקצוע נשאלים על הנושא (והשיעור מושלם)', () => {
    const facts = [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-11', 'inferred'), fact('subject', 'מתמטיקה')];
    const question = pendingQuestion({ source: source('מחר מבחן'), facts, timetable: TIMETABLE });
    assert.deepEqual(question, { field: 'topic', text: 'על איזה נושא?', buttons: [UNKNOWN_BUTTON], allowFreeText: true });
  });

  test('אין שאלה כשהכול נשמר (גם "לא יודע" נחשב ערך)', () => {
    const facts = [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-11', 'inferred'), fact('subject', 'מתמטיקה'), fact('topic', UNKNOWN_VALUE), fact('lesson', '7', 'inferred')];
    assert.equal(pendingQuestion({ source: source('מחר מבחן'), facts, timetable: TIMETABLE }), null);
  });

  test('שיעור דו-משמעי: כפתורי המועמדים עם שם המקצוע', () => {
    const text = 'מבחן באנגלית ביום ראשון על קריאה';
    const facts = [fact(TYPE_FIELD, 'exam'), fact('subject', 'אנגלית'), fact('date', '2026-10-11', 'inferred'), fact('topic', 'קריאה')];
    const question = pendingQuestion({ source: source(text, { received_at: THURSDAY }), facts, timetable: TIMETABLE });
    assert.deepEqual(question.buttons, ['שיעור 5 · אנגלית', 'שיעור 6 · אנגלית', UNKNOWN_BUTTON]);
    assert.equal(question.field, 'lesson');
  });

  test('שורת ה-type קובעת את הסוג גם כשהמילון כבר לא מזהה אותו (שחזור מה שזוהה)', () => {
    const question = pendingQuestion({ source: source('שלום מה נשמע'), facts: [fact(TYPE_FIELD, 'cancel')], timetable: TIMETABLE });
    assert.equal(question.field, 'date');
  });

  test('שאלת תאריך: כפתורי "היום" ו"מחר" לפי יום ההודעה בישראל (לא לפי UTC), ו"לא יודע" אחרון', () => {
    // 21:30 UTC ב-10.10.2026 = 00:30 ב-11.10.2026 בישראל (UTC+3): היום = ראשון 11.10
    const late = pendingQuestion({ source: source('מחר מבחן', { received_at: new Date('2026-10-10T21:30:00Z') }), facts: [fact(TYPE_FIELD, 'exam')], timetable: TIMETABLE });
    assert.equal(late.field, 'date');
    assert.deepEqual(late.buttons.slice(0, 2), ['היום · ראשון 11.10.2026', 'מחר · שני 12.10.2026']);
    assert.equal(late.buttons.at(-1), 'לא יודע');
  });

  test('שאלת תאריך עם received_at ריק או לא תקין: "לא יודע" בלבד, כמו קודם', () => {
    for (const received_at of [null, 'לא תאריך']) {
      const question = pendingQuestion({ source: source('מחר מבחן', { received_at }), facts: [fact(TYPE_FIELD, 'exam')], timetable: TIMETABLE });
      assert.deepEqual(question.buttons, ['לא יודע']);
    }
  });

  test('חותמת קליטה לא תקינה במקור: עדיין שואלים על מה שחסר (בלי מועמדים מהחילוץ)', () => {
    const question = pendingQuestion({ source: source('מחר מבחן', { received_at: 'לא תאריך' }), facts: [fact(TYPE_FIELD, 'exam')], timetable: TIMETABLE });
    assert.equal(question.field, 'date');
  });

  test('אין סוג שמור ואין סוג מחושב: null', () => {
    assert.equal(pendingQuestion({ source: source('שלום מה נשמע'), facts: [], timetable: TIMETABLE }), null);
    assert.equal(pendingQuestion({ source: source('שלום מה נשמע'), timetable: TIMETABLE }), null);
  });

  test('ערך לא תקין בשורת type: מתעלמים ממנו וחוזרים לסוג שחושב מהטקסט', () => {
    const question = pendingQuestion({ source: source('מחר מבחן'), facts: [fact(TYPE_FIELD, 'לא-סוג')], timetable: TIMETABLE });
    assert.equal(question.field, 'date', 'הסוג exam מהטקסט, ושום שדה לא נשמר: תאריך קודם');
  });
});

// מסד מדומה ל-answerQuestion: ההודעה, המקור, העובדות הקיימות, ותשובת הפקודה האטומית.
function answerDb({ message = {}, src = source('מחר יש מבחן במתמטיקה'), facts = [], written = [{ closed: 1 }], timetable = 'ok' } = {}) {
  const messageRow = message === null ? undefined : { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1, ...message };
  return dbSql({
    timetable,
    extra: (text) => {
      if (text.includes('FROM messages WHERE id')) return messageRow ? [messageRow] : [];
      if (text.includes('FROM sources WHERE id')) return src ? [src] : [];
      if (text.includes('FROM facts WHERE source_id')) return facts;
      if (text.includes('INTO facts')) {
        if (written instanceof Error) throw written;
        return written;
      }
      return undefined;
    },
  });
}
const SAVED_MATH = [fact(TYPE_FIELD, 'exam'), fact('subject', 'מתמטיקה'), fact('date', '2026-10-11', 'inferred'), fact('lesson', '7', 'inferred')];
const SAVED_NO_SUBJECT = [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-11', 'inferred')];

describe('answerQuestion', () => {
  test('תשובה אחרונה: העובדה נכנסת עם origin=read, השאלה נסגרת, אין שאלה חדשה, והתשובה "נרשם"', async () => {
    const sql = answerDb({ facts: SAVED_MATH });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY });
    assert.deepEqual(result, { done: true, reply: 'נרשם · מבחן · מתמטיקה · ראשון 11.10', status: 'answered', created: NONE_CREATED });

    const call = atomicOf(sql);
    assert.equal(writesOf(sql).length, 1, 'כל הכתיבות בפקודה אחת');
    assert.ok(call.text.includes('UPDATE messages SET awaiting_reply = false'));
    assert.ok(call.text.includes('awaiting_reply = true'), 'compare-and-set: לחיצה כפולה לא כותבת פעמיים');
    assert.ok(call.text.includes('FROM closed, jsonb_to_recordset'), 'העובדות נכתבות רק על שורת RETURNING של השאלה שנסגרה');
    assert.deepEqual(jsonRowsOf(call), [{ field: 'topic', value: 'אלגברה', origin: 'read' }], 'רק השדה החדש: אין UPDATE על עובדות קיימות');
    const params = answerParams(call);
    assert.equal(params.messageId, MSG_ID);
    assert.equal(params.sourceId, SRC_ID);
    assert.equal(params.certainty, 'probable', 'התאריך והשיעור הוסקו');
    assert.equal(params.nextText, null, 'אין שאלה חדשה');
    assert.deepEqual(params.pattern, [null, null, null], 'אין דפוס (ערוץ הקיצור)');
  });

  test('"לא יודע" נשמר unknown ולא ריק', async () => {
    const sql = answerDb({ facts: SAVED_MATH });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: UNKNOWN_BUTTON, now: SATURDAY });
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), [{ field: 'topic', value: 'unknown', origin: 'read' }]);
    assert.equal(result.done, true);
  });

  test('כשנשארת שאלה: נוצרת הבאה עם attempt+1, והעובדה הקודמת נכתבת (כולל שיעור שהושלם בהסקה)', async () => {
    const sql = answerDb({ src: source('מחר מבחן'), facts: SAVED_NO_SUBJECT, message: { attempt: 1 } });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY });
    assert.deepEqual(result, { done: false, reply: 'על איזה נושא?', status: 'answered', created: NONE_CREATED });
    const call = atomicOf(sql);
    assert.deepEqual(jsonRowsOf(call), [
      { field: 'subject', value: 'מתמטיקה', origin: 'read' },
      { field: 'lesson', value: '7', origin: 'inferred' },
    ]);
    assert.equal(answerParams(call).nextText, 'על איזה נושא?');
    assert.equal(answerParams(call).attempt, 2, 'attempt = ניסיון קודם + 1');
  });

  test('תשובת כפתור של שיעור דו-משמעי נכנסת כמספר השיעור', async () => {
    const text = 'מבחן באנגלית ביום ראשון על קריאה';
    const facts = [fact(TYPE_FIELD, 'exam'), fact('subject', 'אנגלית'), fact('date', '2026-10-11', 'inferred'), fact('topic', 'קריאה')];
    const sql = answerDb({ src: source(text, { received_at: THURSDAY }), facts });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'שיעור 6 · אנגלית', now: THURSDAY });
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), [{ field: 'lesson', value: '6', origin: 'read' }]);
    assert.equal(result.done, true);
  });

  test('תשובה חופשית על תאריך נמדדת מרגע התשובה, ואז השיעור מושלם והשאלה הבאה נשאלת', async () => {
    const sql = answerDb({ src: source('יש מבחן במתמטיקה'), facts: [fact(TYPE_FIELD, 'exam'), fact('subject', 'מתמטיקה')] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'מחר', now: SATURDAY });
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), [
      { field: 'date', value: '2026-10-11', origin: 'read' },
      { field: 'lesson', value: '7', origin: 'inferred' },
    ]);
    assert.equal(result.reply, 'על איזה נושא?');
  });

  test('תשובה שלא ניתן לפענח: לא כותבים כלום והשאלה נשארת פתוחה', async () => {
    const sql = answerDb({ src: source('יש מבחן במתמטיקה'), facts: [fact(TYPE_FIELD, 'exam'), fact('subject', 'מתמטיקה')] });
    for (const answer of ['בלה בלה', '   ', '']) {
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer, now: SATURDAY });
      assert.deepEqual(result, { done: false, reply: 'לאיזה תאריך?', status: 'unclear', created: NONE_CREATED });
    }
    assert.equal(writesOf(sql).length, 0);
  });

  test('שאלה שכבר נסגרה / לא קיימת / לא שאלה / בלי מקור: status closed ובלי כתיבה', async () => {
    const cases = [
      answerDb({ message: { awaiting_reply: false }, facts: SAVED_MATH }),
      answerDb({ message: null, facts: SAVED_MATH }),
      answerDb({ message: { kind: 'update' }, facts: SAVED_MATH }),
      answerDb({ message: { entity_type: 'event' }, facts: SAVED_MATH }),
      answerDb({ src: null, facts: SAVED_MATH }),
    ];
    for (const sql of cases) {
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY });
      assert.deepEqual(result, { done: false, reply: null, status: 'closed', created: NONE_CREATED });
      assert.equal(writesOf(sql).length, 0);
    }
  });

  test('לחיצה כפולה: הפקודה מחזירה closed=0 (מישהו סגר קודם) והתוצאה closed', async () => {
    const sql = answerDb({ facts: SAVED_MATH, written: [{ closed: 0 }] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY });
    assert.equal(result.status, 'closed');
  });

  test('כשל בפקודה האטומית זורק, ונשלחה פקודת כתיבה אחת בלבד (בלי כתיבה חלקית)', async () => {
    const sql = answerDb({ facts: SAVED_MATH, written: new Error('db down') });
    await assert.rejects(() => answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY }), /db down/);
    assert.equal(writesOf(sql).length, 1, 'ניסיון כתיבה אחד, הכול בפקודה אחת');
  });

  // שונה בשלב 8.2א-1: הסטטוס היה 'closed'. עכשיו 'closed' שמור ל"לא נכתב כלום" (47 קריטריון 6), וכאן השאלה נסגרת ושורת התשובה נכתבת.
  test('המצב כבר שלם (אין שדה פתוח): השאלה נסגרת עם התשובה, בלי עובדות חדשות, והסטטוס answered', async () => {
    const facts = [...SAVED_MATH, fact('topic', 'שברים')];
    const sql = answerDb({ facts });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'משהו', now: SATURDAY });
    assert.equal(result.status, 'answered');
    assert.equal(result.done, true);
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), []);
  });

  test('קלט שגוי של המתכנת: חסר sql או messageId זורק', async () => {
    await assert.rejects(() => answerQuestion({ messageId: MSG_ID, answer: 'x' }), TypeError);
    await assert.rejects(() => answerQuestion({ sql: dbSql(), answer: 'x' }), TypeError);
  });
});

describe('answerQuestion: candidate_rules (I-48) רק לערוץ app, וכבוי כברירת מחדל (RECORD_CANDIDATE_RULES)', () => {
  const TYPED = 'מחר מבחן ביצירה'; // "ביצירה" נפלה דרך המילון (שורש "יצירה")

  test('הודעה שיובל הקליד (app): נרשם דפוס מועמד, עם evidence של מזהה ההודעה בלבד, ו-upsert בפקודה אחת', async () => {
    const sql = answerDb({ src: source(TYPED, { channel: 'app' }), facts: SAVED_NO_SUBJECT });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, recordCandidateRules: true });
    const call = atomicOf(sql);
    assert.equal(writesOf(sql).length, 1);
    assert.ok(call.text.includes('INSERT INTO candidate_rules'));
    assert.ok(call.text.includes('UPDATE candidate_rules'));
    assert.ok(call.text.includes('occurrences = coalesce(occurrences, 0) + 1'));
    assert.ok(call.text.includes("'candidate'"));
    assert.ok(call.text.includes('NOT EXISTS (SELECT 1 FROM r_upd)'), 'אין כפילות: אם הדפוס קיים מעדכנים');
    assert.ok(call.values.includes('יצירה'));
    const params = answerParams(call);
    assert.deepEqual(params.pattern, ['יצירה', 'יצירה', 'יצירה']);
    assert.deepEqual(params.evidenceIds, [MSG_ID, MSG_ID], 'evidence = מזהה ההודעה בלבד');
    assert.ok(!call.values.some((v) => typeof v === 'string' && v.includes('מחר מבחן')), 'טקסט ההודעה לא נשמר בדפוס');
  });

  test('הודעה מהקיצור (טקסט של אחרים): לא נרשם כלום ב-candidate_rules, והדפוס לא נשלח למסד בכלל', async () => {
    const sql = answerDb({ src: source(TYPED, { channel: 'shortcut' }), facts: SAVED_NO_SUBJECT });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, recordCandidateRules: true });
    const call = atomicOf(sql);
    assert.ok(!call.values.some((v) => typeof v === 'string' && v.includes('יצירה')));
    // הפקודה קבועה במבנה: ה-CTE קיים אבל כל הפרמטרים של הדפוס הם NULL, כך שהוא לא כותב ולא מעדכן
    assert.deepEqual(answerParams(call).pattern, [null, null, null]);
  });

  test('app בלי שורשים שנפלו: אין דפוס', async () => {
    const sql = answerDb({ src: source('מחר מבחן', { channel: 'app' }), facts: SAVED_NO_SUBJECT });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, recordCandidateRules: true });
    assert.deepEqual(answerParams(atomicOf(sql)).pattern, [null, null, null]);
  });
});

// --- תיקוני ביקורת 12.10.2026 (סעיפים 8, 10, 12-15). חותמת קליטה ראשון 11.10.2026 18:00 בישראל, "מחר" = שני 12.10 ---
describe('processSource: שאלה שהועברה (ביקורת, סעיף 8; 03-intake-rules.md:157-174, צעד 3)', () => {
  test('"מתי המבחן באנגלית?": שאלה בלי תאריך = לא מסווג, בלי כתיבה, processed_at נשאר ריק', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('מתי המבחן באנגלית?', { received_at: SUNDAY_EVENING }) });
    assert.deepEqual(result, { status: 'unclassified', reply: RECEIVED_REPLY });
    assert.equal(writesOf(sql).length, 0);
    assert.equal(sql.find('INTO facts').length, 0);
    assert.equal(sql.find('INTO messages').length, 0);
  });
  test('שאלה שיש בה תאריך (מידע קודם) נרשמת כמו קודם', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source('האם יש מבחן במתמטיקה מחר?', { received_at: SUNDAY_EVENING }) });
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · מבחן · מתמטיקה · שני 12.10' });
    assert.ok(atomicOf(sql).text.includes('processed_at'));
  });
  test('הודעה בלי סימן שאלה ובלי תאריך נרשמת כרגיל (שאלת השלמה), ולא נחסמת', async () => {
    const result = await processSource({ sql: dbSql(), source: source('יש מבחן באנגלית', { received_at: SUNDAY_EVENING }) });
    assert.equal(result.status, 'recorded');
  });
});

describe('processSource: תיקוני ביקורת על ההודעות המומצאות (סעיפים 1-4, 6, 7, 9)', () => {
  const run = async (text) => {
    const sql = dbSql();
    const result = await processSource({ sql, source: source(text, { received_at: SUNDAY_EVENING }) });
    return { sql, result };
  };
  const rowsOfRun = ({ sql }) => jsonRowsOf(atomicOf(sql));
  const typeOfRun = (out) => rowsOfRun(out).find((row) => row.field === TYPE_FIELD).value;

  test('סעיף 1: מבחן בשעה 9:05 ו"בסיום המבחן" נרשם כמבחן ולא כיום מקוצר', async () => {
    const out = await run('מחר מבחן בהיסטוריה בשעה 9:05. בסיום המבחן תוכלו ללכת הביתה');
    assert.equal(out.result.reply, 'נרשם · מבחן · היסטוריה · שני 12.10');
    assert.equal(typeOfRun(out), 'exam');
  });
  test('סעיף 1: "סיום הפרויקט עד יום ראשון ב-23:59" לא נתפס', async () => {
    const out = await run('סיום הפרויקט עד יום ראשון ב-23:59');
    assert.deepEqual(out.result, { status: 'unclassified', reply: RECEIVED_REPLY });
    assert.equal(writesOf(out.sql).length, 0);
  });
  test('סעיף 2: "מחר יהיה מבחן במתמטיקה ולא בוטל" נרשם כמבחן, לא כביטול', async () => {
    const out = await run('מחר יהיה מבחן במתמטיקה ולא בוטל');
    assert.equal(out.result.reply, 'נרשם · מבחן · מתמטיקה · שני 12.10');
    assert.equal(typeOfRun(out), 'exam');
  });
  test('סעיף 2: "השיעור לא בוטל" לא נתפס', async () => {
    const out = await run('השיעור לא בוטל');
    assert.equal(out.result.status, 'unclassified');
    assert.equal(writesOf(out.sql).length, 0);
  });
  test('סעיף 3: הנושא הוא מה שאחרי "על" שאחרי "מבחן", ונשמר כעובדה', async () => {
    const out = await run('על כולם להגיע בזמן. מחר מבחן בהיסטוריה על המהפכה הצרפתית');
    assert.deepEqual(rowsOfRun(out).find((row) => row.field === 'topic'), { field: 'topic', value: 'המהפכה הצרפתית', origin: 'read' });
  });
  test('סעיף 4: "פרק 2.3" אינו תאריך: אין עובדת date, ונשאלת שאלת תאריך', async () => {
    const out = await run('מבחן במתמטיקה על פרק 2.3');
    const rows = rowsOfRun(out);
    assert.equal(rows.some((row) => row.field === 'date'), false);
    assert.deepEqual(rows.find((row) => row.field === 'topic'), { field: 'topic', value: 'פרק 2.3', origin: 'read' });
    assert.ok(atomicOf(out.sql).values.includes('לאיזה תאריך?'));
  });
  test('סעיף 6: "משוחררים אחרי שיעור 6": אין עובדת lesson', async () => {
    const out = await run('מחר משוחררים אחרי שיעור 6');
    assert.equal(rowsOfRun(out).some((row) => row.field === 'lesson'), false);
  });
  test('סעיף 7: "ביום שלישי בעוד שבועיים": התאריך 27.10', async () => {
    const out = await run('מבחן בהיסטוריה ביום שלישי בעוד שבועיים');
    assert.deepEqual(rowsOfRun(out).find((row) => row.field === 'date'), { field: 'date', value: '2026-10-27', origin: 'inferred' });
    assert.equal(out.result.reply, 'נרשם · מבחן · היסטוריה · שלישי 27.10');
  });
  test('סעיף 7: "ביום שלישי שעבר": אין עובדת date, והתשובה "התקבל"', async () => {
    const out = await run('מבחן בהיסטוריה ביום שלישי שעבר');
    assert.equal(rowsOfRun(out).some((row) => row.field === 'date'), false);
    assert.equal(out.result.reply, RECEIVED_REPLY);
  });
  test('סעיף 9: תוצאות וחזרה אינם אירוע, ולא נכתבים', async () => {
    for (const text of ['תוצאות המבחן בהיסטוריה יתפרסמו ביום שלישי', 'מחר חזרה לקראת המבחן במתמטיקה']) {
      const out = await run(text);
      assert.deepEqual(out.result, { status: 'unclassified', reply: RECEIVED_REPLY }, text);
      assert.equal(writesOf(out.sql).length, 0, text);
    }
  });
});

describe('answerQuestion: candidate_rules כבוי עד סינון שמות (ביקורת, סעיף 10)', () => {
  const WITH_NAME = 'מחר מבחן אצל דנה לוי בנושא שברים'; // שם מומצא, רק לבדיקת הפרטיות
  const answerWithName = async (options = {}) => {
    const sql = answerDb({ src: source(WITH_NAME, { channel: 'app' }), facts: SAVED_NO_SUBJECT });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, ...options });
    return { sql, result };
  };

  test('הקבוע כבוי בקוד', () => {
    assert.equal(RECORD_CANDIDATE_RULES, false);
  });
  test('ברירת מחדל: גם הודעת app עם שם לא כותבת דפוס, והשם לא נשלח למסד', async () => {
    const { sql } = await answerWithName();
    const call = atomicOf(sql);
    assert.deepEqual(answerParams(call).pattern, [null, null, null]);
    assert.ok(!call.values.some((value) => typeof value === 'string' && /דנה|לוי|אצל/.test(value)), 'אף שם או שורש מההודעה לא נשלח למסד');
  });
  test('כשהוא כבוי שאר התשובה עובדת: העובדה נשמרת, השאלה נסגרת והבאה נוצרת', async () => {
    const { sql, result } = await answerWithName();
    assert.deepEqual(result, { done: false, reply: 'על איזה נושא?', status: 'answered', created: NONE_CREATED });
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), [
      { field: 'subject', value: 'מתמטיקה', origin: 'read' },
      { field: 'lesson', value: '7', origin: 'inferred' },
    ]);
    assert.equal(answerParams(atomicOf(sql)).nextText, 'על איזה נושא?');
  });
  test('כשהקבוע דלוק (בבדיקה) הנתיב הישן עדיין עובד: דפוס נשלח ל-candidate_rules', async () => {
    const { sql } = await answerWithName({ recordCandidateRules: true });
    const pattern = answerParams(atomicOf(sql)).pattern;
    assert.ok(pattern.every((value) => typeof value === 'string' && value !== ''), 'דפוס נשלח בשלושת המקומות');
    assert.equal(new Set(pattern).size, 1);
  });
  test('recordCandidateRules: false מכבה (זה גם ברירת המחדל של הקבוע)', async () => {
    const { sql } = await answerWithName({ recordCandidateRules: false });
    assert.deepEqual(answerParams(atomicOf(sql)).pattern, [null, null, null]);
  });
});

describe('processSource: מקור שכבר טופל, כפילות מול מקור שלא טופל, והודעה ארוכה (ביקורת, סעיפים 13-15)', () => {
  const TEXT = 'מחר יש מבחן במתמטיקה';
  const at = (iso) => new Date(iso);

  test('סעיף 13: הפקודה האטומית מחזירה claimed=0 (מישהו כבר תפס): skipped ו"התקבל"', async () => {
    const sql = dbSql({ extra: (text) => (text.includes('INTO facts') ? [{ claimed: 0, facts_written: 0, questions_written: 0 }] : undefined) });
    assert.deepEqual(await processSource({ sql, source: source(TEXT) }), { status: 'skipped', reply: RECEIVED_REPLY });
  });
  test('סעיף 13: claimed=1 נרשם; בלי שורות בתוצאה (fakeSql רגיל) נרשם כמו קודם; "0" כטקסט הוא 0', async () => {
    const claimed = dbSql({ extra: (text) => (text.includes('INTO facts') ? [{ claimed: 1, facts_written: 4, questions_written: 1 }] : undefined) });
    assert.equal((await processSource({ sql: claimed, source: source(TEXT) })).status, 'recorded');
    assert.equal((await processSource({ sql: dbSql(), source: source(TEXT) })).status, 'recorded');
    const asText = dbSql({ extra: (text) => (text.includes('INTO facts') ? [{ claimed: '0' }] : undefined) });
    assert.equal((await processSource({ sql: asText, source: source(TEXT) })).status, 'skipped');
  });

  test('סעיף 14: קודמת שלא טופלה (processed_at ריק) אינה כפילות; קודמת שטופלה כן', async () => {
    const rows = (processed) => [
      { id: SRC_ID, hash: sha(TEXT), at: at('2026-10-10T08:00:00Z'), processed },
      { id: OTHER_ID, hash: sha(TEXT), at: at('2026-10-10T09:00:00Z') },
    ];
    const run = (list) => processSource({ sql: dbSql({ extra: sourcesModel(list) }), source: source(TEXT, { id: OTHER_ID }) });
    assert.equal((await run(rows(false))).status, 'recorded', 'הראשונה לא טופלה: השנייה מעובדת');
    assert.equal((await run(rows(true))).status, 'duplicate');
  });

  test('סעיף 15: 100,000 תווים של "ש.ב " מסתיימים מהר, בלי חילוץ, בלי כתיבה ובלי קריאה למסד', async () => {
    const text = 'ש.ב '.repeat(25_000);
    assert.equal(text.length, 100_000);
    const sql = dbSql();
    const started = performance.now();
    const result = await processSource({ sql, source: source(text) });
    const took = performance.now() - started;
    assert.ok(took < 1000, `לקח ${Math.round(took)}ms`);
    assert.deepEqual(result, { status: 'unclassified', reply: RECEIVED_REPLY });
    assert.equal(sql.calls.length, 0);
  });
  test('סעיף 15: התקרה היא 20,000 תווים: בדיוק 20,000 מעובד, 20,001 לא', async () => {
    assert.equal(MAX_PROCESSABLE_LENGTH, 20_000);
    const padded = (length) => TEXT + ' '.repeat(length - TEXT.length);
    assert.equal((await processSource({ sql: dbSql(), source: source(padded(20_000)) })).status, 'recorded');
    const over = dbSql();
    assert.equal((await processSource({ sql: over, source: source(padded(20_001)) })).status, 'unclassified');
    assert.equal(writesOf(over).length, 0);
  });
  test('סעיף 15: הודעה קרובה לתקרה עם הרבה אירועים עדיין מעובדת מהר', async () => {
    const text = 'ש.ב '.repeat(5_000);
    const started = performance.now();
    await processSource({ sql: dbSql(), source: source(text, { received_at: SUNDAY_EVENING }) });
    const took = performance.now() - started;
    assert.ok(took < 1000, `לקח ${Math.round(took)}ms`);
  });
});

// בדיקות מבניות: ניסויי שבירה הראו שפקודות ה-SQL עצמן לא נתפסות בבדיקות התנהגות (ה-SQL מזויף ואינו מורץ), ולכן נועלים את מבנה הפקודות.
describe('מבנה פקודות ה-SQL: כל כתיבה תלויה בתפיסה האטומית (ביקורת, סעיף 12)', () => {
  test('כפילות: אותו יום בישראל הוא שוויון, ואי-השוויון היחיד הוא על ה-id', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר יש מבחן במתמטיקה') });
    const { text } = sql.find('FROM sources s JOIN sources p')[0];
    assert.ok(text.includes("(p.received_at AT TIME ZONE 'Asia/Jerusalem')::date = (s.received_at AT TIME ZONE 'Asia/Jerusalem')::date"), 'יום ישראלי זהה');
    assert.ok(text.includes('p.content_hash = s.content_hash'));
    assert.equal(text.split('<>').length - 1, 1, 'אי-שוויון אחד בלבד: p.id <> s.id');
    assert.ok(text.includes('p.id <> s.id'));
  });

  test('processSource: התפיסה היא רק של שורה שלא טופלה', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר מבחן') });
    assert.match(atomicOf(sql).text, /^WITH claim AS \( UPDATE sources SET processed_at = now\(\) WHERE id = \?::uuid AND processed_at IS NULL RETURNING id \)/);
  });
  test('processSource: העובדות והשאלה נכתבות רק מתוך התפיסה (claim), לא מערכים חיצוניים', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר מבחן') });
    const { text } = atomicOf(sql);
    assert.match(text, /INSERT INTO facts \([^)]*\) SELECT claim\.id, x\.field, x\.value, \?::text, 'script', NULL::text, NULL::uuid, x\.origin, NULL::text FROM claim, jsonb_to_recordset\(\?::jsonb\) AS x\(field text, value text, origin text\) RETURNING id/);
    assert.match(text, /INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'question', now\(\), true, NULL::uuid, NULL::timestamptz, 'source', claim\.id, 1 FROM claim WHERE \?::text IS NOT NULL RETURNING id/);
    assert.match(text, /SELECT \(SELECT count\(\*\) FROM claim\)::int AS claimed/);
  });

  describe('answerQuestion', () => {
    const run = async () => {
      const sql = answerDb({ src: source('מחר מבחן ביצירה', { channel: 'app' }), facts: SAVED_NO_SUBJECT });
      await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, recordCandidateRules: true });
      return atomicOf(sql).text;
    };
    // מאז שלב 8.2א-1 הסגירה גם מסמנת read_at וקובעת מזהה לשורת התשובה (ה3).
    test('סגירת השאלה היא compare-and-set על שאלה שעדיין ממתינה', async () => {
      assert.match(await run(), /^WITH closed AS \( UPDATE messages SET awaiting_reply = false, read_at = now\(\), reply_source_id = gen_random_uuid\(\) WHERE id = \?::uuid AND kind = 'question' AND awaiting_reply = true RETURNING id, reply_source_id \)/);
    });
    test('העובדות החדשות נכתבות רק מתוך closed', async () => {
      assert.match(await run(), /INSERT INTO facts \([^)]*\) SELECT \?::uuid, x\.field, x\.value, \?::text, 'script', NULL::text, NULL::uuid, x\.origin, NULL::text FROM closed, jsonb_to_recordset\(\?::jsonb\) AS x\(field text, value text, origin text\) RETURNING id/);
    });
    test('השאלה הבאה נכתבת רק מתוך closed', async () => {
      assert.match(await run(), /INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'question', now\(\), true, NULL::uuid, NULL::timestamptz, 'source', \?::uuid, \?::integer FROM closed WHERE \?::text IS NOT NULL RETURNING id/);
    });
    test('עדכון הדפוס מותנה בכך שהשאלה אכן נסגרה (EXISTS על closed)', async () => {
      assert.match(await run(), /UPDATE candidate_rules SET .* WHERE pattern = \?::text AND EXISTS \(SELECT 1 FROM closed\) RETURNING id/);
    });
    test('הוספת הדפוס מתוך closed, ורק אם העדכון לא מצא דפוס קיים', async () => {
      assert.match(await run(), /INSERT INTO candidate_rules \([^)]*\) SELECT \?::text, 1, now\(\), now\(\), jsonb_build_object\('message_ids', jsonb_build_array\(\?::text\)\), 'candidate' FROM closed WHERE \?::text IS NOT NULL AND NOT EXISTS \(SELECT 1 FROM r_upd\) RETURNING id/);
    });
    // מאז שלב 8.2א-1: גם שורת התשובה (sources) ובועה (messages) לפני העובדות והדפוס.
    test('בפקודה בדיוק חמש הכנסות (שורת תשובה, עובדות, שאלה, בועה, דפוס), וכולן INSERT ... SELECT ולא VALUES', async () => {
      const inserts = [...(await run()).matchAll(/INSERT INTO (\w+) \([^)]*\) (SELECT|VALUES)/g)].map((m) => [m[1], m[2]]);
      assert.deepEqual(inserts, [['sources', 'SELECT'], ['facts', 'SELECT'], ['messages', 'SELECT'], ['messages', 'SELECT'], ['candidate_rules', 'SELECT']]);
    });
  });
});

describe('api/intake.js מחובר לצינור', () => {
  const insertReturning = (text) => (text.includes('INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY }] : undefined);
  const withDb = (extra = () => undefined) => dbSql({ extra: (text, values) => insertReturning(text) ?? extra(text, values) });

  test('מסלול מלא דרך handle: התשובה "נרשם · ..." ו-200, והמקור נשמר לפני העיבוד', async () => {
    const sql = withDb();
    const res = await handle(formRequest({ text: 'מחר יש מבחן במתמטיקה', sender: 'כותב' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם · מבחן · מתמטיקה · ראשון 11.10');
    assert.match(sql.calls[0].text, /INSERT INTO sources/);
    assert.match(sql.calls[0].text, /RETURNING id, received_at/);
    assert.deepEqual(sql.calls[0].values, ['כותב', 'מחר יש מבחן במתמטיקה', sha('מחר יש מבחן במתמטיקה')], 'סדר הערכים של ה-INSERT לא השתנה');
    assert.equal(sql.find('INTO facts').length, 1);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8');
  });

  test('הצינור מקבל את השורה שנשמרה (id, channel, טקסט, hash, received_at)', async () => {
    let seen;
    const processor = async ({ source: given }) => { seen = given; return { status: 'recorded', reply: 'נרשם · בדיקה' }; };
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET, processor });
    assert.deepEqual(seen, { id: SRC_ID, channel: 'shortcut', raw_content: 'שלום', content_hash: sha('שלום'), received_at: SATURDAY });
    assert.equal(await res.text(), 'נרשם · בדיקה');
  });

  test('חותמת received_at חסרה או לא ניתנת לפענוח מהמסד: שעת ההגעה לשרת, והעיבוד נמשך', async () => {
    for (const received_at of [undefined, null, 'לא תאריך']) {
      let seen;
      const sql = fakeSql((text) => (text.includes('INTO sources') ? [{ id: SRC_ID, received_at }] : []));
      const before = Date.now();
      await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql, secret: FAKE_SECRET, processor: async ({ source: given }) => { seen = given; } });
      assert.ok(seen.received_at instanceof Date && seen.received_at.getTime() >= before - 5 && seen.received_at.getTime() <= Date.now() + 5);
    }
  });

  test('כפילות: "כבר קיבלתי" בתשובה, ו-200', async () => {
    const sql = withDb((text) => (text.includes('FROM sources s JOIN sources p') ? [{ found: 1 }] : undefined));
    const res = await handle(formRequest({ text: 'מחר יש מבחן במתמטיקה' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), DUPLICATE_REPLY);
  });

  test('הודעה לא מובנת: "התקבל"', async () => {
    const res = await handle(formRequest({ text: 'שלום מה נשמע' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET });
    assert.equal(await res.text(), RECEIVED_REPLY);
  });

  test('ה-INSERT לא החזיר שורה (fakeSql רגיל): בלי עיבוד, "התקבל"', async () => {
    let called = false;
    const sql = fakeSql();
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql, secret: FAKE_SECRET, processor: async () => { called = true; } });
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.equal(called, false);
    assert.equal(sql.calls.length, 1);
  });

  test('תשובה ריקה או חסרה מהצינור: "התקבל"', async () => {
    for (const result of [undefined, null, {}, { reply: '' }, { reply: 5 }]) {
      const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET, processor: async () => result });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), RECEIVED_REPLY);
    }
  });

  test('כשל באמצע (הפקודה האטומית זורקת): עדיין 200 "התקבל", המקור נשמר, אין כתיבה חלקית, והלוג בלי תוכן וסוד', async (t) => {
    const cap = captureConsole(t);
    const text = 'מחר יש מבחן במתמטיקה';
    const sql = withDb((q) => { if (q.includes('INTO facts')) throw new Error(`connection reset ${text} ${FAKE_SECRET}`); return undefined; });
    const res = await handle(formRequest({ text }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.equal(sql.find('INTO sources').length, 1, 'ההודעה המקורית נשמרה');
    assert.equal(writesOf(sql).length, 3, 'ה-INSERT למקור + ניסיון אחד של הפקודה האטומית + רישום התוצאה (46, M.1), לא יותר');
    assert.deepEqual(sql.find('INTO intake_outcomes').map((call) => call.values), [[SRC_ID, 'failed', 'error']]);
    assert.equal(sql.find('INTO call_log').length, 0);
    const log = cap.text();
    assert.match(log, /intake: עיבוד נכשל/);
    assert.ok(!log.includes(text) && !log.includes(FAKE_SECRET) && !log.includes('connection reset'), 'הלוג בלי תוכן, סוד או message');
  });

  test('כשל לא צפוי בצינור (שגיאה מכל סוג) לא משנה סטטוס', async (t) => {
    captureConsole(t);
    for (const thrown of [new Error('x'), 'מחרוזת', undefined, null, 7]) {
      const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET, processor: async () => { throw thrown; } });
      assert.equal(res.status, 200);
      assert.equal(await res.text(), RECEIVED_REPLY);
    }
    const sync = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET, processor: () => { throw new Error('sync'); } });
    assert.equal(sync.status, 200);
  });

  test('העיבוד נתקע: אחרי 5 שניות "התקבל" ו-200, והלוג מכיל רק את שם השגיאה', async (t) => {
    const cap = captureConsole(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let called = false;
    const pending = handle(formRequest({ text: 'שלום' }, { headers: H }), { sql: withDb(), secret: FAKE_SECRET, processor: () => { called = true; return new Promise(() => {}); } });
    let res;
    pending.then((value) => { res = value; });
    for (let i = 0; i < 200 && !res; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      t.mock.timers.tick(5000);
    }
    assert.ok(called, 'הצינור הופעל');
    assert.ok(res, 'התשובה חזרה למרות שהעיבוד נתקע');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.match(cap.text(), /TimeoutError/);
  });

  test('כשל בשמירת המקור נשאר 500 ולא מפעיל את הצינור', async (t) => {
    captureConsole(t);
    let called = false;
    const sql = fakeSql((text) => { if (text.includes('INTO sources')) throw new Error('down'); return []; });
    const res = await handle(formRequest({ text: 'שלום' }, { headers: H }), { sql, secret: FAKE_SECRET, processor: async () => { called = true; } });
    assert.equal(res.status, 500);
    assert.equal(called, false);
  });
});

describe('בלי קריאת מודל ובלי רשת', () => {
  const root = new URL('../', import.meta.url);
  const files = [
    ...readdirSync(new URL('lib/', root)).filter((name) => name.startsWith('intake-') && name.endsWith('.js')).map((name) => `lib/${name}`),
    'lib/timetable.js',
    'api/intake.js',
  ];

  test('הקבצים הנכונים נסרקים (כולל intake-process.js)', () => {
    assert.ok(files.includes('lib/intake-process.js'));
    assert.equal(files.length, 9, files.join(', ')); // 7 מודולי intake-*, timetable, ו-api/intake.js
  });

  for (const file of files) {
    test(`${file}: אין fetch(, anthropic, gemini, openai`, () => {
      // ההגדרה export default { fetch(request) {...} } של api/intake.js היא ה-handler של Vercel, לא קריאת רשת.
      const text = readFileSync(new URL(file, root), 'utf8').replace(/^[ \t]*fetch\(request\) \{$/m, '');
      assert.doesNotMatch(text, /fetch\(|anthropic|gemini|openai/i);
    });
  }

  test('lib/intake-process.js: אין DELETE / DROP / TRUNCATE (בלי מחיקה פיזית, build-rules 31)', () => {
    const code = readFileSync(new URL('lib/intake-process.js', root), 'utf8').split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
    assert.doesNotMatch(code, /\b(DELETE|DROP|TRUNCATE)\b/); // באותיות גדולות: מילות SQL (ל-Map.delete יש אותיות קטנות)
  });

  test('הייבואים: רק קבצים מקומיים, node:, והדרייבר של Neon', () => {
    for (const file of files) {
      const text = readFileSync(new URL(file, root), 'utf8');
      for (const match of text.matchAll(/^import .* from '([^']+)';$/gm)) {
        assert.match(match[1], /^(\.\/|\.\.\/|node:|@neondatabase\/serverless$)/, `${file}: ${match[1]}`);
      }
    }
  });
});

describe('סכמה (H15): כל עמודה שהצינור כותב או קורא קיימת ב-db/schema.sql', () => {
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
  const columnsOf = {};
  for (const match of schema.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
    columnsOf[match[1]] = new Set(match[2].split('\n').map((line) => /^\s*(\w+)\s+\w+/.exec(line)?.[1]).filter((name) => name && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)$/i.test(name)));
  }

  const splitTopLevel = (text) => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) { parts.push(current); current = ''; } else current += ch;
    }
    return [...parts, current].map((part) => part.trim()).filter(Boolean);
  };
  // כותב: INSERT INTO t (cols) ו-UPDATE t SET a = ..., b = ...
  function writes(sqlText) {
    const found = [];
    for (const m of sqlText.matchAll(/INSERT INTO (\w+) \(([^)]*)\)/g)) found.push({ table: m[1], columns: m[2].split(',').map((c) => c.trim()) });
    for (const m of sqlText.matchAll(/UPDATE (\w+) SET (.*?) (?:WHERE|RETURNING) /g)) {
      found.push({ table: m[1], columns: splitTopLevel(m[2]).map((assignment) => /^(\w+)\s*=/.exec(assignment)?.[1]) });
    }
    return found;
  }
  // קורא: SELECT a, b FROM t (רשימות פשוטות בלבד)
  function reads(sqlText) {
    const found = [];
    for (const m of sqlText.matchAll(/SELECT ([\w, ]+?) FROM (sources|messages|facts) (?:WHERE|$)/g)) {
      if (!/\bAS\b/i.test(m[1])) found.push({ table: m[2], columns: m[1].split(',').map((c) => c.trim()) });
    }
    return found;
  }

  test('הטבלאות שהצינור נוגע בהן קיימות בסכמה', () => {
    for (const table of ['sources', 'facts', 'messages', 'candidate_rules']) assert.ok(columnsOf[table], table);
  });

  test('כל העמודות שנכתבות ונקראות בכל מסלולי הצינור קיימות', async () => {
    const all = [];
    const record = (sql) => all.push(...sql.calls.map((c) => c.text));
    // קליטה עם שאלה, קליטה בלי שאלה, כפילות
    for (const text of ['מחר יש מבחן במתמטיקה', 'מבחן במתמטיקה ב-12.10 על שברים בשיעור 3']) {
      const sql = dbSql();
      await processSource({ sql, source: source(text) });
      record(sql);
    }
    const dup = dbSql({ duplicate: true });
    await processSource({ sql: dup, source: source('מחר יש מבחן במתמטיקה', { id: OTHER_ID }) });
    record(dup);
    // תשובה בערוץ app (כולל candidate_rules והשאלה הבאה)
    const answered = answerDb({ src: source('מחר מבחן ביצירה', { channel: 'app' }), facts: SAVED_NO_SUBJECT });
    await answerQuestion({ sql: answered, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY });
    record(answered);

    const seen = { sources: new Set(), facts: new Set(), messages: new Set(), candidate_rules: new Set() };
    for (const sqlText of all) for (const { table, columns } of [...writes(sqlText), ...reads(sqlText)]) {
      for (const column of columns) {
        assert.ok(column, `${table}: עמודה לא מפוענחת ב-${sqlText.slice(0, 60)}`);
        assert.ok(columnsOf[table]?.has(column), `${table}.${column} לא קיימת ב-db/schema.sql`);
        seen[table]?.add(column);
      }
    }
    // הבדיקה באמת ראתה את העמודות המרכזיות (ולא עברה על רשימה ריקה)
    assert.ok(seen.facts.has('origin') && seen.facts.has('haiku_confidence') && seen.facts.has('extracted_by'));
    assert.ok(seen.messages.has('awaiting_reply') && seen.messages.has('entity_type') && seen.messages.has('attempt'));
    assert.ok(seen.candidate_rules.has('occurrences') && seen.candidate_rules.has('evidence') && seen.candidate_rules.has('status'));
    assert.ok(seen.sources.has('processed_at'));
  });
});

// ---------------------------------------------------------------------------
// שלב 8.2א-1 (docs/08-chapter8/47, "8.2א-1 נתונים ושרת"): ערוץ app, בועות תשובה, שאלת "מה זה?" ותשובה כשורת מקור.
// הסדר לערוץ app וכל הדוגמאות כאן לפי הכרעה ה1 בהוראות השלב; כל דוגמה הורצה על הקוד לפני שנכנסה לבדיקה. המשפטים מומצאים.
// "קריטריון N" בשם הבדיקה = קריטריון הקבלה N בטבלת 8.2א-1 של 47.
// ---------------------------------------------------------------------------
const UPDATE_BUBBLE_GUARD = "NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source'";
// מה פקודות הכתיבה של processSource כתבו: בועות (kind='update') ושאלות. מזהה את הפקודה לפי הצורה שלה.
function writtenBy(sql) {
  const bubbles = [];
  const questions = [];
  for (const call of writesOf(sql)) {
    if (call.text.includes('INTO facts')) {
      // [sourceId, certainty, factsJson, questionText, questionText, bubble, bubble]
      if (call.values[3] !== null) questions.push(call.values[3]);
      if (call.values[5] !== null) bubbles.push(call.values[5]);
    } else if (call.text.startsWith('WITH b AS')) {
      bubbles.push(call.values[0]); // writeReceipt: [body, sourceId]
    } else if (call.text.startsWith('WITH q AS')) {
      questions.push(call.values[0]); // writeTypeQuestion: [text, sourceId]
    } else if (call.text.startsWith('WITH claim AS') && call.text.includes("'update'")) {
      bubbles.push(call.values[1]); // markTypedDuplicate: [sourceId, body]
    }
  }
  return { bubbles, questions };
}
const typedSource = (text, over = {}) => source(text, { channel: 'app', received_at: SUNDAY_EVENING, ...over });
const runTyped = async (text, options = {}) => {
  const sql = dbSql(options);
  const result = await processSource({ sql, source: typedSource(text), timetable: TIMETABLE });
  return { sql, result, ...writtenBy(sql) };
};

describe('8.2א-1: ערוץ app בקליטה (הכרעה ה1)', () => {
  // [טקסט, סטטוס, תשובה, בועות, שאלות]
  const cases = [
    ['המבחן בהיסטוריה נדחה ליום חמישי', 'recorded', 'נרשם · הזזה · היסטוריה · חמישי 15.10', ['נרשם · הזזה · היסטוריה · חמישי 15.10'], ['איזה שיעור?']],
    ['מחר בוטל שיעור אנגלית', 'recorded', 'נרשם · ביטול · אנגלית · שני 12.10', ['נרשם · ביטול · אנגלית · שני 12.10'], ['איזה שיעור?']],
    ['המורה אמרה שמחר יש מבחן בהיסטוריה', 'recorded', 'נרשם · מבחן · היסטוריה · שני 12.10', ['נרשם · מבחן · היסטוריה · שני 12.10'], ['על איזה נושא?']],
    ['תרשום מבחן בהיסטוריה ביום חמישי', 'recorded', 'נרשם · מבחן · היסטוריה · חמישי 15.10', ['נרשם · מבחן · היסטוריה · חמישי 15.10'], ['על איזה נושא?']],
    ['יש מבחן בהיסטוריה מחר?', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['מתי המבחן בהיסטוריה?', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['להביא מחשבון למבחן במתמטיקה מחר', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['להביא חוברת', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['מה יש לי מחר', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['תקבע פגישה', 'unclassified', RECEIVED_REPLY, [RECEIVED_REPLY], []],
    ['מחר אין שיעור אנגלית', 'unclassified', RECEIVED_REPLY, [], ['מה זה?']],
    ['שלום', 'unclassified', RECEIVED_REPLY, [], ['מה זה?']],
  ];
  for (const [text, status, reply, bubbles, questions] of cases) {
    test(`קריטריונים 9-10: "${text}"`, async () => {
      const out = await runTyped(text);
      assert.deepEqual(out.result, { status, reply });
      assert.deepEqual(out.bubbles, bubbles, 'בועות');
      assert.deepEqual(out.questions, questions, 'שאלות');
      assert.equal(writesOf(out.sql).length, 1, 'פקודת כתיבה אחת בדיוק');
    });
  }

  test('קריטריון 10: משימה ושאלה מוקלדות לא עוברות חילוץ ולא טוענות מערכת שעות (שאלה אמיתית לפני הסוג)', async () => {
    for (const text of ['להביא מחשבון למבחן במתמטיקה מחר', 'יש מבחן בהיסטוריה מחר?']) {
      const sql = dbSql();
      await processSource({ sql, source: typedSource(text) });
      assert.equal(sql.find('FROM timetable_slots').length, 0, text);
      assert.equal(sql.find('INTO facts').length, 0, text);
    }
  });

  test('קריטריון 10: מעל 20,000 תווים: "התקבל" בלי שאלה ובלי חילוץ; בדיוק 20,000 עדיין מקבל שאלה', async () => {
    const over = await runTyped('שלום' + ' '.repeat(20_001 - 4));
    assert.deepEqual(over.result, { status: 'unclassified', reply: RECEIVED_REPLY });
    assert.deepEqual(over.bubbles, [RECEIVED_REPLY]);
    assert.deepEqual(over.questions, []);
    assert.equal(over.sql.find('FROM sources s JOIN sources p').length, 0, 'בלי בדיקת כפילות ובלי חילוץ');
    const exact = await runTyped('שלום' + ' '.repeat(20_000 - 4));
    assert.deepEqual(exact.questions, ['מה זה?']);
  });

  test('קריטריון 10: הודעה שהועברה ולא הובנה: בלי שאלה ובלי בועה, כמו לפני השלב', async () => {
    for (const text of ['מחר אין שיעור אנגלית', 'שלום', 'תקבע פגישה']) {
      const sql = dbSql();
      const result = await processSource({ sql, source: source(text, { received_at: SUNDAY_EVENING }), timetable: TIMETABLE });
      assert.deepEqual(result, { status: 'unclassified', reply: RECEIVED_REPLY }, text);
      assert.equal(writesOf(sql).length, 0, text);
    }
  });

  test('ה1 צעד 5: בערוץ app לא מופעלת הבדיקה "read בלי תאריך" (הודעה שהועברה כן)', async () => {
    const text = 'המורה אמרה שיש מבחן בהיסטוריה'; // שורש הצגה, בלי תאריך ובלי מילת שאלה
    const typed = await runTyped(text);
    assert.equal(typed.result.status, 'recorded');
    assert.deepEqual(typed.questions, ['לאיזה תאריך?']);
    assert.deepEqual(typed.bubbles, [], 'לא הובן ונפתחה שאלה: בלי בועה');
    const forwarded = await processSource({ sql: dbSql(), source: source(text, { received_at: SUNDAY_EVENING }), timetable: TIMETABLE });
    assert.equal(forwarded.status, 'unclassified');
  });

  test('קריטריון 9: מוקלדת עם סוג שלא הובנה: שאלה בלי בועה (הכרטיס הוא התגובה)', async () => {
    const out = await runTyped('יש מבחן');
    assert.equal(out.result.status, 'recorded');
    assert.deepEqual(out.questions, ['לאיזה תאריך?']);
    assert.deepEqual(out.bubbles, []);
  });

  test('קריטריון 15: אותו טקסט מוקלד באותו יום: "כבר קיבלתי" כבועה, בתפיסה אטומית אחת', async () => {
    const out = await runTyped('מחר יש מבחן בהיסטוריה', { duplicate: true });
    assert.deepEqual(out.result, { status: 'duplicate', reply: DUPLICATE_REPLY });
    assert.deepEqual(out.bubbles, [DUPLICATE_REPLY]);
    const [call] = writesOf(out.sql);
    assert.match(call.text, /^WITH claim AS \( UPDATE sources SET processed_at = now\(\) WHERE id = \?::uuid AND processed_at IS NULL RETURNING id \), b AS \( INSERT INTO messages/);
    assert.match(call.text, /FROM claim WHERE NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.direction = 'out' AND x\.kind = 'update' AND x\.entity_type = 'source' AND x\.entity_id = claim\.id\)/);
    assert.equal(out.sql.find('INTO facts').length, 0);
  });

  test('קריטריון 15: כפילות בין ערוצים (D8): מוקלדת שזהה להודעה שהועברה קודם באותו יום היא כפילות', async () => {
    const text = 'מחר יש מבחן בהיסטוריה';
    const rows = [
      { id: SRC_ID, hash: sha(text), at: new Date('2026-10-11T08:00:00Z') }, // הועברה בבוקר וטופלה
      { id: OTHER_ID, hash: sha(text), at: new Date('2026-10-11T15:00:00Z') }, // הוקלדה בערב
    ];
    const sql = dbSql({ extra: sourcesModel(rows) });
    const result = await processSource({ sql, source: typedSource(text, { id: OTHER_ID }), timetable: TIMETABLE });
    assert.equal(result.status, 'duplicate');
  });

  test('קריטריון 15: טקסט שזהה לתשובה אינו כפילות: שורת תשובה נשמרת עם content_hash ריק, והתנאי במסד הוא שוויון hash', async () => {
    // מודל: שורת התשובה "היסטוריה" (hash = NULL) קודמת ומטופלת; ההודעה המוקלדת "היסטוריה" באה אחריה.
    const rows = [
      { id: SRC_ID, hash: null, at: new Date('2026-10-11T08:00:00Z') },
      { id: OTHER_ID, hash: sha('היסטוריה'), at: new Date('2026-10-11T09:00:00Z') },
    ];
    const sql = dbSql({ extra: sourcesModel(rows) });
    const result = await processSource({ sql, source: typedSource('היסטוריה', { id: OTHER_ID }), timetable: TIMETABLE });
    assert.notEqual(result.status, 'duplicate');
    assert.ok(sql.find('FROM sources s JOIN sources p')[0].text.includes('p.content_hash = s.content_hash'), 'NULL = NULL אינו אמת ב-SQL');
  });

  test('קריטריון 14: כשל בפקודה האטומית של מוקלדת: זורק (api/intake.js תופס), וניסיון כתיבה אחד בלבד', async () => {
    const sql = dbSql({ extra: (text) => { if (text.includes('INTO facts')) throw new Error('db down'); return undefined; } });
    await assert.rejects(() => processSource({ sql, source: typedSource('מחר יש מבחן בהיסטוריה'), timetable: TIMETABLE }), /db down/);
    assert.equal(writesOf(sql).length, 1);
  });

  test('חותמת קליטה לא תקינה במוקלדת: "התקבל" כבועה, בלי עובדות', async () => {
    const sql = dbSql();
    const result = await processSource({ sql, source: typedSource('מחר יש מבחן בהיסטוריה', { received_at: 'לא תאריך' }), timetable: TIMETABLE });
    assert.equal(result.status, 'unclassified');
    assert.deepEqual(writtenBy(sql).bubbles, [RECEIVED_REPLY]);
  });

  test('רווחים בלבד במוקלדת: "התקבל" ולא "מה זה?"', async () => {
    const out = await runTyped('   ');
    assert.deepEqual(out.bubbles, [RECEIVED_REPLY]);
    assert.deepEqual(out.questions, []);
  });

  test('התפיסה כבר נעשתה (claimed = 0): skipped, גם במוקלדת', async () => {
    const out = await runTyped('מחר יש מבחן בהיסטוריה', { extra: (text) => (text.includes('INTO facts') ? [{ claimed: 0 }] : undefined) });
    assert.equal(out.result.status, 'skipped');
  });
});

describe('8.2א-1: בועת "נרשם" בהודעה שהועברה (קריטריונים 8-9)', () => {
  test('קריטריון 8: מובנת בקליטה: בועת "נרשם" באותה פקודה של התפיסה, ומותנית ב-NOT EXISTS', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('מחר יש מבחן במתמטיקה'), timetable: TIMETABLE });
    assert.deepEqual(writtenBy(sql).bubbles, ['נרשם · מבחן · מתמטיקה · ראשון 11.10']);
    const { text } = atomicOf(sql);
    assert.match(text, /INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'update', now\(\), false, NULL::uuid, NULL::timestamptz, 'source', claim\.id, NULL::integer FROM claim WHERE \?::text IS NOT NULL AND NOT EXISTS/);
    assert.ok(text.includes(UPDATE_BUBBLE_GUARD));
  });
  test('קריטריון 9: לא מובנת: בלי בועה (רק "נרשם" נכתב להודעה שהועברה)', async () => {
    const sql = dbSql();
    await processSource({ sql, source: source('יש מבחן'), timetable: TIMETABLE });
    assert.deepEqual(writtenBy(sql).bubbles, []);
  });
  test('קריטריון 9: כפילות שהועברה: אותה פקודה כמו לפני השלב, בלי בועה', async () => {
    const sql = dbSql({ duplicate: true });
    await processSource({ sql, source: source('מחר יש מבחן במתמטיקה', { id: OTHER_ID }) });
    const [call] = writesOf(sql);
    assert.equal(call.text, 'UPDATE sources SET processed_at = now() WHERE id = ?::uuid AND processed_at IS NULL');
    assert.equal(sql.find('INTO messages').length, 0);
  });
  test('קריטריון 9: הסטטוסים והתשובות של הקיצור לא השתנו (סטטוס ותשובה לכל דוגמה)', async () => {
    const expected = [
      ['מחר יש מבחן במתמטיקה', { status: 'recorded', reply: 'נרשם · מבחן · מתמטיקה · ראשון 11.10' }],
      ['יש מבחן', { status: 'recorded', reply: RECEIVED_REPLY }],
      ['האם יש מבחן במתמטיקה מחר?', { status: 'recorded', reply: 'נרשם · מבחן · מתמטיקה · ראשון 11.10' }],
      ['מתי המבחן באנגלית?', { status: 'unclassified', reply: RECEIVED_REPLY }],
      ['שלום מה נשמע', { status: 'unclassified', reply: RECEIVED_REPLY }],
    ];
    for (const [text, result] of expected) {
      assert.deepEqual(await processSource({ sql: dbSql(), source: source(text) }), result, text);
    }
  });
});

describe('8.2א-1: answerQuestion: שורת תשובה, בועה ושאלת "מה זה?" (ה3, ה4)', () => {
  const typedSrc = (text) => source(text, { channel: 'app', received_at: SUNDAY_EVENING });

  test('קריטריון 5: הסגירה, שורת התשובה (app, sender=answer, content_hash ריק, מטופלת) והקישור בפקודה אחת, תלויים ב-closed', async () => {
    const sql = answerDb({ facts: SAVED_MATH });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY, timetable: TIMETABLE });
    const call = atomicOf(sql);
    assert.equal(writesOf(sql).length, 1, 'פקודה אחת');
    assert.match(call.text, /^WITH closed AS \( UPDATE messages SET awaiting_reply = false, read_at = now\(\), reply_source_id = gen_random_uuid\(\) WHERE id = \?::uuid AND kind = 'question' AND awaiting_reply = true RETURNING id, reply_source_id \)/);
    assert.match(call.text, /ans AS \( INSERT INTO sources \(id, channel, sender, raw_content, content_hash, received_at, processed_at\) SELECT closed\.reply_source_id, 'app', 'answer', \?::text, NULL::text, now\(\), now\(\) FROM closed RETURNING id \)/);
    assert.equal(answerParams(call).answerText, 'אלגברה', 'התשובה כפי שנשלחה');
    assert.match(call.text, /SELECT \(SELECT count\(\*\) FROM closed\)::int AS closed, \(SELECT id FROM ans\) AS answer_source_id, \(SELECT id FROM b\) AS bubble_id, \(SELECT id FROM m\) AS question_id$/);
  });

  test('קריטריון 5: כל הכנסה בפקודת התשובה תלויה ב-closed, ואין DELETE', async () => {
    const sql = answerDb({ facts: SAVED_MATH });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY, timetable: TIMETABLE });
    const { text } = atomicOf(sql);
    let inserts = 0;
    for (const m of text.matchAll(/INSERT INTO (\w+) \([^)]*\) SELECT (.*?) RETURNING id/g)) {
      inserts += 1;
      assert.match(m[2], /FROM closed\b/, `ההכנסה ל-${m[1]} תלויה ב-closed`);
    }
    assert.equal(inserts, 5);
    let updates = 0;
    for (const m of text.matchAll(/UPDATE (sources|candidate_rules) SET .*? WHERE (.*?) RETURNING id/g)) {
      updates += 1;
      assert.ok(m[2].includes('EXISTS (SELECT 1 FROM closed)'), `העדכון של ${m[1]} תלוי ב-closed`);
    }
    assert.equal(updates, 2);
    assert.doesNotMatch(text, /\bDELETE\b/);
  });

  test('קריטריון 5: שליחה כפולה: closed = 0, status closed, ושום מזהה לא מוחזר', async () => {
    const sql = answerDb({ facts: SAVED_MATH, written: [{ closed: 0, answer_source_id: null, bubble_id: null, question_id: null }] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'אלגברה', now: SATURDAY, timetable: TIMETABLE });
    assert.deepEqual(result, { done: false, reply: null, status: 'closed', created: NONE_CREATED });
  });

  test('created: המזהים שהפקודה החזירה', async () => {
    const written = [{ closed: 1, answer_source_id: SRC_ID, bubble_id: OTHER_ID, question_id: null }];
    const sql = answerDb({ src: source('מחר מבחן', { received_at: SATURDAY }), facts: SAVED_NO_SUBJECT, written });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'מתמטיקה', now: SATURDAY, timetable: TIMETABLE });
    assert.deepEqual(result.created, { answerSourceId: SRC_ID, bubbleId: OTHER_ID, questionId: null });
  });

  test('קריטריון 8 (תרחיש א): תשובה שמשלימה את ההבנה כותבת "נרשם" יחד עם השאלה הבאה', async () => {
    const sql = answerDb({ src: source('מחר יש מבחן', { received_at: SUNDAY_EVENING }), facts: [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-12', 'inferred')] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'היסטוריה', now: SUNDAY_EVENING, timetable: TIMETABLE });
    assert.equal(result.reply, 'על איזה נושא?');
    const params = answerParams(atomicOf(sql));
    assert.deepEqual(params.bubble, ['נרשם · מבחן · היסטוריה · שני 12.10', 'נרשם · מבחן · היסטוריה · שני 12.10']);
    assert.equal(params.nextText, 'על איזה נושא?');
    assert.equal(params.markProcessed, false, 'המקור כבר טופל בקליטה');
  });

  test('קריטריון 8: כשההודעה כבר הובנה לפני התשובה, לא נכתבת בועה נוספת (גם לא "התקבל")', async () => {
    for (const channel of ['shortcut', 'app']) {
      const sql = answerDb({ src: source('מחר יש מבחן במתמטיקה', { channel }), facts: SAVED_MATH });
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer: UNKNOWN_BUTTON, now: SATURDAY, timetable: TIMETABLE });
      assert.equal(result.done, true, channel);
      assert.deepEqual(answerParams(atomicOf(sql)).bubble, [null, null], channel);
    }
  });

  test('קריטריון 8: הבועה בתשובה מותנית ב-NOT EXISTS של בועה קיימת לאותו מקור', async () => {
    const sql = answerDb({ src: source('מחר יש מבחן', { received_at: SUNDAY_EVENING }), facts: [fact(TYPE_FIELD, 'exam'), fact('date', '2026-10-12', 'inferred')] });
    await answerQuestion({ sql, messageId: MSG_ID, answer: 'היסטוריה', now: SUNDAY_EVENING, timetable: TIMETABLE });
    const { text } = atomicOf(sql);
    assert.match(text, /b AS \( INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'update', now\(\), false, NULL::uuid, NULL::timestamptz, 'source', \?::uuid, NULL::integer FROM closed WHERE \?::text IS NOT NULL AND NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.direction = 'out' AND x\.kind = 'update' AND x\.entity_type = 'source' AND x\.entity_id = \?::uuid\) RETURNING id \)/);
  });

  test('קריטריון 9: השאלה האחרונה נסגרה וההודעה לא הובנה אף פעם: מוקלדת מקבלת "התקבל", הודעה שהועברה לא', async () => {
    const facts = [fact(TYPE_FIELD, 'exam'), fact('date', UNKNOWN_VALUE), fact('subject', UNKNOWN_VALUE), fact('topic', UNKNOWN_VALUE)];
    for (const [channel, expected] of [['app', RECEIVED_REPLY], ['shortcut', null]]) {
      const sql = answerDb({ src: source('יש מבחן', { channel }), facts });
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer: UNKNOWN_BUTTON, now: SATURDAY, timetable: TIMETABLE });
      assert.equal(result.done, true, channel);
      assert.equal(result.reply, RECEIVED_REPLY, channel);
      assert.deepEqual(answerParams(atomicOf(sql)).bubble, [expected, expected], channel);
    }
  });

  test('קריטריון 11: "מה זה?" -> "ביטול": חילוץ מחדש עם הסוג, עובדת type, processed_at, "נרשם", ושואלים רק על השיעור', async () => {
    const sql = answerDb({ src: typedSrc('מחר אין שיעור אנגלית'), facts: [] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'ביטול', now: SUNDAY_EVENING, timetable: TIMETABLE });
    assert.equal(result.status, 'answered');
    assert.equal(result.reply, 'איזה שיעור?', 'מקצוע ותאריך כבר חולצו מהטקסט; חסר רק השיעור');
    const call = atomicOf(sql);
    assert.deepEqual(jsonRowsOf(call), [
      { field: TYPE_FIELD, value: 'cancel', origin: 'read' },
      { field: 'subject', value: 'אנגלית', origin: 'read' },
      { field: 'date', value: '2026-10-12', origin: 'inferred' },
    ]);
    const params = answerParams(call);
    assert.equal(params.markProcessed, true, 'המקור מסומן כמטופל');
    assert.deepEqual(params.bubble, ['נרשם · ביטול · אנגלית · שני 12.10', 'נרשם · ביטול · אנגלית · שני 12.10']);
    assert.equal(params.nextText, 'איזה שיעור?');
    assert.match(call.text, /p AS \( UPDATE sources SET processed_at = now\(\) WHERE id = \?::uuid AND processed_at IS NULL AND \?::boolean AND EXISTS \(SELECT 1 FROM closed\) RETURNING id \)/);
  });

  test('קריטריון 11: סוג שנבחר בלי מידע בטקסט: נשמר רק הסוג, ושואלים מההתחלה (תאריך), בלי בועה', async () => {
    const sql = answerDb({ src: typedSrc('שלום'), facts: [] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'מבחן', now: SUNDAY_EVENING, timetable: TIMETABLE });
    assert.equal(result.reply, 'לאיזה תאריך?');
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), [{ field: TYPE_FIELD, value: 'exam', origin: 'read' }]);
    assert.deepEqual(answerParams(atomicOf(sql)).bubble, [null, null]);
  });

  test('קריטריון 10: "מה זה?" -> "לא יודע": סוגרים בלי עובדות, בלי processed_at, ובועת "התקבל"', async () => {
    const sql = answerDb({ src: typedSrc('מחר אין שיעור אנגלית'), facts: [] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: UNKNOWN_BUTTON, now: SUNDAY_EVENING, timetable: TIMETABLE });
    assert.deepEqual(result, { done: true, reply: RECEIVED_REPLY, status: 'answered', created: NONE_CREATED });
    const params = answerParams(atomicOf(sql));
    assert.deepEqual(jsonRowsOf(atomicOf(sql)), []);
    assert.equal(params.markProcessed, false);
    assert.equal(params.nextText, null);
    assert.deepEqual(params.bubble, [RECEIVED_REPLY, RECEIVED_REPLY]);
  });

  test('קריטריון 6: תשובה לא מובנת לשאלת "מה זה?": unclear, ולא נכתב כלום', async () => {
    const sql = answerDb({ src: typedSrc('מחר אין שיעור אנגלית'), facts: [] });
    for (const answer of ['זה משהו אחר', 'exam', '']) {
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer, now: SUNDAY_EVENING, timetable: TIMETABLE });
      assert.deepEqual(result, { done: false, reply: 'מה זה?', status: 'unclear', created: NONE_CREATED }, answer);
    }
    assert.equal(writesOf(sql).length, 0);
  });

  test('pendingQuestion: מוקלדת בלי סוג מקבלת "מה זה?" עם כפתורי הסוגים; הודעה שהועברה ומשימה מוקלדת לא', () => {
    const typeButtons = ['שיעורי בית', 'מבחן', 'ביטול', 'חדר', 'הזזה', 'יום מקוצר', 'יציאה מוקדמת', 'אירוע אישי', UNKNOWN_BUTTON];
    assert.deepEqual(pendingQuestion({ source: typedSrc('מחר אין שיעור אנגלית'), facts: [], timetable: TIMETABLE }), { field: TYPE_FIELD, text: 'מה זה?', buttons: typeButtons, allowFreeText: true });
    assert.equal(pendingQuestion({ source: source('מחר אין שיעור אנגלית'), facts: [], timetable: TIMETABLE }), null);
    assert.equal(pendingQuestion({ source: typedSrc('להביא חוברת'), facts: [], timetable: TIMETABLE }), null);
    assert.equal(pendingQuestion({ source: typedSrc('מה יש לי מחר'), facts: [], timetable: TIMETABLE }), null);
  });

  test('pendingQuestion: אחרי שנבחר סוג, השאלה הבאה מחושבת מהחילוץ עם הסוג השמור', () => {
    const facts = [fact(TYPE_FIELD, 'cancel'), fact('subject', 'אנגלית'), fact('date', '2026-10-12', 'inferred')];
    assert.equal(pendingQuestion({ source: typedSrc('מחר אין שיעור אנגלית'), facts, timetable: TIMETABLE }).field, 'lesson');
  });
});

describe('8.2א-1: מבנה פקודות הקליטה', () => {
  // כל הפקודות שנתיב הקליטה שולח למסד, בכל המסלולים (קיצור ומוקלדת).
  async function allIntakeCalls() {
    const all = [];
    const texts = ['מחר יש מבחן במתמטיקה', 'יש מבחן', 'שלום', 'להביא חוברת', 'מה יש לי מחר', 'תקבע פגישה', 'א'.repeat(20_001)];
    for (const channel of ['shortcut', 'app']) {
      for (const text of texts) {
        const sql = dbSql();
        await processSource({ sql, source: source(text, { channel }), timetable: TIMETABLE });
        all.push(...sql.calls);
      }
      const dup = dbSql({ duplicate: true });
      await processSource({ sql: dup, source: source('מחר יש מבחן', { channel }), timetable: TIMETABLE });
      all.push(...dup.calls);
    }
    return all;
  }

  test('נתיב הקליטה לא מזכיר read_at בשום פקודה (העמודה נוספת במסד החי רק בסוף השלב)', async () => {
    for (const call of await allIntakeCalls()) assert.ok(!call.text.includes('read_at'), call.text.slice(0, 60));
    const code = readFileSync(new URL('../lib/intake-process.js', import.meta.url), 'utf8');
    const intakePart = code.slice(0, code.indexOf('export async function answerQuestion'));
    assert.ok(!intakePart.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n').includes('read_at'), 'גם לא בקוד שלפני answerQuestion');
  });

  test('כל פקודת כתיבה היא פקודה אחת שמתחילה ב-WITH, או ה-UPDATE הקבוע של כפילות בקיצור; אין DELETE', async () => {
    for (const call of (await allIntakeCalls()).filter((c) => /\b(INSERT|UPDATE|DELETE)\b/.test(c.text))) {
      assert.ok(call.text.startsWith('WITH ') || call.text === 'UPDATE sources SET processed_at = now() WHERE id = ?::uuid AND processed_at IS NULL', call.text.slice(0, 60));
      assert.doesNotMatch(call.text, /\bDELETE\b/);
    }
  });

  test('כל הכנסת בועה מותנית ב-NOT EXISTS של בועה קיימת לאותו מקור; כל הכנסה תלויה בתפיסה או בשורת המקור', async () => {
    let bubbles = 0;
    for (const call of await allIntakeCalls()) {
      for (const m of call.text.matchAll(/INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, '(update|question)'(.*?) RETURNING id/g)) {
        assert.match(m[2], /FROM (claim|sources s WHERE s\.id = \?::uuid)\b/, 'תלויה בתפיסה או במקור');
        if (m[1] === 'update') {
          bubbles += 1;
          assert.ok(m[2].includes(UPDATE_BUBBLE_GUARD), 'פעם אחת לכל מקור');
        }
      }
    }
    assert.ok(bubbles >= 4, 'הבדיקה באמת ראתה בועות');
  });

  test('קריטריון 11: שאלת "מה זה?" נכתבת רק אם אין שאלה כלשהי לאותו מקור, ורק למקור שלא טופל', async () => {
    const sql = dbSql();
    await processSource({ sql, source: typedSource('שלום'), timetable: TIMETABLE });
    const [call] = writesOf(sql);
    assert.match(call.text, /^WITH q AS \( INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'question', now\(\), true, NULL::uuid, NULL::timestamptz, 'source', s\.id, 1 FROM sources s WHERE s\.id = \?::uuid AND s\.processed_at IS NULL AND NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.kind = 'question' AND x\.entity_type = 'source' AND x\.entity_id = s\.id\) RETURNING id \)/);
    assert.deepEqual(call.values, ['מה זה?', SRC_ID]);
  });

  test('קריטריון 14: מוקלדת דרך api/intake.js: כשל בפקודה האטומית: 200 "התקבל", המקור נשמר, וניסיון כתיבה אחד', async (t) => {
    const cap = captureConsole(t);
    const sql = dbSql({ extra: (text) => {
      if (text.includes('INTO sources')) return [{ id: SRC_ID, received_at: SUNDAY_EVENING }];
      if (text.includes('INTO facts')) throw new Error('connection reset מחר יש מבחן בהיסטוריה');
      return undefined;
    } });
    const res = await handle(formRequest({ text: 'מחר יש מבחן בהיסטוריה', channel: 'app' }, { headers: H }), { sql, secret: FAKE_SECRET });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), RECEIVED_REPLY);
    assert.equal(sql.find('INTO sources').length, 1);
    assert.equal(sql.find('INTO facts').length, 1);
    assert.equal(sql.find('INTO intake_outcomes').length, 0, 'מוקלדת לא נרשמת במדידה (46, D17)');
    assert.ok(!cap.text().includes('מחר יש מבחן'));
  });
});

describe('8.2א-1: סכמה: העמודות החדשות שהצינור כותב קיימות ב-db/schema.sql', () => {
  test('messages.read_at ו-sources (id, sender, content_hash, processed_at) קיימות', () => {
    const schema = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
    const body = (table) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(schema)[1];
    assert.match(body('messages'), /^\s*read_at\s+timestamptz\s*$/m);
    for (const column of ['id', 'channel', 'sender', 'raw_content', 'content_hash', 'received_at', 'processed_at']) {
      assert.match(body('sources'), new RegExp(`^\\s*${column}\\s+\\w+`, 'm'), column);
    }
    assert.match(body('sources'), /^\s*content_hash\s+text\s*,/m, 'content_hash מותרת להיות ריקה (שורת תשובה)');
    assert.match(body('messages'), /reply_source_id\s+uuid\s+REFERENCES sources\(id\)/);
  });
});

describe('8.2א-1: כפילות מול קודמת מוקלדת שלא סומנה processed_at (קריטריון 15, תיקון ביקורת)', () => {
  // הקודמת (SRC_ID) הוקלדה ב-18:00 בישראל וקיבלה בועה או שאלה, אבל processed_at שלה ריק. ההעתק (OTHER_ID) מגיע אחריה באותו יום.
  const rowsFor = (text, { messages = true } = {}) => [
    { id: SRC_ID, hash: sha(text), at: SUNDAY_EVENING, processed: false, messages },
    { id: OTHER_ID, hash: sha(text), at: new Date('2026-10-11T16:00:00Z') },
  ];
  const second = async (text, { channel = 'app', messages = true } = {}) => {
    const sql = dbSql({ extra: sourcesModel(rowsFor(text, { messages })) });
    const result = await processSource({ sql, source: source(text, { id: OTHER_ID, channel, received_at: new Date('2026-10-11T16:00:00Z') }), timetable: TIMETABLE });
    return { sql, result, ...writtenBy(sql) };
  };

  test('קריטריון 15: משימה מוקלדת פעמיים: "כבר קיבלתי" ולא "התקבל" שני', async () => {
    const out = await second('להביא חוברת');
    assert.deepEqual(out.result, { status: 'duplicate', reply: DUPLICATE_REPLY });
    assert.deepEqual(out.bubbles, [DUPLICATE_REPLY]);
    assert.deepEqual(out.questions, []);
  });
  test('קריטריון 15: שאלה מוקלדת פעמיים: "כבר קיבלתי"', async () => {
    const out = await second('מה יש לי מחר');
    assert.equal(out.result.status, 'duplicate');
    assert.deepEqual(out.bubbles, [DUPLICATE_REPLY]);
  });
  test('קריטריון 15: טקסט לא מובן פעמיים כשהשאלה הראשונה עוד פתוחה: "כבר קיבלתי" ולא כרטיס "מה זה?" שני', async () => {
    const out = await second('מחר אין שיעור אנגלית');
    assert.equal(out.result.status, 'duplicate');
    assert.deepEqual(out.questions, [], 'בלי שאלה שנייה');
    assert.deepEqual(out.bubbles, [DUPLICATE_REPLY]);
  });
  test('קריטריון 15: מוקלדת ואחריה הודעה מועברת עם אותו טקסט: "כבר קיבלתי" לקיצור, באותה פקודה כמו לפני השלב ובלי בועה (D8)', async () => {
    const out = await second('מחר אין שיעור אנגלית', { channel: 'shortcut' });
    assert.deepEqual(out.result, { status: 'duplicate', reply: DUPLICATE_REPLY });
    const [call] = writesOf(out.sql);
    assert.equal(call.text, 'UPDATE sources SET processed_at = now() WHERE id = ?::uuid AND processed_at IS NULL');
    assert.equal(out.sql.find('INTO messages').length, 0);
  });
  test('קריטריון 15: קודמת בלי שורה ב-messages ובלי processed_at (העיבוד נכשל): עדיין לא כפילות, וההעתק מעובד', async () => {
    const typed = await second('מחר אין שיעור אנגלית', { messages: false });
    assert.equal(typed.result.status, 'unclassified');
    assert.deepEqual(typed.questions, ['מה זה?']);
    const forwarded = await second('מחר יש מבחן במתמטיקה', { channel: 'shortcut', messages: false });
    assert.equal(forwarded.result.status, 'recorded');
  });
  test('קריטריון 15: השאילתה: "טופלה" = processed_at מלא או שורה ב-messages על המקור; בלי read_at', async () => {
    const sql = dbSql();
    await processSource({ sql, source: typedSource('שלום'), timetable: TIMETABLE });
    const [query] = sql.find('FROM sources s JOIN sources p');
    assert.ok(query.text.includes("AND (p.processed_at IS NOT NULL OR EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = 'source' AND x.entity_id = p.id)) AND"));
    assert.ok(!query.text.includes('read_at'));
    assert.deepEqual(query.values, [SRC_ID]);
  });
});
