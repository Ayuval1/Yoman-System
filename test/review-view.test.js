// בדיקות ל-lib/review-view.js (שלב M.2 של docs/09-security/46; מפרט: 57): חלון הזמן, בחירת מה ממתין, התצוגה, בדיקת בקשת הסימון וכתיבתו.
// "קריטריון N" בשם הבדיקה = קריטריון הקבלה N בסעיף 8 של 57. בלי מסד אמיתי ובלי רשת: sql מזויף מ-helpers.js. כל ההודעות והמקצועות מומצאים, בלי שמות אנשים.
// חשוב: ה-SQL לא הורץ מול Postgres אמיתי (אין מסד בסשן). הבדיקות מוודאות את טקסט הפקודות, הפרמטרים והלוגיקה ב-JS; קריטריון 13 (EXPLAIN) נבדק מול Neon.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nextRunUtc } from '../lib/schedule-time.js';
import {
  REVIEW_FROM_DAY, REVIEW_FROM_INSTANT, REVIEW_LAST_BOUNDARY, lastBoundary, reviewWindow, inReviewWindow, dueRows, buildReview,
  resultText, missingFields, validCheckShape, countReviewDue, loadReview, writeCheck, REVIEW_VERDICTS, EVENT_TYPES,
} from '../lib/review-view.js';
import { fakeSql, REVIEW_NOW, reviewRow, uuidOf } from './helpers.js';

const utc = (iso) => new Date(iso);
const iso = (date) => date.toISOString();

describe('review-view: קבועי M.2 (T7)', () => {
  test('REVIEW_FROM_DAY הוא ערב ההוכחה, ו-REVIEW_FROM_INSTANT הוא תחילת היום הישראלי שלו (00:00 בקיץ = 21:00Z של היום הקודם)', () => {
    assert.equal(REVIEW_FROM_DAY, '2026-10-15');
    assert.equal(iso(REVIEW_FROM_INSTANT), '2026-10-14T21:00:00.000Z');
  });
  test('REVIEW_LAST_BOUNDARY הוא 21:00 בישראל ב-29.10.2026 (אחרי שעון החורף: UTC+2 = 19:00Z), 14 ערבים אחרי ערב 0, ונבדק מול nextRunUtc', () => {
    assert.equal(iso(REVIEW_LAST_BOUNDARY), '2026-10-29T19:00:00.000Z');
    assert.equal(iso(nextRunUtc({ hour: 21, minute: 0, timeZone: 'Asia/Jerusalem', from: utc('2026-10-29T12:00:00Z') })), iso(REVIEW_LAST_BOUNDARY));
    // ספירה: הגבולות ב-16.10 עד 29.10 הם 14 ערבים, כל אחד 21:00 מקומי.
    let boundary = lastBoundary(utc('2026-10-15T18:00:00Z')); // 15.10 21:00 בישראל = ערב 0
    assert.equal(iso(boundary), '2026-10-15T18:00:00.000Z');
    let evenings = 0;
    while (boundary.getTime() < REVIEW_LAST_BOUNDARY.getTime()) {
      boundary = nextRunUtc({ hour: 21, minute: 0, timeZone: 'Asia/Jerusalem', from: boundary });
      evenings += 1;
    }
    assert.equal(evenings, 14);
    assert.equal(iso(boundary), iso(REVIEW_LAST_BOUNDARY));
  });
  test('קבועי הרשימות', () => {
    assert.deepEqual([...REVIEW_VERDICTS], ['right', 'wrong', 'was_event', 'not_event']);
    assert.deepEqual([...EVENT_TYPES], ['short_day', 'cancel', 'move', 'exam', 'homework', 'room', 'early_leave', 'personal_event']);
  });
});

describe('review-view: B ו-B3 סביב מעבר השעון (קריטריון 3)', () => {
  test('סוף שעון הקיץ, 25.10.2026 (02:00 -> 01:00): היום הזה ארוך 25 שעות, והגבול של 25.10 הוא 19:00Z (UTC+2)', () => {
    assert.equal(iso(lastBoundary(utc('2026-10-24T18:00:00Z'))), '2026-10-24T18:00:00.000Z', 'בדיוק על הגבול: הוא עצמו');
    assert.equal(iso(lastBoundary(utc('2026-10-25T18:59:59Z'))), '2026-10-24T18:00:00.000Z', 'עוד לא 21:00 בישראל ב-25.10');
    assert.equal(iso(lastBoundary(utc('2026-10-25T19:00:00Z'))), '2026-10-25T19:00:00.000Z');
    assert.equal(iso(lastBoundary(utc('2026-10-26T18:59:59Z'))), '2026-10-25T19:00:00.000Z');
  });
  test('תחילת שעון הקיץ, 26.3.2027 (02:00 -> 03:00): היום הזה קצר, 23 שעות, והגבול של 26.3 הוא 18:00Z (UTC+3)', () => {
    assert.equal(iso(lastBoundary(utc('2027-03-25T19:00:00Z'))), '2027-03-25T19:00:00.000Z');
    assert.equal(iso(lastBoundary(utc('2027-03-26T17:59:59Z'))), '2027-03-25T19:00:00.000Z');
    assert.equal(iso(lastBoundary(utc('2027-03-26T18:00:00Z'))), '2027-03-26T18:00:00.000Z');
    assert.equal(iso(lastBoundary(utc('2027-03-27T17:59:59Z'))), '2027-03-26T18:00:00.000Z');
  });
  test('B3 שחוצה את המעבר: B = 27.10.2026 21:00 (19:00Z) נותן B3 = 24.10 21:00 (18:00Z), ו-B = 28.10 נותן B3 = 25.10 21:00 (19:00Z)', () => {
    assert.equal(iso(reviewWindow(utc('2026-10-27T19:30:00Z')).boundary), '2026-10-27T19:00:00.000Z');
    assert.equal(iso(reviewWindow(utc('2026-10-27T19:30:00Z')).lower), '2026-10-24T18:00:00.000Z');
    assert.equal(iso(reviewWindow(utc('2026-10-28T19:30:00Z')).lower), '2026-10-25T19:00:00.000Z');
    assert.equal(iso(reviewWindow(utc('2027-03-28T10:00:00Z')).lower) < iso(reviewWindow(utc('2027-03-28T10:00:00Z')).boundary), true);
  });
  test('B3 חוצה גם את תחילת שעון הקיץ: B = 27.3.2027 נותן B3 = 24.3 21:00 (UTC+2 = 19:00Z)', () => {
    assert.equal(iso(reviewWindow(utc('2027-03-27T18:30:00Z')).boundary), '2027-03-27T18:00:00.000Z');
    assert.equal(iso(reviewWindow(utc('2027-03-27T18:30:00Z')).lower), '2027-03-24T19:00:00.000Z');
  });
  test('הדוגמה של 57: הודעה מ-24.10 21:30 מוצגת ב-25, 26 ו-27.10 ולא ב-28.10 (ולא ב-24.10 עצמו)', () => {
    const message = reviewRow(1, { recorded_at: utc('2026-10-24T18:30:00Z'), received_at: utc('2026-10-24T18:29:00Z') }); // 21:30 בישראל (UTC+3)
    const shownAt = (nowIso) => dueRows([message], reviewWindow(utc(nowIso))).length;
    assert.equal(shownAt('2026-10-24T18:00:00Z'), 0, 'ב-24.10 21:00 עוד לא נקלטה');
    assert.equal(shownAt('2026-10-25T19:00:00Z'), 1, 'ערב ראשון');
    assert.equal(shownAt('2026-10-26T19:00:00Z'), 1, 'ערב שני');
    assert.equal(shownAt('2026-10-27T19:00:00Z'), 1, 'ערב שלישי');
    assert.equal(shownAt('2026-10-28T19:00:00Z'), 0, 'פקעה');
  });
});

describe('review-view: חלון הזמן (קריטריון 2)', () => {
  const window = reviewWindow(REVIEW_NOW); // B = 16.10 18:00Z; B3 = 13.10 18:00Z; from = 14.10 21:00Z
  const row = (recordedIso, receivedIso = recordedIso) => ({ recordedAt: utc(recordedIso), receivedAt: utc(receivedIso) });
  test('הודעה שנקלטה אחרי B לא מופיעה; ב-B עצמו (מ-B ואילך) מופיעה', () => {
    assert.equal(inReviewWindow(row('2026-10-16T18:00:00.000Z'), window), true);
    assert.equal(inReviewWindow(row('2026-10-16T18:00:00.001Z'), window), false);
    assert.equal(inReviewWindow(row('2026-10-16T17:59:59.999Z'), window), true);
  });
  test('גבול B3 בלעדי: מה שנקלט בדיוק ב-B3 כבר פקע', () => {
    assert.equal(inReviewWindow(row('2026-10-14T21:00:00.000Z'), reviewWindow(utc('2026-10-17T18:00:00Z'))), true, 'B3 של 17.10 הוא 14.10 21:00 מקומי = 18:00Z, אחריו מופיע');
    const w = reviewWindow(utc('2026-10-19T18:00:00Z'));
    assert.equal(iso(w.lower), '2026-10-16T18:00:00.000Z');
    assert.equal(inReviewWindow(row('2026-10-16T18:00:00.000Z'), w), false);
    assert.equal(inReviewWindow(row('2026-10-16T18:00:00.001Z'), w), true);
  });
  test('לפני REVIEW_FROM_DAY לא מופיע (גם recorded_at וגם received_at); מתחילת היום הישראלי של REVIEW_FROM_DAY כן', () => {
    const w = reviewWindow(utc('2026-10-15T18:00:00Z')); // ערב 0 עצמו
    assert.equal(inReviewWindow(row('2026-10-14T20:59:59.999Z'), w), false);
    assert.equal(inReviewWindow(row('2026-10-14T21:00:00.000Z'), w), true);
    assert.equal(inReviewWindow(row('2026-10-15T10:00:00Z', '2026-10-14T20:00:00Z'), w), false, 'המקור נקלט לפני תחילת היום');
  });
  test('אחרי REVIEW_LAST_BOUNDARY לא מופיעות הודעות חדשות, ושאריות פוקעות לפי T3', () => {
    const lastEvening = reviewWindow(utc('2026-10-29T19:00:00Z'));
    assert.equal(iso(lastEvening.upper), '2026-10-29T19:00:00.000Z');
    const after = reviewWindow(utc('2026-10-30T19:30:00Z')); // B = 30.10 אבל upper נחתך
    assert.equal(iso(after.boundary), '2026-10-30T19:00:00.000Z');
    assert.equal(iso(after.upper), '2026-10-29T19:00:00.000Z');
    assert.equal(inReviewWindow(row('2026-10-29T18:59:00Z'), after), true, 'שארית מהערב האחרון עדיין בתוך שלושה ערבים');
    assert.equal(inReviewWindow(row('2026-10-29T19:00:01Z'), after), false, 'הודעה חדשה אחרי הערב ה-14');
    const later = reviewWindow(utc('2026-11-03T19:30:00Z'));
    assert.equal(inReviewWindow(row('2026-10-29T18:59:00Z'), later), false, 'השארית פקעה');
  });
  test('שורה בלי זמנים תקינים אינה בתוך החלון', () => {
    assert.equal(inReviewWindow({ recordedAt: null, receivedAt: utc('2026-10-16T10:00:00Z') }, window), false);
    assert.equal(inReviewWindow({ recordedAt: 'לא תאריך', receivedAt: 'x' }, window), false);
    assert.equal(inReviewWindow({ recordedAt: '2026-10-16T10:00:00Z', receivedAt: '2026-10-16T09:00:00Z' }, window), true, 'טקסט ISO מתקבל');
  });
});

describe('review-view: dueRows, מה ממתין לסימון (קריטריון 4)', () => {
  const window = reviewWindow(REVIEW_NOW);
  const ids = (rows) => dueRows(rows, window).map((r) => r.id);

  test('duplicate לא מוצג; outcome שכבר סומן לא מוצג', () => {
    assert.deepEqual(ids([reviewRow(1), reviewRow(2, { status: 'duplicate' }), reviewRow(3, { checked: true }), reviewRow(4)]), [uuidOf(1), uuidOf(4)]);
  });
  test('מחוץ לחלון לא מוצג, וה-duplicate לא נחשב נציג של קבוצתו', () => {
    const early = reviewRow(1, { recorded_at: utc('2026-10-16T10:00:00Z'), content_hash: 'same' });
    const dupLater = reviewRow(2, { status: 'duplicate', recorded_at: utc('2026-10-16T11:00:00Z'), content_hash: 'same' });
    assert.deepEqual(ids([early, dupLater]), [uuidOf(1)]);
    assert.deepEqual(ids([reviewRow(5, { recorded_at: utc('2026-10-16T18:00:01Z') })]), []);
  });
  test('T4: בקבוצת (content_hash, יום ישראלי של received_at) מוצג רק הנציג האחרון', () => {
    const a = reviewRow(1, { content_hash: 'same', recorded_at: utc('2026-10-16T09:00:00Z'), received_at: utc('2026-10-16T08:59:00Z') });
    const b = reviewRow(2, { content_hash: 'same', recorded_at: utc('2026-10-16T12:00:00Z'), received_at: utc('2026-10-16T11:59:00Z'), status: 'failed' });
    assert.deepEqual(ids([a, b]), [uuidOf(2)]);
    assert.deepEqual(ids([b, a]), [uuidOf(2)], 'לא תלוי בסדר השורות');
  });
  test('T4: בשוויון recorded_at המזהה הגדול קובע', () => {
    const a = reviewRow(1, { content_hash: 'same' });
    const b = reviewRow(2, { content_hash: 'same' });
    assert.deepEqual(ids([a, b]), [uuidOf(2)]);
    assert.deepEqual(ids([b, a]), [uuidOf(2)]);
  });
  test('T4: הבחירה קודמת לסינון "סומן": אם הנציג סומן, הקבוצה כולה לא מוצגת (הוותיק לא "עולה")', () => {
    const older = reviewRow(1, { content_hash: 'same', recorded_at: utc('2026-10-16T09:00:00Z') });
    const newerChecked = reviewRow(2, { content_hash: 'same', recorded_at: utc('2026-10-16T12:00:00Z'), checked: true });
    assert.deepEqual(ids([older, newerChecked]), []);
    const olderChecked = { ...older, checked: true };
    const newer = { ...newerChecked, checked: false };
    assert.deepEqual(ids([olderChecked, newer]), [uuidOf(2)], 'הוותיק סומן והחדש לא: החדש מוצג');
  });
  test('T4: יום ישראלי אחר או hash אחר הם קבוצות נפרדות; בלי content_hash כל מקור לבדו', () => {
    const night = reviewRow(1, { content_hash: 'same', received_at: utc('2026-10-15T20:59:00Z'), recorded_at: utc('2026-10-15T21:00:00Z') }); // 15.10 23:59 בישראל
    const morning = reviewRow(2, { content_hash: 'same', received_at: utc('2026-10-15T21:01:00Z'), recorded_at: utc('2026-10-15T21:02:00Z') }); // 16.10 00:01 בישראל
    assert.deepEqual(ids([night, morning]), [uuidOf(1), uuidOf(2)], 'חצות ישראל מפרידה, לא חצות UTC');
    const noHashA = reviewRow(3, { content_hash: null });
    const noHashB = reviewRow(4, { content_hash: null });
    assert.deepEqual(ids([noHashA, noHashB]), [uuidOf(3), uuidOf(4)]);
    assert.deepEqual(ids([reviewRow(5, { content_hash: 'x' }), reviewRow(6, { content_hash: 'y' })]), [uuidOf(5), uuidOf(6)]);
  });
  test('סדר: מהוותיק לחדש לפי received_at, ובשוויון המזהה', () => {
    const rows = [
      reviewRow(3, { received_at: utc('2026-10-16T10:00:00Z') }), reviewRow(1, { received_at: utc('2026-10-16T08:00:00Z') }),
      reviewRow(2, { received_at: utc('2026-10-16T10:00:00Z') }),
    ];
    assert.deepEqual(ids(rows), [uuidOf(1), uuidOf(2), uuidOf(3)]);
  });
  test('קלט שאינו מערך או שורות ריקות: רשימה ריקה', () => {
    assert.deepEqual(dueRows(undefined, window), []);
    assert.deepEqual(dueRows([null, {}], window), []);
  });
});

describe('review-view: buildReview, תצוגה וסדר (קריטריון 5)', () => {
  const window = reviewWindow(REVIEW_NOW);
  const fact = (n, field, value) => ({ source_id: uuidOf(1000 + n), field, value });
  const rowsFor = (...rows) => dueRows(rows, window);

  test('T5: תצוגה לפי קיום עובדת type ולא לפי status: failed עם עובדות = recorded; unclassified ו-failed בלי עובדות = missed', () => {
    const rows = rowsFor(
      reviewRow(1, { status: 'failed' }), reviewRow(2, { status: 'unclassified' }), reviewRow(3, { status: 'failed' }),
      reviewRow(4, { status: 'unclassified' }), reviewRow(5, { status: 'recorded' }),
    );
    const facts = [
      fact(1, 'type', 'exam'), fact(1, 'subject', 'מתמטיקה'), fact(1, 'date', '2026-10-20'),
      fact(4, 'subject', 'היסטוריה'), // עובדות בלי type: עדיין לא נתפס
      fact(5, 'type', 'short_day'), fact(5, 'date', '2026-10-21'),
    ];
    const { items } = buildReview({ rows, facts, openQuestionSourceIds: [] });
    const view = (n) => items.find((item) => item.outcome_id === uuidOf(n)).view;
    assert.deepEqual([1, 2, 3, 4, 5].map(view), ['recorded', 'missed', 'missed', 'missed', 'recorded']);
  });
  test('סדר: missed קודם, אחר כך recorded, בכל חלק הוותיק קודם', () => {
    const rows = rowsFor(
      reviewRow(1, { received_at: utc('2026-10-16T08:00:00Z') }), reviewRow(2, { received_at: utc('2026-10-16T08:10:00Z') }),
      reviewRow(3, { received_at: utc('2026-10-16T08:20:00Z') }), reviewRow(4, { received_at: utc('2026-10-16T08:30:00Z') }),
    );
    const facts = [fact(1, 'type', 'exam'), fact(3, 'type', 'room')];
    const { items, total } = buildReview({ rows, facts, openQuestionSourceIds: [] });
    assert.equal(total, 4);
    assert.deepEqual(items.map((item) => [item.outcome_id, item.view]), [[uuidOf(2), 'missed'], [uuidOf(4), 'missed'], [uuidOf(1), 'recorded'], [uuidOf(3), 'recorded']]);
  });
  test('בלי תקרה: 60 שורות כולן מוצגות, total = 60', () => {
    const rows = rowsFor(...Array.from({ length: 60 }, (_, k) => reviewRow(k + 1, { received_at: new Date(Date.UTC(2026, 9, 16, 8, k)) })));
    const out = buildReview({ rows, facts: [], openQuestionSourceIds: [] });
    assert.equal(out.total, 60);
    assert.equal(out.items.length, 60);
    assert.deepEqual(out.items.map((item) => item.outcome_id), Array.from({ length: 60 }, (_, k) => uuidOf(k + 1)));
  });
  test('צורת הפריט: text מלא (T11), at ב-ISO, result ו-missing רק ב-recorded', () => {
    const rows = rowsFor(reviewRow(1, { text: 'בדיקה במתמטיקה ביום שלישי' }), reviewRow(2, { text: 'הודעה כללית' }));
    const facts = [fact(1, 'type', 'exam'), fact(1, 'subject', 'מתמטיקה'), fact(1, 'date', '2026-10-20'), fact(1, 'topic', 'unknown'), fact(1, 'lesson', '2')];
    const { items } = buildReview({ rows, facts, openQuestionSourceIds: [] });
    assert.deepEqual(items[0], { outcome_id: uuidOf(2), view: 'missed', text: 'הודעה כללית', result: null, missing: [], at: '2026-10-16T09:59:00.000Z' });
    assert.deepEqual(items[1], { outcome_id: uuidOf(1), view: 'recorded', text: 'בדיקה במתמטיקה ביום שלישי', result: 'מבחן · מתמטיקה · שלישי 20.10', missing: [], at: '2026-10-16T09:59:00.000Z' });
  });
  test('כשאין הודעות: total 0 ו-items ריק', () => {
    assert.deepEqual(buildReview({ rows: [], facts: [], openQuestionSourceIds: [] }), { total: 0, items: [] });
    assert.deepEqual(buildReview({}), { total: 0, items: [] });
  });
});

describe('review-view: result ו-missing (קריטריון 6)', () => {
  const facts = (obj) => new Map(Object.entries(obj));
  test('שישה סוגים: מה שנרשם בצורת formatReply בלי "נרשם", עם יום בשבוע', () => {
    assert.equal(resultText(facts({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-20' })), 'מבחן · מתמטיקה · שלישי 20.10');
    assert.equal(resultText(facts({ type: 'homework', subject: 'אנגלית', date: '2026-10-21' })), 'שיעורי בית · אנגלית · רביעי 21.10');
    assert.equal(resultText(facts({ type: 'cancel', subject: 'היסטוריה', date: '2026-10-22' })), 'ביטול · היסטוריה · חמישי 22.10');
    assert.equal(resultText(facts({ type: 'room', subject: 'מדעים', date: '2026-10-19', new_room: '12' })), 'חדר · מדעים · שני 19.10');
    assert.equal(resultText(facts({ type: 'short_day', date: '2026-10-25' })), 'יום מקוצר · ראשון 25.10', 'ליום מקוצר אין מקצוע');
  });
  test('הזזה: התאריך הוא new_date (לא date)', () => {
    assert.equal(resultText(facts({ type: 'move', subject: 'מתמטיקה', date: '2026-10-20', new_date: '2026-10-27' })), 'הזזה · מתמטיקה · שלישי 27.10');
    assert.equal(resultText(facts({ type: 'move', subject: 'מתמטיקה', date: '2026-10-20' })), 'הזזה · מתמטיקה', 'בלי new_date: מה שידוע, בלי לזרוק');
  });
  test('ערך unknown מוצג "לא ידוע": מקצוע ותאריך', () => {
    assert.equal(resultText(facts({ type: 'exam', subject: 'unknown', date: '2026-10-20' })), 'מבחן · לא ידוע · שלישי 20.10');
    assert.equal(resultText(facts({ type: 'exam', subject: 'מתמטיקה', date: 'unknown' })), 'מבחן · מתמטיקה · לא ידוע');
    assert.equal(resultText(facts({ type: 'short_day', date: 'unknown' })), 'יום מקוצר · לא ידוע');
  });
  test('תאריך חסר, לא תקין או לא קיים בלוח, וסוג לא מוכר או חסר: לא זורק', () => {
    assert.equal(resultText(facts({ type: 'exam', subject: 'מתמטיקה' })), 'מבחן · מתמטיקה');
    assert.equal(resultText(facts({ type: 'exam', subject: 'מתמטיקה', date: 'מחר' })), 'מבחן · מתמטיקה');
    assert.equal(resultText(facts({ type: 'exam', subject: 'מתמטיקה', date: '2026-02-31' })), 'מבחן · מתמטיקה');
    assert.equal(resultText(facts({ type: 'party', subject: 'מתמטיקה', date: '2026-10-20' })), null);
    assert.equal(resultText(facts({ subject: 'מתמטיקה' })), null);
    assert.equal(resultText(facts({ type: 'exam', subject: '   ', date: '2026-10-20' })), 'מבחן · שלישי 20.10');
  });
  test('"חסר": שדה חיוני בלי עובדה, רק כשיש שאלה פתוחה; "unknown" אינו חסר', () => {
    const exam = facts({ type: 'exam', subject: 'מתמטיקה' });
    assert.deepEqual(missingFields(exam, true), ['תאריך', 'נושא', 'שיעור']);
    assert.deepEqual(missingFields(exam, false), [], 'בלי שאלה פתוחה: לא מוצג');
    assert.deepEqual(missingFields(facts({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-20', topic: 'unknown', lesson: 'unknown' }), true), []);
    assert.deepEqual(missingFields(facts({ type: 'move', subject: 'מתמטיקה', date: '2026-10-20' }), true), ['תאריך חדש', 'שיעור']);
    assert.deepEqual(missingFields(facts({ type: 'room', date: '2026-10-20' }), true), ['מקצוע', 'חדר', 'שיעור']);
    assert.deepEqual(missingFields(facts({ type: 'short_day' }), true), ['תאריך']);
    assert.deepEqual(missingFields(facts({ type: 'party' }), true), [], 'סוג לא מוכר: אין רשימת שדות');
  });
  test('buildReview: "חסר" רק לשורה שיש לה שאלה פתוחה, ומאוחד עם התוצאה', () => {
    const window = reviewWindow(REVIEW_NOW);
    const rows = dueRows([reviewRow(1), reviewRow(2)], window);
    const factRows = [1, 2].flatMap((n) => [
      { source_id: uuidOf(1000 + n), field: 'type', value: 'exam' }, { source_id: uuidOf(1000 + n), field: 'subject', value: 'מתמטיקה' },
      { source_id: uuidOf(1000 + n), field: 'date', value: '2026-10-20' },
    ]);
    const { items } = buildReview({ rows, facts: factRows, openQuestionSourceIds: [uuidOf(1001)] });
    assert.deepEqual(items.map((item) => [item.outcome_id, item.missing]), [[uuidOf(1), ['נושא', 'שיעור']], [uuidOf(2), []]]);
    assert.equal(items[0].result, 'מבחן · מתמטיקה · שלישי 20.10');
  });
});

describe('review-view: בדיקת צורת הסימון (קריטריון 7)', () => {
  test('כל 4 ה-verdict × 6 ה-event_type: תקף רק was_event עם סוג, וכל השאר בלי סוג', () => {
    for (const verdict of REVIEW_VERDICTS) {
      assert.equal(validCheckShape({ verdict }), verdict !== 'was_event', verdict);
      for (const eventType of EVENT_TYPES) assert.equal(validCheckShape({ verdict, eventType }), verdict === 'was_event', `${verdict} + ${eventType}`);
    }
  });
  test('ערכים לא מוכרים נדחים', () => {
    for (const verdict of [undefined, null, '', 'RIGHT', 'yes', 5, {}]) assert.equal(validCheckShape({ verdict }), false, String(verdict));
    for (const eventType of ['', 'party', 'EXAM', 5, {}]) assert.equal(validCheckShape({ verdict: 'was_event', eventType }), false, String(eventType));
    assert.equal(validCheckShape({ verdict: 'was_event', eventType: null }), false);
  });
});

// שאילתות: ה-sql מזויף. מזהה את הפקודה לפי הטקסט.
describe('review-view: שאילתות', () => {
  const isCandidates = (text) => text.includes('FROM intake_outcomes o JOIN sources s') && text.startsWith('SELECT');
  const window = reviewWindow(REVIEW_NOW);

  test('countReviewDue: שאילתה אחת בלי raw_content, פרמטרי החלון כ-ISO, וה-count לפי dueRows (נציג אחד, בלי מסומנים)', async () => {
    const rows = [reviewRow(1, { content_hash: 'same' }), reviewRow(2, { content_hash: 'same', recorded_at: utc('2026-10-16T12:00:00Z') }), reviewRow(3, { checked: true }), reviewRow(4)];
    const sql = fakeSql((text) => (isCandidates(text) ? rows : []));
    assert.equal(await countReviewDue(sql, REVIEW_NOW), 2);
    assert.equal(sql.calls.length, 1);
    const [{ text, values }] = sql.calls;
    assert.ok(!text.includes('raw_content'));
    assert.match(text, /s\.channel = 'shortcut' AND o\.status <> 'duplicate'/);
    assert.match(text, /EXISTS \(SELECT 1 FROM intake_checks c WHERE c\.outcome_id = o\.id\) AS checked/);
    assert.deepEqual(values, [iso(window.lower), iso(window.upper), iso(window.from), iso(window.from), iso(window.last)]);
  });
  test('countReviewDue: שורות לא תקינות או מחוץ לחלון לא נספרות, ותשובה שאינה מערך = 0', async () => {
    assert.equal(await countReviewDue(fakeSql(() => [{ pending: 1 }, reviewRow(1, { recorded_at: utc('2026-10-10T10:00:00Z') })]), REVIEW_NOW), 0);
    assert.equal(await countReviewDue(fakeSql(() => undefined), REVIEW_NOW), 0);
  });
  test('loadReview: אין ממתינים = שאילתה אחת בלבד; עם ממתינים, עובדות ושאלות פתוחות במזהי המקורות בלבד (JSON)', async () => {
    const empty = fakeSql(() => []);
    assert.deepEqual(await loadReview(empty, REVIEW_NOW), { total: 0, items: [] });
    assert.equal(empty.calls.length, 1);

    const rows = [reviewRow(1, { text: 'בדיקה במתמטיקה ביום שלישי' }), reviewRow(2, { text: 'הודעה כללית' })];
    const sql = fakeSql((text) => {
      if (isCandidates(text)) return rows;
      if (text.includes('JOIN facts f')) return [{ source_id: uuidOf(1001), field: 'type', value: 'exam' }, { source_id: uuidOf(1001), field: 'subject', value: 'מתמטיקה' }];
      if (text.includes('JOIN messages m')) return [{ source_id: uuidOf(1001) }];
      return [];
    });
    const out = await loadReview(sql, REVIEW_NOW);
    assert.equal(sql.calls.length, 3);
    assert.match(sql.calls[0].text, /s\.raw_content AS text/, 'הטקסט נקרא רק כאן, לתצוגה (T11)');
    assert.deepEqual(sql.calls[1].values, [JSON.stringify([uuidOf(1001), uuidOf(1002)])]);
    assert.deepEqual(sql.calls[2].values, [JSON.stringify([uuidOf(1001), uuidOf(1002)])]);
    assert.match(sql.calls[2].text, /m\.kind = 'question' AND m\.awaiting_reply = true AND m\.entity_type = 'source'/);
    assert.deepEqual(out.items.map((i) => [i.view, i.text, i.missing]), [['missed', 'הודעה כללית', []], ['recorded', 'בדיקה במתמטיקה ביום שלישי', ['תאריך', 'נושא', 'שיעור']]]);
    assert.equal(out.total, 2);
  });
  test('loadReview: כשל מסד נזרק', async () => {
    await assert.rejects(() => loadReview(fakeSql(() => { throw new Error('db down'); }), REVIEW_NOW), /db down/);
  });

  describe('writeCheck: פקודה אחת, בלי טקסט הודעה (קריטריון 7)', () => {
    const body = { outcomeId: uuidOf(1), verdict: 'right' };
    test('INSERT ... SELECT ... WHERE ... RETURNING id אחד: חלון, נציג (rn = 1), תצוגה תואמת, ובלי התנאי "לא סומן"', async () => {
      const sql = fakeSql(() => [{ id: uuidOf(9000) }]);
      assert.equal(await writeCheck(sql, body, REVIEW_NOW), true);
      assert.equal(sql.calls.length, 1);
      const { text } = sql.calls[0];
      assert.match(text, /^INSERT INTO intake_checks \(outcome_id, verdict, event_type\) SELECT t\.id, \?::text, \?::text FROM \(/);
      assert.match(text, /RETURNING id$/);
      assert.match(text, /PARTITION BY COALESCE\(s\.content_hash, s\.id::text\), \(s\.received_at AT TIME ZONE 'Asia\/Jerusalem'\)::date ORDER BY o\.recorded_at DESC, o\.id DESC/);
      assert.match(text, /s\.channel = 'shortcut' AND o\.status <> 'duplicate'/);
      assert.match(text, /WHERE t\.id = \?::uuid AND t\.rn = 1 AND EXISTS \(SELECT 1 FROM facts f WHERE f\.source_id = t\.source_id AND f\.field = 'type'\) = \?::boolean/);
      assert.ok(!/NOT EXISTS|intake_checks c/.test(text), 'שינוי סימון מותר: אין תנאי "לא סומן"');
      assert.ok(!/raw_content/.test(text));
      assert.ok(!/\b(UPDATE|DELETE)\b/.test(text));
    });
    test('הפרמטרים: verdict, event_type, חלון הזמן, מזהה ה-outcome והתצוגה; אין שום טקסט הודעה', async () => {
      const sql = fakeSql(() => [{ id: uuidOf(9000) }]);
      await writeCheck(sql, { outcomeId: uuidOf(1), verdict: 'was_event', eventType: 'exam' }, REVIEW_NOW);
      assert.deepEqual(sql.calls[0].values, ['was_event', 'exam', iso(window.lower), iso(window.upper), iso(window.from), iso(window.from), iso(window.last), uuidOf(1), false]);
      const sql2 = fakeSql(() => [{ id: uuidOf(9000) }]);
      await writeCheck(sql2, body, REVIEW_NOW);
      assert.deepEqual(sql2.calls[0].values, ['right', null, iso(window.lower), iso(window.upper), iso(window.from), iso(window.from), iso(window.last), uuidOf(1), true]);
    });
    test('כל הצירופים: התצוגה התואמת לפי verdict (נרשם = right / wrong; לא נתפס = was_event / not_event), ו-event_type רק עם was_event', async () => {
      for (const verdict of REVIEW_VERDICTS) {
        for (const eventType of verdict === 'was_event' ? EVENT_TYPES : [null]) {
          const sql = fakeSql(() => [{ id: uuidOf(9000) }]);
          assert.equal(await writeCheck(sql, { outcomeId: uuidOf(1), verdict, eventType }, REVIEW_NOW), true);
          const { values } = sql.calls[0];
          assert.equal(values[0], verdict);
          assert.equal(values[1], eventType);
          assert.equal(values.at(-1), verdict === 'right' || verdict === 'wrong');
          assert.ok(values.every((v) => v === null || typeof v === 'boolean' || /^(right|wrong|was_event|not_event|short_day|cancel|move|exam|homework|room|early_leave|personal_event|\d{4}-\d\d-\d\dT[\d:.]+Z|[0-9a-f-]{36})$/.test(v)), `פרמטר לא צפוי: ${values}`);
        }
      }
    });
    test('לא נכתבה שורה (פקע, תצוגה אחרת, נציג אחר, לא קיים): false', async () => {
      assert.equal(await writeCheck(fakeSql(() => []), body, REVIEW_NOW), false);
      assert.equal(await writeCheck(fakeSql(() => undefined), body, REVIEW_NOW), false);
    });
    test('כשל מסד נזרק', async () => {
      await assert.rejects(() => writeCheck(fakeSql(() => { throw new Error('db down'); }), body, REVIEW_NOW), /db down/);
    });
  });
});

describe('review-view: בלי מחיקה, בלי עדכון, בלי AI, בלי טקסט בלוגים (קריטריונים 8 ו-11)', () => {
  const root = new URL('../', import.meta.url);
  const code = readFileSync(new URL('lib/review-view.js', root), 'utf8').split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  test('אין UPDATE או DELETE על intake_checks, ובכלל אין DELETE, DROP, TRUNCATE, ALTER או UPDATE בקובץ', () => {
    assert.doesNotMatch(code, /UPDATE\s+intake_checks|DELETE\s+FROM\s+intake_checks/i);
    assert.doesNotMatch(code, /\b(DELETE|DROP|TRUNCATE|UPDATE)\b|ALTER\s+TABLE/);
  });
  test('אין קריאת מודל, רשת או console בקובץ', () => {
    assert.doesNotMatch(code, /fetch\(|anthropic|gemini|generativelanguage|openai|console\./i);
  });
  test('הייבואים: קבצים מקומיים בלבד', () => {
    for (const match of readFileSync(new URL('lib/review-view.js', root), 'utf8').matchAll(/^import .* from '([^']+)';$/gm)) assert.match(match[1], /^\.\//, match[1]);
  });
  test('העמודות ש-review-view קורא וכותב קיימות ב-db/schema.sql', () => {
    const schema = readFileSync(new URL('db/schema.sql', root), 'utf8').split(/\r?\n/).map((line) => line.replace(/--.*$/, '')).join('\n');
    const columns = (table) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(schema)[1].split('\n').map((line) => /^\s*(\w+)\s+\w+/.exec(line)?.[1]).filter(Boolean);
    for (const column of ['id', 'source_id', 'status', 'recorded_at']) assert.ok(columns('intake_outcomes').includes(column), `intake_outcomes.${column}`);
    for (const column of ['id', 'channel', 'raw_content', 'content_hash', 'received_at']) assert.ok(columns('sources').includes(column), `sources.${column}`);
    for (const column of ['outcome_id', 'verdict', 'event_type']) assert.ok(columns('intake_checks').includes(column), `intake_checks.${column}`);
    for (const column of ['source_id', 'field', 'value']) assert.ok(columns('facts').includes(column), `facts.${column}`);
    for (const column of ['entity_id', 'entity_type', 'kind', 'awaiting_reply']) assert.ok(columns('messages').includes(column), `messages.${column}`);
  });
});
