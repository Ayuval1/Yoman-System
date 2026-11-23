// God Mode, סקירה במצב חריג (בלוק 8, פריט 14; docs/01-foundation/אפיון-מורחב.md:155; אפיון.md סעיף 4: מביא כרטיס עם ממצאים ואפשרויות, לא מחליט ולא מבצע).
// הכרעת יובל (01-system-overview.md, ש4 = א', 23.11.2026): מתחילים בשני מקרים בלבד:
//  1. מבחן שהוקדם (שינוי בלוח שנקלט מהודעה, lib/event-match.js -> loadExamChanges, ומועד חדש מוקדם מהמקורי).
//  2. שבוע (ראשון עד שבת) עם יותר משני מבחנים, בטווח של 14 יום קדימה (03-analysis-rules.md:532, האופק של הקוד).
//
// החלוקה (CLAUDE.md): הממצאים והאפשרויות נבנים בקוד, ולכן הכרטיס עובד גם בלי AI. המוח מוסיף לכל היותר שורת אפשרות אחת, רק כשיש מודל שעבר את השער
// (בלי פיילוט, כדי לא לשחוק מכסה חינמית על תוספת), עם בדיקת פורמט בקוד. כשל או תשובה לא בפורמט = הכרטיס בלי השורה.
// קריאה בלבד: אין כתיבה ליומן, אין שינוי בלוח, אין כפתור שמבצע. הכרטיס הוא הודעת עדכון (kind='update'), פעם אחת לכל ממצא
// (עובדה 'finding' ב-facts, entity_type='god_mode'), בלי טבלה חדשה.
// [הנחה, לא אומת] מתי: בבריף של 07:30 (api/queues/deliver.js). מבחן שהוקדם נאמר בבריף שאחרי הקליטה, לא מיד.
// פרטיות: בפרומפט למוח רק סוג, מקצוע ותאריך מהלוח. בלי טקסט של הודעות.
import { randomUUID } from 'node:crypto';
import { EXAMS } from './exam-line.js';
import { addDays, weekdayOf, formatDayMonth, WEEKDAY_NAMES } from './intake-dates.js';

export const GOD_MODE_ENTITY = 'god_mode';
export const HORIZON_DAYS = 14;
export const BUSY_WEEK_MIN = 3; // "יותר משני מבחנים"
const AI_TIMEOUT_MS = 8000; // הנחה, לא אומת
const AI_MAX_CHARS = 140;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const rowsOf = (result) => (Array.isArray(result) ? result : []);
const dayLabel = (date) => `${WEEKDAY_NAMES[weekdayOf(date)]} ${formatDayMonth(date)}`;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const label = (exam) => `${exam.type} ב${exam.subject}`;
const sundayOf = (date) => addDays(date, -weekdayOf(date));

// מבחנים שהוקדמו ושעוד לא עברו. changes: loadExamChanges (האחרון לכל מבחן גובר, כמו applyExamChanges).
export function movedEarlier({ todayIso, changes = [], exams = EXAMS }) {
  const last = new Map();
  for (const change of Array.isArray(changes) ? changes : []) if (typeof change?.link === 'string') last.set(change.link, change);
  const out = [];
  for (const [link, change] of last) {
    if (change.type !== 'move' || !ISO_DAY.test(change.newDate ?? '')) continue;
    const exam = exams.find((e) => e?.makeup !== true && `exam:${e.date}:${e.subject}` === link);
    if (!exam || !(change.newDate < exam.date) || change.newDate <= todayIso) continue;
    out.push({ kind: 'moved', key: `moved:${link}:${change.newDate}`, exam: { ...exam, date: change.newDate }, from: exam.date, to: change.newDate });
  }
  return out.sort((a, b) => (a.to < b.to ? -1 : 1));
}

// שבועות עם BUSY_WEEK_MIN מבחנים ומעלה, ששבוע מהם מתחיל עד HORIZON_DAYS קדימה ויש בו מבחן שעוד לא עבר. exams: אחרי applyExamChanges.
export function busyWeeks({ todayIso, exams = EXAMS }) {
  const horizon = addDays(todayIso, HORIZON_DAYS);
  const weeks = new Map();
  for (const exam of Array.isArray(exams) ? exams : []) {
    if (!exam || exam.makeup === true || exam.postponed === true || typeof exam.subject !== 'string' || !ISO_DAY.test(exam.date ?? '')) continue;
    const sunday = sundayOf(exam.date);
    if (sunday > horizon || addDays(sunday, 6) < todayIso) continue;
    weeks.set(sunday, [...(weeks.get(sunday) ?? []), exam]);
  }
  const out = [];
  for (const [sunday, list] of weeks) {
    const upcoming = list.filter((exam) => exam.date >= todayIso);
    if (list.length < BUSY_WEEK_MIN || upcoming.length === 0) continue;
    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    out.push({ kind: 'busy_week', key: `busy-week:${sunday}:${sorted.length}`, sunday, exams: sorted });
  }
  return out.sort((a, b) => (a.sunday < b.sunday ? -1 : 1));
}

// הכרטיס בקוד: כותרת, ממצאים, אפשרויות, ושורת "לא שיניתי כלום". extra: שורת אפשרות מהמוח (אחרי בדיקה), או null.
export function cardText(finding, { todayIso, extra = null } = {}) {
  const lines = [];
  if (finding.kind === 'moved') {
    const left = daysBetween(todayIso, finding.to);
    lines.push('סקירה: מבחן הוקדם');
    lines.push(`${label(finding.exam)} הוקדם מ${dayLabel(finding.from)} ל${dayLabel(finding.to)} (${left === 1 ? 'עוד יום אחד' : `עוד ${left} ימים`}).`);
    lines.push('אפשרויות:');
    lines.push('· לאשר תוכנית למידה חדשה כשתוצע בבריף');
    lines.push('· לבטל בצ\'אט למידה שנקבעה למועד הישן');
    lines.push('· להשאיר כמו שזה');
  } else {
    lines.push(`סקירה: ${finding.exams.length} מבחנים בשבוע של ${formatDayMonth(finding.sunday)}`);
    for (const exam of finding.exams) lines.push(`· ${dayLabel(exam.date)}: ${label(exam)}`);
    lines.push('אפשרויות:');
    lines.push(`· להתחיל ללמוד מוקדם יותר ל${label(finding.exams.find((e) => e.date >= todayIso) ?? finding.exams[0])}`);
    lines.push('· לפנות בצ\'אט ערבים בשבוע הזה');
    lines.push('· להשאיר כמו שזה');
  }
  if (extra) lines.push(`· ${extra}`);
  lines.push('לא שיניתי כלום ביומן.');
  return lines.join('\n');
}

// בדיקת הפורמט של תוספת המוח: { extra_option: string | null }, עד AI_MAX_CHARS, בעברית, בלי קישורים ובלי שורה חדשה.
export function validExtra(data) {
  if (!data || typeof data !== 'object' || !Object.hasOwn(data, 'extra_option')) return false;
  const value = data.extra_option;
  if (value === null) return true;
  return typeof value === 'string' && value.trim() !== '' && value.length <= AI_MAX_CHARS && /[א-ת]/.test(value) && !/[\n\r]|https?:|www\./i.test(value);
}

export function aiPrompt(finding, todayIso) {
  const facts = finding.kind === 'moved'
    ? `מבחן הוקדם: ${label(finding.exam)}, מ-${finding.from} ל-${finding.to}. היום ${todayIso}.`
    : `שבוע עם ${finding.exams.length} מבחנים: ${finding.exams.map((e) => `${label(e)} ב-${e.date}`).join('; ')}. היום ${todayIso}.`;
  return `אתה עוזר לנער בן 14 לתכנן לימודים. אל תחליט ואל תבצע; רק הצע.
החזר JSON בלבד: {"extra_option": "..."} עם אפשרות מעשית אחת נוספת בעברית, עד ${AI_MAX_CHARS} תווים, או {"extra_option": null} אם אין מה להוסיף.
האפשרויות שכבר מוצגות: תוכנית למידה, ביטול למידה ישנה, פינוי ערבים, להתחיל מוקדם, להשאיר. אל תחזור עליהן ואל תמציא עובדות.
${facts}`;
}

async function alreadyShown(sql, keys) {
  if (keys.length === 0) return new Set();
  const rows = rowsOf(await sql`
    SELECT /* god-mode-shown */ DISTINCT f.value FROM facts f
    WHERE f.entity_type = ${GOD_MODE_ENTITY}::text AND f.field = 'finding' AND f.value = ANY(${keys}::text[])
  `);
  return new Set(rows.map((row) => row.value));
}

// הבריף (api/queues/deliver.js). לא זורק לעולם. ask: askBrain (מוזרק). מחזיר { created: [מפתחות] }.
export async function runGodMode({ sql, todayIso, changes = [], examsRaw = EXAMS, exams = EXAMS, ask = null, now = new Date() }) {
  try {
    const findings = [...movedEarlier({ todayIso, changes, exams: examsRaw }), ...busyWeeks({ todayIso, exams })];
    if (findings.length === 0) return { created: [] };
    const shown = await alreadyShown(sql, findings.map((f) => f.key));
    const created = [];
    for (const finding of findings.filter((f) => !shown.has(f.key))) {
      let extra = null;
      if (typeof ask === 'function') {
        try {
          // env BRAIN_PILOT=off: רק מודל שעבר את השער. אין מודל כזה = no-pool, בלי קריאה.
          const result = await ask({ sql, now, prompt: aiPrompt(finding, todayIso), schema: validExtra, timeoutMs: AI_TIMEOUT_MS, env: { BRAIN_PILOT: 'off' }, notify: async () => {} });
          if (result?.ok && validExtra(result.data) && result.data.extra_option) extra = result.data.extra_option.trim();
        } catch (error) {
          console.error('god-mode: המוח לא זמין, הכרטיס בלי תוספת:', error?.name);
        }
      }
      const body = cardText(finding, { todayIso, extra });
      const cardId = randomUUID();
      const [row] = rowsOf(await sql`
        /* god-mode-create */ WITH m AS (
          INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
          SELECT 'out', ${body}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, ${GOD_MODE_ENTITY}::text, ${cardId}::uuid, NULL::integer
          WHERE NOT EXISTS (SELECT 1 FROM facts p WHERE p.entity_type = ${GOD_MODE_ENTITY}::text AND p.field = 'finding' AND p.value = ${finding.key}::text)
          RETURNING id
        ), f AS (
          INSERT INTO facts (source_id, field, value, confidence, extracted_by, entity_type, entity_id, origin)
          SELECT NULL::uuid, 'finding', ${finding.key}::text, 'certain', 'script', ${GOD_MODE_ENTITY}::text, ${cardId}::uuid, 'read'
          WHERE EXISTS (SELECT 1 FROM m)
          RETURNING id
        )
        SELECT (SELECT id FROM m) AS message_id
      `);
      if (row?.message_id) created.push(finding.key);
    }
    return { created };
  } catch (error) {
    console.error('god-mode: הסקירה נכשלה:', error?.name);
    return { created: [] };
  }
}
