// ============================================================
//  main.js  —  Electron main process
//  Handles: app window, SQLite init, all IPC channels
// ============================================================

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ── SQLite & bcrypt (Node-side only, never in renderer) ──────
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const XLSX = require('xlsx');

// ── Paths ────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

const DATA_DIR = isDev
  ? path.join(__dirname, '../../data')
  : path.join(app.getPath('userData'), 'data');

const DB_PATH = path.join(DATA_DIR, 'school.db');

const SCHEMA_PATH = isDev
  ? path.join(__dirname, '../database/schema.sql')
  : path.join(process.resourcesPath, 'schema.sql');

// ── Ensure data directory exists ─────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Open / init database ─────────────────────────────────────
let db;
function initDatabase() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run schema only if tables don't exist yet
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);

  // Migrations: safely add new/updated columns to existing DBs
  const migrate = (sql) => { try { db.exec(sql); } catch (_) {} };
  // Address
  migrate("ALTER TABLE enrollment ADD COLUMN house_no TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN village TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN post TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN district TEXT NOT NULL DEFAULT 'Bulandshahr'");
  migrate("ALTER TABLE enrollment ADD COLUMN state_name TEXT NOT NULL DEFAULT 'Uttar Pradesh'");
  migrate("ALTER TABLE enrollment ADD COLUMN pin_code TEXT NOT NULL DEFAULT '203131'");
  migrate("ALTER TABLE enrollment ADD COLUMN town TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN city TEXT NOT NULL DEFAULT ''");
  // Student extras
  migrate("ALTER TABLE enrollment ADD COLUMN nationality TEXT NOT NULL DEFAULT 'Indian'");
  migrate("ALTER TABLE enrollment ADD COLUMN physically_handicapped TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN disability_description TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN blood_group TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN rte TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN rte_details TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN student_status TEXT NOT NULL DEFAULT 'ACTIVE'");
  migrate("ALTER TABLE enrollment ADD COLUMN birth_document TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN sr_number INTEGER");
  // Documents
  migrate("ALTER TABLE enrollment ADD COLUMN birth_cert_submitted TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN birth_cert_number TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN tc_submitted TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_school_attended TEXT NOT NULL DEFAULT 'No'");
  // Parents
  migrate("ALTER TABLE enrollment ADD COLUMN father_qualification TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN father_profession TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN mother_qualification TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN mother_profession TEXT NOT NULL DEFAULT ''");
  // Siblings
  migrate("ALTER TABLE enrollment ADD COLUMN siblings TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN sibling_codes TEXT NOT NULL DEFAULT ''");

  // New columns for redesigned admission form
  migrate("ALTER TABLE enrollment ADD COLUMN guardian_name TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN mobile_number TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN alternate_mobile TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN contact_email TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN mother_tongue TEXT NOT NULL DEFAULT 'Hindi'");
  migrate("ALTER TABLE enrollment ADD COLUMN minority_group TEXT NOT NULL DEFAULT 'Not Applicable'");
  migrate("ALTER TABLE enrollment ADD COLUMN caste TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN religion TEXT NOT NULL DEFAULT 'NOT PROVIDED'");
  migrate("ALTER TABLE enrollment ADD COLUMN bpl_beneficiary TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN ews_disadvantaged TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN cwsn TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN impairment_type TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN disability_certificate TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN disability_percentage TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN section TEXT NOT NULL DEFAULT 'A'");
  migrate("ALTER TABLE enrollment ADD COLUMN medium_of_instruction TEXT NOT NULL DEFAULT 'Hindi'");
  migrate("ALTER TABLE enrollment ADD COLUMN language_group TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN academic_stream TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN subject_group TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_year_status TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_year_class TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN rte_section_12c TEXT NOT NULL DEFAULT 'No'");
  migrate("ALTER TABLE enrollment ADD COLUMN rte_amount_claimed TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN is_new_student TEXT NOT NULL DEFAULT 'Yes'");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_result TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_marks_percentage TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_days_attended TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_class_studied TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN prev_group_studied TEXT NOT NULL DEFAULT ''");

  // Edit history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS edit_history (
      history_id       INTEGER  PRIMARY KEY AUTOINCREMENT,
      admission_number TEXT     NOT NULL,
      student_name     TEXT     NOT NULL DEFAULT '',
      edited_by        TEXT     NOT NULL DEFAULT '',
      edited_at        DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      changes          TEXT     NOT NULL DEFAULT '[]'
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_edit_history_admission ON edit_history (admission_number)");
  } catch(_) {}

  // Approval workflow columns
  migrate("ALTER TABLE enrollment ADD COLUMN submitted_by TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN approved_at TEXT NOT NULL DEFAULT ''");
  migrate("ALTER TABLE enrollment ADD COLUMN rejected_reason TEXT NOT NULL DEFAULT ''");

  // Fix any dates stored as Excel serial numbers
  // Excel serial → DD-MM-YYYY conversion
  const fixExcelDates = () => {
    const excelSerial = (n) => {
      const d = new Date(Date.UTC(1899, 11, 30 + n));
      const dd = String(d.getUTCDate()).padStart(2,'0');
      const mm = String(d.getUTCMonth()+1).padStart(2,'0');
      const yy = d.getUTCFullYear();
      return `${dd}-${mm}-${yy}`;
    };
    const rows = db.prepare("SELECT rowid, date_of_birth, date_of_admission FROM enrollment").all();
    const upDob = db.prepare("UPDATE enrollment SET date_of_birth = ? WHERE rowid = ?");
    const upDoa = db.prepare("UPDATE enrollment SET date_of_admission = ? WHERE rowid = ?");
    let fixed = 0;
    rows.forEach(r => {
      if (r.date_of_birth && /^\d{4,5}$/.test(String(r.date_of_birth).trim())) {
        upDob.run(excelSerial(parseInt(r.date_of_birth)), r.rowid);
        fixed++;
      }
      if (r.date_of_admission && /^\d{4,5}$/.test(String(r.date_of_admission).trim())) {
        upDoa.run(excelSerial(parseInt(r.date_of_admission)), r.rowid);
        fixed++;
      }
    });
    if (fixed > 0) console.log(`[DB] Fixed ${fixed} Excel serial date(s)`);
  };
  fixExcelDates();

  // Roll numbers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS roll_numbers (
      roll_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
      admission_number TEXT     NOT NULL,
      student_name     TEXT     NOT NULL DEFAULT '',
      class            TEXT     NOT NULL DEFAULT '',
      section          TEXT     NOT NULL DEFAULT '',
      academic_year    TEXT     NOT NULL DEFAULT '',
      roll_number      INTEGER  NOT NULL DEFAULT 0,
      is_mid_year      INTEGER  NOT NULL DEFAULT 0,
      assigned_at      DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (class, section, academic_year, roll_number),
      UNIQUE (admission_number, class, section, academic_year)
    )
  `);
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_roll_class ON roll_numbers (class, section, academic_year)");
  } catch(_) {}

  // Daily attendance table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_daily (
      attendance_id    INTEGER  PRIMARY KEY AUTOINCREMENT,
      admission_number TEXT     NOT NULL,
      student_name     TEXT     NOT NULL DEFAULT '',
      class            TEXT     NOT NULL DEFAULT '',
      section          TEXT     NOT NULL DEFAULT '',
      date             TEXT     NOT NULL DEFAULT '',
      academic_year    TEXT     NOT NULL DEFAULT '',
      status           TEXT     NOT NULL DEFAULT 'Present',
      marked_by        TEXT     NOT NULL DEFAULT '',
      marked_at        DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (admission_number, date)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_att_class_date ON attendance_daily (class, section, date)"); } catch(_) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_att_student ON attendance_daily (admission_number, academic_year)"); } catch(_) {}

  // Attendance locks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_locks (
      lock_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
      class       TEXT     NOT NULL,
      section     TEXT     NOT NULL,
      date        TEXT     NOT NULL,
      locked_by   TEXT     NOT NULL DEFAULT '',
      locked_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE (class, section, date)
    )
  `);

  // temp_admissions — students waiting for approval (no admission number yet)
  db.exec(`
    CREATE TABLE IF NOT EXISTS temp_admissions (
      temp_id                INTEGER  PRIMARY KEY AUTOINCREMENT,
      student_name           TEXT     NOT NULL DEFAULT '',
      gender                 TEXT     NOT NULL DEFAULT '',
      date_of_birth          TEXT     NOT NULL DEFAULT '',
      indian_nationality     TEXT     NOT NULL DEFAULT 'YES',
      blood_group            TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      mother_tongue          TEXT     NOT NULL DEFAULT 'Hindi',
      aadhar_number          TEXT     NOT NULL DEFAULT '',
      aadhar_doc             TEXT     NOT NULL DEFAULT '',
      birth_cert             TEXT     NOT NULL DEFAULT 'NO',
      birth_cert_doc         TEXT     NOT NULL DEFAULT '',
      mother_name            TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      mother_profession      TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      father_name            TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      father_profession      TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      guardian_name          TEXT     NOT NULL DEFAULT '',
      contact_email          TEXT     NOT NULL DEFAULT '',
      mobile_number          TEXT     NOT NULL DEFAULT '',
      alternate_mobile       TEXT     NOT NULL DEFAULT '',
      house_no               TEXT     NOT NULL DEFAULT '',
      village                TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      post                   TEXT     NOT NULL DEFAULT '',
      district               TEXT     NOT NULL DEFAULT 'Aligarh',
      state_name             TEXT     NOT NULL DEFAULT 'Uttar Pradesh',
      pin_code               TEXT     NOT NULL DEFAULT '',
      category               TEXT     NOT NULL DEFAULT 'GENERAL',
      caste                  TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      religion               TEXT     NOT NULL DEFAULT 'NOT PROVIDED',
      minority_group         TEXT     NOT NULL DEFAULT 'Not Applicable',
      bpl_beneficiary        TEXT     NOT NULL DEFAULT 'No',
      ews_disadvantaged      TEXT     NOT NULL DEFAULT 'No',
      cwsn                   TEXT     NOT NULL DEFAULT 'No',
      impairment_type        TEXT     NOT NULL DEFAULT '',
      disability_certificate TEXT     NOT NULL DEFAULT '',
      disability_cert_doc    TEXT     NOT NULL DEFAULT '',
      disability_percentage  TEXT     NOT NULL DEFAULT '',
      pen_number             TEXT     NOT NULL DEFAULT '',
      apaar_id               TEXT     NOT NULL DEFAULT '',
      rte_section_12c        TEXT     NOT NULL DEFAULT 'No',
      rte_amount_claimed     TEXT     NOT NULL DEFAULT '',
      date_of_admission      TEXT     NOT NULL DEFAULT '',
      class_of_admission     TEXT     NOT NULL DEFAULT '',
      section                TEXT     NOT NULL DEFAULT 'A',
      medium_of_instruction  TEXT     NOT NULL DEFAULT 'Hindi',
      studied_elsewhere      TEXT     NOT NULL DEFAULT 'No',
      tc_submitted           TEXT     NOT NULL DEFAULT 'No',
      tc_doc                 TEXT     NOT NULL DEFAULT '',
      prev_year_status       TEXT     NOT NULL DEFAULT '',
      prev_year_class        TEXT     NOT NULL DEFAULT '',
      prev_enrollment_number TEXT     NOT NULL DEFAULT '',
      prev_academic_year     TEXT     NOT NULL DEFAULT '',
      prev_school_name       TEXT     NOT NULL DEFAULT '',
      language_group         TEXT     NOT NULL DEFAULT '',
      academic_stream        TEXT     NOT NULL DEFAULT '',
      subject_group          TEXT     NOT NULL DEFAULT '',
      academic_year          TEXT     NOT NULL DEFAULT '',
      submitted_by           TEXT     NOT NULL DEFAULT '',
      submitted_at           DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // rejected_admissions — rejected students (separate from enrollment)
  db.exec(`
    CREATE TABLE IF NOT EXISTS rejected_admissions (
      reject_id              INTEGER  PRIMARY KEY AUTOINCREMENT,
      student_name           TEXT     NOT NULL DEFAULT '',
      gender                 TEXT     NOT NULL DEFAULT '',
      date_of_birth          TEXT     NOT NULL DEFAULT '',
      father_name            TEXT     NOT NULL DEFAULT '',
      mother_name            TEXT     NOT NULL DEFAULT '',
      mobile_number          TEXT     NOT NULL DEFAULT '',
      class_of_admission     TEXT     NOT NULL DEFAULT '',
      section                TEXT     NOT NULL DEFAULT '',
      academic_year          TEXT     NOT NULL DEFAULT '',
      village                TEXT     NOT NULL DEFAULT '',
      aadhar_number          TEXT     NOT NULL DEFAULT '',
      pen_number             TEXT     NOT NULL DEFAULT '',
      date_of_admission      TEXT     NOT NULL DEFAULT '',
      submitted_by           TEXT     NOT NULL DEFAULT '',
      submitted_at           TEXT     NOT NULL DEFAULT '',
      rejected_by            TEXT     NOT NULL DEFAULT '',
      rejected_reason        TEXT     NOT NULL DEFAULT '',
      rejected_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // Migration: move existing PENDING students from enrollment to temp_admissions
  (function migratePendingToTemp() {
    try {
      const pending = db.prepare(
        "SELECT * FROM enrollment WHERE student_status = 'PENDING'"
      ).all();
      if (pending.length === 0) return;

      const insertTemp = db.prepare(`
        INSERT OR IGNORE INTO temp_admissions (
          student_name, gender, date_of_birth, indian_nationality,
          blood_group, mother_tongue, aadhar_number, aadhar_doc,
          birth_cert, birth_cert_doc, mother_name, mother_profession,
          father_name, father_profession, guardian_name, contact_email,
          mobile_number, alternate_mobile, house_no, village, post,
          district, state_name, pin_code, category, caste, religion,
          minority_group, bpl_beneficiary, ews_disadvantaged,
          cwsn, impairment_type, disability_certificate, disability_cert_doc,
          disability_percentage, pen_number, apaar_id, rte_section_12c,
          rte_amount_claimed, date_of_admission, class_of_admission, section,
          medium_of_instruction, studied_elsewhere, tc_submitted, tc_doc,
          prev_year_status, prev_year_class, prev_enrollment_number,
          prev_academic_year, prev_school_name, language_group,
          academic_stream, subject_group, academic_year, submitted_by
        ) VALUES (
          @student_name, @gender, @date_of_birth, @indian_nationality,
          @blood_group, @mother_tongue, @aadhar_number, @aadhar_doc,
          @birth_cert, @birth_cert_doc, @mother_name, @mother_profession,
          @father_name, @father_profession, @guardian_name, @contact_email,
          @mobile_number, @alternate_mobile, @house_no, @village, @post,
          @district, @state_name, @pin_code, @category, @caste, @religion,
          @minority_group, @bpl_beneficiary, @ews_disadvantaged,
          @cwsn, @impairment_type, @disability_certificate, @disability_cert_doc,
          @disability_percentage, @pen_number, @apaar_id, @rte_section_12c,
          @rte_amount_claimed, @date_of_admission, @class_of_admission, @section,
          @medium_of_instruction, @studied_elsewhere, @tc_submitted, @tc_doc,
          @prev_year_status, @prev_year_class, @prev_enrollment_number,
          @prev_academic_year, @prev_school_name, @language_group,
          @academic_stream, @subject_group, @academic_year, @submitted_by
        )
      `);

      const migrate = db.transaction(() => {
        pending.forEach(s => {
          insertTemp.run({ ...s, submitted_by: s.submitted_by || '' });
          db.prepare("DELETE FROM enrollment WHERE admission_number = ?")
            .run(s.admission_number);
        });
      });
      migrate();
      console.log('[DB] Migrated ' + pending.length + ' PENDING student(s) to temp_admissions');
    } catch(e) {
      console.error('[DB] Migration error:', e.message);
    }
  })();

  // Add submitted_by to temp_admissions if missing (migration for existing tables)
  try { db.exec("ALTER TABLE temp_admissions ADD COLUMN submitted_by TEXT NOT NULL DEFAULT ''"); } catch(_) {}
  // Add submitted_at to temp_admissions if missing
  try { db.exec("ALTER TABLE temp_admissions ADD COLUMN submitted_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))"); } catch(_) {}

  // ── Users table: create + ensure all columns exist ──────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      user_id       INTEGER  PRIMARY KEY AUTOINCREMENT,
      username      TEXT     NOT NULL UNIQUE,
      password_hash TEXT     NOT NULL,
      full_name     TEXT     NOT NULL DEFAULT '',
      role          TEXT     NOT NULL DEFAULT 'staff',
      assigned_class TEXT    NOT NULL DEFAULT '',
      is_active     INTEGER  NOT NULL DEFAULT 1,
      created_at    DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      last_login    TEXT     NOT NULL DEFAULT ''
    )
  `);
  // Safe migrations for users table columns that may be missing in old DBs
  [
    "ALTER TABLE users ADD COLUMN assigned_class TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN full_name TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN last_login TEXT NOT NULL DEFAULT ''",
  ].forEach(sql => { try { db.exec(sql); } catch(_) {} });

  // ── Ensure all temp_admissions columns exist (safe to run repeatedly)
  const tempCols = [
    "ALTER TABLE temp_admissions ADD COLUMN submitted_by TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE temp_admissions ADD COLUMN submitted_at DATETIME NOT NULL DEFAULT (datetime('now','localtime'))",
    "ALTER TABLE temp_admissions ADD COLUMN religion TEXT NOT NULL DEFAULT 'NOT PROVIDED'",
    "ALTER TABLE temp_admissions ADD COLUMN caste TEXT NOT NULL DEFAULT 'NOT PROVIDED'",
    "ALTER TABLE temp_admissions ADD COLUMN apaar_id TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE temp_admissions ADD COLUMN pen_number TEXT NOT NULL DEFAULT ''",
  ];
  tempCols.forEach(sql => { try { db.exec(sql); } catch(_) {} });

  // Academic Calendar table
  db.exec(`
    CREATE TABLE IF NOT EXISTS academic_calendar (
      calendar_id   INTEGER  PRIMARY KEY AUTOINCREMENT,
      academic_year TEXT     NOT NULL DEFAULT '',
      date          TEXT     NOT NULL DEFAULT '',
      day_type      TEXT     NOT NULL DEFAULT 'WORKING',
      event_name    TEXT     NOT NULL DEFAULT '',
      applies_to    TEXT     NOT NULL DEFAULT 'ALL',
      created_by    TEXT     NOT NULL DEFAULT '',
      UNIQUE (date, academic_year)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_cal_year_date ON academic_calendar (academic_year, date)"); } catch(_) {}

  // Seed dummy login accounts — adds each user only if username doesn't already exist
  (function seedUsers() {
    try {
      const bcrypt = require('bcryptjs');
      const users = [
        { username: 'director',    password: 'director123',  full_name: 'School Director',     role: 'super_admin', assigned_class: '' },
        { username: 'principal',   password: 'principal123', full_name: 'School Principal',    role: 'admin',       assigned_class: '' },
        { username: 'coordinator', password: 'coord123',     full_name: 'Section Coordinator', role: 'coordinator', assigned_class: '' },
        { username: 'manager',     password: 'manager123',   full_name: 'Deputy Manager',      role: 'manager',     assigned_class: '' },
        { username: 'staff',       password: 'staff123',     full_name: 'Office Executive',    role: 'staff',       assigned_class: '' },
        { username: 'teacher',     password: 'teacher123',   full_name: 'Class Teacher',       role: 'teacher',     assigned_class: 'Class 5' },
      ];
      const insert = db.prepare(
        'INSERT OR IGNORE INTO users (username, password_hash, full_name, role, assigned_class, is_active) VALUES (?,?,?,?,?,1)'
      );
      let added = 0;
      users.forEach(u => {
        try {
          const r = insert.run(u.username, bcrypt.hashSync(u.password, 10), u.full_name, u.role, u.assigned_class);
          if (r.changes > 0) added++;
        } catch(e) { console.error('[seed] Failed for ' + u.username + ':', e.message); }
      });
      if (added > 0) console.log('[DB] Added ' + added + ' new user(s)');
    } catch(e) { console.error('[seed] Error:', e.message); }
  })();

  console.log('[DB] Initialised:', DB_PATH);
}

// ── Create window ─────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'School Management System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:3000');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../../build/index.html'));
    win.removeMenu();
  }
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================
//  IPC HANDLERS
// ============================================================

// ── AUTH ─────────────────────────────────────────────────────
ipcMain.handle('auth:login', async (_evt, { username, password }) => {
  try {
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .get(username);

    if (!user) return { success: false, message: 'Invalid username or password.' };

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return { success: false, message: 'Invalid username or password.' };

    // Update last_login
    db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE user_id = ?")
      .run(user.user_id);

    return {
      success: true,
      user: {
        user_id: user.user_id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        assigned_class: user.assigned_class,
      },
    };
  } catch (err) {
    console.error('[auth:login]', err);
    return { success: false, message: 'Login error: ' + err.message };
  }
});

ipcMain.handle('auth:changePassword', async (_evt, { userId, oldPassword, newPassword }) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return { success: false, message: 'User not found.' };

    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) return { success: false, message: 'Current password is incorrect.' };

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(hash, userId);

    return { success: true };
  } catch (err) {
    console.error('[auth:changePassword]', err);
    return { success: false, message: 'Failed to change password.' };
  }
});

// ── USER MANAGEMENT (Admin only) ─────────────────────────────
ipcMain.handle('users:getAll', async () => {
  const rows = db.prepare(
    'SELECT user_id, username, full_name, role, assigned_class, is_active, created_at, last_login FROM users ORDER BY full_name'
  ).all();
  return { success: true, data: rows };
});

ipcMain.handle('users:create', async (_evt, { username, password, full_name, role, assigned_class }) => {
  try {
    const existing = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (existing) return { success: false, message: 'Username already taken.' };

    const hash = await bcrypt.hash(password, 10);
    const result = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role, assigned_class) VALUES (?,?,?,?,?)'
    ).run(username, hash, full_name, role, assigned_class || null);

    return { success: true, user_id: result.lastInsertRowid };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('users:toggle', (_evt, { userId, isActive }) => {
  db.prepare('UPDATE users SET is_active = ? WHERE user_id = ?').run(isActive ? 1 : 0, userId);
  return { success: true };
});

// ── ENROLLMENT (SR Register) ──────────────────────────────────
// ── Apply null-value defaults ────────────────────────────────
function applyDefaults(data) {
  // Strictly matches clean enrollment schema — no extra fields
  return {
    // System
    student_status:         data.student_status?.trim()        || 'ACTIVE',
    academic_year:          data.academic_year?.trim()         || '2025-26',
    // Student Identity
    student_name:           data.student_name?.trim()          || 'NOT PROVIDED',
    gender:                 data.gender?.trim()                || 'NOT PROVIDED',
    date_of_birth:          data.date_of_birth?.trim()         || '00-00-0000',
    indian_nationality:     data.indian_nationality?.trim()    || 'Yes',
    blood_group:            data.blood_group?.trim()           || 'NOT PROVIDED',
    mother_tongue:          data.mother_tongue?.trim()         || 'Hindi',
    aadhar_number:          data.aadhar_number?.replace(/\s/g,'') || '999999999999',
    aadhar_doc:             data.aadhar_doc                    || '',
    birth_cert:             data.birth_cert                    || 'No',
    birth_cert_doc:         data.birth_cert_doc                || '',
    // Parents / Guardian
    mother_name:            data.mother_name?.trim()           || 'NOT PROVIDED',
    mother_profession:      data.mother_profession             || 'Housewife',
    father_name:            data.father_name?.trim()           || 'NOT PROVIDED',
    father_profession:      data.father_profession             || 'Mazdoori',
    guardian_name:          data.guardian_name                 || '',
    contact_email:          data.contact_email                 || '',
    mobile_number:          data.mobile_number                 || '',
    alternate_mobile:       data.alternate_mobile              || '',
    // Address
    house_no:               data.house_no?.trim()              || 'NOT PROVIDED',
    village:                data.village?.trim()               || 'NOT PROVIDED',
    post:                   data.post?.trim()                  || 'NOT PROVIDED',
    district:               data.district?.trim()              || 'Bulandshahr',
    state_name:             data.state_name?.trim()            || 'Uttar Pradesh',
    pin_code:               data.pin_code?.trim()              || '203131',
    // Social Details
    category:               data.category?.trim()              || 'NOT PROVIDED',
    minority_group:         data.minority_group                || 'Not Applicable',
    bpl_beneficiary:        data.bpl_beneficiary               || 'No',
    ews_disadvantaged:      data.ews_disadvantaged             || 'No',
    cwsn:                   data.cwsn                          || 'No',
    impairment_type:        data.impairment_type               || '',
    disability_certificate: data.disability_certificate        || 'No',
    disability_cert_doc:    data.disability_cert_doc           || '',
    disability_percentage:  data.disability_percentage         || '',
    // Enrollment Number section
    pen_number:             data.pen_number?.trim()            || '11111111111',
    apaar_id:               data.apaar_id                      || '',
    rte_section_12c:        data.rte_section_12c               || 'No',
    rte_amount_claimed:     data.rte_amount_claimed            || '',
    // Admission Details
    date_of_admission:      data.date_of_admission?.trim()     || '00-00-0000',
    class_of_admission:     data.class_of_admission?.trim()    || 'NOT PROVIDED',
    current_class:          data.current_class?.trim()         || data.class_of_admission?.trim() || 'NOT PROVIDED',
    section:                data.section                       || 'A',
    medium_of_instruction:  data.medium_of_instruction         || 'English',
    studied_elsewhere:      data.studied_elsewhere             || 'No',
    tc_submitted:           data.tc_submitted                  || 'No',
    tc_doc:                 data.tc_doc                        || '',
    prev_year_status:       data.prev_year_status              || '',
    prev_year_class:        data.prev_year_class               || '',
    prev_enrollment_number: data.prev_enrollment_number        || '',
    prev_academic_year:     data.prev_academic_year            || '',
    prev_school_name:       data.prev_school_name              || 'NOT APPLICABLE',
    // Legacy SR register fields now collected in form
    religion:              data.religion?.trim()              || 'NOT PROVIDED',
    caste:                 data.caste?.trim()                 || 'NOT PROVIDED',
    // Subjects & Stream
    language_group:         data.language_group                || '',
    academic_stream:        data.academic_stream               || '',
    subject_group:          data.subject_group                 || '',
    // Submission tracking
    submitted_by:           data.submitted_by                  || '',
  };
}

ipcMain.handle('enrollment:add', (_evt, raw) => {
  try {
    const s = raw || {};

    // Build explicit object with named params — no applyDefaults dependency
    // submitted_by excluded — has DEFAULT '' in table, avoids any column issues
    const row = {
      student_name:           (s.student_name          || '').trim() || 'NOT PROVIDED',
      gender:                 (s.gender                || '').trim() || 'NOT PROVIDED',
      date_of_birth:          (s.date_of_birth         || '').trim() || '00-00-0000',
      indian_nationality:     (s.indian_nationality    || '').trim() || 'YES',
      blood_group:            (s.blood_group           || '').trim() || 'NOT PROVIDED',
      mother_tongue:          (s.mother_tongue         || '').trim() || 'Hindi',
      aadhar_number:          (s.aadhar_number         || '').replace(/\s/g,'') || '999999999999',
      aadhar_doc:              s.aadhar_doc            || '',
      birth_cert:              s.birth_cert            || 'No',
      birth_cert_doc:          s.birth_cert_doc        || '',
      mother_name:            (s.mother_name           || '').trim() || 'NOT PROVIDED',
      mother_profession:       s.mother_profession     || 'Housewife',
      father_name:            (s.father_name           || '').trim() || 'NOT PROVIDED',
      father_profession:       s.father_profession     || 'Mazdoori',
      guardian_name:           s.guardian_name         || '',
      contact_email:           s.contact_email         || '',
      mobile_number:           s.mobile_number         || '',
      alternate_mobile:        s.alternate_mobile      || '',
      house_no:               (s.house_no              || '').trim() || '',
      village:                (s.village               || '').trim() || 'NOT PROVIDED',
      post:                   (s.post                  || '').trim() || '',
      district:               (s.district              || '').trim() || 'Aligarh',
      state_name:             (s.state_name            || '').trim() || 'Uttar Pradesh',
      pin_code:               (s.pin_code              || '').trim() || '',
      category:               (s.category              || '').trim() || 'GENERAL',
      minority_group:          s.minority_group        || 'Not Applicable',
      bpl_beneficiary:         s.bpl_beneficiary       || 'No',
      ews_disadvantaged:       s.ews_disadvantaged     || 'No',
      cwsn:                    s.cwsn                  || 'No',
      impairment_type:         s.impairment_type       || '',
      disability_certificate:  s.disability_certificate || 'No',
      disability_cert_doc:     s.disability_cert_doc  || '',
      disability_percentage:   s.disability_percentage || '',
      pen_number:             (s.pen_number            || '').trim() || '',
      apaar_id:                s.apaar_id              || '',
      rte_section_12c:         s.rte_section_12c       || 'No',
      rte_amount_claimed:      s.rte_amount_claimed    || '',
      date_of_admission:      (s.date_of_admission     || '').trim() || '00-00-0000',
      class_of_admission:     (s.class_of_admission    || '').trim() || 'NOT PROVIDED',
      religion:               (s.religion              || '').trim() || 'NOT PROVIDED',
      caste:                  (s.caste                 || '').trim() || 'NOT PROVIDED',
      section:                 s.section               || 'A',
      medium_of_instruction:   s.medium_of_instruction || 'Hindi',
      studied_elsewhere:       s.studied_elsewhere     || 'No',
      tc_submitted:            s.tc_submitted          || 'No',
      tc_doc:                  s.tc_doc                || '',
      prev_year_status:        s.prev_year_status      || '',
      prev_year_class:         s.prev_year_class       || '',
      prev_enrollment_number:  s.prev_enrollment_number || '',
      prev_academic_year:      s.prev_academic_year    || '',
      prev_school_name:        s.prev_school_name      || '',
      language_group:          s.language_group        || '',
      academic_stream:         s.academic_stream       || '',
      subject_group:           s.subject_group         || '',
      academic_year:          (s.academic_year         || '').trim() || '2025-26',
    };

    const result = db.prepare(`
      INSERT INTO temp_admissions (
        student_name, gender, date_of_birth, indian_nationality,
        blood_group, mother_tongue, aadhar_number, aadhar_doc,
        birth_cert, birth_cert_doc,
        mother_name, mother_profession, father_name, father_profession,
        guardian_name, contact_email, mobile_number, alternate_mobile,
        house_no, village, post, district, state_name, pin_code,
        category, minority_group, bpl_beneficiary, ews_disadvantaged,
        cwsn, impairment_type, disability_certificate, disability_cert_doc, disability_percentage,
        pen_number, apaar_id, rte_section_12c, rte_amount_claimed,
        date_of_admission, class_of_admission,
        religion, caste, section, medium_of_instruction,
        studied_elsewhere, tc_submitted, tc_doc,
        prev_year_status, prev_year_class,
        prev_enrollment_number, prev_academic_year, prev_school_name,
        language_group, academic_stream, subject_group, academic_year
      ) VALUES (
        @student_name, @gender, @date_of_birth, @indian_nationality,
        @blood_group, @mother_tongue, @aadhar_number, @aadhar_doc,
        @birth_cert, @birth_cert_doc,
        @mother_name, @mother_profession, @father_name, @father_profession,
        @guardian_name, @contact_email, @mobile_number, @alternate_mobile,
        @house_no, @village, @post, @district, @state_name, @pin_code,
        @category, @minority_group, @bpl_beneficiary, @ews_disadvantaged,
        @cwsn, @impairment_type, @disability_certificate, @disability_cert_doc, @disability_percentage,
        @pen_number, @apaar_id, @rte_section_12c, @rte_amount_claimed,
        @date_of_admission, @class_of_admission,
        @religion, @caste, @section, @medium_of_instruction,
        @studied_elsewhere, @tc_submitted, @tc_doc,
        @prev_year_status, @prev_year_class,
        @prev_enrollment_number, @prev_academic_year, @prev_school_name,
        @language_group, @academic_stream, @subject_group, @academic_year
      )
    `).run(row);

    return { success: true, temp_id: result.lastInsertRowid };
  } catch (err) {
    return { success: false, message: err.message };
  }
})

ipcMain.handle('enrollment:getByClass', (_evt, { class: cls }) => {
  // Use LOWER() on both sides so 'Nursery', 'NURSERY', 'nursery' all match
  const rows = db.prepare(`
    SELECT * FROM enrollment
    WHERE LOWER(current_class) = LOWER(?)
    AND   student_status = 'ACTIVE'
    ORDER BY student_name
  `).all(cls);
  return { success: true, data: rows };
});

ipcMain.handle('enrollment:getById', (_evt, admissionNumber) => {
  const row = db.prepare('SELECT * FROM enrollment WHERE admission_number = ?').get(admissionNumber);
  return row ? { success: true, data: row } : { success: false, message: 'Student not found.' };
});

ipcMain.handle('enrollment:search', (_evt, query) => {
  const q = `%${query}%`;
  const rows = db.prepare(
    'SELECT * FROM enrollment WHERE student_name LIKE ? OR admission_number LIKE ? OR father_name LIKE ? ORDER BY student_name LIMIT 50'
  ).all(q, q, q);
  return { success: true, data: rows };
});

ipcMain.handle('enrollment:update', (_evt, { admission_number, ...data }) => {
  try {
    const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.prepare(
      `UPDATE enrollment SET ${fields}, updated_at = datetime('now','localtime') WHERE admission_number = @admission_number`
    ).run({ ...data, admission_number });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Edit student & record history ────────────────────────────
ipcMain.handle('enrollment:edit', (_evt, data) => {
  try {
    const {
      admission_number, edited_by,
      student_name, gender, date_of_birth, indian_nationality,
      blood_group, mother_tongue, aadhar_number, birth_cert,
      mother_name, mother_profession, father_name, father_profession,
      guardian_name, contact_email, mobile_number, alternate_mobile,
      house_no, village, post, district, state_name, pin_code,
      category, caste, religion, minority_group, bpl_beneficiary,
      ews_disadvantaged, cwsn, impairment_type, disability_certificate,
      disability_percentage, pen_number, apaar_id,
      date_of_admission, class_of_admission, current_class, section,
      medium_of_instruction, academic_year, studied_elsewhere,
      tc_submitted, prev_year_status, prev_year_class,
      prev_enrollment_number, prev_academic_year, prev_school_name,
      language_group, academic_stream, subject_group,
      rte_section_12c, rte_amount_claimed,
    } = data;

    // Get current record to compute diff
    const old = db.prepare('SELECT * FROM enrollment WHERE admission_number = ?').get(admission_number);
    if (!old) return { success: false, message: 'Student not found.' };

    const newData = {
      student_name, gender, date_of_birth, indian_nationality,
      blood_group, mother_tongue, aadhar_number, birth_cert,
      mother_name, mother_profession, father_name, father_profession,
      guardian_name, contact_email, mobile_number, alternate_mobile,
      house_no, village, post, district, state_name, pin_code,
      category, caste, religion, minority_group, bpl_beneficiary,
      ews_disadvantaged, cwsn, impairment_type, disability_certificate,
      disability_percentage, pen_number, apaar_id,
      date_of_admission, class_of_admission, current_class, section,
      medium_of_instruction, academic_year, studied_elsewhere,
      tc_submitted, prev_year_status, prev_year_class,
      prev_enrollment_number, prev_academic_year, prev_school_name,
      language_group, academic_stream, subject_group,
      rte_section_12c, rte_amount_claimed,
    };

    // Compute changes
    const changes = Object.entries(newData)
      .filter(([k, v]) => v !== undefined && String(v) !== String(old[k] ?? ''))
      .map(([k, v]) => ({ field: k, old: String(old[k] ?? ''), new: String(v) }));

    if (changes.length === 0) return { success: true, message: 'No changes detected.' };

    // Build dynamic UPDATE
    const fields = Object.keys(newData)
      .filter(k => newData[k] !== undefined)
      .map(k => `${k} = @${k}`)
      .join(', ');

    db.prepare(
      `UPDATE enrollment SET ${fields}, updated_at = datetime('now','localtime') WHERE admission_number = @admission_number`
    ).run({ ...newData, admission_number });

    // Log to edit_history
    db.prepare(`
      INSERT INTO edit_history (admission_number, student_name, edited_by, changes)
      VALUES (?, ?, ?, ?)
    `).run(admission_number, old.student_name, edited_by || 'admin', JSON.stringify(changes));

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get edit history for one student ─────────────────────────
ipcMain.handle('editHistory:getByStudent', (_evt, admissionNumber) => {
  try {
    const rows = db.prepare(`
      SELECT edited_by, edited_at, changes
      FROM edit_history
      WHERE admission_number = ?
      AND   admission_number != 'SYSTEM'
      ORDER BY edited_at DESC
    `).all(admissionNumber);
    return {
      success: true,
      data: rows.map(r => ({ ...r, changes: JSON.parse(r.changes || '[]') }))
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get all edit history (all students) ───────────────────────
ipcMain.handle('editHistory:getAll', () => {
  try {
    const rows = db.prepare(`
      SELECT admission_number, student_name, edited_by, edited_at, changes
      FROM edit_history
      WHERE admission_number != 'SYSTEM'
      ORDER BY edited_at DESC
      LIMIT 200
    `).all();
    return {
      success: true,
      data: rows.map(r => ({ ...r, changes: JSON.parse(r.changes || '[]') }))
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── DASHBOARD STATS ──────────────────────────────────────────
// ── BACKUP & RESTORE ─────────────────────────────────────────
ipcMain.handle('backup:create', async (_evt, targetDir) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const filename = `school_backup_${timestamp}.db`;
    const dest = path.join(targetDir || DATA_DIR, filename);

    // Use better-sqlite3's built-in backup
    await db.backup(dest);
    return { success: true, path: dest, filename };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('backup:restore', async (_evt, sourcePath) => {
  try {
    db.close();
    fs.copyFileSync(sourcePath, DB_PATH);
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return { success: true };
  } catch (err) {
    initDatabase(); // re-open even if restore failed
    return { success: false, message: err.message };
  }
});

ipcMain.handle('dialog:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:pickFile', async (_evt, filters) => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: filters || [] });
  return result.canceled ? null : result.filePaths[0];
});

// ============================================================
//  EXCEL IMPORT
// ============================================================

// Known DB columns for each importable table, with display labels and rules
const IMPORT_SCHEMAS = {
  enrollment: {
    label: 'Students (SR Register)',
    columns: [
      { key: 'student_name',       label: 'Student Name',        required: true  },
      { key: 'father_name',        label: "Father's Name",       required: true  },
      { key: 'mother_name',        label: "Mother's Name",       required: false },
      { key: 'gender',             label: 'Gender (M/F/Other)',  required: true  },
      { key: 'date_of_birth',      label: 'Date of Birth',       required: true  },
      { key: 'date_of_admission',  label: 'Date of Admission',   required: true  },
      { key: 'class_of_admission', label: 'Class of Admission',  required: true  },
      { key: 'current_class',      label: 'Current Class',       required: true  },
      { key: 'academic_year',      label: 'Academic Year',       required: true  },
      { key: 'aadhar_number',      label: 'Aadhar Number',       required: false },
      { key: 'pen_number',         label: 'PEN Number',          required: false },
      { key: 'father_phone',       label: "Father's Phone",      required: false },
      { key: 'mother_phone',       label: "Mother's Phone",      required: false },
      { key: 'blood_group',        label: 'Blood Group',         required: false },
      { key: 'religion',           label: 'Religion',            required: false },
      { key: 'caste',              label: 'Caste',               required: false },
      { key: 'category',           label: 'Category (GEN/SC/ST/OBC)', required: false },
      { key: 'address',            label: 'Address',             required: false },
      { key: 'prev_school_name',   label: 'Previous School',     required: false },
      { key: 'prev_sr_number',     label: 'Previous SR Number',  required: false },
    ],
  },

  fees_ledger: {
    label: 'Fees Ledger',
    columns: [
      { key: 'admission_number',      label: 'Admission Number',     required: true  },
      { key: 'student_name',          label: 'Student Name',         required: true  },
      { key: 'father_name',           label: "Father's Name",        required: false },
      { key: 'class',                 label: 'Class',                required: true  },
      { key: 'academic_year',         label: 'Academic Year',        required: true  },
      { key: 'month',                 label: 'Month (e.g. April 2025)', required: true },
      { key: 'monthly_tuition_fees',  label: 'Monthly Tuition (₹)',  required: true  },
      { key: 'transport_fees',        label: 'Transport Fees (₹)',   required: false },
      { key: 'concession',            label: 'Concession (₹)',       required: false },
      { key: 'prev_balance',          label: 'Previous Balance (₹)', required: false },
      { key: 'amount_paid_this_month',label: 'Amount Paid (₹)',      required: false },
      { key: 'total_due',             label: 'Total Due (₹)',        required: false },
      { key: 'payment_date',          label: 'Payment Date',         required: false },
      { key: 'receipt_number',        label: 'Receipt Number',       required: false },
      { key: 'address',               label: 'Address',              required: false },
    ],
  },
};

// ── Read Excel file → return headers + first 10 rows for preview ──
// ══════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ══════════════════════════════════════════════════════════════
ipcMain.handle('dashboard:stats', (_evt, params) => {
  // Safe defaults — handler won't crash if called with undefined
  const role         = params?.role         || 'staff';
  const teacherClass = params?.cls          || '';
  const submittedBy  = params?.submitted_by || '';

  try {
    const CLASS_ORDER = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3',
      'Class 4','Class 5','Class 6','Class 7','Class 8','Class 9',
      'Class 10','Class 11','Class 12'];

    // ── Core counts ──────────────────────────────────────────────
    const totalActive   = db.prepare("SELECT COUNT(*) as c FROM enrollment WHERE student_status = 'ACTIVE'").get().c;
    const totalPending  = db.prepare("SELECT COUNT(*) as c FROM enrollment WHERE student_status = 'PENDING'").get().c;
    const totalRejected = db.prepare("SELECT COUNT(*) as c FROM enrollment WHERE student_status = 'REJECTED'").get().c;
    const tcIssued      = db.prepare("SELECT COUNT(*) as c FROM enrollment WHERE tc_issued = 1").get().c;
    const totalUsers    = db.prepare("SELECT COUNT(*) as c FROM users WHERE is_active = 1").get().c;

    // ── Class-wise breakdown ─────────────────────────────────────
    // Note: using 'c' not 'cls' to avoid shadowing params.cls
    const classRows = db.prepare(`
      SELECT current_class,
        COUNT(*) as total,
        SUM(CASE WHEN gender = 'M' THEN 1 ELSE 0 END) as boys,
        SUM(CASE WHEN gender = 'F' THEN 1 ELSE 0 END) as girls
      FROM enrollment
      WHERE student_status = 'ACTIVE'
      GROUP BY current_class
    `).all();

    const classWise = CLASS_ORDER.map(c => {
      const found = classRows.find(r => r.current_class.toLowerCase() === c.toLowerCase());
      return found ? { ...found, current_class: c } : null;
    }).filter(Boolean);

    const totalBoys  = classWise.reduce((s, r) => s + (r.boys  || 0), 0);
    const totalGirls = classWise.reduce((s, r) => s + (r.girls || 0), 0);

    // ── Category breakdown ───────────────────────────────────────
    const categoryRows = db.prepare(`
      SELECT category, COUNT(*) as count
      FROM enrollment
      WHERE student_status = 'ACTIVE'
      GROUP BY category
    `).all();

    // ── Recent pending admissions ────────────────────────────────
    const recentPending = db.prepare(`
      SELECT admission_number, student_name, class_of_admission,
             created_at
      FROM enrollment
      WHERE student_status = 'PENDING'
      ORDER BY created_at ASC
      LIMIT 5
    `).all();

    // ── Staff's own submissions (only if submittedBy is set) ─────
    const myPending = submittedBy
      ? db.prepare(`
          SELECT admission_number, student_name, class_of_admission,
                 student_status, created_at, approved_at, rejected_reason
          FROM enrollment
          WHERE student_status IN ('PENDING','ACTIVE','REJECTED')
          ORDER BY created_at DESC
          LIMIT 10
        `).all()
      : [];

    // ── Teacher's selected class stats ───────────────────────────
    const teacherClassStats = teacherClass
      ? db.prepare(`
          SELECT COUNT(*) as total,
            SUM(CASE WHEN gender = 'M' THEN 1 ELSE 0 END) as boys,
            SUM(CASE WHEN gender = 'F' THEN 1 ELSE 0 END) as girls
          FROM enrollment
          WHERE LOWER(current_class) = LOWER(?)
          AND   student_status = 'ACTIVE'
        `).get(teacherClass)
      : null;

    return {
      success: true,
      data: {
        totalActive, totalPending, totalRejected, tcIssued,
        totalBoys, totalGirls, totalUsers,
        classWise, categoryRows, recentPending,
        myPending, teacherClassStats,
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});


// ══════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW
// ══════════════════════════════════════════════════════════════

// ── Get all pending admissions ────────────────────────────────
// ── Get pending admissions from temp_admissions ──────────────
ipcMain.handle('admission:getPending', () => {
  try {
    const rows = db.prepare(`
      SELECT temp_id, student_name, father_name, gender,
             date_of_birth, class_of_admission, section, date_of_admission,
             academic_year, submitted_by, submitted_at, village, mobile_number
      FROM temp_admissions
      ORDER BY submitted_at ASC
    `).all();
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get full details of one pending student ───────────────────
ipcMain.handle('admission:getForReview', (_evt, temp_id) => {
  try {
    const row = db.prepare(
      'SELECT * FROM temp_admissions WHERE temp_id = ?'
    ).get(temp_id);
    if (!row) return { success: false, message: 'Student not found in pending list' };
    return { success: true, data: row };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Edit pending student before approving ─────────────────────
ipcMain.handle('admission:editTemp', (_evt, data) => {
  try {
    const { temp_id } = data;
    db.prepare(`
      UPDATE temp_admissions SET
        student_name = @student_name, father_name = @father_name,
        mother_name  = @mother_name,  mobile_number = @mobile_number,
        date_of_birth = @date_of_birth, aadhar_number = @aadhar_number,
        village = @village, district = @district, pin_code = @pin_code,
        section = @section
      WHERE temp_id = @temp_id
    `).run(data);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Approve admission — copy to enrollment with real BPS number ─
ipcMain.handle('admission:approve', (_evt, { temp_id, approved_by }) => {
  try {
    // Get full student data from temp_admissions
    const student = db.prepare('SELECT * FROM temp_admissions WHERE temp_id = ?').get(temp_id);
    if (!student) return { success: false, message: 'Pending student not found' };

    // Session year from student's academic_year — "2025-26" → 2025
    const sessionYear = parseInt(student.academic_year?.split('-')[0]) ||
      (() => { const now = new Date(); const y = now.getFullYear(); return now.getMonth() >= 3 ? y : y - 1; })();

    // Find highest real BPS counter — only from enrollment (no TEMP/PENDING)
    // BPS format: BPS{YEAR}-{NNNN} e.g. BPS2025-0517
    // Counter always starts at position 9 (BPS + 4-digit year + dash = 8 chars)
    const lastReal = db.prepare(`
      SELECT admission_number FROM enrollment
      WHERE admission_number LIKE 'BPS${sessionYear}-%'
      AND   admission_number NOT LIKE '%-TEMP%'
      ORDER BY CAST(SUBSTR(admission_number, 9) AS INTEGER) DESC
      LIMIT 1
    `).get();

    let lastCounter = 0;
    if (lastReal) {
      const parts = lastReal.admission_number.split('-');
      lastCounter = parseInt(parts[parts.length - 1]) || 0;
    }

    const newAdmNumber = "BPS" + sessionYear + "-" + String(lastCounter + 1).padStart(4, '0');
    const approvedAt   = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Copy into enrollment with real admission number
    db.prepare(`
      INSERT INTO enrollment (
        admission_number, student_status, academic_year,
        student_name, gender, date_of_birth, indian_nationality,
        blood_group, mother_tongue, aadhar_number, aadhar_doc,
        birth_cert, birth_cert_doc,
        mother_name, mother_profession, father_name, father_profession,
        guardian_name, contact_email, mobile_number, alternate_mobile,
        house_no, village, post, district, state_name, pin_code,
        category, minority_group, bpl_beneficiary, ews_disadvantaged,
        cwsn, impairment_type, disability_certificate, disability_cert_doc, disability_percentage,
        pen_number, apaar_id, rte_section_12c, rte_amount_claimed,
        date_of_admission, class_of_admission, current_class,
        religion, caste, section, medium_of_instruction,
        studied_elsewhere, tc_submitted, tc_doc,
        prev_year_status, prev_year_class,
        prev_enrollment_number, prev_academic_year, prev_school_name,
        language_group, academic_stream, subject_group,
        submitted_by, approved_by, approved_at
      ) VALUES (
        @admission_number, 'ACTIVE', @academic_year,
        @student_name, @gender, @date_of_birth, @indian_nationality,
        @blood_group, @mother_tongue, @aadhar_number, @aadhar_doc,
        @birth_cert, @birth_cert_doc,
        @mother_name, @mother_profession, @father_name, @father_profession,
        @guardian_name, @contact_email, @mobile_number, @alternate_mobile,
        @house_no, @village, @post, @district, @state_name, @pin_code,
        @category, @minority_group, @bpl_beneficiary, @ews_disadvantaged,
        @cwsn, @impairment_type, @disability_certificate, @disability_cert_doc, @disability_percentage,
        @pen_number, @apaar_id, @rte_section_12c, @rte_amount_claimed,
        @date_of_admission, @class_of_admission, @class_of_admission,
        @religion, @caste, @section, @medium_of_instruction,
        @studied_elsewhere, @tc_submitted, @tc_doc,
        @prev_year_status, @prev_year_class,
        @prev_enrollment_number, @prev_academic_year, @prev_school_name,
        @language_group, @academic_stream, @subject_group,
        @submitted_by, @approved_by, @approved_at
      )
    `).run({ ...student, admission_number: newAdmNumber, approved_by, approved_at: approvedAt });

    // Remove from temp_admissions
    db.prepare('DELETE FROM temp_admissions WHERE temp_id = ?').run(temp_id);

    return { success: true, new_admission_number: newAdmNumber };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Reject admission — move to rejected_admissions ────────────
ipcMain.handle('admission:reject', (_evt, { temp_id, rejected_by, reason }) => {
  try {
    const student = db.prepare('SELECT * FROM temp_admissions WHERE temp_id = ?').get(temp_id);
    if (!student) return { success: false, message: 'Pending student not found' };

    db.prepare(`
      INSERT INTO rejected_admissions (
        student_name, gender, date_of_birth, father_name, mother_name,
        mobile_number, class_of_admission, section, academic_year,
        village, aadhar_number, pen_number, date_of_admission,
        submitted_by, submitted_at, rejected_by, rejected_reason
      ) VALUES (
        @student_name, @gender, @date_of_birth, @father_name, @mother_name,
        @mobile_number, @class_of_admission, @section, @academic_year,
        @village, @aadhar_number, @pen_number, @date_of_admission,
        @submitted_by, @submitted_at, @rejected_by, @rejected_reason
      )
    `).run({ ...student, rejected_by, rejected_reason: reason });

    db.prepare('DELETE FROM temp_admissions WHERE temp_id = ?').run(temp_id);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get rejected admissions ───────────────────────────────────
ipcMain.handle('admission:getRejected', () => {
  try {
    const rows = db.prepare(`
      SELECT reject_id, student_name, father_name, class_of_admission,
             section, academic_year, village, submitted_by, submitted_at,
             rejected_by, rejected_reason, rejected_at
      FROM rejected_admissions
      ORDER BY rejected_at DESC
    `).all();
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get approval history (approved students only) ─────────────
ipcMain.handle('admission:getHistory', () => {
  try {
    const rows = db.prepare(`
      SELECT admission_number, student_name, father_name, class_of_admission,
             section, academic_year, student_status,
             submitted_by, approved_by, approved_at
      FROM enrollment
      WHERE approved_by != ''
      AND   student_status = 'ACTIVE'
      ORDER BY rowid DESC
    `).all();
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});


// ══════════════════════════════════════════════════════════════
// EXCEL IMPORTER — preview, validate, import
// ══════════════════════════════════════════════════════════════

const VALID_CLASSES = new Set(['Nursery','LKG','UKG','Class 1','Class 2','Class 3',
  'Class 4','Class 5','Class 6','Class 7','Class 8','Class 9',
  'Class 10','Class 11','Class 12']);
const VALID_STATUS  = new Set(['ACTIVE','DROPBOX/TC','DROPBOX-MID SESSION']);
const VALID_MG      = new Set(['Not Applicable','Muslim','Christian','Sikh','Buddhist','Parsi','Jain']);
const VALID_YN      = new Set(['Yes','No']);
const DATE_RE       = /^\d{2}-\d{2}-\d{4}$/;

function validateRow(row) {
  const errs = [];
  if (!row.student_name)       errs.push('student_name is blank');
  if (!row.father_name)        errs.push('father_name is blank');
  if (!row.date_of_birth)      errs.push('date_of_birth is blank');
  if (!row.date_of_admission)  errs.push('date_of_admission is blank');
  if (!row.class_of_admission) errs.push('class_of_admission is blank');
  if (!row.admission_number)   errs.push('admission_number is blank');
  if (row.date_of_birth     && !DATE_RE.test(row.date_of_birth))
    errs.push(`date_of_birth wrong format: ${row.date_of_birth}`);
  if (row.date_of_admission && !DATE_RE.test(row.date_of_admission))
    errs.push(`date_of_admission wrong format: ${row.date_of_admission}`);
  if (row.admission_number  && !/^BPS\d{4}-\d{4}$/.test(row.admission_number))
    errs.push(`admission_number wrong format: ${row.admission_number}`);
  if (row.class_of_admission && !VALID_CLASSES.has(row.class_of_admission))
    errs.push(`class_of_admission invalid: ${row.class_of_admission}`);
  if (row.current_class && !VALID_CLASSES.has(row.current_class))
    errs.push(`current_class invalid: ${row.current_class}`);
  if (row.student_status && !VALID_STATUS.has(row.student_status))
    errs.push(`student_status invalid: ${row.student_status}`);
  if (row.gender && !['M','F','Other'].includes(row.gender))
    errs.push(`gender invalid: ${row.gender}`);
  if (row.aadhar_number && !/^\d{12}$/.test(String(row.aadhar_number).replace(/\s/g,'')))
    errs.push(`aadhar_number not 12 digits: ${row.aadhar_number}`);
  if (row.pen_number) {
    const p = String(row.pen_number).replace(/\.0$/, '');
    if (!/^\d{11}$/.test(p)) errs.push(`pen_number not 11 digits: ${row.pen_number}`);
  }
  ['birth_cert','bpl_beneficiary','ews_disadvantaged','cwsn',
   'disability_certificate','rte_section_12c','studied_elsewhere','tc_submitted'].forEach(col => {
    if (row[col] && !VALID_YN.has(row[col]))
      errs.push(`${col} must be Yes/No, got: ${row[col]}`);
  });
  if (row.minority_group && !VALID_MG.has(row.minority_group))
    errs.push(`minority_group invalid: ${row.minority_group}`);
  return errs;
}

function readExcel(filePath) {
  const wb      = XLSX.readFile(filePath, { raw: true });
  const ws      = wb.Sheets[wb.SheetNames[0]];
  const all     = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const headers = all[0].map(h => String(h).trim());
  const rows    = all.slice(1).filter(r => r.some(c => c !== ''));
  const parsed  = rows.map(r =>
    headers.reduce((obj, h, i) => {
      obj[h] = r[i] !== undefined ? String(r[i]).trim() : '';
      return obj;
    }, {})
  );
  return { headers, rows: parsed };
}

// ── 1. Preview ────────────────────────────────────────────────
ipcMain.handle('excel:preview', async (_evt, filePath) => {
  try {
    const { headers, rows } = readExcel(filePath);
    return {
      success:   true,
      headers,
      preview:   rows.slice(0, 10),
      totalRows: rows.length,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── 2. Validate ───────────────────────────────────────────────
ipcMain.handle('excel:validate', (_evt, filePath) => {
  try {
    const { headers, rows } = readExcel(filePath);

    const SCHEMA_COLS = [
      'admission_number','student_status','academic_year','created_at','updated_at',
      'student_name','gender','date_of_birth','indian_nationality','blood_group',
      'mother_tongue','aadhar_number','aadhar_doc','birth_cert','birth_cert_doc',
      'mother_name','mother_profession','father_name','father_profession',
      'guardian_name','contact_email','mobile_number','alternate_mobile',
      'house_no','village','post','district','state_name','pin_code',
      'category','minority_group','bpl_beneficiary','ews_disadvantaged',
      'cwsn','impairment_type','disability_certificate','disability_cert_doc','disability_percentage',
      'pen_number','apaar_id','rte_section_12c','rte_amount_claimed',
      'date_of_admission','class_of_admission','current_class','section','medium_of_instruction',
      'studied_elsewhere','tc_submitted','tc_doc',
      'prev_year_status','prev_year_class','prev_enrollment_number','prev_academic_year','prev_school_name',
      'language_group','academic_stream','subject_group','tc_issued'
    ];

    const colMissing = SCHEMA_COLS.filter(c => !headers.includes(c));
    const colExtra   = headers.filter(c => !SCHEMA_COLS.includes(c) && c !== '');

    // Duplicate admission numbers within file
    const seen = {}, adm_dupes = [];
    rows.forEach((r, i) => {
      const v = r.admission_number;
      if (v) {
        if (seen[v] !== undefined) adm_dupes.push({ row: i + 2, value: v });
        else seen[v] = i;
      }
    });

    // Row validation
    const errorRows = [];
    rows.forEach((row, idx) => {
      const errs = validateRow(row);
      if (errs.length > 0)
        errorRows.push({ row: idx + 2, admission_number: row.admission_number || '—', errors: errs });
    });

    // Conflict check — which admission numbers already exist in DB
    const conflicts = rows
      .filter(r => r.admission_number && db.prepare(
        'SELECT 1 FROM enrollment WHERE admission_number = ?'
      ).get(r.admission_number))
      .map(r => r.admission_number);

    return {
      success:    true,
      totalRows:  rows.length,
      colMissing,
      colExtra,
      adm_dupes,
      errorRows,
      conflicts,
      isClean: colMissing.length === 0 && colExtra.length === 0 &&
               adm_dupes.length === 0  && errorRows.length === 0,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── 3. Import ─────────────────────────────────────────────────
ipcMain.handle('excel:import', (evt, { filePath, skipDuplicates }) => {
  try {
    const { rows } = readExcel(filePath);
    let inserted = 0, skipped = 0, failed = 0;
    const failedRows = [];

    const insertStmt = db.prepare(`
      INSERT INTO enrollment (
        admission_number, student_status, academic_year,
        student_name, gender, date_of_birth, indian_nationality,
        blood_group, mother_tongue, aadhar_number, aadhar_doc,
        birth_cert, birth_cert_doc,
        mother_name, mother_profession, father_name, father_profession,
        guardian_name, contact_email, mobile_number, alternate_mobile,
        house_no, village, post, district, state_name, pin_code,
        category, minority_group, bpl_beneficiary, ews_disadvantaged,
        cwsn, impairment_type, disability_certificate, disability_cert_doc, disability_percentage,
        pen_number, apaar_id, rte_section_12c, rte_amount_claimed,
        date_of_admission, class_of_admission, current_class,
        religion, caste,
        section, medium_of_instruction,
        studied_elsewhere, tc_submitted, tc_doc,
        prev_year_status, prev_year_class, prev_enrollment_number, prev_academic_year, prev_school_name,
        language_group, academic_stream, subject_group, tc_issued
      ) VALUES (
        @admission_number, @student_status, @academic_year,
        @student_name, @gender, @date_of_birth, @indian_nationality,
        @blood_group, @mother_tongue, @aadhar_number, @aadhar_doc,
        @birth_cert, @birth_cert_doc,
        @mother_name, @mother_profession, @father_name, @father_profession,
        @guardian_name, @contact_email, @mobile_number, @alternate_mobile,
        @house_no, @village, @post, @district, @state_name, @pin_code,
        @category, @minority_group, @bpl_beneficiary, @ews_disadvantaged,
        @cwsn, @impairment_type, @disability_certificate, @disability_cert_doc, @disability_percentage,
        @pen_number, @apaar_id, @rte_section_12c, @rte_amount_claimed,
        @date_of_admission, @class_of_admission, @current_class,
        @religion, @caste,
        @section, @medium_of_instruction,
        @studied_elsewhere, @tc_submitted, @tc_doc,
        @prev_year_status, @prev_year_class, @prev_enrollment_number, @prev_academic_year, @prev_school_name,
        @language_group, @academic_stream, @subject_group, @tc_issued
      )
    `);

    const importAll = db.transaction(() => {
      rows.forEach((raw, idx) => {
        const exists = raw.admission_number &&
          db.prepare('SELECT 1 FROM enrollment WHERE admission_number = ?')
            .get(raw.admission_number);

        if (exists) {
          skipped++;
          return;
        }

        const data            = applyDefaults(raw);
        data.admission_number = raw.admission_number;
        data.pen_number       = String(data.pen_number || '').replace(/\.0$/, '');
        data.aadhar_number    = String(data.aadhar_number || '').replace(/\.0$/, '');
        data.tc_issued        = parseInt(raw.tc_issued) || 0;

        try {
          insertStmt.run(data);
          inserted++;
        } catch (err) {
          failed++;
          failedRows.push({ row: idx + 2, admission_number: raw.admission_number, error: err.message });
        }

        if ((idx + 1) % 50 === 0 || idx === rows.length - 1) {
          evt.sender.send('excel:progress', { current: idx + 1, total: rows.length });
        }
      });
    });

    importAll();
    return { success: true, inserted, skipped, failed, failedRows, total: rows.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
});


// ── Get student's full ledger for a year ──────────────────────
ipcMain.handle('fees:getLedger', (_evt, { admission_number, academic_year }) => {
  try {
    const student = db.prepare('SELECT * FROM enrollment WHERE admission_number = ?').get(admission_number);
    if (!student) return { success: false, message: 'Student not found.' };

    const entries = db.prepare(
      'SELECT * FROM fees_ledger WHERE admission_number = ? AND academic_year = ? ORDER BY ledger_id'
    ).all(admission_number, academic_year);

    // Total summary
    const summary = db.prepare(`
      SELECT
        SUM(total_due)              as total_billed,
        SUM(amount_paid_this_month) as total_paid,
        SUM(total_due - amount_paid_this_month) as total_pending
      FROM fees_ledger
      WHERE admission_number = ? AND academic_year = ?
    `).get(admission_number, academic_year);

    return { success: true, student, entries, summary };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Add / update a monthly fee entry ─────────────────────────
ipcMain.handle('fees:addEntry', (_evt, data) => {
  try {
    // Check if entry for this month already exists
    const existing = db.prepare(
      'SELECT ledger_id FROM fees_ledger WHERE admission_number = ? AND month = ? AND academic_year = ?'
    ).get(data.admission_number, data.month, data.academic_year);

    if (existing) {
      // Update
      db.prepare(`
        UPDATE fees_ledger SET
          monthly_tuition_fees   = @monthly_tuition_fees,
          transport_fees         = @transport_fees,
          concession             = @concession,
          prev_balance           = @prev_balance,
          prev_deposit           = @prev_deposit,
          total_due              = @total_due,
          amount_paid_this_month = @amount_paid_this_month,
          payment_date           = @payment_date,
          address                = @address
        WHERE ledger_id = @ledger_id
      `).run({ ...data, ledger_id: existing.ledger_id });
      return { success: true, ledger_id: existing.ledger_id, updated: true };
    }

    // Generate ledger number
    const count = (db.prepare('SELECT COUNT(*) as c FROM fees_ledger').get().c || 0) + 1;
    const ledger_number = `LDG-${data.academic_year}-${String(count).padStart(4, '0')}`;

    const result = db.prepare(`
      INSERT INTO fees_ledger (
        new_ledger_number, admission_number, student_name, father_name,
        class, address, academic_year, month,
        prev_balance, prev_deposit,
        monthly_tuition_fees, transport_fees, concession,
        total_due, amount_paid_this_month, payment_date
      ) VALUES (
        @new_ledger_number, @admission_number, @student_name, @father_name,
        @class, @address, @academic_year, @month,
        @prev_balance, @prev_deposit,
        @monthly_tuition_fees, @transport_fees, @concession,
        @total_due, @amount_paid_this_month, @payment_date
      )
    `).run({ ...data, new_ledger_number: ledger_number });

    return { success: true, ledger_id: result.lastInsertRowid };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Collect a payment → update ledger + generate receipt ─────
ipcMain.handle('fees:collectPayment', (_evt, { ledger_id, amount_paid, payment_mode, payment_date }) => {
  try {
    const entry = db.prepare('SELECT * FROM fees_ledger WHERE ledger_id = ?').get(ledger_id);
    if (!entry) return { success: false, message: 'Ledger entry not found.' };

    const receipt_number = generateReceiptNumber();

    db.prepare(`
      UPDATE fees_ledger SET
        amount_paid_this_month = amount_paid_this_month + @amount_paid,
        payment_date           = @payment_date,
        receipt_number         = @receipt_number
      WHERE ledger_id = @ledger_id
    `).run({ amount_paid, payment_date, receipt_number, ledger_id });

    const updated = db.prepare('SELECT * FROM fees_ledger WHERE ledger_id = ?').get(ledger_id);
    const student = db.prepare('SELECT * FROM enrollment WHERE admission_number = ?').get(entry.admission_number);

    return { success: true, receipt_number, entry: updated, student };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get all students with pending fees ───────────────────────
ipcMain.handle('fees:getPending', (_evt, { academic_year, class: cls }) => {
  try {
    let sql = `
      SELECT
        f.ledger_id, f.admission_number, f.student_name, f.father_name,
        f.class, f.address, f.month, f.academic_year,
        f.monthly_tuition_fees, f.transport_fees, f.concession,
        f.total_due, f.amount_paid_this_month,
        (f.total_due - f.amount_paid_this_month) as remaining,
        f.payment_date, f.receipt_number,
        e.father_phone, e.mother_phone
      FROM fees_ledger f
      LEFT JOIN enrollment e ON e.admission_number = f.admission_number
      WHERE f.academic_year = ?
        AND (f.total_due - f.amount_paid_this_month) > 0
    `;
    const params = [academic_year];
    if (cls) { sql += ' AND f.class = ?'; params.push(cls); }
    sql += ' ORDER BY f.class, f.student_name';

    const rows = db.prepare(sql).all(...params);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Search students for fees receipt ────────────────────────
ipcMain.handle('fees:searchStudent', (_evt, { query, academic_year }) => {
  try {
    const q = `%${query}%`;
    // Get latest ledger entry per student
    const rows = db.prepare(`
      SELECT
        e.admission_number, e.student_name, e.father_name, e.current_class,
        e.father_phone, e.address,
        COALESCE(SUM(f.total_due - f.amount_paid_this_month), 0) as total_pending,
        MAX(f.payment_date) as last_payment_date
      FROM enrollment e
      LEFT JOIN fees_ledger f ON f.admission_number = e.admission_number AND f.academic_year = ?
      WHERE (e.student_name LIKE ? OR e.admission_number LIKE ? OR e.father_name LIKE ?)
        AND e.tc_issued = 0
      GROUP BY e.admission_number
      ORDER BY e.student_name
      LIMIT 20
    `).all(academic_year, q, q, q);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get month-wise ledger for receipt view ───────────────────
ipcMain.handle('fees:getMonthLedger', (_evt, { admission_number, academic_year }) => {
  try {
    const entries = db.prepare(`
      SELECT *, (total_due - amount_paid_this_month) as remaining
      FROM fees_ledger
      WHERE admission_number = ? AND academic_year = ?
      ORDER BY ledger_id
    `).all(admission_number, academic_year);
    return { success: true, data: entries };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ══════════════════════════════════════════════════════════════
// ROLL NUMBER HANDLERS
// ══════════════════════════════════════════════════════════════

// ── Get dynamic roll numbers for a class (calculated on the fly) ──
ipcMain.handle('rollNumbers:getDynamic', (_evt, { class: cls, section, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT
        admission_number,
        student_name,
        current_class,
        section,
        gender,
        date_of_birth,
        father_name,
        mobile_number,
        category,
        ROW_NUMBER() OVER (
          PARTITION BY current_class, section
          ORDER BY student_name ASC
        ) AS roll_number
      FROM enrollment
      WHERE LOWER(current_class) = LOWER(?)
      AND   (section = ? OR ? = '')
      AND   student_status = 'ACTIVE'
      ORDER BY student_name ASC
    `).all(cls, section || '', section || '');
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Check if frozen roll numbers exist for a class/year ──────
ipcMain.handle('rollNumbers:checkFrozen', (_evt, { class: cls, section, academic_year }) => {
  try {
    const count = db.prepare(`
      SELECT COUNT(*) as c FROM roll_numbers
      WHERE LOWER(class) = LOWER(?)
      AND   section      = ?
      AND   academic_year = ?
    `).get(cls, section || 'A', academic_year).c;
    return { success: true, exists: count > 0, count };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Assign (freeze) roll numbers for one class/section/year ──
ipcMain.handle('rollNumbers:assignClass', (_evt, { class: cls, section, academic_year, assigned_by }) => {
  try {
    // Get students sorted alphabetically
    const students = db.prepare(`
      SELECT admission_number, student_name
      FROM enrollment
      WHERE LOWER(current_class) = LOWER(?)
      AND   section       = ?
      AND   student_status = 'ACTIVE'
      ORDER BY student_name ASC
    `).all(cls, section || 'A');

    if (students.length === 0)
      return { success: false, message: `No active students found in ${cls} ${section}` };

    // Delete existing roll numbers for this class/section/year first
    db.prepare(`
      DELETE FROM roll_numbers
      WHERE LOWER(class) = LOWER(?)
      AND   section       = ?
      AND   academic_year = ?
    `).run(cls, section || 'A', academic_year);

    // Insert fresh roll numbers in alphabetical order
    const insert = db.prepare(`
      INSERT INTO roll_numbers
        (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `);

    const assignAll = db.transaction(() => {
      students.forEach((s, idx) => {
        insert.run(s.admission_number, s.student_name, cls, section || 'A', academic_year, idx + 1);
      });
    });

    assignAll();
    return { success: true, assigned: students.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Assign roll numbers for ALL classes at once ───────────────
ipcMain.handle('rollNumbers:assignAll', (_evt, { academic_year, assigned_by }) => {
  try {
    // Get all unique class+section combinations with active students
    const classes = db.prepare(`
      SELECT DISTINCT current_class, section
      FROM enrollment
      WHERE student_status = 'ACTIVE'
      ORDER BY current_class, section
    `).all();

    let totalAssigned = 0;
    const results = [];

    classes.forEach(({ current_class, section }) => {
      const students = db.prepare(`
        SELECT admission_number, student_name
        FROM enrollment
        WHERE LOWER(current_class) = LOWER(?)
        AND   section       = ?
        AND   student_status = 'ACTIVE'
        ORDER BY student_name ASC
      `).all(current_class, section);

      // Clear old and insert fresh
      db.prepare(`
        DELETE FROM roll_numbers
        WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
      `).run(current_class, section, academic_year);

      const insert = db.prepare(`
        INSERT INTO roll_numbers
          (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `);

      students.forEach((s, idx) => {
        insert.run(s.admission_number, s.student_name, current_class, section, academic_year, idx + 1);
      });

      totalAssigned += students.length;
      results.push({ class: current_class, section, count: students.length });
    });

    return { success: true, totalAssigned, classes: results };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get frozen roll numbers for a class/section/year ─────────
ipcMain.handle('rollNumbers:getFrozen', (_evt, { class: cls, section, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT r.roll_number, r.admission_number, r.student_name,
             r.is_mid_year, r.assigned_at,
             e.gender, e.date_of_birth, e.father_name,
             e.mobile_number, e.category, e.section
      FROM roll_numbers r
      LEFT JOIN enrollment e ON r.admission_number = e.admission_number
      WHERE LOWER(r.class) = LOWER(?)
      AND   r.section       = ?
      AND   r.academic_year = ?
      ORDER BY r.roll_number ASC
    `).all(cls, section || 'A', academic_year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Add mid-year student (appends to end of list) ─────────────
ipcMain.handle('rollNumbers:addMidYear', (_evt, { admission_number, class: cls, section, academic_year }) => {
  try {
    // Check if already has a roll number in this class/year
    const existing = db.prepare(`
      SELECT roll_number FROM roll_numbers
      WHERE admission_number = ? AND academic_year = ?
    `).get(admission_number, academic_year);
    if (existing)
      return { success: false, message: 'Student already has a roll number for this year.' };

    // Get student details
    const student = db.prepare(
      'SELECT student_name FROM enrollment WHERE admission_number = ?'
    ).get(admission_number);
    if (!student) return { success: false, message: 'Student not found.' };

    // Get highest current roll number for this class/section/year
    const max = db.prepare(`
      SELECT MAX(roll_number) as max FROM roll_numbers
      WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
    `).get(cls, section || 'A', academic_year);

    const nextRoll = (max?.max || 0) + 1;

    db.prepare(`
      INSERT INTO roll_numbers
        (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(admission_number, student.student_name, cls, section || 'A', academic_year, nextRoll);

    return { success: true, roll_number: nextRoll };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get a student's roll number ───────────────────────────────
ipcMain.handle('rollNumbers:getForStudent', (_evt, { admission_number, academic_year }) => {
  try {
    const row = db.prepare(`
      SELECT roll_number, class, section FROM roll_numbers
      WHERE admission_number = ? AND academic_year = ?
    `).get(admission_number, academic_year);
    return { success: true, data: row || null };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Summary: all classes with roll number status ──────────────
ipcMain.handle('rollNumbers:getSummary', (_evt, academic_year) => {
  try {
    // All active class+section combos
    const active = db.prepare(`
      SELECT current_class as class, section, COUNT(*) as student_count
      FROM enrollment
      WHERE student_status = 'ACTIVE'
      GROUP BY current_class, section
      ORDER BY current_class, section
    `).all();

    // Which ones have frozen roll numbers
    const frozen = db.prepare(`
      SELECT class, section, COUNT(*) as roll_count, MAX(assigned_at) as last_assigned
      FROM roll_numbers
      WHERE academic_year = ?
      GROUP BY class, section
    `).all(academic_year);

    const frozenMap = {};
    frozen.forEach(f => { frozenMap[`${f.class}_${f.section}`] = f; });

    const summary = active.map(a => {
      const key  = `${a.class}_${a.section}`;
      const f    = frozenMap[key];
      return {
        class:          a.class,
        section:        a.section,
        student_count:  a.student_count,
        is_assigned:    !!f,
        roll_count:     f?.roll_count || 0,
        last_assigned:  f?.last_assigned || null,
      };
    });

    return { success: true, data: summary };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ══════════════════════════════════════════════════════════════
// STUDENT PROMOTION HANDLERS
// ══════════════════════════════════════════════════════════════

const CLASS_SEQUENCE = [
  'Nursery','LKG','UKG',
  'Class 1','Class 2','Class 3','Class 4','Class 5',
  'Class 6','Class 7','Class 8','Class 9','Class 10',
  'Class 11','Class 12'
];

function getNextClass(current) {
  const idx = CLASS_SEQUENCE.findIndex(
    c => c.toLowerCase() === current?.toLowerCase()
  );
  if (idx === -1) return null;
  if (idx === CLASS_SEQUENCE.length - 1) return 'PASSED OUT';
  return CLASS_SEQUENCE[idx + 1];
}

ipcMain.handle('promotion:preview', (_evt, { from_year, to_year }) => {
  try {
    const students = db.prepare(`
      SELECT admission_number, student_name, current_class, section, academic_year
      FROM enrollment WHERE student_status = 'ACTIVE'
      ORDER BY current_class, student_name
    `).all();
    const classMap = {};
    students.forEach(s => {
      const key = s.current_class || 'Unknown';
      if (!classMap[key]) classMap[key] = [];
      classMap[key].push(s);
    });
    const preview = CLASS_SEQUENCE.filter(c => classMap[c]).map(c => ({
      current_class: c, next_class: getNextClass(c),
      count: classMap[c].length, students: classMap[c],
    }));
    Object.keys(classMap).forEach(c => {
      if (!CLASS_SEQUENCE.includes(c)) {
        preview.push({ current_class: c, next_class: null,
          count: classMap[c].length, students: classMap[c],
          warning: 'Class not in sequence — will be skipped' });
      }
    });
    return { success: true, total: students.length, preview, from_year, to_year };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('promotion:execute', (_evt, { to_year, excluded = [], promoted_by }) => {
  try {
    const students = db.prepare(
      "SELECT admission_number, current_class FROM enrollment WHERE student_status = 'ACTIVE'"
    ).all();
    let promoted = 0, passedOut = 0, skipped = 0, excluded_ct = 0;
    const updateClass = db.prepare(
      "UPDATE enrollment SET current_class = ?, academic_year = ?, updated_at = datetime('now','localtime') WHERE admission_number = ?"
    );
    const updatePassedOut = db.prepare(
      "UPDATE enrollment SET current_class = 'PASSED OUT', student_status = 'PASSED OUT', academic_year = ?, updated_at = datetime('now','localtime') WHERE admission_number = ?"
    );
    const doAll = db.transaction(() => {
      students.forEach(s => {
        if (excluded.includes(s.admission_number)) { excluded_ct++; return; }
        const next = getNextClass(s.current_class);
        if (!next) { skipped++; return; }
        if (next === 'PASSED OUT') { updatePassedOut.run(to_year, s.admission_number); passedOut++; }
        else { updateClass.run(next, to_year, s.admission_number); promoted++; }
      });
    });
    doAll();
    try {
      db.prepare("INSERT INTO edit_history (admission_number, student_name, edited_by, changes) VALUES ('SYSTEM', 'BULK PROMOTION', ?, ?)")
        .run(promoted_by || 'admin', JSON.stringify([{ field: 'Bulk Promotion', old: 'Previous year', new: `Promoted to ${to_year} — ${promoted} promoted, ${passedOut} passed out, ${excluded_ct} excluded` }]));
    } catch(_) {}
    return { success: true, promoted, passedOut, skipped, excluded: excluded_ct };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('promotion:getHistory', () => {
  try {
    const rows = db.prepare(
      "SELECT edited_by, edited_at, changes FROM edit_history WHERE admission_number = 'SYSTEM' ORDER BY edited_at DESC"
    ).all();
    return { success: true, data: rows.map(r => ({ ...r, changes: JSON.parse(r.changes || '[]') })) };
  } catch (err) { return { success: false, message: err.message }; }
});

// ══════════════════════════════════════════════════════════════
// DAILY ATTENDANCE HANDLERS
// ══════════════════════════════════════════════════════════════



// ── Get students for a class (for marking attendance) ─────────
ipcMain.handle('attendance:getStudents', (_evt, { class: cls, section, academic_year }) => {
  try {
    const students = db.prepare(`
      SELECT e.admission_number, e.student_name, e.father_name, e.gender,
             COALESCE(r.roll_number, ROW_NUMBER() OVER (ORDER BY e.student_name)) as roll_number
      FROM enrollment e
      LEFT JOIN roll_numbers r
        ON r.admission_number = e.admission_number
        AND LOWER(r.class) = LOWER(e.current_class)
        AND r.section = e.section
        AND r.academic_year = ?
      WHERE LOWER(e.current_class) = LOWER(?)
      AND   e.section       = ?
      AND   e.student_status = 'ACTIVE'
      ORDER BY roll_number, e.student_name
    `).all(academic_year, cls, section);
    return { success: true, data: students };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get attendance for a class on a specific date ─────────────
ipcMain.handle('attendance:getByDate', (_evt, { class: cls, section, date }) => {
  try {
    const rows = db.prepare(`
      SELECT admission_number, student_name, status, marked_by, marked_at
      FROM attendance_daily
      WHERE LOWER(class) = LOWER(?) AND section = ? AND date = ?
      ORDER BY admission_number
    `).all(cls, section, date);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Mark attendance for a full class on a date ────────────────
ipcMain.handle('attendance:markDay', (_evt, { class: cls, section, date, academic_year, records, marked_by }) => {
  try {
    const upsert = db.prepare(`
      INSERT INTO attendance_daily
        (admission_number, student_name, class, section, date, academic_year, status, marked_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(admission_number, date)
      DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by,
                    marked_at = datetime('now','localtime')
    `);
    const markAll = db.transaction(() => {
      records.forEach(r => {
        upsert.run(r.admission_number, r.student_name, cls, section, date, academic_year, r.status, marked_by || 'admin');
      });
    });
    markAll();
    return { success: true, count: records.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get monthly summary for a class ──────────────────────────
ipcMain.handle('attendance:getMonthly', (_evt, { class: cls, section, month, year, academic_year }) => {
  try {
    // month = "06", year = "2025" (from date DD-MM-YYYY, positions 4-5 and 7-10)
    const rows = db.prepare(`
      SELECT
        admission_number,
        student_name,
        COUNT(*) as total_days,
        SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as present,
        SUM(CASE WHEN status = 'Absent'  THEN 1 ELSE 0 END) as absent,
        SUM(CASE WHEN status = 'Late'    THEN 1 ELSE 0 END) as late,
        ROUND(
          (SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END) * 100.0) / COUNT(*),
          1
        ) as percentage
      FROM attendance_daily
      WHERE LOWER(class) = LOWER(?)
      AND   section       = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
      AND   academic_year = ?
      GROUP BY admission_number, student_name
      ORDER BY student_name
    `).all(cls, section, month, year, academic_year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get day-by-day grid for a class/month ────────────────────
ipcMain.handle('attendance:getDailyGrid', (_evt, { class: cls, section, month, year, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT admission_number, student_name, date, status
      FROM attendance_daily
      WHERE LOWER(class) = LOWER(?)
      AND   section       = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
      AND   academic_year = ?
      ORDER BY student_name, date
    `).all(cls, section, month, year, academic_year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get low attendance students ───────────────────────────────
ipcMain.handle('attendance:getLowAttendance', (_evt, { academic_year, threshold = 75 }) => {
  try {
    const rows = db.prepare(`
      SELECT
        admission_number,
        student_name,
        class,
        section,
        COUNT(*) as total_days,
        SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END) as attended,
        ROUND(
          (SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END) * 100.0) / COUNT(*),
          1
        ) as percentage
      FROM attendance_daily
      WHERE academic_year = ?
      GROUP BY admission_number, student_name, class, section
      HAVING percentage < ?
      ORDER BY percentage ASC
    `).all(academic_year, threshold);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get marked dates for a class/month (to show which days done) ──
ipcMain.handle('attendance:getMarkedDates', (_evt, { class: cls, section, month, year }) => {
  try {
    const rows = db.prepare(`
      SELECT DISTINCT date
      FROM attendance_daily
      WHERE LOWER(class) = LOWER(?)
      AND   section = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
      ORDER BY date
    `).all(cls, section, month, year);
    return { success: true, data: rows.map(r => r.date) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Lock attendance for a class/date ─────────────────────────
ipcMain.handle('attendance:lockDay', (_evt, { class: cls, section, date, locked_by }) => {
  try {
    db.prepare(`
      INSERT INTO attendance_locks (class, section, date, locked_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(class, section, date) DO UPDATE SET
        locked_by = excluded.locked_by,
        locked_at = datetime('now','localtime')
    `).run(cls, section, date, locked_by || 'admin');
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Unlock attendance ─────────────────────────────────────────
ipcMain.handle('attendance:unlockDay', (_evt, { class: cls, section, date }) => {
  try {
    db.prepare(`
      DELETE FROM attendance_locks WHERE class = ? AND section = ? AND date = ?
    `).run(cls, section, date);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Check if a date is locked ─────────────────────────────────
ipcMain.handle('attendance:checkLocked', (_evt, { class: cls, section, date }) => {
  try {
    const row = db.prepare(`
      SELECT locked_by, locked_at FROM attendance_locks
      WHERE LOWER(class) = LOWER(?) AND section = ? AND date = ?
    `).get(cls, section, date);
    return { success: true, locked: !!row, locked_by: row?.locked_by, locked_at: row?.locked_at };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get locked dates for a class/month ───────────────────────
ipcMain.handle('attendance:getLockedDates', (_evt, { class: cls, section, month, year }) => {
  try {
    const rows = db.prepare(`
      SELECT date, locked_by, locked_at FROM attendance_locks
      WHERE LOWER(class) = LOWER(?)
      AND   section = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
    `).all(cls, section, month, year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ══════════════════════════════════════════════════════════════
// ACADEMIC CALENDAR HANDLERS
// ══════════════════════════════════════════════════════════════

// ── Get all calendar entries for a month ─────────────────────
ipcMain.handle('calendar:getMonth', (_evt, { academic_year, month, year }) => {
  try {
    const rows = db.prepare(`
      SELECT date, day_type, event_name, applies_to, created_by
      FROM academic_calendar
      WHERE academic_year = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
      ORDER BY CAST(SUBSTR(date, 1, 2) AS INTEGER)
    `).all(academic_year, month, year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Set a single day ──────────────────────────────────────────
ipcMain.handle('calendar:setDay', (_evt, { academic_year, date, day_type, event_name, applies_to, created_by }) => {
  try {
    if (day_type === 'WORKING') {
      // Removing a holiday — just delete the entry (working is the default)
      db.prepare('DELETE FROM academic_calendar WHERE date = ? AND academic_year = ?')
        .run(date, academic_year);
    } else {
      // Delete first then insert (avoids ON CONFLICT compatibility issues)
      db.prepare('DELETE FROM academic_calendar WHERE date = ? AND academic_year = ?')
        .run(date, academic_year);
      db.prepare(`
        INSERT INTO academic_calendar (academic_year, date, day_type, event_name, applies_to, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(academic_year, date, day_type, event_name || '', applies_to || 'ALL', created_by || 'admin');
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Mark a range of dates (vacation periods) ─────────────────
ipcMain.handle('calendar:markRange', (_evt, { academic_year, from_date, to_date, day_type, event_name, applies_to, created_by }) => {
  try {
    // Parse DD-MM-YYYY dates
    const parseDate = (s) => {
      const [d, m, y] = s.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    const formatDate = (dt) =>
      `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;

    const start = parseDate(from_date);
    const end   = parseDate(to_date);

    if (isNaN(start) || isNaN(end) || start > end)
      return { success: false, message: 'Invalid date range.' };

    const delStmt    = db.prepare('DELETE FROM academic_calendar WHERE date = ? AND academic_year = ?');
    const insertStmt = db.prepare(`
      INSERT INTO academic_calendar (academic_year, date, day_type, event_name, applies_to, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const upsert = { run: (yr, dt, type, name, applies, by) => {
      delStmt.run(dt, yr);
      insertStmt.run(yr, dt, type, name, applies, by);
    }};

    let count = 0;
    const markAll = db.transaction(() => {
      const cur = new Date(start);
      while (cur <= end) {
        // Skip Sundays (day 0) — they are auto-handled
        if (cur.getDay() !== 0) {
          upsert.run(academic_year, formatDate(cur), day_type, event_name || '', applies_to || 'ALL', created_by || 'admin');
          count++;
        }
        cur.setDate(cur.getDate() + 1);
      }
    });
    markAll();

    return { success: true, count };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Clear a range (reset to working days) ─────────────────────
ipcMain.handle('calendar:clearRange', (_evt, { academic_year, from_date, to_date }) => {
  try {
    const parseDate = (s) => { const [d,m,y] = s.split('-').map(Number); return new Date(y,m-1,d); };
    const formatDate = (dt) => `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
    const start = parseDate(from_date);
    const end   = parseDate(to_date);
    const del   = db.prepare('DELETE FROM academic_calendar WHERE date = ? AND academic_year = ?');
    const delAll = db.transaction(() => {
      const cur = new Date(start);
      while (cur <= end) { del.run(formatDate(cur), academic_year); cur.setDate(cur.getDate()+1); }
    });
    delAll();
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get working days count for a month (for attendance %) ─────
ipcMain.handle('calendar:getWorkingDays', (_evt, { academic_year, month, year }) => {
  try {
    // Count all days in month that are NOT Sunday AND NOT in calendar as non-working
    const y = parseInt(year), m = parseInt(month);
    const daysInMonth = new Date(y, m, 0).getDate();
    let workingDays = 0;

    const nonWorking = db.prepare(`
      SELECT date FROM academic_calendar
      WHERE academic_year = ?
      AND SUBSTR(date, 4, 2) = ?
      AND SUBSTR(date, 7, 4) = ?
      AND day_type != 'WORKING'
      AND applies_to = 'ALL'
    `).all(academic_year, String(m).padStart(2,'0'), String(y));

    const nonWorkingSet = new Set(nonWorking.map(r => r.date));

    for (let d = 1; d <= daysInMonth; d++) {
      const dt  = new Date(y, m - 1, d);
      const str = `${String(d).padStart(2,'0')}-${String(m).padStart(2,'0')}-${y}`;
      if (dt.getDay() === 0) continue;          // Sunday
      if (nonWorkingSet.has(str)) continue;     // Holiday/Vacation
      workingDays++;
    }
    return { success: true, working_days: workingDays };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get full year summary (for overview) ──────────────────────
ipcMain.handle('calendar:getYearSummary', (_evt, academic_year) => {
  try {
    const rows = db.prepare(`
      SELECT day_type, COUNT(*) as count
      FROM academic_calendar
      WHERE academic_year = ?
      GROUP BY day_type
    `).all(academic_year);
    return { success: true, data: rows };
  } catch (err) {
    return { success: false, message: err.message };
  }
});
