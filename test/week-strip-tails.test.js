// רצועת שבוע בכותרת + זנבות הכנה בלוח החודש. בדיקות צורה על public/index.html + פונקציות עזר טהורות. הבדיקה האמיתית (מראה, מגע) היא של יובל באייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function bodyOf(name) {
  const match = new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}
const SUBJECTS = /const CAL_SUBJECTS = \{[\s\S]*?\n\};\nconst calSubjectColors = [^\n]*/.exec(script)[0];
const pure = new Function(`${SUBJECTS}
const CAL_TAILS_MAX = 3; const CAL_STRIP_MAX = 4;
${bodyOf('calTailsOf')}\n${bodyOf('calTailOpacity')}\n${bodyOf('calStripDots')}
return { calTailsOf, calTailOpacity, calStripDots };`)();

describe('זנבות הכנה: פונקציות טהורות', () => {
  test('עד 3, החזקים קודם, ערכים לא תקינים מסוננים', () => {
    const day = { tails: [{ subject: 'א', strength: 0.2 }, { subject: 'ב', strength: 1 }, { subject: 'ג', strength: 0.5 }, { subject: 'ד', strength: 0.9 }, { subject: 'ה', strength: 'x' }, { subject: 'ו', strength: 2 }] };
    assert.deepEqual(pure.calTailsOf(day).map((t) => t.subject), ['ב', 'ד', 'ג']);
    assert.deepEqual(pure.calTailsOf({}), []);
    assert.deepEqual(pure.calTailsOf(null), []);
  });
  test('שקיפות: 0.3 עד 1, מוגבלת', () => {
    assert.equal(pure.calTailOpacity(0), 0.3);
    assert.equal(pure.calTailOpacity(1), 1);
    assert.equal(pure.calTailOpacity(0.5), 0.65);
    assert.equal(pure.calTailOpacity(9), 1);
  });
});

describe('רצועת שבוע: נקודות ליום', () => {
  test('בית ספר, מבחן בצבע המקצוע, אימון, אישי; בלי כפילויות', () => {
    const dots = pure.calStripDots({ items: [
      { kind: 'lesson', subject: 'מתמטיקה' }, { kind: 'lesson', subject: 'ספרות' },
      { kind: 'exam', subject: 'מתמטיקה' }, { kind: 'training' }, { kind: 'event' },
    ] });
    assert.deepEqual(dots, ['var(--cal-school)', '#6CA6CA', 'var(--cal-training)', '']);
  });
  test('יום ריק, חסר או מועד ב׳ או מקצוע בלי צבע', () => {
    assert.deepEqual(pure.calStripDots(undefined), []);
    assert.deepEqual(pure.calStripDots({ items: [] }), []);
    assert.deepEqual(pure.calStripDots({ items: [{ kind: 'exam', subject: 'מדעי המחשב' }, { kind: 'exam', subject: 'אנגלית', makeup: true }] }), ['']);
  });
  test('תקרה של 4 נקודות', () => {
    const items = ['מתמטיקה', 'אנגלית', 'ספרות', 'עברית', 'תנ"ך'].map((subject) => ({ kind: 'exam', subject }));
    assert.equal(pure.calStripDots({ items }).length, 4);
  });
});

describe('public/index.html: רצועת שבוע וזנבות', () => {
  test('הרצועה בתוך הכותרת, אחרי התאריך, ולא נוגעת באייקון', () => {
    const hero = /<header class="hero">[\s\S]*?<\/header>/.exec(html)[0];
    assert.match(hero, /id="calOpen"/);
    assert.match(hero, /<nav class="wkstrip" id="wkStrip"/);
    assert.ok(hero.indexOf('id="todayDate"') < hero.indexOf('id="wkStrip"'));
  });
  test('כפתורי הימים 44px, היום לבן, בלי hover', () => {
    assert.match(css, /\.wk-d \{[^}]*min-height: 44px/);
    assert.match(css, /\.wk-d\.today \{[^}]*background: #fff/);
    assert.doesNotMatch(css.slice(css.indexOf('.wkstrip'), css.indexOf('.wk-dot.plain')), /:hover/);
  });
  test('לחיצה על יום פותחת את היומן על אותו יום; האייקון נשאר חודש', () => {
    assert.match(script, /b\.addEventListener\('click', \(\) => openCalendar\(date\)\)/);
    assert.match(script, /getElementById\('calOpen'\)\.addEventListener\('click', \(\) => openCalendar\(\)\)/);
    assert.match(bodyOf('openCalendar'), /target \? 'day' : 'month'/);
  });
  test('טעינה: אותו endpoint, נקראת מ-refresh, נכשלת בשקט', () => {
    const load = bodyOf('wkLoad');
    assert.match(load, /authedFetch\(`\/api\/chat\?view=calendar&from=\$\{calWeekStartOf\(calToday\(\)\)\}&days=7`\)/);
    assert.match(load, /catch \(err\)/);
    assert.match(bodyOf('refresh'), /wkLoad\(\)/);
  });
  test('זנבות: בתא החודש בלבד, בצבע המקצוע, בלי overflow', () => {
    assert.match(bodyOf('calMonthCell'), /calTailsOf\(day\)/);
    for (const fn of ['calRenderWeek', 'calRenderDay', 'calRenderYear']) assert.doesNotMatch(bodyOf(fn), /calTailsOf|cal-tail/, fn);
    assert.match(css, /\.cal-tail \{[^}]*background: var\(--tc/);
    assert.match(css, /\.cal-day \{[^}]*overflow: hidden/);
  });
  test('אין צבע או גופן חדש בקוד החדש', () => {
    const added = css.slice(css.indexOf('.cal-day.has-tails'), css.indexOf('.wk-dot.plain'));
    assert.doesNotMatch(added, /font-family/);
    const colors = added.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual([...new Set(colors)], ['#fff']);
  });
});

test('רצועת השבוע: בלי סוד שמור לא נטענת (לא פותחת חלון סוד שני), ולכל היותר פעם ב-5 דקות', async () => {
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const body = html.slice(html.indexOf('async function wkLoad()'), html.indexOf('async function wkLoad()') + 900);
  assert.match(body, /if \(!readSecret\(\)\) return;/);
  assert.match(body, /Date\.now\(\) - wkState\.at < WK_REFRESH_MS/);
});
