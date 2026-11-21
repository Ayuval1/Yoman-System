// בדיקות לכרטיס "נגמרה מכסת ה-AI" (בלוק 3א; אפיון-מורחב סעיף 4): השדה quota ב-GET של api/chat.js, תוויות הכרטיס, וההתראה האחת לאייפון.
// בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../api/chat.js';
import { loadQuotaCard, quotaCardFields, returnsLabel, KIND_LABELS } from '../lib/brain/state.js';
import { sendQuotaNotification, PUSH_TITLE } from '../lib/chat-notify.js';
import { fakeSql, captureConsole, req, FAKE_SECRET, FAKE_CRON } from './helpers.js';

const NOW = new Date('2026-11-21T12:00:00.000Z'); // 14:00 בישראל
const passRow = (model) => ({ ok: true, at: new Date('2026-11-20T10:00:00.000Z'), detail: `range=s01-s20; 19/20 ran=20; failed: s10; model=${model}` });
const blocked = (model, kind, until) => ({ detail: `model=${model}; kind=${kind}; until=${until}` });

function brainDb({ pool = [passRow('gemini-a'), passRow('gemini-b')], quota = [], fail = false } = {}) {
  return fakeSql((text) => {
    if (fail && text.includes('FROM probe_log')) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
    if (text.includes('FROM probe_log') && text.includes('ok, detail, at')) return pool;
    if (text.includes('FROM probe_log')) return quota;
    return [];
  });
}
const BOTH_DAILY = [blocked('gemini-a', 'daily', '2026-11-22T08:00:00.000Z'), blocked('gemini-b', 'daily', '2026-11-22T08:00:00.000Z')];

describe('brain/state: תוויות הכרטיס', () => {
  test('returnsLabel בשעון ישראל: היום / מחר / תאריך', () => {
    assert.equal(returnsLabel(new Date('2026-11-21T12:01:00Z'), NOW), 'היום ב-14:01');
    assert.equal(returnsLabel(new Date('2026-11-22T08:00:00Z'), NOW), 'מחר ב-10:00');
    assert.equal(returnsLabel(new Date('2026-11-21T08:00:00Z'), new Date('2026-11-21T05:00:00Z')), 'היום ב-10:00');
    assert.equal(returnsLabel(new Date('2026-11-23T08:00:00Z'), NOW), 'ב-23.11 ב-10:00');
  });
  test('חצות בישראל: 23:30 UTC של ה-21 הוא כבר ה-22 בישראל', () => {
    assert.equal(returnsLabel(new Date('2026-11-22T08:00:00Z'), new Date('2026-11-21T22:30:00Z')), 'היום ב-10:00');
  });
  test('שלושת סוגי המגבלה', () => {
    assert.equal(KIND_LABELS.daily, 'יומית (בקשות ביום)');
    assert.equal(KIND_LABELS.minute, 'לדקה (בקשות בדקה)');
    assert.equal(KIND_LABELS.unknown, 'לא ידוע איזו מגבלה');
  });
  test('quotaCardFields', () => {
    assert.deepEqual(quotaCardFields({ until: new Date('2026-11-22T08:00:00Z'), kind: 'daily', model: 'gemini-a' }, NOW), {
      until: '2026-11-22T08:00:00.000Z', kind: 'daily', model: 'gemini-a', kind_label: 'יומית (בקשות ביום)', returns_label: 'מחר ב-10:00',
    });
  });
});

describe('brain/state: loadQuotaCard', () => {
  test('יש מודל פנוי: null', async () => {
    assert.equal(await loadQuotaCard(brainDb({ quota: [BOTH_DAILY[0]] }), NOW), null);
  });
  test('כולם חסומים: הכרטיס', async () => {
    assert.equal((await loadQuotaCard(brainDb({ quota: BOTH_DAILY }), NOW)).returns_label, 'מחר ב-10:00');
  });
  test('רשימה ריקה: null (אין "נגמרה מכסה")', async () => {
    assert.equal(await loadQuotaCard(brainDb({ pool: [] }), NOW), null);
  });
  test('כשל מסד: null, ובלוג רק שם השגיאה', async (t) => {
    const out = captureConsole(t);
    assert.equal(await loadQuotaCard(brainDb({ fail: true }), NOW), null);
    assert.match(out.text(), /NeonDbError/);
    assert.doesNotMatch(out.text(), /db down/);
  });
  test('קורא רק מ-probe_log, בלי כתיבה', async () => {
    const sql = brainDb({ quota: BOTH_DAILY });
    await loadQuotaCard(sql, NOW);
    assert.ok(sql.calls.every((c) => c.text.startsWith('SELECT') && c.text.includes('FROM probe_log')));
  });
});

describe('chat GET: השדה quota', () => {
  const get = (sql) => handle(req('https://x.test/api/chat', { headers: { 'x-intake-secret': FAKE_SECRET } }), { sql, secret: FAKE_SECRET, timetable: null, now: () => NOW });
  test('לא חסום: quota = null', async () => {
    const body = await (await get(brainDb())).json();
    assert.ok('quota' in body);
    assert.equal(body.quota, null);
  });
  test('כל הרשימה חסומה: quota עם until, kind ותוויות', async () => {
    const body = await (await get(brainDb({ quota: BOTH_DAILY }))).json();
    assert.deepEqual(body.quota, { until: '2026-11-22T08:00:00.000Z', kind: 'daily', model: 'gemini-a', kind_label: 'יומית (בקשות ביום)', returns_label: 'מחר ב-10:00' });
  });
  test('כשל בקריאת המכסה לא שובר את הצ\'אט', async (t) => {
    captureConsole(t);
    const res = await get(brainDb({ fail: true }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).quota, null);
  });
});

describe('chat-notify: sendQuotaNotification', () => {
  const stateSql = () => fakeSql(() => [{ pending: 1, unread: 0, has_unseen: false }]);
  function fakePush(status = 200) {
    const seen = [];
    const fn = async (request) => { seen.push(JSON.parse(await request.text())); return new Response('ok', { status }); };
    fn.seen = seen;
    return fn;
  }
  const until = new Date('2026-11-22T08:00:00.000Z');
  test('שולחת פעם אחת, עם dedupe לפי שעת החזרה ובלי תוכן הודעה', async () => {
    const push = fakePush();
    const result = await sendQuotaNotification({ sql: stateSql(), pushHandle: push, secret: FAKE_CRON, until, kind: 'daily', now: NOW });
    assert.equal(result.sent, true);
    assert.deepEqual(push.seen[0], { title: PUSH_TITLE, body: 'נגמרה מכסת ה-AI · חוזר מחר ב-10:00', navigate: '/', app_badge: 1, dedupe_key: 'brain-quota:2026-11-22T08:00:00.000Z' });
  });
  test('בלי סוד: לא נשלחת', async () => {
    const push = fakePush();
    assert.equal((await sendQuotaNotification({ sql: stateSql(), pushHandle: push, secret: undefined, until, kind: 'daily', now: NOW })).reason, 'no-secret');
    assert.equal(push.seen.length, 0);
  });
  test('כשל בדחיפה לא נזרק', async (t) => {
    captureConsole(t);
    const push = async () => { throw new Error('x'); };
    assert.equal((await sendQuotaNotification({ sql: stateSql(), pushHandle: push, secret: FAKE_CRON, until, kind: 'daily', now: NOW })).reason, 'push-error');
  });
});
