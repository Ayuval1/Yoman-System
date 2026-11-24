// "הגיע לוז 4fitness? אם לא, תזכורת" (docs/01-foundation/אפיון-מורחב.md, סעיף 4, ורקפלואוז: "מוצאי שבת או ראשון", היה "לא").
// שורה בבריף של 07:30 בימי ראשון ושני, כשלא נקלט לוז מאז יום חמישי (planFitnessWeek: לוז שמגיע מחמישי ואילך הוא של שני-רביעי הקרובים).
// [הנחה, לא אומת] ראשון ושני: הבריף הוא המסר הקבוע הקרוב למוצאי שבת (03-app-channel-rules.md), ושני הוא היום האחרון לפני האימון.
// "לוז נקלט" = עובדת type = 'fitness_schedule' על מקור (lib/intake-process.js tryFitnessSchedule), או מקור מאז חמישי עם שורה שמתחילה בשני או ברביעי.
// השני: לוז מבולגן (שתי שעות, יום בלי שעה) עובר למוח ולא מקבל את העובדה, ובלעדיו הייתה תזכורת שווא. ייתכן גם הפוך (הודעה אחרת שמתחילה ב"שני"): אז אין תזכורת.
// קריאה בלבד. לא זורק: כשל = בלי השורה.
import { addDays, weekdayOf } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

export const FITNESS_REMINDER_LINE = 'לוז 4fitness לשבוע הזה עוד לא הגיע. כשיגיע, להעביר אותו בקיצור.';
const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;
const FITNESS_TYPE = 'fitness_schedule';
// שורה שמתחילה ב"שני" / "רביעי" (עם "יום", "ב", או "יום ב'/ד'"), כמו ANY_DAY_AT_START ב-lib/fitness-schedule.js. ביטוי Postgres (POSIX).
export const SCHEDULE_LINE = "(^|\n)[[:space:]]*(ב?יום[[:space:]]+)?ב?((שני|רביעי)([^א-ת]|$)|[בד]['׳])"; // lib/intake-process.js FITNESS_TYPE (לא מיובא: מונע תלות מעגלית)

// יום חמישי האחרון לפני dateIso (או null כשאין צורך בתזכורת היום).
export function reminderSince(dateIso) {
  const weekday = weekdayOf(dateIso);
  if (weekday !== SUNDAY && weekday !== MONDAY) return null;
  return addDays(dateIso, -((weekday - THURSDAY + 7) % 7));
}

export async function fitnessReminderLine(sql, dateIso) {
  try {
    const since = reminderSince(dateIso);
    if (!since) return null;
    const from = zonedToUtc(since, '00:00', 'Asia/Jerusalem').toISOString();
    const rows = await sql`
      SELECT /* fitness-reminder */ 1 AS found FROM sources s
      WHERE s.received_at >= ${from}::timestamptz
        AND (EXISTS (SELECT 1 FROM facts f WHERE f.source_id = s.id AND f.field = 'type' AND f.value = ${FITNESS_TYPE}::text)
          OR (s.channel IN ('shortcut', 'app') AND s.raw_content ~ ${SCHEDULE_LINE}::text))
      LIMIT 1
    `;
    const list = Array.isArray(rows) ? rows : rows?.rows ?? [];
    return list.length > 0 ? null : FITNESS_REMINDER_LINE;
  } catch (error) {
    console.error('fitness-reminder: הבדיקה נכשלה:', error?.name);
    return null;
  }
}
