// בדיקות שלב 8.3-4 (כתיבה ליומן Google, docs/08-chapter8/65 D2, D5): lib/event-sync.js, הפונקציות החדשות ב-lib/google.js,
// והחיבורים ב-api/intake.js, api/chat.js ו-lib/ops/daily-check.js. בלי רשת ובלי מסד: sql ו-fetch מזויפים. כל השמות והמזהים מומצאים.
// חשוב: הכתובות והתשובות של Google כאן הן ההנחות שבקוד (לא אומתו מול Google אמיתי), וה-SQL לא הורץ מול Postgres.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CALENDAR_BY_DOMAIN, googleEventIdFor, resolveCalendarId, eventBody, planEventSync, syncEventForSource, syncEventAfterAnswer, sweepEventSync,
} from '../lib/event-sync.js';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT, eventsEndpoint, insertCalendarEvent, patchCalendarEvent, deleteCalendarEvent } from '../lib/google.js';
import { handle as intakeHandle } from '../api/intake.js';
import { handle as chatHandle } from '../api/chat.js';
import { handle as dailyHandle } from '../lib/ops/daily-check.js';
import { fakeSql, fakeFetch, jsonResponse, timeoutError, captureConsole, formRequest, jsonRequest, FAKE_SECRET } from './helpers.js';
import { CONFIG, ACCESS_TOKEN, encRefresh, assertNoSecrets } from './google-fixtures.js';

const NOW = new Date('2026-10-27T08:00:00.000Z'); // 11:00 בישראל
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GOOGLE_ID = 'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee';
const TITLE = 'תור לרופא שיניים מומצא';
const PERSONAL_CAL = 'personal-cal-id-DO-NOT-LEAK@group.calendar.google.com';
const SCHOOL_CAL = 'school-cal-id-DO-NOT-LEAK@group.calendar.google.com';
const PRIMARY_CAL = 'primary-DO-NOT-LEAK@gmail.com';
const CALENDARS = [
  { id: PRIMARY_CAL, summary: PRIMARY_CAL, accessRole: 'owner' },
  { id: PERSONAL_CAL, summary: 'אישי', accessRole: 'owner' },
  { id: SCHOOL_CAL, summary: 'בית ספר', accessRole: 'writer' },
  { id: 'shared-reader-id', summary: 'אישי', accessRole: 'reader' }, // אותו שם, קריאה בלבד: לא נספר
];

const eventRow = (over = {}) => ({
  id: EVENT_ID, title: TITLE, starts_at: new Date('2026-10-27T15:30:00.000Z'), ends_at: new Date('2026-10-27T16:30:00.000Z'),
  domain: 'personal', status: 'planned', external_id: null, match_key: `source:${SRC_ID}`, ...over,
});

// sql מזויף: שורת האירוע של המקור, החיבור, שורת השאלה (בצ'אט) ושורות הסריקה.
function syncSql({ row = eventRow(), answerRow = { source_id: SRC_ID, corrected: false }, sweepRows = [], failUpdate = false } = {}) {
  return fakeSql((text) => {
    if (text.includes('FROM events WHERE match_key =')) return row ? [row] : [];
    if (text.includes("WHERE match_key LIKE 'source:%'")) return sweepRows;
    if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh(), obtained_at: '2026-10-20T08:00:00.000Z' }];
    if (text.includes('FROM messages m WHERE m.id')) return answerRow ? [answerRow] : [];
    if (text.startsWith('UPDATE events SET external_id')) {
      if (failUpdate) throw new Error(`db down ${TITLE}`);
      return [];
    }
    return [];
  });
}

// fetch מזויף של Google: token, calendarList, ופעולות על events. כל מפעיל: Response, פונקציה או Error.
function gFetch({ token, calendars = CALENDARS, insert, patch, del } = {}) {
  const pick = (h, fallback, url, options) => {
    const v = typeof (h ?? fallback) === 'function' ? (h ?? fallback)(url, options) : (h ?? fallback);
    if (v instanceof Error) throw v;
    return v;
  };
  return fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return pick(token, () => jsonResponse({ access_token: ACCESS_TOKEN }), url, options);
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: calendars });
    if (url.includes('/events')) {
      if (options.method === 'POST') return pick(insert, () => jsonResponse({ id: GOOGLE_ID, summary: 'x' }), url, options);
      if (options.method === 'PATCH') return pick(patch, () => jsonResponse({ id: GOOGLE_ID }), url, options);
      if (options.method === 'DELETE') return pick(del, () => new Response(null, { status: 204 }), url, options);
    }
    throw new Error(`fetch לא צפוי: ${url}`);
  });
}
const eventCalls = (f) => f.calls.filter((c) => c.url.includes('/events'));
const sync = (deps) => syncEventForSource({ sourceId: SRC_ID, now: NOW, config: CONFIG, ...deps });
const externalUpdates = (sql) => sql.calls.filter((c) => c.text.startsWith('UPDATE events SET external_id'));

describe('8.3-4: הטבלה, המזהה והיומן (קריטריונים 1, 2)', () => {
  test('הטבלה בקוד: personal ← "אישי", school ← "בית ספר", ותו לא', () => {
    assert.deepEqual({ ...CALENDAR_BY_DOMAIN }, { personal: 'אישי', school: 'בית ספר' });
    assert.ok(Object.isFrozen(CALENDAR_BY_DOMAIN));
  });
  test('מזהה Google נגזר מ-events.id: בלי מקפים, אותיות קטנות, base32hex תקין; קלט פגום = null', () => {
    assert.equal(googleEventIdFor(EVENT_ID), GOOGLE_ID);
    assert.equal(googleEventIdFor(EVENT_ID.toUpperCase()), GOOGLE_ID);
    assert.match(googleEventIdFor(EVENT_ID), /^[0-9a-v]{5,1024}$/);
    for (const bad of [null, undefined, '', 'abc', 'zzzz-zzzz-zzzz', 5]) assert.equal(googleEventIdFor(bad), null, String(bad));
  });
  test('resolveCalendarId: שם מדויק בין owner / writer בלבד; אין = calendar_not_found; שניים = calendar_ambiguous', () => {
    assert.deepEqual(resolveCalendarId(CALENDARS, 'אישי'), { ok: true, calendarId: PERSONAL_CAL });
    assert.deepEqual(resolveCalendarId(CALENDARS, 'בית ספר'), { ok: true, calendarId: SCHOOL_CAL });
    assert.deepEqual(resolveCalendarId(CALENDARS, 'אישי '), { ok: false, reason: 'calendar_not_found' });
    assert.deepEqual(resolveCalendarId([{ id: 'r', summary: 'אישי', accessRole: 'reader' }], 'אישי'), { ok: false, reason: 'calendar_not_found' });
    assert.deepEqual(resolveCalendarId([...CALENDARS, { id: 'dup', summary: 'אישי', accessRole: 'writer' }], 'אישי'), { ok: false, reason: 'calendar_ambiguous' });
    assert.deepEqual(resolveCalendarId(null, 'אישי'), { ok: false, reason: 'calendar_not_found' });
  });
  test('אירוע אישי נכתב ליומן "אישי", יציאה מוקדמת ליומן "בית ספר" (ולא ליומן הראשי)', async () => {
    for (const [domain, calendarId] of [['personal', PERSONAL_CAL], ['school', SCHOOL_CAL]]) {
      const f = gFetch();
      const result = await sync({ sql: syncSql({ row: eventRow({ domain }) }), fetchFn: f });
      assert.deepEqual(result, { ok: true, action: 'create' }, domain);
      const [call] = eventCalls(f);
      assert.equal(call.url, eventsEndpoint(calendarId));
      assert.ok(!call.url.includes(encodeURIComponent(PRIMARY_CAL)));
    }
  });
  test('תחום אחר, ושורה שאינה ממקור (match_key אחר): לא נכתבים, ואפס קריאות ל-Google', async () => {
    for (const [over, reason] of [
      [{ domain: 'running' }, 'domain_not_synced'], [{ domain: 'business' }, 'domain_not_synced'], [{ domain: null }, 'domain_not_synced'],
      [{ match_key: 'lesson:2026-10-27:3' }, 'not_source'], [{ match_key: null }, 'not_source'],
    ]) {
      const f = gFetch();
      const result = await sync({ sql: syncSql({ row: eventRow(over) }), fetchFn: f });
      assert.deepEqual(result, { ok: true, action: null, reason }, JSON.stringify(over));
      assert.equal(f.calls.length, 0);
    }
  });
  test('יומן לא נמצא / שני יומנים באותו שם: אין כתיבה, קוד חוזר, השורה לא משתנה', async (t) => {
    const cap = captureConsole(t);
    for (const [calendars, reason] of [
      [CALENDARS.filter((c) => c.summary !== 'אישי'), 'calendar_not_found'],
      [[...CALENDARS, { id: 'dup', summary: 'אישי', accessRole: 'owner' }], 'calendar_ambiguous'],
    ]) {
      const sql = syncSql();
      const f = gFetch({ calendars });
      const result = await sync({ sql, fetchFn: f });
      assert.deepEqual(result, { ok: false, action: 'create', reason });
      assert.equal(eventCalls(f).length, 0, 'אין POST');
      assert.equal(externalUpdates(sql).length, 0, 'השורה לא משתנה');
      assert.match(cap.text(), new RegExp(reason));
    }
  });
});

describe('8.3-4: יצירה אימפוטנטית (קריטריון 3)', () => {
  test('POST עם המזהה הקבוע, כותרת ושעות בשעון ישראל, בלי תיאור/מיקום/תזכורות/צבע; external_id נשמר רק אם ריק', async () => {
    const sql = syncSql();
    const f = gFetch();
    await sync({ sql, fetchFn: f });
    const [call] = eventCalls(f);
    assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
    const body = JSON.parse(call.options.body);
    assert.deepEqual(body, {
      summary: TITLE,
      start: { dateTime: '2026-10-27T15:30:00.000Z', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-10-27T16:30:00.000Z', timeZone: 'Asia/Jerusalem' },
      id: GOOGLE_ID,
    });
    const [update] = externalUpdates(sql);
    assert.match(update.text, /WHERE id = \?::uuid AND external_id IS NULL/);
    assert.deepEqual(update.values, [GOOGLE_ID, EVENT_ID]);
  });
  test('409 (כבר קיים מניסיון קודם) = הצלחה, ו-external_id נשמר', async () => {
    const sql = syncSql();
    const f = gFetch({ insert: jsonResponse({ error: { code: 409, message: `duplicate ${TITLE}` } }, 409) });
    assert.deepEqual(await sync({ sql, fetchFn: f }), { ok: true, action: 'create' });
    assert.equal(externalUpdates(sql).length, 1);
  });
  test('ריצה שנייה על שורה שכבר נכתבה: אין כפילות, אפס קריאות ל-Google', async () => {
    const f = gFetch();
    const result = await sync({ sql: syncSql({ row: eventRow({ external_id: GOOGLE_ID }) }), fetchFn: f });
    assert.deepEqual(result, { ok: true, action: null, reason: 'already_synced' });
    assert.equal(f.calls.length, 0);
  });
  test('אין שורת אירוע למקור: no_event, בלי Google', async () => {
    const f = gFetch();
    assert.deepEqual(await sync({ sql: syncSql({ row: null }), fetchFn: f }), { ok: true, action: null, reason: 'no_event' });
    assert.equal(f.calls.length, 0);
  });
  test('שמירת external_id נכשלה: db_error (בריצה הבאה 409 ישלים), בלי לזרוק', async (t) => {
    const cap = captureConsole(t);
    const result = await sync({ sql: syncSql({ failUpdate: true }), fetchFn: gFetch() });
    assert.deepEqual(result, { ok: false, action: 'create', reason: 'db_error' });
    assert.ok(!cap.text().includes(TITLE));
  });
  test('השאילתה מחפשת את האירוע לפי match_key של המקור בלבד', async () => {
    const sql = syncSql();
    await sync({ sql, fetchFn: gFetch() });
    const [select] = sql.find('FROM events WHERE match_key =');
    assert.deepEqual(select.values, [`source:${SRC_ID}`]);
  });
});

describe('8.3-4: תיקון בצ\'אט (קריטריון 4)', () => {
  test('אחרי תיקון שעה/תאריך עם external_id: PATCH של start ו-end בלבד לערכים החדשים', async () => {
    const row = eventRow({ external_id: GOOGLE_ID, starts_at: new Date('2026-10-27T16:00:00.000Z'), ends_at: new Date('2026-10-27T17:00:00.000Z') });
    const sql = syncSql({ row, answerRow: { source_id: SRC_ID, corrected: true } });
    const f = gFetch();
    const result = await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: f });
    assert.deepEqual(result, { ok: true, action: 'patch' });
    const [call] = eventCalls(f);
    assert.equal(call.options.method, 'PATCH');
    assert.equal(call.url, eventsEndpoint(PERSONAL_CAL, GOOGLE_ID));
    assert.deepEqual(JSON.parse(call.options.body), {
      start: { dateTime: '2026-10-27T16:00:00.000Z', timeZone: 'Asia/Jerusalem' },
      end: { dateTime: '2026-10-27T17:00:00.000Z', timeZone: 'Asia/Jerusalem' },
    });
    // מזהה המקור נקרא משורת השאלה (messages.entity_id), ותיקון נחשב רק fix_time / fix_date שאינו unknown
    const [lookup] = sql.find('FROM messages m WHERE m.id');
    assert.deepEqual(lookup.values, ['fix_time', 'fix_date', MSG_ID]);
    assert.match(lookup.text, /f\.value <> 'unknown'/);
  });
  test('תיקון כשאין עדיין external_id: יצירה במקום עדכון', async () => {
    const f = gFetch();
    const sql = syncSql({ answerRow: { source_id: SRC_ID, corrected: true } });
    assert.deepEqual(await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: f }), { ok: true, action: 'create' });
    assert.equal(eventCalls(f)[0].options.method, 'POST');
  });
  test('תיקון בלי external_id ו-409 (נוצר קודם ונפל לפני השמירה): PATCH אחרי היצירה, ו-external_id נשמר (ביקורת 27.10, ממצא 1)', async () => {
    const f = gFetch({ insert: jsonResponse({}, 409) });
    const sql = syncSql({ answerRow: { source_id: SRC_ID, corrected: true } });
    assert.deepEqual(await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: f }), { ok: true, action: 'create' });
    assert.deepEqual(eventCalls(f).map((c) => c.options.method), ['POST', 'PATCH']);
    assert.equal(eventCalls(f)[1].url, eventsEndpoint(PERSONAL_CAL, GOOGLE_ID));
    assert.equal(externalUpdates(sql).length, 1);
  });
  test('יצירה רגילה (לא תיקון) שמחזירה 409: בלי PATCH', async () => {
    const f = gFetch({ insert: jsonResponse({}, 409) });
    assert.deepEqual(await sync({ sql: syncSql(), fetchFn: f }), { ok: true, action: 'create' });
    assert.deepEqual(eventCalls(f).map((c) => c.options.method), ['POST']);
  });
  test('תשובה שאינה תיקון ("נכון") על אירוע שכבר נכתב: אין PATCH (לא דורסים שינוי ידני ב-Google)', async () => {
    const f = gFetch();
    const sql = syncSql({ row: eventRow({ external_id: GOOGLE_ID }), answerRow: { source_id: SRC_ID, corrected: false } });
    assert.deepEqual(await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: f }), { ok: true, action: null, reason: 'already_synced' });
    assert.equal(f.calls.length, 0);
  });
  test('שאלה שאינה של מקור: no_event, בלי Google', async () => {
    const f = gFetch();
    assert.deepEqual(await syncEventAfterAnswer({ sql: syncSql({ answerRow: null }), messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: f }), { ok: true, action: null, reason: 'no_event' });
    assert.equal(f.calls.length, 0);
  });
  test('PATCH שנכשל: קוד קצר, בלי לזרוק (לא מנוסה שוב בסריקה)', async (t) => {
    captureConsole(t);
    const sql = syncSql({ row: eventRow({ external_id: GOOGLE_ID }), answerRow: { source_id: SRC_ID, corrected: true } });
    const result = await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: gFetch({ patch: new Response('{}', { status: 503 }) }) });
    assert.deepEqual(result, { ok: false, action: 'patch', reason: 'http_error (503)' });
  });
});

describe('8.3-4: "לא קורה" (קריטריון 5)', () => {
  const cancelled = (over = {}) => eventRow({ status: 'cancelled', external_id: GOOGLE_ID, ...over });
  test('DELETE לאירוע ב-Google; השורה במסד לא נמחקת ולא משתנה', async () => {
    const sql = syncSql({ row: cancelled() });
    const f = gFetch();
    assert.deepEqual(await sync({ sql, fetchFn: f }), { ok: true, action: 'delete' });
    const [call] = eventCalls(f);
    assert.equal(call.options.method, 'DELETE');
    assert.equal(call.url, eventsEndpoint(PERSONAL_CAL, GOOGLE_ID));
    assert.equal(sql.calls.filter((c) => /\b(DELETE|UPDATE)\b/.test(c.text)).length, 0);
  });
  test('404 ו-410 (כבר לא קיים) = הצלחה; 500 = כשל', async (t) => {
    captureConsole(t);
    for (const status of [404, 410]) {
      assert.deepEqual(await sync({ sql: syncSql({ row: cancelled() }), fetchFn: gFetch({ del: new Response('{}', { status }) }) }), { ok: true, action: 'delete' }, String(status));
    }
    assert.deepEqual(await sync({ sql: syncSql({ row: cancelled() }), fetchFn: gFetch({ del: new Response('{}', { status: 500 }) }) }), { ok: false, action: 'delete', reason: 'http_error (500)' });
  });
  test('בוטל בלי external_id (יצירה שאולי הגיעה ל-Google ונפלה לפני השמירה): DELETE לפי המזהה הנגזר (ביקורת 27.10, ממצא 2)', async () => {
    const f = gFetch({ del: new Response('{}', { status: 404 }) });
    assert.deepEqual(await sync({ sql: syncSql({ row: cancelled({ external_id: null }) }), fetchFn: f }), { ok: true, action: 'delete' });
    const [call] = eventCalls(f);
    assert.equal(call.options.method, 'DELETE');
    assert.equal(call.url, eventsEndpoint(PERSONAL_CAL, GOOGLE_ID));
  });
  test('בוטל ונגמר: past, בלי Google', async () => {
    const f = gFetch();
    assert.deepEqual(await sync({ sql: syncSql({ row: cancelled({ ends_at: new Date('2026-10-27T07:00:00.000Z') }) }), fetchFn: f }), { ok: true, action: null, reason: 'past' });
    assert.equal(f.calls.length, 0);
  });
});

describe('8.3-4: אירוע שעבר (קריטריון 6)', () => {
  test('starts_at <= עכשיו: לא נוצר ולא מתעדכן, אפס קריאות', async () => {
    for (const starts of ['2026-10-27T08:00:00.000Z', '2026-10-26T15:00:00.000Z']) {
      const f = gFetch();
      const row = eventRow({ starts_at: new Date(starts), ends_at: new Date('2026-10-27T09:00:00.000Z') });
      assert.deepEqual(await sync({ sql: syncSql({ row }), fetchFn: f }), { ok: true, action: null, reason: 'past' });
      assert.deepEqual(planEventSync({ ...row, external_id: GOOGLE_ID }, NOW.getTime(), { allowPatch: true }), { action: null, reason: 'past' });
      assert.equal(f.calls.length, 0);
    }
  });
  test('planEventSync: טבלת מקרים', () => {
    const nowMs = NOW.getTime();
    assert.deepEqual(planEventSync(undefined, nowMs), { action: null, reason: 'no_event' });
    assert.deepEqual(planEventSync(eventRow(), nowMs), { action: 'create' });
    assert.deepEqual(planEventSync(eventRow({ status: 'done' }), nowMs), { action: null, reason: 'not_planned' });
    assert.deepEqual(planEventSync(eventRow({ id: 'x' }), nowMs), { action: null, reason: 'bad_event_id' });
    assert.deepEqual(planEventSync(eventRow({ starts_at: null }), nowMs), { action: null, reason: 'past' });
  });
  test('eventBody: רק summary, start, end', () => {
    assert.deepEqual(Object.keys(eventBody(eventRow())), ['summary', 'start', 'end']);
  });
});

describe('8.3-4: כשלים של Google לא שוברים (קריטריון 7)', () => {
  test('רשת, timeout, 5xx, invalid_grant ברענון: { ok:false, reason } קצר, בלי לזרוק, השורה לא משתנה', async (t) => {
    captureConsole(t);
    const cases = [
      [{ insert: new Error('socket hang up') }, 'network'],
      [{ insert: timeoutError() }, 'timeout'],
      [{ insert: new Response('{}', { status: 503 }) }, 'http_error (503)'],
      [{ token: jsonResponse({ error: 'invalid_grant' }, 400) }, 'invalid_grant (400)'],
    ];
    for (const [over, reason] of cases) {
      const sql = syncSql();
      const result = await sync({ sql, fetchFn: gFetch(over) });
      assert.equal(result.ok, false, reason);
      assert.equal(result.reason, reason);
      assert.equal(externalUpdates(sql).length, 0);
    }
  });
  test('בלי הגדרות Google: דילוג שקט לפני כל קריאה למסד או לרשת', async (t) => {
    const cap = captureConsole(t);
    const sql = syncSql();
    const f = gFetch();
    assert.deepEqual(await syncEventForSource({ sql, sourceId: SRC_ID, now: NOW, env: {}, fetchFn: f }), { ok: true, action: null, reason: 'config_missing' });
    assert.deepEqual(await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, env: {}, fetchFn: f }), { ok: true, action: null, reason: 'config_missing' });
    assert.equal(sql.calls.length + f.calls.length, 0);
    assert.equal(cap.text(), '');
  });
  test('אין שורת google_credentials: not_connected, דילוג שקט', async (t) => {
    const cap = captureConsole(t);
    const sql = fakeSql((text) => (text.includes('FROM events WHERE match_key =') ? [eventRow()] : []));
    const f = gFetch();
    assert.deepEqual(await sync({ sql, fetchFn: f }), { ok: true, action: null, reason: 'not_connected' });
    assert.equal(f.calls.length, 0);
    assert.equal(cap.text(), '');
  });
  test('המסד זורק: crashed, בלי לזרוק לקורא', async (t) => {
    captureConsole(t);
    const sql = fakeSql(() => { throw new Error(`db down ${TITLE}`); });
    assert.deepEqual(await sync({ sql, fetchFn: gFetch() }), { ok: false, action: null, reason: 'crashed' });
    assert.deepEqual(await syncEventAfterAnswer({ sql, messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: gFetch() }), { ok: false, action: null, reason: 'crashed' });
  });

  // api/intake.js: התשובה זהה עם כתיבה מצליחה, נכשלת או זורקת.
  const intakeSql = () => fakeSql((text) => {
    if (text.startsWith('INSERT INTO sources')) return [{ id: SRC_ID, received_at: NOW }];
    if (text.includes('FROM events WHERE match_key =')) return [eventRow()];
    if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh() }];
    return [];
  });
  const sendIntake = (deps) => intakeHandle(formRequest({ text: 'בדיקה מומצאת היום ב-18:30', channel: 'app' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
    secret: FAKE_SECRET, sendQueue: async () => {}, now: () => NOW, processor: async () => ({ status: 'recorded', reply: 'נרשם · אירוע אישי' }), ...deps,
  });
  test('intake: הקריאה ליומן אחרי processSource, למקור הזה בלבד; כשל / זריקה לא משנים את התשובה', async (t) => {
    captureConsole(t);
    const seen = [];
    const ok = await sendIntake({ sql: intakeSql(), eventSync: async (args) => { seen.push(args); return { ok: true, action: 'create' }; } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].sourceId, SRC_ID);
    assert.equal(seen[0].now.getTime(), NOW.getTime());
    const expected = { status: ok.status, body: await ok.text() };
    assert.deepEqual(expected, { status: 200, body: 'נרשם · אירוע אישי' });
    const variants = [
      async () => { throw new Error(`boom ${TITLE}`); },
      (args) => syncEventForSource({ ...args, config: CONFIG, fetchFn: gFetch({ insert: new Response('{}', { status: 503 }) }) }),
      (args) => syncEventForSource({ ...args, config: CONFIG, fetchFn: gFetch({ insert: timeoutError() }) }),
      (args) => syncEventForSource({ ...args, config: CONFIG, fetchFn: gFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) }),
    ];
    for (const eventSync of variants) {
      const res = await sendIntake({ sql: intakeSql(), eventSync });
      assert.deepEqual({ status: res.status, body: await res.text() }, expected);
    }
  });
  test('intake: עיבוד שלא נרשם (unclassified) לא קורא ליומן', async () => {
    let called = 0;
    await sendIntake({ sql: intakeSql(), processor: async () => ({ status: 'unclassified', reply: 'התקבל' }), eventSync: async () => { called += 1; } });
    assert.equal(called, 0);
  });

  // api/chat.js: תשובת "נכון" לכרטיס האישור (שלב 8.3-1) של אירוע אישי; answerQuestion מחזיר answered.
  const SAVED = [
    { field: 'type', value: 'personal_event', origin: 'read' }, { field: 'date', value: '2026-10-27', origin: 'inferred' },
    { field: 'time', value: '18:30', origin: 'read' }, { field: 'end_time', value: '19:30', origin: 'inferred' }, { field: 'topic', value: TITLE, origin: 'read' },
  ];
  const chatSql = ({ written = [{ closed: 1 }] } = {}) => fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 }];
    if (text.includes('FROM sources WHERE id')) return [{ id: SRC_ID, channel: 'app', raw_content: `${TITLE} היום ב-18:30`, content_hash: 'h', received_at: NOW }];
    if (text.includes('FROM facts WHERE source_id')) return SAVED;
    if (text.startsWith('WITH closed AS')) return written;
    if (text.includes('FROM messages m WHERE m.id')) return [{ source_id: SRC_ID, corrected: false }];
    if (text.includes('FROM events WHERE match_key =')) return [eventRow()];
    if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh() }];
    return [];
  });
  const sendChat = (deps) => chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'נכון' }, {
    url: 'https://x.test/api/chat', headers: { 'x-intake-secret': FAKE_SECRET, 'content-type': 'application/json' },
  }), { secret: FAKE_SECRET, timetable: { slots: [] }, now: () => NOW, ...deps });
  test('chat: הקריאה ליומן אחרי answerQuestion עם מזהה השאלה; כשל / זריקה לא משנים את התשובה', async (t) => {
    captureConsole(t);
    const seen = [];
    const ok = await sendChat({ sql: chatSql(), eventSync: async (args) => { seen.push(args); return { ok: true }; } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].messageId, MSG_ID);
    const expected = { status: ok.status, body: await ok.text() };
    assert.equal(expected.status, 200);
    assert.equal(JSON.parse(expected.body).status, 'answered');
    const variants = [
      async () => { throw new Error(`boom ${TITLE}`); },
      (args) => syncEventAfterAnswer({ ...args, config: CONFIG, fetchFn: gFetch({ insert: new Error('network down') }) }),
      (args) => syncEventAfterAnswer({ ...args, config: CONFIG, fetchFn: gFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }) }),
    ];
    for (const eventSync of variants) {
      const res = await sendChat({ sql: chatSql(), eventSync });
      assert.deepEqual({ status: res.status, body: await res.text() }, expected);
    }
  });
  test('chat: שאלה שכבר נסגרה (closed) לא קוראת ליומן', async () => {
    let called = 0;
    await sendChat({ sql: chatSql({ written: [{ closed: 0 }] }), eventSync: async () => { called += 1; } });
    assert.equal(called, 0);
  });
});

describe('8.3-4: הסריקה היומית (קריטריונים 7, 8)', () => {
  const missed = eventRow(); // אירוע שהכתיבה המיידית שלו נכשלה: planned, external_id ריק
  const cancelledRow = eventRow({ id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', status: 'cancelled', external_id: 'cccccccc', domain: 'school' });
  test('יוצרת את מה שחסר ומוחקת את מה שבוטל; ספירות בלבד', async () => {
    const sql = syncSql({ sweepRows: [missed, cancelledRow] });
    const f = gFetch();
    const result = await sweepEventSync({ sql, config: CONFIG, fetchFn: f, nowMs: NOW.getTime() });
    assert.deepEqual(result, { created: 1, deleted: 1, failed: 0, skipped: 0 });
    assert.deepEqual(eventCalls(f).map((c) => c.options.method), ['POST', 'DELETE']);
    assert.equal(eventCalls(f)[1].url, eventsEndpoint(SCHOOL_CAL, 'cccccccc'));
    assert.deepEqual(externalUpdates(sql)[0].values, [GOOGLE_ID, EVENT_ID]);
  });
  test('השאילתה: רק source:, רק התחומים שבטבלה, planned בלי external_id שעוד לא התחיל, cancelled שעוד לא נגמר (גם בלי external_id)', async () => {
    const sql = syncSql();
    await sweepEventSync({ sql, config: CONFIG, fetchFn: gFetch(), nowMs: NOW.getTime() });
    const [query] = sql.find("WHERE match_key LIKE 'source:%'");
    assert.match(query.text, /status = 'planned' AND external_id IS NULL AND starts_at > \?::timestamptz/);
    assert.match(query.text, /status = 'cancelled' AND ends_at > \?::timestamptz/);
    assert.deepEqual(query.values, [JSON.stringify(['personal', 'school']), NOW.toISOString(), NOW.toISOString()]);
  });
  test('לא מעדכנת (PATCH) אירוע קיים, ולא נוגעת בשורות שאינן לטיפול', async () => {
    const f = gFetch();
    const rows = [eventRow({ external_id: GOOGLE_ID }), eventRow({ domain: 'running' }), eventRow({ starts_at: new Date('2026-10-26T10:00:00.000Z') })];
    const result = await sweepEventSync({ sql: syncSql({ sweepRows: rows }), config: CONFIG, fetchFn: f, nowMs: NOW.getTime() });
    assert.deepEqual(result, { created: 0, deleted: 0, failed: 0, skipped: 3 });
    assert.equal(f.calls.length, 0, 'בלי שורות לטיפול: אפס קריאות, גם לא רענון token');
  });
  test('כשל בחיבור: כל השורות נספרות failed עם reason קצר; כשל בשורה אחת לא עוצר את השנייה', async (t) => {
    captureConsole(t);
    const a = await sweepEventSync({ sql: syncSql({ sweepRows: [missed] }), config: CONFIG, fetchFn: gFetch({ token: jsonResponse({ error: 'invalid_grant' }, 400) }), nowMs: NOW.getTime() });
    assert.deepEqual(a, { created: 0, deleted: 0, failed: 1, skipped: 0, reason: 'invalid_grant (400)' });
    const b = await sweepEventSync({ sql: syncSql({ sweepRows: [missed, cancelledRow] }), config: CONFIG, fetchFn: gFetch({ insert: new Response('{}', { status: 500 }) }), nowMs: NOW.getTime() });
    assert.deepEqual(b, { created: 0, deleted: 1, failed: 1, skipped: 0, last_failure: 'http_error (500)' });
  });

  // daily-check: הכתיבה המיידית נכשלה, והסריקה של 07:30 יוצרת את האירוע. שורת probe_log אחת, בלי כותרת, שעות, מזהים או tokens.
  const SECRET = 'test-cron-secret';
  function dcSql(sweepRows) {
    const logs = [];
    const sql = fakeSql((text, values) => {
      if (text.includes('INSERT INTO probe_log')) { logs.push({ probe: values[0], ok: values[1], detail: values[2] }); return []; }
      if (text.includes("WHERE match_key LIKE 'source:%'")) return sweepRows;
      if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh(), obtained_at: '2026-10-20T08:00:00.000Z' }];
      if (text.startsWith('SELECT id, calendar_id')) return [];
      if (text.includes('FROM google_watch_channels')) return [{ active: 0, earliest_expiration: null, last_notification_at: null, total_notifications: 0 }];
      if (text.includes('LEFT JOIN intake_outcomes')) return [{ recorded: 0, unclassified: 0, duplicate: 0, failed: 0, no_outcome: 0 }];
      return [];
    });
    sql.logs = logs;
    return sql;
  }
  const runDaily = (sql, fetchImpl) => dailyHandle(new Request('https://x.test/api/daily-check', { headers: { authorization: `Bearer ${SECRET}` } }), {
    sql, secret: SECRET, config: CONFIG, fetchImpl, now: () => NOW, makeChannelId: () => 'dc',
  });
  test('daily-check: הכתיבה המיידית נכשלה, הסריקה יוצרת; שורה אחת google-event-sync-daily', async (t) => {
    const cap = captureConsole(t);
    // הנתיב המיידי נכשל (timeout): השורה נשארת עם external_id ריק
    const immediateSql = syncSql();
    assert.equal((await sync({ sql: immediateSql, fetchFn: gFetch({ insert: timeoutError() }) })).reason, 'timeout');
    assert.equal(externalUpdates(immediateSql).length, 0);
    // הסריקה של הבוקר
    const sql = dcSql([missed]);
    const f = gFetch();
    const res = await runDaily(sql, f);
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(body.google_event_sync, { ok: true, created: 1, deleted: 0, failed: 0, skipped: 0, logged: true });
    const rows = sql.logs.filter((l) => l.probe === 'google-event-sync-daily');
    assert.deepEqual(rows, [{ probe: 'google-event-sync-daily', ok: true, detail: 'created=1 deleted=0 failed=0 skipped=0' }]);
    assert.equal(eventCalls(f).length, 1);
    assert.deepEqual(externalUpdates(sql)[0].values, [GOOGLE_ID, EVENT_ID]);
    const all = text + JSON.stringify(sql.logs) + cap.text();
    assertNoSecrets(assert, all, [TITLE, EVENT_ID, GOOGLE_ID, PERSONAL_CAL, SCHOOL_CAL, '15:30', '18:30']);
  });
  test('daily-check: כשל Google בסריקה = ok=false, קוד קצר בלבד, בלי סודות / כותרת / מזהים', async (t) => {
    const cap = captureConsole(t);
    const sql = dcSql([missed]);
    const f = gFetch({ insert: jsonResponse({ error: { message: `quota ${TITLE} ${PERSONAL_CAL}` } }, 403) });
    const text = await (await runDaily(sql, f)).text();
    const row = sql.logs.find((l) => l.probe === 'google-event-sync-daily');
    assert.deepEqual(row, { probe: 'google-event-sync-daily', ok: false, detail: 'created=0 deleted=0 failed=1 skipped=0 last_failure=http_error (403)' });
    assertNoSecrets(assert, text + JSON.stringify(sql.logs) + cap.text(), [TITLE, EVENT_ID, GOOGLE_ID, PERSONAL_CAL, SCHOOL_CAL, 'quota']);
  });
});

describe('8.3-4: פרטיות בנתיב המיידי (קריטריון 8)', () => {
  test('כשלים מדפיסים קודים בלבד: בלי token, כותרת, מזהים או טקסט מ-Google', async (t) => {
    const cap = captureConsole(t);
    const leaky = jsonResponse({ error: { message: `bad ${TITLE} ${ACCESS_TOKEN}` } }, 400);
    const results = [
      await sync({ sql: syncSql(), fetchFn: gFetch({ insert: leaky }) }),
      await sync({ sql: syncSql({ failUpdate: true }), fetchFn: gFetch() }),
      await sync({ sql: syncSql({ row: eventRow({ external_id: GOOGLE_ID, status: 'cancelled' }) }), fetchFn: gFetch({ del: new Response(`gone ${TITLE}`, { status: 500 }) }) }),
      await syncEventAfterAnswer({ sql: syncSql({ row: eventRow({ external_id: GOOGLE_ID }), answerRow: { source_id: SRC_ID, corrected: true } }), messageId: MSG_ID, now: NOW, config: CONFIG, fetchFn: gFetch({ token: jsonResponse({ error: 'invalid_grant', error_description: TITLE }, 400) }) }),
    ];
    assertNoSecrets(assert, cap.text() + JSON.stringify(results), [TITLE, EVENT_ID, GOOGLE_ID, PERSONAL_CAL, 'bad']);
  });
});

describe('lib/google: insert / patch / delete של אירוע', () => {
  const f = (response) => fakeFetch(() => (response instanceof Error ? (() => { throw response; })() : response));
  test('eventsEndpoint: מקודד את מזהה היומן והאירוע', () => {
    assert.equal(eventsEndpoint('a b@x'), 'https://www.googleapis.com/calendar/v3/calendars/a%20b%40x/events');
    assert.equal(eventsEndpoint('c', 'e1'), 'https://www.googleapis.com/calendar/v3/calendars/c/events/e1');
  });
  test('insert: 200 = { ok, existed:false }; 409 = { ok, existed:true }; 401 = כשל עם status', async () => {
    assert.deepEqual(await insertCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e1234', event: {}, fetchFn: f(jsonResponse({})) }), { ok: true, existed: false });
    assert.deepEqual(await insertCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e1234', event: {}, fetchFn: f(jsonResponse({}, 409)) }), { ok: true, existed: true });
    assert.deepEqual(await insertCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e1234', event: {}, fetchFn: f(jsonResponse({ error: 'unauthorized_client' }, 401)) }), { ok: false, reason: 'unauthorized_client', status: 401 });
  });
  test('patch: 200 = ok; 404 = כשל (האירוע לא נמצא)', async () => {
    assert.deepEqual(await patchCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', patch: {}, fetchFn: f(jsonResponse({})) }), { ok: true });
    assert.deepEqual(await patchCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', patch: {}, fetchFn: f(jsonResponse({}, 404)) }), { ok: false, reason: 'http_error', status: 404 });
  });
  test('delete: 204 / 404 / 410 = ok, בלי גוף בבקשה; timeout ורשת = קוד', async () => {
    const fetchFn = f(new Response(null, { status: 204 }));
    assert.deepEqual(await deleteCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', fetchFn }), { ok: true, gone: false });
    assert.equal(fetchFn.calls[0].options.body, undefined);
    assert.equal(fetchFn.calls[0].options.headers['content-type'], undefined);
    for (const status of [404, 410]) assert.deepEqual(await deleteCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', fetchFn: f(new Response('', { status })) }), { ok: true, gone: true });
    assert.deepEqual(await deleteCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', fetchFn: f(timeoutError()) }), { ok: false, reason: 'timeout', status: null });
    assert.deepEqual(await deleteCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', fetchFn: f(new Error('x')) }), { ok: false, reason: 'network', status: null });
  });
  test('כל קריאה נשלחת עם signal (timeout)', async () => {
    const fetchFn = f(jsonResponse({}));
    await patchCalendarEvent({ accessToken: 'a', calendarId: 'c', eventId: 'e', patch: {}, fetchFn });
    assert.ok(fetchFn.calls[0].options.signal instanceof AbortSignal);
  });
});
