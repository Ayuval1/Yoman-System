// בדיקות לבריף השבועי (בלוק 8, אפיון-מורחב 15, ש3): lib/weekly-brief.js, תזמון ב-lib/message-slots.js ו-lib/ops/cron-plan.js, מסירה ב-api/queues/deliver.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeWeekly, weeklyPushText, weekDates, isBiweeklySaturday, WEEKLY_NOTHING_LINE, BIWEEKLY_TITLE, biweeklyDates, studyHoursByExam, loadBiweeklyStudy, loadPendingRules } from '../lib/weekly-brief.js';
import { planWeekly, parseSlotMessage } from '../lib/message-slots.js';
import { briefEntityId } from '../lib/brief-view.js';
import { handle as cronHandle } from '../lib/ops/cron-plan.js';
import { handleDelivery } from '../api/queues/deliver.js';
import { fakeSql, FAKE_CRON, req } from './helpers.js';

// שבת 28.11.2026 = היום שלפני השבוע הבא (ראשון 29.11 עד שבת 5.12).
const SAT = '2026-11-28';
const EXAMS = [
  { date: '2026-11-30', type: 'מבחן', subject: 'מתמטיקה' },
  { date: '2026-12-02', type: 'מבדק', subject: 'אנגלית' },
  { date: '2026-12-06', type: 'מבחן', subject: 'היסטוריה' }, // מחוץ לשבוע
  { date: '2026-11-28', type: 'מבחן', subject: 'פיזיקה' }, // היום, לא בשבוע הבא
];

describe('weekly-brief: weekDates', () => {
  test('ראשון עד שבת שאחרי שבת הנתונה', () => {
    assert.deepEqual(weekDates(SAT), ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
  });
});

describe('weekly-brief: composeWeekly', () => {
  test('מבחנים, מבדק מסומן, הגשות, אימונים וחדש', () => {
    const { text, counts } = composeWeekly({
      saturdayIso: SAT, exams: EXAMS,
      tasks: [{ title: 'חוברת באנגלית', due_at: '2026-12-01T22:00:00Z' }, { title: 'להכין מצגת', due_at: '2026-12-03T14:00:00Z' }, { title: 'רחוק', due_at: '2026-12-20T00:00:00Z' }],
      trainings: [{ title: 'אימון ריצה', startsAt: '2026-11-30T14:00:00Z' }],
      received: ['נרשם · בוחן במתמטיקה'],
    });
    assert.match(text, /^השבוע הבא · 29\.11–5\.12/);
    assert.match(text, /מבחנים \(2\):/);
    assert.match(text, /· יום שני 30\.11 · מבחן במתמטיקה/);
    assert.match(text, /· יום רביעי 2\.12 · מבדק באנגלית/);
    assert.doesNotMatch(text.split(BIWEEKLY_TITLE)[0], /היסטוריה|פיזיקה|רחוק/); // השבוע הבא בלבד; 28.11 היא שבת דו-שבועית
    assert.match(text, /הגשות \(2\):/);
    assert.match(text, /· יום רביעי 2\.12 · חוברת באנגלית/); // 22:00Z = 00:00 ישראל ב-2 בדצמבר (בלי שעה)
    assert.match(text, /· יום חמישי 3\.12 · להכין מצגת · 16:00/); // שעה ברורה
    assert.match(text, /אימונים \(1\):\n· יום שני 30\.11 · אימון ריצה · 16:00/);
    assert.match(text, /חדש מאז שבוע שעבר:\n· נרשם · בוחן במתמטיקה/);
    assert.deepEqual(counts, { exams: 2, tasks: 2, trainings: 1, fresh: 1, biweeklyExams: 3 }); // 28.11 דו-שבועית: 30.11, 2.12, 6.12
  });
  test('סעיף ריק מושמט', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: EXAMS, tasks: [], trainings: [], received: [] });
    assert.match(text, /מבחנים/);
    assert.doesNotMatch(text, /הגשות|אימונים|חדש מאז/);
  });
  test('אין כלום: כותרת ושורה אחת קצרה', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [], tasks: [], trainings: [], received: [] });
    assert.equal(text.split('\n').length, 2);
    assert.ok(text.endsWith(WEEKLY_NOTHING_LINE));
  });
  test('partial: אין טענה ש"אין כלום"', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [], tasks: [], trainings: [], received: [], partial: true });
    assert.doesNotMatch(text, new RegExp(WEEKLY_NOTHING_LINE));
  });
  test('חדש: עד 10 שורות ואז "ועוד N"', () => {
    const received = Array.from({ length: 13 }, (_, i) => `פריט ${i}`);
    const { text, counts } = composeWeekly({ saturdayIso: SAT, exams: [], received });
    assert.match(text, /ועוד 3/);
    assert.equal(counts.fresh, 13);
  });
  test('הסימון הדו-שבועי מוחזר, ושבתות מתחלפות', () => {
    const a = composeWeekly({ saturdayIso: SAT, exams: EXAMS });
    assert.equal(a.biweekly, isBiweeklySaturday(SAT));
    assert.equal(isBiweeklySaturday('2026-12-05'), !isBiweeklySaturday(SAT));
  });
});

// הבריף הדו-שבועי (לילה 26.11): בשבת דו-שבועית סעיף "שבועיים קדימה" בתוך הבריף השבועי, לא הודעה נפרדת.
describe('weekly-brief: שבועיים קדימה', () => {
  const STUDY = [
    { match_key: 'source:study:2026-11-30:מתמטיקה:2026-11-27T15:00', starts_at: '2026-11-27T13:00:00Z', ends_at: '2026-11-27T14:00:00Z' },
    { match_key: 'source:study:2026-11-30:מתמטיקה:2026-11-28T15:00', starts_at: '2026-11-28T13:00:00Z', ends_at: '2026-11-28T14:00:00Z' },
    { match_key: 'source:study:2026-12-06:היסטוריה:2026-12-03T15:00', starts_at: '2026-12-03T13:00:00Z', ends_at: '2026-12-03T14:00:00Z' },
    { match_key: 'source:study:2026-12-25:ספרות:2026-12-03T17:00', starts_at: '2026-12-03T15:00:00Z', ends_at: '2026-12-03T16:00:00Z' }, // מבחן מחוץ לטווח
    { match_key: 'source:abc', starts_at: '2026-12-03T15:00:00Z', ends_at: '2026-12-03T16:00:00Z' }, // לא למידה
  ];
  test('העוגן קבוע: 28.11.2026 דו-שבועית, 5.12 לא, 12.12 כן, 14.11 כן', () => {
    assert.equal(isBiweeklySaturday('2026-11-28'), true);
    assert.equal(isBiweeklySaturday('2026-12-05'), false);
    assert.equal(isBiweeklySaturday('2026-12-12'), true);
    assert.equal(isBiweeklySaturday('2026-11-14'), true);
    assert.equal(isBiweeklySaturday('2026-11-21'), false);
  });
  test('הימים 1 עד 14 אחרי השבת', () => {
    const dates = biweeklyDates(SAT);
    assert.equal(dates.length, 14);
    assert.equal(dates[0], '2026-11-29');
    assert.equal(dates[13], '2026-12-12');
  });
  test('שעות למידה לכל מבחן לפי המפתח source:study:<תאריך>:<מקצוע>', () => {
    const hours = studyHoursByExam(STUDY);
    assert.equal(hours.get('2026-11-30:מתמטיקה'), 120);
    assert.equal(hours.get('2026-12-06:היסטוריה'), 60);
    assert.equal(hours.size, 3);
  });
  test('שבת דו-שבועית: מבחני 14 הימים עם שעות הלמידה, אחרי סעיפי השבוע', () => {
    const exams = [...EXAMS, { date: '2026-12-13', type: 'מבחן', subject: 'ספרות' }]; // יום 15: בחוץ
    const { text, counts } = composeWeekly({ saturdayIso: SAT, exams, studyRows: STUDY, pendingRules: 0 });
    const [week, two] = text.split(BIWEEKLY_TITLE);
    assert.ok(two, 'יש סעיף שבועיים קדימה');
    assert.match(week, /מבחנים \(2\):/);
    assert.match(`${BIWEEKLY_TITLE}${two}`, /^שבועיים קדימה · 29\.11–12\.12 \(3\):/);
    assert.match(two, /· יום שני 30\.11 · מבחן במתמטיקה · שעתיים למידה ביומן/);
    assert.match(two, /· יום רביעי 2\.12 · מבדק באנגלית · עוד אין למידה ביומן/);
    assert.match(two, /· יום ראשון 6\.12 · מבחן בהיסטוריה · שעה אחת למידה ביומן/);
    assert.doesNotMatch(two, /ספרות|פיזיקה|כללים/);
    assert.equal(counts.biweeklyExams, 3);
  });
  test('שבת רגילה: אין סעיף, גם כשיש נתונים', () => {
    const { text, counts } = composeWeekly({ saturdayIso: '2026-12-05', exams: EXAMS, studyRows: STUDY, pendingRules: 2 });
    assert.doesNotMatch(text, /שבועיים קדימה|כללים/);
    assert.equal(counts.biweeklyExams, 0);
  });
  test('כללים שמחכים לאישור: שורה רק כשיש', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: EXAMS, studyRows: [], pendingRules: 2 });
    assert.match(text, /\nכללים שלמדתי ומחכים לאישור שלך: 2$/);
  });
  test('אין מבחנים ב-14 ימים ואין כללים: הסעיף מושמט ונשארת שורת "אין כלום"', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [], studyRows: [], pendingRules: 0 });
    assert.equal(text.split('\n').length, 2);
    assert.ok(text.endsWith(WEEKLY_NOTHING_LINE));
  });
  test('שבוע הבא ריק אבל יש מבחן ביום 8: "אין כלום" לשבוע, ואחריו הסעיף', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: [{ date: '2026-12-06', type: 'מבחן', subject: 'היסטוריה' }], studyRows: [] });
    const lines = text.split('\n');
    assert.equal(lines[1], WEEKLY_NOTHING_LINE);
    assert.match(lines[2], /^שבועיים קדימה/);
  });
  test('שעות הלמידה לא נטענו (null): בלי סיומת שעות, בלי טענה "עוד אין"', () => {
    const { text } = composeWeekly({ saturdayIso: SAT, exams: EXAMS, studyRows: null });
    assert.match(text, /· יום שני 30\.11 · מבחן במתמטיקה\n/);
    assert.doesNotMatch(text, /למידה ביומן/);
  });
  test('מבחן שנדחה בלי מועד ומועד ב\' לא נכנסים לסעיף', () => {
    const exams = [{ date: '2026-12-01', type: 'מבחן', subject: 'גאוגרפיה', postponed: true }, { date: '2026-12-08', type: 'מועד ב\'', makeup: true }];
    const { text } = composeWeekly({ saturdayIso: SAT, exams, studyRows: [] });
    assert.doesNotMatch(text, /שבועיים קדימה/);
  });
  test('מדעים עם תשובה "פיזיקה": המפתח נשאר לפי הלוח (מדעים), התצוגה לפי התשובה', () => {
    const exams = [{ date: '2026-12-01', type: 'מבחן', subject: 'מדעים' }];
    const studyRows = [{ match_key: 'source:study:2026-12-01:מדעים:2026-11-30T15:00', starts_at: '2026-11-30T13:00:00Z', ends_at: '2026-11-30T14:00:00Z' }];
    const { text } = composeWeekly({ saturdayIso: SAT, exams, answers: new Map([['2026-12-01', 'פיזיקה']]), studyRows });
    assert.match(text.split(BIWEEKLY_TITLE)[1], /מבחן בפיזיקה.* · שעה אחת למידה ביומן/);
  });
});

describe('weekly-brief: טוענים דו-שבועיים', () => {
  test('loadBiweeklyStudy: אירועי למידה מתוכננים עם מפתח למידה, עד סוף היום ה-14', async () => {
    const sql = fakeSql(() => [{ match_key: 'source:study:2026-11-30:מתמטיקה:2026-11-27T15:00', starts_at: new Date('2026-11-27T13:00:00Z'), ends_at: new Date('2026-11-27T14:00:00Z') }]);
    const rows = await loadBiweeklyStudy(sql, SAT);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].starts_at, '2026-11-27T13:00:00.000Z');
    const call = sql.calls[0];
    assert.match(call.text, /domain = \?::text AND status = 'planned' AND match_key LIKE 'source:study:%'/);
    assert.ok(call.values.includes('study'));
    assert.ok(call.values.includes('2026-12-12T22:00:00.000Z')); // סוף 12.12 בשעון ישראל
  });
  test('loadPendingRules: מועמדים שיש להם כרטיס שמחכה לתשובה', async () => {
    const sql = fakeSql(() => [{ n: 3 }]);
    assert.equal(await loadPendingRules(sql), 3);
    const call = sql.calls[0];
    assert.match(call.text, /FROM candidate_rules c JOIN messages m ON m\.entity_id = c\.id/);
    assert.match(call.text, /c\.status = 'candidate'/);
    assert.match(call.text, /m\.awaiting_reply = true AND m\.entity_type = \?::text/);
    assert.ok(call.values.includes('correction_rule'));
  });
});

describe('weekly-brief: weeklyPushText', () => {
  test('מספרים בלבד, בלי כותרות', () => {
    const body = weeklyPushText({ exams: 2, tasks: 1, trainings: 3, fresh: 4 });
    assert.equal(body, 'השבוע הבא: 2 מבחנים · משימה אחת להגשה · 3 אימונים · 4 חדשים');
  });
  test('שקט', () => assert.equal(weeklyPushText({ exams: 0, tasks: 0, trainings: 0, fresh: 0 }), 'השבוע הבא: שקט'));
});

describe('message-slots: planWeekly ו-parseSlotMessage', () => {
  test('שבת בבוקר: מתוזמן ל-20:00 באותו יום (17:00Z בחורף)', () => {
    const plan = planWeekly(new Date('2026-11-28T11:00:00Z'));
    assert.equal(plan.kind, 'weekly');
    assert.equal(plan.slotKey, 'weekly-2026-11-28');
    assert.equal(plan.targetAt, '2026-11-28T18:00:00.000Z');
    assert.ok(plan.delaySeconds > 0 && plan.retentionSeconds > plan.delaySeconds);
  });
  test('לא שבת: null. שבת אחרי 20:00: null', () => {
    assert.equal(planWeekly(new Date('2026-11-27T11:00:00Z')), null);
    assert.equal(planWeekly(new Date('2026-11-28T19:00:00Z')), null);
  });
  test('מפתח תקין עובר; יום שאינו שבת או תאריך שלא תואם נדחים', () => {
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-28T18:00:00.000Z' }).ok, true);
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-27', targetAt: '2026-11-27T18:00:00.000Z' }).ok, false);
    assert.equal(parseSlotMessage({ kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-21T18:00:00.000Z' }).ok, false);
  });
});

describe('cron-plan: תזמון השבועי', () => {
  const sends = () => { const calls = []; const fn = async (...a) => { calls.push(a); return {}; }; fn.calls = calls; return fn; };
  const run = (iso, slot, send) => cronHandle(req(`https://x.test/api/ops?slot=${slot}`, { headers: { authorization: `Bearer ${FAKE_CRON}` } }),
    { sql: fakeSql(), secret: FAKE_CRON, now: () => new Date(iso), send, timetable: { slots: [] }, taskChecksEnabled: false });
  test('שבת, slot=2: נשלחת גם הודעת weekly עם idempotencyKey', async () => {
    const send = sends();
    const res = await run('2026-11-28T14:00:00Z', '2', send);
    assert.equal(res.status, 200);
    const weekly = send.calls.find((c) => c[1].kind === 'weekly');
    assert.ok(weekly);
    assert.equal(weekly[2].idempotencyKey, 'weekly-2026-11-28');
  });
  test('יום חול: לא נשלחת weekly', async () => {
    const send = sends();
    await run('2026-11-26T14:00:00Z', '2', send);
    assert.equal(send.calls.some((c) => c[1].kind === 'weekly'), false);
  });
});

describe('deliver: weekly', () => {
  const MSG = { kind: 'weekly', slotKey: 'weekly-2026-11-28', targetAt: '2026-11-28T18:00:00.000Z' };
  const handler = (existing = false) => (text) => {
    if (text.includes("entity_type = 'weekly_brief'") && text.startsWith('SELECT')) return existing ? [{ found: 1 }] : [];
    if (text.includes('INSERT INTO messages')) return [{ id: 'm1' }];
    return [];
  };
  const pushHandle = (calls) => async (request) => { calls.push(JSON.parse(await request.text())); return new Response('ok', { status: 200 }); };
  test('כותב הודעה אחת (weekly_brief, entity_id דטרמיניסטי) ודחיפה עם מספרים בלבד', async () => {
    const sql = fakeSql(handler());
    const pushes = [];
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-28T18:00:01Z'), pushHandle: pushHandle(pushes), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(out.created, true);
    const insert = sql.find('INSERT INTO messages')[0];
    assert.ok(insert.text.includes("'weekly_brief'"));
    assert.equal(insert.values[2], briefEntityId(MSG.slotKey));
    assert.match(insert.values[0], /^השבוע הבא/);
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].dedupe_key, MSG.slotKey);
    assert.match(pushes[0].body, /^השבוע הבא: /);
  });
  test('שבת דו-שבועית: נטענות שעות הלמידה והכללים הממתינים, והסעיף נכתב בהודעה', async () => {
    const sql = fakeSql((text) => {
      if (text.includes("match_key LIKE 'source:study:%'")) return [{ match_key: 'source:study:2026-12-06:היסטוריה:2026-12-03T15:00', starts_at: '2026-12-03T13:00:00Z', ends_at: '2026-12-03T14:00:00Z' }];
      if (text.includes('FROM candidate_rules')) return [{ n: 1 }];
      return handler()(text);
    });
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-28T18:00:01Z'), pushHandle: pushHandle([]), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(out.created, true);
    const body = sql.find('INSERT INTO messages')[0].values[0];
    assert.match(body, /\nכללים שלמדתי ומחכים לאישור שלך: 1$/);
  });
  test('שבת רגילה: לא נטענים שעות למידה וכללים', async () => {
    const sql = fakeSql(handler());
    const msg = { kind: 'weekly', slotKey: 'weekly-2026-12-05', targetAt: '2026-12-05T18:00:00.000Z' };
    await handleDelivery(msg, { deliveryCount: 1 }, { sql, now: () => new Date('2026-12-05T18:00:01Z'), pushHandle: pushHandle([]), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(sql.find('FROM candidate_rules').length, 0);
    assert.equal(sql.find("match_key LIKE 'source:study:%'").length, 0);
    assert.doesNotMatch(sql.find('INSERT INTO messages')[0].values[0], /שבועיים קדימה/);
  });
  test('הודעה קיימת: לא נכתבת שוב', async () => {
    const sql = fakeSql(handler(true));
    const out = await handleDelivery(MSG, { deliveryCount: 1 }, { sql, now: () => new Date('2026-11-28T18:00:01Z'), pushHandle: pushHandle([]), secret: FAKE_CRON, timetable: { slots: [] } });
    assert.equal(out.created, false);
    assert.equal(sql.find('INSERT INTO messages').length, 0);
  });
});
