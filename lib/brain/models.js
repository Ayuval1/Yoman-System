// רשת המודלים של המוח (בלוק 3א; docs/01-foundation/אפיון-מורחב.md, ה-5, ה-6 וסעיף 4 "המוח שנבחר").
// פונקציות טהורות: בלי מסד, בלי רשת, בלי AI. המעבר בין מודלים הוא קוד בלבד (ה-6).
//
// המצב יושב בטבלה קיימת, probe_log (בלי טבלה חדשה ובלי שינוי סכמה; הכרעת המנהל):
//  - רשימת המודלים שעברו = שורות probe='gate-gemini' (כותב אותן lib/ops/gate-probe.js). מודל ברשימה רק אם השורה האחרונה שלו
//    ב-30 הימים האחרונים היא ok=true, עם 20 משפטים לפחות וציון של 18 מתוך 20 ומעלה (PASS_THRESHOLD).
//  - מכסה שנגמרה = שורות probe='brain-quota' עם detail בצורה "model=X; kind=daily|minute|unknown; until=<ISO>". שורה פגומה = מתעלמים.
import { nextRunUtc } from '../schedule-time.js';
import { MODEL_NAME_PATTERN, PASS_THRESHOLD } from '../ops/gate-probe.js';

export const POOL_PROBE = 'gate-gemini';
export const QUOTA_PROBE = 'brain-quota';
export const POOL_WINDOW_DAYS = 30;
// מבחן 20 המשפטים (אפיון-מורחב סעיף 4): ריצה חלקית (למשל count=10) אינה "עבר את המבחן".
export const MIN_SENTENCES = 20;
export const QUOTA_KINDS = ['daily', 'minute', 'unknown'];
const DAY_MS = 86400000;
const MINUTE_MS = 60000;

const asDate = (value) => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const validModel = (name) => typeof name === 'string' && MODEL_NAME_PATTERN.test(name);

// שורה של gate-gemini -> { model, ok, passed, total, at } או null.
function parsePassRow(row) {
  if (!row || typeof row.detail !== 'string' || typeof row.ok !== 'boolean') return null;
  const at = asDate(row.at);
  const model = /(?:^|; )model=([^;|\s]+)/.exec(row.detail)?.[1];
  if (!at || !validModel(model)) return null;
  const score = /(?:^|; )(\d+)\/(\d+) ran=\d+/.exec(row.detail);
  return { model, ok: row.ok, passed: score ? Number(score[1]) : 0, total: score ? Number(score[2]) : 0, at };
}

// רשימת המודלים שמותר להשתמש בהם, מסודרת: ציון יורד (passed/total), ובשוויון לפי שם. דטרמיניסטי.
export function parsePool(rows, now) {
  const since = now.getTime() - POOL_WINDOW_DAYS * DAY_MS;
  const latest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const parsed = parsePassRow(row);
    if (!parsed || parsed.at.getTime() < since) continue;
    const current = latest.get(parsed.model);
    if (!current || parsed.at > current.at) latest.set(parsed.model, parsed);
  }
  const pool = [...latest.values()].filter((p) => p.ok && p.total >= MIN_SENTENCES && p.passed / p.total >= PASS_THRESHOLD);
  pool.sort((a, b) => b.passed / b.total - a.passed / a.total || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
  return pool.map(({ model, passed, total }) => ({ model, passed, total }));
}

// סוג המגבלה מתוך גוף שגיאת 429.
// הנחה, לא אומת: ש-Google כותבת בגוף quotaId עם "PerDay" או "PerMinute" (למשל GenerateRequestsPerDayPerProjectPerModel-FreeTier).
// לא נראתה תשובת 429 אמיתית בפרויקט. כשהגוף לא אומר במפורש: 'unknown', והכרטיס כותב "לא ידוע" ולא מנחש (אפיון-מורחב סעיף 4).
// שתיהן מופיעות: 'daily', כי היא הארוכה (מודל שנחסם ליום לא יחזור אחרי דקה).
export function classifyQuota(bodyText) {
  const text = typeof bodyText === 'string' ? bodyText : '';
  if (/PerDay/i.test(text)) return 'daily';
  if (/PerMinute/i.test(text)) return 'minute';
  return 'unknown';
}

// מתי המכסה חוזרת. יומית ולא ידוע: חצות הבאה בשעון פסיפיק (לפי מקור חיצוני שבאפיון-מורחב, לא אומת מול Google),
// מחושב ב-Intl דרך nextRunUtc ולא כהפרש קבוע, כי הפער מישראל משתנה בין מעברי השעון. לדקה: עוד 60 שניות.
export function resetAt(kind, now) {
  if (kind === 'minute') return new Date(now.getTime() + MINUTE_MS);
  return nextRunUtc({ hour: 0, minute: 0, timeZone: 'America/Los_Angeles', from: now });
}

export function quotaDetail({ model, kind, until }) {
  return `model=${model}; kind=${kind}; until=${until.toISOString()}`;
}

// שורה של brain-quota -> { model, kind, until } או null.
export function parseQuotaRow(row) {
  if (!row || typeof row.detail !== 'string') return null;
  const match = /^model=([^;\s]+); kind=([a-z]+); until=(\S+)$/.exec(row.detail);
  if (!match || !validModel(match[1]) || !QUOTA_KINDS.includes(match[2])) return null;
  const until = asDate(match[3]);
  return until ? { model: match[1], kind: match[2], until } : null;
}

// לכל מודל: החסימה המאוחרת שעדיין בתוקף ברגע now.
function activeBlocks(quotaRows, now) {
  const blocks = new Map();
  for (const row of Array.isArray(quotaRows) ? quotaRows : []) {
    const block = parseQuotaRow(row);
    if (!block || block.until <= now) continue;
    const current = blocks.get(block.model);
    if (!current || block.until > current.until) blocks.set(block.model, block);
  }
  return blocks;
}

// המודלים הפנויים, לפי הסדר של pool.
export function availableModels(pool, quotaRows, now) {
  const blocks = activeBlocks(quotaRows, now);
  return pool.filter((entry) => !blocks.has(entry.model));
}

// המודל הפנוי הראשון לפי הסדר, או null.
export function nextAvailable(pool, quotaRows, now) {
  return availableModels(pool, quotaRows, now)[0] ?? null;
}

// כל הרשימה נגמרה? null אם יש מודל פנוי או שהרשימה ריקה; אחרת { until, kind, model } של המודל שחוזר ראשון.
export function poolExhaustion(pool, quotaRows, now) {
  if (pool.length === 0) return null;
  const blocks = activeBlocks(quotaRows, now);
  if (pool.some((entry) => !blocks.has(entry.model))) return null;
  let first = null;
  for (const entry of pool) {
    const block = blocks.get(entry.model);
    if (!first || block.until < first.until) first = block;
  }
  return { until: first.until, kind: first.kind, model: first.model };
}
