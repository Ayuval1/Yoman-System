// בדיקות ל"לא זמין" (בלוק 3ב-2, אפיון-מורחב ח-2): קריאת החלון בקוד, שאלת המשמעות כשיש אירוע, "עד מתי?" ו"מה הסיבה?", ושורת החלון ב-events.
// נתונים מומצאים, בלי רשת ובלי מסד אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractUnavailable, resolveUnavailable, applyUnavailableAnswer, unavailableEventRow, unavailableReply, conflictFact, UNAVAILABLE_TYPE } from '../lib/unavailable.js';
import { processSource, answerQuestion, pendingQuestion } from '../lib/intake-process.js';
import { fakeSql } from './helpers.js';

const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const MONDAY_NOON = new Date('2026-11-23T10:00:00.000Z'); // שני 23.11.2026, 12:00 בישראל
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const source = (text, over = {}) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: sha(text), received_at: MONDAY_NOON, ...over });
const factsOf = (extracted) => Object.fromEntries(extracted.facts.map((f) => [f.field, f.value]));
const known = (entries) => new Map(Object.entries(entries).map(([field, value]) => [field, { field, value, origin: 'read', extracted_by: 'script' }]));
const TRAINING_ROW = { title: 'אימון', starts_at: '2026-11-23T15:00:00.000Z', ends_at: '2026-11-23T17:00:00.000Z', domain: 'running', external_id: null };

describe('unavailable: extractUnavailable', () => {
  test('"אני לא זמין ב-5": היום, 17:00, בלי סוף', () => {
    const out = extractUnavailable({ text: 'אני לא זמין ב-5', receivedAt: MONDAY_NOON });
    assert.equal(out.type, UNAVAILABLE_TYPE);
    assert.deepEqual(factsOf(out), { date: '2026-11-23', time: '17:00' });
    assert.deepEqual(out.missing, ['end_time']);
  });
  test('"לא זמין מחר מ-17:00 עד 19:00": תאריך, התחלה וסוף', () => {
    assert.deepEqual(factsOf(extractUnavailable({ text: 'אני לא זמין מחר מ-17:00 עד 19:00', receivedAt: MONDAY_NOON })), { date: '2026-11-24', time: '17:00', end_time: '19:00' });
  });
  test('"עד 7" אחרי 17:00 = 19:00', () => {
    assert.equal(factsOf(extractUnavailable({ text: 'לא זמין ב-5 עד 7', receivedAt: MONDAY_NOON })).end_time, '19:00');
  });
  test('בלי התחלה, היום: מעכשיו ("לא זמין עד 20:00")', () => {
    const out = extractUnavailable({ text: 'אני לא זמין עד 20:00', receivedAt: MONDAY_NOON });
    assert.deepEqual(factsOf(out), { date: '2026-11-23', time: '12:00', end_time: '20:00' });
    assert.equal(out.facts.find((f) => f.field === 'time').origin, 'inferred');
  });
  test('"ב-9": שתי קריאות בשעות הערות = עמום, שואלים', () => {
    const out = extractUnavailable({ text: 'אני לא זמין ב-9', receivedAt: MONDAY_NOON });
    assert.deepEqual(out.ambiguous, [{ field: 'time', candidates: ['09:00', '21:00'] }]);
  });
  test('ביטויים מהמוח (מילה במילה) והסיבה (topic)', () => {
    const understanding = { kind: 'unavailable', date_text: 'מחר', time_text: 'ב-6', topic: 'הופעה', uncertain: [] };
    assert.deepEqual(factsOf(extractUnavailable({ text: 'תשמע, מחר ב-6 אני לא זמין, יש הופעה', receivedAt: MONDAY_NOON, understanding })), { date: '2026-11-24', time: '18:00', reason: 'הופעה' });
  });
});

describe('unavailable: conflictFact', () => {
  test('אירוע שמכסה את השעה: עובדת conflict עם כותרת, התחלה וסוף', () => {
    const fact = conflictFact({ items: [{ title: 'אימון', start: '17:00', end: '19:00' }] }, '17:00');
    assert.deepEqual(JSON.parse(fact.value), { title: 'אימון', start: '17:00', end: '19:00' });
    assert.equal(fact.origin, 'inferred');
  });
  test('אין אירוע בשעה: null', () => assert.equal(conflictFact({ items: [{ title: 'אימון', start: '17:00', end: '19:00' }] }, '20:00'), null));
});

describe('unavailable: resolveUnavailable (סדר השאלות)', () => {
  const conflict = JSON.stringify({ title: 'אימון', start: '17:00', end: '19:00' });
  test('יש אירוע: קודם שאלת המשמעות, בנוסח של ח-2', () => {
    const state = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00', conflict }), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(state.next.field, 'meaning');
    assert.equal(state.next.text, 'יש לך אימון ב-17:00. אתה לא מגיע לאימון, או שאתה לא זמין בגלל זה?');
    assert.deepEqual(state.next.buttons, ['לא מגיע', 'לא זמין בגלל זה']);
    assert.equal(state.next.allowFreeText, false);
    assert.equal(state.understood, false);
  });
  test('"לא זמין בגלל זה" בלי סוף: הסוף = סוף האירוע, בלי "עד מתי?"', () => {
    const state = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00', conflict, meaning: 'busy' }), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(state.all.get('end_time').value, '19:00');
    assert.equal(state.understood, true);
  });
  test('"לא מגיע": בלי חלון ובלי עוד שאלה', () => {
    const state = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00', conflict, meaning: 'skip' }), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(state.next, null);
    assert.equal(state.understood, true);
    assert.equal(unavailableEventRow(state.all, SRC_ID), null);
    assert.equal(unavailableReply(state.all), 'נרשם · לא מגיע · אימון · שני 23.11');
  });
  test('בלי סוף בהודעה: "עד מתי?", ואחריו "מה הסיבה?" (לא חובה)', () => {
    const first = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00' }), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(first.next.field, 'end_time');
    assert.equal(first.next.text, 'עד מתי?');
    const second = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00', end_time: '19:00' }), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(second.next.field, 'reason');
    assert.equal(second.next.text, 'מה הסיבה?');
    assert.equal(second.understood, true, 'החלון נקבע גם בלי סיבה');
    assert.ok(unavailableEventRow(second.all, SRC_ID));
  });
  test('סוף שנאמר בהודעה: לא שואלים סיבה', () => {
    const state = resolveUnavailable({ known: known({ date: '2026-11-23', time: '17:00', end_time: '19:00' }), fresh: { facts: [{ field: 'end_time', value: '19:00' }], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(state.next, null);
  });
  test('שעה עמומה: "בבוקר או בערב?"', () => {
    const state = resolveUnavailable({ known: known({ date: '2026-11-23' }), ambiguous: new Map([['time', ['09:00', '21:00']]]), fresh: { facts: [], ambiguous: [] }, today: '2026-11-23' });
    assert.equal(state.next.field, 'time');
    assert.equal(state.next.text, 'בבוקר או בערב?');
  });
});

describe('unavailable: applyUnavailableAnswer', () => {
  const all = known({ date: '2026-11-23', time: '17:00' });
  const value = (field, answer, extra = {}) => applyUnavailableAnswer({ facts: [...all.values()], field, answer, now: MONDAY_NOON, all, ...extra }).find((f) => f.field === field)?.value;
  test('"עד מתי?": "7" = 19:00, "19:30" כמו שהוא, "לא יודע" = unknown, לפני ההתחלה = לא מפוענח', () => {
    assert.equal(value('end_time', '7'), '19:00');
    assert.equal(value('end_time', 'עד 19:30'), '19:30');
    assert.equal(value('end_time', 'לא יודע'), 'unknown');
    assert.equal(value('end_time', '16:00'), undefined);
  });
  test('משמעות: רק שתי התוויות', () => {
    assert.equal(value('meaning', 'לא מגיע'), 'skip');
    assert.equal(value('meaning', 'לא זמין בגלל זה'), 'busy');
    assert.equal(value('meaning', 'אולי'), undefined);
  });
  test('סיבה: טקסט חופשי, "לא יודע" = unknown', () => {
    assert.equal(value('reason', 'הופעה'), 'הופעה');
    assert.equal(value('reason', 'לא יודע'), 'unknown');
  });
});

describe('unavailable: שורת החלון והבועה', () => {
  test('שורת events: domain unavailable, לא מסונכרנת ל-Google, הכותרת עם הסיבה', () => {
    assert.deepEqual(unavailableEventRow(known({ date: '2026-11-23', time: '17:00', end_time: '19:00', reason: 'הופעה' }), SRC_ID), {
      title: 'לא זמין · הופעה', domain: 'unavailable', start_date: '2026-11-23', start_time: '17:00', end_date: '2026-11-23', end_time: '19:00', movable: false, match_key: `source:${SRC_ID}`,
    });
  });
  test('סוף unknown: אין חלון', () => assert.equal(unavailableEventRow(known({ date: '2026-11-23', time: '17:00', end_time: 'unknown' }), SRC_ID), null));
  test('הבועה', () => assert.equal(unavailableReply(known({ date: '2026-11-23', time: '17:00', end_time: '19:00' })), 'נרשם · לא זמין · 17:00–19:00 · שני 23.11 · בלי התראות עד 19:00'));
});

describe('unavailable: מקצה לקצה בצינור (processSource / answerQuestion)', () => {
  const intakeSql = (events = []) => fakeSql((text) => {
    if (text.includes('FROM events e')) return events;
    if (text.includes('WITH claim AS')) return [{ claimed: 1 }];
    return [];
  });
  test('מוקלד, בלי מוח: "אני לא זמין ב-5" עם אימון ב-17:00 = שאלת המשמעות, בלי חלון ובלי בועה', async () => {
    const sql = intakeSql([TRAINING_ROW]);
    const out = await processSource({ sql, source: source('אני לא זמין ב-5'), timetable: null });
    assert.equal(out.status, 'recorded');
    const [write] = sql.find('WITH claim AS');
    const values = write.values;
    const facts = JSON.parse(values.find((v) => typeof v === 'string' && v.includes('"field":"conflict"')));
    assert.ok(facts.some((f) => f.field === 'type' && f.value === 'unavailable'));
    assert.ok(values.includes('יש לך אימון ב-17:00. אתה לא מגיע לאימון, או שאתה לא זמין בגלל זה?'));
    assert.ok(values.includes('[]'), 'בלי שורת אירוע עד שיובל עונה');
  });
  test('מוקלד, טווח מלא בלי התנגשות: נרשם, חלון ב-events, בלי שאלה', async () => {
    const sql = intakeSql([]);
    const out = await processSource({ sql, source: source('אני לא זמין מחר מ-17:00 עד 19:00'), timetable: null });
    assert.equal(out.reply, 'נרשם · לא זמין · 17:00–19:00 · שלישי 24.11 · בלי התראות עד 19:00');
    const [write] = sql.find('WITH claim AS');
    const event = JSON.parse(write.values.find((v) => typeof v === 'string' && v.includes('"domain":"unavailable"')));
    assert.equal(event[0].start_time, '17:00');
  });
  test('הודעה מועברת עם "אני לא זמין": לא חלון של יובל (בלי מוח: כמו קודם)', async () => {
    const sql = intakeSql([]);
    const out = await processSource({ sql, source: source('אני לא זמין ב-5', { channel: 'shortcut' }), timetable: null });
    assert.equal(sql.find('"domain":"unavailable"').length, 0);
    assert.notEqual(out.reply?.startsWith('נרשם · לא זמין'), true);
  });
  test('מוח: kind unavailable מוקלד = אותו מסלול; מועבר = לא מסווג', async () => {
    const understanding = { kind: 'unavailable', subject: null, topic: null, date_text: 'מחר', new_date_text: null, time_text: 'מ-17:00', new_room: null, uncertain: [] };
    const brain = async () => ({ ok: true, model: 'm', understanding });
    const typed = await processSource({ sql: intakeSql([]), source: source('מחר מ-17:00 עד 19:00 אני לא זמין'), timetable: null, understand: brain });
    assert.match(typed.reply, /^נרשם · לא זמין · 17:00–19:00/);
    const forwarded = await processSource({ sql: intakeSql([]), source: source('מחר מ-17:00 עד 19:00 אני לא זמין', { channel: 'shortcut' }), timetable: null, understand: brain });
    assert.equal(forwarded.status, 'unclassified');
  });
  test('answerQuestion: "לא זמין בגלל זה" = חלון עד סוף האימון, נכתב ב-events', async () => {
    const conflict = JSON.stringify({ title: 'אימון', start: '17:00', end: '19:00' });
    const saved = [{ field: 'type', value: 'unavailable', origin: 'read' }, { field: 'date', value: '2026-11-23', origin: 'inferred' }, { field: 'time', value: '17:00', origin: 'read' }, { field: 'conflict', value: conflict, origin: 'inferred' }];
    const sql = fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [{ id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 }];
      if (text.includes('FROM sources WHERE id')) return [source('אני לא זמין ב-5')];
      if (text.includes('FROM facts WHERE source_id')) return saved;
      if (text.includes('WITH closed AS')) return [{ closed: 1 }];
      return [];
    });
    assert.equal(pendingQuestion({ source: source('אני לא זמין ב-5'), facts: saved, timetable: null }).field, 'meaning');
    const out = await answerQuestion({ sql, messageId: MSG_ID, answer: 'לא זמין בגלל זה', timetable: null, now: MONDAY_NOON });
    assert.equal(out.status, 'answered');
    assert.equal(out.reply, 'נרשם · לא זמין · 17:00–19:00 · שני 23.11 · בלי התראות עד 19:00');
    const [write] = sql.find('WITH closed AS');
    const event = JSON.parse(write.values.find((v) => typeof v === 'string' && v.includes('"domain":"unavailable"')));
    assert.equal(event[0].end_time, '19:00');
  });
});
