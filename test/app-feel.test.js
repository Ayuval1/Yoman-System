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

describe('public/index.html: ח-4 לחיצה ארוכה על הודעה (דפוס וואטסאפ)', () => {
  test('שכבה: רקע מטושטש, תפריט בסגנון iOS עם "הגב" ואז "העתק", שורות 44px עם סמל, קו מפריד', () => {
    assert.match(html, /id="mm"/);
    assert.match(css, /\.mm-back \{[^}]*backdrop-filter: blur/);
    const menu = /<div class="mm-menu" id="mmMenu" role="menu">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? '';
    const rows = [...menu.matchAll(/id="(mm\w+)" role="menuitem"><span>([^<]+)<\/span><svg/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(rows, [['mmReply', 'הגב'], ['mmCopy', 'העתק']]);
    assert.match(css, /\.mm-row \{[^}]*min-height: 44px/);
    assert.match(css, /\.mm-row \+ \.mm-row \{[^}]*border-top: \.5px solid var\(--sep\)/);
    assert.match(css, /\.quote-x \{[^}]*width: 44px; height: 44px/);
  });

  test('מאזינים: 400ms, כיווץ בזמן החזקה, ביטול ב-8px, גלילה, contextmenu', () => {
    assert.match(script, /HOLD_MS = 400/);
    assert.match(script, /HOLD_MOVE_PX = 8/);
    assert.match(css, /\.me\.pressing, \.sysb\.pressing \{ transform: scale\(\.96\)/);
    assert.match(script, /addEventListener\('touchstart'/);
    assert.match(script, /addEventListener\('scroll', cancelHold/);
    assert.match(script, /addEventListener\('contextmenu'/);
    assert.match(script, /closest\('\.me, \.sysb'\)/);
  });

  test('פתיחה במקום: עותק במיקום הבועה, הרמה בקפיץ, תפריט לצד הבועה, גבולות האזור הבטוח', () => {
    assert.match(script, /bubble\.getBoundingClientRect\(\)/);
    assert.match(script, /LIFT_EASE = 'cubic-bezier\(\.2, \.9, \.3, 1\.2\)'/);
    assert.match(script, /const alignLeft = centerX < vw \/ 2/);
    assert.match(css, /\.mm \{[^}]*safe-area-inset-top[^}]*safe-area-inset-bottom/);
    assert.match(script, /duration: 180/); // סגירה הפוכה
  });

  test('לחיצה-גרירה-שחרור: touchmove על document לא פסיבי רק בזמן שהאצבע למטה, elementFromPoint, הדגשה, שחרור על שורה מפעיל', () => {
    assert.match(script, /if \(mmCurrent\) startDragSelect\(\);/);
    assert.match(script, /document\.addEventListener\('touchmove', dragSelectMove, \{ passive: false \}\)/);
    assert.match(script, /document\.removeEventListener\('touchmove', dragSelectMove/);
    assert.match(script, /function dragSelectMove\(event\) \{\r?\n  if \(!mmFingerDown \|\| !mmCurrent\) return;\r?\n  event\.preventDefault\(\);/);
    assert.match(script, /document\.elementFromPoint\(x, y\)/);
    assert.match(script, /if \(row && mmCurrent && !mmClosing\) row\.click\(\)/);
    assert.match(css, /\.mm \.mm-row\.hot \{ background: var\(--sep\); \}/);
    assert.match(script, /mmMenu\.addEventListener\('pointerdown', \(event\) => setHotRow/);
  });

  test('בלי זכוכית מגדלת: user-select ו-touch-callout על כל הצאצאים של הבועות, השכבה והרשימה בזמן החזקה; selectstart נחסם', () => {
    const rule = /\.me \*, \.sysb \*, \.mm, \.mm \*, \.feed\.holding, \.feed\.holding \* \{([^}]*)\}/.exec(css)?.[1] ?? '';
    assert.match(rule, /-webkit-user-select: none; user-select: none; -webkit-touch-callout: none/);
    assert.match(script, /feedEl\.classList\.add\('holding'\)/);
    assert.match(script, /feedEl\.addEventListener\('selectstart', \(event\) => \{ if \(inBubble\(event\.target\)\) event\.preventDefault\(\); \}\)/);
    assert.doesNotMatch(script, /addEventListener\('touchstart'[^\n]*\{ passive: false \}/);
    assert.match(css, /input, textarea \{[^}]*user-select: text/);
  });

  test('"חבר Google" מוסתר רק כש-google_connected === true (false / null / חסר = גלוי)', () => {
    assert.match(script, /googleBtn\.hidden = data\?\.google_connected === true;/);
  });

  test('החלקה לתגובה: נעילת ציר ב-10px, עד 70px, "הגב" אחרי 55px, touchmove לא פסיבי, pan-y על בועות', () => {
    assert.match(script, /AXIS_LOCK_PX = 10/);
    assert.match(script, /SWIPE_MAX_PX = 70/);
    assert.match(script, /SWIPE_REPLY_PX = 55/);
    assert.match(script, /SWIPE_DIR = document\.documentElement\.dir === 'rtl' \? -1 : 1/);
    assert.match(script, /addEventListener\('touchmove', [\s\S]*?event\.preventDefault\(\);[\s\S]*?\}, \{ passive: false \}\)/);
    assert.match(script, /if \(reply && meta\) startReply\(meta\)/);
    assert.match(css, /\.me, \.sysb \{ touch-action: pan-y; \}/);
  });

  test('העתק: clipboard עם גיבוי והודעת "הועתק"', () => {
    assert.match(script, /navigator\.clipboard\.writeText/);
    assert.match(script, /execCommand\('copy'\)/);
    assert.match(script, /'הועתק'/);
  });

  test('הגב: שורת ציטוט עם שם, פס הדגשה וביטול, ו-reply_to נשלח לקליטה', () => {
    assert.match(html, /id="quote"/);
    assert.match(html, /id="quoteWho"/);
    assert.match(html, /id="quoteX"/);
    assert.match(css, /\.quote-box::before \{[^}]*inset-inline-start: 0[^}]*background: var\(--accent\)/);
    assert.match(script, /meta\.role === 'user' \? 'את\/ה' : 'המערכת'/);
    assert.match(script, /fields\.reply_to = String\(quoted\.id\)/);
    assert.match(script, /fields\.reply_to_role = quoted\.role/);
    assert.match(script, /new URLSearchParams\(fields\)/);
  });

  test('תנועה מופחתת: בלי כיווץ, רק דהייה, ב-CSS וב-JS', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{\r?\n([\s\S]*?)\r?\n  \}/.exec(css)?.[1] ?? '';
    assert.match(reduced, /\.me\.pressing, \.sysb\.pressing \{ transform: none/);
    assert.match(reduced, /\.quote:not\(\[hidden\]\) \{ animation-name: fade-in/);
    assert.match(script, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
    assert.match(script, /const grow = reduce \? 1 : 1\.03/);
  });
});

describe('public/index.html: קפיצה להודעה האחרונה', () => {
  test('כפתור 44px בתוך שורת הכתיבה וצף מעליה, עם מונה; תנועה מופחתת = בלי scale', () => {
    assert.match(html, /<form class="composer" id="composer">\s*<!--[^>]*-->\s*<button type="button" class="jump" id="jumpBtn"[^>]*><svg/);
    assert.match(html, /id="jumpCount" hidden/);
    assert.match(css, /\.jump \{[^}]*bottom: calc\(100% \+ 10px\); inset-inline-end: 16px;[^}]*width: 44px; height: 44px/);
    assert.match(css, /\.jump \{ transform: none; transition: opacity 150ms/);
  });

  test('גלילה: מאזין פסיבי עם rAF, סף 300px, גלילה חלקה (מיידית בתנועה מופחתת), מונה הודעות חדשות', () => {
    assert.match(script, /JUMP_SHOW_PX = 300/);
    assert.match(script, /requestAnimationFrame\(updateJump\);\r?\n\}, \{ passive: true \}\)/);
    assert.match(script, /behavior: instant \? 'auto' : 'smooth'/);
    assert.match(script, /jumpUnread \+= fresh\.length/);
  });
});

describe('public/index.html: כרטיס "נגמרה מכסת ה-AI"', () => {
  test('quota מהשרת נקרא, ושדה חסר (שרת ישן) = אין כרטיס', () => {
    assert.match(script, /state\.quota = validQuota\(data\?\.quota\)/);
    assert.match(script, /if \(!quota \|\| typeof quota !== 'object'\) return null/);
  });

  test('הכרטיס: כותרת, מגבלה, חוזר ושורת "נשמרות", באזור משלו מעל האזור הנעוץ', () => {
    assert.match(script, /'⚠️ נגמרה מכסת ה-AI'/);
    assert.match(script, /line\('מגבלה', quota\.kind_label/);
    assert.match(script, /line\('חוזר', quota\.returns_label/);
    assert.match(script, /נשמרות ויטופלו אוטומטית כשהמכסה חוזרת/);
    assert.ok(html.indexOf('id="quotaPin"') < html.indexOf('id="pin"'), 'מעל האזור הנעוץ');
    assert.match(script, /function render\(\) \{\r?\n  renderQuota\(\);/);
  });
});
