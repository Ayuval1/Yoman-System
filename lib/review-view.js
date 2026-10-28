// סיכום היום (שלב M.2 של docs/09-security/46; מפרט: docs/09-security/57-m2-daily-summary-spec.md): מה ממתין לסימון, איך מוצג, ואיך נכתב סימון.
// הסיכום מחושב, לא נשמר (T1): מקור האמת הוא intake_outcomes ו-intake_checks. אין כאן כתיבה אחרת, ואין קריאת מודל או רשת.
// פרטיות (D1, D16): הטקסט (raw_content) נקרא רק ב-loadReview, לתצוגה באפליקציה (T11). הוא לא נכתב לקונסול, ללוג, להתראה או לפרמטרי הכתיבה.
// הקובץ טהור בעיקרו (חלון הזמן, בחירת הנציגים, התצוגה, בדיקת הבקשה); ה-sql מוזרק לפונקציות ה-async, כמו בשאר הקבצים.
import { nextRunUtc, localParts } from './schedule-time.js';
import { formatReply, TYPE_LABELS } from './intake-questions.js';
import { ESSENTIAL_FIELDS, UNKNOWN_VALUE } from './intake-facts.js';

// ---------------------------------------------------------------------------
// קבועי M.2 (T7). נקבעו בסשן הבנייה ב-15.10.2026 ומדווחים ליובל; שינוי שלהם הוא הכרעה (הארכה בדוח M.3), לא תיקון.
// ערב ההוכחה (סעיף 13 ב-57) הוא "ערב 0": 15.10.2026. ההודעות שלו מופיעות ברשימה, ומזהי ה-source שלהן מוחרגים מדוח M.3 (D17.7).
// ---------------------------------------------------------------------------
export const REVIEW_FROM_DAY = '2026-10-15'; // התאריך הישראלי של ערב 0. מה שנרשם לפני תחילתו של היום הזה לא מוצג.
// 14 הערבים הנמדדים הם הערבים 16.10 עד 29.10.2026; האחרון נסגר ב-21:00 שעון ישראל של 29.10.2026. מעבר שעון החורף היה ב-25.10 (02:00), ולכן ב-29.10 ישראל ב-UTC+2: 19:00 UTC.
// הערך נבדק עם nextRunUtc של lib/schedule-time.js (לא בחישוב ידני). אחרי הרגע הזה לא מופיעות הודעות חדשות, ושאריות פוקעות לפי T3.
export const REVIEW_LAST_BOUNDARY = new Date('2026-10-29T19:00:00.000Z');

const TIME_ZONE = 'Asia/Jerusalem';
const BOUNDARY_HOUR = 21; // גבול היום (T2): 21:00 בישראל, כמו משבצת הסגירה (lib/message-slots.js)
const BOUNDARY_MINUTE = 0;
const HOUR_MS = 3600000;
const REVIEWED_EVENINGS = 3; // T3: הודעה מוצגת בשלושה ערבים בדיוק

// תחילת היום הישראלי REVIEW_FROM_DAY (00:00 מקומי) כרגע UTC: הגבול הראשון של 00:00 אחרי צהרי UTC של היום הקודם (שם כבר 14:00 לפחות בישראל, אותו יום קודם).
function startOfIsraeliDay(day) {
  const [year, month, date] = day.split('-').map(Number);
  return nextRunUtc({ hour: 0, minute: 0, timeZone: TIME_ZONE, from: new Date(Date.UTC(year, month - 1, date - 1, 12)) });
}
export const REVIEW_FROM_INSTANT = startOfIsraeliDay(REVIEW_FROM_DAY);

// ---------------------------------------------------------------------------
// חלון הזמן (T2, T3; 57 סעיף 5)
// ---------------------------------------------------------------------------

// 21:00 הבא אחרי from (תמיד אחריו בהחלט).
const nextBoundary = (from) => nextRunUtc({ hour: BOUNDARY_HOUR, minute: BOUNDARY_MINUTE, timeZone: TIME_ZONE, from });
// הגבול שלפני הגבול boundary: הגבול הבא אחרי boundary פחות 26 שעות. המרחק בין גבולות הוא 23 עד 25 שעות (מעבר שעון), ולכן 26 שעות נופלות תמיד לפני הגבול הקודם ואחרי זה שלפניו.
// מיוצא מאז C-1 (docs/08-chapter8/90 E8): חלון "נקלט היום" של הסגירה (lib/closing-view.js) משתמש באותו חישוב. ההתנהגות לא השתנתה.
export const previousBoundary = (boundary) => nextBoundary(new Date(boundary.getTime() - 26 * HOUR_MS));

// B: 21:00 האחרון שחלף (גם now שווה בדיוק ל-21:00 נותן אותו, ולכן "מ-B ואילך" מופיע).
export function lastBoundary(now = new Date()) {
  return previousBoundary(nextBoundary(now));
}

// החלון של now: { boundary: B, lower: B3 (בלעדי), upper: min(B, REVIEW_LAST_BOUNDARY) (כולל), from, last }.
// B3 = הגבול השלישי לפני B, מחושב גבול אחר גבול ב-JS (לא 72 שעות קבועות, כי מעבר שעון מזיז שעה).
export function reviewWindow(now = new Date()) {
  const boundary = lastBoundary(now);
  let lower = boundary;
  for (let i = 0; i < REVIEWED_EVENINGS; i += 1) lower = previousBoundary(lower);
  const upper = boundary.getTime() < REVIEW_LAST_BOUNDARY.getTime() ? boundary : REVIEW_LAST_BOUNDARY;
  return { boundary, lower, upper, from: REVIEW_FROM_INSTANT, last: REVIEW_LAST_BOUNDARY };
}

const toDate = (value) => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const iso = (value) => toDate(value)?.toISOString() ?? null;

// האם הודעה (recorded_at של התוצאה, received_at של המקור) בתוך החלון. שורה בלי זמנים תקינים אינה בתוכו.
export function inReviewWindow({ recordedAt, receivedAt }, window) {
  const recorded = toDate(recordedAt);
  const received = toDate(receivedAt);
  if (!recorded || !received) return false;
  const r = recorded.getTime();
  const s = received.getTime();
  return r > window.lower.getTime() && r <= window.upper.getTime() && r >= window.from.getTime()
    && s >= window.from.getTime() && s <= window.last.getTime();
}

// ---------------------------------------------------------------------------
// בחירת מה ממתין לסימון (T4, T5)
// ---------------------------------------------------------------------------

// היום הישראלי (YYYY-MM-DD) של רגע, לקיבוץ (T4).
function israeliDay(value) {
  const parts = localParts(toDate(value), TIME_ZONE);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

// שורות מהשאילתה { id, status, recorded_at, source_id, received_at, content_hash, checked, text? } -> השורות הממתינות לסימון.
// סדר הפעולות (T4): חלון, בלי duplicate, נציג אחד לכל (content_hash, יום ישראלי של received_at) = ה-outcome האחרון (recorded_at, ובשוויון id),
// ורק אחר כך מסתירים את מי שכבר סומן (הבחירה קודמת לסינון "סומן"; אחרת הודעה שנשלחה פעמיים הייתה מוצגת פעם נוספת).
// הנציג הוא כל שורה בחלון, גם כשנסתרה: רק היא מייצגת את הקבוצה. מחזיר מהוותיק לחדש (received_at, ובשוויון id).
export function dueRows(rows, window) {
  const inWindow = (Array.isArray(rows) ? rows : []).filter((row) => row && row.status !== 'duplicate'
    && inReviewWindow({ recordedAt: row.recorded_at, receivedAt: row.received_at }, window));
  const representatives = new Map();
  for (const row of inWindow) {
    const key = `${row.content_hash ?? row.source_id}|${israeliDay(row.received_at)}`;
    const current = representatives.get(key);
    if (!current || isLater(row, current)) representatives.set(key, row);
  }
  return [...representatives.values()]
    .filter((row) => row.checked !== true)
    .sort((a, b) => (toDate(a.received_at).getTime() - toDate(b.received_at).getTime()) || compareIds(a.id, b.id));
}

const compareIds = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
// row מאוחר מ-other: לפי recorded_at, ובשוויון המזהה (כמו ORDER BY o.recorded_at DESC, o.id DESC בכתיבה).
function isLater(row, other) {
  const a = toDate(row.recorded_at).getTime();
  const b = toDate(other.recorded_at).getTime();
  return a !== b ? a > b : compareIds(row.id, other.id) > 0;
}

// שמות השדות החסרים (מה שהמשתמש רואה). [הצעה]
const FIELD_LABELS = Object.freeze({
  subject: 'מקצוע', date: 'תאריך', new_date: 'תאריך חדש', topic: 'נושא', new_room: 'חדר', lesson: 'שיעור', time: 'שעה', confirm: 'אישור',
});
const UNKNOWN_LABEL = 'לא ידוע';

// מה שנרשם, בצורת formatReply בלי הקידומת "נרשם": "מבחן · מתמטיקה · שלישי 20.10". facts: Map של field -> value.
// התאריך: new_date בסוג move, date בשאר (כמו replyFor ב-lib/intake-process.js). לא זורק: סוג לא מוכר = null; תאריך חסר או לא תקין = מה שידוע.
// ערך unknown מוצג "לא ידוע".
export function resultText(facts) {
  const type = facts.get('type');
  if (!Object.hasOwn(TYPE_LABELS, type)) return null;
  const subject = facts.get('subject');
  const title = facts.get('topic'); // אירוע אישי: הכותרת במקום המקצוע (שלב 8.3-1)
  const date = facts.get(type === 'move' ? 'new_date' : 'date');
  try {
    return formatReply({ type, subject: subject === UNKNOWN_VALUE ? UNKNOWN_LABEL : subject, title: title === UNKNOWN_VALUE ? UNKNOWN_LABEL : title, date }).replace(/^נרשם · /, '');
  } catch (error) {
    if (!(error instanceof RangeError)) throw error; // formatReply זורק רק RangeError על סוג או תאריך
  }
  const parts = [TYPE_LABELS[type]];
  const headline = type === 'personal_event' ? title : subject; // אירוע אישי: הכותרת; יום מקוצר ויציאה מוקדמת: אין מקצוע
  if (type !== 'short_day' && type !== 'early_leave' && typeof headline === 'string' && headline.trim() !== '') parts.push(headline === UNKNOWN_VALUE ? UNKNOWN_LABEL : headline.trim());
  if (date === UNKNOWN_VALUE) parts.push(UNKNOWN_LABEL);
  return parts.join(' · ');
}

// "חסר" (57 סעיף 6): שם השדה החסר אינו שמור ב-messages (רק body חופשי). הבחירה (נרשמה כאן, כנדרש): רשימה כללית של כל השדות החיוניים של הסוג שאין להם עובדה,
// ולא pendingQuestion (lib/intake-process.js), כי pendingQuestion מחשב מחדש את החילוץ מהטקסט ודורש מערכת שעות, ומחזיר רק את השדה הבא. כאן הכול נגזר מהעובדות השמורות.
// מוצג רק כשקיימת שאלה פתוחה למקור (openQuestion); בלעדיה שדה חסר לא מוצג. ערך unknown נחשב קיים (ידוע-שאינו-ידוע), לא חסר.
export function missingFields(facts, openQuestion) {
  if (!openQuestion) return [];
  const essential = ESSENTIAL_FIELDS[facts.get('type')] ?? [];
  return essential.filter((field) => !facts.has(field)).map((field) => FIELD_LABELS[field]);
}

// הרשימה לדף: { total, items: [{ outcome_id, view, text, result, missing, at }] }. rows: מה ש-dueRows החזירה (עם text).
// facts: שורות { source_id, field, value }. openQuestionSourceIds: מקורות שיש להם שאלה פתוחה.
// תצוגה לפי קיום עובדת type (T5), לא לפי status: failed עם עובדות = recorded, unclassified = missed. סדר: missed קודם, ואחריו recorded, בכל חלק הוותיק קודם. בלי תקרה.
export function buildReview({ rows, facts, openQuestionSourceIds }) {
  const factsBySource = new Map();
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (!factsBySource.has(fact.source_id)) factsBySource.set(fact.source_id, new Map());
    factsBySource.get(fact.source_id).set(fact.field, fact.value);
  }
  const open = new Set(Array.isArray(openQuestionSourceIds) ? openQuestionSourceIds : []);
  const items = (Array.isArray(rows) ? rows : []).map((row) => {
    const sourceFacts = factsBySource.get(row.source_id) ?? new Map();
    const recorded = sourceFacts.has('type');
    return {
      outcome_id: row.id,
      view: recorded ? 'recorded' : 'missed',
      text: row.text ?? null,
      result: recorded ? resultText(sourceFacts) : null,
      missing: recorded ? missingFields(sourceFacts, open.has(row.source_id)) : [],
      at: iso(row.received_at),
    };
  });
  // המיון יציב: בתוך כל חלק נשמר הסדר של dueRows (הוותיק קודם).
  return { total: items.length, items: [...items.filter((i) => i.view === 'missed'), ...items.filter((i) => i.view === 'recorded')] };
}

// ---------------------------------------------------------------------------
// בדיקת בקשת סימון (T6; 57 סעיף 6)
// ---------------------------------------------------------------------------
export const REVIEW_VERDICTS = Object.freeze(['right', 'wrong', 'was_event', 'not_event']);
export const RECORDED_VERDICTS = Object.freeze(['right', 'wrong']); // תקפים רק לתצוגה "נרשם"
// D14. שלב 8.3-1: early_leave ו-personal_event נוספו כאן (שם בלבד); רשימת הכפתורים בצד הלקוח (public/index.html) לא שונתה.
export const EVENT_TYPES = Object.freeze(['short_day', 'cancel', 'move', 'exam', 'homework', 'room', 'early_leave', 'personal_event']);


// הצורה של verdict ו-event_type (בלי outcome_id; את ה-uuid בודק parseChatAction): ok רק כש-verdict אחד מארבעה, ו-event_type קיים בדיוק כש-verdict = was_event ואחד מהשישה.
// [הנחה, לא אומת] event_type ריק (null) נחשב כמו חסר.
export function validCheckShape({ verdict, eventType }) {
  if (!REVIEW_VERDICTS.includes(verdict)) return false;
  const present = eventType !== undefined && eventType !== null;
  if (verdict === 'was_event') return present && EVENT_TYPES.includes(eventType);
  return !present;
}

// ---------------------------------------------------------------------------
// שאילתות (ה-sql מוזרק). חלון הזמן עובר כפרמטרים (ISO), בלי חישוב תאריכים ב-SQL חוץ מהיום הישראלי לקיבוץ בכתיבה.
// ---------------------------------------------------------------------------
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const windowParams = (window) => ({
  lower: window.lower.toISOString(), upper: window.upper.toISOString(), from: window.from.toISOString(), last: window.last.toISOString(),
});

// ספירה בלי טקסט: מספר ההודעות הממתינות לסימון ברגע now. משותפת ל-loadBadge (api/chat.js) ול-loadNotifyState (lib/chat-notify.js), כדי שהמספר יהיה זהה (T8).
// שאילתה אחת, בלי raw_content; הבחירה והסינון ב-dueRows.
export async function countReviewDue(sql, now = new Date()) {
  const w = windowParams(reviewWindow(now));
  const rows = rowsOf(await sql`
    SELECT o.id, o.status, o.recorded_at, s.id AS source_id, s.received_at, s.content_hash,
      EXISTS (SELECT 1 FROM intake_checks c WHERE c.outcome_id = o.id) AS checked
    FROM intake_outcomes o JOIN sources s ON s.id = o.source_id
    WHERE s.channel = 'shortcut' AND o.status <> 'duplicate'
      AND o.recorded_at > ${w.lower}::timestamptz AND o.recorded_at <= ${w.upper}::timestamptz AND o.recorded_at >= ${w.from}::timestamptz
      AND s.received_at >= ${w.from}::timestamptz AND s.received_at <= ${w.last}::timestamptz
  `);
  return dueRows(rows, reviewWindow(now)).length;
}

// הרשימה המלאה לתצוגה (כולל טקסט ההודעה, T11): שאילתת מועמדים, ואם יש ממתינים, עובדות ושאלות פתוחות שלהם.
export async function loadReview(sql, now = new Date()) {
  const window = reviewWindow(now);
  const w = windowParams(window);
  const candidates = rowsOf(await sql`
    SELECT o.id, o.status, o.recorded_at, s.id AS source_id, s.raw_content AS text, s.received_at, s.content_hash,
      EXISTS (SELECT 1 FROM intake_checks c WHERE c.outcome_id = o.id) AS checked
    FROM intake_outcomes o JOIN sources s ON s.id = o.source_id
    WHERE s.channel = 'shortcut' AND o.status <> 'duplicate'
      AND o.recorded_at > ${w.lower}::timestamptz AND o.recorded_at <= ${w.upper}::timestamptz AND o.recorded_at >= ${w.from}::timestamptz
      AND s.received_at >= ${w.from}::timestamptz AND s.received_at <= ${w.last}::timestamptz
  `);
  const rows = dueRows(candidates, window);
  if (rows.length === 0) return { total: 0, items: [] };
  const ids = JSON.stringify([...new Set(rows.map((row) => row.source_id))]);
  const facts = rowsOf(await sql`
    SELECT f.source_id, f.field, f.value
    FROM jsonb_array_elements_text(${ids}::jsonb) AS t(id) JOIN facts f ON f.source_id = t.id::uuid
  `);
  const open = rowsOf(await sql`
    SELECT DISTINCT m.entity_id AS source_id
    FROM jsonb_array_elements_text(${ids}::jsonb) AS t(id) JOIN messages m ON m.entity_id = t.id::uuid
    WHERE m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type = 'source'
  `);
  return buildReview({ rows, facts, openQuestionSourceIds: open.map((row) => row.source_id) });
}

// כתיבת סימון: פקודת SQL אחת (INSERT ... SELECT ... WHERE ... RETURNING id), בלי טקסט הודעה בפרמטרים. אין UPDATE ואין DELETE (D5): סימון חוזר הוא שורה נוספת.
// התנאי (T6): ה-outcome הוא הנציג של קבוצתו בתוך החלון (אותה בחירה כמו dueRows), והתצוגה התואמת: right / wrong רק למי שיש לו עובדת type, was_event / not_event רק למי שאין.
// בלי התנאי "לא סומן" (שינוי מותר, תרחיש ב). מחזיר true כשנכתבה שורה, false כשה-outcome אינו ניתן לסימון (הדף מתרענן).
export async function writeCheck(sql, { outcomeId, verdict, eventType = null }, now = new Date()) {
  const w = windowParams(reviewWindow(now));
  const recordedView = verdict === 'right' || verdict === 'wrong';
  const written = rowsOf(await sql`
    INSERT INTO intake_checks (outcome_id, verdict, event_type)
    SELECT t.id, ${verdict}::text, ${eventType}::text
    FROM (
      SELECT o.id, s.id AS source_id,
        row_number() OVER (
          PARTITION BY COALESCE(s.content_hash, s.id::text), (s.received_at AT TIME ZONE 'Asia/Jerusalem')::date
          ORDER BY o.recorded_at DESC, o.id DESC
        ) AS rn
      FROM intake_outcomes o JOIN sources s ON s.id = o.source_id
      WHERE s.channel = 'shortcut' AND o.status <> 'duplicate'
        AND o.recorded_at > ${w.lower}::timestamptz AND o.recorded_at <= ${w.upper}::timestamptz AND o.recorded_at >= ${w.from}::timestamptz
        AND s.received_at >= ${w.from}::timestamptz AND s.received_at <= ${w.last}::timestamptz
    ) t
    WHERE t.id = ${outcomeId}::uuid AND t.rn = 1
      AND EXISTS (SELECT 1 FROM facts f WHERE f.source_id = t.source_id AND f.field = 'type') = ${recordedView}::boolean
    RETURNING id
  `);
  return written.length > 0;
}
