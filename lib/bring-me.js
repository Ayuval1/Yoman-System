// "תביא לי" (בלוק 8; docs/01-foundation/אפיון-מורחב.md ה-16): יובל מבקש בצ'אט תמונה ששמורה במאגר ("תביא לי את הלוח מהשיעור בהיסטוריה",
// "תביא לי מה שצילמתי בשיעור מתמטיקה ביום שלישי"). ה-AI מבין את הבקשה (kind = bring_me, subject, topic, date_text) והקוד מחפש במאגר;
// כשהמוח לא זמין, נתיב קוד בלבד: פועל פותח ("תביא לי" / "תשלח לי") + מקצוע לפי שורש (המילון) + ביטויי תאריך ושיעור.
// החיפוש לפי החוט המחבר (media.lesson_date / lesson_period, lib/lesson-link.js) ולפי מקצוע, תאריך ושם המשימה. התשובה מורכבת בקוד מהנתונים בלבד: לא ממציאים.
// פונקציות טהורות חוץ מ-loadMediaRows ו-answerBringMe (מסד). בלי רשת ובלי מודל.
import { tokenize, fin } from './intake-text.js';
import { findSubjects, SUBJECT_NAMES, isFunctionWord } from './intake-dictionary.js';
import { localDateIso, addDays, weekdayOf, isoOf, WEEKDAY_NAMES, formatDayMonth } from './intake-dates.js';

export const RECEIVED_REPLY = 'התקבל';
// הנחה, לא אומת: עד 4 תמונות בתשובה אחת (כדי שהבועה לא תתארך), מתוך 300 התמונות האחרונות במאגר. לא נמדד שימוש אמיתי.
export const MAX_REPLY_MEDIA = 4;
export const MEDIA_POOL = 300;

const words = (text) => tokenize(String(text ?? '')).tokens.map((token) => token.w);

// ---------------------------------------------------------------------------
// זיהוי הבקשה (נתיב הקוד)
// ---------------------------------------------------------------------------

const BRING_VERBS = new Set(['תביא', 'תשלח']);
// מילות "תמונה": הנחה, לא אומת: הרשימה נאספה מהדוגמאות של יובל (לוח, צילום, מה שצילמתי) ועוד מילים סבירות (מחברת, סיכום, שקף, דף). קידומות ה/ב/מ/ל/ו.
const MEDIA_WORD = new RegExp(`^[ובלמש]?ה?(?:${['לוח', 'לוחות', 'תמונה', 'תמונות', 'צילום', 'צילומים', 'צילמתי', 'מחברת', 'סיכום', 'שקף', 'שקפים', 'דף', 'שיעור'].map(fin).join('|')})$`);

// "תביא לי ..." / "תשלח לי ..." בתחילת הודעה, ובנוסף מקצוע או מילת תמונה. "תביא לי מים" אינו בקשה למאגר.
export function detectBringMe(text) {
  if (typeof text !== 'string') return false;
  const w = words(text);
  if (w.length < 3 || !BRING_VERBS.has(w[0]) || w[1] !== 'לי') return false;
  return findSubjects(text).length > 0 || w.slice(2).some((word) => MEDIA_WORD.test(word));
}

// ---------------------------------------------------------------------------
// קריאת הפרטים: תאריך (עבר), שיעור
// ---------------------------------------------------------------------------

const DAY_BY_WORD = new Map(WEEKDAY_NAMES.map((name, index) => [fin(name), index]));
const DAY_BY_LETTER = new Map([['א', 0], ['ב', 1], ['ג', 2], ['ד', 3], ['ה', 4], ['ו', 5], ['ש', 6]]);
const YOM = /^[בלמ]?יומ$/;
const LAST_WORD = /^(?:שעבר|שעברה)$/;
const EXPLICIT_DATE = /^(\d{1,2})[./](\d{1,2})$/;

function validIso(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? isoOf(year, month, day) : null;
}

// ביטוי תאריך של בקשה על העבר -> YYYY-MM-DD (תאריך לוח ישראלי) או null. בקשות "תביא לי" הן על מה שכבר צולם, ולכן "ביום שלישי" = השלישי האחרון (עד היום, כולל),
// "ביום שלישי שעבר" = השלישי האחרון לפני היום, ו"3.12" שעוד לא הגיע = השנה שעברה. מחושב בקוד (lib/intake-dates.js), ה-AI לא מחשב תאריכים.
// אתמול, שלשום, היום. הנחה, לא אומת: "שבוע שעבר" לבד (בלי יום) ו"לפני X ימים" אינם נתמכים.
export function resolveRequestDate(text, receivedAt) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let today;
  try {
    today = localDateIso(receivedAt);
  } catch {
    return null;
  }
  const w = words(text);
  const last = w.some((word) => LAST_WORD.test(word));
  for (let i = 0; i < w.length; i += 1) {
    const word = w[i];
    if (/^[בלמ]?אתמול$/.test(word)) return addDays(today, -1);
    if (/^[בלמ]?שלשומ$/.test(word)) return addDays(today, -2);
    if (/^[בלמ]?היומ$/.test(word) || word === 'הימ') return today;
    const explicit = EXPLICIT_DATE.exec(word);
    if (explicit) {
      const year = Number(today.slice(0, 4));
      const iso = validIso(year, Number(explicit[2]), Number(explicit[1]));
      if (iso === null) return null;
      return iso > today ? validIso(year - 1, Number(explicit[2]), Number(explicit[1])) : iso;
    }
    // יום בשבוע: אחרי "יום" (ביום שלישי, יום ג), או צמוד לקידומת ב (בשלישי). "שיעור שלישי" אינו יום.
    let weekday = null;
    if (YOM.test(w[i - 1] ?? '')) weekday = DAY_BY_WORD.get(word) ?? DAY_BY_LETTER.get(word) ?? null;
    else if (word.length > 2 && word[0] === 'ב') weekday = DAY_BY_WORD.get(word.slice(1)) ?? null;
    if (weekday !== null) {
      let back = (weekdayOf(today) - weekday + 7) % 7;
      if (last && back === 0) back = 7;
      return addDays(today, -back);
    }
  }
  return null;
}

const ORDINALS = new Map([['ראשון', 1], ['שני', 2], ['שלישי', 3], ['רביעי', 4], ['חמישי', 5], ['שישי', 6], ['שביעי', 7], ['שמיני', 8], ['תשיעי', 9],
  ['ראשונה', 1], ['שנייה', 2], ['שלישית', 3], ['רביעית', 4], ['חמישית', 5], ['שישית', 6], ['שביעית', 7], ['שמינית', 8], ['תשיעית', 9]].map(([k, v]) => [fin(k), v]));
const LESSON_WORD = /^[בלמ]?ה?שיעור$/;

// מספר השיעור מ"שיעור 3" / "שיעור שלישי" / "בשיעור השלישי", או null.
function periodFrom(text) {
  const w = words(text);
  for (let i = 0; i < w.length - 1; i += 1) {
    if (!LESSON_WORD.test(w[i])) continue;
    const next = w[i + 1];
    if (/^[1-9]$/.test(next)) return Number(next);
    const ordinal = ORDINALS.get(next.replace(/^ה/, '')) ?? ORDINALS.get(next);
    if (ordinal !== undefined) return ordinal;
  }
  return null;
}

// הבקשה כפי שהקוד קורא אותה. understanding (אופציונלי): מה שהמוח העתיק (subject מהרשימה הסגורה, topic, date_text). בלעדיו: הכול מהטקסט.
// מקצוע שהמוח החזיר ואינו ברשימה נפסל; מקצועות מהמילון (שורש) מהטקסט נוספים תמיד כשהמוח לא נתן מקצוע.
export function readRequest({ text, receivedAt, understanding = null }) {
  const brainSubject = understanding && SUBJECT_NAMES.includes(understanding.subject) ? understanding.subject : null;
  const subjects = brainSubject ? [brainSubject] : [...new Set(findSubjects(text ?? '').map((hit) => hit.subject))];
  const dateText = understanding && typeof understanding.date_text === 'string' && understanding.date_text.trim() !== '' ? understanding.date_text : text;
  const topic = understanding && typeof understanding.topic === 'string' && understanding.topic.trim() !== '' ? understanding.topic.trim() : null;
  return { subjects, date: resolveRequestDate(dateText, receivedAt), period: periodFrom(text ?? ''), topic };
}

// ---------------------------------------------------------------------------
// חיפוש במאגר
// ---------------------------------------------------------------------------

// תאריך מהמסד (date יכול לחזור כמחרוזת או כ-Date) -> YYYY-MM-DD או null.
function isoDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

// שורת media -> { id, date, period, subject, subjects, title, at }. המקצוע מהמערכת (השיעור לפי lesson_date + lesson_period) גובר על העמודה, והעמודה נשמרת כאפשרות נוספת.
function describeRow(row, timetable) {
  let receivedDate = null; // תמונה בלי קישור לשיעור: התאריך שבו התקבלה, שעון ישראל
  try {
    receivedDate = localDateIso(row.received_at);
  } catch { /* חותמת חסרה או לא תקינה: בלי תאריך */ }
  const date = isoDate(row.lesson_date) ?? receivedDate;
  const period = Number.isInteger(Number(row.lesson_period)) && row.lesson_period !== null ? Number(row.lesson_period) : null;
  let lessonSubject = null;
  if (period !== null && isoDate(row.lesson_date) !== null) {
    const weekday = weekdayOf(isoDate(row.lesson_date)) + 1;
    lessonSubject = (timetable?.slots ?? []).find((slot) => slot.weekday === weekday && slot.period === period)?.subject ?? null;
  }
  const column = typeof row.subject === 'string' && row.subject.trim() !== '' ? row.subject.trim() : null;
  const subjects = [...new Set([lessonSubject, column].filter(Boolean))];
  const at = row.received_at instanceof Date ? row.received_at.getTime() : Date.parse(row.received_at);
  return { id: row.id, date, period, subject: lessonSubject ?? column, subjects, title: typeof row.task_title === 'string' ? row.task_title : null, at: Number.isNaN(at) ? 0 : at };
}

// נושא: כל מילת תוכן של הנושא (3 אותיות ומעלה, בלי מילות יחס, בלי קידומת ה/ב/ל/מ/ו) מופיעה בשם המשימה.
function topicMatches(topic, title) {
  if (!topic) return true;
  if (!title) return false;
  const titleWords = words(title);
  const wanted = words(topic).filter((word) => word.length >= 3 && !isFunctionWord(word)).map((word) => (word.length > 3 ? word.replace(/^[הבלמו]/, '') : word));
  return wanted.length > 0 && wanted.every((stem) => titleWords.some((titleWord) => titleWord.includes(stem)));
}

const view = ({ id, date, period, subject }) => ({ id, date, period, subject });

// rows: שורות media ({ id, received_at, subject, lesson_date, lesson_period, task_title }). request: מ-readRequest.
// { kind: 'exact', items } כשיש התאמה לכל מה שנתבקש; { kind: 'near', items } כשאין, אבל יש תמונות מאותו מקצוע (או מאותו יום, כשלא נתבקש מקצוע); { kind: 'none', items: [] }.
// כל רשימה: החדשה קודם, עד limit. בקשה בלי שום סינון: התמונות האחרונות.
export function searchMedia({ rows, timetable, request, limit = MAX_REPLY_MEDIA }) {
  const described = (Array.isArray(rows) ? rows : []).map((row) => describeRow(row, timetable)).sort((a, b) => b.at - a.at);
  const bySubject = (item) => request.subjects.length === 0 || item.subjects.some((s) => request.subjects.includes(s));
  const exact = described.filter((item) => bySubject(item)
    && (request.date === null || item.date === request.date)
    && (request.period === null || item.period === request.period)
    && topicMatches(request.topic, item.title));
  if (exact.length > 0) return { kind: 'exact', items: exact.slice(0, limit).map(view) };
  const near = request.subjects.length > 0
    ? described.filter(bySubject)
    : request.date !== null ? described.filter((item) => item.date === request.date) : [];
  if (near.length > 0) return { kind: 'near', items: near.slice(0, limit).map(view) };
  return { kind: 'none', items: [] };
}

// ---------------------------------------------------------------------------
// התשובה
// ---------------------------------------------------------------------------

const lineOf = (item, withSubject) => {
  const day = item.date ? `${WEEKDAY_NAMES[weekdayOf(item.date)]} ${formatDayMonth(item.date)}` : 'בלי תאריך';
  return [day, item.period ? `שיעור ${item.period}` : null, withSubject ? item.subject : null].filter(Boolean).join(', ');
};

// הנוסח נבנה בקוד מהנתונים: מספר התמונות, מקצוע (מהבקשה) ושורה לכל תמונה. בלי AI, בלי ניחוש.
export function composeReply({ request, result }) {
  const scope = request.subjects.map((s) => `ב${s}`).join(' ו');
  const filtered = request.subjects.length > 0 || request.date !== null || request.period !== null || request.topic !== null;
  if (result.kind === 'none') {
    if (scope) return `אין לי תמונות שמורות מהשיעור ${scope}.`;
    return filtered ? 'לא מצאתי תמונות שמורות לפי מה שביקשת.' : 'אין לי עדיין תמונות שמורות.';
  }
  const lines = result.items.map((item) => lineOf(item, request.subjects.length === 0));
  const count = result.items.length === 1 ? 'תמונה אחת' : `${result.items.length} תמונות`;
  const head = result.kind === 'exact'
    ? `מצאתי ${count}${scope ? ` מהשיעור ${scope}` : ''}:`
    : `לא מצאתי בדיוק את מה שביקשת. הכי קרוב${scope ? `, מהשיעור ${scope}` : ''}:`;
  return [head, ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// מסד
// ---------------------------------------------------------------------------

const rowsOf = (result) => (Array.isArray(result) ? result : []);

// התמונות השמורות (לא נמחקו), החדשות קודם. שם המשימה (נושא) מ-tasks אם התמונה צורפה למשימה.
export async function loadMediaRows(sql) {
  return rowsOf(await sql`
    SELECT m.id, m.received_at, m.subject, m.lesson_date, m.lesson_period, t.title AS task_title
    FROM media m LEFT JOIN tasks t ON t.id = m.task_id
    WHERE m.status = 'stored' AND m.deleted_at IS NULL AND m.content_type LIKE 'image/%'
    ORDER BY m.received_at DESC NULLS LAST
    LIMIT ${MEDIA_POOL}::int
  `);
}

// התשובה לבקשה: מחפש, ואז פקודה אחת אטומית: תפיסת המקור + בועת update + קישורי הבועה לתמונות (links: message -> media, relates_to).
// הצ'אט מציג את התמונות לפי הקישורים (api/chat.js, items[].media). status 'recorded' כמו "אני פנוי?", כדי שגם הודעה שהתקבלה תקבל התראה.
// כשל מסד בחיפוש זורק (הצינור כמו בשאר הסוגים). המקור שכבר טופל: skipped.
export async function answerBringMe({ sql, source, timetable, understanding = null }) {
  const request = readRequest({ text: source.raw_content, receivedAt: source.received_at, understanding });
  const result = searchMedia({ rows: await loadMediaRows(sql), timetable, request });
  const reply = composeReply({ request, result });
  const mediaIds = JSON.stringify(result.items.map((item) => item.id));
  const written = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer
      FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    ), l AS (
      INSERT INTO links (from_type, from_id, to_type, to_id, relation)
      SELECT 'message', b.id, 'media', m.value::uuid, 'relates_to'
      FROM b, jsonb_array_elements_text(${mediaIds}::jsonb) AS m
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM b)::int AS bubbles_written
  `);
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply };
}
