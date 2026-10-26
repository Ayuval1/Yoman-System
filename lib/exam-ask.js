// שאלת "איזה מקצוע במדעים?" (שלב B-3ב; docs/08-chapter8/68-chapter8-brief-prd.md: D14, H13, סעיף B-3).
// שורת מבחן בלוח הקובץ היא "מדעים" בלי פירוט. כשהמבחן עד 3 ימים קדימה, יובל מקבל בצ'אט כרטיס עם שלושה כפתורים: פיזיקה / כימיה / אחר.
// "פיזיקה" או "כימיה": שורת הפס, ההתראה והבוקר משתמשות בשם המקצוע (ובשעה כשידועה, H14). "אחר" או בלי תשובה: "<סוג> במדעים" בלי שעה. "אחר" סוגר את השאלה ולא נשאלת שוב.
// כל כתיבה היא פקודה אחת (CTE) עם עדכון מותנה, כמו lib/homework-view.js: לחיצה כפולה או הגעה כפולה של התור לא ייצרו שורה שנייה. אין מחיקה פיזית.
// פרטיות: אין טקסט הודעה אמיתי כאן; גוף השאלה קבוע, וסוג המבחן והתאריך נשמרים רק ב-exam_asks.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה; ההוכחה החיה היא בהרצה של יובל.
import { EXAMS, UNSPECIFIED_SUBJECT, SCIENCE_SUBJECTS } from './exam-line.js';
import { addDays } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);

// גוף הודעת השאלה ב-messages.body. קבוע בכוונה (בלי סוג ובלי תאריך): הכרטיס נבנה מ-exam_asks.
export const EXAM_ASK_BODY = 'איזה מקצוע במדעים?';
// שלוש התשובות החוקיות, בדיוק כפי שהכפתורים שולחים אותן.
export const EXAM_ANSWERS = Object.freeze(['פיזיקה', 'כימיה', 'אחר']);
// הנחה, לא אומת (H13 קובע "3 ימים לפני המבחן" כהצעה): כמה ימים קדימה מתחילים לשאול. 3 = מהיום שלושה ימים לפני המבחן ועד יום לפניו.
export const EXAM_ASK_DAYS_AHEAD = 3;
// הנחה, לא אומת: השאלה פוקעת ב-06:00 שעון ישראל ביום המבחן, סוף חלון שורת המבחן (REVIEW_WINDOW_END_HOUR ב-lib/exam-line.js). אחרי זה היא כבר לא מועילה.
export const EXAM_ASK_EXPIRES_AT = '06:00';

// מבחני "מדעים" שצריך לשאול עליהם: לא "מועד ב'", ותאריכם אחרי היום ועד היום + 3 (כולל). todayIso: התאריך הישראלי של היום (YYYY-MM-DD).
// אותו תאריך פעמיים (אם יש) נשאל פעם אחת: exam_date הוא UNIQUE.
export function examsToAsk(todayIso, { exams = EXAMS } = {}) {
  const last = addDays(todayIso, EXAM_ASK_DAYS_AHEAD);
  const seen = new Set();
  return exams.filter((exam) => {
    if (exam.subject !== UNSPECIFIED_SUBJECT || exam.makeup === true) return false;
    if (!(exam.date > todayIso && exam.date <= last)) return false;
    if (seen.has(exam.date)) return false;
    seen.add(exam.date);
    return true;
  });
}

// מתי השאלה פוקעת: 06:00 שעון ישראל ביום המבחן (בטוח למעבר שעון: zonedToUtc).
export const examAskExpiresAt = (examDate) => zonedToUtc(examDate, EXAM_ASK_EXPIRES_AT, TIME_ZONE);

// יוצר שאלה אחת למבחן: שורה ב-exam_asks ושורה ב-messages (kind='question', awaiting_reply=true, entity_type='exam_ask'), בפקודה אחת.
// ON CONFLICT (exam_date) DO NOTHING: ריצה חוזרת לא יוצרת כלום, ואז created=false. כשל מסד נזרק (createExamAsks תופס).
export async function createExamAsk({ sql, exam }) {
  const expiresAt = examAskExpiresAt(exam.date).toISOString();
  const [row] = rowsOf(await sql`
    WITH a AS (
      INSERT INTO exam_asks (exam_date, exam_type)
      VALUES (${exam.date}::date, ${exam.type}::text)
      ON CONFLICT (exam_date) DO NOTHING
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${EXAM_ASK_BODY}::text, 'question', now(), true, NULL::uuid, ${expiresAt}::timestamptz, 'exam_ask', a.id, 1 FROM a
      RETURNING id
    )
    SELECT (SELECT id FROM a) AS ask_id, (SELECT id FROM m) AS message_id
  `);
  return { created: Boolean(row?.ask_id), askId: row?.ask_id ?? null, messageId: row?.message_id ?? null };
}

// מנסה ליצור את כל השאלות של החלון (examsToAsk). לא זורק לעולם: כשל (כולל טבלה שלא קיימת) נרשם עם שם השגיאה בלבד, והבריף ממשיך.
// מחזיר כמה שאלות נוצרו עכשיו. הנחה, לא אומת: כשל באחת לא עוצר את האחרות (בפועל יש היום מבחן מדעים אחד בכל חלון).
export async function createExamAsks({ sql, todayIso, exams = EXAMS }) {
  let created = 0;
  try {
    for (const exam of examsToAsk(todayIso, { exams })) {
      try {
        const result = await createExamAsk({ sql, exam });
        if (result.created) created += 1;
      } catch (error) {
        console.error('exam-ask: יצירת השאלה נכשלה:', error?.name); // רק שם השגיאה
      }
    }
  } catch (error) {
    console.error('exam-ask: חישוב החלון נכשל:', error?.name);
  }
  return created;
}

// התשובות לשורות: Map תאריך (YYYY-MM-DD) -> 'פיזיקה' | 'כימיה'. "אחר" ושאלה שלא נענתה אינן במפה (נשאר "מדעים"). לא זורק:
// כשל או טבלה חסרה = מפה ריקה, ושם השגיאה בלבד בלוג, כדי שהפס, ההתראה והבריף ימשיכו לעבוד.
export async function loadExamAnswers(sql) {
  const answers = new Map();
  try {
    const rows = rowsOf(await sql`
      SELECT exam_date::text AS exam_date, answer FROM exam_asks WHERE status = 'answered' AND answer IS NOT NULL
    `);
    for (const row of rows) {
      if (typeof row?.exam_date === 'string' && SCIENCE_SUBJECTS.includes(row.answer)) answers.set(row.exam_date, row.answer);
    }
  } catch (error) {
    console.error('exam-ask: טעינת התשובות נכשלה:', error?.name);
    return new Map();
  }
  return answers;
}

// פעולה exam: { status: 'answered' | 'closed' }. answer: אחד מ-EXAM_ANSWERS (parseChatAction בודק; כאן הגנה נוספת).
//  - closed: השאלה לא קיימת, כבר נסגרה (לחיצה כפולה), פגה, או נסגרה בלחיצה מקבילה. לא נכתב כלום.
//  - answered: הודעת השאלה נסגרה (awaiting_reply=false, read_at) והתשובה נשמרה ב-exam_asks (status='answered').
// סגירה מותנית (WHERE awaiting_reply = true): ה-UPDATE של exam_asks רץ רק אם הסגירה שינתה שורה. כשל מסד נזרק (api/chat.js מחזיר 500).
export async function answerExam({ sql, messageId, answer, now = new Date() }) {
  if (!EXAM_ANSWERS.includes(answer)) return { status: 'closed' };
  const nowIso = now.toISOString();
  const [row] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'exam_ask'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING entity_id
    ), a AS (
      UPDATE exam_asks SET answer = ${answer}::text, status = 'answered', answered_at = now()
      WHERE id IN (SELECT entity_id FROM closed)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed
  `);
  return { status: Number(row?.closed) > 0 ? 'answered' : 'closed' };
}
