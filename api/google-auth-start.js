// תחילת חיבור ל-Google Calendar (שלב 5א). POST בלי גוף. מחזיר JSON { url } - כתובת דף ההסכמה של Google.
// לא מפנה ישירות: הדפדפן לא יכול לשלוח כותרת בניווט, ולכן האפליקציה קוראת כאן (עם הסוד) ואז עוברת ל-url.
// הגנה: אותו מנגנון כמו api/push-subscribe.js ו-api/intake.js - סוד בכותרת x-intake-secret מול INTAKE_SECRET.
// משתני סביבה (לעולם לא בקוד): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (אופציונלי), TOKEN_ENC_KEY, INTAKE_SECRET.
// ה-state נשמר במסד לעשר דקות ונצרך פעם אחת ב-api/google-auth-callback.js.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { buildConsentUrl, generateState, googleConfigFromEnv, missingConfig, saveState } from '../lib/google.js';

const SECRET_HEADER = 'x-intake-secret';
const SECRET_ENV_NAME = 'INTAKE_SECRET';

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

export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME], config = googleConfigFromEnv(), makeState = generateState }) {
  if (request.method !== 'POST') return reply(405, { reason: 'method_not_allowed', message: 'Method Not Allowed' });
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) return reply(401, { reason: 'unauthorized', message: 'Unauthorized' });

  // TOKEN_ENC_KEY נדרש כבר כאן: עדיף לגלות מפתח חסר לפני שיובל עובר את מסך ההסכמה ולא אחריו.
  const missing = missingConfig(config);
  if (missing.length > 0) {
    console.error('google-auth-start: משתני סביבה חסרים:', missing.join(','));
    return reply(500, { reason: 'config_missing', message: `חסרים משתני סביבה בשרת: ${missing.join(', ')}. מוסיפים ב-Vercel (Sensitive) ופורסים מחדש.` });
  }

  const state = makeState();
  try {
    await saveState(sql, state);
  } catch (error) {
    console.error('google-auth-start: שמירת state נכשלה', error?.name);
    return reply(500, { reason: 'db_error', message: 'לא הצלחתי לשמור את בקשת החיבור. ודא שהטבלאות של Google נוצרו במסד (db/schema.sql).' });
  }

  return reply(200, { url: buildConsentUrl({ clientId: config.clientId, redirectUri: config.redirectUri, state }) });
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
