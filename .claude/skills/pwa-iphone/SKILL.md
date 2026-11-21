---
name: pwa-iphone
description: איך לגרום לאפליקציית הווב של מערכת היומן להרגיש כמו אפליקציה רגילה באייפון ולא כמו אתר. בלי זום, בלי סימון של המסך, לחיצה ארוכה על הודעה עם רקע מטושטש ו"העתק"/"הגב", אזורי מגע, אזורים בטוחים (safe area), עבודה בלי רשת ועדכון גרסה. השתמש כשבונים או מתקנים את `public/index.html`, `public/manifest.json` או `public/tokens.css`, וכשיובל אומר "זה נראה כמו אתר", "זום", "מסמן לי את המסך", "לחיצה ארוכה", "כמו בוואטסאפ", "PWA", "service worker", "offline". לא לשימוש לבדיקה ידנית באייפון (phone-checklist) ולא לקוד שרת ב-api/.
---

<div dir="rtl">

# pwa-iphone — אפליקציה, לא אתר

**מקור:** נבנה ב-21.11.2026 לבקשת יובל, מחלקים של שלושה סקילים ציבוריים (רישיון MIT), שהועתקו אחד-לאחד ל-`references/` יחד עם הרישיונות:
- `pwa-expert` ו-`mobile-ux-optimizer` מהריפו `curiositech/some_claude_skills`, קומיט `d47e2e5`.
- `mobile-native` מהריפו `emilkowalski/skills`, קומיט `64eb3de` (`references/mobile-native-original.md`). **זה המקור העיקרי לתחושת "אפליקציה ולא אתר"**: טבלת סימפטומים, תיקון לכל אחד, ורשימת "Never Ship".

מה שכתוב כאן מעליהם: ההתאמה לפרויקט, וההכרעות במקום שבו המקורות סותרים את מה שיובל ביקש.

## ההקשר של הפרויקט (נקרא בריפו 21.11.2026)

- האפליקציה היא **דף HTML אחד**: `public/index.html`, עם `public/tokens.css` ו-`public/manifest.json`. **אין React ואין Next.js**, ולא עוברים אליהם (`docs/01-foundation/אפיון-מורחב.md`, החלטה ה-4). הדוגמאות ב-`references/` כתובות ב-React: לוקחים את הרעיון וכותבים ב-JavaScript רגיל.
- **אין `sw.js` בריפו.** ההתראות נשלחות ב-Declarative Web Push (`docs/01-foundation/01-system-overview.md`, "אינטגרציות"). **לא מוסיפים service worker בלי תוכנית מאושרת ובדיקה שהוא לא שובר את ההתראות והמספר על האייקון**, שהוכחו באייפון (`docs/08-chapter8/35-chapter8-plan.md`, 8.2א-3ב).
- המכשיר: אייפון 16 פרו מקס, iOS 26, האפליקציה מותקנת על מסך הבית (`CLAUDE.md`).
- עיצוב: טוקנים קיימים בלבד, אזורי מגע 44px (`.claude/agents/designer.md`; `docs/02-rules/03-design-rules.md`).

## דרישות "מרגיש כמו אפליקציה" (`אפיון-מורחב.md`, ח-3 וח-4)

| # | דרישה | כיוון טכני | אומת באייפון? |
|---|---|---|---|
| 1 | אין זום בצביטה | בתגית ה-viewport ב-`public/index.html:6` להוסיף `maximum-scale=1, user-scalable=no`. **סותר את `mobile-native` (Hard Rule 4: "Never disable zoom", בגלל נגישות).** הוכרע לפי בקשת יובל (21.11.2026), כי האפליקציה היא לשימוש שלו בלבד. יובל יכול לבטל | **לא.** לא ידוע אם האייפון מכבד את זה באפליקציה על מסך הבית. לבדוק |
| 2 | אין זום בלחיצה כפולה, ואין עיכוב בלחיצה | `touch-action: manipulation` על כפתורים וקישורים (`mobile-native`, §5) | לא |
| 3 | אין זום כשנכנסים לשדה כתיבה | גודל גופן בשדות קלט 16px לפחות (`mobile-native`, §4: "iOS Safari zooms the page when focus lands on an input whose font size is under 16px") | לא |
| 4 | אין סימון של המסך בלחיצה | `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none` **על כפתורים, כרטיסים ובועות הודעה, לא על כל הדף** (`mobile-native`, §8: "Never put `user-select: none` on `body`"). העתקת הודעה עוברת דרך תפריט הלחיצה הארוכה (ח-4). **שדות כתיבה נשארים ניתנים לסימון** | לא |
| 5 | אין הבהוב אפור בלחיצה | `-webkit-tap-highlight-color: transparent` על `html`, ולכל כפתור מצב `:active` משלו (`mobile-native`, §2, §5) | לא |
| 6 | אין "קפיצה" של כל הדף בגלילה | `overscroll-behavior: none` על `html, body`; `overscroll-behavior: contain` על רשימת ההודעות (`mobile-native`, §6) | לא |
| 7 | גובה מסך נכון | `100dvh` במקום `100vh`; `env(safe-area-inset-*, 0px)` לאזורים הבטוחים (`mobile-native`, §3, §7). `viewport-fit=cover` כבר קיים | חלקי: `viewport-fit=cover` קיים |
| 8 | אזורי מגע | 44×44 לפחות (`references/mobile-ux-optimizer-original.md`, "The 44px Rule"; כלל קיים אצל המעצב) | קיים כבר ככלל |
| 9 | אין מצב "ריחוף" שנתקע אחרי לחיצה | כל כלל `:hover` בתוך `@media (hover: hover) and (pointer: fine)` (`mobile-native`, §1) | לא |
| 10 | צבע פס הסטטוס תואם למצב בהיר וכהה | `theme-color` נפרד לכל `prefers-color-scheme` (`mobile-native`, §10) | לא |

**נקודת פתיחה מומלצת:** סעיף "Baseline" ב-`references/mobile-native-original.md`, בתוספת שורה 1 (חסימת זום) ושורה 4 (בועות הודעה).

## לחיצה ארוכה על הודעה (ח-4)

**מה יובל ביקש:** כמו בוואטסאפ באייפון. לחיצה ארוכה ← ההודעה קופצת למרכז, הרקע מטושטש, וכפתורים "העתק" ו"הגב".

כיוון טכני (החלטה של Claude, לא נבנה):
- טיימר על `touchstart` (כ-500ms); מבטלים אותו ב-`touchmove` או `touchend`, כדי שגלילה לא תפתח תפריט.
- שכבה על כל המסך עם `backdrop-filter: blur(...)`. בתוכה עותק של ההודעה במרכז, ומתחתיה הכפתורים.
- "העתק": `navigator.clipboard.writeText`. "הגב": פותח את תיבת הכתיבה עם ציטוט ההודעה.
- **"הגב" דורש החלטה בשרת:** איך תגובה נשמרת ומקושרת להודעה. לא ב-`public/` בלבד.
- סגירה: לחיצה על הרקע.
- **לא אומת:** רטט בלחיצה ארוכה. לפי הידע שלי `navigator.vibrate` לא נתמך באייפון, ולא בדקתי את זה בסשן הזה.

## מה לקחת מ-`references/` ומה לא

| קובץ | לקחת | לא לקחת |
|---|---|---|
| `mobile-native-original.md` | כמעט הכול: טבלת הסימפטומים, Baseline, Never Ship | "Never disable zoom" (הוכרע אחרת, שורה 1). דוגמאות Next.js ו-Tailwind |
| `pwa-expert-original.md` | קובץ ה-manifest, מצבי תצוגה, טבלת אסטרטגיות מטמון, צ'קליסט | `beforeinstallprompt` ו-Background Sync: לפי הידע שלי לא נתמכים באייפון (לא אומת בסשן הזה). כל מה שקשור ל-Next.js |
| `service-worker-patterns.md` | אם יוחלט להוסיף service worker: network-first ל-`/api/`, cache-first לקבצים סטטיים | — |
| `update-flow.md` | הרעיון של "יש גרסה חדשה" | הקוד ב-React |
| `offline-handling.md` | הודעה כשאין רשת | הקוד ב-React |
| `gestures.md` | רעיון הסף (threshold) והכיוון העיקרי בהחלקה | הקוד ב-React |
| `mobile-ux-optimizer-original.md` | dvh, safe area, 44px, טבלת Quick Reference | Tailwind, ניווט תחתון, Next.js |

## שערי עצירה

- **שינוי ב-`public/index.html` הוא שינוי עיצוב:** לפי `35`, סעיף 14 ("לשאול קודם"), דורש "כן" של יובל לפני בנייה.
- **כל דרישה בטבלה מסומנת "אומת" רק אחרי בדיקה באייפון אמיתי** (`phone-checklist`). דמיית דפדפן לא מספיקה.
- **service worker חדש:** רק בתוכנית מאושרת (ראו "ההקשר של הפרויקט").

</div>
