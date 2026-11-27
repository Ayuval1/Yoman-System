// בדיקות לבריף החודשי (אפיון-מורחב 15; בקשת יובל ב-05-open-questions.md:20): lib/monthly-brief.js, תזמון ב-lib/message-slots.js ו-lib/ops/cron-plan.js,
// מסירה ב-api/queues/deliver.js, כרטיס "מה לשמר ומה לשפר" ב-lib/chat-view.js וב-api/chat.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeMonthly, monthlyPushText, denseWeeks, prevMonthKey, monthLabel, MONTHLY_NOTHING_LINE, MONTHLY_ENTITY,
  MONTHLY_REVIEW_ENTITY, MONTHLY_REVIEW_TEXT, MONTHLY_REVIEW_ACK, monthlyReviewEntityId, monthlyReviewExpiresAt,
  loadMonthTrainings, loadMonthStudyMinutes, loadMonthTasksDone, loadMonthAway, ensureMonthlyReview, answerMonthlyReview,
} from '../lib/monthly-brief.js';
import { planMonthly, monthlyBriefDate, parseSlotMessage } from '../lib/message-slots.js';
import { briefEntityId } from '../lib/brief-view.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { handle as cronHandle } from '../lib/ops/cron-plan.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { handle as chatHandle } from '../api/chat.js';
import { fakeSql, FAKE_CRON, FAKE_SECRET, req, jsonRequest } from './helpers.js';

const DEC = '2026-12';
const NOV_EXAMS = [
  { date: '2026-11-03', type: 'מבחן', subject: 'מתמטיקה' },
  { date: '2026-11-17', type: 'מבדק', subject: 'אנגלית' },
  { date: '2026-11-20', type: 'מבחן', subject: 'גאוגרפיה', postponed: true }, // נדחה: לא היה
  { date: '2026-11-25', type: 'מועד ב\'', makeup: true },
];
const DEC_EXAMS = [
  { date: '2026-12-14', type: 'מבחן', subject: 'היסטוריה' },
  { date: '2026-12-16', type: 'מבדק', subject: 'ספרות' }, // אותו שבוע (13.12–19.12): עמוס
  { date: '2026-12-24', type: 'מבחן', subject: 'מדעים' },
  { date: '2027-01-05', type: 'מבחן', subject: 'תנ"ך' }, // מחוץ לחודש
];
const VACS = [{ name: 'חנוכה', from: '2026-12-06', to: '2026-12-12' }, { name: 'פסח', from: '2027-04-13', to: '2027-04-28' }];

describe('message-slots: monthlyBriefDate ו-planMonthly', () => {
  test('הראשון בחודש; ראשון שנופל בשבת עובר ליום ראשון ה-2', () => {
    assert.equal(monthlyBriefDate('2026-12'), '2026-12-01');
    assert.equal(monthlyBriefDate('2027-05'), '2027-05-02'); // 1.5.2027 שבת
    assert.equal(monthlyBriefDate('2026-08'), '2026-08-02'); // 1.8.2026 שבת
  });
  test('ב-1.12 בלילה (Cron של 01:00Z): מתוזמן ל-20:00 שעון ישראל, מפתח monthly-2026-12', () => {
    const plan = planMonthly(new Date('2026-12-01T01:00:00Z'));
    assert.equal(plan.kind, 'monthly');
    assert.equal(plan.slotKey, 'monthly-2026-12');
    assert.equal(plan.targetAt, '2026-12-01T18:00:00.000Z');
    assert.ok(plan.delaySeconds > 0 && plan.retentionSeconds > plan.delaySeconds);
  });
  test('יום אחר: null. הראשון אחרי 20:00: null', () => {
    assert.equal(planMonthly(new Date('2026-11-30T14:00:00Z')), null);
    assert.equal(planMonthly(new Date('2026-12-02T14:00:00Z')), null);
    assert.equal(planMonthly(new Date('2026-12-01T19:00:00Z')), null);
  });
  test('1.5.2027 שבת: null; 2.5.2027 ראשון: מתוזמן (שעון קיץ, 17:00Z), עם מפתח החודש', () => {
    assert.equal(planMonthly(new Date('2027-05-01T01:00:00Z')), null);
    const plan = planMonthly(new Date('2027-05-02T14:00:00Z'));
    assert.equal(plan.slotKey, 'monthly-2027-05');
    assert.equal(plan.targetAt, '2027-05-02T17:00:00.000Z');
  });
  test('parseSlotMessage: מפתח תקין עובר; יום או שעה שלא תואמים נדחים', () => {
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2026-12', targetAt: '2026-12-01T18:00:00.000Z' }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2027-05', targetAt: '2027-05-02T17:00:00.000Z' }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2027-05', targetAt: '2027-05-01T17:00:00.000Z' }).ok, false); // שבת
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2026-12', targetAt: '2026-12-02T18:00:00.000Z' }).ok, false);
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2026-12', targetAt: '2026-12-01T17:00:00.000Z' }).ok, false); // 19:00
    assert.equal(parseSlotMessage({ kind: 'monthly', slotKey: 'monthly-2026-1', targetAt: '2026-12-01T18:00:00.000Z' }).ok, false);
  });
});

describe('monthly-brief: עזרים', () => {
  test('prevMonthKey ו-monthLabel', () => {
    assert.equal(prevMonthKey('2026-12'), '2026-11');
    assert.equal(prevMonthKey('2027-01'), '2026-12');
    assert.equal(monthLabel('2026-12'), 'דצמבר');
  });
  test('denseWeeks: שבוע ראשון עד שבת עם שני מבחנים ומעלה, שנוגע בחודש', () => {
    const weeks = denseWeeks({ monthKey: DEC, exams: DEC_EXAMS });
    assert.deepEqual(weeks, [{ sunday: '2026-12-13', count: 2 }]);
  });
  test('denseWeeks: שבוע שחוצה חודש נספר עם המבחנים שמחוץ לחודש; נדחה ומועד ב\' לא נספרים', () => {
    const exams = [
      { date: '2026-11-30', type: 'מבחן', subject: 'א' }, { date: '2026-12-02', type: 'מבחן', subject: 'ב' }, // שבוע 29.11
      { date: '2026-12-08', type: 'מבחן', subject: 'ג' }, { date: '2026-12-09', type: 'מבחן', subject: 'ד', postponed: true }, { date: '2026-12-10', type: 'מועד ב\'', makeup: true },
    ];
    assert.deepEqual(denseWeeks({ monthKey: DEC, exams }), [{ sunday: '2026-11-29', count: 2 }]);
  });
});

describe('monthly-brief: composeMonthly', () => {
  const full = () => composeMonthly({
    monthKey: DEC, exams: [...NOV_EXAMS, ...DEC_EXAMS], answers: new Map([['2026-12-24', 'כימיה']]),
    trainings: 9, studyMinutes: 12 * 60 + 10, tasksDone: 14, away: [{ title: 'חופשה בווינה', start: '2026-12-20', last: '2026-12-23' }], vacations: VACS,
  });
  test('שני הסעיפים: החודש שעבר והחודש הבא', () => {
    const { text } = full();
    const lines = text.split('\n');
    assert.equal(lines[0], 'בריף חודשי · דצמבר');
    assert.match(text, /\nהחודש שעבר · נובמבר\nמבחנים שהיו \(2\):\n· 3\.11 · מבחן במתמטיקה\n· 17\.11 · מבדק באנגלית\nאימונים: 9\nלמידה ביומן: 12 שעות\nמשימות שבוצעו: 14\n/);
    assert.match(text, /\nהחודש הבא · דצמבר\nמבחנים \(3\):\n· יום שני 14\.12 · מבחן בהיסטוריה\n· יום רביעי 16\.12 · מבדק בספרות\n· יום חמישי 24\.12 · מבחן בכימיה\n/);
    assert.match(text, /\nשבוע עמוס · 13\.12–19\.12 · 2 מבחנים\n/);
    assert.match(text, /\nחופשות וימים בלי לימודים:\n· חנוכה · 6\.12–12\.12\n· חופשה בווינה · 20\.12–23\.12$/);
    assert.doesNotMatch(text, /גאוגרפיה|תנ"ך|פסח|מועד ב/);
  });
  test('counts למספרי ההתראה', () => {
    assert.deepEqual(full().counts, { pastExams: 2, trainings: 9, studyMinutes: 730, tasksDone: 14, exams: 3, denseWeeks: 1, vacations: 2 });
  });
  test('סעיף ריק מושמט, כולל הכותרת שלו', () => {
    const { text } = composeMonthly({ monthKey: DEC, exams: DEC_EXAMS, trainings: 0, studyMinutes: 0, tasksDone: 0, away: [], vacations: [] });
    assert.doesNotMatch(text, /החודש שעבר|אימונים|למידה|משימות|חופשות/);
    assert.match(text, /החודש הבא · דצמבר/);
  });
  test('נתון שלא נטען (null): השורה מושמטת', () => {
    const { text } = composeMonthly({ monthKey: DEC, exams: NOV_EXAMS, trainings: null, studyMinutes: null, tasksDone: null, away: [], vacations: [] });
    assert.match(text, /מבחנים שהיו \(2\)/);
    assert.doesNotMatch(text, /אימונים|למידה|משימות/);
  });
  test('פחות משעה למידה, ושעתיים', () => {
    assert.match(composeMonthly({ monthKey: DEC, exams: [], studyMinutes: 20, vacations: [] }).text, /למידה ביומן: פחות משעה/);
    assert.match(composeMonthly({ monthKey: DEC, exams: [], studyMinutes: 120, vacations: [] }).text, /למידה ביומן: שעתיים/);
  });
  test('אין כלום: כותרת ושורה אחת קצרה; partial: בלי הטענה', () => {
    const empty = composeMonthly({ monthKey: DEC, exams: [], trainings: 0, studyMinutes: 0, tasksDone: 0, away: [], vacations: [] });
    assert.equal(empty.text, `בריף חודשי · דצמבר\n${MONTHLY_NOTHING_LINE}`);
    const partial = composeMonthly({ monthKey: DEC, exams: [], away: [], vacations: [], partial: true });
    assert.equal(partial.text, 'בריף חודשי · דצמבר');
  });
  test('לוח המבחנים לא מכסה את החודש הבא: אומרים את זה, ולא "אין כלום"', () => {
    const { text } = composeMonthly({ monthKey: '2027-01', exams: DEC_EXAMS.slice(0, 3), trainings: 0, studyMinutes: 0, tasksDone: 0, away: [], vacations: [] });
    assert.match(text, /\nהחודש הבא · ינואר\nלוח המבחנים עוד לא מכסה את ינואר$/);
    assert.doesNotMatch(text, new RegExp(MONTHLY_NOTHING_LINE));
  });
  test('הלוח מכסה רק חלק מהחודש: שורת "מכסה רק עד"', () => {
    const { text } = composeMonthly({ monthKey: DEC, exams: DEC_EXAMS.slice(0, 3), vacations: [] });
    assert.match(text, /\n· יום חמישי 24\.12 · מבחן במדעים\nלוח המבחנים מכסה רק עד 24\.12/);
  });
  test('חופשה של יום אחד ו"סוף שנת הלימודים"', () => {
    const vacations = [{ name: 'פורים', from: '2027-03-23', to: '2027-03-23' }];
    assert.match(composeMonthly({ monthKey: '2027-03', exams: [], vacations }).text, /· פורים · 23\.3/);
    const end = [{ name: 'סוף שנת הלימודים', from: '2027-06-20', to: '2027-06-20', endOfYear: true }];
    assert.match(composeMonthly({ monthKey: '2027-06', exams: [], vacations: end }).text, /· סוף שנת הלימודים · מ-20\.6/);
  });
});

describe('monthly-brief: monthlyPushText', () => {
  test('מספרים בלבד, על החודש הבא', () => {
    assert.equal(monthlyPushText({ exams: 3, denseWeeks: 1, vacations: 2 }), 'החודש הבא: 3 מבחנים · שבוע עמוס אחד · 2 חופשות');
    assert.equal(monthlyPushText({ exams: 1, denseWeeks: 2, vacations: 1 }), 'החודש הבא: מבחן אחד · 2 שבועות עמוסים · חופשה אחת');
  });
  test('שקט', () => assert.equal(monthlyPushText({}), 'החודש הבא: שקט'));
});

describe('monthly-brief: טוענים', () => {
  test('loadMonthTrainings: אימוני ריצה שלא בוטלו (planned / done) שהסתיימו בחודש', async () => {
    const sql = fakeSql(() => [{ n: 9 }]);
    assert.equal(await loadMonthTrainings(sql, '2026-11'), 9);
    const [call] = sql.calls;
    assert.match(call.text, /domain = 'running' AND status IN \('planned', 'done'\) AND \(title LIKE 'אימון ריצה%' OR title = 'ריצה'\)/);
    assert.match(call.text, /ends_at >= \?::timestamptz AND ends_at < \?::timestamptz/);
    assert.ok(call.values.includes('2026-10-31T22:00:00.000Z')); // תחילת 1.11 בישראל
    assert.ok(call.values.includes('2026-11-30T22:00:00.000Z')); // תחילת 1.12 בישראל
  });
  test('loadMonthStudyMinutes: סכום הדקות של אירועי למידה שלא בוטלו', async () => {
    const sql = fakeSql(() => [{ minutes: 730 }]);
    assert.equal(await loadMonthStudyMinutes(sql, '2026-11'), 730);
    const [call] = sql.calls;
    assert.match(call.text, /domain = \?::text AND status IN \('planned', 'done'\)/);
    assert.ok(call.values.includes('study'));
  });
  test('loadMonthTasksDone: משימות שסומנו בוצע בחודש (done_at)', async () => {
    const sql = fakeSql(() => [{ n: 14 }]);
    assert.equal(await loadMonthTasksDone(sql, '2026-11'), 14);
    assert.match(sql.calls[0].text, /FROM tasks WHERE status = 'done' AND done_at >= \?::timestamptz AND done_at < \?::timestamptz/);
  });
  test('loadMonthAway: אירוע אישי של כמה ימים שנוגע בחודש; אירוע עם שעות לא נכנס', async () => {
    const sql = fakeSql(() => [
      { id: 'a', title: 'חופשה בווינה', domain: 'personal', status: 'planned', starts_at: '2026-12-19T22:00:00Z', ends_at: '2026-12-23T22:00:00Z' },
      { id: 'b', title: 'רופא', domain: 'personal', status: 'planned', starts_at: '2026-12-03T08:00:00Z', ends_at: '2026-12-03T09:00:00Z' },
    ]);
    assert.deepEqual(await loadMonthAway(sql, DEC), [{ title: 'חופשה בווינה', start: '2026-12-20', last: '2026-12-23' }]);
    assert.match(sql.calls[0].text, /domain = 'personal' AND status = 'planned'/);
  });
  test('כשל מסד נזרק (הצרכן מחליט)', async () => {
    const sql = fakeSql(() => { throw new Error('db'); });
    await assert.rejects(loadMonthTrainings(sql, '2026-11'));
  });
});

describe('cron-plan: תזמון החודשי', () => {
  const sends = () => { const calls = []; const fn = async (...a) => { calls.push(a); return {}; }; fn.calls = calls; return fn; };
  const run = (iso, slot, send, extra = {}) => cronHandle(req(`https://x.test/api/ops?slot=${slot}`, { headers: { authorization: `Bearer ${FAKE_CRON}` } }),
    { sql: fakeSql(), secret: FAKE_CRON, now: () => new Date(iso), send, timetable: { slots: [] }, taskChecksEnabled: false, ...extra });
  test('ב-1.12, slot=1: נשלחת הודעת monthly עם idempotencyKey של החודש', async () => {
    const send = sends();
    const res = await run('2026-12-01T01:00:00Z', '1', send);
    assert.equal(res.status, 200);
    const monthly = send.calls.find((c) => c[1].kind === 'monthly');
    assert.ok(monthly);
    assert.equal(monthly[1].slotKey, 'monthly-2026-12');
    assert.equal(monthly[2].idempotencyKey, 'monthly-2026-12');
  });
  test('יום אחר: לא נשלחת. monthlyEnabled=false: לא נשלחת', async () => {
    const send = sends();
    await run('2026-11-30T14:00:00Z', '2', send);
    assert.equal(send.calls.some((c) => c[1].kind === 'monthly'), false);
    const off = sends();
    await run('2026-12-01T14:00:00Z', '2', off, { monthlyEnabled: false });
    assert.equal(off.calls.some((c) => c[1].kind === 'monthly'), false);
  });
});

describe('monthly-brief: כרטיס "מה לשמר ומה לשפר"', () => {
  const TARGET = '2026-12-01T18:00:00.000Z';
  test('נוצר פעם אחת לחודש: שאלה ממתינה, פגה אחרי 3 ימים, ועובדת month', async () => {
    const sql = fakeSql((text) => (text.includes('monthly-review-create') ? [{ message_id: 'q1' }] : []));
    const out = await ensureMonthlyReview({ sql, monthKey: DEC, targetAt: TARGET });
    assert.equal(out.created, true);
    const [call] = sql.find('monthly-review-create');
    assert.match(call.text, /'question'/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM messages x WHERE x\.entity_type = \?::text AND x\.entity_id = \?::uuid\)/);
    assert.ok(call.values.includes(MONTHLY_REVIEW_TEXT));
    assert.ok(call.values.includes(MONTHLY_REVIEW_ENTITY));
    assert.ok(call.values.includes(monthlyReviewEntityId(DEC)));
    assert.ok(call.values.includes(DEC));
    assert.ok(call.values.includes('2026-12-04T18:00:00.000Z'));
    assert.equal(monthlyReviewExpiresAt(TARGET).toISOString(), '2026-12-04T18:00:00.000Z');
  });
  test('כשל מסד לא נזרק', async () => {
    const sql = fakeSql(() => { throw new Error('db'); });
    assert.deepEqual(await ensureMonthlyReview({ sql, monthKey: DEC, targetAt: TARGET }), { created: false });
  });
  test('pendingFromRows: כרטיס בלי כפתורים, עם תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: 'q1', body: MONTHLY_REVIEW_TEXT, sent_at: new Date('2026-12-01T18:00:01Z'), entity_type: MONTHLY_REVIEW_ENTITY }], facts: [], timetable: null, today: '2026-12-01' });
    assert.deepEqual(item, { id: 'q1', kind: 'monthly_review', at: '2026-12-01T18:00:01.000Z', text: MONTHLY_REVIEW_TEXT, buttons: [], allowFreeText: true });
  });

  const MSG = '11111111-2222-4333-8444-555555555555';
  const NOW = new Date('2026-12-02T10:00:00Z');
  const ask = { id: MSG, awaiting_reply: true };
  const written = { closed: 1, answer_source_id: 's1', bubble_id: 'b1' };
  const sqlFor = (row = ask, write = written) => fakeSql((text) => (text.includes('monthly-review-ask') ? (row ? [row] : []) : text.includes('monthly-review-answer') ? [write] : []));
  test('תשובה חופשית: נסגר, נשמר (sources + facts answer) ובועה "נרשם"', async () => {
    const sql = sqlFor();
    const out = await answerMonthlyReview({ sql, messageId: MSG, answer: '  לשמר את הריצות, לשפר את הלמידה למבדקים ', now: NOW });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.created, { answerSourceId: 's1', bubbleId: 'b1' });
    const [call] = sql.find('monthly-review-answer');
    assert.match(call.text, /UPDATE messages SET awaiting_reply = false/);
    assert.match(call.text, /INSERT INTO sources/);
    assert.match(call.text, /INSERT INTO facts/);
    assert.match(call.text, /'answer'/);
    assert.ok(call.values.includes('לשמר את הריצות, לשפר את הלמידה למבדקים'));
    assert.ok(call.values.includes(MONTHLY_REVIEW_ACK));
    assert.equal(MONTHLY_REVIEW_ACK, 'נרשם');
  });
  test('טקסט ריק: unclear בלי כתיבה. כרטיס שנסגר, פג או לא קיים: closed', async () => {
    const sql = sqlFor();
    assert.equal((await answerMonthlyReview({ sql, messageId: MSG, answer: '   ', now: NOW })).status, 'unclear');
    assert.equal(sql.find('monthly-review-answer').length, 0);
    assert.equal((await answerMonthlyReview({ sql: sqlFor(null), messageId: MSG, answer: 'x', now: NOW })).status, 'closed');
    assert.equal((await answerMonthlyReview({ sql: sqlFor({ ...ask, awaiting_reply: false }), messageId: MSG, answer: 'x', now: NOW })).status, 'closed');
    assert.equal((await answerMonthlyReview({ sql: sqlFor(ask, { closed: 0 }), messageId: MSG, answer: 'x', now: NOW })).status, 'closed');
  });
  test('api/chat: תשובה בכתיבה (action answer) מגיעה ל-answerMonthlyReview', async () => {
    const sql = sqlFor();
    const request = jsonRequest({ action: 'answer', message_id: MSG, answer: 'לשמר את השינה' }, { url: 'https://x.test/api/chat', headers: { 'x-intake-secret': FAKE_SECRET, 'content-type': 'application/json' } });
    const res = await chatHandle(request, { sql, secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: async () => ({ ok: true, events: [] }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sql.find('monthly-review-answer').length, 1);
  });
});

describe('deliver: monthly', () => {
  const MSG = { kind: 'monthly', slotKey: 'monthly-2026-12', targetAt: '2026-12-01T18:00:00.000Z' };
  const AT = () => new Date('2026-12-01T18:00:01Z');
  const handler = (existing = false, extra = () => undefined) => (text) => {
    const hit = extra(text);
    if (hit !== undefined) return hit;
    if (text.includes(`entity_type = '${MONTHLY_ENTITY}'`) && text.startsWith('SELECT')) return existing ? [{ found: 1 }] : [];
    if (text.includes('monthly-review-create')) return [{ message_id: 'q1' }];
    if (text.includes('INSERT INTO messages')) return [{ id: 'm1' }];
    return [];
  };
  const pushHandle = (calls) => async (request) => { calls.push(JSON.parse(await request.text())); return new Response('ok', { status: 200 }); };
  test('כותב הודעה אחת (monthly_brief, entity_id דטרמיניסטי), יוצר את כרטיס השאלה, ואז דחיפה עם מספרים בלבד', async () => {
    const sql = fakeSql(handler(false, (text) => (text.includes('monthly-tasks-done') ? [{ n: 4 }] : undefined)));
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: AT, pushHandle: pushHandle(pushes), secret: FAKE_CRON });
    assert.equal(out.created, true);
    const insert = sql.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes(`'${MONTHLY_ENTITY}'`));
    assert.ok(insert);
    assert.ok(insert.values.includes(briefEntityId(MSG.slotKey)));
    assert.match(insert.values[0], /^בריף חודשי · דצמבר/);
    assert.match(insert.values[0], /משימות שבוצעו: 4/);
    const review = sql.calls.findIndex((c) => c.text.includes('monthly-review-create'));
    const notify = sql.calls.findIndex((c) => c.text.includes('awaiting_reply = true AND (expires_at')); // loadNotifyState (lib/chat-notify.js)
    assert.ok(review >= 0, 'נוצר כרטיס השאלה');
    assert.ok(notify > review, 'הכרטיס נוצר לפני הדחיפה, כדי שייספר במספר');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].dedupe_key, MSG.slotKey);
    assert.match(pushes[0].body, /^החודש הבא: /);
  });
  test('כשל בטעינת חלק, לא בניסיון האחרון: נזרק לניסיון חוזר', async () => {
    const sql = fakeSql(handler(false, (text) => { if (text.includes('monthly-trainings')) throw new Error('db'); return undefined; }));
    await assert.rejects(handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: AT, pushHandle: pushHandle([]), secret: FAKE_CRON }));
  });
  test('כשל בטעינת חלק בניסיון האחרון: הבריף נשלח בלי החלק', async () => {
    const sql = fakeSql(handler(false, (text) => { if (text.includes('monthly-trainings') || text.includes('monthly-tasks-done')) throw new Error('db'); return undefined; }));
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 5 }, { sql, now: AT, pushHandle: pushHandle(pushes), secret: FAKE_CRON });
    assert.equal(out.created, true);
    const insert = sql.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes(`'${MONTHLY_ENTITY}'`));
    assert.doesNotMatch(insert.values[0], /אימונים|משימות שבוצעו/);
    assert.equal(pushes.length, 1);
  });
  test('הודעה קיימת: לא נכתבת שוב ואין דחיפה; הכרטיס עדיין מנוסה (אידמפוטנטי)', async () => {
    const sql = fakeSql(handler(true));
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: AT, pushHandle: pushHandle(pushes), secret: FAKE_CRON });
    assert.equal(out.created, false);
    assert.equal(sql.calls.filter((c) => c.text.includes('INSERT INTO messages') && c.text.includes(`'${MONTHLY_ENTITY}'`)).length, 0);
    assert.equal(sql.find('monthly-review-create').length, 1);
    assert.equal(pushes.length, 0);
  });
  test('כשל ביצירת הכרטיס לא חוסם את הבריף ואת הדחיפה', async () => {
    const sql = fakeSql(handler(false, (text) => { if (text.includes('monthly-review-create')) throw new Error('db'); return undefined; }));
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: AT, pushHandle: pushHandle(pushes), secret: FAKE_CRON });
    assert.equal(out.created, true);
    assert.equal(pushes.length, 1);
  });
});
