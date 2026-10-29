// שורת המקור בכרטיס שאלה ממתינה: מאיזה שיעור, איזה יום, איזה תאריך (הכרעת יובל 29.10.2026, שורת מקור בכרטיס שאלה).
// שרת: פריט שיעורי בית נושא period מ-lesson_asks.seq_start_period (pendingFromRows ב-lib/chat-view.js, loadPending ב-lib/chat-pending.js).
// דף: questionSource ב-public/index.html. הסקריפט inline בלי מודולים, ולכן הפונקציות נחתכות מהקובץ ורצות בבידוד (vm), כמו ב-homework-screen.test.js.
// ההוכחה האמיתית (איך השורה נראית בכרטיס) היא בדיקה של יובל על האייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { pendingFromRows } from '../lib/chat-view.js';
import { loadPending } from '../lib/chat-pending.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function source(name) {
  // [^\n]* ולא [^)]*: לחתימה של questionSource יש ברירת מחדל עם סוגריים (now = new Date())
  const match = new RegExp(`function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת ב-public/index.html`);
  return match[0];
}
const daysLine = /const DAYS = \[[^\]]*\];/.exec(script)?.[0];

// questionSource עם התלויות שלה (DAYS, ymdLabel, israelYmd), בהקשר נפרד.
const context = vm.createContext({});
const questionSource = vm.runInContext(`${daysLine}\n${source('ymdLabel')}\n${source('israelYmd')}\n${source('questionSource')}\nquestionSource`, context);

// "עכשיו": חמישי 29.10.2026, 10:00 בישראל (UTC+2 אחרי מעבר השעון) = 08:00Z.
// נוצר בתוך ההקשר של vm: israelYmd בודקת instanceof Date, ו-Date של הבדיקה עצמה הוא Date אחר.
const NOW = vm.runInContext("new Date('2026-10-29T08:00:00.000Z')", context);

describe('questionSource: שורת המקור בדף', () => {
  test('DAYS קיים (שימוש חוזר במערך הקיים)', () => {
    assert.ok(daysLine);
  });

  test('שיעורי בית עם מספר שיעור: היום / אתמול / ישן יותר', () => {
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-10-29', period: 2 }, NOW), 'שיעור 2 · היום · חמישי 29.10');
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-10-28', period: 3 }, NOW), 'שיעור 3 · אתמול · רביעי 28.10');
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-10-25', period: 3 }, NOW), 'שיעור 3 · ראשון 25.10');
  });

  test('שיעורי בית: התאריך הוא תאריך השיעור, לא זמן השליחה', () => {
    const question = { kind: 'homework', lesson_date: '2026-10-28', period: 5, at: '2026-10-29T06:00:00.000Z' };
    assert.equal(questionSource(question, NOW), 'שיעור 5 · אתמול · רביעי 28.10');
  });

  test('שיעורי בית בלי מספר שיעור: בלי "שיעור N"', () => {
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-10-28', period: null }, NOW), 'אתמול · רביעי 28.10');
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-10-28' }, NOW), 'אתמול · רביעי 28.10');
  });

  test('מבחן ושאלה כללית: לפי at ביום של ישראל, בלי מספר שיעור', () => {
    assert.equal(questionSource({ kind: 'exam', at: '2026-10-28T17:00:00.000Z', exam_date: '2026-11-03' }, NOW), 'אתמול · רביעי 28.10');
    assert.equal(questionSource({ text: 'על איזה נושא?', at: '2026-10-29T05:00:00.000Z' }, NOW), 'היום · חמישי 29.10');
    assert.equal(questionSource({ text: 'על איזה נושא?', at: '2026-10-25T09:00:00.000Z' }, NOW), 'ראשון 25.10');
    // 23:30Z ב-28.10 = 01:30 בישראל ב-29.10: היום, לא אתמול
    assert.equal(questionSource({ text: 'שאלה', at: '2026-10-28T23:30:00.000Z' }, NOW), 'היום · חמישי 29.10');
  });

  test('תאריך לא תקין או חסר: אין שורה', () => {
    assert.equal(questionSource({ kind: 'homework', lesson_date: null, period: 3 }, NOW), '');
    assert.equal(questionSource({ kind: 'homework', lesson_date: '28.10', period: 3 }, NOW), '');
    assert.equal(questionSource({ kind: 'homework', lesson_date: '2026-02-31', period: 3 }, NOW), '');
    assert.equal(questionSource({ text: 'שאלה', at: null }, NOW), '');
    assert.equal(questionSource({ text: 'שאלה', at: 'לא תאריך' }, NOW), '');
    assert.equal(questionSource({ kind: 'exam' }, NOW), '');
  });

  test('כל שלושת הכרטיסים מוסיפים את השורה; פס הסיכום לא', () => {
    for (const name of ['questionCard', 'homeworkCard', 'examCard']) assert.match(source(name), /appendSource\(card, question\)/, name);
    assert.doesNotMatch(source('reviewStrip'), /appendSource|questionSource/);
    // בכרטיס שיעורי בית השורה נוספת לפני ענף "השיעור הבא כבר עבר", ולכן מופיעה בשניהם
    const card = source('homeworkCard');
    assert.ok(card.indexOf('appendSource(card, question)') < card.indexOf('if (dates.length === 0)'));
  });
});

describe('pendingFromRows: period בפריט שיעורי בית', () => {
  const row = (period) => ({ id: 'm1', body: null, sent_at: '2026-10-29T05:00:00.000Z', entity_type: 'lesson_ask', subject: 'מתמטיקה', lesson_date: '2026-10-28', missed: false, period });

  test('period מגיע מהשורה כמספר', () => {
    const [item] = pendingFromRows({ questions: [row(3)], facts: [], timetable: null, today: '2026-10-29' });
    assert.equal(item.kind, 'homework');
    assert.equal(item.period, 3);
  });

  test('period חסר או לא מספר שלם: null', () => {
    for (const value of [undefined, null, 'שלוש', 2.5]) {
      const [item] = pendingFromRows({ questions: [row(value)], facts: [], timetable: null, today: '2026-10-29' });
      assert.equal(item.period, null, String(value));
    }
  });

  test('שאלה כללית ושאלת מבחן לא מקבלות period', () => {
    const list = pendingFromRows({
      questions: [
        { id: 'm2', body: 'שאלה', sent_at: '2026-10-29T05:00:00.000Z', entity_type: 'source' },
        { id: 'm3', sent_at: '2026-10-29T06:00:00.000Z', entity_type: 'exam_ask', exam_date: '2026-11-03', exam_type: 'מבחן' },
      ],
      facts: [], timetable: null,
    });
    for (const item of list) assert.equal('period' in item, false);
  });

  test('loadPending שולף את seq_start_period בשם period', async () => {
    const queries = [];
    const sql = (strings) => { queries.push(strings.join('?')); return []; };
    await loadPending(sql, null, NOW);
    assert.match(queries[0], /la\.seq_start_period AS period/);
  });
});
