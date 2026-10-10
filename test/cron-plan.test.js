// בדיקות ל-lib/ops/cron-plan.js (שלב 1: שורה ב-probe_log בלבד) וללוח הזמנים ב-vercel.json (קריאה בלבד).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../lib/ops/cron-plan.js';
import { fakeSql, captureConsole, req, FAKE_CRON } from './helpers.js';

const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
const FIXED = () => new Date('2026-10-07T05:00:00.000Z');
const fakeSend = () => { const calls = []; const fn = async (...args) => { calls.push(args); return { messageId: 'm1' }; }; fn.calls = calls; return fn; };
const run = (r, deps = {}) => handle(r, { sql: fakeSql(), secret: FAKE_CRON, now: FIXED, send: fakeSend(), ...deps });

describe('cron-plan: שיטות ואימות', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      const sql = fakeSql();
      const res = await run(req('https://x.test/api/cron-plan', { method, headers: AUTH }), { sql });
      assert.equal(res.status, 405);
      assert.equal(sql.calls.length, 0);
    });
  }
  test('בלי Authorization - 401', async () => {
    const sql = fakeSql();
    const res = await run(req('https://x.test/api/cron-plan'), { sql });
    assert.equal(res.status, 401);
    assert.equal(sql.calls.length, 0);
  });
  test('סוד שגוי - 401', async () => {
    const res = await run(req('https://x.test/', { headers: { authorization: 'Bearer nope' } }));
    assert.equal(res.status, 401);
  });
  test('הסוד בלי הקידומת Bearer - 401', async () => {
    const res = await run(req('https://x.test/', { headers: { authorization: FAKE_CRON } }));
    assert.equal(res.status, 401);
  });
  test('Bearer באותיות קטנות (bearer) - 401 (השוואה מדויקת)', async () => {
    const res = await run(req('https://x.test/', { headers: { authorization: `bearer ${FAKE_CRON}` } }));
    assert.equal(res.status, 401);
  });
  test('סוד באורכים שונים / ארוך מאוד - 401 בלי קריסה', async () => {
    for (const bad of ['', 'Bearer ', `Bearer ${FAKE_CRON}x`, `Bearer ${'z'.repeat(20000)}`]) {
      const res = await run(req('https://x.test/', { headers: { authorization: bad } }));
      assert.equal(res.status, 401);
    }
  });
  test('סוד לא מוגדר בשרת - 401 גם אם נשלח "Bearer undefined"', async (t) => {
    captureConsole(t);
    for (const secret of [undefined, '', null]) {
      const res = await run(req('https://x.test/', { headers: { authorization: 'Bearer undefined' } }), { secret });
      assert.equal(res.status, 401);
    }
  });
  test('סוד נכון - 200 ו-OK', async () => {
    const res = await run(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'OK');
  });
});

describe('cron-plan: תוכן שורת ה-probe_log', () => {
  const detailOf = async (url, headers = {}) => {
    const sql = fakeSql();
    await run(req(url, { headers: { ...AUTH, ...headers } }), { sql });
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /INSERT INTO probe_log/);
    return sql.calls[0].values[1];
  };
  test('slot=1 ו-slot=2 נרשמים עם הזמן ב-UTC', async () => {
    assert.equal(await detailOf('https://x.test/api/cron-plan?slot=1'), 'slot=1; schedule=none; invoked_utc=2026-10-07T05:00:00.000Z; queued=brief-2026-10-08; target_utc=2026-10-08T04:30:00.000Z; delay_s=84600');
    assert.match(await detailOf('https://x.test/api/cron-plan?slot=2'), /^slot=2;/);
  });
  test('בלי slot - unknown', async () => {
    assert.match(await detailOf('https://x.test/api/cron-plan'), /^slot=unknown;/);
  });
  test('slot לא תקין (אות, שלילי, ארוך, ריק, SQL) - unknown', async () => {
    for (const bad of ['abc', '-1', '123', '', "1';DROP", '1.5', '%00', '１']) {
      assert.match(await detailOf(`https://x.test/api/cron-plan?slot=${encodeURIComponent(bad)}`), /^slot=unknown;/, bad);
    }
  });
  test('כותרת x-vercel-cron-schedule נרשמת', async () => {
    assert.match(await detailOf('https://x.test/api/cron-plan?slot=1', { 'x-vercel-cron-schedule': '0 5 * * *' }), /schedule=0 5 \* \* \*;/);
  });
  test('הסוד לעולם לא נכנס לשורה שנרשמת', async () => {
    assert.ok(!(await detailOf('https://x.test/api/cron-plan?slot=1')).includes(FAKE_CRON));
  });
  test('הזמן מוזרק ונרשם ב-UTC גם סביב מעבר שעון הקיץ בישראל (2026-10-25)', async () => {
    for (const iso of ['2026-10-24T22:59:59.000Z', '2026-10-24T23:00:00.000Z', '2026-10-25T00:00:00.000Z', '2026-10-25T05:00:00.000Z']) {
      const sql = fakeSql();
      await handle(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql, secret: FAKE_CRON, now: () => new Date(iso) });
      assert.ok(sql.calls[0].values[1].includes(`invoked_utc=${iso}`), iso);
    }
  });
});

describe('cron-plan: כשלים', () => {
  test('כשל במסד - 500 והלוג לא כולל את הסוד', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql(() => { throw new Error('relation "probe_log" does not exist'); });
    const res = await run(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql });
    assert.equal(res.status, 500);
    assert.equal(await res.text(), 'Internal Server Error');
    assert.ok(!cap.text().includes(FAKE_CRON));
  });
  test('שגיאה בלי message (undefined) לא קורסת', async (t) => {
    captureConsole(t);
    const res = await run(req('https://x.test/', { headers: AUTH }), { sql: fakeSql(() => { throw undefined; }) });
    assert.equal(res.status, 500);
  });
});

// vercel.json רץ ב-UTC. מבלוק 3 ה-Cron רק מתזמן: חלון ה-Cron (שעה שלמה ב-Hobby) חייב להסתיים לפני היעד המקומי, והיעד עצמו נקבע בקוד.
describe('cron-plan: תזמון משבצות לתור', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const crons = cfg.crons;
  const sendAt = async (slot, iso) => {
    const send = fakeSend();
    const sql = fakeSql();
    const res = await handle(req(`https://x.test/api/cron-plan?slot=${slot}`, { headers: AUTH }), { sql, secret: FAKE_CRON, now: () => new Date(iso), send });
    return { res, send, sql };
  };
  test('Cron של cron-plan הם בדיוק slot=1 ו-slot=2, והאחרים הם daily-check ו-gate-probe?from=0 (כולם דרך /api/ops)', () => {
    const cronPlanPaths = crons.filter((c) => c.path.startsWith('/api/ops?task=cron-plan'));
    assert.deepEqual(cronPlanPaths.map((c) => c.path), ['/api/ops?task=cron-plan&slot=1', '/api/ops?task=cron-plan&slot=2']);
    assert.deepEqual(crons.filter((c) => !c.path.startsWith('/api/ops?task=cron-plan')).map((c) => c.path), ['/api/ops?task=daily-check', '/api/ops?task=gate-probe&from=0&model=gemini-3.5-flash-lite']);
    assert.equal(crons.find((c) => c.path.startsWith('/api/ops?task=gate-probe')).schedule, '50 4 * * *');
  });
  test('שעות ה-Cron: slot=1 בשעה 01:00 UTC ו-slot=2 בשעה 14:00 UTC (חלון של שעה, לפני היעד גם בקיץ וגם בחורף)', () => {
    assert.equal(crons[0].schedule, '0 1 * * *');
    assert.equal(crons[1].schedule, '0 14 * * *');
    // היעד המוקדם ביותר: 07:30 בישראל = 04:30Z בקיץ; 21:00 = 18:00Z בקיץ. חלון 01:00-01:59 ו-14:00-14:59 מסתיים לפני שניהם.
    const hourOf = (c) => Number(c.schedule.split(' ')[1]);
    assert.ok(hourOf(crons[0]) + 1 <= 4.5, 'חלון הבריף חייב להסתיים לפני 04:30Z');
    assert.ok(hourOf(crons[1]) + 1 <= 18, 'חלון הסגירה חייב להסתיים לפני 18:00Z');
  });
  test('פונקציית הצרכן מוגדרת עם טריגר התור daily-slots, והכתובת הישנה של vapid מופנית ל-push-subscribe', () => {
    assert.equal(cfg.functions['api/queues/deliver.js'].experimentalTriggers[0].topic, 'daily-slots');
    assert.deepEqual(cfg.rewrites, [
      { source: '/api/vapid-public-key', destination: '/api/push-subscribe' },
      { source: '/api/cron-plan', destination: '/api/ops?task=cron-plan' },
      { source: '/api/daily-check', destination: '/api/ops?task=daily-check' },
      { source: '/api/gate-probe', destination: '/api/ops?task=gate-probe' },
    ]);
  });
  test('slot=1 בקיץ (2026-10-24 01:30Z): יעד 07:30 ישראל = 04:30Z, 3 שעות השהיה, מפתח לפי תאריך', async () => {
    const { res, send } = await sendAt(1, '2026-10-24T01:30:00.000Z');
    assert.equal(res.status, 200);
    assert.deepEqual(send.calls[0], ['daily-slots', { kind: 'brief', slotKey: 'brief-2026-10-24', targetAt: '2026-10-24T04:30:00.000Z' },
      { delaySeconds: 10800, retentionSeconds: 97200, idempotencyKey: 'brief-2026-10-24' }]);
  });
  test('slot=1 אחרי המעבר לשעון חורף (2026-10-25 01:30Z): יעד 07:30 ישראל = 05:30Z (שעה אחרי בקיץ)', async () => {
    const { send } = await sendAt(1, '2026-10-25T01:30:00.000Z');
    assert.equal(send.calls[0][1].targetAt, '2026-10-25T05:30:00.000Z');
    assert.equal(send.calls[0][2].delaySeconds, 14400);
  });
  test('slot=2 בקיץ ובחורף: 21:00 ישראל = 18:00Z לפני המעבר ו-19:00Z אחריו', async () => {
    const a = await sendAt(2, '2026-10-24T14:30:00.000Z');
    assert.equal(a.send.calls[0][1].targetAt, '2026-10-24T18:00:00.000Z');
    assert.equal(a.send.calls[0][1].kind, 'close');
    assert.equal(a.send.calls[0][2].delaySeconds, 12600);
    const b = await sendAt(2, '2026-10-25T14:30:00.000Z');
    assert.equal(b.send.calls[0][1].targetAt, '2026-10-25T19:00:00.000Z');
  });
  test('Cron כפול באותו יום: אותו idempotencyKey (התור יתעלם מהשני)', async () => {
    const a = await sendAt(1, '2026-10-26T01:10:00.000Z');
    const b = await sendAt(1, '2026-10-26T01:50:00.000Z');
    assert.equal(a.send.calls[0][2].idempotencyKey, b.send.calls[0][2].idempotencyKey);
  });
  test('slot לא מוכר (unknown/3): אין שליחה לתור, שורת probe_log נכתבת ו-200', async () => {
    for (const slot of ['3', 'abc']) {
      const { res, send, sql } = await sendAt(slot, '2026-10-24T01:30:00.000Z');
      assert.equal(res.status, 200);
      assert.equal(send.calls.length, 0);
      assert.equal(sql.calls.length, 1);
    }
  });
  test('כשל בשליחה לתור: 500, probe_log ok=false עם queue_failed, והלוג לא כולל סוד', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql();
    const send = async () => { throw Object.assign(new Error('boom ' + FAKE_CRON), { name: 'QueueError' }); };
    const res = await handle(req('https://x.test/api/cron-plan?slot=1', { headers: AUTH }), { sql, secret: FAKE_CRON, now: FIXED, send });
    assert.equal(res.status, 500);
    assert.equal(sql.calls.length, 1);
    assert.equal(sql.calls[0].values[0], false);
    assert.match(sql.calls[0].values[1], /queue_failed=brief-2026-10-08; error=QueueError/);
    assert.ok(!cap.text().includes(FAKE_CRON));
    assert.ok(!sql.calls[0].values[1].includes(FAKE_CRON));
  });
  test('בקשה שנדחית (401) לא נוגעת בתור', async () => {
    const send = fakeSend();
    const res = await handle(req('https://x.test/api/cron-plan?slot=1'), { sql: fakeSql(), secret: FAKE_CRON, now: FIXED, send });
    assert.equal(res.status, 401);
    assert.equal(send.calls.length, 0);
  });
});
