// שינוי אורך של אירוע קיים בהודעה חופשית (יובל, 25.11.2026, "ב'"): "השיננית בשישי זה חצי שעה" -> התור הקיים 12:30–13:30 הופך ל-12:30–13:00.
// המוח מזהה שזה האירוע הקיים (match), הקוד קורא את האורך ומחשב את הסוף. קודם: "כבר רשום" בלי שינוי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { findDuration } from '../lib/intake-questions.js';
import { readChange, targetFor, decideMatch, updateReply, writeMatched } from '../lib/event-match.js';
import { buildPrompt, isValidUnderstanding } from '../lib/intake-brain.js';

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
    assert.equal(findDuration('נפגשים עוד חצי שעה'), null); // זמן יחסי (ממצא הבודק)
    assert.equal(findDuration('יש לי רק שעה פנויה'), null);
    assert.equal(findDuration('תוך רבע שעה אני שם'), null);
  });
});

describe('אורך באירוע קיים: ההכרעה', () => {
  const change = readChange({ type: 'personal_event', facts: [fx('date', '2026-11-27')], text: 'השיננית בשישי זה חצי שעה', receivedAt: NOW, understanding: { date_text: 'בשישי', duration_text: 'חצי שעה' } });
  test('targetFor: התחלה + אורך אחרי חצות = לא ברור (null), לא "אותו דבר"', () => {
    const late = { ...TOOTH, time: '23:00', endTime: '23:30' };
    assert.equal(targetFor(late, { ...change, minutes: 120 }), null);
  });
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

describe('אורך: המוח מכריע, הקוד ממיר (26.11.2026)', () => {
  const read = (text, understanding) => readChange({ type: 'personal_event', facts: [], text, receivedAt: NOW, understanding });
  test('duration_text "חצי שעה" = 30, "45 דקות" = 45, "שעה וחצי" = 90', () => {
    assert.equal(read('זה חצי שעה', { duration_text: 'חצי שעה' }).minutes, 30);
    assert.equal(read('זה 45 דקות', { duration_text: '45 דקות' }).minutes, 45);
    assert.equal(read('שעה וחצי', { duration_text: 'שעה וחצי' }).minutes, 90);
  });
  test('duration_text null: "מגיע 15 דקות קודם" לא משנה אורך', () => {
    assert.equal(read('באימון בחמישי אני מגיע 15 דקות קודם', { duration_text: null }).minutes, undefined);
  });
  test('בלי מוח או בלי השדה: האורך לא משתנה', () => {
    assert.equal(read('זה חצי שעה', null).minutes, undefined);
    assert.equal(read('זה חצי שעה', { date_text: 'בשישי' }).minutes, undefined);
  });
  test('duration_text לא מספרי: אין אורך', () => {
    assert.equal(read('זה הרבה זמן', { duration_text: 'הרבה זמן' }).minutes, undefined);
  });
  test('הפרומפט: עם מועמדים מזכיר duration_text, בלעדיהם לא', () => {
    assert.match(buildPrompt({ text: 'x', candidates: [{ key: 'e1', label: 'תור' }] }), /duration_text/);
    assert.doesNotMatch(buildPrompt({ text: 'x' }), /duration_text/);
  });
  test('המאמת: duration_text שהומצא נדחה, מילה במילה מתקבל', () => {
    const base = { kind: 'personal_event', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, end_date_text: null, uncertain: [], match: 'e1', match_sure: true };
    assert.equal(isValidUnderstanding({ ...base, duration_text: 'חצי שעה' }, 'זה חצי שעה', ['e1']), true);
    assert.equal(isValidUnderstanding({ ...base, duration_text: 'שעתיים' }, 'זה חצי שעה', ['e1']), false);
    assert.equal(isValidUnderstanding({ ...base, duration_text: 5 }, 'זה חצי שעה', ['e1']), false);
    assert.equal(isValidUnderstanding({ ...base, duration_text: null }, 'זה חצי שעה', ['e1']), true);
  });
});

describe('המוח', () => {
  test('הפרומפט: שינוי אורך של אירוע קיים הוא personal_event', () => {
    assert.match(buildPrompt({ text: 'x' }), /personal_event: [^\n]*אורך/);
  });
});

describe('normalize של duration_text (דרך understandSource)', () => {
  test('מתקבל מנורמל; חסר = null', async () => {
    const { understandSource } = await import('../lib/intake-brain.js');
    const run = (data) => understandSource({ sql: fakeSql(() => []), source: { raw_content: 'זה חצי שעה' }, apiKey: 'k', candidates: [{ key: 'e1', label: 'תור' }],
      ask: async () => ({ ok: true, model: 'm', data }) });
    const base = { kind: 'personal_event', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [], match: 'e1', match_sure: true };
    assert.equal((await run({ ...base, duration_text: ' חצי שעה ' })).understanding.duration_text, 'חצי שעה');
    assert.equal((await run(base)).understanding.duration_text, null);
  });
});
