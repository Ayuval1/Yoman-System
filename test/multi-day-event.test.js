// אירוע אישי כללי: יום שלם או כמה ימים ("חופשה בווינה מ30.11-3.12"). דרך ב: המוח מציע, הקוד שומר.
// בלי רשת ובלי מסד. כל השמות מומצאים. ה-SQL לא הורץ מול Postgres.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { eventBody, eventTimes, allDayDates } from '../lib/event-sync.js';

const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

// 30.11.2026 00:00 ישראל (חורף, UTC+2) = 29.11 22:00 UTC; 4.12 00:00 ישראל = 3.12 22:00 UTC (בלעדי: אחרי 3.12).
const multiDayRow = (over = {}) => ({
  id: EVENT_ID, title: 'חופשה בווינה', starts_at: new Date('2026-11-29T22:00:00.000Z'), ends_at: new Date('2026-12-03T22:00:00.000Z'),
  domain: 'personal', status: 'planned', external_id: null, match_key: 'source:11111111-1111-4111-8111-111111111111', ...over,
});

describe('event-sync: יום שלם וכמה ימים', () => {
  test('allDayDates: שני הגבולות ב-00:00 בישראל, הסיום בלעדי', () => {
    assert.deepEqual(allDayDates(multiDayRow()), { start: '2026-11-30', end: '2026-12-04' });
  });
  test('allDayDates: אירוע עם שעות הוא לא יום שלם', () => {
    assert.equal(allDayDates(multiDayRow({ starts_at: new Date('2026-11-30T13:00:00.000Z'), ends_at: new Date('2026-11-30T14:00:00.000Z') })), null);
    assert.equal(allDayDates(multiDayRow({ ends_at: new Date('2026-12-03T23:00:00.000Z') })), null); // סיום ב-01:00
  });
  test('allDayDates: אותו רגע או סיום לפני ההתחלה: null', () => {
    assert.equal(allDayDates(multiDayRow({ ends_at: new Date('2026-11-29T22:00:00.000Z') })), null);
    assert.equal(allDayDates(multiDayRow({ ends_at: new Date('2026-11-28T22:00:00.000Z') })), null);
  });
  test('allDayDates: קיץ (UTC+3) נקרא נכון', () => {
    const row = multiDayRow({ starts_at: new Date('2026-07-09T21:00:00.000Z'), ends_at: new Date('2026-07-11T21:00:00.000Z') }); // 10.7 00:00 עד 12.7 00:00 ישראל
    assert.deepEqual(allDayDates(row), { start: '2026-07-10', end: '2026-07-12' });
  });
  test('eventTimes: date ולא dateTime', () => {
    assert.deepEqual(eventTimes(multiDayRow()), { start: { date: '2026-11-30' }, end: { date: '2026-12-04' } });
  });
  test('eventBody: אישי + כמה ימים = צבע 9 ותזכורות שבוע, יומיים ויום', () => {
    assert.deepEqual(eventBody(multiDayRow()), {
      summary: 'חופשה בווינה',
      start: { date: '2026-11-30' },
      end: { date: '2026-12-04' },
      colorId: '9',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10080 }, { method: 'popup', minutes: 2880 }, { method: 'popup', minutes: 1440 }] },
    });
  });
  test('eventBody: יום שלם בתחום בית ספר: date, בלי צבע ותזכורות', () => {
    assert.deepEqual(Object.keys(eventBody(multiDayRow({ domain: 'school' }))), ['summary', 'start', 'end']);
  });
  test('eventBody: אירוע אישי רגיל (עם שעות) לא השתנה', () => {
    const row = multiDayRow({ starts_at: new Date('2026-10-27T15:30:00.000Z'), ends_at: new Date('2026-10-27T16:30:00.000Z') });
    assert.deepEqual(Object.keys(eventBody(row)), ['summary', 'start', 'end']);
    assert.equal(eventBody(row).start.dateTime, '2026-10-27T15:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// החילוץ בקוד (בלי מוח): טווח תאריכים מפורש + מילת אירוע
// ---------------------------------------------------------------------------
import { extractFacts, validRangeEnd, MAX_EVENT_SPAN_DAYS, isUnderstood } from '../lib/intake-facts.js';
import { classifyAll } from '../lib/intake-dictionary.js';
import { buildQuestion, formatReply, applyAnswer } from '../lib/intake-questions.js';
import { processSource } from '../lib/intake-process.js';
import { isValidUnderstanding, mergeUnderstanding, buildPrompt, UNCERTAIN_FIELDS } from '../lib/intake-brain.js';
import { decideMatch, readChange, eventLabel, loadEventPool } from '../lib/event-match.js';
import { fakeSql } from './helpers.js';

const NOW = new Date('2026-11-24T08:30:00+02:00'); // שלישי 24.11.2026 (חורף, UTC+2)
const valueOf = (result, field) => result.facts.find((fact) => fact.field === field)?.value;
const SENTENCE = 'חופשה בווינה מ30.11-3.12';

describe('טווח מפורש בקוד (מילון)', () => {
  test('המשפט מהכשל: חופשה בווינה מ30.11-3.12 = אירוע אישי של 30.11 עד 3.12, בלי שעה', () => {
    const result = extractFacts({ text: SENTENCE, receivedAt: NOW, channel: 'app' });
    assert.equal(result.type, 'personal_event');
    assert.equal(valueOf(result, 'date'), '2026-11-30');
    assert.equal(valueOf(result, 'end_date'), '2026-12-03');
    assert.equal(valueOf(result, 'topic'), 'חופשה בווינה');
    assert.equal(valueOf(result, 'time'), undefined);
    assert.equal(valueOf(result, 'end_time'), undefined);
    assert.deepEqual(result.missing, []);
    assert.equal(result.understood, true);
  });
  test('צורות נוספות: "מ-30.11 עד 3.12", "30.11–3.12", "2-4.2"', () => {
    const cases = [
      ['טיול מ-30.11 עד 3.12', '2026-11-30', '2026-12-03'],
      ['נסיעה 30.11–3.12', '2026-11-30', '2026-12-03'],
      ['טיול שנתי 2-4.2', '2027-02-02', '2027-02-04'],
      ['מחנה קיץ מ-2 עד 4.2', '2027-02-02', '2027-02-04'],
      ['תחרות 5.12-6.12', '2026-12-05', '2026-12-06'],
    ];
    for (const [text, date, end] of cases) {
      const result = extractFacts({ text, receivedAt: NOW, channel: 'app' });
      assert.equal(result.type, 'personal_event', text);
      assert.equal(valueOf(result, 'date'), date, text);
      assert.equal(valueOf(result, 'end_date'), end, text);
    }
  });
  test('כותרת: "טיול שנתי 2-4.2" -> "טיול שנתי"', () => {
    assert.equal(valueOf(extractFacts({ text: 'טיול שנתי 2-4.2', receivedAt: NOW, channel: 'app' }), 'topic'), 'טיול שנתי');
  });
  test('רק בערוץ app (כמו שאר האירועים האישיים)', () => {
    assert.equal(classifyAll(SENTENCE, { channel: 'shortcut' }), null);
    assert.equal(classifyAll(SENTENCE), null);
    assert.equal(classifyAll(SENTENCE, { channel: 'app' }).type, 'personal_event');
  });
  test('שמרני: מילת אירוע בלי טווח מפורש, או טווח בלי מילת אירוע, לא נתפסים', () => {
    assert.equal(classifyAll('חופשה בווינה בסוף השבוע', { channel: 'app' }), null);
    assert.equal(classifyAll('אני בבית מ-30.11 עד 3.12', { channel: 'app' }), null);
    assert.equal(classifyAll('חופשה 30.11 3.12', { channel: 'app' }), null); // רווח בלבד אינו טווח
    assert.equal(classifyAll('אחי נוסע לטיול 2-4.2', { channel: 'app' }), null); // של מישהו אחר
    assert.equal(classifyAll('אין חופשה מ-30.11 עד 3.12', { channel: 'app' }), null); // שלילה
  });
  test('טווח הפוך: date נקרא, end_date לא נשמר ונשאל (ambiguous), לא מובן', () => {
    const result = extractFacts({ text: 'מחנה קיץ 3.12-30.11', receivedAt: NOW, channel: 'app' });
    assert.equal(valueOf(result, 'date'), '2026-12-03');
    assert.equal(valueOf(result, 'end_date'), undefined);
    assert.deepEqual(result.ambiguous, [{ field: 'end_date', candidates: [] }]);
    assert.equal(result.certainty, 'uncertain');
    assert.equal(result.understood, false);
  });
  test('יותר מ-60 ימים: end_date לא נשמר ונשאל', () => {
    const result = extractFacts({ text: 'טיול 1.12-1.3', receivedAt: NOW, channel: 'app' });
    assert.equal(valueOf(result, 'end_date'), undefined);
    assert.deepEqual(result.ambiguous, [{ field: 'end_date', candidates: [] }]);
  });
  test('אירוע אישי ביום אחד עם שעה: לא השתנה', () => {
    const result = extractFacts({ text: 'תור לרופא שיניים ב-16:00', receivedAt: NOW, channel: 'app' });
    assert.equal(valueOf(result, 'time'), '16:00');
    assert.equal(valueOf(result, 'end_time'), '17:00');
    assert.equal(valueOf(result, 'end_date'), undefined);
  });
});

describe('validRangeEnd', () => {
  test('תקין: אחרי ההתחלה ועד 60 ימים', () => {
    assert.equal(validRangeEnd('2026-11-30', '2026-12-03'), '2026-12-03');
    assert.equal(validRangeEnd('2026-11-30', '2026-12-01'), '2026-12-01');
    assert.equal(validRangeEnd('2026-11-30', '2027-01-29'), '2027-01-29'); // 60 ימים בדיוק
    assert.equal(MAX_EVENT_SPAN_DAYS, 60);
  });
  test('לא תקין: אותו יום, הפוך, יותר מ-60, או לא תאריך', () => {
    assert.equal(validRangeEnd('2026-11-30', '2026-11-30'), null);
    assert.equal(validRangeEnd('2026-12-03', '2026-11-30'), null);
    assert.equal(validRangeEnd('2026-11-30', '2027-01-30'), null); // 61
    assert.equal(validRangeEnd('2026-11-30', 'unknown'), null);
    assert.equal(validRangeEnd(undefined, '2026-12-03'), null);
    assert.equal(validRangeEnd('2026-11-31', '2026-12-03'), null);
  });
  test('isUnderstood: טווח תקין בלי שעה מובן; יום אחד בלי שעה לא', () => {
    assert.equal(isUnderstood('personal_event', [{ field: 'date', value: '2026-11-30' }, { field: 'end_date', value: '2026-12-03' }]), true);
    assert.equal(isUnderstood('personal_event', [{ field: 'date', value: '2026-11-30' }]), false);
  });
});

// ---------------------------------------------------------------------------
// כרטיס האישור וההודעה
// ---------------------------------------------------------------------------
describe('כרטיס האישור והתשובה', () => {
  test('כמה ימים: "חופשה בווינה, 30.11–3.12, כל היום. נכון?"', () => {
    const facts = [{ field: 'date', value: '2026-11-30' }, { field: 'end_date', value: '2026-12-03' }, { field: 'topic', value: 'חופשה בווינה' }];
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts, today: '2026-11-24' }).text, 'חופשה בווינה, 30.11–3.12, כל היום. נכון?');
  });
  test('יום אחד עם שעה: הכרטיס לא השתנה', () => {
    const facts = [{ field: 'date', value: '2026-11-24' }, { field: 'time', value: '16:00' }, { field: 'end_time', value: '17:00' }, { field: 'topic', value: 'בדיקה רפואית' }];
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts, today: '2026-11-24' }).text, 'בדיקה רפואית, היום 16:00 עד 17:00. נכון?');
  });
  test('שאלת end_date: "עד איזה תאריך?" ותשובה חופשית מפוענחת', () => {
    assert.equal(buildQuestion({ field: 'end_date', type: 'personal_event', candidates: [] }).text, 'עד איזה תאריך?');
    const facts = applyAnswer({ facts: [], field: 'end_date', answer: '5.12', receivedAt: NOW });
    assert.equal(facts.find((fact) => fact.field === 'end_date').value, '2026-12-05');
  });
  test('formatReply עם endDate: טווח במקום יום בשבוע', () => {
    assert.equal(formatReply({ type: 'personal_event', title: 'חופשה בווינה', date: '2026-11-30', endDate: '2026-12-03' }), 'נרשם · אירוע אישי · חופשה בווינה · 30.11–3.12');
    assert.equal(formatReply({ type: 'personal_event', title: 'בדיקה', date: '2026-11-30' }), 'נרשם · אירוע אישי · בדיקה · שני 30.11');
  });
});

// ---------------------------------------------------------------------------
// הצינור: שורת האירוע, בלי שאלת שעה
// ---------------------------------------------------------------------------
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const typedSource = (text) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: `hash-${text}`, received_at: NOW });
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));

describe('processSource: כמה ימים', () => {
  test('שורת האירוע: התחלה 30.11 00:00, סיום 4.12 00:00 (היום שאחרי האחרון), personal, כותרת = הנושא', async () => {
    const sql = fakeSql(() => []);
    const result = await processSource({ sql, source: typedSource(SENTENCE), timetable: null });
    const call = writesOf(sql)[0];
    assert.deepEqual(JSON.parse(call.values.at(-1)), [{
      title: 'חופשה בווינה', domain: 'personal', start_date: '2026-11-30', start_time: '00:00', end_date: '2026-12-04', end_time: '00:00', movable: null, match_key: `source:${SRC_ID}`,
    }]);
    assert.equal(result.reply, 'נרשם · אירוע אישי · חופשה בווינה · 30.11–3.12');
  });
  test('השאלה הראשונה היא כרטיס האישור, לא "באיזו שעה?"', async () => {
    const sql = fakeSql(() => []);
    await processSource({ sql, source: typedSource(SENTENCE), timetable: null });
    const texts = writesOf(sql)[0].values.filter((value) => typeof value === 'string');
    assert.ok(texts.includes('חופשה בווינה, 30.11–3.12, כל היום. נכון?'));
    assert.ok(!texts.includes('באיזו שעה?'));
  });
  test('טווח הפוך: שואלים "עד איזה תאריך?", לא כותבים אירוע', async () => {
    const sql = fakeSql(() => []);
    await processSource({ sql, source: typedSource('מחנה קיץ 3.12-30.11'), timetable: null });
    const call = writesOf(sql)[0];
    assert.deepEqual(JSON.parse(call.values.at(-1)), []);
    assert.ok(call.values.includes('עד איזה תאריך?'));
  });
  test('אירוע אישי ביום אחד עם שעה: שורת האירוע כמו קודם (שעה ושעה אחרי)', async () => {
    const sql = fakeSql(() => []);
    await processSource({ sql, source: typedSource('תור לרופא שיניים ב-16:00'), timetable: null });
    const [row] = JSON.parse(writesOf(sql)[0].values.at(-1));
    assert.equal(row.start_time, '16:00');
    assert.equal(row.end_time, '17:00');
    assert.equal(row.start_date, row.end_date);
  });
});

// ---------------------------------------------------------------------------
// המוח
// ---------------------------------------------------------------------------
const brain = (over = {}) => ({ kind: 'personal_event', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [], ...over });

describe('המוח: end_date_text', () => {
  test('הפרומפט מתאר אירוע אישי כללי ואת end_date_text', () => {
    const prompt = buildPrompt({ text: SENTENCE });
    assert.match(prompt, /personal_event: כל אירוע של יובל/); // 25.11.2026: גם אירוע בבית הספר (test/lesson-event.test.js)
    assert.match(prompt, /חופשה/);
    assert.match(prompt, /end_date_text/);
    assert.ok(UNCERTAIN_FIELDS.includes('end_date'));
  });
  test('פורמט: end_date_text חייב להופיע בהודעה מילה במילה; end_date מותר ב-uncertain', () => {
    const text = 'מחנה מיום ראשון עד יום רביעי';
    assert.equal(isValidUnderstanding(brain({ end_date_text: 'יום רביעי' }), text), true);
    assert.equal(isValidUnderstanding(brain({ end_date_text: 'יום חמישי' }), text), false);
    assert.equal(isValidUnderstanding(brain({ uncertain: ['end_date'] }), text), true);
    assert.equal(isValidUnderstanding(brain({ end_date_text: 'x'.repeat(201) }), 'x'.repeat(201)), false);
  });
  test('מיזוג: תאריך התחלה וסוף נקראים בקוד מהביטויים, בלי שעה', () => {
    const text = 'מחנה קיץ ליום רביעי עד ליום ראשון';
    const extracted = extractFacts({ text, receivedAt: NOW, channel: 'app', forcedType: 'personal_event' });
    const merged = mergeUnderstanding({ extracted, understanding: brain({ topic: 'מחנה קיץ', date_text: 'ליום רביעי', end_date_text: 'ליום ראשון' }), receivedAt: NOW, text });
    const get = (field) => merged.facts.find((fact) => fact.field === field)?.value;
    assert.equal(get('date'), '2026-11-25'); // רביעי הקרוב אחרי שלישי 24.11
    assert.equal(get('end_date'), '2026-11-29'); // ראשון הקרוב
  });
  test('מיזוג: סוף הפוך, אותו יום או רחוק מ-60 ימים נשאל ולא נשמר', () => {
    for (const end of ['29.11', '30.11', '1.5']) {
      const text = `מסע ב-30.11 וחוזר ב-${end}`;
      const extracted = extractFacts({ text: 'מסע ב-30.11', receivedAt: NOW, channel: 'app', forcedType: 'personal_event' });
      const merged = mergeUnderstanding({ extracted, understanding: brain({ topic: 'מסע', date_text: 'ב-30.11', end_date_text: `ב-${end}` }), receivedAt: NOW, text });
      assert.equal(merged.facts.find((fact) => fact.field === 'end_date'), undefined, end);
      assert.deepEqual(merged.ambiguous.find((entry) => entry.field === 'end_date'), { field: 'end_date', candidates: [] }, end);
      assert.equal(merged.understood, false, end);
    }
  });
  test('מיזוג: סוף חוקי של המוח נשמר, ובלי שעה', () => {
    const text = 'מסע ב-30.11 וחוזר ב-3.12';
    const extracted = extractFacts({ text: 'מסע ב-30.11', receivedAt: NOW, channel: 'app', forcedType: 'personal_event' });
    const merged = mergeUnderstanding({ extracted, understanding: brain({ topic: 'מסע', date_text: 'ב-30.11', end_date_text: 'ב-3.12', time_text: null }), receivedAt: NOW, text });
    assert.equal(merged.facts.find((fact) => fact.field === 'end_date')?.value, '2026-12-03');
    assert.equal(merged.facts.find((fact) => fact.field === 'time'), undefined);
    assert.equal(merged.understood, true);
  });
  test('מיזוג: המוח סימן end_date uncertain: נשאל', () => {
    const text = 'חופשה בווינה בשבוע הבא';
    const extracted = extractFacts({ text, receivedAt: NOW, channel: 'app', forcedType: 'personal_event' });
    const merged = mergeUnderstanding({ extracted, understanding: brain({ topic: 'חופשה בווינה', uncertain: ['end_date'] }), receivedAt: NOW, text });
    assert.deepEqual(merged.ambiguous.find((entry) => entry.field === 'end_date'), { field: 'end_date', candidates: [] });
  });
  test('מיזוג: אירוע ביום אחד נשאר כמו שהיה (בלי end_date_text)', () => {
    const text = 'פגישה מחר ב-16:00';
    const extracted = extractFacts({ text, receivedAt: NOW, channel: 'app', forcedType: 'personal_event' });
    const merged = mergeUnderstanding({ extracted, understanding: brain({ topic: 'פגישה', date_text: 'מחר', time_text: 'ב-16:00' }), receivedAt: NOW, text });
    assert.equal(merged.facts.find((fact) => fact.field === 'time')?.value, '16:00');
    assert.equal(merged.facts.find((fact) => fact.field === 'end_date'), undefined);
  });
});

// ---------------------------------------------------------------------------
// זיהוי אירוע קיים (event-match): ביטול וכפילות של אירוע של כמה ימים
// ---------------------------------------------------------------------------
describe('event-match: אירוע של כמה ימים', () => {
  const vacation = { id: 'cccccccc-1111-4111-8111-111111111111', title: 'חופשה בווינה', date: '2026-11-30', time: '00:00', endDate: '2026-12-03', domain: 'personal', sourceId: SRC_ID };
  const decide = (text, type, facts, today = '2026-11-24') => decideMatch({ pool: [vacation], text, type, today, change: readChange({ type, facts, text, receivedAt: NOW }) });

  test('"החופשה בווינה בוטלה": מוצאים את האירוע וקובעים ביטול', () => {
    const decision = decide('החופשה בווינה בוטלה', 'cancel', []);
    assert.equal(decision.kind, 'update');
    assert.equal(decision.candidate.id, vacation.id);
    assert.equal(decision.target.cancel, true);
  });
  test('ביטול באמצע החופשה (2.12) עדיין מוצא אותה', () => {
    assert.equal(decide('החופשה בווינה בוטלה', 'cancel', [], '2026-12-02').kind, 'update');
  });
  test('ביטול עם תאריך שבתוך הטווח (2.12) מוצא את האירוע', () => {
    const decision = decide('החופשה בווינה ב-2.12 בוטלה', 'cancel', [{ field: 'date', value: '2026-12-02', origin: 'read' }]);
    assert.equal(decision.kind, 'update');
  });
  test('אותו אירוע שוב (אותו תאריך התחלה): כפילות, לא אירוע שני', () => {
    const facts = [{ field: 'date', value: '2026-11-30', origin: 'read' }, { field: 'end_date', value: '2026-12-03', origin: 'read' }];
    assert.equal(decide(SENTENCE, 'personal_event', facts).kind, 'duplicate');
  });
  test('התווית: טווח בלי שעה', () => {
    assert.equal(eventLabel(vacation), 'חופשה בווינה · 30.11–3.12');
    assert.equal(eventLabel({ title: 'תור', date: '2026-11-30', time: '16:00' }), 'תור · שני 30.11 · 16:00');
  });
  test('loadEventPool: שורה של כמה ימים מקבלת endDate (היום האחרון, כולל)', async () => {
    const sql = fakeSql((text) => (text.includes('FROM events') ? [{
      id: vacation.id, title: 'חופשה בווינה', domain: 'personal', match_key: `source:${SRC_ID}`, start_date: '2026-11-30', start_time: '00:00', end_date: '2026-12-04', end_time: '00:00',
    }] : []));
    const pool = await loadEventPool(sql, NOW);
    assert.equal(pool[0].endDate, '2026-12-03');
  });
  test('loadEventPool: אירוע עם שעות לא מקבל endDate', async () => {
    const sql = fakeSql(() => [{ id: vacation.id, title: 'תור', domain: 'personal', match_key: `source:${SRC_ID}`, start_date: '2026-11-30', start_time: '16:00', end_date: '2026-11-30', end_time: '17:00' }]);
    assert.equal((await loadEventPool(sql, NOW))[0].endDate, undefined);
  });
});

// ---------------------------------------------------------------------------
// סבב התיקון אחרי "לא נכון" באירוע של כמה ימים
// ---------------------------------------------------------------------------
import { pendingQuestion, answerQuestion, TYPE_FIELD } from '../lib/intake-process.js';
import { writeMatched } from '../lib/event-match.js';
import { zonedToUtc } from '../lib/schedule-time.js';

const MSG_ID = '33333333-3333-4333-8333-333333333333';
const fx = (field, value, origin = 'read') => ({ field, value, origin });
const BASE = [fx(TYPE_FIELD, 'personal_event'), fx('date', '2026-11-30'), fx('end_date', '2026-12-03'), fx('topic', 'חופשה בווינה'), fx('confirm', 'no')];
const factsJsonOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && value.startsWith('[')));
async function answerTo(saved, reply) {
  const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
  const sql = fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [messageRow];
    if (text.includes('FROM sources WHERE id')) return [typedSource(SENTENCE)];
    if (text.includes('FROM facts WHERE source_id')) return saved;
    if (text.includes('INTO facts')) return [{ closed: 1 }];
    return [];
  });
  const result = await answerQuestion({ sql, messageId: MSG_ID, answer: reply, now: NOW, timetable: null });
  return { result, call: writesOf(sql)[0] };
}
const eventParams = (call) => ({ insert: JSON.parse(call.values[20]), update: JSON.parse(call.values[21]), cancel: JSON.parse(call.values[22]) });
const ROW = { title: 'חופשה בווינה', domain: 'personal', start_date: '2026-11-30', start_time: '00:00', end_date: '2026-12-04', end_time: '00:00', movable: null, match_key: `source:${SRC_ID}` };

describe('תיקון אחרי "לא נכון": כמה ימים', () => {
  test('כרטיס התיקון: "תאריך ההתחלה", "תאריך הסיום", "לא קורה" (בלי "השעה"); יום אחד כמו קודם', () => {
    const multi = buildQuestion({ field: 'fix', type: 'personal_event', facts: BASE });
    assert.deepEqual(multi.buttons, ['תאריך ההתחלה', 'תאריך הסיום', 'לא קורה']);
    const single = buildQuestion({ field: 'fix', type: 'personal_event', facts: [fx('date', '2026-11-30'), fx('time', '16:00')] });
    assert.deepEqual(single.buttons, ['השעה', 'התאריך', 'לא קורה']);
  });
  test('בחירת "תאריך הסיום" פותחת fix_end_date; "השעה" לא מתקבלת', async () => {
    assert.equal(pendingQuestion({ source: typedSource(SENTENCE), facts: BASE, timetable: null }).field, 'fix');
    assert.equal(pendingQuestion({ source: typedSource(SENTENCE), facts: [...BASE, fx('fix', 'end')], timetable: null }).field, 'fix_end_date');
    assert.equal(pendingQuestion({ source: typedSource(SENTENCE), facts: [...BASE, fx('fix', 'date')], timetable: null }).field, 'fix_date');
    const refused = await answerTo(BASE, 'השעה');
    assert.equal(refused.result.status, 'unclear');
    assert.equal(refused.call, undefined);
    const chosen = await answerTo(BASE, 'תאריך הסיום');
    assert.equal(chosen.result.status, 'answered');
    assert.deepEqual(factsJsonOf(chosen.call), [{ field: 'fix', value: 'end', origin: 'read' }]);
    assert.equal(chosen.result.reply, 'עד איזה תאריך?');
  });
  test('תיקון תאריך התחלה: כל הטווח זז באותו מספר ימים (30.11–3.12 -> 1.12–4.12), ובבועה הטווח החדש', async () => {
    const { result, call } = await answerTo([...BASE, fx('fix', 'date')], '1.12');
    assert.equal(result.reply, 'עודכן · אירוע אישי · חופשה בווינה · 1.12–4.12');
    assert.deepEqual(eventParams(call).update, [{ ...ROW, start_date: '2026-12-01', end_date: '2026-12-05' }]);
    assert.deepEqual(eventParams(call).cancel, []);
  });
  test('תיקון תאריך סיום: רק הסיום משתנה', async () => {
    const { result, call } = await answerTo([...BASE, fx('fix', 'end')], '5.12');
    assert.equal(result.reply, 'עודכן · אירוע אישי · חופשה בווינה · 30.11–5.12');
    assert.deepEqual(eventParams(call).update, [{ ...ROW, end_date: '2026-12-06' }]);
  });
  test('תאריך סיום לא תקין (לפני ההתחלה, אותו יום, מעל 60 ימים): שואלים שוב, לא כותבים', async () => {
    for (const reply of ['29.11', '30.11', '1.3']) {
      const { result, call } = await answerTo([...BASE, fx('fix', 'end')], reply);
      assert.equal(result.status, 'unclear', reply);
      assert.equal(call, undefined, reply);
    }
  });
  test('"לא קורה" באירוע של כמה ימים: ביטול כמו קודם', async () => {
    const { call } = await answerTo(BASE, 'לא קורה');
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix', value: 'cancel', origin: 'read' }]);
  });
});

// ---------------------------------------------------------------------------
// הזזת אירוע של כמה ימים ב-event-match: סיום בימי לוח, לא ב-24 שעות (מעבר שעון)
// ---------------------------------------------------------------------------
describe('event-match: הזזת אירוע של כמה ימים מעל מעבר שעון', () => {
  const run = async (candidate, target) => {
    const sql = fakeSql(() => [{ claimed: 1, updated: 1 }]);
    await writeMatched({ sql, sourceId: SRC_ID, candidate, target, facts: [], certainty: 'certain', bubble: 'עודכן' });
    return sql.calls[0];
  };
  const candidate = (date, endDate) => ({ id: 'cccccccc-1111-4111-8111-111111111111', title: 'חופשה', date, time: '00:00', endDate, domain: 'personal', sourceId: SRC_ID });

  test('סוף אוקטובר (25.10.2026, חזרה לשעון חורף): הסיום הוא 00:00 של היום שאחרי האחרון', async () => {
    const call = await run(candidate('2026-10-22', '2026-10-24'), { cancel: false, date: '2026-10-24', time: '00:00' });
    assert.match(call.text, /WHEN \?::text IS NOT NULL\s+THEN \(\(\?::text \|\| ' 00:00'\)::timestamp AT TIME ZONE 'Asia\/Jerusalem'\)/);
    assert.ok(call.values.includes('2026-10-27'), 'סיום 27.10 = 24.10 + 3 ימים');
    // מרווח של 72 שעות (הדרך הישנה) נוחת על 23:00 ופוסל "יום שלם"; בימי לוח זה 00:00
    const start = zonedToUtc('2026-10-24', '00:00');
    assert.equal(allDayDates({ starts_at: start, ends_at: new Date(start.getTime() + 72 * 3600000) }), null);
    assert.deepEqual(allDayDates({ starts_at: start, ends_at: zonedToUtc('2026-10-27', '00:00') }), { start: '2026-10-24', end: '2026-10-27' });
  });
  test('סוף מרץ (27.3.2026, מעבר לשעון קיץ): אותו דבר', async () => {
    const call = await run(candidate('2026-03-20', '2026-03-22'), { cancel: false, date: '2026-03-26', time: '00:00' });
    assert.ok(call.values.includes('2026-03-29'), 'סיום 29.3 = 26.3 + 3 ימים');
    const start = zonedToUtc('2026-03-26', '00:00');
    assert.equal(allDayDates({ starts_at: start, ends_at: new Date(start.getTime() + 72 * 3600000) }), null);
    assert.deepEqual(allDayDates({ starts_at: start, ends_at: zonedToUtc('2026-03-29', '00:00') }), { start: '2026-03-26', end: '2026-03-29' });
  });
  test('אירוע עם שעות: ההתנהגות הישנה (אין סיום של יום שלם)', async () => {
    const call = await run({ id: 'cccccccc-1111-4111-8111-111111111111', title: 'תור', date: '2026-10-24', time: '16:00', domain: 'personal', sourceId: SRC_ID }, { cancel: false, date: '2026-10-25', time: '17:00' });
    assert.ok(!call.values.some((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value !== '2026-10-25'));
    assert.ok(call.values.includes('17:00'));
  });
});

// ---------------------------------------------------------------------------
// סוף "לא יודע" (25.11.2026): בלי שעה = יום שלם אחד בתאריך ההתחלה, בלי שאלת שעה
// ---------------------------------------------------------------------------
describe('סוף לא ידוע ("לא יודע" על "עד איזה תאריך?")', () => {
  const TRIP = 'טיול שנתי 2.12-1.12'; // סוף לפני ההתחלה: end_date נשאל
  const OPEN = [fx(TYPE_FIELD, 'personal_event'), fx('date', '2026-12-02'), fx('topic', 'טיול שנתי')];
  const UNKNOWN_END = [...OPEN, fx('end_date', 'unknown')];
  const ALL_DAY_ROW = { title: 'טיול שנתי', domain: 'personal', start_date: '2026-12-02', start_time: '00:00', end_date: '2026-12-03', end_time: '00:00', movable: null, match_key: `source:${SRC_ID}` };
  async function answerWith(saved, reply) {
    const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
    const sql = fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [messageRow];
      if (text.includes('FROM sources WHERE id')) return [typedSource(TRIP)];
      if (text.includes('FROM facts WHERE source_id')) return saved;
      if (text.includes('INTO facts')) return [{ closed: 1 }];
      return [];
    });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: reply, now: NOW, timetable: null });
    return { result, call: writesOf(sql)[0] };
  }

  test('השאלה הבאה אחרי "לא יודע" היא כרטיס האישור "כל היום", לא שאלת שעה', () => {
    assert.equal(pendingQuestion({ source: typedSource(TRIP), facts: OPEN, timetable: null }).field, 'end_date');
    const next = pendingQuestion({ source: typedSource(TRIP), facts: UNKNOWN_END, timetable: null });
    assert.equal(next.field, 'confirm');
    assert.match(next.text, /כל היום/);
    assert.equal(next.text, 'טיול שנתי, רביעי 2.12, כל היום. נכון?');
  });
  test('מענה "לא יודע" נשמר ומחזיר את כרטיס האישור', async () => {
    const { result, call } = await answerWith(OPEN, 'לא יודע');
    assert.equal(result.status, 'answered');
    assert.deepEqual(factsJsonOf(call), [{ field: 'end_date', value: 'unknown', origin: 'read' }]);
    assert.match(result.reply, /כל היום/);
    assert.doesNotMatch(result.reply, /באיזו שעה/);
  });
  test('אישור "נכון": שורת יום שלם 00:00 עד 00:00 של מחר, בלי away', async () => {
    const { result, call } = await answerWith([...UNKNOWN_END, fx('confirm', 'pending')].filter((f) => f.field !== 'confirm'), 'נכון');
    assert.deepEqual(eventParams(call).insert, [ALL_DAY_ROW]);
    assert.equal(result.away, undefined);
  });
  test('תיקון תאריך אחרי "לא נכון": היום השלם זז לתאריך החדש', async () => {
    const { call } = await answerWith([...UNKNOWN_END, fx('confirm', 'no'), fx('fix', 'date')], '5.12');
    assert.deepEqual(eventParams(call).update, [{ ...ALL_DAY_ROW, start_date: '2026-12-05', end_date: '2026-12-06' }]);
  });
  test('"לא נכון" ביום שלם אחד: כפתורי התיקון בלי "השעה"', () => {
    const next = pendingQuestion({ source: typedSource(TRIP), facts: [...UNKNOWN_END, fx('confirm', 'no')], timetable: null });
    assert.equal(next.field, 'fix');
    assert.equal(next.buttons.some((b) => (b.label ?? b) === 'השעה'), false);
    assert.equal(next.buttons.some((b) => (b.label ?? b) === 'התאריך'), true);
  });
  test('תיקון שעה תקינה אחרי "לא נכון" (נתיב ישן, אם נשמר fix=time): אירוע עם שעות', async () => {
    const { call } = await answerWith([...UNKNOWN_END, fx('confirm', 'no'), fx('fix', 'time')], '16:00');
    assert.deepEqual(eventParams(call).update, [{ ...ALL_DAY_ROW, start_time: '16:00', end_date: '2026-12-02', end_time: '17:00' }]);
  });
  test('שעה ידועה יחד עם סוף לא ידוע: כרטיס עם שעה ולא כל היום (בלי שינוי)', () => {
    const next = pendingQuestion({ source: typedSource(TRIP), facts: [...UNKNOWN_END, fx('time', '16:00')], timetable: null });
    assert.equal(next.field, 'confirm');
    assert.doesNotMatch(next.text, /כל היום/);
    assert.match(next.text, /16:00/);
  });
  test('buildQuestion confirm: סוף לא ידוע בלי שעה = כל היום; עם שעה = לא', () => {
    const q = buildQuestion({ field: 'confirm', type: 'personal_event', facts: UNKNOWN_END });
    assert.match(q.text, /^טיול שנתי, .*, כל היום\. נכון\?$/);
    assert.doesNotMatch(buildQuestion({ field: 'confirm', type: 'personal_event', facts: [...UNKNOWN_END, fx('time', '16:00')] }).text, /כל היום/);
  });
  test('assessFacts ו-isUnderstood: סוף לא ידוע בלי שעה = שעה לא חיונית ומובן; עם unknown בשעה: אותו דבר', () => {
    const facts = [fx('date', '2026-12-02'), fx('end_date', 'unknown'), fx('topic', 'טיול שנתי')];
    assert.equal(assessFacts({ type: 'personal_event', facts }).missing.includes('time'), false);
    assert.equal(isUnderstood('personal_event', facts), true);
    assert.equal(isUnderstood('personal_event', [...facts, fx('time', 'unknown')]), true);
    // עם שעה תקינה: כמו קודם (שעה נדרשת וקיימת)
    assert.equal(isUnderstood('personal_event', [...facts, fx('time', '16:00')]), true);
    // בלי תאריך: לא מובן
    assert.equal(isUnderstood('personal_event', [fx('end_date', 'unknown')]), false);
  });
  test('formatReply: סוף לא ידוע נראה כתשובה של יום אחד', () => {
    const reply = formatReply({ type: 'personal_event', title: 'טיול שנתי', date: '2026-12-02', endDate: 'unknown' });
    assert.equal(reply, 'נרשם · אירוע אישי · טיול שנתי · רביעי 2.12');
  });
});
import { assessFacts } from '../lib/intake-facts.js';
