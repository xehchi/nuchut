// שכבת מסד הנתונים — better-sqlite3 מוטמע, קובץ ליד ה-EXE
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

let db = null;
let dataDir = null;

// --- מיקום נתונים נייד: ליד ה-EXE האמיתי (לא ב-AppData) ---
function resolveDataDir(execPath, isPackaged) {
  if (process.env.NUCHUT_DATA_DIR) return process.env.NUCHUT_DATA_DIR;
  if (!isPackaged) return path.join(__dirname, 'data');
  // אריזת portable של electron-builder: EXE אמיתי נמצא ב-PORTABLE_EXECUTABLE_DIR
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableDir) return path.join(portableDir, 'data');
  return path.join(path.dirname(execPath), 'data');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function init(execPath, isPackaged) {
  dataDir = resolveDataDir(execPath, isPackaged);
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'nuchut.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate();
  return dbPath;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS seminars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      coordinator TEXT,
      coordinator_phone TEXT
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      price REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      grade TEXT,
      track TEXT,
      teacher TEXT,
      book_id INTEGER REFERENCES books(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      homeroom TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      paid INTEGER NOT NULL DEFAULT 0,
      received_book INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      weekday INTEGER NOT NULL,          -- 0=ראשון ... 6=שבת
      start_time TEXT NOT NULL,          -- HH:MM
      end_time TEXT NOT NULL,            -- HH:MM
      topic TEXT
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      date TEXT NOT NULL,                -- YYYY-MM-DD
      start_time TEXT,
      end_time TEXT,
      topic TEXT,
      content TEXT,                      -- ההספק
      source TEXT NOT NULL DEFAULT 'schedule', -- schedule | manual
      UNIQUE(group_id, date, start_time)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'present',  -- present | absent | late | released
      discipline INTEGER NOT NULL DEFAULT 0,
      discipline_note TEXT,
      UNIQUE(lesson_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      topic TEXT NOT NULL,
      max_grade REAL DEFAULT 100,
      file_path TEXT
    );

    CREATE TABLE IF NOT EXISTS exam_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      submitted INTEGER NOT NULL DEFAULT 0,
      grade REAL,
      UNIQUE(exam_id, student_id)
    );

    CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_id);
    CREATE INDEX IF NOT EXISTS idx_lessons_group_date ON lessons(group_id, date);
    CREATE INDEX IF NOT EXISTS idx_attendance_lesson ON attendance(lesson_id);
  `);
}

// ---------- עזר כללי ----------
const getSetting = (key) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
};
const setSetting = (key, value) => {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
};

// מפתחות כמו fieldName של הטופס מגיעים מהממשק — מותר רק רשימה סגורה
const ALLOWED = {
  seminars: ['name', 'coordinator', 'coordinator_phone'],
  books: ['title', 'author', 'price'],
  groups: ['name', 'grade', 'track', 'teacher', 'book_id', 'seminar_id'],
  students: ['first_name', 'last_name', 'homeroom', 'active', 'notes', 'paid', 'received_book', 'group_id'],
  schedule: ['weekday', 'start_time', 'end_time', 'topic', 'group_id'],
  lessons: ['date', 'start_time', 'end_time', 'topic', 'content', 'source', 'group_id'],
  exams: ['date', 'topic', 'max_grade', 'file_path', 'group_id'],
};

function buildUpdate(table, data, id) {
  const cols = Object.keys(data).filter((k) => ALLOWED[table].includes(k));
  if (!cols.length) return;
  const sql = `UPDATE ${table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`;
  db.prepare(sql).run({ ...pick(data, cols), id });
}

function buildInsert(table, data) {
  const cols = Object.keys(data).filter((k) => ALLOWED[table].includes(k));
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`;
  return db.prepare(sql).run(pick(data, cols)).lastInsertRowid;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k] ?? null;
  return out;
}

// ---------- אימות ----------
const auth = {
  isConfigured: () => !!getSetting('password_hash'),
  setCredentials: ({ password, question, answer }) => {
    if (!password || String(password).length < 4) throw new Error('הסיסמה קצרה מדי');
    const salt = crypto.randomBytes(16).toString('hex');
    setSetting('password_salt', salt);
    setSetting('password_hash', hashPassword(password, salt));
    if (question !== undefined) setSetting('question', question || '');
    if (answer !== undefined) {
      setSetting('answer_hash', answer ? hashPassword(answer.trim().toLowerCase(), salt) : '');
    }
  },
  login: (password) => {
    const salt = getSetting('password_salt');
    const hash = getSetting('password_hash');
    return !!salt && !!hash && hashPassword(password, salt) === hash;
  },
  getQuestion: () => getSetting('question') || '',
  checkAnswer: (answer) => {
    const salt = getSetting('password_salt');
    const hash = getSetting('answer_hash');
    return !!salt && !!hash && hashPassword(String(answer || '').trim().toLowerCase(), salt) === hash;
  },
};

// ---------- סמינרים / ספרים / קבוצות ----------
const seminars = {
  list: () => db.prepare('SELECT * FROM seminars ORDER BY name').all(),
  save: (s) => (s.id ? (buildUpdate('seminars', s, s.id), s.id) : buildInsert('seminars', s)),
  remove: (id) => db.prepare('DELETE FROM seminars WHERE id = ?').run(id),
};

const books = {
  list: () => db.prepare('SELECT * FROM books ORDER BY title').all(),
  save: (b) => (b.id ? (buildUpdate('books', b, b.id), b.id) : buildInsert('books', b)),
  remove: (id) => db.prepare('DELETE FROM books WHERE id = ?').run(id),
};

const groups = {
  list: () => db.prepare(`
    SELECT g.*, s.name AS seminar_name, b.title AS book_title,
           (SELECT COUNT(*) FROM students st WHERE st.group_id = g.id AND st.active = 1) AS student_count
    FROM groups g
    JOIN seminars s ON s.id = g.seminar_id
    LEFT JOIN books b ON b.id = g.book_id
    ORDER BY s.name, g.name
  `).all(),
  get: (id) => db.prepare(`
    SELECT g.*, s.name AS seminar_name, b.title AS book_title, b.price AS book_price
    FROM groups g
    JOIN seminars s ON s.id = g.seminar_id
    LEFT JOIN books b ON b.id = g.book_id
    WHERE g.id = ?
  `).get(id),
  save: (g) => {
    if (!g.name || !g.seminar_id) throw new Error('שם קבוצה וסמינר הם שדות חובה');
    return g.id ? (buildUpdate('groups', g, g.id), g.id) : buildInsert('groups', g);
  },
  remove: (id) => db.prepare('DELETE FROM groups WHERE id = ?').run(id),
};

// ---------- תלמידות ----------
const students = {
  list: (groupId, includeInactive = false) => db.prepare(`
    SELECT * FROM students WHERE group_id = ? ${includeInactive ? '' : 'AND active = 1'}
    ORDER BY last_name, first_name
  `).all(groupId),
  get: (id) => db.prepare('SELECT * FROM students WHERE id = ?').get(id),
  save: (s) => {
    if (!s.first_name || !s.last_name) throw new Error('שם פרטי ושם משפחה הם שדות חובה');
    return s.id ? (buildUpdate('students', s, s.id), s.id) : buildInsert('students', s);
  },
  remove: (id) => db.prepare('DELETE FROM students WHERE id = ?').run(id),
  setPaid: (id, field, value) => {
    if (field !== 'paid' && field !== 'received_book') {
      throw new Error(`שדה תשלום לא מוכר: ${field}`);
    }
    db.prepare(`UPDATE students SET ${field} = ? WHERE id = ?`).run(value ? 1 : 0, id);
  },
  importMany: (groupId, rows) => {
    const stmt = db.prepare(`INSERT INTO students (group_id, first_name, last_name, homeroom, notes) VALUES (?, ?, ?, ?, ?)`);
    let inserted = 0, skipped = 0;
    db.transaction((items) => {
      for (const r of items) {
        const first = String(r.first_name || '').trim();
        const last = String(r.last_name || '').trim();
        // תלמידה בלי שם פרטי או משפחה לא נכנסת — אחרת נוצרות רשומות ריקות
        if (!first || !last) { skipped++; continue; }
        stmt.run(groupId, first, last, r.homeroom || null, r.notes || null);
        inserted++;
      }
    })(rows);
    return { inserted, skipped };
  },
};

// ---------- מערכת שעות ----------
const schedule = {
  list: (groupId) => db.prepare('SELECT * FROM schedule WHERE group_id = ? ORDER BY weekday, start_time').all(groupId),
  save: (s) => {
    if (s.start_time >= s.end_time) throw new Error('שעת הסיום חייבת להיות אחרי שעת ההתחלה');
    return s.id ? (buildUpdate('schedule', s, s.id), s.id) : buildInsert('schedule', s);
  },
  remove: (id) => db.prepare('DELETE FROM schedule WHERE id = ?').run(id),

  // מה קורה בקבוצה ברגע זה: שיעור פעיל, או השיעור הבא של היום/השבוע
  // (עטוף בשם sStatusNow — כל פונקציה בשכבה זו נחשפת אוטומטית ל-IPC)
  sStatusNow: (groupId, date, nowHHMM) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('תאריך לא תקין');
    if (!/^\d{2}:\d{2}$/.test(String(nowHHMM || ''))) throw new Error('שעה לא תקינה');
    const slots = schedule.list(groupId);
    const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!slots.length) return { hasSchedule: false, now: null, next: null };

    const weekday = new Date(`${date}T12:00:00`).getDay();
    const todays = slots.filter((s) => s.weekday === weekday);
    const current = todays.find((s) => s.start_time <= nowHHMM && (s.end_time || '23:59') >= nowHHMM) || null;
    // השיעור הבא: היום — לפי שעה; אחרת — היום הקרוב ביותר בשבוע
    const upcomingToday = todays.filter((s) => s.start_time > nowHHMM).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
    let next = upcomingToday ? { ...upcomingToday, date } : null;
    if (!next) {
      for (let d = 1; d <= 7 && !next; d++) {
        const day = new Date(`${date}T12:00:00`);
        day.setDate(day.getDate() + d);
        const wd = day.getDay();
        const slot = slots.filter((s) => s.weekday === wd).sort((a, b) => a.start_time.localeCompare(b.start_time))[0];
        if (slot) next = { ...slot, date: isoOf(day) };
      }
    }
    const findLesson = (s) => s && db.prepare(
      'SELECT l.*, (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id) AS marked_count FROM lessons l WHERE l.group_id = ? AND l.date = ? AND IFNULL(l.start_time, ?) = ?'
    ).get(groupId, s.date, s.start_time, s.start_time);
    return { hasSchedule: true, now: current ? { slot: current, lesson: findLesson({ ...current, date }) } : null, next: next ? { slot: next, lesson: findLesson(next) } : null };
  },
};
// שם ציבורי ל-statusNow (כמו sSave ב-lessons)
schedule.statusNow = schedule.sStatusNow;

// ---------- שיעורים ----------
const lessons = {
  list: (groupId) => db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.status = 'absent') AS absent_count,
      (SELECT COUNT(*) FROM attendance a WHERE a.lesson_id = l.id AND a.status = 'late') AS late_count
    FROM lessons l WHERE l.group_id = ? ORDER BY l.date DESC, l.start_time DESC
  `).all(groupId),
  get: (id) => db.prepare('SELECT * FROM lessons WHERE id = ?').get(id),
  sSave: (l) => {
    if (!l.date) throw new Error('תאריך השיעור הוא שדה חובה');
    if (l.id) {
      // group_id אינו מתעדכן — שיעור לא עובר בין קבוצות
      const { group_id, ...patch } = l;
      buildUpdate('lessons', patch, l.id);
      return l.id;
    }
    const existing = db.prepare('SELECT id FROM lessons WHERE group_id = ? AND date = ? AND IFNULL(start_time, \'\') = IFNULL(?, \'\')')
      .get(l.group_id, l.date, l.start_time ?? null);
    if (existing) return existing.id;
    return buildInsert('lessons', l);
  },
  remove: (id) => db.prepare('DELETE FROM lessons WHERE id = ?').run(id),
  // השיעור הנוכחי של קבוצה לפי מערכת השעות של אותו יום שבוע. יוצר אותו אם לא קיים.
  // ערך מוחזר: השיעור הפעיל עכשיו, או אם אין — השיעור האחרון שהתחיל היום (אם טרם הסתיים).
  getOrCreateNow: (groupId, date, nowHHMM) => {
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const slots = schedule.list(groupId)
      .filter((s) => s.weekday === weekday)
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const active = slots.find((s) => s.start_time <= nowHHMM && nowHHMM <= s.end_time);
    if (!active) return null;
    const existing = db.prepare('SELECT id FROM lessons WHERE group_id = ? AND date = ? AND start_time = ?')
      .get(groupId, date, active.start_time);
    if (existing) return lessons.get(existing.id);
    const id = buildInsert('lessons', {
      group_id: groupId, date, start_time: active.start_time, end_time: active.end_time,
      topic: active.topic, source: 'schedule',
    });
    return lessons.get(id);
  },
  // השיעורים שמתקיימים עכשיו (לכל הקבוצות) — לקפיצה מהירה מהדשבורד
  current: (date, nowHHMM) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      throw new Error('תאריך לא תקין לבדיקת השיעור הנוכחי');
    }
    if (!/^\d{2}:\d{2}$/.test(String(nowHHMM || ''))) {
      throw new Error('שעה לא תקינה לבדיקת השיעור הנוכחי');
    }
    return db.prepare(`
    SELECT l.id AS lesson_id, l.group_id, l.start_time, l.end_time, l.topic,
           g.name AS group_name, s.name AS seminar_name
    FROM lessons l
    JOIN groups g ON g.id = l.group_id
    JOIN seminars s ON s.id = g.seminar_id
    WHERE l.date = ? AND l.start_time <= ? AND IFNULL(l.end_time, '23:59') >= ?
    ORDER BY l.start_time
  `).all(date, nowHHMM, nowHHMM);
  },
  // פתיחת השיעור של משבצת קבועה במערכת השעות (קבוצה + תאריך + שעת התחלה) — יוצר אם לא קיים
  // (נקרא sOpenSlot כדי שהפונקציה הציבורית תיחשף ב-IPC בשם lessons:openSlot)
  sOpenSlot: (groupId, date, startTime) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) throw new Error('תאריך לא תקין');
    const slot = schedule.list(groupId).find((s) => s.start_time === startTime);
    if (!slot) throw new Error('המשבצת אינה קיימת במערכת השעות של הקבוצה');
    const existing = db.prepare('SELECT id FROM lessons WHERE group_id = ? AND date = ? AND IFNULL(start_time, \'\') = ?')
      .get(groupId, date, startTime);
    if (existing) return lessons.get(existing.id);
    const id = buildInsert('lessons', {
      group_id: groupId, date, start_time: slot.start_time, end_time: slot.end_time,
      topic: slot.topic, source: 'schedule',
    });
    return lessons.get(id);
  },
  // סנכרון אוטומטי של שיעורי היום לפי מערכת השעות
  ensureToday: (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) {
      throw new Error('תאריך לא תקין לסנכרון שיעורי היום');
    }
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const slots = db.prepare('SELECT * FROM schedule WHERE weekday = ?').all(weekday);
    const ins = db.prepare(`INSERT OR IGNORE INTO lessons (group_id, date, start_time, end_time, topic, source)
                            VALUES (?, ?, ?, ?, ?, 'schedule')`);
    db.transaction(() => {
      for (const s of slots) ins.run(s.group_id, date, s.start_time, s.end_time, s.topic);
    })();
  },
};
lessons.openSlot = lessons.sOpenSlot;

// ---------- נוכחות ----------
const attendance = {
  getForLesson: (lessonId) => db.prepare('SELECT * FROM attendance WHERE lesson_id = ?').all(lessonId),
  // patch חלקי בלבד: שדה שאינו נשלח נשמר כפי שהוא (הערת משמעת לא נמחקת כשמסמנים סטטוס)
  set: (lessonId, studentId, patch) => {
    const cur = db.prepare('SELECT * FROM attendance WHERE lesson_id = ? AND student_id = ?').get(lessonId, studentId) || {
      status: 'present', discipline: 0, discipline_note: null,
    };
    const next = {
      status: patch.status ?? cur.status ?? 'present',
      discipline: patch.discipline !== undefined ? (patch.discipline ? 1 : 0) : cur.discipline,
      discipline_note: patch.discipline_note !== undefined ? (patch.discipline_note || null) : cur.discipline_note,
    };
    // הערה בלי סימון משמעת אינה הגיונית — נשמרת רק כשיש הפרה
    if (!next.discipline) next.discipline_note = null;
    db.prepare(`
      INSERT INTO attendance (lesson_id, student_id, status, discipline, discipline_note)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lesson_id, student_id) DO UPDATE SET
        status = excluded.status, discipline = excluded.discipline, discipline_note = excluded.discipline_note
    `).run(lessonId, studentId, next.status, next.discipline, next.discipline_note);
    return next;
  },
  // דוח חסרות/מאחרות/שחרור — לפי שיעור, טווח או כל השנה
  report: (groupId, fromDate, toDate) => db.prepare(`
    SELECT st.id AS student_id, st.first_name, st.last_name, st.homeroom,
           a.status, l.date, l.start_time, l.topic
    FROM attendance a
    JOIN lessons l ON l.id = a.lesson_id
    JOIN students st ON st.id = a.student_id
    WHERE l.group_id = @groupId AND a.status IN ('absent','late','released')
      ${fromDate ? 'AND l.date >= @from' : ''}
      ${toDate ? 'AND l.date <= @to' : ''}
    ORDER BY st.last_name, st.first_name, l.date
  `).all({ from: fromDate ?? null, to: toDate ?? null, groupId }),
  // סיכום נוכחות לתלמידה ולקבוצה
  summary: (groupId, fromDate, toDate) => {
    const where = ['l.group_id = @groupId'];
    if (fromDate) where.push('l.date >= @from');
    if (toDate) where.push('l.date <= @to');
    return db.prepare(`
      SELECT st.id AS student_id, st.first_name, st.last_name, st.homeroom, st.active,
        SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
        SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN a.status = 'released' THEN 1 ELSE 0 END) AS released,
        SUM(CASE WHEN a.discipline = 1 THEN 1 ELSE 0 END) AS discipline
      FROM attendance a
      JOIN lessons l ON l.id = a.lesson_id
      JOIN students st ON st.id = a.student_id
      WHERE ${where.join(' AND ')}
      GROUP BY st.id
      ORDER BY st.last_name, st.first_name
    `).all({ from: fromDate ?? null, to: toDate ?? null, groupId });
  },
};

// ---------- מבחנים ----------
const exams = {
  list: (groupId) => db.prepare('SELECT * FROM exams WHERE group_id = ? ORDER BY date DESC').all(groupId),
  save: (e) => {
    if (!e.date || !e.topic) throw new Error('תאריך ונושא הם שדות חובה');
    return e.id ? (buildUpdate('exams', { ...e, group_id: undefined }, e.id), e.id) : buildInsert('exams', e);
  },
  remove: (id) => db.prepare('DELETE FROM exams WHERE id = ?').run(id),
  grades: (examId) => db.prepare('SELECT * FROM exam_grades WHERE exam_id = ?').all(examId),
  setGrade: (examId, studentId, submitted, grade) => {
    db.prepare(`
      INSERT INTO exam_grades (exam_id, student_id, submitted, grade) VALUES (?, ?, ?, ?)
      ON CONFLICT(exam_id, student_id) DO UPDATE SET submitted = excluded.submitted, grade = excluded.grade
    `).run(examId, studentId, submitted ? 1 : 0, grade === '' || grade === null || grade === undefined ? null : Number(grade));
  },
};

// ---------- גיבוי ----------
function backup(destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  db.prepare('VACUUM INTO ?').run(destPath);
  return destPath;
}

function getDataDir() { return dataDir; }
function close() { if (db) { db.close(); db = null; } }

module.exports = {
  init, auth, seminars, books, groups, students, schedule, lessons, attendance, exams,
  backup, getDataDir, close,
};
