// בדיקות ל-lib/school-google.js (בלוק 4, "74 שיעורים והפסקות ביומן"): בנייה טהורה של הסדרות, חזרה שבועית, וחיתוך הסדרות הישנות. בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimetableMarkdown, LESSON_PERIODS } from '../lib/timetable.js';
import {
  buildSchoolSeries, countSeries, seriesSchedule, seriesEventBody, planCut, isOldSchoolSeries, planSchoolSeries,
  SUBJECT_LEVELS, EXPECTED_COUNTS, BREAK_TITLE, schoolEventId, buildSchoolHeaders, schoolHeaderId, HEADER_TITLE_PREFIX,
} from '../lib/school-google.js';
import { isAppSeriesEvent, APP_PROPERTY, SCHOOL_SERIES_TAG } from '../lib/google.js';
import vacationsFile from '../data/school-vacations.json' with { type: 'json' };

const timetableMd = readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8');
const structureMd = readFileSync(new URL('../data/school-day-structure.md', import.meta.url), 'utf8');
const subjectsMd = readFileSync(new URL('../data/school-subjects-teachers.md', import.meta.url), 'utf8');
const TIMETABLE = parseTimetableMarkdown(timetableMd);
const VACATIONS = vacationsFile.vacations;
const SERIES = buildSchoolSeries(TIMETABLE);

describe('בלוק 4: בניית 74 הסדרות מהמערכת', () => {
  test('41 שיעורים + 33 הפסקות = 74, ולפי ימים 7+6, 9+7, 7+6, 9+7, 9+7 (כמו בקובץ החוקים)', () => {
    const counts = countSeries(SERIES);
    assert.equal(counts.lessons, 41);
    assert.equal(counts.breaks, 33);
    assert.equal(counts.total, 74);
    assert.equal(counts.ok, true);
    assert.deepEqual(EXPECTED_COUNTS, { lessons: 41, breaks: 33, total: 74 });
    assert.deepEqual(counts.by_weekday, {
      1: { lessons: 7, breaks: 6 }, 2: { lessons: 9, breaks: 7 }, 3: { lessons: 7, breaks: 6 }, 4: { lessons: 9, breaks: 7 }, 5: { lessons: 9, breaks: 7 },
    });
  });

  test('ספירה שונה מ-74 (Plan B): ok=false ו-mismatch מראה למה', () => {
    const fewer = buildSchoolSeries({ slots: TIMETABLE.slots.filter((s) => !(s.weekday === 1 && s.period === 7)) });
    const counts = countSeries(fewer);
    assert.equal(counts.ok, false);
    assert.equal(counts.total, 72);
    assert.match(counts.mismatch, /lessons=40\/41/);
    assert.match(counts.mismatch, /breaks=32\/33/);
  });

  test('אין הפסקה בין שיעור 8 ל-9, ואין הפסקה אחרי השיעור האחרון של היום', () => {
    const breaks = SERIES.filter((s) => s.kind === 'break');
    assert.ok(!breaks.some((b) => b.startsAt === '15:05'));
    assert.ok(!breaks.some((b) => b.weekday === 1 && b.startsAt === '14:15'), 'ראשון נגמר ב-14:15, אין הפסקה אחריו');
    assert.ok(breaks.some((b) => b.weekday === 2 && b.startsAt === '14:15' && b.endsAt === '14:30'));
  });

  test('ההפסקות זהות לשורות "הפסקה" ב-data/school-day-structure.md (שעות)', () => {
    const fromFile = [...structureMd.matchAll(/^\|\s*הפסקה\s*\|\s*(\d{2}:\d{2})[–-](\d{2}:\d{2})\s*\|/gm)].map((m) => `${m[1]}-${m[2]}`);
    assert.equal(fromFile.length, 7);
    const monday = SERIES.filter((s) => s.weekday === 2 && s.kind === 'break').map((b) => `${b.startsAt}-${b.endsAt}`);
    assert.deepEqual(monday, fromFile);
    assert.deepEqual(new Set(SERIES.filter((s) => s.kind === 'break').map((b) => `${b.startsAt}-${b.endsAt}`)), new Set(fromFile));
  });

  test('שיעור: כותרת = מקצוע, מיקום = חדר, תיאור = מורה + רמה. הפסקה: "הפסקה" בלי מיקום ותיאור', () => {
    const english = SERIES.find((s) => s.weekday === 1 && s.period === 5 && s.kind === 'lesson');
    assert.equal(english.title, 'אנגלית');
    assert.equal(english.location, '121');
    assert.equal(english.description, 'מורה: אינגה ארוטניאן\nרמה: 5 יח"ל');
    const history = SERIES.find((s) => s.weekday === 1 && s.period === 2 && s.kind === 'lesson');
    assert.equal(history.description, 'מורה: אורלי ויואט', 'בלי רמה כשאין בקבצים');
    const brk = SERIES.find((s) => s.kind === 'break');
    assert.equal(brk.title, BREAK_TITLE);
    assert.equal(brk.location, null);
    assert.equal(brk.description, null);
  });

  test('"תחומי בחירה" בחמישי 3-4: בלי מורה ובלי חדר (null), לא טקסט "לא ידוע"', () => {
    const elective = SERIES.filter((s) => s.title === 'תחומי בחירה - פודקאסט');
    assert.equal(elective.length, 2);
    for (const e of elective) {
      assert.equal(e.weekday, 5);
      assert.equal(e.location, null);
      assert.equal(e.description, null);
    }
  });

  test('רמות: הפיצולים יורשים 5 יח"ל לפי הערות הקבצים, ומה שמסומן 5 יח"ל ב-data/school-subjects-teachers.md מכוסה', () => {
    const fileLevels = subjectsMd.split(/\r?\n/).filter((l) => l.startsWith('| ') && l.includes('| 5 יח"ל |'))
      .map((l) => l.split('|').map((c) => c.trim())[1]);
    assert.deepEqual(fileLevels.sort(), ['אנגלית', 'מדעי המחשב', 'מדעים', 'מתמטיקה'].sort());
    const split = { מדעים: ['פיזיקה', 'כימיה'], מתמטיקה: ['מתמטיקה', 'גיאומטריה', 'מתמטיקה (תרגול)'] };
    const expected = fileLevels.flatMap((name) => split[name] ?? [name]);
    assert.deepEqual(Object.keys(SUBJECT_LEVELS).sort(), expected.sort());
    for (const value of Object.values(SUBJECT_LEVELS)) assert.equal(value, '5 יח"ל');
  });

  test('מזהי Google: ייחודיים, חוקיים (0-9, a-v), ומתחילים בקידומת של האפליקציה', () => {
    const ids = SERIES.map((s) => s.eventId);
    assert.equal(new Set(ids).size, 74);
    for (const id of ids) assert.match(id, /^schoolser[0-9a-v]+$/);
    assert.equal(schoolEventId(2027, 1, 3, 'lesson'), 'schoolser2027d1p3l');
    assert.equal(schoolEventId(2027, 2, 7, 'break'), 'schoolser2027d2p7b');
  });

  test('מבנה יום חלופי (dayStructure) נלקח כמו שהוא', () => {
    const custom = LESSON_PERIODS.map((l) => (l.period === 2 ? { ...l, startsAt: '09:00' } : l));
    const series = buildSchoolSeries(TIMETABLE, custom);
    assert.ok(!series.some((s) => s.kind === 'break' && s.startsAt === '09:00'), 'אין רווח בין 1 ל-2, אין הפסקה');
  });
});

describe('בלוק 4: חזרה שבועית', () => {
  const sundayFirst = SERIES.find((s) => s.weekday === 1 && s.period === 1 && s.kind === 'lesson');

  test('מהיום (ראשון 22.11.2026) עד יום לפני סוף השנה, עם EXDATE לכל יום חופשה באותו יום בשבוע', () => {
    const schedule = seriesSchedule(sundayFirst, { fromDate: '2026-11-22', vacations: VACATIONS });
    assert.equal(schedule.firstDate, '2026-11-22');
    assert.equal(schedule.until, '20270619T205959Z', '19.6.2027 23:59:59 בשעון קיץ = 20:59:59Z');
    assert.deepEqual(schedule.exdates, ['2026-12-06', '2027-04-18', '2027-04-25']);
  });

  test('יום ההתחלה בתוך חופשה: הסדרה מתחילה ביום הלימודים הבא', () => {
    const schedule = seriesSchedule(sundayFirst, { fromDate: '2026-12-01', vacations: VACATIONS });
    assert.equal(schedule.firstDate, '2026-12-13');
    assert.ok(!schedule.exdates.includes('2026-12-06'));
  });

  test('בלי endOfYear בקובץ החופשות: null (לא יוצרים סדרה בלי סוף)', () => {
    assert.equal(seriesSchedule(sundayFirst, { fromDate: '2026-11-22', vacations: VACATIONS.filter((v) => !v.endOfYear) }), null);
  });

  test('גוף האירוע: שעון ירושלים, RRULE שבועי עם UNTIL ו-EXDATE, ותגית פרטית של האפליקציה', () => {
    const schedule = seriesSchedule(sundayFirst, { fromDate: '2026-11-22', vacations: VACATIONS });
    const body = seriesEventBody(sundayFirst, schedule);
    assert.deepEqual(body.start, { dateTime: '2026-11-22T08:15:00', timeZone: 'Asia/Jerusalem' });
    assert.deepEqual(body.end, { dateTime: '2026-11-22T09:00:00', timeZone: 'Asia/Jerusalem' });
    assert.deepEqual(body.recurrence, [
      'RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270619T205959Z',
      'EXDATE;TZID=Asia/Jerusalem:20261206T081500',
      'EXDATE;TZID=Asia/Jerusalem:20270418T081500',
      'EXDATE;TZID=Asia/Jerusalem:20270425T081500',
    ]);
    assert.equal(body.summary, 'שיח אישי');
    assert.equal(body.location, '121');
    assert.deepEqual(body.extendedProperties, { private: { [APP_PROPERTY]: SCHOOL_SERIES_TAG, key: '1-1-lesson' } });
    assert.equal(isAppSeriesEvent({ id: 'x', extendedProperties: body.extendedProperties }), true);
  });

  test('כל 74 הסדרות (H19, תיעוד Google): start.timeZone מוגדר, מזהה base32hex 5-1024, ושעת כל EXDATE = שעת ההתחלה של הסדרה', () => {
    let exdateLines = 0;
    for (const item of SERIES) {
      assert.match(item.eventId, /^[a-v0-9]{5,1024}$/, item.key);
      const body = seriesEventBody(item, seriesSchedule(item, { fromDate: '2026-11-22', vacations: VACATIONS }));
      assert.equal(body.start.timeZone, 'Asia/Jerusalem', item.key);
      assert.equal(body.end.timeZone, 'Asia/Jerusalem', item.key);
      const startTime = body.start.dateTime.slice(11).replace(/:/g, ''); // HHMMSS
      for (const line of body.recurrence.filter((l) => l.startsWith('EXDATE'))) {
        exdateLines += 1;
        const [, date, time] = /^EXDATE;TZID=Asia\/Jerusalem:(\d{8})T(\d{6})$/.exec(line) ?? [];
        assert.equal(time, startTime, `${item.key}: ${line}`);
        assert.equal(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`).getUTCDay() + 1, item.weekday, `${item.key}: EXDATE ביום אחר`);
      }
      assert.ok(!body.recurrence.some((l) => l.includes('COUNT=')), 'בלי COUNT עם UNTIL');
    }
    assert.ok(exdateLines > 0);
  });

  test('הפסקה: בלי location ובלי description בגוף', () => {
    const brk = SERIES.find((s) => s.kind === 'break');
    const body = seriesEventBody(brk, seriesSchedule(brk, { fromDate: '2026-11-22', vacations: VACATIONS }));
    assert.ok(!('location' in body));
    assert.ok(!('description' in body));
  });
});

describe('בלוק 4: זיהוי וחיתוך הסדרות הישנות', () => {
  const old = (over = {}) => ({
    id: 'old1', status: 'confirmed', summary: 'בית ספר יום ראשון',
    start: { dateTime: '2026-05-03T08:15:00+03:00', timeZone: 'Asia/Jerusalem' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=SU'], ...over,
  });

  test('סדרה ישנה = כותרת שמתחילה ב"בית ספר יום" + RRULE, ולא של האפליקציה', () => {
    assert.equal(isOldSchoolSeries(old()), true);
    assert.equal(isOldSchoolSeries(old({ recurrence: undefined })), false, 'אירוע בודד לא נחתך');
    assert.equal(isOldSchoolSeries(old({ summary: 'מבחן בית ספר יום ראשון' })), false);
    assert.equal(isOldSchoolSeries(old({ extendedProperties: { private: { yoman: 'school-series' } } })), false);
    assert.equal(isOldSchoolSeries(old({ status: 'cancelled' })), false);
    assert.equal(isOldSchoolSeries(old({ summary: '\u200fבית ספר יום שני' })), true, 'סימן כיוון בהתחלה');
    assert.equal(isOldSchoolSeries(old({ summary: 'בית\u00a0ספר - יום שני' })), true, 'רווח קשיח ומקף');
    assert.equal(isOldSchoolSeries(old({ summary: 'בית ספר\u05beיום שני' })), true, 'מקף עברי');
  });

  test('חיתוך: UNTIL = יום לפני ההפעלה 23:59:59 בישראל, בלי COUNT, ושאר השורות נשמרות', () => {
    const cut = planCut(old({ recurrence: ['RRULE:FREQ=WEEKLY;COUNT=60;BYDAY=SU', 'EXDATE;TZID=Asia/Jerusalem:20260913T081500'] }), '2026-11-22');
    assert.equal(cut.action, 'cut');
    assert.deepEqual(cut.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261121T215959Z', 'EXDATE;TZID=Asia/Jerusalem:20260913T081500']);
  });

  test('UNTIL קיים אחרי ההפעלה מוחלף; UNTIL לפני ההפעלה = כבר נחתך (לא כותבים)', () => {
    assert.deepEqual(planCut(old({ recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20270620T000000Z;BYDAY=SU'] }), '2026-11-22').recurrence,
      ['RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261121T215959Z']);
    assert.deepEqual(planCut(old({ recurrence: ['RRULE:FREQ=WEEKLY;UNTIL=20261121T215959Z'] }), '2026-11-22'), { action: null, reason: 'already_cut' });
  });

  test('סדרה של יום שלם: UNTIL בתאריך בלבד', () => {
    const cut = planCut(old({ start: { date: '2026-05-03' } }), '2026-11-22');
    assert.deepEqual(cut.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261121']);
  });

  test('סדרה שמתחילה ביום ההפעלה או אחריו: לא נוגעים', () => {
    assert.deepEqual(planCut(old({ start: { dateTime: '2026-11-22T08:15:00+02:00' } }), '2026-11-22'), { action: null, reason: 'starts_after_activation' });
  });
});

describe('בלוק 4: תכנית (טהור)', () => {
  const fromDate = '2026-11-22';
  const oldSeries = { id: 'old1', status: 'confirmed', summary: 'בית ספר יום שני', start: { dateTime: '2026-05-04T08:15:00+03:00' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'] };
  const other = { id: 'exam1', status: 'confirmed', summary: 'מבחן', start: { dateTime: '2026-12-01T08:15:00+02:00' } };

  test('ריצה ראשונה: 74 ליצירה, הסדרה הישנה לחיתוך, אירוע אחר לא נוגעים', () => {
    const plan = planSchoolSeries({ series: SERIES, existing: [oldSeries, other], activationDate: fromDate, vacations: VACATIONS });
    assert.equal(plan.create.length, 74);
    assert.equal(plan.update.length, 0);
    assert.equal(plan.cut.length, 1);
    assert.equal(plan.cut[0].event.id, 'old1');
    assert.deepEqual(plan.orphans, []);
  });

  test('ריצה חוזרת: מה שכבר קיים מתעדכן (לא כפילות), ו-EXDATE מחושב מתאריך ההתחלה המקורי', () => {
    const first = SERIES.find((s) => s.weekday === 1 && s.period === 1 && s.kind === 'lesson');
    const existing = [{
      id: first.eventId, status: 'confirmed', summary: first.title, start: { dateTime: '2026-11-01T08:15:00+02:00', timeZone: 'Asia/Jerusalem' },
      recurrence: ['RRULE:FREQ=WEEKLY'], extendedProperties: { private: { yoman: 'school-series', key: first.key } },
    }];
    const plan = planSchoolSeries({ series: SERIES, existing, activationDate: '2026-12-20', vacations: VACATIONS });
    assert.equal(plan.create.length, 73);
    assert.equal(plan.update.length, 1);
    const patch = plan.update[0].patch;
    assert.ok(!('start' in patch) && !('end' in patch), 'ההתחלה המקורית נשמרת');
    assert.ok(patch.recurrence.includes('EXDATE;TZID=Asia/Jerusalem:20261206T081500'), 'חנוכה שכבר עבר נשאר מוחרג');
  });

  test('אירוע של האפליקציה שכבר לא במערכת: יתום, לא נמחק', () => {
    const orphan = { id: 'schoolser2027d1p9l', status: 'confirmed', summary: 'x', start: { dateTime: '2026-11-22T15:05:00+02:00' }, recurrence: ['RRULE:FREQ=WEEKLY'], extendedProperties: { private: { yoman: 'school-series', key: '1-9-lesson' } } };
    const plan = planSchoolSeries({ series: SERIES, existing: [orphan], activationDate: fromDate, vacations: VACATIONS });
    assert.equal(plan.orphans.length, 1);
    assert.equal(plan.create.length, 74);
  });
});

describe('כותרת יום: סדרה של יום שלם לכל יום לימודים', () => {
  const HEADERS = buildSchoolHeaders(SERIES);
  const monday = HEADERS.find((h) => h.weekday === 2);
  const mondaySchedule = seriesSchedule(monday, { fromDate: '2026-11-22', vacations: VACATIONS });

  test('חמש כותרות (ראשון עד חמישי), כותרת = שעת השיעור הראשון עד סוף האחרון', () => {
    assert.deepEqual(HEADERS.map((h) => h.weekday), [1, 2, 3, 4, 5]);
    assert.deepEqual(HEADERS.map((h) => h.title), [
      '🏫 בית ספר · 08:15–14:15', '🏫 בית ספר · 08:15–15:45', '🏫 בית ספר · 08:15–14:15', '🏫 בית ספר · 08:15–15:45', '🏫 בית ספר · 08:15–15:45',
    ]);
    assert.ok(HEADERS.every((h) => h.title.startsWith(HEADER_TITLE_PREFIX) && h.kind === 'header' && h.allDay === true && h.location === null));
  });

  test('השעות נגזרות מהשיעורים עצמם: יום שמתחיל בשיעור 2 מתחיל ב-09:05', () => {
    const late = buildSchoolHeaders(buildSchoolSeries({ slots: TIMETABLE.slots.filter((s) => !(s.weekday === 1 && s.period === 1)) }));
    assert.equal(late.find((h) => h.weekday === 1).title, '🏫 בית ספר · 09:05–14:15');
  });

  test('תיאור: שורה לכל שיעור (שעה, טווח, מקצוע, חדר אם יש), בלי שמות מורים ובלי הפסקות', () => {
    const lines = monday.description.split('\n');
    assert.equal(lines.length, 9);
    assert.equal(lines[0], '1 · 08:15–09:00 · תנ"ך · חדר 121');
    assert.equal(lines[8], '9 · 15:05–15:45 · פיזיקה · חדר אשכול ה\'');
    const thursday = HEADERS.find((h) => h.weekday === 5).description.split('\n');
    assert.equal(thursday[2], '3 · 10:05–10:50 · תחומי בחירה - פודקאסט', 'בלי חדר כשאין');
    const teachers = SERIES.map((s) => s.description).filter(Boolean).flatMap((d) => d.split('\n')).filter((l) => l.startsWith('מורה: ')).map((l) => l.slice(6));
    for (const h of HEADERS) for (const name of teachers) assert.ok(!h.description.includes(name), `${h.key}: ${name}`);
    assert.ok(!monday.description.includes(BREAK_TITLE));
  });

  test('מזהים: base32hex חוקי, קידומת האפליקציה, שונים מכל 74 המזהים, ו-isAppSeriesEvent מזהה (גם מופע)', () => {
    const ids = HEADERS.map((h) => h.eventId);
    assert.equal(schoolHeaderId(2027, 2), 'schoolser2027d2hdr');
    assert.equal(monday.eventId, 'schoolser2027d2hdr');
    for (const id of ids) assert.match(id, /^schoolser[0-9a-v]{5,1015}$/);
    assert.equal(new Set([...ids, ...SERIES.map((s) => s.eventId)]).size, 79);
    assert.ok(ids.every((id) => isAppSeriesEvent({ id })));
    assert.ok(isAppSeriesEvent({ id: 'schoolser2027d2hdr_20261123', recurringEventId: 'schoolser2027d2hdr' }));
  });

  test('ספירת 74 לא משתנה בגלל הכותרות, גם כשהן באותה רשימה', () => {
    assert.deepEqual(countSeries([...SERIES, ...HEADERS]), countSeries(SERIES));
    assert.equal(countSeries([...SERIES, ...HEADERS]).ok, true);
  });

  test('חזרה של יום שלם: UNTIL בתאריך בלבד (יום לפני סוף השנה), אותם EXDATE כמו השיעורים של אותו יום', () => {
    assert.equal(mondaySchedule.firstDate, '2026-11-23');
    assert.equal(mondaySchedule.until, '20270619');
    const lesson = SERIES.find((s) => s.weekday === 2 && s.kind === 'lesson');
    assert.deepEqual(mondaySchedule.exdates, seriesSchedule(lesson, { fromDate: '2026-11-22', vacations: VACATIONS }).exdates);
    assert.ok(mondaySchedule.exdates.length > 0);
  });

  test('גוף האירוע: start.date / end.date (למחרת), RRULE עם UNTIL תאריך, EXDATE;VALUE=DATE, ותגית האפליקציה', () => {
    const body = seriesEventBody(monday, mondaySchedule);
    assert.deepEqual(body.start, { date: '2026-11-23', timeZone: 'Asia/Jerusalem' });
    assert.deepEqual(body.end, { date: '2026-11-24', timeZone: 'Asia/Jerusalem' });
    assert.ok(!('dateTime' in body.start) && !('dateTime' in body.end));
    assert.equal(body.recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270619');
    assert.equal(body.recurrence.length, 2);
    assert.equal(body.recurrence[1], `EXDATE;VALUE=DATE:${mondaySchedule.exdates.map((d) => d.replace(/-/g, '')).join(',')}`);
    assert.ok(!body.recurrence.some((l) => l.includes('COUNT=') || l.includes('TZID')));
    assert.equal(body.summary, '🏫 בית ספר · 08:15–15:45');
    assert.ok(!('location' in body));
    assert.deepEqual(body.extendedProperties, { private: { [APP_PROPERTY]: SCHOOL_SERIES_TAG, key: '2-header' } });
  });

  test('כל חמש הכותרות: כל EXDATE באותו יום בשבוע, ובלי EXDATE כשאין חופשה', () => {
    for (const h of HEADERS) {
      const body = seriesEventBody(h, seriesSchedule(h, { fromDate: '2026-11-22', vacations: VACATIONS }));
      const ex = body.recurrence.find((l) => l.startsWith('EXDATE'));
      for (const date of ex ? ex.slice('EXDATE;VALUE=DATE:'.length).split(',') : []) {
        assert.match(date, /^\d{8}$/);
        assert.equal(new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`).getUTCDay() + 1, h.weekday, `${h.key}: ${date}`);
      }
    }
    const noVacation = seriesEventBody(monday, seriesSchedule(monday, { fromDate: '2026-11-22', vacations: VACATIONS.filter((v) => v.endOfYear) }));
    assert.deepEqual(noVacation.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270619']);
  });

  test('תכנית: ריצה ראשונה יוצרת 5 כותרות; ריצה חוזרת על מה שכבר תואם = אפס יצירה ואפס עדכון', () => {
    const first = planSchoolSeries({ series: [...SERIES, ...HEADERS], existing: [], activationDate: '2026-11-22', vacations: VACATIONS });
    assert.equal(first.create.length, 79);
    assert.equal(first.create.filter((c) => c.item.kind === 'header').length, 5);
    // מה ש-Google היה מחזיר אחרי היצירה: הגוף עצמו + מזהה.
    const existing = first.create.map(({ item, body }) => ({ id: item.eventId, status: 'confirmed', ...body }));
    const again = planSchoolSeries({ series: [...SERIES, ...HEADERS], existing, activationDate: '2026-11-25', vacations: VACATIONS });
    assert.equal(again.create.length, 0);
    assert.equal(again.update.length, 0);
    assert.equal(again.unchanged.length, 79);
    assert.deepEqual(again.orphans, []);
  });

  test('כותרת קיימת עם כותרת ישנה: מתעדכנת (בלי start/end), לא נוצרת שוב', () => {
    const body = seriesEventBody(monday, mondaySchedule);
    const existing = [{ id: monday.eventId, status: 'confirmed', ...body, summary: '🏫 בית ספר · 08:15–15:05' }];
    const plan = planSchoolSeries({ series: HEADERS, existing, activationDate: '2026-11-25', vacations: VACATIONS });
    assert.equal(plan.create.length, 4);
    assert.equal(plan.update.length, 1);
    assert.equal(plan.update[0].patch.summary, '🏫 בית ספר · 08:15–15:45');
    assert.ok(!('start' in plan.update[0].patch));
  });
});
