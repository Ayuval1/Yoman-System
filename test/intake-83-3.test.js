// בדיקות שלב 8.3-3 ("ישות האירוע הפנימית וזרימת האישור", docs/08-chapter8/65 D1, D2, D2א, D3, D5): שורת events לשני הסוגים early_leave ו-personal_event,
// סבב התיקון אחרי "לא נכון" (fix / fix_time / fix_date), ובטיחות נתונים ישנים, וההשפעה על שאלת שיעורי הבית (lib/homework-absence.js).
// מערכת השעות האמיתית (data/school-timetable-taf-shin-pe-zayin.md). 18.10.2026 ראשון ... 23.10.2026 שישי. 08:30 בישראל (UTC+3). כל המשפטים מומצאים.
// חשוב: ה-SQL לא הורץ מול Postgres (אין מסד בסשן). sql מזויף רושם את הפקודות; נבדקים מבנה הפקודה האטומית והפרמטרים שנשלחים אליה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processSource, pendingQuestion, answerQuestion, TYPE_FIELD } from '../lib/intake-process.js';
import { buildQuestion, applyAnswer, formatReply, UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { UNKNOWN_VALUE, schoolDayEnd, missedLessons } from '../lib/intake-facts.js';
import { decideAbsence, loadAbsenceRows } from '../lib/homework-absence.js';
import { sequencesForDate } from '../lib/homework-schedule.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { loadPending } from '../lib/chat-pending.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { fakeSql } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const MATCH_KEY = `source:${SRC_ID}`;
const MONDAY = '2026-10-19';
const MONDAY_0830 = `${MONDAY}T08:30:00+03:00`;
const WEEK = [['ראשון', '2026-10-18'], ['שני', '2026-10-19'], ['שלישי', '2026-10-20'], ['רביעי', '2026-10-21'], ['חמישי', '2026-10-22']];
const FRIDAY = '2026-10-23';

const MSG1 = 'אני הולך מהבית ספר ב13:15 בגלל בדיקה רפואית';
const MSG2 = 'בדיקה רפואית היום ב-16:00';

const typedSource = (text, over = {}) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: `hash-${text}`, received_at: new Date(MONDAY_0830), ...over });
const fact = (field, value, origin = 'read') => ({ field, value, origin });
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));
const factsJsonOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && value.startsWith('[')));

// processSource: הפרמטר האחרון בפקודה הוא ה-JSON של שורת האירוע.
const intakeEvents = (call) => JSON.parse(call.values.at(-1));
// answerQuestion: 20 הפרמטרים הקודמים, ואחריהם (שלב 8.3-3) insert, update, cancel, ובועת התיקון שלוש פעמים (20, 21, 22, 23, 25, 27).
const answerEvents = (call) => {
  assert.equal(call.values.length, 28, 'מספר הפרמטרים בפקודת התשובה');
  return {
    insert: JSON.parse(call.values[20]),
    update: JSON.parse(call.values[21]),
    cancel: JSON.parse(call.values[22]),
    fixBubble: [call.values[23], call.values[25], call.values[27]],
    nextText: call.values[7],
    bubble: call.values[11],
  };
};

const SAVED_EARLY = [fact(TYPE_FIELD, 'early_leave'), fact('date', MONDAY, 'inferred'), fact('time', '13:15'), fact('lesson', '6,7,8,9', 'inferred')];
const SAVED_EVENT = [fact(TYPE_FIELD, 'personal_event'), fact('date', MONDAY, 'inferred'), fact('time', '16:00'), fact('end_time', '17:00', 'inferred'), fact('topic', 'בדיקה רפואית')];
const EARLY_ROW = { start_date: MONDAY, start_time: '13:15', end_date: MONDAY, match_key: MATCH_KEY, title: 'יציאה מוקדמת', domain: 'school', end_time: '15:45', movable: false };
const EVENT_ROW = { start_date: MONDAY, start_time: '16:00', end_date: MONDAY, match_key: MATCH_KEY, title: 'בדיקה רפואית', domain: 'personal', end_time: '17:00', movable: null };

function answerDb({ src, facts, written = [{ closed: 1 }], awaiting = true }) {
  const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: awaiting, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
  return fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [messageRow];
    if (text.includes('FROM sources WHERE id')) return [src];
    if (text.includes('FROM facts WHERE source_id')) return facts;
    if (text.includes('INTO facts')) return written;
    return [];
  });
}
async function answer(text, saved, reply, over = {}) {
  const sql = answerDb({ src: typedSource(text, over), facts: saved });
  const result = await answerQuestion({ sql, messageId: MSG_ID, answer: reply, now: new Date(MONDAY_0830), timetable: TIMETABLE });
  const writes = writesOf(sql);
  return { sql, result, writes, call: writes[0] };
}
async function intake(text, over = {}, written = () => []) {
  const sql = fakeSql(written);
  const result = await processSource({ sql, source: typedSource(text, over), timetable: TIMETABLE });
  const writes = writesOf(sql);
  return { sql, result, writes, call: writes[0] };
}

// ---------------------------------------------------------------------------
describe('8.3-3: שורת האירוע בקליטה (processSource)', () => {
  test('הודעה 1 (יציאה מוקדמת, שני 13:15): שורה אחת בפקודה האטומית, עד סוף יום הלימודים 15:45, school, movable=false', async () => {
    const { result, writes, call } = await intake(MSG1);
    assert.equal(result.status, 'recorded');
    assert.equal(writes.length, 1, 'פקודה אחת אטומית');
    assert.deepEqual(intakeEvents(call), [EARLY_ROW]);
    assert.doesNotMatch(call.text, /\bDELETE\b/);
  });

  test('הודעה 2 (אירוע אישי 16:00): כותרת = המילים של יובל (topic), עד 17:00, personal, movable=NULL', async () => {
    const { call } = await intake(MSG2);
    assert.deepEqual(intakeEvents(call), [EVENT_ROW]);
  });

  test('מבנה ה-SQL: INSERT ... SELECT מתוך claim, NOT EXISTS על match_key, המרה לשעון ישראל ב-SQL, planned, external_id ו-description ריקים', async () => {
    const { call } = await intake(MSG1);
    assert.match(call.text, /e AS \( INSERT INTO events \(title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key\) SELECT /);
    assert.match(call.text, /\(\(ev\.start_date \|\| ' ' \|\| ev\.start_time\)::timestamp AT TIME ZONE 'Asia\/Jerusalem'\), \(\(ev\.end_date \|\| ' ' \|\| ev\.end_time\)::timestamp AT TIME ZONE 'Asia\/Jerusalem'\)/);
    assert.match(call.text, /NULL::text, NULL::text, ev\.domain, ev\.movable, 'planned', NULL::text, NULL::uuid, ev\.match_key FROM claim, jsonb_to_recordset\(\?::jsonb\) AS ev\(/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM events x WHERE x\.match_key = ev\.match_key\) RETURNING id \)/);
    assert.match(call.text, /\(SELECT count\(\*\) FROM e\)::int AS events_written$/);
  });

  for (const [name, date] of WEEK) {
    test(`יציאה ב-13:15 ביום ${name} (${date}): הסיום הוא סוף יום הלימודים (${schoolDayEnd(TIMETABLE, date)})`, async () => {
      const { call } = await intake(MSG1, { received_at: new Date(`${date}T08:30:00+03:00`) });
      const [row] = intakeEvents(call);
      assert.deepEqual({ start: `${row.start_date} ${row.start_time}`, end: `${row.end_date} ${row.end_time}` }, { start: `${date} 13:15`, end: `${date} ${schoolDayEnd(TIMETABLE, date)}` });
    });
  }

  test('שישי (אין לימודים) ויציאה אחרי סוף היום (ראשון 16:00): הסיום = שעת היציאה', async () => {
    const friday = await intake(MSG1, { received_at: new Date(`${FRIDAY}T08:30:00+03:00`) });
    assert.equal(factsJsonOf(friday.call)[0].value, 'early_leave');
    assert.deepEqual(intakeEvents(friday.call).map((row) => [row.start_time, row.end_time]), [['13:15', '13:15']]);
    const late = await intake('אני יוצא מבית הספר ב-16:00', { received_at: new Date('2026-10-18T08:30:00+03:00') });
    assert.equal(factsJsonOf(late.call)[0].value, 'early_leave');
    assert.deepEqual(intakeEvents(late.call).map((row) => [row.start_date, row.start_time, row.end_time]), [['2026-10-18', '16:00', '16:00']]);
  });

  test('אין שורת אירוע לסוגים אחרים: ביטול, מבחן, יום מקוצר', async () => {
    for (const text of ['שיעורים 7, 8, 9 בוטלו היום', 'מחר יש מבחן במתמטיקה', 'מחר יום מקוצר']) {
      const { call } = await intake(text);
      assert.notEqual(factsJsonOf(call)[0].value, 'early_leave', text);
      assert.deepEqual(intakeEvents(call), [], text);
    }
  });

  test('אין שורת אירוע בלי שעה מפוענחת: שעה במילים עמומה באירוע אישי ("בארבע") נשאלת קודם', async () => {
    const { call } = await intake('יש לי תור לרופא מחר בארבע');
    const facts = factsJsonOf(call);
    assert.equal(facts[0].value, 'personal_event');
    assert.equal(facts.some((row) => row.field === 'time'), false);
    assert.deepEqual(intakeEvents(call), []);
  });

  test('אידמפוטנטיות: הרצה כפולה של אותו מקור שולחת את אותו match_key, והשנייה (claimed=0) לא נחשבת', async () => {
    const first = await intake(MSG1, {}, (text) => (text.includes('INTO facts') ? [{ claimed: 1 }] : []));
    const second = await intake(MSG1, {}, (text) => (text.includes('INTO facts') ? [{ claimed: 0 }] : []));
    assert.equal(first.result.status, 'recorded');
    assert.equal(second.result.status, 'skipped');
    assert.deepEqual(intakeEvents(first.call).map((row) => row.match_key), [MATCH_KEY]);
    assert.deepEqual(intakeEvents(second.call).map((row) => row.match_key), [MATCH_KEY]);
    assert.match(second.call.text, /FROM claim, jsonb_to_recordset/, 'ההכנסה תלויה בתפיסה');
  });
});

// ---------------------------------------------------------------------------
describe('8.3-3: שורת האירוע כשתשובה משלימה תאריך ושעה (answerQuestion)', () => {
  test('"מה זה?" -> אירוע אישי, ואז "16:00": בתשובת השעה נשלחת שורת אירוע; בבחירת הסוג (בלי שעה) לא', async () => {
    const src = 'בדיקה רפואית היום';
    const chosen = await answer(src, [], 'אירוע אישי');
    assert.deepEqual(answerEvents(chosen.call).insert, [], 'בלי שעה אין אירוע');
    const saved = [fact(TYPE_FIELD, 'personal_event'), fact('date', MONDAY, 'inferred'), fact('topic', 'בדיקה רפואית')];
    const timed = await answer(src, saved, '16:00');
    assert.deepEqual(answerEvents(timed.call).insert, [EVENT_ROW]);
    assert.match(timed.call.text, /ev_ins AS \( INSERT INTO events .* FROM closed, jsonb_to_recordset\(\?::jsonb\) AS ev\(.*\) WHERE NOT EXISTS \(SELECT 1 FROM events x WHERE x\.match_key = ev\.match_key\) RETURNING id \)/);
  });

  test('"מה זה?" -> יציאה מוקדמת, ואז "13:15" ביום שני: שורת יציאה מוקדמת עד 15:45', async () => {
    const saved = [fact(TYPE_FIELD, 'early_leave'), fact('date', MONDAY, 'inferred')];
    const { call } = await answer('הלכתי מהבית ספר', saved, '13:15');
    assert.deepEqual(answerEvents(call).insert, [EARLY_ROW]);
  });

  test('לחיצה כפולה: closed=0 = status closed, וההכנסה תלויה ב-closed (לא נכתבת שורה שנייה)', async () => {
    const sql = answerDb({ src: typedSource(MSG2), facts: SAVED_EVENT, written: [{ closed: 0 }] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'נכון', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.status, 'closed');
  });

  test('שאלה שכבר נסגרה (awaiting_reply=false): אין שום פקודת כתיבה', async () => {
    const sql = answerDb({ src: typedSource(MSG1), facts: [...SAVED_EARLY, fact('confirm', 'no')], awaiting: false });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'השעה', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.status, 'closed');
    assert.equal(writesOf(sql).length, 0);
  });
});

// ---------------------------------------------------------------------------
describe('8.3-3: "נכון" / "לא נכון" וסבב התיקון', () => {
  test('"נכון": האירוע לא משתנה (אין UPDATE, אין ביטול, אין בועת תיקון); רק הכנסה אידמפוטנטית עם אותם ערכים', async () => {
    for (const [text, saved, row] of [[MSG1, SAVED_EARLY, EARLY_ROW], [MSG2, SAVED_EVENT, EVENT_ROW]]) {
      const { result, call } = await answer(text, saved, 'נכון');
      assert.equal(result.done, true);
      const params = answerEvents(call);
      assert.deepEqual(params.insert, [row]);
      assert.deepEqual(params.update, []);
      assert.deepEqual(params.cancel, []);
      assert.deepEqual(params.fixBubble, [null, null, null]);
    }
  });

  test('"לא נכון": השאלה הבאה "מה לא נכון?" עם בדיוק שלושה כפתורים, בלי "לא יודע" ובלי תיבת כתיבה; האירוע לא משתנה עדיין', async () => {
    for (const [text, saved] of [[MSG1, SAVED_EARLY], [MSG2, SAVED_EVENT]]) {
      const { result, call } = await answer(text, saved, 'לא נכון');
      assert.equal(result.done, false);
      assert.equal(result.reply, 'מה לא נכון?');
      const params = answerEvents(call);
      assert.equal(params.nextText, 'מה לא נכון?');
      assert.deepEqual([params.update, params.cancel, params.fixBubble], [[], [], [null, null, null]]);
      const question = pendingQuestion({ source: typedSource(text), facts: [...saved, fact('confirm', 'no')], timetable: TIMETABLE });
      assert.deepEqual(question, { field: 'fix', text: 'מה לא נכון?', buttons: ['השעה', 'התאריך', 'לא קורה'], allowFreeText: false });
    }
  });

  test('כרטיס האישור עצמו נשאר עם שני כפתורים בלבד', () => {
    const card = pendingQuestion({ source: typedSource(MSG1), facts: SAVED_EARLY, timetable: TIMETABLE });
    assert.deepEqual(card.buttons, ['נכון', 'לא נכון']);
  });

  test('פענוח "מה לא נכון?": שלוש התוויות בלבד; "לא יודע", טקסט חופשי וריק = לא מפוענח, בלי כתיבה', async () => {
    const parse = (text) => applyAnswer({ facts: [], field: 'fix', answer: text }).find((row) => row.field === 'fix')?.value;
    assert.deepEqual(['השעה', 'התאריך', 'לא קורה', ' השעה. '].map(parse), ['time', 'date', 'cancel', 'time']);
    for (const bad of ['לא יודע', 'unknown', 'שעה', 'הכול', 'נכון', '']) assert.equal(parse(bad), undefined, bad);
    for (const bad of ['לא יודע', 'אולי']) {
      const { result, writes } = await answer(MSG2, [...SAVED_EVENT, fact('confirm', 'no')], bad);
      assert.deepEqual(result, { done: false, reply: 'מה לא נכון?', status: 'unclear', created: { answerSourceId: null, bubbleId: null, questionId: null } });
      assert.equal(writes.length, 0);
    }
  });

  test('"השעה": נשמר fix=time, והשאלה הבאה זהה לשאלת השעה ("באיזו שעה?", "לא יודע", תיבת כתיבה) בשדה fix_time', async () => {
    const saved = [...SAVED_EVENT, fact('confirm', 'no')];
    const { result, call } = await answer(MSG2, saved, 'השעה');
    assert.equal(result.reply, 'באיזו שעה?');
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix', value: 'time', origin: 'read' }]);
    assert.deepEqual(answerEvents(call).update, []);
    assert.deepEqual(pendingQuestion({ source: typedSource(MSG2), facts: [...saved, fact('fix', 'time')], timetable: TIMETABLE }),
      { field: 'fix_time', text: 'באיזו שעה?', buttons: [UNKNOWN_BUTTON], allowFreeText: true });
  });

  test('"התאריך": נשמר fix=date, והשאלה הבאה זהה לשאלת התאריך (עם "היום" ו"מחר") בשדה fix_date', async () => {
    const saved = [...SAVED_EARLY, fact('confirm', 'no')];
    const { result, call } = await answer(MSG1, saved, 'התאריך');
    assert.equal(result.reply, 'לאיזה תאריך?');
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix', value: 'date', origin: 'read' }]);
    assert.deepEqual(pendingQuestion({ source: typedSource(MSG1), facts: [...saved, fact('fix', 'date')], timetable: TIMETABLE }),
      { field: 'fix_date', text: 'לאיזה תאריך?', buttons: ['היום · שני 19.10.2026', 'מחר · שלישי 20.10.2026', UNKNOWN_BUTTON], allowFreeText: true });
    assert.deepEqual(buildQuestion({ field: 'fix_date', today: MONDAY }), { ...buildQuestion({ field: 'date', today: MONDAY }), field: 'fix_date' });
  });

  test('"לא קורה": UPDATE status=cancelled (בלי מחיקה), בועה "בוטל · ...", סגירה בלי שאלה נוספת ובלי הכנסת אירוע', async () => {
    for (const [text, saved, label] of [[MSG1, SAVED_EARLY, 'בוטל · יציאה מוקדמת · שני 19.10'], [MSG2, SAVED_EVENT, 'בוטל · אירוע אישי · בדיקה רפואית · שני 19.10']]) {
      const { result, call } = await answer(text, [...saved, fact('confirm', 'no')], 'לא קורה');
      assert.deepEqual({ done: result.done, reply: result.reply }, { done: true, reply: label });
      const params = answerEvents(call);
      assert.deepEqual(params.cancel, [{ match_key: MATCH_KEY }]);
      assert.deepEqual([params.insert, params.update, params.nextText], [[], [], null]);
      assert.deepEqual(params.fixBubble, [label, label, label]);
      assert.match(call.text, /ev_cancel AS \( UPDATE events SET status = 'cancelled' FROM jsonb_to_recordset\(\?::jsonb\) AS c\(match_key text\) WHERE events\.match_key = c\.match_key AND EXISTS \(SELECT 1 FROM closed\) RETURNING events\.id \)/);
      assert.doesNotMatch(call.text, /\bDELETE\b/);
    }
  });

  test('תיקון שעה באירוע אישי ("17:30"): UPDATE להתחלה החדשה וסיום שעה אחריה (D3), "עודכן · ...", וזה הסבב היחיד (אין כרטיס שני)', async () => {
    const saved = [...SAVED_EVENT, fact('confirm', 'no'), fact('fix', 'time')];
    const { result, call } = await answer(MSG2, saved, '17:30');
    const label = 'עודכן · אירוע אישי · בדיקה רפואית · שני 19.10';
    assert.deepEqual({ done: result.done, reply: result.reply }, { done: true, reply: label });
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix_time', value: '17:30', origin: 'read' }], 'append-only: time לא נדרס');
    const fixed = { ...EVENT_ROW, start_time: '17:30', end_time: '18:30' };
    const params = answerEvents(call);
    assert.deepEqual(params.update, [fixed]);
    assert.deepEqual(params.insert, [fixed], 'ההכנסה (רק אם אין שורה) נושאת את הערכים המתוקנים');
    assert.deepEqual(params.cancel, []);
    assert.deepEqual(params.fixBubble, [label, label, label]);
    assert.equal(params.nextText, null, 'אין שאלה נוספת');
    assert.equal(params.bubble, null, 'בועת "נרשם" לא נכתבת שוב');
    assert.match(call.text, /ev_upd AS \( UPDATE events SET starts_at = \(\(u\.start_date \|\| ' ' \|\| u\.start_time\)::timestamp AT TIME ZONE 'Asia\/Jerusalem'\), ends_at = \(\(u\.end_date \|\| ' ' \|\| u\.end_time\)::timestamp AT TIME ZONE 'Asia\/Jerusalem'\) FROM jsonb_to_recordset\(\?::jsonb\) AS u\(.*?\) WHERE events\.match_key = u\.match_key AND EXISTS \(SELECT 1 FROM closed\) RETURNING events\.id \)/);
    assert.equal(pendingQuestion({ source: typedSource(MSG2), facts: [...saved, fact('fix_time', '17:30')], timetable: TIMETABLE }), null, 'סבב אחד בלבד');
  });

  test('תיקון תאריך באירוע אישי ("מחר · שלישי 20.10.2026"): התחלה בתאריך החדש, סיום שעה אחריה, ובבועה התאריך החדש', async () => {
    const saved = [...SAVED_EVENT, fact('confirm', 'no'), fact('fix', 'date')];
    const { result, call } = await answer(MSG2, saved, 'מחר · שלישי 20.10.2026');
    assert.equal(result.reply, 'עודכן · אירוע אישי · בדיקה רפואית · שלישי 20.10');
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix_date', value: '2026-10-20', origin: 'read' }]);
    assert.deepEqual(answerEvents(call).update, [{ ...EVENT_ROW, start_date: '2026-10-20', end_date: '2026-10-20', end_time: '17:00' }]);
    assert.equal(pendingQuestion({ source: typedSource(MSG2), facts: [...saved, fact('fix_date', '2026-10-20')], timetable: TIMETABLE }), null);
  });

  test('תיקון תאריך בלבד שומר שעת סיום שהוקלדה (16:00 עד 18:30 נשאר 18:30 ביום החדש)', async () => {
    const saved = [fact(TYPE_FIELD, 'personal_event'), fact('date', MONDAY, 'inferred'), fact('time', '16:00'), fact('end_time', '18:30'), fact('topic', 'בדיקה רפואית'), fact('confirm', 'no'), fact('fix', 'date')];
    const { call } = await answer(MSG2, saved, 'מחר · שלישי 20.10.2026');
    assert.equal(answerEvents(call).update[0].end_time, '18:30');
    assert.equal(answerEvents(call).update[0].start_date, '2026-10-20');
  });

  test('תיקון ביציאה מוקדמת: הסיום מחושב מחדש לפי סוף יום הלימודים של התאריך בפועל, וגם יציאה אחרי הסוף', async () => {
    const base = [...SAVED_EARLY, fact('confirm', 'no')];
    const time = await answer(MSG1, [...base, fact('fix', 'time')], '12:00');
    assert.deepEqual(answerEvents(time.call).update, [{ ...EARLY_ROW, start_time: '12:00', end_time: '15:45' }]);
    assert.equal(time.result.reply, 'עודכן · יציאה מוקדמת · שני 19.10');
    const late = await answer(MSG1, [...base, fact('fix', 'time')], '16:30');
    assert.deepEqual(answerEvents(late.call).update, [{ ...EARLY_ROW, start_time: '16:30', end_time: '16:30' }]);
    const date = await answer(MSG1, [...base, fact('fix', 'date')], 'מחר · שלישי 20.10.2026');
    assert.deepEqual(answerEvents(date.call).update, [{ ...EARLY_ROW, start_date: '2026-10-20', end_date: '2026-10-20', end_time: '14:15' }]);
    assert.equal(date.result.reply, 'עודכן · יציאה מוקדמת · שלישי 20.10');
    const friday = await answer(MSG1, [...base, fact('fix', 'date')], `שישי 23.10.2026`);
    assert.deepEqual(answerEvents(friday.call).update, [{ ...EARLY_ROW, start_date: FRIDAY, end_date: FRIDAY, end_time: '13:15' }], 'שישי: אין לימודים, הסיום = היציאה');
  });

  test('"לא יודע" בתיקון: נשמר unknown, האירוע לא משתנה, אין בועה, והשאלה נסגרת', async () => {
    for (const [field, choice] of [['fix_time', 'time'], ['fix_date', 'date']]) {
      const { result, call } = await answer(MSG2, [...SAVED_EVENT, fact('confirm', 'no'), fact('fix', choice)], 'לא יודע');
      assert.equal(result.done, true, field);
      assert.deepEqual(factsJsonOf(call), [{ field, value: UNKNOWN_VALUE, origin: 'read' }]);
      const params = answerEvents(call);
      assert.deepEqual([params.update, params.cancel, params.fixBubble], [[], [], [null, null, null]]);
      assert.deepEqual(params.insert, [EVENT_ROW], 'רק ההכנסה האידמפוטנטית עם הערכים המקוריים');
    }
  });

  test('תשובה לא מפוענחת לתיקון (שעה לא תקינה): השאלה נשארת פתוחה ואין כתיבה', async () => {
    const { result, writes } = await answer(MSG2, [...SAVED_EVENT, fact('confirm', 'no'), fact('fix', 'time')], '25:00');
    assert.equal(result.status, 'unclear');
    assert.equal(writes.length, 0);
  });

  test('בועת התיקון: חריג לכלל "בועה אחת למקור", ומוגנת רק מפני בועה זהה לאותו מקור', async () => {
    const { call } = await answer(MSG2, [...SAVED_EVENT, fact('confirm', 'no'), fact('fix', 'time')], '17:30');
    assert.match(call.text, /fb AS \( INSERT INTO messages \([^)]*\) SELECT 'out', \?::text, 'update', now\(\), false, NULL::uuid, NULL::timestamptz, 'source', \?::uuid, NULL::integer FROM closed WHERE \?::text IS NOT NULL AND NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.direction = 'out' AND x\.kind = 'update' AND x\.entity_type = 'source' AND x\.entity_id = \?::uuid AND x\.body = \?::text\) RETURNING id \)/);
    // הבועה הרגילה (b) נשארת עם התנאי הישן: שום בועת update קודמת למקור.
    assert.match(call.text, /b AS \( INSERT INTO messages .*? AND NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.direction = 'out' AND x\.kind = 'update' AND x\.entity_type = 'source' AND x\.entity_id = \?::uuid\) RETURNING id \)/);
  });

  test('formatReply: "עודכן" ו"בוטל" באותו מבנה; פועל אחר נדחה', () => {
    assert.equal(formatReply({ type: 'personal_event', title: 'בדיקה רפואית', date: MONDAY, verb: 'עודכן' }), 'עודכן · אירוע אישי · בדיקה רפואית · שני 19.10');
    assert.equal(formatReply({ type: 'early_leave', date: MONDAY, verb: 'בוטל' }), 'בוטל · יציאה מוקדמת · שני 19.10');
    assert.equal(formatReply({ type: 'early_leave', date: MONDAY }), 'נרשם · יציאה מוקדמת · שני 19.10');
    assert.throws(() => formatReply({ type: 'early_leave', date: MONDAY, verb: 'נמחק' }), RangeError);
  });
});

// ---------------------------------------------------------------------------
describe('8.3-3: מקור ישן עם confirm=no לא מקבל שאלה חדשה', () => {
  const OLD = [...SAVED_EARLY, fact('confirm', 'no')];

  test('הממתינים נגזרים רק משורות messages פתוחות: בלי שאלה פתוחה אין פריט, גם כשהעובדות של המקור מסתיימות ב-confirm=no', async () => {
    assert.deepEqual(pendingFromRows({ questions: [], facts: OLD.map((row) => ({ source_id: SRC_ID, ...row })), timetable: TIMETABLE, today: MONDAY }), []);
    const sql = fakeSql((text) => (text.includes('FROM messages m') ? [] : OLD.map((row) => ({ source_id: SRC_ID, ...row }))));
    assert.deepEqual(await loadPending(sql, TIMETABLE, new Date(MONDAY_0830)), []);
    assert.equal(sql.find('FROM facts f').length, 0, 'אפילו העובדות לא נקראות');
  });

  test('שום מסלול כתיבה לא יוצר את "מה לא נכון?" בלי שאלה פתוחה: קליטה לא שואלת אותה, ושאלה סגורה לא נענית', async () => {
    const { call } = await intake(MSG1);
    assert.equal(call.values.includes('מה לא נכון?'), false);
    const sql = answerDb({ src: typedSource(MSG1), facts: OLD, awaiting: false });
    assert.equal((await answerQuestion({ sql, messageId: MSG_ID, answer: 'לא נכון', now: new Date(MONDAY_0830), timetable: TIMETABLE })).status, 'closed');
    assert.equal(writesOf(sql).length, 0);
  });
});

// ---------------------------------------------------------------------------
describe('8.3-3: שאלת שיעורי הבית אחרי תיקון (homework-absence)', () => {
  const rowsOf = (id, fields) => Object.entries(fields).flatMap(([field, value]) => (Array.isArray(value) ? value : [value]).map((v) => ({ source_id: id, field, value: v })));
  const leave = (date, time, extra = {}) => rowsOf('s1', { type: 'early_leave', date, time, ...extra });
  const missedSet = (rows, date) => sequencesForDate(TIMETABLE, date).filter((sequence) => decideAbsence({ rows, sequence, timetable: TIMETABLE }).missed).map((s) => s.startPeriod);
  const expectedSet = (date, time) => sequencesForDate(TIMETABLE, date).filter((s) => missedLessons(TIMETABLE, date, time).includes(s.endPeriod)).map((s) => s.startPeriod);

  for (const [name, date] of WEEK) {
    test(`${name} ${date}: fix_time קובע (התיקון הוא האמת); fix=cancel ו"לא נכון" בלי תיקון לא מסמנים`, () => {
      assert.deepEqual(missedSet(leave(date, '08:30', { confirm: 'no', fix: 'time', fix_time: '13:15' }), date), expectedSet(date, '13:15'));
      assert.deepEqual(missedSet(leave(date, '13:15', { confirm: 'no', fix: 'cancel' }), date), []);
      assert.deepEqual(missedSet(leave(date, '13:15', { confirm: 'no' }), date), [], 'לא נכון בלי תשובה');
      assert.deepEqual(missedSet(leave(date, '13:15', { confirm: 'no', fix: 'time', fix_time: UNKNOWN_VALUE }), date), [], '"לא יודע" אינו תיקון');
      assert.deepEqual(missedSet(leave(date, '13:15', { confirm: 'no', fix: 'time' }), date), [], 'בחר "השעה" ולא ענה');
    });
  }

  test('fix_date: נספר לתאריך החדש בלבד, לא למקורי (שני -> שלישי, ושלישי -> שני)', () => {
    const toTuesday = leave(MONDAY, '13:15', { confirm: 'no', fix: 'date', fix_date: '2026-10-20' });
    assert.deepEqual(missedSet(toTuesday, MONDAY), []);
    assert.deepEqual(missedSet(toTuesday, '2026-10-20'), expectedSet('2026-10-20', '13:15'));
    assert.ok(expectedSet('2026-10-20', '13:15').length > 0);
    const toMonday = leave('2026-10-20', '13:15', { confirm: 'no', fix: 'date', fix_date: MONDAY });
    assert.deepEqual(missedSet(toMonday, MONDAY), expectedSet(MONDAY, '13:15'));
    assert.deepEqual(missedSet(toMonday, '2026-10-20'), []);
  });

  test('דוגמה ביום שני: יציאה ב-13:15 תוקנה ל-15:00: מדעי המחשב (נגמר 13:25) כבר לא מפוספס, פיזיקה (15:45) כן', () => {
    const rows = leave(MONDAY, '13:15', { confirm: 'no', fix: 'time', fix_time: '15:00' });
    const subjects = sequencesForDate(TIMETABLE, MONDAY).filter((sequence) => decideAbsence({ rows, sequence, timetable: TIMETABLE }).missed).map((s) => s.subject);
    assert.ok(subjects.includes('פיזיקה'));
    assert.equal(subjects.includes('מדעי המחשב'), false);
    assert.ok(missedSet(leave(MONDAY, '13:15'), MONDAY).length > missedSet(rows, MONDAY).length, 'בלי התיקון היו יותר רצפים מסומנים');
  });

  test('בלי confirm=no, עובדות fix לא נחשבות (נשמרות רק אחריו); confirm=yes מסמן כרגיל; שישי: אין רצפים', () => {
    assert.deepEqual(missedSet(leave(MONDAY, '13:15', { confirm: 'yes' }), MONDAY), expectedSet(MONDAY, '13:15'));
    assert.deepEqual(sequencesForDate(TIMETABLE, FRIDAY), []);
  });

  test('loadAbsenceRows: מוצא מקורות לפי date או fix_date, קריאה בלבד, התאריך כפרמטר', async () => {
    const sql = fakeSql(() => []);
    await loadAbsenceRows(sql, MONDAY);
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /JOIN facts d ON d\.source_id = t\.source_id AND d\.field IN \('date', 'fix_date'\) AND d\.value = \?::text/);
    assert.doesNotMatch(sql.calls[0].text, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    assert.deepEqual(sql.calls[0].values, [MONDAY]);
  });
});
