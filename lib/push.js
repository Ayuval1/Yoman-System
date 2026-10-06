// לוגיקת דחיפה טהורה (שלב 4א, צד שרת): בניית payload הצהרתי ושליחה. אין כאן מסד ואין סודות בקוד.
// מקורות (נבדקו ב-6.10.2026):
// - פורמט הצהרתי: webkit.org/blog/16535/meet-declarative-web-push/ . הדוגמה שם:
//   {"web_push": 8030, "notification": {"title", "lang", "dir", "body", "navigate", "silent", "app_badge": "1"}}
//   "web_push": 8030 הוא ערך קסם שמפעיל פענוח הצהרתי. title לא ריק חובה. navigate חובה. app_badge הוא מחרוזת בדוגמה.
// - הספרייה: github.com/web-push-libs/web-push (README) + קריאת הקוד המותקן (node_modules/web-push, גרסה 3.6.7):
//   setVapidDetails(subject, publicKey, privateKey), sendNotification(subscription, payload, options),
//   options: TTL (שניות), urgency (very-low/low/normal/high), headers, contentEncoding, topic, timeout.
//   payload חייב להיות string או Buffer. בכישלון HTTP נזרקת שגיאה עם statusCode, headers, body.
//
// לא אומת (הנחות):
// - כותרת Content-Type: הפוסט של WebKit לא מזכיר שום Content-Type. הספרייה קובעת תמיד application/octet-stream
//   ולא ניתן לעקוף דרך options.headers (בקוד היא נדרסת). לא אומת שאפל מפענחת כך הצהרתית; ייבדק במכשיר אמיתי בשלב 4ב.
// - ב-VAPID: הספרייה מייצרת JWT חדש בכל קריאה ל-sendNotification (תוקף ברירת מחדל 12 שעות) ואינה שומרת אותו.
//   לכן כאן ה-JWT נוצר בעצמנו דרך getVapidHeaders ונשמר בזיכרון לאורך הריצה (אחד לכל audience), ונשלח בכותרת Authorization.
//   המסד שומר רק vapid_jwt_issued_at (לא את ה-JWT), ולכן בין ריצות נפרדות נוצר JWT חדש. אם ריצות יהיו תכופות מפעם בשעה - ראו דיווח.
// - ערכי TTL ו-urgency כאן הם בחירה שלי (לא מקור): TTL 3600, urgency high.
// - navigate: בדוגמה של WebKit זו כתובת מלאה. לא אומת אם כתובת יחסית תקפה.
// - רשימת מארחי שירות הדחיפה המותרים (ALLOWED_PUSH_HOSTS): מהידע שלי, לא אומתה מתיעוד רשמי.
import webpush from 'web-push';

export const DECLARATIVE_MAGIC = 8030;
export const DEFAULT_TTL_SECONDS = 3600;
export const DEFAULT_URGENCY = 'high';
const MAX_TITLE = 120;
const MAX_BODY = 500;
const MAX_NAVIGATE = 500;

// הנחה, לא אומת: הרשימה. נועדה למנוע מהשרת לשלוח בקשות לכתובת שרירותית (SSRF) אם מנוי מזויף נרשם.
const ALLOWED_PUSH_HOSTS = ['web.push.apple.com', 'push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com'];

export function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

// מחזיר { ok: true, subscription } או { ok: false, reason }. הסיבה לא כוללת ערכים מהקלט.
export function validateSubscription(input) {
  if (input === null || typeof input !== 'object') return { ok: false, reason: 'גוף הבקשה אינו אובייקט' };
  if (!isAllowedEndpoint(input.endpoint)) return { ok: false, reason: 'endpoint לא תקין' };
  const keys = input.keys;
  if (keys === null || typeof keys !== 'object') return { ok: false, reason: 'חסר keys' };
  const { p256dh, auth } = keys;
  if (typeof p256dh !== 'string' || p256dh.length < 20 || p256dh.length > 200 || !BASE64URL.test(p256dh)) {
    return { ok: false, reason: 'p256dh לא תקין' };
  }
  if (typeof auth !== 'string' || auth.length < 8 || auth.length > 100 || !BASE64URL.test(auth)) {
    return { ok: false, reason: 'auth לא תקין' };
  }
  return { ok: true, subscription: { endpoint: input.endpoint, p256dh, auth } };
}

// בונה payload הצהרתי מקונן. מחזיר { ok: true, json } או { ok: false, reason }.
export function buildPayload({ title, body, navigate, app_badge } = {}) {
  if (typeof title !== 'string' || title.trim().length === 0 || title.length > MAX_TITLE) {
    return { ok: false, reason: `title חובה (עד ${MAX_TITLE} תווים)` };
  }
  if (typeof navigate !== 'string' || navigate.trim().length === 0 || navigate.length > MAX_NAVIGATE) {
    return { ok: false, reason: `navigate חובה (עד ${MAX_NAVIGATE} תווים)` };
  }
  const notification = { title, navigate };
  if (body !== undefined && body !== null) {
    if (typeof body !== 'string' || body.length > MAX_BODY) return { ok: false, reason: `body חייב להיות טקסט עד ${MAX_BODY} תווים` };
    notification.body = body;
  }
  if (app_badge !== undefined && app_badge !== null) {
    const isCount = (typeof app_badge === 'number' && Number.isInteger(app_badge)) || (typeof app_badge === 'string' && /^[0-9]{1,4}$/.test(app_badge));
    const value = Number(app_badge);
    if (!isCount || value < 0 || value > 9999) return { ok: false, reason: 'app_badge חייב להיות מספר שלם 0-9999' };
    notification.app_badge = String(value); // מחרוזת, כמו בדוגמת WebKit
  }
  return { ok: true, json: JSON.stringify({ web_push: DECLARATIVE_MAGIC, notification }) };
}

// מנקה הודעת שגיאה: בלי endpoint מלא, בלי מפתחות, בלי תוכן ההודעה. מקוצרת.
export function safeError(message, secrets = []) {
  let out = String(message ?? '');
  for (const value of secrets) {
    if (typeof value === 'string' && value.length > 0) out = out.split(value).join('[הוסר]');
  }
  out = out.replace(/https?:\/\/\S+/g, '[כתובת]');
  return out.slice(0, 200);
}

// Retry-After: מספר שניות או תאריך HTTP. ברירת מחדל 60 שניות (הנחה, לא אומת: אין מקור לערך).
export function parseRetryAfterSeconds(value, nowMs = Date.now()) {
  if (typeof value === 'string' && /^[0-9]{1,7}$/.test(value.trim())) return Number(value.trim());
  const dateMs = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isFinite(dateMs)) return Math.max(0, Math.ceil((dateMs - nowMs) / 1000));
  return 60;
}

// יוצר שולח. lib ניתן להזרקה (בדיקות). send אינו זורק על תשובת HTTP שגויה: מחזיר { status, headers, error }.
export function createSender({ subject, publicKey, privateKey, lib = webpush, now = () => Date.now() }) {
  const tokens = new Map(); // audience -> { authorization, issuedAt }

  function tokenFor(endpoint) {
    const audience = new URL(endpoint).origin;
    if (!tokens.has(audience)) {
      const issuedAt = new Date(now());
      const headers = lib.getVapidHeaders(audience, subject, publicKey, privateKey, 'aes128gcm');
      tokens.set(audience, { authorization: headers.Authorization, issuedAt });
    }
    return tokens.get(audience);
  }

  async function send(subscription, payloadJson, { ttl = DEFAULT_TTL_SECONDS, urgency = DEFAULT_URGENCY } = {}) {
    const token = tokenFor(subscription.endpoint);
    const target = { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
    try {
      const response = await lib.sendNotification(target, payloadJson, {
        TTL: ttl,
        urgency,
        headers: { Authorization: token.authorization },
      });
      return { status: response?.statusCode ?? 201, headers: response?.headers ?? {}, error: null, jwtIssuedAt: token.issuedAt };
    } catch (error) {
      if (typeof error?.statusCode === 'number') {
        return { status: error.statusCode, headers: error.headers ?? {}, error: `HTTP ${error.statusCode}`, jwtIssuedAt: token.issuedAt };
      }
      // שגיאת רשת: רק הקוד, לא ההודעה (עלולה להכיל שם מארח).
      return { status: null, headers: {}, error: `שגיאת רשת${error?.code ? ` ${String(error.code).slice(0, 30)}` : ''}`, jwtIssuedAt: token.issuedAt };
    }
  }

  return { send };
}
