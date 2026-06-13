const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  // Auth
  login:              (creds)             => invoke('auth:login', creds),
  changePassword:     (data)              => invoke('auth:changePassword', data),

  // Users
  getUsers:           ()                  => invoke('users:getAll'),
  createUser:         (data)              => invoke('users:create', data),
  toggleUser:         (id, active)        => invoke('users:toggle', { userId: id, isActive: active }),

  // Enrollment
  addStudent:         (data)              => invoke('enrollment:add', data),
  editStudent:        (data)              => invoke('enrollment:edit', data),
  getByClass:         (cls, year)         => invoke('enrollment:getByClass', { class: cls, academic_year: year }),
  getStudent:         (admNo)             => invoke('enrollment:getById', admNo),
  searchStudents:     (query)             => invoke('enrollment:search', query),

  // Dashboard
  dashboardStats:     (params)            => invoke('dashboard:stats', params),

  // Fees
  feesGetLedger:      (admNo, year)       => invoke('fees:getLedger',     { admission_number: admNo, academic_year: year }),
  feesAddEntry:       (data)              => invoke('fees:addEntry',       data),
  feesCollectPayment: (data)              => invoke('fees:collectPayment', data),
  feesGetPending:     (year, cls)         => invoke('fees:getPending',     { academic_year: year, class: cls }),
  feesSearchStudent:  (query, year)       => invoke('fees:searchStudent',  { query, academic_year: year }),
  feesGetMonthLedger: (admNo, year)       => invoke('fees:getMonthLedger', { admission_number: admNo, academic_year: year }),

  // Files
  createBackup:       (dir)               => invoke('backup:create', dir),
  restoreBackup:      (src)               => invoke('backup:restore', src),
  pickDirectory:      ()                  => invoke('dialog:pickDirectory'),
  pickFile:           (filters)           => invoke('dialog:pickFile', filters),

  // Approval
  getPendingAdmissions:  ()               => invoke('admission:getPending'),
  getAdmissionForReview: (admNo)          => invoke('admission:getForReview', admNo),
  approveAdmission:      (admNo, by)      => invoke('admission:approve', { admission_number: admNo, approved_by: by }),
  rejectAdmission:       (admNo, by, r)   => invoke('admission:reject',  { admission_number: admNo, rejected_by: by, reason: r }),
  getApprovalHistory:    ()               => invoke('admission:getHistory'),

  // Edit history
  getStudentEditHistory: (admNo)          => invoke('editHistory:getByStudent', admNo),
  getAllEditHistory:      ()              => invoke('editHistory:getAll'),

  // Excel
  excelPreview:       (filePath)          => invoke('excel:preview',  filePath),
  excelValidate:      (filePath)          => invoke('excel:validate', filePath),
  excelImport:        (opts)              => invoke('excel:import',   opts),
  onExcelProgress:    (cb)                => {
    ipcRenderer.on('excel:progress', (_evt, data) => cb(data));
    return () => ipcRenderer.removeAllListeners('excel:progress');
  },

  // Roll numbers
  getRollNumbersDynamic:  (cls, sec, yr)        => invoke('rollNumbers:getDynamic',    { class: cls, section: sec, academic_year: yr }),
  checkRollNumbersFrozen: (cls, sec, yr)        => invoke('rollNumbers:checkFrozen',   { class: cls, section: sec, academic_year: yr }),
  assignRollNumbersClass: (cls, sec, yr, by)    => invoke('rollNumbers:assignClass',   { class: cls, section: sec, academic_year: yr, assigned_by: by }),
  assignRollNumbersAll:   (yr, by)              => invoke('rollNumbers:assignAll',     { academic_year: yr, assigned_by: by }),
  getFrozenRollNumbers:   (cls, sec, yr)        => invoke('rollNumbers:getFrozen',     { class: cls, section: sec, academic_year: yr }),
  addMidYearRollNumber:   (admNo, cls, sec, yr) => invoke('rollNumbers:addMidYear',    { admission_number: admNo, class: cls, section: sec, academic_year: yr }),
  getRollNumberSummary:   (yr)                  => invoke('rollNumbers:getSummary',    yr),
  getStudentRollNumber:   (admNo, yr)           => invoke('rollNumbers:getForStudent', { admission_number: admNo, academic_year: yr }),

  // Promotion
  promotionPreview:   (from, to)          => invoke('promotion:preview', { from_year: from, to_year: to }),
  promotionExecute:   (to, excl, by)      => invoke('promotion:execute', { to_year: to, excluded: excl, promoted_by: by }),
  promotionHistory:   ()                  => invoke('promotion:getHistory'),

  // Daily Attendance
  attendanceGetStudents:   (cls, sec, yr)                 => invoke('attendance:getStudents',     { class: cls, section: sec, academic_year: yr }),
  attendanceGetByDate:     (cls, sec, date)               => invoke('attendance:getByDate',       { class: cls, section: sec, date }),
  attendanceMarkDay:       (cls, sec, date, yr, recs, by) => invoke('attendance:markDay',         { class: cls, section: sec, date, academic_year: yr, records: recs, marked_by: by }),
  attendanceGetMonthly:    (cls, sec, mon, yr, acYr)      => invoke('attendance:getMonthly',      { class: cls, section: sec, month: mon, year: yr, academic_year: acYr }),
  attendanceGetDailyGrid:  (cls, sec, mon, yr, acYr)      => invoke('attendance:getDailyGrid',    { class: cls, section: sec, month: mon, year: yr, academic_year: acYr }),
  attendanceGetLow:        (yr, threshold)                => invoke('attendance:getLowAttendance', { academic_year: yr, threshold }),
  attendanceGetMarkedDates:(cls, sec, mon, yr)            => invoke('attendance:getMarkedDates',  { class: cls, section: sec, month: mon, year: yr }),
  attendanceLockDay:       (cls, sec, date, by)           => invoke('attendance:lockDay',         { class: cls, section: sec, date, locked_by: by }),
  attendanceUnlockDay:     (cls, sec, date)               => invoke('attendance:unlockDay',       { class: cls, section: sec, date }),
  attendanceCheckLocked:   (cls, sec, date)               => invoke('attendance:checkLocked',     { class: cls, section: sec, date }),
  attendanceGetLockedDates:(cls, sec, mon, yr)            => invoke('attendance:getLockedDates',  { class: cls, section: sec, month: mon, year: yr }),
});
