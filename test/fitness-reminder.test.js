// בדיקות ל-lib/fitness-reminder.js: שורת "לוז 4fitness עוד לא הגיע" בבריף של ראשון ושני. בלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, captureConsole } from './helpers.js';
import { reminderSince, fitnessReminderLine, FITNESS_REMINDER_LINE } from '../lib/fitness-reminder.js';
import { composeBrief } from '../lib/brief-view.js';

describe('fitness-reminder', () => {
  test('רק בראשון ובשני; הבדיקה מיום חמישי שלפני', () => {
    assert.equal(reminderSince('2026-11-29'), '2026-11-26'); // ראשון -> חמישי
    assert.equal(reminderSince('2026-11-30'), '2026-11-26'); // שני -> חמישי
    assert.equal(reminderSince('2026-11-24'), null); // שלישי
    assert.equal(reminderSince('2026-11-28'), null); // שבת
  });
  test('לא נקלט לוז: השורה; נקלט: בלי שורה; השאילתה מתחמישי 00:00 בישראל', async () => {
    const none = fakeSql(() => []);
    assert.equal(await fitnessReminderLine(none, '2026-11-29'), FITNESS_REMINDER_LINE);
    const [call] = none.find('fitness-reminder');
    assert.ok(call.values.includes('2026-11-25T22:00:00.000Z'));
    assert.ok(call.values.includes('fitness_schedule'));
    assert.match(call.text, /raw_content ~/); // לוז שעבר למוח (בלי עובדת type) נספר גם הוא
    assert.equal(await fitnessReminderLine(fakeSql(() => [{ found: 1 }]), '2026-11-29'), null);
  });
  test('לא ראשון/שני: בלי שאילתה', async () => {
    const sql = fakeSql(() => []);
    assert.equal(await fitnessReminderLine(sql, '2026-11-25'), null);
    assert.equal(sql.find('fitness-reminder').length, 0);
  });
  test('כשל מסד: בלי שורה, לא זורק', async (t) => {
    captureConsole(t);
    assert.equal(await fitnessReminderLine(fakeSql(() => { throw new Error('db'); }), '2026-11-29'), null);
  });
  test('composeBrief: השורה נכנסת לפני השורה התחתונה', () => {
    const { text } = composeBrief({ dateIso: '2026-11-29', fitness: FITNESS_REMINDER_LINE });
    const lines = text.split('\n');
    assert.equal(lines.at(-2), FITNESS_REMINDER_LINE);
    assert.ok(!composeBrief({ dateIso: '2026-11-29' }).text.includes('4fitness'));
  });
});
