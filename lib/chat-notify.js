// התראה מאוגדת של הצ'אט (שלב 8.2א-3; docs/08-chapter8/47 "8.2א-3", 35 D5 ו"גבולות"): הטקסט, בדיקת המצב והשליחה.
// הצרכן (api/queues/deliver.js) קורא כאן ברגע שהודעת התור של חלון ההתראות מגיעה; החלון והמפתח ב-lib/message-slots.js (planNotify).
// גבולות (35, סעיף 14): בהתראה ובמספר על האייקון אין תוכן הודעה אף פעם. הטקסט נגזר מספירות בלבד.
// השליחה קוראת ישירות ל-handle של api/push-send.js (בלי שינוי בקבצי הדחיפה). הנחה, לא אומת: קריאה ישירה כזו עובדת בתוך זמן הריצה של הצרכן (H22 ב-35).
// הנחה, לא אומת: הגדרות האייפון (צליל וצד באנר כבויים, תג דולק) משתיקות את ההתראה ועדיין מעדכנות את המספר (H20).
// הנחה, לא אומת: התראה שמופיעה גם כשהאפליקציה פתוחה בחזית לא מפריעה (H23).
import { badgeFrom } from './chat-view.js';
import { handle as pushSendHandle } from '../api/push-send.js';

export const PUSH_TITLE = 'מערכת יומן';
// כתובת קבועה של האתר (47: "עם כתובת קבועה של האתר"). push-send גוזר ממנה את הכתובת המלאה של navigate.
export const SITE_ORIGIN = 'https://yoman-system.vercel.app';

const count = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// נוסח ההתראה (47: "שאלה אחת ממתינה", "3 ממתינות לתשובה" או "הודעה חדשה"). בלי תוכן הודעה.
export function notifyText({ pending, unread } = {}) {
  const waiting = count(pending);
  if (waiting === 1) return 'שאלה אחת ממתינה';
  if (waiting > 1) return `${waiting} ממתינות לתשובה`;
  return 'הודעה חדשה';
}

// המצב לצורך ההחלטה אם לשלוח: { pending, unread, hasUnseen }. pending ו-unread בדיוק כמו loadBadge ב-api/chat.js (השאילתה משוכפלת במכוון ואינה נוגעת בו).
// hasUnseen: קיימת הודעה יוצאת שלא נקראה (read_at ריק) שהיא בועת update, או שאלה שעדיין ממתינה.
// כשל מסד נזרק (הצרכן נותן לתור לנסות שוב).
export async function loadNotifyState(sql) {
  const result = await sql`
    SELECT
      (SELECT count(*) FROM messages WHERE kind = 'question' AND awaiting_reply = true)::int AS pending,
      (SELECT count(*) FROM messages WHERE direction = 'out' AND kind = 'update' AND read_at IS NULL)::int AS unread,
      EXISTS (
        SELECT 1 FROM messages
        WHERE direction = 'out' AND read_at IS NULL
          AND (kind = 'update' OR (kind = 'question' AND awaiting_reply = true))
      ) AS has_unseen
  `;
  const row = (Array.isArray(result) ? result : result?.rows ?? [])[0] ?? {};
  return { pending: count(row.pending), unread: count(row.unread), hasUnseen: row.has_unseen === true };
}

// בודק אם צריך התראה, ואם כן שולח אחת. מחזיר { sent, reason?, badge, status? }.
// לא שולח כש-badge הוא 0, או כשאין הודעה שלא הוצגה. כשל במסד נזרק; כשל בדחיפה לא נזרק (reason: 'push-error' או 'push-status').
// dedupe_key = slotKey: push-send לא שולח פעמיים לאותו מנוי באותו חלון (גם בהגעה כפולה של התור).
export async function sendChatNotification({ sql, slotKey, pushHandle = pushSendHandle, secret }) {
  const state = await loadNotifyState(sql);
  const badge = badgeFrom(state);
  if (badge === 0) return { sent: false, reason: 'badge-zero', badge };
  if (!state.hasUnseen) return { sent: false, reason: 'nothing-unseen', badge };
  if (!secret) return { sent: false, reason: 'no-secret', badge };

  const request = new Request(`${SITE_ORIGIN}/api/push-send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      title: PUSH_TITLE,
      body: notifyText(state),
      navigate: '/',
      app_badge: Math.min(badge, 9999), // push-send מקבל 0-9999
      dedupe_key: slotKey,
    }),
  });
  try {
    const response = await pushHandle(request, { sql });
    const status = response?.status ?? null;
    if (typeof status === 'number' && status >= 200 && status < 300) return { sent: true, status, badge };
    return { sent: false, reason: 'push-status', status, badge };
  } catch (error) {
    // רק שם השגיאה: לא message (שעלולה לכלול ערכים).
    console.error('chat-notify: שליחת הדחיפה נכשלה:', error?.name);
    return { sent: false, reason: 'push-error', status: null, badge };
  }
}
