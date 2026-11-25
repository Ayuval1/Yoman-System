// "לא נכון" -> "כמה זמן" (יובל, 25.11.2026: "אופציה מההתחלה ... לשנות את זמן הפגישה"), ותיקון שעה עם סוף ("12:30 עד 13:00").
// הדוגמה מהאייפון: "תור לשיננית יום שישי הזה 12:30" נרשם 12:30–13:30, והתור הוא חצי שעה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { buildQuestion, applyAnswer, durationMinutes } from '../lib/intake-questions.js';
import { answerQuestion, pendingQuestion, TYPE_FIELD } from '../lib/intake-process.js';

const NOW = new Date('2026-11-25T05:35:00.000Z'); // רביעי 25.11, 07:35
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';
const TEXT = 'תור לשיננית יום שישי הזה 12:30';
const source = () => ({ id: SRC_ID, channel: 'app', raw_content: TEXT, content_hash: 'h', received_at: NOW });
const fx = (field, value, origin = 'read') => ({ field, value, origin });
const BASE = [fx(TYPE_FIELD, 'personal_event'), fx('date', '2026-11-27'), fx('time', '12:30'), fx('end_time', '13:30', 'inferred'), fx('topic', 'תור לשיננית'), fx('confirm', 'no')];
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));
const factsJsonOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && value.startsWith('[{"field"')));
async function answerTo(saved, reply) {
  const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
  const sql = fakeSql((text) => {
    if (text.includes('FROM messages WHERE id')) return [messageRow];
    if (text.includes('FROM sources WHERE id')) return [source()];
    if (text.includes('FROM facts WHERE source_id')) return saved;
    if (text.includes('INTO facts')) return [{ closed: 1 }];
    return [];
  });
  const result = await answerQuestion({ sql, messageId: MSG_ID, answer: reply, now: NOW, timetable: null });
  return { result, call: writesOf(sql).find((c) => c.text.includes('INTO facts')) };
}

describe('"מה לא נכון?": כפתור "כמה זמן"', () => {
  test('אירוע ביום אחד עם שעה: השעה / כמה זמן / התאריך / לא קורה; יציאה מוקדמת וכמה ימים: בלי', () => {
    assert.deepEqual(buildQuestion({ field: 'fix', type: 'personal_event', facts: BASE }).buttons, ['השעה', 'כמה זמן', 'התאריך', 'לא קורה']);
    assert.deepEqual(buildQuestion({ field: 'fix', type: 'early_leave', facts: [fx('date', '2026-11-27'), fx('time', '12:00')] }).buttons, ['השעה', 'התאריך', 'לא קורה']);
    const multi = [fx('date', '2026-11-30'), fx('end_date', '2026-12-03')];
    assert.ok(!buildQuestion({ field: 'fix', type: 'personal_event', facts: multi }).buttons.includes('כמה זמן'));
  });
  test('בחירת "כמה זמן" פותחת שאלה "כמה זמן?" עם חצי שעה / שעה / שעה וחצי / שעתיים ותיבת כתיבה', () => {
    const chosen = applyAnswer({ facts: BASE, field: 'fix', answer: 'כמה זמן' });
    assert.equal(chosen.find((f) => f.field === 'fix').value, 'length');
    assert.equal(pendingQuestion({ source: source(), facts: [...BASE, fx('fix', 'length')], timetable: null }).field, 'fix_end_time');
    const q = buildQuestion({ field: 'fix_end_time', type: 'personal_event', facts: BASE });
    assert.equal(q.text, 'כמה זמן?');
    assert.deepEqual(q.buttons.slice(0, 4), ['חצי שעה', 'שעה', 'שעה וחצי', 'שעתיים']);
    assert.equal(q.allowFreeText, true);
  });
  test('פענוח: אורך מילים, דקות, "עד 13:00", ושעה לבד; סוף לפני ההתחלה = לא תקין', () => {
    const end = (answer, facts = BASE) => applyAnswer({ facts, field: 'fix_end_time', answer }).find((f) => f.field === 'fix_end_time')?.value;
    assert.equal(end('חצי שעה'), '13:00');
    assert.equal(end('שעה וחצי'), '14:00');
    assert.equal(end('שעתיים'), '14:30');
    assert.equal(end('45 דקות'), '13:15');
    assert.equal(end('עד 13:00'), '13:00');
    assert.equal(end('13:00'), '13:00');
    assert.equal(end('12:00'), undefined);
    assert.equal(end('בלה'), undefined);
    assert.equal(durationMinutes('רבע שעה'), 15);
    assert.equal(durationMinutes('שעה'), 60);
  });
  test('"חצי שעה": האירוע מתעדכן ל-12:30–13:00 ונשלחת בועת "עודכן"', async () => {
    const { result, call } = await answerTo([...BASE, fx('fix', 'length')], 'חצי שעה');
    assert.equal(result.status, 'answered');
    assert.deepEqual(factsJsonOf(call), [{ field: 'fix_end_time', value: '13:00', origin: 'read' }]);
    const update = JSON.parse(call.values[21]);
    assert.equal(update.length, 1);
    assert.equal(update[0].start_time, '12:30');
    assert.equal(update[0].end_time, '13:00');
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith('עודכן')));
  });
});

describe('תיקון "השעה" עם סוף (א\')', () => {
  test('"12:30 עד 13:00" ו-"12:30-13:00": גם הסוף נשמר', () => {
    for (const answer of ['12:30 עד 13:00', '12:30-13:00']) {
      const out = applyAnswer({ facts: BASE, field: 'fix_time', answer });
      assert.equal(out.find((f) => f.field === 'fix_time').value, '12:30', answer);
      assert.equal(out.find((f) => f.field === 'fix_end_time')?.value, '13:00', answer);
    }
    assert.equal(applyAnswer({ facts: BASE, field: 'fix_time', answer: '14:00' }).find((f) => f.field === 'fix_end_time'), undefined);
  });
  test('בתשובה: האירוע 12:30–13:00 (לא שעה אחרי)', async () => {
    const { call } = await answerTo([...BASE, fx('fix', 'time')], '12:30 עד 13:00');
    const update = JSON.parse(call.values[21]);
    assert.equal(update[0].end_time, '13:00');
  });
  test('תיקון שעה בלי סוף: כמו קודם, שעה אחרי ההתחלה החדשה', async () => {
    const { call } = await answerTo([...BASE, fx('fix', 'time')], '14:00');
    const update = JSON.parse(call.values[21]);
    assert.equal(update[0].start_time, '14:00');
    assert.equal(update[0].end_time, '15:00');
  });
});
