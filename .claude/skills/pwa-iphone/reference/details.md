<div dir="rtl">

# פירוט טכני — pwa-iphone

נכתב מחדש ב-21.11.2026 בשביל הפרויקט, ב-JavaScript וב-CSS רגילים (בלי React). הרעיונות נלמדו משלושה סקילים ציבוריים (ראו `SKILL.md`, "מקור"). לא הועתק מהם קוד. **שום דבר כאן לא נבדק באייפון.**

## 1. בסיס: הגדרות הדף

תגית ה-viewport (`public/index.html:6`). היום: `width=device-width, initial-scale=1, viewport-fit=cover`. אחרי השינוי:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="<צבע הכותרת במצב בהיר, מ-tokens.css>">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="<צבע הכותרת במצב כהה, מ-tokens.css>">
```

`maximum-scale=1, user-scalable=no` הוא בקשת יובל (`SKILL.md`, שורה 1), למרות ההמלצה הכללית נגד.

## 2. בסיס: CSS

```css
html {
  -webkit-tap-highlight-color: transparent;  /* בלי הבהוב אפור בלחיצה */
  -webkit-text-size-adjust: 100%;            /* בלי הגדלת גופן אוטומטית בסיבוב */
  overscroll-behavior: none;                 /* הדף כולו לא "קופץ" */
}
body { overscroll-behavior: none; }

.app { height: 100dvh; }                     /* לא 100vh */

.chat-list {                                 /* רשימת ההודעות: הגלילה היחידה */
  overflow-y: auto;
  overscroll-behavior: contain;
}

input, textarea, select { font-size: 16px; } /* מתחת ל-16px האייפון עושה זום לשדה */

button, a, [role="button"], .card, .bubble {
  touch-action: manipulation;                /* בלי זום בלחיצה כפולה ובלי עיכוב */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;               /* בלי תפריט המערכת בלחיצה ארוכה */
}
input, textarea { user-select: text; -webkit-user-select: text; }

button:active, .card:active { transform: scale(.97); transition: transform 100ms ease-out; }

@media (hover: hover) and (pointer: fine) {
  /* כל כללי :hover כאן בלבד, כדי שלא "ייתקעו" אחרי לחיצה באייפון */
}

.top-bar    { padding-top: env(safe-area-inset-top, 0px); }
.bottom-bar { padding-bottom: env(safe-area-inset-bottom, 0px); }
```

**למה לא `user-select: none` על כל `body`:** טקסט שיובל צריך להעתיק נשאר נגיש דרך תפריט הלחיצה הארוכה (סעיף 3). שדות כתיבה חייבים להישאר ניתנים לסימון.

## 3. לחיצה ארוכה על הודעה (סקיצה, לא נבנה)

```js
const HOLD_MS = 500;
let holdTimer = null, startY = 0;

chatList.addEventListener('touchstart', (e) => {
  const bubble = e.target.closest('.bubble');
  if (!bubble) return;
  startY = e.touches[0].clientY;
  holdTimer = setTimeout(() => openBubbleMenu(bubble), HOLD_MS);
}, { passive: true });

chatList.addEventListener('touchmove', (e) => {
  if (Math.abs(e.touches[0].clientY - startY) > 10) clearTimeout(holdTimer); // גלילה מבטלת
}, { passive: true });

chatList.addEventListener('touchend', () => clearTimeout(holdTimer));

function openBubbleMenu(bubble) {
  // שכבה על כל המסך: backdrop-filter: blur(12px)
  // בתוכה עותק של הבועה במרכז, ומתחתיה "העתק" ו"הגב" (44px לפחות)
  // "העתק": navigator.clipboard.writeText(bubble.innerText)
  // "הגב": פותח את תיבת הכתיבה עם ציטוט; איך התגובה נשמרת בשרת — לא הוכרע
  // לחיצה על הרקע סוגרת
}
```

## 4. Service worker (רק אם יוחלט להוסיף)

היום אין `sw.js`, וההתראות עובדות בלעדיו (Declarative Web Push). אם יוחלט להוסיף, בשביל עבודה בלי רשת:

- **בקשות ל-`/api/`:** קודם רשת; אם אין רשת, תשובה שמורה אם יש, אחרת שגיאה ברורה. לא מגישים מהמטמון נתונים ישנים בלי לסמן אותם.
- **קבצים סטטיים** (`index.html`, `tokens.css`, אייקונים): קודם מטמון, ועדכון ברקע.
- **רק בקשות GET.** שליחת הודעה (POST) לא עוברת דרך המטמון.
- **גרסה חדשה:** כשנמצא `sw.js` חדש, מציגים בצ'אט "יש גרסה חדשה" ומרעננים רק בלחיצה. לא מרעננים באמצע כתיבה.
- **שער עצירה:** לבדוק באייפון שההתראות והמספר על האייקון ממשיכים לעבוד אחרי ההוספה.

## 5. מה לא רלוונטי לאייפון (ידע כללי, לא אומת בסשן הזה מול תיעוד Apple)

- `beforeinstallprompt` (חלון התקנה): לא קיים באייפון. ההתקנה ידנית: שיתוף ← "הוסף למסך הבית".
- Background Sync: לא נתמך באייפון.
- `navigator.vibrate` (רטט): לא נתמך באייפון.

## 6. בדיקה

כל סעיף כאן נחשב עובד רק אחרי בדיקה באייפון אמיתי, כשהאפליקציה מותקנת על מסך הבית (`phone-checklist`). דמיית דפדפן במחשב לא מראה זום, סימון, קפיצה או אזורים בטוחים כמו באייפון.

</div>
