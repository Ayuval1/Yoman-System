// בדיקות לשלב 8.6-1 (docs/08-chapter8/60-chapter8-step-8-6-spec.md): lib/homework-schedule.js, zonedToUtc ב-lib/schedule-time.js,
// מפתח ההודעה ב-lib/message-slots.js, ותזמון שאלות שיעורי הבית ב-lib/ops/cron-plan.js. "קריטריון N" = קריטריון הקבלה N בטבלה של 60.
// בלי רשת ובלי מסד. מערכת השעות נקראת מהקובץ האמיתי data/school-timetable-taf-shin-pe-zayin.md (כמו test/timetable.test.js), והערכים המצופים מוקלדים כאן ידנית.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { zonedToUtc } from '../lib/schedule-time.js';
import {
  EXEMPT_SUBJECTS, isExempt, sequencesOfWeekday, sequencesForDate, sequenceFromKey, parseHomeworkKey, slotKeyOf, nextLesson, homeworkButtons, expiresAtFor,
} from '../lib/homework-schedule.js';
import { parseSlotMessage, planHomework, planSlot } from '../lib/message-slots.js';
import { handle as cronHandle, HOMEWORK_ASKS_ENABLED } from '../lib/ops/cron-plan.js';
import { fakeSql, captureConsole, req, FAKE_CRON } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const slot = (weekday, period, subject, startsAt = '08:00', endsAt = '08:45') => ({ weekday, period, startsAt, endsAt, subject, teacher: null, room: null });

// ---------------------------------------------------------------------------
// קריטריון 1: בדיוק 26 השאלות והשעות שבטבלה ב-docs/02-rules/03-intake-rules.md (שורות 312-316). המערך מוקלד ידנית.
// שבוע 18.10.2026 (ראשון) עד 22.10.2026 (חמישי), לפני מעבר השעון: שעת קיר מקומית. day: 1=ראשון. periods: [שיעור ראשון, אחרון].
// ---------------------------------------------------------------------------
const WEEK_START = '2026-10-18';
const WEEK_DATES = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'];
const EXPECTED_26 = [
  // ראשון: 09:53 · 10:53 · 11:43 · 13:28 · 14:18 (שיח אישי פטור)
  { day: 1, subject: 'היסטוריה', periods: [2, 2], time: '09:53' },
  { day: 1, subject: 'עברית', periods: [3, 3], time: '10:53' },
  { day: 1, subject: 'תנ"ך', periods: [4, 4], time: '11:43' },
  { day: 1, subject: 'אנגלית', periods: [5, 6], time: '13:28' },
  { day: 1, subject: 'מתמטיקה', periods: [7, 7], time: '14:18' },
  // שני: 09:03 · 09:53 · 11:43 · 12:38 · 13:28 · 15:48
  { day: 2, subject: 'תנ"ך', periods: [1, 1], time: '09:03' },
  { day: 2, subject: 'ספרות', periods: [2, 2], time: '09:53' },
  { day: 2, subject: 'מתמטיקה', periods: [3, 4], time: '11:43' },
  { day: 2, subject: 'אנגלית', periods: [5, 5], time: '12:38' },
  { day: 2, subject: 'מדעי המחשב', periods: [6, 6], time: '13:28' },
  { day: 2, subject: 'פיזיקה', periods: [7, 9], time: '15:48' },
  // שלישי: 09:53 · 11:43 · 13:28 · 14:18 (כישורי חיים וחנ"ג פטורים)
  { day: 3, subject: 'אזרחות', periods: [1, 2], time: '09:53' },
  { day: 3, subject: 'ספרות', periods: [4, 4], time: '11:43' },
  { day: 3, subject: 'ערבית', periods: [6, 6], time: '13:28' },
  { day: 3, subject: 'היסטוריה', periods: [7, 7], time: '14:18' },
  // רביעי: 09:53 · 10:53 · 11:43 · 14:18 · 15:48 (חנ"ג פטור)
  { day: 4, subject: 'כימיה', periods: [1, 2], time: '09:53' },
  { day: 4, subject: 'ערבית', periods: [3, 3], time: '10:53' },
  { day: 4, subject: 'אנגלית', periods: [4, 4], time: '11:43' },
  { day: 4, subject: 'עברית', periods: [6, 7], time: '14:18' },
  { day: 4, subject: 'מתמטיקה (תרגול)', periods: [8, 9], time: '15:48' },
  // חמישי: 09:53 · 11:43 · 12:38 · 13:28 · 14:18 · 15:48
  { day: 5, subject: 'גיאומטריה', periods: [1, 2], time: '09:53' },
  { day: 5, subject: 'תחומי בחירה', periods: [3, 4], time: '11:43' },
  { day: 5, subject: 'חינוך פיננסי', periods: [5, 5], time: '12:38' },
  { day: 5, subject: 'ערבית', periods: [6, 6], time: '13:28' },
  { day: 5, subject: 'מדעי המחשב', periods: [7, 7], time: '14:18' },
  { day: 5, subject: 'כימיה', periods: [8, 9], time: '15:48' },
];

describe('homework-schedule: קריטריון 1, 26 השאלות בשבוע', () => {
  const weekly = WEEK_DATES.flatMap((date) => sequencesForDate(TIMETABLE, date));

  test('בדיוק 26 רצפים, והמקצוע, השיעורים והשעה המקומית שווים למערך המוקלד', () => {
    assert.equal(EXPECTED_26.length, 26);
    assert.equal(weekly.length, 26);
    const actual = weekly.map((s) => ({ day: s.weekday, subject: s.subject, periods: [s.startPeriod, s.endPeriod], time: s.askTimeLocal }));
    assert.deepEqual(actual, EXPECTED_26);
  });

  test('לפני הפטורים יש 30 רצפים: ארבעת הפטורים (שיח אישי, כישורי חיים, חנ"ג פעמיים) הם ההפרש', () => {
    const raw = [1, 2, 3, 4, 5].flatMap((weekday) => sequencesOfWeekday(TIMETABLE, weekday));
    assert.equal(raw.length, 30);
    const removed = raw.filter((s) => !weekly.some((w) => w.weekday === s.weekday && w.startPeriod === s.startPeriod)).map((s) => `${s.weekday}:${s.subject}`);
    assert.deepEqual(removed, ['1:שיח אישי', '3:כישורי חיים', '3:חנ"ג', '4:חנ"ג']);
  });

  test('קובץ הפטורים: בדיוק שלושת הפטורים, ותחומי בחירה אינו פטור', () => {
    assert.deepEqual([...EXEMPT_SUBJECTS], ['חנ"ג', 'כישורי חיים', 'שיח אישי']);
    assert.equal(isExempt('תחומי בחירה'), false);
    assert.ok(weekly.some((s) => s.subject === 'תחומי בחירה'), 'תחומי בחירה נשאל');
    for (const name of ['חנ"ג', 'חנ״ג', 'כישורי חיים', 'שיח אישי', ' שיח אישי ']) assert.equal(isExempt(name), true, name);
    for (const name of ['חינוך פיננסי', 'מתמטיקה', 'גיאומטריה', '']) assert.equal(isExempt(name), false, name);
    assert.ok(weekly.every((s) => !EXEMPT_SUBJECTS.includes(s.subject)));
  });

  test('רשימת פטורים אחרת מועברת כפרמטר (הפטור אינו בקוד)', () => {
    const seq = sequencesForDate(TIMETABLE, '2026-10-18', { exempt: ['היסטוריה'] });
    assert.ok(!seq.some((s) => s.subject === 'היסטוריה'));
    assert.ok(seq.some((s) => s.subject === 'שיח אישי'), 'ברשימה החלופית שיח אישי אינו פטור');
  });

  test('מפתחות הרצפים: ASCII בלבד, בלי שם מקצוע, ייחודיים בשבוע', () => {
    const keys = weekly.map((s) => s.slotKey);
    assert.equal(new Set(keys).size, 26);
    for (const key of keys) assert.match(key, /^homework-2026-10-(18|19|20|21|22)-[1-9]$/);
    assert.equal(slotKeyOf('2026-10-22', 8), 'homework-2026-10-22-8');
  });

  test('יום שישי ושבת (בלי שיעורים): אין רצפים', () => {
    assert.deepEqual(sequencesForDate(TIMETABLE, '2026-10-23'), []);
    assert.deepEqual(sequencesForDate(TIMETABLE, '2026-10-24'), []);
  });
});

describe('homework-schedule: כללי הרצף', () => {
  test('אותו מקצוע במספרי שיעור רצופים הוא רצף אחד; פער במספרי השיעור שובר רצף; מקצוע אחר שובר רצף', () => {
    const table = { slots: [
      slot(1, 1, 'א', '08:15', '09:00'), slot(1, 2, 'א', '09:05', '09:50'), // רצף אחד
      slot(1, 4, 'א', '10:55', '11:40'), // אותו מקצוע אבל שיעור 3 חסר: רצף נפרד
      slot(1, 5, 'ב', '11:50', '12:35'), slot(1, 6, 'ג', '12:40', '13:25'), // שני מקצועות עוקבים: שני רצפים
    ] };
    const sequences = sequencesOfWeekday(table, 1);
    assert.deepEqual(sequences.map((s) => [s.subject, s.startPeriod, s.endPeriod, s.endsAt]), [['א', 1, 2, '09:50'], ['א', 4, 4, '11:40'], ['ב', 5, 5, '12:35'], ['ג', 6, 6, '13:25']]);
  });

  test('הפסקה ארוכה אינה שוברת רצף: פיזיקה 7-8-9 ביום שני (הפסקה של 15 דקות בין 7 ל-8) היא רצף אחד שנגמר ב-15:45', () => {
    const physics = sequencesOfWeekday(TIMETABLE, 2).find((s) => s.subject === 'פיזיקה');
    assert.deepEqual([physics.startPeriod, physics.endPeriod, physics.startsAt, physics.endsAt], [7, 9, '13:30', '15:45']);
  });

  test('שורות מסודרות לא לפי הסדר במערכת: הרצף נגזר לפי מספר שיעור', () => {
    const table = { slots: [slot(2, 2, 'א'), slot(2, 1, 'א')] };
    assert.deepEqual(sequencesOfWeekday(table, 2).map((s) => [s.startPeriod, s.endPeriod]), [[1, 2]]);
  });

  test('מערכת שעות חסרה או ריקה: אין רצפים ואין זריקה', () => {
    assert.deepEqual(sequencesForDate(null, '2026-10-18'), []);
    assert.deepEqual(sequencesForDate({ slots: [] }, '2026-10-18'), []);
  });
});

// ---------------------------------------------------------------------------
// קריטריון 2: מעבר שעון. סוף שיעור 09:50, שאלה ב-09:53 שעון ישראל. מעבר הקיץ-חורף בישראל: 25.10.2026.
// ---------------------------------------------------------------------------
describe('zonedToUtc: שעת קיר בתאריך נתון לרגע UTC (קריטריון 2)', () => {
  test('09:53 ב-22.10.2026 (UTC+3) = 06:53Z, וב-26.10.2026 אחרי המעבר (UTC+2) = 07:53Z', () => {
    assert.equal(zonedToUtc('2026-10-22', '09:53', 'Asia/Jerusalem').toISOString(), '2026-10-22T06:53:00.000Z');
    assert.equal(zonedToUtc('2026-10-26', '09:53', 'Asia/Jerusalem').toISOString(), '2026-10-26T07:53:00.000Z');
  });
  test('ברירת המחדל של האזור היא Asia/Jerusalem', () => {
    assert.equal(zonedToUtc('2026-10-22', '09:53').toISOString(), '2026-10-22T06:53:00.000Z');
  });
  test('יום המעבר עצמו (25.10.2026, 02:00 -> 01:00): 01:30 חוזרת פעמיים ונבחר המופע הראשון (UTC+3); 02:30 קיימת פעם אחת (UTC+2)', () => {
    assert.equal(zonedToUtc('2026-10-25', '01:30').toISOString(), '2026-10-24T22:30:00.000Z');
    assert.equal(zonedToUtc('2026-10-25', '02:30').toISOString(), '2026-10-25T00:30:00.000Z');
    assert.equal(zonedToUtc('2026-10-25', '08:15').toISOString(), '2026-10-25T06:15:00.000Z'); // תחילת שיעור 1 ביום המעבר: UTC+2
  });
  test('מעבר לשעון קיץ (27.3.2026, 02:00 -> 03:00): 02:30 לא קיימת ומקבלת את רגע המעבר (03:00 מקומי = 00:00Z)', () => {
    assert.equal(zonedToUtc('2026-03-27', '02:30').toISOString(), '2026-03-27T00:00:00.000Z');
  });
  test('קלט לא תקין זורק RangeError', () => {
    for (const [date, time] of [['2026-10-22', '9:53'], ['2026-10-22', '24:00'], ['2026-10-22', '09:60'], ['22.10.2026', '09:53'], ['2026-02-30', '09:53'], ['2026-13-01', '09:53'], [undefined, '09:53'], ['2026-10-22', undefined]]) {
      assert.throws(() => zonedToUtc(date, time), RangeError, `${date} ${time}`);
    }
    assert.throws(() => zonedToUtc('2026-10-22', '09:53', 'Not/AZone'), RangeError);
  });
});

describe('homework-schedule: שעת השאלה ב-UTC סביב מעבר השעון (קריטריון 2)', () => {
  // חמישי 22.10: גיאומטריה 1-2 נגמרת 09:50. שני 26.10 (אחרי המעבר): ספרות שיעור 2 נגמרת 09:50.
  test('חמישי 22.10.2026: גיאומטריה 1-2, הסוף 09:50, השאלה 09:53 שעון ישראל = 06:53Z', () => {
    const seq = sequencesForDate(TIMETABLE, '2026-10-22').find((s) => s.subject === 'גיאומטריה');
    assert.equal(seq.endsAt, '09:50');
    assert.equal(seq.askTimeLocal, '09:53');
    assert.equal(seq.endAt.toISOString(), '2026-10-22T06:50:00.000Z');
    assert.equal(seq.askAt.toISOString(), '2026-10-22T06:53:00.000Z');
  });
  test('שני 26.10.2026: ספרות שיעור 2, הסוף 09:50, השאלה 09:53 שעון ישראל = 07:53Z (שעה אחרי בגלל המעבר)', () => {
    const seq = sequencesForDate(TIMETABLE, '2026-10-26').find((s) => s.subject === 'ספרות');
    assert.equal(seq.askTimeLocal, '09:53');
    assert.equal(seq.askAt.toISOString(), '2026-10-26T07:53:00.000Z');
  });
  test('ראשון 25.10.2026 (יום המעבר עצמו): ההיסטוריה של שיעור 2 נשאלת 09:53 שעון ישראל = 07:53Z', () => {
    const seq = sequencesForDate(TIMETABLE, '2026-10-25').find((s) => s.subject === 'היסטוריה');
    assert.equal(seq.askAt.toISOString(), '2026-10-25T07:53:00.000Z');
  });
});

describe('homework-schedule: השיעור הבא של המקצוע (קריטריון 2, חישוב תאריכים)', () => {
  const next = (subject, lessonDate) => {
    const r = nextLesson(TIMETABLE, subject, lessonDate);
    return r && [r.date, r.startsAt, r.dueAt.toISOString()];
  };
  test('אותו שבוע: מתמטיקה ראשון 18.10 -> שני 19.10, תחילת שיעור 3 (10:05, UTC+3 = 07:05Z)', () => {
    assert.deepEqual(next('מתמטיקה', '2026-10-18'), ['2026-10-19', '10:05', '2026-10-19T07:05:00.000Z']);
  });
  test('עובר סוף שבוע: מדעי המחשב חמישי 22.10 -> שני 26.10, 12:40 אחרי המעבר (UTC+2 = 10:40Z); וממדעי המחשב ביום שני 19.10 -> חמישי 22.10, 13:30 (10:30Z)', () => {
    assert.deepEqual(next('מדעי המחשב', '2026-10-22'), ['2026-10-26', '12:40', '2026-10-26T10:40:00.000Z']);
    assert.deepEqual(next('מדעי המחשב', '2026-10-19'), ['2026-10-22', '13:30', '2026-10-22T10:30:00.000Z']);
  });
  test('מתמטיקה חמישי 22.10 ואפילו שישי 23.10 -> ראשון 25.10 (יום המעבר), 13:30 = 11:30Z', () => {
    assert.deepEqual(next('מתמטיקה', '2026-10-22'), ['2026-10-25', '13:30', '2026-10-25T11:30:00.000Z']);
    assert.deepEqual(next('מתמטיקה', '2026-10-23'), ['2026-10-25', '13:30', '2026-10-25T11:30:00.000Z']);
  });
  test('מקצוע עם שיעור אחד בשבוע: השיעור הבא הוא אותו יום בשבוע הבא (חינוך פיננסי חמישי 22.10 -> חמישי 29.10, 11:50 = 09:50Z)', () => {
    assert.deepEqual(next('חינוך פיננסי', '2026-10-22'), ['2026-10-29', '11:50', '2026-10-29T09:50:00.000Z']);
  });
  test('"הבא" אינו אותו יום: אזרחות שלישי 20.10 (רצף 1-2) -> שלישי 27.10, 08:15 = 06:15Z', () => {
    assert.deepEqual(next('אזרחות', '2026-10-20'), ['2026-10-27', '08:15', '2026-10-27T06:15:00.000Z']);
  });
  test('מקצוע שאינו במערכת, או מערכת ריקה/חסרה: null', () => {
    assert.equal(next('מקצוע שלא קיים', '2026-10-22'), null);
    assert.equal(nextLesson({ slots: [] }, 'מתמטיקה', '2026-10-22'), null);
    assert.equal(nextLesson(null, 'מתמטיקה', '2026-10-22'), null);
  });
  test('התאמת המקצוע מדויקת: "מתמטיקה" ו"מתמטיקה (תרגול)" הם מקצועות נפרדים', () => {
    assert.deepEqual(next('מתמטיקה (תרגול)', '2026-10-21'), ['2026-10-28', '14:30', '2026-10-28T12:30:00.000Z']);
  });
});

describe('homework-schedule: כפתורי התאריך (כפתור יחיד) ופקיעה', () => {
  test('כפתור "next" יחיד עם תאריך השיעור הבא, מחושב מ-lesson_date ולא מרגע התשובה', () => {
    assert.deepEqual(homeworkButtons({ timetable: TIMETABLE, subject: 'מתמטיקה', lessonDate: '2026-10-18', today: '2026-10-18' }), [{ due: 'next', date: '2026-10-19' }]);
    assert.deepEqual(homeworkButtons({ timetable: TIMETABLE, subject: 'מתמטיקה', lessonDate: '2026-10-18', today: '2026-10-19' }), [{ due: 'next', date: '2026-10-19' }], 'באותו יום עדיין מוצג');
  });
  test('תשובה באיחור: כפתור שתאריכו כבר עבר לא מוצג', () => {
    assert.deepEqual(homeworkButtons({ timetable: TIMETABLE, subject: 'מתמטיקה', lessonDate: '2026-10-18', today: '2026-10-20' }), []);
  });
  test('בלי today אין סינון; מקצוע לא ידוע או בלי מערכת: מערך ריק', () => {
    assert.equal(homeworkButtons({ timetable: TIMETABLE, subject: 'מתמטיקה', lessonDate: '2026-10-18' }).length, 1);
    assert.deepEqual(homeworkButtons({ timetable: TIMETABLE, subject: 'לא קיים', lessonDate: '2026-10-18', today: '2026-10-18' }), []);
    assert.deepEqual(homeworkButtons({ timetable: null, subject: 'מתמטיקה', lessonDate: '2026-10-18', today: '2026-10-18' }), []);
  });
  test('expires_at: תחילת היום שאחרי lesson_date + 7 בשעון ישראל (סוף היום של "אותו שיעור בשבוע הבא")', () => {
    // גיבוי (בלי מערכת שעות): lesson_date + 7, סוף היום
    assert.equal(expiresAtFor('2026-10-22').toISOString(), '2026-10-29T22:00:00.000Z'); // 30.10 00:00 ישראל (UTC+2)
    assert.equal(expiresAtFor('2026-10-18').toISOString(), '2026-10-25T22:00:00.000Z'); // 26.10 00:00 ישראל, אחרי המעבר
    assert.equal(expiresAtFor('2026-10-22', { timetable: TIMETABLE, subject: 'מקצוע שלא קיים' }).toISOString(), '2026-10-29T22:00:00.000Z');
  });
  test('expires_at לפי כפתור ה-next: תחילת היום שאחרי תאריך הכפתור בשעון ישראל', () => {
    // שיעור מתמטיקה בשני 19.10 -> כפתור ראשון 25.10 (יום המעבר) -> פוקעת 26.10 00:00 ישראל (UTC+2) = 2026-10-25T22:00Z
    assert.equal(expiresAtFor('2026-10-19', { timetable: TIMETABLE, subject: 'מתמטיקה' }).toISOString(), '2026-10-25T22:00:00.000Z');
    // ראשון 18.10 -> כפתור שני 19.10 -> פוקעת 20.10 00:00 ישראל (UTC+3) = 2026-10-19T21:00Z
    assert.equal(expiresAtFor('2026-10-18', { timetable: TIMETABLE, subject: 'מתמטיקה' }).toISOString(), '2026-10-19T21:00:00.000Z');
  });
});

describe('homework-schedule: מפתח הרצף ושליפת הרצף ממנו', () => {
  test('parseHomeworkKey', () => {
    assert.deepEqual(parseHomeworkKey('homework-2026-10-22-8'), { lessonDate: '2026-10-22', startPeriod: 8 });
    for (const bad of ['homework-2026-10-22', 'homework-2026-13-22-1', 'homework-2026-02-30-1', 'brief-2026-10-22', 'homework-2026-10-22-123', "homework-2026-10-22-1'; DROP", '', null, undefined]) {
      assert.equal(parseHomeworkKey(bad), null, String(bad));
    }
  });
  test('sequenceFromKey: המקצוע והתאריך נגזרים מהטבלה ומהמפתח', () => {
    const seq = sequenceFromKey(TIMETABLE, 'homework-2026-10-22-8');
    assert.deepEqual([seq.subject, seq.lessonDate, seq.startPeriod, seq.endPeriod], ['כימיה', '2026-10-22', 8, 9]);
    assert.equal(seq.endAt.toISOString(), '2026-10-22T12:45:00.000Z'); // 15:45 ישראל
  });
  test('מפתח של שיעור שאינו תחילת רצף, של יום בלי שיעורים, או של מקצוע פטור: null', () => {
    assert.equal(sequenceFromKey(TIMETABLE, 'homework-2026-10-22-9'), null, 'שיעור 9 הוא באמצע הרצף');
    assert.equal(sequenceFromKey(TIMETABLE, 'homework-2026-10-23-1'), null, 'שישי');
    assert.equal(sequenceFromKey(TIMETABLE, 'homework-2026-10-20-3'), null, 'כישורי חיים פטור');
    assert.equal(sequenceFromKey(TIMETABLE, 'garbage'), null);
  });
});

describe('message-slots: משבצת homework', () => {
  const GOOD = { kind: 'homework', slotKey: 'homework-2026-10-22-1', targetAt: '2026-10-22T06:53:00.000Z' };
  test('parseSlotMessage מקבל הודעה תקינה (מפתח ASCII, היעד באותו תאריך מקומי)', () => {
    assert.deepEqual(parseSlotMessage(GOOD), { ok: true, ...GOOD });
    assert.equal(parseSlotMessage({ kind: 'homework', slotKey: 'homework-2026-10-26-1', targetAt: '2026-10-26T07:03:00.000Z' }).ok, true);
  });
  test('הודעות homework לא תקינות נדחות', () => {
    const bad = [
      { ...GOOD, kind: 'brief' }, { ...GOOD, kind: 'close' }, { ...GOOD, kind: 'notify' },
      { ...GOOD, slotKey: 'homework-2026-10-22' }, { ...GOOD, slotKey: 'homework-2026-10-22-' }, { ...GOOD, slotKey: 'homework-2026-10-22-123' },
      { ...GOOD, slotKey: "homework-2026-10-22-1'; DROP" }, { ...GOOD, slotKey: 'homework-מתמטיקה-1' },
      { ...GOOD, targetAt: 'nope' }, { ...GOOD, targetAt: 5 },
      { ...GOOD, targetAt: '2026-10-23T06:53:00.000Z' }, // התאריך המקומי של היעד שונה מהתאריך שבמפתח
      { kind: 'brief', slotKey: 'homework-2026-10-22-1', targetAt: GOOD.targetAt },
    ];
    for (const message of bad) assert.equal(parseSlotMessage(message).ok, false, JSON.stringify(message));
  });
  test('יעד אחרי חצות UTC אך באותו תאריך ישראלי: 00:30Z הוא 03:30 ישראל; ו-23:30Z של היום הקודם הוא כבר התאריך הבא בישראל', () => {
    assert.equal(parseSlotMessage({ kind: 'homework', slotKey: 'homework-2026-10-22-1', targetAt: '2026-10-22T00:30:00.000Z' }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'homework', slotKey: 'homework-2026-10-22-1', targetAt: '2026-10-21T22:30:00.000Z' }).ok, true, '01:30 ב-22.10 בישראל');
    assert.equal(parseSlotMessage({ kind: 'homework', slotKey: 'homework-2026-10-22-1', targetAt: '2026-10-21T20:30:00.000Z' }).ok, false, '23:30 ב-21.10 בישראל');
  });
  test('planHomework: השהיה עד היעד, retention ארוכה ממנה ועד 7 ימים; יעד שעבר = null', () => {
    const target = new Date('2026-10-22T06:53:00.000Z');
    const plan = planHomework({ slotKey: GOOD.slotKey, targetAt: target }, new Date('2026-10-22T01:10:00.000Z'));
    assert.deepEqual(plan, { kind: 'homework', slotKey: GOOD.slotKey, targetAt: '2026-10-22T06:53:00.000Z', delaySeconds: 20580, retentionSeconds: 20580 + 86400 });
    assert.equal(planHomework({ slotKey: GOOD.slotKey, targetAt: target }, target), null, 'היעד הוא עכשיו בדיוק: עבר');
    assert.equal(planHomework({ slotKey: GOOD.slotKey, targetAt: target }, new Date('2026-10-22T07:00:00.000Z')), null);
    assert.throws(() => planHomework({ slotKey: GOOD.slotKey, targetAt: 'x' }), TypeError);
  });
  test('brief ו-close לא השתנו', () => {
    assert.equal(planSlot('1', new Date('2026-10-09T01:00:00Z')).slotKey, 'brief-2026-10-09');
    assert.equal(planSlot('2', new Date('2026-10-09T14:00:00Z')).slotKey, 'close-2026-10-09');
  });
});

// ---------------------------------------------------------------------------
// קריטריון 3 (חלק התזמון): cron-plan מתזמן הודעה מושהית אחת לרצף, ושתי הרצות באותו יום נותנות אותם מפתחות.
// חמישי 22.10.2026, 04:10 ישראל = 01:10Z. ששת הרצפים וזמני השאלה (שעון ישראל UTC+3): 09:53, 11:43, 12:38, 13:28, 14:18, 15:48.
// ---------------------------------------------------------------------------
describe('cron-plan: תזמון שאלות שיעורי הבית (קריטריון 3)', () => {
  const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
  const NOW = '2026-10-22T01:10:00.000Z';
  const makeSend = () => { const calls = []; const fn = async (...args) => { calls.push(args); return { messageId: 'm' }; }; fn.calls = calls; return fn; };
  const run = async (slot, iso, extra = {}) => {
    const send = extra.send ?? makeSend();
    const sql = extra.sql ?? fakeSql();
    const res = await cronHandle(req(`https://x.test/api/cron-plan?slot=${slot}`, { headers: AUTH }), { sql, secret: FAKE_CRON, now: () => new Date(iso), send, timetable: 'timetable' in extra ? extra.timetable : TIMETABLE, homeworkEnabled: 'homeworkEnabled' in extra ? extra.homeworkEnabled : true });
    return { res, send, sql };
  };
  const homeworkCalls = (send) => send.calls.filter((c) => c[1].kind === 'homework');
  const EXPECTED_THURSDAY = [
    ['homework-2026-10-22-1', '2026-10-22T06:53:00.000Z', 20580],
    ['homework-2026-10-22-3', '2026-10-22T08:43:00.000Z', 27180],
    ['homework-2026-10-22-5', '2026-10-22T09:38:00.000Z', 30480],
    ['homework-2026-10-22-6', '2026-10-22T10:28:00.000Z', 33480],
    ['homework-2026-10-22-7', '2026-10-22T11:18:00.000Z', 36480],
    ['homework-2026-10-22-8', '2026-10-22T12:48:00.000Z', 41880],
  ];

  test('slot=1 ביום חמישי: בריף אחד ואחריו שש הודעות homework, כל אחת עם idempotencyKey = slotKey, יעד והשהיה', async () => {
    const { res, send } = await run(1, NOW);
    assert.equal(res.status, 200);
    assert.equal(send.calls[0][1].kind, 'brief');
    const calls = homeworkCalls(send);
    assert.equal(calls.length, 6);
    assert.deepEqual(calls.map((c) => [c[1].slotKey, c[1].targetAt, c[2].delaySeconds]), EXPECTED_THURSDAY);
    for (const [topic, message, options] of calls) {
      assert.equal(topic, 'daily-slots');
      assert.deepEqual(Object.keys(message).sort(), ['kind', 'slotKey', 'targetAt']);
      assert.equal(options.idempotencyKey, message.slotKey);
      assert.equal(options.retentionSeconds, options.delaySeconds + 86400);
      assert.equal(parseSlotMessage(message).ok, true, 'ההודעה עוברת את הצרכן');
    }
  });

  test('ברירת המחדל (שלב 8.6-2, המסך נבנה): HOMEWORK_ASKS_ENABLED הוא true, ובלי הזרקה נשלחות הודעות homework', async () => {
    assert.equal(HOMEWORK_ASKS_ENABLED, true);
    const send = makeSend();
    const res = await cronHandle(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql: fakeSql(), secret: FAKE_CRON, now: () => new Date(NOW), send, timetable: TIMETABLE });
    assert.equal(res.status, 200);
    assert.equal(send.calls.filter((c) => c[1].kind === 'homework').length, 6);
  });

  test('מתג כבוי בהזרקה (homeworkEnabled=false): לא נשלחת הודעת homework, אין טעינת מערכת שעות, ו-probe_log בלי תוספת', async () => {
    const send = makeSend();
    const sql = fakeSql();
    const res = await cronHandle(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql, secret: FAKE_CRON, now: () => new Date(NOW), send, homeworkEnabled: false });
    assert.equal(res.status, 200);
    assert.equal(send.calls.length, 1, 'רק הבריף');
    assert.equal(send.calls[0][1].kind, 'brief');
    assert.equal(sql.calls.length, 1, 'רק שורת probe_log, בלי קריאת מערכת שעות');
    assert.doesNotMatch(sql.calls[0].values[1], /homework/);
    // גם כשמעבירים מערכת שעות מלאה, המתג הכבוי גובר
    const send2 = makeSend();
    await cronHandle(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql: fakeSql(), secret: FAKE_CRON, now: () => new Date(NOW), send: send2, timetable: TIMETABLE, homeworkEnabled: false });
    assert.equal(send2.calls.filter((c) => c[1].kind === 'homework').length, 0);
  });

  test('שורת ה-probe_log מוסיפה רק מספר ובלי שם מקצוע', async () => {
    const { sql } = await run(1, NOW);
    assert.match(sql.calls[0].values[1], /; homework_queued=6$/);
    for (const subject of ['גיאומטריה', 'כימיה', 'ערבית', 'מדעי']) assert.ok(!sql.calls[0].values[1].includes(subject));
  });

  test('הרצה כפולה באותו יום: אותם מפתחות בדיוק (התור מתעלם מהשנייה), גם כשהשנייה רצה כעבור 40 דקות', async () => {
    const a = await run(1, NOW);
    const b = await run(1, '2026-10-22T01:50:00.000Z');
    const keys = (r) => homeworkCalls(r.send).map((c) => c[2].idempotencyKey);
    assert.deepEqual(keys(a), keys(b));
    assert.equal(keys(a).length, 6);
  });

  test('אחרי מעבר השעון: שני 26.10.2026 מתזמן שש הודעות ביעד UTC+2 (הראשונה 09:03 = 07:03Z)', async () => {
    const { send } = await run(1, '2026-10-26T01:10:00.000Z');
    const calls = homeworkCalls(send);
    assert.equal(calls.length, 6);
    assert.deepEqual([calls[0][1].slotKey, calls[0][1].targetAt], ['homework-2026-10-26-1', '2026-10-26T07:03:00.000Z']);
    assert.deepEqual([calls[1][1].slotKey, calls[1][1].targetAt], ['homework-2026-10-26-2', '2026-10-26T07:53:00.000Z']);
  });

  test('יעד שכבר עבר לא נשלח: הרצה ידנית ב-09:00Z (12:00 ישראל) מתזמנת רק את ארבעת הרצפים שאחרי (09:38Z ואילך)', async () => {
    const { send, sql } = await run(1, '2026-10-22T09:00:00.000Z');
    assert.deepEqual(homeworkCalls(send).map((c) => c[1].slotKey), ['homework-2026-10-22-5', 'homework-2026-10-22-6', 'homework-2026-10-22-7', 'homework-2026-10-22-8']);
    assert.match(sql.calls[0].values[1], /homework_queued=4$/);
  });

  test('יום שישי: אין שיעורים, אין הודעות homework, ושורת ה-probe_log ללא תוספת', async () => {
    const { send, sql } = await run(1, '2026-10-23T01:10:00.000Z');
    assert.equal(homeworkCalls(send).length, 0);
    assert.doesNotMatch(sql.calls[0].values[1], /homework/);
  });

  test('slot=2: לא נוגע בשיעורי בית ולא טוען מערכת שעות', async () => {
    const sql = fakeSql();
    const { send } = await run(2, '2026-10-22T14:10:00.000Z', { sql, timetable: undefined });
    assert.equal(homeworkCalls(send).length, 0);
    assert.equal(sql.calls.length, 1, 'רק שורת probe_log');
  });

  test('בלי timetable מוזרק: טוען מהמסד ב-slot=1 בלבד; טעינה שנכשלה (מסד ריק) = 500, ok=false ו-homework_failed=no-timetable', async (t) => {
    captureConsole(t);
    const sql = fakeSql();
    const { res, send } = await run(1, NOW, { sql, timetable: undefined });
    assert.equal(res.status, 500);
    assert.equal(homeworkCalls(send).length, 0);
    assert.equal(sql.find('FROM timetable_slots').length, 1);
    const probe = sql.calls.find((c) => c.text.includes('INSERT INTO probe_log'));
    assert.equal(probe.values[0], false);
    assert.match(probe.values[1], /homework_failed=no-timetable$/);
  });

  test('כשל בשליחת הודעה אחת לתור: ההודעות האחרות עדיין נשלחות, 500, והלוג בלי שם מקצוע או סוד', async (t) => {
    const cap = captureConsole(t);
    const send = makeSend();
    const base = send;
    const failing = async (topic, message, options) => {
      if (message.slotKey === 'homework-2026-10-22-3') throw Object.assign(new Error(`boom ${FAKE_CRON}`), { name: 'QueueError' });
      return base(topic, message, options);
    };
    failing.calls = send.calls;
    const { res, sql } = await run(1, NOW, { send: failing });
    assert.equal(res.status, 500);
    assert.equal(homeworkCalls(send).length, 5);
    assert.match(sql.calls[0].values[1], /homework_queued=5; homework_failed=1$/);
    assert.equal(sql.calls[0].values[0], false);
    assert.ok(!cap.text().includes(FAKE_CRON));
    assert.match(cap.text(), /QueueError/);
  });
});
