// בדיקות למשימת ops 'run-series-cut' (lib/ops/run-series.js): חיתוך הסדרה הישנה "ריצת בוקר" (שישי 07:00) ביום ההפעלה.
// מקור: docs/02-rules/03-4fitness-rules.md ("הסדרה הישנה ... נחתכת ביום ההפעלה"), docs/02-rules/03-google-calendar-rules.md ("היומנים הקיימים").
// בלי מסד ובלי רשת: הכול מזויף. הכותרות והמזהים מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle, OLD_RUN_SERIES } from '../lib/ops/run-series.js';
import ops, { TASKS } from '../api/ops.js';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT, eventsEndpoint } from '../lib/google.js';
import { CONFIG, ACCESS_TOKEN, encRefresh, assertNoSecrets } from './google-fixtures.js';
import { fakeFetch, fakeSql, jsonResponse, FAKE_CRON } from './helpers.js';

const NOW = new Date('2026-11-22T10:00:00.000Z'); // ראשון 22.11.2026, 12:00 בישראל = יום ההפעלה
const RUN_CAL = 'run-cal-id@group.calendar.google.com';
const OTHER_CAL = 'other-cal-id@group.calendar.google.com';
const READ_CAL = 'read-cal-id@group.calendar.google.com';
const CALS = [
  { id: RUN_CAL, summary: 'ריצה', accessRole: 'owner' }, { id: OTHER_CAL, summary: 'אישי', accessRole: 'writer' }, { id: READ_CAL, summary: 'משותף', accessRole: 'reader' },
];
const OLD = {
  id: 'oldrun1', status: 'confirmed', summary: 'ריצת בוקר', start: { dateTime: '2026-05-01T07:00:00+03:00', timeZone: 'Asia/Jerusalem' },
  recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR'],
};
const sqlWith = () => fakeSql((text) => (text.includes('FROM google_credentials') ? [{ refresh_token_enc: encRefresh() }] : []));
const request = (query = '', method = 'GET', auth = `Bearer ${FAKE_CRON}`) =>
  new Request(`https://x.test/api/ops?task=run-series-cut${query}`, { method, headers: auth ? { authorization: auth } : {} });

function world({ byCal = { [RUN_CAL]: [OLD], [OTHER_CAL]: [{ id: 'x1', status: 'confirmed', summary: 'חוג', start: { dateTime: '2026-05-01T17:00:00+03:00' }, recurrence: ['RRULE:FREQ=WEEKLY'] }], [READ_CAL]: [{ ...OLD, id: 'ro1' }] } } = {}) {
  const f = fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return jsonResponse({ access_token: ACCESS_TOKEN });
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: CALS });
    for (const cal of Object.keys(byCal)) {
      const base = eventsEndpoint(cal);
      if (!url.startsWith(base)) continue;
      if (options.method === 'GET') return jsonResponse({ items: byCal[cal] });
      if (options.method === 'PATCH') return jsonResponse({ id: 'ok' });
    }
    throw new Error(`fetch לא צפוי: ${options.method} ${url}`);
  });
  return f;
}
const run = (req, fetchImpl, over = {}) => handle(req, { sql: over.sql ?? sqlWith(), secret: FAKE_CRON, config: CONFIG, fetchImpl, now: () => NOW, ...over });
const writes = (f) => f.calls.filter((c) => c.options.method && c.options.method !== 'GET' && c.url !== TOKEN_ENDPOINT);

describe('run-series-cut', () => {
  test('רשומה ב-api/ops; בלי Authorization 401; סוד שגוי 401; PUT 405', async () => {
    assert.equal(typeof TASKS['run-series-cut']?.fetch, 'function');
    assert.equal((await ops.fetch(request('', 'GET', null))).status, 401);
    assert.equal((await run(request('', 'GET', 'Bearer wrong'), world())).status, 401);
    assert.equal((await run(request('', 'PUT'), world())).status, 405);
  });

  test('ברירת מחדל (dry): מוצאת סדרה אחת ביומן שמותר לכתוב בו, מדווחת מה תשתנה, ולא כותבת', async () => {
    const f = world();
    const res = await run(request(), f);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'dry');
    assert.equal(body.activation_date, '2026-11-22');
    assert.equal(body.found, 1);
    assert.deepEqual(body.series, [{ title: OLD_RUN_SERIES, start: '2026-05-01T07:00:00+03:00', rrule: 'RRULE:FREQ=WEEKLY;BYDAY=FR', action: 'cut', new_rrule: 'RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261121T215959Z' }]);
    assert.equal(body.written, false);
    assert.deepEqual(writes(f), []);
    // היומן לקריאה בלבד לא נסרק; שמות היומנים, מזהים וכותרות אחרות לא בתשובה.
    assert.ok(!f.calls.some((c) => c.url.startsWith(eventsEndpoint(READ_CAL))));
    const text = JSON.stringify(body);
    for (const leak of [RUN_CAL, OTHER_CAL, 'oldrun1', 'חוג', 'אישי']) assert.ok(!text.includes(leak), leak);
    assertNoSecrets(assert, text);
  });

  test('apply=1: PATCH של recurrence בלבד עם UNTIL ליום שלפני ההפעלה; בלי מחיקה', async () => {
    const f = world();
    const body = await (await run(request('&apply=1'), f)).json();
    assert.equal(body.mode, 'apply');
    assert.equal(body.written, true);
    assert.equal(body.result.cut, 1);
    const w = writes(f);
    assert.equal(w.length, 1);
    assert.equal(w[0].options.method, 'PATCH');
    assert.ok(w[0].url.startsWith(eventsEndpoint(RUN_CAL)));
    assert.deepEqual(JSON.parse(w[0].options.body), { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261121T215959Z'] });
    assert.ok(!f.calls.some((c) => c.options.method === 'DELETE'));
  });

  test('אפס התאמות או יותר מאחת: מדווח, ולא נוגע גם ב-apply', async () => {
    const none = world({ byCal: { [RUN_CAL]: [], [OTHER_CAL]: [] } });
    const b0 = await (await run(request('&apply=1'), none)).json();
    assert.equal(b0.found, 0);
    assert.equal(b0.written, false);
    assert.deepEqual(b0.refused, ['not_found']);
    assert.deepEqual(writes(none), []);
    const two = world({ byCal: { [RUN_CAL]: [OLD], [OTHER_CAL]: [{ ...OLD, id: 'oldrun2' }] } });
    const b2 = await (await run(request('&apply=1'), two)).json();
    assert.equal(b2.found, 2);
    assert.deepEqual(b2.refused, ['ambiguous']);
    assert.deepEqual(writes(two), []);
  });

  test('כותרת שאינה בדיוק "ריצת בוקר", או אירוע בלי חזרה: לא נחשב', async () => {
    const f = world({ byCal: { [RUN_CAL]: [{ ...OLD, summary: 'ריצת בוקר ארוכה' }, { ...OLD, id: 'single', recurrence: null }], [OTHER_CAL]: [] } });
    const body = await (await run(request(), f)).json();
    assert.equal(body.found, 0);
  });

  test('סדרה שכבר נחתכה: מדווחת skip, ו-apply לא כותב', async () => {
    const cut = { ...OLD, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=20261101T215959Z'] };
    const f = world({ byCal: { [RUN_CAL]: [cut], [OTHER_CAL]: [] } });
    const body = await (await run(request('&apply=1'), f)).json();
    assert.equal(body.series[0].action, 'skip');
    assert.equal(body.series[0].reason, 'already_cut');
    assert.deepEqual(writes(f), []);
  });

  test('Google לא מחובר: 200 עם google.ok=false ובלי כתיבה; שורת probe_log עם קודים בלבד', async () => {
    const sql = fakeSql(() => []);
    const f = world();
    const body = await (await run(request('&apply=1'), f, { sql })).json();
    assert.equal(body.google.ok, false);
    assert.equal(body.google.reason, 'not_connected');
    assert.equal(body.written, false);
    const probe = sql.find('INSERT INTO probe_log');
    assert.equal(probe.length, 1);
    assert.match(probe[0].values[1], /^mode=apply found=0 refused=not_connected/);
  });
});
