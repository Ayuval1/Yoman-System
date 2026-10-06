// בדיקת שער ל-Gemini (שלב 3). מקור: docs/05-chapter7/15-gate-success-criteria.md סעיפים 3 ו-6, build-rules 46.
// מה היא עושה: שולחת 20 משפטים בעברית ל-Gemini, משווה לתשובה הצפויה, רושמת call_log לכל קריאה
// ושורת סיכום אחת ב-probe_log. הסף (90%) הוא "מוצע" ולא אושר (15).
// הגנה: אותו מנגנון כמו api/cron-plan.js - CRON_SECRET בכותרת Authorization בפורמט "Bearer <סוד>". לא נוצר משתנה סביבה חדש לסוד.
// משתנה הסביבה היחיד החדש: GEMINI_API_KEY (המפתח; לעולם לא בקוד).
//
// מקורות (נבדקו ב-6.10.2026):
// - endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//   (ai.google.dev/api/generate-content). התיעוד מציג גם "Interactions API" חדש (.../v1beta/interactions) - לא השתמשנו בו.
// - שדות פלט JSON: generationConfig.responseMimeType = "application/json" (ai.google.dev/api/generate-content).
// - קריאת התשובה: candidates[0].content.parts[0].text (אותו עמוד).
// - כותרת מפתח: x-goog-api-key (ai.google.dev/gemini-api/docs/quickstart). עמוד generateContent מזכיר query string (?key=),
//   לא אומת שהכותרת מתקבלת גם ב-generateContent (הדוגמה בכותרת היא ל-Interactions). אם תחזור 401/403 - זה החשוד.
// - דגם: gemini-3.8-flash מופיע ב-ai.google.dev/gemini-api/docs/models וגם כ"Free of charge" ב-ai.google.dev/gemini-api/docs/pricing
//   (נקרא דרך סיכום של WebFetch, לא ישירות). מכסות בפועל (בקשות לדקה/ליום) - לא אומתו, נראות רק ב-AI Studio.
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const GEMINI_MODEL = 'gemini-3.8-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const PASS_THRESHOLD = 0.9; // מוצע, לא אושר (15)

const ALLOWED_ACTIONS = ['create_reminder', 'create_event', 'query_schedule', 'ask_clarification'];
const ALLOWED_WHEN = ['today_evening', 'tomorrow', 'tomorrow_morning', 'in_2_hours', 'this_week', null];

const INSTRUCTIONS = `אתה מפרש הודעות קצרות בעברית של נער בן 14 ליומן אישי.
החזר JSON בלבד, בלי טקסט נוסף, בצורה: {"action": "...", "when": "..."}
action חייב להיות אחד מ: ${ALLOWED_ACTIONS.join(', ')}.
when חייב להיות אחד מ: ${ALLOWED_WHEN.filter(Boolean).join(', ')}, או null אם אין מועד ברור.
אם ההודעה עמומה ואי אפשר לדעת מה לעשות - action הוא ask_clarification ו-when הוא null.
ההודעה:`;

function reply(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

function secretsMatch(given, expected) {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// הסרת פרטים מזהים לפני שליחה ל-Gemini (15 סעיף 6; build-rules 12).
// טלפון: regex פשוט (ספרות עם רווחים/מקפים/סימן +, 7 ספרות ומעלה).
// שמות: הסט הנוכחי נקי משמות. אין זיהוי שמות אוטומטי כאן - הנחה, לא אומת; לפני שימוש בטקסט אמיתי צריך מנגנון אמיתי.
export function scrub(text) {
  return text.replace(/\+?\d[\d\s\-()]{5,}\d/g, '[טלפון]');
}

function loadSentences() {
  const raw = readFileSync(new URL('../data/gate-test-sentences.json', import.meta.url), 'utf8');
  return JSON.parse(raw).sentences;
}

function normalizeWhen(value) {
  return value === undefined || value === '' ? null : value;
}

function isCorrect(actual, expected) {
  return (
    actual !== null &&
    typeof actual === 'object' &&
    actual.action === expected.action &&
    normalizeWhen(actual.when) === normalizeWhen(expected.when)
  );
}

// קורא ל-Gemini פעם אחת. לא עושה ניסיון חוזר.
async function askGemini(fetchFn, apiKey, text) {
  const response = await fetchFn(GEMINI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${INSTRUCTIONS}\n${scrub(text)}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    }),
  });
  if (!response.ok) {
    return { status: response.status, parsed: null, error: `HTTP ${response.status}` };
  }
  try {
    const data = await response.json();
    const answerText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { status: response.status, parsed: JSON.parse(answerText), error: null };
  } catch (error) {
    return { status: response.status, parsed: null, error: `תשובה שאינה JSON תקין: ${error?.message}` };
  }
}

// handle מקבל DB, fetch, משפטים ומפתח מבחוץ כדי שאפשר לבדוק בלי רשת ובלי מסד.
export async function handle(request, {
  sql,
  secret = process.env.CRON_SECRET,
  apiKey = process.env.GEMINI_API_KEY,
  fetchFn = fetch,
  sentences,
}) {
  if (request.method !== 'GET') {
    return reply(405, 'Method Not Allowed');
  }
  if (!secret) {
    console.error('CRON_SECRET לא מוגדר בשרת');
    return reply(401, 'Unauthorized');
  }
  if (!secretsMatch(request.headers.get('authorization'), `Bearer ${secret}`)) {
    return reply(401, 'Unauthorized');
  }
  // בלי מפתח - לא קוראים ל-API.
  if (!apiKey) {
    console.error('GEMINI_API_KEY לא מוגדר בשרת');
    return reply(500, 'GEMINI_API_KEY לא מוגדר בשרת. מוסיפים אותו ב-Vercel (Sensitive) ופורסים מחדש.');
  }

  const items = sentences ?? loadSentences();
  const failedIds = [];
  let passed = 0;
  let abortedAt = null;

  for (const item of items) {
    const startedAt = Date.now();
    let result;
    try {
      result = await askGemini(fetchFn, apiKey, item.text);
    } catch (error) {
      // שגיאת רשת: נרשם ועוצרים, בלי ניסיון חוזר.
      result = { status: null, parsed: null, error: `שגיאת רשת: ${error?.message}` };
    }

    const correct = result.error === null && isCorrect(result.parsed, item.expected);
    const callOk = result.error === null;
    try {
      // ב-error לא נרשם תוכן המשפט, רק סוג התקלה.
      await sql`
        INSERT INTO call_log (kind, status_code, ok, started_at, duration_ms, error)
        VALUES ('gate-gemini', ${result.status}, ${callOk}, now(), ${Date.now() - startedAt}, ${result.error})
      `;
    } catch (logError) {
      console.error('gate-probe: כתיבה ל-call_log נכשלה:', logError?.message);
    }

    if (correct) {
      passed += 1;
    } else {
      failedIds.push(item.id);
    }

    // 429 או רשת: עוצרים. המשפטים שנותרו לא רצו ונספרים ככישלון.
    if (result.status === 429 || result.status === null) {
      abortedAt = item.id;
      const index = items.indexOf(item);
      for (const rest of items.slice(index + 1)) failedIds.push(rest.id);
      break;
    }
  }

  const total = items.length;
  const ok = abortedAt === null && passed / total >= PASS_THRESHOLD;
  const detail = `${passed}/${total}; failed: ${failedIds.join(',') || 'none'}${abortedAt ? `; aborted_at=${abortedAt}` : ''}; model=${GEMINI_MODEL}`;
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('gate-gemini', ${ok}, ${detail})`;
  } catch (error) {
    console.error('gate-probe: כתיבה ל-probe_log נכשלה:', error?.message);
    return reply(500, 'Internal Server Error');
  }

  return reply(200, `${ok ? 'עבר' : 'לא עבר'}: ${detail}`);
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
// הנחה, לא אומת: קובץ data/gate-test-sentences.json נכלל בחבילת הפונקציה ב-Vercel (קריאה מהדיסק בזמן ריצה).
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
