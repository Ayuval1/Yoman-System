// משימת ops לקריאה בלבד: בודקת על המוח האמיתי את השדה duration_text במשפטים קבועים. /api/ops?task=brain-duration-check. GET, CRON_SECRET.
// כ-6 קריאות למוח ממכסת החינם. אין כתיבה למסד מעבר למה ש-askBrain רושם בעצמו. הלוג בלי טקסט המשפטים.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { understandSource } from '../intake-brain.js';
import { findDuration, durationMinutes } from '../intake-questions.js';

const CANDIDATES = [{ key: 'e1', label: 'שיננית · מחר · 16:00' }, { key: 'e2', label: 'אימון · חמישי · 17:00' }];
export const CASES = [
  ['מחר בשיננית אני מגיע 15 דקות קודם', null],
  ['מחר בשיננית אני מגיע חמש עשרה דקות קודם', null],
  ['הנסיעה לאימון בחמישי לוקחת 40 דקות', null],
  ['השיננית מחר לוקחת חצי שעה', 'חצי שעה'],
  ['האימון בחמישי נמשך שעה וחצי', 'שעה וחצי'],
  ['בעוד שעה יש לי שיננית', null],
];

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
const minutesOf = (text) => (text == null ? null : (findDuration(text) ?? durationMinutes(text)));

export function judge(expected, got) {
  if (expected === null) return got === null;
  if (got === null) return false;
  return String(got).trim() === expected || (minutesOf(got) !== null && minutesOf(got) === minutesOf(expected));
}

export async function handle(request, { sql, secret = process.env.CRON_SECRET, understand = understandSource } = {}) {
  if (request.method !== 'GET') return reply(405, 'Method Not Allowed');
  if (!secret) return reply(401, 'Unauthorized');
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) return reply(401, 'Unauthorized');
  try {
    const cases = [];
    for (const [index, [text, expected]] of CASES.entries()) {
      const result = await understand({ sql, source: { raw_content: text }, candidates: CANDIDATES });
      const got = result?.understanding?.duration_text ?? null;
      cases.push({ case: index, text, expected, got, minutes: minutesOf(got), model: result?.model ?? null, ok: Boolean(result?.ok), reason: result?.reason ?? null, pass: Boolean(result?.ok) && judge(expected, got) });
    }
    return reply(200, { ok: true, passed: cases.filter((c) => c.pass).length, total: cases.length, cases });
  } catch (error) {
    console.error('brain-duration-check: נכשל', error?.name);
    return reply(500, 'Internal Server Error');
  }
}

export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
