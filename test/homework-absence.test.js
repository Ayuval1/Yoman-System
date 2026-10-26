// בדיקות לשלב 8.3-2: ביטול ויציאה מוקדמת משפיעים על שאלת שיעורי הבית (lib/homework-absence.js, ענף homework ב-api/queues/deliver.js,
// pendingFromRows ב-lib/chat-view.js, loadPending ב-lib/chat-pending.js, questionText ב-public/index.html).
// מערכת השעות: הקובץ האמיתי data/school-timetable-taf-shin-pe-zayin.md (כמו test/homework-schedule.test.js). כל הנתונים מומצאים.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. המסד כאן מחליף בזיכרון שמחזיק עובדות ומפרש את הפקודות לפי צורתן.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { sequencesForDate } from '../lib/homework-schedule.js';
import { decideAbsence, loadAbsenceRows } from '../lib/homework-absence.js';
import { missedLessons } from '../lib/intake-facts.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { loadPending } from '../lib/chat-pending.js';
import { createLessonAsk } from '../lib/homework-view.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, captureConsole, FAKE_CRON } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
// ראשון 18.10 עד חמישי 22.10.2026, ושישי 23.10 (אין לימודים).
const DAYS = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
const FRIDAY = '2026-10-23';
const MONDAY = '2026-10-19';
const sequencesOf = (date) => sequencesForDate(TIMETABLE, date);
const sequenceOf = (date, subject) => sequencesOf(date).find((s) => s.subject === subject);
const periodsOfSequence = (s) => Array.from({ length: s.endPeriod - s.startPeriod + 1 }, (_, i) => s.startPeriod + i);

// שורות עובדות של מקור אחד: { source_id, field, value }.
const source = (id, fields) => Object.entries(fields).flatMap(([field, value]) => (Array.isArray(value) ? value : [value]).map((v) => ({ source_id: id, field, value: v })));
const cancel = (id, date, lesson) => source(id, { type: 'cancel', date, lesson });
const leave = (id, date, time, extra = {}) => source(id, { type: 'early_leave', date, time, ...extra });
const decide = (rows, sequence) => decideAbsence({ rows, sequence, timetable: TIMETABLE });

describe('homework-absence: ביטול (קריטריונים 1, 2)', () => {
  for (const date of DAYS) {
    test(`${date}: ביטול כל שיעורי היום מבטל כל רצף; ביטול של בדיוק שיעורי הרצף מבטל אותו`, () => {
      const all = cancel('s1', date, '1,2,3,4,5,6,7,8,9');
      for (const sequence of sequencesOf(date)) {
        assert.deepEqual(decide(all, sequence), { cancelled: true, missed: false }, `רצף ${sequence.startPeriod}`);
        assert.deepEqual(decide(cancel('s2', date, periodsOfSequence(sequence).join(',')), sequence), { cancelled: true, missed: false });
      }
    });
    test(`${date}: ביטול חלקי (רק חלק משיעורי רצף רב-שיעורי) לא מבטל; ביטול של רצף אחר לא משפיע`, () => {
      const [first] = sequencesOf(date);
      for (const sequence of sequencesOf(date).filter((s) => s.endPeriod > s.startPeriod)) {
        assert.equal(decide(cancel('s1', date, String(sequence.startPeriod)), sequence).cancelled, false, 'רק השיעור הראשון');
        assert.equal(decide(cancel('s1', date, String(sequence.endPeriod)), sequence).cancelled, false, 'רק השיעור האחרון');
      }
      const other = sequencesOf(date).find((s) => s.startPeriod !== first.startPeriod);
      assert.equal(decide(cancel('s1', date, periodsOfSequence(other).join(',')), first).cancelled, false);
    });
  }

  test('ביטול חלקי של רצף 7-9 (פיזיקה, שני) בשתי הודעות שמכסות את כולו: מבוטל (איחוד); בהודעה אחת שמכסה חלק: לא', () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    assert.deepEqual([physics.startPeriod, physics.endPeriod], [7, 9]);
    assert.equal(decide(cancel('s1', MONDAY, '7,8'), physics).cancelled, false);
    assert.equal(decide([...cancel('s1', MONDAY, '7'), ...cancel('s2', MONDAY, '8,9')], physics).cancelled, true);
  });

  test('ביטול מתאריך אחר, ערך unknown, שיעור לא מספרי, וסוג אחר (homework) לא מבטלים', () => {
    const math = sequenceOf(MONDAY, 'מתמטיקה'); // 3-4
    assert.equal(decide(cancel('s1', '2026-10-20', '3,4'), math).cancelled, false, 'תאריך אחר');
    assert.equal(decide(cancel('s1', MONDAY, 'unknown'), math).cancelled, false);
    assert.equal(decide(cancel('s1', MONDAY, 'abc,3'), math).cancelled, false);
    assert.equal(decide(source('s1', { type: 'homework', date: MONDAY, lesson: '3,4' }), math).cancelled, false);
    assert.equal(decide(source('s1', { type: 'cancel', date: MONDAY, subject: 'מתמטיקה' }), math).cancelled, false, 'בלי עובדת שיעור');
    assert.equal(decide([], math).cancelled, false);
    assert.equal(decide(null, math).cancelled, false);
  });

  test('שישי: אין רצפים, ואין שיעורים מפוספסים', () => {
    assert.deepEqual(sequencesOf(FRIDAY), []);
    assert.deepEqual(missedLessons(TIMETABLE, FRIDAY, '10:00'), []);
  });
});

describe('homework-absence: יציאה מוקדמת (קריטריונים 3, 4, 5)', () => {
  test('יום שני, יציאה ב-13:15: מדעי המחשב (נגמר 13:25) ופיזיקה (15:45) פוספסו; אנגלית (12:35) ומתמטיקה (11:40) לא', () => {
    const rows = leave('s1', MONDAY, '13:15');
    const got = Object.fromEntries(sequencesOf(MONDAY).map((s) => [s.subject, decide(rows, s)]));
    assert.deepEqual(got, {
      'תנ"ך': { cancelled: false, missed: false },
      'ספרות': { cancelled: false, missed: false },
      'מתמטיקה': { cancelled: false, missed: false },
      'אנגלית': { cancelled: false, missed: false },
      'מדעי המחשב': { cancelled: false, missed: true },
      'פיזיקה': { cancelled: false, missed: true },
    });
  });

  test('הגבול: רצף שנגמר בדיוק בשעת היציאה לא מפוספס; דקה לפני סיומו כן', () => {
    const cs = sequenceOf(MONDAY, 'מדעי המחשב'); // נגמר 13:25
    assert.equal(cs.endsAt, '13:25');
    assert.equal(decide(leave('s1', MONDAY, '13:25'), cs).missed, false);
    assert.equal(decide(leave('s1', MONDAY, '13:24'), cs).missed, true);
    assert.equal(decide(leave('s1', MONDAY, '13:26'), cs).missed, false);
  });

  test('אותו כלל כמו missedLessons: רצף מפוספס אם ורק אם השיעור האחרון שלו ברשימת המפוספסים, בכל ימי השבוע ובכל שעה בדקות של 5', () => {
    for (const date of DAYS) {
      for (let minutes = 8 * 60; minutes <= 16 * 60; minutes += 5) {
        const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        const missedPeriods = missedLessons(TIMETABLE, date, time);
        for (const sequence of sequencesOf(date)) {
          assert.equal(decide(leave('s1', date, time), sequence).missed, missedPeriods.includes(sequence.endPeriod), `${date} ${time} רצף ${sequence.startPeriod}`);
        }
      }
    }
  });

  test('confirm: no לא מסמן; yes או בלי confirm מסמנים', () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    assert.equal(decide(leave('s1', MONDAY, '13:15', { confirm: 'no' }), physics).missed, false);
    assert.equal(decide(leave('s1', MONDAY, '13:15', { confirm: 'yes' }), physics).missed, true);
    assert.equal(decide(leave('s1', MONDAY, '13:15'), physics).missed, true);
    assert.equal(decide(leave('s1', MONDAY, '13:15', { confirm: ['yes', 'no'] }), physics).missed, false, '"no" גובר');
    // מקור אחד שאושר לא מכסה מקור אחר שנדחה, ולהפך: מסמן אם יש מקור שלא נדחה.
    assert.equal(decide([...leave('s1', MONDAY, '13:15', { confirm: 'no' }), ...leave('s2', MONDAY, '14:00')], physics).missed, true);
  });

  test('תאריך אחר, שעה לא תקינה ('+"'unknown'"+') וסוג אחר לא מסמנים', () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    assert.equal(decide(leave('s1', '2026-10-20', '09:00'), physics).missed, false);
    assert.equal(decide(leave('s1', MONDAY, 'unknown'), physics).missed, false);
    assert.equal(decide(leave('s1', MONDAY, '25:99'), physics).missed, false);
    assert.equal(decide(source('s1', { type: 'personal_event', date: MONDAY, time: '09:00' }), physics).missed, false);
  });

  test('ביטול גובר: רצף מבוטל שגם נגמר אחרי היציאה = cancelled ולא missed', () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    assert.deepEqual(decide([...cancel('s1', MONDAY, '7,8,9'), ...leave('s2', MONDAY, '13:15')], physics), { cancelled: true, missed: false });
  });
});

// ---------------------------------------------------------------------------
// מסד בזיכרון לענף homework בצרכן התור.
// ---------------------------------------------------------------------------
function absenceDb({ factRows = [], factsError = null } = {}) {
  const db = { asks: [], messages: [], probe: [], factQueries: [] };
  const sql = fakeSql((text, values) => {
    if (text.includes('FROM facts f')) {
      db.factQueries.push({ text, values });
      if (factsError) throw factsError;
      return factRows;
    }
    if (text.startsWith('WITH a AS ( INSERT INTO lesson_asks')) {
      const [subject, lessonDate, startPeriod, , missed] = values;
      if (db.asks.some((a) => a.subject === subject && a.lesson_date === lessonDate && a.seq_start_period === startPeriod)) return [{ ask_id: null, message_id: null }];
      const ask = { id: `ask-${db.asks.length + 1}`, subject, lesson_date: lessonDate, seq_start_period: startPeriod, missed };
      db.asks.push(ask);
      db.messages.push({ entity_type: 'lesson_ask', entity_id: ask.id });
      return [{ ask_id: ask.id, message_id: `m-${db.messages.length}` }];
    }
    if (text.includes('INSERT INTO probe_log')) {
      db.probe.push({ text, values });
      return [];
    }
    return [];
  });
  sql.db = db;
  return sql;
}

describe('queue-deliver: ענף homework עם ביטול ויציאה מוקדמת (קריטריונים 1-8)', () => {
  const message = (sequence) => ({ kind: 'homework', slotKey: sequence.slotKey, targetAt: sequence.askAt.toISOString() });
  const run = (sql, sequence) => handleDelivery(message(sequence), { deliveryCount: 1 }, {
    sql, now: () => new Date(sequence.askAt.getTime() + 500), pushHandle: async () => new Response('ok', { status: 200 }), secret: FAKE_CRON, timetable: TIMETABLE,
  });

  test('רצף שכולו מבוטל: reason=cancelled, אין lesson_asks, אין הודעה, אין שורת chat-notify, ושם המקצוע לא ב-probe_log', async () => {
    const math = sequenceOf(MONDAY, 'מתמטיקה');
    const sql = absenceDb({ factRows: cancel('s1', MONDAY, '3,4') });
    const out = await run(sql, math);
    assert.deepEqual({ stored: out.stored, created: out.created, sent: out.sent, reason: out.reason }, { stored: true, created: false, sent: false, reason: 'cancelled' });
    assert.equal(sql.db.asks.length, 0);
    assert.equal(sql.db.messages.length, 0);
    assert.equal(sql.find('INSERT INTO lesson_asks').length, 0);
    assert.equal(sql.db.probe.filter((p) => p.text.includes("'chat-notify'")).length, 0, 'אין התראה ואין שורת chat-notify');
    assert.ok(!JSON.stringify(sql.db.probe).includes('מתמטיקה'), 'בלי שם מקצוע ב-probe_log');
    assert.deepEqual(sql.db.factQueries[0].values, [MONDAY], 'השאילתה מסוננת לתאריך הרצף');
  });

  test('ביטול חלקי: השאלה נוצרת כרגיל, missed=false', async () => {
    const math = sequenceOf(MONDAY, 'מתמטיקה');
    const sql = absenceDb({ factRows: cancel('s1', MONDAY, '3') });
    const out = await run(sql, math);
    assert.equal(out.created, true);
    assert.equal(out.reason, undefined);
    assert.equal(sql.db.asks.length, 1);
    assert.equal(sql.db.asks[0].missed, false);
  });

  test('יציאה מוקדמת ב-13:15 ביום שני: פיזיקה נוצרת עם missed=true; אנגלית (12:35) עם missed=false', async () => {
    const rows = leave('s1', MONDAY, '13:15');
    const sqlPhysics = absenceDb({ factRows: rows });
    assert.equal((await run(sqlPhysics, sequenceOf(MONDAY, 'פיזיקה'))).created, true);
    assert.equal(sqlPhysics.db.asks[0].missed, true);
    const sqlEnglish = absenceDb({ factRows: rows });
    assert.equal((await run(sqlEnglish, sequenceOf(MONDAY, 'אנגלית'))).created, true);
    assert.equal(sqlEnglish.db.asks[0].missed, false);
  });

  test('confirm=no: נוצרת בלי סימון; בלי עובדות בכלל: נוצרת בלי סימון', async () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    const sqlNo = absenceDb({ factRows: leave('s1', MONDAY, '13:15', { confirm: 'no' }) });
    await run(sqlNo, physics);
    assert.equal(sqlNo.db.asks[0].missed, false);
    const sqlNone = absenceDb();
    await run(sqlNone, physics);
    assert.equal(sqlNone.db.asks[0].missed, false);
  });

  test('כשל בקריאת העובדות: השאלה נוצרת כרגיל בלי סימון, ובלוג רק שם השגיאה (בלי תוכן)', async (t) => {
    const log = captureConsole(t);
    const error = new TypeError('סוד-פנימי-בהודעת-השגיאה');
    const sql = absenceDb({ factsError: error });
    const out = await run(sql, sequenceOf(MONDAY, 'פיזיקה'));
    assert.equal(out.created, true);
    assert.equal(sql.db.asks[0].missed, false);
    assert.match(log.text(), /TypeError/);
    assert.ok(!log.text().includes('סוד-פנימי'), 'לא מודפס תוכן השגיאה');
    assert.ok(!log.text().includes('פיזיקה'), 'לא מודפס שם מקצוע');
  });

  test('שישי: אין רצף למפתח, no-sequence, בלי שאילתת עובדות ובלי שאלה', async () => {
    const sql = absenceDb();
    const out = await handleDelivery({ kind: 'homework', slotKey: `homework-${FRIDAY}-1`, targetAt: '2026-10-23T07:00:00.000Z' }, { deliveryCount: 1 }, {
      sql, now: () => new Date('2026-10-23T07:00:00.500Z'), pushHandle: async () => new Response('ok'), secret: FAKE_CRON, timetable: TIMETABLE,
    });
    assert.equal(out.reason, 'no-sequence');
    assert.equal(sql.db.factQueries.length, 0);
    assert.equal(sql.db.asks.length, 0);
  });

  test('בכל ימי השבוע: ביטול כל היום -> אף שאלה לא נוצרת; יציאה ב-13:15 -> missed בדיוק לרצפים שנגמרים אחרי 13:15', async () => {
    for (const date of DAYS) {
      for (const sequence of sequencesOf(date)) {
        const cancelled = absenceDb({ factRows: cancel('s1', date, '1,2,3,4,5,6,7,8,9') });
        assert.equal((await run(cancelled, sequence)).reason, 'cancelled', `${date} ${sequence.startPeriod}`);
        assert.equal(cancelled.db.asks.length, 0);
        const left = absenceDb({ factRows: leave('s1', date, '13:15') });
        await run(left, sequence);
        assert.equal(left.db.asks[0].missed, sequence.endsAt > '13:15', `${date} ${sequence.startPeriod}`);
      }
    }
  });

  test('createLessonAsk: missed נשמר באותה פקודה (פרמטר boolean אחרי seq_end_at), וברירת המחדל false', async () => {
    const physics = sequenceOf(MONDAY, 'פיזיקה');
    const sql = absenceDb();
    await createLessonAsk({ sql, sequence: physics, timetable: TIMETABLE, missed: true });
    await createLessonAsk({ sql, sequence: sequenceOf(MONDAY, 'אנגלית'), timetable: TIMETABLE });
    assert.equal(sql.calls.length, 2);
    assert.match(sql.calls[0].text, /INSERT INTO lesson_asks \(subject, lesson_date, seq_start_period, seq_end_at, missed\) VALUES \(\?::text, \?::date, \?::integer, \?::timestamptz, \?::boolean\)/);
    assert.deepEqual(sql.db.asks.map((a) => a.missed), [true, false]);
  });

  test('loadAbsenceRows: שאילתה אחת לקריאה בלבד (בלי INSERT/UPDATE/DELETE), עם התאריך כפרמטר', async () => {
    const sql = absenceDb({ factRows: [{ source_id: 's', field: 'type', value: 'cancel' }] });
    const rows = await loadAbsenceRows(sql, MONDAY);
    assert.equal(rows.length, 1);
    assert.equal(sql.calls.length, 1);
    assert.doesNotMatch(sql.calls[0].text, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    assert.match(sql.calls[0].text, /t\.value IN \('cancel', 'early_leave'\)/);
    assert.deepEqual(sql.calls[0].values, [MONDAY]);
  });
});

describe('הכרטיס בצ\'אט: שדה missed ונוסח (קריטריון 7)', () => {
  const questions = (missed) => [{ id: 'q1', entity_type: 'lesson_ask', sent_at: '2026-10-19T10:00:00.000Z', subject: 'פיזיקה', lesson_date: MONDAY, ...(missed === undefined ? {} : { missed }) }];
  const item = (missed) => pendingFromRows({ questions: questions(missed), facts: [], timetable: TIMETABLE, today: MONDAY })[0];

  test('pendingFromRows: missed הוא boolean תמיד, true רק כשהשורה true', () => {
    assert.strictEqual(item(true).missed, true);
    assert.strictEqual(item(false).missed, false);
    assert.strictEqual(item(undefined).missed, false);
    assert.strictEqual(item(null).missed, false);
    assert.strictEqual(item('true').missed, false);
  });

  test('loadPending: השאילתה מביאה la.missed, והשדה מגיע לפריט', async () => {
    const sql = fakeSql((text) => (text.includes('FROM messages m LEFT JOIN sources s')
      ? [{ id: 'q1', body: 'x', sent_at: '2026-10-19T10:00:00.000Z', entity_type: 'lesson_ask', subject: 'פיזיקה', lesson_date: MONDAY, missed: true }]
      : []));
    const [first] = await loadPending(sql, TIMETABLE, new Date('2026-10-19T11:00:00.000Z'));
    assert.equal(first.missed, true);
    assert.match(sql.calls[0].text, /la\.missed AS missed/);
  });

  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const questionText = vm.runInNewContext(`(${/function questionText\([^)]*\) \{[\s\S]*?\n\}/.exec(script)[0]})`);

  test('questionText: missed=true מציג "פספסת שיעור <מקצוע>, נתנו שיעורי בית?"; אחרת הנוסח הקיים', () => {
    assert.equal(questionText({ kind: 'homework', subject: 'פיזיקה', missed: true }), 'פספסת שיעור פיזיקה, נתנו שיעורי בית?');
    assert.equal(questionText({ kind: 'homework', subject: 'פיזיקה', missed: false }), 'פיזיקה: היו שיעורי בית?');
    assert.equal(questionText({ kind: 'homework', subject: 'פיזיקה' }), 'פיזיקה: היו שיעורי בית?');
    assert.equal(questionText({ kind: 'homework', subject: 'פיזיקה', missed: 'true' }), 'פיזיקה: היו שיעורי בית?');
    assert.equal(questionText({ text: 'על איזה נושא?', missed: true }), 'על איזה נושא?', 'שאלה רגילה לא מושפעת');
  });
});
