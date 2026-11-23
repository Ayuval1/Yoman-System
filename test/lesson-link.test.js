// "תביא לי", חוט מחבר: באיזה שיעור צולמה תמונה (lib/lesson-link.js). פונקציות טהורות + backfill עם sql מזויף.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonAt, planLessonBackfill, backfillLessonLinks } from '../lib/lesson-link.js';
import { fakeSql } from './helpers.js';

// יום שלישי = weekday 3. 2026-11-24 הוא יום שלישי. נובמבר = שעון חורף (UTC+2).
const TIMETABLE = { slots: [
  { weekday: 3, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה' },
  { weekday: 3, period: 4, startsAt: '10:55', endsAt: '11:40', subject: 'מתמטיקה' },
  { weekday: 3, period: 5, startsAt: '11:50', endsAt: '12:35', subject: 'מתמטיקה' },
] };
const at = (iso) => new Date(iso);

describe('lessonAt', () => {
  test('באמצע שיעור: השיעור הזה', () => {
    // 10:20 שעון ישראל = 08:20Z
    assert.deepEqual(lessonAt(at('2026-11-24T08:20:00Z'), TIMETABLE), { date: '2026-11-24', period: 3, subject: 'היסטוריה' });
  });
  test('כמה דקות אחרי שהשיעור נגמר (בהפסקה): השיעור שנגמר', () => {
    // 10:52 = 2 דקות אחרי סוף שיעור 3, לפני תחילת 4 ב-10:55
    assert.equal(lessonAt(at('2026-11-24T08:52:00Z'), TIMETABLE).period, 3);
  });
  test('כשהשיעור הבא כבר התחיל, הוא גובר על חלון החסד', () => {
    assert.equal(lessonAt(at('2026-11-24T08:56:00Z'), TIMETABLE).period, 4);
  });
  test('חלון החסד הוא 10 דקות: 5 דקות אחרי הסוף כן, 15 דקות לא', () => {
    assert.equal(lessonAt(at('2026-11-24T09:45:00Z'), TIMETABLE).period, 4); // 11:45
    assert.equal(lessonAt(at('2026-11-24T10:50:00Z'), TIMETABLE), null); // 12:50
  });
  test('לפני השיעור הראשון, בערב ובלילה: null', () => {
    assert.equal(lessonAt(at('2026-11-24T07:30:00Z'), TIMETABLE), null); // 09:30
    assert.equal(lessonAt(at('2026-11-24T18:00:00Z'), TIMETABLE), null);
  });
  test('יום בלי שיעורים במערכת, וחופשה: null', () => {
    assert.equal(lessonAt(at('2026-11-25T08:20:00Z'), TIMETABLE), null); // רביעי
    const vac = [{ from: '2026-11-24', to: '2026-11-24' }];
    assert.equal(lessonAt(at('2026-11-24T08:20:00Z'), TIMETABLE, { vacations: vac }), null);
  });
  test('שעון ישראל, לא UTC: 23:30Z ביום שני הוא כבר שלישי 01:30', () => {
    assert.equal(lessonAt(at('2026-11-23T23:30:00Z'), TIMETABLE), null);
  });
  test('מערכת שעות חסרה או חותמת לא תקינה: null, לא זורק', () => {
    assert.equal(lessonAt(at('2026-11-24T08:20:00Z'), null), null);
    assert.equal(lessonAt('לא תאריך', TIMETABLE), null);
    assert.equal(lessonAt(null, TIMETABLE), null);
  });
});

describe('planLessonBackfill', () => {
  test('מחזיר עדכון רק לתמונה שבתוך שיעור; מקצוע רק כשהוא ריק', () => {
    const rows = [
      { id: 'a', received_at: '2026-11-24T08:20:00Z', subject: null },
      { id: 'b', received_at: '2026-11-24T08:20:00Z', subject: 'אנגלית' },
      { id: 'c', received_at: '2026-11-24T18:00:00Z', subject: null },
      { id: 'd', received_at: null, subject: null },
    ];
    assert.deepEqual(planLessonBackfill(rows, TIMETABLE), [
      { id: 'a', lesson_date: '2026-11-24', lesson_period: 3, subject: 'היסטוריה' },
      { id: 'b', lesson_date: '2026-11-24', lesson_period: 3, subject: null },
    ]);
  });
});

describe('backfillLessonLinks', () => {
  test('קורא תמונות בלי קישור ומעדכן אחת אחת, רק היכן שעדיין ריק', async () => {
    const sql = fakeSql((text) => (text.startsWith('SELECT') ? [{ id: 'a', received_at: '2026-11-24T08:20:00Z', subject: null }, { id: 'c', received_at: '2026-11-24T18:00:00Z', subject: null }] : []));
    const result = await backfillLessonLinks({ sql, timetable: TIMETABLE });
    assert.deepEqual(result, { scanned: 2, linked: 1 });
    const updates = sql.find('UPDATE media');
    assert.equal(updates.length, 1);
    assert.match(updates[0].text, /lesson_date IS NULL/);
    assert.deepEqual(updates[0].values.slice(0, 3), ['2026-11-24', 3, 'היסטוריה']);
  });
  test('בלי מערכת שעות: לא נוגע במסד', async () => {
    const sql = fakeSql();
    assert.deepEqual(await backfillLessonLinks({ sql, timetable: null }), { scanned: 0, linked: 0 });
    assert.equal(sql.calls.length, 0);
  });
});
