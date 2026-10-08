// נקודת הקליטה היחידה (שלב 1). מקור: docs/17 סעיפים 4-5, docs/03-app-channel-rules.md "פרטי הקלט", build-rules 23.
// מה היא עושה: מקבלת POST (Form) מהקיצור, בודקת סוד בכותרת, שומרת את ההודעה הגולמית ב-sources, עונה "התקבל".
// מה היא לא עושה: אין קריאה למודל, אין עיבוד, אין זיהוי כפילות ("כבר קיבלתי" - לא בשלב 1), אין תמונות.
import { createHash, timingSafeEqual } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

// הנחה, לא אומת: שם הכותרת של הסוד. אף מסמך לא קובע אותו (03-app-channel-rules: "סוד קבוע בכותרת").
const SECRET_HEADER = 'x-intake-secret';
// הנחה, לא אומת: שם משתנה הסביבה של הסוד. docs/20 כותב רק "סוד הקיצור" בלי שם.
const SECRET_ENV_NAME = 'INTAKE_SECRET';
// הנחה, לא אומת: שם שדה הטקסט ב-Form. אף מסמך לא קובע אותו.
const TEXT_FIELD = 'text';
// הנחה, לא אומת: שם שדה השולח ב-Form. 06 קובע רק שהעמודה sender היא "כפי שהערוץ מדווח".
const SENDER_FIELD = 'sender';
// הנחה, לא אומת: תקרת אורך לטקסט (תווים). 100,000 היא בחירה שלי, מעל כל הודעת וואטסאפ רגילה, כדי שהודעה ענקית לא תיכתב למסד. אף מסמך לא קובע ערך.
const MAX_TEXT_LENGTH = 100_000;

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

// handle מקבל את ה-DB מבחוץ (deps.sql) כדי שאפשר לבדוק בלי מסד אמיתי.
export async function handle(request, { sql, secret = process.env[SECRET_ENV_NAME] }) {
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
  // שלב 1: טקסט בלבד. הודעה בלי טקסט (תמונה בלבד) - לא נתמכת עדיין (docs/03-intake-rules.md "הודעה בלי טקסט", שלב מאוחר).
  // הנחה, לא אומת: מחזירים 400 ולא שומרים כלום. הטקסט נשמר כפי שהתקבל, בלי trim ובלי עיבוד.
  if (typeof text !== 'string' || text.length === 0) {
    return reply(400, 'לא נשלח, נסה שוב.');
  }
  // טקסט ארוך מהתקרה לא נשמר ולא נחתך: נדחה במפורש, כדי שלא ייווצר רושם שהתקבל.
  if (text.length > MAX_TEXT_LENGTH) {
    return reply(413, 'ההודעה ארוכה מדי, לא נשלחה.');
  }

  const senderRaw = form.get(SENDER_FIELD);
  // מה שלא ידוע נשאר לא ידוע: בלי שולח - NULL.
  const sender = typeof senderRaw === 'string' && senderRaw.length > 0 ? senderRaw : null;

  try {
    await sql`
      INSERT INTO sources (channel, sender, raw_content, content_hash, received_at)
      VALUES ('shortcut', ${sender}, ${text}, ${hashText(text)}, now())
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

  return reply(200, 'התקבל');
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
