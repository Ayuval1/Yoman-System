// בדיקות לבריף השבועי (בלוק 8, אפיון-מורחב 15, ש3): lib/weekly-brief.js, תזמון ב-lib/message-slots.js ו-lib/ops/cron-plan.js, מסירה ב-api/queues/deliver.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeWeekly, weeklyPushText, weekDates, isBiweeklySaturday, WEEKLY_NOTHING_LINE } from '../lib/weekly-brief.js';
import { planWeekly, parseSlotMessage } from '../lib/message-slots.js';
import { briefEntityId } from '../lib/brief-view.js';
import { handle as cronHandle } from '../lib/ops/cron-plan.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, FAKE_CRON, req } from './helpers.js';

// שבת 28.11.2026 = היום שלפני השבוע הבא (ראשון 29.11 עד שבת 5.12).
const SAT = '2026-11-28';
const EXAMS = [
  { date: '2026-11-30', type: 'מבחן', subject: 'מתמטיקה' },
  { date: '2026-12-02', type: 'מבדק', subject: 'אנגלית' },
  { date: '2026-12-06', type: 'מבחן', subject: 'היסטוריה' }, // מחוץ לשבוע
  { date: '2026-11-28', type: 'מבחן', subject: 'פיזיקה' }, // היום, לא בשבוע הבא
];

describe('weekly-brief: weekDates', () => {
  test('ראשון עד שבת שאחרי שבת הנתונה', () => {
    assert.deepEqual(weekDates(SAT), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
  });
});

describe('weekly-brief: composeWeekly', () => {
  test('מבחנים, מבדק מסומן, הגשות, אימונים וחדש', () => {
    const { text, counts } = composeWeekly({
      saturdayIso: SAT, exams: EXAMS,
      tasks: [{ title: 'חוברת באנגלית', due_at: '2026-12-01T22:00:00Z' }, { title: 'להכין מצגת', due_at: '2026-12-03T14:00:00Z' }, { title: 'רחוק', due_at: '2026-12-20T00:00:00Z' }],
      trainings: [{ title: 'אימון ריצה', startsAt: '2026-11-30T14:00:00Z' }],
      received: ['נרשם · בוחן במתמטיקה'],
    });
    assert.match(text, /^השבוע הבא · 29\.11–5\.12/);
    assert.match(text, /מבחנים \(2\):/);
    assert.match(text, /· יום שני 30\.11 · מבחן במתמטיקה/);
    assert.match(text, /· יום רביעי 2\.12 · מבדק באנגלית/);
    assert.doesNotMatch(text, /היסטוריה|פיזיקה|רחוק/);
    assert.match(text, /הגשות \(2\):/);
    assert.match(text, /· יום רביעי 2\.12 · חוברת באנגלית/); // 22:00Z = 00:00 ישראל ב-2 בדצמבר (בלי שעה)
    assert.match(text, /· יום חמישי 3\.12 · להכין מצגת · 16:00/); // שעה ברורה
    assert.match(text, /אימונים \(1\):\n· יום שני 30\.11 · אימון ריצה · 16:00/);
    assert.match(text, /חדש מאז שבוע שעבר:\n· נרשם · בוחן במתמטיקה/);
    assert.deepEqual(counts, { exams: 2, tasks: 2, trainings: 1, fresh: 1 });
  });
  test('סעיף ריק מושמט', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: EXAMS, tasks: [], trainings: [], received: [] });
    assert.match(text, /מבחנים/);
    assert.doesNotMatch(text, /הגשות|אימונים|חדש מאז/);
  });
  test('אין כלום: כותרת ושורה אחת קצרה', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [], tasks: [], trainings: [], received: [] });
    assert.equal(text.split('\n').length, 2);
    assert.ok(text.endsWith(WEEKLY_NOTHING_LINE));
  });
  test('partial: אין טענה ש"אין כלום"', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [], tasks: [], trainings: [], received: [], partial: true });
    assert.doesNotMatch(text, new RegExp(WEEKLY_NOTHING_LINE));
  });
  test('חדש: עד 10 שורות ואז "ועוד N"', () => {
    const received = Array.from({ length: 13 }, (_, i) => `פריט ${i}`);
    const { text, counts } = composeWeekly({ saturdayIso: SAT, exams: [], received });
    assert.match(text, /ועוד 3/);
    assert.equal(counts.fresh, 13);
  });
  test('אותו תוכן בשבת דו-שבועית (הוק בלבד)', () => {
    const a = composeWeekly({ saturdayIso: SAT, exams: EXAMS });
    assert.equal(a.biweekly, isBiweeklySaturday(SAT));
    assert.equal(isBiweeklySaturday('2026-12-05'), !isBiweeklySaturday(SAT));
  });
});

describe('weekly-brief: weeklyPushText', () => {
  test('מספרים בלבד, בלי כותרות', () => {
    const body = weeklyPushText({ exams: 2, tasks: 1, trainings: 3, fresh: 4 });
    assert.equal(body, 'השבוע הבא: 2 מבחנים · משימה אחת להגשה · 3 אימונים · 4 חדשים');
  });
  test('שקט', () => assert.equal(weeklyPushText({ exams: 0, tasks: 0, trainings: 0, fresh: 0 }), 'השבוע הבא: שקט'));
});

describe('message-slots: planWeekly ו-parseSlotMessage', () => {
  test('שבת בבוקר: מתוזמן ל-20:00 באותו יום (17:00Z בחורף)', () => {
    const plan = planWeekly(new Date('2026-11-28T11:00:00Z'));
    assert.equal(plan.kind, 'weekly');
    assert.equal(plan.slotKey, 'weekly-2026-11-28');
    assert.equal(plan.targetAt, '2026-11-28T18:00:00.000Z');
    assert.ok(plan.delaySeconds > 0 && plan.retentionSeconds > plan.delaySeconds);
  });
  test('לא שבת: null. שבת אחרי 20:00: null', () => {
    assert.equal(planWeekly(new Date('2026-11-27T11:00:00Z')), null);
    assert.equal(planWeekly(new Date('2026-11-28T19:00:00Z')), null);
  });
  test('מפתח תקין עובר; יום שאינו שבת או תאריך שלא תואם נדחים', () => {
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-28T18:00:00.000Z' }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-27', targetAt: '2026-11-27T18:00:00.000Z' }).ok, false);
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-21T18:00:00.000Z' }).ok, false);
  });
});

describe('cron-plan: תזמון השבועי', () => {
  const sends = () => { const calls = []; const fn = async (...a) => { calls.push(a); return {}; }; fn.calls = calls; return fn; };
  const run = (iso, slot, send) => cronHandle(req(`https://x.test/api/ops?slot=${slot}`, { headers: { authorization: `Bearer ${FAKE_CRON}` } }),
    { sql: fakeSql(), secret: FAKE_CRON, now: () => new Date(iso), send, timetable: { slots: [] }, taskChecksEnabled: false });
  test('שבת, slot=2: נשלחת גם הודעת weekly עם idempotencyKey', async () => {
    const send = sends();
    const res = await run('2026-11-28T14:00:00Z', '2', send);
    assert.equal(res.status, 200);
    const weekly = send.calls.find((c) => c[1].kind === 'weekly');
    assert.ok(weekly);
    assert.equal(weekly[2].idempotencyKey, 'weekly-2026-11-28');
  });
  test('יום חול: לא נשלחת weekly', async () => {
    const send = sends();
    await run('2026-11-26T14:00:00Z', '2', send);
    assert.equal(send.calls.some((c) => c[1].kind === 'weekly'), false);
  });
});

describe('deliver: weekly', () => {
  const MSG = { kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-28T18:00:00.000Z' };
  const handler = (existing = false) => (text) => {
    if (text.includes("entity_type = 'weekly_brief'") && text.startsWith('SELECT')) return existing ? [{ found: 1 }] : [];
    if (text.includes('INSERT INTO messages')) return [{ id: 'm1' }];
    return [];
  };
  const pushHandle = (calls) => async (request) => { calls.push(JSON.parse(await request.text())); return new Response('ok', { status: 200 }); };
  test('כותב הודעה אחת (weekly_brief, entity_id דטרמיניסטי) ודחיפה עם מספרים בלבד', async () => {
    const sql = fakeSql(handler());
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-28T18:00:01Z'), pushHandle: pushHandle(pushes), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(out.created, true);
    const insert = sql.find('INSERT INTO messages')[0];
    assert.ok(insert.text.includes("'weekly_brief'"));
    assert.equal(insert.values[2], briefEntityId(MSG.slotKey));
    assert.match(insert.values[0], /^השבוע הבא/);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].dedupe_key, MSG.slotKey);
    assert.match(pushes[0].body, /^השבוע הבא: /);
  });
  test('הודעה קיימת: לא נכתבת שוב', async () => {
    const sql = fakeSql(handler(true));
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-28T18:00:01Z'), pushHandle: pushHandle([]), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(out.created, false);
    assert.equal(sql.find('INSERT INTO messages').length, 0);
  });
});
