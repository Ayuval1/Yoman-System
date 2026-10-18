// חישוב שאלת שיעורי הבית (שלב 8.6-1; מפרט: docs/08-chapter8/60-chapter8-step-8-6-spec.md; חוקים: docs/02-rules/03-homework-rules.md ו-03-intake-rules.md,
// סעיפים "תזמון שאלת שיעורי הבית" ו"מקצועות פטורים"). פונקציות טהורות: בלי מסד, בלי רשת. מערכת השעות מגיעה כארגומנט ({ slots }, כמו lib/timetable.js).
//
//  1. רצפים: שיעורים של אותו מקצוע ביום אחד במספרי שיעור רצופים הם רצף אחד, שאלה אחת, 3 דקות אחרי סוף השיעור האחרון. הפסקה ארוכה אינה שוברת רצף.
//  2. פטורים: נקראים מ-data/homework-exempt.json (שדה בקובץ סטטי, לא בקוד).
//  3. תאריכים: "השיעור הבא של המקצוע" (כפתור יחיד, הכרעת יובל 16.10.2026) מחושב מתאריך הרצף (lesson_date), לא מרגע התשובה.
//     weekday במערכת השעות: 1 = ראשון, ולכן weekdayOf(iso) + 1 (lib/intake-dates.js), לא getDay.
// הנחה, לא אומת: ש-import של JSON עם `with { type: 'json' }` נארז בפריסה של Vercel (זה נבדק רק מקומית ב-Node 24). timetable.js מעתיק קבוע לקוד מאותה סיבה ("data/ אינו מובטח להיות בחבילת הפריסה").
import exemptConfig from '../data/homework-exempt.json' with { type: 'json' };
import { addDays, weekdayOf, parseIso } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

export const TIME_ZONE = 'Asia/Jerusalem';
// 3 דקות אחרי סוף הרצף (03-intake-rules.md "תזמון שאלת שיעורי הבית"; הערך נגזר ממבנה היום).
export const ASK_DELAY_MINUTES = 3;
// הנחה, לא אומת: כמה ימים קדימה מחפשים את השיעור הבא של המקצוע. 14 מכסה שבוע לימודים שלם עם סוף שבוע; מקצוע שאין לו מופע בשבועיים = אין כפתור.
export const NEXT_LESSON_SEARCH_DAYS = 14;
// שאלה פוקעת בסוף היום (שעון ישראל) של תאריך כפתור "השיעור הבא" (ראו expiresAtFor; מקור קודם: מפרט 60 סעיף 13 עם lesson_date + 7).
export const EXPIRY_DAYS_AFTER_LESSON = 7; // גיבוי בלבד, כשאין שיעור הבא במערכת השעות

// התאמת שם מקצוע לפטור: בלי גרש ומרכאות מכל סוג (חנ"ג / חנ״ג), בלי רווחים בקצוות.
const normalizeSubject = (text) => String(text ?? '').replace(/["'״׳”“]/g, '').trim();

// רשימת הפטורים מהקובץ. הנחה, לא אומת: אם השדה חסר או פגום הרשימה ריקה, וכל המקצועות נשאלים (נכשל פתוח); הבדיקות קוראות את הקובץ האמיתי.
export const EXEMPT_SUBJECTS = Object.freeze(Array.isArray(exemptConfig?.exempt_subjects) ? [...exemptConfig.exempt_subjects] : []);

export const isExempt = (subject, exempt = EXEMPT_SUBJECTS) => {
  const name = normalizeSubject(subject);
  return exempt.some((item) => normalizeSubject(item) === name);
};

const pad = (n) => String(n).padStart(2, '0');

// 'HH:MM' + דקות -> 'HH:MM' (בתוך אותו יום; לא עובר חצות במערכת השעות).
function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

const slotsOf = (timetable) => (Array.isArray(timetable?.slots) ? timetable.slots : []);

// כל הרצפים של יום שבוע אחד (1=ראשון) לפי מערכת השעות, בלי פטורים, ממוינים לפי שיעור ראשון.
// רצף: שיעורים עוקבים (period, period+1, ...) עם אותו מקצוע. מקצוע שחוזר בלי רצף (למשל שיעורים 2 ו-5) הוא שני רצפים.
export function sequencesOfWeekday(timetable, weekday) {
  const day = slotsOf(timetable).filter((slot) => slot.weekday === weekday).sort((a, b) => a.period - b.period);
  const sequences = [];
  for (const slot of day) {
    const last = sequences[sequences.length - 1];
    if (last && last.subject === slot.subject && last.endPeriod + 1 === slot.period) {
      last.endPeriod = slot.period;
      last.endsAt = slot.endsAt;
    } else {
      sequences.push({ subject: slot.subject, weekday, startPeriod: slot.period, endPeriod: slot.period, startsAt: slot.startsAt, endsAt: slot.endsAt });
    }
  }
  return sequences;
}

// מפתח הרצף: ASCII בלבד, בלי שם מקצוע (מפרט 60 סעיף 3). משמש גם idempotencyKey בתור.
export const slotKeyOf = (lessonDate, startPeriod) => `homework-${lessonDate}-${startPeriod}`;
const KEY = /^homework-(\d{4}-\d{2}-\d{2})-(\d{1,2})$/;
export function parseHomeworkKey(slotKey) {
  const match = KEY.exec(String(slotKey));
  if (!match) return null;
  try {
    parseIso(match[1]);
  } catch {
    return null;
  }
  return { lessonDate: match[1], startPeriod: Number(match[2]) };
}

// הרצפים שנשאלים בתאריך אחד (ISO), בלי הפטורים. כל פריט:
// { subject, lessonDate, weekday, startPeriod, endPeriod, startsAt, endsAt, endAt (Date, UTC), askAt (Date, UTC), askTimeLocal ('HH:MM'), slotKey }.
export function sequencesForDate(timetable, lessonDate, { exempt = EXEMPT_SUBJECTS } = {}) {
  const weekday = weekdayOf(lessonDate) + 1;
  return sequencesOfWeekday(timetable, weekday)
    .filter((sequence) => !isExempt(sequence.subject, exempt))
    .map((sequence) => {
      const endAt = zonedToUtc(lessonDate, sequence.endsAt, TIME_ZONE);
      const askTimeLocal = addMinutes(sequence.endsAt, ASK_DELAY_MINUTES);
      return {
        ...sequence,
        lessonDate,
        endAt,
        askAt: zonedToUtc(lessonDate, askTimeLocal, TIME_ZONE),
        askTimeLocal,
        slotKey: slotKeyOf(lessonDate, sequence.startPeriod),
      };
    });
}

// הרצף של מפתח (homework-YYYY-MM-DD-<שיעור ראשון>), או null אם המפתח לא תקין או אין רצף כזה (או שהמקצוע פטור). שם המקצוע והתאריך נגזרים מהטבלה ומהמפתח, לא מגוף ההודעה.
export function sequenceFromKey(timetable, slotKey, options) {
  const parsed = parseHomeworkKey(slotKey);
  if (!parsed) return null;
  return sequencesForDate(timetable, parsed.lessonDate, options).find((sequence) => sequence.startPeriod === parsed.startPeriod) ?? null;
}

// השיעור הבא של המקצוע אחרי lesson_date (לא כולל אותו): { date, startsAt, dueAt (Date, UTC) } או null. עובר סוף שבוע (ראשון עד חמישי בלבד יש שיעורים).
// התאמת מקצוע: שם מדויק (אחרי נרמול גרשיים), לא התאמה מטושטשת. due_at = תחילת השיעור הראשון ברצף הראשון של המקצוע באותו יום, בשעון ישראל.
export function nextLesson(timetable, subject, lessonDate) {
  const name = normalizeSubject(subject);
  for (let offset = 1; offset <= NEXT_LESSON_SEARCH_DAYS; offset += 1) {
    const date = addDays(lessonDate, offset);
    const sequence = sequencesOfWeekday(timetable, weekdayOf(date) + 1).find((item) => normalizeSubject(item.subject) === name);
    if (sequence) return { date, startsAt: sequence.startsAt, dueAt: zonedToUtc(date, sequence.startsAt, TIME_ZONE) };
  }
  return null;
}

// כפתורי התאריך של כרטיס השאלה: כפתור יחיד "next" (הכרעת יובל 16.10.2026). כפתור שתאריכו לפני today (YYYY-MM-DD) לא מוצג. מחזיר [] אם אין.
export function homeworkButtons({ timetable, subject, lessonDate, today }) {
  const next = nextLesson(timetable, subject, lessonDate);
  if (!next || (today && next.date < today)) return [];
  return [{ due: 'next', date: next.date }];
}

// מתי השאלה פוקעת: תחילת היום שאחרי lesson_date + 7 בשעון ישראל (= סוף היום של lesson_date + 7). הערך נשמר ב-messages.expires_at; הסינון הוא expires_at > now.
// עדכון אחרי ביקורת: כשיש כפתור "next" יחיד, השאלה פוקעת בתחילת היום שאחרי תאריך הכפתור (שעון ישראל, DST-safe דרך zonedToUtc), ומחושבת ביצירה.
// הנחה, לא אומת: בלי מערכת שעות, או כשאין שיעור הבא למקצוע, נופלים לגיבוי lesson_date + 7 (סוף היום).
export function expiresAtFor(lessonDate, { timetable, subject } = {}) {
  const next = timetable && subject ? nextLesson(timetable, subject, lessonDate) : null;
  const lastDate = next ? next.date : addDays(lessonDate, EXPIRY_DAYS_AFTER_LESSON);
  return zonedToUtc(addDays(lastDate, 1), '00:00', TIME_ZONE);
}
