// בדיקות ל-lib/free-check.js (בלוק 3ב-2, אפיון-מורחב ח-6 "אני פנוי?"): הבדיקה בקוד, רק מול מה שהמערכת מכירה. נתונים מומצאים, בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readTimes, freeCheckWhen, loadBusy, composeFreeAnswer, answerFreeCheck, detectAvailability } from '../lib/free-check.js';
import { fakeSql } from './helpers.js';

const RECEIVED = new Date('2026-11-21T10:00:00.000Z'); // שבת 21.11.2026, 12:00 בישראל
// שלישי (weekday 3): שני שיעורים. מבחן אין בקובץ ב-24.11 (הנחה של הבדיקה: נבדק עם exams מוזרק).
const TIMETABLE = { slots: [
  { weekday: 3, period: 1, startsAt: '08:15', endsAt: '09:00', subject: 'מתמטיקה' },
  { weekday: 3, period: 9, startsAt: '15:05', endsAt: '15:45', subject: 'היסטוריה' },
] };
// שורת events: אימון 17:00-19:00 ביום שלישי 24.11 (UTC+2 בחורף).
const TRAINING = { title: 'אימון', starts_at: '2026-11-24T15:00:00.000Z', ends_at: '2026-11-24T17:00:00.000Z', domain: 'running', external_id: 'g-1' };
const eventsSql = (rows = [TRAINING]) => fakeSql((text) => (text.includes('FROM events') ? rows : []));

describe('free-check: detectAvailability (נפילה דטרמיניסטית כשהמוח לא זמין)', () => {
  test('הכרזה: "אני לא זמין ב-5", "לא פנוי עד 8", "אני עסוק"', () => {
    for (const text of ['אני לא זמין ב-5', 'לא פנוי עד 8', 'אני עסוק מחר מ-17:00 עד 19:00']) assert.equal(detectAvailability(text), 'unavailable', text);
  });
  test('שאלה: "אני פנוי מחר ב-6?", "אתה זמין ביום ג\' ב-6?", "האם אני פנוי ביום שלישי"', () => {
    for (const text of ['אני פנוי מחר ב-6?', "אתה זמין ביום ג' ב-6?", 'האם אני פנוי ביום שלישי']) assert.equal(detectAvailability(text), 'free_check', text);
  });
  test('לא קשור: null ("החדר פנוי", "מבחן מחר", "פנוי" בלי שאלה ובלי "אני")', () => {
    for (const text of ['מבחן מחר במתמטיקה', 'החדר פנוי', 'יש מקום פנוי', 'החדר לא פנוי, עוברים ל-14', 'חדר 12 תפוס']) assert.equal(detectAvailability(text), null, text);
  });
});

describe('free-check: readTimes ("ב-5" = 17:00; כשלא ברור, שתי קריאות)', () => {
  test('מספר חשוף בלי דקות: הקריאה בשעות הערות בלבד', () => {
    assert.deepEqual(readTimes('ב-5'), ['17:00']);
    assert.deepEqual(readTimes('ב-6'), ['18:00']);
    assert.deepEqual(readTimes('ב-3'), ['15:00']);
  });
  test('שתי הקריאות בשעות הערות: שתיהן (09:00 / 21:00)', () => assert.deepEqual(readTimes('ב-9'), ['09:00', '21:00']));
  test('שעה מפורשת או מילת חלק-יום: כמו שהיא', () => {
    assert.deepEqual(readTimes('ב-17:30'), ['17:30']);
    assert.deepEqual(readTimes('בשמונה בערב'), ['20:00']);
    assert.deepEqual(readTimes('ב-5 בבוקר'), ['05:00']);
  });
  test('אין שעה: []', () => assert.deepEqual(readTimes('מחר'), []));
});

describe('free-check: freeCheckWhen', () => {
  test('"יום ג\' ב-6?": שלישי 24.11 ב-18:00', () => {
    assert.deepEqual(freeCheckWhen({ text: "יום ג' ב-6?", receivedAt: RECEIVED }), { dates: ['2026-11-24'], times: ['18:00'], endTime: null });
  });
  test('בלי תאריך: היום; בלי שעה: []', () => {
    assert.deepEqual(freeCheckWhen({ text: 'אני פנוי?', receivedAt: RECEIVED }), { dates: ['2026-11-21'], times: [], endTime: null });
  });
  test('ביטויים מהמוח (מילה במילה) גוברים על הקריאה מהטקסט', () => {
    assert.deepEqual(freeCheckWhen({ text: 'נו, מה עם מחר בערב, נגיד ב-6?', receivedAt: RECEIVED, dateText: 'מחר', timeText: 'ב-6' }), { dates: ['2026-11-22'], times: ['18:00'], endTime: null });
  });
  test('טווח: "מ-5 עד 7" = 17:00 עד 19:00', () => {
    assert.deepEqual(freeCheckWhen({ text: 'אני פנוי מחר מ-5 עד 7?', receivedAt: RECEIVED }), { dates: ['2026-11-22'], times: ['17:00'], endTime: '19:00' });
  });
});

describe('free-check: loadBusy', () => {
  test('מערכת השעות כבלוק "בית ספר", אירועי events, ואירועי Google בלי כפילות של מה שכבר ב-events', async () => {
    const googleDay = async () => ({ ok: true, events: [
      { id: 'g-1', title: 'אימון', startsAt: '2026-11-24T15:00:00.000Z', endsAt: '2026-11-24T17:00:00.000Z' },
      { id: 'g-2', title: 'שיעור פסנתר', startsAt: '2026-11-24T18:00:00.000Z', endsAt: '2026-11-24T19:00:00.000Z' },
      { id: 'g-3', title: 'יום הולדת', startsAt: null, endsAt: null },
    ] });
    const busy = await loadBusy({ sql: eventsSql(), dateIso: '2026-11-24', timetable: TIMETABLE, googleDay, exams: [] });
    assert.deepEqual(busy.items, [
      { title: 'בית ספר', start: '08:15', end: '15:45', domain: 'school' },
      { title: 'אימון', start: '17:00', end: '19:00', domain: 'running' },
      { title: 'שיעור פסנתר', start: '20:00', end: '21:00', domain: 'google' },
    ]);
    assert.equal(busy.google, 'ok');
    assert.equal(busy.timetable, true);
  });
  test('השאילתה: planned בלבד וחופפת ליום; בלי location ו-description', async () => {
    const sql = eventsSql();
    await loadBusy({ sql, dateIso: '2026-11-24', timetable: null, exams: [] });
    const [call] = sql.find('FROM events');
    assert.match(call.text, /status = 'planned'/);
    assert.doesNotMatch(call.text, /location|description/);
  });
  test('מבחן עם שעה נכנס כפריט; Google נכשל או לא חובר: מסומן', async () => {
    const exams = [{ date: '2026-11-24', type: 'מבחן', subject: 'מתמטיקה' }];
    const busy = await loadBusy({ sql: eventsSql([]), dateIso: '2026-11-24', timetable: TIMETABLE, googleDay: async () => ({ ok: false, reason: 'x' }), exams });
    assert.deepEqual(busy.items.find((item) => item.domain === 'exam'), { title: 'מבחן במתמטיקה', start: '08:15', end: '09:00', domain: 'exam' });
    assert.equal(busy.google, 'failed');
    assert.equal((await loadBusy({ sql: eventsSql([]), dateIso: '2026-11-24', timetable: TIMETABLE, exams: [] })).google, 'skipped');
  });
  test('חופשה: אין בלוק בית ספר', async () => {
    const vacations = [{ from: '2026-11-22', to: '2026-11-26' }];
    const busy = await loadBusy({ sql: eventsSql([]), dateIso: '2026-11-24', timetable: TIMETABLE, exams: [], vacations });
    assert.deepEqual(busy.items, []);
  });
  test('excludeDomains: חלון "לא זמין" לא נחשב התנגשות', async () => {
    const window = { title: 'לא זמין', starts_at: '2026-11-24T15:00:00.000Z', ends_at: '2026-11-24T16:00:00.000Z', domain: 'unavailable', external_id: null };
    const busy = await loadBusy({ sql: eventsSql([window]), dateIso: '2026-11-24', timetable: null, exams: [], excludeDomains: ['unavailable'] });
    assert.deepEqual(busy.items, []);
  });
});

describe('free-check: composeFreeAnswer (הנוסח של ח-6)', () => {
  const busy = { items: [{ title: 'בית ספר', start: '08:15', end: '15:45' }, { title: 'אימון', start: '17:00', end: '19:00' }], google: 'ok', timetable: true };
  const FOOT = 'נבדק רק מול מה שהמערכת מכירה: מערכת השעות, היומן שלה ו-Google.';
  test('תפוס: מה יש ומתי פנוי', () => {
    assert.equal(composeFreeAnswer({ dateIso: '2026-11-24', today: '2026-11-21', times: ['18:00'], busy }), `שלישי 24.11 ב-18:00 תפוס: אימון 17:00–19:00. פנוי מ-19:00.\n${FOOT}`);
  });
  test('פנוי', () => {
    assert.equal(composeFreeAnswer({ dateIso: '2026-11-22', today: '2026-11-21', times: ['16:00'], busy: { items: [], google: 'ok', timetable: true } }), `מחר ב-16:00 פנוי.\n${FOOT}`);
  });
  test('פריטים רצופים: "פנוי מ-" אחרי כל הרצף', () => {
    const chain = { items: [{ title: 'אימון', start: '17:00', end: '19:00' }, { title: 'שיעור', start: '19:00', end: '20:00' }], google: 'ok', timetable: true };
    assert.match(composeFreeAnswer({ dateIso: '2026-11-24', today: '2026-11-21', times: ['18:00'], busy: chain }), /תפוס: אימון 17:00–19:00\. פנוי מ-20:00\./);
  });
  test('טווח חופף: תפוס', () => {
    assert.match(composeFreeAnswer({ dateIso: '2026-11-24', today: '2026-11-21', times: ['16:00'], endTime: '17:30', busy }), /16:00–17:30 תפוס: אימון 17:00–19:00/);
  });
  test('בלי שעה: רשימת היום, או "אין כלום"', () => {
    assert.equal(composeFreeAnswer({ dateIso: '2026-11-24', today: '2026-11-21', times: [], busy }), `שלישי 24.11: בית ספר 08:15–15:45, אימון 17:00–19:00.\n${FOOT}`);
    assert.equal(composeFreeAnswer({ dateIso: '2026-11-21', today: '2026-11-21', times: [], busy: { items: [], google: 'ok', timetable: true } }), `היום אין כלום ביומן.\n${FOOT}`);
  });
  test('שתי קריאות לשעה: שורה לכל אחת', () => {
    const text = composeFreeAnswer({ dateIso: '2026-11-24', today: '2026-11-21', times: ['09:00', '21:00'], busy });
    assert.match(text, /ב-09:00 תפוס: בית ספר 08:15–15:45\. פנוי מ-15:45\./);
    assert.match(text, /ב-21:00 פנוי\./);
  });
  test('Google לא נבדק ומערכת שעות חסרה: נאמר במפורש', () => {
    const text = composeFreeAnswer({ dateIso: '2026-11-22', today: '2026-11-21', times: ['16:00'], busy: { items: [], google: 'failed', timetable: false } });
    assert.match(text, /נבדק רק מול מה שהמערכת מכירה: היומן שלה\. Google לא נבדק\. מערכת השעות לא נטענה\./);
  });
});

describe('free-check: answerFreeCheck', () => {
  test('"יום ג\' ב-6?" מול אימון 17:00-19:00: "תפוס ... פנוי מ-19:00"', async () => {
    const text = await answerFreeCheck({ sql: eventsSql(), text: "יום ג' ב-6?", receivedAt: RECEIVED, timetable: TIMETABLE, exams: [] });
    assert.match(text, /^שלישי 24\.11 ב-18:00 תפוס: אימון 17:00–19:00\. פנוי מ-19:00\./);
  });
  test('Google נקרא ליום הנבדק בלבד', async () => {
    const seen = [];
    await answerFreeCheck({ sql: eventsSql([]), text: "יום ג' ב-6?", receivedAt: RECEIVED, timetable: null, exams: [], googleDay: async (dateIso) => { seen.push(dateIso); return { ok: true, events: [] }; } });
    assert.deepEqual(seen, ['2026-11-24']);
  });
});

describe('free-check: בצינור הקליטה ובמוח', () => {
  const SRC_ID = '11111111-1111-4111-8111-111111111111';
  const src = (text, channel = 'app') => ({ id: SRC_ID, channel, raw_content: text, content_hash: 'h', received_at: RECEIVED });
  const intakeSql = () => fakeSql((text) => {
    if (text.includes('FROM events')) return [TRAINING];
    if (text.includes('WITH claim AS')) return [{ claimed: 1, bubbles_written: 1 }];
    return [];
  });
  test('מוקלד בלי מוח: "אני פנוי ביום ג\' ב-6?" נענה מיד, בבועה, והמקור נתפס', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const sql = intakeSql();
    const out = await processSource({ sql, source: src("אני פנוי ביום ג' ב-6?"), timetable: null });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^שלישי 24\.11 ב-18:00 תפוס: אימון 17:00–19:00\. פנוי מ-19:00\./);
    const [write] = sql.find('WITH claim AS');
    assert.ok(write.values.includes(out.reply));
    assert.match(write.text, /UPDATE sources SET processed_at = now\(\)/);
  });
  test('מועבר עם המוח: kind free_check, הביטויים מהמוח, החישוב בקוד', async () => {
    const { processSource } = await import('../lib/intake-process.js');
    const understanding = { kind: 'free_check', subject: null, topic: null, date_text: "יום ג'", new_date_text: null, time_text: 'ב-6', new_room: null, uncertain: [] };
    const out = await processSource({ sql: intakeSql(), source: src("יום ג' ב-6?", 'shortcut'), timetable: null, understand: async () => ({ ok: true, model: 'm', understanding }) });
    assert.equal(out.brain, 'ok');
    assert.match(out.reply, /תפוס: אימון 17:00–19:00\. פנוי מ-19:00\./);
  });
  test('המוח: שני הסוגים החדשים ברשימה הסגורה ובפרומפט; ביטוי שלא בהודעה נפסל', async () => {
    const { BRAIN_KINDS, buildPrompt, isValidUnderstanding } = await import('../lib/intake-brain.js');
    assert.ok(BRAIN_KINDS.includes('unavailable') && BRAIN_KINDS.includes('free_check'));
    const prompt = buildPrompt({ text: 'x' });
    assert.match(prompt, /unavailable: /);
    assert.match(prompt, /free_check: /);
    const base = { subject: null, topic: null, new_date_text: null, new_room: null, uncertain: [] };
    assert.equal(isValidUnderstanding({ ...base, kind: 'free_check', date_text: "יום ג'", time_text: 'ב-6' }, "יום ג' ב-6?"), true);
    assert.equal(isValidUnderstanding({ ...base, kind: 'free_check', date_text: 'מחר', time_text: 'ב-6' }, "יום ג' ב-6?"), false);
  });
});

describe('free-check: googleDayFromEnv ונקודת הקליטה', () => {
  test('בלי הגדרות Google: undefined (אין קריאה לרשת); עם הגדרות: פונקציה', async () => {
    const { googleDayFromEnv } = await import('../lib/free-check.js');
    assert.equal(googleDayFromEnv({ sql: fakeSql(), env: {} }), undefined);
    assert.equal(typeof googleDayFromEnv({ sql: fakeSql(), env: { GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', TOKEN_ENC_KEY: 'c' } }), 'function');
  });
  test('api/intake.js מעביר את googleDay לצינור', async () => {
    const { handle } = await import('../api/intake.js');
    const { formRequest, FAKE_SECRET } = await import('./helpers.js');
    const googleDay = async () => ({ ok: true, events: [] });
    let seen = null;
    const sql = fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: '11111111-1111-4111-8111-111111111111', received_at: RECEIVED }] : []));
    await handle(formRequest({ text: 'אני פנוי מחר?', channel: 'app' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, googleDay, processor: async (args) => { seen = args; return { status: 'unclassified', reply: 'התקבל' }; },
    });
    assert.equal(seen.googleDay, googleDay);
  });
});
