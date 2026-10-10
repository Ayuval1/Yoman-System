// בדיקות ל-api/push-send.js: שליחת דחיפה לכל המנויים (עם שולח מזויף ו-sql מזויף).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/push-send.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_CRON } from './helpers.js';

const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
const VAPID = { subject: 'mailto:t@example.com', publicKey: 'PUBKEY', privateKey: 'PRIVATE-VAPID-KEY-DO-NOT-LEAK' };
const NOW = new Date('2026-10-07T10:00:00.000Z');
const ISSUED = new Date('2026-10-07T09:59:00.000Z');
const BODY = { title: 'בוקר טוב', body: 'יש אימון היום', navigate: 'https://yoman-system.vercel.app/' };

const mkSub = (id, extra = {}) => ({ id, endpoint: `https://web.push.apple.com/ENDPOINT-SECRET-${id}`, p256dh: `P256-SECRET-${id}`, auth: `AUTH-SECRET-${id}`, retry_after: null, ...extra });

// שולח מזויף: results = { [id]: { status, headers, error } } או פונקציה.
function fakeSender(results = {}) {
  const sent = [];
  const makeSender = (config) => {
    makeSender.config = config;
    return {
      async send(sub, json) {
        sent.push({ sub, json });
        const r = typeof results === 'function' ? results(sub) : (results[sub.id] ?? { status: 201 });
        return { status: r.status, headers: r.headers ?? {}, error: r.error ?? null, jwtIssuedAt: ISSUED };
      },
    };
  };
  makeSender.sent = sent;
  return makeSender;
}

// sql מזויף לפי טקסט השאילתה. claimed: האם INSERT ל-push_sends מחזיר שורה.
function pushSql({ subs = [], claim = () => [{ id: 1 }], onQuery } = {}) {
  return fakeSql((text, values, i) => {
    if (onQuery) { const r = onQuery(text, values, i); if (r !== undefined) return r; }
    if (text.startsWith('SELECT id, endpoint')) return subs;
    if (text.includes('INSERT INTO push_sends')) return claim(values);
    return [];
  });
}

const post = (body = BODY, headers = AUTH) => jsonRequest(body, { headers, url: 'https://yoman-system.vercel.app/api/push-send' });
const run = (r, deps = {}) => handle(r, { sql: pushSql(), secret: FAKE_CRON, vapid: VAPID, makeSender: fakeSender(), now: () => NOW, ...deps });

describe('push-send: שיטות ואימות', () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      assert.equal((await run(req('https://x.test/', { method, headers: AUTH }))).status, 405);
    });
  }
  test('בלי Authorization / שגוי / בלי Bearer - 401 ושום שליחה', async () => {
    const makeSender = fakeSender();
    const sql = pushSql({ subs: [mkSub(1)] });
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: FAKE_CRON }, { authorization: `Bearer ${FAKE_CRON}x` }, { authorization: `Bearer ${'q'.repeat(9999)}` }]) {
      assert.equal((await run(post(BODY, headers), { sql, makeSender })).status, 401);
    }
    assert.equal(sql.calls.length, 0);
    assert.equal(makeSender.sent.length, 0);
  });
  test('סוד לא מוגדר בשרת - 401', async (t) => {
    captureConsole(t);
    for (const secret of [undefined, '', null]) {
      assert.equal((await run(post(BODY, { authorization: 'Bearer undefined' }), { secret })).status, 401);
    }
  });
});

describe('push-send: הגדרת VAPID', () => {
  for (const missing of ['subject', 'publicKey', 'privateKey']) {
    test(`חסר ${missing} - 500, בלי גישה למסד ובלי שליחה`, async (t) => {
      const cap = captureConsole(t);
      const sql = pushSql({ subs: [mkSub(1)] });
      const makeSender = fakeSender();
      const res = await run(post(), { sql, makeSender, vapid: { ...VAPID, [missing]: undefined } });
      assert.equal(res.status, 500);
      assert.equal(sql.calls.length, 0);
      assert.equal(makeSender.sent.length, 0);
      assert.ok(!(await res.text()).includes('PRIVATE-VAPID'));
      assert.ok(!cap.text().includes('PRIVATE-VAPID'));
    });
  }
  test('vapid בכלל לא הוגדר (null) - 500 בלי קריסה', async (t) => {
    captureConsole(t);
    assert.equal((await run(post(), { vapid: null })).status, 500);
  });
  test('מחרוזות ריקות נחשבות חסרות', async (t) => {
    captureConsole(t);
    assert.equal((await run(post(), { vapid: { ...VAPID, subject: '' } })).status, 500);
  });
  test('הגדרות VAPID מועברות ליוצר השולח', async () => {
    const makeSender = fakeSender();
    await run(post(), { makeSender });
    assert.deepEqual(makeSender.config, VAPID);
  });
});

describe('push-send: ולידציה של הגוף', () => {
  const sqlNever = () => pushSql({ subs: [mkSub(1)] });
  test('JSON פגום / ריק - 400', async () => {
    for (const bad of ['{', '', 'nope', '{"title":']) {
      const sql = sqlNever();
      assert.equal((await run(jsonRequest(bad, { headers: AUTH, url: 'https://yoman-system.vercel.app/api/push-send' }), { sql })).status, 400, bad);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('JSON שאינו אובייקט - 400', async () => {
    for (const bad of ['null', '5', '"x"', 'true']) {
      assert.equal((await run(jsonRequest(bad, { headers: AUTH, url: 'https://yoman-system.vercel.app/api/push-send' }))).status, 400, bad);
    }
  });
  test('מערך כגוף - 400 (חסר title)', async () => {
    assert.equal((await run(jsonRequest('[]', { headers: AUTH }))).status, 400);
  });
  test('גוף גדול מ-4096 תווים - 400', async () => {
    assert.equal((await run(post({ ...BODY, pad: 'x'.repeat(5000) }))).status, 400);
  });
  test('title/navigate חסרים או לא חוקיים - 400 ושום גישה למסד', async () => {
    for (const body of [{ navigate: '/' }, { title: 't' }, { title: '', navigate: '/' }, { title: 'a'.repeat(121), navigate: '/' }, { title: 5, navigate: '/' }, { ...BODY, app_badge: -1 }, { ...BODY, body: 'x'.repeat(501) }]) {
      const sql = sqlNever();
      assert.equal((await run(post(body), { sql })).status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(sql.calls.length, 0);
    }
  });
  test('dedupe_key לא חוקי (מספר, ריק, ארוך מ-200, אובייקט) - 400', async () => {
    for (const dedupe_key of [5, '', 'k'.repeat(201), {}, [], true]) {
      assert.equal((await run(post({ ...BODY, dedupe_key }))).status, 400, String(dedupe_key));
    }
  });
  test('dedupe_key באורך 200 בדיוק עובר', async () => {
    assert.equal((await run(post({ ...BODY, dedupe_key: 'k'.repeat(200) }))).status, 200);
  });
  test('dedupe_key null מתנהג כמו חסר', async () => {
    const sql = pushSql({ subs: [mkSub(1)] });
    assert.equal((await run(post({ ...BODY, dedupe_key: null }), { sql })).status, 200);
    assert.equal(sql.find('push_sends').length, 0);
  });
});

describe('push-send: שליחה מוצלחת', () => {
  test('אין מנויים - 200 עם כל המונים אפס', async () => {
    const res = await run(post());
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'נשלחו: 0; דולגו: 0; 429: 0; 410: 0; נכשלו: 0');
  });
  test('שני מנויים - נשלח לשניהם עם אותו payload הצהרתי', async () => {
    const makeSender = fakeSender();
    const res = await run(post(), { sql: pushSql({ subs: [mkSub(1), mkSub(2)] }), makeSender });
    assert.match(await res.text(), /^נשלחו: 2;/);
    assert.equal(makeSender.sent.length, 2);
    const payload = JSON.parse(makeSender.sent[0].json);
    assert.equal(payload.web_push, 8030);
    assert.equal(payload.notification.title, 'בוקר טוב');
    assert.equal(makeSender.sent[0].json, makeSender.sent[1].json);
  });
  test('המנוי נטען עם WHERE status = active', async () => {
    const sql = pushSql({ subs: [] });
    await run(post(), { sql });
    assert.match(sql.calls[0].text, /WHERE status = 'active'/);
  });
  test('עדכון המנוי: last_status ו-vapid_jwt_issued_at (ISO)', async () => {
    const sql = pushSql({ subs: [mkSub(7)] });
    await run(post(), { sql });
    const upd = sql.find('UPDATE push_subscriptions SET last_sent_at')[0];
    assert.deepEqual(upd.values, [201, ISSUED.toISOString(), 7]);
  });
  test('כל שליחה נרשמת ב-call_log כ-push עם ok=true', async () => {
    const sql = pushSql({ subs: [mkSub(1)] });
    await run(post(), { sql });
    const log = sql.find('INTO call_log')[0];
    assert.equal(log.values[0], 201);
    assert.equal(log.values[1], true);
    assert.equal(log.values[3], null);
    assert.match(log.text, /'push'/);
  });
  test('עברית ואימוג׳י עוברים ל-payload ללא פגיעה', async () => {
    const makeSender = fakeSender();
    await run(post({ title: 'אימון 🏃‍♂️', body: 'ריצה קלה — 5K', navigate: '/x' }), { sql: pushSql({ subs: [mkSub(1)] }), makeSender });
    assert.equal(JSON.parse(makeSender.sent[0].json).notification.title, 'אימון 🏃‍♂️');
  });
  test('navigate יחסי בבקשה נשלח ככתובת מלאה לפי המקור של הבקשה, וכתובת של אתר אחר נדחית ב-400', async () => {
    const makeSender = fakeSender();
    await run(post({ ...BODY, navigate: '/today' }), { sql: pushSql({ subs: [mkSub(1)] }), makeSender });
    assert.equal(JSON.parse(makeSender.sent[0].json).notification.navigate, 'https://yoman-system.vercel.app/today');
    const sql = pushSql({ subs: [mkSub(1)] });
    assert.equal((await run(post({ ...BODY, navigate: 'https://evil.test/' }), { sql })).status, 400);
  });
  test('סטטוס 200 גם נחשב הצלחה (טווח 2xx)', async () => {
    const res = await run(post(), { sql: pushSql({ subs: [mkSub(1)] }), makeSender: fakeSender({ 1: { status: 200 } }) });
    assert.match(await res.text(), /^נשלחו: 1;/);
  });
});

describe('push-send: dedupe_key', () => {
  test('מפתח חדש - נתפס לפני השליחה ונשלח', async () => {
    const sql = pushSql({ subs: [mkSub(1)] });
    const makeSender = fakeSender();
    await run(post({ ...BODY, dedupe_key: 'brief-2026-10-07' }), { sql, makeSender });
    const claim = sql.find('INSERT INTO push_sends')[0];
    assert.deepEqual(claim.values, [1, 'brief-2026-10-07']);
    assert.match(claim.text, /ON CONFLICT \(subscription_id, dedupe_key\) DO NOTHING/);
    assert.equal(makeSender.sent.length, 1);
    assert.equal(sql.find('UPDATE push_sends SET status_code').length, 1);
  });
  test('מפתח שכבר נשלח (INSERT לא מחזיר שורה) - מדולג בלי שליחה', async () => {
    const sql = pushSql({ subs: [mkSub(1)], claim: () => [] });
    const makeSender = fakeSender();
    const res = await run(post({ ...BODY, dedupe_key: 'k' }), { sql, makeSender });
    assert.equal(makeSender.sent.length, 0);
    assert.match(await res.text(), /^נשלחו: 0; דולגו: 1;/);
    assert.equal(sql.find('INTO call_log').length, 0);
  });
  test('שליחה כפולה סימולטנית: המנוי הראשון נשלח והשני בקשה אחרת - מדולגת (מסד זיכרון)', async () => {
    const seen = new Set();
    const claim = ([subId, key]) => (seen.has(`${subId}|${key}`) ? [] : (seen.add(`${subId}|${key}`), [{ id: seen.size }]));
    const makeSender = fakeSender();
    const deps = () => ({ sql: pushSql({ subs: [mkSub(1)], claim }), makeSender });
    const shared = deps();
    const r1 = await run(post({ ...BODY, dedupe_key: 'same' }), shared);
    const r2 = await run(post({ ...BODY, dedupe_key: 'same' }), shared);
    assert.match(await r1.text(), /^נשלחו: 1;/);
    assert.match(await r2.text(), /^נשלחו: 0; דולגו: 1;/);
    assert.equal(makeSender.sent.length, 1);
  });
  test('מפתח מנוסה לכל מנוי בנפרד', async () => {
    const sql = pushSql({ subs: [mkSub(1), mkSub(2)] });
    await run(post({ ...BODY, dedupe_key: 'k' }), { sql });
    assert.deepEqual(sql.find('INSERT INTO push_sends').map((c) => c.values[0]), [1, 2]);
  });
  test('כשל בתפיסת המפתח - לא שולחים (עדיף לא פעמיים), נספר ככישלון, ממשיכים הלאה', async (t) => {
    captureConsole(t);
    const sql = pushSql({
      subs: [mkSub(1), mkSub(2)],
      onQuery: (text, values) => { if (text.includes('INSERT INTO push_sends') && values[0] === 1) throw new Error('db blip'); },
    });
    const makeSender = fakeSender();
    const res = await run(post({ ...BODY, dedupe_key: 'k' }), { sql, makeSender });
    assert.equal(makeSender.sent.length, 1);
    assert.equal(makeSender.sent[0].sub.id, 2);
    assert.match(await res.text(), /^נשלחו: 1; דולגו: 0; 429: 0; 410: 0; נכשלו: 1/);
  });
  test('בלי dedupe_key - אין כתיבה ל-push_sends בכלל', async () => {
    const sql = pushSql({ subs: [mkSub(1)] });
    await run(post(), { sql });
    assert.equal(sql.find('push_sends').length, 0);
  });
});

describe('push-send: 410, 429 ושגיאות', () => {
  test('410 - המנוי מסומן gone_410 (בלי מחיקה) ומשוחרר המפתח', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    const res = await run(post({ ...BODY, dedupe_key: 'k' }), { sql, makeSender: fakeSender({ 5: { status: 410, error: 'HTTP 410' } }) });
    assert.match(await res.text(), /410: 1/);
    assert.equal(sql.find("status = 'gone_410'").length, 1);
    assert.equal(sql.find('DELETE').length, 0);
    assert.equal(sql.find(':released:').length, 1);
  });
  test('429 עם Retry-After בשניות - נשמר retry_after = עכשיו + השניות', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    const res = await run(post(), { sql, makeSender: fakeSender({ 5: { status: 429, headers: { 'retry-after': '120' }, error: 'HTTP 429' } }) });
    assert.match(await res.text(), /429: 1/);
    const upd = sql.find('SET last_status = 429')[0];
    assert.equal(upd.values[0], new Date(NOW.getTime() + 120_000).toISOString());
    assert.equal(upd.values[1], 5);
  });
  test('429 בלי כותרת Retry-After - ברירת מחדל 60 שניות', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    await run(post(), { sql, makeSender: fakeSender({ 5: { status: 429 } }) });
    assert.equal(sql.find('SET last_status = 429')[0].values[0], new Date(NOW.getTime() + 60_000).toISOString());
  });
  test('429 עם Retry-After כתאריך HTTP', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    await run(post(), { sql, makeSender: fakeSender({ 5: { status: 429, headers: { 'retry-after': 'Wed, 07 Oct 2026 10:05:00 GMT' } } }) });
    assert.equal(sql.find('SET last_status = 429')[0].values[0], new Date(NOW.getTime() + 300_000).toISOString());
  });
  test('429 עם dedupe: המפתח משוחרר כדי שאפשר לנסות שוב מאוחר יותר', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    await run(post({ ...BODY, dedupe_key: 'k' }), { sql, makeSender: fakeSender({ 5: { status: 429 } }) });
    assert.equal(sql.find(':released:').length, 1);
  });
  test('מנוי עם retry_after בעתיד - מדולג בלי שליחה', async () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    const makeSender = fakeSender();
    const res = await run(post(), { sql: pushSql({ subs: [mkSub(1, { retry_after: future })] }), makeSender });
    assert.equal(makeSender.sent.length, 0);
    assert.match(await res.text(), /דולגו: 1/);
  });
  test('retry_after שעבר - נשלח כרגיל', async () => {
    const past = new Date(NOW.getTime() - 1000).toISOString();
    const makeSender = fakeSender();
    await run(post(), { sql: pushSql({ subs: [mkSub(1, { retry_after: past })] }), makeSender });
    assert.equal(makeSender.sent.length, 1);
  });
  test('retry_after בדיוק עכשיו - נשלח (לא "גדול מ")', async () => {
    const makeSender = fakeSender();
    await run(post(), { sql: pushSql({ subs: [mkSub(1, { retry_after: NOW.toISOString() })] }), makeSender });
    assert.equal(makeSender.sent.length, 1);
  });
  test('retry_after כאובייקט Date (כמו שדרייבר מחזיר) נתמך', async () => {
    const makeSender = fakeSender();
    await run(post(), { sql: pushSql({ subs: [mkSub(1, { retry_after: new Date(NOW.getTime() + 5000) })] }), makeSender });
    assert.equal(makeSender.sent.length, 0);
  });
  test('5xx - נספר ככישלון, ה-last_status מתעדכן, וה-dedupe נשאר תפוס', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    const res = await run(post({ ...BODY, dedupe_key: 'k' }), { sql, makeSender: fakeSender({ 5: { status: 503, error: 'HTTP 503' } }) });
    assert.match(await res.text(), /נכשלו: 1/);
    assert.equal(sql.find('SET last_status = ?').length, 1);
    assert.equal(sql.find(':released:').length, 0);
  });
  test('שגיאת רשת (status null) - ככישלון, ok=false ב-call_log', async () => {
    const sql = pushSql({ subs: [mkSub(5)] });
    const res = await run(post(), { sql, makeSender: fakeSender({ 5: { status: null, error: 'שגיאת רשת ECONNRESET' } }) });
    assert.match(await res.text(), /נכשלו: 1/);
    const log = sql.find('INTO call_log')[0];
    assert.equal(log.values[0], null);
    assert.equal(log.values[1], false);
  });
  test('סטטוס לא צפוי (404, 302) - ככישלון', async () => {
    for (const status of [404, 302, 400]) {
      const res = await run(post(), { sql: pushSql({ subs: [mkSub(1)] }), makeSender: fakeSender({ 1: { status } }) });
      assert.match(await res.text(), /נכשלו: 1/, String(status));
    }
  });
  test('שגיאה מחוץ לצפוי: מנוי אחד נכשל והאחרים ממשיכים להישלח', async () => {
    const makeSender = fakeSender({ 1: { status: 500 }, 2: { status: 201 }, 3: { status: 410 }, 4: { status: 429 } });
    const res = await run(post(), { sql: pushSql({ subs: [mkSub(1), mkSub(2), mkSub(3), mkSub(4)] }), makeSender });
    assert.equal(await res.text(), 'נשלחו: 1; דולגו: 0; 429: 1; 410: 1; נכשלו: 1');
  });
});

describe('push-send: כשלי מסד', () => {
  test('קריאת מנויים נכשלה - 500 בלי שליחה', async (t) => {
    const cap = captureConsole(t);
    const sql = pushSql({ onQuery: (text) => { if (text.startsWith('SELECT')) throw new Error('boom'); } });
    const makeSender = fakeSender();
    const res = await run(post(), { sql, makeSender });
    assert.equal(res.status, 500);
    assert.equal(makeSender.sent.length, 0);
    assert.ok(!cap.text().includes(FAKE_CRON));
  });
  test('כשל בעדכון מצב לא מפיל את הריצה ולא מונע את שאר המנויים', async (t) => {
    const cap = captureConsole(t);
    const sql = pushSql({ subs: [mkSub(1), mkSub(2)], onQuery: (text) => { if (text.startsWith('UPDATE push_subscriptions')) throw new Error('write failed'); } });
    const makeSender = fakeSender();
    const res = await run(post(), { sql, makeSender });
    assert.equal(res.status, 200);
    assert.equal(makeSender.sent.length, 2);
    assert.match(await res.text(), /^נשלחו: 2;/);
    assert.ok(cap.lines.some((l) => l.includes('עדכון מצב נכשל')));
  });
  test('כשל ב-call_log לא מפיל את הריצה', async (t) => {
    captureConsole(t);
    const sql = pushSql({ subs: [mkSub(1)], onQuery: (text) => { if (text.includes('INTO call_log')) throw new Error('log failed'); } });
    assert.equal((await run(post(), { sql })).status, 200);
  });
  test('שגיאות מסד שאינן Error (undefined) לא קורסות', async (t) => {
    captureConsole(t);
    const sql = pushSql({ subs: [mkSub(1)], onQuery: (text) => { if (text.startsWith('UPDATE')) throw undefined; } });
    assert.equal((await run(post(), { sql })).status, 200);
  });
});

describe('push-send: פרטיות (אין סוד, endpoint, מפתחות או תוכן בתשובה, בלוג או ב-call_log)', () => {
  test('call_log, תשובה ולוג נקיים גם כשהשולח מחזיר שגיאה שמכילה את כל הסודות', async (t) => {
    const cap = captureConsole(t);
    const sub = mkSub(9);
    const dirty = `failed ${sub.endpoint} p=${sub.p256dh} a=${sub.auth} k=${VAPID.privateKey} at https://other.example/path`;
    const sql = pushSql({ subs: [sub] });
    const res = await run(post({ ...BODY, body: 'תוכן-פרטי-של-ההודעה' }), { sql, makeSender: fakeSender({ 9: { status: 500, error: dirty } }) });
    const everything = [
      cap.text(), await res.text(),
      ...sql.calls.filter((c) => c.text.includes('call_log')).flatMap((c) => c.values.map(String)),
    ].join('\n');
    for (const secret of [sub.endpoint, 'ENDPOINT-SECRET', sub.p256dh, sub.auth, VAPID.privateKey, FAKE_CRON, 'תוכן-פרטי-של-ההודעה', 'other.example']) {
      assert.ok(!everything.includes(secret), `דלף: ${secret}`);
    }
  });
  test('מנוי בלי endpoint בתשובה גם בהצלחה', async () => {
    const res = await run(post(), { sql: pushSql({ subs: [mkSub(1)] }) });
    assert.ok(!(await res.text()).includes('apple'));
  });
  test('הודעת הכשל של 429/410 נרשמת ב-call_log רק כקוד קצר', async () => {
    const sql = pushSql({ subs: [mkSub(1)] });
    await run(post(), { sql, makeSender: fakeSender({ 1: { status: 410, error: 'HTTP 410' } }) });
    assert.equal(sql.find('INTO call_log')[0].values[3], 'HTTP 410');
  });
  test('ה-JSON של ה-payload הוא כל מה שנשלח - בלי שדות עודפים מהבקשה', async () => {
    const makeSender = fakeSender();
    await run(post({ ...BODY, secret_extra: 'x', dedupe_key: 'k' }), { sql: pushSql({ subs: [mkSub(1)] }), makeSender });
    assert.ok(!makeSender.sent[0].json.includes('secret_extra'));
    assert.ok(!makeSender.sent[0].json.includes('dedupe'));
  });
});
