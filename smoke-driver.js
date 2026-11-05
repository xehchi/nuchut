// מנוע בדיקת עשן — טוען את main.js האמיתי ומריץ תרחיש דרך ה-API הפנימי
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

module.exports = (getWindow) => {
  const errors = [];
  const log = [];
  app.whenReady().then(async () => {
    const win = getWindow();
    const wc = win.webContents;
    wc.on('console-message', (e) => {
      const msg = typeof e === 'object' && e.message !== undefined ? `[${e.level}] ${e.message}` : String(e);
      if (/\[(error|warning)\]/i.test(msg)) errors.push(msg);
    });

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const shots = path.join(__dirname, 'smoke-shots');
    fs.mkdirSync(shots, { recursive: true });
    const shot = async (name) => {
      try {
        const img = await wc.capturePage();
        if (!img.isEmpty()) fs.writeFileSync(path.join(shots, name + '.png'), img.toPNG());
        else log.push(name + ': צילום ריק');
      } catch (e) { log.push(name + ': capturePage ' + (e.message || e)); }
    };
    const run = (js) => wc.executeJavaScript(js, true);
    // ממתין עד שהמסך מתייצב: סימון .loading נעלם ויש תוכן
    const settle = async (maxMs = 6000) => {
      const until = Date.now() + maxMs;
      while (Date.now() < until) {
        const ready = await run(`!document.querySelector('.loading') && !!document.querySelector('#view')?.children.length`)
          .catch(() => false);
        if (ready) return;
        await wait(120);
      }
    };
    const step = async (name, js, { waitFor = null, settleMs = 0 } = {}) => {
      try {
        const r = await run(js);
        if (r === 'no-login' || r === 'no-start-button' || (typeof r === 'string' && r.startsWith('no-cards'))) errors.push(`${name}: ${r}`);
      } catch (e) { errors.push(`${name}: ${e.message || e}`); }
      await settle();
      // פעולות שקורות מעט אחרי הרינדור (כמו מעבר מסך מהדשבורד למרכז הקבוצה)
      await wait(waitFor ? Math.max(600, settleMs) : settleMs);
      if (waitFor) {
        const until = Date.now() + 4000;
        while (Date.now() < until && !(await run(`!!document.querySelector(${JSON.stringify(waitFor)})`).catch(() => false))) await wait(120);
      }
      await wait(250);
      await shot(name);
    };

    await wait(1000);
    await shot('01-login');
    // הקליטה הראשונה של התהליך הראשי לפעמים מפספסת את טעינת הדף — מחכים שה-UI ייבנה
    const bootUntil = Date.now() + 15000;
    while (Date.now() < bootUntil) {
      const ok = await run(`!!document.querySelector('#app')?.children.length`).catch(() => false);
      if (ok) break;
      await wait(200);
    }

    // טופס הכניסה נבנה אחרי בדיקת מצב האימות — ממתינים לו לפני שמזינים סיסמה
    await (async () => {
      const until = Date.now() + 8000;
      while (Date.now() < until) {
        const has = await run(`!!document.querySelector('#login-form')`).catch(() => false);
        if (has) return;
        await wait(120);
      }
    })();
    await step('02-dashboard', `(() => {
      const i = document.querySelector('input[name=password]');
      if (!i) return 'no-login';
      i.value = '1234';
      document.querySelector('#login-form').dispatchEvent(new Event('submit', { cancelable: true }));
      return true; })()`, { waitFor: '[data-group]' });
    await wait(900);

    // "קבוצה אחרונה" שעוד לא הועלו בה תלמידות — לא אמור להחזיר ללחיצה עליה
    await step('02b-stale-lastgroup', `(() => {
      localStorage.setItem('lastGroup', String([...document.querySelectorAll('[data-group]')][1].dataset.group));
      document.querySelector('[data-nav=students]').click(); return true; })()`);
    await step('02c-picker', `(() => { document.querySelector('[data-nav=dashboard]').click(); return true; })()`);
    await step('03-group', `(async () => {
      if (document.querySelector('#start-lesson')) return 'already-group';
      const pick = () => [...document.querySelectorAll('[data-group]')].find((x) => !/מחשבים/.test(x.textContent));
      for (let i = 0; i < 40 && !pick(); i++) await new Promise((r) => setTimeout(r, 100));
      const c = pick();
      if (!c) return 'no-cards:' + document.querySelector('#view').textContent.slice(0, 80);
      c.click();
      for (let i = 0; i < 40 && !document.querySelector('#view .page-title'); i++) await new Promise((r) => setTimeout(r, 100));
      return true; })()`, { waitFor: '#view .page-title' });
    await step('04-lesson', `(async () => {
      await new Promise((r) => setTimeout(r, 200));
      if (!document.querySelector('#start-lesson')) return 'no-start-button:' +
        document.querySelector('.page-title')?.textContent + '|' + document.querySelector('#view').textContent.slice(0, 100).replace(/\s+/g, ' ');
      for (let i = 0; i < 40 && !document.querySelector('#start-lesson'); i++) await new Promise((r) => setTimeout(r, 100));
      const b = document.querySelector('#start-lesson');
      if (!b) return 'no-start-button'; b.click(); return true; })()`, { waitFor: '[data-student]' });
    await step('05-lesson-marked', `(() => { const rows = document.querySelectorAll('[data-student]');
      rows[1] && rows[1].querySelector('[data-status=absent]').click();
      rows[2] && rows[2].querySelector('[data-status=late]').click();
      rows[3] && rows[3].querySelector('[data-status=released]').click();
      rows[1] && rows[1].querySelector('[data-disc]').click();
      return rows.length; })()`);
    await step('06-discipline-dialog', `document.querySelector('#disc-on').click(); true`);
    await step('07-discipline-saved', `document.querySelector('#disc-save').click(); true`);
    await step('08-report-dialog', `document.querySelector('#open-report').click(); true`);
    await step('09-back-to-group', `document.querySelector('.modal [data-close]').click(), document.querySelector('#back').click(); true`);
    await step('10-payments', `document.querySelectorAll('[data-tile]')[2].click(); true`);
    await step('11-back2', `document.querySelector('#back').click(); true`);
    await step('12-reports', `document.querySelector('[data-tile="4"]').click(); true`);
    await step('13-students', `document.querySelector('[data-nav=students]')?.click(); true`);
    await step('14-student-dialog', `document.querySelector('#add')?.click(); true`);
    await step('15-close-dialog', `document.querySelector('.modal [data-cancel]')?.click(); true`);
    await step('16-menu', `document.querySelector('.menu .menu-btn').click(); true`);
    await step('17-menu-closed', `document.querySelector('.menu.open .menu-btn')?.click(); true`);
    await step('18-admin', `document.querySelector('[data-nav=admin]').click(); true`);
    await step('19-admin-dark', `document.querySelector('#theme-toggle').click(); true`);
    await step('20-dashboard-dark', `document.querySelector('[data-nav=dashboard]').click(); true`);
    await step('21-group-dark', `document.querySelector('[data-group]')?.click(); true`);
    await step('22-lesson-dark', `document.querySelector('#start-lesson')?.click(); true`);

    // קבוצה בלי מערכת שעות — לחיצה על סימון נוכחות חייבת לשאול, לא להמציא
    await step('23-nosched-group', `(() => { location.hash = ''; return true; })()`);
    await step('23a-home', `document.querySelector('[data-nav=dashboard]').click(); true`);
    await step('23b-nosched-group', `(() => {
      const cards = [...document.querySelectorAll('[data-group]')];
      const c = cards.find((x) => /מחשבים/.test(x.textContent)) || cards[0];
      if (!c) return 'no-cards:' + document.querySelector('#view').textContent.slice(0, 80);
      c.click(); return cards.length; })()`, { waitFor: '#start-lesson' });
    await step('24-nosched-chooser', `document.querySelector('#start-lesson')?.click(); true`);
    await step('25-chooser-close', `document.querySelector('.modal [data-cancel]')?.click(); true`);
    await step('26-import-entry', `document.querySelector('#import-students')?.click(); true`);
    await step('27-help', `(() => { const m = document.querySelectorAll('.menu .menu-btn')[3];
      if (!m) return false; m.click(); const it = [...document.querySelectorAll('.menu.open .menu-item')];
      const help = it.find((x) => /מדריך/.test(x.textContent)); if (help) help.click(); return true; })()`);
    await step('28-close-help', `document.querySelector('.modal [data-close], .modal [data-cancel]')?.click(); true`);

    const dom = await run(`(() => ({
      menus: [...document.querySelectorAll('.menu-btn')].map((b) => b.textContent),
      nav: [...document.querySelectorAll('.nav-item span')].map((b) => b.textContent),
      title: document.querySelector('.page-title')?.textContent || '',
      icons: document.querySelectorAll('#icon-sprite symbol').length,
      missingIcons: [...new Set([...document.querySelectorAll('use')]
        .map((u) => u.getAttribute('href'))
        .filter((h) => !document.querySelector(h)))],
      theme: document.body.dataset.theme,
      status: document.querySelector('#statusbar')?.textContent.trim() || '',
    }))()`).catch((e) => ({ domError: e.message }));

    console.error('SMOKE_RESULT ' + JSON.stringify({ errors, log, dom }));
    app.exit(errors.length ? 1 : 0);
  });
};
