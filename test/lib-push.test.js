// בדיקות ל-lib/push.js: ולידציה, בניית payload, ניקוי שגיאות, Retry-After, ושולח הדחיפה (עם ספרייה מזויפת).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import {
  isAllowedEndpoint, validateSubscription, buildPayload, safeError, parseRetryAfterSeconds, createSender,
  DECLARATIVE_MAGIC, DEFAULT_TTL_SECONDS, DEFAULT_URGENCY,
} from '../lib/push.js';

const GOOD_P256 = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const GOOD_AUTH = 'tBHItJI5svbpez7KI4CCXg';
const GOOD_EP = 'https://web.push.apple.com/QAbc123';

describe('lib/push: isAllowedEndpoint', () => {
  test('מארחים מותרים (apple, fcm, mozilla, windows) מתקבלים', () => {
    for (const ep of [
      'https://web.push.apple.com/x', 'https://push.apple.com/x', 'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://db5p.notify.windows.com/?token=x',
    ]) assert.equal(isAllowedEndpoint(ep), true, ep);
  });
  test('http רגיל נדחה', () => assert.equal(isAllowedEndpoint('http://web.push.apple.com/x'), false));
  test('מארח זר נדחה (הגנה מ-SSRF)', () => {
    for (const ep of ['https://evil.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://169.254.169.254/latest/meta-data']) {
      assert.equal(isAllowedEndpoint(ep), false, ep);
    }
  });
  test('התחזות: מארח מותר כתת-דומיין של תוקף או עם @ נדחה', () => {
    for (const ep of [
      'https://web.push.apple.com.evil.com/x', 'https://evilpush.apple.com/x', 'https://web.push.apple.com@evil.com/x',
      'https://evil.com/?h=web.push.apple.com', 'https://fcm.googleapis.com.evil.com/',
    ]) assert.equal(isAllowedEndpoint(ep), false, ep);
  });
  test('לא מחרוזת / ריק / לא כתובת / ארוך מדי נדחה', () => {
    for (const ep of [undefined, null, 5, {}, [], '', 'not a url', 'https://', 'https://web.push.apple.com/' + 'a'.repeat(2100)]) {
      assert.equal(isAllowedEndpoint(ep), false);
    }
  });
});

describe('lib/push: validateSubscription', () => {
  const good = () => ({ endpoint: GOOD_EP, keys: { p256dh: GOOD_P256, auth: GOOD_AUTH } });
  test('מנוי תקין', () => {
    const r = validateSubscription(good());
    assert.equal(r.ok, true);
    assert.deepEqual(r.subscription, { endpoint: GOOD_EP, p256dh: GOOD_P256, auth: GOOD_AUTH });
  });
  test('שדות עודפים לא עוברים הלאה', () => {
    const r = validateSubscription({ ...good(), expirationTime: 5, evil: 'x' });
    assert.deepEqual(Object.keys(r.subscription).sort(), ['auth', 'endpoint', 'p256dh']);
  });
  test('לא אובייקט (null, מחרוזת, מספר, undefined)', () => {
    for (const v of [null, 'x', 5, undefined, true]) assert.equal(validateSubscription(v).ok, false);
  });
  test('מערך כקלט - נדחה (אין endpoint)', () => assert.equal(validateSubscription([]).ok, false));
  test('חסר keys / keys null / keys מחרוזת', () => {
    for (const keys of [undefined, null, 'abc']) {
      const r = validateSubscription({ endpoint: GOOD_EP, keys });
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'חסר keys');
    }
  });
  test('p256dh קצר/ארוך/עם תווים לא חוקיים/לא מחרוזת', () => {
    for (const p256dh of ['short', 'a'.repeat(201), GOOD_P256 + '!', 'a b'.repeat(10), 123, null]) {
      assert.equal(validateSubscription({ endpoint: GOOD_EP, keys: { p256dh, auth: GOOD_AUTH } }).ok, false);
    }
  });
  test('auth קצר/ארוך/לא חוקי', () => {
    for (const auth of ['abc', 'a'.repeat(101), 'bad auth!!', undefined]) {
      assert.equal(validateSubscription({ endpoint: GOOD_EP, keys: { p256dh: GOOD_P256, auth } }).ok, false);
    }
  });
  test('סיבת הדחייה לא כוללת ערכים מהקלט', () => {
    const r = validateSubscription({ endpoint: 'https://secret-host.evil/ABC', keys: { p256dh: GOOD_P256, auth: GOOD_AUTH } });
    assert.equal(r.ok, false);
    assert.ok(!r.reason.includes('secret-host'));
  });
  test('גבולות: p256dh באורך 20 ו-200 עוברים, 19 ו-201 נכשלים', () => {
    const ok = (len) => validateSubscription({ endpoint: GOOD_EP, keys: { p256dh: 'a'.repeat(len), auth: GOOD_AUTH } }).ok;
    assert.equal(ok(20), true);
    assert.equal(ok(200), true);
    assert.equal(ok(19), false);
    assert.equal(ok(201), false);
  });
});

describe('lib/push: buildPayload', () => {
  const parse = (r) => JSON.parse(r.json);
  test('payload מינימלי', () => {
    const r = buildPayload({ title: 'שלום', navigate: 'https://yoman-system.vercel.app/' });
    assert.equal(r.ok, true);
    assert.deepEqual(parse(r), { web_push: DECLARATIVE_MAGIC, notification: { title: 'שלום', navigate: 'https://yoman-system.vercel.app/' } });
    assert.equal(DECLARATIVE_MAGIC, 8030);
  });
  test('כולל body ו-app_badge כמחרוזת', () => {
    const n = parse(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/x', body: 'גוף', app_badge: 3 })).notification;
    assert.equal(n.body, 'גוף');
    assert.equal(n.app_badge, '3');
  });
  test('app_badge: ערכים חוקיים', () => {
    for (const [input, out] of [[0, '0'], ['0', '0'], [9999, '9999'], ['12', '12'], ['007', '7']]) {
      assert.equal(parse(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', app_badge: input })).notification.app_badge, out, String(input));
    }
  });
  test('app_badge: ערכים לא חוקיים', () => {
    for (const bad of [-1, 1.5, 10000, '12345', 'abc', true, {}, NaN, Infinity, '-3', '']) {
      assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', app_badge: bad }).ok, false, String(bad));
    }
  });
  test('app_badge null/undefined - מתעלמים', () => {
    for (const v of [null, undefined]) {
      assert.equal('app_badge' in parse(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', app_badge: v })).notification, false);
    }
  });
  test('title חסר / ריק / רווחים / לא מחרוזת / ארוך מ-120', () => {
    for (const title of [undefined, '', '   ', 5, null, 'א'.repeat(121)]) {
      assert.equal(buildPayload({ title, navigate: 'https://yoman-system.vercel.app/' }).ok, false, String(title));
    }
  });
  test('title באורך 120 בדיוק עובר', () => assert.equal(buildPayload({ title: 'א'.repeat(120), navigate: 'https://yoman-system.vercel.app/' }).ok, true));
  test('navigate חסר / ריק / רווחים / ארוך מ-500', () => {
    for (const navigate of [undefined, '', '  ', 7, 'a'.repeat(501)]) {
      assert.equal(buildPayload({ title: 't', navigate }).ok, false, String(navigate));
    }
  });
  test('body ארוך מ-500 או לא מחרוזת - נדחה; 500 בדיוק עובר', () => {
    assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', body: 'x'.repeat(501) }).ok, false);
    assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', body: 5 }).ok, false);
    assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', body: 'x'.repeat(500) }).ok, true);
  });
  test('body ריק (מחרוזת ריקה) מותר', () => assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/', body: '' }).ok, true));
  test('בלי ארגומנטים בכלל - נדחה בלי קריסה', () => assert.equal(buildPayload().ok, false));
  test('עברית, אימוג׳י ובייט NULL נשמרים ב-JSON תקין', () => {
    const title = 'אימון 🏃 \u0000 "ציטוט"';
    const r = buildPayload({ title, navigate: 'https://yoman-system.vercel.app/' });
    assert.equal(r.ok, true);
    assert.equal(parse(r).notification.title, title);
  });
  test('navigate יחסי הופך לכתובת מלאה לפי origin (נתיב, query ו-hash נשמרים)', () => {
    const origin = 'https://yoman-system.vercel.app';
    for (const [input, out] of [['/', `${origin}/`], ['/today?x=1#a', `${origin}/today?x=1#a`], ['  /x  ', `${origin}/x`]]) {
      assert.equal(parse(buildPayload({ title: 't', navigate: input }, { origin })).notification.navigate, out, input);
    }
  });
  test('navigate מלא של אותו האתר עובר כמו שהוא', () => {
    const origin = 'https://yoman-system.vercel.app';
    assert.equal(parse(buildPayload({ title: 't', navigate: `${origin}/a` }, { origin })).notification.navigate, `${origin}/a`);
  });
  test('navigate שאינו של האתר נדחה: אתר אחר, http, //protocol-relative, javascript:, ובלי origin גם יחסי', () => {
    const origin = 'https://yoman-system.vercel.app';
    for (const navigate of ['https://evil.test/', 'http://yoman-system.vercel.app/', '//evil.test/x', 'javascript:alert(1)', 'x/y', 'https://yoman-system.vercel.app.evil.test/']) {
      assert.equal(buildPayload({ title: 't', navigate }, { origin }).ok, false, navigate);
    }
    assert.equal(buildPayload({ title: 't', navigate: '/x' }).ok, false);
    assert.equal(buildPayload({ title: 't', navigate: 'https://yoman-system.vercel.app/x' }).ok, true);
  });
  test('שדות עודפים (למשל __proto__ או data) לא נכנסים ל-payload', () => {
    const input = JSON.parse('{"title":"t","navigate":"https://yoman-system.vercel.app/","__proto__":{"x":1},"data":"secret","web_push":1}');
    const out = parse(buildPayload(input));
    assert.equal(out.web_push, 8030);
    assert.equal('data' in out.notification, false);
    assert.equal(({}).x, undefined);
  });
});

describe('lib/push: safeError', () => {
  test('מסיר סודות ידועים', () => {
    assert.equal(safeError('failed key=SECRET123 end', ['SECRET123']), 'failed key=[הוסר] end');
  });
  test('מסיר כל הופעה, גם כפולה', () => {
    assert.equal(safeError('A A A', ['A']), '[הוסר] [הוסר] [הוסר]');
  });
  test('מחליף כתובות http/https', () => {
    assert.equal(safeError('GET https://web.push.apple.com/abc?x=1 failed http://a.b/c'), 'GET [כתובת] failed [כתובת]');
  });
  test('סוד שהוא חלק מכתובת מוסר לפני הכתובת', () => {
    const out = safeError('boom https://push.example/TOKEN123', ['TOKEN123']);
    assert.ok(!out.includes('TOKEN123'));
  });
  test('חותך ל-200 תווים', () => assert.equal(safeError('x'.repeat(1000)).length, 200));
  test('קלט לא מחרוזת / חסר', () => {
    assert.equal(safeError(undefined), '');
    assert.equal(safeError(null), '');
    assert.equal(safeError(42), '42');
  });
  test('ערכי סוד ריקים / לא-מחרוזת לא שוברים (ולא מוחקים הכל)', () => {
    assert.equal(safeError('abc', ['', null, undefined, 5]), 'abc');
  });
});

describe('lib/push: parseRetryAfterSeconds', () => {
  const NOW = Date.parse('2026-10-07T10:00:00Z');
  test('מספר שניות', () => {
    assert.equal(parseRetryAfterSeconds('120', NOW), 120);
    assert.equal(parseRetryAfterSeconds(' 30 ', NOW), 30);
    assert.equal(parseRetryAfterSeconds('0', NOW), 0);
  });
  test('תאריך HTTP עתידי - הפרש בשניות (מעוגל כלפי מעלה)', () => {
    assert.equal(parseRetryAfterSeconds('Wed, 07 Oct 2026 10:02:00 GMT', NOW), 120);
  });
  test('תאריך HTTP שעבר - 0', () => {
    assert.equal(parseRetryAfterSeconds('Wed, 07 Oct 2026 09:00:00 GMT', NOW), 0);
  });
  test('חסר / זבל - 60 (ברירת מחדל)', () => {
    for (const v of [undefined, null, '', 'abc', 5, {}]) assert.equal(parseRetryAfterSeconds(v, NOW), 60, String(v));
  });
});

describe('lib/push: createSender (ספרייה מזויפת)', () => {
  const sub = (host = 'web.push.apple.com') => ({ endpoint: `https://${host}/token`, p256dh: GOOD_P256, auth: GOOD_AUTH });
  function fakeLib({ send } = {}) {
    const lib = {
      vapidCalls: [], sendCalls: [],
      getVapidHeaders(...args) { lib.vapidCalls.push(args); return { Authorization: `vapid t=jwt-${lib.vapidCalls.length}, k=pub` }; },
      async sendNotification(target, payload, options) { lib.sendCalls.push({ target, payload, options }); return send ? send(target) : { statusCode: 201, headers: { a: 'b' } }; },
    };
    return lib;
  }
  const make = (lib, extra = {}) => createSender({ subject: 'mailto:t@example.com', publicKey: 'PUB', privateKey: 'PRIV', lib, now: () => 1_700_000_000_000, ...extra });

  test('שליחה מוצלחת: סטטוס, כותרות, ושליחת האפשרויות הנכונות', async () => {
    const lib = fakeLib();
    const r = await make(lib).send(sub(), '{"x":1}');
    assert.equal(r.status, 201);
    assert.equal(r.error, null);
    assert.deepEqual(r.headers, { a: 'b' });
    assert.equal(lib.sendCalls[0].payload, '{"x":1}');
    assert.equal(lib.sendCalls[0].options.TTL, DEFAULT_TTL_SECONDS);
    assert.equal(lib.sendCalls[0].options.urgency, DEFAULT_URGENCY);
    assert.equal(lib.sendCalls[0].options.headers.Authorization, 'vapid t=jwt-1, k=pub');
    assert.deepEqual(lib.sendCalls[0].target, { endpoint: sub().endpoint, keys: { p256dh: GOOD_P256, auth: GOOD_AUTH } });
  });
  test('getVapidHeaders מקבל audience (origin בלבד), subject והמפתחות', async () => {
    const lib = fakeLib();
    await make(lib).send(sub(), '{}');
    assert.deepEqual(lib.vapidCalls[0], ['https://web.push.apple.com', 'mailto:t@example.com', 'PUB', 'PRIV', 'aes128gcm']);
  });
  test('JWT נשמר בזיכרון לכל audience: שתי שליחות לאותו מארח = יצירה אחת', async () => {
    const lib = fakeLib();
    const sender = make(lib);
    await sender.send(sub(), '{}');
    await sender.send(sub(), '{}');
    assert.equal(lib.vapidCalls.length, 1);
  });
  test('מארחים שונים = JWT נפרד לכל אחד', async () => {
    const lib = fakeLib();
    const sender = make(lib);
    await sender.send(sub('web.push.apple.com'), '{}');
    await sender.send(sub('fcm.googleapis.com'), '{}');
    assert.equal(lib.vapidCalls.length, 2);
  });
  test('jwtIssuedAt נלקח מהשעון המוזרק', async () => {
    const r = await make(fakeLib()).send(sub(), '{}');
    assert.equal(r.jwtIssuedAt.getTime(), 1_700_000_000_000);
  });
  test('סטטוס חסר בתשובה - ברירת מחדל 201', async () => {
    const r = await make(fakeLib({ send: () => ({}) })).send(sub(), '{}');
    assert.equal(r.status, 201);
    assert.deepEqual(r.headers, {});
  });
  test('שגיאת HTTP (410/429/500) לא זורקת: מוחזר סטטוס וכותרות', async () => {
    for (const code of [410, 429, 500, 503, 404]) {
      const lib = fakeLib({ send: () => { throw Object.assign(new Error('x'), { statusCode: code, headers: { 'retry-after': '5' } }); } });
      const r = await make(lib).send(sub(), '{}');
      assert.equal(r.status, code);
      assert.equal(r.error, `HTTP ${code}`);
      assert.deepEqual(r.headers, { 'retry-after': '5' });
    }
  });
  test('שגיאת רשת: רק הקוד, בלי הודעת השגיאה (שעלולה להכיל מארח)', async () => {
    const lib = fakeLib({ send: () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND web.push.apple.com'), { code: 'ENOTFOUND' }); } });
    const r = await make(lib).send(sub(), '{}');
    assert.equal(r.status, null);
    assert.equal(r.error, 'שגיאת רשת ENOTFOUND');
    assert.ok(!r.error.includes('apple'));
  });
  test('שגיאה בלי code ובלי statusCode', async () => {
    const lib = fakeLib({ send: () => { throw new Error('whatever'); } });
    const r = await make(lib).send(sub(), '{}');
    assert.equal(r.status, null);
    assert.equal(r.error, 'שגיאת רשת');
  });
  test('שגיאה שאינה אובייקט (זורקים undefined) לא קורסת', async () => {
    const lib = fakeLib({ send: () => { throw undefined; } });
    const r = await make(lib).send(sub(), '{}');
    assert.equal(r.status, null);
  });
  test('code ארוך נחתך ל-30 תווים', async () => {
    const lib = fakeLib({ send: () => { throw Object.assign(new Error(), { code: 'X'.repeat(100) }); } });
    const r = await make(lib).send(sub(), '{}');
    assert.equal(r.error, `שגיאת רשת ${'X'.repeat(30)}`);
  });
  test('ttl ו-urgency ניתנים לדריסה', async () => {
    const lib = fakeLib();
    await make(lib).send(sub(), '{}', { ttl: 60, urgency: 'low' });
    assert.equal(lib.sendCalls[0].options.TTL, 60);
    assert.equal(lib.sendCalls[0].options.urgency, 'low');
  });
  test('מפתחות VAPID אמיתיים (נוצרים מקומית, בלי רשת) מפיקים כותרת Authorization תקינה', async () => {
    const keys = webpush.generateVAPIDKeys();
    const lib = { ...fakeLib(), getVapidHeaders: webpush.getVapidHeaders };
    const sent = [];
    lib.sendNotification = async (t, p, o) => { sent.push(o); return { statusCode: 201, headers: {} }; };
    const sender = createSender({ subject: 'mailto:t@example.com', publicKey: keys.publicKey, privateKey: keys.privateKey, lib });
    const r = await sender.send(sub(), '{}');
    assert.equal(r.status, 201);
    assert.match(sent[0].headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    assert.ok(!sent[0].headers.Authorization.includes(keys.privateKey));
  });
  test('מפתח פרטי פגום - נזרקת שגיאה מוקדם ולא שליחה (תיעוד: send לא תופס שגיאת יצירת JWT)', async () => {
    const lib = { sendNotification: async () => ({ statusCode: 201 }), getVapidHeaders: webpush.getVapidHeaders };
    const sender = createSender({ subject: 'mailto:t@example.com', publicKey: 'bad', privateKey: 'bad', lib });
    await assert.rejects(() => sender.send(sub(), '{}'));
  });
});
