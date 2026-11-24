// בדיקת שער ל-Gemini (שלב 3). מקור: docs/05-chapter7/15-gate-success-criteria.md סעיפים 3 ו-6, build-rules 46.
// מה היא עושה: שולחת 20 משפטים בעברית ל-Gemini, משווה לתשובה הצפויה, רושמת call_log לכל קריאה
// ושורת סיכום אחת ב-probe_log. הסף (90%) הוא "מוצע" ולא אושר (15).
// הגנה: אותו מנגנון כמו lib/ops/cron-plan.js - CRON_SECRET בכותרת Authorization בפורמט "Bearer <סוד>". לא נוצר משתנה סביבה חדש לסוד.
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
import { classifyQuota } from '../brain/models.js'; // מעגל ייבוא עם models.js: בטוח, כי שני הצדדים משתמשים בייבוא רק בתוך פונקציות
import { neon } from '@neondatabase/serverless';

const DEFAULT_MODEL = 'gemini-3.8-flash';
// הנחה, לא אומת: gemini-3.5-flash-lite קיים וזמין במסלול החינמי. מקור: אשכול בפורום Google AI Developers מ-6.10.2026,
// שבו משתמש כתב שהחלפה אליו עקפה 503 (discuss.ai.google.dev/t/gemini-3-8-flash-api-returns-503-but-ai-studio-works/187076).
// רשימה סגורה: פרמטר model לא יכול להיות מחרוזת חופשית שנכנסת לכתובת.
// gemini-3.1-flash-lite: נוסף 24.11.2026 כדי שאפשר יהיה להמשיך אותו ידנית (resume=1). 16 נכונים מ-17 ב-23.11 (מדווח, לא נבדק מול probe_log בסשן הבנייה).
const ALLOWED_MODELS = [DEFAULT_MODEL, 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
const LIST_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
// שם מודל שמגיע מ-ListModels (אחרי הסרת "models/") חייב לעבור תבנית קפדנית לפני שנכנס לכתובת - אותה סיבה שהרשימה הסגורה קיימת.
// 24.11.2026: גם gemma- (מחקר קטן, docs/07-guides/106-ai-brain-research-2026-11-24.md): לפי מקורות צד שלישי, ל-Gemma יש מכסה חינמית גדולה בהרבה מ-Flash (לא אומת מול Google). השער בודק אותם כמו כל מודל.
export const MODEL_NAME_PATTERN = /^(?:gemini|gemma)-[a-z0-9.\-]+$/;
// מודלים שאינם לבדיקת טקסט, וניסיוניים: יוצאים מהרוטציה.
// נוספו אחרי ריצות 22-23.11.2026 (probe_log): מודלי תמונה ורב-מודליות קיבלו 429 במשפט הראשון (אין להם מכסה חינמית לטקסט).
const EXCLUDED_NAME_PARTS = ['embedding', 'embed', 'tts', 'image', 'live', 'audio', 'preview', 'exp', 'omni', 'nano', 'banana', 'imagen', 'veo', 'aqa', 'lyria', 'robotics', 'computer-use', 'video'];
const MAX_LIST_PAGES = 10; // מגן מפני לולאת pageToken אינסופית
const DAY_MS = 86400000;
// הנחה, לא אומת: יומיים הם משך סביר לדלג על מודל בלי מכסה חינמית (429 במשפט הראשון בלי PerDay בגוף). Google לא מפרסמת מתי זה משתנה.
export const NO_FREE_QUOTA_SKIP_DAYS = 2;
// המשך ריצה שנחתכה בתקציב הזמן: רק אם הריצה הקודמת של אותו מודל קרובה. הנחה, לא אומת: 36 שעות מספיקות (המכסה היומית מתאפסת בחצות פסיפיק).
export const RESUME_WINDOW_MS = 36 * 3600000;
const HISTORY_WINDOW_DAYS = 30;
// מודל שנתקע בתקלות טכניות (24.11.2026): STUCK_RUNS ריצות אחרונות רצופות בלי אף תשובה אמיתית (new=0) = מדולג STUCK_COOLDOWN_DAYS ימים מהאחרונה.
// כך מודל שמחזיר 5xx / 200 שאינו JSON / 400 בכל ריצה לא נבחר שוב ושוב ושורף מכסה. הנחה, לא אומת: 3 ריצות ויומיים.
export const STUCK_RUNS = 3;
export const STUCK_COOLDOWN_DAYS = 2;
// שתי תקלות טכניות רצופות עם 200 (תשובה שאינה JSON): עוצרים את הריצה, כדי לא לשרוף את כל הסט על מודל שלא עונה בפורמט.
const MAX_TECH_STREAK = 2;
export const geminiUrl = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
export const PASS_THRESHOLD = 0.9; // מוצע, לא אושר (15)

// מגבלות מסלול חינמי של Gemini 3.8 Flash אצל יובל (AI Studio): 5 בקשות לדקה, 20 ביום.
// חישוב ההשהיה: 60 שניות / 5 בקשות = 12 שניות בין קריאות, ועוד שנייה מרווח = 13 שניות.
// קבוצה של 10 משפטים = 9 השהיות * 13 = 117 שניות (ההשהיה לא לפני הראשונה).
const CALL_GAP_MS = 13000;
const MAX_BATCH = 10; // 20 ביום: שתי קבוצות של 10 בשני ימים נפרדים.

// ניסיון חוזר על 5xx (503 "high demand" וכו'): Google ממליצה על השהיה גדלה (ai.google.dev/gemini-api/docs/troubleshooting).
// עד שני ניסיונות נוספים למשפט, אחרי 20 ו-40 שניות. תקציב הזמן הכולל נשאר מתחת ל-maxDuration (300 שניות).
// הנחה, לא אומת: שניסיון חוזר שנכשל אינו נספר יותר ממכסה אחת; כל ניסיון נרשם ב-call_log.
const RETRY_WAITS_MS = [20000, 40000];
// ריצה ב-8.10.2026 נחתכה ב-"Task timed out after 300 seconds" (מדווח מלוגי Vercel), כך שגם maxDuration=300 נקרא בפועל,
// וגם שורת probe_log לא נכתבה. לכן: תקציב זמן כולל שנבדק לפני כל משפט וכל ניסיון חוזר, וזמן מקסימלי לכל קריאה.
const FETCH_TIMEOUT_MS = 30000;
const TIME_BUDGET_MS = 280000;

// הנחה, לא אומת: ש-Fluid Compute פעיל בפרויקט. לפי vercel.com/docs/functions/configuring-functions/duration
// (עודכן 24.8.2026) ב-Hobby עם Fluid Compute ברירת המחדל והמקסימום הם 300 שניות.
// הנחה, לא אומת: שהפורמט export const config = { maxDuration } נקרא גם כשה-handler הוא "export default { fetch }".
export const config = { maxDuration: 300 };

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ALLOWED_ACTIONS = ['create_reminder', 'create_event', 'query_schedule', 'ask_clarification'];
const ALLOWED_WHEN = ['today', 'today_afternoon', 'today_evening', 'tomorrow', 'tomorrow_morning', 'in_2_hours', 'this_week', 'next_week', null];

const INSTRUCTIONS = `אתה מפרש הודעות קצרות בעברית של נער בן 14 ליומן אישי.
החזר JSON בלבד, בלי טקסט נוסף, בצורה: {"action": "...", "when": "..."}
action חייב להיות אחד מ: ${ALLOWED_ACTIONS.join(', ')}.
when חייב להיות אחד מ: ${ALLOWED_WHEN.filter(Boolean).join(', ')}, או null אם אין מועד ברור.
פירוש ה-action:
create_reminder - משימה או דבר לזכור לעשות (להכין, לקנות, ללמוד, להביא).
create_event - דבר עם שעה או פגישה עם אנשים אחרים, שתופס חלון זמן קבוע ביומן.
query_schedule - שאלה על מה מתוכנן.
ask_clarification - הודעה עמומה שאי אפשר לדעת ממנה מה לעשות.
כלל ל-when: קבע אותו רק לפי מילת זמן שכתובה בהודעה (למשל מחר, הערב, בשבוע הבא). אם אין בהודעה מילת זמן, when הוא null. אסור להשלים או לנחש מועד.
יום בשבוע (למשל ביום שלישי, ביום ראשון) הוא מילת זמן: בלי המילה "הבא" when הוא this_week, ועם "הבא" when הוא next_week.
דוגמאות:
"להתקשר לסבתא" -> {"action": "create_reminder", "when": null}
"לסדר את החדר מחר בבוקר" -> {"action": "create_reminder", "when": "tomorrow_morning"}
"פגישה עם המורה מחר" -> {"action": "create_event", "when": "tomorrow"}
"מה יש לי הערב?" -> {"action": "query_schedule", "when": "today_evening"}
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
  const raw = readFileSync(new URL('../../data/gate-test-sentences.json', import.meta.url), 'utf8');
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

// אבחון: מוציא מגוף שגיאה של Google רק error.status/error.message (JSON), חתוך ל-200 תווים.
// גוף שאינו JSON (או בלי error) - רק הסטטוס. לא נרשמים כותרות, בקשה או מפתח.
// מיוצא גם ל-lib/brain/ask.js (בלוק 3א).
export async function describeHttpError(response) {
  let extra = '';
  try {
    const body = JSON.parse(await response.text());
    const parts = [body?.error?.status, body?.error?.message].filter((p) => typeof p === 'string' && p.length > 0);
    extra = parts.join(': ').slice(0, 200);
  } catch {
    extra = '';
  }
  return extra ? `HTTP ${response.status} ${extra}` : `HTTP ${response.status}`;
}

// מסיר מהודעה כל הופעה של המפתח או של תוכן המשפט, ומקצר. בטיחות נוספת - לא אמור להופיע שם בכלל.
// מיוצא גם ל-lib/brain/ask.js (בלוק 3א).
export function safeMessage(message, apiKey, sentenceText) {
  let out = String(message ?? '');
  for (const secretValue of [apiKey, sentenceText]) {
    if (secretValue) out = out.split(secretValue).join('[הוסר]');
  }
  return out.slice(0, 220);
}

// Gemma (24.11.2026): Google מחזיר HTTP 400 "JSON mode is not enabled for this model" כש-responseMimeType נשלח (call_log 24.11 08:56).
// לכן ל-gemma- הבקשה נשלחת בלי מצב JSON, והתשובה נקראת מהטקסט: JSON נקי, או עטוף ב-```json, או האובייקט הראשון בטקסט.
// ל-Gemini לא משתנה כלום: מצב JSON וקריאה קפדנית. הבדיקה של התוכן (השער / schema במוח) נשארת כמו שהיא.
export const jsonModeSupported = (model) => !String(model ?? '').startsWith('gemma-');
export const generationConfigFor = (model) => (jsonModeSupported(model) ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0 });
export function parseModelText(model, text) {
  if (jsonModeSupported(model)) return JSON.parse(text);
  const raw = String(text ?? '').trim();
  try {
    return JSON.parse(raw);
  } catch {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)?.[1];
    if (fenced !== undefined) return JSON.parse(fenced.trim());
    const from = raw.indexOf('{');
    const to = raw.lastIndexOf('}');
    if (from === -1 || to <= from) throw new SyntaxError('אין אובייקט JSON בטקסט');
    return JSON.parse(raw.slice(from, to + 1));
  }
}

// קורא ל-Gemini פעם אחת. לא עושה ניסיון חוזר.
async function askGemini(fetchFn, apiKey, text, model) {
  const response = await fetchFn(geminiUrl(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${INSTRUCTIONS}\n${scrub(text)}` }] }],
      generationConfig: generationConfigFor(model),
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    return { status: response.status, parsed: null, error: await describeHttpError(new Response(raw, { status: response.status })), quotaKind: response.status === 429 ? classifyQuota(raw) : undefined };
  }
  try {
    const data = await response.json();
    const answerText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return { status: response.status, parsed: parseModelText(model, answerText), error: null };
  } catch (error) {
    return { status: response.status, parsed: null, error: `תשובה שאינה JSON תקין: ${error?.message}` };
  }
}

// ListModels: קריאה אחת (עם pageToken אם יש). מחזיר { names } ממוין אלפביתית, או { error }.
// הנחה, לא אומת מול Google: מבנה התשובה { models: [{ name: "models/...", supportedGenerationMethods: [...] }], nextPageToken }.
async function listRotationModels(fetchFn, apiKey) {
  const found = new Set();
  let pageToken = null;
  try {
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const url = pageToken ? `${LIST_MODELS_URL}?pageToken=${encodeURIComponent(pageToken)}` : LIST_MODELS_URL;
      const response = await fetchFn(url, { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!response.ok) return { error: await describeHttpError(response) };
      const data = await response.json();
      for (const entry of data?.models ?? []) {
        const full = typeof entry?.name === 'string' ? entry.name : '';
        if (!full.startsWith('models/gemini-') && !full.startsWith('models/gemma-')) continue;
        const name = full.slice('models/'.length);
        if (!MODEL_NAME_PATTERN.test(name)) continue;
        if (EXCLUDED_NAME_PARTS.some((part) => name.includes(part))) continue;
        if (!Array.isArray(entry.supportedGenerationMethods) || !entry.supportedGenerationMethods.includes('generateContent')) continue;
        found.add(name);
      }
      pageToken = typeof data?.nextPageToken === 'string' && data.nextPageToken ? data.nextPageToken : null;
      if (!pageToken) break;
    }
  } catch (error) {
    return { error: `שגיאת רשת או תשובה לא תקינה: ${error?.message}` };
  }
  return { names: [...found].sort() };
}

// שורת gate-gemini -> רשומה לבחירת מודל, או null. הפורמט נכתב בסוף handle ונקרא גם ב-lib/brain/models.js (parsePassRow).
export function parseGateRow(row) {
  if (!row || typeof row.detail !== 'string') return null;
  const at = new Date(row.at).getTime();
  const model = /(?:^|; )model=([^;|\s]+)/.exec(row.detail)?.[1];
  if (Number.isNaN(at) || !model || !MODEL_NAME_PATTERN.test(model)) return null;
  const score = /(?:^|; )(\d+)\/(\d+) ran=(\d+)/.exec(row.detail);
  const ids = (label) => {
    const match = new RegExp(`; ${label}: ([^;|]*)`).exec(row.detail);
    return match ? match[1].split(',').map((x) => x.trim()).filter((x) => x && x !== 'none') : [];
  };
  const flag = (name) => new RegExp(`; ${name}(?:;|$| \\|)`).test(row.detail);
  return {
    model,
    at,
    ok: row.ok === true,
    passed: score ? Number(score[1]) : 0,
    total: score ? Number(score[2]) : 0,
    ran: score ? Number(score[3]) : 0,
    failedIds: ids('failed'),
    notRunIds: ids('not-run'),
    techIds: ids('tech'),
    fresh: /(?:^|; )new=(\d+)/.test(row.detail) ? Number(/(?:^|; )new=(\d+)/.exec(row.detail)[1]) : null,
    timeBudget: flag('time_budget'),
    unavailable: flag('model_unavailable'),
    noFreeQuota: flag('no_free_quota'),
  };
}

// בחירת המודל לריצה. דטרמיניסטי, בלי רשת.
// 1) מודל שנרשם ב-404 (model_unavailable) לא נבחר לעולם. 2) מודל בלי מכסה חינמית (no_free_quota) מדולג 7 ימים.
// 3) קודם מודל שאפשר להמשיך (ריצה שנחתכה בתקציב זמן ועוד יכולה לעבור את הסף), הטוב ביותר ראשון.
// 4) אחר כך מודל שלא נבדק מעולם, לפי הרוטציה היומית (הראשון הפנוי מהמקום שהרוטציה מצביעה עליו). 5) ואז כל השאר.
// הריצה הקודמת של המודל שאפשר להמשיך (24.11.2026): השורה האחרונה שלו, קרובה (RESUME_WINDOW_MS), על הסט המלא (total = size), שלא עברה ולא 404,
// ושיש בה משפטים שלא קיבלו תשובה אמיתית (not-run או tech) ושעוד יכולה להגיע לסף. תקלה טכנית או חיתוך זמן לעולם לא נספרים כתשובה שגויה.
export function resumeFrom(last, { nowMs, size }) {
  if (!last || last.ok || last.unavailable || nowMs - last.at > RESUME_WINDOW_MS) return null;
  if (!size || last.total !== size) return null;
  const pendingIds = [...new Set([...last.techIds, ...last.notRunIds])];
  if (pendingIds.length === 0) return null;
  if ((last.passed + pendingIds.length) / size < PASS_THRESHOLD) return null;
  return { passed: last.passed, ran: last.ran, failedIds: last.failedIds, pendingIds };
}

// מודל תקוע: STUCK_RUNS השורות האחרונות שלו (בחלון ההמשך) כולן new=0. מחזיר את רגע הסיום של הקירור, או null.
// השורות האחרונות של המודל, בלי קשר לחלון ההמשך (ריצה אחת ביום = 3 ריצות ב-48 שעות). אחרי הקירור הוא מקבל ריצה אחת; אם גם בה אין תשובה, שוב קירור.
export function stuckUntil(rows, nowMs) {
  const recent = rows.filter((row) => row.at <= nowMs).sort((a, b) => b.at - a.at).slice(0, STUCK_RUNS);
  if (recent.length < STUCK_RUNS || !recent.every((row) => row.fresh === 0)) return null;
  const until = recent[0].at + STUCK_COOLDOWN_DAYS * DAY_MS;
  return until > nowMs ? until : null;
}

export function pickRotationModel({ names, history, nowMs, slot, slots, size = 20 }) {
  const latest = new Map();
  const blocked = new Set();
  const byModel = new Map();
  for (const row of history) {
    if (row.unavailable) blocked.add(row.model);
    if (row.noFreeQuota && nowMs - row.at < NO_FREE_QUOTA_SKIP_DAYS * DAY_MS) blocked.add(row.model);
    const current = latest.get(row.model);
    if (!current || row.at > current.at) latest.set(row.model, row);
    byModel.set(row.model, [...(byModel.get(row.model) ?? []), row]);
  }
  for (const [model, rows] of byModel) if (stuckUntil(rows, nowMs) !== null) blocked.add(model);
  const eligible = names.filter((name) => !blocked.has(name));
  if (eligible.length === 0) return { model: null, resume: null, eligible: 0, excluded: names.length };
  const resumable = [];
  for (const name of eligible) {
    const last = latest.get(name);
    // עדיפות להמשך רק אחרי ריצה שהיו בה תשובות אמיתיות. ריצה של תקלות טכניות בלבד (new=0) לא מקבלת עדיפות, אחרת מודל שבור היה חוסם את הרוטציה.
    const resume = last && last.fresh !== 0 ? resumeFrom(last, { nowMs, size }) : null;
    if (resume) resumable.push({ ...last, resume });
  }
  const counts = { eligible: eligible.length, excluded: names.length - eligible.length };
  if (resumable.length > 0) {
    resumable.sort((a, b) => b.passed / Math.max(1, b.ran) - a.passed / Math.max(1, a.ran) || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0));
    const best = resumable[0];
    return { model: best.model, resume: best.resume, ...counts };
  }
  const start = (Math.floor(nowMs / DAY_MS) * slots + slot) % names.length;
  const walk = [...names.slice(start), ...names.slice(0, start)].filter((name) => !blocked.has(name));
  return { model: walk.find((name) => !latest.has(name)) ?? walk[0], resume: null, ...counts };
}

// handle מקבל DB, fetch, משפטים ומפתח מבחוץ כדי שאפשר לבדוק בלי רשת ובלי מסד.
export async function handle(request, {
  sql,
  secret = process.env.CRON_SECRET,
  apiKey = process.env.GEMINI_API_KEY,
  fetchFn = fetch,
  sentences,
  sleep = realSleep, // ניתן להזרקה כדי שבדיקות לא ימתינו באמת
  now = Date.now,
}) {
  const runStartedAt = now();
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
  // פרמטרים: from (ברירת מחדל 0) ו-count (ברירת מחדל 10, מקסימום 10). ערך לא תקין - 400, בלי קריאה ל-Gemini.
  const params = new URL(request.url).searchParams;
  const fromRaw = params.get('from') ?? '0';
  const countRaw = params.get('count') ?? String(MAX_BATCH);
  if (!/^[0-9]{1,6}$/.test(fromRaw) || !/^[0-9]{1,6}$/.test(countRaw)) {
    return reply(400, 'from ו-count חייבים להיות מספרים שלמים לא שליליים.');
  }
  const modelParam = params.get('model') ?? DEFAULT_MODEL;
  const rotate = modelParam === 'rotate';
  // כמה מודלים ביום: כל משימת Cron נושאת slot (0 עד slots-1), וכולן יחד בודקות slots מודלים שונים ביום.
  const slotRaw = params.get('slot') ?? '0';
  const slotsRaw = params.get('slots') ?? '1';
  if (!/^[0-9]{1,2}$/.test(slotRaw) || !/^[0-9]{1,2}$/.test(slotsRaw) || Number(slotsRaw) < 1 || Number(slotRaw) >= Number(slotsRaw)) {
    return reply(400, 'slot ו-slots: מספרים שלמים, slots לפחות 1, ו-slot קטן מ-slots.');
  }
  const slot = Number(slotRaw);
  const slots = Number(slotsRaw);
  let model = modelParam;
  if (!rotate && !ALLOWED_MODELS.includes(model)) {
    return reply(400, `model חייב להיות אחד מ: ${ALLOWED_MODELS.join(', ')}.`);
  }
  const from = Number(fromRaw);
  const count = Number(countRaw);
  if (count < 1 || count > MAX_BATCH) {
    return reply(400, `count חייב להיות בין 1 ל-${MAX_BATCH}.`);
  }
  // בלי מפתח - לא קוראים ל-API.
  if (!apiKey) {
    console.error('GEMINI_API_KEY לא מוגדר בשרת');
    return reply(500, 'GEMINI_API_KEY לא מוגדר בשרת. מוסיפים אותו ב-Vercel (Sensitive) ופורסים מחדש.');
  }

  const allItems = sentences ?? loadSentences();
  if (from >= allItems.length) {
    return reply(400, `from חורג: יש ${allItems.length} משפטים (from מ-0 עד ${allItems.length - 1}).`);
  }
  // rotate: תמיד כל המשפטים (from ו-count לא נקראים). אחרת: הטווח המבוקש.
  let items = rotate ? allItems : allItems.slice(from, from + count);
  let poolNote = '';
  let resume = null; // ריצה שממשיכה ריצה קודמת של אותו מודל שנחתכה בתקציב הזמן
  if (rotate) {
    const listed = await listRotationModels(fetchFn, apiKey);
    const names = listed.names ?? [];
    if (listed.error !== undefined || names.length === 0) {
      // לא ממציאים מודל: רושמים כישלון ומסיימים.
      const why = listed.error !== undefined ? safeMessage(listed.error, apiKey, '') : 'אין מודלים מתאימים ברשימה';
      const failDetail = `rotate; ListModels: ${why}; pool=${names.length}`.slice(0, 1500);
      try {
        await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('gate-gemini', ${false}, ${failDetail})`;
      } catch (error) {
        console.error('gate-probe: כתיבה ל-probe_log נכשלה:', error?.message);
        return reply(500, 'Internal Server Error');
      }
      return reply(200, `לא עבר: ${failDetail}`);
    }
    // היסטוריה מ-probe_log (בלי טבלה חדשה): 30 הימים האחרונים, ובנוסף כל שורה עם model_unavailable (404 קבוע, בלי הגבלת זמן).
    const since = new Date(now() - HISTORY_WINDOW_DAYS * DAY_MS).toISOString();
    let historyRows = [];
    try {
      const result = await sql`
        SELECT ok, detail, at FROM probe_log
        WHERE probe = 'gate-gemini' AND (at > ${since}::timestamptz OR detail LIKE '%; model_unavailable%')
        ORDER BY at DESC LIMIT 500
      `;
      historyRows = Array.isArray(result) ? result : [];
    } catch (error) {
      console.error('gate-probe: קריאת היסטוריה מ-probe_log נכשלה:', error?.message); // בלי היסטוריה: רוטציה רגילה
    }
    // בלי היסטוריה זו אותה בחירה כמו קודם: מספר הימים מאז 1.1.1970 לפי UTC, כפול מספר המשבצות ביום, ועוד המשבצת.
    const picked = pickRotationModel({ names, history: historyRows.map(parseGateRow).filter(Boolean), nowMs: now(), slot, slots, size: allItems.length });
    if (picked.model === null) {
      const failDetail = `rotate; אין מודל מתאים אחרי סינון היסטוריה; pool=${names.length}; excluded=${picked.excluded}`.slice(0, 1500);
      try {
        await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('gate-gemini', ${false}, ${failDetail})`;
      } catch (error) {
        console.error('gate-probe: כתיבה ל-probe_log נכשלה:', error?.message);
        return reply(500, 'Internal Server Error');
      }
      return reply(200, `לא עבר: ${failDetail}`);
    }
    model = picked.model;
    resume = picked.resume;
    poolNote = `; pool=${picked.eligible}; slot=${slot}/${slots}`;
  }
  // resume=1 עם מודל מהרשימה הסגורה (24.11.2026): ממשיכים את הריצה האחרונה של המודל הזה אם אפשר; אחרת כל הסט. כך אפשר לכוון מודל מסוים בלי לחכות לרוטציה.
  if (!rotate && params.get('resume') === '1') {
    let rows = [];
    try {
      const result = await sql`
        SELECT ok, detail, at FROM probe_log
        WHERE probe = 'gate-gemini' AND at > ${new Date(now() - RESUME_WINDOW_MS).toISOString()}::timestamptz
        ORDER BY at DESC LIMIT 200
      `;
      rows = (Array.isArray(result) ? result : []).map(parseGateRow).filter((row) => row && row.model === model);
    } catch (error) {
      console.error('gate-probe: קריאת היסטוריה מ-probe_log נכשלה:', error?.message);
    }
    const last = rows.sort((a, b) => b.at - a.at)[0];
    if (last?.ok) return reply(200, `כבר עבר: ${model} (${last.passed}/${last.total}). לא הורץ כלום.`);
    resume = resumeFrom(last, { nowMs: now(), size: allItems.length });
    items = allItems;
  }
  if (resume) items = allItems.filter((item) => resume.pendingIds.includes(item.id));
  if (items.length === 0) {
    // המשך שכל ה-id שלו כבר לא קיימים בסט הנוכחי: לא ממציאים תוצאה.
    return reply(200, 'אין משפטים להרצה (ids של המשך לא נמצאו בסט)');
  }
  const failedIds = []; // תשובה אמיתית ושגויה בלבד
  const techIds = []; // תקלה טכנית (HTTP שאינו 200, 200 שאינו JSON, רשת): לא תשובה, לא נספר ככישלון, וממשיכים אותו בריצה הבאה (24.11.2026)
  const notRunIds = []; // לא רצו כי נעצרנו: לא נספרים ככישלון איכות.
  let techStreak = 0;
  let passed = 0;
  let ran = 0;
  let answeredNow = 0;
  let abortedAt = null;
  let retriesUsed = 0;
  let timeBudgetHit = false;
  let modelUnavailable = false; // 404: המודל לא קיים או לא זמין למשתמשים חדשים. נרשם, וכך לא נבחר שוב.
  let noFreeQuota = false; // 429 בהודעת מכסה במשפט הראשון של ריצה רגילה. הנחה, לא אומת: זה "אין מכסה חינמית" ולא מכסה יומית שנגמרה.
  const problems = []; // אבחון: id + status + הודעה קצרה לכל משפט שנכשל (בלי תוכן משפט).

  for (const item of items) {
    // השהיה בין קריאות (לא לפני הראשונה), כדי לא לחרוג מ-5 בקשות לדקה.
    // אם ההשהיה ועוד קריאה אחת בזמן המקסימלי חורגות מהתקציב: עוצרים לפני כן, כדי שהפונקציה תסיים ותכתוב את שורת הסיכום.
    if (ran > 0) {
      if (now() - runStartedAt + CALL_GAP_MS + FETCH_TIMEOUT_MS > TIME_BUDGET_MS) {
        abortedAt = item.id;
        timeBudgetHit = true;
        for (const rest of items.slice(items.indexOf(item))) notRunIds.push(rest.id);
        break;
      }
      await sleep(CALL_GAP_MS);
    }
    ran += 1;
    let result;
    // ניסיון ראשון ועד שני ניסיונות חוזרים, רק על 5xx. 429, שגיאת רשת וכל קוד אחר: בלי ניסיון חוזר.
    for (let attempt = 0; ; attempt += 1) {
      const startedAt = Date.now();
      try {
        result = await askGemini(fetchFn, apiKey, item.text, model);
      } catch (error) {
        // שגיאת רשת: נרשם ועוצרים, בלי ניסיון חוזר.
        result = { status: null, parsed: null, error: `שגיאת רשת: ${error?.message}` };
      }

      // ההודעה נוקה לפני שהיא נרשמת (ב-call_log וגם בתשובה): בלי מפתח ובלי תוכן משפט, ומקוצרת.
      if (result.error !== null) result.error = safeMessage(result.error, apiKey, item.text);
      try {
        // ב-error לא נרשם תוכן המשפט, רק סוג התקלה. כל ניסיון נרשם בנפרד.
        await sql`
          INSERT INTO call_log (kind, status_code, ok, started_at, duration_ms, error)
          VALUES ('gate-gemini', ${result.status}, ${result.error === null}, now(), ${Date.now() - startedAt}, ${result.error})
        `;
      } catch (logError) {
        console.error('gate-probe: כתיבה ל-call_log נכשלה:', logError?.message);
      }

      const retryable = result.status !== null && result.status >= 500;
      const wait = RETRY_WAITS_MS[attempt];
      if (!retryable || wait === undefined || now() - runStartedAt + wait + FETCH_TIMEOUT_MS > TIME_BUDGET_MS) break;
      retriesUsed += 1;
      await sleep(wait);
    }
    const answered = result.error === null;
    if (answered) {
      techStreak = 0;
      answeredNow += 1;
      if (isCorrect(result.parsed, item.expected)) {
        passed += 1;
      } else {
        failedIds.push(item.id);
        // תשובה שגויה של המודל: נרשמים רק הערכים שהחזיר, חתוכים.
        problems.push(`${item.id} [${result.status}] ${safeMessage(`wrong answer: action=${String(result.parsed?.action).slice(0, 30)} when=${String(result.parsed?.when).slice(0, 30)}`, apiKey, item.text)}`);
      }
    } else {
      techIds.push(item.id);
      techStreak += 1;
      problems.push(`${item.id} [${result.status ?? 'net'}] ${safeMessage(result.error, apiKey, item.text)}`);
    }

    if (result.status === 404) {
      // כל שאר המשפטים יקבלו 404 גם הם: עוצרים מיד.
      modelUnavailable = true;
      abortedAt = item.id;
      for (const rest of items.slice(items.indexOf(item) + 1)) notRunIds.push(rest.id);
      break;
    }
    if (result.status === 429 && !resume && ran === 1 && /quota/i.test(result.error ?? '') && result.quotaKind !== 'daily') noFreeQuota = true;

    // 429, רשת, כל קוד שאינו 2xx (5xx אחרי הניסיונות החוזרים, 400 ו-4xx אחרים), או 200 שאינו JSON פעמיים ברצף: עוצרים כדי לא לבזבז מכסה.
    // המשפטים שנותרו מסומנים not-run. 400 לא מסמן את המודל כלא-זמין (רק 404 מסמן).
    if (result.status === 429 || result.status === null || result.status < 200 || result.status >= 300 || techStreak >= MAX_TECH_STREAK) {
      abortedAt = item.id;
      const index = items.indexOf(item);
      for (const rest of items.slice(index + 1)) notRunIds.push(rest.id);
      break;
    }
  }

  // המשך ריצה: מאחדים עם התוצאה הקודמת, והציון והסף נקבעים על הכול יחד (resumed_from ו-prior ברשומה).
  // ran = תשובות אמיתיות (נכונה או שגויה) על כל הריצות המאוחדות; תקלה טכנית ו-not-run לא נכנסים. עובר כשיש לפחות 90% נכונות מכל הסט (18 מתוך 20),
  // גם אם חלק מהמשפטים עוד לא קיבלו תשובה (הם לא יכולים להוריד את הציון).
  const passedAll = (resume?.passed ?? 0) + passed;
  const ranAll = (resume?.ran ?? 0) + answeredNow;
  const failedAll = [...(resume?.failedIds ?? []), ...failedIds];
  const span = resume || (!rotate && params.get('resume') === '1') ? allItems : items;
  const ok = passedAll / span.length >= PASS_THRESHOLD;
  const range = `${span[0].id}-${span[span.length - 1].id}`;
  const resumeNote = resume ? `; resumed_from=${resume.pendingIds[0]}; prior=${resume.passed}/${resume.ran}` : '';
  const flags = `${modelUnavailable ? '; model_unavailable' : ''}${noFreeQuota ? '; no_free_quota' : ''}`;
  const detail = `range=${range}; ${passedAll}/${span.length} ran=${ranAll}; failed: ${failedAll.join(',') || 'none'}${techIds.length ? `; tech: ${techIds.join(',')}` : ''}${notRunIds.length ? `; not-run: ${notRunIds.join(',')}` : ''}${abortedAt ? `; aborted_at=${abortedAt}` : ''}${retriesUsed ? `; retries=${retriesUsed}` : ''}; model=${model}${poolNote}${resumeNote}${flags}${timeBudgetHit ? '; time_budget' : ''}; new=${answeredNow}; elapsed=${Math.round((now() - runStartedAt) / 1000)}s`;
  // אורך כולל מוגבל: הסיכום + פירוט הבעיות (id, סטטוס, הודעה קצרה) עד 1500 תווים.
  const fullDetail = (problems.length ? `${detail} | ${problems.join(' ; ')}` : detail).slice(0, 1500);
  try {
    await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('gate-gemini', ${ok}, ${fullDetail})`;
  } catch (error) {
    console.error('gate-probe: כתיבה ל-probe_log נכשלה:', error?.message);
    return reply(500, 'Internal Server Error');
  }

  return reply(200, `${ok ? 'עבר' : 'לא עבר'}: ${fullDetail}`);
}

// הנחה, לא אומת: פורמט "export default { fetch }" - ראו הערה ב-api/intake.js.
// הנחה, לא אומת: קובץ data/gate-test-sentences.json נכלל בחבילת הפונקציה ב-Vercel (קריאה מהדיסק בזמן ריצה).
export default {
  fetch(request) {
    const sql = (strings, ...values) => neon(process.env.DATABASE_URL)(strings, ...values);
    return handle(request, { sql });
  },
};
