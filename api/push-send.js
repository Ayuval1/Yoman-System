// שליחת דחיפה לכל המנויים הפעילים (שלב 4א). POST JSON: { title, body?, navigate, app_badge?, dedupe_key? }.
// הגנה: CRON_SECRET בכותרת Authorization "Bearer <סוד>", כמו lib/ops/cron-plan.js ו-lib/ops/gate-probe.js.
// משתני סביבה (לעולם לא בקוד): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: או https:). חסר - 500 ולא שולחים.
// כללים: build-rules 27-29 (docs/17:55-57). 429 - נשמר retry_after והמנוי לא נוסה שוב בריצה; 410 - status='gone_410' בלי מחיקה;
// dedupe_key - אותו מפתח לאותו מנוי לא נשלח פעמיים (טבלת push_sends); כל קריאה נרשמת ב-call_log (בלי endpoint, מפתחות או תוכן).
// שגיאת רשת או 5xx: נרשמים, בלי ניסיון חוזר.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { buildPayload, createSender, safeError, parseRetryAfterSeconds } from '../lib/push.js';

const MAX_BODY_CHARS = 4096;
const MAX_DEDUPE_KEY = 200;

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// מסיר רווחים וירידות שורה בתחילת/סוף הערך (ערך שהועתק מקובץ מגיע עם ירידת שורה). ריק אחרי ניקוי = חסר.
function cleanEnv(value) {
  return typeof value === 'string' ? value.trim() : value;
}

function vapidConfigFromEnv() {
  return {
    subject: cleanEnv(process.env.VAPID_SUBJECT),
    publicKey: cleanEnv(process.env.VAPID_PUBLIC_KEY),
    privateKey: cleanEnv(process.env.VAPID_PRIVATE_KEY),
  };
}

// handle מקבל DB, שולח, שעון וסוד מבחוץ כדי שאפשר לבדוק בלי מסד ובלי רשת.
export async function handle(request, {
  sql,
  secret = process.env.CRON_SECRET,
  vapid = vapidConfigFromEnv(),
  makeSender = createSender,
  now = () => new Date(),
}) {
  if (request.method !== 'POST') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');

  const missing = ['subject', 'publicKey', 'privateKey'].filter((k) => !vapid?.[k]);
  if (missing.length > 0) {
    console.error('משתני VAPID חסרים בשרת');
    return reply(500, 'משתני VAPID חסרים בשרת (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT). מוסיפים ב-Vercel (Sensitive) ופורסים מחדש.');
  }

  let input;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return reply(400, 'הבקשה גדולה מדי.');
    input = JSON.parse(text);
  } catch {
    return reply(400, 'גוף הבקשה אינו JSON תקין.');
  }
  if (input === null || typeof input !== 'object') return reply(400, 'גוף הבקשה אינו אובייקט.');

  const payload = buildPayload(input, { origin: new URL(request.url).origin });
  if (!payload.ok) return reply(400, payload.reason);

  let dedupeKey = null;
  if (input.dedupe_key !== undefined && input.dedupe_key !== null) {
    if (typeof input.dedupe_key !== 'string' || input.dedupe_key.length === 0 || input.dedupe_key.length > MAX_DEDUPE_KEY) {
      return reply(400, `dedupe_key חייב להיות טקסט עד ${MAX_DEDUPE_KEY} תווים.`);
    }
    dedupeKey = input.dedupe_key;
  }

  let subscriptions;
  try {
    subscriptions = await sql`
      SELECT id, endpoint, p256dh, auth, retry_after FROM push_subscriptions WHERE status = 'active'
    `;
  } catch (error) {
    console.error('push-send: קריאת מנויים נכשלה:', error?.message);
    return reply(500, 'Internal Server Error');
  }

  const sender = makeSender({ subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey });
  const counts = { sent: 0, skipped: 0, rate_limited: 0, gone: 0, failed: 0 };

  for (const sub of subscriptions) {
    // 429 קודם למכשיר הזה: עדיין בהמתנה - לא שולחים.
    if (sub.retry_after && new Date(sub.retry_after).getTime() > now().getTime()) {
      counts.skipped += 1;
      continue;
    }

    // dedupe: תופסים את (מנוי, מפתח) לפני השליחה. אם כבר קיים - מדלגים.
    let claimed = false;
    if (dedupeKey !== null) {
      try {
        const rows = await sql`
          INSERT INTO push_sends (subscription_id, dedupe_key) VALUES (${sub.id}, ${dedupeKey})
          ON CONFLICT (subscription_id, dedupe_key) DO NOTHING RETURNING id
        `;
        if (rows.length === 0) {
          counts.skipped += 1;
          continue;
        }
        claimed = true;
      } catch (error) {
        // בלי יכולת לאמת כפילות - לא שולחים (עדיף לא לשלוח פעמיים).
        console.error('push-send: dedupe נכשל:', error?.name);
        counts.failed += 1;
        continue;
      }
    }

    const startedAt = Date.now();
    const result = await sender.send(sub, payload.json);
    const error = result.error === null ? null : safeError(result.error, [sub.endpoint, sub.p256dh, sub.auth, vapid.privateKey]);
    const status = result.status;
    const isOk = status !== null && status >= 200 && status < 300;

    // כתיבות המצב. כשל כאן לא מפיל את הריצה, אבל נספר בלוג.
    try {
      if (isOk) {
        counts.sent += 1;
        await sql`
          UPDATE push_subscriptions SET last_sent_at = now(), last_status = ${status}, vapid_jwt_issued_at = ${result.jwtIssuedAt.toISOString()}
          WHERE id = ${sub.id}
        `;
        if (claimed) await sql`UPDATE push_sends SET status_code = ${status} WHERE subscription_id = ${sub.id} AND dedupe_key = ${dedupeKey}`;
      } else if (status === 410) {
        counts.gone += 1;
        await sql`UPDATE push_subscriptions SET status = 'gone_410', last_status = 410 WHERE id = ${sub.id}`;
      } else if (status === 429) {
        counts.rate_limited += 1;
        const seconds = parseRetryAfterSeconds(result.headers?.['retry-after'], now().getTime());
        const retryAt = new Date(now().getTime() + seconds * 1000).toISOString();
        await sql`UPDATE push_subscriptions SET last_status = 429, retry_after = ${retryAt} WHERE id = ${sub.id}`;
      } else {
        counts.failed += 1;
        await sql`UPDATE push_subscriptions SET last_status = ${status} WHERE id = ${sub.id}`;
      }
      // 410 ו-429: ההודעה בוודאות לא נמסרה, אז משחררים את המפתח הייחודי כדי שניסיון מאוחר עם אותו מפתח יעבוד.
      // משחררים בלי למחוק (build-rules 31): השורה נשארת כיומן, ורק המפתח משתנה.
      // רשת/5xx: לא ברור אם נמסר - התפיסה נשארת (עדיף לא לשלוח פעמיים).
      if (claimed && (status === 410 || status === 429)) {
        await sql`UPDATE push_sends SET dedupe_key = dedupe_key || ':released:' || id::text, status_code = ${status} WHERE subscription_id = ${sub.id} AND dedupe_key = ${dedupeKey}`;
      }
    } catch (writeError) {
      console.error('push-send: עדכון מצב נכשל:', writeError?.name);
    }

    try {
      await sql`
        INSERT INTO call_log (kind, status_code, ok, started_at, duration_ms, error)
        VALUES ('push', ${status}, ${isOk}, now(), ${Date.now() - startedAt}, ${error})
      `;
    } catch (logError) {
      console.error('push-send: כתיבה ל-call_log נכשלה:', logError?.name);
    }
  }

  return reply(200, `נשלחו: ${counts.sent}; דולגו: ${counts.skipped}; 429: ${counts.rate_limited}; 410: ${counts.gone}; נכשלו: ${counts.failed}`);
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
