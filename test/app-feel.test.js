// "מרגיש כמו אפליקציה" (אפיון-מורחב ח-3, ח-4): בדיקות צורה על public/index.html. אין בדיקות דפדפן.
// ההוכחה האמיתית (זום, סימון, לחיצה ארוכה) היא באייפון אמיתי.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

describe('public/index.html: ח-3 מרגיש כמו אפליקציה', () => {
  test('viewport: בלי זום ועם viewport-fit=cover', () => {
    const tag = /<meta name="viewport"[^>]*>/.exec(html)?.[0] ?? '';
    assert.match(tag, /user-scalable=no/);
    assert.match(tag, /maximum-scale=1/);
    assert.match(tag, /viewport-fit=cover/);
  });

  test('theme-color: שניים, בהיר וכהה, עם media', () => {
    const tags = html.match(/<meta name="theme-color"[^>]*>/g) ?? [];
    assert.equal(tags.length, 2);
    assert.ok(tags.some((t) => /prefers-color-scheme: light/.test(t) && /#0A7A36/.test(t)));
    assert.ok(tags.some((t) => /prefers-color-scheme: dark/.test(t)));
  });

  test('html: בלי הבהוב, בלי הגדלת גופן, בלי overscroll', () => {
    assert.match(css, /html \{[^}]*-webkit-tap-highlight-color: transparent/);
    assert.match(css, /html \{[^}]*text-size-adjust: 100%/);
    assert.match(css, /html \{[^}]*overscroll-behavior: none/);
    assert.match(css, /body \{ overscroll-behavior: none/);
  });

  test('שדות קלט: גופן 16px לפחות בכל כלל שמגדיר גודל לשדה', () => {
    assert.match(css, /input, textarea, select \{ font-size: 16px/);
    const rules = [...css.matchAll(/(?:^|\n)\s*([^{}\n]*input[^{}\n]*)\{([^}]*)\}/g)];
    for (const [, selector, body] of rules) {
      const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(body);
      if (size) assert.ok(Number(size[1]) >= 16, `${selector.trim()} font-size ${size[1]}px < 16`);
    }
  });

  test('מגע: touch-action ובלי סימון על כפתורים/כרטיסים/בועות, לא על body; שדות נשארים ניתנים לסימון', () => {
    const rule = /button, a, \[role="button"\][^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(rule, /touch-action: manipulation/);
    assert.match(rule, /user-select: none/);
    assert.match(rule, /-webkit-touch-callout: none/);
    assert.doesNotMatch(css, /body\s*\{[^}]*user-select: none/);
    assert.match(css, /input, textarea \{[^}]*user-select: text/);
  });

  test('מצב לחיצה :active על כפתורים', () => {
    assert.match(css, /button:not\(:disabled\):active \{[^}]*transform: scale/);
  });

  test(':hover רק בתוך @media (hover: hover) and (pointer: fine)', () => {
    const hoverMedia = /@media \(hover: hover\) and \(pointer: fine\) \{([\s\S]*?)\n  \}/.exec(css)?.[1] ?? '';
    assert.match(hoverMedia, /:hover/);
    const outside = css.replace(/@media \(hover: hover\) and \(pointer: fine\) \{[\s\S]*?\n  \}/, '');
    assert.doesNotMatch(outside, /:hover/);
  });

  test('אזורים בטוחים והגובה: 100dvh ו-safe-area למעלה ולמטה', () => {
    assert.match(css, /height: 100dvh/);
    assert.match(css, /\.hero \{[^}]*safe-area-inset-top/);
    assert.match(css, /\.composer \{[^}]*safe-area-inset-bottom/);
  });
});

describe('public/index.html: ח-4 לחיצה ארוכה על הודעה', () => {
  test('שכבה: אלמנט עם טשטוש, כפתורי העתק והגב בגובה 44px', () => {
    assert.match(html, /id="mm"/);
    assert.match(html, /id="mmCopy">העתק</);
    assert.match(html, /id="mmReply">הגב</);
    assert.match(css, /\.mm \{[^}]*backdrop-filter: blur/);
    assert.match(css, /\.mm-btn \{[^}]*min-height: 44px/);
    assert.match(css, /\.quote-x \{[^}]*width: 44px; height: 44px/);
  });

  test('מאזינים: 500ms, ביטול ב-10px, גלילה, contextmenu', () => {
    assert.match(script, /HOLD_MS = 500/);
    assert.match(script, /HOLD_MOVE_PX = 10/);
    assert.match(script, /addEventListener\('touchstart'/);
    assert.match(script, /addEventListener\('touchmove'/);
    assert.match(script, /addEventListener\('scroll', cancelHold/);
    assert.match(script, /addEventListener\('contextmenu'/);
    assert.match(script, /closest\('\.me, \.sysb'\)/);
  });

  test('העתק: clipboard עם גיבוי והודעת "הועתק"', () => {
    assert.match(script, /navigator\.clipboard\.writeText/);
    assert.match(script, /execCommand\('copy'\)/);
    assert.match(script, /'הועתק'/);
  });

  test('הגב: שורת ציטוט עם ביטול, ו-reply_to נשלח לקליטה', () => {
    assert.match(html, /id="quote"/);
    assert.match(html, /id="quoteX"/);
    assert.match(script, /fields\.reply_to = String\(quoted\.id\)/);
    assert.match(script, /new URLSearchParams\(fields\)/);
  });

  test('תנועה מופחתת: האנימציה של השכבה מכובדת', () => {
    assert.match(css, /prefers-reduced-motion: reduce\) \{ \.mm \{ animation: none/);
  });
});
