// בדיקות ל-lib/time-suggest.js (בלוק 7: הצעת שעה למשימה אישית בלי שעה, ש7 = ב', מיד; docs/02-rules/03-boundaries-rules.md כלל 10).
// בלי רשת ובלי מסד: sql מזויף, googleDay מוזרק. כל הכותרות מומצאות. ה-SQL לא רץ מול Postgres; הבדיקות מוודאות את הפרמטרים והזרימה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { captureConsole, fakeSql, jsonRequest, FAKE_SECRET } from './helpers.js';
import { pendingFromRows } from '../lib/chat-view.js';
import { handle as chatHandle } from '../api/chat.js';
import { processSource } from '../lib/intake-process.js';
import {
  TIME_SUGGEST_ENTITY, TIME_SUGGEST_BUTTONS, SLOT_MINUTES, MAX_OFFERS, openWindows, freeSlots, pickOffers, suggestText, taskKey,
  suggestTimeForTask, answerTimeSuggest,
} from '../lib/time-suggest.js';

// נובמבר 2026: ישראל UTC+2. שני 23.11 (יום ללא בית ספר ידוע כשאין מערכת שעות), שלישי 24.11, רביעי 25.11, שישי 27.11, שבת 28.11, ראשון 29.11.
const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const FRI = '2026-11-27';
const SAT = '2026-11-28';
const SUN = '2026-11-29';
const NOW = new Date('2026-11-23T07:00:00.000Z'); // שני 09:00 בישראל
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';
const TITLE = 'לקנות מתנה לאמא';
const dueAtOf = (date) => new Date(`${date}T00:00:00+02:00`).toISOString(); // 00:00 בישראל = "בלי שעה"
const min = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const busy = (items = [], over = {}) => ({ items, google: 'skipped', timetable: false, ...over });

describe('time-suggest: חלונות פתוחים (טהור)', () => {
  test('בלי מערכת שעות: ראשון עד חמישי נפתחים ב-16:00 (הסגירה המאוחרת של כלל 1) ונסגרים ב-21:30 (כלל 5)', () => {
    assert.deepEqual(openWindows({ dateIso: WED, busy: busy() }), [[min('16:00'), min('21:30')]]);
  });
  test('יום לימודים לפי מערכת השעות: מ-15:00, או רבע שעה אחרי השיעור האחרון אם מאוחר יותר', () => {
    const early = busy([{ title: 'בית ספר', start: '08:15', end: '14:15', domain: 'school' }], { timetable: true });
    assert.deepEqual(openWindows({ dateIso: MON, busy: early }), [[min('15:00'), min('21:30')]]);
    const late = busy([{ title: 'בית ספר', start: '08:15', end: '15:45', domain: 'school' }], { timetable: true });
    assert.deepEqual(openWindows({ dateIso: MON, busy: late }), [[min('16:00'), min('21:30')]]);
  });
  test('יום אימון (תחום running): רק 16:00–17:00, לפני ההתארגנות (כלל 3); הערב סגור (כלל 4); אימון שמתחיל מוקדם יותר מקצר את החלון', () => {
    const training = busy([{ title: 'אימון ריצה', start: '18:00', end: '20:00', domain: 'running' }]);
    assert.deepEqual(openWindows({ dateIso: MON, busy: training }), [[min('16:00'), min('17:00')]]);
    const early = busy([{ title: 'אימון', start: '15:00', end: '16:30', domain: 'running' }]);
    assert.deepEqual(openWindows({ dateIso: MON, busy: early }), []);
  });
  test('ראשון: הפיזיותרפיה 17:00 עד 17:45 סגורה; שלישי: נסגר ב-17:00 (כלל 6)', () => {
    assert.deepEqual(openWindows({ dateIso: SUN, busy: busy([], { timetable: true }) }), [[min('10:00'), min('17:00')], [min('17:45'), min('21:30')]]);
    const school = busy([{ title: 'בית ספר', start: '08:15', end: '14:15', domain: 'school' }], { timetable: true });
    assert.deepEqual(openWindows({ dateIso: TUE, busy: school }), [[min('15:00'), min('17:00')]]);
  });
  test('שישי: 10:00 עד 12:00 ו-16:00 עד 21:30 (כלל 7); שבת: 10:00 עד 21:30 (כלל 8)', () => {
    assert.deepEqual(openWindows({ dateIso: FRI, busy: busy() }), [[min('10:00'), min('12:00')], [min('16:00'), min('21:30')]]);
    assert.deepEqual(openWindows({ dateIso: SAT, busy: busy() }), [[min('10:00'), min('21:30')]]);
  });
});

describe('time-suggest: משבצות פנויות (טהור)', () => {
  test('משבצת של שעה בעיגול לחצי שעה, והראשונה היא המוקדמת', () => {
    const slots = freeSlots({ windows: [[min('16:00'), min('18:00')]], items: [], earliest: 0 });
    assert.deepEqual(slots, [{ start: '16:00', end: '17:00' }, { start: '17:00', end: '18:00' }]);
    assert.equal(SLOT_MINUTES, 60);
  });
  test('אירוע בחלון: מדלגים עד סופו (מעוגל קדימה), לא חופפים', () => {
    const slots = freeSlots({ windows: [[min('16:00'), min('20:00')]], items: [{ title: 'חוג', start: '16:20', end: '17:10', domain: 'personal' }], earliest: 0 });
    assert.deepEqual(slots[0], { start: '17:30', end: '18:30' });
  });
  test('אירוע בלי משך (התחלה = סוף) בתוך המשבצת חוסם אותה', () => {
    const slots = freeSlots({ windows: [[min('16:00'), min('18:00')]], items: [{ title: 'תזכורת', start: '16:30', end: '16:30', domain: 'personal' }], earliest: 0 });
    assert.deepEqual(slots, [{ start: '17:00', end: '18:00' }]);
  });
  test('earliest (היום): לא מציעים משבצת שכבר התחילה', () => {
    const slots = freeSlots({ windows: [[min('16:00'), min('21:30')]], items: [], earliest: min('17:10') });
    assert.equal(slots[0].start, '17:30');
  });
  test('חלון קצר משעה: אין משבצת', () => {
    assert.deepEqual(freeSlots({ windows: [[min('16:00'), min('16:45')]], items: [], earliest: 0 }), []);
  });
  test('pickOffers: משבצת ראשונה מכל יום קודם, עד שלוש; אחר כך משבצות נוספות באותו יום', () => {
    const days = [
      { date: MON, slots: [{ start: '16:00', end: '17:00' }, { start: '17:00', end: '18:00' }] },
      { date: TUE, slots: [{ start: '15:00', end: '16:00' }] },
    ];
    assert.deepEqual(pickOffers(days), [
      { date: MON, start: '16:00', end: '17:00' }, { date: TUE, start: '15:00', end: '16:00' }, { date: MON, start: '17:00', end: '18:00' },
    ]);
    assert.equal(MAX_OFFERS, 3);
    assert.equal(pickOffers([{ date: MON, slots: [] }]).length, 0);
  });
});

describe('time-suggest: נוסח', () => {
  test('"<משימה> — <יום> <שעה>?": היום, מחר, או שם היום עם התאריך', () => {
    assert.equal(suggestText({ title: TITLE, date: MON, start: '16:00', today: MON }), `${TITLE} — היום 16:00?`);
    assert.equal(suggestText({ title: TITLE, date: TUE, start: '15:30', today: MON }), `${TITLE} — מחר 15:30?`);
    assert.equal(suggestText({ title: TITLE, date: WED, start: '16:00', today: MON }), `${TITLE} — רביעי 25.11 16:00?`);
  });
  test('שלושה כפתורים: כן / שעה אחרת / לא', () => {
    assert.deepEqual([...TIME_SUGGEST_BUTTONS], ['כן', 'שעה אחרת', 'לא']);
    assert.equal(taskKey(TASK_ID), `source:task:${TASK_ID}`);
  });
});

// ---------------------------------------------------------------------------
// יצירת ההצעה
// ---------------------------------------------------------------------------
const noGoogle = async () => ({ ok: true, events: [] }); // Google נבדק ופנוי
const task = (over = {}) => ({ id: TASK_ID, title: TITLE, dueAt: dueAtOf(WED), timed: false, ...over });
const writeRows = (text) => (text.includes('time-suggest-create') ? [{ message_id: MSG_ID }] : []);

describe('time-suggest: suggestTimeForTask', () => {
  test('משימה עם תאריך ובלי שעה: כרטיס אחד עם ההצעה הראשונה; העובדות והחלופות נשמרות; הכרטיס פג בתחילת המשבצת', async () => {
    const sql = fakeSql(writeRows);
    const out = await suggestTimeForTask({ sql, task: task(), now: NOW, timetable: null, googleDay: noGoogle });
    assert.deepEqual(out, { created: true, messageId: MSG_ID });
    const [call] = sql.find('time-suggest-create');
    assert.ok(call.values.includes(`${TITLE} — היום 16:00?`));
    assert.ok(call.values.includes(TIME_SUGGEST_ENTITY));
    assert.ok(call.values.includes(new Date('2026-11-23T14:00:00.000Z').toISOString())); // 16:00 בישראל
    const facts = JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
    const get = (field) => facts.find((f) => f.field === field)?.value;
    assert.equal(get('task'), TASK_ID);
    assert.equal(get('date'), MON);
    assert.equal(get('start'), '16:00');
    assert.equal(get('end'), '17:00');
    const alts = JSON.parse(get('alts'));
    assert.equal(alts.length, MAX_OFFERS - 1);
    assert.deepEqual(alts[0], { date: TUE, start: '16:00', end: '17:00' });
  });
  test('משימה שכבר יש לה שעה, בלי תאריך, או שתאריכה עבר: לא נוצר כלום', async () => {
    for (const bad of [task({ timed: true }), task({ dueAt: null }), task({ dueAt: dueAtOf('2026-11-20') }), task({ id: 'not-a-uuid' })]) {
      const sql = fakeSql(writeRows);
      assert.deepEqual(await suggestTimeForTask({ sql, task: bad, now: NOW, timetable: null, googleDay: noGoogle }), { created: false });
      assert.equal(sql.calls.length, 0);
    }
  });
  test('אין חלון פנוי עד היעד: לא נוצר כרטיס (השתיקה = נשארת משימה, כלל 10ג)', async () => {
    const sql = fakeSql(writeRows);
    const out = await suggestTimeForTask({ sql, task: task({ dueAt: dueAtOf(MON) }), now: new Date('2026-11-23T18:30:00.000Z'), timetable: null, googleDay: noGoogle });
    assert.deepEqual(out, { created: false });
    assert.equal(sql.find('time-suggest-create').length, 0);
  });
  test('היעד רחוק: מחפשים לכל היותר שבעה ימים קדימה', async () => {
    const sql = fakeSql(writeRows);
    await suggestTimeForTask({ sql, task: task({ dueAt: dueAtOf('2026-12-31') }), now: NOW, timetable: null, googleDay: noGoogle });
    const days = sql.find('FROM events e').length;
    assert.ok(days >= 1 && days <= 7);
  });
  test('יום אימון (running 18:00): מציעים 16:00–17:00 באותו יום, לא את הערב (כללים 3 ו-4)', async () => {
    const sql = fakeSql((text, values) => {
      if (text.includes('FROM events e')) {
        const from = values[1];
        return String(from).startsWith('2026-11-22T22') ? [{ title: 'אימון ריצה', starts_at: '2026-11-23T16:00:00.000Z', ends_at: '2026-11-23T18:00:00.000Z', domain: 'running', external_id: null }] : [];
      }
      return writeRows(text);
    });
    await suggestTimeForTask({ sql, task: task(), now: NOW, timetable: null, googleDay: noGoogle });
    const [call] = sql.find('time-suggest-create');
    const facts = JSON.parse(call.values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
    assert.equal(facts.find((f) => f.field === 'date').value, MON);
    assert.equal(facts.find((f) => f.field === 'start').value, '16:00');
    assert.equal(facts.find((f) => f.field === 'end').value, '17:00');
  });
  test('Google נכשל / לא הוגדר / חריגת זמן: אין כרטיס, והלוג מכיל קוד בלבד', async (t) => {
    const log = captureConsole(t);
    for (const googleDay of [async () => ({ ok: false, reason: 'x' }), undefined]) {
      const sql = fakeSql(writeRows);
      assert.deepEqual(await suggestTimeForTask({ sql, task: task(), now: NOW, timetable: null, googleDay }), { created: false });
      assert.equal(sql.find('time-suggest-create').length, 0);
    }
    assert.ok(log.text().includes('google_failed') && log.text().includes('google_skipped'));
    const slow = fakeSql(writeRows);
    const hang = () => new Promise(() => {});
    const out = await suggestTimeForTask({ sql: slow, task: task(), now: NOW, timetable: null, googleDay: hang, timeoutMs: 20 });
    assert.deepEqual(out, { created: false });
    assert.ok(log.text().includes('timeout'));
    assert.ok(!log.text().includes(TITLE));
  });
  test('הימים נקראים במקביל: כל השאילתות יוצאות לפני שאחת מהן חוזרת', async () => {
    let inFlight = 0;
    let peak = 0;
    const googleDay = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      return { ok: true, events: [] };
    };
    await suggestTimeForTask({ sql: fakeSql(writeRows), task: task({ dueAt: dueAtOf('2026-12-31') }), now: NOW, timetable: null, googleDay });
    assert.equal(peak, 7);
  });
  test('כשל מסד לא נזרק: created=false ושם השגיאה בלבד בלוג', async (t) => {
    const log = captureConsole(t);
    const sql = fakeSql(() => { throw Object.assign(new Error('secret-detail'), { name: 'NeonDbError' }); });
    assert.deepEqual(await suggestTimeForTask({ sql, task: task(), now: NOW, timetable: null, googleDay: noGoogle }), { created: false });
    assert.ok(log.text().includes('NeonDbError'));
    assert.ok(!log.text().includes('secret-detail'));
    assert.ok(!log.text().includes(TITLE));
  });
});

// ---------------------------------------------------------------------------
// תשובה
// ---------------------------------------------------------------------------
const ALT = [{ date: TUE, start: '16:00', end: '17:00' }, { date: WED, start: '16:00', end: '17:00' }];
const askRow = (over = {}) => ({
  id: MSG_ID, awaiting_reply: true, card_id: CARD_ID, task_id: TASK_ID, slot_date: MON, slot_start: '16:00', slot_end: '17:00', alts: JSON.stringify(ALT), ...over,
});
const taskRow = (over = {}) => ({ id: TASK_ID, title: TITLE, status: 'open', due_at: dueAtOf(WED), ...over });
function answerSql({ ask = askRow(), taskRows = [taskRow()], written = { closed: 1, answer_source_id: 'a1', bubble_id: 'b1', events: 1 }, busyRows = [] } = {}) {
  return fakeSql((text) => {
    if (text.includes('time-suggest-ask')) return ask ? [ask] : [];
    if (text.includes('time-suggest-task')) return taskRows;
    if (text.includes('time-suggest-write')) return [written];
    if (text.includes('FROM events e')) return busyRows;
    return [];
  });
}
const writeValues = (sql) => sql.find('time-suggest-write')[0].values;

describe('time-suggest: answerTimeSuggest', () => {
  test('"כן": שעת המשימה נקבעת (scheduled_at), אירוע נכתב ליומן "אישי" (מפתח source:task:<id>), והבועה נאמרת', async () => {
    const sql = answerSql();
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'כן', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, [taskKey(TASK_ID)]);
    assert.deepEqual(out.created, { answerSourceId: 'a1', bubbleId: 'b1' });
    const values = writeValues(sql);
    assert.ok(values.includes(new Date('2026-11-23T14:00:00.000Z').toISOString())); // scheduled_at = 16:00 בישראל
    assert.ok(values.includes(new Date('2026-11-23T15:00:00.000Z').toISOString())); // סוף
    assert.ok(values.includes(taskKey(TASK_ID)));
    assert.ok(values.includes(TITLE));
    assert.ok(values.some((v) => typeof v === 'string' && v.startsWith('נקבע') && v.includes(TITLE) && v.includes('16:00')));
    const text = sql.find('time-suggest-write')[0].text;
    assert.match(text, /UPDATE tasks SET scheduled_at/);
    assert.match(text, /INSERT INTO events/);
    assert.match(text, /'personal'/);
    assert.ok(!/due_at\s*=/.test(text), 'due_at (היעד) לא משתנה');
  });
  test('"כן" כשהחלון נתפס בינתיים (אירוע חופף): לא נכתב אירוע; ההצעה הבאה נשאלת', async () => {
    const sql = answerSql({ busyRows: [{ title: 'חוג', starts_at: '2026-11-23T14:30:00.000Z', ends_at: '2026-11-23T15:30:00.000Z', domain: 'personal', external_id: null }] });
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'כן', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
    const values = writeValues(sql);
    assert.ok(values.some((v) => typeof v === 'string' && v.includes('— מחר 16:00?')));
    assert.ok(values.some((v) => typeof v === 'string' && v.includes('נתפס בינתיים')));
  });
  test('"שעה אחרת": הכרטיס נסגר וההצעה הבאה מהחלופות נשאלת בכרטיס חדש, בלי כתיבה ליומן', async () => {
    const sql = answerSql();
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'שעה אחרת', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
    const values = writeValues(sql);
    assert.ok(values.includes(`${TITLE} — מחר 16:00?`));
    const facts = JSON.parse(values.find((v) => typeof v === 'string' && v.startsWith('[{"field"')));
    assert.equal(JSON.parse(facts.find((f) => f.field === 'alts').value).length, 1);
  });
  test('"שעה אחרת" בלי חלופות: הכרטיס נסגר, בועה, והמשימה נשארת בלי שעה', async () => {
    const sql = answerSql({ ask: askRow({ alts: '[]' }) });
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'שעה אחרת', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    const values = writeValues(sql);
    assert.ok(values.some((v) => typeof v === 'string' && v.includes('אין עוד חלונות') && v.includes(TITLE)));
    assert.ok(!values.some((v) => typeof v === 'string' && v.includes('— ') && v.endsWith('?')));
  });
  test('"לא": נסגר, נשארת בלי שעה, בלי אירוע', async () => {
    const sql = answerSql();
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'לא', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
    const values = writeValues(sql);
    assert.ok(values.some((v) => typeof v === 'string' && v.startsWith('נשארת')));
    assert.ok(!values.includes(new Date('2026-11-23T14:00:00.000Z').toISOString()), 'שעה לא נקבעת');
  });
  test('"כן" כש-Google לא נבדק: לא נכתב אירוע ולא נקבעת שעה; בועת "לא הצלחתי לבדוק"', async () => {
    const sql = answerSql();
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'כן', now: NOW, timetable: null, googleDay: async () => ({ ok: false }) });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
    const values = writeValues(sql);
    assert.ok(values.some((v) => typeof v === 'string' && v.startsWith('לא הצלחתי לבדוק את היומן עכשיו, נשאר בלי שעה')));
    assert.ok(!values.includes(new Date('2026-11-23T14:00:00.000Z').toISOString()));
  });
  test('משימה שכבר נסגרה (בוצעה): הכרטיס נסגר בלי אירוע', async () => {
    const sql = answerSql({ taskRows: [taskRow({ status: 'done' })] });
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'כן', now: NOW, timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'answered');
    assert.deepEqual(out.keys, []);
  });
  test('משבצת שכבר עברה: כמו "שעה אחרת"', async () => {
    const sql = answerSql();
    const out = await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'כן', now: new Date('2026-11-23T14:30:00.000Z'), timetable: null, googleDay: noGoogle });
    assert.deepEqual(out.keys, []);
    assert.ok(writeValues(sql).some((v) => typeof v === 'string' && v.includes('— מחר 16:00?')));
  });
  test('תשובה אחרת = unclear; שאלה סגורה / לא קיימת / לחיצה מקבילה = closed; לא נכתב כלום', async () => {
    assert.equal((await answerTimeSuggest({ sql: answerSql(), messageId: MSG_ID, answer: 'אולי', now: NOW })).status, 'unclear');
    assert.equal((await answerTimeSuggest({ sql: answerSql({ ask: askRow({ awaiting_reply: false }) }), messageId: MSG_ID, answer: 'כן', now: NOW })).status, 'closed');
    const none = answerSql({ ask: null });
    assert.equal((await answerTimeSuggest({ sql: none, messageId: MSG_ID, answer: 'כן', now: NOW })).status, 'closed');
    assert.equal(none.find('time-suggest-write').length, 0);
    assert.equal((await answerTimeSuggest({ sql: answerSql({ written: { closed: 0 } }), messageId: MSG_ID, answer: 'לא', now: NOW })).status, 'closed');
  });
  test('העובדות נקראות מ-facts לפי entity_type time_suggest', async () => {
    const sql = answerSql();
    await answerTimeSuggest({ sql, messageId: MSG_ID, answer: 'לא', now: NOW });
    assert.ok(sql.find('time-suggest-ask')[0].values.includes(TIME_SUGGEST_ENTITY));
  });
});

// ---------------------------------------------------------------------------
// הצ'אט
// ---------------------------------------------------------------------------
describe('time-suggest: בצ\'אט', () => {
  test('pendingFromRows: כרטיס עם שלושה כפתורים, בלי תיבת כתיבה', () => {
    const list = pendingFromRows({ questions: [{ id: MSG_ID, body: `${TITLE} — היום 16:00?`, sent_at: '2026-11-23T07:00:00.000Z', entity_type: TIME_SUGGEST_ENTITY }], facts: [], timetable: null, today: MON });
    assert.deepEqual(list, [{ id: MSG_ID, kind: 'time_suggest', at: '2026-11-23T07:00:00.000Z', text: `${TITLE} — היום 16:00?`, buttons: ['כן', 'שעה אחרת', 'לא'], allowFreeText: false }]);
  });

  const H = { 'x-intake-secret': FAKE_SECRET };
  const call = (answer, extra) => chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer }, { headers: H, url: 'https://x.test/api/chat' }), {
    sql: answerSql(), secret: FAKE_SECRET, timetable: null, now: () => NOW, googleDay: noGoogle, ...extra,
  });
  test('answer "כן": עובר ל-answerTimeSuggest, והאירוע נכתב ליומן לפי המפתח', async () => {
    const synced = [];
    const res = await call('כן', { keysSync: async (args) => { synced.push(args); return { created: 1 }; } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'answered');
    assert.deepEqual(synced.map((s) => [s.keys, s.patchKeys]), [[[taskKey(TASK_ID)], []]]);
  });
  test('answer "לא": בלי כתיבה ליומן', async () => {
    const synced = [];
    assert.equal((await (await call('לא', { keysSync: async (args) => { synced.push(args); return {}; } })).json()).status, 'answered');
    assert.deepEqual(synced, []);
  });
  test('כשל בכתיבה ליומן לא משנה את התשובה', async (t) => {
    captureConsole(t);
    const body = await (await call('כן', { keysSync: async () => { throw new Error('x'); } })).json();
    assert.equal(body.status, 'answered');
  });
});

// ---------------------------------------------------------------------------
// חיבור: הצינור (lib/intake-process.js) ו"עד מתי?" (api/chat.js)
// ---------------------------------------------------------------------------
describe('time-suggest: חיבור', () => {
  const SATURDAY_NOON = new Date('2026-11-21T12:00:00Z'); // שבת 14:00 בישראל
  const SRC_ID = '44444444-4444-4444-8444-444444444444';
  const typed = (text) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: 'h', received_at: SATURDAY_NOON });
  const pipelineSql = () => fakeSql((text) => {
    if (text.startsWith('WITH claim AS') && text.includes('INSERT INTO tasks')) return [{ claimed: 1, task_id: TASK_ID }];
    if (text.includes('time-suggest-create')) return [{ message_id: MSG_ID }];
    return [];
  });
  test('משימה עם תאריך ובלי שעה: ההצעה נוצרת מיד אחרי הרישום, עם כותרת המשימה', async (t) => {
    // processSource לא מקבל now, וההצעה מחושבת מול השעון האמיתי. בלי קיבוע: ביום שלישי "עד שלישי" כבר עבר והבדיקה נכשלת.
    t.mock.timers.enable({ apis: ['Date'], now: SATURDAY_NOON });
    const sql = pipelineSql();
    const out = await processSource({ sql, source: typed('להכין מצגת בהיסטוריה עד שלישי'), timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'recorded');
    const [call] = sql.find('time-suggest-create');
    assert.ok(call, 'נוצר כרטיס');
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith('להכין מצגת בהיסטוריה — ') && v.endsWith('?')));
  });
  test('משימה בלי תאריך: קודם "עד מתי?", בלי הצעה; משימה עם שעה ברורה: בלי הצעה', async () => {
    const noDate = pipelineSql();
    await processSource({ sql: noDate, source: typed('להביא חוברת'), timetable: null, googleDay: noGoogle });
    assert.equal(noDate.find('time-suggest-create').length, 0);
    const timed = pipelineSql();
    await processSource({ sql: timed, source: typed('לשלוח מייל עד יום שני ב-17:00'), timetable: null, googleDay: noGoogle });
    assert.equal(timed.find('time-suggest-create').length, 0);
  });
  test('כשל בהצעה לא משנה את תוצאת הרישום', async (t) => {
    captureConsole(t);
    t.mock.timers.enable({ apis: ['Date'], now: SATURDAY_NOON }); // בלי קיבוע: ביום שלישי ההצעה לא מגיעה לשליפה שזורקת
    let reached = false;
    const sql = fakeSql((text) => {
      if (text.startsWith('WITH claim AS') && text.includes('INSERT INTO tasks')) return [{ claimed: 1, task_id: TASK_ID }];
      if (text.includes('FROM events e')) { reached = true; throw Object.assign(new Error('x'), { name: 'NeonDbError' }); }
      return [];
    });
    const out = await processSource({ sql, source: typed('להכין מצגת בהיסטוריה עד שלישי'), timetable: null, googleDay: noGoogle });
    assert.equal(out.status, 'recorded');
    assert.ok(reached, 'ההצעה הגיעה לשליפה שנכשלה');
  });
  test('api/chat.js: תשובה "מחר" ל"עד מתי?" (בלי שעה) מציעה חלון, והכותרת נטענת מהמסד', async () => {
    const sql = fakeSql((text) => {
      if (text.includes('JOIN tasks t ON t.id = m.entity_id')) return [{ id: MSG_ID, awaiting_reply: true, entity_type: 'task', task_id: TASK_ID, title: TITLE, status: 'open' }];
      if (text.startsWith('WITH closed AS') && text.includes('INSERT INTO sources')) return [{ closed: 1, answer_source_id: 'a', bubble_id: 'b' }];
      if (text.includes('time-suggest-title')) return [{ title: TITLE }];
      if (text.includes('time-suggest-create')) return [{ message_id: MSG_ID }];
      return [];
    });
    const res = await chatHandle(jsonRequest({ action: 'answer', message_id: MSG_ID, answer: 'מחר' }, { headers: { 'x-intake-secret': FAKE_SECRET } }), {
      sql, secret: FAKE_SECRET, timetable: null, now: () => SATURDAY_NOON, eventSync: async () => ({}), googleDay: noGoogle,
    });
    assert.equal((await res.json()).status, 'answered');
    const [call] = sql.find('time-suggest-create');
    assert.ok(call.values.some((v) => typeof v === 'string' && v.startsWith(`${TITLE} — `)));
  });
});
