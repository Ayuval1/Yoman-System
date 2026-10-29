// השאלות הפתוחות של הצ'אט, מועברות מ-api/chat.js ל-lib/ (שלב B-1, docs/08-chapter8/68) כדי שגם הבריף של הבוקר (api/queues/deliver.js) ישתמש בהן. ההתנהגות והשאילתות לא השתנו.
import { loadTimetable } from './timetable.js';
import { localDateIso } from './intake-dates.js';
import { pendingFromRows } from './chat-view.js';

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// השאלות הפתוחות (הוותיקה קודם), עם המקור שלהן, העובדות שלו ומערכת השעות, כדי לגזור כפתורים (pendingQuestion).
// שלב 8.6-1: שאלה ש-expires_at שלה עבר לא מוחזרת (מפרט 60 סעיף 13), ושאלת שיעורי בית (entity_type='lesson_ask') מגיעה עם המקצוע והתאריך מ-lesson_asks.
// lesson_date::text כדי לקבל YYYY-MM-DD ולא אובייקט Date של הדרייבר.
// period: מספר השיעור שבו התחיל הרצף (lesson_asks.seq_start_period), לשורת המקור בכרטיס השאלה (הכרעת יובל 29.10.2026).
export async function loadPending(sql, timetable, now) {
  const nowIso = now.toISOString();
  const questions = rowsOf(await sql`
    SELECT m.id, m.body, m.sent_at, m.entity_type, s.id AS source_id, s.channel, s.raw_content, s.content_hash, s.received_at,
           la.subject AS subject, la.lesson_date::text AS lesson_date, la.missed AS missed, la.seq_start_period AS period
    FROM messages m
    LEFT JOIN sources s ON m.entity_type = 'source' AND s.id = m.entity_id
    LEFT JOIN lesson_asks la ON m.entity_type = 'lesson_ask' AND la.id = m.entity_id
    WHERE m.kind = 'question' AND m.awaiting_reply = true AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
    ORDER BY m.sent_at ASC NULLS LAST, m.id ASC
  `);
  if (questions.length === 0) return [];
  const openQuestions = await withExamFields(sql, questions);
  const facts = rowsOf(await sql`
    SELECT f.source_id, f.field, f.value, f.origin
    FROM facts f
    WHERE f.source_id IN (SELECT m.entity_id FROM messages m WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'source')
  `);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null, והכפתורים בלי מערכת השעות
  return pendingFromRows({ questions: openQuestions, facts, timetable: table, today: localDateIso(now, 'Asia/Jerusalem') });
}

// שאלות "איזה מקצוע במדעים?" (שלב B-3ב, 68 H13): התאריך והסוג יושבים ב-exam_asks. השאילתה הראשית לא נוגעת בטבלה הזו (בלי JOIN), כדי שטבלה שלא נוצרה עדיין לא תשבור את כל הצ'אט.
// שאילתה נפרדת רצה רק כשיש שורת exam_ask פתוחה, ושורה כזו נוצרת רק באותה פקודה שיוצרת את exam_asks, ולכן הטבלה קיימת. ועדיין: כשל נתפס (רק שם השגיאה בלוג),
// ושאלות exam_ask מוסרות מהרשימה (במקום להציג אותן כשאלה כללית עם "לא יודע"); שאר השאלות נשארות. הנחה, לא אומת: השיקול הזה אינו במפרט.
async function withExamFields(sql, questions) {
  if (!questions.some((row) => row.entity_type === 'exam_ask')) return questions;
  try {
    const exams = rowsOf(await sql`
      SELECT m.id, ea.exam_date::text AS exam_date, ea.exam_type AS exam_type
      FROM messages m
      JOIN exam_asks ea ON ea.id = m.entity_id
      WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'exam_ask'
    `);
    const byId = new Map(exams.map((row) => [row.id, row]));
    return questions
      .filter((row) => row.entity_type !== 'exam_ask' || byId.has(row.id))
      .map((row) => (row.entity_type === 'exam_ask' ? { ...row, exam_date: byId.get(row.id).exam_date, exam_type: byId.get(row.id).exam_type } : row));
  } catch (error) {
    console.error('chat: טעינת שאלות המבחן נכשלה:', error?.name);
    return questions.filter((row) => row.entity_type !== 'exam_ask');
  }
}
