// משימה אישית בכתיבה בצ'אט ומעקב "בוצע?" (בלוק 4; docs/01-foundation/אפיון-מורחב.md סעיף 3 פריט 13; docs/08-chapter8/60 תרחיש ג, סעיף 12, קריטריון 12; אפיון.md סעיף 8).
// כל הטקסטים מומצאים. 21.11.2026 הוא שבת; שעון ישראל בחורף = UTC+2.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, formRequest, jsonRequest, req, captureConsole, FAKE_SECRET, FAKE_CRON } from './helpers.js';
import { processSource } from '../lib/intake-process.js';
import { handle as intakeHandle } from '../api/intake.js';
import { handle as chatHandle } from '../api/chat.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { handle as cronHandle } from '../lib/ops/cron-plan.js';
import {
  readTask, dueDateFrom, dueTimeFrom, taskTitleFrom, dueAtFor, isTimedDue, taskReply,
  recordPersonalTask, answerTaskDue, answerTaskCheck, answerTaskQuestion, createImmediateCheck, ensureClosingChecks,
  closeQuestionsForTask, loadTimedTasks, checkButtons,
  DUE_QUESTION, CHECK_QUESTION, CHECK_DONE, CHECK_NOT_YET, DUE_ENTITY, CHECK_ENTITY, RELEVANCE_DAYS, TASK_DOMAIN,
} from '../lib/personal-task.js';
import { planTaskCheck, parseSlotMessage, taskCheckFromKey, TASKCHECK_MAX_DELAY_SECONDS } from '../lib/message-slots.js';
import { pendingFromRows } from '../lib/chat-view.js';

const SATURDAY_NOON = new Date('2026-11-21T12:00:00Z'); // שבת 14:00 בישראל
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const SRC_ID = '33333333-3333-4333-8333-333333333333';

describe('קריאת משימה מטקסט (קוד)', () => {
  test('"להכין מצגת בהיסטוריה עד שלישי": כותרת בלי התאריך, תאריך שלישי 24.11, בלי שעה', () => {
    assert.deepEqual(readTask({ text: 'להכין מצגת בהיסטוריה עד שלישי', receivedAt: SATURDAY_NOON }), { title: 'להכין מצגת בהיסטוריה', date: '2026-11-24', time: null });
  });
  test('בלי תאריך: date ריק (נשאל "עד מתי?")', () => {
    assert.deepEqual(readTask({ text: 'להתקשר לסבתא', receivedAt: SATURDAY_NOON }), { title: 'להתקשר לסבתא', date: null, time: null });
  });
  test('תאריך ושעה: "לשלוח מייל עד יום שני ב-17:00"', () => {
    assert.deepEqual(readTask({ text: 'לשלוח מייל עד יום שני ב-17:00', receivedAt: SATURDAY_NOON }), { title: 'לשלוח מייל', date: '2026-11-23', time: '17:00' });
  });
  test('שעה אחרי "עד": "לשלוח מייל מחר עד 17:00"', () => {
    assert.deepEqual(readTask({ text: 'לשלוח מייל מחר עד 17:00', receivedAt: SATURDAY_NOON }), { title: 'לשלוח מייל', date: '2026-11-22', time: '17:00' });
  });
  test('שעה בלי תאריך: היום אם השעה עוד לא עברה; אם עברה, אין תאריך ואין שעה', () => {
    assert.deepEqual(readTask({ text: 'לקנות חלב ב-17:00', receivedAt: SATURDAY_NOON }), { title: 'לקנות חלב', date: '2026-11-21', time: '17:00' });
    assert.deepEqual(readTask({ text: 'לקנות חלב ב-10:00', receivedAt: SATURDAY_NOON }), { title: 'לקנות חלב', date: null, time: null });
  });
  test('שעה עמומה ("מחר בחמש"): בלי שעה, רק תאריך', () => {
    assert.deepEqual(readTask({ text: 'לקנות חלב מחר בחמש', receivedAt: SATURDAY_NOON }), { title: 'לקנות חלב', date: '2026-11-22', time: null });
  });
  test('dueDateFrom: יום חשוף כתשובה, "עד ראשון", תאריך מספרי; תאריך שעבר = null', () => {
    assert.equal(dueDateFrom('שלישי', SATURDAY_NOON), '2026-11-24');
    assert.equal(dueDateFrom('עד ראשון', SATURDAY_NOON), '2026-11-22');
    assert.equal(dueDateFrom('24.11', SATURDAY_NOON), '2026-11-24');
    assert.equal(dueDateFrom('מחר', SATURDAY_NOON), '2026-11-22');
    assert.equal(dueDateFrom('לא יודע', SATURDAY_NOON), null);
    assert.equal(dueDateFrom('', SATURDAY_NOON), null);
  });
  test('dueTimeFrom: ספרות, "בשעה 10", ריק', () => {
    assert.equal(dueTimeFrom('ב-17:00'), '17:00');
    assert.equal(dueTimeFrom('בשעה 10'), '10:00');
    assert.equal(dueTimeFrom('17:30'), '17:30');
    assert.equal(dueTimeFrom('מחר'), null);
  });
  test('taskTitleFrom: כל הטקסט כשאין תאריך; חיתוך לפני "היום"; קיצוץ סימני פיסוק', () => {
    assert.equal(taskTitleFrom('להתקשר לסבתא!', SATURDAY_NOON), 'להתקשר לסבתא');
    assert.equal(taskTitleFrom('לקנות מתנה היום', SATURDAY_NOON), 'לקנות מתנה');
  });
});

describe('קריאת משימה עם המוח', () => {
  const understanding = (over = {}) => ({ kind: 'task', subject: null, topic: 'להכין מצגת בהיסטוריה', date_text: 'עד שלישי', new_date_text: null, time_text: null, new_room: null, uncertain: [], ...over });
  test('הכותרת מהמוח, התאריך מחושב בקוד מהביטוי שהעתיק', () => {
    assert.deepEqual(readTask({ text: 'להכין מצגת בהיסטוריה עד שלישי', receivedAt: SATURDAY_NOON, understanding: understanding() }), { title: 'להכין מצגת בהיסטוריה', date: '2026-11-24', time: null });
  });
  test('המוח סימן תאריך לא ודאי ואין ביטוי: בלי תאריך (שואלים), גם אם הקוד היה מוצא', () => {
    const out = readTask({ text: 'להתקשר לסבתא', receivedAt: SATURDAY_NOON, understanding: understanding({ topic: 'להתקשר לסבתא', date_text: null, uncertain: ['date'] }) });
    assert.deepEqual(out, { title: 'להתקשר לסבתא', date: null, time: null });
  });
  test('שעה מהמוח: time_text', () => {
    const out = readTask({ text: 'לשלוח מייל מחר ב-17:00', receivedAt: SATURDAY_NOON, understanding: understanding({ topic: 'לשלוח מייל', date_text: 'מחר', time_text: 'ב-17:00' }) });
    assert.deepEqual(out, { title: 'לשלוח מייל', date: '2026-11-22', time: '17:00' });
  });
  test('כותרת ריקה מהמוח: הכותרת של הקוד', () => {
    const out = readTask({ text: 'להתקשר לסבתא', receivedAt: SATURDAY_NOON, understanding: understanding({ topic: null, date_text: null }) });
    assert.equal(out.title, 'להתקשר לסבתא');
  });
});

describe('due_at ו"שעה ברורה" (מוסכמה בלי שינוי סכמה)', () => {
  test('תאריך בלי שעה = 00:00 בישראל; עם שעה = השעה', () => {
    assert.equal(dueAtFor({ date: '2026-11-24', time: null }).toISOString(), '2026-11-23T22:00:00.000Z');
    assert.equal(dueAtFor({ date: '2026-11-24', time: '17:00' }).toISOString(), '2026-11-24T15:00:00.000Z');
    assert.equal(dueAtFor({ date: null, time: null }), null);
  });
  test('isTimedDue: 00:00 בישראל = בלי שעה; כל שעה אחרת = שעה ברורה; ריק = לא', () => {
    assert.equal(isTimedDue('2026-11-23T22:00:00.000Z'), false);
    assert.equal(isTimedDue(new Date('2026-11-24T15:00:00Z')), true);
    assert.equal(isTimedDue(null), false);
    assert.equal(isTimedDue('not a date'), false);
  });
  test('taskReply: "נרשם · משימה · כותרת · עד שלישי 24.11", ועם שעה', () => {
    assert.equal(taskReply({ title: 'להכין מצגת', date: '2026-11-24', time: null }), 'נרשם · משימה · להכין מצגת · עד שלישי 24.11');
    assert.equal(taskReply({ title: 'לשלוח מייל', date: '2026-11-22', time: '17:00' }), 'נרשם · משימה · לשלוח מייל · עד ראשון 22.11 · 17:00');
  });
});

// sql מזויף לפקודת הרישום: מחזיר claimed ו-task_id לפי הצורך.
const recordSql = ({ claimed = 1 } = {}) => fakeSql((text) => (text.startsWith('WITH claim AS') ? [{ claimed, task_id: claimed ? TASK_ID : null }] : []));
const SOURCE = { id: SRC_ID, channel: 'app', raw_content: 'x', received_at: SATURDAY_NOON };

describe('recordPersonalTask: פקודה אחת אטומית', () => {
  test('עם תאריך: שורת tasks (personal, open, due_at) + בועת "נרשם", בלי שאלה', async () => {
    const sql = recordSql();
    const out = await recordPersonalTask({ sql, source: SOURCE, task: { title: 'להכין מצגת', date: '2026-11-24', time: null } });
    assert.deepEqual(out, { status: 'recorded', reply: 'נרשם · משימה · להכין מצגת · עד שלישי 24.11', task: { id: TASK_ID, dueAt: '2026-11-23T22:00:00.000Z', timed: false } });
    assert.equal(sql.calls.length, 1);
    const [call] = sql.calls;
    assert.match(call.text, /UPDATE sources SET processed_at = now\(\) WHERE id = \?::uuid AND processed_at IS NULL/);
    assert.match(call.text, /INSERT INTO tasks \(title, due_at, domain, status\) SELECT \?::text, \?::timestamptz, 'personal', 'open' FROM claim/);
    assert.deepEqual(call.values.slice(0, 3), [SRC_ID, 'להכין מצגת', '2026-11-23T22:00:00.000Z']);
    assert.ok(call.values.includes(null), 'השאלה ריקה');
    assert.ok(call.values.includes('נרשם · משימה · להכין מצגת · עד שלישי 24.11'));
  });
  test('בלי תאריך: משימה עם due_at ריק + שאלת "עד מתי?" (entity_type task) בלי בועה', async () => {
    const sql = recordSql();
    const out = await recordPersonalTask({ sql, source: SOURCE, task: { title: 'להתקשר לסבתא', date: null, time: null } });
    assert.deepEqual(out, { status: 'recorded', reply: 'עד מתי? · להתקשר לסבתא', task: { id: TASK_ID, dueAt: null, timed: false } });
    const [call] = sql.calls;
    assert.match(call.text, /'question', now\(\), true, NULL::uuid, NULL::timestamptz, 'task', t\.id, 1 FROM t/);
    assert.ok(call.values.includes('עד מתי? · להתקשר לסבתא'));
    assert.equal(call.values[2], null, 'due_at ריק');
  });
  test('עם שעה: timed=true', async () => {
    const out = await recordPersonalTask({ sql: recordSql(), source: SOURCE, task: { title: 'לשלוח מייל', date: '2026-11-22', time: '17:00' } });
    assert.deepEqual(out.task, { id: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z', timed: true });
  });
  test('המקור כבר נתפס: skipped ושום משימה', async () => {
    const out = await recordPersonalTask({ sql: recordSql({ claimed: 0 }), source: SOURCE, task: { title: 'x', date: null, time: null } });
    assert.equal(out.status, 'skipped');
    assert.equal(out.task, undefined);
  });
});

// sql מזויף לתשובה: הטעינה מחזירה את השאלה והמשימה; הכתיבה מחזירה closed.
const answerSql = ({ entityType = DUE_ENTITY, awaiting = true, closed = 1, title = 'להתקשר לסבתא', status = 'open' } = {}) => fakeSql((text) => {
  if (text.startsWith('SELECT m.id')) return [{ id: MSG_ID, awaiting_reply: awaiting, entity_type: entityType, task_id: TASK_ID, title, status }];
  if (text.startsWith('WITH closed AS')) return [{ closed, answer_source_id: 'a', bubble_id: 'b' }];
  return [];
});

describe('תשובה לשאלת "עד מתי?"', () => {
  test('תאריך מתפענח: due_at נקבע, בועת "נרשם", פקודה אחת', async () => {
    const sql = answerSql();
    const out = await answerTaskDue({ sql, messageId: MSG_ID, answer: 'שלישי', now: SATURDAY_NOON });
    assert.deepEqual(out, { status: 'answered', created: { answerSourceId: 'a', bubbleId: 'b' }, task: { id: TASK_ID, dueAt: '2026-11-23T22:00:00.000Z', timed: false } });
    const write = sql.find('WITH closed AS')[0];
    assert.match(write.text, /UPDATE tasks SET due_at = \?::timestamptz WHERE id IN \(SELECT entity_id FROM closed\) AND status = 'open'/);
    assert.ok(write.values.includes('נרשם · משימה · להתקשר לסבתא · עד שלישי 24.11'));
  });
  test('תאריך ושעה: timed', async () => {
    const out = await answerTaskDue({ sql: answerSql(), messageId: MSG_ID, answer: 'מחר ב-17:00', now: SATURDAY_NOON });
    assert.deepEqual(out.task, { id: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z', timed: true });
  });
  test('תשובה שלא מתפענחת: unclear, בלי כתיבה (הכרטיס נשאר)', async () => {
    const sql = answerSql();
    const out = await answerTaskDue({ sql, messageId: MSG_ID, answer: 'מתישהו', now: SATURDAY_NOON });
    assert.deepEqual(out, { status: 'unclear', created: {} });
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
  test('שאלה שנסגרה או לחיצה מקבילה: closed', async () => {
    assert.equal((await answerTaskDue({ sql: answerSql({ awaiting: false }), messageId: MSG_ID, answer: 'שלישי', now: SATURDAY_NOON })).status, 'closed');
    assert.equal((await answerTaskDue({ sql: answerSql({ closed: 0 }), messageId: MSG_ID, answer: 'שלישי', now: SATURDAY_NOON })).status, 'closed');
  });
});

describe('תשובה לשאלת "בוצע?"', () => {
  test('"בוצע": המשימה done (רק אם open), done_at, בועה', async () => {
    const sql = answerSql({ entityType: CHECK_ENTITY, title: 'לשלוח מייל' });
    const out = await answerTaskCheck({ sql, messageId: MSG_ID, answer: CHECK_DONE, now: SATURDAY_NOON });
    assert.equal(out.status, 'answered');
    const write = sql.find('WITH closed AS')[0];
    assert.match(write.text, /UPDATE tasks SET status = 'done', done_at = now\(\) WHERE id IN \(SELECT entity_id FROM closed\) AND status = 'open' AND \?::boolean/);
    assert.ok(write.values.includes(true));
    assert.ok(write.values.includes('בוצע · לשלוח מייל'));
  });
  test('"עוד לא": המשימה נשארת open (העדכון כבוי), בועה "נשאר פתוח"', async () => {
    const sql = answerSql({ entityType: CHECK_ENTITY, title: 'לשלוח מייל' });
    const out = await answerTaskCheck({ sql, messageId: MSG_ID, answer: CHECK_NOT_YET, now: SATURDAY_NOON });
    assert.equal(out.status, 'answered');
    const write = sql.find('WITH closed AS')[0];
    assert.ok(write.values.includes(false));
    assert.ok(write.values.includes('נשאר פתוח · לשלוח מייל'));
  });
  test('טקסט אחר: unclear, בלי כתיבה', async () => {
    const sql = answerSql({ entityType: CHECK_ENTITY });
    assert.deepEqual(await answerTaskCheck({ sql, messageId: MSG_ID, answer: 'אולי', now: SATURDAY_NOON }), { status: 'unclear', created: {} });
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
  test('המפצל answerTaskQuestion: לפי entity_type; שאלה שאינה של משימה = closed בלי כתיבה', async () => {
    assert.equal((await answerTaskQuestion({ sql: answerSql({ entityType: CHECK_ENTITY }), messageId: MSG_ID, answer: CHECK_DONE, now: SATURDAY_NOON })).status, 'answered');
    assert.equal((await answerTaskQuestion({ sql: answerSql(), messageId: MSG_ID, answer: 'שלישי', now: SATURDAY_NOON })).status, 'answered');
    const none = fakeSql(() => []);
    assert.deepEqual(await answerTaskQuestion({ sql: none, messageId: MSG_ID, answer: CHECK_DONE, now: SATURDAY_NOON }), { status: 'closed', created: {} });
    assert.equal(none.find('WITH closed AS').length, 0);
  });
});

describe('יצירת שאלת "בוצע?"', () => {
  test('מיידית: רק משימה אישית פתוחה, due_at שווה ליעד, ובלי שאלה פתוחה או שאלה מהיום', async () => {
    const sql = fakeSql(() => [{ id: 'q' }]);
    const created = await createImmediateCheck({ sql, taskId: TASK_ID, targetAt: '2026-11-22T15:00:00.000Z', now: new Date('2026-11-22T15:00:01Z') });
    assert.equal(created, true);
    const [call] = sql.calls;
    assert.match(call.text, /WHERE t\.id = \?::uuid AND t\.status = 'open' AND t\.domain = 'personal' AND t\.due_at = \?::timestamptz/);
    assert.match(call.text, /NOT EXISTS \(SELECT 1 FROM messages m WHERE m\.entity_type = 'task_check' AND m\.entity_id = t\.id AND \(\(m\.awaiting_reply = true AND \(m\.expires_at IS NULL OR m\.expires_at > \?::timestamptz\)\) OR m\.sent_at >= \?::timestamptz\)\)/);
    assert.ok(call.values.includes('2026-11-21T22:00:00.000Z'), 'תחילת היום בישראל (22.11)');
    assert.ok(call.values.includes(RELEVANCE_DAYS + 1), 'תפוגה: סוף היום + ימי הרלוונטיות');
  });
  test('מיידית: הגעה כפולה = false (אין שורה)', async () => {
    assert.equal(await createImmediateCheck({ sql: fakeSql(() => []), taskId: TASK_ID, targetAt: '2026-11-22T15:00:00.000Z', now: SATURDAY_NOON }), false);
  });
  test('סגירה: אישיות ושיעורי בית, due_at עד רגע הסגירה ולא לפני RELEVANCE_DAYS ימים, בלי שאלה מהיום', async () => {
    const sql = fakeSql(() => [{ id: 'q1' }, { id: 'q2' }]);
    const count = await ensureClosingChecks({ sql, dateIso: '2026-11-24', targetAt: '2026-11-24T19:00:00.000Z', now: new Date('2026-11-24T19:00:02Z') });
    assert.equal(count, 2);
    const [call] = sql.calls;
    assert.match(call.text, /t\.domain IN \('personal', 'homework'\)/);
    assert.match(call.text, /t\.due_at <= \?::timestamptz AND t\.due_at >= \?::timestamptz/);
    assert.ok(call.values.includes('2026-11-24T19:00:00.000Z'));
    assert.ok(call.values.includes('2026-11-20T22:00:00.000Z'), 'שלושה ימים אחורה: מתחילת 21.11');
    assert.ok(call.values.includes('2026-11-23T22:00:00.000Z'), 'תחילת היום 24.11 (בלי לשאול שוב באותו יום)');
  });
  test('סגירה: כשל מסד לא נזרק (0)', async () => {
    const sql = fakeSql(() => { throw Object.assign(new Error('db'), { name: 'NeonDbError' }); });
    assert.equal(await ensureClosingChecks({ sql, dateIso: '2026-11-24', targetAt: '2026-11-24T19:00:00.000Z', now: SATURDAY_NOON }), 0);
  });
  test('closeQuestionsForTask: סוגר שאלות פתוחות של המשימה (עד מתי ובוצע)', async () => {
    const sql = fakeSql(() => []);
    await closeQuestionsForTask(sql, TASK_ID);
    assert.match(sql.calls[0].text, /UPDATE messages SET awaiting_reply = false WHERE kind = 'question' AND awaiting_reply = true AND entity_type IN \('task', 'task_check'\) AND entity_id = \?::uuid/);
    assert.ok(!sql.calls[0].text.includes('read_at'), 'לא נספר כ"ענית" בסגירה');
  });
  test('loadTimedTasks: רק משימות עם שעה ברורה', async () => {
    const sql = fakeSql(() => [{ id: 'a', due_at: new Date('2026-11-22T15:00:00Z') }, { id: 'b', due_at: new Date('2026-11-21T22:00:00Z') }]);
    const rows = await loadTimedTasks(sql, SATURDAY_NOON, new Date('2026-11-22T18:00:00Z'));
    assert.deepEqual(rows, [{ id: 'a', dueAt: '2026-11-22T15:00:00.000Z' }]);
    assert.match(sql.calls[0].text, /status = 'open' AND domain = 'personal' AND due_at > \?::timestamptz AND due_at <= \?::timestamptz/);
  });
});

describe('הודעת תור taskcheck', () => {
  test('planTaskCheck: מפתח עם שניות היעד ומזהה המשימה; parseSlotMessage מקבל אותו', () => {
    const plan = planTaskCheck({ taskId: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z' }, SATURDAY_NOON);
    assert.equal(plan.kind, 'taskcheck');
    assert.equal(plan.slotKey, `taskcheck-${Date.parse('2026-11-22T15:00:00Z') / 1000}-${TASK_ID}`);
    assert.equal(plan.delaySeconds, 27 * 3600);
    const parsed = parseSlotMessage({ kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt });
    assert.equal(parsed.ok, true);
    assert.deepEqual(taskCheckFromKey(plan.slotKey), { taskId: TASK_ID, targetAt: '2026-11-22T15:00:00.000Z' });
  });
  test('planTaskCheck: יעד שעבר או רחוק מתקרת התור = null (הסגירה או ה-Cron של היום יכסו)', () => {
    assert.equal(planTaskCheck({ taskId: TASK_ID, dueAt: '2026-11-21T11:00:00.000Z' }, SATURDAY_NOON), null);
    const far = new Date(SATURDAY_NOON.getTime() + (TASKCHECK_MAX_DELAY_SECONDS + 60) * 1000);
    assert.equal(planTaskCheck({ taskId: TASK_ID, dueAt: far.toISOString() }, SATURDAY_NOON), null);
  });
  test('parseSlotMessage: יעד שלא תואם למפתח נדחה', () => {
    const plan = planTaskCheck({ taskId: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z' }, SATURDAY_NOON);
    assert.equal(parseSlotMessage({ kind: 'taskcheck', slotKey: plan.slotKey, targetAt: '2026-11-22T15:01:00.000Z' }).ok, false);
    assert.equal(parseSlotMessage({ kind: 'taskcheck', slotKey: 'taskcheck-123456789-not-a-uuid', targetAt: '1973-11-29T21:33:09.000Z' }).ok, false);
  });
});

describe('כרטיסים ברשימת הממתינים', () => {
  test('"עד מתי?": תיבת כתיבה בלבד, בלי "לא יודע"; "בוצע?": שני כפתורים בלי תיבה', () => {
    const list = pendingFromRows({
      questions: [
        { id: 'q1', body: 'עד מתי? · להתקשר לסבתא', sent_at: new Date('2026-11-21T12:00:00Z'), entity_type: DUE_ENTITY },
        { id: 'q2', body: 'בוצע? · לשלוח מייל', sent_at: new Date('2026-11-21T12:01:00Z'), entity_type: CHECK_ENTITY },
      ],
      facts: [], timetable: null, today: '2026-11-21',
    });
    assert.deepEqual(list, [
      { id: 'q1', kind: 'task_due', at: '2026-11-21T12:00:00.000Z', text: 'עד מתי? · להתקשר לסבתא', buttons: [], allowFreeText: true },
      { id: 'q2', kind: 'task_check', at: '2026-11-21T12:01:00.000Z', text: 'בוצע? · לשלוח מייל', buttons: [CHECK_DONE, CHECK_NOT_YET], allowFreeText: false },
    ]);
    assert.deepEqual(checkButtons(), [CHECK_DONE, CHECK_NOT_YET]);
  });
  test('קבועים', () => {
    assert.equal(DUE_QUESTION, 'עד מתי?');
    assert.equal(CHECK_QUESTION, 'בוצע?');
    assert.equal(TASK_DOMAIN, 'personal');
  });
});

// ---------------------------------------------------------------------------
// חיבור: הצינור, api/intake.js, api/chat.js, התור וה-Cron
// ---------------------------------------------------------------------------
const typed = (text) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: 'h', received_at: SATURDAY_NOON });
const pipelineSql = () => fakeSql((text) => (text.startsWith('WITH claim AS') && text.includes('INSERT INTO tasks') ? [{ claimed: 1, task_id: TASK_ID }] : []));

describe('הצינור: משימה מוקלדת בלי מוח (נפילה לקוד)', () => {
  test('"להכין מצגת בהיסטוריה עד שלישי": שורת tasks ובועת "נרשם"', async () => {
    const sql = pipelineSql();
    const out = await processSource({ sql, source: typed('להכין מצגת בהיסטוריה עד שלישי'), timetable: null });
    assert.equal(out.status, 'recorded');
    assert.equal(out.reply, 'נרשם · משימה · להכין מצגת בהיסטוריה · עד שלישי 24.11');
    assert.equal(sql.find('INSERT INTO tasks').length, 1);
    assert.equal(sql.find('FROM timetable_slots').length, 0, 'בלי מערכת שעות');
  });
  test('בלי תאריך ("להביא חוברת"): שאלת "עד מתי?"', async () => {
    const out = await processSource({ sql: pipelineSql(), source: typed('להביא חוברת'), timetable: null });
    assert.equal(out.reply, 'עד מתי? · להביא חוברת');
  });
  test('"להתקשר לסבתא": המוח קובע משימה ונשאל "עד מתי?". בלי מוח: "התקבל", כי "להתקשר" אינו בטבלת פעלי המשימה (03-intake-rules.md:133)', async () => {
    const brain = async () => ({ ok: true, model: 'm', understanding: { kind: 'task', subject: null, topic: 'להתקשר לסבתא', date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: ['date'] } });
    const withBrain = await processSource({ sql: pipelineSql(), source: typed('להתקשר לסבתא'), timetable: null, understand: brain });
    assert.equal(withBrain.reply, 'עד מתי? · להתקשר לסבתא');
    const codeOnly = await processSource({ sql: pipelineSql(), source: typed('להתקשר לסבתא'), timetable: null });
    assert.equal(codeOnly.reply, 'התקבל');
  });
  test('"להתקשר לסבתא?" אינה משימה: "התקבל", בלי שורת tasks', async () => {
    const sql = pipelineSql();
    const out = await processSource({ sql, source: typed('להתקשר לסבתא?'), timetable: null });
    assert.deepEqual(out, { status: 'unclassified', reply: 'התקבל' });
    assert.equal(sql.find('INSERT INTO tasks').length, 0);
  });
  test('המוח לא זמין (no-pool): אותה משימה כמו בלי מוח', async () => {
    const out = await processSource({ sql: pipelineSql(), source: typed('להכין מצגת בהיסטוריה עד שלישי'), timetable: null, understand: async () => ({ ok: false, reason: 'no-pool' }) });
    assert.equal(out.status, 'recorded');
    assert.equal(out.brain, 'no-pool');
  });
});

const INTAKE_H = { 'x-intake-secret': FAKE_SECRET };
const queueFake = () => { const fn = async (...args) => { fn.calls.push(args); }; fn.calls = []; return fn; };
const intakeDeps = { secret: FAKE_SECRET, now: () => SATURDAY_NOON, understand: async () => ({ ok: false, reason: 'no-key' }), eventSync: async () => ({}), googleDay: undefined };
const intakeDb = () => fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SATURDAY_NOON }] : []));

describe('api/intake.js: תזמון "בוצע?" כשיש שעה ברורה', () => {
  const run = async (task) => {
    const sendQueue = queueFake();
    const processor = async () => ({ status: 'recorded', reply: 'נרשם', task });
    await intakeHandle(formRequest({ text: 'x', channel: 'app' }, { headers: INTAKE_H }), { ...intakeDeps, sql: intakeDb(), processor, sendQueue });
    return sendQueue.calls;
  };
  test('שעה ברורה: הודעת taskcheck אחת עם המפתח כ-idempotencyKey', async () => {
    const calls = await run({ id: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z', timed: true });
    assert.equal(calls.length, 1);
    const [topic, message, options] = calls[0];
    assert.equal(topic, 'daily-slots');
    assert.equal(message.kind, 'taskcheck');
    assert.equal(options.idempotencyKey, message.slotKey);
  });
  test('בלי שעה או בלי תאריך: אין תזמון', async () => {
    assert.equal((await run({ id: TASK_ID, dueAt: '2026-11-23T22:00:00.000Z', timed: false })).length, 0);
    assert.equal((await run({ id: TASK_ID, dueAt: null, timed: false })).length, 0);
  });
  test('כשל בתור לא משנה את התשובה', async (t) => {
    captureConsole(t);
    const processor = async () => ({ status: 'recorded', reply: 'נרשם', task: { id: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z', timed: true } });
    const sendQueue = async () => { throw Object.assign(new Error('q'), { name: 'QueueError' }); };
    const res = await intakeHandle(formRequest({ text: 'x', channel: 'app' }, { headers: INTAKE_H }), { ...intakeDeps, sql: intakeDb(), processor, sendQueue });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם');
  });
});

describe('api/chat.js: תשובות על כרטיסי משימה', () => {
  const chatSql = ({ entityType, title = 'לשלוח מייל' }) => fakeSql((text) => {
    if (text.includes('JOIN tasks t ON t.id = m.entity_id')) return [{ id: MSG_ID, awaiting_reply: true, entity_type: entityType, task_id: TASK_ID, title, status: 'open' }];
    if (text.startsWith('SELECT id, kind, awaiting_reply, entity_type')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: entityType, entity_id: TASK_ID, attempt: 1 }];
    if (text.startsWith('WITH closed AS') && text.includes('INSERT INTO sources')) return [{ closed: 1, answer_source_id: 'a', bubble_id: 'b' }];
    if (text.startsWith("UPDATE tasks SET status = 'done'")) return [{ id: TASK_ID }];
    return [];
  });
  const post = (sql, body, deps = {}) => chatHandle(jsonRequest(body, { headers: { 'x-intake-secret': FAKE_SECRET } }), { sql, secret: FAKE_SECRET, timetable: null, now: () => SATURDAY_NOON, eventSync: async () => ({}), googleDay: undefined, ...deps });

  test('"בוצע" על "בוצע?": answered, והמשימה done בפקודת התשובה', async () => {
    const sql = chatSql({ entityType: CHECK_ENTITY });
    const res = await post(sql, { action: 'answer', message_id: MSG_ID, answer: CHECK_DONE });
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sql.find("UPDATE tasks SET status = 'done', done_at = now() WHERE id IN (SELECT entity_id FROM closed)").length, 1);
  });
  test('"עד מתי?" עם שעה: answered ותזמון taskcheck', async () => {
    const sendQueue = queueFake();
    const res = await post(chatSql({ entityType: DUE_ENTITY }), { action: 'answer', message_id: MSG_ID, answer: 'מחר ב-17:00' }, { sendQueue });
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sendQueue.calls.length, 1);
    assert.equal(sendQueue.calls[0][1].kind, 'taskcheck');
  });
  test('"עד מתי?" שלא מתפענח: unclear ובלי כתיבה', async () => {
    const sql = chatSql({ entityType: DUE_ENTITY });
    const res = await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'מתישהו' });
    assert.equal((await res.json()).status, 'unclear');
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
  test('task_done סוגר גם את השאלות הפתוחות על המשימה', async () => {
    const sql = chatSql({ entityType: CHECK_ENTITY });
    const res = await post(sql, { action: 'task_done', task_id: TASK_ID });
    assert.equal((await res.json()).status, 'done');
    assert.equal(sql.find("entity_type IN ('task', 'task_check') AND entity_id = ?::uuid").length, 1);
  });
});

describe('התור: taskcheck והסגירה', () => {
  const plan = planTaskCheck({ taskId: TASK_ID, dueAt: '2026-11-22T15:00:00.000Z' }, SATURDAY_NOON);
  const message = { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt };
  const deliver = (sql, pushHandle) => handleDelivery(message, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-22T15:00:01Z'), pushHandle, secret: FAKE_CRON });
  const pushFake = () => { const fn = async (request) => { fn.bodies.push(JSON.parse(await request.text())); return new Response('ok', { status: 200 }); }; fn.bodies = []; return fn; };

  test('נוצרה שאלה: התראה כללית אחת ("שאלה אחת ממתינה"), בלי כותרת', async () => {
    const push = pushFake();
    const sql = fakeSql((text) => {
      if (text.includes("'task_check', t.id, 1 FROM tasks t WHERE t.id")) return [{ id: 'q' }];
      if (text.includes('has_unseen')) return [{ pending: 1, unread: 0, open_tasks: 1, has_unseen: true }];
      return [];
    });
    const out = await deliver(sql, push);
    assert.equal(out.created, true);
    assert.equal(out.sent, true);
    assert.equal(push.bodies.length, 1);
    assert.equal(push.bodies[0].body, 'שאלה אחת ממתינה');
  });
  test('לא נוצרה (המשימה בוצעה, המועד השתנה, או כבר נשאלה היום): בלי התראה', async () => {
    const push = pushFake();
    const out = await deliver(fakeSql(() => []), push);
    assert.equal(out.created, false);
    assert.equal(push.bodies.length, 0);
  });
  test('הסגירה יוצרת "בוצע?" לפני טעינת השאלות', async () => {
    const sql = fakeSql(() => []);
    await handleDelivery({ kind: 'close', slotKey: 'close-2026-11-24', targetAt: '2026-11-24T19:00:00.000Z' }, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-24T19:00:01Z'), timetable: null, pushHandle: async () => new Response('ok'), secret: FAKE_CRON, googleConfig: null, loadTrainings: async () => [] });
    const checkAt = sql.calls.findIndex((c) => c.text.includes("t.domain IN ('personal', 'homework')"));
    const pendingAt = sql.calls.findIndex((c) => c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(checkAt >= 0 && pendingAt > checkAt, 'השאלות נוצרות לפני הטעינה');
  });
});

describe('cron-plan: תזמון "בוצע?" יומי', () => {
  const CRON_H = { authorization: `Bearer ${FAKE_CRON}` };
  test('משימה עם שעה ב-30 השעות הקרובות: הודעת taskcheck; מספרים בלבד ב-probe_log', async () => {
    const send = queueFake();
    const rows = [{ id: TASK_ID, due_at: new Date('2026-11-22T15:00:00Z') }, { id: '44444444-4444-4444-8444-444444444444', due_at: new Date('2026-11-21T22:00:00Z') }];
    const sql = fakeSql((text) => (text.includes("domain = 'personal' AND due_at >") ? rows : []));
    const res = await cronHandle(req('https://x.test/api/cron-plan?slot=1', { headers: CRON_H }), { sql, secret: FAKE_CRON, now: () => new Date('2026-11-22T01:10:00Z'), send, timetable: { slots: [] }, brainRetry: async () => ({ tried: 0 }) });
    assert.equal(res.status, 200);
    const checks = send.calls.filter((c) => c[1].kind === 'taskcheck');
    assert.equal(checks.length, 1, 'רק המשימה עם שעה ברורה');
    assert.equal(checks[0][2].idempotencyKey, `taskcheck-${Date.parse('2026-11-22T15:00:00Z') / 1000}-${TASK_ID}`);
    assert.match(sql.find('INSERT INTO probe_log')[0].values[1], /; taskcheck_queued=1/);
  });
  test('כשל בטעינה: 500 ו-taskcheck_failed=load', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => { if (text.includes("domain = 'personal' AND due_at >")) throw Object.assign(new Error('db'), { name: 'NeonDbError' }); return []; });
    const res = await cronHandle(req('https://x.test/api/cron-plan?slot=2', { headers: CRON_H }), { sql, secret: FAKE_CRON, now: () => new Date('2026-11-22T14:10:00Z'), send: queueFake(), brainRetry: async () => ({ tried: 0 }) });
    assert.equal(res.status, 500);
    assert.match(sql.find('INSERT INTO probe_log')[0].values[1], /taskcheck_failed=load/);
  });
});
