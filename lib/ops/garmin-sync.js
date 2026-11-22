// בלוק 5 חלק ב: שלוש משימות ops ל-Garmin (נקראות דרך api/ops.js; בלי קובץ חדש תחת api/, מגבלת הפונקציות של Hobby).
//  - garmin-connect (POST): קולט את סט הטוקנים מסקריפט הכניסה במחשב של יובל (lib/garmin-login-cli.js) ושומר אותו מוצפן. הסיסמה לא מגיעה לכאן.
//  - garmin-status (GET): connected / last_ok_at / last_error בלבד. בלי טוקנים.
//  - garmin-sync (GET, Cron יומי): מושך אימונים מתוכננים (היום עד +15) ואימונים שבוצעו (3 ימים אחרונים) ושומר ב-garmin_items.
//    לא נוגע ביומן ובאירועים (שלב מאוחר יותר, יחד עם 4fitness). קריאה בלבד מ-Garmin (פעולה 22, אוטונומי, 03-garmin-rules).
// "שבירה אינה שקטה" (03-garmin-rules): כש-Garmin דוחה את החיבור (רענון נדחה או 401) נכתבת בועה אחת ביום "החיבור ל-Garmin נפל...".
//   כשל אחר (403 / 429 / רשת) נרשם ב-last_error וב-probe_log, בלי בועה ובלי ניסיון חוזר.
// הגנה: כמו lib/ops/daily-check.js, Authorization: Bearer CRON_SECRET בהשוואה בזמן קבוע.
// אסור שייכנס לתשובה, ללוג או ל-probe_log: טוקנים, כותרות אימונים, מזהים. רק ספירות וקודים קצרים.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { cleanEnv, parseEncKey } from '../google.js';
import { isTokenSet, pullItems } from '../garmin.js';
import {
  getAccessToken, isMissingTable, loadCredentialRow, markError, markOk, notifyGarminDown, saveTokens, upsertItems,
} from '../garmin-store.js';
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
    await saveTokens(sql, key, tokens, { connect: true });
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

async function safeBubble(sql, today, nowIso) {
  try {
    return await notifyGarminDown(sql, { today, nowIso });
  } catch (error) {
    console.error('garmin-sync: בועת "החיבור נפל" נכשלה', error?.name);
    return false;
  }
}

export async function syncHandle(request, {
  sql, secret = process.env.CRON_SECRET, encKeyRaw = cleanEnv(process.env.TOKEN_ENC_KEY), fetchImpl = fetch, now = () => new Date(),
}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  const denied = deny(request, secret);
  if (denied) return denied;

  const nowDate = now();
  const nowIso = nowDate.toISOString();
  const today = localDateIso(nowDate);
  const finish = async (body) => {
    const counts = body.planned === undefined ? '' : `planned=${body.planned} done=${body.done} stored=${body.stored}`;
    const detail = [counts, body.reason ? `reason=${body.reason}` : '', body.bubble ? 'bubble=true' : ''].filter(Boolean).join(' ');
    await logProbe(sql, body.ok, detail);
    return reply(200, body);
  };

  const key = keyFrom(encKeyRaw);
  if (!key) return finish({ ok: false, reason: 'config_missing', bubble: false });

  const access = await getAccessToken({ sql, key, fetchImpl, nowMs: nowDate.getTime() });
  if (!access.ok) {
    if (access.reason === 'not_connected' || access.reason === 'table_missing') return finish({ ok: false, reason: access.reason, bubble: false });
    await safeMarkError(sql, access.reason);
    const bubble = access.auth ? await safeBubble(sql, today, nowIso) : false;
    return finish({ ok: false, reason: access.reason, bubble });
  }

  const pulled = await pullItems({ accessToken: access.accessToken, fetchImpl, today });
  const planned = pulled.items.filter((item) => item.kind === 'planned').length;
  const done = pulled.items.length - planned;
  let stored;
  try {
    stored = await upsertItems(sql, pulled.items, nowIso);
  } catch (error) {
    if (isMissingTable(error)) return finish({ ok: false, reason: 'table_missing', planned, done, stored: 0, failures: pulled.failures, bubble: false });
    console.error('garmin-sync: שמירת הפריטים נכשלה', error?.name);
    await safeMarkError(sql, 'db_error');
    return finish({ ok: false, reason: 'db_error', planned, done, stored: 0, failures: pulled.failures, bubble: false });
  }

  if (pulled.ok) {
    try {
      await markOk(sql, nowIso);
    } catch (error) {
      console.error('garmin-sync: רישום last_ok_at נכשל', error?.name);
    }
    return finish({ ok: true, planned, done, stored, failures: [], bubble: false });
  }
  await safeMarkError(sql, pulled.failures.join(' '));
  const bubble = pulled.auth ? await safeBubble(sql, today, nowIso) : false;
  return finish({ ok: false, reason: pulled.failures[0], planned, done, stored, failures: pulled.failures, bubble });
}

// החיבור למסד נוצר רק כשצריך, כדי שדחייה (401/405) לא תלויה ב-DATABASE_URL. הנחה, לא אומת: פורמט "export default { fetch }" (ראו api/intake.js).
const lazySql = () => (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
export const connectTask = { fetch: (request) => connectHandle(request, { sql: lazySql() }) };
export const statusTask = { fetch: (request) => statusHandle(request, { sql: lazySql() }) };
export const syncTask = { fetch: (request) => syncHandle(request, { sql: lazySql() }) };
export default syncTask;
