// בדיקות ל-lib/intake-questions.js: שאלות הבהרה, תשובות, דפוסי כללים ותשובת "נרשם" (35 סעיף 3.8.0; 03-messaging-rules.md:258-275).
// כל המשפטים מומצאים. אין שמות אנשים, טלפונים או הודעות אמיתיות.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuestion, applyAnswer, answerPattern, formatReply, UNKNOWN_BUTTON, RECEIVED_REPLY, DUPLICATE_REPLY, TYPE_LABELS,
} from '../lib/intake-questions.js';
import { extractFacts, assessFacts, UNKNOWN_VALUE } from '../lib/intake-facts.js';
import { fellThroughRoots } from '../lib/intake-dictionary.js';

const slot = (weekday, period, subject) => ({ weekday, period, startsAt: '08:15', endsAt: '09:00', subject, teacher: null, room: null });
const TIMETABLE = {
  slots: [
    slot(1, 2, 'היסטוריה'), slot(1, 3, 'עברית'), slot(1, 5, 'אנגלית'), slot(1, 6, 'אנגלית'), slot(1, 7, 'מתמטיקה'),
    slot(2, 3, 'מתמטיקה'), slot(2, 7, 'פיזיקה'), slot(2, 8, 'פיזיקה'),
  ],
};
const SATURDAY = '2026-10-10T08:00:00Z'; // מחר = ראשון 11.10.2026
const fact = (field, value, origin = 'read') => ({ field, value, origin, extracted_by: 'script' });

describe('buildQuestion: ניסוח, כפתורים ו"לא יודע"', () => {
  test('כל שאלה כוללת "לא יודע" כפתור אחרון, ותיבת כתיבה', () => {
    for (const field of ['subject', 'topic', 'date', 'lesson', 'new_room', 'new_date']) {
      const question = buildQuestion({ field });
      assert.equal(question.field, field);
      assert.equal(question.buttons.at(-1), UNKNOWN_BUTTON);
      assert.equal(question.buttons.filter((b) => b === UNKNOWN_BUTTON).length, 1);
      assert.equal(question.allowFreeText, true);
    }
  });
  test('נוסחי השאלות', () => {
    assert.equal(buildQuestion({ field: 'subject' }).text, 'איזה מקצוע?');
    assert.equal(buildQuestion({ field: 'topic' }).text, 'על איזה נושא?');
    assert.equal(buildQuestion({ field: 'date' }).text, 'לאיזה תאריך?');
    assert.equal(buildQuestion({ field: 'lesson' }).text, 'איזה שיעור?');
    assert.equal(buildQuestion({ field: 'new_room' }).text, 'לאיזה חדר?');
    assert.equal(buildQuestion({ field: 'new_date' }).text, 'מה המועד החדש?');
  });
  test('מקצוע: כפתורי המקצועות של אותו יום, בלי כפילויות, לפי סדר השיעורים', () => {
    const question = buildQuestion({ field: 'subject', timetable: TIMETABLE, date: '2026-10-11' });
    assert.deepEqual(question.buttons, ['היסטוריה', 'עברית', 'אנגלית', 'מתמטיקה', UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'subject', timetable: TIMETABLE, date: '2026-10-12' }).buttons, ['מתמטיקה', 'פיזיקה', UNKNOWN_BUTTON]);
  });
  test('מקצוע: מועמדים שניתנו גוברים על היום', () => {
    const question = buildQuestion({ field: 'subject', candidates: ['אנגלית', 'מתמטיקה', 'אנגלית'], timetable: TIMETABLE, date: '2026-10-11' });
    assert.deepEqual(question.buttons, ['אנגלית', 'מתמטיקה', UNKNOWN_BUTTON]);
  });
  test('מקצוע בלי מערכת שעות או בלי תאריך: רק "לא יודע"', () => {
    assert.deepEqual(buildQuestion({ field: 'subject' }).buttons, [UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'subject', date: '2026-10-11' }).buttons, [UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'subject', timetable: TIMETABLE }).buttons, [UNKNOWN_BUTTON]);
  });
  test('שיעור מדויק עם מועמדים: "איזה שיעור?" עם המועמדים (והמקצוע כשידוע)', () => {
    const question = buildQuestion({ field: 'lesson', candidates: ['5', '6'], timetable: TIMETABLE, date: '2026-10-11' });
    assert.equal(question.text, 'איזה שיעור?');
    assert.deepEqual(question.buttons, ['שיעור 5 · אנגלית', 'שיעור 6 · אנגלית', UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'lesson', candidates: ['5', '6'] }).buttons, ['שיעור 5', 'שיעור 6', UNKNOWN_BUTTON]);
  });
  test('שיעור בלי מועמדים: כל שיעורי אותו יום', () => {
    const question = buildQuestion({ field: 'lesson', timetable: TIMETABLE, date: '2026-10-12' });
    assert.deepEqual(question.buttons, ['שיעור 3 · מתמטיקה', 'שיעור 7 · פיזיקה', 'שיעור 8 · פיזיקה', UNKNOWN_BUTTON]);
  });
  test('תאריך עם שני מועמדים = שני התאריכים ככפתורים (יום בשבוע ותאריך מלא)', () => {
    const question = buildQuestion({ field: 'date', candidates: ['2026-10-13', '2026-10-20'] });
    assert.deepEqual(question.buttons, ['שלישי 13.10.2026', 'שלישי 20.10.2026', UNKNOWN_BUTTON]);
    assert.equal(buildQuestion({ field: 'new_date', candidates: ['2026-10-13', '2026-10-14'] }).buttons.length, 3);
  });
  test('תאריך בלי מועמדים: טקסט חופשי בלבד (אין בורר תאריך; הוא בפרק 10)', () => {
    assert.deepEqual(buildQuestion({ field: 'date' }).buttons, [UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'new_room' }).buttons, [UNKNOWN_BUTTON]);
    assert.deepEqual(buildQuestion({ field: 'topic' }).buttons, [UNKNOWN_BUTTON]);
  });
  test('שדה לא נתמך זורק', () => {
    assert.throws(() => buildQuestion({ field: 'color' }), RangeError);
    assert.throws(() => buildQuestion({}), RangeError);
    assert.throws(() => buildQuestion(), RangeError);
  });
});

describe('applyAnswer: "לא יודע" נשמר כ-unknown', () => {
  test('"לא יודע" = unknown, עם origin read ו-extracted_by script', () => {
    const next = applyAnswer({ facts: [fact('subject', 'מתמטיקה')], field: 'topic', answer: UNKNOWN_BUTTON });
    assert.deepEqual(next.at(-1), { field: 'topic', value: UNKNOWN_VALUE, origin: 'read', extracted_by: 'script' });
    assert.equal(UNKNOWN_VALUE, 'unknown');
  });
  test('גם עם פיסוק ורווחים, ובכל שדה', () => {
    for (const field of ['subject', 'date', 'lesson', 'new_room', 'new_date', 'topic']) {
      const next = applyAnswer({ facts: [], field, answer: '  לא   יודע. ' });
      assert.equal(next[0].value, UNKNOWN_VALUE, field);
    }
  });
  test('"unknown" ככתבו נשמר כ-unknown', () => {
    assert.equal(applyAnswer({ facts: [], field: 'topic', answer: 'unknown' })[0].value, 'unknown');
  });
  test('לא משנה את הקלט, ומחליף שדה קיים במקומו', () => {
    const facts = [fact('subject', 'מתמטיקה'), fact('topic', 'שברים')];
    const snapshot = JSON.parse(JSON.stringify(facts));
    const next = applyAnswer({ facts, field: 'topic', answer: 'משוואות' });
    assert.deepEqual(facts, snapshot);
    assert.deepEqual(next.map((f) => [f.field, f.value]), [['subject', 'מתמטיקה'], ['topic', 'משוואות']]);
  });
  test('תשובה ריקה משאירה הכול כמו שהוא', () => {
    const facts = [fact('subject', 'מתמטיקה')];
    assert.deepEqual(applyAnswer({ facts, field: 'topic', answer: '   ' }), facts);
    assert.deepEqual(applyAnswer({ facts, field: 'topic' }), facts);
  });
  test('facts שאינו מערך זורק', () => {
    assert.throws(() => applyAnswer({ facts: null, field: 'topic', answer: 'x' }), TypeError);
    assert.throws(() => applyAnswer({ facts: [], field: '', answer: 'x' }), TypeError);
  });
});

describe('applyAnswer: פענוח לפי שדה', () => {
  test('מקצוע: שם קנוני; טקסט חופשי שאינו ברשימה נשמר כמו שהוא', () => {
    assert.equal(applyAnswer({ facts: [], field: 'subject', answer: 'במתמטיקה' })[0].value, 'מתמטיקה');
    assert.equal(applyAnswer({ facts: [], field: 'subject', answer: 'תנ"ך' })[0].value, 'תנ"ך');
    assert.equal(applyAnswer({ facts: [], field: 'subject', answer: 'אמנות' })[0].value, 'אמנות');
  });
  test('תאריך: תווית כפתור, ISO, וטקסט חופשי עם חותמת קליטה', () => {
    assert.equal(applyAnswer({ facts: [], field: 'date', answer: 'שלישי 13.10.2026' })[0].value, '2026-10-13');
    assert.equal(applyAnswer({ facts: [], field: 'date', answer: '2026-10-13' })[0].value, '2026-10-13');
    assert.equal(applyAnswer({ facts: [], field: 'date', answer: 'מחר', receivedAt: SATURDAY })[0].value, '2026-10-11');
    assert.equal(applyAnswer({ facts: [], field: 'new_date', answer: '14.10', receivedAt: SATURDAY })[0].value, '2026-10-14');
    assert.equal(applyAnswer({ facts: [], field: 'date', answer: 'שלישי 13.10.2026' })[0].origin, 'read');
  });
  test('תאריך שאי אפשר לפענח (או עמום) משאיר את העובדות כמו שהן', () => {
    assert.deepEqual(applyAnswer({ facts: [], field: 'date', answer: 'מחר' }), []); // בלי חותמת קליטה
    assert.deepEqual(applyAnswer({ facts: [], field: 'date', answer: 'מתישהו', receivedAt: SATURDAY }), []);
    assert.deepEqual(applyAnswer({ facts: [], field: 'date', answer: '31.2.2026' }), []); // לא קיים
    assert.deepEqual(applyAnswer({ facts: [], field: 'date', answer: 'ביום שלישי הבא', receivedAt: SATURDAY }), []); // עמום
  });
  test('שיעור: מספר מתווית או מטקסט', () => {
    assert.equal(applyAnswer({ facts: [], field: 'lesson', answer: 'שיעור 5 · אנגלית' })[0].value, '5');
    assert.equal(applyAnswer({ facts: [], field: 'lesson', answer: '8 ו-9' })[0].value, '8,9');
    assert.deepEqual(applyAnswer({ facts: [], field: 'lesson', answer: 'השני' }), []);
  });
  test('חדר חדש: מספר או שם', () => {
    assert.equal(applyAnswer({ facts: [], field: 'new_room', answer: 'חדר 124' })[0].value, '124');
    assert.equal(applyAnswer({ facts: [], field: 'new_room', answer: 'המעבדה' })[0].value, 'המעבדה');
  });
});

describe('הלולאה המלאה: שדה חסר -> שאלה עם "לא יודע" -> תשובה -> הערכה מחדש', () => {
  test('"מחר יש מבחן במתמטיקה" -> שואלים על נושא ושיעור, "לא יודע" נשמר ולא נשאל שוב', () => {
    const extracted = extractFacts({ text: 'מחר מבחן במתמטיקה', receivedAt: SATURDAY, channel: 'app', timetable: TIMETABLE });
    assert.deepEqual(extracted.missing, ['topic']); // שיעור 7 הושלם ביום ראשון
    const question = buildQuestion({ field: extracted.missing[0], type: extracted.type, timetable: TIMETABLE });
    assert.equal(question.text, 'על איזה נושא?');
    assert.ok(question.buttons.includes(UNKNOWN_BUTTON));
    const answered = applyAnswer({ facts: extracted.facts, field: 'topic', answer: UNKNOWN_BUTTON });
    const assessed = assessFacts({ type: extracted.type, facts: answered });
    assert.deepEqual(assessed.missing, []);
    assert.equal(answered.find((f) => f.field === 'topic').value, 'unknown');
  });
  test('שיעור דו-משמעי: שאלה עם המועמדים, ותשובה מכפתור סוגרת את השדה', () => {
    const extracted = extractFacts({ text: 'מבחן באנגלית ביום ראשון על קריאה', receivedAt: '2026-10-08T08:00:00Z', timetable: TIMETABLE });
    assert.equal(extracted.certainty, 'uncertain');
    const [{ field, candidates }] = extracted.ambiguous;
    const question = buildQuestion({ field, type: extracted.type, candidates, timetable: TIMETABLE, date: '2026-10-11' });
    assert.deepEqual(question.buttons, ['שיעור 5 · אנגלית', 'שיעור 6 · אנגלית', UNKNOWN_BUTTON]);
    const answered = applyAnswer({ facts: extracted.facts, field, answer: question.buttons[1] });
    assert.equal(answered.find((f) => f.field === 'lesson').value, '6');
    // התאריך "ביום ראשון" עדיין הוסק (שם יום), ולכן probable ולא certain: שדה מוסק אינו נספר לטובת הוודאות
    assert.deepEqual(assessFacts({ type: extracted.type, facts: answered }), { missing: [], certainty: 'probable' });
  });
  test('תאריך עמום: שני כפתורי תאריך, והתשובה נהפכת בחזרה לתאריך', () => {
    const extracted = extractFacts({ text: 'מבחן במתמטיקה ביום שלישי הבא על שברים בשיעור 3', receivedAt: SATURDAY, timetable: TIMETABLE });
    const [{ field, candidates }] = extracted.ambiguous;
    assert.equal(field, 'date');
    const question = buildQuestion({ field, type: extracted.type, candidates });
    assert.equal(question.buttons.length, 3);
    const answered = applyAnswer({ facts: extracted.facts, field, answer: question.buttons[0] });
    assert.equal(answered.find((f) => f.field === 'date').value, candidates[0]);
    assert.deepEqual(assessFacts({ type: extracted.type, facts: answered }).missing, []);
  });
});

describe('answerPattern: דפוס לרישום ב-candidate_rules', () => {
  test('pattern = שורשי מילים בלבד, בלי טקסט ההודעה; evidence = סוג ושדה', () => {
    const roots = fellThroughRoots('תזכיר לי לבדוק הכנה לבחינה');
    const result = answerPattern({ type: 'exam', field: 'subject', rootsThatFellThrough: roots });
    assert.equal(typeof result.pattern, 'string');
    assert.deepEqual(result.pattern.split(' '), roots);
    assert.deepEqual(Object.keys(result).sort(), ['evidence', 'pattern']);
    assert.deepEqual(result.evidence, { type: 'exam', field: 'subject', roots });
    assert.equal(result.pattern.includes('לי'), false);
  });
  test('מנקה ספרות, לטינית ומילות פונקציה, ומנרמל סופיות לתצוגה', () => {
    const result = answerPattern({ type: 'homework', field: 'lesson', rootsThatFellThrough: ['בוחנ', 'abc', '1234', 'של', 'ה-12', 'דחה', 'דחה', 'א'] });
    assert.equal(result.pattern, 'בוחן דחה');
  });
  test('לכל היותר 8 שורשים; בלי שורשים = null; סוג לא מוכר זורק', () => {
    const many = Array.from({ length: 12 }, (_, k) => `שורש${'אבגדהוזחטיכ'[k]}`.replace(/[^א-ת]/g, '') + 'אב');
    assert.equal(answerPattern({ type: 'exam', field: 'subject', rootsThatFellThrough: many }).evidence.roots.length, 8);
    assert.equal(answerPattern({ type: 'exam', field: 'subject', rootsThatFellThrough: [] }), null);
    assert.equal(answerPattern({ type: 'exam', field: 'subject' }), null);
    assert.throws(() => answerPattern({ type: 'x', field: 'subject', rootsThatFellThrough: ['בוחן'] }), RangeError);
  });
});

describe('formatReply: נרשם · סוג · מקצוע · יום ותאריך', () => {
  test('הדוגמה שבקובץ החוקים: בוחן במתמטיקה, שלישי 6.10', () => {
    assert.equal(formatReply({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-06', weekday: 'שלישי' }), 'נרשם · מבחן · מתמטיקה · שלישי 6.10');
  });
  test('כל הסוגים', () => {
    const base = { subject: 'אנגלית', date: '2026-10-11', weekday: 'ראשון' };
    assert.equal(formatReply({ type: 'homework', ...base }), 'נרשם · שיעורי בית · אנגלית · ראשון 11.10');
    assert.equal(formatReply({ type: 'exam', ...base }), 'נרשם · מבחן · אנגלית · ראשון 11.10');
    assert.equal(formatReply({ type: 'cancel', ...base }), 'נרשם · ביטול · אנגלית · ראשון 11.10');
    assert.equal(formatReply({ type: 'room', ...base }), 'נרשם · חדר · אנגלית · ראשון 11.10');
    assert.equal(formatReply({ type: 'move', ...base }), 'נרשם · הזזה · אנגלית · ראשון 11.10');
    assert.equal(formatReply({ type: 'short_day', date: '2026-10-11', weekday: 'ראשון' }), 'נרשם · יום מקוצר · ראשון 11.10');
  });
  test('יום מקוצר: בלי מקצוע גם אם הועבר', () => {
    assert.equal(formatReply({ type: 'short_day', subject: 'אנגלית', date: '2026-10-06' }), 'נרשם · יום מקוצר · שלישי 6.10');
  });
  test('היום בשבוע מחושב מהתאריך כשלא ניתן, וגם מקבל "יום שלישי" או 1 עד 7', () => {
    assert.equal(formatReply({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-06' }), 'נרשם · מבחן · מתמטיקה · שלישי 6.10');
    assert.equal(formatReply({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-06', weekday: 'יום שלישי' }), 'נרשם · מבחן · מתמטיקה · שלישי 6.10');
    assert.equal(formatReply({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-06', weekday: 3 }), 'נרשם · מבחן · מתמטיקה · שלישי 6.10');
    assert.equal(formatReply({ type: 'exam', subject: 'מתמטיקה', date: '2026-10-06', weekday: 'לא יום' }), 'נרשם · מבחן · מתמטיקה · שלישי 6.10');
  });
  test('תמיד תאריך מלא: בלי אפס מוביל, חודש בן שתי ספרות נשמר', () => {
    assert.equal(formatReply({ type: 'exam', subject: 'אנגלית', date: '2026-11-08' }), 'נרשם · מבחן · אנגלית · ראשון 8.11');
    assert.equal(formatReply({ type: 'exam', subject: 'אנגלית', date: '2026-12-31' }), 'נרשם · מבחן · אנגלית · חמישי 31.12');
  });
  test('מקצוע חסר או unknown לא נכנס לשורה', () => {
    assert.equal(formatReply({ type: 'cancel', date: '2026-10-06' }), 'נרשם · ביטול · שלישי 6.10');
    assert.equal(formatReply({ type: 'cancel', subject: UNKNOWN_VALUE, date: '2026-10-06' }), 'נרשם · ביטול · שלישי 6.10');
  });
  test('סוג או תאריך לא תקינים זורקים', () => {
    assert.throws(() => formatReply({ type: 'x', date: '2026-10-06' }), RangeError);
    assert.throws(() => formatReply({ type: 'exam' }), RangeError);
    assert.throws(() => formatReply({ type: 'exam', date: '6.10' }), RangeError);
    assert.throws(() => formatReply(), RangeError);
  });
});

describe('קבועים', () => {
  test('תשובות הקיצור הקבועות', () => {
    assert.equal(RECEIVED_REPLY, 'התקבל');
    assert.equal(DUPLICATE_REPLY, 'כבר קיבלתי');
    assert.equal(UNKNOWN_BUTTON, 'לא יודע');
  });
  test('תוויות הסוגים', () => {
    assert.deepEqual({ ...TYPE_LABELS }, {
      homework: 'שיעורי בית', exam: 'מבחן', cancel: 'ביטול', room: 'חדר', move: 'הזזה', short_day: 'יום מקוצר',
    });
  });
});

// --- תיקון ביקורת 12.10.2026 (סעיף 11): טווח שיעורים בתשובה חופשית מורחב כמו ב-extractFacts ---
describe('applyAnswer: טווח שיעורים בתשובה (ביקורת, סעיף 11)', () => {
  const lessonOf = (answer) => applyAnswer({ facts: [], field: 'lesson', answer })[0]?.value;
  test('"שיעורים 1-3" = 1,2,3 (ולא 1,3)', () => {
    assert.equal(lessonOf('שיעורים 1-3'), '1,2,3');
  });
  test('טווחים בצורות נוספות: מקף לבד, "עד", "5-6"', () => {
    assert.equal(lessonOf('1-3'), '1,2,3');
    assert.equal(lessonOf('שיעורים 1 עד 3'), '1,2,3');
    assert.equal(lessonOf('שיעורים 5-6'), '5,6');
    assert.equal(lessonOf('שיעורים 2 עד 4 ו-7'), '2,3,4,7');
  });
  test('בלי טווח: כמו קודם (רשימה, תווית כפתור, מספר בודד)', () => {
    assert.equal(lessonOf('8 ו-9'), '8,9');
    assert.equal(lessonOf('שיעור 5 · אנגלית'), '5');
    assert.equal(lessonOf('שיעור 3'), '3');
    assert.equal(lessonOf('3, 5'), '3,5');
  });
  test('מספר מחוץ ל-1 עד 9 או בלי מספר: לא נשמר', () => {
    assert.equal(lessonOf('שיעור 12'), undefined);
    assert.equal(lessonOf('השני'), undefined);
  });
});
