// בדיקות ל-api/daily-check.js. בלי מסד ובלי רשת: sql ו-fetch מוזרקים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { handle } from '../api/daily-check.js';
import { encryptToken } from '../lib/google.js';

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

// sql מזויף: מזהה את השאילתה לפי הטקסט, ושומר את שורות ה-INSERT.
function fakeSql({ creds = { refresh_token_enc: ENC, obtained_at: '2026-10-12T12:00:00.000Z' }, watch = {}, failWatch = false, failInsert = false } = {}) {
  const inserts = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
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
  assert.equal(sql.inserts.length, 3); // + שורת google-watch-renew-daily (גם החידוש קורא את הטבלה ונופל, ונרשם check_crashed)
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
});

test('אין שמות/מזהי יומנים או סודות בתשובה ובשורות ה-log', async () => {
  const sql = fakeSql({ watch: { active: 1, earliest_expiration: new Date(NOW.getTime() + 3600000) } });
  const res = await run(authed(), { sql, fetchImpl: fakeFetch() });
  const everything = (await res.text()) + JSON.stringify(sql.inserts);
  for (const secret of [CALENDAR_NAME, CALENDAR_ID, REFRESH_TOKEN, 'fake-access-token', SECRET, CONFIG.clientSecret, CONFIG.encKeyRaw, ENC]) {
    assert.ok(!everything.includes(secret), `דלף: ${secret.slice(0, 6)}...`);
  }
});
