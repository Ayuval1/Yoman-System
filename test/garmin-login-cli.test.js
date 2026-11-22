// בדיקות ל-lib/garmin-login-cli.js (בלוק 5 חלק ב): הכניסה החד-פעמית מהמחשב של יובל. בלי רשת ובלי מקלדת: ask, fetch ו-sleep מזויפים.
// העיקר: הסיסמה, הסוד והטוקנים לא מודפסים אף פעם; חסימה (429/427/captcha) עוצרת בלי ניסיון חוזר; הסוד נבדק לפני הכניסה ל-Garmin.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, jsonResponse, FAKE_CRON } from './helpers.js';
import { runLogin, askLine } from '../lib/garmin-login-cli.js';
import { PassThrough } from 'node:stream';

const ORIGIN = 'https://app.test';
const PASSWORD = 'pw-FAKE-do-not-leak-123';
const TOKENS = { access_token: 'acc-FAKE-leak', refresh_token: 'ref-FAKE-leak', expires_in: 3600 };

// ask מזויף: מחזיר תשובות לפי סדר, ורושם אילו שאלות היו מוסתרות.
function fakeAsk(answers) {
  const asked = [];
  const ask = async (question, { hidden = false } = {}) => {
    asked.push({ question, hidden });
    if (answers.length === 0) throw new Error(`אין תשובה ל-${question}`);
    return answers.shift();
  };
  ask.asked = asked;
  return ask;
}

// השרת שלנו ו-Garmin יחד. overrides: url-substring -> Response.
function world(overrides = {}) {
  return fakeFetch((url, options) => {
    for (const [needle, make] of Object.entries(overrides)) if (url.includes(needle)) return make(url, options);
    if (url.includes('task=garmin-status')) return jsonResponse({ ok: true, connected: false, config_ok: true });
    if (url.includes('task=garmin-connect')) return jsonResponse({ ok: true, connected: true });
    if (url.includes('task=garmin-sync')) return jsonResponse({ ok: true, planned: 3, done: 1, stored: 4, failures: [], bubble: false });
    if (url.includes('/mobile/sso/')) return new Response('', { status: 200, headers: [['set-cookie', 'SESSION=s; Path=/']] });
    if (url.includes('/mobile/api/login')) return jsonResponse({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-1' });
    if (url.includes('/mobile/api/mfa/')) return jsonResponse({ responseStatus: { type: 'SUCCESSFUL' }, serviceTicketId: 'ST-2' });
    if (url.includes('diauth.garmin.com')) return jsonResponse(TOKENS);
    return new Response('', { status: 404 });
  });
}

async function run(fetchImpl, answers) {
  const lines = [];
  const sleeps = [];
  const ask = fakeAsk(answers);
  const code = await runLogin({ ask, fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, print: (line) => lines.push(String(line)), origin: ORIGIN, random: () => 0.5 });
  return { code, out: lines.join('\n'), ask, sleeps };
}

const leaked = (out) => [PASSWORD, FAKE_CRON, 'acc-FAKE-leak', 'ref-FAKE-leak'].filter((s) => out.includes(s));

describe('garmin-login-cli: המסלול המלא', () => {
  test('סוד, אימייל, סיסמה: בדיקת סוד, כניסה, שמירה בשרת, משיכה ראשונה; קוד 0 ובלי דליפה', async () => {
    const fetchImpl = world();
    const { code, out, ask, sleeps } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD]);
    assert.equal(code, 0);
    assert.deepEqual(leaked(out), []);
    assert.deepEqual(ask.asked.map((q) => q.hidden), [true, false, true]);
    // סדר: status, sso, login, diauth, connect, sync
    const order = fetchImpl.calls.map((c) => c.url);
    assert.ok(order[0].startsWith(`${ORIGIN}/api/ops?task=garmin-status`));
    assert.ok(order.findIndex((u) => u.includes('task=garmin-connect')) > order.findIndex((u) => u.includes('diauth')));
    assert.ok(order.at(-1).includes('task=garmin-sync'));
    for (const call of fetchImpl.calls.filter((c) => c.url.startsWith(ORIGIN))) {
      assert.equal(call.options.headers.authorization, `Bearer ${FAKE_CRON}`);
    }
    const connect = fetchImpl.calls.find((c) => c.url.includes('task=garmin-connect'));
    assert.equal(connect.options.method, 'POST');
    assert.deepEqual(JSON.parse(connect.options.body), { access_token: 'acc-FAKE-leak', refresh_token: 'ref-FAKE-leak', client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2' });
    assert.deepEqual(sleeps, [3500], 'המתנה של 2-5 שניות בין דף הכניסה לשליחה');
    assert.match(out, /3/);
  });

  test('MFA: שואל קוד (גלוי) ושולח ל-verifyCode', async () => {
    const fetchImpl = world({ '/mobile/api/login': () => jsonResponse({ responseStatus: { type: 'MFA_REQUIRED' } }) });
    const { code, ask } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD, '123456']);
    assert.equal(code, 0);
    assert.equal(ask.asked.length, 4);
    assert.equal(ask.asked[3].hidden, false);
    assert.ok(fetchImpl.calls.some((c) => c.url.includes('/mobile/api/mfa/verifyCode')));
  });
});

describe('garmin-login-cli: עצירות', () => {
  test('סוד שגוי (401): עוצר לפני ששואל סיסמה ולפני Garmin', async () => {
    const fetchImpl = world({ 'task=garmin-status': () => new Response('Unauthorized', { status: 401 }) });
    const { code, out, ask } = await run(fetchImpl, [FAKE_CRON]);
    assert.equal(code, 1);
    assert.equal(ask.asked.length, 1);
    assert.ok(!fetchImpl.calls.some((c) => c.url.includes('garmin.com')));
    assert.match(out, /CRON_SECRET/);
  });

  test('טבלה חסרה או מפתח חסר בשרת: עוצר לפני Garmin', async () => {
    for (const body of [{ ok: false, reason: 'table_missing' }, { ok: true, connected: false, config_ok: false }]) {
      const fetchImpl = world({ 'task=garmin-status': () => jsonResponse(body) });
      const { code, ask } = await run(fetchImpl, [FAKE_CRON]);
      assert.equal(code, 1);
      assert.equal(ask.asked.length, 1);
      assert.ok(!fetchImpl.calls.some((c) => c.url.includes('garmin.com')));
    }
  });

  test('429 / 427 / captcha בכניסה: הודעה בעברית, יציאה, קריאה אחת בלבד ל-login (בלי ניסיון חוזר)', async () => {
    const cases = [
      () => new Response('', { status: 429 }),
      () => new Response('', { status: 427 }),
      () => jsonResponse({ responseStatus: { type: 'CAPTCHA_REQUIRED' } }),
    ];
    for (const make of cases) {
      const fetchImpl = world({ '/mobile/api/login': make });
      const { code, out } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD]);
      assert.equal(code, 1);
      assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/mobile/api/login')).length, 1);
      assert.ok(!fetchImpl.calls.some((c) => c.url.includes('task=garmin-connect')));
      assert.match(out, /לא לנסות שוב/);
      assert.deepEqual(leaked(out), []);
    }
  });

  test('סיסמה שגויה: הודעה ויציאה, בלי ניסיון חוזר', async () => {
    const fetchImpl = world({ '/mobile/api/login': () => jsonResponse({ responseStatus: { type: 'INVALID_USERNAME_PASSWORD' } }, 401) });
    const { code, out } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD]);
    assert.equal(code, 1);
    assert.equal(fetchImpl.calls.filter((c) => c.url.includes('/mobile/api/login')).length, 1);
    assert.deepEqual(leaked(out), []);
  });

  test('השרת לא שמר (503 table_missing בזמן connect): קוד 1, בלי דליפת טוקנים', async () => {
    const fetchImpl = world({ 'task=garmin-connect': () => jsonResponse({ ok: false, reason: 'table_missing' }, 503) });
    const { code, out } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD]);
    assert.equal(code, 1);
    assert.deepEqual(leaked(out), []);
  });

  test('משיכה ראשונה נכשלה (למשל 403 מ-Cloudflare בשרת): החיבור נשמר, הכשל מודפס, קוד 2', async () => {
    const fetchImpl = world({ 'task=garmin-sync': () => jsonResponse({ ok: false, reason: 'activities:forbidden (403)', failures: ['activities:forbidden (403)'], bubble: false }) });
    const { code, out } = await run(fetchImpl, [FAKE_CRON, 'a@b.test', PASSWORD]);
    assert.equal(code, 2);
    assert.match(out, /forbidden/);
  });
});

describe('garmin-login-cli: askLine', () => {
  test('קלט מוסתר לא מודפס חזרה; Backspace מוחק תו; Enter מסיים', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => input;
    const output = new PassThrough();
    let echoed = '';
    output.on('data', (d) => { echoed += d.toString(); });
    const answer = askLine('Password: ', { hidden: true, input, output });
    input.write('se');
    input.write('cx\u007fret\r');
    assert.equal(await answer, 'secret');
    assert.ok(!echoed.includes('sec'));
    assert.ok(echoed.startsWith('Password: '));
  });

  test('קלט גלוי מודפס; Ctrl+C = ביטול', async () => {
    const input = new PassThrough();
    input.isTTY = true;
    input.setRawMode = () => input;
    const output = new PassThrough();
    let echoed = '';
    output.on('data', (d) => { echoed += d.toString(); });
    const answer = askLine('Email: ', { input, output });
    input.write('a@b\n');
    assert.equal(await answer, 'a@b');
    assert.ok(echoed.includes('a@b'));
    const cancelled = askLine('x: ', { input, output });
    input.write('\u0003');
    await assert.rejects(cancelled);
  });
});
