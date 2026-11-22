// בדיקות ל-lib/weekly-runs.js (בלוק 5: ריצות שלישי ושישי, 03-4fitness "כל הריצות בשבוע").
// בלי רשת ובלי מסד: sql מזויף, googleDay / syncEvents / push מוזרקים. כל הכותרות והמזהים מומצאים.
// חשוב: ה-SQL לא רץ מול Postgres. הבדיקות מוודאות את התוכנית (טהורה), את הפרמטרים של פקודת הכתיבה ואת הזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole, fakeSql, jsonRequest, FAKE_SECRET } from './helpers.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { handle as chatHandle } from '../api/chat.js';
import {
  planWeeklyRuns, applyWeeklyRuns, answerWeeklyRun, findConflict, askText, conflictText, weeklyKey, weeklyTimes, isWeeklyRunKey,
  askEntityId, conflictEntityId, ASK_ENTITY, CONFLICT_ENTITY, FACT_ENTITY, WEEKLY_RUN_TITLE, WEEKLY_PREP_TITLE, DEFAULT_RUN_MINUTES, yesBubble, noBubble,
} from '../lib/weekly-runs.js';
import { eventBody } from '../lib/event-sync.js';

// נובמבר 2026: ישראל UTC+2. ראשון 22.11, שני 23.11, שלישי 24.11, חמישי 26.11, שישי 27.11.
const TUE = '2026-11-24';
const FRI = '2026-11-27';
const NEXT_TUE = '2026-12-01';
const MON_1300Z = new Date('2026-11-23T13:00:00.000Z'); // שני 15:00 בישראל, המשיכה הראשונה
const MON_1400Z = new Date('2026-11-23T14:00:00.000Z'); // שני 16:00 בישראל, המשיכה השנייה
const THU_1400Z = new Date('2026-11-26T14:00:00.000Z');
const FETCHED = MON_1400Z.toISOString();
const LRI = '⁦';
const PDI = '⁩';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const MSG_ID = '55555555-5555-4555-8555-555555555555';

const garmin = (over = {}) => ({
  garmin_id: 'cal:9', kind: 'planned', item_date: TUE, title: 'ריצה קלה 50', sport: 'running', duration_sec: 3000, starts_at: null, fetched_at: FETCHED, ...over,
});
const weeklyRun = (over = {}) => ({
  id: RUN_ID, title: WEEKLY_RUN_TITLE, starts_at: `${TUE}T16:30:00.000Z`, ends_at: `${TUE}T17:30:00.000Z`, description: null,
  status: 'planned', match_key: weeklyKey(TUE, 'run'), ...over,
});
const plan = (over = {}) => planWeeklyRuns({ items: [], events: [], asks: [], now: MON_1400Z, fetchedAt: FETCHED, ...over });

describe('weekly-runs: שעות, מפתחות וטקסטים', () => {
  test('שלישי: התארגנות 18:00–18:30, ריצה מ-18:30; שישי: התארגנות 04:30–05:30, ריצה מ-05:30 (03-4fitness, הטבלה)', () => {
    const tue = weeklyTimes(TUE, 50);
    assert.equal(new Date(tue.prepStart).toISOString(), `${TUE}T16:00:00.000Z`);
    assert.equal(new Date(tue.runStart).toISOString(), `${TUE}T16:30:00.000Z`);
    assert.equal(new Date(tue.runEnd).toISOString(), `${TUE}T17:20:00.000Z`);
    const fri = weeklyTimes(FRI, 60);
    assert.equal(new Date(fri.prepStart).toISOString(), `${FRI}T02:30:00.000Z`);
    assert.equal(new Date(fri.runStart).toISOString(), `${FRI}T03:30:00.000Z`);
  });
  test('מפתח מתחיל ב-source: (נכתב ליומן) ואינו :fitness: (garmin-apply של שני/רביעי לא נוגע בו)', () => {
    assert.equal(weeklyKey(TUE, 'run'), 'source:weekly:2026-11-24:run');
    assert.ok(weeklyKey(TUE, 'run').startsWith('source:'));
    assert.ok(!/:fitness:/.test(weeklyKey(TUE, 'run')));
    assert.equal(isWeeklyRunKey(weeklyKey(TUE, 'run')), true);
    assert.equal(isWeeklyRunKey(weeklyKey(TUE, 'prep')), false);
  });
  test('גוף האירוע ל-Google: ריצה עם צבע 11 ותזכורות; התארגנות כותרת ושעות בלבד', () => {
    const body = eventBody({ ...weeklyRun(), domain: 'running', description: 'ריצה קלה 50' });
    assert.equal(body.colorId, '11');
    assert.deepEqual(body.reminders.overrides.map((o) => o.minutes), [1440, 60]);
    assert.equal(body.description, 'ריצה קלה 50');
    const prep = eventBody({ title: WEEKLY_PREP_TITLE, starts_at: `${TUE}T16:00:00.000Z`, ends_at: `${TUE}T16:30:00.000Z`, domain: 'running', match_key: weeklyKey(TUE, 'prep') });
    assert.equal(prep.colorId, undefined);
    assert.equal(prep.reminders, undefined);
  });
  test('נוסח השאלות', () => {
    assert.equal(askText(TUE), 'יש ריצה ביום שלישי 24.11?');
    assert.equal(askText(FRI), 'יש ריצה ביום שישי 27.11?');
    assert.equal(conflictText({ date: TUE, minutes: 60, title: 'פיזיותרפיה' }), `ריצת שלישי ${LRI}18:30–19:30${PDI} מתנגשת ב-פיזיותרפיה. לרשום בכל זאת?`);
    assert.equal(noBubble(TUE), 'נרשם. אין ריצה בשלישי 24.11.');
    assert.equal(yesBubble(FRI, 60), `נרשמה ריצה בשישי 27.11 ${LRI}05:30–06:30${PDI}.`);
  });
  test('מזהי השאלות דטרמיניסטיים ושונים בין שאלה להתנגשות', () => {
    assert.equal(askEntityId(TUE), askEntityId(TUE));
    assert.notEqual(askEntityId(TUE), conflictEntityId(TUE));
    assert.notEqual(askEntityId(TUE), askEntityId(FRI));
  });
});

describe('weekly-runs: התוכנית (טהורה)', () => {
  test('ריצה ב-Garmin לשלישי, אין אירוע: יצירה באורך מ-Garmin, התוכן בתיאור, נבדקת התנגשות', () => {
    const out = plan({ items: [garmin()] });
    assert.deepEqual(out.candidates.map((c) => ({ date: c.date, action: c.action, minutes: c.minutes, description: c.description, needsCheck: c.needsCheck })), [
      { date: TUE, action: 'create', minutes: 50, description: 'ריצה קלה 50', needsCheck: true },
    ]);
    assert.deepEqual(out.asks, []);
  });
  test('שני ורביעי, ופריט שאינו ריצה, לא נוגעים כאן; פריט ישן (לא מהמשיכה הזו) לא נחשב', () => {
    const out = plan({ items: [garmin({ item_date: '2026-11-25' }), garmin({ item_date: FRI, sport: 'strength_training', title: 'כוח' }), garmin({ fetched_at: '2026-11-22T13:00:00.000Z' })] });
    assert.deepEqual(out.candidates, []);
  });
  test('ריצה קיימת: אורך חדש = עדכון; הארכה נבדקת להתנגשות, קיצור לא', () => {
    const longer = plan({ items: [garmin({ duration_sec: 4800 })], events: [weeklyRun()] });
    assert.equal(longer.candidates[0].action, 'update');
    assert.equal(longer.candidates[0].minutes, 80);
    assert.equal(longer.candidates[0].needsCheck, true);
    const shorter = plan({ items: [garmin({ duration_sec: 2400 })], events: [weeklyRun()] });
    assert.equal(shorter.candidates[0].needsCheck, false);
  });
  test('ריצה קיימת זהה (אורך ותוכן): כלום', () => {
    const out = plan({ items: [garmin({ duration_sec: 3600 })], events: [weeklyRun({ description: 'ריצה קלה 50' })] });
    assert.deepEqual(out.candidates, []);
  });
  test('בלי משך ב-Garmin: יצירה ב-60 דקות (הנחה), ריצה קיימת שומרת את האורך שלה', () => {
    assert.equal(plan({ items: [garmin({ duration_sec: null })] }).candidates[0].minutes, DEFAULT_RUN_MINUTES);
    const kept = plan({ items: [garmin({ duration_sec: null })], events: [weeklyRun({ ends_at: `${TUE}T17:45:00.000Z` })] });
    assert.equal(kept.candidates[0].minutes, 75);
  });
  test('"לא" (לשאלה או להתנגשות) גובר על Garmin; התנגשות פתוחה = מחכים; "כן" להתנגשות = בלי בדיקה', () => {
    const items = [garmin()];
    assert.deepEqual(plan({ items, asks: [{ date: TUE, entity_type: ASK_ENTITY, awaiting_reply: false, answer: 'לא' }] }).candidates, []);
    assert.deepEqual(plan({ items, asks: [{ date: TUE, entity_type: CONFLICT_ENTITY, awaiting_reply: false, answer: 'לא' }] }).candidates, []);
    assert.deepEqual(plan({ items, asks: [{ date: TUE, entity_type: CONFLICT_ENTITY, awaiting_reply: true, expires_at: `${TUE}T16:30:00.000Z`, answer: null }] }).candidates, []);
    const forced = plan({ items, asks: [{ date: TUE, entity_type: CONFLICT_ENTITY, awaiting_reply: false, answer: 'כן' }] });
    assert.equal(forced.candidates[0].needsCheck, false);
  });
  test('שתי ריצות שונות באותו יום: לא נוגעים', () => {
    const out = plan({ items: [garmin(), garmin({ garmin_id: 'cal:10', title: 'אחרת' })] });
    assert.deepEqual(out.candidates, []);
    assert.equal(out.skipped.ambiguous, 1);
  });
  test('ריצה שכבר התחילה לא נוצרת', () => {
    const out = plan({ items: [garmin()], now: new Date(`${TUE}T16:31:00.000Z`), fetchedAt: FETCHED });
    assert.deepEqual(out.candidates, []);
  });
  test('ריצה שבוטלה או בוצעה: לא נוגעים', () => {
    assert.deepEqual(plan({ items: [garmin()], events: [weeklyRun({ status: 'cancelled' })] }).candidates, []);
  });
  test('אין ריצה ב-Garmin: שואלים ביום שלפני, מ-14:00 UTC; לא ב-13:00; לא לתאריך רחוק', () => {
    assert.deepEqual(plan({ now: MON_1400Z }).asks, [TUE]);
    assert.deepEqual(plan({ now: MON_1300Z, fetchedAt: MON_1300Z.toISOString() }).asks, []);
    assert.deepEqual(plan({ now: THU_1400Z, fetchedAt: THU_1400Z.toISOString() }).asks, [FRI]);
    assert.ok(!plan({ now: MON_1400Z }).asks.includes(NEXT_TUE));
  });
  test('לא שואלים כשכבר יש אירוע ריצה או שאלה על התאריך', () => {
    assert.deepEqual(plan({ events: [weeklyRun()] }).asks, []);
    assert.deepEqual(plan({ asks: [{ date: TUE, entity_type: ASK_ENTITY, awaiting_reply: true }] }).asks, []);
    assert.deepEqual(plan({ asks: [{ date: TUE, entity_type: CONFLICT_ENTITY, awaiting_reply: false, answer: 'לא' }] }).asks, []);
  });
  test('המשיכה נכשלה (fetchedAt = null): שואלים, ופריטים ישנים לא יוצרים כלום', () => {
    const out = planWeeklyRuns({ items: [garmin()], events: [], asks: [], now: MON_1400Z, fetchedAt: null });
    assert.deepEqual(out.candidates, []);
    assert.deepEqual(out.asks, [TUE]);
  });
});

describe('weekly-runs: בדיקת התנגשות', () => {
  const block = weeklyTimes(TUE, 60);
  test('אירוע במסד שחופף = התנגשות; האירועים של הריצה עצמה לא נחשבים', async () => {
    const sql = fakeSql((text) => (text.includes('weekly-conflict-events') ? [
      { id: RUN_ID, title: 'ריצה', starts_at: `${TUE}T16:30:00.000Z`, ends_at: `${TUE}T17:30:00.000Z`, external_id: null, match_key: weeklyKey(TUE, 'run') },
      { id: '66666666-6666-4666-8666-666666666666', title: 'פיזיותרפיה', starts_at: `${TUE}T17:15:00.000Z`, ends_at: `${TUE}T18:00:00.000Z`, external_id: 'g1', match_key: null },
    ] : []));
    assert.deepEqual(await findConflict({ sql, date: TUE, fromMs: block.prepStart, toMs: block.runEnd }), { title: 'פיזיותרפיה' });
  });
  test('אירוע שנגמר בדיוק בתחילת ההתארגנות אינו התנגשות', async () => {
    const sql = fakeSql(() => [{ id: '66666666-6666-4666-8666-666666666666', title: 'שיעור', starts_at: `${TUE}T15:00:00.000Z`, ends_at: `${TUE}T16:00:00.000Z`, external_id: null, match_key: null }]);
    assert.equal(await findConflict({ sql, date: TUE, fromMs: block.prepStart, toMs: block.runEnd }), null);
  });
  test('אירוע Google חופף = התנגשות; אירוע Google שכבר במסד או של יום שלם לא נחשב פעמיים', async () => {
    const sql = fakeSql(() => [{ id: RUN_ID, title: 'ריצה', starts_at: `${TUE}T16:30:00.000Z`, ends_at: `${TUE}T17:30:00.000Z`, external_id: 'mine', match_key: weeklyKey(TUE, 'run') }]);
    const googleDay = async () => ({ ok: true, events: [
      { id: 'mine', title: 'ריצה', startsAt: `${TUE}T16:30:00.000Z`, endsAt: `${TUE}T17:30:00.000Z` },
      { id: 'allday', title: 'יום הולדת', startDate: TUE },
      { id: 'g2', title: 'חוג', startsAt: `${TUE}T17:00:00.000Z`, endsAt: `${TUE}T18:00:00.000Z` },
    ] });
    assert.deepEqual(await findConflict({ sql, date: TUE, fromMs: block.prepStart, toMs: block.runEnd, googleDay }), { title: 'חוג' });
  });
  test('Google נכשל: בודקים מול המסד בלבד, ונרשם קוד', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => []);
    assert.equal(await findConflict({ sql, date: TUE, fromMs: block.prepStart, toMs: block.runEnd, googleDay: async () => ({ ok: false, reason: 'not_connected' }) }), null);
    assert.match(log.text(), /not_connected/);
  });
});

// sql מזויף לזרימה המלאה: items / events / asks / conflict לפי התג בשאילתה; הכתיבה מחזירה ספירות.
function flowSql({ items = [], events = [], asks = [], conflict = [], written = { created: 2, updated: 0, questions: 0 } } = {}) {
  return fakeSql((text) => {
    if (text.includes('weekly-runs-items')) return items;
    if (text.includes('weekly-runs-events')) return events;
    if (text.includes('weekly-runs-asks')) return asks;
    if (text.includes('weekly-conflict-events')) return conflict;
    if (text.includes('weekly-runs-write')) return [written];
    return [];
  });
}
const writeParams = (sql) => {
  const call = sql.find('weekly-runs-write')[0];
  const json = call.values.filter((v) => typeof v === 'string' && (v.startsWith('[') || v.startsWith('{'))).map((v) => JSON.parse(v));
  return { call, json };
};

describe('weekly-runs: applyWeeklyRuns (אחרי משיכה)', () => {
  test('ריצה ב-Garmin בלי התנגשות: נוצרות ריצה והתארגנות, נכתבות ליומן, בלי דחיפה', async () => {
    const sql = flowSql({ items: [garmin()] });
    const synced = [];
    const pushes = [];
    const result = await applyWeeklyRuns({
      sql, now: MON_1400Z, fetchedAt: FETCHED, googleDay: async () => ({ ok: true, events: [] }),
      syncEvents: async (args) => { synced.push(args); return { created: 2 }; }, push: async () => { pushes.push(1); return { sent: true }; },
    });
    assert.equal(result.ok, true);
    assert.equal(result.created, 2);
    const { json } = writeParams(sql);
    const creates = json.find((list) => Array.isArray(list) && list.some((row) => row?.match_key));
    assert.deepEqual(creates, [
      { title: 'ריצה', starts_at: `${TUE}T16:30:00.000Z`, ends_at: `${TUE}T17:20:00.000Z`, description: 'ריצה קלה 50', match_key: weeklyKey(TUE, 'run') },
      { title: 'התארגנות', starts_at: `${TUE}T16:00:00.000Z`, ends_at: `${TUE}T16:30:00.000Z`, description: null, match_key: weeklyKey(TUE, 'prep') },
    ]);
    assert.deepEqual(synced[0].keys, [weeklyKey(TUE, 'run'), weeklyKey(TUE, 'prep')]);
    assert.deepEqual(pushes, []);
  });
  test('התנגשות: לא נוצר אירוע, נכתבת שאלה (עם התאריך והאורך ב-facts), ונשלחת דחיפה', async () => {
    const sql = flowSql({
      items: [garmin({ duration_sec: 4800 })],
      conflict: [{ id: '66666666-6666-4666-8666-666666666666', title: 'פיזיותרפיה', starts_at: `${TUE}T17:30:00.000Z`, ends_at: `${TUE}T18:15:00.000Z`, external_id: null, match_key: null }],
      written: { created: 0, updated: 0, questions: 1 },
    });
    const pushes = [];
    const synced = [];
    const result = await applyWeeklyRuns({
      sql, now: MON_1400Z, fetchedAt: FETCHED, googleDay: undefined,
      syncEvents: async (args) => { synced.push(args); return {}; }, push: async (args) => { pushes.push(args.label); return { sent: true }; },
    });
    assert.equal(result.questions, 1);
    assert.equal(result.push, 'sent');
    assert.deepEqual(pushes, ['weekly-runs']);
    assert.deepEqual(synced, []);
    const { json } = writeParams(sql);
    const questions = json.find((list) => Array.isArray(list) && list.some((row) => row?.body));
    assert.deepEqual(questions, [{
      entity_type: CONFLICT_ENTITY, entity_id: conflictEntityId(TUE), body: `ריצת שלישי ${LRI}18:30–19:50${PDI} מתנגשת ב-פיזיותרפיה. לרשום בכל זאת?`, expires_at: `${TUE}T16:30:00.000Z`,
    }]);
    const facts = json.find((list) => Array.isArray(list) && list.some((row) => row?.field));
    assert.deepEqual(facts.map((f) => [f.field, f.value]), [['weekly_run_date', TUE], ['weekly_run_minutes', '80'], ['weekly_run_description', 'ריצה קלה 50']]);
    const creates = json.filter((list) => Array.isArray(list) && list.some((row) => row?.match_key));
    assert.deepEqual(creates, []);
  });
  test('אין ריצה ב-Garmin בשני 14:00 UTC: שאלה "יש ריצה?" ודחיפה', async () => {
    const sql = flowSql({ written: { created: 0, updated: 0, questions: 1 } });
    const result = await applyWeeklyRuns({ sql, now: MON_1400Z, fetchedAt: FETCHED, googleDay: undefined, syncEvents: async () => ({}), push: async () => ({ sent: true }) });
    assert.equal(result.questions, 1);
    const { json } = writeParams(sql);
    const questions = json.find((list) => Array.isArray(list) && list.some((row) => row?.body));
    assert.deepEqual(questions.map((q) => [q.entity_type, q.body]), [[ASK_ENTITY, 'יש ריצה ביום שלישי 24.11?']]);
  });
  test('Garmin הכריע אחרי שאלה פתוחה (אותה משיכה): מזהה השאלה ברשימת הסגירה', async () => {
    const now = new Date(`${TUE}T13:00:00.000Z`);
    const fetchedAt = now.toISOString();
    const sql = flowSql({ items: [garmin({ fetched_at: fetchedAt })], asks: [{ entity_type: ASK_ENTITY, entity_id: askEntityId(TUE), awaiting_reply: true, expires_at: `${TUE}T16:30:00.000Z`, answer: null }] });
    await applyWeeklyRuns({ sql, now, fetchedAt, googleDay: undefined, syncEvents: async () => ({}), push: async () => ({ sent: false }) });
    const { json } = writeParams(sql);
    assert.ok(json.some((list) => Array.isArray(list) && list.includes(askEntityId(TUE))));
  });
  test('אין מה לעשות: בלי פקודת כתיבה', async () => {
    const sql = flowSql();
    const result = await applyWeeklyRuns({ sql, now: MON_1300Z, fetchedAt: MON_1300Z.toISOString(), googleDay: undefined, syncEvents: async () => ({}), push: async () => ({}) });
    assert.deepEqual(result, { ok: true, created: 0, updated: 0, questions: 0 });
    assert.equal(sql.find('weekly-runs-write').length, 0);
  });
  test('המשיכה נכשלה (fetchedAt = null): לא נקראים פריטי Garmin', async () => {
    const sql = flowSql({ written: { questions: 1 } });
    await applyWeeklyRuns({ sql, now: MON_1400Z, fetchedAt: null, googleDay: undefined, syncEvents: async () => ({}), push: async () => ({ sent: true }) });
    assert.equal(sql.find('weekly-runs-items').length, 0);
    assert.equal(sql.find('weekly-runs-write').length, 1);
  });
  test('טבלת garmin_items חסרה: כמו "אין אימון", לא נכשל', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('weekly-runs-items')) throw Object.assign(new Error('relation "garmin_items" does not exist'), { code: '42P01' });
      if (text.includes('weekly-runs-write')) return [{ questions: 1 }];
      return [];
    });
    const result = await applyWeeklyRuns({ sql, now: MON_1400Z, fetchedAt: FETCHED, googleDay: undefined, syncEvents: async () => ({}), push: async () => ({ sent: true }) });
    assert.equal(result.ok, true);
  });
  test('כשל מסד: לא זורק, מחזיר קוד בלבד', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => { throw Object.assign(new Error('boom secret'), { name: 'NeonDbError' }); });
    const result = await applyWeeklyRuns({ sql, now: MON_1400Z, fetchedAt: FETCHED, googleDay: undefined, syncEvents: async () => ({}), push: async () => ({}) });
    assert.deepEqual(result, { ok: false, reason: 'db_error' });
    assert.doesNotMatch(log.text(), /boom secret/);
  });
});

describe('weekly-runs: תשובה בצ\'אט', () => {
  const askRow = (over = {}) => ({ id: MSG_ID, entity_type: ASK_ENTITY, awaiting_reply: true, run_date: TUE, minutes: null, description: null, ...over });
  const answerSql = ({ ask = askRow(), run = [], conflict = [], written = { closed: 1, answer_source_id: 'a1', bubble_id: 'b1' } } = {}) => fakeSql((text) => {
    if (text.includes('weekly-runs-ask')) return ask ? [ask] : [];
    if (text.includes('weekly-runs-run')) return run;
    if (text.includes('weekly-conflict-events')) return conflict;
    if (text.includes('weekly-runs-write')) return [written];
    return [];
  });
  const NOW = new Date('2026-11-23T15:00:00.000Z');

  test('"לא": נסגרת עם תשובה ובועה, בלי אירועים', async () => {
    const sql = answerSql();
    const result = await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'לא', now: NOW });
    assert.equal(result.status, 'answered');
    assert.deepEqual(result.keys, []);
    const { call, json } = writeParams(sql);
    assert.ok(call.values.includes('לא'));
    assert.ok(call.values.includes(noBubble(TUE)));
    assert.deepEqual(json.filter((list) => Array.isArray(list) && list.some((row) => row?.match_key)), []);
  });
  test('"כן" בלי התנגשות: ריצה של 60 דקות + התארגנות, ומפתחות לכתיבה ליומן', async () => {
    const sql = answerSql();
    const result = await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'כן', now: NOW, googleDay: async () => ({ ok: true, events: [] }) });
    assert.equal(result.status, 'answered');
    assert.deepEqual(result.created, { answerSourceId: 'a1', bubbleId: 'b1' });
    assert.deepEqual(result.keys, [weeklyKey(TUE, 'run'), weeklyKey(TUE, 'prep')]);
    const { call, json } = writeParams(sql);
    const creates = json.find((list) => Array.isArray(list) && list.some((row) => row?.match_key));
    assert.equal(creates[0].ends_at, `${TUE}T17:30:00.000Z`);
    assert.ok(call.values.includes(yesBubble(TUE, 60)));
  });
  test('"כן" עם התנגשות: במקום אירוע, שאלת התנגשות', async () => {
    const sql = answerSql({ conflict: [{ id: '66666666-6666-4666-8666-666666666666', title: 'פיזיותרפיה', starts_at: `${TUE}T17:00:00.000Z`, ends_at: `${TUE}T18:00:00.000Z`, external_id: null, match_key: null }] });
    const result = await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'כן', now: NOW });
    assert.equal(result.status, 'answered');
    assert.deepEqual(result.keys, []);
    const { json } = writeParams(sql);
    const questions = json.find((list) => Array.isArray(list) && list.some((row) => row?.body));
    assert.equal(questions[0].entity_type, CONFLICT_ENTITY);
    assert.deepEqual(json.filter((list) => Array.isArray(list) && list.some((row) => row?.match_key)), []);
  });
  test('"כן" להתנגשות: נרשם בכל זאת, באורך שנשמר, בלי בדיקה נוספת', async () => {
    const sql = answerSql({ ask: askRow({ entity_type: CONFLICT_ENTITY, minutes: '80', description: 'ריצה קלה 50' }) });
    const result = await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'כן', now: NOW });
    assert.equal(result.status, 'answered');
    assert.equal(sql.find('weekly-conflict-events').length, 0);
    const { json } = writeParams(sql);
    const creates = json.find((list) => Array.isArray(list) && list.some((row) => row?.match_key));
    assert.equal(creates[0].ends_at, `${TUE}T17:50:00.000Z`);
    assert.equal(creates[0].description, 'ריצה קלה 50');
  });
  test('"כן" להתנגשות על ריצה קיימת (הארכה): עדכון, PATCH מותר', async () => {
    const sql = answerSql({ ask: askRow({ entity_type: CONFLICT_ENTITY, minutes: '80' }), run: [weeklyRun()] });
    const result = await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'כן', now: NOW });
    assert.deepEqual(result.patchKeys, [weeklyKey(TUE, 'run')]);
  });
  test('תשובה אחרת = unclear, שאלה סגורה או לא קיימת = closed; לא נכתב כלום', async () => {
    assert.equal((await answerWeeklyRun({ sql: answerSql(), messageId: MSG_ID, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal((await answerWeeklyRun({ sql: answerSql({ ask: askRow({ awaiting_reply: false }) }), messageId: MSG_ID, answer: 'כן', now: NOW })).status, 'closed');
    const none = answerSql({ ask: null });
    assert.equal((await answerWeeklyRun({ sql: none, messageId: MSG_ID, answer: 'כן', now: NOW })).status, 'closed');
    assert.equal(none.find('weekly-runs-write').length, 0);
  });
  test('לחיצה מקבילה (הסגירה לא שינתה שורה): closed', async () => {
    const sql = answerSql({ written: { closed: 0 } });
    assert.equal((await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'לא', now: NOW })).status, 'closed');
  });
  test('העובדות נקראות מ-facts לפי entity_type weekly_run', async () => {
    const sql = answerSql();
    await answerWeeklyRun({ sql, messageId: MSG_ID, answer: 'לא', now: NOW });
    assert.ok(sql.find('weekly-runs-ask')[0].values.includes(FACT_ENTITY));
  });
});

// ---------------------------------------------------------------------------
// הצ'אט: כרטיס השאלה (lib/chat-view.js) והתשובה (api/chat.js)
// ---------------------------------------------------------------------------
describe('weekly-runs: בצ\'אט', () => {
  test('pendingFromRows: שאלה והתנגשות = כרטיס עם כן / לא, בלי תיבת כתיבה', () => {
    const list = pendingFromRows({ questions: [
      { id: MSG_ID, body: 'יש ריצה ביום שלישי 24.11?', sent_at: '2026-11-23T14:00:00.000Z', entity_type: ASK_ENTITY },
      { id: RUN_ID, body: 'ריצת שלישי ... לרשום בכל זאת?', sent_at: '2026-11-23T14:01:00.000Z', entity_type: CONFLICT_ENTITY },
    ], facts: [], timetable: null, today: '2026-11-23' });
    assert.deepEqual(list, [
      { id: MSG_ID, kind: 'weekly_run', at: '2026-11-23T14:00:00.000Z', text: 'יש ריצה ביום שלישי 24.11?', buttons: ['כן', 'לא'], allowFreeText: false },
      { id: RUN_ID, kind: 'weekly_run', at: '2026-11-23T14:01:00.000Z', text: 'ריצת שלישי ... לרשום בכל זאת?', buttons: ['כן', 'לא'], allowFreeText: false },
    ]);
  });

  const H = { 'x-intake-secret': FAKE_SECRET };
  const NOW = new Date('2026-11-23T15:00:00.000Z');
  const chatSql = () => fakeSql((text) => {
    if (text.includes('weekly-runs-ask')) return [{ id: MSG_ID, entity_type: ASK_ENTITY, awaiting_reply: true, run_date: TUE, minutes: null, description: null }];
    if (text.includes('weekly-runs-write')) return [{ closed: 1, answer_source_id: 'a1', bubble_id: 'b1' }];
    return [];
  });
  test('answer "כן": עובר ל-answerWeeklyRun אחרי שאר השאלות, והאירועים נכתבים ליומן לפי המפתחות', async () => {
    const sql = chatSql();
    const synced = [];
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'כן' }, { headers: H, url: 'https://x.test/api/chat' }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: undefined,
      keysSync: async (args) => { synced.push(args); return { created: 2 }; },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(synced.map((s) => [s.keys, s.patchKeys]), [[[weeklyKey(TUE, 'run'), weeklyKey(TUE, 'prep')], []]]);
    assert.equal(sql.find('weekly-runs-write').length, 1);
  });
  test('answer "לא": בלי כתיבה ליומן', async () => {
    const synced = [];
    const body = await (await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'לא' }, { headers: H, url: 'https://x.test/api/chat' }), {
      sql: chatSql(), secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: undefined, keysSync: async (args) => { synced.push(args); return {}; },
    })).json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(synced, []);
  });
  test('כשל בכתיבה ליומן לא משנה את התשובה', async (t) => {
    captureConsole(t);
    const body = await (await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'כן' }, { headers: H, url: 'https://x.test/api/chat' }), {
      sql: chatSql(), secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: undefined, keysSync: async () => { throw new Error('x'); },
    })).json();
    assert.equal(body.status, 'answered');
  });
});
