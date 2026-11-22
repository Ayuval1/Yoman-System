// בדיקות ל-lib/garmin.js (בלוק 5 חלק ב): לקוח HTTP ל-Garmin Connect. בלי רשת: כל fetch מזויף. כל הטוקנים והסיסמאות מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, jsonResponse, timeoutError } from './helpers.js';
import {
  API_BASE, DI_CLIENT_IDS, DI_TOKEN_URL, SIGN_IN_URL,
  startLogin, submitLogin, submitMfa, exchangeTicket, refreshTokens, tokenExpiresAt, needsRefresh, isTokenSet,
  garminGet, parseActivities, parseCalendarItems, parseScheduledWorkouts, pullItems, monthsBetween,
} from '../lib/garmin.js';

const FAKE_PASSWORD = 'pw-FAKE-do-not-leak-123';
const jwtWithExp = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;
const withCookies = (body, cookies, status = 200) => new Response(JSON.stringify(body), {
  status, headers: [['content-type', 'application/json'], ...cookies.map((c) => ['set-cookie', c])],
});

describe('garmin: כניסה, שלב 1 (דף הכניסה)', () => {
  test('GET לכתובת הכניסה עם User-Agent של אייפון, ושומר את העוגיות', async () => {
    const fetchImpl = fakeFetch(() => withCookies({}, ['SESSION=abc; Path=/; HttpOnly', '__cf_bm=xyz; Path=/']));
    const result = await startLogin({ fetchImpl });
    assert.equal(result.ok, true);
    assert.deepEqual(result.cookies, { SESSION: 'abc', __cf_bm: 'xyz' });
    assert.equal(fetchImpl.calls[0].url, SIGN_IN_URL);
    assert.match(fetchImpl.calls[0].options.headers['user-agent'], /iPhone/);
    assert.ok(fetchImpl.calls[0].options.signal, 'יש timeout');
  });

  test('429 ו-427 = חסום, timeout = timeout', async () => {
    for (const status of [429, 427]) {
      const result = await startLogin({ fetchImpl: fakeFetch(() => new Response('', { status })) });
      assert.deepEqual(result, { ok: false, reason: 'blocked', status });
    }
    const timed = await startLogin({ fetchImpl: fakeFetch(() => { throw timeoutError(); }) });
    assert.deepEqual(timed, { ok: false, reason: 'timeout', status: null });
  });
});

describe('garmin: כניסה, שלב 2 (שם משתמש וסיסמה)', () => {
  const cookies = { SESSION: 'abc', __cf_bm: 'xyz' };

  test('SUCCESSFUL מחזיר כרטיס; הבקשה JSON עם העוגיות, Origin ו-Referer', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-1' }));
    const result = await submitLogin({ email: 'a@b.test', password: FAKE_PASSWORD, cookies, fetchImpl });
    assert.deepEqual(result, { ok: true, ticket: 'ST-1', cookies });
    const { url, options } = fetchImpl.calls[0];
    assert.ok(url.startsWith('https://sso.garmin.com/mobile/api/login?'));
    assert.equal(new URL(url).searchParams.get('clientId'), 'GCM_IOS_DARK');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.cookie, 'SESSION=abc; __cf_bm=xyz');
    assert.equal(options.headers.origin, 'https://sso.garmin.com');
    assert.equal(options.headers.referer, SIGN_IN_URL);
    assert.deepEqual(JSON.parse(options.body), { username: 'a@b.test', password: FAKE_PASSWORD, rememberMe: true, captchaToken: '' });
  });

  test('MFA_REQUIRED, INVALID_USERNAME_PASSWORD, CAPTCHA_REQUIRED, ו-429 / 427', async () => {
    const cases = [
      [jsonResponse({ responseStatus: { type: 'MFA_REQUIRED' }, customerMfaInfo: { mfaLastMethodUsed: 'sms' } }), { ok: false, reason: 'mfa_required', mfaMethod: 'sms' }],
      [jsonResponse({ responseStatus: { type: 'MFA_REQUIRED' } }), { ok: false, reason: 'mfa_required', mfaMethod: 'email' }],
      [jsonResponse({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }, 401), { ok: false, reason: 'bad_credentials', status: 401 }],
      [jsonResponse({ responseStatus: { type: 'CAPTCHA_REQUIRED' } }), { ok: false, reason: 'captcha', status: 200 }],
      [new Response('', { status: 429 }), { ok: false, reason: 'blocked', status: 429 }],
      [new Response('', { status: 427 }), { ok: false, reason: 'blocked', status: 427 }],
      [jsonResponse({ responseStatus: { type: 'SOMETHING_NEW' } }), { ok: false, reason: 'unexpected', status: 200 }],
    ];
    for (const [response, expected] of cases) {
      const result = await submitLogin({ email: 'a@b.test', password: FAKE_PASSWORD, cookies, fetchImpl: fakeFetch(() => response) });
      if (expected.reason === 'mfa_required') {
        assert.equal(result.reason, 'mfa_required');
        assert.equal(result.mfaMethod, expected.mfaMethod);
        assert.deepEqual(result.cookies, cookies);
      } else {
        assert.deepEqual(result, expected);
      }
    }
  });

  test('עוגיות חדשות מתשובת הכניסה נשמרות להמשך (MFA)', async () => {
    const fetchImpl = fakeFetch(() => withCookies({ responseStatus: { type: 'MFA_REQUIRED' } }, ['MFA=1; Path=/']));
    const result = await submitLogin({ email: 'a@b.test', password: FAKE_PASSWORD, cookies, fetchImpl });
    assert.deepEqual(result.cookies, { ...cookies, MFA: '1' });
  });

  test('קוד MFA: POST ל-verifyCode עם השדות, ומחזיר כרטיס', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-2' }));
    const result = await submitMfa({ code: '123456', mfaMethod: 'email', cookies, fetchImpl });
    assert.equal(result.ok, true);
    assert.equal(result.ticket, 'ST-2');
    const { url, options } = fetchImpl.calls[0];
    assert.ok(url.startsWith('https://sso.garmin.com/mobile/api/mfa/verifyCode'));
    assert.deepEqual(JSON.parse(options.body), {
      mfaMethod: 'email', mfaVerificationCode: '123456', rememberMyBrowser: true, reconsentList: [], mfaSetup: false,
    });
    assert.equal(options.headers.cookie, 'SESSION=abc; __cf_bm=xyz');
  });

  test('קוד MFA שגוי (תשובה אחרת) = mfa_failed; 429 = חסום', async () => {
    const wrong = await submitMfa({ code: '1', mfaMethod: 'email', cookies, fetchImpl: fakeFetch(() => jsonResponse({ responseStatus: { type: 'INVALID_MFA_CODE' } }, 400)) });
    assert.deepEqual(wrong, { ok: false, reason: 'mfa_failed', status: 400 });
    const blocked = await submitMfa({ code: '1', mfaMethod: 'email', cookies, fetchImpl: fakeFetch(() => new Response('', { status: 429 })) });
    assert.deepEqual(blocked, { ok: false, reason: 'blocked', status: 429 });
  });
});

describe('garmin: כניסה, שלב 3 (החלפת כרטיס בטוקנים)', () => {
  test('מנסה את מזהי הלקוח לפי הסדר, ועוצר בראשון שמצליח', async () => {
    const fetchImpl = fakeFetch((url, options, i) => (i === 0
      ? jsonResponse({ error: 'invalid_client' }, 400)
      : jsonResponse({ access_token: 'acc-FAKE', refresh_token: 'ref-FAKE', expires_in: 3600 })));
    const result = await exchangeTicket({ ticket: 'ST-1', fetchImpl });
    assert.deepEqual(result, { ok: true, tokens: { access_token: 'acc-FAKE', refresh_token: 'ref-FAKE', client_id: DI_CLIENT_IDS[1] } });
    assert.equal(fetchImpl.calls.length, 2);
    const { url, options } = fetchImpl.calls[1];
    assert.equal(url, DI_TOKEN_URL);
    assert.equal(options.headers.authorization, `Basic ${Buffer.from(`${DI_CLIENT_IDS[1]}:`).toString('base64')}`);
    assert.equal(options.headers['content-type'], 'application/x-www-form-urlencoded');
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('client_id'), DI_CLIENT_IDS[1]);
    assert.equal(body.get('service_ticket'), 'ST-1');
    assert.equal(body.get('service_url'), 'https://mobile.integration.garmin.com/gcm/ios');
    assert.equal(body.get('grant_type'), 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket');
  });

  test('ארבעת המזהים לפי הסדר מהמחקר', () => {
    assert.deepEqual(DI_CLIENT_IDS, [
      'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2', 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4',
      'GARMIN_CONNECT_MOBILE_ANDROID_DI', 'GARMIN_CONNECT_MOBILE_IOS_DI',
    ]);
  });

  test('429 עוצר מיד בלי לנסות את המזהה הבא; כולם נכשלו = exchange_failed', async () => {
    const blockedFetch = fakeFetch(() => new Response('', { status: 429 }));
    assert.deepEqual(await exchangeTicket({ ticket: 'ST-1', fetchImpl: blockedFetch }), { ok: false, reason: 'blocked', status: 429 });
    assert.equal(blockedFetch.calls.length, 1);
    const allFail = fakeFetch(() => jsonResponse({ error: 'invalid_client' }, 400));
    assert.deepEqual(await exchangeTicket({ ticket: 'ST-1', fetchImpl: allFail }), { ok: false, reason: 'exchange_failed', status: 400 });
    assert.equal(allFail.calls.length, 4);
  });

  test('403 (Cloudflare) או 5xx או רשת: עוצר מיד, בלי לנסות מזהים נוספים; רק 400/401 ממשיכים למזהה הבא', async () => {
    for (const [make, expected] of [
      [() => new Response('', { status: 403 }), { ok: false, reason: 'forbidden', status: 403 }],
      [() => new Response('', { status: 502 }), { ok: false, reason: 'http_error', status: 502 }],
      [() => { throw new Error('net'); }, { ok: false, reason: 'network', status: null }],
    ]) {
      const fetchImpl = fakeFetch(make);
      assert.deepEqual(await exchangeTicket({ ticket: 'ST-1', fetchImpl }), expected);
      assert.equal(fetchImpl.calls.length, 1);
    }
    const wrongClient = fakeFetch((url, options, i) => (i === 0 ? new Response('', { status: 401 }) : new Response('', { status: 403 })));
    assert.deepEqual(await exchangeTicket({ ticket: 'ST-1', fetchImpl: wrongClient }), { ok: false, reason: 'forbidden', status: 403 });
    assert.equal(wrongClient.calls.length, 2);
  });

  test('תשובה בלי refresh_token לא נחשבת הצלחה', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ access_token: 'acc-FAKE' }));
    const result = await exchangeTicket({ ticket: 'ST-1', fetchImpl });
    assert.equal(result.ok, false);
  });
});

describe('garmin: רענון', () => {
  const tokens = { access_token: 'old-acc', refresh_token: 'old-ref', client_id: DI_CLIENT_IDS[0] };

  test('שולח refresh_token עם Basic של המזהה השמור; refresh חדש נשמר', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse({ access_token: 'new-acc', refresh_token: 'new-ref' }));
    const result = await refreshTokens({ tokens, fetchImpl });
    assert.deepEqual(result, { ok: true, tokens: { access_token: 'new-acc', refresh_token: 'new-ref', client_id: DI_CLIENT_IDS[0] } });
    const { options } = fetchImpl.calls[0];
    assert.equal(options.headers.authorization, `Basic ${Buffer.from(`${DI_CLIENT_IDS[0]}:`).toString('base64')}`);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'old-ref');
    assert.equal(body.get('client_id'), DI_CLIENT_IDS[0]);
  });

  test('בלי refresh_token בתשובה: נשאר הישן (כמו בספרייה)', async () => {
    const result = await refreshTokens({ tokens, fetchImpl: fakeFetch(() => jsonResponse({ access_token: 'new-acc' })) });
    assert.equal(result.tokens.refresh_token, 'old-ref');
  });

  test('400 / 401 = auth (החיבור נפל); 429 = blocked; 503 ורשת = לא auth', async () => {
    for (const status of [400, 401]) {
      const r = await refreshTokens({ tokens, fetchImpl: fakeFetch(() => jsonResponse({ error: 'invalid_grant' }, status)) });
      assert.deepEqual(r, { ok: false, reason: 'auth_rejected', status, auth: true });
    }
    assert.deepEqual(await refreshTokens({ tokens, fetchImpl: fakeFetch(() => new Response('', { status: 429 })) }),
      { ok: false, reason: 'blocked', status: 429, auth: false });
    assert.deepEqual(await refreshTokens({ tokens, fetchImpl: fakeFetch(() => new Response('', { status: 503 })) }),
      { ok: false, reason: 'http_error', status: 503, auth: false });
    assert.deepEqual(await refreshTokens({ tokens, fetchImpl: fakeFetch(() => { throw new Error('x'); }) }),
      { ok: false, reason: 'network', status: null, auth: false });
  });
});

describe('garmin: תפוגה ובדיקת צורה', () => {
  test('tokenExpiresAt קורא exp מה-JWT; טוקן פגום = null', () => {
    assert.equal(tokenExpiresAt(jwtWithExp(2000000000)), 2000000000 * 1000);
    assert.equal(tokenExpiresAt('not-a-jwt'), null);
    assert.equal(tokenExpiresAt(undefined), null);
  });

  test('needsRefresh: פחות מ-900 שניות לתפוגה, או תפוגה לא ידועה', () => {
    const nowMs = 1_800_000_000_000;
    const t = (exp) => ({ access_token: jwtWithExp(exp), refresh_token: 'r', client_id: 'c' });
    assert.equal(needsRefresh(t(nowMs / 1000 + 901), nowMs), false);
    assert.equal(needsRefresh(t(nowMs / 1000 + 899), nowMs), true);
    assert.equal(needsRefresh({ access_token: 'x', refresh_token: 'r', client_id: 'c' }, nowMs), true);
  });

  test('isTokenSet: שלוש מחרוזות לא ריקות, מזהה לקוח בתווים מותרים, אורך סביר', () => {
    assert.equal(isTokenSet({ access_token: 'a', refresh_token: 'r', client_id: 'GARMIN_X' }), true);
    assert.equal(isTokenSet({ access_token: 'a', refresh_token: '', client_id: 'GARMIN_X' }), false);
    assert.equal(isTokenSet({ access_token: 'a', refresh_token: 'r', client_id: 'bad id;' }), false);
    assert.equal(isTokenSet({ access_token: 'a'.repeat(9000), refresh_token: 'r', client_id: 'X' }), false);
    assert.equal(isTokenSet(null), false);
  });
});

describe('garmin: קריאות API', () => {
  test('garminGet: הכתובת, Bearer, והכותרות של האפליקציה', async () => {
    const fetchImpl = fakeFetch(() => jsonResponse([{ a: 1 }]));
    const result = await garminGet({ path: '/x/y?z=1', accessToken: 'acc-FAKE', fetchImpl });
    assert.deepEqual(result, { ok: true, body: [{ a: 1 }] });
    const { url, options } = fetchImpl.calls[0];
    assert.equal(url, `${API_BASE}/x/y?z=1`);
    assert.equal(options.headers.authorization, 'Bearer acc-FAKE');
    assert.equal(options.headers['user-agent'], 'GCM-Android-5.23');
    assert.equal(options.headers['x-garmin-client-platform'], 'Android');
    assert.equal(options.headers['x-app-ver'], '10861');
    assert.ok(options.signal);
  });

  test('401 = auth, 403 = forbidden (Cloudflare?), 429 = blocked, JSON פגום = bad_response', async () => {
    const r = async (response) => garminGet({ path: '/p', accessToken: 'a', fetchImpl: fakeFetch(() => response) });
    assert.deepEqual(await r(new Response('', { status: 401 })), { ok: false, reason: 'auth_rejected', status: 401, auth: true });
    assert.deepEqual(await r(new Response('', { status: 403 })), { ok: false, reason: 'forbidden', status: 403, auth: false });
    assert.deepEqual(await r(new Response('', { status: 429 })), { ok: false, reason: 'blocked', status: 429, auth: false });
    assert.deepEqual(await r(new Response('<html>', { status: 200 })), { ok: false, reason: 'bad_response', status: 200, auth: false });
  });
});

describe('garmin: פענוח (רק השדות המותרים)', () => {
  test('פעילויות: מזהה, תאריך מקומי, שעת התחלה מ-GMT, משך מעוגל, סוג; בלי דופק ובלי GPS', () => {
    const items = parseActivities([
      {
        activityId: 111, activityName: 'ריצה קלה', startTimeLocal: '2026-11-20 06:30:00', startTimeGMT: '2026-11-20 04:30:00',
        duration: 1810.6, distance: 5000, activityType: { typeKey: 'running' }, averageHR: 150, startLatitude: 32.1, startLongitude: 34.8,
      },
      { activityId: 112, startTimeLocal: 'bad' },
      { activityName: 'no id', startTimeLocal: '2026-11-20 06:30:00' },
    ]);
    assert.deepEqual(items, [{
      garmin_id: 'act:111', kind: 'done', item_date: '2026-11-20', title: 'ריצה קלה', sport: 'running', duration_sec: 1811,
      starts_at: '2026-11-20T04:30:00.000Z',
    }]);
  });

  test('פעילות בלי startTimeGMT: שעת ההתחלה מהשעה המקומית בשעון ישראל', () => {
    const [item] = parseActivities([{ activityId: 5, startTimeLocal: '2026-11-20 06:30:00' }]);
    assert.equal(item.starts_at, '2026-11-20T04:30:00.000Z');
    assert.equal(item.duration_sec, null);
    assert.equal(item.title, null);
  });

  test('לוח שנה: רק itemType=workout, תאריך חוקי; שאר הסוגים מדולגים', () => {
    const items = parseCalendarItems({
      calendarItems: [
        { itemType: 'workout', id: 9, workoutId: 77, date: '2026-11-23', title: 'אינטרוולים', duration: 2700, sportTypeKey: 'running' },
        { itemType: 'activity', id: 10, date: '2026-11-21', title: 'x' },
        { itemType: 'workout', id: 11, date: 'nope', title: 'y' },
        { itemType: 'workout', workoutId: 12, date: '2026-11-24' },
      ],
    });
    assert.deepEqual(items, [
      { garmin_id: 'cal:9', kind: 'planned', item_date: '2026-11-23', title: 'אינטרוולים', sport: 'running', duration_sec: 2700, starts_at: null },
      { garmin_id: 'cal:12', kind: 'planned', item_date: '2026-11-24', title: null, sport: null, duration_sec: null, starts_at: null },
    ]);
    assert.deepEqual(parseCalendarItems(null), []);
    assert.deepEqual(parseCalendarItems({ calendarItems: 'x' }), []);
  });

  test('תוכנית: מערך או אובייקט עם מערך; שדות מתוך workout', () => {
    const row = { workoutScheduleId: 501, calendarDate: '2026-11-25', workout: { workoutName: 'טמפו', sportType: { sportTypeKey: 'running' }, estimatedDurationInSecs: 3000 } };
    const expected = [{ garmin_id: 'sched:501', kind: 'planned', item_date: '2026-11-25', title: 'טמפו', sport: 'running', duration_sec: 3000, starts_at: null }];
    assert.deepEqual(parseScheduledWorkouts([row]), expected);
    assert.deepEqual(parseScheduledWorkouts({ anything: [row] }), expected);
    assert.deepEqual(parseScheduledWorkouts('x'), []);
  });

  test('כותרת ארוכה נחתכת ל-200 תווים', () => {
    const [item] = parseActivities([{ activityId: 1, startTimeLocal: '2026-11-20 06:30:00', activityName: 'א'.repeat(500) }]);
    assert.equal(item.title.length, 200);
  });
});

describe('garmin: pullItems (מה שה-Cron מושך)', () => {
  test('חודשים בין שני תאריכים (חודש 0-based)', () => {
    assert.deepEqual(monthsBetween('2026-11-22', '2026-12-07'), [{ year: 2026, month0: 10 }, { year: 2026, month0: 11 }]);
    assert.deepEqual(monthsBetween('2026-12-20', '2027-01-04'), [{ year: 2026, month0: 11 }, { year: 2027, month0: 0 }]);
    assert.deepEqual(monthsBetween('2026-11-01', '2026-11-16'), [{ year: 2026, month0: 10 }]);
  });

  test('מתוכנן להיום עד +15, בוצע לשלושת הימים האחרונים; כפילות לוח/תוכנית (תאריך+כותרת) נספרת פעם אחת', async () => {
    const fetchImpl = fakeFetch((url) => {
      if (url.includes('/activitylist-service/')) {
        return jsonResponse([
          { activityId: 1, startTimeLocal: '2026-11-22 06:00:00', activityName: 'היום' },
          { activityId: 2, startTimeLocal: '2026-11-20 06:00:00', activityName: 'לפני יומיים' },
          { activityId: 3, startTimeLocal: '2026-11-19 06:00:00', activityName: 'ישן מדי' },
        ]);
      }
      if (url.includes('/calendar-service/year/2026/month/10')) {
        return jsonResponse({ calendarItems: [
          { itemType: 'workout', id: 9, date: '2026-11-23', title: 'אינטרוולים' },
          { itemType: 'workout', id: 8, date: '2026-11-21', title: 'עבר' },
        ] });
      }
      if (url.includes('/calendar-service/year/2026/month/11')) {
        return jsonResponse({ calendarItems: [
          { itemType: 'workout', id: 20, date: '2026-12-07', title: 'יום 15' },
          { itemType: 'workout', id: 21, date: '2026-12-08', title: 'מעבר לחלון' },
        ] });
      }
      if (url.includes('/workout-service/schedule/workoutScheduleByPeriod')) {
        return jsonResponse([{ workoutScheduleId: 501, calendarDate: '2026-11-23', workout: { workoutName: 'אינטרוולים' } }]);
      }
      return new Response('', { status: 404 });
    });
    const result = await pullItems({ accessToken: 'a', fetchImpl, today: '2026-11-22' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.failures, []);
    assert.deepEqual(result.items.map((i) => i.garmin_id).sort(), ['act:1', 'act:2', 'cal:20', 'cal:9']);
    const scheduleUrl = new URL(fetchImpl.calls.find((c) => c.url.includes('workoutScheduleByPeriod')).url);
    assert.equal(scheduleUrl.searchParams.get('startDate'), '2026-11-22');
    assert.equal(scheduleUrl.searchParams.get('endDate'), '2026-12-07');
    const actUrl = new URL(fetchImpl.calls.find((c) => c.url.includes('activitylist')).url);
    assert.equal(actUrl.searchParams.get('start'), '0');
  });

  test('קריאה אחת נכשלת: השאר נשמרים, והכשל מדווח; auth מסומן', async () => {
    const fetchImpl = fakeFetch((url) => (url.includes('activitylist')
      ? new Response('', { status: 401 })
      : jsonResponse(url.includes('calendar-service') ? { calendarItems: [{ itemType: 'workout', id: 9, date: '2026-11-23', title: 'x' }] } : [])));
    const result = await pullItems({ accessToken: 'a', fetchImpl, today: '2026-11-22' });
    assert.equal(result.ok, false);
    assert.equal(result.auth, true);
    assert.deepEqual(result.failures, ['activities:auth_rejected (401)']);
    assert.deepEqual(result.items.map((i) => i.garmin_id), ['cal:9']);
  });

  test('401 באמצע: רענון אחד, ואותה קריאה נשלחת שוב עם הטוקן החדש; הקריאות הבאות עם החדש', async () => {
    let renewCalls = 0;
    const renewAccess = async () => { renewCalls += 1; return { ok: true, accessToken: 'new' }; };
    const fetchImpl = fakeFetch((url, options) => {
      if (options.headers.authorization === 'Bearer old') return new Response('', { status: 401 });
      return jsonResponse(url.includes('calendar-service') ? { calendarItems: [] } : []);
    });
    const result = await pullItems({ accessToken: 'old', fetchImpl, today: '2026-11-22', renewAccess });
    assert.equal(result.ok, true);
    assert.equal(renewCalls, 1);
    assert.equal(fetchImpl.calls[0].options.headers.authorization, 'Bearer old');
    assert.ok(fetchImpl.calls.slice(1).every((c) => c.options.headers.authorization === 'Bearer new'));
    assert.equal(fetchImpl.calls[1].url, fetchImpl.calls[0].url, 'אותה קריאה נשלחת שוב');
  });

  test('גם הטוקן המרוענן מקבל 401: auth, בלי רענון שני', async () => {
    let renewCalls = 0;
    const renewAccess = async () => { renewCalls += 1; return { ok: true, accessToken: 'new' }; };
    const fetchImpl = fakeFetch(() => new Response('', { status: 401 }));
    const result = await pullItems({ accessToken: 'old', fetchImpl, today: '2026-11-22', renewAccess });
    assert.equal(renewCalls, 1);
    assert.equal(result.auth, true);
    assert.equal(result.failures[0], 'activities:auth_rejected (401)');
  });

  test('הרענון עצמו נכשל: עוצרים את המשיכה, הסיבה והסוג (auth או לא) מהרענון', async () => {
    const fetchImpl = fakeFetch(() => new Response('', { status: 401 }));
    const notAuth = await pullItems({ accessToken: 'old', fetchImpl, today: '2026-11-22', renewAccess: async () => ({ ok: false, reason: 'refresh_network', auth: false }) });
    assert.equal(fetchImpl.calls.length, 1);
    assert.deepEqual(notAuth.failures, ['activities:refresh_network']);
    assert.equal(notAuth.auth, false);
    const auth = await pullItems({ accessToken: 'old', fetchImpl: fakeFetch(() => new Response('', { status: 401 })), today: '2026-11-22', renewAccess: async () => ({ ok: false, reason: 'refresh_auth_rejected (400)', auth: true }) });
    assert.equal(auth.auth, true);
  });

  test('429 בקריאה אחת: לא ממשיכים לקריאות הבאות (בלי הצפה)', async () => {
    const fetchImpl = fakeFetch(() => new Response('', { status: 429 }));
    const result = await pullItems({ accessToken: 'a', fetchImpl, today: '2026-11-22' });
    assert.equal(fetchImpl.calls.length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.blocked, true);
  });
});
