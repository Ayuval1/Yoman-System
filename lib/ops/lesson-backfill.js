// משימת ops: קישור תמונות ישנות לשיעור (בלוק 8, "תביא לי"; lib/lesson-link.js backfillLessonLinks). /api/ops?task=lesson-backfill.
// ידנית בלבד (אין Cron). GET. ברירת מחדל dry: קורא וסופר כמה תמונות יקושרו, בלי לכתוב. apply=1: ממלא media.lesson_date / lesson_period
// רק היכן שעוד ריקים, ולא דורס מקצוע קיים (הרצה חוזרת בטוחה). עד BACKFILL_BATCH תמונות בכל הרצה; אם remaining > 0, מריצים שוב.
// הגנה: Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע (כמו lib/ops/run-series.js). התשובה וה-probe_log: ספירות בלבד, בלי מזהים ובלי מקצועות.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { backfillLessonLinks, BACKFILL_BATCH } from '../lesson-link.js';
import { loadTimetable } from '../timetable.js';

function reply(status, body) {
  const isText = typeof body === 'string';
  return new Response(isText ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function handle(request, { sql, secret = process.env.CRON_SECRET, timetable } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');
  const mode = new URL(request.url).searchParams.get('apply') === '1' ? 'apply' : 'dry';
  try {
    const table = timetable === undefined ? await loadTimetable(sql) : timetable;
    if (!table) {
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('lesson-backfill', ${false}, ${`mode=${mode}; no_timetable`})`.catch(() => {});
      return reply(200, { ok: false, mode, reason: 'no_timetable' });
    }
    const result = await backfillLessonLinks({ sql, timetable: table, apply: mode === 'apply' });
    const body = {
      ok: true,
      mode,
      scanned: result.scanned,
      ...(mode === 'apply' ? { linked: result.linked } : { would_link: result.wouldLink ?? 0 }),
      more_may_remain: result.scanned >= BACKFILL_BATCH,
    };
    try {
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('lesson-backfill', ${true}, ${`mode=${mode}; scanned=${result.scanned}; linked=${result.linked}; would_link=${result.wouldLink ?? 0}`})`;
    } catch (error) {
      console.error('lesson-backfill: כתיבה ל-probe_log נכשלה', error?.name);
    }
    return reply(200, body);
  } catch (error) {
    console.error('lesson-backfill: נכשל', error?.name);
    return reply(500, { ok: false, mode, reason: 'error' });
  }
}

export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
