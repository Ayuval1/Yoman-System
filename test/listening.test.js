// בדיקות ל-lib/listening.js (בלוק 9, ש8 = ב' + א'): שורה בבריף, הצעה ב-17:00 בימי אימון, והוספה מהצ'אט. בלי רשת ובלי מסד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, FAKE_CRON, req } from './helpers.js';
import { detectListenAdd, addListening, loadListening, pickForDay, briefLine, createListenSuggestion, LISTEN_DOMAIN, LISTEN_STATUS, LISTEN_SUGGEST_ENTITY } from '../lib/listening.js';
import { planListen, parseSlotMessage } from '../lib/message-slots.js';
import { composeBrief } from '../lib/brief-view.js';
import { handle as cronHandle } from '../lib/ops/cron-plan.js';
import { processSource } from '../lib/intake-process.js';

const SRC = { id: '44444444-4444-4444-8444-444444444444' };
const ITEMS = [{ id: 'a', title: 'פודקאסט היסטוריה' }, { id: 'b', title: 'קורס פייתון' }, { id: 'c', title: 'ספר שמע' }];

describe('listening: זיהוי הוספה', () => {
  test('"להאזנה: <שם>" ו"תוסיף לרשימת האזנה <שם>"', () => {
    assert.equal(detectListenAdd('להאזנה: עושים היסטוריה'), 'עושים היסטוריה');
    assert.equal(detectListenAdd('להאזנה - קורס פייתון פרק 3'), 'קורס פייתון פרק 3');
    assert.equal(detectListenAdd('תוסיף לרשימת האזנה  עושים   היסטוריה '), 'עושים היסטוריה');
    assert.equal(detectListenAdd('תוסיף לרשימת ההאזנה: פודקאסט'), 'פודקאסט');
    assert.equal(detectListenAdd('הוסף לרשימת האזנה את הקורס'), 'את הקורס');
  });
  test('לא תופס משפט אחר', () => {
    assert.equal(detectListenAdd('אני רוצה להאזנה'), null);
    assert.equal(detectListenAdd('להאזנה:'), null);
    assert.equal(detectListenAdd('תוסיף לרשימת קניות חלב'), null);
    assert.equal(detectListenAdd(null), null);
  });
  test('שם ארוך נחתך ל-120 תווים', () => {
    assert.equal(detectListenAdd(`להאזנה: ${'א'.repeat(300)}`).length, 120);
  });
});

describe('listening: שמירה וטעינה', () => {
  test('הוספה: שורת tasks עם domain listening ו-status listen (לא open, ולכן לא ברשימת המשימות), בלי כפילות, ובועה', async () => {
    const sql = fakeSql((text) => (text.includes('listen-add */') ? [{ claimed: 1, added: 1, before: 2 }] : []));
    const out = await addListening({ sql, source: SRC, title: 'קורס פייתון' });
    assert.deepEqual(out, { status: 'recorded', reply: 'נוסף לרשימת ההאזנה · קורס פייתון (3 ברשימה)' });
    const [call] = sql.find('listen-add */');
    assert.match(call.text, /INSERT INTO tasks \(title, domain, status\)/);
    assert.ok(call.values.includes(LISTEN_DOMAIN) && call.values.includes(LISTEN_STATUS));
    assert.match(call.text, /NOT EXISTS \(SELECT 1 FROM tasks x/);
    assert.equal(sql.find('listen-add-bubble').length, 1);
  });
  test('כבר ברשימה: נאמר, לא נוסף', async () => {
    const sql = fakeSql((text) => (text.includes('listen-add */') ? [{ claimed: 1, added: 0, before: 3 }] : []));
    assert.equal((await addListening({ sql, source: SRC, title: 'קורס פייתון' })).reply, 'כבר ברשימת ההאזנה · קורס פייתון');
  });
  test('loadListening לא זורק', async () => {
    assert.deepEqual(await loadListening(fakeSql(() => { throw new Error('db'); })), []);
  });
  test('הצינור: הודעה מוקלדת "להאזנה: X" נשמרת בקוד, בלי מוח', async () => {
    let called = false;
    const sql = fakeSql((text) => {
      if (text.includes('listen-add */')) return [{ claimed: 1, added: 1, before: 0 }];
      return [];
    });
    const source = { ...SRC, channel: 'app', raw_content: 'להאזנה: עושים היסטוריה', received_at: '2026-11-23T10:00:00.000Z', content_hash: null };
    const out = await processSource({ sql, source, timetable: null, understand: async () => { called = true; return { ok: false, reason: 'no-pool' }; } });
    assert.equal(out.status, 'recorded');
    assert.equal(called, false);
    assert.equal(sql.find('listen-add */').length, 1);
  });
});

describe('listening: בחירה ובריף', () => {
  test('pickForDay: סבב לפי יום, אותו יום = אותו פריט; רשימה ריקה = null', () => {
    const a = pickForDay(ITEMS, '2026-11-23');
    assert.equal(pickForDay(ITEMS, '2026-11-23'), a);
    assert.notEqual(pickForDay(ITEMS, '2026-11-24'), a);
    assert.equal(pickForDay([], '2026-11-23'), null);
  });
  test('שורת הבריף לפני השורה האחרונה; בלי רשימה אין שורה', () => {
    const line = briefLine(ITEMS[0]);
    assert.equal(line, 'להאזנה היום: פודקאסט היסטוריה');
    const lines = composeBrief({ dateIso: '2026-11-23', listening: line }).text.split('\n');
    assert.equal(lines.at(-2), line);
    assert.ok(!composeBrief({ dateIso: '2026-11-23', listening: null }).text.includes('להאזנה'));
  });
});

describe('listening: הצעה ב-17:00', () => {
  test('planListen: 17:00 של היום; אחרי 17:00 אין תזמון', () => {
    const plan = planListen(new Date('2026-11-23T01:00:00.000Z'));
    assert.equal(plan.slotKey, 'listen-2026-11-23');
    assert.equal(plan.targetAt, '2026-11-23T15:00:00.000Z');
    assert.equal(planListen(new Date('2026-11-23T15:30:00.000Z')), null);
    assert.deepEqual(parseSlotMessage({ kind: 'listen', slotKey: plan.slotKey, targetAt: plan.targetAt }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'listen', slotKey: 'listen-2026-11-24', targetAt: plan.targetAt }).ok, false);
  });
  test('cron-plan מתזמן את ההצעה בכל יום (הצרכן מחליט)', async () => {
    const sent = [];
    await cronHandle(req('https://x.test/api/cron-plan?slot=1', { headers: { authorization: `Bearer ${FAKE_CRON}` } }), {
      sql: fakeSql(), secret: FAKE_CRON, now: () => new Date('2026-11-23T01:00:00.000Z'), send: async (...args) => { sent.push(args); },
      timetable: null, homeworkEnabled: false, taskChecksEnabled: false, weeklyEnabled: false, brainRetry: async () => ({ tried: 0 }),
    });
    assert.ok(sent.some(([, body]) => body.slotKey === 'listen-2026-11-23'));
  });
  test('יום אימון ויש רשימה: הודעה אחת ליום (NOT EXISTS על מזהה קבוע ליום)', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('listen-training')) return [{ found: 1 }];
      if (text.includes('listen-load')) return ITEMS;
      if (text.includes('listen-suggest')) return [{ id: 'm1' }];
      return [];
    });
    const out = await createListenSuggestion({ sql, dateIso: '2026-11-23' });
    assert.deepEqual(out, { created: true, reason: 'created' });
    const [call] = sql.find('listen-suggest');
    assert.ok(call.values.includes(LISTEN_SUGGEST_ENTITY));
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith('יוצא לאימון? להאזנה בדרך: ')));
    const again = fakeSql((text) => (text.includes('listen-training') ? [{ found: 1 }] : text.includes('listen-load') ? ITEMS : []));
    await createListenSuggestion({ sql: again, dateIso: '2026-11-23' });
    assert.equal(again.find('listen-suggest')[0].values.at(-1), call.values.at(-1)); // אותו מזהה ליום
  });
  test('לא יום אימון, או רשימה ריקה: כלום', async () => {
    const notTraining = fakeSql(() => []);
    assert.equal((await createListenSuggestion({ sql: notTraining, dateIso: '2026-11-23' })).reason, 'not-training');
    const empty = fakeSql((text) => (text.includes('listen-training') ? [{ found: 1 }] : []));
    assert.equal((await createListenSuggestion({ sql: empty, dateIso: '2026-11-23' })).reason, 'empty');
  });
});

describe('listening: כפתור "שמעתי" (יובל, 24.11.2026)', () => {
  const MSG = '22222222-2222-4222-8222-222222222222';
  const TASK = '33333333-3333-4333-8333-333333333333';
  const NOW = new Date('2026-11-23T15:30:00.000Z');
  const sqlFor = (ask = { id: MSG, awaiting_reply: true, task_id: TASK }, written = { closed: 1, answer_source_id: 'a1', bubble_id: 'b1' }) =>
    fakeSql((text) => (text.includes('listen-ask') ? (ask ? [ask] : []) : text.includes('listen-answer') ? [written] : []));
  test('ההצעה של 17:00 היא כרטיס עם "שמעתי" / "אחר כך", שפג בסוף היום, והפריט שמור בעובדה', async () => {
    const sql = fakeSql((text) => (text.includes('listen-training') ? [{ found: 1 }] : text.includes('listen-load') ? [{ id: TASK, title: 'פודקאסט' }] : text.includes('listen-suggest') ? [{ id: 'm1' }] : []));
    await createListenSuggestion({ sql, dateIso: '2026-11-23' });
    const [call] = sql.find('listen-suggest');
    assert.match(call.text, /'question', now\(\), true/);
    assert.ok(call.values.includes(TASK));
    assert.ok(call.values.includes(new Date('2026-11-23T21:59:00.000Z').toISOString()));
    const { pendingFromRows } = await import('../lib/chat-view.js');
    const [item] = pendingFromRows({ questions: [{ id: MSG, entity_type: LISTEN_SUGGEST_ENTITY, body: 'יוצא לאימון?', sent_at: NOW.toISOString() }], facts: [], timetable: null, today: '2026-11-23' });
    assert.equal(item.kind, 'listen');
    assert.deepEqual(item.buttons, ['שמעתי', 'אחר כך']);
  });
  test('"שמעתי": הפריט יוצא מהרשימה (status heard, לא done) ובועה', async () => {
    const { answerListen } = await import('../lib/listening.js');
    const sql = sqlFor();
    const out = await answerListen({ sql, messageId: MSG, answer: 'שמעתי', now: NOW });
    assert.equal(out.status, 'answered');
    const [call] = sql.find('listen-answer');
    assert.match(call.text, /UPDATE tasks SET status = \?::text/);
    assert.ok(call.values.includes('heard'));
    assert.ok(call.values.includes(true));
    assert.ok(!call.values.includes('done'));
  });
  test('"אחר כך": נסגר בלי שינוי ברשימה; תשובה אחרת: unclear; כרטיס סגור: closed', async () => {
    const { answerListen } = await import('../lib/listening.js');
    const sql = sqlFor();
    await answerListen({ sql, messageId: MSG, answer: 'אחר כך', now: NOW });
    assert.ok(sql.find('listen-answer')[0].values.includes(false));
    assert.equal((await answerListen({ sql: sqlFor(), messageId: MSG, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal((await answerListen({ sql: sqlFor(null), messageId: MSG, answer: 'שמעתי', now: NOW })).status, 'closed');
    assert.equal((await answerListen({ sql: sqlFor(undefined, { closed: 0 }), messageId: MSG, answer: 'שמעתי', now: NOW })).status, 'closed');
  });
});
