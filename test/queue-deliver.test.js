// בדיקות ל-api/queues/deliver.js (צרכן התור של משבצות ההודעה) ול-lib/message-slots.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleDelivery } from '../api/queues/deliver.js';
import { planSlot, planNotify, parseSlotMessage, SLOT_TOPIC } from '../lib/message-slots.js';
import { readFileSync } from 'node:fs';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { briefEntityId } from '../lib/brief-view.js';
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
    assert.equal(sql.find("SELECT 'message-slot'").length, 1); // B-2: בנוסף נרשמת שורת chat-notify של התראת הבוקר
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
  test('brief (אחרי B-2): הרישום הראשון כמו קודם (probe message-slot), ואחריו דחיפת הבוקר אחת עם dedupe_key של המשבצת', async () => {
    const sql = fakeSql();
    const push = fakePush();
    const out = await handleDelivery(MSG, {}, { sql, now: at(MSG.targetAt), pushHandle: push, secret: FAKE_CRON });
    assert.equal(out.stored, true);
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.dedupe_key, MSG.slotKey);
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
// שלב C-1 (docs/08-chapter8/90 E1-E11): משבצת close: אחרי שורת message-slot הקיימת, הודעת סגירה אחת בצ'אט והתראה אחת בכל ערב (במקום התראת הסיכום של M.2).
// 21:00 בישראל ב-16.10.2026 (שישי) = 18:00Z (UTC+3). מסד מדומה בזיכרון שמפרש את הפקודות לפי צורתן; ה-SQL לא הורץ מול Postgres אמיתי. כל הטקסטים מומצאים.
// ---------------------------------------------------------------------------
describe('queue-deliver: משבצת close והודעת הסגירה (C-1)', () => {
  const CLOSE = { kind: 'close', slotKey: 'close-2026-10-16', targetAt: '2026-10-16T18:00:00.000Z' };
  const DELIVERED = new Date('2026-10-16T18:00:00.900Z');
  const SECRET_TEXT = 'טקסט-מזהה-של-הודעה-מומצאת';
  const QUIET_STATE = { pending: 0, unread: 0, open_tasks: 0, has_unseen: false };
  const PENDING_ROWS = [{ id: 'q1', body: 'היו שיעורי בית?', sent_at: '2026-10-16T12:00:00.000Z', entity_type: 'lesson_ask', subject: 'פיזיקה', lesson_date: '2026-10-16' }];
  // מסד מדומה. due: שורות הסיכום של M.2 (countReviewDue); state: שאילתת המצב; sources/facts: "נקלט היום"; doneTasks/answered: "בוצע היום" (C-2); tasks; pending; ttRows; failOn: טקסט שגורם לזריקה; onQuery: זריקה מותנית.
  const closeDb = ({ due = [], state = QUIET_STATE, sources = [], facts = [], doneTasks = [], answered = [], tasks = [], pending = [], ttRows = [], failOn, onQuery } = {}) => {
    const st = { messages: [], probe: [] };
    const sql = fakeSql((text, values, index) => {
      onQuery?.(text, index, st);
      if (failOn && text.includes(failOn)) throw Object.assign(new Error(`db down ${SECRET_TEXT}`), { name: 'NeonDbError' });
      if (text.includes('INSERT INTO probe_log')) {
        if (!st.probe.some((p) => p.slot === values[2] && p.probe === (text.includes("'chat-notify'") ? 'chat-notify' : 'message-slot'))) st.probe.push({ slot: values[2], probe: text.includes("'chat-notify'") ? 'chat-notify' : 'message-slot', ok: values[0], detail: values[1] });
        return [];
      }
      if (text.includes('FROM intake_outcomes o JOIN sources s')) return due;
      if (text.includes('has_unseen')) return [state];
      if (text.includes("FROM sources s WHERE s.channel IN ('shortcut', 'app')")) return sources;
      if (text.includes('JOIN facts f ON f.source_id = t.id::uuid')) return facts;
      if (text.includes('FROM timetable_slots')) return ttRows;
      if (text.includes('FROM tasks d')) return doneTasks;
      if (text.includes('FROM messages m LEFT JOIN lesson_asks la')) return answered;
      if (text.includes('FROM tasks t')) return tasks;
      if (text.includes('FROM messages m LEFT JOIN sources s')) return pending;
      if (text.includes("SELECT 1 AS found FROM messages WHERE entity_type = 'close'")) return st.messages.filter((m) => m.entity_id === values[0]).map(() => ({ found: 1 }));
      if (text.includes('INSERT INTO messages')) {
        const [body, sentAt, entityId, readAt] = values;
        if (st.messages.some((m) => m.entity_id === entityId)) return [];
        st.messages.push({ entity_type: 'close', entity_id: entityId, body, sent_at: sentAt, read_at: readAt });
        return [{ id: `m${st.messages.length}` }];
      }
      return [];
    });
    sql.state = st;
    return sql;
  };
  const fakePush = (status = 200) => {
    const handle = async (request) => {
      handle.seen.push({ request, body: JSON.parse(await request.clone().text()) });
      if (typeof status === 'function') return status();
      return new Response('ok', { status });
    };
    handle.seen = [];
    return handle;
  };
  const writesTo = (sql, probe) => sql.calls.filter((c) => c.text.includes('INSERT INTO probe_log') && c.text.includes(`'${probe}'`));
  const bodiesOf = (sql) => sql.state.messages.map((m) => m.body);
  const run = (sql, push, extra = {}, count = 1, message = CLOSE) => handleDelivery(message, { deliveryCount: count }, { sql, now: () => DELIVERED, pushHandle: push, secret: FAKE_CRON, timetable: null, ...extra });

  test('ערב שקט: message-slot קודם (ללא שינוי), הודעת סגירה אחת "לא נקלטו", ודחיפה "יום שקט" עם app_badge 0 ו-dedupe_key של המשבצת (E5)', async () => {
    const sql = closeDb();
    const push = fakePush();
    const out = await run(sql, push);
    assert.deepEqual({ stored: out.stored, slotKey: out.slotKey, lateSeconds: out.lateSeconds, ok: out.ok, created: out.created, push: out.push },
      { stored: true, slotKey: CLOSE.slotKey, lateSeconds: 0.9, ok: true, created: true, push: { sent: true, reason: null } });
    assert.match(sql.calls[0].text, /INSERT INTO probe_log \(probe, ok, detail\) SELECT 'message-slot', \?, \? WHERE NOT EXISTS/, 'הרישום הקיים הוא הראשון');
    assert.equal(sql.calls[0].values[1], `slot=${CLOSE.slotKey}; target_utc=${CLOSE.targetAt}; delivered_utc=${DELIVERED.toISOString()}; late_s=0.9; delivery_count=1`);
    assert.deepEqual(bodiesOf(sql), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום. אין משימות פתוחות ואין שאלות.']);
    assert.equal(push.seen.length, 1);
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: 'יום שקט', navigate: '/', app_badge: 0, dedupe_key: CLOSE.slotKey });
    const [notifyWrite] = writesTo(sql, 'chat-notify');
    assert.match(notifyWrite.text, /SELECT 'chat-notify', \?, \? WHERE NOT EXISTS \(SELECT 1 FROM probe_log WHERE probe = 'chat-notify' AND detail LIKE \?\)/);
    assert.equal(notifyWrite.values[0], true);
    assert.equal(notifyWrite.values[1], `slot=${CLOSE.slotKey}; target_utc=${CLOSE.targetAt}; delivered_utc=${DELIVERED.toISOString()}; late_s=0.9; delivery_count=1; exam=0; created=true; badge=0; sent=true`);
    assert.equal(notifyWrite.values[2], `slot=${CLOSE.slotKey};%`);
  });
  test('השורה נכתבת כמו שהוגדר (E9): kind update, sent_at = read_at = targetAt, entity_type close, entity_id = briefEntityId(slotKey), WHERE NOT EXISTS', async () => {
    const sql = closeDb();
    await run(sql, fakePush());
    const inserts = sql.find('INSERT INTO messages');
    assert.equal(inserts.length, 1);
    const [insert] = inserts;
    assert.match(insert.text, /INSERT INTO messages \(direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt, read_at\) SELECT 'out', \?::text, 'update', \?::timestamptz, false, NULL::uuid, NULL::timestamptz, 'close', \?::uuid, NULL::integer, \?::timestamptz WHERE NOT EXISTS \(SELECT 1 FROM messages WHERE entity_type = 'close' AND entity_id = \?::uuid\)/);
    assert.equal(insert.values[1], CLOSE.targetAt, 'sent_at');
    assert.equal(insert.values[3], CLOSE.targetAt, 'read_at מלא: לא נספרת באייקון');
    assert.equal(insert.values[2], briefEntityId(CLOSE.slotKey));
    assert.equal(insert.values[2], insert.values[4]);
    const insertAt = sql.calls.indexOf(insert);
    assert.ok(insertAt > 0 && writesTo(sql, 'chat-notify').every((c) => sql.calls.indexOf(c) > insertAt), 'ההודעה לפני רישום ההתראה');
  });
  test('ערב עם תוכן: "נקלט" מהעובדות לפי הסדר, "לא הובנו", "להגשה מחר", משימות ושאלות; ההתראה במספרים בלבד', async () => {
    const sql = closeDb({
      state: { pending: 1, unread: 0, open_tasks: 2, has_unseen: false },
      sources: [{ id: 's1', duplicate: false, raw_content: SECRET_TEXT }, { id: 's2', duplicate: false }, { id: 's3', duplicate: false }, { id: 's4', duplicate: true }],
      facts: [
        { source_id: 's1', field: 'date', value: '2026-10-18' }, { source_id: 's1', field: 'subject', value: 'מתמטיקה' }, { source_id: 's1', field: 'type', value: 'exam' },
        { source_id: 's3', field: 'date', value: '2026-10-17' }, { source_id: 's3', field: 'topic', value: 'תור לספר' }, { source_id: 's3', field: 'type', value: 'personal_event' },
      ],
      tasks: [{ id: 'b', title: 'דף תרגילים', subject: null, due_at: null, media_count: 0 }, { id: 'a', title: 'חוברת באנגלית', subject: 'אנגלית', due_at: '2026-10-17T06:00:00.000Z', media_count: 0 }],
      pending: PENDING_ROWS,
    });
    const push = fakePush();
    await run(sql, push);
    assert.deepEqual(bodiesOf(sql), [[
      'סגירה · יום שישי 16.10',
      'נקלט היום (2):',
      '· מבחן · מתמטיקה · ראשון 18.10',
      '· אירוע אישי · תור לספר · שבת 17.10',
      'לא הובנו: 1',
      'להגשה מחר: חוברת באנגלית',
      'משימות פתוחות (2):',
      '· חוברת באנגלית — עד שבת 17.10',
      '· דף תרגילים — בלי תאריך',
      'שאלות שממתינות: שיעורי בית בפיזיקה',
    ].join('\n')]);
    assert.equal(push.seen[0].body.body, 'נקלטו 2 · לא הובנו 1 · שאלה אחת ממתינה · 2 משימות פתוחות');
    assert.equal(push.seen[0].body.app_badge, 3);
    assert.ok(!JSON.stringify(push.seen[0].body).includes('אנגלית'), 'בלי כותרת משימה בהתראה');
  });
  test('הודעות לסימון (M.2): ההתראה כוללת "סיכום היום מחכה לסימון" וה-badge כולל את הסיכום (E10)', async () => {
    const sql = closeDb({ due: [reviewRow(1, { text: SECRET_TEXT }), reviewRow(2)], state: { pending: 1, unread: 0, open_tasks: 0, has_unseen: true }, pending: PENDING_ROWS });
    const push = fakePush();
    await run(sql, push);
    assert.equal(push.seen.length, 1);
    assert.deepEqual(push.seen[0].body, { title: 'מערכת יומן', body: 'סיכום היום מחכה לסימון · שאלה אחת ממתינה', navigate: '/', app_badge: 2, dedupe_key: CLOSE.slotKey });
  });
  test('הזמן הוא targetAt, לא רגע ההגעה (E8, E11): מסירה אחרי חצות שומרת את החלון, הכותרת ו"מחר" של המשבצת', async () => {
    const sql = closeDb({ tasks: [{ id: 'a', title: 'חוברת', subject: null, due_at: '2026-10-17T06:00:00.000Z', media_count: 0 }] });
    await run(sql, fakePush(), { now: () => new Date('2026-10-16T21:30:00.000Z') }); // 00:30 בישראל, כבר 17.10
    const [received] = sql.find("FROM sources s WHERE s.channel IN ('shortcut', 'app')");
    assert.deepEqual(received.values, ['2026-10-15T18:00:00.000Z', CLOSE.targetAt]);
    const text = bodiesOf(sql)[0];
    assert.ok(text.startsWith('סגירה · יום שישי 16.10\n'), text);
    assert.ok(text.includes('להגשה מחר: חוברת'), 'מחר = 17.10 לפי המשבצת');
  });
  test('חלון "נקלט" במעבר שעון (25.10.2026): מ-24.10 18:00Z עד 25.10 19:00Z (25 שעות)', async () => {
    const sql = closeDb();
    await run(sql, fakePush(), { now: () => new Date('2026-10-25T19:00:00.500Z') }, 1, { kind: 'close', slotKey: 'close-2026-10-25', targetAt: '2026-10-25T19:00:00.000Z' });
    assert.deepEqual(sql.find("FROM sources s WHERE s.channel IN ('shortcut', 'app')")[0].values, ['2026-10-24T18:00:00.000Z', '2026-10-25T19:00:00.000Z']);
  });
  test('שבת (24.10): ההודעה נוצרת וההתראה נשלחת (E5)', async () => {
    const sql = closeDb();
    const push = fakePush();
    await run(sql, push, { now: () => new Date('2026-10-24T18:00:01Z') }, 1, { kind: 'close', slotKey: 'close-2026-10-24', targetAt: '2026-10-24T18:00:00.000Z' });
    assert.deepEqual(bodiesOf(sql), ['סגירה · יום שבת 24.10\nלא נקלטו הודעות היום. אין משימות פתוחות ואין שאלות.']);
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.dedupe_key, 'close-2026-10-24');
  });
  test('הגעה כפולה: הודעה אחת (אין INSERT שני), הדחיפה מנוסה שוב עם אותו dedupe_key ואותו נוסח', async () => {
    const sql = closeDb({ tasks: [{ id: 'b', title: 'דף', subject: null, due_at: null, media_count: 0 }] });
    const push = fakePush();
    const first = await run(sql, push);
    const second = await run(sql, push, {}, 2);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(sql.find('INSERT INTO messages').length, 1);
    assert.equal(bodiesOf(sql).length, 1);
    assert.equal(push.seen.length, 2);
    assert.equal(new Set(push.seen.map((s) => s.body.dedupe_key)).size, 1);
    assert.equal(push.seen[1].body.body, push.seen[0].body.body);
    assert.match(writesTo(sql, 'chat-notify')[1].values[1], /; created=false; /);
    assert.match(writesTo(sql, 'chat-notify')[0].text, /WHERE NOT EXISTS/);
  });
  test('פרטיות: אין raw_content בשאילתות, ואין טקסט הודעה בהודעה, בדחיפה, בפרמטרים ובקונסול', async (t) => {
    const cap = captureConsole(t);
    const sql = closeDb({
      due: [reviewRow(1, { text: SECRET_TEXT })],
      sources: [{ id: 's1', duplicate: false, raw_content: SECRET_TEXT }, { id: 's2', duplicate: false, raw_content: SECRET_TEXT }],
      facts: [{ source_id: 's1', field: 'type', value: 'exam' }, { source_id: 's1', field: 'subject', value: 'מתמטיקה' }, { source_id: 's1', field: 'date', value: '2026-10-18' }],
    });
    const push = fakePush();
    await run(sql, push);
    // החריג היחיד: שאילתת השאלות הפתוחות המשותפת לבוקר (loadPending, lib/chat-pending.js) קוראת raw_content לגזירת כפתורים; הטקסט לא יוצא ממנה להודעה (pendingLine: מקצוע או מספר).
    const ownQueries = sql.calls.filter((c) => !c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(ownQueries.every((c) => !c.text.includes('raw_content')), 'שאילתות הסגירה עצמה לא קוראות טקסט הודעה');
    assert.ok(!bodiesOf(sql)[0].includes(SECRET_TEXT));
    assert.ok(!JSON.stringify(push.seen[0].body).includes(SECRET_TEXT));
    assert.ok(!JSON.stringify(sql.state.probe).includes(SECRET_TEXT));
    assert.ok(!writesTo(sql, 'chat-notify')[0].values[1].includes('מבחן'));
    assert.equal(cap.lines.length, 0);
  });
  test('כשל דחיפה זמני (500 או זריקה) לפני הניסיון האחרון: נזרק לניסיון חוזר, וההודעה נשמרה פעם אחת', async (t) => {
    captureConsole(t);
    const sql500 = closeDb();
    await assert.rejects(() => run(sql500, fakePush(500)), /נכשלה זמנית/);
    assert.equal(bodiesOf(sql500).length, 1);
    const sqlThrow = closeDb();
    await assert.rejects(() => run(sqlThrow, async () => { throw new Error('net'); }), /נכשלה זמנית/);
    const sql4xx = closeDb();
    const out4xx = await run(sql4xx, fakePush(401));
    assert.deepEqual(out4xx.push, { sent: false, reason: 'push-status' }, '4xx לא נזרק');
  });
  test('כשל דחיפה בניסיון האחרון: לא נזרק, message-slot נשארת, chat-notify נרשם ok=false עם הסיבה', async (t) => {
    const cap = captureConsole(t);
    const sqlA = closeDb();
    const outA = await run(sqlA, fakePush(500), {}, 5);
    assert.equal(outA.stored, true);
    assert.equal(outA.ok, false);
    assert.equal(writesTo(sqlA, 'message-slot').length, 1);
    assert.equal(writesTo(sqlA, 'chat-notify')[0].values[0], false);
    assert.match(writesTo(sqlA, 'chat-notify')[0].values[1], /sent=false; reason=push-status; push_status=500$/);
    const sqlB = closeDb();
    await run(sqlB, async () => { throw Object.assign(new Error('boom סודי'), { name: 'BoomError' }); }, {}, 5);
    assert.match(writesTo(sqlB, 'chat-notify')[0].values[1], /reason=push-error/);
    assert.ok(cap.text().includes('BoomError') && !cap.text().includes('סודי'));
  });
  test('בלי סוד: ההודעה נוצרת, לא נשלח, נרשם reason=no-secret ו-ok=false', async () => {
    const sql = closeDb();
    const push = fakePush();
    const out = await run(sql, push, { secret: '' });
    assert.equal(out.created, true);
    assert.equal(push.seen.length, 0);
    assert.match(writesTo(sql, 'chat-notify')[0].values[1], /reason=no-secret$/);
    assert.equal(writesTo(sql, 'chat-notify')[0].values[0], false);
  });
  test('כשל מסד בקריאת מצב הדחיפה: נזרק לניסיון חוזר (ההודעה כבר קיימת); בניסיון האחרון reason=error, והקונסול רק עם שם השגיאה', async (t) => {
    const cap = captureConsole(t);
    const retry = closeDb({ failOn: 'has_unseen' });
    await assert.rejects(() => run(retry, fakePush()), { name: 'NeonDbError' });
    assert.equal(bodiesOf(retry).length, 1, 'ההודעה נשמרה לפני הכשל');
    const last = closeDb({ failOn: 'has_unseen' });
    const push = fakePush();
    const out = await run(last, push, {}, 5);
    assert.equal(out.stored, true);
    assert.equal(push.seen.length, 0);
    const [notifyWrite] = writesTo(last, 'chat-notify');
    assert.equal(notifyWrite.values[0], false);
    assert.match(notifyWrite.values[1], /badge=null; sent=false; reason=error$/);
    assert.deepEqual(cap.lines, ['queue-deliver: התראת הסגירה נכשלה: NeonDbError']);
    assert.ok(!cap.text().includes(SECRET_TEXT));
  });
  test('כשל מסד ברישום chat-notify: לא נזרק, בקונסול שם השגיאה בלבד', async (t) => {
    const cap = captureConsole(t);
    const sql = closeDb({ failOn: "SELECT 'chat-notify'" });
    const out = await run(sql, fakePush());
    assert.equal(out.stored, true);
    assert.equal(out.created, true);
    assert.deepEqual(cap.lines, ['queue-deliver: רישום התראת הסגירה נכשל: NeonDbError']);
  });
  test('כשל בטעינת "נקלט", המשימות או השאלות בניסיון 1 עד 4: נזרק לניסיון חוזר, בלי הודעה ובלי דחיפה', async (t) => {
    captureConsole(t);
    for (const failOn of ["FROM sources s WHERE s.channel IN ('shortcut', 'app')", 'FROM tasks t', 'FROM messages m LEFT JOIN sources s', 'FROM timetable_slots']) {
      for (const count of [1, 4]) {
        const sql = closeDb({ failOn });
        const push = fakePush();
        await assert.rejects(() => run(sql, push, { timetable: undefined }, count), /db down/, `${failOn} ${count}`);
        assert.equal(bodiesOf(sql).length, 0);
        assert.equal(push.seen.length, 0);
      }
    }
  });
  test('plan B בניסיון האחרון: החלק שנכשל מושמט, ואין טענת ריקנות', async (t) => {
    const cap = captureConsole(t);
    const receivedDown = closeDb({ failOn: "FROM sources s WHERE s.channel IN ('shortcut', 'app')", tasks: [{ id: 'b', title: 'דף', subject: null, due_at: null, media_count: 0 }] });
    await run(receivedDown, fakePush(), {}, 5);
    assert.deepEqual(bodiesOf(receivedDown), ['סגירה · יום שישי 16.10\nמשימות פתוחות (1):\n· דף — בלי תאריך']);
    const tasksDown = closeDb({ failOn: 'FROM tasks t' });
    const push = fakePush();
    await run(tasksDown, push, {}, 5);
    assert.deepEqual(bodiesOf(tasksDown), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום'], 'בלי "אין משימות פתוחות"');
    assert.equal(push.seen[0].body.body, 'הסגירה של היום מחכה', 'לא "יום שקט" כשחלק לא נטען');
    assert.ok(cap.text().includes('NeonDbError') && !cap.text().includes(SECRET_TEXT));
  });
  test('plan B: כשל בטעינת השאלות (loadPending) בניסיון 5: הודעה אחת בלי טענת "אין שאלות", והדחיפה לא "יום שקט" (ביקורת C-1)', async (t) => {
    const cap = captureConsole(t);
    const PENDING_QUERY = 'FROM messages m LEFT JOIN sources s';
    // ערב ריק חוץ מהשאלות שנכשלו: בלי החלק החלקי ההודעה הייתה "אין משימות פתוחות ואין שאלות" והדחיפה "יום שקט".
    const sql = closeDb({ failOn: PENDING_QUERY });
    const push = fakePush();
    const out = await run(sql, push, {}, 5);
    assert.equal(out.stored, true);
    assert.equal(out.created, true);
    assert.deepEqual(bodiesOf(sql), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום'], 'בלי "אין משימות פתוחות ואין שאלות"');
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.body, 'הסגירה של היום מחכה', 'partial מועבר לנוסח הדחיפה');
    // עם משימה פתוחה: המשימות נשארות בהודעה, רק שורת השאלות מושמטת.
    const withTask = closeDb({ failOn: PENDING_QUERY, tasks: [{ id: 'b', title: 'דף', subject: null, due_at: null, media_count: 0 }] });
    await run(withTask, fakePush(), {}, 5);
    assert.deepEqual(bodiesOf(withTask), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום\nמשימות פתוחות (1):\n· דף — בלי תאריך']);
    assert.ok(cap.text().includes('queue-deliver: הסגירה נשלחת בלי השאלות: NeonDbError') && !cap.text().includes(SECRET_TEXT));
  });
  // C-2 (E6): שורת "בוצע היום" באותו חלון כמו "נקלט", בין "נקלט" ל"מחר"; ההתראה לא משתנה.
  test('C-2: "בוצע היום" בהודעה, באותו חלון כמו "נקלט"; נוסח ההתראה לא משתנה', async () => {
    const sql = closeDb({
      state: { pending: 0, unread: 0, open_tasks: 1, has_unseen: false },
      doneTasks: [{ title: 'חוברת באנגלית', done_at: '2026-10-16T09:00:00.000Z' }],
      answered: [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }, { entity_type: 'source', subject: null }],
      tasks: [{ id: 'b', title: 'דף', subject: null, due_at: null, media_count: 0 }],
    });
    const push = fakePush();
    await run(sql, push);
    assert.deepEqual(bodiesOf(sql), [[
      'סגירה · יום שישי 16.10',
      'לא נקלטו הודעות היום',
      'בוצע היום: חוברת באנגלית · ענית על שיעורי בית בפיזיקה · ועוד שאלה אחת',
      'משימות פתוחות (1):',
      '· דף — בלי תאריך',
    ].join('\n')]);
    for (const needle of ['FROM tasks d', 'FROM messages m LEFT JOIN lesson_asks la']) {
      assert.deepEqual(sql.find(needle)[0].values, ['2026-10-15T18:00:00.000Z', CLOSE.targetAt], needle);
    }
    assert.equal(push.seen[0].body.body, 'משימה אחת פתוחה', 'בלי "בוצע" בהתראה');
  });
  test('C-2: ערב שבו רק בוצע משהו: לא "אין משימות פתוחות ואין שאלות"', async () => {
    const sql = closeDb({ doneTasks: [{ title: 'חוברת', done_at: '2026-10-16T09:00:00.000Z' }] });
    await run(sql, fakePush());
    assert.deepEqual(bodiesOf(sql), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום\nבוצע היום: חוברת']);
  });
  test('C-2: כשל בטעינת "בוצע היום" בניסיון 1 עד 4 נזרק; בניסיון 5 השורה מושמטת, אין טענת ערב שקט, והדחיפה "הסגירה של היום מחכה"', async (t) => {
    const cap = captureConsole(t);
    for (const failOn of ['FROM tasks d', 'FROM messages m LEFT JOIN lesson_asks la']) {
      const retry = closeDb({ failOn });
      await assert.rejects(() => run(retry, fakePush(), {}, 4), /db down/, failOn);
      assert.equal(bodiesOf(retry).length, 0);
      const last = closeDb({ failOn, doneTasks: [{ title: 'חוברת', done_at: '2026-10-16T09:00:00.000Z' }] });
      const push = fakePush();
      const out = await run(last, push, {}, 5);
      assert.equal(out.created, true);
      assert.deepEqual(bodiesOf(last), ['סגירה · יום שישי 16.10\nלא נקלטו הודעות היום'], failOn);
      assert.equal(push.seen[0].body.body, 'הסגירה של היום מחכה');
    }
    assert.ok(cap.text().includes('queue-deliver: הסגירה נשלחת בלי בוצע היום: NeonDbError') && !cap.text().includes(SECRET_TEXT));
  });
  // B-3 (68 D11, D12), עכשיו בתוך ההודעה (E7): משבצת close של 25.10.2026 (19:00Z אחרי מעבר השעון), מבחן מחר ב-26.10.
  const CLOSE_EXAM = { kind: 'close', slotKey: 'close-2026-10-25', targetAt: '2026-10-25T19:00:00.000Z' };
  const runExam = (sql, push, extra = {}, count = 1) => handleDelivery(CLOSE_EXAM, { deliveryCount: count }, { sql, now: () => new Date('2026-10-25T19:00:00.900Z'), pushHandle: push, secret: FAKE_CRON, ...extra });
  test('B-3: מבחן מחר: השורה בהודעה ובהתראה, ו-probe_log כולל exam=1 (בלי טקסט)', async () => {
    const sql = closeDb();
    const push = fakePush();
    const timetable = { slots: [{ weekday: 2, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'מתמטיקה', teacher: null, room: null }] };
    const out = await runExam(sql, push, { timetable });
    assert.equal(out.ok, true);
    assert.deepEqual(bodiesOf(sql), ['סגירה · יום ראשון 25.10\nלא נקלטו הודעות היום\nמחר: מבחן במתמטיקה ב-10:05']);
    assert.equal(push.seen[0].body.body, 'מחר: מבחן במתמטיקה ב-10:05');
    const [notifyWrite] = writesTo(sql, 'chat-notify');
    assert.match(notifyWrite.values[1], /; exam=1; created=true; badge=0; sent=true$/);
    assert.ok(!notifyWrite.values[1].includes('מבחן'), 'ב-probe_log אין טקסט השורה');
  });
  test('B-3: מבחן מחר והודעות לסימון: הנוסח המשולב', async () => {
    const push = fakePush();
    const inWindow = { recorded_at: new Date('2026-10-25T10:00:00Z'), received_at: new Date('2026-10-25T09:59:00Z') }; // בתוך חלון הסיכום של 25.10
    await runExam(closeDb({ due: [reviewRow(1, inWindow), reviewRow(2, inWindow)] }), push, { timetable: null });
    assert.equal(push.seen[0].body.body, 'מחר: מבחן במתמטיקה · סיכום היום מחכה לסימון');
  });
  test('B-3: כשל בטעינת מערכת השעות בניסיון האחרון: השורה בלי שעה, הדחיפה נשלחת, exam=1', async (t) => {
    captureConsole(t);
    const sql = closeDb({ failOn: 'FROM timetable_slots' });
    const push = fakePush();
    const out = await runExam(sql, push, {}, 5); // timetable לא מוזרק: נטען מהמסד וקורס
    assert.equal(out.stored, true);
    assert.ok(bodiesOf(sql)[0].includes('\nמחר: מבחן במתמטיקה'));
    assert.equal(push.seen[0].body.body, 'מחר: מבחן במתמטיקה');
    assert.match(writesTo(sql, 'chat-notify')[0].values[1], /; exam=1; /);
  });
  test('כשל בכתיבת message-slot עצמה עדיין נזרק (ניסיון חוזר של התור), בלי הודעה ובלי התראה', async () => {
    const sql = closeDb({ failOn: "SELECT 'message-slot'" });
    const push = fakePush();
    await assert.rejects(() => run(sql, push), /db down/);
    assert.equal(push.seen.length, 0);
    assert.equal(bodiesOf(sql).length, 0);
  });
  test('brief (B-2): דחיפת הבוקר אחת, ובלי נוסח הסגירה', async () => {
    const sql = closeDb();
    const push = fakePush();
    await handleDelivery(MSG, {}, { sql, now: at(MSG.targetAt), pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body.dedupe_key, MSG.slotKey);
    assert.notEqual(push.seen[0].body.body, 'יום שקט');
  });
});

// ---------------------------------------------------------------------------
// שלב B-1 (docs/08-chapter8/68, D10): הודעת הבוקר במשבצת brief. מסד מדומה בזיכרון שמפרש את הפקודות לפי צורתן; ה-SQL לא הורץ מול Postgres אמיתי (ההוכחה החיה: השאילתה האחרונה בטבלת הקריטריונים ב-68).
// ---------------------------------------------------------------------------
describe('queue-deliver: משבצת brief והודעת הבוקר (B-1)', () => {
  const BRIEF = { kind: 'brief', slotKey: 'brief-2026-10-26', targetAt: '2026-10-26T05:30:00.000Z' }; // 07:30 בישראל (UTC+2 אחרי המעבר ב-25.10)
  const DELIVERED = new Date('2026-10-26T05:30:00.900Z');
  const TT = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
  const TT_ROWS = TT.slots.map((s) => ({ weekday: s.weekday, period: s.period, starts_at: `${s.startsAt}:00`, ends_at: `${s.endsAt}:00`, subject: s.subject, teacher: s.teacher, room: s.room }));
  const TASK_ROWS = [
    { id: 'a', title: 'שיעורי בית · אנגלית', subject: 'אנגלית', due_at: '2026-10-29T06:00:00.000Z', media_count: 0 },
    { id: 'b', title: 'דף תרגילים', subject: null, due_at: null, media_count: 0 },
    { id: 'c', title: 'שיעורי בית · היסטוריה', subject: 'היסטוריה', due_at: '2026-10-25T06:00:00.000Z', media_count: 0 },
  ];
  const PENDING_ROWS = [{ id: 'q1', body: 'היו שיעורי בית?', sent_at: '2026-10-25T12:00:00.000Z', entity_type: 'lesson_ask', subject: 'פיזיקה', lesson_date: '2026-10-25' }];

  // opts: ttRows (שורות מערכת השעות מהמסד), tasks, pending, messages (מצב התחלתי), onQuery(text, n) לזריקה.
  const briefDb = ({ ttRows = TT_ROWS, tasks = [], pending = [], messages = [], notifyState = [], onQuery, afterQuery } = {}) => {
    const state = { messages: [...messages], probe: [] };
    const run1 = (text, values, index) => {
      onQuery?.(text, index, state);
      if (text.includes('INSERT INTO probe_log')) {
        if (!state.probe.some((p) => p.slot === values[2])) state.probe.push({ slot: values[2] });
        return [];
      }
      if (text.includes('FROM timetable_slots')) return ttRows;
      if (text.includes('has_unseen')) return notifyState;
      if (text.includes('FROM tasks t')) return tasks;
      if (text.includes('FROM messages m LEFT JOIN sources s')) return pending;
      if (text.includes("SELECT 1 AS found FROM messages WHERE entity_type = 'brief'")) return state.messages.filter((m) => m.entity_type === 'brief' && m.entity_id === values[0]).map(() => ({ found: 1 }));
      if (text.includes('INSERT INTO messages')) {
        const [body, sentAt, entityId, readAt] = values;
        if (state.messages.some((m) => m.entity_type === 'brief' && m.entity_id === entityId)) return [];
        state.messages.push({ entity_type: 'brief', entity_id: entityId, body, sent_at: sentAt, read_at: readAt, text });
        return [{ id: `m${state.messages.length}` }];
      }
      return [];
    };
    const sql = fakeSql((text, values, index) => {
      const result = run1(text, values, index);
      afterQuery?.(text, index, state);
      return result;
    });
    sql.state = state;
    return sql;
  };
  const run = (sql, extra = {}, metadata = { deliveryCount: 1 }) => handleDelivery(BRIEF, metadata, { sql, now: () => DELIVERED, ...extra });
  const bodyOf = (sql) => sql.state.messages.filter((m) => m.entity_type === 'brief').map((m) => m.body);

  test('(א) הודעה אחת: הכותרת מהתאריך של מפתח המשבצת, שורת בית ספר, מבחן, 3 משימות וסדרן, ושאלת שיעורי בית בשם המקצוע', async () => {
    const sql = briefDb({ tasks: TASK_ROWS, pending: PENDING_ROWS });
    const out = await run(sql);
    assert.equal(out.created, true);
    assert.deepEqual(bodyOf(sql), [[
      'בריף · יום שני 26.10',
      '\u206608:15–15:45\u2069 · 9 שיעורים',
      'היום: מבחן במתמטיקה ב-10:05',
      'משימות פתוחות (3):',
      '· שיעורי בית · היסטוריה — באיחור (היה עד ראשון 25.10)',
      '· שיעורי בית · אנגלית — עד חמישי 29.10',
      '· דף תרגילים — בלי תאריך',
      'שאלות שממתינות: שיעורי בית בפיזיקה',
      'לפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.',
    ].join('\n')]);
  });
  test('(ב) יום בלי כלום (שבת): "יום פנוי" ואחריו שורת D1', async () => {
    const sql = briefDb();
    await handleDelivery({ kind: 'brief', slotKey: 'brief-2026-10-24', targetAt: '2026-10-24T04:30:00.000Z' }, { deliveryCount: 1 }, { sql, now: () => new Date('2026-10-24T04:30:01Z') });
    assert.deepEqual(bodyOf(sql), ['בריף · יום שבת 24.10\nיום פנוי: אין בית ספר ואין משימות פתוחות\nלפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.']);
  });
  test('התאריך נגזר ממפתח המשבצת ולא מהשעון: הרצה באיחור של יום (שעון 27.10) עדיין כותבת את הבריף של 26.10', async () => {
    const sql = briefDb();
    await run(sql, { now: () => new Date('2026-10-27T09:00:00.000Z') });
    assert.ok(bodyOf(sql)[0].startsWith('בריף · יום שני 26.10\n'));
  });
  test('(י) השורה נכתבת כמו שהוגדר: direction out, kind update, awaiting_reply false, sent_at = targetAt, read_at מלא (= targetAt), entity_type brief, בלי expires_at ו-attempt', async () => {
    const sql = briefDb();
    await run(sql);
    const [insert] = sql.find('INSERT INTO messages');
    assert.match(insert.text, /INSERT INTO messages \(direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt, read_at\) SELECT 'out', \?::text, 'update', \?::timestamptz, false, NULL::uuid, NULL::timestamptz, 'brief', \?::uuid, NULL::integer, \?::timestamptz WHERE NOT EXISTS \(SELECT 1 FROM messages WHERE entity_type = 'brief' AND entity_id = \?::uuid\)/);
    assert.equal(insert.values[1], BRIEF.targetAt, 'sent_at');
    assert.equal(insert.values[3], BRIEF.targetAt, 'read_at מלא');
    assert.equal(insert.values[2], insert.values[4], 'אותו entity_id בהכנסה ובבדיקה');
    assert.equal(insert.values[2], briefEntityId(BRIEF.slotKey));
  });
  test('שורת message-slot נכתבת לפני ההודעה, וההודעה לפני הדחיפה ושורת chat-notify (B-2)', async () => {
    const sql = briefDb();
    await run(sql, { pushHandle: async () => new Response('ok'), secret: FAKE_CRON });
    assert.match(sql.calls[0].text, /SELECT 'message-slot'/);
    const insertAt = sql.calls.findIndex((c) => c.text.includes('INSERT INTO messages'));
    assert.ok(insertAt > 0);
    assert.ok(sql.calls.findIndex((c) => c.text.includes("SELECT 'chat-notify'")) > insertAt);
  });
  test('(ח) הרצה כפולה של אותה משבצת = הודעה אחת, והשנייה לא טוענת שאלות מחדש (המשימות נטענות מחדש לנוסח הדחיפה, B-2)', async () => {
    const sql = briefDb({ tasks: TASK_ROWS });
    const first = await run(sql);
    const callsAfterFirst = sql.calls.length;
    const second = await run(sql);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(bodyOf(sql).length, 1);
    assert.equal(sql.calls.slice(callsAfterFirst).filter((c) => c.text.includes('FROM messages m LEFT JOIN sources s')).length, 0);
    assert.equal(sql.calls.slice(callsAfterFirst).filter((c) => c.text.includes('INSERT INTO messages')).length, 0);
    assert.equal(sql.state.probe.length, 1, 'שורת message-slot אחת');
  });
  test('(ח) כשל בהכנסה אחרי שנכתבה שורת message-slot: ניסיון חוזר ממשיך מההכנסה, הודעה אחת', async () => {
    let failed = false;
    const sql = briefDb({ onQuery: (text) => { if (!failed && text.includes('INSERT INTO messages')) { failed = true; throw Object.assign(new Error('db down'), { name: 'NeonDbError' }); } } });
    await assert.rejects(() => run(sql), /db down/);
    assert.equal(sql.state.probe.length, 1, 'message-slot כבר נכתבה');
    assert.equal(bodyOf(sql).length, 0);
    const retry = await run(sql, {}, { deliveryCount: 2 });
    assert.equal(retry.created, true);
    assert.equal(bodyOf(sql).length, 1);
    assert.equal(sql.state.probe.length, 1, 'ולא שורה נוספת');
  });
  test('(ח) ההכנסה הצליחה אבל התשובה אבדה (זריקה אחרי הכתיבה): הניסיון החוזר מוצא אותה ולא יוצר הודעה שנייה', async () => {
    let thrown = false;
    const sql = briefDb({ afterQuery: (text) => { if (!thrown && text.includes('INSERT INTO messages')) { thrown = true; throw new Error('connection lost after commit'); } } });
    await assert.rejects(() => run(sql), /connection lost/);
    assert.equal(bodyOf(sql).length, 1, 'ההודעה כבר נכתבה');
    const retry = await run(sql, {}, { deliveryCount: 2 });
    assert.equal(retry.created, false);
    assert.equal(bodyOf(sql).length, 1);
  });
  test('(ט) טבלת מערכת השעות ריקה (null מהמסד): הודעה בלי שורת בית ספר ובלי "יום פנוי", ובלי ניסיון חוזר', async (t) => {
    captureConsole(t);
    const sql = briefDb({ ttRows: [], tasks: TASK_ROWS });
    const out = await run(sql);
    assert.equal(out.created, true);
    const text = bodyOf(sql)[0];
    assert.ok(text.startsWith('בריף · יום שני 26.10\nהיום: מבחן במתמטיקה\nמשימות פתוחות (3):\n'), text);
    assert.ok(!text.includes('שיעורים') && !text.includes('יום פנוי'));
  });
  test('(ט) מערכת שעות מוזרקת כ-null (לבדיקות): אותו דבר', async () => {
    const sql = briefDb();
    await run(sql, { timetable: null });
    assert.equal(bodyOf(sql)[0], 'בריף · יום שני 26.10\nהיום: מבחן במתמטיקה\nלפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.', 'שורת המבחן נשארת, בלי שעה');
    assert.equal(sql.find('FROM timetable_slots').length, 0);
  });
  test('(ט) כשל מסד זמני בטעינת מערכת השעות: נזרק לניסיון חוזר בניסיונות 1 עד 4, ובניסיון החמישי נשלחת הודעה בלי שורת בית ספר', async (t) => {
    const logs = captureConsole(t);
    const down = (text) => { if (text.includes('FROM timetable_slots')) throw Object.assign(new Error('db down סודי'), { name: 'NeonDbError' }); };
    for (const deliveryCount of [1, 2, 3, 4]) {
      const sql = briefDb({ onQuery: down });
      await assert.rejects(() => run(sql, {}, { deliveryCount }), /db down/, `ניסיון ${deliveryCount}`);
      assert.equal(bodyOf(sql).length, 0);
    }
    const last = briefDb({ onQuery: down, tasks: TASK_ROWS });
    const out = await run(last, {}, { deliveryCount: 5 });
    assert.equal(out.created, true);
    const text = bodyOf(last)[0];
    assert.ok(text.startsWith('בריף · יום שני 26.10\nהיום: מבחן במתמטיקה\nמשימות פתוחות (3):\n'), text);
    assert.ok(!text.includes('שיעורים') && !text.includes('יום פנוי'));
    assert.ok(!logs.text().includes('סודי'), 'בקונסול רק שם השגיאה');
  });
  test('(ט) בלי deliveryCount במטא-דאטה: כשל מסד זמני נזרק (לא מניחים שזה הניסיון האחרון)', async (t) => {
    captureConsole(t);
    const sql = briefDb({ onQuery: (text) => { if (text.includes('FROM timetable_slots')) throw new Error('db down'); } });
    await assert.rejects(() => run(sql, {}, {}), /db down/);
  });
  const FOOTER = 'לפי מערכת השעות, שינויים שנקלטו היום לא מוצגים.';
  const SAT = { kind: 'brief', slotKey: 'brief-2026-10-24', targetAt: '2026-10-24T04:30:00.000Z' }; // שבת: בלי הכשל היה מוצג "יום פנוי"
  test('כשל מסד בטעינת המשימות או השאלות בניסיון 1 עד 4 נזרק (ניסיון חוזר), בלי הודעה', async (t) => {
    captureConsole(t);
    for (const failing of ['FROM tasks t', 'FROM messages m LEFT JOIN sources s']) {
      for (const deliveryCount of [1, 4]) {
        const sql = briefDb({ onQuery: (text) => { if (text.includes(failing)) throw new Error('db down'); } });
        await assert.rejects(() => run(sql, {}, { deliveryCount }), /db down/, `${failing} ${deliveryCount}`);
        assert.equal(bodyOf(sql).length, 0);
      }
    }
  });
  test('plan B: כשל משימות בניסיון 5: הודעה אחת בלי סעיף המשימות, עם שורת הסיום ובלי "יום פנוי"', async (t) => {
    const logs = captureConsole(t);
    const sql = briefDb({ onQuery: (text) => { if (text.includes('FROM tasks t')) throw Object.assign(new Error('db down סודי'), { name: 'NeonDbError' }); } });
    const out = await handleDelivery(SAT, { deliveryCount: 5 }, { sql, now: () => new Date('2026-10-24T04:30:01Z') });
    assert.equal(out.created, true);
    assert.deepEqual(bodyOf(sql), [`בריף · יום שבת 24.10\n${FOOTER}`]);
    assert.ok(logs.text().includes('NeonDbError') && !logs.text().includes('סודי'));
  });
  test('plan B: כשל שאלות בניסיון 5: הודעה אחת עם המשימות, בלי שורת השאלות, עם שורת הסיום ובלי "יום פנוי"', async (t) => {
    captureConsole(t);
    const sql = briefDb({ tasks: TASK_ROWS, onQuery: (text) => { if (text.includes('FROM messages m LEFT JOIN sources s')) throw new Error('db down'); } });
    await run(sql, {}, { deliveryCount: 5 });
    const [text] = bodyOf(sql);
    assert.equal(bodyOf(sql).length, 1);
    assert.ok(text.includes('משימות פתוחות (3):') && !text.includes('שאלות שממתינות') && !text.includes('יום פנוי'));
    assert.ok(text.endsWith(FOOTER));
    const sat = briefDb({ onQuery: (text2) => { if (text2.includes('FROM messages m LEFT JOIN sources s')) throw new Error('db down'); } });
    await handleDelivery(SAT, { deliveryCount: 5 }, { sql: sat, now: () => new Date('2026-10-24T04:30:01Z') });
    assert.deepEqual(bodyOf(sat), [`בריף · יום שבת 24.10\n${FOOTER}`]);
  });
  test('מערכת שעות תקינה מהמסד: נטענת עם rethrowDbError (הקריאה אחת) ושורת בית הספר מופיעה', async () => {
    const sql = briefDb();
    await run(sql);
    assert.equal(sql.find('FROM timetable_slots').length, 1);
    assert.ok(bodyOf(sql)[0].includes('\u206608:15–15:45\u2069 · 9 שיעורים'));
  });
  test('פרטיות: בהודעה ובפרמטרים אין שם מורה או חדר, ובשאילתות אין טקסט הודעה של שאלה אחרת', async () => {
    const secret = 'טקסט-שאלה-סודי-מומצא';
    const sql = briefDb({ pending: [{ id: 'q9', body: secret, sent_at: '2026-10-25T12:00:00.000Z', entity_type: 'source', source_id: 's1', channel: 'app', raw_content: secret, content_hash: 'h', received_at: '2026-10-25T11:00:00.000Z' }] });
    await run(sql);
    const text = bodyOf(sql)[0];
    assert.ok(!text.includes(secret));
    assert.ok(text.includes('שאלות שממתינות: שאלה אחת'));
    for (const slot of TT.slots) if (slot.teacher) assert.ok(!text.includes(slot.teacher));
  });
  // B-2: התראת הבוקר. push מזויף שרושם את הגוף (כולל dedupe_key); הנוסח המלא נבדק גם ב-test/brief-view.test.js.
  const recPush = (status = 200) => {
    const handle = async (request) => {
      handle.seen.push(JSON.parse(await request.clone().text()));
      if (typeof status === 'function') return status();
      return new Response('ok', { status });
    };
    handle.seen = [];
    return handle;
  };
  const slotRun = (message, sql, push, extra = {}, count = 1) => handleDelivery(message, { deliveryCount: count }, { sql, now: () => new Date(message.targetAt), pushHandle: push, secret: FAKE_CRON, ...extra });
  const DAY = { kind: 'brief', slotKey: 'brief-2026-10-27', targetAt: '2026-10-27T05:30:00.000Z' }; // שלישי, יום לימודים בלי מבחן
  const HANUKKAH = { kind: 'brief', slotKey: 'brief-2026-12-08', targetAt: '2026-12-08T05:30:00.000Z' };
  const SECRET_TITLE = 'כותרת-משימה-סודית-מומצאת';
  const secretTasks = [{ id: 'z', title: SECRET_TITLE, subject: null, due_at: null, media_count: 0 }, ...TASK_ROWS];
  const chatNotifyRows = (sql) => sql.find("SELECT 'chat-notify'");

  test('B-2 יום לימודים: דחיפה אחת עם שורת בית הספר ו-N המשימות, dedupe_key=מפתח המשבצת, ושורת chat-notify; הגוף ללא כותרת משימה', async () => {
    const sql = briefDb({ tasks: secretTasks });
    const push = recPush();
    const out = await slotRun(DAY, sql, push);
    assert.equal(out.created, true);
    assert.deepEqual(out.push, { sent: true, reason: null });
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].dedupe_key, DAY.slotKey);
    assert.equal(push.seen[0].body, '\u206608:15–14:15\u2069 · 7 שיעורים · 4 משימות פתוחות');
    assert.ok(!JSON.stringify(push.seen[0]).includes(SECRET_TITLE) && !JSON.stringify(push.seen[0]).includes('אנגלית'));
    assert.ok(bodyOf(sql)[0].includes(SECRET_TITLE), 'הכותרת כן בהודעה עצמה');
    const [row] = chatNotifyRows(sql);
    assert.equal(row.values[0], true);
    assert.match(row.values[1], /created=true; badge=0; sent=true$/);
  });
  test('B-2 משימה אחת ואפס משימות: "משימה אחת פתוחה" / החלק מושמט', async () => {
    const one = recPush();
    await slotRun(DAY, briefDb({ tasks: [TASK_ROWS[1]] }), one);
    assert.equal(one.seen[0].body, '\u206608:15–14:15\u2069 · 7 שיעורים · משימה אחת פתוחה');
    const none = recPush();
    await slotRun(DAY, briefDb(), none);
    assert.equal(none.seen[0].body, '\u206608:15–14:15\u2069 · 7 שיעורים');
  });
  test('B-2 יום מבחן (26.10): ההתראה נפתחת בשורת המבחן', async () => {
    const push = recPush();
    await run(briefDb({ tasks: TASK_ROWS }), { pushHandle: push, secret: FAKE_CRON });
    assert.equal(push.seen[0].body, 'מבחן במתמטיקה ב-10:05 · \u206608:15–15:45\u2069 · 9 שיעורים · 3 משימות פתוחות');
  });
  test('B-2 שבת: ההודעה נוצרת והדחיפה נשלחת (עם משימות: "יום פנוי · N משימות פתוחות"; בלי: נוסח D8)', async () => {
    const withTasks = recPush();
    const sqlA = briefDb({ tasks: TASK_ROWS });
    const outA = await slotRun(SAT, sqlA, withTasks);
    assert.equal(outA.created, true);
    assert.equal(withTasks.seen[0].body, 'יום פנוי · 3 משימות פתוחות');
    const empty = recPush();
    await slotRun(SAT, briefDb(), empty);
    assert.equal(empty.seen[0].body, 'יום פנוי: אין בית ספר ואין משימות פתוחות');
    assert.equal(empty.seen[0].dedupe_key, SAT.slotKey);
  });
  test('B-2 יום חופשה (חנוכה 8.12): נשלחת דחיפה בנוסח "יום פנוי"', async () => {
    const push = recPush();
    await slotRun(HANUKKAH, briefDb({ tasks: [TASK_ROWS[1]] }), push);
    assert.equal(push.seen.length, 1);
    assert.equal(push.seen[0].body, 'יום פנוי · משימה אחת פתוחה');
  });
  test('B-2 מערכת שעות חסרה: "הבריף של היום מחכה"', async () => {
    const push = recPush();
    await slotRun(DAY, briefDb({ ttRows: [] }), push);
    assert.equal(push.seen[0].body, 'הבריף של היום מחכה');
    const injected = recPush();
    await slotRun(DAY, briefDb(), injected, { timetable: null });
    assert.equal(injected.seen[0].body, 'הבריף של היום מחכה');
  });
  test('B-2 משבצת שנייה של אותו יום: אין הכנסה שנייה להודעה, אבל הדחיפה מנוסה שוב פעם אחת עם אותו dedupe_key', async () => {
    const sql = briefDb({ tasks: TASK_ROWS });
    const push = recPush();
    const first = await slotRun(DAY, sql, push);
    const insertsAfterFirst = sql.find('INSERT INTO messages').length;
    const second = await slotRun(DAY, sql, push, {}, 2);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(sql.find('INSERT INTO messages').length, insertsAfterFirst, 'לא נוסף INSERT');
    assert.equal(bodyOf(sql).length, 1);
    assert.equal(push.seen.length, 2);
    assert.equal(push.seen[0].dedupe_key, DAY.slotKey);
    assert.equal(push.seen[1].dedupe_key, DAY.slotKey);
    assert.equal(push.seen[1].body, push.seen[0].body, 'אותו נוסח מאותם נתונים');
    assert.deepEqual(second.push, { sent: true, reason: null });
  });
  test('B-2 ניסיון חוזר אחרי כשל דחיפה (הודעה קיימת): הדחיפה מנוסה שוב, בלי הודעה כפולה', async (t) => {
    captureConsole(t);
    const sql = briefDb({ tasks: TASK_ROWS });
    const first = await slotRun(DAY, sql, recPush(500), {}, 5);
    assert.equal(first.created, true);
    assert.deepEqual(first.push, { sent: false, reason: 'push-status' });
    const good = recPush();
    const second = await slotRun(DAY, sql, good, {}, 2);
    assert.equal(second.created, false);
    assert.equal(good.seen.length, 1);
    assert.equal(bodyOf(sql).length, 1);
  });
  test('B-2 דחיפה שמחזירה 500 או זורקת: לא נזרק, ההודעה קיימת, push נרשם בתוצאה וב-probe_log (ok=false)', async (t) => {
    const cap = captureConsole(t);
    const sqlA = briefDb({ tasks: TASK_ROWS });
    const outA = await slotRun(DAY, sqlA, recPush(500), {}, 5);
    assert.equal(outA.created, true);
    assert.equal(outA.ok, false);
    assert.deepEqual(outA.push, { sent: false, reason: 'push-status' });
    assert.equal(bodyOf(sqlA).length, 1);
    assert.equal(chatNotifyRows(sqlA)[0].values[0], false);
    assert.match(chatNotifyRows(sqlA)[0].values[1], /sent=false; reason=push-status; push_status=500$/);
    const sqlB = briefDb({ tasks: TASK_ROWS });
    const outB = await slotRun(DAY, sqlB, async () => { throw Object.assign(new Error('boom סודי'), { name: 'BoomError' }); }, {}, 5);
    assert.equal(outB.created, true);
    assert.deepEqual(outB.push, { sent: false, reason: 'push-error' });
    assert.equal(bodyOf(sqlB).length, 1);
    assert.ok(cap.text().includes('BoomError') && !cap.text().includes('סודי'));
  });
  test('B-2 כשל מסד בקריאת מצב הדחיפה: נזרק לניסיון חוזר (ההודעה כבר קיימת), ובניסיון האחרון לא נזרק', async (t) => {
    captureConsole(t);
    const down = () => briefDb({ onQuery: (text) => { if (text.includes('has_unseen')) throw Object.assign(new Error('db down'), { name: 'NeonDbError' }); } });
    const retrySql = down();
    await assert.rejects(() => slotRun(DAY, retrySql, recPush()), { name: 'NeonDbError' });
    assert.equal(bodyOf(retrySql).length, 1, 'ההודעה נשמרה לפני הכשל');
    const lastSql = down();
    const push = recPush();
    const last = await slotRun(DAY, lastSql, push, {}, 5);
    assert.equal(last.created, true);
    assert.deepEqual(last.push, { sent: false, reason: 'error' });
    assert.equal(push.seen.length, 0);
  });
  test('B-2 כשל מסד ברישום ה-probe_log: לא נזרק וההודעה קיימת', async (t) => {
    const cap = captureConsole(t);
    const sqlB = briefDb({ onQuery: (text) => { if (text.includes("SELECT 'chat-notify'")) throw Object.assign(new Error('db down'), { name: 'NeonDbError' }); } });
    const outB = await slotRun(DAY, sqlB, recPush());
    assert.equal(outB.created, true);
    assert.equal(outB.push.sent, true);
    assert.ok(cap.text().includes('NeonDbError'));
  });
  test('B-2 בלי סוד: לא נשלח ולא נזרק, ההודעה נוצרה, ו-reason=no-secret נרשם', async () => {
    const sql = briefDb({ tasks: TASK_ROWS });
    const push = recPush();
    const out = await slotRun(DAY, sql, push, { secret: '' });
    assert.equal(out.created, true);
    assert.deepEqual(out.push, { sent: false, reason: 'no-secret' });
    assert.equal(push.seen.length, 0);
    assert.match(chatNotifyRows(sql)[0].values[1], /reason=no-secret$/);
  });
  test('B-2 ה-badge בדחיפה = משימות + שאלות ממתינות (ההודעה עצמה read_at מלא ולא נספרת)', async () => {
    const sql = briefDb({ tasks: TASK_ROWS, notifyState: [{ pending: 2, unread: 0, open_tasks: 3, has_unseen: false }] });
    const push = recPush();
    await slotRun(DAY, sql, push);
    assert.equal(push.seen[0].app_badge, 5);
    assert.equal(sql.find('INSERT INTO messages')[0].values[3], DAY.targetAt, 'read_at מלא');
  });
  test('B-2 ניסיון אחרון בתור עם כשל משימות: הדחיפה בלי ספירת משימות', async (t) => {
    captureConsole(t);
    const sql = briefDb({ onQuery: (text) => { if (text.includes('FROM tasks t')) throw new Error('db down'); } });
    const push = recPush();
    await slotRun(DAY, sql, push, {}, 5);
    assert.equal(push.seen[0].body, '\u206608:15–14:15\u2069 · 7 שיעורים');
  });

  test('B-2 דחיפה שנכשלה זמנית (500 או חריגה) לפני הניסיון האחרון: נזרק לניסיון חוזר, וההודעה נשמרה פעם אחת', async (t) => {
    captureConsole(t);
    const sql500 = briefDb({ tasks: TASK_ROWS });
    await assert.rejects(() => slotRun(DAY, sql500, recPush(500)), /נכשלה זמנית/);
    assert.equal(bodyOf(sql500).length, 1);
    const sqlThrow = briefDb({ tasks: TASK_ROWS });
    await assert.rejects(() => slotRun(DAY, sqlThrow, async () => { throw new Error('net'); }), /נכשלה זמנית/);
    const sql4xx = briefDb({ tasks: TASK_ROWS });
    const out4xx = await slotRun(DAY, sql4xx, recPush(401));
    assert.deepEqual(out4xx.push, { sent: false, reason: 'push-status' }, '4xx לא נזרק: ניסיון חוזר לא ישנה אותו');
  });
  test('B-2 שבת, ניסיון אחרון בתור עם כשל משימות: הדחיפה "הבריף של היום מחכה" (partialForPush מועבר)', async (t) => {
    captureConsole(t);
    const saturday = { kind: 'brief', slotKey: 'brief-2026-10-24', targetAt: '2026-10-24T04:30:00.000Z' };
    const sql = briefDb({ onQuery: (text) => { if (text.includes('FROM tasks t')) throw new Error('db down'); } });
    const push = recPush();
    await slotRun(saturday, sql, push, {}, 5);
    assert.equal(push.seen[0].body, 'הבריף של היום מחכה');
  });

  test('C-1: משבצת close כותבת הודעת סגירה אחת (entity_type close) ולא הודעת בריף', async () => {
    const sql = briefDb();
    await handleDelivery({ kind: 'close', slotKey: 'close-2026-10-26', targetAt: '2026-10-26T19:00:00.000Z' }, { deliveryCount: 1 }, { sql, now: () => new Date('2026-10-26T19:00:01Z'), pushHandle: async () => new Response('ok'), secret: FAKE_CRON });
    const inserts = sql.find('INSERT INTO messages');
    assert.equal(inserts.length, 1);
    assert.match(inserts[0].text, /'update', \?::timestamptz, false, NULL::uuid, NULL::timestamptz, 'close', \?::uuid/);
    assert.ok(!inserts[0].text.includes("'brief'"));
    assert.ok(inserts[0].values[0].startsWith('סגירה · יום שני 26.10'));
  });
});
