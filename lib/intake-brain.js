// הבנת הודעה במוח (בלוק 3ב-1; docs/01-foundation/אפיון-מורחב.md ה-2, ה-3, ה-6, ה-9, ח-1 וסעיף 4).
// כל הודעה נכנסת (מוקלדת או מועברת) נקראת קודם במוח, דרך lib/brain/ask.js בלבד (זו הדרך היחידה למודל). המוח מחזיר מה כתוב:
// סוג מרשימה סגורה (הסוגים שהצינור כבר יודע לטפל בהם), ביטויי תאריך ושעה מילה במילה, ורשימת uncertain של פרטים שחסרים.
// הקוד עושה את השאר כמו היום: חישובי תאריכים (lib/intake-dates.js), השלמה ממערכת השעות, הרשאות, כתיבה ליומן, שאלות.
// המודל לא מקבל את תאריך הקליטה ולא מחשב תאריכים (03-brain-module-rules.md, "מה לא נטען").
//
//   understandSource({ sql, source, replyTo?, now?, apiKey?, fetchFn?, ask?, candidates?, loadCandidates?, taskCandidates?, loadTaskCandidates? })
//     אירועים קיימים לזיהוי (בלוק 4, lib/event-match.js) ומשימות פתוחות שיכולות להיות משימת-אב (תתי-משימות, lib/subtask.js): רשימה מוכנה או פונקציה אסינכרונית שמחזירה אותה
//     -> { ok: true, model, understanding } | { ok: false, reason: 'no-key' | 'no-pool' | 'exhausted' | 'failed' | 'timeout' }
//   mergeUnderstanding({ extracted, understanding, receivedAt, text })  פונקציה טהורה: ממזגת את מה שהמוח קרא לתוצאת extractFacts של אותו סוג.
//   isValidUnderstanding(data, text)  בדיקת הפורמט. תשובה שלא עוברת = askBrain עובר למודל הבא.
//
// פרטיות: הטקסט לא נרשם בשום לוג כאן. מספרי טלפון מוחלפים ב-askBrain (scrub) לפני השליחה.
import { askBrain } from './brain/ask.js';
import { TYPES, SUBJECT_NAMES, findTimeReading } from './intake-dictionary.js';
import { ESSENTIAL_FIELDS, assessFacts, isUnderstood, isTimedType, validRangeEnd } from './intake-facts.js';
import { resolveDates } from './intake-dates.js';
import { tokenize } from './intake-text.js';

// הסוגים שהמוח מחזיר: סוגי הצינור (lib/intake-dictionary.js TYPES), ועוד שלושה שהצינור מטפל בהם כ"לא מסווג": משימה, שאלה, ואחר.
export const NON_TYPE_KINDS = Object.freeze(['task', 'question', 'other']);
// בלוק 3ב-2: "לא זמין" (ח-2, lib/unavailable.js) ו"אני פנוי?" (ח-6, lib/free-check.js). המוח רק מזהה ומעתיק ביטויים; החישוב בקוד.
export const AVAILABILITY_KINDS = Object.freeze(['unavailable', 'free_check']);
// בלוק 8 ("תביא לי", lib/bring-me.js): יובל מבקש תמונה שמורה. המוח מעתיק מקצוע, נושא וביטוי תאריך; החיפוש והתאריכים בקוד.
export const RETRIEVAL_KINDS = Object.freeze(['bring_me']);
// 24.11.2026 (דרך ב', כלים כלליים): שאלה חופשית על הלוח ("מה יש לי מחר?", "מתי המבחן בהיסטוריה?"). המוח מעתיק ביטויים; החישוב והתשובה בקוד (lib/show-request.js).
export const QUERY_KINDS = Object.freeze(['schedule_query']);
export const BRAIN_KINDS = Object.freeze([...TYPES, ...AVAILABILITY_KINDS, ...RETRIEVAL_KINDS, ...QUERY_KINDS, ...NON_TYPE_KINDS]);
// שדות הטקסט בתשובה. *_text = ביטוי מההודעה, מילה במילה (נבדק שהוא באמת מופיע בה).
// end_date_text (24.11.2026): היום האחרון של אירוע אישי של כמה ימים ("עד יום רביעי", "3.12"), באותה צורה כמו date_text. מופיע בפלט המנורמל רק כשיש בו ערך (שאר הסוגים לא משתנים).
const TEXT_FIELDS = Object.freeze(['subject', 'topic', 'date_text', 'new_date_text', 'time_text', 'new_room', 'end_date_text']);
const VERBATIM_FIELDS = Object.freeze(['date_text', 'new_date_text', 'time_text', 'new_room', 'end_date_text']);
export const UNCERTAIN_FIELDS = Object.freeze(['date', 'new_date', 'time', 'subject', 'topic', 'new_room', 'lesson', 'end_date']);
// הנחה, לא אומת: תקרות. ערך ארוך מזה אינו קריאה של שדה אלא העתקה של ההודעה.
const MAX_FIELD_LENGTH = 200;
const MAX_CONTEXT_LENGTH = 1000;
// הנחה, לא אומת: 6 שניות לכל מודל ו-10 לכל ההבנה. לא נמדד זמן תשובה בעבודה אמיתית. אחרי 10 שניות: המסלול של הקוד (api/intake.js מחכה עד 20).
export const MODEL_TIMEOUT_MS = 6000;
export const UNDERSTAND_TIMEOUT_MS = 10000;
// סיבות כשל שבהן ההודעה נשמרת לטיפול חוזר כשהמכסה חוזרת. no-key לא: בלי מפתח אין למה לחזור.
export const RETRY_REASONS = Object.freeze(['no-pool', 'exhausted', 'failed', 'timeout']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REPLY_ROLES = Object.freeze(['user', 'system']);

// ---------------------------------------------------------------------------
// הפרומפט
// ---------------------------------------------------------------------------

// שני כללי-היסוד, בניסוח של יובל (03-brain-module-rules.md: "הניסוח הוא של יובל ואינו משופר"). נטענים לכל קריאה.
export const BASE_RULES = '1. ספר רק מידע מבוסס, מאומת ועדכני\n2. אם אין מקור מאומת — אל תשלים מידע ואל תנחש. כתוב במפורש: "אין באפשרותי לאשר זאת" והסבר מה חסר';

const KIND_LINES = [
  'homework: שיעורי בית שצריך להגיש',
  'exam: מבחן או בוחן',
  'cancel: ביטול שיעור או שיעורים',
  'move: הזזה או דחייה של שיעור או מבחן למועד אחר',
  'room: החלפת חדר או כיתה לשיעור',
  'short_day: יום לימודים מקוצר',
  'early_leave: יובל יוצא מוקדם מבית הספר',
  'personal_event: כל אירוע אישי של יובל (פגישה, תור, רופא, הופעה, אימון, נסיעה, טיול, חופשה, מחנה, תחרות), ביום אחד או בכמה ימים, עם שעה או בלי. אירוע של כמה ימים: date_text הוא היום הראשון ו-end_date_text היום האחרון',
  'unavailable: יובל מודיע שהוא לא זמין או עסוק בזמן מסוים ("אני לא זמין ב-5"). topic: הסיבה, אם כתובה',
  'free_check: שאלה אם יובל פנוי בזמן מסוים ("אני פנוי ביום שלישי ב-6?", "מחר ב-6?")',
  'bring_me: יובל מבקש שיביאו לו תמונה או חומר ששמור מהשיעורים ("תביא לי את הלוח מהשיעור בהיסטוריה", "תביא לי מה שצילמתי בשיעור מתמטיקה ביום שלישי"). subject, date_text ו-topic כרגיל; topic: נושא השיעור, אם כתוב',
  'schedule_query: יובל שואל מה מתוכנן לו או מתי משהו ("מה יש לי מחר?", "מה יש לי מחמישי עד שבת?", "מה יש לי שבוע הבא?", "מתי המבחן בהיסטוריה?"). לא שאלה אם הוא פנוי בשעה מסוימת (זה free_check). date_text: היום שעליו שואלים, end_date_text: היום האחרון בטווח, subject: המקצוע אם שואלים על מבחן',
  'task: משימה שיובל צריך לעשות, בלי מועד של אירוע',
  'question: שאלה שמחכה לתשובה',
  'other: כל דבר אחר (ברכה, מידע כללי, פקודה)',
];

// prompt: הטקסט שנשלח. context (אופציונלי): ההודעה שיובל הגיב עליה ("הגב"), כהקשר בלבד.
// candidates (אופציונלי, בלוק 4, lib/event-match.js): אירועים קיימים [{ key: 'e1', label }]. כשיש: המוח מחזיר גם match (מפתח או null) ו-match_sure.
// tasks (אופציונלי, תתי-משימות 22.11.2026, lib/subtask.js): משימות פתוחות [{ key: 't1', label }]. כשיש: המוח מחזיר גם parent (מפתח או null) ו-parent_text (ביטוי מההודעה).
// בלעדיהם הפרומפט זהה תו בתו למה שהיה.
export function buildPrompt({ text, context = null, candidates = [], tasks = [] }) {
  const lines = [
    'אתה קורא הודעה בעברית ומחזיר מה כתוב בה. לא מסיקים, לא מחשבים תאריכים, לא משלימים.',
    'שני כללים שחלים תמיד:',
    BASE_RULES,
    '',
    'kind: בחר אחד בלבד מהרשימה:',
    ...KIND_LINES.map((line) => `- ${line}`),
    '',
    `שמות המקצועות: ${SUBJECT_NAMES.join(', ')}. מקצוע בהודעה בקיצור או בשם אחר: החזר את השם מהרשימה. לא מוזכר מקצוע: null.`,
    'date_text, new_date_text, time_text, new_room: העתק את הביטוי מההודעה מילה במילה (למשל "שבת הבאה", "מחר", "ב-20:00"). אל תתרגם לתאריך. לא כתוב: null.',
    'new_date_text: רק בהזזה, המועד החדש. date_text: בהזזה, המועד המקורי.',
    'end_date_text: רק ב-personal_event של כמה ימים (חופשה, טיול, מחנה), היום האחרון, מילה במילה ("עד רביעי", "3.12"). אירוע ביום אחד, או שהיום האחרון לא כתוב: null. אם ברור שהאירוע נמשך כמה ימים והיום האחרון לא ברור: הוסף "end_date" ל-uncertain.',
    'topic: הנושא או שם האירוע, במילים מההודעה, בלי תאריך ושעה. לא כתוב: null.',
    `uncertain: רשימת הפרטים הדרושים שלא כתובים בהודעה או שיש להם יותר מקריאה אחת, מתוך: ${UNCERTAIN_FIELDS.join(', ')}. אין: [].`,
    'החזר JSON בלבד, בדיוק במבנה הזה:',
    '{"kind": "...", "subject": null, "topic": null, "date_text": null, "new_date_text": null, "time_text": null, "new_room": null, "end_date_text": null, "uncertain": []}',
  ];
  const list = candidateList(candidates);
  if (list.length > 0) {
    lines.push(
      '',
      'אירועים שכבר רשומים (מפתח: כותרת · יום · שעה):',
      ...list.map(({ key, label }) => `${key}: ${label}`),
      'match: אם ההודעה מדברת על אחד האירועים האלה (שינוי שעה, דחייה, הקדמה, ביטול, או אותו אירוע שוב), החזר את המפתח שלו. אירוע אחר או חדש: null.',
      'match_sure: true רק אם ברור שזה אותו אירוע; אם ייתכן שזה אירוע אחר: false.',
      'הוסף לתשובה את השדות "match" ו-"match_sure".',
    );
  }
  const taskList = taskCandidateList(tasks);
  if (taskList.length > 0) {
    lines.push(
      '',
      'משימות פתוחות שכבר רשומות (מפתח: כותרת):',
      ...taskList.map(({ key, label }) => `${key}: ${label}`),
      'parent: רק כש-kind הוא task: אם המשימה בהודעה היא חלק מאחת המשימות האלה (שלב בדרך אליה), החזר את המפתח שלה. לא קשורה, או לא task: null.',
      'parent_text: רק כש-kind הוא task: אם ההודעה אומרת במפורש שהמשימה שייכת למשימה אחרת (למשל "למצגת בהיסטוריה", "תת-משימה של המצגת"), העתק מילה במילה רק את שם המשימה האחרת. אחרת: null.',
      'הוסף לתשובה את השדות "parent" ו-"parent_text".',
    );
  }
  if (typeof context === 'string' && context.trim() !== '') {
    lines.push('', 'ההודעה היא תגובה להודעה קודמת. ההודעה הקודמת, להקשר בלבד (לא להעתיק ממנה ביטויים):', `«${context.slice(0, MAX_CONTEXT_LENGTH)}»`);
  }
  lines.push('', 'ההודעה:', `«${String(text ?? '')}»`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// בדיקת הפורמט
// ---------------------------------------------------------------------------

// המועמדים התקינים: { key, label } עם key בצורה eN. עד MAX_CANDIDATES.
const MAX_CANDIDATES = 20;
function candidateList(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && typeof c.key === 'string' && /^e\d+$/.test(c.key) && typeof c.label === 'string' && c.label.trim() !== '')
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({ key: c.key, label: c.label.trim().slice(0, MAX_FIELD_LENGTH) }));
}

// משימות פתוחות (תתי-משימות): { key, label } עם key בצורה tN. אותה תקרה.
function taskCandidateList(tasks) {
  return (Array.isArray(tasks) ? tasks : [])
    .filter((c) => c && typeof c.key === 'string' && /^t\d+$/.test(c.key) && typeof c.label === 'string' && c.label.trim() !== '')
    .slice(0, MAX_CANDIDATES)
    .map((c) => ({ key: c.key, label: c.label.trim().slice(0, MAX_FIELD_LENGTH) }));
}

// true רק לתשובה בדיוק בפורמט: kind מהרשימה, שדות טקסט null או מחרוזת קצרה, ביטויים מילה במילה שמופיעים בהודעה (מודל שהמציא ביטוי = המודל הבא),
// ו-uncertain רשימה מהשדות המותרים. keys (בלוק 4): מפתחות המועמדים שנשלחו; match שאינו אחד מהם = לא בפורמט. בלי keys: match לא נבדק (ולא נשמר).
// taskKeys (תתי-משימות): מפתחות המשימות שנשלחו; parent שאינו אחד מהם = לא בפורמט, ו-parent_text חייב להופיע בהודעה מילה במילה. בלי taskKeys: לא נבדקים (ולא נשמרים).
export function isValidUnderstanding(data, text, keys = null, taskKeys = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (!BRAIN_KINDS.includes(data.kind)) return false;
  const message = typeof text === 'string' ? text : '';
  for (const field of TEXT_FIELDS) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) return false;
    if (VERBATIM_FIELDS.includes(field) && value.trim() !== '' && !message.includes(value.trim())) return false;
  }
  if (!Array.isArray(data.uncertain) || data.uncertain.length > UNCERTAIN_FIELDS.length) return false;
  if (Array.isArray(keys) && keys.length > 0) {
    if (data.match !== undefined && data.match !== null && !keys.includes(data.match)) return false;
    if (data.match_sure !== undefined && data.match_sure !== null && typeof data.match_sure !== 'boolean') return false;
  }
  if (Array.isArray(taskKeys) && taskKeys.length > 0) {
    if (data.parent !== undefined && data.parent !== null && !taskKeys.includes(data.parent)) return false;
    const ref = data.parent_text;
    if (ref !== undefined && ref !== null) {
      if (typeof ref !== 'string' || ref.length > MAX_FIELD_LENGTH) return false;
      if (ref.trim() !== '' && !message.includes(ref.trim())) return false;
    }
  }
  return data.uncertain.every((field) => UNCERTAIN_FIELDS.includes(field));
}

// צורה אחידה: כל שדה מחרוזת לא ריקה או null; uncertain בלי כפילויות. keys (בלוק 4): רק כשנשלחו מועמדים נוספים match (מפתח או null) ו-match_sure.
function normalize(data, keys = null, taskKeys = null) {
  const out = { kind: data.kind, uncertain: [...new Set(data.uncertain)] };
  for (const field of TEXT_FIELDS) {
    const value = typeof data[field] === 'string' ? data[field].trim() : '';
    if (field === 'end_date_text' && value === '') continue; // שדה חדש: מופיע רק כשיש בו ערך
    out[field] = value === '' ? null : value;
  }
  if (Array.isArray(keys) && keys.length > 0) {
    out.match = keys.includes(data.match) ? data.match : null;
    out.match_sure = out.match !== null && data.match_sure === true;
  }
  if (Array.isArray(taskKeys) && taskKeys.length > 0) {
    out.parent = taskKeys.includes(data.parent) ? data.parent : null;
    out.parent_text = typeof data.parent_text === 'string' && data.parent_text.trim() !== '' ? data.parent_text.trim() : null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// הקשר "הגב"
// ---------------------------------------------------------------------------

// { id, role } תקין או null. id = uuid (מזהה של sources או של messages), role = user (הודעה של יובל) או system (בועה של המערכת).
export function parseReplyTo(id, role) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (!REPLY_ROLES.includes(role)) return null;
  return { id, role };
}

// הטקסט של ההודעה המצוטטת, או null (לא נמצאה, או כשל: מתעלמים בשקט). user = sources מהקיצור או מהצ'אט; system = בועת update יוצאת.
export async function loadReplyContext(sql, replyTo) {
  if (!replyTo) return null;
  try {
    const rows = replyTo.role === 'user'
      ? await sql`SELECT raw_content AS text FROM sources WHERE id = ${replyTo.id}::uuid AND channel IN ('shortcut', 'app')`
      : await sql`SELECT body AS text FROM messages WHERE id = ${replyTo.id}::uuid AND direction = 'out'`;
    const text = Array.isArray(rows) ? rows[0]?.text : null;
    return typeof text === 'string' && text.trim() !== '' ? text.slice(0, MAX_CONTEXT_LENGTH) : null;
  } catch (error) {
    console.error('intake-brain: טעינת ההודעה המצוטטת נכשלה:', error?.name);
    return null;
  }
}

// ---------------------------------------------------------------------------
// הקריאה
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function understandSource({
  sql,
  source,
  replyTo = null,
  now = new Date(),
  apiKey = process.env.GEMINI_API_KEY,
  fetchFn = fetch,
  ask = askBrain,
  timeoutMs = UNDERSTAND_TIMEOUT_MS,
  candidates = [],
  loadCandidates = null,
  taskCandidates = [],
  loadTaskCandidates = null,
}) {
  // בלי מפתח: המוח לא מוגדר. בלי קריאה ובלי לוג (askBrain היה כותב שגיאה על כל הודעה).
  if (!apiKey) return { ok: false, reason: 'no-key' };
  const text = String(source?.raw_content ?? '');
  try {
    // loadCandidates (בלוק 4): נקרא רק כאן, אחרי בדיקת המפתח, כדי שבלי מוח לא תיווסף שאילתה.
    const list = candidateList(typeof loadCandidates === 'function' ? await loadCandidates() : candidates);
    const keys = list.map((c) => c.key);
    // loadTaskCandidates (תתי-משימות): כמו loadCandidates, נקרא רק אחרי בדיקת המפתח.
    const tasks = taskCandidateList(typeof loadTaskCandidates === 'function' ? await loadTaskCandidates() : taskCandidates);
    const taskKeys = tasks.map((c) => c.key);
    const context = await loadReplyContext(sql, replyTo);
    const result = await withTimeout(ask({
      sql, fetchFn, apiKey, now,
      prompt: buildPrompt({ text, context, candidates: list, tasks }),
      schema: (data) => isValidUnderstanding(data, text, keys, taskKeys),
      timeoutMs: MODEL_TIMEOUT_MS,
    }), timeoutMs);
    if (!result?.ok) return { ok: false, reason: result?.reason ?? 'failed' };
    return { ok: true, model: result.model, understanding: normalize(result.data, keys, taskKeys) };
  } catch (error) {
    console.error('intake-brain: הבנת ההודעה נכשלה:', error?.name);
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'failed' };
  }
}

// ---------------------------------------------------------------------------
// מיזוג: מה שהמוח קרא + מה שהקוד חילץ
// ---------------------------------------------------------------------------

// תאריך מביטוי שהמוח העתיק: החישוב בקוד (resolveDates). { value } לתאריך אחד, { candidates } לכמה, null לכלום.
function dateFrom(expression, receivedAt) {
  if (!expression) return null;
  let mentions;
  try {
    mentions = resolveDates(expression, receivedAt);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const dates = [...new Set(mentions.flatMap((m) => (m.ambiguous ? m.candidates : [m.date])))];
  if (dates.length === 1) return { value: dates[0] };
  return dates.length > 1 ? { candidates: dates } : null;
}

// שעה מביטוי שהמוח העתיק: הקריאה בקוד (findTimeReading). אותו מבנה.
function timeFrom(expression) {
  if (!expression) return null;
  const { clean, tokens } = tokenize(expression);
  const words = tokens.map((token) => token.w);
  const found = findTimeReading(words, { words, clean, tokens });
  if (!found || found.candidates.length === 0) return null;
  return found.candidates.length === 1 ? { value: found.candidates[0] } : { candidates: [...found.candidates] };
}

// כללי המיזוג (הכרעה טכנית, בלוק 3ב-1):
//  - הסוג הוא של המוח (ה-2); extracted הוא תוצאת extractFacts עם forcedType = הסוג הזה.
//  - שדה שהמוח סימן uncertain ואין לו ביטוי בהודעה: עובדה שהקוד הסיק (origin 'inferred', למשל "בלי תאריך = היום") נמחקת, כדי שתישאל שאלה ולא ניחוש (ח-1).
//    עובדה שהקוד קרא מהטקסט נשארת. כשנמחק תאריך או שעה, נמחקות גם ההשלמות שתלויות בהם (שיעור, שעת סיום).
//  - שדה שהקוד לא מצא (ואין לו מועמדים): משלימים ממה שהמוח קרא. תאריך ושעה מחושבים בקוד מהביטוי; מקצוע רק מהרשימה הסגורה, כ-inferred;
//    (כשהקוד מצא כמה מקצועות, רק אחד מהם); נושא וחדר: read כשהם מופיעים בהודעה מילה במילה, אחרת inferred (נושא) או כלום (חדר).
export function mergeUnderstanding({ extracted, understanding, receivedAt, text }) {
  const type = extracted.type;
  const essential = ESSENTIAL_FIELDS[type] ?? [];
  const facts = new Map(extracted.facts.map((fact) => [fact.field, fact]));
  const ambiguous = new Map(extracted.ambiguous.map((entry) => [entry.field, entry.candidates]));
  const contradiction = extracted.certainty === 'uncertain' && extracted.ambiguous.length === 0;
  const uncertain = new Set(understanding.uncertain);
  const fact = (field, value, origin) => ({ field, value: String(value), origin, extracted_by: 'script' });

  // תאריך או שעה שהמוח מצא להם ביטוי בהודעה ("מחר" הוא inferred בקוד, כי חושב) לא נמחקים: נמחק רק מה שאין לו שום ביטוי בהודעה.
  const expressionOf = { date: understanding.date_text, new_date: understanding.new_date_text, time: understanding.time_text };
  const dropped = new Set();
  for (const field of uncertain) {
    if (facts.get(field)?.origin === 'inferred' && !expressionOf[field]) {
      facts.delete(field);
      dropped.add(field);
    }
  }
  if (['date', 'new_date', 'time'].some((field) => dropped.has(field))) {
    for (const field of ['lesson', 'end_time']) if (facts.get(field)?.origin === 'inferred') facts.delete(field);
  }

  const open = (field) => !facts.has(field) && !ambiguous.has(field) && !uncertain.has(field);
  const fill = (field, found) => {
    if (!found) return;
    if (found.value !== undefined) facts.set(field, fact(field, found.value, 'read'));
    else ambiguous.set(field, found.candidates);
  };
  const dateField = type === 'move' ? 'new_date' : 'date';
  if (essential.includes(dateField) && open(dateField)) {
    fill(dateField, dateFrom(type === 'move' ? understanding.new_date_text : understanding.date_text, receivedAt));
  }
  // אירוע אישי של כמה ימים (24.11.2026, "דרך ב"): המוח מציע end_date_text, הקוד מחשב ושומר (validRangeEnd: אחרי ההתחלה, עד 60 ימים).
  // טווח שנקרא בקוד (end_date כבר בעובדות) גובר. סוף לא תקין, לא ברור, או שהמוח סימן אותו uncertain: end_date נשאל (ambiguous) ולא נכתב.
  // טווח תקין = כל היום: אין שעה ואין שעת סיום. [הנחה, לא אומת] "date_text" של המוח בהודעה עם טווח הוא היום הראשון, והוא גובר על תאריך שהקוד הסיק או על עמימות בין שני תאריכי הטווח.
  let multiDay = type === 'personal_event' && facts.has('end_date');
  if (type === 'personal_event' && !multiDay && (understanding.end_date_text || uncertain.has('end_date')) && !ambiguous.has('end_date')) {
    const first = dateFrom(understanding.date_text, receivedAt);
    if (first?.value && facts.get('date')?.origin !== 'read') {
      facts.set('date', fact('date', first.value, 'read'));
      ambiguous.delete('date');
    }
    const last = uncertain.has('end_date') ? null : dateFrom(understanding.end_date_text, receivedAt);
    const start = facts.get('date')?.value;
    if (last?.value && validRangeEnd(start, last.value)) {
      facts.set('end_date', fact('end_date', last.value, 'read'));
      multiDay = true;
    } else {
      ambiguous.set('end_date', last?.candidates ?? []);
    }
  }
  if (multiDay || ambiguous.has('end_date')) {
    for (const field of ['time', 'end_time']) facts.delete(field);
    ambiguous.delete('time');
  }

  if (isTimedType(type) && open('time') && !multiDay && !ambiguous.has('end_date')) fill('time', timeFrom(understanding.time_text));
  // מקצוע: רק שם מהרשימה הסגורה, כ-inferred (03-brain-module-rules.md: קיצור שמופה = "הוסק"). כשהקוד מצא כמה מועמדים, השם של המוח נבחר רק אם הוא אחד מהם.
  const subjectCandidates = ambiguous.get('subject');
  if (essential.includes('subject') && SUBJECT_NAMES.includes(understanding.subject) && !facts.has('subject') && !uncertain.has('subject')
    && (!subjectCandidates || subjectCandidates.includes(understanding.subject))) {
    facts.set('subject', fact('subject', understanding.subject, 'inferred'));
    ambiguous.delete('subject');
  }
  const message = typeof text === 'string' ? text : null;
  const verbatim = (value) => message !== null && message.includes(value);
  if ((essential.includes('topic') || type === 'personal_event') && open('topic') && understanding.topic) {
    facts.set('topic', fact('topic', understanding.topic, verbatim(understanding.topic) ? 'read' : 'inferred'));
  }
  if (essential.includes('new_room') && open('new_room') && understanding.new_room && verbatim(understanding.new_room)) {
    facts.set('new_room', fact('new_room', understanding.new_room, 'read'));
  }

  const factList = [...facts.values()];
  const ambiguousList = [...ambiguous].map(([field, candidates]) => ({ field, candidates }));
  const { missing, certainty } = assessFacts({ type, facts: factList, ambiguous: ambiguousList, contradiction });
  return { type, facts: factList, missing, certainty, ambiguous: ambiguousList, understood: isUnderstood(type, factList) };
}
