// בדיקות ל-api/queues/deliver.js (צרכן התור של משבצות ההודעה) ול-lib/message-slots.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleDelivery } from '../api/queues/deliver.js';
import { planSlot, parseSlotMessage, SLOT_TOPIC } from '../lib/message-slots.js';
import { fakeSql, captureConsole } from './helpers.js';

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
