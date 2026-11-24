// תצוגת שנה ביומן (לצפייה בלבד). בדיקות צורה על public/index.html + פונקציות עזר טהורות. הבדיקה האמיתית (מראה, מגע) היא של יובל באייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const block = script.slice(script.indexOf('// מסך היומן (בלוק 7'), script.indexOf('\nrefresh();'));

function bodyOf(name) {
  const match = new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(block);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}
const pure = new Function(`${bodyOf('calSchoolYearStart')}\n${bodyOf('calYearMonthLayout')}\n${bodyOf('calYearStack')}\n${bodyOf('calYearUnknown')}\nreturn { calSchoolYearStart, calYearMonthLayout, calYearStack, calYearUnknown };`)();

describe('תצוגת שנה: פונקציות טהורות', () => {
  test('שנת לימודים מתחילה בספטמבר', () => {
    assert.equal(pure.calSchoolYearStart('2026-11-24'), '2026-09');
    assert.equal(pure.calSchoolYearStart('2026-09-01'), '2026-09');
    assert.equal(pure.calSchoolYearStart('2026-08-31'), '2025-09');
    assert.equal(pure.calSchoolYearStart('2027-01-15'), '2026-09');
  });
  test('פריסת חודש: ראשון = 0 תאים ריקים', () => {
    assert.deepEqual(pure.calYearMonthLayout(2026, 10), { lead: 0, days: 30, weeks: 5 }); // נובמבר 2026 מתחיל ביום ראשון
    assert.deepEqual(pure.calYearMonthLayout(2026, 8), { lead: 2, days: 30, weeks: 5 }); // ספטמבר 2026: שלישי
    assert.deepEqual(pure.calYearMonthLayout(2027, 1), { lead: 1, days: 28, weeks: 5 }); // פברואר 2027: שני
    assert.equal(pure.calYearMonthLayout(2026, 4).weeks, 6); // מאי 2026: שישי, 31 ימים
  });
  test('גובה עמודה: מספר המבחנים, עד 3', () => {
    assert.deepEqual([0, 1, 2, 3, 5].map(pure.calYearStack), [0, 1, 2, 3, 3]);
  });
  test('קווקו: אחרי סוף הלוח או כשאין לוח', () => {
    assert.equal(pure.calYearUnknown('2027-01-01', '2026-12-24'), true);
    assert.equal(pure.calYearUnknown('2026-12-24', '2026-12-24'), false);
    assert.equal(pure.calYearUnknown('2026-10-01', null), true);
  });
});

describe('public/index.html: תצוגת שנה', () => {
  test('בורר כולל "שנה"; חצי שנה קודמת/הבאה', () => {
    assert.match(bodyOf('calRenderModes'), /\['year', 'שנה'\]/);
    assert.match(bodyOf('calRender'), /שנת הלימודים הקודמת/);
    assert.match(bodyOf('calRender'), /שנת הלימודים הבאה/);
  });
  test('הנתונים: calendar-year מתחילת ספטמבר, דרך אותה נקודת קצה, ואימות צורה', () => {
    const load = bodyOf('calLoad');
    assert.match(load, /view=calendar-year&from=\$\{calYearStart\(\)\}/);
    assert.match(load, /data\.exams/);
  });
  test('הציור: 12 חודשים, צבע מקצוע, קווקו, לחיצה על חודש ועל יום', () => {
    const render = bodyOf('calRenderYear');
    assert.match(render, /i < 12/);
    assert.match(render, /calSetColors\(bar, e\.subject\)/);
    assert.match(render, /calYearUnknown\(date, coverageEnd\)/);
    assert.match(render, /calYearGo\('month'/);
    assert.match(render, /calYearGo\('day'/);
    assert.match(css, /\.yr-d\.unk \{[^}]*repeating-linear-gradient/);
  });
  test('מגע ופריסה: כותרת חודש 44px, 7 עמודות, בלי צבע מחוץ לטוקנים, מצב כהה למבדק', () => {
    assert.match(css, /\.yr-mh \{[^}]*min-height: 44px/);
    assert.match(css, /\.yr-g \{|\.yr-wd, \.yr-g \{[^}]*repeat\(7, minmax\(0, 1fr\)\)/);
    const yr = css.split('\n').filter((l) => /\.yr[-\s{.]/.test(l)).join('\n');
    assert.doesNotMatch(yr.replaceAll('#fff', ''), /#[0-9a-fA-F]{3,6}\b/); // בלי צבע קשיח חדש (#fff של "היום" קיים גם ברשת החודש)
    assert.match(css, /data-theme="dark"\] \.yr-b\.quiz/);
  });
  test('מעבר מתצוגת שנה לא קורס על נתונים בלי days', () => {
    assert.match(bodyOf('calHasWeek'), /days\?\.some/);
  });
});
