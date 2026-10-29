// מילון המילים המפעילות (שלב 8.2, קוד בלבד): מסווג הודעה לאחד משמונה סוגים לפי שורשים ולא לפי מחרוזות.
// מקור: docs/02-rules/03-intake-rules.md:224-254 ("המילון עובר להתאמת שורשים" + טבלת המילים המפעילות). פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל.
// הנתונים (רשימות השורשים והמקצועות) כתובים כקבועים כאן ובקובץ lib/intake-text.js, ולא בקובץ חיצוני, כדי שייכנסו לפריסה.
//
// סוגים: homework (שיעורי בית) · cancel (ביטול) · move (הזזה) · exam (מבחן) · room (חדר) · short_day (יום מקוצר)
// · early_leave (יציאה מוקדמת) · personal_event (אירוע אישי). שני האחרונים נוספו בשלב 8.3-1.
// הודעה שלא נתפסה = null. היא לא נזרקת: עוברת הלאה כ"לא מסווג" (03-intake-rules.md:254).
//
// שלב 8.3-1: early_leave ו-personal_event נתפסים רק בערוץ 'app' (הודעה שיובל הקליד בעצמו; classifyAll(text, { channel })) ורק עם שעה מפורשת
// (HH:MM, או "ב-13" / "בשעה 13"). בלי ערוץ, או בערוץ 'shortcut' (טקסט של אחרים): לא נתפסים, וההתנהגות זהה למה שהייתה לפני השלב.
// [הנחה, לא אומת] החלטת הערוץ והשעה החובה הן הכרעות של יובל; הרשימות, הטווחים (ביטוי בית הספר עד ארבע מילים לפני הפועל ועד ארבע אחריו) והסינון של גוף שלישי הם של Claude ושקל להפוך.
//
// [הנחה, לא אומת] כל כללי ההכרעה שבהמשך (סדר עדיפות בין סוגים, טריגרים "חלשים" שדורשים מקצוע) הם של Claude: המסמך קובע מילים מפעילות
// ולא מה גובר כשכמה סוגים מופיעים יחד. הסדר נבחר בכיוון שמגן מרעש ושקל להפוך; אימות המילון על מדגם מתויג הוא שלב 8.8.
//
// זהירות: tokenize מנרמל אותיות סופיות (אין = אינ, יום = יומ, מבחן = מבחנ). כל השוואה למילה עברית עם ך/ם/ן/ף/ץ חייבת לעבור דרך fin() / plainRegex / nounRegex.
import { tokenize, matchesRoot, nounRegex, plainRegex, fin, unfin, isNumberWord, CLITIC } from './intake-text.js';

export const TYPES = Object.freeze(['homework', 'cancel', 'move', 'exam', 'room', 'short_day', 'early_leave', 'personal_event']);
const CHANNEL_APP = 'app';

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
const CLOCK = /^\d{1,2}:\d{2}$/;
// מה שבא לפני מספר השעה: "ב-12" (ב), "בשעה 12" (בשעה), "שעה 12" (שעה).
const HOUR_PARTICLE = /^(?:ב|ב?שעה|השעה)$/;
// מילת מילוי אחת מותרת בין מילת השחרור/הסיום לשעה: "משוחררים כבר ב-12:30".
const HOUR_FILLER = /^(?:כבר|רק|ממש|בערך)$/;
// האם יש שעה צמודה אחרי המילה i (פועל שחרור או סיום): HH:MM, או "ב-12" / "בשעה 12" / "בשעה 12:30" (ביקורת 12.10, סעיף 1).
// [הנחה, לא אומת] "צמודה" = השעה (או "ב"/"בשעה" שלפניה) מתחילה עד שתי מילים אחרי, ורק מילת מילוי אחת מותרת ביניהן. שעה שרחוקה יותר
// ("סיום הפרויקט עד יום ראשון ב-23:59") או שבאה לפני המילה ("בשעה 9:05. בסיום המבחן") אינה נספרת: הכיוון הבטוח הוא לא להסיק יום מקוצר.
function hourAfter(words, i) {
  let p = i + 1;
  if (HOUR_FILLER.test(words[p] ?? '')) p += 1;
  if (CLOCK.test(words[p] ?? '')) return true;
  return HOUR_PARTICLE.test(words[p] ?? '') && (CLOCK.test(words[p + 1] ?? '') || isHour(words[p + 1] ?? ''));
}
// האם יש בהודעה מידע על זמן (תאריך, שעה, יום, שבוע). משמש רק להבחנת "עבר לחדר 124" (חדר) מ"עבר ליום שלישי" (הזזה).
const TEMPORAL_WORD = new RegExp(`^(?:וכש|וש|כש|ו|ש)?(?:ב|ל|מ)?(?:${['שבוע', 'מחר', 'מחרתיים', 'היום', 'יום', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(fin).join('|')})$`);
const hasTemporal = (words) => words.some((w) => /^\d{1,2}:\d{2}$/.test(w) || /^\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?$/.test(w) || TEMPORAL_WORD.test(w));

// --- שעה מפורשת (שלב 8.3-1) ---
// שעה מפורשת היא HH:MM ("13:15", גם "ב-13:15" שמתפצל ל"ב" ו"13:15"), או "ב-13" / "בשעה 13" / "שעה 13" (קידומת שעה ואחריה מספר 0 עד 23).
// מספר חשוף ("13") אינו שעה: "שיעור 6", "12.10" ו"3 ימים" לא נתפסים. שעת סיום ("עד 17:30") אינה שעת התחלה.
const clockValue = (w) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(w ?? '');
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? `${m[1].padStart(2, '0')}:${m[2]}` : null;
};
const hourValue = (w) => (/^\d{1,2}$/.test(w ?? '') && Number(w) <= 23 ? `${w.padStart(2, '0')}:00` : null);
const UNTIL = /^ו?עד$/;
// האם המילה i שייכת לשעת סיום: "עד" עד שתי מילים לפניה ("עד 17:30", "עד ב-17").
const afterUntil = (words, i) => UNTIL.test(words[i - 1] ?? '') || UNTIL.test(words[i - 2] ?? '');
// "ב-20 לחודש", "ב-3 בנובמבר": מספר אחרי "ב" ואחריו חודש הוא יום בחודש ולא שעה (ביקורת, סעיף 4).
const MONTH_WORD = new RegExp(`^(?:ב|ל|מ)?(?:${['חודש', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'].map(fin).join('|')})$`);
const hourBeforeMonth = (words, j) => MONTH_WORD.test(words[j + 1] ?? '');
const timeAtWord = (words, i) => {
  const value = clockValue(words[i]);
  if (value) return value;
  if (!HOUR_PARTICLE.test(words[i] ?? '')) return null;
  return clockValue(words[i + 1]) ?? (hourBeforeMonth(words, i + 1) ? null : hourValue(words[i + 1]));
};

// --- שעה במילים (אחרי שלב 8.3-1) ---
// "בארבע", "בשעה שמונה", "שעה חמש", "בארבע וחצי", "בארבע ורבע", "ברבע לחמש". קידומת חובה (ב / בשעה / שעה), כדי ש"ארבעה ימים" ו"שלוש שעות" לא יקראו כשעה.
// שעה במילים היא עמומה: "בארבע" = 04:00 או 16:00. קריאה היא { candidates, start, end }: candidates ממוינת (בוקר קודם) ובאורך 1 (ודאית) או 2 (עמומה); start / end אינדקסי המילים הראשונה והאחרונה.
// מילת הכרעה צמודה אחרי השעה (בבוקר, בצהריים, אחה"צ, בערב, בלילה) מבטלת את הספק, אבל רק כשהיא מתאימה לשעה ("בארבע בערב" אינה מכריעה: שואלים). אסור לנחש (docs/08-chapter8/65-chapter8-step-8-3-prd.md, גבולות).
// [הנחה, לא אומת] כל הטבלה כאן היא של Claude ושקל להפוך: צורות הכתיב, אילו שעות מתאימות לאיזו מילת הכרעה (HALF_RULES), מילת הכרעה רק אחרי השעה ולא לפניה, ורשימת
// המילים שאחרי השעה שפוסלות קריאה (דקות שלא נבנו, יחידות כמו "שלוש שעות"). דקות אחרות ("ועשרים", "עשרה לשתיים") לא נקראות: הקריאה נופלת, ונשאלת "באיזו שעה?" הקיימת.
const HOUR_WORD_VALUES = [['אחת', 1], ['שתיים', 2], ['שתים', 2], ['שלוש', 3], ['ארבע', 4], ['חמש', 5], ['שש', 6], ['שבע', 7], ['שמונה', 8], ['שמנה', 8], ['תשע', 9], ['עשר', 10]];
const HOUR_WORDS = new Map(HOUR_WORD_VALUES.map(([word, value]) => [fin(word), value]));
const TEEN_WORD = /^עשרה?$/; // "אחת עשרה" = 11, "שתים עשרה" = 12
const ATTACHED_B = /^(?:וכש|וש|כש|ו|ש)?ב(.+)$/;
const MINUTE_WORD = /^ו(?:חצי|רבע)$/;
// מה שבא אחרי השעה ופוסל את הקריאה: דקות שלא נבנו ("ועשרים", "וחמש דקות", "ושלושה רבעים", "ו-20"), ויחידת זמן או מניין ("שלוש שעות", "ארבע פעמים").
const NUMBER_FOLLOWERS = [...HOUR_WORDS.keys(), ...['עשרה', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שניים', 'שני', 'שלושה', 'שלושת', 'ארבעה', 'ארבעת', 'חמישה', 'שישה', 'שבעה', 'שבעים', 'תשעה', 'דקה', 'דקות', 'רבעים', 'רבע', 'חצי'].map(fin)];
const UNSUPPORTED_MINUTES = new RegExp(`^ו(?:${NUMBER_FOLLOWERS.join('|')})$`);
const TIME_UNIT = new RegExp(`^(?!ה(?:${fin('יום')}|שבוע)$)ה?(?:${['שעה', 'שעות', 'יום', 'ימים', 'דקה', 'דקות', 'שבוע', 'שבועות', 'חודש', 'חודשים', 'שנה', 'שנים', 'פעם', 'פעמים', 'שיעור', 'שיעורים'].map(fin).join('|')})$`);
const NUMBER_AFTER_VAV = new RegExp(`^(?:\\d+|${NUMBER_FOLLOWERS.join('|')})$`);
// מילות הכרעה: סוג -> תבנית המילה. "אחרי / אחר הצהריים" הן שתי מילים.
const NOON_WORD = new RegExp(`^ב?ה?${fin('צהר(?:יי|י)ם')}$`);
const DECIDING_WORDS = [['morning', /^ב?בוקר$/], ['noon', NOON_WORD], ['afternoon', /^אחהצ$/], ['evening', /^ב?ערב$/], ['night', /^ב?לילה$/]];
const AFTER_WORD = /^(?:אחרי|אחר)$/;
// חלופות שמחברות שתי שעות או שתי הכרעות ("בשתיים/שלוש", "בבוקר ובערב", "ואולי בערב", "ובשלוש"): אין שעה אחת, ולכן לא קוראים. [הנחה, לא אומת] הרשימה של Claude.
const ALTERNATIVE = new RegExp(`^(?:או|ו?אולי|ו(?:ב?בוקר|ב?ערב|ב?לילה|ב?ה?${fin('צהר(?:יי|י)ם')}))$`);
const startsAlternative = (words, j, ctx) => {
  const w = words[j] ?? '';
  if (ALTERNATIVE.test(w)) return true;
  const attached = /^וב(.+)$/.exec(w);
  if (attached && HOUR_WORDS.has(attached[1])) return true;
  return j > 0 && ctx?.tokens[j - 1] && ctx.tokens[j] && /\//.test(ctx.clean.slice(ctx.tokens[j - 1].end, ctx.tokens[j].start));
};
// מילת הכרעה או חלק-יום (בכל צורה) שמתחילה במילה j. מיוצאת גם לכותרת האירוע האישי (lib/intake-facts.js), שם היא גבול.
export const isDayPartWord = (words, j) => Boolean(decidingWordAt(words, j)) || OTHER_DAY_PART.test(words[j] ?? '');
// מילות חלק-יום שאינן ברשימת ההכרעה ("לפנות בוקר", "הלילה"): לא מכריעות, אבל אסור שהסקה משעות הלימודים תנחש נגדן, ולכן הקריאה "מוטלת בספק" (contested).
const OTHER_DAY_PART = /^(?:לפנות|הלילה|הבוקר|הערב)$/;
// האם אין סימן פיסוק בין מילה a למילה b (ctx = { clean, tokens }, אופציונלי; בלעדיו נחשב מחובר). מילת הכרעה בחצי משפט אחר ("בשבע. בערב יש לי אימון") אינה שייכת לשעה.
const sameClauseGap = (ctx, a, b) => !ctx || !ctx.tokens[a] || !ctx.tokens[b] || !CLAUSE_BREAK.test(ctx.clean.slice(ctx.tokens[a].end, ctx.tokens[b].start));
// איזו מחצית היום ('am' = בוקר, 'pm' = אחר הצהריים וערב) מילת ההכרעה קובעת לשעה (1 עד 12 בשעון של 12 שעות); null = המילה לא מתאימה לשעה, ולכן אינה מכריעה.
export const HALF_RULES = {
  morning: (hour) => (hour <= 11 ? 'am' : null),
  noon: (hour) => (hour === 12 || hour <= 4 ? 'pm' : null),
  afternoon: (hour) => (hour === 12 || hour <= 6 ? 'pm' : null),
  evening: (hour) => (hour >= 5 && hour <= 11 ? 'pm' : null),
  night: (hour) => (hour === 12 || hour <= 5 ? 'am' : hour >= 8 && hour <= 11 ? 'pm' : null),
};
const pad2 = (n) => String(n).padStart(2, '0');
const halfCandidates = (hour, minute) => [`${pad2(hour % 12)}:${pad2(minute)}`, `${pad2((hour % 12) + 12)}:${pad2(minute)}`];

// מספר השעה במילה (או בשתיים: "אחת עשרה", "שתים עשרה"): { hour (1 עד 12), len (כמה מילים) } או null.
function hourWordAt(word, nextWord) {
  const hour = HOUR_WORDS.get(word ?? '');
  if (hour === undefined) return null;
  if (TEEN_WORD.test(nextWord ?? '')) return hour <= 2 ? { hour: hour + 10, len: 2 } : null; // "שלוש עשרה" (13) אינה נקראת
  return { hour, len: 1 };
}

// מילת הכרעה שמתחילה במילה j: { kind, len } או null.
function decidingWordAt(words, j) {
  const w = words[j] ?? '';
  if (AFTER_WORD.test(w) && NOON_WORD.test(words[j + 1] ?? '')) return { kind: 'afternoon', len: 2 };
  const hit = DECIDING_WORDS.find(([, re]) => re.test(w));
  return hit ? { kind: hit[0], len: 1 } : null;
}

// מה שבא אחרי הקידומת: rest = המילה (או שארית המילה) אחרי "ב", next = אינדקס המילה שאחריה. מחזיר קריאה או null.
function spokenFrom(words, i, rest, next, ctx) {
  let hour;
  let minute = 0;
  let after;
  if (rest === 'רבע') {
    // "רבע לחמש" = 04:45; "רבע לאחת" = 12:45
    const target = /^ל(.+)$/.exec(words[next] ?? '');
    const spoken = target ? hourWordAt(target[1], words[next + 1]) : null;
    if (!spoken) return null;
    hour = spoken.hour === 1 ? 12 : spoken.hour - 1;
    minute = 45;
    after = next + spoken.len;
  } else {
    const spoken = hourWordAt(rest, words[next]);
    if (!spoken) return null;
    hour = spoken.hour;
    after = next + spoken.len - 1;
    if (MINUTE_WORD.test(words[after] ?? '')) {
      minute = words[after] === 'ורבע' ? 15 : 30;
      after += 1;
    }
  }
  const follower = words[after] ?? '';
  if (UNSUPPORTED_MINUTES.test(follower) || TIME_UNIT.test(follower)) return null;
  if (rest === 'אחת' && /^(?:מה|ה)/.test(follower)) return null; // "באחת מהכיתות", "באחת הפעמים" אינן שעה
  if (startsAlternative(words, after, ctx) || MONTH_WORD.test(follower)) return null; // "בשתיים או בשלוש" (שתי שעות); "בעשר באוקטובר", "בחמש לחודש" (תאריך)
  const toHour = /^ל(.+)$/.exec(follower);
  if (toHour && HOUR_WORDS.has(toHour[1])) return null; // "בעשר לשתיים" (13:50) אינה נקראת
  if (follower === 'ו' && NUMBER_AFTER_VAV.test(words[after + 1] ?? '')) return null;
  let end = after - 1;
  let candidates = halfCandidates(hour, minute);
  const joined = sameClauseGap(ctx, after - 1, after);
  const deciding = joined ? decidingWordAt(words, after) : null;
  const half = deciding ? HALF_RULES[deciding.kind](hour) : null;
  let contested = joined && !deciding && OTHER_DAY_PART.test(follower);
  if (deciding) {
    if (startsAlternative(words, after + deciding.len, ctx)) return null; // "בשבע בבוקר או בערב", "בבוקר/בערב": לא ידוע
    if (half) {
      candidates = [candidates[half === 'am' ? 0 : 1]];
      end = after + deciding.len - 1;
    } else {
      contested = true; // מילת הכרעה שלא מתאימה לשעה ("בשלוש בערב"): שואלים, לא מסיקים
    }
  }
  // מילת הכרעה אחרי מילת יום ("בעשר מחר בערב", "בשתיים ביום שלישי בבוקר"): אינה צמודה ולכן לא מכריעה, אבל אסור להסיק נגדה משעות הלימודים.
  for (let k = after + 1; !contested && !deciding && k <= after + 3 && k < words.length && sameClauseGap(ctx, k - 1, k); k += 1) contested = isDayPartWord(words, k);
  return { candidates, start: i, end, contested };
}

function spokenReadingAt(words, i, ctx) {
  const w = words[i] ?? '';
  const previousHour = (d) => { const m = ATTACHED_B.exec(words[i - d] ?? ''); return Boolean(m && HOUR_WORDS.has(m[1])); };
  if (/^וב/.test(w) && (previousHour(1) || previousHour(2) || previousHour(3))) return null; // "בשתיים ובשלוש": שתי שעות
  if (/^(?:או|ו?אולי)$/.test(words[i - 1] ?? '')) return null; // "בשתיים או בשלוש": שתי שעות, אף אחת לא נקראת
  const attached = ATTACHED_B.exec(w);
  const fromAttached = attached ? spokenFrom(words, i, attached[1], i + 1, ctx) : null;
  if (fromAttached) return fromAttached;
  if (w === 'שעה' && words[i + 1] === 'אחת') return null; // "שעה אחת" היא משך ולא שעון (בניגוד ל"בשעה אחת")
  return HOUR_PARTICLE.test(w) ? spokenFrom(words, i, words[i + 1] ?? '', i + 2, ctx) : null;
}

// קריאת שעה במילה i: ספרות (ודאית, כמו תמיד) או מילים (ודאית או עמומה). מיוצאת גם לגבול כותרת האירוע האישי (lib/intake-facts.js, H3, 65, 27.10.2026).
export function readingAt(words, i, ctx) {
  const digits = timeAtWord(words, i);
  return digits ? { candidates: [digits], start: i, end: i, contested: false } : spokenReadingAt(words, i, ctx);
}

// הקריאה הראשונה בטקסט (ספרות או מילים), או null. קריאה ודאית קודמת לעמומה: HH:MM או "ב-16" שבאו אחרי "בארבע" עדיפים על "בארבע" שאין לה הכרעה. שעת סיום ("עד ...") אינה התחלה.
export function findTimeReading(words, ctx) {
  let ambiguous = null;
  for (let i = 0; i < words.length; i += 1) {
    if (afterUntil(words, i)) continue;
    const found = readingAt(words, i, ctx);
    if (!found) continue;
    if (found.candidates.length === 1) return found;
    ambiguous ??= found;
  }
  return ambiguous;
}

// שעת ההתחלה הוודאית הראשונה בטקסט (HH:MM), או null. ספרות, או שעה במילים עם מילת הכרעה; "בארבע" לבדה אינה ודאית ולכן לא נבחרת (findTimeReading מחזירה אותה עמומה).
// משמשת כשהסוג נבחר ידנית ("מה זה?") ובתשובה לשאלת השעה; בזיהוי אוטומטי משתמשים בשעה הצמודה (adjacentReading).
export function findClockTime(words, ctx) {
  for (let i = 0; i < words.length; i += 1) {
    if (afterUntil(words, i)) continue;
    const found = readingAt(words, i, ctx);
    if (found?.candidates.length === 1) return found.candidates[0];
  }
  return null;
}

// שעת הסיום: מה שאחרי "עד" ("עד 17:30", "מ-16:00 עד 17", "עד ב-17:30"), או null. [הנחה, לא אומת] מספר חשוף אחרי "עד" נקרא כשעה (0 עד 23); הבדיקה שהוא אחרי ההתחלה היא של הקורא.
export function findEndTime(words) {
  for (let i = 0; i < words.length; i += 1) {
    if (!UNTIL.test(words[i])) continue;
    let j = i + 1;
    if (HOUR_PARTICLE.test(words[j] ?? '')) j += 1;
    const value = clockValue(words[j]) ?? (hourBeforeMonth(words, j) ? null : hourValue(words[j]));
    if (value) return value;
  }
  return null;
}

// --- שעה צמודה (ביקורת, סעיף 3) ---
// השעה הצמודה לטווח מילים [from, to] (הפועל או ביטוי האירוע): עד TIME_REACH מילים ממנו, באותו משפט (בלי פסיק ונקודה ביניהם), ובלי "אחרי" / "לפני" באמצע.
// שעה שאחרי הטווח עדיפה על שעה שלפניו ("אימון ב-16:00 ותור לרופא ב-18:00" = 18:00). אין שעה צמודה = null (ההודעה לא מזוהה).
// הקריאה היא ספרות או שעה במילים (ראה findTimeReading): { candidates, start, end }. קריאה עמומה ("בארבע") נחשבת שעה צמודה, וההכרעה בה נעשית ב-lib/intake-facts.js.
// [הנחה, לא אומת] הטווח (4) ורשימת המילים החוסמות הם של Claude. ctx = { words, clean, tokens }.
const TIME_REACH = 4; // אירוע אישי: עד 4 מילים מהביטוי
const LEAVE_TIME_REACH = 6; // יציאה מוקדמת: הפועל, ביטוי בית הספר ("מוקדם מבית הספר היום") ואז השעה
const TIME_BLOCKER = /^(?:אחרי|לפני|אחר)$/;
function adjacentReading(ctx, from, to, reach = TIME_REACH) {
  const { words } = ctx;
  const connected = (a, b) => sameClause(ctx, a, b) && !words.slice(a + 1, b).some((w) => TIME_BLOCKER.test(w));
  // קריאה ודאית (ספרות, או מילים עם הכרעה) קודמת לעמומה, גם אם רחוקה יותר: "בשלוש ואחר כך ב-17:00" = 17:00, כמו לפני שעה במילים. בכל קבוצה: הקרובה, ואחרי הפועל קודם.
  let ambiguous = null;
  const consider = (found) => {
    if (found.candidates.length === 1) return found;
    ambiguous ??= found;
    return null;
  };
  for (let d = 1; d <= reach && to + d < words.length; d += 1) {
    const found = afterUntil(words, to + d) ? null : readingAt(words, to + d, ctx);
    if (found && connected(to, to + d) && consider(found)) return found;
  }
  for (let d = 1; d <= reach && from - d >= 0; d += 1) {
    const found = afterUntil(words, from - d) ? null : readingAt(words, from - d, ctx);
    if (found && found.end < from && connected(found.end, from) && consider(found)) return found;
  }
  return ambiguous;
}
// השעה היחידה של קריאה ודאית, או null כשהקריאה עמומה.
const certainTime = (found) => (found.candidates.length === 1 ? found.candidates[0] : null);

// --- יציאה מוקדמת (early_leave) ---
// פועל יציאה בגוף ראשון + ביטוי "מבית הספר" (חובה, ביקורת סעיף 1: "מוקדם" לבדו אינו מספיק) + שעה צמודה לפועל. ערוץ app בלבד.
// גוף ראשון (ביקורת סעיף 2, והרחבה בסבב 3): צורה מפורשת בגוף ראשון (הלכתי, יצאתי, עזבתי, אצא, אלך, אעזוב), או "אני" עד שלוש מילים מהפועל, או הווה בלי "אני"
// ("יוצא מבית הספר ב-12 מחר") כל עוד אין נושא אחר לפני הפועל: לא מילה מהרשימה הסגורה ולא שם קרבה בשלוש המילים שלפניו, והמילה שלפניו (באותו משפט)
// היא מילת זמן, מספר או שעה, או מילת קישור קצרה ("אז", "גם", "כבר", "ו"). שם פרטי או שם עצם לפני הפועל ("ירדן יוצאת", "המורה הזאת יוצאת", "אחי יוצא") = נושא אחר.
// "אני הולך לאימון ב-16:00" לא נתפס (אין ביטוי בית ספר); גוף שלישי ורבים ("הולכים מוקדם לטיול") לא נתפסים.
// עוד שתי צורות (סבב 3): "אני צריך/חייב/אמור ללכת/לצאת/לעזוב מבית הספר ב-12" (פועל עזר + שם פועל), ו"הולך/יוצא הביתה מוקדם ב-12:00" (בלי ביטוי בית ספר),
// שהאחרונה מוגבלת בידי extractFacts: רק ראשון עד חמישי ובשעות היום (08:15 עד 15:45); אחרת לא מזוהה (lib/intake-facts.js, HOME_ROOT).
// [הנחה, לא אומת] כל הרשימות והטווחים כאן הם של Claude ושקל להפוך.
const EARLY_LEAVE_ROOTS = ['הולך_אני', 'יוצא_אני', 'עוזב_אני'];
export const HOME_ROOT = 'הביתה מוקדם';
const FIRST_PERSON_FORM = new RegExp(`^(?:ו|ש)?(?:${['הלכתי', 'יצאתי', 'עזבתי', 'אצא', 'אלך', 'אעזוב'].map(fin).join('|')})$`);
const I_WORD = /^ו?אני$/;
const FIRST_PERSON_REACH = 3;
const MODAL = new RegExp(`^(?:${['צריך', 'צריכה', 'חייב', 'חייבת', 'אמור', 'אמורה'].map(fin).join('|')})$`);
const LEAVE_INFINITIVE = /^(?:ללכת|לצאת|לעזוב)$/;
const HOME = /^הביתה$/;
const EARLY = plainRegex('מוקדם');
const HOME_EARLY_REACH = 3;
const IMPLIED_PREV = /^(?:ו|אז|גם|כבר|רק|ממש|ב|בשעה|שעה)$/;
// מילה לפני הפועל שמראה שהמדבר אינו יובל ("היא יוצאת מוקדם מהכיתה ב-13:15"). [הנחה, לא אומת] רשימה סגורה וקטנה; עדיף שתחמיץ מאשר תכתוב משהו שלא נאמר.
const OTHER_SUBJECT = new RegExp(`^(?:${['הוא', 'היא', 'הם', 'הן', 'אתה', 'את', 'אתם', 'אתן', 'אנחנו', 'אנו', 'המורה', 'המורים', 'המחנכת', 'המחנך', 'הכיתה', 'הילדים', 'התלמידים', 'כולם'].map(fin).join('|')})$`);
const FROM_SCHOOL_WORD = new RegExp(`^מה?(?:ביהס|${['לימודים', 'כיתה', 'שיעור', 'שיעורים'].map(fin).join('|')})$`);
const FROM_HOUSE = /^מה?בית$/;
const BOOK = /^ה?ספר$/;
const LEAVING_OBJECT = new RegExp(`^ה?(?:ביהס|${['לימודים', 'כיתה'].map(fin).join('|')})$`);
const SCHOOL_REACH = 4;
// ביטוי "מבית הספר" שמתחיל במילה k: "מהבית ספר", "מבית הספר", "מביהס", "מהלימודים", "מהשיעור", "מהכיתה"; ועם "עוזב": גם "את בית הספר" / "את הלימודים".
function schoolPhraseAt(words, k, leaving) {
  if (FROM_SCHOOL_WORD.test(words[k] ?? '')) return true;
  if (FROM_HOUSE.test(words[k] ?? '') && BOOK.test(words[k + 1] ?? '')) return true;
  if (leaving && words[k] === 'את') return LEAVING_OBJECT.test(words[k + 1] ?? '') || (/^ה?בית$/.test(words[k + 1] ?? '') && BOOK.test(words[k + 2] ?? ''));
  return false;
}
// נושא משתמע (ביקורת סבב ב', סעיף 1): הפועל בלי "אני" נחשב של יובל רק כשאין שום מילה אחרת שיכולה להיות נושא. כל מילות המשפט לפני הפועל (עד IMPLIED_BEFORE_REACH),
// והמילה שאחריו, חייבות להיות ניטרליות: זמן, מספר או שעה, מילת קישור, "מוקדם", או (אחרי הפועל) ביטוי בית הספר. שם פרטי או שם עצם בכל מקום ("דנה מחר יוצאת", "עומר כבר יוצא",
// "יוצא עומר מבית הספר", "מורה למתמטיקה מחר יוצאת") פוסל. [הנחה, לא אומת] רשימת הניטרליות קטנה בכוונה: ניסוח לגיטימי עם מילה נוספת ("אחרי שיעור 5 הולך מבית הספר")
// נופל לשאלה, וזה עדיף על רישום יציאה של מישהו אחר.
const NEUTRAL_EXTRA = /^(?:אחרי|לפני|בערך|כנראה|אולי|שוב|עוד)$/;
const IMPLIED_BEFORE_REACH = 8;
const isNeutralWord = (w) => TEMPORAL_WORD.test(w) || IMPLIED_PREV.test(w) || NEUTRAL_EXTRA.test(w) || EARLY.test(w) || /^\d{1,2}(?::\d{2})?$/.test(w);
// סבב ב', ביקורת נקייה שנייה: (א) יובל זכר, ולכן צורת נקבה בלי "אני" ("מחר יוצאת מבית הספר ב-12") היא כמעט בוודאות מישהי אחרת; (ב) הבדיקה לפני הפועל חוצה פסיק ("מחר מתן, יוצא")
// ונעצרת רק בסוף משפט; (ג) גם כל מה שאחרי הפועל עד סוף המשפט חייב להיות ניטרלי או חלק מביטוי בית הספר ("…ב-12 מחר עומר", "…ב-12 אחי" פוסלים).
// [הנחה, לא אומת] "…ב-12 בגלל רופא" בלי "אני" נופל לשאלה (המילה "בגלל" אינה ניטרלית); עם "אני" הוא נתפס כרגיל.
const FEMININE_FORM = new RegExp(`^(?:ו|ש)?(?:${['יוצאת', 'הולכת', 'עוזבת', 'צריכה', 'חייבת', 'אמורה'].map(fin).join('|')})$`);
const SENTENCE_BREAK = /[!?\n]|\.(?:\s|$)/;
const sameSentence = (ctx, from, to) => {
  for (let k = from; k < to; k += 1) if (SENTENCE_BREAK.test(ctx.clean.slice(ctx.tokens[k].end, ctx.tokens[k + 1].start))) return false;
  return true;
};
const SCHOOL_TAIL_WORD = new RegExp(`^(?:את|ה?בית|ה?ספר|הביתה|ללכת|לצאת|לעזוב|ואני|אני)$`);
const isTailWord = (w) => isNeutralWord(w) || SCHOOL_TAIL_WORD.test(w) || FROM_SCHOOL_WORD.test(w) || FROM_HOUSE.test(w) || LEAVING_OBJECT.test(w);
// מילים שהן חלק משעה במילים ("בארבע וחצי", "בשעה שלוש") ניטרליות כמו ספרות: הן לא נושא אחר. [הנחה, לא אומת] כל מילה בקריאה כזו, גם מילת הכרעה, נחשבת ניטרלית.
const inSpokenTime = (ctx, k) => cached(ctx, 'spoken', () => {
  const covered = new Set();
  for (let i = 0; i < ctx.words.length; i += 1) {
    const found = spokenReadingAt(ctx.words, i, ctx);
    if (found) for (let n = found.start; n <= found.end; n += 1) covered.add(n);
  }
  return covered;
}).has(k);
function impliedSubject(ctx, s) {
  const { words } = ctx;
  if (FEMININE_FORM.test(words[s])) return false;
  for (let k = s - 1; k >= Math.max(0, s - IMPLIED_BEFORE_REACH) && sameSentence(ctx, k, k + 1); k -= 1) {
    if (OTHER_SUBJECT.test(words[k]) || KINSHIP.test(words[k]) || !(isNeutralWord(words[k]) || inSpokenTime(ctx, k))) return false;
  }
  for (let k = s + 1; k < words.length && sameSentence(ctx, k - 1, k); k += 1) if (!isTailWord(words[k]) && !inSpokenTime(ctx, k)) return false;
  return true;
}
function isFirstPerson(ctx, s) {
  const { words } = ctx;
  if (FIRST_PERSON_FORM.test(words[s])) return true;
  for (let k = Math.max(0, s - FIRST_PERSON_REACH); k <= Math.min(words.length - 1, s + FIRST_PERSON_REACH); k += 1) if (I_WORD.test(words[k])) return true;
  return impliedSubject(ctx, s);
}
// היציאה המוקדמת הראשונה בטקסט: { index (הפועל או שם הפועל), time (HH:MM, הצמודה אליו; null כשהשעה במילים עמומה), candidates (קריאה אחת או שתיים של השעה),
// home (true: צורת "הביתה מוקדם", בלי ביטוי בית ספר) } או null. הכרעה בין שתי קריאות (שעות הלימודים) נעשית ב-extractFacts.
// ctx = { words, clean, tokens }. allowHome=false מכבה את צורת "הביתה" (extractFacts עושה זאת כשהיום או השעה לא בתוך יום לימודים).
export function findEarlyLeave(ctx, { allowHome = true } = {}) {
  const { words } = ctx;
  for (let i = 0; i < words.length; i += 1) {
    let subjectAt = i;
    let leaving = false;
    let direct = false;
    const root = EARLY_LEAVE_ROOTS.find((r) => matchesRoot(r, words[i]));
    if (root) {
      leaving = root === 'עוזב_אני';
      direct = true;
    } else if (LEAVE_INFINITIVE.test(words[i]) && MODAL.test(words[i - 1] ?? '')) {
      subjectAt = i - 1;
      leaving = words[i] === 'לעזוב';
    } else {
      continue;
    }
    if (OTHER_SUBJECT.test(words[subjectAt - 1] ?? '') || !isFirstPerson(ctx, subjectAt)) continue;
    let school = false;
    for (let k = Math.max(0, i - SCHOOL_REACH); k <= Math.min(words.length - 1, i + SCHOOL_REACH) && !school; k += 1) school = schoolPhraseAt(words, k, leaving);
    if (school) {
      const found = adjacentReading(ctx, i, i, LEAVE_TIME_REACH);
      if (found) return { index: i, time: certainTime(found), candidates: found.candidates, contested: found.contested, home: false };
      continue;
    }
    // "הולך/יוצא הביתה מוקדם": "הביתה" אחרי הפועל (עד מילה אחת ביניהם) ו"מוקדם" עד שלוש מילים ממנו.
    if (allowHome && direct && !leaving && (HOME.test(words[i + 1] ?? '') || HOME.test(words[i + 2] ?? ''))) {
      let early = false;
      for (let k = Math.max(0, i - HOME_EARLY_REACH); k <= Math.min(words.length - 1, i + HOME_EARLY_REACH); k += 1) early ||= k !== i && EARLY.test(words[k]);
      const found = early ? adjacentReading(ctx, i, i, LEAVE_TIME_REACH) : null;
      if (found) return { index: i, time: certainTime(found), candidates: found.candidates, contested: found.contested, home: true };
    }
  }
  return null;
}
// התוצאה נשמרת לפי ctx: הטריגרים נקראים לכל מילה, והחיפוש עצמו עובר על כל ההודעה (הודעה ארוכה לא צריכה להפוך לריבועית).
const triggerCache = new WeakMap();
const cached = (ctx, key, compute) => {
  if (!triggerCache.has(ctx)) triggerCache.set(ctx, new Map());
  const store = triggerCache.get(ctx);
  if (!store.has(key)) store.set(key, compute());
  return store.get(key);
};
const earlyLeave = (ctx, i) => {
  if (ctx.channel !== CHANNEL_APP) return 0;
  const found = cached(ctx, 'early', () => findEarlyLeave(ctx, { allowHome: ctx.allowHome }));
  return found && !found.home && found.index === i ? 1 : 0;
};
const earlyLeaveHome = (ctx, i) => {
  if (ctx.channel !== CHANNEL_APP) return 0;
  const found = cached(ctx, 'early', () => findEarlyLeave(ctx, { allowHome: ctx.allowHome }));
  return found?.home && found.index === i ? 1 : 0;
};

// --- אירוע אישי (personal_event) ---
// שם עצם של אירוע אישי + שעה צמודה לביטוי. ערוץ app בלבד. [הנחה, לא אומת] הרשימה קצרה בכוונה: החמצה נופלת לשאלה, התאמת-יתר כותבת משהו שלא נאמר.
// בלי קידומת מ' ("מהרופא", "מהתספורת" = חזרה משם, לא תור) ובלי ה' בראש "תור" ("התור שלי לשחק"; "התור לרופא" נתפס דרך "לרופא").
const nounNoFrom = (body) => new RegExp(`^(?:וכש|וש|כש|ו|ש)?(?:ב|ל|כ)?ה?(?:${fin(body)})$`);
const MEDICAL = nounNoFrom('בדיקה');
const MEDICAL_ADJECTIVE = plainRegex('ה?(?:רפואית|רפואי)');
const TEST_OF = nounNoFrom('בדיקת');
const TEST_KIND = plainRegex('דם|עיניים|שיניים'); // "בדיקת דם / עיניים / שיניים"; לא "משפחה" ו"ילדים" (שייכים ל"רופא", DOCTOR_KIND)
const APPOINTMENT = new RegExp(`^(?:ו|ש)?${fin('תור')}$`); // בלי ב'/כ'/מ'/ה': "בתור" (כ-), "לתור" (לחפש), "התור שלי"
const DOCTOR = nounNoFrom('רופא|רופאה');
const SPEECH_AFTER_DOCTOR = plainRegex('אמר|אמרה|אומר|אומרת|ביקש|ביקשה|רוצה|קבע|קבעה');
const OTHER_NOUNS = nounNoFrom('שיננית|תספורת|פיזיו|פיזיותרפיה');
const DOCTOR_KIND = plainRegex('שיניים|עיניים|משפחה|ילדים');
// של מי התור (ביקורת, סעיף 2): שם קרבה או "ל<מישהו> יש" עד ארבע מילים לפני הביטוי פוסלים. "יש לי תור" (וגם "אחרי הלימודים יש לי תור") נשאר.
const KINSHIP = new RegExp(`^(?:ל|ו|ש)?(?:${['אחי', 'אחיי', 'אחותי', 'אמא', 'אימא', 'אבא', 'אמי', 'אבי', 'סבא', 'סבתא', 'חבר', 'חברה', 'חברי', 'חברתי', 'אחיו', 'אחותו', 'אחותה'].map(fin).join('|')})$`);
const OWNER_REACH = 4;
function otherPersonBefore(words, start) {
  for (let k = Math.max(0, start - OWNER_REACH); k < start; k += 1) {
    if (KINSHIP.test(words[k])) return true;
    if (words[k] === 'יש') {
      const after = words[k + 1] ?? '';
      if (/^(?:לו|לה|להם|להן)$/.test(after) || (k > 0 && after !== 'לי' && /^ל./.test(words[k - 1]))) return true;
    }
  }
  return false;
}
// כמה מילים בביטוי האירוע שמתחיל במילה i (0 = אין). "בדיקה רפואית" ו"בדיקת דם" (וגם "בדיקת עיניים", "בדיקת שיניים") הן שתי מילים; "רופא" לפני פועל דיבור ("הרופא אמר") אינו תור.
function eventAtomLength(words, i) {
  const w = words[i];
  if (w === undefined) return 0;
  if (MEDICAL.test(w) && MEDICAL_ADJECTIVE.test(words[i + 1] ?? '')) return 2;
  if (TEST_OF.test(w) && TEST_KIND.test(words[i + 1] ?? '')) return 2;
  if (APPOINTMENT.test(w) || OTHER_NOUNS.test(w)) return 1;
  if (DOCTOR.test(w) && !SPEECH_AFTER_DOCTOR.test(words[i + 1] ?? '')) return 1;
  return 0;
}
// ביטוי האירוע שמתחיל במילה i, מורחב על פני מילות אירוע רצופות ("תור לרופא שיניים" = שלוש מילים: תור, לרופא, שיניים): מספר המילים (0 = אין).
function eventPhraseLength(words, i) {
  let j = i;
  let started = false;
  for (;;) {
    const atom = eventAtomLength(words, j);
    if (atom) j += atom;
    else if (started && DOCTOR_KIND.test(words[j] ?? '')) j += 1;
    else break;
    started = true;
  }
  return j - i;
}
// הביטוי הראשון שמתאים: { index, len, time, candidates } (time = השעה הצמודה אליו, null כשאין או כשהיא במילים ועמומה; candidates = קריאות השעה, [] כשאין), או null. הראשון שיש לו שעה צמודה ואינו של מישהו אחר גובר;
// אם אין כזה, הביטוי הראשון בכלל (עם time null): לשימוש הכותרת כשהסוג נבחר ידנית. ctx = { words, clean, tokens }.
export function findPersonalEvent(ctx) {
  const { words } = ctx;
  let firstAny = null;
  for (let i = 0; i < words.length;) {
    const len = eventPhraseLength(words, i);
    if (!len) {
      i += 1;
      continue;
    }
    firstAny ??= { index: i, len, time: null, candidates: [] };
    const found = otherPersonBefore(words, i) ? null : adjacentReading(ctx, i, i + len - 1);
    if (found) return { index: i, len, time: certainTime(found), candidates: found.candidates, contested: found.contested };
    i += len;
  }
  return firstAny;
}
// כמה אותיות להסיר מתחילת הביטוי כדי שהכותרת תהיה בלי קידומת (ביקורת, סעיף 5): "ותור לרופא" -> "תור לרופא", "לרופא" -> "רופא". 0 כשאין קידומת ("בדיקה" לא מאבדת את ה-ב').
export function eventPrefixLength(words, index) {
  const w = words[index] ?? '';
  const prefix = /^(?:וכש|וש|כש|ו|ש)?(?:ב|ל|מ|כ)?ה?/.exec(w)[0];
  for (let n = prefix.length; n > 0; n -= 1) if (eventAtomLength([w.slice(n), ...words.slice(index + 1)], 0)) return n;
  return 0;
}
const personalEvent = (ctx, i) => {
  if (ctx.channel !== CHANNEL_APP) return 0;
  const event = cached(ctx, 'event', () => findPersonalEvent(ctx));
  return event?.candidates.length > 0 && event.index === i ? event.len : 0;

};

// --- ביטול: "אין שיעור 5 ו-6" ---
// "אין" (ואפשר "אין לנו" / "אין לי" / "אין לכם") + שיעור/ים + מספר שיעור (1 עד 9). בלי מספר ("אין שיעור היום") לא נתפס. "אין שיעור מתמטיקה" אינו נתפס (נשאר כמו שהיה).
const LESSON_NOUN = plainRegex('שיעור|שיעורים');
const NO_DATIVE = plainRegex('ל(?:י|נו|כם|כן)'); // בלי "להם" / "להן": גוף שלישי, לא הכיתה של יובל (ביקורת סבב ב', סעיף 3)
const noLessonNumber = (ctx, i) => {
  if (!NO.test(ctx.words[i])) return 0;
  let j = i + 1;
  if (NO_DATIVE.test(ctx.words[j] ?? '')) j += 1;
  if (!LESSON_NOUN.test(ctx.words[j] ?? '')) return 0;
  j += 1;
  if (ctx.words[j] === 'מספר') j += 1;
  return /^[1-9]$/.test(ctx.words[j] ?? '') ? j - i + 1 : 0;
};

// "מחר אין 8 ו-9" / "אין 5 ו-6 היום" (סבב 3): "אין" ואחריו רצף מספרי שיעור (1 עד 9, מופרדים ב"ו" / "עד" / מקף / פסיק), כשיש בהודעה מילת יום (היום, מחר, מחרתיים, ביום X),
// והרצף בסוף משפט או לפני מילת יום. "אין 8 ו-9 שקלים" ו"אין לי 5 מחברות" לא נתפסים. מחזיר את אינדקס המספר הראשון, או -1. ctx = { words, clean, tokens }.
const DAY_REFERENCE = new RegExp(`^(?:${['היום', 'מחר', 'מחרתיים'].map(fin).join('|')}|[בל]?${fin('יום')})$`);
export function findBareNoLessons(ctx) {
  const { words } = ctx;
  if (!words.some((w) => DAY_REFERENCE.test(w))) return -1;
  for (let i = 0; i + 1 < words.length; i += 1) {
    if (!NO.test(words[i]) || !/^[1-9]$/.test(words[i + 1])) continue;
    let j = i + 1;
    while (j < words.length && (/^[1-9]$/.test(words[j]) || ((words[j] === 'ו' || words[j] === 'עד') && /^[1-9]$/.test(words[j + 1] ?? '')))) j += 1;
    if (j >= words.length || !sameClause(ctx, j - 1, j) || DAY_REFERENCE.test(words[j])) return i + 1;
  }
  return -1;
}
const noBareLessonNumbers = (ctx, i) => (cached(ctx, 'bare', () => findBareNoLessons(ctx)) === i + 1 ? 2 : 0);

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
// "לא יהיה צורך להגיש" / "לא יהיה ביטול" הן שלילה כפולה: "לא יהיה" שאחריו "צורך" או "ביטול" אינו טריגר ביטול (ביקורת 12.10, סעיף 2; חריג-לחריג).
const NEED_OR_CANCELLATION = nounRegex('צורך|ביטול|ביטולים');
function notBe(ctx, i) {
  const { words } = ctx;
  if (!NOT.test(words[i]) || i + 1 >= words.length) return 0;
  const future = FUTURE_BE.test(words[i + 1]);
  const past = PAST_BE.test(words[i + 1]) && !DATIVE.test(words[i + 2] ?? '');
  if (!future && !past) return 0;
  return NEED_OR_CANCELLATION.test(words[i + 2] ?? '') ? 0 : 2;
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
// שחרור עם שעה צמודה = יום מקוצר, אחרת ביטול. סיום/מסיימים: יום מקוצר רק עם שעה צמודה, ומילת סוג של מבחן בהודעה מכריעה נגדו
// ("בסיום המבחן", "מי שסיים"): הסיום שם הוא של המבחן, לא של יום הלימודים (ביקורת 12.10, סעיף 1).
const releaseType = (ctx, i) => (hourAfter(ctx.words, i) ? 'short_day' : 'cancel');
const endType = (ctx, i) => (!ctx.hasExamWord && hourAfter(ctx.words, i) ? 'short_day' : null);

// מילות סוג של מבחן (גם הטריגרים של exam למטה, וגם מי שמכריע נגד "סיום").
const EXAM_NOUNS = [nounRegex('מבחן|מבחנים|מבחני'), nounRegex('בוחן|בוחנים|בוחני'), nounRegex('מתכונת|מתכונות')];

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
  trigger('cancel', 'אין שיעור', noLessonNumber),
  trigger('cancel', 'אין מספר שיעור', noBareLessonNumbers),
  // שחרור: עם שעה = יום מקוצר ("משתחררת בשעה 13:25"), בלי שעה = ביטול ("משוחררים משיעור 6"). 03-intake-rules.md:248,252.
  trigger(releaseType, 'שחרר', verb('שחרר')),

  // הזזה. חזקים: פעלים שאומרים שמשהו זז. חלש: "יתקיים ביום" (יכול להיות גם הודעה ראשונית על מבחן).
  trigger('move', 'דחה', verb('דחה')),
  trigger('move', 'הקדים', verb('הקדים')),
  trigger('move', 'העביר', verb('העביר')),
  trigger('move', 'עבר ל', movedTo),
  trigger('move', 'יתקיים ביום', takesPlaceOnDay, { weak: true }),

  // מבחן
  trigger('exam', 'מבחן', single(EXAM_NOUNS[0])),
  trigger('exam', 'בוחן', single(EXAM_NOUNS[1])),
  trigger('exam', 'מתכונת', single(EXAM_NOUNS[2])),
  trigger('exam', 'מועד ב', secondSitting),

  // חדר
  trigger('room', 'חדר', roomMention),

  // יום מקוצר. "סיום ב[שעה]" ו"מסיימים ב[שעה]": רק עם שעה, אחרת "סיים" אינו יום מקוצר.
  trigger('short_day', 'יום מקוצר', shortDay),
  trigger(endType, 'סיום', endOrEnding),

  // יציאה מוקדמת ואירוע אישי (שלב 8.3-1): ערוץ app בלבד, עם שעה מפורשת.
  trigger('early_leave', 'יציאה מוקדמת', earlyLeave),
  trigger('early_leave', HOME_ROOT, earlyLeaveHome),
  trigger('personal_event', 'אירוע אישי', personalEvent),
];

// עדיפות בין סוגים כשכמה מופיעים יחד (הנחה, לא אומת, ראה למעלה): early_leave > short_day > cancel > move (חזק) > exam > homework > move (חלש) > room > personal_event.
// early_leave גובר על הכול (הכרעת יובל, 8.3-1: "אני הולך מבית הספר ב-13:15 בגלל בדיקה רפואית" הוא יציאה מוקדמת); personal_event אחרון כדי לא לשנות סוג של הודעה שהייתה מסווגת קודם.
// למשל "המבחן נדחה ליום שלישי" = move (מה שהשתנה), "הבוחן בוטל" = cancel, "מבחן בחדר 124" = exam (החדר הוא פרט).
function resolveType(matches, subjectCount) {
  const has = (type, predicate = () => true) => matches.some((m) => m.type === type && predicate(m));
  const countedHomework = (m) => !m.weak || subjectCount > 0; // טריגר חלש בלי מקצוע = רעש
  if (has('early_leave', (m) => m.root !== HOME_ROOT)) return 'early_leave';
  if (has('short_day')) return 'short_day';
  if (has('cancel')) return 'cancel';
  if (has('move', (m) => !m.weak)) return 'move';
  if (has('exam')) return 'exam';
  if (has('homework', countedHomework)) return 'homework';
  // צורת "הולך הביתה מוקדם" (בלי ביטוי בית ספר) חלשה: לא דורסת סוג שהיה קיים לפני ההרחבה (ביקורת סבב ב', סעיף 2: "מחר מסיימים ב-12 ואני הולך הביתה מוקדם" נשאר short_day).
  if (has('early_leave')) return 'early_leave';
  if (has('move')) return 'move';
  if (has('room')) return 'room';
  if (has('personal_event')) return 'personal_event';
  return null;
}

function buildContext(text, channel, allowHome) {
  const { clean, tokens } = tokenize(text);
  const words = tokens.map((token) => token.w);
  const subjects = findSubjectsInWords(words);
  return {
    channel,
    allowHome,
    clean,
    tokens,
    words,
    subjects,
    subjectStarts: new Set(subjects.map((s) => s.index)),
    hasExamWord: words.some((w) => EXAM_NOUNS.some((re) => re.test(w))),
  };
}

// --- שלילה והקשר שאינו אירוע (ביקורת 12.10, סעיפים 2 ו-9) ---
// טריגר שנפסל ("ignored") נשאר ברשימת ההתאמות, כדי ש-fellThroughRoots לא יחשיב את המילה שלו כמילת תוכן, אבל אינו משתתף בסיווג.
const CLAUSE_BREAK = /[,;:!?\n]|\.(?:\s|$)/;
// האם מילים from..to (אינדקסים) באותו משפט: אין סימן פיסוק בין מילה למילה.
function sameClause(ctx, from, to) {
  for (let k = from; k < to; k += 1) {
    if (CLAUSE_BREAK.test(ctx.clean.slice(ctx.tokens[k].end, ctx.tokens[k + 1].start))) return false;
  }
  return true;
}

// שלילה: "לא" / "אין" (גם ולא, שלא, ואין) שקדמו לטריגר ביטול או הזזה עד שתי מילים לפניו, באותו משפט, מבטלים את הטריגר
// ("ולא בוטל", "לא נדחה", "אין ביטול"). לא נשללים: "לא יהיה" / "לא יתקיימו" / "לא היה" (הם עצמם ביטול), "אין [מקצוע]" ושחרור.
// [הנחה, לא אומת] הטווח (שתי מילים ביניהם) והסייג של פיסוק הם של Claude. "לא" רחוק יותר ("לא ידוע לנו אם השיעור בוטל") אינו שולל.
const NEGATOR = new RegExp(`^(?:וש|ו|ש)?(?:לא|${fin('אין')})$`);
const NEGATION_REACH = 3;
const NEGATABLE_CANCEL_ROOTS = new Set(['ביטל', 'ביטול']);
// early_leave ו-personal_event נשללים גם הם ("אני לא הולך מהבית ספר ב-13:15", "אין לי תור ב-16:00").
const isNegatable = (m) => m.type === 'move' || m.type === 'early_leave' || m.type === 'personal_event' || (m.type === 'cancel' && NEGATABLE_CANCEL_ROOTS.has(m.root));
function isNegated(ctx, m) {
  for (let n = m.index - 1; n >= Math.max(0, m.index - NEGATION_REACH); n -= 1) {
    if (NEGATOR.test(ctx.words[n]) && sameClause(ctx, n, m.index)) return true;
  }
  return false;
}

// הקשר שאינו אירוע: "תוצאות המבחן", "ציוני הבוחן", "המבחן פורסם", "חזרה לקראת המבחן". מילת הקשר עד שתי מילים לפני או אחרי מילת הסוג, באותו משפט, פוסלת את הטריגר.
// "לקראת" ו"חזרה" רק לפני מילת הסוג ("יש מבחן לקראת סוף השבוע" נשאר מבחן). [הנחה, לא אומת] הרשימה והטווח הם של Claude; הכיוון הבטוח הוא לא להסיק.
const PUBLISH_VERB = new RegExp(`^${CLITIC.verb}(?:${fin('(?:י|ת|נ|א|מ)?(?:ת)?(?:פורסם|פרסם)(?:ו|ה|ות|ים|ת)?')})$`);
const RESULT_WORDS = [nounRegex('תוצאות|תוצאה|תוצאת'), nounRegex('ציון|ציונים|ציוני'), nounRegex('פרסום'), PUBLISH_VERB];
const PREPARATION_WORDS = [plainRegex('(?:וכש|וש|כש|ו|ש)?לקראת'), nounRegex('חזרה')];
const CONTEXT_REACH = 2;
function isNonEventContext(ctx, m) {
  const last = m.index + m.length - 1;
  for (let d = 1; d <= CONTEXT_REACH; d += 1) {
    const before = m.index - d;
    if (before >= 0 && sameClause(ctx, before, m.index) && [...RESULT_WORDS, ...PREPARATION_WORDS].some((re) => re.test(ctx.words[before]))) return true;
    const after = last + d;
    if (after < ctx.words.length && sameClause(ctx, last, after) && RESULT_WORDS.some((re) => re.test(ctx.words[after]))) return true;
  }
  return false;
}

function collectMatches(ctx) {
  const matches = [];
  for (let i = 0; i < ctx.words.length; i += 1) {
    for (const t of TRIGGERS) {
      const length = t.test(ctx, i);
      if (!length) continue;
      const type = typeof t.type === 'function' ? t.type(ctx, i) : t.type;
      if (type) matches.push({ type, root: t.root, weak: t.weak, index: i, length, ignored: false });
    }
  }
  for (const m of matches) m.ignored = (isNegatable(m) && isNegated(ctx, m)) || (m.type === 'exam' && isNonEventContext(ctx, m));
  return matches;
}

// מחזיר { type, roots, matchedTypes, typeEnd } או null. matchedTypes: כל הסוגים שנמצאו להם טריגרים (למי שרוצה לדעת על עמימות), כשורשים לכל סוג.
// typeEnd: אינדקס המילה האחרונה של הטריגר הראשון של הסוג שנקבע (מילת הסוג בטקסט, לשימוש חילוץ הנושא ב-lib/intake-facts.js), או -1.
// channel (אופציונלי, שלב 8.3-1): 'app' מפעיל גם את early_leave ו-personal_event; בלעדיו או בערוץ אחר הם לא נתפסים.
export function classifyAll(text, { channel, allowHome = true } = {}) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const ctx = buildContext(text, channel, allowHome);
  const matches = collectMatches(ctx).filter((m) => !m.ignored);
  let type = resolveType(matches, ctx.subjects.length);
  if (type === null) return null;
  // "עבר/הועבר לחדר 124" בלי שום מועד חדש = שינוי חדר, לא הזזה בזמן.
  if (type === 'move' && matches.some((m) => m.type === 'room') && !hasTemporal(ctx.words)) type = 'room';

  const counted = (m) => m.type !== 'homework' || !m.weak || ctx.subjects.length > 0;
  const rootsOf = (wanted) => [...new Set(matches.filter((m) => m.type === wanted && (wanted !== type || counted(m))).map((m) => m.root))];
  const matchedTypes = {};
  for (const wanted of new Set(matches.map((m) => m.type))) matchedTypes[wanted] = rootsOf(wanted);
  const first = matches.find((m) => m.type === type && counted(m));
  return { type, roots: rootsOf(type), matchedTypes, typeEnd: first ? first.index + first.length - 1 : -1 };
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
  const ctx = buildContext(text);
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
