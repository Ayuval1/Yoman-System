// מה הצ'אט מציג (שלב 8.2א-1): מיפוי שורות מהמסד לפריטים, סדר, תגים, גזירת השאלות הממתינות, המספר על האייקון, ובדיקת בקשות POST.
// מקור: docs/08-chapter8/47-chapter8-step-8-2a-spec.md ("מה נכנס" סעיפים 1-2 ו-8, "איך נשמר מה", "החוזה של נקודת הצ'אט החדשה"); 35, D4 (המספר).
// פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל. api/chat.js קורא מהמסד ומעביר לכאן את השורות.
//
// פריט (items): { id, role: 'user' | 'system', text, at (ISO) }. למשתמש גם forwarded (true רק לערוץ shortcut, 47 קריטריון 3);
// למערכת גם tag ('recorded' / 'duplicate' / 'received') ו-unread (read_at ריק).
// שאלה ממתינה (pending): { id, text (ה-body השמור), at, buttons, allowFreeText }. הכפתורים נגזרים עם pendingQuestion (lib/intake-process.js) ואינם נשמרים.
import { pendingQuestion } from './intake-process.js';
import { UNKNOWN_BUTTON, DUPLICATE_REPLY } from './intake-questions.js';

// 47 "מה נכנס" סעיף 1: 50 הפריטים האחרונים, ישן לחדש, בלי דפדוף.
export const CHAT_ITEMS_LIMIT = 50;
// הנחה, לא אומת: תקרת אורך לתשובה בכתיבה (תווים). אף מסמך לא קובע; תשובה לשאלת הבהרה קצרה בהרבה.
export const MAX_ANSWER_LENGTH = 1000;
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
export function pendingFromRows({ questions, facts, timetable } = {}) {
  const bySource = new Map();
  for (const row of Array.isArray(facts) ? facts : []) {
    if (!bySource.has(row.source_id)) bySource.set(row.source_id, []);
    bySource.get(row.source_id).push({ field: row.field, value: row.value, origin: row.origin });
  }
  const list = (Array.isArray(questions) ? questions : []).map((row) => {
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

// המספר על האייקון (D4): שאלות פתוחות + בועות update יוצאות שלא נקראו. שאלה לא נספרת כ"לא נקראה" (47 "איך נשמר מה"), ולכן אין ספירה כפולה.
const count = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
export function badgeFrom({ pending, unread } = {}) {
  return count(pending) + count(unread);
}

// בדיקת גוף POST (כבר מפוענח מ-JSON). מחזיר { ok: true, action: 'answer', messageId, answer } או { ok: true, action: 'read', messageIds } או { ok: false }.
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
  return { ok: false };
}
