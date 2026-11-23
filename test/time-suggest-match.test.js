// אירועי הצעת שעה למשימה אישית (match_key 'source:task:<id>', lib/time-suggest.js) לא נכנסים למאגר ההתאמה של lib/event-match.js:
// הודעה לא קשורה לא יכולה לעדכן אותם (בלוק 7, ממצא הבודק).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { loadEventPool, loadReplyEvent } from '../lib/event-match.js';
import { cancelTaskEvent, taskKey } from '../lib/time-suggest.js';
import { answerTaskCheck } from '../lib/personal-task.js';
import { handle as chatHandle } from '../api/chat.js';
import { jsonRequest, FAKE_SECRET, captureConsole } from './helpers.js';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-23T07:00:00.000Z');

test('cancelTaskEvent: רק אירוע מתוכנן בעתיד של משימה שנסגרה; מחזיר את המפתח לסנכרון', async () => {
  const sql = fakeSql(() => [{ match_key: taskKey(TASK_ID) }]);
  assert.deepEqual(await cancelTaskEvent({ sql, taskId: TASK_ID }), { keys: [taskKey(TASK_ID)] });
  const { text, values } = sql.calls[0];
  assert.match(text, /UPDATE events SET status = 'cancelled'/);
  assert.match(text, /status = 'planned' AND starts_at > now\(\)/);
  assert.match(text, /t\.status IN \('done', 'cancelled'\)/);
  assert.ok(values.includes(taskKey(TASK_ID)));
  assert.deepEqual(await cancelTaskEvent({ sql: fakeSql(() => []), taskId: TASK_ID }), { keys: [] });
  assert.deepEqual(await cancelTaskEvent({ sql, taskId: 'x' }), { keys: [] });
});

test('cancelTaskEvent: כשל מסד לא נזרק, שם השגיאה בלבד בלוג', async (t) => {
  const log = captureConsole(t);
  const sql = fakeSql(() => { throw Object.assign(new Error('secret'), { name: 'NeonDbError' }); });
  assert.deepEqual(await cancelTaskEvent({ sql, taskId: TASK_ID }), { keys: [] });
  assert.ok(log.text().includes('NeonDbError') && !log.text().includes('secret'));
});

test('answerTaskCheck "בוצע": האירוע העתידי מבוטל ו-keys מוחזרים; "עוד לא": בלי ביטול', async () => {
  const mk = () => fakeSql((text) => {
    if (text.includes('time-suggest-cancel')) return [{ match_key: taskKey(TASK_ID) }];
    if (text.includes('INSERT INTO sources')) return [{ closed: 1, answer_source_id: 'a', bubble_id: 'b' }];
    return [];
  });
  const ask = { id: MSG_ID, awaiting_reply: true, entity_type: 'task_check', task_id: TASK_ID, title: 'משימה', status: 'open' };
  const done = mk();
  const out = await answerTaskCheck({ sql: done, messageId: MSG_ID, answer: 'בוצע', now: NOW, ask });
  assert.deepEqual(out.keys, [taskKey(TASK_ID)]);
  const notYet = mk();
  const out2 = await answerTaskCheck({ sql: notYet, messageId: MSG_ID, answer: 'עוד לא', now: NOW, ask });
  assert.equal(out2.keys, undefined);
  assert.equal(notYet.find('time-suggest-cancel').length, 0);
});

test('api/chat.js task_done: האירוע מבוטל ונשלח לסנכרון ליומן; בלי אירוע, אין סנכרון', async () => {
  const run = async (hasEvent) => {
    const synced = [];
    const sql = fakeSql((text) => {
      if (text.startsWith("UPDATE tasks SET status = 'done'")) return [{ id: TASK_ID }];
      if (text.includes('time-suggest-cancel')) return hasEvent ? [{ match_key: taskKey(TASK_ID) }] : [];
      return [];
    });
    const res = await chatHandle(jsonRequest({ action: 'task_done', task_id: TASK_ID }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: undefined, keysSync: async (args) => { synced.push(args); return {}; },
    });
    assert.equal((await res.json()).status, 'done');
    return synced;
  };
  assert.deepEqual((await run(true)).map((s) => [s.keys, s.patchKeys]), [[[taskKey(TASK_ID)], []]]);
  assert.deepEqual(await run(false), []);
});

test('שתי שאילתות המועמדים (המאגר, והאירוע של ההודעה שהגיבו עליה) מוציאות source:task:', async () => {
  const sql = fakeSql(() => []);
  await loadEventPool(sql, new Date('2026-11-23T07:00:00.000Z'));
  await loadReplyEvent(sql, { role: 'user', id: '11111111-1111-4111-8111-111111111111' });
  assert.equal(sql.calls.length, 2);
  for (const call of sql.calls) assert.match(call.text, /match_key NOT LIKE 'source:task:%'/);
});
