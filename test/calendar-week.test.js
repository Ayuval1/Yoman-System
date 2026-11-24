// תצוגת שבוע ביומן (לצפייה בלבד). בדיקות צורה על public/index.html + הרצת פונקציות העזר הטהורות. הבדיקה האמיתית (מראה, מגע) היא של יובל באייפון.
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
const pure = new Function(`${bodyOf('calAddDays')}\n${bodyOf('calWeekStartOf')}\n${bodyOf('calWeekLayout')}\nreturn { calAddDays, calWeekStartOf, calWeekLayout };`)();

describe('תצוגת שבוע: פונקציות טהורות', () => {
  test('תחילת שבוע = ראשון (22.11.2026 הוא יום ראשון)', () => {
    assert.equal(pure.calWeekStartOf('2026-11-22'), '2026-11-22');
    assert.equal(pure.calWeekStartOf('2026-11-25'), '2026-11-22');
    assert.equal(pure.calWeekStartOf('2026-11-28'), '2026-11-22'); // שבת
    assert.equal(pure.calWeekStartOf('2026-11-29'), '2026-11-29');
  });
  test('חיבור ימים חוצה חודש ושנה', () => {
    assert.equal(pure.calAddDays('2026-12-30', 3), '2027-01-02');
    assert.equal(pure.calAddDays('2026-03-01', -1), '2026-02-28');
    assert.equal(pure.calWeekStartOf('2027-01-01'), '2026-12-27');
  });
  test('פריסה: בלי חפיפה = נתיב אחד; חפיפה = שני נתיבים; מקבצים נפרדים לא מושפעים', () => {
    const out = pure.calWeekLayout([{ s: 480, e: 525 }, { s: 480, e: 540 }, { s: 600, e: 645 }]);
    assert.deepEqual(out[0], { lane: 0, lanes: 2 });
    assert.deepEqual(out[1], { lane: 1, lanes: 2 });
    assert.deepEqual(out[2], { lane: 0, lanes: 1 });
    assert.deepEqual(pure.calWeekLayout([{ s: 480, e: 525 }, { s: 525, e: 570 }]), [{ lane: 0, lanes: 1 }, { lane: 0, lanes: 1 }]);
    assert.deepEqual(pure.calWeekLayout([]), []);
  });
});

describe('תצוגת שבוע: קיצור שם מקצוע (הכרעת יובל 24.11.2026: "קיצור (מתמ׳)")', () => {
  const { calShortSubject } = new Function(`${bodyOf('calShortSubject')}\nreturn { calShortSubject };`)();
  test('שם ארוך מקוצר; קצר נשאר מלא; לא מוכר נשאר כמו שהוא', () => {
    assert.equal(calShortSubject('מתמטיקה'), 'מתמ׳');
    assert.equal(calShortSubject('אנגלית'), 'אנג׳');
    assert.equal(calShortSubject('היסטוריה'), 'היסט׳');
    assert.equal(calShortSubject('אזרחות'), 'אזרח׳');
    assert.equal(calShortSubject('פיזיקה'), 'פיז׳');
    for (const s of ['ספרות', 'ערבית', 'מדעים', 'תנ"ך', 'לשון']) assert.equal(calShortSubject(s), s);
    assert.equal(calShortSubject(' מתמטיקה '), 'מתמ׳');
    assert.equal(calShortSubject(''), '');
  });
  test('שיעור ומבחן בשבוע מציגים את הקיצור; התווית הנגישה עם השם המלא', () => {
    const item = bodyOf('calWeekItem');
    assert.match(item, /top = calShortSubject\(item\.subject \|\| item\.title\)/);
    const aria = item.split('\n').find((line) => line.includes("'aria-label'")) ?? '';
    assert.ok(aria.includes('${item.subject ?? item.title}') && !aria.includes('calShortSubject'), 'התווית הנגישה עם השם המלא');
  });
  test('מילה שעדיין לא נכנסת: הגופן יורד עד 9px אחרי ציור השבוע, ותא בלי רוחב לא נוגעים', () => {
    const fit = bodyOf('calFitWeekText');
    assert.match(fit, /size > 9/);
    assert.match(fit, /if \(!t\.clientWidth\) continue/);
    assert.match(block, /calRenderWeek\(\); calFitWeekText\(\);/);
  });
  test('אין שבירה באמצע מילה בשם בתא השבוע', () => {
    const rule = /\.wk-it \.t \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.doesNotMatch(rule, /overflow-wrap: anywhere|word-break: break-all/);
    assert.match(rule, /word-break: keep-all/);
  });
});

describe('public/index.html: תצוגת שבוע', () => {
  test('בורר חודש / שבוע / יום, 44px, מסומן ב-aria-pressed', () => {
    assert.match(html, /id="calModes"/);
    const render = bodyOf('calRenderModes');
    assert.match(render, /'חודש'/); assert.match(render, /'שבוע'/); assert.match(render, /'יום'/);
    assert.match(render, /aria-pressed/);
    assert.match(css, /\.cal-mode \{[^}]*min-height: 44px/);
  });
  test('הנתונים: שבוע מבקש 7 ימים מראשון, דרך אותה נקודת קצה (בלי קובץ api חדש)', () => {
    assert.match(bodyOf('calLoad'), /view=calendar&from=\$\{calState\.week\}&days=7/);
  });
  test('הפריסה: 7 עמודות, ראשון בימין (RTL), פריטים לפי שעה, שורת "כל היום"', () => {
    assert.match(css, /\.wk-row \{[^}]*repeat\(7, minmax\(0, 1fr\)\)/);
    const render = bodyOf('calRenderWeek');
    assert.match(render, /CAL_WEEKDAYS\[i\]/);
    assert.match(render, /'כל היום'/);
    assert.match(render, /insetInlineStart/);
    assert.match(render, /item\.kind === 'break'/); // הפסקות לא בשבוע
  });
  test('שיעור: מקצוע וחדר; מבחן: תמיד בצבע המקצוע עם שם המקצוע; ממתין: "ממתין"', () => {
    const item = bodyOf('calWeekItem');
    assert.match(item, /item\.room/);
    assert.match(item, /calSetColors\(b, item\.subject\)/);
    assert.match(item, /'ממתין'/);
  });
  test('פרטים בלחיצה: אותו כרטיס פרטים כמו ברשימת היום; בלי עריכה', () => {
    assert.match(bodyOf('calRenderWeek'), /calItemNode\(selItem, sel\.index\)/);
    assert.doesNotMatch(bodyOf('calRenderWeek') + bodyOf('calWeekItem'), /method: ?'(POST|PUT|PATCH|DELETE)'|draggable|contenteditable/);
  });
  test('החלקה ושבוע קודם/הבא', () => {
    assert.match(block, /calState\.view === 'week'\) calStepWeek\(/);
    assert.match(bodyOf('calRender'), /'השבוע הקודם'/);
    assert.match(bodyOf('calRender'), /'השבוע הבא'/);
  });
  test('מצב כהה ובלי צבע חדש: רק טוקנים ומשתנים קיימים בבלוק השבוע', () => {
    const wkCss = css.split('\n').filter((l) => /\.wk[-\s.{]/.test(l)).join('\n');
    assert.match(css, /data-theme="dark"\] \.wk-it\.exam\.quiz/);
    assert.doesNotMatch(wkCss.replaceAll("#fff", ""), /#[0-9a-fA-F]{3,8}\b/); // #fff = כמו .cal-todaytag הקיים
  });
});

test('חודש אחרי שבוע: 7 ימים שנטענו לא נחשבים כחודש טעון (מקור "from" מסומן לשבוע)', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /calState\.from = week \? `week:\$\{calState\.week\}` : calGridStart\(calState\.y, calState\.m\);/);
});
