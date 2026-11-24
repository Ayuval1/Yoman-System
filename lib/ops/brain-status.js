// משימת ops לקריאה בלבד: איפה עומד המוח (24.11.2026, יובל: "אני לא מבין למה זה נתקע"). /api/ops?task=brain-status. GET, CRON_SECRET.
// מחזיר בעברית פשוטה ובמספרים בלבד (בלי טקסט הודעות ובלי מפתח):
//  - mode: 'passed' (יש מודל שעבר את השער ורץ), 'pilot' (אף מודל לא עבר, הפיילוט רץ), 'off' (אף מודל לא עבר והפיילוט כבוי).
//  - passed: המודלים שעברו (parsePool). models: לכל מודל השורה האחרונה של השער: ציון, כמה תשובות אמיתיות, תקלות, חסום/תקוע/נח.
//  - pilot_24h: ספירת תוצאות הפיילוט ב-24 השעות האחרונות לפי מודל (probe 'brain-pilot'). quota_blocks: מכסות שנגמרו ועוד בתוקף.
//  - brain_24h: כמה הודעות המוח הבין ב-24 השעות האחרונות, וכמה מהן הסכים עם הקוד (probe 'brain-intake').
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { parseGateRow, stuckUntil, PASS_THRESHOLD } from './gate-probe.js';
import { parsePool, parseQuotaRow } from '../brain/models.js';
import { pilotOn, PILOT_POOL } from '../brain/ask.js';

const DAY_MS = 86400000;
const rowsOf = (r) => (Array.isArray(r) ? r : []);
function reply(status, body) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body, null, 1), {
    status, headers: { 'content-type': `${typeof body === 'string' ? 'text/plain' : 'application/json'}; charset=utf-8`, 'cache-control': 'no-store' },
  });
}
function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function summarize({ gateRows, quotaRows, pilotRows, intakeRows, nowMs, env = process.env, hasKey = true }) {
  const now = new Date(nowMs);
  const passed = parsePool(gateRows, now).map(({ model, passed: p, total }) => `${model} (${p}/${total})`);
  const parsed = gateRows.map(parseGateRow).filter(Boolean);
  const byModel = new Map();
  for (const row of parsed) byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  const models = [...byModel.entries()].map(([model, rows]) => {
    const last = rows.sort((a, b) => b.at - a.at)[0];
    const stuck = stuckUntil(rows, nowMs);
    let state = 'בבדיקה';
    if (last.ok && last.total >= 20) state = 'עבר';
    else if (last.unavailable) state = 'לא קיים (404)';
    else if (stuck) state = `נח עד ${new Date(stuck).toISOString()} (תקלות טכניות)`;
    else if (last.noFreeQuota) state = 'בלי מכסה חינמית';
    else if (last.total >= 20 && last.passed + last.techIds.length + last.notRunIds.length < Math.ceil(PASS_THRESHOLD * last.total)) state = 'נכשל (פחות מ-18 נכונות)';
    return { model, state, score: `${last.passed}/${last.total}`, answered: last.ran, wrong: last.failedIds.length, technical: last.techIds.length, not_run: last.notRunIds.length, at: new Date(last.at).toISOString() };
  }).sort((a, b) => (a.state === 'עבר' ? -1 : b.state === 'עבר' ? 1 : a.model < b.model ? -1 : 1));
  const pilot24 = {};
  for (const row of pilotRows) {
    const m = /^model=([^;]+); outcome=(\S+)$/.exec(row.detail ?? '');
    if (!m) continue;
    pilot24[m[1]] = pilot24[m[1]] ?? {};
    pilot24[m[1]][m[2]] = (pilot24[m[1]][m[2]] ?? 0) + 1;
  }
  const quota = quotaRows.map(parseQuotaRow).filter((b) => b && b.until > now).map((b) => ({ model: b.model, kind: b.kind, until: b.until.toISOString() }));
  const intake = { understood: intakeRows.length, agreed_with_code: intakeRows.filter((r) => r.ok === true).length };
  const mode = passed.length > 0 ? 'passed' : pilotOn(env) ? 'pilot' : 'off';
  const why = !hasKey ? 'אין GEMINI_API_KEY בשרת: המוח לא רץ בכלל.'
    : mode === 'passed' ? `המוח רץ על מודל שעבר את המבחן: ${passed[0]}.`
      : mode === 'pilot' ? `אף מודל עוד לא עבר את המבחן (18 מ-20). המוח רץ בפיילוט על ${PILOT_POOL.map((p) => p.model).join(' ואז ')}.`
        : 'אף מודל לא עבר את המבחן והפיילוט כבוי: כל ההודעות מטופלות בקוד בלבד.';
  return { mode, why, passed, models, pilot_24h: pilot24, quota_blocks: quota, brain_24h: intake };
}

export async function handle(request, { sql, secret = process.env.CRON_SECRET, env = process.env, now = () => Date.now() } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  if (!secret) return reply(401, 'Unauthorized');
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');
  try {
    const nowMs = now();
    const since30 = new Date(nowMs - 30 * DAY_MS).toISOString();
    const since1 = new Date(nowMs - DAY_MS).toISOString();
    const since2 = new Date(nowMs - 2 * DAY_MS).toISOString();
    const gateRows = rowsOf(await sql`SELECT ok, detail, at FROM probe_log WHERE probe = 'gate-gemini' AND at > ${since30}::timestamptz ORDER BY at DESC LIMIT 500`);
    const quotaRows = rowsOf(await sql`SELECT detail, at FROM probe_log WHERE probe = 'brain-quota' AND at > ${since2}::timestamptz ORDER BY at DESC LIMIT 500`);
    const pilotRows = rowsOf(await sql`SELECT detail FROM probe_log WHERE probe = 'brain-pilot' AND at > ${since1}::timestamptz LIMIT 2000`);
    const intakeRows = rowsOf(await sql`SELECT ok FROM probe_log WHERE probe = 'brain-intake' AND at > ${since1}::timestamptz LIMIT 2000`);
    return reply(200, summarize({ gateRows, quotaRows, pilotRows, intakeRows, nowMs, env, hasKey: Boolean(env.GEMINI_API_KEY) }));
  } catch (error) {
    console.error('brain-status: נכשל', error?.name);
    return reply(500, 'Internal Server Error');
  }
}

export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
