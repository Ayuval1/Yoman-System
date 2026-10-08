// רישום מנוי דחיפה (שלב 4א). POST JSON: { endpoint, keys: { p256dh, auth } } (הצורה של PushSubscription.toJSON()).
// הגנה: אותו מנגנון כמו api/intake.js - סוד בכותרת x-intake-secret מול INTAKE_SECRET.
// הנחה, לא אומת: שהאפליקציה (שלב 4ב) תשלח את הסוד הזה. סוד בקוד של דף ווב גלוי למי שפותח את הדף; ההכרעה בשלב 4ב.
// מפתחות המנוי וה-endpoint לא נרשמים בלוגים ולא חוזרים בתשובה.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { validateSubscription } from '../lib/push.js';
import { handleVapidKey } from '../lib/vapid-public-key.js';

const SECRET_HEADER = 'x-intake-secret';
const SECRET_ENV_NAME = 'INTAKE_SECRET';
const MAX_BODY_CHARS = 4096;

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME], env = process.env }) {
  // GET מגיש את המפתח הציבורי (לא סוד). אוחד לכאן מקובץ vapid-public-key הישן שהיה ב-api בגלל מגבלת 12 הפונקציות ב-Hobby;
  // הכתובת הישנה /api/vapid-public-key מופנית לכאן ב-vercel.json (rewrites).
  if (request.method === 'GET') return handleVapidKey(request, { env });
  if (request.method !== 'POST') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) return reply(401, 'Unauthorized');

  let parsed;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return reply(400, 'הבקשה גדולה מדי.');
    parsed = JSON.parse(text);
  } catch {
    return reply(400, 'גוף הבקשה אינו JSON תקין.');
  }

  const check = validateSubscription(parsed);
  if (!check.ok) return reply(400, check.reason);
  const { endpoint, p256dh, auth } = check.subscription;

  try {
    // מנוי קיים (אותו endpoint) מתעדכן וחוזר להיות active. אין מחיקה.
    await sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth, status)
      VALUES (${endpoint}, ${p256dh}, ${auth}, 'active')
      ON CONFLICT (endpoint) DO UPDATE
        SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, status = 'active', retry_after = NULL
    `;
  } catch (error) {
    // לא רושמים את ההודעה: עלולה לכלול את ערכי הבקשה.
    console.error('push-subscribe: שמירה נכשלה', error?.name);
    return reply(500, 'Internal Server Error');
  }
  return reply(200, 'נרשם');
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
