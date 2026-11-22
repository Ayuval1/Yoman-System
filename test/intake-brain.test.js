// בדיקות לבלוק 3ב-1: הבנת הודעה במוח (lib/intake-brain.js), חיבורה לצינור (lib/intake-process.js), "הגב" (api/intake.js),
// והטיפול החוזר (lib/intake-brain-retry.js, lib/ops/cron-plan.js). מסד ורשת מזויפים; אין רשת אמיתית.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { processSource } from '../lib/intake-process.js';
import { buildQuestion } from '../lib/intake-questions.js';
import { understandSource, isValidUnderstanding, buildPrompt, parseReplyTo, loadReplyContext, mergeUnderstanding, BASE_RULES, BRAIN_KINDS } from '../lib/intake-brain.js';
import { extractFacts } from '../lib/intake-facts.js';
import { retryPendingSources } from '../lib/intake-brain-retry.js';
import { handle as intakeHandle } from '../api/intake.js';
import { handle as cronHandleReal } from '../lib/ops/cron-plan.js';
// בלוק 4: תזמון "בוצע?" של משימות (taskChecksEnabled) כבוי כאן, כדי שספירת הקריאות למסד ולתור תישאר כמו לפני הבלוק. נבדק ב-test/personal-task.test.js.
const cronHandle = (request, deps) => cronHandleReal(request, { taskChecksEnabled: false, ...deps });
import { fakeSql, fakeFetch, jsonResponse, captureConsole, formRequest, req, FAKE_SECRET, FAKE_CRON } from './helpers.js';

const SRC_ID = '11111111-1111-4111-8111-111111111111';
const QUOTE_ID = '44444444-4444-4444-8444-444444444444';
const SUNDAY_EVENING = new Date('2026-10-11T15:00:00Z'); // ראשון 11.10.2026 18:00 בישראל
const SATURDAY = new Date('2026-10-10T08:00:00Z');
const API_KEY = 'AIza-fake-intake-brain-key';
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = { slots: [slot(1, 7, 'מתמטיקה'), slot(2, 3, 'מתמטיקה'), slot(2, 7, 'פיזיקה'), slot(5, 2, 'היסטוריה')] };
const source = (text, over = {}) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: sha(text), received_at: SUNDAY_EVENING, ...over });
const understanding = (over = {}) => ({ kind: 'other', subject: null, topic: null, date_text: null, new_date_text: null, time_text: null, new_room: null, uncertain: [], ...over });
const brainOk = (over) => async () => ({ ok: true, model: 'gemini-a', understanding: understanding(over) });
const db = (extra = () => undefined) => fakeSql((text, values) => extra(text, values) ?? []);
const atomicOf = (sql) => {
  const calls = sql.find('INTO facts');
  assert.equal(calls.length, 1, 'פקודת כתיבה אטומית אחת');
  return calls[0];
};
const factsOf = (call) => JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
const questionsOf = (call) => [...new Set(call.values.filter((v) => typeof v === 'string' && v.endsWith('?')))];
const agreementOf = (sql) => sql.find("'brain-intake'");
const pendingOf = (sql) => sql.find("'brain-pending'").filter((c) => c.text.startsWith('INSERT'));

describe('בלוק 3ב-1: הפרומפט והפורמט', () => {
  test('שני כללי-היסוד בפרומפט, בלי תאריך הקליטה; ההקשר של "הגב" מסומן כהקשר', () => {
    const prompt = buildPrompt({ text: 'מחר מבחן', context: 'נרשם · מבחן · מתמטיקה' });
    assert.ok(prompt.includes(BASE_RULES));
    assert.match(prompt, /ספר רק מידע מבוסס, מאומת ועדכני/);
    assert.match(prompt, /אין באפשרותי לאשר זאת/);
    assert.doesNotMatch(prompt, /2026|\d{4}-\d{2}-\d{2}/, 'בלי תאריך');
    assert.match(prompt, /להקשר בלבד[\s\S]*נרשם · מבחן · מתמטיקה[\s\S]*ההודעה:\n«מחר מבחן»/);
    assert.doesNotMatch(buildPrompt({ text: 'שלום' }), /להקשר בלבד/);
    for (const kind of BRAIN_KINDS) assert.ok(prompt.includes(`- ${kind}:`), kind);
  });
  test('isValidUnderstanding: סוג מהרשימה, ביטויים מילה במילה, uncertain מהרשימה', () => {
    const text = 'ביום שישי ב-20:00 תיאטרון';
    assert.equal(isValidUnderstanding(understanding({ kind: 'personal_event', date_text: 'ביום שישי', time_text: 'ב-20:00', uncertain: [] }), text), true);
    assert.equal(isValidUnderstanding(understanding({ kind: 'party' }), text), false);
    assert.equal(isValidUnderstanding(understanding({ kind: 'personal_event', date_text: '2026-10-16' }), text), false, 'תאריך שחושב במודל = לא מילה במילה');
    assert.equal(isValidUnderstanding(understanding({ time_text: 'ב-21:00' }), text), false, 'שעה שהומצאה');
    assert.equal(isValidUnderstanding(understanding({ uncertain: ['location'] }), text), false);
    assert.equal(isValidUnderstanding({ kind: 'other' }, text), false, 'בלי uncertain');
    assert.equal(isValidUnderstanding(understanding({ topic: 5 }), text), false);
    assert.equal(isValidUnderstanding([], text), false);
  });
  test('parseReplyTo: uuid ו-user/system בלבד', () => {
    assert.deepEqual(parseReplyTo(QUOTE_ID, 'user'), { id: QUOTE_ID, role: 'user' });
    assert.deepEqual(parseReplyTo(QUOTE_ID, 'system'), { id: QUOTE_ID, role: 'system' });
    for (const [id, role] of [[null, 'user'], ['12', 'user'], [`${QUOTE_ID}'`, 'user'], [QUOTE_ID, 'admin'], [QUOTE_ID, null]]) assert.equal(parseReplyTo(id, role), null);
  });
});

describe('בלוק 3ב-1: understandSource מול askBrain האמיתי (fetch מזויף)', () => {
  const passRow = (model) => ({ ok: true, at: new Date('2026-10-11T10:00:00Z'), detail: `range=s01-s20; 19/20 ran=20; failed: none; model=${model}; elapsed=1s` });
  const brainDb = (extra = () => undefined) => fakeSql((text, values) => {
    const custom = extra(text, values);
    if (custom !== undefined) return custom;
    if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return [passRow('gemini-a'), passRow('gemini-b')];
    return [];
  });
  const answer = (obj) => jsonResponse({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
  const modelOf = (url) => /models\/([^:]+):generateContent$/.exec(url)?.[1];

  test('JSON לא תקין או לא בפורמט מהמודל הראשון: עוברים למודל הבא', async () => {
    const text = 'מחר מבחן במתמטיקה';
    for (const bad of ['not json {', { kind: 'party', uncertain: [] }, { kind: 'exam', date_text: '2026-10-12', uncertain: [] }]) {
      const fetchFn = fakeFetch((url) => (modelOf(url) === 'gemini-a' ? answer(bad) : answer(understanding({ kind: 'exam', subject: 'מתמטיקה', date_text: 'מחר', uncertain: ['topic'] }))));
      const out = await understandSource({ sql: brainDb(), source: source(text), now: SUNDAY_EVENING, apiKey: API_KEY, fetchFn });
      assert.equal(out.ok, true, JSON.stringify(bad));
      assert.equal(out.model, 'gemini-b');
      assert.equal(out.understanding.kind, 'exam');
      assert.deepEqual(fetchFn.calls.map((c) => modelOf(c.url)), ['gemini-a', 'gemini-b']);
    }
  });
  test('בלי מפתח: no-key, בלי מסד ובלי רשת; רשימה ריקה: no-pool', async () => {
    const sql = brainDb();
    const fetchFn = fakeFetch(() => { throw new Error('no network'); });
    assert.deepEqual(await understandSource({ sql, source: source('שלום'), apiKey: '', fetchFn }), { ok: false, reason: 'no-key' });
    assert.equal(sql.calls.length, 0);
    const empty = fakeSql(() => []);
    assert.deepEqual(await understandSource({ sql: empty, source: source('שלום'), apiKey: API_KEY, fetchFn }), { ok: false, reason: 'no-pool' });
    assert.equal(fetchFn.calls.length, 0);
  });
  test('"הגב": הטקסט המצוטט נטען ונכנס לפרומפט; הטלפון מוחלף לפני השליחה', async () => {
    const sql = brainDb((text) => (text.includes('FROM messages WHERE id') ? [{ text: 'נרשם · אירוע אישי · תיאטרון' }] : undefined));
    const fetchFn = fakeFetch(() => answer(understanding({ kind: 'other' })));
    await understandSource({ sql, source: source('לא, ב-20:00, תתקשר 052-1234567'), replyTo: { id: QUOTE_ID, role: 'system' }, now: SUNDAY_EVENING, apiKey: API_KEY, fetchFn });
    const sent = JSON.parse(fetchFn.calls[0].options.body).contents[0].parts[0].text;
    assert.match(sent, /נרשם · אירוע אישי · תיאטרון/);
    assert.doesNotMatch(sent, /052-1234567/);
    assert.deepEqual(sql.find('FROM messages WHERE id')[0].values, [QUOTE_ID]);
  });
  test('loadReplyContext: user מ-sources, לא נמצא או כשל = null בשקט', async (t) => {
    captureConsole(t);
    const sql = fakeSql((text) => (text.includes('FROM sources') ? [{ text: 'מחר מבחן' }] : []));
    assert.equal(await loadReplyContext(sql, { id: QUOTE_ID, role: 'user' }), 'מחר מבחן');
    assert.equal(await loadReplyContext(sql, { id: QUOTE_ID, role: 'system' }), null);
    assert.equal(await loadReplyContext(sql, null), null);
    assert.equal(await loadReplyContext(fakeSql(() => { throw new Error('down'); }), { id: QUOTE_ID, role: 'user' }), null);
  });
});

describe('בלוק 3ב-1: המסלול של המוח בצינור', () => {
  test('אירוע במשפט אחד בלי שעה: הסוג של המוח, תאריך בקוד, ושאלה אחת בלבד על השעה (ח-1)', async () => {
    const text = 'ביום שישי אני והמשפחה נוסעים לתיאטרון בחיפה';
    const sql = db();
    const result = await processSource({ sql, source: source(text), timetable: TIMETABLE, understand: brainOk({ kind: 'personal_event', topic: 'תיאטרון בחיפה', date_text: 'ביום שישי', uncertain: ['time'] }) });
    assert.equal(result.status, 'recorded');
    assert.equal(result.brain, 'ok');
    const call = atomicOf(sql);
    const facts = factsOf(call);
    assert.deepEqual(facts.map((f) => [f.field, f.value]), [['type', 'personal_event'], ['date', '2026-10-16'], ['topic', 'תיאטרון בחיפה']]);
    assert.deepEqual(questionsOf(call), [buildQuestion({ field: 'time', type: 'personal_event' }).text]);
  });
  test('uncertain על תאריך שהקוד רק הסיק ("בלי תאריך = היום"): לא מנחשים, שאלה אחת על התאריך', async () => {
    const text = 'תיאטרון בחיפה עם כל המשפחה';
    const sql = db();
    await processSource({ sql, source: source(text), timetable: TIMETABLE, understand: brainOk({ kind: 'personal_event', topic: 'תיאטרון בחיפה', uncertain: ['date', 'time'] }) });
    const call = atomicOf(sql);
    assert.ok(!factsOf(call).some((f) => f.field === 'date'), 'אין תאריך מנוחש');
    const questions = questionsOf(call);
    assert.equal(questions.length, 1);
    assert.match(questions[0], /תאריך|מתי|איזה יום/);
  });
  test('המוח והקוד חלוקים: המוח גובר, ושניהם נרשמים ב-probe_log בלי טקסט', async () => {
    const text = 'מחר אין שיעור אנגלית';
    const sql = db();
    await processSource({ sql, source: source(text), timetable: TIMETABLE, understand: brainOk({ kind: 'cancel', subject: 'אנגלית', date_text: 'מחר', uncertain: [] }) });
    const [log] = agreementOf(sql);
    assert.equal(log.values[0], false);
    assert.equal(log.values[1], 'ai=cancel; code=other; channel=app; model=gemini-a');
    assert.ok(!log.values.some((v) => typeof v === 'string' && v.includes('אנגלית')));
    assert.equal(factsOf(atomicOf(sql))[0].value, 'cancel');
  });
  test('הסכמה נרשמת ok=true', async () => {
    const sql = db();
    await processSource({ sql, source: source('מחר יש מבחן במתמטיקה'), timetable: TIMETABLE, understand: brainOk({ kind: 'exam', subject: 'מתמטיקה', date_text: 'מחר', uncertain: ['topic'] }) });
    assert.equal(agreementOf(sql)[0].values[0], true);
  });
  // בלוק 4: משימה מוקלדת נרשמת ב-tasks (test/personal-task.test.js). כאן: שאלה ואחר נשארים "התקבל", ומשימה מועברת בלי כתיבה.
  test('שאלה / אחר: מוקלדת מקבלת "התקבל" בלי "מה זה?"; שאלה / אחר / משימה מועברת בלי כתיבה', async () => {
    for (const kind of ['task', 'question', 'other']) {
      const forwarded = db();
      await processSource({ sql: forwarded, source: source('שלום', { channel: 'shortcut' }), timetable: TIMETABLE, understand: brainOk({ kind }) });
      assert.equal(forwarded.calls.filter((c) => /INSERT INTO (messages|facts|tasks)|WITH/.test(c.text)).length, 0);
    }
    for (const kind of ['question', 'other']) {
      const typed = db();
      assert.equal((await processSource({ sql: typed, source: source('שלום'), timetable: TIMETABLE, understand: brainOk({ kind }) })).status, 'unclassified');
      assert.equal(typed.find('WITH b AS').length, 1, 'בועת התקבל');
      assert.equal(typed.find('WITH q AS').length, 0, 'בלי מה זה');
    }
  });
  test('בלוק 4: משימה מוקלדת לפי המוח נרשמת; עם סימן שאלה נשארת "התקבל" (הבדיקה בקוד)', async () => {
    const typed = db();
    const out = await processSource({ sql: typed, source: source('להכין מצגת בהיסטוריה עד שלישי'), timetable: TIMETABLE, understand: brainOk({ kind: 'task', topic: 'להכין מצגת בהיסטוריה', date_text: 'עד שלישי' }) });
    assert.equal(out.status, 'recorded');
    assert.equal(out.brain, 'ok');
    assert.equal(typed.find('INSERT INTO tasks').length, 1);
    const question = db();
    const asked = await processSource({ sql: question, source: source('להתקשר לסבתא?'), timetable: TIMETABLE, understand: brainOk({ kind: 'task', topic: 'להתקשר לסבתא' }) });
    assert.equal(asked.status, 'unclassified');
    assert.equal(question.find('INSERT INTO tasks').length, 0);
    assert.equal(question.find('WITH b AS').length, 1, 'בועת התקבל');
  });
  test('כפילות: המוח לא נקרא', async () => {
    let called = false;
    const sql = db((text) => (text.includes('FROM sources s JOIN sources p') ? [{ found: 1 }] : undefined));
    const result = await processSource({ sql, source: source('שלום'), timetable: TIMETABLE, understand: async () => { called = true; return { ok: false, reason: 'no-pool' }; } });
    assert.equal(result.status, 'duplicate');
    assert.equal(called, false);
  });
  test('mergeUnderstanding: מקצוע רק מהרשימה הסגורה (inferred), עובדה שנקראה לא נמחקת', () => {
    const text = 'מחר יש מבחן במתמ';
    const extracted = extractFacts({ text, receivedAt: SUNDAY_EVENING, channel: 'app', timetable: TIMETABLE, forcedType: 'exam' });
    const merged = mergeUnderstanding({ extracted, understanding: understanding({ kind: 'exam', subject: 'מתמטיקה', date_text: 'מחר', uncertain: ['date'] }), receivedAt: SUNDAY_EVENING, text });
    assert.deepEqual(merged.facts.find((f) => f.field === 'subject'), { field: 'subject', value: 'מתמטיקה', origin: 'inferred', extracted_by: 'script' });
    assert.equal(merged.facts.find((f) => f.field === 'date')?.value, '2026-10-12', 'מחר נקרא בקוד ונשאר');
    const other = mergeUnderstanding({ extracted, understanding: understanding({ kind: 'exam', subject: 'מתמ' }), receivedAt: SUNDAY_EVENING, text });
    assert.ok(!other.facts.some((f) => f.field === 'subject'));
  });
});

describe('בלוק 3ב-1: נפילה לנתיב הקוד', () => {
  // דגימה מהקבצים הקיימים (test/intake-process.test.js, 8.2א-1): מוקלדות ומועברות, מובנות ולא מובנות.
  const SAMPLE = [
    ['המבחן בהיסטוריה נדחה ליום חמישי', 'app'], ['מחר בוטל שיעור אנגלית', 'app'], ['יש מבחן בהיסטוריה מחר?', 'app'], ['להביא חוברת', 'app'],
    ['מחר אין שיעור אנגלית', 'app'], ['שלום', 'app'], ['מחר יש מבחן במתמטיקה', 'shortcut'], ['מחר בוטל שיעור אנגלית', 'shortcut'], ['שלום', 'shortcut'],
  ];
  const run = async (text, channel, understand) => {
    const sql = db();
    const result = await processSource({ sql, source: source(text, { channel, received_at: channel === 'app' ? SUNDAY_EVENING : SATURDAY }), timetable: TIMETABLE, understand });
    return { result, calls: sql.calls.filter((c) => !c.text.includes("'brain-pending'")).map((c) => [c.text, c.values]), pending: pendingOf(sql) };
  };
  for (const reason of ['no-pool', 'exhausted', 'failed', 'timeout', 'no-key']) {
    test(`${reason}: אותן פקודות ואותה תשובה כמו בלי מוח`, async () => {
      for (const [text, channel] of SAMPLE) {
        const old = await run(text, channel, undefined);
        const now = await run(text, channel, async () => ({ ok: false, reason }));
        assert.deepEqual(now.calls, old.calls, `${channel}: ${text}`);
        assert.deepEqual({ status: now.result.status, reply: now.result.reply, task: now.result.task }, { status: old.result.status, reply: old.result.reply, task: old.result.task }, `${channel}: ${text}`);
        assert.equal(now.result.brain, reason);
        const expectPending = reason !== 'no-key' && channel === 'shortcut' && old.result.status === 'unclassified';
        assert.equal(now.pending.length, expectPending ? 1 : 0, `סימון ממתין: ${channel}: ${text}`);
        if (expectPending) assert.deepEqual(now.pending[0].values, [`source=${SRC_ID}`, `source=${SRC_ID}`]);
      }
    });
  }
  test('understand שזורק: נפילה לקוד עם failed', async (t) => {
    captureConsole(t);
    const { result } = await run('שלום', 'shortcut', async () => { throw new Error('boom'); });
    assert.equal(result.brain, 'failed');
    assert.equal(result.status, 'unclassified');
  });
});

describe('בלוק 3ב-1: api/intake.js מעביר "הגב" למוח', () => {
  const intakeSql = () => fakeSql((text) => (text.includes('INSERT INTO sources') ? [{ id: SRC_ID, received_at: SUNDAY_EVENING }] : []));
  const send = async (fields) => {
    const seen = [];
    const res = await intakeHandle(formRequest({ text: 'לא, ב-20:00', channel: 'app', ...fields }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql: intakeSql(), secret: FAKE_SECRET, sendQueue: async () => {}, eventSync: async () => {},
      processor: async ({ understand }) => { await understand(); return { status: 'unclassified', reply: 'התקבל' }; },
      understand: async (args) => { seen.push(args); return { ok: false, reason: 'no-pool' }; },
    });
    assert.equal(res.status, 200);
    return seen;
  };
  test('reply_to ו-reply_to_role תקינים עוברים כ-replyTo', async () => {
    const [args] = await send({ reply_to: QUOTE_ID, reply_to_role: 'system' });
    assert.deepEqual(args.replyTo, { id: QUOTE_ID, role: 'system' });
    assert.equal(args.source.id, SRC_ID);
  });
  test('לא תקינים או חסרים: replyTo = null, בלי שגיאה', async () => {
    for (const fields of [{}, { reply_to: 'abc', reply_to_role: 'user' }, { reply_to: QUOTE_ID, reply_to_role: 'boss' }, { reply_to: QUOTE_ID }]) {
      const [args] = await send(fields);
      assert.equal(args.replyTo, null, JSON.stringify(fields));
    }
  });
});

describe('בלוק 3ב-1: טיפול חוזר כשהמכסה חוזרת', () => {
  const NOW = new Date('2026-10-11T14:00:00Z');
  const row = { id: SRC_ID, channel: 'shortcut', raw_content: 'מחר מבחן במתמטיקה', content_hash: 'h', received_at: SATURDAY };
  const retrySql = (rows = [row]) => fakeSql((text) => (text.includes('FROM sources s') ? rows : []));
  test('בלי מפתח: לא נוגעים במסד', async () => {
    const sql = retrySql();
    assert.deepEqual(await retryPendingSources({ sql, now: NOW, apiKey: '' }), { tried: 0, recorded: 0, understood: 0 });
    assert.equal(sql.calls.length, 0);
  });
  test('בחירה: קיצור, 48 שעות, ממתין, לא נראה, בלי messages, עד 5', async () => {
    const sql = retrySql([]);
    await retryPendingSources({ sql, now: NOW, apiKey: API_KEY });
    const [select] = sql.calls;
    assert.match(select.text, /s\.channel = 'shortcut' AND s\.processed_at IS NULL/);
    assert.match(select.text, /p\.ok = false[\s\S]*NOT EXISTS[\s\S]*p\.ok = true[\s\S]*NOT EXISTS \(SELECT 1 FROM messages/);
    assert.deepEqual(select.values, ['2026-10-09T14:00:00.000Z', 5]);
  });
  test('המוח ענה ונרשם: סימון "ראה", כתיבה ליומן; לא ענה: בלי סימון', async () => {
    const synced = [];
    const sql = retrySql();
    const summary = await retryPendingSources({
      sql, now: NOW, apiKey: API_KEY,
      processor: async ({ understand }) => ({ ...(await understand()), status: 'recorded', brain: 'ok' }),
      understand: async () => ({ ok: true }),
      eventSync: async (args) => { synced.push(args.sourceId); },
    });
    assert.deepEqual(summary, { tried: 1, recorded: 1, understood: 1 });
    assert.deepEqual(pendingOf(sql)[0].values, [true, `source=${SRC_ID}`]);
    assert.deepEqual(synced, [SRC_ID]);
    const again = retrySql();
    const none = await retryPendingSources({ sql: again, now: NOW, apiKey: API_KEY, processor: async () => ({ status: 'unclassified', brain: 'exhausted' }), eventSync: async () => { throw new Error('לא אמור'); } });
    assert.deepEqual(none, { tried: 1, recorded: 0, understood: 0 });
    assert.equal(pendingOf(again).length, 0);
  });
  test('cron-plan מריץ את הטיפול החוזר ורושם מספרים בלבד; כשל לא משנה את הסטטוס', async (t) => {
    captureConsole(t);
    const run = async (brainRetry) => {
      const sql = fakeSql(() => []);
      const res = await cronHandle(req('https://x.test/api/ops?task=cron-plan&slot=2', { headers: { authorization: `Bearer ${FAKE_CRON}` } }), {
        sql, secret: FAKE_CRON, now: () => NOW, send: async () => {}, brainRetry,
      });
      return { res, detail: sql.find("'cron-plan'")[0].values[1] };
    };
    const ok = await run(async () => ({ tried: 2, understood: 1, recorded: 1 }));
    assert.equal(ok.res.status, 200);
    assert.match(ok.detail, /; brain_retry=2; brain_understood=1; brain_recorded=1$/);
    const quiet = await run(async () => ({ tried: 0, understood: 0, recorded: 0 }));
    assert.doesNotMatch(quiet.detail, /brain_/);
    const failed = await run(async () => { throw Object.assign(new Error('x'), { name: 'NeonDbError' }); });
    assert.equal(failed.res.status, 200);
    assert.match(failed.detail, /brain_retry_failed=NeonDbError/);
  });
});
