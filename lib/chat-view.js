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
import { subjectLabel } from './timetable.js';
import { EXAM_ANSWERS } from './exam-ask.js';
import { VACATION_TYPES, VACATION_FRAME_TYPE, vacationButtons } from './vacation-ask.js';
import { DUE_ENTITY, CHECK_ENTITY, checkButtons } from './personal-task.js';
import { MATCH_ENTITY, matchButtons, parsePending } from './event-match.js';
import { SUBTASK_ENTITY, subtaskButtons, parsePending as parseSubtaskPending } from './subtask.js';
import { WEEKLY_ENTITIES, WEEKLY_BUTTONS } from './weekly-runs.js';
import { CORRECTION_ENTITY, CORRECTION_BUTTONS } from './correction-rules.js';
import { TIME_SUGGEST_ENTITY, TIME_SUGGEST_BUTTONS } from './time-suggest.js';
import { STUDY_PLAN_ENTITY, STUDY_PLAN_BUTTONS } from './study-plan.js';
import { LISTEN_SUGGEST_ENTITY, LISTEN_BUTTONS } from './listening.js';
import { AWAY_ENTITY, AWAY_BUTTONS } from './away.js';
import { STUDY_ORPHAN_ENTITY, STUDY_ORPHAN_BUTTONS } from './study-cleanup.js';
import { EXAM_FEEL_ENTITY, EXAM_FEEL_BUTTONS } from './exam-feel.js';
import { MONTHLY_REVIEW_ENTITY } from './monthly-brief.js';

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

// "תביא לי" (בלוק 8, lib/bring-me.js): לכל בועת מערכת, מזהי התמונות שהיא מציגה (links: message -> media). linkRows: { from_id, to_id }.
// בועה בלי קישורים (וכל הודעת משתמש) נשארת בדיוק כמו קודם, בלי השדה media: החוזה הקיים של הפריטים לא משתנה. השרת מגיש כל מזהה ב-GET /api/chat?view=media&id= (הצגתן בדף היא עבודת ממשק נפרדת ב-public/, לא חלק מהפונקציה הזאת).
export function attachMedia(items, linkRows) {
  const byBubble = new Map();
  for (const link of Array.isArray(linkRows) ? linkRows : []) {
    if (!isUuid(link?.from_id) || !isUuid(link?.to_id)) continue;
    byBubble.set(link.from_id, [...(byBubble.get(link.from_id) ?? []), link.to_id]);
  }
  return items.map((item) => (item.role === 'system' && byBubble.has(item.id) ? { ...item, media: byBubble.get(item.id) } : item));
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
    // שאלת החופשה היומית וכרטיס המסגרת (lib/vacation-ask.js): { id, kind: 'vacation', ask: 'day' | 'frame', at, text, buttons (מחרוזות), allowFreeText: true }.
    // אותה צורה כמו שאלה רגילה (text, buttons, allowFreeText), ולכן הדף מציג אותה בכרטיס השאלה הקיים; התשובה נשלחת ב-answer או ב-vacation.
    if (VACATION_TYPES.includes(row.entity_type)) {
      return {
        id: row.id,
        kind: 'vacation',
        ask: row.entity_type === VACATION_FRAME_TYPE ? 'frame' : 'day',
        at: toIso(row.sent_at),
        text: row.body ?? null,
        buttons: vacationButtons(row.entity_type),
        allowFreeText: true,
      };
    }
    // משימה אישית (בלוק 4, lib/personal-task.js): "עד מתי?" = תיבת כתיבה בלבד, בלי "לא יודע" (מפרט 60 סעיף 12); "בוצע?" = שני כפתורים בלי תיבה.
    // אותה צורה כמו שאלה רגילה (text, buttons, allowFreeText), ולכן כרטיס השאלה הקיים בדף מציג אותן בלי שינוי, והתשובה נשלחת ב-answer.
    // שאלת זיהוי (בלוק 4, lib/event-match.js): "זה אותו דבר כמו ...?". הכפתורים מהמועמדים שנשמרו (match_pending, ממוזג ב-loadPending), בלי תיבת כתיבה.
    // אותה צורה כמו שאלה רגילה, ולכן כרטיס השאלה הקיים בדף מציג אותה בלי שינוי, והתשובה נשלחת ב-answer.
    if (row.entity_type === MATCH_ENTITY) {
      return { id: row.id, kind: 'event_match', at: toIso(row.sent_at), text: row.body ?? null, buttons: matchButtons(parsePending(row.match_pending)), allowFreeText: false };
    }
    // כרטיס תת-משימה (lib/subtask.js): "זה חלק מ'<הורה>'?". הכפתורים מהמועמדים שנשמרו (subtask_pending, ממוזג ב-loadPending), בלי תיבת כתיבה.
    // אותה צורה כמו שאלה רגילה, ולכן כרטיס השאלה הקיים בדף מציג אותה בלי שינוי, והתשובה נשלחת ב-answer.
    if (row.entity_type === SUBTASK_ENTITY) {
      return { id: row.id, kind: 'subtask_link', at: toIso(row.sent_at), text: row.body ?? null, buttons: subtaskButtons(parseSubtaskPending(row.subtask_pending)), allowFreeText: false };
    }
    // ריצת שלישי / שישי (lib/weekly-runs.js): "יש ריצה ביום שלישי 24.11?" ו"... מתנגשת ב-X. לרשום בכל זאת?". שני כפתורים (כן / לא), בלי תיבת כתיבה.
    // אותה צורה כמו שאלה רגילה, ולכן כרטיס השאלה הקיים בדף מציג אותה בלי שינוי, והתשובה נשלחת ב-answer.
    if (WEEKLY_ENTITIES.includes(row.entity_type)) {
      return { id: row.id, kind: 'weekly_run', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...WEEKLY_BUTTONS], allowFreeText: false };
    }
    // הצעת כלל מתיקון שחוזר (lib/correction-rules.js): "לקבוע שמעכשיו ש-X = Y?". שני כפתורים (כן / לא), בלי תיבת כתיבה.
    // אותה צורה כמו שאלה רגילה, ולכן כרטיס השאלה הקיים בדף מציג אותה בלי שינוי, והתשובה נשלחת ב-answer.
    if (row.entity_type === CORRECTION_ENTITY) {
      return { id: row.id, kind: 'correction_rule', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...CORRECTION_BUTTONS], allowFreeText: false };
    }
    // הצעת שעה למשימה אישית (lib/time-suggest.js): "<משימה> — <יום> <שעה>?" עם כן / שעה אחרת / לא, בלי תיבת כתיבה. אותה צורה כמו שאלה רגילה; התשובה נשלחת ב-answer.
    if (row.entity_type === TIME_SUGGEST_ENTITY) {
      return { id: row.id, kind: 'time_suggest', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...TIME_SUGGEST_BUTTONS], allowFreeText: false };
    }
    // תוכנית למידה למבחן (lib/study-plan.js): הבלוקים בגוף, וכן / עוד זמן / לא, בלי תיבת כתיבה. אותה צורה כמו שאלה רגילה; התשובה נשלחת ב-answer.
    // הצעת האזנה של 17:00 (lib/listening.js): "שמעתי" / "אחר כך", בלי תיבת כתיבה.
    if (row.entity_type === LISTEN_SUGGEST_ENTITY) {
      return { id: row.id, kind: 'listen', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...LISTEN_BUTTONS], allowFreeText: false };
    }
    // "בזמן החופשה" (lib/away.js): מה נפל לתוך אירוע של כמה ימים, כן / לא, בלי תיבת כתיבה.
    if (row.entity_type === AWAY_ENTITY) {
      return { id: row.id, kind: 'away_conflict', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...AWAY_BUTTONS], allowFreeText: false };
    }
    // שעות למידה של מבחן שזז או בוטל (lib/study-cleanup.js): "לבטל אותן?" כן / לא, בלי תיבת כתיבה.
    if (row.entity_type === STUDY_ORPHAN_ENTITY) {
      return { id: row.id, kind: 'study_orphan', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...STUDY_ORPHAN_BUTTONS], allowFreeText: false };
    }
    // "איך היה?" אחרי מבחן שיובל אמר עליו "אני מוכן" (lib/exam-feel.js): שלושה כפתורים, בלי תיבת כתיבה. kind אינו 'exam' (זה כרטיס "איזה מקצוע במדעים?").
    if (row.entity_type === EXAM_FEEL_ENTITY) {
      return { id: row.id, kind: 'exam_feel', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...EXAM_FEEL_BUTTONS], allowFreeText: false };
    }
    // "מה לשמר מהחודש, ומה לשפר?" אחרי הבריף החודשי (lib/monthly-brief.js): בלי כפתורים, תיבת כתיבה בלבד (כמו "עד מתי?" של משימה אישית).
    if (row.entity_type === MONTHLY_REVIEW_ENTITY) {
      return { id: row.id, kind: 'monthly_review', at: toIso(row.sent_at), text: row.body ?? null, buttons: [], allowFreeText: true };
    }
    if (row.entity_type === STUDY_PLAN_ENTITY) {
      return { id: row.id, kind: 'study_plan', at: toIso(row.sent_at), text: row.body ?? null, buttons: [...STUDY_PLAN_BUTTONS], allowFreeText: false };
    }
    if (row.entity_type === DUE_ENTITY || row.entity_type === CHECK_ENTITY) {
      const check = row.entity_type === CHECK_ENTITY;
      return { id: row.id, kind: check ? 'task_check' : 'task_due', at: toIso(row.sent_at), text: row.body ?? null, buttons: check ? checkButtons() : [], allowFreeText: !check };
    }
    if (row.entity_type === 'lesson_ask') {
      return {
        id: row.id,
        kind: 'homework',
        at: toIso(row.sent_at),
        subject: row.subject ?? null,
        label: row.subject ? subjectLabel(row.subject) : null, // שם תצוגה; subject נשאר המפתח
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

// רשימת "פתוחות" עם תתי-משימות (הכרעת יובל 22.11.2026): כל תת-משימה מיד אחרי משימת-האב שלה, כדי שהמסך יוכל להזיח אותה.
// items: פריטים בסדר הקיים (openTaskFromRow, lib/homework-view.js), עם parent_task_id לתת-משימה. הסדר בין משימות-אב ובין האחים נשמר.
// תת-משימה שההורה שלה לא ברשימה (ההורה כבר בוצע) נשארת במקומה, כמו משימה רגילה.
export function orderOpenTasks(items) {
  const list = Array.isArray(items) ? items : [];
  const ids = new Set(list.map((item) => item.id));
  const isChild = (item) => Boolean(item.parent_task_id) && item.parent_task_id !== item.id && ids.has(item.parent_task_id);
  const childrenOf = new Map();
  for (const item of list) {
    if (!isChild(item)) continue;
    if (!childrenOf.has(item.parent_task_id)) childrenOf.set(item.parent_task_id, []);
    childrenOf.get(item.parent_task_id).push(item);
  }
  const out = [];
  for (const item of list) {
    if (!isChild(item)) out.push(item, ...(childrenOf.get(item.id) ?? []));
  }
  return out;
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
// או { ok: true, action: 'subtask_link', taskId, parentId } או { ok: true, action: 'subtask_unlink', taskId } (תתי-משימות)
// או { ok: true, action: 'homework', messageId, had, topic, due } או { ok: true, action: 'task_done', taskId } (שלב 8.6-1) או { ok: true, action: 'exam', messageId, answer } (שלב B-3ב) או { ok: true, action: 'vacation', messageId, answer } (שאלת החופשה) או { ok: true, action: 'attach', taskId, image } (שלב 8.6-3) או { ok: false }.
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
  if (body.action === 'vacation') {
    // שאלת החופשה / כרטיס המסגרת: { message_id, answer }. answer: טקסט של כפתור או כתיבה חופשית, לא ריק, עד MAX_ANSWER_LENGTH תווים; נשמר אחרי trim.
    const { message_id: messageId, answer } = body;
    if (!isUuid(messageId) || typeof answer !== 'string' || answer.trim() === '' || answer.length > MAX_ANSWER_LENGTH) return { ok: false };
    return { ok: true, action: 'vacation', messageId, answer: answer.trim() };
  }
  if (body.action === 'task_done') {
    if (!isUuid(body.task_id)) return { ok: false };
    return { ok: true, action: 'task_done', taskId: body.task_id };
  }
  if (body.action === 'attach') {
    // שלב 8.6-3 (docs/08-chapter8/60, החוזה): { task_id, image }. image: JPEG ב-base64, מחרוזת לא ריקה. הפענוח ובדיקת ה-JPEG ב-lib/media-attach.js (decodeJpeg).
    const { task_id: taskId, image } = body;
    if (!isUuid(taskId) || typeof image !== 'string' || image === '') return { ok: false };
    return { ok: true, action: 'attach', taskId, image };
  }
  if (body.action === 'subtask_link') {
    // תתי-משימות (22.11.2026): { task_id, parent_id }, שניהם uuid. שאר הבדיקות (קיימות, פתוחות, לא עצמה, רמה אחת) ב-lib/subtask.js linkSubtask.
    const { task_id: taskId, parent_id: parentId } = body;
    if (!isUuid(taskId) || !isUuid(parentId)) return { ok: false };
    return { ok: true, action: 'subtask_link', taskId, parentId };
  }
  if (body.action === 'subtask_unlink') {
    if (!isUuid(body.task_id)) return { ok: false };
    return { ok: true, action: 'subtask_unlink', taskId: body.task_id };
  }
  if (body.action === 'check') {
    const { outcome_id: outcomeId, verdict, event_type: eventType } = body;
    if (!isUuid(outcomeId) || !validCheckShape({ verdict, eventType })) return { ok: false };
    return { ok: true, action: 'check', outcomeId, verdict, eventType: eventType ?? null };
  }
  return { ok: false };
}
