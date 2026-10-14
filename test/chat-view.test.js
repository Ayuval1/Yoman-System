// בדיקות ל-lib/chat-view.js (שלב 8.2א-1): מה הצ'אט מציג. פונקציות טהורות, בלי מסד ובלי רשת. כל המשפטים מומצאים, בלי שמות אנשים.
// "קריטריון N" בשם הבדיקה = קריטריון הקבלה N בטבלת 8.2א-1 של docs/08-chapter8/47-chapter8-step-8-2a-spec.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemsFromRows, itemFromRow, compareItems, pendingFromRows, badgeFrom, parseChatAction, tagFor, toIso, isUuid,
  CHAT_ITEMS_LIMIT, MAX_ANSWER_LENGTH, MAX_READ_IDS, ERROR_TEXT,
} from '../lib/chat-view.js';
import { UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { captureConsole } from './helpers.js';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 12, 8, minute, second));
const userRow = (n, minute, channel = 'app', text = `הודעה ${n}`) => ({ role: 'user', id: uuid(n), text, at: at(minute), channel, read_at: null });
const systemRow = (n, minute, text = 'התקבל', readAt = null) => ({ role: 'system', id: uuid(n), text, at: at(minute), channel: null, read_at: readAt });

const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = { slots: [slot(2, 2, 'היסטוריה'), slot(2, 3, 'מתמטיקה'), slot(2, 5, 'אנגלית')] };
const MONDAY_MORNING = new Date('2026-10-12T05:00:00Z'); // שני 12.10.2026 08:00 בישראל

describe('itemsFromRows: סדר ותקרה', () => {
  test('קריטריון 2: עד 50 פריטים, ישן לחדש; מכמה יותר נשארים 50 האחרונים', () => {
    const rows = Array.from({ length: 60 }, (_, k) => userRow(k + 1, k)).reverse(); // מגיעים מהמסד מהחדש לישן
    const items = itemsFromRows(rows);
    assert.equal(CHAT_ITEMS_LIMIT, 50);
    assert.equal(items.length, 50);
    assert.equal(items[0].id, uuid(11));
    assert.equal(items.at(-1).id, uuid(60));
    for (let k = 1; k < items.length; k += 1) assert.ok(Date.parse(items[k - 1].at) <= Date.parse(items[k].at));
  });
  test('קריטריון 2: באותו רגע (אותה פקודה, אותו now()) הודעת משתמש לפני בועת מערכת, גם כשהמזהה של הבועה קטן יותר', () => {
    const items = itemsFromRows([systemRow(1, 5, 'נרשם · מבחן · היסטוריה · שני 12.10'), userRow(9, 5, 'app', 'היסטוריה')]);
    assert.deepEqual(items.map((item) => item.role), ['user', 'system']);
  });
  test('שובר שוויון שני: המזהה; פריט בלי זמן ראשון', () => {
    const items = itemsFromRows([userRow(3, 5), userRow(2, 5), { ...userRow(7, 0), at: null }]);
    assert.deepEqual(items.map((item) => item.id), [uuid(7), uuid(2), uuid(3)]);
    assert.equal(compareItems(items[1], items[1]), 0);
  });
  test('קלט שאינו מערך: רשימה ריקה', () => {
    assert.deepEqual(itemsFromRows(undefined), []);
    assert.deepEqual(itemsFromRows(null), []);
  });
});

describe('itemFromRow: הודעה שלך ובועת מערכת', () => {
  test('קריטריון 3: הודעה שהועברה מסומנת forwarded; מוקלדת ושורת תשובה לא', () => {
    assert.deepEqual(itemFromRow(userRow(1, 0, 'shortcut', 'מחר יש מבחן')), { id: uuid(1), role: 'user', text: 'מחר יש מבחן', at: at(0).toISOString(), forwarded: true });
    assert.equal(itemFromRow(userRow(2, 0, 'app')).forwarded, false);
    assert.equal(itemFromRow({ ...userRow(3, 0, 'app', 'היסטוריה') }).forwarded, false, 'שורת תשובה (sender=answer) היא בערוץ app');
  });
  test('בועת מערכת: תג ו-unread לפי read_at, בלי forwarded', () => {
    assert.deepEqual(itemFromRow(systemRow(1, 0, 'נרשם · מבחן · היסטוריה · שני 12.10')), {
      id: uuid(1), role: 'system', text: 'נרשם · מבחן · היסטוריה · שני 12.10', at: at(0).toISOString(), tag: 'recorded', unread: true,
    });
    assert.equal(itemFromRow(systemRow(2, 0, 'התקבל', at(3))).unread, false);
    assert.equal(itemFromRow(systemRow(3, 0, 'כבר קיבלתי')).tag, 'duplicate');
  });
  test('tagFor: נרשם / כבר קיבלתי / כל השאר', () => {
    assert.equal(tagFor('נרשם · ביטול · אנגלית · שני 12.10'), 'recorded');
    assert.equal(tagFor('כבר קיבלתי'), 'duplicate');
    assert.equal(tagFor('התקבל'), 'received');
    assert.equal(tagFor(null), 'received');
  });
  test('toIso: Date, טקסט, וכל השאר null', () => {
    assert.equal(toIso(at(1)), at(1).toISOString());
    assert.equal(toIso('2026-10-12T08:01:00.000Z'), '2026-10-12T08:01:00.000Z');
    for (const value of [null, undefined, 'לא תאריך', 5, {}]) assert.equal(toIso(value), null);
  });
});

describe('pendingFromRows: השאלות הממתינות', () => {
  const question = (n, minute, body, src) => ({
    id: uuid(n), body, sent_at: at(minute),
    source_id: src?.id ?? null, channel: src?.channel ?? null, raw_content: src?.text ?? null, content_hash: null, received_at: src?.received_at ?? null,
  });
  const typed = { id: uuid(101), channel: 'app', text: 'מחר אין שיעור אנגלית', received_at: MONDAY_MORNING };
  const forwarded = { id: uuid(102), channel: 'shortcut', text: 'היום יש מבחן', received_at: MONDAY_MORNING };

  test('קריטריון 4: כפתורים נגזרים, "לא יודע" אחרון, וסימון תיבת כתיבה; הטקסט הוא ה-body השמור', () => {
    const facts = [{ source_id: uuid(102), field: 'type', value: 'exam', origin: 'read' }, { source_id: uuid(102), field: 'date', value: '2026-10-12', origin: 'inferred' }];
    const [subject] = pendingFromRows({ questions: [question(1, 0, 'איזה מקצוע?', forwarded)], facts, timetable: TIMETABLE });
    assert.deepEqual(subject, { id: uuid(1), text: 'איזה מקצוע?', at: at(0).toISOString(), buttons: ['היסטוריה', 'מתמטיקה', 'אנגלית', UNKNOWN_BUTTON], allowFreeText: true });
  });
  test('קריטריון 4: שאלת "מה זה?" של הודעה מוקלדת: כפתורי הסוגים', () => {
    const [kind] = pendingFromRows({ questions: [question(1, 0, 'מה זה?', typed)], facts: [], timetable: TIMETABLE });
    assert.deepEqual(kind.buttons, ['שיעורי בית', 'מבחן', 'ביטול', 'חדר', 'הזזה', 'יום מקוצר', UNKNOWN_BUTTON]);
    assert.equal(kind.allowFreeText, true);
  });
  test('קריטריון 4: אין שדה פתוח (pendingQuestion מחזיר null) או אין מקור: "לא יודע" בלבד ותיבת כתיבה', () => {
    const complete = [
      ['type', 'exam'], ['subject', 'היסטוריה'], ['date', '2026-10-12'], ['topic', 'unknown'], ['lesson', '2'],
    ].map(([field, value]) => ({ source_id: uuid(102), field, value, origin: 'read' }));
    const list = pendingFromRows({ questions: [question(1, 0, 'על איזה נושא?', forwarded), question(2, 1, 'שאלה בלי מקור', null)], facts: complete, timetable: TIMETABLE });
    for (const item of list) {
      assert.deepEqual(item.buttons, [UNKNOWN_BUTTON]);
      assert.equal(item.allowFreeText, true);
    }
    assert.equal(list[0].text, 'על איזה נושא?');
  });
  test('קריטריון 2: הוותיקה קודם, גם אם הגיעו בסדר אחר', () => {
    const list = pendingFromRows({ questions: [question(3, 9, 'ג', typed), question(1, 2, 'א', typed), question(2, 5, 'ב', typed)], facts: [], timetable: null });
    assert.deepEqual(list.map((item) => item.text), ['א', 'ב', 'ג']);
  });
  test('מקור תקול (חותמת קליטה ריקה, מערכת שעות פגומה): לא קורס, השאלה מוצגת ו"לא יודע" אחרון, והלוג בלי טקסט', (t) => {
    const cap = captureConsole(t);
    const broken = { ...question(1, 0, 'לאיזה תאריך?', forwarded), received_at: null };
    // received_at ריק: החילוץ זורק RangeError ונתפס בתוך pendingQuestion (safeExtract); מערכת שעות שאינה מערך נבדקת שם (Array.isArray)
    const list = pendingFromRows({ questions: [broken], facts: [{ source_id: uuid(102), field: 'type', value: 'exam', origin: 'read' }], timetable: { slots: 'לא מערך' } });
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].buttons, [UNKNOWN_BUTTON]);
    assert.ok(!cap.text().includes('היום יש מבחן'));
  });
  test('קלט ריק: רשימה ריקה', () => {
    assert.deepEqual(pendingFromRows({}), []);
    assert.deepEqual(pendingFromRows(), []);
  });
});

describe('badgeFrom: המספר על האייקון (D4)', () => {
  test('קריטריון 12: שאלות פתוחות + בועות שלא נקראו, בלי ספירה כפולה', () => {
    assert.equal(badgeFrom({ pending: 2, unread: 3 }), 5);
    assert.equal(badgeFrom({ pending: 1, unread: 0 }), 1);
    assert.equal(badgeFrom({ pending: '4', unread: '1' }), 5, 'count() של Postgres יכול לחזור כטקסט');
  });
  test('ערכים חסרים או לא תקינים נספרים 0', () => {
    for (const value of [undefined, null, -1, 1.5, 'x', NaN]) assert.equal(badgeFrom({ pending: value, unread: value }), 0, String(value));
    assert.equal(badgeFrom(), 0);
  });
});

describe('parseChatAction: בדיקת גוף POST (קריטריון 1, 400)', () => {
  const ID = uuid(1);
  test('answer תקין', () => {
    assert.deepEqual(parseChatAction({ action: 'answer', message_id: ID, answer: 'היסטוריה' }), { ok: true, action: 'answer', messageId: ID, answer: 'היסטוריה' });
    assert.equal(parseChatAction({ action: 'answer', message_id: ID, answer: 'א'.repeat(MAX_ANSWER_LENGTH) }).ok, true);
    assert.equal(parseChatAction({ action: 'answer', message_id: ID.toUpperCase(), answer: 'x' }).ok, true);
  });
  test('קריטריון 1: answer פגום', () => {
    const bad = [
      { action: 'answer', message_id: 'not-a-uuid', answer: 'x' },
      { action: 'answer', answer: 'x' },
      { action: 'answer', message_id: ID },
      { action: 'answer', message_id: ID, answer: '' },
      { action: 'answer', message_id: ID, answer: '   ' },
      { action: 'answer', message_id: ID, answer: 'א'.repeat(MAX_ANSWER_LENGTH + 1) },
      { action: 'answer', message_id: ID, answer: 5 },
      { action: 'answer', message_id: 5, answer: 'x' },
      { action: 'answer', message_id: `${ID}x`, answer: 'x' },
    ];
    for (const body of bad) assert.deepEqual(parseChatAction(body), { ok: false }, JSON.stringify(body).slice(0, 80));
  });
  test('read תקין, כולל רשימה ריקה ועד 100 מזהים', () => {
    assert.deepEqual(parseChatAction({ action: 'read', message_ids: [ID] }), { ok: true, action: 'read', messageIds: [ID] });
    assert.equal(parseChatAction({ action: 'read', message_ids: [] }).ok, true);
    assert.equal(parseChatAction({ action: 'read', message_ids: Array.from({ length: MAX_READ_IDS }, (_, k) => uuid(k)) }).ok, true);
  });
  test('קריטריון 1: read פגום', () => {
    const bad = [
      { action: 'read' },
      { action: 'read', message_ids: ID },
      { action: 'read', message_ids: [ID, 'x'] },
      { action: 'read', message_ids: Array.from({ length: MAX_READ_IDS + 1 }, (_, k) => uuid(k)) },
      { action: 'read', message_ids: [null] },
    ];
    for (const body of bad) assert.deepEqual(parseChatAction(body), { ok: false });
  });
  test('קריטריון 1: פעולה לא מוכרת או גוף שאינו אובייקט', () => {
    for (const body of [null, undefined, 'answer', 5, [], [{ action: 'read', message_ids: [] }], {}, { action: 'delete' }, { action: 'ANSWER', message_id: ID, answer: 'x' }]) {
      assert.deepEqual(parseChatAction(body), { ok: false }, JSON.stringify(body));
    }
  });
  test('isUuid ו-ERROR_TEXT', () => {
    assert.equal(isUuid(ID), true);
    assert.equal(isUuid('11111111-1111-4111-8111-11111111111'), false);
    assert.equal(ERROR_TEXT, 'לא נשלח, נסה שוב.');
  });
});
