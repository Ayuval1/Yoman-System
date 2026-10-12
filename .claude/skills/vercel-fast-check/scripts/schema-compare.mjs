// מדפיס שאילתת SELECT אחת (קריאה בלבד) שמשווה את המסד החי ל-db/schema.sql, בשני כיוונים, מול information_schema.columns.
// שימוש: node .claude/skills/vercel-fast-check/scripts/schema-compare.mjs   (הפלט הוא השאילתה; מדווח ל-stderr על ספירה ועל שורות שלא פוענחו)
// איך קוראים את התוצאה בעורך של Neon: שורה אחת "table_count" = הכול תואם. שורת missing_in_db = עמודה שיש בקובץ ואין במסד (או בסוג אחר). שורת extra_in_db = עמודה שיש במסד ואין בקובץ.
// מה לא נבדק כאן: אילוצים, אינדקסים, ברירות מחדל ו-NOT NULL (נבדקות רק עמודות: שם וסוג). נוצר 12.10.2026 מהרצה אמיתית: 23 טבלאות, 192 עמודות, אפס סטיות.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sql = readFileSync(resolve(root, 'db/schema.sql'), 'utf8');

// הסוג כפי שמופיע ב-schema.sql -> הסוג כפי ש-information_schema.columns.data_type מחזיר.
const TYPES = {
  uuid: 'uuid',
  text: 'text',
  integer: 'integer',
  int: 'integer',
  boolean: 'boolean',
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  date: 'date',
  time: 'time without time zone',
  jsonb: 'jsonb',
  bigint: 'bigint',
  smallint: 'smallint',
  numeric: 'numeric',
};

const tables = [];
const unknown = [];
const createTable = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\);/g;
let match;
while ((match = createTable.exec(sql))) {
  const columns = [];
  for (const raw of match[2].split(/\r?\n/)) { // schema.sql נשמר עם CRLF: בלי זה `.` לא תופס את סוף שורת ההערה
    const line = raw.replace(/--.*$/, '').trim().replace(/,$/, '');
    if (!line) continue;
    if (/^(PRIMARY|UNIQUE|CONSTRAINT|FOREIGN|CHECK)\b/i.test(line)) continue; // אילוצי טבלה אינם עמודות
    const parsed = /^(\w+)\s+(\w+)/.exec(line);
    const dataType = parsed ? TYPES[parsed[2].toLowerCase()] : undefined;
    if (!parsed || !dataType) {
      unknown.push(`${match[1]}: ${line}`);
      continue;
    }
    columns.push(`${parsed[1]}:${dataType}`);
  }
  tables.push([match[1], columns]);
}

const total = tables.reduce((sum, [, columns]) => sum + columns.length, 0);
process.stderr.write(`טבלאות: ${tables.length}, עמודות: ${total}\n`);
if (unknown.length > 0) process.stderr.write(`UNKNOWN (לא פוענחו, לבדוק ידנית):\n${unknown.join('\n')}\n`);

// הצורה המקוצרת (טבלה + רשימת "עמודה:סוג" במחרוזת אחת) קצרה בהרבה מ-VALUES לכל עמודה, וזה חשוב להקלדה בעורך.
const values = tables.map(([table, columns]) => `('${table}','${columns.join(',')}')`).join(',');
const query = [
  `WITH e AS (SELECT v.t, split_part(x,':',1) AS c, split_part(x,':',2) AS ty FROM (VALUES ${values}) AS v(t,cols), regexp_split_to_table(v.cols, ',') AS x)`,
  `SELECT 'missing_in_db' AS side, e.t, e.c, e.ty FROM e WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns i WHERE i.table_schema='public' AND i.table_name=e.t AND i.column_name=e.c AND i.data_type=e.ty)`,
  `UNION ALL SELECT 'extra_in_db', i.table_name::text, i.column_name::text, i.data_type::text FROM information_schema.columns i WHERE i.table_schema='public' AND i.table_name IN (SELECT DISTINCT t FROM e) AND NOT EXISTS (SELECT 1 FROM e WHERE e.t=i.table_name AND e.c=i.column_name)`,
  `UNION ALL SELECT 'table_count', count(DISTINCT t)::text, count(*)::text, '' FROM e`,
].join(' ');

process.stdout.write(`${query}\n`);
