// בדיקות ל-api/queues/deliver.js (צרכן התור של משבצות ההודעה) ול-lib/message-slots.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleDelivery } from '../api/queues/deliver.js';
import { planSlot, planNotify, parseSlotMessage, SLOT_TOPIC } from '../lib/message-slots.js';
import { fakeSql, captureConsole, FAKE_CRON, reviewRow } from './helpers.js';

const MSG = { kind: 'brief', slotKey: 'brief-2026-10-09', targetAt: '2026-10-09T04:30:00.000Z' };
const at = (iso) => () => new Date(iso);

describe('message-slots: planSlot', () => {
  test('slot לא מוכר מחזיר null', () => {
    assert.equal(planSlot('9', new Date('2026-10-09T01:00:00Z')), null);
    assert.equal(planSlot('unknown', new Date('2026-10-09T01:00:00Z')), null);
  });
  test('הנושא קבוע', () => assert.equal(SLOT_TOPIC, 'daily-slots'));
  test('הסיבית: היעד תמיד אחרי עכשיו, וההשהיה לא שלילית', () => {
    for (const slot of ['1', '2']) {
      for (const iso of ['2026-10-09T00:00:00Z', '2026-10-09T04:30:00Z', '2026-10-09T23:59:59Z', '2026-10-25T00:30:00Z']) {
        const plan = planSlot(slot, new Date(iso));
        assert.ok(Date.parse(plan.targetAt) > Date.parse(iso));
        assert.ok(plan.delaySeconds >= 0);
        assert.ok(plan.retentionSeconds > plan.delaySeconds);
      }
    }
  });
  test('מפתח המשבצת לפי התאריך המקומי של היעד, גם כשהיעד הוא אחרי חצות UTC', () => {
    // 21:00 בישראל ב-2026-10-09 = 18:00Z, אותו תאריך. 07:30 בישראל = 04:30Z, אותו תאריך.
    assert.equal(planSlot('2', new Date('2026-10-09T14:00:00Z')).slotKey, 'close-2026-10-09');
    assert.equal(planSlot('1', new Date('2026-10-09T01:00:00Z')).slotKey, 'brief-2026-10-09');
  });
  test('retention לא עולה על 7 ימים', () => {
    assert.ok(planSlot('1', new Date('2026-10-09T01:00:00Z')).retentionSeconds <= 604800);
  });
});

describe('message-slots: parseSlotMessage', () => {
  test('הודעה תקינה', () => assert.deepEqual(parseSlotMessage(MSG), { ok: true, ...MSG }));
  test('הודעות לא תקינות נדחות עם סיבה', () => {
    for (const bad of [null, 'x', 5, {}, { ...MSG, slotKey: 'brief-2026-1-9' }, { ...MSG, slotKey: "brief-2026-10-09'; DROP" },
      { ...MSG, kind: 'close' }, { ...MSG, targetAt: 'nope' }, { ...MSG, targetAt: 123 }, { ...MSG, slotKey: 'other-2026-10-09', kind: 'other' }]) {
      assert.equal(parseSlotMessage(bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe('queue-deliver: handleDelivery', () => {
  test('הגעה בזמן: שורת probe_log אחת עם ok=true, איחור, ומספר מסירה', async () => {
    const sql = fakeSql();
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: at('2026-10-09T04:30:00.800Z') });
    assert.equal(out.stored, true);
    assert.equal(out.lateSeconds, 0.8);
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /INSERT INTO probe_log/);
    assert.match(sql.calls[0].text, /WHERE NOT EXISTS/);
    assert.equal(sql.calls[0].values[0], true);
    assert.equal(sql.calls[0].values[1], 'slot=brief-2026-10-09; target_utc=2026-10-09T04:30:00.000Z; delivered_utc=2026-10-09T04:30:00.800Z; late_s=0.8; delivery_count=1');
    assert.equal(sql.calls[0].values[2], 'slot=brief-2026-10-09;%');
  });
  test('איחור של יותר מ-120 שניות נרשם ok=false', async () => {
    const sql = fakeSql();
    const out = await handleDelivery(MSG, {}, { sql, now: at('2026-10-09T04:33:00.000Z') });
    assert.equal(out.ok, false);
    assert.equal(sql.calls[0].values[0], false);
    assert.match(sql.calls[0].values[1], /delivery_count=null/);
  });
  test('הודעה פגומה: לא נכתב כלום, לא נזרק (לא נכנסים ללולאת ניסיונות)', async (t) => {
    captureConsole(t);
    const sql = fakeSql();
    const out = await handleDelivery({ slotKey: 'x' }, {}, { sql, now: at('2026-10-09T04:30:00Z') });
    assert.equal(out.stored, false);
    assert.equal(sql.calls.length, 0);
  });
  test('כשל במסד נזרק, כדי שהתור ינסה שוב', async () => {
    const sql = fakeSql(() => { throw new Error('db down'); });
    await assert.rejects(() => handleDelivery(MSG, {}, { sql, now: at('2026-10-09T04:30:00Z') }), /db down/);
  });
  test('ייבוא הקובץ לא יוצר לקוח תור ולא דורש משתני סביבה', async () => {
    const mod = await import('../api/queues/deliver.js');
    assert.equal(typeof mod.default, 'function');
  });
});

// ---------------------------------------------------------------------------
// שלב 8.2א-3 (docs/08-chapter8/47, "8.2א-3"): סוג ההודעה notify. "קריטריון N" = קריטריון הקבלה N בטבלת 8.2א-3.
// חלונות של 30 שניות לפי epoch (במפרט 120; קוצר ב-14.10.2026): 1792000080 = 59,733,336 * 30 (מתחלק ב-30). כל הנתונים מומצאים.
// ---------------------------------------------------------------------------
const W0 = 1792000080; // תחילת חלון
const WINDOW_MS = 30_000;
const atSec = (sec) => new Date(sec * 1000);

describe('message-slots: planNotify (קריטריון 1)', () => {
  test('שלוש הודעות באותו חלון = אותו slotKey, אותו יעד (הודעת תור אחת)', () => {
    const plans = [W0, W0 + 15.5, W0 + 29.999].map((sec) => planNotify(atSec(sec)));
    assert.equal(new Set(plans.map((p) => p.slotKey)).size, 1);
    assert.equal(new Set(plans.map((p) => p.targetAt)).size, 1);
    assert.equal(plans[0].kind, 'notify');
    assert.equal(plans[0].slotKey, `notify-${W0}`);
  });
  test('היעד הוא סוף החלון ועוד 5 שניות', () => {
    assert.equal(planNotify(atSec(W0 + 10)).targetAt, atSec(W0 + 35).toISOString());
  });
  test('ההשהיה היא מה שנשאר עד היעד (לא שלילית, מעוגל כלפי מעלה), וה-retention ארוכה ממנה ועד 7 ימים', () => {
    assert.equal(planNotify(atSec(W0)).delaySeconds, 35);
    assert.equal(planNotify(atSec(W0 + 10)).delaySeconds, 25);
    assert.equal(planNotify(atSec(W0 + 10.2)).delaySeconds, 25); // 24.8 -> 25
    assert.equal(planNotify(atSec(W0 + 29.999)).delaySeconds, 6); // 5.001 -> 6
    for (const sec of [W0, W0 + 17, W0 + 29.999]) {
      const plan = planNotify(atSec(sec));
      assert.ok(plan.delaySeconds >= 0);
      assert.equal(plan.retentionSeconds, plan.delaySeconds + 86400);
      assert.ok(plan.retentionSeconds <= 604800);
    }
  });
  test('גבול החלון: הרגע האחרון של החלון נשאר בו, והרגע המדויק של הגבול הוא חלון חדש', () => {
    const last = planNotify(new Date(W0 * 1000 + WINDOW_MS - 1));
    const next = planNotify(new Date(W0 * 1000 + WINDOW_MS));
    assert.equal(last.slotKey, `notify-${W0}`);
    assert.equal(next.slotKey, `notify-${W0 + 30}`);
  });
  test('הודעה אחרי המסירה של חלון קודם = חלון חדש (המסירה בסוף החלון + 5 שניות)', () => {
    const first = planNotify(atSec(W0 + 10));
    const deliveredAt = new Date(first.targetAt);
    const after = planNotify(deliveredAt);
    assert.notEqual(after.slotKey, first.slotKey);
    assert.equal(after.slotKey, `notify-${W0 + 30}`);
    assert.ok(Date.parse(after.targetAt) > deliveredAt.getTime());
  });
  test('בלי "עכשיו": ברירת מחדל תקינה', () => {
    assert.match(planNotify().slotKey, /^notify-\d{10}$/);
  });
  test('brief ו-close לא השתנו', () => {
    assert.equal(planSlot('1', new Date('2026-10-09T01:00:00Z')).slotKey, 'brief-2026-10-09');
    assert.equal(planSlot('2', new Date('2026-10-09T14:00:00Z')).slotKey, 'close-2026-10-09');
  });
});

describe('message-slots: parseSlotMessage עם notify', () => {
  const NOTIFY = { kind: 'notify', slotKey: `notify-${W0}`, targetAt: atSec(W0 + 35).toISOString() };
  test('הודעת notify תקינה (בדיוק כפי ש-planNotify מייצרת)', () => {
    assert.deepEqual(parseSlotMessage(NOTIFY), { ok: true, ...NOTIFY });
    const plan = planNotify(atSec(W0 + 33));
    assert.equal(parseSlotMessage({ kind: plan.kind, slotKey: plan.slotKey, targetAt: plan.targetAt }).ok, true);
  });
  test('שילובים לא תקינים נדחים', () => {
    const bad = [
      { ...NOTIFY, kind: 'brief' }, { ...NOTIFY, kind: 'close' }, { ...NOTIFY, kind: 'other' },
      { kind: 'notify', slotKey: 'brief-2026-10-09', targetAt: NOTIFY.targetAt },
      { kind: 'brief', slotKey: `notify-${W0}`, targetAt: NOTIFY.targetAt },
      { ...NOTIFY, slotKey: 'notify-' }, { ...NOTIFY, slotKey: 'notify-abc' }, { ...NOTIFY, slotKey: `notify-${W0}; DROP` },
      { ...NOTIFY, slotKey: 'notify-2026-10-09' }, { ...NOTIFY, slotKey: `notify-${W0}-5` },
      { ...NOTIFY, targetAt: 'nope' }, { ...NOTIFY, targetAt: 123 },
      { ...NOTIFY, targetAt: atSec(W0 + 120).toISOString() }, // היעד לא מתאים לחלון שבמפתח
      { ...NOTIFY, targetAt: atSec(W0 + 245).toISOString() },
    ];
    for (const message of bad) assert.equal(parseSlotMessage(message).ok, false, JSON.stringify(message));
  });
});

describe('queue-deliver: handleDelivery עם notify', () => {
  const NOTIFY = { kind: 'notify', slotKey: `notify-${W0}`, targetAt: atSec(W0 + 35).toISOString() };
  const DELIVERED = atSec(W0 + 35.4);
  // מסד מדומה: שאילתת המצב מחזירה את state, וכל השאר ריק.
  const db = (state = { pending: 1, unread: 0, has_unseen: true }) => fakeSql((text) => (text.includes('has_unseen') ? [state] : []));
  const fakePush = (status = 200) => {
    const handle = async (request) => { handle.seen.push({ request, body: JSON.parse(await request.clone().text()) }); return new Response('ok', { status }); };
    handle.seen = [];
    return handle;
  };
  const probeWrites = (sql) => sql.calls.filter((c) => c.text.includes('INSERT INTO probe_log'));

  test('הודעה עם ממתינות: דחיפה אחת, ושורת probe_log אחת עם probe=chat-notify, אידמפוטנטית לפי slotKey', async () => {
    const sql = db({ pending: 1, unread: 1, has_unseen: true });
    const push = fakePush();
    const out = await handleDelivery(NOTIFY, { deliveryCount: 1 }, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON });
    assert.equal(out.stored, true);
    assert.equal(out.sent, true);
    assert.equal(out.ok, true);
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.dedupe_key, NOTIFY.slotKey);
    assert.equal(push.seen[0].body.app_badge, 2);
    const writes = probeWrites(sql);
    assert.equal(writes.length, 1);
    assert.match(writes[0].text, /SELECT 'chat-notify', \?, \? WHERE NOT EXISTS \(SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE \?\)/);
    assert.equal(writes[0].values[0], true);
    assert.equal(writes[0].values[1], `slot=${NOTIFY.slotKey}; target_utc=${NOTIFY.targetAt}; delivered_utc=${DELIVERED.toISOString()}; late_s=0.4; delivery_count=1; badge=2; sent=true`);
    assert.equal(writes[0].values[2], `slot=${NOTIFY.slotKey};%`);
  });
  test('קריטריון 2: מספר 0: אין שליחה, ונרשם sent=false עם הסיבה (ok=true)', async () => {
    const sql = db({ pending: 0, unread: 0, has_unseen: true });
    const push = fakePush();
    const out = await handleDelivery(NOTIFY, {}, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen.length, 0);
    assert.equal(out.sent, false);
    assert.equal(out.ok, true);
    assert.match(probeWrites(sql)[0].values[1], /badge=0; sent=false; reason=badge-zero$/);
    assert.equal(probeWrites(sql)[0].values[0], true);
  });
  test('קריטריון 2: אין הודעה שלא הוצגה: אין שליחה', async () => {
    const sql = db({ pending: 2, unread: 0, has_unseen: false });
    const push = fakePush();
    await handleDelivery(NOTIFY, {}, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen.length, 0);
    assert.match(probeWrites(sql)[0].values[1], /badge=2; sent=false; reason=nothing-unseen$/);
  });
  test('כשל בדחיפה (סטטוס או זריקה) לא נזרק: ok=false ב-probe_log, ולא נכנסים ללולאת ניסיונות', async (t) => {
    captureConsole(t);
    const sqlA = db();
    const outA = await handleDelivery(NOTIFY, {}, { sql: sqlA, now: () => DELIVERED, pushHandle: fakePush(500), secret: FAKE_CRON });
    assert.equal(outA.ok, false);
    assert.equal(probeWrites(sqlA)[0].values[0], false);
    assert.match(probeWrites(sqlA)[0].values[1], /sent=false; reason=push-status; push_status=500$/);
    const sqlB = db();
    const outB = await handleDelivery(NOTIFY, {}, { sql: sqlB, now: () => DELIVERED, pushHandle: async () => { throw new Error('boom'); }, secret: FAKE_CRON });
    assert.equal(outB.ok, false);
    assert.equal(probeWrites(sqlB)[0].values[0], false);
    assert.match(probeWrites(sqlB)[0].values[1], /reason=push-error/);
  });
  test('בלי סוד בשרת: לא שולח, ok=false', async () => {
    const sql = db();
    const push = fakePush();
    const out = await handleDelivery(NOTIFY, {}, { sql, now: () => DELIVERED, pushHandle: push, secret: '' });
    assert.equal(push.seen.length, 0);
    assert.equal(out.ok, false);
    assert.match(probeWrites(sql)[0].values[1], /reason=no-secret/);
  });
  test('איחור של יותר מ-120 שניות נרשם ok=false גם כשהדחיפה נשלחה', async () => {
    const out = await handleDelivery(NOTIFY, {}, { sql: db(), now: () => atSec(W0 + 35 + 200), pushHandle: fakePush(), secret: FAKE_CRON });
    assert.equal(out.sent, true);
    assert.equal(out.ok, false);
  });
  test('כשל מסד נזרק (קריאת המצב וגם הרישום), כדי שהתור ינסה שוב', async () => {
    const push = fakePush();
    await assert.rejects(() => handleDelivery(NOTIFY, {}, { sql: fakeSql(() => { throw new Error('db down'); }), now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON }), /db down/);
    assert.equal(push.seen.length, 0);
    const failOnProbe = fakeSql((text) => {
      if (text.includes('has_unseen')) return [{ pending: 1, unread: 0, has_unseen: true }];
      throw new Error('db down on probe');
    });
    await assert.rejects(() => handleDelivery(NOTIFY, {}, { sql: failOnProbe, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON }), /db down on probe/);
  });
  test('פרטיות: ב-detail אין סוד, ואין תוכן הודעה (רק ספירות, זמנים וסיבה קבועה)', async () => {
    const sql = db({ pending: 2, unread: 3, has_unseen: true });
    await handleDelivery(NOTIFY, { deliveryCount: 2 }, { sql, now: () => DELIVERED, pushHandle: fakePush(), secret: FAKE_CRON });
    const detail = probeWrites(sql)[0].values[1];
    assert.doesNotMatch(detail, new RegExp(FAKE_CRON));
    assert.doesNotMatch(detail, /bearer|authorization/i);
    assert.match(detail, /^slot=notify-\d+; target_utc=[\dT:.\-Z]+; delivered_utc=[\dT:.\-Z]+; late_s=[\d.]+; delivery_count=2; badge=5; sent=true$/);
  });
  test('brief: אין שאילתת מצב, אין דחיפה, והרישום כמו קודם (probe message-slot)', async () => {
    const sql = fakeSql();
    const push = fakePush();
    const out = await handleDelivery(MSG, {}, { sql, now: at(MSG.targetAt), pushHandle: push, secret: FAKE_CRON });
    assert.equal(out.stored, true);
    assert.equal(push.seen.length, 0);
    assert.equal(sql.calls.length, 1);
    assert.match(sql.calls[0].text, /SELECT 'message-slot'/);
  });
  test('הודעת notify פגומה: לא נכתב כלום ולא נשלחת דחיפה', async (t) => {
    captureConsole(t);
    const sql = fakeSql();
    const push = fakePush();
    const out = await handleDelivery({ ...NOTIFY, targetAt: atSec(W0 + 120).toISOString() }, {}, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON });
    assert.equal(out.stored, false);
    assert.equal(sql.calls.length, 0);
    assert.equal(push.seen.length, 0);
  });
});

// ---------------------------------------------------------------------------
// שלב M.2 (docs/09-security/57, T10): משבצת close: אחרי שורת message-slot הקיימת, התראה אחת על סיכום היום אם יש הודעות לסימון.
// 21:00 בישראל ב-16.10.2026 = 18:00Z (UTC+3). שורות המועמד מ-reviewRow בתוך החלון של אותו רגע. כל הטקסטים מומצאים.
// ---------------------------------------------------------------------------
describe('queue-deliver: משבצת close והתראת הסיכום (קריטריון 10)', () => {
  const CLOSE = { kind: 'close', slotKey: 'close-2026-10-16', targetAt: '2026-10-16T18:00:00.000Z' };
  const DELIVERED = new Date('2026-10-16T18:00:00.900Z');
  const SECRET_TEXT = 'טקסט-מזהה-של-הודעה-מומצאת';
  // sql מדומה: שאילתת הספירה של הסיכום (FROM intake_outcomes o) מחזירה את due; שאילתת המצב מחזירה state; כל השאר ריק. failOn: טקסט שגורם לזריקה.
  const db = ({ due = [reviewRow(1, { text: SECRET_TEXT }), reviewRow(2)], state = { pending: 1, unread: 0, has_unseen: true }, failOn } = {}) => fakeSql((text) => {
    if (failOn && text.includes(failOn)) throw Object.assign(new Error(`db down ${SECRET_TEXT}`), { name: 'NeonDbError' });
    if (text.includes('FROM intake_outcomes o')) return due;
    return text.includes('has_unseen') ? [state] : [];
  });
  const fakePush = (status = 200) => {
    const handle = async (request) => { handle.seen.push({ request, body: JSON.parse(await request.clone().text()) }); return new Response('ok', { status }); };
    handle.seen = [];
    return handle;
  };
  const writesTo = (sql, probe) => sql.calls.filter((c) => c.text.includes('INSERT INTO probe_log') && c.text.includes(`'${probe}'`));
  const run = (sql, push, extra = {}) => handleDelivery(CLOSE, { deliveryCount: 1 }, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON, ...extra });

  test('יש הודעות לסימון: שורת message-slot קודם (ללא שינוי), ואז דחיפה אחת עם הנוסח הקבוע, app_badge מלא ו-dedupe_key של המשבצת, ורישום chat-notify', async () => {
    const sql = db();
    const push = fakePush();
    const out = await run(sql, push);
    assert.deepEqual({ stored: out.stored, slotKey: out.slotKey, lateSeconds: out.lateSeconds, ok: out.ok }, { stored: true, slotKey: CLOSE.slotKey, lateSeconds: 0.9, ok: true });
    assert.match(sql.calls[0].text, /INSERT INTO probe_log \(probe, ok, detail\) SELECT 'message-slot', \?, \? WHERE NOT EXISTS/, 'הרישום הקיים הוא הראשון');
    assert.equal(sql.calls[0].values[1], `slot=${CLOSE.slotKey}; target_utc=${CLOSE.targetAt}; delivered_utc=${DELIVERED.toISOString()}; late_s=0.9; delivery_count=1`);
    assert.equal(push.seen.length, 1);
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: 'סיכום היום מחכה לסימון', navigate: '/', app_badge: 2, dedupe_key: CLOSE.slotKey });
    const [notifyWrite] = writesTo(sql, 'chat-notify');
    assert.match(notifyWrite.text, /SELECT 'chat-notify', \?, \? WHERE NOT EXISTS \(SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE \?\)/);
    assert.equal(notifyWrite.values[0], true);
    assert.equal(notifyWrite.values[1], `slot=${CLOSE.slotKey}; target_utc=${CLOSE.targetAt}; delivered_utc=${DELIVERED.toISOString()}; late_s=0.9; delivery_count=1; badge=2; sent=true`);
    assert.equal(notifyWrite.values[2], `slot=${CLOSE.slotKey};%`);
    assert.ok(sql.calls.indexOf(notifyWrite) > 0);
  });
  test('הזמן לספירה הוא targetAt, לא רגע ההגעה: הודעה שנקלטה אחרי targetAt שייכת לסיכום הבא גם כשההתראה הגיעה מאוחר', async () => {
    const push = fakePush();
    await run(db(), push, { now: () => new Date('2026-10-16T18:05:00Z') });
    assert.equal(push.seen.length, 1, 'ההודעות נקלטו לפני targetAt, ולכן בחלון');
    const sqlLate = db({ due: [reviewRow(1, { recorded_at: new Date('2026-10-16T18:03:00Z'), received_at: new Date('2026-10-16T18:02:00Z') })] });
    const pushLate = fakePush();
    await run(sqlLate, pushLate, { now: () => new Date('2026-10-16T18:05:00Z') });
    assert.equal(pushLate.seen.length, 0);
  });
  test('אין הודעות לסימון: אין דחיפה, שורת message-slot נכתבת כרגיל, ונרשם chat-notify עם הסיבה (ok=true)', async () => {
    const sql = db({ due: [] });
    const push = fakePush();
    const out = await run(sql, push);
    assert.equal(push.seen.length, 0);
    assert.equal(out.ok, true);
    assert.equal(writesTo(sql, 'message-slot').length, 1);
    const [notifyWrite] = writesTo(sql, 'chat-notify');
    assert.equal(notifyWrite.values[0], true);
    assert.match(notifyWrite.values[1], /badge=1; sent=false; reason=review-zero$/);
  });
  test('בלי תוכן הודעה בגוף הדחיפה, בפרמטרים של הרישום ובקונסול', async (t) => {
    const cap = captureConsole(t);
    const sql = db();
    const push = fakePush();
    await run(sql, push);
    assert.ok(!JSON.stringify(push.seen[0].body).includes(SECRET_TEXT));
    assert.ok(!JSON.stringify(sql.calls.map((c) => c.values)).includes(SECRET_TEXT));
    assert.ok(sql.calls.every((c) => !c.text.includes('raw_content')), 'ההתראה לא קוראת טקסט הודעה בכלל');
    assert.equal(cap.lines.length, 0);
  });
  test('כשל דחיפה (סטטוס או זריקה) לא נזרק ולא משנה את שורת message-slot: chat-notify נרשם ok=false', async (t) => {
    captureConsole(t);
    const sqlA = db();
    const outA = await run(sqlA, fakePush(500));
    assert.equal(outA.stored, true);
    assert.equal(writesTo(sqlA, 'message-slot').length, 1);
    assert.equal(writesTo(sqlA, 'chat-notify')[0].values[0], false);
    assert.match(writesTo(sqlA, 'chat-notify')[0].values[1], /sent=false; reason=push-status; push_status=500$/);
    const sqlB = db();
    await run(sqlB, async () => { throw new Error('boom'); });
    assert.match(writesTo(sqlB, 'chat-notify')[0].values[1], /reason=push-error/);
  });
  test('בלי סוד: לא נשלח, נרשם reason=no-secret ו-ok=false', async () => {
    const sql = db();
    const push = fakePush();
    await run(sql, push, { secret: '' });
    assert.equal(push.seen.length, 0);
    assert.match(writesTo(sql, 'chat-notify')[0].values[1], /reason=no-secret/);
    assert.equal(writesTo(sql, 'chat-notify')[0].values[0], false);
  });
  test('כשל מסד בספירה: לא נזרק, שורת message-slot כבר נכתבה, נרשם reason=error בלי טקסט, והקונסול רק עם שם השגיאה', async (t) => {
    const cap = captureConsole(t);
    const sql = db({ failOn: 'has_unseen' });
    const push = fakePush();
    const out = await run(sql, push);
    assert.equal(out.stored, true);
    assert.equal(push.seen.length, 0);
    assert.equal(writesTo(sql, 'message-slot').length, 1);
    const [notifyWrite] = writesTo(sql, 'chat-notify');
    assert.equal(notifyWrite.values[0], false);
    assert.match(notifyWrite.values[1], /badge=null; sent=false; reason=error$/);
    assert.deepEqual(cap.lines, ['queue-deliver: התראת הסיכום נכשלה: NeonDbError']);
    assert.ok(!cap.text().includes(SECRET_TEXT));
  });
  test('כשל מסד גם ברישום chat-notify: לא נזרק (שורת message-slot כבר נכתבה), בקונסול שם השגיאה בלבד', async (t) => {
    const cap = captureConsole(t);
    const sql = db({ failOn: "SELECT 'chat-notify'" });
    const out = await run(sql, fakePush());
    assert.equal(out.stored, true);
    assert.deepEqual(cap.lines, ['queue-deliver: רישום התראת הסיכום נכשל: NeonDbError']);
    assert.ok(!cap.text().includes(SECRET_TEXT));
  });
  test('כשל בכתיבת message-slot עצמה עדיין נזרק (ניסיון חוזר של התור), ולא נשלחת התראה', async () => {
    const sql = db({ failOn: "SELECT 'message-slot'" });
    const push = fakePush();
    await assert.rejects(() => run(sql, push), /db down/);
    assert.equal(push.seen.length, 0);
  });
  test('הגעה כפולה: אותו dedupe_key בשתי הדחיפות (push-send מסנן), והרישומים מוגנים ב-WHERE NOT EXISTS לפי המשבצת', async () => {
    const push = fakePush();
    await run(db(), push);
    await run(db(), push);
    assert.equal(push.seen.length, 2);
    assert.equal(new Set(push.seen.map((s) => s.body.dedupe_key)).size, 1);
    assert.equal(push.seen[0].body.dedupe_key, CLOSE.slotKey);
    const sql = db();
    await run(sql, push);
    assert.match(writesTo(sql, 'chat-notify')[0].text, /WHERE NOT EXISTS/);
    assert.match(writesTo(sql, 'message-slot')[0].text, /WHERE NOT EXISTS/);
  });
  test('brief לא נגע: אין שאילתת סיכום ואין דחיפה', async () => {
    const sql = db();
    const push = fakePush();
    await handleDelivery(MSG, {}, { sql, now: at(MSG.targetAt), pushHandle: push, secret: FAKE_CRON });
    assert.equal(sql.find('FROM intake_outcomes').length, 0);
    assert.equal(push.seen.length, 0);
  });
});
