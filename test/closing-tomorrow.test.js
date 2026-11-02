// בדיקות ל"מחר" המלא בהודעת הסגירה של 21:00 (שלב C-3, docs/08-chapter8/90 E3 המעודכן, בקשת יובל 29.10.2026).
// כולל: lib/closing-view.js (composeClosing, DETAIL_DELIMITER), lib/closing-tomorrow.js (טעינת events ו-Google), lib/training-source.js, והחיבור ב-api/queues/deliver.js.
// הכול מומצא ורץ בזיכרון: אין רשת, אין סודות אמיתיים, ולא נבדקה קריאה מול Google חי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeClosing, DETAIL_DELIMITER, QUIET_EVENING_LINE, timedItemLines, closingPushText } from '../lib/closing-view.js';
import { dayRange, loadTomorrowEvents, loadGoogleTomorrow, cleanTitle } from '../lib/closing-tomorrow.js';
import { loadTrainingsForDate } from '../lib/training-source.js';
import { listCalendarEvents, TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT, eventsEndpoint } from '../lib/google.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, fakeFetch, jsonResponse, timeoutError, captureConsole, FAKE_CRON } from './helpers.js';
import { CONFIG, ACCESS_TOKEN, encRefresh, assertNoSecrets } from './google-fixtures.js';

const D = DETAIL_DELIMITER;
const TODAY = '2026-10-27'; // שלישי
const TOMORROW = '2026-10-28'; // רביעי = slot.weekday 4
const FRIDAY = '2026-10-30';
const slot = (period, startsAt, endsAt, subject, over = {}) => ({ weekday: 4, period, startsAt, endsAt, subject, teacher: 'מורה-מומצא-א', room: 'חדר-מומצא-7', ...over });
const TIMETABLE = { slots: [slot(1, '08:15', '09:00', 'מתמטיקה'), slot(3, '10:05', '10:50', 'אנגלית'), slot(2, '09:05', '09:50', 'היסטוריה'), slot(7, '13:30', '14:15', 'ספורט'), { ...slot(1, '08:15', '09:00', 'מתמטיקה'), weekday: 1 }] };
const SCHOOL_LINE = 'מחר: ⁦08:15–14:15⁩ · 4 שיעורים';
const at = (hh, mm) => `2026-10-28T${hh}:${mm}:00+02:00`; // 28.10.2026 אחרי מעבר השעון: UTC+2

describe('C-3: composeClosing, בית ספר של מחר ובלוק הפירוט', () => {
  test('DETAIL_DELIMITER הוא U+2063 בלבד', () => {
    assert.equal(DETAIL_DELIMITER, '⁣');
    assert.equal(DETAIL_DELIMITER.length, 1);
  });
  test('שורת תמצית, ואז שני תוחמים סביב שורה לכל שיעור (מקצוע · שעה) לפי שעה; אין מורה ואין חדר', () => {
    const out = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], timetable: TIMETABLE });
    assert.equal(out.text, [
      'סגירה · יום שלישי 27.10',
      QUIET_EVENING_LINE,
      SCHOOL_LINE,
      D,
      'מתמטיקה · 08:15',
      'היסטוריה · 09:05',
      'אנגלית · 10:05',
      'ספורט · 13:30',
      D,
    ].join('\n'));
    assert.ok(!out.text.includes('מורה-מומצא') && !out.text.includes('חדר-מומצא'));
    assert.equal(out.text.split('\n').filter((line) => line === D).length, 2, 'בדיוק שתי שורות תוחם, כל אחת התו היחיד');
  });
  test('שישי (אין שיעורים), שבת, חופשה ומערכת חסרה: אין שורת בית ספר ואין בלוק', () => {
    for (const [dateIso, timetable] of [[FRIDAY, TIMETABLE], ['2026-10-31', TIMETABLE], ['2026-12-07', { slots: [slot(1, '08:15', '09:00', 'מתמטיקה', { weekday: 2 })] }], [TOMORROW, null]]) {
      const tomorrowIso = dateIso;
      const out = composeClosing({ dateIso: '2026-01-01', tomorrowIso, received: [], tasks: [], pending: [], timetable });
      assert.ok(!out.text.includes(D), dateIso);
      assert.ok(!out.text.includes('שיעור'), dateIso);
    }
  });
  test('סדר מלא: נקלט, בוצע, מחר: בית ספר, אימונים, אירועים, מבחן, להגשה מחר, ואז משימות פתוחות', () => {
    const out = composeClosing({
      dateIso: TODAY, received: ['אירוע אישי · תור'], notUnderstood: 0, done: { tasks: [{ title: 'דף', done_at: '2026-10-27T10:00:00.000Z' }], answered: [] },
      examLine: 'מחר: מבחן במתמטיקה ב-10:05', timetable: TIMETABLE,
      trainings: [{ title: 'ריצה קלה', startsAt: at('17', '00') }],
      events: [{ title: 'תור לרופא', startsAt: at('16', '30') }],
      tasks: [{ title: 'חוברת', due_at: '2026-10-28T09:00:00.000Z' }], pending: [],
    });
    const lines = out.text.split('\n');
    const index = (needle) => lines.findIndex((line) => line.includes(needle));
    const order = ['נקלט היום', 'בוצע היום', 'מחר: ⁦', 'אימונים מחר (1):', 'אירועים מחר (1):', 'מחר: מבחן', 'להגשה מחר', 'משימות פתוחות'].map(index);
    assert.ok(order.every((n) => n >= 0), JSON.stringify(order));
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'הסדר נשמר');
    assert.ok(lines.includes('· ריצה קלה · 17:00'));
    assert.ok(lines.includes('· תור לרופא · 16:30'));
  });
  test('"ערב שקט" מתעלם מבית ספר, אימונים ואירועים של מחר: שורת הערב השקט נשארת, ואחריה "מחר"', () => {
    const out = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], timetable: TIMETABLE, trainings: [{ title: 'ריצה', startsAt: at('17', '00') }], events: [{ title: 'תור', startsAt: at('16', '30') }] });
    const lines = out.text.split('\n');
    assert.equal(lines[1], QUIET_EVENING_LINE);
    assert.equal(lines[2], SCHOOL_LINE);
    assert.ok(lines.includes('אימונים מחר (1):') && lines.includes('אירועים מחר (1):'));
    assert.equal(out.partial, false);
  });
  test('בלי שום דבר למחר: ההודעה זהה להודעה של לפני השינוי', () => {
    const before = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [] });
    const after = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], timetable: null, trainings: [], events: [] });
    assert.equal(after.text, before.text);
    assert.equal(after.text, `סגירה · יום שלישי 27.10\n${QUIET_EVENING_LINE}`);
  });
  test('trainings/events שהם null (לא נטענו) מושמטים, בלי לסמן partial ובלי לשבור', () => {
    const out = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], timetable: TIMETABLE, trainings: null, events: null });
    assert.ok(!out.text.includes('אימונים') && !out.text.includes('אירועים'));
    assert.equal(out.partial, false);
  });
  test('מקור אימונים עתידי נכנס: פריט { title, startsAt } מוצג, ובלי שעה = "כל היום"', () => {
    const out = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], trainings: [{ title: 'אינטרוולים 6x800', startsAt: at('18', '00') }, { title: 'מנוחה', startsAt: null }] });
    assert.ok(out.text.includes('אימונים מחר (2):\n· מנוחה · כל היום\n· אינטרוולים 6x800 · 18:00'));
  });
  test('אירועים: ממוינים לפי שעה (יום שלם ראשון), שעה לפי שעון ישראל, פריט פגום מדולג, ואין כותרת שיכולה להזריק תוחם או שורה', () => {
    const lines = timedItemLines([
      { title: 'ב', startsAt: at('20', '00') }, { title: `תור${D}\nשורה-אחרת`, startsAt: at('09', '05') }, { title: 'יום', startsAt: null }, { title: 'שבור', startsAt: 'not-a-date' }, null, { title: '   ', startsAt: at('21', '00') },
    ]);
    assert.deepEqual(lines, ['· יום · כל היום', '· תור שורה-אחרת · 09:05', '· ב · 20:00', '· אירוע · 21:00']);
    assert.ok(lines.every((line) => !line.includes(D)));
  });
  test('שם מקצוע עם תוחם או ירידת שורה לא שובר את הבלוק', () => {
    const tt = { slots: [slot(1, '08:15', '09:00', `מתמטיקה${D}\nעוד`)] };
    const out = composeClosing({ dateIso: TODAY, received: [], tasks: [], pending: [], timetable: tt });
    assert.equal(out.text.split('\n').filter((line) => line === D).length, 2);
  });
  test('ההתראה לטלפון (H6) לא תלויה ב"מחר" המלא: אותו קלט, אותו נוסח', () => {
    const args = { examLine: 'מחר: מבחן במתמטיקה ב-10:05', reviewDue: 1, receivedCount: 2, notUnderstoodCount: 1, pendingCount: 2, openTasks: 3 };
    assert.equal(closingPushText(args), 'מחר: מבחן במתמטיקה ב-10:05 · סיכום היום מחכה לסימון · נקלטו 2 · לא הובנו 1 · 2 שאלות ממתינות · 3 משימות פתוחות');
  });
});

describe('C-3: lib/training-source.js', () => {
  test('כרגע אין מקור: [] (לא ממציאים)', async () => {
    assert.deepEqual(await loadTrainingsForDate(TOMORROW), []);
  });
});

describe('C-3: loadTomorrowEvents (events הפנימית)', () => {
  test('חצות ישראלי: אחרי מעבר השעון (28.10, UTC+2) ולפניו (20.10, UTC+3)', () => {
    assert.deepEqual({ from: dayRange('2026-10-28').from.toISOString(), to: dayRange('2026-10-28').to.toISOString() }, { from: '2026-10-27T22:00:00.000Z', to: '2026-10-28T22:00:00.000Z' });
    assert.equal(dayRange('2026-10-20').from.toISOString(), '2026-10-19T21:00:00.000Z');
    assert.equal(dayRange('2026-10-25').to.getTime() - dayRange('2026-10-25').from.getTime(), 25 * 3600000, 'יום המעבר: 25 שעות');
  });
  test('השאילתה: status=planned, טווח היום הישראלי, רק title/starts_at/domain/external_id; בלי location ו-description', async () => {
    const sql = fakeSql(() => [
      { title: 'תור לרופא', starts_at: '2026-10-28T14:30:00.000Z', domain: 'personal', external_id: 'g1' },
      { title: 'ללא מזהה', starts_at: '2026-10-28T08:00:00.000Z', domain: 'school', external_id: null },
      { title: 'שבור', starts_at: null, domain: null, external_id: 'g2' },
    ]);
    const out = await loadTomorrowEvents(sql, TOMORROW);
    const [call] = sql.calls;
    assert.match(call.text, /FROM events e WHERE e\.status = 'planned' AND e\.starts_at >= \?::timestamptz AND e\.starts_at < \?::timestamptz/);
    assert.match(call.text, /SELECT e\.title, e\.starts_at, e\.domain, e\.external_id FROM/);
    assert.ok(!/location|description|raw_content|match_key/.test(call.text));
    assert.deepEqual(call.values, ['2026-10-27T22:00:00.000Z', '2026-10-28T22:00:00.000Z']);
    assert.deepEqual(out.events, [
      { title: 'תור לרופא', startsAt: '2026-10-28T14:30:00.000Z', domain: 'personal' }, { title: 'ללא מזהה', startsAt: '2026-10-28T08:00:00.000Z', domain: 'school' },
    ]);
    assert.deepEqual([...out.externalIds], ['g1']);
  });
  test('כשל מסד נזרק (הצרכן מחליט)', async () => {
    await assert.rejects(() => loadTomorrowEvents(fakeSql(() => { throw new Error('db down'); }), TOMORROW), /db down/);
  });
  test('cleanTitle: כותרת ריקה = "אירוע"', () => {
    assert.equal(cleanTitle('  '), 'אירוע');
    assert.equal(cleanTitle(null), 'אירוע');
    assert.equal(cleanTitle(' א   ב '), 'א ב');
  });
});

// ---------------------------------------------------------------------------
// Google: fetch מזויף. יומנים: אישי (owner), חגים (reader), פנוי/עסוק בלבד (freeBusyReader, מדולג).
// ---------------------------------------------------------------------------
const CAL_A = 'personal-cal@example.test';
const CAL_B = 'holidays-cal@example.test';
const CAL_FB = 'freebusy-cal@example.test';
const CALS = [{ id: CAL_A, summary: 'אישי', accessRole: 'owner' }, { id: CAL_B, summary: 'חגים', accessRole: 'reader' }, { id: CAL_FB, summary: 'עסוק', accessRole: 'freeBusyReader' }];
const SECRET_NOTE = 'נוכחים-ותיאור-סודיים-DO-NOT-LEAK';
function googleFetch({ events = {}, calendars = CALS, fail } = {}) {
  return fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return jsonResponse({ access_token: ACCESS_TOKEN });
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: calendars });
    const match = Object.keys(events).find((id) => url.startsWith(eventsEndpoint(id)));
    if (match && options.method === 'GET') {
      if (fail?.[match]) return fail[match] instanceof Error ? (() => { throw fail[match]; })() : fail[match];
      return jsonResponse({ items: events[match] });
    }
    throw new Error(`fetch לא צפוי: ${options.method} ${url}`);
  });
}
const gEvent = (id, summary, start, over = {}) => ({ id, status: 'confirmed', summary, start, end: start, attendees: [{ email: SECRET_NOTE }], location: SECRET_NOTE, description: SECRET_NOTE, ...over });
const timed = (iso) => ({ dateTime: iso, timeZone: 'Asia/Jerusalem' });
const googleSql = (overrides = {}) => fakeSql((text) => {
  if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh() }];
  return overrides[text] ?? [];
});
const load = (fetchImpl, over = {}) => loadGoogleTomorrow({ sql: googleSql(), config: CONFIG, tomorrowIso: TOMORROW, fetchImpl, ...over });

describe('C-3: loadGoogleTomorrow (קריאה בלבד)', () => {
  test('כותרת ושעה בלבד: נוכחים, מיקום ותיאור לא נקראים ולא מוחזרים; רק GET; בלי watch; fields מצמצם בשרת', async () => {
    const f = googleFetch({ events: {
      [CAL_A]: [gEvent('e1', 'מפגש חברים', timed(at('19', '00'))), gEvent('e2', 'כנס', { date: TOMORROW }, { end: { date: '2026-10-29' } })],
      [CAL_B]: [gEvent('h1', 'חג', { date: '2026-10-28' }, { end: { date: '2026-10-29' } })],
    } });
    const out = await load(f);
    assert.equal(out.ok, true);
    assert.deepEqual(out.events, [{ title: 'מפגש חברים', startsAt: '2026-10-28T17:00:00.000Z' }, { title: 'כנס', startsAt: null }, { title: 'חג', startsAt: null }]);
    assert.ok(!JSON.stringify(out).includes(SECRET_NOTE));
    const eventCalls = f.calls.filter((c) => c.url.includes('/events'));
    assert.equal(eventCalls.length, 2, 'יומן freeBusyReader מדולג');
    for (const call of eventCalls) {
      assert.equal(call.options.method, 'GET');
      assert.ok(!call.url.includes('/watch'));
      const params = new URL(call.url).searchParams;
      assert.equal(params.get('timeMin'), '2026-10-27T22:00:00.000Z');
      assert.equal(params.get('timeMax'), '2026-10-28T22:00:00.000Z');
      assert.equal(params.get('singleEvents'), 'true');
      assert.equal(params.get('fields'), 'items(id,status,summary,start,end),nextPageToken');
      assert.equal(call.options.headers.authorization, `Bearer ${ACCESS_TOKEN}`);
    }
    assert.deepEqual(f.calls.filter((c) => c.options.method && c.options.method !== 'GET' && c.url !== TOKEN_ENDPOINT), [], 'שום כתיבה ל-Google');
  });
  test('יומן החגים האוטומטי של Google (מזהה עם "#holiday@group.v.calendar.google.com") מדולג: לא נקרא ואירועיו לא מוצגים; יומן אחר נשאר', async () => {
    const HOLIDAYS = ['iw.jewish#holiday@group.v.calendar.google.com', 'en.jewish#holiday@group.v.calendar.google.com'];
    const f = googleFetch({
      calendars: [{ id: CAL_A, summary: 'אישי', accessRole: 'owner' }, { id: HOLIDAYS[0], summary: 'חגים ישראליים', accessRole: 'reader' }, { id: HOLIDAYS[1], summary: 'Jewish', accessRole: 'reader' }, { id: CAL_B, summary: 'ימי הולדת', accessRole: 'reader' }],
      events: {
        [CAL_A]: [gEvent('e1', 'מפגש חברים', timed(at('19', '00')))],
        [HOLIDAYS[0]]: [gEvent('h1', 'חג', { date: TOMORROW }, { end: { date: '2026-10-29' } })],
        [HOLIDAYS[1]]: [gEvent('h2', 'Holiday', { date: TOMORROW }, { end: { date: '2026-10-29' } })],
        [CAL_B]: [gEvent('b1', 'יום הולדת', { date: TOMORROW }, { end: { date: '2026-10-29' } })],
      },
    });
    const out = await load(f);
    assert.equal(out.ok, true);
    assert.deepEqual(out.events.map((event) => event.title), ['מפגש חברים', 'יום הולדת']);
    assert.equal(f.calls.filter((c) => c.url.includes('%23holiday')).length, 0, 'יומן החגים לא נקרא בכלל');
  });
  test('אירוע שכבר ב-events (אותו external_id) לא מוצג שוב; אותו אירוע בשני יומנים מוצג פעם אחת', async () => {
    const same = gEvent('dup', 'כפול', timed(at('10', '00')));
    const f = googleFetch({ events: { [CAL_A]: [gEvent('in-db', 'כבר במערכת', timed(at('08', '00'))), same, gEvent('x1', 'חדש', timed(at('12', '00')))], [CAL_B]: [{ ...same, id: 'dup-copy' }] } });
    const out = await load(f, { excludeIds: new Set(['in-db']) });
    assert.deepEqual(out.events.map((e) => e.title), ['כפול', 'חדש']);
  });
  test('אירוע שהתחיל אתמול, אירוע שמתחיל מחרתיים, ואירוע שבוטל: לא של מחר', async () => {
    const f = googleFetch({ events: { [CAL_A]: [
      gEvent('a', 'אתמול', timed('2026-10-27T20:00:00+02:00')), gEvent('b', 'מחרתיים', timed('2026-10-29T08:00:00+02:00')),
      gEvent('c', 'בוטל', timed(at('09', '00')), { status: 'cancelled' }), gEvent('d', 'יום שלם אתמול', { date: '2026-10-27' }, { end: { date: '2026-10-28' } }), gEvent('e', 'ללא כותרת', timed(at('11', '00')), { summary: undefined }),
    ], [CAL_B]: [] } });
    const out = await load(f);
    assert.deepEqual(out.events, [{ title: 'אירוע', startsAt: '2026-10-28T09:00:00.000Z' }]);
  });
  test('כשל בכל שלב מחזיר { ok:false, reason } בלי לזרוק ובלי כותרות או סודות', async () => {
    const cases = {
      'config חסר': () => load(googleFetch(), { config: { ...CONFIG, clientId: undefined } }),
      'לא מחובר': () => load(googleFetch(), { sql: fakeSql(() => []) }),
      'רענון נכשל': () => load(fakeFetch((url) => (url === TOKEN_ENDPOINT ? jsonResponse({ error: 'invalid_grant' }, 400) : (() => { throw new Error('unexpected'); })()))),
      'רשימת יומנים נכשלה': () => load(fakeFetch((url) => (url === TOKEN_ENDPOINT ? jsonResponse({ access_token: ACCESS_TOKEN }) : jsonResponse({}, 500)))),
      'events 403 ביומן אחד': () => load(googleFetch({ events: { [CAL_A]: [gEvent('e', SECRET_NOTE, timed(at('10', '00')))], [CAL_B]: [] }, fail: { [CAL_B]: jsonResponse({ error: { message: SECRET_NOTE } }, 403) } })),
      'timeout': () => load(googleFetch({ events: { [CAL_A]: [], [CAL_B]: [] }, fail: { [CAL_A]: timeoutError() } })),
      'תשובה שבורה': () => load(googleFetch({ events: { [CAL_A]: [], [CAL_B]: [] }, fail: { [CAL_A]: new Response('not json', { status: 200 }) } })),
    };
    for (const [name, run] of Object.entries(cases)) {
      const out = await run();
      assert.equal(out.ok, false, name);
      assert.match(out.reason, /^[A-Za-z0-9_]+( \(\d+\))?$/, `${name}: קוד קצר`);
      assertNoSecrets(assert, JSON.stringify(out), [SECRET_NOTE]);
    }
    assert.equal((await cases['events 403 ביומן אחד']()).ok, false, 'הכול או כלום: לא רשימה חלקית');
  });
  test('listCalendarEvents: מחזיר רק id/title/startsAt/startDate/endDate', async () => {
    const f = googleFetch({ events: { [CAL_A]: [gEvent('e1', 'א', timed(at('08', '00')))] } });
    const out = await listCalendarEvents({ accessToken: ACCESS_TOKEN, calendarId: CAL_A, timeMin: 'a', timeMax: 'b', fetchImpl: f });
    assert.deepEqual(out, { ok: true, events: [{ id: 'e1', title: 'א', startsAt: '2026-10-28T06:00:00.000Z', startDate: null, endDate: null }] });
  });
});

// ---------------------------------------------------------------------------
// חיבור ב-api/queues/deliver.js (deliverClose)
// ---------------------------------------------------------------------------
describe('C-3: deliverClose, "מחר" המלא', () => {
  // 21:00 ב-4.11.2026 (UTC+2); מחר 5.11 (חמישי, slot.weekday 5) ואין בו מבחן ב-data/exams, ולכן אין שורת מבחן.
  const CLOSE = { kind: 'close', slotKey: 'close-2026-11-04', targetAt: '2026-11-04T19:00:00.000Z' };
  const DELIVERED = new Date('2026-11-04T19:00:00.900Z');
  const T2 = '2026-11-05';
  const TIMETABLE2 = { slots: TIMETABLE.slots.map((s) => ({ ...s, weekday: s.weekday === 4 ? 5 : s.weekday })) };
  const at2 = (hh, mm) => `2026-11-05T${hh}:${mm}:00+02:00`;
  const closeDb = ({ dbEvents = [], existing = false, failOn } = {}) => {
    const st = { messages: [], probe: [] };
    const sql = fakeSql((text, values) => {
      if (failOn && text.includes(failOn)) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
      if (text.includes('INSERT INTO probe_log')) { st.probe.push({ probe: text.includes("'closing-google'") ? 'closing-google' : text.includes("'chat-notify'") ? 'chat-notify' : 'message-slot', values }); return []; }
      if (text.includes('has_unseen')) return [{ pending: 0, unread: 0, open_tasks: 0, has_unseen: false }];
      if (text.includes('FROM events e')) return dbEvents;
      if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh() }];
      if (text.includes("SELECT 1 AS found FROM messages WHERE entity_type = 'close'")) return existing ? [{ found: 1 }] : [];
      if (text.includes('INSERT INTO messages')) { st.messages.push(values[0]); return [{ id: 'm1' }]; }
      return [];
    });
    sql.state = st;
    return sql;
  };
  const push = () => { const h = async (r) => { h.seen.push(JSON.parse(await r.clone().text())); return new Response('ok', { status: 200 }); }; h.seen = []; return h; };
  const run = (sql, extra = {}, count = 1) => handleDelivery(CLOSE, { deliveryCount: count }, { sql, now: () => DELIVERED, pushHandle: push(), secret: FAKE_CRON, timetable: TIMETABLE2, googleConfig: CONFIG, ...extra });

  test('בית ספר + פירוט, אימון ממקור מוזרק, אירוע פנימי ואירוע Google (בלי כפילות לפי external_id), ובסדר הנכון', async () => {
    const sql = closeDb({ dbEvents: [{ title: 'תור לספר', starts_at: '2026-11-05T13:00:00.000Z', domain: 'personal', external_id: 'g-db' }] });
    const f = googleFetch({ events: { [CAL_A]: [gEvent('g-db', 'תור לספר', timed('2026-11-05T15:00:00+02:00')), gEvent('g2', 'מפגש חברים', timed(at2('19', '00')))], [CAL_B]: [] } });
    const out = await run(sql, { googleFetch: f, loadTrainings: async (dateIso) => { assert.equal(dateIso, T2); return [{ title: 'ריצה קלה', startsAt: at2('17', '00') }]; } });
    assert.equal(out.created, true);
    assert.equal(sql.state.messages.length, 1);
    assert.equal(sql.state.messages[0], [
      'סגירה · יום רביעי 4.11', QUIET_EVENING_LINE, SCHOOL_LINE, D, 'מתמטיקה · 08:15', 'היסטוריה · 09:05', 'אנגלית · 10:05', 'ספורט · 13:30', D,
      'אימונים מחר (1):', '· ריצה קלה · 17:00', 'אירועים מחר (2):', '· תור לספר · 15:00', '· מפגש חברים · 19:00',
    ].join('\n'));
    assert.equal(sql.state.probe.filter((p) => p.probe === 'closing-google').length, 0, 'הצלחה לא נרשמת');
    assert.ok(sql.calls.every((c) => !/location|description/.test(c.text)));
  });
  test('ברירת מחדל: אין מקור אימונים, ולכן אין שורת אימון (לא ממציאים)', async () => {
    const sql = closeDb();
    await run(sql, { googleFetch: googleFetch({ events: { [CAL_A]: [], [CAL_B]: [] } }) });
    assert.ok(!sql.state.messages[0].includes('אימונים'));
  });
  test('כשל Google: האירועים של Google מושמטים, שאר ההודעה נשלחת, נרשם closing-google בקוד קצר בלי כותרות, ואין ניסיון חוזר', async () => {
    const sql = closeDb({ dbEvents: [{ title: 'תור פנימי', starts_at: '2026-11-05T13:00:00.000Z', domain: 'personal', external_id: null }] });
    const f = googleFetch({ events: { [CAL_A]: [gEvent('g1', SECRET_NOTE, timed(at2('09', '00')))], [CAL_B]: [] }, fail: { [CAL_B]: jsonResponse({ error: 'forbidden' }, 403) } });
    const out = await run(sql, { googleFetch: f });
    assert.equal(out.created, true);
    assert.ok(sql.state.messages[0].includes('· תור פנימי · 15:00'));
    assert.ok(!sql.state.messages[0].includes(SECRET_NOTE));
    const logged = sql.state.probe.filter((p) => p.probe === 'closing-google');
    assert.equal(logged.length, 1);
    assert.equal(logged[0].values[0], `slot=${CLOSE.slotKey}; google_tomorrow=omitted; reason=events_forbidden (403)`);
    assertNoSecrets(assert, JSON.stringify(logged), [SECRET_NOTE, 'תור פנימי']);
  });
  test('Google לא מוגדר (בלי config): מושמט ונרשם config_missing, בלי קריאת רשת', async () => {
    const sql = closeDb();
    const f = googleFetch();
    await run(sql, { googleFetch: f, googleConfig: { ...CONFIG, clientId: undefined } });
    assert.equal(f.calls.length, 0);
    assert.match(sql.state.probe.find((p) => p.probe === 'closing-google').values[0], /reason=config_missing$/);
  });
  test('הודעה שכבר קיימת (ניסיון חוזר): לא טוענים שוב אירועים, אימונים או Google', async () => {
    const sql = closeDb({ existing: true });
    const f = googleFetch();
    let trained = 0;
    const out = await run(sql, { googleFetch: f, loadTrainings: async () => { trained += 1; return []; } });
    assert.equal(out.created, false);
    assert.equal(f.calls.length, 0);
    assert.equal(trained, 0);
    assert.equal(sql.find('FROM events e').length, 0);
  });
  test('כשל מסד באירועי מחר: נזרק בניסיון 1, ובניסיון 5 מושמט בלי לסמן partial ובלי ליפול', async (t) => {
    captureConsole(t);
    await assert.rejects(() => run(closeDb({ failOn: 'FROM events e' }), { googleFetch: googleFetch() }, 1), /db down/);
    const sql = closeDb({ failOn: 'FROM events e' });
    const out = await run(sql, { googleFetch: googleFetch() }, 5);
    assert.equal(out.created, true);
    assert.ok(!sql.state.messages[0].includes('אירועים מחר'));
  });
  test('ההתראה לטלפון זהה למה שהייתה בלי "מחר" המלא: "יום שקט"', async () => {
    const sql = closeDb();
    const pushHandle = push();
    await handleDelivery(CLOSE, { deliveryCount: 1 }, { sql, now: () => DELIVERED, pushHandle, secret: FAKE_CRON, timetable: TIMETABLE2, googleConfig: CONFIG, googleFetch: googleFetch({ events: { [CAL_A]: [gEvent('g1', 'משהו', timed(at2('09', '00')))], [CAL_B]: [] } }) });
    assert.equal(pushHandle.seen[0].body, 'יום שקט');
  });
});
