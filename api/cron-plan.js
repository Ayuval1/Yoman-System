// נקודת Cron מוגנת (שלב 1). מקור: docs/17 סעיפים 4 ו-7, build-rules 25, 33.
// התנהגות בשלב 1: שורה אחת ב-probe_log ותשובה 200. אין לוגיקת תכנון.
// Vercel שולח את CRON_SECRET בכותרת Authorization בפורמט "Bearer <סוד>" (vercel.com/docs/cron-jobs/manage-cron-jobs).
// Cron לא עוקב אחרי redirect - לכן הנקודה עונה ישירות ולא מפנה.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// handle מקבל את ה-DB והשעון מבחוץ כדי שאפשר לבדוק בלי מסד אמיתי.
export async function handle(request, { sql, secret = process.env.CRON_SECRET, now = () => new Date() }) {
  // Vercel מפעיל Cron ב-GET (vercel.com/docs/cron-jobs).
  if (request.method !== 'GET') {
    return reply(405, 'Method Not Allowed');
  }

  // נכשלים סגור: בלי CRON_SECRET בשרת, או בלי/עם Bearer שגוי - 401.
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return reply(401, 'Unauthorized');
  }

  const url = new URL(request.url);
  // הנחה, לא אומת: slot=1 / slot=2 בשאילתה. התיעוד לא מאשר במפורש ש-Vercel Cron מעביר query string בנתיב.
  // לכן נרשמת גם הכותרת x-vercel-cron-schedule (מתועדת) כדי שתמיד אפשר לדעת איזה Cron רץ.
  const slotParam = url.searchParams.get('slot');
  const slot = slotParam !== null && /^[0-9]{1,2}$/.test(slotParam) ? slotParam : 'unknown';
  const schedule = request.headers.get('x-vercel-cron-schedule') ?? 'none';
  const detail = `slot=${slot}; schedule=${schedule}; invoked_utc=${now().toISOString()}`;

  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('cron-plan', true, ${detail})`;
  } catch (error) {
    console.error('cron-plan: כתיבה ל-probe_log נכשלה:', error?.message);
    return reply(500, 'Internal Server Error');
  }

  return reply(200, 'OK');
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    // החיבור למסד נוצר רק כשצריך, כדי שדחייה של בקשה (401/405) לא תלויה ב-DATABASE_URL.
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
