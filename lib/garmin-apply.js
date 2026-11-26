// Garmin מול אימוני 4fitness (בלוק 5): אחרי משיכה מוצלחת (lib/ops/garmin-sync.js) מחילים את מה שנמשך על האימונים שנרשמו מהלוז. קוד בלבד, בלי מודל
// (03-garmin-rules, "עקרון-העל נשמר": הקריאה, ההשוואה וההחלטה הם קוד).
// המפרט המחייב: docs/02-rules/03-4fitness-rules.md, "תוכן האימון מ-Garmin" ו"כל הריצות בשבוע"; הסמכות: docs/02-rules/03-sources-rules.md, "4fitness"
// (וואטסאפ קובע יום, שעת התחלה, מיקום, "מנוחה" ו"כוח"; Garmin קובע תוכן ואורך ריצה; Garmin חסר אינו "אין אימון").
//
// מה נעשה, לכל אימון 4fitness מתוכנן (מפתח 'source:<מקור>:fitness:<תאריך>:run', כותרת "אימון ריצה...", שני או רביעי) שעוד לא התחיל:
//   - אימון ריצה מתוכנן ב-Garmin באותו תאריך (שיוך לפי תאריך, 03-4fitness): סוף האירוע = התחלה + המשך מ-Garmin, והכותרת מ-Garmin מתווספת לתיאור
//     אחרי " · " (מתווספת, לא מחליפה; הדוגמה בקובץ: `ריצה לשדות + כוח` · `חימום 15 דק' · ...`).
//   - "כוח" בתיאור מהלוז: אירוע נפרד "כוח" מסוף הריצה עד 20:00, או עד שעת הסיום המפורשת בלוז (03-4fitness, הטבלה ב"כל הריצות בשבוע", #4).
//     מפתח: מפתח האימון + ':strength'. בלי "כוח": האירוע נגמר בסוף הריצה, ואירוע כוח שנשאר (הלוז השתנה) מבוטל.
//     כוח שבוטל כאן אוטומטית (האימון התארך מעבר לו) חוזר כשיש לו שוב מקום: שורה חדשה, והשורה הישנה נשארת מבוטלת (ראו "החזרה" למטה).
//   - אין אימון ב-Garmin: לא משתנה כלום, ולא שואלים (#6 בטבלה).
//   - בועה ביום שני לאימון של היום, פעם אחת לכל אימון: "נוסף תוכן לאימון היום: X. לסנכרן את השעון." ברביעי בלי בועה (03-4fitness, "רביעי").
//   - ריצה שבוצעה (פעילות ב-Garmin) ביום של אימון מתוכנן: status 'done' (הערכים ב-db/schema.sql: planned / done / cancelled), כדי ש"התאמנת?"
//     לא יישאל (03-garmin-rules, "הגיבוי" 1; אפיון סעיף 9). אימון שבוטל לא מסומן (03-4fitness, "ביטול": "התאמנת?" לא נשאל על אימון שבוטל).
// הכתיבה: פקודה אחת אטומית (עדכון, יצירת כוח, החזרת כוח, שינויי סטטוס, changes, בועה), ואז היומן דרך lib/event-sync.js syncEventsByMatchKeys,
// כמו מסלול הלוז (lib/intake-process.js): עדכון = PATCH (כותרת, מיקום, תיאור, שעות; בלי תזכורות), כוח חדש = יצירה, כוח שבוטל = מחיקה.
// "רק הנוכחי": שורות garmin_items נשארות גם כשהמאמן מחק אימון (lib/garmin-store.js, ההערה מעל loadGarminItemsForDate). לכן נחשב רק פריט
// שה-fetched_at שלו הוא של המשיכה הזאת. שורות ישנות משמשות רק כדי להסיר מהתיאור תוכן קודם שהוחלף. כפילות לוח/תוכנית = אותה כותרת באותו תאריך = אחד.
// לא זורק: כל כשל מוחזר כקוד ({ ok:false, reason }), והמשיכה לא נכשלת בגללו. פרטיות: ללוג נכנסים רק קודים קצרים, בלי כותרות ומזהים.
import { FITNESS_TITLE_PREFIX } from './fitness-schedule.js';
import { syncEventsByMatchKeys } from './event-sync.js';
import { addDays, localDateIso, weekdayOf } from './intake-dates.js';
import { localParts, zonedToUtc } from './schedule-time.js';
import { isMissingTable } from './garmin-store.js';
import { DONE_DAYS_BACK, PLANNED_DAYS_AHEAD } from './garmin.js';
import { sendChatNotification } from './chat-notify.js';
import { planNotify } from './message-slots.js';

export const STRENGTH_TITLE = 'כוח';
export const STRENGTH_KEY_SUFFIX = ':strength';
export const CONTENT_ENTITY = 'garmin_content';
export const CONTENT_SEPARATOR = ' · ';
// הנוסח של יובל (03-4fitness, "ההודעה ביום שני").
export const MONDAY_CONTENT_TEXT = (content) => `נוסף תוכן לאימון היום: ${content}. לסנכרן את השעון.`;

const TIME_ZONE = 'Asia/Jerusalem';
const MINUTE_MS = 60000;
const MONDAY = 1;
const WEDNESDAY = 3;
const DEFAULT_RUN_MINUTES = 120; // "שעתיים משעת ההתחלה, תמיד" (03-4fitness, "שעות"); כך יודעים אם סוף האימון נכתב במפורש
const STRENGTH_DEFAULT_END = '20:00'; // "כוח — מסוף הריצה עד 20:00" (03-4fitness, הטבלה)
// [הנחה, לא אומת] פעילות שהתחילה יותר משעה לפני האימון (ריצת בוקר) אינה האימון. בלי שעת התחלה: לא מסמנים, ו"התאמנת?" יישאל (הגיבוי).
const DONE_EARLY_MS = 60 * MINUTE_MS;
const RUN_KEY = /^source:.+:fitness:\d{4}-\d{2}-\d{2}:run$/;
const STRENGTH_WORD = /כוח/;

const toMs = (value) => {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};
const iso = (ms) => new Date(ms).toISOString();
const textOrNull = (value) => (typeof value === 'string' && value.trim() !== '' ? value : null);
const rowsOf = (result) => (Array.isArray(result) ? result : []);
// חותמת מקומית לשורות changes, באותו פורמט כמו מסלול הלוז ('YYYY-MM-DD HH:MM').
function stamp(ms) {
  const p = localParts(new Date(ms), TIME_ZONE);
  const pad = (n) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

// ריצה? ענף הספורט קובע כשהוא קיים (running, trail_running, treadmill_running...: מכיל 'run'). ענף אחר = לא ריצה, גם אם בכותרת "ריצה".
// בלי ענף: לפי הכותרת ("ריצה" / "ריצת"). [הנחה, לא אומת] מפתחות הענף של Garmin לריצה מכילים 'run'; לא נבדק מול חשבון חי.
export function isRunningItem(item) {
  if (typeof item?.sport === 'string' && item.sport !== '') return /run/i.test(item.sport);
  return typeof item?.title === 'string' && /ריצ/.test(item.title);
}

// התיאור מהלוז: מסירים מהסוף תוכן מ-Garmin שכבר נוסף (כל כותרת של פריט מתוכנן באותו תאריך, גם ישן), כדי שתוכן חדש יחליף ולא יתווסף פעמיים.
// [הנחה, לא אומת] תיאור מהלוז ששווה בדיוק לכותרת של אימון ב-Garmin ייקרא כתוכן קודם. בתיאורים שהלוז מייצר ("ריצה לשדות + כוח") זה לא קורה.
function baseDescription(description, titles) {
  let base = textOrNull(description);
  let changed = true;
  while (base !== null && changed) {
    changed = false;
    for (const title of titles) {
      if (base === title) {
        base = null;
        changed = true;
        break;
      }
      if (base.endsWith(CONTENT_SEPARATOR + title)) {
        base = textOrNull(base.slice(0, -(CONTENT_SEPARATOR + title).length));
        changed = true;
        break;
      }
    }
  }
  return base;
}

// התוכנית (טהורה). items = שורות garmin_items בחלון; events = אימוני 4fitness ואירועי הכוח שלהם (כל סטטוס).
// מחזיר { updates, creates, restores, statuses, changes, bubbles, keys, patchKeys, skipped }.
// events.auto_cancelled (מ-applyGarminItems): אירוע כוח מבוטל שהביטול האחרון שלו נעשה כאן (ראו שם). בלעדיו = לא מוחזר.
export function planGarminApply({ items, events, now, fetchedAt }) {
  const nowMs = toMs(now);
  const fetchedMs = toMs(fetchedAt);
  const today = localDateIso(new Date(nowMs));
  const lastPlannedDate = addDays(today, PLANNED_DAYS_AHEAD);
  const work = { updates: [], creates: [], restores: [], statuses: [], changes: [], bubbles: [], keys: [], patchKeys: [], skipped: { ambiguous: 0, strength_closed: 0 } };
  const list = rowsOf(items);
  const current = list.filter((item) => toMs(item.fetched_at) === fetchedMs && isRunningItem(item));
  const byKey = new Map(rowsOf(events).map((row) => [row.match_key, row]));
  const cancel = (row) => {
    work.statuses.push({ id: row.id, status: 'cancelled' });
    work.changes.push({ entity_id: row.id, field: 'status', old_value: 'planned', new_value: 'cancelled' });
    work.keys.push(row.match_key);
  };

  const runs = rowsOf(events)
    .filter((row) => typeof row.match_key === 'string' && RUN_KEY.test(row.match_key) && typeof row.title === 'string' && row.title.startsWith(FITNESS_TITLE_PREFIX))
    .sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at));
  for (const run of runs) {
    const startMs = toMs(run.starts_at);
    const endMs = toMs(run.ends_at);
    if (startMs === null || endMs === null) continue;
    const date = localDateIso(new Date(startMs));
    const strengthKey = run.match_key + STRENGTH_KEY_SUFFIX;
    const strength = byKey.get(strengthKey) ?? null;

    if (run.status === 'cancelled') {
      // אימון שבוטל (מנוחה): לא מחילים עליו כלום ולא מסמנים done. אירוע כוח שנשאר מתוכנן מתבטל איתו.
      if (strength?.status === 'planned' && toMs(strength.ends_at) > nowMs) cancel(strength);
      continue;
    }
    if (run.status !== 'planned') continue;
    const weekday = weekdayOf(date);
    if (weekday !== MONDAY && weekday !== WEDNESDAY) continue;

    // בוצע: ריצה שהשעון הקליט באותו תאריך, החל משעה לפני האימון.
    const done = current.find((item) => item.kind === 'done' && item.item_date === date && toMs(item.starts_at) !== null && toMs(item.starts_at) >= startMs - DONE_EARLY_MS);
    if (done) {
      work.statuses.push({ id: run.id, status: 'done' });
      work.changes.push({ entity_id: run.id, field: 'status', old_value: 'planned', new_value: 'done' });
      continue;
    }
    if (startMs <= nowMs || date > lastPlannedDate) continue; // אימון שכבר התחיל לא משתנה (כמו lib/event-sync.js)

    const plannedToday = current.filter((item) => item.kind === 'planned' && item.item_date === date);
    const unique = new Map(plannedToday.map((item) => [item.title ?? `#${item.garmin_id}`, item]));
    if (unique.size === 0) continue; // אין אימון ב-Garmin: נשאר כמו בשבת, בלי שאלה (#6)
    if (unique.size > 1) {
      work.skipped.ambiguous += 1; // [הנחה, לא אומת] שתי ריצות שונות באותו יום: לא ברור איזו היא האימון, ולכן לא נוגעים
      continue;
    }
    const [item] = unique.values();
    const title = textOrNull(item.title);
    const durationMs = Number.isInteger(item.duration_sec) && item.duration_sec > 0 ? item.duration_sec * 1000 : null;
    if (!title && durationMs === null) continue; // אין תוכן ואין אורך: אין מה להוסיף

    const allTitles = [...new Set(list.filter((x) => x.kind === 'planned' && x.item_date === date && textOrNull(x.title)).map((x) => x.title))]
      .sort((a, b) => b.length - a.length);
    const base = baseDescription(run.description, allTitles);
    const description = [base, title].filter(Boolean).join(CONTENT_SEPARATOR) || null;
    // משך חסר: השעות לא משתנות (אין מאיפה לחשב את סוף הריצה, 03-4fitness "לא אומת"), ואין פיצול לכוח. התוכן עדיין נכנס לתיאור (תת-שלב ג').
    const runEndMs = durationMs === null ? endMs : startMs + durationMs;

    const runChanges = [];
    if (runEndMs !== endMs) runChanges.push({ entity_id: run.id, field: 'ends_at', old_value: stamp(endMs), new_value: stamp(runEndMs) });
    if (description !== textOrNull(run.description)) runChanges.push({ entity_id: run.id, field: 'description', old_value: textOrNull(run.description), new_value: description });
    if (runChanges.length > 0) {
      work.updates.push({
        id: run.id, starts_at: iso(startMs), ends_at: iso(runEndMs), description,
        old_starts_at: iso(startMs), old_ends_at: iso(endMs), old_description: textOrNull(run.description),
      });
      work.changes.push(...runChanges);
      work.keys.push(run.match_key);
      work.patchKeys.push(run.match_key);
    }

    if (durationMs !== null) {
      // סוף הכוח = הסוף מהלוז. איפה הוא שמור:
      //   - יש אירוע כוח מתוכנן והאימון נגמר עד תחילתו: האימון כבר קוצר בריצה קודמת, והסוף מהלוז שמור בסוף הכוח.
      //   - האימון נגמר אחרי תחילת הכוח: לוז חדש החזיר אותו לשעות שלו (lib/intake-process.js), והסוף שלו הוא הסוף מהלוז.
      //   - אין אירוע כוח מתוכנן, והאימון כבר באורך של Garmin: הסוף מהלוז אבד, ולכן 20:00 (ברירת המחדל של הטבלה).
      //     כך ריצה הבאה מתקנת אימון מקוצר שנשאר בלי כוח (למשל אירוע כוח שנמחק ידנית מהמסד). [הנחה, לא אומת] לוז עם סוף מפורש
      //     שבדיוק שווה לסוף הריצה מ-Garmin ייקרא כאן כמקוצר, ויקבל כוח עד 20:00.
      //   - אחרת: הסוף הנוכחי של האימון הוא מהלוז (עוד לא קוצר).
      // כשל בפקודת הכתיבה לא משאיר חצי מצב (פקודה אחת אטומית): שום דבר לא נכתב, והריצה הבאה של garmin-sync מחשבת הכול מחדש מאותה נקודה.
      // סוף שאינו "שעתיים" נכתב במפורש בלוז וגובר.
      //   - אירוע כוח שבוטל אוטומטית כאן (ראו "החזרה" למטה): הסוף מהלוז שמור בסוף הכוח המבוטל, כי הביטול לא שינה את שעותיו. האימון
      //     התארך מעבר אליו, ולכן המוקדם מבין השניים. [הנחה, לא אומת] לוז חדש שהגיע אחרי הביטול והאריך את סוף האימון ייקרא לפי הכוח הישן.
      const plannedStrength = strength?.status === 'planned' ? strength : null;
      const autoCancelled = strength?.status === 'cancelled' && strength.auto_cancelled === true ? strength : null;
      const strengthStart = toMs(plannedStrength?.starts_at);
      let originalEnd;
      if (plannedStrength && strengthStart !== null && endMs <= strengthStart) originalEnd = toMs(plannedStrength.ends_at);
      else if (autoCancelled && toMs(autoCancelled.ends_at) !== null) originalEnd = Math.min(endMs, toMs(autoCancelled.ends_at));
      else if (!plannedStrength && endMs === runEndMs) originalEnd = null;
      else originalEnd = endMs;
      const explicit = originalEnd !== null && originalEnd - startMs !== DEFAULT_RUN_MINUTES * MINUTE_MS;
      const strengthEndMs = explicit ? originalEnd : zonedToUtc(date, STRENGTH_DEFAULT_END).getTime();
      const needed = base !== null && STRENGTH_WORD.test(base) && runEndMs < strengthEndMs;
      if (needed && !strength) {
        work.creates.push({ title: STRENGTH_TITLE, starts_at: iso(runEndMs), ends_at: iso(strengthEndMs), match_key: strengthKey });
        work.keys.push(strengthKey);
      } else if (needed && plannedStrength) {
        const sStart = toMs(plannedStrength.starts_at);
        const sEnd = toMs(plannedStrength.ends_at);
        if (sStart !== runEndMs || sEnd !== strengthEndMs) {
          work.updates.push({
            id: plannedStrength.id, starts_at: iso(runEndMs), ends_at: iso(strengthEndMs), description: textOrNull(plannedStrength.description),
            old_starts_at: iso(sStart), old_ends_at: iso(sEnd), old_description: textOrNull(plannedStrength.description),
          });
          if (sStart !== runEndMs) work.changes.push({ entity_id: plannedStrength.id, field: 'starts_at', old_value: stamp(sStart), new_value: stamp(runEndMs) });
          if (sEnd !== strengthEndMs) work.changes.push({ entity_id: plannedStrength.id, field: 'ends_at', old_value: stamp(sEnd), new_value: stamp(strengthEndMs) });
          work.keys.push(strengthKey);
          work.patchKeys.push(strengthKey);
        }
      } else if (needed && autoCancelled) {
        // החזרה (problem-log 2026-11-22): הכוח בוטל כאן אוטומטית כי האימון ב-Garmin התארך מעבר לו (או כי "כוח" ירד מהלוז), ועכשיו יש לו
        // שוב מקום והלוז עדיין אומר "כוח". לא מחיים את השורה הישנה: המזהה שלה ב-Google נגזר מ-events.id וכבר נמחק, ויצירה באותו מזהה
        // לא נבדקה (ייתכן 409 שנקרא כהצלחה והאירוע נשאר מחוק). לכן השורה הישנה נשארת מבוטלת, המפתח שלה מוחלף (כדי לפנות את מפתח הכוח),
        // ונוצרת שורה חדשה = מזהה חדש, והיומן נכתב במסלול היצירה הרגיל (lib/event-sync.js). פעם שנייה: השורה החדשה מתוכננת = הענף הרגיל.
        const replacedKey = `${strengthKey}:replaced:${autoCancelled.id}`;
        work.restores.push({
          old_id: autoCancelled.id, match_key: strengthKey, replaced_key: replacedKey, title: STRENGTH_TITLE, starts_at: iso(runEndMs), ends_at: iso(strengthEndMs),
        });
        work.changes.push({ entity_id: autoCancelled.id, field: 'match_key', old_value: strengthKey, new_value: replacedKey });
        work.keys.push(strengthKey);
      } else if (needed) {
        // אירוע כוח שבוטל לא כאן (יובל ביטל בהודעה, או ביטול עם מקור) או שבוצע: לא מוחזר. ראו auto_cancelled ב-applyGarminItems.
        work.skipped.strength_closed += 1;
      } else if (plannedStrength) {
        cancel(plannedStrength);
      }
    }

    // בועת שני: רק לאימון של היום, לפני שהתחיל; פעם אחת לאימון (NOT EXISTS בפקודה). בלי כותרת: האורך.
    if (date === today && weekday === MONDAY) {
      const content = title ?? `ריצה ${Math.round(durationMs / MINUTE_MS)} דק'`;
      work.bubbles.push({ entity_id: run.id, body: MONDAY_CONTENT_TEXT(content) });
    }
  }
  return work;
}

// דחיפה מיידית אחרי בועה שנכתבה בפועל (בועת התוכן של יום שני כאן, ובועת "Garmin נפל" ב-lib/ops/garmin-sync.js).
// למה: הבועות האלה נכתבות מ-Cron ולא מ-api/intake.js, ולכן אף אחד לא שולח עליהן התראה לתור (planNotify). ההודעה של שני היא "מיידי"
// (03-4fitness, "ההודעה ביום שני — מאיפה היא באה": התוכן מגיע לפני 21:00 -> מיידי).
// המנגנון הקיים: sendChatNotification (lib/chat-notify.js), כמו api/queues/deliver.js בשאלת שיעורי הבית: בודק מספר והודעה שלא נקראה,
// מכבד חלון "לא זמין" (deferIfQuiet: לא שולח, וקובע התראה לסוף החלון), ושולח דרך push-send עם CRON_SECRET מהסביבה (כמו שאר משימות ops).
// dedupe_key = מפתח חלון האגוד של planNotify, כך שהתראה כפולה באותו חלון לא נשלחת. לא זורק: מחזיר { sent, reason }, ובכשל נרשם קוד בלבד.
export async function pushNow({ sql, now = new Date(), secret = process.env.CRON_SECRET, notify = sendChatNotification, label = 'garmin' }) {
  try {
    const outcome = await notify({ sql, slotKey: planNotify(now).slotKey, secret, now });
    if (!outcome?.sent && (String(outcome?.reason).startsWith('push-') || outcome?.reason === 'no-secret')) {
      console.error(`${label}: הדחיפה לא נשלחה:`, outcome.reason);
    }
    return { sent: outcome?.sent === true, reason: outcome?.reason ?? null };
  } catch (error) {
    console.error(`${label}: הדחיפה קרסה`, error?.name);
    return { sent: false, reason: 'error' };
  }
}

// הכתיבה: פקודה אחת אטומית. עדכון רק כשהשורה עדיין כמו שנקראה (מתוכננת, אותן שעות ואותו תיאור), כדי לא לדרוס לוז שנכנס באותו רגע.
// changes רק לשורות שעודכנו או ששינו סטטוס בפועל. source_id ריק: השינוי לא בא מהודעה. הבועה: NOT EXISTS על האימון.
async function writeWork(sql, work, nowIso) {
  const rows = rowsOf(await sql`
    /* garmin-apply-write */ WITH upd AS (
      UPDATE events SET starts_at = u.starts_at::timestamptz, ends_at = u.ends_at::timestamptz, description = u.description
      FROM jsonb_to_recordset(${JSON.stringify(work.updates)}::jsonb) AS u(id text, starts_at text, ends_at text, description text, old_starts_at text, old_ends_at text, old_description text)
      WHERE events.id = u.id::uuid AND events.status = 'planned' AND events.starts_at = u.old_starts_at::timestamptz AND events.ends_at = u.old_ends_at::timestamptz
        AND COALESCE(events.description, '') = COALESCE(u.old_description, '')
      RETURNING events.id
    ), ins AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT c.title, c.starts_at::timestamptz, c.ends_at::timestamptz, NULL::text, NULL::text, 'running', false, 'planned', NULL::text, NULL::uuid, c.match_key
      FROM jsonb_to_recordset(${JSON.stringify(work.creates)}::jsonb) AS c(title text, starts_at text, ends_at text, match_key text)
      WHERE NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = c.match_key)
      RETURNING id
    ), ren AS (
      UPDATE events SET match_key = r.replaced_key
      FROM jsonb_to_recordset(${JSON.stringify(work.restores)}::jsonb) AS r(old_id text, match_key text, replaced_key text, title text, starts_at text, ends_at text)
      WHERE events.id = r.old_id::uuid AND events.status = 'cancelled' AND events.match_key = r.match_key
      RETURNING events.id
    ), rins AS (
      INSERT INTO events (title, starts_at, ends_at, location, description, domain, movable, status, external_id, commitment_id, match_key)
      SELECT r.title, r.starts_at::timestamptz, r.ends_at::timestamptz, NULL::text, NULL::text, 'running', false, 'planned', NULL::text, NULL::uuid, r.match_key
      FROM jsonb_to_recordset(${JSON.stringify(work.restores)}::jsonb) AS r(old_id text, match_key text, replaced_key text, title text, starts_at text, ends_at text)
      WHERE r.old_id::uuid IN (SELECT id FROM ren)
        AND NOT EXISTS (SELECT 1 FROM events x WHERE x.match_key = r.match_key AND x.id <> r.old_id::uuid)
      RETURNING id
    ), st AS (
      UPDATE events SET status = s.status
      FROM jsonb_to_recordset(${JSON.stringify(work.statuses)}::jsonb) AS s(id text, status text)
      WHERE events.id = s.id::uuid AND events.status = 'planned'
      RETURNING events.id
    ), ch AS (
      INSERT INTO changes (entity_type, entity_id, field, old_value, new_value, source_id, changed_at, changed_by)
      SELECT 'event', x.entity_id::uuid, x.field, x.old_value, x.new_value, NULL::uuid, ${nowIso}::timestamptz, 'system'
      FROM jsonb_to_recordset(${JSON.stringify(work.changes)}::jsonb) AS x(entity_id text, field text, old_value text, new_value text)
      WHERE x.entity_id::uuid IN (SELECT id FROM upd UNION SELECT id FROM st UNION SELECT id FROM ren)
      RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', m.body, 'update', ${nowIso}::timestamptz, false, NULL::uuid, NULL::timestamptz, ${CONTENT_ENTITY}::text, m.entity_id::uuid, NULL::integer
      FROM jsonb_to_recordset(${JSON.stringify(work.bubbles)}::jsonb) AS m(entity_id text, body text)
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.entity_type = 'garmin_content' AND x.entity_id = m.entity_id::uuid)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM upd)::int AS updated, ((SELECT count(*) FROM ins) + (SELECT count(*) FROM rins))::int AS created, (SELECT count(*) FROM st)::int AS statuses,
      (SELECT count(*) FROM ch)::int AS changes_written, (SELECT count(*) FROM b)::int AS bubbles_written
  `);
  return rows[0] ?? {};
}

// נקרא מ-lib/ops/garmin-sync.js אחרי משיכה מוצלחת. fetchedAt = ה-fetched_at שהמשיכה הזאת כתבה (nowIso שם).
// מחזיר { ok:true, updated, created, statuses, bubbles, sync? } או { ok:false, reason }. לא זורק.
// push: הדחיפה אחרי בועה (pushNow), מוזרקת לבדיקות. נקראת רק כשהפקודה דיווחה שבועה נכתבה בפועל (NOT EXISTS שדילג = 0 = בלי דחיפה).
export async function applyGarminItems({ sql, now = new Date(), fetchedAt, syncEvents = syncEventsByMatchKeys, push = pushNow }) {
  try {
    const nowDate = new Date(toMs(now));
    const today = localDateIso(nowDate);
    const from = addDays(today, -DONE_DAYS_BACK);
    const to = addDays(today, PLANNED_DAYS_AHEAD);
    let items;
    try {
      items = rowsOf(await sql`
        SELECT /* garmin-apply-items */ garmin_id, kind, item_date::text AS item_date, title, sport, duration_sec, starts_at, fetched_at
        FROM garmin_items WHERE item_date >= ${from}::date AND item_date <= ${to}::date
      `);
    } catch (error) {
      if (isMissingTable(error)) return { ok: false, reason: 'table_missing' };
      throw error;
    }
    // האימונים ואירועי הכוח בחלון (כל סטטוס: ביטול משפיע על הכוח). הסינון המדויק (מפתח, כותרת, יום בשבוע) בקוד.
    // auto_cancelled: אירוע כוח מבוטל ששורת ה-status האחרונה שלו ב-changes היא ביטול של המערכת בלי מקור (source_id ריק). רק הפקודה כאן
    // כותבת ביטול כזה: הלוז ("מנוחה", lib/intake-process.js) כותב עם מקור, ביטול בהודעה של יובל (lib/event-match.js) לא כותב changes בכלל,
    // ו-lib/weekly-runs.js לא מבטל. ביטול של הפקודה כאן כשהאימון עצמו בוטל (מנוחה) נראה אותו דבר, אבל אימון מבוטל לא חוזר להיות מתוכנן
    // (הלוז מעדכן רק שורות מתוכננות), ו-planGarminApply לא מחזיר כוח לאימון מבוטל. בלי שינוי בסכמה.
    const events = rowsOf(await sql`
      SELECT /* garmin-apply-events */ id, title, starts_at, ends_at, location, description, status, match_key, external_id,
        (status = 'cancelled' AND match_key LIKE ${'%' + STRENGTH_KEY_SUFFIX} AND COALESCE((
          SELECT c.source_id IS NULL AND c.changed_by = 'system' AND c.new_value = 'cancelled'
          FROM changes c WHERE c.entity_type = 'event' AND c.entity_id = events.id AND c.field = 'status'
          ORDER BY c.changed_at DESC NULLS LAST LIMIT 1
        ), false)) AS auto_cancelled
      FROM events
      WHERE domain = 'running' AND match_key LIKE 'source:%:fitness:%' AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND starts_at >= ${zonedToUtc(from, '00:00').toISOString()}::timestamptz AND starts_at < ${zonedToUtc(addDays(to, 1), '00:00').toISOString()}::timestamptz
    `);
    const work = planGarminApply({ items, events, now: nowDate, fetchedAt });
    const anything = work.updates.length + work.creates.length + work.restores.length + work.statuses.length + work.bubbles.length > 0;
    if (!anything) return { ok: true, updated: 0, created: 0, statuses: 0, bubbles: 0 };
    const written = await writeWork(sql, work, nowDate.toISOString());
    const result = {
      ok: true, updated: Number(written.updated ?? 0), created: Number(written.created ?? 0), statuses: Number(written.statuses ?? 0), bubbles: Number(written.bubbles_written ?? 0),
    };
    if (result.bubbles > 0) result.push = (await push({ sql, now: nowDate, label: 'garmin-apply' })).sent ? 'sent' : 'not_sent';
    const keys = [...new Set(work.keys)];
    if (keys.length > 0) {
      try {
        const synced = await syncEvents({ sql, keys, patchKeys: [...new Set(work.patchKeys)], now: nowDate });
        if (synced?.reason || synced?.failed) console.error('garmin-apply: כתיבה ליומן לא הושלמה:', synced.reason ?? synced.last_failure ?? 'failed');
        result.sync = synced?.reason ?? (synced?.failed ? 'failed' : 'ok');
      } catch (error) {
        console.error('garmin-apply: הכתיבה ליומן קרסה', error?.name);
        result.sync = 'crashed';
      }
    }
    return result;
  } catch (error) {
    console.error('garmin-apply: נכשל', error?.name);
    return { ok: false, reason: 'db_error' };
  }
}
