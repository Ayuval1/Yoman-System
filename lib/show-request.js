// בקשת תצוגה בצ'אט (בלוק 9; docs/02-rules/03-design-rules.md:331: "תראה לי את השבוע / המבחנים" -> כרטיס דרגה 2 עם הלוח;
// "תראה" מסווג כקריאה, 03-intake-rules.md כלל 5). קוד בלבד, לפני המוח, רק הודעה מוקלדת. קריאה בלבד: אין כתיבה ליומן.
// התשובה היא בועת טקסט (הדף מציג בועות טקסט; כרטיס עשיר ייבנה כשיוגדר. הנחה, לא אומת).
//  - "השבוע": 7 ימים מהיום (lib/calendar-view.js loadCalendar). לכל יום: בית ספר עד <שעה>, מבחנים, אימונים ואירועים. בלי שיעור-שיעור (ארוך מדי).
//  - "המבחנים": המבחנים של 30 הימים הקרובים (הנחה, לא אומת: 30), מהלוח אחרי שינויים (applyExamChanges).
import { loadCalendar } from './calendar-view.js';
import { addDays, localDateIso, weekdayOf, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts } from './schedule-time.js';

const TIME_ZONE = 'Asia/Jerusalem';
export const EXAMS_DAYS = 30;
const rowsOf = (r) => (Array.isArray(r) ? r : []);
const pad = (n) => String(n).padStart(2, '0');
const hm = (iso) => { const p = localParts(new Date(iso), TIME_ZONE); return `${pad(p.hour)}:${pad(p.minute)}`; };
const dayLabel = (date, today) => (date === today ? 'היום' : date === addDays(today, 1) ? 'מחר' : `${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDayMonth(date)}`);

// 'week' | 'exams' | null. מעוגן לתחילת ההודעה.
export function detectShowRequest(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim().replace(/[?!.]+$/, '');
  const m = /^(?:תראה|תראי|הראה|תציג)\s+(?:לי\s+)?(?:את\s+)?(השבוע|המבחנים|הלוח של השבוע|מבחנים)$/.exec(t);
  if (!m) return null;
  return m[1].includes('מבחנים') ? 'exams' : 'week';
}

export function weekText(days, today) {
  const lines = ['השבוע:'];
  for (const day of days) {
    const parts = [];
    const lessons = day.items.filter((i) => i.kind === 'lesson' && i.end);
    if (lessons.length > 0) parts.push(`בית ספר עד ${hm(lessons.map((i) => i.end).sort().at(-1))}`);
    else if (day.noSchool) parts.push('אין בית ספר');
    for (const item of day.items) {
      if (item.kind === 'exam' && !item.makeup) parts.push(item.title);
      else if (item.kind === 'training' || item.kind === 'event') parts.push(`${item.start ? `${hm(item.start)} ` : ''}${item.title ?? ''}`.trim());
    }
    lines.push(`· ${dayLabel(day.date, today)}: ${parts.length > 0 ? parts.join(' · ') : 'פנוי'}`);
  }
  return lines.join('\n');
}

export function examsText(days, today) {
  const exams = days.flatMap((day) => day.items.filter((i) => i.kind === 'exam' && !i.makeup).map((i) => ({ date: day.date, title: i.title })));
  if (exams.length === 0) return `אין מבחנים ב-${EXAMS_DAYS} הימים הקרובים.`;
  return ['המבחנים הקרובים:', ...exams.map((e) => `· ${dayLabel(e.date, today)}: ${e.title}`)].join('\n');
}

// { status: 'recorded' | 'skipped', reply }. כשל מסד נזרק (הצינור מטפל).
export async function answerShowRequest({ sql, source, kind, timetable, now = new Date() }) {
  const today = localDateIso(now, TIME_ZONE);
  let text;
  if (kind === 'week') {
    const cal = await loadCalendar({ sql, timetable, from: today, days: 7, now });
    text = weekText(cal.days, today);
  } else {
    const days = [];
    for (let offset = 0; offset < EXAMS_DAYS; offset += 30) {
      const cal = await loadCalendar({ sql, timetable, from: addDays(today, offset), days: Math.min(30, EXAMS_DAYS - offset), now });
      days.push(...cal.days);
    }
    text = examsText(days, today);
  }
  const rows = rowsOf(await sql`
    /* show-request */ WITH claim AS (
      UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${text}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed
  `);
  if (rows.length > 0 && Number(rows[0].claimed) === 0) return { status: 'skipped', reply: 'התקבל' };
  return { status: 'recorded', reply: text };
}
