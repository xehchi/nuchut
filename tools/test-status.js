// בדיקת statusNow / openSlot על מסד זמני
process.env.NUCHUT_DATA_DIR = require('path').join(require('os').tmpdir(), 'nuchut-status-' + Date.now());
const path = require('path');
const fs = require('fs');
const dir = process.env.NUCHUT_DATA_DIR;
fs.mkdirSync(dir, { recursive: true });
const db = require('../db');
db.init(process.execPath, false);

const assert = (cond, msg) => { if (!cond) { console.error('❌ ' + msg); process.exitCode = 1; } else console.log('✅ ' + msg); };

const sem = db.seminars.save({ name: 'סמינר א' });
const g = db.groups.save({ name: 'י״א 1', seminar_id: sem });
const weekday = new Date('2026-11-01T12:00:00').getDay();

let st = db.schedule.statusNow(g, '2026-11-01', '10:00');
assert(st.hasSchedule === false && st.now === null && st.next === null, 'בלי מערכת שעות — אין שיעור "עכשיו"');

db.schedule.save({ group_id: g, weekday, start_time: '09:00', end_time: '10:30', topic: 'נושא א' });
db.schedule.save({ group_id: g, weekday, start_time: '12:00', end_time: '13:00', topic: 'נושא ב' });

st = db.schedule.statusNow(g, '2026-11-01', '09:45');
assert(st.now && st.now.slot.start_time === '09:00' && st.now.lesson === undefined, 'בתוך המשבצת — מזוהה השיעור הפעיל, טרם נפתח');

st = db.schedule.statusNow(g, '2026-11-01', '11:00');
assert(!st.now && st.next && st.next.slot.start_time === '12:00', 'בין השיעורים — מוצע השיעור הבא');
const lesson = db.lessons.openSlot(g, '2026-11-01', '12:00');
assert(lesson && lesson.start_time === '12:00' && lesson.source === 'schedule', 'פתיחת משבצת יוצרת שיעור לפי מערכת השעות');
assert(db.lessons.openSlot(g, '2026-11-01', '12:00').id === lesson.id, 'פתיחה חוזרת לא יוצרת כפילות');

const l2 = db.lessons.get(lesson.id);
db.attendance.set(l2.id, db.students.save({ group_id: g, first_name: 'שרה', last_name: 'כהן' }), { status: 'absent' });
const st2 = db.schedule.statusNow(g, '2026-11-01', '12:20');
assert(st2.now && st2.now.lesson && st2.now.lesson.marked_count === 1, 'סטטוס מחזיר את השיעור הקיים עם מספר הסימונים');

const st3 = db.schedule.statusNow(g, '2026-11-01', '20:00');
assert(!st3.now && st3.next && st3.next.date !== '2026-11-01', 'אחרי כל השיעורים — הבא בשבוע הבא');

let threw = false;
try { db.schedule.statusNow(g, 'xx', '09:00'); } catch (e) { threw = true; }
assert(threw, 'תאריך לא תקין נדחה');

db.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(process.exitCode ? '❌ נכשל' : '✅ בדיקות מערכת השעות עברו');
