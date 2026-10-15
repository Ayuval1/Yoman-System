// כלי עזר משותפים לבדיקות. אין כאן רשת, מסד אמיתי או סודות אמיתיים.
import { mock } from 'node:test';
import { randomBytes } from 'node:crypto';

// sql מזויף: תבנית מתויגת שרושמת כל קריאה. handler(text, values, callIndex) מחזיר שורות או זורק.
export function fakeSql(handler = () => []) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    const call = { text, values };
    calls.push(call);
    return handler(text, values, calls.length - 1);
  };
  sql.calls = calls;
  sql.find = (needle) => calls.filter((c) => c.text.includes(needle));
  return sql;
}

// תופס console.error (ו-log/warn) של הבדיקה. מחזיר { text(), lines }.
export function captureConsole(t) {
  const lines = [];
  const grab = (...args) => lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  t.mock.method(console, 'error', grab);
  t.mock.method(console, 'warn', grab);
  t.mock.method(console, 'log', grab);
  return { lines, text: () => lines.join('\n') };
}

export function formRequest(fields, { method = 'POST', headers = {}, url = 'https://x.test/api/intake' } = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request(url, { method, headers, body: method === 'GET' ? undefined : form });
}

export function jsonRequest(body, { method = 'POST', headers = {}, url = 'https://x.test/api/x' } = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(url, { method, headers, body: method === 'GET' ? undefined : payload });
}

export function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Request(url, { method, headers, body });
}

// תשובת fetch מזויפת.
export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// fetch מזויף: routes = פונקציה (url, options) => Response | throw. רושם קריאות.
export function fakeFetch(route) {
  const calls = [];
  const fn = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return route(String(url), options, calls.length - 1);
  };
  fn.calls = calls;
  return fn;
}

export function timeoutError() {
  const e = new Error('The operation was aborted due to timeout');
  e.name = 'TimeoutError';
  return e;
}

// מפתח הצפנה תקין לבדיקות בלבד (אקראי בכל הרצה, לא סוד אמיתי).
export const randomKeyB64 = () => randomBytes(32).toString('base64');

// קבועים מזויפים (נראים כמו סודות כדי שאפשר לוודא שלא דולפים).
export const FAKE_SECRET = 'test-secret-ABC123-do-not-leak';
export const FAKE_CRON = 'cron-secret-XYZ789-do-not-leak';

export async function bodyOf(response) {
  return response.text();
}

// ---------------------------------------------------------------------------
// סיכום היום (M.2, lib/review-view.js): נתונים מומצאים משותפים לבדיקות. כל הטקסטים מומצאים, בלי שמות.
// REVIEW_NOW = 21:00 בישראל ב-16.10.2026 (UTC+3): הגבול B שווה לרגע הזה, והחלון הוא (13.10 21:00, 16.10 21:00], ובלי מה שלפני תחילת 15.10.
// ---------------------------------------------------------------------------
export const REVIEW_NOW = new Date('2026-10-16T18:00:00.000Z');
export const uuidOf = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// שורת מועמד כפי שהשאילתה מחזירה: outcome n בתוך החלון של REVIEW_NOW. text רק בשאילתת הרשימה (לא בספירה).
export function reviewRow(n, overrides = {}) {
  return {
    id: uuidOf(n), status: 'recorded', recorded_at: new Date('2026-10-16T10:00:00.000Z'), source_id: uuidOf(1000 + n),
    text: `הודעה מומצאת מספר ${n}`, received_at: new Date('2026-10-16T09:59:00.000Z'), content_hash: `hash-${n}`, checked: false, ...overrides,
  };
}

export { mock };
