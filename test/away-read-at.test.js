// problem-log 24.11 (כרטיס "בזמן החופשה"): כרטיס שהמערכת מחליפה או סוגרת מסומן נקרא ואינו ממתין.
// כרטיס away הוא kind='question', ולכן המספר על האייקון סופר אותו רק דרך awaiting_reply (api/chat.js loadBadge); unread סופר רק kind='update'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const away = readFileSync(new URL('../lib/away.js', import.meta.url), 'utf8');
const chat = readFileSync(new URL('../api/chat.js', import.meta.url), 'utf8');

test('כל UPDATE על messages ב-lib/away.js מוריד awaiting_reply ומסמן read_at יחד', () => {
  const updates = away.match(/UPDATE messages SET[^\n]*/g) ?? [];
  assert.equal(updates.length, 3); // סגירה בתשובה, כרטיסים אחרים של האירוע, כרטיס שהוחלף ביצירה
  for (const u of updates) {
    assert.match(u, /awaiting_reply = false/);
    assert.match(u, /read_at = now\(\)/);
  }
});

test('המספר על האייקון: שאלה סגורה לא נספרת, ו-unread לא סופר שאלות', () => {
  assert.match(chat, /kind = 'question' AND awaiting_reply = true AND \(expires_at IS NULL/);
  assert.match(chat, /direction = 'out' AND kind = 'update' AND read_at IS NULL/);
});
