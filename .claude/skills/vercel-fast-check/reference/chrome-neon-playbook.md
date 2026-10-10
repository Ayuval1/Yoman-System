<div dir="rtl">

# מסלול Neon דרך Chrome: שאילתת SELECT בכ-7 קריאות

> נוצר ב-10.10.2026 מהרצה אמיתית (שתי שאילתות על `sources`). הרצה זו נעשתה בדרך ארוכה יותר, עם גילוי הנתיב; כאן הדרך המקוצרת. **שלב 1 (ניווט ישיר) לא נוסה בנוסח הזה**, שאר השלבים כן. אם משהו מתפצל מהמסלול, ההרצה האחרונה מנצחת, ומעדכנים כאן.
> הרשאה: יובל מאשר SELECT על הפרויקט בכל סשן. בלי אישור בסשן, שואלים.

## הכנה
- טוענים את כלי Chrome: `tabs_context_mcp`, `navigate`, `computer`, `find`, `get_page_text`, `tabs_close_mcp`, וגם `browser_batch`. הסיבה: בסשן הקודם לא נטען `browser_batch` וכל פעולה רצה לבד.
- **פעולות שתלויות זו בזו** (פוקוס ואז הקלדה ואז Run) מריצים אחת בכל פעם ובודקים. פעולות עצמאיות (המתנה, צילום) אפשר יחד. הסיבה: בסשן 10.10 הקלדה רצה בלי פוקוס אחרי שחסימה עצרה את הלחיצה (`24-working-with-yuval.md`).

## המסלול

| # | פעולה | מה לוודא |
|---|---|---|
| 1 | `tabs_context_mcp` עם `createIfEmpty`, ואז `navigate` לקישור הישיר לעורך (למטה) | הכותרת "Query – neon-orange-anchor". אם נפתח עורך נתונים או דף ריק, ממתינים 3 שניות (הדף נטען עם שלדים אפורים) |
| 2 | צילום מסך קטן | מתג **Read-only** דלוק (כחול). אם כבוי, עוצרים ולא ממשיכים |
| 3 | לחיצה באמצע אזור העורך | |
| 4 | `ctrl+a` | |
| 5 | `type` של **פקודה אחת** בשורה אחת | צילום: השאילתה בשורה אחת, הטקסט הישן נעלם |
| 6 | לחיצה על **Run** | `find` על "Run" עדיף על קואורדינטות. בהרצה: (1455, 75) בחלון ברוחב 1568, כלומר תלוי בגודל החלון. מוצג על הכפתור גם `Ctrl+Enter`, לא נוסה |
| 7 | המתנה 3 שניות, ו-`zoom` על אזור הטבלה | **שמות העמודות תואמים לשאילתה האחרונה.** אחרי שאילתה שנייה הטבלה הישנה נשארת עד Run |
| 8 | `tabs_close_mcp` | |

**קישור ישיר לעורך** (נצפה בלשונית בהרצה; מזהי חשבון, לא סודות):
`https://vercel.com/yuval-amars-projects/yoman-system/integrations/neon/icfg_vFBDxKJVJmI11gZs4OoewHCU/resources/storage/store_vD2YGYvK5bTxtwo2/query`

**הדרך הארוכה, אם הקישור לא עובד:** `https://vercel.com/yuval-amars-projects/yoman-system/stores`, ואז "Browse data" (נפתח עורך נתונים), ואז "Query" בצד.

## שאילתות מטא-דאטה מאומתות (בלי תוכן הודעות)

```sql
SELECT channel, received_at, length(raw_content) AS len, (processed_at IS NOT NULL) AS processed FROM sources WHERE received_at > now() - interval '90 minutes' ORDER BY received_at DESC LIMIT 10;
```
```sql
SELECT length(raw_content) - length(replace(raw_content, chr(10), '')) AS newlines, length(raw_content) AS len FROM sources WHERE received_at > now() - interval '90 minutes' ORDER BY received_at DESC LIMIT 10;
```
**אומת 10.10.2026:** הראשונה החזירה שורה אחת (`shortcut`, 18:31:06 UTC, 56 תווים). השנייה: 4 ירידות שורה. שתי הודעות שנשלחו יחד נקלטו כשורה אחת.

## מה לא נבדק
- קריאת התוצאה עם `get_page_text` או `read_page` במקום צילום. ב-`ops-commands.md` כתוב שתוצאת שאילתה מופיעה בצילום ולא תמיד בטקסט הדף.
- ניווט ישיר לקישור `/query` ללא המעבר דרך עורך הנתונים.

## פרטיות
מציגים ליובל ספירות, אורכים וזמנים. תוכן ההודעה לא מועתק, ושמות וטלפונים לעולם לא.

</div>
