// המרת תאריכים בצינור הקליטה (שלב 8.2, קוד בלבד): "היום", "מחר", "מחרתיים", שם יום, ותאריך מפורש, לתאריך לוח (YYYY-MM-DD).
// מקור: docs/02-rules/03-intake-rules.md:39,54-64 ("'מחר' בהודעה שהועברה") ו-docs/17 / build-rules 30,32 ("'מחר' אינו '+24 שעות'", בלי תאריכי DST בקוד).
// פונקציות טהורות: בלי מסד, בלי רשת, בלי מודל.
//
// איך זה נכון סביב חצות ושעון חורף: חותמת הקליטה מומרת לתאריך המקומי (שנה/חודש/יום) בעזרת Intl (localParts מ-lib/schedule-time.js),
// ומשם החשבון הוא חשבון ימי לוח טהור (Date.UTC על שנה/חודש/יום, בלי שעות), כך ש"מחר" הוא תמיד היום הבא בלוח גם ביום של 25 שעות.
//
// הנחות שהמסמכים לא קובעים, כולן [הנחה, לא אומת] ושקל להפוך:
//  - "ההודעה מהיום" (כלל הקיצור, 03-intake-rules.md:60): התאריך היחסי נמדד מחותמת הקליטה.
//  - שם יום ("ביום שלישי") = המופע הקרוב העתידי בהחלט: אם היום כבר יום שלישי, זה שלישי בעוד שבוע.
//  - "יום X הבא" = שני מועמדים (הקרוב ועוד 7 ימים) ולכן ambiguous. "יום X בשבוע הבא" = היום ב-X בשבוע (ראשון עד שבת) שאחרי השבוע הנוכחי, בלי עמימות.
//  - תאריך מפורש בלי שנה: ההופעה הקרובה מהיום והלאה (היום עצמו נחשב; אם עבר השנה, השנה הבאה). "D.M" הוא יום.חודש (פורמט ישראלי). [ביקורת 12.10, סעיף 5]
//  - מספר עשרוני אחרי פרק/סעיף/תרגיל/יחידה/עמוד/שאלה/משימה ("פרק 2.3", "תרגילים 2.1 עד 2.5") אינו תאריך. [ביקורת 12.10, סעיף 4]
//  - "ביום שלישי בעוד שבועיים" = ההופעה הקרובה של היום בשבוע + 7 × מספר השבועות; "ביום שלישי שעבר" אינו מייצר תאריך. [ביקורת 12.10, סעיף 7]
//  - שם יום ותאריך מפורש צמודים שלא מסכימים ("ביום שלישי 7.10" כשה-7.10 הוא ביום רביעי) = ambiguous עם שני המועמדים (המפורש ראשון).
//  - לא נבנה כאן "השיעור הבא" (שלב 8.6) ולא "אתמול".
//
// זהירות: tokenize מנרמל אותיות סופיות (יום = יומ, ראשון = ראשונ). כל השוואה למילה עברית עם ך/ם/ן/ף/ץ חייבת לעבור דרך fin().
import { tokenize, fin } from './intake-text.js';
import { localParts } from './schedule-time.js';

// לפי Date.getUTCDay: 0 = ראשון ... 6 = שבת. (במערכת השעות 1 = ראשון, כלומר getDay + 1.)
export const WEEKDAY_NAMES = Object.freeze(['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']);

const pad = (number, width = 2) => String(number).padStart(width, '0');
export const isoOf = (year, month, day) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidCivil(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseIso(iso) {
  const match = ISO.exec(String(iso));
  if (!match) throw new RangeError(`parseIso: תאריך לא תקין: ${iso}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (!isValidCivil(year, month, day)) throw new RangeError(`parseIso: תאריך לא קיים: ${iso}`);
  return { year, month, day };
}

// חשבון ימי לוח: מוסיף n ימים לתאריך YYYY-MM-DD, בלי שעות ובלי אזור זמן.
export function addDays(iso, n) {
  const { year, month, day } = parseIso(iso);
  const date = new Date(Date.UTC(year, month - 1, day + n));
  return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

// 0 = ראשון ... 6 = שבת.
export function weekdayOf(iso) {
  const { year, month, day } = parseIso(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const daysBetween = (fromIso, toIso) => {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86400000);
};

// "6.10" (בלי אפסים מובילים) ו-"6.10.2026".
export function formatDayMonth(iso) {
  const { month, day } = parseIso(iso);
  return `${day}.${month}`;
}
export function formatFullDate(iso) {
  const { year, month, day } = parseIso(iso);
  return `${day}.${month}.${year}`;
}

function toInstant(receivedAt) {
  const date = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(date.getTime())) throw new RangeError('receivedAt חייב להיות תאריך תקין (Date, מחרוזת ISO או מספר)');
  return date;
}

// התאריך המקומי (YYYY-MM-DD) של רגע נתון באזור הזמן. זורק RangeError על receivedAt או אזור זמן לא תקינים.
export function localDateIso(receivedAt, timezone = 'Asia/Jerusalem') {
  const parts = localParts(toInstant(receivedAt), timezone);
  return isoOf(parts.year, parts.month, parts.day);
}

// --- זיהוי אזכורי תאריך ---
const CLITIC = '(?:וכש|וש|כש|ו|ש)?';
const REL_WORDS = [
  { re: new RegExp(`^${CLITIC}(ל)?מחר$`), offset: 1 },
  { re: new RegExp(`^${CLITIC}(ל)?${fin('מחרתיים')}$`), offset: 2 },
  { re: new RegExp(`^${CLITIC}()${fin('היום')}$`), offset: 0 },
];
const YOM = new RegExp(`^${CLITIC}([בלמ])?${fin('יום')}$`);
const BARE_DAY = new RegExp(`^${CLITIC}([בל])(${['ראשון', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(fin).join('|')})$`);
const DAY_BY_WORD = new Map(WEEKDAY_NAMES.map((name, index) => [fin(name), index]));
const DAY_BY_LETTER = new Map([['א', 0], ['ב', 1], ['ג', 2], ['ד', 3], ['ה', 4], ['ו', 5], ['ש', 6]]);
const WEEK_WORD = /^(?:ב|ל|ה)?שבוע$/;
const EXPLICIT = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/;
const MONEY_OR_PERCENT = new RegExp(`^(?:${['שקל', 'שקלים', 'שח', 'אחוז', 'אחוזים', 'מל', 'גרם'].map(fin).join('|')})$`);

const dirOfClitic = (letter) => (letter === 'ל' ? 'to' : letter === 'מ' ? 'from' : null);

// --- מספרי פרק, סעיף ותרגיל: נראים כמו D.M אבל אינם תאריך (ביקורת 12.10, סעיף 4) ---
const SECTION_WORD = new RegExp(`^${CLITIC}(?:ב|ל|מ|כ)?ה?(?:${['פרק', 'פרקים', 'סעיף', 'סעיפים', 'תרגיל', 'תרגילים', 'יחידה', 'יחידות', 'עמוד', 'עמודים', 'שאלה', 'שאלות', 'משימה', 'משימות'].map(fin).join('|')})$`);
const NUMBER_WORD = /^\d+(?:[./]\d+)*$/;

// אינדקסי המילים שהם מספרי פרק/סעיף/תרגיל: המספר שאחרי מילת סעיף, והמשכו ברשימה או בטווח ("2.1 עד 2.5", "2.1 ו-2.3", "2.1-2.5").
function sectionNumberIndexes(words, clean, tokens) {
  const found = new Set();
  const hyphenBetween = (a, b) => /^[ \t]*[-־–][ \t]*$/.test(clean.slice(tokens[a].end, tokens[b].start));
  for (let k = 0; k < words.length; k += 1) {
    if (!SECTION_WORD.test(words[k])) continue;
    let j = k + 1;
    if (words[j] === 'מספר') j += 1;
    while (j < words.length && NUMBER_WORD.test(words[j])) {
      found.add(j);
      if ((words[j + 1] === 'עד' || words[j + 1] === 'ו') && j + 2 < words.length) j += 2;
      else if (j + 1 < words.length && hyphenBetween(j, j + 1)) j += 1;
      else break;
    }
  }
  return found;
}

// --- "בעוד שבועיים" ו"שעבר" ליד שם יום (ביקורת 12.10, סעיף 7) ---
const WEEK_COUNT_WORDS = new Map([['שלושה', 3], ['שלוש', 3], ['ארבעה', 4], ['ארבע', 4], ['חמישה', 5], ['חמש', 5], ['שישה', 6], ['שש', 6]]);
const countOf = (w) => (/^\d+$/.test(w ?? '') ? Number(w) : WEEK_COUNT_WORDS.get(w));
const validWeeks = (n) => Number.isInteger(n) && n >= 1 && n <= 52;
// "בעוד X" שמתחיל במילה at (אחרי שם היום): { weeks, length } (length = מספר המילים); weeks null = "בעוד" בלי כמות מזוהה ("בעוד שעה", "בעוד שבעה שבועות"); null = אין "בעוד".
function readWeeksAfter(words, at) {
  if (words[at] !== 'בעוד') return null;
  const first = words[at + 1];
  if (first === 'שבוע') return { weeks: 1, length: 2 };
  if (first === fin('שבועיים')) return { weeks: 2, length: 2 };
  const count = countOf(first);
  if (validWeeks(count) && (words[at + 2] === 'שבועות' || words[at + 2] === 'שבוע')) return { weeks: count, length: 3 };
  return { weeks: null, length: 1 };
}
// "בעוד שבועיים" / "בעוד 3 שבועות" שנגמר במילה end (לפני שם היום): { weeks, length } או null. כמות לא מזוהה לפני שם היום אינה פוסלת (אין לה קשר ודאי ליום).
function readWeeksBefore(words, end) {
  if (words[end] === 'שבוע' && words[end - 1] === 'בעוד') return { weeks: 1, length: 2 };
  if (words[end] === fin('שבועיים') && words[end - 1] === 'בעוד') return { weeks: 2, length: 2 };
  if (words[end] === 'שבועות' && words[end - 2] === 'בעוד' && validWeeks(countOf(words[end - 1]))) return { weeks: countOf(words[end - 1]), length: 3 };
  return null;
}
// "שעבר" / "הקודם" אחרי שם יום, או "בשבוע שעבר": מספר המילים שנצרכו (0 = אין).
const PAST_WORD = new RegExp(`^(?:${['שעבר', 'שעברה', 'הקודם', 'הקודמת'].map(fin).join('|')})$`);
const pastWords = (words, at) => {
  if (PAST_WORD.test(words[at] ?? '')) return 1;
  return /^(?:ב|ה)?שבוע$/.test(words[at] ?? '') && PAST_WORD.test(words[at + 1] ?? '') ? 2 : 0;
};

// התאריך הקרוב (בעתיד, בהחלט) ביום שבוע target.
function nearestWeekday(todayIso, target) {
  const ahead = ((target - weekdayOf(todayIso) + 7) % 7) || 7;
  return addDays(todayIso, ahead);
}

// השנה של תאריך (חודש/יום) בלי שנה: ההופעה הקרובה מהיום והלאה (היום עצמו נחשב), כלומר השנה הבאה אם עבר השנה (ביקורת 12.10, סעיף 5).
// [הנחה, לא אומת] הכיוון נבחר כי הודעה על אירוע מדברת על העתיד; הודעה על תאריך שחלף זה עתה ("ב-10.10" ביום 11.10) תיקרא כשנה הבאה,
// והמערכת עונה "נרשם" עם התאריך והיום המלאים כדי שהטעות תיראה. עד 8 שנים קדימה בגלל 29.2.
function pickYear(todayIso, month, day) {
  const startYear = parseIso(todayIso).year;
  for (let year = startYear; year <= startYear + 8; year += 1) {
    if (isValidCivil(year, month, day) && isoOf(year, month, day) >= todayIso) return year;
  }
  return null;
}

// הפונקציה הפנימית: מחזירה גם אזכורי תאריך וגם דגל "לשבוע הבא" (בלי יום), לשימוש lib/intake-facts.js.
export function analyzeDates(text, receivedAt, { timezone = 'Asia/Jerusalem' } = {}) {
  const todayIso = localDateIso(receivedAt, timezone);
  const todayWeekday = weekdayOf(todayIso);
  const { clean, tokens } = tokenize(typeof text === 'string' ? text : '');
  const words = tokens.map((token) => token.w);
  const sectionNumbers = sectionNumberIndexes(words, clean, tokens);
  const parts = [];

  // האם אחרי המילה i בא מקף (ב-12:00 = "ב" כקידומת, לא "יום ב'")
  const hyphenAfter = (i) => /^[ \t]*[-־–]/.test(clean.slice(tokens[i].end, tokens[i].end + 3));
  // האם יש סימן פיסוק של סוף משפט או סעיף בין המילה a למילה b (a < b): "ביום שלישי, בעוד שבועיים בוחן" = "בעוד שבועיים" שייך למשפט הבא.
  const clauseBreakBetween = (a, b) => a >= 0 && b < tokens.length && /[,;:!?\n]|\.(?:\s|$)/.test(clean.slice(tokens[a].end, tokens[b].start));
  const gapOnlyLinks = (i, j) => /^[\s\-־–]*$/.test(clean.slice(tokens[i].end, tokens[j].start));

  for (let i = 0; i < tokens.length; i += 1) {
    const w = words[i];

    for (const { re, offset } of REL_WORDS) {
      const match = re.exec(w);
      if (match) parts.push({ kind: 'rel', start: i, end: i, date: addDays(todayIso, offset), origin: 'inferred', ambiguous: false, dir: dirOfClitic(match[1]), conj: w.startsWith('ו') });
    }

    const explicit = EXPLICIT.exec(w);
    if (explicit && !sectionNumbers.has(i) && !(w.includes('.') && /^(?:ב)?שעה$/.test(words[i - 1] ?? '')) && !MONEY_OR_PERCENT.test(words[i + 1] ?? '')) {
      const day = Number(explicit[1]);
      const month = Number(explicit[2]);
      let year = explicit[3] === undefined ? null : Number(explicit[3]);
      if (year !== null && year < 100) year += 2000;
      if (year === null) year = pickYear(todayIso, month, day);
      if (year !== null && month >= 1 && month <= 12 && isValidCivil(year, month, day)) {
        const prev = words[i - 1];
        const dir = (prev === 'ל' || prev === 'עד') && gapOnlyLinks(i - 1, i) ? 'to' : prev === 'מ' && gapOnlyLinks(i - 1, i) ? 'from' : null;
        parts.push({ kind: 'explicit', start: i, end: i, date: isoOf(year, month, day), origin: 'read', ambiguous: false, dir });
      }
    }

    // שם יום: "ביום שלישי", "ליום ג'", או "בראשון" (רק עם ב'/ל').
    let target = null;
    let dayDir = null;
    let last = i;
    const yom = YOM.exec(w);
    if (yom && i + 1 < tokens.length) {
      const next = words[i + 1];
      if (DAY_BY_WORD.has(next)) target = DAY_BY_WORD.get(next);
      else if (DAY_BY_LETTER.has(next) && !hyphenAfter(i + 1)) target = DAY_BY_LETTER.get(next);
      if (target !== null) {
        dayDir = dirOfClitic(yom[1]);
        last = i + 1;
      }
    } else {
      const bare = BARE_DAY.exec(w);
      if (bare) {
        target = DAY_BY_WORD.get(bare[2]);
        dayDir = dirOfClitic(bare[1]);
      }
    }
    if (target !== null) {
      let start = i;
      let modifier = null;
      const after = words[last + 1];
      if (after === 'הבא' || after === 'הבאה') { modifier = 'next'; last += 1; }
      else if (after === 'הקרוב' || after === 'הקרובה') { modifier = 'nearest'; last += 1; }
      else if (WEEK_WORD.test(after ?? '') && words[last + 2] === 'הבא') { modifier = 'nextWeek'; last += 2; }
      else if (words[i - 1] === 'הבא' && WEEK_WORD.test(words[i - 2] ?? '')) { modifier = 'nextWeek'; start = i - 2; }
      // "בעוד שבועיים" ו"שעבר" (ביקורת 12.10, סעיף 7): רק בלי "הבא"/"הקרוב"/"בשבוע הבא". "שעבר", וגם "בעוד" בלי כמות מזוהה: אין תאריך, והשדה חסר.
      let weeksAhead = 0;
      let undated = false;
      if (modifier === null) {
        const sameClauseAfter = !clauseBreakBetween(last, last + 1);
        const forward = sameClauseAfter ? readWeeksAfter(words, last + 1) : null;
        const backward = forward || clauseBreakBetween(i - 1, i) ? null : readWeeksBefore(words, i - 1);
        const past = forward || backward || !sameClauseAfter ? 0 : pastWords(words, last + 1);
        if (forward) {
          if (forward.weeks === null) undated = true;
          else weeksAhead = forward.weeks;
          last += forward.length;
        } else if (backward) {
          weeksAhead = backward.weeks;
          start = i - backward.length;
        } else if (past > 0) {
          undated = true;
          last += past;
        }
      }
      if (!undated) {
        const nearest = nearestWeekday(todayIso, target);
        const part = { kind: 'weekday', start, end: last, origin: 'inferred', dir: dayDir, weekday: target, conj: w.startsWith('ו') };
        if (modifier === 'next') Object.assign(part, { date: nearest, ambiguous: true, candidates: [nearest, addDays(nearest, 7)] });
        else if (modifier === 'nextWeek') Object.assign(part, { date: addDays(addDays(todayIso, 7 - todayWeekday), target), ambiguous: false });
        else if (weeksAhead > 0 && target === todayWeekday) {
          // אותו יום בשבוע כמו היום: "ביום ראשון בעוד שבועיים" ביום ראשון הוא היום + 14, אבל ההופעה הקרובה של "ראשון" כבר בעוד שבוע. שואלים. [הנחה, לא אומת]
          const sameWeekday = addDays(todayIso, 7 * weeksAhead);
          Object.assign(part, { date: sameWeekday, ambiguous: true, candidates: [sameWeekday, addDays(nearest, 7 * weeksAhead)] });
        } else {
          Object.assign(part, { date: addDays(nearest, 7 * weeksAhead), ambiguous: false });
        }
        parts.push(part);
      }
      i = last; // המילים של שם היום נצרכו
    }
  }

  parts.sort((a, b) => a.start - b.start || a.end - b.end);
  const mentions = mergeAdjacent(parts);

  const consumed = (index) => mentions.some((m) => index >= m.start && index <= m.end);
  const weekShift = words.some((w, i) => /^(?:ב|ל)שבוע$/.test(w) && words[i + 1] === 'הבא' && !consumed(i) && !consumed(i + 1));
  return { todayIso, mentions, weekShift };
}

// אזכור יום-בשבוע מתאים לתאריך אם התאריך נופל באותו יום בשבוע (גם אם הוא בעבר); שאר האזכורים צריכים להיות אותו תאריך בדיוק.
const fits = (part, date) => (part.kind === 'weekday' ? weekdayOf(date) === part.weekday : part.date === date);

// אזכורים צמודים של אותו תאריך ("מחר ביום שלישי", "ביום שלישי 6.10") מתמזגים לאזכור אחד. אם הם לא מסכימים: ambiguous.
// צמוד = בלי מילה ביניהם, ובלי כיוון סותר (מ... ל...).
function mergeAdjacent(parts) {
  const clusters = [];
  for (const part of parts) {
    const current = clusters.at(-1);
    const prev = current?.at(-1);
    const sameDirection = !(prev && part.dir && prev.dir && part.dir !== prev.dir);
    const kinds = new Set([prev?.kind, part.kind]);
    // ו' מחברת ("ליום ראשון ולמחרתיים") = שני תאריכים נפרדים, לא אותו תאריך שנכתב פעמיים
    if (prev && part.start === prev.end + 1 && sameDirection && kinds.size === 2 && !part.conj) current.push(part);
    else clusters.push([part]);
  }
  return clusters.map((cluster) => {
    if (cluster.length === 1) return cluster[0];
    const anchor = cluster.find((p) => p.kind === 'explicit') ?? cluster.find((p) => p.kind === 'rel') ?? cluster[0];
    const conflicting = cluster.filter((p) => p !== anchor && !fits(p, anchor.date));
    const merged = { kind: anchor.kind, start: cluster[0].start, end: cluster.at(-1).end, date: anchor.date, origin: anchor.origin, dir: cluster.find((p) => p.dir)?.dir ?? null, ambiguous: false };
    if (conflicting.length > 0) {
      merged.ambiguous = true;
      merged.candidates = [...new Set([anchor.date, ...conflicting.map((p) => p.date)])];
    }
    return merged;
  });
}

// כל אזכורי התאריך בהודעה, לפי הסדר בטקסט. כל איבר: { date, origin, ambiguous, candidates?, start, end, dir }.
// start/end = אינדקסי מילים בטקסט; dir = 'to' (ל...), 'from' (מ...) או null.
export function resolveDates(text, receivedAt, options) {
  return analyzeDates(text, receivedAt, options).mentions.map((m) => {
    const out = { date: m.date, origin: m.origin, ambiguous: m.ambiguous, start: m.start, end: m.end, dir: m.dir };
    if (m.ambiguous) out.candidates = [...m.candidates];
    return out;
  });
}

// האזכור הראשון בהודעה: { date, origin: 'read' | 'inferred', ambiguous, candidates? } או null.
export function resolveDate(text, receivedAt, options) {
  const first = analyzeDates(text, receivedAt, options).mentions[0];
  if (!first) return null;
  return first.ambiguous
    ? { date: first.date, origin: first.origin, ambiguous: true, candidates: [...first.candidates] }
    : { date: first.date, origin: first.origin, ambiguous: false };
}
