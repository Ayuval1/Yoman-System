// צירוף תמונה למשימה (שלב 8.6-3). מקור: docs/08-chapter8/60-chapter8-step-8-6-spec.md, סעיפים 8-10, החוזה (attach) וקריטריון 11;
// docs/02-rules/03-intake-rules.md "הודעה בלי טקסט": המערכת לא קוראת את התמונה, רק שומרת אותה ב-Vercel Blob פרטי עם תאריך ומקצוע.
// קוד בלבד, בלי מודל. פרטיות: בלוג רק שם השגיאה; לא התמונה, לא הטוקן ולא הודעת השגיאה (עלולה להכיל נתיב או ערך).
import { randomUUID } from 'node:crypto';

// [הצעה] של המפרט 60 ("חוזה"): גוף attach עד 1,500,000 תווים (כ-1.1MB של תמונה), מתחת ל-4.5MB של Vercel. שאר הפעולות נשארות ב-16,384.
export const MAX_ATTACH_BODY_CHARS = 1_500_000;
// הנחה, לא אומת: נוסחי ההודעות לדף. "תמונות עוד לא מחוברות" ניתן במשימה; נוסח הכשל לפי סגנון ERROR_TEXT ("לא נשלח, נסה שוב.").
export const IMAGES_OFF_TEXT = 'תמונות עוד לא מחוברות';
export const UPLOAD_FAILED_TEXT = 'התמונה לא נשמרה, נסה שוב.';

const JPEG_TYPE = 'image/jpeg';
const DATA_URL_PREFIX = 'data:image/jpeg;base64,';
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// image (base64, אפשר עם קידומת data:image/jpeg;base64, כמו ש-canvas.toDataURL מחזיר) -> בתים, או null כשזה לא JPEG או לא base64 תקין.
export function decodeJpeg(image) {
  if (typeof image !== 'string') return null;
  const text = image.startsWith(DATA_URL_PREFIX) ? image.slice(DATA_URL_PREFIX.length) : image;
  if (text.length === 0 || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  return bytes;
}

// מחיקת המיקום (קריטריון 11): מסיר את קטעי APP1 (Exif ו-XMP, שם יושבים נתוני GPS) עד תחילת הסריקה (SOS). כל השאר מועתק כמו שהוא.
// הדפדפן כבר מקטין דרך canvas, שלא מעתיק Exif; זו רשת ביטחון בשרת. מבנה שבור = null (התמונה נדחית).
export function stripJpegMetadata(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    let marker = i + 1;
    while (marker < bytes.length && bytes[marker] === 0xff) marker += 1; // בתי מילוי
    if (marker >= bytes.length) return null;
    const code = bytes[marker];
    const start = marker - 1;
    if (code === 0xda || code === 0xd9) { // תחילת הסריקה או סוף התמונה: השאר נתוני תמונה
      parts.push(bytes.subarray(start));
      return Buffer.concat(parts);
    }
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) { // סמן בלי אורך
      parts.push(bytes.subarray(start, marker + 1));
      i = marker + 1;
      continue;
    }
    if (marker + 2 >= bytes.length) return null;
    const end = marker + 1 + bytes.readUInt16BE(marker + 1);
    if (end > bytes.length || bytes.readUInt16BE(marker + 1) < 2) return null;
    if (code !== 0xe1) parts.push(bytes.subarray(start, end));
    i = end;
  }
  return null; // אין SOS: לא תמונה שלמה
}

// ההעלאה האמיתית ל-Vercel Blob, נטענת בעצלות (בדיקות לא נוגעות ברשת). אחסון פרטי: נגיש רק דרך השרת עם הטוקן.
// הנחה, לא אומת: שה-store נוצר כפרטי. ב-store ציבורי ההעלאה הפרטית צפויה להיכשל, ואז status = failed (לא נופלים לציבורי).
export function blobUploader(token) {
  return async (pathname, body) => {
    const { put } = await import('@vercel/blob');
    return put(pathname, body, { access: 'private', contentType: JPEG_TYPE, addRandomSuffix: false, token });
  };
}

// צירוף אחד: קודם בודקים שהמשימה קיימת ופתוחה (בלי העלאה לשווא), אחר כך מעלים, ורק אחרי העלאה שהצליחה כותבים שורה ב-media.
// { status: 'attached', mediaId } | { status: 'closed' } (המשימה לא קיימת או לא פתוחה) | { status: 'failed' } (ההעלאה נכשלה; אין שורה).
// שם הקובץ אקראי (uuid), לא נגזר מהמשימה או מהתוכן. כשל מסד אחרי העלאה זורק (הקורא מחזיר 500), והקובץ נשאר ב-Blob בלי שורה.
export async function attachImage({ sql, taskId, jpeg, upload, now = new Date(), newId = randomUUID }) {
  const [task] = await sql`SELECT id, subject FROM tasks WHERE id = ${taskId}::uuid AND status = 'open'`;
  if (!task) return { status: 'closed' };
  let stored;
  try {
    stored = await upload(`homework/${newId()}.jpg`, jpeg);
  } catch (error) {
    console.error('media: העלאה ל-Blob נכשלה:', error?.name);
    return { status: 'failed' };
  }
  const location = stored?.url ?? stored?.pathname;
  const [row] = await sql`
    INSERT INTO media (task_id, blob_path, content_type, bytes, received_at, subject, status)
    VALUES (${taskId}::uuid, ${location}, 'image/jpeg', ${jpeg.length}::int, ${now.toISOString()}::timestamptz, ${task.subject ?? null}, 'stored')
    RETURNING id
  `;
  return { status: 'attached', mediaId: row?.id ?? null };
}
