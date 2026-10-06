#!/usr/bin/env python3
"""בדיקת מצביעים (קרוס-רפרנסים) בין קבצי הפרויקט. קריאה בלבד.

מה זה עושה:
  סורק קבצי טקסט שמנוהלים ב-git (md, js, sql, json, py, txt) ובודק שההפניות בהם
  עדיין מתחברות לקובץ אמיתי, ושמספרי השורות שהן מציינות עדיין קיימים.
  סוגי מצביעים:
    A  נתיב מלא או חלקי, למשל docs/NN-שם.md (נבדק מילולית מול הדיסק)
    B  שם קובץ בלי נתיב. חייב להתאים לקובץ אחד בדיוק (ב-docs/ רקורסיבית, ואם אין שם, בשאר הריפו)
    C  קובץ:שורה, למשל NN:שורה, או שם.md:שורה, כולל טווחים (a-b) ורשימות (a,b)
       קידומת מספרית קצרה NN פירושה הקובץ היחיד ב-docs/ ששמו מתחיל ב-NN-.
       קידומת עם כמה קבצים (למשל 03) מדווחת כדו-משמעית ואינה מנוחשת.

עקרונות:
  * הסקריפט לא משנה אף קובץ. הוא רק קורא ומדפיס.
  * דיוק לפני כיסוי: כשלא ברור שזה מצביע (שעות כמו 07:30, כתובות, תבניות עם
    NN או כוכבית, קובץ שאינו מסמך ולא נמצא) הוא מדלג וסופר את זה כ"דולג/דו-משמעי".
  * NN:שורה נחשב מצביע רק בתוך backticks, או אחרי docs/, או אחרי שם קובץ.
  * הפלט דטרמיניסטי (ממוין, בלי חותמות זמן, נתיבים עם סלאש), כדי שאפשר להשוות לפני ואחרי.
  * הסקריפט לא שופט משמעות: הוא מציג 60 תווים מהשורה שאליה מצביעים, והעין האנושית מחליטה.
  * קוד יציאה: 0 אם אין מצביעים שבורים, 1 אחרת.

הרצה:
  python .claude/skills/yoman-builder/scripts/check-pointers.py [--root נתיב] [--lines] [--skipped]
    --lines    להדפיס גם כל מצביע קובץ:שורה תקין עם תצוגה מקדימה של שורת היעד
    --skipped  להדפיס גם את המצביעים שדולגו, עם סיבה
"""
import argparse
import os
import re
import subprocess
import sys

TEXT_EXTS = (".md", ".js", ".sql", ".json", ".py", ".txt")
SKIP_PREFIXES = ("plugins/", "memory/")
SKIP_NAMES = ("package-lock.json", "yoman-system-export.zip")
IGNORED_DIRS = {".git", "node_modules"}

LINES = r"\d+(?:[-–]\d+)?(?:,\d+(?:[-–]\d+)?)*"
EXT = r"\.(?:md|py|js|sql|json|txt)(?![A-Za-z0-9_])"
NAME = r"(?:[A-Za-z0-9][A-Za-z0-9_\-]*|אפיון)"
# סדר החלופות חשוב: docs/NN קצר, אחר כך קובץ עם סיומת, ואחר כך `NN:שורה` בתוך backticks.
POINTER_RE = re.compile(
    r"(?<![A-Za-z0-9_./<>*{}$~…א-ת])docs/(?P<short>\d{2})(?![A-Za-z0-9_\-/.])(?::(?P<sl>" + LINES + r"))?"
    r"|(?<![A-Za-z0-9_./<>*{}$~…א-ת])(?P<path>(?:[A-Za-z0-9_.][A-Za-z0-9_.\-]*/)*" + NAME + EXT + r")(?::(?P<pl>" + LINES + r"))?"
    r"|`(?P<stem>[A-Za-z0-9][A-Za-z0-9_\-]*):(?P<bl>" + LINES + r")`"
)
URL_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.\-]*://\S+")


def build_index(root):
    """כל קבצי הריפו (בלי .git ו-node_modules): קבוצת נתיבים ומילון שם-קובץ לנתיבים."""
    paths, by_base = set(), {}
    for cur, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED_DIRS)
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(cur, f), root).replace(os.sep, "/")
            paths.add(rel)
            by_base.setdefault(f, []).append(rel)
    return paths, by_base


def list_sources(root):
    """קבצי המקור לסריקה לפי git ls-files, וכמה דולגו."""
    out = subprocess.run(["git", "-C", root, "ls-files", "-z"], capture_output=True)
    if out.returncode != 0:
        print("שגיאה: git ls-files נכשל. ודא ש---root מצביע על ריפו git.", file=sys.stderr)
        sys.exit(2)
    tracked = [p for p in out.stdout.decode("utf-8").split("\0") if p]
    sources, skipped = [], 0
    for p in sorted(tracked):
        if not p.endswith(TEXT_EXTS):
            continue
        if p.startswith(SKIP_PREFIXES) or "node_modules/" in p or os.path.basename(p) in SKIP_NAMES:
            skipped += 1
        else:
            sources.append(p)
    return sources, skipped


def read_lines(root, rel):
    """שורות הקובץ כפי שעורך מציג אותן (פיצול לפי \\n בלבד)."""
    with open(os.path.join(root, rel), encoding="utf-8", errors="replace") as fh:
        lines = fh.read().split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return [ln.rstrip("\r") for ln in lines]


def placeholder_before(text, start):
    """True אם לפני השם יש תבנית כמו 03-<תחום>- או 03-*-, כלומר זה לא שם קובץ אמיתי."""
    i = start
    while i > 0 and text[i - 1] == "-":
        i -= 1
    return i < start and i > 0 and text[i - 1] in "<>*{}$…"


def parse_lines(spec):
    """'33,51' או '54-57' -> רשימת זוגות (מ, עד)."""
    parts = []
    for item in spec.split(","):
        a, _, b = item.replace("–", "-").partition("-")
        parts.append((int(a), int(b) if b else int(a)))
    return parts


class Checker:
    def __init__(self, root):
        self.root = root
        self.paths, self.by_base = build_index(root)
        self.docs_files = sorted(p for p in self.paths if p.startswith("docs/"))
        self.top_dirs = {p.split("/")[0] for p in self.paths if "/" in p}
        self.cache = {}

    def file_lines(self, rel):
        if rel not in self.cache:
            self.cache[rel] = read_lines(self.root, rel)
        return self.cache[rel]

    def by_prefix(self, nn):
        return [p for p in self.docs_files if os.path.basename(p).startswith(nn + "-")]

    def resolve_name(self, base):
        """שם בלי נתיב -> (סטטוס, יעד/סיבה). הקבוצה הראשונה שיש בה קובץ קובעת."""
        found = self.by_base.get(base, [])
        # עדיפות: docs/, אחר כך שורש הריפו, אחר כך סקיל yoman-builder, ורק אז כל השאר.
        tiers = (
            [p for p in found if p.startswith("docs/")],
            [p for p in found if "/" not in p],
            [p for p in found if p.startswith(".claude/skills/yoman-builder/")],
            found,
        )
        pool = next((t for t in tiers if t), [])
        if len(pool) == 1:
            return "ok", pool[0]
        if len(pool) > 1:
            return "skip", "דו-משמעי: " + ", ".join(sorted(pool)[:3]) + (" ..." if len(pool) > 3 else "")
        if base.endswith(".md"):
            return "broken", "קובץ לא נמצא בשום מקום בריפו"
        return "skip", "קובץ שאינו מסמך ולא נמצא (ייתכן שעוד לא נבנה)"

    def resolve_path(self, p):
        """נתיב עם סלאש: docs/ נבדק מילולית; אחרים גם לפי סיומת נתיב יחידה."""
        if p.startswith("./"):
            p = p[2:]
        if ".." in p.split("/"):
            return "skip", "נתיב עם .."
        if p in self.paths:
            return "ok", p
        top = p.split("/")[0]
        if p.startswith("docs/") or top in self.top_dirs:
            return "broken", "הקובץ לא קיים בנתיב הזה"
        tails = sorted(x for x in self.paths if x.endswith("/" + p))
        if len(tails) == 1:
            return "ok", tails[0]
        if len(tails) > 1:
            return "skip", "דו-משמעי: " + ", ".join(tails[:3])
        return "skip", "תיקייה ראשית שלא קיימת בריפו (ייתכן שמדובר בריפו אחר או בקובץ עתידי)"

    def resolve_short(self, nn):
        found = self.by_prefix(nn)
        if len(found) == 1:
            return "ok", found[0]
        if len(found) > 1:
            return "skip", f"קידומת {nn} דו-משמעית ({len(found)} קבצים)"
        return "broken", f"אין קובץ ב-docs/ שמתחיל ב-{nn}-"

    def check_lines(self, target, spec):
        """מוודא שהשורות קיימות. מחזיר (None, [(שורה, תצוגה)]) או (סיבה, [])."""
        total = len(self.file_lines(target))
        previews = []
        for a, b in parse_lines(spec):
            if a < 1 or b < a:
                return f"טווח שורות לא תקין ({a}-{b})", []
            if b > total:
                return f"שורה {b} חורגת מסוף הקובץ ({target} כולל {total} שורות)", []
            previews.append((a, self.file_lines(target)[a - 1].strip()[:60]))
        return None, previews

    def classify(self, m, text):
        """מחזיר (סוג, טקסט המצביע, סטטוס, יעד/סיבה, תצוגות) או None אם זה לא מצביע."""
        if m.group("short"):
            nn, spec, raw = m.group("short"), m.group("sl"), m.group(0)
            ptype = "C" if spec else "A"
            status, info = self.resolve_short(nn)
        elif m.group("path"):
            path, spec, raw = m.group("path"), m.group("pl"), m.group(0)
            if placeholder_before(text, m.start()) or re.search(r"NN|XX", path):
                return ("C" if spec else "B"), raw, "skip", "תבנית/תחליף ולא שם קובץ אמיתי", []
            ptype = "C" if spec else ("A" if "/" in path else "B")
            status, info = self.resolve_path(path) if "/" in path else self.resolve_name(path)
        else:
            stem, spec, raw = m.group("stem"), m.group("bl"), m.group(0).strip("`")
            ptype = "C"
            if len(stem) == 2 and stem.isdigit():
                status, info = self.resolve_short(stem)
            else:
                status, info = self.resolve_name(stem + ".md")
                if status == "broken":
                    status, info = "skip", "לא שם של מסמך ידוע"
        previews = []
        if status == "ok" and spec:
            problem, previews = self.check_lines(info, spec)
            if problem:
                status, info = "broken", problem
        return ptype, raw.strip("`"), status, info, previews


def main():
    ap = argparse.ArgumentParser(description="בדיקת מצביעים בין קבצי הפרויקט (קריאה בלבד)")
    ap.add_argument("--root", default=None, help="שורש הריפו (ברירת מחדל: שלוש רמות מעל הסקריפט)")
    ap.add_argument("--lines", action="store_true", help="להציג גם מצביעי קובץ:שורה תקינים עם תצוגה מקדימה")
    ap.add_argument("--skipped", action="store_true", help="להציג גם מצביעים שדולגו")
    args = ap.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(args.root or os.path.join(here, "..", "..", "..", ".."))
    # ה-root הוא שלוש רמות מעל תיקיית הסקריפט: scripts -> yoman-builder -> skills -> .claude -> root
    self_rel = os.path.relpath(os.path.abspath(__file__), root).replace(os.sep, "/")

    checker = Checker(root)
    sources, skipped_files = list_sources(root)
    stats = {t: {"total": 0, "ok": 0, "broken": 0, "skip": 0} for t in "ABC"}
    rows = []  # (קובץ, שורה, טקסט, סוג, סטטוס, מידע, תצוגות)
    for rel in sources:
        if rel == self_rel:
            continue
        for lineno, text in enumerate(checker.file_lines(rel), 1):
            masked = URL_RE.sub(lambda u: " " * len(u.group(0)), text)
            for m in POINTER_RE.finditer(masked):
                res = checker.classify(m, masked)
                ptype, raw, status, info, previews = res
                stats[ptype]["total"] += 1
                stats[ptype][status] += 1
                rows.append((rel, lineno, raw, ptype, status, info, previews))
    rows.sort(key=lambda r: (r[0], r[1], r[2], r[3]))

    print(f"סורקים {len(sources)} קבצים. דולגו {skipped_files} קבצים (plugins/, memory/, node_modules, package-lock).")
    print("")
    print("== סיכום ==")
    for t, label in (("A", "A נתיב"), ("B", "B שם קובץ"), ("C", "C קובץ:שורה")):
        s = stats[t]
        print(f"{label}: סה\"כ {s['total']}, תקינים {s['ok']}, שבורים {s['broken']}, דולגו/דו-משמעיים {s['skip']}")
    broken = [r for r in rows if r[4] == "broken"]
    print("")
    print("== שבורים ==")
    for rel, lineno, raw, ptype, status, info, _ in broken:
        print(f"{rel}:{lineno} -> {raw} -> {info}")
    if not broken:
        print("(אין)")
    if args.lines:
        print("")
        print("== מצביעי קובץ:שורה תקינים ==")
        for rel, lineno, raw, ptype, status, info, previews in rows:
            if ptype == "C" and status == "ok":
                shown = " | ".join(f"[{n}] {t}" for n, t in previews)
                print(f"{rel}:{lineno} -> {raw} -> {info} -> {shown}")
    if args.skipped:
        print("")
        print("== דולגו ==")
        for rel, lineno, raw, ptype, status, info, _ in rows:
            if status == "skip":
                print(f"{rel}:{lineno} -> {raw} -> {info}")
    print("")
    print(f"מצביעים שבורים: {len(broken)}")
    sys.exit(1 if broken else 0)


if __name__ == "__main__":
    main()
