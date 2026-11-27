// בדיקות ל-God Mode מיד אחרי שינוי ולסקירה הדו-שבועית (אפיון-מורחב ה-14: "רץ כשקורה משהו חריג... ובנוסף סקירה יזומה פעם בשבועיים").
// lib/god-mode-trigger.js, והחיבורים ב-lib/intake-process.js, api/intake.js, api/chat.js ו-api/queues/deliver.js. בלי רשת ובלי מסד. הטקסטים מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, captureConsole, formRequest, jsonRequest, FAKE_SECRET } from './helpers.js';
import { busyWeeks, runGodMode, HORIZON_DAYS } from '../lib/god-mode.js';
import { godModeAfterChange, godModeBiweekly, BIWEEKLY_HORIZON_DAYS } from '../lib/god-mode-trigger.js';
import { processSource, answerQuestion } from '../lib/intake-process.js';
import { handle as intakeHandle } from '../api/intake.js';
import { handle as chatHandle } from '../api/chat.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { retryPendingSources } from '../lib/intake-brain-retry.js';

const NOW = new Date('2026-11-23T08:00:00Z'); // שני 23.11, 10:00 בישראל
const TODAY = '2026-11-23';
// שבוע 29.11: שני מבחנים בלוח. שבוע 20.12: שלושה מבחנים (מחוץ ל-14 יום, בתוך 28).
const BOARD = [
  { date: '2026-11-26', type: 'מבחן', subject: 'מתמטיקה' },
  { date: '2026-12-01', type: 'מבחן', subject: 'מדעים' },
  { date: '2026-12-03', type: 'מבחן', subject: 'ספרות' },
  { date: '2026-12-10', type: 'מבחן', subject: 'אנגלית' },
  { date: '2026-12-21', type: 'מבחן', subject: 'היסטוריה' },
  { date: '2026-12-22', type: 'מבדק', subject: 'ערבית' },
  { date: '2026-12-23', type: 'מבחן', subject: 'גאוגרפיה' },
];
const isChanges = (text) => text.includes("m.value LIKE 'exam:%'");
const changeRow = (link, newDate) => ({ link, type: 'move', new_date: newDate });
const db = (changes = [], { shown = [] } = {}) => fakeSql((text) => {
  if (isChanges(text)) return changes;
  if (text.includes('god-mode-shown')) return shown.map((value) => ({ value }));
  if (text.includes('god-mode-create')) return [{ message_id: 'm1' }];
  return [];
});
const createdKeys = (sql) => sql.find('god-mode-create').map((call) => call.values.find((v) => typeof v === 'string' && /^(moved|busy-week):/.test(v)));

describe('god-mode: טווח וסינון "רק מה שהשינוי יצר"', () => {
  test('busyWeeks: ברירת המחדל 14 יום; טווח רחב מוצא שבוע רחוק יותר', () => {
    assert.equal(HORIZON_DAYS, 14);
    assert.deepEqual(busyWeeks({ todayIso: TODAY, exams: BOARD }).map((f) => f.key), []);
    assert.deepEqual(busyWeeks({ todayIso: TODAY, exams: BOARD, horizonDays: 28 }).map((f) => f.key), ['busy-week:2026-12-20:3']);
  });
  test('runGodMode onlyChanged: שבוע עמוס בלי מבחן שזז לא מקבל כרטיס', async () => {
    const dense = [...BOARD, { date: '2026-12-02', type: 'מבחן', subject: 'תנ"ך' }];
    const sql = db();
    assert.deepEqual(await runGodMode({ sql, todayIso: TODAY, exams: dense, examsRaw: dense, onlyChanged: true }), { created: [] });
    assert.equal(sql.calls.length, 0, 'בלי ממצא: בלי שאילתה');
  });
  test('runGodMode onlyChanged: שבוע עמוס שמבחן זז אליו מקבל כרטיס', async () => {
    const exams = [...BOARD.filter((e) => e.subject !== 'אנגלית'), { date: '2026-12-02', type: 'מבחן', subject: 'אנגלית', answerDate: '2026-12-10' }];
    const sql = db();
    const out = await runGodMode({ sql, todayIso: TODAY, exams, examsRaw: BOARD, onlyChanged: true });
    assert.deepEqual(out, { created: ['busy-week:2026-11-29:3'] });
  });
});

describe('godModeAfterChange: מיד אחרי שינוי במבחן', () => {
  test('מבחן שהוקדם לשבוע שנהיה עמוס: שני כרטיסים מיד, עם אותם מפתחות כמו בבריף, ובלי מוח', async () => {
    const sql = db([changeRow('exam:2026-12-10:אנגלית', '2026-12-02')]);
    const out = await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD });
    assert.deepEqual(out.created.sort(), ['busy-week:2026-11-29:3', 'moved:exam:2026-12-10:אנגלית:2026-12-02']);
    assert.equal(sql.find('god-mode-create').length, 2);
    const body = sql.find('god-mode-create')[0].values.find((v) => typeof v === 'string' && v.startsWith('סקירה'));
    assert.match(body, /לא שיניתי כלום ביומן\.$/);
    assert.match(body, /\n· להשאיר כמו שזה\nלא שיניתי/, 'בלי שורת מוח: "להשאיר" היא האפשרות האחרונה');
  });
  test('הזזה מאוחרת יותר לשבוע שנהיה עמוס: רק כרטיס השבוע', async () => {
    const sql = db([changeRow('exam:2026-11-26:מתמטיקה', '2026-12-02')]);
    const out = await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD });
    assert.deepEqual(out.created, ['busy-week:2026-11-29:3']);
  });
  test('כבר הוצג (למשל בבריף): אין כרטיס שני', async () => {
    const sql = db([changeRow('exam:2026-12-10:אנגלית', '2026-12-02')], { shown: ['busy-week:2026-11-29:3', 'moved:exam:2026-12-10:אנגלית:2026-12-02'] });
    assert.deepEqual(await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD }), { created: [] });
    assert.equal(sql.find('god-mode-create').length, 0);
  });
  test('שינוי שלא יוצר ממצא (דחייה לשבוע רגיל): בלי כרטיס', async () => {
    const sql = db([changeRow('exam:2026-12-03:ספרות', '2026-12-09')]);
    assert.deepEqual(await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD }), { created: [] });
  });
  test('כשל בטעינת השינויים: בלי כרטיס (לא לוח חלקי), בלי זריקה', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql((text) => {
      if (isChanges(text)) throw Object.assign(new Error('db'), { name: 'DbError' });
      return [];
    });
    assert.deepEqual(await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD }), { created: [] });
    assert.equal(sql.find('god-mode-create').length, 0);
    assert.match(log.text(), /DbError/);
  });
  test('כשל בכתיבת הכרטיס: בלי זריקה', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (isChanges(text)) return [changeRow('exam:2026-12-10:אנגלית', '2026-12-02')];
      if (text.includes('god-mode-create')) throw new Error('db');
      return [];
    });
    assert.deepEqual(await godModeAfterChange({ sql, now: NOW, examsRaw: BOARD }), { created: [] });
  });
  test('"היום" לפי שעון ישראל: 23:30 UTC של ה-22 הוא כבר ה-23, והקדמה ל-23 אינה ממצא', async () => {
    const sql = db([changeRow('exam:2026-11-26:מתמטיקה', '2026-11-23')]);
    const out = await godModeAfterChange({ sql, now: new Date('2026-11-22T23:30:00Z'), examsRaw: BOARD });
    assert.deepEqual(out, { created: [] });
  });
});

describe('godModeBiweekly: סקירה יזומה פעם בשבועיים', () => {
  test('טווח רחב (28 יום): שבוע עמוס רחוק מקבל כרטיס, גם בלי שינוי; המוח באותו שער (BRAIN_PILOT=off)', async () => {
    assert.equal(BIWEEKLY_HORIZON_DAYS, 28);
    const sql = db();
    const asked = [];
    const ask = async (args) => { asked.push(args); return { ok: true, data: { extra_option: null } }; };
    const out = await godModeBiweekly({ sql, todayIso: '2026-11-28', now: NOW, ask, examsRaw: BOARD });
    assert.deepEqual(out, { created: ['busy-week:2026-12-20:3'] });
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].env, { BRAIN_PILOT: 'off' });
  });
  test('אין ממצא: אין כרטיס', async () => {
    const sql = db();
    const out = await godModeBiweekly({ sql, todayIso: '2026-11-28', now: NOW, examsRaw: BOARD.slice(0, 4) });
    assert.deepEqual(out, { created: [] });
    assert.equal(sql.find('god-mode-create').length, 0);
  });
  test('כשל בטעינת השינויים: בלי כרטיס ובלי זריקה', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (isChanges(text)) throw new Error('db');
      return [];
    });
    assert.deepEqual(await godModeBiweekly({ sql, todayIso: '2026-11-28', now: NOW, examsRaw: BOARD }), { created: [] });
  });
});

describe('הסימון exam: הקליטה מודיעה שנגעה במבחן מהלוח', () => {
  const SRC_ID = '33333333-3333-4333-8333-333333333333';
  const MSG_ID = '22222222-2222-4222-8222-222222222222';
  test('processSource: הזזת מבחן מהלוח = exam: true', async () => {
    const source = { id: SRC_ID, channel: 'app', raw_content: 'המבחן בהיסטוריה נדחה ליום ראשון', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') };
    const result = await processSource({ sql: fakeSql(() => []), source, timetable: null });
    assert.equal(result.status, 'recorded');
    assert.equal(result.exam, true);
  });
  test('processSource: הזזה שאינה של מבחן = בלי exam', async () => {
    const source = { id: SRC_ID, channel: 'app', raw_content: 'השיעור בהיסטוריה נדחה ליום ראשון', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') };
    const result = await processSource({ sql: fakeSql(() => []), source, timetable: null });
    assert.equal(Object.hasOwn(result, 'exam'), false);
  });
  const answerSql = (facts) => fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 }];
    if (text.includes('FROM sources WHERE id')) return [{ id: SRC_ID, channel: 'app', raw_content: 'המבחן בהיסטוריה נדחה', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') }];
    if (text.includes('FROM facts WHERE source_id')) return facts;
    if (text.includes('INTO facts')) return [{ closed: 1 }];
    return [];
  });
  const f = (field, value, origin = 'read') => ({ field, value, origin });
  test('answerQuestion: תשובה על הודעה שמקושרת למבחן (המועד החדש) = exam: true', async () => {
    const sql = answerSql([f('type', 'move'), f('subject', 'היסטוריה'), f('date', '2026-10-15', 'inferred'), f('match', 'exam:2026-10-15:היסטוריה', 'inferred')]);
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: '18.10', timetable: null, now: new Date('2026-10-11T09:00:00Z') });
    assert.equal(result.status, 'answered');
    assert.equal(result.exam, true);
  });
  test('answerQuestion: בלי קישור למבחן = בלי exam', async () => {
    const sql = answerSql([f('type', 'move'), f('subject', 'היסטוריה'), f('date', '2026-10-15', 'inferred')]);
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: '18.10', timetable: null, now: new Date('2026-10-11T09:00:00Z') });
    assert.equal(result.status, 'answered');
    assert.equal(Object.hasOwn(result, 'exam'), false);
  });
});

describe('api/intake.js: God Mode מיד אחרי הכתיבה', () => {
  const SRC = '44444444-4444-4444-8444-444444444444';
  const intakeSql = () => fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC, received_at: NOW }] : []));
  const run = async ({ result, godMode, channel = 'shortcut', sendQueue = async () => {} }) => intakeHandle(
    formRequest({ text: 'המבחן באנגלית הוקדם', ...(channel === 'app' ? { channel } : {}) }, { headers: { 'x-intake-secret': FAKE_SECRET } }),
    { sql: intakeSql(), secret: FAKE_SECRET, processor: async () => result, sendQueue, now: () => NOW, eventSync: async () => {}, fitnessSync: async () => {}, godMode },
  );
  test('נרשם עם exam: רץ פעם אחת, לפני השליחה לתור ההתראה (הכרטיס נכלל בהתראה המאוגדת)', async () => {
    const order = [];
    const godMode = async (args) => { order.push(['god', args.now.toISOString()]); return { created: ['k'] }; };
    const sendQueue = async () => { order.push(['queue']); };
    const res = await run({ result: { status: 'recorded', reply: 'נרשם · הזזה', exam: true }, godMode, sendQueue });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם · הזזה');
    assert.deepEqual(order, [['god', NOW.toISOString()], ['queue']]);
  });
  test('נרשם בלי exam, או לא נרשם: לא רץ', async () => {
    let calls = 0;
    const godMode = async () => { calls += 1; return { created: [] }; };
    await run({ result: { status: 'recorded', reply: 'נרשם' }, godMode });
    await run({ result: { status: 'unclassified', reply: 'התקבל', exam: true }, godMode });
    assert.equal(calls, 0);
  });
  test('כשל ב-God Mode לא משנה את התשובה', async (t) => {
    captureConsole(t);
    const godMode = async () => { throw new Error('boom'); };
    const res = await run({ result: { status: 'recorded', reply: 'נרשם · הזזה', exam: true }, godMode, channel: 'app' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נרשם · הזזה');
  });
});

describe('api/chat.js: God Mode אחרי תשובה שמשנה מבחן', () => {
  const SRC_ID = '33333333-3333-4333-8333-333333333333';
  const MSG_ID = '22222222-2222-4222-8222-222222222222';
  const H = { headers: { 'x-intake-secret': FAKE_SECRET } };
  test('תשובה למועד החדש של מבחן מקושר: רץ פעם אחת', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 }];
      if (text.includes('FROM sources WHERE id')) return [{ id: SRC_ID, channel: 'app', raw_content: 'המבחן בהיסטוריה נדחה', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') }];
      if (text.includes('FROM facts WHERE source_id')) return [{ field: 'type', value: 'move', origin: 'read' }, { field: 'subject', value: 'היסטוריה', origin: 'read' }, { field: 'match', value: 'exam:2026-10-15:היסטוריה', origin: 'inferred' }];
      if (text.includes('INTO facts')) return [{ closed: 1 }];
      return [];
    });
    const calls = [];
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: '18.10' }, H), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => new Date('2026-10-11T09:00:00Z'), eventSync: async () => {}, googleDay: undefined,
      godMode: async (args) => { calls.push(args); return { created: [] }; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sql, sql);
  });
  test('תשובה על הודעה שאינה מבחן: לא רץ', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 }];
      if (text.includes('FROM sources WHERE id')) return [{ id: SRC_ID, channel: 'app', raw_content: 'מחר מבחן', content_hash: 'h', received_at: new Date('2026-10-11T08:00:00Z') }];
      if (text.includes('FROM facts WHERE source_id')) return [{ field: 'type', value: 'exam', origin: 'read' }];
      if (text.includes('INTO facts')) return [{ closed: 1 }];
      return [];
    });
    let calls = 0;
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'מתמטיקה' }, H), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => new Date('2026-10-11T09:00:00Z'), eventSync: async () => {}, googleDay: undefined,
      godMode: async () => { calls += 1; return { created: [] }; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
  });
  test('כרטיס "בזמן החופשה" שנענה (מבחנים עשויים לעבור למועד ב\'): רץ; כשל בו לא מפיל את התשובה', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes('away-ask')) return [{ id: MSG_ID, awaiting_reply: true, sent_at: '2026-11-20T08:00:00Z', facts: { title: 'טיול' } }];
      if (text.includes('away-write')) return [{ closed: 1, answer_source_id: 'a', bubble_id: 'b', keys: [] }];
      return [];
    });
    let calls = 0;
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'לא' }, H), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => NOW, eventSync: async () => {}, googleDay: undefined,
      godMode: async () => { calls += 1; throw new Error('boom'); },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 1);
  });
});

describe('api/queues/deliver.js: הבריף השבועי בשבת הדו-שבועית', () => {
  const weeklyMessage = (saturday) => ({ kind: 'weekly', slotKey: `weekly-${saturday}`, targetAt: `${saturday}T18:00:00.000Z` });
  test('שבת דו-שבועית (28.11): God Mode עם טווח 28 יום רץ לפני הבריף', async () => {
    const calls = [];
    const sql = fakeSql(() => []);
    await handleDelivery(weeklyMessage('2026-11-28'), { deliveryCount: 1 }, {
      sql, now: () => new Date('2026-11-28T18:00:01Z'), timetable: null, pushHandle: async () => new Response('{}', { status: 200 }), secret: 'x',
      ask: async () => ({ ok: false }), godModeBiweekly: async (args) => { calls.push(args); return { created: [] }; },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].todayIso, '2026-11-28');
    assert.equal(typeof calls[0].ask, 'function');
  });
  test('שבת שאינה דו-שבועית (5.12): לא רץ', async () => {
    let calls = 0;
    await handleDelivery(weeklyMessage('2026-12-05'), { deliveryCount: 1 }, {
      sql: fakeSql(() => []), now: () => new Date('2026-12-05T18:00:01Z'), timetable: null, pushHandle: async () => new Response('{}', { status: 200 }), secret: 'x',
      godModeBiweekly: async () => { calls += 1; return { created: [] }; },
    });
    assert.equal(calls, 0);
  });
});

describe('lib/intake-brain-retry.js: הודעה שחיכתה למוח ונקשרה למבחן', () => {
  test('נרשם עם exam: God Mode רץ; כשל בו לא מפיל את הריצה', async (t) => {
    captureConsole(t);
    const SRC = '55555555-5555-4555-8555-555555555555';
    const sql = fakeSql((text) => (text.includes('FROM sources s') ? [{ id: SRC, channel: 'shortcut', raw_content: 'x', content_hash: 'h', received_at: NOW }] : []));
    const calls = [];
    const run = (result) => retryPendingSources({
      sql, now: NOW, apiKey: 'k', understand: async () => ({ ok: true }), eventSync: async () => {},
      processor: async () => result,
      godMode: async (args) => { calls.push(args.now); throw new Error('boom'); },
    });
    assert.deepEqual(await run({ status: 'recorded', brain: 'ok', exam: true }), { tried: 1, recorded: 1, understood: 1 });
    assert.deepEqual(calls, [NOW]);
    await run({ status: 'recorded', brain: 'ok' });
    assert.equal(calls.length, 1, 'בלי exam: לא רץ');
  });
});
