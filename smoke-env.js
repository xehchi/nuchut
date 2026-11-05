// מכין סביבת בדיקה: קובץ DB זמני עם נתוני דמה, ומריץ את האפליקציה האמיתית
const fs = require('fs'); const os = require('os'); const path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nuchut-e2e-'));
process.env.NUCHUT_DATA_DIR = dir;
process.env.NUCHUT_SMOKE = '1';
// קודם ניצור נתונים דרך שכבת ה-DB, ואז נטען את main.js
const db = require('./db');
db.init(process.execPath, false);
db.auth.setCredentials({ password: '1234', question: 'מה שם האמא?', answer: 'רות' });
const sem = db.seminars.save({ name: 'סמינר אורות', coordinator: 'מרים כהן', coordinator_phone: '050-1111111' });
const book = db.books.save({ title: 'יסודות התקשוב', author: 'הוצאת שירת', price: 45 });
const g = db.groups.save({ name: "י'2 — תקשוב", seminar_id: sem, book_id: book, grade: "י'", track: 'תקשוב' });
db.students.importMany(g, [
  { first_name: 'שרה', last_name: 'כהן', homeroom: 'י2' },
  { first_name: 'רחל', last_name: 'לוי', homeroom: 'י2' },
  { first_name: 'יעל', last_name: 'מזרחי', homeroom: 'י3' },
  { first_name: 'מרים', last_name: 'ברקוביץ', homeroom: 'י2' },
  { first_name: 'אסתר', last_name: 'וייס', homeroom: 'י2' },
]);
const wd = new Date().getDay();
db.schedule.save({ group_id: g, weekday: wd, start_time: '00:00', end_time: '23:59', topic: 'יסודות התקשוב' });
db.lessons.ensureToday(new Date().toISOString().slice(0, 10));
// קבוצה שנייה בלי מערכת שעות — כדי לבדוק את מסלול "אין שיעור עכשיו"
const sem2 = db.seminars.save({ name: 'סמינר בית יעקב' });
const g2 = db.groups.save({ name: 'י״א 3 — מחשבים', seminar_id: sem2, grade: 'י״א' });
db.students.importMany(g2, [{ first_name: 'תמר', last_name: 'שפירא' }, { first_name: 'נעמי', last_name: 'אלבז' }]);
db.students.list(g).forEach((s) => db.students.setPaid(s.id, 'paid', Math.random() > 0.4));
db.close(); // main.js יפתח מחדש
require('./main.js');
