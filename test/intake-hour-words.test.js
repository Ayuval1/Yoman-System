// בדיקות "שעה במילים" (אחרי שלב 8.3-1, קוד בלבד): "בארבע וחצי", "ברבע לחמש", "בשעה שמונה", מילות הכרעה (בבוקר, בערב...) ושאלת "בבוקר או בערב?".
// הכרעת יובל "א" (docs/01-foundation/05-open-questions.md, "פתוח אחרי שלב 8.3-1"): להבין בוודאות, ולשאול רק בספק. אסור לנחש שעה (docs/08-chapter8/65-chapter8-step-8-3-prd.md, גבולות).
// כל המשפטים מומצאים, בלי שמות ובלי טלפונים. מערכת השעות כאן היא האמיתית; 19.10.2026 הוא יום שני, 08:30 בישראל (UTC+3).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tokenize } from '../lib/intake-text.js';
import { classifyAll, findClockTime, findTimeReading } from '../lib/intake-dictionary.js';
import { extractFacts, UNKNOWN_VALUE } from '../lib/intake-facts.js';
import { buildQuestion, applyAnswer, UNKNOWN_BUTTON } from '../lib/intake-questions.js';
import { processSource, pendingQuestion, answerQuestion } from '../lib/intake-process.js';
import { parseTimetableMarkdown } from '../lib/timetable.js';
import { fakeSql } from './helpers.js';

const TIMETABLE = parseTimetableMarkdown(readFileSync(new URL('../data/school-timetable-taf-shin-pe-zayin.md', import.meta.url), 'utf8'));
const MONDAY_0830 = '2026-10-19T08:30:00+03:00';
const SRC_ID = '11111111-1111-4111-8111-111111111111';
const MSG_ID = '33333333-3333-4333-8333-333333333333';

const extract = (text, extra = {}) => extractFacts({ text, receivedAt: MONDAY_0830, channel: 'app', timetable: TIMETABLE, ...extra });
const valueOf = (result, field) => result.facts.find((fact) => fact.field === field)?.value;
const originOf = (result, field) => result.facts.find((fact) => fact.field === field)?.origin;
const timeCandidates = (result) => result.ambiguous.find((entry) => entry.field === 'time')?.candidates;
const wordsOf = (text) => tokenize(text).tokens.map((token) => token.w);
const reading = (text) => findTimeReading(wordsOf(text))?.candidates ?? null;

describe('שעה במילים: קריאת השעה (findTimeReading), כל מילה עם שתי קריאות אפשריות', () => {
  test('שעה שלמה אחרי קידומת: "בארבע", "בשעה שמונה", "שעה חמש"', () => {
    assert.deepEqual(reading('בארבע'), ['04:00', '16:00']);
    assert.deepEqual(reading('בשעה שמונה'), ['08:00', '20:00']);
    assert.deepEqual(reading('שעה חמש'), ['05:00', '17:00']);
    assert.deepEqual(reading('באחת'), ['01:00', '13:00']);
    assert.deepEqual(reading('בשתיים'), ['02:00', '14:00']);
    assert.deepEqual(reading('בשתים'), ['02:00', '14:00']);
    assert.deepEqual(reading('בעשר'), ['10:00', '22:00']);
  });
  test('כל מספרי השעה אחת עד שתים עשרה, גם בשתי מילים', () => {
    const hours = [['באחת', 1], ['בשתיים', 2], ['בשלוש', 3], ['בארבע', 4], ['בחמש', 5], ['בשש', 6], ['בשבע', 7], ['בשמונה', 8], ['בתשע', 9], ['בעשר', 10], ['באחת עשרה', 11], ['בשתים עשרה', 12], ['בשתיים עשרה', 12]];
    for (const [text, hour] of hours) {
      const [morning, evening] = reading(text);
      assert.equal(Number(morning.slice(0, 2)), hour % 12, text);
      assert.equal(Number(evening.slice(0, 2)), (hour % 12) + 12, text);
    }
  });
  test('"וחצי", "ורבע" ו"רבע ל"', () => {
    assert.deepEqual(reading('בארבע וחצי'), ['04:30', '16:30']);
    assert.deepEqual(reading('בארבע ורבע'), ['04:15', '16:15']);
    assert.deepEqual(reading('ברבע לחמש'), ['04:45', '16:45']);
    assert.deepEqual(reading('ברבע לאחת'), ['00:45', '12:45']);
    assert.deepEqual(reading('ברבע לשתים עשרה'), ['11:45', '23:45']);
    assert.deepEqual(reading('בשעה שלוש וחצי'), ['03:30', '15:30']);
    assert.deepEqual(reading('ובשתים עשרה וחצי'), ['00:30', '12:30']);
  });
  test('מילות הכרעה מבטלות את הספק (קריאה אחת בלבד)', () => {
    for (const [text, value] of [
      ['בשמונה בבוקר', '08:00'], ['בשמונה בערב', '20:00'], ['בשבע בבוקר', '07:00'], ['בתשע בלילה', '21:00'],
      ['בשלוש וחצי אחה"צ', '15:30'], ['בשלוש וחצי אחרי הצהריים', '15:30'], ['בשתיים בצהריים', '14:00'], ['בשתים עשרה בצהריים', '12:00'],
      ['בשתים עשרה בלילה', '00:00'], ['בשלוש בלילה', '03:00'], ['בעשר בלילה', '22:00'], ['ברבע לשמונה בערב', '19:45'], ['בשעה חמש אחה"צ', '17:00'],
    ]) assert.deepEqual(reading(text), [value], text);
  });
  test('מילת הכרעה שלא מתאימה לשעה אינה מכריעה: נשארות שתי הקריאות', () => {
    // [הנחה, לא אומת] "בארבע בערב", "בשתים עשרה בבוקר", "בחמש בצהריים", "בשבע בלילה": ניסוח לא רגיל, ולכן שואלים ולא מנחשים.
    assert.deepEqual(reading('בארבע בערב'), ['04:00', '16:00']);
    assert.deepEqual(reading('בשתים עשרה בבוקר'), ['00:00', '12:00']);
    assert.deepEqual(reading('בחמש בצהריים'), ['05:00', '17:00']);
    assert.deepEqual(reading('בשבע בלילה'), ['07:00', '19:00']);
  });
  test('בלי קידומת, או מספר שאינו שעה: לא נקרא', () => {
    for (const text of ['ארבע', 'ארבע וחצי', 'ארבעה ימים', 'שלוש שעות', 'בארבעה ימים', 'שיעור שלוש', 'לארבע', 'חצי שעה', 'רבע לחמש', 'באחת הפעמים', 'באחת מהכיתות', 'בשלוש וחצי שעות', 'בארבע פעמים']) assert.equal(reading(text), null, text);
  });
  test('"ועשרים", "עשרה לשתיים" ושאר דקות שלא נבנו: לא נקראים בכלל (נופלים לשאלת "באיזו שעה?")', () => {
    for (const text of ['בשתיים ועשרים', 'בארבע וחמש דקות', 'בעשרה לשתיים', 'בעשרים לחמש', 'בארבע ו-20', 'בארבע ושלושה רבעים', 'בשמונה ועשר', 'בשלוש וארבעים וחמש']) {
      assert.equal(reading(text), null, text);
    }
  });
  test('מילה צמודה אחרי השעה שאינה דקות ("ואחר כך") לא מבטלת את הקריאה', () => {
    assert.deepEqual(reading('בארבע ואחר כך הביתה'), ['04:00', '16:00']);
  });
  test('שעה אחרי "עד" אינה שעת התחלה; ספרות נשארות כמו שהיו', () => {
    assert.equal(reading('בדיקה עד בארבע'), null);
    assert.deepEqual(reading('ב-16:30'), ['16:30']);
    assert.deepEqual(reading('בשעה 9'), ['09:00']);
    assert.deepEqual(reading('ב-4'), ['04:00'], 'ספרה בודדת נקראת כפי שנקראה לפני השלב (לא שונה)');
  });
  test('findClockTime מחזיר רק קריאה ודאית: ספרות או מילים עם מילת הכרעה; קריאה עמומה לא מנחשת', () => {
    assert.equal(findClockTime(wordsOf('בארבע וחצי בערב')), null, '4:30 בערב אינו ניסוח שמכריע');
    assert.equal(findClockTime(wordsOf('בשמונה בערב')), '20:00');
    assert.equal(findClockTime(wordsOf('בארבע')), null);
    assert.equal(findClockTime(wordsOf('בארבע וגם ב-17:00')), '17:00', 'ספרות מוקדמות לעמום');
    assert.equal(findClockTime(wordsOf('13:15')), '13:15');
  });
});

describe('שעה במילים: יציאה מוקדמת (early_leave), בחירה לפי שעות הלימודים 08:15 עד 15:45', () => {
  test('הדוגמה מקצה לקצה: "אני יוצא מבית הספר בשלוש וחצי" = 15:30, ושיעורים שפוספסו כמו עם ספרות', () => {
    const words = extract('אני יוצא מבית הספר בשלוש וחצי');
    const digits = extract('אני יוצא מבית הספר ב-15:30');
    assert.equal(words.type, 'early_leave');
    assert.equal(valueOf(words, 'time'), '15:30');
    assert.equal(originOf(words, 'time'), 'inferred', 'נבחר לפי שעות הלימודים, לא נקרא במפורש');
    assert.equal(valueOf(words, 'lesson'), valueOf(digits, 'lesson'));
    assert.equal(valueOf(words, 'lesson'), '9');
    assert.equal(valueOf(words, 'date'), '2026-10-19');
    assert.deepEqual(words.ambiguous, []);
    assert.equal(words.understood, true);
  });
  test('קריאה אחת בשעות הלימודים נבחרת בלי שאלה', () => {
    for (const [text, time] of [
      ['אני יוצא מבית הספר בעשר', '10:00'], ['אני יוצא מבית הספר בתשע', '09:00'], ['אני יוצא מבית הספר באחת', '13:00'], ['אני יוצא מבית הספר בשתיים', '14:00'],
      ['אני יוצא מבית הספר בשתים עשרה', '12:00'], ['אני יוצא מבית הספר ברבע לארבע', '15:45'], ['אני יוצא מבית הספר בשמונה וחצי', '08:30'], ['אני יוצא מבית הספר בשעה שלוש', '15:00'],
    ]) {
      const result = extract(text);
      assert.equal(result.type, 'early_leave', text);
      assert.equal(valueOf(result, 'time'), time, text);
      assert.deepEqual(result.ambiguous, [], text);
    }
  });
  test('אף קריאה לא בשעות הלימודים: שואלים "בבוקר או בערב?" ולא כותבים שעה', () => {
    for (const [text, candidates] of [
      ['אני יוצא מבית הספר בארבע', ['04:00', '16:00']], ['אני יוצא מבית הספר בשמונה', ['08:00', '20:00']], ['אני יוצא מבית הספר בשבע', ['07:00', '19:00']], ['אני יוצא מבית הספר בחמש וחצי', ['05:30', '17:30']],
    ]) {
      const result = extract(text);
      assert.equal(result.type, 'early_leave', text);
      assert.equal(valueOf(result, 'time'), undefined, text);
      assert.deepEqual(timeCandidates(result), candidates, text);
      assert.equal(valueOf(result, 'lesson'), undefined, 'בלי שעה אין שיעורים מפוספסים');
      assert.deepEqual(result.missing, ['time']);
      assert.equal(result.understood, false);
    }
  });
  test('מילת הכרעה גוברת על שעות הלימודים, והעובדה נקראה (read)', () => {
    const afternoon = extract('אני יוצא מבית הספר בשלוש וחצי אחה"צ');
    assert.equal(valueOf(afternoon, 'time'), '15:30');
    assert.equal(originOf(afternoon, 'time'), 'read');
    const night = extract('אני יוצא מבית הספר בשלוש בלילה');
    assert.equal(valueOf(night, 'time'), '03:00', 'נאמר במפורש, גם אם אינו בשעות לימודים');
    const evening = extract('אני יוצא מבית הספר בשמונה בערב');
    assert.equal(valueOf(evening, 'time'), '20:00');
  });
  test('"הולך הביתה מוקדם בשלוש וחצי" נבחר לפי אותה הכרעה, ורק בשעות היום', () => {
    assert.equal(valueOf(extract('אני הולך הביתה מוקדם בשלוש וחצי'), 'time'), '15:30');
    assert.equal(extract('אני הולך הביתה מוקדם בארבע').type, null, 'אף קריאה בשעות היום: לא מתקבל (כמו ב-16:00)');
    assert.equal(extract('אני הולך הביתה מוקדם ב-16:00').type, null);
  });
  test('נושא משתמע, יום ואחרי השעה מילת זמן, כמו בספרות', () => {
    assert.equal(valueOf(extract('יוצא מבית הספר בשלוש וחצי'), 'time'), '15:30');
    const tomorrow = extract('מחר יוצא מבית הספר בשלוש וחצי');
    assert.equal(valueOf(tomorrow, 'time'), '15:30');
    assert.equal(valueOf(tomorrow, 'date'), '2026-10-20');
    const tuesday = extract('ביום שלישי אני יוצא מבית הספר בשלוש וחצי');
    assert.equal(valueOf(tuesday, 'date'), '2026-10-20');
    assert.equal(valueOf(tuesday, 'time'), '15:30');
    assert.equal(valueOf(extract('בשלוש וחצי אני יוצא מבית הספר'), 'time'), '15:30', 'השעה לפני הפועל');
    assert.equal(valueOf(extract('אני יוצא מבית הספר בשעה שלוש וחצי מחר'), 'time'), '15:30');
  });
  test('גוף שלישי, שלילה, הקיצור, ושעה שלא נקראת: לא נרשמים', () => {
    assert.equal(extract('אחי יוצא מבית הספר בשלוש וחצי').type, null);
    assert.equal(extract('היא יוצאת מבית הספר בשלוש וחצי').type, null);
    assert.equal(extract('אני לא יוצא מבית הספר בשלוש וחצי').type, null);
    assert.equal(extract('אני יוצא מבית הספר בשתיים ועשרים').type, null);
    assert.equal(extract('אני יוצא מבית הספר ארבע וחצי').type, null, 'בלי קידומת');
    assert.equal(classifyAll('אני יוצא מבית הספר בשלוש וחצי', { channel: 'shortcut' }), null);
    assert.equal(classifyAll('אני יוצא מבית הספר בשלוש וחצי'), null);
  });
  test('"בבוקר" רחוק מהשעה אינו מכריע: אותה שאלה', () => {
    const result = extract('מחר בבוקר אני יוצא מבית הספר בארבע');
    assert.deepEqual(timeCandidates(result), ['04:00', '16:00']);
  });
});

describe('שעה במילים: אירוע אישי (personal_event), תמיד שואלים כשיש ספק', () => {
  test('"בדיקה רפואית בארבע" שואל; "בשלוש וחצי" שואל גם כשקריאה אחת היא בשעות הלימודים', () => {
    const four = extract('יש לי בדיקה רפואית בארבע');
    assert.equal(four.type, 'personal_event');
    assert.deepEqual(timeCandidates(four), ['04:00', '16:00']);
    assert.equal(valueOf(four, 'time'), undefined);
    assert.equal(valueOf(four, 'end_time'), undefined);
    assert.equal(valueOf(four, 'topic'), 'בדיקה רפואית');
    const half = extract('יש לי בדיקה רפואית בשלוש וחצי');
    assert.equal(half.type, 'personal_event');
    assert.equal(valueOf(half, 'time'), undefined, 'בלי הסקה משעות הלימודים');
    assert.deepEqual(timeCandidates(half), ['03:30', '15:30']);
  });
  test('עם מילת הכרעה אין שאלה: שעה נקראת (read) ושעת סיום מוסקת', () => {
    const result = extract('יש לי תור לרופא שיניים בארבע אחה"צ');
    assert.equal(result.type, 'personal_event');
    assert.equal(valueOf(result, 'time'), '16:00');
    assert.equal(originOf(result, 'time'), 'read');
    assert.equal(valueOf(result, 'end_time'), '17:00');
    assert.equal(valueOf(result, 'topic'), 'תור לרופא שיניים');
    assert.deepEqual(result.ambiguous, []);
    assert.equal(valueOf(extract('מחר תספורת בחמש בערב'), 'time'), '17:00');
  });
  test('שעה אחרי "עד" נשארת כמו שהייתה (לא נקראת במילים), ואינה שעת ההתחלה', () => {
    const result = extract('בדיקה רפואית בארבע אחה"צ עד חמש');
    assert.equal(valueOf(result, 'time'), '16:00');
    assert.equal(valueOf(result, 'end_time'), '17:00');
    assert.equal(originOf(result, 'end_time'), 'inferred');
  });
  test('של מישהו אחר ובערוץ הקיצור: לא נרשם', () => {
    assert.equal(extract('לאחי יש תור לרופא בארבע').type, null);
    assert.equal(classifyAll('יש לי בדיקה רפואית בארבע', { channel: 'shortcut' }), null);
  });
  test('סוג שנבחר בשאלת "מה זה?" (forcedType): אותה קריאה ואותה שאלה', () => {
    const decided = extract('משהו בשמונה בערב', { forcedType: 'personal_event' });
    assert.equal(valueOf(decided, 'time'), '20:00');
    const ambiguous = extract('משהו בשמונה', { forcedType: 'personal_event' });
    assert.deepEqual(timeCandidates(ambiguous), ['08:00', '20:00']);
    const leave = extract('הלכתי בשלוש וחצי', { forcedType: 'early_leave' });
    assert.equal(valueOf(leave, 'time'), '15:30');
    assert.equal(valueOf(leave, 'lesson'), '9');
  });
});

describe('שעה במילים: לא משנה סיווג של סוגים אחרים (חלון המדידה של M.2)', () => {
  test('משפטים עם שעה במילים בלי פועל יציאה או שם אירוע מסווגים בדיוק כמו בלעדיה', () => {
    for (const [text, type] of [
      ['מחר מבחן במתמטיקה בשלוש', 'exam'], ['משתחררים בשתיים עשרה', 'cancel'], ['מחר מסיימים בשתיים עשרה', null], ['אין שיעור פיזיקה בארבע', null],
      ['שיעורי בית באנגלית עד יום חמישי בשמונה', 'homework'], ['החדר עבר לחדר 124 בשלוש וחצי', 'room'], ['נפגשים בארבע וחצי', null],
    ]) assert.equal(classifyAll(text, { channel: 'app' })?.type ?? null, type, text);
  });
});

describe('שעה במילים: שאלת "בבוקר או בערב?" ותשובה', () => {
  const CANDIDATES = ['04:00', '16:00'];
  test('buildQuestion: טקסט קבוע, שני כפתורים עם השעה, ו"לא יודע" ותיבת כתיבה כמו שאר השאלות', () => {
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave', candidates: CANDIDATES }), {
      field: 'time', text: 'בבוקר או בערב?', buttons: ['בבוקר · 04:00', 'בערב · 16:00', UNKNOWN_BUTTON], allowFreeText: true,
    });
    assert.deepEqual(buildQuestion({ field: 'time', type: 'personal_event', candidates: ['08:30', '20:30'] }).buttons, ['בבוקר · 08:30', 'בערב · 20:30', UNKNOWN_BUTTON]);
  });
  test('שתים עשרה: צהריים או חצות, בלי לקרוא לחצות "בוקר"', () => {
    assert.deepEqual(buildQuestion({ field: 'time', type: 'personal_event', candidates: ['00:30', '12:30'] }), {
      field: 'time', text: 'בלילה או בצהריים?', buttons: ['בלילה · 00:30', 'בצהריים · 12:30', UNKNOWN_BUTTON], allowFreeText: true,
    });
  });
  test('בלי מועמדים (או לא זוג): השאלה הקיימת "באיזו שעה?" כמו לפני השלב', () => {
    const old = { field: 'time', text: 'באיזו שעה?', buttons: [UNKNOWN_BUTTON], allowFreeText: true };
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave' }), old);
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave', candidates: [] }), old);
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave', candidates: ['16:00'] }), old);
    assert.deepEqual(buildQuestion({ field: 'time', type: 'early_leave', candidates: ['x', 'y'] }), old);
  });
  test('applyAnswer: תווית הכפתור, שעה חופשית, ומילה בלבד כשיש מועמדים', () => {
    const answer = (text, candidates) => applyAnswer({ facts: [], field: 'time', answer: text, candidates }).find((f) => f.field === 'time')?.value;
    assert.equal(answer('בבוקר · 04:00', CANDIDATES), '04:00');
    assert.equal(answer('בערב · 16:00', CANDIDATES), '16:00');
    assert.equal(answer('בערב · 16:00'), '16:00', 'התווית מספיקה גם בלי מועמדים');
    assert.equal(answer('בלילה · 00:30'), '00:30');
    assert.equal(answer('בצהריים · 12:30'), '12:30');
    assert.equal(answer('בבוקר', CANDIDATES), '04:00');
    assert.equal(answer('בערב', CANDIDATES), '16:00');
    assert.equal(answer('בלילה', ['00:30', '12:30']), '00:30');
    assert.equal(answer('בצהריים', ['00:30', '12:30']), '12:30');
    assert.equal(answer('בלילה', ['09:00', '21:00']), '21:00');
    assert.equal(answer('אחה"צ', CANDIDATES), '16:00');
    assert.equal(answer('17:15', CANDIDATES), '17:15', 'שעה מפורשת גוברת');
    assert.equal(answer('לא יודע', CANDIDATES), UNKNOWN_VALUE);
    assert.equal(answer('בערב'), undefined, 'בלי מועמדים אין למה לפענח');
    assert.equal(answer('אולי', CANDIDATES), undefined);
    assert.equal(answer('בערב או בבוקר', CANDIDATES), undefined);
  });
});

describe('שעה במילים: חיבור לצינור (processSource, pendingQuestion, answerQuestion; SQL מזויף)', () => {
  const typedSource = (text, over = {}) => ({ id: SRC_ID, channel: 'app', raw_content: text, content_hash: `hash-${text}`, received_at: new Date(MONDAY_0830), ...over });
  const factsJsonOf = (call) => JSON.parse(call.values.find((value) => typeof value === 'string' && value.startsWith('[{')));
  const writesOf = (sql) => sql.calls.filter((call) => /\b(INSERT|UPDATE|DELETE)\b/.test(call.text));
  const fact = (field, value, origin = 'read') => ({ field, value, origin });
  function answerDb({ src, facts }) {
    const messageRow = { id: MSG_ID, kind: 'question', awaiting_reply: true, entity_type: 'source', entity_id: SRC_ID, attempt: 1 };
    return fakeSql((text) => {
      if (text.includes('FROM messages WHERE id')) return [messageRow];
      if (text.includes('FROM sources WHERE id')) return [src];
      if (text.includes('FROM facts WHERE source_id')) return facts;
      if (text.includes('INTO facts')) return [{ closed: 1 }];
      return [];
    });
  }
  async function intake(text) {
    const sql = fakeSql(() => []);
    const result = await processSource({ sql, source: typedSource(text), timetable: TIMETABLE });
    const writes = writesOf(sql);
    return { result, writes, call: writes[0] };
  }

  test('"אני יוצא מבית הספר בשלוש וחצי": נרשם, שעה 15:30 (מוסקת), כרטיס האישור עם השיעור שפוספס', async () => {
    const { result, call } = await intake('אני יוצא מבית הספר בשלוש וחצי');
    assert.deepEqual(result, { status: 'recorded', reply: 'נרשם · יציאה מוקדמת · שני 19.10' });
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}:${f.origin}`), ['type=early_leave:read', 'date=2026-10-19:inferred', 'time=15:30:inferred', 'lesson=9:inferred']);
    assert.ok(call.values.includes('יוצא ב-15:30, מפספס שיעור 9. נכון?'));
  });
  test('"אני יוצא מבית הספר בארבע": שאלה "בבוקר או בערב?", בלי שעה ובלי בועה', async () => {
    const { result, writes, call } = await intake('אני יוצא מבית הספר בארבע');
    assert.equal(writes.length, 1, 'פקודה אחת');
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}`), ['type=early_leave', 'date=2026-10-19']);
    assert.ok(call.values.includes('בבוקר או בערב?'));
    assert.equal(call.values.some((v) => typeof v === 'string' && v.startsWith('נרשם')), false, 'עוד לא הובן: אין "נרשם"');
    assert.deepEqual(result, { status: 'recorded', reply: 'התקבל' });
  });
  test('pendingQuestion אחרי הקליטה: השאלה נגזרת מחדש עם הכפתורים', () => {
    const saved = [fact('type', 'early_leave'), fact('date', '2026-10-19', 'inferred')];
    assert.deepEqual(pendingQuestion({ source: typedSource('אני יוצא מבית הספר בארבע'), facts: saved, timetable: TIMETABLE }), {
      field: 'time', text: 'בבוקר או בערב?', buttons: ['בבוקר · 04:00', 'בערב · 16:00', UNKNOWN_BUTTON], allowFreeText: true,
    });
    const event = [fact('type', 'personal_event'), fact('date', '2026-10-19', 'inferred'), fact('topic', 'בדיקה רפואית')];
    assert.equal(pendingQuestion({ source: typedSource('יש לי בדיקה רפואית בשלוש וחצי'), facts: event, timetable: TIMETABLE }).text, 'בבוקר או בערב?');
  });
  test('answerQuestion: לחיצה על "בערב · 16:00" שומרת שעה, נרשם בפעם הראשונה, והכרטיס הבא הוא האישור', async () => {
    const src = typedSource('אני יוצא מבית הספר בארבע');
    const sql = answerDb({ src, facts: [fact('type', 'early_leave'), fact('date', '2026-10-19', 'inferred')] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'בערב · 16:00', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.status, 'answered');
    assert.equal(result.done, false);
    assert.equal(result.reply, 'יוצא ב-16:00, לא מפספס שיעורים. נכון?');
    const call = writesOf(sql)[0];
    assert.deepEqual(factsJsonOf(call).map((f) => `${f.field}=${f.value}:${f.origin}`), ['time=16:00:read']);
    assert.ok(call.values.includes('נרשם · יציאה מוקדמת · שני 19.10'));
  });
  test('answerQuestion: אירוע אישי, התשובה "בבוקר" (מילה בלבד) נפתרת מול המועמדים, ומוסיפה שעת סיום', async () => {
    const src = typedSource('יש לי בדיקה רפואית בשמונה');
    const sql = answerDb({ src, facts: [fact('type', 'personal_event'), fact('date', '2026-10-19', 'inferred'), fact('topic', 'בדיקה רפואית')] });
    const result = await answerQuestion({ sql, messageId: MSG_ID, answer: 'בבוקר', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(result.status, 'answered');
    assert.equal(result.reply, 'בדיקה רפואית, היום 08:00 עד 09:00. נכון?');
    assert.deepEqual(factsJsonOf(writesOf(sql)[0]).map((f) => `${f.field}=${f.value}:${f.origin}`), ['time=08:00:read', 'end_time=09:00:inferred']);
  });
  test('answerQuestion: "לא יודע" נשמר כ-unknown ואין כרטיס אישור; תשובה לא ברורה משאירה את השאלה פתוחה', async () => {
    const src = typedSource('אני יוצא מבית הספר בארבע');
    const saved = [fact('type', 'early_leave'), fact('date', '2026-10-19', 'inferred')];
    const unknown = answerDb({ src, facts: saved });
    const done = await answerQuestion({ sql: unknown, messageId: MSG_ID, answer: UNKNOWN_BUTTON, now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.equal(done.done, true);
    assert.deepEqual(factsJsonOf(writesOf(unknown)[0]).map((f) => `${f.field}=${f.value}`), ['time=unknown']);
    const unclear = answerDb({ src, facts: saved });
    const again = await answerQuestion({ sql: unclear, messageId: MSG_ID, answer: 'אולי', now: new Date(MONDAY_0830), timetable: TIMETABLE });
    assert.deepEqual(again, { done: false, reply: 'בבוקר או בערב?', status: 'unclear', created: { answerSourceId: null, bubbleId: null, questionId: null } });
    assert.equal(writesOf(unclear).length, 0);
  });
});

describe('שעה במילים: תיקוני ביקורת נקייה (22.10.2026)', () => {
  const leave = (tail) => extract(`אני יוצא מוקדם מבית הספר ${tail}`);
  const none = (result) => assert.equal(result.type === null || (valueOf(result, 'time') === undefined && timeCandidates(result) === undefined), true, JSON.stringify(result));
  test('סעיף 1: מילת הכרעה בחצי משפט אחר (נקודה, פסיק, שורה חדשה) אינה מכריעה', () => {
    const event = extract('יש לי תור לרופא בשבע. בערב יש לי אימון');
    assert.equal(valueOf(event, 'time'), undefined);
    assert.deepEqual(timeCandidates(event), ['07:00', '19:00']);
    assert.deepEqual(timeCandidates(extract('יש לי תור לרופא בשבע, בערב אני בבית')), ['07:00', '19:00']);
    assert.equal(valueOf(leave('בעשר\nבערב אני בבית'), 'time'), '10:00');
    assert.equal(valueOf(leave('בשתיים. בלילה יש לי אימון'), 'time'), '14:00');
  });
  test('סעיף 2: מילת חלק-יום שלא הכריעה מבטלת את ההסקה משעות הלימודים (שואלים)', () => {
    for (const [tail, candidates] of [['בשתיים לפנות בוקר', ['02:00', '14:00']], ['בשלוש הלילה', ['03:00', '15:00']], ['בשלוש בערב', ['03:00', '15:00']]]) {
      const result = leave(tail);
      assert.equal(valueOf(result, 'time'), undefined, tail);
      assert.deepEqual(timeCandidates(result), candidates, tail);
    }
    for (const tail of ['בשתיים או בשלוש']) none(leave(tail));
    none(extract('יש לי תור לרופא בשבע בבוקר או בערב'));
  });
  test('סעיף 3: "עשרה לשתיים" בניסוח "בעשר לשתיים" אינה נקראת', () => {
    for (const text of ['בעשר לשתיים', 'בחמש לשתיים']) {
      assert.equal(reading(text), null, text);
      none(leave(text));
    }
    none(extract('יש לי תור לרופא בחמש לשלוש'));
  });
  test('סעיף 4: מספרים מ-13 ומעלה ("שלוש עשרה") אינם נקראים', () => {
    for (const text of ['בשלוש עשרה', 'בארבע עשרה', 'בשמונה עשרה']) assert.equal(reading(text), null, text);
  });
  test('סעיף 5: משך ("שעה אחת"), "באחת הכיתות" ותאריכים אינם שעה', () => {
    for (const text of ['שעה אחת', 'באחת הכיתות', 'באחת ההפסקות', 'בעשר באוקטובר', 'בשבע לנובמבר', 'בתשע בנובמבר', 'בחמש לחודש']) assert.equal(reading(text), null, text);
    assert.deepEqual(reading('בשעה אחת'), ['01:00', '13:00']);
    none(leave('שעה אחת'));
  });
  test('סעיף 6: קריאה ודאית באותו משפט (ספרות או הכרעה) גוברת על עמומה, כמו לפני השלב', () => {
    assert.equal(valueOf(extract('יש לי תור לרופא בשלוש ואחר כך ב-17:00'), 'time'), '17:00');
    assert.equal(valueOf(extract('יש לי תור לרופא בארבע וב-17:00'), 'time'), '17:00');
    assert.equal(valueOf(leave('בשתיים וחצי ב-14:00'), 'time'), '14:00');
    assert.equal(originOf(leave('בשתיים וחצי ב-14:00'), 'time'), 'read');
  });
  test('סעיפים 7 ו-8: תשובה חופשית מול חצות, ו"אחרי הצהריים" בשתי מילים', () => {
    const answer = (text, candidates) => applyAnswer({ facts: [], field: 'time', answer: text, candidates }).find((f) => f.field === 'time')?.value;
    assert.equal(answer('בבוקר', ['00:00', '12:00']), undefined, 'חצות אינו בוקר');
    assert.equal(answer('בבוקר', ['04:00', '16:00']), '04:00');
    assert.equal(answer('אחרי הצהריים', ['04:00', '16:00']), '16:00');
    assert.equal(answer('אחר הצהריים', ['04:00', '16:00']), '16:00');
    assert.equal(answer('בערב או בבוקר', ['04:00', '16:00']), undefined);
  });
});

describe('שעה במילים: תיקוני ביקורת נקייה שנייה (22.10.2026)', () => {
  const leave = (tail) => extract(`אני יוצא מוקדם מבית הספר ${tail}`);
  const event = (tail) => extract(`יש לי תור לרופא ${tail}`);
  test('מילת הכרעה אחרי מילת יום ("בעשר מחר בערב") לא מכריעה, אבל גם לא מאפשרת הסקה נגדה: שואלים', () => {
    for (const [tail, candidates] of [['בעשר מחר בערב', ['10:00', '22:00']], ['בשתיים מחר בבוקר', ['02:00', '14:00']], ['בשתיים ביום שלישי בבוקר', ['02:00', '14:00']]]) {
      const result = leave(tail);
      assert.equal(valueOf(result, 'time'), undefined, tail);
      assert.deepEqual(timeCandidates(result), candidates, tail);
    }
  });
  test('"היום" ו"השבוע" אחרי השעה הם מועד ולא משך: השעה נקראת', () => {
    assert.deepEqual(timeCandidates(event('בארבע היום')), ['04:00', '16:00']);
    assert.deepEqual(timeCandidates(event('בארבע וחצי היום')), ['04:30', '16:30']);
    assert.equal(valueOf(leave('בשתיים היום'), 'time'), '14:00');
    assert.deepEqual(timeCandidates(leave('בשבע היום')), ['07:00', '19:00']);
    assert.deepEqual(reading('בשמונה השבוע'), ['08:00', '20:00']);
    assert.equal(reading('בשמונה השעות'), null);
  });
  test('חלופות ("/", "ו", "אולי", "או") אינן שעה אחת: לא נקראות', () => {
    for (const text of ['בשמונה בבוקר ובערב', 'בשמונה בבוקר ואולי בערב', 'בשתיים ובשלוש', 'בשתיים אולי בשלוש', 'בשתיים או בשלוש']) {
      assert.equal(reading(text), null, text);
    }
    none(leave('בשתיים/שלוש'));
    none(event('בשבע בבוקר/בערב'));
    function none(result) { assert.equal(result.type === null || (valueOf(result, 'time') === undefined && timeCandidates(result) === undefined), true); }
  });
  test('תשובה חופשית: מילה שלא מתאימה לשעה אינה מפוענחת; מילים שמתאימות כן', () => {
    const answer = (text, candidates) => applyAnswer({ facts: [], field: 'time', answer: text, candidates }).find((f) => f.field === 'time')?.value;
    assert.equal(answer('בצהריים', ['08:00', '20:00']), undefined);
    assert.equal(answer('בצהריים', ['11:00', '23:00']), undefined);
    assert.equal(answer('בלילה', ['06:00', '18:00']), undefined);
    assert.equal(answer('בערב', ['00:00', '12:00']), undefined);
    assert.equal(answer('בערב', ['08:00', '20:00']), '20:00');
    assert.equal(answer('בערב', ['04:00', '16:00']), '16:00');
    assert.equal(answer('בצהריים', ['02:00', '14:00']), '14:00');
    assert.equal(answer('בצהריים', ['00:30', '12:30']), '12:30');
  });
  test('תשובה חופשית: סימן פיסוק בין חצאי משפט לא מוביל לשעה מהחצי השני', () => {
    const answer = (text, candidates) => applyAnswer({ facts: [], field: 'time', answer: text, candidates }).find((f) => f.field === 'time')?.value;
    assert.equal(answer('בשבע. בערב יש לי אימון', ['04:00', '16:00']), undefined);
  });
});
