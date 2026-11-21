// שקט בחלון "לא זמין" (בלוק 3ב-2, docs/01-foundation/אפיון-מורחב.md ח-2): "האפליקציה שותקת בחלון הזה. אין התראות ואין שאלות; מה שמגיע נשמר ונשלח כשהחלון נגמר."
// החלון שמור כשורת events עם domain='unavailable' (lib/unavailable.js), בלי שינוי סכמה. כל ההתראות עוברות דרך lib/chat-notify.js, ושם נבדק השקט (deferIfQuiet).
// התראה שנבלעה בחלון: נשלחת לתור הודעת resume מושהית עד סוף החלון (מפתח אחד לכל סוף חלון, אידמפוטנטי), והצרכן (api/queues/deliver.js) שולח בה התראה אחת.
// "אין שאלות": שאלות (שיעורי בית, מבחן) עדיין נכתבות לצ'אט, אבל בלי התראה; ההתראה שלהן מגיעה בסוף החלון. הכרעה טכנית, בלוק 3ב-2.
// כשל בבדיקת השקט = לא שקט (נכשל פתוח): התראה מיותרת עדיפה על הודעה שלא הגיעה.
import { SLOT_TOPIC } from './message-slots.js';

export const UNAVAILABLE_DOMAIN = 'unavailable';
const MAX_RETENTION_SECONDS = 604800; // מקסימום של התור: 7 ימים
// הנחה, לא אומת: 6 ימים, כדי שההודעה תמיד תחיה יותר מההשהיה בתוך תקרת השמירה. חלון ארוך יותר: ההודעה מגיעה מוקדם, בודקת שוב ונדחית שוב.
export const RESUME_MAX_DELAY_SECONDS = 6 * 86400;

// נטען בעצלות, כמו ב-api/intake.js: בדיקות לא יוצרות חיבור לתור.
const realSend = async (...args) => (await import('@vercel/queue')).send(...args);

// סוף החלון שמכסה את now (המאוחר מבין החלונות המכסים), או null.
export async function quietUntil(sql, now = new Date()) {
  const nowIso = now.toISOString();
  try {
    const rows = await sql`
      SELECT max(ends_at) AS until FROM events
      WHERE domain = 'unavailable' AND status = 'planned' AND starts_at <= ${nowIso}::timestamptz AND ends_at > ${nowIso}::timestamptz
    `;
    const value = Array.isArray(rows) ? rows[0]?.until : null;
    if (!value) return null;
    const until = new Date(value);
    return Number.isNaN(until.getTime()) || until.getTime() <= now.getTime() ? null : until;
  } catch (error) {
    console.error('quiet: בדיקת החלון נכשלה:', error?.name);
    return null;
  }
}

// הודעת התור לסוף החלון: { kind: 'resume', slotKey: 'resume-<שניות epoch>', targetAt, delaySeconds, retentionSeconds }.
export function planResume(until, now = new Date()) {
  const seconds = Math.floor(until.getTime() / 1000);
  const targetAt = new Date(seconds * 1000).toISOString();
  const delaySeconds = Math.min(RESUME_MAX_DELAY_SECONDS, Math.max(0, Math.ceil((seconds * 1000 - now.getTime()) / 1000)));
  return { kind: 'resume', slotKey: `resume-${seconds}`, targetAt, delaySeconds, retentionSeconds: Math.min(MAX_RETENTION_SECONDS, delaySeconds + 86400) };
}

// בחלון: קובע התראה לסופו ומחזיר { until }. מחוץ לחלון: null. כשל בתור נרשם ולא נזרק (השקט נשמר; ההתראה תגיע עם הבאה).
export async function deferIfQuiet({ sql, now = new Date(), send = realSend }) {
  const until = await quietUntil(sql, now);
  if (!until) return null;
  const plan = planResume(until, now);
  try {
    await send(SLOT_TOPIC, { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, {
      delaySeconds: plan.delaySeconds, retentionSeconds: plan.retentionSeconds, idempotencyKey: plan.slotKey,
    });
  } catch (error) {
    console.error('quiet: קביעת ההתראה לסוף החלון נכשלה:', error?.name);
  }
  return { until };
}
