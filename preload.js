// גשר מאובטח בין הממשק לתהליך הראשי
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

const api = {
  // אימות
  auth: {
    status: () => invoke('auth:status'),
    setup: (c) => invoke('auth:setup', c),
    login: (p) => invoke('auth:login', p),
    recover: (d) => invoke('auth:recover', d),
    update: (d) => invoke('auth:update', d),
  },
  backup: () => invoke('backup:save'),
  excel: {
    import: () => invoke('excel:import'),
    export: (d) => invoke('excel:export', d),
  },
  attachExamFile: (examId) => invoke('exams:attachFile', examId),
  openPath: (p) => invoke('shell:openPath', p),
  info: () => invoke('app:info'),
};

// כל מודולי המסד — אותו מבנה: module(verb, ...args)
for (const mod of ['seminars', 'books', 'groups', 'students', 'schedule', 'lessons', 'attendance', 'exams']) {
  api[mod] = {};
  for (const verb of [
    'list', 'get', 'save', 'remove', 'setPaid', 'importMany', 'getForLesson', 'set',
    'report', 'summary', 'getOrCreateNow', 'current', 'ensureToday', 'grades', 'setGrade', 'sSave',
    'statusNow', 'openSlot',
  ]) {
    api[mod][verb] = (...args) => invoke(`${mod}:${verb}`, ...args);
  }
}

contextBridge.exposeInMainWorld('api', api);
