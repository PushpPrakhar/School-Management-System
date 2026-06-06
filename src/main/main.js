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
    db.prepare('UPDATE users SET last_login = datetime("now","localtime") WHERE user_id = ?')
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
    return { success: false, message: 'An error occurred. Please try again.' };
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
    // Subjects & Stream
    language_group:         data.language_group                || '',
    academic_stream:        data.academic_stream               || '',
    subject_group:          data.subject_group                 || '',
  };
}

ipcMain.handle('enrollment:add', (_evt, rawData) => {
  try {
    const data = applyDefaults(rawData);

    // ── Generate admission number: BPS[YYYY]-[NNNN] ──────────
    // YYYY = first year of academic session (2025 for 2025-26)
    // NNNN = global sequential counter — NEVER resets across years
    const now         = new Date();
    const sessionYear = now.getMonth() >= 3
      ? now.getFullYear()
      : now.getFullYear() - 1;

    // Find highest counter across ALL records
    const lastRecord = db.prepare(
      "SELECT admission_number FROM enrollment ORDER BY rowid DESC LIMIT 1"
    ).get();

    let lastCounter = 0;
    if (lastRecord) {
      const parts = lastRecord.admission_number.split('-');
      lastCounter = parseInt(parts[parts.length - 1]) || 0;
    }

    const nextCounter     = lastCounter + 1;
    const admissionNumber = `BPS${sessionYear}-${String(nextCounter).padStart(4, '0')}`;

    db.prepare(`
      INSERT INTO enrollment (
        admission_number, student_status, academic_year,
        student_name, gender, date_of_birth, indian_nationality,
        blood_group, mother_tongue, aadhar_number, aadhar_doc,
        birth_cert, birth_cert_doc,
        mother_name, mother_profession,
        father_name, father_profession,
        guardian_name, contact_email, mobile_number, alternate_mobile,
        house_no, village, post, district, state_name, pin_code,
        category, minority_group, bpl_beneficiary, ews_disadvantaged,
        cwsn, impairment_type, disability_certificate, disability_cert_doc, disability_percentage,
        pen_number, apaar_id, rte_section_12c, rte_amount_claimed,
        date_of_admission, class_of_admission, current_class,
        section, medium_of_instruction,
        studied_elsewhere, tc_submitted, tc_doc,
        prev_year_status, prev_year_class,
        prev_enrollment_number, prev_academic_year, prev_school_name,
        language_group, academic_stream, subject_group
      ) VALUES (
        @admission_number, @student_status, @academic_year,
        @student_name, @gender, @date_of_birth, @indian_nationality,
        @blood_group, @mother_tongue, @aadhar_number, @aadhar_doc,
        @birth_cert, @birth_cert_doc,
        @mother_name, @mother_profession,
        @father_name, @father_profession,
        @guardian_name, @contact_email, @mobile_number, @alternate_mobile,
        @house_no, @village, @post, @district, @state_name, @pin_code,
        @category, @minority_group, @bpl_beneficiary, @ews_disadvantaged,
        @cwsn, @impairment_type, @disability_certificate, @disability_cert_doc, @disability_percentage,
        @pen_number, @apaar_id, @rte_section_12c, @rte_amount_claimed,
        @date_of_admission, @class_of_admission, @current_class,
        @section, @medium_of_instruction,
        @studied_elsewhere, @tc_submitted, @tc_doc,
        @prev_year_status, @prev_year_class,
        @prev_enrollment_number, @prev_academic_year, @prev_school_name,
        @language_group, @academic_stream, @subject_group
      )
    `).run({ ...data, admission_number: admissionNumber });

    return { success: true, admission_number: admissionNumber };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Edit existing student ─────────────────────────────────────
ipcMain.handle('enrollment:edit', (_evt, { admission_number, ...rawData }) => {
  try {
    const data = applyDefaults(rawData);
    const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.prepare(
      `UPDATE enrollment SET ${fields}, updated_at = datetime('now','localtime')
       WHERE admission_number = @admission_number`
    ).run({ ...data, admission_number });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('enrollment:getByClass', (_evt, { class: cls, academic_year }) => {
  const rows = db.prepare(
    'SELECT * FROM enrollment WHERE current_class = ? AND academic_year = ? ORDER BY student_name'
  ).all(cls, academic_year);
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

// ── DASHBOARD STATS ──────────────────────────────────────────
ipcMain.handle('dashboard:stats', (_evt, academic_year) => {
  const totalStudents = db.prepare(
    "SELECT COUNT(*) as c FROM enrollment WHERE academic_year = ? AND tc_issued = 0"
  ).get(academic_year).c;

  const pendingFees = db.prepare(
    "SELECT COUNT(DISTINCT admission_number) as c FROM fees_ledger WHERE academic_year = ? AND (total_due - amount_paid_this_month) > 0"
  ).get(academic_year).c;

  const classWise = db.prepare(
    "SELECT current_class, COUNT(*) as count FROM enrollment WHERE academic_year = ? AND tc_issued = 0 GROUP BY current_class ORDER BY current_class"
  ).all(academic_year);

  return { success: true, data: { totalStudents, pendingFees, classWise } };
});

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
