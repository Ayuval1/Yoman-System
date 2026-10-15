// צרכן התור של משבצות ההודעה (בלוק 3, 8.10.2026): מקבל את ההודעה המושהית ברגע היעד ורושם ב-probe_log מתי הגיעה בפועל.
// כאן ייכנס בפרקים 8-9 בניית הבריף/הסגירה ושליחתם; עד אז brief ו-close הן תשתית התזמון בלבד: בלי הודעה אל יובל.
// מאז שלב 8.2א-3 יש סוג שלישי, notify: התראה מאוגדת על הודעת מערכת שנוצרה מהודעה שהועברה (lib/chat-notify.js), באותו נושא ובלי שינוי ב-vercel.json.
// התור הוא בטא (queue/v2beta). המסירה at-least-once, ולכן הכתיבה אידמפוטנטית: אותה משבצת נרשמת פעם אחת.
// ההנחה: ש-@vercel/queue עובד מקובץ api פשוט נבדקה בפריסת ניסוי ב-8.10.2026 (הגיעה 0.8 שניות אחרי היעד).
// פורמט ה-handler כאן הוא (req, res) של handleNodeCallback ולא export default { fetch }; ראו test/queue-deliver.test.js.
import { neon } from '@neondatabase/serverless';
import { QueueClient } from '@vercel/queue';
import { parseSlotMessage } from '../../lib/message-slots.js';
import { sendChatNotification, sendReviewNotification } from '../../lib/chat-notify.js';

const LATE_OK_SECONDS = 120; // איחור מעל זה נרשם כ-ok=false

// handleDelivery מקבל את המסד והשעון מבחוץ כדי שאפשר לבדוק בלי מסד אמיתי ובלי תור.
// שלב 8.2א-3: הודעת notify (התראה מאוגדת של הצ'אט) בודקת מצב ושולחת דחיפה (lib/chat-notify.js). pushHandle ו-secret מוזרקים לבדיקות;
// ברירת המחדל: handle של api/push-send.js ו-CRON_SECRET. brief נשאר רישום בלבד. close (שלב M.2, docs/09-security/57 T10): אחרי הרישום הקיים, התראה אחת על סיכום היום אם יש הודעות לסימון.
export async function handleDelivery(message, metadata, { sql, now = () => new Date(), pushHandle, secret = process.env.CRON_SECRET }) {
  const parsed = parseSlotMessage(message);
  if (!parsed.ok) {
    // הודעה פגומה לא תתתקן בניסיון חוזר: רושמים ומאשרים (לא זורקים), כדי שלא תיכנס ללולאת ניסיונות.
    console.error('queue-deliver: הודעה לא תקינה:', parsed.reason);
    return { stored: false, reason: parsed.reason };
  }
  const deliveredAt = now();
  const lateSeconds = Math.round((deliveredAt.getTime() - new Date(parsed.targetAt).getTime()) / 100) / 10;
  const ok = lateSeconds <= LATE_OK_SECONDS;
  const deliveryCount = Number.isInteger(metadata?.deliveryCount) ? metadata.deliveryCount : null;
  const detail = `slot=${parsed.slotKey}; target_utc=${parsed.targetAt}; delivered_utc=${deliveredAt.toISOString()}; late_s=${lateSeconds}; delivery_count=${deliveryCount}`;
  if (parsed.kind === 'notify') {
    // כשל מסד (קריאת המצב או הרישום) נזרק, והתור ינסה שוב; dedupe_key של הדחיפה מונע שליחה כפולה. כשל בדחיפה עצמה לא נזרק: נרשם ok=false.
    const outcome = await sendChatNotification({ sql, slotKey: parsed.slotKey, pushHandle, secret });
    // "לא שלחתי כי אין צורך" (badge-zero, nothing-unseen) תקין; כשל בדחיפה או סוד חסר אינם.
    const sentOk = outcome.sent || !(String(outcome.reason).startsWith('push-') || outcome.reason === 'no-secret');
    const notifyDetail = `${detail}; badge=${outcome.badge}; sent=${outcome.sent}${outcome.sent ? '' : `; reason=${outcome.reason}${outcome.status ? `; push_status=${outcome.status}` : ''}`}`;
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'chat-notify', ${ok && sentOk}, ${notifyDetail}
      WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`})
    `;
    return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok: ok && sentOk, sent: outcome.sent };
  }
  // אידמפוטנטיות: שורה אחת למשבצת. כשל במסד נזרק, כדי שהתור ינסה שוב (מוגבל ב-maxDeliveries ב-vercel.json).
  await sql`
    INSERT INTO probe_log (probe, ok, detail)
    SELECT 'message-slot', ${ok}, ${detail}
    WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'message-slot' AND detail LIKE ${`slot=${parsed.slotKey};%`})
  `;
  // M.2 (57 T10): במשבצת close, אחרי שנכתבה שורת message-slot (למעלה, ללא שינוי), התראה אחת על סיכום היום. הזמן לספירה הוא targetAt (21:00 של המשבצת), לא רגע ההגעה.
  // כל כשל כאן (ספירה, דחיפה, רישום) נתפס ולא נזרק: זריקה הייתה גורמת לניסיון חוזר של התור, והשורה הקיימת כבר נכתבה.
  if (parsed.kind === 'close') await notifyReview({ sql, parsed, detail, ok, pushHandle, secret });
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok };
}

// התראת סיכום היום במשבצת close. נרשמת ב-probe_log כ-chat-notify (שורה אחת למשבצת). לא זורקת אף פעם.
async function notifyReview({ sql, parsed, detail, ok, pushHandle, secret }) {
  let outcome;
  try {
    outcome = await sendReviewNotification({ sql, slotKey: parsed.slotKey, now: new Date(parsed.targetAt), pushHandle, secret });
  } catch (error) {
    console.error('queue-deliver: התראת הסיכום נכשלה:', error?.name); // רק שם השגיאה
    outcome = { sent: false, reason: 'error', badge: null };
  }
  const sentOk = outcome.sent || outcome.reason === 'review-zero'; // "אין הודעות לסימון" תקין; כשל בדחיפה, סוד חסר או שגיאה אינם
  const reviewDetail = `${detail}; badge=${outcome.badge}; sent=${outcome.sent}${outcome.sent ? '' : `; reason=${outcome.reason}${outcome.status ? `; push_status=${outcome.status}` : ''}`}`;
  try {
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'chat-notify', ${ok && sentOk}, ${reviewDetail}
      WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`})
    `;
  } catch (error) {
    console.error('queue-deliver: רישום התראת הסיכום נכשל:', error?.name);
  }
}

// נוצר בעצלות: בדיקות שמייבאות את הקובץ לא יוצרות לקוח תור.
let handler;
export default function deliver(req, res) {
  if (!handler) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    handler = new QueueClient().handleNodeCallback((message, metadata) => handleDelivery(message, metadata, { sql }));
  }
  return handler(req, res);
}
