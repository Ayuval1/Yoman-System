// צרכן התור של משבצות ההודעה (בלוק 3, 8.10.2026): מקבל את ההודעה המושהית ברגע היעד ורושם ב-probe_log מתי הגיעה בפועל.
// כאן ייכנס בפרקים 8-9 בניית הבריף/הסגירה ושליחתם; עד אז זו תשתית התזמון בלבד: בלי הודעה אל יובל.
// התור הוא בטא (queue/v2beta). המסירה at-least-once, ולכן הכתיבה אידמפוטנטית: אותה משבצת נרשמת פעם אחת.
// ההנחה: ש-@vercel/queue עובד מקובץ api פשוט נבדקה בפריסת ניסוי ב-8.10.2026 (הגיעה 0.8 שניות אחרי היעד).
// פורמט ה-handler כאן הוא (req, res) של handleNodeCallback ולא export default { fetch }; ראו test/queue-deliver.test.js.
import { neon } from '@neondatabase/serverless';
import { QueueClient } from '@vercel/queue';
import { parseSlotMessage } from '../../lib/message-slots.js';

const LATE_OK_SECONDS = 120; // איחור מעל זה נרשם כ-ok=false

// handleDelivery מקבל את המסד והשעון מבחוץ כדי שאפשר לבדוק בלי מסד אמיתי ובלי תור.
export async function handleDelivery(message, metadata, { sql, now = () => new Date() }) {
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
  // אידמפוטנטיות: שורה אחת למשבצת. כשל במסד נזרק, כדי שהתור ינסה שוב (מוגבל ב-maxDeliveries ב-vercel.json).
  await sql`
    INSERT INTO probe_log (probe, ok, detail)
    SELECT 'message-slot', ${ok}, ${detail}
    WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'message-slot' AND detail LIKE ${`slot=${parsed.slotKey};%`})
  `;
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok };
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
