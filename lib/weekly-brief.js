// הבריף השבועי (בלוק 8, אפיון-מורחב סעיף 15, ש3 ב-01-system-overview): שבת 20:00 שעון ישראל, מסר נפרד "השבוע הבא".
// תוכן (הכרעת יובל, ש3 = א'): מבחנים, הגשות ואימונים של ראשון עד שבת שאחרי השבת הזאת, ושורות "חדש מאז שבוע שעבר". סעיף ריק מושמט; אין כלום = שורה קצרה אחת.
// פונקציות טהורות (composeWeekly, weeklyPushText) וטוענים עם sql מוזרק. בלי AI, בלי רשת, בלי שעון (התאריך מגיע מבחוץ).
//  - מבחנים: examsOnDate (data/school-exams.json עם שינויי "נדחה / בוטל" מה-DB, שמגיעים מבחוץ ב-exams). מבדק (בוחן) מסומן בסוג שלו ("מבדק ב...").
//    הנחה, לא אומת: אין מבחנים שנרשמים ל-events מהקליטה (lib/intake-process.js כותב ל-events רק אירוע אישי ויציאה מוקדמת), ולכן "מבחני DB" = שינויי הלוח בלבד.
//  - הגשות: tasks פתוחות ש-due_at שלהן בשבוע הבא (שיעורי בית ומשימות). באיחור לא נכנס (זה תפקיד הבריף היומי). שעה מוצגת רק כשיש שעה ברורה (isTimedDue).
//  - אימונים: events בתחום running מתוכננים בשבוע הבא, באותו תנאי כמו lib/training-source.js.
//  - "חדש מאז שבוע שעבר": הנחה, לא אומת: כל מה שנקלט (sources בערוצים app/shortcut, עם עובדת type) ב-7×24 השעות שלפני הרגע של הבריף, באותו נוסח "נקלט" של הסגירה (loadReceived).
//    אין עמודת updated_at בסכמה, ולכן "שונה" נספר רק כשהשינוי הגיע כהודעה. חלון קבוע לפי targetAt (לא לפי מועד הבריף הקודם בפועל), כדי שיהיה דטרמיניסטי וללא תלות בכך שהקודם נשלח.
// פרטיות: כמו הבריף היומי, כותרות בהודעה עצמה; ההתראה (weeklyPushText) מספרים בלבד.
// הבריף הדו-שבועי (הכרעת Claude, לילה 26.11.2026, קל לשנות; התוכן לפי ההצעה ב-docs/06-handoff-notes/105-handoff-note-2026-11-24-overnight.md, שאלה 1):
//  לא הודעה נפרדת ולא קצב שלישי (03-app-channel-rules: אין קצב חדש), אלא סעיף "שבועיים קדימה" בסוף הבריף השבועי, בשבת דו-שבועית בלבד (isBiweeklySaturday).
//  - המבחנים של הימים 1 עד 14 אחרי השבת, ולכל אחד כמה שעות למידה כבר ביומן: אירועי events בתחום study, status='planned', עם המפתח
//    source:study:<תאריך מבחן>:<מקצוע>:... (lib/study-plan.js studyKey). נספרים גם בלוקים שכבר עברו (הם "ביומן"); בלוק שבוטל לא נספר. [הנחה, לא אומת]
//    המפתח לפי הלוח (המקצוע כפי שהוא בלוח, למשל "מדעים"), כמו ב-offerStudyPlans; התצוגה לפי examsOnDate (עם תשובת פיזיקה/כימיה). מבחן שנדחה בלי מועד ומועד ב' לא נכנסים.
//  - כללים שהמערכת למדה ומחכים לאישור: candidate_rules במצב 'candidate' שיש להם כרטיס פתוח (lib/correction-rules.js). מספר בלבד, בלי המילים (הן בכרטיס עצמו).
//  - ממצאי God Mode לא נכנסים: הם כרטיסי עדכון חד-פעמיים בלי מצב "פתוח / נסגר" (lib/god-mode.js), ואין מה לשלוף בלי להמציא מצב.
//  - אין מבחנים ב-14 הימים ואין כללים ממתינים: הסעיף מושמט (כמו כל סעיף ריק).
//  החודשי נבנה אחר כך כמסר נפרד (אפיון-מורחב 15): lib/monthly-brief.js (27.11.2026).
import { examsOnDate, EXAMS } from './exam-line.js';
import { addDays, daysBetween, formatDayMonth, weekdayOf, localDateIso, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts } from './schedule-time.js';
import { isTimedDue } from './personal-task.js';
import { dayRange } from './closing-tomorrow.js';
import { loadReceived } from './closing-view.js';
import { CORRECTION_ENTITY } from './correction-rules.js';
import { BEHAVIOR_ENTITY } from './behavior-rules.js';
import { STUDY_DOMAIN } from './study-plan.js';

const TIME_ZONE = 'Asia/Jerusalem';
export const WEEKLY_NOTHING_LINE = 'אין מבחנים, הגשות או אימונים בשבוע הבא.';
export const WEEKLY_FRESH_TITLE = 'חדש מאז שבוע שעבר:';
export const WEEKLY_FRESH_MAX = 10; // [הנחה, לא אומת] כמו תקרת "לא הייתי בטוח" בסגירה: מעבר לזה "ועוד N"
// עוגן לחילופין שבועי / דו-שבועי: שבת 28.11.2026. [הנחה, לא אומת] נבחר כאן; יובל לא קבע עוגן. שבת במרחק כפולה של 14 יום ממנו = דו-שבועית.
// עוגן קבוע ולא זוגיות של מספר שבוע ISO, כי בשנה עם 53 שבועות ISO הזוגיות נשברת (שתי שבתות דו-שבועיות רצופות). הראשונה: 28.11.2026, אחריה 12.12, 26.12 וכן הלאה.
export const BIWEEKLY_ANCHOR = '2026-11-28';
export const BIWEEKLY_DAYS = 14;
// נוסחים (הכרעת Claude, לילה 26.11, קל לשנות).
export const BIWEEKLY_TITLE = 'שבועיים קדימה';
export const BIWEEKLY_NO_STUDY = 'עוד אין למידה ביומן';
export const BIWEEKLY_RULES_LINE = 'כללים שלמדתי ומחכים לאישור שלך';
const STUDY_KEY = /^source:study:(\d{4}-\d{2}-\d{2}):([^:]+):/;
const hoursText = (n) => (n === 1 ? 'שעה אחת' : n === 2 ? 'שעתיים' : `${n} שעות`);
const pad = (n) => String(n).padStart(2, '0');
const rowsOf = (value) => (Array.isArray(value) ? value : []);
const dayLabel = (dateIso) => `יום ${WEEKDAY_NAMES[weekdayOf(dateIso)]} ${formatDayMonth(dateIso)}`;

// ראשון עד שבת שאחרי שבת saturdayIso.
export function weekDates(saturdayIso) {
  return Array.from({ length: 7 }, (_, i) => addDays(saturdayIso, i + 1));
}

export function isBiweeklySaturday(saturdayIso) {
  return daysBetween(BIWEEKLY_ANCHOR, saturdayIso) % 14 === 0;
}

// הימים 1 עד 14 אחרי שבת saturdayIso.
export function biweeklyDates(saturdayIso) {
  return Array.from({ length: BIWEEKLY_DAYS }, (_, i) => addDays(saturdayIso, i + 1));
}

// דקות למידה לכל מבחן: Map '<תאריך>:<מקצוע>' -> דקות. rows: [{ match_key, starts_at, ends_at }]. שורה בלי מפתח למידה מדולגת.
export function studyHoursByExam(rows) {
  const minutes = new Map();
  for (const row of rowsOf(rows)) {
    const m = STUDY_KEY.exec(String(row?.match_key ?? ''));
    if (!m) continue;
    const span = Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000);
    if (!Number.isFinite(span) || span <= 0) continue;
    const key = `${m[1]}:${m[2]}`;
    minutes.set(key, (minutes.get(key) ?? 0) + span);
  }
  return minutes;
}

// שורות הסעיף. studyRows=null: שעות הלמידה לא נטענו, ולכן אין סיומת שעות (ולא טענה "עוד אין").
function biweeklyLines({ saturdayIso, timetable, exams, answers, studyRows, pendingRules }) {
  const dates = biweeklyDates(saturdayIso);
  const board = Array.isArray(exams) ? exams : EXAMS;
  const minutes = studyRows === null ? null : studyHoursByExam(studyRows);
  const examLines = [];
  for (const date of dates) {
    for (const exam of board) {
      if (!exam || exam.date !== date || exam.makeup === true || exam.postponed === true || typeof exam.subject !== 'string' || exam.subject === '') continue;
      const [shown] = examsOnDate(date, { timetable, exams: [exam], ...(answers ? { answers } : {}) });
      if (!shown) continue;
      let suffix = '';
      if (minutes) {
        const total = minutes.get(`${exam.date}:${exam.subject}`) ?? 0;
        suffix = total > 0 ? ` · ${hoursText(Math.max(1, Math.round(total / 60)))} למידה ביומן` : ` · ${BIWEEKLY_NO_STUDY}`;
      }
      examLines.push(`· ${dayLabel(date)} · ${shown.text}${suffix}`);
    }
  }
  const rules = Number.isInteger(pendingRules) && pendingRules > 0 ? pendingRules : 0;
  if (examLines.length === 0 && rules === 0) return { lines: [], exams: 0 };
  const lines = [];
  if (examLines.length > 0) lines.push(`${BIWEEKLY_TITLE} · ${formatDayMonth(dates[0])}–${formatDayMonth(dates[BIWEEKLY_DAYS - 1])} (${examLines.length}):`, ...examLines);
  if (rules > 0) lines.push(`${BIWEEKLY_RULES_LINE}: ${rules}`);
  return { lines, exams: examLines.length };
}

const timeOf = (iso) => {
  const parts = localParts(new Date(iso), TIME_ZONE);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
};

// exams: רשימת מבחנים (applyExamChanges מבחוץ). tasks: [{ title, due_at }]. trainings: [{ title, startsAt }]. received: שורות "נקלט" (מחרוזות).
// partial=true: חלק מהנתונים לא נטען, ולכן אסור לטעון "אין כלום".
// studyRows (loadBiweeklyStudy, או null כשלא נטען) ו-pendingRules (מספר): נקראים רק בשבת דו-שבועית.
// מחזיר { text, counts: { exams, tasks, trainings, fresh, biweeklyExams }, biweekly }.
export function composeWeekly({ saturdayIso, timetable = null, exams, answers, tasks = [], trainings = [], received = [], studyRows = [], pendingRules = 0, partial = false } = {}) {
  const dates = weekDates(saturdayIso);
  const first = dates[0];
  const last = dates[6];

  const examLines = [];
  for (const date of dates) {
    for (const exam of examsOnDate(date, { timetable, ...(exams ? { exams } : {}), ...(answers ? { answers } : {}) })) examLines.push(`· ${dayLabel(date)} · ${exam.text}`);
  }

  const taskRows = [];
  for (const task of rowsOf(tasks)) {
    const ms = task?.due_at ? Date.parse(task.due_at) : NaN;
    if (Number.isNaN(ms)) continue;
    const date = localDateIso(new Date(ms), TIME_ZONE);
    if (date < first || date > last) continue;
    const title = typeof task.title === 'string' && task.title.trim() !== '' ? task.title.trim() : 'משימה';
    taskRows.push({ ms, line: `· ${dayLabel(date)} · ${title}${isTimedDue(task.due_at) ? ` · ${timeOf(task.due_at)}` : ''}` });
  }
  taskRows.sort((a, b) => a.ms - b.ms);

  const trainingRows = [];
  for (const training of rowsOf(trainings)) {
    const ms = training?.startsAt ? Date.parse(training.startsAt) : NaN;
    if (Number.isNaN(ms)) continue;
    const date = localDateIso(new Date(ms), TIME_ZONE);
    if (date < first || date > last) continue;
    const title = typeof training.title === 'string' && training.title.trim() !== '' ? training.title.trim() : 'אימון';
    trainingRows.push({ ms, line: `· ${dayLabel(date)} · ${title} · ${timeOf(training.startsAt)}` });
  }
  trainingRows.sort((a, b) => a.ms - b.ms);

  const fresh = rowsOf(received).filter((line) => typeof line === 'string' && line.trim() !== '');
  const biweekly = isBiweeklySaturday(saturdayIso);
  const extra = biweekly ? biweeklyLines({ saturdayIso, timetable, exams, answers, studyRows, pendingRules }) : { lines: [], exams: 0 };
  const counts = { exams: examLines.length, tasks: taskRows.length, trainings: trainingRows.length, fresh: fresh.length, biweeklyExams: extra.exams };

  const lines = [`השבוע הבא · ${formatDayMonth(first)}–${formatDayMonth(last)}`];
  if (examLines.length > 0) lines.push(`מבחנים (${examLines.length}):`, ...examLines);
  if (taskRows.length > 0) lines.push(`הגשות (${taskRows.length}):`, ...taskRows.map((row) => row.line));
  if (trainingRows.length > 0) lines.push(`אימונים (${trainingRows.length}):`, ...trainingRows.map((row) => row.line));
  if (fresh.length > 0) {
    lines.push(WEEKLY_FRESH_TITLE, ...fresh.slice(0, WEEKLY_FRESH_MAX).map((line) => `· ${line}`));
    if (fresh.length > WEEKLY_FRESH_MAX) lines.push(`ועוד ${fresh.length - WEEKLY_FRESH_MAX}`);
  }
  if (lines.length === 1 && !partial) lines.push(WEEKLY_NOTHING_LINE);
  lines.push(...extra.lines);
  return { text: lines.join('\n'), counts, biweekly };
}

// נוסח ההתראה: מספרים בלבד, אף פעם לא כותרת.
export function weeklyPushText({ exams = 0, tasks = 0, trainings = 0, fresh = 0 } = {}) {
  const parts = [];
  if (exams > 0) parts.push(exams === 1 ? 'מבחן אחד' : `${exams} מבחנים`);
  if (tasks > 0) parts.push(tasks === 1 ? 'משימה אחת להגשה' : `${tasks} משימות להגשה`);
  if (trainings > 0) parts.push(trainings === 1 ? 'אימון אחד' : `${trainings} אימונים`);
  if (fresh > 0) parts.push(fresh === 1 ? 'חדש אחד' : `${fresh} חדשים`);
  return `השבוע הבא: ${parts.length > 0 ? parts.join(' · ') : 'שקט'}`;
}

// הגשות של השבוע הבא: tasks פתוחות עם due_at בין תחילת ראשון לסוף שבת (שעון ישראל). כשל מסד נזרק (הצרכן מחליט).
export async function loadWeekTasks(sql, saturdayIso) {
  const dates = weekDates(saturdayIso);
  const from = dayRange(dates[0]).from.toISOString();
  const to = dayRange(dates[6]).to.toISOString();
  const rows = rowsOf(await sql`
    SELECT t.title, t.due_at FROM tasks t
    WHERE t.status = 'open' AND t.due_at >= ${from}::timestamptz AND t.due_at < ${to}::timestamptz
    ORDER BY t.due_at ASC, t.id ASC
  `);
  return rows.map((row) => ({ title: row.title, due_at: row.due_at }));
}

// אימונים של השבוע הבא: אותו תנאי כמו loadTrainingsForDate (lib/training-source.js), בטווח אחד. כשל מסד נזרק.
export async function loadWeekTrainings(sql, saturdayIso) {
  const dates = weekDates(saturdayIso);
  const from = dayRange(dates[0]).from.toISOString();
  const to = dayRange(dates[6]).to.toISOString();
  const rows = rowsOf(await sql`
    SELECT title, starts_at FROM events
    WHERE domain = 'running' AND status = 'planned' AND (title LIKE 'אימון ריצה%' OR title = 'ריצה')
      AND starts_at >= ${from}::timestamptz AND starts_at < ${to}::timestamptz
    ORDER BY starts_at ASC
  `);
  return rows.map((row) => ({ title: typeof row?.title === 'string' ? row.title : '', startsAt: row?.starts_at ? new Date(row.starts_at).toISOString() : null }));
}

// "חדש": הנקלט ב-7×24 השעות שלפני targetAt. מחזיר שורות (מחרוזות). כשל מסד נזרק.
export async function loadWeekFresh(sql, targetAt) {
  const upper = new Date(targetAt);
  const lower = new Date(upper.getTime() - 7 * 86400000);
  const received = await loadReceived(sql, { lower, upper });
  return rowsOf(received?.lines);
}

// שעות הלמידה לסעיף הדו-שבועי: אירועי study מתוכננים עם מפתח למידה שמתחילים לפני סוף היום ה-14. הסינון לפי מבחן נעשה ב-studyHoursByExam. כשל מסד נזרק.
export async function loadBiweeklyStudy(sql, saturdayIso) {
  const to = dayRange(biweeklyDates(saturdayIso)[BIWEEKLY_DAYS - 1]).to.toISOString();
  const rows = rowsOf(await sql`
    SELECT /* biweekly-study */ match_key, starts_at, ends_at FROM events
    WHERE domain = ${STUDY_DOMAIN}::text AND status = 'planned' AND match_key LIKE 'source:study:%' AND starts_at < ${to}::timestamptz
    ORDER BY starts_at ASC
  `);
  const isoOf = (value) => (value ? new Date(value).toISOString() : null);
  return rows.map((row) => ({ match_key: row?.match_key ?? null, starts_at: isoOf(row?.starts_at), ends_at: isoOf(row?.ends_at) }));
}

// כמה כללים מחכים לאישור: מועמד במצב 'candidate' עם כרטיס שאלה פתוח (lib/correction-rules.js, ומ-27.11 גם lib/behavior-rules.js). כשל מסד נזרק.
export async function loadPendingRules(sql) {
  const [row] = rowsOf(await sql`
    SELECT /* biweekly-rules */ count(DISTINCT c.id)::int AS n
    FROM candidate_rules c JOIN messages m ON m.entity_id = c.id
    WHERE c.status = 'candidate' AND m.kind = 'question' AND m.awaiting_reply = true AND m.entity_type IN (${CORRECTION_ENTITY}::text, ${BEHAVIOR_ENTITY}::text)
  `);
  const n = Number(row?.n);
  return Number.isInteger(n) && n > 0 ? n : 0;
}
