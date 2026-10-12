// צינור הקליטה (שלב 8.2, קוד בלבד): מחבר את מודולי הלוגיקה (lib/intake-*.js, lib/timetable.js) לנקודת הקליטה api/intake.js.
// מקור: docs/08-chapter8/35-chapter8-plan.md סעיפים 3.8.0 ו-8.2; docs/02-rules/03-intake-rules.md:157-174 ("מידע קודם, שאלה כרשת ביטחון"),
// 284-286 ("אותה הודעה פעמיים"); docs/02-rules/03-app-channel-rules.md:101,103 (התשובה והכפילות בקיצור). בלי רשת ובלי מודל: מסד בלבד, מוזרק (sql).
//
// שלוש פונקציות מיוצאות:
//   processSource({ sql, source, timetable })      קליטה של הודעה שנשמרה כבר ב-sources. מחזיר { status, reply }.
//   pendingQuestion({ source, facts, timetable })  פונקציה טהורה: השאלה הבאה למקור (או null). הכפתורים והשדה נגזרים בקריאה ואינם נשמרים (אין להם עמודה ב-messages).
//   answerQuestion({ sql, messageId, answer, timetable, now })  תשובה לשאלה פתוחה. מחזיר { done, reply, status }.
//
// status של processSource: 'recorded' (נרשם, וייתכן ששאלה נפתחה) · 'duplicate' ("כבר קיבלתי") · 'unclassified' (הקוד לא הבין, או שאלה שהועברה בלי תאריך, או הודעה ארוכה מדי; עובר לשלב 8.5) · 'skipped' (ערוץ שאינו הקיצור, או שהמקור כבר נתפס על ידי ריצה אחרת: claimed = 0).
//
// עקרונות הכתיבה:
//  - כל כתיבה של הצינור היא פקודת SQL אחת (WITH ... data-modifying CTE): או הכול או כלום (35, סעיף 8.2: "כתיבה בטרנזקציה אחת"). אין DELETE.
//  - הפקודה "תופסת" קודם את השורה (UPDATE ... WHERE processed_at IS NULL, או awaiting_reply = true, עם RETURNING) וכל ההכנסות תלויות בה.
//    כך הרצה כפולה (לחיצה כפולה, ניסיון חוזר) לא יוצרת עובדות כפולות: ההכנסות הן על שורות ה-RETURNING בלבד. [הנחה, לא אומת: לא נבדק מול Postgres אמיתי, ראה test/intake-process.test.js]
//  - שמירת המקור קודמת לעיבוד (build-rules 31): processSource נקרא רק אחרי שה-INSERT ל-sources הצליח, ושגיאה בו לא מבטלת אותו (api/intake.js תופס).
//  - "מה שלא ידוע נשאר לא ידוע": עובדה שחסרה לא נכתבת. "לא יודע" נשמר כערך 'unknown' (תשובה תקפה).
//
// הנחות שהמסמכים לא קובעים, כולן [הנחה, לא אומת] ושקל להפוך:
//  - עובדת הסוג נשמרת כשורת facts עם field='type' ו-origin='read' (הסוג נקרא ממילות ההודעה). הדרישה: לשחזר מה זוהה. facts אינה כוללת עמודת זמן, ולכן אין סדר בין שורות.
//  - סדר השאלות: תאריך קודם (כפתורי המקצוע והשיעור תלויים בו), אחריו מקצוע, נושא, חדר, ושיעור אחרון. 35 קובע שדות חיוניים ולא סדר.
//  - אחרי תשובה, השיעור המדויק מושלם בקוד ממערכת השעות אם יש מועמד אחד (origin='inferred'), בדיוק כמו ב-extractFacts (03-intake-rules.md:99-108). עם כמה מועמדים: שואלים.
//  - "מחר" בתשובה חופשית נמדד מרגע התשובה (now), לא מרגע ההודעה המקורית.
//  - candidate_rules (I-48) כבויה כרגע (RECORD_CANDIDATE_RULES = false, ביקורת 12.10, סעיף 10): אין היום זיהוי שמות אוטומטי (35, סעיף 3.8.0), והדפוס שנשמר
//    מהודעה שיובל הקליד ("אצל דנה לוי בנושא שברים") יכול להכיל שם, וכלל הפרויקט אוסר לשמור שמות וטלפונים (CLAUDE.md "ברזלים"; build-rules 12).
//    כשיופעל (שלב 8.2א, יחד עם סינון שמות) היא נכתבת רק כשערוץ המקור הוא 'app' (טקסט שיובל הקליד בעצמו); בהודעות מהקיצור (טקסט של אחרים) לא נרשם כלום.
//  - evidence ב-candidate_rules הוא { message_ids: [...] } בלבד, ללא שורשים (השורשים הם ה-pattern עצמו).
//  - שאלה שהועברה (ביקורת 12.10, סעיף 8): הודעה מהקיצור שהיא שאלה (detectIntent = read) ואין בה תאריך נחשבת "לא מסווגת", ללא כתיבה. שליפה לא נבנתה בפרק 8.
//  - הודעה ארוכה מ-MAX_PROCESSABLE_LENGTH תווים לא עוברת חילוץ (ביקורת 12.10, סעיף 15): הודעת אירוע קצרה בהרבה, והחילוץ על טקסט ענק חוסם את ה-event loop.
import { extractFacts, assessFacts, isUnderstood, slotMatchesSubject, ESSENTIAL_FIELDS, UNKNOWN_VALUE } from './intake-facts.js';
import { buildQuestion, applyAnswer, answerPattern, formatReply, RECEIVED_REPLY, DUPLICATE_REPLY } from './intake-questions.js';
import { fellThroughRoots } from './intake-dictionary.js';
import { detectIntent } from './intake-intent.js';
import { parseIso, weekdayOf, WEEKDAY_NAMES } from './intake-dates.js';
import { loadTimetable } from './timetable.js';

export const TYPE_FIELD = 'type';
// כתיבה ל-candidate_rules (I-48). כבוי עד שיהיה זיהוי שמות אוטומטי: מופעל בשלב 8.2א יחד עם סינון שמות (ביקורת 12.10, סעיף 10).
// answerQuestion מקבל recordCandidateRules (ברירת מחדל: הקבוע הזה), כדי שהבדיקות יוכלו לבדוק את הנתיב כשהוא דלוק.
export const RECORD_CANDIDATE_RULES = false;
// תקרת אורך לחילוץ (תווים). [הנחה, לא אומת] 20,000 היא בחירה של Claude: הודעת אירוע רגילה קצרה בהרבה, ו-api/intake.js מקבל עד 100,000 תווים.
// מעל התקרה: "לא מסווג", בלי חילוץ וב-processed_at ריק (ביקורת 12.10, סעיף 15).
export const MAX_PROCESSABLE_LENGTH = 20_000;
const CHANNEL_SHORTCUT = 'shortcut';
const CHANNEL_APP = 'app';

// הסדר שבו שואלים על שדה חסר. תאריך קודם כי כפתורי המקצוע והשיעור נגזרים מיום המערכת שלו; שיעור אחרון כי הוא תלוי במקצוע ובתאריך.
const ASK_ORDER = Object.freeze(['date', 'new_date', 'subject', 'topic', 'new_room', 'lesson']);

const rowsOf = (result) => (Array.isArray(result) ? result : []);

function validIso(value) {
  if (typeof value !== 'string') return null;
  try {
    parseIso(value);
    return value;
  } catch {
    return null;
  }
}

// שיעורי המקצוע ביום (כמו extractFacts, שורות 257-259): מספרי שיעור ממוינים, בלי כפילויות.
function periodsOf(timetable, iso, subject) {
  const slots = Array.isArray(timetable?.slots) ? timetable.slots : [];
  const weekday = weekdayOf(iso) + 1; // במערכת השעות 1 = ראשון
  const periods = slots.filter((slot) => slot.weekday === weekday && slotMatchesSubject(slot.subject, subject)).map((slot) => slot.period);
  return [...new Set(periods)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// מצב של מקור: מה כבר ידוע, מה חסר, ומה השאלה הבאה
// ---------------------------------------------------------------------------

// חילוץ מחדש מהטקסט המקורי. חותמת קליטה לא תקינה לא מונעת שאלה על מה שכבר נשמר: אז אין מועמדים מהחילוץ, והכפתורים נגזרים ממערכת השעות בלבד.
const NO_EXTRACTION = Object.freeze({ type: null, facts: [], missing: [], certainty: 'uncertain', ambiguous: [], understood: false });
function safeExtract(source, timetable) {
  try {
    return extractFacts({ text: source.raw_content, receivedAt: source.received_at, channel: source.channel, timetable });
  } catch (error) {
    if (error instanceof RangeError) return NO_EXTRACTION;
    throw error;
  }
}

// saved: שורות facts של המקור ({ field, value, origin }), כולל שורת ה-type. extracted (אופציונלי): תוצאת extractFacts שכבר חושבה.
// מחזיר { type, all (Map שדה -> עובדה: מה שנשמר ועוד מה שהושלם עכשיו בהסקה), ambiguous (Map שדה -> מועמדים), missing, next, certainty, understood, extracted }.
// הסוג השמור גובר על הסוג המחושב מחדש (המילון יכול להשתנות בין הקליטה לתשובה).
function resolveState({ source, saved, timetable, extracted }) {
  const known = new Map();
  for (const row of saved) {
    if (row && typeof row.field === 'string' && row.field !== TYPE_FIELD && row.value !== null && row.value !== undefined && !known.has(row.field)) {
      known.set(row.field, { field: row.field, value: String(row.value), origin: row.origin ?? 'read', extracted_by: 'script' });
    }
  }
  const savedType = saved.find((row) => row?.field === TYPE_FIELD)?.value;
  const fresh = extracted === undefined ? safeExtract(source, timetable) : extracted;
  const type = Object.hasOwn(ESSENTIAL_FIELDS, savedType) ? savedType : fresh.type;
  if (!type) return { type: null, all: new Map(), ambiguous: new Map(), missing: [], next: null, certainty: 'uncertain', understood: false, extracted: fresh };

  const all = new Map(known);
  const ambiguous = new Map();
  if (fresh.type === type) {
    for (const entry of fresh.ambiguous) if (!known.has(entry.field)) ambiguous.set(entry.field, entry.candidates);
  }

  // השלמת השיעור המדויק ממערכת השעות (03-intake-rules.md:99-108): מועמד יחיד = הסקה, כמה מועמדים = שאלה.
  const dateField = type === 'move' ? 'new_date' : 'date';
  if (type !== 'short_day' && !known.has('lesson')) {
    const subject = known.get('subject')?.value;
    const day = validIso(known.get(dateField)?.value);
    if (subject && subject !== UNKNOWN_VALUE && day) {
      const periods = periodsOf(timetable, day, subject);
      if (periods.length === 1) {
        all.set('lesson', { field: 'lesson', value: String(periods[0]), origin: 'inferred', extracted_by: 'script' });
        ambiguous.delete('lesson');
      } else if (periods.length > 1) {
        ambiguous.set('lesson', periods.map(String));
      }
    }
  }

  const missing = ESSENTIAL_FIELDS[type].filter((field) => !all.has(field));
  const nextField = ASK_ORDER.find((field) => missing.includes(field));
  // יום המערכת לכפתורים: בהזזה, השיעור נשאל לפי המועד החדש והמקצוע לפי המועד המקורי (אם נאמר), כמו ב-extractFacts.
  const dayFields = type === 'move' ? (nextField === 'lesson' ? ['new_date'] : ['date', 'new_date']) : ['date'];
  const day = dayFields.map((field) => validIso(all.get(field)?.value)).find(Boolean);
  const next = nextField
    ? buildQuestion({ field: nextField, type, candidates: ambiguous.get(nextField), timetable, date: day })
    : null;

  const facts = [...all.values()];
  const contradiction = fresh.type === type && fresh.certainty === 'uncertain' && fresh.ambiguous.length === 0; // uncertain בלי עמימות = סתירה
  const { certainty } = assessFacts({ type, facts, ambiguous: [...ambiguous].map(([field, candidates]) => ({ field, candidates })), contradiction });
  return { type, all, ambiguous, missing, next, certainty, understood: isUnderstood(type, facts), extracted: fresh };
}

// "נרשם · מבחן · מתמטיקה · שלישי 13.10" כשהסוג, המקצוע והתאריך מפוענחים; אחרת "התקבל" (03-intake-rules.md:60; 35 סעיף 3.8.0).
function replyFor(state) {
  if (!state.understood) return RECEIVED_REPLY;
  const date = state.all.get(state.type === 'move' ? 'new_date' : 'date')?.value;
  try {
    return formatReply({ type: state.type, subject: state.all.get('subject')?.value, date, weekday: WEEKDAY_NAMES[weekdayOf(date)] });
  } catch (error) {
    if (error instanceof RangeError) return RECEIVED_REPLY;
    throw error;
  }
}

const factsJson = (facts) => JSON.stringify(facts.map(({ field, value, origin }) => ({ field, value, origin })));

// ---------------------------------------------------------------------------
// קליטה
// ---------------------------------------------------------------------------

// האם יש שורה קודמת עם אותו content_hash באותו יום קלנדרי בשעון ישראל (I-21). "קודמת": received_at קטן יותר, ובשוויון id קטן יותר; לא השורה עצמה.
// קודמת שלא טופלה (processed_at ריק: נכשלה או לא הובנה) אינה נחשבת כפילות (ביקורת 12.10, סעיף 14), ולכן ההעתק מעובד.
// ההשוואה נעשית במסד לפי השורה השמורה (בלי להעביר חותמת מ-JS, שמאבדת מיקרו-שניות), ובלי תאריכי DST בקוד (build-rules 32).
async function hasEarlierSameDay(sql, id) {
  const rows = await sql`
    SELECT 1 AS found
    FROM sources s
    JOIN sources p ON p.content_hash = s.content_hash AND p.id <> s.id
    WHERE s.id = ${id}::uuid
      AND p.processed_at IS NOT NULL
      AND (p.received_at AT TIME ZONE 'Asia/Jerusalem')::date = (s.received_at AT TIME ZONE 'Asia/Jerusalem')::date
      AND (p.received_at < s.received_at OR (p.received_at = s.received_at AND p.id < s.id))
    LIMIT 1
  `;
  return rowsOf(rows).length > 0;
}

export async function processSource({ sql, source, timetable } = {}) {
  if (typeof sql !== 'function') throw new TypeError('processSource: חסר sql');
  if (!source || typeof source.id !== 'string' || source.id === '') throw new TypeError('processSource: חסר source.id');

  // הצ'אט המוקלד הוא שלב 8.2א: כאן רק הקיצור.
  if (source.channel !== CHANNEL_SHORTCUT) return { status: 'skipped', reply: RECEIVED_REPLY };

  // הודעה ארוכה מאוד: בלי חילוץ ובלי מסד (המקור כבר נשמר, processed_at נשאר ריק).
  if (typeof source.raw_content === 'string' && source.raw_content.length > MAX_PROCESSABLE_LENGTH) return { status: 'unclassified', reply: RECEIVED_REPLY };

  if (await hasEarlierSameDay(sql, source.id)) {
    // השורה נשארת (המקור נשמר תמיד). הטיפול בה הסתיים, ולכן מסומנת; כשל בסימון לא משנה את התשובה.
    try {
      await sql`UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL`;
    } catch (error) {
      console.error('intake: סימון כפילות נכשל:', error?.name);
    }
    return { status: 'duplicate', reply: DUPLICATE_REPLY };
  }

  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // null מותר: מעבדים בלי השלמה
  let extracted;
  try {
    extracted = extractFacts({ text: source.raw_content, receivedAt: source.received_at, channel: source.channel, timetable: table });
  } catch (error) {
    if (error instanceof RangeError) return { status: 'unclassified', reply: RECEIVED_REPLY }; // חותמת קליטה לא תקינה
    throw error;
  }
  // מידע קודם (03-intake-rules.md:157-174): כשנמצא סוג, נרשם גם אם יש סימן שאלה. לא נמצא סוג: לא מבינים, processed_at נשאר NULL, בלי עובדות (שלב 8.5).
  if (!extracted.type) return { status: 'unclassified', reply: RECEIVED_REPLY };
  // שאלה שהועברה (03-intake-rules.md:167, צעד 3): יש סוג, אבל זו שאלה ואין בה תאריך = אין מידע לרשום. התשובה לשאלה (שליפה) לא נבנתה בפרק 8, לכן "לא מסווג", בלי כתיבה.
  // [הנחה, לא אומת] "יש מידע" נבדק כאן כעובדת date או new_date בלבד.
  if (detectIntent(source.raw_content) === 'read' && !extracted.facts.some((fact) => fact.field === 'date' || fact.field === 'new_date')) {
    return { status: 'unclassified', reply: RECEIVED_REPLY };
  }

  const saved = [{ field: TYPE_FIELD, value: extracted.type, origin: 'read' }, ...extracted.facts];
  const state = resolveState({ source, saved, timetable: table, extracted });
  const question = state.next; // שאלה אחת בלבד; הבאה נוצרת אחרי שנענתה (answerQuestion)

  // פקודה אחת אטומית: תפיסת המקור (processed_at) + כל העובדות + השאלה הראשונה. אם המקור כבר טופל, התפיסה לא מחזירה שורה ואין הכנסות.
  const written = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now()
      WHERE id = ${source.id}::uuid AND processed_at IS NULL
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT claim.id, x.field, x.value, ${extracted.certainty}::text, 'script', NULL::text, NULL::uuid, x.origin, NULL::text
      FROM claim, jsonb_to_recordset(${factsJson(saved)}::jsonb) AS x(field text, value text, origin text)
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${question?.text ?? null}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'source', claim.id, 1
      FROM claim
      WHERE ${question?.text ?? null}::text IS NOT NULL
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT count(*) FROM f)::int AS facts_written, (SELECT count(*) FROM m)::int AS questions_written
  `);
  // claimed = 0: מישהו אחר כבר תפס את המקור (ניסיון חוזר, מירוץ), ולא נכתב כלום (ביקורת 12.10, סעיף 13). בלי שורות בתוצאה (למשל sql מזויף): כמו קודם.
  if (written.length > 0 && Number(written[0].claimed) === 0) return { status: 'skipped', reply: RECEIVED_REPLY };
  return { status: 'recorded', reply: replyFor(state) };
}

// ---------------------------------------------------------------------------
// שאלה פתוחה ותשובה
// ---------------------------------------------------------------------------

// השאלה הבאה למקור: { field, text, buttons, allowFreeText } או null. facts = שורות facts של המקור מהמסד ({ field, value, origin }).
// מחשב מחדש את החילוץ מהטקסט המקורי, ומוריד מה שכבר נשמר. פונקציה טהורה: לא כותבת ולא קוראת מהמסד.
export function pendingQuestion({ source, facts, timetable } = {}) {
  if (!source) throw new TypeError('pendingQuestion: חסר source');
  return resolveState({ source, saved: Array.isArray(facts) ? facts : [], timetable }).next;
}

export async function answerQuestion({ sql, messageId, answer, timetable, now = new Date(), recordCandidateRules = RECORD_CANDIDATE_RULES } = {}) {
  if (typeof sql !== 'function') throw new TypeError('answerQuestion: חסר sql');
  if (typeof messageId !== 'string' || messageId === '') throw new TypeError('answerQuestion: חסר messageId');
  const closed = { done: false, reply: null, status: 'closed' };

  const [message] = rowsOf(await sql`
    SELECT id, kind, awaiting_reply, entity_type, entity_id, attempt FROM messages WHERE id = ${messageId}::uuid
  `);
  if (!message || message.kind !== 'question' || message.awaiting_reply !== true || message.entity_type !== 'source' || !message.entity_id) return closed;

  const [source] = rowsOf(await sql`
    SELECT id, channel, raw_content, content_hash, received_at FROM sources WHERE id = ${message.entity_id}::uuid
  `);
  if (!source) return closed;
  const saved = rowsOf(await sql`SELECT field, value, origin FROM facts WHERE source_id = ${source.id}::uuid`);
  const table = timetable === undefined ? await loadTimetable(sql) : timetable;

  const before = resolveState({ source, saved, timetable: table });
  const field = before.next?.field;
  let rows = [];
  let after = before;
  if (field) {
    const applied = applyAnswer({ facts: [...before.all.values()], field, answer, receivedAt: now });
    const parsed = applied.find((fact) => fact.field === field);
    // תשובה שאי אפשר לפענח (תאריך לא תקין, שיעור בלי מספר, ריקה): לא כותבים כלום, והשאלה נשארת פתוחה.
    if (!parsed) return { done: false, reply: before.next.text, status: 'unclear' };
    after = resolveState({ source, saved: [...saved, parsed], timetable: table, extracted: before.extracted });
    const savedFields = new Set(saved.map((row) => row.field));
    rows = [...after.all.values()].filter((fact) => !savedFields.has(fact.field)); // שדות חדשים בלבד: אין UPDATE על עובדות קיימות
  }

  // רישום ב-candidate_rules (I-48): כבוי כברירת מחדל (RECORD_CANDIDATE_RULES). כשדלוק: רק בהודעה שיובל הקליד בעצמו; בהודעות מהקיצור (טקסט של אחרים)
  // לא נרשם כלום, כדי לא לשמור שמות (ראה הערה בראש הקובץ). כשכבוי הפרמטרים של הדפוס הם NULL: ה-CTE קיים בפקודה אבל אינו כותב ואינו מעדכן.
  const rule = recordCandidateRules && source.channel === CHANNEL_APP && field
    ? answerPattern({ type: after.type, field, rootsThatFellThrough: fellThroughRoots(source.raw_content) })
    : null;
  const pattern = rule?.pattern ?? null;
  const nextQuestion = field ? after.next : null;
  const attempt = (Number(message.attempt) || 1) + 1;

  // פקודה אחת אטומית: סגירת השאלה (compare-and-set על awaiting_reply) + עובדות חדשות + השאלה הבאה + דפוס. אם השאלה כבר נסגרה, אין הכנסות.
  const written = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true
      RETURNING id
    ), f AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin, haiku_confidence)
      SELECT ${source.id}::uuid, x.field, x.value, ${after.certainty}::text, 'script', NULL::text, NULL::uuid, x.origin, NULL::text
      FROM closed, jsonb_to_recordset(${factsJson(rows)}::jsonb) AS x(field text, value text, origin text)
      RETURNING id
    ), m AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${nextQuestion?.text ?? null}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'source', ${source.id}::uuid, ${attempt}::integer
      FROM closed
      WHERE ${nextQuestion?.text ?? null}::text IS NOT NULL
      RETURNING id
    ), r_upd AS (
      UPDATE candidate_rules
      SET occurrences = coalesce(occurrences, 0) + 1, last_seen = now(),
          evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object('message_ids', coalesce(evidence -> 'message_ids', '[]'::jsonb) || to_jsonb(${messageId}::text))
      WHERE pattern = ${pattern}::text AND EXISTS (SELECT 1 FROM closed)
      RETURNING id
    ), r_ins AS (
      INSERT INTO candidate_rules (pattern, occurrences, first_seen, last_seen, evidence, status)
      SELECT ${pattern}::text, 1, now(), now(), jsonb_build_object('message_ids', jsonb_build_array(${messageId}::text)), 'candidate'
      FROM closed
      WHERE ${pattern}::text IS NOT NULL AND NOT EXISTS (SELECT 1 FROM r_upd)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed
  `);
  if (Number(written[0]?.closed) === 0) return closed; // מישהו אחר (לחיצה כפולה) כבר ענה: לא נכתב כלום

  const done = !nextQuestion;
  // בלי שדה פתוח (המצב כבר שלם) השאלה נסגרת בלי עובדות חדשות: status 'closed'.
  return { done, reply: done ? replyFor(after) : nextQuestion.text, status: field ? 'answered' : 'closed' };
}
