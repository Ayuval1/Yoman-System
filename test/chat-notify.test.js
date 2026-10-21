// בדיקות ל-lib/chat-notify.js (שלב 8.2א-3, docs/08-chapter8/47 "8.2א-3"): טקסט ההתראה, קריאת המצב והשליחה. רק נתונים מומצאים, בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notifyText, loadNotifyState, sendChatNotification, sendReviewNotification, sendBriefNotification, PUSH_TITLE, SITE_ORIGIN, REVIEW_PUSH_BODY } from '../lib/chat-notify.js';
import { fakeSql, captureConsole, FAKE_CRON, REVIEW_NOW, reviewRow } from './helpers.js';

const SLOT = 'notify-1792000080';

// מסד מדומה: שאילתת המצב מחזירה שורה אחת, ושאילתת סיכום היום (M.2) מחזירה את due (שורות מועמד מ-reviewRow; ברירת מחדל: אין).
const stateSql = ({ pending = 0, unread = 0, hasUnseen = false, due = [] } = {}) => fakeSql((text) => (text.includes('FROM intake_outcomes o') ? due : [{ pending, unread, has_unseen: hasUnseen }]));

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
  test('קורא ספירות ו-hasUnseen בשאילתה אחת, באותם תנאים כמו המספר על האייקון, ואחריה ספירת סיכום היום (M.2)', async () => {
    const sql = stateSql({ pending: 2, unread: 3, hasUnseen: true });
    assert.deepEqual(await loadNotifyState(sql, REVIEW_NOW), { pending: 2, unread: 3, review: 0, openTasks: 0, hasUnseen: true });
    assert.equal(sql.calls.length, 2);
    const { text } = sql.calls[0];
    assert.match(text, /kind = 'question' AND awaiting_reply = true/);
    assert.match(text, /direction = 'out' AND kind = 'update' AND read_at IS NULL/);
    assert.match(text, /EXISTS/);
    assert.ok(sql.calls.every((c) => !/\bbody\b|raw_content/.test(c.text)), 'לא קורא תוכן הודעות, גם לא בספירת הסיכום');
  });
  test('שורה חסרה או ערכים לא תקינים: אפסים ו-false', async () => {
    assert.deepEqual(await loadNotifyState(fakeSql(() => []), REVIEW_NOW), { pending: 0, unread: 0, review: 0, openTasks: 0, hasUnseen: false });
    const invalid = fakeSql((text) => (text.includes('FROM intake_outcomes o') ? [] : [{ pending: null, unread: 'x', has_unseen: 'true' }]));
    assert.deepEqual(await loadNotifyState(invalid, REVIEW_NOW), { pending: 0, unread: 0, review: 0, openTasks: 0, hasUnseen: false });
  });
  test('קריטריון 9: review הוא 1 כשיש לפחות הודעה אחת לסימון (גם כשיש כמה), 0 כשהכול סומן או מחוץ לחלון', async () => {
    const many = await loadNotifyState(stateSql({ due: [reviewRow(1), reviewRow(2), reviewRow(3)] }), REVIEW_NOW);
    assert.equal(many.review, 1);
    const checked = await loadNotifyState(stateSql({ due: [reviewRow(1, { checked: true })] }), REVIEW_NOW);
    assert.equal(checked.review, 0);
    const expired = await loadNotifyState(stateSql({ due: [reviewRow(1, { recorded_at: new Date('2026-10-13T10:00:00Z'), received_at: new Date('2026-10-13T09:00:00Z') })] }), REVIEW_NOW);
    assert.equal(expired.review, 0);
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
  test('קריטריון 9: הסיכום נכנס למספר (badge) אבל לא ל-hasUnseen: סיכום בלבד לא מפעיל התראת notify רגילה', async () => {
    const push = fakePush();
    const sql = stateSql({ pending: 0, unread: 0, hasUnseen: false, due: [reviewRow(1)] });
    const out = await sendChatNotification({ sql, slotKey: SLOT, pushHandle: push, secret: FAKE_CRON, now: REVIEW_NOW });
    assert.deepEqual(out, { sent: false, reason: 'nothing-unseen', badge: 1 });
    assert.equal(push.seen.length, 0);
  });
  test('קריטריון 9: כשיש גם שאלה ממתינה, ה-app_badge של notify כולל את הסיכום (המספר המלא), והנוסח לא משתנה', async () => {
    const push = fakePush();
    await sendChatNotification({ sql: stateSql({ pending: 1, unread: 0, hasUnseen: true, due: [reviewRow(1)] }), slotKey: SLOT, pushHandle: push, secret: FAKE_CRON, now: REVIEW_NOW });
    assert.equal(push.seen[0].body.app_badge, 2);
    assert.equal(push.seen[0].body.body, 'שאלה אחת ממתינה');
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

describe('chat-notify: sendReviewNotification (קריטריון 10, 57 T10)', () => {
  const dueSql = (extra = {}) => stateSql({ due: [reviewRow(1, { text: 'טקסט-מזהה-שלא-אמור-לצאת' }), reviewRow(2)], ...extra });
  test('יש הודעות לסימון: בקשה אחת עם הכותרת, גוף קבוע, navigate, app_badge מלא ו-dedupe_key של המשבצת; בלי שום טקסט הודעה', async () => {
    const push = fakePush();
    const sql = dueSql({ pending: 1, unread: 2 });
    const out = await sendReviewNotification({ sql, slotKey: 'close-2026-10-16', pushHandle: push, secret: FAKE_CRON, now: REVIEW_NOW });
    assert.deepEqual(out, { sent: true, status: 200, badge: 4 });
    assert.equal(push.seen.length, 1);
    const { request, deps, body } = push.seen[0];
    assert.equal(request.url, 'https://yoman-system.vercel.app/api/push-send');
    assert.equal(request.headers.get('authorization'), `Bearer ${FAKE_CRON}`);
    assert.deepEqual(body, { title: 'מערכת יומן', body: 'סיכום היום מחכה לסימון', navigate: '/', app_badge: 4, dedupe_key: 'close-2026-10-16' });
    assert.equal(REVIEW_PUSH_BODY, 'סיכום היום מחכה לסימון');
    assert.equal(deps.sql, sql);
    assert.ok(!JSON.stringify(body).includes('טקסט-מזהה'), 'בלי תוכן הודעה');
    assert.ok(sql.calls.every((c) => !/raw_content|\bbody\b/.test(c.text)), 'שום שאילתה לא קוראת טקסט הודעה');
  });
  test('אין הודעות לסימון: לא נשלח כלום (גם כשיש שאלות ממתינות)', async () => {
    const push = fakePush();
    const out = await sendReviewNotification({ sql: stateSql({ pending: 3, unread: 1, hasUnseen: true }), slotKey: 'close-2026-10-16', pushHandle: push, secret: FAKE_CRON, now: REVIEW_NOW });
    assert.deepEqual(out, { sent: false, reason: 'review-zero', badge: 4 });
    assert.equal(push.seen.length, 0);
  });
  test('app_badge נחתך ל-9999', async () => {
    const push = fakePush();
    await sendReviewNotification({ sql: dueSql({ unread: 20000 }), slotKey: 'close-2026-10-16', pushHandle: push, secret: FAKE_CRON, now: REVIEW_NOW });
    assert.equal(push.seen[0].body.app_badge, 9999);
  });
  test('בלי סוד: no-secret. סטטוס לא 2xx: push-status. דחיפה זורקת: push-error ושם השגיאה בלבד בלוג', async (t) => {
    const logged = captureConsole(t);
    assert.deepEqual(await sendReviewNotification({ sql: dueSql(), slotKey: 'close-2026-10-16', pushHandle: fakePush(), secret: '', now: REVIEW_NOW }), { sent: false, reason: 'no-secret', badge: 1 });
    assert.deepEqual(await sendReviewNotification({ sql: dueSql(), slotKey: 'close-2026-10-16', pushHandle: fakePush(500), secret: FAKE_CRON, now: REVIEW_NOW }), { sent: false, reason: 'push-status', status: 500, badge: 1 });
    const boom = fakePush(() => { throw Object.assign(new Error(`secret ${FAKE_CRON} טקסט-מזהה`), { name: 'BoomError' }); });
    assert.deepEqual(await sendReviewNotification({ sql: dueSql(), slotKey: 'close-2026-10-16', pushHandle: boom, secret: FAKE_CRON, now: REVIEW_NOW }), { sent: false, reason: 'push-error', status: null, badge: 1 });
    assert.match(logged.text(), /BoomError/);
    assert.doesNotMatch(logged.text(), new RegExp(`${FAKE_CRON}|טקסט-מזהה`));
  });
  test('כשל מסד נזרק (הצרכן תופס)', async () => {
    await assert.rejects(() => sendReviewNotification({ sql: fakeSql(() => { throw new Error('db down'); }), slotKey: 'close-2026-10-16', pushHandle: fakePush(), secret: FAKE_CRON, now: REVIEW_NOW }), /db down/);
  });
});

describe('chat-notify: sendBriefNotification (B-2)', () => {
  const BRIEF_SLOT = 'brief-2026-10-27';
  const BODY = '08:15–15:45 · 9 שיעורים · 3 משימות פתוחות';
  // המצב: משימות פתוחות + שאלות; ההודעה עצמה נוצרת עם read_at מלא ולכן unread=0 ו-hasUnseen=false (כמו בפועל).
  const briefSql = (extra = {}) => fakeSql((text) => (text.includes('FROM intake_outcomes o') ? [] : [{ pending: 1, unread: 0, open_tasks: 3, has_unseen: false, ...extra }]));
  test('נשלחת בלי תלות ב-hasUnseen: בקשה אחת עם הכותרת, הגוף שהועבר, navigate, app_badge=משימות+שאלות ו-dedupe_key=מפתח המשבצת', async () => {
    const push = fakePush();
    const sql = briefSql();
    const out = await sendBriefNotification({ sql, slotKey: BRIEF_SLOT, pushHandle: push, secret: FAKE_CRON, body: BODY, now: REVIEW_NOW });
    assert.deepEqual(out, { sent: true, status: 200, badge: 4 });
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].request.url, 'https://yoman-system.vercel.app/api/push-send');
    assert.equal(push.seen[0].request.headers.get('authorization'), `Bearer ${FAKE_CRON}`);
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: BODY, navigate: '/', app_badge: 4, dedupe_key: BRIEF_SLOT });
    assert.equal(push.seen[0].deps.sql, sql);
  });
  test('נשלחת גם כשה-badge הוא 0 (שבת בלי משימות ובלי שאלות)', async () => {
    const push = fakePush();
    const out = await sendBriefNotification({ sql: briefSql({ pending: 0, open_tasks: 0 }), slotKey: BRIEF_SLOT, pushHandle: push, secret: FAKE_CRON, body: 'יום פנוי', now: REVIEW_NOW });
    assert.deepEqual(out, { sent: true, status: 200, badge: 0 });
    assert.equal(push.seen[0].body.app_badge, 0);
  });
  test('app_badge נחתך ל-9999; הבקשה בלי שאילתת תוכן הודעה', async () => {
    const push = fakePush();
    const sql = briefSql({ unread: 20000 });
    await sendBriefNotification({ sql, slotKey: BRIEF_SLOT, pushHandle: push, secret: FAKE_CRON, body: BODY, now: REVIEW_NOW });
    assert.equal(push.seen[0].body.app_badge, 9999);
    assert.ok(sql.calls.every((c) => !/raw_content|body/.test(c.text)));
  });
  test('בלי סוד: no-secret ולא נשלח. סטטוס לא 2xx: push-status. דחיפה זורקת: push-error ושם השגיאה בלבד בלוג', async (t) => {
    const logged = captureConsole(t);
    const push = fakePush();
    assert.deepEqual(await sendBriefNotification({ sql: briefSql(), slotKey: BRIEF_SLOT, pushHandle: push, secret: '', body: BODY, now: REVIEW_NOW }), { sent: false, reason: 'no-secret', badge: 4 });
    assert.equal(push.seen.length, 0);
    assert.deepEqual(await sendBriefNotification({ sql: briefSql(), slotKey: BRIEF_SLOT, pushHandle: fakePush(500), secret: FAKE_CRON, body: BODY, now: REVIEW_NOW }), { sent: false, reason: 'push-status', status: 500, badge: 4 });
    const boom = fakePush(() => { throw Object.assign(new Error(`secret ${FAKE_CRON}`), { name: 'BoomError' }); });
    assert.deepEqual(await sendBriefNotification({ sql: briefSql(), slotKey: BRIEF_SLOT, pushHandle: boom, secret: FAKE_CRON, body: BODY, now: REVIEW_NOW }), { sent: false, reason: 'push-error', status: null, badge: 4 });
    assert.match(logged.text(), /BoomError/);
    assert.doesNotMatch(logged.text(), new RegExp(FAKE_CRON));
  });
  test('כשל מסד בקריאת המצב נזרק', async () => {
    await assert.rejects(() => sendBriefNotification({ sql: fakeSql(() => { throw new Error('db down'); }), slotKey: BRIEF_SLOT, pushHandle: fakePush(), secret: FAKE_CRON, body: BODY }), /db down/);
  });
});
