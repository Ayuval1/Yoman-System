// צרכן התור של משבצות ההודעה (בלוק 3, 8.10.2026): מקבל את ההודעה המושהית ברגע היעד ורושם ב-probe_log מתי הגיעה בפועל.
// שלב B-1 (docs/08-chapter8/68): במשבצת brief נכתבת הודעת הבוקר ל-messages (deliverBrief למטה). שלב B-2: אחרי ההודעה נשלחת גם התראת הבוקר (כל יום).
// שלב C-1 (docs/08-chapter8/90): במשבצת close נכתבת הודעת הסגירה של 21:00 ל-messages ונשלחת התראה בכל ערב (deliverClose למטה), במקום התראת הסיכום של M.2.
// מאז שלב 8.2א-3 יש סוג שלישי, notify: התראה מאוגדת על הודעת מערכת שנוצרה מהודעה שהועברה (lib/chat-notify.js), באותו נושא ובלי שינוי ב-vercel.json.
// שלב 8.6-1 (docs/08-chapter8/60): סוג רביעי, homework: שאלת "היו שיעורי בית?" אחת לרצף שיעורים (נוצרת ב-cron-plan של 01:00 UTC, מגיעה 3 דקות אחרי סוף הרצף). ראו deliverHomework למטה.
// התור הוא בטא (queue/v2beta). המסירה at-least-once, ולכן הכתיבה אידמפוטנטית: אותה משבצת נרשמת פעם אחת.
// ההנחה: ש-@vercel/queue עובד מקובץ api פשוט נבדקה בפריסת ניסוי ב-8.10.2026 (הגיעה 0.8 שניות אחרי היעד).
// פורמט ה-handler כאן הוא (req, res) של handleNodeCallback ולא export default { fetch }; ראו test/queue-deliver.test.js.
import { neon } from '@neondatabase/serverless';
import { QueueClient } from '@vercel/queue';
import { parseSlotMessage, planNotify } from '../../lib/message-slots.js';
import { sendChatNotification, sendBriefNotification, sendClosingNotification } from '../../lib/chat-notify.js';
import { composeBrief, briefEntityId, briefPushText } from '../../lib/brief-view.js';
import { closingWindow, closingDates, loadReceived, loadDone, composeClosing, closingPushText } from '../../lib/closing-view.js';
import { loadPending } from '../../lib/chat-pending.js';
import { loadTimetable } from '../../lib/timetable.js';
import { examLineAt } from '../../lib/exam-line.js';
import { sequenceFromKey } from '../../lib/homework-schedule.js';
import { createLessonAsk, loadOpenTasks } from '../../lib/homework-view.js';
import { loadAbsenceRows, decideAbsence } from '../../lib/homework-absence.js';
import { createExamAsks, loadExamAnswers } from '../../lib/exam-ask.js';

const LATE_OK_SECONDS = 120; // איחור מעל זה נרשם כ-ok=false
const MAX_DELIVERIES = 5; // כמו maxDeliveries ב-vercel.json; בניסיון האחרון הבריף נשלח גם בלי מערכת השעות (D10 ז)

// handleDelivery מקבל את המסד והשעון מבחוץ כדי שאפשר לבדוק בלי מסד אמיתי ובלי תור.
// שלב 8.2א-3: הודעת notify (התראה מאוגדת של הצ'אט) בודקת מצב ושולחת דחיפה (lib/chat-notify.js). pushHandle ו-secret מוזרקים לבדיקות;
// ברירת המחדל: handle של api/push-send.js ו-CRON_SECRET. brief (B-1): אחרי הרישום הקיים, כותב את הודעת הבוקר ל-messages. close (C-1, docs/08-chapter8/90): אחרי הרישום הקיים, הודעת הסגירה והתראה בכל ערב.
// homework (שלב 8.6-1, docs/08-chapter8/60 סעיפים 3-5): אחרי הרישום הקיים, יוצר את שאלת שיעורי הבית של הרצף ושולח התראה כללית אחת. timetable (אופציונלי, לבדיקות): במקום טעינה מהמסד.
export async function handleDelivery(message, metadata, { sql, now = () => new Date(), pushHandle, secret = process.env.CRON_SECRET, timetable }) {
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
  // C-1 (docs/08-chapter8/90 E9, E10): במשבצת close, אחרי שנכתבה שורת message-slot (למעלה, ללא שינוי), הודעת הסגירה בצ'אט והתראה אחת בכל ערב (deliverClose למטה).
  // היא מחליפה את התראת הסיכום של M.2, ונוסחה כולל את "סיכום היום מחכה לסימון" כל עוד יש הודעות לסימון.
  if (parsed.kind === 'close') return deliverClose({ sql, parsed, detail, ok, lateSeconds, deliveredAt, deliveryCount, pushHandle, secret, timetable });
  if (parsed.kind === 'brief') return deliverBrief({ sql, parsed, detail, ok, lateSeconds, deliveredAt, deliveryCount, pushHandle, secret, timetable });
  if (parsed.kind === 'homework') return deliverHomework({ sql, parsed, detail, ok, lateSeconds, deliveredAt, pushHandle, secret, timetable });
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok };
}

// הודעת הבוקר (B-1, PRD 68 D10). נקראת אחרי שורת message-slot, שנכתבת ראשונה ועם WHERE NOT EXISTS, ולכן ההכנסה כאן עצמאית ממנה: ניסיון חוזר ממשיך מההכנסה.
// הודעה אחת למשבצת: entity_type='brief' ו-entity_id דטרמיניסטי ממפתח המשבצת, והכנסה עם WHERE NOT EXISTS על שני השדות. אין אינדקס ייחודי (אין שינוי סכמה), ולכן שני עיבודים מקבילים של אותה משבצת אינם מוגנים; הסיכום מתקבל (D10 א).
// התאריך נגזר ממפתח המשבצת, לא מהשעון; sent_at = targetAt; read_at מלא כדי שההודעה לא תיספר באייקון (D10 ה).
// כשל מסד בטעינת המשימות, השאלות או ההכנסה נזרק (ניסיון חוזר של התור). מערכת השעות נטענת עם rethrowDbError: כשל זמני נזרק עד הניסיון האחרון (deliveryCount >= MAX_DELIVERIES), ואז ההודעה נשלחת בלי שורת בית ספר; טבלה ריקה (null) = בלי שורת בית ספר.
// plan B (PRD 68 סעיף 6): בניסיון האחרון כשל בטעינת המשימות משמיט את סעיף המשימות, וכשל בטעינת השאלות משמיט את שורת השאלות; ההודעה נוצרת בכל זאת (composeBrief עם partial: בלי "יום פנוי"). בניסיון שאינו האחרון כל כשל נזרק.
// B-2 (68 D4 מעודכן בהכרעת יובל, D6, D10 ו): אחרי שההודעה נוצרה או כבר קיימת, תמיד מנסים את הדחיפה (sendBriefNotification), בכל יום, גם בשבת ובחופשה.
// הנוסח נגזר מאותם נתונים כמו ההודעה (composeBrief). כשההודעה כבר קיימת, מערכת השעות והמשימות נטענות מחדש באותם טוענים (ואותם fallbacks), והשאלות לא נטענות (הדחיפה לא משתמשת בהן).
// כל כשל בדחיפה או ברישומה נתפס ולא נזרק (זריקה הייתה גורמת לניסיון חוזר של התור); dedupe_key של push-send מונע שליחה כפולה. התוצאה בשדה push, ובשורת chat-notify ב-probe_log (כמו deliverHomework).
async function deliverBrief({ sql, parsed, detail, ok, lateSeconds, deliveredAt, deliveryCount, pushHandle, secret, timetable }) {
  const dateIso = parsed.slotKey.slice('brief-'.length);
  const entityId = briefEntityId(parsed.slotKey);
  const existing = await sql`SELECT 1 AS found FROM messages WHERE entity_type = 'brief' AND entity_id = ${entityId}::uuid LIMIT 1`;
  const exists = Array.isArray(existing) && existing.length > 0;

  const lastAttempt = deliveryCount !== null && deliveryCount >= MAX_DELIVERIES;
  let table = timetable;
  if (table === undefined) {
    try {
      table = await loadTimetable(sql, { rethrowDbError: true });
    } catch (error) {
      if (!lastAttempt) throw error; // ניסיון חוזר
      console.error('queue-deliver: הבריף נשלח בלי מערכת השעות:', error?.name); // רק שם השגיאה
      table = null;
    }
  }
  // B-3ב (68 H13): שאלת "איזה מקצוע במדעים?" נוצרת לפני טעינת השאלות, כדי שתופיע גם בבריף ("שאלות שממתינות"). לא זורקת: כשל (כולל טבלה שלא נוצרה) נרשם והבריף ממשיך.
  // הנחה, לא אומת: "היום" לחלון הוא תאריך המשבצת (dateIso, כמו שאר הבריף), לא השעון.
  await createExamAsks({ sql, todayIso: dateIso });
  const answers = await loadExamAnswers(sql); // לא זורק: כשל = מפה ריקה (מבחן "מדעים" בלי שם מקצוע)
  let partial = false;
  let tasks = [];
  let pending = [];
  try {
    tasks = await loadOpenTasks(sql);
  } catch (error) {
    if (!lastAttempt) throw error;
    console.error('queue-deliver: הבריף נשלח בלי המשימות:', error?.name);
    partial = true;
  }
  // partialForPush: רק המשימות משפיעות על נוסח הדחיפה (השאלות לא נכנסות אליה), ולכן כשל שאלות לא מסמן את הדחיפה כחלקית.
  const partialForPush = partial;
  if (!exists) {
    try {
      pending = await loadPending(sql, table, deliveredAt);
    } catch (error) {
      if (!lastAttempt) throw error;
      console.error('queue-deliver: הבריף נשלח בלי השאלות:', error?.name);
      partial = true;
    }
  }
  const brief = composeBrief({ dateIso, timetable: table, tasks, pending, partial, answers });
  let created = false;
  if (!exists) {
    const rows = await sql`
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt, read_at)
      SELECT 'out', ${brief.text}::text, 'update', ${parsed.targetAt}::timestamptz, false, NULL::uuid, NULL::timestamptz, 'brief', ${entityId}::uuid, NULL::integer, ${parsed.targetAt}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM messages WHERE entity_type = 'brief' AND entity_id = ${entityId}::uuid)
      RETURNING id
    `;
    created = Array.isArray(rows) && rows.length > 0;
  }

  let outcome;
  try {
    const body = briefPushText({ brief, timetable: table, partial: partialForPush });
    outcome = await sendBriefNotification({ sql, slotKey: parsed.slotKey, pushHandle, secret, body, now: deliveredAt });
  } catch (error) {
    // כשל מסד בקריאת מצב הדחיפה (sendBriefNotification לא זורקת על כשל בדחיפה עצמה): ההודעה כבר נשמרה, והניסיון החוזר אידמפוטנטי (בלי INSERT שני, dedupe_key), ולכן זורקים
    // עד הניסיון האחרון ולא מאבדים את התראת היום בגלל כשל זמני. בניסיון האחרון נתפס ונרשם, כמו שאר הכשלים כאן.
    if (!lastAttempt) throw error;
    console.error('queue-deliver: התראת הבוקר נכשלה:', error?.name); // רק שם השגיאה
    outcome = { sent: false, reason: 'error', badge: null };
  }
  // כשל דחיפה זמני (5xx מ-push-send, או חריגה בקריאה אליו) לפני הניסיון האחרון: זורקים, והתור מנסה שוב. בטוח: ההודעה כבר קיימת (בלי INSERT שני), ו-dedupe_key מונע שליחה כפולה.
  // 4xx (למשל בלי סוד) לא נזרק: ניסיון חוזר לא ישנה אותו. [הנחה, לא אומת] 5xx אחרי שהמפתח נתפס ב-push-send משאיר אותו תפוס, ולכן ניסיון חוזר כזה לא ישלח; זה לא מזיק (ביקורת B-2, ממצא 1).
  const transient = outcome.reason === 'push-error' || (outcome.reason === 'push-status' && outcome.status >= 500);
  if (transient && !lastAttempt) throw new Error(`queue-deliver: התראת הבוקר נכשלה זמנית (${outcome.reason})`);
  const sentOk = outcome.sent;
  const notifyDetail = `${detail}; created=${created}; badge=${outcome.badge}; sent=${outcome.sent}${outcome.sent ? '' : `; reason=${outcome.reason}${outcome.status ? `; push_status=${outcome.status}` : ''}`}`;
  try {
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'chat-notify', ${ok && sentOk}, ${notifyDetail}
      WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`})
    `;
  } catch (error) {
    console.error('queue-deliver: רישום התראת הבוקר נכשל:', error?.name);
  }
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok: ok && sentOk, created, push: { sent: outcome.sent, reason: outcome.reason ?? null } };
}

// שאלת שיעורי בית (מפרט 60 סעיפים 3-5). השם והתאריך מחושבים ממערכת השעות ומהמפתח, לא מגוף ההודעה.
// כשל מסד (טעינת הטבלה, יצירת השאלה) נזרק, והתור ינסה שוב: היצירה אידמפוטנטית (UNIQUE + ON CONFLICT DO NOTHING), ולכן ניסיון חוזר לא יוצר כפילות.
// מערכת שעות שלא נטענה (null) נזרקת לניסיון חוזר; רצף שאין לו שורה בטבלה (המערכת השתנתה, או מקצוע פטור) נרשם ומאושר בלי שאלה.
// ההתראה נשלחת כשהשאלה נוצרה עכשיו, או כשהיא קיימת אבל לא נרשם ניסיון התראה לרצף (הגעה כפולה אחרי הצלחה לא שולחת שוב), עם מפתח dedupe של חלון האגוד הקיים (30 שניות, planNotify): שתי שאלות בחלון אחד = התראה אחת.
// הנחה, לא אומת: אם התהליך נופל בין יצירת השאלה לשליחת ההתראה, הניסיון החוזר לא ישלח התראה (השאלה כבר קיימת); המספר על האייקון יתעדכן בפתיחה הבאה.
// כל כשל בהתראה נתפס ולא נזרק, כדי שלא ייווצר ניסיון חוזר אחרי שהשאלה כבר נוצרה. הנוסח כללי: notifyText (שאלה אחת ממתינה / N ממתינות), בלי מקצוע ובלי תוכן.
async function deliverHomework({ sql, parsed, detail, ok, lateSeconds, deliveredAt, pushHandle, secret, timetable }) {
  const table = timetable === undefined ? await loadTimetable(sql) : timetable;
  if (!table) throw new Error('homework: מערכת השעות לא נטענה'); // הודעה קבועה, בלי ערכים; התור ינסה שוב
  const sequence = sequenceFromKey(table, parsed.slotKey);
  if (!sequence) {
    console.error('queue-deliver: אין רצף שיעורי בית למפתח');
    return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok, created: false, sent: false, reason: 'no-sequence' };
  }
  // שלב 8.3-2: ביטול וחוסר (lib/homework-absence.js). רצף שכולו מבוטל: אין שאלה, אין שורה ב-lesson_asks ואין התראה (כמו no-sequence: ה-probe_log הקיים בלבד, בלי מקצוע).
  // כשל בקריאת העובדות לא משנה: השאלה נוצרת כרגיל, בלי סימון "פוספס". נרשם רק שם השגיאה.
  let absence = { cancelled: false, missed: false };
  try {
    absence = decideAbsence({ rows: await loadAbsenceRows(sql, sequence.lessonDate), sequence, timetable: table });
  } catch (error) {
    console.error('queue-deliver: קריאת עובדות ההיעדרות נכשלה:', error?.name); // רק שם השגיאה
  }
  if (absence.cancelled) return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok, created: false, sent: false, reason: 'cancelled' };
  const { created } = await createLessonAsk({ sql, sequence, timetable: table, missed: absence.missed });
  // סגירת פער הניסיון החוזר: אם השאלה כבר קיימת (created=false) אבל אף ניסיון התראה לא נרשם ב-probe_log (קריסה אחרי היצירה), שולחים עכשיו.
  // השורה ב-probe_log נכתבת רק אחרי ניסיון, ו-dedupe_key של push-send מונע כפילות. הנחה, לא אומת: ניסיון שנכשל בדחיפה נרשם ולכן לא יישלח שוב.
  let shouldNotify = created;
  if (!created) {
    const found = await sql`SELECT 1 AS found FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`} LIMIT 1`;
    shouldNotify = !(Array.isArray(found) && found.length > 0);
  }
  let outcome = { sent: false, reason: 'exists', badge: null };
  if (shouldNotify) {
    try {
      outcome = await sendChatNotification({ sql, slotKey: planNotify(deliveredAt).slotKey, pushHandle, secret, now: deliveredAt });
    } catch (error) {
      console.error('queue-deliver: התראת שיעורי הבית נכשלה:', error?.name); // רק שם השגיאה
      outcome = { sent: false, reason: 'error', badge: null };
    }
  }
  const sentOk = outcome.sent || !(String(outcome.reason).startsWith('push-') || outcome.reason === 'no-secret' || outcome.reason === 'error');
  const notifyDetail = `${detail}; created=${created}; badge=${outcome.badge}; sent=${outcome.sent}${outcome.sent ? '' : `; reason=${outcome.reason}${outcome.status ? `; push_status=${outcome.status}` : ''}`}`;
  try {
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'chat-notify', ${ok && sentOk}, ${notifyDetail}
      WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`})
    `;
  } catch (error) {
    console.error('queue-deliver: רישום התראת שיעורי הבית נכשל:', error?.name);
  }
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok: ok && sentOk, created, sent: outcome.sent };
}

// הודעת הסגירה של 21:00 (C-1, docs/08-chapter8/90 E1-E11), בדפוס של deliverBrief. נקראת אחרי שורת message-slot, שנכתבת ראשונה וללא שינוי.
// הודעה אחת למשבצת (E9): entity_type='close' ו-entity_id = briefEntityId(slotKey) (מיובא, לא מועתק), הכנסה עם WHERE NOT EXISTS, sent_at = read_at = targetAt (לא נספרת באייקון).
// הזמן הוא targetAt, לא השעון (E8, E11): חלון "נקלט", "מחר", שורת המבחן ומצב ההתראה מחושבים ממנו, ולכן ניסיון חוזר או הגעה אחרי חצות מחשבים אותו דבר.
// השאלות נטענות עם deliveredAt, כמו בבוקר (תוקף שאלה, expires_at, נבדק מול רגע ההגעה).
// כשל (E9): מערכת השעות נטענת עם rethrowDbError; כשל מסד בכל טעינה (מערכת השעות, "נקלט", "בוצע היום", משימות, שאלות) נזרק עד הניסיון האחרון (deliveryCount >= MAX_DELIVERIES),
// ואז ההודעה נשלחת חלקית: החלק שנכשל מושמט, ו-composeClosing לא טוען ריקנות (null = לא נטען). מערכת שעות חסרה = שורת מבחן בלי שעה. loadExamAnswers לא זורק.
// בניגוד לבוקר, כל הנתונים נטענים גם כשההודעה כבר קיימת [הצעה]: נוסח ההתראה נגזר מאותם נתונים כמו ההודעה (כולל "נקלטו N" ושאלות), והגעה כפולה נדירה.
// ההתראה (E5, E10): sendClosingNotification, בכל ערב, רק אחרי שההודעה נוצרה או כבר קיימת; מחליפה את התראת הסיכום של M.2 (הנוסח כולל אותה לפי state.review).
// כשל דחיפה זמני וכשל מסד בקריאת מצב הדחיפה נזרקים עד הניסיון האחרון, כמו בבוקר. ב-probe_log נרשמים exam=0/1, created, badge, sent בלבד, בלי טקסט.
async function deliverClose({ sql, parsed, detail, ok, lateSeconds, deliveredAt, deliveryCount, pushHandle, secret, timetable }) {
  const targetAt = new Date(parsed.targetAt);
  const dateIso = parsed.slotKey.slice('close-'.length);
  const { tomorrowIso } = closingDates(targetAt);
  const entityId = briefEntityId(parsed.slotKey);
  const existing = await sql`SELECT 1 AS found FROM messages WHERE entity_type = 'close' AND entity_id = ${entityId}::uuid LIMIT 1`;
  const exists = Array.isArray(existing) && existing.length > 0;

  const lastAttempt = deliveryCount !== null && deliveryCount >= MAX_DELIVERIES;
  // טעינה אחת: כשל נזרק לניסיון חוזר, ובניסיון האחרון מחזיר null (החלק מושמט). בקונסול רק שם השגיאה.
  const loadPart = async (label, load) => {
    try {
      return await load();
    } catch (error) {
      if (!lastAttempt) throw error;
      console.error(`queue-deliver: הסגירה נשלחת בלי ${label}:`, error?.name);
      return null;
    }
  };
  const table = timetable === undefined ? await loadPart('מערכת השעות', () => loadTimetable(sql, { rethrowDbError: true })) : timetable;
  const answers = await loadExamAnswers(sql); // לא זורק: כשל = מפה ריקה
  const examLine = examLineAt(targetAt, { timetable: table, answers });
  const received = await loadPart('נקלט היום', () => loadReceived(sql, closingWindow(targetAt)));
  const done = await loadPart('בוצע היום', () => loadDone(sql, closingWindow(targetAt))); // C-2 (E6): אותו חלון כמו "נקלט"
  const tasks = await loadPart('המשימות', () => loadOpenTasks(sql));
  const pending = await loadPart('השאלות', () => loadPending(sql, table, deliveredAt));
  const closing = composeClosing({
    dateIso, tomorrowIso, examLine, tasks, pending, done,
    received: received ? received.lines : null, notUnderstood: received ? received.notUnderstood : 0,
  });

  let created = false;
  if (!exists) {
    const rows = await sql`
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt, read_at)
      SELECT 'out', ${closing.text}::text, 'update', ${parsed.targetAt}::timestamptz, false, NULL::uuid, NULL::timestamptz, 'close', ${entityId}::uuid, NULL::integer, ${parsed.targetAt}::timestamptz
      WHERE NOT EXISTS (SELECT 1 FROM messages WHERE entity_type = 'close' AND entity_id = ${entityId}::uuid)
      RETURNING id
    `;
    created = Array.isArray(rows) && rows.length > 0;
  }

  let outcome;
  try {
    const body = (state) => closingPushText({ examLine, reviewDue: state.review, receivedCount: closing.received, notUnderstoodCount: closing.notUnderstood, pendingCount: closing.pending, openTasks: closing.tasks, partial: closing.partial });
    outcome = await sendClosingNotification({ sql, slotKey: parsed.slotKey, pushHandle, secret, body, now: targetAt });
  } catch (error) {
    // כשל מסד בקריאת מצב הדחיפה: ההודעה כבר נשמרה והניסיון החוזר אידמפוטנטי, ולכן זורקים עד הניסיון האחרון (כמו בבוקר).
    if (!lastAttempt) throw error;
    console.error('queue-deliver: התראת הסגירה נכשלה:', error?.name); // רק שם השגיאה
    outcome = { sent: false, reason: 'error', badge: null };
  }
  const transient = outcome.reason === 'push-error' || (outcome.reason === 'push-status' && outcome.status >= 500);
  if (transient && !lastAttempt) throw new Error(`queue-deliver: התראת הסגירה נכשלה זמנית (${outcome.reason})`);
  const sentOk = outcome.sent;
  const notifyDetail = `${detail}; exam=${examLine ? 1 : 0}; created=${created}; badge=${outcome.badge}; sent=${outcome.sent}${outcome.sent ? '' : `; reason=${outcome.reason}${outcome.status ? `; push_status=${outcome.status}` : ''}`}`;
  try {
    await sql`
      INSERT INTO probe_log (probe, ok, detail)
      SELECT 'chat-notify', ${ok && sentOk}, ${notifyDetail}
      WHERE NOT EXISTS (SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE ${`slot=${parsed.slotKey};%`})
    `;
  } catch (error) {
    console.error('queue-deliver: רישום התראת הסגירה נכשל:', error?.name);
  }
  return { stored: true, slotKey: parsed.slotKey, lateSeconds, ok: ok && sentOk, created, push: { sent: outcome.sent, reason: outcome.reason ?? null } };
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
