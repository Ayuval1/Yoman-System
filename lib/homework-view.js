// שאלת שיעורי הבית בצד השרת (שלב 8.6-1; מפרט: docs/08-chapter8/60-chapter8-step-8-6-spec.md): יצירת השאלה, תשובה (פעולה homework), סימון "בוצע" (task_done)
// ורשימת הפתוחות (open_tasks). הלוגיקה הטהורה של רצפים ותאריכים ב-lib/homework-schedule.js; כאן הכתיבה והקריאה במסד.
// כל כתיבה היא פקודה אחת (CTE) עם עדכון מותנה, כדי שלחיצה כפולה או הגעה כפולה של התור לא ייצרו שורה שנייה. אין מחיקה פיזית.
// פרטיות: שום לוג כאן; שם המקצוע נשמר רק בטבלאות (lesson_asks, tasks) ולא בהתראה, בגוף ההודעה או ב-probe_log.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה; ההוכחה החיה היא בהרצה של יובל (קריטריון 4).
import { localDateIso } from './intake-dates.js';
import { loadTimetable } from './timetable.js';
import { toIso } from './chat-view.js';
import { expiresAtFor, nextLesson, TIME_ZONE } from './homework-schedule.js';

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// גוף הודעת השאלה ב-messages.body. כללי בכוונה (בלי שם מקצוע): הכרטיס עצמו נבנה מ-lesson_asks. (מפרט 60 סעיף 4)
export const ASK_BODY = 'היו שיעורי בית?';
// הנחה, לא אומת: כותרת המשימה "שיעורי בית · <מקצוע>". אף מסמך לא קובע את הכותרת.
export const taskTitle = (subject) => `שיעורי בית · ${subject}`;

// יוצר שאלה אחת לרצף: שורה ב-lesson_asks ושורה ב-messages (kind='question', awaiting_reply=true, entity_type='lesson_ask'), בפקודה אחת.
// ON CONFLICT DO NOTHING על (subject, lesson_date, seq_start_period): הגעה כפולה לא יוצרת כלום, ואז created=false.
// sequence: פריט מ-sequenceFromKey / sequencesForDate. כשל מסד נזרק (התור ינסה שוב).
// missed (שלב 8.3-2, ברירת מחדל false): true כשיובל יצא מוקדם ופספס את הרצף; נשמר ב-lesson_asks.missed והכרטיס מציג "פספסת שיעור ...".
export async function createLessonAsk({ sql, sequence, timetable, missed = false }) {
  const expiresAt = expiresAtFor(sequence.lessonDate, { timetable, subject: sequence.subject }).toISOString();
  const [row] = rowsOf(await sql`
    WITH a AS (
      INSERT INTO lesson_asks (subject, lesson_date, seq_start_period, seq_end_at, missed)
      VALUES (${sequence.subject}::text, ${sequence.lessonDate}::date, ${sequence.startPeriod}::integer, ${sequence.endAt.toISOString()}::timestamptz, ${missed === true}::boolean)
      ON CONFLICT (subject, lesson_date, seq_start_period) DO NOTHING
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${ASK_BODY}::text, 'question', now(), true, NULL::uuid, ${expiresAt}::timestamptz, 'lesson_ask', a.id, 1 FROM a
      RETURNING id
    )
    SELECT (SELECT id FROM a) AS ask_id, (SELECT id FROM m) AS message_id
  `);
  return { created: Boolean(row?.ask_id), askId: row?.ask_id ?? null, messageId: row?.message_id ?? null };
}

// פעולה homework: { status, taskId }.
//  - closed: השאלה לא קיימת, כבר נסגרה (לחיצה כפולה), פגה, או נסגרה בלחיצה מקבילה. לא נכתב כלום.
//  - unclear: had=true אבל אי אפשר לחשב תאריך (מערכת שעות לא זמינה, המקצוע לא נמצא, או שתאריך "השיעור הבא" כבר עבר). לא נכתב כלום והשאלה נשארת פתוחה.
//  - answered: נכתב. taskId מלא רק כשנוצרה משימה (had=true).
// due_at מחושב כאן מ-lesson_asks ומהטבלה, לא מהלקוח. had=false: אין משימה, והנושא נשמר אם הוקלד.
export async function answerHomework({ sql, messageId, had, topic = null, timetable, now = new Date() }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT m.id, m.awaiting_reply, la.subject, la.lesson_date::text AS lesson_date
    FROM messages m
    JOIN lesson_asks la ON m.entity_type = 'lesson_ask' AND la.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return { status: 'closed', taskId: null };

  let dueIso = null;
  if (had) {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null
    const next = table ? nextLesson(table, ask.subject, ask.lesson_date) : null;
    if (!next || next.date < localDateIso(now, TIME_ZONE)) return { status: 'unclear', taskId: null };
    dueIso = next.dueAt.toISOString();
  }

  // סגירה מותנית (WHERE awaiting_reply = true): משימה נוצרת רק אם העדכון שינה שורה. לחיצה כפולה: closed=0 ולא נכתב כלום.
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'lesson_ask'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING entity_id
    ), t AS (
      INSERT INTO tasks (title, due_at, domain, status, subject)
      SELECT ${taskTitle(ask.subject)}::text, ${dueIso}::timestamptz, 'homework', 'open', ${ask.subject}::text
      FROM closed
      WHERE ${had}::boolean
      RETURNING id
    ), a AS (
      UPDATE lesson_asks SET had_homework = ${had}::boolean, topic = ${topic}::text, status = 'answered', task_id = (SELECT id FROM t)
      WHERE id IN (SELECT entity_id FROM closed)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM t) AS task_id
  `);
  if (Number(written?.closed) === 0) return { status: 'closed', taskId: null };
  return { status: 'answered', taskId: written?.task_id ?? null };
}

// פעולה task_done: קובעת done רק למשימה פתוחה. true = השתנתה שורה; false = לא קיימת או כבר לא פתוחה (לחיצה כפולה). משימה אחרת לא מושפעת.
export async function markTaskDone(sql, taskId) {
  const rows = rowsOf(await sql`
    UPDATE tasks SET status = 'done' WHERE id = ${taskId}::uuid AND status = 'open' RETURNING id
  `);
  return rows.length > 0;
}

// שורה מהמסד -> פריט ברשימת "פתוחות": { id, title, subject?, due_at?, media_count }. שדה ריק לא נכלל.
export function openTaskFromRow(row) {
  const item = { id: row.id, title: row.title ?? '' };
  if (typeof row.subject === 'string' && row.subject !== '') item.subject = row.subject;
  const dueAt = toIso(row.due_at);
  if (dueAt) item.due_at = dueAt;
  const media = Number(row.media_count);
  item.media_count = Number.isInteger(media) && media > 0 ? media : 0;
  return item;
}

// רשימת הפתוחות (מפרט 60 סעיף 11): tasks עם status='open', לפי due_at (בלי תאריך בסוף), ואז created_at, ואז id (סדר יציב).
export async function loadOpenTasks(sql) {
  const rows = rowsOf(await sql`
    SELECT t.id, t.title, t.subject, t.due_at, (SELECT count(*) FROM media md WHERE md.task_id = t.id)::int AS media_count
    FROM tasks t
    WHERE t.status = 'open'
    ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC NULLS LAST, t.id ASC
  `);
  return rows.map(openTaskFromRow);
}
