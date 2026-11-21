// "אני פנוי?" (בלוק 3ב-2, docs/01-foundation/אפיון-מורחב.md ח-6): "ה-AI מבין את השאלה; הבדיקה מול היומן בקוד." "הבדיקה היא רק מול מה שהמערכת מכירה
// (היומן שלה ו-Google). מה שלא נמסר לה, היא לא יודעת." כשתפוס: מה יש, ומתי פנוי ("תפוס: אימון 17:00–19:00. פנוי מ-19:00.").
// המוח רק מזהה את הכוונה ומעתיק את ביטויי התאריך והשעה מילה במילה (lib/intake-brain.js, kind 'free_check'). כל חישוב התאריכים והשעות כאן, בקוד.
// גם lib/unavailable.js משתמש כאן ב-loadBusy (מה יש בשעה של "לא זמין") וב-readTimes ("ב-5" = 17:00).
//
// הכרעות טכניות (בלוק 3ב-2), כולן [הנחה, לא אומת] ושקל להפוך:
//  - "מה שהמערכת מכירה": מערכת השעות (יום לימודים לפי lib/school-calendar.js) כבלוק אחד "בית ספר" מתחילת השיעור הראשון עד סוף האחרון; מבחנים עם שעה
//    (lib/exam-line.js) כפריט נפרד; שורות events עם status='planned' (כולל חלונות "לא זמין"); ואירועי Google עם שעה, חי, ליום הנבדק (googleDay מוזרק).
//    אירוע Google של יום שלם לא נחשב תפוס (יום הולדת אינו חוסם שעה). אירוע Google שכבר ב-events (external_id) לא נספר פעמיים.
//  - "ב-5" (מספר חשוף 1 עד 12 בלי דקות ובלי מילת חלק-יום): שתי הקריאות, ונשארות רק אלה שבשעות הערות 07:00 עד 22:59 (ח-2: "'ב-5' מתפרש 17:00").
//    כששתיהן בשעות הערות ("ב-9"): כאן עונים על שתיהן; ב"לא זמין" שואלים.
//  - בלי תאריך: היום. תאריך עמום: עד שני תאריכים, שורה לכל אחד. בלי שעה: רשימת מה שיש באותו יום.
import { tokenize } from './intake-text.js';
import { findTimeReading, findEndTime } from './intake-dictionary.js';
import { resolveDates, localDateIso, addDays, weekdayOf, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';
import { localParts } from './schedule-time.js';
import { dayRange, cleanTitle } from './closing-tomorrow.js';
import { isSchoolDay, lessonsOnDate, VACATIONS } from './school-calendar.js';
import { examsOnDate, EXAMS } from './exam-line.js';
import { connect } from './event-sync.js';
import { listCalendarEvents, googleConfigFromEnv } from './google.js';

const TIME_ZONE = 'Asia/Jerusalem';
export const WAKING_FROM = '07:00';
export const WAKING_TO = '22:59';
const END_OF_DAY = '24:00';
const MAX_DATES = 2;
const pad2 = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// זיהוי דטרמיניסטי (נפילה כשהמוח לא זמין): רק ניסוחים ברורים. "יום ג' ב-6?" בלי המילה "פנוי" מזוהה רק במוח.
// ---------------------------------------------------------------------------
// בתחילת ההודעה, או אחרי "אני": "החדר לא פנוי" ו"חדר 12 תפוס" אינם הכרזה של יובל.
const NEGATED_FREE = /(?:^|(?:^|[\s,.])אני\s+)(?:לא\s+(?:זמין|פנוי)|עסוק|תפוס)(?=$|[\s,.!])/;
const FREE_WORD = /(?:^|[\s,.])(?:אני|אתה|האם)\s+(?:אני\s+)?(?:פנוי|זמין)(?=$|[\s,.!?])/;
// 'unavailable' (הכרזה של יובל), 'free_check' (שאלה), או null.
export function detectAvailability(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  const question = value.includes('?') || /^האם\s/.test(value);
  if (!question && NEGATED_FREE.test(value)) return 'unavailable';
  if (FREE_WORD.test(value) && (question || /^(?:אני|אתה)\s+(?:פנוי|זמין)\s/.test(value)) && !/לא\s+(?:זמין|פנוי)/.test(value)) return 'free_check';
  return null;
}

// ---------------------------------------------------------------------------
// שעות
// ---------------------------------------------------------------------------
const inWaking = (hhmm) => hhmm >= WAKING_FROM && hhmm <= WAKING_TO;

const DIGIT_HOUR = /^\d{1,2}$/;
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TIME_PREFIX = /^(?:ב|מ|בשעה|משעה|מהשעה)$/;
// מילת חלק-יום אחרי מספר חשוף ("ב-9 בערב"): 'am' / 'pm' / null. המילון קורא מספר חשוף בלי מילת חלק-יום, ולכן ההכרעה כאן.
function halfAfter(word, hour) {
  if (/^ה?ב?בוקר$/.test(word ?? '')) return 'am';
  if (/^ה?ב?ערב$|^ב?ה?צהר(?:יי|י)מ$|^אחהצ$/.test(word ?? '')) return 'pm';
  if (/^ה?ב?לילה$/.test(word ?? '')) return hour <= 5 || hour === 12 ? 'am' : 'pm';
  return null;
}

// מספר חשוף אחרי קידומת שעה ("ב-5", "מ-5", "בשעה 5", "מ-17:00"), שלא אחרי "עד": { index, hour, minute } או null.
function prefixedNumber(words) {
  for (let i = 1; i < words.length; i += 1) {
    if (!TIME_PREFIX.test(words[i - 1]) || /^ו?עד$/.test(words[i - 2] ?? '')) continue;
    if (DIGIT_HOUR.test(words[i]) && Number(words[i]) <= 23) return { index: i, hour: Number(words[i]), minute: 0, bare: true };
    const clock = CLOCK.exec(words[i]);
    if (clock) return { index: i, hour: Number(clock[1]), minute: Number(clock[2]), bare: false };
  }
  return null;
}

// הקריאות של השעה הראשונה בביטוי (HH:MM), אחרי כלל "ב-5" = 17:00. [] כשאין שעה.
export function readTimes(expression) {
  const { clean, tokens } = tokenize(typeof expression === 'string' ? expression : '');
  const words = tokens.map((token) => token.w);
  const found = findTimeReading(words, { words, clean, tokens });
  const number = prefixedNumber(words);
  let candidates;
  if (number && number.bare && number.hour >= 1 && number.hour <= 12 && (!found || found.candidates.length === 1)) {
    // מספר חשוף 1 עד 12: שתי הקריאות, אלא אם מילת חלק-יום אחריו מכריעה.
    const half = halfAfter(words[number.index + 1], number.hour);
    const am = `${pad2(number.hour % 12)}:00`;
    const pm = `${pad2((number.hour % 12) + 12)}:00`;
    candidates = half === 'am' ? [am] : half === 'pm' ? [pm] : [am, pm];
  } else if (found && found.candidates.length > 0) {
    candidates = [...found.candidates];
  } else if (number) {
    candidates = [`${pad2(number.hour)}:${pad2(number.minute)}`];
  } else {
    return [];
  }
  if (candidates.length > 1) {
    const waking = candidates.filter(inWaking);
    if (waking.length > 0) candidates = waking;
  }
  return [...new Set(candidates)].sort();
}

// שעת הסיום ("עד 7"): HH:MM, ואם היא לא אחרי ההתחלה, אותה שעה בחצי השני של היום (19:00), אם זה אחרי ההתחלה. אחרת null.
export function readEndTime(expression, start) {
  const { tokens } = tokenize(typeof expression === 'string' ? expression : '');
  const end = findEndTime(tokens.map((token) => token.w));
  if (!end) return null;
  if (!start || end > start) return end;
  const later = `${pad2(Number(end.slice(0, 2)) + 12)}${end.slice(2)}`;
  return Number(end.slice(0, 2)) < 12 && later > start ? later : null;
}

// ---------------------------------------------------------------------------
// מתי שואלים
// ---------------------------------------------------------------------------
// תאריכים מביטוי (YYYY-MM-DD), עד MAX_DATES. [] כשאין.
export function datesFrom(expression, receivedAt) {
  if (typeof expression !== 'string' || expression.trim() === '') return [];
  let mentions;
  try {
    mentions = resolveDates(expression, receivedAt);
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
  return [...new Set(mentions.flatMap((m) => (m.ambiguous ? m.candidates : [m.date])))].slice(0, MAX_DATES);
}

// { dates, times, endTime }. dateText / timeText: ביטויים שהמוח העתיק מילה במילה; בלעדיהם, הקריאה מכל הטקסט.
export function freeCheckWhen({ text, receivedAt, dateText = null, timeText = null }) {
  const dates = datesFrom(dateText ?? text, receivedAt);
  const times = readTimes(timeText ?? text);
  const endTime = times.length === 1 ? readEndTime(text, times[0]) : null;
  return { dates: dates.length > 0 ? dates : [localDateIso(receivedAt, TIME_ZONE)], times, endTime };
}

// ---------------------------------------------------------------------------
// מה המערכת מכירה ביום
// ---------------------------------------------------------------------------
// HH:MM בישראל של רגע, חתוך לגבולות היום: לפני היום = 00:00, אחרי = 24:00.
function clockOn(dateIso, instant) {
  const { from, to } = dayRange(dateIso);
  const ms = new Date(instant).getTime();
  if (ms <= from.getTime()) return '00:00';
  if (ms >= to.getTime()) return END_OF_DAY;
  const parts = localParts(new Date(ms), TIME_ZONE);
  return `${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

// אירועי Google עם שעה ביום dateIso מכל היומנים (קריאה בלבד). { ok:true, events:[{ id, title, startsAt, endsAt }] } או { ok:false, reason }. לא זורק.
export async function loadGoogleDay({ sql, config, dateIso, fetchImpl = fetch }) {
  let connection;
  try {
    connection = await connect({ sql, config, fetchFn: fetchImpl, label: 'free-check' });
  } catch (error) {
    return { ok: false, reason: `connect_${String(error?.name ?? 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)}` };
  }
  if (!connection.ok) return { ok: false, reason: connection.reason };
  const { from, to } = dayRange(dateIso);
  const events = [];
  for (const calendar of connection.calendars) {
    if (typeof calendar?.id !== 'string' || calendar.accessRole === 'freeBusyReader' || calendar.id.includes('#holiday@group.v.calendar.google.com')) continue;
    const listed = await listCalendarEvents({ accessToken: connection.accessToken, calendarId: calendar.id, timeMin: from.toISOString(), timeMax: to.toISOString(), fetchImpl });
    if (!listed.ok) return { ok: false, reason: listed.reason };
    events.push(...listed.events);
  }
  return { ok: true, events };
}

// googleDay לנקודות הקצה (api/intake.js, api/chat.js): פונקציה (dateIso) => loadGoogleDay, או undefined כשהגדרות Google חסרות (אז "Google לא נבדק", בלי קריאה לרשת).
export function googleDayFromEnv({ sql, env = process.env, fetchImpl = fetch } = {}) {
  const config = googleConfigFromEnv(env);
  if (!config.clientId || !config.clientSecret || !config.encKeyRaw) return undefined;
  return (dateIso) => loadGoogleDay({ sql, config, dateIso, fetchImpl });
}

// { items: [{ title, start, end, domain }] ממוינים, google: 'ok' | 'failed' | 'skipped', timetable: true/false }. כשל מסד ב-events נזרק.
// excludeDomains: domains של events שלא נספרים (ב"לא זמין": חלון קודם אינו התנגשות).
export async function loadBusy({ sql, dateIso, timetable, googleDay, exams = EXAMS, vacations = VACATIONS, excludeDomains = [] }) {
  const items = [];
  const hasTimetable = Array.isArray(timetable?.slots) && timetable.slots.length > 0;
  if (hasTimetable && isSchoolDay(dateIso, timetable, vacations)) {
    const lessons = lessonsOnDate(dateIso, timetable);
    const start = lessons.map((slot) => slot.startsAt).sort()[0];
    const end = lessons.map((slot) => slot.endsAt).sort().at(-1);
    items.push({ title: 'בית ספר', start, end, domain: 'school' });
    for (const exam of examsOnDate(dateIso, { timetable, exams })) {
      if (!exam.time) continue;
      const slot = lessons.find((lesson) => lesson.startsAt === exam.time);
      items.push({ title: `${exam.type} ב${exam.subject}`, start: exam.time, end: slot?.endsAt ?? exam.time, domain: 'exam' });
    }
  }
  const { from, to } = dayRange(dateIso);
  const rows = await sql`
    SELECT e.title, e.starts_at, e.ends_at, e.domain, e.external_id
    FROM events e
    WHERE e.status = 'planned' AND e.starts_at < ${to.toISOString()}::timestamptz AND coalesce(e.ends_at, e.starts_at) >= ${from.toISOString()}::timestamptz
    ORDER BY e.starts_at ASC, e.id ASC
  `;
  const known = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row.external_id === 'string' && row.external_id !== '') known.add(row.external_id);
    if (excludeDomains.includes(row.domain) || !row.starts_at || Number.isNaN(Date.parse(row.starts_at))) continue;
    const start = clockOn(dateIso, row.starts_at);
    const end = row.ends_at && !Number.isNaN(Date.parse(row.ends_at)) ? clockOn(dateIso, row.ends_at) : start;
    items.push({ title: cleanTitle(row.title), start, end, domain: row.domain ?? null });
  }
  let google = 'skipped';
  if (typeof googleDay === 'function') {
    let listed;
    try {
      listed = await googleDay(dateIso);
    } catch (error) {
      console.error('free-check: קריאת Google נכשלה:', error?.name);
      listed = { ok: false };
    }
    google = listed?.ok ? 'ok' : 'failed';
    for (const event of listed?.ok && Array.isArray(listed.events) ? listed.events : []) {
      if (!event?.startsAt || known.has(event.id)) continue;
      const start = clockOn(dateIso, event.startsAt);
      items.push({ title: cleanTitle(event.title), start, end: event.endsAt ? clockOn(dateIso, event.endsAt) : start, domain: 'google' });
    }
  }
  items.sort((a, b) => (a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)));
  return { items, google, timetable: hasTimetable };
}

// ---------------------------------------------------------------------------
// התשובה
// ---------------------------------------------------------------------------
const shown = (hhmm) => (hhmm === END_OF_DAY ? '23:59' : hhmm);
const span = (item) => (item.start === item.end ? `${item.title} ${item.start}` : `${item.title} ${shown(item.start)}–${shown(item.end)}`);

function dayLabel(dateIso, today) {
  if (dateIso === today) return 'היום';
  if (dateIso === addDays(today, 1)) return 'מחר';
  return `${WEEKDAY_NAMES[weekdayOf(dateIso)]} ${formatDayMonth(dateIso)}`;
}

// הפריטים שחופפים לרגע time (או לטווח time עד endTime). פריט בלי משך (התחלה = סוף) חופף רק לאותה דקה.
export function overlapping(items, time, endTime = null) {
  return items.filter((item) => {
    if (item.start === item.end) return endTime ? item.start >= time && item.start < endTime : item.start === time;
    return endTime ? item.start < endTime && item.end > time : item.start <= time && item.end > time;
  });
}

// מתי פנוי אחרי הפריטים החופפים: סוף הרצף (פריט שמתחיל לפני שהקודם נגמר ממשיך אותו). END_OF_DAY = אין זמן פנוי עד סוף היום.
export function freeFrom(items, covering) {
  let cursor = covering.map((item) => item.end).sort().at(-1);
  let moved = true;
  while (moved) {
    moved = false;
    for (const item of items) {
      if (item.start <= cursor && item.end > cursor) {
        cursor = item.end;
        moved = true;
      }
    }
  }
  return cursor;
}

function footer(busy) {
  const known = [...(busy.timetable ? ['מערכת השעות'] : []), 'היומן שלה', ...(busy.google === 'ok' ? ['Google'] : [])];
  const list = known.length === 1 ? known[0] : `${known.slice(0, -1).join(', ')} ו-${known.at(-1)}`.replace(/ ו-(?=[א-ת])/, ' ו');
  const notes = [...(busy.google === 'ok' ? [] : ['Google לא נבדק.']), ...(busy.timetable ? [] : ['מערכת השעות לא נטענה.'])];
  return [`נבדק רק מול מה שהמערכת מכירה: ${list}.`, ...notes].join(' ');
}

// התשובה לתאריך אחד. times: [] (רשימת היום), שעה אחת, או שתי קריאות (שורה לכל אחת).
export function composeFreeAnswer({ dateIso, today, times, endTime = null, busy }) {
  const day = dayLabel(dateIso, today);
  const lines = [];
  if (times.length === 0) {
    lines.push(busy.items.length === 0 ? `${day} אין כלום ביומן.` : `${day}: ${busy.items.map(span).join(', ')}.`);
  } else {
    for (const time of times) {
      const when = `${day} ${endTime && times.length === 1 ? `${time}–${endTime}` : `ב-${time}`}`;
      const covering = overlapping(busy.items, time, times.length === 1 ? endTime : null);
      if (covering.length === 0) {
        lines.push(`${when} פנוי.`);
        continue;
      }
      const free = freeFrom(busy.items, covering);
      lines.push(`${when} תפוס: ${covering.map(span).join(', ')}. ${free === END_OF_DAY ? 'אין זמן פנוי עד סוף היום.' : `פנוי מ-${free}.`}`);
    }
  }
  return `${lines.join('\n')}\n${footer(busy)}`;
}

// התשובה המלאה (טקסט), לכל תאריך שנקרא. googleDay (אופציונלי): (dateIso) => { ok, events }. exams/vacations: לבדיקות.
export async function answerFreeCheck({ sql, text, receivedAt, timetable, googleDay, dateText = null, timeText = null, exams, vacations }) {
  const { dates, times, endTime } = freeCheckWhen({ text, receivedAt, dateText, timeText });
  const today = localDateIso(receivedAt, TIME_ZONE);
  const parts = [];
  for (const dateIso of dates) {
    const busy = await loadBusy({ sql, dateIso, timetable, googleDay, exams, vacations });
    parts.push(composeFreeAnswer({ dateIso, today, times, endTime, busy }));
  }
  return parts.join('\n\n');
}
