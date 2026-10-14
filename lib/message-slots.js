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

// התראה מאוגדת של הצ'אט (שלב 8.2א-3; docs/08-chapter8/47 "8.2א-3", 35 D5). חלון קבוע של 30 שניות לפי epoch (במפרט 120; קוצר ב-14.10.2026 בהכרעת יובל):
// כל הודעה בחלון מצטרפת להודעת תור אחת (אותו slotKey), וההשהיה עד סוף החלון ועוד 5 שניות,
// כך שאף הודעה לא מגיעה אחרי המסירה של חלונה (הודעה שנקלטת אחריה נופלת לחלון הבא).
// הנחה, לא אומת: הגעת התור בדיוק ברגע היעד (נמדד פעם אחת, השהיה של 120 שניות; H21 ב-35).
export const NOTIFY_WINDOW_SECONDS = 30; // 14.10.2026: קוצר מ-120 (יובל, "ב": התראה תוך עד כחצי דקה, ועדיין אגוד של הודעות ברצף)
export const NOTIFY_GRACE_SECONDS = 5;

// תחילת החלון (שניות epoch) שבו נמצא הרגע הנתון.
const notifyWindowStart = (ms) => Math.floor(Math.floor(ms / 1000) / NOTIFY_WINDOW_SECONDS) * NOTIFY_WINDOW_SECONDS;
// היעד של חלון: סוף החלון ועוד NOTIFY_GRACE_SECONDS, ב-ISO.
const notifyTargetIso = (windowStartSeconds) => new Date((windowStartSeconds + NOTIFY_WINDOW_SECONDS + NOTIFY_GRACE_SECONDS) * 1000).toISOString();

// מחזיר { kind: 'notify', slotKey, targetAt, delaySeconds, retentionSeconds } לחלון שבו נמצא now.
export function planNotify(now = new Date()) {
  const windowStart = notifyWindowStart(now.getTime());
  const targetAt = notifyTargetIso(windowStart);
  // עיגול כלפי מעלה: ההודעה לא תגיע לפני סוף החלון.
  const delaySeconds = Math.max(0, Math.ceil((Date.parse(targetAt) - now.getTime()) / 1000));
  return {
    kind: 'notify',
    slotKey: `notify-${windowStart}`,
    targetAt,
    delaySeconds,
    retentionSeconds: Math.min(MAX_RETENTION_SECONDS, delaySeconds + 86400),
  };
}

const SLOT_KEY_PATTERN = /^(?:(?:brief|close)-\d{4}-\d{2}-\d{2}|notify-\d{9,12})$/;

// בודק הודעה שהגיעה מהתור. מחזיר { ok: true, kind, slotKey, targetAt } או { ok: false, reason }.
export function parseSlotMessage(message) {
  if (message === null || typeof message !== 'object') return { ok: false, reason: 'not-object' };
  const { kind, slotKey, targetAt } = message;
  if (typeof slotKey !== 'string' || !SLOT_KEY_PATTERN.test(slotKey)) return { ok: false, reason: 'bad-slot-key' };
  if (kind !== slotKey.split('-')[0]) return { ok: false, reason: 'kind-mismatch' };
  const target = new Date(targetAt);
  if (typeof targetAt !== 'string' || Number.isNaN(target.getTime())) return { ok: false, reason: 'bad-target' };
  // התראה: היעד חייב להתאים לחלון שבמפתח (תחילת החלון + אורך החלון + 5 שניות), אחרת ההודעה לא נוצרה אצלנו.
  if (kind === 'notify' && target.toISOString() !== notifyTargetIso(Number(slotKey.slice('notify-'.length)))) {
    return { ok: false, reason: 'bad-target' };
  }
  return { ok: true, kind, slotKey, targetAt: target.toISOString() };
}
