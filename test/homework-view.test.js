// בדיקות לשלב 8.6-1 (docs/08-chapter8/60-chapter8-step-8-6-spec.md): lib/homework-view.js, הפעולות homework ו-task_done ב-api/chat.js, open_tasks ופריט ה-pending,
// המספר על האייקון עם פריטים פתוחים (badgeFrom, loadBadge, loadNotifyState), סינון expires_at, וענף homework בצרכן התור (api/queues/deliver.js).
// "קריטריון N" = קריטריון הקבלה N בטבלה של 60. כל הנתונים מומצאים.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). המסד כאן הוא מחליף בזיכרון (homeworkDb) שמפרש את הפקודות לפי צורתן ומחזיק מצב, כך שנבדקים הזרימה,
// הפרמטרים והתנהגות הכפילויות; נכונות ה-SQL עצמו מוכחת בהרצה חיה של יובל (קריטריון 4: SELECT על מסד חי).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../api/chat.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { badgeFrom, parseChatAction, MAX_TOPIC_LENGTH } from '../lib/chat-view.js';
import { loadNotifyState, sendChatNotification, notifyText } from '../lib/chat-notify.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { sequencesForDate } from '../lib/homework-schedule.js';
import { createLessonAsk, answerHomework, markTaskDone, openTaskFromRow, taskTitle, ASK_BODY } from '../lib/homework-view.js';
import { planNotify } from '../lib/message-slots.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET, FAKE_CRON } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const H = { 'x-intake-secret': FAKE_SECRET };
const URL_CHAT = 'https://x.test/api/chat';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// "עכשיו": ראשון 18.10.2026, 14:30 שעון ישראל (UTC+3). מתמטיקה שיעור 7 נגמר 14:15 והשאלה (14:18) כבר נשלחה.
const NOW = new Date('2026-10-18T11:30:00.000Z');
const SUBJECT = 'מתמטיקה';

// הרצף "מתמטיקה, ראשון 18.10.2026, שיעור 7" (השיעור הבא: שני 19.10, 10:05 ישראל = 07:05Z).
const sequenceOf = (date, subject) => sequencesForDate(TIMETABLE, date).find((s) => s.subject === subject);
const MATH_SUNDAY = sequenceOf('2026-10-18', SUBJECT);

// ---------------------------------------------------------------------------
// מסד בזיכרון. מחזיק messages, lesson_asks, tasks ו-probe_log; מפרש את הפקודות של homework-view, api/chat.js ו-chat-notify לפי צורתן.
// ---------------------------------------------------------------------------
function homeworkDb() {
  const db = { asks: [], messages: [], tasks: [], probe: [], seq: 100, media: {} };
  const nextId = () => uuid(++db.seq);
  const live = (m, nowIso) => m.kind === 'question' && m.awaiting_reply === true && (m.expires_at == null || Date.parse(m.expires_at) > Date.parse(nowIso));
  const askOf = (message) => db.asks.find((a) => a.id === message.entity_id);
  const sql = fakeSql((text, values) => {
    if (text.startsWith('WITH a AS ( INSERT INTO lesson_asks')) {
      const [subject, lessonDate, startPeriod, endAtIso, body, expiresIso] = values;
      if (db.asks.some((a) => a.subject === subject && a.lesson_date === lessonDate && a.seq_start_period === startPeriod)) return [{ ask_id: null, message_id: null }];
      const ask = { id: nextId(), subject, lesson_date: lessonDate, seq_start_period: startPeriod, seq_end_at: endAtIso, topic: null, had_homework: null, task_id: null, status: 'asked' };
      db.asks.push(ask);
      const message = { id: nextId(), direction: 'out', body, kind: 'question', sent_at: new Date(NOW), awaiting_reply: true, reply_source_id: null, expires_at: expiresIso, entity_type: 'lesson_ask', entity_id: ask.id, attempt: 1, read_at: null };
      db.messages.push(message);
      return [{ ask_id: ask.id, message_id: message.id }];
    }
    if (text.includes('FROM messages m JOIN lesson_asks la')) {
      const [messageId, nowIso] = values;
      const message = db.messages.find((m) => m.id === messageId && m.kind === 'question' && (m.expires_at == null || Date.parse(m.expires_at) > Date.parse(nowIso)));
      const ask = message && message.entity_type === 'lesson_ask' ? askOf(message) : null;
      return ask ? [{ id: message.id, awaiting_reply: message.awaiting_reply, subject: ask.subject, lesson_date: ask.lesson_date }] : [];
    }
    if (text.startsWith('WITH closed AS ( UPDATE messages SET awaiting_reply = false, read_at = now()') && text.includes('INSERT INTO tasks')) {
      const [messageId, nowIso, title, dueIso, subject, had, hadAgain, topic] = values;
      assert.equal(had, hadAgain);
      const message = db.messages.find((m) => m.id === messageId && live(m, nowIso) && m.entity_type === 'lesson_ask');
      if (!message) return [{ closed: 0, task_id: null }];
      message.awaiting_reply = false;
      message.read_at = new Date(NOW);
      let taskId = null;
      if (had) {
        taskId = nextId();
        db.tasks.push({ id: taskId, title, due_at: dueIso ? new Date(dueIso) : null, domain: 'homework', status: 'open', subject, created_at: new Date(Date.UTC(2026, 9, 18, 12, 0, db.seq)), estimated_minutes: null, scheduled_at: null, source_event_id: null });
      }
      const ask = askOf(message);
      Object.assign(ask, { had_homework: had, topic, status: 'answered', task_id: taskId });
      return [{ closed: 1, task_id: taskId }];
    }
    if (text.startsWith("UPDATE tasks SET status = 'done'")) {
      const task = db.tasks.find((t) => t.id === values[0] && t.status === 'open');
      if (!task) return [];
      task.status = 'done';
      return [{ id: task.id }];
    }
    if (text.includes('FROM tasks t WHERE t.status = \'open\'')) {
      return db.tasks.filter((t) => t.status === 'open').map((t) => ({ id: t.id, title: t.title, subject: t.subject, due_at: t.due_at, media_count: db.media[t.id] ?? 0 }));
    }
    if (text.includes('AS open_tasks') && text.includes('has_unseen')) {
      const nowIso = values[0];
      const pending = db.messages.filter((m) => live(m, nowIso)).length;
      return [{ pending, unread: 0, open_tasks: db.tasks.filter((t) => t.status === 'open').length, has_unseen: db.messages.some((m) => m.direction === 'out' && m.read_at == null && live(m, nowIso)) }];
    }
    if (text.includes('AS open_tasks') && text.includes('AS unread')) {
      const nowIso = values[0];
      return [{ pending: db.messages.filter((m) => live(m, nowIso)).length, unread: 0, open_tasks: db.tasks.filter((t) => t.status === 'open').length }];
    }
    if (text.includes('FROM messages m LEFT JOIN sources s')) {
      const nowIso = values[0];
      return db.messages.filter((m) => live(m, nowIso)).map((m) => {
        const ask = m.entity_type === 'lesson_ask' ? askOf(m) : null;
        return { id: m.id, body: m.body, sent_at: m.sent_at, entity_type: m.entity_type, source_id: null, channel: null, raw_content: null, content_hash: null, received_at: null, subject: ask?.subject ?? null, lesson_date: ask?.lesson_date ?? null };
      });
    }
    if (text.includes('FROM messages WHERE id')) {
      const m = db.messages.find((x) => x.id === values[0]);
      return m ? [{ id: m.id, kind: m.kind, awaiting_reply: m.awaiting_reply, entity_type: m.entity_type, entity_id: m.entity_id, attempt: m.attempt }] : [];
    }
    if (text.startsWith("SELECT 1 AS found FROM probe_log WHERE probe = 'chat-notify'")) {
      const pattern = values[0].replace(/%$/, '');
      return db.probe.some((p) => p.text.includes("'chat-notify'") && String(p.values[1]).startsWith(pattern)) ? [{ found: 1 }] : [];
    }
    if (text.includes('INSERT INTO probe_log')) {
      db.probe.push({ text, values });
      return [];
    }
    return [];
  });
  sql.db = db;
  return sql;
}

const get = (sql, now = NOW) => handle(req(URL_CHAT, { method: 'GET', headers: H }), { sql, secret: FAKE_SECRET, timetable: TIMETABLE, now: () => now });
const post = (sql, body, now = NOW) => handle(jsonRequest(body, { url: URL_CHAT, headers: { ...H, 'content-type': 'application/json' } }), { sql, secret: FAKE_SECRET, timetable: TIMETABLE, now: () => now });
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));

// שאלה אחת של מתמטיקה (ראשון 18.10.2026): נוצרת בפועל דרך createLessonAsk.
async function dbWithMathAsk() {
  const sql = homeworkDb();
  const { messageId } = await createLessonAsk({ sql, sequence: MATH_SUNDAY });
  return { sql, messageId };
}

// ---------------------------------------------------------------------------
describe('homework-view: createLessonAsk (קריטריון 3, אין שאלה כפולה)', () => {
  test('יוצר שורה ב-lesson_asks ושורת question ב-messages שמצביעה עליה, בפקודה אחת', async () => {
    const sql = homeworkDb();
    const out = await createLessonAsk({ sql, sequence: MATH_SUNDAY });
    assert.equal(out.created, true);
    assert.equal(sql.calls.length, 1, 'פקודה אחת');
    assert.equal(sql.db.asks.length, 1);
    const [ask] = sql.db.asks;
    assert.deepEqual({ subject: ask.subject, lesson_date: ask.lesson_date, seq_start_period: ask.seq_start_period, seq_end_at: ask.seq_end_at, status: ask.status, had_homework: ask.had_homework },
      { subject: 'מתמטיקה', lesson_date: '2026-10-18', seq_start_period: 7, seq_end_at: '2026-10-18T11:15:00.000Z', status: 'asked', had_homework: null });
    const [message] = sql.db.messages;
    assert.equal(message.id, out.messageId);
    assert.deepEqual({ direction: message.direction, kind: message.kind, awaiting_reply: message.awaiting_reply, entity_type: message.entity_type, entity_id: message.entity_id, read_at: message.read_at },
      { direction: 'out', kind: 'question', awaiting_reply: true, entity_type: 'lesson_ask', entity_id: ask.id, read_at: null });
    assert.equal(message.expires_at, '2026-10-25T22:00:00.000Z', 'סוף היום של lesson_date + 7 בשעון ישראל (26.10 00:00, UTC+2)');
    assert.equal(message.body, ASK_BODY);
    assert.ok(!message.body.includes(SUBJECT), 'גוף ההודעה בלי שם מקצוע');
  });
  test('expires_at לפי תאריך כפתור ה-next: שיעור מתמטיקה בשני 19.10.2026 -> כפתור 25.10 -> פוקעת 26.10 00:00 ישראל = 2026-10-25T22:00Z', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: sequenceOf('2026-10-19', 'מתמטיקה'), timetable: TIMETABLE });
    assert.equal(sql.db.messages[0].expires_at, '2026-10-25T22:00:00.000Z');
    const sql2 = homeworkDb();
    await createLessonAsk({ sql: sql2, sequence: MATH_SUNDAY, timetable: TIMETABLE });
    assert.equal(sql2.db.messages[0].expires_at, '2026-10-19T21:00:00.000Z', 'ראשון 18.10 -> כפתור 19.10 -> פוקעת 20.10 00:00 ישראל');
  });
  test('SQL: ON CONFLICT DO NOTHING על המפתח הייחודי, וההודעה נוצרת מתוך שורת ה-lesson_asks שנוצרה', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: MATH_SUNDAY });
    const { text } = sql.calls[0];
    assert.match(text, /ON CONFLICT \(subject, lesson_date, seq_start_period\) DO NOTHING RETURNING id/);
    assert.match(text, /'out', \?::text, 'question', now\(\), true, NULL::uuid, \?::timestamptz, 'lesson_ask', a\.id, 1 FROM a/);
  });
  test('קריאה שנייה לאותו רצף (הגעה כפולה): created=false ולא נוספת שורה אחת', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: MATH_SUNDAY });
    const again = await createLessonAsk({ sql, sequence: MATH_SUNDAY });
    assert.deepEqual(again, { created: false, askId: null, messageId: null });
    assert.equal(sql.db.asks.length, 1);
    assert.equal(sql.db.messages.length, 1);
  });
  test('רצף אחר באותו יום, ואותו רצף ביום אחר, הם שאלות נפרדות', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: MATH_SUNDAY });
    await createLessonAsk({ sql, sequence: sequenceOf('2026-10-18', 'עברית') });
    await createLessonAsk({ sql, sequence: sequenceOf('2026-10-19', 'מתמטיקה') });
    assert.equal(sql.db.asks.length, 3);
  });
  test('כשל מסד נזרק (התור ינסה שוב)', async () => {
    await assert.rejects(() => createLessonAsk({ sql: fakeSql(() => { throw new Error('db down'); }), sequence: MATH_SUNDAY }), /db down/);
  });
});

describe('homework-view: answerHomework (קריטריון 4)', () => {
  test('"היו": משימה אחת open עם due_at (תחילת השיעור הבא), subject וכותרת; השאלה נסגרת וקשורה למשימה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const out = await answerHomework({ sql, messageId, had: true, topic: null, timetable: TIMETABLE, now: NOW });
    assert.equal(out.status, 'answered');
    assert.equal(sql.db.tasks.length, 1);
    const [task] = sql.db.tasks;
    assert.equal(out.taskId, task.id);
    assert.deepEqual({ title: task.title, domain: task.domain, status: task.status, subject: task.subject }, { title: 'שיעורי בית · מתמטיקה', domain: 'homework', status: 'open', subject: 'מתמטיקה' });
    assert.equal(task.due_at.toISOString(), '2026-10-19T07:05:00.000Z', 'שני 19.10 10:05 ישראל');
    assert.equal(taskTitle('מתמטיקה'), task.title);
    assert.equal(sql.db.messages[0].awaiting_reply, false);
    assert.deepEqual({ had: sql.db.asks[0].had_homework, status: sql.db.asks[0].status, task: sql.db.asks[0].task_id }, { had: true, status: 'answered', task: task.id });
  });
  test('"היו" שאחריו סוף שבוע: מדעי המחשב ביום חמישי 22.10 -> שני 26.10, 12:40 אחרי המעבר = 10:40Z', async () => {
    const sql = homeworkDb();
    const { messageId } = await createLessonAsk({ sql, sequence: sequenceOf('2026-10-22', 'מדעי המחשב') });
    const out = await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: new Date('2026-10-22T12:00:00.000Z') });
    assert.equal(out.status, 'answered');
    assert.equal(sql.db.tasks[0].due_at.toISOString(), '2026-10-26T10:40:00.000Z');
  });
  test('"לא היו" עם נושא: אין משימה, הנושא נשמר, השאלה נסגרת', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const out = await answerHomework({ sql, messageId, had: false, topic: 'משוואות ריבועיות', timetable: TIMETABLE, now: NOW });
    assert.deepEqual(out, { status: 'answered', taskId: null });
    assert.equal(sql.db.tasks.length, 0);
    assert.deepEqual({ had: sql.db.asks[0].had_homework, topic: sql.db.asks[0].topic, status: sql.db.asks[0].status, task: sql.db.asks[0].task_id }, { had: false, topic: 'משוואות ריבועיות', status: 'answered', task: null });
    assert.equal(sql.db.messages[0].awaiting_reply, false);
  });
  test('"לא היו" בלי נושא: אין משימה והנושא נשאר ריק', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    await answerHomework({ sql, messageId, had: false, topic: null, timetable: TIMETABLE, now: NOW });
    assert.equal(sql.db.asks[0].topic, null);
    assert.equal(sql.db.tasks.length, 0);
  });
  test('לחיצה כפולה על "היו": closed, ומשימה אחת בלבד', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const first = await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW });
    const second = await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW });
    assert.equal(first.status, 'answered');
    assert.deepEqual(second, { status: 'closed', taskId: null });
    assert.equal(sql.db.tasks.length, 1);
  });
  test('לחיצה כפולה מקבילה (שתי בקשות שעברו את הבדיקה המקדימה): הסגירה המותנית נותנת closed ולא משימה שנייה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    // שתי הבקשות קוראות awaiting_reply=true לפני שאחת מהן כותבת (תחרות). הפקודה הכותבת היא מותנית, ולכן רק אחת משנה שורה.
    const [a, b] = await Promise.all([
      answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW }),
      answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), ['answered', 'closed']);
    assert.equal(sql.db.tasks.length, 1);
  });
  test('הפקודה הכותבת היא אחת: סגירה מותנית (awaiting_reply = true), יצירת המשימה רק מתוך השורה שנסגרה, ועדכון lesson_asks', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW });
    const writes = sql.calls.filter((c) => c.text.startsWith('WITH closed AS'));
    assert.equal(writes.length, 1);
    const { text } = writes[0];
    assert.match(text, /UPDATE messages SET awaiting_reply = false, read_at = now\(\) WHERE id = \?::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'lesson_ask'/);
    assert.match(text, /INSERT INTO tasks \(title, due_at, domain, status, subject\) SELECT \?::text, \?::timestamptz, 'homework', 'open', \?::text FROM closed WHERE \?::boolean/);
    assert.match(text, /UPDATE lesson_asks SET had_homework = \?::boolean, topic = \?::text, status = 'answered', task_id = \(SELECT id FROM t\) WHERE id IN \(SELECT entity_id FROM closed\)/);
    assert.ok(!/\bDELETE\b/.test(text));
  });
  test('שאלה לא קיימת, או הודעה שאינה שאלת שיעורי בית: closed ושום כתיבה', async () => {
    const { sql } = await dbWithMathAsk();
    const before = sql.calls.length;
    assert.deepEqual(await answerHomework({ sql, messageId: uuid(9999), had: true, timetable: TIMETABLE, now: NOW }), { status: 'closed', taskId: null });
    sql.db.messages.push({ id: uuid(8000), kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: uuid(8001), expires_at: null, direction: 'out', read_at: null });
    assert.deepEqual(await answerHomework({ sql, messageId: uuid(8000), had: false, timetable: TIMETABLE, now: NOW }), { status: 'closed', taskId: null });
    assert.equal(sql.calls.slice(before).filter((c) => /\b(INSERT|UPDATE)\b/.test(c.text)).length, 0);
  });
  test('שאלה שפגה (expires_at בעבר): closed ושום כתיבה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const after = new Date('2026-10-26T00:00:00.000Z'); // אחרי 25.10 22:00Z
    assert.deepEqual(await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: after }), { status: 'closed', taskId: null });
    assert.equal(sql.db.tasks.length, 0);
    assert.equal(sql.db.messages[0].awaiting_reply, true);
  });
  test('"היו" כשאי אפשר לחשב תאריך (מערכת שעות חסרה, או מקצוע שלא נמצא): unclear, לא נכתב כלום, והשאלה נשארת פתוחה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const before = sql.calls.length;
    assert.deepEqual(await answerHomework({ sql, messageId, had: true, timetable: null, now: NOW }), { status: 'unclear', taskId: null });
    assert.deepEqual(await answerHomework({ sql, messageId, had: true, timetable: { slots: [] }, now: NOW }), { status: 'unclear', taskId: null });
    assert.equal(sql.calls.slice(before).filter((c) => c.text.startsWith('WITH closed')).length, 0);
    assert.equal(sql.db.messages[0].awaiting_reply, true);
    // "לא היו" לא צריך תאריך ולכן עובד גם בלי מערכת שעות
    assert.equal((await answerHomework({ sql, messageId, had: false, timetable: null, now: NOW })).status, 'answered');
  });
  test('"היו" אחרי שתאריך "השיעור הבא" עבר (תשובה ב-20.10 על מתמטיקה של 18.10, השיעור הבא היה 19.10): unclear ושום משימה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const out = await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: new Date('2026-10-20T09:00:00.000Z') });
    assert.deepEqual(out, { status: 'unclear', taskId: null });
    assert.equal(sql.db.tasks.length, 0);
  });
  test('כשל מסד נזרק', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    // הקריאה המקדימה מגיעה למסד של הבדיקה, והפקודה הכותבת נכשלת
    const hybrid = Object.assign(async (strings, ...values) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      if (text.startsWith('WITH closed')) throw new Error('db down');
      return sql(strings, ...values);
    }, {});
    await assert.rejects(() => answerHomework({ sql: hybrid, messageId, had: true, timetable: TIMETABLE, now: NOW }), /db down/);
  });
});

describe('homework-view: task_done (קריטריון 5)', () => {
  async function twoTasks() {
    const { sql, messageId } = await dbWithMathAsk();
    await answerHomework({ sql, messageId, had: true, timetable: TIMETABLE, now: NOW });
    const other = await createLessonAsk({ sql, sequence: sequenceOf('2026-10-18', 'עברית') });
    await answerHomework({ sql, messageId: other.messageId, had: true, timetable: TIMETABLE, now: NOW });
    return { sql, [0]: sql.db.tasks[0], [1]: sql.db.tasks[1] };
  }
  test('markTaskDone קובע done רק למשימה הזאת; משימה אחרת נשארת open', async () => {
    const t = await twoTasks();
    assert.equal(await markTaskDone(t.sql, t[0].id), true);
    assert.deepEqual(t.sql.db.tasks.map((x) => x.status), ['done', 'open']);
  });
  test('לחיצה כפולה, משימה לא קיימת: false, בלי לשבור ובלי לשנות משימה אחרת', async () => {
    const t = await twoTasks();
    assert.equal(await markTaskDone(t.sql, t[0].id), true);
    assert.equal(await markTaskDone(t.sql, t[0].id), false);
    assert.equal(await markTaskDone(t.sql, uuid(9999)), false);
    assert.deepEqual(t.sql.db.tasks.map((x) => x.status), ['done', 'open']);
  });
  test('הפקודה היא עדכון מותנה בסטטוס open, בלי מחיקה פיזית', async () => {
    const t = await twoTasks();
    await markTaskDone(t.sql, t[0].id);
    const call = t.sql.calls.at(-1);
    assert.equal(call.text, "UPDATE tasks SET status = 'done' WHERE id = ?::uuid AND status = 'open' RETURNING id");
    assert.deepEqual(call.values, [t[0].id]);
  });
  test('דרך הנקודה: done ואז closed (200 בשני המקרים), ו-open_tasks ו-badge מתעדכנים', async () => {
    const t = await twoTasks();
    const first = await (await post(t.sql, { action: 'task_done', task_id: t[0].id })).json();
    assert.equal(first.status, 'done');
    assert.deepEqual(first.open_tasks.map((x) => x.id), [t[1].id]);
    const second = await post(t.sql, { action: 'task_done', task_id: t[0].id });
    assert.equal(second.status, 200);
    const secondBody = await second.json();
    assert.equal(secondBody.status, 'closed');
    assert.deepEqual(secondBody.open_tasks.map((x) => x.id), [t[1].id]);
  });
});

describe('chat: פעולות homework ו-task_done בנקודה (parseChatAction)', () => {
  const MID = uuid(1);
  test('homework תקין: had=true דורש due=next; had=false מתעלם מ-due; topic נקצץ, וריק נהיה null', () => {
    assert.deepEqual(parseChatAction({ action: 'homework', message_id: MID, had: true, due: 'next', topic: '  שברים  ' }), { ok: true, action: 'homework', messageId: MID, had: true, topic: 'שברים', due: 'next' });
    assert.deepEqual(parseChatAction({ action: 'homework', message_id: MID, had: false }), { ok: true, action: 'homework', messageId: MID, had: false, topic: null, due: null });
    assert.deepEqual(parseChatAction({ action: 'homework', message_id: MID, had: false, topic: '   ', due: 'next' }), { ok: true, action: 'homework', messageId: MID, had: false, topic: null, due: null });
    assert.deepEqual(parseChatAction({ action: 'homework', message_id: MID, had: false, topic: null, due: null }).topic, null);
    assert.equal(parseChatAction({ action: 'homework', message_id: MID, had: false, topic: 'א'.repeat(MAX_TOPIC_LENGTH) }).ok, true);
  });
  test('homework לא תקין נדחה', () => {
    const bad = [
      { action: 'homework', message_id: 'x', had: false }, { action: 'homework', had: false }, { action: 'homework', message_id: MID },
      { action: 'homework', message_id: MID, had: 'true' }, { action: 'homework', message_id: MID, had: 1 }, { action: 'homework', message_id: MID, had: null },
      { action: 'homework', message_id: MID, had: true }, // חסר due
      { action: 'homework', message_id: MID, had: true, due: 'same_next_week' }, // כפתור אחד בלבד (הכרעת יובל)
      { action: 'homework', message_id: MID, had: false, due: 'tomorrow' },
      { action: 'homework', message_id: MID, had: false, topic: 5 }, { action: 'homework', message_id: MID, had: false, topic: ['x'] },
      { action: 'homework', message_id: MID, had: false, topic: 'א'.repeat(MAX_TOPIC_LENGTH + 1) },
    ];
    for (const body of bad) assert.equal(parseChatAction(body).ok, false, JSON.stringify(body));
  });
  test('task_done: uuid בלבד', () => {
    assert.deepEqual(parseChatAction({ action: 'task_done', task_id: MID }), { ok: true, action: 'task_done', taskId: MID });
    for (const bad of [{ action: 'task_done' }, { action: 'task_done', task_id: 'x' }, { action: 'task_done', task_id: 5 }, { action: 'task_done', taskId: MID }]) assert.equal(parseChatAction(bad).ok, false);
  });
  test('גוף פגום מגיע ל-400 "לא נשלח, נסה שוב." ושום קריאה למסד', async () => {
    for (const body of [{ action: 'homework', message_id: MID, had: true }, { action: 'task_done', task_id: 'x' }]) {
      const sql = homeworkDb();
      const res = await post(sql, body);
      assert.equal(res.status, 400);
      assert.equal(await res.text(), 'לא נשלח, נסה שוב.');
      assert.equal(sql.calls.length, 0);
    }
  });
  test('פעולות homework ו-task_done בלי סוד: 401 ושום קריאה למסד', async () => {
    for (const body of [{ action: 'homework', message_id: MID, had: false }, { action: 'task_done', task_id: MID }]) {
      const sql = homeworkDb();
      const res = await handle(jsonRequest(body, { url: URL_CHAT, headers: { 'x-intake-secret': 'wrong' } }), { sql, secret: FAKE_SECRET });
      assert.equal(res.status, 401);
      assert.equal(sql.calls.length, 0);
    }
  });
});

describe('chat: POST homework מקצה לקצה', () => {
  test('"היו": status answered, task_id, ובתשובה pending בלי הכרטיס, open_tasks עם המשימה ו-badge 1', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const res = await post(sql, { action: 'homework', message_id: messageId, had: true, due: 'next' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'answered');
    assert.equal(body.task_id, sql.db.tasks[0].id);
    assert.deepEqual(body.pending, []);
    assert.deepEqual(body.open_tasks, [{ id: sql.db.tasks[0].id, title: 'שיעורי בית · מתמטיקה', subject: 'מתמטיקה', due_at: '2026-10-19T07:05:00.000Z', media_count: 0 }]);
    assert.equal(body.badge, 1);
  });
  test('לחיצה כפולה: השנייה closed עם task_id ריק, ומשימה אחת', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    await post(sql, { action: 'homework', message_id: messageId, had: true, due: 'next' });
    const body = await (await post(sql, { action: 'homework', message_id: messageId, had: true, due: 'next' })).json();
    assert.equal(body.status, 'closed');
    assert.equal(body.task_id, null);
    assert.equal(sql.db.tasks.length, 1);
    assert.equal(body.open_tasks.length, 1);
  });
  test('"לא היו" עם נושא: answered בלי task_id; הנושא נשמר; badge 0', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const body = await (await post(sql, { action: 'homework', message_id: messageId, had: false, topic: 'גאומטריה' })).json();
    assert.equal(body.status, 'answered');
    assert.equal(body.task_id, null);
    assert.equal(sql.db.asks[0].topic, 'גאומטריה');
    assert.equal(body.badge, 0);
  });
  test('unclear (השיעור הבא כבר עבר) מחזיר pending עם הכרטיס, בלי כפתורים, ובלי כתיבה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const late = new Date('2026-10-20T09:00:00.000Z');
    const body = await (await post(sql, { action: 'homework', message_id: messageId, had: true, due: 'next' }, late)).json();
    assert.equal(body.status, 'unclear');
    assert.equal(body.pending.length, 1);
    assert.deepEqual(body.pending[0].buttons, []);
    assert.equal(sql.db.tasks.length, 0);
  });
});

describe('chat: GET, open_tasks ופריט ה-pending', () => {
  test('פריט pending של שאלת שיעורי בית: צורה מדויקת עם כפתור next יחיד, מחושב מ-lesson_date', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const body = await (await get(sql)).json();
    assert.equal(body.pending.length, 1);
    assert.deepEqual(body.pending[0], {
      id: messageId, kind: 'homework', at: NOW.toISOString(), subject: 'מתמטיקה', lesson_date: '2026-10-18',
      buttons: [{ due: 'next', date: '2026-10-19' }], topic_allowed: true,
    });
    assert.ok(!('allowFreeText' in body.pending[0]) && !('text' in body.pending[0]), 'בלי "לא יודע" ובלי תיבת כתיבה חופשית');
  });
  test('תשובה באיחור: הכפתור שתאריכו עבר לא מוצג (buttons ריק) אבל השאלה עדיין ממתינה ונספרת', async () => {
    const { sql } = await dbWithMathAsk();
    const body = await (await get(sql, new Date('2026-10-20T09:00:00.000Z'))).json();
    assert.deepEqual(body.pending[0].buttons, []);
    assert.equal(body.badge, 1);
  });
  test('open_tasks: ריק כשאין, ובכל משימה id, title, subject, due_at, media_count (שדה ריק לא נכלל)', async () => {
    const sql = homeworkDb();
    assert.deepEqual((await (await get(sql)).json()).open_tasks, []);
    sql.db.tasks.push({ id: uuid(1), title: 'משימה אישית', due_at: null, status: 'open', subject: null, created_at: new Date() });
    sql.db.tasks.push({ id: uuid(2), title: 'שיעורי בית · כימיה', due_at: new Date('2026-10-19T07:05:00.000Z'), status: 'open', subject: 'כימיה', created_at: new Date() });
    sql.db.tasks.push({ id: uuid(3), title: 'סגורה', due_at: null, status: 'done', subject: null, created_at: new Date() });
    sql.db.media[uuid(2)] = 1;
    const body = await (await get(sql)).json();
    assert.deepEqual(body.open_tasks, [
      { id: uuid(1), title: 'משימה אישית', media_count: 0 },
      { id: uuid(2), title: 'שיעורי בית · כימיה', subject: 'כימיה', due_at: '2026-10-19T07:05:00.000Z', media_count: 1 },
    ]);
  });
  test('שאילתת הפתוחות: status=open בלבד, ממוין לפי due_at (ללא תאריך בסוף), אחר כך created_at ואז id; media_count נספר מ-media.task_id', async () => {
    const sql = homeworkDb();
    await get(sql);
    const [call] = sql.find("FROM tasks t");
    assert.match(call.text, /WHERE t\.status = 'open' ORDER BY t\.due_at ASC NULLS LAST, t\.created_at ASC NULLS LAST, t\.id ASC$/);
    assert.match(call.text, /\(SELECT count\(\*\) FROM media md WHERE md\.task_id = t\.id\)::int AS media_count/);
  });
  test('openTaskFromRow: מקרי קצה', () => {
    assert.deepEqual(openTaskFromRow({ id: 'a', title: null, subject: '', due_at: 'לא תאריך', media_count: 'x' }), { id: 'a', title: '', media_count: 0 });
    assert.deepEqual(openTaskFromRow({ id: 'a', title: 't', subject: 's', due_at: '2026-10-19T07:05:00Z', media_count: 2 }), { id: 'a', title: 't', subject: 's', due_at: '2026-10-19T07:05:00.000Z', media_count: 2 });
  });
  test('GET לא כותב כלום', async () => {
    const { sql } = await dbWithMathAsk();
    const before = sql.calls.length;
    await get(sql);
    assert.equal(writesOf({ calls: sql.calls.slice(before) }).length, 0);
  });
});

// ---------------------------------------------------------------------------
// קריטריון 6: המספר על האייקון עם פריטים פתוחים. שלושה מקומות שחייבים להסכים: badgeFrom, loadBadge (api/chat.js), loadNotifyState (lib/chat-notify.js).
// ---------------------------------------------------------------------------
describe('המספר על האייקון עם פריטים פתוחים (קריטריון 6)', () => {
  test('badgeFrom: פריט פתוח נספר 1 כל אחד, ביחד עם שאלות, בועות וסיכום', () => {
    assert.equal(badgeFrom({ pending: 1, openTasks: 1 }), 2);
    assert.equal(badgeFrom({ openTasks: 3 }), 3);
    assert.equal(badgeFrom({ pending: 2, unread: 3, review: 5, openTasks: 4 }), 10, 'הסיכום נספר 1 גם כשהערך גדול');
    assert.equal(badgeFrom({ openTasks: -1 }), 0);
    assert.equal(badgeFrom({ openTasks: 'x' }), 0);
    assert.equal(badgeFrom({ openTasks: 1.5 }), 0);
    assert.equal(badgeFrom({ pending: 1, unread: 1 }), 2, 'בלי openTasks כמו קודם');
    assert.equal(badgeFrom(), 0);
  });

  test('שאלת שיעורי בית ממתינה אחת ופריט tasks פתוח אחד = 2, זהה ב-loadBadge (GET), ב-loadNotifyState וב-badgeFrom', async () => {
    const { sql } = await dbWithMathAsk();
    sql.db.tasks.push({ id: uuid(1), title: 'משימה', due_at: null, status: 'open', subject: null, created_at: new Date() });
    const badge = (await (await get(sql)).json()).badge;
    const state = await loadNotifyState(sql, NOW);
    assert.deepEqual(state, { pending: 1, unread: 0, review: 0, openTasks: 1, hasUnseen: true });
    assert.equal(badge, 2);
    assert.equal(badgeFrom(state), 2);
    assert.equal(badge, badgeFrom(state));
  });

  test('"בוצע" מוריד את המספר ב-1, ושלושת המקומות עדיין מסכימים', async () => {
    const { sql } = await dbWithMathAsk();
    sql.db.tasks.push({ id: uuid(1), title: 'משימה', due_at: null, status: 'open', subject: null, created_at: new Date() });
    const done = await (await post(sql, { action: 'task_done', task_id: uuid(1) })).json();
    assert.equal(done.status, 'done');
    assert.equal(done.badge, 1);
    const state = await loadNotifyState(sql, NOW);
    assert.equal(badgeFrom(state), 1);
    assert.equal((await (await get(sql)).json()).badge, 1);
  });

  test('כמה פריטים פתוחים נספרים כל אחד; ומענה על השאלה מוריד 1 ומוסיף 1 אם נוצרה משימה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    sql.db.tasks.push({ id: uuid(1), title: 'א', due_at: null, status: 'open', subject: null, created_at: new Date() });
    sql.db.tasks.push({ id: uuid(2), title: 'ב', due_at: null, status: 'open', subject: null, created_at: new Date() });
    assert.equal((await (await get(sql)).json()).badge, 3);
    const answered = await (await post(sql, { action: 'homework', message_id: messageId, had: true, due: 'next' })).json();
    assert.equal(answered.badge, 3, 'השאלה ירדה (1-), המשימה החדשה נוספה (1+)');
    const no = homeworkDb();
    const asked = await createLessonAsk({ sql: no, sequence: MATH_SUNDAY });
    assert.equal((await (await post(no, { action: 'homework', message_id: asked.messageId, had: false })).json()).badge, 0);
  });

  test('השאילתות של loadBadge ו-loadNotifyState סופרות את אותם תנאים (שאלות שלא פגו, tasks עם status=open)', async () => {
    const { sql } = await dbWithMathAsk();
    await get(sql);
    await loadNotifyState(sql, NOW);
    const badgeCall = sql.calls.find((c) => c.text.includes('AS unread') && !c.text.includes('has_unseen'));
    const stateCall = sql.calls.find((c) => c.text.includes('has_unseen'));
    for (const call of [badgeCall, stateCall]) {
      assert.ok(call.text.includes("(SELECT count(*) FROM messages WHERE kind = 'question' AND awaiting_reply = true AND (expires_at IS NULL OR expires_at > ?::timestamptz))::int AS pending"));
      assert.ok(call.text.includes("(SELECT count(*) FROM tasks WHERE status = 'open')::int AS open_tasks"));
    }
  });

  test('פריט פתוח לבדו לא מפעיל התראה: hasUnseen לא משתנה, ו-sendChatNotification מחזיר nothing-unseen בלי לשלוח', async () => {
    const sql = homeworkDb();
    sql.db.tasks.push({ id: uuid(1), title: 'משימה', due_at: null, status: 'open', subject: null, created_at: new Date() });
    const state = await loadNotifyState(sql, NOW);
    assert.deepEqual(state, { pending: 0, unread: 0, review: 0, openTasks: 1, hasUnseen: false });
    const push = fakePush();
    const out = await sendChatNotification({ sql, slotKey: 'notify-1792322280', pushHandle: push, secret: FAKE_CRON, now: NOW });
    assert.deepEqual(out, { sent: false, reason: 'nothing-unseen', badge: 1 });
    assert.equal(push.seen.length, 0);
  });

  test('פריט פתוח מוסיף למספר שבהתראה של שאלה: app_badge 2, והנוסח הכללי לא משתנה ("שאלה אחת ממתינה")', async () => {
    const { sql } = await dbWithMathAsk();
    sql.db.tasks.push({ id: uuid(1), title: 'משימה', due_at: null, status: 'open', subject: null, created_at: new Date() });
    const push = fakePush();
    const out = await sendChatNotification({ sql, slotKey: 'notify-1792322280', pushHandle: push, secret: FAKE_CRON, now: NOW });
    assert.deepEqual(out, { sent: true, status: 200, badge: 2 });
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: 'שאלה אחת ממתינה', navigate: '/', app_badge: 2, dedupe_key: 'notify-1792322280' });
  });
});

// ---------------------------------------------------------------------------
// קריטריון 13: expires_at. שורה מומצאת עם expires_at בעבר, ושורה עם expires_at בעתיד.
// ---------------------------------------------------------------------------
describe('expires_at (קריטריון 13)', () => {
  const question = (id, expiresAt) => ({ id: uuid(id), direction: 'out', body: 'היו שיעורי בית?', kind: 'question', sent_at: new Date('2026-10-18T11:18:00.000Z'), awaiting_reply: true, expires_at: expiresAt, entity_type: 'lesson_ask', entity_id: uuid(id + 500), read_at: null });
  const withAsk = (sql, id, expiresAt, subject = 'מתמטיקה') => {
    sql.db.asks.push({ id: uuid(id + 500), subject, lesson_date: '2026-10-18', seq_start_period: 7 + id });
    sql.db.messages.push(question(id, expiresAt));
  };
  const PAST = '2026-10-18T10:00:00.000Z'; // לפני NOW
  const FUTURE = '2026-10-25T22:00:00.000Z'; // אחרי NOW

  test('שאלה שפגה לא ב-loadPending, לא ב-loadBadge ולא ב-loadNotifyState; שאלה עם expires_at בעתיד כן', async () => {
    const sql = homeworkDb();
    withAsk(sql, 1, PAST);
    withAsk(sql, 2, FUTURE);
    const body = await (await get(sql)).json();
    assert.deepEqual(body.pending.map((p) => p.id), [uuid(2)]);
    assert.equal(body.badge, 1);
    const state = await loadNotifyState(sql, NOW);
    assert.equal(state.pending, 1);
    assert.equal(badgeFrom(state), 1);
  });
  test('שאלה בלי expires_at (ריק) לא פגה', async () => {
    const sql = homeworkDb();
    withAsk(sql, 1, null);
    const body = await (await get(sql)).json();
    assert.equal(body.pending.length, 1);
    assert.equal(body.badge, 1);
  });
  test('רק שאלה שפגה: המספר 0, pending ריק, ו-hasUnseen=false (לא מפעילה התראה)', async () => {
    const sql = homeworkDb();
    withAsk(sql, 1, PAST);
    const body = await (await get(sql)).json();
    assert.deepEqual(body.pending, []);
    assert.equal(body.badge, 0);
    const state = await loadNotifyState(sql, NOW);
    assert.deepEqual(state, { pending: 0, unread: 0, review: 0, openTasks: 0, hasUnseen: false });
    const push = fakePush();
    const out = await sendChatNotification({ sql, slotKey: 'notify-1792322280', pushHandle: push, secret: FAKE_CRON, now: NOW });
    assert.equal(out.sent, false);
    assert.equal(push.seen.length, 0);
  });
  test('הזמן מוזרק: אותה שאלה נספרת לפני expires_at ופגה אחריו (גבול: שווה בדיוק = פגה)', async () => {
    const sql = homeworkDb();
    withAsk(sql, 1, FUTURE);
    assert.equal((await (await get(sql, new Date('2026-10-25T21:59:59.000Z'))).json()).badge, 1);
    assert.equal((await (await get(sql, new Date(FUTURE))).json()).badge, 0, 'expires_at > now קפדני');
    assert.equal((await loadNotifyState(sql, new Date('2026-10-25T21:59:59.000Z'))).pending, 1);
    assert.equal((await loadNotifyState(sql, new Date(FUTURE))).pending, 0);
  });
  test('שלוש השאילתות מעבירות את now כפרמטר (לא קוראות שעון ב-SQL) ומכילות את תנאי הסינון', async () => {
    const sql = homeworkDb();
    withAsk(sql, 1, FUTURE);
    await get(sql);
    await loadNotifyState(sql, NOW);
    const calls = sql.calls.filter((c) => c.text.includes('expires_at IS NULL OR'));
    assert.ok(calls.length >= 3, 'loadPending, loadBadge ו-loadNotifyState');
    for (const call of calls) {
      assert.ok(call.values.includes(NOW.toISOString()), 'now מועבר כפרמטר');
      assert.ok(!/expires_at > now\(\)/.test(call.text));
    }
    assert.ok(calls.some((c) => c.text.includes('FROM messages m LEFT JOIN sources s')), 'loadPending');
  });
});

// ---------------------------------------------------------------------------
// קריטריון 15: answer על שאלת שיעורי בית מחזיר closed ולא כותב.
// ---------------------------------------------------------------------------
describe('answer על שאלת שיעורי בית (קריטריון 15)', () => {
  test('מחזיר closed, items ריק, ולא נכתב כלום (אפילו לא פקודה אחת של INSERT/UPDATE/DELETE); השאלה נשארת פתוחה', async () => {
    const { sql, messageId } = await dbWithMathAsk();
    const before = sql.calls.length;
    const res = await post(sql, { action: 'answer', message_id: messageId, answer: 'היו' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'closed');
    assert.deepEqual(body.items, []);
    assert.equal(body.pending.length, 1, 'הכרטיס עדיין ממתין');
    assert.equal(writesOf({ calls: sql.calls.slice(before) }).length, 0);
    assert.equal(sql.db.messages[0].awaiting_reply, true);
    assert.equal(sql.db.tasks.length, 0);
  });
});

// ---------------------------------------------------------------------------
// ענף homework בצרכן התור: קריטריונים 3, 7 ו-14.
// ---------------------------------------------------------------------------
function fakePush(status = 200) {
  const seen = [];
  const handle = async (request) => {
    seen.push({ request, body: JSON.parse(await request.clone().text()) });
    if (typeof status === 'function') return status();
    return new Response('ok', { status });
  };
  handle.seen = seen;
  return handle;
}

describe('queue-deliver: ענף homework (קריטריונים 3, 7 ו-14)', () => {
  const key = (date, period) => `homework-${date}-${period}`;
  const messageFor = (sequence) => ({ kind: 'homework', slotKey: sequence.slotKey, targetAt: sequence.askAt.toISOString() });
  const MATH_MSG = messageFor(MATH_SUNDAY); // homework-2026-10-18-7, יעד 2026-10-18T11:18:00.000Z
  const DELIVERED = new Date('2026-10-18T11:18:00.500Z'); // חלון notify-1792322280
  const run = (sql, push, message = MATH_MSG, extra = {}) => handleDelivery(message, { deliveryCount: 1 }, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE, ...extra });
  const probeRows = (sql, probe) => sql.db.probe.filter((p) => p.text.includes(`'${probe}'`));

  test('ההודעה מהתור מכילה רק kind, slotKey ו-targetAt, והמפתח תקין', () => {
    assert.deepEqual(MATH_MSG, { kind: 'homework', slotKey: 'homework-2026-10-18-7', targetAt: '2026-10-18T11:18:00.000Z' });
  });

  test('הגעה: נוצרת שאלה אחת (lesson_asks + messages), והתראה אחת בנוסח הכללי עם app_badge', async () => {
    const sql = homeworkDb();
    const push = fakePush();
    const out = await run(sql, push);
    assert.equal(out.stored, true);
    assert.equal(out.created, true);
    assert.equal(out.sent, true);
    assert.equal(sql.db.asks.length, 1);
    assert.equal(sql.db.messages.length, 1);
    assert.equal(sql.db.messages[0].entity_id, sql.db.asks[0].id);
    assert.equal(push.seen.length, 1);
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: 'שאלה אחת ממתינה', navigate: '/', app_badge: 1, dedupe_key: 'notify-1792322280' });
    assert.equal(push.seen[0].body.body, notifyText({ pending: 1 }));
    assert.equal(push.seen[0].request.headers.get('authorization'), `Bearer ${FAKE_CRON}`);
  });

  test('השם והתאריך נגזרים מהמפתח ומהטבלה: גוף ההודעה לא נושא מקצוע, והשאלה נוצרת למקצוע הנכון', async () => {
    const sql = homeworkDb();
    await run(sql, fakePush(), { kind: 'homework', slotKey: key('2026-10-22', 8), targetAt: '2026-10-22T12:48:00.000Z' });
    assert.equal(sql.db.asks[0].subject, 'כימיה');
    assert.equal(sql.db.asks[0].seq_start_period, 8);
    assert.equal(sql.db.asks[0].lesson_date, '2026-10-22');
  });

  test('פער הניסיון החוזר: השאלה קיימת (created=false) ואין שורת chat-notify -> נשלחת התראה אחת; אחריה הגעה נוספת לא שולחת', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: MATH_SUNDAY, timetable: TIMETABLE }); // קריסה אחרי היצירה, לפני ההתראה
    const push = fakePush();
    const out = await run(sql, push);
    assert.equal(out.created, false);
    assert.equal(out.sent, true);
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.body, 'שאלה אחת ממתינה');
    assert.ok(!JSON.stringify(push.seen[0].body).includes(SUBJECT));
    assert.equal(sql.db.asks.length, 1);
    await run(sql, push);
    assert.equal(push.seen.length, 1, 'עכשיו יש שורת chat-notify');
  });
  test('created=false ושורת chat-notify כבר קיימת לרצף: לא נשלחת התראה', async () => {
    const sql = homeworkDb();
    await createLessonAsk({ sql, sequence: MATH_SUNDAY, timetable: TIMETABLE });
    sql.db.probe.push({ text: "INSERT INTO probe_log (probe, ok, detail) SELECT 'chat-notify'", values: [true, 'slot=homework-2026-10-18-7; target_utc=x', 'slot=homework-2026-10-18-7;%'] });
    const push = fakePush();
    const out = await run(sql, push);
    assert.equal(out.sent, false);
    assert.equal(push.seen.length, 0);
    assert.match(sql.calls.find((c) => c.text.startsWith('SELECT 1 AS found')).text, /probe = 'chat-notify' AND detail LIKE \? LIMIT 1/);
  });
  test('הגעה כפולה של אותה הודעה (קריטריון 3): שאלה אחת, הודעה אחת, ודחיפה אחת בלבד', async () => {
    const sql = homeworkDb();
    const push = fakePush();
    await run(sql, push);
    const second = await run(sql, push, MATH_MSG, { now: () => new Date('2026-10-18T11:19:20.000Z') });
    assert.equal(second.created, false);
    assert.equal(second.sent, false);
    assert.equal(sql.db.asks.length, 1);
    assert.equal(sql.db.messages.length, 1);
    assert.equal(push.seen.length, 1, 'אין התראה כפולה');
  });

  test('רישום ב-probe_log: message-slot ו-chat-notify, שניהם אידמפוטנטיים לפי המשבצת, בלי שם מקצוע', async () => {
    const sql = homeworkDb();
    await run(sql, fakePush());
    await run(sql, fakePush());
    const slotRows = probeRows(sql, 'message-slot');
    const notifyRows = probeRows(sql, 'chat-notify');
    assert.equal(slotRows.length, 2, 'ההכנסה נשלחת פעמיים, והמסד בולם בעזרת WHERE NOT EXISTS');
    for (const row of [...slotRows, ...notifyRows]) assert.match(row.text, /WHERE NOT EXISTS \(SELECT 1 FROM probe_log WHERE probe = '(message-slot|chat-notify)' AND detail LIKE \?\)/);
    assert.equal(notifyRows[0].values[0], true);
    assert.match(notifyRows[0].values[1], /^slot=homework-2026-10-18-7; target_utc=2026-10-18T11:18:00.000Z; delivered_utc=2026-10-18T11:18:00.500Z; late_s=0.5; delivery_count=1; created=true; badge=1; sent=true$/);
    assert.equal(notifyRows[0].values[2], 'slot=homework-2026-10-18-7;%');
    assert.match(notifyRows[1].values[1], /created=false; badge=null; sent=false; reason=exists$/);
  });

  test('שתי שאלות באותו חלון (30 שניות): אותו dedupe_key (push-send מאחד); חלון אחר: מפתח אחר (קריטריון 7)', async () => {
    const sql = homeworkDb();
    const push = fakePush();
    const english = sequenceOf('2026-10-19', 'אנגלית'); // שני 19.10, יעד 09:38Z
    const computers = sequenceOf('2026-10-19', 'מדעי המחשב');
    await handleDelivery(messageFor(english), {}, { sql, now: () => new Date('2026-10-19T09:38:01.000Z'), pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE });
    await handleDelivery(messageFor(computers), {}, { sql, now: () => new Date('2026-10-19T09:38:29.900Z'), pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE });
    assert.equal(push.seen.length, 2);
    assert.equal(push.seen[0].body.dedupe_key, 'notify-1792402680');
    assert.equal(push.seen[1].body.dedupe_key, 'notify-1792402680');
    assert.equal(push.seen[1].body.body, '2 ממתינות לתשובה');
    assert.equal(push.seen[1].body.app_badge, 2);
    const third = sequenceOf('2026-10-19', 'פיזיקה');
    await handleDelivery(messageFor(third), {}, { sql, now: () => new Date('2026-10-19T09:39:00.000Z'), pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE });
    assert.equal(push.seen[2].body.dedupe_key, 'notify-1792402740');
    assert.equal(planNotify(new Date('2026-10-19T09:39:00.000Z')).slotKey, 'notify-1792402740');
  });

  test('פרטיות (קריטריון 14): גוף ההתראה שווה לנוסח הכללי, ושם המקצוע לא מופיע בגוף הדחיפה, ב-probe_log ובקונסול', async (t) => {
    const cap = captureConsole(t);
    const sql = homeworkDb();
    const push = fakePush();
    await run(sql, push);
    await run(sql, push);
    assert.ok(['שאלה אחת ממתינה', 'הודעה חדשה'].includes(push.seen[0].body.body) || /^\d+ ממתינות לתשובה$/.test(push.seen[0].body.body));
    assert.deepEqual(Object.keys(push.seen[0].body).sort(), ['app_badge', 'body', 'dedupe_key', 'navigate', 'title']);
    const leaked = [JSON.stringify(push.seen.map((p) => p.body)), JSON.stringify(sql.db.probe), cap.text(), push.seen[0].request.url];
    for (const text of leaked) assert.ok(!text.includes(SUBJECT), 'שם מקצוע');
    assert.ok(!JSON.stringify(sql.db.probe).includes(FAKE_CRON));
    assert.ok(!cap.text().includes(FAKE_CRON));
    assert.equal(cap.lines.length, 0, 'הצלחה לא כותבת ללוג');
  });

  test('כשל בדחיפה (סטטוס או זריקה): לא נזרק, השאלה נשארת, ok=false ב-probe_log, והלוג רק עם שם השגיאה', async (t) => {
    const cap = captureConsole(t);
    const sqlA = homeworkDb();
    const outA = await run(sqlA, fakePush(500));
    assert.equal(outA.created, true);
    assert.equal(outA.ok, false);
    assert.equal(sqlA.db.asks.length, 1);
    assert.equal(probeRows(sqlA, 'chat-notify')[0].values[0], false);
    assert.match(probeRows(sqlA, 'chat-notify')[0].values[1], /sent=false; reason=push-status; push_status=500$/);
    const sqlB = homeworkDb();
    const boom = fakePush(() => { throw Object.assign(new Error(`${SUBJECT} ${FAKE_CRON}`), { name: 'BoomError' }); });
    const outB = await run(sqlB, boom);
    assert.equal(outB.created, true);
    assert.equal(outB.ok, false);
    assert.match(probeRows(sqlB, 'chat-notify')[0].values[1], /reason=push-error/);
    assert.ok(!cap.text().includes(SUBJECT));
    assert.ok(!cap.text().includes(FAKE_CRON));
    assert.match(cap.text(), /BoomError/);
  });

  test('כשל מסד בקריאת מצב ההתראה אחרי שהשאלה נוצרה: לא נזרק (אחרת הניסיון החוזר לא יראה שאלה חדשה), נרשם reason=error', async (t) => {
    const cap = captureConsole(t);
    const sql = homeworkDb();
    const broken = Object.assign(async (strings, ...values) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      if (text.includes('has_unseen')) throw Object.assign(new Error(`db ${SUBJECT}`), { name: 'NeonDbError' });
      return sql(strings, ...values);
    }, {});
    const out = await run(broken, fakePush());
    assert.equal(out.created, true);
    assert.equal(out.ok, false);
    assert.equal(sql.db.asks.length, 1);
    assert.match(probeRows(sql, 'chat-notify')[0].values[1], /created=true; badge=null; sent=false; reason=error$/);
    assert.deepEqual(cap.lines, ['queue-deliver: התראת שיעורי הבית נכשלה: NeonDbError']);
  });

  test('בלי סוד בשרת: השאלה נוצרת, לא נשלחת דחיפה, reason=no-secret', async () => {
    const sql = homeworkDb();
    const push = fakePush();
    const out = await run(sql, push, MATH_MSG, { secret: '' });
    assert.equal(out.created, true);
    assert.equal(push.seen.length, 0);
    assert.match(probeRows(sql, 'chat-notify')[0].values[1], /reason=no-secret$/);
  });

  test('רצף שאין לו שורה בטבלה (מפתח של מקצוע פטור, או של יום בלי שיעורים): מאושר בלי שאלה ובלי התראה, ובלי שם מקצוע בלוג', async (t) => {
    const cap = captureConsole(t);
    for (const [slotKey, targetAt] of [['homework-2026-10-20-3', '2026-10-20T07:53:00.000Z'], ['homework-2026-10-23-1', '2026-10-23T06:03:00.000Z']]) {
      const sql = homeworkDb();
      const push = fakePush();
      const out = await handleDelivery({ kind: 'homework', slotKey, targetAt }, {}, { sql, now: () => new Date(targetAt), pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE });
      assert.equal(out.stored, true);
      assert.equal(out.created, false);
      assert.equal(out.reason, 'no-sequence');
      assert.equal(sql.db.asks.length, 0);
      assert.equal(push.seen.length, 0);
    }
    assert.ok(!cap.text().includes('כישורי'));
  });

  test('מערכת השעות לא נטענה (null): נזרק כדי שהתור ינסה שוב, ולא נוצרת שאלה', async () => {
    const sql = homeworkDb();
    await assert.rejects(() => run(sql, fakePush(), MATH_MSG, { timetable: null }), /homework/);
    assert.equal(sql.db.asks.length, 0);
  });

  test('בלי timetable מוזרק: נטענת מהמסד (loadTimetable); טבלה ריקה = נזרק לניסיון חוזר', async (t) => {
    captureConsole(t);
    const sql = homeworkDb();
    await assert.rejects(() => run(sql, fakePush(), MATH_MSG, { timetable: undefined }), /homework/);
    assert.equal(sql.find('FROM timetable_slots').length, 1);
  });

  test('כשל מסד ביצירת השאלה נזרק (התור ינסה שוב; היצירה אידמפוטנטית)', async () => {
    const sql = homeworkDb();
    const broken = Object.assign(async (strings, ...values) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      if (text.startsWith('WITH a AS')) throw new Error('db down');
      return sql(strings, ...values);
    }, {});
    const push = fakePush();
    await assert.rejects(() => run(broken, push), /db down/);
    assert.equal(push.seen.length, 0);
  });

  test('הודעה פגומה (יעד בתאריך אחר מהמפתח): נדחית לפני כל קריאה למסד', async (t) => {
    captureConsole(t);
    const sql = homeworkDb();
    const push = fakePush();
    const out = await handleDelivery({ kind: 'homework', slotKey: 'homework-2026-10-18-7', targetAt: '2026-10-19T11:18:00.000Z' }, {}, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON, timetable: TIMETABLE });
    assert.equal(out.stored, false);
    assert.equal(sql.calls.length, 0);
    assert.equal(push.seen.length, 0);
  });
});

describe('היקף השינוי: אין קובץ api חדש, אין שינוי ב-api/intake.js וב-vercel.json, ובלי חבילה חדשה', () => {
  test('בקבצים החדשים אין מחיקה פיזית (DELETE) ואין סוד', () => {
    for (const file of ['../lib/homework-schedule.js', '../lib/homework-view.js']) {
      const code = readFileSync(new URL(file, import.meta.url), 'utf8').split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n');
      assert.ok(!/\bDELETE\b/i.test(code), file);
      assert.ok(!/process\.env|fetch\(/.test(code), file);
    }
  });
  test('package.json ללא @vercel/blob', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@neondatabase/serverless', '@vercel/queue', 'web-push']);
  });
});
