// לוז 4fitness שמגיע אחרי "כן" על תוכנית למידה (problem-log 2026-11-24, "נשאר: לוז שמגיע אחרי 'כן'").
// האימון גובר (03-boundaries-rules.md, "אימון לא זז בחיים"; כלל 3 וכלל 4): שעת למידה שנכנסה ליומן ונתפסה באימון מוזזת לשעה פנויה מהרזרבה
// של אותו מבחן (כמו "נתפס בינתיים, הוחלף בשעה אחרת" ב-lib/study-plan.js), ואם אין, מבוטלת. שניהם נאמרים בבועת הלוז, באותה פקודה אטומית.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { processSource } from '../lib/intake-process.js';
import { fakeSql } from './helpers.js';

const SRC_ID = '11111111-1111-4111-8111-111111111111';
const STUDY_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb';
const STUDY2_ID = 'eeeeeeee-ffff-4aaa-8bbb-cccccccccccc';
const SATURDAY = new Date('2026-11-28T18:00:00Z'); // שבת 28.11 20:00 בישראל
const SCHEDULE = 'שני משתלה 18:00\nרביעי מנוחה'; // שני 30.11: אימון 18:00–20:00, התארגנות 17:00–17:30
const EXAM = 'exam:2026-12-03:ספרות';
const studyRow = (over = {}) => ({
  id: STUDY_ID, title: 'למידה למבחן בספרות', match_key: 'source:study:2026-12-03:ספרות:2026-11-30T19:00',
  start_date: '2026-11-30', start_time: '19:00', end_date: '2026-11-30', end_time: '20:00', ...over,
});
const source = (text = SCHEDULE) => ({ id: SRC_ID, channel: 'shortcut', raw_content: text, content_hash: 'h', received_at: SATURDAY });
const freeGoogle = async () => ({ ok: true, events: [] });

function pipeSql({ study = [], spare = [], busyRows = [] } = {}) {
  return fakeSql((text) => {
    if (text.includes('fitness-existing')) return [];
    if (text.includes('fitness-study-clash')) return study;
    if (text.includes('fitness-study-spare')) return spare.map((list) => ({ exam: EXAM, spare: JSON.stringify(list) }));
    if (text.includes('FROM events e')) return busyRows;
    if (text.includes('fitness-write')) return [{ claimed: 1 }];
    return [];
  });
}
const writeOf = (sql) => {
  const calls = sql.find('fitness-write');
  assert.equal(calls.length, 1);
  return calls[0];
};
const jsonParams = (call) => call.values.filter((v) => typeof v === 'string' && v.startsWith('[')).map((v) => JSON.parse(v));
// סדר הפרמטרים: creates, updates, cancels, changes (האימונים, כמו קודם), ואחריהם studyMoves, studyCancels, studyChanges.
const studyParams = (call) => jsonParams(call).slice(4);

describe('לוז 4fitness אחרי "כן": שעת למידה שנתפסה באימון', () => {
  test('למידה בשני 19:00 והאימון 18:00: מוזזת לשעה הפנויה מהרזרבה, changes, PATCH ל-Google, והבועה אומרת זאת', async () => {
    const sql = pipeSql({ study: [studyRow()], spare: [[{ date: '2026-12-01', start: '16:00', end: '17:00' }]] });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    assert.equal(result.status, 'recorded');
    const call = writeOf(sql);
    const [moves, cancels, changes] = studyParams(call);
    assert.deepEqual(moves, [{ id: STUDY_ID, start_date: '2026-12-01', start_time: '16:00', end_date: '2026-12-01', end_time: '17:00' }]);
    assert.deepEqual(cancels, []);
    assert.deepEqual(changes, [
      { entity_id: STUDY_ID, field: 'starts_at', old_value: '2026-11-30 19:00', new_value: '2026-12-01 16:00' },
      { entity_id: STUDY_ID, field: 'ends_at', old_value: '2026-11-30 20:00', new_value: '2026-12-01 17:00' },
    ]);
    assert.match(call.text, /domain = 'study'/);
    assert.ok(result.reply.includes('למידה למבחן בספרות, שני 30.11 19:00: נתפסה באימון, הוזזה לשלישי 1.12 16:00–17:00.'), result.reply);
    assert.ok(call.values.includes(result.reply), 'ההודעה נכתבת באותה פקודה של ההזזה');
    assert.ok(result.fitness.keys.includes(studyRow().match_key));
    assert.ok(result.fitness.patchKeys.includes(studyRow().match_key));
  });

  test('אין רזרבה: שעת הלמידה מבוטלת (status cancelled, בלי מחיקה), changes, מחיקה מ-Google, והבועה אומרת זאת', async () => {
    const sql = pipeSql({ study: [studyRow()], spare: [] });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    const call = writeOf(sql);
    const [moves, cancels, changes] = studyParams(call);
    assert.deepEqual(moves, []);
    assert.deepEqual(cancels, [{ id: STUDY_ID }]);
    assert.deepEqual(changes, [{ entity_id: STUDY_ID, field: 'status', old_value: 'planned', new_value: 'cancelled' }]);
    assert.ok(!/\bDELETE\b/.test(call.text));
    assert.ok(result.reply.includes('למידה למבחן בספרות, שני 30.11 19:00: נתפסה באימון ובוטלה. אין שעה פנויה אחרת לפני המבחן.'), result.reply);
    assert.ok(result.fitness.keys.includes(studyRow().match_key));
    assert.ok(!result.fitness.patchKeys.includes(studyRow().match_key));
  });

  test('Google לא נבדק: לא מחפשים שעה חלופית על נתונים חלקיים; מבוטלת, והבועה אומרת למה', async () => {
    const sql = pipeSql({ study: [studyRow()], spare: [[{ date: '2026-12-01', start: '16:00', end: '17:00' }]] });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: async () => ({ ok: false }) });
    const [moves, cancels] = studyParams(writeOf(sql));
    assert.deepEqual(moves, []);
    assert.deepEqual(cancels, [{ id: STUDY_ID }]);
    assert.ok(result.reply.includes('נתפסה באימון ובוטלה. לא הצלחתי לבדוק את היומן לשעה אחרת.'), result.reply);
  });

  test('למידה בשני 16:00–17:00 (לפני ההתארגנות, כלל 3): לא נוגעים, ולא נקראים רזרבה ו-Google', async () => {
    let googleCalls = 0;
    const sql = pipeSql({ study: [studyRow({ start_time: '16:00', end_time: '17:00' })] });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: async () => { googleCalls += 1; return { ok: true, events: [] }; } });
    const [moves, cancels, changes] = studyParams(writeOf(sql));
    assert.deepEqual([moves, cancels, changes], [[], [], []]);
    assert.equal(sql.find('fitness-study-spare').length, 0);
    assert.equal(googleCalls, 0);
    assert.equal(result.reply, 'נרשמו האימונים: שני 30.11 18:00–20:00 משתלה · רביעי 2.12 מנוחה (אין אימון לבטל)');
  });

  test('שאילתת הלמידה: study, planned, source:study, בימי האימון בלבד (לא ביום מנוחה), ושעוד לא נגמרה', async () => {
    const sql = pipeSql();
    await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    const [query] = sql.find('fitness-study-clash');
    assert.match(query.text, /domain = 'study' AND status = 'planned' AND match_key LIKE 'source:study:%'/);
    assert.ok(query.values.includes(JSON.stringify(['2026-11-30'])));
    assert.ok(query.values.some((v) => v === SATURDAY.toISOString()));
  });

  test('רזרבה ביום האימון אחרי ההתארגנות לא נבחרת; הבאה בתור כן', async () => {
    const spare = [[{ date: '2026-11-30', start: '20:30', end: '21:30' }, { date: '2026-12-01', start: '16:00', end: '17:00' }]];
    const sql = pipeSql({ study: [studyRow()], spare });
    await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    const [moves] = studyParams(writeOf(sql));
    assert.deepEqual(moves.map((m) => [m.start_date, m.start_time]), [['2026-12-01', '16:00']]);
  });

  test('רזרבה שנתפסה ביומן לא נבחרת', async () => {
    const busyRows = [{ title: 'רופא', starts_at: '2026-12-01T14:00:00.000Z', ends_at: '2026-12-01T15:00:00.000Z', domain: 'personal', external_id: null }];
    const sql = pipeSql({ study: [studyRow()], spare: [[{ date: '2026-12-01', start: '16:00', end: '17:00' }]], busyRows });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    const [moves, cancels] = studyParams(writeOf(sql));
    assert.deepEqual(moves, []);
    assert.deepEqual(cancels, [{ id: STUDY_ID }]);
    assert.ok(result.reply.includes('אין שעה פנויה אחרת'));
  });

  test('שתי שעות שנתפסו ורזרבה אחת: הראשונה מוזזת, השנייה מבוטלת (אותה רזרבה לא ניתנת פעמיים)', async () => {
    const second = studyRow({ id: STUDY2_ID, match_key: 'source:study:2026-12-03:ספרות:2026-11-30T20:30', start_time: '20:30', end_time: '21:30' });
    const sql = pipeSql({ study: [studyRow(), second], spare: [[{ date: '2026-12-01', start: '16:00', end: '17:00' }]] });
    const result = await processSource({ sql, source: source(), timetable: null, googleDay: freeGoogle });
    const [moves, cancels] = studyParams(writeOf(sql));
    assert.deepEqual(moves.map((m) => m.id), [STUDY_ID]);
    assert.deepEqual(cancels, [{ id: STUDY2_ID }]);
    assert.ok(result.fitness.keys.includes(second.match_key));
  });
});
