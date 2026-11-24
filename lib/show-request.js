// בקשת תצוגה בצ'אט (בלוק 9; docs/02-rules/03-design-rules.md:331: "תראה לי את השבוע / המבחנים" -> כרטיס דרגה 2 עם הלוח;
// "תראה" מסווג כקריאה, 03-intake-rules.md כלל 5). קוד בלבד, לפני המוח, רק הודעה מוקלדת. קריאה בלבד: אין כתיבה ליומן.
// התשובה היא בועת טקסט (הדף מציג בועות טקסט; כרטיס עשיר ייבנה כשיוגדר. הנחה, לא אומת).
//  - "השבוע": 7 ימים מהיום (lib/calendar-view.js loadCalendar). לכל יום: בית ספר עד <שעה>, מבחנים, אימונים ואירועים. בלי שיעור-שיעור (ארוך מדי).
//  - "המבחנים": המבחנים של 30 הימים הקרובים (הנחה, לא אומת: 30), מהלוח אחרי שינויים (applyExamChanges).
import { loadCalendar } from './calendar-view.js';
import { addDays, localDateIso, weekdayOf, formatDayMonth, WEEKDAY_NAMES, resolveDates } from './intake-dates.js';
import { SUBJECT_NAMES } from './intake-dictionary.js';
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

// מה יש ביום, בשורה אחת: בית ספר עד <שעה>, מבחנים, אימונים ואירועים. ריק = "פנוי".
function dayParts(day) {
  const parts = [];
  const lessons = day.items.filter((i) => i.kind === 'lesson' && i.end);
  if (lessons.length > 0) parts.push(`בית ספר עד ${hm(lessons.map((i) => i.end).sort().at(-1))}`);
  else if (day.noSchool) parts.push('אין בית ספר');
  for (const item of day.items) {
    if (item.kind === 'exam' && !item.makeup) parts.push(item.title);
    else if (item.kind === 'training' || item.kind === 'event') parts.push(`${item.start && !item.allDay ? `${hm(item.start)} ` : ''}${item.title ?? ''}`.trim()); // אירוע של כל היום (שלב 3, 24.11): בלי 00:00
  }
  return parts.length > 0 ? parts.join(' · ') : 'פנוי';
}
const NO_TIMETABLE = '(מערכת השעות לא נטענה, שעות בית הספר לא מוצגות)';

export function weekText(days, today, { timetable = true } = {}) {
  const lines = ['השבוע:'];
  if (!timetable) lines.push(NO_TIMETABLE);
  for (const day of days) lines.push(`· ${dayLabel(day.date, today)}: ${dayParts(day)}`);
  return lines.join('\n');
}

// coverageEnd: התאריך האחרון בלוח המבחנים. מה שאחריו "לא ידוע", לא "אין" (לא מנחשים).
export function examsText(days, today, { coverageEnd = null } = {}) {
  const exams = days.flatMap((day) => day.items.filter((i) => i.kind === 'exam' && !i.makeup).map((i) => ({ date: day.date, title: i.title })));
  const last = days.at(-1)?.date ?? today;
  const unknown = coverageEnd && coverageEnd < last ? `לוח המבחנים מכסה עד ${formatDayMonth(coverageEnd)}. אחרי זה לא ידוע.` : null;
  if (exams.length === 0) return [unknown ? `אין מבחנים עד ${formatDayMonth(coverageEnd)}.` : `אין מבחנים ב-${EXAMS_DAYS} הימים הקרובים.`, ...(unknown ? [unknown] : [])].join('\n');
  return ['המבחנים הקרובים:', ...exams.map((e) => `· ${dayLabel(e.date, today)}: ${e.title}`), ...(unknown ? [unknown] : [])].join('\n');
}

// { status: 'recorded' | 'skipped', reply }. כשל מסד נזרק (הצינור מטפל).
export async function answerShowRequest({ sql, source, kind, timetable, now = new Date() }) {
  const today = localDateIso(now, TIME_ZONE);
  let text;
  if (kind === 'week') {
    const cal = await loadCalendar({ sql, timetable, from: today, days: 7, now });
    text = weekText(cal.days, today, { timetable: Boolean(timetable) });
  } else {
    const cal = await loadCalendar({ sql, timetable, from: today, days: EXAMS_DAYS, now });
    text = examsText(cal.days, today, { coverageEnd: rowsOf(cal.unknownExams)[0]?.coverageEnd ?? null });
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

// ---------------------------------------------------------------------------
// שאלה חופשית על הלוח (24.11.2026, הרחבת "דרך ב'": כלים כלליים עם שומר בקוד; 05-open-questions.md).
// "מה יש לי מחר?", "מה יש לי מחמישי עד שבת?", "מה יש לי שבוע הבא?", "מתי המבחן בהיסטוריה?". המוח מזהה (kind schedule_query, lib/intake-brain.js)
// ומעתיק ביטויים מילה במילה; התאריכים, הטעינה והניסוח בקוד (המודל לא מקבל תאריך ולא מחשב, 03-brain-module-rules.md). קריאה בלבד.
// ---------------------------------------------------------------------------
export const QUERY_MAX_DAYS = 14; // הנחה, לא אומת: טווח ארוך יותר הוא בועה ארוכה מדי לטלפון
export const SUBJECT_EXAM_DAYS = 42; // MAX_CALENDAR_DAYS ב-lib/calendar-view.js

// שם יום בלי מילת יחס ("חמישי", "שבת" מתוך "עד שבת") לא נקרא לבד ב-resolveDates; ניסיון שני עם "ב" לפניו ("בחמישי").
function firstDate(text, receivedAt) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const t = text.trim();
  return resolveDates(t, receivedAt)[0]?.date ?? (/^[א-ת]/.test(t) && !t.startsWith('ב') ? resolveDates(`ב${t}`, receivedAt)[0]?.date ?? null : null);
}

// { mode: 'days', from, days } | { mode: 'exams', subject, from, days }. טהור. RangeError על חותמת קליטה לא תקינה.
export function scheduleQueryPlan({ understanding, text, receivedAt }) {
  const today = localDateIso(receivedAt, TIME_ZONE);
  const start = firstDate(understanding?.date_text, receivedAt);
  if (start) {
    const end = firstDate(understanding?.end_date_text, receivedAt);
    let days = 1;
    if (end && end > start) while (days < QUERY_MAX_DAYS && addDays(start, days) <= end) days += 1;
    return { mode: 'days', from: start, days };
  }
  const subject = understanding?.subject;
  if (typeof subject === 'string' && SUBJECT_NAMES.includes(subject)) return { mode: 'exams', subject, from: today, days: SUBJECT_EXAM_DAYS };
  if (/שבוע\s+הבא/.test(String(text ?? ''))) return { mode: 'days', from: addDays(today, 7 - weekdayOf(today)), days: 7 };
  return { mode: 'days', from: today, days: 7 };
}

export function queryDaysText(days, today, { timetable = true } = {}) {
  if (days.length === 1) {
    const [day] = days;
    const label = dayLabel(day.date, today);
    const full = `${WEEKDAY_NAMES[weekdayOf(day.date)]} ${formatDayMonth(day.date)}`;
    return [`${label === full ? label : `${label} (${full})`}: ${dayParts(day)}`, ...(timetable ? [] : [NO_TIMETABLE])].join('\n');
  }
  const first = days[0].date;
  const last = days.at(-1).date;
  const header = first === today && days.length === 7 ? 'השבוע:' : `${dayLabel(first, today)} עד ${dayLabel(last, today)}:`;
  return [header, ...(timetable ? [] : [NO_TIMETABLE]), ...days.map((day) => `· ${dayLabel(day.date, today)}: ${dayParts(day)}`)].join('\n');
}

export function subjectExamsText(days, today, subject, { coverageEnd = null } = {}) {
  const exams = days.flatMap((day) => day.items.filter((i) => i.kind === 'exam' && !i.makeup && i.subject === subject).map((i) => ({ date: day.date, title: i.title })));
  const last = days.at(-1)?.date ?? today;
  const unknown = coverageEnd && coverageEnd < last ? `לוח המבחנים מכסה עד ${formatDayMonth(coverageEnd)}. אחרי זה לא ידוע.` : null;
  if (exams.length === 0) return [`לא מצאתי מבחן ב${subject} ב-${SUBJECT_EXAM_DAYS} הימים הקרובים.`, ...(unknown ? [unknown] : [])].join('\n');
  return [`מבחנים ב${subject}:`, ...exams.map((e) => `· ${dayLabel(e.date, today)}: ${e.title}`), ...(unknown ? [unknown] : [])].join('\n');
}

// { status: 'recorded' | 'skipped', reply }. כשל מסד נזרק (הצינור מטפל). RangeError על חותמת קליטה לא תקינה (הצינור: "התקבל").
// now: ברירת המחדל היא רגע הקליטה (התשובה מיידית), כדי ש"היום" ו"מחר" בתשובה יתאימו לתאריכים שחושבו מאותו רגע.
export async function answerScheduleQuery({ sql, source, understanding, timetable, exams, now = source?.received_at ? new Date(source.received_at) : new Date() }) {
  const plan = scheduleQueryPlan({ understanding, text: source.raw_content, receivedAt: source.received_at ?? now });
  const today = localDateIso(now, TIME_ZONE);
  const cal = await loadCalendar({ sql, timetable, from: plan.from, days: plan.days, now, ...(exams ? { exams } : {}) });
  const coverageEnd = rowsOf(cal.unknownExams)[0]?.coverageEnd ?? null;
  const text = plan.mode === 'exams'
    ? subjectExamsText(cal.days, today, plan.subject, { coverageEnd })
    : queryDaysText(cal.days, today, { timetable: Boolean(timetable) });
  const rows = rowsOf(await sql`
    /* schedule-query */ WITH claim AS (
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
