// בדיקות ל-lib/intake-intent.js: שכבת הכוונה והפרדה בין משימה למידע (03-intake-rules.md:112-155, 178-188).
// כל המשפטים מומצאים. אין שמות אנשים, טלפונים או הודעות אמיתיות.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, channelRole, intentSignals, WRITE_ROOTS, SHOW_ROOTS, TASK_VERB_ROOTS } from '../lib/intake-intent.js';

describe('detectIntent: הקריטריונים', () => {
  test('"מה יש לי מחר" = read (מילת שאלה, בלי פועל)', () => {
    assert.equal(detectIntent('מה יש לי מחר'), 'read');
  });
  test('"תקבע פגישה מחר" = write (שורש כתיבה)', () => {
    assert.equal(detectIntent('תקבע פגישה מחר'), 'write');
  });
  test('"מה לקבוע מחר?" = write (שניהם יחד: חוק 3)', () => {
    assert.equal(detectIntent('מה לקבוע מחר?'), 'write');
  });
  test('"תבדוק" = read (פועל דו-משמעי: חוק 5)', () => {
    assert.equal(detectIntent('תבדוק'), 'read');
    assert.equal(detectIntent('תראה'), 'read');
  });
  test('"לשאול את <מישהו> אם הוא בא" = משימה/מידע, לא read', () => {
    const text = 'לשאול את המאמן אם הוא בא';
    assert.notEqual(detectIntent(text), 'read');
    assert.equal(detectIntent(text), 'info');
    assert.equal(channelRole({ channel: 'app', text }), 'task');
  });
  test('גם עם מילת שאלה: "לשאול את <מישהו> מתי הוא בא" אינו שאילתה', () => {
    const text = 'לשאול את המאמן מתי הוא בא?';
    assert.equal(detectIntent(text), 'info');
    assert.equal(channelRole({ channel: 'app', text }), 'task');
  });
});

describe('detectIntent: סדר ההכרעה', () => {
  test('חוק 4: אף אחד = info', () => {
    assert.equal(detectIntent('מחר מבחן באנגלית'), 'info');
    assert.equal(detectIntent('להביא מחשבון'), 'info');
  });
  test('חוק 2: מילות שאלה (כל אחת)', () => {
    for (const text of ['מתי המבחן', 'איפה השיעור', 'איזה שיעור יש', 'כמה שיעורים יש', 'האם יש מבחן', 'מי מלמד היום', 'למה בוטל']) {
      // "למה בוטל" מכיל שורש כתיבה (ביטל), לכן write: חוק 3
      assert.equal(detectIntent(text), text === 'למה בוטל' ? 'write' : 'read', text);
    }
  });
  test('חוק 2: סימן שאלה בלבד', () => {
    assert.equal(detectIntent('מחר מבחן?'), 'read');
  });
  test('מילת שאלה עם ו\' מחברת', () => {
    assert.equal(detectIntent('ומתי הבוחן'), 'read');
  });
  test('שורשי הצגה: אמר ראה הציג סיכם חיפש', () => {
    for (const text of ['תאמר לי', 'תראה לי', 'תציג את היום', 'תסכם את השבוע', 'תחפש את המבחן']) assert.equal(detectIntent(text), 'read', text);
  });
  test('חוק 1: שורשי כתיבה בכל הטיה', () => {
    const writes = [
      'קבע בוחן', 'תוסיף מבחן', 'לרשום ש.ב', 'להכניס אירוע', 'תפתח יום', 'תזכיר לי מחר', 'תזיז את המבחן', 'להעביר את השיעור',
      'תדחה את המבחן', 'להקדים את הבוחן', 'לשנות את השעה', 'תעדכן את היום', 'לבטל את השיעור', 'תמחק את האירוע', 'תסיר את התזכורת',
      'סיימתי את המשימה', 'לבצע את התוכנית',
    ];
    for (const text of writes) assert.equal(detectIntent(text), 'write', text);
  });
  test('הטיות עם קידומות: ו/ש/ל', () => {
    assert.equal(detectIntent('ולקבוע משהו'), 'write');
    assert.equal(detectIntent('שתקבע לי תור'), 'write');
  });
  test('עבר/עתיד/ציווי/שם פועל של אותו שורש', () => {
    for (const text of ['ביטלתי את הבוחן', 'אבטל את הבוחן', 'בטל את הבוחן', 'לבטל את הבוחן']) assert.equal(detectIntent(text), 'write', text);
  });
  test('הודעה ריקה או לא טקסט = info', () => {
    assert.equal(detectIntent(''), 'info');
    assert.equal(detectIntent('   '), 'info');
    assert.equal(detectIntent(undefined), 'info');
    assert.equal(detectIntent(42), 'info');
  });
});

describe('detectIntent: מילים תמימות שלא מפעילות כתיבה', () => {
  test('הצורות שהושמטו בכוונה אינן שורשי כתיבה', () => {
    for (const text of ['הוא נכנס לכיתה', 'יום מוקדם', 'קדימה רצים', 'שינה טובה', 'שיעור נוסף', 'ישיבה קבועה', 'העבר שלנו']) {
      assert.equal(detectIntent(text), 'info', text);
    }
  });
});

describe('intentSignals: האותות שהוכרעו', () => {
  test('מחזיר את השורשים והמילים שנמצאו', () => {
    const signals = intentSignals('מה לקבוע מחר?');
    assert.deepEqual(signals.write, ['קבע']);
    assert.deepEqual(signals.questionWords, ['מה']);
    assert.equal(signals.questionMark, true);
    assert.equal(signals.askTask, false);
  });
  test('הטבלאות הן הטבלאות שבקובץ החוקים', () => {
    assert.deepEqual([...SHOW_ROOTS], ['אמר', 'ראה', 'הציג', 'סיכם', 'חיפש']);
    assert.equal(WRITE_ROOTS.includes('קבע') && WRITE_ROOTS.includes('דחה') && WRITE_ROOTS.includes('ביטל'), true);
    assert.deepEqual([...TASK_VERB_ROOTS].sort(), ['הביא', 'הוציא', 'הזמין', 'הכין', 'הלך', 'כתב', 'לקח', 'קנה', 'רענן', 'שלח', 'שים'].sort());
  });
});

describe('channelRole: הפרדה בין משימה למידע (03-intake-rules.md:178-188)', () => {
  test('קיצור = info תמיד, גם כשהפועל ראשון', () => {
    assert.equal(channelRole({ channel: 'shortcut', text: 'להביא מחשבונים' }), 'info');
    assert.equal(channelRole({ channel: 'shortcut', text: 'לקחת כדור' }), 'info');
  });
  test('הוקלד והפועל המשימתי ראשון = task (כל אחד מ-11 הפעלים)', () => {
    for (const text of ['לקחת כדור', 'להכין תיק', 'להביא מחשבון', 'לקנות חלב', 'לשים מים', 'להזמין תור', 'לכתוב מכתב', 'לשלוח דוא"ל', 'להוציא כביסה', 'לרענן את הדף', 'ללכת לרופא']) {
      assert.equal(channelRole({ channel: 'app', text }), 'task', text);
    }
  });
  test('הוקלד והפועל באמצע = info', () => {
    assert.equal(channelRole({ channel: 'app', text: 'מחר להביא מחשבון' }), 'info');
    assert.equal(channelRole({ channel: 'app', text: 'לא לשכוח להביא מחשבונים' }), 'info');
  });
  test('פיסוק ורווחים בתחילת ההודעה לא משנים', () => {
    assert.equal(channelRole({ channel: 'app', text: '  - להביא מחשבון' }), 'task');
  });
  test('אין פועל משימתי = info', () => {
    assert.equal(channelRole({ channel: 'app', text: 'מחר מבחן באנגלית' }), 'info');
  });
  test('ערוץ שאינו app או shortcut, או קלט לא תקין = info', () => {
    assert.equal(channelRole({ channel: 'calendar', text: 'להביא מחשבון' }), 'info');
    assert.equal(channelRole({ channel: 'app', text: '' }), 'info');
    assert.equal(channelRole({ channel: 'app' }), 'info');
    assert.equal(channelRole(), 'info');
  });
});
