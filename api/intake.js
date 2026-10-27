// נקודת הקליטה היחידה (שלב 1; מחוברת לצינור הקוד בשלב 8.2). מקור: docs/17 סעיפים 4-5, docs/02-rules/03-app-channel-rules.md "פרטי הקלט" (שורות 98-103), build-rules 23.
// מה היא עושה: מקבלת POST (Form) מהקיצור או מהצ'אט, בודקת סוד בכותרת, שומרת את ההודעה הגולמית ב-sources (המקור נשמר לפני כל עיבוד),
// ואז מפעילה את צינור הקוד (lib/intake-process.js): כפילות ("כבר קיבלתי"), חילוץ עובדות, שמירה אטומית, שאלת הבהרה, ובועת תשובה בצ'אט. התשובה: "נרשם · ..." כשהמערכת הבינה, אחרת "התקבל".
// כשל או תקיעה בעיבוד לעולם לא משנים את הסטטוס ולא את השמירה: ההודעה נשמרה, התשובה 200 "התקבל", ו-processed_at נשאר ריק (מה שלא עובד נשלח שוב בשלבים הבאים).
// אחרי העיבוד ולפני התשובה נרשמת תוצאת העיבוד ב-intake_outcomes (docs/09-security/46, שלב M.1): קוד סטטוס בלבד, בלי טקסט ובלי שמות. כשל ברישום הזה לא משנה את התשובה לקיצור.
// הערוץ (שלב 8.2א-1, docs/08-chapter8/47 "8.2א-1 נתונים ושרת"; 35, "כתיבה מהצ'אט לקליטה"): שדה Form בשם channel. חסר או ריק = shortcut (הקיצור לא שולח אותו,
// ותשובתו נשארת זהה תו בתו); app = הודעה שיובל הקליד בצ'אט; כל ערך אחר = 400 ושום דבר לא נשמר. intake_outcomes נרשם רק לערוץ הקיצור (46, D17).
// התראה מאוגדת (שלב 8.2א-3, docs/08-chapter8/47 "8.2א-3"; 35, D5): רק להודעה שהועברה (ערוץ shortcut) שהמערכת הבינה (status recorded), אחרי רישום התוצאה ולפני התשובה,
// נשלחת לתור הודעת notify מושהית (חלון של 120 שניות, lib/message-slots.js); הצרכן (api/queues/deliver.js) בודק מצב ושולח דחיפה אחת. הודעה מוקלדת (app) לעולם לא נשלחת לתור.
// כשל בשליחה לתור נתפס, נרשם בשם השגיאה בלבד, ולא משנה את התשובה לקיצור.
// מה היא לא עושה: אין קריאה למודל, אין תמונות.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { processSource } from '../lib/intake-process.js';
import { RECEIVED_REPLY } from '../lib/intake-questions.js';
import { planNotify, SLOT_TOPIC } from '../lib/message-slots.js';
import { syncEventForSource } from '../lib/event-sync.js';

// נטען בעצלות, כמו ב-lib/ops/cron-plan.js: בדיקות ובקשות שנדחות לא יוצרות חיבור לתור.
const realSend = async (...args) => (await import('@vercel/queue')).send(...args);

// הנחה, לא אומת: שם הכותרת של הסוד. אף מסמך לא קובע אותו (03-app-channel-rules: "סוד קבוע בכותרת").
const SECRET_HEADER = 'x-intake-secret';
// הנחה, לא אומת: שם משתנה הסביבה של הסוד. docs/20 כותב רק "סוד הקיצור" בלי שם.
const SECRET_ENV_NAME = 'INTAKE_SECRET';
// הנחה, לא אומת: שם שדה הטקסט ב-Form. אף מסמך לא קובע אותו.
const TEXT_FIELD = 'text';
// הנחה, לא אומת: שם שדה השולח ב-Form. 06 קובע רק שהעמודה sender היא "כפי שהערוץ מדווח".
const SENDER_FIELD = 'sender';
// הנחה, לא אומת: שם שדה הערוץ ב-Form. 47 קובע רק "שדה ערוץ בבקשה, ברירת מחדל shortcut".
const CHANNEL_FIELD = 'channel';
// הנחה, לא אומת: תקרת אורך לטקסט (תווים). 100,000 היא בחירה שלי, מעל כל הודעת וואטסאפ רגילה, כדי שהודעה ענקית לא תיכתב למסד. אף מסמך לא קובע ערך.
const MAX_TEXT_LENGTH = 100_000;
// הנחה, לא אומת: 5 שניות לעיבוד אחרי השמירה. אף מסמך לא קובע ערך; Fluid Compute פעיל, ו-maxDuration של נקודה זו לא נמדד.
const PROCESS_TIMEOUT_MS = 5000;
const NOTIFY_QUEUE_TIMEOUT_MS = 3000;
// הערוצים של נקודה זו. הערוץ שהתקבל נשלח לצינור העיבוד, ורק הקיצור הוא התנאי לרישום ב-intake_outcomes (46, D17: נמדדות רק הודעות מהקיצור).
// הסינון לפי הערוץ עצמו ולא לפי הסטטוס skipped, כי מאז שלב 8.2א-1 ערוץ app מעובד (docs/08-chapter8/47, "תלויות", סעיף 2). אותם ערכים כתובים גם כמחרוזת ב-INSERT ל-sources.
const CHANNEL_SHORTCUT = 'shortcut';
const CHANNEL_APP = 'app';
// הסטטוסים של הצינור שנרשמים כמות שהם (46, D17). 'skipped' לא נרשם; כל ערך אחר נרשם failed.
const OUTCOME_STATUSES = ['recorded', 'unclassified', 'duplicate'];

const TEXT_PLAIN = { 'content-type': 'text/plain; charset=utf-8' };

function reply(status, body) {
  return new Response(body, { status, headers: TEXT_PLAIN });
}

// השוואה בזמן קבוע: משווים טביעות sha256 באורך זהה, כך שגם אורך הסוד לא נחשף.
function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// הנחה, לא אומת: ה-hash הוא sha256 (hex) של הטקסט בלבד. 06 לא מגדיר אלגוריתם.
function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

// מריץ את ההבטחה, ודוחה אותה אחרי ms אם לא הסתיימה. הטיימר נוקה תמיד, כדי שלא יחזיק את התהליך.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// מה נרשם ב-intake_outcomes על עיבוד אחד (46, D17): { status, reason }, או null כשלא נרשמת שורה (ערוץ שאינו הקיצור, או skipped).
// failure: 'error' / 'timeout' כשהצינור זרק, אחרת null. ערך שחזר בלי status מוכר נרשם failed עם error.
export function outcomeFor({ channel, result, failure = null }) {
  if (channel !== CHANNEL_SHORTCUT) return null;
  if (failure) return { status: 'failed', reason: failure };
  const status = result?.status;
  if (status === 'skipped') return null;
  if (OUTCOME_STATUSES.includes(status)) return { status, reason: null };
  return { status: 'failed', reason: 'error' };
}

// handle מקבל את ה-DB מבחוץ (deps.sql) כדי שאפשר לבדוק בלי מסד אמיתי. processor (אופציונלי): החלפת צינור העיבוד, לבדיקות.
// processTimeoutMs (אופציונלי): קיצור ההמתנה לעיבוד, כדי לבדוק תקיעה בלי לחכות 5 שניות.
// sendQueue ו-now (אופציונליים): שליחה לתור והשעון של ההתראה המאוגדת, לבדיקות. eventSync (אופציונלי): הכתיבה ליומן Google (שלב 8.3-4), לבדיקות.
export async function handle(request, {
  sql,
  secret = process.env[SECRET_ENV_NAME],
  processor = processSource,
  processTimeoutMs = PROCESS_TIMEOUT_MS,
  sendQueue = realSend,
  now = () => new Date(),
  eventSync = syncEventForSource,
}) {
  const startedAt = Date.now();

  if (request.method !== 'POST') {
    return reply(405, 'Method Not Allowed');
  }

  // בקשה בלי סוד, או עם סוד שגוי - נדחית, ושום דבר לא נשמר (03-app-channel-rules, "אבטחה").
  // אם הסוד לא הוגדר בשרת - גם נדחים (נכשלים סגור).
  if (!secret) {
    console.error(`${SECRET_ENV_NAME} לא מוגדר בשרת`);
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get(SECRET_HEADER), secret)) {
    return reply(401, 'Unauthorized');
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    // הנחה, לא אומת: 400 על בקשה שאינה Form תקין. אף מסמך לא מגדיר זאת.
    return reply(400, 'לא נשלח, נסה שוב.');
  }

  const text = form.get(TEXT_FIELD);
  // שלב 1: טקסט בלבד. הודעה בלי טקסט (תמונה בלבד) - לא נתמכת עדיין (docs/02-rules/03-intake-rules.md "הודעה בלי טקסט", שלב מאוחר).
  // הנחה, לא אומת: מחזירים 400 ולא שומרים כלום. הטקסט נשמר כפי שהתקבל, בלי trim ובלי עיבוד.
  if (typeof text !== 'string' || text.length === 0) {
    return reply(400, 'לא נשלח, נסה שוב.');
  }
  // טקסט ארוך מהתקרה לא נשמר ולא נחתך: נדחה במפורש, כדי שלא ייווצר רושם שהתקבל.
  if (text.length > MAX_TEXT_LENGTH) {
    return reply(413, 'ההודעה ארוכה מדי, לא נשלחה.');
  }

  // הערוץ (שלב 8.2א-1): חסר או ריק = הקיצור; shortcut או app מתקבלים; כל ערך אחר (גם קובץ במקום טקסט) = 400 ושום דבר לא נשמר.
  const channelRaw = form.get(CHANNEL_FIELD);
  let channel;
  if (channelRaw === null || channelRaw === '') channel = CHANNEL_SHORTCUT;
  else if (channelRaw === CHANNEL_SHORTCUT || channelRaw === CHANNEL_APP) channel = channelRaw;
  else return reply(400, 'לא נשלח, נסה שוב.');

  const senderRaw = form.get(SENDER_FIELD);
  // מה שלא ידוע נשאר לא ידוע: בלי שולח - NULL.
  const sender = typeof senderRaw === 'string' && senderRaw.length > 0 ? senderRaw : null;

  let contentHash;
  let saved;
  try {
    contentHash = hashText(text);
    // שתי פקודות קבועות ולא ערוץ כפרמטר: פקודת הקיצור נשארת זהה תו בתו לזו שלפני שלב 8.2א-1 (טקסט ופרמטרים), והערוץ במסד הוא תמיד אחד משני הקבועים.
    saved = channel === CHANNEL_APP
      ? await sql`
        INSERT INTO sources (channel, sender, raw_content, content_hash, received_at)
        VALUES ('app', ${sender}, ${text}, ${contentHash}, now())
        RETURNING id, received_at
      `
      : await sql`
        INSERT INTO sources (channel, sender, raw_content, content_hash, received_at)
        VALUES ('shortcut', ${sender}, ${text}, ${contentHash}, now())
        RETURNING id, received_at
      `;
  } catch (error) {
    // ההודעה לא נשמרה - לא מעלימים את זה: 500 לקיצור ("לא נשלח, נסה שוב"), ורישום ב-call_log אם אפשר.
    // לא רושמים את תוכן ההודעה בלוג.
    console.error('intake: שמירה ל-sources נכשלה:', error?.message);
    try {
      await sql`
        INSERT INTO call_log (kind, status_code, ok, started_at, duration_ms, error)
        VALUES ('intake', 500, false, now(), ${Date.now() - startedAt}, ${String(error?.message ?? error)})
      `;
    } catch (logError) {
      console.error('intake: גם הרישום ב-call_log נכשל:', logError?.message);
    }
    return reply(500, 'לא נשלח, נסה שוב.');
  }

  // ההודעה נשמרה. מכאן והלאה אין כשל שמחזיר שגיאה לקיצור: בלי מזהה שורה (כך לא ניתן לעבד) או עם כשל או תקיעה בעיבוד, התשובה "התקבל".
  const row = Array.isArray(saved) ? saved[0] : undefined;
  if (!row?.id) return reply(200, RECEIVED_REPLY);
  // הנחה, לא אומת: הדרייבר מחזיר timestamptz כ-Date. אם החותמת חסרה או לא ניתנת לפענוח, משתמשים בשעת ההגעה לשרת (פער של שניות לכל היותר), כדי שהעיבוד לא ייפול בשקט.
  const stamped = row.received_at instanceof Date || typeof row.received_at === 'string' ? new Date(row.received_at) : null;
  const receivedAt = stamped && !Number.isNaN(stamped.getTime()) ? row.received_at : new Date();
  let result = null;
  let failure = null;
  try {
    result = await withTimeout(
      processor({ sql, source: { id: row.id, channel, raw_content: text, content_hash: contentHash, received_at: receivedAt } }),
      processTimeoutMs,
    );
  } catch (error) {
    // רק שם השגיאה: לא תוכן ההודעה ולא message (שעלולה לכלול ערכים מהמסד).
    console.error('intake: עיבוד נכשל:', error?.name);
    failure = error?.name === 'TimeoutError' ? 'timeout' : 'error';
  }
  // רישום תוצאת העיבוד (46, M.1): מזהה המקור וקודים בלבד, בלי טקסט ובלי שולח. שורה אחת לכל מקור, בלי עדכון ובלי מחיקה.
  // כשל כאן לא משנה את התשובה לקיצור. הנחה, לא אומת: בלי timeout נפרד לכתיבה הזו (46 לא קובע; ההשפעה על זמן התגובה היא H5 שם).
  const outcome = outcomeFor({ channel, result, failure });
  if (outcome) {
    try {
      await sql`
        INSERT INTO intake_outcomes (source_id, status, reason)
        VALUES (${row.id}::uuid, ${outcome.status}, ${outcome.reason})
        ON CONFLICT (source_id) DO NOTHING
      `;
    } catch (error) {
      console.error('intake: רישום התוצאה נכשל:', error?.name);
    }
  }
  // התראה מאוגדת: רק הודעה שהועברה שנכתבה לה בועת "נרשם". מפתח אידמפוטנטיות לפי החלון: שלוש הודעות באותו חלון = הודעת תור אחת.
  if (channel === CHANNEL_SHORTCUT && result?.status === 'recorded') {
    try {
      const plan = planNotify(now());
      // הנחה, לא אומת: 3 שניות להמתנה לתור (בחירה שלי). תור תקוע לא יעכב את התשובה לקיצור; התראה שלא נשלחה = המספר יתעדכן בפתיחה הבאה.
      await withTimeout(sendQueue(SLOT_TOPIC, { kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, {
        delaySeconds: plan.delaySeconds, retentionSeconds: plan.retentionSeconds, idempotencyKey: plan.slotKey,
      }), NOTIFY_QUEUE_TIMEOUT_MS);
    } catch (error) {
      console.error('intake: שליחה לתור ההתראות נכשלה:', error?.name);
    }
  }
  // כתיבה ליומן Google (שלב 8.3-4, lib/event-sync.js): רק אחרי שהעיבוד נרשם במסד, ולאירוע של המקור הזה בלבד (match_key 'source:<id>').
  // בלי הגדרות Google או בלי חיבור: דילוג שקט. כל כשל נתפס ולא משנה את התשובה; כל קריאה ל-Google מוגבלת ב-FETCH_TIMEOUT_MS. הסריקה היומית משלימה מה שלא נכתב.
  if (result?.status === 'recorded') {
    try {
      await eventSync({ sql, sourceId: String(row.id), now: now() });
    } catch (error) {
      console.error('intake: כתיבה ליומן נכשלה:', error?.name);
    }
  }
  return reply(200, typeof result?.reply === 'string' && result.reply !== '' ? result.reply : RECEIVED_REPLY);
}

// הנחה, לא אומת: פורמט ה-handler הוא ה-Web Standard "export default { fetch }" לפי תיעוד Vercel
// (vercel.com/docs/functions/functions-api-reference, "fetch Web Standard"). לא נבדק בפריסה אמיתית.
export default {
  fetch(request) {
    // החיבור למסד נוצר רק כשצריך, כדי שדחייה של בקשה (401/405) לא תלויה ב-DATABASE_URL.
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
