// בלוק 5 חלק ב: שלוש משימות ops ל-Garmin (נקראות דרך api/ops.js; בלי קובץ חדש תחת api/, מגבלת הפונקציות של Hobby).
//  - garmin-connect (POST): קולט את סט הטוקנים מסקריפט הכניסה במחשב של יובל (lib/garmin-login-cli.js) ושומר אותו מוצפן. הסיסמה לא מגיעה לכאן.
//  - garmin-status (GET): connected / last_ok_at / last_error בלבד. בלי טוקנים.
//  - garmin-sync (GET, Cron יומי): מושך אימונים מתוכננים (היום עד +15) ואימונים שבוצעו (3 ימים אחרונים) ושומר ב-garmin_items.
//    קריאה בלבד מ-Garmin (פעולה 22, אוטונומי, 03-garmin-rules). בסוף משיכה מוצלחת בלבד: החלה על אימוני 4fitness (lib/garmin-apply.js).
//    כשל בהחלה לא מכשיל את המשיכה ולא משנה את התשובה; נרשם קוד בלבד.
//    ואחריה, גם כשהמשיכה נכשלה: ריצות שלישי ושישי (lib/weekly-runs.js).
// "שבירה אינה שקטה" (03-garmin-rules) ו"כל כשל -> הודעה, פעם אחת" (03-scheduling-rules, שלב 3): כל כשל של המשיכה כותב בועה, לכל היותר אחת ביום ישראלי.
//   Garmin דחה את החיבור (רענון נדחה, או 401 גם אחרי רענון אחד), או שהטוקן החדש לא נשמר (save_failed): "החיבור ל-Garmin נפל...".
//   כל כשל אחר (403 / 429 / רשת / מסד): "המשיכה מ-Garmin נכשלה היום...".
//   מצבי הקמה, בלי בועה: not_connected (עוד לא התחברו), table_missing (פקודת המסד לא רצה), config_missing (מפתח חסר). נרשמים ב-probe_log (ו-last_error כשאפשר).
//   ניסיון חוזר: אין, חוץ מחידוש טוקן אחד על 401 באמצע (lib/garmin.js pullItems) וניסיון שמירה שני של הטוקן (lib/garmin-store.js). אף פעם לא כניסה חוזרת.
// הגנה: כמו lib/ops/daily-check.js, Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע.
// אסור שייכנס לתשובה, ללוג או ל-probe_log: טוקנים, כותרות אימונים, מזהים. רק ספירות וקודים קצרים.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { cleanEnv, parseEncKey } from '../google.js';
import { isTokenSet, pullItems } from '../garmin.js';
import {
  getAccessToken, isMissingTable, loadCredentialRow, markError, markOk, notifyGarminDown, saveTokens, upsertItems,
} from '../garmin-store.js';
import { applyGarminItems, pushNow } from '../garmin-apply.js';
import { applyWeeklyRuns } from '../weekly-runs.js';
import { localDateIso } from '../intake-dates.js';

const BODY_MAX = 16384;

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

// null = מורשה; אחרת התשובה (401). נכשלים סגור כשאין CRON_SECRET.
function deny(request, secret) {
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  return secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`) ? null : reply(401, 'Unauthorized');
}

function keyFrom(encKeyRaw) {
  try {
    return parseEncKey(encKeyRaw ?? '');
  } catch {
    return null;
  }
}

const isoOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
};

// ---------------------------------------------------------------------------
// garmin-connect
// GET מוחזר 405 רק אחרי בדיקת הסוד, כדי שבקשה בלי סוד תקבל 401 כמו בשאר משימות ops (test/ops.test.js).
// ---------------------------------------------------------------------------
export async function connectHandle(request, { sql, secret = process.env.CRON_SECRET, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY) }) {
  if (request.method !== 'POST' && request.method !== 'GET') return reply(405, 'Method Not Allowed');
  const denied = deny(request, secret);
  if (denied) return denied;
  if (request.method !== 'POST') return reply(405, 'Method Not Allowed');

  const text = await request.text();
  if (text.length > BODY_MAX) return reply(400, { ok: false, reason: 'bad_body' });
  let tokens;
  try {
    tokens = JSON.parse(text);
  } catch {
    return reply(400, { ok: false, reason: 'bad_body' });
  }
  if (!isTokenSet(tokens)) return reply(400, { ok: false, reason: 'bad_body' });
  const key = keyFrom(encKeyRaw);
  if (!key) return reply(500, { ok: false, reason: 'config_missing' });

  try {
    await saveTokens(sql, key, tokens);
  } catch (error) {
    if (isMissingTable(error)) return reply(503, { ok: false, reason: 'table_missing' });
    console.error('garmin-connect: שמירה נכשלה', error?.name);
    return reply(500, { ok: false, reason: 'db_error' });
  }
  return reply(200, { ok: true, connected: true });
}

// ---------------------------------------------------------------------------
// garmin-status
// ---------------------------------------------------------------------------
export async function statusHandle(request, { sql, secret = process.env.CRON_SECRET, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY) }) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  const denied = deny(request, secret);
  if (denied) return denied;
  const configOk = keyFrom(encKeyRaw) !== null;
  let row;
  try {
    row = await loadCredentialRow(sql);
  } catch (error) {
    if (isMissingTable(error)) return reply(200, { ok: false, reason: 'table_missing' });
    console.error('garmin-status: קריאה נכשלה', error?.name);
    return reply(500, { ok: false, reason: 'db_error' });
  }
  if (!row) return reply(200, { ok: true, connected: false, config_ok: configOk });
  return reply(200, {
    ok: true, connected: true, config_ok: configOk,
    updated_at: isoOrNull(row.updated_at), last_ok_at: isoOrNull(row.last_ok_at), last_error: row.last_error ?? null,
  });
}

// ---------------------------------------------------------------------------
// garmin-sync
// ---------------------------------------------------------------------------
async function logProbe(sql, ok, detail) {
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('garmin-sync', ${ok}, ${detail})`;
    return true;
  } catch (error) {
    console.error('garmin-sync: כתיבה ל-probe_log נכשלה', error?.name);
    return false;
  }
}

async function safeMarkError(sql, code) {
  try {
    await markError(sql, code);
  } catch (error) {
    console.error('garmin-sync: רישום last_error נכשל', error?.name);
  }
}

// בועה שנכתבה בפועל (לא כשכבר נשלחה היום) -> דחיפה מיידית (pushNow, lib/garmin-apply.js): בלעדיה הבועה מ-Cron לא מגיעה להתראה.
async function safeBubble(sql, today, nowIso, auth, push) {
  try {
    const written = await notifyGarminDown(sql, { today, nowIso, auth });
    if (written) await push({ sql, now: new Date(nowIso), label: 'garmin-sync' });
    return written;
  } catch (error) {
    console.error('garmin-sync: בועת הכשל נכשלה', error?.name);
    return false;
  }
}

export async function syncHandle(request, {
  sql, secret = process.env.CRON_SECRET, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY), fetchImpl = fetch, now = () => new Date(),
  applyItems = applyGarminItems, push = pushNow, weekly = applyWeeklyRuns,
}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  const denied = deny(request, secret);
  if (denied) return denied;

  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const today = localDateIso(nowDate);
  // ריצות שלישי ושישי (lib/weekly-runs.js, 03-4fitness "כל הריצות בשבוע"): אחרי כל משיכה. fetchedAt = null כשהמשיכה נכשלה (גם לא מחובר / מצב הקמה):
  // אין פריט מ-Garmin = אין אימון ידוע, ולכן רק שואלים "יש ריצה?" ולא יוצרים. לא משנה את התשובה; כשל נרשם כקוד בלבד.
  const runWeekly = async (fetchedAt) => {
    try {
      const done = await weekly({ sql, now: nowDate, fetchedAt, push });
      if (!done?.ok) console.error('garmin-sync: ריצות השבוע נכשלו:', done?.reason ?? 'unknown');
    } catch (error) {
      console.error('garmin-sync: ריצות השבוע קרסו', error?.name);
    }
  };
  const finish = async (body) => {
    if (!body.ok) await runWeekly(null);
    const counts = body.planned === undefined ? '' : `planned=${body.planned} done=${body.done} stored=${body.stored}`;
    const detail = [counts, body.reason ? `reason=${body.reason}` : '', body.bubble ? 'bubble=true' : ''].filter(Boolean).join(' ');
    await logProbe(sql, body.ok, detail);
    return reply(200, body);
  };

  // מצבי הקמה (מפתח חסר, טבלה חסרה): last_error ו-probe_log, בלי בועה, כמו not_connected. אחרת בועה יומית הייתה מופיעה עוד לפני שפקודת המסד רצה.
  const key = keyFrom(encKeyRaw);
  if (!key) {
    await safeMarkError(sql, 'config_missing');
    return finish({ ok: false, reason: 'config_missing', bubble: false });
  }

  const access = await getAccessToken({ sql, key, fetchImpl, nowMs: nowDate.getTime() });
  if (!access.ok) {
    if (access.reason === 'not_connected' || access.reason === 'table_missing') return finish({ ok: false, reason: access.reason, bubble: false });
    await safeMarkError(sql, access.reason);
    return finish({ ok: false, reason: access.reason, bubble: await safeBubble(sql, today, nowIso, access.auth === true, push) });
  }

  // saveFailed: הטוקן החדש לא נשמר (גם אחרי ניסיון שני). ממשיכים במשיכה של היום, אבל מדווחים save_failed ובועת auth: מחר כנראה ייכשל.
  let saveFailed = access.saveFailed === true;
  const renewAccess = async () => {
    const renewal = await getAccessToken({ sql, key, fetchImpl, nowMs: now().getTime(), forceRefresh: true });
    if (renewal.saveFailed) saveFailed = true;
    return renewal;
  };
  const pulled = await pullItems({ accessToken: access.accessToken, fetchImpl, today, renewAccess });
  const planned = pulled.items.filter((item) => item.kind === 'planned').length;
  const done = pulled.items.length - planned;
  let stored;
  try {
    stored = await upsertItems(sql, pulled.items, nowIso);
  } catch (error) {
    const missing = isMissingTable(error);
    if (!missing) console.error('garmin-sync: שמירת הפריטים נכשלה', error?.name);
    const reason = saveFailed ? 'save_failed' : missing ? 'table_missing' : 'db_error';
    await safeMarkError(sql, [reason, missing && saveFailed ? 'table_missing' : ''].filter(Boolean).join(' '));
    // garmin_items חסרה = מצב הקמה, בלי בועה (אלא אם גם הטוקן לא נשמר).
    const bubble = missing && !saveFailed ? false : await safeBubble(sql, today, nowIso, pulled.auth || saveFailed, push);
    return finish({ ok: false, reason, planned, done, stored: 0, failures: pulled.failures, bubble });
  }

  if (saveFailed) {
    await safeMarkError(sql, ['save_failed', ...pulled.failures].join(' '));
    const bubble = await safeBubble(sql, today, nowIso, true, push);
    return finish({ ok: false, reason: 'save_failed', planned, done, stored, failures: pulled.failures, bubble });
  }
  if (pulled.ok) {
    try {
      await markOk(sql, nowIso);
    } catch (error) {
      console.error('garmin-sync: רישום last_ok_at נכשל', error?.name);
    }
    // fetchedAt = nowIso: אותו ערך ש-upsertItems כתב, וכך ההחלה יודעת אילו פריטים נמשכו עכשיו (ומה נמחק אצל המאמן).
    try {
      const applied = await applyItems({ sql, now: nowDate, fetchedAt: nowIso, push });
      if (!applied?.ok) console.error('garmin-sync: ההחלה על האימונים נכשלה:', applied?.reason ?? 'unknown');
    } catch (error) {
      console.error('garmin-sync: ההחלה על האימונים קרסה', error?.name);
    }
    await runWeekly(nowIso);
    return finish({ ok: true, planned, done, stored, failures: [], bubble: false });
  }
  await safeMarkError(sql, pulled.failures.join(' '));
  const bubble = await safeBubble(sql, today, nowIso, pulled.auth, push);
  return finish({ ok: false, reason: pulled.failures[0], planned, done, stored, failures: pulled.failures, bubble });
}

// החיבור למסד נוצר רק כשצריך, כדי שדחייה (401/405) לא תלויה ב-DATABASE_URL. הנחה, לא אומת: פורמט "export default { fetch }" (ראו api/intake.js).
const lazySql = () => (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
export const connectTask = { fetch: (request) => connectHandle(request, { sql: lazySql() }) };
export const statusTask = { fetch: (request) => statusHandle(request, { sql: lazySql() }) };
export const syncTask = { fetch: (request) => syncHandle(request, { sql: lazySql() }) };
export default syncTask;
