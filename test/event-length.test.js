// שינוי אורך של אירוע קיים בהודעה חופשית (יובל, 25.11.2026, "ב'"): "השיננית בשישי זה חצי שעה" -> התור הקיים 12:30–13:30 הופך ל-12:30–13:00.
// המוח מזהה שזה האירוע הקיים (match), הקוד קורא את האורך ומחשב את הסוף. קודם: "כבר רשום" בלי שינוי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { findDuration } from '../lib/intake-questions.js';
import { readChange, targetFor, decideMatch, updateReply, writeMatched } from '../lib/event-match.js';
import { buildPrompt } from '../lib/intake-brain.js';

const NOW = new Date('2026-11-25T05:36:00.000Z'); // רביעי 25.11
const TOOTH = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: 'תור לשיננית', date: '2026-11-27', time: '12:30', endTime: '13:30', domain: 'personal', sourceId: 's' };
const fx = (field, value, origin = 'read') => ({ field, value, origin });

describe('findDuration: אורך בתוך משפט', () => {
  test('נקרא', () => {
    assert.equal(findDuration('השיננית בשישי זה חצי שעה'), 30);
    assert.equal(findDuration('התור לוקח שעה וחצי'), 90);
    assert.equal(findDuration('הפגישה נמשכת שעתיים'), 120);
    assert.equal(findDuration('זה 45 דקות'), 45);
    assert.equal(findDuration('אבל זה שעה'), 60);
    assert.equal(findDuration('רבע שעה בלבד'), 15);
  });
  test('לא נקרא: שעה בשעון, "בשעה", בלי אורך', () => {
    assert.equal(findDuration('תור לשיננית בשעה 12:30'), null);
    assert.equal(findDuration('פגישה מחר ב-4'), null);
    assert.equal(findDuration('יש לי שעה פנויה מחר?'), null);
    assert.equal(findDuration('השיעור בשעה השלישית'), null);
  });
});

describe('אורך באירוע קיים: ההכרעה', () => {
  const change = readChange({ type: 'personal_event', facts: [fx('date', '2026-11-27')], text: 'השיננית בשישי זה חצי שעה', receivedAt: NOW, understanding: { date_text: 'בשישי' } });
  test('readChange: minutes = 30', () => {
    assert.equal(change.minutes, 30);
  });
  test('targetFor: אותה התחלה, סוף 13:00, לא "אותו דבר"', () => {
    assert.deepEqual(targetFor(TOOTH, change), { cancel: false, date: '2026-11-27', time: '12:30', endTime: '13:00', same: false });
  });
  test('אורך זהה לקיים: "אותו דבר" (כבר רשום)', () => {
    const hour = { ...change, minutes: 60 };
    assert.equal(targetFor(TOOTH, hour).same, true);
  });
  test('decideMatch עם מוח בטוח: עדכון (ולא "כבר רשום")', () => {
    const decision = decideMatch({ pool: [TOOTH], text: 'השיננית בשישי זה חצי שעה', type: 'personal_event', change, today: '2026-11-25', brain: { key: 'e1', sure: true } });
    assert.equal(decision.kind, 'update');
    assert.equal(decision.target.endTime, '13:00');
  });
  test('הבועה: "עודכן · תור לשיננית · שישי 27.11 · 12:30–13:00"', () => {
    assert.match(updateReply(TOOTH, targetFor(TOOTH, change)), /^עודכן · תור לשיננית · .* · 12:30–13:00$/);
  });
  test('writeMatched: הסוף נכתב במפורש (לא "ההמשך נשמר")', async () => {
    const sql = fakeSql((text) => (text.includes('WITH claim AS') ? [{ claimed: 1, updated: 1, bubble_id: 'b' }] : []));
    await writeMatched({ sql, sourceId: '11111111-1111-4111-8111-111111111111', candidate: TOOTH, target: targetFor(TOOTH, change), facts: [], certainty: 'certain', bubble: 'x' });
    const [call] = sql.calls;
    assert.ok(call.values.includes('13:00'));
  });
});

describe('המוח', () => {
  test('הפרומפט: שינוי אורך של אירוע קיים הוא personal_event', () => {
    assert.match(buildPrompt({ text: 'x' }), /personal_event: [^\n]*אורך/);
  });
});
