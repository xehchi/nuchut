// תהליך ראשי — חלון, IPC, אחסון נייד
const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// מצב בדיקה: ללא GPU (סביבת build/CI וירטואלית)
if (process.env.NUCHUT_SMOKE) app.disableHardwareAcceleration();

let mainWindow = null;
const APP_TITLE = 'נוכחות';
const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    icon: ICON_PATH,
    backgroundColor: '#141821',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // הכותרת נקבעת מהתוכנית, כדי שכותרת ה-HTML לא תדרוס אותה
  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  // ללא תפריט ברירת מחדל (File / Edit / View ...)
  Menu.setApplicationMenu(null);
  // שם האפליקציה ב-Task Manager / תפריט ההתחלה
  app.setName(APP_TITLE);
  db.init(process.execPath, app.isPackaged);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  db.close();
});

// לחשיפה בבדיקות עשן בלבד
if (process.env.NUCHUT_SMOKE) {
  require('./smoke-driver')(() => mainWindow);
}

// --- עטיפת IPC: שגיאות נזרקות חוזרות כשגיאה נקייה לממשק ---
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

// אימות
handle('auth:status', () => ({ configured: db.auth.isConfigured(), question: db.auth.getQuestion() }));
handle('auth:setup', (creds) => (db.auth.setCredentials(creds), true));
handle('auth:login', (password) => db.auth.login(password));
handle('auth:recover', ({ answer, newPassword }) => {
  if (!db.auth.checkAnswer(answer)) throw new Error('התשובה אינה נכונה');
  db.auth.setCredentials({ password: newPassword });
  return true;
});
handle('auth:update', ({ currentPassword, newPassword, question, answer }) => {
  if (!db.auth.login(currentPassword)) throw new Error('הסיסמה הנוכחית אינה נכונה');
  db.auth.setCredentials({ password: newPassword || currentPassword, question, answer });
  return true;
});

// נתוני ליבה
['seminars', 'books', 'groups', 'students', 'schedule', 'lessons', 'attendance', 'exams'].forEach((k) => {
  for (const [fnName, fn] of Object.entries(db[k])) {
    handle(`${k}:${fnName}`, fn);
  }
});

// גיבוי לקובץ
handle('backup:save', async () => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'גיבוי מסד הנתונים',
    defaultPath: `backup-${stamp}.db`,
    filters: [{ name: 'מסד נתונים', extensions: ['db'] }],
  });
  if (canceled || !filePath) return null;
  db.backup(filePath);
  return filePath;
});

// ייבוא Excel — קריאת גיליון והחזרת שורות גולמיות למיפוי בממשק
handle('excel:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'בחירת קובץ תלמידות',
    properties: ['openFile'],
    filters: [{ name: 'גיליון Excel', extensions: ['xlsx', 'xls', 'csv'] }],
  });
  if (canceled || !filePaths.length) return null;
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(filePaths[0]);
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }),
  }));
  return { fileName: path.basename(filePaths[0]), sheets };
});

// ייצוא Excel — מקבל מערך טבלאי שורה-שורה
handle('excel:export', async ({ rows, defaultName, sheetName }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'ייצוא ל-Excel',
    defaultPath: defaultName || 'דוח.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return null;
  const XLSX = require('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  // RTL: ייצוג הופכי של העמודות כדי שיופיע מימין לשמאל ב-Excel
  ws['!cols'] = rows[0] ? rows[0].map(() => ({ wch: 18 })) : [];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'גיליון');
  XLSX.writeFile(wb, filePath);
  return filePath;
});

// פתיחת קובץ מצורף בתוכנה של המערכת (מוגבל לקבצים שבתיקיית הנתונים/העלאות)
handle('shell:openPath', async (p) => {
  if (!p) return null;
  const root = path.resolve(db.getDataDir(), '..');
  const target = path.resolve(p);
  if (!target.startsWith(root)) throw new Error('הקובץ אינו בתיקיית המערכת');
  if (!fs.existsSync(target)) throw new Error('הקובץ לא נמצא — ייתכן שנמחק');
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
  return true;
});

// פרטי המערכת (למסך "אודות" ולתפריט)
handle('app:info', () => ({
  version: app.getVersion(),
  dataDir: db.getDataDir(),
  isPackaged: app.isPackaged,
}));

// העלאת קובץ שאלון למבחן
handle('exams:attachFile', async (examId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'בחירת קובץ שאלון',
    properties: ['openFile'],
    filters: [{ name: 'קבצים', extensions: ['pdf', 'doc', 'docx', 'xlsx', 'jpg', 'png'] }],
  });
  if (canceled || !filePaths.length) return null;
  const uploadsDir = path.join(db.getDataDir(), '..', 'uploads', 'מבחנים');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const dest = path.join(uploadsDir, `${examId}-${path.basename(filePaths[0])}`);
  fs.copyFileSync(filePaths[0], dest);
  return dest;
});
