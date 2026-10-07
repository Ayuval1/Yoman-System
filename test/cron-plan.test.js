// בדיקות ל-api/cron-plan.js (שלב 1: שורה ב-probe_log בלבד) וללוח הזמנים ב-vercel.json (קריאה בלבד).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../api/cron-plan.js';
import { fakeSql, captureConsole, req, FAKE_CRON } from './helpers.js';

const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
const FIXED = () => new Date('2026-10-07T05:00:00.000Z');
const run = (r, deps = {}) => handle(r, { sql: fakeSql(), secret: FAKE_CRON, now: FIXED, ...deps });

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
    return sql.calls[0].values[0];
  };
  test('slot=1 ו-slot=2 נרשמים עם הזמן ב-UTC', async () => {
    assert.equal(await detailOf('https://x.test/api/cron-plan?slot=1'), 'slot=1; schedule=none; invoked_utc=2026-10-07T05:00:00.000Z');
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
      assert.ok(sql.calls[0].values[0].endsWith(`invoked_utc=${iso}`), iso);
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

// vercel.json רץ ב-UTC. הבדיקות האלה מתעדות איך השעה בישראל זזה במעבר שעון.
// הקוד של cron-plan עדיין לא מחשב "משבצת" לפי שעה מקומית (שלב 1), לכן אין כאן לוגיקת משבצות לבדוק.
describe('cron-plan: לוח הזמנים ב-vercel.json מול שעון ישראל (DST)', () => {
  const crons = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons;
  const jerusalemHour = (iso) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    return parts;
  };
  test('יש בדיוק שני Cron עם slot=1 ו-slot=2', () => {
    assert.deepEqual(crons.map((c) => c.path), ['/api/cron-plan?slot=1', '/api/cron-plan?slot=2']);
  });
  test('מעבר השעון בישראל ב-2026 הוא ב-25 באוקטובר (UTC+3 לפני, UTC+2 אחרי)', () => {
    assert.equal(jerusalemHour('2026-10-24T05:00:00Z'), '08:00');
    assert.equal(jerusalemHour('2026-10-26T05:00:00Z'), '07:00');
  });
  test('Cron של 05:00 UTC: 08:00 בישראל לפני המעבר, 07:00 אחריו (סטייה של שעה, מתועדת)', () => {
    assert.equal(crons[0].schedule, '0 5 * * *');
    assert.equal(jerusalemHour('2026-10-24T05:00:00Z'), '08:00');
    assert.equal(jerusalemHour('2026-10-25T05:00:00Z'), '07:00');
  });
  test('Cron של 17:00 UTC: 20:00 בישראל לפני המעבר, 19:00 אחריו', () => {
    assert.equal(crons[1].schedule, '0 17 * * *');
    assert.equal(jerusalemHour('2026-10-24T17:00:00Z'), '20:00');
    assert.equal(jerusalemHour('2026-10-25T17:00:00Z'), '19:00');
  });
  test('ביום המעבר עצמו יש 25 שעות (שני ה-Cron עדיין נורים פעם אחת כל אחד)', () => {
    const start = Date.parse('2026-10-24T21:00:00Z'); // חצות מקומי בישראל (UTC+3)
    const end = Date.parse('2026-10-25T22:00:00Z'); // חצות מקומי למחרת (UTC+2)
    assert.equal((end - start) / 3600000, 25);
  });
});
