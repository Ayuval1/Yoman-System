// בדיקות למשימת ops 'school-series' (בלוק 4) ול-listSeriesEvents / הסינון ב-listCalendarEvents. בלי מסד ובלי רשת: הכול מזויף.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handle } from '../lib/ops/school-series.js';
import ops from '../api/ops.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT, eventsEndpoint, listCalendarEvents, listSeriesEvents } from '../lib/google.js';
import { CONFIG, ACCESS_TOKEN, encRefresh, assertNoSecrets } from './google-fixtures.js';
import { fakeFetch, fakeSql, jsonResponse, FAKE_CRON } from './helpers.js';
import vacationsFile from '../data/school-vacations.json' with { type: 'json' };

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const NOW = new Date('2026-11-22T06:00:00.000Z'); // ראשון 22.11.2026, 08:00 בישראל
const SCHOOL_CAL = 'school-cal-id@group.calendar.google.com';
const OTHER_CAL = 'personal-cal-id@group.calendar.google.com';
const CALS = [{ id: SCHOOL_CAL, summary: 'בית ספר', accessRole: 'owner' }, { id: OTHER_CAL, summary: 'אישי', accessRole: 'owner' }];
const OLD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'].map((day, i) => ({
  id: `old${i}`, status: 'confirmed', summary: `בית ספר יום ${day}`, start: { dateTime: `2026-05-0${3 + i}T08:15:00+03:00`, timeZone: 'Asia/Jerusalem' },
  recurrence: [`RRULE:FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH'][i]}`], description: 'פרטי-DO-NOT-LEAK',
}));
const EXAM = { id: 'exam1', status: 'confirmed', summary: 'מבחן', start: { dateTime: '2026-12-01T08:15:00+02:00' } };

const sqlWith = () => fakeSql((text) => (text.includes('FROM google_credentials') ? [{ refresh_token_enc: encRefresh() }] : []));
const request = (mode, method = 'GET', auth = `Bearer ${FAKE_CRON}`) =>
  new Request(`https://x.test/api/ops?task=school-series${mode ? `&mode=${mode}` : ''}`, { method, headers: auth ? { authorization: auth } : {} });

// fetch מזויף: מחזיק את היומן "בית ספר" בזיכרון, כך שהרצה שנייה רואה את מה שהראשונה יצרה.
function googleWorld({ calendars = CALS, items = [...OLD, EXAM], failInsert = null, listItems = null, hiddenIds = [] } = {}) {
  const store = new Map(items.map((e) => [e.id, structuredClone(e)]));
  const f = fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return jsonResponse({ access_token: ACCESS_TOKEN });
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: calendars });
    const base = eventsEndpoint(SCHOOL_CAL);
    if (!url.startsWith(base)) throw new Error(`fetch לא צפוי: ${options.method} ${url}`);
    if (options.method === 'GET') {
      const path = url.slice(base.length).split('?')[0];
      if (path === '') return jsonResponse({ items: listItems ? listItems([...store.values()]) : [...store.values()] });
      // events.get לפי מזהה קבוע. מבוטל נשאר במאגר עם status 'cancelled' (כמו ב-Google אחרי מחיקה).
      const one = store.get(decodeURIComponent(path.slice(1)));
      return one ? jsonResponse(one) : jsonResponse({ error: { code: 404 } }, 404);
    }
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (failInsert && body.id === failInsert) return jsonResponse({ error: { code: 403, message: 'x' } }, 403);
      if (store.has(body.id)) return jsonResponse({ error: { code: 409 } }, 409);
      if (hiddenIds.includes(body.id)) return jsonResponse({ error: { code: 409 } }, 409);
      store.set(body.id, { status: 'confirmed', ...body });
      return jsonResponse({ id: body.id });
    }
    if (options.method === 'PATCH') {
      const id = decodeURIComponent(url.slice(base.length + 1));
      store.set(id, { ...store.get(id), ...JSON.parse(options.body) });
      return jsonResponse({ id });
    }
    throw new Error(`שיטה לא צפויה: ${options.method}`);
  });
  f.store = store;
  return f;
}
const run = (req, fetchImpl, over = {}) => handle(req, {
  sql: over.sql ?? sqlWith(), secret: FAKE_CRON, config: CONFIG, fetchImpl, now: () => NOW, loadTable: async () => TIMETABLE, vacations: vacationsFile.vacations, ...over,
});
const writes = (f) => f.calls.filter((c) => c.options.method && c.options.method !== 'GET' && c.url !== TOKEN_ENDPOINT);

describe('school-series: הגנה ומצבים', () => {
  test('דרך api/ops: בלי Authorization 401, PATCH 405', async () => {
    assert.equal((await ops.fetch(request('dry', 'GET', null))).status, 401);
    assert.equal((await ops.fetch(request('dry', 'PATCH', null))).status, 405);
  });
  test('סוד שגוי 401; mode לא מוכר 400; apply ב-GET 400 בלי שום קריאה ל-Google', async () => {
    const f = googleWorld();
    assert.equal((await run(request('dry', 'GET', 'Bearer wrong'), f)).status, 401);
    assert.equal((await run(request('nope'), f)).status, 400);
    const res = await run(request('apply', 'GET'), f);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'apply_requires_post');
    assert.equal(f.calls.length, 0);
  });
});

describe('school-series: mode=dry', () => {
  test('ברירת מחדל: סיכום מלא, אפס כתיבות ל-Google, ושורת probe_log עם ספירות בלבד', async () => {
    const f = googleWorld();
    const sql = sqlWith();
    const res = await run(request(null), f, { sql });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.mode, 'dry');
    assert.equal(out.written, false);
    assert.deepEqual(out.refused, []);
    assert.equal(out.counts.lessons, 41);
    assert.equal(out.counts.breaks, 33);
    assert.equal(out.counts.ok, true);
    assert.equal(out.first_date, '2026-11-22');
    assert.equal(out.last_date, '2027-06-17', 'חמישי האחרון לפני 20.6.2027');
    assert.ok(out.vacations_excluded.some((v) => v.name === 'חנוכה'));
    assert.ok(!out.vacations_excluded.some((v) => v.name === 'סוכות'), 'חופשה שעברה לא מוצגת');
    assert.deepEqual(out.plan, { create: 74, update: 0, unchanged: 0, hidden: 0, orphans: 0, unscheduled: 0 }, 'שיעורים והפסקות בלבד');
    assert.deepEqual(out.header_plan, { create: 5, update: 0, unchanged: 0, hidden: 0, unscheduled: 0 });
    assert.equal(out.headers.count, 5);
    assert.deepEqual(out.headers.items[1], { weekday: 2, title: '🏫 בית ספר · 08:15–15:45' });
    assert.equal(out.counts.total, 74, 'הכותרות לא נספרות ב-74');
    assert.equal(out.existing_app_series, 0);
    assert.equal(out.old_series.length, 5);
    assert.deepEqual(out.old_series[0], { title: 'בית ספר יום ראשון', rrule: 'RRULE:FREQ=WEEKLY;BYDAY=SU', action: 'cut', new_rrule: 'RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261121T215959Z' });
    assert.deepEqual(writes(f), []);
    const probe = sql.find('INSERT INTO probe_log');
    assert.equal(probe.length, 1);
    assert.equal(probe[0].values[1], 'mode=dry lessons=41 breaks=33 create=74 update=0 unchanged=0 hidden=0 cut=5 orphans=0 headers=5 headers_create=5 headers_update=0');
    const text = JSON.stringify(out) + JSON.stringify(sql.calls);
    assertNoSecrets(assert, text, ['פרטי-DO-NOT-LEAK', SCHOOL_CAL]);
  });

  test('הקריאה היא רשימת סדרות ביומן "בית ספר" בלבד: singleEvents=false, timeMin = חצות של יום ההפעלה', async () => {
    const f = googleWorld();
    await run(request('dry'), f);
    const lists = f.calls.filter((c) => c.url.includes('/events?'));
    assert.equal(lists.length, 1);
    const gets = f.calls.filter((c) => c.url.includes('/events/'));
    assert.equal(gets.length, 79, 'כל סדרה (74 + 5 כותרות) נבדקת לפי המזהה הקבוע שלה');
    assert.ok(gets.every((c) => c.options.method === 'GET'));
    assert.ok(gets.some((c) => c.url.includes('/events/schoolser2027d2hdr?')), 'גם כותרת היום נבדקת לפי המזהה');
    assert.equal(new URL(gets[0].url).searchParams.get('fields'), 'id,status,summary,location,description,start,end,recurrence,extendedProperties(private)',
      'כדי לדעת אם סדרה כבר זהה (ולא לכתוב שוב)');
    const params = new URL(lists[0].url).searchParams;
    assert.equal(params.get('singleEvents'), 'false');
    assert.equal(params.get('timeMin'), '2026-11-21T22:00:00.000Z');
    assert.ok(!lists.some((c) => c.url.includes(encodeURIComponent(OTHER_CAL))));
  });

  test('dry בלי Google מחובר: עדיין 200 עם ספירות, ו-refused מראה למה', async () => {
    const res = await run(request('dry'), googleWorld(), { sql: fakeSql(() => []) });
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.equal(out.counts.total, 74);
    assert.deepEqual(out.refused, ['not_connected']);
  });
});

describe('school-series: mode=apply', () => {
  test('יוצר 74 עם מזהה קבוע ותגית, חותך את 5 הישנות, לא נוגע במבחן ולא מוחק כלום', async () => {
    const f = googleWorld();
    const sql = sqlWith();
    const res = await run(request('apply', 'POST'), f, { sql });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.ok, true);
    assert.deepEqual({ ...out.result }, {
      created: 74, updated: 0, headers_created: 5, headers_updated: 0, existed_hidden: 0, hidden_skipped: 0, cut: 5, failed: 0, last_failure: null, stopped: null, cut_skipped: null,
    });
    assert.equal(writes(f).filter((c) => c.options.method === 'DELETE').length, 0);
    assert.ok(!writes(f).some((c) => c.url.includes('exam1')));
    const created = [...f.store.values()].filter((e) => e.id.startsWith('schoolser'));
    assert.equal(created.length, 79);
    for (const e of created) {
      assert.equal(e.extendedProperties.private.yoman, 'school-series');
      assert.equal(e.start.timeZone, 'Asia/Jerusalem');
      if (e.id.endsWith('hdr')) assert.match(e.recurrence[0], /^RRULE:FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH);UNTIL=20270619$/);
      else assert.match(e.recurrence[0], /^RRULE:FREQ=WEEKLY;BYDAY=(SU|MO|TU|WE|TH);UNTIL=20270619T205959Z$/);
    }
    const header = f.store.get('schoolser2027d2hdr');
    assert.deepEqual(header.start, { date: '2026-11-23', timeZone: 'Asia/Jerusalem' });
    assert.deepEqual(header.end, { date: '2026-11-24', timeZone: 'Asia/Jerusalem' });
    assert.equal(header.summary, '🏫 בית ספר · 08:15–15:45');
    assert.equal(f.store.get('old0').recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20261121T215959Z');
    assert.equal(sql.find('INSERT INTO probe_log')[0].values[1], 'mode=apply created=74 updated=0 headers_created=5 headers_updated=0 existed_hidden=0 hidden_skipped=0 cut=5 failed=0');
  });

  test('הרצה שנייה: הכול כבר זהה = אפס עדכונים, אפס יצירות, אפס חיתוכים (כבר נחתכו); בלי כפילות ובלי כתיבה', async () => {
    const f = googleWorld();
    await run(request('apply', 'POST'), f);
    const before = f.store.size;
    const writesBefore = writes(f).length;
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.result.created, 0);
    assert.equal(out.result.updated, 0);
    assert.equal(out.result.headers_created, 0);
    assert.equal(out.result.headers_updated, 0);
    assert.equal(out.plan.unchanged, 74);
    assert.equal(out.header_plan.unchanged, 5);
    assert.equal(out.result.cut, 0);
    assert.equal(out.existing_app_series, 79);
    assert.ok(out.old_series.every((s) => s.action === 'skip' && s.reason === 'already_cut'));
    assert.equal(f.store.size, before);
    assert.equal(writes(f).length, writesBefore, 'אף כתיבה ל-Google');
  });

  test('המצב של 22.11 (74 קיימות, 5 הישנות חתוכות, בלי כותרות): נוצרות רק 5 הכותרות, 74 לא נוגעים', async () => {
    const f = googleWorld();
    await run(request('apply', 'POST'), f);
    for (const id of [...f.store.keys()]) if (id.endsWith('hdr')) f.store.delete(id);
    const writesBefore = writes(f).length;
    const dry = await (await run(request('dry'), f)).json();
    assert.deepEqual(dry.plan, { create: 0, update: 0, unchanged: 74, hidden: 0, orphans: 0, unscheduled: 0 });
    assert.deepEqual(dry.header_plan, { create: 5, update: 0, unchanged: 0, hidden: 0, unscheduled: 0 });
    assert.deepEqual(dry.counts.mismatch, null);
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.ok, true);
    assert.equal(out.result.created, 0);
    assert.equal(out.result.updated, 0);
    assert.equal(out.result.headers_created, 5);
    const newWrites = writes(f).slice(writesBefore);
    assert.equal(newWrites.length, 5);
    assert.ok(newWrites.every((c) => c.options.method === 'POST' && JSON.parse(c.options.body).id.endsWith('hdr')));
  });

  test('סדרה קיימת שלא הופיעה ברשימה (timeMin) נמצאת לפי המזהה, לא נוצרת שוב', async () => {
    const f = googleWorld();
    await run(request('apply', 'POST'), f);
    const g = googleWorld({ items: [...f.store.values()], listItems: (all) => all.filter((e) => !e.id.startsWith('schoolser')) });
    const out = await (await run(request('apply', 'POST'), g)).json();
    assert.equal(out.result.created, 0);
    assert.equal(out.result.headers_created, 0);
    assert.equal(out.result.updated, 0);
    assert.equal(out.plan.unchanged, 74);
    assert.equal(out.existing_app_series, 79);
  });

  test('סדרה קיימת ששונתה ב-Google (כותרת אחרת): מתעדכנת ב-PATCH, לא נוצרת שוב', async () => {
    const f = googleWorld();
    await run(request('apply', 'POST'), f);
    f.store.get('schoolser2027d1p1l').summary = 'משהו אחר';
    f.store.get('schoolser2027d3hdr').summary = '🏫 בית ספר · 08:00–14:00';
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.result.updated, 1);
    assert.equal(out.result.headers_updated, 1);
    assert.equal(out.result.created + out.result.headers_created, 0);
    assert.equal(f.store.get('schoolser2027d3hdr').summary, '🏫 בית ספר · 08:15–14:15');
    assert.deepEqual(f.store.get('schoolser2027d3hdr').start, { date: '2026-11-24', timeZone: 'Asia/Jerusalem' }, 'ההתחלה לא נדרסה');
  });

  test('סדרה שנמחקה ב-Google (status cancelled): לא נוצרת מחדש, מדווחת ב-dry וב-apply, וחוסמת חיתוך', async () => {
    const deleted = { id: 'schoolser2027d1p1l', status: 'cancelled' };
    const dry = await (await run(request('dry'), googleWorld({ items: [...OLD, deleted], listItems: (all) => all.filter((e) => e.status !== 'cancelled') }))).json();
    assert.equal(dry.plan.hidden, 1);
    assert.equal(dry.plan.create, 73);
    assert.deepEqual(dry.hidden_series, ['1-1-lesson']);
    assert.equal(dry.cut_blocked, 'hidden_series');
    const f = googleWorld({ items: [...OLD, deleted], listItems: (all) => all.filter((e) => e.status !== 'cancelled') });
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.ok, false);
    assert.equal(out.result.created, 73);
    assert.equal(out.result.hidden_skipped, 1);
    assert.equal(out.result.cut, 0);
    assert.equal(out.result.cut_skipped, 'new_series_incomplete');
    assert.equal(f.store.get('schoolser2027d1p1l').status, 'cancelled', 'לא הוחזר לחיים');
    assert.ok(!f.calls.some((c) => c.options.method === 'POST' && c.options.body?.includes('schoolser2027d1p1l')));
    assert.equal(f.store.get('old0').recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  });

  test('409 ביצירה (existed_hidden) נספר ככשל וחוסם את חיתוך הישנות', async () => {
    const f = googleWorld({ hiddenIds: ['schoolser2027d2p3b'] });
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.ok, false);
    assert.equal(out.result.existed_hidden, 1);
    assert.equal(out.result.failed, 1);
    assert.equal(out.result.last_failure, 'exists_hidden');
    assert.equal(out.result.cut, 0);
    assert.equal(out.result.cut_skipped, 'new_series_incomplete');
  });

  test('כשל בבדיקה לפי מזהה (לא 404): מסרב, בלי כתיבה', async () => {
    const base = googleWorld();
    const f = fakeFetch((url, options, i) => (url.includes('/events/schoolser') ? jsonResponse({ error: 'backendError' }, 500) : base(url, options, i)));
    const res = await run(request('apply', 'POST'), f);
    assert.equal(res.status, 409);
    assert.ok((await res.json()).refused.some((r) => r === 'get_http_error (500)'));
    assert.deepEqual(writes(f), []);
  });

  test('יצירה שנכשלה: לא חותכים את הישנות (שלא יישאר יום ריק), ok=false', async () => {
    const f = googleWorld({ failInsert: 'schoolser2027d1p1l' });
    const out = await (await run(request('apply', 'POST'), f)).json();
    assert.equal(out.ok, false);
    assert.equal(out.result.created, 73);
    assert.equal(out.result.failed, 1);
    assert.equal(out.result.cut, 0);
    assert.equal(out.result.cut_skipped, 'new_series_incomplete');
    assert.equal(f.store.get('old0').recurrence[0], 'RRULE:FREQ=WEEKLY;BYDAY=SU');
  });

  test('מסרב (409) בלי כתיבה: ספירה שאינה 74, יומן "בית ספר" חסר, Google לא מחובר, מערכת שעות חסרה', async () => {
    const cases = {
      count_mismatch: { loadTable: async () => ({ slots: TIMETABLE.slots.slice(1) }) },
      calendar_not_found: { fetchImpl: googleWorld({ calendars: [CALS[1]] }) },
      not_connected: { sql: fakeSql(() => []) },
      timetable_missing: { loadTable: async () => null },
    };
    for (const [code, over] of Object.entries(cases)) {
      const f = over.fetchImpl ?? googleWorld();
      const sql = over.sql ?? sqlWith();
      const res = await run(request('apply', 'POST'), f, { ...over, sql, fetchImpl: f });
      assert.equal(res.status, 409, code);
      const out = await res.json();
      assert.ok(out.refused.includes(code), `${code}: ${out.refused}`);
      assert.equal(out.written, false);
      assert.deepEqual(writes(f), [], code);
      assert.match(sql.find('INSERT INTO probe_log')[0].values[1], new RegExp(`^mode=apply refused=.*${code}`));
    }
  });
});

describe('בלוק 4: אירועי האפליקציה לא נחשבים "משהו מבחוץ"', () => {
  test('listCalendarEvents (סגירה, "אני פנוי?") מדלג על סדרה ומופע של האפליקציה, ומשאיר אירוע רגיל', async () => {
    const f = fakeFetch(() => jsonResponse({ items: [
      { id: 'schoolser2027d1p1l_20261122T061500Z', status: 'confirmed', summary: 'שיח אישי', start: { dateTime: '2026-11-22T08:15:00+02:00' }, recurringEventId: 'schoolser2027d1p1l' },
      { id: 'abc', status: 'confirmed', summary: 'הפסקה', start: { dateTime: '2026-11-22T09:00:00+02:00' }, extendedProperties: { private: { yoman: 'school-series' } } },
      { id: 'schoolser2027d2hdr_20261123', status: 'confirmed', summary: '🏫 בית ספר · 08:15–15:45', start: { date: '2026-11-23' }, recurringEventId: 'schoolser2027d2hdr' },
      { id: 'mine', status: 'confirmed', summary: 'מפגש', start: { dateTime: '2026-11-22T19:00:00+02:00' } },
    ] }));
    const out = await listCalendarEvents({ accessToken: 't', calendarId: 'c', timeMin: 'a', timeMax: 'b', fetchImpl: f });
    assert.deepEqual(out.events.map((e) => e.id), ['mine']);
  });

  test('listSeriesEvents: GET בלבד, מחזיר recurrence ותגית, מדלג על מבוטל, ושגיאה = קוד קצר', async () => {
    const ok = fakeFetch(() => jsonResponse({ items: [OLD[0], { id: 'gone', status: 'cancelled' }] }));
    const out = await listSeriesEvents({ accessToken: 't', calendarId: SCHOOL_CAL, timeMin: 'x', fetchImpl: ok });
    assert.equal(out.ok, true);
    assert.deepEqual(out.events.map((e) => e.id), ['old0']);
    assert.deepEqual(out.events[0].recurrence, OLD[0].recurrence);
    assert.equal(ok.calls[0].options.method, 'GET');
    const bad = fakeFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    assert.deepEqual(await listSeriesEvents({ accessToken: 't', calendarId: SCHOOL_CAL, timeMin: 'x', fetchImpl: bad }), { ok: false, reason: 'forbidden', status: 403 });
  });
});
