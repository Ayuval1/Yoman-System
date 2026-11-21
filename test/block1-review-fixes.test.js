// בלוק 1 (אפיון-מורחב §6): ממצאי ביקורת פתוחים של 8.3-2 ו-B-3ב. משפטים מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts } from '../lib/intake-facts.js';

const run = (text) => extractFacts({ text, receivedAt: '2026-11-22T08:00:00Z', channel: 'app', timetable: null });
const valueOf = (result, field) => result.facts.find((fact) => fact.field === field)?.value;

describe('מספרי שיעור אחרי שם מקצוע (05-open-questions, 19.10)', () => {
  for (const text of ['ביטול שיעורי פיזיקה 7, 8, 9 היום', 'ביטול שיעורי פיזיקה 7, 8 ו-9 היום', 'ביטול שיעורי פיזיקה 7-9 היום']) {
    test(`${text}: המקצוע והמספרים נשמרים`, () => {
      const r = run(text);
      assert.equal(r.type, 'cancel');
      assert.equal(valueOf(r, 'subject'), 'פיזיקה');
      assert.equal(valueOf(r, 'lesson'), '7,8,9');
    });
  }
  test('שיעור פיזיקה 7: שיעור אחד', () => {
    assert.equal(valueOf(run('ביטול שיעור פיזיקה 7 היום'), 'lesson'), '7');
  });
});

// --- 8.3-2, ממצאים 1-3 (65, לוג פערים 26.10.2026) ---
import { readFileSync } from 'node:fs';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { sequencesForDate } from '../lib/homework-schedule.js';
import { decideAbsence } from '../lib/homework-absence.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, FAKE_CRON } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const MONDAY = '2026-10-19';
const physics = sequencesForDate(TIMETABLE, MONDAY).find((s) => s.subject === 'פיזיקה'); // שיעורים 7-9
const rowsOf = (id, fields) => Object.entries(fields).flatMap(([field, value]) => [value].flat().map((v) => ({ source_id: id, field, value: v })));
const decide = (rows) => decideAbsence({ rows, sequence: physics, timetable: TIMETABLE });

describe('8.3-2 ממצא 1: ביטול עם מקצוע שסותר את מספרי השיעורים לא משתיק שאלה', () => {
  test('ביטול 7,8,9 עם מקצוע אחר: לא מבוטל; עם הפיזיקה, או בלי מקצוע: מבוטל', () => {
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9', subject: 'מתמטיקה' })).cancelled, false);
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9', subject: 'פיזיקה' })).cancelled, true);
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9' })).cancelled, true);
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9', subject: 'unknown' })).cancelled, true);
  });
});

describe('8.3-2 ממצא 2: ביטול ש-confirm=no עליו לא משתיק', () => {
  test('confirm=no: לא מבוטל; confirm=yes: מבוטל', () => {
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9', confirm: 'no' })).cancelled, false);
    assert.equal(decide(rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9', confirm: 'yes' })).cancelled, true);
  });
});

describe('8.3-2 ממצא 3: שאלה שכבר נוצרה לא נסגרת בגלל ביטול שהגיע אחריה', () => {
  const run = async (existingAsk) => {
    const inserts = [];
    const sql = fakeSql((text, values) => {
      if (text.includes('FROM facts f')) return rowsOf('s1', { type: 'cancel', date: MONDAY, lesson: '7,8,9' });
      if (text.includes('FROM lesson_asks WHERE')) return existingAsk ? [{ found: 1 }] : [];
      if (text.startsWith('WITH a AS ( INSERT INTO lesson_asks')) { inserts.push(values); return [{ ask_id: null, message_id: null }]; }
      return [];
    });
    const out = await handleDelivery({ kind: 'homework', slotKey: physics.slotKey, targetAt: physics.askAt.toISOString() }, { deliveryCount: 2 }, {
      sql, now: () => new Date(physics.askAt.getTime() + 500), pushHandle: async () => new Response('ok', { status: 200 }), secret: FAKE_CRON, timetable: TIMETABLE,
    });
    return { out, inserts };
  };
  test('שאלה קיימת: לא reason=cancelled, ממשיכים (אידמפוטנטי)', async () => {
    const { out, inserts } = await run(true);
    assert.notEqual(out.reason, 'cancelled');
    assert.equal(inserts.length, 1);
  });
  test('אין שאלה: cancelled כמו קודם, בלי INSERT', async () => {
    const { out, inserts } = await run(false);
    assert.equal(out.reason, 'cancelled');
    assert.equal(inserts.length, 0);
  });
});
