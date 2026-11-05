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

// הלוג של electron-builder עובר דרך consola → אינו stdout של התהליך. אוסף כל מה שנכתב
// לקונסולה של התהליך הזה ורושם אותו לקובץ שאפשר להעלות כארטיפקט.
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'dist', 'ci-debug.log');
fs.mkdirSync(path.dirname(out), { recursive: true });
const write = (stream) => {
  const orig = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    try { fs.appendFileSync(out, chunk); } catch {}
    return orig(chunk, ...rest);
  };
};
write(process.stdout);
write(process.stderr);
// err-short.log — מה שהופך את הכשל לאבחון מהיר (לא נוגעים בו ב-gitignore)
const shortLog = path.join(__dirname, '..', 'dist', 'err-short.log');
const clipShort = (s) => String(s).replace(/\x1b\[\d+m/g, '').slice(0, 1500);

// לשמור exit code של electron-builder כמו שהוא, בלי לעטוף בקוד אחר
process.on('unhandledRejection', (e) => {
  const msg = '[ci-debug] unhandledRejection: ' + clipShort(e && (e.stack || e));
  console.log(msg);
  try { fs.writeFileSync(shortLog, msg); } catch {}
  process.exit(1);
});

const builder = require('electron-builder');
builder
  .build({ targets: builder.Platform.WINDOWS.createTarget(['portable', 'nsis'], builder.Arch.x64) })
  .then((files) => {
    console.log('[ci-debug] done:', files.join(', '));
    process.exit(0);
  })
  .catch((e) => {
    const msg = '[ci-debug] FAILED: ' + clipShort(e && (e.stack || e));
    console.log(msg);
    try { fs.writeFileSync(shortLog, msg + '\n\n--- tail of builder log ---\n' + tailOf(out, 8000)); } catch {}
    process.exit(1);
  });

function tailOf(file, n) {
  try {
    const s = fs.readFileSync(file, 'utf8').replace(/\x1b\[\d+m/g, '');
    return s.slice(-n);
  } catch { return '(no log)'; }
}
