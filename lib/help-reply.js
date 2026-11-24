// "מה אתה יודע לעשות?" / "עזרה": בועה עם דוגמאות אמיתיות למה שאפשר לכתוב (24.11.2026, גילוי של היכולות; בקשת יובל ל"אפליקציה שימושית").
// קוד בלבד, לפני המוח, רק הודעה מוקלדת. קריאה בלבד. [הנחה, לא אומת] הנוסח של Claude: יובל לא אישר אותו (03-design-rules.md: נוסחים סופיים פתוחים).
// כל דוגמה היא יכולת שקיימת בקוד: אירוע, אירוע של כמה ימים, מבחן, משימה, "אני פנוי?", שאלה על הלוח, "תראה לי", "תביא לי", "לא לומד היום", "להאזנה", "לא זמין", לוז 4fitness.
export const HELP_TEXT = [
  'אפשר לכתוב לי במילים שלך. למשל:',
  '· פגישה עם המורה מחר ב-4',
  '· חופשה בווינה מ-30.11 עד 3.12',
  '· מבחן בהיסטוריה ב-10.12',
  '· להכין מצגת בהיסטוריה עד שלישי',
  '· מה יש לי מחר? / מתי המבחן בהיסטוריה?',
  '· אני פנוי ביום שלישי ב-6?',
  '· אני לא זמין ב-5',
  '· תראה לי את השבוע / את המבחנים',
  '· תביא לי את הלוח מהשיעור בהיסטוריה',
  '· לא לומד היום, אני מוכן',
  '· להאזנה: <שם של פודקאסט או ספר>',
  'ולוז 4fitness מהוואטסאפ: להעביר בקיצור.',
].join('\n');

const HELP = /^(?:עזרה|עזור לי|help|\?|מה (?:אתה|את) (?:יודע|יודעת|יכול|יכולה) לעשות|מה (?:אפשר|אני יכול) (?:לכתוב|לבקש|לעשות)(?: פה| כאן)?|איך (?:זה עובד|משתמשים בזה))$/i;
export function detectHelp(text) {
  if (typeof text !== 'string') return false;
  return HELP.test(text.trim().replace(/[?!.]+$/, '').trim() || text.trim());
}

const rowsOf = (r) => (Array.isArray(r) ? r : []);

// { status: 'recorded' | 'skipped', reply }. כשל מסד נזרק (הצינור מטפל).
export async function answerHelp({ sql, source }) {
  const rows = rowsOf(await sql`
    /* help-reply */ WITH claim AS (
      UPDATE sources SET processed_at = now() WHERE id = ${source.id}::uuid AND processed_at IS NULL RETURNING id
    ), b AS (
      INSERT INTO messages (direction, body, kind, sent_at, awaiting_reply, reply_source_id, expires_at, entity_type, entity_id, attempt)
      SELECT 'out', ${HELP_TEXT}::text, 'update', now(), false, NULL::uuid, NULL::timestamptz, 'source', claim.id, NULL::integer FROM claim
      WHERE NOT EXISTS (SELECT 1 FROM messages x WHERE x.direction = 'out' AND x.kind = 'update' AND x.entity_type = 'source' AND x.entity_id = claim.id)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claim)::int AS claimed
  `);
  if (rows.length > 0 && Number(rows[0].claimed) === 0) return { status: 'skipped', reply: 'התקבל' };
  return { status: 'recorded', reply: HELP_TEXT };
}
