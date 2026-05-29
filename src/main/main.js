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
  ? path.join(__dirname, 'schema.sql')
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
ipcMain.handle('enrollment:add', (_evt, data) => {
  try {
    // Auto-generate admission number: ADM-YYYY-XXXX
    const year = new Date().getFullYear();
    const count = (db.prepare('SELECT COUNT(*) as c FROM enrollment').get().c || 0) + 1;
    const admissionNumber = `ADM-${year}-${String(count).padStart(4, '0')}`;

    db.prepare(`
      INSERT INTO enrollment
        (admission_number, date_of_admission, class_of_admission, student_name,
         gender, date_of_birth, aadhar_number, pen_number, current_class,
         father_name, mother_name, father_phone, mother_phone, blood_group,
         prev_sr_number, prev_school_name, documents_submitted,
         religion, caste, category, address, academic_year)
      VALUES
        (@admission_number, @date_of_admission, @class_of_admission, @student_name,
         @gender, @date_of_birth, @aadhar_number, @pen_number, @current_class,
         @father_name, @mother_name, @father_phone, @mother_phone, @blood_group,
         @prev_sr_number, @prev_school_name, @documents_submitted,
         @religion, @caste, @category, @address, @academic_year)
    `).run({ ...data, admission_number: admissionNumber });

    return { success: true, admission_number: admissionNumber };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return { success: false, message: 'Aadhar or PEN number already exists in the system.' };
    }
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
ipcMain.handle('excel:preview', async (_evt, filePath) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true, dateNF: 'dd/mm/yyyy' });
    const sheetNames = workbook.SheetNames;

    // Read all sheets
    const sheets = sheetNames.map(name => {
      const ws = workbook.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (rows.length === 0) return { name, headers: [], preview: [], totalRows: 0 };

      const headers = rows[0].map(h => String(h).trim());
      const dataRows = rows.slice(1).filter(r => r.some(cell => cell !== ''));
      const preview  = dataRows.slice(0, 10).map(r =>
        headers.reduce((obj, h, i) => {
          obj[h] = r[i] !== undefined ? String(r[i]) : '';
          return obj;
        }, {})
      );

      return { name, headers, preview, totalRows: dataRows.length };
    });

    return { success: true, sheets, schemas: IMPORT_SCHEMAS };
  } catch (err) {
    return { success: false, message: `Could not read file: ${err.message}` };
  }
});

// ── Validate + import a mapped sheet into the database ───────
ipcMain.handle('excel:import', (_evt, { filePath, sheetName, table, mapping, options }) => {
  try {
    const workbook = XLSX.readFile(filePath, { cellDates: true, dateNF: 'dd/mm/yyyy' });
    const ws = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    if (rows.length < 2) return { success: false, message: 'Sheet has no data rows.' };

    const excelHeaders = rows[0].map(h => String(h).trim());
    const dataRows     = rows.slice(1).filter(r => r.some(cell => cell !== ''));

    const schema = IMPORT_SCHEMAS[table];
    if (!schema) return { success: false, message: 'Unknown table.' };

    // mapping = { dbColumn: excelColumnName }
    // Build each row as a DB object and validate
    const validRows   = [];
    const errorRows   = [];

    dataRows.forEach((rawRow, idx) => {
      // Convert raw row array → object keyed by Excel header
      const excelObj = excelHeaders.reduce((obj, h, i) => {
        obj[h] = rawRow[i] !== undefined ? String(rawRow[i]).trim() : '';
        return obj;
      }, {});

      const dbObj  = {};
      const errors = [];

      schema.columns.forEach(col => {
        const excelCol = mapping[col.key];
        let val = excelCol ? (excelObj[excelCol] || '') : '';

        // Type coercions
        if (['monthly_tuition_fees','transport_fees','concession','prev_balance',
             'amount_paid_this_month','total_due'].includes(col.key)) {
          val = parseFloat(val.replace(/[₹,\s]/g, '')) || 0;
        }

        if (col.required && (val === '' || val === null || val === undefined)) {
          errors.push(`"${col.label}" is required`);
        }

        // Aadhar: must be 12 digits if provided
        if (col.key === 'aadhar_number' && val && !/^\d{12}$/.test(val.replace(/\s/g,''))) {
          errors.push('Aadhar must be 12 digits');
        }

        // Gender: normalise
        if (col.key === 'gender') {
          const g = val.toUpperCase();
          if (g === 'M' || g === 'MALE' || g === 'BOY')   val = 'M';
          else if (g === 'F' || g === 'FEMALE' || g === 'GIRL') val = 'F';
          else if (val !== '') val = 'Other';
        }

        // Category: normalise
        if (col.key === 'category' && val) {
          val = val.toUpperCase();
          if (!['GEN','SC','ST','OBC'].includes(val)) {
            errors.push('Category must be GEN, SC, ST, or OBC');
          }
        }

        dbObj[col.key] = val;
      });

      const rowNum = idx + 2; // +2 because row 1 is header
      if (errors.length > 0) {
        errorRows.push({ rowNum, data: excelObj, errors });
      } else {
        validRows.push({ rowNum, data: dbObj });
      }
    });

    // If skipErrors is false and there are errors, abort
    if (!options.skipErrors && errorRows.length > 0) {
      return {
        success: false,
        validCount:  validRows.length,
        errorCount:  errorRows.length,
        errors:      errorRows.slice(0, 20), // return first 20 errors
        needsConfirm: true,
      };
    }

    // ── Commit valid rows ────────────────────────────────────
    const importMany = db.transaction((rows) => {
      let inserted = 0;
      let updated  = 0;
      let skipped  = 0;

      rows.forEach(({ data }) => {
        if (table === 'enrollment') {
          // Auto-generate admission number if not provided
          if (!data.admission_number) {
            const year  = new Date().getFullYear();
            const count = db.prepare('SELECT COUNT(*) as c FROM enrollment').get().c + 1;
            data.admission_number = `ADM-${year}-${String(count).padStart(4,'0')}`;
          }

          const existing = db.prepare(
            'SELECT admission_number FROM enrollment WHERE admission_number = ?'
          ).get(data.admission_number);

          if (existing && options.updateExisting) {
            const fields = Object.keys(data)
              .filter(k => k !== 'admission_number')
              .map(k => `${k} = @${k}`).join(', ');
            db.prepare(
              `UPDATE enrollment SET ${fields}, updated_at = datetime('now','localtime')
               WHERE admission_number = @admission_number`
            ).run(data);
            updated++;
          } else if (!existing) {
            const keys = Object.keys(data).join(', ');
            const vals = Object.keys(data).map(k => `@${k}`).join(', ');
            db.prepare(`INSERT INTO enrollment (${keys}) VALUES (${vals})`).run(data);
            inserted++;
          } else {
            skipped++; // duplicate, updateExisting = false
          }

        } else if (table === 'fees_ledger') {
          const keys = Object.keys(data).join(', ');
          const vals = Object.keys(data).map(k => `@${k}`).join(', ');
          try {
            db.prepare(`INSERT INTO fees_ledger (${keys}) VALUES (${vals})`).run(data);
            inserted++;
          } catch { skipped++; }
        }
      });

      return { inserted, updated, skipped };
    });

    const { inserted, updated, skipped } = importMany(validRows);

    return {
      success:      true,
      inserted,
      updated,
      skipped,
      errorCount:   errorRows.length,
      errors:       errorRows.slice(0, 20),
    };

  } catch (err) {
    return { success: false, message: err.message };
  }
});
