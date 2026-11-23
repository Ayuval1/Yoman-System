// בדיקות ל-lib/ops/gate-probe.js: בדיקת השער מול Gemini (fetch, מסד והשהיה מזויפים; אין רשת ואין המתנה אמיתית).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, scrub, config } from '../lib/ops/gate-probe.js';
import { parsePool } from '../lib/brain/models.js';
import { fakeSql, fakeFetch, captureConsole, req, jsonResponse, FAKE_CRON } from './helpers.js';

const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
const API_KEY = 'AIza-fake-gemini-key-DO-NOT-LEAK';
const mk = (n, extra = (i) => ({})) => Array.from({ length: n }, (_, i) => ({
  id: `s${String(i + 1).padStart(2, '0')}`,
  text: `משפט-פרטי-מספר-${i + 1}`,
  expected: { action: 'create_reminder', when: 'tomorrow' },
  ...extra(i),
}));
const answer = (action, when) => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action, when }) }] } }] });
const good = () => answer('create_reminder', 'tomorrow');

function setup({ sentences = mk(10), route = good } = {}) {
  const sleeps = [];
  const sql = fakeSql();
  const fetchFn = fakeFetch((url, options, i) => {
    const v = typeof route === 'function' ? route(url, options, i) : route;
    if (v instanceof Error) throw v;
    return v;
  });
  const deps = { sql, secret: FAKE_CRON, apiKey: API_KEY, fetchFn, sentences, sleep: async (ms) => { sleeps.push(ms); } };
  return { sql, fetchFn, sleeps, deps };
}
const get = (query = '', headers = AUTH) => req(`https://x.test/api/gate-probe${query}`, { headers });
const probeDetail = (sql) => sql.find('INSERT INTO probe_log')[0];

describe('gate-probe: scrub', () => {
  test('מספר טלפון ישראלי מוחלף', () => {
    assert.equal(scrub('תתקשר ל-052-1234567 מחר'), 'תתקשר ל-[טלפון] מחר');
    assert.equal(scrub('0521234567'), '[טלפון]');
    assert.equal(scrub('+972 52 123 4567'), '[טלפון]');
    assert.ok(!/\d/.test(scrub('(03) 123-4567')));
  });
  test('מספרים קצרים לא מוחלפים (שעה, כיתה, 5K)', () => {
    for (const s of ['ב-16:00', 'כיתה ח3', 'ריצה של 5K', '12345']) assert.equal(scrub(s), s);
  });
  test('טקסט בלי מספרים לא משתנה (עברית, אימוג׳י)', () => {
    assert.equal(scrub('להכין תיק 🎒'), 'להכין תיק 🎒');
  });
  test('כמה טלפונים באותה שורה', () => {
    assert.equal(scrub('050-1111111 ו-052-2222222'), '[טלפון] ו-[טלפון]');
  });
  test('מסמך: תאריך עם מקפים (10-10-2026) מזוהה בטעות כטלפון - התנהגות נוכחית', () => {
    assert.equal(scrub('מבחן ב-10-10-2026'), 'מבחן ב-[טלפון]');
  });
});

describe('gate-probe: שיטה, אימות ופרמטרים', () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    test(`${method} - 405`, async () => {
      const { deps } = setup();
      assert.equal((await handle(req('https://x.test/', { method, headers: AUTH }), deps)).status, 405);
    });
  }
  test('סוד חסר/שגוי/בלי Bearer/באורך שונה - 401 וללא קריאה ל-Gemini', async () => {
    const { deps, fetchFn, sql } = setup();
    for (const authorization of [undefined, 'Bearer no', FAKE_CRON, `Bearer ${FAKE_CRON}x`, `Bearer ${'z'.repeat(9999)}`]) {
      const headers = authorization === undefined ? {} : { authorization };
      assert.equal((await handle(get('', headers), deps)).status, 401);
    }
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(sql.calls.length, 0);
  });
  test('סוד לא מוגדר בשרת - 401', async (t) => {
    captureConsole(t);
    const { deps } = setup();
    for (const secret of [undefined, '', null]) assert.equal((await handle(get(), { ...deps, secret })).status, 401);
  });
  test('from/count לא תקינים - 400 בלי קריאה', async () => {
    for (const q of ['?from=abc', '?count=x', '?from=-1', '?count=-1', '?from=1.5', '?count=0', '?count=11', '?from=1234567', '?count=', '?from=%00']) {
      const { deps, fetchFn } = setup();
      assert.equal((await handle(get(q), deps)).status, 400, q);
      assert.equal(fetchFn.calls.length, 0);
    }
  });
  test('count=10 ו-count=1 מותרים', async () => {
    for (const q of ['?count=10', '?count=1']) {
      const { deps } = setup();
      assert.equal((await handle(get(q), deps)).status, 200, q);
    }
  });
  test('from חורג מכמות המשפטים - 400', async () => {
    const { deps, fetchFn } = setup({ sentences: mk(5) });
    const res = await handle(get('?from=5'), deps);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /יש 5 משפטים/);
    assert.equal(fetchFn.calls.length, 0);
  });
  test('בלי מפתח Gemini - 500 ובלי קריאה', async (t) => {
    captureConsole(t);
    for (const apiKey of [undefined, '', null]) {
      const { deps, fetchFn } = setup();
      const res = await handle(get(), { ...deps, apiKey });
      assert.equal(res.status, 500);
      assert.equal(fetchFn.calls.length, 0);
    }
  });
});

describe('gate-probe: בחירת דגם', () => {
  test('בלי model - ברירת המחדל gemini-3.8-flash', async () => {
    const { deps, fetchFn } = setup();
    const text = await (await handle(get('?count=1'), deps)).text();
    assert.match(fetchFn.calls[0].url, /models\/gemini-3\.8-flash:generateContent$/);
    assert.match(text, /model=gemini-3\.8-flash/);
  });
  test('model מהרשימה (gemini-3.5-flash-lite) נשלח ונרשם', async () => {
    const { deps, fetchFn } = setup();
    const text = await (await handle(get('?count=1&model=gemini-3.5-flash-lite'), deps)).text();
    assert.match(fetchFn.calls[0].url, /models\/gemini-3\.5-flash-lite:generateContent$/);
    assert.match(text, /model=gemini-3\.5-flash-lite/);
  });
  test('model מחוץ לרשימה (או ניסיון הזרקה לכתובת) - 400 וללא קריאה ל-Gemini', async () => {
    for (const bad of ['gpt-4', 'gemini-3.8-flash%2F..%2Fx', '', 'a:b']) {
      const { deps, fetchFn } = setup();
      const res = await handle(get(`?model=${bad}`), deps);
      assert.equal(res.status, 400, bad);
      assert.equal(fetchFn.calls.length, 0, bad);
    }
  });
});

describe('gate-probe: ריצה תקינה', () => {
  test('10 תשובות נכונות - "עבר", 9 השהיות של 13 שניות (לא לפני הראשונה)', async () => {
    const { deps, sleeps, fetchFn } = setup();
    const res = await handle(get(), deps);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^עבר: range=s01-s10; 10\/10 ran=10; failed: none; model=/);
    assert.equal(fetchFn.calls.length, 10);
    assert.deepEqual(sleeps, Array(9).fill(13000));
  });
  test('count=3 מריץ שלושה, עם שתי השהיות', async () => {
    const { deps, sleeps } = setup();
    const text = await (await handle(get('?count=3'), deps)).text();
    assert.match(text, /range=s01-s03; 3\/3 ran=3/);
    assert.equal(sleeps.length, 2);
  });
  test('from מזיז את החלון', async () => {
    const { deps, fetchFn } = setup({ sentences: mk(20) });
    const text = await (await handle(get('?from=10&count=10'), deps)).text();
    assert.match(text, /range=s11-s20/);
    assert.equal(fetchFn.calls.length, 10);
  });
  test('חלון שחורג מהסוף נחתך (from=18,count=10 מ-20)', async () => {
    const { deps, fetchFn } = setup({ sentences: mk(20) });
    const text = await (await handle(get('?from=18&count=10'), deps)).text();
    assert.match(text, /range=s19-s20; 2\/2 ran=2/);
    assert.equal(fetchFn.calls.length, 2);
  });
  test('הבקשה ל-Gemini: POST, כותרת מפתח, JSON mime, temperature 0', async () => {
    const { deps, fetchFn } = setup();
    await handle(get('?count=1'), deps);
    const c = fetchFn.calls[0];
    assert.match(c.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^:]+:generateContent$/);
    assert.equal(c.options.method, 'POST');
    assert.equal(c.options.headers['x-goog-api-key'], API_KEY);
    assert.ok(!c.url.includes(API_KEY));
    const body = JSON.parse(c.options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.equal(body.generationConfig.temperature, 0);
    assert.ok(body.contents[0].parts[0].text.includes('משפט-פרטי-מספר-1'));
  });
  test('טלפון במשפט מוסר לפני השליחה ל-Gemini', async () => {
    const { deps, fetchFn } = setup({ sentences: mk(1, () => ({ text: 'להתקשר ל-052-1234567 מחר' })) });
    await handle(get('?count=1'), deps);
    const sent = JSON.parse(fetchFn.calls[0].options.body).contents[0].parts[0].text;
    assert.ok(!sent.includes('1234567'));
    assert.ok(sent.includes('[טלפון]'));
  });
  test('call_log נרשם לכל קריאה, ושורת probe_log אחת בסוף', async () => {
    const { deps, sql } = setup({ sentences: mk(3) });
    await handle(get('?count=3'), deps);
    assert.equal(sql.find('INTO call_log').length, 3);
    assert.equal(sql.find('INSERT INTO probe_log').length, 1);
    assert.equal(probeDetail(sql).values[0], true);
    assert.match(probeDetail(sql).text, /'gate-gemini'/);
  });
});

describe('gate-probe: חישוב ציון וסף 90%', () => {
  const wrongOn = (n) => (url, o, i) => (i < n ? answer('create_event', 'today') : good());
  test('9 מתוך 10 (90%) - עובר', async () => {
    const { deps, sql } = setup({ route: wrongOn(1) });
    const text = await (await handle(get(), deps)).text();
    assert.match(text, /^עבר: .*9\/10/);
    assert.equal(probeDetail(sql).values[0], true);
  });
  test('8 מתוך 10 (80%) - לא עובר', async () => {
    const { deps, sql } = setup({ route: wrongOn(2) });
    const text = await (await handle(get(), deps)).text();
    assert.match(text, /^לא עבר: .*8\/10/);
    assert.equal(probeDetail(sql).values[0], false);
  });
  test('המשפטים שנכשלו מופיעים כרשימת id בלבד', async () => {
    const { deps } = setup({ route: wrongOn(2) });
    assert.match(await (await handle(get(), deps)).text(), /failed: s01,s02/);
  });
  test('when: ריק/undefined שווה ל-null; ערך שונה נכשל', async () => {
    const mkOne = (expectedWhen, modelWhen) => setup({
      sentences: mk(1, () => ({ expected: { action: 'ask_clarification', when: expectedWhen } })),
      route: () => (modelWhen === undefined ? jsonResponse({ candidates: [{ content: { parts: [{ text: '{"action":"ask_clarification"}' }] } }] }) : answer('ask_clarification', modelWhen)),
    });
    for (const [exp, got, ok] of [[null, '', true], [null, undefined, true], [null, null, true], ['today', null, false], [null, 'today', false], ['today', 'today', true]]) {
      const { deps } = mkOne(exp, got);
      const text = await (await handle(get('?count=1'), deps)).text();
      assert.equal(text.startsWith('עבר'), ok, `${exp}/${got}`);
    }
  });
  test('תשובת מודל שאינה אובייקט (מערך/מחרוזת/null) נספרת כשגויה בלי קריסה', async () => {
    for (const text of ['[]', '"x"', 'null', '5']) {
      const { deps } = setup({ sentences: mk(1), route: () => jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] }) });
      const res = await handle(get('?count=1'), deps);
      assert.equal(res.status, 200, text);
      assert.match(await res.text(), /^לא עבר/);
    }
  });
});

describe('gate-probe: כשלי Gemini', () => {
  test('429 - עוצרים מיד, שאר המשפטים not-run ולא נספרים ככישלון איכות', async (t) => {
    const { deps, fetchFn } = setup({ route: (u, o, i) => (i === 2 ? new Response('{}', { status: 429 }) : good()) });
    const text = await (await handle(get(), deps)).text();
    assert.equal(fetchFn.calls.length, 3);
    assert.match(text, /^לא עבר: /);
    assert.match(text, /failed: s03/);
    assert.match(text, /not-run: s04,s05,s06,s07,s08,s09,s10/);
    assert.match(text, /aborted_at=s03/);
  });
  test('כל 5xx (500, 502, 503, 504) - שלושה ניסיונות (ראשון ועוד שניים) ואז עוצר', async () => {
    for (const status of [500, 502, 503, 504]) {
      const { deps, fetchFn, sleeps } = setup({ route: () => new Response('{}', { status }) });
      const text = await (await handle(get(), deps)).text();
      assert.equal(fetchFn.calls.length, 3, String(status));
      assert.deepEqual(sleeps, [20000, 40000], String(status));
      assert.match(text, /aborted_at=s01/);
      assert.match(text, /retries=2/);
    }
  });
  test('503 ואז הצלחה: ממשיך למשפט הבא, retries נרשם, וכל ניסיון ב-call_log', async () => {
    const { deps, fetchFn, sleeps, sql } = setup({ sentences: mk(2), route: (u, o, i) => (i === 0 ? new Response('{}', { status: 503 }) : good()) });
    const text = await (await handle(get('?count=2'), deps)).text();
    assert.match(text, /^עבר: range=s01-s02; 2\/2 ran=2; failed: none; retries=1; model=/);
    assert.equal(fetchFn.calls.length, 3);
    assert.deepEqual(sleeps, [20000, 13000]);
    const rows = sql.find('INTO call_log');
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.values[0]), [503, 200, 200]);
  });
  test('503 פעמיים ואז הצלחה: הניסיון השני אחרי 40 שניות', async () => {
    const { deps, sleeps } = setup({ sentences: mk(1), route: (u, o, i) => (i < 2 ? new Response('{}', { status: 503 }) : good()) });
    const text = await (await handle(get('?count=1'), deps)).text();
    assert.match(text, /^עבר: .*1\/1 ran=1; failed: none; retries=2/);
    assert.deepEqual(sleeps, [20000, 40000]);
  });
  test('תקציב הזמן הכולל: עוצר לפני משפט שההשהיה והקריאה שלו יחרגו, וכותב שורת probe_log עם time_budget', async () => {
    const { deps, fetchFn, sql } = setup();
    let t = 0;
    deps.now = () => { const v = t; t += 100000; return v; };
    const text = await (await handle(get(), deps)).text();
    assert.match(text, /^לא עבר: /);
    assert.match(text, /time_budget/);
    assert.match(text, /aborted_at=s0[1-4]/);
    assert.match(text, /not-run: s0\d/);
    assert.ok(fetchFn.calls.length < 10);
    assert.equal(sql.find('INSERT INTO probe_log').length, 1);
  });
  test('כל קריאה ל-Gemini נושאת signal עם תקרת זמן (אין קריאה תלויה לנצח)', async () => {
    const { deps, fetchFn } = setup();
    await handle(get('?count=1'), deps);
    assert.ok(fetchFn.calls[0].options.signal instanceof AbortSignal);
  });
  test('שורת הסיכום כוללת elapsed', async () => {
    const { deps } = setup();
    const text = await (await handle(get('?count=1'), deps)).text();
    assert.match(text, /; elapsed=\d+s$/);
  });
  test('429 לא מנוסה שוב (אין ניסיון חוזר, אין השהיה)', async () => {
    const { deps, fetchFn, sleeps } = setup({ route: () => new Response('{}', { status: 429 }) });
    await handle(get(), deps);
    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(sleeps, []);
  });
  test('תקציב הזמן נגמר: אין ניסיון חוזר שיחרוג מ-270 שניות', async () => {
    const { deps, fetchFn, sleeps } = setup({ route: () => new Response('{}', { status: 503 }) });
    let t = 0;
    deps.now = () => { const v = t; t += 260000; return v; };
    await handle(get(), deps);
    assert.equal(fetchFn.calls.length, 1);
    assert.deepEqual(sleeps, []);
  });
  test('401/403/400 - לא עוצר (ממשיך למשפט הבא)', async () => {
    for (const status of [400, 401, 403]) {
      const { deps, fetchFn } = setup({ sentences: mk(3), route: () => new Response('{}', { status }) });
      await handle(get('?count=3'), deps);
      assert.equal(fetchFn.calls.length, 3, String(status));
    }
  });
  test('שגיאת רשת / timeout (fetch זורק) - עוצר, status null', async () => {
    const { deps, fetchFn, sql } = setup({ route: () => new TypeError('fetch failed') });
    const text = await (await handle(get(), deps)).text();
    assert.equal(fetchFn.calls.length, 1);
    assert.match(text, /aborted_at=s01/);
    assert.equal(sql.find('INTO call_log')[0].values[0], null);
    assert.equal(sql.find('INTO call_log')[0].values[1], false);
  });
  test('גוף שגיאה מ-Google: status+message נרשמים חתוכים ל-200', async () => {
    const body = JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'm'.repeat(500) } });
    const { deps } = setup({ route: () => new Response(body, { status: 429 }) });
    const text = await (await handle(get(), deps)).text();
    assert.match(text, /s01 \[429\] HTTP 429 RESOURCE_EXHAUSTED: m+/);
    assert.ok(text.length < 1600);
  });
  test('גוף שגיאה שאינו JSON - רק הסטטוס', async () => {
    const { deps } = setup({ route: () => new Response('<html>nope</html>', { status: 503 }) });
    const text = await (await handle(get(), deps)).text();
    assert.match(text, /\[503\] HTTP 503(?! \S)/);
    assert.ok(!text.includes('nope'));
  });
  test('תשובה מ-Gemini שאינה JSON תקין - נרשמת כשגיאה בלי עצירה', async () => {
    const { deps, fetchFn } = setup({ sentences: mk(2), route: () => jsonResponse({ candidates: [{ content: { parts: [{ text: 'not json {' }] } }] }) });
    const text = await (await handle(get('?count=2'), deps)).text();
    assert.equal(fetchFn.calls.length, 2);
    assert.match(text, /תשובה שאינה JSON תקין/);
  });
  test('תשובה בלי candidates - נכשל בלי קריסה', async () => {
    const { deps } = setup({ sentences: mk(1), route: () => jsonResponse({}) });
    assert.equal((await handle(get('?count=1'), deps)).status, 200);
  });
});

describe('gate-probe: כשלי מסד', () => {
  test('כשל ב-call_log לא עוצר את הריצה', async (t) => {
    captureConsole(t);
    const { deps } = setup({ sentences: mk(2) });
    deps.sql = fakeSql((text) => { if (text.includes('call_log')) throw new Error('x'); return []; });
    assert.equal((await handle(get('?count=2'), deps)).status, 200);
  });
  test('כשל ב-probe_log - 500', async (t) => {
    captureConsole(t);
    const { deps } = setup({ sentences: mk(1) });
    deps.sql = fakeSql((text) => { if (text.includes('probe_log')) throw new Error('x'); return []; });
    assert.equal((await handle(get('?count=1'), deps)).status, 500);
  });
});

describe('gate-probe: פרטיות', () => {
  test('מפתח ה-API ותוכן המשפטים לא בתשובה, בלוג, ב-call_log או ב-probe_log - גם כשהשגיאה מכילה אותם', async (t) => {
    const cap = captureConsole(t);
    const dirty = (u, o, i) => {
      if (i === 0) return new TypeError(`fetch failed key=${API_KEY} text=משפט-פרטי-מספר-1`);
      return good();
    };
    const { deps, sql } = setup({ route: dirty });
    const text = await (await handle(get(), deps)).text();
    const logged = sql.calls.flatMap((c) => c.values.map(String)).join('\n');
    const everything = `${text}\n${logged}\n${cap.text()}`;
    for (const secret of [API_KEY, FAKE_CRON, 'משפט-פרטי-מספר-1']) assert.ok(!everything.includes(secret), `דלף: ${secret}`);
  });
  test('גוף שגיאה של Google שמכיל מפתח או משפט - מנוקה', async () => {
    const body = JSON.stringify({ error: { status: 'INVALID', message: `bad key ${API_KEY} for משפט-פרטי-מספר-1` } });
    const { deps, sql } = setup({ route: () => new Response(body, { status: 400 }) });
    const text = await (await handle(get('?count=1'), deps)).text();
    const logged = sql.calls.flatMap((c) => c.values.map(String)).join('\n');
    assert.ok(!(text + logged).includes(API_KEY));
    assert.ok(!(text + logged).includes('משפט-פרטי-מספר-1'));
  });
  test('תשובה שגויה של המודל: נרשמים רק action/when חתוכים ל-30 תווים', async () => {
    const { deps } = setup({ sentences: mk(1), route: () => answer('x'.repeat(100), 'y'.repeat(100)) });
    const text = await (await handle(get('?count=1'), deps)).text();
    assert.ok(text.includes(`action=${'x'.repeat(30)} `));
    assert.ok(!text.includes('x'.repeat(31)));
  });
});

describe('gate-probe: קובץ המשפטים האמיתי (data/gate-test-sentences.json)', () => {
  const file = JSON.parse(readFileSync(new URL('../data/gate-test-sentences.json', import.meta.url), 'utf8'));
  const ACTIONS = ['create_reminder', 'create_event', 'query_schedule', 'ask_clarification'];
  const WHEN = ['today', 'today_afternoon', 'today_evening', 'tomorrow', 'tomorrow_morning', 'in_2_hours', 'this_week', 'next_week', null];
  test('יש 20 משפטים עם id ייחודי וטקסט לא ריק', () => {
    assert.equal(file.sentences.length, 20);
    assert.equal(new Set(file.sentences.map((s) => s.id)).size, 20);
    for (const s of file.sentences) assert.ok(typeof s.text === 'string' && s.text.length > 0);
  });
  test('כל expected.action ו-expected.when הם מהרשימה המותרת', () => {
    for (const s of file.sentences) {
      assert.ok(ACTIONS.includes(s.expected.action), s.id);
      assert.ok(WHEN.includes(s.expected.when ?? null), s.id);
    }
  });
  test('אין טלפונים או כתובות במשפטי הבדיקה (scrub לא משנה אותם)', () => {
    for (const s of file.sentences) assert.equal(scrub(s.text), s.text, s.id);
  });
  test('הנקודה קוראת את הקובץ כשלא מוזרקים משפטים', async () => {
    const { deps, fetchFn } = setup();
    delete deps.sentences;
    const res = await handle(get('?count=2'), deps);
    assert.equal(res.status, 200);
    assert.equal(fetchFn.calls.length, 2);
  });
  test('maxDuration מוגדר ל-300 שניות', () => assert.equal(config.maxDuration, 300));
});

describe('gate-probe: model=rotate (רוטציה יומית לפי ListModels)', () => {
  const DAY = 20413; // יום כלשהו מאז 1.1.1970 (UTC)
  const atDay = (d, extraMs = 0) => () => d * 86400000 + extraMs;
  const entry = (name, methods = ['generateContent']) => ({ name, supportedGenerationMethods: methods });
  const LIST = [
    entry('models/gemini-b-flash'),
    entry('models/gemini-a-flash'),
    entry('models/gemini-c-flash'),
    entry('models/gemini-x-embedding-001', ['embedContent']),
    entry('models/gemini-a-tts'),
    entry('models/gemini-a-image'),
    entry('models/gemini-a-live'),
    entry('models/gemini-a-audio'),
    entry('models/gemini-a-preview'),
    entry('models/gemini-a-exp'),
    entry('models/gemini-no-generate', ['countTokens']),
    entry('models/gemma-3-27b'),
  ];
  const isList = (url) => url.includes('/v1beta/models') && !url.includes(':generateContent');
  const routeWith = (list, answerFn = good) => (url) => (isList(url) ? jsonResponse({ models: list }) : answerFn());
  const run = (deps, now) => handle(get('?model=rotate&from=0'), { ...deps, sentences: mk(20), now });
  const gens = (fetchFn) => fetchFn.calls.filter((c) => !isList(c.url));

  test('מסנן, ממיין, בוחר לפי היום, ורץ על כל 20 המשפטים', async () => {
    const { deps, fetchFn, sql } = setup({ route: routeWith(LIST) });
    const text = await (await run(deps, atDay(DAY))).text();
    // אחרי סינון ומיון: a-flash, b-flash, c-flash. 20413 % 3 = 1 -> b-flash
    assert.equal(DAY % 3, 1);
    assert.equal(gens(fetchFn).length, 20);
    assert.ok(gens(fetchFn).every((c) => c.url.endsWith('models/gemini-b-flash:generateContent')));
    assert.equal(fetchFn.calls.filter((c) => isList(c.url)).length, 1);
    assert.match(text, /20\/20/);
    assert.match(text, /model=gemini-b-flash/);
    assert.match(text, /pool=3/);
    assert.match(probeDetail(sql).values[1], /model=gemini-b-flash/);
  });
  test('ListModels נשלח עם כותרת המפתח', async () => {
    const { deps, fetchFn } = setup({ route: routeWith(LIST) });
    await run(deps, atDay(DAY));
    assert.equal(fetchFn.calls[0].options.headers['x-goog-api-key'], API_KEY);
  });
  test('יום אחר - מודל אחר; אותו יום (גם בשעה אחרת) - אותו מודל', async () => {
    const seen = [];
    for (const [d, extra] of [[DAY, 0], [DAY + 1, 0], [DAY + 2, 0], [DAY + 3, 0], [DAY + 1, 5 * 3600000], [DAY + 1, 86399000]]) {
      const { deps, fetchFn } = setup({ route: routeWith(LIST) });
      await run(deps, atDay(d, extra));
      seen.push(gens(fetchFn)[0].url.match(/models\/(.+):/)[1]);
    }
    assert.deepEqual(seen, ['gemini-b-flash', 'gemini-c-flash', 'gemini-a-flash', 'gemini-b-flash', 'gemini-c-flash', 'gemini-c-flash']);
  });
  test('pageToken: עוברים על כל העמודים', async () => {
    const { deps, fetchFn } = setup({
      route: (url) => {
        if (!isList(url)) return good();
        return url.includes('pageToken=P2')
          ? jsonResponse({ models: [entry('models/gemini-a-flash')] })
          : jsonResponse({ models: [entry('models/gemini-z-flash')], nextPageToken: 'P2' });
      },
    });
    const text = await (await run(deps, atDay(2))).text(); // 2 % 2 = 0 -> a-flash
    assert.equal(fetchFn.calls.filter((c) => isList(c.url)).length, 2);
    assert.match(text, /pool=2/);
    assert.match(text, /model=gemini-a-flash/);
  });
  test('ListModels נכשל (HTTP 500) - probe_log ok=false, בלי קריאת generateContent', async () => {
    const { deps, fetchFn, sql } = setup({ route: () => jsonResponse({ error: { status: 'INTERNAL', message: 'boom' } }, 500) });
    const res = await run(deps, atDay(DAY));
    assert.equal(res.status, 200);
    assert.equal(fetchFn.calls.length, 1);
    const row = probeDetail(sql);
    assert.equal(row.values[0], false);
    assert.match(row.values[1], /ListModels/);
    assert.match(row.values[1], /HTTP 500/);
  });
  test('ListModels זורק שגיאת רשת - ok=false', async () => {
    const { deps, sql } = setup({ route: () => new Error('net down') });
    await run(deps, atDay(DAY));
    assert.equal(probeDetail(sql).values[0], false);
    assert.match(probeDetail(sql).values[1], /ListModels/);
  });
  test('רשימה ריקה אחרי סינון - ok=false, לא ממציאים מודל', async () => {
    const { deps, fetchFn, sql } = setup({ route: routeWith([entry('models/gemini-a-tts'), entry('models/other')]) });
    await run(deps, atDay(DAY));
    assert.equal(fetchFn.calls.length, 1);
    assert.equal(probeDetail(sql).values[0], false);
    assert.match(probeDetail(sql).values[1], /pool=0/);
  });
  test('שם מודל מ-ListModels שלא עובר תבנית (ניסיון הזרקה) נזרק', async () => {
    const evil = [entry('models/gemini-a/../../x'), entry('models/gemini-a?key=1'), entry('models/gemini-a:b'), entry('models/gemini-ok-flash')];
    const { deps, fetchFn } = setup({ route: routeWith(evil) });
    const text = await (await run(deps, atDay(DAY))).text();
    assert.match(text, /pool=1/);
    assert.ok(gens(fetchFn).every((c) => c.url.endsWith('models/gemini-ok-flash:generateContent')));
  });
  test('429 בזמן הריצה - עוצר, not-run, ok=false', async () => {
    const { deps, fetchFn, sql } = setup({ route: routeWith(LIST, () => jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429)) });
    await run(deps, atDay(DAY));
    assert.equal(gens(fetchFn).length, 1);
    assert.equal(probeDetail(sql).values[0], false);
    assert.match(probeDetail(sql).values[1], /not-run: s02/);
  });
  test('כמה משבצות ביום: slots=3 בודקות שלושה מודלים שונים באותו יום, וביום הבא ממשיכות מהבאים', async () => {
    const LIST5 = ['a', 'b', 'c', 'd', 'e'].map((x) => entry(`models/gemini-${x}-flash`));
    const pick = async (d, slot) => {
      const { deps, fetchFn } = setup({ route: routeWith(LIST5) });
      await handle(get(`?model=rotate&slot=${slot}&slots=3`), { ...deps, sentences: mk(20), now: atDay(d) });
      return gens(fetchFn)[0].url.match(/models\/gemini-(.)-flash:/)[1];
    };
    // יום 0: אינדקסים 0,1,2; יום 1: 3,4,0 (מודולו 5)
    assert.deepEqual([await pick(0, 0), await pick(0, 1), await pick(0, 2)], ['a', 'b', 'c']);
    assert.deepEqual([await pick(1, 0), await pick(1, 1), await pick(1, 2)], ['d', 'e', 'a']);
  });
  test('slot ו-slots לא תקינים - 400 בלי קריאה לרשת', async () => {
    for (const q of ['?model=rotate&slot=3&slots=3', '?model=rotate&slots=0', '?model=rotate&slot=x', '?model=rotate&slots=100']) {
      const { deps, fetchFn } = setup();
      assert.equal((await handle(get(q), deps)).status, 400, q);
      assert.equal(fetchFn.calls.length, 0, q);
    }
  });
  test('ברירת מחדל slot=0 slots=1: אותה בחירה כמו לפני ההרחבה, וה-detail מציין slot', async () => {
    const { deps, sql } = setup({ route: routeWith(LIST) });
    await run(deps, atDay(DAY));
    assert.match(probeDetail(sql).values[1], /model=gemini-b-flash; pool=3; slot=0\/1/);
  });
  test('הרשימה הסגורה נשארת לערכים אחרים: ערך לא מוכר עדיין 400', async () => {
    const { deps, fetchFn } = setup();
    assert.equal((await handle(get('?model=rotat'), deps)).status, 400);
    assert.equal(fetchFn.calls.length, 0);
  });
});

describe('gate-probe: תיקוני שער Gemini (404, סינון מודלים, no_free_quota, המשך ריצה, סדר)', () => {
  const NOW = 20413 * 86400000 + 5 * 3600000;
  const at = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();
  const entry = (name) => ({ name, supportedGenerationMethods: ['generateContent'] });
  const isList = (url) => url.includes('/v1beta/models') && !url.includes(':generateContent');
  const gens = (fetchFn) => fetchFn.calls.filter((c) => !isList(c.url));
  const modelOf = (call) => call.url.match(/models\/(.+):generateContent/)[1];
  const notFound = (m) => jsonResponse({ error: { status: 'NOT_FOUND', message: `This model models/${m} is no longer available to new users.` } }, 404);
  const quota429 = () => jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota' } }, 429);
  // sql שמחזיר היסטוריה רק לשאילתת הבחירה (SELECT ... probe_log), ומתעד את שאר השאילתות
  const withHistory = (rows) => fakeSql((text) => (text.startsWith('SELECT') && text.includes('probe_log') ? rows : []));
  const setupH = (names, rows, route) => {
    const sql = withHistory(rows);
    const fetchFn = fakeFetch((url, options, i) => {
      if (isList(url)) return jsonResponse({ models: names.map((n) => entry(`models/${n}`)) });
      return route(url, options, i);
    });
    const deps = { sql, secret: FAKE_CRON, apiKey: API_KEY, fetchFn, sleep: async () => {}, now: () => NOW };
    return { sql, fetchFn, deps };
  };
  const rot = (deps, sentences = mk(20), q = '?model=rotate&from=0') => handle(get(q), { ...deps, sentences });
  const detailOf = (sql) => sql.find('INSERT INTO probe_log')[0].values[1];

  test('404: עוצר אחרי התשובה הראשונה, רושם model_unavailable ושאר המשפטים not-run', async () => {
    const { deps, fetchFn, sql } = setupH(['gemini-a-flash'], [], () => notFound('gemini-a-flash'));
    await rot(deps);
    assert.equal(gens(fetchFn).length, 1);
    const d = detailOf(sql);
    assert.match(d, /; model_unavailable/);
    assert.match(d, /not-run: s02,s03/);
    assert.match(d, /aborted_at=s01/);
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[0], false);
  });
  test('מודל עם model_unavailable בהיסטוריה (גם ישן מ-30 יום) לא נבחר שוב', async () => {
    const rows = [{ ok: false, at: at(24 * 90), detail: 'range=s01-s20; 0/20 ran=1; failed: s01; not-run: s02; aborted_at=s01; model=gemini-b-flash; pool=3; slot=0/1; model_unavailable; elapsed=1s' }];
    // 20413 % 3 = 1 -> b היה נבחר. אחרי סינון: a,c
    const { deps, fetchFn } = setupH(['gemini-a-flash', 'gemini-b-flash', 'gemini-c-flash'], rows, () => good());
    await rot(deps);
    assert.ok(gens(fetchFn).every((c) => modelOf(c) !== 'gemini-b-flash'));
    assert.ok(gens(fetchFn).length > 0);
  });
  test('כל המודלים חסומים: ok=false, בלי קריאת generateContent', async () => {
    const rows = [{ ok: false, at: at(1), detail: 'range=s01-s20; 0/20 ran=1; failed: s01; model=gemini-a-flash; pool=1; slot=0/1; model_unavailable; elapsed=1s' }];
    const { deps, fetchFn, sql } = setupH(['gemini-a-flash'], rows, () => good());
    await rot(deps);
    assert.equal(gens(fetchFn).length, 0);
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[0], false);
  });
  test('סינון שמות: omni, nano-banana, imagen, veo, aqa ועוד לא נכנסים לרשימה', async () => {
    const names = ['gemini-nano-banana-2.1', 'gemini-omni-1.1-flash', 'gemini-2.0-imagen', 'gemini-veo-3', 'gemini-aqa-x', 'gemini-ok-flash'];
    const { deps, fetchFn } = setupH(names, [], () => good());
    const text = await (await rot(deps)).text();
    assert.match(text, /pool=1/);
    assert.ok(gens(fetchFn).every((c) => modelOf(c) === 'gemini-ok-flash'));
  });
  test('429 במשפט הראשון בהודעת מכסה: no_free_quota נרשם', async () => {
    const { deps, sql } = setupH(['gemini-a-flash'], [], quota429);
    await rot(deps);
    assert.match(detailOf(sql), /; no_free_quota/);
  });
  test('429 במשפט הראשון עם PerDay בגוף (מכסה יומית שנוצלה): לא no_free_quota', async () => {
    const perDay = () => jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }, 429);
    const { deps, sql } = setupH(['gemini-a-flash'], [], perDay);
    await rot(deps);
    assert.doesNotMatch(detailOf(sql), /no_free_quota/);
  });
  test('המשך שבו ran המאוחד שונה ממספר המשפטים (שורה קודמת חסרה): ok=false גם אם כולם נכונים', async () => {
    const odd = 'range=s01-s20; 15/20 ran=15; failed: none; not-run: s18,s19,s20; model=gemini-b-flash; pool=1; slot=0/1; time_budget; elapsed=244s';
    const { deps, sql } = setupH(['gemini-b-flash'], [{ ok: false, at: at(5), detail: odd }], () => good());
    await rot(deps);
    assert.match(detailOf(sql), /; 18\/20 ran=18;/);
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[0], false);
  });
  test('אינטגרציה: שורת המשך שעברה 18/20 נקראת על ידי parsePool כמודל שעבר', async () => {
    const prior = 'range=s01-s20; 16/20 ran=17; failed: s15; not-run: s18,s19,s20; aborted_at=s18; model=gemini-b-flash; pool=1; slot=0/1; time_budget; elapsed=244s';
    // 2 מתוך 3 נכונים: 18/20
    const { deps, sql } = setupH(['gemini-b-flash'], [{ ok: false, at: at(5), detail: prior }], (u, o, i) => (i <= 2 ? good() : answer('query_schedule', null)));
    await rot(deps);
    const [ok, detail] = sql.find('INSERT INTO probe_log')[0].values;
    assert.equal(ok, true);
    assert.match(detail, /; 18\/20 ran=20;/);
    const pool = parsePool([{ ok, detail, at: new Date(NOW) }], new Date(NOW));
    assert.deepEqual(pool, [{ model: 'gemini-b-flash', passed: 18, total: 20 }]);
  });
  test('429 באמצע ריצה (מכסה יומית): לא no_free_quota', async () => {
    const { deps, sql } = setupH(['gemini-a-flash'], [], (u, o, i) => (i >= 3 ? quota429() : good()));
    await rot(deps);
    assert.doesNotMatch(detailOf(sql), /no_free_quota/);
  });
  test('מודל עם no_free_quota מדולג יומיים, ואחרי זה חוזר', async () => {
    const row = (hoursAgo) => [{ ok: false, at: at(hoursAgo), detail: 'range=s01-s20; 0/20 ran=1; failed: s01; not-run: s02; aborted_at=s01; model=gemini-b-flash; pool=3; slot=0/1; no_free_quota; elapsed=1s' }];
    const calls = async (rows) => { const { deps, fetchFn } = setupH(['gemini-b-flash'], rows, () => good()); await rot(deps); return gens(fetchFn).length; };
    assert.equal(await calls(row(24 * 1)), 0); // עדיין מדולג (המודל היחיד)
    assert.equal(await calls(row(24 * 3)), 20); // חזר
  });
  test('מודל שלא נבדק מועדף על מודל שנבדק (גם אם הרוטציה מצביעה על הנבדק)', async () => {
    const rows = [{ ok: false, at: at(30), detail: 'range=s01-s20; 10/20 ran=20; failed: s01; model=gemini-b-flash; pool=3; slot=0/1; elapsed=200s' }];
    const { deps, fetchFn } = setupH(['gemini-a-flash', 'gemini-b-flash', 'gemini-c-flash'], rows, () => good());
    await rot(deps);
    assert.equal(modelOf(gens(fetchFn)[0]), 'gemini-c-flash'); // הרוטציה על b; הפנוי הראשון אחריו שלא נבדק הוא c
  });

  const PARTIAL = 'range=s01-s20; 16/20 ran=17; failed: s15; not-run: s18,s19,s20; aborted_at=s18; model=gemini-b-flash; pool=3; slot=3/4; time_budget; elapsed=244s';
  test('המשך: ריצה שנחתכה בתקציב זמן ממשיכה מהמשפט הראשון שלא רץ, ומאחדת לתוצאה אחת', async () => {
    const rows = [{ ok: false, at: at(18), detail: PARTIAL }];
    const { deps, fetchFn, sql } = setupH(['gemini-a-flash', 'gemini-b-flash', 'gemini-c-flash'], rows, () => good());
    const res = await rot(deps);
    const calls = gens(fetchFn);
    assert.equal(calls.length, 3);
    assert.ok(calls.every((c) => modelOf(c) === 'gemini-b-flash'));
    assert.ok(calls[0].options.body.includes('משפט-פרטי-מספר-18'));
    const d = detailOf(sql);
    assert.match(d, /range=s01-s20; 19\/20 ran=20; failed: s15;/);
    assert.match(d, /resumed_from=s18; prior=16\/17/);
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[0], true);
    assert.match(await res.text(), /^עבר/);
  });
  test('המשך: האיחוד גם יכול להיכשל (16/17 ועוד 1 מתוך 3 = 17/20 < 90%)', async () => {
    const rows = [{ ok: false, at: at(18), detail: PARTIAL }];
    const { deps, sql } = setupH(['gemini-b-flash'], rows, (u, o, i) => (i === 1 ? good() : answer('query_schedule', null)));
    await rot(deps);
    assert.match(detailOf(sql), /; 17\/20 ran=20; failed: s15,s19,s20;/);
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[0], false);
  });
  test('המשך: שורה שהאיחוד שלה כבר לא יכול לעבור את הסף - לא ממשיכים', async () => {
    const dead = 'range=s01-s20; 10/20 ran=15; failed: s01,s02,s03,s04,s05; not-run: s16,s17,s18,s19,s20; model=gemini-b-flash; pool=1; slot=0/1; time_budget; elapsed=244s';
    const { deps, fetchFn } = setupH(['gemini-b-flash'], [{ ok: false, at: at(2), detail: dead }], () => good());
    await rot(deps);
    assert.equal(gens(fetchFn).length, 20); // התחלה מחדש מאפס, לא המשך
  });
  test('המשך: ריצה ישנה מ-36 שעות - מתחילים מחדש', async () => {
    const { deps, fetchFn } = setupH(['gemini-b-flash'], [{ ok: false, at: at(40), detail: PARTIAL }], () => good());
    await rot(deps);
    assert.equal(gens(fetchFn).length, 20);
  });
  test('המשך שנחתך שוב בתקציב: נרשם not-run חדש, וניתן להמשיך שוב', async () => {
    const rows = [{ ok: false, at: at(18), detail: PARTIAL }];
    let t = NOW;
    const { deps, sql } = setupH(['gemini-b-flash'], rows, () => good());
    await rot({ ...deps, now: () => (t += 150000) }); // כל קריאת now מקדמת 150 שניות: נחתך אחרי המשפט הראשון
    const d = detailOf(sql);
    assert.match(d, /resumed_from=s18/);
    assert.match(d, /time_budget/);
    assert.match(d, /not-run: s19,s20/);
    assert.match(d, /; 17\/20 ran=18;/);
  });
  test('סדר: מודל להמשך (ציון חלקי) קודם למודל שלא נבדק, והטוב מבין כמה חלקיים ראשון', async () => {
    const mkRow = (model, passed, ran) => ({ ok: false, at: at(5), detail: `range=s01-s20; ${passed}/20 ran=${ran}; failed: ${Array.from({ length: ran - passed }, (_, i) => `s${i + 1}`).join(',') || 'none'}; not-run: s${ran + 1}; model=${model}; pool=4; slot=0/4; time_budget; elapsed=250s` });
    const rows = [mkRow('gemini-a-flash', 17, 19), mkRow('gemini-c-flash', 19, 19)];
    const { deps, fetchFn } = setupH(['gemini-a-flash', 'gemini-b-flash', 'gemini-c-flash', 'gemini-d-flash'], rows, () => good());
    await rot(deps);
    assert.equal(modelOf(gens(fetchFn)[0]), 'gemini-c-flash');
  });
  test('כשל בקריאת ההיסטוריה לא עוצר: רוטציה רגילה', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => { if (text.startsWith('SELECT')) throw new Error('db down'); return []; });
    const fetchFn = fakeFetch((url) => (isList(url) ? jsonResponse({ models: [entry('models/gemini-a-flash')] }) : good()));
    await rot({ sql, secret: FAKE_CRON, apiKey: API_KEY, fetchFn, sleep: async () => {}, now: () => NOW });
    assert.equal(gens(fetchFn).length, 20);
  });
});
