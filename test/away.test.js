// בדיקות ל-lib/away.js (שלב 2 של אירוע כללי, הכרעת יובל 24.11.2026): "חופשה בווינה" 30.11 עד 3.12.
// בלי רשת ובלי מסד: sql מזויף. ה-SQL לא רץ מול Postgres; הבדיקות מוודאות את הפרמטרים והזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole, fakeSql } from './helpers.js';
import {
  AWAY_ENTITY, AWAY_BUTTONS, awayRange, awayCovers, awayOn, nearestMakeup, planAway, awayText, offerAwayCards, answerAway,
} from '../lib/away.js';
import { loadBusy } from '../lib/free-check.js';
import { openWindows, freeSlots, loadBusyDays } from '../lib/time-suggest.js';
import { spacedSlots, examsToPlan } from '../lib/study-plan.js';
import { createListenSuggestion } from '../lib/listening.js';
import { composeBrief, briefCardData } from '../lib/brief-view.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { applyExamChanges } from '../lib/exam-line.js';
import { processSource } from '../lib/intake-process.js';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const MSG = '22222222-2222-4222-8222-222222222222';
// 30.11 00:00 עד 4.12 00:00 בשעון ישראל (UTC+2 בחורף)
const VACATION = { id: EVENT_ID, title: 'חופשה בווינה', domain: 'personal', status: 'planned', starts_at: '2026-11-29T22:00:00.000Z', ends_at: '2026-12-03T22:00:00.000Z' };
const SINGLE_ALL_DAY = { ...VACATION, ends_at: '2026-11-30T22:00:00.000Z' }; // יום אחד
const NOW = new Date('2026-11-24T19:00:00.000Z');
const EXAMS = [
  { date: '2026-12-01', type: 'מבחן', subject: 'מדעים', makeup: false },
  { date: '2026-12-03', type: 'מבחן', subject: 'ספרות', makeup: false },
  { date: '2026-12-08', type: 'מבדק', subject: 'היסטוריה', makeup: false }, // אחרי החופשה
  { date: '2026-11-23', makeup: true, type: 'מועד ב\'' },
  { date: '2026-12-14', makeup: true, type: 'מועד ב\'' },
  { date: '2026-12-23', makeup: true, type: 'מועד ב\'' },
];
const STUDY = [
  { title: 'למידה למבחן במדעים', domain: 'study', starts_at: '2026-11-30T13:00:00.000Z', ends_at: '2026-11-30T14:00:00.000Z', match_key: 'source:study:2026-12-01:מדעים:2026-11-30T15:00' },
  { title: 'למידה למבחן במדעים', domain: 'study', starts_at: '2026-12-01T13:00:00.000Z', ends_at: '2026-12-01T14:00:00.000Z', match_key: 'source:study:2026-12-01:מדעים:2026-12-01T15:00' },
];
const TRAINING = { title: 'אימון שני', domain: 'running', starts_at: '2026-11-30T14:00:00.000Z', ends_at: '2026-11-30T15:30:00.000Z', match_key: 'source:x' };

describe('away: טווח', () => {
  test('כמה ימים: start, last (כולל), כותרת; יום אחד או אירוע עם שעות: null', () => {
    assert.deepEqual(awayRange(VACATION), { id: EVENT_ID, title: 'חופשה בווינה', start: '2026-11-30', last: '2026-12-03' });
    assert.equal(awayRange(SINGLE_ALL_DAY), null);
    assert.equal(awayRange({ ...VACATION, starts_at: '2026-11-30T07:00:00.000Z' }), null);
    assert.equal(awayRange(null), null);
  });
  test('awayCovers: רק אישי ומתוכנן, וגם הימים הראשון והאחרון', () => {
    for (const day of ['2026-11-30', '2026-12-01', '2026-12-03']) assert.equal(awayCovers(VACATION, day), true, day);
    for (const day of ['2026-11-29', '2026-12-04']) assert.equal(awayCovers(VACATION, day), false, day);
    assert.equal(awayCovers({ ...VACATION, domain: 'school' }, '2026-12-01'), false);
    assert.equal(awayCovers({ ...VACATION, status: 'cancelled' }, '2026-12-01'), false);
  });
});

describe('away: ימים תפוסים (loadBusy / openWindows / הצעות)', () => {
  const busyOn = async (dateIso, rows = [VACATION]) => loadBusy({ sql: fakeSql(() => rows), dateIso, timetable: null, googleDay: undefined });
  test('יום בתוך האירוע: הפריט מסומן away, אין חלונות פתוחים ואין משבצות (תוכנית למידה והצעת שעה)', async () => {
    for (const day of ['2026-11-30', '2026-12-01', '2026-12-03']) {
      const busy = await busyOn(day);
      assert.ok(busy.items.some((item) => item.away === true), day);
      assert.deepEqual(openWindows({ dateIso: day, busy }), [], day);
      assert.deepEqual(spacedSlots({ windows: openWindows({ dateIso: day, busy }), items: busy.items }), [], day);
      assert.deepEqual(freeSlots({ windows: openWindows({ dateIso: day, busy }), items: busy.items }), [], day);
    }
  });
  test('היום שאחרי האירוע ויום אחד בלבד: נשארים פתוחים כרגיל', async () => {
    const after = await busyOn('2026-12-04');
    assert.ok(!after.items.some((item) => item.away));
    assert.ok(openWindows({ dateIso: '2026-12-04', busy: after }).length > 0);
    const single = await busyOn('2026-11-30', [SINGLE_ALL_DAY]);
    assert.ok(!single.items.some((item) => item.away));
  });
  test('loadBusyDays: ימי החופשה סגורים וימים אחרים פתוחים', async () => {
    const sql = fakeSql(() => [VACATION]);
    const loaded = await loadBusyDays({ sql, dates: ['2026-11-29', '2026-12-01'], timetable: null, googleDay: async () => ({ ok: true, events: [] }), timeoutMs: 1000 });
    assert.equal(loaded.ok, true);
    assert.ok(openWindows({ dateIso: '2026-11-29', busy: loaded.busyByDate.get('2026-11-29') }).length > 0);
    assert.deepEqual(openWindows({ dateIso: '2026-12-01', busy: loaded.busyByDate.get('2026-12-01') }), []);
  });
  test('הצעת האזנה של 17:00: ביום בתוך החופשה אין כרטיס (גם ביום אימון), ובלי החופשה יש', async () => {
    const handler = (away) => (text) => (text.includes('away-on') ? (away ? [VACATION] : []) : text.includes('listen-training') ? [{ found: 1 }] : text.includes('listen-load') ? [{ id: 'a', title: 'פודקאסט' }] : text.includes('listen-suggest') ? [{ id: 'm1' }] : []);
    assert.deepEqual(await createListenSuggestion({ sql: fakeSql(handler(true)), dateIso: '2026-12-01' }), { created: false, reason: 'away' });
    assert.equal((await createListenSuggestion({ sql: fakeSql(handler(false)), dateIso: '2026-12-01' })).created, true);
  });
  test('awayOn: כותרת ביום בתוך האירוע, null מחוצה לו, ו-null (לא זורק) כשהמסד נכשל', async (t) => {
    captureConsole(t);
    assert.equal(await awayOn(fakeSql(() => [VACATION]), '2026-12-02'), 'חופשה בווינה');
    assert.equal(await awayOn(fakeSql(() => [VACATION]), '2026-12-04'), null);
    assert.equal(await awayOn(fakeSql(() => { throw new Error('db'); }), '2026-12-02'), null);
  });
});

describe('away: שורת הבריף', () => {
  test('היום בתוך אירוע של כמה ימים: "היום: <כותרת>"; בלי אירוע אין שורה', () => {
    const withAway = composeBrief({ dateIso: '2026-12-01', away: 'חופשה בווינה' });
    assert.ok(withAway.text.split('\n').includes('היום: חופשה בווינה'));
    assert.ok(!composeBrief({ dateIso: '2026-12-01' }).text.includes('חופשה'));
  });
  test('כרטיס הבריף החי מציג את אותה שורה', () => {
    const card = briefCardData({ now: new Date('2026-12-01T06:00:00.000Z'), away: 'חופשה בווינה' });
    assert.ok(card.text.includes('היום: חופשה בווינה'));
  });
});

describe('away: תכנון ונוסח הכרטיס', () => {
  const range = awayRange(VACATION);
  test('מועד ב\' הקרוב אחרי האירוע', () => {
    assert.equal(nearestMakeup('2026-12-03', EXAMS), '2026-12-14');
    assert.equal(nearestMakeup('2026-12-23', EXAMS), null);
  });
  test('מבחנים בטווח עוברים למועד ב\' הקרוב, למידה נספרת, אימון לא זז; מבחן מחוץ לטווח לא נכלל', () => {
    const plan = planAway({ range, board: EXAMS, examsRaw: EXAMS, inside: [...STUDY, TRAINING] });
    assert.deepEqual(plan.exams.map((e) => [e.link, e.from, e.to]), [['exam:2026-12-01:מדעים', '2026-12-01', '2026-12-14'], ['exam:2026-12-03:ספרות', '2026-12-03', '2026-12-14']]);
    assert.deepEqual(plan.study, { count: 2, minutes: 120 });
    assert.deepEqual(plan.trainings, [{ title: 'אימון שני', date: '2026-11-30' }]);
    assert.equal(awayText(range, plan), "בזמן חופשה בווינה (30.11–3.12): מבחן במדעים 1.12 → מועד ב' 14.12 · מבחן בספרות 3.12 → מועד ב' 14.12 · שעתיים למידה יבוטלו · אימון שני 30.11 (לא זז)\nלעדכן?");
  });
  test('מבחן שכבר הוזז (answerDate): הקישור לתאריך המקורי; מבחן נדחה בלי מועד: לא נכלל; אין מועד ב\' אחרי: "לא זז"', () => {
    const board = applyExamChanges(EXAMS, [{ link: 'exam:2026-12-08:היסטוריה', type: 'move', newDate: '2026-12-02' }, { link: 'exam:2026-12-03:ספרות', type: 'move', newDate: null }]);
    const plan = planAway({ range, board, examsRaw: EXAMS, inside: [] });
    assert.deepEqual(plan.exams.map((e) => e.link), ['exam:2026-12-01:מדעים', 'exam:2026-12-08:היסטוריה']);
    const none = planAway({ range, board: EXAMS, examsRaw: EXAMS.filter((e) => !e.makeup), inside: [] });
    assert.equal(none.exams[0].to, null);
    assert.match(awayText(range, none), /אין מועד ב' ידוע, לא זז/);
  });
});

describe('away: יצירת הכרטיס', () => {
  const sqlFor = ({ events = [VACATION], inside = [], made = true } = {}) => fakeSql((text) => (text.includes('away-events') ? events : text.includes('away-inside') ? inside : text.includes('away-create') ? (made ? [{ message_id: 'm1' }] : []) : []));
  test('כרטיס אחד: question עם הנוסח, פג בסוף האירוע, והעובדות (אירוע, טווח, מבחנים)', async () => {
    const sql = sqlFor({ inside: [...STUDY, TRAINING] });
    const out = await offerAwayCards({ sql, now: NOW, exams: EXAMS, examsRaw: EXAMS });
    assert.deepEqual(out.created, [`away:${EVENT_ID}:2026-11-30:2026-12-03`]);
    const [call] = sql.find('away-create');
    assert.match(call.text, /'question', now\(\), true/);
    assert.ok(call.values.includes(AWAY_ENTITY));
    assert.ok(call.values.includes(VACATION.ends_at)); // expires_at = סוף האירוע
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith('בזמן חופשה בווינה (30.11–3.12): ')));
    const facts = JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field":"key"')));
    const byField = Object.fromEntries(facts.map((f) => [f.field, f.value]));
    assert.equal(byField.event, EVENT_ID);
    assert.equal(byField.start, '2026-11-30');
    assert.equal(byField.last, '2026-12-03');
    assert.equal(JSON.parse(byField.exams).length, 2);
    assert.equal(byField.study_count, '2');
  });
  test('טווח בלי מבחן ובלי למידה (אפילו עם אימון): אין כרטיס', async () => {
    const sql = sqlFor({ inside: [TRAINING] });
    const out = await offerAwayCards({ sql, now: NOW, exams: [], examsRaw: EXAMS });
    assert.deepEqual(out.created, []);
    assert.equal(sql.find('away-create').length, 0);
  });
  test('אין אירוע של כמה ימים: אין כרטיס ואין שאילתות נוספות; אירוע של יום אחד לא נחשב', async () => {
    const sql = sqlFor({ events: [SINGLE_ALL_DAY, { ...VACATION, domain: 'personal', starts_at: '2026-11-30T07:00:00.000Z', ends_at: '2026-11-30T08:00:00.000Z' }] });
    assert.deepEqual((await offerAwayCards({ sql, now: NOW, exams: EXAMS })).created, []);
    assert.equal(sql.find('away-inside').length, 0);
  });
  test('כרטיס קיים לאותו טווח (ההכנסה מותנית ב-NOT EXISTS): created ריק; כרטיס ישן של אותו אירוע נסגר באותה פקודה', async () => {
    const sql = sqlFor({ inside: STUDY, made: false });
    assert.deepEqual((await offerAwayCards({ sql, now: NOW, exams: EXAMS })).created, []);
    const [call] = sql.find('away-create');
    assert.match(call.text, /p\.field = 'key' AND p\.value = \?::text AND \(x\.awaiting_reply = true OR x\.reply_source_id IS NOT NULL\)/); // רק כרטיס פתוח או שנענה חוסם
    assert.match(call.text, /old AS \( UPDATE messages SET awaiting_reply = false/);
  });
  test('אירוע שכבר התחיל: נבחר לפי ends_at > עכשיו, הכרטיס פג בסוף האירוע, ורק מה שאחרי היום מוצג', async () => {
    const sql = sqlFor({ inside: STUDY });
    const midway = new Date('2026-12-01T08:00:00.000Z'); // 1.12 10:00, האירוע התחיל
    const board = [...EXAMS, { date: '2026-11-30', type: 'מבחן', subject: 'אנגלית', makeup: false }]; // מבחן שכבר היה
    const out = await offerAwayCards({ sql, now: midway, exams: board, examsRaw: EXAMS });
    assert.equal(out.created.length, 1);
    const [events] = sql.find('away-events');
    assert.match(events.text, /ends_at > \?::timestamptz/);
    assert.doesNotMatch(events.text, /starts_at >/);
    assert.ok(events.values.includes(midway.toISOString()));
    assert.match(sql.find('away-inside')[0].text, /ends_at > \?::timestamptz/);
    const [call] = sql.find('away-create');
    assert.ok(call.values.includes(VACATION.ends_at));
    const text = call.values.find((v) => typeof v === 'string' && v.startsWith('בזמן '));
    assert.ok(!text.includes('אנגלית'));
    assert.ok(text.includes('מבחן בספרות 3.12'));
    assert.ok(!text.includes('מבחן במדעים 1.12')); // היום עצמו: לא "אחרי היום"
  });
  test('אירוע שמתחיל מחר: הכרטיס פג בסוף האירוע, אז לא נעלם בחצות', async () => {
    const sql = sqlFor({ inside: STUDY });
    await offerAwayCards({ sql, now: new Date('2026-11-29T21:30:00.000Z'), exams: EXAMS, examsRaw: EXAMS });
    assert.ok(sql.find('away-create')[0].values.includes(VACATION.ends_at));
    assert.ok(new Date(VACATION.ends_at) > new Date('2026-11-30T05:00:00.000Z'));
  });
  test('A, אחר כך B, ובחזרה ל-A: כרטיס שנסגר בלי תשובה לא חוסם, והחדש סוגר את הפתוח', async () => {
    const sql = sqlFor({ inside: STUDY });
    await offerAwayCards({ sql, now: NOW, exams: EXAMS, examsRaw: EXAMS });
    const [call] = sql.find('away-create');
    assert.match(call.text, /old AS \( UPDATE messages SET awaiting_reply = false, read_at = now\(\) WHERE entity_type = \?::text AND kind = 'question' AND awaiting_reply = true/);
  });
  test('כשל מסד לא נזרק', async (t) => {
    captureConsole(t);
    const out = await offerAwayCards({ sql: fakeSql(() => { throw new Error('db'); }), now: NOW });
    assert.deepEqual(out.created, []);
  });
  test('הכרטיס מוצג כשאלה עם כן / לא', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG, entity_type: AWAY_ENTITY, body: 'בזמן חופשה', sent_at: NOW.toISOString() }], facts: [], timetable: null, today: '2026-11-24' });
    assert.equal(item.kind, 'away_conflict');
    assert.deepEqual(item.buttons, ['כן', 'לא']);
    assert.deepEqual(AWAY_BUTTONS, ['כן', 'לא']);
  });
});

describe('away: תשובה לכרטיס', () => {
  const FACTS = {
    key: `away:${EVENT_ID}:2026-11-30:2026-12-03`, event: EVENT_ID, title: 'חופשה בווינה', start: '2026-11-30', last: '2026-12-03',
    event_starts: VACATION.starts_at, event_ends: VACATION.ends_at,
    exams: JSON.stringify([
      { link: 'exam:2026-12-01:מדעים', label: 'מבחן במדעים', from: '2026-12-01', to: '2026-12-14' },
      { link: 'exam:2026-12-03:ספרות', label: 'מבחן בספרות', from: '2026-12-03', to: '2026-12-14' },
      { link: 'exam:2026-12-02:אנגלית', label: 'מבחן באנגלית', from: '2026-12-02', to: null },
    ]),
    study_count: '2',
  };
  const sqlFor = ({ ask = { id: MSG, awaiting_reply: true, sent_at: '2026-11-24T19:00:00.000Z', facts: FACTS }, event = [{ status: 'planned', starts_at: VACATION.starts_at, ends_at: VACATION.ends_at }], written = { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', keys: ['source:study:k1', 'source:study:k2'] } } = {}) =>
    fakeSql((text) => (text.includes('away-ask') ? (ask ? [ask] : []) : text.includes('away-event') ? event : text.includes('away-write') ? [written] : []));
  const paramsOf = (call) => call.values.filter((v) => typeof v === 'string');

  test('"כן": כל מבחן עם מועד ב\' עובר (מקור לכל מבחן: match, type=move, new_date), הלמידה שבטווח מבוטלת והמפתחות חוזרים לסנכרון', async () => {
    const sql = sqlFor();
    const out = await answerAway({ sql, messageId: MSG, answer: 'כן', now: NOW });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, ['source:study:k1', 'source:study:k2']);
    assert.deepEqual(out.created, { answerSourceId: 'a1', bubbleId: 'b1' });
    const [call] = sql.find('away-write');
    assert.match(call.text, /UPDATE events SET status = 'cancelled'/);
    assert.match(call.text, /match_key LIKE 'source:study:%'/);
    const factsJson = JSON.parse(paramsOf(call).find((v) => v.includes('"field":"new_date"')));
    assert.deepEqual(factsJson.filter((f) => f.field === 'match').map((f) => f.value), ['exam:2026-12-01:מדעים', 'exam:2026-12-03:ספרות']); // האנגלית בלי מועד ב': לא זזה
    assert.deepEqual(factsJson.filter((f) => f.field === 'new_date').map((f) => f.value), ['2026-12-14', '2026-12-14']);
    assert.ok(factsJson.filter((f) => f.field === 'type').every((f) => f.value === 'move'));
    assert.equal(new Set(factsJson.map((f) => f.source_id)).size, 2); // מקור נפרד לכל מבחן
    assert.ok(call.values.includes(new Date('2026-11-29T22:00:00.000Z').toISOString())); // טווח הלמידה: 30.11 00:00
    assert.ok(call.values.includes(new Date('2026-12-03T22:00:00.000Z').toISOString())); // עד 4.12 00:00
    assert.ok(paramsOf(call).some((v) => v.startsWith('עודכן בזמן חופשה בווינה:') && v.includes('מבחן במדעים 1.12') && v.includes('הלמידה שבטווח בוטלה')));
  });
  test('העובדות שנכתבו נקראות כהזזת מבחן רגילה: loadExamChanges / applyExamChanges מציבים את המבחן במועד ב\'', () => {
    const changes = [{ link: 'exam:2026-12-01:מדעים', type: 'move', newDate: '2026-12-14' }];
    const board = applyExamChanges(EXAMS, changes);
    assert.ok(board.some((e) => e.subject === 'מדעים' && e.date === '2026-12-14'));
  });
  test('"לא": נסגר בלי מבחנים ובלי ביטול למידה, רק בועה', async () => {
    const sql = sqlFor({ written: { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', keys: [] } });
    const out = await answerAway({ sql, messageId: MSG, answer: 'לא', now: NOW });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
    assert.equal(sql.find('away-event').length, 0);
    const [call] = sql.find('away-write');
    assert.ok(call.values.includes(false)); // apply = false
    assert.equal(paramsOf(call).filter((v) => v === '[]').length, 2); // אין מקורות ואין עובדות
    assert.ok(paramsOf(call).includes('בלי שינוי · חופשה בווינה'));
  });
  test('האירוע הוזז או בוטל אחרי שהכרטיס נוצר: "כן" לא כותב כלום (ולא מבטל למידה)', async () => {
    for (const event of [[{ status: 'cancelled', starts_at: VACATION.starts_at, ends_at: VACATION.ends_at }], [{ status: 'planned', starts_at: '2026-12-06T22:00:00.000Z', ends_at: '2026-12-10T22:00:00.000Z' }], []]) {
      const sql = sqlFor({ event, written: { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', keys: [] } });
      await answerAway({ sql, messageId: MSG, answer: 'כן', now: NOW });
      const [call] = sql.find('away-write');
      assert.equal(paramsOf(call).filter((v) => v === '[]').length, 2); // אין מקורות ואין עובדות
      assert.ok(call.values.includes(false));
      assert.ok(paramsOf(call).some((v) => v.startsWith('האירוע השתנה בינתיים, לא שיניתי כלום')));
    }
  });
  test('התשובה סוגרת כל כרטיס פתוח אחר של אותו אירוע באותה פקודה', async () => {
    const sql = sqlFor();
    await answerAway({ sql, messageId: MSG, answer: 'כן', now: NOW });
    const [call] = sql.find('away-write');
    assert.match(call.text, /other AS \( UPDATE messages SET awaiting_reply = false, read_at = now\(\) WHERE entity_type = \?::text AND kind = 'question' AND awaiting_reply = true AND id <> \?::uuid/);
    assert.match(call.text, /AND EXISTS \(SELECT 1 FROM closed\) RETURNING id \), mv AS/);
    assert.ok(call.values.includes(EVENT_ID));
  });
  test('מבחן שכבר עבר עד שנענה: לא מוזז', async () => {
    const sql = sqlFor();
    await answerAway({ sql, messageId: MSG, answer: 'כן', now: new Date('2026-12-01T08:00:00.000Z') });
    const [call] = sql.find('away-write');
    const factsJson = JSON.parse(call.values.filter((v) => typeof v === 'string').find((v) => v.includes('"field":"new_date"')));
    assert.deepEqual(factsJson.filter((f) => f.field === 'match').map((f) => f.value), ['exam:2026-12-03:ספרות']);
  });
  test('כרטיס סגור, פג או לא קיים: closed בלי כתיבה; תשובה אחרת: unclear בלי כתיבה; כתיבה שלא תפסה: closed', async () => {
    const closed = sqlFor({ ask: { id: MSG, awaiting_reply: false, sent_at: NOW.toISOString(), facts: FACTS } });
    assert.equal((await answerAway({ sql: closed, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
    assert.equal(closed.find('away-write').length, 0);
    const missing = sqlFor({ ask: null });
    assert.equal((await answerAway({ sql: missing, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
    const unclear = sqlFor();
    assert.equal((await answerAway({ sql: unclear, messageId: MSG, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal(unclear.find('away-write').length, 0);
    const race = sqlFor({ written: { closed: 0 } });
    assert.equal((await answerAway({ sql: race, messageId: MSG, answer: 'כן', now: NOW })).status, 'closed');
  });
});

describe('away: חיבור לשאר המערכת', () => {
  test('examsToPlan לא מושפע (המבחנים עצמם נשארים; רק הזמן נסגר)', () => {
    assert.equal(examsToPlan('2026-11-25', { exams: EXAMS }).length, 2);
  });
});

describe('away: סימון ברישום (api/intake.js יוצר את הכרטיס רק כשהוא מסומן)', () => {
  const source = (text) => ({ id: EVENT_ID, channel: 'app', raw_content: text, content_hash: `hash-${text}`, received_at: new Date('2026-11-24T10:00:00.000Z') });
  test('אירוע של כמה ימים: away=true; אירוע רגיל עם שעה: בלי הסימון', async () => {
    const multi = await processSource({ sql: fakeSql(() => []), source: source('חופשה בווינה מ30.11-3.12'), timetable: null });
    assert.equal(multi.away, true);
    const plain = await processSource({ sql: fakeSql(() => []), source: source('תור לרופא שיניים ב-16:00'), timetable: null });
    assert.equal(plain.away, undefined);
  });
});
