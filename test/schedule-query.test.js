// בדיקות לשאלה חופשית על הלוח ("מה יש לי מחר?", "מתי המבחן בהיסטוריה?"): המוח מזהה (kind schedule_query) ומעתיק ביטויים,
// הקוד מחשב תאריכים, טוען את הלוח ועונה בבועה. קריאה בלבד: אין כתיבה ליומן. בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { BRAIN_KINDS, buildPrompt, isValidUnderstanding } from '../lib/intake-brain.js';
import { scheduleQueryPlan, answerScheduleQuery } from '../lib/show-request.js';
import { processSource } from '../lib/intake-process.js';

const SRC_ID = '44444444-4444-4444-8444-444444444444';
const MONDAY = new Date('2026-11-23T07:00:00.000Z'); // שני 23.11, 09:00 בישראל
const EXAMS = [
  { date: '2026-11-26', type: 'מבחן', subject: 'היסטוריה', makeup: false },
  { date: '2026-12-10', type: 'מבדק', subject: 'היסטוריה', makeup: false },
  { date: '2026-11-25', type: 'מבחן', subject: 'מתמטיקה', makeup: false },
];
const base = { subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, end_date_text: null, uncertain: [] };
const q = (over) => ({ ...base, kind: 'schedule_query', ...over });
const src = (text, channel = 'app') => ({ id: SRC_ID, channel, raw_content: text, content_hash: 'h', received_at: MONDAY });
const answerSql = () => fakeSql((text) => (text.includes('schedule-query') || text.includes('show-request') ? [{ claimed: 1 }] : []));

describe('schedule-query: המוח', () => {
  test('הסוג ברשימה הסגורה ובפרומפט, והבדיקה מקבלת אותו (ביטוי שלא בהודעה נפסל)', () => {
    assert.ok(BRAIN_KINDS.includes('schedule_query'));
    assert.match(buildPrompt({ text: 'x' }), /schedule_query: /);
    assert.equal(isValidUnderstanding(q({ date_text: 'מחר' }), 'מה יש לי מחר?'), true);
    assert.equal(isValidUnderstanding(q({ date_text: 'מחרתיים' }), 'מה יש לי מחר?'), false);
  });
});

describe('schedule-query: מה לטעון (טהור)', () => {
  test('יום אחד: "מחר"', () => {
    assert.deepEqual(scheduleQueryPlan({ understanding: q({ date_text: 'מחר' }), text: 'מה יש לי מחר?', receivedAt: MONDAY }), { mode: 'days', from: '2026-11-24', days: 1 });
  });
  test('טווח: "מחמישי עד שבת" (סוף מהמוח), עד 14 ימים', () => {
    assert.deepEqual(scheduleQueryPlan({ understanding: q({ date_text: 'חמישי', end_date_text: 'שבת' }), text: 'מה יש לי מחמישי עד שבת?', receivedAt: MONDAY }), { mode: 'days', from: '2026-11-26', days: 3 });
    const far = scheduleQueryPlan({ understanding: q({ date_text: 'מחר', end_date_text: '30.12' }), text: 'מה יש לי ממחר עד 30.12', receivedAt: MONDAY });
    assert.equal(far.days, 14);
  });
  test('בלי תאריך: "השבוע" = 7 ימים מהיום, "שבוע הבא" = מיום ראשון הבא', () => {
    assert.deepEqual(scheduleQueryPlan({ understanding: q({}), text: 'מה יש לי השבוע?', receivedAt: MONDAY }), { mode: 'days', from: '2026-11-23', days: 7 });
    assert.deepEqual(scheduleQueryPlan({ understanding: q({}), text: 'מה יש לי שבוע הבא?', receivedAt: MONDAY }), { mode: 'days', from: '2026-11-29', days: 7 });
  });
  test('מקצוע בלי תאריך: מבחנים במקצוע', () => {
    assert.deepEqual(scheduleQueryPlan({ understanding: q({ subject: 'היסטוריה' }), text: 'מתי המבחן בהיסטוריה?', receivedAt: MONDAY }), { mode: 'exams', subject: 'היסטוריה', from: '2026-11-23', days: 42 });
  });
});

describe('schedule-query: התשובה', () => {
  test('"מתי המבחן בהיסטוריה?": רק מבחנים בהיסטוריה, בבועה אחת', async () => {
    const sql = answerSql();
    const out = await answerScheduleQuery({ sql, source: src('מתי המבחן בהיסטוריה?'), understanding: q({ subject: 'היסטוריה' }), timetable: null, exams: EXAMS, now: MONDAY });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^מבחנים בהיסטוריה:/);
    assert.match(out.reply, /חמישי 26\.11/);
    assert.match(out.reply, /10\.12/);
    assert.doesNotMatch(out.reply, /מתמטיקה/);
    assert.equal(sql.find('INSERT INTO events').length, 0);
  });
  test('מקצוע בלי מבחן קרוב: נאמר במפורש', async () => {
    const out = await answerScheduleQuery({ sql: answerSql(), source: src('מתי המבחן בערבית?'), understanding: q({ subject: 'ערבית' }), timetable: null, exams: EXAMS, now: MONDAY });
    assert.match(out.reply, /לא מצאתי מבחן בערבית ב-42 הימים הקרובים/);
  });
  test('"מה יש לי מחר?": כותרת "מחר" ושורת יום', async () => {
    const out = await answerScheduleQuery({ sql: answerSql(), source: src('מה יש לי מחר?'), understanding: q({ date_text: 'מחר' }), timetable: null, exams: EXAMS, now: MONDAY });
    assert.match(out.reply, /^מחר \(שלישי 24\.11\):/);
  });
  test('"מה יש לי ביום רביעי?": המבחן במתמטיקה מופיע', async () => {
    const out = await answerScheduleQuery({ sql: answerSql(), source: src('מה יש לי ביום רביעי?'), understanding: q({ date_text: 'ביום רביעי' }), timetable: null, exams: EXAMS, now: MONDAY });
    assert.match(out.reply, /מבחן במתמטיקה/);
  });
});

describe('schedule-query: בצינור', () => {
  test('מוקלד: המוח אומר schedule_query, נענה בבועה, status recorded', async () => {
    const sql = fakeSql((text) => (text.includes('schedule-query') ? [{ claimed: 1 }] : []));
    const out = await processSource({ sql, source: src('מה יש לי מחר?'), timetable: null, understand: async () => ({ ok: true, model: 'm', understanding: q({ date_text: 'מחר' }) }) });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^מחר/);
    assert.equal(sql.find('schedule-query').length, 1);
  });
  test('אותה שאלה שוב באותו יום: נענית שוב (לא "כבר קיבלתי"), כי הלוח משתנה', async () => {
    const sql = fakeSql((text) => (text.includes('schedule-query') ? [{ claimed: 1 }] : text.includes('JOIN sources p') ? [{ found: 1 }] : []));
    const out = await processSource({ sql, source: src('מה יש לי מחר?'), timetable: null, understand: async () => ({ ok: true, model: 'm', understanding: q({ date_text: 'מחר' }) }) });
    assert.equal(out.status, 'recorded');
    assert.equal(sql.find('schedule-query').length, 1);
  });
  test('מועבר (קיצור): שאלה של מישהו אחר, לא נענית', async () => {
    const sql = fakeSql(() => []);
    const out = await processSource({ sql, source: src('מה יש לי מחר?', 'shortcut'), timetable: null, understand: async () => ({ ok: true, model: 'm', understanding: q({ date_text: 'מחר' }) }) });
    assert.equal(sql.find('schedule-query').length, 0);
    assert.notEqual(out.status, 'recorded');
  });
});
