// תאריך הכותרת (#today, #todayDate) מתעדכן כשהדף חוזר לחזית ובחצות לפי שעון המכשיר.
// הבאג: paintDate נקראה רק פעם אחת בטעינה, ולכן אפליקציה שנשארה פתוחה בלילה הציגה בבוקר את התאריך של אתמול.
// public/index.html הוא סקריפט inline בלי מודולים, ולכן: בדיקות צורה על הקובץ + הרצה בבידוד (vm) של חישוב החצות והטיימר.
// ההוכחה האמיתית (אייפון פתוח לילה שלם) היא בדיקה של יובל.
process.env.TZ = 'Asia/Jerusalem'; // לפני כל שימוש ב-Date: בדיקות מעבר השעון (25.10.2026, 26.3.2027)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

const grab = (re, what) => {
  const match = re.exec(script);
  assert.ok(match, `${what} קיים`);
  return match[0];
};
const msFn = grab(/function msUntilNextMidnight\(now = new Date\(\)\) \{[\s\S]*?\n\}/, 'msUntilNextMidnight');
const schedFn = grab(/function scheduleMidnightPaint\(\) \{[\s\S]*?\n\}/, 'scheduleMidnightPaint');
const HOUR = 3600000;

describe('public/index.html: רענון תאריך הכותרת', () => {
  test('paintDate: אותה חתימה וברירת מחדל new Date()', () => {
    assert.match(script, /function paintDate\(now = new Date\(\)\) \{/);
  });

  test('visibilitychange: כשהדף נראה, paintDate נקראת (במאזין הקיים, בלי מאזין כפול)', () => {
    const listeners = script.match(/addEventListener\('visibilitychange'/g) ?? [];
    assert.equal(listeners.length, 1, 'מאזין visibilitychange אחד');
    const block = grab(/addEventListener\('visibilitychange'[\s\S]*?\n\}\);/, 'מאזין visibilitychange');
    assert.match(block, /visibilityState === 'visible'/);
    assert.match(block, /paintDate\(\)/);
    assert.match(block, /refresh\(\)/, 'הרענון הקיים נשאר');
  });

  test('pageshow: paintDate נקראת', () => {
    const block = grab(/addEventListener\('pageshow'[^\n]*/, 'מאזין pageshow');
    assert.match(block, /paintDate\(\)/);
  });

  test('טיימר חצות: מתוזמן בטעינה, מצייר ומתזמן את הבא, מחושב מחדש מ-new Date()', () => {
    assert.match(script, /paintDate\(\);\r?\n[\s\S]*?\nscheduleMidnightPaint\(\);/, 'מתוזמן אחרי הציור הראשון');
    assert.match(schedFn, /setTimeout\(\(\) => \{ paintDate\(\); scheduleMidnightPaint\(\); \}, msUntilNextMidnight\(\)\)/);
    assert.match(schedFn, /clearTimeout\(midnightTimer\)/, 'אין טיימרים כפולים');
  });

  test('msUntilNextMidnight: חצות מקומי + שנייה, כולל יום מעבר שעון', () => {
    const ms = vm.runInNewContext(`(${msFn})`);
    // יום רגיל: 12:00 -> 00:00:01 = 12 שעות + שנייה
    assert.equal(ms(new Date(2026, 9, 20, 12, 0, 0)), 12 * HOUR + 1000);
    // 25.10.2026: סוף שעון קיץ, היום בן 25 שעות. 00:30 -> 26.10 00:00:01 = 24.5 שעות + שנייה
    assert.equal(ms(new Date(2026, 9, 25, 0, 30, 0)), 24.5 * HOUR + 1000);
    // 26.3.2027: תחילת שעון קיץ, היום בן 23 שעות. 00:30 -> 27.3 00:00:01 = 22.5 שעות + שנייה
    assert.equal(ms(new Date(2027, 2, 26, 0, 30, 0)), 22.5 * HOUR + 1000);
    // סוף חודש ושנה
    assert.equal(ms(new Date(2026, 11, 31, 23, 0, 0)), HOUR + 1000);
  });

  test('scheduleMidnightPaint: אחרי הירי מצייר שוב ומתזמן את החצות הבא', () => {
    const calls = [];
    let paints = 0;
    let cleared = 0;
    let now = new Date(2026, 9, 25, 22, 0, 0);
    const ctx = {
      setTimeout: (fn, ms) => { calls.push({ fn, ms }); return calls.length; },
      clearTimeout: () => { cleared++; },
      paintDate: () => { paints++; },
      Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } },
    };
    vm.runInNewContext(`${msFn}\nlet midnightTimer = null;\n${schedFn}\nscheduleMidnightPaint();\nglobalThis.fire = () => scheduleMidnightPaint;`, ctx);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].ms, 2 * HOUR + 1000, '25.10 22:00 -> 26.10 00:00:01');
    now = new Date(2026, 9, 26, 0, 0, 1);
    calls[0].fn();
    assert.equal(paints, 1, 'paintDate נקראה בחצות');
    assert.equal(calls.length, 2, 'החצות הבא מתוזמן');
    assert.equal(calls[1].ms, 24 * HOUR, '26.10 00:00:01 -> 27.10 00:00:01');
    assert.ok(cleared >= 2, 'כל תזמון מנקה את הקודם');
  });
});
