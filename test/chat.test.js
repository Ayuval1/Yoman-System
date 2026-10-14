// בדיקות ל-api/chat.js (שלב 8.2א-1): נקודת הצ'אט. בלי רשת ובלי מסד אמיתי: sql מזויף מ-helpers.js. כל המשפטים מומצאים, בלי שמות אנשים.
// "קריטריון N" בשם הבדיקה = קריטריון הקבלה N בטבלת 8.2א-1 של docs/08-chapter8/47-chapter8-step-8-2a-spec.md.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה; קריטריון 12 (EXPLAIN) ו-17 נבדקים מול Neon.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../api/chat.js';
import { UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET } from './helpers.js';

const H = { 'x-intake-secret': FAKE_SECRET };
const URL_CHAT = 'https://x.test/api/chat';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MSG_ID = uuid(1);
const SRC_ID = uuid(2);
const ANSWER_SRC_ID = uuid(3);
const BUBBLE_ID = uuid(4);
const NEXT_Q_ID = uuid(5);
const at = (minute) => new Date(Date.UTC(2026, 9, 11, 15, minute));
const SUNDAY_EVENING = at(0); // ראשון 11.10.2026 18:00 בישראל: "מחר" = שני 12.10
const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = { slots: [slot(2, 2, 'היסטוריה'), slot(2, 3, 'מתמטיקה'), slot(2, 5, 'אנגלית')] };

// מסד מדומה לפי צורת הפקודות של api/chat.js ו-answerQuestion. כל שדה הוא מה שהשאילתה המתאימה מחזירה (או פונקציה שזורקת).
function chatDb({
  items = [], questions = [], pendingFacts = [], badge = { pending: 0, unread: 0 },
  message = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 },
  src = { id: SRC_ID, channel: 'app', raw_content: 'מחר אין שיעור אנגלית', content_hash: null, received_at: SUNDAY_EVENING },
  facts = [], written = [{ closed: 1, answer_source_id: ANSWER_SRC_ID, bubble_id: BUBBLE_ID, question_id: NEXT_Q_ID }],
  created = [], fail = null,
} = {}) {
  return fakeSql((text, values) => {
    if (fail && fail(text)) throw Object.assign(new Error('db down מחר אין שיעור אנגלית'), { name: 'NeonDbError' });
    if (text.includes("SELECT 'user' AS role, 0 AS rank")) return items;
    if (text.startsWith("SELECT 'user' AS role, s.id")) return created;
    if (text.includes('FROM messages m LEFT JOIN sources s')) return questions;
    if (text.includes('FROM facts f WHERE f.source_id IN')) return pendingFacts;
    if (text.includes('AS unread')) return [badge];
    if (text.includes('FROM messages WHERE id')) return message ? [message] : [];
    if (text.includes('FROM sources WHERE id')) return src ? [src] : [];
    if (text.includes('FROM facts WHERE source_id')) return facts;
    if (text.startsWith('WITH closed AS')) return written;
    if (text.startsWith('UPDATE messages SET read_at')) return [];
    if (text.includes('FROM timetable_slots')) return [];
    return [];
  });
}
const get = (sql, headers = H) => handle(req(URL_CHAT, { method: 'GET', headers }), { sql, secret: FAKE_SECRET, timetable: TIMETABLE });
const post = (sql, body, headers = H) => handle(jsonRequest(body, { url: URL_CHAT, headers: { ...headers, 'content-type': 'application/json' } }), { sql, secret: FAKE_SECRET, timetable: TIMETABLE });
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));

describe('chat: שיטות, סוד ובקשות פגומות (קריטריון 1)', () => {
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    test(`קריטריון 1: ${method} נדחה ב-405 לפני הסוד, ובלי מסד`, async () => {
      const sql = chatDb();
      const res = await handle(req(URL_CHAT, { method }), { sql, secret: FAKE_SECRET });
      assert.equal(res.status, 405);
      assert.equal(sql.calls.length, 0);
    });
  }
  test('קריטריון 1: בלי סוד, סוד שגוי, או סוד שמשתנה באות אחת: 401 ושום קריאה למסד', async () => {
    for (const headers of [{}, { 'x-intake-secret': 'wrong' }, { 'x-intake-secret': FAKE_SECRET.slice(0, -1) + 'X' }, { 'x-intake-secret': '' }]) {
      for (const run of [(sql) => get(sql, headers), (sql) => post(sql, { action: 'read', message_ids: [] }, headers)]) {
        const sql = chatDb();
        const res = await run(sql);
        assert.equal(res.status, 401);
        assert.equal(await res.text(), 'Unauthorized');
        assert.equal(sql.calls.length, 0);
      }
    }
  });
  test('קריטריון 1: סוד לא מוגדר בשרת: נכשל סגור (401), גם עם כותרת ריקה', async (t) => {
    const cap = captureConsole(t);
    for (const secret of [undefined, '', null]) {
      const sql = chatDb();
      const res = await handle(req(URL_CHAT, { method: 'GET', headers: { 'x-intake-secret': '' } }), { sql, secret });
      assert.equal(res.status, 401);
      assert.equal(sql.calls.length, 0);
    }
    assert.match(cap.text(), /INTAKE_SECRET/);
  });
  test('קריטריון 1: גוף פגום: 400 "לא נשלח, נסה שוב." ושום קריאה למסד', async () => {
    const bodies = [
      '{לא json', '', 'null', '[]', '"answer"', '{}', JSON.stringify({ action: 'delete' }),
      JSON.stringify({ action: 'answer', message_id: 'x', answer: 'היסטוריה' }),
      JSON.stringify({ action: 'answer', message_id: MSG_ID, answer: '' }),
      JSON.stringify({ action: 'answer', message_id: MSG_ID, answer: 'א'.repeat(1001) }),
      JSON.stringify({ action: 'read', message_ids: Array.from({ length: 101 }, (_, k) => uuid(k)) }),
      JSON.stringify({ action: 'read', message_ids: ['x'] }),
      JSON.stringify({ action: 'answer', message_id: MSG_ID, answer: 'x', pad: 'א'.repeat(20_000) }),
    ];
    for (const body of bodies) {
      const sql = chatDb();
      const res = await post(sql, body);
      assert.equal(res.status, 400, body.slice(0, 60));
      assert.equal(await res.text(), 'לא נשלח, נסה שוב.');
      assert.equal(sql.calls.length, 0, body.slice(0, 60));
    }
  });
  test('הסוד לא נחשף בתשובה', async () => {
    const res = await get(chatDb(), { 'x-intake-secret': 'bad' });
    assert.ok(!(await res.text()).includes(FAKE_SECRET));
  });
});

describe('chat: GET', () => {
  const items = [
    { role: 'system', id: uuid(12), text: 'נרשם · מבחן · היסטוריה · שני 12.10', at: at(2), channel: null, read_at: null },
    { role: 'user', id: uuid(11), text: 'היסטוריה', at: at(2), channel: 'app', read_at: null },
    { role: 'user', id: uuid(10), text: 'מחר יש מבחן', at: at(1), channel: 'shortcut', read_at: null },
  ];
  const questions = [
    { id: uuid(21), body: 'על איזה נושא?', sent_at: at(2), source_id: uuid(30), channel: 'shortcut', raw_content: 'מחר יש מבחן', content_hash: 'h', received_at: SUNDAY_EVENING },
    { id: uuid(20), body: 'מה זה?', sent_at: at(1), source_id: uuid(31), channel: 'app', raw_content: 'מחר אין שיעור אנגלית', content_hash: 'h2', received_at: SUNDAY_EVENING },
  ];
  const pendingFacts = [
    { source_id: uuid(30), field: 'type', value: 'exam', origin: 'read' },
    { source_id: uuid(30), field: 'date', value: '2026-10-12', origin: 'inferred' },
    { source_id: uuid(30), field: 'subject', value: 'היסטוריה', origin: 'read' },
  ];

  test('קריטריונים 2-4: items ישן לחדש (משתמש לפני מערכת באותו רגע), pending הוותיקה קודם עם כפתורים, ו-badge', async () => {
    const sql = chatDb({ items, questions, pendingFacts, badge: { pending: 2, unread: 1 } });
    const res = await get(sql);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(body.items, [
      { id: uuid(10), role: 'user', text: 'מחר יש מבחן', at: at(1).toISOString(), forwarded: true },
      { id: uuid(11), role: 'user', text: 'היסטוריה', at: at(2).toISOString(), forwarded: false },
      { id: uuid(12), role: 'system', text: 'נרשם · מבחן · היסטוריה · שני 12.10', at: at(2).toISOString(), tag: 'recorded', unread: true },
    ]);
    assert.deepEqual(body.pending.map((q) => q.id), [uuid(20), uuid(21)]);
    assert.deepEqual(body.pending[0].buttons, ['שיעורי בית', 'מבחן', 'ביטול', 'חדר', 'הזזה', 'יום מקוצר', UNKNOWN_BUTTON]);
    assert.deepEqual(body.pending[1], { id: uuid(21), text: 'על איזה נושא?', at: at(2).toISOString(), buttons: [UNKNOWN_BUTTON], allowFreeText: true });
    assert.equal(body.badge, 3);
    assert.equal(writesOf(sql).length, 0, 'GET לא כותב');
  });

  test('קריטריון 2: שאילתת הפריטים: הודעות shortcut ו-app ובועות update יוצאות בלבד (שאלות אינן פריטים), 50 אחרונים לפי אותו סדר', async () => {
    const sql = chatDb();
    await get(sql);
    const [call] = sql.calls.filter((c) => c.text.includes("SELECT 'user' AS role, 0 AS rank"));
    assert.ok(call.text.includes("FROM sources s WHERE s.channel IN ('shortcut', 'app')"));
    assert.ok(call.text.includes("FROM messages m WHERE m.direction = 'out' AND m.kind = 'update'"));
    assert.ok(!call.text.includes("'question'"));
    assert.match(call.text, /ORDER BY x\.at DESC NULLS LAST, x\.rank DESC, x\.id DESC LIMIT \?::int$/);
    assert.deepEqual(call.values, [50]);
  });

  test('קריטריון 2: שאילתת השאלות: פתוחות בלבד, הוותיקה קודם, עם המקור שלהן', async () => {
    const sql = chatDb();
    await get(sql);
    const [call] = sql.calls.filter((c) => c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(call.text.includes("WHERE m.kind = 'question' AND m.awaiting_reply = true"));
    assert.match(call.text, /ORDER BY m\.sent_at ASC NULLS LAST, m\.id ASC$/);
    assert.equal(sql.find('FROM facts f').length, 0, 'בלי שאלות פתוחות אין שאילתת עובדות');
  });

  test('קריטריון 12: המספר נספר בשאילתה נפרדת: שאלות פתוחות + בועות update יוצאות עם read_at ריק, לא מתוך 50 הפריטים', async () => {
    const sql = chatDb({ items: [], badge: { pending: 1, unread: 7 } });
    const body = await (await get(sql)).json();
    assert.equal(body.badge, 8, 'אין פריטים בכלל, והמספר עדיין מהספירה');
    const [call] = sql.find('AS unread');
    assert.ok(call.text.includes("(SELECT count(*) FROM messages WHERE kind = 'question' AND awaiting_reply = true)::int AS pending"));
    assert.ok(call.text.includes("(SELECT count(*) FROM messages WHERE direction = 'out' AND kind = 'update' AND read_at IS NULL)::int AS unread"));
  });

  test('קריטריון 14 (קריאה): כשל מסד: 500 "לא נשלח, נסה שוב.", והלוג רק עם שם השגיאה', async (t) => {
    const cap = captureConsole(t);
    const res = await get(chatDb({ fail: (text) => text.includes('AS unread') }));
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'לא נשלח, נסה שוב.');
    assert.deepEqual(cap.lines, ['chat: פעולה נכשלה: NeonDbError']);
  });
});

describe('chat: POST answer', () => {
  const created = [
    { role: 'user', id: ANSWER_SRC_ID, text: 'ביטול', at: at(5), channel: 'app', read_at: null },
    { role: 'system', id: BUBBLE_ID, text: 'נרשם · ביטול · אנגלית · שני 12.10', at: at(5), channel: null, read_at: null },
  ];

  test('קריטריון 5 (תרחיש ג): "ביטול": answered, הפריטים החדשים (התשובה שלך ואז "נרשם"), pending ו-badge; פקודת כתיבה אחת', async () => {
    const nextQuestion = { id: NEXT_Q_ID, body: 'איזה שיעור?', sent_at: at(5), source_id: SRC_ID, channel: 'app', raw_content: 'מחר אין שיעור אנגלית', content_hash: 'h', received_at: SUNDAY_EVENING };
    const sql = chatDb({ created, questions: [nextQuestion], badge: { pending: 1, unread: 1 } });
    const res = await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'ביטול' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(body.items.map((item) => [item.role, item.text]), [['user', 'ביטול'], ['system', 'נרשם · ביטול · אנגלית · שני 12.10']]);
    assert.equal(body.items[0].forwarded, false);
    assert.deepEqual(body.pending.map((q) => q.text), ['איזה שיעור?']);
    assert.equal(body.badge, 2);
    assert.equal(writesOf(sql).length, 1, 'כל הכתיבה בפקודה אחת');
    const [command] = writesOf(sql);
    assert.ok(command.text.startsWith('WITH closed AS'));
    assert.ok(command.values.includes('ביטול'), 'התשובה כפי שנשלחה נכנסת לשורת המקור');
    const [createdQuery] = sql.calls.filter((c) => c.text.startsWith("SELECT 'user' AS role, s.id"));
    assert.deepEqual(createdQuery.values, [ANSWER_SRC_ID, BUBBLE_ID], 'הפריטים נשלפים לפי המזהים שהפקודה החזירה');
  });

  test('קריטריון 5: שליחה כפולה: השאלה כבר סגורה, closed, בלי כתיבה ובלי פריטים', async () => {
    const sql = chatDb({ message: { id: MSG_ID, kind: 'question', awaiting_reply: false, entity_type: 'source', entity_id: SRC_ID, attempt: 1 } });
    const body = await (await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'ביטול' })).json();
    assert.equal(body.status, 'closed');
    assert.deepEqual(body.items, []);
    assert.equal(writesOf(sql).length, 0);
  });

  test('קריטריון 5: שתי לחיצות במקביל: הפקודה של השנייה מחזירה closed = 0, closed, ובלי פריטים', async () => {
    const sql = chatDb({ written: [{ closed: 0, answer_source_id: null, bubble_id: null, question_id: null }] });
    const body = await (await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'ביטול' })).json();
    assert.equal(body.status, 'closed');
    assert.deepEqual(body.items, []);
    assert.equal(sql.calls.filter((c) => c.text.startsWith("SELECT 'user' AS role, s.id")).length, 0);
  });

  test('קריטריון 6: שאלה לא קיימת: closed ושום כתיבה', async () => {
    const sql = chatDb({ message: null });
    const body = await (await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'ביטול' })).json();
    assert.equal(body.status, 'closed');
    assert.equal(writesOf(sql).length, 0);
  });

  test('קריטריון 6: תשובה שאי אפשר לפענח: unclear, בלי כתיבה, בלי פריטים, והשאלה נשארת ב-pending', async () => {
    const stillOpen = { id: MSG_ID, body: 'מה זה?', sent_at: at(1), source_id: SRC_ID, channel: 'app', raw_content: 'מחר אין שיעור אנגלית', content_hash: 'h', received_at: SUNDAY_EVENING };
    const sql = chatDb({ questions: [stillOpen], badge: { pending: 1, unread: 0 } });
    const body = await (await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'זה משהו אחר' })).json();
    assert.deepEqual({ status: body.status, items: body.items, badge: body.badge }, { status: 'unclear', items: [], badge: 1 });
    assert.deepEqual(body.pending.map((q) => q.id), [MSG_ID]);
    assert.equal(writesOf(sql).length, 0);
  });

  test('קריטריון 10: "לא יודע" בשאלת "מה זה?": answered ו"התקבל" בבועה (המזהים מהפקודה)', async () => {
    const receipt = [
      { role: 'user', id: ANSWER_SRC_ID, text: UNKNOWN_BUTTON, at: at(6), channel: 'app', read_at: null },
      { role: 'system', id: BUBBLE_ID, text: 'התקבל', at: at(6), channel: null, read_at: null },
    ];
    const sql = chatDb({ created: receipt, written: [{ closed: 1, answer_source_id: ANSWER_SRC_ID, bubble_id: BUBBLE_ID, question_id: null }] });
    const body = await (await post(sql, { action: 'answer', message_id: MSG_ID, answer: UNKNOWN_BUTTON })).json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(body.items.map((item) => [item.text, item.tag]), [[UNKNOWN_BUTTON, undefined], ['התקבל', 'received']]);
    const [command] = writesOf(sql);
    assert.ok(command.values.includes('התקבל'), 'הבועה בפקודה היא "התקבל"');
  });

  test('קריטריון 14: כשל מסד באמצע הכתיבה: 500, ניסיון כתיבה אחד (פקודה אחת: או הכול או כלום), והלוג בלי טקסט', async (t) => {
    const cap = captureConsole(t);
    const sql = chatDb({ fail: (text) => text.startsWith('WITH closed AS') });
    const res = await post(sql, { action: 'answer', message_id: MSG_ID, answer: 'ביטול' });
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'לא נשלח, נסה שוב.');
    assert.equal(writesOf(sql).length, 1);
    assert.deepEqual(cap.lines, ['chat: פעולה נכשלה: NeonDbError']);
  });
});

describe('chat: POST read', () => {
  test('קריטריון 13: מסמן רק את המזהים שנשלחו, רק בועות update יוצאות שלא נקראו, ומחזיר את המספר', async () => {
    const sql = chatDb({ badge: { pending: 2, unread: 0 } });
    const ids = [uuid(40), uuid(41)];
    const res = await post(sql, { action: 'read', message_ids: ids });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { badge: 2 });
    const [call] = writesOf(sql);
    assert.equal(call.text, "UPDATE messages SET read_at = now() WHERE id IN (SELECT t.id::uuid FROM jsonb_array_elements_text(?::jsonb) AS t(id)) AND direction = 'out' AND kind = 'update' AND read_at IS NULL");
    assert.deepEqual(call.values, [JSON.stringify(ids)], 'המזהים עוברים כ-JSON אחד ולא כמערך JS');
    assert.equal(writesOf(sql).length, 1);
    assert.ok(sql.calls.indexOf(call) < sql.calls.indexOf(sql.find('AS unread')[0]), 'המספר נספר אחרי הסימון');
  });
  test('קריטריון 13: רשימה ריקה: בלי UPDATE, רק המספר', async () => {
    const sql = chatDb({ badge: { pending: 1, unread: 3 } });
    assert.deepEqual(await (await post(sql, { action: 'read', message_ids: [] })).json(), { badge: 4 });
    assert.equal(writesOf(sql).length, 0);
  });
});

describe('chat: בלי מודל, בלי רשת ובלי מחיקה', () => {
  const root = new URL('../', import.meta.url);
  const codeOf = (file) => readFileSync(new URL(file, root), 'utf8').split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  for (const file of ['api/chat.js', 'lib/chat-view.js']) {
    test(`${file}: אין fetch(, anthropic, gemini, openai`, () => {
      assert.doesNotMatch(codeOf(file).replace(/^[ \t]*fetch\(request\) \{$/m, ''), /fetch\(|anthropic|gemini|openai/i);
    });
  }
  test('אין DELETE, DROP, TRUNCATE או ALTER TABLE בקבצים של השלב (מחוץ להערות)', () => {
    for (const file of ['api/chat.js', 'lib/chat-view.js', 'api/intake.js', 'lib/intake-process.js', 'lib/intake-questions.js', 'lib/intake-facts.js']) {
      assert.doesNotMatch(codeOf(file), /\b(DELETE|DROP|TRUNCATE)\b|ALTER\s+TABLE/, file);
    }
  });
  test('הייבואים: רק קבצים מקומיים, node: והדרייבר של Neon', () => {
    for (const file of ['api/chat.js', 'lib/chat-view.js']) {
      for (const match of readFileSync(new URL(file, root), 'utf8').matchAll(/^import .* from '([^']+)';$/gm)) {
        assert.match(match[1], /^(\.\/|\.\.\/|node:|@neondatabase\/serverless$)/, `${file}: ${match[1]}`);
      }
    }
  });
  test("העמודות שנקודת הצ'אט קוראת וכותבת קיימות ב-db/schema.sql", () => {
    const schema = readFileSync(new URL('db/schema.sql', root), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
    const columns = (table) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(schema)[1].split('\n').map((line) => /^\s*(\w+)\s+\w+/.exec(line)?.[1]).filter(Boolean);
    for (const column of ['id', 'direction', 'body', 'kind', 'sent_at', 'awaiting_reply', 'entity_type', 'entity_id', 'read_at']) assert.ok(columns('messages').includes(column), `messages.${column}`);
    for (const column of ['id', 'channel', 'raw_content', 'content_hash', 'received_at']) assert.ok(columns('sources').includes(column), `sources.${column}`);
    for (const column of ['source_id', 'field', 'value', 'origin']) assert.ok(columns('facts').includes(column), `facts.${column}`);
  });
});
