// מגיש את המפתח הציבורי של VAPID לדף (שלב 4ב). GET בלבד, טקסט רגיל.
// הועבר ב-8.10.2026 מתיקיית api (שם היה vapid-public-key): Hobby מגביל ל-12 פונקציות בפריסה. הכתובת /api/vapid-public-key נשמרת ב-rewrites ומגיעה ל-api/push-subscribe.js (GET).
// המפתח הציבורי אינו סוד (נועד להימסר לדפדפן ב-applicationServerKey). VAPID_PRIVATE_KEY אינו נקרא כאן בכלל.
const KEY_ENV_NAME = 'VAPID_PUBLIC_KEY';

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function handleVapidKey(request, { env = process.env } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  // trim: ערך שהועתק מקובץ מגיע עם ירידת שורה; ריק אחרי ניקוי = חסר.
  const raw = env[KEY_ENV_NAME];
  const key = typeof raw === 'string' ? raw.trim() : raw;
  if (!key) {
    console.error(`${KEY_ENV_NAME} לא מוגדר בשרת`);
    return reply(500, 'מפתח VAPID ציבורי לא מוגדר בשרת.');
  }
  return reply(200, key);
}
