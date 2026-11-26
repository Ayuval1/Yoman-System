// שעה שנאמרת בהודעה מאוחרת על אירוע של יום שלם או כמה ימים (problem-log 25.11.2026, "נשאר פתוח"):
// "ב-3.12 יש לי טיול" נרשם כיום שלם; אחר כך "הטיול ב-3.12 מתחיל ב-8:00" הופך אותו לאירוע עם שעות (והשעה לא נשכחת).
// בלי רשת ובלי מסד: sql ו-fetch מזויפים. ה-SQL לא הורץ מול Postgres, ו-PATCH ל-Google לא נבדק מול Google אמיתי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fakeSql, fakeFetch, jsonResponse } from './helpers.js';
import { readChange, targetFor, decideMatch, updateReply, writeMatched, pendingPayload, answerEventMatch, MATCH_YES } from '../lib/event-match.js';
import { processSource } from '../lib/intake-process.js';
import { patchBody, eventBody, syncEventForSource } from '../lib/event-sync.js';
import { TOKEN_ENDPOINT, CALENDAR_LIST_ENDPOINT } from '../lib/google.js';
import { CONFIG, ACCESS_TOKEN, encRefresh } from './google-fixtures.js';

const NOW = new Date('2026-11-26T08:00:00Z'); // חמישי 26.11, 10:00 בישראל
const EV = 'cccccccc-1111-4111-8111-111111111111';
const SRC = '11111111-1111-4111-8111-111111111111';
const SRC_NEW = '33333333-3333-4333-8333-333333333333';
const MSG_ID = '22222222-2222-4222-8222-222222222222';
const fx = (field, value, origin = 'read') => ({ field, value, origin });

const ONE_DAY = { id: EV, title: 'טיול', date: '2026-12-03', time: '00:00', endDate: '2026-12-03', domain: 'personal', sourceId: SRC };
const MULTI = { id: EV, title: 'טיול', date: '2026-12-03', time: '00:00', endDate: '2026-12-05', domain: 'personal', sourceId: SRC };
const changeOf = (type, text, facts = [], understanding = null) => readChange({ type, facts, text, receivedAt: NOW, understanding });

describe('targetFor: אירוע של יום שלם שמקבל שעה', () => {
  test('יום אחד, שעה אחת: התחלה בשעה, סוף שעה אחרי (ברירת המחדל של אירוע חדש)', () => {
    const target = targetFor(ONE_DAY, changeOf('personal_event', 'הטיול ב-3.12 מתחיל ב-8:00', [fx('date', '2026-12-03'), fx('time', '08:00')]));
    assert.deepEqual(target, { cancel: false, date: '2026-12-03', time: '08:00', endTime: '09:00', toTimed: true, endsOn: { date: '2026-12-03', time: '09:00' }, same: false });
  });
  test('"מתחיל ב-8" (הגב, move): אותו דבר', () => {
    const target = targetFor(ONE_DAY, changeOf('move', 'מתחיל ב-8'));
    assert.equal(target.toTimed, true);
    assert.equal(target.time, '08:00');
    assert.deepEqual(target.endsOn, { date: '2026-12-03', time: '09:00' });
  });
  test('יום אחד עם אורך (duration_text): הסוף לפי האורך', () => {
    const change = changeOf('personal_event', 'הטיול ב-3.12 מתחיל ב-8:00 וזה שעתיים', [fx('date', '2026-12-03'), fx('time', '08:00')], { date_text: 'ב-3.12', duration_text: 'שעתיים' });
    assert.deepEqual(targetFor(ONE_DAY, change).endsOn, { date: '2026-12-03', time: '10:00' });
  });
  test('יום אחד עם שתי שעות בהודעה: ההתחלה הראשונה, הסוף השנייה', () => {
    const target = targetFor(ONE_DAY, changeOf('move', 'הטיול מ-8:00 עד 16:00'));
    assert.equal(target.time, '08:00');
    assert.deepEqual(target.endsOn, { date: '2026-12-03', time: '16:00' });
  });
  test('יום אחד: שעת סיום מוקדמת מההתחלה נזרקת, ברירת המחדל', () => {
    const target = targetFor(ONE_DAY, { cancel: false, date: null, times: ['16:00', '08:00'], unclear: false });
    assert.deepEqual(target.endsOn, { date: '2026-12-03', time: '17:00' });
  });
  test('יום אחד: שעת סיום מפורשת בעובדות (end_time שנקרא, לא הנחה) משמשת', () => {
    const change = changeOf('personal_event', 'הטיול ב-3.12 מ-8:00 עד 15:00', [fx('date', '2026-12-03'), fx('time', '08:00'), fx('end_time', '15:00')]);
    assert.equal(change.endTime, '15:00');
    assert.deepEqual(targetFor(ONE_DAY, change).endsOn, { date: '2026-12-03', time: '15:00' });
  });
  test('end_time שהוסק (שעה אחרי ההתחלה) לא נחשב סיום מפורש', () => {
    const change = changeOf('personal_event', 'הטיול ב-3.12 ב-8:00', [fx('date', '2026-12-03'), fx('time', '08:00'), fx('end_time', '09:00', 'inferred')]);
    assert.equal(change.endTime, undefined);
  });
  test('מ-23:00: הסוף 23:59 (כמו אירוע חדש)', () => {
    assert.deepEqual(targetFor(ONE_DAY, { cancel: false, date: null, times: ['23:00'], unclear: false }).endsOn, { date: '2026-12-03', time: '23:59' });
  });
  test('כמה ימים: התחלה בשעה ביום הראשון, הסוף נשאר סוף היום האחרון (00:00 שאחריו)', () => {
    const target = targetFor(MULTI, changeOf('move', 'יוצאים ב-7:00'));
    assert.equal(target.toTimed, true);
    assert.equal(target.date, '2026-12-03');
    assert.equal(target.time, '07:00');
    assert.deepEqual(target.endsOn, { date: '2026-12-06', time: '00:00' });
    assert.equal(target.same, false);
  });
  test('כמה ימים עם שעת חזרה: הסוף ביום האחרון בשעה הזאת', () => {
    const target = targetFor(MULTI, changeOf('move', 'יוצאים ב-7:00 וחוזרים ב-20:00'));
    assert.equal(target.time, '07:00');
    assert.deepEqual(target.endsOn, { date: '2026-12-05', time: '20:00' });
  });
  test('כמה ימים עם תאריך חדש והשעה: כל הטווח זז', () => {
    const target = targetFor(MULTI, { cancel: false, date: '2026-12-10', times: ['07:00'], unclear: false });
    assert.equal(target.date, '2026-12-10');
    assert.deepEqual(target.endsOn, { date: '2026-12-13', time: '00:00' });
  });
  test('יותר משתי שעות, או שעה עמומה: אין יעד', () => {
    assert.equal(targetFor(ONE_DAY, { cancel: false, date: null, times: ['08:00', '09:00', '10:00'], unclear: false }), null);
    assert.equal(targetFor(ONE_DAY, { cancel: false, date: null, times: ['08:00'], unclear: true }), null);
  });
  test('"מגיע 15 דקות קודם": בלי שעה ובלי אורך, האירוע נשאר יום שלם', () => {
    const change = changeOf('personal_event', 'בטיול ב-3.12 אני מגיע 15 דקות קודם', [fx('date', '2026-12-03')], { date_text: 'ב-3.12', duration_text: null });
    assert.deepEqual(change.times, []);
    const target = targetFor(ONE_DAY, change);
    assert.equal(target.toTimed, undefined);
    assert.equal(target.endsOn, undefined);
    assert.equal(target.same, true);
  });
  test('אורך בלי שעה על יום שלם: לא הופך לאירוע עם שעות', () => {
    const target = targetFor(ONE_DAY, { cancel: false, date: null, times: [], unclear: false, minutes: 30 });
    assert.equal(target.toTimed, undefined);
  });
  test('הזזה ללא שעה של אירוע של כמה ימים: כמו קודם', () => {
    assert.deepEqual(targetFor(MULTI, { cancel: false, date: '2026-12-10', times: [], unclear: false }), { cancel: false, date: '2026-12-10', time: '00:00', same: false });
  });
  test('אירוע עם שעות שזז: לא השתנה', () => {
    const barber = { id: EV, title: 'תור', date: '2026-12-03', time: '17:00', domain: 'personal', sourceId: SRC };
    assert.deepEqual(targetFor(barber, { cancel: false, date: null, times: ['18:00'], unclear: false }), { cancel: false, date: '2026-12-03', time: '18:00', same: false });
  });
});

describe('הזזה בימים או יחידת זמן אינה שעה (26.11.2026, ממצא הבודק)', () => {
  const SHIFTS = ['הטיול נדחה ב-3 ימים', 'הטיול זז ב-2 ימים', 'הטיול הוקדם ב-2 ימים', 'הטיול נדחה ב-5 ימים', 'הטיול זז ב-4', 'הטיול הוזז ב-3 שבועות', 'הטיול נדחה ב-3 שעות', 'הטיול נדחה ב-10 דקות', 'הטיול נדחה ב 3 ימים'];
  for (const text of SHIFTS) {
    test(`readChange (time_text null): "${text}" בלי שעה`, () => {
      const change = changeOf('move', text, [fx('new_date', '2026-12-06')], { kind: 'move', time_text: null, new_date_text: 'ב-3 ימים' });
      assert.deepEqual(change.times, []);
    });
  }
  test('יום שלם שנדחה ב-3 ימים: הזזה של יום שלם בלבד, לא toTimed ולא 03:00', () => {
    const change = changeOf('move', 'הטיול נדחה ב-3 ימים', [fx('new_date', '2026-12-06')], { kind: 'move', time_text: null });
    const target = targetFor(ONE_DAY, change);
    assert.deepEqual(target, { cancel: false, date: '2026-12-06', time: '00:00', same: false });
    assert.equal(targetFor(MULTI, change).toTimed, undefined);
  });
  test('אירוע עם שעות שנדחה ב-3 ימים: השעה נשארת (לא 03:00)', () => {
    const barber = { id: EV, title: 'תור', date: '2026-12-03', time: '17:00', domain: 'personal', sourceId: SRC };
    const change = changeOf('move', 'התור נדחה ב-3 ימים', [fx('new_date', '2026-12-06')], { kind: 'move', time_text: null });
    assert.deepEqual(targetFor(barber, change), { cancel: false, date: '2026-12-06', time: '17:00', same: false });
  });
  test('שעה אמיתית לא נפגעת: "נדחה ל-18:00", "זז ב-4:00", "מתחיל ב-8", "ב-3 הטיול מתחיל ב-8:00"', () => {
    assert.deepEqual(changeOf('move', 'התור נדחה ל-18:00').times, ['18:00']);
    assert.deepEqual(changeOf('move', 'התור זז ב-4:00').times, ['04:00']);
    assert.deepEqual(changeOf('move', 'מתחיל ב-8').times, ['08:00']);
    assert.deepEqual(changeOf('move', 'הטיול ב-3 לחודש מתחיל ב-8:00').times, ['08:00']);
  });
});

describe('decideMatch והבועה', () => {
  test('"הגב" על האירוע של יום שלם עם שעה: עדכון, והבועה מציגה את השעה', () => {
    const change = changeOf('move', 'מתחיל ב-8');
    const decision = decideMatch({ pool: [], replyEvent: ONE_DAY, text: 'מתחיל ב-8', type: 'move', change, today: '2026-11-26' });
    assert.equal(decision.kind, 'update');
    assert.equal(updateReply(ONE_DAY, decision.target), 'עודכן · טיול · חמישי 3.12 · 08:00–09:00');
  });
  test('כמה ימים: הבועה עם שעת ההתחלה', () => {
    const target = targetFor(MULTI, changeOf('move', 'יוצאים ב-7:00'));
    assert.equal(updateReply(MULTI, target), 'עודכן · טיול · חמישי 3.12 · 07:00');
  });
  test('מוח בטוח: הטיול ב-3.12 מתחיל ב-8:00 מעדכן את אירוע היום השלם', () => {
    const text = 'הטיול ב-3.12 מתחיל ב-8:00';
    const change = changeOf('personal_event', text, [fx('date', '2026-12-03'), fx('time', '08:00')], { date_text: 'ב-3.12' });
    const decision = decideMatch({ pool: [ONE_DAY], text, type: 'personal_event', change, today: '2026-11-26', brain: { key: 'e1', sure: true } });
    assert.equal(decision.kind, 'update');
    assert.equal(decision.target.toTimed, true);
  });
});

describe('writeMatched: ההתחלה והסיום נכתבים עם שעות', () => {
  const run = async (candidate, target) => {
    const sql = fakeSql(() => [{ claimed: 1, updated: 1, bubble_id: 'b' }]);
    const written = await writeMatched({ sql, sourceId: SRC_NEW, candidate, target, facts: [], certainty: 'certain', bubble: 'עודכן' });
    return { call: sql.calls[0], written };
  };
  test('יום אחד: התחלה 08:00 וסוף 09:00 (לא 00:00), ו-toTimed חוזר', async () => {
    const target = targetFor(ONE_DAY, changeOf('move', 'מתחיל ב-8'));
    const { call, written } = await run(ONE_DAY, target);
    assert.ok(call.values.includes('08:00'));
    assert.ok(call.values.includes('09:00'));
    assert.ok(!call.values.includes('00:00'), 'ההתחלה לא נשארת 00:00');
    assert.equal(written.toTimed, true);
  });
  test('כמה ימים: התחלה 07:00 ביום הראשון, סוף 6.12 00:00 (סוף היום האחרון)', async () => {
    const target = targetFor(MULTI, changeOf('move', 'יוצאים ב-7:00'));
    const { call } = await run(MULTI, target);
    assert.ok(call.values.includes('07:00'));
    assert.ok(call.values.includes('2026-12-06'));
    assert.ok(call.values.includes('00:00'));
  });
  test('הזזה רגילה של יום שלם (בלי שעה): בלי toTimed', async () => {
    const { written } = await run(MULTI, { cancel: false, date: '2026-12-10', time: '00:00', same: false });
    assert.equal(written.toTimed, false);
  });
});

describe('processSource: "הגב" על הודעת הטיול', () => {
  const typed = (text) => ({ id: SRC_NEW, channel: 'app', raw_content: text, content_hash: 'h', received_at: NOW });
  const allDayRow = (end) => ({ id: EV, title: 'טיול', domain: 'personal', match_key: `source:${SRC}`, start_date: '2026-12-03', start_time: '00:00', end_date: end, end_time: '00:00' });
  const replyDb = (end) => fakeSql((text) => {
    if (text.includes('WITH s AS ( SELECT CASE WHEN')) return [allDayRow(end)];
    if (text.includes('WITH claim AS')) return [{ claimed: 1, updated: 1, bubble_id: 'b' }];
    return [];
  });
  // בלי מוח ההודעה "מתחיל ב-8" אינה מסווגת לסוג (המסלול הקיים: "התקבל"); המוח מכריע שזה עדכון של האירוע.
  const brain = (timeText, date = null) => async () => ({ ok: true, model: 'm', understanding: { kind: 'personal_event', subject: null, topic: null, date_text: date, new_date_text: null, time_text: timeText, new_room: null, uncertain: [], match: null, match_sure: false, duration_text: null } });
  test('"מתחיל ב-8" על טיול של יום אחד: מתעדכן עם שעה, ו-matched מסמן toTimed', async () => {
    const sql = replyDb('2026-12-04');
    const result = await processSource({ sql, source: typed('מתחיל ב-8'), timetable: null, understand: brain('ב-8'), replyTo: { id: MSG_ID, role: 'system' } });
    assert.equal(result.reply, 'עודכן · טיול · חמישי 3.12 · 08:00–09:00');
    assert.deepEqual(result.matched, { sourceId: SRC, toTimed: true });
  });
  test('"יוצאים ב-7:00" על טיול של שלושה ימים', async () => {
    const sql = replyDb('2026-12-06');
    const result = await processSource({ sql, source: typed('יוצאים ב-7:00'), timetable: null, understand: brain('ב-7:00'), replyTo: { id: MSG_ID, role: 'system' } });
    assert.equal(result.reply, 'עודכן · טיול · חמישי 3.12 · 07:00');
    assert.deepEqual(result.matched, { sourceId: SRC, toTimed: true });
  });
  test('"מגיע 15 דקות קודם": אין שעה, האירוע לא משתנה ולא נכתב כאירוע עם שעות', async () => {
    const sql = replyDb('2026-12-04');
    const result = await processSource({ sql, source: typed('מגיע 15 דקות קודם'), timetable: null, understand: brain(null), replyTo: { id: MSG_ID, role: 'system' } });
    assert.notEqual(result.matched?.toTimed, true);
    assert.equal(sql.find('WITH claim AS').filter((c) => c.values.includes('08:00')).length, 0);
  });
});

describe('אחרי "כן" בשאלת זיהוי', () => {
  test('target עם toTimed נשמר בשאלה, והתשובה "כן" מחזירה matched.toTimed', async () => {
    const target = targetFor(ONE_DAY, changeOf('personal_event', 'הטיול ב-3.12 מתחיל ב-8:00', [fx('date', '2026-12-03'), fx('time', '08:00')]));
    const payload = pendingPayload({ options: [{ candidate: ONE_DAY, target }], type: 'personal_event', facts: [fx('date', '2026-12-03')], certainty: 'probable', understanding: null });
    const sql = fakeSql((text) => {
      if (text.includes("m.entity_type = 'event_match'") && text.includes('FROM messages m')) return [{ id: MSG_ID, awaiting_reply: true, source_id: SRC_NEW, channel: 'app', raw_content: 'x', content_hash: 'h', received_at: NOW, pending: JSON.stringify(payload) }];
      if (text.includes('WITH closed AS')) return [{ closed: 1, answer_source_id: 'a' }];
      if (text.includes('WITH claim AS')) return [{ claimed: 1, updated: 1, bubble_id: 'b' }];
      return [];
    });
    const result = await answerEventMatch({ sql, messageId: MSG_ID, answer: MATCH_YES, now: NOW });
    assert.deepEqual(result.matched, { sourceId: SRC, toTimed: true });
    const [write] = sql.find('WITH claim AS');
    assert.ok(write.values.includes('08:00'));
    assert.ok(write.values.includes('09:00'));
  });
});

// ---------------------------------------------------------------------------
// Google: PATCH עובר מ-date ל-dateTime ומנקה צבע ותזכורות של יום שלם
// ---------------------------------------------------------------------------
describe('event-sync: patchBody אחרי הפיכה לאירוע עם שעות', () => {
  const timedRow = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: 'טיול', starts_at: new Date('2026-12-03T06:00:00.000Z'), ends_at: new Date('2026-12-03T07:00:00.000Z'), domain: 'personal', status: 'planned', external_id: 'aaaaaaaabbbb4ccc8dddeeeeeeeeeeee', match_key: `source:${SRC}` };
  test('בלי toTimed: בדיוק כמו קודם (שעות בלבד)', () => {
    assert.deepEqual(Object.keys(patchBody(timedRow)), ['start', 'end']);
    assert.deepEqual(patchBody(timedRow, {}), patchBody(timedRow));
  });
  test('toTimed: dateTime, date מנוקה (null), צבע ותזכורות חזרה לברירת המחדל', () => {
    assert.deepEqual(patchBody(timedRow, { toTimed: true }), {
      start: { dateTime: '2026-12-03T06:00:00.000Z', timeZone: 'Asia/Jerusalem', date: null },
      end: { dateTime: '2026-12-03T07:00:00.000Z', timeZone: 'Asia/Jerusalem', date: null },
      colorId: null,
      reminders: { useDefault: true, overrides: [] },
    });
  });
  test('toTimed על שורה שעדיין יום שלם: לא מנקה (אין מה לנקות), נשאר date', () => {
    const allDay = { ...timedRow, starts_at: new Date('2026-12-02T22:00:00.000Z'), ends_at: new Date('2026-12-03T22:00:00.000Z') };
    assert.deepEqual(patchBody(allDay, { toTimed: true }), { start: { date: '2026-12-03' }, end: { date: '2026-12-04' } });
  });
  test('התנהגות היצירה (eventBody) של יום שלם לא השתנתה', () => {
    const allDay = { ...timedRow, starts_at: new Date('2026-12-02T22:00:00.000Z'), ends_at: new Date('2026-12-03T22:00:00.000Z') };
    assert.equal(eventBody(allDay).colorId, '9');
  });

  const PERSONAL_CAL = 'personal-cal-id@group.calendar.google.com';
  const gFetch = () => fakeFetch((url, options) => {
    if (url === TOKEN_ENDPOINT) return jsonResponse({ access_token: ACCESS_TOKEN });
    if (url.startsWith(CALENDAR_LIST_ENDPOINT)) return jsonResponse({ items: [{ id: PERSONAL_CAL, summary: 'אישי', accessRole: 'owner' }] });
    if (url.includes('/events') && options.method === 'PATCH') return jsonResponse({ id: 'x' });
    throw new Error(`fetch לא צפוי: ${url}`);
  });
  const syncSql = () => fakeSql((text) => {
    if (text.includes('FROM events WHERE match_key =')) return [timedRow];
    if (text.includes('FROM google_credentials')) return [{ refresh_token_enc: encRefresh(), obtained_at: '2026-11-20T08:00:00.000Z' }];
    return [];
  });
  const now = new Date('2026-11-26T08:00:00.000Z');
  test('syncEventForSource עם toTimed: ה-PATCH שנשלח מנקה date, צבע ותזכורות', async () => {
    const f = gFetch();
    const result = await syncEventForSource({ sql: syncSql(), sourceId: SRC, now, config: CONFIG, fetchFn: f, allowPatch: true, toTimed: true });
    assert.deepEqual(result, { ok: true, action: 'patch' });
    const patch = f.calls.find((c) => c.options.method === 'PATCH');
    const body = JSON.parse(patch.options.body);
    assert.equal(body.start.date, null);
    assert.equal(body.end.date, null);
    assert.equal(body.colorId, null);
    assert.deepEqual(body.reminders, { useDefault: true, overrides: [] });
    assert.equal(body.start.dateTime, '2026-12-03T06:00:00.000Z');
  });
  test('syncEventForSource בלי toTimed: ה-PATCH כמו קודם', async () => {
    const f = gFetch();
    await syncEventForSource({ sql: syncSql(), sourceId: SRC, now, config: CONFIG, fetchFn: f, allowPatch: true });
    const body = JSON.parse(f.calls.find((c) => c.options.method === 'PATCH').options.body);
    assert.deepEqual(Object.keys(body), ['start', 'end']);
  });
});
