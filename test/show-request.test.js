// בדיקות ל-lib/show-request.js ("תראה לי את השבוע / המבחנים", 03-design-rules.md:331). קריאה בלבד, בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { detectShowRequest, weekText, examsText, answerShowRequest } from '../lib/show-request.js';
import { processSource } from '../lib/intake-process.js';

const TODAY = '2026-11-23';
const DAYS = [
  { date: '2026-11-23', items: [{ kind: 'lesson', title: 'מתמטיקה', end: '2026-11-23T12:15:00.000Z' }, { kind: 'training', title: 'אימון ריצה', start: '2026-11-23T15:30:00.000Z' }] },
  { date: '2026-11-24', items: [{ kind: 'exam', title: 'מבחן בערבית ב-08:15', start: '2026-11-24T06:15:00.000Z' }] },
  { date: '2026-11-25', noSchool: true, items: [] },
  { date: '2026-11-26', items: [{ kind: 'exam', title: "מועד ב'", makeup: true }] },
];

describe('show-request', () => {
  test('זיהוי: השבוע / המבחנים, מעוגן לתחילת ההודעה', () => {
    assert.equal(detectShowRequest('תראה לי את השבוע'), 'week');
    assert.equal(detectShowRequest('תראה לי את המבחנים?'), 'exams');
    assert.equal(detectShowRequest('תציג את השבוע'), 'week');
    assert.equal(detectShowRequest('תראה לי את הלוח במתמטיקה'), null);
    assert.equal(detectShowRequest('אני רוצה שתראה לי את השבוע'), null);
    assert.equal(detectShowRequest(null), null);
  });
  test('השבוע: שורה לכל יום, בית ספר עד, אימון עם שעה, מבחן, ו"אין בית ספר"; מועד ב\' לא מוצג', () => {
    const text = weekText(DAYS, TODAY);
    assert.match(text, /^השבוע:/);
    assert.match(text, /· היום: בית ספר עד 14:15 · 17:30 אימון ריצה/);
    assert.match(text, /· מחר: מבחן בערבית ב-08:15/);
    assert.match(text, /· רביעי 25\.11: אין בית ספר/);
    assert.match(text, /· חמישי 26\.11: פנוי/);
  });
  test('המבחנים: רק מבחנים (בלי מועד ב\'); אין = שורה ברורה', () => {
    assert.equal(examsText(DAYS, TODAY), 'המבחנים הקרובים:\n· מחר: מבחן בערבית ב-08:15');
    assert.match(examsText([], TODAY), /^אין מבחנים ב-30 הימים הקרובים\.$/);
  });
  test('answerShowRequest: בועה אחת, בלי כתיבה ליומן', async () => {
    const sql = fakeSql((text) => (text.includes('show-request') ? [{ claimed: 1 }] : []));
    const out = await answerShowRequest({ sql, source: { id: '44444444-4444-4444-8444-444444444444' }, kind: 'week', timetable: null, now: new Date('2026-11-23T07:00:00.000Z') });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^השבוע:\n· היום:/);
    assert.ok(!sql.calls.some((c) => /INSERT INTO events|UPDATE events/.test(c.text)));
  });
  test('הצינור: "תראה לי את המבחנים" מטופל בקוד, בלי מוח', async () => {
    let called = false;
    const sql = fakeSql((text) => (text.includes('show-request') ? [{ claimed: 1 }] : []));
    const source = { id: '44444444-4444-4444-8444-444444444444', channel: 'app', raw_content: 'תראה לי את המבחנים', received_at: '2026-11-23T07:00:00.000Z', content_hash: null };
    const out = await processSource({ sql, source, timetable: null, understand: async () => { called = true; return { ok: false, reason: 'no-pool' }; } });
    assert.equal(out.status, 'recorded');
    assert.equal(called, false);
  });
});
