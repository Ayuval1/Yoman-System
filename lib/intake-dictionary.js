// מילון המילים המפעילות (שלב 8.2, קוד בלבד): מסווג הודעה לאחד משישה סוגים לפי שורשים ולא לפי מחרוזות.
// מקור: docs/02-rules/03-intake-rules.md:224-254 ("המילון עובר להתאמת שורשים" + טבלת המילים המפעילות). פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל.
// הנתונים (רשימות השורשים והמקצועות) כתובים כקבועים כאן ובקובץ lib/intake-text.js, ולא בקובץ חיצוני, כדי שייכנסו לפריסה.
//
// סוגים: homework (שיעורי בית) · cancel (ביטול) · move (הזזה) · exam (מבחן) · room (חדר) · short_day (יום מקוצר).
// הודעה שלא נתפסה = null. היא לא נזרקת: עוברת הלאה כ"לא מסווג" (03-intake-rules.md:254).
//
// [הנחה, לא אומת] כל כללי ההכרעה שבהמשך (סדר עדיפות בין סוגים, טריגרים "חלשים" שדורשים מקצוע) הם של Claude: המסמך קובע מילים מפעילות
// ולא מה גובר כשכמה סוגים מופיעים יחד. הסדר נבחר בכיוון שמגן מרעש ושקל להפוך; אימות המילון על מדגם מתויג הוא שלב 8.8.
//
// זהירות: tokenize מנרמל אותיות סופיות (אין = אינ, יום = יומ, מבחן = מבחנ). כל השוואה למילה עברית עם ך/ם/ן/ף/ץ חייבת לעבור דרך fin() / plainRegex / nounRegex.
import { tokenize, matchesRoot, nounRegex, plainRegex, fin, unfin, isNumberWord } from './intake-text.js';

export const TYPES = Object.freeze(['homework', 'cancel', 'move', 'exam', 'room', 'short_day']);

// --- מקצועות ---
// מקור: data/school-subjects-teachers.md ו-data/school-timetable-taf-shin-pe-zayin.md. השם הראשון הוא השם הקנוני (כמו במערכת השעות).
// כל רצף הוא רשימת מילים רצופות; הראשונה מקבלת קידומות (במתמטיקה, לאנגלית).
// [הנחה, לא אומת] כינויים שאינם בקבצים (חנ"ג = חינוך גופני בקובץ המורים; "שיחה אישית" = "שיח אישי" במערכת השעות) הוכרו לפי שני הקבצים.
const SUBJECT_DEFS = [
  ['שיח אישי', [['שיח', 'אישי'], ['שיחה', 'אישית']]],
  ['היסטוריה', [['היסטוריה'], ['הסטוריה']]],
  ['עברית', [['עברית']]],
  ['תנ"ך', [['תנך']]],
  ['אנגלית', [['אנגלית']]],
  ['מתמטיקה', [['מתמטיקה']]],
  ['ספרות', [['ספרות']]],
  ['מדעי המחשב', [['מדעי', 'ה?מחשב']]],
  ['פיזיקה', [['פיזיקה']]],
  ['אזרחות', [['אזרחות']]],
  ['כישורי חיים', [['כישורי', 'חיים']]],
  ['חנ"ג', [['חנג'], ['חינוך', 'גופני']]],
  ['ערבית', [['ערבית']]],
  ['כימיה', [['כימיה']]],
  ['גיאומטריה', [['גיאומטריה'], ['גאומטריה']]],
  ['תחומי בחירה', [['תחומי', 'בחירה']]],
  ['חינוך פיננסי', [['חינוך', 'פיננסי']]],
  ['מדעים', [['מדעים']]],
];
export const SUBJECT_NAMES = Object.freeze(SUBJECT_DEFS.map(([name]) => name));
const SUBJECTS = SUBJECT_DEFS.map(([name, sequences]) => ({
  name,
  sequences: sequences.map((sequence) => sequence.map((body, k) => (k === 0 ? nounRegex(body) : plainRegex(body)))),
}));

// מקצועות שמופיעים במילים (words = מילים מנורמלות), לפי הסדר בטקסט. הארוך גובר ("מדעי המחשב" ולא "מדעי").
export function findSubjectsInWords(words) {
  const found = [];
  for (let i = 0; i < words.length;) {
    let hit = null;
    for (const def of SUBJECTS) {
      for (const sequence of def.sequences) {
        const matches = sequence.every((re, k) => i + k < words.length && re.test(words[i + k]));
        if (matches && (!hit || sequence.length > hit.len)) hit = { subject: def.name, index: i, len: sequence.length };
      }
    }
    if (hit) {
      found.push(hit);
      i += hit.len;
    } else {
      i += 1;
    }
  }
  return found;
}

export function findSubjects(text) {
  return findSubjectsInWords(tokenize(text).tokens.map((token) => token.w));
}

// --- חדרים ---
const ROOM_NUMBER_WORD = /^(?:מספר|מס)$/;
const HALL_OR_LAB = new RegExp(`^(?:וכש|וש|כש|ו|ש)?([בל])(מעבדה|${fin('אולם')})$`);
const ROOM_NOUN = [nounRegex('חדר'), nounRegex('כיתה')];
const DIRECTION_PREFIX = { to: /^(?:וכש|וש|כש|ו|ש)?ל/, from: /^(?:וכש|וש|כש|ו|ש)?מ/ };
const directionOf = (w) => (DIRECTION_PREFIX.to.test(w) ? 'to' : DIRECTION_PREFIX.from.test(w) ? 'from' : null);

// אזכורי חדר בטקסט: "חדר 124" / "כיתה 124" (שם עצם + מספר; "חדר אומנות" ו"בכיתה" לבד אינם חדר) ו"במעבדה" / "באולם".
// value: מספר החדר כטקסט, או "מעבדה" / "אולם". dir: 'to' כשהמילה בקידומת ל' ("לחדר 124"), 'from' בקידומת מ', אחרת null.
export function findRoomsInWords(words) {
  const rooms = [];
  for (let i = 0; i < words.length; i += 1) {
    if (ROOM_NOUN.some((re) => re.test(words[i]))) {
      let j = i + 1;
      if (ROOM_NUMBER_WORD.test(words[j] ?? '')) j += 1;
      if (isNumberWord(words[j]) && words[j].length <= 4) rooms.push({ value: words[j], index: i, len: j - i + 1, dir: directionOf(words[i]) });
      continue;
    }
    const place = HALL_OR_LAB.exec(words[i]);
    if (place) rooms.push({ value: place[2] === 'מעבדה' ? 'מעבדה' : 'אולם', index: i, len: 1, dir: place[1] === 'ל' ? 'to' : null });
  }
  return rooms;
}

export function findRooms(text) {
  return findRoomsInWords(tokenize(text).tokens.map((token) => token.w));
}

// --- זמן ---
const isHour = (w) => isNumberWord(w) && Number(w) >= 0 && Number(w) <= 24;
const HOUR_WORD = /^(?:ב)?שעה$/;
// סימן שעה בהודעה: HH:MM, או "בשעה N". ("ב-12" בלי נקודתיים נבדק רק ליד פועל שחרור/סיום, ראה hourAfter).
function hasTimeMarker(words) {
  return words.some((w, i) => /^\d{1,2}:\d{2}$/.test(w) || (HOUR_WORD.test(w) && isHour(words[i + 1] ?? '')));
}
// "משוחררים ב-12" / "סיום בשעה 12": שעה מיד אחרי הפועל.
const hourAfter = (words, i) => (words[i + 1] === 'ב' && isHour(words[i + 2] ?? '')) || (HOUR_WORD.test(words[i + 1] ?? '') && isHour(words[i + 2] ?? ''));
// האם יש בהודעה מידע על זמן (תאריך, שעה, יום, שבוע). משמש רק להבחנת "עבר לחדר 124" (חדר) מ"עבר ליום שלישי" (הזזה).
const TEMPORAL_WORD = new RegExp(`^(?:וכש|וש|כש|ו|ש)?(?:ב|ל|מ)?(?:${['שבוע', 'מחר', 'מחרתיים', 'היום', 'יום', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(fin).join('|')})$`);
const hasTemporal = (words) => words.some((w) => /^\d{1,2}:\d{2}$/.test(w) || /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?$/.test(w) || TEMPORAL_WORD.test(w));

// --- טריגרים ---
// טריגר: { type, root, weak, test(ctx, i) -> מספר מילים שנצרכו (0 = אין התאמה) }. type יכול להיות פונקציה (ctx, i) -> סוג או null.
const trigger = (type, root, test, { weak = false } = {}) => ({ type, root, test, weak });
const single = (re) => (ctx, i) => (re.test(ctx.words[i]) ? 1 : 0);
const verb = (root) => (ctx, i) => (matchesRoot(root, ctx.words[i]) ? 1 : 0);
const sequence = (...res) => (ctx, i) => (res.every((re, k) => i + k < ctx.words.length && re.test(ctx.words[i + k])) ? res.length : 0);

// "לא יהיה" / "לא היה" (cancel) וגם "לא יתקיימו" (הדוגמה ב-03-intake-rules.md:226). עתיד: תמיד. עבר: לא לפני "ל<כינוי>" ("לא היה לי זמן" אינו ביטול).
// [הנחה, לא אומת] הסייג על "ל<כינוי>" הוא של Claude, כדי להוריד רעש; "לא יהיה לכם שיעור" (עתיד) כן נתפס.
const NOT = /^ו?לא$/;
const FUTURE_BE = plainRegex('יהיה|יהיו|תהיה|תהיו|תהיינה|יתקיים|יתקיימו|תתקיים|תתקיימו|תתקיימנה');
const PAST_BE = plainRegex('היה|היו|הייתה|התקיים|התקיימו|התקיימה');
const DATIVE = plainRegex('ל(?:י|ך|ו|ה|נו|כם|כן|הם|הן)');
function notBe(ctx, i) {
  const { words } = ctx;
  if (!NOT.test(words[i]) || i + 1 >= words.length) return 0;
  if (FUTURE_BE.test(words[i + 1])) return 2;
  if (PAST_BE.test(words[i + 1]) && !DATIVE.test(words[i + 2] ?? '')) return 2;
  return 0;
}
// "אין [מקצוע]": "אין מתמטיקה מחר".
const NO = plainRegex('אין');
const noSubject = (ctx, i) => (NO.test(ctx.words[i]) && ctx.subjectStarts.has(i + 1) ? 2 : 0);

// "עבר ל<משהו>" (move). "עבר" לבד ("עבר את המבחן") אינו הזזה.
const movedTo = (ctx, i) => (/^ו?עבר$/.test(ctx.words[i]) && /^ל/.test(ctx.words[i + 1] ?? '') ? 2 : 0);
// "יתקיים ביום" (move חלש): "השיעור יתקיים ביום שלישי".
const TAKES_PLACE = plainRegex('(?:ו|ש)?(?:י|ת)תקיים(?:ו|נה)?');
const DAY_WORD = new RegExp(`^(?:ב|ל)?${fin('יום')}$`);
const takesPlaceOnDay = (ctx, i) => (TAKES_PLACE.test(ctx.words[i]) && DAY_WORD.test(ctx.words[i + 1] ?? '') ? 2 : 0);

// "מועד ב" (לא "מועד ב-12:00" או "מועד ב-5": ב' שאחריה ספרה היא קידומת).
const SITTING = nounRegex('מועד');
const secondSitting = (ctx, i) => (SITTING.test(ctx.words[i]) && ctx.words[i + 1] === 'ב' && !/^\d/.test(ctx.words[i + 2] ?? '') ? 2 : 0);

// חדר: "חדר 124", "כיתה 124", "במעבדה", "באולם".
const roomMention = (ctx, i) => findRoomsInWords(ctx.words.slice(i, i + 3)).find((room) => room.index === 0)?.len ?? 0;

// יום מקוצר: "יום מקוצר", "יום לימודים מקוצר", "ימים מקוצרים".
const SHORT = plainRegex('מקוצר(?:ים|ת)?');
const SCHOOL_DAYS = plainRegex('לימודים');
const DAY_NOUN = nounRegex('יום|ימים');
const shortDay = (ctx, i) => {
  if (!DAY_NOUN.test(ctx.words[i])) return 0;
  if (SHORT.test(ctx.words[i + 1] ?? '')) return 2;
  if (SCHOOL_DAYS.test(ctx.words[i + 1] ?? '') && SHORT.test(ctx.words[i + 2] ?? '')) return 3;
  return 0;
};

const NOTEBOOK = new RegExp(`^(?:וכש|וש|כש|ו|ש)?[לב]ה?(?:${fin('מחברת|מחברות')})$`);
const END_NOUN = nounRegex('סיום');
const endOrEnding = (ctx, i) => (matchesRoot('סיים', ctx.words[i]) || END_NOUN.test(ctx.words[i]) ? 1 : 0);
const releaseType = (ctx, i) => (ctx.hasTime || hourAfter(ctx.words, i) ? 'short_day' : 'cancel');
const endType = (ctx, i) => (ctx.hasTime || hourAfter(ctx.words, i) ? 'short_day' : null);

const TRIGGERS = [
  // שיעורי בית. חזקים: מילים שלא מופיעות בהודעות רעש. חלשים (להביא, להכין): נספרים רק אם הוזכר מקצוע (03-intake-rules.md:231, "להביא 15 שקלים לחולצה").
  trigger('homework', 'שיעורי בית', sequence(nounRegex('שיעורי'), plainRegex('ה?בית'))),
  trigger('homework', 'דף עבודה', sequence(nounRegex('דף|דפי'), plainRegex('עבודה|עבודות'))),
  trigger('homework', 'פתר', verb('פתר')),
  trigger('homework', 'תרגיל', single(nounRegex('תרגיל(?:ים|י)?'))),
  // [הנחה, לא אומת] הטבלה כותבת "למחברת"; ב-ל' ו-ב' נתפסים שניהם (שורש). לא נמדד.
  trigger('homework', 'מחברת', single(NOTEBOOK)),
  trigger('homework', 'הביא', verb('הביא'), { weak: true }),
  trigger('homework', 'הכין', verb('הכין'), { weak: true }),

  // ביטול
  trigger('cancel', 'ביטל', verb('ביטל')),
  trigger('cancel', 'ביטול', single(nounRegex('ביטול(?:ים)?'))),
  trigger('cancel', 'לא יהיה', notBe),
  trigger('cancel', 'אין מקצוע', noSubject),
  // שחרור: עם שעה = יום מקוצר ("משתחררת בשעה 13:25"), בלי שעה = ביטול ("משוחררים משיעור 6"). 03-intake-rules.md:248,252.
  trigger(releaseType, 'שחרר', verb('שחרר')),

  // הזזה. חזקים: פעלים שאומרים שמשהו זז. חלש: "יתקיים ביום" (יכול להיות גם הודעה ראשונית על מבחן).
  trigger('move', 'דחה', verb('דחה')),
  trigger('move', 'הקדים', verb('הקדים')),
  trigger('move', 'העביר', verb('העביר')),
  trigger('move', 'עבר ל', movedTo),
  trigger('move', 'יתקיים ביום', takesPlaceOnDay, { weak: true }),

  // מבחן
  trigger('exam', 'מבחן', single(nounRegex('מבחן|מבחנים|מבחני'))),
  trigger('exam', 'בוחן', single(nounRegex('בוחן|בוחנים|בוחני'))),
  trigger('exam', 'מתכונת', single(nounRegex('מתכונת|מתכונות'))),
  trigger('exam', 'מועד ב', secondSitting),

  // חדר
  trigger('room', 'חדר', roomMention),

  // יום מקוצר. "סיום ב[שעה]" ו"מסיימים ב[שעה]": רק עם שעה, אחרת "סיים" אינו יום מקוצר.
  trigger('short_day', 'יום מקוצר', shortDay),
  trigger(endType, 'סיום', endOrEnding),
];

// עדיפות בין סוגים כשכמה מופיעים יחד (הנחה, לא אומת, ראה למעלה): short_day > cancel > move (חזק) > exam > homework > move (חלש) > room.
// למשל "המבחן נדחה ליום שלישי" = move (מה שהשתנה), "הבוחן בוטל" = cancel, "מבחן בחדר 124" = exam (החדר הוא פרט).
function resolveType(matches, subjectCount) {
  const has = (type, predicate = () => true) => matches.some((m) => m.type === type && predicate(m));
  const countedHomework = (m) => !m.weak || subjectCount > 0; // טריגר חלש בלי מקצוע = רעש
  if (has('short_day')) return 'short_day';
  if (has('cancel')) return 'cancel';
  if (has('move', (m) => !m.weak)) return 'move';
  if (has('exam')) return 'exam';
  if (has('homework', countedHomework)) return 'homework';
  if (has('move')) return 'move';
  if (has('room')) return 'room';
  return null;
}

function buildContext(words) {
  const subjects = findSubjectsInWords(words);
  return { words, subjects, subjectStarts: new Set(subjects.map((s) => s.index)), hasTime: hasTimeMarker(words) };
}

function collectMatches(ctx) {
  const matches = [];
  for (let i = 0; i < ctx.words.length; i += 1) {
    for (const t of TRIGGERS) {
      const length = t.test(ctx, i);
      if (!length) continue;
      const type = typeof t.type === 'function' ? t.type(ctx, i) : t.type;
      if (type) matches.push({ type, root: t.root, weak: t.weak, index: i, length });
    }
  }
  return matches;
}

// מחזיר { type, roots, matchedTypes } או null. matchedTypes: כל הסוגים שנמצאו להם טריגרים (למי שרוצה לדעת על עמימות), כשורשים לכל סוג.
export function classifyAll(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const ctx = buildContext(tokenize(text).tokens.map((token) => token.w));
  const matches = collectMatches(ctx);
  let type = resolveType(matches, ctx.subjects.length);
  if (type === null) return null;
  // "עבר/הועבר לחדר 124" בלי שום מועד חדש = שינוי חדר, לא הזזה בזמן.
  if (type === 'move' && matches.some((m) => m.type === 'room') && !hasTemporal(ctx.words)) type = 'room';

  const counted = (m) => m.type !== 'homework' || !m.weak || ctx.subjects.length > 0;
  const rootsOf = (wanted) => [...new Set(matches.filter((m) => m.type === wanted && (wanted !== type || counted(m))).map((m) => m.root))];
  const matchedTypes = {};
  for (const m of matches) matchedTypes[m.type] = rootsOf(m.type);
  return { type, roots: rootsOf(type), matchedTypes };
}

export function classifyType(text) {
  const result = classifyAll(text);
  return result ? { type: result.type, roots: result.roots } : null;
}

// --- שורשים שנפלו דרך המילון (לרישום ב-candidate_rules, ראה answerPattern ב-lib/intake-questions.js) ---
// מילות פונקציה שלא נושאות משמעות לכלל. [הנחה, לא אומת] הרשימה של Claude.
const STOP_WORDS = new Set(['את', 'של', 'על', 'עם', 'אם', 'גם', 'לא', 'אני', 'אתה', 'הוא', 'היא', 'אנחנו', 'הם', 'הן', 'יש', 'אין', 'זה', 'זאת', 'זו', 'כל', 'כי', 'או', 'אבל', 'רק', 'עוד', 'כמו',
  'אל', 'מן', 'לי', 'לך', 'לו', 'לה', 'לנו', 'לכם', 'להם', 'מה', 'מי', 'איך', 'כמה', 'מתי', 'איפה', 'למה', 'היה', 'יהיה', 'יהיו', 'בין', 'אחרי', 'לפני', 'עד', 'כן', 'אז', 'שם', 'פה', 'כאן',
  'בבקשה', 'תודה', 'שלום', 'ממש', 'מאוד', 'כבר', 'עדיין', 'אחד', 'אחת', 'שני', 'שתי'].map(fin));
// מילת פונקציה (את, של, אם...): לא נושאת משמעות לכלל, ולכן לא נכנסת לדפוס.
export const isFunctionWord = (word) => STOP_WORDS.has(fin(String(word)));
const QUESTION_WORD = new RegExp(`^ו?(?:${['מה', 'מתי', 'איפה', 'איזה', 'כמה', 'האם', 'מי', 'למה'].map(fin).join('|')})$`);
const CLITIC_LETTER = /^[והשלבמכ]/;

// מילות תוכן שלא נתפסו (ולא מקצוע, לא מספר, לא מילת זמן, לא מילת שאלה), עם קידומת אחת-שתיים מוסרת: קירוב לשורש, לא ניתוח מורפולוגי אמיתי.
// [הנחה, לא אומת] הפונקציה לא יכולה לזהות שמות אנשים. מי שמעביר ל-answerPattern חייב להפעיל אותה רק על טקסט שיובל הקליד בעצמו
// (docs/08-chapter8/35-chapter8-plan.md סעיף 3.8.0: הודעה שהוקלדה) ולא על הודעה שהועברה מאדם אחר (CLAUDE.md, "ברזלים": דפוסים בלבד, בלי שמות).
export function fellThroughRoots(text) {
  if (typeof text !== 'string') return [];
  const ctx = buildContext(tokenize(text).tokens.map((token) => token.w));
  const skip = new Set();
  for (const s of ctx.subjects) for (let k = 0; k < s.len; k += 1) skip.add(s.index + k);
  for (const m of collectMatches(ctx)) for (let k = 0; k < m.length; k += 1) skip.add(m.index + k);
  const roots = [];
  ctx.words.forEach((w, i) => {
    if (skip.has(i) || !/^[א-ת]+$/.test(w) || STOP_WORDS.has(w) || TEMPORAL_WORD.test(w) || QUESTION_WORD.test(w)) return;
    let root = w;
    for (let k = 0; k < 2 && CLITIC_LETTER.test(root) && root.length > 3; k += 1) root = root.slice(1);
    if (root.length >= 3 && !roots.includes(root)) roots.push(root);
  });
  return roots.map(unfin); // לתצוגה: בוחן ולא בוחנ
}
