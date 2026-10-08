// בדיקות ל-lib/schedule-time.js (הרגע הבא של שעה מקומית, נכון לשעון קיץ). הערכים הצפויים נכתבו ביד מהיסטים ידועים,
// לא מחושבים בפונקציה הנבדקת. ישראל: UTC+3 בקיץ, UTC+2 בחורף. 2026: הקיץ נגמר ביום א' 25.10 ב-02:00 מקומי (23:00Z ב-24.10).
// האביב הבא מתחיל ביום ו' 26.3.2027 ב-02:00 מקומי (00:00Z).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextRunUtc, localParts } from '../lib/schedule-time.js';

const iso = (date) => date.toISOString();
const next = (hour, minute, fromIso, timeZone) => iso(nextRunUtc({ hour, minute, from: new Date(fromIso), ...(timeZone ? { timeZone } : {}) }));

describe('schedule-time: ימים רגילים', () => {
  test('קיץ 07:30 ו-21:00', () => {
    assert.equal(next(7, 30, '2026-07-15T00:00:00.000Z'), '2026-07-15T04:30:00.000Z');
    assert.equal(next(21, 0, '2026-07-15T00:00:00.000Z'), '2026-07-15T18:00:00.000Z');
  });
  test('חורף 07:30 ו-21:00', () => {
    assert.equal(next(7, 30, '2026-12-10T00:00:00.000Z'), '2026-12-10T05:30:00.000Z');
    assert.equal(next(21, 0, '2026-12-10T00:00:00.000Z'), '2026-12-10T19:00:00.000Z');
  });
  test('השעה כבר עברה היום - מחר', () => {
    assert.equal(next(7, 30, '2026-07-15T05:00:00.000Z'), '2026-07-16T04:30:00.000Z');
  });
  test('from בדיוק ברגע היעד - היום הבא; מילישנייה לפני - אותו רגע', () => {
    assert.equal(next(7, 30, '2026-07-15T04:30:00.000Z'), '2026-07-16T04:30:00.000Z');
    assert.equal(next(7, 30, '2026-07-15T04:29:59.999Z'), '2026-07-15T04:30:00.000Z');
  });
  test('ברירת מחדל Asia/Jerusalem ו-from נוכחי: התוצאה בעתיד', () => {
    const result = nextRunUtc({ hour: 7, minute: 30 });
    assert.ok(result.getTime() > Date.now());
    assert.ok(result.getTime() - Date.now() <= 25 * 3600000);
  });
});

describe('schedule-time: סוף הקיץ (25.10.2026)', () => {
  test('היום שלפני - עדיין היסט קיץ', () => {
    assert.equal(next(7, 30, '2026-10-23T12:00:00.000Z'), '2026-10-24T04:30:00.000Z');
    assert.equal(next(21, 0, '2026-10-24T00:00:00.000Z'), '2026-10-24T18:00:00.000Z');
  });
  test('יום המעבר - היסט חורף', () => {
    assert.equal(next(7, 30, '2026-10-24T12:00:00.000Z'), '2026-10-25T05:30:00.000Z');
    assert.equal(next(21, 0, '2026-10-25T06:00:00.000Z'), '2026-10-25T19:00:00.000Z');
  });
  test('היום שאחרי', () => {
    assert.equal(next(7, 30, '2026-10-25T12:00:00.000Z'), '2026-10-26T05:30:00.000Z');
  });
  test('חפיפה: 01:30 מקומי - המופע הראשון (22:30Z ב-24.10)', () => {
    assert.equal(next(1, 30, '2026-10-24T20:00:00.000Z'), '2026-10-24T22:30:00.000Z');
  });
  test('חפיפה: from בין שני המופעים - היום המקומי הבא ולא המופע השני', () => {
    assert.equal(next(1, 30, '2026-10-24T22:45:00.000Z'), '2026-10-25T23:30:00.000Z');
  });
});

describe('schedule-time: תחילת הקיץ (26.3.2027)', () => {
  test('07:30 ביום המעבר - היסט קיץ', () => {
    assert.equal(next(7, 30, '2027-03-25T12:00:00.000Z'), '2027-03-26T04:30:00.000Z');
  });
  test('חור: 02:30 לא קיים - רגע המעבר (03:00 מקומי = 00:00Z)', () => {
    assert.equal(next(2, 30, '2027-03-25T12:00:00.000Z'), '2027-03-26T00:00:00.000Z');
  });
  test('חור: אחרי רגע המעבר - היום הבא (02:30 קיץ = 23:30Z ב-26.3)', () => {
    assert.equal(next(2, 30, '2027-03-26T00:00:00.000Z'), '2027-03-26T23:30:00.000Z');
  });
});

describe('schedule-time: אזור אחר', () => {
  test('America/New_York 07:30 ב-1.11.2026 (EST, UTC-5) = 12:30Z', () => {
    assert.equal(next(7, 30, '2026-11-01T00:00:00.000Z', 'America/New_York'), '2026-11-01T12:30:00.000Z');
  });
});

describe('schedule-time: localParts', () => {
  test('קיץ וחורף בישראל', () => {
    assert.deepEqual(localParts(new Date('2026-07-15T04:30:00.000Z'), 'Asia/Jerusalem'),
      { year: 2026, month: 7, day: 15, hour: 7, minute: 30, second: 0, offsetMinutes: 180 });
    assert.deepEqual(localParts(new Date('2026-12-10T05:30:00.000Z'), 'Asia/Jerusalem'),
      { year: 2026, month: 12, day: 10, hour: 7, minute: 30, second: 0, offsetMinutes: 120 });
  });
  test('חצות מקומי = שעה 0 ולא 24', () => {
    const parts = localParts(new Date('2026-07-14T21:00:00.000Z'), 'Asia/Jerusalem');
    assert.equal(parts.hour, 0);
    assert.equal(parts.day, 15);
  });
  test('היסט שלילי', () => {
    assert.equal(localParts(new Date('2026-11-01T12:30:00.000Z'), 'America/New_York').offsetMinutes, -300);
  });
});

describe('schedule-time: ולידציה', () => {
  const from = new Date('2026-07-15T00:00:00.000Z');
  test('hour לא תקין', () => {
    for (const hour of [24, -1, 1.5, '7', NaN, undefined]) assert.throws(() => nextRunUtc({ hour, minute: 0, from }), RangeError);
  });
  test('minute לא תקין', () => {
    for (const minute of [60, -1, 0.5, '30', NaN, undefined]) assert.throws(() => nextRunUtc({ hour: 7, minute, from }), RangeError);
  });
  test('timeZone לא תקין', () => {
    assert.throws(() => nextRunUtc({ hour: 7, minute: 30, timeZone: 'Mars/Olympus', from }), RangeError);
    assert.throws(() => localParts(from, 'Mars/Olympus'), RangeError);
  });
  test('from לא תקין', () => {
    assert.throws(() => nextRunUtc({ hour: 7, minute: 30, from: new Date('x') }), RangeError);
  });
  test('גבולות תקינים 00:00 ו-23:59', () => {
    assert.equal(next(0, 0, '2026-07-15T00:00:00.000Z'), '2026-07-15T21:00:00.000Z');
    assert.equal(next(23, 59, '2026-07-15T00:00:00.000Z'), '2026-07-15T20:59:00.000Z');
  });
});
