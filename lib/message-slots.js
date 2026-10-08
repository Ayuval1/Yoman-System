// משבצות ההודעה הקבועות (בריף 07:30, סגירה 21:00 לפי שעון ישראל) ותכנון שליחתן לתור.
// מקור: docs/02-rules/03-app-channel-rules.md שורה 183 (07:30 ו-21:00), ו-docs/01-foundation/05-open-questions.md (תזמון, 8.10.2026).
// למה כך: ב-Hobby ה-Cron רץ בכל רגע בתוך השעה שצוינה, לכן ה-Cron רק *מתזמן*: שולח לתור הודעה מושהית שמגיעה ברגע המדויק.
// הנחה, לא אומת: דיוק ההגעה אחרי השהיה ארוכה (נמדד פעם אחת, השהיה של 120 שניות: איחור 0.8 שניות; לא נמדד על שעות).
import { nextRunUtc, localParts } from './schedule-time.js';

export const SLOT_TOPIC = 'daily-slots';
export const TIME_ZONE = 'Asia/Jerusalem';

// slot בכתובת ה-Cron (?slot=1 / ?slot=2) -> איזו משבצת.
export const SLOTS = {
  1: { kind: 'brief', hour: 7, minute: 30 },
  2: { kind: 'close', hour: 21, minute: 0 },
};

const MAX_RETENTION_SECONDS = 604800; // מקסימום של התור: 7 ימים

const pad = (n) => String(n).padStart(2, '0');

// מחזיר { kind, slotKey, targetAt, delaySeconds, retentionSeconds } למשבצת, או null אם ה-slot לא מוכר.
// slotKey כולל את התאריך המקומי של היעד, ולכן ריצה כפולה של אותו Cron נותנת אותו מפתח (אידמפוטנטיות).
export function planSlot(slot, now = new Date()) {
  const config = SLOTS[slot];
  if (!config) return null;
  const target = nextRunUtc({ hour: config.hour, minute: config.minute, timeZone: TIME_ZONE, from: now });
  const local = localParts(target, TIME_ZONE);
  const delaySeconds = Math.max(0, Math.round((target.getTime() - now.getTime()) / 1000));
  return {
    kind: config.kind,
    slotKey: `${config.kind}-${local.year}-${pad(local.month)}-${pad(local.day)}`,
    targetAt: target.toISOString(),
    delaySeconds,
    // ההודעה חייבת לחיות יותר מההשהיה, אחרת תפוג לפני שתהפוך לגלויה ולא תימסר לעולם (תיעוד התור).
    retentionSeconds: Math.min(MAX_RETENTION_SECONDS, delaySeconds + 86400),
  };
}

const SLOT_KEY_PATTERN = /^(brief|close)-\d{4}-\d{2}-\d{2}$/;

// בודק הודעה שהגיעה מהתור. מחזיר { ok: true, kind, slotKey, targetAt } או { ok: false, reason }.
export function parseSlotMessage(message) {
  if (message === null || typeof message !== 'object') return { ok: false, reason: 'not-object' };
  const { kind, slotKey, targetAt } = message;
  if (typeof slotKey !== 'string' || !SLOT_KEY_PATTERN.test(slotKey)) return { ok: false, reason: 'bad-slot-key' };
  if (kind !== slotKey.split('-')[0]) return { ok: false, reason: 'kind-mismatch' };
  const target = new Date(targetAt);
  if (typeof targetAt !== 'string' || Number.isNaN(target.getTime())) return { ok: false, reason: 'bad-target' };
  return { ok: true, kind, slotKey, targetAt: target.toISOString() };
}
