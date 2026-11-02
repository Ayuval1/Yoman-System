// בלוק פירוט בבועה: טקסט המוקף בשתי שורות U+2063 מוסתר מאחורי "פירוט ›" / "פחות".
// public/index.html הוא סקריפט inline בלי מודולים, ולכן: הרצה בבידוד (vm) של splitDetail + בדיקות צורה על הקובץ.
// ההוכחה האמיתית (מראה, מגע, RTL על אייפון PWA) היא בדיקה של יובל.
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
const markDecl = grab(/const DETAIL_MARK = [^\n]*/, 'DETAIL_MARK');
const splitSrc = grab(/function splitDetail\(text\) \{[\s\S]*?\n\}/, 'splitDetail');
const splitDetail = vm.runInNewContext(`${markDecl}\n(${splitSrc})`);
const M = '⁣';

describe('splitDetail', () => {
  test('בלי מפריד: null (ההודעה כמו היום)', () => {
    assert.equal(splitDetail('שלום\nעולם'), null);
    assert.equal(splitDetail(''), null);
    assert.equal(splitDetail(undefined), null);
  });

  test('מפריד אחד בלבד: null', () => {
    assert.equal(splitDetail(`א\n${M}\nב`), null);
  });

  test('שני מפרידים: לפני, פירוט, אחרי', () => {
    const got = splitDetail(`סיכום\n${M}\nשורה 1\nשורה 2\n${M}\nסוף`);
    assert.deepEqual({ ...got }, { before: 'סיכום', detail: 'שורה 1\nשורה 2', after: 'סוף' });
  });

  test('בלי טקסט לפני או אחרי, וגם CRLF', () => {
    const got = splitDetail(`${M}\r\nפירוט\r\n${M}`);
    assert.equal(got.before, '');
    assert.equal(got.after, '');
    assert.match(got.detail, /^פירוט/);
  });

  test('בלוק ריק: null', () => {
    assert.equal(splitDetail(`א\n${M}\n\n${M}\nב`), null);
  });

  test('התו בתוך שורה עם טקסט אינו מפריד', () => {
    assert.equal(splitDetail(`א${M}ב\nג${M}ד`), null);
  });
});

describe('textBlock עם פירוט: צורה', () => {
  test('הפירוט נכנס דרך el (textContent), לא innerHTML', () => {
    const fn = grab(/function textBlock\(text, key, opts = \{\}\) \{[\s\S]*?\n\}/, 'textBlock');
    assert.match(fn, /el\('div', 'txt detail', parts\.detail\)/);
    assert.doesNotMatch(fn.replace(/\/\/[^\n]*/g, ''), /innerHTML/);
  });

  test('כפתור אמיתי עם aria-expanded ו-aria-controls', () => {
    const fn = grab(/function textBlock\(text, key, opts = \{\}\) \{[\s\S]*?\n\}/, 'textBlock');
    assert.match(fn, /el\('button', 'more-txt detail-btn'/);
    assert.match(fn, /toggle\.type = 'button'/);
    assert.match(fn, /setAttribute\('aria-expanded'/);
    assert.match(fn, /setAttribute\('aria-controls'/);
  });

  test('החיתוך הקיים נשמר: לפני ואחרי עוברים דרך clampedBlock, והבלוק לא', () => {
    const fn = grab(/function textBlock\(text, key, opts = \{\}\) \{[\s\S]*?\n\}/, 'textBlock');
    assert.match(fn, /clampedBlock\(parts\.before/);
    assert.match(fn, /clampedBlock\(parts\.after/);
    assert.match(fn, /if \(!parts\) return clampedBlock\(text, key, opts\)/, 'בלי מפריד: מסלול זהה להיום');
  });

  test('CSS: שטח מגע 44px והבלוק הסגור מוסתר', () => {
    assert.match(html, /\.more-txt\.detail-btn \{[^}]*min-height: 44px/);
    assert.match(html, /\.txt\.detail\[hidden\] \{ display: none; \}/);
  });
});
