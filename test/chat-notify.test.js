// בדיקות ל-lib/chat-notify.js (שלב 8.2א-3, docs/08-chapter8/47 "8.2א-3"): טקסט ההתראה, קריאת המצב והשליחה. רק נתונים מומצאים, בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notifyText, loadNotifyState, sendChatNotification, PUSH_TITLE, SITE_ORIGIN } from '../lib/chat-notify.js';
import { fakeSql, captureConsole, FAKE_CRON } from './helpers.js';

const SLOT = 'notify-1792000080';

// מסד מדומה: שאילתת המצב מחזירה שורה אחת.
const stateSql = ({ pending = 0, unread = 0, hasUnseen = false } = {}) => fakeSql(() => [{ pending, unread, has_unseen: hasUnseen }]);

// handle מזויף של push-send: רושם את הבקשה ומחזיר סטטוס.
function fakePush(status = 200) {
  const seen = [];
  const handle = async (request, deps) => {
    seen.push({ request, deps, body: JSON.parse(await request.clone().text()) });
    if (typeof status === 'function') return status();
    return new Response('ok', { status });
  };
  handle.seen = seen;
  return handle;
}

describe('chat-notify: notifyText', () => {
  test('ממתינה אחת: "שאלה אחת ממתינה"', () => assert.equal(notifyText({ pending: 1, unread: 0 }), 'שאלה אחת ממתינה'));
  test('כמה ממתינות: "N ממתינות לתשובה" עם המספר', () => {
    assert.equal(notifyText({ pending: 3, unread: 0 }), '3 ממתינות לתשובה');
    assert.equal(notifyText({ pending: 12, unread: 4 }), '12 ממתינות לתשובה');
  });
  test('אין ממתינות: "הודעה חדשה"', () => {
    assert.equal(notifyText({ pending: 0, unread: 2 }), 'הודעה חדשה');
    assert.equal(notifyText({}), 'הודעה חדשה');
    assert.equal(notifyText(), 'הודעה חדשה');
  });
  test('ערכים לא תקינים נחשבים אפס', () => {
    assert.equal(notifyText({ pending: -2 }), 'הודעה חדשה');
    assert.equal(notifyText({ pending: 'x' }), 'הודעה חדשה');
    assert.equal(notifyText({ pending: 2.5 }), 'הודעה חדשה');
  });
  test('הקבועים', () => {
    assert.equal(PUSH_TITLE, 'מערכת יומן');
    assert.equal(SITE_ORIGIN, 'https://yoman-system.vercel.app');
  });
});

describe('chat-notify: loadNotifyState', () => {
  test('קורא ספירות ו-hasUnseen בשאילתה אחת, באותם תנאים כמו המספר על האייקון', async () => {
    const sql = stateSql({ pending: 2, unread: 3, hasUnseen: true });
    assert.deepEqual(await loadNotifyState(sql), { pending: 2, unread: 3, hasUnseen: true });
    assert.equal(sql.calls.length, 1);
    const { text } = sql.calls[0];
    assert.match(text, /kind = 'question' AND awaiting_reply = true/);
    assert.match(text, /direction = 'out' AND kind = 'update' AND read_at IS NULL/);
    assert.match(text, /EXISTS/);
    assert.doesNotMatch(text, /body|raw_content/, 'לא קורא תוכן הודעות');
  });
  test('שורה חסרה או ערכים לא תקינים: אפסים ו-false', async () => {
    assert.deepEqual(await loadNotifyState(fakeSql(() => [])), { pending: 0, unread: 0, hasUnseen: false });
    assert.deepEqual(await loadNotifyState(fakeSql(() => [{ pending: null, unread: 'x', has_unseen: 'true' }])), { pending: 0, unread: 0, hasUnseen: false });
  });
  test('כשל מסד נזרק', async () => {
    await assert.rejects(() => loadNotifyState(fakeSql(() => { throw new Error('db down'); })), /db down/);
  });
});

describe('chat-notify: sendChatNotification (קריטריון 2)', () => {
  test('מספר 0: לא שולח כלום', async () => {
    const push = fakePush();
    const out = await sendChatNotification({ sql: stateSql({ pending: 0, unread: 0, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.deepEqual(out, { sent: false, reason: 'badge-zero', badge: 0 });
    assert.equal(push.seen.length, 0);
  });
  test('אין הודעה שלא הוצגה: לא שולח, גם כשהמספר גדול מ-0', async () => {
    const push = fakePush();
    const out = await sendChatNotification({ sql: stateSql({ pending: 1, unread: 2, hasUnseen: false }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.deepEqual(out, { sent: false, reason: 'nothing-unseen', badge: 3 });
    assert.equal(push.seen.length, 0);
  });
  test('מספר גדול מ-0 ויש הודעה שלא הוצגה: שולח בקשה אחת ל-push-send עם הכותרת, הגוף, ה-badge וה-dedupe_key', async () => {
    const push = fakePush(200);
    const sql = stateSql({ pending: 1, unread: 2, hasUnseen: true });
    const out = await sendChatNotification({ sql, slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.deepEqual(out, { sent: true, status: 200, badge: 3 });
    assert.equal(push.seen.length, 1);
    const { request, deps, body } = push.seen[0];
    assert.equal(request.method, 'POST');
    assert.equal(request.url, 'https://yoman-system.vercel.app/api/push-send');
    assert.equal(request.headers.get('authorization'), `Bearer ${FAKE_CRON}`);
    assert.deepEqual(body, { title: 'מערכת יומן', body: 'שאלה אחת ממתינה', navigate: '/', app_badge: 3, dedupe_key: SLOT });
    assert.equal(deps.sql, sql);
  });
  test('כמה ממתינות: הנוסח עם המספר, וה-badge המלא כולל "לא נקראו"', async () => {
    const push = fakePush();
    await sendChatNotification({ sql: stateSql({ pending: 3, unread: 1, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen[0].body.body, '3 ממתינות לתשובה');
    assert.equal(push.seen[0].body.app_badge, 4);
  });
  test('רק בועות שלא נקראו: "הודעה חדשה"', async () => {
    const push = fakePush();
    await sendChatNotification({ sql: stateSql({ pending: 0, unread: 2, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen[0].body.body, 'הודעה חדשה');
  });
  test('ה-badge נחתך ל-9999 (תקרת push-send)', async () => {
    const push = fakePush();
    await sendChatNotification({ sql: stateSql({ pending: 0, unread: 20000, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen[0].body.app_badge, 9999);
  });
  test('הבקשה והגוף לא מכילים תוכן הודעה: אין שאילתת תוכן, והגוף הוא אחד מהנוסחים הקבועים', async () => {
    const push = fakePush();
    const sql = stateSql({ pending: 2, unread: 0, hasUnseen: true });
    await sendChatNotification({ sql, slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.deepEqual(Object.keys(push.seen[0].body).sort(), ['app_badge', 'body', 'dedupe_key', 'navigate', 'title']);
    assert.ok(['שאלה אחת ממתינה', 'הודעה חדשה'].includes(push.seen[0].body.body) || /^\d+ ממתינות לתשובה$/.test(push.seen[0].body.body));
    assert.ok(sql.calls.every((c) => !/\bbody\b|raw_content/.test(c.text)));
  });
  test('בלי סוד: לא שולח ומחזיר no-secret', async () => {
    const push = fakePush();
    const out = await sendChatNotification({ sql: stateSql({ pending: 1, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: '' });
    assert.deepEqual(out, { sent: false, reason: 'no-secret', badge: 1 });
    assert.equal(push.seen.length, 0);
  });
  test('סטטוס לא 2xx מ-push-send: sent=false עם push-status, בלי לזרוק', async () => {
    for (const status of [401, 429, 500]) {
      const out = await sendChatNotification({ sql: stateSql({ pending: 1, hasUnseen: true }), slotKey: SLOT, pushHandle: fakePush(status), secret: FAKE_CRON });
      assert.deepEqual(out, { sent: false, reason: 'push-status', status, badge: 1 });
    }
  });
  test('push-send זורק: נתפס, נרשם בשם השגיאה בלבד, sent=false', async (t) => {
    const logged = captureConsole(t);
    const push = fakePush(() => { throw Object.assign(new Error(`secret ${FAKE_CRON} detail`), { name: 'BoomError' }); });
    const out = await sendChatNotification({ sql: stateSql({ pending: 1, hasUnseen: true }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON });
    assert.deepEqual(out, { sent: false, reason: 'push-error', status: null, badge: 1 });
    assert.match(logged.text(), /BoomError/);
    assert.doesNotMatch(logged.text(), new RegExp(FAKE_CRON));
  });
  test('כשל מסד בקריאת המצב נזרק (התור ינסה שוב)', async () => {
    const push = fakePush();
    await assert.rejects(() => sendChatNotification({ sql: fakeSql(() => { throw new Error('db down'); }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON }), /db down/);
    assert.equal(push.seen.length, 0);
  });
});

describe('chat-notify: קבצי הדחיפה לא שונו ובקובץ אין סוד', () => {
  test('lib/chat-notify.js מייבא את handle של push-send ואינו מכיל סוד או fetch(', () => {
    const text = readFileSync(new URL('../lib/chat-notify.js', import.meta.url), 'utf8');
    assert.match(text, /import \{ handle as pushSendHandle \} from '\.\.\/api\/push-send\.js'/);
    assert.doesNotMatch(text.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '')).join('\n'), /fetch\(|process\.env/);
  });
});
