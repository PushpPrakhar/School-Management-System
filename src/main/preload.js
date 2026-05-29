// preload.js — context bridge between renderer and main process
// Only the channels listed here are accessible from React.

const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // Auth
  login:          (creds)              => invoke('auth:login', creds),
  changePassword: (data)               => invoke('auth:changePassword', data),

  // User management
  getUsers:       ()                   => invoke('users:getAll'),
  createUser:     (data)               => invoke('users:create', data),
  toggleUser:     (userId, isActive)   => invoke('users:toggle', { userId, isActive }),

  // Enrollment
  addStudent:     (data)               => invoke('enrollment:add', data),
  getByClass:     (cls, year)          => invoke('enrollment:getByClass', { class: cls, academic_year: year }),
  getStudent:     (admNo)              => invoke('enrollment:getById', admNo),
  searchStudents: (query)              => invoke('enrollment:search', query),
  updateStudent:  (data)               => invoke('enrollment:update', data),

  // Dashboard
  dashboardStats: (year)               => invoke('dashboard:stats', year),

  // Backup
  createBackup:   (dir)                => invoke('backup:create', dir),
  restoreBackup:  (src)                => invoke('backup:restore', src),
  pickDirectory:  ()                   => invoke('dialog:pickDirectory'),
  pickFile:       (filters)            => invoke('dialog:pickFile', filters),

  // Excel import
  excelPreview:   (filePath)           => invoke('excel:preview', filePath),
  excelImport:    (opts)               => invoke('excel:import', opts),
});
