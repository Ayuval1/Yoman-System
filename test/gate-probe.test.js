// בדיקות ל-api/gate-probe.js: בדיקת השער מול Gemini (fetch, מסד והשהיה מזויפים; אין רשת ואין המתנה אמיתית).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle, scrub, config } from '../api/gate-probe.js';
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
  test('כל 5xx (500, 502, 503) - עוצר', async () => {
    for (const status of [500, 502, 503, 504]) {
      const { deps, fetchFn } = setup({ route: () => new Response('{}', { status }) });
      await handle(get(), deps);
      assert.equal(fetchFn.calls.length, 1, String(status));
    }
  });
  test('401/403/404/400 - לא עוצר (ממשיך למשפט הבא)', async () => {
    for (const status of [400, 401, 403, 404]) {
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
