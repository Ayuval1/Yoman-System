// בדיקות לשאלת "איזה מקצוע במדעים?" (שלב B-3ב; docs/08-chapter8/68-chapter8-brief-prd.md: D14, H13, סעיף B-3). בלי מסד אמיתי ובלי רשת: sql מדומה מ-helpers.js.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן הבנייה). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והזרימה; ההוכחה החיה היא בהרצה של יובל.
// כל המשפטים והמקצועות מומצאים או מהקובץ הסטטי; בלי שמות אנשים.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { handle } from '../api/chat.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { loadPending } from '../lib/chat-pending.js';
import { pendingFromRows, parseChatAction, badgeFrom } from '../lib/chat-view.js';
import { composeBrief, briefCardData } from '../lib/brief-view.js';
import { examsOnDate, examsToday, examLineAt, EXAMS } from '../lib/exam-line.js';
import {
  EXAM_ANSWERS, EXAM_ASK_BODY, examsToAsk, examAskExpiresAt, createExamAsk, createExamAsks, loadExamAnswers, answerExam,
} from '../lib/exam-ask.js';
import { fakeSql, captureConsole, jsonRequest, req, FAKE_SECRET, FAKE_CRON, uuidOf } from './helpers.js';

const slot = (weekday, period, startsAt, endsAt, subject) => ({ weekday, period, startsAt, endsAt, subject, teacher: null, room: null });
// 1.12.2026 הוא יום שלישי = weekday 3 במערכת השעות (ראשון = 1).
const SCIENCE_TT = { slots: [slot(3, 2, '10:00', '10:45', 'פיזיקה'), slot(3, 5, '12:50', '13:35', 'כימיה')] };
const dbError = (message = 'relation "exam_asks" does not exist') => Object.assign(new Error(message), { name: 'NeonDbError' });
const EXAM_DEC_1 = EXAMS.find((exam) => exam.date === '2026-12-01');
const EXAM_OCT_20 = EXAMS.find((exam) => exam.date === '2026-10-20');

describe('exam-ask: חלון השאלה (בדיוק 3 ימים קדימה)', () => {
  test('1.12 (מבחן במדעים): נשאל מ-28.11 ועד 30.11 כולל, ולא ב-27.11 (4 ימים) ולא ב-1.12 עצמו', () => {
    assert.deepEqual(examsToAsk('2026-11-27').map((exam) => exam.date), []);
    for (const today of ['2026-11-28', '2026-11-29', '2026-11-30']) assert.deepEqual(examsToAsk(today).map((exam) => exam.date), ['2026-12-01'], today);
    assert.deepEqual(examsToAsk('2026-12-01').map((exam) => exam.date), []);
    assert.deepEqual(examsToAsk('2026-12-02').map((exam) => exam.date), []);
  });
  test('20.10 (מבדק במדעים): נשאל מ-17.10, לא ב-16.10', () => {
    assert.deepEqual(examsToAsk('2026-10-16').map((exam) => exam.date), []);
    assert.deepEqual(examsToAsk('2026-10-17').map((exam) => [exam.date, exam.type]), [['2026-10-20', 'מבדק']]);
  });
  test('"מועד ב\'" ומקצוע שאינו "מדעים" לא נשאלים (מתמטיקה 26.10, ומועד ב\' בדוי)', () => {
    assert.deepEqual(examsToAsk('2026-10-23'), []); // 26.10 הוא מתמטיקה
    const exams = [
      { date: '2026-12-01', type: 'מבחן', subject: 'מדעים', makeup: true },
      { date: '2026-12-02', type: 'מבחן', subject: 'פיזיקה' },
      { date: '2026-12-03', type: 'מבחן', subject: 'מדעים' },
    ];
    assert.deepEqual(examsToAsk('2026-11-30', { exams }).map((exam) => exam.date), ['2026-12-03']);
  });
  test('אותו תאריך פעמיים בקובץ: שאלה אחת (exam_date הוא UNIQUE)', () => {
    const exams = [{ date: '2026-12-01', type: 'מבחן', subject: 'מדעים' }, { date: '2026-12-01', type: 'מבדק', subject: 'מדעים' }];
    assert.equal(examsToAsk('2026-11-30', { exams }).length, 1);
  });
  test('הקובץ האמיתי: שתי שורות "מדעים" (20.10 ו-1.12), ושתיהן לא "מועד ב\'"', () => {
    assert.ok(EXAM_DEC_1 && EXAM_OCT_20);
    assert.notEqual(EXAM_DEC_1.makeup, true);
    assert.notEqual(EXAM_OCT_20.makeup, true);
  });
});

describe('exam-ask: expires_at = 06:00 שעון ישראל ביום המבחן, בטוח למעבר שעון', () => {
  test('חורף (UTC+2): 1.12 06:00 = 04:00Z', () => assert.equal(examAskExpiresAt('2026-12-01').toISOString(), '2026-12-01T04:00:00.000Z'));
  test('קיץ (UTC+3): 20.10 06:00 = 03:00Z', () => assert.equal(examAskExpiresAt('2026-10-20').toISOString(), '2026-10-20T03:00:00.000Z'));
  test('יום סוף השעון הקיץ 25.10.2026 (השעון אחורה ב-01:00): 06:00 כבר בחורף = 04:00Z', () => {
    assert.equal(examAskExpiresAt('2026-10-25').toISOString(), '2026-10-25T04:00:00.000Z');
    assert.equal(examAskExpiresAt('2026-10-24').toISOString(), '2026-10-24T03:00:00.000Z');
  });
  test('יום תחילת השעון הקיץ 26.3.2027 (השעון קדימה ב-02:00): 06:00 כבר בקיץ = 03:00Z', () => {
    assert.equal(examAskExpiresAt('2027-03-26').toISOString(), '2027-03-26T03:00:00.000Z');
    assert.equal(examAskExpiresAt('2027-03-25').toISOString(), '2027-03-25T04:00:00.000Z');
  });
  test('הערך שנכתב ל-messages.expires_at הוא אותו ערך', async () => {
    const sql = fakeSql(() => [{ ask_id: 'a1', message_id: 'm1' }]);
    await createExamAsk({ sql, exam: EXAM_DEC_1 });
    assert.equal(sql.calls[0].values[3], '2026-12-01T04:00:00.000Z');
  });
});

describe('exam-ask: createExamAsk (פקודה אחת, אידמפוטנטית)', () => {
  test('הפקודה: INSERT ל-exam_asks עם ON CONFLICT (exam_date) DO NOTHING, ושורת messages רק מתוך מה שנוצר (FROM a), kind=question, awaiting_reply=true, entity_type=exam_ask', async () => {
    const sql = fakeSql(() => [{ ask_id: 'a1', message_id: 'm1' }]);
    const out = await createExamAsk({ sql, exam: EXAM_DEC_1 });
    assert.deepEqual(out, { created: true, askId: 'a1', messageId: 'm1' });
    assert.equal(sql.calls.length, 1);
    const { text, values } = sql.calls[0];
    assert.match(text, /INSERT INTO exam_asks \(exam_date, exam_type\)/);
    assert.match(text, /ON CONFLICT \(exam_date\) DO NOTHING/);
    assert.match(text, /'out', \?::text, 'question', now\(\), true, NULL::uuid, \?::timestamptz, 'exam_ask', a\.id, 1 FROM a/);
    assert.deepEqual(values.slice(0, 3), ['2026-12-01', 'מבחן', EXAM_ASK_BODY]);
  });
  test('גוף ההודעה קבוע וכללי: בלי סוג, בלי תאריך, בלי שם מורה', () => {
    assert.equal(EXAM_ASK_BODY, 'איזה מקצוע במדעים?');
    assert.doesNotMatch(EXAM_ASK_BODY, /\d/);
  });
  test('התנגשות (השאלה כבר קיימת): created=false', async () => {
    const sql = fakeSql(() => [{ ask_id: null, message_id: null }]);
    assert.equal((await createExamAsk({ sql, exam: EXAM_DEC_1 })).created, false);
  });
});

describe('exam-ask: createExamAsks (חלון, אידמפוטנטיות, כשל לא נזרק)', () => {
  // מסד מדומה שזוכר: exam_asks לפי תאריך, ושורות messages שנוצרו רק כשה-ask נוצר עכשיו (כמו ה-CTE האמיתי).
  const statefulDb = () => {
    const state = { asks: new Map(), messages: [] };
    const sql = fakeSql((text, values) => {
      if (!text.includes('INSERT INTO exam_asks')) return [];
      const [date, type, body, expires] = values;
      if (state.asks.has(date)) return [{ ask_id: null, message_id: null }];
      state.asks.set(date, { type });
      state.messages.push({ body, expires, entity_type: 'exam_ask' });
      return [{ ask_id: `ask-${date}`, message_id: `m-${date}` }];
    });
    sql.state = state;
    return sql;
  };

  test('ב-29.11: נוצרת שאלה אחת ל-1.12', async () => {
    const sql = statefulDb();
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-29' }), 1);
    assert.deepEqual([...sql.state.asks.keys()], ['2026-12-01']);
    assert.equal(sql.state.messages.length, 1);
  });
  test('מחוץ לחלון (27.11, וגם 1.12 עצמו): לא נוצרת ולא נשלחת אף פקודה', async () => {
    for (const todayIso of ['2026-11-27', '2026-12-01', '2026-12-02', '2026-10-30']) {
      const sql = statefulDb();
      assert.equal(await createExamAsks({ sql, todayIso }), 0, todayIso);
      assert.equal(sql.calls.length, 0, todayIso);
    }
  });
  test('לא נוצרת פעמיים: כל ריצת בריף בחלון מנסה, אבל שורת messages אחת בלבד', async () => {
    const sql = statefulDb();
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-28' }), 1);
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-29' }), 0);
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-30' }), 0);
    assert.equal(sql.calls.length, 3, 'כל ריצה מנסה');
    assert.equal(sql.state.messages.length, 1);
  });
  test('"מועד ב\'" ומקצוע שאינו "מדעים" לא נוצרים', async () => {
    const sql = statefulDb();
    const exams = [
      { date: '2026-12-01', type: 'מבחן', subject: 'מדעים', makeup: true },
      { date: '2026-12-02', type: 'מבחן', subject: 'פיזיקה' },
    ];
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-30', exams }), 0);
    assert.equal(sql.calls.length, 0);
  });
  test('כשל יצירה (למשל הטבלה לא קיימת): לא נזרק, מוחזר 0, ובלוג רק שם השגיאה', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => { throw dbError('relation "exam_asks" does not exist'); });
    assert.equal(await createExamAsks({ sql, todayIso: '2026-11-29' }), 0);
    assert.match(log.text(), /NeonDbError/);
    assert.doesNotMatch(log.text(), /does not exist|relation|exam_asks/);
  });
});

describe('exam-ask: בבריף של הבוקר (deliverBrief)', () => {
  const BRIEF_DAY = (date) => ({ kind: 'brief', slotKey: `brief-${date}`, targetAt: `${date}T05:30:00.000Z` });
  const recPush = () => {
    const handle = async (request) => { handle.seen.push(JSON.parse(await request.clone().text())); return new Response('ok', { status: 200 }); };
    handle.seen = [];
    return handle;
  };
  // answers: שורות exam_asks שנענו; failExam: כל פקודה על exam_asks זורקת (הטבלה לא נוצרה).
  const deliverDb = ({ answers = [], failExam = false, pending = [] } = {}) => {
    const state = { asks: new Map(), messages: [], briefs: [] };
    const sql = fakeSql((text, values) => {
      if (text.includes('INSERT INTO exam_asks')) {
        if (failExam) throw dbError();
        const [date, type, body, expires] = values;
        if (state.asks.has(date)) return [{ ask_id: null, message_id: null }];
        state.asks.set(date, { type });
        state.messages.push({ body, expires });
        return [{ ask_id: `ask-${date}`, message_id: `m-${date}` }];
      }
      if (text.includes('JOIN exam_asks')) return pending.filter((row) => row.entity_type === 'exam_ask').map((row) => ({ id: row.id, exam_date: '2026-12-01', exam_type: 'מבחן' }));
      if (text.includes('FROM exam_asks')) {
        if (failExam) throw dbError();
        return answers;
      }
      if (text.includes('FROM messages m LEFT JOIN sources s')) return pending;
      if (text.includes("SELECT 1 AS found FROM messages WHERE entity_type = 'brief'")) return [];
      if (text.includes("'brief', ?::uuid") || (text.includes('INSERT INTO messages') && text.includes("'brief'"))) { state.briefs.push(values[0]); return [{ id: 'b1' }]; }
      return [];
    });
    sql.state = state;
    return sql;
  };
  const run = (message, sql, push, extra = {}) => handleDelivery(message, { deliveryCount: 1 }, { sql, now: () => new Date(message.targetAt), pushHandle: push, secret: FAKE_CRON, timetable: SCIENCE_TT, ...extra });

  test('בבריף של 28.11 (3 ימים לפני): השאלה נוצרת, עם expires_at ל-06:00 ב-1.12, ולפני טעינת השאלות הממתינות', async () => {
    const sql = deliverDb();
    const out = await run(BRIEF_DAY('2026-11-28'), sql, recPush());
    assert.equal(out.created, true);
    assert.equal(sql.state.messages.length, 1);
    assert.equal(sql.state.messages[0].expires, '2026-12-01T04:00:00.000Z');
    const askIndex = sql.calls.findIndex((c) => c.text.includes('INSERT INTO exam_asks'));
    const pendingIndex = sql.calls.findIndex((c) => c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(askIndex >= 0 && pendingIndex > askIndex, 'היצירה לפני טעינת הממתינות');
  });
  test('בבריף של 27.11 (4 ימים): לא נוצרת שאלה ואין פקודה על exam_asks מלבד טעינת התשובות', async () => {
    const sql = deliverDb();
    await run(BRIEF_DAY('2026-11-27'), sql, recPush());
    assert.equal(sql.calls.filter((c) => c.text.includes('INSERT INTO exam_asks')).length, 0);
    assert.equal(sql.state.messages.length, 0);
  });
  test('שני בריפים רצופים בחלון (28.11 ו-29.11): שאלה אחת בלבד', async () => {
    const sql = deliverDb();
    await run(BRIEF_DAY('2026-11-28'), sql, recPush());
    await run(BRIEF_DAY('2026-11-29'), sql, recPush());
    assert.equal(sql.state.messages.length, 1);
  });
  test('כשל יצירה (הטבלה לא נוצרה): הבריף נוצר בכל זאת, לא נזרק, הדחיפה נשלחת, ובלוג רק שם השגיאה', async (t) => {
    const log = captureConsole(t);
    const sql = deliverDb({ failExam: true });
    const push = recPush();
    const out = await run(BRIEF_DAY('2026-11-29'), sql, push);
    assert.equal(out.created, true);
    assert.equal(push.seen.length, 1);
    assert.equal(sql.state.briefs.length, 1);
    assert.match(log.text(), /NeonDbError/);
    assert.doesNotMatch(log.text(), /does not exist|relation/);
  });
  test('שאלה פתוחה על מבחן במדעים מופיעה בבריף כמספר: "שאלות שממתינות: שאלה אחת" (D17), בלי טקסט ההודעה', async () => {
    const pending = [{ id: 'q1', body: EXAM_ASK_BODY, sent_at: '2026-11-28T05:30:00.000Z', entity_type: 'exam_ask' }];
    const sql = deliverDb({ pending });
    const out = await run(BRIEF_DAY('2026-11-29'), sql, recPush(), { timetable: SCIENCE_TT });
    assert.equal(out.created, true);
    const insertCall = sql.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes("'brief'"));
    assert.match(insertCall.values[0], /שאלות שממתינות: שאלה אחת/);
    assert.ok(!insertCall.values[0].includes(EXAM_ASK_BODY));
  });
  test('בבוקר המבחן, אחרי "פיזיקה": "היום: מבחן בפיזיקה ב-10:00" בהודעה ובהתראה; אחרי "אחר" או בלי תשובה: "מבחן במדעים" בלי שעה', async () => {
    const answered = deliverDb({ answers: [{ exam_date: '2026-12-01', answer: 'פיזיקה' }] });
    const pushA = recPush();
    await run(BRIEF_DAY('2026-12-01'), answered, pushA);
    const textA = answered.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes("'brief'")).values[0];
    assert.match(textA, /^היום: מבחן בפיזיקה ב-10:00$/m);
    assert.match(pushA.seen[0].body, /^מבחן בפיזיקה ב-10:00 · /);

    for (const answers of [[{ exam_date: '2026-12-01', answer: 'אחר' }], []]) {
      const other = deliverDb({ answers });
      const push = recPush();
      await run(BRIEF_DAY('2026-12-01'), other, push);
      const text = other.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes("'brief'")).values[0];
      assert.match(text, /^היום: מבחן במדעים$/m);
      assert.match(push.seen[0].body, /^מבחן במדעים · /);
    }
  });
  test('טעינת התשובות נכשלה (טבלה חסרה) בבוקר המבחן: "מבחן במדעים" בלי שעה, הבריף נוצר', async (t) => {
    captureConsole(t);
    const sql = deliverDb({ failExam: true });
    const out = await run(BRIEF_DAY('2026-12-01'), sql, recPush());
    assert.equal(out.created, true);
    assert.match(sql.calls.find((c) => c.text.includes('INSERT INTO messages') && c.text.includes("'brief'")).values[0], /^היום: מבחן במדעים$/m);
  });
});

describe('exam-ask: examLineAt עם answers (שורת הפס וההתראה של 21:00)', () => {
  const EVENING = new Date('2026-11-30T19:30:00.000Z'); // 21:30 בישראל, מחר = 1.12 (יום שלישי)
  test('בלי תשובה: "מחר: מבחן במדעים" בלי שעה (כמו היום)', () => {
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT }), 'מחר: מבחן במדעים');
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT, answers: new Map() }), 'מחר: מבחן במדעים');
  });
  test('פיזיקה: שם המקצוע והשעה לפי מערכת השעות', () => {
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'פיזיקה']]) }), 'מחר: מבחן בפיזיקה ב-10:00');
  });
  test('כימיה: שם המקצוע והשעה של שיעור הכימיה', () => {
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'כימיה']]) }), 'מחר: מבחן בכימיה ב-12:50');
  });
  test('מקצוע בלי שיעור באותו יום: השם בלי שעה; בלי מערכת שעות: השם בלי שעה', () => {
    const answers = new Map([['2026-12-01', 'כימיה']]);
    assert.equal(examLineAt(EVENING, { timetable: { slots: [slot(3, 2, '10:00', '10:45', 'פיזיקה')] }, answers }), 'מחר: מבחן בכימיה');
    assert.equal(examLineAt(EVENING, { timetable: null, answers }), 'מחר: מבחן בכימיה');
  });
  test('"אחר" (גם אם הגיע למפה): נשאר "מדעים" בלי שעה', () => {
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'אחר']]) }), 'מחר: מבחן במדעים');
  });
  test('ערך לא חוקי במפה לא משנה את המקצוע', () => {
    assert.equal(examLineAt(EVENING, { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'היסטוריה']]) }), 'מחר: מבחן במדעים');
  });
  test('תשובה לתאריך אחר, או למבחן שאינו "מדעים", לא משפיעה (מתמטיקה 26.10 נשארת)', () => {
    const answers = new Map([['2026-12-01', 'פיזיקה'], ['2026-10-26', 'כימיה']]);
    const eve = new Date('2026-10-25T19:30:00.000Z'); // 21:30 (אחרי המעבר), מחר = 26.10
    assert.equal(examLineAt(eve, { timetable: null, answers }), 'מחר: מבחן במתמטיקה');
  });
  test('01:00 אחרי חצות: אותה שורה עם השם (D11)', () => {
    const lateNight = new Date('2026-11-30T23:00:00.000Z'); // 01:00 ב-1.12 בישראל
    assert.equal(examLineAt(lateNight, { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'פיזיקה']]) }), 'מחר: מבחן בפיזיקה ב-10:00');
  });
  test('examsToday/examsOnDate מקבלים answers, והשדות subject ו-time מעודכנים', () => {
    const [exam] = examsToday('2026-12-01', { timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'פיזיקה']]) });
    assert.deepEqual([exam.subject, exam.time, exam.text], ['פיזיקה', '10:00', 'מבחן בפיזיקה ב-10:00']);
    assert.equal(examsOnDate('2026-12-01', { timetable: SCIENCE_TT })[0].text, 'מבחן במדעים');
  });
});

describe('exam-ask: loadExamAnswers', () => {
  test('רק "פיזיקה" ו"כימיה" שנענו נכנסות למפה; "אחר" ושורה בלי תשובה לא', async () => {
    const sql = fakeSql(() => [
      { exam_date: '2026-10-20', answer: 'כימיה' },
      { exam_date: '2026-12-01', answer: 'פיזיקה' },
      { exam_date: '2026-12-02', answer: 'אחר' },
      { exam_date: '2026-12-03', answer: null },
      { exam_date: '2026-12-04', answer: 'משהו אחר לגמרי' },
    ]);
    const answers = await loadExamAnswers(sql);
    assert.deepEqual([...answers], [['2026-10-20', 'כימיה'], ['2026-12-01', 'פיזיקה']]);
    assert.match(sql.calls[0].text, /FROM exam_asks WHERE status = 'answered'/);
    assert.match(sql.calls[0].text, /exam_date::text AS exam_date/);
  });
  test('כשל או טבלה חסרה: מפה ריקה, לא נזרק, ובלוג רק שם השגיאה', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => { throw dbError('relation "exam_asks" does not exist'); });
    const answers = await loadExamAnswers(sql);
    assert.ok(answers instanceof Map);
    assert.equal(answers.size, 0);
    assert.match(log.text(), /NeonDbError/);
    assert.doesNotMatch(log.text(), /does not exist|relation|exam_asks/);
  });
});

describe('exam-ask: answerExam (סגירה מותנית)', () => {
  const NOW = new Date('2026-11-29T08:00:00.000Z');
  // מסד מדומה זוכר: הודעת שאלה אחת (awaiting_reply, expires_at) ו-exam_asks. הפקודה האמיתית מחליטה לפי התנאים; כאן אנחנו מדמים אותם.
  const statefulDb = ({ exists = true, awaiting = true, expires = '2026-12-01T04:00:00.000Z' } = {}) => {
    const state = { awaiting, answer: null, status: 'asked' };
    const sql = fakeSql((text, values) => {
      if (!text.startsWith('WITH closed AS')) return [];
      const [id, nowIso, answer] = values;
      const alive = exists && state.awaiting && id === uuidOf(1) && Date.parse(expires) > Date.parse(nowIso);
      if (!alive) return [{ closed: 0 }];
      state.awaiting = false;
      state.answer = answer;
      state.status = 'answered';
      return [{ closed: 1 }];
    });
    sql.state = state;
    return sql;
  };

  test('פיזיקה / כימיה / אחר: answered, פקודה אחת, והתשובה נשמרת', async () => {
    for (const answer of EXAM_ANSWERS) {
      const sql = statefulDb();
      assert.deepEqual(await answerExam({ sql, messageId: uuidOf(1), answer, now: NOW }), { status: 'answered' }, answer);
      assert.equal(sql.calls.length, 1);
      assert.equal(sql.state.answer, answer);
      assert.equal(sql.state.status, 'answered');
    }
  });
  test('הפקודה: סוגרת רק שאלה פתוחה מסוג exam_ask שלא פגה, ומעדכנת את exam_asks רק מתוך מה שנסגר', async () => {
    const sql = statefulDb();
    await answerExam({ sql, messageId: uuidOf(1), answer: 'כימיה', now: NOW });
    const { text, values } = sql.calls[0];
    assert.match(text, /UPDATE messages SET awaiting_reply = false, read_at = now\(\)/);
    assert.match(text, /kind = 'question' AND awaiting_reply = true AND entity_type = 'exam_ask'/);
    assert.match(text, /expires_at IS NULL OR expires_at > \?::timestamptz/);
    assert.match(text, /UPDATE exam_asks SET answer = \?::text, status = 'answered', answered_at = now\(\)/);
    assert.match(text, /WHERE id IN \(SELECT entity_id FROM closed\)/);
    assert.deepEqual(values, [uuidOf(1), NOW.toISOString(), 'כימיה']);
  });
  test('לחיצה כפולה: השנייה closed ולא משנה את התשובה', async () => {
    const sql = statefulDb();
    assert.equal((await answerExam({ sql, messageId: uuidOf(1), answer: 'פיזיקה', now: NOW })).status, 'answered');
    assert.equal((await answerExam({ sql, messageId: uuidOf(1), answer: 'כימיה', now: NOW })).status, 'closed');
    assert.equal(sql.state.answer, 'פיזיקה');
  });
  test('פגה (אחרי 06:00 ביום המבחן): closed ולא נכתב כלום', async () => {
    const sql = statefulDb();
    const out = await answerExam({ sql, messageId: uuidOf(1), answer: 'פיזיקה', now: new Date('2026-12-01T04:00:00.000Z') });
    assert.deepEqual(out, { status: 'closed' });
    assert.equal(sql.state.answer, null);
  });
  test('לא קיימת / הודעה אחרת: closed ולא נכתב כלום', async () => {
    const missing = statefulDb({ exists: false });
    assert.equal((await answerExam({ sql: missing, messageId: uuidOf(1), answer: 'פיזיקה', now: NOW })).status, 'closed');
    assert.equal(missing.state.answer, null);
    const other = statefulDb();
    assert.equal((await answerExam({ sql: other, messageId: uuidOf(2), answer: 'פיזיקה', now: NOW })).status, 'closed');
    assert.equal(other.state.answer, null);
  });
  test('תשובה לא חוקית: closed וללא קריאה למסד', async () => {
    const sql = statefulDb();
    for (const answer of ['לא יודע', '', 'פיזיקה ', undefined, null, 5]) {
      assert.deepEqual(await answerExam({ sql, messageId: uuidOf(1), answer, now: NOW }), { status: 'closed' });
    }
    assert.equal(sql.calls.length, 0);
  });
  test('כשל מסד נזרק (api/chat.js מחזיר 500)', async () => {
    const sql = fakeSql(() => { throw dbError('db down'); });
    await assert.rejects(() => answerExam({ sql, messageId: uuidOf(1), answer: 'פיזיקה', now: NOW }), /db down/);
  });
});

describe('exam-ask: שאלה ממתינה (loadPending) - הסיכון המרכזי: טבלה שלא קיימת לא שוברת את הצ\'אט', () => {
  const NOW = new Date('2026-11-29T08:00:00.000Z');
  const examRow = { id: uuidOf(11), body: EXAM_ASK_BODY, sent_at: '2026-11-28T05:30:00.000Z', entity_type: 'exam_ask' };
  const plainRow = { id: uuidOf(12), body: 'שאלה כללית מומצאת', sent_at: '2026-11-27T05:30:00.000Z', entity_type: 'source', source_id: null };
  const pendingDb = ({ questions, examRows = [], failExam = false }) => fakeSql((text) => {
    if (text.includes('FROM messages m LEFT JOIN sources s')) return questions;
    if (text.includes('JOIN exam_asks')) {
      if (failExam) throw dbError();
      return examRows;
    }
    return [];
  });

  test('השאילתה הראשית לא נוגעת ב-exam_asks (בלי JOIN), ולכן אינה נשברת כשהטבלה חסרה', async () => {
    const sql = pendingDb({ questions: [plainRow] });
    await loadPending(sql, null, NOW);
    assert.ok(!sql.calls[0].text.includes('exam_asks'));
    assert.ok(sql.calls.every((c) => !c.text.includes('exam_asks')), 'בלי שורת exam_ask אין שאילתה על exam_asks בכלל');
  });
  test('שורת exam_ask: שאילתה נפרדת מוסיפה תאריך וסוג, והפריט kind=exam עם שלושת הכפתורים', async () => {
    const sql = pendingDb({ questions: [plainRow, examRow], examRows: [{ id: examRow.id, exam_date: '2026-12-01', exam_type: 'מבחן' }] });
    const list = await loadPending(sql, null, NOW);
    assert.equal(list.length, 2);
    const exam = list.find((item) => item.kind === 'exam');
    assert.deepEqual(exam, {
      id: examRow.id, kind: 'exam', at: '2026-11-28T05:30:00.000Z', exam_date: '2026-12-01', exam_type: 'מבחן',
      buttons: [{ answer: 'פיזיקה' }, { answer: 'כימיה' }, { answer: 'אחר' }],
    });
    assert.ok(!('text' in exam) && !('allowFreeText' in exam));
  });
  test('הטבלה חסרה (השאילתה הנפרדת נכשלה): loadPending לא נזרק, שאלות אחרות נשארות, שורת המבחן מוסרת, ובלוג רק שם השגיאה', async (t) => {
    const log = captureConsole(t);
    const sql = pendingDb({ questions: [plainRow, examRow], failExam: true });
    const list = await loadPending(sql, null, NOW);
    assert.deepEqual(list.map((item) => item.id), [plainRow.id]);
    assert.equal(list[0].allowFreeText, true, 'שאלה כללית נשארת כפי שהייתה');
    assert.match(log.text(), /NeonDbError/);
    assert.doesNotMatch(log.text(), /does not exist|relation|exam_asks/);
  });
  test('שורת exam_ask בלי שורה מתאימה ב-exam_asks (יתומה): מוסרת, לא מוצגת כשאלה כללית', async () => {
    const sql = pendingDb({ questions: [examRow], examRows: [] });
    assert.deepEqual(await loadPending(sql, null, NOW), []);
  });
  test('pendingFromRows ישירות: פריט exam ממוין עם שאר השאלות לפי הזמן', () => {
    const list = pendingFromRows({
      questions: [
        { ...examRow, exam_date: '2026-12-01', exam_type: 'מבדק' },
        { id: uuidOf(13), body: 'ישנה', sent_at: '2026-11-20T05:30:00.000Z', entity_type: 'source' },
      ],
      facts: [], timetable: null, today: '2026-11-29',
    });
    assert.deepEqual(list.map((item) => item.kind ?? 'text'), ['text', 'exam']);
    assert.equal(list[1].exam_type, 'מבדק');
  });
});

describe('exam-ask: parseChatAction עם action: exam', () => {
  const ID = uuidOf(5);
  test('שלוש התשובות החוקיות מתקבלות', () => {
    for (const answer of ['פיזיקה', 'כימיה', 'אחר']) assert.deepEqual(parseChatAction({ action: 'exam', message_id: ID, answer }), { ok: true, action: 'exam', messageId: ID, answer });
  });
  test('answer לא חוקי נדחה (כולל "לא יודע", ריק, רווח, סוג אחר)', () => {
    for (const answer of ['לא יודע', '', ' פיזיקה', 'פיזיקה ', 'PHYSICS', undefined, null, 1, ['פיזיקה']]) assert.deepEqual(parseChatAction({ action: 'exam', message_id: ID, answer }), { ok: false }, String(answer));
  });
  test('message_id שאינו uuid נדחה', () => {
    for (const messageId of ['abc', '', undefined, null, 5, `${ID}x`]) assert.deepEqual(parseChatAction({ action: 'exam', message_id: messageId, answer: 'פיזיקה' }), { ok: false }, String(messageId));
  });
});

describe('exam-ask: api/chat.js (POST exam, GET, המספר על האייקון)', () => {
  const URL_CHAT = 'https://x.test/api/chat';
  const H = { 'x-intake-secret': FAKE_SECRET };
  const NOW = new Date('2026-11-30T19:30:00.000Z'); // 21:30 בישראל ב-30.11: מחר = 1.12
  const MSG = uuidOf(21);
  const EXAM_Q = { id: MSG, body: EXAM_ASK_BODY, sent_at: '2026-11-28T05:30:00.000Z', entity_type: 'exam_ask' };
  const get = (sql) => handle(req(URL_CHAT, { method: 'GET', headers: H }), { sql, secret: FAKE_SECRET, timetable: SCIENCE_TT, now: () => NOW });
  const post = (sql, body, headers = H) => handle(jsonRequest(body, { url: URL_CHAT, headers: { ...headers, 'content-type': 'application/json' } }), { sql, secret: FAKE_SECRET, timetable: SCIENCE_TT, now: () => NOW });

  // מסד מדומה: מצב אחד חי (open = השאלה פתוחה, answer = התשובה שנשמרה). משקף את ההתנהגות של הפקודות האמיתיות.
  const chatDb = ({ open = true, failExam = false } = {}) => {
    const state = { open, answer: null };
    const sql = fakeSql((text) => {
      if (text.startsWith('WITH closed AS')) {
        if (!state.open) return [{ closed: 0 }];
        state.open = false;
        state.answer = 'פיזיקה';
        return [{ closed: 1 }];
      }
      if (text.includes('FROM exam_asks WHERE status')) {
        if (failExam) throw dbError();
        return state.answer ? [{ exam_date: '2026-12-01', answer: state.answer }] : [];
      }
      if (text.includes('JOIN exam_asks')) return state.open ? [{ id: MSG, exam_date: '2026-12-01', exam_type: 'מבחן' }] : [];
      if (text.includes('FROM messages m LEFT JOIN sources s')) return state.open ? [EXAM_Q] : [];
      if (text.includes('AS unread')) return [{ pending: state.open ? 1 : 0, unread: 0, open_tasks: 0 }];
      return [];
    });
    sql.state = state;
    return sql;
  };

  test('POST exam: answered, ותשובה { status, pending, badge, review } - הפס מתעדכן בשם המקצוע ובשעה', async () => {
    const sql = chatDb();
    const res = await post(sql, { action: 'exam', message_id: MSG, answer: 'פיזיקה' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'answered');
    assert.deepEqual(body.pending, []);
    assert.equal(body.badge, 0);
    assert.equal(body.review.exam_line, 'מחר: מבחן בפיזיקה ב-10:00');
    assert.deepEqual(Object.keys(body).sort(), ['badge', 'pending', 'review', 'status']);
  });
  test('POST exam אחרי GET בלי תשובה: השורה "מחר: מבחן במדעים", והשאלה ממתינה עם שלושה כפתורים', async () => {
    const sql = chatDb();
    const body = await (await get(sql)).json();
    assert.equal(body.review.exam_line, 'מחר: מבחן במדעים');
    assert.equal(body.pending.length, 1);
    assert.equal(body.pending[0].kind, 'exam');
    assert.deepEqual(body.pending[0].buttons.map((b) => b.answer), ['פיזיקה', 'כימיה', 'אחר']);
  });
  test('לחיצה כפולה: השנייה closed, והשורה נשארת כפי שנקבעה', async () => {
    const sql = chatDb();
    await post(sql, { action: 'exam', message_id: MSG, answer: 'פיזיקה' });
    const second = await (await post(sql, { action: 'exam', message_id: MSG, answer: 'כימיה' })).json();
    assert.equal(second.status, 'closed');
    assert.equal(second.review.exam_line, 'מחר: מבחן בפיזיקה ב-10:00');
  });
  test('כשל בטעינת התשובות: ה-GET לא נשבר, השורה בלי שם המקצוע', async (t) => {
    captureConsole(t);
    const sql = chatDb({ failExam: true });
    const res = await get(sql);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).review.exam_line, 'מחר: מבחן במדעים');
  });
  test('בקשות פגומות: 400 לפני כל קריאה למסד (answer לא חוקי, message_id לא uuid)', async () => {
    for (const bad of [{ action: 'exam', message_id: MSG, answer: 'לא יודע' }, { action: 'exam', message_id: 'x', answer: 'פיזיקה' }, { action: 'exam', message_id: MSG }]) {
      const sql = chatDb();
      const res = await post(sql, bad);
      assert.equal(res.status, 400);
      assert.equal(sql.calls.length, 0);
    }
  });
  test('בלי סוד: 401 ובלי מסד', async () => {
    const sql = chatDb();
    const res = await post(sql, { action: 'exam', message_id: MSG, answer: 'פיזיקה' }, {});
    assert.equal(res.status, 401);
    assert.equal(sql.calls.length, 0);
  });
  test('כשל מסד בכתיבה: 500, ובלוג רק שם השגיאה', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => { throw dbError('db down סודי'); });
    const res = await post(sql, { action: 'exam', message_id: MSG, answer: 'פיזיקה' });
    assert.equal(res.status, 500);
    assert.doesNotMatch(log.text(), /סודי|db down/);
  });
  test('המספר על האייקון סופר את השאלה כמו כל שאלה פתוחה (ושאילתת הספירה אינה מסננת לפי entity_type)', async () => {
    const sql = chatDb();
    const body = await (await get(sql)).json();
    assert.equal(body.badge, 1);
    const countQuery = sql.calls.find((c) => c.text.includes('AS unread')).text;
    assert.match(countQuery, /kind = 'question' AND awaiting_reply = true AND \(expires_at IS NULL/);
    assert.ok(!countQuery.includes('entity_type'));
    assert.equal(badgeFrom({ pending: 1 }), 1);
  });
});

describe('exam-ask: בריף (brief-view) עם פריט kind: exam ועם answers', () => {
  const examItem = { id: 'q', kind: 'exam', exam_date: '2026-12-01', exam_type: 'מבחן', buttons: [{ answer: 'פיזיקה' }] };
  test('שאלת מבחן נספרת כמספר, בלי טקסט: "שאלות שממתינות: שאלה אחת"', () => {
    const lines = composeBrief({ dateIso: '2026-11-30', timetable: SCIENCE_TT, pending: [examItem] }).text.split('\n');
    assert.ok(lines.includes('שאלות שממתינות: שאלה אחת'));
  });
  test('שיעורי בית בשם המקצוע ועוד שאלת מבחן: "שיעורי בית בפיזיקה · ועוד שאלה אחת"', () => {
    const lines = composeBrief({ dateIso: '2026-11-30', timetable: SCIENCE_TT, pending: [{ kind: 'homework', subject: 'פיזיקה' }, examItem] }).text.split('\n');
    assert.ok(lines.includes('שאלות שממתינות: שיעורי בית בפיזיקה · ועוד שאלה אחת'));
  });
  test('שתי שאלות מבחן: "2 שאלות", ובלי כותרת חופשית', () => {
    const text = composeBrief({ dateIso: '2026-11-30', timetable: SCIENCE_TT, pending: [examItem, { ...examItem, id: 'r' }] }).text;
    assert.match(text, /שאלות שממתינות: 2 שאלות/);
  });
  test('answers: "היום: מבחן בפיזיקה ב-10:00" בבוקר 1.12; בלי answers: "מבחן במדעים"', () => {
    const answers = new Map([['2026-12-01', 'פיזיקה']]);
    const brief = composeBrief({ dateIso: '2026-12-01', timetable: SCIENCE_TT, answers });
    assert.ok(brief.text.split('\n').includes('היום: מבחן בפיזיקה ב-10:00'));
    assert.equal(brief.exams[0].text, 'מבחן בפיזיקה ב-10:00');
    assert.ok(composeBrief({ dateIso: '2026-12-01', timetable: SCIENCE_TT }).text.split('\n').includes('היום: מבחן במדעים'));
  });
  test('briefCardData מעביר answers גם לכרטיס החי', () => {
    const now = new Date('2026-12-01T06:00:00.000Z'); // 08:00 בישראל
    const card = briefCardData({ now, timetable: SCIENCE_TT, answers: new Map([['2026-12-01', 'כימיה']]), pending: [examItem] });
    assert.deepEqual(card.exams, ['היום: מבחן בכימיה ב-12:50']);
    assert.match(card.text, /שאלות שממתינות: שאלה אחת/);
  });
});

describe('exam-ask: public/index.html (בדיקות צורה; ההוכחה האמיתית על האייפון)', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
  const sourceOf = (name) => {
    const match = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
    assert.ok(match, `הפונקציה ${name} קיימת`);
    return match[0];
  };

  test('הסקריפט תקין תחבירית', () => assert.doesNotThrow(() => new vm.Script(script.replace(/^export /gm, ''))));
  test('questionText לשאלת מבחן: "<סוג> במדעים ב-<d.M>: איזה מקצוע?" (ymdLabel בלי אפס מוביל)', () => {
    const questionText = vm.runInNewContext(`(() => { ${sourceOf('ymdLabel')}\n${sourceOf('questionText')}\nreturn questionText; })()`);
    assert.equal(questionText({ kind: 'exam', exam_type: 'מבחן', exam_date: '2026-12-01' }), 'מבחן במדעים ב-1.12: איזה מקצוע?');
    assert.equal(questionText({ kind: 'exam', exam_type: 'מבדק', exam_date: '2026-10-20' }), 'מבדק במדעים ב-20.10: איזה מקצוע?');
    assert.equal(questionText({ kind: 'exam', exam_type: 'מבחן', exam_date: null }), 'מבחן במדעים: איזה מקצוע?');
    assert.equal(questionText({ text: 'טקסט רגיל' }), 'טקסט רגיל'); // שאלה רגילה לא השתנתה
  });
  test('examCard: כפתורי opt מ-buttons[].answer, disabled בזמן busy, POST דרך sendExam, בלי תיבת כתיבה ובלי "לא יודע"', () => {
    const card = sourceOf('examCard');
    assert.match(card, /state\.busy\.has\(question\.id\)/);
    assert.match(card, /item\.answer/);
    assert.match(card, /button\.disabled = busy/);
    assert.match(card, /sendExam\(question\.id, item\.answer\)/);
    assert.match(card, /state\.notes\.get\(question\.id\)/);
    assert.doesNotMatch(card, /qfield|input|לא יודע|questionCard|allowFreeText/);
  });
  test('sendExam: POST action exam עם message_id ו-answer, מעדכן pending/badge/review, ושגיאה מציגה את ERROR_TEXT', () => {
    const send = sourceOf('sendExam');
    assert.match(send, /action: 'exam', message_id: messageId, answer/);
    assert.match(send, /applyServerLists\(data\)/);
    assert.match(send, /applyReview\(data\.review\)/);
    assert.match(send, /state\.notes\.set\(messageId, ERROR_TEXT\)/);
    assert.match(send, /state\.busy\.has\(messageId\)/);
  });
  test('cardFor בוחר examCard לפי kind=exam, ושיעורי בית ושאלה רגילה נשארו', () => {
    assert.match(script, /question\.kind === 'exam' \? examCard\(question, options\)/);
    assert.match(script, /question\.kind === 'homework' \? homeworkCard\(question, options\) : questionCard\(question, options\)/);
  });
  test('חוזה ה-GET/POST בראש הצ\'אט כולל את שורת B-3ב', () => {
    assert.match(script, /שלב B-3ב[^\n]*kind: 'exam'[^\n]*action:'exam'/);
  });
});
