// חיבור ישיר ל-Garmin Connect (בלוק 5 חלק ב; הכרעה ה-8 ב-docs/01-foundation/אפיון-מורחב.md: Garmin בלבד, קוד שלנו, בלי ספריות צד שלישי).
// החוקים: docs/02-rules/03-garmin-rules.md (קריאה בלבד, פעולה 22 "לפנות למקור חיצוני" = אוטונומי; "שבירה אינה שקטה").
// כאן רק HTTP: כניסה (3 שלבים, רצה פעם אחת מהמחשב של יובל, lib/garmin-login-cli.js), רענון, קריאות API ופענוח. השמירה במסד: lib/garmin-store.js.
// ה-Cron: lib/ops/garmin-sync.js. כל fetch מוזרק (fetchImpl), עם timeout כמו ב-lib/google.js.
//
// מקור הזרימה: קריאת הקוד של python-garminconnect v0.3.20 (23.10.2026), כפי שדווח לבנאי. לא הותקן ולא הורץ. מדווח, לא נבדק מול Garmin חי:
// - כל הכתובות, ה-clientId-ים, שמות השדות בבקשות ובתשובות, והכותרות של האפליקציה.
// הנחה, לא אומת: ש-fetch של Node עובר את Cloudflare של Garmin. הספרייה נשענת על התחזות ל-TLS של דפדפן. אם לא, הכשל חוזר כ-reason
//   ('forbidden' / 'blocked' / 'http_error') ומדווח בגלוי. לא מסתירים אותו ולא מנסים שוב.
// הנחה, לא אומת: שמות השדות בתשובות של לוח השנה, התוכנית והפעילויות (פענוח הגנתי: כל שדה חסר = null, פריט בלי מזהה או תאריך מדולג).
// הנחה, לא אומת: duration בלוח השנה הוא בשניות (כמו בפעילויות).
// 429 / 427 = חסימה. לא מנסים שוב אוטומטית אף פעם: מדווחת חסימת כניסה של 48-72 שעות לחשבון (03-garmin-rules, "לבדיקה חיה" 3).
// פרטיות: מהתשובות נשמרים רק מזהה, תאריך, סוג (מתוכנן/בוצע), כותרת, ענף ספורט, משך ושעת התחלה. בלי GPS, דופק או כל שדה אחר.
//   טוקנים, סיסמה וגוף תשובה לא נכנסים לשום reason, לוג או ערך מוחזר מלבד הטוקנים עצמם (שהקורא מצפין).
import { addDays } from './intake-dates.js';
import { zonedToUtc } from './schedule-time.js';

export const FETCH_TIMEOUT_MS = 15000;

// ---------------------------------------------------------------------------
// כניסה (SSO של האפליקציה לאייפון) והחלפה לטוקנים (DI OAuth2)
// ---------------------------------------------------------------------------
export const SSO_ORIGIN = 'https://sso.garmin.com';
export const SSO_CLIENT = 'GCM_IOS_DARK';
export const SSO_SERVICE = 'https://mobile.integration.garmin.com/gcm/ios';
export const SIGN_IN_URL = `${SSO_ORIGIN}/mobile/sso/en_US/sign-in?${new URLSearchParams({ clientId: SSO_CLIENT, service: SSO_SERVICE })}`;
const SSO_QUERY = new URLSearchParams({ clientId: SSO_CLIENT, locale: 'en-US', service: SSO_SERVICE }).toString();
export const LOGIN_URL = `${SSO_ORIGIN}/mobile/api/login?${SSO_QUERY}`;
// הנחה, לא אומת: שגם verifyCode מקבל את אותם פרמטרים בכתובת (המחקר מסר רק את הנתיב).
export const MFA_URL = `${SSO_ORIGIN}/mobile/api/mfa/verifyCode?${SSO_QUERY}`;
// הנחה, לא אומת: מחרוזת User-Agent של Safari באייפון. המחקר מסר "iPhone Safari User-Agent" בלי הערך המדויק.
export const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export const DI_TOKEN_URL = 'https://diauth.garmin.com/di-oauth2-service/oauth/token';
export const DI_GRANT_TICKET = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';
// לפי הסדר שהספרייה מנסה (מדווח).
export const DI_CLIENT_IDS = [
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
  'GARMIN_CONNECT_MOBILE_ANDROID_DI',
  'GARMIN_CONNECT_MOBILE_IOS_DI',
];
// רענון כשנשארו פחות מ-900 שניות לתפוגת ה-access token (מדווח, כמו בספרייה).
export const REFRESH_MARGIN_SEC = 900;

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
export const API_BASE = 'https://connectapi.garmin.com';
export const API_HEADERS = {
  'user-agent': 'GCM-Android-5.23',
  'x-garmin-user-agent': 'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',
  'x-garmin-client-platform': 'Android',
  'x-app-ver': '10861',
  'x-garmin-paired-app-version': '10861',
  'x-gcexperience': 'GC5',
  'x-lang': 'en',
};
// חלונות הזמן (החלטת המנהל): מתוכנן מהיום עד +15 (TrainingPeaks שולח ל-Garmin 15 ימים קדימה, 03-garmin-rules), בוצע לשלושת הימים האחרונים.
export const PLANNED_DAYS_AHEAD = 15;
export const DONE_DAYS_BACK = 2; // היום + יומיים אחורה = 3 ימים
// הנחה, לא אומת: 20 פעילויות אחרונות מכסות 3 ימים (יובל מתאמן לכל היותר כמה פעמים ביום).
export const ACTIVITY_LIMIT = 20;
const TITLE_MAX = 200;
const TOKEN_MAX = 8192;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

// ---------------------------------------------------------------------------
// כלי עזר
// ---------------------------------------------------------------------------
async function fetchWithTimeout(url, options, fetchImpl) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

const networkFailure = (error) => ({ reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', status: null });
const isBlocked = (status) => status === 429 || status === 427;

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

// עוגיות: אובייקט פשוט שם -> ערך. רק החלק name=value של כל Set-Cookie (בלי Path/Expires).
function mergeCookies(jar, response) {
  const next = { ...jar };
  const lines = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const line of lines) {
    const pair = String(line).split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) next[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return next;
}
const cookieHeader = (jar) => Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ');

// ---------------------------------------------------------------------------
// כניסה, שלב 1: דף הכניסה (רק בשביל העוגיות SESSION ו-__cf_bm)
// מחזיר { ok:true, cookies } או { ok:false, reason, status }.
// הנחה, לא אומת: fetch עוקב אחרי הפניות כברירת מחדל, ועוגיות מתשובת ביניים של הפניה הולכות לאיבוד. אם Garmin מפנה כאן, צריך redirect:'manual'.
// ---------------------------------------------------------------------------
export async function startLogin({ fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchWithTimeout(SIGN_IN_URL, { method: 'GET', headers: { 'user-agent': IPHONE_UA } }, fetchImpl);
  } catch (error) {
    return { ok: false, ...networkFailure(error) };
  }
  if (isBlocked(response.status)) return { ok: false, reason: 'blocked', status: response.status };
  if (!response.ok) return { ok: false, reason: response.status === 403 ? 'forbidden' : 'http_error', status: response.status };
  return { ok: true, cookies: mergeCookies({}, response) };
}

// תשובת SSO (כניסה או MFA) -> תוצאה אחידה. failReason = מה מחזירים על סוג לא מוכר.
async function ssoResult(response, cookies, failReason) {
  if (isBlocked(response.status)) return { ok: false, reason: 'blocked', status: response.status };
  const body = await readJson(response);
  const type = body?.responseStatus?.type;
  const jar = mergeCookies(cookies, response);
  if (type === 'SUCCESSFUL' && typeof body?.serviceTicketId === 'string' && body.serviceTicketId.length > 0) {
    return { ok: true, ticket: body.serviceTicketId, cookies: jar };
  }
  if (type === 'MFA_REQUIRED') {
    // הנחה, לא אומת: השדה customerMfaInfo.mfaLastMethodUsed; בלעדיו 'email'.
    const method = body?.customerMfaInfo?.mfaLastMethodUsed;
    return { ok: false, reason: 'mfa_required', mfaMethod: typeof method === 'string' && /^[a-z_]{1,20}$/i.test(method) ? method : 'email', cookies: jar };
  }
  if (type === 'INVALID_USERNAME_PASSWORD') return { ok: false, reason: 'bad_credentials', status: response.status };
  if (type === 'CAPTCHA_REQUIRED') return { ok: false, reason: 'captcha', status: response.status };
  if (response.status === 403) return { ok: false, reason: 'forbidden', status: 403 };
  return { ok: false, reason: failReason, status: response.status };
}

function ssoHeaders(cookies) {
  return {
    'user-agent': IPHONE_UA,
    'content-type': 'application/json',
    accept: 'application/json',
    origin: SSO_ORIGIN,
    referer: SIGN_IN_URL,
    cookie: cookieHeader(cookies),
  };
}

// כניסה, שלב 2. מחזיר { ok:true, ticket, cookies } | { ok:false, reason:'mfa_required', mfaMethod, cookies } | { ok:false, reason, status }.
// reason: bad_credentials · captcha · blocked · forbidden · unexpected · timeout · network. הסיסמה לא נכנסת לשום ערך מוחזר.
export async function submitLogin({ email, password, cookies, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchWithTimeout(LOGIN_URL, {
      method: 'POST',
      headers: ssoHeaders(cookies),
      body: JSON.stringify({ username: email, password, rememberMe: true, captchaToken: '' }),
    }, fetchImpl);
  } catch (error) {
    return { ok: false, ...networkFailure(error) };
  }
  return ssoResult(response, cookies, 'unexpected');
}

// MFA. אותן עוגיות. הנחה, לא אומת: התשובה באותו מבנה כמו הכניסה (responseStatus.type + serviceTicketId).
export async function submitMfa({ code, mfaMethod = 'email', cookies, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchWithTimeout(MFA_URL, {
      method: 'POST',
      headers: ssoHeaders(cookies),
      body: JSON.stringify({ mfaMethod, mfaVerificationCode: String(code), rememberMyBrowser: true, reconsentList: [], mfaSetup: false }),
    }, fetchImpl);
  } catch (error) {
    return { ok: false, ...networkFailure(error) };
  }
  const result = await ssoResult(response, cookies, 'mfa_failed');
  // קוד שגוי לא אמור להחזיר עוד MFA_REQUIRED; אם כן, זה עדיין כישלון של הקוד.
  return result.reason === 'mfa_required' ? { ok: false, reason: 'mfa_failed', status: response.status } : result;
}

// POST אחד ל-DI. מחזיר { ok:true, body } או { ok:false, reason, status }.
async function postDi(clientId, params, fetchImpl) {
  let response;
  try {
    response = await fetchWithTimeout(DI_TOKEN_URL, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    }, fetchImpl);
  } catch (error) {
    return { ok: false, ...networkFailure(error) };
  }
  if (isBlocked(response.status)) return { ok: false, reason: 'blocked', status: response.status };
  if (response.status === 403) return { ok: false, reason: 'forbidden', status: 403 };
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
  const body = await readJson(response);
  if (typeof body?.access_token !== 'string' || body.access_token.length === 0) return { ok: false, reason: 'bad_response', status: response.status };
  return { ok: true, body };
}

// כניסה, שלב 3: כרטיס -> { access_token, refresh_token, client_id }. מנסה את מזהי הלקוח לפי הסדר.
// ממשיכים למזהה הבא רק על 400/401 (תשובת "לקוח שגוי"). כל כשל אחר (403 של Cloudflare, 429/427, 5xx, רשת, תשובה פגומה) עוצר מיד:
// ניסיון נוסף לא ישנה אותו, ורק מוסיף בקשות שעלולות להחמיר חסימה. הנחה, לא אומת: שמזהה לקוח שגוי מקבל 400 או 401.
export async function exchangeTicket({ ticket, fetchImpl = fetch }) {
  let last = { status: null };
  for (const clientId of DI_CLIENT_IDS) {
    const result = await postDi(clientId, {
      client_id: clientId, service_ticket: ticket, service_url: SSO_SERVICE, grant_type: DI_GRANT_TICKET,
    }, fetchImpl);
    if (result.ok) {
      const { access_token: accessToken, refresh_token: refreshToken } = result.body;
      if (typeof refreshToken !== 'string' || refreshToken.length === 0) return { ok: false, reason: 'no_refresh_token', status: 200 };
      return { ok: true, tokens: { access_token: accessToken, refresh_token: refreshToken, client_id: clientId } };
    }
    if (result.status !== 400 && result.status !== 401) return result;
    last = result;
  }
  return { ok: false, reason: 'exchange_failed', status: last.status };
}

// רענון. מחזיר { ok:true, tokens } (תמיד סט מלא: refresh חדש אם הגיע, אחרת הישן, כמו בספרייה) או { ok:false, reason, status, auth }.
// auth=true (400/401) = Garmin דחה את ה-refresh token: החיבור נפל וצריך כניסה מחדש מהמחשב. הנחה, לא אומת: ש-400 כאן פירושו invalid_grant.
export async function refreshTokens({ tokens, fetchImpl = fetch }) {
  const result = await postDi(tokens.client_id, {
    grant_type: 'refresh_token', client_id: tokens.client_id, refresh_token: tokens.refresh_token,
  }, fetchImpl);
  if (!result.ok) {
    if (result.status === 400 || result.status === 401) return { ok: false, reason: 'auth_rejected', status: result.status, auth: true };
    return { ...result, auth: false };
  }
  const refresh = typeof result.body.refresh_token === 'string' && result.body.refresh_token.length > 0 ? result.body.refresh_token : tokens.refresh_token;
  return { ok: true, tokens: { access_token: result.body.access_token, refresh_token: refresh, client_id: tokens.client_id } };
}

// exp מתוך ה-JWT (במילישניות), או null כשלא ניתן לקרוא. לא מאמת חתימה: רק כדי לדעת מתי לרענן.
export function tokenExpiresAt(accessToken) {
  if (typeof accessToken !== 'string') return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const exp = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.exp;
    return Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

// תפוגה לא ידועה = מרעננים (בטוח, כי אחרי כל רענון שומרים את הסט המלא).
export function needsRefresh(tokens, nowMs) {
  const expMs = tokenExpiresAt(tokens?.access_token);
  return expMs === null || expMs - nowMs < REFRESH_MARGIN_SEC * 1000;
}

export function isTokenSet(value) {
  if (!value || typeof value !== 'object') return false;
  const ok = (s) => typeof s === 'string' && s.length > 0 && s.length <= TOKEN_MAX;
  return ok(value.access_token) && ok(value.refresh_token) && typeof value.client_id === 'string' && /^[A-Za-z0-9_]{1,80}$/.test(value.client_id);
}

// ---------------------------------------------------------------------------
// API: GET אחד. מחזיר { ok:true, body } או { ok:false, reason, status, auth }.
// 403 נקרא 'forbidden' ולא auth: הנחה, לא אומת: 403 כאן הוא לרוב Cloudflare, ולא טוקן שנדחה.
// ---------------------------------------------------------------------------
export async function garminGet({ path, accessToken, fetchImpl = fetch }) {
  let response;
  try {
    response = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { ...API_HEADERS, authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    }, fetchImpl);
  } catch (error) {
    return { ok: false, ...networkFailure(error), auth: false };
  }
  if (response.status === 401) return { ok: false, reason: 'auth_rejected', status: 401, auth: true };
  if (isBlocked(response.status)) return { ok: false, reason: 'blocked', status: response.status, auth: false };
  if (response.status === 403) return { ok: false, reason: 'forbidden', status: 403, auth: false };
  if (!response.ok) return { ok: false, reason: 'http_error', status: response.status, auth: false };
  const body = await readJson(response);
  if (body === undefined) return { ok: false, reason: 'bad_response', status: response.status, auth: false };
  return { ok: true, body };
}

// ---------------------------------------------------------------------------
// פענוח: כל פריט -> { garmin_id, kind, item_date, title, sport, duration_sec, starts_at }. שום שדה אחר לא עובר.
// ---------------------------------------------------------------------------
const idOf = (value) => ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)) ? String(value) : null);
const textOf = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, TITLE_MAX) : null);
const keyOf = (value) => (typeof value === 'string' && /^[a-z0-9_]{1,50}$/i.test(value) ? value : null);
const secondsOf = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 7 * 24 * 3600 ? Math.round(value) : null);
const dateOf = (value) => (typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)) ? value : null);

function planned(prefix, id, date, title, sport, duration) {
  return { garmin_id: `${prefix}:${id}`, kind: 'planned', item_date: date, title: textOf(title), sport: keyOf(sport), duration_sec: secondsOf(duration), starts_at: null };
}

// startTimeGMT ("YYYY-MM-DD HH:MM:SS", UTC) אם יש; אחרת השעה המקומית מפורשת בשעון ישראל.
// הנחה, לא אומת: startTimeLocal הוא שעון ישראל (השעון של יובל בישראל); ריצה בחו"ל תקבל שעה שגויה כשאין startTimeGMT.
function activityStart(item, localMatch) {
  const gmt = typeof item.startTimeGMT === 'string' ? LOCAL_DATETIME.exec(item.startTimeGMT) : null;
  if (gmt) {
    const ms = Date.parse(`${gmt[1]}T${gmt[2]}:${gmt[3]}:${gmt[4] ?? '00'}Z`);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  try {
    const base = zonedToUtc(localMatch[1], `${localMatch[2]}:${localMatch[3]}`);
    return new Date(base.getTime() + Number(localMatch[4] ?? 0) * 1000).toISOString();
  } catch {
    return null;
  }
}

export function parseActivities(body) {
  const items = [];
  for (const item of Array.isArray(body) ? body : []) {
    const id = idOf(item?.activityId);
    const local = typeof item?.startTimeLocal === 'string' ? LOCAL_DATETIME.exec(item.startTimeLocal) : null;
    if (!id || !local || !dateOf(local[1])) continue;
    items.push({
      garmin_id: `act:${id}`, kind: 'done', item_date: local[1], title: textOf(item.activityName),
      sport: keyOf(item.activityType?.typeKey), duration_sec: secondsOf(item.duration), starts_at: activityStart(item, local),
    });
  }
  return items;
}

export function parseCalendarItems(body) {
  const list = Array.isArray(body?.calendarItems) ? body.calendarItems : [];
  const items = [];
  for (const item of list) {
    if (item?.itemType !== 'workout') continue;
    const id = idOf(item.id) ?? idOf(item.workoutId);
    const date = dateOf(item.date);
    if (!id || !date) continue;
    items.push(planned('cal', id, date, item.title, item.sportTypeKey, item.duration));
  }
  return items;
}

// התשובה עשויה להיות מערך, או אובייקט שאחד מהשדות שלו הוא המערך (הנחה, לא אומת: המבנה המדויק לא ידוע).
export function parseScheduledWorkouts(body) {
  const list = Array.isArray(body) ? body : (body && typeof body === 'object' ? Object.values(body).find(Array.isArray) ?? [] : []);
  const items = [];
  for (const item of list) {
    const id = idOf(item?.workoutScheduleId) ?? idOf(item?.scheduleId) ?? idOf(item?.id);
    const date = dateOf(item?.calendarDate) ?? dateOf(item?.date) ?? dateOf(item?.scheduledDate);
    if (!id || !date) continue;
    const workout = item.workout && typeof item.workout === 'object' ? item.workout : item;
    items.push(planned('sched', id, date, workout.workoutName ?? item.title, workout.sportType?.sportTypeKey ?? item.sportTypeKey,
      workout.estimatedDurationInSecs ?? item.duration));
  }
  return items;
}

// ---------------------------------------------------------------------------
// pullItems: מה שה-Cron מושך. today = תאריך ישראלי 'YYYY-MM-DD'.
// מחזיר { ok, items, failures:[קוד קצר], auth, blocked }. כשל בקריאה אחת לא מוחק את מה שהגיע מהאחרות; 429 עוצר את כל השאר.
// כפילות: אותו אימון יכול להגיע גם מלוח השנה וגם מהתוכנית. הנחה, לא אומת: אותו תאריך ואותה כותרת = אותו אימון; נשמר הפריט מלוח השנה.
// ---------------------------------------------------------------------------
export function monthsBetween(fromIso, toIso) {
  const months = [];
  let [year, month] = fromIso.split('-').map(Number);
  const [endYear, endMonth] = toIso.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    months.push({ year, month0: month - 1 });
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return months;
}

// renewAccess (אופציונלי): async () => { ok:true, accessToken } | { ok:false, reason, auth }. על 401 ראשון: רענון אחד, ואותה קריאה נשלחת שוב פעם אחת
// עם הטוקן החדש (חידוש טוקן, לא ניסיון כניסה חוזר). גם החדש מקבל 401 = auth. הרענון עצמו נכשל = עוצרים את המשיכה (אחרת כל קריאה הבאה הייתה 401 ונספרת כ-auth בטעות).
export async function pullItems({ accessToken, fetchImpl = fetch, today, renewAccess = null }) {
  const plannedTo = addDays(today, PLANNED_DAYS_AHEAD);
  const doneFrom = addDays(today, -DONE_DAYS_BACK);
  const requests = [
    { name: 'activities', path: `/activitylist-service/activities/search/activities?${new URLSearchParams({ start: '0', limit: String(ACTIVITY_LIMIT) })}`, parse: parseActivities },
    ...monthsBetween(today, plannedTo).map(({ year, month0 }) => ({
      name: 'calendar', path: `/calendar-service/year/${year}/month/${month0}`, parse: parseCalendarItems,
    })),
    { name: 'schedule', path: `/workout-service/schedule/workoutScheduleByPeriod?${new URLSearchParams({ startDate: today, endDate: plannedTo })}`, parse: parseScheduledWorkouts },
  ];
  const collected = [];
  const failures = [];
  let auth = false;
  let blocked = false;
  let token = accessToken;
  let renewed = false;
  for (const request of requests) {
    let result = await garminGet({ path: request.path, accessToken: token, fetchImpl });
    if (!result.ok && result.status === 401 && !renewed && typeof renewAccess === 'function') {
      renewed = true;
      const renewal = await renewAccess();
      if (!renewal?.ok) {
        failures.push(`${request.name}:${renewal?.reason ?? 'refresh_failed'}`);
        auth ||= renewal?.auth === true;
        break;
      }
      token = renewal.accessToken;
      result = await garminGet({ path: request.path, accessToken: token, fetchImpl });
    }
    if (!result.ok) {
      failures.push(`${request.name}:${result.reason}${result.status ? ` (${result.status})` : ''}`);
      auth ||= result.auth === true;
      if (result.reason === 'blocked') { blocked = true; break; }
      continue;
    }
    collected.push(...request.parse(result.body));
  }
  const inWindow = collected.filter((item) => (item.kind === 'done'
    ? item.item_date >= doneFrom && item.item_date <= today
    : item.item_date >= today && item.item_date <= plannedTo));
  const seen = new Set();
  const byId = new Set();
  const items = [];
  // לוח השנה לפני התוכנית, כדי שבכפילות יישאר הפריט מלוח השנה.
  const order = { act: 0, cal: 1, sched: 2 };
  inWindow.sort((a, b) => order[a.garmin_id.split(':')[0]] - order[b.garmin_id.split(':')[0]]);
  for (const item of inWindow) {
    if (byId.has(item.garmin_id)) continue;
    const key = item.kind === 'planned' && item.title ? `${item.item_date}|${item.title}` : null;
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    byId.add(item.garmin_id);
    items.push(item);
  }
  return { ok: failures.length === 0, items, failures, auth, blocked };
}
