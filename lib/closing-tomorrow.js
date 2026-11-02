// טעינת האירועים של "מחר" להודעת הסגירה של 21:00 (שלב C-3, docs/08-chapter8/90 E3 המעודכן בבקשת יובל 29.10.2026). כל הפונקציות כאן הן קריאה בלבד.
// שני מקורות: טבלת events הפנימית (planned בלבד) ואירועי Google של היומנים המחוברים (events.list בזמן ההרכבה, בלי watch ובלי כתיבה).
// פרטיות: מהמסד נשלפים title, starts_at, domain (ו-external_id, רק להשוואה, לא מוצג); בלי location ובלי description. מ-Google: כותרת ושעה בלבד, בלי נוכחים, מיקום ותיאור.
// כשל Google לא זורק: מוחזר { ok:false, reason } וההרכבה משמיטה את החלק; reason הוא קוד קצר (shortReason), בלי כותרות, ל-probe_log.
import { zonedToUtc } from './schedule-time.js';
import { addDays, localDateIso } from './intake-dates.js';
import { connect } from './event-sync.js';
import { listCalendarEvents, shortReason } from './google.js';

const TIME_ZONE = 'Asia/Jerusalem';
const NO_TITLE = 'אירוע';

// גבולות היום הישראלי של dateIso: [חצות, חצות הבא) כרגעי UTC.
export function dayRange(dateIso) {
  return { from: zonedToUtc(dateIso, '00:00', TIME_ZONE), to: zonedToUtc(addDays(dateIso, 1), '00:00', TIME_ZONE) };
}

// כותרת נקייה לשורה אחת: רווחים מכווצים; ירידות שורה והתו U+2063 (מפריד בלוק הפירוט) לא יכולים להיכנס מתוך כותרת חיצונית.
export function cleanTitle(value, fallback = NO_TITLE) {
  const text = typeof value === 'string' ? value.replace(/[⁣\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
  return text === '' ? fallback : text;
}

// אירועי events למחר: status='planned' ו-starts_at בתוך היום הישראלי. מחזיר { events: [{ title, startsAt, domain }], externalIds: Set }. כשל מסד נזרק (הצרכן מחליט).
export async function loadTomorrowEvents(sql, tomorrowIso) {
  const { from, to } = dayRange(tomorrowIso);
  const rows = await sql`
    SELECT e.title, e.starts_at, e.domain, e.external_id
    FROM events e
    WHERE e.status = 'planned' AND e.starts_at >= ${from.toISOString()}::timestamptz AND e.starts_at < ${to.toISOString()}::timestamptz
    ORDER BY e.starts_at ASC, e.id ASC
  `;
  const list = Array.isArray(rows) ? rows : [];
  const events = [];
  const externalIds = new Set();
  for (const row of list) {
    const ms = row.starts_at ? Date.parse(row.starts_at) : NaN;
    if (Number.isNaN(ms)) continue;
    events.push({ title: cleanTitle(row.title), startsAt: new Date(ms).toISOString(), domain: row.domain ?? null });
    if (typeof row.external_id === 'string' && row.external_id !== '') externalIds.add(row.external_id);
  }
  return { events, externalIds };
}

// האם אירוע Google (מ-listCalendarEvents) הוא של מחר: אירוע עם שעה לפי התאריך הישראלי של ההתחלה; אירוע של יום שלם אם מחר בתוך [startDate, endDate).
function isTomorrow(event, tomorrowIso) {
  if (event.startsAt) return localDateIso(new Date(event.startsAt), TIME_ZONE) === tomorrowIso;
  if (!event.startDate) return false;
  return event.startDate <= tomorrowIso && tomorrowIso < (event.endDate ?? addDays(event.startDate, 1)); // תאריכי ISO: השוואת מחרוזות נכונה
}

// יומן החגים האוטומטי של Google ("חגים ישראליים" וכדומה; הכרעת יובל 2.11: לא מוצג). מזהה אצל Google מסתיים ב-"#holiday@group.v.calendar.google.com", לא שם היומן (השם משתנה לפי שפה). [הנחה: הצורה הזאת לא נבדקה מול החשבון החי]
const isGoogleHolidayCalendar = (calendarId) => calendarId.includes('#holiday@group.v.calendar.google.com');

// אירועי Google של מחר מכל היומנים ברשימת היומנים של החשבון (חוץ מ-freeBusyReader, שאין בו כותרות). הכול או כלום: כשל באחד היומנים משמיט את כל החלק (לא מציגים רשימה חלקית כאילו שלמה).
// excludeIds: external_id של אירועים שכבר ב-events (לא מציגים פעמיים). מחזיר { ok:true, events:[{ title, startsAt }] } או { ok:false, reason }. לא זורק על כשל צפוי.
// config/fetchImpl מוזרקים (הבדיקות לא פונות לרשת). קריאה בלבד: GET בלבד, ללא watch.
export async function loadGoogleTomorrow({ sql, config, tomorrowIso, excludeIds = new Set(), fetchImpl = fetch }) {
  let connection;
  try {
    connection = await connect({ sql, config, fetchFn: fetchImpl, label: 'closing-tomorrow' });
  } catch (error) {
    return { ok: false, reason: `connect_${String(error?.name ?? 'error').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30)}` };
  }
  if (!connection.ok) return { ok: false, reason: connection.reason };
  const { from, to } = dayRange(tomorrowIso);
  const events = [];
  const seen = new Set();
  for (const calendar of connection.calendars) {
    if (typeof calendar?.id !== 'string' || calendar.accessRole === 'freeBusyReader' || isGoogleHolidayCalendar(calendar.id)) continue;
    const listed = await listCalendarEvents({
      accessToken: connection.accessToken, calendarId: calendar.id, timeMin: from.toISOString(), timeMax: to.toISOString(), fetchImpl,
    });
    if (!listed.ok) return { ok: false, reason: shortReason(`events_${listed.reason}`, listed.status) };
    for (const event of listed.events) {
      if (excludeIds.has(event.id) || !isTomorrow(event, tomorrowIso)) continue;
      const title = cleanTitle(event.title);
      const key = `${title}|${event.startsAt ?? event.startDate}`; // אותו אירוע שמופיע בשני יומנים
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ title, startsAt: event.startsAt });
    }
  }
  return { ok: true, events };
}
