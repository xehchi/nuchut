// בדיקה עצמאית של שכבת הנתונים (ללא GUI)
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuchut-test-'));
const db = require('./db');
db.init(path.join(tmp, 'fake.exe'), true); // isPackaged=true → ישתמש ב-path.dirname(execPath)/data

const semId = db.seminars.save({ name: 'סמינר אורות', coordinator: 'מרים', coordinator_phone: '050-0000000' });
const bookId = db.books.save({ title: 'יסודות התקשוב', author: 'הוצאה', price: 45 });
const gId = db.groups.save({ name: "י'2 — תקשוב", seminar_id: semId, book_id: bookId, grade: "י'", track: 'תקשוב' });

db.students.importMany(gId, [
  { first_name: 'שרה', last_name: 'כהן', homeroom: 'י2' },
  { first_name: 'רחל', last_name: 'לוי', homeroom: 'י2' },
  { first_name: 'יעל', last_name: 'מזרחי', homeroom: 'י3' },
]);

// מערכת: יום לפי התאריך שנבדוק
const date = '2026-11-01';
const weekday = new Date(`${date}T12:00:00`).getDay();
db.schedule.save({ group_id: gId, weekday, start_time: '09:00', end_time: '10:30', topic: 'יסודות' });
db.schedule.save({ group_id: gId, weekday, start_time: '11:00', end_time: '12:30', topic: 'מתקדם' });
// שיעור ביום אחר — לא אמור להיווצר
db.schedule.save({ group_id: gId, weekday: (weekday + 1) % 7, start_time: '14:00', end_time: '15:00', topic: 'אחר' });

db.lessons.ensureToday(date);
const lessons = db.lessons.list(gId);
assert.strictEqual(lessons.length, 2, 'נוצרו רק שיעורי היום הנכון');
assert.ok(lessons.every((l) => ['09:00', '11:00'].includes(l.start_time)));

const current = db.lessons.getOrCreateNow(gId, date, '11:10');
assert.ok(current && current.start_time === '11:00', 'getOrCreateNow מחזיר את השיעור הפעיל');
assert.strictEqual(db.lessons.getOrCreateNow(gId, date, '13:00'), null, 'מחוץ לשעות — אין שיעור');

const students = db.students.list(gId);
db.attendance.set(current.id, students[0].id, { status: 'absent' });
db.attendance.set(current.id, students[1].id, { status: 'late' });
db.attendance.set(current.id, students[2].id, { status: 'present', discipline: 1, discipline_note: 'שיחה עם חברה' });

const report = db.attendance.report(gId, date, date);
assert.strictEqual(report.filter((r) => r.status === 'absent').length, 1);
assert.strictEqual(report.filter((r) => r.status === 'late').length, 1);

const summary = db.attendance.summary(gId, null, null);
const sara = summary.find((s) => s.student_id === students[0].id);
assert.strictEqual(sara.absent, 1);
const yael = summary.find((s) => s.student_id === students[2].id);
assert.strictEqual(yael.discipline, 1);

// --- רגרסיה: עדכון סטטוס לא מוחק הערת משמעת, ועדכון משמעת לא מוחק סטטוס ---
db.attendance.set(current.id, students[0].id, { discipline: 1, discipline_note: 'הפרעה בשיעור' });
db.attendance.set(current.id, students[0].id, { status: 'late' });
let att = db.attendance.getForLesson(current.id).find((a) => a.student_id === students[0].id);
assert.strictEqual(att.status, 'late', 'הסטטוס התעדכן');
assert.strictEqual(att.discipline, 1, 'סימון המשמעת נשמר');
assert.strictEqual(att.discipline_note, 'הפרעה בשיעור', 'הערת המשמעת לא נמחקה');
// ביטול משמעת מנקה את ההערה
db.attendance.set(current.id, students[0].id, { discipline: 0 });
att = db.attendance.getForLesson(current.id).find((a) => a.student_id === students[0].id);
assert.strictEqual(att.discipline_note, null, 'בלי משמעת — אין הערה');

// --- רגרסיה: שדה תשלום לא חוקי נדחה ---
assert.throws(() => db.students.setPaid(students[0].id, 'hack', 1), /לא מוכר/);
db.students.setPaid(students[0].id, 'received_book', 1);
assert.strictEqual(db.students.get(students[0].id).received_book, 1);

// --- רגרסיה: ייבוא מדלג על שורות בלי שם ומחזיר מונה ---
const imported = db.students.importMany(gId, [
  { first_name: 'אסתר', last_name: 'ויס', homeroom: 'י4' },
  { first_name: '', last_name: 'כהן' },
  { first_name: '   ', last_name: ' ' },
]);
assert.deepStrictEqual(imported, { inserted: 1, skipped: 2 });

// --- רגרסיה: current דוחה תאריך/שעה לא תקינים ---
assert.throws(() => db.lessons.current('01/11/2026', '10:00'), /תאריך לא תקין/);
assert.throws(() => db.lessons.current(date, 'bad'), /שעה לא תקינה/);

// עדכון פרטי שיעור לא מאבד group_id
db.lessons.sSave({ id: current.id, group_id: null, date, start_time: '11:00', end_time: '12:30', topic: 'נושא חדש', content: 'הספק', source: 'schedule' });
const upd = db.lessons.get(current.id);
assert.strictEqual(upd.group_id, gId, 'group_id נשמר');
assert.strictEqual(upd.topic, 'נושא חדש');

// אימות
db.auth.setCredentials({ password: 'abcd', question: 'שם האם?', answer: 'רות' });
assert.ok(db.auth.login('abcd'));
assert.ok(!db.auth.login('wrong'));
assert.ok(db.auth.checkAnswer('רות'));
assert.ok(db.auth.checkAnswer('  רות '), 'רווחים וצורה אינם משנים');

// מבחן + ציונים
const examId = db.exams.save({ group_id: gId, date, topic: 'מבחן אמצע', max_grade: 100 });
db.exams.setGrade(examId, students[0].id, true, 88);
db.exams.setGrade(examId, students[1].id, false, '');
const grades = db.exams.grades(examId);
assert.strictEqual(grades.length, 2);
assert.strictEqual(grades.find((g) => g.student_id === students[0].id).grade, 88);
assert.strictEqual(grades.find((g) => g.student_id === students[1].id).grade, null);

// גיבוי
const backupPath = path.join(tmp, 'backup.db');
db.backup(backupPath);
assert.ok(fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0);

// מחיקת קבוצה — cascade
db.groups.remove(gId);
assert.strictEqual(db.lessons.list(gId).length, 0);

console.log('✅ כל בדיקות שכבת הנתונים עברו');
db.close();
fs.rmSync(tmp, { recursive: true, force: true });
