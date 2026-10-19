// נקודת Cron מוגנת (שלב 1). מקור: docs/17 סעיפים 4 ו-7, build-rules 25, 33.
// התנהגות: שורה אחת ב-probe_log ותשובה 200. מבלוק 3 (8.10.2026) גם מתזמנת: ל-slot=1 (בריף 07:30) ול-slot=2 (סגירה 21:00)
// שולחת לתור הודעה מושהית שמגיעה ברגע המדויק (lib/message-slots.js), כי Cron ב-Hobby לא מדויק מעבר לשעה.
// Vercel שולח את CRON_SECRET בכותרת Authorization בפורמט "Bearer <סוד>" (vercel.com/docs/cron-jobs/manage-cron-jobs).
// Cron לא עוקב אחרי redirect - לכן הנקודה עונה ישירות ולא מפנה.
// שלב 8.6-1: ב-slot=1 (01:00 UTC) מתוזמנת גם שאלת "היו שיעורי בית?" לכל רצף שיעורים של היום (לפי התאריך בישראל): הודעה מושהית נפרדת לכל רצף, 3 דקות אחרי סופו.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { planSlot, planHomework, SLOT_TOPIC, TIME_ZONE } from '../message-slots.js';
import { loadTimetable } from '../timetable.js';
import { localDateIso } from '../intake-dates.js';
import { sequencesForDate } from '../homework-schedule.js';

// מתג שאלות שיעורי הבית: היה כבוי עד ששלב 8.6-2 בנה את המסך (public/index.html: כרטיס השאלה ורשימת "פתוחות"); הודלק באותו שלב.
// כיבוי חירום: false (שאלות והתראות חדשות לא נשלחות; שאלות שכבר נוצרו נשארות עד שפגות). הבדיקות מזריקות homeworkEnabled ולא תלויות בערך הזה.
export const HOMEWORK_ASKS_ENABLED = true;

// נטען בעצלות: בדיקות לא יוצרות חיבור לתור, ודחייה של בקשה (401/405) לא תלויה בחבילה.
const realSend = async (...args) => (await import('@vercel/queue')).send(...args);

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// handle מקבל את ה-DB והשעון מבחוץ כדי שאפשר לבדוק בלי מסד אמיתי.
// timetable (אופציונלי, לבדיקות): מערכת שעות במקום טעינה מהמסד. נטענת רק ב-slot=1.
export async function handle(request, { sql, secret = process.env.CRON_SECRET, now = () => new Date(), send = realSend, timetable, homeworkEnabled = HOMEWORK_ASKS_ENABLED }) {
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
  const invokedAt = now();
  let detail = `slot=${slot}; schedule=${schedule}; invoked_utc=${invokedAt.toISOString()}`;
  let queueOk = true;

  // תזמון: רק ל-slot מוכר. מפתח אידמפוטנטיות לפי המשבצת, כך ש-Cron שנורה פעמיים לא יוצר שתי הודעות.
  const plan = planSlot(slot, invokedAt);
  if (plan) {
    try {
      await send(SLOT_TOPIC, { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, {
        delaySeconds: plan.delaySeconds, retentionSeconds: plan.retentionSeconds, idempotencyKey: plan.slotKey,
      });
      detail += `; queued=${plan.slotKey}; target_utc=${plan.targetAt}; delay_s=${plan.delaySeconds}`;
    } catch (error) {
      queueOk = false;
      console.error('cron-plan: שליחה לתור נכשלה:', error?.name);
      detail += `; queue_failed=${plan.slotKey}; error=${String(error?.name ?? 'unknown').slice(0, 60)}`;
    }
  }

  // שאלות שיעורי הבית של היום: רק ב-slot=1. כשל בטעינת מערכת השעות או בשליחה לתור נרשם ב-probe_log ומחזיר 500, כמו כשל בבריף.
  if (slot === '1' && homeworkEnabled) {
    const homework = await scheduleHomework({ sql, send, invokedAt, timetable });
    if (homework.detail) detail += homework.detail;
    if (!homework.ok) queueOk = false;
  }

  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('cron-plan', ${queueOk}, ${detail})`;
  } catch (error) {
    console.error('cron-plan: כתיבה ל-probe_log נכשלה:', error?.message);
    return reply(500, 'Internal Server Error');
  }

  return queueOk ? reply(200, 'OK') : reply(500, 'Internal Server Error');
}

// מתזמן הודעה מושהית אחת לכל רצף של התאריך המקומי של invokedAt. מחזיר { ok, detail }; detail ריק כשאין רצפים (שורת ה-probe_log נשארת כמו קודם).
// רצף שזמנו עבר לא נשלח (planHomework מחזיר null). בלי שם מקצוע בשום מקום: רק מפתחות ומספרים.
async function scheduleHomework({ sql, send, invokedAt, timetable }) {
  const table = timetable === undefined ? await loadTimetable(sql) : timetable; // loadTimetable לא זורק: כשל = null
  if (!table) return { ok: false, detail: '; homework_failed=no-timetable' };
  let sequences;
  try {
    sequences = sequencesForDate(table, localDateIso(invokedAt, TIME_ZONE));
  } catch (error) {
    console.error('cron-plan: חישוב רצפי שיעורי הבית נכשל:', error?.name);
    return { ok: false, detail: '; homework_failed=compute' };
  }
  let queued = 0;
  let failed = 0;
  for (const sequence of sequences) {
    const plan = planHomework({ slotKey: sequence.slotKey, targetAt: sequence.askAt }, invokedAt);
    if (!plan) continue;
    try {
      await send(SLOT_TOPIC, { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, {
        delaySeconds: plan.delaySeconds, retentionSeconds: plan.retentionSeconds, idempotencyKey: plan.slotKey,
      });
      queued += 1;
    } catch (error) {
      failed += 1;
      console.error('cron-plan: שליחת שאלת שיעורי בית לתור נכשלה:', error?.name);
    }
  }
  const detail = queued + failed > 0 ? `; homework_queued=${queued}${failed > 0 ? `; homework_failed=${failed}` : ''}` : '';
  return { ok: failed === 0, detail };
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
export default {
  fetch(request) {
    // החיבור למסד נוצר רק כשצריך, כדי שדחייה של בקשה (401/405) לא תלויה ב-DATABASE_URL.
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
