// טיפול חוזר בהודעות שחיכו למוח (בלוק 3ב-1; אפיון-מורחב סעיף 4: "הודעות שצריכות AI נשמרות ויטופלו אוטומטית כשהמכסה חוזרת").
// רץ מתוך ה-Cron הקיים (lib/ops/cron-plan.js, שתי הריצות ביום), בלי טבלה חדשה ובלי שינוי סכמה: הסימון הוא שורת probe_log 'brain-pending' (lib/intake-process.js).
//
// מי נבחר: הודעה מהקיצור מ-48 השעות האחרונות, שהמוח לא היה זמין כשהגיעה (סימון ok=false), שהקוד לא הבין (processed_at ריק),
// שאין לה אף שורה ב-messages (לא נשאלה שאלה ולא נכתבה בועה), ושהמוח עוד לא ראה (אין סימון ok=true). עד RETRY_LIMIT בכל ריצה, הישנה קודם.
// הודעה מוקלדת (app) לא נבחרת: היא כבר קיבלה בועה או "מה זה?" בצ'אט, ועיבוד חוזר היה כותב בועה שנייה. [הכרעה טכנית, בלוק 3ב-1]
//
// כל הודעה: processSource עם המוח. המוח ענה (בכל סוג) = סימון ok=true, כדי שלא תישלח שוב. לא ענה = נשארת לריצה הבאה (עד 48 שעות).
// נרשם (recorded) = כתיבה ליומן Google של אותו מקור, כמו ב-api/intake.js. בלי טקסט בלוגים.
import { processSource, pendingDetail } from './intake-process.js';
import { understandSource } from './intake-brain.js';
import { syncEventForSource } from './event-sync.js';

// הנחה, לא אומת: 5 הודעות בריצה. שתי ריצות ביום = עד 10 קריאות, חלק קטן מהמכסה היומית (שלא נמדדה, אפיון-מורחב סעיף 4).
export const RETRY_LIMIT = 5;
export const RETRY_WINDOW_HOURS = 48;
const HOUR_MS = 3600000;

// מחזיר { tried, recorded, understood } (מספרים בלבד, לשורת ה-probe_log של ה-Cron). בלי מפתח: לא נוגע במסד בכלל.
export async function retryPendingSources({
  sql,
  now = new Date(),
  limit = RETRY_LIMIT,
  apiKey = process.env.GEMINI_API_KEY,
  understand = understandSource,
  processor = processSource,
  eventSync = syncEventForSource,
}) {
  const summary = { tried: 0, recorded: 0, understood: 0 };
  if (!apiKey) return summary;
  const since = new Date(now.getTime() - RETRY_WINDOW_HOURS * HOUR_MS).toISOString();
  const rows = await sql`
    SELECT s.id, s.channel, s.raw_content, s.content_hash, s.received_at
    FROM sources s
    WHERE s.channel = 'shortcut' AND s.processed_at IS NULL AND s.received_at > ${since}::timestamptz
      AND EXISTS (SELECT 1 FROM probe_log p WHERE p.probe = 'brain-pending' AND p.ok = false AND p.detail = 'source=' || s.id::text)
      AND NOT EXISTS (SELECT 1 FROM probe_log p WHERE p.probe = 'brain-pending' AND p.ok = true AND p.detail = 'source=' || s.id::text)
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.entity_type = 'source' AND m.entity_id = s.id)
    ORDER BY s.received_at ASC
    LIMIT ${limit}::int
  `;
  for (const row of Array.isArray(rows) ? rows : []) {
    const source = { id: String(row.id), channel: row.channel, raw_content: row.raw_content, content_hash: row.content_hash, received_at: row.received_at };
    summary.tried += 1;
    let result;
    try {
      result = await processor({ sql, source, understand: (extra) => understand({ sql, source, now, apiKey, ...extra }) }); // extra: טוען המועמדים (בלוק 4)
    } catch (error) {
      console.error('brain-retry: עיבוד חוזר נכשל:', error?.name);
      continue;
    }
    if (result?.brain !== 'ok') continue;
    summary.understood += 1;
    try {
      await sql`INSERT INTO probe_log (probe, ok, detail) VALUES ('brain-pending', ${true}, ${pendingDetail(source.id)})`;
    } catch (error) {
      console.error('brain-retry: סימון "המוח ראה" נכשל:', error?.name);
    }
    if (result.status === 'recorded') {
      summary.recorded += 1;
      try {
        // בלוק 4: הודעה שעדכנה אירוע קיים כותבת אותו (המקור שלו, PATCH מותר), כמו ב-api/intake.js.
        if (result.matched?.sourceId) await eventSync({ sql, sourceId: String(result.matched.sourceId), now, allowPatch: true });
        else await eventSync({ sql, sourceId: source.id, now });
      } catch (error) {
        console.error('brain-retry: כתיבה ליומן נכשלה:', error?.name);
      }
    }
  }
  return summary;
}
