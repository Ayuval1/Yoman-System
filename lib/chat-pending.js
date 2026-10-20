// השאלות הפתוחות של הצ'אט, מועברות מ-api/chat.js ל-lib/ (שלב B-1, docs/08-chapter8/68) כדי שגם הבריף של הבוקר (api/queues/deliver.js) ישתמש בהן. ההתנהגות והשאילתות לא השתנו.
import { loadTimetable } from './timetable.js';
import { localDateIso } from './intake-dates.js';
import { pendingFromRows } from './chat-view.js';

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// השאלות הפתוחות (הוותיקה קודם), עם המקור שלהן, העובדות שלו ומערכת השעות, כדי לגזור כפתורים (pendingQuestion).
// שלב 8.6-1: שאלה ש-expires_at שלה עבר לא מוחזרת (מפרט 60 סעיף 13), ושאלת שיעורי בית (entity_type='lesson_ask') מגיעה עם המקצוע והתאריך מ-lesson_asks.
// lesson_date::text כדי לקבל YYYY-MM-DD ולא אובייקט Date של הדרייבר.
export async function loadPending(sql, timetable, now) {
  const nowIso = now.toISOString();
  const questions = rowsOf(await sql`
    SELECT m.id, m.body, m.sent_at, m.entity_type, s.id AS source_id, s.channel, s.raw_content, s.content_hash, s.received_at,
           la.subject AS subject, la.lesson_date::text AS lesson_date
    FROM messages m
    LEFT JOIN sources s ON m.entity_type = 'source' AND s.id = m.entity_id
    LEFT JOIN lesson_asks la ON m.entity_type = 'lesson_ask' AND la.id = m.entity_id
    WHERE m.kind = 'question' AND m.awaiting_reply = true AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
    ORDER BY m.sent_at ASC NULLS LAST, m.id ASC
  `);
  if (questions.length === 0) return [];
  const facts = rowsOf(await sql`
    SELECT f.source_id, f.field, f.value, f.origin
    FROM facts f
    WHERE f.source_id IN (SELECT m.entity_id FROM messages m WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'source')
  `);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null, והכפתורים בלי מערכת השעות
  return pendingFromRows({ questions, facts, timetable: table, today: localDateIso(now, 'Asia/Jerusalem') });
}
