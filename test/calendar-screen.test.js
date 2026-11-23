// מסך היומן לצפייה בלבד (בלוק 7 חלק א'-2; docs/02-rules/03-design-rules.md שכבה 4). בדיקות צורה על public/index.html, בלי דפדפן.
// ההוכחה האמיתית (מראה וגודל אמיתי, מגע) היא בדיקה של יובל על האייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
const block = script.slice(script.indexOf('// מסך היומן (בלוק 7'), script.indexOf('\nrefresh();'));
const section = /<section class="rvscreen" id="cal"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

// גוף פונקציה אחת מקטע היומן.
function bodyOf(name) {
  const match = new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(block);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}

describe('public/index.html: מסך היומן', () => {
  test('המסך קיים, מוסתר כברירת מחדל, ויש כפתור חזרה לצ\'אט', () => {
    assert.ok(section.length > 0, 'סעיף #cal קיים');
    assert.match(section, /hidden>/);
    assert.match(section, /id="calClose"[^>]*>חזרה לצ'אט</);
    assert.ok(block.length > 100, 'קטע הסקריפט של היומן קיים');
  });

  test('הכניסה: אייקון יומן בכותרת הירוקה פותח את תצוגת החודש', () => {
    const hero = /<header class="hero">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
    assert.match(hero, /id="calOpen"/);
    assert.match(bodyOf('openCalendar'), /calState\.view = 'month'/);
    assert.match(script, /getElementById\('calOpen'\)\.addEventListener\('click', openCalendar\)/);
  });

  test('הנתונים: view=calendar עם from ו-days (42), באותה בקשה עם הסוד', () => {
    const load = bodyOf('calLoad');
    assert.match(load, /`\/api\/chat\?view=calendar&from=\$\{calGridStart\([^)]*\)\}&days=42`/);
    assert.match(load, /authedFetch\(path\)/);
  });

  test('מצבי טעינה וכשל: "טוען" ו"לא הצלחתי לטעון את היומן" עם ניסיון חוזר', () => {
    assert.match(block, /const CAL_ERROR_TEXT = 'לא הצלחתי לטעון את היומן'/);
    const render = bodyOf('calRender');
    assert.match(render, /'טוען…'/);
    assert.match(render, /'נסה שוב'/);
    assert.match(render, /addEventListener\('click', calLoad\)/);
  });

  test('בלי כפתורי עריכה: אין מחיקה, עריכה, הוספה, גרירה או שליחה בקטע היומן', () => {
    assert.doesNotMatch(section, /contenteditable|<input|<textarea|<form/i);
    assert.doesNotMatch(block, /method: ?'(POST|PUT|PATCH|DELETE)'|postChat\(|draggable|dragstart|contenteditable/);
    assert.doesNotMatch(block, /['"`](ערוך|עריכה|מחק|מחיקה|הוסף|הוספה|שמור|בטל)[ '"`]/);
    // כל הכפתורים שנוצרים בקטע: חודש קודם/הבא, חזרה, נסה שוב, ושורות (פרטים בלבד)
    assert.doesNotMatch(block, /innerHTML/, 'טקסט מהשרת נכנס רק דרך textContent');
  });

  test('שיעורים והפסקות לא ברשת החודש, ורק ברשימת היום', () => {
    const cell = bodyOf('calMonthCell');
    assert.doesNotMatch(cell, /'lesson'|'break'/, 'תא החודש לא מצייר שיעור או הפסקה');
    assert.match(cell, /item\.kind === 'exam'/);
    assert.match(cell, /item\.pending/);
    assert.match(cell, /item\.kind === 'training'/);
    const item = bodyOf('calItemNode');
    assert.match(item, /item\.kind === 'lesson'/);
    assert.match(item, /item\.kind === 'break'/);
  });

  test('מבחן = מילוי, מבדק = מתאר; ממתין = ענבר מקווקו 1.5px עם "?"', () => {
    assert.match(css, /\.cal-chip\.quiz \{[^}]*background: transparent/);
    assert.match(css, /\.cal-chip\.pending \{[^}]*1\.5px dashed var\(--amber\)/);
    assert.match(css, /\.cal-item\.pending \{[^}]*1\.5px dashed var\(--amber\)/);
    assert.match(bodyOf('calMonthCell'), /chip\.append\(el\('span', 'ct', item\.title\), el\('span', '', '\?'\)\)/);
  });

  test('שיעור: צבע "בית ספר" #ABC0DB ופס מקצוע דק; הפסקה אפורה', () => {
    assert.match(css, /--cal-school: #ABC0DB/);
    assert.match(css, /\.cal-item\.lesson \{[^}]*var\(--cal-school\)/);
    assert.match(css, /\.cal-item\.lesson::before \{[^}]*width: 5px/);
    assert.match(css, /\.cal-item\.brk \{[^}]*var\(--sep\)/);
  });

  test('מקצועות: צבעי הפלטה מהמפרט, ובלי צבע למקצועות שאין להם', () => {
    assert.match(block, /'מתמטיקה': \['#6CA6CA', '#235E7F'\]/);
    assert.match(block, /'היסטוריה': \['#A9AE62', '#626614'\]/);
    assert.doesNotMatch(block, /'מדעי המחשב':|'חנ"ג':|'חינוך פיננסי':|'כישורי חיים':|'שיח אישי':/);
    assert.match(block, /\[הנחה, לא אומת/);
  });

  test('"מבחנים ב<חודש> — לא ידוע" מתוך unknownExams, ורק לחודש המוצג', () => {
    const month = bodyOf('calRenderMonth');
    assert.match(month, /unknownExams/);
    assert.match(month, /u\.month === monthKey/);
    assert.match(month, /unknown\.text/);
  });

  test('רשת חודש ראשון עד שבת, ומעבר חודש קודם/הבא', () => {
    assert.match(block, /CAL_WEEKDAYS = \['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'\]/);
    assert.match(css, /\.cal-grid \{[^}]*repeat\(7/);
    const render = bodyOf('calRender');
    assert.match(render, /calShift\(-1\)/);
    assert.match(render, /calShift\(1\)/);
  });

  test('אזורי מגע 44px, בלי hover, וללא צבע חדש מחוץ למפרט', () => {
    assert.match(css, /\.cal-open \{[^}]*width: 44px; height: 44px/);
    assert.match(css, /\.cal-btn \{[^}]*min-height: 44px/);
    assert.match(css, /\.cal-item \{[^}]*min-height: 44px/);
    assert.match(css, /\.cal-day \{[^}]*min-height: 84px/);
    const calCss = css.slice(css.indexOf('מסך היומן (בלוק 7'));
    assert.doesNotMatch(calCss, /:hover/);
    const hexes = new Set((calCss.match(/#[0-9A-Fa-f]{6}\b/g) ?? []).map((h) => h.toUpperCase()));
    assert.deepEqual([...hexes].sort(), ['#0B1410', '#9DC7CB', '#ABC0DB']);
  });

  test('safe area ומצב כהה: מסגרת המבדק בגוון המילוי', () => {
    assert.match(css, /\.cal-open \{[^}]*env\(safe-area-inset-top\)/);
    assert.match(css, /prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \.cal-chip\.quiz/);
    assert.match(css, /:root\[data-theme="dark"\] \.cal-chip\.quiz/);
  });

  test('רצועת השבוע בכותרת לא נבנתה עדיין', () => {
    assert.doesNotMatch(html, /weekstrip|week-strip|calStrip/i);
  });
});

describe('public/index.html: נגישות מסך היומן', () => {
  const labelFn = () => {
    const src = /const calCount = [\s\S]*?\nfunction calDayLabel\([^)]*\) \{[\s\S]*?\n\}/.exec(block)?.[0];
    assert.ok(src, 'calDayLabel קיימת');
    const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
    const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return new Function('DAYS', 'MONTHS', `${src}; return calDayLabel;`)(DAYS, MONTHS);
  };

  test('תא יום: התווית כוללת תאריך, "היום" וספירה מלאה', () => {
    assert.match(bodyOf('calMonthCell'), /setAttribute\('aria-label', calDayLabel\(day, today\)\)/);
    const label = labelFn();
    const items = [{ kind: 'exam' }, { kind: 'exam' }, { kind: 'exam', quiz: true }, { kind: 'event', pending: true }];
    assert.equal(label({ date: '2026-11-24', items }, '2026-11-24'), 'יום שלישי 24 בנובמבר, היום, 2 מבחנים, מבדק אחד, אירוע אחד ממתין לתשובה');
    assert.equal(label({ date: '2026-11-25', items: [] }, '2026-11-24'), 'יום רביעי 25 בנובמבר');
    assert.equal(label({ date: '2026-11-25', items: [{ kind: 'event' }, { kind: 'event' }, { kind: 'event' }] }, 'x'), 'יום רביעי 25 בנובמבר, 3 אירועים');
  });

  test('פוקוס: האפליקציה inert בזמן שהיומן פתוח, הפוקוס חוזר לפותח, Escape סוגר', () => {
    assert.match(script, /const appEl = document\.querySelector\('\.app'\)/);
    assert.match(bodyOf('openCalendar'), /appEl\.inert = true/);
    assert.match(bodyOf('openCalendar'), /calOpener = document\.activeElement/);
    assert.match(bodyOf('closeCalendar'), /appEl\.inert = false/);
    assert.match(bodyOf('closeCalendar'), /calOpener/);
    assert.match(block, /key === 'Escape' && calState\.open/);
  });

  test('"טוען…" נקרא בקורא מסך (aria-live)', () => {
    assert.match(section, /<p class="cal-status" id="calStatus" role="status" aria-live="polite"><\/p>/);
    assert.match(bodyOf('calRender'), /calStatusEl\.textContent = calState\.status === 'loading' \? 'טוען…' : ''/);
    assert.doesNotMatch(block, /setAttribute\('aria-live'/);
  });

  test('חופש: תווית בתא החודש, שורה ביום ו-aria-label, בלי לתפוס מקום של צ׳יפ', () => {
    const cell = bodyOf('calMonthCell');
    assert.match(cell, /day\.noSchool/);
    assert.match(cell, /'cal-off'/);
    assert.match(cell, /'חופש'/);
    assert.match(bodyOf('calDayLabel'), /day\.noSchool[^\n]*'חופש'/);
    assert.match(bodyOf('calRenderDay'), /day\??\.noSchool/);
    assert.match(bodyOf('calRenderDay'), /'אין בית ספר'/);
    assert.match(css, /\.cal-off \{[^}]*var\(--label2\)/);
  });

  test('פתיחה כפולה לא דורסת את הפותח; סגירת הסיכום מחזירה פוקוס לפס החדש', () => {
    assert.match(bodyOf('openCalendar'), /if \(calState\.open\) return;/);
    assert.match(script, /function openReview\(\) \{\s*if \(state\.rvOpen\) return;/);
    assert.match(script.slice(script.indexOf('function closeReview'), script.indexOf('rvCloseBtn.addEventListener')), /pinEl\.querySelector\('\.mini \.ch'\)/);
    assert.match(script.slice(script.indexOf('function closeReview'), script.indexOf('rvCloseBtn.addEventListener')), /rvOpener\.isConnected/);
  });
});
