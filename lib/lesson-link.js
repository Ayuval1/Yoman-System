// חוט מחבר תמונה <- שיעור (בלוק 8, "תביא לי"; docs/01-foundation/06-db-schema.md:257, 02-build-plan.md:498): באיזה שיעור צולמה תמונה,
// לפי שעת ההעלאה (media.received_at), מערכת השעות וקובץ החופשות. קוד בלבד, בלי מסד ובלי מודל, חוץ מ-backfillLessonLinks.
// העמודות media.lesson_date ו-media.lesson_period (NULL כשהתמונה מחוץ לכל שיעור): ALTER TABLE ... ADD COLUMN IF NOT EXISTS, הורצה במסד החי ב-23.11.2026.
import { localDateIso } from './intake-dates.js';
import { lessonsOnDate, vacationOn, VACATIONS } from './school-calendar.js';

// הנחה, לא אומת: תמונה שצולמה עד 10 דקות אחרי שהשיעור נגמר (בהפסקה, כשיובל מצלם את הלוח לפני שהמורה מוחק) שייכת לשיעור שנגמר.
// ההפסקה הארוכה ביותר במבנה היום היא 15 דקות (data/school-day-structure.md); 10 משאיר את סוף ההפסקה לשיעור הבא. לא נמדד על תמונות אמיתיות.
export const GRACE_MINUTES = 10;

const TIMEZONE = 'Asia/Jerusalem';
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// דקות מחצות בשעון ישראל, או null לחותמת לא תקינה.
function localMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  return Number.isInteger(hour) && Number.isInteger(minute) ? hour * 60 + minute : null;
}

// השיעור שבו צולמה התמונה: { date, period, subject } או null (מחוץ לשיעור, יום בלי לימודים, חופשה, מערכת שעות חסרה, חותמת לא תקינה). לעולם לא זורק.
// בתוך שיעור: [התחלה, סיום). אחרי שיעור שנגמר: עד graceMinutes, והשיעור הבא (אם התחיל) גובר.
export function lessonAt(receivedAt, timetable, { vacations = VACATIONS, graceMinutes = GRACE_MINUTES } = {}) {
  if (receivedAt === null || receivedAt === undefined || receivedAt === '') return null;
  const instant = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(instant.getTime())) return null;
  const minutes = localMinutes(instant);
  if (minutes === null) return null;
  let date;
  try {
    date = localDateIso(instant, TIMEZONE);
  } catch {
    return null;
  }
  if (vacationOn(date, vacations) !== null) return null;
  const slots = lessonsOnDate(date, timetable);
  const inside = slots.find((slot) => minutes >= toMinutes(slot.startsAt) && minutes < toMinutes(slot.endsAt));
  if (inside) return { date, period: inside.period, subject: inside.subject };
  const justEnded = slots
    .filter((slot) => minutes >= toMinutes(slot.endsAt) && minutes <= toMinutes(slot.endsAt) + graceMinutes)
    .sort((a, b) => toMinutes(b.endsAt) - toMinutes(a.endsAt))[0];
  return justEnded ? { date, period: justEnded.period, subject: justEnded.subject } : null;
}

// שורות media ({ id, received_at, subject }) -> עדכונים { id, lesson_date, lesson_period, subject }. subject מלא רק כשהמקצוע בשורה ריק (לא דורסים). תמונה מחוץ לשיעור לא נכללת.
export function planLessonBackfill(rows, timetable, options) {
  const updates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const lesson = lessonAt(row?.received_at, timetable, options);
    if (!lesson) continue;
    const hasSubject = typeof row.subject === 'string' && row.subject.trim() !== '';
    updates.push({ id: row.id, lesson_date: lesson.date, lesson_period: lesson.period, subject: hasSubject ? null : lesson.subject });
  }
  return updates;
}

export const BACKFILL_BATCH = 500;

// תחזוקה חד-פעמית לתמונות שכבר קיימות: ממלא קישור רק היכן ש-lesson_date עדיין ריק (הרצה חוזרת בטוחה), ולא דורס מקצוע קיים.
// מחוברת ל-api/ops.js כמשימה lesson-backfill (lib/ops/lesson-backfill.js, 24.11.2026). apply=false: רק סופר, בלי UPDATE. כשל מסד זורק (הקורא מחליט).
// before (ISO, אופציונלי): סמן לעימוד. רק תמונות שהתקבלו לפניו. nextBefore = received_at של הישנה בקבוצה (להרצה הבאה), או null כשהקבוצה לא מלאה.
export async function backfillLessonLinks({ sql, timetable, options, apply = true, before = null }) {
  if (!timetable) return { scanned: 0, linked: 0, nextBefore: null };
  const rows = await sql`
    SELECT id, received_at, subject FROM media
    WHERE lesson_date IS NULL AND received_at IS NOT NULL AND status = 'stored'
      AND (${before}::timestamptz IS NULL OR received_at < ${before}::timestamptz)
    ORDER BY received_at DESC
    LIMIT ${BACKFILL_BATCH}::int
  `;
  const list = Array.isArray(rows) ? rows : [];
  const last = list.at(-1)?.received_at;
  const nextBefore = list.length >= BACKFILL_BATCH && last ? new Date(last).toISOString() : null;
  const updates = planLessonBackfill(list, timetable, options);
  if (!apply) return { scanned: list.length, linked: 0, wouldLink: updates.length, nextBefore };
  for (const u of updates) {
    await sql`
      UPDATE media SET lesson_date = ${u.lesson_date}::date, lesson_period = ${u.lesson_period}::int, subject = COALESCE(subject, ${u.subject}::text)
      WHERE id = ${u.id}::uuid AND lesson_date IS NULL
    `;
  }
  return { scanned: list.length, linked: updates.length, nextBefore };
}
