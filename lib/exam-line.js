// מבחן להיום ומבחן למחר (שלב B-1, docs/08-chapter8/68, D13-D15, H14). משמש את הבריף של הבוקר (היום) ובהמשך את סיכום 21:00 (מחר, B-3).
// פונקציות טהורות: בלי מסד, בלי רשת. המקור: data/school-exams.json (נגזר מ-data/school-exams-taf-shin-pe-zayin.md).
//  - שורות "מועד ב'" (makeup=true) נשמרות בקובץ ואינן מוצגות (D14).
//  - עמ"ט תמיד של יובל: שורות owner=amat מוצגות כמו כל שורה.
//  - הסוג כפי שכתוב בקובץ (מבחן / מבדק / אנסין).
//  - "מדעים" בלי פירוט: "<סוג> במדעים" בלי שעה. השאלה "איזה מקצוע" ב-lib/exam-ask.js (B-3ב); התשובה (פיזיקה / כימיה) מגיעה לכאן באופציה answers.
//  - שעה (H14, הנחה, לא אומת): תחילת שיעור של אותו מקצוע באותו יום לפי מערכת השעות. התאמה: זהה, "(תרגול)", או מקצוע-בן (slotMatchesSubject ב-lib/intake-facts.js, כולל SUBJECT_CHILDREN).
//    בהתאמות מרובות: ההתחלה המוקדמת. אין התאמה, או אין מערכת שעות: בלי שעה.
import examsFile from '../data/school-exams.json' with { type: 'json' };
import { slotMatchesSubject } from './intake-facts.js';
import { addDays, weekdayOf, localDateIso } from './intake-dates.js';
import { localParts } from './schedule-time.js';

export const EXAMS = Object.freeze(Array.isArray(examsFile?.exams) ? examsFile.exams : []);
export const UNSPECIFIED_SUBJECT = 'מדעים'; // בלי פירוט פיזיקה/כימיה: אין שעה
// B-3ב (68 H13): התשובות שהופכות "מדעים" למקצוע ממשי. "אחר" אינו ברשימה: נשאר "מדעים" בלי שעה.
export const SCIENCE_SUBJECTS = Object.freeze(['פיזיקה', 'כימיה']);

// השעה (HH:MM) של מבחן במקצוע subject בתאריך dateIso, או null.
export function examTime({ dateIso, subject, timetable }) {
  if (!subject || subject === UNSPECIFIED_SUBJECT) return null;
  const slots = Array.isArray(timetable?.slots) ? timetable.slots : [];
  const weekday = weekdayOf(dateIso) + 1;
  const starts = slots.filter((slot) => slot.weekday === weekday && slotMatchesSubject(slot.subject, subject)).map((slot) => slot.startsAt).sort();
  return starts[0] ?? null;
}

// בלוק 4 (lib/event-match.js): מבחן שהודעה נקשרה אליו (עובדת match = 'exam:<תאריך>:<מקצוע>') ונדחה או בוטל. הלוח (קובץ שרק יובל משנה) לא משתנה;
// השינויים מונחים עליו בזמן קריאה. changes: [{ link, type: 'move' | 'cancel', newDate (YYYY-MM-DD או null) }] בסדר הקליטה; האחרון לכל מבחן גובר.
//  - cancel: המבחן לא מוצג. move עם מועד חדש: מוצג במועד החדש (answerDate נשאר המקורי, לתשובת "מדעים"). move בלי מועד: במועד הישן, עם postponed.
// מחזיר רשימה חדשה; exams לא משתנה.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export function applyExamChanges(exams = EXAMS, changes = []) {
  const last = new Map();
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change && typeof change.link === 'string' && (change.type === 'move' || change.type === 'cancel')) last.set(change.link, change);
  }
  if (last.size === 0) return exams;
  const out = [];
  for (const exam of exams) {
    const change = last.get(`exam:${exam?.date}:${exam?.subject}`);
    if (!change || exam.makeup === true) out.push(exam);
    else if (change.type === 'cancel') continue;
    else if (typeof change.newDate === 'string' && ISO_DATE.test(change.newDate)) out.push({ ...exam, date: change.newDate, answerDate: exam.date });
    else out.push({ ...exam, postponed: true });
  }
  return out;
}

// כל המבחנים המוצגים בתאריך: [{ date, type, subject, time (HH:MM או null), text }]. text = "<סוג> ב<מקצוע>" ואחריו " ב-<שעה>" כשידועה.
// answers (B-3ב, 68 H13): Map תאריך -> 'פיזיקה' | 'כימיה' (loadAnswers ב-lib/exam-ask.js). מבחן 'מדעים' שיש תשובה לתאריכו מקבל את שם המקצוע לפני חישוב השעה והטקסט. בלי תשובה (או 'אחר'): נשאר 'מדעים' בלי שעה.
export function examsOnDate(dateIso, { timetable = null, exams = EXAMS, answers = new Map() } = {}) {
  return exams
    .filter((exam) => exam.date === dateIso && exam.makeup !== true && typeof exam.subject === 'string' && exam.subject !== '')
    .map((exam) => {
      const answer = answers.get(exam.answerDate ?? exam.date);
      const subject = exam.subject === UNSPECIFIED_SUBJECT && SCIENCE_SUBJECTS.includes(answer) ? answer : exam.subject;
      // בלוק 4: נדחה בלי מועד חדש = שורת "נדחה" במקום שורת המבחן, בלי שעה.
      if (exam.postponed === true) return { date: exam.date, type: exam.type, subject, time: null, postponed: true, text: `${exam.type} ב${subject} נדחה, מועד חדש לא ידוע` };
      const time = examTime({ dateIso, subject, timetable });
      return { date: exam.date, type: exam.type, subject, time, text: `${exam.type} ב${subject}${time ? ` ב-${time}` : ''}` };
    });
}

export const examsToday = (todayIso, options) => examsOnDate(todayIso, options);
export const examsTomorrow = (todayIso, options) => examsOnDate(addDays(todayIso, 1), options);

// שורת המבחן של סיכום 21:00 (שלב B-3, PRD 68 D11, D12): "מחר: <סוג> ב<מקצוע>[ ב-HH:MM]", או null.
// חלון התצוגה: משעה 21:00 עד 06:00 שעון ישראל בלבד; מחוץ לחלון null. אין תקרת תאריך (REVIEW_LAST_BOUNDARY של M.2 לא חל כאן).
// תאריך המבחן: משעה 21:00 עד חצות = התאריך הישראלי של now ועוד יום; מחצות עד 06:00 = התאריך הישראלי של now, כך שב-01:00 אחרי חצות עדיין מוצג מבחן אותו יום (D11).
// לפי שעה מקומית ולא לפי החסרת 6 שעות אמיתיות: בבוקר החזרת השעון יש 7 שעות אמיתיות בין 00:00 ל-05:59 והחסרה נתנה יום מוקדם מדי.
// כמה מבחנים באותו יום: מחוברים ב-" · " [הצעה, לא אומת]. "מועד ב'" מסונן ו"מדעים" בלי שעה (examsOnDate).
const REVIEW_WINDOW_START_HOUR = 21;
const REVIEW_WINDOW_END_HOUR = 6;
export function examLineAt(now, { timetable = null, exams = EXAMS, answers = new Map() } = {}) {
  const parts = localParts(now, 'Asia/Jerusalem');
  if (parts.hour >= REVIEW_WINDOW_END_HOUR && parts.hour < REVIEW_WINDOW_START_HOUR) return null;
  const localToday = localDateIso(now, 'Asia/Jerusalem');
  const examDate = parts.hour < REVIEW_WINDOW_END_HOUR ? localToday : addDays(localToday, 1);
  const found = examsOnDate(examDate, { timetable, exams, answers });
  if (found.length === 0) return null;
  return `מחר: ${found.map((exam) => exam.text).join(' · ')}`;
}
