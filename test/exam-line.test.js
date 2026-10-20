// בדיקות ל-lib/exam-line.js (שלב B-1, docs/08-chapter8/68, D13-D15, H14) ולקובץ data/school-exams.json. מערכת השעות והמבחנים מהקבצים האמיתיים, ובנוסף מערכות שעות קטנות מומצאות.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examsOnDate, examsToday, examsTomorrow, examTime, EXAMS } from '../lib/exam-line.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const slot = (weekday, startsAt, endsAt, subject) => ({ weekday, period: 1, startsAt, endsAt, subject, teacher: null, room: null });

describe('exam-line: קובץ המבחנים', () => {
  test('26 שורות: 24 מהלוח ו-2 של עמ"ט; שורות "מועד ב\'" נשמרות עם דגל makeup', () => {
    assert.equal(EXAMS.length, 26);
    assert.equal(EXAMS.filter((exam) => exam.makeup === true).length, 5);
    assert.deepEqual(EXAMS.filter((exam) => exam.owner === 'amat').map((exam) => [exam.date, exam.subject]), [['2026-11-02', 'פיזיקה'], ['2026-12-24', 'מדעי המחשב']]);
  });
});

describe('exam-line: שורת מבחן ושעה (H14)', () => {
  test('26.10.2026 מבחן במתמטיקה: שעה = תחילת השיעור הראשון של מתמטיקה באותו יום (ב-10:05)', () => {
    assert.deepEqual(examsToday('2026-10-26', { timetable: TIMETABLE }).map((exam) => exam.text), ['מבחן במתמטיקה ב-10:05']);
  });
  test('בלי שיעור של המקצוע באותו יום: בלי שעה (18.11 תנ"ך, יום רביעי)', () => {
    const [exam] = examsToday('2026-11-18', { timetable: TIMETABLE });
    assert.equal(exam.time, null);
    assert.equal(exam.text, 'מבחן בתנ"ך');
  });
  test('מערכת שעות חסרה: השורה בלי שעה', () => assert.equal(examsToday('2026-10-26', { timetable: null })[0].text, 'מבחן במתמטיקה'));
  test('הסוג כפי שכתוב בקובץ: מבדק, אנסין, מבחן', () => {
    assert.equal(examsToday('2026-10-12', { timetable: null })[0].text, 'מבדק בתנ"ך');
    assert.equal(examsToday('2026-11-16', { timetable: null })[0].text, 'אנסין באנגלית');
    assert.equal(examsToday('2026-10-26', { timetable: null })[0].type, 'מבחן');
  });
  test('"מדעים" בלי פירוט: "<סוג> במדעים" בלי שעה, גם כשיש פיזיקה בלוח באותו יום (20.10 מבדק, 1.12 מבחן)', () => {
    assert.equal(examsToday('2026-10-20', { timetable: TIMETABLE })[0].text, 'מבדק במדעים');
    assert.equal(examsToday('2026-12-01', { timetable: TIMETABLE })[0].text, 'מבחן במדעים');
    const withPhysics = { slots: [slot(3, '10:00', '10:45', 'פיזיקה')] };
    assert.equal(examTime({ dateIso: '2026-10-20', subject: 'מדעים', timetable: withPhysics }), null);
  });
  test('עמ"ט תמיד של יובל: 2.11 פיזיקה ו-24.12 מדעי המחשב מוצגים, עם שעה כשיש שיעור', () => {
    assert.equal(examsToday('2026-11-02', { timetable: TIMETABLE })[0].text, 'מבחן בפיזיקה ב-13:30');
    assert.equal(examsToday('2026-12-24', { timetable: TIMETABLE })[0].subject, 'מדעי המחשב');
  });
  test('"מועד ב\'" אינו מוצג: 21.10, 10.11, 23.11, 14.12, 23.12', () => {
    for (const date of ['2026-10-21', '2026-11-10', '2026-11-23', '2026-12-14', '2026-12-23']) assert.deepEqual(examsToday(date, { timetable: TIMETABLE }), [], date);
  });
  test('יום בלי מבחן: מערך ריק', () => assert.deepEqual(examsToday('2026-10-27', { timetable: TIMETABLE }), []));
  test('מבחן למחר: examsTomorrow מקבל את התאריך של היום (25.10 -> מבחן ב-26.10)', () => {
    assert.equal(examsTomorrow('2026-10-25', { timetable: TIMETABLE })[0].text, 'מבחן במתמטיקה ב-10:05');
    assert.deepEqual(examsToday('2026-10-25', { timetable: TIMETABLE }), []);
  });
  test('מבחן למחר חוצה גבול חודש: 30.11 -> 1.12 (מדעים)', () => assert.equal(examsTomorrow('2026-11-30', { timetable: null })[0].text, 'מבחן במדעים'));
  test('השורה ממשיכה אחרי 29.10 ובדצמבר (קריטריון 7 בסגירה): 21.12 אזרחות', () => assert.equal(examsToday('2026-12-21', { timetable: null })[0].text, 'מבחן באזרחות'));
});

describe('exam-line: התאמת מקצוע (H14)', () => {
  const MONDAY = '2026-10-26';
  test('זהה', () => assert.equal(examTime({ dateIso: MONDAY, subject: 'מתמטיקה', timetable: { slots: [slot(2, '09:05', '09:50', 'מתמטיקה')] } }), '09:05'));
  test('מקצוע-בן: מתמטיקה מתאימה לגיאומטריה', () => assert.equal(examTime({ dateIso: MONDAY, subject: 'מתמטיקה', timetable: { slots: [slot(2, '10:55', '11:40', 'גיאומטריה')] } }), '10:55'));
  test('"(תרגול)": מתמטיקה מתאימה ל"מתמטיקה (תרגול)"', () => assert.equal(examTime({ dateIso: MONDAY, subject: 'מתמטיקה', timetable: { slots: [slot(2, '11:50', '12:35', 'מתמטיקה (תרגול)')] } }), '11:50'));
  test('התאמות מרובות: ההתחלה המוקדמת ביותר, בלי תלות בסדר הקלט', () => {
    const slots = [slot(2, '12:40', '13:25', 'גיאומטריה'), slot(2, '09:05', '09:50', 'מתמטיקה (תרגול)'), slot(2, '10:05', '10:50', 'מתמטיקה')];
    assert.equal(examTime({ dateIso: MONDAY, subject: 'מתמטיקה', timetable: { slots } }), '09:05');
  });
  test('שיעור של מקצוע אחר, או של אותו מקצוע ביום אחר: אין התאמה', () => {
    assert.equal(examTime({ dateIso: MONDAY, subject: 'מתמטיקה', timetable: { slots: [slot(2, '09:05', '09:50', 'אנגלית'), slot(3, '08:15', '09:00', 'מתמטיקה')] } }), null);
  });
  test('מבחן מוזרק: examsOnDate משתמש ברשימה שהועברה, ומסנן מועד ב\'', () => {
    const exams = [{ date: MONDAY, type: 'מבחן', subject: 'פיזיקה', makeup: false }, { date: MONDAY, type: "מועד ב'", subject: null, makeup: true }];
    assert.deepEqual(examsOnDate(MONDAY, { timetable: TIMETABLE, exams }).map((exam) => exam.text), ['מבחן בפיזיקה ב-13:30']);
  });
});
