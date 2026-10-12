// בדיקות ל-lib/intake-facts.js: חילוץ עובדות, שדות חיוניים, השלמה ממערכת השעות ורמת הוודאות (03-intake-rules.md:68-108, 35 סעיף 3.8.0).
// כל המשפטים מומצאים. אין שמות אנשים, טלפונים או הודעות אמיתיות. מערכת השעות כאן קטנה ונבנית בבדיקה (weekday: 1 = ראשון).
// 10.10.2026 הוא שבת, 11.10.2026 ראשון, 12.10 שני, 13.10 שלישי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, assessFacts, isUnderstood, ESSENTIAL_FIELDS, UNKNOWN_VALUE, slotMatchesSubject } from '../lib/intake-facts.js';

const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = {
  slots: [
    slot(1, 1, 'שיח אישי'), slot(1, 2, 'היסטוריה'), slot(1, 3, 'עברית'), slot(1, 4, 'תנ"ך'), slot(1, 5, 'אנגלית'), slot(1, 6, 'אנגלית'), slot(1, 7, 'מתמטיקה'),
    slot(2, 3, 'מתמטיקה'), slot(2, 4, 'מתמטיקה'), slot(2, 7, 'פיזיקה'), slot(2, 8, 'פיזיקה'), slot(2, 9, 'פיזיקה'),
    slot(5, 1, 'גיאומטריה'), slot(5, 2, 'גיאומטריה'),
  ],
};
const SATURDAY = '2026-10-10T08:00:00Z';
const SUNDAY = '2026-10-11T08:00:00Z';
const WEDNESDAY = '2026-10-07T08:00:00Z';
const THURSDAY = '2026-10-08T08:00:00Z';

const extract = (text, receivedAt = SUNDAY, extra = {}) => extractFacts({ text, receivedAt, channel: 'shortcut', timetable: TIMETABLE, ...extra });
const valueOf = (result, field) => result.facts.find((fact) => fact.field === field)?.value;
const originOf = (result, field) => result.facts.find((fact) => fact.field === field)?.origin;

describe('extractFacts: ודאות certain / probable / uncertain', () => {
  test('certain: כל השדות החיוניים נקראו מההודעה עצמה', () => {
    const result = extract('מבחן במתמטיקה ב-12.10 על שברים בשיעור 3');
    assert.deepEqual(result, {
      type: 'exam',
      facts: [
        { field: 'subject', value: 'מתמטיקה', origin: 'read', extracted_by: 'script' },
        { field: 'date', value: '2026-10-12', origin: 'read', extracted_by: 'script' },
        { field: 'topic', value: 'שברים', origin: 'read', extracted_by: 'script' },
        { field: 'lesson', value: '3', origin: 'read', extracted_by: 'script' },
      ],
      missing: [],
      certainty: 'certain',
      ambiguous: [],
      understood: true,
    });
  });
  test('probable: תאריך שנגזר מ"מחר" אינו נספר לטובת certain (03-intake-rules.md:64)', () => {
    const result = extract('מחר מבחן במתמטיקה על שברים בשיעור 7', SATURDAY);
    assert.equal(valueOf(result, 'date'), '2026-10-11');
    assert.equal(originOf(result, 'date'), 'inferred');
    assert.equal(result.certainty, 'probable');
    assert.deepEqual(result.missing, []);
    assert.equal(result.understood, true);
  });
  test('probable: שיעור שהושלם במועמד יחיד נחשב הסקה', () => {
    const result = extract('מבחן במתמטיקה ב-11.10 על שברים');
    assert.equal(valueOf(result, 'lesson'), '7');
    assert.equal(originOf(result, 'lesson'), 'inferred');
    assert.equal(result.certainty, 'probable');
    assert.deepEqual(result.ambiguous, []);
  });
  test('uncertain: השלמה עם יותר ממועמד אחד (אנגלית 5-6 ביום ראשון)', () => {
    const result = extract('מבחן באנגלית ביום ראשון על קריאה', THURSDAY);
    assert.equal(valueOf(result, 'date'), '2026-10-11');
    assert.equal(result.certainty, 'uncertain');
    assert.deepEqual(result.ambiguous, [{ field: 'lesson', candidates: ['5', '6'] }]);
    assert.deepEqual(result.missing, ['lesson']); // לא נבחר מועמד: השדה חסר והמערכת שואלת
    assert.equal(valueOf(result, 'lesson'), undefined);
  });
  test('uncertain: סתירה - שיעור ומקצוע שנקראו לא מתאימים למערכת השעות', () => {
    const result = extract('מבחן באנגלית ב-12.10 על קריאה בשיעור 3'); // שני, שיעור 3 = מתמטיקה
    assert.equal(result.certainty, 'uncertain');
    assert.deepEqual(result.ambiguous, []);
    assert.equal(valueOf(result, 'subject'), 'אנגלית');
    assert.equal(valueOf(result, 'lesson'), '3'); // מה שנקרא נשמר כמו שהוא
  });
  test('uncertain: מקצוע חסר עם כמה מקצועות באותו יום = שאלה עם כפתורי היום', () => {
    const result = extract('מחר מבחן');
    assert.equal(result.certainty, 'uncertain');
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['מתמטיקה', 'פיזיקה'] }]);
    assert.deepEqual(result.missing, ['subject', 'topic', 'lesson']);
    assert.equal(result.understood, false);
  });
  test('uncertain: "יום שלישי הבא" = שני תאריכים', () => {
    const result = extract('מבחן במתמטיקה ביום שלישי הבא על שברים');
    assert.equal(result.certainty, 'uncertain');
    assert.deepEqual(result.ambiguous, [{ field: 'date', candidates: ['2026-10-13', '2026-10-20'] }]);
    assert.equal(valueOf(result, 'date'), undefined);
    assert.ok(result.missing.includes('date'));
  });
  test('uncertain: כמה מקצועות בהודעה אחת', () => {
    const result = extract('מבחן באנגלית ובמתמטיקה מחר');
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['אנגלית', 'מתמטיקה'] }]);
    assert.equal(result.certainty, 'uncertain');
  });
  test('uncertain: שם יום ותאריך מפורש שסותרים', () => {
    const result = extract('מבחן במתמטיקה ביום שלישי 14.10 על שברים');
    assert.equal(result.certainty, 'uncertain');
    assert.deepEqual(result.ambiguous, [{ field: 'date', candidates: ['2026-10-14', '2026-10-13'] }]);
  });
  test('שדה חיוני שחסר (בלי מועמדים) = probable, ו"נושא" נשאל', () => {
    const result = extract('מבחן במתמטיקה ב-12.10 בשיעור 3');
    assert.deepEqual(result.missing, ['topic']);
    assert.equal(result.certainty, 'probable');
  });
});

describe('extractFacts: בלי מערכת שעות', () => {
  test('אין השלמה והשדה נשאר חסר', () => {
    for (const timetable of [null, undefined, { slots: [] }, {}]) {
      const result = extractFacts({ text: 'מחר מבחן במתמטיקה על שברים', receivedAt: SATURDAY, channel: 'app', timetable });
      assert.equal(valueOf(result, 'lesson'), undefined);
      assert.deepEqual(result.missing, ['lesson']);
      assert.deepEqual(result.ambiguous, []);
      assert.equal(result.certainty, 'probable');
    }
  });
  test('בלי מקצוע ובלי מערכת שעות: המקצוע חסר ללא מועמדים', () => {
    const result = extractFacts({ text: 'מחר מבחן', receivedAt: SUNDAY });
    assert.deepEqual(result.missing, ['subject', 'topic', 'lesson']);
    assert.deepEqual(result.ambiguous, []);
  });
});

describe('extractFacts: שדות חיוניים לפי סוג (35, סעיף 3.8.0)', () => {
  test('הטבלה', () => {
    assert.deepEqual(ESSENTIAL_FIELDS.exam, ['subject', 'date', 'topic', 'lesson']);
    assert.deepEqual(ESSENTIAL_FIELDS.homework, ['subject', 'date', 'topic', 'lesson']);
    assert.deepEqual(ESSENTIAL_FIELDS.cancel, ['subject', 'date', 'lesson']);
    assert.deepEqual(ESSENTIAL_FIELDS.room, ['subject', 'date', 'new_room', 'lesson']);
    assert.deepEqual(ESSENTIAL_FIELDS.move, ['subject', 'new_date', 'lesson']);
    assert.deepEqual(ESSENTIAL_FIELDS.short_day, ['date']);
  });
  test('מבחן ללא כלום: חסרים כל הארבעה', () => {
    const result = extractFacts({ text: 'יש מבחן', receivedAt: SUNDAY });
    assert.equal(result.type, 'exam');
    assert.deepEqual(result.missing, ['subject', 'date', 'topic', 'lesson']);
    assert.equal(result.understood, false);
  });
  test('שיעורי בית: תאריך הגשה מ"ליום ראשון", מקצוע מהטקסט, נושא חסר', () => {
    const result = extract('ליום ראשון להביא גיאומטריה', WEDNESDAY);
    assert.equal(result.type, 'homework');
    assert.equal(valueOf(result, 'subject'), 'גיאומטריה');
    assert.equal(valueOf(result, 'date'), '2026-10-11');
    assert.deepEqual(result.missing, ['topic', 'lesson']); // גיאומטריה אינה במערכת ביום ראשון
    assert.equal(result.understood, true);
  });
  test('שיעורי בית: "היום" לצד תאריך הגשה אחר - תאריך ההגשה (ל...) הוא שנבחר', () => {
    const result = extract('היום נתתי ש.ב במתמטיקה ליום שני על שברים', SUNDAY);
    assert.equal(valueOf(result, 'date'), '2026-10-12');
    assert.equal(valueOf(result, 'topic'), 'שברים');
  });
  test('ביטול: שיעורים 8 ו-9 מחר = פיזיקה, מושלם ממערכת השעות', () => {
    const result = extract('מחר לא יתקיימו שיעורים 8 ו-9');
    assert.equal(result.type, 'cancel');
    assert.equal(valueOf(result, 'subject'), 'פיזיקה');
    assert.equal(originOf(result, 'subject'), 'inferred');
    assert.equal(valueOf(result, 'date'), '2026-10-12');
    assert.equal(valueOf(result, 'lesson'), '8,9');
    assert.equal(originOf(result, 'lesson'), 'read');
    assert.deepEqual(result.missing, []);
    assert.equal(result.certainty, 'probable');
    assert.equal(result.understood, true);
  });
  test('ביטול: "אין מתמטיקה" ביום ראשון - שיעור 7 הושלם', () => {
    const result = extract('אין מתמטיקה היום');
    assert.equal(result.type, 'cancel');
    assert.equal(valueOf(result, 'lesson'), '7');
    assert.equal(result.certainty, 'probable');
  });
  test('מקצוע כאב מתאים לבניו: "מדעים" מול פיזיקה, "מתמטיקה" מול גיאומטריה', () => {
    const science = extract('אין מדעים מחר'); // שני: פיזיקה 7,8,9
    assert.deepEqual(science.ambiguous, [{ field: 'lesson', candidates: ['7', '8', '9'] }]);
    const math = extract('אין מתמטיקה ביום חמישי', SUNDAY); // חמישי: גיאומטריה 1,2
    assert.deepEqual(math.ambiguous, [{ field: 'lesson', candidates: ['1', '2'] }]);
    assert.equal(slotMatchesSubject('מתמטיקה (תרגול)', 'מתמטיקה'), true);
    assert.equal(slotMatchesSubject('מתמטיקה', 'גיאומטריה'), false);
    assert.equal(slotMatchesSubject('כימיה', 'פיזיקה'), false);
  });
  test('חדר: החדר החדש נקרא, השאר חסר', () => {
    const result = extract('השיעור הועבר לחדר 124');
    assert.equal(result.type, 'room');
    assert.equal(valueOf(result, 'new_room'), '124');
    assert.deepEqual(result.missing, ['subject', 'date', 'lesson']);
  });
  test('חדר: מקצוע ותאריך מהטקסט, שיעור דו-משמעי', () => {
    const result = extract('מחר באנגלית בחדר 124', SATURDAY);
    assert.equal(valueOf(result, 'subject'), 'אנגלית');
    assert.equal(valueOf(result, 'new_room'), '124');
    assert.deepEqual(result.ambiguous, [{ field: 'lesson', candidates: ['5', '6'] }]);
  });
  test('חדר: "מחדר 121 לחדר 124" - החדר החדש הוא זה של ל\'', () => {
    assert.equal(valueOf(extract('מחדר 121 לחדר 124 במתמטיקה'), 'new_room'), '124');
  });
  test('חדר: מעבדה', () => {
    assert.equal(valueOf(extract('מחר באנגלית במעבדה', SATURDAY), 'new_room'), 'מעבדה');
  });
  test('הזזה: "נדחה ליום שלישי" = המועד החדש; מקצוע חסר', () => {
    const result = extract('המבחן נדחה ליום שלישי');
    assert.equal(result.type, 'move');
    assert.equal(valueOf(result, 'new_date'), '2026-10-13');
    assert.deepEqual(result.missing, ['subject', 'lesson']);
  });
  test('הזזה: מיום ל-יום, והשיעור מושלם לפי המועד החדש', () => {
    const result = extract('המבחן במתמטיקה יידחה מיום שני ליום ראשון');
    assert.equal(valueOf(result, 'date'), '2026-10-12');
    assert.equal(valueOf(result, 'new_date'), '2026-10-18');
    assert.equal(valueOf(result, 'lesson'), '7');
    assert.deepEqual(result.missing, []);
    assert.equal(result.understood, true);
  });
  test('הזזה: "יידחה לשבוע הבא" בלי תאריך = המועד החדש חסר', () => {
    const result = extract('השיעור יידחה לשבוע הבא');
    assert.equal(result.type, 'move');
    assert.equal(valueOf(result, 'new_date'), undefined);
    assert.ok(result.missing.includes('new_date'));
  });
  test('הזזה: "ביום שלישי ... נדחה לשבוע הבא" = המועד המקורי ועוד שבוע', () => {
    const result = extract('המבחן במתמטיקה ביום שלישי נדחה לשבוע הבא');
    assert.equal(valueOf(result, 'date'), '2026-10-13');
    assert.equal(valueOf(result, 'new_date'), '2026-10-20');
    assert.equal(originOf(result, 'new_date'), 'inferred');
  });
  test('יום מקוצר: רק תאריך. נקרא = certain, מ"מחר" = probable', () => {
    const read = extract('יום מקוצר ב-14.10');
    assert.equal(read.type, 'short_day');
    assert.deepEqual(read.missing, []);
    assert.equal(read.certainty, 'certain');
    assert.equal(read.understood, true);
    const inferred = extract('מחר יום מקוצר, משתחררים ב-12:00');
    assert.equal(inferred.certainty, 'probable');
    assert.equal(inferred.facts.length, 1);
    assert.equal(inferred.understood, true);
  });
  test('יום מקוצר בלי תאריך: חסר רק התאריך (אין מקצוע ואין שיעור, וזה לא שדה חסר)', () => {
    const result = extract('משתחררת בשעה 13:25');
    assert.equal(result.type, 'short_day');
    assert.deepEqual(result.missing, ['date']);
    assert.equal(result.understood, false);
  });
});

describe('extractFacts: נושא או חומר', () => {
  test('אחרי על, בנושא, בפרק, בחומר', () => {
    assert.equal(valueOf(extract('מבחן באנגלית על קריאה ב-12.10'), 'topic'), 'קריאה');
    assert.equal(valueOf(extract('מבחן בהיסטוריה בנושא מלחמת העולם הראשונה ב-12.10'), 'topic'), 'מלחמת העולם הראשונה');
    assert.equal(valueOf(extract('מבחן במתמטיקה בפרק 3 ו-4 מחר'), 'topic'), 'פרק 3 ו-4');
    assert.equal(valueOf(extract('מבחן במתמטיקה בחומר של פרק 2 מחר'), 'topic'), 'פרק 2');
  });
  test('נעצר בפסיק, ביום ובשעה', () => {
    assert.equal(valueOf(extract('מבחן באנגלית על קריאה, מחר'), 'topic'), 'קריאה');
    assert.equal(valueOf(extract('מבחן באנגלית על קריאה ביום שלישי'), 'topic'), 'קריאה');
    assert.equal(valueOf(extract('מבחן באנגלית על פעלים בשיעור 3'), 'topic'), 'פעלים');
  });
  test('"על ידי" ו"על מתמטיקה" אינם נושא', () => {
    assert.equal(valueOf(extract('המבחן יתקיים על ידי המורה מחר'), 'topic'), undefined);
    assert.equal(valueOf(extract('מבחן על מתמטיקה מחר'), 'topic'), undefined);
    assert.equal(valueOf(extract('מבחן על מתמטיקה מחר'), 'subject'), 'מתמטיקה');
  });
  test('נושא לא נשאל על סוגים שאין להם נושא', () => {
    assert.equal(extract('הבוחן בוטל מחר').facts.some((fact) => fact.field === 'topic'), false);
  });
});

describe('extractFacts: שיעורים מהטקסט', () => {
  test('מספר, רשימה, טווח', () => {
    assert.equal(valueOf(extract('לא יהיה שיעור 3 מחר'), 'lesson'), '3');
    assert.equal(valueOf(extract('לא יתקיימו שיעורים 5-6 מחר'), 'lesson'), '5,6');
    assert.equal(valueOf(extract('לא יתקיימו שיעורים 1 עד 3 מחר'), 'lesson'), '1,2,3');
    assert.equal(valueOf(extract('לא יתקיימו שיעורים 8 ו-9 מחר'), 'lesson'), '8,9');
    assert.equal(valueOf(extract('לא יהיה שיעור מספר 4 מחר'), 'lesson'), '4');
  });
  test('"שיעורי בית" אינו מספר שיעור', () => {
    assert.equal(valueOf(extract('ש.ב 5 תרגילים במתמטיקה'), 'lesson'), undefined);
  });
});

describe('extractFacts: שאר ההתנהגויות', () => {
  test('הודעה שלא סווגה', () => {
    assert.deepEqual(extract('מה נשמע'), { type: null, facts: [], missing: [], certainty: 'uncertain', ambiguous: [], understood: false });
  });
  test('הודעה עם סימן שאלה נחלצת בכל זאת (שאלה כרשת ביטחון: ההחלטה אם לענות אינה כאן)', () => {
    const result = extract('מי עוד לא הגיש? מבחן באנגלית ב-12.10');
    assert.equal(result.type, 'exam');
    assert.equal(valueOf(result, 'date'), '2026-10-12');
  });
  test('הערוץ לא משנה את החילוץ', () => {
    const a = extractFacts({ text: 'מחר מבחן במתמטיקה', receivedAt: SATURDAY, channel: 'app', timetable: TIMETABLE });
    const b = extractFacts({ text: 'מחר מבחן במתמטיקה', receivedAt: SATURDAY, channel: 'shortcut', timetable: TIMETABLE });
    assert.deepEqual(a, b);
  });
  test('חותמת קליטה לא תקינה זורקת RangeError, גם להודעה שלא סווגה', () => {
    assert.throws(() => extractFacts({ text: 'מחר מבחן', receivedAt: 'לא תאריך' }), RangeError);
    assert.throws(() => extractFacts({ text: 'מה נשמע', receivedAt: undefined }), RangeError);
  });
  test('הפלט לא חולק מצב בין קריאות', () => {
    const first = extract('מחר מבחן');
    first.facts.push({ field: 'x' });
    first.ambiguous.push({ field: 'y' });
    assert.equal(extract('מחר מבחן').facts.some((fact) => fact.field === 'x'), false);
    const none = extract('מה נשמע');
    none.facts.push({ field: 'x' });
    assert.deepEqual(extract('מה נשמע').facts, []);
  });
  test('כל עובדה נושאת origin חוקי ו-extracted_by = script', () => {
    const result = extract('מחר לא יתקיימו שיעורים 8 ו-9');
    for (const fact of result.facts) {
      assert.ok(['read', 'inferred'].includes(fact.origin));
      assert.equal(fact.extracted_by, 'script');
      assert.equal(typeof fact.value, 'string');
    }
  });
});

describe('assessFacts ו-isUnderstood', () => {
  const fact = (field, value, origin = 'read') => ({ field, value, origin, extracted_by: 'script' });
  test('"לא יודע" נחשב ערך (ידוע-שאינו-ידוע), לא שדה חסר', () => {
    const facts = [fact('subject', 'מתמטיקה'), fact('date', '2026-10-12'), fact('topic', UNKNOWN_VALUE), fact('lesson', '3')];
    assert.deepEqual(assessFacts({ type: 'exam', facts }), { missing: [], certainty: 'certain' });
  });
  test('שדה חיוני מוסק מוריד ל-probable; חסר גם', () => {
    assert.equal(assessFacts({ type: 'cancel', facts: [fact('subject', 'מתמטיקה'), fact('date', '2026-10-12', 'inferred'), fact('lesson', '3')] }).certainty, 'probable');
    assert.deepEqual(assessFacts({ type: 'cancel', facts: [fact('subject', 'מתמטיקה')] }), { missing: ['date', 'lesson'], certainty: 'probable' });
  });
  test('עמימות או סתירה = uncertain', () => {
    const facts = [fact('subject', 'מתמטיקה'), fact('date', '2026-10-12'), fact('lesson', '3')];
    assert.equal(assessFacts({ type: 'cancel', facts, ambiguous: [{ field: 'x', candidates: ['a', 'b'] }] }).certainty, 'uncertain');
    assert.equal(assessFacts({ type: 'cancel', facts, contradiction: true }).certainty, 'uncertain');
  });
  test('סוג לא מוכר זורק', () => {
    assert.throws(() => assessFacts({ type: 'x', facts: [] }), RangeError);
  });
  test('isUnderstood: תאריך + מקצוע (בהזזה: המועד החדש; ביום מקוצר: תאריך בלבד); unknown אינו מפוענח', () => {
    assert.equal(isUnderstood('exam', [fact('subject', 'מתמטיקה'), fact('date', '2026-10-12')]), true);
    assert.equal(isUnderstood('exam', [fact('subject', 'מתמטיקה')]), false);
    assert.equal(isUnderstood('exam', [fact('subject', UNKNOWN_VALUE), fact('date', '2026-10-12')]), false);
    assert.equal(isUnderstood('move', [fact('subject', 'מתמטיקה'), fact('date', '2026-10-12')]), false);
    assert.equal(isUnderstood('move', [fact('subject', 'מתמטיקה'), fact('new_date', '2026-10-13')]), true);
    assert.equal(isUnderstood('short_day', [fact('date', '2026-10-12')]), true);
  });
});

// --- תיקוני ביקורת 12.10.2026 (סעיפים 1, 3, 4, 6, 7): חותמת קליטה ראשון 11.10.2026 18:00 בישראל, "מחר" = שני 12.10 ---
describe('extractFacts: תיקוני ביקורת 12.10', () => {
  const EVENING = '2026-10-11T15:00:00Z';
  const at = (text) => extract(text, EVENING);
  const has = (result, field) => result.facts.some((fact) => fact.field === field);

  test('סעיף 1: מבחן ושעה רחוקה אינם יום מקוצר, והמבחן נרשם', () => {
    const result = at('מחר מבחן בהיסטוריה בשעה 9:05. בסיום המבחן תוכלו ללכת הביתה');
    assert.equal(result.type, 'exam');
    assert.equal(valueOf(result, 'subject'), 'היסטוריה');
    assert.equal(valueOf(result, 'date'), '2026-10-12');
    assert.equal(at('המבחן מחר ב-8:15, מי שסיים יכול לצאת').type, 'exam');
    assert.equal(at('סיום הפרויקט עד יום ראשון ב-23:59').type, null);
  });

  test('סעיף 3: הנושא הוא מה שאחרי "על" שאחרי מילת הסוג, לא ה"על" הראשון בהודעה', () => {
    const result = at('על כולם להגיע בזמן. מחר מבחן בהיסטוריה על המהפכה הצרפתית');
    assert.equal(valueOf(result, 'topic'), 'המהפכה הצרפתית');
    assert.equal(valueOf(result, 'date'), '2026-10-12');
  });
  test('סעיף 3: אין "על" אחרי מילת הסוג = נושא חסר (נשאלת שאלה)', () => {
    const result = at('על כולם להגיע בזמן. מחר מבחן בהיסטוריה');
    assert.equal(has(result, 'topic'), false);
    assert.ok(result.missing.includes('topic'));
  });
  test('סעיף 3: בשיעורי בית הנושא אחרי "ש.ב", ובפרק/בנושא אחרי מילת הסוג', () => {
    assert.equal(valueOf(at('על כולם לשים לב: ש.ב בהיסטוריה על פרק 3'), 'topic'), 'פרק 3');
    assert.equal(valueOf(at('בנושא הזה כבר דיברנו. מחר בוחן במתמטיקה בנושא שברים'), 'topic'), 'שברים');
  });

  test('סעיף 4: "פרק 2.3" אינו תאריך והוא חלק מהנושא', () => {
    const result = at('מבחן במתמטיקה על פרק 2.3');
    assert.equal(has(result, 'date'), false);
    assert.equal(valueOf(result, 'topic'), 'פרק 2.3');
    assert.ok(result.missing.includes('date'));
  });
  test('סעיף 4: "בפרק 1.2 בשיעור 3": בלי תאריך, הנושא "פרק 1.2" והשיעור 3', () => {
    const result = at('בוחן בפיזיקה בפרק 1.2 בשיעור 3');
    assert.equal(has(result, 'date'), false);
    assert.equal(valueOf(result, 'topic'), 'פרק 1.2');
    assert.equal(valueOf(result, 'lesson'), '3');
  });
  test('סעיף 4: "תרגילים 2.1 עד 2.5" אינם תאריכים', () => {
    const result = at('שיעורי בית במתמטיקה: תרגילים 2.1 עד 2.5');
    assert.equal(result.type, 'homework');
    assert.equal(has(result, 'date'), false);
  });
  test('סעיף 4: תאריך אמיתי לצד מספר פרק נשאר תאריך', () => {
    const result = at('מבחן במתמטיקה על פרק 2.3 ב-15.10');
    assert.equal(valueOf(result, 'date'), '2026-10-15');
    assert.equal(valueOf(result, 'topic'), 'פרק 2.3');
  });

  test('סעיף 6: "אחרי שיעור 6" ו"משיעור 6" אינם השיעור המושפע; השיעור חסר ונשאלת שאלה', () => {
    for (const text of ['מחר משוחררים אחרי שיעור 6', 'התלמידים משוחררים מחר אחרי שיעור 4', 'משוחררים משיעור 6']) {
      const result = at(text);
      assert.equal(result.type, 'cancel', text);
      assert.equal(has(result, 'lesson'), false, text);
      assert.ok(result.missing.includes('lesson'), text);
    }
  });
  test('סעיף 6: "אחרי שיעור 4" לא מסיק מקצוע ממספר השיעור', () => {
    const result = at('התלמידים משוחררים מחר אחרי שיעור 4');
    assert.equal(valueOf(result, 'subject'), undefined);
    assert.deepEqual(result.ambiguous, [{ field: 'subject', candidates: ['מתמטיקה', 'פיזיקה'] }]);
  });
  test('סעיף 6: שיעור רגיל נשאר נקרא (ביקורת נגדית)', () => {
    assert.equal(valueOf(at('מחר לא יהיה שיעור 3'), 'lesson'), '3');
    assert.equal(valueOf(at('מחר לא יתקיימו שיעורים 3 ו-4 ומשוחררים אחרי שיעור 4'), 'lesson'), '3,4');
  });

  test('סעיף 7: "ביום שלישי בעוד שבועיים" = השלישי הקרוב ועוד 14 ימים', () => {
    const result = at('מבחן בהיסטוריה ביום שלישי בעוד שבועיים');
    assert.equal(valueOf(result, 'date'), '2026-10-27');
    assert.equal(originOf(result, 'date'), 'inferred');
  });
  test('סעיף 7: "ביום שלישי שעבר" לא מייצר תאריך (שדה חסר)', () => {
    const result = at('מבחן בהיסטוריה ביום שלישי שעבר');
    assert.equal(has(result, 'date'), false);
    assert.ok(result.missing.includes('date'));
  });
});
