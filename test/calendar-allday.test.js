// אירוע אישי של יום שלם או כמה ימים (חופשה, טיול) במסך היומן: שורת "כל היום", בלי גוש שעות מ-00:00. בדיקות צורה על public/index.html + פונקציות עזר טהורות.
// הבדיקה האמיתית (מראה, מגע) היא של יובל באייפון.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

function bodyOf(name) {
  const match = new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`).exec(script);
  assert.ok(match, `הפונקציה ${name} קיימת`);
  return match[0];
}
const SUBJECTS = /const CAL_SUBJECTS = \{[\s\S]*?\n\};\nconst calSubjectColors = [^\n]*/.exec(script)[0];
const pure = new Function(`${SUBJECTS}
const CAL_STRIP_MAX = 4;
${bodyOf('calIsAllDay')}\n${bodyOf('calAllDayRange')}\n${bodyOf('calStripDots')}
return { calIsAllDay, calAllDayRange, calStripDots };`)();

const vienna = { kind: 'event', title: 'חופשה בווינה', start: '2026-11-29T22:00:00.000Z', end: '2026-12-03T22:00:00.000Z', allDay: true, firstDate: '2026-11-30', lastDate: '2026-12-03' };

describe('יום שלם: פונקציות טהורות', () => {
  test('calIsAllDay: allDay או בלי שעת התחלה (מבחן בלי שעה); אירוע רגיל לא', () => {
    assert.equal(pure.calIsAllDay(vienna), true);
    assert.equal(pure.calIsAllDay({ kind: 'exam', start: null }), true);
    assert.equal(pure.calIsAllDay({ kind: 'event', start: '2026-11-22T10:00:00.000Z' }), false);
    assert.equal(pure.calIsAllDay(null), false);
  });
  test('calAllDayRange: רב-יומי = "30.11–3.12", יום אחד או בלי טווח = ריק', () => {
    assert.equal(pure.calAllDayRange(vienna), '30.11–3.12');
    assert.equal(pure.calAllDayRange({ allDay: true, firstDate: '2026-12-31', lastDate: '2027-01-02' }), '31.12–2.1');
    assert.equal(pure.calAllDayRange({ allDay: true, firstDate: '2026-11-30', lastDate: '2026-11-30' }), '');
    assert.equal(pure.calAllDayRange({ kind: 'event', start: null }), '');
  });
  test('רצועת השבוע: יום שהחופשה מכסה מקבל נקודת אירוע', () => {
    assert.deepEqual(pure.calStripDots({ items: [vienna] }), ['']);
  });
});

describe('יום שלם: צורת המסך', () => {
  test('שבוע: פריט יום שלם בשורת "כל היום" ולא ברשת השעות', () => {
    const week = bodyOf('calRenderWeek');
    assert.match(week, /filter\(\(x\) => calIsAllDay\(x\.item\)\)/);
    assert.match(week, /if \(calIsAllDay\(item\) \|\| item\.kind === 'break'\) return;/);
  });
  test('שבוע: תא יום שלם בלי שעות בתווית הנגישה, וצבע אירוע', () => {
    const item = bodyOf('calWeekItem');
    assert.match(item, /calIsAllDay\(item\)/);
    assert.match(item, /classList\.add\('evt'\)/);
    assert.match(css, /\.wk-it\.evt\s*\{/);
  });
  test('יום: שעה לא מחושבת מ-00:00 לפריט יום שלם, ויש תווית טווח', () => {
    const node = bodyOf('calItemNode');
    assert.match(node, /const allDay = calIsAllDay\(item\)/);
    assert.match(node, /allDay \? '' : calHm\(item\.start\)/);
    assert.match(node, /calAllDayRange\(item\)/);
  });
  test('כלל אי-שבירה באמצע מילה בתא השבוע נשאר', () => {
    assert.match(css, /\.wk-it \.t \{[^}]*word-break: keep-all/);
    assert.match(bodyOf('calFitWeekText'), /size > 9/);
  });
});
