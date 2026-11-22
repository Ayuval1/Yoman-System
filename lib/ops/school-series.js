// בלוק 4, "74 שיעורים והפסקות ביומן" (docs/08-chapter8/35-chapter8-plan.md 8.4, H2/H6/H18/H19, I-42). משימת ops: /api/ops?task=school-series.
// mode=dry (ברירת מחדל, GET או POST): קריאה בלבד. מחזיר סיכום: ספירות (שיעורים, הפסקות, לפי יום), תאריך ראשון ואחרון, החופשות שמוחרגות,
//   סדרות של האפליקציה שכבר קיימות, והסדרות הישנות שייחתכו (כותרת ו-RRULE נוכחי). לא נכתב כלום ל-Google.
// mode=apply (POST בלבד, כדי שפתיחה בדפדפן או קדם-טעינה לא יכתבו): יוצר את מה שחסר, מעדכן את מה שקיים (לפי מזהה קבוע, בלי כפילות),
//   ורק אם הכול הצליח חותך את הסדרות הישנות ("בית ספר יום X") ביום שלפני ההפעלה. לא מוחק אף אירוע לעולם.
//   מסרב (409) כשהספירה אינה 74 (Plan B), כשהיומן "בית ספר" לא נמצא, כש-Google לא מחובר, או כשמערכת השעות חסרה.
// הגנה: כמו lib/ops/daily-check.js, Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע. אין Cron שקורא למשימה הזאת; יובל מריץ ידנית.
// probe_log: שורה אחת 'school-series' עם ספירות וקודים בלבד. בלי כותרות, מזהי יומן או אירוע, ובלי tokens.
// כותרות יום (22.11): עוד 5 סדרות של יום שלם (buildSchoolHeaders), נבדקות ונכתבות כמו השיעורים, אבל מדווחות בנפרד (headers, header_plan,
//   headers_created/headers_updated) ולא נכנסות לספירת 74. סדרה קיימת שכבר זהה לא נכתבת שוב (plan.unchanged).
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { getCalendarEvent, googleConfigFromEnv, insertCalendarEvent, isAppSeriesEvent, listSeriesEvents, patchCalendarEvent, shortReason } from '../google.js';
import { connect, resolveCalendarId } from '../event-sync.js';
import { loadTimetable } from '../timetable.js';
import { VACATIONS, isSchoolDay } from '../school-calendar.js';
import { addDays, localDateIso } from '../intake-dates.js';
import { zonedToUtc } from '../schedule-time.js';
import { SCHOOL_CALENDAR, TIME_ZONE, buildSchoolHeaders, buildSchoolSeries, countSeries, isOldSchoolSeries, planSchoolSeries } from '../school-google.js';

const MODES = ['dry', 'apply'];
// הגנה מחריגה מ-maxDuration (300 שניות ב-api/ops.js): אחרי 240 שניות לא מתחילים כתיבה חדשה. הרצה חוזרת ממשיכה מאותה נקודה (המזהים קבועים).
const WRITE_BUDGET_MS = 240 * 1000;

function reply(status, body) {
  const isText = typeof body === 'string';
  return new Response(isText ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

async function logProbe(sql, ok, detail) {
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('school-series', ${ok}, ${detail})`;
    return true;
  } catch (error) {
    console.error('school-series: כתיבה ל-probe_log נכשלה', error?.name);
    return false;
  }
}

// יום הלימודים הראשון מ-from והלאה, והאחרון לפני סוף השנה (לפי מערכת השעות וקובץ החופשות). null אם אין.
function firstSchoolDay(from, timetable, vacations) {
  for (let d = from, i = 0; i < 400; d = addDays(d, 1), i += 1) if (isSchoolDay(d, timetable, vacations)) return d;
  return null;
}
function lastSchoolDay(from, timetable, vacations) {
  const endOfYear = vacations.find((v) => v?.endOfYear === true)?.from;
  if (!endOfYear) return null;
  for (let d = addDays(endOfYear, -1), i = 0; i < 400 && d >= from; d = addDays(d, -1), i += 1) if (isSchoolDay(d, timetable, vacations)) return d;
  return null;
}

const rruleOf = (event) => (event.recurrence ?? []).find((line) => line.startsWith('RRULE:')) ?? null;

// handle מקבל DB, config, fetch, שעון וטעינת מערכת השעות מבחוץ, כדי שאפשר לבדוק בלי מסד ובלי רשת.
export async function handle(request, {
  sql, secret = process.env.CRON_SECRET, config = googleConfigFromEnv(), fetchImpl = fetch, now = () => new Date(),
  vacations = VACATIONS, loadTable = loadTimetable,
}) {
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');

  const mode = new URL(request.url).searchParams.get('mode') ?? 'dry';
  if (!MODES.includes(mode)) return reply(400, { error: 'bad_mode', allowed: MODES });
  if (mode === 'apply' && request.method !== 'POST') return reply(400, { error: 'apply_requires_post' });

  const startedMs = now().getTime();
  const activationDate = localDateIso(now(), TIME_ZONE);
  const refused = [];

  const timetable = await loadTable(sql);
  if (!timetable) refused.push('timetable_missing');
  const series = timetable ? buildSchoolSeries(timetable) : [];
  const counts = countSeries(series);
  if (timetable && !counts.ok) refused.push('count_mismatch');
  if (!vacations.some((v) => v?.endOfYear === true)) refused.push('no_end_of_year');
  // כותרות היום נגזרות מאותן סדרות. כל המזהים (74 + 5) נבדקים ומתוכננים יחד; הספירה למעלה נשארת על 74 בלבד.
  const headers = buildSchoolHeaders(series);
  const allItems = [...series, ...headers];

  // Google: חיבור, היומן "בית ספר" (owner/writer, שם מדויק), ורשימת האירועים שלו שעוד לא הסתיימו לפני ההפעלה. קריאה בלבד.
  let google = { ok: false, reason: null };
  let calendarId = null;
  let accessToken = null;
  let existing = [];
  const hiddenIds = [];
  const connected = await connect({ sql, config, fetchFn: fetchImpl, label: 'school-series' });
  if (!connected.ok) {
    google = { ok: false, reason: connected.reason };
  } else {
    const calendar = resolveCalendarId(connected.calendars, SCHOOL_CALENDAR);
    if (!calendar.ok) {
      google = { ok: false, reason: calendar.reason };
    } else {
      const listed = await listSeriesEvents({
        accessToken: connected.accessToken, calendarId: calendar.calendarId, timeMin: zonedToUtc(activationDate, '00:00', TIME_ZONE).toISOString(), fetchImpl,
      });
      if (!listed.ok) google = { ok: false, reason: shortReason(`events_${listed.reason}`, listed.status) };
      else {
        google = { ok: true, reason: null };
        ({ calendarId } = calendar);
        ({ accessToken } = connected);
        existing = listed.events;
      }
    }
  }
  if (!google.ok) refused.push(google.reason ?? 'google_failed');

  // כל סדרה נבדקת ישירות לפי המזהה הקבוע שלה (events.get, GET בלבד), ולא רק לפי הרשימה: סדרה שקיימת ולא הופיעה ברשימה לא תיווצר שוב,
  // וסדרה שנמחקה (status 'cancelled') לא תחזור בשקט. 404/410 = חסרה, ליצירה.
  if (google.ok) {
    const byId = new Map(existing.map((e) => [e.id, e]));
    for (const item of allItems) {
      const got = await getCalendarEvent({ accessToken, calendarId, eventId: item.eventId, fetchImpl });
      if (!got.ok) { refused.push(shortReason(`get_${got.reason}`, got.status)); break; }
      if (!got.found) { byId.delete(item.eventId); continue; }
      if (got.event.status === 'cancelled') { hiddenIds.push(item.eventId); byId.delete(item.eventId); continue; }
      byId.set(item.eventId, got.event);
    }
    existing = [...byId.values()];
  }

  const plan = planSchoolSeries({ series: allItems, existing, activationDate, vacations, hiddenIds });
  if (plan.unscheduled.length > 0) refused.push('unscheduled');
  // ספירות התכנית לפי סוג: 'series' = שיעורים והפסקות, 'headers' = כותרות היום.
  const isHeader = (item) => item.kind === 'header';
  const countOf = (list, wantHeader) => list.filter((entry) => isHeader(entry.item ?? entry) === wantHeader).length;
  const planCounts = (wantHeader) => ({
    create: countOf(plan.create, wantHeader), update: countOf(plan.update, wantHeader), unchanged: countOf(plan.unchanged, wantHeader),
    hidden: countOf(plan.hidden, wantHeader), unscheduled: countOf(plan.unscheduled, wantHeader),
  });
  const seriesPlan = planCounts(false);
  const headerPlan = planCounts(true);

  const summary = {
    mode,
    activation_date: activationDate,
    counts: { lessons: counts.lessons, breaks: counts.breaks, total: counts.total, expected: 74, ok: counts.ok, mismatch: counts.mismatch, by_weekday: counts.by_weekday },
    first_date: timetable ? firstSchoolDay(activationDate, timetable, vacations) : null,
    last_date: timetable ? lastSchoolDay(activationDate, timetable, vacations) : null,
    vacations_excluded: vacations.filter((v) => v?.endOfYear !== true && v.to >= activationDate).map((v) => ({ name: v.name, from: v.from, to: v.to })),
    google: { ok: google.ok, reason: google.reason, calendar: SCHOOL_CALENDAR },
    existing_app_series: existing.filter(isAppSeriesEvent).length,
    plan: {
      create: seriesPlan.create, update: seriesPlan.update, unchanged: seriesPlan.unchanged, hidden: seriesPlan.hidden, orphans: plan.orphans.length, unscheduled: seriesPlan.unscheduled,
    },
    headers: { count: headers.length, items: headers.map((h) => ({ weekday: h.weekday, title: h.title })) },
    header_plan: headerPlan,
    // סדרות שיובל מחק ב-Google: לא נוצרות מחדש, ובגללן הסדרות הישנות לא ייחתכו (כדי שלא יישאר שיעור בלי אירוע).
    hidden_series: plan.hidden.map((item) => item.key),
    cut_blocked: plan.hidden.length > 0 ? 'hidden_series' : null,
    old_series: [
      ...plan.cut.map(({ event, recurrence }) => ({ title: event.summary, rrule: rruleOf(event), action: 'cut', new_rrule: recurrence.find((l) => l.startsWith('RRULE:')) })),
      ...plan.cutSkipped.map(({ event, reason }) => ({ title: event.summary, rrule: rruleOf(event), action: 'skip', reason })),
    ],
    // אבחון (22.11): כל סדרה שאינה של האפליקציה ביומן "בית ספר", כדי לראות למה סדרה ישנה לא זוהתה. מוחזר ליובל בלבד, לא נכתב ל-probe_log.
    other_series: existing.filter((e) => !isAppSeriesEvent(e) && Array.isArray(e.recurrence) && e.recurrence.length > 0).slice(0, 30)
      .map((e) => ({ title: e.summary, start: e.start?.dateTime ?? e.start?.date ?? null, rrule: rruleOf(e), matched: isOldSchoolSeries(e) })),
    refused,
  };

  if (mode === 'dry') {
    const detail = `mode=dry lessons=${counts.lessons} breaks=${counts.breaks} create=${seriesPlan.create} update=${seriesPlan.update} unchanged=${seriesPlan.unchanged}`
      + ` hidden=${plan.hidden.length} cut=${plan.cut.length} orphans=${plan.orphans.length}`
      + ` headers=${headers.length} headers_create=${headerPlan.create} headers_update=${headerPlan.update}${refused.length ? ` would_refuse=${refused.join(',')}` : ''}`;
    const logged = await logProbe(sql, true, detail);
    return reply(200, { ...summary, written: false, logged });
  }

  if (refused.length > 0) {
    const logged = await logProbe(sql, false, `mode=apply refused=${refused.join(',')}`);
    return reply(409, { ...summary, written: false, logged });
  }

  // ביצוע. יצירה ועדכון קודם; חיתוך הישנות רק אם כל החדשות קיימות, כדי שלא יישאר יום בלי בית ספר ביומן.
  const result = {
    created: 0, updated: 0, headers_created: 0, headers_updated: 0, existed_hidden: 0, hidden_skipped: plan.hidden.length, cut: 0, failed: 0, last_failure: null, stopped: null, cut_skipped: null,
  };
  const outOfTime = () => now().getTime() - startedMs > WRITE_BUDGET_MS;
  const fail = (reason) => { result.failed += 1; result.last_failure = reason; };
  for (const { item, body } of plan.create) {
    if (outOfTime()) { result.stopped = 'time_budget'; break; }
    const done = await insertCalendarEvent({ accessToken, calendarId, eventId: item.eventId, event: body, fetchFn: fetchImpl });
    if (!done.ok) fail(shortReason(done.reason, done.status));
    // 409 אחרי ש-events.get אמר "חסר": מצב לא צפוי (מזהה תפוס ולא נראה). לא דורסים; נספר ככשל, וחוסם את חיתוך הישנות.
    else if (done.existed) { result.existed_hidden += 1; fail('exists_hidden'); }
    else if (isHeader(item)) result.headers_created += 1;
    else result.created += 1;
  }
  for (const { item, eventId, patch } of plan.update) {
    if (result.stopped || outOfTime()) { result.stopped = 'time_budget'; break; }
    const done = await patchCalendarEvent({ accessToken, calendarId, eventId, patch, fetchFn: fetchImpl });
    if (!done.ok) fail(shortReason(done.reason, done.status));
    else if (isHeader(item)) result.headers_updated += 1;
    else result.updated += 1;
  }
  if (result.failed > 0 || result.stopped || result.hidden_skipped > 0) {
    result.cut_skipped = 'new_series_incomplete';
  } else {
    for (const { event, recurrence } of plan.cut) {
      if (outOfTime()) { result.stopped = 'time_budget'; break; }
      const done = await patchCalendarEvent({ accessToken, calendarId, eventId: event.id, patch: { recurrence }, fetchFn: fetchImpl });
      if (done.ok) result.cut += 1; else fail(shortReason(done.reason, done.status));
    }
  }
  const ok = result.failed === 0 && !result.stopped && result.hidden_skipped === 0;
  const detail = `mode=apply created=${result.created} updated=${result.updated} headers_created=${result.headers_created} headers_updated=${result.headers_updated}`
    + ` existed_hidden=${result.existed_hidden} hidden_skipped=${result.hidden_skipped}`
    + ` cut=${result.cut} failed=${result.failed}`
    + `${result.last_failure ? ` last_failure=${result.last_failure}` : ''}${result.stopped ? ` stopped=${result.stopped}` : ''}${result.cut_skipped ? ` cut_skipped=${result.cut_skipped}` : ''}`;
  const logged = await logProbe(sql, ok, detail);
  return reply(200, { ...summary, written: true, ok, result, logged });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
