// פתיחת ערוצי watch לכל יומן שיובל בעלים או כותב בו (שלב 5ב). POST בלי גוף. כתיבה: רק הרשמה ל-Google ושורות ב-google_watch_channels.
// לא קורא אירועים. יומנים לקריאה בלבד (חגים וכו') מדולגים: accessRole שאינו owner או writer.
// הגנה: אותו מנגנון כמו api/google-calendars.js - סוד בכותרת x-intake-secret מול INTAKE_SECRET.
// פרטיות: התשובה לא מכילה שמות, מזהים או סיכומי יומנים - רק מספר סידורי (index) לכל יומן, וספירות. אף token או סוד לא מוחזרים.
// אידמפוטנטי: יומן שכבר יש לו ערוץ פעיל (לא נעצר, תפוגה ריקה או עתידית) מדולג ומדווח "already_active". כשל ביומן אחד לא עוצר את האחרים.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import {
  WATCH_ADDRESS, decryptToken, deriveChannelToken, googleConfigFromEnv, listCalendars, missingConfig, parseEncKey,
  refreshAccessToken, shortReason, watchCalendarEvents,
} from '../lib/google.js';

const SECRET_HEADER = 'x-intake-secret';
const SECRET_ENV_NAME = 'INTAKE_SECRET';
const ACCOUNT = 'primary';
const WATCHABLE_ROLES = ['owner', 'writer'];

function reply(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handle(request, {
  sql, secret = process.env[SECRET_ENV_NAME], config = googleConfigFromEnv(), fetchImpl = fetch,
  makeChannelId = randomUUID, address = WATCH_ADDRESS,
}) {
  if (request.method !== 'POST') return reply(405, { reason: 'method_not_allowed', message: 'Method Not Allowed' });
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });

  const missing = missingConfig(config);
  if (missing.length > 0) {
    console.error('google-watch-start: משתני סביבה חסרים:', missing.join(','));
    return reply(500, { reason: 'config_missing', message: `חסרים משתני סביבה בשרת: ${missing.join(', ')}.` });
  }
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch (error) {
    console.error('google-watch-start:', error.message);
    return reply(500, { reason: 'config_missing', message: 'מפתח ההצפנה בשרת לא תקין (TOKEN_ENC_KEY): base64 של 32 בתים.' });
  }

  let row;
  try {
    const rows = await sql`SELECT refresh_token_enc FROM google_credentials WHERE account = ${ACCOUNT}`;
    row = rows[0];
  } catch (error) {
    console.error('google-watch-start: קריאת חיבור נכשלה', error?.name);
    return reply(500, { reason: 'db_error', message: 'לא הצלחתי לקרוא את החיבור מהמסד. ודא שהטבלאות של Google נוצרו (db/schema.sql).' });
  }
  if (!row) {
    return reply(409, { reason: 'not_connected', message: 'אין חיבור ל-Google. יש ללחוץ על "חבר Google" באפליקציה.' });
  }

  let refreshToken;
  try {
    refreshToken = decryptToken(row.refresh_token_enc, key);
  } catch {
    return reply(500, { reason: 'decrypt_failed', message: 'לא הצלחתי לפענח את החיבור השמור (ייתכן ש-TOKEN_ENC_KEY הוחלף). יש לחבר Google מחדש.' });
  }

  const refreshed = await refreshAccessToken({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl });
  if (!refreshed.ok) {
    console.error('google-watch-start: רענון נכשל:', refreshed.reason, refreshed.status);
    if (refreshed.reason === 'invalid_grant') {
      return reply(502, { reason: 'invalid_grant', message: 'החיבור ל-Google נפל (ההרשאה בוטלה או פגה). יש ללחוץ על "חבר Google" ולהתחבר מחדש.' });
    }
    return reply(502, { reason: 'refresh_failed', message: 'רענון הגישה ל-Google נכשל. החיבור לא אומת; ייתכן שזו תקלה זמנית.' });
  }

  const listed = await listCalendars({ accessToken: refreshed.accessToken, fetchImpl });
  if (!listed.ok) {
    console.error('google-watch-start: קריאת calendarList נכשלה:', listed.reason, listed.status);
    if (listed.status === 401 || listed.status === 403) {
      return reply(502, { reason: 'calendar_forbidden', message: 'Google דחה את קריאת רשימת היומנים. ייתכן שהסקופ לא מספיק או שההרשאה בוטלה.' });
    }
    return reply(502, { reason: 'calendar_failed', message: 'קריאת רשימת היומנים מ-Google נכשלה.' });
  }

  const watchable = listed.calendars.filter((calendar) => typeof calendar.id === 'string' && WATCHABLE_ROLES.includes(calendar.accessRole));
  const summary = { total_calendars: listed.calendars.length, skipped_read_only: listed.calendars.length - watchable.length, created: 0, already_active: 0, failed: 0 };
  const results = [];

  for (const [index, calendar] of watchable.entries()) {
    try {
      const active = await sql`
        SELECT id FROM google_watch_channels
        WHERE calendar_id = ${calendar.id} AND stopped_at IS NULL AND (expiration IS NULL OR expiration > now())
        LIMIT 1
      `;
      if (active.length > 0) {
        summary.already_active += 1;
        results.push({ index, ok: true, status: 'already_active' });
        continue;
      }

      const channelId = makeChannelId();
      const watched = await watchCalendarEvents({
        accessToken: refreshed.accessToken, calendarId: calendar.id, channelId, token: deriveChannelToken(channelId, key), address, fetchFn: fetchImpl,
      });
      if (!watched.ok) {
        console.error('google-watch-start: watch נכשל:', watched.reason, watched.status);
        summary.failed += 1;
        results.push({ index, ok: false, reason: shortReason(watched.reason, watched.status) });
        continue;
      }

      // תפוגה מופרכת (ענקית) גורמת ל-toISOString לזרוק RangeError. הערוץ כבר נפתח אצל Google, אז לא זורקים:
      // שומרים NULL (כמו "Google לא החזיר תפוגה") ומסמנים בתשובה ובלוג שהתפוגה לא שמישה.
      let expirationIso = null;
      let expirationUnusable = false;
      if (watched.expiration !== null) {
        const expirationDate = new Date(watched.expiration);
        if (Number.isNaN(expirationDate.getTime())) {
          expirationUnusable = true;
          console.error('google-watch-start: תפוגה לא שמישה מ-Google, נשמר NULL');
        } else {
          expirationIso = expirationDate.toISOString();
        }
      }
      try {
        await sql`
          INSERT INTO google_watch_channels (calendar_id, channel_id, resource_id, expiration)
          VALUES (${calendar.id}, ${channelId}, ${watched.resourceId}, ${expirationIso})
        `;
      } catch (error) {
        // הערוץ נפתח אצל Google אבל לא נשמר: ההתראות שלו ייענו 404 עד שיפוג. מדווחים ככשל.
        console.error('google-watch-start: שמירת ערוץ נכשלה', error?.name);
        summary.failed += 1;
        results.push({ index, ok: false, reason: 'db_insert_failed' });
        continue;
      }
      summary.created += 1;
      results.push({ index, ok: true, status: 'created', expiration: expirationIso, ...(expirationUnusable ? { expiration_unusable: true } : {}) });
    } catch (error) {
      console.error('google-watch-start: טיפול ביומן נכשל', error?.name);
      summary.failed += 1;
      results.push({ index, ok: false, reason: 'unexpected_error' });
    }
  }

  return reply(200, { ...summary, results });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
