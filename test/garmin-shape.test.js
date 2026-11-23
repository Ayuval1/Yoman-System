// בדיקות ל-lib/ops/garmin-shape.js: משימת אבחון שמחזירה צורה בלבד. בלי רשת ובלי מסד: fetch ו-sql מזויפים. כל הטוקנים והנתונים מומצאים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, fakeSql, jsonResponse, randomKeyB64, FAKE_CRON } from './helpers.js';
import { encryptToken, parseEncKey } from '../lib/google.js';
import { shapeHandle, shapeOf } from '../lib/ops/garmin-shape.js';

const KEY_B64 = randomKeyB64();
const KEY = parseEncKey(KEY_B64);
const NOW = new Date('2026-11-23T08:00:00.000Z');
const jwt = (expSec) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64url')}.s`;
const FRESH = { access_token: jwt(NOW.getTime() / 1000 + 3600), refresh_token: 'ref-FAKE-1', client_id: 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2' };
const row = { tokens_enc: encryptToken(JSON.stringify(FRESH), KEY), updated_at: NOW, last_ok_at: null, last_error: null };
const sqlOk = () => fakeSql((text) => (text.startsWith('SELECT tokens_enc') ? [row] : []));
const auth = { authorization: `Bearer ${FAKE_CRON}` };
const req = (headers = auth, method = 'GET') => new Request('https://x.test/api/ops?task=garmin-shape', { method, headers });
const run = (request, over = {}) => shapeHandle(request, { sql: sqlOk(), secret: FAKE_CRON, encKeyRaw: KEY_B64, now: () => NOW, ...over });

const SECRET_TITLE = 'סודי';
const calendarBody = { calendarItems: [
  { itemType: 'workout', workoutId: 777, title: SECRET_TITLE, date: '2026-11-23', duration: 1800, shared: true, owner: { displayName: SECRET_TITLE } },
  { itemType: 'event', title: SECRET_TITLE },
] };
const scheduleBody = [{ workoutScheduleId: 5, calendarDate: '2026-11-23', workout: { workoutName: SECRET_TITLE, estimatedDurationInSecs: 2700, description: SECRET_TITLE } }];
const workoutBody = { workoutName: SECRET_TITLE, estimatedDurationInSecs: 2700, estimatedDistanceInMeters: 5000.5, workoutSegments: [{ segmentOrder: 1, workoutSteps: [
  { stepOrder: 1, endConditionValue: 600, endCondition: { conditionTypeKey: 'time', note: SECRET_TITLE }, deep: { deeper: { tooDeepDuration: 9 } } },
] }] };
const router = (over = {}) => fakeFetch((url) => {
  if (url in over) return over[url];
  if (url.includes('/calendar-service/')) return jsonResponse(calendarBody);
  if (url.includes('workoutScheduleByPeriod')) return jsonResponse(scheduleBody);
  if (url.includes('/workout-service/workout/')) return jsonResponse(workoutBody);
  return new Response('', { status: 404 });
});

describe('garmin-shape: הגנה', () => {
  test('בלי סוד או עם סוד שגוי: 401, ובלי קריאה ל-Garmin', async () => {
    const fetchImpl = router();
    assert.equal((await run(req({}), { fetchImpl })).status, 401);
    assert.equal((await run(req({ authorization: 'Bearer wrong' }), { fetchImpl })).status, 401);
    assert.equal((await run(req(auth), { fetchImpl, secret: '' })).status, 401);
    assert.equal(fetchImpl.calls.length, 0);
  });
  test('POST: 405', async () => {
    assert.equal((await run(req(auth, 'POST'))).status, 405);
  });
});

describe('garmin-shape: צורה בלבד', () => {
  test('shapeOf: מפתחות ממוינים, ערכים רק למספר/בוליאני בנתיב מתאים, עומק 3', () => {
    const shape = shapeOf({ b: 1, a: { durationX: 5, flag_time: true, name: 'x', c: { d: { e: 1, durSec: 9 } } }, list: [{ sec: 3 }] });
    assert.deepEqual(shape.keys, ['a', 'a.c', 'a.c.d', 'a.durationX', 'a.flag_time', 'a.name', 'b', 'list', 'list[].sec']);
    assert.deepEqual(shape.values, { 'a.durationX': 5, 'a.flag_time': true, 'list[].sec': 3 });
  });

  test('התשובה לא מכילה אף ערך מחרוזת מהגוף (כותרת "סודי", מזהים, תיאור)', async () => {
    const response = await run(req(), { fetchImpl: router() });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(SECRET_TITLE));
    assert.ok(!text.includes('777'));
    assert.ok(!text.includes('time"'), 'conditionTypeKey הוא מחרוזת ולא מחזירים אותה');
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.equal(body.calendar.items.length, 1);
    assert.ok(body.calendar.items[0].keys.includes('duration'));
    assert.equal(body.calendar.items[0].values.duration, 1800);
    assert.equal(body.schedule.items[0].values['workout.estimatedDurationInSecs'], 2700);
    assert.equal(body.workout.shape.values.estimatedDistanceInMeters, 5000.5);
    assert.equal(body.workout.top_level.type, 'object');
  });

  test('מגבלת עומק: נתיב עם יותר משלושה מפתחות לא מופיע, וערכו לא מוחזר', async () => {
    const body = JSON.parse(await (await run(req(), { fetchImpl: router() })).text());
    assert.ok(body.workout.shape.keys.includes('workoutSegments[].workoutSteps[].endConditionValue'));
    assert.ok(body.workout.shape.keys.includes('workoutSegments[].workoutSteps[].deep'));
    assert.ok(!body.workout.shape.keys.some((k) => k.includes('deeper')));
    assert.ok(!('workoutSegments[].workoutSteps[].deep.deeper.tooDeepDuration' in body.workout.shape.values));
    // endConditionValue תואם את ה-regex המורחב (endCondition|value), ולכן המספר שלו מוחזר.
    assert.equal(body.workout.shape.values['workoutSegments[].workoutSteps[].endConditionValue'], 600);
    // מחרוזת בנתיב תואם (conditionTypeKey תחת endCondition) עדיין לא מוחזרת.
    assert.ok(!('workoutSegments[].workoutSteps[].endCondition.conditionTypeKey' in body.workout.shape.values));
  });

  test('נתיבי הקריאה: חודש 0-based של ישראל, תוכנית מהיום עד +15, ואימון לפי workoutId', async () => {
    const fetchImpl = router();
    await run(req(), { fetchImpl });
    const urls = fetchImpl.calls.map((c) => c.url);
    assert.ok(urls[0].endsWith('/calendar-service/year/2026/month/10'));
    const schedule = new URL(urls[1]);
    assert.equal(schedule.searchParams.get('startDate'), '2026-11-23');
    assert.equal(schedule.searchParams.get('endDate'), '2026-12-08');
    assert.ok(urls[2].endsWith('/workout-service/workout/777'));
    assert.equal(urls.length, 3);
  });

  test('ערכים מספריים: מזהים וחותמות זמן לא יוצאים, מספר מחוץ ל-0..604800 לא יוצא, בוליאני כן', () => {
    const shape = shapeOf({
      stepId: 5, workoutId: 7, ownerId: 3, updateDate: 5, createdDate: 6, updateTime: 1732000000000, sizeSec: 604801, negativeSec: -1,
      endConditionValue: 600, okSec: 604800, hasTimer: true, endCondition: { conditionTypeId: 2, conditionTypeKey: 'time' },
    });
    assert.deepEqual(shape.values, { endConditionValue: 600, okSec: 604800, hasTimer: true });
    assert.ok(shape.keys.includes('stepId'), 'שם המפתח עדיין מופיע, רק הערך לא');
  });

  test('מפתח עם 4 ספרות רצופות או יותר (מזהה/תאריך) הופך ל-*', () => {
    const shape = shapeOf({ '1746800115': { durationSec: 5 }, a123: 1, '2026_11_23': 1 });
    assert.deepEqual(shape.keys, ['*', '*.durationSec', 'a123']);
  });

  test('שם מפתח חריג (תאריך כמפתח) מוחלף ב-* ולא דולף', () => {
    const shape = shapeOf({ '2026-11-23': { durationSec: 5 } });
    assert.deepEqual(shape.keys, ['*', '*.durationSec']);
  });
});

describe('garmin-shape: כשלים', () => {
  test('429 על קריאה ראשונה: עוצר מיד, מדווח blocked, בלי קריאות נוספות; probe_log בספירות בלבד', async () => {
    const fetchImpl = fakeFetch(() => new Response('', { status: 429 }));
    const sql = sqlOk();
    const response = await run(req(), { fetchImpl, sql });
    const body = await response.json();
    assert.equal(body.blocked, true);
    assert.equal(body.ok, false);
    assert.equal(body.calendar.reason, 'blocked');
    assert.equal(body.schedule, null);
    assert.equal(body.workout, null);
    assert.equal(fetchImpl.calls.length, 1);
    const [log] = sql.find("INSERT INTO probe_log");
    assert.ok(log.text.includes("'garmin-shape'"));
    assert.ok(log.values.some((v) => typeof v === 'string' && v.includes('blocked=true')));
  });

  test('427 על התוכנית: עוצר לפני האימון הבודד', async () => {
    const fetchImpl = fakeFetch((url) => (url.includes('/calendar-service/') ? jsonResponse(calendarBody) : new Response('', { status: 427 })));
    const body = await (await run(req(), { fetchImpl })).json();
    assert.equal(body.blocked, true);
    assert.equal(body.workout, null);
    assert.equal(fetchImpl.calls.length, 2);
  });

  test('לא מחובר: מדווח not_connected בלי קריאות ל-Garmin', async () => {
    const fetchImpl = router();
    const sql = fakeSql(() => []);
    const body = await (await run(req(), { fetchImpl, sql })).json();
    assert.deepEqual(body, { ok: false, reason: 'not_connected' });
    assert.equal(fetchImpl.calls.length, 0);
  });

  test('אין workoutId: הקריאה השלישית מדולגת ומדווחת', async () => {
    const fetchImpl = fakeFetch((url) => (url.includes('/calendar-service/')
      ? jsonResponse({ calendarItems: [{ itemType: 'workout', title: 'x' }] }) : jsonResponse([])));
    const body = await (await run(req(), { fetchImpl })).json();
    assert.equal(body.workout.reason, 'no_workout_id');
    assert.equal(fetchImpl.calls.length, 2);
  });
});
