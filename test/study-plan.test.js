// בדיקות ל-lib/study-plan.js (בלוק 7: תוכנית למידה למבחן; 03-analysis-rules.md:386, ש6 = א'; "לא לומד היום", 02-build-plan.md:499).
// בלי רשת ובלי מסד: sql מזויף, googleDay מוזרק. הלוח בבדיקות מומצא. ה-SQL לא רץ מול Postgres; הבדיקות מוודאות את הפרמטרים והזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql } from './helpers.js';
import { pendingFromRows } from '../lib/chat-view.js';
import {
  STUDY_PLAN_ENTITY, STUDY_PLAN_BUTTONS, prepDays, examsToPlan, spacedSlots, pickBlocks, planText, examKey, studyKey,
  offerStudyPlans, answerStudyPlan, detectNotStudying, answerNotStudying, notStudyingReply,
} from '../lib/study-plan.js';

// נובמבר 2026: ישראל UTC+2. שני 23.11, שלישי 24.11, רביעי 25.11, חמישי 26.11.
const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';
const NOW = new Date('2026-11-23T05:30:00.000Z'); // שני 07:30, הבריף
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const MATH = { date: THU, type: 'מבחן', subject: 'מתמטיקה', makeup: false };
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const freeGoogle = async () => ({ ok: true, events: [] });
const factsOf = (call) => JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));

describe('study-plan: טווח ההכנה (טהור)', () => {
  test('מבחן 10 ימים, מבדק 7, מבדק בתנ"ך 3 (03-personal-weights-rules.md 3.1)', () => {
    assert.equal(prepDays({ type: 'מבחן', subject: 'אנגלית' }), 10);
    assert.equal(prepDays({ type: 'מבדק', subject: 'ערבית' }), 7);
    assert.equal(prepDays({ type: 'מבדק', subject: 'תנ"ך' }), 3);
    assert.equal(prepDays({ type: 'אנסין', subject: 'אנגלית' }), 10);
  });
  test('examsToPlan: רק מבחן שהטווח שלו נפתח, אחרי היום, לא מועד ב\', לא נדחה בלי מועד, בלי כפילות', () => {
    const exams = [
      MATH,
      { date: '2026-12-10', type: 'מבחן', subject: 'אנגלית' }, // עוד 17 ימים: הטווח לא נפתח
      { date: '2026-11-30', type: 'מבדק', subject: 'תנ"ך' }, // 7 ימים, מבדק תנ"ך = 3: לא נפתח
      { date: MON, type: 'מבחן', subject: 'ספרות' }, // היום עצמו: לא
      { date: TUE, type: 'מועד ב\'', subject: null, makeup: true },
      { date: WED, type: 'מבחן', subject: 'היסטוריה', postponed: true },
      { ...MATH },
    ];
    assert.deepEqual(examsToPlan(MON, { exams }).map(examKey), [examKey(MATH)]);
  });
});

describe('study-plan: בלוקים (טהור)', () => {
  test('spacedSlots: שעה, ואחריה הפסקה של רבע שעה לפחות (כלל 9)', () => {
    const slots = spacedSlots({ windows: [[min('16:00'), min('19:00')]] });
    assert.deepEqual(slots, [{ start: '16:00', end: '17:00' }, { start: '17:30', end: '18:30' }]);
  });
  test('pickBlocks: מהיום שלפני המבחן אחורה, בלוק לכל יום קודם; שלושה בלוקים ממוינים ורזרבה', () => {
    const days = [
      { date: MON, slots: [{ start: '16:00', end: '17:00' }, { start: '17:30', end: '18:30' }] },
      { date: TUE, slots: [{ start: '15:00', end: '16:00' }] },
      { date: WED, slots: [{ start: '16:00', end: '17:00' }, { start: '17:30', end: '18:30' }] },
    ];
    const { blocks, spare } = pickBlocks(days);
    assert.deepEqual(blocks.map((b) => `${b.date} ${b.start}`), [`${MON} 16:00`, `${TUE} 15:00`, `${WED} 16:00`]);
    assert.deepEqual(spare.map((b) => `${b.date} ${b.start}`), [`${WED} 17:30`, `${MON} 17:30`]);
  });
  test('planText: כותרת עם המבחן, שורה לכל בלוק, ושורת הרחבה כשיש רזרבה', () => {
    const text = planText({ exam: MATH, blocks: [{ date: TUE, start: '15:00', end: '16:00' }], spare: [{ date: WED, start: '16:00', end: '17:00' }] });
    assert.match(text, /^תוכנית למידה למבחן במתמטיקה \(חמישי 26\.11\), שעה אחת:/);
    assert.match(text, /· שלישי 24\.11 15:00–16:00/);
    assert.match(text, /אפשר גם להוסיף עוד זמן/);
  });
});

describe('study-plan: offerStudyPlans (הבריף)', () => {
  test('בלי Google (googleDay לא מוגדר): לא נוגעים במסד ולא מציעים', async () => {
    const sql = fakeSql();
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null });
    assert.deepEqual(out, { created: [], skipped: 'google_skipped' });
    assert.equal(sql.calls.length, 0);
  });
  test('מבחן בחמישי: כרטיס אחד עם שלוש שעות (שני, שלישי, רביעי 16:00), פג בתחילת הבלוק הראשון, בלי ערב שלישי (חוג, כלל 6)', async () => {
    const sql = fakeSql((text) => (text.includes('study-plan-create') ? [{ message_id: MSG_ID }] : []));
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.deepEqual(out, { created: [examKey(MATH)] });
    const [call] = sql.find('study-plan-create');
    const body = call.values.find((v) => typeof v === 'string' && v.startsWith('תוכנית למידה'));
    assert.ok(body.includes('· שני 23.11 16:00–17:00'));
    assert.ok(body.includes('· שלישי 24.11 16:00–17:00'));
    assert.ok(body.includes('· רביעי 25.11 16:00–17:00'));
    assert.ok(body.includes('3 שעות'));
    assert.ok(call.values.includes(new Date('2026-11-23T14:00:00.000Z').toISOString())); // תחילת הבלוק הראשון
    assert.ok(call.values.includes(STUDY_PLAN_ENTITY));
    assert.match(call.text, /NOT EXISTS \(SELECT 1 FROM facts p WHERE p\.entity_type = \?::text AND p\.field = 'exam'/);
    const facts = factsOf(call);
    const spare = JSON.parse(facts.find((f) => f.field === 'spare').value);
    assert.equal(spare.length, 3);
    assert.ok(spare.every((b) => !(b.date === TUE && min(b.start) >= min('17:00'))), 'שלישי אחרי 17:00 סגור');
  });
  test('יום אימון (running): רק 16:00–17:00 נשאר בו', async () => {
    const sql = fakeSql((text, values) => {
      if (text.includes('study-plan-create')) return [{ message_id: MSG_ID }];
      if (text.includes('FROM events e') && values[1] === new Date('2026-11-24T22:00:00.000Z').toISOString()) {
        return [{ title: 'אימון', starts_at: '2026-11-25T15:00:00.000Z', ends_at: '2026-11-25T18:00:00.000Z', domain: 'running', external_id: null }];
      }
      return [];
    });
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    const facts = factsOf(sql.find('study-plan-create')[0]);
    const all = [...JSON.parse(facts.find((f) => f.field === 'blocks').value), ...JSON.parse(facts.find((f) => f.field === 'spare').value)];
    const wed = all.filter((b) => b.date === WED);
    assert.deepEqual(wed.map((b) => b.start), ['16:00']);
  });
  test('כבר הוצע: אין כרטיס שני', async () => {
    const sql = fakeSql((text) => (text.includes('study-plan-offered') ? [{ value: examKey(MATH) }] : []));
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.deepEqual(out, { created: [] });
    assert.equal(sql.find('study-plan-create').length, 0);
  });
  test('Google נכשל: אין הצעה היום (ינסה מחר)', async () => {
    const sql = fakeSql();
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: async () => ({ ok: false }) });
    assert.equal(out.created.length, 0);
    assert.equal(out.skipped, 'google_failed');
  });
  test('אין אף חלון פנוי: הודעה אחת בלי כפתורים (לא נופל בין הכיסאות)', async () => {
    const tomorrow = { ...MATH, date: TUE };
    const late = new Date('2026-11-23T19:00:00.000Z'); // שני 21:00
    const sql = fakeSql((text) => (text.includes('study-plan-create') ? [{ message_id: MSG_ID }] : []));
    await offerStudyPlans({ sql, todayIso: MON, now: late, exams: [tomorrow], timetable: null, googleDay: freeGoogle });
    const [call] = sql.find('study-plan-create');
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith('לא מצאתי זמן פנוי')));
    assert.ok(call.values.includes('update'));
    assert.ok(call.values.includes(false));
  });
  test('שני מבחנים באותה ריצה לא מקבלים את אותו בלוק', async () => {
    const other = { date: THU, type: 'מבדק', subject: 'ערבית' };
    const sql = fakeSql((text) => (text.includes('study-plan-create') ? [{ message_id: MSG_ID }] : []));
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH, other], timetable: null, googleDay: freeGoogle });
    const calls = sql.find('study-plan-create');
    assert.equal(calls.length, 2);
    const used = calls.flatMap((call) => {
      const facts = factsOf(call);
      return [...JSON.parse(facts.find((f) => f.field === 'blocks').value), ...JSON.parse(facts.find((f) => f.field === 'spare').value)];
    }).map((b) => `${b.date} ${b.start}`);
    assert.equal(new Set(used).size, used.length);
  });
  test('כשל מסד לא זורק (הבריף ממשיך)', async () => {
    const sql = fakeSql(() => { throw new Error('db'); });
    const out = await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH], timetable: null, googleDay: freeGoogle });
    assert.deepEqual(out, { created: [], skipped: 'error' });
  });
});

const BLOCKS = [{ date: TUE, start: '16:00', end: '17:00' }, { date: WED, start: '16:00', end: '17:00' }];
const SPARE = [{ date: WED, start: '17:30', end: '18:30' }];
const askRow = (over = {}) => ({
  id: MSG_ID, awaiting_reply: true, card_id: 'c1',
  facts: { exam: examKey(MATH), exam_date: THU, exam_type: 'מבחן', subject: 'מתמטיקה', blocks: JSON.stringify(BLOCKS), spare: JSON.stringify(SPARE) },
  ...over,
});
function answerSql({ ask = askRow(), written = { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', keys: [] }, busyRows = [] } = {}) {
  return fakeSql((text) => {
    if (text.includes('study-plan-ask')) return ask ? [ask] : [];
    if (text.includes('study-plan-write')) return [written];
    if (text.includes('FROM events e')) return busyRows;
    return [];
  });
}
const eventsOf = (sql) => JSON.parse(sql.find('study-plan-write')[0].values.find((v) => typeof v === 'string' && v.startsWith('[') && v.includes('starts_at')) ?? '[]');
const LATER = new Date('2026-11-23T10:00:00.000Z');

describe('study-plan: answerStudyPlan', () => {
  test('"כן": כל בלוק פנוי נכתב כאירוע בתחום study עם מפתח source:study, והמפתחות חוזרים לכתיבה ליומן', async () => {
    const keys = BLOCKS.map((b) => studyKey(MATH, b));
    const sql = answerSql({ written: { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', keys } });
    const out = await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'כן', now: LATER, timetable: null, googleDay: freeGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, keys);
    const events = eventsOf(sql);
    assert.equal(events.length, 2);
    assert.equal(events[0].title, 'למידה למבחן במתמטיקה');
    assert.equal(events[0].starts_at, new Date('2026-11-24T14:00:00.000Z').toISOString());
    assert.equal(events[0].match_key, 'source:study:2026-11-26:מתמטיקה:2026-11-24T16:00');
    assert.match(sql.find('study-plan-write')[0].text, /INSERT INTO events/);
  });
  test('"כן" כשבלוק נתפס: רק הפנוי נכתב, והבועה אומרת מה לא נכנס', async () => {
    const busyRows = [{ title: 'רופא', starts_at: '2026-11-25T14:30:00.000Z', ends_at: '2026-11-25T15:30:00.000Z', domain: 'personal', external_id: null }];
    const sql = answerSql({ busyRows });
    await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'כן', now: LATER, timetable: null, googleDay: freeGoogle });
    const events = eventsOf(sql);
    assert.equal(events.length, 1);
    assert.ok(sql.find('study-plan-write')[0].values.some((v) => typeof v === 'string' && v.includes('נתפס בינתיים')));
  });
  test('"כן" כש-Google לא נבדק: לא נכתב אף אירוע, והכרטיס נשאל שוב', async () => {
    const sql = answerSql();
    await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'כן', now: LATER, timetable: null, googleDay: async () => ({ ok: false }) });
    assert.equal(eventsOf(sql).length, 0);
    const values = sql.find('study-plan-write')[0].values;
    assert.ok(values.some((v) => typeof v === 'string' && v.startsWith('תוכנית למידה')));
  });
  test('"עוד זמן": בלוק מהרזרבה נוסף, וכרטיס חדש עם שלוש שעות', async () => {
    const sql = answerSql();
    await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'עוד זמן', now: LATER, timetable: null, googleDay: freeGoogle });
    const values = sql.find('study-plan-write')[0].values;
    const body = values.find((v) => typeof v === 'string' && v.startsWith('תוכנית למידה'));
    assert.ok(body.includes('3 שעות'));
    assert.ok(body.includes('רביעי 25.11 17:30–18:30'));
    assert.equal(eventsOf(sql).length, 0);
  });
  test('"עוד זמן" בלי רזרבה: נאמר, והכרטיס נשאל שוב כמו שהוא', async () => {
    const sql = answerSql({ ask: askRow({ facts: { ...askRow().facts, spare: '[]' } }) });
    await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'עוד זמן', now: LATER, timetable: null, googleDay: freeGoogle });
    const values = sql.find('study-plan-write')[0].values;
    assert.ok(values.some((v) => typeof v === 'string' && v.startsWith('אין עוד זמן פנוי')));
    assert.ok(values.some((v) => typeof v === 'string' && v.includes('שעתיים')));
  });
  test('"לא": נסגר בלי אירועים, עם בועה', async () => {
    const sql = answerSql();
    const out = await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'לא', now: LATER, timetable: null, googleDay: freeGoogle });
    assert.equal(out.status, 'answered');
    assert.equal(eventsOf(sql).length, 0);
    assert.ok(sql.find('study-plan-write')[0].values.includes('בלי תוכנית למידה · מבחן במתמטיקה'));
  });
  test('תשובה שאינה כפתור: unclear בלי כתיבה; כרטיס שלא קיים או נסגר: closed', async () => {
    const sql = answerSql();
    assert.equal((await answerStudyPlan({ sql, messageId: MSG_ID, answer: 'אולי', now: LATER })).status, 'unclear');
    assert.equal(sql.find('study-plan-write').length, 0);
    assert.equal((await answerStudyPlan({ sql: answerSql({ ask: null }), messageId: MSG_ID, answer: 'כן', now: LATER })).status, 'closed');
    assert.equal((await answerStudyPlan({ sql: answerSql({ ask: askRow({ awaiting_reply: false }) }), messageId: MSG_ID, answer: 'כן', now: LATER })).status, 'closed');
    const raced = answerSql({ written: { closed: 0 } });
    assert.equal((await answerStudyPlan({ sql: raced, messageId: MSG_ID, answer: 'לא', now: LATER })).status, 'closed');
  });
  test('הצ\'אט מציג את הכרטיס עם כן / עוד זמן / לא, בלי תיבת כתיבה', () => {
    const [item] = pendingFromRows({ questions: [{ id: MSG_ID, entity_type: STUDY_PLAN_ENTITY, body: 'תוכנית למידה...', sent_at: NOW.toISOString() }], facts: [], timetable: null, today: MON });
    assert.equal(item.kind, 'study_plan');
    assert.deepEqual(item.buttons, [...STUDY_PLAN_BUTTONS]);
    assert.equal(item.allowFreeText, false);
  });
});

describe('study-plan: "לא לומד היום, אני מוכן"', () => {
  test('זיהוי: הניסוח של יובל ווריאציות, לא משפט אחר', () => {
    assert.ok(detectNotStudying('לא לומד היום, אני מוכן'));
    assert.ok(detectNotStudying('אני לא לומד היום כי אני מרגיש מוכן'));
    assert.ok(detectNotStudying('היום אני לא אלמד היום')); // "לא אלמד היום"
    assert.ok(!detectNotStudying('לומד היום למבחן'));
    assert.ok(!detectNotStudying('הוא לא לומד מחר'));
    assert.ok(!detectNotStudying(null));
  });
  test('התשובה בשורה אחת: מה בוטל, כמה ימים למבחן, וכמה למידה נשארה ביומן', () => {
    const cancelled = ['source:study:2026-11-26:מתמטיקה:2026-11-23T16:00'];
    const later = ['source:study:2026-11-26:מתמטיקה:2026-11-24T16:00', 'source:study:2026-11-26:מתמטיקה:2026-11-25T16:00'];
    assert.equal(notStudyingReply({ today: MON, cancelled, later }), 'בוטלה הלמידה של היום (שעה אחת). עד מתמטיקה נשארו 3 ימים, ועוד שעתיים למידה ביומן.');
    assert.equal(notStudyingReply({ today: MON, cancelled: [], later: [] }), 'אין היום למידה ביומן, אין מה לבטל.');
  });
  test('answerNotStudying: פקודה אחת שמבטלת את הלמידה של היום שעוד לא נגמרה, בועה, ומפתחות למחיקה מהיומן', async () => {
    const cancelled = ['source:study:2026-11-26:מתמטיקה:2026-11-23T16:00'];
    const sql = fakeSql((text) => (text.includes('study-not-today */') ? [{ claimed: 1, cancelled, later: [] }] : []));
    const out = await answerNotStudying({ sql, source: { id: '44444444-4444-4444-8444-444444444444' }, now: NOW });
    assert.equal(out.status, 'recorded');
    assert.deepEqual(out.calendarKeys, cancelled);
    const [call] = sql.find('study-not-today */');
    assert.match(call.text, /UPDATE events SET status = 'cancelled'/);
    assert.match(call.text, /ends_at > \?::timestamptz/);
    assert.equal(sql.find('study-not-today-bubble').length, 1);
  });
  test('מקור שכבר טופל: skipped, בלי בועה', async () => {
    const sql = fakeSql((text) => (text.includes('study-not-today */') ? [{ claimed: 0, cancelled: [], later: [] }] : []));
    const out = await answerNotStudying({ sql, source: { id: '44444444-4444-4444-8444-444444444444' }, now: NOW });
    assert.equal(out.status, 'skipped');
    assert.equal(sql.find('study-not-today-bubble').length, 0);
  });
});

describe('study-plan: ממצאי הבודק', () => {
  test('אירועי למידה לא נכנסים למאגר ההתאמה של event-match (הודעה לא קשורה לא תזיז אותם)', async () => {
    const { loadEventPool } = await import('../lib/event-match.js');
    const sql = fakeSql(() => []);
    await loadEventPool(sql, NOW.toISOString());
    assert.ok(sql.calls.some((c) => c.text.includes("NOT LIKE 'source:study:%'")));
  });
  test('שני מבחנים באותו יום: בין בלוק של מבחן אחד לבלוק של השני יש הפסקה של רבע שעה לפחות', async () => {
    const other = { date: THU, type: 'מבדק', subject: 'ערבית' };
    const sql = fakeSql((text) => (text.includes('study-plan-create') ? [{ message_id: MSG_ID }] : []));
    await offerStudyPlans({ sql, todayIso: MON, now: NOW, exams: [MATH, other], timetable: null, googleDay: freeGoogle });
    const all = sql.find('study-plan-create').flatMap((call) => {
      const facts = factsOf(call);
      return [...JSON.parse(facts.find((f) => f.field === 'blocks').value), ...JSON.parse(facts.find((f) => f.field === 'spare').value)];
    });
    for (const a of all) {
      for (const b of all) {
        if (a === b || a.date !== b.date || min(a.start) > min(b.start)) continue;
        assert.ok(min(b.start) >= min(a.end) + 15, `${a.date} ${a.start} / ${b.start}`);
      }
    }
  });
});
