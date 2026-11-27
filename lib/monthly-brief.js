// הבריף החודשי (אפיון-מורחב 15: מסר נפרד, הראשון בחודש ב-20:00, ושבת עוברת לראשון ה-2; בקשת יובל ב-docs/01-foundation/05-open-questions.md:20;
// התוכן המוצע ב-docs/06-handoff-notes/105-handoff-note-2026-11-24-overnight.md). התזמון ב-lib/message-slots.js (planMonthly), המסירה ב-api/queues/deliver.js.
// בלי AI, בלי רשת, בלי שעון: הכול קוד, והחודש מגיע מבחוץ (monthKey = YYYY-MM של החודש שמתחיל).
// הכרעת Claude (27.11.2026), קל לשנות: כל הנוסחים כאן, והבחירות שלמטה.
//  "החודש שעבר":
//   - מבחנים שהיו: מהלוח (data/school-exams.json עם שינויי "נדחה / בוטל" מה-DB, applyExamChanges מבחוץ). נדחה בלי מועד ומועד ב' לא נכנסים.
//     [הנחה, לא אומת] "היה" = היה בלוח באותו תאריך. אין במערכת רישום שמבחן התקיים בפועל.
//   - אימונים: events בתחום running שלא בוטלו (status planned או done; הערכים ב-db/schema.sql), באותו תנאי כותרת כמו lib/training-source.js
//     ("אימון ריצה..." או "ריצה"; "כוח" ו"התארגנות" לא נספרים), שהסתיימו בחודש. מתוכנן שלא סומן done נספר: אין במערכת אישור שכל אימון בוצע.
//   - למידה ביומן: סכום האורכים של אירועי study שלא בוטלו, שהסתיימו בחודש. "ביומן", לא "למדת": המערכת לא יודעת אם הלמידה קרתה.
//   - משימות שבוצעו: tasks עם status='done' ו-done_at בחודש. משימה שנסגרה לפני שנוספה העמודה done_at (C-2) לא נספרת.
//  "החודש הבא":
//   - מבחנים לפי תאריך (examsOnDate, בלי שעה: שורות קצרות). לוח שלא מכסה את החודש (או רק חלק ממנו) נאמר במפורש, ולא "אין מבחנים".
//   - שבוע עמוס: שבוע ראשון עד שבת שנוגע בחודש, עם DENSE_WEEK_MIN מבחנים ומעלה (גם מבחן מחוץ לחודש באותו שבוע נספר).
//   - חופשות וימים בלי לימודים: data/school-vacations.json, ואירועים אישיים של כמה ימים (lib/away.js awayRange) שנוגעים בחודש.
//     data/school-events-taf-shin-pe-zayin.md לא נקרא: אין לו קובץ JSON, ולא ממציאים ממנו ימים.
//  God Mode לא מופעל מכאן: lib/god-mode.js בודק שבוע עם 3 מבחנים ומעלה ב-14 הימים הקרובים, ורץ כבר בבריף של 07:30 בכל יום (גם ביום הזה),
//   עם מפתח לכל ממצא. קריאה מכאן עם אותו יום הייתה מוצאת את אותם ממצאים; כדי לראות חודש שלם צריך לשנות לו את האופק, וזה שינוי התנהגות שלו.
//   השבוע העמוס מופיע כאן כשורה, וכשהוא נכנס ל-14 הימים (ויש בו 3 מבחנים) God Mode מביא את הכרטיס שלו כרגיל.
//  "מה לשמר ומה לשפר": כרטיס שאלה אחרי הבריף, תשובה בכתיבה חופשית, נשמרת ב-facts (entity_type 'monthly_review') בלי שינוי סכמה. אף אחד לא קורא אותה עדיין.
// פרטיות: כותרות בהודעה עצמה (כמו השבועי); ההתראה (monthlyPushText) מספרים בלבד.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { EXAMS, examsOnDate } from './exam-line.js';
import { VACATIONS } from './school-calendar.js';
import { addDays, weekdayOf, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';
import { dayRange } from './closing-tomorrow.js';
import { awayRange } from './away.js';
import { briefEntityId } from './brief-view.js';
import { STUDY_DOMAIN } from './study-plan.js';

export const MONTHLY_ENTITY = 'monthly_brief';
export const MONTHLY_REVIEW_ENTITY = 'monthly_review';
export const DENSE_WEEK_MIN = 2;
export const MONTHLY_REVIEW_HOURS = 72; // [הנחה, לא אומת] "בערך 3 ימים"
// נוסחים (הכרעת Claude, 27.11.2026, קל לשנות).
export const MONTHLY_TITLE = 'בריף חודשי';
export const MONTHLY_PAST_TITLE = 'החודש שעבר';
export const MONTHLY_NEXT_TITLE = 'החודש הבא';
export const MONTHLY_PAST_EXAMS = 'מבחנים שהיו';
export const MONTHLY_EXAMS = 'מבחנים';
export const MONTHLY_TRAININGS = 'אימונים';
export const MONTHLY_STUDY = 'למידה ביומן';
export const MONTHLY_TASKS_DONE = 'משימות שבוצעו';
export const MONTHLY_DENSE = 'שבוע עמוס';
export const MONTHLY_VACATIONS = 'חופשות וימים בלי לימודים';
export const MONTHLY_NOTHING_LINE = 'אין מה לסכם מהחודש שעבר, ואין מבחנים או חופשות בחודש הבא.';
export const MONTHLY_REVIEW_TEXT = 'מה לשמר מהחודש, ומה לשפר?';
export const MONTHLY_REVIEW_ACK = 'נרשם';
export const MONTH_NAMES = Object.freeze(['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const rowsOf = (value) => (Array.isArray(value) ? value : []);
const pad = (n) => String(n).padStart(2, '0');
const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);
const sundayOf = (dateIso) => addDays(dateIso, -weekdayOf(dateIso));
const countOrNull = (value) => (Number.isInteger(value) && value >= 0 ? value : null);

export const monthLabel = (monthKey) => MONTH_NAMES[Number(monthKey.slice(5, 7)) - 1];
export function prevMonthKey(monthKey) {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  return month === 1 ? `${year - 1}-12` : `${year}-${pad(month - 1)}`;
}
const nextMonthKey = (monthKey) => addDays(`${monthKey}-28`, 7).slice(0, 7);
const firstDay = (monthKey) => `${monthKey}-01`;
const lastDay = (monthKey) => addDays(`${nextMonthKey(monthKey)}-01`, -1);

// תחילת היום הראשון בחודש עד תחילת היום הראשון בחודש שאחריו, שעון ישראל.
export function monthRange(monthKey) {
  return { from: dayRange(firstDay(monthKey)).from, to: dayRange(`${nextMonthKey(monthKey)}-01`).from };
}

const realExam = (exam) => Boolean(exam) && exam.makeup !== true && exam.postponed !== true && typeof exam.subject === 'string' && exam.subject !== '' && ISO_DAY.test(exam.date ?? '');

// שבועות (ראשון עד שבת) שנוגעים בחודש ויש בהם DENSE_WEEK_MIN מבחנים ומעלה: [{ sunday, count }] לפי הסדר.
export function denseWeeks({ monthKey, exams = EXAMS }) {
  const first = firstDay(monthKey);
  const last = lastDay(monthKey);
  const weeks = new Map();
  for (const exam of rowsOf(exams)) {
    if (!realExam(exam)) continue;
    const sunday = sundayOf(exam.date);
    if (addDays(sunday, 6) < first || sunday > last) continue;
    weeks.set(sunday, (weeks.get(sunday) ?? 0) + 1);
  }
  return [...weeks].filter(([, count]) => count >= DENSE_WEEK_MIN).sort(([a], [b]) => (a < b ? -1 : 1)).map(([sunday, count]) => ({ sunday, count }));
}

function vacationLine(vacation) {
  if (vacation.endOfYear === true) return `· ${vacation.name} · מ-${formatDayMonth(vacation.from)}`;
  const range = vacation.from === vacation.to ? formatDayMonth(vacation.from) : `${formatDayMonth(vacation.from)}–${formatDayMonth(vacation.to)}`;
  return `· ${vacation.name} · ${range}`;
}

// exams: הלוח אחרי applyExamChanges (מבחוץ). answers: Map תאריך -> 'פיזיקה' | 'כימיה'. trainings, studyMinutes, tasksDone: מספרים, או null כשלא נטענו.
// away: [{ title, start, last }] (loadMonthAway). vacations: הקובץ (לבדיקות). partial=true: חלק לא נטען, ולכן אסור לטעון "אין כלום".
// מחזיר { text, counts: { pastExams, trainings, studyMinutes, tasksDone, exams, denseWeeks, vacations } }.
export function composeMonthly({ monthKey, exams = EXAMS, answers, trainings = null, studyMinutes = null, tasksDone = null, away = [], vacations = VACATIONS, partial = false } = {}) {
  const board = rowsOf(exams);
  const options = { exams: board, ...(answers ? { answers } : {}) };
  const past = prevMonthKey(monthKey);

  // החודש שעבר.
  const pastLines = [];
  const pastExams = board.filter((exam) => realExam(exam) && exam.date.startsWith(`${past}-`)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const pastExamLines = [];
  for (const exam of pastExams) {
    const [shown] = examsOnDate(exam.date, { ...options, exams: [exam] });
    if (shown) pastExamLines.push(`· ${formatDayMonth(exam.date)} · ${shown.text}`);
  }
  if (pastExamLines.length > 0) pastLines.push(`${MONTHLY_PAST_EXAMS} (${pastExamLines.length}):`, ...pastExamLines);
  const trainingCount = countOrNull(trainings);
  if (trainingCount) pastLines.push(`${MONTHLY_TRAININGS}: ${trainingCount}`);
  const minutes = countOrNull(studyMinutes);
  if (minutes) pastLines.push(`${MONTHLY_STUDY}: ${minutes < 30 ? 'פחות משעה' : hoursText(Math.round(minutes / 60))}`);
  const doneCount = countOrNull(tasksDone);
  if (doneCount) pastLines.push(`${MONTHLY_TASKS_DONE}: ${doneCount}`);

  // החודש הבא.
  const first = firstDay(monthKey);
  const last = lastDay(monthKey);
  const nextLines = [];
  const examLines = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    for (const exam of examsOnDate(date, options)) examLines.push(`· יום ${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDayMonth(date)} · ${exam.text}`);
  }
  if (examLines.length > 0) nextLines.push(`${MONTHLY_EXAMS} (${examLines.length}):`, ...examLines);
  // כיסוי הלוח: התאריך האחרון של מבחן שאינו מועד ב'. בלי לוח בכלל: לא נאמר כלום (אין על מה להישען).
  const coverageEnd = board.filter((exam) => exam?.makeup !== true && ISO_DAY.test(exam?.date ?? '')).map((exam) => exam.date).sort().at(-1);
  if (coverageEnd && coverageEnd < first) nextLines.push(`לוח המבחנים עוד לא מכסה את ${monthLabel(monthKey)}`);
  else if (coverageEnd && coverageEnd < last) nextLines.push(`לוח המבחנים מכסה רק עד ${formatDayMonth(coverageEnd)}`);
  const dense = denseWeeks({ monthKey, exams: board });
  for (const week of dense) nextLines.push(`${MONTHLY_DENSE} · ${formatDayMonth(week.sunday)}–${formatDayMonth(addDays(week.sunday, 6))} · ${week.count} מבחנים`);
  const vacationLines = [];
  for (const vacation of rowsOf(vacations)) {
    if (!vacation || !ISO_DAY.test(vacation.from ?? '') || typeof vacation.name !== 'string') continue;
    const end = vacation.endOfYear === true ? vacation.from : vacation.to;
    if (vacation.from <= last && end >= first) vacationLines.push(vacationLine(vacation));
  }
  for (const range of rowsOf(away)) {
    if (!range || !ISO_DAY.test(range.start ?? '') || !ISO_DAY.test(range.last ?? '') || range.start > last || range.last < first) continue;
    vacationLines.push(vacationLine({ name: typeof range.title === 'string' && range.title.trim() !== '' ? range.title.trim() : 'אירוע', from: range.start, to: range.last }));
  }
  if (vacationLines.length > 0) nextLines.push(`${MONTHLY_VACATIONS}:`, ...vacationLines);

  const lines = [`${MONTHLY_TITLE} · ${monthLabel(monthKey)}`];
  if (pastLines.length > 0) lines.push(`${MONTHLY_PAST_TITLE} · ${monthLabel(past)}`, ...pastLines);
  if (nextLines.length > 0) lines.push(`${MONTHLY_NEXT_TITLE} · ${monthLabel(monthKey)}`, ...nextLines);
  if (lines.length === 1 && !partial) lines.push(MONTHLY_NOTHING_LINE);
  const counts = {
    pastExams: pastExamLines.length, trainings: trainingCount ?? 0, studyMinutes: minutes ?? 0, tasksDone: doneCount ?? 0,
    exams: examLines.length, denseWeeks: dense.length, vacations: vacationLines.length,
  };
  return { text: lines.join('\n'), counts };
}

// נוסח ההתראה: מספרים בלבד על החודש הבא, אף פעם לא כותרת (כמו weeklyPushText).
export function monthlyPushText({ exams = 0, denseWeeks: dense = 0, vacations = 0 } = {}) {
  const parts = [];
  if (exams > 0) parts.push(exams === 1 ? 'מבחן אחד' : `${exams} מבחנים`);
  if (dense > 0) parts.push(dense === 1 ? 'שבוע עמוס אחד' : `${dense} שבועות עמוסים`);
  if (vacations > 0) parts.push(vacations === 1 ? 'חופשה אחת' : `${vacations} חופשות`);
  return `${MONTHLY_NEXT_TITLE}: ${parts.length > 0 ? parts.join(' · ') : 'שקט'}`;
}

// ---------------------------------------------------------------------------
// טוענים. כשל מסד נזרק; הצרכן (api/queues/deliver.js, loadPart) מחליט.
// ---------------------------------------------------------------------------

const toCount = (row, field) => {
  const n = Number(row?.[field]);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// אימונים שלא בוטלו שהסתיימו בחודש monthKey. מספר.
export async function loadMonthTrainings(sql, monthKey) {
  const { from, to } = monthRange(monthKey);
  const [row] = rowsOf(await sql`
    SELECT /* monthly-trainings */ count(*)::int AS n FROM events
    WHERE domain = 'running' AND status IN ('planned', 'done') AND (title LIKE 'אימון ריצה%' OR title = 'ריצה')
      AND ends_at >= ${from.toISOString()}::timestamptz AND ends_at < ${to.toISOString()}::timestamptz
  `);
  return toCount(row, 'n');
}

// דקות הלמידה ביומן: סכום האורכים של אירועי study שלא בוטלו, שהסתיימו בחודש. מספר.
export async function loadMonthStudyMinutes(sql, monthKey) {
  const { from, to } = monthRange(monthKey);
  const [row] = rowsOf(await sql`
    SELECT /* monthly-study */ COALESCE(sum(EXTRACT(EPOCH FROM (ends_at - starts_at)) / 60), 0)::int AS minutes FROM events
    WHERE domain = ${STUDY_DOMAIN}::text AND status IN ('planned', 'done') AND starts_at IS NOT NULL AND ends_at > starts_at
      AND ends_at >= ${from.toISOString()}::timestamptz AND ends_at < ${to.toISOString()}::timestamptz
  `);
  return toCount(row, 'minutes');
}

// משימות שסומנו "בוצע" בחודש. מספר.
export async function loadMonthTasksDone(sql, monthKey) {
  const { from, to } = monthRange(monthKey);
  const [row] = rowsOf(await sql`
    SELECT /* monthly-tasks-done */ count(*)::int AS n FROM tasks WHERE status = 'done' AND done_at >= ${from.toISOString()}::timestamptz AND done_at < ${to.toISOString()}::timestamptz
  `);
  return toCount(row, 'n');
}

// אירועים אישיים של כמה ימים (מחוץ לבית, lib/away.js) שנוגעים בחודש monthKey: [{ title, start, last }].
export async function loadMonthAway(sql, monthKey) {
  const { from, to } = monthRange(monthKey);
  const rows = rowsOf(await sql`
    SELECT /* monthly-away */ id, title, domain, status, starts_at, ends_at FROM events
    WHERE domain = 'personal' AND status = 'planned' AND starts_at < ${to.toISOString()}::timestamptz AND ends_at > ${from.toISOString()}::timestamptz
    ORDER BY starts_at ASC, id ASC
  `);
  const first = firstDay(monthKey);
  const last = lastDay(monthKey);
  const out = [];
  for (const row of rows) {
    const range = awayRange(row);
    if (range && range.start <= last && range.last >= first) out.push({ title: range.title, start: range.start, last: range.last });
  }
  return out;
}

// ---------------------------------------------------------------------------
// כרטיס "מה לשמר מהחודש, ומה לשפר?" (כמו lib/exam-feel.js, אבל בכתיבה חופשית בלי כפתורים, כמו "עד מתי?" של משימה אישית).
// ---------------------------------------------------------------------------

export const monthlyReviewEntityId = (monthKey) => briefEntityId(`monthly-review-${monthKey}`);
export const monthlyReviewExpiresAt = (targetAt) => new Date(Date.parse(targetAt) + MONTHLY_REVIEW_HOURS * 3600 * 1000);

// יוצר את הכרטיס פעם אחת לחודש (NOT EXISTS על entity_id דטרמיניסטי, גם אחרי שנענה), עם עובדת 'month'. sent_at שנייה אחרי הבריף, כדי שיופיע אחריו.
// לא זורק: כשל = { created: false }, והבריף נשלח בכל זאת.
export async function ensureMonthlyReview({ sql, monthKey, targetAt }) {
  try {
    const entityId = monthlyReviewEntityId(monthKey);
    const sentAt = new Date(Date.parse(targetAt) + 1000).toISOString();
    const [row] = rowsOf(await sql`
      /* monthly-review-create */ WITH m AS (
        INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
        SELECT 'out', ${MONTHLY_REVIEW_TEXT}::text, 'question', ${sentAt}::timestamptz, true, NULL::uuid, ${monthlyReviewExpiresAt(targetAt).toISOString()}::timestamptz, ${MONTHLY_REVIEW_ENTITY}::text, ${entityId}::uuid, 1
        WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = ${MONTHLY_REVIEW_ENTITY}::text AND x.entity_id = ${entityId}::uuid)
        RETURNING id
      ), f AS (
        INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
        SELECT NULL::uuid, 'month', ${monthKey}::text, 'certain', 'script', ${MONTHLY_REVIEW_ENTITY}::text, ${entityId}::uuid, 'read'
        WHERE EXISTS (SELECT 1 FROM m)
        RETURNING id
      )
      SELECT (SELECT id FROM m) AS message_id
    `);
    return { created: Boolean(row?.message_id) };
  } catch (error) {
    console.error('monthly-brief: יצירת כרטיס השאלה נכשלה:', error?.name);
    return { created: false };
  }
}

// תשובה (api/chat.js). { status: 'answered' | 'closed' | 'unclear', created, keys: [], patchKeys: [] }. פקודה אחת מותנית בסגירת הכרטיס. כשל מסד נזרק.
// התשובה נשמרת ב-sources (sender='answer', מקושרת ב-messages.reply_source_id) וב-facts (field 'answer', בלי source_id, כמו exam-feel:
// עובדה עם source_id נקראת ב"נקלט היום" ובזיהוי). בועה "נרשם".
export async function answerMonthlyReview({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const closed = { status: 'closed', created: {}, keys: [], patchKeys: [] };
  const [ask] = rowsOf(await sql`
    SELECT /* monthly-review-ask */ m.id, m.awaiting_reply FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type = ${MONTHLY_REVIEW_ENTITY}::text
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return closed;
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (text === '') return { status: 'unclear', created: {}, keys: [], patchKeys: [] };
  const [row] = rowsOf(await sql`
    /* monthly-review-answer */ WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${MONTHLY_REVIEW_ENTITY}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${text}::text, NULL::text, now(), now() FROM closed
      RETURNING id
    ), fact AS (
      INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
      SELECT NULL::uuid, 'answer', ${text}::text, 'certain', 'script', ${MONTHLY_REVIEW_ENTITY}::text, closed.entity_id, 'read' FROM closed
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${MONTHLY_REVIEW_ACK}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', closed.reply_source_id, NULL::integer FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (!row || Number(row.closed) === 0) return closed;
  return { status: 'answered', created: { answerSourceId: row.answer_source_id ?? null, bubbleId: row.bubble_id ?? null }, keys: [], patchKeys: [] };
}
