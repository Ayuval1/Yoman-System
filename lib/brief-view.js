// תוכן הודעת הבוקר (שלב B-1, docs/08-chapter8/68-chapter8-brief-prd.md: D1-D5, D8, D15, D16, D17 ותבנית ההודעה בסעיף 6). פונקציה טהורה: בלי מסד, בלי רשת, בלי שעון (התאריך מגיע מבחוץ).
// הטקסט, ליום לימודים:
//   בריף · יום שני 26.10
//   08:15–15:45 · 9 שיעורים
//   היום: מבחן במתמטיקה ב-10:05
//   משימות פתוחות (3):
//   · שיעורי בית · אנגלית — עד חמישי 29.10
//   · שיעורי בית · היסטוריה — באיחור (היה עד ראשון 25.10)
//   · דף תרגילים — בלי תאריך
//   שאלות שממתינות: שיעורי בית בפיזיקה · ועוד שאלה אחת
//   לפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.
// פרטיות (D17): שאלת שיעורי בית בשם המקצוע בלבד; כל שאלה אחרת רק כמספר, בלי טקסט הודעה. אין שמות מורים או טלפונים (לא נקראים כאן בכלל).
// מערכת שעות חסרה (null): בלי שורת בית ספר, ובלי נוסח "יום פנוי" (אי אפשר לטעון שאין בית ספר).
import { sha256Hex } from './timetable.js';
import { WEEKDAY_NAMES, formatDayMonth, localDateIso, weekdayOf } from './intake-dates.js';
import { examsToday } from './exam-line.js';
import { isSchoolDay, lessonsOnDate, VACATIONS } from './school-calendar.js';

export const BRIEF_FOOTER = 'לפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.';
export const FREE_DAY_LINE = 'יום פנוי: אין בית ספר ואין משימות פתוחות';
const TIME_ZONE = 'Asia/Jerusalem';
const DASH = '–'; // מקף בין שעות, כמו בתבנית

const dayLabel = (dateIso) => `${WEEKDAY_NAMES[weekdayOf(dateIso)]} ${formatDayMonth(dateIso)}`;

// שורת בית הספר: { startsAt, endsAt, lessons, text } או null. כל השיעורים נספרים, גם פטורים (D2).
export function schoolSummary(dateIso, timetable, vacations = VACATIONS) {
  if (!isSchoolDay(dateIso, timetable, vacations)) return null;
  const lessons = lessonsOnDate(dateIso, timetable);
  const periods = new Set(lessons.map((lesson) => lesson.period));
  const startsAt = lessons.map((lesson) => lesson.startsAt).sort()[0];
  const endsAt = lessons.map((lesson) => lesson.endsAt).sort().at(-1);
  const count = periods.size;
  const countText = count === 1 ? 'שיעור אחד' : `${count} שיעורים`;
  return { startsAt, endsAt, lessons: count, text: `${startsAt}${DASH}${endsAt} · ${countText}` };
}

// משימה -> שורה. due_at (ISO) מומר לתאריך הישראלי; מוקדם מהיום = באיחור (D16, מחושב ולא נשמר); משימה שמועדה היום עוד לא באיחור.
function taskLine(task, todayIso) {
  const title = typeof task.title === 'string' && task.title.trim() !== '' ? task.title.trim() : 'משימה';
  const dueMs = task.due_at ? Date.parse(task.due_at) : NaN;
  if (Number.isNaN(dueMs)) return `· ${title} — בלי תאריך`;
  const dueIso = localDateIso(new Date(dueMs), TIME_ZONE);
  return dueIso < todayIso ? `· ${title} — באיחור (היה עד ${dayLabel(dueIso)})` : `· ${title} — עד ${dayLabel(dueIso)}`;
}

// סדר: due_at עולה (הקרוב ראשון), בלי תאריך בסוף; שוויון נשאר בסדר הקלט (המיון יציב).
function sortedTasks(tasks) {
  const key = (task) => { const ms = task.due_at ? Date.parse(task.due_at) : NaN; return Number.isNaN(ms) ? Infinity : ms; };
  return [...tasks].sort((a, b) => { const ka = key(a); const kb = key(b); return ka === kb ? 0 : ka < kb ? -1 : 1; });
}

// "שאלות שממתינות": שאלת שיעורי בית בשם המקצוע, כל אחת בשמה; כל השאר רק כמספר. null כשאין שאלות.
function pendingLine(pending) {
  const list = Array.isArray(pending) ? pending : [];
  const homework = list.filter((item) => item?.kind === 'homework' && typeof item.subject === 'string' && item.subject.trim() !== '');
  const others = list.length - homework.length;
  if (list.length === 0) return null;
  const parts = homework.map((item) => `שיעורי בית ב${item.subject.trim()}`);
  if (others > 0) {
    const base = others === 1 ? 'שאלה אחת' : `${others} שאלות`;
    parts.push(homework.length > 0 ? `ועוד ${base}` : base);
  }
  return `שאלות שממתינות: ${parts.join(' · ')}`;
}

// מרכיב את הודעת הבוקר. dateIso: תאריך המשבצת (YYYY-MM-DD). tasks: מ-loadOpenTasks. pending: מ-loadPending. timetable: { slots } או null.
// partial=true: חלק מהנתונים (משימות או שאלות) לא נטענו; אסור להציג "יום פנוי", כי אי אפשר לטעון שאין משימות או שאלות.
// מחזיר { text, school (מ-schoolSummary או null), schoolDay, tasks (מספר), exams (מערך של examsToday) }, כדי ש-B-2 ישתמש באותם מספרים בהתראה.
export function composeBrief({ dateIso, timetable = null, tasks = [], pending = [], vacations = VACATIONS, exams, partial = false } = {}) {
  const taskList = sortedTasks(Array.isArray(tasks) ? tasks : []);
  const school = schoolSummary(dateIso, timetable, vacations);
  const examList = examsToday(dateIso, { timetable, ...(exams ? { exams } : {}) });
  const questions = pendingLine(pending);

  const lines = [`בריף · יום ${dayLabel(dateIso)}`];
  if (school) lines.push(school.text);
  else if (!partial && timetable && taskList.length === 0 && !questions && examList.length === 0) lines.push(FREE_DAY_LINE);
  for (const exam of examList) lines.push(`היום: ${exam.text}`);
  if (taskList.length > 0) {
    lines.push(`משימות פתוחות (${taskList.length}):`);
    for (const task of taskList) lines.push(taskLine(task, dateIso));
  }
  if (questions) lines.push(questions);
  lines.push(BRIEF_FOOTER);
  return { text: lines.join('\n'), school, schoolDay: school !== null, tasks: taskList.length, exams: examList };
}

export const BRIEF_PUSH_WAITING = 'הבריף של היום מחכה';

// נוסח התראת הבוקר (B-2, 68 D6; ההכרעה של יובל ב-B-2: ההתראה נשלחת כל יום, גם בשבת ובחופשה). פונקציה טהורה, מספרים ותוויות בלבד:
// אף פעם לא כותרת משימה, טקסט הודעה, שם מורה או טלפון. brief = התוצאה של composeBrief (אותם נתונים כמו ההודעה). timetable: { slots } או null.
// partial=true: המשימות לא נטענו, ולכן אין ספירת משימות ואין טענת "יום פנוי".
//  - מערכת שעות חסרה: "הבריף של היום מחכה".
//  - יום לימודים: [שורת מבחן · ] שורת בית הספר [· N משימות פתוחות].
//  - יום בלי בית ספר: [שורת מבחן · ] "יום פנוי · N משימות פתוחות"; בלי משימות ובלי מבחן: נוסח "יום פנוי" של D8.
// הנחה, לא אומת: מערכת שעות חסרה גוברת גם על מבחן להיום (בלי מערכת שעות אין שעה ואין ידיעה אם זה יום לימודים).
export function briefPushText({ brief, timetable = null, partial = false } = {}) {
  if (!timetable || !brief) return BRIEF_PUSH_WAITING;
  const taskCount = partial ? 0 : brief.tasks;
  const taskText = taskCount === 1 ? 'משימה אחת פתוחה' : taskCount > 1 ? `${taskCount} משימות פתוחות` : null;
  const examParts = (Array.isArray(brief.exams) ? brief.exams : []).map((exam) => exam.text);
  const parts = [...examParts];
  if (brief.school) {
    parts.push(brief.school.text);
    if (taskText) parts.push(taskText);
  } else if (taskText) {
    parts.push('יום פנוי', taskText);
  } else if (examParts.length === 0) {
    if (partial) return BRIEF_PUSH_WAITING;
    parts.push(FREE_DAY_LINE);
  }
  return parts.join(' · ');
}

// מזהה דטרמיניסטי בפורמט uuid למפתח משבצת (D10 א): sha256 של המפתח, עם ביטי גרסה (5) וווריאנט תקינים. אותו מפתח = אותו מזהה, ולכן ההכנסה ל-messages אידמפוטנטית בלי שינוי סכמה.
export function briefEntityId(slotKey) {
  const hex = sha256Hex(String(slotKey));
  const variant = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
