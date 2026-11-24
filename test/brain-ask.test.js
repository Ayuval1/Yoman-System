// בדיקות ל-lib/brain/ask.js (בלוק 3א): קריאה למוח עם מעבר אוטומטי בין מודלים. fetch ומסד מזויפים; אין רשת אמיתית.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { askBrain, PILOT_POOL, PILOT_PROBE, PILOT_ENABLED, pilotOn, pilotOutcome } from '../lib/brain/ask.js';
import { fakeSql, fakeFetch, captureConsole, jsonResponse } from './helpers.js';

const NOW = new Date('2026-11-21T12:00:00.000Z');
const API_KEY = 'AIza-fake-brain-key-DO-NOT-LEAK';
const PROMPT = 'הודעה-פרטית-לבדיקה מחר בבוקר';
const passRow = (model, passed = 19) => ({ ok: true, at: new Date('2026-11-20T10:00:00.000Z'), detail: `range=s01-s20; ${passed}/20 ran=20; failed: none; model=${model}; elapsed=1s` });
const POOL_ROWS = [passRow('gemini-a', 20), passRow('gemini-b', 19), passRow('gemini-c', 18)];
const answer = (obj) => jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const rawAnswer = (text) => jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
const quota429 = (quotaId) => jsonResponse({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: `Quota exceeded key=${API_KEY}`, details: [{ violations: [{ quotaId }] }] } }, 429);

function db({ pool = POOL_ROWS, quota = [], failQuotaInsert = false } = {}) {
  return fakeSql((text) => {
    if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return pool;
    if (text.includes('FROM probe_log')) return quota;
    if (failQuotaInsert && text.startsWith('INSERT INTO probe_log')) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
    return [];
  });
}
const modelOf = (url) => /models\/([^:]+):generateContent$/.exec(url)?.[1];
function run(options = {}) {
  const { sql = db(), route, notify, schema, env = {} } = options;
  const apiKey = 'apiKey' in options ? options.apiKey : API_KEY;
  const notified = [];
  const fetchFn = fakeFetch((url, options, i) => {
    const v = route(url, options, i);
    if (v instanceof Error) throw v;
    return v;
  });
  const promise = askBrain({ sql, fetchFn, apiKey, now: NOW, prompt: PROMPT, schema, env, notify: notify ?? (async (x) => { notified.push(x); }) });
  return { sql, fetchFn, notified, promise };
}
const quotaInserts = (sql) => sql.find('INSERT INTO probe_log');
const callLogs = (sql) => sql.find('INSERT INTO call_log');

describe('brain/ask: Gemma (בלי מצב JSON)', () => {
  test('מודל gemma-: הבקשה בלי responseMimeType, ותשובה עטופה ב-```json נקראת', async () => {
    const sql = db({ pool: [passRow('gemma-4-31b-it', 19)] });
    const { promise, fetchFn } = run({ sql, route: () => rawAnswer('```json\n{"action":"create_reminder"}\n```') });
    assert.deepEqual(await promise, { ok: true, model: 'gemma-4-31b-it', data: { action: 'create_reminder' } });
    const body = JSON.parse(fetchFn.calls[0].options.body);
    assert.equal(body.generationConfig.responseMimeType, undefined);
    assert.equal(body.generationConfig.temperature, 0);
  });
  test('מודל gemma-: טקסט בלי אובייקט JSON הוא כשל פורמט', async (t) => {
    captureConsole(t);
    const sql = db({ pool: [passRow('gemma-4-31b-it', 19)] });
    const { promise } = run({ sql, env: { BRAIN_PILOT: 'off' }, route: () => rawAnswer('אין לי מושג') });
    const out = await promise;
    assert.equal(out.ok, false);
  });
});

describe('brain/ask: מסלול תקין', () => {
  test('המודל הראשון עונה JSON: ok, מודל ונתונים; בקשה אחת, עם כותרת מפתח ו-JSON', async () => {
    const { promise, fetchFn, sql } = run({ route: () => answer({ action: 'create_reminder' }) });
    assert.deepEqual(await promise, { ok: true, model: 'gemini-a', data: { action: 'create_reminder' } });
    assert.equal(fetchFn.calls.length, 1);
    const call = fetchFn.calls[0];
    assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-a:generateContent');
    assert.equal(call.options.headers['x-goog-api-key'], API_KEY);
    assert.ok(!call.url.includes(API_KEY), 'המפתח לא בכתובת');
    const body = JSON.parse(call.options.body);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.match(body.contents[0].parts[0].text, /הודעה-פרטית-לבדיקה/);
    const [log] = callLogs(sql);
    assert.equal(log.values[0], 200);
    assert.equal(log.values[1], true);
    assert.match(log.text, /'brain'/);
  });
  test('טלפון בהודעה מוחלף לפני השליחה', async () => {
    const sql = db();
    const fetchFn = fakeFetch(() => answer({ a: 1 }));
    await askBrain({ sql, fetchFn, apiKey: API_KEY, now: NOW, prompt: 'תתקשר ל-052-1234567', notify: async () => {} });
    assert.match(JSON.parse(fetchFn.calls[0].options.body).contents[0].parts[0].text, /\[טלפון\]/);
  });
});

describe('brain/ask: מעבר למודל הבא', () => {
  test('429 יומית: שורת brain-quota עם החזרה בחצות פסיפיק, ומעבר לבא', async () => {
    const { promise, sql, fetchFn } = run({ route: (url) => (modelOf(url) === 'gemini-a' ? quota429('GenerateRequestsPerDayPerProjectPerModel-FreeTier') : answer({ ok: 1 })) });
    assert.deepEqual(await promise, { ok: true, model: 'gemini-b', data: { ok: 1 } });
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), ['gemini-a', 'gemini-b']);
    const [row] = quotaInserts(sql);
    assert.match(row.text, /'brain-quota'/);
    assert.ok(row.values.includes('model=gemini-a; kind=daily; until=2026-11-22T08:00:00.000Z'), JSON.stringify(row.values));
  });
  test('429 לדקה: until = עוד 60 שניות', async () => {
    const { promise, sql } = run({ route: (url) => (modelOf(url) === 'gemini-a' ? quota429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier') : answer({})) });
    await promise;
    assert.ok(quotaInserts(sql)[0].values.includes('model=gemini-a; kind=minute; until=2026-11-21T12:01:00.000Z'));
  });
  test('429 בלי פירוט: unknown', async () => {
    const { promise, sql } = run({ route: (url) => (modelOf(url) === 'gemini-a' ? jsonResponse({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429) : answer({})) });
    await promise;
    assert.ok(quotaInserts(sql)[0].values.some((v) => /kind=unknown/.test(String(v))));
  });
  test('תשובה שאינה JSON, או JSON שלא עובר את schema: מודל הבא, בלי שורת מכסה', async () => {
    const schema = (data) => data && typeof data.action === 'string';
    const route = (url) => ({ 'gemini-a': rawAnswer('זה לא JSON'), 'gemini-b': answer({ wrong: true }), 'gemini-c': answer({ action: 'x' }) })[modelOf(url)];
    const { promise, sql } = run({ route, schema });
    assert.deepEqual(await promise, { ok: true, model: 'gemini-c', data: { action: 'x' } });
    assert.equal(quotaInserts(sql).length, 0);
    assert.deepEqual(callLogs(sql).map((c) => c.values[1]), [false, false, true]);
  });
  test('5xx ושגיאת רשת: מודל הבא', async () => {
    const route = (url) => ({ 'gemini-a': jsonResponse({ error: { status: 'UNAVAILABLE' } }, 503), 'gemini-b': new Error('network down'), 'gemini-c': answer({ z: 1 }) })[modelOf(url)];
    const { promise } = run({ route });
    assert.equal((await promise).model, 'gemini-c');
  });
  test('מודל שכבר חסום במסד מדולג בלי קריאה', async () => {
    const sql = db({ quota: [{ detail: 'model=gemini-a; kind=daily; until=2026-11-22T08:00:00.000Z' }] });
    const { promise, fetchFn } = run({ sql, route: () => answer({}) });
    assert.equal((await promise).model, 'gemini-b');
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), ['gemini-b']);
  });
});

describe('brain/ask: אין מודל', () => {
  test('רשימה ריקה והפיילוט כבוי (BRAIN_PILOT=off): no-pool, בלי קריאה', async () => {
    const { promise, fetchFn } = run({ sql: db({ pool: [] }), route: () => answer({}), env: { BRAIN_PILOT: 'off' } });
    assert.deepEqual(await promise, { ok: false, reason: 'no-pool' });
    assert.equal(fetchFn.calls.length, 0);
  });
  test('כולם נגמרים בקריאה הזו: exhausted עם ההחזרה המוקדמת, והתראה אחת', async () => {
    const route = (url) => (modelOf(url) === 'gemini-b' ? quota429('PerMinute') : quota429('PerDay'));
    const { promise, notified, fetchFn } = run({ route, env: { BRAIN_PILOT: 'off' } }); // גיבוי הפיילוט כבוי: הבדיקה על הרשימה שעברה את השער
    const result = await promise;
    assert.deepEqual(result, { ok: false, reason: 'exhausted', until: '2026-11-21T12:01:00.000Z', kind: 'minute' });
    assert.equal(fetchFn.calls.length, 3);
    assert.deepEqual(notified, [{ until: new Date('2026-11-21T12:01:00.000Z'), kind: 'minute', model: 'gemini-b' }]);
  });
  test('כולם כבר חסומים במסד: exhausted בלי קריאה ובלי התראה נוספת', async () => {
    const quota = ['gemini-a', 'gemini-b', 'gemini-c'].map((m) => ({ detail: `model=${m}; kind=daily; until=2026-11-22T08:00:00.000Z` }));
    const { promise, fetchFn, notified } = run({ sql: db({ quota }), route: () => answer({}), env: { BRAIN_PILOT: 'off' } });
    assert.deepEqual(await promise, { ok: false, reason: 'exhausted', until: '2026-11-22T08:00:00.000Z', kind: 'daily' });
    assert.equal(fetchFn.calls.length, 0);
    assert.equal(notified.length, 0);
  });
  test('כולם נכשלו בלי מכסה (למשל 503): failed, בלי התראה', async () => {
    const { promise, notified } = run({ route: () => jsonResponse({}, 503) });
    assert.deepEqual(await promise, { ok: false, reason: 'failed' });
    assert.equal(notified.length, 0);
  });
  test('בלי מפתח: no-key, בלי מסד ובלי רשת', async (t) => {
    captureConsole(t);
    for (const apiKey of [undefined, '', null]) {
      const { promise, fetchFn, sql } = run({ apiKey, route: () => answer({}) });
      assert.deepEqual(await promise, { ok: false, reason: 'no-key' });
      assert.equal(fetchFn.calls.length + sql.calls.length, 0);
    }
  });
  test('כשל בהתראה לא שובר את התשובה', async (t) => {
    captureConsole(t);
    const { promise } = run({ route: () => quota429('PerDay'), notify: async () => { throw new Error('push down'); } });
    assert.equal((await promise).reason, 'exhausted');
  });
});

describe('brain/ask: פרטיות ועמידות', () => {
  test('המפתח ותוכן ההודעה לא מגיעים ל-call_log, ל-probe_log או ללוג', async (t) => {
    const out = captureConsole(t);
    const route = (url) => ({ 'gemini-a': quota429('PerDay'), 'gemini-b': jsonResponse({ error: { status: 'INTERNAL', message: `echo ${PROMPT} ${API_KEY}` } }, 500), 'gemini-c': new Error(`boom ${API_KEY} ${PROMPT}`) })[modelOf(url)];
    const { promise, sql } = run({ route, env: { BRAIN_PILOT: 'off' } });
    await promise;
    const everything = JSON.stringify(sql.calls) + out.text();
    assert.ok(!everything.includes(API_KEY), 'מפתח דלף');
    assert.ok(!everything.includes('הודעה-פרטית-לבדיקה'), 'תוכן הודעה דלף');
  });
  test('כשל בכתיבת שורת מכסה: ממשיכים למודל הבא', async (t) => {
    captureConsole(t);
    const route = (url) => (modelOf(url) === 'gemini-a' ? quota429('PerDay') : answer({ ok: 1 }));
    const { promise } = run({ sql: db({ failQuotaInsert: true }), route });
    assert.equal((await promise).model, 'gemini-b');
  });
  test('כשל בקריאת המסד נזרק (המתקשר מחליט)', async () => {
    const sql = fakeSql(() => { throw Object.assign(new Error('db down'), { name: 'NeonDbError' }); });
    const fetchFn = fakeFetch(() => answer({}));
    await assert.rejects(askBrain({ sql, fetchFn, apiKey: API_KEY, now: NOW, prompt: PROMPT, notify: async () => {} }), { name: 'NeonDbError' });
    assert.equal(fetchFn.calls.length, 0);
  });
});

describe('brain/ask: פיילוט (חריג לשער, 23.11.2026)', () => {
  const pilotRows = (sql) => sql.find('INSERT INTO probe_log').filter((c) => c.values[0] === PILOT_PROBE);
  test('רשימה ריקה: רצים על רשימת הפיילוט לפי הסדר; תשובה תקינה מסומנת pilot, ונרשמת שורה בלי טקסט', async () => {
    const { promise, fetchFn, sql } = run({ sql: db({ pool: [] }), route: () => answer({ kind: 'x' }) });
    const result = await promise;
    assert.deepEqual(result, { ok: true, model: PILOT_POOL[0].model, data: { kind: 'x' }, pilot: true });
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), [PILOT_POOL[0].model]);
    const rows = pilotRows(sql);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].values, [PILOT_PROBE, true, `model=${PILOT_POOL[0].model}; outcome=ok`]);
    assert.ok(!rows[0].values[2].includes(PROMPT));
  });
  test('תשובה לא בפורמט: המודל הבא בפיילוט; שתיהן לא בפורמט = failed (הקוד ממשיך), ושתי שורות format', async () => {
    const { promise, sql } = run({ sql: db({ pool: [] }), route: () => answer({ kind: 'x' }), schema: () => false });
    assert.deepEqual(await promise, { ok: false, reason: 'failed' });
    assert.deepEqual(pilotRows(sql).map((c) => c.values[2]), PILOT_POOL.map(({ model }) => `model=${model}; outcome=format`));
  });
  test('429 בפיילוט: חסימת מכסה נרשמת והמודל הבא; כולם במכסה = exhausted', async () => {
    const { promise, sql } = run({ sql: db({ pool: [] }), route: () => quota429('PerDay') });
    const result = await promise;
    assert.equal(result.reason, 'exhausted');
    assert.deepEqual(pilotRows(sql).map((c) => c.values[2].split('; ')[1]), ['outcome=quota', 'outcome=quota']);
  });
  test('מודל שעבר את השער גובר: אין קריאה למודלי הפיילוט ואין שורות פיילוט', async () => {
    const { promise, fetchFn, sql } = run({ route: () => answer({}) });
    const result = await promise;
    assert.equal(result.pilot, undefined);
    assert.ok(!PILOT_POOL.some(({ model }) => fetchFn.calls.map((c) => modelOf(c.url)).includes(model)));
    assert.equal(pilotRows(sql).length, 0);
  });
  test('גיבוי (24.11): כל מי שעבר את השער נכשל: מודלי הפיילוט אחריו, מסומנים pilot', async () => {
    const route = (url) => (modelOf(url).startsWith('gemini-') && !PILOT_POOL.some(({ model }) => model === modelOf(url)) ? new Error('timeout') : answer({ kind: 'y' }));
    const { promise, fetchFn, sql } = run({ route });
    assert.deepEqual(await promise, { ok: true, model: PILOT_POOL[0].model, data: { kind: 'y' }, pilot: true });
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), ['gemini-a', 'gemini-b', 'gemini-c', PILOT_POOL[0].model]);
    assert.deepEqual(pilotRows(sql).map((c) => c.values[2]), [`model=${PILOT_POOL[0].model}; outcome=ok`]);
  });
  test('גיבוי: מודל שעבר את השער וגם ברשימת הפיילוט לא נקרא פעמיים, ולא מסומן pilot', async () => {
    const passed = PILOT_POOL[1].model;
    const route = (url) => (modelOf(url) === passed ? new Error('timeout') : answer({ kind: 'z' }));
    const { promise, fetchFn } = run({ sql: db({ pool: [passRow(passed, 18)] }), route });
    assert.deepEqual(await promise, { ok: true, model: PILOT_POOL[0].model, data: { kind: 'z' }, pilot: true });
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), [passed, PILOT_POOL[0].model]);
  });
  test('גיבוי: מי שעבר את השער ב-429: נרשמת חסימה, והגיבוי עונה', async () => {
    const route = (url) => (PILOT_POOL.some(({ model }) => model === modelOf(url)) ? answer({ kind: 'q' }) : quota429('PerDay'));
    const { promise, sql, notified } = run({ route });
    assert.deepEqual(await promise, { ok: true, model: PILOT_POOL[0].model, data: { kind: 'q' }, pilot: true });
    assert.equal(quotaInserts(sql).filter((c) => /'brain-quota'/.test(c.text)).length, 3);
    assert.equal(notified.length, 0);
  });
  test('גיבוי: הכול במכסה, כולל הגיבוי: exhausted והתראה אחת', async () => {
    const { promise, notified, fetchFn } = run({ route: () => quota429('PerDay') });
    assert.equal((await promise).reason, 'exhausted');
    assert.equal(fetchFn.calls.length, 3 + PILOT_POOL.length);
    assert.equal(notified.length, 1);
  });
  test('סדר לפי בריאות (24.11): מודל שנכשל ב-30 הדקות האחרונות עובר לסוף התור', async () => {
    const passedModel = PILOT_POOL[1].model;
    const sql = fakeSql((text) => {
      if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return [passRow(passedModel, 18)];
      if (text.includes('brain-recent-failures')) return [{ error: `model=${passedModel}: HTTP 503 UNAVAILABLE` }];
      return [];
    });
    const { promise, fetchFn } = run({ sql, route: () => answer({ kind: 'f' }) });
    assert.deepEqual(await promise, { ok: true, model: PILOT_POOL[0].model, data: { kind: 'f' }, pilot: true });
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), [PILOT_POOL[0].model]);
    const query = sql.find('brain-recent-failures')[0];
    assert.ok(query.values.includes('2026-11-21T11:30:00.000Z'), 'חלון של 30 דקות לפי now');
  });
  test('סדר לפי בריאות: הנכשל לא נעלם, הוא רק אחרון', async () => {
    const passedModel = PILOT_POOL[1].model;
    const sql = fakeSql((text) => {
      if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return [passRow(passedModel, 18)];
      if (text.includes('brain-recent-failures')) return [{ error: `model=${passedModel}: timeout` }];
      return [];
    });
    const route = (url) => (modelOf(url) === passedModel ? answer({ kind: 'g' }) : new Error('down'));
    const { promise, fetchFn } = run({ sql, route });
    assert.equal((await promise).model, passedModel);
    assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), [PILOT_POOL[0].model, passedModel]);
  });
  test('סדר לפי בריאות: כשל בקריאת הכשלים לא שובר; הסדר הרגיל', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => {
      if (text.includes('brain-recent-failures')) throw Object.assign(new Error('db'), { name: 'NeonDbError' });
      if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return POOL_ROWS;
      return [];
    });
    const { promise } = run({ sql, route: () => answer({}) });
    assert.equal((await promise).model, 'gemini-a');
  });
  test('גיבוי: הפיילוט כבוי (BRAIN_PILOT=off): רק מי שעבר את השער, ואז failed', async () => {
    const { promise, fetchFn, sql } = run({ route: () => jsonResponse({}, 503), env: { BRAIN_PILOT: 'off' } });
    assert.deepEqual(await promise, { ok: false, reason: 'failed' });
    assert.equal(fetchFn.calls.length, 3);
    assert.equal(pilotRows(sql).length, 0);
  });
  test('pilotOutcome ו-pilotOn', () => {
    assert.equal(pilotOutcome({ error: null, status: 200 }), 'ok');
    assert.equal(pilotOutcome({ error: 'x', status: 429 }), 'quota');
    assert.equal(pilotOutcome({ error: 'x', status: null }), 'network');
    assert.equal(pilotOutcome({ error: 'פורמט: y', status: 200 }), 'format');
    assert.equal(pilotOutcome({ error: 'HTTP 503', status: 503 }), 'http-503');
    assert.equal(pilotOn({}), PILOT_ENABLED);
    assert.equal(pilotOn({ BRAIN_PILOT: 'OFF' }), false);
  });
});
