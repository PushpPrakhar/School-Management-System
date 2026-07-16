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

  // Files
  createBackup:       (dir)               => invoke('backup:create', dir),
  restoreBackup:      (src)               => invoke('backup:restore', src),
  pickDirectory:      ()                  => invoke('dialog:pickDirectory'),
  pickFile:           (filters)           => invoke('dialog:pickFile', filters),

  // Admission approval
  getPendingAdmissions:  ()               => invoke('admission:getPending'),
  getAdmissionForReview: (tempId)         => invoke('admission:getForReview', tempId),
  approveAdmission:      (tempId, by)     => invoke('admission:approve',     { temp_id: tempId, approved_by: by }),
  rejectAdmission:       (tempId, by, r)  => invoke('admission:reject',      { temp_id: tempId, rejected_by: by, reason: r }),
  editTempAdmission:     (data)           => invoke('admission:editTemp',     data),
  getRejectedAdmissions: ()               => invoke('admission:getRejected'),
  getApprovalHistory:    ()               => invoke('admission:getHistory'),

  // Edit history
  getStudentEditHistory: (admNo)          => invoke('editHistory:getByStudent', admNo),
  getAllEditHistory:      ()               => invoke('editHistory:getAll'),

  // Excel import
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
  attendanceGetStudents:    (cls, sec, yr)                 => invoke('attendance:getStudents',      { class: cls, section: sec, academic_year: yr }),
  attendanceGetByDate:      (cls, sec, date)               => invoke('attendance:getByDate',        { class: cls, section: sec, date }),
  attendanceMarkDay:        (cls, sec, date, yr, recs, by) => invoke('attendance:markDay',          { class: cls, section: sec, date, academic_year: yr, records: recs, marked_by: by }),
  attendanceGetMonthly:     (cls, sec, mon, yr, acYr)      => invoke('attendance:getMonthly',       { class: cls, section: sec, month: mon, year: yr, academic_year: acYr }),
  attendanceGetDailyGrid:   (cls, sec, mon, yr, acYr)      => invoke('attendance:getDailyGrid',     { class: cls, section: sec, month: mon, year: yr, academic_year: acYr }),
  attendanceGetLow:         (yr, threshold)                => invoke('attendance:getLowAttendance', { academic_year: yr, threshold }),
  attendanceGetMarkedDates: (cls, sec, mon, yr)            => invoke('attendance:getMarkedDates',   { class: cls, section: sec, month: mon, year: yr }),
  attendanceLockDay:        (cls, sec, date, by)           => invoke('attendance:lockDay',          { class: cls, section: sec, date, locked_by: by }),
  attendanceUnlockDay:      (cls, sec, date)               => invoke('attendance:unlockDay',        { class: cls, section: sec, date }),
  attendanceCheckLocked:    (cls, sec, date)               => invoke('attendance:checkLocked',      { class: cls, section: sec, date }),
  attendanceGetLockedDates: (cls, sec, mon, yr)            => invoke('attendance:getLockedDates',   { class: cls, section: sec, month: mon, year: yr }),
  attendanceGetProgressive: (cls, sec, yr, mon, y)         => invoke('attendance:getProgressive',   { class: cls, section: sec, academic_year: yr, up_to_month: mon, up_to_year: y }),
  attendanceGetStudentMonth:(admNo, mon, yr, acYr)         => invoke('attendance:getStudentMonth',  { admission_number: admNo, month: mon, year: yr, academic_year: acYr }),
  attendanceSaveStudentMonth:(admNo, name, cls, sec, acYr, records, by) => invoke('attendance:saveStudentMonth', { admission_number: admNo, student_name: name, class: cls, section: sec, academic_year: acYr, records, entered_by: by }),
  attendanceSearchStudent:  (query, cls, sec)              => invoke('attendance:searchStudent',    { query, class: cls, section: sec }),

  // Academic Calendar
  calendarGetMonth:       (yr, mon, y)                            => invoke('calendar:getMonth',       { academic_year: yr, month: mon, year: y }),
  calendarSetDay:         (yr, date, type, name, applies, by)     => invoke('calendar:setDay',         { academic_year: yr, date, day_type: type, event_name: name, applies_to: applies, created_by: by }),
  calendarMarkRange:      (yr, from, to, type, name, applies, by) => invoke('calendar:markRange',      { academic_year: yr, from_date: from, to_date: to, day_type: type, event_name: name, applies_to: applies, created_by: by }),
  calendarClearRange:     (yr, from, to)                          => invoke('calendar:clearRange',     { academic_year: yr, from_date: from, to_date: to }),
  calendarGetWorkingDays: (yr, mon, y)                            => invoke('calendar:getWorkingDays', { academic_year: yr, month: mon, year: y }),
  calendarGetYearSummary: (yr)                                     => invoke('calendar:getYearSummary', yr),

  // Examination
  examGetStudents:  (cls, sec, yr)                        => invoke('exam:getStudents', { class: cls, section: sec, academic_year: yr }),
  examGetMarks:     (cls, sec, yr, type)                  => invoke('exam:getMarks',    { class: cls, section: sec, academic_year: yr, exam_type: type }),
  examSaveMarks:    (cls, sec, yr, type, marks, by, lock) => invoke('exam:saveMarks',   { class: cls, section: sec, academic_year: yr, exam_type: type, marks, entered_by: by, auto_lock: lock }),
  examLock:         (cls, sec, yr, type, by)              => invoke('exam:lock',        { class: cls, section: sec, academic_year: yr, exam_type: type, locked_by: by }),
  examUnlock:       (cls, sec, yr, type)                  => invoke('exam:unlock',      { class: cls, section: sec, academic_year: yr, exam_type: type }),
  examCheckLocked:  (cls, sec, yr, type)                  => invoke('exam:checkLocked', { class: cls, section: sec, academic_year: yr, exam_type: type }),
  examGetStatus:    (yr, cls, sec)                        => invoke('exam:getStatus',   { academic_year: yr, class: cls, section: sec }),

  // Fee Settings (Phase 1)
  feeSettingsGet:           (yr)              => invoke('feeSettings:get', yr),
  feeSettingsSave:          (data)            => invoke('feeSettings:save', data),
  feeStructureGet:          (yr)              => invoke('feeStructure:get', yr),
  feeStructureSave:         (yr, entries, by) => invoke('feeStructure:save', { academic_year: yr, entries, saved_by: by }),
  feeStructureCopyFromYear: (from, to, by)    => invoke('feeStructure:copyFromYear', { from_year: from, to_year: to, copied_by: by }),
  transportRoutesGetAll:    (yr)              => invoke('transportRoutes:getAll', yr),
  transportRoutesSave:      (data)            => invoke('transportRoutes:save', data),
  transportRoutesDelete:    (id)              => invoke('transportRoutes:delete', id),
  centersGetAll:            ()                => invoke('centers:getAll'),
  centersSaveCenter:        (data)            => invoke('centers:saveCenter', data),
  centersSaveCounter:       (data)            => invoke('centers:saveCounter', data),

  // Fee Ledger (Phase 2)
  feeLedgerGetUnassigned:     (yr, cls)               => invoke('feeLedger:getUnassigned', { academic_year: yr, class: cls }),
  feeLedgerGetPrevBalance:    (admNo, yr)             => invoke('feeLedger:getPrevBalance', { admission_number: admNo, academic_year: yr }),
  feeLedgerGetNextSL:         (yr)                    => invoke('feeLedger:getNextSL', yr),
  feeLedgerCreateBulk:        (yr, entries, by)       => invoke('feeLedger:createBulk', { academic_year: yr, entries, created_by: by }),
  feeLedgerCreateProvisional: (yr, student_name, father_name, current_class, section, village, opening_balance, by) =>
    invoke('feeLedger:createProvisionalStudent', { academic_year: yr, student_name, father_name, current_class, section, village, opening_balance, created_by: by }),
  feeLedgerCreateGroup:       (yr, ids, by, gsl)      => invoke('feeLedger:createGroup', { academic_year: yr, ledger_ids: ids, created_by: by, gsl_number_manual: gsl }),
  feeLedgerGetAll:            (yr)                    => invoke('feeLedger:getAll', yr),
  feeLedgerGetTransactions:   (lid, yr)               => invoke('feeLedger:getTransactions', { ledger_id: lid, academic_year: yr }),
  feeLedgerGetGroupTxns:      (gid, yr)               => invoke('feeLedger:getGroupTransactions', { group_id: gid, academic_year: yr }),
  feeLedgerUpdatePage:        (lid, page)             => invoke('feeLedger:updatePage', { ledger_id: lid, physical_page: page }),
  feeLedgerUpdateOpeningBal:  (lid, bal)              => invoke('feeLedger:updateOpeningBalance', { ledger_id: lid, opening_balance: bal }),
  feeLedgerSearch:            (query, yr)             => invoke('feeLedger:search', { query, academic_year: yr }),
  feeLedgerGetMonthlyReport:  (yr, mon, y, cls)       => invoke('feeLedger:getMonthlyReport', { academic_year: yr, month: mon, year: y, class: cls }),

  // Counter Payment (Phase 3)
  counterGetNextReceipt:    (yr)                    => invoke('counter:getNextReceipt', yr),
  counterGetLedger:         (query, yr)             => invoke('counter:getLedgerForPayment', { query, academic_year: yr }),
  counterGetGroup:          (query, yr)             => invoke('counter:getGroupForPayment', { query, academic_year: yr }),
  counterSavePayment:       (data)                  => invoke('counter:savePayment', data),
  counterCancelPayment:     (rcpt, yr, by)          => invoke('counter:cancelPayment', { receipt_number: rcpt, academic_year: yr, cancelled_by: by }),
  counterGetReceipt:        (rcpt, yr)              => invoke('counter:getReceipt', { receipt_number: rcpt, academic_year: yr }),
  counterGetReceiptPrintData: (rcpt, yr)             => invoke('counter:getReceiptPrintData', { receipt_number: rcpt, academic_year: yr }),
  counterGetTodayReceipts:  (yr, cid, ctid, date)  => invoke('counter:getTodayReceipts', { academic_year: yr, center_id: cid, counter_id: ctid, date }),

  // Day-End Posting (Phase 4)
  postingGetStaged:          (cid, ctid, date, yr)               => invoke('posting:getStaged',          { center_id: cid, counter_id: ctid, date, academic_year: yr }),
  postingCreateAndPost:      (cid, ctid, date, yr, by, selectedKeys)  => invoke('posting:createAndPost',      { center_id: cid, counter_id: ctid, date, academic_year: yr, posted_by: by, selected_keys: selectedKeys }),
  postingGetHistory:         (cid, yr)                           => invoke('posting:getHistory',         { center_id: cid, academic_year: yr }),
  postingGetScheduleDetails: (sid)                               => invoke('posting:getScheduleDetails', sid),
  postingGetReconciliation:  (cid, ctid, date, yr, mode, status) => invoke('posting:getReconciliation',  { center_id: cid, counter_id: ctid, date, academic_year: yr, payment_mode: mode, status_filter: status }),

  // Reports & Reprints (Phase 5)
  reportsGetDailyPayout:     (cid, date, yr, mode)    => invoke('reports:getDailyPayout',      { center_id: cid, date, academic_year: yr, payment_mode: mode }),
  reportsGetDefaulters:      (yr, cls)                => invoke('reports:getDefaulters',        { academic_year: yr, class: cls }),
  reportsGetReceiptForPrint: (rcpt, yr)               => invoke('reports:getReceiptForPrint',   { receipt_number: rcpt, academic_year: yr }),
  reportsGetReceiptHistory:  (yr, mon, y, cls)        => invoke('reports:getReceiptHistory',    { academic_year: yr, month: mon, year: y, class: cls }),

  // Cash Book (Phase 7)
  cashbookGetDaily:        (date, yr)       => invoke('cashbook:getDaily',          { date, academic_year: yr }),
  cashbookAddExpense:      (data)           => invoke('cashbook:addExpense',         data),
  cashbookUpdateExpense:   (data)           => invoke('cashbook:updateExpense',      data),
  cashbookDeleteExpense:   (id)             => invoke('cashbook:deleteExpense',      id),
  cashbookGetMonthlySummary: (yr)           => invoke('cashbook:getMonthlySummary',  { academic_year: yr }),

  // Prospectus & Pre-Admission (Phase 8)
  prospectusAdd:          (data)                          => invoke('prospectus:add',          data),
  prospectusGetAll:       (filters)                       => invoke('prospectus:getAll',        filters || {}),
  prospectusUpdate:       (data)                          => invoke('prospectus:update',        data),
  prospectusMarkAdmitted: (id, admNo, adjust)             => invoke('prospectus:markAdmitted',  { inquiry_id: id, admission_number: admNo, adjust_fee: adjust }),
  prospectusGetStats:     ()                              => invoke('prospectus:getStats'),

  // Counter Other Payment — Tie, Belt, ID Card, damage, scrap, donations, etc.
  counterOtherGetNextReceipt:     (yr)                  => invoke('counterOther:getNextReceipt', yr),
  counterOtherSavePayment:        (data)                => invoke('counterOther:savePayment', data),
  counterOtherGetReceiptPrintData:(rcpt, yr)             => invoke('counterOther:getReceiptPrintData', { receipt_number: rcpt, academic_year: yr }),
  counterGetDailyCollection:      (date, yr)             => invoke('counter:getDailyCollection', { date, academic_year: yr }),

  // Phase 9 — Transport Monthly + Sibling Concession
  transportGetMonthly:       (yr, mon)                        => invoke('transport:getMonthly',     { academic_year: yr, month: mon }),
  transportSaveMonthly:      (yr, mon, assignments, by)       => invoke('transport:saveMonthly',    { academic_year: yr, month: mon, assignments, saved_by: by }),
  transportGetForStudent:    (admNo, yr, mon)                 => invoke('transport:getForStudent',  { admission_number: admNo, academic_year: yr, month: mon }),
  ledgerGetSiblingPosition:  (lid, yr)                        => invoke('ledger:getSiblingPosition',{ ledger_id: lid, academic_year: yr }),

  // Bulk Receivable Entry
  counterGetBulkPreview:    (yr, mon, y, feeTypes)      => invoke('counter:getBulkPreview',    { academic_year: yr, month: mon, year: y, fee_types: feeTypes }),
  counterSaveBulkReceivable:(yr, entries, by, cid, mon, y) => invoke('counter:saveBulkReceivable', { academic_year: yr, entries, posted_by: by, center_id: cid, month: mon, year: y }),

  feeLedgerRemoveFromGroup:   (lid)                    => invoke('feeLedger:removeFromGroup', { ledger_id: lid }),
  feeLedgerGetUngrouped:      (yr)                     => invoke('feeLedger:getUngrouped',    yr),

  feeLedgerGetNextGSL:        (yr)                     => invoke('feeLedger:getNextGSL',  yr),
  feeLedgerAddToGroup:        (lid, gid, yr)           => invoke('feeLedger:addToGroup',  { ledger_id: lid, group_id: gid, academic_year: yr }),

  // Auto Accrual (monthly + annual/twice-yearly dues)
  accrualGetSummary: (yr)     => invoke('accrual:getSummary', { academic_year: yr }),
  accrualGenerate:   (yr, by) => invoke('accrual:generate',   { academic_year: yr, generated_by: by }),
});
