#!/usr/bin/env python
"""close-session.py - סגירת סשן אוטומטית: ענף -> commit -> push -> PR -> מיזוג -> איפוס main מקומי.

מחליף את הרצף הידני שנעשה 8 פעמים בסוף סשן. Python stdlib בלבד.

מצבים:
  ברירת מחדל = DRY RUN: מריץ את כל הבדיקות ומדפיס מה היה קורה. לא עושה
  add/commit/push, לא יוצר ענף, לא קורא ל-gh. (מותר בו רק git fetch, שקורא מצב מרוחק.)
  --apply = מבצע בפועל, בסדר: ענף, git add -A, git commit -F, git push -u,
  gh pr create, gh pr merge --merge (לא squash), git checkout <main>, git pull --ff-only.
  --skip-github = עוצר אחרי ה-push.

כללי הבטיחות (מתוך CLAUDE.md של הפרויקט):
  * אף פעם לא דוחפים ל-main ישירות; הכול דרך ענף ו-PR. אין --force, אין --no-verify,
    אין מחיקת ענפים, ו-git add -A מכבד .gitignore (לא מוסיפים קבצים מוחרגים).
  * מחיקת קבצים קיימים דורשת --allow-delete. שינוי תוכן של אפיון.md או של
    03-permissions-rules.md (כל נתיב שמסתיים בהם) דורש --protected-approved. שינוי שם בלבד
    (דמיון 100%) מותר.
  * הודעת ה-commit נקראת מקובץ (git commit -F), לא ממחרוזת, כי מרכאות שברו commit ב-PowerShell.
    נוספת אוטומטית שורת Co-Authored-By, ובגוף ה-PR שורת Generated with Claude Code.
  * ערכים של סודות אף פעם לא מודפסים; רק 2 תווים ראשונים ו-***.

סריקת הסודות היא רשת ביטחון מיטבית (best-effort), לא ערובה: היא בודקת רק שורות שנוספו
ותוכן מלא של קבצים חדשים (טקסט, לא בינארי; בלי node_modules וקובצי lock), לפי כמה תבניות
מוכרות. סוד בפורמט שלא מוכר לה, מפוצל על כמה שורות או מקודד, יעבור. שמות משתני סביבה לבדם
(למשל INTAKE_SECRET) בסדר; רק ערך ארוך אחרי = או : נתפס. לא להסתמך עליה במקום עין אנושית.

הבדיקה נעשית מול נקודת המפגש (merge-base) של הענף עם origin/<main>, כדי ששינויים של אחרים
ב-main לא ייראו כמחיקות שלך. קוד יציאה: 0 הצלחה או dry-run תקין, 1 כל כשל.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TRAILER = "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
PR_FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
PROTECTED_SUFFIXES = ("אפיון.md", "03-permissions-rules.md")
LOCK_NAMES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock"}
SECRET_PATTERNS = [
    ("מפתח/סיסמה/טוקן בהשמה", re.compile(
        r"(secret|token|password|passwd|api[_-]?key|authorization|bearer)\s*[:=]\s*['\"]?([A-Za-z0-9_\-/+=]{16,})",
        re.I)),
    ("GitHub token (ghp_)", re.compile(r"ghp_[A-Za-z0-9]{20,}")),
    ("GitHub token (github_pat_)", re.compile(r"github_pat_[A-Za-z0-9_]{20,}")),
    ("מפתח sk-", re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("טוקן Slack", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
    ("חיבור Postgres עם סיסמה", re.compile(r"postgres(?:ql)?://[^\s:@/]+:[^\s@]+@")),
    ("מפתח פרטי", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
]
ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GH_PROMPT_DISABLED": "1", "PYTHONIOENCODING": "utf-8"}


class StepError(Exception):
    pass


def run(args, cwd, check=True):
    """מריץ פקודה, תופס פלט, וזורק StepError ברור אם נכשלה."""
    try:
        p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", env=ENV)
    except OSError as e:
        raise StepError(f"לא ניתן להריץ את {args[0]}: {e}")
    if check and p.returncode != 0:
        shown = ["git", *args[3:5]] if args[1:2] == ["-c"] else args[:3]
        raise StepError(f"הפקודה נכשלה ({' '.join(shown)}):\n{(p.stderr or p.stdout).strip()}")
    return p


def git(root, *args, check=True):
    return run(["git", "-c", "core.quotepath=false", *args], root, check)


class Report:
    def __init__(self):
        self.fails = 0

    def ok(self, text):
        print(f"[תקין]  {text}")

    def fail(self, text):
        self.fails += 1
        print(f"[נכשל]  {text}")

    def warn(self, text):
        print(f"[אזהרה] {text}")


def find_root(arg):
    start = Path(arg) if arg else Path(__file__).resolve().parent
    return Path(git(start, "rev-parse", "--show-toplevel").stdout.strip())


def default_branch(root):
    p = git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD", check=False)
    return p.stdout.strip().removeprefix("origin/") if p.returncode == 0 and p.stdout.strip() else "main"


def resolve_base(root, default, rep):
    """מחזיר (ref של הבסיס, נקודת-ההשוואה לבדיקות)."""
    if git(root, "fetch", "origin", check=False).returncode != 0:
        rep.warn(f"git fetch נכשל; ממשיכים מול {default} המקומי")
        base = default
    else:
        base = f"origin/{default}"
    if git(root, "rev-parse", "--verify", "-q", base, check=False).returncode != 0:
        raise StepError(f"הענף {base} לא קיים, אין מול מה להשוות")
    mb = git(root, "merge-base", base, "HEAD", check=False).stdout.strip()
    return base, mb or base


def parse_z(out, with_status):
    tokens = [t for t in out.split("\0") if t != ""]
    items, i = [], 0
    while i < len(tokens):
        if not with_status:
            items.append(("?", tokens[i], None)); i += 1
        elif tokens[i][0] in "RC":
            items.append((tokens[i], tokens[i + 2], tokens[i + 1])); i += 3
        else:
            items.append((tokens[i], tokens[i + 1], None)); i += 2
    return items


def collect_changes(root, diff_base):
    tracked = parse_z(git(root, "diff", "--name-status", "-M", "-z", diff_base).stdout, True)
    untracked = parse_z(git(root, "ls-files", "--others", "--exclude-standard", "-z").stdout, False)
    return tracked, untracked


def check_deletes(changes, allow, rep):
    deleted = [p for s, p, _ in changes if s.startswith("D")]
    if not deleted:
        rep.ok("אין מחיקת קבצים")
    elif allow:
        rep.ok(f"{len(deleted)} קבצים נמחקים (אושר עם --allow-delete)")
    else:
        rep.fail("מחיקת קבצים דורשת --allow-delete: " + ", ".join(deleted))


def check_protected(changes, approved, rep):
    hit = [p for s, p, old in changes
           if (s[0] in "MT" or (s[0] == "R" and s != "R100"))
           and (p.endswith(PROTECTED_SUFFIXES) or (old or "").endswith(PROTECTED_SUFFIXES))]
    if not hit:
        rep.ok("לא שונה תוכן של קובץ מוגן (אפיון / 03-permissions-rules)")
    elif approved:
        rep.ok("שונה תוכן של קובץ מוגן (אושר עם --protected-approved): " + ", ".join(hit))
    else:
        rep.fail("שינוי תוכן בקובץ מוגן דורש --protected-approved: " + ", ".join(hit))


def skip_scan(path):
    p = Path(path)
    return "node_modules" in p.parts or p.name in LOCK_NAMES or p.suffix == ".lock"


def added_lines(diff_text):
    """מפיק (קובץ, מספר שורה, טקסט) לכל שורה שנוספה בדיף -U0."""
    path, lineno, in_hunk = None, 0, False
    for line in diff_text.splitlines():
        if line.startswith("diff --git"):
            path, in_hunk = None, False
        elif in_hunk and line.startswith("+"):
            if path:
                yield path, lineno, line[1:]
            lineno += 1
        elif line.startswith("@@"):
            lineno, in_hunk = int(re.match(r"@@ -\S+ \+(\d+)", line).group(1)), True
        elif line.startswith("+++ "):
            p = line[4:].split("\t")[0]
            path = None if p == "/dev/null" else p[2:]


def mask(m):
    value = m.group(m.lastindex) if m.lastindex else m.group(0)
    return value[:2] + "***"


def scan_line(path, lineno, text, hits):
    for name, rx in SECRET_PATTERNS:
        m = rx.search(text)
        if m:
            hits.append(f"{path}:{lineno}  {name}  ערך: {mask(m)}")


def scan_secrets(root, diff_base, untracked, rep):
    diff = git(root, "diff", "-U0", "--no-color", "--no-ext-diff", "--no-textconv",
               "--src-prefix=a/", "--dst-prefix=b/", diff_base).stdout
    hits = []
    for path, lineno, text in added_lines(diff):
        if not skip_scan(path):
            scan_line(path, lineno, text, hits)
    for _, path, _ in untracked:
        f = root / path
        if skip_scan(path) or not f.is_file() or f.stat().st_size > 2_000_000:
            continue
        data = f.read_bytes()
        if b"\0" in data[:8000]:
            continue
        for n, text in enumerate(data.decode("utf-8", errors="replace").splitlines(), 1):
            scan_line(path, n, text, hits)
    if hits:
        rep.fail("נמצאו סודות אפשריים (הערך מוסתר):")
        for h in hits:
            print("          " + h)
    else:
        rep.ok("סריקת סודות: לא נמצא כלום (רשת ביטחון חלקית, לא ערובה)")


def pointer_check(root):
    script = root / ".claude/skills/yoman-builder/scripts/check-pointers.py"
    if not script.exists():
        return
    out = run([sys.executable, str(script)], root, check=False).stdout.splitlines()
    summary = [l for l in out if re.match(r"^[A-Z] \S", l)]
    last = [l for l in out if l.strip()][-1:]
    print("[מידע]  בדיקת מצביעים:")
    for l in summary + last:
        print("          " + l)


def plan_branch(root, default, requested, rep):
    """מחזיר (שם ענף, האם ליצור אותו). מדווח כשל דרך rep."""
    current = git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
    if current == "HEAD":
        rep.fail("HEAD במצב detached; עברו לענף לפני הסגירה")
    elif current in {default, "main", "master"}:
        if not requested:
            rep.fail(f"אתה על {current} ויש שינויים: חובה לציין --branch NAME")
        elif git(root, "check-ref-format", "--branch", requested, check=False).returncode != 0:
            rep.fail(f"שם ענף לא תקין: {requested}")
        elif git(root, "rev-parse", "--verify", "-q", f"refs/heads/{requested}", check=False).returncode == 0:
            rep.fail(f"הענף {requested} כבר קיים; בחר שם אחר")
        else:
            rep.ok(f"ייווצר ענף חדש {requested} מה-HEAD הנוכחי")
            return requested, True
    elif requested and requested != current:
        rep.fail(f"אתה על הענף {current} אבל --branch הוא {requested}")
    else:
        rep.ok(f"עובדים על הענף הקיים {current}")
        return current, False
    return None, False


def ensure_line(text, line):
    """מבטיח ש-line מופיעה בדיוק פעם אחת, בסוף הטקסט."""
    kept = [l for l in text.replace("\r\n", "\n").split("\n") if l.strip() != line]
    return "\n".join(kept).rstrip() + "\n\n" + line + "\n"


def read_text_file(path, label, rep):
    try:
        text = Path(path).read_text(encoding="utf-8-sig")
    except OSError as e:
        rep.fail(f"לא ניתן לקרוא את {label}: {e}")
        return None
    if not text.strip():
        rep.fail(f"{label} ריק")
        return None
    return text


def write_temp(text, suffix):
    fd, name = tempfile.mkstemp(suffix=suffix, prefix="close-session-")
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return name


def apply_all(root, a, default, branch, create, message, body):
    """מבצע בפועל. state מתאר ל-StepError מה מצב המאגר אם נעצרנו."""
    tmp_files, state = [], "לא בוצע דבר במאגר"
    try:
        if create:
            git(root, "checkout", "-b", branch)
            state = f"נוצר ענף {branch} ועברנו אליו; אין עדיין commit"
        git(root, "add", "-A")
        state = f"הקבצים הוכנסו ל-staging בענף {branch}; אין עדיין commit חדש"
        if git(root, "diff", "--cached", "--quiet", check=False).returncode == 0:
            print("אין שינויים חדשים ל-commit; ממשיכים עם ה-commits שכבר בענף")
        else:
            msg_file = write_temp(message, ".txt"); tmp_files.append(msg_file)
            git(root, "commit", "-F", msg_file)
            state = f"ה-commit נוצר מקומית בענף {branch}; עדיין לא נדחף"
        git(root, "push", "-u", "origin", branch)
        state = f"הענף {branch} נדחף ל-origin; אין PR"
        print(f"נדחף: {branch}")
        if a.skip_github:
            print("--skip-github: עוצרים אחרי ה-push. לא נוצר PR ולא בוצע מיזוג.")
            return
        body_file = write_temp(body, ".md"); tmp_files.append(body_file)
        out = run(["gh", "pr", "create", "--base", default, "--head", branch,
                   "--title", a.pr_title, "--body-file", body_file], root).stdout
        m = re.search(r"https://\S+/pull/(\d+)", out)
        if not m:
            raise StepError(f"gh לא החזיר כתובת PR מובנת. פלט:\n{out.strip()}")
        url, number = m.group(0), m.group(1)
        state = f"נוצר PR {url} אבל לא מוזג; הענף {branch} ב-origin"
        print(f"נוצר PR: {url}")
        run(["gh", "pr", "merge", number, "--merge"], root)
        state = f"ה-PR {url} מוזג, אבל main המקומי עוד לא עודכן (אתה על {branch})"
        print("ה-PR מוזג (merge רגיל).")
        git(root, "checkout", default)
        git(root, "pull", "--ff-only", "origin", default)
        print("--- git log --oneline -3 ---\n" + git(root, "log", "--oneline", "-3").stdout.strip())
        print("--- git status --short ---\n" + (git(root, "status", "--short").stdout.strip() or "(נקי)"))
        print(f"כתובת ה-PR: {url}")
    except StepError as e:
        print(f"\nשגיאה: {e}\nמצב המאגר כרגע: {state}")
        raise SystemExit(1)
    finally:
        for f in tmp_files:
            Path(f).unlink(missing_ok=True)


def parse_args():
    p = argparse.ArgumentParser(description="סגירת סשן: ענף, commit, push, PR, מיזוג (ברירת מחדל: dry-run)")
    p.add_argument("--message-file", required=True)
    p.add_argument("--pr-title", required=True)
    p.add_argument("--pr-body-file", required=True)
    p.add_argument("--branch")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--skip-github", action="store_true")
    p.add_argument("--allow-delete", action="store_true")
    p.add_argument("--protected-approved", action="store_true")
    p.add_argument("--root")
    return p.parse_args()


def main():
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding="utf-8")
    a, rep = parse_args(), Report()
    try:
        root = find_root(a.root)
        default = default_branch(root)
        print(f"מצב: {'APPLY (מבצע בפועל)' if a.apply else 'DRY RUN (לא משנה כלום)'} | מאגר: {root}")
        base, diff_base = resolve_base(root, default, rep)
        tracked, untracked = collect_changes(root, diff_base)
        changes = tracked + untracked
        ahead = int(git(root, "rev-list", "--count", f"{base}..HEAD").stdout.strip() or 0)
        has_work = bool(changes) or ahead > 0
        if not has_work:
            rep.fail(f"אין מה לסגור: אין שינויים ואין commits לפני {base}")
            return 1
        rep.ok(f"יש מה לסגור ({len(changes)} קבצים בשינוי, {ahead} commits לפני {base})")
        branch, create = plan_branch(root, default, a.branch, rep)
        message = read_text_file(a.message_file, "קובץ ההודעה", rep)
        body = read_text_file(a.pr_body_file, "קובץ גוף ה-PR", rep)
        if not a.skip_github and shutil.which("gh") is None:
            rep.fail("gh לא מותקן או לא ב-PATH (אפשר להשתמש ב---skip-github)")
        check_deletes(changes, a.allow_delete, rep)
        check_protected(tracked, a.protected_approved, rep)
        scan_secrets(root, diff_base, untracked, rep)
        pointer_check(root)
    except StepError as e:
        print(f"[נכשל]  {e}")
        return 1
    print(f"\nקבצים שייכנסו ל-commit ({len(changes)}):")
    for s, p, old in changes:
        print(f"  {'A' if s == '?' else s:<5} {(old + ' -> ') if old else ''}{p}")
    if message and body:
        message, body = ensure_line(message, TRAILER), ensure_line(body, PR_FOOTER)
        print(f"\nהודעת commit:\n  " + "\n  ".join(message.rstrip().splitlines()))
        print(f"כותרת PR: {a.pr_title}")
    if rep.fails:
        print(f"\nנכשלו {rep.fails} בדיקות. לא מבצעים כלום.")
        return 1
    if not a.apply:
        steps = ["ענף: " + (f"יצירת {branch}" if create else f"קיים ({branch})"), "git add -A", "git commit -F <קובץ>",
                 f"git push -u origin {branch}"]
        if not a.skip_github:
            steps += [f"gh pr create --base {default} --head {branch}", "gh pr merge --merge",
                      f"git checkout {default}", f"git pull --ff-only origin {default}"]
        print("\nמה היה קורה עם --apply:\n  " + "\n  ".join(steps))
        print("\nכל הבדיקות תקינות. להרצה אמיתית הוסף --apply.")
        return 0
    apply_all(root, a, default, branch, create, message, body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
