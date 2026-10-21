// בדיקות שלב 8.3-1 ("זיהוי והבנה"): שני סוגים חדשים, early_leave (יציאה מוקדמת) ו-personal_event (אירוע אישי), ביטול "אין שיעור 5 ו-6" ו"שני השיעורים האחרונים",
// חישוב השיעורים שמפוספסים, וכרטיס האישור (שאלת confirm). כל המשפטים מומצאים (ההודעות של יובל מ-19.10 משוחזרות כמו שהן, בלי שמות ובלי טלפונים).
// מערכת השעות כאן היא האמיתית (data/school-timetable-taf-shin-pe-zayin.md דרך parseTimetableMarkdown). 19.10.2026 הוא יום שני, 08:30 בישראל (UTC+3).
// ה-SQL לא רץ מול Postgres: sql הוא מחליף בזיכרון (כמו בשאר הבדיקות); נבדק מה נכתב ובאיזו צורה.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyAll, classifyType, TYPES } from '../lib/intake-dictionary.js';
import { extractFacts, missedLessons, schoolDayEnd, assessFacts, isUnderstood, ESSENTIAL_FIELDS, UNKNOWN_VALUE } from '../lib/intake-facts.js';
import { buildQuestion, applyAnswer, formatReply, parseTypeAnswer, TYPE_LABELS, UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { processSource, pendingQuestion, answerQuestion, TYPE_FIELD } from '../lib/intake-process.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { resultText, missingFields, validCheckShape, EVENT_TYPES } from '../lib/review-view.js';
import { fakeSql } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const MONDAY_0830 = '2026-10-19T08:30:00+03:00';
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';

const extract = (text, extra = {}) => extractFacts({ text, receivedAt: MONDAY_0830, channel: 'app', timetable: TIMETABLE, ...extra });
const valueOf = (result, field) => result.facts.find((fact) => fact.field === field)?.value;
const originOf = (result, field) => result.facts.find((fact) => fact.field === field)?.origin;
const typeOf = (text, channel = 'app') => classifyAll(text, { channel })?.type ?? null;

const MSG1 = 'אני הולך מהבית ספר ב13:15 בגלל בדיקה רפואית';
const MSG2 = 'בדיקה רפואית היום ב-16:00';
const MSG3 = 'שיעורים 7, 8, 9 בוטלו היום';
const MSG4 = 'אין שיעור 5 ו-6 היום';
const CARD1 = 'יוצא ב-13:15, מפספס שיעורים 6, 7, 8, 9. נכון?';
const CARD2 = 'בדיקה רפואית, היום 16:00 עד 17:00. נכון?';

describe('8.3-1: ארבע ההודעות של 19.10 (שני 08:30, מערכת השעות האמיתית)', () => {
  test('הודעה 1: early_leave, תאריך היום (inferred), שעה 13:15, שיעורים 6,7,8,9 (inferred)', () => {
    const result = extract(MSG1);
    assert.equal(result.type, 'early_leave');
    assert.equal(valueOf(result, 'date'), '2026-10-19');
    assert.equal(originOf(result, 'date'), 'inferred');
    assert.equal(valueOf(result, 'time'), '13:15');
    assert.equal(originOf(result, 'time'), 'read');
    assert.equal(valueOf(result, 'lesson'), '6,7,8,9');
    assert.equal(originOf(result, 'lesson'), 'inferred');
    assert.equal(result.understood, true);
    assert.deepEqual(result.missing, [], 'confirm אינו עובדה שחולצה: לא ב-missing של החילוץ');
    assert.equal(result.certainty, 'probable', 'התאריך הוסק');
    assert.equal(result.facts.some((fact) => fact.field === 'subject'), false, 'אין מקצוע ביציאה מוקדמת');
  });
  test('הודעה 2: personal_event, כותרת "בדיקה רפואית", 16:00, סיום 17:00 (inferred)', () => {
    const result = extract(MSG2);
    assert.equal(result.type, 'personal_event');
    assert.equal(valueOf(result, 'date'), '2026-10-19');
    assert.equal(valueOf(result, 'time'), '16:00');
    assert.equal(valueOf(result, 'end_time'), '17:00');
    assert.equal(originOf(result, 'end_time'), 'inferred');
    assert.equal(valueOf(result, 'topic'), 'בדיקה רפואית');
    assert.equal(result.understood, true);
    assert.deepEqual(result.missing, []);
  });
  test('הודעה 3 נשארת כמו היום: cancel, פיזיקה (inferred), understood', () => {
    const result = extract(MSG3);
    assert.deepEqual(result, {
      type: 'cancel',
      facts: [
        { field: 'subject', value: 'פיזיקה', origin: 'inferred', extracted_by: 'script' },
        { field: 'date', value: '2026-10-19', origin: 'inferred', extracted_by: 'script' },
        { field: 'lesson', value: '7,8,9', origin: 'read', extracted_by: 'script' },
      ],
      missing: [],
      certainty: 'probable',
      ambiguous: [],
      understood: true,
    });
    assert.deepEqual(extract(MSG3, { channel: 'shortcut' }), result, 'אותו חילוץ בערוץ הקיצור');
  });
  test('"שיעורים 2, 3, 4" ביום שני: עמימות ספרות / מתמטיקה', () => {
    const result = extract('שיעורים 2, 3, 4 בוטלו היום');
    assert.equal(result.type, 'cancel');
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['ספרות', 'מתמטיקה'] }]);
    assert.equal(result.understood, false);
  });
  test('הודעה 4: cancel עם שיעורים 5,6; עמימות אנגלית / מדעי המחשב', () => {
    const result = extract(MSG4);
    assert.equal(result.type, 'cancel');
    assert.equal(valueOf(result, 'lesson'), '5,6');
    assert.equal(originOf(result, 'lesson'), 'read');
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['אנגלית', 'מדעי המחשב'] }]);
  });
  test('"אין שיעור 8 ו-9 היום": פיזיקה, understood', () => {
    const result = extract('אין שיעור 8 ו-9 היום');
    assert.equal(result.type, 'cancel');
    assert.equal(valueOf(result, 'subject'), 'פיזיקה');
    assert.equal(valueOf(result, 'lesson'), '8,9');
    assert.equal(result.understood, true);
  });
});

describe('8.3-1: חישוב שיעורים מפוספסים וסוף יום (D8)', () => {
  test('יציאה ב-13:15 בכל חמשת ימי השבוע (18 עד 22.10.2026)', () => {
    const expected = { 18: [6, 7], 19: [6, 7, 8, 9], 20: [6, 7], 21: [6, 7, 8, 9], 22: [6, 7, 8, 9] };
    for (const [day, periods] of Object.entries(expected)) assert.deepEqual(missedLessons(TIMETABLE, `2026-10-${day}`, '13:15'), periods, `אוקטובר ${day}`);
  });
  test('סוף היום לכל חמשת הימים', () => {
    const expected = { 18: '14:15', 19: '15:45', 20: '14:15', 21: '15:45', 22: '15:45' };
    for (const [day, end] of Object.entries(expected)) assert.equal(schoolDayEnd(TIMETABLE, `2026-10-${day}`), end, `אוקטובר ${day}`);
  });
  test('מקרי קצה: שיעור שנגמר בדיוק בשעת היציאה אינו מפוספס; 13:28; לפני תחילת היום; אחרי הסוף; שישי ושבת', () => {
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '13:25'), [7, 8, 9]);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '13:28'), [7, 8, 9]);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '08:00'), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '15:45'), [], 'שיעור 9 נגמר ב-15:45 בדיוק');
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '16:00'), []);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-23', '10:00'), [], 'שישי');
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-24', '10:00'), [], 'שבת');
    assert.equal(schoolDayEnd(TIMETABLE, '2026-10-23'), null);
    assert.equal(schoolDayEnd(TIMETABLE, '2026-10-24'), null);
  });
  test('בלי מערכת שעות או קלט לא תקין: [] / null, בלי לזרוק', () => {
    for (const bad of [null, undefined, {}, { slots: [] }, { slots: 'x' }]) {
      assert.deepEqual(missedLessons(bad, '2026-10-19', '13:15'), []);
      assert.equal(schoolDayEnd(bad, '2026-10-19'), null);
    }
    assert.deepEqual(missedLessons(TIMETABLE, '2026-02-31', '13:15'), []);
    assert.deepEqual(missedLessons(TIMETABLE, 'מחר', '13:15'), []);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', '1:15'), []);
    assert.deepEqual(missedLessons(TIMETABLE, '2026-10-19', 5), []);
    assert.equal(schoolDayEnd(TIMETABLE, 'x'), null);
  });
  test('בלי מערכת שעות: אין עובדת lesson ביציאה מוקדמת, והכרטיס בלי רשימה', () => {
    const result = extract(MSG1, { timetable: null });
    assert.equal(result.facts.some((fact) => fact.field === 'lesson'), false);
    assert.equal(result.understood, true);
    const card = buildQuestion({ field: 'confirm', type: 'early_leave', facts: result.facts, timetable: null, today: '2026-10-19' });
    assert.equal(card.text, 'יוצא ב-13:15. נכון?');
  });
});

describe('8.3-1: "שני השיעורים האחרונים" (cancel בלבד, הכרעה א)', () => {
  test('"שני השיעורים האחרונים בוטלו היום" ביום שני: שיעורים 8,9 (inferred), פיזיקה, נרשם', () => {
    const result = extract('שני השיעורים האחרונים בוטלו היום');
    assert.equal(result.type, 'cancel');
    assert.equal(valueOf(result, 'lesson'), '8,9');
    assert.equal(originOf(result, 'lesson'), 'inferred');
    assert.equal(valueOf(result, 'subject'), 'פיזיקה');
    assert.equal(originOf(result, 'subject'), 'inferred');
    assert.equal(valueOf(result, 'date'), '2026-10-19', '"שני" הוא מספר, לא יום שני הבא');
    assert.equal(result.understood, true);
    assert.deepEqual(result.ambiguous, []);
    assert.equal(formatReply({ type: 'cancel', subject: 'פיזיקה', date: '2026-10-19' }), 'נרשם · ביטול · פיזיקה · שני 19.10');
  });
  test('ניסוחים נוספים: שלושת / 3 / השיעור האחרון / ביום ראשון / בשני השיעורים', () => {
    assert.equal(valueOf(extract('שלושת השיעורים האחרונים בוטלו היום'), 'lesson'), '7,8,9');
    assert.equal(valueOf(extract('3 השיעורים האחרונים בוטלו היום'), 'lesson'), '7,8,9');
    assert.equal(valueOf(extract('השיעור האחרון בוטל היום'), 'lesson'), '9');
    assert.equal(valueOf(extract('שני השיעורים האחרונים בוטלו מחר'), 'lesson'), '6,7', 'שלישי 20.10 נגמר בשיעור 7');
    const sunday = extract('שני השיעורים האחרונים בוטלו מחר', { receivedAt: '2026-10-18T08:30:00+03:00' });
    assert.equal(valueOf(sunday, 'date'), '2026-10-19');
    assert.equal(valueOf(sunday, 'lesson'), '8,9');
    assert.equal(valueOf(extract('ארבעת השיעורים האחרונים בוטלו היום'), 'lesson'), '6,7,8,9');
  });
  test('כמה מקצועות בשיעורים האחרונים: עמימות, לא בחירה', () => {
    const result = extract('ארבעת השיעורים האחרונים בוטלו היום');
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['מדעי המחשב', 'פיזיקה'] }]);
  });
  test('"השיעורים האחרונים בוטלו" בלי מספר: לא ממציאים מספר, נשארים השדות החסרים', () => {
    const result = extract('השיעורים האחרונים בוטלו היום');
    assert.equal(result.type, 'cancel');
    assert.equal(result.facts.some((fact) => fact.field === 'lesson'), false);
    assert.equal(result.understood, false);
    assert.ok(result.missing.includes('lesson'));
  });
  test('שיעורים אחרונים אינם משפיעים על סוגים אחרים', () => {
    const exam = extract('מחר יש מבחן במתמטיקה בשני השיעורים האחרונים');
    assert.equal(exam.facts.some((fact) => fact.field === 'lesson'), false);
  });
  test('בלי מערכת שעות, או ביום בלי שיעורים: אין שיעורים אחרונים', () => {
    assert.equal(extract('שני השיעורים האחרונים בוטלו היום', { timetable: null }).facts.some((fact) => fact.field === 'lesson'), false);
    assert.equal(extract('שני השיעורים האחרונים בוטלו ביום שישי').facts.some((fact) => fact.field === 'lesson'), false);
  });
});

describe('8.3-1: המילון, early_leave', () => {
  const POSITIVE = [
    [MSG1, '13:15'],
    ['אני יוצא מוקדם מבית הספר היום ב-12:30', '12:30'],
    ['אני עוזב את בית הספר בשעה 12', '12:00'],
    ['הלכתי מהלימודים ב-11:05', '11:05'],
    ['אני יוצאת מהכיתה ב-10:00', '10:00'],
    ['מחר אני יוצא מבית הספר ב-13:15', '13:15'],
    ['אצא מוקדם מביה"ס מחר ב-12:40', '12:40'],
    ['אני הולך מוקדם מהכיתה היום ב-13:25', '13:25'],
    ['עזבתי את הלימודים ב-9:30', '09:30'],
    ['אני יוצא מהשיעור ב13:00 לרופא', '13:00'],
  ];
  test('לפחות שמונה ניסוחים חיוביים, בערוץ app', () => {
    for (const [text, time] of POSITIVE) {
      assert.equal(typeOf(text), 'early_leave', text);
      const result = extract(text);
      assert.equal(result.type, 'early_leave', text);
      assert.equal(valueOf(result, 'time'), time, text);
      assert.equal(result.understood, true, text);
    }
  });
  test('"מחר אני יוצא..." מסיק את שיעורי מחר (שלישי: 6,7)', () => {
    const result = extract('מחר אני יוצא מבית הספר ב-13:15');
    assert.equal(valueOf(result, 'date'), '2026-10-20');
    assert.equal(valueOf(result, 'lesson'), '6,7');
  });
  test('לא מזוהים כ-early_leave: אימון, גוף שלישי ורבים, בלי שעה, שלילה, הולך ל(בית ספר)', () => {
    const NEGATIVE = [
      'אני הולך לאימון ב-16:00',
      'המורה יוצאת ב-13:15',
      'המורה יוצאת מוקדם מהכיתה ב-13:15',
      'היא יוצאת מוקדם מהכיתה ב-13:15',
      'הולכים מוקדם לטיול ב-12:00',
      'אנחנו יוצאים מבית הספר ב-13:15',
      'אני הולך מהבית ספר',
      'אני יוצא מוקדם',
      'אני לא הולך מהבית ספר ב-13:15',
      'אני הולך לבית הספר ב-8:00',
      'אני הולך מהבית ספר אחרי שיעור 6',
      'אני יוצא לריצה ב-17:00',
    ];
    for (const text of NEGATIVE) assert.notEqual(typeOf(text), 'early_leave', text);
    for (const text of NEGATIVE) assert.notEqual(typeOf(text), 'personal_event', text);
  });
  test('"אני הולך לאימון ב-16:00" אינו מסווג בכלל', () => {
    assert.equal(typeOf('אני הולך לאימון ב-16:00'), null);
    assert.equal(typeOf('המורה יוצאת ב-13:15'), null);
    assert.equal(typeOf('הולכים מוקדם לטיול ב-12:00'), null);
  });
  test('ערוץ: בקיצור או בלי ערוץ הניסוחים לא נתפסים (התנהגות כמו לפני השלב)', () => {
    for (const [text] of POSITIVE) {
      assert.equal(typeOf(text, 'shortcut'), null, text);
      assert.equal(classifyAll(text)?.type ?? null, null, text);
      assert.equal(classifyType(text)?.type ?? null, null, text);
    }
    assert.equal(extract(MSG1, { channel: 'shortcut' }).type, null);
    assert.equal(extract(MSG1, { channel: undefined }).type, null);
  });
  test('בחירה כפויה (forcedType) עובדת בכל ערוץ', () => {
    const forced = extract(MSG1, { channel: 'shortcut', forcedType: 'early_leave' });
    assert.equal(forced.type, 'early_leave');
    assert.equal(valueOf(forced, 'time'), '13:15');
    assert.equal(valueOf(forced, 'lesson'), '6,7,8,9');
    const noTime = extract('אני הולך מהבית ספר', { forcedType: 'early_leave' });
    assert.equal(noTime.type, 'early_leave');
    assert.deepEqual(noTime.missing, ['time']);
    assert.equal(noTime.understood, false);
    assert.equal(noTime.facts.some((fact) => fact.field === 'lesson'), false, 'בלי שעה אין חישוב שיעורים');
  });
});

describe('8.3-1: המילון, personal_event', () => {
  const POSITIVE = [
    [MSG2, 'בדיקה רפואית', '16:00'],
    ['מחר ב-16:00 יש לי תור לרופא שיניים', 'תור לרופא שיניים', '16:00'],
    ['תור לרופא מחר ב-10:00', 'תור לרופא', '10:00'],
    ['יש לי תספורת היום בשעה 17', 'תספורת', '17:00'],
    ['בדיקת דם מחר ב-8:30', 'בדיקת דם', '08:30'],
    ['פיזיותרפיה ביום שלישי ב-18:00', 'פיזיותרפיה', '18:00'],
    ['שיננית ב-15:00 מחר', 'שיננית', '15:00'],
    ['תור לרופאה היום ב-13:40', 'תור לרופאה', '13:40'],
    ['אני צריך ללכת לרופא ב-17:15', 'רופא', '17:15'],
    ['הבדיקה הרפואית נקבעה להיום ב-14:00', 'בדיקה הרפואית', '14:00'],
  ];
  test('לפחות שמונה ניסוחים חיוביים, והכותרת היא המילים כפי שהוקלדו', () => {
    for (const [text, title, time] of POSITIVE) {
      assert.equal(typeOf(text), 'personal_event', text);
      const result = extract(text);
      assert.equal(result.type, 'personal_event', text);
      assert.equal(valueOf(result, 'topic'), title, text);
      assert.equal(valueOf(result, 'time'), time, text);
      assert.equal(result.understood, true, text);
    }
  });
  test('תאריך: "מחר" נקרא, "יום שלישי" נקרא, ובלי תאריך: היום (inferred)', () => {
    assert.equal(valueOf(extract('תור לרופא מחר ב-10:00'), 'date'), '2026-10-20');
    assert.equal(valueOf(extract('פיזיותרפיה ביום שלישי ב-18:00'), 'date'), '2026-10-20');
    const noDate = extract('תספורת ב-17:00');
    assert.equal(valueOf(noDate, 'date'), '2026-10-19');
    assert.equal(originOf(noDate, 'date'), 'inferred');
  });
  test('שעת סיום: "עד 17:30" ו"מ-16:00 עד 17:30" נקראות; סיום שאינו אחרי ההתחלה: מתעלמים; 23:xx: 23:59', () => {
    const range = extract('בדיקה רפואית מ-16:00 עד 17:30');
    assert.equal(valueOf(range, 'time'), '16:00');
    assert.equal(valueOf(range, 'end_time'), '17:30');
    assert.equal(originOf(range, 'end_time'), 'read');
    const until = extract('בדיקה רפואית עד 17:30 היום ב-16:00');
    assert.equal(valueOf(until, 'time'), '16:00');
    assert.equal(valueOf(until, 'end_time'), '17:30');
    const backwards = extract('בדיקה רפואית ב-16:00 עד 15:00');
    assert.equal(valueOf(backwards, 'end_time'), '17:00');
    assert.equal(originOf(backwards, 'end_time'), 'inferred');
    assert.equal(valueOf(extract('בדיקה רפואית ב-23:30'), 'end_time'), '23:59');
    assert.equal(valueOf(extract('בדיקה רפואית ב-9:15'), 'end_time'), '10:15');
  });
  test('לא מזוהים: בלי שעה, תאריך בלבד, "הרופא אמר", "בתור", שלילה, ערוץ קיצור', () => {
    const NEGATIVE = [
      'בדיקה רפואית היום',
      'תור לרופא מחר',
      'בדיקה רפואית ב-12.10',
      'הרופא אמר שיש מבחן מחר',
      'הרופא אמר שאני צריך לנוח ב-16:00',
      'אין לי תור לרופא ב-16:00',
      'לא יהיה תור לרופא היום ב-16:00',
      'בתור מורה אני מגיע ב-8:00',
      'לתור את העיר ב-16:00',
      'אני צריך להגיע ב-16:00',
    ];
    for (const text of NEGATIVE) assert.notEqual(typeOf(text), 'personal_event', text);
    assert.equal(typeOf('הרופא אמר שיש מבחן מחר'), 'exam', 'ההתנהגות הקיימת: מבחן');
    assert.equal(typeOf(MSG2, 'shortcut'), null);
    assert.equal(typeOf('תור לרופא מחר ב-10:00', 'shortcut'), null);
    assert.equal(classifyType(MSG2), null);
  });
  test('personal_event בעדיפות הנמוכה ביותר: לא משנה סוגים קיימים', () => {
    assert.equal(typeOf('מבחן במתמטיקה מחר ב-10:00 ובדיקה רפואית ב-16:00'), 'exam');
    assert.equal(typeOf('שיעורי בית בתור לרופא ב-16:00'), 'homework');
    assert.equal(typeOf('בדיקה רפואית ב-16:00 ושיעורים 8 ו-9 בוטלו'), 'cancel');
    assert.equal(typeOf('מועד ב ב-12:00, תור לרופא'), 'exam');
    assert.equal(typeOf('סיום ב-13:25 ובדיקה רפואית ב-16:00'), 'short_day');
    assert.equal(typeOf('חדר 124 ובדיקה רפואית ב-16:00'), 'room');
  });
  test('בחירה כפויה של אירוע אישי בלי שעה: חסרה שעה, והכותרת נשמרת', () => {
    const forced = extract('בדיקה רפואית היום', { forcedType: 'personal_event' });
    assert.equal(forced.type, 'personal_event');
    assert.deepEqual(forced.missing, ['time']);
    assert.equal(valueOf(forced, 'topic'), 'בדיקה רפואית');
    assert.equal(valueOf(forced, 'end_time'), undefined);
  });
});

describe('8.3-1: יציאה מוקדמת ואירוע אישי מול יום מקוצר ושאר הסוגים', () => {
  test('"סיום ב-13:25 היום" נשאר short_day, וגם שבעה ניסוחים נוספים של יום מקוצר', () => {
    const SHORT = ['סיום ב-13:25 היום', 'מסיימים ב-13:25', 'הכיתה משתחררת בשעה 13:25', 'יום מקוצר מחר', 'סיום ב-13:25 ובדיקה רפואית ב-16:00',
      'משתחררים ב-12:30, אני הולך לאימון', 'המורה משחררת ב-13:25 ואני הולך לאימון ב-16:00', 'מחר סיום ב-13:25 ותור לרופא ב-16:00'];
    for (const text of SHORT) assert.equal(typeOf(text), 'short_day', text);
  });
  test('early_leave גובר על short_day ועל personal_event', () => {
    assert.equal(typeOf('אני יוצא מוקדם מהבית ספר והכיתה משתחררת בשעה 13:25'), 'early_leave');
    assert.equal(typeOf('אני הולך מהבית ספר ב-13:25, סיום ב-13:25'), 'early_leave');
    assert.equal(typeOf(MSG1), 'early_leave');
  });
  test('ההודעות הקיימות נשארות: ביטול, מבחן, שיעורי בית, הזזה, חדר', () => {
    assert.equal(typeOf('מחר לא יתקיימו שיעורים 8 ו-9'), 'cancel');
    assert.equal(typeOf('מחר יש מבחן במתמטיקה'), 'exam');
    assert.equal(typeOf('שיעורי בית במתמטיקה'), 'homework');
    assert.equal(typeOf('השיעור יידחה לשבוע הבא'), 'move');
    assert.equal(typeOf('השיעור עבר לחדר 124'), 'room');
  });
  test('"אין שיעור" בלי מספר שיעור אינו ביטול; "אין שיעור מתמטיקה" נשאר כמו שהיה לפני השלב (לא מסווג)', () => {
    assert.equal(typeOf('אין שיעור היום'), null);
    assert.equal(typeOf('אין שיעור'), null);
    assert.equal(typeOf('אין שיעורי בית'), 'homework');
    assert.equal(typeOf('אין שיעור מתמטיקה מחר'), null, 'לא השתנה: גם לפני השלב לא נתפס (noSubject דורש מקצוע צמוד ל"אין")');
    assert.equal(typeOf('אין מתמטיקה מחר'), 'cancel');
    assert.equal(typeOf('אין שיעור 5'), 'cancel');
    assert.equal(typeOf('אין שיעורים 5-6'), 'cancel');
    assert.equal(valueOf(extract('אין שיעורים 5-6 היום'), 'lesson'), '5,6');
    assert.equal(typeOf('אין שיעור 12'), null, 'מספר שאינו שיעור');
  });
});

describe('8.3-1: תיקוני ביקורת עצמאית', () => {
  const typeAndTime = (text) => {
    const result = extract(text);
    return [result.type, valueOf(result, 'time')];
  };
  test('סעיף 1: "מוקדם" לבדו אינו early_leave ואינו דורס מבחן; ביטוי בית ספר חובה', () => {
    assert.deepEqual(typeAndTime('אני הולך מוקדם לישון כי מחר יש מבחן במתמטיקה ב-8:15'), ['exam', undefined]);
    assert.equal(extract('אני הולך מוקדם לישון כי מחר יש מבחן במתמטיקה ב-8:15').facts.find((f) => f.field === 'subject').value, 'מתמטיקה');
    assert.equal(typeOf('מחר יש מבחן במתמטיקה ואני יוצא מוקדם מהבית ב-7:00'), 'exam');
    assert.notEqual(typeOf('הבוחן יוצא מוקדם ב-10:00'), 'early_leave');
    for (const text of ['אני יוצא מוקדם מהאימון ב-17:00', 'יוצא מוקדם לריצה ב-6:00', 'אני הולך לאימון מוקדם ב-5:30', 'אני יוצא מוקדם מהבית ב-7:30', 'אני יוצא מוקדם ב-13:15']) {
      assert.equal(typeOf(text), null, text);
    }
    assert.equal(typeOf('אני יוצא מוקדם מהבית ספר ב-13:15'), 'early_leave', 'עם ביטוי בית ספר: כן');
  });
  test('סעיף 2: גוף שלישי לא נתפס (early_leave ו-personal_event); "יש לי תור" נשאר', () => {
    for (const text of ['אחי יוצא מוקדם מבית הספר ב-13:15', 'ירדן יוצאת מוקדם מבית הספר ב-13:15', 'המורה הזאת יוצאת מוקדם מבית הספר ב-13:15', 'לאחי יש תור לרופא ב-16:00', 'לאמא יש תור לרופא שיניים ב-17:00', 'לדנה יש תור לרופא ב-16:00', 'אמא שלי הולכת לרופא ב-16:00']) {
      assert.equal(typeOf(text), null, text);
    }
    assert.equal(typeOf('יש לי תור לרופא ב-16:00'), 'personal_event');
    assert.equal(typeOf('אחרי הלימודים יש לי תור לרופא שיניים ב-17:00'), 'personal_event');
    assert.equal(typeOf('הלכתי מבית הספר ב-13:15'), 'early_leave', 'צורת גוף ראשון מפורשת בלי "אני"');
    assert.equal(typeOf('הולך מבית הספר ב-13:15'), 'early_leave', 'הווה בלי "אני" וללא נושא אחר (סבב 3)');
    assert.equal(typeOf('ב-13:15 אני עוזב את בית הספר'), 'early_leave', '"אני" לפני הפועל, השעה לפניו');
  });
  test('סעיף 3: השעה הצמודה לפועל / לביטוי, לא הראשונה בהודעה', () => {
    assert.deepEqual(typeAndTime('המבחן בשני ב-10:00 ואני יוצא מוקדם מהכיתה ב-11:45'), ['early_leave', '11:45']);
    assert.deepEqual(typeAndTime('אימון ב-16:00 ותור לרופא ב-18:00'), ['personal_event', '18:00']);
    assert.equal(typeOf('תור לרופא מחר, אימון ב-17:00'), null);
    assert.equal(typeOf('אימון ריצה ב-17:00 אחרי הרופא'), null);
    assert.equal(typeOf('מחר ב-16:00 יש לי תור לרופא שיניים'), 'personal_event', 'שעה לפני הביטוי כשאין אחריו');
    assert.equal(typeOf('בדיקה רפואית ב-12:00 ולכן ירדתי, אימון ב-17:00'), 'personal_event');
    assert.equal(valueOf(extract('בדיקה רפואית ב-12:00 ולכן ירדתי, אימון ב-17:00'), 'time'), '12:00');
  });
  test('סעיף 4: יום בחודש אינו שעה', () => {
    for (const text of ['יש לי תור לרופא ב-20 לחודש', 'תור לרופא ב-3 בנובמבר', 'תור לרופא ב-2 בנובמבר', 'תור לרופא ב-5 לאוקטובר', 'בדיקה רפואית בשעה 15 לחודש']) {
      assert.equal(typeOf(text), null, text);
    }
    assert.equal(typeOf('יש לי תור לרופא ב-20'), 'personal_event', 'מספר חשוף אחרי ב כשלא ממשיך חודש');
    assert.equal(typeOf('תור לרופא ב-20:30'), 'personal_event');
    const forced = extract('תור לרופא ב-3 בנובמבר', { forcedType: 'personal_event' });
    assert.deepEqual(forced.missing, ['time'], 'גם בבחירה ידנית היום בחודש אינו שעה');
    assert.equal(applyAnswer({ facts: [], field: 'time', answer: 'ב-3 בנובמבר' }).find((f) => f.field === 'time'), undefined);
  });
  test('סעיף 5: כרטיס ליום בלי לימודים, כותרות בלי קידומת, "התור שלי" ו"חוזר מהרופא" לא מזוהים', () => {
    const friday = extract('אני יוצא מבית הספר ב-13:15 מחר', { receivedAt: '2026-10-22T08:30:00+03:00' });
    assert.equal(valueOf(friday, 'date'), '2026-10-23');
    const card = (facts, date) => buildQuestion({ field: 'confirm', type: 'early_leave', facts, timetable: TIMETABLE, today: '2026-10-22' }).text;
    assert.equal(card(friday.facts), 'מחר יוצא ב-13:15, אין לימודים באותו יום. נכון?');
    const afterLessons = [{ field: 'date', value: '2026-10-19' }, { field: 'time', value: '16:00' }];
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: afterLessons, timetable: TIMETABLE, today: '2026-10-19' }).text, 'יוצא ב-16:00, לא מפספס שיעורים. נכון?');
    assert.equal(valueOf(extract('ותור לרופא היום ב-16:00'), 'topic'), 'תור לרופא');
    assert.equal(valueOf(extract('אני הולך לרופא ב-16:00'), 'topic'), 'רופא');
    assert.equal(valueOf(extract('הלכתי לרופא ב-16:00'), 'topic'), 'רופא');
    assert.equal(valueOf(extract('בדיקה רפואית היום ב-16:00'), 'topic'), 'בדיקה רפואית', 'ב\' שורשית נשארת');
    assert.equal(valueOf(extract('ביום שלישי ובדיקת דם ב-8:30'), 'topic'), 'בדיקת דם');
    for (const text of ['אני חוזר מהרופא ב-16:00', 'התור שלי לשחק ב-16:00 בפלייסטיישן', 'חזרתי מהתספורת ב-16:00']) assert.equal(typeOf(text), null, text);
    assert.equal(typeOf('התור לרופא היום ב-16:00'), 'personal_event', '"לרופא" עדיין תופס');
  });
  test('סעיף 6 (ידוע ומקובל, בלי שינוי): "אין שיעור 5 בגלל מבחן" = cancel', () => {
    assert.equal(typeOf('אין שיעור 5 בגלל מבחן'), 'cancel');
  });
});

describe('8.3-1 סבב 3: ניסוחים טבעיים (שלישי 20.10.2026 21:10)', () => {
  const NIGHT = '2026-10-20T21:10:00+03:00';
  const run = (text) => extractFacts({ text, receivedAt: NIGHT, channel: 'app', timetable: TIMETABLE });
  const kind = (text) => run(text).type;
  test('סעיף 1: הווה בלי "אני" כשאין נושא אחר', () => {
    const result = run('יוצא מבית הספר ב-12 מחר');
    assert.equal(result.type, 'early_leave');
    assert.equal(valueOf(result, 'time'), '12:00');
    assert.equal(valueOf(result, 'date'), '2026-10-21');
    for (const text of ['הולך מהבית ספר מחר ב-11:30', 'מחר ב-12 עוזב את בית הספר', 'אז יוצא מהכיתה ב-12:00']) assert.equal(kind(text), 'early_leave', text);
    for (const text of ['אחי יוצא מבית הספר ב-13:15', 'ירדן יוצאת מבית הספר ב-13:15', 'המורה הזאת יוצאת מבית הספר ב-13:15', 'אחי יוצא מוקדם מבית הספר ב-13:15', 'המורה מחר יוצאת מהכיתה ב-12', 'הם יוצאים מבית הספר ב-12', 'הוא הולך מהבית ספר ב-12', 'אנחנו יוצאים מבית הספר ב-12', 'דנה הולכת מהבית ספר ב-12']) {
      assert.notEqual(kind(text), 'early_leave', text);
    }
  });
  test('סעיף 2: "הולך/יוצא הביתה מוקדם" רק בתוך יום לימודים (ראשון עד חמישי, 08:15 עד 15:45)', () => {
    for (const text of ['אני הולך הביתה מוקדם מחר ב12:00', 'אני יוצא הביתה מוקדם היום ב-10:00', 'הולך הביתה מוקדם מחר בשעה 8:15', 'אני הולך הביתה מוקדם מחר ב-15:45']) assert.equal(kind(text), 'early_leave', text);
    assert.equal(valueOf(run('אני הולך הביתה מוקדם מחר ב12:00'), 'time'), '12:00');
    assert.equal(valueOf(run('אני הולך הביתה מוקדם מחר ב12:00'), 'date'), '2026-10-21');
    for (const text of ['אני הולך הביתה מוקדם מהאימון ב-17:00', 'אני יוצא מוקדם מהבית ב-7:30', 'אני הולך לאימון מוקדם ב-5:30', 'אני הולך הביתה מוקדם ביום שישי ב-12:00', 'אני הולך הביתה מוקדם מחר ב-8:00', 'אני הולך הביתה מוקדם מחר ב-16:00', 'אני הולך הביתה מוקדם ביום שבת ב-12:00', 'אני הולך הביתה ב-12:00', 'אחי הולך הביתה מוקדם מחר ב-12:00']) {
      assert.equal(kind(text), null, text);
    }
    assert.equal(kind('אני הולך הביתה מוקדם ביום שישי ב-12:00 ומחר יש מבחן במתמטיקה'), 'exam', 'נופל לסוג הבא בתור, לא נעלם');
    assert.equal(classifyAll('אני הולך הביתה מוקדם מחר ב-12:00', { channel: 'shortcut' }), null);
  });
  test('סעיף 3: צריך / חייב / אמור + ללכת / לצאת / לעזוב + ביטוי בית ספר + שעה', () => {
    const result = run('אני צריך ללכת מהבית ספר מחר ב-12');
    assert.equal(result.type, 'early_leave');
    assert.equal(valueOf(result, 'time'), '12:00');
    for (const text of ['אני חייב לצאת מבית הספר מחר ב-11:30', 'אני אמור לעזוב את בית הספר מחר בשעה 12', 'אני צריכה לצאת מהכיתה מחר ב-12:15', 'צריך ללכת מהבית ספר מחר ב-12']) assert.equal(kind(text), 'early_leave', text);
    for (const text of ['אני צריך ללכת לרופא מחר בצהריים', 'אני צריך ללכת לאימון מחר ב-12', 'אני לא צריך ללכת מהבית ספר מחר ב-12', 'אחי צריך ללכת מהבית ספר מחר ב-12', 'אני צריך ללכת לבית הספר מחר ב-8']) {
      assert.notEqual(kind(text), 'early_leave', text);
    }
  });
  test('סעיף 4: "אין לנו / אין לי שיעור 8 ו9", "אין לנו שיעורים 8-9"', () => {
    for (const text of ['אין לנו שיעור 8 ו9 מחר', 'אין לנו שיעורים 8-9 מחר', 'אין לי שיעור 5 מחר', 'אין לכם שיעור 6 מחר']) assert.equal(kind(text), 'cancel', text);
    assert.equal(valueOf(run('אין לנו שיעור 8 ו9 מחר'), 'lesson'), '8,9');
    assert.equal(valueOf(run('אין לנו שיעורים 8-9 מחר'), 'lesson'), '8,9');
    assert.equal(valueOf(run('אין לנו שיעור 8 ו9 מחר'), 'date'), '2026-10-21');
    for (const text of ['אין לנו שיעורי בית', 'אין לנו שיעור מחר', 'אין לנו שיעורים אחרי 5 מחר', 'אין לי 5 מחברות']) assert.notEqual(kind(text), 'cancel', text);
  });
  test('סעיף 5: "מחר אין 8 ו-9" / "אין 5 ו-6 היום" רק עם מילת יום וכשהרצף בסוף משפט או לפני מילת יום', () => {
    for (const [text, lessons] of [['מחר אין 8 ו-9', '8,9'], ['אין 5 ו-6 היום', '5,6'], ['אין 8 ו-9 מחר', '8,9'], ['מחרתיים אין 7', '7'], ['אין 2-3 מחר', '2,3'], ['ביום שלישי אין 8 ו-9', '8,9']]) {
      const result = run(text);
      assert.equal(result.type, 'cancel', text);
      assert.equal(valueOf(result, 'lesson'), lessons, text);
    }
    for (const text of ['אין 8 ו-9 שקלים', 'אין לי 5 מחברות', 'אין 8 ו-9 שקלים מחר', 'מחר אין 5 מחברות', 'אין 5 ו-6', 'אין 8 ו-9', 'מחר אין 12', 'מחר אין שיעורים אחרי 5']) {
      assert.notEqual(kind(text), 'cancel', text);
    }
  });
  test('סעיף 6: מה שנשאר בכוונה לא נתפס (שעה במילים, "בצהריים", "אחרי 5", היעדרות)', () => {
    for (const text of ['יש לי תור מחר בארבע', 'אני צריך ללכת לרופא מחר בצהריים', 'אין שיעורים אחרי 5 מחר', 'נעדר מחר מבית הספר', 'לא אגיע מחר לבית הספר', 'אני יוצא מבית הספר בשמונה']) assert.equal(kind(text), null, text);
    assert.equal(kind('אני הולך לרופא ב-11, אז אני יוצא מבית הספר'), 'personal_event', 'נשאר אירוע אישי');
  });
  test('21 המשפטים של יובל: טבלת סוגים', () => {
    const expected = [
      ['יוצא מבית הספר ב-12 מחר', 'early_leave'], ['אני הולך הביתה מוקדם מחר ב12:00', 'early_leave'], ['מחר אני עוזב את בית הספר בשעה 12', 'early_leave'],
      ['מחר אני יוצא מהלימודים ב 12:00 בגלל רופא', 'early_leave'], ['אני צריך ללכת מהבית ספר מחר ב-12', 'early_leave'], ['אני אצא מהכיתה מחר בשעה 11:30', 'early_leave'],
      ['מחר אני לא בשיעורים האחרונים, יש לי רופא ב-12:00', 'personal_event'], ['אני הולך לרופא מחר ב-11, אז אני יוצא מבית הספר', 'personal_event'],
      ['יש לי מחר רופא ב-16:30', 'personal_event'], ['מחר ב-16:30 רופא שיניים', 'personal_event'], ['יש לי תור מחר בארבע', null], ['אני צריך ללכת לרופא מחר בצהריים', null],
      ['מחר יש לי בדיקת דם ב-8:00', 'personal_event'], ['יש לי פיזיותרפיה מחר ב-17:00', 'personal_event'], ['אין לנו שיעור 8 ו9 מחר', 'cancel'], ['בוטלו שיעורים 8-9 מחר', 'cancel'],
      ['מחר אין 8 ו-9', 'cancel'], ['השיעור האחרון מחר בוטל', 'cancel'], ['אין שיעורים אחרי 5 מחר', null], ['משתחררים מחר ב-12:00', 'cancel'], ['נעדר מחר מבית הספר', null],
    ];
    assert.equal(expected.length, 21);
    for (const [text, type] of expected) assert.equal(kind(text), type, text);
  });
});

describe('8.3-1 סבב ב\': תיקוני ביקורת נקייה (21.10.2026)', () => {
  test('סעיף 1: נושא אחר בגוף שלישי, גם עם מילה בין הנושא לפועל, שם פרטי או שם אחרי הפועל', () => {
    for (const text of ['דנה מחר יוצאת מבית הספר ב-12', 'עומר כבר יוצא מבית הספר ב-12', 'יוצא עומר מבית הספר ב-12', 'בן דודי הצעיר מחר יוצא מבית הספר ב-12', 'מורה למתמטיקה מחר יוצאת מבית הספר ב-12']) {
      assert.notEqual(typeOf(text), 'early_leave', text);
    }
  });
  test('סעיף 1: הניסוחים של יובל בלי "אני" נשארים early_leave', () => {
    for (const text of ['יוצא מבית הספר ב-12 מחר', 'הולך מהבית ספר מחר ב-11:30', 'מחר ב-12 עוזב את בית הספר', 'אז יוצא מהכיתה ב-12:00', 'יוצאת מהלימודים מחר בשעה 12', 'הולך מבית הספר ב-13:15', 'כבר יוצא מבית הספר ב-12']) {
      assert.equal(typeOf(text), 'early_leave', text);
    }
  });
  test('סבב ב\' שני: צורת נקבה בלי "אני" (יובל זכר) לא נתפסת; עם "אני" כן', () => {
    for (const text of ['מחר יוצאת מבית הספר ב-12', 'מחר הולכת הביתה מוקדם ב-12', 'יוצאת מבית הספר ב-12', 'מחר ב-12 יוצאת מבית הספר', 'עוזבת את בית הספר ב-12 מחר', 'מחר הולכת מוקדם מבית הספר ב-12', 'יוצאת מהלימודים מחר בשעה 12']) {
      assert.equal(typeOf(text), null, text);
    }
    assert.equal(typeOf('אני יוצאת מהכיתה ב-10:00'), 'early_leave');
  });
  test('סבב ב\' שני: שם, קרבה או כינוי אחרי הפועל או אחרי פסיק פוסלים', () => {
    for (const text of ['יוצא מבית הספר ב-12 מחר עומר', 'מחר יוצא מבית הספר ב-12 מתן', 'מחר מתן, יוצא מבית הספר ב-12', 'מחר יוצא מבית הספר ב-12 אחי', 'מחר יוצא מבית הספר ב-12 המורה', 'מחר יוצא מבית הספר ב-12 הילד', 'מחר יוצא מבית הספר ב-12 דני', 'מחר יוצא מבית הספר ב-12 הוא', 'מחר יוצא מבית הספר ב-12 היא']) {
      assert.notEqual(typeOf(text), 'early_leave', text);
    }
    for (const text of ['יוצא מוקדם מבית הספר ב-12 מחר', 'מחר יוצא מבית הספר בשעה 12', 'מחר אני יוצא מבית הספר ב-12 בגלל רופא']) assert.equal(typeOf(text), 'early_leave', text);
    assert.equal(typeOf('מחר יש מבחן במתמטיקה, יוצא מבית הספר ב-12'), 'exam');
  });
  test('סעיף 2: צורת "הביתה מוקדם" לא דורסת short_day; early_leave מפורש עם ביטוי בית ספר נשאר', () => {
    assert.equal(typeOf('מחר מסיימים ב-12 ואני הולך הביתה מוקדם'), 'short_day');
    assert.equal(typeOf('מחר יש מבחן במתמטיקה ויוצא מבית הספר ב-12'), 'exam');
    assert.equal(typeOf('אני הולך הביתה מוקדם מחר ב12:00'), 'early_leave');
    assert.equal(typeOf('אני חייב ללכת לרופא מבית הספר ב-12'), 'early_leave', 'יציאה מבית הספר לרופא: early_leave גובר (הכרעת 8.3-1)');
  });
  test('סעיף 3: "אין להם / אין להן שיעור" אינו ביטול; "אין לנו / לי / לכם" נשאר', () => {
    for (const text of ['אין להם שיעור 5 מחר', 'אין להן שיעור 5 מחר']) assert.notEqual(typeOf(text), 'cancel', text);
    for (const text of ['אין לנו שיעור 5 מחר', 'אין לי שיעור 5 מחר', 'אין לכם שיעור 6 מחר']) assert.equal(typeOf(text), 'cancel', text);
  });
});

describe('8.3-1: קבועים וסוגים', () => {
  test('TYPES, TYPE_LABELS, ESSENTIAL_FIELDS', () => {
    assert.ok(TYPES.includes('early_leave') && TYPES.includes('personal_event'));
    assert.equal(TYPE_LABELS.early_leave, 'יציאה מוקדמת');
    assert.equal(TYPE_LABELS.personal_event, 'אירוע אישי');
    assert.deepEqual(Object.values(TYPE_LABELS).slice(-3), ['יום מקוצר', 'יציאה מוקדמת', 'אירוע אישי'], 'הסדר: אחרי short_day');
    assert.deepEqual([...ESSENTIAL_FIELDS.early_leave], ['date', 'time', 'confirm']);
    assert.deepEqual([...ESSENTIAL_FIELDS.personal_event], ['date', 'time', 'confirm']);
  });
  test('assessFacts: confirm לא נספר בחוסר ובוודאות; isUnderstood דורש תאריך ושעה', () => {
    const facts = [{ field: 'date', value: '2026-10-19', origin: 'read' }, { field: 'time', value: '13:15', origin: 'read' }];
    assert.deepEqual(assessFacts({ type: 'early_leave', facts }), { missing: [], certainty: 'certain' });
    assert.deepEqual(assessFacts({ type: 'personal_event', facts: facts.slice(0, 1) }), { missing: ['time'], certainty: 'probable' });
    assert.equal(isUnderstood('early_leave', facts), true);
    assert.equal(isUnderstood('early_leave', facts.slice(0, 1)), false);
    assert.equal(isUnderstood('personal_event', [facts[0], { field: 'time', value: UNKNOWN_VALUE, origin: 'read' }]), false);
    assert.equal(isUnderstood('personal_event', facts.slice(1)), false);
  });
  test('"מה זה?" מציג שמונה תוויות; כל תווית חדשה מתפענחת', () => {
    const question = buildQuestion({ field: 'type' });
    assert.deepEqual(question.buttons.slice(0, -1), Object.values(TYPE_LABELS));
    assert.equal(question.buttons.length, 9);
    assert.equal(parseTypeAnswer('יציאה מוקדמת'), 'early_leave');
    assert.equal(parseTypeAnswer('אירוע אישי'), 'personal_event');
  });
  test('formatReply: בלי מקצוע ליציאה מוקדמת, כותרת לאירוע אישי', () => {
    assert.equal(formatReply({ type: 'early_leave', subject: 'מתמטיקה', date: '2026-10-19' }), 'נרשם · יציאה מוקדמת · שני 19.10');
    assert.equal(formatReply({ type: 'personal_event', title: 'בדיקה רפואית', date: '2026-10-19' }), 'נרשם · אירוע אישי · בדיקה רפואית · שני 19.10');
    assert.equal(formatReply({ type: 'personal_event', date: '2026-10-19' }), 'נרשם · אירוע אישי · שני 19.10');
    assert.equal(formatReply({ type: 'personal_event', title: UNKNOWN_VALUE, date: '2026-10-19' }), 'נרשם · אירוע אישי · שני 19.10');
  });
});

describe('8.3-1: כרטיס האישור (buildQuestion confirm)', () => {
  const fact = (field, value, origin = 'read') => ({ field, value, origin });
  test('יציאה מוקדמת: הנוסח שנקבע, כפתורים "נכון" ו"לא נכון", בלי "לא יודע" ובלי תיבת כתיבה', () => {
    const facts = [fact('date', '2026-10-19', 'inferred'), fact('time', '13:15'), fact('lesson', '6,7,8,9', 'inferred')];
    assert.deepEqual(buildQuestion({ field: 'confirm', type: 'early_leave', facts, timetable: TIMETABLE, today: '2026-10-19' }), {
      field: 'confirm', text: CARD1, buttons: ['נכון', 'לא נכון'], allowFreeText: false,
    });
  });
  test('שיעור יחיד, בלי שיעורים מפוספסים (עם מערכת שעות), ומחר / יום אחר', () => {
    const base = [fact('date', '2026-10-19', 'inferred'), fact('time', '15:50')];
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: [...base, fact('lesson', '9', 'inferred')], timetable: TIMETABLE, today: '2026-10-19' }).text, 'יוצא ב-15:50, מפספס שיעור 9. נכון?');
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: base, timetable: TIMETABLE, today: '2026-10-19' }).text, 'יוצא ב-15:50, לא מפספס שיעורים. נכון?');
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: base, timetable: null, today: '2026-10-19' }).text, 'יוצא ב-15:50. נכון?');
    const tomorrow = [fact('date', '2026-10-20', 'inferred'), fact('time', '13:15'), fact('lesson', '6,7', 'inferred')];
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: tomorrow, timetable: TIMETABLE, today: '2026-10-19' }).text, 'מחר יוצא ב-13:15, מפספס שיעורים 6, 7. נכון?');
    assert.equal(buildQuestion({ field: 'confirm', type: 'early_leave', facts: tomorrow, timetable: TIMETABLE, today: '2026-10-15' }).text, 'שלישי 20.10 יוצא ב-13:15, מפספס שיעורים 6, 7. נכון?');
  });
  test('אירוע אישי: כותרת, היום / מחר / יום ותאריך, שעת סיום', () => {
    const facts = [fact('date', '2026-10-19', 'inferred'), fact('time', '16:00'), fact('end_time', '17:00', 'inferred'), fact('topic', 'בדיקה רפואית')];
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts, today: '2026-10-19' }).text, CARD2);
    const tomorrow = [fact('date', '2026-10-20'), ...facts.slice(1)];
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts: tomorrow, today: '2026-10-19' }).text, 'בדיקה רפואית, מחר 16:00 עד 17:00. נכון?');
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts: tomorrow, today: '2026-10-18' }).text, 'בדיקה רפואית, שלישי 20.10 16:00 עד 17:00. נכון?');
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts: tomorrow }).text, 'בדיקה רפואית, שלישי 20.10 16:00 עד 17:00. נכון?', 'בלי today: יום ותאריך');
    assert.equal(buildQuestion({ field: 'confirm', type: 'personal_event', facts: [fact('date', '2026-10-19'), fact('time', '16:00')], today: '2026-10-19' }).text, 'אירוע אישי, היום 16:00. נכון?');
  });
  test('confirm רק לשני הסוגים החדשים; שאלת time עם "לא יודע" ותיבת כתיבה', () => {
    assert.throws(() => buildQuestion({ field: 'confirm', type: 'exam' }), RangeError);
    assert.throws(() => buildQuestion({ field: 'confirm' }), RangeError);
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave' }), { field: 'time', text: 'באיזו שעה?', buttons: [UNKNOWN_BUTTON], allowFreeText: true });
  });
  test('פענוח תשובת confirm: "נכון" = yes, "לא נכון" = no, כל דבר אחר = לא מפוענח', () => {
    const answer = (text) => applyAnswer({ facts: [], field: 'confirm', answer: text }).find((f) => f.field === 'confirm')?.value;
    assert.equal(answer('נכון'), 'yes');
    assert.equal(answer(' נכון. '), 'yes');
    assert.equal(answer('לא נכון'), 'no');
    for (const other of ['לא יודע', 'unknown', 'אולי', 'כן', 'לא', 'נכון מאוד', '']) assert.equal(answer(other), undefined, other);
  });
  test('פענוח תשובת time: 13:15, 13, ב-13:15, ב-13; לא תקין = לא מפוענח; לא יודע = unknown', () => {
    const answer = (text) => applyAnswer({ facts: [], field: 'time', answer: text }).find((f) => f.field === 'time')?.value;
    for (const [text, value] of [['13:15', '13:15'], ['13', '13:00'], ['ב-13:15', '13:15'], ['ב13:15', '13:15'], ['ב-13', '13:00'], ['בשעה 9', '09:00'], ['9:05', '09:05'], ['לא יודע', UNKNOWN_VALUE]]) {
      assert.equal(answer(text), value, text);
    }
    for (const bad of ['25:00', '13:75', 'מחר', 'אחרי הצהריים', '99', '12.10']) assert.equal(answer(bad), undefined, bad);
  });
});

// --- חיבור לצינור: processSource / pendingQuestion / answerQuestion (SQL מזויף) ---
const typedSource = (text, over = {}) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: `hash-${text}`, received_at: new Date(MONDAY_0830), ...over });
const factsJsonOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && value.startsWith('[{')));
const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));
const fact = (field, value, origin = 'read') => ({ field, value, origin });

describe('8.3-1: קליטה ב-processSource', () => {
  async function intake(text, over = {}) {
    const sql = fakeSql(() => []);
    const result = await processSource({ sql, source: typedSource(text, over), timetable: TIMETABLE });
    const writes = writesOf(sql);
    return { sql, result, writes, call: writes[0] };
  }
  test('הודעה 1: נרשם · יציאה מוקדמת, פקודה אחת, עובדות, כרטיס האישור כשאלה, ובועה', async () => {
    const { result, writes, call } = await intake(MSG1);
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · יציאה מוקדמת · שני 19.10' });
    assert.equal(writes.length, 1, 'פקודה אחת אטומית');
    assert.deepEqual(factsJsonOf(call), [
      { field: 'type', value: 'early_leave', origin: 'read' },
      { field: 'date', value: '2026-10-19', origin: 'inferred' },
      { field: 'time', value: '13:15', origin: 'read' },
      { field: 'lesson', value: '6,7,8,9', origin: 'inferred' },
    ]);
    assert.ok(call.values.includes(CARD1), 'הכרטיס הוא השאלה');
    assert.ok(call.values.includes('נרשם · יציאה מוקדמת · שני 19.10'), 'הבועה');
    assert.doesNotMatch(call.text, /\bDELETE\b/);
  });
  test('הודעה 2: נרשם · אירוע אישי · בדיקה רפואית, והכרטיס עם שעת הסיום', async () => {
    const { result, call } = await intake(MSG2);
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · אירוע אישי · בדיקה רפואית · שני 19.10' });
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}`), ['type=personal_event', 'date=2026-10-19', 'time=16:00', 'end_time=17:00', 'topic=בדיקה רפואית']);
    assert.ok(call.values.includes(CARD2));
  });
  test('הודעה 3 והודעה 4 בצינור: 3 נרשמת כמו היום, 4 שואלת מקצוע', async () => {
    const third = await intake(MSG3);
    assert.deepEqual(third.result, { status: 'recorded', reply: 'נרשם · ביטול · פיזיקה · שני 19.10' });
    assert.equal(third.call.values.includes('איזה מקצוע?'), false);
    const fourth = await intake(MSG4);
    assert.equal(fourth.result.status, 'recorded');
    assert.equal(fourth.result.reply, 'התקבל');
    assert.ok(fourth.call.values.includes('איזה מקצוע?'));
  });
  test('"שני השיעורים האחרונים בוטלו היום": נרשם · ביטול · פיזיקה · שני 19.10', async () => {
    const { result, call } = await intake('שני השיעורים האחרונים בוטלו היום');
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · ביטול · פיזיקה · שני 19.10' });
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}:${f.origin}`), ['type=cancel:read', 'subject=פיזיקה:inferred', 'date=2026-10-19:inferred', 'lesson=8,9:inferred']);
  });
  test('ערוץ הקיצור: אותו משפט לא נרשם כיציאה מוקדמת (נופל כמו היום)', async () => {
    const { result, writes } = await intake(MSG1, { channel: 'shortcut' });
    assert.deepEqual(result, { status: 'unclassified', reply: 'התקבל' });
    assert.equal(writes.length, 0);
  });
  test('בלי שעה: "אני הולך מהבית ספר" נופל לשאלת "מה זה?" (כמו היום)', async () => {
    const { result, call } = await intake('אני הולך מהבית ספר');
    assert.equal(result.status, 'unclassified');
    assert.ok(call.values.includes('מה זה?'));
  });
  test('שמונת הניסוחים החיוביים עוברים את מסנני הצינור (משימה / שאלה) ונרשמים', async () => {
    const samples = [
      ['אני יוצא מוקדם מבית הספר היום ב-12:30', 'נרשם · יציאה מוקדמת · שני 19.10'],
      ['אני עוזב את בית הספר בשעה 12', 'נרשם · יציאה מוקדמת · שני 19.10'],
      ['מחר ב-16:00 יש לי תור לרופא שיניים', 'נרשם · אירוע אישי · תור לרופא שיניים · שלישי 20.10'],
      ['תור לרופא מחר ב-10:00', 'נרשם · אירוע אישי · תור לרופא · שלישי 20.10'],
      ['יש לי תספורת היום בשעה 17', 'נרשם · אירוע אישי · תספורת · שני 19.10'],
      ['בדיקת דם מחר ב-8:30', 'נרשם · אירוע אישי · בדיקת דם · שלישי 20.10'],
    ];
    for (const [text, reply] of samples) assert.equal((await intake(text)).result.reply, reply, text);
  });
});

describe('8.3-1: pendingQuestion ו-answerQuestion', () => {
  const SAVED_EARLY = [fact(TYPE_FIELD, 'early_leave'), fact('date', '2026-10-19', 'inferred'), fact('time', '13:15'), fact('lesson', '6,7,8,9', 'inferred')];
  const SAVED_EVENT = [fact(TYPE_FIELD, 'personal_event'), fact('date', '2026-10-19', 'inferred'), fact('time', '16:00'), fact('end_time', '17:00', 'inferred'), fact('topic', 'בדיקה רפואית')];

  function answerDb({ src, facts, written = [{ closed: 1 }] }) {
    const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
    return fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [messageRow];
      if (text.includes('FROM sources WHERE id')) return [src];
      if (text.includes('FROM facts WHERE source_id')) return facts;
      if (text.includes('INTO facts')) return written;
      return [];
    });
  }

  test('pendingQuestion: אחרי הקליטה השאלה הפתוחה היא כרטיס האישור, נגזר מהעובדות', () => {
    assert.deepEqual(pendingQuestion({ source: typedSource(MSG1), facts: SAVED_EARLY, timetable: TIMETABLE }), {
      field: 'confirm', text: CARD1, buttons: ['נכון', 'לא נכון'], allowFreeText: false,
    });
    assert.equal(pendingQuestion({ source: typedSource(MSG2), facts: SAVED_EVENT, timetable: TIMETABLE }).text, CARD2);
  });
  test('pendingQuestion: אחרי תשובת confirm אין שאלה (yes ו-no)', () => {
    for (const value of ['yes', 'no']) {
      assert.equal(pendingQuestion({ source: typedSource(MSG1), facts: [...SAVED_EARLY, fact('confirm', value)], timetable: TIMETABLE }), null, value);
      assert.equal(pendingQuestion({ source: typedSource(MSG2), facts: [...SAVED_EVENT, fact('confirm', value)], timetable: TIMETABLE }), null, value);
    }
  });
  test('pendingQuestion: שעה חסרה נשאלת לפני האישור; שעה unknown: אין כרטיס אישור', () => {
    const noTime = [fact(TYPE_FIELD, 'early_leave'), fact('date', '2026-10-19', 'inferred')];
    const question = pendingQuestion({ source: typedSource('אני הולך מהבית ספר'), facts: noTime, timetable: TIMETABLE });
    assert.deepEqual(question, { field: 'time', text: 'באיזו שעה?', buttons: [UNKNOWN_BUTTON], allowFreeText: true });
    assert.equal(pendingQuestion({ source: typedSource('אני הולך מהבית ספר'), facts: [...noTime, fact('time', UNKNOWN_VALUE)], timetable: TIMETABLE }), null);
  });

  for (const [label, answer, value] of [['נכון', 'נכון', 'yes'], ['לא נכון', 'לא נכון', 'no']]) {
    test(`answerQuestion "${label}": העובדה confirm=${value} נשמרת, השאלה נסגרת, ואין בועת "נרשם" נוספת`, async () => {
      for (const [text, saved, reply] of [[MSG1, SAVED_EARLY, 'נרשם · יציאה מוקדמת · שני 19.10'], [MSG2, SAVED_EVENT, 'נרשם · אירוע אישי · בדיקה רפואית · שני 19.10']]) {
        const sql = answerDb({ src: typedSource(text), facts: saved });
        const result = await answerQuestion({ sql, messageId: MSG_ID, answer, now: new Date(MONDAY_0830), timetable: TIMETABLE });
        assert.deepEqual(result, { done: true, reply, status: 'answered', created: { answerSourceId: null, bubbleId: null, questionId: null } });
        const writes = writesOf(sql);
        assert.equal(writes.length, 1, 'פקודה אחת אטומית');
        assert.ok(writes[0].text.includes('UPDATE messages SET awaiting_reply = false'), 'השאלה נסגרת');
        assert.deepEqual(factsJsonOf(writes[0]), [{ field: 'confirm', value, origin: 'read' }], 'רק העובדה החדשה');
        assert.equal(writes[0].values.filter((v) => typeof v === 'string' && v.startsWith('נרשם')).length, 0, 'אין בועת "נרשם" נוספת');
        assert.equal(writes[0].values.filter((v) => typeof v === 'string' && v.endsWith('נכון?')).length, 0, 'אין שאלה חדשה');
        assert.doesNotMatch(writes[0].text, /\bDELETE\b/);
      }
    });
  }
  test('answerQuestion: תשובה לא ברורה ("אולי", "לא יודע") משאירה את השאלה פתוחה, בלי כתיבה', async () => {
    for (const answer of ['אולי', 'לא יודע', '']) {
      const sql = answerDb({ src: typedSource(MSG1), facts: SAVED_EARLY });
      const result = await answerQuestion({ sql, messageId: MSG_ID, answer, now: new Date(MONDAY_0830), timetable: TIMETABLE });
      assert.deepEqual(result, { done: false, reply: CARD1, status: 'unclear', created: { answerSourceId: null, bubbleId: null, questionId: null } }, answer);
      assert.equal(writesOf(sql).length, 0);
    }
  });
  test('"מה זה?" -> אירוע אישי: עובדות נשמרות, ונשאלת שעה; אחרי השעה נרשם + כרטיס אישור', async () => {
    const src = typedSource('בדיקה רפואית היום');
    // 1. שאלת הסוג פתוחה (אין עובדות), יובל בוחר "אירוע אישי".
    const first = answerDb({ src, facts: [] });
    const chosen = await answerQuestion({ sql: first, messageId: MSG_ID, answer: 'אירוע אישי', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(chosen.done, false);
    assert.equal(chosen.reply, 'באיזו שעה?');
    assert.deepEqual(factsJsonOf(writesOf(first)[0]).map((f) => `${f.field}=${f.value}`), ['type=personal_event', 'date=2026-10-19', 'topic=בדיקה רפואית']);
    // 2. השעה נשאלת; התשובה "16:00" מבטלת את ההמתנה: נרשם (בפעם הראשונה) ונשאל כרטיס האישור.
    const savedAfterType = [fact(TYPE_FIELD, 'personal_event'), fact('date', '2026-10-19', 'inferred'), fact('topic', 'בדיקה רפואית')];
    const second = answerDb({ src, facts: savedAfterType });
    const timed = await answerQuestion({ sql: second, messageId: MSG_ID, answer: '16:00', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(timed.done, false);
    assert.equal(timed.reply, CARD2);
    const call = writesOf(second)[0];
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}:${f.origin}`), ['time=16:00:read', 'end_time=17:00:inferred']);
    assert.ok(call.values.includes('נרשם · אירוע אישי · בדיקה רפואית · שני 19.10'), 'בועת נרשם ברגע ההבנה הראשון');
  });
  test('"מה זה?" -> יציאה מוקדמת בערוץ קיצור (בחירה כפויה): עובדות ושעה נשאלת', async () => {
    const src = typedSource('הלכתי מהבית ספר', { channel: 'app' });
    const sql = answerDb({ src, facts: [] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'יציאה מוקדמת', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.reply, 'באיזו שעה?');
    assert.deepEqual(factsJsonOf(writesOf(sql)[0]).map((f) => f.field), ['type', 'date']);
  });
  test('"שני השיעורים האחרונים בוטלו" בלי תאריך: אחרי שהתאריך נענה, השיעורים והמקצוע נגזרים', async () => {
    const src = typedSource('שני השיעורים האחרונים בוטלו');
    const saved = [fact(TYPE_FIELD, 'cancel')];
    const sql = answerDb({ src, facts: saved });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'היום · שני 19.10.2026', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.done, true);
    assert.equal(result.reply, 'נרשם · ביטול · פיזיקה · שני 19.10');
    assert.deepEqual(factsJsonOf(writesOf(sql)[0]).map((f) => `${f.field}=${f.value}:${f.origin}`).sort(), ['date=2026-10-19:read', 'lesson=8,9:inferred', 'subject=פיזיקה:inferred']);
  });
});

describe('8.3-1: review-view', () => {
  const facts = (obj) => new Map(Object.entries(obj));
  test('resultText לסוגים החדשים: לא null ולא undefined', () => {
    assert.equal(resultText(facts({ type: 'early_leave', date: '2026-10-19', time: '13:15', lesson: '6,7,8,9' })), 'יציאה מוקדמת · שני 19.10');
    assert.equal(resultText(facts({ type: 'personal_event', date: '2026-10-19', time: '16:00', topic: 'בדיקה רפואית' })), 'אירוע אישי · בדיקה רפואית · שני 19.10');
    assert.equal(resultText(facts({ type: 'personal_event', date: '2026-10-19' })), 'אירוע אישי · שני 19.10');
    assert.equal(resultText(facts({ type: 'personal_event', topic: 'בדיקה רפואית' })), 'אירוע אישי · בדיקה רפואית', 'בלי תאריך: מה שידוע');
    assert.equal(resultText(facts({ type: 'early_leave' })), 'יציאה מוקדמת');
    assert.equal(resultText(facts({ type: 'early_leave', date: 'unknown' })), 'יציאה מוקדמת · לא ידוע');
    for (const type of ['early_leave', 'personal_event']) assert.ok(!String(resultText(facts({ type, date: '2026-10-19' }))).includes('undefined'));
  });
  test('missingFields: שעה ואישור בלי undefined', () => {
    assert.deepEqual(missingFields(facts({ type: 'early_leave', date: '2026-10-19' }), true), ['שעה', 'אישור']);
    assert.deepEqual(missingFields(facts({ type: 'personal_event', date: '2026-10-19', time: '16:00' }), true), ['אישור']);
    assert.deepEqual(missingFields(facts({ type: 'personal_event', date: '2026-10-19', time: '16:00', confirm: 'no' }), true), []);
    assert.deepEqual(missingFields(facts({ type: 'early_leave', date: '2026-10-19' }), false), [], 'בלי שאלה פתוחה לא מוצג חסר');
  });
  test('validCheckShape מקבל את הסוגים החדשים רק עם was_event', () => {
    assert.deepEqual(EVENT_TYPES.slice(-2), ['early_leave', 'personal_event']);
    for (const eventType of ['early_leave', 'personal_event']) {
      assert.equal(validCheckShape({ verdict: 'was_event', eventType }), true, eventType);
      assert.equal(validCheckShape({ verdict: 'right', eventType }), false, eventType);
      assert.equal(validCheckShape({ verdict: 'not_event', eventType }), false, eventType);
    }
    assert.equal(validCheckShape({ verdict: 'was_event', eventType: 'party' }), false);
  });
});

describe('8.3-1: אין AI ואין כתיבה ליומן בקבצי הקליטה', () => {
  test('אין generativelanguage / anthropic / googleapis בקבצי הקליטה', () => {
    for (const file of ['api/intake.js', 'lib/intake-dictionary.js', 'lib/intake-facts.js', 'lib/intake-questions.js', 'lib/intake-text.js', 'lib/intake-process.js', 'lib/intake-dates.js', 'lib/intake-intent.js']) {
      const code = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      assert.doesNotMatch(code, /generativelanguage|anthropic|googleapis/i, file);
    }
  });
});
