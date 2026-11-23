// "תביא לי" (בלוק 8, אפיון-מורחב ה-16): זיהוי הבקשה, קריאת הפרטים, חיפוש בתמונות ותשובה. הכול בקוד; המוח רק מעתיק ביטויים.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBringMe, resolveRequestDate, readRequest, searchMedia, composeReply, answerBringMe } from '../lib/bring-me.js';
import { fakeSql } from './helpers.js';

// 2026-11-23 הוא יום שני. 12:00 בשעון ישראל.
const NOW = new Date('2026-11-23T10:00:00Z');
const TIMETABLE = { slots: [
  { weekday: 3, period: 3, startsAt: '10:05', endsAt: '10:50', subject: 'היסטוריה' },
  { weekday: 3, period: 4, startsAt: '10:55', endsAt: '11:40', subject: 'מתמטיקה' },
  { weekday: 1, period: 2, startsAt: '09:05', endsAt: '09:50', subject: 'היסטוריה' },
] };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('detectBringMe', () => {
  for (const text of [
    'תביא לי את הלוח מהשיעור בהיסטוריה',
    'תביא לי מה שצילמתי בשיעור מתמטיקה ביום שלישי',
    'תשלח לי את התמונה של הלוח',
    'תביא לי את הצילום מאתמול',
  ]) test(`כן: ${text}`, () => assert.equal(detectBringMe(text), true));
  for (const text of [
    'תביא לי מים', // אין מקצוע או מילת תמונה
    'תביא לי מחר',
    'לך תביא לי את הלוח', // הפועל לא ראשון
    'אני פנוי מחר?',
    'להביא ספר להיסטוריה',
    '',
    null,
  ]) test(`לא: ${String(text)}`, () => assert.equal(detectBringMe(text), false));
});

describe('resolveRequestDate (שעון ישראל, עבר)', () => {
  const cases = [
    ['אתמול', '2026-11-22'],
    ['מאתמול', '2026-11-22'],
    ['שלשום', '2026-11-21'],
    ['היום', '2026-11-23'],
    ['ביום שלישי', '2026-11-17'],
    ['ביום שני', '2026-11-23'],
    ["ביום ג'", '2026-11-17'],
    ['בשלישי', '2026-11-17'],
    ['ביום שלישי שעבר', '2026-11-17'],
    ['ביום שני שעבר', '2026-11-16'],
    ['ב-17.11', '2026-11-17'],
    ['ב-3.12', '2025-12-03'], // עתידי בשנה הזאת = השנה שעברה (בקשות הן על העבר)
  ];
  for (const [text, expected] of cases) test(`${text} -> ${expected}`, () => assert.equal(resolveRequestDate(text, NOW), expected));
  test('בלי ביטוי תאריך, או תאריך לא קיים: null', () => {
    assert.equal(resolveRequestDate('הלוח של ההיסטוריה', NOW), null);
    assert.equal(resolveRequestDate('ב-31.2', NOW), null);
    assert.equal(resolveRequestDate(null, NOW), null);
  });
  test('"שיעור שלישי" אינו יום שלישי', () => assert.equal(resolveRequestDate('בשיעור שלישי', NOW), null));
});

describe('readRequest', () => {
  test('נתיב הקוד: מקצוע, תאריך, שיעור', () => {
    const r = readRequest({ text: 'תביא לי את הלוח משיעור שלישי בהיסטוריה ביום שלישי', receivedAt: NOW });
    assert.deepEqual(r, { subjects: ['היסטוריה'], date: '2026-11-17', period: 3, topic: null });
  });
  test('שיעור במספר ובצורה "השלישי"', () => {
    assert.equal(readRequest({ text: 'תביא לי את הלוח משיעור 4', receivedAt: NOW }).period, 4);
    assert.equal(readRequest({ text: 'תביא לי את הלוח בשיעור השלישי', receivedAt: NOW }).period, 3);
  });
  test('המוח: המקצוע והנושא והביטוי מהמוח, הקוד מחשב את התאריך; מקצוע שלא ברשימה נפסל', () => {
    const understanding = { kind: 'bring_me', subject: 'היסטוריה', topic: 'המהפכה הצרפתית', date_text: 'אתמול' };
    assert.deepEqual(readRequest({ text: 'תביא לי את הלוח על המהפכה הצרפתית מאתמול', receivedAt: NOW, understanding }),
      { subjects: ['היסטוריה'], date: '2026-11-22', period: null, topic: 'המהפכה הצרפתית' });
    const invented = { kind: 'bring_me', subject: 'אסטרונומיה', topic: null, date_text: null };
    assert.deepEqual(readRequest({ text: 'תביא לי את הלוח', receivedAt: NOW, understanding: invented }).subjects, []);
  });
});

const row = (n, over = {}) => ({ id: uuid(n), received_at: '2026-11-17T08:20:00Z', subject: null, lesson_date: '2026-11-17', lesson_period: 3, task_title: null, ...over });

describe('searchMedia', () => {
  const rows = [
    row(1), // שלישי 17.11 שיעור 3 היסטוריה (מהמערכת)
    row(2, { lesson_period: 4, received_at: '2026-11-17T09:00:00Z' }), // שיעור 4 מתמטיקה
    row(3, { lesson_date: '2026-11-10', received_at: '2026-11-10T08:20:00Z' }), // שבוע קודם, היסטוריה
    row(4, { lesson_date: null, lesson_period: null, subject: 'מתמטיקה', received_at: '2026-11-20T15:00:00Z', task_title: 'שיעורי בית · מתמטיקה' }),
  ];
  test('מקצוע + תאריך: רק התמונה מאותו שיעור (המקצוע מהמערכת, לא מעמודה)', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: ['היסטוריה'], date: '2026-11-17', period: null, topic: null } });
    assert.equal(r.kind, 'exact');
    assert.deepEqual(r.items.map((i) => i.id), [uuid(1)]);
    assert.deepEqual(r.items[0], { id: uuid(1), date: '2026-11-17', period: 3, subject: 'היסטוריה' });
  });
  test('שיעור מסוים', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: [], date: '2026-11-17', period: 4, topic: null } });
    assert.deepEqual(r.items.map((i) => i.id), [uuid(2)]);
  });
  test('מקצוע בלי תאריך: הכי חדשה קודם, עם תקרה', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: ['היסטוריה'], date: null, period: null, topic: null }, limit: 1 });
    assert.deepEqual(r.items.map((i) => i.id), [uuid(1)]);
  });
  test('אין התאמה מדויקת: הקרובות (אותו מקצוע, תאריך אחר), kind near', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: ['היסטוריה'], date: '2026-11-18', period: null, topic: null } });
    assert.equal(r.kind, 'near');
    assert.deepEqual(r.items.map((i) => i.id), [uuid(1), uuid(3)]);
  });
  test('נושא: מתאים לכותרת המשימה', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: ['מתמטיקה'], date: null, period: null, topic: 'שיעורי בית' } });
    assert.equal(r.kind, 'exact');
    assert.deepEqual(r.items.map((i) => i.id), [uuid(4)]);
  });
  test('מקצוע שאין לו תמונות: none, לא ממציאים', () => {
    const r = searchMedia({ rows, timetable: TIMETABLE, request: { subjects: ['אנגלית'], date: null, period: null, topic: null } });
    assert.deepEqual(r, { kind: 'none', items: [] });
  });
  test('בלי שום סינון: התמונות האחרונות; בלי תמונות בכלל: none', () => {
    assert.equal(searchMedia({ rows, timetable: TIMETABLE, request: { subjects: [], date: null, period: null, topic: null } }).items[0].id, uuid(4));
    assert.deepEqual(searchMedia({ rows: [], timetable: TIMETABLE, request: { subjects: [], date: null, period: null, topic: null } }), { kind: 'none', items: [] });
  });
  test('תאריך מהמסד כ-Date ולא כמחרוזת', () => {
    const r = searchMedia({ rows: [row(1, { lesson_date: new Date('2026-11-17T00:00:00Z') })], timetable: TIMETABLE, request: { subjects: ['היסטוריה'], date: '2026-11-17', period: null, topic: null } });
    assert.equal(r.kind, 'exact');
  });
});

describe('composeReply', () => {
  const request = { subjects: ['היסטוריה'], date: null, period: null, topic: null };
  test('התאמה: מספר התמונות ושורה לכל תמונה (יום, תאריך, שיעור)', () => {
    const text = composeReply({ request, result: { kind: 'exact', items: [{ id: uuid(1), date: '2026-11-17', period: 3, subject: 'היסטוריה' }] } });
    assert.equal(text, 'מצאתי תמונה אחת מהשיעור בהיסטוריה:\nשלישי 17.11, שיעור 3');
  });
  test('כמה תמונות; תמונה בלי שיעור: רק התאריך', () => {
    const text = composeReply({ request, result: { kind: 'exact', items: [{ id: uuid(1), date: '2026-11-17', period: null, subject: null }, { id: uuid(2), date: '2026-11-10', period: 3, subject: 'היסטוריה' }] } });
    assert.match(text, /^מצאתי 2 תמונות מהשיעור בהיסטוריה:\nשלישי 17\.11\nשלישי 10\.11, שיעור 3$/);
  });
  test('קרוב: אומר במפורש שזה לא בדיוק מה שביקש', () => {
    const text = composeReply({ request: { ...request, date: '2026-11-18' }, result: { kind: 'near', items: [{ id: uuid(1), date: '2026-11-17', period: 3, subject: 'היסטוריה' }] } });
    assert.match(text, /^לא מצאתי בדיוק את מה שביקשת\. הכי קרוב, מהשיעור בהיסטוריה:/);
  });
  test('כלום: משפט פשוט, עם המקצוע כשנתבקש', () => {
    assert.equal(composeReply({ request, result: { kind: 'none', items: [] } }), 'אין לי תמונות שמורות מהשיעור בהיסטוריה.');
    assert.equal(composeReply({ request: { subjects: [], date: null, period: null, topic: null }, result: { kind: 'none', items: [] } }), 'אין לי עדיין תמונות שמורות.');
  });
});

describe('answerBringMe', () => {
  const source = { id: uuid(90), channel: 'app', raw_content: 'תביא לי את הלוח מהשיעור בהיסטוריה', received_at: NOW.toISOString() };
  const db = (rows) => fakeSql((text) => {
    if (text.includes('FROM media')) return rows;
    if (text.includes('WITH claim AS')) return [{ claimed: 1, bubbles_written: 1 }];
    return [];
  });
  test('מוצא, כותב בועה אחת + קישורים לתמונות + תפיסת מקור, באותה פקודה', async () => {
    const sql = db([row(1), row(3, { lesson_date: '2026-11-10', received_at: '2026-11-10T08:20:00Z' })]);
    const out = await answerBringMe({ sql, source, timetable: TIMETABLE });
    assert.equal(out.status, 'recorded');
    assert.match(out.reply, /^מצאתי 2 תמונות מהשיעור בהיסטוריה:/);
    const [write] = sql.find('WITH claim AS');
    assert.match(write.text, /UPDATE sources SET processed_at = now\(\)/);
    assert.match(write.text, /INSERT INTO links/);
    assert.ok(write.values.includes(out.reply));
    assert.ok(write.values.includes(JSON.stringify([uuid(1), uuid(3)])));
  });
  test('לא נמצא כלום: בועה בלי קישורים', async () => {
    const sql = db([]);
    const out = await answerBringMe({ sql, source, timetable: TIMETABLE });
    assert.equal(out.reply, 'אין לי תמונות שמורות מהשיעור בהיסטוריה.');
    assert.ok(sql.find('WITH claim AS')[0].values.includes('[]'));
  });
  test('המקור כבר טופל: skipped', async () => {
    const sql = fakeSql((text) => (text.includes('FROM media') ? [] : [{ claimed: 0, bubbles_written: 0 }]));
    const out = await answerBringMe({ sql, source, timetable: TIMETABLE });
    assert.equal(out.status, 'skipped');
  });
  test('המוח: kind bring_me עם subject ו-date_text', async () => {
    const sql = db([row(1)]);
    const understanding = { kind: 'bring_me', subject: 'היסטוריה', topic: null, date_text: 'ביום שלישי' };
    const out = await answerBringMe({ sql, source: { ...source, raw_content: 'תביא לי את הלוח של ההיסטוריה מיום שלישי' }, timetable: TIMETABLE, understanding });
    assert.match(out.reply, /^מצאתי תמונה אחת/);
  });
});
