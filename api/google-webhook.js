// קליטת התראות watch מ-Google Calendar (שלב 5ב). Google שולח POST בלי גוף; כל המידע בכותרות.
// אין סוד בכותרת (Google לא שולח כזה). ההגנה: X-Goog-Channel-ID חייב להיות ערוץ פעיל בטבלת google_watch_channels,
// ו-X-Goog-Channel-Token חייב לעבור אימות HMAC לאותו ערוץ (lib/google.js, בזמן קבוע).
// ערוץ לא מוכר - 404; token שגוי או חסר - 401; בלי פירוט בתשובה. לא קוראים אירועים ולא פונים ל-Google מכאן.
// כותבים רק מונים ומצב בשורת הערוץ, ושורה קצרה ב-probe_log (בלי מזהי יומן).
import { neon } from '@neondatabase/serverless';
import { cleanEnv, parseEncKey, verifyChannelToken } from '../lib/google.js';

const MAX_CHANNEL_ID = 200;
const KNOWN_STATES = ['sync', 'exists', 'not_exists'];

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function handle(request, { sql, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY) }) {
  if (request.method !== 'POST') return reply(405, 'Method Not Allowed');

  let key;
  try {
    key = parseEncKey(encKeyRaw);
  } catch (error) {
    console.error('google-webhook:', error.message); // ההודעה לא כוללת את ערך המפתח
    return reply(500, 'Internal Server Error');
  }

  const channelId = request.headers.get('x-goog-channel-id');
  if (typeof channelId !== 'string' || channelId.length === 0 || channelId.length > MAX_CHANNEL_ID) return reply(404, 'Not Found');

  let row;
  try {
    const rows = await sql`
      SELECT id, last_resource_state FROM google_watch_channels WHERE channel_id = ${channelId} AND stopped_at IS NULL
    `;
    row = rows[0];
  } catch (error) {
    console.error('google-webhook: קריאת ערוץ נכשלה', error?.name);
    return reply(500, 'Internal Server Error');
  }
  if (!row) return reply(404, 'Not Found');

  if (!verifyChannelToken(request.headers.get('x-goog-channel-token'), channelId, key)) return reply(401, 'Unauthorized');

  const rawState = request.headers.get('x-goog-resource-state');
  const state = KNOWN_STATES.includes(rawState) ? rawState : null;
  const parsedNumber = Number.parseInt(request.headers.get('x-goog-message-number') ?? '', 10);
  const messageNumber = Number.isSafeInteger(parsedNumber) && parsedNumber >= 0 && parsedNumber <= 2147483647 ? parsedNumber : null;

  try {
    await sql`
      UPDATE google_watch_channels
      SET last_notification_at = now(), last_resource_state = ${state}, last_message_number = ${messageNumber},
          notification_count = notification_count + 1
      WHERE id = ${row.id}
    `;
  } catch (error) {
    console.error('google-webhook: עדכון ערוץ נכשל', error?.name);
    return reply(500, 'Internal Server Error'); // Google ינסה שוב
  }

  // רושמים ב-probe_log רק sync, not_exists, וה-exists הראשון בערוץ (בלי ספאם). הערה: last_resource_state נקרא לפני העדכון.
  if (state !== null && (state !== 'exists' || row.last_resource_state !== 'exists')) {
    try {
      const detail = `state=${state} msg=${messageNumber ?? '?'} channel_row=${row.id}`;
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('google-watch', true, ${detail})`;
    } catch (error) {
      console.error('google-webhook: כתיבה ל-probe_log נכשלה:', error?.name);
    }
  }

  return reply(200, 'OK');
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
