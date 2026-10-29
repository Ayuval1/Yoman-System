// מה הצ'אט מציג (שלב 8.2א-1): מיפוי שורות מהמסד לפריטים, סדר, תגים, גזירת השאלות הממתינות, המספר על האייקון, ובדיקת בקשות POST.
// מקור: docs/08-chapter8/47-chapter8-step-8-2a-spec.md ("מה נכנס" סעיפים 1-2 ו-8, "איך נשמר מה", "החוזה של נקודת הצ'אט החדשה"); 35, D4 (המספר).
// פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל. api/chat.js קורא מהמסד ומעביר לכאן את השורות.
//
// פריט (items): { id, role: 'user' | 'system', text, at (ISO) }. למשתמש גם forwarded (true רק לערוץ shortcut, 47 קריטריון 3);
// למערכת גם tag ('recorded' / 'duplicate' / 'received') ו-unread (read_at ריק).
// שאלה ממתינה (pending): { id, text (ה-body השמור), at, buttons, allowFreeText }. הכפתורים נגזרים עם pendingQuestion (lib/intake-process.js) ואינם נשמרים.
import { pendingQuestion } from './intake-process.js';
import { UNKNOWN_BUTTON, DUPLICATE_REPLY } from './intake-questions.js';
import { validCheckShape } from './review-view.js';
import { homeworkButtons } from './homework-schedule.js';
import { EXAM_ANSWERS } from './exam-ask.js';

// 47 "מה נכנס" סעיף 1: 50 הפריטים האחרונים, ישן לחדש, בלי דפדוף.
export const CHAT_ITEMS_LIMIT = 50;
// הנחה, לא אומת: תקרת אורך לתשובה בכתיבה (תווים). אף מסמך לא קובע; תשובה לשאלת הבהרה קצרה בהרבה.
export const MAX_ANSWER_LENGTH = 1000;
// הנחה, לא אומת: תקרת אורך לנושא השיעור ("מה למדתם?", שלב 8.6-1). אף מסמך לא קובע.
export const MAX_TOPIC_LENGTH = 200;
// הנחה, לא אומת: כמה מזהים לכל היותר בבקשת read אחת. הדף מציג עד 50 פריטים, ולכן 100 משאיר מרווח.
export const MAX_READ_IDS = 100;
// הנוסח שהדף מציג על כל כשל (47, "החוזה של נקודת הצ'אט החדשה").
export const ERROR_TEXT = 'לא נשלח, נסה שוב.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

// timestamptz מהדרייבר (Date) או טקסט -> ISO, או null כשאינו תאריך.
export function toIso(value) {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// תג לבועת מערכת. "נרשם · ..." = recorded; "כבר קיבלתי" = duplicate; כל השאר (כולל "התקבל") = received.
// [הנחה, לא אומת] בועה עתידית שאינה מהצינור (למשל סיכום יומי, M.2 ב-docs/09-security/46) תקבל received עד שיוגדר לה תג.
export function tagFor(text) {
  if (typeof text === 'string' && text.startsWith('נרשם')) return 'recorded';
  if (text === DUPLICATE_REPLY) return 'duplicate';
  return 'received';
}

// שורה מהמסד ({ role, id, text, at, channel, read_at }) -> פריט.
export function itemFromRow(row) {
  const base = { id: row.id, role: row.role === 'system' ? 'system' : 'user', text: row.text ?? null, at: toIso(row.at) };
  if (base.role === 'user') return { ...base, forwarded: row.channel === 'shortcut' };
  return { ...base, tag: tagFor(row.text), unread: row.read_at === null || row.read_at === undefined };
}

// הסדר: לפי זמן, ישן לחדש. שורות שנוצרו באותה פקודה חולקות now() זהה, ולכן שובר השוויון קבוע: הודעת משתמש לפני בועת מערכת, ואחריה המזהה.
// זה אותו סדר כמו ב-ORDER BY של api/chat.js (שם הפוך, לבחירת 50 האחרונים). פריט בלי זמן ראשון (NULLS LAST בסדר ההפוך).
// [הנחה, לא אומת] הדרייבר מחזיר זמן ברמת אלפית שנייה ו-Postgres ברמת מיליונית: שני פריטים באותה אלפית שנייה מסודרים כאן לפי התפקיד והמזהה.
const ROLE_RANK = { user: 0, system: 1 };
export function compareItems(a, b) {
  const ta = a.at === null ? -Infinity : Date.parse(a.at);
  const tb = b.at === null ? -Infinity : Date.parse(b.at);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (ROLE_RANK[a.role] !== ROLE_RANK[b.role]) return ROLE_RANK[a.role] - ROLE_RANK[b.role];
  if (a.id === b.id) return 0;
  return String(a.id) < String(b.id) ? -1 : 1;
}

// שורות -> עד 50 פריטים, ישן לחדש (אם הגיעו יותר, נשארים 50 האחרונים).
export function itemsFromRows(rows) {
  const items = (Array.isArray(rows) ? rows : []).map(itemFromRow).sort(compareItems);
  return items.slice(-CHAT_ITEMS_LIMIT);
}

// השאלות הממתינות, הוותיקה קודם (47 "מה נכנס" סעיף 2). questions: שורות { id, body, sent_at, source_id, channel, raw_content, content_hash, received_at }
// (שדות המקור ריקים כשהשאלה אינה על מקור). facts: שורות { source_id, field, value, origin }. timetable: מערכת השעות או null.
// כשאין שדה פתוח (pendingQuestion מחזיר null) או שאין מקור: "לא יודע" בלבד ותיבת כתיבה (ה6), כדי שהשאלה תמיד אפשר לסגור.
// שאלת שיעורי בית (שלב 8.6-1, מפרט 60 "חוזה"): שורה עם entity_type='lesson_ask' (ועם subject ו-lesson_date מ-lesson_asks) הופכת לפריט
// { id, kind: 'homework', at, subject, lesson_date, period, buttons: [{ due: 'next', date }], topic_allowed: true }. בלי "לא יודע" ובלי תיבת כתיבה חופשית.
// today (YYYY-MM-DD, שעון ישראל): כפתור שתאריכו לפניו לא מוצג. הנחה, לא אומת: `at` נוסף לפריט (המפרט לא מונה אותו) כדי לשמור על מיון אחיד עם שאר השאלות.
export function pendingFromRows({ questions, facts, timetable, today } = {}) {
  const bySource = new Map();
  for (const row of Array.isArray(facts) ? facts : []) {
    if (!bySource.has(row.source_id)) bySource.set(row.source_id, []);
    bySource.get(row.source_id).push({ field: row.field, value: row.value, origin: row.origin });
  }
  const list = (Array.isArray(questions) ? questions : []).map((row) => {
    // שאלת "איזה מקצוע במדעים?" (שלב B-3ב, 68 H13): שורה עם entity_type='exam_ask' (ועם exam_date ו-exam_type מ-exam_asks, ממוזגים ב-loadPending)
    // הופכת לפריט { id, kind: 'exam', at, exam_date, exam_type, buttons: [{ answer }] }. בלי text, בלי "לא יודע" ובלי תיבת כתיבה חופשית.
    if (row.entity_type === 'exam_ask') {
      return {
        id: row.id,
        kind: 'exam',
        at: toIso(row.sent_at),
        exam_date: row.exam_date ?? null,
        exam_type: row.exam_type ?? null,
        buttons: EXAM_ANSWERS.map((answer) => ({ answer })),
      };
    }
    if (row.entity_type === 'lesson_ask') {
      return {
        id: row.id,
        kind: 'homework',
        at: toIso(row.sent_at),
        subject: row.subject ?? null,
        lesson_date: row.lesson_date ?? null,
        period: Number.isInteger(row.period) ? row.period : null, // מספר השיעור לשורת המקור בכרטיס (הכרעת יובל 29.10.2026); null כשלא ידוע
        missed: row.missed === true, // שלב 8.3-2: יציאה מוקדמת פספסה את הרצף; הכרטיס מציג "פספסת שיעור ..."
        buttons: homeworkButtons({ timetable, subject: row.subject, lessonDate: row.lesson_date, today }),
        topic_allowed: true,
      };
    }
    let derived = null;
    if (row.source_id) {
      const source = { id: row.source_id, channel: row.channel, raw_content: row.raw_content, content_hash: row.content_hash, received_at: row.received_at };
      try {
        derived = pendingQuestion({ source, facts: bySource.get(row.source_id) ?? [], timetable: timetable ?? null });
      } catch (error) {
        // רק שם השגיאה: לא טקסט ההודעה. השאלה עדיין מוצגת עם "לא יודע", כדי שאפשר לסגור אותה.
        console.error('chat: גזירת כפתורים נכשלה:', error?.name);
      }
    }
    return {
      id: row.id,
      text: row.body ?? null,
      at: toIso(row.sent_at),
      buttons: derived ? [...derived.buttons] : [UNKNOWN_BUTTON],
      allowFreeText: derived ? derived.allowFreeText : true,
    };
  });
  return list.sort((a, b) => {
    const ta = a.at === null ? Infinity : Date.parse(a.at);
    const tb = b.at === null ? Infinity : Date.parse(b.at);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
}

// המספר על האייקון (D4): שאלות פתוחות (שלא פגו) + בועות update יוצאות שלא נקראו. שאלה לא נספרת כ"לא נקראה" (47 "איך נשמר מה"), ולכן אין ספירה כפולה.
// + review (M.2, 57 T8): 0 או 1. סיכום היום נספר פריט ממתין אחד כשיש לפחות הודעה אחת לסימון (ערך חיובי כלשהו נספר 1).
const count = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
// + openTasks (שלב 8.6-1, מפרט 60 סעיף 11, הכרעת יובל 16.10.2026 "ב"): מספר הפריטים הפתוחים (tasks עם status='open'), כל אחד נספר 1. "בוצע" מוריד את המספר ב-1.
export function badgeFrom({ pending, unread, review, openTasks } = {}) {
  return count(pending) + count(unread) + (count(review) > 0 ? 1 : 0) + count(openTasks);
}

// בדיקת גוף POST (כבר מפוענח מ-JSON). מחזיר { ok: true, action: 'answer', messageId, answer } או { ok: true, action: 'read', messageIds }
// או { ok: true, action: 'check', outcomeId, verdict, eventType } (M.2, 57 סעיף 6; eventType null כשלא נשלח)
// או { ok: true, action: 'homework', messageId, had, topic, due } או { ok: true, action: 'task_done', taskId } (שלב 8.6-1) או { ok: true, action: 'exam', messageId, answer } (שלב B-3ב) או { ok: false }.
// answer: טקסט לא ריק (גם לא רווחים בלבד) עד MAX_ANSWER_LENGTH תווים, ונשלח לצינור כפי שהוא. message_ids: מערך של מזהי uuid, עד MAX_READ_IDS.
// [הנחה, לא אומת] מערך ריק ב-read מותר: לא מסמן כלום ומחזיר את המספר.
export function parseChatAction(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  if (body.action === 'answer') {
    const { message_id: messageId, answer } = body;
    if (!isUuid(messageId)) return { ok: false };
    if (typeof answer !== 'string' || answer.trim() === '' || answer.length > MAX_ANSWER_LENGTH) return { ok: false };
    return { ok: true, action: 'answer', messageId, answer };
  }
  if (body.action === 'read') {
    const ids = body.message_ids;
    if (!Array.isArray(ids) || ids.length > MAX_READ_IDS || !ids.every(isUuid)) return { ok: false };
    return { ok: true, action: 'read', messageIds: [...ids] };
  }
  if (body.action === 'homework') {
    // שלב 8.6-1: { message_id, had, topic?, due? }. had חייב להיות בוליאני. due: 'next' בלבד (כפתור יחיד, הכרעת יובל 16.10.2026) וחובה כש-had=true.
    // topic: טקסט עד MAX_TOPIC_LENGTH תווים; ריק או רווחים בלבד = אין נושא. הנחה, לא אומת: תקרת האורך.
    const { message_id: messageId, had, topic, due } = body;
    if (!isUuid(messageId) || typeof had !== 'boolean') return { ok: false };
    if (due !== undefined && due !== null && due !== 'next') return { ok: false };
    if (had && due !== 'next') return { ok: false };
    if (topic !== undefined && topic !== null && (typeof topic !== 'string' || topic.length > MAX_TOPIC_LENGTH)) return { ok: false };
    const cleanTopic = typeof topic === 'string' && topic.trim() !== '' ? topic.trim() : null;
    return { ok: true, action: 'homework', messageId, had, topic: cleanTopic, due: had ? 'next' : null };
  }
  if (body.action === 'exam') {
    // שלב B-3ב: { message_id, answer }. answer: אחד משלושת הערכים בדיוק (פיזיקה / כימיה / אחר); כל ערך אחר נדחה.
    const { message_id: messageId, answer } = body;
    if (!isUuid(messageId) || !EXAM_ANSWERS.includes(answer)) return { ok: false };
    return { ok: true, action: 'exam', messageId, answer };
  }
  if (body.action === 'task_done') {
    if (!isUuid(body.task_id)) return { ok: false };
    return { ok: true, action: 'task_done', taskId: body.task_id };
  }
  if (body.action === 'check') {
    const { outcome_id: outcomeId, verdict, event_type: eventType } = body;
    if (!isUuid(outcomeId) || !validCheckShape({ verdict, eventType })) return { ok: false };
    return { ok: true, action: 'check', outcomeId, verdict, eventType: eventType ?? null };
  }
  return { ok: false };
}
