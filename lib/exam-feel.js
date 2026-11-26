// "איך היה?" בהקשה אחת אחרי מבחן (הכרעת יובל 3.10.2026, ג': "לא לומד היום, אני מוכן" = ביטול + תשובה בשורה אחת + שאלה בהקשה אחת "איך היה?" אחרי המבחן).
// מקור: docs/01-foundation/02-build-plan.md:499; docs/01-foundation/05-open-questions.md:24. איפה נשמרת התשובה לא הוכרע; פתק 105 ממליץ לשמור רק כדי ללמוד ממנה
// בהמשך כמה זמן ללמוד לכל מקצוע (פרק 10). הכרעת Claude (לילה 26.11), קל לשנות:
//  - רק למבחן שיובל אמר עליו "לא לומד היום, אני מוכן" (lib/study-plan.js answerNotStudying). המבחן = המבחן ששורת התשובה מציינת (notStudyingTarget).
//  - הסימון והתשובה ב-facts (entity_type 'exam_feel', entity_id דטרמיניסטי מהמבחן), בלי טבלה חדשה ובלי שינוי סכמה. source_id ריק בכוונה:
//    עובדות עם source_id נקראות ב"נקלט היום", בסיכום ובזיהוי, וסימון כזה היה משנה איך ההודעה המקורית מוצגת. מזהה ההודעה נשמר בשדה 'source'.
//    שדות: 'exam' = '<תאריך>:<מקצוע>' · 'source' = מזהה ההודעה "אני מוכן" · 'feel' = התשובה (אחד משלושת הכפתורים). התשובה גם בשורת sources (sender='answer')
//    שמקושרת ב-messages.reply_source_id, כמו כל תשובה לכרטיס.
//  - הכרטיס נוצר בסגירה של 21:00 ביום המבחן (api/queues/deliver.js), רק אם המבחן עדיין בלוח באותו יום (לא זז ולא בוטל). כרטיס אחד לכל מבחן.
//  - פג בסוף היום שאחרי המבחן. שלושה כפתורים, בלי תיבת כתיבה. אין שימוש בתשובה כרגע (נשמרת בלבד).
// פרטיות: אין כאן טקסט של הודעה. רק סוג המבחן, המקצוע והתאריך מהלוח, והתשובה מכפתור.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { briefEntityId } from './brief-view.js';
import { EXAMS, applyExamChanges } from './exam-line.js';
import { loadExamChanges } from './exam-ask.js';
import { addDays } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const REF = /^(\d{4}-\d{2}-\d{2}):([^:%_]+)$/;

export const EXAM_FEEL_ENTITY = 'exam_feel';
// הכרעת Claude (לילה 26.11), קל לשנות: נוסח הכפתורים.
export const FEEL_GOOD = 'הלך טוב';
export const FEEL_OK = 'בסדר';
export const FEEL_BAD = 'פחות טוב';
export const EXAM_FEEL_BUTTONS = Object.freeze([FEEL_GOOD, FEEL_OK, FEEL_BAD]);

export const examFeelEntityId = (ref) => briefEntityId(`exam-feel:${ref}`);
// הכרעת Claude (לילה 26.11), קל לשנות: פג בחצות שבסוף היום שאחרי המבחן.
export const examFeelExpiresAt = (examDate) => zonedToUtc(addDays(examDate, 2), '00:00', TIME_ZONE);
const examName = (exam) => `ה${exam.type} ב${exam.subject}`;
export const examFeelText = (exam) => `איך היה ${examName(exam)}?`;

// הסימון "אני מוכן" למבחן. exam: { examDate, subject } (notStudyingTarget). פעם אחת לכל מבחן (NOT EXISTS). לא זורק: כשל = false.
export async function markExamReady({ sql, sourceId, exam }) {
  if (!exam || !ISO_DAY.test(exam.examDate ?? '') || typeof exam.subject !== 'string' || !REF.test(`${exam.examDate}:${exam.subject}`)) return false;
  const ref = `${exam.examDate}:${exam.subject}`;
  const entityId = examFeelEntityId(ref);
  const facts = JSON.stringify([{ field: 'exam', value: ref }, { field: 'source', value: String(sourceId) }]);
  try {
    const rows = rowsOf(await sql`
      /* exam-feel-ready */ INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, x.field, x.value, 'certain', 'script', ${EXAM_FEEL_ENTITY}::text, ${entityId}::uuid, 'read'
      FROM jsonb_to_recordset(${facts}::jsonb) AS x(field text, value text)
      WHERE NOT EXISTS (SELECT 1 FROM facts p WHERE p.entity_type = ${EXAM_FEEL_ENTITY}::text AND p.entity_id = ${entityId}::uuid AND p.field = 'exam')
      RETURNING id
    `);
    return rows.length > 0;
  } catch (error) {
    console.error('exam-feel: רישום הסימון נכשל:', error?.name);
    return false;
  }
}

// בסגירה של 21:00 (dateIso = תאריך המשבצת): כרטיס לכל מבחן של היום שסומן "מוכן" ועדיין בלוח היום. לא זורק. { created: [refs] }.
// exams: לבדיקות. בלעדיו הלוח נטען עם השינויים בטעינה קפדנית: כשל = אין כרטיס (לוח בלי ההזזות היה שואל על מבחן שזז).
export async function ensureExamFeel({ sql, dateIso, now = new Date(), exams }) {
  if (!ISO_DAY.test(dateIso ?? '') || examFeelExpiresAt(dateIso) <= now) return { created: [] };
  try {
    const markers = rowsOf(await sql`
      SELECT /* exam-feel-markers */ DISTINCT f.value FROM facts f
      WHERE f.entity_type = ${EXAM_FEEL_ENTITY}::text AND f.field = 'exam' AND f.value LIKE ${`${dateIso}:%`}::text
    `).map((row) => row?.value).filter((value) => typeof value === 'string' && REF.test(value));
    if (markers.length === 0) return { created: [] };
    const board = exams ?? applyExamChanges(EXAMS, await loadExamChanges(sql, { strict: true }));
    const created = [];
    for (const ref of markers) {
      const subject = REF.exec(ref)[2];
      const exam = board.find((e) => e && e.makeup !== true && e.postponed !== true && e.date === dateIso && e.subject === subject);
      if (!exam) continue;
      const entityId = examFeelEntityId(ref);
      const rows = rowsOf(await sql`
        /* exam-feel-create */ INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
        SELECT 'out', ${examFeelText(exam)}::text, 'question', now(), true, NULL::uuid, ${examFeelExpiresAt(dateIso).toISOString()}::timestamptz, ${EXAM_FEEL_ENTITY}::text, ${entityId}::uuid, 1
        WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = ${EXAM_FEEL_ENTITY}::text AND x.entity_id = ${entityId}::uuid)
        RETURNING id
      `);
      if (rows.length > 0) created.push(ref);
    }
    return { created };
  } catch (error) {
    console.error('exam-feel: יצירת הכרטיס נכשלה:', error?.name);
    return { created: [] };
  }
}

// תשובה (api/chat.js). { status: 'answered' | 'closed' | 'unclear', created, keys: [], patchKeys: [] }. פקודה אחת מותנית בסגירת הכרטיס. כשל מסד נזרק.
export async function answerExamFeel({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  const [ask] = rowsOf(await sql`
    SELECT /* exam-feel-ask */ m.id, m.awaiting_reply,
      (SELECT f.value FROM facts f WHERE f.entity_type = ${EXAM_FEEL_ENTITY}::text AND f.entity_id = m.entity_id AND f.field = 'exam' LIMIT 1) AS exam
    FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${EXAM_FEEL_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (!EXAM_FEEL_BUTTONS.includes(text)) return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const match = REF.exec(typeof ask.exam === 'string' ? ask.exam : '');
  const bubble = match ? `נרשם · ${match[2]}: ${text}` : `נרשם · ${text}`;
  const [row] = rowsOf(await sql`
    /* exam-feel-answer */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${EXAM_FEEL_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), feel AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, 'feel', ${text}::text, 'certain', 'script', ${EXAM_FEEL_ENTITY}::text, closed.entity_id, 'read' FROM closed
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (!row || Number(row.closed) === 0) return closed;
  return { status: 'answered', created: { answerSourceId: row.answer_source_id ?? null, bubbleId: row.bubble_id ?? null }, keys: [], patchKeys: [] };
}
