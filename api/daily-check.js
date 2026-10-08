// בדיקת בריאות יומית (טיוטה, לא מוזגה). בלי Claude/Gemini, ובלי קריאת אירועים. בדיקות token ו-watch הן קריאה בלבד.
// כתיבה ל-Google: רק חידוש ערוצי watch שעומדים לפוג (שלב 5ג, lib/watch-renew.js) - ורק כשיש כאלה; אחרת אפס קריאות להרשמה.
// כותב שלוש שורות ל-probe_log ביום: 'google-token-daily', 'google-watch-daily' ו-'google-watch-renew-daily'.
// מטרה: להפיק אוטומטית את הראיה "יום 8 / יום 15" של חיבור Google (open-items, "Google In production") בלי בדיקה ידנית.
// הגנה: זהה ל-api/cron-plan.js - Authorization: Bearer CRON_SECRET (Vercel Cron שולח אותו לבד), השוואה בזמן קבוע.
// אסור שייכנס לפלט או ל-probe_log: שמות/מזהי יומנים, tokens, סודות. רק מספרים וקודי סיבה קצרים.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import {
  decryptToken, googleConfigFromEnv, listCalendars, missingConfig, parseEncKey, refreshAccessToken, shortReason,
} from '../lib/google.js';
import { renewExpiringChannels } from '../lib/watch-renew.js';

const ACCOUNT = 'primary';
const DAY_MS = 24 * 60 * 60 * 1000;

function reply(status, body) {
  const isText = typeof body === 'string';
  return new Response(isText ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// בדיקה א: בריאות ה-token של Google. מחזיר { ok, reason?, days, calendars, detail }.
async function checkGoogleToken({ sql, config, fetchImpl, nowMs }) {
  const fail = (reason, days = null) => ({
    ok: false, reason, days, calendars: null,
    detail: `reason=${reason}${days === null ? '' : ` days_since_connected=${days}`}`,
  });

  const missing = missingConfig(config);
  if (missing.length > 0) return fail('config_missing'); // שמות המשתנים לא נכנסים לתשובה
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch {
    return fail('config_missing');
  }

  let row;
  try {
    // obtained_at = רגע ההסכמה/החיבור (מתאפס בחיבור מחדש, ראו api/google-auth-callback.js) - זה "יום 0" של אימות ה-In production.
    const rows = await sql`SELECT refresh_token_enc, obtained_at FROM google_credentials WHERE account = ${ACCOUNT}`;
    row = rows[0];
  } catch (error) {
    console.error('daily-check: קריאת חיבור נכשלה', error?.name);
    return fail('db_error');
  }
  if (!row) return fail('not_connected');

  const obtainedMs = toMs(row.obtained_at);
  const days = obtainedMs === null ? null : Math.max(0, Math.floor((nowMs - obtainedMs) / DAY_MS));

  let refreshToken;
  try {
    refreshToken = decryptToken(row.refresh_token_enc, key);
  } catch {
    return fail('decrypt_failed', days);
  }

  const refreshed = await refreshAccessToken({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl });
  if (!refreshed.ok) {
    console.error('daily-check: רענון נכשל:', refreshed.reason, refreshed.status);
    return fail(shortReason(refreshed.reason, refreshed.status), days); // למשל invalid_grant (400)
  }

  const listed = await listCalendars({ accessToken: refreshed.accessToken, fetchImpl });
  if (!listed.ok) {
    console.error('daily-check: calendarList נכשל:', listed.reason, listed.status);
    return fail(shortReason(`calendarlist_${listed.reason}`, listed.status), days);
  }

  // רק מספר היומנים. לא שמות ולא מזהים.
  const count = listed.calendars.length;
  return { ok: true, days, calendars: count, detail: `days_since_connected=${days} calendars=${count}` };
}

// בדיקה ב: בריאות ערוצי ה-watch. רישום בלבד - בלי חידוש ובלי קריאה ל-Google.
// הנחה, לא אומת: "ערוץ פעיל" = stopped_at IS NULL (גם ערוץ שפג אך לא נעצר נספר; הדקות אז שליליות וה-flag יוצא true).
// הנחה, לא אומת: notification_count הכולל נסכם על הערוצים הפעילים בלבד, לא על ההיסטוריה.
async function checkWatch({ sql, nowMs }) {
  const rows = await sql`
    SELECT count(*)::int AS active, min(expiration) AS earliest_expiration,
           max(last_notification_at) AS last_notification_at, coalesce(sum(notification_count), 0)::int AS total_notifications
    FROM google_watch_channels WHERE stopped_at IS NULL
  `;
  const row = rows[0] ?? {};
  const active = Number(row.active ?? 0);
  const earliestMs = toMs(row.earliest_expiration);
  const lastMs = toMs(row.last_notification_at);
  const total = Number(row.total_notifications ?? 0);

  const minutesToExpiry = earliestMs === null ? null : Math.floor((earliestMs - nowMs) / 60000);
  const hoursSinceNotification = lastMs === null ? null : Math.floor((nowMs - lastMs) / 3600000);
  const expiringWithin24h = earliestMs !== null && earliestMs - nowMs <= DAY_MS;

  const detail = `active=${active} minutes_to_expiry=${minutesToExpiry ?? 'none'} hours_since_notification=${hoursSinceNotification ?? 'none'}`
    + ` notification_count=${total} expiring_within_24h=${expiringWithin24h}`;
  return {
    ok: true, active, minutes_to_expiry: minutesToExpiry, hours_since_notification: hoursSinceNotification,
    notification_count: total, expiring_within_24h: expiringWithin24h, detail,
  };
}

// כותב שורה אחת ל-probe_log. כשל בכתיבה לא עוצר כלום, רק מסומן בתשובה.
async function logProbe(sql, probe, ok, detail) {
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES (${probe}, ${ok}, ${detail})`;
    return true;
  } catch (error) {
    console.error('daily-check: כתיבה ל-probe_log נכשלה:', probe, error?.name);
    return false;
  }
}

// handle מקבל DB, config, fetch ושעון מבחוץ כדי שאפשר לבדוק בלי מסד ובלי רשת.
export async function handle(request, {
  sql, secret = process.env.CRON_SECRET, config = googleConfigFromEnv(), fetchImpl = fetch, now = () => new Date(), makeChannelId = randomUUID,
}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  // נכשלים סגור, בדיוק כמו cron-plan.
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');

  const nowMs = now().getTime();

  // כל בדיקה נעטפת: חריגה בלתי צפויה באחת לא עוצרת את השנייה.
  let token;
  try {
    token = await checkGoogleToken({ sql, config, fetchImpl, nowMs });
  } catch (error) {
    console.error('daily-check: בדיקת token קרסה', error?.name);
    token = { ok: false, reason: 'check_crashed', days: null, calendars: null, detail: 'reason=check_crashed' };
  }
  let watch;
  try {
    watch = await checkWatch({ sql, nowMs });
  } catch (error) {
    console.error('daily-check: בדיקת watch קרסה', error?.name);
    watch = { ok: false, reason: 'check_failed', detail: 'reason=check_failed' };
  }
  // חידוש ערוצים אחרי שתי הבדיקות (הן מדווחות את המצב שלפני החידוש). חריגה לא עוצרת כלום.
  let renew;
  try {
    const renewed = await renewExpiringChannels({ sql, config, fetchImpl, nowMs, makeChannelId });
    renew = { ok: renewed.failed === 0, ...renewed };
  } catch (error) {
    console.error('daily-check: חידוש ערוצים קרס', error?.name);
    renew = { ok: false, renewed: 0, failed: 0, skipped: 0, reason: 'check_crashed' };
  }
  const renewDetail = `renewed=${renew.renewed} failed=${renew.failed} skipped=${renew.skipped}${renew.reason ? ` reason=${renew.reason}` : ''}`;

  const tokenLogged = await logProbe(sql, 'google-token-daily', token.ok, token.detail);
  const watchLogged = await logProbe(sql, 'google-watch-daily', watch.ok, watch.detail);
  const renewLogged = await logProbe(sql, 'google-watch-renew-daily', renew.ok, renewDetail);

  const { detail: _tokenDetail, ...tokenOut } = token;
  const { detail: _watchDetail, ...watchOut } = watch;
  return reply(200, {
    checked_at: now().toISOString(),
    google_token: { ...tokenOut, logged: tokenLogged },
    google_watch: { ...watchOut, logged: watchLogged },
    google_watch_renew: { ...renew, logged: renewLogged },
  });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    // החיבור למסד נוצר רק כשצריך, כדי שדחייה (401/405) לא תלויה ב-DATABASE_URL.
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
