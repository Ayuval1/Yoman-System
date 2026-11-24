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

// פיילוט (החלטת יובל 23.11.2026 לילה, הועברה דרך סשן מקביל: "שיחבר את המודל GEMINI שיפעיל את האפליקציה. לפחות המודלים שכבר עובדים שיתחילו הרצה פיילוט").
// חריג לשער 18/20 (אפיון-מורחב.md:226): כשאף מודל לא עבר את השער, המוח רץ על רשימת פיילוט קבועה. הרשימה שעברה את השער גוברת אוטומטית ברגע שיש בה מודל.
// כל השאר לא משתנה: כל תשובה נבדקת בקוד (schema), תשובה לא בפורמט = המודל הבא ואז הקוד; ההרשאות מהטבלה בקוד; 429 = חסימה במכסה והמודל הבא.
// הראיות (מהמסמכים, לא נבדקו מול probe_log בסשן הזה): gemini-3.5-flash-lite 19/20 מעורב (05-open-questions.md:548-552) ו-10/10 ב-s01–s10 ב-18–21.11 (מדווח);
// gemini-3.1-flash-lite 16 נכונים מ-17 שרצו ב-23.11 13:11 (מדווח). כיבוי: PILOT_ENABLED = false, או משתנה הסביבה BRAIN_PILOT=off (לא סוד).
export const PILOT_ENABLED = true;
export const PILOT_POOL = Object.freeze([
  Object.freeze({ model: 'gemini-3.5-flash-lite', reason: '19/20 (מעורב, 10.10) ו-10/10 ב-s01–s10 (18–21.11)' }),
  Object.freeze({ model: 'gemini-3.1-flash-lite', reason: '16 נכונים מ-17 (23.11)' }),
]);
export const PILOT_PROBE = 'brain-pilot';
export const pilotOn = (env = process.env) => PILOT_ENABLED && String(env?.BRAIN_PILOT ?? '').toLowerCase() !== 'off';

// תוצאת קריאה אחת בפיילוט, בלי טקסט: ok / format / quota / http-<קוד> / network.
export function pilotOutcome(result) {
  if (result.error === null) return 'ok';
  if (result.status === 429) return 'quota';
  if (result.status === null) return 'network';
  if (typeof result.error === 'string' && result.error.startsWith('פורמט')) return 'format';
  return `http-${result.status}`;
}

async function logPilot(sql, model, outcome) {
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES (${PILOT_PROBE}, ${outcome === 'ok'}, ${`model=${model}; outcome=${outcome}`})`;
  } catch (error) {
    console.error('brain: כתיבת שורת פיילוט נכשלה:', error?.name);
  }
}

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
  env = process.env,
}) {
  if (!apiKey) {
    console.error('GEMINI_API_KEY לא מוגדר בשרת');
    return { ok: false, reason: 'no-key' };
  }
  const state = await loadBrainState(sql, now); // כשל מסד נזרק
  const { quotaRows } = state;
  // גיבוי (24.11.2026, באישור יובל): מודלי הפיילוט נכנסים גם אחרי מי שעבר את השער, ולא רק כשהרשימה ריקה. מי שעבר את השער ראשון;
  // הפיילוט רק כשכולם נכשלו או חסומים. הסיבה: אחרי ש-gemini-3.1-flash-lite עבר, הרשימה הייתה מודל אחד, והשהיה אחת שלו שלחה הודעה מוקלדת לקוד ("מה זה?").
  const passed = new Set(state.pool.map(({ model }) => model));
  const backups = pilotOn(env) ? PILOT_POOL.filter(({ model }) => !passed.has(model)).map(({ model }) => ({ model })) : [];
  const pool = [...state.pool, ...backups];
  if (pool.length === 0) return { ok: false, reason: 'no-pool' };
  const exhaustedBefore = poolExhaustion(pool, quotaRows, now);
  if (exhaustedBefore) return { ok: false, reason: 'exhausted', until: exhaustedBefore.until.toISOString(), kind: exhaustedBefore.kind };

  const text = scrub(String(prompt ?? ''));
  const rows = [...quotaRows];
  for (const { model } of availableModels(pool, quotaRows, now)) {
    const pilot = !passed.has(model);
    const startedAt = Date.now();
    const result = await callModel(fetchFn, apiKey, model, text, schema, timeoutMs);
    const error = result.error === null ? null : safeMessage(`model=${model}: ${result.error}`, apiKey, prompt);
    await logCall(sql, { status: result.status, ok: result.error === null, startedAt, error });
    if (pilot) await logPilot(sql, model, pilotOutcome(result));
    if (result.error === null) return pilot ? { ok: true, model, data: result.data, pilot: true } : { ok: true, model, data: result.data };
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
