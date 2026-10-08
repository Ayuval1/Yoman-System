// הוק פתיחת סשן בפרויקט Yoman-System: מזריק הוראה להפעיל את הסקיל הפרויקטלי full-open לפני כל תשובה.
// קורא רק מ-stdin את מה ש-Claude Code שולח (אינו נחוץ) ומדפיס JSON. אין בו סודות, רשת או כתיבה לדיסק.
const message = [
  'MANDATORY SESSION START ACTION (Yoman-System): invoke the project skill `full-open` RIGHT NOW,',
  'before responding to the first message, even if the message is urgent or a plain greeting.',
  'Use full-open INSTEAD of session-manager for this project: do not rely on session-manager,',
  'and do not touch Notion (not in use since 8.10.2026).',
  'full-open = read the latest handoff note, sync real state (git, deploy, tests), report skills availability,',
  'read the project memory file, list what waits for Yuval (with exact secret NAMES), then one-screen report',
  'in Plan mode with exactly one question. Hebrew only, male form, short.',
].join(' ');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message },
}));
