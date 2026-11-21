// בדיקות לשקט בחלון "לא זמין" (בלוק 3ב-2, אפיון-מורחב ח-2): בזמן החלון אין דחיפות, ובסופו נשלחת התראה אחת. נתונים מומצאים, בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { quietUntil, planResume, deferIfQuiet, RESUME_MAX_DELAY_SECONDS } from '../lib/quiet.js';
import { parseSlotMessage } from '../lib/message-slots.js';
import { sendChatNotification, sendBriefNotification, sendClosingNotification, sendQuotaNotification, sendResumeNotification } from '../lib/chat-notify.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, captureConsole, FAKE_CRON } from './helpers.js';

const NOW = new Date('2026-11-23T15:10:00.000Z'); // 17:10 בישראל
const UNTIL = '2026-11-23T17:00:00.000Z'; // 19:00 בישראל

// מסד מדומה: שאילתת החלון מחזירה until (או כלום), שאילתת המצב מחזירה ספירות.
const quietSql = ({ until = UNTIL, pending = 1, unread = 0, hasUnseen = true } = {}) => fakeSql((text) => {
  if (text.includes("domain = 'unavailable'")) return [{ until: until ? new Date(until) : null }];
  if (text.includes('FROM intake_outcomes o')) return [];
  return [{ pending, unread, has_unseen: hasUnseen }];
});

function fakePush() {
  const seen = [];
  const handle = async (request) => {
    seen.push(JSON.parse(await request.clone().text()));
    return new Response('ok', { status: 200 });
  };
  handle.seen = seen;
  return handle;
}

function fakeSend() {
  const calls = [];
  const send = async (...args) => { calls.push(args); };
  send.calls = calls;
  return send;
}

describe('quiet: quietUntil', () => {
  test('חלון פעיל: מחזיר את סופו; השאילתה לפי domain unavailable, planned, ומכסה את now', async () => {
    const sql = quietSql();
    const until = await quietUntil(sql, NOW);
    assert.equal(until.toISOString(), UNTIL);
    const { text, values } = sql.calls[0];
    assert.match(text, /domain = 'unavailable'/);
    assert.match(text, /status = 'planned'/);
    assert.match(text, /starts_at <= /);
    assert.match(text, /ends_at > /);
    assert.ok(values.includes(NOW.toISOString()));
  });
  test('אין חלון: null', async () => {
    assert.equal(await quietUntil(quietSql({ until: null }), NOW), null);
    assert.equal(await quietUntil(fakeSql(() => []), NOW), null);
  });
  test('כשל מסד: null (נכשל פתוח: עדיף התראה מאשר הודעה שאבדה), נרשם רק שם השגיאה', async (t) => {
    const logged = captureConsole(t);
    assert.equal(await quietUntil(fakeSql(() => { throw Object.assign(new Error('x'), { name: 'DbError' }); }), NOW), null);
    assert.match(logged.text(), /DbError/);
  });
});

describe('quiet: planResume ו-parseSlotMessage', () => {
  test('מפתח resume-<שניות>, יעד = סוף החלון, השהיה עד אליו', () => {
    const plan = planResume(new Date(UNTIL), NOW);
    assert.equal(plan.kind, 'resume');
    assert.equal(plan.slotKey, `resume-${Date.parse(UNTIL) / 1000}`);
    assert.equal(plan.targetAt, UNTIL);
    assert.equal(plan.delaySeconds, 6600);
    assert.ok(plan.retentionSeconds > plan.delaySeconds);
  });
  test('חלון ארוך מהתקרה: ההשהיה נחתכת (ההודעה תגיע מוקדם, תבדוק שוב ותידחה שוב)', () => {
    const far = new Date(NOW.getTime() + 30 * 86400 * 1000);
    assert.equal(planResume(far, NOW).delaySeconds, RESUME_MAX_DELAY_SECONDS);
  });
  test('הודעת resume שנוצרה אצלנו עוברת את parseSlotMessage; יעד שלא מתאים למפתח נדחה', () => {
    const plan = planResume(new Date(UNTIL), NOW);
    assert.deepEqual(parseSlotMessage({ kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }), { ok: true, kind: 'resume', slotKey: plan.slotKey, targetAt: UNTIL });
    assert.deepEqual(parseSlotMessage({ kind: 'resume', slotKey: plan.slotKey, targetAt: '2026-11-23T18:00:00.000Z' }), { ok: false, reason: 'bad-target' });
  });
});

describe('quiet: deferIfQuiet', () => {
  test('בחלון: שולח לתור הודעת resume אחת עם מפתח אידמפוטנטיות, ומחזיר את סוף החלון', async () => {
    const send = fakeSend();
    const out = await deferIfQuiet({ sql: quietSql(), now: NOW, send });
    assert.equal(out.until.toISOString(), UNTIL);
    assert.equal(send.calls.length, 1);
    const [topic, payload, options] = send.calls[0];
    assert.equal(topic, 'daily-slots');
    assert.deepEqual(payload, { kind: 'resume', slotKey: `resume-${Date.parse(UNTIL) / 1000}`, targetAt: UNTIL });
    assert.equal(options.idempotencyKey, payload.slotKey);
  });
  test('מחוץ לחלון: null, בלי תור', async () => {
    const send = fakeSend();
    assert.equal(await deferIfQuiet({ sql: quietSql({ until: null }), now: NOW, send }), null);
    assert.equal(send.calls.length, 0);
  });
  test('כשל בתור: עדיין שקט (לא נזרק)', async (t) => {
    captureConsole(t);
    const out = await deferIfQuiet({ sql: quietSql(), now: NOW, send: async () => { throw new Error('queue'); } });
    assert.equal(out.until.toISOString(), UNTIL);
  });
});

describe('quiet: כל ההתראות שותקות בחלון', () => {
  const cases = [
    ['notify', (deps) => sendChatNotification({ ...deps, slotKey: 'notify-1792000080' })],
    ['brief', (deps) => sendBriefNotification({ ...deps, slotKey: 'brief-2026-11-23', body: 'בוקר' })],
    ['close', (deps) => sendClosingNotification({ ...deps, slotKey: 'close-2026-11-23', body: 'ערב' })],
    ['quota', (deps) => sendQuotaNotification({ ...deps, until: new Date('2026-11-24T08:00:00Z'), kind: 'day' })],
  ];
  for (const [name, run] of cases) {
    test(`${name}: בחלון לא נשלחת דחיפה, reason=unavailable, ונקבעת התראה לסוף החלון`, async () => {
      const push = fakePush();
      const send = fakeSend();
      const out = await run({ sql: quietSql(), pushHandle: push, secret: FAKE_CRON, now: NOW, send });
      assert.equal(out.sent, false);
      assert.equal(out.reason, 'unavailable');
      assert.equal(push.seen.length, 0);
      assert.equal(send.calls.length, 1);
    });
    test(`${name}: מחוץ לחלון נשלחת כרגיל`, async () => {
      const push = fakePush();
      const send = fakeSend();
      const out = await run({ sql: quietSql({ until: null }), pushHandle: push, secret: FAKE_CRON, now: NOW, send });
      assert.equal(out.sent, true);
      assert.equal(push.seen.length, 1);
      assert.equal(send.calls.length, 0);
    });
  }
});

describe('quiet: התראת סוף החלון (resume)', () => {
  test('אחרי החלון: דחיפה אחת עם הנוסח הרגיל וה-dedupe של המפתח, גם כשאין הודעה שלא נקראה (משהו נדחה)', async () => {
    const push = fakePush();
    const out = await sendResumeNotification({ sql: quietSql({ until: null, pending: 0, unread: 0, hasUnseen: false }), slotKey: 'resume-1795194000', pushHandle: push, secret: FAKE_CRON, now: NOW, send: fakeSend() });
    assert.equal(out.sent, true);
    assert.deepEqual(push.seen[0], { title: 'מערכת יומן', body: 'הודעה חדשה', navigate: '/', app_badge: 0, dedupe_key: 'resume-1795194000' });
  });
  test('החלון הוארך בינתיים: לא נשלח, נדחה שוב', async () => {
    const push = fakePush();
    const send = fakeSend();
    const out = await sendResumeNotification({ sql: quietSql(), slotKey: 'resume-1795194000', pushHandle: push, secret: FAKE_CRON, now: NOW, send });
    assert.equal(out.reason, 'unavailable');
    assert.equal(push.seen.length, 0);
    assert.equal(send.calls.length, 1);
  });
  test('הצרכן: הודעת resume שולחת ורושמת שורת chat-notify אחת', async () => {
    const push = fakePush();
    const sql = quietSql({ until: null });
    const plan = planResume(new Date(UNTIL), NOW);
    const out = await handleDelivery({ kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }, { deliveryCount: 1 }, { sql, now: () => new Date(UNTIL), pushHandle: push, secret: FAKE_CRON });
    assert.equal(out.sent, true);
    assert.equal(push.seen.length, 1);
    assert.equal(sql.find("SELECT 'chat-notify'").length, 1);
  });
});
