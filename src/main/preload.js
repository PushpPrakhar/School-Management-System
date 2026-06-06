// preload.js — context bridge between renderer and main process

const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // Auth
  login:              (creds)             => invoke('auth:login', creds),
  changePassword:     (data)              => invoke('auth:changePassword', data),

  // User management
  getUsers:           ()                  => invoke('users:getAll'),
  createUser:         (data)              => invoke('users:create', data),
  toggleUser:         (userId, isActive)  => invoke('users:toggle', { userId, isActive }),

  // Enrollment
  addStudent:         (data)              => invoke('enrollment:add', data),
  editStudent:        (data)              => invoke('enrollment:edit', data),
  getByClass:         (cls, year)         => invoke('enrollment:getByClass', { class: cls, academic_year: year }),
  getStudent:         (admNo)             => invoke('enrollment:getById', admNo),
  searchStudents:     (query)             => invoke('enrollment:search', query),
  updateStudent:      (data)              => invoke('enrollment:update', data),

  // Dashboard
  dashboardStats:     (year)              => invoke('dashboard:stats', year),

  // Fees
  feesGetLedger:      (admNo, year)       => invoke('fees:getLedger',     { admission_number: admNo, academic_year: year }),
  feesAddEntry:       (data)              => invoke('fees:addEntry',       data),
  feesCollectPayment: (data)              => invoke('fees:collectPayment', data),
  feesGetPending:     (year, cls)         => invoke('fees:getPending',     { academic_year: year, class: cls }),
  feesSearchStudent:  (query, year)       => invoke('fees:searchStudent',  { query, academic_year: year }),
  feesGetMonthLedger: (admNo, year)       => invoke('fees:getMonthLedger', { admission_number: admNo, academic_year: year }),

  // Backup
  createBackup:       (dir)               => invoke('backup:create', dir),
  restoreBackup:      (src)               => invoke('backup:restore', src),
  pickDirectory:      ()                  => invoke('dialog:pickDirectory'),
  pickFile:           (filters)           => invoke('dialog:pickFile', filters),

  // Excel import
  excelPreview:       (filePath)          => invoke('excel:preview',  filePath),
  excelValidate:      (filePath)          => invoke('excel:validate', filePath),
  excelImport:        (opts)              => invoke('excel:import',   opts),

  // Progress listener — ipcRenderer used at top level, safe for contextBridge
  onExcelProgress: (cb) => {
    ipcRenderer.on('excel:progress', (_evt, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('excel:progress');
  },
});
