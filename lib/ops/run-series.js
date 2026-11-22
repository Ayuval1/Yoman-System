// בלוק 5: חיתוך הסדרה הישנה "ריצת בוקר" (שישי 07:00) ביום ההפעלה של ריצות שלישי ושישי (lib/weekly-runs.js). משימת ops: /api/ops?task=run-series-cut.
// מקור: docs/02-rules/03-4fitness-rules.md, "כללים שחלים על כל הריצות": "הסדרה הישנה 'ריצת בוקר' (שישי 07:00) נחתכת ביום ההפעלה";
// docs/02-rules/03-google-calendar-rules.md, "היומנים הקיימים" (ריצת שישי מחליפה את "ריצת בוקר" 07:00 שנחתכת).
// אותה שיטה כמו חיתוך סדרות בית הספר הישנות (lib/ops/school-series.js, planCut ב-lib/school-google.js): UNTIL = יום לפני ההפעלה, 23:59:59 בישראל.
// העבר נשמר, העתיד נעלם. לא מוחקים אף אירוע לעולם; PATCH של recurrence בלבד.
// הנחה, לא אומת (כמו ב-planCut): ש-PATCH של recurrence בלבד חותך את הסדרה ב-Google ומשאיר את מופעי העבר.
// איך נמצאת: כותרת בדיוק "ריצת בוקר" (אחרי trim), עם RRULE, בכל היומנים שמותר לכתוב בהם (owner / writer). 0 או יותר מ-1 = מדווחים ולא נוגעים.
// GET או POST. ברירת מחדל: dry (קריאה בלבד, מדווח מה ישתנה). apply=1: חותך. (המנהל קבע GET עם apply=1; school-series דורש POST, כאן לא.)
// התשובה: ספירה וסדרות שנמצאו, בשם "ריצת בוקר" בלבד: בלי מזהי יומן או אירוע, בלי שמות יומנים ובלי כותרות אחרות.
// הגנה: Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע (כמו lib/ops/school-series.js). אין Cron; יובל מריץ ידנית.
// probe_log: שורה אחת 'run-series-cut' עם ספירות וקודים בלבד.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { WATCHABLE_ROLES, googleConfigFromEnv, listSeriesEvents, patchCalendarEvent, shortReason } from '../google.js';
import { connect } from '../event-sync.js';
import { localDateIso } from '../intake-dates.js';
import { zonedToUtc } from '../schedule-time.js';
import { TIME_ZONE, planCut } from '../school-google.js';

export const OLD_RUN_SERIES = 'ריצת בוקר';

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
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('run-series-cut', ${ok}, ${detail})`;
    return true;
  } catch (error) {
    console.error('run-series-cut: כתיבה ל-probe_log נכשלה', error?.name);
    return false;
  }
}

const rruleOf = (event) => (event.recurrence ?? []).find((line) => line.startsWith('RRULE:')) ?? null;
const isOldRunSeries = (event) => typeof event?.summary === 'string' && event.summary.trim() === OLD_RUN_SERIES
  && Array.isArray(event.recurrence) && event.recurrence.some((line) => line.startsWith('RRULE:'));

export async function handle(request, { sql, secret = process.env.CRON_SECRET, config = googleConfigFromEnv(), fetchImpl = fetch, now = () => new Date() }) {
  if (request.method !== 'GET' && request.method !== 'POST') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');

  const mode = new URL(request.url).searchParams.get('apply') === '1' ? 'apply' : 'dry';
  const activationDate = localDateIso(now(), TIME_ZONE);
  const refused = [];
  let google = { ok: true, reason: null };
  let accessToken = null;
  const found = []; // [{ calendarId, event }]

  const connected = await connect({ sql, config, fetchFn: fetchImpl, label: 'run-series-cut' });
  if (!connected.ok) {
    google = { ok: false, reason: connected.reason };
  } else {
    ({ accessToken } = connected);
    const writable = connected.calendars.filter((c) => typeof c?.id === 'string' && WATCHABLE_ROLES.includes(c.accessRole));
    for (const calendar of writable) {
      const listed = await listSeriesEvents({
        accessToken, calendarId: calendar.id, timeMin: zonedToUtc(activationDate, '00:00', TIME_ZONE).toISOString(), fetchImpl,
      });
      if (!listed.ok) {
        google = { ok: false, reason: shortReason(`events_${listed.reason}`, listed.status) };
        break;
      }
      for (const event of listed.events) if (isOldRunSeries(event)) found.push({ calendarId: calendar.id, event });
    }
  }
  if (!google.ok) refused.push(google.reason ?? 'google_failed');
  else if (found.length === 0) refused.push('not_found');
  else if (found.length > 1) refused.push('ambiguous');

  const plans = found.map(({ calendarId, event }) => ({ calendarId, event, cut: planCut(event, activationDate) }));
  const summary = {
    mode,
    activation_date: activationDate,
    google,
    found: google.ok ? found.length : 0,
    series: plans.map(({ event, cut }) => ({
      title: OLD_RUN_SERIES, start: event.start?.dateTime ?? event.start?.date ?? null, rrule: rruleOf(event),
      ...(cut.action === 'cut' ? { action: 'cut', new_rrule: cut.recurrence.find((line) => line.startsWith('RRULE:')) } : { action: 'skip', reason: cut.reason }),
    })),
    refused,
  };
  if (!google.ok) summary.series = [];

  if (mode === 'dry' || refused.length > 0 || plans[0].cut.action !== 'cut') {
    const detail = `mode=${mode} found=${summary.found}${refused.length ? ` refused=${refused.join(',')}` : ''}${plans[0] && plans[0].cut.action !== 'cut' ? ` skip=${plans[0].cut.reason}` : ''}`;
    const logged = await logProbe(sql, refused.length === 0, detail);
    return reply(200, { ...summary, written: false, logged });
  }

  const [{ calendarId, event, cut }] = plans;
  const done = await patchCalendarEvent({ accessToken, calendarId, eventId: event.id, patch: { recurrence: cut.recurrence }, fetchFn: fetchImpl });
  const result = done.ok ? { cut: 1, failed: 0 } : { cut: 0, failed: 1, last_failure: shortReason(done.reason, done.status) };
  const logged = await logProbe(sql, done.ok, `mode=apply found=1 cut=${result.cut} failed=${result.failed}${result.last_failure ? ` last_failure=${result.last_failure}` : ''}`);
  return reply(200, { ...summary, written: done.ok, ok: done.ok, result, logged });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
