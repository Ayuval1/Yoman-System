// בדיקות ל-lib/behavior-rules.js: למידה ממה שיובל עשה בפועל (03-analysis-rules.md, '"לומדת לבד" — דרך המסלול הקיים': אחרי שני סבבים, מה שיובל עשה
// עולה בסקירה, יובל מאשר, וזה הופך לכלל, פעולה 18). הכרטיס נכנס לסגירת 21:00 פעם בשבועיים (03-app-channel-rules.md, "כרטיס הסקירה").
// בלי רשת ובלי מסד: sql מזויף. ה-SQL לא הורץ מול Postgres; הבדיקות מוודאות לוגיקה, פרמטרים ומבנה הפקודות.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, jsonRequest, FAKE_SECRET, FAKE_CRON } from './helpers.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { handle as chatHandle } from '../api/chat.js';
import {
  BEHAVIOR_ENTITY, BEHAVIOR_BUTTONS, BEHAVIOR_YES, BEHAVIOR_NO, BEHAVIOR_MIN_COUNT, BEHAVIOR_WINDOW_DAYS, REVIEW_ANCHOR, BASE_BLOCKS,
  NOT_STUDYING_HEAD, STUDY_SKIP, STUDY_MORE, EMPTY_BEHAVIOR,
  isReviewEvening, reviewRange, passes, studySkipFindings, studyMoreFinding, behaviorKey, behaviorCardText,
  proposeBehaviorRules, answerBehaviorRule, loadBehaviorRules, preferredDays,
} from '../lib/behavior-rules.js';
import { BIWEEKLY_ANCHOR } from '../lib/weekly-brief.js';
import { PLAN_BLOCKS, notStudyingReply, offerStudyPlans, examKey, YES as PLAN_YES, MORE as PLAN_MORE } from '../lib/study-plan.js';
import { pendingFromRows } from '../lib/chat-view.js';

const MSG = '33333333-3333-4333-8333-333333333333';
const CAND = '44444444-4444-4444-8444-444444444444';
const REVIEW_DAY = '2026-11-28'; // שבת, הסקירה הראשונה
const REVIEW_NOW = new Date('2026-11-28T19:00:05.000Z'); // 21:00 בישראל (UTC+2)
// שלישי בחלון 1.11–28.11.2026: 3.11, 10.11, 17.11, 24.11.
const TUESDAYS = ['2026-11-03', '2026-11-10', '2026-11-17', '2026-11-24'];
const at = (day, hhmm = '16:00') => new Date(`${day}T${hhmm}:00+02:00`).toISOString();

describe('behavior-rules: קצב הסקירה (כל 14 יום, בסגירה של שבת)', () => {
  test('העוגן זהה לעוגן הדו-שבועי של הבריף השבועי', () => {
    assert.equal(REVIEW_ANCHOR, BIWEEKLY_ANCHOR);
  });
  test('isReviewEvening: 28.11, 12.12, 26.12 כן; שבת שבאמצע, יום אחר, או לפני העוגן לא', () => {
    assert.equal(isReviewEvening('2026-11-28'), true);
    assert.equal(isReviewEvening('2026-12-12'), true);
    assert.equal(isReviewEvening('2026-12-26'), true);
    assert.equal(isReviewEvening('2026-12-05'), false);
    assert.equal(isReviewEvening('2026-11-29'), false);
    assert.equal(isReviewEvening('2026-11-14'), false, 'לפני העוגן: אין סבב');
    assert.equal(isReviewEvening('2026-10-31'), false);
    assert.equal(isReviewEvening('לא תאריך'), false);
  });
  test('reviewRange: שני סבבים = 28 הימים שמסתיימים ביום הסקירה (כולל)', () => {
    assert.equal(BEHAVIOR_WINDOW_DAYS, 28);
    const range = reviewRange(REVIEW_DAY);
    assert.equal(range.fromDay, '2026-11-01');
    assert.equal(range.toDay, REVIEW_DAY);
    assert.equal(range.from.toISOString(), '2026-10-31T22:00:00.000Z');
    assert.equal(range.to.toISOString(), '2026-11-28T22:00:00.000Z');
  });
  test('passes: לפחות 3, ולפחות 2 מתוך 3', () => {
    assert.equal(BEHAVIOR_MIN_COUNT, 3);
    assert.equal(passes(3, 3), true);
    assert.equal(passes(3, 4), true);
    assert.equal(passes(4, 6), true);
    assert.equal(passes(2, 2), false, 'פחות מ-3');
    assert.equal(passes(3, 5), false, '0.6 < 2/3');
    assert.equal(passes(3, 0), false);
  });
});

describe('behavior-rules: "לא לומד היום" לפי יום בשבוע (טהור)', () => {
  test('3 מתוך 4 ימי שלישי עם למידה בוטלו: ממצא אחד לשלישי', () => {
    const studyDays = [...TUESDAYS, '2026-11-04', '2026-11-11'];
    const skipDays = ['2026-11-03', '2026-11-10', '2026-11-24', '2026-11-04'];
    const findings = studySkipFindings({ studyDays, skipDays });
    assert.equal(findings.length, 1);
    const [f] = findings;
    assert.equal(f.behavior, STUDY_SKIP);
    assert.equal(f.weekday, 2);
    assert.equal(f.n, 3);
    assert.equal(f.m, 4);
    assert.deepEqual(f.days, ['2026-11-03', '2026-11-10', '2026-11-24']);
    assert.equal(behaviorKey(f), 'beh:study_skip:2');
  });
  test('ימים כפולים נספרים פעם אחת; ביטול ביום בלי למידה לא נספר', () => {
    const studyDays = ['2026-11-03', '2026-11-03', '2026-11-10'];
    const skipDays = ['2026-11-03', '2026-11-03', '2026-11-10', '2026-11-17'];
    assert.deepEqual(studySkipFindings({ studyDays, skipDays }), [], 'רק 2 ימי שלישי עם למידה');
  });
  test('3 מתוך 5: לא עובר את 2 מתוך 3', () => {
    const studyDays = [...TUESDAYS, '2026-10-27'];
    const skipDays = ['2026-11-03', '2026-11-10', '2026-11-17'];
    assert.deepEqual(studySkipFindings({ studyDays, skipDays }), []);
  });
  test('הכותרת שהממצא מחפש היא הכותרת של תשובת "לא לומד היום" כשבוטלה למידה', () => {
    const reply = notStudyingReply({ today: '2026-11-24', cancelled: ['source:study:2026-11-26:מתמטיקה:2026-11-24T16:00'], later: [] });
    assert.ok(reply.startsWith(NOT_STUDYING_HEAD));
    assert.ok(!notStudyingReply({ today: '2026-11-24', cancelled: [], later: [] }).startsWith(NOT_STUDYING_HEAD), 'בלי ביטול: לא נספר');
  });
});

describe('behavior-rules: "עוד זמן" בתוכנית למידה (טהור)', () => {
  const plan = (exam, ...answers) => answers.map((answer) => ({ exam, answer }));
  test('3 מתוך 3 תוכניות שאושרו התחילו ב"עוד זמן": ממצא', () => {
    const rows = [
      ...plan('exam:2026-11-10:מתמטיקה', PLAN_MORE, PLAN_YES),
      ...plan('exam:2026-11-17:אנגלית', PLAN_MORE, PLAN_MORE, PLAN_YES),
      ...plan('exam:2026-11-24:היסטוריה', PLAN_MORE, PLAN_YES),
      ...plan('exam:2026-11-25:ערבית', PLAN_MORE, 'לא'), // לא אושרה: לא נספרת
    ];
    const f = studyMoreFinding(rows);
    assert.equal(f.behavior, STUDY_MORE);
    assert.equal(f.n, 3);
    assert.equal(f.m, 3);
    assert.equal(behaviorKey(f), 'beh:study_more:1');
    assert.deepEqual(f.exams, ['exam:2026-11-10:מתמטיקה', 'exam:2026-11-17:אנגלית', 'exam:2026-11-24:היסטוריה']);
  });
  test('2 מתוך 4: אין ממצא', () => {
    const rows = [
      ...plan('exam:a', PLAN_MORE, PLAN_YES), ...plan('exam:b', PLAN_MORE, PLAN_YES), ...plan('exam:c', PLAN_YES), ...plan('exam:d', PLAN_YES),
    ];
    assert.equal(studyMoreFinding(rows), null);
  });
  test('BASE_BLOCKS זהה ל-PLAN_BLOCKS של תוכנית הלמידה', () => {
    assert.equal(BASE_BLOCKS, PLAN_BLOCKS);
  });
});

describe('behavior-rules: נוסח הכרטיס', () => {
  test('ביטול בשלישי', () => {
    const text = behaviorCardText({ behavior: STUDY_SKIP, weekday: 2, n: 3, m: 4 });
    assert.equal(text, 'בשבועות האחרונים ביטלת את הלמידה ביום שלישי, 3 מתוך 4. לקבוע שמעכשיו לא אציע למידה ביום שלישי, אלא אם אין יום אחר?');
  });
  test('עוד זמן', () => {
    const text = behaviorCardText({ behavior: STUDY_MORE, n: 3, m: 3 });
    assert.equal(text, 'בשבועות האחרונים ביקשת עוד זמן בתוכנית למידה, 3 מתוך 3. לקבוע שמעכשיו אציע 4 שעות למידה למבחן במקום 3?');
  });
  test('כפתורים: כן / לא', () => {
    assert.deepEqual([...BEHAVIOR_BUTTONS], [BEHAVIOR_YES, BEHAVIOR_NO]);
  });
});

describe('behavior-rules: proposeBehaviorRules (בסגירה של ערב הסקירה)', () => {
  const studyRows = [...TUESDAYS.map((d) => ({ starts_at: at(d) })), { starts_at: at('2026-11-04') }];
  const skipRows = ['2026-11-03', '2026-11-10', '2026-11-17'].map((d) => ({ sent_at: at(d, '18:00') }));
  const db = (over = {}) => fakeSql((text) => {
    if (text.includes('behavior-study-days')) return over.study ?? studyRows;
    if (text.includes('behavior-skip-days')) return over.skip ?? skipRows;
    if (text.includes('behavior-plan-answers')) return over.plans ?? [];
    if (text.includes('behavior-propose')) return over.propose ?? [{ candidate_id: CAND, question_id: MSG }];
    return [];
  });

  test('לא ערב סקירה: אין שום שאילתה', async () => {
    const sql = db();
    const out = await proposeBehaviorRules({ sql, dateIso: '2026-12-05', now: REVIEW_NOW });
    assert.deepEqual(out, { created: [] });
    assert.equal(sql.calls.length, 0);
  });

  test('ערב סקירה: מועמד וכרטיס אחד, אטומי, עם מפתח קבוע ובלי טקסט חופשי חוץ מהכרטיס', async () => {
    const sql = db();
    const out = await proposeBehaviorRules({ sql, dateIso: REVIEW_DAY, now: REVIEW_NOW });
    assert.deepEqual(out, { created: ['beh:study_skip:2'] });
    const [study] = sql.find('behavior-study-days');
    assert.ok(study.values.includes('2026-10-31T22:00:00.000Z'));
    assert.ok(study.values.includes('2026-11-28T22:00:00.000Z'));
    const [skip] = sql.find('behavior-skip-days');
    assert.ok(skip.values.includes(`${NOT_STUDYING_HEAD}%`));
    const calls = sql.find('behavior-propose');
    assert.equal(calls.length, 1);
    const [call] = calls;
    assert.match(call.text, /INSERT INTO candidate_rules/);
    assert.match(call.text, /WHERE NOT EXISTS \(SELECT 1 FROM candidate_rules x WHERE x\.evidence ->> 'key' = \?::text\)/, 'גם נדחה או אושר: לא מוצע שוב');
    assert.match(call.text, /INSERT INTO messages/);
    assert.ok(call.values.includes('beh:study_skip:2'));
    assert.ok(call.values.includes(BEHAVIOR_ENTITY));
    const evidence = JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('{')));
    assert.deepEqual(evidence, {
      kind: 'behavior', behavior: STUDY_SKIP, key: 'beh:study_skip:2', weekday: 2, n: 3, m: 4,
      days: ['2026-11-03', '2026-11-10', '2026-11-17'], window: { from: '2026-11-01', to: REVIEW_DAY },
    });
    assert.ok(call.values.includes('בשבועות האחרונים ביטלת את הלמידה ביום שלישי, 3 מתוך 4. לקבוע שמעכשיו לא אציע למידה ביום שלישי, אלא אם אין יום אחר?'));
  });

  test('כבר הוצע (נדחה, אושר או ממתין): exists, בלי כרטיס חדש', async () => {
    const sql = db({ propose: [{ candidate_id: null, question_id: null }] });
    const out = await proposeBehaviorRules({ sql, dateIso: REVIEW_DAY, now: REVIEW_NOW });
    assert.deepEqual(out, { created: [] });
  });

  test('"עוד זמן" + ביטולים: שני כרטיסים נפרדים', async () => {
    const plans = [
      { exam: 'exam:2026-11-10:מתמטיקה', answer: PLAN_MORE }, { exam: 'exam:2026-11-10:מתמטיקה', answer: PLAN_YES },
      { exam: 'exam:2026-11-17:אנגלית', answer: PLAN_MORE }, { exam: 'exam:2026-11-17:אנגלית', answer: PLAN_YES },
      { exam: 'exam:2026-11-24:היסטוריה', answer: PLAN_MORE }, { exam: 'exam:2026-11-24:היסטוריה', answer: PLAN_YES },
    ];
    const sql = db({ plans });
    const out = await proposeBehaviorRules({ sql, dateIso: REVIEW_DAY, now: REVIEW_NOW });
    assert.deepEqual(out.created, ['beh:study_skip:2', 'beh:study_more:1']);
    assert.equal(sql.find('behavior-propose').length, 2);
    const [plansCall] = sql.find('behavior-plan-answers');
    assert.match(plansCall.text, /m\.entity_type = 'study_plan'/);
  });

  test('אין ממצא: אין כתיבה', async () => {
    const sql = db({ skip: [] });
    const out = await proposeBehaviorRules({ sql, dateIso: REVIEW_DAY, now: REVIEW_NOW });
    assert.deepEqual(out, { created: [] });
    assert.equal(sql.find('behavior-propose').length, 0);
  });

  test('כשל מסד: לא זורק, אין כרטיס', async (t) => {
    t.mock.method(console, 'error', () => {});
    const sql = fakeSql(() => { throw new Error('db down'); });
    const out = await proposeBehaviorRules({ sql, dateIso: REVIEW_DAY, now: REVIEW_NOW });
    assert.deepEqual(out, { created: [] });
  });
});

describe('behavior-rules: answerBehaviorRule (כן / לא)', () => {
  const evidence = { kind: 'behavior', behavior: STUDY_SKIP, key: 'beh:study_skip:2', weekday: 2, n: 3, m: 4 };
  const ask = (over = {}) => ({ id: MSG, awaiting_reply: true, candidate_id: CAND, status: 'candidate', evidence, ...over });
  const db = (row, written = [{ closed: 1, answer_source_id: 'a1', bubble_id: 'b1' }]) => fakeSql((text) => {
    if (text.includes('behavior-ask')) return row ? [row] : [];
    if (text.includes('behavior-write')) return written;
    return [];
  });

  test('"כן": approved, רק ממועמד, ותשובה + בועה', async () => {
    const sql = db(ask());
    const out = await answerBehaviorRule({ sql, messageId: MSG, answer: 'כן' });
    assert.deepEqual(out, { status: 'answered', created: { answerSourceId: 'a1', bubbleId: 'b1' } });
    const [call] = sql.find('behavior-write');
    assert.match(call.text, /UPDATE candidate_rules/);
    assert.match(call.text, /status = 'candidate'/);
    assert.ok(call.values.includes('approved'));
    assert.ok(call.values.includes(BEHAVIOR_ENTITY));
  });
  test('"לא": rejected', async () => {
    const sql = db(ask());
    const out = await answerBehaviorRule({ sql, messageId: MSG, answer: ' לא ' });
    assert.equal(out.status, 'answered');
    assert.ok(sql.find('behavior-write')[0].values.includes('rejected'));
  });
  test('תשובה אחרת: unclear, בלי כתיבה', async () => {
    const sql = db(ask());
    assert.equal((await answerBehaviorRule({ sql, messageId: MSG, answer: 'אולי' })).status, 'unclear');
    assert.equal(sql.find('behavior-write').length, 0);
  });
  test('closed: אין כרטיס, נסגר, לא מועמד, evidence אחר, או נסגר במקביל', async () => {
    for (const row of [null, ask({ awaiting_reply: false }), ask({ status: 'approved' }), ask({ evidence: { kind: 'correction' } })]) {
      const sql = db(row);
      assert.equal((await answerBehaviorRule({ sql, messageId: MSG, answer: 'כן' })).status, 'closed');
      assert.equal(sql.find('behavior-write').length, 0);
    }
    const raced = db(ask(), [{ closed: 0 }]);
    assert.equal((await answerBehaviorRule({ sql: raced, messageId: MSG, answer: 'כן' })).status, 'closed');
  });
});

describe('behavior-rules: loadBehaviorRules + preferredDays (ההפעלה)', () => {
  test('כללים מאושרים: ימים להימנע ותוספת בלוק; evidence פגום מדולג', async () => {
    const sql = fakeSql((text) => (text.includes('behavior-approved') ? [
      { evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: 2 } },
      { evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: 9 } },
      { evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: '3' } },
      { evidence: { kind: 'behavior', behavior: STUDY_MORE } },
      { evidence: { kind: 'correction', field: 'time' } },
      { evidence: null },
    ] : []));
    const rules = await loadBehaviorRules(sql);
    assert.deepEqual(rules, { skipWeekdays: [2], extraBlocks: 1 });
    assert.match(sql.calls[0].text, /status = 'approved'/);
  });
  test('כשל מסד: אין כללים (נכשל פתוח), לא זורק', async (t) => {
    t.mock.method(console, 'error', () => {});
    const rules = await loadBehaviorRules(fakeSql(() => { throw new Error('db down'); }));
    assert.deepEqual(rules, EMPTY_BEHAVIOR);
  });
  test('preferredDays: מוריד את ימי ההימנעות', () => {
    const days = [{ date: '2026-11-23' }, { date: '2026-11-24' }, { date: '2026-11-25' }];
    assert.deepEqual(preferredDays(days, { skipWeekdays: [2] }).map((d) => d.date), ['2026-11-23', '2026-11-25']);
    assert.deepEqual(preferredDays(days, EMPTY_BEHAVIOR), days);
    assert.deepEqual(preferredDays(days, undefined), days);
  });
});

describe('behavior-rules: הכלל המאושר בתוכנית הלמידה (lib/study-plan.js)', () => {
  // שני 23.11 07:30; מבחן בחמישי 26.11: בלי כלל, שני / שלישי / רביעי 16:00 (test/study-plan.test.js).
  const MON = '2026-11-23';
  const NOW = new Date('2026-11-23T05:30:00.000Z');
  const MATH = { date: '2026-11-26', type: 'מבחן', subject: 'מתמטיקה', makeup: false };
  const freeGoogle = async () => ({ ok: true, events: [] });
  const factsOf = (call) => JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
  const blocksOf = (sql) => JSON.parse(factsOf(sql.find('study-plan-create')[0]).find((f) => f.field === 'blocks').value);
  const spareOf = (sql) => JSON.parse(factsOf(sql.find('study-plan-create')[0]).find((f) => f.field === 'spare').value);
  const plain = (approved = []) => fakeSql((text) => {
    if (text.includes('study-plan-create')) return [{ message_id: MSG }];
    if (text.includes('behavior-approved')) return approved;
    return [];
  });

  test('בלי כלל: כמו קודם (הכלל נטען מהמסד, ריק)', async () => {
    const sql = plain();
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.equal(sql.find('behavior-approved').length, 1);
    assert.ok(blocksOf(sql).some((b) => b.date === '2026-11-24'));
    assert.equal(blocksOf(sql).length, 3);
  });
  test('כלל "לא בשלישי" מאושר: אין בלוק ולא רזרבה בשלישי', async () => {
    const sql = plain([{ evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: 2 } }]);
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.deepEqual(out, { created: [examKey(MATH)] });
    assert.equal(blocksOf(sql).length, 3);
    assert.ok([...blocksOf(sql), ...spareOf(sql)].every((b) => b.date !== '2026-11-24'));
  });
  test('כלל "עוד זמן" מאושר: ארבע שעות', async () => {
    const sql = plain([{ evidence: { kind: 'behavior', behavior: STUDY_MORE } }]);
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.equal(blocksOf(sql).length, 4);
    const body = sql.find('study-plan-create')[0].values.find((v) => typeof v === 'string' && v.startsWith('תוכנית למידה'));
    assert.ok(body.includes('4 שעות'));
  });
  test('אין יום אחר: נופלים חזרה ליום שנמנעים ממנו (אלא אם אין יום אחר)', async () => {
    // מבחן ברביעי 25.11, היום שלישי 24.11 07:30: היום היחיד הוא שלישי.
    const sql = plain([{ evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: 2 } }]);
    const exam = { date: '2026-11-25', type: 'מבחן', subject: 'אנגלית', makeup: false };
    await offerStudyPlans({ sql, todayIso: '2026-11-24', now: new Date('2026-11-24T05:30:00.000Z'), exams: [exam], timetable: null, googleDay: freeGoogle });
    const blocks = blocksOf(sql);
    assert.ok(blocks.length > 0);
    assert.ok(blocks.every((b) => b.date === '2026-11-24'));
  });
  test('behavior מוזרק: בלי שאילתת כללים', async () => {
    const sql = plain();
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle, behavior: { skipWeekdays: [1], extraBlocks: 0 } });
    assert.equal(sql.find('behavior-approved').length, 0);
    assert.ok(blocksOf(sql).every((b) => b.date !== MON));
  });
});

describe('behavior-rules: הכרטיס בצ\'אט', () => {
  test('pendingFromRows: כרטיס כלל התנהגות עם כן / לא, בלי תיבת כתיבה', () => {
    const [card] = pendingFromRows({
      questions: [{ id: MSG, body: 'בשבועות האחרונים ...', sent_at: REVIEW_NOW, entity_type: BEHAVIOR_ENTITY }], facts: [], timetable: null, today: REVIEW_DAY,
    });
    assert.equal(card.kind, 'behavior_rule');
    assert.deepEqual(card.buttons, [...BEHAVIOR_BUTTONS]);
    assert.equal(card.allowFreeText, false);
  });
});

describe('behavior-rules: חיבור לסגירה ולצ\'אט', () => {
  const closeAt = (day) => ({ kind: 'close', slotKey: `close-${day}`, targetAt: `${day}T19:00:00.000Z` });
  const deps = (sql, day) => ({
    sql, now: () => new Date(`${day}T19:00:01Z`), timetable: null, pushHandle: async () => new Response('ok'), secret: FAKE_CRON, googleConfig: null, loadTrainings: async () => [],
  });
  test('סגירה בשבת דו-שבועית: ההצעה רצה לפני טעינת השאלות; בערב אחר לא', async () => {
    const sql = fakeSql(() => []);
    await handleDelivery(closeAt(REVIEW_DAY), { deliveryCount: 1 }, deps(sql, REVIEW_DAY));
    const proposeAt = sql.calls.findIndex((c) => c.text.includes('behavior-study-days'));
    const pendingAt = sql.calls.findIndex((c) => c.text.includes('FROM messages m LEFT JOIN sources s'));
    assert.ok(proposeAt >= 0 && pendingAt > proposeAt, 'הכרטיס נוצר לפני טעינת השאלות, ולכן נספר בסגירה');
    const other = fakeSql(() => []);
    await handleDelivery(closeAt('2026-12-05'), { deliveryCount: 1 }, deps(other, '2026-12-05'));
    assert.equal(other.find('behavior-study-days').length, 0);
  });
  test('api/chat: תשובה לכרטיס כלל התנהגות נכתבת', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('behavior-ask')) return [{ id: MSG, awaiting_reply: true, candidate_id: CAND, status: 'candidate', evidence: { kind: 'behavior', behavior: STUDY_SKIP, weekday: 2 } }];
      if (text.includes('behavior-write')) return [{ closed: 1, answer_source_id: null, bubble_id: null }];
      return [];
    });
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG, answer: 'כן' }, { headers: { 'x-intake-secret': FAKE_SECRET }, url: 'https://x.test/api/chat' }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => REVIEW_NOW, googleDay: undefined,
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'answered');
    assert.equal(sql.find('behavior-write').length, 1);
  });
});
