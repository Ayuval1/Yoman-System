// שאלת החופשה היומית וכרטיס המסגרת החד-פעמי. מקור: docs/02-rules/03-personal-weights-rules.md §5.1 (הכרעת יובל 3.10.2026: כרטיס חד-פעמי של המסגרת לאישור,
// ובנוסף שאלה עם כפתורים בכל בוקר בחופשה); docs/01-foundation/05-open-questions.md:96; docs/08-chapter8/68-chapter8-brief-prd.md D7 וסעיף "שאלת החופשה היומית".
//  - שאלה יומית: בכל יום בטווח חופשה (lib/school-calendar.js, vacationOn), כולל היום הראשון ושבת שבתוך החופשה, עם הבריף של 07:30. שאלה אחת ליום, פוקעת בחצות שעון ישראל בסוף אותו יום.
//  - כרטיס מסגרת: פעם אחת לחופשה, בסגירה של 21:00 בערב שלפני היום הראשון, ואם הוחמץ, בבריף של היום הראשון. פוקע בחצות אחרי היום האחרון של החופשה.
// שתיהן שורת messages רגילה (kind='question', awaiting_reply=true), ולכן נספרות באייקון ונסגרות בתשובה כמו שאר השאלות. entity_type: 'vacation_day' / 'vacation_frame';
// entity_id דטרמיניסטי (briefEntityId) ממפתח היום או מהחופשה, וההכנסה עם WHERE NOT EXISTS: ריצה חוזרת לא יוצרת שנייה. אין טבלה חדשה ואין שינוי סכמה.
// אין אינדקס ייחודי, ולכן שני עיבודים מקבילים של אותה משבצת אינם מוגנים (כמו הבריף עצמו, 68 D10 א).
// התשובה נשמרת כשורת sources (ערוץ app, sender='answer') שמקושרת ב-messages.reply_source_id, כמו תשובה לשאלה רגילה (lib/intake-process.js), ובועת תשובה קצרה נכתבת באותה פקודה.
// הנחה, לא אומת: תשובה בכתיבה חופשית נשמרת בלבד ואינה עוברת חילוץ או מודל (כמו תשובה לשאלה רגילה). כלומר "תיקון" למסגרת לא משנה משימות.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { briefEntityId, sortedTasks, taskLine } from './brief-view.js';
import { VACATIONS, vacationOn } from './school-calendar.js';
import { EXAMS, examsOnDate } from './exam-line.js';
import { addDays, formatDayMonth, localDateIso, parseIso, WEEKDAY_NAMES, weekdayOf } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';
import { loadOpenTasks } from './homework-view.js';
import { loadExamAnswers } from './exam-ask.js';

const TIME_ZONE = 'Asia/Jerusalem';
const LRI = '⁦'; // בידוד כיווני: בפסקה עברית טווח מספרים מתהפך חזותית (כמו שעות הבריף ב-lib/brief-view.js)
const PDI = '⁩';
const DASH = '–';
const rowsOf = (result) => (Array.isArray(result) ? result : []);

export const VACATION_DAY_TYPE = 'vacation_day';
export const VACATION_FRAME_TYPE = 'vacation_frame';
export const VACATION_TYPES = Object.freeze([VACATION_DAY_TYPE, VACATION_FRAME_TYPE]);
export const VACATION_TASKS_ANSWER = 'משימות ולמידה';
export const VACATION_DAY_BUTTONS = Object.freeze([VACATION_TASKS_ANSWER, 'מנוחה', 'יוצא מהבית']);
export const VACATION_FRAME_APPROVE = 'מאשר';
export const VACATION_FRAME_FIX = 'לתקן';
export const VACATION_FRAME_END_LINE = 'כל בוקר אשאל מה התוכנית';
export const VACATION_FRAME_EMPTY_LINE = 'אין משימות או מבחנים עם תאריך בחופש';

// [הנחה, לא אומת] נוסחי שורת התשובה הם בחירה של Claude בבנייה, לא של יובל. ניתנים לשינוי כאן בלבד.
export const VACATION_ACK = 'נרשם. יום טוב';
export const VACATION_NO_TASKS = 'נרשם. אין משימות פתוחות. יום טוב';
export const VACATION_FRAME_APPROVED = 'נרשם. כל בוקר אשאל מה התוכנית';
export const VACATION_FRAME_FIXED = 'נרשם התיקון. המשימות עצמן לא שונו';

const vacationTitle = (vacation) => `חופש ${vacation.name}`;
const dayLabel = (dateIso) => `${WEEKDAY_NAMES[weekdayOf(dateIso)]} ${formatDayMonth(dateIso)}`;

export const vacationDayText = (vacation) => `${vacationTitle(vacation)} · מה התוכנית היום?`;

// "6–12.12" באותו חודש, "30.3–4.4" בין חודשים, עטוף בבידוד כיווני.
export function vacationRangeLabel(vacation) {
  const from = parseIso(vacation.from);
  const to = parseIso(vacation.to);
  const start = from.month === to.month && from.year === to.year ? String(from.day) : formatDayMonth(vacation.from);
  return `${LRI}${start}${DASH}${formatDayMonth(vacation.to)}${PDI}`;
}

// [הנחה, לא אומת] כמה ימים אחרי היום האחרון של החופשה נכנסים לשורת "מיד אחרי החופשה" (3 = מהיום שאחרי ועד שלושה ימים אחרי, כולל). הכרעה טכנית של Claude.
export const AFTER_VACATION_DAYS = 3;
export const VACATION_FRAME_AFTER_LINE = 'מיד אחרי החופשה:';

// הכרטיס: כותרת, שורה לכל יום בחופשה שיש בו פריט עם תאריך (מבחנים מ-data/school-exams.json ואז משימות פתוחות לפי סדר due_at),
// ואחריה "מיד אחרי החופשה:" עם אותן שורות ל-AFTER_VACATION_DAYS הימים שאחרי (מושמטת כשאין בהם כלום), ושורת הסיום.
// משימה שייכת ליום לפי התאריך הישראלי של due_at. משימה בלי תאריך או מחוץ לטווחים לא מוצגת. "מועד ב'" מסונן (examsOnDate).
export function composeVacationFrame({ vacation, tasks = [], exams = EXAMS, answers } = {}) {
  const lines = [`${vacationTitle(vacation)} ${vacationRangeLabel(vacation)}`];
  const lastAfter = addDays(vacation.to, AFTER_VACATION_DAYS);
  const byDay = new Map();
  for (const task of sortedTasks(Array.isArray(tasks) ? tasks : [])) {
    const ms = task.due_at ? Date.parse(task.due_at) : NaN;
    if (Number.isNaN(ms)) continue;
    const day = localDateIso(new Date(ms), TIME_ZONE);
    if (day < vacation.from || day > lastAfter) continue;
    const title = typeof task.title === 'string' && task.title.trim() !== '' ? task.title.trim() : 'משימה';
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(title);
  }
  // שורות הימים בטווח (כולל שני הקצוות), רק לימים שיש בהם פריט.
  const dayLines = (from, to) => {
    const out = [];
    for (let day = from; day <= to; day = addDays(day, 1)) {
      const items = [...examsOnDate(day, { exams, ...(answers ? { answers } : {}) }).map((exam) => exam.text), ...(byDay.get(day) ?? [])];
      if (items.length > 0) out.push(`· ${dayLabel(day)}: ${items.join(' · ')}`);
    }
    return out;
  };
  const during = dayLines(vacation.from, vacation.to);
  lines.push(...(during.length > 0 ? during : [VACATION_FRAME_EMPTY_LINE]));
  const after = dayLines(addDays(vacation.to, 1), lastAfter);
  if (after.length > 0) lines.push(VACATION_FRAME_AFTER_LINE, ...after);
  lines.push(VACATION_FRAME_END_LINE);
  return lines.join('\n');
}

export const vacationDayEntityId = (dateIso) => briefEntityId(`vacation-day-${dateIso}`);
export const vacationFrameEntityId = (vacation) => briefEntityId(`vacation-frame-${vacation.name}-${vacation.from}`);
export const dayAskExpiresAt = (dateIso) => zonedToUtc(addDays(dateIso, 1), '00:00', TIME_ZONE);
// [הנחה, לא אומת] הכרטיס פוקע בסוף החופשה (לא בסוף היום הראשון): אישור באמצע החופשה עדיין רלוונטי.
export const frameExpiresAt = (vacation) => zonedToUtc(addDays(vacation.to, 1), '00:00', TIME_ZONE);

// הכפתורים בכרטיס בצ'אט: מחרוזות, בדיוק כמו בשאלה רגילה (lib/chat-view.js), כדי שכרטיס השאלה הקיים בדף (questionCard ב-public/index.html) יציג אותם ותיבת הכתיבה בלי שינוי.
// "לתקן" שנשלח לבד מחזיר unclear: הכרטיס נשאר פתוח, ויובל כותב את התיקון בתיבה שבו.
export function vacationButtons(entityType) {
  if (entityType === VACATION_FRAME_TYPE) return [VACATION_FRAME_APPROVE, VACATION_FRAME_FIX];
  return [...VACATION_DAY_BUTTONS];
}

// שורת התשובה. tasks: מ-loadOpenTasks (רק ל"משימות ולמידה"). todayIso: לחישוב "באיחור".
// במסגרת: "לתקן" בלי טקסט = unclear (השאלה נשארת פתוחה); כל טקסט אחר שאינו "מאשר" = תיקון.
export function vacationReply({ entityType, answer, tasks = [], todayIso } = {}) {
  const text = typeof answer === 'string' ? answer.trim() : '';
  if (entityType === VACATION_FRAME_TYPE) {
    if (text === '' || text === VACATION_FRAME_FIX) return { status: 'unclear', reply: null };
    return { status: 'answered', reply: text === VACATION_FRAME_APPROVE ? VACATION_FRAME_APPROVED : VACATION_FRAME_FIXED };
  }
  if (text === '') return { status: 'unclear', reply: null };
  if (text !== VACATION_TASKS_ANSWER) return { status: 'answered', reply: VACATION_ACK };
  const list = sortedTasks(Array.isArray(tasks) ? tasks : []);
  if (list.length === 0) return { status: 'answered', reply: VACATION_NO_TASKS };
  return { status: 'answered', reply: [`נרשם. המשימות הפתוחות לפי תאריך (${list.length}):`, ...list.map((task) => taskLine(task, todayIso))].join('\n') };
}

// הכנסה אחת של שאלה. true = נוצרה עכשיו. כשל מסד נזרק (העוטפים למטה תופסים).
async function insertAsk({ sql, body, expiresAt, entityType, entityId }) {
  const rows = rowsOf(await sql`
    INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
    SELECT 'out', ${body}::text, 'question', now(), true, NULL::uuid, ${expiresAt.toISOString()}::timestamptz, ${entityType}::text, ${entityId}::uuid, 1
    WHERE NOT EXISTS (SELECT 1 FROM messages WHERE entity_type = ${entityType}::text AND entity_id = ${entityId}::uuid)
    RETURNING id
  `);
  return rows.length > 0;
}

// השאלה היומית. ניסיון חוזר שמגיע אחרי סוף היום לא יוצר אותה (היא כבר הייתה פוקעת).
export async function createVacationDayAsk({ sql, dateIso, vacation, now = new Date() }) {
  const expiresAt = dayAskExpiresAt(dateIso);
  if (expiresAt <= now) return false;
  return insertAsk({ sql, body: vacationDayText(vacation), expiresAt, entityType: VACATION_DAY_TYPE, entityId: vacationDayEntityId(dateIso) });
}

// כרטיס המסגרת. המשימות נטענות כאן (loadOpenTasks), והתשובות למבחני "מדעים" (loadExamAnswers, לא זורק).
export async function createVacationFrame({ sql, vacation, now = new Date(), exams = EXAMS }) {
  const expiresAt = frameExpiresAt(vacation);
  if (expiresAt <= now) return false;
  const tasks = await loadOpenTasks(sql);
  const answers = await loadExamAnswers(sql);
  const body = composeVacationFrame({ vacation, tasks, exams, answers });
  return insertAsk({ sql, body, expiresAt, entityType: VACATION_FRAME_TYPE, entityId: vacationFrameEntityId(vacation) });
}

// כרטיס מסגרת רק לחופשה עם תאריך סיום. [הנחה, לא אומת] "סוף שנת הלימודים" (endOfYear) מקבל שאלה יומית אבל לא כרטיס, כי אין לו טווח לפרוס.
const hasFrame = (vacation) => vacation.endOfYear !== true;

// בבריף של 07:30 (dateIso = תאריך המשבצת): ביום הראשון של החופשה, הכרטיס אם עוד לא נוצר; ובכל יום בחופשה, השאלה היומית. לא זורק לעולם: כשל נרשם (שם השגיאה בלבד) והבריף ממשיך.
export async function ensureVacationMorning({ sql, dateIso, now = new Date(), vacations = VACATIONS, exams = EXAMS }) {
  const result = { frame: false, day: false };
  const vacation = vacationOn(dateIso, vacations);
  if (!vacation) return result;
  if (dateIso === vacation.from && hasFrame(vacation)) {
    try {
      result.frame = await createVacationFrame({ sql, vacation, now, exams });
    } catch (error) {
      console.error('vacation-ask: יצירת כרטיס המסגרת נכשלה:', error?.name);
    }
  }
  try {
    result.day = await createVacationDayAsk({ sql, dateIso, vacation, now });
  } catch (error) {
    console.error('vacation-ask: יצירת שאלת החופשה נכשלה:', error?.name);
  }
  return result;
}

// בסגירה של 21:00 (dateIso = תאריך המשבצת): אם מחר הוא היום הראשון של חופשה, הכרטיס. לא זורק לעולם.
export async function ensureVacationEvening({ sql, dateIso, now = new Date(), vacations = VACATIONS, exams = EXAMS }) {
  const tomorrow = addDays(dateIso, 1);
  const vacation = vacationOn(tomorrow, vacations);
  if (!vacation || vacation.from !== tomorrow || !hasFrame(vacation)) return { frame: false };
  try {
    return { frame: await createVacationFrame({ sql, vacation, now, exams }) };
  } catch (error) {
    console.error('vacation-ask: יצירת כרטיס המסגרת נכשלה:', error?.name);
    return { frame: false };
  }
}

// פעולה vacation: { status: 'answered' | 'closed' | 'unclear', created: { answerSourceId, bubbleId } }.
//  - closed: השאלה לא קיימת, אינה של חופשה, כבר נסגרה, פגה, או נסגרה בלחיצה מקבילה. לא נכתב כלום.
//  - unclear: "לתקן" בלי טקסט. לא נכתב כלום והשאלה נשארת פתוחה.
//  - answered: פקודה אחת: סגירה מותנית של השאלה (awaiting_reply = true), שורת התשובה ב-sources, ובועת התשובה. כשל מסד נזרק (api/chat.js מחזיר 500).
export async function answerVacation({ sql, messageId, answer, now = new Date() }) {
  const nowIso = now.toISOString();
  const [ask] = rowsOf(await sql`
    SELECT m.id, m.entity_type, m.awaiting_reply FROM messages m
    WHERE m.id = ${messageId}::uuid AND m.kind = 'question' AND m.entity_type IN (${VACATION_DAY_TYPE}::text, ${VACATION_FRAME_TYPE}::text)
      AND (m.expires_at IS NULL OR m.expires_at > ${nowIso}::timestamptz)
  `);
  if (!ask || ask.awaiting_reply !== true) return { status: 'closed', created: {} };
  const answerText = String(answer).trim();
  const tasks = ask.entity_type === VACATION_DAY_TYPE && answerText === VACATION_TASKS_ANSWER ? await loadOpenTasks(sql) : [];
  const { status, reply } = vacationReply({ entityType: ask.entity_type, answer: answerText, tasks, todayIso: localDateIso(now, TIME_ZONE) });
  if (status !== 'answered') return { status, created: {} };
  // reply_source_id נקבע ב-closed ושורת המקור מוכנסת ממנו עם אותו מזהה, כמו ב-answerQuestion (lib/intake-process.js): לחיצה כפולה לא משאירה שורה יתומה.
  const [written] = rowsOf(await sql`
    WITH closed AS (
      UPDATE messages SET awaiting_reply = false, read_at = now(), reply_source_id = gen_random_uuid()
      WHERE id = ${messageId}::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = ${ask.entity_type}::text
        AND (expires_at IS NULL OR expires_at > ${nowIso}::timestamptz)
      RETURNING id, reply_source_id, entity_type, entity_id
    ), ans AS (
      INSERT INTO sources (id, channel, sender, raw_content, content_hash, received_at, processed_at)
      SELECT closed.reply_source_id, 'app', 'answer', ${answerText}::text, NULL::text, now(), now()
      FROM closed
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${reply}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, closed.entity_type, closed.entity_id, NULL::integer
      FROM closed
      RETURNING id
    )
    SELECT (SELECT count(*) FROM closed)::int AS closed, (SELECT id FROM ans) AS answer_source_id, (SELECT id FROM b) AS bubble_id
  `);
  if (Number(written?.closed) === 0) return { status: 'closed', created: {} };
  return { status: 'answered', created: { answerSourceId: written?.answer_source_id ?? null, bubbleId: written?.bubble_id ?? null } };
}
