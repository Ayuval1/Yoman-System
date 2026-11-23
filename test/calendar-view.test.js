// בלוק 7 חלק א'-1: נתוני היומן לאפליקציה (lib/calendar-view.js). כל הנתונים מומצאים; בלי מסד אמיתי.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCalendar } from '../lib/calendar-view.js';
import { fakeSql } from './helpers.js';

const NOW = new Date('2026-11-22T08:00:00Z');
// 2026-11-22 = יום ראשון (weekday 1 במערכת השעות)
const TIMETABLE = { slots: [
  { weekday: 1, period: 1, startsAt: '08:15', endsAt: '09:00', subject: 'מתמטיקה', teacher: 'מורה', room: '12' },
  { weekday: 1, period: 2, startsAt: '09:05', endsAt: '09:50', subject: 'אנגלית', teacher: null, room: null },
  { weekday: 1, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה', teacher: null, room: null },
] };
const NO_VACATION = [];

function sqlWith({ events = [], questions = [], answers = [], changes = [] } = {}) {
  return fakeSql((text) => {
    if (text.includes('FROM events')) return events;
    if (text.includes('FROM exam_asks')) return answers;
    if (text.includes("m.field = 'match'")) return changes;
    if (text.includes('FROM messages')) return questions;
    return [];
  });
}
const run = (options = {}, sqlOptions = {}) => loadCalendar({ sql: sqlWith(sqlOptions), timetable: TIMETABLE, from: '2026-11-22', days: 1, now: NOW, vacations: NO_VACATION, exams: [], ...options });

describe('calendar-view: שיעורים והפסקות', () => {
  test('שיעורים ובלוק הפסקה בין שיעורים, בלי הפסקה בין שיעורים רצופים', async () => {
    const out = await run();
    assert.equal(out.from, '2026-11-22');
    assert.equal(out.days.length, 1);
    const day = out.days[0];
    assert.equal(day.date, '2026-11-22');
    assert.equal(day.weekday, 0);
    assert.deepEqual(day.items.map((i) => i.kind), ['lesson', 'break', 'lesson', 'break', 'lesson']);
    assert.equal(day.items[0].title, 'מתמטיקה');
    assert.equal(day.items[0].subject, 'מתמטיקה');
    assert.equal(day.items[0].room, '12');
    assert.equal(day.items[0].start, '2026-11-22T06:15:00.000Z'); // חורף: UTC+2
    assert.equal(day.items[0].end, '2026-11-22T07:00:00.000Z');
    assert.equal(day.items[1].start, day.items[0].end);
    assert.equal(day.items[1].end, day.items[2].start);
    assert.equal(day.items[0].pending, false);
  });
  test('חופשה: בלי שיעורים והפסקות', async () => {
    const out = await run({ vacations: [{ from: '2026-11-20', to: '2026-11-25' }] });
    assert.deepEqual(out.days[0].items, []);
  });
  test('שעון קיץ: השעה בשעון ישראל נשמרת (אפריל, UTC+3)', async () => {
    const out = await run({ from: '2027-04-04' });
    assert.equal(out.days[0].items[0].start, '2027-04-04T05:15:00.000Z');
  });
});

describe('calendar-view: מבחנים', () => {
  const exams = [
    { date: '2026-11-22', type: 'מבחן', subject: 'מתמטיקה', makeup: false },
    { date: '2026-11-22', type: 'מבדק', subject: 'היסטוריה', makeup: false },
    { date: '2026-11-22', type: 'מועד ב\'', subject: null, makeup: true },
    { date: '2026-11-22', type: 'מבחן', subject: 'מדעים', makeup: false },
  ];
  test('מבחן בשעת השיעור, מבדק = quiz, מועד ב מוצג עם makeup (פער 3), מדעים בלי שעה = יום שלם וראשון', async () => {
    const out = await run({ exams });
    const items = out.days[0].items.filter((i) => i.kind === 'exam' && i.makeup !== true);
    assert.equal(items.length, 3);
    assert.equal(items[0].start, null);
    assert.equal(items[0].subject, 'מדעים');
    assert.equal(out.days[0].items[0].kind, 'exam', 'יום שלם ראשון');
    const math = items.find((i) => i.subject === 'מתמטיקה');
    assert.equal(math.start, '2026-11-22T06:15:00.000Z');
    assert.equal(math.end, '2026-11-22T07:00:00.000Z');
    assert.equal(math.quiz, false);
    assert.equal(items.find((i) => i.subject === 'היסטוריה').quiz, true);
  });
  test('מבחן שנדחה: מוצג במועד החדש', async () => {
    const changes = [{ link: 'exam:2026-11-22:מתמטיקה', type: 'move', new_date: '2026-11-24' }];
    const out = await run({ exams, days: 3 }, { changes });
    assert.equal(out.days[0].items.some((i) => i.subject === 'מתמטיקה' && i.kind === 'exam'), false);
    assert.equal(out.days[2].items.some((i) => i.subject === 'מתמטיקה' && i.kind === 'exam'), true);
  });
});

describe('calendar-view: אירועים', () => {
  const ev = (over) => ({ id: 'e1', title: 'ארוחה', starts_at: '2026-11-22T16:00:00Z', ends_at: '2026-11-22T17:00:00Z', domain: 'personal', match_key: null, ...over });
  test('אירוע, אימון, ו"לא זמין" מסונן; ממוין לפי שעה', async () => {
    const events = [ev({ id: 'e2', title: 'אימון ריצה', domain: 'running', starts_at: '2026-11-22T15:00:00Z' }), ev({ id: 'e3', title: 'חלון', domain: 'unavailable' }), ev({})];
    const out = await run({ timetable: null }, { events });
    assert.deepEqual(out.days[0].items.map((i) => [i.kind, i.title]), [['training', 'אימון ריצה'], ['event', 'ארוחה']]);
    assert.equal(out.days[0].items[1].domain, 'personal');
    assert.equal(out.days[0].items[1].start, '2026-11-22T16:00:00.000Z');
  });
  test('אירוע עם שאלה פתוחה על המקור = pending', async () => {
    const events = [ev({ match_key: 'source:11111111-1111-4111-8111-111111111111' }), ev({ id: 'e9', title: 'אחר', match_key: 'source:22222222-2222-4222-8222-222222222222' }),
      ev({ id: 'e10', title: 'אימון ריצה', domain: 'running', match_key: 'source:11111111-1111-4111-8111-111111111111:fitness:2026-11-22' })];
    const out = await run({ timetable: null }, { events, questions: [{ entity_id: '11111111-1111-4111-8111-111111111111' }] });
    const byTitle = Object.fromEntries(out.days[0].items.map((i) => [i.title, i.pending]));
    assert.deepEqual(byTitle, { ארוחה: true, אחר: false, 'אימון ריצה': true });
  });
  test('אירוע שמתחיל אחרי חצות שעון ישראל משויך ליום הישראלי', async () => {
    const events = [ev({ starts_at: '2026-11-22T22:30:00Z', ends_at: null })]; // 00:30 ב-23.11
    const out = await run({ timetable: null, days: 2 }, { events });
    assert.equal(out.days[0].items.length, 0);
    assert.equal(out.days[1].items[0].end, null);
  });
  test('פרטיות: בלי raw_content בשאילתות', async () => {
    const sql = sqlWith({});
    await loadCalendar({ sql, timetable: TIMETABLE, from: '2026-11-22', days: 1, now: NOW, vacations: [], exams: [] });
    assert.ok(sql.calls.every((c) => !c.text.includes('raw_content')));
  });
});

describe('calendar-view: חודש בלי לוח מבחנים', () => {
  const exams = [{ date: '2026-12-24', type: 'מבחן', subject: 'מתמטיקה', makeup: false }];
  test('חודש שמתחיל אחרי סוף הלוח = לא ידוע (וגם שורת החודש החלקי, ראו למטה)', async () => {
    const out = await run({ from: '2026-12-01', days: 42, exams });
    assert.deepEqual(out.unknownExams.map((u) => u.month), ['2026-12', '2027-01']);
    assert.equal(out.unknownExams[1].text, 'מבחנים בינואר — לא ידוע');
    assert.equal(out.unknownExams[1].coverageEnd, '2026-12-24');
  });
  test('כל הטווח מכוסה = ריק', async () => {
    assert.deepEqual((await run({ from: '2026-12-01', days: 20, exams })).unknownExams, []);
  });
});

describe('calendar-view: פערים (חודש חלקי, אירוע רב-יומי, מועד ב\')', () => {
  test('חודש שהלוח מכסה חלקית = "מבחנים מ-<יום אחרי> — לא ידוע"', async () => {
    const exams = [{ date: '2026-12-24', type: 'מבחן', subject: 'מתמטיקה', makeup: false }, { date: '2026-12-30', type: 'מועד ב\'', subject: null, makeup: true }];
    const out = await run({ from: '2026-12-01', days: 42, exams });
    assert.deepEqual(out.unknownExams.map((u) => [u.month, u.text]), [['2026-12', 'מבחנים מ-25.12 — לא ידוע'], ['2027-01', 'מבחנים בינואר — לא ידוע']]);
    assert.equal(out.unknownExams[0].coverageEnd, '2026-12-24');
  });
  test('הלוח מסתיים בסוף החודש = אין שורה חלקית', async () => {
    const exams = [{ date: '2026-12-31', type: 'מבחן', subject: 'מתמטיקה', makeup: false }];
    assert.deepEqual((await run({ from: '2026-12-01', days: 31, exams })).unknownExams, []);
  });
  const ev = (over) => ({ id: 'e1', title: 'טיול', starts_at: '2026-11-22T10:00:00Z', ends_at: '2026-11-24T10:00:00Z', domain: 'personal', match_key: null, ...over });
  test('אירוע רב-יומי מופיע בכל יום שהוא מכסה', async () => {
    const out = await run({ timetable: null, days: 4 }, { events: [ev({})] });
    assert.deepEqual(out.days.map((d) => d.items.length), [1, 1, 1, 0]);
  });
  test('אירוע שהתחיל לפני from מופיע בטווח (והשאילתה היא חפיפה)', async () => {
    const sql = sqlWith({ events: [ev({ starts_at: '2026-11-20T10:00:00Z' })] });
    const out = await loadCalendar({ sql, timetable: null, from: '2026-11-22', days: 2, now: NOW, vacations: [], exams: [] });
    assert.deepEqual(out.days.map((d) => d.items.length), [1, 1]);
    const text = sql.find('FROM events')[0].text;
    assert.ok(text.includes('e.starts_at < ') && text.includes('COALESCE(e.ends_at, e.starts_at)'));
  });
  test('אירוע שנגמר בדיוק ב-00:00 מקומי לא מופיע ביום הבא', async () => {
    const out = await run({ timetable: null, days: 2 }, { events: [ev({ starts_at: '2026-11-22T10:00:00Z', ends_at: '2026-11-22T22:00:00Z' })] });
    assert.deepEqual(out.days.map((d) => d.items.length), [1, 0]);
  });
  test('אירוע בלי שעת סיום או באורך אפס מופיע ביום שלו בלבד', async () => {
    const out = await run({ timetable: null, days: 2 }, { events: [ev({ id: 'a', ends_at: null }), ev({ id: 'b', ends_at: '2026-11-22T10:00:00Z' })] });
    assert.deepEqual(out.days.map((d) => d.items.length), [2, 0]);
  });
  test('מועד ב\' מוצג עם makeup: true, ולא משפיע על coverageEnd', async () => {
    const exams = [{ date: '2026-11-22', type: 'מבחן', subject: 'מתמטיקה', makeup: false }, { date: '2026-11-22', type: 'מועד ב\'', subject: null, makeup: true }];
    const out = await run({ exams });
    const items = out.days[0].items.filter((i) => i.kind === 'exam');
    assert.equal(items.length, 2);
    assert.equal(items.filter((i) => i.makeup === true).length, 1);
    assert.equal(items.find((i) => i.makeup).title, 'מועד ב\'');
    assert.equal(items.find((i) => !i.makeup).makeup, undefined);
  });
});

describe('calendar-view: קלט לא תקין', () => {
  for (const [name, options] of [['days 0', { days: 0 }], ['days 43', { days: 43 }], ['days שבר', { days: 1.5 }], ['days טקסט', { days: '3' }], ['from פגום', { from: '2026-13-01' }], ['from חסר', { from: undefined }]]) {
    test(name, async () => { await assert.rejects(run(options), RangeError); });
  }
});
