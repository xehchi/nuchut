// בונה ספרייט SVG מאייקוני Lucide (ISC) עבור הממשק
const fs = require('fs');
const path = require('path');

const NEEDED = [
  // ניווט ראשי
  'house', 'users', 'calendar-days', 'file-text', 'chart-column', 'settings',
  // ערכת נושא ועריכה
  'moon', 'sun', 'arrow-left', 'arrow-right', 'pencil', 'trash-2', 'check', 'x',
  'plus', 'minus', 'save', 'copy', 'search',
  // נתונים וייצוא
  'graduation-cap', 'book-open', 'school', 'clock', 'clipboard-check', 'clipboard-list',
  'credit-card', 'alert-triangle', 'printer', 'download', 'upload',
  'file-spreadsheet', 'file-check', 'paperclip', 'file-x',
  // מערכת
  'lock', 'database', 'user', 'user-check', 'user-x', 'user-plus',
  'folder-open', 'rotate-cw', 'info', 'circle-help', 'menu', 'chevron-left',
  'chevron-right', 'chevron-up', 'chevron-down', 'power', 'log-out',
  'refresh-cw', 'calendar-check', 'check-check', 'square-pen', 'eye', 'eye-off',
  'triangle-alert',
  // מבטאים במסכי הניהול והדשבורד
  'layers', 'shield-check', 'wallet', 'calendar-clock',
];

const srcDir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
let out = '';
const missing = [];
for (const name of NEEDED) {
  const f = path.join(srcDir, `${name}.svg`);
  if (!fs.existsSync(f)) { missing.push(name); continue; }
  const raw = fs.readFileSync(f, 'utf8');
  const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  out += `<symbol id="i-${name}" viewBox="0 0 24 24">${inner.trim()}</symbol>\n`;
}
if (missing.length) console.warn('חסרים:', missing.join(', '));

// נכתב כאוסף משפטי-JS כדי לעמוד ב-CSP (בלי eval)
const sprite = JSON.stringify(`<!-- lucide-static — ISC License -->\n${out}`);
fs.writeFileSync(path.join(__dirname, '..', 'renderer', 'icons.js'),
  `'use strict';\n// נוצר ע"י tools/make-icons.js — אל לערוך ידנית\n` +
  `document.getElementById('icon-sprite').innerHTML = ${sprite};\n`);
console.log('icons.js נוצר:', NEEDED.length - missing.length, 'אייקונים');
