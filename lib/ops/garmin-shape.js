// משימת ops לאבחון בלבד: /api/ops?task=garmin-shape. GET, קריאה בלבד מ-Garmin.
// למה: ב-23.11.2026 כל 14 האימונים המתוכננים ב-garmin_items הגיעו עם duration_sec = NULL, ויובל מאשר שבאפליקציית Garmin לכל אימון יש אורך.
// כלומר שמות השדות שהפענוח קורא (lib/garmin.js) כנראה שגויים, והם מעולם לא אומתו מול Garmin חי. המשימה הזאת מראה את הצורה בלבד, כדי שנראה איפה האורך יושב.
// מה נקרא (באותם נתיבים ש-pullItems משתמש בהם):
//   א. calendar-service לחודש הנוכחי (שעון ישראל)
//   ב. workoutScheduleByPeriod מהיום עד +15
//   ג. /workout-service/workout/{workoutId} לאימון הראשון בלוח השנה שיש לו workoutId (הנתיב הזה לא אומת: הנחה, לא אומת)
// מה מוחזר: צורה בלבד. לכל תשובה: ok/סיבה/סטטוס, מפתחות ברמה העליונה (אובייקט) או אורך (מערך). לעד 3 אימונים מכל אחת מא' וב', ולתשובה ג':
//   רשימה ממוינת של שמות מפתחות (נתיבים עם נקודות, עד עומק 3, מערך = []), וערכים רק של שדות שהם מספר או בוליאני ושהנתיב שלהם מתאים ל-/dur|time|sec|distance|estimated/i.
//   אף ערך מחרוזת לא יוצא: לא כותרות, לא שמות, לא תיאורים, לא מזהים. גם שמות המפתחות עוברים סינון (אותיות, ספרות וקו תחתון בלבד), כדי שמפתח שהוא נתון (תאריך, מזהה) לא יזלוג.
// סכום משכי השלבים באימון (ג'): לא מחושב. הנחה, לא אומת: איזה שדה הוא תנאי הסיום (זמן/מרחק/לחיצה) ואיך חוזרות (repeat) סופרות. חישוב כזה הוא ניחוש; מחליטים אחרי שרואים את הצורה.
// עצירה: 429/427 (blocked) עוצר מיד ומדווח. אין כניסה חוזרת לעולם. מותר רענון טוקן (כמו garmin-sync) ובמקרה 401 רענון אחד ושליחה חוזרת של אותה קריאה.
// הגנה: Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע (כמו lib/ops/run-series.js). probe_log: שורה אחת 'garmin-shape', ספירות וקודים בלבד.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { cleanEnv, parseEncKey } from '../google.js';
import { PLANNED_DAYS_AHEAD, garminGet } from '../garmin.js';
import { getAccessToken } from '../garmin-store.js';
import { addDays, localDateIso } from '../intake-dates.js';

export const SHAPE_MAX_DEPTH = 3;
export const SHAPE_MAX_ITEMS = 3;
const VALUE_PATH = /dur|time|sec|distance|estimated|endCondition|value|step|repeat|iteration/i; // הורחב לבקשת המנהל: כדי לראות תנאי סיום וחזרות. עדיין מספר/בוליאני בלבד.
const SAFE_KEY = /^[A-Za-z0-9_]{1,40}$/;
// ערך מספרי לא יוצא אם המפתח האחרון בנתיב נראה כמו מזהה או זמן (stepId, workoutId, updateDate, createdTimestamp...), או אם הוא מחוץ ל-0..604800 (אותו גבול כמו secondsOf ב-lib/garmin.js). בוליאני תמיד מותר.
const ID_OR_TIME_KEY = /(id|pk|uuid|date|timestamp|gmt|local)$/i;
const VALUE_MAX = 604800;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ARRAY_SAMPLE = 5; // כמה איברים בכל מערך עוברים במיזוג המפתחות
const KEYS_MAX = 300;

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

const safeKey = (key) => (SAFE_KEY.test(key) && !/\d{4}/.test(key) ? key : '*'); // מפתח עם 4 ספרות רצופות או יותר (מזהה/תאריך כמפתח) = *
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// עומק = מספר המפתחות בנתיב; "[]" לא נספר כרמה. ערכי מחרוזת לא נקראים בכלל.
export function shapeOf(value) {
  const keys = new Set();
  const values = {};
  const walk = (node, path, depth) => {
    if (Array.isArray(node)) {
      for (const element of node.slice(0, ARRAY_SAMPLE)) walk(element, `${path}[]`, depth);
      return;
    }
    if (isPlain(node)) {
      if (depth >= SHAPE_MAX_DEPTH) return;
      for (const [rawKey, child] of Object.entries(node)) {
        const childPath = path ? `${path}.${safeKey(rawKey)}` : safeKey(rawKey);
        keys.add(childPath);
        walk(child, childPath, depth + 1);
      }
      return;
    }
    if ((typeof node === 'number' && Number.isFinite(node)) || typeof node === 'boolean') {
      const lastKey = path.replace(/\[\]$/, '').split('.').pop();
      const inRange = typeof node === 'boolean' || (node >= 0 && node <= VALUE_MAX);
      if (path && VALUE_PATH.test(path) && !ID_OR_TIME_KEY.test(lastKey) && inRange && !(path in values)) values[path] = node;
    }
  };
  walk(value, '', 0);
  return { keys: [...keys].sort().slice(0, KEYS_MAX), values };
}

// צורת התשובה כולה: מפתחות עליונים (אובייקט) או אורך (מערך).
function topLevel(body) {
  if (Array.isArray(body)) return { type: 'array', length: body.length };
  if (isPlain(body)) return { type: 'object', keys: Object.keys(body).map(safeKey).sort().slice(0, KEYS_MAX) };
  return { type: typeof body };
}

const status = (result) => ({ ok: result.ok === true, ...(result.ok ? {} : { reason: result.reason, status: result.status ?? null }) });

// ---------------------------------------------------------------------------
// הפרדת הפריטים מהתשובות. אותה גמישות כמו בפענוח ב-lib/garmin.js (הנחה, לא אומת: המבנה המדויק לא ידוע).
// ---------------------------------------------------------------------------
const calendarWorkouts = (body) => (Array.isArray(body?.calendarItems) ? body.calendarItems.filter((item) => item?.itemType === 'workout') : []);
const scheduleList = (body) => (Array.isArray(body) ? body : (isPlain(body) ? Object.values(body).find(Array.isArray) ?? [] : []));

export async function shapeHandle(request, {
  sql, secret = process.env.CRON_SECRET, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY), fetchImpl = fetch, now = () => new Date(),
}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');

  const logProbe = async (ok, detail) => {
    try {
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('garmin-shape', ${ok}, ${detail})`;
    } catch (error) {
      console.error('garmin-shape: כתיבה ל-probe_log נכשלה', error?.name);
    }
  };
  const finish = async (body, detail) => {
    await logProbe(body.ok === true, detail);
    return reply(200, body);
  };

  let key;
  try {
    key = parseEncKey(encKeyRaw ?? '');
  } catch {
    return finish({ ok: false, reason: 'config_missing' }, 'reason=config_missing');
  }
  const nowDate = now();
  const nowMs = nowDate.getTime();
  const access = await getAccessToken({ sql, key, fetchImpl, nowMs });
  if (!access.ok) return finish({ ok: false, reason: access.reason }, `reason=${access.reason}`);

  let token = access.accessToken;
  let renewed = false;
  let blocked = false;
  // קריאה אחת; על 401 ראשון: רענון אחד (לא כניסה) ושליחה חוזרת. 429/427 מסמן blocked והקוראים עוצרים.
  const get = async (path) => {
    let result = await garminGet({ path, accessToken: token, fetchImpl });
    if (!result.ok && result.status === 401 && !renewed) {
      renewed = true;
      const renewal = await getAccessToken({ sql, key, fetchImpl, nowMs, forceRefresh: true });
      if (renewal.ok) {
        token = renewal.accessToken;
        result = await garminGet({ path, accessToken: token, fetchImpl });
      }
    }
    if (!result.ok && result.reason === 'blocked') blocked = true;
    return result;
  };

  const today = localDateIso(nowDate);
  const [year, month] = today.split('-').map(Number);
  const plannedTo = addDays(today, PLANNED_DAYS_AHEAD);
  const report = { ok: true, blocked: false, calendar: null, schedule: null, workout: null };
  let counts = '';

  const describeList = (result, pick) => {
    if (!result.ok) return status(result);
    const picked = pick(result.body).slice(0, SHAPE_MAX_ITEMS);
    return { ...status(result), top_level: topLevel(result.body), items: picked.map(shapeOf) };
  };

  const calendar = await get(`/calendar-service/year/${year}/month/${month - 1}`);
  report.calendar = describeList(calendar, calendarWorkouts);
  if (!blocked) {
    const schedule = await get(`/workout-service/schedule/workoutScheduleByPeriod?${new URLSearchParams({ startDate: today, endDate: plannedTo })}`);
    report.schedule = describeList(schedule, scheduleList);
  }
  if (!blocked && calendar.ok) {
    const first = calendarWorkouts(calendar.body).find((item) => {
      const id = item.workoutId;
      return (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && SAFE_ID.test(id));
    });
    if (first) {
      const detail = await get(`/workout-service/workout/${encodeURIComponent(String(first.workoutId))}`);
      report.workout = detail.ok ? { ...status(detail), top_level: topLevel(detail.body), shape: shapeOf(detail.body) } : status(detail);
    } else {
      report.workout = { ok: false, reason: 'no_workout_id' };
    }
  }

  report.blocked = blocked;
  report.ok = !blocked && [report.calendar, report.schedule].every((part) => part?.ok);
  const part = (name, value) => `${name}=${value === null ? 'skipped' : value.ok ? `ok` : value.reason}`;
  counts = [
    part('calendar', report.calendar), `calendar_items=${report.calendar?.items?.length ?? 0}`,
    part('schedule', report.schedule), `schedule_items=${report.schedule?.items?.length ?? 0}`,
    part('workout', report.workout), `workout_keys=${report.workout?.shape?.keys?.length ?? 0}`,
    blocked ? 'blocked=true' : '',
  ].filter(Boolean).join(' ');
  return finish(report, counts);
}

const lazySql = () => (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
export const shapeTask = { fetch: (request) => shapeHandle(request, { sql: lazySql() }) };
export default shapeTask;
