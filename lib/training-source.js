// מקור האימונים של "מחר" בהודעת הסגירה (שלב C-3, docs/08-chapter8/90 E3 המעודכן, בקשת יובל 29.10.2026: "אימון אם יש").
// בלוק 5 חלק א': המקור הוא אימוני 4fitness שנרשמו מהלוז (lib/intake-process.js, lib/fitness-schedule.js): שורות events בתחום running,
// מתוכננות, שהכותרת שלהן מתחילה ב"אימון ריצה" (FITNESS_TITLE_PREFIX), באותו תאריך ישראלי. אירועי "התארגנות" אינם אימון ונשארים ברשימת האירועים.
// Garmin עוד לא מחובר (פרק 9): אורך הריצה ותוכן האימון לא נכנסים כאן.
// החוזה: loadTrainingsForDate(dateIso, { sql }) -> מערך של { title: טקסט, startsAt: ISO או null (בלי שעה) } של אותו תאריך ישראלי, ממוין לפי שעה.
// בלי sql (הקריאה הישנה, loadTrainingsForDate(dateIso)): [] ולא ממציאים כלום. כשל מסד נזרק; הצרכן (api/queues/deliver.js, loadPart) מחליט.
// פרטיות: כותרת ושעה בלבד, כמו אירועים. מי שמחבר מקור לא מחזיר שדות נוספים.
// מחבר: נקרא מ-api/queues/deliver.js (deliverClose) עם { sql }, ומוזרק לבדיקות דרך loadTrainings.
// כדי שאימון לא יופיע פעמיים בסגירה, lib/closing-tomorrow.js (loadTomorrowEvents) לא מחזיר את אותן שורות ברשימת האירועים.
import { dayRange } from './closing-tomorrow.js';

export async function loadTrainingsForDate(dateIso, { sql } = {}) {
  if (typeof sql !== 'function') return [];
  const { from, to } = dayRange(dateIso);
  const rows = await sql`
    SELECT title, starts_at
    FROM events
    WHERE domain = 'running' AND status = 'planned' AND title LIKE 'אימון ריצה%'
      AND starts_at >= ${from.toISOString()}::timestamptz AND starts_at < ${to.toISOString()}::timestamptz
    ORDER BY starts_at ASC
  `;
  const list = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const ms = row?.starts_at ? new Date(row.starts_at).getTime() : NaN;
    list.push({ title: typeof row?.title === 'string' ? row.title : '', startsAt: Number.isNaN(ms) ? null : new Date(ms).toISOString() });
  }
  return list;
}
