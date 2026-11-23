// בדיקות למשימת ops lesson-backfill (lib/ops/lesson-backfill.js): הגנה, dry כברירת מחדל, apply=1 כותב, ספירות בלבד.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, req, FAKE_CRON } from './helpers.js';
import { handle } from '../lib/ops/lesson-backfill.js';

const AUTH = { authorization: `Bearer ${FAKE_CRON}` };
// שני ב-23.11.2026, שיעור 1 08:15–09:00
const TIMETABLE = { slots: [{ weekday: 2, period: 1, startsAt: '08:15', endsAt: '09:00', subject: 'היסטוריה' }] };
const ROWS = [
  { id: '11111111-1111-4111-8111-111111111111', received_at: '2026-11-23T06:30:00.000Z', subject: null }, // 08:30 בישראל, בתוך שיעור 1
  { id: '22222222-2222-4222-8222-222222222222', received_at: '2026-11-23T18:00:00.000Z', subject: null }, // 20:00, מחוץ לשיעור
];
const db = () => fakeSql((text) => (text.includes('FROM media') ? ROWS : []));

describe('ops: lesson-backfill', () => {
  test('בלי סוד: 401; לא GET: 405', async () => {
    assert.equal((await handle(req('https://x.test/api/ops?task=lesson-backfill'), { sql: db(), secret: FAKE_CRON, timetable: TIMETABLE })).status, 401);
    assert.equal((await handle(req('https://x.test/api/ops?task=lesson-backfill', { method: 'POST', headers: AUTH }), { sql: db(), secret: FAKE_CRON, timetable: TIMETABLE })).status, 405);
  });
  test('ברירת מחדל dry: סופר ולא כותב', async () => {
    const sql = db();
    const res = await handle(req('https://x.test/api/ops?task=lesson-backfill', { headers: AUTH }), { sql, secret: FAKE_CRON, timetable: TIMETABLE });
    const body = await res.json();
    assert.deepEqual(body, { ok: true, mode: 'dry', scanned: 2, would_link: 1, more_may_remain: false });
    assert.equal(sql.find('UPDATE media').length, 0);
    assert.ok(!JSON.stringify(body).includes('היסטוריה'));
  });
  test('apply=1: מעדכן רק את מה שנקשר, ורק היכן שעוד ריק', async () => {
    const sql = db();
    const body = await (await handle(req('https://x.test/api/ops?task=lesson-backfill&apply=1', { headers: AUTH }), { sql, secret: FAKE_CRON, timetable: TIMETABLE })).json();
    assert.equal(body.linked, 1);
    const updates = sql.find('UPDATE media');
    assert.equal(updates.length, 1);
    assert.match(updates[0].text, /AND lesson_date IS NULL/);
  });
  test('בלי מערכת שעות: לא כותב, ok=false', async () => {
    const sql = db();
    const body = await (await handle(req('https://x.test/api/ops?task=lesson-backfill&apply=1', { headers: AUTH }), { sql, secret: FAKE_CRON, timetable: null })).json();
    assert.deepEqual(body, { ok: false, mode: 'apply', reason: 'no_timetable' });
    assert.equal(sql.find('UPDATE media').length, 0);
  });
});
