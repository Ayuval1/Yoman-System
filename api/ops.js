// נקודה אחת לשלוש משימות ה-Cron (cron-plan, daily-check, gate-probe), כדי לרדת מתחת למגבלת 12 הפונקציות של Hobby.
// הקוד של כל משימה יושב ב-lib/ops/ ללא שינוי; כאן רק בחירה לפי הפרמטר task (רשימה סגורה, כל השאר 404).
// ההגנה (CRON_SECRET, 401/405) נשארת בתוך כל משימה. הפרמטרים האחרים (slot, from, count, model) עוברים כמו שהם.
// הכתובות הישנות (/api/cron-plan וכו') נשארות דרך rewrites ב-vercel.json.
// הנחה, לא אומת: ש-rewrite מעביר את פרמטרי השאילתה המקוריים (from, count, model). ה-Cron פונה ישירות ל-/api/ops?task=...
import cronPlan from '../lib/ops/cron-plan.js';
import dailyCheck from '../lib/ops/daily-check.js';
import gateProbe from '../lib/ops/gate-probe.js';
import schoolSeries from '../lib/ops/school-series.js';
import runSeries from '../lib/ops/run-series.js';
import lessonBackfill from '../lib/ops/lesson-backfill.js';
import { connectTask as garminConnect, statusTask as garminStatus, syncTask as garminSync } from '../lib/ops/garmin-sync.js';
import { shapeTask as garminShape } from '../lib/ops/garmin-shape.js';

// gate-probe צריך עד 300 שניות; הערך חל על כל המשימות כאן (לשתיים האחרות זה רק תקרה).
export const config = { maxDuration: 300 };

export const TASKS = {
  'cron-plan': cronPlan,
  'daily-check': dailyCheck,
  'gate-probe': gateProbe,
  // בלוק 4: 74 השיעורים וההפסקות ביומן "בית ספר". ידני בלבד (אין Cron ואין rewrite); mode=dry כברירת מחדל, mode=apply ב-POST.
  'school-series': schoolSeries,
  // בלוק 5 חלק ב (Garmin, lib/ops/garmin-sync.js): connect (POST מסקריפט הכניסה במחשב), status (GET), sync (Cron יומי, GET).
  'garmin-connect': garminConnect,
  'garmin-status': garminStatus,
  'garmin-sync': garminSync,
  // אבחון בלבד: צורת התשובות של Garmin (שמות שדות וערכים מספריים, בלי מחרוזות). lib/ops/garmin-shape.js.
  'garmin-shape': garminShape,
  // בלוק 5, ריצות שלישי ושישי: חיתוך הסדרה הישנה "ריצת בוקר" (lib/ops/run-series.js). ידני בלבד; dry כברירת מחדל, apply=1 חותך.
  'run-series-cut': runSeries,
  // בלוק 8: קישור תמונות ישנות לשיעור (lib/ops/lesson-backfill.js). ידני בלבד; dry כברירת מחדל, apply=1 כותב.
  'lesson-backfill': lessonBackfill,
};

export function pickTask(request) {
  const name = new URL(request.url).searchParams.get('task');
  return Object.hasOwn(TASKS, name) ? TASKS[name] : null;
}

export default {
  fetch(request) {
    const task = pickTask(request);
    if (!task) {
      return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return task.fetch(request);
  },
};
