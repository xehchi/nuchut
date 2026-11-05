// שלב אבחון זמני ב-CI: מריץ את electron-builder ומדפיס שורה לפני כל תגובה של
// ChildProcess — כך רואים בדיוק על איזו פקודה הבנייה נתקעת או נכשלת, גם בלי הודעה.
// נמחק מיד כשמתגלה הסיבה. שימוש: node tools/ci-debug.js
const cp = require('child_process');

const MAX = 1500;
const clip = (s) => {
  const t = String(s).replace(/\x1b\[\d+m/g, '').replace(/\s+/g, ' ');
  return t.length > MAX ? t.slice(0, MAX) + ' …[+' + (t.length - MAX) + ']' : t;
};

for (const name of ['execFile', 'spawn']) {
  const orig = cp[name];
  cp[name] = function patched(...args) {
    const label = name === 'execFile' ? `${args[0]} ${(args[1] || []).join(' ')}` : String(args[0]);
    console.log(`[ci-debug] ${name}: ${clip(label)}`);
    const child = orig.apply(this, args);
    child.on('error', (e) => console.log(`[ci-debug] error: ${clip(e && (e.stack || e.message || e))}`));
    child.on('exit', (code, sig) => console.log(`[ci-debug] exit code=${code} sig=${sig} :: ${clip(label).slice(-160)}`));
    return child;
  };
}

// לשמור exit code של electron-builder כמו שהוא, בלי לעטוף בקוד אחר
process.on('unhandledRejection', (e) => {
  console.log('[ci-debug] unhandledRejection:', clip(e && (e.stack || e)));
  process.exit(1);
});

const builder = require('electron-builder');
builder
  .build({ targets: builder.Platform.WINDOWS.createTarget(['portable', 'nsis'], 'x64') })
  .then((files) => {
    console.log('[ci-debug] done:', files.join(', '));
    process.exit(0);
  })
  .catch((e) => {
    console.log('[ci-debug] FAILED:', clip(e && (e.stack || e)));
    process.exit(1);
  });
