// משימה אישית בכתיבה בצ'אט, ומעקב "בוצע?" (בלוק 4).
// מקורות: docs/08-chapter8/60-chapter8-step-8-6-spec.md (תרחיש ג, "מה נכנס" סעיף 12, קריטריון 12); docs/01-foundation/אפיון-מורחב.md סעיף 3,
// "החלטות על פריטים מפרקים 9–13" פריט 13 ("משימה עם שעה ברורה: שואלים מיד כשהזמן עובר. כל השאר: בסגירה של 21:00"); docs/01-foundation/אפיון.md סעיף 8.
//
// החלוקה (CLAUDE.md, עקרון-העל 21.11.2026): המוח מבין שזו משימה ומעתיק מההודעה את הכותרת ואת ביטויי התאריך והשעה (lib/intake-brain.js).
// הקוד מחשב את התאריך והשעה, בודק את מה שהמוח החזיר, וכותב. בלי מוח (מכסה, תקלה): אותו מסלול, והכוונה נקבעת בקוד (פועל משימה בתחילת ההודעה).
//
// "שעה ברורה" בלי שינוי סכמה (מוסכמה, הכרעה טכנית של בלוק 4): משימה בלי שעה נשמרת עם due_at = 00:00 בשעון ישראל של היום שלה.
// כל שעה אחרת ב-due_at = יובל (או המוח מתוך ההודעה) נתן שעה. isTimedDue היא הבדיקה היחידה. [הנחה, לא אומת] "עד 00:00" או "בחצות" נקראים כמו "בלי שעה".
// שיעורי בית (domain='homework') לא נכנסים למוסכמה: due_at שלהם הוא תחילת השיעור הבא (lib/homework-schedule.js), ולכן הם לא נשאלים מיד, רק בסגירה.
//
// שאלות (שורות messages, בלי טבלה חדשה):
//  - "עד מתי?": entity_type='task', entity_id = המשימה. תיבת כתיבה בלבד (מפרט 60 סעיף 12). תשובה שלא מתפענחת = unclear, והכרטיס נשאר.
//  - "בוצע?": entity_type='task_check', entity_id = המשימה. שני כפתורים: "בוצע" / "עוד לא". נוצרת מיד כשהשעה הברורה עוברת (הודעת תור taskcheck,
//    api/queues/deliver.js), או בסגירה של 21:00 לכל משימה פתוחה שמועדה היום או עבר (ensureClosingChecks).
//  - "בוצע" = done (כמו task_done). "עוד לא" = נשארת open. אין תשובה = לא בוצע ולא לא-בוצע (אפיון סעיף 8): הכרטיס נשאר עד שהוא פג.
//  - לא שואלים שוב באותו יום (שאלה שנשלחה היום, נענתה או לא, חוסמת), ולא כשיש שאלה פתוחה על אותה משימה.
//  - רלוונטיות [הנחה, לא אומת; הכרעה טכנית]: שואלים עד RELEVANCE_DAYS ימים אחרי היום של המועד, וכרטיס פג בחצות שאחרי היום האחרון הזה.
//    אחרי זה המשימה נשארת ברשימת "פתוחות" עם "באיחור", ולא נשאלת.
//  - אימון שמקור אמין מדווח עליו (Garmin) לא נשאל (אפיון-מורחב פריט 13). אין עדיין מקור כזה (lib/training-source.js מחזיר []), ואימונים אינם tasks.
//    נקודת החיבור: כשיתווסף מקור, הסינון נכנס כאן, בתנאי ה-WHERE של createImmediateCheck ו-ensureClosingChecks (domain IN ...), לפני שנוצרת שאלה.
// פרטיות: כותרת המשימה נשמרת רק ב-tasks וב-body של השאלה והבועה (מוצגים באפליקציה). לא בלוג, לא בהתראה, לא ב-probe_log.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { resolveDates, localDateIso, addDays, formatDayMonth, weekdayOf, WEEKDAY_NAMES } from './intake-dates.js';
import { tokenize } from './intake-text.js';
import { readingAt } from './intake-dictionary.js';
import { zonedToUtc, localParts } from './schedule-time.js';
import { planTaskCheck, SLOT_TOPIC } from './message-slots.js';

const TIME_ZONE = 'Asia/Jerusalem';
const rowsOf = (result) => (Array.isArray(result) ? result : []);

export const TASK_DOMAIN = 'personal';
export const DUE_ENTITY = 'task';
export const CHECK_ENTITY = 'task_check';
export const TASK_ENTITIES = Object.freeze([DUE_ENTITY, CHECK_ENTITY]);
export const DUE_QUESTION = 'עד מתי?';
export const CHECK_QUESTION = 'בוצע?';
export const CHECK_DONE = 'בוצע';
export const CHECK_NOT_YET = 'עוד לא';
export const checkButtons = () => [CHECK_DONE, CHECK_NOT_YET];
// [הנחה, לא אומת] 3 ימים: הכרעה טכנית של Claude. "המועד לא רחוק מדי בעבר" (אפיון סעיף 8: "אם הנושא חדל להיות רלוונטי, מפסיקים לפנות").
export const RELEVANCE_DAYS = 3;
// [הנחה, לא אומת] תקרת הכותרת, כמו MAX_FIELD_LENGTH של המוח.
export const MAX_TITLE_LENGTH = 200;
const FALLBACK_TITLE = 'משימה';
// [הנחה, לא אומת] נוסחי הבועות: בחירה של Claude בבנייה.
export const doneReply = (title) => `בוצע · ${title}`;
export const notYetReply = (title) => `נשאר פתוח · ${title}`;
export const dueQuestionText = (title) => `${DUE_QUESTION} · ${title}`;
const CHECK_PREFIX = `${CHECK_QUESTION} · `;

// ---------------------------------------------------------------------------
// קריאה: כותרת, תאריך ושעה (פונקציות טהורות)
// ---------------------------------------------------------------------------

const WEEKDAY_WORD = '(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)';
const UNTIL_WEEKDAY = new RegExp(`(^|\\s)עד\\s+${WEEKDAY_WORD}(?=$|[\\s.,!?])`, 'g');
const BARE_WEEKDAY = new RegExp(`^\\s*(?:עד\\s+|ב|ל)?${WEEKDAY_WORD}\\s*[.!]?\\s*$`);

// "עד שלישי" ו"שלישי" כתשובה לבד: המפענח הקיים (resolveDates) מכיר "יום שלישי" ו"בשלישי", לא יום חשוף (שהוא גם "השלישי" במספור). כאן ההקשר ברור, ולכן מוסיפים "יום".
function withDayWord(text) {
  const bare = BARE_WEEKDAY.exec(text);
  if (bare) return `יום ${bare[1]}`;
  return text.replace(UNTIL_WEEKDAY, '$1עד יום $2');
}

// תאריך היעד (YYYY-MM-DD) מביטוי, או null: לא נמצא, עמום, או לפני היום (בשעון ישראל).
export function dueDateFrom(text, now) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  let mentions;
  try {
    mentions = resolveDates(withDayWord(text), now);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
  const first = mentions.find((mention) => !mention.ambiguous);
  if (!first) return null;
  return first.date >= localDateIso(now, TIME_ZONE) ? first.date : null;
}

// שעה ברורה (HH:MM) מביטוי, או null. גם אחרי "עד" ("עד 17:00"), בניגוד לשעת התחלה של אירוע. קריאה עמומה ("בחמש") = null: לא מנחשים.
export function dueTimeFrom(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const { clean, tokens } = tokenize(text);
  const words = tokens.map((token) => token.w);
  const ctx = { words, clean, tokens };
  for (let i = 0; i < words.length; i += 1) {
    const found = readingAt(words, i, ctx);
    if (found?.candidates.length === 1) return found.candidates[0];
  }
  return null;
}

const UNTIL_WORD = /^עד$/;
const TODAY_WORD = /^ו?ה?היומ$|^היומ$/;
const TRAILING_LINK = /^(?:ו|של|את|ב|ל|מ|עד)$/;

// הכותרת: המילים של יובל עד ביטוי המועד ("עד ...", תאריך, שעה, "היום"), בלי מילת קישור תלויה בסוף. אין מועד: כל ההודעה.
export function taskTitleFrom(text, now) {
  const { clean, tokens } = tokenize(text);
  if (tokens.length === 0) return '';
  const words = tokens.map((token) => token.w);
  const ctx = { words, clean, tokens };
  let mentions = [];
  try {
    mentions = resolveDates(text, now);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  const inMention = (index) => mentions.some((m) => index >= m.start && index <= m.end);
  let cut = words.length;
  for (let i = 1; i < words.length; i += 1) {
    if (UNTIL_WORD.test(words[i]) || inMention(i) || TODAY_WORD.test(words[i]) || readingAt(words, i, ctx) !== null) {
      cut = i;
      break;
    }
  }
  while (cut > 1 && TRAILING_LINK.test(words[cut - 1])) cut -= 1;
  const title = clean.slice(tokens[0].start, tokens[cut - 1].end).replace(/[\s.,!?;:]+$/, '').trim();
  return title.slice(0, MAX_TITLE_LENGTH);
}

// מה שנרשם: { title, date (YYYY-MM-DD או null), time (HH:MM או null) }.
// understanding (אופציונלי): תוצאת המוח (kind='task'). הכותרת מ-topic; התאריך והשעה מחושבים בקוד מהביטויים שהמוח העתיק (date_text, time_text).
// אין ביטוי: מה שהקוד קורא מכל ההודעה, אלא אם המוח סימן את השדה uncertain (אז לא מנחשים: שואלים).
// שעה בלי תאריך [הנחה, לא אומת; כמו H6 באירוע אישי, "בלי תאריך = היום"]: היום, אם השעה עוד לא עברה. עברה: בלי תאריך ובלי שעה, ושואלים "עד מתי?".
export function readTask({ text, receivedAt, understanding = null }) {
  const message = typeof text === 'string' ? text : '';
  const brainTitle = typeof understanding?.topic === 'string' ? understanding.topic.trim().slice(0, MAX_TITLE_LENGTH) : '';
  const title = brainTitle !== '' ? brainTitle : taskTitleFrom(message, receivedAt);
  const uncertain = new Set(Array.isArray(understanding?.uncertain) ? understanding.uncertain : []);
  const sourceFor = (expression, field) => (understanding ? (expression ?? (uncertain.has(field) ? null : message)) : message);
  const dateSource = sourceFor(understanding?.date_text ?? null, 'date');
  const timeSource = sourceFor(understanding?.time_text ?? null, 'time');
  let date = dateSource ? dueDateFrom(dateSource, receivedAt) : null;
  let time = timeSource ? dueTimeFrom(timeSource) : null;
  ({ date, time } = settleWhen(date, time, receivedAt));
  return { title: title === '' ? FALLBACK_TITLE : title, date, time };
}

// שעה בלי תאריך: היום אם עוד לא עברה, אחרת בלי שתיהן. 00:00 = בלי שעה (המוסכמה למעלה).
function settleWhen(date, time, now) {
  let settledTime = time === '00:00' ? null : time;
  let settledDate = date;
  if (!settledDate && settledTime) {
    const today = localDateIso(now, TIME_ZONE);
    if (zonedToUtc(today, settledTime, TIME_ZONE).getTime() > new Date(now).getTime()) settledDate = today;
    else settledTime = null;
  }
  return { date: settledDate, time: settledTime };
}

// due_at (Date) לפי המוסכמה: בלי שעה = 00:00 בישראל. בלי תאריך: null.
export function dueAtFor({ date, time }) {
  if (!date) return null;
  return zonedToUtc(date, time ?? '00:00', TIME_ZONE);
}

// האם ל-due_at יש שעה ברורה (לא 00:00 בשעון ישראל). ריק או לא תקין: false.
export function isTimedDue(dueAt) {
  if (dueAt === null || dueAt === undefined) return false;
  const date = dueAt instanceof Date ? dueAt : new Date(dueAt);
  if (Number.isNaN(date.getTime())) return false;
  const parts = localParts(date, TIME_ZONE);
  return parts.hour !== 0 || parts.minute !== 0;
}

// "נרשם · משימה · להכין מצגת · עד שלישי 24.11" (ועם שעה: " · 17:00"). המבנה של "נרשם" (lib/intake-questions.js formatReply), ולכן התג בצ'אט הוא recorded.
export function taskReply({ title, date, time }) {
  const parts = ['נרשם', FALLBACK_TITLE, title, `עד ${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDayMonth(date)}`];
  if (time) parts.push(time);
  return parts.join(' · ');
}

const iso = (value) => (value instanceof Date ? value.toISOString() : value);

// ---------------------------------------------------------------------------
// כתיבה: רישום המשימה
// ---------------------------------------------------------------------------

// פקודה אחת אטומית: תפיסת המקור (processed_at) + שורת tasks + שאלת "עד מתי?" (בלי תאריך) או בועת "נרשם" (עם תאריך).
// מקור שכבר נתפס (ניסיון חוזר, מירוץ): skipped ושום כתיבה. הכרטיס הוא התגובה כשאין תאריך, ולכן אז אין בועה (כמו שאלה בקליטה, lib/intake-process.js).
// מחזיר { status, reply, task: { id, dueAt (ISO או null), timed } }.
export async function recordPersonalTask({ sql, source, task }) {
  const dueAt = dueAtFor(task);
  const due = dueAt ? dueAt.toISOString() : null;
  const question = dueAt ? null : dueQuestionText(task.title);
  const bubble = dueAt ? taskReply(task) : null;
  const [written] = rowsOf(await sql`
    WITH claim AS (
      UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL RETURNING id
    ), t AS (
      INSERT INTO tasks (title, due_at, domain, status) SELECT ${task.title}::text, ${due}::timestamptz, 'personal', 'open' FROM claim RETURNING id
    ), q AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${question}::text, 'question', now(), true, NULL::uuid, NULL::timestamptz, 'task', t.id, 1 FROM t
      WHERE ${question}::text IS NOT NULL
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer FROM claim
      WHERE ${bubble}::text IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed, (SELECT id FROM t) AS task_id
  `);
  if (written && Number(written.claimed) === 0) return { status: 'skipped', reply: question ?? bubble };
  return { status: 'recorded', reply: question ?? bubble, task: { id: written?.task_id ?? null, dueAt: due, timed: isTimedDue(dueAt) } };
}

// ---------------------------------------------------------------------------
// תשובות
// ---------------------------------------------------------------------------

const CLOSED = Object.freeze({ status: 'closed', created: {} });
const UNCLEAR = Object.freeze({ status: 'unclear', created: {} });

// השאלה והמשימה שלה, או undefined. שאלה שפגה לא נטענת.
async function loadAsk(sql, messageId, now) {
  const [ask] = rowsOf(await sql`
    SELECT m.id, m.awaiting_reply, m.entity_type, t.id AS task_id, t.title, t.status
    FROM messages m JOIN tasks t ON t.id = m.entity_id
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type IN ('task', 'task_check')
      AND (m.expires_at IS NULL OR m.expires_at > ${now.toISOString()}::timestamptz)
  `);
  return ask;
}

const titleOf = (ask) => (typeof ask?.title === 'string' && ask.title.trim() !== '' ? ask.title.trim() : FALLBACK_TITLE);

// תשובה ל"עד מתי?": תאריך (ושעה, אם נאמרה) מהתשובה, בקוד. לא מתפענח: unclear (הכרטיס נשאר, "לא הבנתי. נסה שוב" בדף).
// [הנחה, לא אומת] התשובה לא נשלחת למוח: היא ביטוי מועד קצר, והמפענח בקוד מכסה אותו. "מחר" נמדד מרגע התשובה.
// פקודה אחת: סגירה מותנית של השאלה, שורת התשובה ב-sources, due_at למשימה (רק אם עדיין open), ובועת "נרשם".
export async function answerTaskDue({ sql, messageId, answer, now = new Date(), ask: preloaded }) {
  const ask = preloaded ?? (await loadAsk(sql, messageId, now));
  if (!ask || ask.entity_type !== DUE_ENTITY || ask.awaiting_reply !== true) return { ...CLOSED };
  const text = String(answer ?? '').trim();
  const { date, time } = settleWhen(dueDateFrom(text, now), dueTimeFrom(text), now);
  if (!date) return { ...UNCLEAR };
  const title = titleOf(ask);
  const dueAt = dueAtFor({ date, time });
  const due = dueAt.toISOString();
  const bubble = taskReply({ title, date, time });
  const nowIso = now.toISOString();
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'task'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), upd AS (
      UPDATE tasks SET due_at = ${due}::timestamptz WHERE id IN (SELECT entity_id FROM closed) AND status = 'open'
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'task', closed.entity_id, NULL::integer FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return { ...CLOSED };
  return {
    status: 'answered',
    created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null },
    task: { id: ask.task_id, dueAt: due, timed: isTimedDue(dueAt) },
  };
}

// תשובה ל"בוצע?": "בוצע" = done ו-done_at (כמו task_done, lib/homework-view.js markTaskDone; רק משימה שעדיין open). "עוד לא" = נשארת open.
// כל טקסט אחר = unclear (לכרטיס אין תיבת כתיבה, אז זה קורה רק בבקשה ידנית). פקודה אחת: סגירה מותנית, שורת התשובה, העדכון, הבועה.
export async function answerTaskCheck({ sql, messageId, answer, now = new Date(), ask: preloaded }) {
  const ask = preloaded ?? (await loadAsk(sql, messageId, now));
  if (!ask || ask.entity_type !== CHECK_ENTITY || ask.awaiting_reply !== true) return { ...CLOSED };
  const text = String(answer ?? '').trim();
  if (text !== CHECK_DONE && text !== CHECK_NOT_YET) return { ...UNCLEAR };
  const done = text === CHECK_DONE;
  const title = titleOf(ask);
  const bubble = done ? doneReply(title) : notYetReply(title);
  const nowIso = now.toISOString();
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = 'task_check'
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), d AS (
      UPDATE tasks SET status = 'done', done_at = now() WHERE id IN (SELECT entity_id FROM closed) AND status = 'open' AND ${done}::boolean
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${bubble}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'task', closed.entity_id, NULL::integer FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return { ...CLOSED };
  return { status: 'answered', created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null } };
}

// פעולת answer על שאלה של משימה (api/chat.js, אחרי ש-answerQuestion ו-answerVacation החזירו closed). שאלה שאינה של משימה: closed בלי כתיבה.
export async function answerTaskQuestion({ sql, messageId, answer, now = new Date() }) {
  const ask = await loadAsk(sql, messageId, now);
  if (!ask) return { ...CLOSED };
  if (ask.entity_type === DUE_ENTITY) return answerTaskDue({ sql, messageId, answer, now, ask });
  if (ask.entity_type === CHECK_ENTITY) return answerTaskCheck({ sql, messageId, answer, now, ask });
  return { ...CLOSED };
}

// אחרי "בוצע" מרשימת הפתוחות (task_done): שאלות פתוחות על המשימה ("עד מתי?", "בוצע?") כבר לא רלוונטיות, ונסגרות.
// בלי read_at: שורת "בוצע היום" בסגירה (lib/closing-view.js loadDone) סופרת שאלה שנסגרה לפי read_at כ"ענית", וכאן יובל לא ענה עליה.
export async function closeQuestionsForTask(sql, taskId) {
  await sql`
    UPDATE messages SET awaiting_reply = false
    WHERE kind = 'question' AND awaiting_reply = true AND entity_type IN ('task', 'task_check') AND entity_id = ${taskId}::uuid
  `;
}

// ---------------------------------------------------------------------------
// יצירת "בוצע?"
// ---------------------------------------------------------------------------

const dayStartOf = (dateIso) => zonedToUtc(dateIso, '00:00', TIME_ZONE).toISOString();

// מיד כשהשעה הברורה עוברת (הודעת התור taskcheck). שאלה רק אם: המשימה עדיין פתוחה ואישית, due_at לא השתנה מאז התזמון (שווה ליעד),
// ואין עליה שאלה פתוחה או שאלה שנשלחה היום. הגעה כפולה של התור: אין שורה שנייה (false). כשל מסד נזרק (התור ינסה שוב).
// התפוגה: חצות אחרי היום של המועד + RELEVANCE_DAYS.
export async function createImmediateCheck({ sql, taskId, targetAt, now = new Date() }) {
  const nowIso = now.toISOString();
  const dayStart = dayStartOf(localDateIso(now, TIME_ZONE));
  const rows = rowsOf(await sql`
    INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${CHECK_PREFIX}::text || coalesce(nullif(btrim(t.title), ''), 'משימה'), 'question', now(), true, NULL::uuid,
      ((((t.due_at AT TIME ZONE 'Asia/Jerusalem')::date + ${RELEVANCE_DAYS + 1}::int)::timestamp) AT TIME ZONE 'Asia/Jerusalem'), 'task_check', t.id, 1
    FROM tasks t
    WHERE t.id = ${taskId}::uuid AND t.status = 'open' AND t.domain = 'personal' AND t.due_at = ${targetAt}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.entity_type = 'task_check' AND m.entity_id = t.id AND ((m.awaiting_reply = true AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)) OR m.sent_at >= ${dayStart}::timestamptz))
    RETURNING id
  `);
  return rows.length > 0;
}

// בסגירה של 21:00 (dateIso = תאריך המשבצת, targetAt = רגע הסגירה): "בוצע?" לכל משימה פתוחה, אישית או שיעורי בית, שמועדה עבר עד רגע הסגירה
// ולא לפני RELEVANCE_DAYS ימים, ושאין עליה שאלה פתוחה או שאלה מהיום. כולל משימה עם שעה ברורה שהשאלה המיידית שלה לא נוצרה (התור נכשל).
// שיעורי בית (הכרעה טכנית, בלוק 4): כן נשאלים, באותו כרטיס, ביום ההגשה. משימה עם שעה ברורה מאוחר מ-21:00 נשאלת מיד בשעתה, לא כאן.
// כרטיס לכל משימה (לא כרטיס מקובץ): הכרטיס הקיים בדף מציג אותו בלי שינוי. לא זורק לעולם: כשל = 0, ושם השגיאה בלוג (הסגירה ממשיכה).
export async function ensureClosingChecks({ sql, dateIso, targetAt, now = new Date() }) {
  try {
    const nowIso = now.toISOString();
    const relevanceStart = dayStartOf(addDays(dateIso, -RELEVANCE_DAYS));
    const dayStart = dayStartOf(dateIso);
    const rows = rowsOf(await sql`
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${CHECK_PREFIX}::text || coalesce(nullif(btrim(t.title), ''), 'משימה'), 'question', now(), true, NULL::uuid,
        ((((t.due_at AT TIME ZONE 'Asia/Jerusalem')::date + ${RELEVANCE_DAYS + 1}::int)::timestamp) AT TIME ZONE 'Asia/Jerusalem'), 'task_check', t.id, 1
      FROM tasks t
      WHERE t.status = 'open' AND t.domain IN ('personal', 'homework') AND t.due_at IS NOT NULL
        AND t.due_at <= ${iso(targetAt)}::timestamptz AND t.due_at >= ${relevanceStart}::timestamptz
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.entity_type = 'task_check' AND m.entity_id = t.id AND ((m.awaiting_reply = true AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)) OR m.sent_at >= ${dayStart}::timestamptz))
      RETURNING id
    `);
    return rows.length;
  } catch (error) {
    console.error('personal-task: יצירת שאלות "בוצע?" בסגירה נכשלה:', error?.name);
    return 0;
  }
}

// תזמון "בוצע?" לרגע המועד: הודעת תור מושהית אחת (planTaskCheck; המפתח הוא גם idempotencyKey, ולכן תזמון ביצירה ומה-Cron = הודעה אחת).
// task: { id, dueAt, timed }. רק משימה עם שעה ברורה, מועד עתידי ובתוך תקרת התור. מחזיר true כשנשלח. לא זורק: כשל או תקיעה (timeoutMs) נרשמים בשם השגיאה בלבד,
// והסגירה של 21:00 והתזמון היומי (lib/ops/cron-plan.js) הם רשת הביטחון.
export async function queueTaskCheck({ send, task, now = new Date(), timeoutMs = 3000 }) {
  if (!task?.timed || typeof task.id !== 'string' || !task.dueAt || typeof send !== 'function') return false;
  const plan = planTaskCheck({ taskId: task.id, dueAt: task.dueAt }, now);
  if (!plan) return false;
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), timeoutMs);
    });
    await Promise.race([send(SLOT_TOPIC, { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, {
      delaySeconds: plan.delaySeconds, retentionSeconds: plan.retentionSeconds, idempotencyKey: plan.slotKey,
    }), timeout]);
    return true;
  } catch (error) {
    console.error('personal-task: תזמון "בוצע?" נכשל:', error?.name);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// משימות אישיות פתוחות עם שעה ברורה בטווח (from, to], לתזמון ה-Cron. [{ id, dueAt (ISO) }]. כשל מסד נזרק.
export async function loadTimedTasks(sql, from, to) {
  const rows = rowsOf(await sql`
    SELECT id, due_at FROM tasks
    WHERE status = 'open' AND domain = 'personal' AND due_at > ${iso(from)}::timestamptz AND due_at <= ${iso(to)}::timestamptz
    ORDER BY due_at ASC
  `);
  return rows.filter((row) => isTimedDue(row.due_at)).map((row) => ({ id: row.id, dueAt: new Date(row.due_at).toISOString() }));
}
