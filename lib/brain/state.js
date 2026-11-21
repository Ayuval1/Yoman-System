// קריאת מצב המוח מהמסד (בלוק 3א): רשימת המודלים שעברו ומכסות שנגמרו, משורות probe_log קיימות (lib/brain/models.js).
// וגם נתוני כרטיס "נגמרה מכסת ה-AI" (אפיון-מורחב סעיף 4) לצ'אט ולהתראה. בלי רשת ובלי AI.
import { localParts } from '../schedule-time.js';
import { parsePool, poolExhaustion, POOL_WINDOW_DAYS } from './models.js';

const DAY_MS = 86400000;
// שורת מכסה חיה לכל היותר עד חצות פסיפיק הבאה (פחות מיממה וקצת). יומיים = מרווח.
const QUOTA_LOOKBACK_DAYS = 2;
// הנחה, לא אומת: תקרה. ה-Cron של gate-probe כותב 4 שורות ביום, 120 ב-30 יום.
const MAX_ROWS = 500;
const rowsOf = (result) => (Array.isArray(result) ? result : []);

// { pool, quotaRows }. כשל מסד נזרק.
export async function loadBrainState(sql, now) {
  const poolSince = new Date(now.getTime() - POOL_WINDOW_DAYS * DAY_MS).toISOString();
  const quotaSince = new Date(now.getTime() - QUOTA_LOOKBACK_DAYS * DAY_MS).toISOString();
  const passRows = rowsOf(await sql`
    SELECT ok, detail, at FROM probe_log
    WHERE probe = 'gate-gemini' AND at > ${poolSince}::timestamptz
    ORDER BY at DESC LIMIT ${MAX_ROWS}::int
  `);
  const quotaRows = rowsOf(await sql`
    SELECT detail, at FROM probe_log
    WHERE probe = 'brain-quota' AND at > ${quotaSince}::timestamptz
    ORDER BY at DESC LIMIT ${MAX_ROWS}::int
  `);
  return { pool: parsePool(passRows, now), quotaRows };
}

export const KIND_LABELS = {
  daily: 'יומית (בקשות ביום)',
  minute: 'לדקה (בקשות בדקה)',
  unknown: 'לא ידוע איזו מגבלה',
};

const pad = (n) => String(n).padStart(2, '0');

// "היום ב-10:00" / "מחר ב-10:00" / "ב-23.11 ב-10:00", בשעון ישראל.
export function returnsLabel(until, now) {
  const at = localParts(until, 'Asia/Jerusalem');
  const today = localParts(now, 'Asia/Jerusalem');
  const time = `${pad(at.hour)}:${pad(at.minute)}`;
  const dayIndex = (p) => Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
  const diff = dayIndex(at) - dayIndex(today);
  if (diff === 0) return `היום ב-${time}`;
  if (diff === 1) return `מחר ב-${time}`;
  return `ב-${at.day}.${at.month} ב-${time}`;
}

// { until, kind, model } -> שדות הכרטיס. pure.
export function quotaCardFields(exhaustion, now) {
  return {
    until: exhaustion.until.toISOString(),
    kind: exhaustion.kind,
    model: exhaustion.model,
    kind_label: KIND_LABELS[exhaustion.kind] ?? KIND_LABELS.unknown,
    returns_label: returnsLabel(exhaustion.until, now),
  };
}

// הכרטיס לצ'אט: null כשיש מודל פנוי, כשהרשימה ריקה, או בכל כשל (לא שובר את הצ'אט; בלוג רק שם השגיאה).
export async function loadQuotaCard(sql, now) {
  try {
    const { pool, quotaRows } = await loadBrainState(sql, now);
    const exhaustion = poolExhaustion(pool, quotaRows, now);
    return exhaustion ? quotaCardFields(exhaustion, now) : null;
  } catch (error) {
    console.error('brain: טעינת מצב המכסה נכשלה:', error?.name);
    return null;
  }
}
