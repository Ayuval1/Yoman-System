-- סכמת מסד הנתונים, שלב 1 (Neon / Postgres).
-- מקורות: docs/06-db-schema.md (sources) · docs/17-step1-cloud-handoff.md סעיף 6 · docs/20-handoff-note-2026-10-05-close.md (טבלת השדות המוצעת).
-- כללים: מזהים uuid · כל הזמנים timestamptz · אין מחיקה פיזית (יש סטטוס) · מה שלא ידוע נשאר NULL.
-- הקובץ אידמפוטנטי: אפשר להריץ אותו כמה פעמים. הוא רק יוצר מה שחסר, ולא משנה טבלה קיימת.
-- לא בשלב 1: טבלת media ושאר הטבלאות (06).

-- ---------------------------------------------------------------------------
-- sources — ההודעה הגולמית כפי שהתקבלה. נוסח מחייב: docs/06-db-schema.md שורות 13-26.
-- media_url ירד (הוחלף בטבלת media, שאינה בשלב 1).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sources (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ערכים לפי 06: app · shortcut · calendar · system · file. בלי CHECK, כדי לא לנעול רשימה.
  -- הנחה, לא אומת: NOT NULL על channel (06 לא קובע; הקוד תמיד יודע את הערוץ)
  channel       text        NOT NULL,
  sender        text,                       -- כפי שהערוץ מדווח; NULL כשלא ידוע
  raw_content   text,                       -- הטקסט המקורי, בלי עיבוד
  content_hash  text,                       -- הנחה, לא אומת: sha256 (hex) של הטקסט בלבד. 06 לא מגדיר אלגוריתם ולא מה נכנס לחישוב
  -- הנחה, לא אומת: NOT NULL על received_at (06 לא קובע; הוא תמיד ידוע ברגע הקליטה)
  received_at   timestamptz NOT NULL,       -- בהודעה מהקיצור: רגע ההעברה, לא רגע השליחה המקורי (06)
  processed_at  timestamptz                 -- ריק עד שהטיפול הסתיים
);

-- ---------------------------------------------------------------------------
-- alarms — שעונים. הדרישות: docs/17 סעיף 6 ("claim אטומי ומצבים, מפתח ייחודי לכל שעון"), build-rules 26, 30.
-- כל השדות והערכים כאן: הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alarms (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text        NOT NULL,                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (אילו סוגים קיימים - לא מוגדר)
  payload      jsonb,                                      -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  fire_at      timestamptz NOT NULL,                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  timezone     text        NOT NULL DEFAULT 'Asia/Jerusalem', -- כלל חוזר נושא אזור זמן (docs/17:58). "מחר" אינו "+24 שעות"
  all_day      boolean     NOT NULL DEFAULT false,         -- דגל all_day נדרש (docs/17:58)
  -- הנחה, לא אומת: ערכי status: pending / claimed / done / failed / cancelled (הצעה מ-docs/20:21, לא אושרה סופית). בלי CHECK.
  status       text        NOT NULL DEFAULT 'pending',
  claimed_by   text,                                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  claimed_at   timestamptz,                                -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  lease_until  timestamptz,                                -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  attempts     integer     NOT NULL DEFAULT 0,             -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  last_error   text,                                       -- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית
  dedupe_key   text        NOT NULL UNIQUE,                -- מפתח ייחודי לכל שעון (docs/17:54)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- הנחה, לא אומת: האינדקס הוא רעיון שלי לשליפת "מה הגיע זמנו"; לא מוגדר באף מסמך
CREATE INDEX IF NOT EXISTS alarms_status_fire_at_idx ON alarms (status, fire_at);

-- ה-CLAIM האטומי (build-rules 26: שעון לא ירוץ פעמיים). לא רץ בשלב 1; מתועד כאן כדי שיהיה מוכן לשלב שיפעיל שעונים.
-- ההצעה (הנחה, לא אומת: ההצעה שלי, לא אושרה סופית):
--   * משתמשים ב-FOR UPDATE SKIP LOCKED בתוך UPDATE אחד, כך ששתי ריצות מקבילות לעולם לא תופסות אותו שעון.
--   * lease: 5 דקות (הנחה, לא אומת: המשך lease לא הוגדר באף מסמך).
--   * שעון "claimed" שה-lease שלו פג חוזר להיתפס (הנחה, לא אומת: מדיניות התאוששות לא הוגדרה).
--   $1 = מזהה הריצה (claimed_by), $2 = כמה שעונים לכל היותר.
--
-- UPDATE alarms
--    SET status      = 'claimed',
--        claimed_by  = $1,
--        claimed_at  = now(),
--        lease_until = now() + interval '5 minutes',
--        attempts    = attempts + 1,
--        updated_at  = now()
--  WHERE id IN (
--          SELECT id
--            FROM alarms
--           WHERE (status = 'pending' AND fire_at <= now())
--              OR (status = 'claimed' AND lease_until < now())
--           ORDER BY fire_at
--           LIMIT $2
--             FOR UPDATE SKIP LOCKED
--        )
-- RETURNING *;

-- ---------------------------------------------------------------------------
-- push_subscriptions — מנויי דחיפה. דרישות: docs/17:55-56, build-rules 27-28.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות). אין מחיקה פיזית: מנוי שקיבל 410 מסומן בסטטוס.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint            text        NOT NULL UNIQUE,
  p256dh              text        NOT NULL,   -- מפתחות המנוי. הנחה, לא אומת: שמות העמודות (p256dh, auth) לפי שמות המפתחות במנוי Web Push; לא מוגדרים ב-docs/20
  auth                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'active',  -- הנחה, לא אומת: ערכים active / gone_410
  last_sent_at        timestamptz,
  last_status         integer,                -- קוד ה-HTTP האחרון (429 חל על בקשות רצופות לאותו מכשיר, docs/17:55)
  retry_after         timestamptz,            -- הנחה, לא אומת: כשעון ולא כמספר שניות
  -- הנחה, לא אומת: העמודה הזו היא הצעה שלי, לא ב-docs/20; נועדה לתמוך ב"JWT של VAPID מתחדש פעם בשעה לכל היותר" (docs/17:55)
  vapid_jwt_issued_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- dedupe בשליחה (build-rules 28, step_retrying): לא הוגדרה עמודה. הכלל מדבר על שליחה ולא על מנוי,
-- ולכן לא הוספתי עמודה כאן; ההכרעה לשלב 4.

-- ---------------------------------------------------------------------------
-- watch_channels — ערוץ watch של Google Calendar. אחד לכל יומן.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות). הערוץ עצמו מתחיל בשלב 5.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_channels (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id      text        NOT NULL UNIQUE,   -- UNIQUE = ערוץ אחד לכל יומן
  channel_id       text,
  resource_id      text,
  sync_token       text,
  expires_at       timestamptz,
  status           text        NOT NULL DEFAULT 'active', -- הנחה, לא אומת: ערכי הסטטוס לא הוגדרו
  last_notified_at timestamptz
);

-- ---------------------------------------------------------------------------
-- call_log — יומן קריאות. docs/17:57: "גם שגיאות 429 וסוג הקריאה". Vercel שומר לוגים שעה בלבד (docs/17:71).
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS call_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text        NOT NULL,       -- סוג הקריאה
  status_code integer,                    -- כולל 429
  ok          boolean     NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  error       text
);

-- ---------------------------------------------------------------------------
-- probe_log — תוצאות בדיקות (probes) שנשמרות במסד כי הלוגים של Vercel ב-Hobby נשמרים שעה בלבד.
-- הנחה, לא אומת: הצעה מ-docs/20:21, לא אושרה סופית (כל השדות).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS probe_log (
  id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  probe  text        NOT NULL,
  ok     boolean     NOT NULL,
  detail text,
  at     timestamptz NOT NULL DEFAULT now()
);
