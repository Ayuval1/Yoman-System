// נקודת הצ'אט (שלב 8.2א-1). מקור: docs/08-chapter8/47-chapter8-step-8-2a-spec.md, "החוזה של נקודת הצ'אט החדשה"; 35, D1-D4 ו"גבולות" (chat.js אושר ב-8.2א).
// הצרכן היחיד: דף האפליקציה (שלב 8.2א-2). הודעה חדשה שיובל מקליד לא נשלחת לכאן אלא ל-api/intake.js עם channel=app.
//
//   GET                                               -> { items, pending, badge, review }   (review = סיכום היום, M.2: { total, items, exam_line }; exam_line = שורת מבחן של הערב (B-3) או null; ראו lib/review-view.js ו-57)
//   POST { action: 'answer', message_id, answer }     -> { status, items, pending, badge }   (items = רק מה שנוצר בתשובה הזו)
//   POST { action: 'read', message_ids }              -> { badge }                          (מסמן רק בועות update יוצאות שלא נקראו, מתוך המזהים שנשלחו)
//   POST { action: 'check', outcome_id, verdict, event_type? } -> { status: 'checked' | 'closed', review, badge }   (M.2: שורה אחת ב-intake_checks; closed = לא ניתן לסימון עכשיו, לא נכתב דבר)
//   שלב 8.6-1 (docs/08-chapter8/60): GET מחזיר גם open_tasks, ו-pending יכול לכלול פריט { kind: 'homework', ... }.
//   POST { action: 'homework', message_id, had, topic?, due? } -> { status: 'answered' | 'closed' | 'unclear', task_id, pending, open_tasks, badge }   (task_id רק כשנוצרה משימה; closed = כבר נסגרה, לא נכתב דבר)
//   POST { action: 'task_done', task_id } -> { status: 'done' | 'closed', open_tasks, badge }   (closed = המשימה לא קיימת או כבר לא פתוחה)
//   שלב B-3ב (docs/08-chapter8/68, H13): pending יכול לכלול פריט { kind: 'exam', exam_date, exam_type, buttons: [{ answer }] } (שאלת "איזה מקצוע במדעים?").
//   POST { action: 'exam', message_id, answer: 'פיזיקה' | 'כימיה' | 'אחר' } -> { status: 'answered' | 'closed', pending, badge, review }   (closed = כבר נסגרה / פגה / לא קיימת, לא נכתב דבר; review מחושב מחדש כדי שהפס יתעדכן)
//   כרטיס הבריף החי (docs/08-chapter8/68, 21.10.2026): GET, homework ו-task_done מחזירים גם brief = null לפני 07:30 שעון ישראל, אחרת { dateIso, title, school, schoolLessons, schoolStartsAt, schoolEndsAt, schoolDay, exams, freeDay, text } (lib/brief-view.js, briefCardData; schoolDay: true/false/null = לא ידוע, מערכת שעות חסרה). כשל בבנייתו לא שובר את התשובה: brief = null.
//
// הגנה: אותו מנגנון כמו api/intake.js: סוד בכותרת x-intake-secret מול INTAKE_SECRET, השוואה בזמן קבוע, ונכשל סגור כשהסוד לא מוגדר.
// סדר הבדיקות כמו שם: שיטה (405), סוד (401), גוף (400). כשל מסד = 500. גוף כל שגיאה שהדף מציג: "לא נשלח, נסה שוב." (47).
// פרטיות: אין טקסט הודעות בלוגים (רק שם שגיאה), ואין קריאת מודל. רשת: רק הכתיבה ליומן Google אחרי תשובה (שלב 8.3-4, lib/event-sync.js). ה-GET מחזיר את טקסט ההודעות לסיכום היום (57 T11), לתצוגה באפליקציה בלבד. הלוגיקה שנבדקת יושבת ב-lib/chat-view.js.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { answerQuestion } from '../lib/intake-process.js';
import { syncEventAfterAnswer } from '../lib/event-sync.js';
import { answerHomework, loadOpenTasks, markTaskDone } from '../lib/homework-view.js';
import { answerExam, loadExamAnswers } from '../lib/exam-ask.js';
import { countReviewDue, loadReview, writeCheck } from '../lib/review-view.js';
import { CHAT_ITEMS_LIMIT, ERROR_TEXT, itemsFromRows, badgeFrom, parseChatAction } from '../lib/chat-view.js';
import { loadPending } from '../lib/chat-pending.js';
import { loadTimetable } from '../lib/timetable.js';
import { examLineAt } from '../lib/exam-line.js';
import { briefCardData } from '../lib/brief-view.js';

const SECRET_HEADER = 'x-intake-secret';
const SECRET_ENV_NAME = 'INTAKE_SECRET';
// הנחה, לא אומת: תקרת גודל לגוף POST (תווים). תשובה עד 1,000 תווים, או עד 100 מזהים (כ-4,000 תווים), נכנסות בה בשפע.
const MAX_BODY_CHARS = 16_384;

const rowsOf = (result) => (Array.isArray(result) ? result : []);

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

// הנחה, לא אומת: cache-control: no-store, כדי שהמצב (שאלות, מספר) לא יוגש מזיכרון מטמון בין רענונים. אף מסמך לא קובע.
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// 50 הפריטים האחרונים: הודעות שלך (sources בערוצי shortcut ו-app, כולל שורות תשובה) ובועות מערכת (messages יוצאות מסוג update). שאלות אינן פריטים.
// הסדר: זמן, ובשוויון הודעת משתמש לפני בועת מערכת ואחריה המזהה (lib/chat-view.js, compareItems), כאן הפוך כדי לבחור את האחרונים.
async function loadItems(sql) {
  const rows = await sql`
    SELECT x.role, x.id, x.text, x.at, x.channel, x.read_at
    FROM (
      SELECT 'user' AS role, 0 AS rank, s.id, s.raw_content AS text, s.received_at AS at, s.channel, NULL::timestamptz AS read_at
      FROM sources s
      WHERE s.channel IN ('shortcut', 'app')
      UNION ALL
      SELECT 'system' AS role, 1 AS rank, m.id, m.body AS text, m.sent_at AS at, NULL::text AS channel, m.read_at
      FROM messages m
      WHERE m.direction = 'out' AND m.kind = 'update'
    ) x
    ORDER BY x.at DESC NULLS LAST, x.rank DESC, x.id DESC
    LIMIT ${CHAT_ITEMS_LIMIT}::int
  `;
  return itemsFromRows(rowsOf(rows));
}

// הפריטים שנוצרו בתשובה אחת: שורת התשובה ב-sources והבועה (אם נכתבה). מזהה ריק לא מחזיר שורה.
async function loadCreatedItems(sql, { answerSourceId, bubbleId }) {
  if (!answerSourceId && !bubbleId) return [];
  const rows = await sql`
    SELECT 'user' AS role, s.id, s.raw_content AS text, s.received_at AS at, s.channel, NULL::timestamptz AS read_at
    FROM sources s
    WHERE s.id = ${answerSourceId}::uuid
    UNION ALL
    SELECT 'system' AS role, m.id, m.body AS text, m.sent_at AS at, NULL::text AS channel, m.read_at
    FROM messages m
    WHERE m.id = ${bubbleId}::uuid AND m.direction = 'out' AND m.kind = 'update'
  `;
  return itemsFromRows(rowsOf(rows));
}

// השאלות הפתוחות (loadPending) הועברו ל-lib/chat-pending.js בשלב B-1, כדי שגם הבריף של הבוקר ישתמש בהן.

// המספר על האייקון (D4): שאלות פתוחות (שלא פגו) + בועות update יוצאות שלא נקראו, ובנוסף סיכום היום כפריט ממתין אחד כשיש הודעות לסימון (57 T8),
// ופריטים פתוחים (tasks עם status='open', כל אחד 1; שלב 8.6-1, הכרעת יובל 16.10.2026 "ב"). שאלה ש-expires_at שלה עבר לא נספרת (מפרט 60 סעיף 13).
// נספר בשאילתות נפרדות, לא מתוך 50 הפריטים. הסיכום נספר ב-countReviewDue, אותה פונקציה כמו ב-lib/chat-notify.js (המספר חייב להיות זהה).
async function loadBadge(sql, now) {
  const nowIso = now.toISOString();
  const [row] = rowsOf(await sql`
    SELECT
      (SELECT count(*) FROM messages WHERE kind = 'question' AND awaiting_reply = true AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz))::int AS pending,
      (SELECT count(*) FROM messages WHERE direction = 'out' AND kind = 'update' AND read_at IS NULL)::int AS unread,
      (SELECT count(*) FROM tasks WHERE status = 'open')::int AS open_tasks
  `);
  const review = await countReviewDue(sql, now);
  return badgeFrom({ pending: row?.pending, unread: row?.unread, openTasks: row?.open_tasks, review });
}

// סימון כנקראו: רק בועות update יוצאות שעדיין לא נקראו, ורק מתוך המזהים שנשלחו (47 קריטריון 13). המזהים עוברים כ-JSON ומפורקים ב-SQL.
async function markRead(sql, messageIds) {
  if (messageIds.length === 0) return;
  await sql`
    UPDATE messages SET read_at = now()
    WHERE id IN (SELECT t.id::uuid FROM jsonb_array_elements_text(${JSON.stringify(messageIds)}::jsonb) AS t(id))
      AND direction = 'out' AND kind = 'update' AND read_at IS NULL
  `;
}

// כרטיס הבריף החי (briefCardData). לעולם לא זורק: כל כשל (מערכת שעות, שאלות, חישוב) = null והתשובה הקיימת נשארת שלמה. בלוג רק שם השגיאה.
// pending (אופציונלי): כשכבר נטען בבקשה. בלעדיו (task_done) נטען כאן, בתוך ה-try.
async function buildBrief({ sql, timetable, tasks, pending, now }) {
  try {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null (בלי שורת בית ספר)
    const questions = pending === undefined ? await loadPending(sql, table, now) : pending;
    const answers = await loadExamAnswers(sql); // לא זורק: כשל = מפה ריקה
    return briefCardData({ now, timetable: table, tasks, pending: questions, answers });
  } catch (error) {
    console.error('chat: בניית הבריף נכשלה:', error?.name);
    return null;
  }
}

// סיכום היום + שורת המבחן של הערב (B-3, PRD 68 D11): review = { total, items, exam_line }. exam_line = examLineAt (מחרוזת או null).
// לא משנה את badge: שורת מבחן בלי הודעות אינה נספרת באייקון. לא זורק על חלק השורה: כל כשל (מערכת שעות, חישוב) = exam_line: null או שורה בלי שעה.
async function reviewWithExamLine(sql, timetable, now) {
  const review = await loadReview(sql, now);
  let table = null;
  try {
    table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null (בלי שעה)
  } catch {
    table = null;
  }
  let examLine = null;
  try {
    examLine = examLineAt(now, { timetable: table, answers: await loadExamAnswers(sql) }); // loadExamAnswers לא זורק: כשל = מפה ריקה (שורה בלי שם המקצוע)
  } catch (error) {
    console.error('chat: חישוב שורת המבחן נכשל:', error?.name);
  }
  return { ...review, exam_line: examLine };
}

// handle מקבל את ה-DB מבחוץ (deps.sql) כדי שאפשר לבדוק בלי מסד אמיתי. timetable (אופציונלי, לבדיקות): מערכת שעות במקום טעינה מהמסד.
// eventSync (אופציונלי, לבדיקות): הכתיבה ליומן Google אחרי תשובה (שלב 8.3-4, lib/event-sync.js).
export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME], timetable, now = () => new Date(), eventSync = syncEventAfterAnswer } = {}) {
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) return reply(401, 'Unauthorized');

  let action = null;
  if (request.method === 'POST') {
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY_CHARS) return reply(400, ERROR_TEXT);
      body = JSON.parse(text);
    } catch {
      return reply(400, ERROR_TEXT);
    }
    action = parseChatAction(body);
    if (!action.ok) return reply(400, ERROR_TEXT);
  }

  try {
    if (action === null) {
      const items = await loadItems(sql);
      const pending = await loadPending(sql, timetable, now());
      const review = await reviewWithExamLine(sql, timetable, now());
      const badge = await loadBadge(sql, now());
      const openTasks = await loadOpenTasks(sql);
      const brief = await buildBrief({ sql, timetable, tasks: openTasks, pending, now: now() });
      return json({ items, pending, badge, review, open_tasks: openTasks, brief });
    }
    if (action.action === 'read') {
      await markRead(sql, action.messageIds);
      return json({ badge: await loadBadge(sql, now()) });
    }
    if (action.action === 'check') {
      // פקודת כתיבה אחת (או כלום). closed = ה-outcome אינו ניתן לסימון עכשיו (פקע, חדש מדי, כפילות, תצוגה אחרת, נציג אחר או לא קיים). 57 T6.
      const written = await writeCheck(sql, { outcomeId: action.outcomeId, verdict: action.verdict, eventType: action.eventType }, now());
      const review = await reviewWithExamLine(sql, timetable, now());
      const badge = await loadBadge(sql, now());
      return json({ status: written ? 'checked' : 'closed', review, badge });
    }
    if (action.action === 'homework') {
      // שאלת שיעורי בית: פקודת כתיבה אחת (או כלום). closed = כבר נסגרה / פגה / לא קיימת; unclear = אי אפשר לחשב תאריך. 60 סעיף 14.
      const result = await answerHomework({ sql, messageId: action.messageId, had: action.had, topic: action.topic, timetable, now: now() });
      const pending = await loadPending(sql, timetable, now());
      const openTasks = await loadOpenTasks(sql);
      const badge = await loadBadge(sql, now());
      const brief = await buildBrief({ sql, timetable, tasks: openTasks, pending, now: now() });
      return json({ status: result.status, task_id: result.taskId, pending, open_tasks: openTasks, badge, brief });
    }
    if (action.action === 'exam') {
      // שאלת "איזה מקצוע במדעים?": פקודת כתיבה אחת (או כלום). closed = כבר נסגרה / פגה / לא קיימת. review מחושב מחדש, כי השורה בפס תלויה בתשובה.
      const result = await answerExam({ sql, messageId: action.messageId, answer: action.answer, now: now() });
      const pending = await loadPending(sql, timetable, now());
      const badge = await loadBadge(sql, now());
      const review = await reviewWithExamLine(sql, timetable, now());
      return json({ status: result.status, pending, badge, review });
    }
    if (action.action === 'task_done') {
      const done = await markTaskDone(sql, action.taskId);
      const openTasks = await loadOpenTasks(sql);
      const badge = await loadBadge(sql, now());
      const brief = await buildBrief({ sql, timetable, tasks: openTasks, now: now() });
      return json({ status: done ? 'done' : 'closed', open_tasks: openTasks, badge, brief });
    }
    // answer: closed ו-unclear לא כותבים כלום (47 קריטריון 6), ולכן אין פריטים חדשים.
    const result = await answerQuestion({ sql, messageId: action.messageId, answer: action.answer, timetable });
    // כתיבה ליומן Google (שלב 8.3-4): רק כשהתשובה נכתבה למסד, ולאירוע של המקור של השאלה הזו בלבד (יצירה, עדכון אחרי תיקון, או מחיקה אחרי "לא קורה").
    // כל כשל נתפס ולא משנה את התשובה.
    if (result.status === 'answered') {
      try {
        await eventSync({ sql, messageId: action.messageId, now: now() });
      } catch (error) {
        console.error('chat: כתיבה ליומן נכשלה:', error?.name);
      }
    }
    const items = result.status === 'answered' ? await loadCreatedItems(sql, result.created ?? {}) : [];
    const pending = await loadPending(sql, timetable, now());
    const badge = await loadBadge(sql, now());
    return json({ status: result.status, items, pending, badge });
  } catch (error) {
    // רק שם השגיאה: לא message (עלול לכלול ערכים מהמסד) ולא טקסט הודעה.
    console.error('chat: פעולה נכשלה:', error?.name);
    return reply(500, ERROR_TEXT);
  }
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    // החיבור למסד נוצר רק כשצריך, כדי שדחייה של בקשה (401/405) לא תלויה ב-DATABASE_URL.
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
