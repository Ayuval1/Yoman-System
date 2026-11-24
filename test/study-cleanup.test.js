// בדיקות ל-lib/study-cleanup.js: שעות למידה של מבחן שזז או בוטל -> כרטיס "לבטל אותן?" (כן / לא). בלי מסד ובלי רשת.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, captureConsole } from './helpers.js';
import { orphanGroups, orphanText, offerStudyCleanup, answerStudyCleanup, STUDY_ORPHAN_ENTITY } from '../lib/study-cleanup.js';
import { pendingFromRows } from '../lib/chat-view.js';

const NOW = new Date('2026-11-23T05:30:00.000Z');
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const row = (exam, block, start, end) => ({ match_key: `source:study:${exam}:${block}`, starts_at: start, ends_at: end });
const ROWS = [
  row('2026-11-26:היסטוריה', '2026-11-24T16:00', '2026-11-24T14:00:00.000Z', '2026-11-24T15:00:00.000Z'),
  row('2026-11-26:היסטוריה', '2026-11-25T16:00', '2026-11-25T14:00:00.000Z', '2026-11-25T15:00:00.000Z'),
  row('2026-11-27:מתמטיקה', '2026-11-25T18:00', '2026-11-25T16:00:00.000Z', '2026-11-25T17:00:00.000Z'),
];
const BOARD_MOVED = [
  { date: '2026-12-03', type: 'מבחן', subject: 'היסטוריה', makeup: false, answerDate: '2026-11-26' }, // זז ל-3.12
  { date: '2026-11-27', type: 'מבחן', subject: 'מתמטיקה', makeup: false },
];

describe('study-cleanup: מה יתום (טהור)', () => {
  test('מבחן שזז: השעות שלו יתומות; מבחן שבמקומו: לא', () => {
    const groups = orphanGroups(ROWS, BOARD_MOVED);
    assert.equal(groups.length, 1);
    assert.deepEqual({ exam: groups[0].exam, count: groups[0].count, minutes: groups[0].minutes }, { exam: '2026-11-26:היסטוריה', count: 2, minutes: 120 });
    assert.equal(groups[0].lastEnd, '2026-11-25T15:00:00.000Z');
  });
  test('מבחן שבוטל (לא בלוח) או נדחה בלי מועד (postponed): יתום', () => {
    assert.equal(orphanGroups(ROWS, [BOARD_MOVED[1]]).length, 1);
    const postponed = [{ date: '2026-11-26', subject: 'היסטוריה', postponed: true }, BOARD_MOVED[1]];
    assert.equal(orphanGroups(ROWS, postponed)[0].exam, '2026-11-26:היסטוריה');
  });
  test('מפתח שאינו של למידה, או לוח שבו הכול במקום: אין', () => {
    assert.deepEqual(orphanGroups([{ match_key: 'source:x', starts_at: 'a', ends_at: 'b' }], []), []);
    assert.deepEqual(orphanGroups(ROWS, [{ date: '2026-11-26', subject: 'היסטוריה' }, BOARD_MOVED[1]]), []);
  });
  test('הנוסח', () => {
    assert.equal(orphanText({ subject: 'היסטוריה', date: '2026-11-26', minutes: 120 }), 'המבחן בהיסטוריה מ-26.11 זז או בוטל, ושעתיים למידה שתוכננו לו עדיין ביומן "לימוד".\nלבטל אותן?');
  });
});

describe('study-cleanup: יצירה', () => {
  test('כרטיס אחד ליתום: question, מזהה נגזר ו-ON CONFLICT, פעם אחת לכל מבחן, פג בסוף הבלוק האחרון', async () => {
    const sql = fakeSql((text) => (text.includes('study-orphan-events') ? ROWS : text.includes('study-orphan-create') ? [{ message_id: 'm1' }] : []));
    const out = await offerStudyCleanup({ sql, now: NOW, exams: BOARD_MOVED });
    assert.deepEqual(out.created, ['study-orphan:2026-11-26:היסטוריה']);
    const [call] = sql.find('study-orphan-create');
    assert.match(call.text, /ON CONFLICT \(id\) DO NOTHING/);
    assert.match(call.text, /NOT EXISTS \(SELECT 1 FROM facts p WHERE p.entity_type/);
    assert.ok(call.values.includes(STUDY_ORPHAN_ENTITY));
    assert.ok(call.values.includes('2026-11-25T15:00:00.000Z'));
    assert.equal(sql.find('UPDATE events').length, 0, 'בלי ביטול אוטומטי');
  });
  test('אין אירועי למידה: בלי טעינת לוח ובלי כרטיס', async () => {
    const sql = fakeSql(() => []);
    assert.deepEqual(await offerStudyCleanup({ sql, now: NOW }), { created: [] });
    assert.equal(sql.find('study-orphan-create').length, 0);
  });
  test('כשל מסד: לא זורק', async (t) => {
    captureConsole(t);
    assert.deepEqual(await offerStudyCleanup({ sql: fakeSql(() => { throw new Error('db'); }), now: NOW, exams: [] }), { created: [] });
  });
});

describe('study-cleanup: תשובה', () => {
  const ask = { id: MSG_ID, awaiting_reply: true, facts: { key: 'study-orphan:2026-11-26:היסטוריה', exam: '2026-11-26:היסטוריה', subject: 'היסטוריה' } };
  const answerSql = (keys = []) => fakeSql((text) => (text.includes('study-orphan-ask') ? [ask] : text.includes('study-orphan-write') ? [{ closed: 1, answer_source_id: 'a', bubble_id: 'b', keys }] : []));
  test('"כן": מבטל רק את אירועי המבחן הזה (LIKE לפי המפתח), והמפתחות חוזרים ליומן', async () => {
    const keys = ['source:study:2026-11-26:היסטוריה:2026-11-24T16:00'];
    const sql = answerSql(keys);
    const out = await answerStudyCleanup({ sql, messageId: MSG_ID, answer: 'כן', now: NOW });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, keys);
    const [call] = sql.find('study-orphan-write');
    assert.match(call.text, /UPDATE events SET status = 'cancelled'/);
    assert.ok(call.values.includes('source:study:2026-11-26:היסטוריה:%'));
    assert.ok(call.values.includes(true));
  });
  test('"לא": בלי ביטול', async () => {
    const sql = answerSql();
    await answerStudyCleanup({ sql, messageId: MSG_ID, answer: 'לא', now: NOW });
    const [call] = sql.find('study-orphan-write');
    assert.ok(call.values.includes(false));
    assert.ok(call.values.includes(null));
  });
  test('תשובה אחרת: unclear, בלי כתיבה; כרטיס סגור: closed', async () => {
    const sql = answerSql();
    assert.equal((await answerStudyCleanup({ sql, messageId: MSG_ID, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal(sql.find('study-orphan-write').length, 0);
    const closed = fakeSql(() => []);
    assert.equal((await answerStudyCleanup({ sql: closed, messageId: MSG_ID, answer: 'כן', now: NOW })).status, 'closed');
  });
  test('מפתח מבחן לא תקין בעובדות (למשל עם %): "כן" לא מבטל כלום', async () => {
    const bad = fakeSql((text) => (text.includes('study-orphan-ask') ? [{ ...ask, facts: { ...ask.facts, exam: '2026-11-26:%' } }] : text.includes('study-orphan-write') ? [{ closed: 1, keys: [] }] : []));
    await answerStudyCleanup({ sql: bad, messageId: MSG_ID, answer: 'כן', now: NOW });
    assert.ok(bad.find('study-orphan-write')[0].values.includes(false));
  });
});

describe('study-cleanup: בצ\'אט', () => {
  test('הכרטיס מוצג עם כן / לא, בלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG_ID, entity_type: STUDY_ORPHAN_ENTITY, body: 'x', sent_at: NOW.toISOString() }], facts: [], timetable: null, today: '2026-11-23' });
    assert.equal(item.kind, 'study_orphan');
    assert.deepEqual(item.buttons, ['כן', 'לא']);
    assert.equal(item.allowFreeText, false);
  });
});
