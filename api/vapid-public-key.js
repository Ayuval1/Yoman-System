// מגיש את המפתח הציבורי של VAPID לדף (שלב 4ב). GET בלבד, טקסט רגיל.
// המפתח הציבורי אינו סוד (נועד להימסר לדפדפן ב-applicationServerKey). VAPID_PRIVATE_KEY אינו נקרא כאן בכלל.
// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
const KEY_ENV_NAME = 'VAPID_PUBLIC_KEY';

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

export async function handle(request, { env = process.env } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  const key = env[KEY_ENV_NAME];
  if (!key) {
    console.error(`${KEY_ENV_NAME} לא מוגדר בשרת`);
    return reply(500, 'מפתח VAPID ציבורי לא מוגדר בשרת.');
  }
  return reply(200, key);
}

export default {
  fetch(request) {
    return handle(request, { env: process.env });
  },
};
