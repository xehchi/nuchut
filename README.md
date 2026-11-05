# נוכחות

מערכת שולחנית לניהול נוכחות וקבוצות לסמינרים — סמינר ← קבוצה ← תלמידה.

## מבנה

```
main.js          תהליך ראשי: חלון, תפריטים, IPC, גיבוי, ייצוא/ייבוא אקסל
preload.js       גשר מאובטח (contextBridge) — רשימת פעלים מורשית בלבד
db.js            שכבת הנתונים (SQLite דרך better-sqlite3) — סכמה וכל הפונקציות
renderer/        ממשק SPA ב-HTML/CSS/JS טהור (RTL, עברית)
  app.js         לוגיקה ומסכים
  styles.css     עיצוב, ערכות בהירה/כהה, אנימציות
  icons.js       ספרייט אייקונים (נוצר מ-lucide-static)
  index.html     מסמך הבסיס
build/           אייקון האפליקציה
tools/           סקריפטים: יצירת אייקונים, בדיקות סטטוס
test-db.js       בדיקות שכבת הנתונים
smoke-env.js     סביבת בדיקת עשן (מסד זמני מלא בדגימה)
smoke-driver.js  תרחיש הבדיקה שמפעיל את הממשק האמיתי
```

## הרצה

```bash
npm install
npm start
```

## בנייה לאריזה

```bash
npm run dist
```

נוצרים ב-`dist/` קובץ נייד (portable) ומתקין NSIS. מסד הנתונים נשמר בתיקיית `data/` לצד קובץ ההרצה.

## בדיקות

```bash
node test-db.js                                  # שכבת הנתונים
node tools/test-status.js                        # חישוב "השיעור כעת"
npx electron smoke-env.js --disable-gpu          # בדיקת עשן מלאה (SMOKE_RESULT בפלט)
```

## אבטחה

- אין סיסמת ברירת מחדל — בהרצה ראשונה נקבעת סיסמה ושאלת אבטחה לשחזור.
- כל הנתונים מקומיים בלבד; אין שום תקשורת רשת.
- CSP מחמיר בממשק (`script-src 'self'`), ללא מטפלי `onclick` מוטבעים.
