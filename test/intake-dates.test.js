// בדיקות ל-lib/intake-dates.js: המרת תאריכים לפי חותמת הקליטה בלוח ישראל (03-intake-rules.md:54-64, build-rules 30, 32).
// כל המשפטים מומצאים. אין שמות אנשים, טלפונים או הודעות אמיתיות.
// 11.10.2026 הוא יום ראשון (ינואר 1 = חמישי; יום 284 בשנה). 6.10.2026 הוא יום שלישי (הדוגמה ב-03-intake-rules.md:60).
// ישראל: UTC+3 בקיץ, UTC+2 בחורף. 2026: הקיץ נגמר ביום א' 25.10 ב-02:00 מקומי (23:00Z ב-24.10); האביב הבא ב-26.3.2027 ב-02:00 מקומי.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDate, resolveDates, localDateIso, addDays, weekdayOf, daysBetween, parseIso, formatDayMonth, formatFullDate, WEEKDAY_NAMES,
} from '../lib/intake-dates.js';

const SUNDAY_MORNING = '2026-10-11T08:00:00Z'; // ראשון 11.10.2026 11:00 בישראל
const dateOf = (text, at = SUNDAY_MORNING, options) => resolveDate(text, at, options);
// שני 5.10.2026: לפני 6.10, כדי שתאריך בלי שנה ("6.10") ייקרא כשנה הנוכחית (ביקורת 12.10, סעיף 5: ההופעה הקרובה מהיום והלאה)
const MONDAY_5_10 = '2026-10-05T08:00:00Z';

describe('resolveDate: היום, מחר, מחרתיים', () => {
  test('היום / מחר / מחרתיים = inferred', () => {
    assert.deepEqual(dateOf('היום אין שיעור'), { date: '2026-10-11', origin: 'inferred', ambiguous: false });
    assert.deepEqual(dateOf('מחר מבחן'), { date: '2026-10-12', origin: 'inferred', ambiguous: false });
    assert.deepEqual(dateOf('מחרתיים בוחן'), { date: '2026-10-13', origin: 'inferred', ambiguous: false });
  });
  test('קידומות: ל, ו, ש', () => {
    assert.equal(dateOf('למחר להכין').date, '2026-10-12');
    assert.equal(dateOf('ומחר מבחן').date, '2026-10-12');
    assert.equal(dateOf('שמחר מבחן').date, '2026-10-12');
  });
  test('אין אזכור תאריך = null', () => {
    assert.equal(dateOf('מה נשמע'), null);
    assert.equal(dateOf(''), null);
    assert.equal(dateOf(undefined), null);
  });
  test('חצות מקומי: 23:59 לעומת 00:01 בישראל (הקיץ, UTC+3)', () => {
    assert.equal(dateOf('היום', '2026-07-14T20:59:00Z').date, '2026-07-14'); // 23:59 ב-14.7
    assert.equal(dateOf('היום', '2026-07-14T21:01:00Z').date, '2026-07-15'); // 00:01 ב-15.7, בעוד ב-UTC עדיין 14.7
    assert.equal(dateOf('מחר', '2026-07-14T20:59:00Z').date, '2026-07-15');
    assert.equal(dateOf('מחר', '2026-07-14T21:01:00Z').date, '2026-07-16');
  });
  test('סוף שנה: מחר חוצה שנה', () => {
    assert.equal(dateOf('מחר', '2026-12-31T22:30:00Z').date, '2027-01-02'); // 00:30 ב-1.1.2027 בישראל
    assert.equal(dateOf('מחר', '2026-12-31T10:00:00Z').date, '2027-01-01');
  });
});

describe('resolveDate: מעבר שעון החורף (25.10.2026) - "מחר" אינו +24 שעות', () => {
  test('24.10.2026 23:30 שעון ישראל: מחר = 25.10', () => {
    // 23:30 מקומי בקיץ (UTC+3) = 20:30Z
    assert.equal(localDateIso('2026-10-24T20:30:00Z'), '2026-10-24');
    assert.equal(dateOf('מחר', '2026-10-24T20:30:00Z').date, '2026-10-25');
  });
  test('25.10.2026 23:30 שעון ישראל: מחר = 26.10', () => {
    // 23:30 מקומי בחורף (UTC+2) = 21:30Z
    assert.equal(localDateIso('2026-10-25T21:30:00Z'), '2026-10-25');
    assert.equal(dateOf('מחר', '2026-10-25T21:30:00Z').date, '2026-10-26');
  });
  test('25.10.2026 00:30: הרגע שבו "+24 שעות" היה טועה (נשאר באותו יום לוח)', () => {
    // 00:30 מקומי ב-25.10 (עדיין קיץ, UTC+3) = 21:30Z ב-24.10. +24 שעות = 23:30 ב-25.10, כלומר "מחר" היה יוצא 25.10. הנכון: 26.10.
    assert.equal(localDateIso('2026-10-24T21:30:00Z'), '2026-10-25');
    assert.equal(dateOf('מחר', '2026-10-24T21:30:00Z').date, '2026-10-26');
  });
  test('תחילת הקיץ (26.3.2027): מחר נכון משני צידי המעבר', () => {
    assert.equal(dateOf('מחר', '2027-03-25T22:30:00Z').date, '2027-03-27'); // 00:30 ב-26.3 (חורף) -> 27.3
    assert.equal(dateOf('מחר', '2027-03-26T20:30:00Z').date, '2027-03-27'); // 23:30 ב-26.3 (קיץ) -> 27.3
  });
  test('חשבון ימי לוח טהור: addDays ו-weekdayOf לא תלויים בשעון', () => {
    assert.equal(addDays('2026-10-24', 1), '2026-10-25');
    assert.equal(addDays('2026-10-25', 1), '2026-10-26');
    assert.equal(addDays('2026-02-28', 1), '2026-03-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
    assert.equal(weekdayOf('2026-10-06'), 2); // שלישי
    assert.equal(WEEKDAY_NAMES[weekdayOf('2026-10-11')], 'ראשון');
  });
  test('אזור זמן אחר דרך options', () => {
    // 2026-10-11T08:00Z בניו יורק (UTC-4) הוא 04:00 באותו יום
    assert.equal(dateOf('היום', '2026-10-11T02:00:00Z', { timezone: 'America/New_York' }).date, '2026-10-10');
    assert.equal(dateOf('היום', '2026-10-11T02:00:00Z').date, '2026-10-11');
  });
});

describe('resolveDate: שם יום', () => {
  test('"ביום שלישי" = המופע הקרוב העתידי, inferred', () => {
    assert.deepEqual(dateOf('מבחן ביום שלישי'), { date: '2026-10-13', origin: 'inferred', ambiguous: false });
    assert.equal(dateOf('ליום חמישי להכין').date, '2026-10-15');
  });
  test('כל ימות השבוע, גם בקיצור עם גרש', () => {
    const expected = { 'ביום ראשון': '2026-10-18', 'ביום שני': '2026-10-12', 'ביום שלישי': '2026-10-13', 'ביום רביעי': '2026-10-14', 'ביום חמישי': '2026-10-15', 'ביום שישי': '2026-10-16', 'ביום שבת': '2026-10-17' };
    for (const [text, date] of Object.entries(expected)) assert.equal(dateOf(text).date, date, text);
    assert.equal(dateOf("ביום ג' בוחן").date, '2026-10-13');
    assert.equal(dateOf('ביום ד בוחן').date, '2026-10-14');
  });
  test('אם היום כבר אותו יום בשבוע: בעוד שבוע (עתידי בהחלט)', () => {
    assert.equal(dateOf('ביום ראשון מבחן', SUNDAY_MORNING).date, '2026-10-18');
  });
  test('"ב-12" אחרי "יום" היא קידומת, לא יום ב\'', () => {
    assert.equal(dateOf('ביום ב-12:00'), null);
  });
  test('שם יום בלי "יום", עם ב/ל', () => {
    assert.equal(dateOf('לשלישי להכין').date, '2026-10-13');
    assert.equal(dateOf('בחמישי מבחן').date, '2026-10-15');
  });
  test('"יום שלישי הבא" = שני מועמדים, ambiguous', () => {
    assert.deepEqual(dateOf('יום שלישי הבא'), { date: '2026-10-13', origin: 'inferred', ambiguous: true, candidates: ['2026-10-13', '2026-10-20'] });
    assert.deepEqual(dateOf('ביום חמישי הבא').candidates, ['2026-10-15', '2026-10-22']);
  });
  test('"הקרוב" = הקרוב, בלי עמימות', () => {
    assert.deepEqual(dateOf('ביום שלישי הקרוב'), { date: '2026-10-13', origin: 'inferred', ambiguous: false });
  });
  test('"ביום שלישי בשבוע הבא" = שלישי של השבוע הבא (ראשון עד שבת), בלי עמימות', () => {
    assert.deepEqual(dateOf('ביום שלישי בשבוע הבא'), { date: '2026-10-20', origin: 'inferred', ambiguous: false });
    assert.equal(dateOf('בשבוע הבא ביום ראשון').date, '2026-10-18');
    assert.equal(dateOf('ביום ראשון בשבוע הבא', '2026-10-15T08:00:00Z').date, '2026-10-18'); // מחמישי 15.10: ראשון הבא = 18.10
  });
});

describe('resolveDate: תאריך מפורש', () => {
  test('D.M, D.M.YYYY, D/M, D/M/YY = read', () => {
    assert.deepEqual(dateOf('מבחן ב-6.10', MONDAY_5_10), { date: '2026-10-06', origin: 'read', ambiguous: false });
    assert.equal(dateOf('מבחן ב-6.10.2026').date, '2026-10-06');
    assert.equal(dateOf('מבחן ב-6/10', MONDAY_5_10).date, '2026-10-06');
    assert.equal(dateOf('מבחן ב-6/10/26').date, '2026-10-06');
    assert.equal(dateOf('מבחן ב6.10').origin, 'read');
    assert.equal(dateOf('מבחן ב-12.10.').date, '2026-10-12'); // נקודה בסוף משפט
  });
  test('בלי שנה: ההופעה הקרובה מהיום והלאה (ביקורת 12.10, סעיף 5; קודם: השנה הקרובה לחותמת, גם אם עברה)', () => {
    assert.equal(dateOf('ב-5.1', '2026-12-20T10:00:00Z').date, '2027-01-05');
    assert.equal(dateOf('ב-28.12', '2027-01-03T10:00:00Z').date, '2027-12-28'); // 28.12.2026 כבר עבר
  });
  test('תאריך שלא קיים או לא תקין = null', () => {
    assert.equal(dateOf('31.2'), null);
    assert.equal(dateOf('32.1'), null);
    assert.equal(dateOf('5.13'), null);
    assert.equal(dateOf('13:25'), null);
  });
  test('שעה במבנה ש.ד אחרי "בשעה" ומספר עשרוני אחרי מטבע אינם תאריך', () => {
    assert.equal(dateOf('משתחררים בשעה 12.30'), null);
    assert.equal(dateOf('להביא 15.5 שקלים'), null);
  });
  test('תאריך מפורש שנעשה צמוד לשם יום שמסכים איתו = read, בלי עמימות', () => {
    assert.deepEqual(dateOf("ביום ג' 6.10", MONDAY_5_10), { date: '2026-10-06', origin: 'read', ambiguous: false });
    assert.equal(dateOf('ביום שלישי 13.10').origin, 'read');
  });
  test('תאריך מפורש שסותר את שם היום = ambiguous עם שני המועמדים (המפורש ראשון)', () => {
    assert.deepEqual(dateOf('ביום שלישי 14.10'), { date: '2026-10-14', origin: 'read', ambiguous: true, candidates: ['2026-10-14', '2026-10-13'] });
  });
  test('"מחר ביום שלישי" שמסכים = אזכור אחד; סותר = ambiguous', () => {
    assert.deepEqual(resolveDates('מחר ביום שני', SUNDAY_MORNING).map((m) => m.date), ['2026-10-12']);
    assert.equal(dateOf('מחר ביום שלישי').ambiguous, true);
  });
});

describe('resolveDates: כמה אזכורים וכיוון', () => {
  test('מ... ל...: from ו-to', () => {
    const mentions = resolveDates('מיום ראשון ליום שלישי', SUNDAY_MORNING);
    assert.deepEqual(mentions.map((m) => [m.date, m.dir]), [['2026-10-18', 'from'], ['2026-10-13', 'to']]);
  });
  test('כמה אזכורים לפי סדר הטקסט', () => {
    const mentions = resolveDates('היום נתתי ש.ב ליום ראשון ולמחרתיים עוד אחד', SUNDAY_MORNING);
    assert.deepEqual(mentions.map((m) => m.date), ['2026-10-11', '2026-10-18', '2026-10-13']);
  });
  test('resolveDate = האזכור הראשון', () => {
    assert.equal(dateOf('מחר ובעוד יומיים מחרתיים').date, '2026-10-12');
  });
});

describe('עזרי תאריך', () => {
  test('parseIso ופורמטים', () => {
    assert.deepEqual(parseIso('2026-10-06'), { year: 2026, month: 10, day: 6 });
    assert.equal(formatDayMonth('2026-10-06'), '6.10');
    assert.equal(formatFullDate('2026-10-06'), '6.10.2026');
    assert.throws(() => parseIso('2026-02-30'), RangeError);
    assert.throws(() => parseIso('x'), RangeError);
  });
  test('receivedAt או אזור זמן לא תקינים זורקים RangeError', () => {
    assert.throws(() => dateOf('מחר', 'לא תאריך'), RangeError);
    assert.throws(() => resolveDate('מחר', undefined), RangeError);
    assert.throws(() => dateOf('מחר', SUNDAY_MORNING, { timezone: 'Mars/Olympus' }), RangeError);
  });
  test('receivedAt כ-Date או כמספר', () => {
    assert.equal(dateOf('מחר', new Date('2026-10-11T08:00:00Z')).date, '2026-10-12');
    assert.equal(dateOf('מחר', Date.parse('2026-10-11T08:00:00Z')).date, '2026-10-12');
  });
});

// --- תיקוני ביקורת 12.10.2026 (סעיפים 4, 5, 7): חותמת קליטה ראשון 11.10.2026 18:00 בישראל ---
describe('resolveDate: מספר פרק או תרגיל אינו תאריך (ביקורת, סעיף 4)', () => {
  const EVENING = '2026-10-11T15:00:00Z';
  test('מספר עשרוני אחרי פרק, סעיף, תרגיל, יחידה, עמוד, שאלה ומשימה', () => {
    for (const text of ['מבחן במתמטיקה על פרק 2.3', 'בפרק 1.2', 'בסעיף 3.4', 'תרגיל 2.5', 'ביחידה 4.1', 'בעמוד 15.5', 'שאלה 2.3', 'משימה 1.2']) {
      assert.deepEqual(resolveDates(text, EVENING), [], text);
    }
  });
  test('טווח ורשימה אחרי מילת סעיף: "תרגילים 2.1 עד 2.5", "פרקים 2.1 ו-2.3", "תרגילים 2.1-2.5"', () => {
    for (const text of ['שיעורי בית במתמטיקה: תרגילים 2.1 עד 2.5', 'פרקים 2.1 ו-2.3', 'תרגילים 2.1-2.5', 'פרק מספר 2.3']) {
      assert.deepEqual(resolveDates(text, EVENING), [], text);
    }
  });
  test('תאריך אמיתי באותה הודעה נשאר תאריך', () => {
    assert.deepEqual(resolveDates('בפרק 2.3 מבחן ב-15.10', EVENING).map((m) => m.date), ['2026-10-15']);
    assert.deepEqual(resolveDates('תרגילים 2.1 עד 2.5 להגשה ב-20.10', EVENING).map((m) => m.date), ['2026-10-20']);
  });
});

describe('resolveDate: תאריך בלי שנה = ההופעה הקרובה מהיום והלאה (ביקורת, סעיף 5)', () => {
  const EVENING = '2026-10-11T15:00:00Z';
  test('תאריך שעבר השנה = השנה הבאה', () => {
    assert.equal(resolveDate('מבחן בהיסטוריה ב-15.5', EVENING).date, '2027-05-15');
    assert.equal(resolveDate('מבחן בהיסטוריה ב-15.4', EVENING).date, '2027-04-15');
    assert.equal(resolveDate('מבחן בהיסטוריה ב-20.6', EVENING).date, '2027-06-20');
    assert.equal(resolveDate('ב-10.10', EVENING).date, '2027-10-10'); // אתמול
  });
  test('היום עצמו והעתיד השנה נשארים השנה', () => {
    assert.equal(resolveDate('ב-11.10', EVENING).date, '2026-10-11');
    assert.equal(resolveDate('ב-12.10', EVENING).date, '2026-10-12');
    assert.equal(resolveDate('ב-31.12', EVENING).date, '2026-12-31');
  });
  test('29.2: ההופעה הקרובה בשנה מעוברת', () => {
    assert.equal(resolveDate('ב-29.2', EVENING).date, '2028-02-29');
  });
  test('חצות מקומי: "היום" בישראל קובע, לא UTC', () => {
    // 21:30Z ב-11.10 = 00:30 ב-12.10 בישראל: ה-12.10 הוא היום, ה-11.10 כבר עבר
    assert.equal(resolveDate('ב-12.10', '2026-10-11T21:30:00Z').date, '2026-10-12');
    assert.equal(resolveDate('ב-11.10', '2026-10-11T21:30:00Z').date, '2027-10-11');
  });
});

describe('resolveDate: "בעוד שבועיים" ו"שעבר" (ביקורת, סעיף 7)', () => {
  const EVENING = '2026-10-11T15:00:00Z'; // ראשון; השלישי הקרוב = 13.10
  test('השלישי הקרוב ועוד 7 × מספר השבועות', () => {
    assert.equal(resolveDate('מבחן בהיסטוריה ביום שלישי בעוד שבועיים', EVENING).date, '2026-10-27');
    assert.equal(resolveDate('ביום שלישי בעוד שבוע', EVENING).date, '2026-10-20');
    assert.equal(resolveDate('ביום שלישי בעוד 3 שבועות', EVENING).date, '2026-11-03');
    assert.equal(resolveDate('ביום שלישי בעוד שלושה שבועות', EVENING).date, '2026-11-03');
  });
  test('הסדר ההפוך: "בעוד שבועיים ביום שלישי"', () => {
    assert.equal(resolveDate('בעוד שבועיים ביום שלישי', EVENING).date, '2026-10-27');
    assert.equal(resolveDate('בעוד 3 שבועות ביום שלישי', EVENING).date, '2026-11-03');
  });
  test('המופע נשאר inferred, בלי עמימות', () => {
    assert.deepEqual(resolveDate('ביום שלישי בעוד שבועיים', EVENING), { date: '2026-10-27', origin: 'inferred', ambiguous: false });
  });
  test('אותו יום בשבוע כמו היום: עמימות (היום + 7N או ההופעה הקרובה + 7N)', () => {
    const result = resolveDate('ביום ראשון בעוד שבועיים', EVENING);
    assert.equal(result.ambiguous, true);
    assert.deepEqual(result.candidates, ['2026-10-25', '2026-11-01']);
  });
  test('כמות שלא מזוהה ליד יום: אין תאריך (בטוח: נשאלת שאלה)', () => {
    assert.equal(resolveDate('ביום שלישי בעוד שעה', EVENING), null);
    assert.equal(resolveDate('ביום שלישי בעוד שבעה שבועות', EVENING), null);
  });
  test('"שעבר": אין תאריך (עמימות או שדה חסר)', () => {
    for (const text of ['מבחן בהיסטוריה ביום שלישי שעבר', 'ביום שלישי שעבר', 'ביום ד שעבר', 'ביום שלישי בשבוע שעבר', 'ביום שלישי הקודם']) {
      assert.equal(resolveDate(text, EVENING), null, text);
    }
  });
  test('"בעוד שבועיים" אחרי פסיק שייך למשפט הבא ואינו נדבק ליום שלפניו', () => {
    assert.deepEqual(resolveDates('מבחן ביום שלישי, בעוד שבועיים בוחן באנגלית', EVENING).map((m) => m.date), ['2026-10-13']);
    assert.deepEqual(resolveDates('מבחן ביום שלישי. בעוד שבועיים ביום שלישי בוחן', EVENING).map((m) => m.date), ['2026-10-13', '2026-10-27']);
    assert.equal(resolveDate('מבחן ביום שלישי, שעבר היה בוחן', EVENING).date, '2026-10-13');
  });
  test('בקרות: ללא "בעוד" או עם "הבא"/"הקרוב" כמו קודם', () => {
    assert.equal(resolveDate('ביום שלישי', EVENING).date, '2026-10-13');
    assert.equal(resolveDate('ביום שלישי הקרוב', EVENING).date, '2026-10-13');
    assert.deepEqual(resolveDate('ביום שלישי הבא', EVENING).candidates, ['2026-10-13', '2026-10-20']);
  });
});
