// בדיקות ל-lib/school-calendar.js (שלב B-1, docs/08-chapter8/68, הנחה H1): יום לימודים = יש שיעורים באותו יום בשבוע וגם התאריך אינו בטווח חופשה. כל הנתונים מהקבצים האמיתיים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSchoolDay, vacationOn, lessonsOnDate, VACATIONS } from '../lib/school-calendar.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));

describe('school-calendar: isSchoolDay', () => {
  test('יום רגיל עם שיעורים (שלישי 20.10.2026) הוא יום לימודים', () => assert.equal(isSchoolDay('2026-10-20', TIMETABLE), true));
  test('שבת אינה יום לימודים (24.10.2026)', () => assert.equal(isSchoolDay('2026-10-24', TIMETABLE), false));
  test('שישי בלי שיעורים אינו יום לימודים (23.10.2026)', () => {
    assert.equal(lessonsOnDate('2026-10-23', TIMETABLE).length, 0);
    assert.equal(isSchoolDay('2026-10-23', TIMETABLE), false);
  });
  test('יום חופשה שיש לו שיעורים במערכת אינו יום לימודים: חנוכה, שני 7.12.2026', () => {
    assert.ok(lessonsOnDate('2026-12-07', TIMETABLE).length > 0, 'יש שיעורים ביום שני במערכת');
    assert.equal(isSchoolDay('2026-12-07', TIMETABLE), false);
  });
  test('גבולות החופשה כולל שני הקצוות: 6.12 ו-10.12 חופשה, 13.12 (יום חזרה, ראשון) יום לימודים', () => {
    assert.equal(isSchoolDay('2026-12-06', TIMETABLE), false);
    assert.equal(isSchoolDay('2026-12-10', TIMETABLE), false);
    assert.equal(isSchoolDay('2026-12-13', TIMETABLE), true);
    assert.equal(vacationOn('2026-12-05'), null);
  });
  test('כל טווחי החופשה בקובץ: היום הראשון והאחרון בכל אחד מהם הם חופשה', () => {
    for (const vacation of VACATIONS.filter((v) => v.endOfYear !== true)) {
      assert.equal(vacationOn(vacation.from)?.name, vacation.name, vacation.name);
      assert.equal(vacationOn(vacation.to)?.name, vacation.name, vacation.name);
    }
    assert.equal(VACATIONS.length, 9);
  });
  test('ל"ג בעומר (25.5.2027) הוא יום לימודים רגיל (אושר ע"י יובל בקובץ החופשות)', () => assert.equal(isSchoolDay('2027-05-25', TIMETABLE), true));
  test('סוף השנה (20.6.2027) ומה שאחריו אינם יום לימודים (הנחה, לא אומת); חמישי לפני כן כן', () => {
    assert.equal(isSchoolDay('2027-06-17', TIMETABLE), true);
    assert.equal(isSchoolDay('2027-06-20', TIMETABLE), false);
    assert.equal(isSchoolDay('2027-06-21', TIMETABLE), false);
  });
  test('מערכת שעות חסרה (null או ריקה): לא יום לימודים (לא ידוע)', () => {
    assert.equal(isSchoolDay('2026-10-20', null), false);
    assert.equal(isSchoolDay('2026-10-20', { slots: [] }), false);
  });
  test('חופשות מוזרקות: אפשר לבדוק בלי הקובץ', () => {
    assert.equal(isSchoolDay('2026-10-20', TIMETABLE, [{ name: 'בדיקה', from: '2026-10-19', to: '2026-10-21' }]), false);
    assert.equal(isSchoolDay('2026-10-20', TIMETABLE, []), true);
  });
});
