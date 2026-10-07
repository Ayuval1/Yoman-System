// הוכחת הסקופ (שלב 5א): מרענן access token מהמסד וקורא את רשימת היומנים. קריאה בלבד. GET.
// מחזיר JSON { calendars: [{ id, summary, accessRole }] } - בלי tokens ובלי שום שדה אחר.
// הגנה: אותו מנגנון כמו api/push-subscribe.js - סוד בכותרת x-intake-secret מול INTAKE_SECRET.
// כלל (google-calendar-rules, החלטה 1): חיבור שנפל = הודעה מפורשת, לא שגיאה שקטה. כל כשל מחזיר { reason, message } בעברית,
// ונשמר ב-google_credentials.last_error (קוד קצר בלבד). reason: not_connected | config_missing | decrypt_failed |
// invalid_grant | refresh_failed | calendar_forbidden | calendar_failed.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { decryptToken, googleConfigFromEnv, listCalendars, missingConfig, parseEncKey, refreshAccessToken, shortReason } from '../lib/google.js';

const SECRET_HEADER = 'x-intake-secret';
const SECRET_ENV_NAME = 'INTAKE_SECRET';
const ACCOUNT = 'primary';

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

export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME], config = googleConfigFromEnv(), fetchImpl = fetch }) {
  if (request.method !== 'GET') return reply(405, { reason: 'method_not_allowed', message: 'Method Not Allowed' });
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });

  const missing = missingConfig(config);
  if (missing.length > 0) {
    console.error('google-calendars: משתני סביבה חסרים:', missing.join(','));
    return reply(500, { reason: 'config_missing', message: `חסרים משתני סביבה בשרת: ${missing.join(', ')}.` });
  }
  let key;
  try {
    key = parseEncKey(config.encKeyRaw);
  } catch (error) {
    console.error('google-calendars:', error.message);
    return reply(500, { reason: 'config_missing', message: 'מפתח ההצפנה בשרת לא תקין (TOKEN_ENC_KEY): base64 של 32 בתים.' });
  }

  // רושם שגיאה בשורה (קוד קצר בלבד). כשל ברישום לא מסתיר את השגיאה המקורית.
  async function recordError(code) {
    try {
      await sql`UPDATE google_credentials SET last_error = ${code} WHERE account = ${ACCOUNT}`;
    } catch (error) {
      console.error('google-calendars: רישום last_error נכשל', error?.name);
    }
  }

  let row;
  try {
    const rows = await sql`SELECT refresh_token_enc FROM google_credentials WHERE account = ${ACCOUNT}`;
    row = rows[0];
  } catch (error) {
    console.error('google-calendars: קריאת חיבור נכשלה', error?.name);
    return reply(500, { reason: 'db_error', message: 'לא הצלחתי לקרוא את החיבור מהמסד. ודא שהטבלאות של Google נוצרו (db/schema.sql).' });
  }
  if (!row) {
    return reply(409, { reason: 'not_connected', message: 'אין חיבור ל-Google. יש ללחוץ על "חבר Google" באפליקציה.' });
  }

  let refreshToken;
  try {
    refreshToken = decryptToken(row.refresh_token_enc, key);
  } catch {
    await recordError('decrypt_failed');
    return reply(500, { reason: 'decrypt_failed', message: 'לא הצלחתי לפענח את החיבור השמור (ייתכן ש-TOKEN_ENC_KEY הוחלף). יש לחבר Google מחדש.' });
  }

  const refreshed = await refreshAccessToken({ refreshToken, clientId: config.clientId, clientSecret: config.clientSecret, fetchImpl });
  if (!refreshed.ok) {
    console.error('google-calendars: רענון נכשל:', refreshed.reason, refreshed.status);
    await recordError(shortReason(refreshed.reason, refreshed.status));
    if (refreshed.reason === 'invalid_grant') {
      return reply(502, { reason: 'invalid_grant', message: 'החיבור ל-Google נפל (ההרשאה בוטלה או פגה). יש ללחוץ על "חבר Google" ולהתחבר מחדש.' });
    }
    return reply(502, { reason: 'refresh_failed', message: 'רענון הגישה ל-Google נכשל. החיבור לא אומת; ייתכן שזו תקלה זמנית.' });
  }
  try {
    await sql`UPDATE google_credentials SET last_refresh_at = now(), last_error = NULL WHERE account = ${ACCOUNT}`;
  } catch (error) {
    console.error('google-calendars: עדכון last_refresh_at נכשל', error?.name);
  }

  const listed = await listCalendars({ accessToken: refreshed.accessToken, fetchImpl });
  if (!listed.ok) {
    console.error('google-calendars: קריאת calendarList נכשלה:', listed.reason, listed.status);
    await recordError(shortReason(`calendarlist_${listed.reason}`, listed.status));
    if (listed.status === 401 || listed.status === 403) {
      return reply(502, { reason: 'calendar_forbidden', message: 'Google דחה את קריאת רשימת היומנים. ייתכן שהסקופ לא מספיק או שההרשאה בוטלה.' });
    }
    return reply(502, { reason: 'calendar_failed', message: 'קריאת רשימת היומנים מ-Google נכשלה.' });
  }

  return reply(200, { calendars: listed.calendars });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
