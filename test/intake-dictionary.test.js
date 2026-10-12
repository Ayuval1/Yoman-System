// בדיקות ל-lib/intake-dictionary.js: מילון המילים המפעילות לפי שורשים (03-intake-rules.md:224-254).
// כל המשפטים מומצאים. אין שמות אנשים, טלפונים או הודעות אמיתיות.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyType, classifyAll, findSubjects, findRooms, fellThroughRoots, isFunctionWord, TYPES, SUBJECT_NAMES,
} from '../lib/intake-dictionary.js';

const typeOf = (text) => classifyType(text)?.type ?? null;

describe('classifyType: הדוגמאות שבקובץ החוקים (03-intake-rules.md:226)', () => {
  test('"יידחה לשבוע הבא" = move (נטייה של דחה)', () => {
    assert.equal(typeOf('השיעור יידחה לשבוע הבא'), 'move');
    assert.equal(typeOf('יידחה לשבוע הבא'), 'move');
  });
  test('"משתחררת בשעה 13:25" = short_day (נטייה של שחרר, עם שעה)', () => {
    assert.equal(typeOf('הכיתה משתחררת בשעה 13:25'), 'short_day');
    assert.equal(typeOf('משתחררת בשעה 13:25'), 'short_day');
  });
  test('"מחר לא יתקיימו שיעורים 8 ו-9" = cancel', () => {
    assert.equal(typeOf('מחר לא יתקיימו שיעורים 8 ו-9'), 'cancel');
  });
});

describe('classifyType: המילים המפעילות בטבלה', () => {
  test('שיעורי בית: ש.ב, שיעורי בית, דף עבודה, לפתור, תרגיל, למחברת', () => {
    for (const text of ['ש.ב', 'ש.ב במתמטיקה', 'ש"ב לשלישי', 'שיעורי בית', 'שיעורי הבית', 'דף עבודה', 'דפי עבודה', 'לפתור את התרגילים', 'תרגיל 5 בעמוד 20', 'להעתיק למחברת']) {
      assert.equal(typeOf(text), 'homework', text);
    }
  });
  test('שיעורי בית חלשים: להביא ולהכין רק עם מקצוע', () => {
    assert.equal(typeOf('ליום ראשון להביא גיאומטריה'), 'homework');
    assert.equal(typeOf('להכין עבודה במדעים'), 'homework');
    assert.equal(typeOf('מחר להביא מחשבון לאנגלית'), 'homework');
  });
  test('ביטול: בוטל, מבוטל, מתבטל, לא יהיה, משוחררים, אין [מקצוע], לא היה', () => {
    for (const text of ['השיעור בוטל', 'מבוטל', 'השיעור מתבטל', 'לא יהיה שיעור', 'משוחררים משיעור 6', 'מחר אין מתמטיקה', 'אין אנגלית', 'לא היה שיעור', 'לא יהיה לכם שיעור מחר', 'ביטול השיעור']) {
      assert.equal(typeOf(text), 'cancel', text);
    }
  });
  test('הזזה: נדחה, עבר ל, הוקדם, הועבר, יתקיים ביום', () => {
    for (const text of ['המבחן נדחה', 'השיעור עבר ליום שלישי', 'הבוחן הוקדם', 'המבחן הועבר ליום ראשון', 'השיעור יתקיים ביום חמישי']) {
      assert.equal(typeOf(text), 'move', text);
    }
  });
  test('מבחן: מבחן, בוחן, מתכונת, מועד ב', () => {
    for (const text of ['מבחן באנגלית', 'במבחן', 'מחר בוחן', 'הבוחן במתמטיקה', 'מתכונת בהיסטוריה', 'מועד ב', "מועד ב'", 'מבחנים בשבוע הבא']) {
      assert.equal(typeOf(text), 'exam', text);
    }
  });
  test('חדר: חדר N, כיתה N, במעבדה, באולם', () => {
    for (const text of ['חדר 124', 'בחדר 124', 'לחדר 124', 'כיתה 124', 'השיעור במעבדה', 'המפגש באולם', 'חדר מספר 12']) {
      assert.equal(typeOf(text), 'room', text);
    }
  });
  test('יום מקוצר: יום מקוצר, משוחררים ב[שעה], סיום ב[שעה]', () => {
    for (const text of ['יום מקוצר', 'מחר יום מקוצר', 'ימים מקוצרים', 'משוחררים ב-12:00', 'משוחררים ב-12', 'סיום בשעה 13:25', 'מסיימים ב-12:00']) {
      assert.equal(typeOf(text), 'short_day', text);
    }
  });
  test('שחרור: עם שעה = יום מקוצר, בלי שעה = ביטול', () => {
    assert.equal(typeOf('משוחררים בשעה 11:40'), 'short_day');
    assert.equal(typeOf('משוחררים מהשיעור האחרון'), 'cancel');
  });
});

describe('classifyType: נטיות (שורשים ולא מחרוזות)', () => {
  test('כל ההטיות של דחה', () => {
    for (const text of ['נדחה', 'יידחה', 'נדחתה', 'נדחו', 'דחו את המבחן', 'המבחן דחוי', 'המבחן שנדחה', 'ידחו את הבוחן']) assert.equal(typeOf(text), 'move', text);
  });
  test('כל ההטיות של ביטל', () => {
    for (const text of ['בוטל', 'בוטלו', 'מבוטלים', 'ביטלו את השיעור', 'יבוטל', 'שבוטל', 'ובוטל']) assert.equal(typeOf(text), 'cancel', text);
  });
  test('כל ההטיות של שחרר (בלי שעה = ביטול)', () => {
    for (const text of ['משוחררים', 'משוחררות', 'שוחררו', 'ישתחררו', 'השתחררו']) assert.equal(typeOf(text), 'cancel', text);
  });
  test('כל ההטיות של הקדים / העביר', () => {
    for (const text of ['הוקדם', 'הוקדמה', 'יוקדם', 'הקדימו את השיעור', 'הועברה', 'העבירו את המבחן', 'יועבר']) assert.equal(typeOf(text), 'move', text);
  });
  test('קידומות של שם עצם: ב ל ה מ ו ש', () => {
    for (const text of ['המבחן', 'למבחן', 'במבחן', 'מהמבחן', 'והמבחן', 'שבמבחן', 'לבוחן', 'ובמתכונת']) assert.equal(typeOf(text), 'exam', text);
  });
});

describe('classifyType: רעש שלא נתפס', () => {
  test('"חדר אומנות", "להביא 15 שקלים לחולצה", "בכיתה" אינם אירוע', () => {
    assert.equal(typeOf('חדר אומנות'), null);
    assert.equal(typeOf('להביא 15 שקלים לחולצה'), null);
    assert.equal(typeOf('בכיתה'), null);
  });
  test('חדר וכיתה בלי מספר, או עם שם כיתה', () => {
    assert.equal(typeOf('חדר'), null);
    assert.equal(typeOf('נפגשים בחדר המורים'), null);
    assert.equal(typeOf('כיתה ט6'), null);
    assert.equal(typeOf('כיתה יפה'), null);
  });
  test('"לא היה לי זמן" אינו ביטול; "עבר" לבד אינו הזזה', () => {
    assert.equal(typeOf('לא היה לי זמן'), null);
    assert.equal(typeOf('מי עבר את המבחן'), 'exam'); // מבחן, לא move
    assert.equal(typeOf('הוא עבר את הכביש'), null);
  });
  test('להביא ולהכין בלי מקצוע, וסיום בלי שעה', () => {
    assert.equal(typeOf('להכין ארוחת ערב'), null);
    assert.equal(typeOf('מחר להביא כסף'), null);
    assert.equal(typeOf('סיימנו את הפרק'), null);
  });
  test('שיחה רגילה', () => {
    for (const text of ['מה נשמע', 'תודה רבה', 'בהצלחה לכולם', 'אתמול היה כיף', 'נתראה מחר', 'יש לי חדשות']) assert.equal(typeOf(text), null, text);
  });
  test('מועד ב-12:00 אינו מועד ב', () => {
    assert.equal(typeOf('המפגש במועד ב-12:00'), null);
  });
  test('קלט ריק או לא טקסט = null', () => {
    assert.equal(classifyType(''), null);
    assert.equal(classifyType('   '), null);
    assert.equal(classifyType(undefined), null);
    assert.equal(classifyType(7), null);
  });
});

describe('classifyType: עדיפות כשכמה סוגים מופיעים (הנחה, לא אומת)', () => {
  test('הזזה גוברת על מבחן: "המבחן נדחה"', () => assert.equal(typeOf('המבחן במתמטיקה נדחה ליום שלישי'), 'move'));
  test('ביטול גובר על מבחן: "הבוחן בוטל"', () => assert.equal(typeOf('הבוחן בוטל'), 'cancel'));
  test('יום מקוצר גובר על ביטול', () => assert.equal(typeOf('מחר יום מקוצר ומשוחררים ב-12:00'), 'short_day'));
  test('מבחן גובר על חדר: "מבחן בחדר 124"', () => assert.equal(typeOf('מחר מבחן בחדר 124'), 'exam'));
  test('"יתקיים ביום" חלש: עם מבחן הוא מבחן', () => {
    assert.equal(typeOf('המבחן יתקיים ביום שלישי'), 'exam');
    assert.equal(typeOf('השיעור יתקיים ביום שלישי'), 'move');
  });
  test('הועבר/עבר לחדר בלי מועד חדש = שינוי חדר', () => {
    assert.equal(typeOf('השיעור הועבר לחדר 124'), 'room');
    assert.equal(typeOf('עבר לחדר 124'), 'room');
    assert.equal(typeOf('השיעור הועבר לחדר 124 ביום שלישי'), 'move');
  });
  test('classifyAll מחזיר את כל הסוגים שנמצאו, לצורך עמימות', () => {
    const result = classifyAll('הבוחן בוטל');
    assert.equal(result.type, 'cancel');
    assert.deepEqual(result.matchedTypes.exam, ['בוחן']);
    assert.deepEqual(result.roots, ['ביטל']);
  });
  test('הסוגים הם בדיוק ששת הסוגים', () => {
    assert.deepEqual([...TYPES].sort(), ['cancel', 'exam', 'homework', 'move', 'room', 'short_day']);
  });
});

describe('classifyType: roots', () => {
  test('מחזיר את השורשים שנתפסו', () => {
    assert.deepEqual(classifyType('יידחה לשבוע הבא'), { type: 'move', roots: ['דחה'] });
    assert.deepEqual(classifyType('בוחן'), { type: 'exam', roots: ['בוחן'] });
    assert.deepEqual(classifyType('חדר 124').roots, ['חדר']);
  });
});

describe('findSubjects ו-findRooms', () => {
  test('מקצועות בכל קידומת ובכל שם', () => {
    const subjects = (text) => findSubjects(text).map((hit) => hit.subject);
    assert.deepEqual(subjects('מבחן במתמטיקה'), ['מתמטיקה']);
    assert.deepEqual(subjects('לאנגלית ולהיסטוריה'), ['אנגלית', 'היסטוריה']);
    assert.deepEqual(subjects('בתנ"ך ובחנ"ג'), ['תנ"ך', 'חנ"ג']);
    assert.deepEqual(subjects('מדעי המחשב'), ['מדעי המחשב']);
    assert.deepEqual(subjects('שיח אישי וכישורי חיים'), ['שיח אישי', 'כישורי חיים']);
    assert.deepEqual(subjects('בפיזיקה, בכימיה ובגיאומטריה'), ['פיזיקה', 'כימיה', 'גיאומטריה']);
    assert.deepEqual(subjects('חינוך גופני וחינוך פיננסי'), ['חנ"ג', 'חינוך פיננסי']);
  });
  test('"מדעי" לבד אינו מקצוע; "מדעים" כן', () => {
    assert.deepEqual(findSubjects('מדעי הרוח'), []);
    assert.deepEqual(findSubjects('מדעים').map((hit) => hit.subject), ['מדעים']);
  });
  test('כל שמות המקצועות הקנוניים מוכרים', () => {
    assert.equal(SUBJECT_NAMES.length, 18);
    assert.ok(SUBJECT_NAMES.includes('מתמטיקה (תרגול)') === false); // מתמטיקה (תרגול) היא שורה במערכת השעות, לא שם שנקרא מהטקסט
  });
  test('חדרים: מספר, מעבדה, אולם, וכיוון (ל/מ)', () => {
    assert.deepEqual(findRooms('מחדר 121 לחדר 124').map((r) => [r.value, r.dir]), [['121', 'from'], ['124', 'to']]);
    assert.deepEqual(findRooms('במעבדה ובאולם').map((r) => r.value), ['מעבדה', 'אולם']);
    assert.deepEqual(findRooms('חדר אומנות'), []);
  });
});

describe('fellThroughRoots ו-isFunctionWord', () => {
  test('מחזיר מילות תוכן שלא נתפסו, בלי מילות פונקציה, מספרים ומילות זמן', () => {
    const roots = fellThroughRoots('תזכיר לי מחר להתקשר לחנות 123');
    assert.ok(roots.includes('תזכיר'));
    assert.ok(roots.includes('חנות'));
    assert.equal(roots.includes('לי'), false);
    assert.equal(roots.includes('מחר'), false);
    assert.equal(roots.some((root) => /\d/.test(root)), false);
  });
  test('לא מחזיר מקצועות ומילים שהמילון תפס', () => {
    const roots = fellThroughRoots('הבוחן במתמטיקה נדחה');
    assert.deepEqual(roots, []);
  });
  test('מחזיר צורה לתצוגה (אות סופית) ולא מנורמלת', () => {
    assert.ok(fellThroughRoots('הכיסאות חדשים').includes('חדשים')); // חדשימ מנורמל -> חדשים לתצוגה
  });
  test('קלט לא תקין = רשימה ריקה', () => {
    assert.deepEqual(fellThroughRoots(undefined), []);
    assert.equal(isFunctionWord('של'), true);
    assert.equal(isFunctionWord('מבחן'), false);
  });
});

// --- תיקוני ביקורת 12.10.2026 (סעיפים 1, 2, 9): כל המשפטים מומצאים ---
describe('classifyType: יום מקוצר רק כשהשעה צמודה למילת השחרור או הסיום (ביקורת, סעיף 1)', () => {
  test('מבחן עם שעה ו"בסיום המבחן" / "מי שסיים": מבחן, לא יום מקוצר', () => {
    assert.equal(typeOf('מחר מבחן בהיסטוריה בשעה 9:05. בסיום המבחן תוכלו ללכת הביתה'), 'exam');
    assert.equal(typeOf('המבחן מחר ב-8:15, מי שסיים יכול לצאת'), 'exam');
  });
  test('"סיום" ושעה רחוקה (מועד הגשה) אינם יום מקוצר ולא נתפסים', () => {
    assert.equal(typeOf('סיום הפרויקט עד יום ראשון ב-23:59'), null);
    assert.equal(typeOf('סיום ההגשה ב-23:59'), null);
  });
  test('השעה צמודה למילת השחרור או הסיום: נשאר יום מקוצר', () => {
    for (const text of ['משוחררים ב-12:30', 'סיום ב-13:25', 'מסיימים בשעה 13:25', 'מחר משוחררים כבר ב-12:30', 'משוחררים 12:30', 'הכיתה משתחררת בשעה 13:25']) {
      assert.equal(typeOf(text), 'short_day', text);
    }
  });
  test('שחרור עם שעה רחוקה אינו יום מקוצר (כמו שחרור בלי שעה: ביטול)', () => {
    assert.equal(typeOf('משוחררים מהשיעור האחרון, ההגשה ב-23:59'), 'cancel');
  });
});

describe('classifyType: שלילה (ביקורת, סעיף 2)', () => {
  test('"לא"/"אין" לפני שורש ביטול או דחייה אינם טריגר; טריגר אחר קובע', () => {
    assert.equal(typeOf('מחר יהיה מבחן במתמטיקה ולא בוטל'), 'exam');
    assert.equal(typeOf('ש.ב בהיסטוריה לא בוטלו, יש להגיש מחר'), 'homework');
    assert.equal(typeOf('המבחן במתמטיקה לא נדחה ויתקיים ביום שלישי'), 'exam');
    assert.equal(typeOf('הבוחן לא בוטל'), 'exam');
  });
  test('בלי טריגר אחר: לא נתפס', () => {
    assert.equal(typeOf('השיעור לא בוטל'), null);
    assert.equal(typeOf('השיעור לא נדחה'), null);
    assert.equal(typeOf('לא ממש בוטל'), null);
    assert.equal(typeOf('אין ביטול'), null);
    assert.equal(typeOf('לא הוקדם'), null);
  });
  test('"לא יהיה צורך" אינו טריגר ביטול (חריג-לחריג); טריגר אחר קובע', () => {
    assert.equal(typeOf('לא יהיה צורך להגיש ש.ב בהיסטוריה עד מחר'), 'homework');
    assert.equal(typeOf('לא יהיה צורך'), null);
    assert.equal(typeOf('לא היה צורך'), null);
    assert.equal(typeOf('לא יהיה ביטול'), null);
  });
  test('החריגים שנשארים ביטול לפי הטבלה: "לא יהיה", "לא יתקיימו", "לא היה"', () => {
    assert.equal(typeOf('מחר לא יהיה שיעור'), 'cancel');
    assert.equal(typeOf('לא יתקיימו שיעורים 8 ו-9'), 'cancel');
    assert.equal(typeOf('לא היה שיעור'), 'cancel');
    assert.equal(typeOf('המבחן לא יתקיים ביום שלישי'), 'cancel');
  });
  test('"לא" רחוק, או אחרי סימן פיסוק, אינו שולל', () => {
    assert.equal(typeOf('המורה לא הגיע, בוטל השיעור'), 'cancel');
    assert.equal(typeOf('לא ידוע לנו אם השיעור בוטל'), 'cancel');
    assert.equal(typeOf('מי שלא הגיע. השיעור בוטל'), 'cancel');
  });
});

describe('classifyType: תוצאות וחזרה אינם אירוע (ביקורת, סעיף 9)', () => {
  test('מילת הקשר שאינה אירוע צמודה למילת הסוג: לא נתפס', () => {
    for (const text of ['תוצאות המבחן בהיסטוריה יתפרסמו ביום שלישי', 'מחר חזרה לקראת המבחן במתמטיקה', 'ציוני המבחן', 'הציון במבחן', 'המבחן פורסם', 'פרסום תוצאות הבוחן', 'חזרה למבחן במתמטיקה']) {
      assert.equal(typeOf(text), null, text);
    }
  });
  test('מבחן רגיל נשאר מבחן, גם עם "לקראת" אחרי מילת הסוג, ועם הקשר רחוק או אחרי פסיק', () => {
    assert.equal(typeOf('מחר מבחן במתמטיקה'), 'exam');
    assert.equal(typeOf('יש מבחן לקראת סוף השבוע'), 'exam');
    assert.equal(typeOf('מחר מבחן, תוצאות ביום שלישי'), 'exam');
    assert.equal(typeOf('מחר מבחן במתמטיקה ובוחן באנגלית ביום שלישי'), 'exam');
  });
  test('טריגר אחר באותה הודעה קובע', () => {
    assert.equal(typeOf('מחר חזרה לקראת המבחן במתמטיקה, ש.ב בהיסטוריה'), 'homework');
  });
});
