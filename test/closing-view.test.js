// בדיקות ל-lib/closing-view.js (שלב C-1, docs/08-chapter8/90: E2-E4, E8, E11 ותבנית ההודעה בסעיף 6; שורת "בוצע היום" של C-2: E6, H2, H3). כל הנתונים מומצאים, בלי טקסט הודעה אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  closingWindow, closingDates, receivedFromRows, loadReceived, doneTodayLine, loadDone, dueTomorrow, composeClosing, closingPushText,
  QUIET_RECEIVED_LINE, QUIET_EVENING_LINE, QUIET_PUSH, CLOSING_PUSH_WAITING,
} from '../lib/closing-view.js';
import { nextRunUtc } from '../lib/schedule-time.js';
import { planSlot } from '../lib/message-slots.js';
import { fakeSql } from './helpers.js';

const HOUR = 3600000;
const due = (iso) => `${iso}T09:00:00.000Z`; // שעת צהריים, כדי שהתאריך הישראלי ברור

describe('closing-view: חלון "נקלט היום" (E8)', () => {
  test('ערב רגיל (16.10.2026, UTC+3): מ-15.10 18:00Z (בלעדי) עד 16.10 18:00Z (כולל), 24 שעות', () => {
    const w = closingWindow('2026-10-16T18:00:00.000Z');
    assert.equal(w.lower.toISOString(), '2026-10-15T18:00:00.000Z');
    assert.equal(w.upper.toISOString(), '2026-10-16T18:00:00.000Z');
  });
  test('מעבר לשעון חורף (25.10.2026, 02:00): הסגירה ב-19:00Z, החלון מ-24.10 18:00Z, 25 שעות', () => {
    const w = closingWindow(new Date('2026-10-25T19:00:00.000Z'));
    assert.equal(w.lower.toISOString(), '2026-10-24T18:00:00.000Z');
    assert.equal(w.upper.getTime() - w.lower.getTime(), 25 * HOUR);
  });
  test('מעבר לשעון קיץ (26.3.2027): היעד וגבול הערב הקודם מחושבים ב-nextRunUtc (לא ידנית), והחלון 23 שעות', () => {
    const target = nextRunUtc({ hour: 21, minute: 0, timeZone: 'Asia/Jerusalem', from: new Date('2027-03-26T06:00:00.000Z') });
    const before = nextRunUtc({ hour: 21, minute: 0, timeZone: 'Asia/Jerusalem', from: new Date('2027-03-25T06:00:00.000Z') });
    assert.equal(planSlot('2', new Date('2027-03-26T06:00:00.000Z')).targetAt, target.toISOString(), 'אותו יעד כמו המשבצת בתור');
    const w = closingWindow(target);
    assert.equal(w.lower.toISOString(), before.toISOString());
    assert.equal(w.upper.getTime() - w.lower.getTime(), 23 * HOUR);
  });
  test('ערב שבת (24.10.2026): חלון רגיל של 24 שעות, מ-23.10 18:00Z', () => {
    const w = closingWindow('2026-10-24T18:00:00.000Z');
    assert.equal(w.lower.toISOString(), '2026-10-23T18:00:00.000Z');
  });
});

describe('closing-view: "מחר" (E11)', () => {
  test('מחר = התאריך הישראלי של targetAt ועוד יום, גם במעבר שעון ובסוף חודש', () => {
    assert.deepEqual(closingDates('2026-10-16T18:00:00.000Z'), { dateIso: '2026-10-16', tomorrowIso: '2026-10-17' });
    assert.deepEqual(closingDates('2026-10-25T19:00:00.000Z'), { dateIso: '2026-10-25', tomorrowIso: '2026-10-26' });
    assert.deepEqual(closingDates('2026-10-31T19:00:00.000Z'), { dateIso: '2026-10-31', tomorrowIso: '2026-11-01' });
  });
  test('"להגשה מחר" לפי due_at ישראלי: משימה עם due_at אחרי חצות UTC של אותו יום ישראלי נכנסת; בלי תאריך או מחרתיים לא', () => {
    const tasks = [
      { title: 'א', due_at: '2026-10-16T22:30:00.000Z' }, // 00:30 בישראל ב-17.10
      { title: 'ב', due_at: due('2026-10-18') },
      { title: 'ג' },
      { title: 'ד', due_at: '2026-10-16T20:59:00.000Z' }, // 23:59 בישראל ב-16.10: היום, לא מחר
    ];
    assert.deepEqual(dueTomorrow(tasks, '2026-10-17').map((t) => t.title), ['א']);
  });
});

describe('closing-view: receivedFromRows (H1, E2, E11)', () => {
  test('שורה אחת לכל מקור שיש לו type, לפי סדר המקורות; בלי type = "לא הובנו"; כפילות לא נספרת', () => {
    const out = receivedFromRows({
      sources: [{ id: 'b' }, { id: 'a' }, { id: 'c' }, { id: 'd', duplicate: true }],
      facts: [
        { source_id: 'a', field: 'type', value: 'exam' }, { source_id: 'a', field: 'subject', value: 'מתמטיקה' }, { source_id: 'a', field: 'date', value: '2026-11-01' },
        { source_id: 'b', field: 'type', value: 'cancel' }, { source_id: 'b', field: 'subject', value: 'פיזיקה' }, { source_id: 'b', field: 'date', value: '2026-10-28' },
      ],
    });
    assert.deepEqual(out, { lines: ['ביטול · פיזיקה · רביעי 28.10', 'מבחן · מתמטיקה · ראשון 1.11'], notUnderstood: 1 });
  });
  test('שדה כפול לאותו מקור: הערך הראשון (בסדר המסד: source_id, field, value) גובר', () => {
    const out = receivedFromRows({
      sources: [{ id: 'a' }],
      facts: [{ source_id: 'a', field: 'date', value: '2026-10-28' }, { source_id: 'a', field: 'date', value: '2026-10-29' }, { source_id: 'a', field: 'subject', value: 'כימיה' }, { source_id: 'a', field: 'type', value: 'exam' }],
    });
    assert.deepEqual(out.lines, ['מבחן · כימיה · רביעי 28.10']);
  });
  test('אירוע אישי: הכותרת שיובל הקליד, בלי שעה (E2)', () => {
    const out = receivedFromRows({ sources: [{ id: 'a' }], facts: [{ source_id: 'a', field: 'type', value: 'personal_event' }, { source_id: 'a', field: 'topic', value: 'תור לספר' }, { source_id: 'a', field: 'date', value: '2026-10-28' }, { source_id: 'a', field: 'time', value: '17:00' }] });
    assert.deepEqual(out.lines, ['אירוע אישי · תור לספר · רביעי 28.10']);
  });
  test('ריק / לא מערך: אפסים', () => {
    assert.deepEqual(receivedFromRows({ sources: null, facts: undefined }), { lines: [], notUnderstood: 0 });
  });
});

describe('closing-view: loadReceived (שאילתות)', () => {
  const W = closingWindow('2026-10-16T18:00:00.000Z');
  test('שאילתת מקורות: שני הערוצים, בלי שורות תשובה, החלון כפרמטרים, סדר received_at ואז id; בלי raw_content', async () => {
    const sql = fakeSql((text) => (text.includes('FROM sources s') ? [{ id: 's1', duplicate: false }] : [{ source_id: 's1', field: 'type', value: 'room' }, { source_id: 's1', field: 'subject', value: 'אנגלית' }, { source_id: 's1', field: 'date', value: '2026-10-18' }]));
    const out = await loadReceived(sql, W);
    assert.deepEqual(out, { lines: ['חדר · אנגלית · ראשון 18.10'], notUnderstood: 0 });
    const [sources, facts] = sql.calls;
    assert.match(sources.text, /s\.channel IN \('shortcut', 'app'\) AND s\.sender IS DISTINCT FROM 'answer'/);
    assert.match(sources.text, /s\.received_at > \?::timestamptz AND s\.received_at <= \?::timestamptz/);
    assert.match(sources.text, /ORDER BY s\.received_at ASC, s\.id ASC/);
    assert.match(sources.text, /o\.status = 'duplicate'/);
    assert.deepEqual(sources.values, ['2026-10-15T18:00:00.000Z', '2026-10-16T18:00:00.000Z']);
    assert.match(facts.text, /ORDER BY f\.source_id, f\.field, f\.value/);
    assert.deepEqual(facts.values, [JSON.stringify(['s1'])]);
    assert.ok(sql.calls.every((c) => !c.text.includes('raw_content')), 'פרטיות: לא נבחר טקסט הודעה');
  });
  test('אין מקורות: שאילתה אחת בלבד', async () => {
    const sql = fakeSql(() => []);
    assert.deepEqual(await loadReceived(sql, W), { lines: [], notUnderstood: 0 });
    assert.equal(sql.calls.length, 1);
  });
  test('כשל מסד נזרק (הצרכן מחליט)', async () => {
    await assert.rejects(() => loadReceived(fakeSql(() => { throw new Error('db down'); }), W), /db down/);
  });
});

describe('closing-view: composeClosing (סעיף 6)', () => {
  const tasks = [
    { title: 'דף תרגילים' },
    { title: 'חוברת באנגלית', due_at: due('2026-10-28') },
    { title: 'שיעורי בית · היסטוריה', due_at: due('2026-10-25') },
  ];
  const pending = [{ kind: 'homework', subject: 'פיזיקה' }, { id: 'q1' }];
  test('תבנית מלאה: כותרת, נקלט, לא הובנו, מחר, להגשה מחר, משימות (כמו בבוקר, כולל באיחור) ושאלות', () => {
    const out = composeClosing({
      dateIso: '2026-10-27', received: ['אירוע אישי · תור לספר · רביעי 28.10', 'מבחן · מתמטיקה · ראשון 1.11'], notUnderstood: 2,
      examLine: 'מחר: מבחן במתמטיקה ב-10:05', tasks, pending,
    });
    assert.equal(out.text, [
      'סגירה · יום שלישי 27.10',
      'נקלט היום (2):',
      '· אירוע אישי · תור לספר · רביעי 28.10',
      '· מבחן · מתמטיקה · ראשון 1.11',
      'לא הובנו: 2',
      'מחר: מבחן במתמטיקה ב-10:05',
      'להגשה מחר: חוברת באנגלית',
      'משימות פתוחות (3):',
      '· שיעורי בית · היסטוריה — באיחור (היה עד ראשון 25.10)',
      '· חוברת באנגלית — עד רביעי 28.10',
      '· דף תרגילים — בלי תאריך',
      'שאלות שממתינות: שיעורי בית בפיזיקה · ועוד שאלה אחת',
    ].join('\n'));
    assert.deepEqual({ ...out, text: undefined }, { text: undefined, received: 2, notUnderstood: 2, done: 0, tasks: 3, pending: 2, dueTomorrow: 1, exam: true, partial: false });
  });
  test('שורת המבחן לא מקבלת קידומת כפולה', () => {
    const out = composeClosing({ dateIso: '2026-10-25', examLine: 'מחר: מבחן במתמטיקה' });
    assert.ok(out.text.includes('\nמחר: מבחן במתמטיקה') && !out.text.includes('מחר: מחר:'));
  });
  test('ערב שאין בו כלום: שורה אחת', () => {
    const out = composeClosing({ dateIso: '2026-10-24', received: [], notUnderstood: 0, tasks: [], pending: [] });
    assert.equal(out.text, `סגירה · יום שבת 24.10\n${QUIET_EVENING_LINE}`);
    assert.equal(QUIET_EVENING_LINE, 'לא נקלטו הודעות היום. אין משימות פתוחות ואין שאלות.');
  });
  test('"נקלט" ריק אבל יש משימות: "לא נקלטו הודעות היום" ואז המשימות', () => {
    const out = composeClosing({ dateIso: '2026-10-27', tasks: [{ title: 'דף' }] });
    assert.equal(out.text, `סגירה · יום שלישי 27.10\n${QUIET_RECEIVED_LINE}\nמשימות פתוחות (1):\n· דף — בלי תאריך`);
  });
  test('"לא הובנו" מספר בלבד; בלי הודעות שזוהו לא נכתב "לא נקלטו" (זה לא נכון)', () => {
    const out = composeClosing({ dateIso: '2026-10-27', received: [], notUnderstood: 3 });
    assert.equal(out.text, 'סגירה · יום שלישי 27.10\nלא הובנו: 3');
    const zero = composeClosing({ dateIso: '2026-10-27', received: ['מבחן · מתמטיקה · ראשון 1.11'], notUnderstood: 0 });
    assert.ok(!zero.text.includes('לא הובנו'));
  });
  test('חלקי (null = לא נטען): החלק מושמט ואין טענת ריקנות', () => {
    const noReceived = composeClosing({ dateIso: '2026-10-27', received: null, notUnderstood: 4, tasks: [], pending: [] });
    assert.equal(noReceived.text, 'סגירה · יום שלישי 27.10');
    assert.equal(noReceived.partial, true);
    assert.equal(noReceived.notUnderstood, 0, 'בלי "נקלט" אין גם "לא הובנו"');
    const noTasks = composeClosing({ dateIso: '2026-10-27', received: [], tasks: null, pending: [] });
    assert.equal(noTasks.text, `סגירה · יום שלישי 27.10\n${QUIET_RECEIVED_LINE}`);
    const flagged = composeClosing({ dateIso: '2026-10-27', received: [], tasks: [], pending: [], partial: true });
    assert.ok(!flagged.text.includes('אין משימות'));
  });
  test('פרטיות: הטקסט בנוי מהשורות שהועברו בלבד, בלי שדות אחרים של שאלה או מקור', () => {
    const secret = 'טקסט-שאלה-סודי-מומצא';
    const out = composeClosing({ dateIso: '2026-10-27', pending: [{ id: 'q', body: secret, raw_content: secret }] });
    assert.ok(!out.text.includes(secret));
    assert.ok(out.text.includes('שאלות שממתינות: שאלה אחת'));
  });
});

describe('closing-view: doneTodayLine (C-2, E6)', () => {
  test('משימות בלבד: בשם, לפי done_at עולה; כותרת ריקה = "משימה"', () => {
    const tasks = [
      { title: 'דף בהיסטוריה', done_at: '2026-10-27T15:00:00.000Z' },
      { title: '  חוברת באנגלית ', done_at: '2026-10-27T09:00:00.000Z' },
      { title: '', done_at: '2026-10-27T12:00:00.000Z' },
    ];
    assert.equal(doneTodayLine({ tasks }), 'בוצע היום: חוברת באנגלית · משימה · דף בהיסטוריה');
  });
  test('שיעורי בית בלבד: "ענית על שיעורי בית ב<מקצוע>", לפי סדר השורות (גם kind=homework)', () => {
    const answered = [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }, { kind: 'homework', subject: 'כימיה' }];
    assert.equal(doneTodayLine({ answered }), 'בוצע היום: ענית על שיעורי בית בפיזיקה · ענית על שיעורי בית בכימיה');
  });
  test('שאלות שאינן שיעורי בית: רק מספר, ביחיד וברבים; lesson_ask בלי מקצוע נספר כשאלה', () => {
    assert.equal(doneTodayLine({ answered: [{ entity_type: 'source', subject: null }] }), 'בוצע היום: ענית על שאלה אחת');
    assert.equal(doneTodayLine({ answered: [{ entity_type: 'source' }, { entity_type: 'exam_ask' }, { entity_type: 'lesson_ask', subject: ' ' }] }), 'בוצע היום: ענית על 3 שאלות');
  });
  test('מעורב: משימות, ואז שיעורי בית, ואז "ועוד" (כמו pendingLine)', () => {
    const tasks = [{ title: 'חוברת באנגלית', done_at: '2026-10-27T09:00:00.000Z' }];
    const one = doneTodayLine({ tasks, answered: [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }, { entity_type: 'source' }] });
    assert.equal(one, 'בוצע היום: חוברת באנגלית · ענית על שיעורי בית בפיזיקה · ועוד שאלה אחת');
    const many = doneTodayLine({ answered: [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }, { entity_type: 'source' }, { entity_type: 'exam_ask' }] });
    assert.equal(many, 'בוצע היום: ענית על שיעורי בית בפיזיקה · ועוד 2 שאלות');
  });
  test('ריק / לא מערך: null', () => {
    assert.equal(doneTodayLine({ tasks: [], answered: [] }), null);
    assert.equal(doneTodayLine({}), null);
    assert.equal(doneTodayLine({ tasks: null, answered: 'x' }), null);
  });
});

describe('closing-view: loadDone (שאילתות, C-2)', () => {
  const W = closingWindow('2026-10-16T18:00:00.000Z');
  test('משימות done לפי done_at בחלון, שאלות שנסגרו לפי read_at בחלון עם המקצוע מ-lesson_asks; בלי body ו-raw_content', async () => {
    const sql = fakeSql((text) => (text.includes('FROM tasks d')
      ? [{ title: 'חוברת', done_at: '2026-10-16T10:00:00.000Z' }]
      : [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }]));
    const out = await loadDone(sql, W);
    assert.deepEqual(out, { tasks: [{ title: 'חוברת', done_at: '2026-10-16T10:00:00.000Z' }], answered: [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }] });
    const [tasks, answered] = sql.calls;
    assert.match(tasks.text, /d\.status = 'done' AND d\.done_at > \?::timestamptz AND d\.done_at <= \?::timestamptz/);
    assert.match(tasks.text, /ORDER BY d\.done_at ASC, d\.id ASC/);
    assert.deepEqual(tasks.values, ['2026-10-15T18:00:00.000Z', '2026-10-16T18:00:00.000Z']);
    assert.match(answered.text, /LEFT JOIN lesson_asks la ON m\.entity_type = 'lesson_ask' AND la\.id = m\.entity_id/);
    assert.match(answered.text, /m\.kind = 'question' AND m\.awaiting_reply = false AND m\.read_at > \?::timestamptz AND m\.read_at <= \?::timestamptz/);
    assert.deepEqual(answered.values, ['2026-10-15T18:00:00.000Z', '2026-10-16T18:00:00.000Z']);
    assert.ok(sql.calls.every((c) => !c.text.includes('raw_content') && !c.text.includes('body')), 'פרטיות: לא נבחר טקסט');
  });
  test('כשל מסד נזרק (הצרכן מחליט)', async () => {
    await assert.rejects(() => loadDone(fakeSql(() => { throw new Error('db down'); }), W), /db down/);
  });
});

describe('closing-view: composeClosing עם "בוצע היום" (C-2)', () => {
  const done = { tasks: [{ title: 'חוברת באנגלית', done_at: '2026-10-27T09:00:00.000Z' }], answered: [{ entity_type: 'lesson_ask', subject: 'פיזיקה' }] };
  test('מקום השורה: אחרי "נקלט" ו"לא הובנו", לפני "מחר" ו"להגשה מחר"; done בתוצאה = מספר הפריטים', () => {
    const out = composeClosing({
      dateIso: '2026-10-27', received: ['מבחן · מתמטיקה · ראשון 1.11'], notUnderstood: 1, done,
      examLine: 'מחר: מבחן במתמטיקה ב-10:05', tasks: [{ title: 'דף', due_at: due('2026-10-28') }], pending: [],
    });
    assert.equal(out.text, [
      'סגירה · יום שלישי 27.10',
      'נקלט היום (1):',
      '· מבחן · מתמטיקה · ראשון 1.11',
      'לא הובנו: 1',
      'בוצע היום: חוברת באנגלית · ענית על שיעורי בית בפיזיקה',
      'מחר: מבחן במתמטיקה ב-10:05',
      'להגשה מחר: דף',
      'משימות פתוחות (1):',
      '· דף — עד רביעי 28.10',
    ].join('\n'));
    assert.equal(out.done, 2);
    assert.equal(out.partial, false);
  });
  test('ריק: השורה מושמטת (בלי "אין"), done=0', () => {
    const out = composeClosing({ dateIso: '2026-10-27', tasks: [{ title: 'דף' }], done: { tasks: [], answered: [] } });
    assert.ok(!out.text.includes('בוצע'));
    assert.equal(out.done, 0);
  });
  test('ערב שקט אבל משהו בוצע: לא שורת "אין משימות פתוחות ואין שאלות", אלא "לא נקלטו" ו"בוצע היום"', () => {
    const out = composeClosing({ dateIso: '2026-10-27', received: [], tasks: [], pending: [], done: { tasks: [], answered: [{ entity_type: 'source' }] } });
    assert.equal(out.text, `סגירה · יום שלישי 27.10\n${QUIET_RECEIVED_LINE}\nבוצע היום: ענית על שאלה אחת`);
    assert.ok(!out.text.includes(QUIET_EVENING_LINE));
  });
  test('null = לא נטען: השורה מושמטת, partial, ואין טענת ערב שקט; done=null', () => {
    const out = composeClosing({ dateIso: '2026-10-27', received: [], tasks: [], pending: [], done: null });
    assert.equal(out.text, `סגירה · יום שלישי 27.10\n${QUIET_RECEIVED_LINE}`);
    assert.equal(out.partial, true);
    assert.equal(out.done, null);
  });
});

describe('closing-view: closingPushText (H6, [הצעה])', () => {
  test('כל החלקים, בסדר הקבוע', () => {
    assert.equal(closingPushText({ examLine: 'מחר: מבחן במתמטיקה', reviewDue: 1, receivedCount: 3, pendingCount: 2, openTasks: 4 }),
      'מחר: מבחן במתמטיקה · סיכום היום מחכה לסימון · נקלטו 3 · 2 שאלות ממתינות · 4 משימות פתוחות');
  });
  test('יחיד: "שאלה אחת ממתינה", "משימה אחת פתוחה"', () => {
    assert.equal(closingPushText({ pendingCount: 1, openTasks: 1 }), 'שאלה אחת ממתינה · משימה אחת פתוחה');
    assert.equal(closingPushText({ receivedCount: 1 }), 'נקלטו 1');
  });
  test('ערב שבו הגיעו רק הודעות שלא הובנו: לא "יום שקט" (ביקורת C-1)', () => {
    assert.equal(closingPushText({ notUnderstoodCount: 3 }), 'לא הובנו 3');
    assert.equal(closingPushText({ receivedCount: 2, notUnderstoodCount: 1, openTasks: 2 }), 'נקלטו 2 · לא הובנו 1 · 2 משימות פתוחות');
  });
  test('אפסים מושמטים; בלי חלקים: "יום שקט"; חלקי בלי חלקים: "הסגירה של היום מחכה"', () => {
    assert.equal(closingPushText({ reviewDue: 0, receivedCount: 0, pendingCount: 0, openTasks: 0, examLine: null }), QUIET_PUSH);
    assert.equal(closingPushText(), 'יום שקט');
    assert.equal(closingPushText({ receivedCount: null, openTasks: null, partial: true }), CLOSING_PUSH_WAITING);
    assert.equal(closingPushText({ openTasks: 2, partial: true }), '2 משימות פתוחות');
  });
  test('ערכים לא תקינים נחשבים אפס', () => {
    assert.equal(closingPushText({ receivedCount: -1, pendingCount: 'x', openTasks: 2.5 }), 'יום שקט');
  });
});
