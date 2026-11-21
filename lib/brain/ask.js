// קריאה אחת למוח (בלוק 3א; אפיון-מורחב ה-5, ה-6 וסעיף 4 "המוח שנבחר"): עוברת על רשימת המודלים שעברו את מבחן העברית, לפי הסדר,
// עד שאחד עונה בפורמט הנכון. המעבר בקוד בלבד, בלי AI (ה-6). מחובר לקליטה בבלוק 3ב-1 (lib/intake-brain.js).
//
//   askBrain({ sql, fetchFn, apiKey, now, prompt, schema?, notify?, timeoutMs? })   timeoutMs: הגבלת זמן לכל מודל (ברירת מחדל 30 שניות)
//     -> { ok: true, model, data }
//      | { ok: false, reason: 'exhausted', until (ISO), kind }   כל הרשימה חסומה במכסה
//      | { ok: false, reason: 'no-pool' }                         אף מודל לא עבר את המבחן ב-30 הימים האחרונים
//      | { ok: false, reason: 'failed' }                          כל המודלים הפנויים נכשלו בלי מכסה (5xx, רשת, פורמט)
//      | { ok: false, reason: 'no-key' }                          GEMINI_API_KEY לא מוגדר
//
// schema (אופציונלי): פונקציה (data) => boolean. תשובה שאינה JSON, או שהפונקציה לא מחזירה true = "לא בפורמט הנכון" = המודל הבא.
// כל קריאה נרשמת ב-call_log (kind='brain'); כל 429 נרשם ב-probe_log (probe='brain-quota'). המפתח ותוכן ההודעה לא נרשמים (safeMessage).
// כשל בקריאת המצב מהמסד נזרק; כשל בכתיבת לוג או בהתראה לא נזרק.
import { scrub, safeMessage, describeHttpError, geminiUrl } from '../ops/gate-probe.js';
import { classifyQuota, resetAt, quotaDetail, availableModels, poolExhaustion } from './models.js';
import { loadBrainState } from './state.js';
import { sendQuotaNotification } from '../chat-notify.js';

// הנחה, לא אומת: 30 שניות לקריאה, כמו ב-gate-probe. לא נמדד זמן תשובה בעבודה אמיתית.
const FETCH_TIMEOUT_MS = 30000;

// התראה אחת לאייפון כשהרשימה נגמרת (אפיון-מורחב סעיף 4). dedupe_key לפי שעת החזרה, ולכן פעם אחת לכל חלון.
const defaultNotify = (sql, now) => ({ until, kind }) =>
  sendQuotaNotification({ sql, secret: process.env.CRON_SECRET, until, kind, now });

async function logCall(sql, { status, ok, startedAt, error }) {
  try {
    await sql`
      INSERT INTO call_log (kind, status_code, ok, started_at, duration_ms, error)
      VALUES ('brain', ${status}, ${ok}, now(), ${Date.now() - startedAt}, ${error})
    `;
  } catch (logError) {
    console.error('brain: כתיבה ל-call_log נכשלה:', logError?.name);
  }
}

// קריאה אחת למודל אחד. מחזירה { status, data, error, quotaKind }. quotaKind רק ב-429.
async function callModel(fetchFn, apiKey, model, text, schema, timeoutMs) {
  let response;
  try {
    response = await fetchFn(geminiUrl(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      }),
    });
  } catch (error) {
    return { status: null, data: null, error: `שגיאת רשת: ${error?.message}` };
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    const error = await describeHttpError(new Response(raw, { status: response.status }));
    return { status: response.status, data: null, error, quotaKind: response.status === 429 ? classifyQuota(raw) : undefined };
  }
  try {
    const body = await response.json();
    const data = JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text);
    if (data === null || typeof data !== 'object') return { status: response.status, data: null, error: 'פורמט: התשובה אינה אובייקט JSON' };
    if (typeof schema === 'function' && schema(data) !== true) return { status: response.status, data: null, error: 'פורמט: התשובה לא עברה את הבדיקה' };
    return { status: response.status, data, error: null };
  } catch (error) {
    return { status: response.status, data: null, error: `פורמט: תשובה שאינה JSON תקין: ${error?.message}` };
  }
}

export async function askBrain({
  sql,
  fetchFn = fetch,
  apiKey = process.env.GEMINI_API_KEY,
  now = new Date(),
  prompt,
  schema,
  notify,
  timeoutMs = FETCH_TIMEOUT_MS,
}) {
  if (!apiKey) {
    console.error('GEMINI_API_KEY לא מוגדר בשרת');
    return { ok: false, reason: 'no-key' };
  }
  const { pool, quotaRows } = await loadBrainState(sql, now); // כשל מסד נזרק
  if (pool.length === 0) return { ok: false, reason: 'no-pool' };
  const exhaustedBefore = poolExhaustion(pool, quotaRows, now);
  if (exhaustedBefore) return { ok: false, reason: 'exhausted', until: exhaustedBefore.until.toISOString(), kind: exhaustedBefore.kind };

  const text = scrub(String(prompt ?? ''));
  const rows = [...quotaRows];
  for (const { model } of availableModels(pool, quotaRows, now)) {
    const startedAt = Date.now();
    const result = await callModel(fetchFn, apiKey, model, text, schema, timeoutMs);
    const error = result.error === null ? null : safeMessage(`model=${model}: ${result.error}`, apiKey, prompt);
    await logCall(sql, { status: result.status, ok: result.error === null, startedAt, error });
    if (result.error === null) return { ok: true, model, data: result.data };
    if (result.status === 429) {
      const detail = quotaDetail({ model, kind: result.quotaKind, until: resetAt(result.quotaKind, now) });
      rows.push({ detail });
      try {
        await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('brain-quota', ${false}, ${detail})`;
      } catch (insertError) {
        console.error('brain: כתיבת שורת מכסה נכשלה:', insertError?.name);
      }
    }
    // 429, 5xx, רשת, פורמט או כל קוד אחר: המודל הבא.
  }

  const exhausted = poolExhaustion(pool, rows, now);
  if (!exhausted) return { ok: false, reason: 'failed' };
  try {
    await (notify ?? defaultNotify(sql, now))(exhausted);
  } catch (error) {
    console.error('brain: התראת המכסה נכשלה:', error?.name);
  }
  return { ok: false, reason: 'exhausted', until: exhausted.until.toISOString(), kind: exhausted.kind };
}
