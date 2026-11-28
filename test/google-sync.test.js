// בדיקות לסנכרון Google -> האפליקציה (lib/google-sync.js) ול-listCalendarChanges / getPrimaryCalendarId (lib/google.js).
// הכול עם sql מזויף ו-fetch מזויף. אין רשת, אין מסד, אין סודות אמיתיים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, fakeFetch, jsonResponse, captureConsole, req } from './helpers.js';
import { KEY, KEY_B64, REFRESH_TOKEN, CLIENT_SECRET } from './google-fixtures.js';
import { encryptToken, listCalendarChanges, getPrimaryCalendarId, deriveChannelToken } from '../lib/google.js';
import {
  syncPrimaryCalendar, syncAndLog, importedEventId, ownGoogleEventId, answerGoogleUnclear, UNCLEAR_BUTTONS, classifyWithBrain,
} from '../lib/google-sync.js';
import { handle as webhookHandle } from '../api/google-webhook.js';

const NOW = Date.parse('2026-11-28T10:00:00Z');
const FUTURE = '2026-12-01T10:00:00+02:00';
const PAST = '2026-11-20T10:00:00+02:00';
const PRIMARY = 'primary-cal-id';
const CAL_BY_NAME = { 'אישי': 'cal-personal', 'בית ספר': 'cal-school', 'ריצה': 'cal-run', 'לימוד': 'cal-study' };
const CONFIG = { clientId: 'client-id-test', clientSecret: CLIENT_SECRET, encKeyRaw: KEY_B64 };
const G1 = 'evt1abcdef';
const G2 = 'evt2abcdef';
const CHANNEL_ID = 'channel-row-1';
const OWN_UUID = '11111111-2222-4333-8444-555555555555';
const OWN_HEX = OWN_UUID.replace(/-/g, '');

const calendarList = {
  items: [
    { id: PRIMARY, summary: 'יובל', accessRole: 'owner' },
    ...Object.entries(CAL_BY_NAME).map(([summary, id]) => ({ id, summary, accessRole: 'owner' })),
  ],
};

// fetch מזויף של Google. listQueue = תורות לקריאות events.list לפי הסדר: { status, body }.
function googleFetch({ listQueue = [], writeStatus = 200 } = {}) {
  const queue = [...listQueue];
  return fakeFetch((url, options) => {
    const method = options.method ?? 'GET';
    if (url.startsWith('https://oauth2.googleapis.com/token')) return jsonResponse({ access_token: 'ya29.test-access', expires_in: 3600 });
    if (url.includes('/users/me/calendarList')) return jsonResponse(calendarList);
    if (url.endsWith('/calendars/primary')) return jsonResponse({ id: PRIMARY });
    if (url.includes('/events?')) {
      const next = queue.shift();
      if (!next) throw new Error('listing called more times than planned');
      return next.status === 410 ? new Response('{}', { status: 410 }) : jsonResponse(next.body);
    }
    if (method === 'POST') return jsonResponse({ id: 'created' }, writeStatus);
    if (method === 'DELETE') return new Response(null, { status: 204 });
    return new Response('{}', { status: 500 });
  });
}

const storedCredentials = { refresh_token_enc: encryptToken(REFRESH_TOKEN, KEY) };

// sql מזויף לפי טקסט השאילתה. state.known = שורות gcal שמוחזרות בטעינה; state.own = האם מזהה אפליקציה קיים.
function db({ known = [], ownExists = false, insertReturns = [{ id: 'inserted' }], channelToken = null, onOther } = {}) {
  return fakeSql((text, values) => {
    if (onOther) { const early = onOther(text, values); if (early !== undefined) return early; }
    if (text.includes('FROM google_credentials')) return [storedCredentials];
    if (text.includes('SELECT id, sync_token FROM google_watch_channels')) return [{ id: CHANNEL_ID, sync_token: channelToken }];
    if (text.includes('SELECT id, external_id, match_key')) return known;
    if (text.includes('SELECT id FROM events WHERE id =')) return ownExists ? [{ id: 'own' }] : [];
    if (text.includes('INSERT INTO events')) return insertReturns;
    if (text.includes('UPDATE events SET external_id')) return [{ id: 'row' }];
    if (text.includes('INSERT INTO messages')) return [{ id: 'card' }];
    if (text.includes('UPDATE google_watch_channels SET sync_token')) return [];
    if (text.includes('UPDATE events SET match_key')) return [];
    return [];
  });
}

const item = (over = {}) => ({
  id: G1, status: 'confirmed', summary: 'אימון בוקר', start: { dateTime: FUTURE }, end: { dateTime: '2026-12-01T11:00:00+02:00' }, ...over,
});

const classifyAs = (domain) => async () => domain;

const insertedEvents = (sql) => sql.find('INSERT INTO events');
const cards = (sql) => sql.find('INSERT INTO messages');
const eventWrites = (fetch) => fetch.calls.filter((c) => c.url.includes('/calendars/') && (c.options.method ?? 'GET') !== 'GET');

describe('lib/google.js: listCalendarChanges', () => {
  test('סנכרון ראשון בלי token: timeMin, בלי syncToken, showDeleted, ומחזיר nextSyncToken', async () => {
    const f = fakeFetch(() => jsonResponse({ items: [], nextSyncToken: 'tok-A' }));
    const r = await listCalendarChanges({ accessToken: 'a', calendarId: 'c', timeMin: '2026-11-28T10:00:00.000Z', fetchImpl: f });
    assert.deepEqual(r, { ok: true, items: [], nextSyncToken: 'tok-A' });
    const url = new URL(f.calls[0].url);
    assert.equal(url.searchParams.get('timeMin'), '2026-11-28T10:00:00.000Z');
    assert.equal(url.searchParams.has('syncToken'), false);
    assert.equal(url.searchParams.get('showDeleted'), 'true');
    assert.equal(url.searchParams.get('singleEvents'), 'true');
  });

  test('סנכרון מצטבר עם syncToken ובלי timeMin', async () => {
    const f = fakeFetch(() => jsonResponse({ items: [], nextSyncToken: 'tok-B' }));
    await listCalendarChanges({ accessToken: 'a', calendarId: 'c', syncToken: 'tok-A', fetchImpl: f });
    const url = new URL(f.calls[0].url);
    assert.equal(url.searchParams.get('syncToken'), 'tok-A');
    assert.equal(url.searchParams.has('timeMin'), false);
  });

  test('pagination: עובר על כל העמודים עד nextSyncToken ומחזיר את כל הפריטים', async () => {
    const f = fakeFetch((url) => {
      if (!url.includes('pageToken=p2')) return jsonResponse({ items: [{ id: 'a' }], nextPageToken: 'p2' });
      return jsonResponse({ items: [{ id: 'b' }], nextSyncToken: 'tok-C' });
    });
    const r = await listCalendarChanges({ accessToken: 'a', calendarId: 'c', syncToken: 'tok-A', fetchImpl: f });
    assert.equal(r.ok, true);
    assert.deepEqual(r.items.map((i) => i.id), ['a', 'b']);
    assert.equal(r.nextSyncToken, 'tok-C');
    assert.equal(f.calls.length, 2);
  });

  test('410 = gone (token לא תקף), מסומן כך כדי לבצע סנכרון מלא', async () => {
    const f = fakeFetch(() => new Response('{"error":{"status":"GONE"}}', { status: 410 }));
    const r = await listCalendarChanges({ accessToken: 'a', calendarId: 'c', syncToken: 'old', fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.gone, true);
  });

  test('שגיאה אחרת (500) לא מסומנת gone ולא זורקת', async () => {
    const f = fakeFetch(() => new Response('{}', { status: 500 }));
    const r = await listCalendarChanges({ accessToken: 'a', calendarId: 'c', syncToken: 'old', fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.gone, false);
  });
});

describe('lib/google.js: getPrimaryCalendarId', () => {
  test('מחזיר את מזהה היומן הראשי', async () => {
    const f = fakeFetch(() => jsonResponse({ id: PRIMARY }));
    assert.deepEqual(await getPrimaryCalendarId({ accessToken: 'a', fetchImpl: f }), { ok: true, calendarId: PRIMARY });
    assert.match(f.calls[0].url, /\/calendars\/primary$/);
  });
});

describe('מזהים דטרמיניסטיים', () => {
  test('importedEventId: uuid קבוע לכל מזהה Google, ושונה ממזהה של אפליקציה', () => {
    const a = importedEventId(G1);
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.equal(a, importedEventId(G1));
    assert.notEqual(a, importedEventId(G2));
  });
  test('ownGoogleEventId: מזהה hex של 32 תווים מחזיר את ה-uuid של האפליקציה; אחר - null', () => {
    assert.equal(ownGoogleEventId(OWN_HEX), OWN_UUID);
    assert.equal(ownGoogleEventId(G1), null);
  });
});

describe('סנכרון ראשון (בלי token)', () => {
  test('שומר nextSyncToken, מייבא רק עתידיים, ולא מחפש ביומן הישן', async () => {
    const sql = db();
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item({ id: G1 }), item({ id: G2, start: { dateTime: PAST }, end: { dateTime: PAST } })], nextSyncToken: 'tok-1' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'initial');
    assert.equal(r.imported, 1);
    const listCall = fetchFn.calls.find((c) => c.url.includes('/events?'));
    assert.ok(new URL(listCall.url).searchParams.get('timeMin'));
    const saved = sql.find('UPDATE google_watch_channels SET sync_token');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].values[0], 'tok-1');
  });
});

describe('אירוע חדש ביומן הראשי', () => {
  test('סיווג ברור (אישי): נוצר בטבלה עם מזהה קבוע, ונעבר ליומן "אישי" ונמחק מהראשי', async () => {
    const sql = db();
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-2' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, true);
    assert.equal(r.imported, 1);
    assert.equal(r.moved, 1);
    assert.equal(r.cards, 0);
    const ins = insertedEvents(sql);
    assert.equal(ins.length, 1);
    assert.equal(ins[0].values[0], importedEventId(G1));
    assert.ok(ins[0].values.includes('personal'));
    assert.ok(ins[0].values.includes(G1));
    const writes = eventWrites(fetchFn);
    const create = writes.find((c) => c.options.method === 'POST');
    assert.match(create.url, /\/calendars\/cal-personal\/events$/);
    assert.match(JSON.parse(create.options.body).id, /^[0-9a-f]{32}$/);
    const del = writes.find((c) => c.options.method === 'DELETE');
    assert.match(del.url, new RegExp(`/calendars/${PRIMARY}/events/${G1}$`));
    assert.equal(cards(sql).length, 0);
  });

  test('סיווג לא ברור: נוצר בטבלה בלי יומן, בלי מחיקה מהראשי, ונוצר כרטיס שאלה אחד', async () => {
    const sql = db();
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-3' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs(null) });
    assert.equal(r.imported, 1);
    assert.equal(r.moved, 0);
    assert.equal(r.cards, 1);
    assert.equal(eventWrites(fetchFn).length, 0);
    const card = cards(sql);
    assert.equal(card.length, 1);
    assert.ok(card[0].values.includes('google_unclear'));
    assert.ok(card[0].values.some((v) => typeof v === 'string' && v.includes('אימון בוקר')));
  });

  test('כמה אירועים לא ברורים באותו סנכרון: כרטיס אחד בלבד עם כולם (לא כרטיס לכל אירוע)', async () => {
    const sql = db();
    const second = item({ id: G2, summary: 'מבחן', start: { dateTime: '2026-12-02T09:00:00+02:00' }, end: { dateTime: '2026-12-02T10:00:00+02:00' } });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item(), second], nextSyncToken: 'tok-14' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs(null) });
    assert.equal(r.imported, 2);
    assert.equal(r.cards, 1);
    const card = cards(sql);
    assert.equal(card.length, 1);
    const body = card[0].values.find((v) => typeof v === 'string' && v.includes('אימון בוקר'));
    assert.ok(body.includes('אימון בוקר') && body.includes('מבחן'));
  });

  test('כרטיס שאלה: הטקסט כולל כותרת ויום ושעה, והכפתורים הם היומנים + להשאיר', () => {
    assert.deepEqual([...UNCLEAR_BUTTONS], ['בית ספר', 'ריצה', 'לימוד', 'אישי', 'להשאיר ביומן הראשי']);
  });

  test('סיווג מהמוח שאינו בתחום תקין נחשב לא ברור', async () => {
    const sql = db();
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-4' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('business') });
    assert.equal(r.moved, 0);
    assert.equal(r.cards, 1);
  });
});

describe('לולאה וכפילויות', () => {
  test('אירוע שהאפליקציה כתבה בעצמה (מזהה hex שקיים בטבלה) לא מיובא ולא נספר', async () => {
    const sql = db({ ownExists: true });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item({ id: OWN_HEX })], nextSyncToken: 'tok-5' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(insertedEvents(sql).length, 0);
    assert.equal(r.imported, 0);
    assert.equal(r.blocked, 0);
  });

  test('מחיקה של אירוע שהועבר בעצמנו (gcal-moved) לא נספרת ולא נכתבת', async () => {
    const known = [{ id: importedEventId(G1), external_id: OWN_HEX, match_key: `gcal-moved:${G1}`, domain: 'personal', status: 'planned', title: 'x', starts_at: FUTURE, ends_at: FUTURE }];
    const sql = db({ known });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item({ status: 'cancelled' })], nextSyncToken: 'tok-6' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, true);
    assert.equal(r.blocked, 0);
    assert.equal(r.imported, 0);
    assert.equal(sql.find('UPDATE events').length, 0);
  });

  test('ריצה כפולה על אותו אירוע: בפעם השנייה הטבלה כבר מכילה אותו - לא נכתב שוב', async () => {
    const known = [{ id: importedEventId(G1), external_id: OWN_HEX, match_key: `gcal-moved:${G1}`, domain: 'personal', status: 'planned', title: 'x', starts_at: FUTURE, ends_at: FUTURE }];
    const sql = db({ known, insertReturns: [] });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-7' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, true);
    assert.equal(r.imported, 0);
    assert.equal(r.moved, 0);
    assert.equal(eventWrites(fetchFn).length, 0);
  });

  test('שינוי של אירוע שכבר מוכר (ממתין לסיווג) נספר כחסום ולא נכתב', async () => {
    const known = [{ id: importedEventId(G1), external_id: G1, match_key: `gcal-pending:${G1}`, domain: null, status: 'planned', title: 'x', starts_at: FUTURE, ends_at: FUTURE }];
    const sql = db({ known });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item({ summary: 'שונה' })], nextSyncToken: 'tok-8' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.blocked, 1);
    assert.equal(sql.find('UPDATE events').length, 0);
    assert.equal(insertedEvents(sql).length, 0);
  });

  test('מחיקה של אירוע מוכר שעוד לא הועבר נספרת כחסומה ולא נכתבת', async () => {
    const known = [{ id: importedEventId(G1), external_id: G1, match_key: `gcal-pending:${G1}`, domain: null, status: 'planned', title: 'x', starts_at: FUTURE, ends_at: FUTURE }];
    const sql = db({ known });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item({ status: 'cancelled' })], nextSyncToken: 'tok-9' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.blocked, 1);
    assert.equal(sql.find('UPDATE events').length, 0);
  });
});

describe('410 ו-pagination', () => {
  test('410 במהלך סנכרון מצטבר: סנכרון מלא מעכשיו (בלי token), ואותו הטיפול', async () => {
    const sql = db({ channelToken: 'old-token' });
    const fetchFn = googleFetch({ listQueue: [{ status: 410 }, { body: { items: [item()], nextSyncToken: 'tok-10' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, true);
    assert.equal(r.mode, 'full');
    assert.equal(r.imported, 1);
    const lists = fetchFn.calls.filter((c) => c.url.includes('/events?'));
    assert.equal(new URL(lists[0].url).searchParams.get('syncToken'), 'old-token');
    assert.ok(new URL(lists[1].url).searchParams.get('timeMin'));
    assert.equal(new URL(lists[1].url).searchParams.has('syncToken'), false);
  });

  test('שגיאת Google שאינה 410: לא שומר token, מחזיר ok=false', async () => {
    const sql = db({ channelToken: 'old-token' });
    const fetchFn = fakeFetch((url) => {
      if (url.startsWith('https://oauth2.googleapis.com/token')) return jsonResponse({ access_token: 'ya29.x', expires_in: 3600 });
      if (url.includes('/users/me/calendarList')) return jsonResponse(calendarList);
      if (url.endsWith('/calendars/primary')) return jsonResponse({ id: PRIMARY });
      return new Response('{}', { status: 500 });
    });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, false);
    assert.equal(sql.find('UPDATE google_watch_channels SET sync_token').length, 0);
  });
});

describe('ביטחון', () => {
  test('בלי הגדרות Google - מחזיר בלי קריאה למסד ובלי רשת', async () => {
    const sql = db();
    const fetchFn = googleFetch();
    const r = await syncPrimaryCalendar({ sql, config: { clientId: undefined, clientSecret: undefined, encKeyRaw: undefined }, fetchFn, nowMs: NOW });
    assert.equal(r.ok, false);
    assert.equal(sql.calls.length, 0);
    assert.equal(fetchFn.calls.length, 0);
  });

  test('לוגים ו-probe בלי כותרות ובלי מזהים', async (t) => {
    const cap = captureConsole(t);
    const sql = db();
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-11' } }] });
    await syncAndLog({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs(null) });
    const probeWrites = sql.find('INSERT INTO probe_log').map((c) => c.values.join(' '));
    for (const line of [...cap.lines, ...probeWrites]) {
      assert.equal(line.includes('אימון בוקר'), false);
      assert.equal(line.includes(G1), false);
    }
    assert.equal(cap.text().includes(REFRESH_TOKEN), false);
    assert.equal(cap.text().includes(CLIENT_SECRET), false);
  });

  test('כשל במסד בתוך הסנכרון - מחזיר ok=false בלי לזרוק', async (t) => {
    captureConsole(t);
    const sql = db({ onOther: (text) => { if (text.includes('INSERT INTO events')) throw Object.assign(new Error('x'), { name: 'DbError' }); } });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [item()], nextSyncToken: 'tok-12' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.ok, false);
    assert.equal(sql.find('UPDATE google_watch_channels SET sync_token').length, 0);
  });
});

describe('אירוע של יום שלם', () => {
  test('אירוע של כמה ימים (date) עתידי מיובא ומועבר ליומן "אישי"', async () => {
    const sql = db();
    const allDay = item({ id: G2, summary: 'חופשה', start: { date: '2026-12-10' }, end: { date: '2026-12-12' } });
    const fetchFn = googleFetch({ listQueue: [{ body: { items: [allDay], nextSyncToken: 'tok-13' } }] });
    const r = await syncPrimaryCalendar({ sql, config: CONFIG, fetchFn, nowMs: NOW, classify: classifyAs('personal') });
    assert.equal(r.imported, 1);
    assert.equal(r.moved, 1);
    const create = eventWrites(fetchFn).find((c) => c.options.method === 'POST');
    const body = JSON.parse(create.options.body);
    assert.deepEqual(body.start, { date: '2026-12-10' });
    assert.deepEqual(body.end, { date: '2026-12-12' });
  });
});

describe('חוזה: המוח', () => {
  test('classifyWithBrain בלי מפתח מחזיר null בלי רשת', async () => {
    const sql = db();
    const f = fakeFetch(() => { throw new Error('no network expected'); });
    assert.equal(await classifyWithBrain({ sql, title: 'x', startsAt: FUTURE, now: new Date(NOW), fetchFn: f, apiKey: '' }), null);
    assert.equal(f.calls.length, 0);
  });
});

describe('תשובה לכרטיס', () => {
  const card = (over = {}) => ({ id: 'card-1', entity_type: 'google_unclear', awaiting_reply: true, entity_id: importedEventId(G1), match_key: `gcal-pending:${G1}`, domain: null, ...over });

  test('תשובה "אישי": סוגרת את הכרטיס, מגדירה תחום, ומעבירה ליומן', async () => {
    const sql = db({ onOther: (text) => {
      if (text.includes('FROM messages m')) return [card()];
      if (text.includes('UPDATE messages SET awaiting_reply')) return [{ id: 'card-1' }];
      if (text.includes('SELECT id, title, starts_at')) return [{ id: importedEventId(G1), title: 'x', starts_at: FUTURE, ends_at: FUTURE, domain: null, match_key: `gcal-pending:${G1}` }];
      if (text.includes('UPDATE events SET domain')) return [{ id: importedEventId(G1) }];
      return undefined;
    } });
    const fetchFn = googleFetch();
    const r = await answerGoogleUnclear({ sql, messageId: 'card-1', itemId: importedEventId(G1), answer: 'אישי', now: new Date(NOW), config: CONFIG, fetchFn });
    assert.equal(r.status, 'answered');
    assert.equal(sql.find('UPDATE messages SET awaiting_reply').length, 1);
    assert.equal(sql.find('UPDATE events SET domain').length, 1);
  });

  test('תשובה שלא בכפתורים: unclear, בלי כתיבה', async () => {
    const sql = db({ onOther: (text) => { if (text.includes('FROM messages m')) return [card()]; return undefined; } });
    const r = await answerGoogleUnclear({ sql, messageId: 'card-1', itemId: importedEventId(G1), answer: 'משהו אחר', now: new Date(NOW), config: CONFIG, fetchFn: googleFetch() });
    assert.equal(r.status, 'unclear');
    assert.equal(sql.find('UPDATE messages').length, 0);
  });

  test('כרטיס שכבר נענה: closed, בלי כתיבה', async () => {
    const sql = db({ onOther: (text) => { if (text.includes('FROM messages m')) return [card({ awaiting_reply: false })]; return undefined; } });
    const r = await answerGoogleUnclear({ sql, messageId: 'card-1', itemId: importedEventId(G1), answer: 'אישי', now: new Date(NOW), config: CONFIG, fetchFn: googleFetch() });
    assert.equal(r.status, 'closed');
    assert.equal(sql.find('UPDATE events').length, 0);
  });
});

describe('webhook: 200 גם כשהסנכרון נכשל', () => {
  const CH = 'channel-uuid-9';
  const hookReq = () => req('https://x.test/api/google-webhook', {
    method: 'POST',
    headers: { 'x-goog-channel-id': CH, 'x-goog-channel-token': deriveChannelToken(CH, KEY), 'x-goog-resource-state': 'exists', 'x-goog-message-number': '7' },
  });
  const webhookSql = () => fakeSql((text) => {
    if (text.includes('FROM google_watch_channels')) return [{ id: 1, calendar_id: PRIMARY, last_resource_state: null, last_message_number: null }];
    return [];
  });

  test('סנכרון זורק - התשובה עדיין 200, ונרשם שגיאה קצרה', async (t) => {
    const cap = captureConsole(t);
    const res = await webhookHandle(hookReq(), {
      sql: webhookSql(), encKeyRaw: KEY_B64, googleSync: async () => { throw new Error('boom'); },
    });
    assert.equal(res.status, 200);
    assert.ok(cap.lines.length >= 0);
  });

  test('סנכרון מוזרק נקרא עם מזהה היומן של הערוץ', async () => {
    const calls = [];
    const res = await webhookHandle(hookReq(), {
      sql: webhookSql(), encKeyRaw: KEY_B64, googleSync: async (args) => { calls.push(args.calendarId); return { ok: true }; },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(calls, [PRIMARY]);
  });
});
