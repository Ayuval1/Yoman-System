// בדיקות ל-lib/ops/daily-check.js. בלי מסד ובלי רשת: sql ו-fetch מוזרקים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { handle } from '../lib/ops/daily-check.js';
import { encryptToken } from '../lib/google.js';
import { captureConsole } from './helpers.js';

const SECRET = 'test-cron-secret';
const NOW = new Date('2026-10-20T12:00:00.000Z');
const KEY = randomBytes(32);
const CONFIG = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'x', encKeyRaw: KEY.toString('base64') };
const REFRESH_TOKEN = 'fake-refresh-token-value';
const ENC = encryptToken(REFRESH_TOKEN, KEY);
const CALENDAR_NAME = 'יומן סודי של יובל';
const CALENDAR_ID = 'secret-calendar-id@group.calendar.google.com';

function req(headers = {}, method = 'GET') {
  return new Request('https://x.test/api/daily-check', { method, headers });
}
const authed = () => req({ authorization: `Bearer ${SECRET}` });

// sql מזויף: מזהה את השאילתה לפי הטקסט, ושומר את שורות ה-INSERT. intake = ספירות הקליטה שהמסד "מחזיר"; intakeQueries = שאילתות הספירה כפי שנשלחו.
function fakeSql({
  creds = { refresh_token_enc: ENC, obtained_at: '2026-10-12T12:00:00.000Z' }, watch = {}, failWatch = false, failInsert = false, intake = {}, failIntake = null,
} = {}) {
  const inserts = [];
  const intakeQueries = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('LEFT JOIN intake_outcomes')) {
      intakeQueries.push({ text: text.replace(/\s+/g, ' ').trim(), values });
      if (failIntake) throw failIntake;
      return [{ recorded: 0, unclassified: 0, duplicate: 0, failed: 0, no_outcome: 0, ...intake }];
    }
    if (text.includes('FROM events')) return []; // סריקת האירועים (שלב 8.3-4): אין מה לכתוב
    if (text.includes('FROM google_credentials')) return creds ? [creds] : [];
    if (text.includes('FROM google_watch_channels')) {
      if (failWatch) throw new Error('boom');
      return [{ active: 0, earliest_expiration: null, last_notification_at: null, total_notifications: 0, ...watch }];
    }
    if (text.includes('INSERT INTO probe_log')) {
      if (failInsert) throw new Error('boom');
      inserts.push({ probe: values[0], ok: values[1], detail: values[2] });
      return [];
    }
    throw new Error(`שאילתה לא צפויה: ${text}`);
  };
  sql.inserts = inserts;
  sql.intakeQueries = intakeQueries;
  return sql;
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
// fetch מזויף: token endpoint ו-calendarList.
function fakeFetch({ tokenResponse, calendars = [{ id: CALENDAR_ID, summary: CALENDAR_NAME, accessRole: 'owner' }, { id: 'b', summary: 'ב', accessRole: 'reader' }] } = {}) {
  return async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) return tokenResponse ?? json(200, { access_token: 'fake-access-token' });
    if (String(url).includes('calendarList')) return json(200, { items: calendars });
    throw new Error('url לא צפוי');
  };
}

const run = (request, deps) => handle(request, { secret: SECRET, config: CONFIG, now: () => NOW, ...deps });

test('בלי כותרת Authorization - 401 ואין כתיבה', async () => {
  const sql = fakeSql();
  const res = await run(req(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 401);
  assert.equal(sql.inserts.length, 0);
});

test('Bearer שגוי - 401', async () => {
  const res = await run(req({ authorization: 'Bearer wrong' }), { sql: fakeSql(), fetchImpl: fakeFetch() });
  assert.equal(res.status, 401);
});

test('בלי CRON_SECRET בשרת - נכשל סגור, 401', async () => {
  const res = await handle(authed(), { sql: fakeSql(), secret: '', config: CONFIG, fetchImpl: fakeFetch() });
  assert.equal(res.status, 401);
});

test('POST - 405', async () => {
  const res = await run(req({ authorization: `Bearer ${SECRET}` }, 'POST'), { sql: fakeSql(), fetchImpl: fakeFetch() });
  assert.equal(res.status, 405);
});

test('token תקין: ספירת יומנים וימים מאז החיבור, שורת probe_log אחת', async () => {
  const sql = fakeSql();
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.google_token.ok, true);
  assert.equal(body.google_token.calendars, 2);
  assert.equal(body.google_token.days, 8);
  const row = sql.inserts.find((r) => r.probe === 'google-token-daily');
  assert.equal(row.ok, true);
  assert.equal(row.detail, 'days_since_connected=8 calendars=2');
  assert.equal(sql.inserts.filter((r) => r.probe === 'google-token-daily').length, 1);
});

test('invalid_grant: ok=false, הסיבה והימים נרשמים, עדיין 200', async () => {
  const sql = fakeSql();
  const fetchImpl = fakeFetch({ tokenResponse: json(400, { error: 'invalid_grant' }) });
  const res = await run(authed(), { sql, fetchImpl });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.google_token.ok, false);
  assert.match(body.google_token.reason, /^invalid_grant/);
  const row = sql.inserts.find((r) => r.probe === 'google-token-daily');
  assert.equal(row.ok, false);
  assert.match(row.detail, /reason=invalid_grant.*days_since_connected=8/);
});

test('אין חיבור שמור: not_connected', async () => {
  const sql = fakeSql({ creds: null });
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(body.google_token.ok, false);
  assert.equal(body.google_token.reason, 'not_connected');
});

test('טבלת watch ריקה: active=0, none, flag=false, ok=true', async () => {
  const sql = fakeSql();
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(body.google_watch.ok, true);
  assert.equal(body.google_watch.active, 0);
  assert.equal(body.google_watch.minutes_to_expiry, null);
  assert.equal(body.google_watch.expiring_within_24h, false);
  const row = sql.inserts.find((r) => r.probe === 'google-watch-daily');
  assert.equal(row.detail, 'active=0 minutes_to_expiry=none hours_since_notification=none notification_count=0 expiring_within_24h=false');
});

test('ערוץ שפג בעוד פחות מ-24 שעות: flag=true והדקות מדויקות', async () => {
  const sql = fakeSql({
    watch: {
      active: 2,
      earliest_expiration: new Date(NOW.getTime() + 90 * 60000), // 90 דקות
      last_notification_at: new Date(NOW.getTime() - 5 * 3600000 - 1000),
      total_notifications: 17,
    },
  });
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(body.google_watch.expiring_within_24h, true);
  assert.equal(body.google_watch.minutes_to_expiry, 90);
  assert.equal(body.google_watch.hours_since_notification, 5);
  assert.equal(body.google_watch.notification_count, 17);
  assert.equal(body.google_watch.active, 2);
});

test('ערוץ שפג בעוד יותר מ-24 שעות: flag=false', async () => {
  const sql = fakeSql({ watch: { active: 1, earliest_expiration: new Date(NOW.getTime() + 3 * 86400000) } });
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(body.google_watch.expiring_within_24h, false);
});

test('כשל חלקי: watch נופל, בדיקת token עדיין רצה ושתי השורות נרשמות', async () => {
  const sql = fakeSql({ failWatch: true });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.google_token.ok, true);
  assert.equal(body.google_watch.ok, false);
  assert.equal(sql.inserts.length, 5); // + שורת google-watch-renew-daily (גם החידוש קורא את הטבלה ונופל, ונרשם check_crashed) + google-event-sync-daily + intake-daily
  assert.equal(sql.inserts.find((r) => r.probe === 'google-watch-daily').ok, false);
});

test('כשל חלקי: token נופל (fetch זורק), watch עדיין נבדק', async () => {
  const sql = fakeSql({ watch: { active: 1 } });
  const fetchImpl = async () => { throw new Error('network down'); };
  const res = await run(authed(), { sql, fetchImpl });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.google_token.ok, false);
  assert.equal(body.google_watch.ok, true);
  assert.equal(body.google_watch.active, 1);
});

test('כשל בכתיבה ל-probe_log לא מפיל: 200 עם logged=false', async () => {
  const sql = fakeSql({ failInsert: true });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.google_token.logged, false);
  assert.equal(body.google_watch.logged, false);
  assert.equal(body.intake_daily.logged, false);
});

test('אין שמות/מזהי יומנים או סודות בתשובה ובשורות ה-log', async () => {
  const sql = fakeSql({ watch: { active: 1, earliest_expiration: new Date(NOW.getTime() + 3600000) } });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  const everything = (await res.text()) + JSON.stringify(sql.inserts);
  for (const secret of [CALENDAR_NAME, CALENDAR_ID, REFRESH_TOKEN, 'fake-access-token', SECRET, CONFIG.clientSecret, CONFIG.encKeyRaw, ENC]) {
    assert.ok(!everything.includes(secret), `דלף: ${secret.slice(0, 6)}...`);
  }
});

// --- שורת intake-daily (docs/09-security/46, שלב M.1; D17 סעיף 8) ---
// חשוב: השאילתה עצמה לא הורצה מול Postgres אמיתי (אין מסד בסשן). הבדיקות מוודאות את מבנה השאילתה, את הפרמטר ואת הפלט;
// התחביר ושיוך היום בשעון ישראל (כולל סביב מעבר השעון) נשארים לאימות ב-Neon.
const INTAKE_DETAIL = /^recorded=\d+; unclassified=\d+; duplicate=\d+; failed=\d+; no_outcome=\d+$/;
const intakeRow = (sql) => sql.inserts.filter((r) => r.probe === 'intake-daily');

test('intake-daily: שורה אחת ב-probe_log, ה-detail בצורה המדויקת, והספירות בתשובה', async () => {
  const sql = fakeSql({ intake: { recorded: 3, unclassified: 2, duplicate: 1, failed: 1, no_outcome: 0 } });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(intakeRow(sql), [{ probe: 'intake-daily', ok: true, detail: 'recorded=3; unclassified=2; duplicate=1; failed=1; no_outcome=0' }]);
  assert.deepEqual(body.intake_daily, { ok: true, recorded: 3, unclassified: 2, duplicate: 1, failed: 1, no_outcome: 0, logged: true });
  assert.equal(sql.inserts.length, 5); // כולל google-event-sync-daily (שלב 8.3-4)
  assert.deepEqual(sql.inserts.map((r) => r.probe), ['google-token-daily', 'google-watch-daily', 'google-watch-renew-daily', 'google-event-sync-daily', 'intake-daily']);
});

test('intake-daily: יום בלי הודעות - אפסים, ok=true', async () => {
  const sql = fakeSql();
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(intakeRow(sql)[0].detail, 'recorded=0; unclassified=0; duplicate=0; failed=0; no_outcome=0');
  assert.equal(body.intake_daily.ok, true);
});

test('intake-daily: שאילתה אחת, הפרמטר היחיד הוא ה-now המוזרק, והיום הקודם מחושב ב-SQL בשעון ישראל', async () => {
  const sql = fakeSql();
  await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(sql.intakeQueries.length, 1);
  const { text, values } = sql.intakeQueries[0];
  assert.deepEqual(values, [NOW.toISOString()]);
  assert.match(text, /FROM sources s LEFT JOIN intake_outcomes o ON o\.source_id = s\.id/);
  assert.match(text, /WHERE s\.channel = 'shortcut'/);
  // השיוך ליום לפי received_at של המקור, והיום הקודם יחסית ל-now: שניהם בשעון ישראל, בלי תאריך בקוד.
  assert.match(text, /\(s\.received_at AT TIME ZONE 'Asia\/Jerusalem'\)::date = \(\?::timestamptz AT TIME ZONE 'Asia\/Jerusalem'\)::date - 1/);
  for (const status of ['recorded', 'unclassified', 'duplicate', 'failed']) {
    assert.ok(text.includes(`count(*) FILTER (WHERE o.status = '${status}')::int AS ${status}`), status);
  }
  assert.ok(text.includes('count(*) FILTER (WHERE o.id IS NULL)::int AS no_outcome'));
});

test('intake-daily: now אחר - הפרמטר משתנה איתו (אין שעון פנימי)', async () => {
  const other = new Date('2026-11-03T21:30:00.000Z');
  const sql = fakeSql();
  await handle(authed(), { sql, secret: SECRET, config: CONFIG, now: () => other, fetchImpl: fakeFetch() });
  assert.deepEqual(sql.intakeQueries[0].values, ['2026-11-03T21:30:00.000Z']);
});

test('intake-daily: השאילתה היא קריאה בלבד, ולא שולפת טקסט, שולח או מזהים', async () => {
  const sql = fakeSql();
  await run(authed(), { sql, fetchImpl: fakeFetch() });
  const { text } = sql.intakeQueries[0];
  assert.match(text, /^SELECT /);
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b/);
  assert.doesNotMatch(text, /raw_content|sender|content_hash/);
  const selected = text.slice(0, text.indexOf(' FROM sources'));
  assert.deepEqual([...selected.matchAll(/ AS (\w+)/g)].map((m) => m[1]), ['recorded', 'unclassified', 'duplicate', 'failed', 'no_outcome']);
});

test('intake-daily: no_outcome גדול מאפס - עדיין ok=true, והמספר מדווח', async () => {
  const sql = fakeSql({ intake: { recorded: 4, no_outcome: 2 } });
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.equal(body.intake_daily.ok, true);
  assert.equal(body.intake_daily.no_outcome, 2);
  assert.deepEqual(intakeRow(sql), [{ probe: 'intake-daily', ok: true, detail: 'recorded=4; unclassified=0; duplicate=0; failed=0; no_outcome=2' }]);
});

test('intake-daily: הספירה קורסת - ok=false, reason=check_crashed, שלוש השורות האחרות נרשמות כרגיל, ובקונסול רק שם השגיאה', async (t) => {
  const cap = captureConsole(t);
  const PRIVATE = 'טקסט-פרטי-מומצא-בשגיאה';
  const failIntake = Object.assign(new Error(`relation missing ${PRIVATE}`), { name: 'NeonDbError' });
  const sql = fakeSql({ failIntake });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.deepEqual(body.intake_daily, { ok: false, reason: 'check_crashed', logged: true });
  assert.deepEqual(intakeRow(sql), [{ probe: 'intake-daily', ok: false, detail: 'reason=check_crashed' }]);
  assert.equal(sql.inserts.length, 5); // כולל google-event-sync-daily (שלב 8.3-4)
  assert.deepEqual(sql.inserts.find((r) => r.probe === 'google-token-daily'), { probe: 'google-token-daily', ok: true, detail: 'days_since_connected=8 calendars=2' });
  assert.equal(sql.inserts.find((r) => r.probe === 'google-watch-daily').ok, true);
  assert.deepEqual(sql.inserts.find((r) => r.probe === 'google-watch-renew-daily'), { probe: 'google-watch-renew-daily', ok: true, detail: 'renewed=0 failed=0 skipped=0' });
  assert.equal(body.google_token.ok, true);
  assert.equal(body.google_watch.ok, true);
  assert.deepEqual(cap.lines, ['daily-check: ספירת הקליטה קרסה NeonDbError']);
  assert.ok(!(text + JSON.stringify(sql.inserts) + cap.text()).includes(PRIVATE), 'הודעת השגיאה לא נכנסת לתשובה, ל-probe_log או לקונסול');
});

test('intake-daily: קריסה עם שגיאה שאינה Error (מחרוזת / מספר) לא מפילה את הריצה', async (t) => {
  captureConsole(t);
  for (const thrown of ['boom', 7]) {
    const sql = fakeSql({ failIntake: thrown });
    const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
    assert.equal(res.status, 200);
    assert.equal(intakeRow(sql)[0].detail, 'reason=check_crashed');
  }
});

test('intake-daily: אין טקסט בפלט - גם כשהמסד מחזיר ערך שאינו מספר, ל-detail ולתשובה נכנסים מספרים בלבד', async () => {
  const PRIVATE = 'טקסט-פרטי-מומצא-במסד';
  const good = fakeSql({ intake: { recorded: 12, unclassified: 7, duplicate: 3, failed: 2, no_outcome: 1 } });
  await run(authed(), { sql: good, fetchImpl: fakeFetch() });
  assert.match(intakeRow(good)[0].detail, INTAKE_DETAIL);

  const bad = fakeSql({ intake: { recorded: PRIVATE, unclassified: '5' } });
  const text = await (await run(authed(), { sql: bad, fetchImpl: fakeFetch() })).text();
  assert.equal(intakeRow(bad)[0].detail, 'recorded=NaN; unclassified=5; duplicate=0; failed=0; no_outcome=0');
  assert.ok(!(text + JSON.stringify(bad.inserts)).includes(PRIVATE));
});

test('intake-daily: המסד לא החזיר שורה - אפסים, בלי קריסה', async () => {
  const base = fakeSql();
  const sql = async (strings, ...values) => (strings.join('?').includes('LEFT JOIN intake_outcomes') ? [] : base(strings, ...values));
  const body = await (await run(authed(), { sql, fetchImpl: fakeFetch() })).json();
  assert.deepEqual(body.intake_daily, { ok: true, recorded: 0, unclassified: 0, duplicate: 0, failed: 0, no_outcome: 0, logged: true });
  assert.equal(base.inserts.find((r) => r.probe === 'intake-daily').detail, 'recorded=0; unclassified=0; duplicate=0; failed=0; no_outcome=0');
});
