/* מערכת נוכחות — ממשק */
'use strict';

// ================= עזר =================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const nowHHMM = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const STATUS_LABEL = { present: 'נוכחת', absent: 'חסרה', late: 'איחור', released: 'שחרור' };
const STATUS_ORDER = ['present', 'absent', 'late', 'released'];
const initials = (first, last) => `${String(first || '').charAt(0)}${String(last || '').charAt(0)}`;
const fmtDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
const pct = (part, total) => (total ? Math.round((part / total) * 100) : null);
const pctText = (part, total) => { const v = pct(part, total); return v === null ? '—' : `${v}%`; };
const weekdayOf = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()];

// אייקון SVG מתוך ספרייט Lucide (נוצר ע"י tools/make-icons.js)
const ico = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

// unwrap תוצאת IPC
async function call(promise) {
  const res = await promise;
  if (!res) return null;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-host').appendChild(el);
  setTimeout(() => { el.classList.add('bye'); setTimeout(() => el.remove(), 320); }, type === 'error' ? 4200 : 2400);
}
const fail = (e) => { console.error(e); toast(e.message || 'אירעה שגיאה', 'error'); };

function modal(html, { wide = false, onMount } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  const close = () => backdrop.remove();
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  const onKey = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  $('#modal-host').appendChild(backdrop);
  if (onMount) onMount(backdrop, close);
  return { el: backdrop, close };
}

function confirmDialog(msg) {
  return new Promise((resolve) => {
    const { el } = modal(`
      <h3>${ico('triangle-alert')} אישור פעולה</h3>
      <p class="muted">${esc(msg)}</p>
      <div class="modal-foot">
        <button class="btn danger solid" data-yes>כן, המשך</button>
        <button class="btn" data-no>ביטול</button>
      </div>`, {
      onMount(root, close) {
        $('[data-yes]', root).onclick = () => { close(); resolve(true); };
        $('[data-no]', root).onclick = () => { close(); resolve(false); };
      },
    });
    el.addEventListener('mousedown', (e) => { if (e.target === el) resolve(false); });
  });
}

// ================= מצב =================
const state = {
  theme: localStorage.getItem('theme') || 'light',
  groups: [],
  route: { name: 'dashboard' },
  auth: null,
  question: '',
  info: null,
  showInactive: false,
  payFilter: 'all',
  reportRange: null,
};

function applyTheme() {
  document.body.dataset.theme = state.theme;
}

// ================= כניסה / אימות =================
function authShell(inner) {
  return `
    <div class="auth-wrap">
      <div class="auth-art" aria-hidden="true">
        <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
        <div class="auth-art-inner">
          <div class="brand-logo lg">נ</div>
          <div class="auth-art-title">נוכחות</div>
          <div class="auth-art-sub">סימון נוכחות בלחיצה אחת</div>
          <ul class="auth-art-list">
            <li>${ico('users')} סמינרים, קבוצות ותלמידות</li>
            <li>${ico('calendar-days')} מערכת שעות ושיעורים</li>
            <li>${ico('chart-column')} דוחות חיסורים ומשמעת</li>
            <li>${ico('file-text')} מבחנים וציונים</li>
          </ul>
        </div>
      </div>
      <div class="auth-side">${inner}</div>
    </div>`;
}

async function renderAuth() {
  const status = await call(window.api.auth.status());
  state.auth = status;
  if (!status.configured) return renderSetup();

  $('#app').innerHTML = authShell(`
    <div class="card auth-card">
      <h1>ברוכים הבאים</h1>
      <p class="muted" style="margin:0 0 22px">הזינו את הסיסמה כדי להמשיך</p>
      <form id="login-form" autocomplete="off">
        <label class="field"><span>סיסמה</span>
          <div class="input-wrap">${ico('lock')}<input type="password" name="password" autofocus required /></div>
        </label>
        <button class="btn primary lg block" type="submit">${ico('arrow-left')} כניסה</button>
      </form>
      <div class="center" style="margin-top:16px">
        <button class="btn ghost sm" id="forgot">שכחתי סיסמה</button>
      </div>
    </div>`);

  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      const ok = await call(window.api.auth.login(new FormData(form).get('password')));
      if (ok) enterApp();
      else { toast('סיסמה שגויה', 'error'); form.password.select(); }
    } catch (err) { fail(err); }
  };
  $('#forgot').onclick = renderRecover;
}

function renderSetup() {
  $('#app').innerHTML = authShell(`
    <div class="card auth-card">
      <h1>הגדרה ראשונית</h1>
      <p class="muted" style="margin:0 0 22px">בחרו סיסמה ושאלת אבטחה לשחזור</p>
      <form id="setup-form" autocomplete="off">
        <label class="field"><span>סיסמה (לפחות 4 תווים)</span><input type="password" name="password" required minlength="4" autofocus /></label>
        <label class="field"><span>אימות סיסמה</span><input type="password" name="confirm" required minlength="4" /></label>
        <label class="field"><span>שאלת אבטחה לשחזור</span><input type="text" name="question" required placeholder="לדוגמה: שם הסב" /></label>
        <label class="field"><span>תשובה</span><input type="text" name="answer" required /></label>
        <button class="btn primary lg block" type="submit">${ico('check')} שמירה והמשך</button>
      </form>
    </div>`);

  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    if (f.get('password') !== f.get('confirm')) return toast('הסיסמאות אינן תואמות', 'error');
    try {
      await call(window.api.auth.setup({ password: f.get('password'), question: f.get('question'), answer: f.get('answer') }));
      toast('ההגדרה הושלמה');
      enterApp();
    } catch (err) { fail(err); }
  };
}

function renderRecover() {
  const q = state.auth.question;
  modal(`
    <h3>${ico('circle-help')} שחזור סיסמה</h3>
    ${q ? `<p class="muted">${esc(q)}</p>` : `<p class="muted">לא הוגדרה שאלת אטבחה.</p>`}
    <form id="rec-form" autocomplete="off">
      <label class="field"><span>תשובה</span><input type="text" name="answer" required autofocus /></label>
      <label class="field"><span>סיסמה חדשה</span><input type="password" name="password" required minlength="4" /></label>
      <div class="modal-foot">
        <button class="btn primary" type="submit">איפוס סיסמה</button>
        <button class="btn" type="button" data-cancel>ביטול</button>
      </div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#rec-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try {
          await call(window.api.auth.recover({ answer: f.get('answer'), newPassword: f.get('password') }));
          close();
          toast('הסיסמה אופסה בהצלחה');
        } catch (err) { fail(err); }
      };
    },
  });
}

// ================= מעטפת + ניווט =================
const NAV = [
  { name: 'dashboard', icon: 'house', label: 'בית' },
  { name: 'students', icon: 'users', label: 'תלמידות' },
  { name: 'schedule', icon: 'calendar-days', label: 'מערכת שעות' },
  { name: 'exams', icon: 'file-text', label: 'מבחנים ודיווחים' },
  { name: 'reports', icon: 'chart-column', label: 'דוחות חיסורים' },
  { name: 'admin', icon: 'settings', label: 'ניהול' },
];

// קבוצות שמתאימות לעמוד, עבור עמודים שנדרשים לקבוצה פעילה
const GROUP_ROUTES = new Set(['group', 'lesson', 'payments', 'students', 'schedule', 'exams', 'reports']);

async function enterApp() {
  await loadGroups();
  state.info = await call(window.api.info());
  state.route = { name: 'dashboard' };
  renderShell();
  render();
}

async function loadGroups() {
  state.groups = await call(window.api.groups.list());
}

// --- תפריט התוכנה (בחלון, לא של Windows) ---
const MENU = [
  {
    label: 'קובץ',
    icon: 'folder-open',
    items: [
      { label: 'ייבוא תלמידות מ-Excel', icon: 'upload', action: () => menuImport() },
      { label: 'ייצוא נתוני הקבוצה', icon: 'download', action: () => menuExportCurrent() },
      { sep: true },
      { label: 'גיבוי מסד הנתונים', icon: 'database', action: () => doBackup() },
      { label: 'פתיחת תיקיית הנתונים', icon: 'folder-open', action: () => openDataDir() },
      { sep: true },
      { label: 'התנתקות', icon: 'log-out', action: () => logout() },
      { label: 'יציאה מהתוכנה', icon: 'power', action: () => window.close() },
    ],
  },
  {
    label: 'עריכה',
    icon: 'square-pen',
    items: [
      { label: 'הוספת תלמידה לקבוצה הנוכחית', icon: 'user-plus', action: () => menuAddStudent() },
      { label: 'ניהול סמינרים וקבוצות', icon: 'settings', action: () => navigate('admin') },
      { sep: true },
      { label: 'שינוי סיסמה ושאלת אבטחה', icon: 'lock', action: () => openSecurity() },
    ],
  },
  {
    label: 'תצוגה',
    icon: 'eye',
    items: [
      { label: 'מסך הבית', icon: 'house', action: () => navigate('dashboard') },
      { label: 'תלמידות', icon: 'users', action: () => navigate('students') },
      { label: 'מערכת שעות', icon: 'calendar-days', action: () => navigate('schedule') },
      { label: 'מבחנים ודיווחים', icon: 'file-text', action: () => navigate('exams') },
      { label: 'דוחות חיסורים', icon: 'chart-column', action: () => navigate('reports') },
      { sep: true },
      // סימון ✓ על הערכה הפעילה — נבנה מחדש בכל רינדור של המסגרת
      { label: 'ערכת צבעים: בהירה', icon: 'sun', action: () => setTheme('light'), checked: state.theme === 'light' },
      { label: 'ערכת צבעים: כהה', icon: 'moon', action: () => setTheme('dark'), checked: state.theme === 'dark' },
      { sep: true },
      { label: 'חידוש המסך', icon: 'refresh-cw', action: () => refreshAll() },
    ],
  },
  {
    label: 'עזרה',
    icon: 'circle-help',
    items: [
      { label: 'מדריך שימוש מהיר', icon: 'clipboard-list', action: () => openHelp() },
      { label: 'אודות התוכנה', icon: 'info', action: () => openAbout() },
    ],
  },
];

function renderShell() {
  $('#app').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-logo">נ</div>
          <div class="brand-text"><div class="brand-title">נוכחות</div><div class="brand-sub">ניהול כיתות</div></div>
        </div>
        <nav id="main-nav" class="nav-scroll">
          ${NAV.map((n) => `<button class="nav-item" data-nav="${n.name}">${ico(n.icon)}<span>${n.label}</span></button>`).join('')}
        </nav>
        <div class="sidebar-foot">
          <button class="nav-item theme-btn" id="theme-toggle">
            ${ico(state.theme === 'light' ? 'moon' : 'sun')}<span>ערכת ${state.theme === 'light' ? 'כהה' : 'בהירה'}</span>
          </button>
        </div>
      </aside>

      <div class="main-col">
        <div class="titlebar">
          <div class="titlebar-brand">${ico('graduation-cap')}<span>נוכחות</span></div>
          <nav class="menubar" id="menubar">
            ${MENU.map((m, i) => `
              <div class="menu" data-menu="${i}">
                <button class="menu-btn">${m.label}</button>
                <div class="menu-pop">
                  ${m.items.map((it) => it.sep
                    ? '<div class="menu-sep"></div>'
                    : `<button class="menu-item${it.checked ? ' is-on' : ''}" data-act="${it.action.name || it.label}">
                         ${ico(it.icon)}<span>${it.label}</span>
                         ${it.checked ? ico('check', 'menu-check') : ''}
                       </button>`).join('')}
                </div>
              </div>`).join('')}
          </nav>
          <div class="spacer"></div>
          <div class="titlebar-tools">
            <button class="tool-btn" id="tool-search" title="חיפוש תלמידה (Ctrl+K)">${ico('search')}</button>
            <button class="tool-btn" id="tool-backup" title="גיבוי עכשיו">${ico('database')}</button>
            <button class="tool-btn" id="theme-toggle-top" title="ערכת צבעים" aria-haspopup="true">
              ${ico(state.theme === 'light' ? 'moon' : 'sun')}${ico('chevron-down', 'tool-caret')}
            </button>
          </div>
        </div>
        <div class="statusbar" id="statusbar"></div>
        <main class="main" id="view"></main>
      </div>
    </div>`;

  $$('#main-nav .nav-item').forEach((b) => { b.onclick = () => navigate(b.dataset.nav); });
  $('#theme-toggle').onclick = toggleTheme;
  const topTheme = $('#theme-toggle-top');
  topTheme.onclick = (e) => { e.stopPropagation(); openThemeMenu(topTheme); };
  $('#tool-backup').onclick = doBackup;
  $('#tool-search').onclick = openSearch;
  bindMenu();
  setActiveNav();
  renderStatus();
}

function bindMenu() {
  const closeAll = () => $$('.menu.open').forEach((m) => m.classList.remove('open'));
  $$('#menubar .menu').forEach((menu, i) => {
    const btn = $('.menu-btn', menu);
    btn.onclick = (e) => {
      e.stopPropagation();
      const willOpen = !menu.classList.contains('open');
      closeAll();
      menu.classList.toggle('open', willOpen);
    };
    btn.onmouseenter = () => {
      if ($$('.menu.open').length) { closeAll(); menu.classList.add('open'); }
    };
    $$('.menu-item', menu).forEach((item, idx) => {
      const def = MENU[i].items.filter((x) => !x.sep)[idx];
      if (!def) return;
      item.onclick = (e) => { e.stopPropagation(); closeAll(); def.action(); };
    });
  });
  document.addEventListener('click', closeAll);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAll();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if ($('#view')) openSearch(); }
  });
}

function renderStatus() {
  const el = $('#statusbar');
  if (!el) return;
  const g = currentGroup();
  el.innerHTML = `
    <span class="sb-item">${ico('database')} ${esc(state.info?.dataDir || '')}</span>
    <span class="spacer"></span>
    ${g ? `<span class="sb-item" data-sb-group>${ico('users')} ${esc(g.name)} · ${g.student_count} תלמידות</span>` : ''}
    <span class="sb-item">${ico('info')} גרסה ${esc(state.info?.version || '—')}</span>`;
  const sbg = $('[data-sb-group]', el);
  if (sbg && g) sbg.onclick = () => navigate('students', { groupId: g.id });
}

function currentGroup() {
  const id = state.route.groupId;
  return id ? state.groups.find((g) => g.id === id) : null;
}

function setActiveNav() {
  const name = state.route.name;
  const parent = name === 'group' || name === 'lesson' || name === 'payments' ? 'dashboard' : name;
  $$('#main-nav .nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.nav === parent);
  });
}

// פרמטרים חד-פעמיים (כמו import=true) — נצרכים בכניסה אחת בלבד,
// כדי שרענון / מעבר טאב לא יחזיר את אשף הייבוא שוב ושוב
const EPHEMERAL_PARAMS = ['import'];

function navigate(name, params = {}) {
  state.route = { name, ...params };
  if (params.groupId) localStorage.setItem('lastGroup', String(params.groupId));
  render();
}

function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  state.theme = theme;
  localStorage.setItem('theme', theme);
  applyTheme();
  renderShell();
  render();
}
const toggleTheme = () => setTheme(state.theme === 'light' ? 'dark' : 'light');

// בחירת ערכת צבעים מהכפתור שבסרגל העליון
function openThemeMenu(anchor) {
  const host = $('.titlebar');
  if (!host) return;
  $$('.theme-pop').forEach((p) => p.remove());
  const pop = document.createElement('div');
  pop.className = 'theme-pop';
  pop.innerHTML = [
    { key: 'light', icon: 'sun', label: 'ערכת בהירה' },
    { key: 'dark', icon: 'moon', label: 'ערכת כהה' },
  ].map((t) => `<button class="menu-item${state.theme === t.key ? ' is-on' : ''}" data-theme-pick="${t.key}">
      ${ico(t.icon)}<span>${t.label}</span>${state.theme === t.key ? ico('check', 'menu-check') : ''}
    </button>`).join('');
  const r = anchor.getBoundingClientRect();
  const hr = host.getBoundingClientRect();
  pop.style.top = `${r.bottom - hr.top + 6}px`;
  pop.style.insetInlineEnd = `${hr.right - r.right}px`;
  host.appendChild(pop);
  const close = (e) => {
    if (pop.contains(e.target) || anchor.contains(e.target)) return;
    pop.remove();
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
  $$('[data-theme-pick]', pop).forEach((b) => {
    b.onclick = () => { pop.remove(); document.removeEventListener('mousedown', close, true); setTheme(b.dataset.themePick); };
  });
}

async function refreshAll() {
  await loadGroups();
  renderStatus();
  // רענון ידי המשתמש — לא חוזר לכרטיס שממנו נכנסו
  EPHEMERAL_PARAMS.forEach((k) => { delete state.route[k]; });
  render();
}

// רינדור אחד בכל רגע: אם מגיעים שני רינדורים במקביל (למשל "ערכת כהה" שנלחצה
// בזמן שהמסך עוד נטען), רק האחרון כותב ל-DOM — כדי שמסך שנטען לאט לא ידרוס את החדש
let renderSeq = 0;

async function render() {
  const seq = ++renderSeq;
  const alive = () => seq === renderSeq;
  setActiveNav();
  const view = $('#view');
  if (!view) return;

  // עמודים שדורשים קבוצה: אם אין — מציגים בורר
  let route = state.route;
  // מי שנלחץ על "העלאת תלמידות" בחר קבוצה במפורש; ללא קבוצה — עדיף שייבחרו, לא לנחש
  const explicitImport = route.name === 'students' && route.import;
  if (GROUP_ROUTES.has(route.name) && !route.groupId && state.groups.length) {
    if (state.groups.length === 1) { route = { ...route, groupId: state.groups[0].id }; state.route = route; }
    else if (explicitImport) return renderGroupPicker(view, route.name);
    else {
      // חוזרים לקבוצה האחרונה שבה עבדו — לא שואלים שוב בכל כניסה למסך
      const last = Number(localStorage.getItem('lastGroup'));
      const hit = state.groups.find((g) => g.id === last);
      if (hit && route.name === 'students') { route = { ...route, groupId: hit.id }; state.route = route; }
      else return renderGroupPicker(view, route.name);
    }
  }
  // קבוצה שנמחקה / לא קיימת — לא מציגים מסך שבור, חוזרים לבית
  if (GROUP_ROUTES.has(route.name) && route.groupId && !state.groups.some((g) => g.id === route.groupId) && state.groups.length) {
    route = { ...route, groupId: null };
    state.route = route;
    return renderGroupPicker(view, route.name);
  }

  view.classList.remove('fade-in');
  view.innerHTML = `<div class="loading">${ico('refresh-cw', 'spin')}<span>טוען…</span></div>`;
  try {
    // צריכת הפרמטרים החד-פעמיים לפני הרינדור — הרינדור עצמו קורא ל-state.route
    EPHEMERAL_PARAMS.forEach((k) => { delete state.route[k]; });
    switch (route.name) {
      case 'group': await renderGroupHub(view); break;
      case 'lesson': await renderLesson(view); break;
      case 'payments': await renderPayments(view); break;
      case 'students': await renderStudentsPage(view); break;
      case 'schedule': await renderSchedulePage(view); break;
      case 'exams': await renderExamsPage(view); break;
      case 'reports': await renderReportsPage(view); break;
      case 'admin': await renderAdmin(view); break;
      default: await renderDashboard(view);
    }
    if (!alive()) return;
    view.scrollTop = 0;
    view.classList.add('fade-in');
  } catch (e) {
    if (!alive()) return;
    fail(e);
    view.innerHTML = emptyState('triangle-alert', 'אירעה שגיאה בטעינת המסך', esc(e.message || ''));
  }
}

function emptyState(icon, title, sub = '', action = '') {
  return `<div class="card empty">
    <div class="e-ico">${ico(icon, 'xl')}</div>
    <div class="e-title">${title}</div>
    ${sub ? `<div class="e-sub">${sub}</div>` : ''}
    ${action ? `<div style="margin-top:16px">${action}</div>` : ''}
  </div>`;
}

// בורר קבוצה לעמודים גלובליים
async function renderGroupPicker(view, target) {
  const titles = { students: 'תלמידות', schedule: 'מערכת שעות', exams: 'מבחנים ודיווחים', reports: 'דוחות חיסורים' };
  view.innerHTML = `
    <div class="page-head"><div>
      <h1 class="page-title">${titles[target] || ''}</h1>
      <div class="page-sub">בחרו קבוצה להמשך</div>
    </div></div>
    ${state.groups.length ? groupCardsHTML(state.groups) : emptyState('school', 'אין קבוצות עדיין', 'צרו סמינר וקבוצה במסך הניהול', `<button class="btn primary" id="go-admin">${ico('settings')} לניהול</button>`)}`;
  bindGroupCards((id) => navigate(target, { groupId: id }));
  const a = $('#go-admin'); if (a) a.onclick = () => navigate('admin');
  view.classList.add('fade-in');
}

function groupCardsHTML(groups) {
  return `<div class="groups-grid">${groups.map((g) => `
    <div class="group-card" role="button" tabindex="0" data-group="${g.id}">
      <div class="gc-top">
        <div class="avatar">${esc(g.name.slice(0, 2)) || 'ק'}</div>
        <div class="gc-head">
          <div class="gc-name">${esc(g.name)}</div>
          <div class="gc-sem">${esc(g.seminar_name)}</div>
        </div>
        ${ico('chevron-left', 'gc-arrow')}
      </div>
      <div class="gc-meta">
        <span>${ico('users')} ${g.student_count} תלמידות</span>
        ${g.grade ? `<span>${ico('graduation-cap')} ${esc(g.grade)}</span>` : ''}
        ${g.track ? `<span>${ico('book-open')} ${esc(g.track)}</span>` : ''}
      </div>
      <span class="gc-action" role="button" data-group-import="${g.id}">${ico('upload')} העלאת תלמידות</span>
    </div>`).join('')}</div>`;
}

function bindGroupCards(onPick) {
  $$('[data-group]').forEach((b) => { b.onclick = () => onPick(Number(b.dataset.group)); });
  $$('[data-group-import]').forEach((sp) => {
    sp.onclick = (e) => {
      e.stopPropagation();
      navigate('students', { groupId: Number(sp.dataset.groupImport), import: true });
    };
  });
}

// ================= דשבורד =================
async function renderDashboard(view) {
  const [, now] = await Promise.all([
    call(window.api.lessons.ensureToday(today())),
    call(window.api.lessons.current(today(), nowHHMM())),
  ]);

  // מה קורה עכשיו — רק אם באמת יש מערכת שעות ושיעור מוגדר לרגעนี้
  const quick = now && now.length ? `
    <div class="quick-jump">
      <div class="qj-pulse"></div>
      <div class="qj-body">
        <div class="small faint">עכשיו לפי מערכת השעות · ${esc(now[0].start_time)}–${esc(now[0].end_time || '?')}</div>
        <div class="qj-title">${esc(now[0].group_name)} <span class="faint">·</span> ${esc(now[0].seminar_name)}</div>
        ${now.length > 1 ? `<div class="small muted">ועוד ${now.length - 1} קבוצות באותו זמן</div>` : ''}
      </div>
      <button class="btn primary lg" data-jump="${now[0].lesson_id}" data-group="${now[0].group_id}">
        ${ico('clipboard-check')} לסימון נוכחות
      </button>
    </div>` : '';

  const totalStudents = state.groups.reduce((n, g) => n + (g.student_count || 0), 0);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">שלום</h1>
        <div class="page-sub">יום ${WEEKDAYS[new Date().getDay()]} · ${fmtDate(today())}</div>
      </div>
      <div class="row">
        <button class="btn" id="refresh-now">${ico('refresh-cw')} רענון</button>
        <button class="btn" id="import-now">${ico('upload')} ייבוא תלמידות</button>
        <button class="btn primary" id="add-group">${ico('plus')} קבוצה חדשה</button>
      </div>
    </div>
    ${quick}
    ${!state.groups.length ? '': `
      <div class="onboard">
        <div class="ob-step"><span class="ob-n">1</span><div><b>סמינר וקבוצה</b><div class="small muted">${esc(state.groups[0].seminar_name)} · ${state.groups.length} קבוצות</div></div></div>
        <div class="ob-line"></div>
        <div class="ob-step ${totalStudents ? 'done' : ''}"><span class="ob-n">2</span><div><b>תלמידות</b><div class="small muted">${totalStudents ? `${totalStudents} תלמידות` : 'עוד לא הועלו'}</div></div></div>
        <div class="ob-line"></div>
        <div class="ob-step"><span class="ob-n">3</span><div><b>מערכת שעות</b><div class="small muted">אופציונלי — לסימון מהיר</div></div></div>
        <div class="spacer"></div>
        <button class="btn primary" id="ob-next">${ico('upload')} העלאת תלמידות מ-Excel</button>
      </div>`}
    <h2 class="section-title">הקבוצות שלי</h2>
    ${state.groups.length ? groupCardsHTML(state.groups)
      : emptyState('school', 'עדיין אין קבוצות', 'התחילו ביצירת סמינר וקבוצה במסך הניהול',
        `<button class="btn primary" id="go-admin">${ico('settings')} לניהול סמינרים וקבוצות</button>`)}`;

  bindGroupCards((id) => navigate('group', { groupId: id }));
  const goAdmin = $('#go-admin');
  if (goAdmin) goAdmin.onclick = () => navigate('admin');
  $('#refresh-now').onclick = () => refreshAll();
  $('#add-group').onclick = () => menuAddGroup();
  const pickForImport = () => {
    if (!state.groups.length) return toast('צרו קודם סמינר וקבוצה', 'error');
    const target = state.groups.length === 1 ? state.groups[0].id : null;
    if (target) return navigate('students', { groupId: target, import: true });
    navigate('students', { import: true });
  };
  $('#import-now').onclick = pickForImport;
  const obNext = $('#ob-next'); if (obNext) obNext.onclick = pickForImport;
  const jump = $('[data-jump]');
  if (jump) jump.onclick = () => navigate('lesson', { groupId: Number(jump.dataset.group), lessonId: Number(jump.dataset.jump) });
}

// ================= מרכז קבוצה =================
async function renderGroupHub(view) {
  const group = await call(window.api.groups.get(state.route.groupId));
  if (!group) throw new Error('הקבוצה לא נמצאה');
  const [lessons, students] = await Promise.all([
    call(window.api.lessons.list(group.id)),
    call(window.api.students.list(group.id, true)),
  ]);
  const active = students.filter((s) => s.active);
  const todayLesson = lessons.find((l) => l.date === today());
  // רק מערכת שעות קובעת איזה שיעור "עכשיו" — בלי מערכת שעות אין המצאות
  const st = await call(window.api.schedule.statusNow(group.id, today(), nowHHMM()));

  const tiles = [
    { icon: 'users', label: 'תלמידות', value: active.length, go: () => navigate('students', { groupId: group.id }) },
    // לאותו מסך יש גם מערכת שעות וגם רשימת שיעורים — מפנים לפי מה שחסר קודם
    { icon: 'calendar-days', label: 'שיעורים', value: lessons.length, go: () => navigate('schedule', { groupId: group.id, tab: st.hasSchedule ? 'lessons' : 'slots' }) },
    { icon: 'credit-card', label: 'שילמו על הספר', value: `${students.filter((s) => s.paid).length}/${students.length}`, go: () => navigate('payments', { groupId: group.id }) },
    { icon: 'file-text', label: 'מבחנים', value: '—', go: () => navigate('exams', { groupId: group.id }) },
    { icon: 'chart-column', label: 'דוחות חיסורים', value: '—', go: () => navigate('reports', { groupId: group.id }) },
  ];

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לבית</button>
        <h1 class="page-title" style="margin-top:6px">${esc(group.name)}</h1>
        <div class="page-sub">${esc(group.seminar_name)}${group.book_title ? ` · ספר: ${esc(group.book_title)}` : ''}${group.teacher ? ` · ${esc(group.teacher)}` : ''}</div>
      </div>
      <div class="row">
        <button class="btn lg" id="import-students">${ico('upload')} העלאת תלמידות</button>
        <button class="btn primary lg" id="start-lesson">${ico('clipboard-check')} ${st.now ? 'סימון נוכחות — עכשיו' : todayLesson ? 'סימון נוכחות — שיעור היום' : 'סימון נוכחות'}</button>
      </div>
    </div>

    ${st.now ? `
      <div class="quick-jump">
        <div class="qj-pulse"></div>
        <div class="qj-body">
          <div class="small faint">לפי מערכת השעות — השיעור מתקיים עכשיו</div>
          <div class="qj-title">${esc(st.now.slot.start_time)}–${esc(st.now.slot.end_time || '?')}${st.now.slot.topic ? ' · ' + esc(st.now.slot.topic) : ''}</div>
        </div>
        <div class="small muted">${st.now.lesson && st.now.lesson.marked_count ? `${st.now.lesson.marked_count} סומנו` : 'טרם סומן'}</div>
      </div>`
    : st.next ? `
      <div class="next-slot">
        ${ico('clock')}
        <div>
          <div class="small faint">השיעור הבא</div>
          <b>${fmtDate(st.next.date)} · ${esc(weekdayOf(st.next.date))} · ${esc(st.next.slot.start_time)}–${esc(st.next.slot.end_time || '?')}</b>
          ${st.next.slot.topic ? `<span class="muted"> · ${esc(st.next.slot.topic)}</span>` : ''}
        </div>
      </div>`
    : `
      <div class="next-slot no-sched">
        ${ico('triangle-alert')}
        <div>
          <div class="small faint">${st.hasSchedule ? 'אין שיעור קבוע שמתאים' : 'אין מערכת שעות לקבוצה'}</div>
          <b>${st.hasSchedule ? 'לא נמצאה משבצת היום' : 'כדי שהמערכת תדע איזה שיעור עכשיו — הגדירו מערכת שעות'}</b>
          <div class="small muted">בינתיים אפשר לפתוח שיעור ידני</div>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="go-schedule">${ico('calendar-days')} הגדרת מערכת שעות</button>
      </div>`}

    <div class="tiles">
      ${tiles.map((t, i) => `
        <button class="tile" data-tile="${i}">
          <span class="tile-ico">${ico(t.icon)}</span>
          <span class="tile-v">${esc(t.value)}</span>
          <span class="tile-l">${t.label}</span>
        </button>`).join('')}
    </div>

    <div class="card" style="margin-top:22px">
      <div class="card-head">
        <h2>שיעורי הקבוצה</h2>
        <div class="spacer"></div>
        <button class="btn sm ghost" id="edit-sched">${ico('calendar-days')} מערכת שעות</button>
        <button class="btn sm" id="manual-lesson">${ico('plus')} שיעור ידני</button>
      </div>
      ${lessons.length ? `
      <table class="data">
        <thead><tr><th>תאריך</th><th>יום</th><th>שעה</th><th>נושא</th><th class="center">חסרות</th><th class="center">איחורים</th><th></th></tr></thead>
        <tbody>${lessons.slice(0, 40).map((l) => `
          <tr>
            <td class="nowrap">${fmtDate(l.date)}</td>
            <td class="muted nowrap">${esc(weekdayOf(l.date))}</td>
            <td class="muted nowrap">${esc(l.start_time || '—')}${l.end_time ? '–' + esc(l.end_time) : ''}</td>
            <td>${esc(l.topic || l.content || '—')}</td>
            <td class="center">${l.absent_count ? `<span class="pill absent">${l.absent_count}</span>` : '<span class="faint">0</span>'}</td>
            <td class="center">${l.late_count ? `<span class="pill late">${l.late_count}</span>` : '<span class="faint">0</span>'}</td>
            <td class="actions"><button class="btn sm" data-lesson="${l.id}">${ico('square-pen')} פתיחה</button></td>
          </tr>`).join('')}</tbody>
      </table>` : `<div class="empty">${ico('calendar-days', 'xl')}<div class="e-title">אין שיעורים עדיין</div>
        <div class="e-sub">שיעורים נוצרים אוטומטית לפי מערכת השעות, או ידנית</div>
        <div class="row" style="justify-content:center;margin-top:14px">
          <button class="btn primary" id="go-schedule-2">${ico('calendar-days')} הגדרת מערכת שעות</button>
          <button class="btn" id="add-lesson-empty">${ico('plus')} שיעור ידני</button>
        </div></div>`}
    </div>`;

  $('#back').onclick = () => navigate('dashboard');
  $$('[data-tile]').forEach((b) => { b.onclick = tiles[Number(b.dataset.tile)].go; });
  $('#import-students').onclick = () => navigate('students', { groupId: group.id, import: true });
  $$('#go-schedule, #go-schedule-2').forEach((b) => { b.onclick = () => navigate('schedule', { groupId: group.id }); });
  const addEmpty = $('#add-lesson-empty'); if (addEmpty) addEmpty.onclick = () => openManualLesson(group.id);
  $('#edit-sched').onclick = () => navigate('schedule', { groupId: group.id });
  $('#start-lesson').onclick = async () => {
    try {
      // 1) שיעור שמתקיים עכשיו לפי מערכת השעות  2) שיעור היום שכבר נפתח  3) בחירה מפורשת
      if (st.now) {
        const l = st.now.lesson || await call(window.api.lessons.openSlot(group.id, today(), st.now.slot.start_time));
        return navigate('lesson', { groupId: group.id, lessonId: l.id });
      }
      if (todayLesson) return navigate('lesson', { groupId: group.id, lessonId: todayLesson.id });
      openLessonChooser(group, st);
    } catch (e) { fail(e); }
  };
  $$('[data-lesson]').forEach((b) => { b.onclick = () => navigate('lesson', { groupId: group.id, lessonId: Number(b.dataset.lesson) }); });
  $('#manual-lesson').onclick = () => openManualLesson(group.id);
}

// אין שיעור פעיל עכשיו — לא ממציאים: שואלים במפורש מה לפתוח
function openLessonChooser(group, st) {
  const next = st.next;
  const reason = !st.hasSchedule
    ? 'לקבוצה הזו עדיין לא הוגדרה מערכת שעות, ולכן המערכת אינה יודעת איזה שיעור מתקיים עכשיו.'
    : 'לפי מערכת השעות אין שיעור שמתקיים עכשיו.';
  modal(`
    <h3>${ico('clipboard-check')} איזה שיעור לסמן?</h3>
    <p class="muted" style="margin:-8px 0 18px">${esc(reason)}</p>
    <div class="choice-list">
      <button class="choice" id="ch-today">
        <span class="choice-ico">${ico('calendar-days')}</span>
        <span><b>שיעור להיום</b><span class="small muted">${fmtDate(today())} · ${esc(WEEKDAYS[new Date().getDay()])}</span></span>
        ${ico('chevron-left', 'choice-arrow')}
      </button>
      ${next ? `
        <button class="choice" id="ch-next">
          <span class="choice-ico">${ico('clock')}</span>
          <span><b>השיעור הבא</b><span class="small muted">${fmtDate(next.date)} · ${esc(weekdayOf(next.date))} · ${esc(next.slot.start_time)}–${esc(next.slot.end_time || '?')}${next.slot.topic ? ' · ' + esc(next.slot.topic) : ''}</span></span>
          ${ico('chevron-left', 'choice-arrow')}
        </button>` : ''}
      <button class="choice" id="ch-manual">
        <span class="choice-ico">${ico('square-pen')}</span>
        <span><b>שיעור ידני</b><span class="small muted">בחירת תאריך ושעה מראש</span></span>
        ${ico('chevron-left', 'choice-arrow')}
      </button>
      <button class="choice" id="ch-sched">
        <span class="choice-ico">${ico('calendar-days')}</span>
        <span><b>הגדרת מערכת שעות</b><span class="small muted">שיעורים יופיעו אוטומטית בזמן שלהם</span></span>
        ${ico('chevron-left', 'choice-arrow')}
      </button>
    </div>
    <div class="modal-foot"><div class="spacer"></div><button class="btn" data-cancel>ביטול</button></div>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#ch-today', root).onclick = async () => {
        try {
          // כבר יש שיעור היום? פותחים אותו; אחרת יוצרים שיעור ידני להיום
          const existing = await call(window.api.lessons.list(group.id));
          const same = existing.find((l) => l.date === today());
          if (same) { close(); navigate('lesson', { groupId: group.id, lessonId: same.id }); return; }
          close(); openManualLesson(group.id);
        } catch (e) { fail(e); }
      };
      const nextBtn = $('#ch-next', root);
      if (nextBtn) nextBtn.onclick = async () => {
        try {
          const l = next.lesson || await call(window.api.lessons.openSlot(group.id, next.date, next.slot.start_time));
          close(); navigate('lesson', { groupId: group.id, lessonId: l.id });
        } catch (e) { fail(e); }
      };
      $('#ch-manual', root).onclick = () => { close(); openManualLesson(group.id); };
      $('#ch-sched', root).onclick = () => { close(); navigate('schedule', { groupId: group.id }); };
    },
  });
}

function openManualLesson(groupId) {
  modal(`
    <h3>${ico('calendar-days')} שיעור ידני</h3>
    <form id="ml-form">
      <label class="field"><span>תאריך</span><input type="date" name="date" value="${today()}" required /></label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>שעת התחלה</span><input type="time" name="start_time" value="${nowHHMM()}" /></label>
        <label class="field" style="flex:1"><span>שעת סיום</span><input type="time" name="end_time" /></label>
      </div>
      <label class="field"><span>נושא</span><input type="text" name="topic" /></label>
      <div class="modal-foot">
        <button class="btn primary" type="submit">${ico('check')} פתיחת שיעור</button>
        <button class="btn" type="button" data-cancel>ביטול</button>
      </div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#ml-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (f.start_time && f.end_time && f.end_time <= f.start_time) return toast('שעת הסיום חייבת להיות אחרי ההתחלה', 'error');
        try {
          const id = await call(window.api.lessons.sSave({ ...f, group_id: groupId, source: 'manual' }));
          close();
          navigate('lesson', { groupId, lessonId: id });
        } catch (err) { fail(err); }
      };
    },
  });
}

// ================= מסך שיעור — הלב =================
async function renderLesson(view) {
  const { groupId, lessonId } = state.route;
  const [group, lesson] = await Promise.all([
    call(window.api.groups.get(groupId)),
    call(window.api.lessons.get(lessonId)),
  ]);
  if (!group || !lesson) throw new Error('השיעור לא נמצא');

  const [students, marks] = await Promise.all([
    call(window.api.students.list(groupId, false)),
    call(window.api.attendance.getForLesson(lessonId)),
  ]);
  const markOf = (sid) => marks.find((m) => m.student_id === sid) || { status: 'present', discipline: 0, discipline_note: null };

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">${esc(group.name)} — ${fmtDate(lesson.date)}</h1>
        <div class="page-sub">יום ${esc(weekdayOf(lesson.date))}${lesson.start_time ? ` · ${esc(lesson.start_time)}${lesson.end_time ? '–' + esc(lesson.end_time) : ''}` : ''}${lesson.source === 'manual' ? ' · שיעור ידני' : ''}</div>
      </div>
      <div class="row">
        <button class="btn" id="open-report">${ico('clipboard-list')} חסרות ומאחרות</button>
      </div>
    </div>

    <div class="lesson-layout">
      <div class="card">
        ${students.length ? `
        <div class="student-row head-row">
          <div class="sr-info">תלמידה</div>
          <div class="row-labels">${STATUS_ORDER.map((st) => `<span>${STATUS_LABEL[st]}</span>`).join('')}</div>
          <div class="disc-head">משמעת</div>
        </div>
        <div id="student-list">
          ${students.map((s) => {
            const m = markOf(s.id);
            return `
            <div class="student-row" data-student="${s.id}">
              <div class="avatar sm">${esc(initials(s.first_name, s.last_name))}</div>
              <div class="sr-info">
                <div class="sr-name">${esc(s.first_name)} ${esc(s.last_name)}</div>
                <div class="sr-homeroom">${esc(s.homeroom || '')}</div>
                <div class="sr-note ${m.discipline_note ? '' : 'hidden'}">${esc(m.discipline_note || '')}</div>
              </div>
              <div class="seg">
                ${STATUS_ORDER.map((st) => `
                  <button data-status="${st}" class="${m.status === st ? 'on' : ''}" title="${STATUS_LABEL[st]}">${STATUS_LABEL[st]}</button>`).join('')}
              </div>
              <button class="discipline-btn ${m.discipline ? 'on' : ''}" data-disc title="הפרת משמעת">
                ${m.discipline ? ico('triangle-alert') : ico('alert-triangle')}<span>משמעת</span>
              </button>
              <button class="btn icon sm ghost" data-edit-student title="עריכת פרטי התלמידה">${ico('pencil')}</button>
            </div>`;
          }).join('')}
        </div>` : emptyState('users', 'אין תלמידות פעילות בקבוצה', 'הוסיפו תלמידות במסך התלמידות',
          `<button class="btn primary" id="go-students">${ico('users')} למסך התלמידות</button>`)}
      </div>

      <div class="lesson-side">
        <div class="card card-pad">
          <h3 class="side-title">${ico('check-check')} סיכום השיעור</h3>
          <div class="grid" style="gap:8px" id="counters"></div>
        </div>
        <div class="card card-pad">
          <h3 class="side-title">${ico('square-pen')} פרטי השיעור</h3>
          <label class="field"><span>נושא השיעור</span><input type="text" id="lesson-topic" value="${esc(lesson.topic || '')}" /></label>
          <label class="field"><span>ההספק</span><textarea id="lesson-content">${esc(lesson.content || '')}</textarea></label>
          <button class="btn primary block" id="save-lesson">${ico('save')} שמירת פרטי השיעור</button>
        </div>
      </div>
    </div>`;

  $('#back').onclick = () => navigate('group', { groupId });
  $('#open-report').onclick = () => openAttendanceReport(group, lesson);
  const goStudents = $('#go-students');
  if (goStudents) goStudents.onclick = () => navigate('students', { groupId });

  $('#save-lesson').onclick = async () => {
    try {
      await call(window.api.lessons.sSave({
        id: lesson.id, date: lesson.date, start_time: lesson.start_time, end_time: lesson.end_time,
        topic: $('#lesson-topic').value.trim(), content: $('#lesson-content').value.trim(), source: lesson.source,
      }));
      lesson.topic = $('#lesson-topic').value.trim();
      toast('פרטי השיעור נשמרו');
    } catch (err) { fail(err); }
  };

  const setCounter = () => {
    const counts = { present: 0, absent: 0, late: 0, released: 0 };
    $$('[data-student]').forEach((row) => {
      const on = $('.seg button.on', row);
      if (on) counts[on.dataset.status]++;
    });
    $('#counters').innerHTML = STATUS_ORDER.map((st) => `
      <div class="counter-chip"><span class="pill ${st}">${STATUS_LABEL[st]}</span><b>${counts[st]}</b></div>`).join('');
  };

  $$('[data-student]').forEach((row) => {
    const sid = Number(row.dataset.student);
    const m = markOf(sid);

    // לחיצה אחת על מצב
    $$('.seg button', row).forEach((btn) => {
      btn.onclick = async () => {
        const prev = $('.seg button.on', row);
        $$('.seg button', row).forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        setCounter();
        try { await call(window.api.attendance.set(lesson.id, sid, { status: btn.dataset.status })); }
        catch (e) { if (prev) { btn.classList.remove('on'); prev.classList.add('on'); setCounter(); } fail(e); }
      };
    });

    const discBtn = $('[data-disc]', row);
    const noteEl = $('.sr-note', row);
    const paintDisc = (d, note) => {
      discBtn.classList.toggle('on', !!d);
      discBtn.innerHTML = `${ico(d ? 'triangle-alert' : 'alert-triangle')}<span>משמעת</span>`;
      noteEl.textContent = note || '';
      noteEl.classList.toggle('hidden', !note);
    };
    discBtn.onclick = () => openDisciplineDialog(lesson.id, sid, { ...m, discipline: discBtn.classList.contains('on') }, (d, note) => {
      m.discipline = d ? 1 : 0;
      m.discipline_note = note;
      paintDisc(d, note);
    });

    $('[data-edit-student]', row).onclick = () => openStudentEdit(groupId, students.find((s) => s.id === sid), () => render());
  });

  setCounter();
}

function openDisciplineDialog(lessonId, studentId, mark, onSaved) {
  modal(`
    <h3>${ico('triangle-alert')} הפרת משמעת</h3>
    <label class="row toggle-row" style="cursor:pointer;margin-bottom:16px">
      <input type="checkbox" id="disc-on" ${mark.discipline ? 'checked' : ''} />
      <span>סמן הפרת משמעת בשיעור זה</span>
    </label>
    <label class="field"><span>הערת משמעת</span><textarea id="disc-note" placeholder="תיאור קצר של המקרה…">${esc(mark.discipline_note || '')}</textarea></label>
    <div class="modal-foot">
      <button class="btn primary" id="disc-save">${ico('save')} שמירה</button>
      <button class="btn" data-cancel>ביטול</button>
    </div>`, {
    onMount(root, close) {
      const paint = () => { $('#disc-note', root).parentElement.classList.toggle('dim', !$('#disc-on', root).checked); };
      $('#disc-on', root).onchange = paint; paint();
      $('[data-cancel]', root).onclick = close;
      $('#disc-save', root).onclick = async () => {
        const d = $('#disc-on', root).checked;
        const note = $('#disc-note', root).value.trim();
        try {
          await call(window.api.attendance.set(lessonId, studentId, { discipline: d ? 1 : 0, discipline_note: d ? note || null : null }));
          onSaved(d, d ? note : '');
          close();
        } catch (e) { fail(e); }
      };
    },
  });
}

// ================= דוח חסרות ומאחרות (שיעור בודד) =================
async function openAttendanceReport(group, lesson) {
  const data = await call(window.api.attendance.report(group.id, lesson.date, lesson.date));
  const sect = (st, title) => {
    const items = data.filter((d) => d.status === st);
    return `
      <div class="report-sect">
        <h4><span class="dot ${st}"></span>${title} <span class="pill ${st}">${items.length}</span></h4>
        ${items.length ? `<div class="grid" style="gap:6px">${items.map((d) => `
          <div class="counter-chip"><span>${esc(d.first_name)} ${esc(d.last_name)}${d.homeroom ? ` <span class="faint">(${esc(d.homeroom)})</span>` : ''}</span><span class="faint small">${esc(d.start_time || '')}</span></div>`).join('')}</div>`
        : `<div class="muted small">— אין —</div>`}
      </div>`;
  };

  modal(`
    <h3>${ico('clipboard-list')} חסרות ומאחרות — ${esc(group.name)} · ${fmtDate(lesson.date)}</h3>
    ${sect('absent', 'חסרות')}
    ${sect('late', 'מאחרות')}
    ${sect('released', 'שחרור')}
    <div class="modal-foot">
      <button class="btn" id="print-r">${ico('printer')} הדפסה</button>
      <button class="btn" id="excel-r">${ico('file-spreadsheet')} ייצוא Excel</button>
      <div class="spacer"></div>
      <button class="btn" data-close>סגירה</button>
    </div>`, {
    onMount(root, close) {
      $('[data-close]', root).onclick = close;
      const rows = () => {
        const out = [['שם פרטי', 'שם משפחה', 'כיתה', 'מצב', 'תאריך', 'שעה', 'נושא']];
        data.forEach((d) => out.push([d.first_name, d.last_name, d.homeroom || '', STATUS_LABEL[d.status], fmtDate(d.date), d.start_time || '', d.topic || '']));
        return out;
      };
      $('#print-r', root).onclick = () => printTable(`חסרות ומאחרות — ${group.name}`, `שיעור ${fmtDate(lesson.date)}`, rows());
      $('#excel-r', root).onclick = () => exportExcel(rows(), `חסרות-ומאחרות-${group.name}-${lesson.date}`, 'חסרות ומאחרות');
    },
  });
}

// ================= תשלומים =================
async function renderPayments(view) {
  const groupId = state.route.groupId;
  const [group, students] = await Promise.all([
    call(window.api.groups.get(groupId)),
    call(window.api.students.list(groupId, true)),
  ]);
  const filter = state.payFilter;
  const matches = (s) => filter === 'all'
    || (filter === 'paid' && s.paid)
    || (filter === 'unpaid' && !s.paid)
    || (filter === 'nobook' && !s.received_book);
  const paidCount = students.filter((s) => s.paid);
  const income = paidCount.length * Number(group.book_price || 0);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">תשלום ספר</h1>
        <div class="page-sub">${esc(group.name)} · ${esc(group.book_title || 'לא נבחר ספר')}${group.book_price ? ` · ${Number(group.book_price).toFixed(0)} ₪` : ''}</div>
      </div>
      <button class="btn" id="pay-excel">${ico('file-spreadsheet')} ייצוא Excel</button>
    </div>

    <div class="stats-row" style="margin-bottom:18px">
      <div class="card stat"><div class="v">${students.length}</div><div class="l">תלמידות</div></div>
      <div class="card stat"><div class="v" style="color:var(--present)">${paidCount.length}</div><div class="l">שילמו</div></div>
      <div class="card stat"><div class="v" style="color:var(--absent)">${students.length - paidCount.length}</div><div class="l">טרם שילמו</div></div>
      <div class="card stat"><div class="v">${students.filter((s) => s.received_book).length}</div><div class="l">קיבלו את הספר</div></div>
      ${group.book_price ? `<div class="card stat"><div class="v">${income.toFixed(0)} ₪</div><div class="l">סך התקבולים</div></div>` : ''}
    </div>

    <div class="row" style="margin-bottom:16px">
      <div class="seg filter-seg">
        <button data-f="all" class="${filter === 'all' ? 'on' : ''}" data-status="present">כל התלמידות</button>
        <button data-f="paid" class="${filter === 'paid' ? 'on' : ''}" data-status="present">שילמו</button>
        <button data-f="unpaid" class="${filter === 'unpaid' ? 'on' : ''}" data-status="absent">לא שילמו</button>
        <button data-f="nobook" class="${filter === 'nobook' ? 'on' : ''}" data-status="late">לא קיבלו ספר</button>
      </div>
    </div>
    <div class="card">
      <table class="data">
        <thead><tr><th>תלמידה</th><th>כיתה</th><th class="center">שילמה</th><th class="center">קיבלה ספר</th></tr></thead>
        <tbody>
          ${students.filter(matches).map((s) => `
            <tr class="${s.active ? '' : 'inactive'}">
              <td>${esc(s.first_name)} ${esc(s.last_name)}${s.active ? '' : ' <span class="pill muted">לא פעילה</span>'}</td>
              <td class="muted">${esc(s.homeroom || '')}</td>
              <td class="center"><button class="check ${s.paid ? 'on' : ''}" data-paid="${s.id}" title="שילמה">${ico('check')}</button></td>
              <td class="center"><button class="check neutral ${s.received_book ? 'on' : ''}" data-book="${s.id}" title="קיבלה ספר">${ico('check')}</button></td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${!students.length ? `<div class="empty">אין תלמידות בקבוצה</div>` : ''}
    </div>`;

  $('#back').onclick = () => navigate('group', { groupId });
  $$('[data-f]').forEach((b) => { b.onclick = () => { state.payFilter = b.dataset.f; render(); }; });
  const bindCheck = (attr, field) => $$(`[data-${attr}]`).forEach((b) => {
    b.onclick = async () => {
      const on = !b.classList.contains('on');
      try { await call(window.api.students.setPaid(Number(b.dataset[attr]), field, on)); b.classList.toggle('on', on); }
      catch (e) { fail(e); }
    };
  });
  bindCheck('paid', 'paid');
  bindCheck('book', 'received_book');
  $('#pay-excel').onclick = () => {
    const rows = [['שם פרטי', 'שם משפחה', 'כיתה', 'סטטוס', 'שילמה', 'קיבלה ספר', 'הערות']];
    students.forEach((s) => rows.push([s.first_name, s.last_name, s.homeroom || '', s.active ? 'פעילה' : 'לא פעילה', s.paid ? 'כן' : 'לא', s.received_book ? 'כן' : 'לא', s.notes || '']));
    exportExcel(rows, `תשלומים-${group.name}`, 'תשלומים');
  };
}

// ================= תלמידות =================
async function renderStudentsPage(view) {
  const groupId = state.route.groupId;
  const [group, students] = await Promise.all([
    call(window.api.groups.get(groupId)),
    call(window.api.students.list(groupId, true)),
  ]);
  const showInactive = state.showInactive;
  const q = (state.studentQuery || '').trim();
  const shown = students
    .filter((s) => showInactive || s.active)
    .filter((s) => !q || `${s.first_name} ${s.last_name} ${s.homeroom || ''}`.includes(q));

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">תלמידות — ${esc(group.name)}</h1>
        <div class="page-sub">${students.filter((s) => s.active).length} פעילות · ${students.length} סה"כ · שילמו ${students.filter((s) => s.paid).length}</div>
      </div>
      <div class="row">
        <button class="btn" id="import">${ico('upload')} ייבוא מ-Excel</button>
        <button class="btn" id="export">${ico('file-spreadsheet')} ייצוא</button>
        <button class="btn primary" id="add">${ico('user-plus')} תלמידה חדשה</button>
      </div>
    </div>

    <div class="row" style="margin-bottom:14px">
      <div class="input-wrap search-wrap">${ico('search')}<input type="text" id="st-search" placeholder="חיפוש לפי שם או כיתה…" value="${esc(q)}" /></div>
      <label class="row toggle-row small muted" style="cursor:pointer">
        <input type="checkbox" id="show-inactive" ${showInactive ? 'checked' : ''} />
        הצג גם תלמידות לא פעילות
      </label>
    </div>

    <div class="card">
      <table class="data">
        <thead><tr><th>#</th><th>שם</th><th>כיתה</th><th>סטטוס</th><th class="center">שילמה</th><th class="center">ספר</th><th>הערות</th><th></th></tr></thead>
        <tbody>
          ${shown.map((s, i) => `
            <tr class="${s.active ? '' : 'inactive'}">
              <td class="faint">${i + 1}</td>
              <td><b>${esc(s.first_name)} ${esc(s.last_name)}</b></td>
              <td class="muted">${esc(s.homeroom || '')}</td>
              <td>${s.active ? '<span class="pill present">פעילה</span>' : '<span class="pill muted">לא פעילה</span>'}</td>
              <td class="center">${s.paid ? `<span class="pill present">כן</span>` : `<span class="pill muted">לא</span>`}</td>
              <td class="center">${s.received_book ? `<span class="pill released">כן</span>` : `<span class="pill muted">לא</span>`}</td>
              <td class="muted small ellipsis" style="max-width:240px">${esc(s.notes || '')}</td>
              <td class="actions">
                <button class="btn sm ghost" data-edit="${s.id}" title="עריכה">${ico('pencil')}</button>
                <button class="btn sm ghost" data-toggle="${s.id}" title="${s.active ? 'העברה ללא פעילה' : 'החזרה לפעילה'}">${ico(s.active ? 'user-x' : 'user-check')}</button>
                <button class="btn sm ghost" data-del="${s.id}" title="מחיקה">${ico('trash-2')}</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${!shown.length ? `<div class="empty">
        ${ico('users', 'xl')}
        <div class="e-title">${q ? 'לא נמצאו תלמידות מתאימות' : 'רשימת התלמידות ריקה'}</div>
        ${q ? '' : `<div class="e-sub">המהיר ביותר: ייבוא מגיליון Excel — המערכת מזהה את העמודות ומציגה תצוגה מקדימה לפני השמירה</div>
        <div class="row" style="justify-content:center;margin-top:16px">
          <button class="btn primary" id="import-empty">${ico('upload')} ייבוא מ-Excel</button>
          <button class="btn" id="add-empty">${ico('user-plus')} הוספה ידנית</button>
        </div>`}
      </div>` : ''}
    </div>`;

  $('#back').onclick = () => navigate('group', { groupId });
  $('#show-inactive').onchange = (e) => { state.showInactive = e.target.checked; render(); };
  const search = $('#st-search');
  let debounce;
  search.oninput = () => { clearTimeout(debounce); debounce = setTimeout(() => { state.studentQuery = search.value; render(); setTimeout(() => { const el = $('#st-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, 300); };
  $('#add').onclick = () => openStudentEdit(groupId, null, () => render());
  $('#import').onclick = () => openImportWizard(groupId, students, () => render());
  const ie = $('#import-empty'); if (ie) ie.onclick = () => openImportWizard(groupId, students, () => render());
  const ae = $('#add-empty'); if (ae) ae.onclick = () => openStudentEdit(groupId, null, () => render());
  // הגעה מיידית מיישור "העלאת תלמידות" — פותחים את האשף רק כשאין עדיין תלמידות
  if (state.route.import && !students.length) {
    state.route = { ...state.route, import: false };
    setTimeout(() => openImportWizard(groupId, students, () => render()), 120);
  }
  $('#export').onclick = () => {
    const rows = [['שם פרטי', 'שם משפחה', 'כיתה', 'סטטוס', 'שילמה על הספר', 'קיבלה ספר', 'הערות']];
    students.forEach((s) => rows.push([s.first_name, s.last_name, s.homeroom || '', s.active ? 'פעילה' : 'לא פעילה', s.paid ? 'כן' : 'לא', s.received_book ? 'כן' : 'לא', s.notes || '']));
    exportExcel(rows, `תלמידות-${group.name}`, 'תלמידות');
  };
  $$('[data-edit]').forEach((b) => { b.onclick = () => openStudentEdit(groupId, students.find((s) => s.id === Number(b.dataset.edit)), () => render()); });
  $$('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      const s = students.find((x) => x.id === Number(b.dataset.toggle));
      try { await call(window.api.students.save({ id: s.id, active: s.active ? 0 : 1 })); toast(s.active ? 'התלמידה הועברה ללא פעילות' : 'התלמידה חזרה לפעילות'); render(); } catch (e) { fail(e); }
    };
  });
  $$('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const s = students.find((x) => x.id === Number(b.dataset.del));
      if (!(await confirmDialog(`למחוק את ${s.first_name} ${s.last_name}? כל הנוכחות והציונים שלה יימחקו.`))) return;
      try { await call(window.api.students.remove(s.id)); toast('התלמידה נמחקה'); render(); } catch (e) { fail(e); }
    };
  });
  if (state.focusSearch) {
    state.focusSearch = false;
    setTimeout(() => search.focus(), 0);
  }
}

function openStudentEdit(groupId, student, onDone) {
  const s = student || { first_name: '', last_name: '', homeroom: '', notes: '', active: 1, paid: 0, received_book: 0 };
  const isNew = !student;
  modal(`
    <h3>${ico(isNew ? 'user-plus' : 'pencil')} ${isNew ? 'תלמידה חדשה' : 'עריכת תלמידה'}</h3>
    <form id="st-form">
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>שם פרטי</span><input type="text" name="first_name" value="${esc(s.first_name)}" required autofocus /></label>
        <label class="field" style="flex:1"><span>שם משפחה</span><input type="text" name="last_name" value="${esc(s.last_name)}" required /></label>
        <label class="field" style="flex:1"><span>כיתה</span><input type="text" name="homeroom" value="${esc(s.homeroom || '')}" placeholder="לדוגמה: י'2" /></label>
      </div>
      <div class="row" style="gap:22px;margin-bottom:14px">
        <label class="row toggle-row" style="cursor:pointer"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} /> תלמידה פעילה</label>
        <label class="row toggle-row" style="cursor:pointer"><input type="checkbox" name="paid" ${s.paid ? 'checked' : ''} /> שילמה על הספר</label>
        <label class="row toggle-row" style="cursor:pointer"><input type="checkbox" name="received_book" ${s.received_book ? 'checked' : ''} /> קיבלה את הספר</label>
      </div>
      <label class="field"><span>הערכה והערות</span><textarea name="notes">${esc(s.notes || '')}</textarea></label>
      <div class="modal-foot">
        <button class="btn primary" type="submit">${ico('save')} שמירה</button>
        <button class="btn" type="button" data-cancel>ביטול</button>
      </div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#st-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const payload = {
          id: s.id,
          group_id: groupId,
          first_name: String(f.get('first_name')).trim(),
          last_name: String(f.get('last_name')).trim(),
          homeroom: String(f.get('homeroom') || '').trim() || null,
          notes: String(f.get('notes') || '').trim() || null,
          active: f.get('active') ? 1 : 0,
          paid: f.get('paid') ? 1 : 0,
          received_book: f.get('received_book') ? 1 : 0,
        };
        try {
          await call(window.api.students.save(payload));
          close();
          toast(isNew ? 'התלמידה נוספה' : 'הפרטים נשמרו');
          onDone();
        } catch (err) { fail(err); }
      };
    },
  });
}

// ----- אשף ייבוא Excel -----
const IMPORT_FIELDS = [
  { key: 'first_name', label: 'שם פרטי', required: true, words: ['שם פרטי', 'פרטי', 'שם'], exact: ['שם'] },
  { key: 'last_name', label: 'שם משפחה', required: true, words: ['שם משפחה', 'משפחה', 'משפחת'] },
  { key: 'homeroom', label: 'כיתה', words: ['כיתה', 'כיתת', 'קבוצה'] },
  { key: 'notes', label: 'הערות', words: ['הערה', 'הערות', 'הערכה'] },
];

async function openImportWizard(groupId, existing, onDone) {
  let data;
  try { data = await call(window.api.excel.import()); } catch (e) { return fail(e); }
  if (!data || !data.sheets.length) return;

  const n = (v) => String(v ?? '').replace(/[\s‏‎"']/g, '');
  const existingKeys = new Set((existing || []).map((s) => `${n(s.first_name)}|${n(s.last_name)}`));

  // איתור שורת הכותרת מתוך 12 השורות הראשונות
  const detect = (rows) => {
    for (let i = 0; i < Math.min(rows.length, 12); i++) {
      const cells = rows[i].map((c) => String(c ?? '').trim());
      const hits = IMPORT_FIELDS.filter((f) => cells.some((c) => f.words.some((w) => c.includes(w)))).length;
      if (hits >= 2) return i;
    }
    return 0;
  };

  const pickMapping = (header) => {
    const out = {};
    for (const f of IMPORT_FIELDS) {
      let idx = header.findIndex((h) => f.exact?.includes(h) || f.words.some((w) => h.includes(w)));
      if (f.key === 'first_name' && idx < 0) idx = 0;
      if (f.key === 'last_name' && idx < 0) idx = 1;
      out[f.key] = idx;
    }
    // לא לתת לאותו עמודה למלא שני שדות חובה
    if (out.last_name === out.first_name && header.length > 1) out.last_name = out.first_name === 1 ? 0 : 1;
    return out;
  };

  const { el, close } = modal(`
    <h3>${ico('upload')} ייבוא תלמידות — ${esc(data.fileName)}</h3>
    <div class="row" style="gap:12px;margin-bottom:6px">
      <label class="field" style="flex:1;margin-bottom:8px"><span>גיליון</span>
        <select id="sheet-sel">${data.sheets.map((s, i) => `<option value="${i}">${esc(s.name)} (${s.rows.length} שורות)</option>`).join('')}</select>
      </label>
      <label class="field" style="flex:1;margin-bottom:8px"><span>שורת כותרת</span>
        <input type="number" id="header-row" min="0" value="0" />
      </label>
      <label class="row toggle-row small" style="cursor:pointer;margin-top:20px">
        <input type="checkbox" id="skip-dup" checked /> דילוג על תלמידות קיימות
      </label>
    </div>
    <div class="row" style="gap:12px;align-items:flex-start" id="map-row">
      ${IMPORT_FIELDS.map((f) => `
        <label class="field" style="flex:1"><span>${f.label}${f.required ? '' : ' (אופציונלי)'}</span>
          <select data-map="${f.key}"></select>
        </label>`).join('')}
    </div>
    <h4 style="font-size:14px;margin:14px 0 8px">תצוגה מקדימה <span class="faint small">(עד 8 שורות)</span></h4>
    <div class="tbl-wrap"><table class="data" id="preview"></table></div>
    <div class="modal-foot">
      <span class="muted small" id="row-count"></span>
      <div class="spacer"></div>
      <button class="btn primary" id="do-import">${ico('check')} ייבוא</button>
      <button class="btn" data-cancel>ביטול</button>
    </div>`, {
    wide: true,
    onMount(root, close) {
      let header = [];
      let body = [];

      const loadSheet = () => {
        const si = Number($('#sheet-sel', root).value);
        const all = (data.sheets[si]?.rows || []).filter((r) => r.some((c) => String(c).trim() !== ''));
        const hr = Math.min(Number($('#header-row', root).value) || 0, Math.max(0, all.length - 1));
        header = (all[hr] || []).map((c) => String(c).trim());
        body = all.slice(hr + 1);
        const mapping = pickMapping(header);
        const width = Math.max(header.length, ...body.map((r) => r.length), 1);
        $$('[data-map]', root).forEach((sel) => {
          sel.innerHTML = `<option value="-1">— ללא —</option>` +
            Array.from({ length: width }, (_, i) => `<option value="${i}" ${mapping[sel.dataset.map] === i ? 'selected' : ''}>${esc(header[i] || `עמודה ${i + 1}`)}</option>`).join('');
        });
        draw();
      };

      const get = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
      const currentMapping = () => Object.fromEntries($$('[data-map]', root).map((s) => [s.dataset.map, Number(s.value)]));
      const buildRows = () => {
        const m = currentMapping();
        const skipDup = $('#skip-dup', root).checked;
        const seen = new Set();
        const out = [];
        let dup = 0, invalid = 0;
        for (const r of body) {
          const rec = {
            first_name: get(r, m.first_name), last_name: get(r, m.last_name),
            homeroom: get(r, m.homeroom) || null, notes: get(r, m.notes) || null,
          };
          if (!rec.first_name || !rec.last_name) { invalid++; continue; }
          const key = `${n(rec.first_name)}|${n(rec.last_name)}`;
          if (skipDup && (existingKeys.has(key) || seen.has(key))) { dup++; continue; }
          seen.add(key);
          out.push(rec);
        }
        return { out, dup, invalid };
      };

      const draw = () => {
        const { out, dup, invalid } = buildRows();
        $('#row-count', root).textContent =
          `ייובאו ${out.length} · כפולות ${dup} · חסרות שם ${invalid} · סה"כ ${body.length}`;
        const m = currentMapping();
        $('#preview', root).innerHTML = `
          <thead><tr><th>שם פרטי</th><th>שם משפחה</th><th>כיתה</th><th>הערות</th></tr></thead>
          <tbody>${out.slice(0, 8).map((r) => `<tr><td>${esc(r.first_name)}</td><td>${esc(r.last_name)}</td><td>${esc(r.homeroom || '')}</td><td class="muted">${esc(r.notes || '')}</td></tr>`).join('')}</tbody>`;
        const bad = m.first_name < 0 || m.last_name < 0;
        $('#do-import', root).disabled = bad;
      };

      $('#sheet-sel', root).onchange = () => { $('#header-row', root).value = 0; loadSheet(); };
      $('#header-row', root).oninput = loadSheet;
      $$('[data-map]', root).forEach((s) => { s.onchange = draw; });
      $('#skip-dup', root).onchange = draw;
      $('[data-cancel]', root).onclick = close;

      $('#do-import', root).onclick = async () => {
        const { out } = buildRows();
        if (!out.length) return toast('לא נמצאו שורות לייבוא', 'error');
        try {
          const res = await call(window.api.students.importMany(groupId, out));
          toast(`יובאו ${res.inserted} תלמידות${res.skipped ? ` · ${res.skipped} שורות דולגו` : ''}`);
          close(); onDone();
        } catch (e) { fail(e); }
      };

      // איתור אוטומטי של שורת הכותרת בגיליון הראשון
      const autoHeader = detect(data.sheets[0].rows.filter((r) => r.some((c) => String(c).trim() !== '')));
      $('#header-row', root).value = autoHeader;
      loadSheet();
    },
  });
  return el && close;
}

// ================= מערכת שעות =================
async function renderSchedulePage(view) {
  const groupId = state.route.groupId;
  const [group, slots] = await Promise.all([
    call(window.api.groups.get(groupId)),
    call(window.api.schedule.list(groupId)),
  ]);

  const byDay = WEEKDAYS.map((w, i) => ({ day: w, idx: i, slots: slots.filter((s) => s.weekday === i) }));

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">מערכת שעות — ${esc(group.name)}</h1>
        <div class="page-sub">${slots.length} שיעורים שבועיים</div>
      </div>
      <button class="btn primary" id="add-slot">${ico('plus')} שיעור במערכת</button>
    </div>

    ${slots.length ? `<div class="week-grid">
      ${byDay.map((d) => `
        <div class="card day-col ${d.slots.length ? '' : 'empty-day'}">
          <div class="day-head">יום ${d.day}</div>
          ${d.slots.length ? d.slots.map((s) => `
            <div class="slot">
              <div class="slot-time">${esc(s.start_time)}–${esc(s.end_time)}</div>
              <div class="slot-topic">${esc(s.topic || '—')}</div>
              <div class="slot-actions">
                <button class="btn icon sm ghost" data-edit="${s.id}" title="עריכה">${ico('pencil')}</button>
                <button class="btn icon sm ghost" data-del="${s.id}" title="מחיקה">${ico('trash-2')}</button>
              </div>
            </div>`).join('') : `<div class="faint small" style="padding:8px 4px">אין שיעורים</div>`}
        </div>`).join('')}
    </div>
    <div class="card" style="margin-top:22px">
      <div class="card-head"><h2>רשימה מפורטת</h2></div>
      <table class="data">
        <thead><tr><th>יום</th><th>שעה</th><th>נושא</th><th></th></tr></thead>
        <tbody>${slots.map((s) => `
          <tr>
            <td>יום ${WEEKDAYS[s.weekday]}</td>
            <td class="nowrap">${esc(s.start_time)}–${esc(s.end_time)}</td>
            <td class="muted">${esc(s.topic || '')}</td>
            <td class="actions"><button class="btn sm ghost" data-edit="${s.id}" title="עריכה">${ico('pencil')}</button><button class="btn sm ghost" data-del="${s.id}" title="מחיקה">${ico('trash-2')}</button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>` : emptyState('calendar-days', 'אין שיעורים במערכת', 'הוסיפו שיעור שבועי — ממנו ייווצרו השיעורים היומיים אוטומטית',
      `<button class="btn primary" id="add-slot-2">${ico('plus')} שיעור במערכת</button>`)}`;

  $('#back').onclick = () => navigate('group', { groupId });
  const add = () => openSlotEdit(groupId, null, () => render());
  $('#add-slot').onclick = add;
  const add2 = $('#add-slot-2'); if (add2) add2.onclick = add;
  $$('[data-edit]').forEach((b) => { b.onclick = () => openSlotEdit(groupId, slots.find((s) => s.id === Number(b.dataset.edit)), () => render()); });
  $$('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('למחוק את השיעור ממערכת השעות?'))) return;
      try { await call(window.api.schedule.remove(Number(b.dataset.del))); toast('השיעור נמחק מהמערכת'); render(); } catch (e) { fail(e); }
    };
  });
}

function openSlotEdit(groupId, slot, onDone) {
  const s = slot || { weekday: 0, start_time: '', end_time: '', topic: '' };
  modal(`
    <h3>${ico(slot ? 'pencil' : 'plus')} ${slot ? 'עריכת שיעור במערכת' : 'שיעור חדש במערכת'}</h3>
    <form id="slot-form">
      <label class="field"><span>יום</span>
        <select name="weekday">${WEEKDAYS.map((w, i) => `<option value="${i}" ${s.weekday === i ? 'selected' : ''}>יום ${w}</option>`).join('')}</select>
      </label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>שעת התחלה</span><input type="time" name="start_time" value="${esc(s.start_time)}" required /></label>
        <label class="field" style="flex:1"><span>שעת סיום</span><input type="time" name="end_time" value="${esc(s.end_time)}" required /></label>
      </div>
      <label class="field"><span>נושא (אופציונלי)</span><input type="text" name="topic" value="${esc(s.topic || '')}" /></label>
      <div class="modal-foot">
        <button class="btn primary" type="submit">${ico('save')} שמירה</button>
        <button class="btn" type="button" data-cancel>ביטול</button>
      </div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#slot-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await call(window.api.schedule.save({ id: s.id, group_id: groupId, ...f, weekday: Number(f.weekday) }));
          close(); toast('מערכת השעות עודכנה'); onDone();
        } catch (err) { fail(err); }
      };
    },
  });
}

// ================= מבחנים =================
async function renderExamsPage(view) {
  const groupId = state.route.groupId;
  const [group, exams] = await Promise.all([
    call(window.api.groups.get(groupId)),
    call(window.api.exams.list(groupId)),
  ]);

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">מבחנים ודיווחים — ${esc(group.name)}</h1>
        <div class="page-sub">${exams.length} מבחנים</div>
      </div>
      <button class="btn primary" id="add-exam">${ico('plus')} מבחן חדש</button>
    </div>
    ${exams.length ? `<div class="grid">${exams.map((ex) => `
      <div class="card card-pad exam-card">
        <div class="exam-head">
          <div class="exam-ico">${ico('file-text')}</div>
          <div style="flex:1">
            <div class="exam-topic">${esc(ex.topic)}</div>
            <div class="muted small">${fmtDate(ex.date)} · יום ${esc(weekdayOf(ex.date))} · ציון מקסימלי ${ex.max_grade}${ex.file_path ? ` · ${ico('paperclip')} שאלון מצורף` : ''}</div>
          </div>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn sm" data-grades="${ex.id}">${ico('clipboard-check')} ציונים</button>
          <button class="btn sm" data-report="${ex.id}">${ico('chart-column')} דוח מלא</button>
          <button class="btn sm" data-edit="${ex.id}">${ico('pencil')} עריכה</button>
          ${ex.file_path ? `<button class="btn sm" data-attach-open="${ex.id}">${ico('folder-open')} פתיחת שאלון</button>` : ''}
          <div class="spacer"></div>
          <button class="btn sm ghost" data-del="${ex.id}" title="מחיקה">${ico('trash-2')}</button>
        </div>
      </div>`).join('')}</div>`
      : emptyState('file-text', 'אין מבחנים עדיין', 'צרו מבחן, הזינו ציונים והפיקו דוח מלא',
        `<button class="btn primary" id="add-exam-2">${ico('plus')} מבחן חדש</button>`)}`;

  const find = (id) => exams.find((e) => e.id === Number(id));
  $('#back').onclick = () => navigate('group', { groupId });
  const add = () => openExamEdit(groupId, null, () => render());
  $('#add-exam').onclick = add;
  const add2 = $('#add-exam-2'); if (add2) add2.onclick = add;
  $$('[data-grades]').forEach((b) => { b.onclick = () => openGrades(group, find(b.dataset.grades), () => render()); });
  $$('[data-report]').forEach((b) => { b.onclick = () => openFullReport(group, find(b.dataset.report)); });
  $$('[data-edit]').forEach((b) => { b.onclick = () => openExamEdit(groupId, find(b.dataset.edit), () => render()); });
  $$('[data-attach-open]').forEach((b) => {
    b.onclick = async () => {
      try { await call(window.api.openPath(find(b.dataset.attachOpen).file_path)); } catch (e) { fail(e); }
    };
  });
  $$('[data-del]').forEach((b) => {
    b.onclick = async () => {
      if (!(await confirmDialog('למחוק את המבחן וכל הציונים שלו?'))) return;
      try { await call(window.api.exams.remove(Number(b.dataset.del))); toast('המבחן נמחק'); render(); } catch (e) { fail(e); }
    };
  });
}

function openExamEdit(groupId, exam, onDone) {
  const ex = exam || { date: today(), topic: '', max_grade: 100 };
  modal(`
    <h3>${ico(exam ? 'pencil' : 'plus')} ${exam ? 'עריכת מבחן' : 'מבחן חדש'}</h3>
    <form id="ex-form">
      <label class="field"><span>נושא</span><input type="text" name="topic" value="${esc(ex.topic)}" required autofocus /></label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>תאריך</span><input type="date" name="date" value="${esc(ex.date)}" required /></label>
        <label class="field" style="flex:1"><span>ציון מקסימלי</span><input type="number" name="max_grade" value="${esc(ex.max_grade ?? 100)}" min="1" /></label>
      </div>
      <div class="modal-foot">
        <button class="btn primary" type="submit">${ico('save')} שמירה</button>
        <button class="btn" type="button" data-cancel>ביטול</button>
      </div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#ex-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await call(window.api.exams.save({ id: ex.id, group_id: groupId, ...f, max_grade: Number(f.max_grade) || 100, file_path: ex.file_path ?? null }));
          close(); toast('המבחן נשמר'); onDone();
        } catch (err) { fail(err); }
      };
    },
  });
}

async function openGrades(group, exam, onDone) {
  const [students, grades] = await Promise.all([
    call(window.api.students.list(group.id, false)),
    call(window.api.exams.grades(exam.id)),
  ]);
  const gOf = (sid) => grades.find((g) => g.student_id === sid) || { submitted: 0, grade: null };

  modal(`
    <h3>${ico('clipboard-check')} ציונים — ${esc(exam.topic)}</h3>
    <div class="small muted" style="margin-bottom:12px">${fmtDate(exam.date)} · ציון מקסימלי ${exam.max_grade} · ${students.length} תלמידות</div>
    <div class="tbl-wrap"><table class="data">
      <thead><tr><th>תלמידה</th><th>כיתה</th><th class="center">הגישה</th><th>ציון</th></tr></thead>
      <tbody>${students.map((s) => {
        const g = gOf(s.id);
        return `<tr data-g="${s.id}">
          <td>${esc(s.first_name)} ${esc(s.last_name)}</td>
          <td class="muted">${esc(s.homeroom || '')}</td>
          <td class="center"><button class="check neutral ${g.submitted ? 'on' : ''}" data-sub title="הגישה">${ico('check')}</button></td>
          <td><input type="number" class="grade-input" value="${g.grade ?? ''}" min="0" max="${exam.max_grade}" step="0.5" style="max-width:110px" /></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="modal-foot">
      <button class="btn primary" id="save-grades">${ico('save')} שמירת הציונים</button>
      <button class="btn" id="attach">${ico('paperclip')} ${exam.file_path ? 'החלפת שאלון' : 'צירוף שאלון'}</button>
      <div class="spacer"></div>
      <button class="btn" data-close>סגירה</button>
    </div>`, {
    wide: true,
    onMount(root, close) {
      $('[data-close]', root).onclick = () => { close(); onDone(); };
      $$('[data-sub]', root).forEach((b) => { b.onclick = () => b.classList.toggle('on'); });
      $('#save-grades', root).onclick = async () => {
        try {
          for (const tr of $$('[data-g]', root)) {
            const sid = Number(tr.dataset.g);
            const submitted = $('[data-sub]', tr).classList.contains('on');
            const grade = $('.grade-input', tr).value;
            if (grade !== '' && (Number(grade) < 0 || Number(grade) > Number(exam.max_grade))) {
              return toast(`ציון מחוץ לטווח בשורה של ${sid}`, 'error');
            }
            await call(window.api.exams.setGrade(exam.id, sid, submitted, grade));
          }
          toast('הציונים נשמרו');
          close(); onDone();
        } catch (e) { fail(e); }
      };
      $('#attach', root).onclick = async () => {
        try {
          const p = await call(window.api.attachExamFile(exam.id));
          if (p) {
            await call(window.api.exams.save({ id: exam.id, date: exam.date, topic: exam.topic, max_grade: exam.max_grade, file_path: p }));
            exam.file_path = p;
            toast('השאלון צורף');
            $('#attach', root).innerHTML = `${ico('paperclip')} החלפת שאלון`;
          }
        } catch (e) { fail(e); }
      };
    },
  });
}

// דוח מלא למבחן: ציון + הערכה + משמעת + נוכחות
async function openFullReport(group, exam) {
  const [students, grades, summary] = await Promise.all([
    call(window.api.students.list(group.id, false)),
    call(window.api.exams.grades(exam.id)),
    call(window.api.attendance.summary(group.id, null, null)),
  ]);
  const gOf = (sid) => grades.find((g) => g.student_id === sid);
  const sOf = (sid) => summary.find((s) => s.student_id === sid);

  const rows = students.map((s) => {
    const g = gOf(s.id);
    const sum = sOf(s.id) || {};
    const total = (sum.present || 0) + (sum.absent || 0) + (sum.late || 0) + (sum.released || 0);
    return [
      `${s.first_name} ${s.last_name}`, s.homeroom || '',
      g && g.grade != null ? g.grade : (g && g.submitted ? 'הוגש' : 'לא הוגש'),
      s.notes || '', sum.discipline || 0,
      `${sum.present || 0}`, `${sum.absent || 0}`, `${sum.late || 0}`, `${sum.released || 0}`,
      pctText((sum.present || 0) + (sum.late || 0) + (sum.released || 0), total),
    ];
  });
  const table = [['שם', 'כיתה', 'ציון', 'הערכה והערות', 'הפרות משמעת', 'נוכחות', 'חסרות', 'איחורים', 'שחרור', 'אחוז נוכחות'], ...rows];

  modal(`
    <h3>${ico('chart-column')} דוח מלא — ${esc(exam.topic)} · ${esc(group.name)}</h3>
    <div class="tbl-wrap"><table class="data">
      <thead><tr>${table[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="modal-foot">
      <button class="btn" id="fr-print">${ico('printer')} הדפסה</button>
      <button class="btn" id="fr-excel">${ico('file-spreadsheet')} ייצוא Excel</button>
      <div class="spacer"></div>
      <button class="btn" data-close>סגירה</button>
    </div>`, {
    wide: true,
    onMount(root, close) {
      $('[data-close]', root).onclick = close;
      $('#fr-print', root).onclick = () => printTable(`דוח מלא — ${exam.topic}`, `${group.name} · ${fmtDate(exam.date)}`, table);
      $('#fr-excel', root).onclick = () => exportExcel(table, `דוח-${exam.topic}-${group.name}`, 'דוח מלא');
    },
  });
}

// ================= דוחות חיסורים =================
async function renderReportsPage(view) {
  const groupId = state.route.groupId;
  const group = await call(window.api.groups.get(groupId));

  const range = state.reportRange || { mode: 'today' };
  let from = null, to = null;
  if (range.mode === 'today') { from = to = range.date || today(); }
  else if (range.mode === 'range') { from = range.from || null; to = range.to || null; }
  // mode 'year' → ללא סינון תאריכים

  const [rows, summary] = await Promise.all([
    call(window.api.attendance.report(groupId, from, to)),
    call(window.api.attendance.summary(groupId, from, to)),
  ]);

  const counts = {
    absent: rows.filter((r) => r.status === 'absent').length,
    late: rows.filter((r) => r.status === 'late').length,
    released: rows.filter((r) => r.status === 'released').length,
  };

  view.innerHTML = `
    <div class="page-head">
      <div>
        <button class="btn ghost sm" id="back">${ico('arrow-right')} חזרה לקבוצה</button>
        <h1 class="page-title" style="margin-top:6px">דוחות חיסורים — ${esc(group.name)}</h1>
      </div>
      <div class="row">
        <button class="btn" id="parents">${ico('users')} תצוגה להורים</button>
        <button class="btn" id="print">${ico('printer')} הדפסה</button>
        <button class="btn" id="excel">${ico('file-spreadsheet')} Excel</button>
      </div>
    </div>

    <div class="card card-pad" style="margin-bottom:18px">
      <div class="row" style="gap:14px;align-items:flex-end">
        <div class="seg">
          <button data-mode="today" class="${range.mode === 'today' ? 'on' : ''}" data-status="present">שיעור בודד</button>
          <button data-mode="range" class="${range.mode === 'range' ? 'on' : ''}" data-status="present">טווח תאריכים</button>
          <button data-mode="year" class="${range.mode === 'year' ? 'on' : ''}" data-status="present">כל השנה</button>
        </div>
        ${range.mode === 'today' ? `<label class="field" style="margin:0;min-width:170px"><span>תאריך</span><input type="date" id="r-date" value="${range.date || today()}" /></label>` : ''}
        ${range.mode === 'range' ? `
          <label class="field" style="margin:0;min-width:170px"><span>מתאריך</span><input type="date" id="r-from" value="${range.from || ''}" /></label>
          <label class="field" style="margin:0;min-width:170px"><span>עד תאריך</span><input type="date" id="r-to" value="${range.to || ''}" /></label>` : ''}
      </div>
    </div>

    <div class="stats-row" style="margin-bottom:18px">
      <div class="card stat"><div class="v" style="color:var(--absent)">${counts.absent}</div><div class="l">${ico('x')} חסרות</div></div>
      <div class="card stat"><div class="v" style="color:var(--late)">${counts.late}</div><div class="l">${ico('clock')} איחורים</div></div>
      <div class="card stat"><div class="v" style="color:var(--released)">${counts.released}</div><div class="l">${ico('log-out')} שחרורים</div></div>
      <div class="card stat"><div class="v">${summary.length}</div><div class="l">${ico('users')} תלמידות שסומנו</div></div>
    </div>

    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><h2>סיכום אחוזי נוכחות לתלמידה</h2></div>
      <table class="data">
        <thead><tr><th>תלמידה</th><th class="center">נוכחות</th><th class="center">חסרות</th><th class="center">איחורים</th><th class="center">שחרור</th><th class="center">משמעת</th><th class="center">אחוז</th></tr></thead>
        <tbody>${summary.map((s) => {
          const total = s.present + s.absent + s.late + s.released;
          const effective = s.present + s.late + s.released; // איחור ושחרור נחשבות נוכחות חלקית
          const p = pct(effective, total);
          return `<tr>
            <td>${esc(s.first_name)} ${esc(s.last_name)} <span class="faint small">${esc(s.homeroom || '')}</span></td>
            <td class="center">${s.present}</td><td class="center">${s.absent}</td>
            <td class="center">${s.late}</td><td class="center">${s.released}</td>
            <td class="center">${s.discipline ? `<span class="pill discipline">${s.discipline}</span>` : '—'}</td>
            <td class="center"><span class="pct-bar"><span style="width:${p ?? 0}%" class="${(p ?? 0) >= 85 ? 'good' : (p ?? 0) >= 70 ? 'mid' : 'bad'}"></span></span><b>${pctText(effective, total)}</b></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      ${!summary.length ? `<div class="empty">אין נתוני נוכחות בתקופה זו</div>` : ''}
    </div>

    <div class="card">
      <div class="card-head"><h2>פירוט חיסורים</h2></div>
      <table class="data">
        <thead><tr><th>תלמידה</th><th>מצב</th><th>תאריך</th><th>שעה</th><th>נושא</th></tr></thead>
        <tbody>${rows.map((r) => `
          <tr><td>${esc(r.first_name)} ${esc(r.last_name)}</td>
            <td><span class="pill ${r.status}">${STATUS_LABEL[r.status]}</span></td>
            <td class="nowrap">${fmtDate(r.date)}</td><td class="muted">${esc(r.start_time || '')}</td><td class="muted">${esc(r.topic || '')}</td></tr>`).join('')}</tbody>
      </table>
      ${!rows.length ? `<div class="empty">${ico('check', 'xl')}<div class="e-title">אין חיסורים בתקופה זו</div></div>` : ''}
    </div>`;

  const setRange = (next) => { state.reportRange = next; render(); };
  $('#back').onclick = () => navigate('group', { groupId });
  $$('[data-mode]').forEach((b) => { b.onclick = () => setRange({ ...range, mode: b.dataset.mode }); });
  const rd = $('#r-date'); if (rd) rd.onchange = () => setRange({ mode: 'today', date: rd.value });
  const rf = $('#r-from'); if (rf) rf.onchange = () => setRange({ ...range, from: rf.value });
  const rt = $('#r-to'); if (rt) rt.onchange = () => setRange({ ...range, to: rt.value });

  const periodLabel = range.mode === 'today' ? `שיעור ${fmtDate(from)}` : range.mode === 'range' ? `${fmtDate(from) || 'התחלה'}–${fmtDate(to) || 'היום'}` : 'כל השנה';
  const buildSummary = () => {
    const out = [['שם פרטי', 'שם משפחה', 'כיתה', 'נוכחות', 'חסרות', 'איחורים', 'שחרור', 'הפרות משמעת', 'אחוז נוכחות']];
    summary.forEach((s) => {
      const total = s.present + s.absent + s.late + s.released;
      out.push([s.first_name, s.last_name, s.homeroom || '', s.present, s.absent, s.late, s.released, s.discipline, pctText(s.present + s.late + s.released, total)]);
    });
    return out;
  };
  const buildDetail = () => {
    const out = [['שם פרטי', 'שם משפחה', 'כיתה', 'מצב', 'תאריך', 'שעה', 'נושא']];
    rows.forEach((r) => out.push([r.first_name, r.last_name, r.homeroom || '', STATUS_LABEL[r.status], fmtDate(r.date), r.start_time || '', r.topic || '']));
    return out;
  };

  $('#excel').onclick = () => exportExcel([
    [`סיכום אחוזי נוכחות — ${group.name} · ${periodLabel}`],
    ...buildSummary(), [''], ['פירוט חיסורים'], ...buildDetail(),
  ], `דוח-חיסורים-${group.name}`, 'דוח חיסורים');

  $('#print').onclick = () => {
    const html = printBlock(`דוח חיסורים — ${group.name}`, periodLabel,
      `<h3>סיכום אחוזי נוכחות</h3>${tableHTML(buildSummary())}
       <h3 style="margin-top:24px">פירוט חיסורים</h3>${rows.length ? tableHTML(buildDetail()) : '<p>אין חיסורים בתקופה זו.</p>'}`);
    doPrint(html);
  };
  $('#parents').onclick = () => openParentsView(group, summary, rows, periodLabel);
}

// תצוגה להורים: אחוז נוכחות + הערות + משמעת
function openParentsView(group, summary, rows, periodLabel) {
  modal(`
    <h3>${ico('users')} תצוגה להורים — ${esc(group.name)}</h3>
    <p class="muted small">${esc(periodLabel)}. בחרו תלמידה כדי להציג את הדו"ח שלה.</p>
    <div class="grid" style="gap:8px;max-height:52vh;overflow:auto">
      ${summary.length ? summary.map((s) => {
        const total = s.present + s.absent + s.late + s.released;
        return `<button class="counter-chip parent-row" data-p="${s.student_id}">
          <span style="text-align:right"><b>${esc(s.first_name)} ${esc(s.last_name)}</b> <span class="faint small">${esc(s.homeroom || '')}</span></span>
          <span class="small">נוכחות: <b>${pctText(s.present + s.late + s.released, total)}</b> · חסרות ${s.absent} · איחורים ${s.late}${s.discipline ? ` · משמעת ${s.discipline}` : ''}</span>
        </button>`;
      }).join('') : '<div class="muted">אין נתונים בתקופה זו</div>'}
    </div>
    <div class="modal-foot"><button class="btn" data-close>סגירה</button></div>`, {
    wide: true,
    onMount(root, close) {
      $('[data-close]', root).onclick = close;
      $$('[data-p]', root).forEach((b) => {
        b.onclick = async () => {
          try {
            const sid = Number(b.dataset.p);
            const [st, summ] = await Promise.all([call(window.api.students.get(sid)), Promise.resolve(summary.find((x) => x.student_id === sid))]);
            const mine = rows.filter((r) => r.student_id === sid);
            const total = summ.present + summ.absent + summ.late + summ.released;
            const tbl = [
              ['אחוז נוכחות', pctText(summ.present + summ.late + summ.released, total)],
              ['נוכחות', summ.present], ['חסרות', summ.absent], ['איחורים', summ.late], ['שחרור', summ.released],
              ['הפרות משמעת', summ.discipline],
            ];
            const detail = [['תאריך', 'מצב', 'שעה', 'נושא'], ...mine.map((r) => [fmtDate(r.date), STATUS_LABEL[r.status], r.start_time || '', r.topic || ''])];
            const body = printBlock(`דו"ח נוכחות — ${st.first_name} ${st.last_name}`,
              `${group.name} · ${periodLabel}${st.homeroom ? ' · כיתה ' + st.homeroom : ''}`,
              [tableHTML(tbl), st.notes ? `<p style="margin:14px 0"><b>הערכה:</b> ${esc(st.notes)}</p>` : '', mine.length ? tableHTML(detail) : '<p class="muted">אין חיסורים בתקופה זו.</p>'].join(''));
            const title = esc(st.first_name) + ' ' + esc(st.last_name);
            modal(`<div class="row" style="margin-bottom:12px"><h3 style="margin:0">${title}</h3><div class="spacer"></div><button class="btn sm" id="pp">${ico('printer')} הדפסה</button></div>${body}<div class="modal-foot"><button class="btn" data-close>סגירה</button></div>`, {
              wide: true,
              onMount(r2, c2) {
                $('[data-close]', r2).onclick = c2;
                $('#pp', r2).onclick = () => doPrint(body);
              },
            });
          } catch (e) { fail(e); }
        };
      });
    },
  });
}

// ================= ניהול =================
async function renderAdmin(view) {
  const [seminars, books] = await Promise.all([call(window.api.seminars.list()), call(window.api.books.list())]);
  await loadGroups();
  renderStatus();

  const totalStudents = state.groups.reduce((n, g) => n + (g.student_count || 0), 0);

  const groupRow = (g) => `
    <li class="glist-item">
      <div class="glist-main" data-open-group="${g.id}">
        <div class="avatar sm">${esc(g.name.slice(0, 2)) || 'ק'}</div>
        <div class="glist-text">
          <b>${esc(g.name)}</b>
          <div class="faint small">${[g.grade, g.track, g.teacher].filter(Boolean).map(esc).join(' · ') || 'ללא פרטים נוספים'}</div>
        </div>
        <span class="glist-count">${ico('users')} ${g.student_count}</span>
      </div>
      <div class="glist-actions">
        <button class="btn sm ghost" data-open-group="${g.id}" title="פתיחת הקבוצה">${ico('arrow-left')}</button>
        <button class="btn sm ghost" data-eval="${g.id}" data-kind="group" title="עריכה">${ico('pencil')}</button>
        <button class="btn sm ghost danger-ghost" data-rdel="${g.id}" data-kind="group" title="מחיקה">${ico('trash-2')}</button>
      </div>
    </li>`;

  const seminarCard = (s) => {
    const own = state.groups.filter((g) => g.seminar_id === s.id);
    return `
    <section class="card seminar-card">
      <div class="card-head seminar-head">
        <div class="sem-ico">${ico('school')}</div>
        <div>
          <h2>${esc(s.name)}</h2>
          <div class="faint small">${esc(s.coordinator || 'ללא מרכזת')}${s.coordinator_phone ? ' · ' + esc(s.coordinator_phone) : ''} · ${own.length} קבוצות</div>
        </div>
        <div class="spacer"></div>
        <button class="btn sm" data-add-group="${s.id}">${ico('plus')} קבוצה</button>
        <button class="btn sm ghost" data-eval="${s.id}" data-kind="seminar" title="עריכת סמינר">${ico('pencil')}</button>
        <button class="btn sm ghost danger-ghost" data-rdel="${s.id}" data-kind="seminar" title="מחיקת סמינר">${ico('trash-2')}</button>
      </div>
      ${own.length ? `<ul class="glist">${own.map(groupRow).join('')}</ul>` : `<div class="empty small-empty">${ico('users')} אין קבוצות בסמינר הזה עדיין</div>`}
    </section>`;
  };

  view.innerHTML = `
    <div class="page-head">
      <div>
        <h1 class="page-title">ניהול</h1>
        <div class="page-sub">${seminars.length} סמינרים · ${state.groups.length} קבוצות · ${totalStudents} תלמידות</div>
      </div>
      <div class="row">
        <button class="btn" data-new="seminar">${ico('school')} סמינר חדש</button>
        <button class="btn primary" data-new="group">${ico('plus')} קבוצה חדשה</button>
      </div>
    </div>

    <div class="admin-layout">
      <div class="admin-col">
        <h2 class="section-title">${ico('layers')} סמינרים וקבוצות</h2>
        ${seminars.length ? seminars.map(seminarCard).join('')
          : emptyState('school', 'אין סמינרים עדיין', 'סמינר הוא המסגרת העליונה; בתוכו יוצרים קבוצות ובתוכן תלמידות.',
            `<button class="btn primary" data-new="seminar">${ico('plus')} יצירת סמינר ראשון</button>`)}
      </div>

      <div class="admin-col">
        <h2 class="section-title">${ico('book-open')} ספרים</h2>
        <section class="card card-pad">
          <div class="row" style="justify-content:flex-end;margin-bottom:10px">
            <button class="btn sm" data-new="book">${ico('plus')} ספר</button>
          </div>
          ${books.length ? `<ul class="glist">${books.map((b) => `
            <li class="glist-item">
              <div class="glist-main">
                <div class="avatar sm book">${ico('book-open')}</div>
                <div class="glist-text"><b>${esc(b.title)}</b>
                  <div class="faint small">${[b.author, b.price ? Number(b.price).toFixed(0) + ' ₪' : ''].filter(Boolean).map(esc).join(' · ') || 'ללא מחבר/מחיר'}</div>
                </div>
              </div>
              <div class="glist-actions">
                <button class="btn sm ghost" data-eval="${b.id}" data-kind="book" title="עריכה">${ico('pencil')}</button>
                <button class="btn sm ghost danger-ghost" data-rdel="${b.id}" data-kind="book" title="מחיקה">${ico('trash-2')}</button>
              </div>
            </li>`).join('')}</ul>` : `<div class="empty small-empty">${ico('book-open')} אין ספרים עדיין</div>`}
        </section>

        <h2 class="section-title">${ico('shield-check')} מערכת ואבטחה</h2>
        <section class="card card-pad admin-actions">
          <button class="admin-action" id="backup"><span class="aa-ico">${ico('database')}</span>
            <span class="aa-text"><b>גיבוי לקובץ</b><span class="small muted">שמירת עותק של כל הנתונים</span></span>${ico('chevron-left', 'aa-arrow')}</button>
          <button class="admin-action" id="open-data"><span class="aa-ico">${ico('folder-open')}</span>
            <span class="aa-text"><b>תיקיית הנתונים</b><span class="small muted">פתיחת התיקייה שבה נשמרים הקבצים</span></span>${ico('chevron-left', 'aa-arrow')}</button>
          <button class="admin-action" id="security"><span class="aa-ico">${ico('lock')}</span>
            <span class="aa-text"><b>שינוי סיסמה</b><span class="small muted">סיסמה ושאלת אבטחה</span></span>${ico('chevron-left', 'aa-arrow')}</button>
          <button class="admin-action" id="logout"><span class="aa-ico">${ico('log-out')}</span>
            <span class="aa-text"><b>התנתקות</b><span class="small muted">נעילת המערכת עד להזנת הסיסמה</span></span>${ico('chevron-left', 'aa-arrow')}</button>
        </section>
      </div>
    </div>`;

  $$('[data-add-group]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.addGroup);
      openEntityEdit('group', { seminar_id: id }, seminars, books);
    };
  });
  $$('[data-new]').forEach((b) => { b.onclick = () => openEntityEdit(b.dataset.new, null, seminars, books); });
  $$('[data-open-group]').forEach((b) => { b.onclick = () => navigate('group', { groupId: Number(b.dataset.openGroup) }); });
  $$('[data-eval]').forEach((b) => {
    const kind = b.dataset.kind, id = Number(b.dataset.eval);
    const item = kind === 'seminar' ? seminars.find((x) => x.id === id)
      : kind === 'book' ? books.find((x) => x.id === id)
      : state.groups.find((x) => x.id === id);
    b.onclick = (e) => { e.stopPropagation(); openEntityEdit(kind, item, seminars, books); };
  });
  $$('[data-rdel]').forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const kind = b.dataset.kind, id = Number(b.dataset.rdel);
      const msg = kind === 'group' ? 'מחיקת קבוצה תמחק את כל התלמידות, השיעורים והנוכחות שלה. להמשיך?'
        : kind === 'seminar' ? 'מחיקת סמינר תמחק את כל הקבוצות שבו. להמשיך?' : 'למחוק את הספר?';
      if (!(await confirmDialog(msg))) return;
      try {
        const api = kind === 'seminar' ? window.api.seminars : kind === 'book' ? window.api.books : window.api.groups;
        await call(api.remove(id));
        toast('נמחק');
        render();
      } catch (err) { fail(err); }
    };
  });
  $('#backup').onclick = () => doBackup();
  $('#open-data').onclick = () => openDataDir();
  $('#security').onclick = () => openSecurity();
  $('#logout').onclick = () => logout();
}

function openEntityEdit(kind, item, seminars, books) {
  const isNew = !item;
  const titles = { seminar: 'סמינר', book: 'ספר', group: 'קבוצה' };
  let fields = '';
  if (kind === 'seminar') {
    fields = `
      <label class="field"><span>שם סמינר</span><input name="name" value="${esc(item?.name || '')}" required autofocus /></label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>מרכזת</span><input name="coordinator" value="${esc(item?.coordinator || '')}" /></label>
        <label class="field" style="flex:1"><span>טלפון</span><input name="coordinator_phone" value="${esc(item?.coordinator_phone || '')}" /></label>
      </div>`;
  } else if (kind === 'book') {
    fields = `
      <label class="field"><span>שם ספר</span><input name="title" value="${esc(item?.title || '')}" required autofocus /></label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:2"><span>מחבר / הוצאה</span><input name="author" value="${esc(item?.author || '')}" /></label>
        <label class="field" style="flex:1"><span>מחיר (₪)</span><input type="number" name="price" value="${item?.price ?? ''}" min="0" /></label>
      </div>`;
  } else {
    if (!seminars.length) { toast('יש ליצור סמינר לפני יצירת קבוצה', 'error'); return; }
    fields = `
      <label class="field"><span>שם קבוצה</span><input name="name" value="${esc(item?.name || '')}" required autofocus placeholder="לדוגמה: י'2 — תקשוב" /></label>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>סמינר</span><select name="seminar_id">${seminars.map((s) => `<option value="${s.id}" ${item?.seminar_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span>שכבה</span><input name="grade" value="${esc(item?.grade || '')}" placeholder="לדוגמה: י'" /></label>
      </div>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1"><span>מגמה</span><input name="track" value="${esc(item?.track || '')}" /></label>
        <label class="field" style="flex:1"><span>מורה</span><input name="teacher" value="${esc(item?.teacher || '')}" /></label>
      </div>
      <label class="field"><span>ספר לימוד</span><select name="book_id"><option value="">— ללא —</option>${books.map((b) => `<option value="${b.id}" ${item?.book_id === b.id ? 'selected' : ''}>${esc(b.title)}${b.price ? ` (${Number(b.price).toFixed(0)} ₪)` : ''}</option>`).join('')}</select></label>`;
  }

  modal(`
    <h3>${ico(isNew ? 'plus' : 'pencil')} ${isNew ? 'הוספת' : 'עריכת'} ${titles[kind]}</h3>
    <form id="ent-form">${fields}
      <div class="modal-foot"><button class="btn primary" type="submit">${ico('save')} שמירה</button><button class="btn" type="button" data-cancel>ביטול</button></div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#ent-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        if (f.seminar_id) f.seminar_id = Number(f.seminar_id);
        if (f.book_id !== undefined) f.book_id = f.book_id ? Number(f.book_id) : null;
        if (f.price !== undefined) f.price = Number(f.price) || 0;
        try {
          const api = kind === 'seminar' ? window.api.seminars : kind === 'book' ? window.api.books : window.api.groups;
          await call(api.save({ id: item?.id, ...f }));
          close(); toast('נשמר'); render();
        } catch (err) { fail(err); }
      };
    },
  });
}

function openSecurity() {
  modal(`
    <h3>${ico('lock')} שינוי סיסמה</h3>
    <form id="sec-form" autocomplete="off">
      <label class="field"><span>סיסמה נוכחית</span><input type="password" name="currentPassword" required /></label>
      <label class="field"><span>סיסמה חדשה</span><input type="password" name="newPassword" required minlength="4" /></label>
      <label class="field"><span>שאלת אבטחה</span><input type="text" name="question" value="${esc(state.auth?.question || '')}" /></label>
      <label class="field"><span>תשובת אבטחה חדשה (אופציונלי)</span><input type="text" name="answer" /></label>
      <div class="modal-foot"><button class="btn primary" type="submit">${ico('save')} עדכון</button><button class="btn" type="button" data-cancel>ביטול</button></div>
    </form>`, {
    onMount(root, close) {
      $('[data-cancel]', root).onclick = close;
      $('#sec-form', root).onsubmit = async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try {
          await call(window.api.auth.update(f));
          state.auth.question = f.question;
          close(); toast('הפרטים עודכנו');
        } catch (err) { fail(err); }
      };
    },
  });
}

// ================= חיפוש מהיר =================
async function openSearch() {
  const { el, close } = modal(`
    <h3>${ico('search')} חיפוש תלמידה</h3>
    <div class="input-wrap">${ico('search')}<input type="text" id="q" placeholder="שם פרטי, שם משפחה או כיתה…" autofocus /></div>
    <div class="grid" style="gap:6px;margin-top:14px;max-height:50vh;overflow:auto" id="results"></div>
    <div class="modal-foot"><button class="btn" data-close>סגירה</button></div>`, {
    onMount(root, close) {
      const input = $('#q', root);
      const box = $('#results', root);
      let items = [];
      $('[data-close]', root).onclick = close;

      const search = async () => {
        const q = input.value.trim();
        box.innerHTML = `<div class="muted small">${q ? 'מחפש…' : 'הקלידו לחיפוש'}</div>`;
        if (!q) return;
        items = [];
        for (const g of state.groups) {
          const list = await call(window.api.students.list(g.id, true));
          list.filter((s) => `${s.first_name} ${s.last_name} ${s.homeroom || ''}`.includes(q))
            .forEach((s) => items.push({ ...s, group_name: g.name }));
        }
        box.innerHTML = items.length ? items.slice(0, 40).map((s, i) => `
          <button class="counter-chip parent-row" data-hit="${i}">
            <span style="text-align:right"><b>${esc(s.first_name)} ${esc(s.last_name)}</b> <span class="faint small">${esc(s.homeroom || '')}</span></span>
            <span class="small muted">${esc(s.group_name)}${s.active ? '' : ' · לא פעילה'}</span>
          </button>`).join('') : `<div class="muted small">לא נמצאו תוצאות</div>`;
        $$('[data-hit]', root).forEach((b) => {
          b.onclick = () => {
            const s = items[Number(b.dataset.hit)];
            close();
            state.studentQuery = '';
            navigate('students', { groupId: s.group_id });
          };
        });
      };
      let t;
      input.oninput = () => { clearTimeout(t); t = setTimeout(search, 220); };
      input.focus();
    },
  });
  return el;
}

// ================= פעולות תפריט / סרגל =================
async function doBackup() {
  try { const p = await call(window.api.backup()); if (p) toast('הגיבוי נשמר: ' + p); } catch (e) { fail(e); }
}

async function openDataDir() {
  try {
    const dir = state.info?.dataDir;
    if (!dir) return toast('מיקום הנתונים אינו ידוע', 'error');
    await call(window.api.openPath(dir));
  } catch (e) { fail(e); }
}

function logout() {
  state.groups = [];
  renderAuth();
}

async function menuImport() {
  const g = currentGroup();
  if (g) return openImportWizard(g.id, [], () => render());
  navigate('students');
}

async function menuAddStudent() {
  const g = currentGroup();
  if (g) return openStudentEdit(g.id, null, () => render());
  navigate('students');
}

function menuAddGroup() {
  if (!state.groups.length) return navigate('admin');
  openEntityEdit('group', null, [], []);
}

async function menuExportCurrent() {
  const g = currentGroup();
  if (!g) return navigate('dashboard');
  if (state.route.name === 'payments') return navigate('payments', { groupId: g.id });
  if (state.route.name === 'reports') return navigate('reports', { groupId: g.id });
  navigate('students', { groupId: g.id });
}

function openHelp() {
  modal(`
    <h3>${ico('clipboard-list')} מדריך שימוש מהיר</h3>
    <div class="help-list">
      <div><b>1. הגדרה ראשונית</b><div class="muted small">בהופעה הראשונה בוחרים סיסמה ושאלת אבטחה. הסיסמה אינה נשמרת כטקסט — רק טביעת אצבע מוצפנת.</div></div>
      <div><b>2. בניית המבנה</b><div class="muted small">במסך "ניהול" יוצרים סמינר, ספר (אופציונלי) וקבוצה. הקבוצה משויכת לסמינר.</div></div>
      <div><b>3. תלמידות</b><div class="muted small">במסך "תלמידות" מוסיפים ידנית או מייבאים מקובץ Excel. ניתן לבחור גיליון, שורת כותרת ומיפוי עמודות.</div></div>
      <div><b>4. מערכת שעות</b><div class="muted small">שיעורים שבועיים קבועים. מהם נוצרים אוטומטית שיעורי היום.</div></div>
      <div><b>5. סימון נוכחות</b><div class="muted small">במסך הבית מופיע "עכשיו בשיעור". לחיצה אחת על נוכחת/חסרה/איחור/שחרור. כפתור המשמעת מוסיף הערה.</div></div>
      <div><b>6. דוחות</b><div class="muted small">דוח חיסורים לפי שיעור, טווח או שנה — להדפסה, ל-Excel ולתצוגה להורים.</div></div>
      <div><b>7. גיבוי</b><div class="muted small">קובץ "קובץ ← גיבוי" שומר עותק מלא של המסד ליעד שתבחרו.</div></div>
    </div>
    <div class="modal-foot"><button class="btn primary" data-close>הבנתי</button></div>`, {
    onMount(root, close) { $('[data-close]', root).onclick = close; },
  });
}

function openAbout() {
  modal(`
    <h3>${ico('info')} אודות התוכנה</h3>
    <div class="about">
      <div class="brand-logo lg">נ</div>
      <div>
        <div class="brand-title" style="font-size:20px">נוכחות</div>
        <div class="muted small">ניהול כיתות וסימון נוכחות — עובד גם ללא חיבור לאינטרנט</div>
      </div>
    </div>
    <table class="data" style="margin-top:14px">
      <tbody>
        <tr><td class="muted">גרסה</td><td>${esc(state.info?.version || '—')}</td></tr>
        <tr><td class="muted">תיקיית נתונים</td><td class="small" dir="ltr" style="text-align:right">${esc(state.info?.dataDir || '—')}</td></tr>
        <tr><td class="muted">מסד נתונים</td><td>SQLite מוטמע</td></tr>
        <tr><td class="muted">אייקונים</td><td>Lucide — רישיון ISC</td></tr>
      </tbody>
    </table>
    <div class="modal-foot"><button class="btn primary" data-close>סגירה</button></div>`, {
    onMount(root, close) { $('[data-close]', root).onclick = close; },
  });
}

// ================= הדפסה וייצוא =================
function tableHTML(rows) {
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function printBlock(title, subtitle, bodyHtml) {
  return `<div class="report-head">
    <h2>${esc(title)}</h2><div class="report-sub">${esc(subtitle)}</div></div>${bodyHtml}`;
}

// הדפסה דרך אזור ההדפסה הייעודי (הממשק מוסתר ב-print)
function doPrint(html) {
  const area = $('#print-area');
  area.className = 'pretty';
  area.innerHTML = html;
  window.print();
  area.innerHTML = '';
  area.className = '';
}

function printTable(title, subtitle, rows) {
  doPrint(printBlock(title, subtitle, tableHTML(rows)));
}

async function exportExcel(rows, defaultName, sheetName) {
  try {
    const p = await call(window.api.excel.export({ rows, defaultName: defaultName + '.xlsx', sheetName }));
    if (p) toast('הקובץ נשמר: ' + p);
  } catch (e) { fail(e); }
}

// ================= אתחול =================
applyTheme();
(async function boot() {
  try {
    const status = await call(window.api.auth.status());
    if (!status.configured) return renderSetup();
    renderAuth();
  } catch (e) {
    fail(e);
    $('#app').innerHTML = `<div class="empty">שגיאה בטעינת המערכת</div>`;
  }
})();
