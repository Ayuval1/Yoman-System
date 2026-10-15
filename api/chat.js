// נקודת הצ'אט (שלב 8.2א-1). מקור: docs/08-chapter8/47-chapter8-step-8-2a-spec.md, "החוזה של נקודת הצ'אט החדשה"; 35, D1-D4 ו"גבולות" (chat.js אושר ב-8.2א).
// הצרכן היחיד: דף האפליקציה (שלב 8.2א-2). הודעה חדשה שיובל מקליד לא נשלחת לכאן אלא ל-api/intake.js עם channel=app.
//
//   GET                                               -> { items, pending, badge, review }   (review = סיכום היום, M.2: { total, items }; ראו lib/review-view.js ו-57)
//   POST { action: 'answer', message_id, answer }     -> { status, items, pending, badge }   (items = רק מה שנוצר בתשובה הזו)
//   POST { action: 'read', message_ids }              -> { badge }                          (מסמן רק בועות update יוצאות שלא נקראו, מתוך המזהים שנשלחו)
//   POST { action: 'check', outcome_id, verdict, event_type? } -> { status: 'checked' | 'closed', review, badge }   (M.2: שורה אחת ב-intake_checks; closed = לא ניתן לסימון עכשיו, לא נכתב דבר)
//
// הגנה: אותו מנגנון כמו api/intake.js: סוד בכותרת x-intake-secret מול INTAKE_SECRET, השוואה בזמן קבוע, ונכשל סגור כשהסוד לא מוגדר.
// סדר הבדיקות כמו שם: שיטה (405), סוד (401), גוף (400). כשל מסד = 500. גוף כל שגיאה שהדף מציג: "לא נשלח, נסה שוב." (47).
// פרטיות: אין טקסט הודעות בלוגים (רק שם שגיאה), ואין קריאת מודל או רשת. ה-GET מחזיר את טקסט ההודעות לסיכום היום (57 T11), לתצוגה באפליקציה בלבד. הלוגיקה שנבדקת יושבת ב-lib/chat-view.js.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { answerQuestion } from '../lib/intake-process.js';
import { loadTimetable } from '../lib/timetable.js';
import { countReviewDue, loadReview, writeCheck } from '../lib/review-view.js';
import { CHAT_ITEMS_LIMIT, ERROR_TEXT, itemsFromRows, pendingFromRows, badgeFrom, parseChatAction } from '../lib/chat-view.js';

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

// השאלות הפתוחות (הוותיקה קודם), עם המקור שלהן, העובדות שלו ומערכת השעות, כדי לגזור כפתורים (pendingQuestion).
async function loadPending(sql, timetable) {
  const questions = rowsOf(await sql`
    SELECT m.id, m.body, m.sent_at, s.id AS source_id, s.channel, s.raw_content, s.content_hash, s.received_at
    FROM messages m
    LEFT JOIN sources s ON m.entity_type = 'source' AND s.id = m.entity_id
    WHERE m.kind = 'question' AND m.awaiting_reply = true
    ORDER BY m.sent_at ASC NULLS LAST, m.id ASC
  `);
  if (questions.length === 0) return [];
  const facts = rowsOf(await sql`
    SELECT f.source_id, f.field, f.value, f.origin
    FROM facts f
    WHERE f.source_id IN (SELECT m.entity_id FROM messages m WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'source')
  `);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null, והכפתורים בלי מערכת השעות
  return pendingFromRows({ questions, facts, timetable: table });
}

// המספר על האייקון (D4): שאלות פתוחות + בועות update יוצאות שלא נקראו, ובנוסף סיכום היום כפריט ממתין אחד כשיש הודעות לסימון (57 T8).
// נספר בשאילתות נפרדות, לא מתוך 50 הפריטים. הסיכום נספר ב-countReviewDue, אותה פונקציה כמו ב-lib/chat-notify.js (המספר חייב להיות זהה).
async function loadBadge(sql, now) {
  const [row] = rowsOf(await sql`
    SELECT
      (SELECT count(*) FROM messages WHERE kind = 'question' AND awaiting_reply = true)::int AS pending,
      (SELECT count(*) FROM messages WHERE direction = 'out' AND kind = 'update' AND read_at IS NULL)::int AS unread
  `);
  const review = await countReviewDue(sql, now);
  return badgeFrom({ ...(row ?? {}), review });
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

// handle מקבל את ה-DB מבחוץ (deps.sql) כדי שאפשר לבדוק בלי מסד אמיתי. timetable (אופציונלי, לבדיקות): מערכת שעות במקום טעינה מהמסד.
export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME], timetable, now = () => new Date() } = {}) {
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
      const pending = await loadPending(sql, timetable);
      const review = await loadReview(sql, now());
      const badge = await loadBadge(sql, now());
      return json({ items, pending, badge, review });
    }
    if (action.action === 'read') {
      await markRead(sql, action.messageIds);
      return json({ badge: await loadBadge(sql, now()) });
    }
    if (action.action === 'check') {
      // פקודת כתיבה אחת (או כלום). closed = ה-outcome אינו ניתן לסימון עכשיו (פקע, חדש מדי, כפילות, תצוגה אחרת, נציג אחר או לא קיים). 57 T6.
      const written = await writeCheck(sql, { outcomeId: action.outcomeId, verdict: action.verdict, eventType: action.eventType }, now());
      const review = await loadReview(sql, now());
      const badge = await loadBadge(sql, now());
      return json({ status: written ? 'checked' : 'closed', review, badge });
    }
    // answer: closed ו-unclear לא כותבים כלום (47 קריטריון 6), ולכן אין פריטים חדשים.
    const result = await answerQuestion({ sql, messageId: action.messageId, answer: action.answer, timetable });
    const items = result.status === 'answered' ? await loadCreatedItems(sql, result.created ?? {}) : [];
    const pending = await loadPending(sql, timetable);
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
