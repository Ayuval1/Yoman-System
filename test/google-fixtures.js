// נתוני בדיקה משותפים לנקודות ה-Google. הכול מומצא ורץ בזיכרון: אין סודות אמיתיים ואין רשת.
import { randomBytes } from 'node:crypto';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT, SCOPES, encryptToken, parseEncKey } from '../lib/google.js';
import { fakeFetch, jsonResponse } from './helpers.js';

export const KEY_B64 = randomBytes(32).toString('base64');
export const KEY = parseEncKey(KEY_B64);
export const CLIENT_SECRET = 'test-client-secret-DO-NOT-LEAK';
export const REFRESH_TOKEN = '1//refresh-token-DO-NOT-LEAK';
export const ACCESS_TOKEN = 'ya29.access-token-DO-NOT-LEAK';
export const AUTH_CODE = '4/auth-code-DO-NOT-LEAK';

export const CONFIG = {
  clientId: 'test-client-id.apps.example',
  clientSecret: CLIENT_SECRET,
  redirectUri: 'https://app.test/api/google-auth-callback',
  encKeyRaw: KEY_B64,
};

export const CAL_NAMES = ['יומן פרטי של יובל', 'אימוני ריצה', 'חגי ישראל'];
export const CALENDARS = [
  { id: 'private-cal-id-1@gmail.com', summary: CAL_NAMES[0], accessRole: 'owner', extra: 'x' },
  { id: 'running-cal-id-2@group.calendar.google.com', summary: CAL_NAMES[1], accessRole: 'writer' },
  { id: 'holidays-id-3@group.v.calendar.google.com', summary: CAL_NAMES[2], accessRole: 'reader' },
];

export const encRefresh = (key = KEY) => encryptToken(REFRESH_TOKEN, key);

// נתב fetch מזויף לפי כתובת. כל אחד מהמפעילים יכול להיות Response, פונקציה, או Error לזריקה.
export function googleFetch({ token, list, watch } = {}) {
  return fakeFetch((url, options, i) => {
    const pick = (handler, fallback) => {
      const h = handler ?? fallback;
      const v = typeof h === 'function' ? h(url, options, i) : h;
      if (v instanceof Error) throw v;
      return v;
    };
    if (url === TOKEN_ENDPOINT) {
      return pick(token, () => jsonResponse({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, scope: SCOPES.join(' ') }));
    }
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return pick(list, () => jsonResponse({ items: CALENDARS }));
    if (url.includes('/events/watch')) {
      return pick(watch, () => jsonResponse({ resourceId: `res-${i}`, expiration: String(Date.parse('2026-11-07T10:00:00Z')) }));
    }
    throw new Error(`fetch לא צפוי: ${url}`);
  });
}

// בודק שאף אחד מהסודות לא מופיע בטקסט.
export const SECRET_VALUES = [CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, AUTH_CODE, KEY_B64];
export function assertNoSecrets(assert, text, extra = []) {
  for (const s of [...SECRET_VALUES, ...extra]) assert.ok(!text.includes(s), `דלף: ${s}`);
}
