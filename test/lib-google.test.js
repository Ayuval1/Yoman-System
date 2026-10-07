// בדיקות ל-lib/google.js: הצפנה, state, OAuth, calendarList, watch. בלי רשת: fetch מזויף.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  SCOPES, AUTH_ENDPOINT, TOKEN_ENDPOINT, DEFAULT_REDIRECT_URI, WATCH_ADDRESS,
  cleanEnv, googleConfigFromEnv, missingConfig, parseEncKey, encryptToken, decryptToken,
  generateState, evaluateState, saveState, consumeState, buildConsentUrl, exchangeCode, refreshAccessToken,
  missingScopes, listCalendars, shortReason, watchEndpoint, deriveChannelToken, verifyChannelToken, watchCalendarEvents,
} from '../lib/google.js';
import { fakeSql, fakeFetch, jsonResponse, timeoutError, randomKeyB64 } from './helpers.js';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);

describe('lib/google: הגדרות סביבה', () => {
  test('cleanEnv: חותך רווחים; ריק/לא מחרוזת = undefined', () => {
    assert.equal(cleanEnv('  abc\n'), 'abc');
    for (const v of ['', '   \n', undefined, null, 5]) assert.equal(cleanEnv(v), undefined);
  });
  test('googleConfigFromEnv: ברירת מחדל ל-redirectUri', () => {
    const c = googleConfigFromEnv({ GOOGLE_CLIENT_ID: ' id ', GOOGLE_CLIENT_SECRET: 's', TOKEN_ENC_KEY: 'k' });
    assert.deepEqual(c, { clientId: 'id', clientSecret: 's', redirectUri: DEFAULT_REDIRECT_URI, encKeyRaw: 'k' });
  });
  test('googleConfigFromEnv: redirect מותאם נשמר', () => {
    assert.equal(googleConfigFromEnv({ GOOGLE_REDIRECT_URI: 'https://a.b/cb' }).redirectUri, 'https://a.b/cb');
  });
  test('missingConfig: מחזיר שמות בלבד, לא ערכים', () => {
    assert.deepEqual(missingConfig({}), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'TOKEN_ENC_KEY']);
    assert.deepEqual(missingConfig({ clientId: 'a', clientSecret: 'b', encKeyRaw: 'c' }), []);
  });
  test('missingConfig: אפשרויות needEncKey / needClient', () => {
    assert.deepEqual(missingConfig({}, { needEncKey: false }), ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    assert.deepEqual(missingConfig({}, { needClient: false }), ['TOKEN_ENC_KEY']);
  });
});

describe('lib/google: parseEncKey', () => {
  test('מפתח תקין (32 בתים base64)', () => {
    const raw = randomKeyB64();
    assert.equal(parseEncKey(raw).length, 32);
  });
  test('רווחים וירידת שורה נחתכים', () => {
    const raw = randomKeyB64();
    assert.deepEqual(parseEncKey(`  ${raw}\n`), Buffer.from(raw, 'base64'));
  });
  test('חסר / ריק / לא מחרוזת - זורק', () => {
    for (const v of [undefined, null, '', '   ', 5]) assert.throws(() => parseEncKey(v), /חסר/);
  });
  test('אורך שגוי (16, 31, 33, 64 בתים) - זורק', () => {
    for (const n of [0 + 1, 16, 31, 33, 64]) assert.throws(() => parseEncKey(randomBytes(n).toString('base64')), /32 בתים/, String(n));
  });
  test('base64 פגום (תווים לא חוקיים / ריפוד חסר) - זורק', () => {
    const good = randomKeyB64();
    assert.throws(() => parseEncKey(good.slice(0, -1)));
    assert.throws(() => parseEncKey(`${good.slice(0, 10)}!!${good.slice(12)}`));
    assert.throws(() => parseEncKey('x'.repeat(44)));
  });
  test('hex של 32 בתים (64 תווים) לא מתקבל כ-base64', () => {
    assert.throws(() => parseEncKey(randomBytes(32).toString('hex')));
  });
  test('הודעת השגיאה לא כוללת את ערך המפתח', () => {
    const bad = randomBytes(10).toString('base64');
    try { parseEncKey(bad); assert.fail('צריך היה לזרוק'); } catch (e) { assert.ok(!e.message.includes(bad)); }
  });
});

describe('lib/google: הצפנה (AES-256-GCM)', () => {
  test('הצפנה ופענוח מחזירים את המקור', () => {
    assert.equal(decryptToken(encryptToken('1//refresh-token-abc', KEY), KEY), '1//refresh-token-abc');
  });
  test('עברית, אימוג׳י וטקסט ארוך', () => {
    for (const s of ['שלום עולם 🏃', 'x'.repeat(100_000), 'a\u0000b']) assert.equal(decryptToken(encryptToken(s, KEY), KEY), s);
  });
  test('פורמט: v1.iv.tag.ciphertext בשלושה base64url', () => {
    const parts = encryptToken('abc', KEY).split('.');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'v1');
    assert.equal(Buffer.from(parts[1], 'base64url').length, 12);
    assert.equal(Buffer.from(parts[2], 'base64url').length, 16);
    for (const p of parts.slice(1)) assert.match(p, /^[A-Za-z0-9_-]+$/);
  });
  test('הצפנה פעמיים של אותו טקסט נותנת פלט שונה (IV אקראי)', () => {
    assert.notEqual(encryptToken('same', KEY), encryptToken('same', KEY));
  });
  test('הטקסט המקורי לא מופיע בפלט המוצפן', () => {
    assert.ok(!encryptToken('very-secret-token-value', KEY).includes('very-secret-token-value'));
  });
  test('מפתח שגוי - הפענוח נכשל', () => {
    assert.throws(() => decryptToken(encryptToken('abc', KEY), OTHER_KEY), /פענוח נכשל/);
  });
  test('הודעת הכשל אחידה ולא חושפת את הסיבה', () => {
    const msgs = new Set();
    const good = encryptToken('abc', KEY);
    for (const bad of [good, 'v2.a.b.c', 'garbage', 'v1.a.b', 5, null, undefined]) {
      try { decryptToken(bad, bad === good ? OTHER_KEY : KEY); } catch (e) { msgs.add(e.message); }
    }
    assert.deepEqual([...msgs], ['פענוח נכשל']);
  });
  for (const [name, index] of [['IV', 1], ['תג האימות', 2], ['הטקסט המוצפן', 3]]) {
    test(`שינוי ביט אחד ב${name} - הפענוח נכשל`, () => {
      const parts = encryptToken('refresh-token', KEY).split('.');
      const buf = Buffer.from(parts[index], 'base64url');
      buf[0] ^= 0x01;
      parts[index] = buf.toString('base64url');
      assert.throws(() => decryptToken(parts.join('.'), KEY), /פענוח נכשל/);
    });
  }
  test('שינוי ביט בסוף הטקסט המוצפן - נכשל', () => {
    const parts = encryptToken('refresh-token', KEY).split('.');
    const buf = Buffer.from(parts[3], 'base64url');
    buf[buf.length - 1] ^= 0x80;
    parts[3] = buf.toString('base64url');
    assert.throws(() => decryptToken(parts.join('.'), KEY));
  });
  test('טקסט מוצפן קצוץ / ריק - נכשל', () => {
    const parts = encryptToken('refresh-token', KEY).split('.');
    assert.throws(() => decryptToken([parts[0], parts[1], parts[2], ''].join('.'), KEY));
    assert.throws(() => decryptToken([parts[0], parts[1], parts[2], parts[3].slice(0, 2)].join('.'), KEY));
  });
  test('החלפת תג/טקסט בין שני אסימונים שונים - נכשל', () => {
    const a = encryptToken('token-A', KEY).split('.');
    const b = encryptToken('token-B', KEY).split('.');
    assert.throws(() => decryptToken([a[0], a[1], b[2], a[3]].join('.'), KEY));
    assert.throws(() => decryptToken([a[0], a[1], a[2], b[3]].join('.'), KEY));
  });
  test('IV קצר מדי - נכשל', () => {
    const p = encryptToken('abc', KEY).split('.');
    p[1] = Buffer.from(p[1], 'base64url').subarray(0, 8).toString('base64url');
    assert.throws(() => decryptToken(p.join('.'), KEY));
  });
  test('גרסה לא מוכרת / מספר חלקים שגוי / לא מחרוזת - נכשל', () => {
    const p = encryptToken('abc', KEY).split('.');
    assert.throws(() => decryptToken(['v2', ...p.slice(1)].join('.'), KEY));
    assert.throws(() => decryptToken(p.slice(0, 3).join('.'), KEY));
    assert.throws(() => decryptToken(`${p.join('.')}.extra`, KEY));
    for (const v of [null, undefined, 5, {}, '', Buffer.from('x')]) assert.throws(() => decryptToken(v, KEY));
  });
  test('מפתח באורך שגוי בפענוח - נכשל בלי קריסה לא מובנת', () => {
    assert.throws(() => decryptToken(encryptToken('abc', KEY), randomBytes(16)), /פענוח נכשל/);
  });
  test('encryptToken: ריק / לא מחרוזת - זורק', () => {
    for (const v of ['', null, undefined, 5, {}]) assert.throws(() => encryptToken(v, KEY), /אין מה להצפין/);
  });
  test('encryptToken: מפתח באורך שגוי - זורק', () => {
    assert.throws(() => encryptToken('abc', randomBytes(16)));
  });
  // באג מוּשע: decryptToken לא מציין authTagLength, ולכן Node מקבל תג קצר (4-15 בתים) כתקף - זיוף אפשרי בסיכוי 2^-32 לתג של 4 בתים.
  for (const n of [4, 8, 12, 15]) {
    test(`תג אימות קצוץ ל-${n} בתים חייב להידחות`, { todo: 'באג: lib/google.js decryptToken - אין authTagLength:16, תג קצר מתקבל' }, () => {
      const p = encryptToken('refresh-token', KEY).split('.');
      p[2] = Buffer.from(p[2], 'base64url').subarray(0, n).toString('base64url');
      assert.throws(() => decryptToken(p.join('.'), KEY), /פענוח נכשל/);
    });
  }
});

describe('lib/google: state חד-פעמי', () => {
  test('generateState: base64url של 32 בתים (43 תווים), ייחודי', () => {
    const states = new Set(Array.from({ length: 200 }, generateState));
    assert.equal(states.size, 200);
    for (const s of states) assert.match(s, /^[A-Za-z0-9_-]{43}$/);
  });
  test('evaluateState: טבלת מצבים', () => {
    const NOW = Date.parse('2026-10-07T10:00:00Z');
    const future = '2026-10-07T10:05:00Z';
    const past = '2026-10-07T09:59:00Z';
    assert.deepEqual(evaluateState(null, NOW), { ok: false, reason: 'not_found' });
    assert.deepEqual(evaluateState(undefined, NOW), { ok: false, reason: 'not_found' });
    assert.deepEqual(evaluateState({ expires_at: future, used_at: null }, NOW), { ok: true });
    assert.deepEqual(evaluateState({ expires_at: past, used_at: null }, NOW), { ok: false, reason: 'expired' });
    assert.deepEqual(evaluateState({ expires_at: future, used_at: past }, NOW), { ok: false, reason: 'used' });
    assert.deepEqual(evaluateState({ expires_at: past, used_at: past }, NOW), { ok: false, reason: 'used' });
  });
  test('evaluateState: תפוגה בדיוק עכשיו = פג (לא "גדול מ")', () => {
    const NOW = Date.parse('2026-10-07T10:00:00Z');
    assert.equal(evaluateState({ expires_at: '2026-10-07T10:00:00Z', used_at: null }, NOW).reason, 'expired');
    assert.equal(evaluateState({ expires_at: '2026-10-07T10:00:00.001Z', used_at: null }, NOW).ok, true);
  });
  test('evaluateState: expires_at כאובייקט Date', () => {
    assert.equal(evaluateState({ expires_at: new Date(Date.now() + 60_000), used_at: null }).ok, true);
  });
  test('saveState: שומר את ה-state עם תפוגה של 10 דקות', async () => {
    const sql = fakeSql();
    await saveState(sql, 'STATE123');
    assert.match(sql.calls[0].text, /INSERT INTO google_oauth_states/);
    assert.deepEqual(sql.calls[0].values, ['STATE123', 10]);
  });
  test('consumeState: state לא חוקי (לא מחרוזת/קצר/ארוך) - not_found בלי לגעת במסד', async () => {
    const sql = fakeSql();
    for (const s of [null, undefined, 5, '', 'a'.repeat(15), 'a'.repeat(201)]) {
      assert.deepEqual(await consumeState(sql, s), { ok: false, reason: 'not_found' });
    }
    assert.equal(sql.calls.length, 0);
  });
  test('consumeState: ניצול מוצלח (UPDATE מחזיר שורה)', async () => {
    const sql = fakeSql(() => [{ state: 'x' }]);
    assert.deepEqual(await consumeState(sql, 'a'.repeat(43)), { ok: true });
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /UPDATE google_oauth_states SET used_at = now\(\) WHERE state = \? AND used_at IS NULL AND expires_at > now\(\)/);
  });
  test('consumeState: לא נמצא / פג / כבר נוצל', async () => {
    const NOW = Date.parse('2026-10-07T10:00:00Z');
    const mk = (row) => fakeSql((text) => (text.startsWith('UPDATE') ? [] : row ? [row] : []));
    const s = 'a'.repeat(43);
    assert.equal((await consumeState(mk(null), s, NOW)).reason, 'not_found');
    assert.equal((await consumeState(mk({ expires_at: '2026-10-07T09:00:00Z', used_at: null }), s, NOW)).reason, 'expired');
    assert.equal((await consumeState(mk({ expires_at: '2026-10-07T11:00:00Z', used_at: '2026-10-07T09:55:00Z' }), s, NOW)).reason, 'used');
  });
  test('consumeState: תחרות נדירה (UPDATE ריק אבל השורה נראית תקפה) - נדחה', async () => {
    const NOW = Date.parse('2026-10-07T10:00:00Z');
    const sql = fakeSql((text) => (text.startsWith('UPDATE') ? [] : [{ expires_at: '2026-10-07T11:00:00Z', used_at: null }]));
    assert.deepEqual(await consumeState(sql, 'a'.repeat(43), NOW), { ok: false, reason: 'not_found' });
  });
  test('consumeState: ניצול פעמיים של אותו state (מסד זיכרון) - רק הראשון מצליח', async () => {
    let used = false;
    const sql = fakeSql((text) => {
      if (text.startsWith('UPDATE')) { if (used) return []; used = true; return [{ state: 's' }]; }
      return [{ expires_at: new Date(Date.now() + 60_000), used_at: new Date() }];
    });
    const s = 'a'.repeat(43);
    assert.equal((await consumeState(sql, s)).ok, true);
    assert.deepEqual(await consumeState(sql, s), { ok: false, reason: 'used' });
  });
  test('consumeState: כשל במסד מתפשט (הקורא אחראי)', async () => {
    await assert.rejects(() => consumeState(fakeSql(() => { throw new Error('db'); }), 'a'.repeat(43)));
  });
});

describe('lib/google: buildConsentUrl', () => {
  const url = new URL(buildConsentUrl({ clientId: 'CID', redirectUri: 'https://app.test/cb?x=1', state: 'ST&ATE=1' }));
  test('כתובת בסיס ופרמטרים', () => {
    assert.equal(`${url.origin}${url.pathname}`, AUTH_ENDPOINT);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('client_id'), 'CID');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
  });
  test('redirect_uri ו-state מקודדים נכון ומתפענחים חזרה זהים', () => {
    assert.equal(url.searchParams.get('redirect_uri'), 'https://app.test/cb?x=1');
    assert.equal(url.searchParams.get('state'), 'ST&ATE=1');
  });
  test('הסקופים: בדיוק הנדרשים, מופרדים ברווח', () => {
    assert.deepEqual(url.searchParams.get('scope').split(' '), SCOPES);
    assert.equal(SCOPES.length, 2);
  });
  test('אין client_secret בכתובת', () => assert.ok(!url.search.includes('secret')));
});

describe('lib/google: exchangeCode ו-refreshAccessToken', () => {
  const okTokens = (extra = {}) => jsonResponse({ access_token: 'AT', refresh_token: 'RT', scope: SCOPES.join(' '), ...extra });
  const args = (f) => ({ code: 'CODE', clientId: 'CID', clientSecret: 'CSECRET', redirectUri: 'https://app.test/cb', fetchImpl: f });

  test('exchangeCode: הצלחה ופענוח scopes', async () => {
    const f = fakeFetch(() => okTokens());
    const r = await exchangeCode(args(f));
    assert.deepEqual(r, { ok: true, refreshToken: 'RT', accessToken: 'AT', scopes: SCOPES });
  });
  test('exchangeCode: הבקשה נשלחת ל-token endpoint עם הפרמטרים הנכונים ו-timeout', async () => {
    const f = fakeFetch(() => okTokens());
    await exchangeCode(args(f));
    const call = f.calls[0];
    assert.equal(call.url, TOKEN_ENDPOINT);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers['content-type'], 'application/x-www-form-urlencoded');
    const body = new URLSearchParams(call.options.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('code'), 'CODE');
    assert.equal(body.get('client_id'), 'CID');
    assert.equal(body.get('client_secret'), 'CSECRET');
    assert.equal(body.get('redirect_uri'), 'https://app.test/cb');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.signal.aborted, false);
  });
  test('exchangeCode: scope חסר בתשובה - scopes ריק', async () => {
    const r = await exchangeCode(args(fakeFetch(() => okTokens({ scope: undefined }))));
    assert.deepEqual(r.scopes, []);
  });
  test('exchangeCode: scope עם רווחים כפולים/שורות', async () => {
    const r = await exchangeCode(args(fakeFetch(() => okTokens({ scope: ' a  b\nc ' }))));
    assert.deepEqual(r.scopes, ['a', 'b', 'c']);
  });
  test('exchangeCode: אין refresh_token - no_refresh_token', async () => {
    for (const refresh_token of [undefined, '', 5]) {
      const r = await exchangeCode(args(fakeFetch(() => okTokens({ refresh_token }))));
      assert.deepEqual(r, { ok: false, reason: 'no_refresh_token', status: 200 });
    }
  });
  test('exchangeCode: access_token חסר/ריק/לא מחרוזת - bad_response', async () => {
    for (const access_token of [undefined, '', 7]) {
      const r = await exchangeCode(args(fakeFetch(() => okTokens({ access_token }))));
      assert.equal(r.reason, 'bad_response');
    }
  });
  test('exchangeCode: גוף לא JSON בהצלחה - bad_response', async () => {
    const r = await exchangeCode(args(fakeFetch(() => new Response('<html>', { status: 200 }))));
    assert.equal(r.reason, 'bad_response');
  });
  test('exchangeCode: גוף JSON שהוא null - bad_response', async () => {
    const r = await exchangeCode(args(fakeFetch(() => new Response('null', { status: 200 }))));
    assert.equal(r.reason, 'bad_response');
  });
  test('שגיאות HTTP: 400 invalid_grant מחזיר את הקוד', async () => {
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => jsonResponse({ error: 'invalid_grant', error_description: 'Token has been expired SECRETDESC' }, 400)) });
    assert.deepEqual(r, { ok: false, reason: 'invalid_grant', status: 400 });
    assert.ok(!JSON.stringify(r).includes('SECRETDESC'));
  });
  test('שגיאות HTTP: טקסט חופשי/אותיות גדולות/ארוך מדי אינו מתקבל כקוד', async () => {
    for (const error of ['Bad Request: details', 'INVALID', 'x'.repeat(51), 5, null, 'a-b']) {
      const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => jsonResponse({ error }, 400)) });
      assert.equal(r.reason, 'http_error', String(error));
    }
  });
  test('שגיאות HTTP: 401/403/429/500/503 עם גוף לא JSON', async () => {
    for (const status of [401, 403, 429, 500, 502, 503]) {
      const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => new Response('<html>oops</html>', { status })) });
      assert.deepEqual(r, { ok: false, reason: 'http_error', status });
    }
  });
  test('fetch זורק TimeoutError - reason=timeout, בלי הודעת השגיאה', async () => {
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => { throw timeoutError(); }) });
    assert.deepEqual(r, { ok: false, reason: 'timeout', status: null });
  });
  test('fetch זורק שגיאת רשת רגילה - reason=network, בלי חשיפת ההודעה', async () => {
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => { throw new TypeError('fetch failed: https://oauth2.googleapis.com secret=CSECRET'); }) });
    assert.deepEqual(r, { ok: false, reason: 'network', status: null });
  });
  test('fetch זורק ערך שאינו Error - לא קורס', async () => {
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'a', clientSecret: 'b', fetchImpl: fakeFetch(() => { throw undefined; }) });
    assert.equal(r.reason, 'network');
  });
  test('refreshAccessToken: הצלחה מחזירה רק accessToken', async () => {
    const f = fakeFetch(() => okTokens());
    const r = await refreshAccessToken({ refreshToken: 'RT', clientId: 'CID', clientSecret: 'CS', fetchImpl: f });
    assert.deepEqual(r, { ok: true, accessToken: 'AT' });
    const body = new URLSearchParams(f.calls[0].options.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'RT');
  });
  test('missingScopes: מזהה סקופ שבוטל', () => {
    assert.deepEqual(missingScopes(SCOPES), []);
    assert.deepEqual(missingScopes([SCOPES[0]]), [SCOPES[1]]);
    assert.deepEqual(missingScopes([]), SCOPES);
    assert.deepEqual(missingScopes([...SCOPES, 'extra']), []);
  });
});

describe('lib/google: listCalendars', () => {
  const page = (items, nextPageToken) => jsonResponse({ items, ...(nextPageToken ? { nextPageToken } : {}) });
  test('עמוד יחיד - רק id, summary, accessRole (שדות אחרים נחתכים)', async () => {
    const f = fakeFetch(() => page([{ id: 'a', summary: 'A', accessRole: 'owner', secret: 'x', description: 'd', timeZone: 'z' }]));
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: f });
    assert.deepEqual(r, { ok: true, calendars: [{ id: 'a', summary: 'A', accessRole: 'owner' }] });
  });
  test('הבקשה: GET עם Authorization Bearer ו-maxResults=250', async () => {
    const f = fakeFetch(() => page([]));
    await listCalendars({ accessToken: 'AT-1', fetchImpl: f });
    assert.equal(f.calls[0].options.method, 'GET');
    assert.equal(f.calls[0].options.headers.authorization, 'Bearer AT-1');
    assert.equal(new URL(f.calls[0].url).searchParams.get('maxResults'), '250');
    assert.ok(!f.calls[0].url.includes('AT-1'));
  });
  test('עימוד: שני עמודים, pageToken מועבר', async () => {
    const f = fakeFetch((url, o, i) => (i === 0 ? page([{ id: '1' }], 'NEXT') : page([{ id: '2' }])));
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: f });
    assert.deepEqual(r.calendars.map((c) => c.id), ['1', '2']);
    assert.equal(new URL(f.calls[1].url).searchParams.get('pageToken'), 'NEXT');
  });
  test('לולאה אינסופית נעצרת אחרי 10 עמודים - too_many_pages', async () => {
    const f = fakeFetch(() => page([{ id: 'x' }], 'AGAIN'));
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: f });
    assert.deepEqual(r, { ok: false, reason: 'too_many_pages', status: null });
    assert.equal(f.calls.length, 10);
  });
  test('items חסר / לא מערך / null - רשימה ריקה', async () => {
    for (const body of [{}, { items: 'x' }, { items: null }]) {
      const r = await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => jsonResponse(body)) });
      assert.deepEqual(r, { ok: true, calendars: [] });
    }
  });
  test('פריטים פגומים (null, מספר) לא קורסים ונהיים null', async () => {
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => page([null, 5, {}])) });
    assert.equal(r.calendars.length, 3);
    assert.deepEqual(r.calendars[0], { id: null, summary: null, accessRole: null });
  });
  test('nextPageToken ריק/לא מחרוזת - נעצר', async () => {
    for (const t of ['', 5, null]) {
      const f = fakeFetch(() => jsonResponse({ items: [], nextPageToken: t }));
      assert.equal((await listCalendars({ accessToken: 'AT', fetchImpl: f })).ok, true);
      assert.equal(f.calls.length, 1);
    }
  });
  test('סטטוסים 401/403/429/500/503 - http_error עם הסטטוס', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      const r = await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => new Response('{"error":{"message":"private details"}}', { status })) });
      assert.deepEqual(r, { ok: false, reason: 'http_error', status });
    }
  });
  test('כשל בעמוד שני אחרי הצלחה בראשון - כשל כללי (לא תוצאה חלקית)', async () => {
    const f = fakeFetch((u, o, i) => (i === 0 ? page([{ id: '1' }], 'N') : new Response('', { status: 500 })));
    const r = await listCalendars({ accessToken: 'AT', fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.status, 500);
  });
  test('timeout / רשת / JSON פגום', async () => {
    assert.equal((await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => { throw timeoutError(); }) })).reason, 'timeout');
    assert.equal((await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => { throw new Error('boom'); }) })).reason, 'network');
    assert.equal((await listCalendars({ accessToken: 'AT', fetchImpl: fakeFetch(() => new Response('not json', { status: 200 })) })).reason, 'bad_response');
  });
  test('תוצאת השגיאה לא מכילה את ה-access token', async () => {
    const r = await listCalendars({ accessToken: 'TOP-SECRET-AT', fetchImpl: fakeFetch(() => { throw new Error('Bearer TOP-SECRET-AT'); }) });
    assert.ok(!JSON.stringify(r).includes('TOP-SECRET-AT'));
  });
});

describe('lib/google: shortReason', () => {
  test('קוד נקי עם סטטוס', () => assert.equal(shortReason('invalid_grant', 400), 'invalid_grant (400)'));
  test('בלי סטטוס', () => assert.equal(shortReason('timeout', null), 'timeout'));
  test('מסיר כתובות ותווים מיוחדים', () => assert.equal(shortReason('http://evil.com/x?y=1', 500), 'httpevilcomxy1 (500)'));
  test('חותך ל-50 תווים', () => assert.equal(shortReason('a'.repeat(100)).length, 50));
  test('ריק / undefined / רק תווים מיוחדים = unknown', () => {
    for (const v of [undefined, null, '', '!!!', '---']) assert.equal(shortReason(v), 'unknown');
  });
  test('עברית נמחקת (לא נשמרת ב-last_error)', () => assert.equal(shortReason('שגיאה', 400), 'unknown (400)'));
});

describe('lib/google: טוקן ערוץ watch (HMAC)', () => {
  test('פורמט: 64 תווי hex, דטרמיניסטי', () => {
    const t = deriveChannelToken('chan-1', KEY);
    assert.match(t, /^[0-9a-f]{64}$/);
    assert.equal(t, deriveChannelToken('chan-1', KEY));
  });
  test('מזהה אחר או מפתח אחר נותנים טוקן שונה', () => {
    assert.notEqual(deriveChannelToken('chan-1', KEY), deriveChannelToken('chan-2', KEY));
    assert.notEqual(deriveChannelToken('chan-1', KEY), deriveChannelToken('chan-1', OTHER_KEY));
  });
  test('המפתח לא מופיע בטוקן ולא נגזר ישירות (תת-מפתח)', () => {
    const t = deriveChannelToken('chan-1', KEY);
    assert.ok(!t.includes(KEY.toString('hex')));
  });
  test('אימות: טוקן נכון עובר', () => {
    assert.equal(verifyChannelToken(deriveChannelToken('c', KEY), 'c', KEY), true);
  });
  test('אימות: מזהה ערוץ שגוי נכשל', () => {
    assert.equal(verifyChannelToken(deriveChannelToken('c1', KEY), 'c2', KEY), false);
  });
  test('אימות: מפתח שגוי נכשל', () => {
    assert.equal(verifyChannelToken(deriveChannelToken('c', KEY), 'c', OTHER_KEY), false);
  });
  test('אימות: חסר / ריק / לא מחרוזת / ארוך מ-256 - false (בלי קריסה)', () => {
    for (const v of [null, undefined, '', 5, {}, 'a'.repeat(257), 'a'.repeat(100000)]) assert.equal(verifyChannelToken(v, 'c', KEY), false);
  });
  test('אימות: אורכים שונים (קצר/ארוך/קטוע/עם תוספת) - false (מסלול timing-safe)', () => {
    const t = deriveChannelToken('c', KEY);
    for (const v of ['a', t.slice(0, 63), `${t}0`, t.slice(1), 'x'.repeat(256)]) assert.equal(verifyChannelToken(v, 'c', KEY), false);
  });
  test('אימות: טוקן באותיות גדולות נדחה (השוואה מדויקת)', () => {
    assert.equal(verifyChannelToken(deriveChannelToken('c', KEY).toUpperCase(), 'c', KEY), false);
  });
  test('אימות: שינוי תו אחד נדחה (בכל מיקום)', () => {
    const t = deriveChannelToken('c', KEY);
    for (const i of [0, 31, 63]) {
      const flipped = t.slice(0, i) + (t[i] === 'a' ? 'b' : 'a') + t.slice(i + 1);
      assert.equal(verifyChannelToken(flipped, 'c', KEY), false);
    }
  });
  test('מזהה ערוץ בעברית / ריק / ארוך עובד מקצה לקצה', () => {
    for (const id of ['ערוץ-1', '', 'x'.repeat(5000)]) assert.equal(verifyChannelToken(deriveChannelToken(id, KEY), id, KEY), true);
  });
  test('מזהה כמספר מומר למחרוזת (עקבי)', () => {
    assert.equal(verifyChannelToken(deriveChannelToken(5, KEY), '5', KEY), true);
  });
});

describe('lib/google: watchEndpoint ו-watchCalendarEvents', () => {
  test('watchEndpoint מקודד את מזהה היומן', () => {
    assert.equal(watchEndpoint('a@group.calendar.google.com'), 'https://www.googleapis.com/calendar/v3/calendars/a%40group.calendar.google.com/events/watch');
    assert.ok(!watchEndpoint('x/../../y#z?q').includes('/../'));
    assert.ok(!watchEndpoint('x?q=1').includes('?q'));
  });
  const watchArgs = (f, extra = {}) => ({ accessToken: 'AT', calendarId: 'cal@x', channelId: 'CH1', token: 'TOK', address: WATCH_ADDRESS, fetchFn: f, ...extra });
  test('הצלחה: resourceId, expiration במילישניות ו-channelId', async () => {
    const f = fakeFetch(() => jsonResponse({ id: 'CH1', resourceId: 'RES', expiration: '1893456000000' }));
    const r = await watchCalendarEvents(watchArgs(f));
    assert.deepEqual(r, { ok: true, resourceId: 'RES', expiration: 1893456000000, channelId: 'CH1' });
  });
  test('גוף הבקשה: id, type=web_hook, address, token (בלי expiration)', async () => {
    const f = fakeFetch(() => jsonResponse({ resourceId: 'RES' }));
    await watchCalendarEvents(watchArgs(f));
    assert.equal(f.calls[0].options.method, 'POST');
    assert.equal(f.calls[0].options.headers.authorization, 'Bearer AT');
    assert.deepEqual(JSON.parse(f.calls[0].options.body), { id: 'CH1', type: 'web_hook', address: WATCH_ADDRESS, token: 'TOK' });
    assert.equal(f.calls[0].url, watchEndpoint('cal@x'));
  });
  test('expiration חסר / לא מספר / אפס / שלילי - null', async () => {
    for (const expiration of [undefined, 'abc', '0', '-5', null]) {
      const r = await watchCalendarEvents(watchArgs(fakeFetch(() => jsonResponse({ resourceId: 'R', expiration }))));
      assert.equal(r.expiration, null, String(expiration));
    }
  });
  test('id חסר בתשובה - נופל חזרה ל-channelId שנשלח', async () => {
    const r = await watchCalendarEvents(watchArgs(fakeFetch(() => jsonResponse({ resourceId: 'R' }))));
    assert.equal(r.channelId, 'CH1');
  });
  test('resourceId חסר/ריק/לא מחרוזת - bad_response', async () => {
    for (const resourceId of [undefined, '', 5]) {
      const r = await watchCalendarEvents(watchArgs(fakeFetch(() => jsonResponse({ resourceId }))));
      assert.equal(r.reason, 'bad_response');
    }
  });
  test('שגיאות Google: 401/403/404/429/500 - קוד בלבד', async () => {
    for (const status of [401, 403, 404, 429, 500, 503]) {
      const r = await watchCalendarEvents(watchArgs(fakeFetch(() => jsonResponse({ error: 'push_webhook_url_not_https' }, status))));
      assert.deepEqual(r, { ok: false, reason: 'push_webhook_url_not_https', status });
    }
  });
  test('שגיאה בלי קוד תקין - http_error', async () => {
    const r = await watchCalendarEvents(watchArgs(fakeFetch(() => jsonResponse({ error: { code: 403, message: 'Forbidden for calendar-name-secret' } }, 403))));
    assert.deepEqual(r, { ok: false, reason: 'http_error', status: 403 });
  });
  test('timeout / רשת / JSON פגום', async () => {
    assert.equal((await watchCalendarEvents(watchArgs(fakeFetch(() => { throw timeoutError(); })))).reason, 'timeout');
    assert.equal((await watchCalendarEvents(watchArgs(fakeFetch(() => { throw new Error('x'); })))).reason, 'network');
    assert.equal((await watchCalendarEvents(watchArgs(fakeFetch(() => new Response('oops', { status: 200 }))))).reason, 'bad_response');
  });
});
