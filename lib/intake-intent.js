// שכבת הכוונה (שלב 8.2, קוד בלבד): הצעד הראשון בבלוק 1, לפני המילון. מקור: docs/02-rules/03-intake-rules.md:112-155 ("שכבת הכוונה")
// ו-178-188 ("הפרדה בין משימה של יובל למידע שהועבר"). פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל.
//
// שלוש תוצאות: 'write' (כתיבה) · 'read' (קריאה) · 'info' (מידע, ממשיך למפל הקיים).
// סדר ההכרעה (03-intake-rules.md:140-148):
//   1. שורש כתיבה -> write
//   2. מילת שאלה או סימן שאלה, בלי שורש כתיבה -> read
//   3. שניהם יחד -> write (במסלול האישור המלא; כאן רק התוצאה 'write')
//   4. אף אחד -> info
//   5. פועל דו-משמעי (תבדוק, תראה) -> read
// אי-סימטריה בבטיחות: שאלה שטופלה כפקודה כותבת ליומן; פקודה שטופלה כשאלה לא עושה כלום. לכן במקרה ספק הולכים ל-read.
//
// חשוב: שכבת הכוונה חלה על מה שיובל כותב בצ'אט. הודעה מהקיצור עוברת קודם חילוץ (03-intake-rules.md:120,157-174),
// ולכן הסוכן שמחבר את הצינור לא אמור להפעיל detectIntent על ערוץ 'shortcut'. [הנחה, לא אומת: הפונקציה לא יודעת את הערוץ ולא בודקת אותו.]
import { tokenize, matchesRoot, matchesInfinitive, fin } from './intake-text.js';

// שורשי כתיבה: 03-intake-rules.md:126-133 (יוצר · מזכיר · מזיז · מבטל · סוגר). פעלי המשימה אינם שורשי כתיבה (שם: "פעלי משימה", לטבלת channelRole).
export const WRITE_ROOTS = Object.freeze([
  'קבע', 'הוסף', 'רשום', 'הכניס', 'פתח',
  'זכר',
  'הזיז', 'העביר', 'דחה', 'הקדים', 'שינה', 'עדכן',
  'ביטל', 'מחק', 'הסיר',
  'סיים', 'ביצע',
]);

// שורשי הצגה (03-intake-rules.md:138) ופעלים דו-משמעיים שנופלים לקריאה (חוק 5, 03-intake-rules.md:146).
export const SHOW_ROOTS = Object.freeze(['אמר', 'ראה', 'הציג', 'סיכם', 'חיפש']);
// [הנחה, לא אומת] "הגיד" (תגיד לי) אינו בטבלה. נוסף כצורה השיחתית של "אמר", בכיוון הבטוח (קריאה).
export const AMBIGUOUS_READ_ROOTS = Object.freeze(['בדק', 'הגיד']);

// מילות שאלה: 03-intake-rules.md:137. [הנחה, לא אומת] "איזו" נוסף כנקבה של "איזה". ו' מחברת ("ומתי") מותרת. מילים נוספות שלא בטבלה (איך, מדוע, לאן) לא נוספו.
const QUESTION_WORD = new RegExp(`^ו?(?:${['מה', 'מתי', 'איפה', 'איזה', 'איזו', 'כמה', 'האם', 'מי', 'למה'].map(fin).join('|')})$`); // האם = האמ אחרי נרמול סופיות

// פעלי המשימה (שם פועל), 03-intake-rules.md:133. הסדר כאן כמו בטבלה.
export const TASK_VERB_ROOTS = Object.freeze(['לקח', 'הכין', 'הביא', 'קנה', 'שים', 'הזמין', 'כתב', 'שלח', 'הוציא', 'רענן', 'הלך']);

const rootsOf = (list, w) => list.filter((root) => matchesRoot(root, w));

// "לשאול את <מישהו>" = משימה ולא שאילתה (03-intake-rules.md:152). מחזיר true אם יש "לשאול" ואחריו "את".
const hasAskTask = (words) => words.some((w, i) => matchesInfinitive('שאל', w) && words[i + 1] === 'את');

// האותות שזוהו בטקסט. נחשף לבדיקות ולסוכן החיבור (כדי להסביר למה הוכרעה כוונה).
export function intentSignals(text) {
  const { clean, tokens } = tokenize(text);
  const words = tokens.map((token) => token.w);
  const write = [...new Set(words.flatMap((w) => rootsOf(WRITE_ROOTS, w)))];
  const show = [...new Set(words.flatMap((w) => rootsOf(SHOW_ROOTS, w)))];
  const ambiguousRead = [...new Set(words.flatMap((w) => rootsOf(AMBIGUOUS_READ_ROOTS, w)))];
  const questionWords = words.filter((w) => QUESTION_WORD.test(w));
  // [הנחה, לא אומת] 03-intake-rules.md:137 כותב "סימן שאלה בסוף". כאן כל סימן שאלה בטקסט נחשב (ספק הולך לקריאה, אי-הסימטריה למעלה).
  const questionMark = clean.includes('?');
  return { write, show, ambiguousRead, questionWords, questionMark, askTask: hasAskTask(words) };
}

export function detectIntent(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'info';
  const signals = intentSignals(text);
  if (signals.write.length > 0) return 'write'; // חוק 1 וחוק 3 (גם עם מילת שאלה)
  if (signals.askTask) return 'info'; // "לשאול את דן מתי הוא בא" = משימה של יובל, לא שאילתה. הסיווג כמשימה הוא ב-channelRole.
  const readSignal = signals.questionWords.length > 0 || signals.questionMark || signals.show.length > 0 || signals.ambiguousRead.length > 0;
  return readSignal ? 'read' : 'info'; // חוק 2 + 5 מול חוק 4
}

// הפרדה בין משימה של יובל (task) למידע שהועבר (info), 03-intake-rules.md:178-188 (הוכרע 20.9.2026):
//   1. הגיע דרך קיצור השיתוף -> info (גם עם שאלה בתוכו)
//   2. הוקלד בצ'אט והפועל המשימתי הוא המילה הראשונה -> task
//   3. הוקלד בצ'אט והפועל באמצע -> info
// הדבקה בצ'אט נחשבת "הוקלד" (03-intake-rules.md:188).
// [הנחה, לא אומת] ערוץ שאינו 'shortcut' ואינו 'app' (calendar, system, file בטבלת sources) אינו הקלדה, ולכן info.
// [הנחה, לא אומת] "לשאול את <מישהו>" (ההתנגשות המסומנת ב-03-intake-rules.md:152) נחשב משימה גם אם "לשאול" אינו בטבלת פעלי המשימה.
export function channelRole({ channel, text } = {}) {
  if (channel !== 'app') return 'info';
  if (typeof text !== 'string') return 'info';
  const { tokens } = tokenize(text);
  if (tokens.length === 0) return 'info';
  const [first, second] = tokens.map((token) => token.w);
  if (TASK_VERB_ROOTS.some((root) => matchesInfinitive(root, first))) return 'task';
  if (matchesInfinitive('שאל', first) && second === 'את') return 'task';
  return 'info';
}
