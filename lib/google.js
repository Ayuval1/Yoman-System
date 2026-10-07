// חיבור ל-Google Calendar (שלב 5, חלק א': OAuth וקריאה בלבד). אין כאן כתיבה ליומן, ואין סודות בקוד.
// מקור ההכרעות: docs/02-rules/03-google-calendar-rules.md, "החלטה 1" (אפליקציה במצב "In production" בלי אימות, לשימוש אישי)
// והסקופים שיובל הכריע. refresh token נשמר מוצפן (AES-256-GCM) במסד; המפתח רק במשתנה הסביבה TOKEN_ENC_KEY.
//
// לא אומת (הגישה לדומיינים של Google חסומה בסביבת הפיתוח, ולכן שום קריאה כאן לא נוסתה מול Google אמיתי):
// - כל כתובות ה-endpoint, שמות הפרמטרים ופורמט התשובות כאן הם מהידע שלי על ה-API, לא מתיעוד שנקרא עכשיו:
//   accounts.google.com/o/oauth2/v2/auth · oauth2.googleapis.com/token · www.googleapis.com/calendar/v3/users/me/calendarList.
// - ששדה "scope" בתשובת החלפת ה-code הוא מחרוזת מופרדת ברווחים, ושהמשתמש יכול לבטל סקופ אחד במסך ההסכמה (הסכמה מפורטת).
// - ש-prompt=consent עם access_type=offline מחזיר refresh_token בכל הסכמה.
// - ששגיאות ה-token מחזירות JSON עם שדה "error" (למשל invalid_grant).
// - ש-calendarList מחזיר nextPageToken ושדות id, summary, accessRole לכל פריט, ושמותר maxResults=250.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const CALENDAR_LIST_ENDPOINT = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';

// הוכרעו: קריאה/כתיבת אירועים + קריאת רשימת היומנים בלבד. בשלב הזה משתמשים רק בקריאה.
export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

export const DEFAULT_REDIRECT_URI = 'https://yoman-system.vercel.app/api/google-auth-callback';
export const STATE_TTL_MINUTES = 10;
export const FETCH_TIMEOUT_MS = 10000;
const MAX_CALENDAR_PAGES = 10; // הגנה מלולאה אינסופית; 10 עמודים של 250 הם הרבה מעבר ליומנים של יובל

// מסיר רווחים וירידות שורה בתחילת/סוף הערך (ערך שהועתק מקובץ מגיע עם ירידת שורה). ריק אחרי ניקוי = חסר.
export function cleanEnv(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function googleConfigFromEnv(env = process.env) {
  return {
    clientId: cleanEnv(env.GOOGLE_CLIENT_ID),
    clientSecret: cleanEnv(env.GOOGLE_CLIENT_SECRET),
    redirectUri: cleanEnv(env.GOOGLE_REDIRECT_URI) ?? DEFAULT_REDIRECT_URI,
    encKeyRaw: cleanEnv(env.TOKEN_ENC_KEY),
  };
}

// שמות משתני הסביבה החסרים (רק שמות, לא ערכים). redirectUri לא כלול: יש לו ברירת מחדל.
export function missingConfig(config, { needEncKey = true, needClient = true } = {}) {
  const missing = [];
  if (needClient && !config.clientId) missing.push('GOOGLE_CLIENT_ID');
  if (needClient && !config.clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (needEncKey && !config.encKeyRaw) missing.push('TOKEN_ENC_KEY');
  return missing;
}

// ---------------------------------------------------------------------------
// הצפנה: AES-256-GCM. הפורמט השמור: "v1.<iv>.<tag>.<ciphertext>", כל חלק base64url.
// ---------------------------------------------------------------------------

// מפתח: base64 של 32 בתים בדיוק. בדיקה קפדנית (קידוד מחדש חייב להתאים) כי Buffer.from מקבל גם קלט פגום בשקט.
// מחזיר Buffer, או זורק Error עם הודעה שאינה כוללת את ערך המפתח.
export function parseEncKey(raw) {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) throw new Error('TOKEN_ENC_KEY חסר');
  const key = Buffer.from(trimmed, 'base64');
  if (key.toString('base64') !== trimmed || key.length !== 32) {
    throw new Error('TOKEN_ENC_KEY חייב להיות base64 של 32 בתים בדיוק');
  }
  return key;
}

export function encryptToken(plaintext, key) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) throw new Error('אין מה להצפין');
  const iv = randomBytes(12); // 96 ביט: האורך המומלץ ל-GCM
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv, tag, ciphertext].map((part) => (Buffer.isBuffer(part) ? part.toString('base64url') : part)).join('.');
}

// זורק Error כללי כשהמפתח שגוי, הנתון פגום או נוסח לא מוכר (בלי לחשוף למה).
export function decryptToken(stored, key) {
  const fail = () => new Error('פענוח נכשל');
  if (typeof stored !== 'string') throw fail();
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw fail();
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const ciphertext = Buffer.from(parts[3], 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw fail();
  }
}

// ---------------------------------------------------------------------------
// state חד-פעמי (הגנה מ-CSRF בתהליך ההסכמה)
// ---------------------------------------------------------------------------

export function generateState() {
  return randomBytes(32).toString('base64url');
}

// טהור: מחליט אם שורת state תקפה. row = { expires_at, used_at } או null/undefined כשלא נמצאה.
// מחזיר { ok: true } או { ok: false, reason: 'not_found' | 'expired' | 'used' }.
export function evaluateState(row, nowMs = Date.now()) {
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.used_at) return { ok: false, reason: 'used' };
  if (new Date(row.expires_at).getTime() <= nowMs) return { ok: false, reason: 'expired' };
  return { ok: true };
}

export async function saveState(sql, state) {
  await sql`
    INSERT INTO google_oauth_states (state, expires_at)
    VALUES (${state}, now() + make_interval(mins => ${STATE_TTL_MINUTES}))
  `;
}

// מנצל state באופן אטומי: UPDATE אחד עם התנאים בתוכו, כך ששתי בקשות מקבילות לא ינצלו את אותו state פעמיים.
// כשלא נוצל, קוראים את השורה רק כדי לדעת למה (לא משנה את התוצאה). מחזיר { ok } או { ok:false, reason }.
export async function consumeState(sql, state, nowMs = Date.now()) {
  if (typeof state !== 'string' || state.length < 16 || state.length > 200) return { ok: false, reason: 'not_found' };
  const rows = await sql`
    UPDATE google_oauth_states SET used_at = now()
    WHERE state = ${state} AND used_at IS NULL AND expires_at > now()
    RETURNING state
  `;
  if (rows.length === 1) return { ok: true };
  const found = await sql`SELECT expires_at, used_at FROM google_oauth_states WHERE state = ${state}`;
  const verdict = evaluateState(found[0], nowMs);
  return verdict.ok ? { ok: false, reason: 'not_found' } : verdict; // ok כאן = תחרות נדירה; דוחים
}

// ---------------------------------------------------------------------------
// OAuth: כתובת הסכמה, החלפת code, רענון
// ---------------------------------------------------------------------------

export function buildConsentUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    access_type: 'offline', // כדי לקבל refresh token
    prompt: 'consent', // כדי לקבל refresh token גם בהסכמה חוזרת
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

// קריאת רשת עם timeout. זורק על שגיאת רשת/timeout; הקורא אחראי לא לחשוף את ההודעה.
async function fetchWithTimeout(url, options, fetchImpl, timeoutMs = FETCH_TIMEOUT_MS) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// קוד שגיאה של Google ("invalid_grant" וכו') רק אם הוא נראה כמו קוד; לעולם לא טקסט חופשי מהתשובה.
async function readErrorCode(response) {
  try {
    const body = await response.json();
    const code = body?.error;
    return typeof code === 'string' && /^[a-z_]{1,50}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

async function postToken(params, fetchImpl) {
  let response;
  try {
    response = await fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }, fetchImpl);
  } catch (error) {
    return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', status: null };
  }
  if (!response.ok) {
    const code = await readErrorCode(response);
    return { ok: false, reason: code ?? 'http_error', status: response.status };
  }
  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: 'bad_response', status: response.status };
  }
  if (typeof body?.access_token !== 'string' || body.access_token.length === 0) {
    return { ok: false, reason: 'bad_response', status: response.status };
  }
  return { ok: true, body };
}

// מחליף code ב-tokens. מחזיר { ok:true, refreshToken, accessToken, scopes:[...] } או { ok:false, reason, status }.
export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  const result = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  }, fetchImpl);
  if (!result.ok) return result;
  const { body } = result;
  if (typeof body.refresh_token !== 'string' || body.refresh_token.length === 0) {
    return { ok: false, reason: 'no_refresh_token', status: 200 };
  }
  const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [];
  return { ok: true, refreshToken: body.refresh_token, accessToken: body.access_token, scopes };
}

// מרענן access token. מחזיר { ok:true, accessToken } או { ok:false, reason, status } (reason יכול להיות invalid_grant).
export async function refreshAccessToken({ refreshToken, clientId, clientSecret, fetchImpl = fetch }) {
  const result = await postToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }, fetchImpl);
  if (!result.ok) return result;
  return { ok: true, accessToken: result.body.access_token };
}

// כל הסקופים הנדרשים ניתנו? (בהסכמה מפורטת המשתמש יכול לבטל אחד.)
export function missingScopes(granted) {
  return SCOPES.filter((scope) => !granted.includes(scope));
}

// ---------------------------------------------------------------------------
// calendarList (קריאה בלבד)
// ---------------------------------------------------------------------------

// מחזיר { ok:true, calendars:[{id, summary, accessRole}] } או { ok:false, reason, status }. בלי שום שדה אחר מהתשובה.
export async function listCalendars({ accessToken, fetchImpl = fetch }) {
  const calendars = [];
  let pageToken = null;
  for (let page = 0; page < MAX_CALENDAR_PAGES; page += 1) {
    const params = new URLSearchParams({ maxResults: '250' });
    if (pageToken) params.set('pageToken', pageToken);
    let response;
    try {
      response = await fetchWithTimeout(`${CALENDAR_LIST_ENDPOINT}?${params.toString()}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${accessToken}` },
      }, fetchImpl);
    } catch (error) {
      return { ok: false, reason: error?.name === 'TimeoutError' ? 'timeout' : 'network', status: null };
    }
    if (!response.ok) return { ok: false, reason: 'http_error', status: response.status };
    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: 'bad_response', status: response.status };
    }
    for (const item of Array.isArray(body?.items) ? body.items : []) {
      calendars.push({ id: item?.id ?? null, summary: item?.summary ?? null, accessRole: item?.accessRole ?? null });
    }
    pageToken = typeof body?.nextPageToken === 'string' && body.nextPageToken.length > 0 ? body.nextPageToken : null;
    if (!pageToken) return { ok: true, calendars };
  }
  return { ok: false, reason: 'too_many_pages', status: null };
}

// מנקה הודעת שגיאה לפני שמירה ב-last_error: רק קוד קצר, בלי כתובות.
export function shortReason(reason, status) {
  const base = String(reason ?? 'unknown').replace(/[^A-Za-z0-9_]/g, '').slice(0, 50) || 'unknown';
  return status ? `${base} (${status})` : base;
}
