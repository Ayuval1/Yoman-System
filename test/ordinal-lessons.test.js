// מספר שיעור במילים ("השעה השלישית", "השיעור השני", "שיעור רביעי"): מאגר המילים (יובל, 25.11.2026: "שהוא ידע שיעור שלישי, שני וכו'").
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractFacts, findOrdinalLessons, readLessonNumbers } from '../lib/intake-facts.js';

const RECEIVED = new Date('2026-11-25T05:29:00.000Z'); // רביעי 25.11
const lessonOf = (text) => extractFacts({ text, receivedAt: RECEIVED, channel: 'app', timetable: null }).facts.find((f) => f.field === 'lesson')?.value;

describe('מספר שיעור במילים', () => {
  test('findOrdinalLessons: שעה / שיעור + מילת סדר, בזכר ובנקבה, עם ה ו-ב', () => {
    const w = (t) => t.split(' ');
    assert.deepEqual(findOrdinalLessons(w('היום בשעה השלישית יש הרצאה')).periods, [3]);
    assert.deepEqual(findOrdinalLessons(w('השיעור השני מחר בוטל')).periods, [2]);
    assert.deepEqual(findOrdinalLessons(w('שיעור ראשון')).periods, [1]);
    assert.deepEqual(findOrdinalLessons(w('בשעה התשיעית')).periods, [9]);
    assert.deepEqual(findOrdinalLessons(w('בשעה הרביעית והחמישית')).periods, [4, 5]);
    assert.deepEqual(findOrdinalLessons(w('שעה ראשונה ושנייה')).periods, [1, 2]);
  });
  test('לא נתפס: שעה בשעון, יום בשבוע, "שני השיעורים"', () => {
    const w = (t) => t.split(' ');
    assert.deepEqual(findOrdinalLessons(w('בשעה 3 יש פגישה')).periods, []);
    assert.deepEqual(findOrdinalLessons(w('ביום שני יש מבחן')).periods, []);
    assert.deepEqual(findOrdinalLessons(w('שני השיעורים האחרונים בוטלו')).periods, []);
    assert.deepEqual(findOrdinalLessons(w('שעה שלמה')).periods, []);
  });
  test('extractFacts: ביטול "השיעור השלישי" נקרא כשיעור 3 (קודם: לא נקרא)', () => {
    assert.equal(lessonOf('בוטל השיעור השלישי היום'), '3');
    assert.equal(lessonOf('השיעור השני מחר בוטל'), '2');
    assert.equal(lessonOf('ביטול שיעור 3 מחר'), '3'); // מה שעבד ממשיך לעבוד
    assert.equal(lessonOf('בטל את שיעור ראשון מחר'), '1'); // דרך tokenize: "ראשון" הופך ל"ראשונ" (ממצא הבודק)
  });
  test('תשובה חופשית לשאלת "באיזה שיעור?": גם במילים', () => {
    assert.deepEqual(readLessonNumbers('השני'), []); // לבד: אולי "האפשרות השנייה" (test/intake-questions.test.js)
    assert.deepEqual(readLessonNumbers('בשעה השנייה'), [2]);
    assert.deepEqual(readLessonNumbers('שיעורים 3-4'), [3, 4]);
    assert.deepEqual(readLessonNumbers('שיעור ראשון'), [1]);
  });
});
