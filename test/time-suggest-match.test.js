// אירועי הצעת שעה למשימה אישית (match_key 'source:task:<id>', lib/time-suggest.js) לא נכנסים למאגר ההתאמה של lib/event-match.js:
// הודעה לא קשורה לא יכולה לעדכן אותם (בלוק 7, ממצא הבודק).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { loadEventPool, loadReplyEvent } from '../lib/event-match.js';

test('שתי שאילתות המועמדים (המאגר, והאירוע של ההודעה שהגיבו עליה) מוציאות source:task:', async () => {
  const sql = fakeSql(() => []);
  await loadEventPool(sql, new Date('2026-11-23T07:00:00.000Z'));
  await loadReplyEvent(sql, { role: 'user', id: '11111111-1111-4111-8111-111111111111' });
  assert.equal(sql.calls.length, 2);
  for (const call of sql.calls) assert.match(call.text, /match_key NOT LIKE 'source:task:%'/);
});
