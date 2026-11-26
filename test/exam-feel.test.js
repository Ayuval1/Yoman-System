// בדיקות ל-lib/exam-feel.js: "איך היה?" בהקשה אחת אחרי מבחן שיובל אמר עליו "לא לומד היום, אני מוכן" (הכרעת יובל 3.10.2026, ג'; 02-build-plan.md:499).
// בלי רשת ובלי מסד: sql מזויף. ה-SQL לא הורץ מול Postgres אמיתי. כל הטקסטים מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, jsonRequest, FAKE_SECRET } from './helpers.js';
import {
  EXAM_FEEL_ENTITY, EXAM_FEEL_BUTTONS, examFeelEntityId, examFeelExpiresAt, examFeelText, markExamReady, ensureExamFeel, answerExamFeel,
} from '../lib/exam-feel.js';
import { answerNotStudying, notStudyingTarget } from '../lib/study-plan.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { handle as chatHandle } from '../api/chat.js';
import { handleDelivery } from '../api/queues/deliver.js';

const THU = '2026-11-26';
const MON_MORNING = new Date('2026-11-23T05:30:00.000Z');
const CLOSE_AT = new Date('2026-11-26T19:00:01.000Z'); // חמישי 21:00 בישראל (UTC+2)
const SRC = '44444444-4444-4444-8444-444444444444';
const MSG = '22222222-2222-4222-8222-222222222222';
const MATH = { date: THU, type: 'מבחן', subject: 'מתמטיקה', makeup: false };
const REF = `${THU}:מתמטיקה`;

describe('exam-feel: איזה מבחן (טהור)', () => {
  test('notStudyingTarget: המבחן הקרוב מהלמידה שבוטלה ומהבאה, כמו בשורת התשובה', () => {
    const cancelled = ['source:study:2026-11-26:מתמטיקה:2026-11-23T16:00'];
    const later = ['source:study:2026-11-30:אנגלית:2026-11-24T16:00', 'source:study:2026-11-26:מתמטיקה:2026-11-25T16:00'];
    assert.deepEqual(notStudyingTarget({ cancelled, later }), { examDate: '2026-11-26', subject: 'מתמטיקה' });
    assert.deepEqual(notStudyingTarget({ cancelled: [], later: ['source:study:2026-11-30:אנגלית:2026-11-24T16:00'] }), { examDate: '2026-11-30', subject: 'אנגלית' });
    assert.equal(notStudyingTarget({ cancelled: [], later: [] }), null);
  });
  test('נוסח, תוקף ומזהה דטרמיניסטי', () => {
    assert.deepEqual([...EXAM_FEEL_BUTTONS], ['הלך טוב', 'בסדר', 'פחות טוב']);
    assert.equal(examFeelText(MATH), 'איך היה המבחן במתמטיקה?');
    assert.equal(examFeelText({ type: 'מבדק', subject: 'ערבית' }), 'איך היה המבדק בערבית?');
    assert.equal(examFeelExpiresAt(THU).toISOString(), '2026-11-27T22:00:00.000Z'); // סוף היום שאחרי המבחן
    assert.equal(examFeelEntityId(REF), examFeelEntityId(REF));
    assert.notEqual(examFeelEntityId(REF), examFeelEntityId(`${THU}:אנגלית`));
  });
});

describe('exam-feel: רישום "אני מוכן" למבחן', () => {
  test('answerNotStudying עם מבחן: נרשם סימון אחד (facts, entity_type exam_feel), בלי source_id', async () => {
    const cancelled = ['source:study:2026-11-26:מתמטיקה:2026-11-23T16:00'];
    const sql = fakeSql((text) => (text.includes('study-not-today */') ? [{ claimed: 1, cancelled, later: [] }] : text.includes('exam-feel-ready') ? [{ id: 'f1' }] : []));
    const out = await answerNotStudying({ sql, source: { id: SRC }, now: MON_MORNING });
    assert.equal(out.status, 'recorded');
    const [call] = sql.find('exam-feel-ready');
    assert.ok(call, 'סימון נרשם');
    assert.match(call.text, /INSERT INTO facts/);
    assert.match(call.text, /NULL::uuid/);
    assert.match(call.text, /WHERE NOT EXISTS/);
    assert.ok(call.values.includes(EXAM_FEEL_ENTITY));
    assert.ok(call.values.includes(examFeelEntityId(REF)));
    assert.ok(call.values.some((v) => typeof v === 'string' && v.includes(REF) && v.includes(SRC)));
  });
  test('בלי מבחן (אין למידה ביומן): אין סימון', async () => {
    const sql = fakeSql((text) => (text.includes('study-not-today */') ? [{ claimed: 1, cancelled: [], later: [] }] : []));
    await answerNotStudying({ sql, source: { id: SRC }, now: MON_MORNING });
    assert.equal(sql.find('exam-feel-ready').length, 0);
  });
  test('מקור שכבר טופל: אין סימון', async () => {
    const sql = fakeSql((text) => (text.includes('study-not-today */') ? [{ claimed: 0, cancelled: [], later: [] }] : []));
    await answerNotStudying({ sql, source: { id: SRC }, now: MON_MORNING });
    assert.equal(sql.find('exam-feel-ready').length, 0);
  });
  test('כשל בסימון לא מפיל את התשובה', async (t) => {
    t.mock.method(console, 'error', () => {});
    const cancelled = ['source:study:2026-11-26:מתמטיקה:2026-11-23T16:00'];
    const sql = fakeSql((text) => {
      if (text.includes('exam-feel-ready')) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
      return text.includes('study-not-today */') ? [{ claimed: 1, cancelled, later: [] }] : [];
    });
    const out = await answerNotStudying({ sql, source: { id: SRC }, now: MON_MORNING });
    assert.equal(out.status, 'recorded');
  });
  test('markExamReady בלי מבחן תקין: לא נוגע במסד', async () => {
    const sql = fakeSql();
    assert.equal(await markExamReady({ sql, sourceId: SRC, exam: { examDate: 'x', subject: 'מתמטיקה' } }), false);
    assert.equal(sql.calls.length, 0);
  });
});

describe('exam-feel: הכרטיס בסגירה של יום המבחן', () => {
  const markers = [{ value: REF }];
  const db = ({ rows = markers, inserted = [{ id: MSG }] } = {}) => fakeSql((text) => (text.includes('exam-feel-markers') ? rows : text.includes('exam-feel-create') ? inserted : []));

  test('מבחן שסומן והוא בלוח היום: כרטיס שאלה אחד עם שלושה כפתורים, נספר (awaiting_reply), פג בסוף היום שאחרי', async () => {
    const sql = db();
    const out = await ensureExamFeel({ sql, dateIso: THU, now: CLOSE_AT, exams: [MATH] });
    assert.deepEqual(out.created, [REF]);
    const [select] = sql.find('exam-feel-markers');
    assert.ok(select.values.includes(`${THU}:%`));
    const [call] = sql.find('exam-feel-create');
    assert.match(call.text, /INSERT INTO messages/);
    assert.match(call.text, /'question', now\(\), true/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM messages x WHERE x.entity_type = \?::text AND x.entity_id = \?::uuid\)/);
    assert.ok(call.values.includes('איך היה המבחן במתמטיקה?'));
    assert.ok(call.values.includes('2026-11-27T22:00:00.000Z'));
    assert.ok(call.values.includes(EXAM_FEEL_ENTITY));
    assert.ok(call.values.includes(examFeelEntityId(REF)));
  });
  test('כבר קיים (ריצה חוזרת): לא נוצר שני', async () => {
    const out = await ensureExamFeel({ sql: db({ inserted: [] }), dateIso: THU, now: CLOSE_AT, exams: [MATH] });
    assert.deepEqual(out.created, []);
  });
  test('המבחן כבר לא בלוח באותו יום (זז או בוטל): אין כרטיס', async () => {
    const sql = db();
    const out = await ensureExamFeel({ sql, dateIso: THU, now: CLOSE_AT, exams: [{ ...MATH, date: '2026-11-30' }] });
    assert.deepEqual(out.created, []);
    assert.equal(sql.find('exam-feel-create').length, 0);
  });
  test('אין סימון: שאילתה אחת, בלי כרטיס', async () => {
    const sql = db({ rows: [] });
    assert.deepEqual((await ensureExamFeel({ sql, dateIso: THU, now: CLOSE_AT, exams: [MATH] })).created, []);
    assert.equal(sql.find('exam-feel-create').length, 0);
  });
  test('כשל מסד: לא זורק', async (t) => {
    t.mock.method(console, 'error', () => {});
    const sql = fakeSql(() => { throw Object.assign(new Error('db down'), { name: 'NeonDbError' }); });
    assert.deepEqual(await ensureExamFeel({ sql, dateIso: THU, now: CLOSE_AT, exams: [MATH] }), { created: [] });
  });
  test('הסגירה של 21:00 בודקת את הסימונים של אותו יום', async () => {
    const sql = fakeSql((text) => (text.includes('RETURNING id') && text.includes("'close'") ? [{ id: 'c1' }] : []));
    await handleDelivery({ kind: 'close', slotKey: `close-${THU}`, targetAt: '2026-11-26T19:00:00.000Z' }, { deliveryCount: 1 }, {
      sql, now: () => CLOSE_AT, pushHandle: async () => new Response('ok'), secret: FAKE_SECRET, timetable: null,
      googleConfig: null, googleFetch: async () => new Response('{}'), loadTrainings: async () => [],
    });
    const [select] = sql.find('exam-feel-markers');
    assert.ok(select, 'הסגירה קראה את הסימונים');
    assert.ok(select.values.includes(`${THU}:%`));
  });
});

describe('exam-feel: בצ\'אט', () => {
  test('pendingFromRows: כרטיס עם שלושה כפתורים ובלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG, body: 'איך היה המבחן במתמטיקה?', sent_at: CLOSE_AT, entity_type: EXAM_FEEL_ENTITY }], facts: [], timetable: null, today: THU });
    assert.deepEqual(item, { id: MSG, kind: 'exam_feel', at: CLOSE_AT.toISOString(), text: 'איך היה המבחן במתמטיקה?', buttons: ['הלך טוב', 'בסדר', 'פחות טוב'], allowFreeText: false });
  });

  const ask = { id: MSG, awaiting_reply: true, exam: REF };
  const written = { closed: 1, answer_source_id: 's1', bubble_id: 'b1' };
  const sqlFor = (row = ask, write = written) => fakeSql((text) => (text.includes('exam-feel-ask') ? (row ? [row] : []) : text.includes('exam-feel-answer') ? [write] : []));

  test('תשובה: פקודה אחת שסוגרת את הכרטיס, שומרת את התשובה (sources + facts feel) ובועה', async () => {
    const sql = sqlFor();
    const out = await answerExamFeel({ sql, messageId: MSG, answer: 'הלך טוב', now: CLOSE_AT });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.created, { answerSourceId: 's1', bubbleId: 'b1' });
    const [call] = sql.find('exam-feel-answer');
    assert.match(call.text, /UPDATE messages SET awaiting_reply = false/);
    assert.match(call.text, /INSERT INTO sources/);
    assert.match(call.text, /INSERT INTO facts/);
    assert.match(call.text, /'feel'/);
    assert.ok(call.values.includes('הלך טוב'));
    assert.ok(call.values.includes('נרשם · מתמטיקה: הלך טוב'));
  });
  test('טקסט שאינו כפתור: unclear, בלי כתיבה. כרטיס שנסגר או פג: closed', async () => {
    const sql = sqlFor();
    assert.equal((await answerExamFeel({ sql, messageId: MSG, answer: 'מעולה', now: CLOSE_AT })).status, 'unclear');
    assert.equal(sql.find('exam-feel-answer').length, 0);
    assert.equal((await answerExamFeel({ sql: sqlFor(null), messageId: MSG, answer: 'בסדר', now: CLOSE_AT })).status, 'closed');
    assert.equal((await answerExamFeel({ sql: sqlFor({ ...ask, awaiting_reply: false }), messageId: MSG, answer: 'בסדר', now: CLOSE_AT })).status, 'closed');
    assert.equal((await answerExamFeel({ sql: sqlFor(ask, { closed: 0 }), messageId: MSG, answer: 'בסדר', now: CLOSE_AT })).status, 'closed');
  });
  test('api/chat: הקשה על הכרטיס (action answer) מגיעה ל-answerExamFeel', async () => {
    const sql = sqlFor();
    const request = jsonRequest({ action: 'answer', message_id: MSG, answer: 'פחות טוב' }, { url: 'https://x.test/api/chat', headers: { 'x-intake-secret': FAKE_SECRET, 'content-type': 'application/json' } });
    const res = await chatHandle(request, { sql, secret: FAKE_SECRET, timetable: null, now: () => CLOSE_AT, googleDay: async () => ({ ok: true, events: [] }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sql.find('exam-feel-answer').length, 1);
  });
});
