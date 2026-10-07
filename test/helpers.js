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

export { mock };
