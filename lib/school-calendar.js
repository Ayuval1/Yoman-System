// יום לימודים (שלב B-1, docs/08-chapter8/68, הנחה H1, אושרה ע"י יובל ב-20.10.2026): יש שיעורים באותו יום בשבוע במערכת השעות, וגם התאריך אינו בטווח חופשה בקובץ החופשות.
// פונקציות טהורות: בלי מסד, בלי רשת. התאריך הוא YYYY-MM-DD (תאריך לוח ישראלי); מערכת השעות היא { slots } כמו ב-lib/timetable.js (weekday 1 = ראשון).
// שבת, ושישי בלי שיעורים, אינם יום לימודים כי אין להם שיעורים במערכת. מערכת שעות חסרה (null) = לא ידוע: isSchoolDay מחזיר false, ו-lessonsOnDate מחזיר [].
// הנחה, לא אומת: קובץ ה-JSON נארז בפריסה (אותו מנגנון כמו data/homework-exempt.json ב-lib/homework-schedule.js, שנטען בתור כבר היום).
import vacationsFile from '../data/school-vacations.json' with { type: 'json' };
import { weekdayOf } from './intake-dates.js';

export const VACATIONS = Object.freeze(Array.isArray(vacationsFile?.vacations) ? vacationsFile.vacations : []);

// החופשה שהתאריך נופל בה (כולל שני הקצוות), או null. endOfYear: מהתאריך והלאה.
export function vacationOn(dateIso, vacations = VACATIONS) {
  for (const vacation of vacations) {
    if (vacation.endOfYear === true ? dateIso >= vacation.from : dateIso >= vacation.from && dateIso <= vacation.to) return vacation;
  }
  return null;
}

// השיעורים של התאריך לפי יום בשבוע במערכת השעות, בלי קשר לחופשה. weekdayOf: 0 = ראשון, ולכן +1.
export function lessonsOnDate(dateIso, timetable) {
  const slots = Array.isArray(timetable?.slots) ? timetable.slots : [];
  const weekday = weekdayOf(dateIso) + 1;
  return slots.filter((slot) => slot.weekday === weekday);
}

export function isSchoolDay(dateIso, timetable, vacations = VACATIONS) {
  return lessonsOnDate(dateIso, timetable).length > 0 && vacationOn(dateIso, vacations) === null;
}
