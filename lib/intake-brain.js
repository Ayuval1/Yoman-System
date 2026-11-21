// הבנת הודעה במוח (בלוק 3ב-1; docs/01-foundation/אפיון-מורחב.md ה-2, ה-3, ה-6, ה-9, ח-1 וסעיף 4).
// כל הודעה נכנסת (מוקלדת או מועברת) נקראת קודם במוח, דרך lib/brain/ask.js בלבד (זו הדרך היחידה למודל). המוח מחזיר מה כתוב:
// סוג מרשימה סגורה (הסוגים שהצינור כבר יודע לטפל בהם), ביטויי תאריך ושעה מילה במילה, ורשימת uncertain של פרטים שחסרים.
// הקוד עושה את השאר כמו היום: חישובי תאריכים (lib/intake-dates.js), השלמה ממערכת השעות, הרשאות, כתיבה ליומן, שאלות.
// המודל לא מקבל את תאריך הקליטה ולא מחשב תאריכים (03-brain-module-rules.md, "מה לא נטען").
//
//   understandSource({ sql, source, replyTo?, now?, apiKey?, fetchFn?, ask? })
//     -> { ok: true, model, understanding } | { ok: false, reason: 'no-key' | 'no-pool' | 'exhausted' | 'failed' | 'timeout' }
//   mergeUnderstanding({ extracted, understanding, receivedAt, text })  פונקציה טהורה: ממזגת את מה שהמוח קרא לתוצאת extractFacts של אותו סוג.
//   isValidUnderstanding(data, text)  בדיקת הפורמט. תשובה שלא עוברת = askBrain עובר למודל הבא.
//
// פרטיות: הטקסט לא נרשם בשום לוג כאן. מספרי טלפון מוחלפים ב-askBrain (scrub) לפני השליחה.
import { askBrain } from './brain/ask.js';
import { TYPES, SUBJECT_NAMES, findTimeReading } from './intake-dictionary.js';
import { ESSENTIAL_FIELDS, assessFacts, isUnderstood, isTimedType } from './intake-facts.js';
import { resolveDates } from './intake-dates.js';
import { tokenize } from './intake-text.js';

// הסוגים שהמוח מחזיר: סוגי הצינור (lib/intake-dictionary.js TYPES), ועוד שלושה שהצינור מטפל בהם כ"לא מסווג": משימה, שאלה, ואחר.
export const NON_TYPE_KINDS = Object.freeze(['task', 'question', 'other']);
export const BRAIN_KINDS = Object.freeze([...TYPES, ...NON_TYPE_KINDS]);
// שדות הטקסט בתשובה. *_text = ביטוי מההודעה, מילה במילה (נבדק שהוא באמת מופיע בה).
const TEXT_FIELDS = Object.freeze(['subject', 'topic', 'date_text', 'new_date_text', 'time_text', 'new_room']);
const VERBATIM_FIELDS = Object.freeze(['date_text', 'new_date_text', 'time_text', 'new_room']);
export const UNCERTAIN_FIELDS = Object.freeze(['date', 'new_date', 'time', 'subject', 'topic', 'new_room', 'lesson']);
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
  'personal_event: אירוע אישי במועד מסוים (פגישה, הופעה, נסיעה, רופא, אימון)',
  'task: משימה שיובל צריך לעשות, בלי מועד של אירוע',
  'question: שאלה שמחכה לתשובה',
  'other: כל דבר אחר (ברכה, מידע כללי, פקודה)',
];

// prompt: הטקסט שנשלח. context (אופציונלי): ההודעה שיובל הגיב עליה ("הגב"), כהקשר בלבד.
export function buildPrompt({ text, context = null }) {
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
    'topic: הנושא או שם האירוע, במילים מההודעה, בלי תאריך ושעה. לא כתוב: null.',
    `uncertain: רשימת הפרטים הדרושים שלא כתובים בהודעה או שיש להם יותר מקריאה אחת, מתוך: ${UNCERTAIN_FIELDS.join(', ')}. אין: [].`,
    'החזר JSON בלבד, בדיוק במבנה הזה:',
    '{"kind": "...", "subject": null, "topic": null, "date_text": null, "new_date_text": null, "time_text": null, "new_room": null, "uncertain": []}',
  ];
  if (typeof context === 'string' && context.trim() !== '') {
    lines.push('', 'ההודעה היא תגובה להודעה קודמת. ההודעה הקודמת, להקשר בלבד (לא להעתיק ממנה ביטויים):', `«${context.slice(0, MAX_CONTEXT_LENGTH)}»`);
  }
  lines.push('', 'ההודעה:', `«${String(text ?? '')}»`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// בדיקת הפורמט
// ---------------------------------------------------------------------------

// true רק לתשובה בדיוק בפורמט: kind מהרשימה, שדות טקסט null או מחרוזת קצרה, ביטויים מילה במילה שמופיעים בהודעה (מודל שהמציא ביטוי = המודל הבא),
// ו-uncertain רשימה מהשדות המותרים.
export function isValidUnderstanding(data, text) {
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
  return data.uncertain.every((field) => UNCERTAIN_FIELDS.includes(field));
}

// צורה אחידה: כל שדה מחרוזת לא ריקה או null; uncertain בלי כפילויות.
function normalize(data) {
  const out = { kind: data.kind, uncertain: [...new Set(data.uncertain)] };
  for (const field of TEXT_FIELDS) {
    const value = typeof data[field] === 'string' ? data[field].trim() : '';
    out[field] = value === '' ? null : value;
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
}) {
  // בלי מפתח: המוח לא מוגדר. בלי קריאה ובלי לוג (askBrain היה כותב שגיאה על כל הודעה).
  if (!apiKey) return { ok: false, reason: 'no-key' };
  const text = String(source?.raw_content ?? '');
  try {
    const context = await loadReplyContext(sql, replyTo);
    const result = await withTimeout(ask({
      sql, fetchFn, apiKey, now,
      prompt: buildPrompt({ text, context }),
      schema: (data) => isValidUnderstanding(data, text),
      timeoutMs: MODEL_TIMEOUT_MS,
    }), timeoutMs);
    if (!result?.ok) return { ok: false, reason: result?.reason ?? 'failed' };
    return { ok: true, model: result.model, understanding: normalize(result.data) };
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
  if (isTimedType(type) && open('time')) fill('time', timeFrom(understanding.time_text));
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
