// בדיקות לשאלת החופשה היומית ולכרטיס המסגרת (lib/vacation-ask.js). מקור: docs/02-rules/03-personal-weights-rules.md §5.1; docs/01-foundation/05-open-questions.md:96;
// docs/08-chapter8/68-chapter8-brief-prd.md D7 וסעיף "שאלת החופשה היומית". בלי רשת ובלי מסד אמיתי: sql מזויף מ-helpers.js. כל הכותרות מומצאות.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי. הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  VACATION_DAY_BUTTONS, VACATION_FRAME_APPROVE, VACATION_FRAME_FIX, VACATION_DAY_TYPE, VACATION_FRAME_TYPE,
  vacationDayText, vacationRangeLabel, composeVacationFrame, vacationDayEntityId, vacationFrameEntityId,
  dayAskExpiresAt, frameExpiresAt, vacationReply, vacationButtons,
  createVacationDayAsk, createVacationFrame, ensureVacationMorning, ensureVacationEvening, answerVacation,
} from '../lib/vacation-ask.js';
import { pendingFromRows, parseChatAction } from '../lib/chat-view.js';
import { handle } from '../api/chat.js';
import { fakeSql, captureConsole, jsonRequest, FAKE_SECRET } from './helpers.js';

const HANUKKAH = { name: 'חנוכה', from: '2026-12-06', to: '2026-12-12' };
const PESACH = { name: 'פסח', from: '2027-03-30', to: '2027-04-04' }; // מומצא: חוצה חודש
const SUMMER = { name: 'סוף שנת הלימודים', from: '2027-06-20', to: '2027-06-20', endOfYear: true };
const VACATIONS = [HANUKKAH, SUMMER];
const LRI = '⁦';
const PDI = '⁩';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MORNING = new Date('2026-12-06T05:30:00.000Z'); // 07:30 בישראל, יום ראשון של חנוכה
const EVENING_BEFORE = new Date('2026-12-05T19:00:00.000Z'); // 21:00 בישראל, שבת לפני החופשה

describe('vacation-ask: טקסטים טהורים', () => {
  test('נוסח השאלה היומית ושלושת הכפתורים', () => {
    assert.equal(vacationDayText(HANUKKAH), 'חופש חנוכה · מה התוכנית היום?');
    assert.deepEqual([...VACATION_DAY_BUTTONS], ['משימות ולמידה', 'מנוחה', 'יוצא מהבית']);
  });
  test('טווח התאריכים: באותו חודש "6–12.12", בין חודשים "30.3–4.4", עטוף בבידוד כיווני', () => {
    assert.equal(vacationRangeLabel(HANUKKAH), `${LRI}6–12.12${PDI}`);
    assert.equal(vacationRangeLabel(PESACH), `${LRI}30.3–4.4${PDI}`);
  });
  test('כרטיס מסגרת: כותרת, יום לכל תאריך עם פריטים (מבחן ואז משימות), שורת הסיום; משימה מחוץ לחופש ומשימה בלי תאריך לא נכללות', () => {
    const tasks = [
      { id: 'a', title: 'עבודה באנגלית', due_at: '2026-12-09T06:00:00.000Z' },
      { id: 'b', title: 'דף בהיסטוריה', due_at: '2026-12-06T21:30:00.000Z' }, // 23:30 בישראל ב-6.12
      { id: 'c', title: 'משימה רחוקה', due_at: '2026-12-20T06:00:00.000Z' },
      { id: 'd', title: 'בלי תאריך' },
      { id: 'e', title: 'קריאה', due_at: '2026-12-09T08:00:00.000Z' },
    ];
    const exams = [
      { date: '2026-12-09', type: 'מבחן', subject: 'ספרות', makeup: false },
      { date: '2026-12-10', type: "מועד ב'", subject: null, makeup: true },
      { date: '2026-12-13', type: 'מבחן', subject: 'אנגלית', makeup: false },
    ];
    assert.equal(composeVacationFrame({ vacation: HANUKKAH, tasks, exams }), [
      `חופש חנוכה ${LRI}6–12.12${PDI}`,
      '· ראשון 6.12: דף בהיסטוריה',
      '· רביעי 9.12: מבחן בספרות · עבודה באנגלית · קריאה',
      'מיד אחרי החופשה:',
      '· ראשון 13.12: מבחן באנגלית',
      'כל בוקר אשאל מה התוכנית',
    ].join('\n'));
  });
  test('"מיד אחרי החופשה": מבחנים ומשימות עד 3 ימים אחרי היום האחרון (13-15.12); 16.12 כבר לא; השורה מושמטת כשריקה', () => {
    const tasks = [
      { id: 'a', title: 'עבודה באנגלית', due_at: '2026-12-15T06:00:00.000Z' },
      { id: 'b', title: 'רחוקה מדי', due_at: '2026-12-16T06:00:00.000Z' },
    ];
    const exams = [
      { date: '2026-12-13', type: 'מבחן', subject: 'אנגלית', makeup: false },
      { date: '2026-12-14', type: "מועד ב'", subject: null, makeup: true },
      { date: '2026-12-16', type: 'מבחן', subject: 'היסטוריה', makeup: false },
    ];
    assert.equal(composeVacationFrame({ vacation: HANUKKAH, tasks, exams }), [
      `חופש חנוכה ${LRI}6–12.12${PDI}`,
      'אין משימות או מבחנים עם תאריך בחופש',
      'מיד אחרי החופשה:',
      '· ראשון 13.12: מבחן באנגלית',
      '· שלישי 15.12: עבודה באנגלית',
      'כל בוקר אשאל מה התוכנית',
    ].join('\n'));
    assert.ok(!composeVacationFrame({ vacation: HANUKKAH, tasks: [tasks[1]], exams: [exams[2]] }).includes('מיד אחרי החופשה'));
  });
  test('כרטיס מסגרת בלי פריטים עם תאריך: שורת "אין" במקום רשימת הימים', () => {
    assert.equal(composeVacationFrame({ vacation: HANUKKAH, tasks: [], exams: [] }), [
      `חופש חנוכה ${LRI}6–12.12${PDI}`,
      'אין משימות או מבחנים עם תאריך בחופש',
      'כל בוקר אשאל מה התוכנית',
    ].join('\n'));
  });
  test('מזהים דטרמיניסטיים: אותו יום = אותו מזהה, יום אחר = מזהה אחר; מסגרת לפי שם ותאריך התחלה', () => {
    assert.equal(vacationDayEntityId('2026-12-06'), vacationDayEntityId('2026-12-06'));
    assert.notEqual(vacationDayEntityId('2026-12-06'), vacationDayEntityId('2026-12-07'));
    assert.equal(vacationFrameEntityId(HANUKKAH), vacationFrameEntityId({ ...HANUKKAH }));
    assert.notEqual(vacationFrameEntityId(HANUKKAH), vacationFrameEntityId({ ...HANUKKAH, from: '2027-12-06' }));
    assert.match(vacationDayEntityId('2026-12-06'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  test('תפוגה: השאלה היומית בחצות שעון ישראל בסוף אותו יום; המסגרת בחצות אחרי היום האחרון של החופשה', () => {
    assert.equal(dayAskExpiresAt('2026-12-06').toISOString(), '2026-12-06T22:00:00.000Z');
    assert.equal(frameExpiresAt(HANUKKAH).toISOString(), '2026-12-12T22:00:00.000Z');
  });
  test('כפתורים לפי סוג, כמחרוזות (כמו שאלה רגילה, כדי שהכרטיס הקיים בדף יציג אותם): יומית = שלושה; מסגרת = מאשר / לתקן', () => {
    assert.deepEqual(vacationButtons(VACATION_DAY_TYPE), ['משימות ולמידה', 'מנוחה', 'יוצא מהבית']);
    assert.deepEqual(vacationButtons(VACATION_FRAME_TYPE), [VACATION_FRAME_APPROVE, VACATION_FRAME_FIX]);
  });
});

describe('vacation-ask: שורת התשובה', () => {
  const tasks = [
    { id: 'b', title: 'בלי תאריך' },
    { id: 'a', title: 'עבודה באנגלית', due_at: '2026-12-09T06:00:00.000Z' },
    { id: 'c', title: 'דף ישן', due_at: '2026-12-01T06:00:00.000Z' },
  ];
  test('"משימות ולמידה": רשימת המשימות הפתוחות לפי תאריך יעד, הקרובה ראשונה, בלי תאריך בסוף', () => {
    assert.deepEqual(vacationReply({ entityType: VACATION_DAY_TYPE, answer: 'משימות ולמידה', tasks, todayIso: '2026-12-06' }), {
      status: 'answered',
      reply: [
        'נרשם. המשימות הפתוחות לפי תאריך (3):',
        '· דף ישן — באיחור (היה עד שלישי 1.12)',
        '· עבודה באנגלית — עד רביעי 9.12',
        '· בלי תאריך — בלי תאריך',
      ].join('\n'),
    });
  });
  test('"משימות ולמידה" בלי משימות פתוחות', () => {
    assert.equal(vacationReply({ entityType: VACATION_DAY_TYPE, answer: 'משימות ולמידה', tasks: [], todayIso: '2026-12-06' }).reply, 'נרשם. אין משימות פתוחות. יום טוב');
  });
  test('"מנוחה", "יוצא מהבית" וטקסט חופשי: "נרשם. יום טוב"', () => {
    for (const answer of ['מנוחה', 'יוצא מהבית', 'לים עם חברים']) {
      assert.deepEqual(vacationReply({ entityType: VACATION_DAY_TYPE, answer, tasks, todayIso: '2026-12-06' }), { status: 'answered', reply: 'נרשם. יום טוב' });
    }
  });
  test('מסגרת: "מאשר" / תיקון בכתיבה נרשם / "לתקן" לבד = unclear (השאלה נשארת פתוחה)', () => {
    assert.deepEqual(vacationReply({ entityType: VACATION_FRAME_TYPE, answer: 'מאשר' }), { status: 'answered', reply: 'נרשם. כל בוקר אשאל מה התוכנית' });
    assert.deepEqual(vacationReply({ entityType: VACATION_FRAME_TYPE, answer: 'העבודה באנגלית עד 13.12' }), { status: 'answered', reply: 'נרשם התיקון. המשימות עצמן לא שונו' });
    assert.deepEqual(vacationReply({ entityType: VACATION_FRAME_TYPE, answer: '  לתקן ' }), { status: 'unclear', reply: null });
  });
});

// מסד מדומה קטן: messages בזיכרון לפי צורת הפקודות של lib/vacation-ask.js.
function vacationDb({ messages = [], tasks = [], fail = null } = {}) {
  const state = { messages: [...messages], sources: [] };
  const sql = fakeSql((text, values) => {
    if (fail && fail(text)) throw Object.assign(new Error('db down'), { name: 'NeonDbError' });
    if (text.includes('FROM tasks t')) return tasks;
    if (text.includes('FROM exam_asks')) return [];
    if (text.startsWith('INSERT INTO messages')) {
      const [body, expiresAt, entityType, entityId] = values;
      if (state.messages.some((m) => m.entity_type === entityType && m.entity_id === entityId)) return [];
      const id = uuid(100 + state.messages.length);
      state.messages.push({ id, body, expires_at: expiresAt, entity_type: entityType, entity_id: entityId, awaiting_reply: true, kind: 'question' });
      return [{ id }];
    }
    return [];
  });
  sql.state = state;
  return sql;
}

describe('vacation-ask: יצירה', () => {
  test('שאלה יומית: הכנסה אחת עם WHERE NOT EXISTS, kind question, awaiting_reply, תפוגה בסוף היום; הרצה שנייה לא יוצרת', async () => {
    const sql = vacationDb();
    assert.equal(await createVacationDayAsk({ sql, dateIso: '2026-12-06', vacation: HANUKKAH, now: MORNING }), true);
    assert.equal(await createVacationDayAsk({ sql, dateIso: '2026-12-06', vacation: HANUKKAH, now: MORNING }), false);
    assert.equal(sql.state.messages.length, 1);
    const [insert] = sql.find('INSERT INTO messages');
    assert.match(insert.text, /INSERT INTO messages \(direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt\) SELECT 'out', \?::text, 'question', now\(\), true, NULL::uuid, \?::timestamptz, \?::text, \?::uuid, 1 WHERE NOT EXISTS \(SELECT 1 FROM messages WHERE entity_type = \?::text AND entity_id = \?::uuid\) RETURNING id/);
    assert.deepEqual(insert.values, ['חופש חנוכה · מה התוכנית היום?', '2026-12-06T22:00:00.000Z', 'vacation_day', vacationDayEntityId('2026-12-06'), 'vacation_day', vacationDayEntityId('2026-12-06')]);
  });
  test('שאלה יומית שמגיעה אחרי סוף היום (ניסיון חוזר מאוחר) לא נוצרת', async () => {
    const sql = vacationDb();
    assert.equal(await createVacationDayAsk({ sql, dateIso: '2026-12-06', vacation: HANUKKAH, now: new Date('2026-12-06T22:00:00.000Z') }), false);
    assert.equal(sql.calls.length, 0);
  });
  test('מסגרת: טוענת משימות, כותבת את הכרטיס עם תפוגה בסוף החופשה, פעם אחת לחופשה', async () => {
    const sql = vacationDb({ tasks: [{ id: 'a', title: 'עבודה באנגלית', due_at: '2026-12-09T06:00:00.000Z', media_count: 0 }] });
    assert.equal(await createVacationFrame({ sql, vacation: HANUKKAH, now: EVENING_BEFORE, exams: [] }), true);
    assert.equal(await createVacationFrame({ sql, vacation: HANUKKAH, now: MORNING, exams: [] }), false);
    assert.equal(sql.state.messages.length, 1);
    const [frame] = sql.state.messages;
    assert.equal(frame.entity_type, 'vacation_frame');
    assert.equal(frame.entity_id, vacationFrameEntityId(HANUKKAH));
    assert.equal(frame.expires_at, '2026-12-12T22:00:00.000Z');
    assert.equal(frame.body, `חופש חנוכה ${LRI}6–12.12${PDI}\n· רביעי 9.12: עבודה באנגלית\nכל בוקר אשאל מה התוכנית`);
  });
  test('בוקר ביום הראשון: מסגרת (אם חסרה) ואז שאלה יומית; ביום אמצעי רק שאלה יומית; ביום לימודים כלום', async () => {
    const first = vacationDb();
    assert.deepEqual(await ensureVacationMorning({ sql: first, dateIso: '2026-12-06', now: MORNING, vacations: VACATIONS, exams: [] }), { frame: true, day: true });
    assert.deepEqual(first.state.messages.map((m) => m.entity_type), ['vacation_frame', 'vacation_day']);
    const middle = vacationDb();
    assert.deepEqual(await ensureVacationMorning({ sql: middle, dateIso: '2026-12-08', now: new Date('2026-12-08T05:30:00Z'), vacations: VACATIONS, exams: [] }), { frame: false, day: true });
    assert.deepEqual(middle.state.messages.map((m) => m.entity_type), ['vacation_day']);
    const school = vacationDb();
    assert.deepEqual(await ensureVacationMorning({ sql: school, dateIso: '2026-12-13', now: new Date('2026-12-13T05:30:00Z'), vacations: VACATIONS, exams: [] }), { frame: false, day: false });
    assert.equal(school.calls.length, 0);
  });
  test('שבת בתוך החופשה (12.12) מקבלת שאלה יומית', async () => {
    const sql = vacationDb();
    assert.deepEqual(await ensureVacationMorning({ sql, dateIso: '2026-12-12', now: new Date('2026-12-12T05:30:00Z'), vacations: VACATIONS, exams: [] }), { frame: false, day: true });
  });
  test('סוף שנת הלימודים (endOfYear): שאלה יומית כן, כרטיס מסגרת לא (אין תאריך סיום)', async () => {
    const sql = vacationDb();
    assert.deepEqual(await ensureVacationMorning({ sql, dateIso: '2027-06-20', now: new Date('2027-06-20T04:30:00Z'), vacations: VACATIONS, exams: [] }), { frame: false, day: true });
    const evening = vacationDb();
    assert.deepEqual(await ensureVacationEvening({ sql: evening, dateIso: '2027-06-19', now: new Date('2027-06-19T18:00:00Z'), vacations: VACATIONS, exams: [] }), { frame: false });
  });
  test('ערב לפני החופשה: מסגרת נוצרת; ערב אחר: כלום; ערב בתוך החופשה: כלום', async () => {
    const before = vacationDb();
    assert.deepEqual(await ensureVacationEvening({ sql: before, dateIso: '2026-12-05', now: EVENING_BEFORE, vacations: VACATIONS, exams: [] }), { frame: true });
    const other = vacationDb();
    assert.deepEqual(await ensureVacationEvening({ sql: other, dateIso: '2026-12-01', now: new Date('2026-12-01T19:00:00Z'), vacations: VACATIONS, exams: [] }), { frame: false });
    assert.equal(other.calls.length, 0);
    const inside = vacationDb();
    assert.deepEqual(await ensureVacationEvening({ sql: inside, dateIso: '2026-12-07', now: new Date('2026-12-07T19:00:00Z'), vacations: VACATIONS, exams: [] }), { frame: false });
  });
  test('כשל מסד לא נזרק (הבריף והסגירה ממשיכים); בלוג רק שם השגיאה', async (t) => {
    const out = captureConsole(t);
    const sql = vacationDb({ fail: () => true });
    assert.deepEqual(await ensureVacationMorning({ sql, dateIso: '2026-12-06', now: MORNING, vacations: VACATIONS, exams: [] }), { frame: false, day: false });
    assert.deepEqual(await ensureVacationEvening({ sql, dateIso: '2026-12-05', now: EVENING_BEFORE, vacations: VACATIONS, exams: [] }), { frame: false });
    assert.match(out.text(), /NeonDbError/);
    assert.ok(!out.text().includes('db down'));
  });
});

describe('vacation-ask: תשובה (answerVacation)', () => {
  const MSG = uuid(1);
  const answerDb = ({ row = { id: MSG, entity_type: 'vacation_day', awaiting_reply: true }, tasks = [], written = [{ closed: 1, answer_source_id: uuid(2), bubble_id: uuid(3) }] } = {}) => fakeSql((text) => {
    if (text.startsWith('SELECT m.id, m.entity_type, m.awaiting_reply FROM messages m')) return row ? [row] : [];
    if (text.includes('FROM tasks t')) return tasks;
    if (text.startsWith('WITH closed AS')) return written;
    return [];
  });
  test('"משימות ולמידה": טוען משימות, סוגר את השאלה, שומר את התשובה כשורת מקור ובועת תשובה, בפקודה אחת', async () => {
    const sql = answerDb({ tasks: [{ id: 'a', title: 'עבודה באנגלית', due_at: '2026-12-09T06:00:00.000Z', media_count: 0 }] });
    const out = await answerVacation({ sql, messageId: MSG, answer: 'משימות ולמידה', now: MORNING });
    assert.deepEqual(out, { status: 'answered', created: { answerSourceId: uuid(2), bubbleId: uuid(3) } });
    const [write] = sql.find('WITH closed AS');
    assert.match(write.text, /UPDATE messages SET awaiting_reply = false, read_at = now\(\), reply_source_id = gen_random_uuid\(\) WHERE id = \?::uuid AND kind = 'question' AND awaiting_reply = true AND entity_type = \?::text AND \(expires_at IS NULL OR expires_at > \?::timestamptz\)/);
    assert.match(write.text, /INSERT INTO sources \(id, channel, sender, raw_content, content_hash, received_at, processed_at\) SELECT closed.reply_source_id, 'app', 'answer', \?::text, NULL::text, now\(\), now\(\) FROM closed/);
    assert.match(write.text, /INSERT INTO messages \(direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt\) SELECT 'out', \?::text, 'update', now\(\), false, NULL::uuid, NULL::timestamptz, closed.entity_type, closed.entity_id, NULL::integer FROM closed/);
    assert.ok(write.values.includes('משימות ולמידה'));
    assert.ok(write.values.includes('נרשם. המשימות הפתוחות לפי תאריך (1):\n· עבודה באנגלית — עד רביעי 9.12'));
  });
  test('"מנוחה": בלי טעינת משימות', async () => {
    const sql = answerDb();
    assert.equal((await answerVacation({ sql, messageId: MSG, answer: 'מנוחה', now: MORNING })).status, 'answered');
    assert.equal(sql.find('FROM tasks t').length, 0);
  });
  test('שאלה שלא קיימת / נסגרה / פגה: closed בלי כתיבה', async () => {
    for (const row of [null, { id: MSG, entity_type: 'vacation_day', awaiting_reply: false }]) {
      const sql = answerDb({ row });
      assert.deepEqual(await answerVacation({ sql, messageId: MSG, answer: 'מנוחה', now: MORNING }), { status: 'closed', created: {} });
      assert.equal(sql.find('WITH closed AS').length, 0);
    }
  });
  test('לחיצה מקבילה (הסגירה לא שינתה שורה): closed', async () => {
    const sql = answerDb({ written: [{ closed: 0, answer_source_id: null, bubble_id: null }] });
    assert.deepEqual(await answerVacation({ sql, messageId: MSG, answer: 'מנוחה', now: MORNING }), { status: 'closed', created: {} });
  });
  test('מסגרת: "לתקן" בלי טקסט = unclear בלי כתיבה', async () => {
    const sql = answerDb({ row: { id: MSG, entity_type: 'vacation_frame', awaiting_reply: true } });
    assert.deepEqual(await answerVacation({ sql, messageId: MSG, answer: 'לתקן', now: MORNING }), { status: 'unclear', created: {} });
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
});

describe('vacation-ask: הצ\'אט', () => {
  test('pendingFromRows: שאלה יומית ומסגרת הופכות לפריט kind vacation עם טקסט, כפתורים ותיבת כתיבה', () => {
    const list = pendingFromRows({
      questions: [
        { id: uuid(1), body: 'חופש חנוכה · מה התוכנית היום?', sent_at: '2026-12-06T05:30:01.000Z', entity_type: 'vacation_day' },
        { id: uuid(2), body: 'כרטיס', sent_at: '2026-12-06T05:30:00.000Z', entity_type: 'vacation_frame' },
      ],
    });
    assert.deepEqual(list, [
      { id: uuid(2), kind: 'vacation', ask: 'frame', at: '2026-12-06T05:30:00.000Z', text: 'כרטיס', buttons: ['מאשר', 'לתקן'], allowFreeText: true },
      { id: uuid(1), kind: 'vacation', ask: 'day', at: '2026-12-06T05:30:01.000Z', text: 'חופש חנוכה · מה התוכנית היום?', buttons: ['משימות ולמידה', 'מנוחה', 'יוצא מהבית'], allowFreeText: true },
    ]);
  });
  test('parseChatAction: vacation עם מזהה ותשובה לא ריקה; תשובה ריקה או ארוכה מדי נדחית', () => {
    assert.deepEqual(parseChatAction({ action: 'vacation', message_id: uuid(1), answer: 'מנוחה' }), { ok: true, action: 'vacation', messageId: uuid(1), answer: 'מנוחה' });
    assert.deepEqual(parseChatAction({ action: 'vacation', message_id: uuid(1), answer: '  לים  ' }), { ok: true, action: 'vacation', messageId: uuid(1), answer: 'לים' });
    for (const bad of [{ action: 'vacation', message_id: 'x', answer: 'מנוחה' }, { action: 'vacation', message_id: uuid(1), answer: '   ' }, { action: 'vacation', message_id: uuid(1), answer: 'א'.repeat(1001) }, { action: 'vacation', message_id: uuid(1) }]) {
      assert.deepEqual(parseChatAction(bad), { ok: false });
    }
  });
  test('POST vacation: מחזיר status, items (שורת התשובה והבועה), pending ו-badge', async () => {
    const sql = fakeSql((text) => {
      if (text.startsWith('SELECT m.id, m.entity_type, m.awaiting_reply FROM messages m')) return [{ id: uuid(1), entity_type: 'vacation_day', awaiting_reply: true }];
      if (text.startsWith('WITH closed AS')) return [{ closed: 1, answer_source_id: uuid(2), bubble_id: uuid(3) }];
      if (text.includes('UNION ALL') && text.includes('WHERE s.id =')) return [
        { role: 'user', id: uuid(2), text: 'מנוחה', at: '2026-12-06T06:00:00.000Z', channel: 'app', read_at: null },
        { role: 'system', id: uuid(3), text: 'נרשם. יום טוב', at: '2026-12-06T06:00:00.000Z', channel: null, read_at: null },
      ];
      if (text.includes('AS pending')) return [{ pending: 0, unread: 1, open_tasks: 0 }];
      return [];
    });
    const response = await handle(jsonRequest({ action: 'vacation', message_id: uuid(1), answer: 'מנוחה' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), { sql, secret: FAKE_SECRET, timetable: null, now: () => MORNING });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(body.items.map((item) => item.text), ['מנוחה', 'נרשם. יום טוב']);
    assert.deepEqual(body.pending, []);
    assert.equal(typeof body.badge, 'number');
  });
});

// הבריף של 07:30 והסגירה של 21:00 (api/queues/deliver.js). מסד מדומה: מזהה את הכנסות שאלות החופשה לפי entity_type בפרמטרים, ואת הבריף/הסגירה לפי הטקסט.
describe('vacation-ask: חיבור לבריף ולסגירה', async () => {
  const { handleDelivery } = await import('../api/queues/deliver.js');
  const deliverDb = () => {
    const state = { asks: [], updates: [] };
    const sql = fakeSql((text, values) => {
      if (text.includes("'task_check'")) return []; // בלוק 4: שאלות "בוצע?" של הסגירה (lib/personal-task.js), לא נבדקות כאן
      if (text.startsWith('INSERT INTO messages') && text.includes("'question'")) {
        const [body, , entityType, entityId] = values;
        if (state.asks.some((m) => m.entity_type === entityType && m.entity_id === entityId)) return [];
        state.asks.push({ body, entity_type: entityType, entity_id: entityId });
        return [{ id: uuid(500 + state.asks.length) }];
      }
      if (text.includes('INSERT INTO messages') && text.includes("'update'")) {
        state.updates.push({ text, values });
        return [{ id: uuid(900) }];
      }
      return [];
    });
    sql.state = state;
    return sql;
  };
  const run = (message, sql) => handleDelivery(message, { deliveryCount: 1 }, { sql, now: () => new Date(message.targetAt), timetable: null, pushHandle: async () => new Response('ok'), secret: 'x', googleConfig: null, loadTrainings: async () => [] });

  test('בריף ביום הראשון של חנוכה: כרטיס מסגרת ושאלה יומית נוצרים לפני טעינת השאלות, והבריף עצמו נכתב', async () => {
    const sql = deliverDb();
    await run({ kind: 'brief', slotKey: 'brief-2026-12-06', targetAt: '2026-12-06T05:30:00.000Z' }, sql);
    assert.deepEqual(sql.state.asks.map((m) => m.entity_type), ['vacation_frame', 'vacation_day']);
    const askAt = sql.calls.findIndex((c) => c.text.startsWith('INSERT INTO messages') && c.values.includes('vacation_day'));
    const pendingAt = sql.calls.findIndex((c) => c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(askAt >= 0 && pendingAt > askAt, 'השאלה נוצרת לפני טעינת השאלות');
    assert.equal(sql.state.updates.filter((u) => u.text.includes("'brief'")).length, 1);
  });
  test('בריף ביום לימודים: אין שאלת חופשה', async () => {
    const sql = deliverDb();
    await run({ kind: 'brief', slotKey: 'brief-2026-12-13', targetAt: '2026-12-13T05:30:00.000Z' }, sql);
    assert.deepEqual(sql.state.asks, []);
  });
  test('סגירה בערב שלפני החופשה (5.12): כרטיס המסגרת נוצר, ובבוקר שאחריו לא נוצר שני', async () => {
    const sql = deliverDb();
    await run({ kind: 'close', slotKey: 'close-2026-12-05', targetAt: '2026-12-05T19:00:00.000Z' }, sql);
    assert.deepEqual(sql.state.asks.map((m) => m.entity_type), ['vacation_frame']);
    await run({ kind: 'brief', slotKey: 'brief-2026-12-06', targetAt: '2026-12-06T05:30:00.000Z' }, sql);
    assert.deepEqual(sql.state.asks.map((m) => m.entity_type), ['vacation_frame', 'vacation_day']);
  });
  test('סגירה בערב רגיל: אין כרטיס', async () => {
    const sql = deliverDb();
    await run({ kind: 'close', slotKey: 'close-2026-12-02', targetAt: '2026-12-02T19:00:00.000Z' }, sql);
    assert.deepEqual(sql.state.asks, []);
  });
});

describe('vacation-ask: תשובה דרך הפעולה הקיימת answer (הדף לא צריך שינוי)', () => {
  const MSG = uuid(1);
  const db = (entityType) => fakeSql((text) => {
    if (text.startsWith('SELECT id, kind, awaiting_reply, entity_type, entity_id, attempt FROM messages')) return [{ id: MSG, kind: 'question', awaiting_reply: true, entity_type: entityType, entity_id: uuid(7), attempt: 1 }];
    if (text.startsWith('SELECT m.id, m.entity_type, m.awaiting_reply FROM messages m')) return entityType.startsWith('vacation') ? [{ id: MSG, entity_type: entityType, awaiting_reply: true }] : [];
    if (text.startsWith('WITH closed AS') && text.includes("'answer', ?::text, NULL::text, now(), now() FROM closed RETURNING id ), b AS")) return [{ closed: 1, answer_source_id: uuid(2), bubble_id: uuid(3) }];
    if (text.includes('UNION ALL') && text.includes('WHERE s.id =')) return [{ role: 'system', id: uuid(3), text: 'נרשם. יום טוב', at: '2026-12-06T06:00:00.000Z', channel: null, read_at: null }];
    return [];
  });
  const post = (sql, answer, eventSync) => handle(jsonRequest({ action: 'answer', message_id: MSG, answer }, { headers: { 'x-intake-secret': FAKE_SECRET } }), { sql, secret: FAKE_SECRET, timetable: null, now: () => MORNING, eventSync, googleDay: undefined });
  test('תשובה לשאלת חופשה ב-action answer נשמרת ב-answerVacation, בלי כתיבה ליומן Google', async () => {
    let synced = 0;
    const sql = db('vacation_day');
    const body = await (await post(sql, 'מנוחה', async () => { synced += 1; })).json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(body.items.map((item) => item.text), ['נרשם. יום טוב']);
    assert.equal(synced, 0);
  });
  test('"לתקן" לבד במסגרת דרך answer: unclear, בלי כתיבה', async () => {
    const sql = db('vacation_frame');
    const body = await (await post(sql, 'לתקן', async () => {})).json();
    assert.equal(body.status, 'unclear');
    assert.equal(sql.find('WITH closed AS').length, 0);
  });
});
