// בדיקות לתצוגת השנה (lib/calendar-view.js loadYear, api/chat.js view=calendar-year). מבחנים בלבד, 12 חודשים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { loadYear, validateYearFrom } from '../lib/calendar-view.js';

const EXAMS = [
  { date: '2026-08-30', type: 'מבחן', subject: 'אנגלית' },
  { date: '2026-09-10', type: 'מבדק', subject: 'ספרות' },
  { date: '2026-12-01', type: 'מבחן', subject: 'מדעים' },
  { date: '2026-12-14', type: 'מועד ב\'', subject: null, makeup: true },
  { date: '2027-08-31', type: 'מבחן', subject: 'עברית' },
  { date: '2027-09-01', type: 'מבחן', subject: 'אזרחות' },
];

describe('calendar-year', () => {
  test('12 חודשים מספטמבר עד סוף אוגוסט; מבדק = quiz; מועד ב\' מסומן; בלי מה שמחוץ לטווח', async () => {
    const out = await loadYear({ sql: fakeSql(() => []), fromMonth: '2026-09', exams: EXAMS });
    assert.equal(out.from, '2026-09-01');
    assert.equal(out.to, '2027-08-31');
    assert.deepEqual(out.exams.map((e) => e.date), ['2026-09-10', '2026-12-01', '2026-12-14', '2027-08-31']);
    assert.equal(out.exams[0].quiz, true);
    assert.equal(out.exams[2].makeup, true);
    assert.equal(out.coverageEnd, '2027-09-01');
  });
  test('מינואר: עד סוף דצמבר באותה שנה', async () => {
    const out = await loadYear({ sql: fakeSql(() => []), fromMonth: '2027-01', exams: EXAMS });
    assert.equal(out.to, '2027-12-31');
  });
  test('from לא תקין: RangeError', () => {
    for (const bad of [null, '2026-13', '2026-9', '2026-09-01']) assert.throws(() => validateYearFrom(bad), RangeError);
  });
});

describe('זנב ההכנה (03-design-rules.md:427)', async () => {
  const { prepTails } = await import('../lib/calendar-view.js');
  const EX = [{ date: '2026-11-26', type: 'מבחן', subject: 'מתמטיקה' }, { date: '2026-11-30', type: 'מבדק', subject: 'ערבית' }, { date: '2026-11-27', type: "מועד ב'", subject: null, makeup: true }];
  test('מבחן: 10 ימים לפני, מתחזק עד היום שלפני; מבדק: 7; לא ביום המבחן עצמו', () => {
    assert.equal(prepTails('2026-11-15', EX).length, 0);
    const first = prepTails('2026-11-16', EX);
    assert.deepEqual(first.map((t) => [t.subject, t.daysLeft, t.strength]), [['מתמטיקה', 10, 0.1]]);
    const before = prepTails('2026-11-25', EX);
    assert.deepEqual(before.map((t) => [t.subject, t.daysLeft, t.strength]), [['מתמטיקה', 1, 1], ['ערבית', 5, 0.43]]);
    assert.ok(!prepTails('2026-11-26', EX).some((t) => t.subject === 'מתמטיקה'));
  });
});
