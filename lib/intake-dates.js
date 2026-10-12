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
//  - תאריך מפורש בלי שנה: השנה שהתאריך שלה הכי קרוב לחותמת הקליטה. "D.M" הוא יום.חודש (פורמט ישראלי).
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

// התאריך הקרוב (בעתיד, בהחלט) ביום שבוע target.
function nearestWeekday(todayIso, target) {
  const ahead = ((target - weekdayOf(todayIso) + 7) % 7) || 7;
  return addDays(todayIso, ahead);
}

// השנה שהתאריך (חודש/יום) שלה הכי קרוב לתאריך הקליטה.
function pickYear(todayIso, month, day) {
  const today = parseIso(todayIso);
  let best = null;
  for (const year of [today.year - 1, today.year, today.year + 1]) {
    if (!isValidCivil(year, month, day)) continue;
    const distance = Math.abs(daysBetween(todayIso, isoOf(year, month, day)));
    if (best === null || distance < best.distance) best = { year, distance };
  }
  return best?.year ?? null;
}

// הפונקציה הפנימית: מחזירה גם אזכורי תאריך וגם דגל "לשבוע הבא" (בלי יום), לשימוש lib/intake-facts.js.
export function analyzeDates(text, receivedAt, { timezone = 'Asia/Jerusalem' } = {}) {
  const todayIso = localDateIso(receivedAt, timezone);
  const todayWeekday = weekdayOf(todayIso);
  const { clean, tokens } = tokenize(typeof text === 'string' ? text : '');
  const words = tokens.map((token) => token.w);
  const parts = [];

  // האם אחרי המילה i בא מקף (ב-12:00 = "ב" כקידומת, לא "יום ב'")
  const hyphenAfter = (i) => /^[ \t]*[-־–]/.test(clean.slice(tokens[i].end, tokens[i].end + 3));
  const gapOnlyLinks = (i, j) => /^[\s\-־–]*$/.test(clean.slice(tokens[i].end, tokens[j].start));

  for (let i = 0; i < tokens.length; i += 1) {
    const w = words[i];

    for (const { re, offset } of REL_WORDS) {
      const match = re.exec(w);
      if (match) parts.push({ kind: 'rel', start: i, end: i, date: addDays(todayIso, offset), origin: 'inferred', ambiguous: false, dir: dirOfClitic(match[1]), conj: w.startsWith('ו') });
    }

    const explicit = EXPLICIT.exec(w);
    if (explicit && !(w.includes('.') && /^(?:ב)?שעה$/.test(words[i - 1] ?? '')) && !MONEY_OR_PERCENT.test(words[i + 1] ?? '')) {
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
      const nearest = nearestWeekday(todayIso, target);
      const part = { kind: 'weekday', start, end: last, origin: 'inferred', dir: dayDir, weekday: target, conj: w.startsWith('ו') };
      if (modifier === 'next') Object.assign(part, { date: nearest, ambiguous: true, candidates: [nearest, addDays(nearest, 7)] });
      else if (modifier === 'nextWeek') Object.assign(part, { date: addDays(addDays(todayIso, 7 - todayWeekday), target), ambiguous: false });
      else Object.assign(part, { date: nearest, ambiguous: false });
      parts.push(part);
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
