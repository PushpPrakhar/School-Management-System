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

// ── Fee-month backfill helper ─────────────────────────────────
// Parses the trailing "(Mon YYYY)" or "(Month-YY)" tag out of a fee
// transaction's description and returns a canonical 'YYYY-MM' string,
// or null if nothing recognisable was found.
const _MONTH_NUM = {
  jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06',
  jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
};
function _parseFeeMonthFromDescription(desc) {
  if (!desc) return null;
  const m = String(desc).match(/\(([A-Za-z]+)[\s-](\d{2,4})\)\s*$/);
  if (!m) return null;
  const monKey = m[1].slice(0, 3).toLowerCase();
  const num = _MONTH_NUM[monKey];
  if (!num) return null;
  let yr = m[2];
  yr = yr.length === 2 ? ('20' + yr) : yr;
  if (yr.length !== 4) return null;
  return `${yr}-${num}`;
}

function backfillFeeMonths() {
  try {
    for (const table of ['fee_transactions_stage', 'fee_transactions']) {
      const rows = db.prepare(
        `SELECT rowid, description FROM ${table} WHERE transaction_type = 'RECEIVABLE' AND (fee_month IS NULL OR fee_month = '')`
      ).all();
      if (rows.length === 0) continue;
      const upd = db.prepare(`UPDATE ${table} SET fee_month = ? WHERE rowid = ?`);
      const run = db.transaction((items) => {
        items.forEach(r => {
          const fm = _parseFeeMonthFromDescription(r.description);
          if (fm) upd.run(fm, r.rowid);
        });
      });
      run(rows);
      console.log(`[DB] Backfilled fee_month for ${rows.length} row(s) checked in ${table}`);
    }
  } catch (e) {
    console.log('[DB] fee_month backfill skipped:', e.message);
  }
}

// One-time cleanup: Admission/Activity/Library/Wellness/Books/Exam fees are
// charged once (not month-by-month), so their description should never carry
// a "(Month-YY)" tag — but earlier versions of Bulk Entry appended one to
// every fee type. Any row saved that way will never match Counter Payment's
// "already charged?" check (which correctly looks for the plain label), so
// this strips the stray tag back down to just the label, once.
function backfillNonMonthlyFeeDescriptions() {
  const NON_MONTHLY_LABELS = [
    'Admission Fee', 'Activity Fee', 'Library Fee', 'Campus Wellness', 'Books Fee',
    'Exam Fee (Half Yearly)', 'Exam Fee (Annual)',
  ];
  try {
    for (const table of ['fee_transactions_stage', 'fee_transactions']) {
      const rows = db.prepare(
        `SELECT rowid, description FROM ${table} WHERE transaction_type = 'RECEIVABLE'`
      ).all();
      if (rows.length === 0) continue;
      const upd = db.prepare(`UPDATE ${table} SET description = ? WHERE rowid = ?`);
      let fixed = 0;
      const samples = [];
      const run = db.transaction((items) => {
        items.forEach(r => {
          const raw = r.description || '';
          const desc = raw.trim();
          if (desc === '') return;
          for (const label of NON_MONTHLY_LABELS) {
            // Matches "<Label> (<anything>)" with any amount of whitespace,
            // regardless of exact casing quirks in the trailing tag.
            const re = new RegExp('^' + label.replace(/[().]/g, '\\$&') + '\\s*\\([^()]*\\)$');
            if (raw !== label && re.test(desc)) {
              if (samples.length < 5) samples.push(`"${raw}" -> "${label}"`);
              upd.run(label, r.rowid);
              fixed++;
              break;
            }
          }
        });
      });
      run(rows);
      if (fixed > 0) {
        console.log(`[DB] Normalized ${fixed} non-monthly fee description(s) in ${table}`);
        console.log('[DB] Sample changes:', samples.join(' | '));
      } else {
        console.log(`[DB] Non-monthly fee description check: 0 rows needed fixing in ${table} (${rows.length} checked)`);
      }
    }
  } catch (e) {
    console.log('[DB] non-monthly fee description normalization skipped:', e.message);
  }
}

// One-time cleanup: a bug in Auto Accrual's insert meant every charge it
// generated (Tuition, Transport, Activity, etc.) was saved with an empty
// fee_type, so the receipt couldn't tell what it was and dumped it all into
// "Others". This guesses the correct fee_type from each row's description
// and fills it back in, once.
function backfillMissingFeeTypes() {
  try {
    for (const table of ['fee_transactions_stage', 'fee_transactions']) {
      const rows = db.prepare(
        `SELECT rowid, description FROM ${table} WHERE transaction_type = 'RECEIVABLE' AND (fee_type IS NULL OR fee_type = '')`
      ).all();
      if (rows.length === 0) continue;
      const upd = db.prepare(`UPDATE ${table} SET fee_type = ? WHERE rowid = ?`);
      let fixed = 0;
      const run = db.transaction((items) => {
        items.forEach(r => {
          const ft = _guessFeeTypeFromDescription(r.description);
          if (ft) { upd.run(ft, r.rowid); fixed++; }
        });
      });
      run(rows);
      if (fixed > 0) console.log(`[DB] Backfilled fee_type for ${fixed} row(s) in ${table}`);
    }
  } catch (e) {
    console.log('[DB] fee_type backfill skipped:', e.message);
  }
}


// ── Fee accrual (auto-generate monthly & annual dues) ──────────
const ACADEMIC_MONTH_ORDER = ['04','05','06','07','08','09','10','11','12','01','02','03'];
const _MONTH_FULL_NAME = { '01':'January','02':'February','03':'March','04':'April','05':'May','06':'June',
  '07':'July','08':'August','09':'September','10':'October','11':'November','12':'December' };
const _MONTH_SHORT_NAME = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' };

// Given academic_year '2026-27' and a 2-digit month '04'..'03', returns the
// calendar year that month falls in (Apr-Dec => first year, Jan-Mar => second year).
function _monthCalendarYear(academicYear, month) {
  const startYear = parseInt(String(academicYear).split('-')[0], 10);
  return (month >= '04') ? startYear : startYear + 1;
}
function _feeMonthFor(academicYear, month) {
  return `${_monthCalendarYear(academicYear, month)}-${month}`;
}

// All months of the academic year that have already arrived (<= today), in
// academic order starting April. For a fully-past academic year this returns
// all 12 months; for the current one it stops at the current month.
function _elapsedMonthsInAcademicYear(academicYear) {
  const todayFeeMonth = new Date().toISOString().slice(0, 7);
  const out = [];
  for (const m of ACADEMIC_MONTH_ORDER) {
    const calYear = _monthCalendarYear(academicYear, m);
    const feeMonth = `${calYear}-${m}`;
    if (feeMonth <= todayFeeMonth) {
      out.push({
        month: m, calYear, feeMonth,
        label: `${_MONTH_FULL_NAME[m]} ${calYear}`,
        shortLabel: `${_MONTH_FULL_NAME[m]}-${String(calYear).slice(2)}`,
      });
    }
  }
  return out;
}

// Builds the full accrual plan: which RECEIVABLE lines are missing for which
// students, for both recurring monthly fees and due-dated annual/twice-yearly
// fees. Used (read-only) by both the summary preview and the actual generator,
// so the two can never drift apart.
function _computeAccrualPlan(academic_year) {
  const elapsedMonths = _elapsedMonthsInAcademicYear(academic_year);
  if (elapsedMonths.length === 0) return { elapsedMonths, perStudentEntries: [] };
  const lastElapsedFeeMonth = elapsedMonths[elapsedMonths.length - 1].feeMonth;

  const settings = db.prepare('SELECT * FROM fee_settings WHERE academic_year = ?').get(academic_year)
    || { sibling_concession_pct: 0, sibling_concession_from: 3 };

  const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
    'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };

  const ledgerRows = db.prepare(`
    SELECT l.*, gm.group_id as gm_group_id, e.date_of_admission
    FROM   fee_ledger l
    LEFT JOIN fee_group_members gm ON gm.ledger_id = l.ledger_id
    LEFT JOIN enrollment e ON e.admission_number = l.admission_number
    WHERE  l.academic_year = ?
  `).all(academic_year);

  // Recompute sibling positions by class rank (same logic as Bulk Entry preview)
  const groupMembers = {};
  ledgerRows.forEach(r => {
    if (r.gm_group_id) {
      if (!groupMembers[r.gm_group_id]) groupMembers[r.gm_group_id] = [];
      groupMembers[r.gm_group_id].push(r);
    }
  });
  Object.values(groupMembers).forEach(members => {
    members.sort((a, b) => (CLASS_RANK[b.current_class] ?? -1) - (CLASS_RANK[a.current_class] ?? -1));
    members.forEach((m, i) => { m._siblingPosition = i + 1; });
  });

  const feeStructureCache = {};
  const getFeeStructure = (cls) => {
    if (!feeStructureCache[cls]) {
      feeStructureCache[cls] = db.prepare('SELECT * FROM fee_structure WHERE academic_year = ? AND class = ?').all(academic_year, cls);
    }
    return feeStructureCache[cls];
  };

  // Already charged for this exact month + fee type?
  const alreadyChargedThisMonth = db.prepare(`
    SELECT 1 FROM (
      SELECT description, fee_month FROM fee_transactions WHERE ledger_id = ? AND transaction_type = 'RECEIVABLE'
      UNION ALL
      SELECT description, fee_month FROM fee_transactions_stage WHERE ledger_id = ? AND transaction_type = 'RECEIVABLE' AND status != 'CANCELLED'
    ) WHERE fee_month = ? AND description LIKE ?
    LIMIT 1
  `);
  // Already charged anywhere this academic year? (for annual/twice-yearly fees)
  const alreadyChargedThisYear = db.prepare(`
    SELECT 1 FROM (
      SELECT description FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
      UNION ALL
      SELECT description FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE' AND status != 'CANCELLED'
    ) WHERE description LIKE ?
    LIMIT 1
  `);
  const transportLookup = db.prepare(`
    SELECT tm.*, r.route_name, r.monthly_amount
    FROM   student_transport_monthly tm
    JOIN   transport_routes r ON r.route_id = tm.route_id
    WHERE  tm.admission_number = ? AND tm.academic_year = ? AND tm.month = ?
  `);

  const perStudentEntries = [];

  ledgerRows.forEach(student => {
    const fs = getFeeStructure(student.current_class);
    const feeMap = {};
    fs.forEach(f => { feeMap[f.fee_type] = f; });
    const sibPos = student._siblingPosition || null;
    const isSibling = sibPos !== null && sibPos >= (settings.sibling_concession_from || 3);
    const concessPct = isSibling ? (settings.sibling_concession_pct || 0) : 0;

    const lines = [];

    // Recurring monthly fees: Tuition, Computer, Lab + Transport (where assigned).
    // Charged for the full academic year from April regardless of when the
    // student was actually added to the ledger — BPS charges every admitted
    // student April onward, no proration, matching how Annual fees already work.
    elapsedMonths.forEach(({ month, feeMonth, shortLabel }) => {
      ['TUITION', 'COMPUTER', 'LAB'].forEach(ft => {
        const f = feeMap[ft];
        if (!f || f.amount <= 0 || f.frequency !== 'MONTHLY') return;
        const label = _feeLabel(ft);
        if (alreadyChargedThisMonth.get(student.ledger_id, student.ledger_id, feeMonth, label + '%')) return;
        const conc = (ft === 'TUITION' && isSibling) ? Math.round(f.amount * concessPct / 100) : 0;
        lines.push({
          fee_type: ft, description: `${label} (${shortLabel})`,
          amount: f.amount, concession: conc,
          concession_reason: conc > 0 ? `Sibling concession ${concessPct}% (child ${sibPos})` : '',
          fee_month: feeMonth,
        });
      });

      const t = transportLookup.get(student.admission_number, academic_year, month);
      if (t && t.monthly_amount > 0) {
        const label = 'Transport Fee';
        if (!alreadyChargedThisMonth.get(student.ledger_id, student.ledger_id, feeMonth, label + '%')) {
          lines.push({
            fee_type: 'TRANSPORT', description: `${label} (${shortLabel})`,
            amount: t.monthly_amount, concession: 0, concession_reason: '',
            fee_month: feeMonth,
          });
        }
      }
    });

    // Annual / twice-yearly fees whose configured due month has arrived
    fs.filter(f => (f.frequency === 'ANNUAL' || f.frequency === 'TWICE_YEAR') && f.amount > 0 && f.due_month).forEach(f => {
      const dueFeeMonth = _feeMonthFor(academic_year, f.due_month);
      if (dueFeeMonth > lastElapsedFeeMonth) return; // due month hasn't arrived yet
      const label = _feeLabel(f.fee_type);
      if (alreadyChargedThisYear.get(student.ledger_id, academic_year, student.ledger_id, academic_year, label + '%')) return;
      lines.push({
        fee_type: f.fee_type, description: label,
        amount: f.amount, concession: 0, concession_reason: '',
        fee_month: dueFeeMonth,
      });
    });

    // Admission Fee (one-time) — only for students who actually joined this
    // academic year, and only once. This is the only place Admission Fee is
    // ever generated — Counter Payment no longer creates it on its own.
    const admissionFee = feeMap['ADMISSION'];
    if (admissionFee && admissionFee.amount > 0 && _admittedInAcademicYear(student.date_of_admission, academic_year)) {
      const label = _feeLabel('ADMISSION');
      if (!alreadyChargedThisYear.get(student.ledger_id, academic_year, student.ledger_id, academic_year, label + '%')) {
        lines.push({
          fee_type: 'ADMISSION', description: label,
          amount: admissionFee.amount, concession: 0, concession_reason: '',
          fee_month: elapsedMonths[elapsedMonths.length - 1].feeMonth,
        });
      }
    }

    if (lines.length > 0) {
      perStudentEntries.push({
        ledger_id: student.ledger_id, sl_number: student.sl_number,
        student_name: student.student_name, current_class: student.current_class,
        lines,
      });
    }
  });

  return { elapsedMonths, perStudentEntries };
}

// Aggregates a plan into banner/grid-friendly totals.
function _summarizeAccrualPlan(plan) {
  const MONTHLY_TYPES = ['TUITION', 'COMPUTER', 'LAB', 'TRANSPORT'];
  const byMonth = {};
  const byAnnual = {};
  const studentInfo = {}; // ledger_id -> { sl_number, student_name, current_class }
  plan.perStudentEntries.forEach(entry => {
    studentInfo[entry.ledger_id] = {
      sl_number: entry.sl_number, student_name: entry.student_name, current_class: entry.current_class,
    };
    entry.lines.forEach(line => {
      const net = (line.amount || 0) - (line.concession || 0);
      if (MONTHLY_TYPES.includes(line.fee_type)) {
        const key = line.fee_month;
        if (!byMonth[key]) byMonth[key] = { fee_month: key, students: new Set(), total: 0 };
        byMonth[key].students.add(entry.ledger_id);
        byMonth[key].total += net;
      } else {
        const key = line.fee_type;
        if (!byAnnual[key]) byAnnual[key] = { fee_type: key, label: _feeLabel(key), fee_month: line.fee_month, students: new Set(), total: 0 };
        byAnnual[key].students.add(entry.ledger_id);
        byAnnual[key].total += net;
      }
    });
  });
  const studentListFor = (idSet) => [...idSet]
    .map(id => studentInfo[id])
    .sort((a, b) => (a.sl_number || '').localeCompare(b.sl_number || ''));
  const monthly = Object.values(byMonth)
    .map(m => ({ fee_month: m.fee_month, studentCount: m.students.size, total: Math.round(m.total * 100) / 100, students: studentListFor(m.students) }))
    .sort((a, b) => a.fee_month.localeCompare(b.fee_month));
  const annual = Object.values(byAnnual)
    .map(a => ({ fee_type: a.fee_type, label: a.label, fee_month: a.fee_month, studentCount: a.students.size, total: Math.round(a.total * 100) / 100, students: studentListFor(a.students) }));
  const totalStudentsAffected = new Set(plan.perStudentEntries.map(e => e.ledger_id)).size;
  const totalAmount = plan.perStudentEntries.reduce(
    (s, e) => s + e.lines.reduce((s2, l) => s2 + (l.amount || 0) - (l.concession || 0), 0), 0
  );
  return { monthly, annual, totalStudentsAffected, totalAmount: Math.round(totalAmount * 100) / 100 };
}

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

  // Examination tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_marks (
      mark_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
      admission_number TEXT     NOT NULL,
      student_name     TEXT     NOT NULL DEFAULT '',
      class            TEXT     NOT NULL,
      section          TEXT     NOT NULL,
      academic_year    TEXT     NOT NULL,
      exam_type        TEXT     NOT NULL,
      subject          TEXT     NOT NULL,
      max_marks        INTEGER  NOT NULL,
      marks_obtained   REAL,
      is_absent        INTEGER  NOT NULL DEFAULT 0,
      entered_by       TEXT     NOT NULL DEFAULT '',
      entered_at       DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(admission_number, academic_year, exam_type, subject)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS exam_locks (
      lock_id       INTEGER  PRIMARY KEY AUTOINCREMENT,
      class         TEXT     NOT NULL,
      section       TEXT     NOT NULL,
      academic_year TEXT     NOT NULL,
      exam_type     TEXT     NOT NULL,
      locked_by     TEXT     NOT NULL DEFAULT '',
      locked_at     DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(class, section, academic_year, exam_type)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_exam_marks_class ON exam_marks (class, section, academic_year, exam_type)"); } catch(_) {}


  // ── FEES MODULE — 13 tables ──────────────────────────────────

  db.exec(`CREATE TABLE IF NOT EXISTS fee_settings (
    setting_id             INTEGER  PRIMARY KEY AUTOINCREMENT,
    academic_year          TEXT     NOT NULL UNIQUE,
    late_fee_per_day       REAL     NOT NULL DEFAULT 5,
    grace_period_days      INTEGER  NOT NULL DEFAULT 10,
    late_fee_annual_cap    REAL     NOT NULL DEFAULT 1000,
    security_deposit       REAL     NOT NULL DEFAULT 0,
    prospectus_fee         REAL     NOT NULL DEFAULT 100,
    tc_fee                 REAL     NOT NULL DEFAULT 0,
    sibling_concession_pct REAL     NOT NULL DEFAULT 0,
    sibling_concession_from INTEGER NOT NULL DEFAULT 3,
    created_by             TEXT     NOT NULL DEFAULT '',
    updated_at             DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_structure (
    structure_id   INTEGER  PRIMARY KEY AUTOINCREMENT,
    academic_year  TEXT     NOT NULL,
    class          TEXT     NOT NULL,
    fee_type       TEXT     NOT NULL,
    amount         REAL     NOT NULL DEFAULT 0,
    frequency      TEXT     NOT NULL DEFAULT 'MONTHLY',
    due_month      TEXT     NOT NULL DEFAULT '',
    updated_at     DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(academic_year, class, fee_type)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS transport_routes (
    route_id       INTEGER  PRIMARY KEY AUTOINCREMENT,
    academic_year  TEXT     NOT NULL,
    route_name     TEXT     NOT NULL,
    pickup_points  TEXT     NOT NULL DEFAULT '',
    monthly_amount REAL     NOT NULL DEFAULT 0,
    is_active      INTEGER  NOT NULL DEFAULT 1,
    created_by     TEXT     NOT NULL DEFAULT '',
    created_at     DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS student_transport (
    transport_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT     NOT NULL,
    route_id         INTEGER  NOT NULL,
    academic_year    TEXT     NOT NULL,
    assigned_by      TEXT     NOT NULL DEFAULT '',
    assigned_at      DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(admission_number, academic_year)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS collection_centers (
    center_id    INTEGER  PRIMARY KEY AUTOINCREMENT,
    center_name  TEXT     NOT NULL,
    center_code  TEXT     NOT NULL UNIQUE,
    address      TEXT     NOT NULL DEFAULT '',
    is_active    INTEGER  NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_counters (
    counter_id   INTEGER  PRIMARY KEY AUTOINCREMENT,
    center_id    INTEGER  NOT NULL,
    counter_name TEXT     NOT NULL,
    counter_code TEXT     NOT NULL,
    is_active    INTEGER  NOT NULL DEFAULT 1,
    UNIQUE(center_id, counter_code)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_ledger (
    ledger_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    sl_number          TEXT     NOT NULL,
    admission_number   TEXT     NOT NULL,
    student_name       TEXT     NOT NULL DEFAULT '',
    current_class      TEXT     NOT NULL DEFAULT '',
    section            TEXT     NOT NULL DEFAULT '',
    academic_year      TEXT     NOT NULL,
    group_id           INTEGER  DEFAULT NULL,
    physical_page      TEXT     NOT NULL DEFAULT '',
    opening_balance    REAL     NOT NULL DEFAULT 0,
    transport_route_id INTEGER  DEFAULT NULL,
    created_by         TEXT     NOT NULL DEFAULT '',
    created_at         DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(sl_number, academic_year),
    UNIQUE(admission_number, academic_year)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_groups (
    group_id      INTEGER  PRIMARY KEY AUTOINCREMENT,
    gsl_number    TEXT     NOT NULL,
    academic_year TEXT     NOT NULL,
    oldest_sl     TEXT     NOT NULL,
    created_by    TEXT     NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(gsl_number, academic_year)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_group_members (
    member_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id         INTEGER NOT NULL,
    ledger_id        INTEGER NOT NULL,
    sl_number        TEXT    NOT NULL,
    sibling_position INTEGER NOT NULL DEFAULT 1,
    UNIQUE(ledger_id)
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS prospectus_inquiries (
    inquiry_id       INTEGER  PRIMARY KEY AUTOINCREMENT,
    student_name     TEXT     NOT NULL DEFAULT '',
    father_name      TEXT     NOT NULL DEFAULT '',
    mother_name      TEXT     NOT NULL DEFAULT '',
    father_mobile    TEXT     NOT NULL DEFAULT '',
    mother_mobile    TEXT     NOT NULL DEFAULT '',
    address          TEXT     NOT NULL DEFAULT '',
    amount_paid      REAL     NOT NULL DEFAULT 100,
    payment_date     TEXT     NOT NULL DEFAULT '',
    receipt_number   TEXT     NOT NULL DEFAULT '',
    admission_taken  INTEGER  NOT NULL DEFAULT 0,
    admission_number TEXT     NOT NULL DEFAULT '',
    notes            TEXT     NOT NULL DEFAULT '',
    created_by       TEXT     NOT NULL DEFAULT '',
    created_at       DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_transactions_stage (
    stage_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    receipt_number    TEXT     NOT NULL DEFAULT '',
    ledger_id         INTEGER  DEFAULT NULL,
    group_id          INTEGER  DEFAULT NULL,
    sl_number         TEXT     NOT NULL DEFAULT '',
    academic_year     TEXT     NOT NULL DEFAULT '',
    transaction_type  TEXT     NOT NULL DEFAULT 'RECEIVED',
    description       TEXT     NOT NULL DEFAULT '',
    debit             REAL     NOT NULL DEFAULT 0,
    credit            REAL     NOT NULL DEFAULT 0,
    concession        REAL     NOT NULL DEFAULT 0,
    concession_reason TEXT     NOT NULL DEFAULT '',
    late_fee          REAL     NOT NULL DEFAULT 0,
    late_fee_waived   REAL     NOT NULL DEFAULT 0,
    payment_mode      TEXT     NOT NULL DEFAULT 'CASH',
    cheque_details    TEXT     NOT NULL DEFAULT '',
    center_id         INTEGER  DEFAULT NULL,
    counter_id        INTEGER  DEFAULT NULL,
    collected_by      TEXT     NOT NULL DEFAULT '',
    collected_at      DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    status            TEXT     NOT NULL DEFAULT 'PENDING',
    schedule_id       TEXT     NOT NULL DEFAULT '',
    fee_month         TEXT     NOT NULL DEFAULT ''
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS fee_transactions (
    txn_id            INTEGER  PRIMARY KEY AUTOINCREMENT,
    receipt_number    TEXT     NOT NULL DEFAULT '',
    ledger_id         INTEGER  DEFAULT NULL,
    group_id          INTEGER  DEFAULT NULL,
    sl_number         TEXT     NOT NULL DEFAULT '',
    academic_year     TEXT     NOT NULL DEFAULT '',
    transaction_type  TEXT     NOT NULL DEFAULT 'RECEIVED',
    description       TEXT     NOT NULL DEFAULT '',
    debit             REAL     NOT NULL DEFAULT 0,
    credit            REAL     NOT NULL DEFAULT 0,
    concession        REAL     NOT NULL DEFAULT 0,
    concession_reason TEXT     NOT NULL DEFAULT '',
    late_fee          REAL     NOT NULL DEFAULT 0,
    late_fee_waived   REAL     NOT NULL DEFAULT 0,
    payment_mode      TEXT     NOT NULL DEFAULT 'CASH',
    cheque_details    TEXT     NOT NULL DEFAULT '',
    center_id         INTEGER  DEFAULT NULL,
    counter_id        INTEGER  DEFAULT NULL,
    collected_by      TEXT     NOT NULL DEFAULT '',
    collected_at      TEXT     NOT NULL DEFAULT '',
    schedule_id       TEXT     NOT NULL DEFAULT '',
    posted_at         DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    fee_month         TEXT     NOT NULL DEFAULT ''
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS posting_schedules (
    schedule_id        TEXT     PRIMARY KEY,
    center_id          INTEGER  NOT NULL,
    schedule_date      TEXT     NOT NULL,
    start_date         TEXT     NOT NULL,
    end_date           TEXT     NOT NULL,
    total_transactions INTEGER  NOT NULL DEFAULT 0,
    total_amount       REAL     NOT NULL DEFAULT 0,
    posted_by          TEXT     NOT NULL DEFAULT '',
    posted_at          DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    status             TEXT     NOT NULL DEFAULT 'DRAFT'
  )`);

  // Monthly transport assignments
  db.exec(`CREATE TABLE IF NOT EXISTS student_transport_monthly (
    id               INTEGER  PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT     NOT NULL,
    route_id         INTEGER  NOT NULL,
    academic_year    TEXT     NOT NULL,
    month            TEXT     NOT NULL,
    assigned_by      TEXT     NOT NULL DEFAULT '',
    created_at       DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(admission_number, academic_year, month)
  )`);

  // Migration: add fee_adjusted column to prospectus_inquiries if missing
  try {
    db.prepare('SELECT fee_adjusted FROM prospectus_inquiries LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE prospectus_inquiries ADD COLUMN fee_adjusted INTEGER NOT NULL DEFAULT 0');
    console.log('[DB] Migrated: added fee_adjusted to prospectus_inquiries');
  }

  // Migration: add fee_month column to transaction tables if missing (older DBs)
  try { db.prepare('SELECT fee_month FROM fee_transactions_stage LIMIT 1').get(); }
  catch { db.exec("ALTER TABLE fee_transactions_stage ADD COLUMN fee_month TEXT NOT NULL DEFAULT ''"); console.log('[DB] Migrated: added fee_month to fee_transactions_stage'); }
  try { db.prepare('SELECT fee_month FROM fee_transactions LIMIT 1').get(); }
  catch { db.exec("ALTER TABLE fee_transactions ADD COLUMN fee_month TEXT NOT NULL DEFAULT ''"); console.log('[DB] Migrated: added fee_month to fee_transactions'); }

  // Migration: add due_month column to fee_structure if missing (older DBs)
  try { db.prepare('SELECT due_month FROM fee_structure LIMIT 1').get(); }
  catch { db.exec("ALTER TABLE fee_structure ADD COLUMN due_month TEXT NOT NULL DEFAULT ''"); console.log('[DB] Migrated: added due_month to fee_structure'); }

  // Migration: add receipt fields (paid_by, amount_tendered, fee_type) to transaction tables
  for (const table of ['fee_transactions_stage', 'fee_transactions']) {
    try { db.prepare(`SELECT paid_by FROM ${table} LIMIT 1`).get(); }
    catch { db.exec(`ALTER TABLE ${table} ADD COLUMN paid_by TEXT NOT NULL DEFAULT ''`); console.log(`[DB] Migrated: added paid_by to ${table}`); }
    try { db.prepare(`SELECT amount_tendered FROM ${table} LIMIT 1`).get(); }
    catch { db.exec(`ALTER TABLE ${table} ADD COLUMN amount_tendered REAL NOT NULL DEFAULT 0`); console.log(`[DB] Migrated: added amount_tendered to ${table}`); }
    try { db.prepare(`SELECT fee_type FROM ${table} LIMIT 1`).get(); }
    catch { db.exec(`ALTER TABLE ${table} ADD COLUMN fee_type TEXT NOT NULL DEFAULT ''`); console.log(`[DB] Migrated: added fee_type to ${table}`); }
  }

  // One-time backfill: derive fee_month for existing RECEIVABLE rows from their
  // description text, e.g. "Tuition Fee (Apr 2026)" or "Transport Fee (April-26)".
  // Rows we can't confidently parse are left blank — the monthly report falls
  // back to the transaction date for those.
  backfillFeeMonths();
  backfillNonMonthlyFeeDescriptions();
  backfillMissingFeeTypes();

  // Seed default center + counter
  const centerCount = db.prepare('SELECT COUNT(*) as c FROM collection_centers').get().c;
  if (centerCount === 0) {
    db.prepare("INSERT INTO collection_centers (center_name, center_code, address) VALUES (?,?,?)")
      .run('BPS Sherpur-Nayser', 'BPSSH', 'Village Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131');
    db.prepare("INSERT INTO fee_counters (center_id, counter_name, counter_code) VALUES (1,'Main Counter','C-01')")
      .run();
    console.log('[DB] Default center and counter seeded');
  }


  // Cash Book — expense entries (payments side)
  db.exec(`CREATE TABLE IF NOT EXISTS cash_expenses (
    expense_id   INTEGER  PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT     NOT NULL,
    academic_year TEXT    NOT NULL,
    category     TEXT     NOT NULL DEFAULT 'Other',
    description  TEXT     NOT NULL DEFAULT '',
    cash_amount  REAL     NOT NULL DEFAULT 0,
    bank_amount  REAL     NOT NULL DEFAULT 0,
    entered_by   TEXT     NOT NULL DEFAULT '',
    created_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

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

// ── Attendance-specific student search (ACTIVE only, class-filtered) ──
ipcMain.handle('attendance:searchStudent', (_evt, { query, class: cls, section }) => {
  try {
    const q      = '%' + (query || '') + '%';
    let   sql    = "SELECT admission_number, student_name, father_name, gender, current_class, section, date_of_birth FROM enrollment WHERE student_status = 'ACTIVE' AND (student_name LIKE ? OR admission_number LIKE ?)";
    const params = [q, q];

    if (cls) {
      sql += ' AND LOWER(current_class) = LOWER(?)';
      params.push(cls);
    }
    if (cls && section) {
      sql += ' AND section = ?';
      params.push(section);
    }
    sql += ' ORDER BY student_name LIMIT 20';

    const rows = db.prepare(sql).all(...params);
    return { success: true, data: rows };
  } catch(err) { return { success: false, message: err.message }; }
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
      student_status,
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
      student_status,
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
    const totalPending  = db.prepare("SELECT COUNT(*) as c FROM temp_admissions").get().c;
    const totalRejected = db.prepare("SELECT COUNT(*) as c FROM rejected_admissions").get().c;
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
      SELECT temp_id, student_name, class_of_admission,
             submitted_at as created_at
      FROM temp_admissions
      ORDER BY submitted_at ASC
      LIMIT 5
    `).all();

    // ── Staff's own submissions (only if submittedBy is set) ─────
    const myPending = submittedBy
      ? [
          ...db.prepare(`
            SELECT temp_id as id, student_name, class_of_admission,
                   'PENDING' as student_status, submitted_at as created_at, '' as rejected_reason
            FROM temp_admissions WHERE submitted_by = ?
            ORDER BY submitted_at DESC LIMIT 5
          `).all(submittedBy),
          ...db.prepare(`
            SELECT reject_id as id, student_name, class_of_admission,
                   'REJECTED' as student_status, submitted_at as created_at, rejected_reason
            FROM rejected_admissions WHERE submitted_by = ?
            ORDER BY rejected_at DESC LIMIT 5
          `).all(submittedBy),
        ]
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
    // Counter is GLOBAL across all years — never resets
    // e.g. last was BPS2025-0563, next is BPS2026-0564 (not BPS2026-0001)
    const lastReal = db.prepare(`
      SELECT admission_number FROM enrollment
      WHERE admission_number LIKE 'BPS%-%'
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
      SELECT a.admission_number, a.student_name, a.date, a.status,
             COALESCE(r.roll_number, 999) as roll_number
      FROM attendance_daily a
      LEFT JOIN roll_numbers r
             ON r.admission_number = a.admission_number
            AND r.class            = a.class
            AND r.section          = a.section
            AND r.academic_year    = a.academic_year
      WHERE LOWER(a.class) = LOWER(?)
      AND   a.section       = ?
      AND   SUBSTR(a.date, 4, 2) = ?
      AND   SUBSTR(a.date, 7, 4) = ?
      AND   a.academic_year = ?
      ORDER BY roll_number, a.student_name, a.date
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


// ── Get a single student's attendance for a month ─────────────
ipcMain.handle('attendance:getStudentMonth', (_evt, { admission_number, month, year, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT date, status FROM attendance_daily
      WHERE admission_number = ?
      AND   SUBSTR(date, 4, 2) = ?
      AND   SUBSTR(date, 7, 4) = ?
      AND   academic_year = ?
    `).all(admission_number, month, year, academic_year);
    return { success: true, data: rows };
  } catch(err) { return { success: false, message: err.message }; }
});

// ── Save a single student's attendance for multiple dates ──────
ipcMain.handle('attendance:saveStudentMonth', (_evt, { admission_number, student_name, class: cls, section, academic_year, records, entered_by }) => {
  try {
    const del = db.prepare('DELETE FROM attendance_daily WHERE admission_number=? AND date=? AND academic_year=?');
    const ins = db.prepare(`
      INSERT INTO attendance_daily (admission_number, student_name, class, section, date, academic_year, status, marked_by)
      VALUES (?,?,?,?,?,?,?,?)
    `);
    const saveAll = db.transaction(() => {
      records.forEach(r => {
        del.run(admission_number, r.date, academic_year);
        if (r.status) ins.run(admission_number, student_name, cls, section, r.date, academic_year, r.status, entered_by || 'admin');
      });
    });
    saveAll();
    return { success: true };
  } catch(err) { return { success: false, message: err.message }; }
});
// ── Get progressive (year-to-date) attendance ────────────────
ipcMain.handle('attendance:getProgressive', (_evt, { class: cls, section, academic_year, up_to_month, up_to_year }) => {
  try {
    // Compare dates as YYYYMM integers to handle Jan-Mar of second year correctly
    const upTo = parseInt(up_to_year) * 100 + parseInt(up_to_month);

    const rows = db.prepare(`
      SELECT admission_number,
             SUM(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) as total_present,
             COUNT(*) as total_days
      FROM   attendance_daily
      WHERE  LOWER(class)   = LOWER(?)
      AND    section         = ?
      AND    academic_year   = ?
      AND    (CAST(SUBSTR(date,7,4) AS INTEGER) * 100 + CAST(SUBSTR(date,4,2) AS INTEGER)) <= ?
      GROUP  BY admission_number
    `).all(cls, section, academic_year, upTo);

    // Total distinct class days held up to this month
    const totalRow = db.prepare(`
      SELECT COUNT(DISTINCT date) as total
      FROM   attendance_daily
      WHERE  LOWER(class)   = LOWER(?)
      AND    section         = ?
      AND    academic_year   = ?
      AND    (CAST(SUBSTR(date,7,4) AS INTEGER) * 100 + CAST(SUBSTR(date,4,2) AS INTEGER)) <= ?
    `).get(cls, section, academic_year, upTo);

    return { success: true, data: rows, total_days: totalRow?.total || 0 };
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

// ══════════════════════════════════════════════════════════════
// EXAMINATION HANDLERS
// ══════════════════════════════════════════════════════════════

// ── Get students for a class ──────────────────────────────────
ipcMain.handle('exam:getStudents', (_evt, { class: cls, section, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT e.admission_number, e.student_name, e.father_name,
             e.mother_name, e.date_of_birth,
             COALESCE(r.roll_number, 999) as roll_number
      FROM   enrollment e
      LEFT JOIN roll_numbers r
             ON r.admission_number = e.admission_number
            AND r.class            = e.current_class
            AND r.section          = e.section
            AND r.academic_year    = ?
      WHERE  LOWER(e.current_class) = LOWER(?)
      AND    e.section       = ?
      AND    e.student_status = 'ACTIVE'
      ORDER  BY roll_number, e.student_name
    `).all(academic_year, cls, section);
    return { success: true, data: rows };
  } catch(err) { return { success: false, message: err.message }; }
});

// ── Get marks for a class / exam ─────────────────────────────
ipcMain.handle('exam:getMarks', (_evt, { class: cls, section, academic_year, exam_type }) => {
  try {
    const where = exam_type
      ? 'WHERE class=? AND section=? AND academic_year=? AND exam_type=?'
      : 'WHERE class=? AND section=? AND academic_year=?';
    const params = exam_type
      ? [cls, section, academic_year, exam_type]
      : [cls, section, academic_year];
    const rows = db.prepare(
      `SELECT admission_number, exam_type, subject, max_marks, marks_obtained, is_absent FROM exam_marks ${where}`
    ).all(...params);
    return { success: true, data: rows };
  } catch(err) { return { success: false, message: err.message }; }
});

// ── Save marks ────────────────────────────────────────────────
ipcMain.handle('exam:saveMarks', (_evt, { class: cls, section, academic_year, exam_type, marks, entered_by, auto_lock }) => {
  try {
    const del = db.prepare(
      'DELETE FROM exam_marks WHERE admission_number=? AND academic_year=? AND exam_type=? AND subject=?'
    );
    const ins = db.prepare(`
      INSERT INTO exam_marks
        (admission_number, student_name, class, section, academic_year, exam_type, subject, max_marks, marks_obtained, is_absent, entered_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    const saveAll = db.transaction(() => {
      marks.forEach(m => {
        del.run(m.admission_number, academic_year, exam_type, m.subject);
        ins.run(
          m.admission_number, m.student_name, cls, section, academic_year,
          exam_type, m.subject, m.max_marks,
          m.is_absent ? null : (m.marks_obtained ?? null),
          m.is_absent ? 1 : 0,
          entered_by || ''
        );
      });
    });
    saveAll();

    // Auto-lock for teachers
    if (auto_lock) {
      db.prepare(`
        INSERT OR REPLACE INTO exam_locks (class, section, academic_year, exam_type, locked_by)
        VALUES (?,?,?,?,?)
      `).run(cls, section, academic_year, exam_type, entered_by || '');
    }
    return { success: true };
  } catch(err) { return { success: false, message: err.message }; }
});

// ── Lock / Unlock ─────────────────────────────────────────────
ipcMain.handle('exam:lock', (_evt, { class: cls, section, academic_year, exam_type, locked_by }) => {
  try {
    db.prepare(`INSERT OR REPLACE INTO exam_locks (class,section,academic_year,exam_type,locked_by) VALUES (?,?,?,?,?)`)
      .run(cls, section, academic_year, exam_type, locked_by || '');
    return { success: true };
  } catch(err) { return { success: false, message: err.message }; }
});

ipcMain.handle('exam:unlock', (_evt, { class: cls, section, academic_year, exam_type }) => {
  try {
    db.prepare('DELETE FROM exam_locks WHERE class=? AND section=? AND academic_year=? AND exam_type=?')
      .run(cls, section, academic_year, exam_type);
    return { success: true };
  } catch(err) { return { success: false, message: err.message }; }
});

ipcMain.handle('exam:checkLocked', (_evt, { class: cls, section, academic_year, exam_type }) => {
  try {
    const row = db.prepare(
      'SELECT locked_by, locked_at FROM exam_locks WHERE class=? AND section=? AND academic_year=? AND exam_type=?'
    ).get(cls, section, academic_year, exam_type);
    return { success: true, locked: !!row, locked_by: row?.locked_by || '', locked_at: row?.locked_at || '' };
  } catch(err) { return { success: false, message: err.message }; }
});

// ── Submission status overview ────────────────────────────────
ipcMain.handle('exam:getStatus', (_evt, { academic_year, class: cls, section }) => {
  try {
    const locks = db.prepare(`
      SELECT class, section, exam_type, locked_by, locked_at
      FROM exam_locks WHERE academic_year=?
      ${cls ? 'AND class=?' : ''}
      ${section ? 'AND section=?' : ''}
    `).all(...[academic_year, cls, section].filter(Boolean));

    const counts = db.prepare(`
      SELECT class, section, exam_type, COUNT(DISTINCT admission_number) as student_count
      FROM exam_marks WHERE academic_year=?
      ${cls ? 'AND class=?' : ''}
      ${section ? 'AND section=?' : ''}
      GROUP BY class, section, exam_type
    `).all(...[academic_year, cls, section].filter(Boolean));

    return { success: true, locks, counts };
  } catch(err) { return { success: false, message: err.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — IPC HANDLERS (Phase 1)
// ══════════════════════════════════════════════════════════════

ipcMain.handle('feeSettings:get', (_evt, academic_year) => {
  try {
    const row = db.prepare('SELECT * FROM fee_settings WHERE academic_year = ?').get(academic_year);
    return { success: true, data: row || null };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('feeSettings:save', (_evt, data) => {
  try {
    db.prepare(`
      INSERT INTO fee_settings
        (academic_year, late_fee_per_day, grace_period_days, late_fee_annual_cap,
         security_deposit, prospectus_fee, tc_fee,
         sibling_concession_pct, sibling_concession_from, created_by, updated_at)
      VALUES
        (@academic_year, @late_fee_per_day, @grace_period_days, @late_fee_annual_cap,
         @security_deposit, @prospectus_fee, @tc_fee,
         @sibling_concession_pct, @sibling_concession_from, @created_by, datetime('now','localtime'))
      ON CONFLICT(academic_year) DO UPDATE SET
        late_fee_per_day        = excluded.late_fee_per_day,
        grace_period_days       = excluded.grace_period_days,
        late_fee_annual_cap     = excluded.late_fee_annual_cap,
        security_deposit        = excluded.security_deposit,
        prospectus_fee          = excluded.prospectus_fee,
        tc_fee                  = excluded.tc_fee,
        sibling_concession_pct  = excluded.sibling_concession_pct,
        sibling_concession_from = excluded.sibling_concession_from,
        updated_at              = datetime('now','localtime')
    `).run(data);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('feeStructure:get', (_evt, academic_year) => {
  try {
    const rows = db.prepare('SELECT * FROM fee_structure WHERE academic_year = ?').all(academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('feeStructure:save', (_evt, { academic_year, entries }) => {
  try {
    const upsert = db.prepare(`
      INSERT INTO fee_structure (academic_year, class, fee_type, amount, frequency, due_month, updated_at)
      VALUES (@academic_year, @class, @fee_type, @amount, @frequency, @due_month, datetime('now','localtime'))
      ON CONFLICT(academic_year, class, fee_type) DO UPDATE SET
        amount     = excluded.amount,
        due_month  = excluded.due_month,
        updated_at = datetime('now','localtime')
    `);
    const saveAll = db.transaction(() => {
      entries.forEach(e => upsert.run({
        academic_year,
        class: e.class,
        fee_type: e.fee_type,
        amount: e.amount || 0,
        frequency: e.frequency,
        due_month: e.due_month || ''
      }));
    });
    saveAll();
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('feeStructure:copyFromYear', (_evt, { from_year, to_year }) => {
  try {
    const existing = db.prepare('SELECT COUNT(*) as c FROM fee_structure WHERE academic_year = ?').get(to_year).c;
    if (existing > 0) return { success: false, message: 'Fee structure for ' + to_year + ' already exists. Clear it first.' };
    const rows = db.prepare('SELECT * FROM fee_structure WHERE academic_year = ?').all(from_year);
    if (rows.length === 0) return { success: false, message: 'No fee structure found for ' + from_year };
    const ins = db.prepare('INSERT INTO fee_structure (academic_year, class, fee_type, amount, frequency, due_month) VALUES (?,?,?,?,?,?)');
    const copy = db.transaction(() => { rows.forEach(r => ins.run(to_year, r.class, r.fee_type, r.amount, r.frequency, r.due_month || '')); });
    copy();
    return { success: true, count: rows.length };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('transportRoutes:getAll', (_evt, academic_year) => {
  try {
    const rows = db.prepare('SELECT * FROM transport_routes WHERE academic_year = ? ORDER BY route_name').all(academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('transportRoutes:save', (_evt, data) => {
  try {
    if (data.route_id) {
      db.prepare('UPDATE transport_routes SET route_name=?, pickup_points=?, monthly_amount=?, is_active=? WHERE route_id=?')
        .run(data.route_name, data.pickup_points || '', data.monthly_amount || 0, data.is_active ? 1 : 0, data.route_id);
    } else {
      db.prepare('INSERT INTO transport_routes (academic_year, route_name, pickup_points, monthly_amount, created_by) VALUES (?,?,?,?,?)')
        .run(data.academic_year, data.route_name, data.pickup_points || '', data.monthly_amount || 0, data.created_by || '');
    }
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('transportRoutes:delete', (_evt, route_id) => {
  try {
    db.prepare('UPDATE transport_routes SET is_active = 0 WHERE route_id = ?').run(route_id);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('centers:getAll', () => {
  try {
    const centers  = db.prepare('SELECT * FROM collection_centers WHERE is_active = 1 ORDER BY center_name').all();
    const counters = db.prepare('SELECT * FROM fee_counters ORDER BY counter_code').all();
    return { success: true, centers, counters };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('centers:saveCenter', (_evt, data) => {
  try {
    if (data.center_id) {
      db.prepare('UPDATE collection_centers SET center_name=?, center_code=?, address=?, is_active=? WHERE center_id=?')
        .run(data.center_name, data.center_code, data.address || '', data.is_active ? 1 : 0, data.center_id);
    } else {
      db.prepare('INSERT INTO collection_centers (center_name, center_code, address) VALUES (?,?,?)')
        .run(data.center_name, data.center_code, data.address || '');
    }
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('centers:saveCounter', (_evt, data) => {
  try {
    if (data.counter_id) {
      db.prepare('UPDATE fee_counters SET counter_name=?, counter_code=?, is_active=? WHERE counter_id=?')
        .run(data.counter_name, data.counter_code, data.is_active ? 1 : 0, data.counter_id);
    } else {
      db.prepare('INSERT INTO fee_counters (center_id, counter_name, counter_code) VALUES (?,?,?)')
        .run(data.center_id, data.counter_name, data.counter_code);
    }
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — LEDGER HANDLERS (Phase 2)
// ══════════════════════════════════════════════════════════════

// Get students not yet assigned a ledger for this year (with optional class filter)
ipcMain.handle('feeLedger:getUnassigned', (_evt, { academic_year, class: cls } = {}) => {
  try {
    let sql = `
      SELECT e.admission_number, e.student_name, e.father_name,
             e.current_class, e.section, e.student_status
      FROM   enrollment e
      WHERE  e.student_status = 'ACTIVE'
      AND    e.admission_number NOT IN (
               SELECT admission_number FROM fee_ledger WHERE academic_year = ?
             )
    `;
    const params = [academic_year];
    if (cls) { sql += ' AND LOWER(e.current_class) = LOWER(?)'; params.push(cls); }
    sql += ' ORDER BY e.student_name';
    const rows = db.prepare(sql).all(...params);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get previous year closing balance for a student
ipcMain.handle('feeLedger:getPrevBalance', (_evt, { admission_number, academic_year }) => {
  try {
    // Previous year = split year, go back one
    const [y1] = academic_year.split('-');
    const prevYear = (parseInt(y1) - 1) + '-' + String(parseInt(y1)).slice(2);

    // Get their ledger from previous year
    const prevLedger = db.prepare(
      'SELECT ledger_id, sl_number FROM fee_ledger WHERE admission_number = ? AND academic_year = ?'
    ).get(admission_number, prevYear);
    if (!prevLedger) return { success: true, balance: 0 };

    // Sum all debits - credits from posted transactions
    const txn = db.prepare(`
      SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS balance
      FROM   fee_transactions
      WHERE  ledger_id = ? AND academic_year = ?
    `).get(prevLedger.ledger_id, prevYear);

    const balance = (txn?.balance || 0) + 0;
    return { success: true, balance: Math.max(0, balance) };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get next available SL number for year
ipcMain.handle('feeLedger:getNextSL', (_evt, academic_year) => {
  try {
    const row = db.prepare(`
      SELECT sl_number FROM fee_ledger
      WHERE  academic_year = ?
      ORDER  BY CAST(SUBSTR(sl_number, 4) AS INTEGER) DESC LIMIT 1
    `).get(academic_year);
    if (!row) return { success: true, next: 1 };
    const num = parseInt(row.sl_number.replace('SL-', '')) + 1;
    return { success: true, next: num };
  } catch(e) { return { success: false, message: e.message }; }
});

// Create ledgers — incremental, gets next SL automatically
ipcMain.handle('feeLedger:createBulk', (_evt, { academic_year, entries, created_by }) => {
  try {
    // Get current highest SL number for this year
    const maxRow = db.prepare(
      "SELECT MAX(CAST(SUBSTR(sl_number,4) AS INTEGER)) as mx FROM fee_ledger WHERE academic_year=?"
    ).get(academic_year);
    let nextSL = (maxRow?.mx || 0) + 1;

    const ins = db.prepare(`
      INSERT INTO fee_ledger
        (sl_number, admission_number, student_name, current_class, section,
         academic_year, opening_balance, transport_route_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?)
    `);
    const create = db.transaction(() => {
      entries.forEach(e => {
        const sl = 'SL-' + String(nextSL).padStart(4, '0');
        ins.run(
          sl, e.admission_number, e.student_name,
          e.current_class, e.section, academic_year,
          e.opening_balance || 0, null, created_by || ''
        );
        nextSL++;
      });
    });
    create();
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Remove a single member from their sibling group
ipcMain.handle('feeLedger:removeFromGroup', (_evt, { ledger_id }) => {
  try {
    const member = db.prepare('SELECT * FROM fee_group_members WHERE ledger_id = ?').get(ledger_id);
    if (!member) return { success: false, message: 'Student is not in a group.' };

    const groupId = member.group_id;
    db.prepare('DELETE FROM fee_group_members WHERE ledger_id = ?').run(ledger_id);
    db.prepare('UPDATE fee_ledger SET group_id = NULL WHERE ledger_id = ?').run(ledger_id);

    // Check remaining members in group
    const remaining = db.prepare('SELECT * FROM fee_group_members WHERE group_id = ?').all(groupId);
    if (remaining.length <= 1) {
      // Dissolve group entirely if only 0-1 members left
      remaining.forEach(m => {
        db.prepare('UPDATE fee_ledger SET group_id = NULL WHERE ledger_id = ?').run(m.ledger_id);
      });
      db.prepare('DELETE FROM fee_group_members WHERE group_id = ?').run(groupId);
      db.prepare('DELETE FROM fee_groups WHERE group_id = ?').run(groupId);
      return { success: true, dissolved: true };
    }
    return { success: true, dissolved: false };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get students in ledger who are not yet in any group (for Make Groups step)
ipcMain.handle('feeLedger:getUngrouped', (_evt, academic_year) => {
  try {
    const rows = db.prepare(`
      SELECT l.*, e.father_name
      FROM   fee_ledger l
      LEFT JOIN enrollment e ON e.admission_number = l.admission_number
      WHERE  l.academic_year = ? AND l.group_id IS NULL
      ORDER  BY CAST(SUBSTR(l.sl_number,4) AS INTEGER)
    `).all(academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Create sibling group (GSL) with manual GSL number
ipcMain.handle('feeLedger:createGroup', (_evt, { academic_year, ledger_ids, created_by, gsl_number_manual }) => {
  try {
    const placeholders = ledger_ids.map(() => '?').join(',');
    const members = db.prepare(
      'SELECT ledger_id, sl_number, current_class FROM fee_ledger WHERE ledger_id IN (' + placeholders + ') AND academic_year = ?'
    ).all(...ledger_ids, academic_year);

    if (members.length < 2) return { success: false, message: 'Need at least 2 students to create a group.' };

    // Sort by class rank descending — oldest sibling (highest class) first
    const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
      'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };
    members.sort((a, b) => (CLASS_RANK[b.current_class] ?? -1) - (CLASS_RANK[a.current_class] ?? -1));

    // Use manual GSL number if provided, otherwise fall back to oldest sibling's SL
    const oldest    = members[0];
    const gslNumber = gsl_number_manual
      ? 'GSL-' + String(gsl_number_manual).replace(/^GSL-/i,'').padStart(4,'0')
      : 'GSL-' + oldest.sl_number.replace('SL-', '');

    // Check if group already exists
    let group = db.prepare('SELECT * FROM fee_groups WHERE gsl_number = ? AND academic_year = ?').get(gslNumber, academic_year);
    if (!group) {
      db.prepare('INSERT INTO fee_groups (gsl_number, academic_year, oldest_sl, created_by) VALUES (?,?,?,?)')
        .run(gslNumber, academic_year, oldest.sl_number, created_by || '');
      group = db.prepare('SELECT * FROM fee_groups WHERE gsl_number = ? AND academic_year = ?').get(gslNumber, academic_year);
    }

    // Add members
    const addMember = db.prepare(`
      INSERT OR REPLACE INTO fee_group_members (group_id, ledger_id, sl_number, sibling_position)
      VALUES (?,?,?,?)
    `);
    const updateLedger = db.prepare('UPDATE fee_ledger SET group_id = ? WHERE ledger_id = ?');

    const doIt = db.transaction(() => {
      members.forEach((m, i) => {
        addMember.run(group.group_id, m.ledger_id, m.sl_number, i + 1);
        updateLedger.run(group.group_id, m.ledger_id);
      });
    });
    doIt();
    return { success: true, gsl_number: gslNumber };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get all ledger entries for a year
ipcMain.handle('feeLedger:getAll', (_evt, academic_year) => {
  try {
    const rows = db.prepare(`
      SELECT l.*,
             g.gsl_number,
             t.route_name, t.monthly_amount AS transport_amount,
             e.father_name
      FROM   fee_ledger l
      LEFT JOIN fee_groups        g ON g.group_id  = l.group_id
      LEFT JOIN transport_routes  t ON t.route_id  = l.transport_route_id
      LEFT JOIN enrollment        e ON e.admission_number = l.admission_number
      WHERE  l.academic_year = ?
      ORDER  BY CAST(SUBSTR(l.sl_number, 4) AS INTEGER)
    `).all(academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get full transaction history for a ledger (individual)
ipcMain.handle('feeLedger:getTransactions', (_evt, { ledger_id, academic_year }) => {
  try {
    const ledger = db.prepare(`
      SELECT l.*, g.gsl_number, e.father_name,
             t.route_name, t.monthly_amount AS transport_amount
      FROM   fee_ledger l
      LEFT JOIN fee_groups       g ON g.group_id = l.group_id
      LEFT JOIN enrollment       e ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id  = l.transport_route_id
      WHERE  l.ledger_id = ?
    `).get(ledger_id);

    if (!ledger) return { success: false, message: 'Ledger not found' };

    // Posted transactions
    const posted = db.prepare(`
      SELECT *, 'POSTED' as source FROM fee_transactions
      WHERE  ledger_id = ? AND academic_year = ?
      ORDER  BY collected_at, txn_id
    `).all(ledger_id, academic_year);

    // Staged (pending, not yet posted)
    const staged = db.prepare(`
      SELECT *, 'STAGED' as source FROM fee_transactions_stage
      WHERE  ledger_id = ? AND academic_year = ? AND status = 'PENDING'
      ORDER  BY collected_at, stage_id
    `).all(ledger_id, academic_year);

    const all = [...posted, ...staged];

    // Calculate running balance
    let balance = ledger.opening_balance || 0;
    const transactions = all.map(t => {
      balance += (t.debit || 0) - (t.credit || 0) - (t.concession || 0);
      return { ...t, running_balance: balance };
    });

    return { success: true, ledger, transactions, final_balance: balance };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get group transaction history (combined for GSL)
ipcMain.handle('feeLedger:getGroupTransactions', (_evt, { group_id, academic_year }) => {
  try {
    const group = db.prepare('SELECT * FROM fee_groups WHERE group_id = ?').get(group_id);
    if (!group) return { success: false, message: 'Group not found' };

    const members = db.prepare(`
      SELECT l.*, e.father_name, gm.sibling_position,
             t.route_name
      FROM   fee_group_members gm
      JOIN   fee_ledger   l  ON l.ledger_id = gm.ledger_id
      JOIN   enrollment   e  ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id = l.transport_route_id
      WHERE  gm.group_id = ?
      ORDER  BY gm.sibling_position
    `).all(group_id);

    // Aggregate transactions across all members
    const ledgerIds = members.map(m => m.ledger_id);
    const placeholders = ledgerIds.map(() => '?').join(',');

    const posted = db.prepare(
      'SELECT *, ledger_id, "POSTED" as source FROM fee_transactions WHERE ledger_id IN (' + placeholders + ') AND academic_year = ? ORDER BY collected_at'
    ).all(...ledgerIds, academic_year);

    const staged = db.prepare(
      'SELECT *, ledger_id, "STAGED" as source FROM fee_transactions_stage WHERE ledger_id IN (' + placeholders + ') AND academic_year = ? AND status = "PENDING" ORDER BY collected_at'
    ).all(...ledgerIds, academic_year);

    // Combined opening balance
    const totalOpening = members.reduce((s, m) => s + (m.opening_balance || 0), 0);
    let balance = totalOpening;
    const all = [...posted, ...staged].map(t => {
      balance += (t.debit || 0) - (t.credit || 0) - (t.concession || 0);
      return { ...t, running_balance: balance };
    });

    return { success: true, group, members, transactions: all, final_balance: balance };
  } catch(e) { return { success: false, message: e.message }; }
});

// Update physical page
ipcMain.handle('feeLedger:updatePage', (_evt, { ledger_id, physical_page }) => {
  try {
    db.prepare('UPDATE fee_ledger SET physical_page = ? WHERE ledger_id = ?').run(physical_page, ledger_id);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Update opening balance
ipcMain.handle('feeLedger:updateOpeningBalance', (_evt, { ledger_id, opening_balance }) => {
  try {
    db.prepare('UPDATE fee_ledger SET opening_balance = ? WHERE ledger_id = ?').run(opening_balance, ledger_id);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Search ledger by SL number, student name, or GSL number
ipcMain.handle('feeLedger:search', (_evt, { query, academic_year }) => {
  try {
    const q = '%' + (query || '') + '%';
    const rows = db.prepare(`
      SELECT l.*, g.gsl_number, g.group_id as gsl_group_id, e.father_name, t.route_name
      FROM   fee_ledger l
      LEFT JOIN fee_groups       g ON g.group_id = l.group_id
      LEFT JOIN enrollment       e ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id = l.transport_route_id
      WHERE  l.academic_year = ?
      AND   (l.sl_number LIKE ? OR l.student_name LIKE ? OR g.gsl_number LIKE ?)
      ORDER  BY CAST(SUBSTR(l.sl_number,4) AS INTEGER)
      LIMIT  20
    `).all(academic_year, q, q, q, );

    // If searching by GSL, also include a group entry at the top
    const gslQuery = (query || '').toUpperCase();
    const groupEntries = [];
    if (gslQuery.startsWith('GSL')) {
      const grp = db.prepare('SELECT * FROM fee_groups WHERE gsl_number LIKE ? AND academic_year = ?')
        .get('%' + query + '%', academic_year);
      if (grp) {
        const members = db.prepare(`
          SELECT l.*, e.father_name FROM fee_group_members gm
          JOIN fee_ledger l ON l.ledger_id = gm.ledger_id
          LEFT JOIN enrollment e ON e.admission_number = l.admission_number
          WHERE gm.group_id = ?
          ORDER BY gm.sibling_position
        `).all(grp.group_id);
        groupEntries.push({
          is_group_entry: true,
          group_id: grp.group_id,
          gsl_number: grp.gsl_number,
          member_count: members.length,
          members,
          student_name: grp.gsl_number + ' — Group (' + members.length + ' siblings)',
          current_class: members.map(m => m.current_class).join(', '),
          sl_number: grp.gsl_number,
        });
      }
    }

    return { success: true, data: [...groupEntries, ...rows] };
  } catch(e) { return { success: false, message: e.message }; }
});

// Monthly Fee Pending Report — one row per student showing:
//   Previous Balance (everything due before the selected month)
//   Fee Due          (new charges raised FOR the selected month)
//   Fee Paid         (payments actually received during the selected month, by receipt date)
//   Balance          (Previous Balance + Fee Due - Fee Paid)
ipcMain.handle('feeLedger:getMonthlyReport', (_evt, { academic_year, month, year, class: cls }) => {
  try {
    if (!month || !year) return { success: false, message: 'Month and year are required' };
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`; // 'YYYY-MM'
    const firstOfMonth = `${targetMonth}-01`;

    const ledgerRows = db.prepare(`
      SELECT l.ledger_id, l.sl_number, l.student_name, l.current_class, l.section,
             l.opening_balance, e.father_name
      FROM   fee_ledger l
      LEFT JOIN enrollment e ON e.admission_number = l.admission_number
      WHERE  l.academic_year = ?
      AND    (? IS NULL OR l.current_class = ?)
      ORDER  BY CAST(SUBSTR(l.sl_number, 4) AS INTEGER)
    `).all(academic_year, cls || null, cls || null);

    // Effective month for a RECEIVABLE row: use its own fee_month tag if
    // present, otherwise fall back to the month it was actually recorded in
    // (covers historical rows saved before fee_month existed / couldn't be parsed).
    const dueBefore = db.prepare(`
      SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(concession),0) as amt
      FROM   (
        SELECT debit, concession, fee_month, collected_at FROM fee_transactions
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
        UNION ALL
        SELECT debit, concession, fee_month, collected_at FROM fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE' AND status != 'CANCELLED'
      )
      WHERE  COALESCE(NULLIF(fee_month,''), strftime('%Y-%m', collected_at)) < ?
    `);
    const dueThisMonth = db.prepare(`
      SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(concession),0) as amt
      FROM   (
        SELECT debit, concession, fee_month, collected_at FROM fee_transactions
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
        UNION ALL
        SELECT debit, concession, fee_month, collected_at FROM fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE' AND status != 'CANCELLED'
      )
      WHERE  COALESCE(NULLIF(fee_month,''), strftime('%Y-%m', collected_at)) = ?
    `);
    const paidBefore = db.prepare(`
      SELECT COALESCE(SUM(credit),0) as amt
      FROM   (
        SELECT credit, collected_at FROM fee_transactions
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED'
        UNION ALL
        SELECT credit, collected_at FROM fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND status != 'CANCELLED'
      )
      WHERE  DATE(collected_at) < ?
    `);
    const paidThisMonth = db.prepare(`
      SELECT COALESCE(SUM(credit),0) as amt
      FROM   (
        SELECT credit, collected_at FROM fee_transactions
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED'
        UNION ALL
        SELECT credit, collected_at FROM fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND status != 'CANCELLED'
      )
      WHERE  strftime('%Y-%m', collected_at) = ?
    `);

    const data = ledgerRows.map((row, i) => {
      const dueBeforeAmt   = dueBefore.get(row.ledger_id, academic_year, row.ledger_id, academic_year, targetMonth).amt || 0;
      const paidBeforeAmt  = paidBefore.get(row.ledger_id, academic_year, row.ledger_id, academic_year, firstOfMonth).amt || 0;
      const feeDueAmt      = dueThisMonth.get(row.ledger_id, academic_year, row.ledger_id, academic_year, targetMonth).amt || 0;
      const feePaidAmt     = paidThisMonth.get(row.ledger_id, academic_year, row.ledger_id, academic_year, targetMonth).amt || 0;

      const prevBalance = (row.opening_balance || 0) + dueBeforeAmt - paidBeforeAmt;
      const balance     = prevBalance + feeDueAmt - feePaidAmt;

      return {
        sr_no:         i + 1,
        ledger_id:     row.ledger_id,
        sl_number:     row.sl_number,
        student_name:  row.student_name,
        current_class: row.current_class,
        section:       row.section,
        father_name:   row.father_name || '',
        prev_balance:  Math.round(prevBalance * 100) / 100,
        fee_due:       Math.round(feeDueAmt * 100) / 100,
        fee_paid:      Math.round(feePaidAmt * 100) / 100,
        balance:       Math.round(balance * 100) / 100,
      };
    });

    return { success: true, data, month_label: targetMonth };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — COUNTER PAYMENT HANDLERS (Phase 3)
// ══════════════════════════════════════════════════════════════

// Get next receipt number for academic year
ipcMain.handle('counter:getNextReceipt', (_evt, academic_year) => {
  try {
    const yr = academic_year.split('-')[0];
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');

    // The running sequence is scoped to the whole academic year, not the
    // month — only the month digits (joined straight onto the year, no dash)
    // change to reflect when a receipt was actually made. The count itself
    // only resets when a new academic year begins (a fresh 'yr%' prefix has
    // no matches yet). The broader 'yr%' prefix (rather than 'yr-%') is what
    // catches every format this receipt number has ever used, so the count
    // stays continuous even across a format change like this one.
    const rows = db.prepare(
      'SELECT receipt_number FROM fee_transactions_stage WHERE academic_year = ? AND receipt_number LIKE ?'
    ).all(academic_year, yr + '%');

    let maxSeq = 0;
    rows.forEach(r => {
      const parts = String(r.receipt_number).split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    });

    const nextSeq = maxSeq + 1;
    const receipt_number = `${yr}${currentMonth}-${String(nextSeq).padStart(4, '0')}`;
    return { success: true, receipt_number };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get student ledger + smart fee suggestions for payment screen
ipcMain.handle('counter:getLedgerForPayment', (_evt, { query, academic_year }) => {
  try {
    const q = '%' + (query || '') + '%';
    // Search by SL number or student name
    const ledger = db.prepare(`
      SELECT l.*, g.gsl_number, g.group_id as gsl_group_id,
             e.father_name, e.date_of_birth, e.mobile_number, e.date_of_admission,
             t.route_name, t.monthly_amount as transport_amount,
             c.center_name, c.center_code
      FROM   fee_ledger l
      LEFT JOIN fee_groups       g  ON g.group_id = l.group_id
      LEFT JOIN enrollment       e  ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t  ON t.route_id = l.transport_route_id
      LEFT JOIN collection_centers c ON c.center_id = 1
      WHERE  l.academic_year = ?
      AND   (l.sl_number LIKE ? OR l.student_name LIKE ? OR l.admission_number LIKE ?)
      LIMIT  1
    `).get(academic_year, q, q, q);
    if (!ledger) return { success: false, message: 'No ledger found. Has this student been assigned a ledger for ' + academic_year + '?' };

    const currentFeeMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    // Get what fees have already been charged this year (from both staged and posted)
    const chargedStaged = db.prepare(
      'SELECT description, SUM(debit) as total FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND status != ? GROUP BY description'
    ).all(ledger.ledger_id, academic_year, 'CANCELLED');
    const chargedPosted = db.prepare(
      'SELECT description, SUM(debit) as total FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? GROUP BY description'
    ).all(ledger.ledger_id, academic_year);

    // Previous Balance — everything owed BEFORE the current month. The
    // current month's own dues are shown separately (currentMonthItems
    // below), so they're deliberately excluded here to avoid counting twice.
    const postedBal = db.prepare(
      'SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? AND fee_month != ?'
    ).get(ledger.ledger_id, academic_year, currentFeeMonth);
    const stagedBal = db.prepare(
      'SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND status = ? AND fee_month != ?'
    ).get(ledger.ledger_id, academic_year, 'PENDING', currentFeeMonth);

    const prevBalance = (ledger.opening_balance || 0) + (postedBal?.bal || 0) + (stagedBal?.bal || 0);

    // Anything already paid THIS month (e.g. an earlier partial payment on
    // the same receipt cycle) — this needs to be shown and subtracted
    // explicitly, since it's excluded from prevBalance above (it's not
    // "previous") and current month's items are just the raw dues, not
    // net of any payment already made against them.
    const paidThisMonth = db.prepare(`
      SELECT COALESCE(SUM(credit),0) as paid FROM (
        SELECT credit FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ?
        UNION ALL
        SELECT credit FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ? AND status != 'CANCELLED'
      )
    `).get(ledger.ledger_id, academic_year, currentFeeMonth, ledger.ledger_id, academic_year, currentFeeMonth);
    const alreadyPaidThisMonth = paidThisMonth?.paid || 0;

    // Current month's dues — already generated by Auto Accrual (or a prior
    // payment this month). If this comes back empty, nothing's been
    // generated yet for this student this month.
    const currentMonthItems = db.prepare(`
      SELECT stage_id as existing_stage_id, description, debit as amount, concession, concession_reason, fee_type
      FROM   fee_transactions_stage
      WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
        AND  fee_month = ? AND status != 'CANCELLED'
    `).all(ledger.ledger_id, academic_year, currentFeeMonth)
      .map(i => ({ ...i, fee_type: i.fee_type || _guessFeeTypeFromDescription(i.description) || '' }));

    // Fee settings for late fee calc
    const settings = db.prepare('SELECT * FROM fee_settings WHERE academic_year = ?').get(academic_year)
      || { late_fee_per_day: 5, grace_period_days: 10, late_fee_annual_cap: 1000 };

    // Build charged map
    const chargedMap = {};
    [...chargedStaged, ...chargedPosted].forEach(r => {
      chargedMap[r.description] = (chargedMap[r.description] || 0) + (r.total || 0);
    });

    return {
      success: true,
      ledger,
      chargedMap,
      prevBalance,
      settings,
      currentMonthItems,
      currentMonthGenerated: currentMonthItems.length > 0,
      current_fee_month: currentFeeMonth,
      alreadyPaidThisMonth,
    };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get GSL group for payment
ipcMain.handle('counter:getGroupForPayment', (_evt, { query, academic_year }) => {
  try {
    const q = '%' + (query || '') + '%';
    const group = db.prepare(
      'SELECT * FROM fee_groups WHERE academic_year = ? AND gsl_number LIKE ?'
    ).get(academic_year, q);
    if (!group) return { success: false, message: 'No group found for ' + query };

    const members = db.prepare(`
      SELECT l.*, gm.sibling_position,
             e.father_name, e.mobile_number, e.date_of_admission,
             t.route_name, t.monthly_amount as transport_amount
      FROM   fee_group_members gm
      JOIN   fee_ledger   l  ON l.ledger_id = gm.ledger_id
      JOIN   enrollment   e  ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id = l.transport_route_id
      WHERE  gm.group_id = ?
      ORDER  BY gm.sibling_position
    `).all(group.group_id);

    // For each member get their balance and current month's already-generated dues
    const currentFeeMonth = new Date().toISOString().slice(0, 7);
    const memberDetails = members.map(m => {
      const postedBal = db.prepare(
        'SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0)-COALESCE(SUM(concession),0) as bal FROM fee_transactions WHERE ledger_id=? AND academic_year=? AND fee_month != ?'
      ).get(m.ledger_id, academic_year, currentFeeMonth);
      const stagedBal = db.prepare(
        'SELECT COALESCE(SUM(debit),0)-COALESCE(SUM(credit),0)-COALESCE(SUM(concession),0) as bal FROM fee_transactions_stage WHERE ledger_id=? AND academic_year=? AND status=? AND fee_month != ?'
      ).get(m.ledger_id, academic_year, 'PENDING', currentFeeMonth);
      const prevBalance = (m.opening_balance || 0) + (postedBal?.bal || 0) + (stagedBal?.bal || 0);
      const paidThisMonth = db.prepare(`
        SELECT COALESCE(SUM(credit),0) as paid FROM (
          SELECT credit FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ?
          UNION ALL
          SELECT credit FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ? AND status != 'CANCELLED'
        )
      `).get(m.ledger_id, academic_year, currentFeeMonth, m.ledger_id, academic_year, currentFeeMonth);
      const alreadyPaidThisMonth = paidThisMonth?.paid || 0;
      const currentMonthItems = db.prepare(`
        SELECT stage_id as existing_stage_id, description, debit as amount, concession, concession_reason, fee_type
        FROM   fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
          AND  fee_month = ? AND status != 'CANCELLED'
      `).all(m.ledger_id, academic_year, currentFeeMonth)
        .map(i => ({ ...i, fee_type: i.fee_type || _guessFeeTypeFromDescription(i.description) || '' }));
      return { ...m, prevBalance, alreadyPaidThisMonth, currentMonthItems, currentMonthGenerated: currentMonthItems.length > 0 };
    });

    const settings = db.prepare('SELECT * FROM fee_settings WHERE academic_year=?').get(academic_year)
      || { late_fee_per_day: 5, grace_period_days: 10, late_fee_annual_cap: 1000 };

    return { success: true, group, members: memberDetails, settings, current_fee_month: currentFeeMonth };
  } catch(e) { return { success: false, message: e.message }; }
});

// Save payment to staging
ipcMain.handle('counter:savePayment', (_evt, { academic_year, ledger_id, group_id, sl_number,
  receipt_number, line_items, total_paid, payment_mode, remarks,
  center_id, counter_id, collected_by, paid_by, amount_tendered,
  cheque_no, bank_name, txn_number }) => {
  try {
    const VALID_MODES = ['CASH', 'CHEQUE', 'ONLINE'];
    const mode = VALID_MODES.includes(payment_mode) ? payment_mode : 'CASH';
    let chequeDetails = '';
    if (mode === 'CHEQUE')  chequeDetails = JSON.stringify({ cheque_no: cheque_no || '', bank_name: bank_name || '' });
    if (mode === 'ONLINE')  chequeDetails = JSON.stringify({ txn_number: txn_number || '' });

    const ins = db.prepare(`
      INSERT INTO fee_transactions_stage
        (receipt_number, ledger_id, group_id, sl_number, academic_year,
         transaction_type, description, debit, credit, concession, concession_reason,
         late_fee, late_fee_waived, payment_mode, cheque_details, center_id, counter_id,
         collected_by, status, fee_month, paid_by, amount_tendered, fee_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)
    `);
    // Applies this payment's details to a due that Auto Accrual already
    // generated — the due itself is never re-created, but it needs the
    // actual payment mode, paid-by name, today's date, and receipt number
    // stamped onto it (not left as Auto Accrual's generation-time defaults),
    // since the receipt reads its header details from whichever row it finds.
    const updateConcession = db.prepare(`
      UPDATE fee_transactions_stage
      SET    concession = ?, concession_reason = ?, receipt_number = ?,
             payment_mode = ?, cheque_details = ?, paid_by = ?, amount_tendered = ?,
             collected_by = ?, center_id = ?, counter_id = ?,
             collected_at = datetime('now','localtime')
      WHERE  stage_id = ? AND ledger_id = ? AND (receipt_number IS NULL OR receipt_number = '')
    `);

    // Fee due entries are always raised for the current real-world month —
    // this powers the month-by-month pending report.
    const feeMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const tendered = (amount_tendered !== undefined && amount_tendered !== null && amount_tendered !== '')
      ? Number(amount_tendered) : Number(total_paid || 0);

    const saveAll = db.transaction(() => {
      line_items.forEach(item => {
        if (item.is_prev_balance) return;

        // Already generated by Auto Accrual — adjust its concession only,
        // never insert a second due for the same charge.
        if (item.existing_stage_id) {
          updateConcession.run(
            item.concession || 0, item.concession_reason || '', receipt_number,
            mode, chequeDetails, paid_by || '', tendered,
            collected_by, center_id || 1, counter_id || 1,
            item.existing_stage_id, ledger_id || null
          );
          return;
        }

        if ((item.amount || 0) === 0 && (item.concession || 0) === 0) return;
        ins.run(
          receipt_number, ledger_id || null, group_id || null, sl_number,
          academic_year, 'RECEIVABLE', item.description,
          item.amount || 0, 0, item.concession || 0, item.concession_reason || '',
          item.is_late_fee ? (item.amount || 0) : 0,
          item.is_late_fee ? (item.concession || 0) : 0,
          mode, chequeDetails, center_id || 1, counter_id || 1, collected_by, feeMonth,
          paid_by || '', tendered, item.fee_type || ''
        );
      });
      // Insert payment row as RECEIVED (credit)
      ins.run(
        receipt_number, ledger_id || null, group_id || null, sl_number,
        academic_year, 'RECEIVED', 'Payment received - ' + mode,
        0, total_paid, 0, remarks || '',
        0, 0,
        mode, chequeDetails, center_id || 1, counter_id || 1, collected_by, feeMonth,
        paid_by || '', tendered, ''
      );
    });
    saveAll();
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Cancel a staged payment
ipcMain.handle('counter:cancelPayment', (_evt, { receipt_number, academic_year, cancelled_by }) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM fee_transactions_stage WHERE receipt_number = ? AND academic_year = ?'
    ).all(receipt_number, academic_year);
    if (rows.length === 0) return { success: false, message: 'Receipt not found: ' + receipt_number };
    const isPosted = rows.some(r => r.schedule_id && r.schedule_id !== '');
    if (isPosted) return { success: false, message: 'This receipt has already been posted. Cancellation not allowed.' };
    db.prepare(
      'UPDATE fee_transactions_stage SET status = ? WHERE receipt_number = ? AND academic_year = ?'
    ).run('CANCELLED', receipt_number, academic_year);
    return { success: true, cancelled_count: rows.length };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get receipt for reprint
ipcMain.handle('counter:getReceipt', (_evt, { receipt_number, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT s.*, l.student_name, l.current_class, l.section, l.sl_number as ledger_sl,
             l.admission_number, l.opening_balance,
             e.father_name, e.mobile_number,
             g.gsl_number,
             c.center_name, c.center_code,
             ct.counter_name, ct.counter_code
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger          l  ON l.ledger_id   = s.ledger_id
      LEFT JOIN enrollment          e  ON e.admission_number = l.admission_number
      LEFT JOIN fee_groups          g  ON g.group_id    = l.group_id
      LEFT JOIN collection_centers  c  ON c.center_id   = s.center_id
      LEFT JOIN fee_counters        ct ON ct.counter_id = s.counter_id
      WHERE  s.receipt_number = ? AND s.academic_year = ?
    `).all(receipt_number, academic_year);
    if (rows.length === 0) return { success: false, message: 'Receipt not found' };
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get today's staged receipts for a counter (batch reconciliation)
ipcMain.handle('counter:getTodayReceipts', (_evt, { academic_year, center_id, counter_id, date }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);
    const rows = db.prepare(`
      SELECT s.receipt_number, s.sl_number, s.payment_mode, s.status,
             s.collected_at, l.student_name, l.current_class,
             SUM(CASE WHEN s.transaction_type='RECEIVED' THEN s.credit ELSE 0 END) as amount_paid
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      WHERE  s.academic_year = ?
      AND    DATE(s.collected_at) = ?
      AND    (? IS NULL OR s.center_id  = ?)
      AND    (? IS NULL OR s.counter_id = ?)
      GROUP  BY s.receipt_number
      ORDER  BY s.receipt_number
    `).all(academic_year, d, center_id || null, center_id || null, counter_id || null, counter_id || null);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// ── Print-ready receipt builder (paper-format receipt) ─────────
// Bucket columns on the printed receipt: Admission | Activity | Tuition | Transport | Others
function _bucketForFeeType(fee_type) {
  if (fee_type === 'ADMISSION') return 'admission';
  if (fee_type === 'ACTIVITY')  return 'activity';
  if (fee_type === 'TUITION')   return 'tuition';
  if (fee_type === 'TRANSPORT') return 'transport';
  return 'others';
}
// Fallback for old rows saved before fee_type existed — guesses from description text.
function _guessFeeTypeFromDescription(desc) {
  if (!desc) return null;
  const TYPES = ['TUITION','TRANSPORT','ADMISSION','ACTIVITY','COMPUTER','LIBRARY','LAB','WELLNESS','BOOKS','EXAM_HY','EXAM_ANNUAL'];
  for (const ft of TYPES) { if (desc.startsWith(_feeLabel(ft))) return ft; }
  return null;
}

// Builds the exact paper-receipt data structure for one receipt_number —
// used both right after a payment is saved and for later reprints, so the
// two can never show different numbers for the same receipt.
function _buildReceiptPrintData(receipt_number, academic_year) {
  let rows = db.prepare(`
    SELECT t.*, l.student_name, l.current_class, l.section, l.sl_number as ledger_sl,
           l.admission_number, l.opening_balance, e.father_name,
           g.gsl_number, c.center_name, c.center_code, ct.counter_name, ct.counter_code
    FROM   fee_transactions t
    LEFT JOIN fee_ledger         l  ON l.ledger_id = t.ledger_id
    LEFT JOIN enrollment         e  ON e.admission_number = l.admission_number
    LEFT JOIN fee_groups         g  ON g.group_id = t.group_id
    LEFT JOIN collection_centers c  ON c.center_id = t.center_id
    LEFT JOIN fee_counters       ct ON ct.counter_id = t.counter_id
    WHERE  t.receipt_number = ? AND t.academic_year = ?
  `).all(receipt_number, academic_year);
  let source = 'POSTED';
  if (rows.length === 0) {
    rows = db.prepare(`
      SELECT s.*, l.student_name, l.current_class, l.section, l.sl_number as ledger_sl,
             l.admission_number, l.opening_balance, e.father_name,
             g.gsl_number, c.center_name, c.center_code, ct.counter_name, ct.counter_code
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger         l  ON l.ledger_id = s.ledger_id
      LEFT JOIN enrollment         e  ON e.admission_number = l.admission_number
      LEFT JOIN fee_groups         g  ON g.group_id = s.group_id
      LEFT JOIN collection_centers c  ON c.center_id = s.center_id
      LEFT JOIN fee_counters       ct ON ct.counter_id = s.counter_id
      WHERE  s.receipt_number = ? AND s.academic_year = ?
    `).all(receipt_number, academic_year);
    source = 'STAGED';
  }
  if (rows.length === 0) return null;

  const header = rows[0];
  const isGroup = !!header.group_id;
  const table = source === 'POSTED' ? 'fee_transactions' : 'fee_transactions_stage';
  const statusFilter = source === 'POSTED' ? '' : "AND status != 'CANCELLED'";

  const prevBalStmt = db.prepare(`
    SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal
    FROM (
      SELECT debit, credit, concession FROM fee_transactions
      WHERE ledger_id = ? AND academic_year = ? AND receipt_number != ?
      UNION ALL
      SELECT debit, credit, concession FROM fee_transactions_stage
      WHERE ledger_id = ? AND academic_year = ? AND receipt_number != ? ${statusFilter}
    )
  `);
  const openingBalStmt = db.prepare('SELECT opening_balance FROM fee_ledger WHERE ledger_id = ?');

  const byLedger = {};
  rows.forEach(r => { (byLedger[r.ledger_id] ||= []).push(r); });

  const studentRows = Object.entries(byLedger).map(([ledger_id, txns]) => {
    const first = txns[0];
    const buckets = { admission: 0, activity: 0, tuition: 0, transport: 0, others: 0 };
    let concession = 0, feesPaid = 0, currentDue = 0;
    txns.forEach(t => {
      if (t.transaction_type === 'RECEIVABLE') {
        const ft = t.fee_type || _guessFeeTypeFromDescription(t.description);
        buckets[_bucketForFeeType(ft)] += (t.debit || 0);
        concession += (t.concession || 0);
        currentDue += (t.debit || 0);
      } else if (t.transaction_type === 'RECEIVED') {
        feesPaid += (t.credit || 0);
      }
    });
    const openingBal = openingBalStmt.get(ledger_id)?.opening_balance || 0;
    const priorBal = prevBalStmt.get(ledger_id, academic_year, receipt_number, ledger_id, academic_year, receipt_number).bal || 0;
    const previousBalance = openingBal + priorBal;
    const totalFeesDue = previousBalance + currentDue;
    const balance = totalFeesDue - concession - feesPaid;
    return {
      ledger_id: Number(ledger_id), sl_number: first.sl_number, student_name: first.student_name,
      father_name: first.father_name || '', current_class: first.current_class, section: first.section,
      previous_balance: Math.round(previousBalance * 100) / 100,
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      total_fees_due: Math.round(totalFeesDue * 100) / 100,
      concession: Math.round(concession * 100) / 100,
      fees_paid: Math.round(feesPaid * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    };
  }).sort((a, b) => (a.sl_number || '').localeCompare(b.sl_number || ''));

  const totals = studentRows.reduce((t, r) => ({
    previous_balance: t.previous_balance + r.previous_balance,
    admission: t.admission + r.buckets.admission, activity: t.activity + r.buckets.activity,
    tuition: t.tuition + r.buckets.tuition, transport: t.transport + r.buckets.transport, others: t.others + r.buckets.others,
    total_fees_due: t.total_fees_due + r.total_fees_due, concession: t.concession + r.concession,
    fees_paid: t.fees_paid + r.fees_paid, balance: t.balance + r.balance,
  }), { previous_balance: 0, admission: 0, activity: 0, tuition: 0, transport: 0, others: 0, total_fees_due: 0, concession: 0, fees_paid: 0, balance: 0 });
  Object.keys(totals).forEach(k => { totals[k] = Math.round(totals[k] * 100) / 100; });

  let chequeInfo = {};
  try { chequeInfo = header.cheque_details ? JSON.parse(header.cheque_details) : {}; } catch { chequeInfo = {}; }

  const amountTendered = header.amount_tendered || totals.fees_paid;
  const returnAmount = Math.max(0, Math.round((amountTendered - totals.fees_paid) * 100) / 100);

  return {
    receipt_number, academic_year, source, is_group: isGroup,
    gsl_number: header.gsl_number || '', sl_number: header.ledger_sl || header.sl_number,
    date: header.collected_at || header.posted_at,
    paid_by: header.paid_by || '', payment_mode: header.payment_mode,
    cheque_no: chequeInfo.cheque_no || '', bank_name: chequeInfo.bank_name || '', txn_number: chequeInfo.txn_number || '',
    center_name: header.center_name || '', counter_code: header.counter_code || '',
    students: studentRows, totals,
    amount_paid_by_guardian: totals.fees_paid,
    amount_given_at_counter: Math.round(amountTendered * 100) / 100,
    return_amount: returnAmount,
  };
}

ipcMain.handle('counter:getReceiptPrintData', (_evt, { receipt_number, academic_year }) => {
  try {
    const data = _buildReceiptPrintData(receipt_number, academic_year);
    if (!data) return { success: false, message: 'Receipt not found: ' + receipt_number };
    return { success: true, data };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('feeLedger:getNextGSL', (_evt, academic_year) => {
  try {
    const row = db.prepare(`
      SELECT MAX(CAST(SUBSTR(gsl_number, 5) AS INTEGER)) as mx
      FROM   fee_groups WHERE academic_year = ?
    `).get(academic_year);
    const next = (row?.mx || 0) + 1;
    return { success: true, next_gsl: 'GSL-' + String(next).padStart(4, '0'), next_num: next };
  } catch(e) { return { success: false, message: e.message }; }
});

// Add an ungrouped student to an existing group
ipcMain.handle('feeLedger:addToGroup', (_evt, { ledger_id, group_id, academic_year }) => {
  try {
    const group = db.prepare('SELECT * FROM fee_groups WHERE group_id = ?').get(group_id);
    if (!group) return { success: false, message: 'Group not found.' };

    // Self-heal: if a fee_group_members row exists for this student but their
    // own ledger.group_id doesn't actually point at that group (leftover from
    // an earlier removal/dissolve that didn't fully clean up), drop the stale
    // row instead of incorrectly blocking this add.
    const existing = db.prepare('SELECT * FROM fee_group_members WHERE ledger_id = ?').get(ledger_id);
    if (existing) {
      const currentLedgerGroup = db.prepare('SELECT group_id FROM fee_ledger WHERE ledger_id = ?').get(ledger_id);
      if (!currentLedgerGroup || currentLedgerGroup.group_id !== existing.group_id) {
        db.prepare('DELETE FROM fee_group_members WHERE ledger_id = ?').run(ledger_id);
      } else {
        return { success: false, message: 'Student is already in a group.' };
      }
    }

    const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
      'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };

    // Get all current members + new one, recalculate positions
    const allMembers = db.prepare(`
      SELECT gm.ledger_id, l.current_class
      FROM   fee_group_members gm
      JOIN   fee_ledger l ON l.ledger_id = gm.ledger_id
      WHERE  gm.group_id = ?
    `).all(group_id);

    const newLedger = db.prepare('SELECT * FROM fee_ledger WHERE ledger_id = ?').get(ledger_id);
    if (!newLedger) return { success: false, message: 'Student ledger not found.' };

    allMembers.push({ ledger_id, current_class: newLedger.current_class });
    allMembers.sort((a,b) => (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1));

    const upsertPos = db.prepare(
      'UPDATE fee_group_members SET sibling_position = ? WHERE ledger_id = ? AND group_id = ?'
    );
    const insertMember = db.prepare(
      'INSERT INTO fee_group_members (group_id, ledger_id, sl_number, sibling_position) VALUES (?,?,?,?)'
    );
    const updateLedger = db.prepare(
      'UPDATE fee_ledger SET group_id = ? WHERE ledger_id = ?'
    );

    const doAll = db.transaction(() => {
      allMembers.forEach((m, i) => {
        if (m.ledger_id === ledger_id) {
          insertMember.run(group_id, ledger_id, newLedger.sl_number, i + 1);
          updateLedger.run(group_id, ledger_id);
        } else {
          upsertPos.run(i + 1, m.ledger_id, group_id);
        }
      });
    });
    doAll();

    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — DAY-END POSTING HANDLERS (Phase 4)
// ══════════════════════════════════════════════════════════════

// Get all pending staged receipts for a day grouped by receipt
ipcMain.handle('posting:getStaged', (_evt, { center_id, counter_id, date, academic_year }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    // Get unique receipts for the day
    const receipts = db.prepare(`
      SELECT
        s.receipt_number,
        s.sl_number,
        s.payment_mode,
        s.status,
        s.collected_by,
        s.collected_at,
        s.academic_year,
        l.student_name,
        l.current_class,
        l.section,
        SUM(CASE WHEN s.transaction_type = 'RECEIVED' THEN s.credit ELSE 0 END) as amount_paid,
        SUM(CASE WHEN s.transaction_type = 'RECEIVABLE' THEN s.debit ELSE 0 END) as total_charged,
        SUM(CASE WHEN s.transaction_type = 'RECEIVABLE' THEN s.concession ELSE 0 END) as total_concession
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      WHERE  DATE(s.collected_at) = ?
      AND    s.academic_year      = ?
      AND    s.status             = 'PENDING'
      AND    (? IS NULL OR s.center_id  = ?)
      AND    (? IS NULL OR s.counter_id = ?)
      GROUP  BY s.receipt_number
      ORDER  BY s.receipt_number
    `).all(d, academic_year, center_id || null, center_id || null, counter_id || null, counter_id || null);

    // Mode summary
    const modeSummary = {};
    receipts.filter(r => r.status === 'PENDING').forEach(r => {
      if (!modeSummary[r.payment_mode]) modeSummary[r.payment_mode] = { count: 0, amount: 0 };
      modeSummary[r.payment_mode].count  += 1;
      modeSummary[r.payment_mode].amount += r.amount_paid || 0;
    });

    const total = receipts.reduce((s, r) => s + (r.amount_paid || 0), 0);
    return { success: true, receipts, modeSummary, total, count: receipts.length };
  } catch(e) { return { success: false, message: e.message }; }
});

// Post all pending transactions for a day
ipcMain.handle('posting:createAndPost', (_evt, { center_id, counter_id, date, academic_year, posted_by }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    // Get center code for schedule ID
    const center = db.prepare('SELECT * FROM collection_centers WHERE center_id = ?').get(center_id || 1);
    const code   = (center?.center_code || 'BPS').replace(/-/g, '');

    // Build schedule ID: CENTERCODE + DDMMYY
    const dt     = new Date(d);
    const ddmmyy = String(dt.getDate()).padStart(2,'0')
                 + String(dt.getMonth()+1).padStart(2,'0')
                 + String(dt.getFullYear()).slice(2);
    const scheduleId = code + ddmmyy;

    // Check not already posted for this day+center
    const existing = db.prepare('SELECT * FROM posting_schedules WHERE schedule_id = ?').get(scheduleId);
    if (existing && existing.status === 'POSTED') {
      return { success: false, message: 'Payments for ' + d + ' at ' + (center?.center_name || 'this center') + ' have already been posted (Schedule: ' + scheduleId + ')' };
    }

    // Get all pending staged records for the day
    const staged = db.prepare(`
      SELECT * FROM fee_transactions_stage
      WHERE  DATE(collected_at) = ?
      AND    academic_year       = ?
      AND    status              = 'PENDING'
      AND    (? IS NULL OR center_id  = ?)
      AND    (? IS NULL OR counter_id = ?)
    `).all(d, academic_year, center_id || null, center_id || null, counter_id || null, counter_id || null);

    if (staged.length === 0) return { success: false, message: 'No pending transactions found for ' + d };

    const totalAmount = staged
      .filter(r => r.transaction_type === 'RECEIVED')
      .reduce((s, r) => s + (r.credit || 0), 0);

    const uniqueReceipts = [...new Set(staged.map(r => r.receipt_number))].length;

    // Insert into posting_schedules
    db.prepare(`
      INSERT OR REPLACE INTO posting_schedules
        (schedule_id, center_id, schedule_date, start_date, end_date,
         total_transactions, total_amount, posted_by, status)
      VALUES (?,?,?,?,?,?,?,?,'POSTED')
    `).run(scheduleId, center_id || 1, d, d, d, uniqueReceipts, totalAmount, posted_by || '');

    // Copy to fee_transactions + update stage
    const ins = db.prepare(`
      INSERT INTO fee_transactions
        (receipt_number, ledger_id, group_id, sl_number, academic_year,
         transaction_type, description, debit, credit, concession, concession_reason,
         late_fee, late_fee_waived, payment_mode, cheque_details,
         center_id, counter_id, collected_by, collected_at, schedule_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    const upd = db.prepare(
      'UPDATE fee_transactions_stage SET schedule_id = ?, status = ? WHERE stage_id = ?'
    );

    const doPost = db.transaction(() => {
      staged.forEach(r => {
        ins.run(
          r.receipt_number, r.ledger_id, r.group_id, r.sl_number, r.academic_year,
          r.transaction_type, r.description, r.debit, r.credit, r.concession, r.concession_reason,
          r.late_fee, r.late_fee_waived, r.payment_mode, r.cheque_details || '',
          r.center_id, r.counter_id, r.collected_by, r.collected_at, scheduleId
        );
        upd.run(scheduleId, 'POSTED', r.stage_id);
      });
    });
    doPost();

    return { success: true, schedule_id: scheduleId, posted: staged.length, total_amount: totalAmount };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get all posting schedules (history)
ipcMain.handle('posting:getHistory', (_evt, { center_id, academic_year }) => {
  try {
    const rows = db.prepare(`
      SELECT p.*, c.center_name, c.center_code
      FROM   posting_schedules p
      LEFT JOIN collection_centers c ON c.center_id = p.center_id
      WHERE  (? IS NULL OR p.center_id = ?)
      ORDER  BY p.schedule_date DESC, p.posted_at DESC
    `).all(center_id || null, center_id || null);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get transactions for a specific schedule
ipcMain.handle('posting:getScheduleDetails', (_evt, schedule_id) => {
  try {
    const schedule = db.prepare('SELECT * FROM posting_schedules WHERE schedule_id = ?').get(schedule_id);
    const rows = db.prepare(`
      SELECT t.*, l.student_name, l.current_class, l.section
      FROM   fee_transactions t
      LEFT JOIN fee_ledger l ON l.ledger_id = t.ledger_id
      WHERE  t.schedule_id = ?
      ORDER  BY t.receipt_number, t.txn_id
    `).all(schedule_id);

    // Group by receipt
    const receipts = {};
    rows.forEach(r => {
      if (!receipts[r.receipt_number]) receipts[r.receipt_number] = { ...r, lines: [] };
      receipts[r.receipt_number].lines.push(r);
    });

    return { success: true, schedule, receipts: Object.values(receipts) };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get reconciliation data for a day
ipcMain.handle('posting:getReconciliation', (_evt, { center_id, counter_id, date, academic_year, payment_mode, status_filter }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);
    let sql = `
      SELECT
        s.receipt_number, s.sl_number, s.payment_mode, s.status,
        s.collected_by, s.collected_at, s.schedule_id,
        l.student_name, l.current_class,
        SUM(CASE WHEN s.transaction_type = 'RECEIVED' THEN s.credit ELSE 0 END) as amount_paid
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      WHERE  DATE(s.collected_at) = ?
      AND    s.academic_year       = ?
    `;
    const params = [d, academic_year];

    if (center_id)    { sql += ' AND s.center_id = ?';  params.push(center_id); }
    if (counter_id)   { sql += ' AND s.counter_id = ?'; params.push(counter_id); }
    if (payment_mode && payment_mode !== 'ALL') { sql += ' AND s.payment_mode = ?'; params.push(payment_mode); }
    if (status_filter && status_filter !== 'ALL') { sql += ' AND s.status = ?'; params.push(status_filter); }

    sql += ' GROUP BY s.receipt_number ORDER BY s.payment_mode, s.receipt_number';

    const rows = db.prepare(sql).all(...params);

    // Totals per mode
    const byMode = {};
    rows.forEach(r => {
      if (!byMode[r.payment_mode]) byMode[r.payment_mode] = { count: 0, amount: 0 };
      if (r.status !== 'CANCELLED') {
        byMode[r.payment_mode].count  += 1;
        byMode[r.payment_mode].amount += r.amount_paid || 0;
      }
    });

    return { success: true, data: rows, byMode };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — REPORTS & REPRINTS HANDLERS (Phase 5)
// ══════════════════════════════════════════════════════════════

// Daily payout list
ipcMain.handle('reports:getDailyPayout', (_evt, { center_id, date, academic_year, payment_mode }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    // From posted transactions
    let postedSql = `
      SELECT t.receipt_number, t.sl_number, t.payment_mode, t.collected_by,
             t.collected_at, t.schedule_id, 'POSTED' as source,
             l.student_name, l.current_class, l.section,
             SUM(CASE WHEN t.transaction_type='RECEIVED' THEN t.credit ELSE 0 END) as amount_paid,
             SUM(t.concession) as total_concession
      FROM   fee_transactions t
      LEFT JOIN fee_ledger l ON l.ledger_id = t.ledger_id
      WHERE  DATE(t.collected_at) = ?
      AND    t.academic_year = ?
    `;
    const postedParams = [d, academic_year];
    if (center_id) { postedSql += ' AND t.center_id = ?'; postedParams.push(center_id); }
    if (payment_mode && payment_mode !== 'ALL') { postedSql += ' AND t.payment_mode = ?'; postedParams.push(payment_mode); }
    postedSql += ' GROUP BY t.receipt_number ORDER BY t.payment_mode, t.receipt_number';

    // From staged (pending)
    let stagedSql = `
      SELECT s.receipt_number, s.sl_number, s.payment_mode, s.collected_by,
             s.collected_at, '' as schedule_id, 'PENDING' as source,
             l.student_name, l.current_class, l.section,
             SUM(CASE WHEN s.transaction_type='RECEIVED' THEN s.credit ELSE 0 END) as amount_paid,
             SUM(s.concession) as total_concession
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      WHERE  DATE(s.collected_at) = ?
      AND    s.academic_year = ?
      AND    s.status = 'PENDING'
    `;
    const stagedParams = [d, academic_year];
    if (center_id) { stagedSql += ' AND s.center_id = ?'; stagedParams.push(center_id); }
    if (payment_mode && payment_mode !== 'ALL') { stagedSql += ' AND s.payment_mode = ?'; stagedParams.push(payment_mode); }
    stagedSql += ' GROUP BY s.receipt_number ORDER BY s.payment_mode, s.receipt_number';

    const posted = db.prepare(postedSql).all(...postedParams);
    const staged = db.prepare(stagedSql).all(...stagedParams);
    const all    = [...posted, ...staged].sort((a,b) => {
      if (a.payment_mode < b.payment_mode) return -1;
      if (a.payment_mode > b.payment_mode) return 1;
      return a.receipt_number.localeCompare(b.receipt_number);
    });

    const byMode = {};
    all.forEach(r => {
      if (!byMode[r.payment_mode]) byMode[r.payment_mode] = { count:0, amount:0, rows:[] };
      byMode[r.payment_mode].count  += 1;
      byMode[r.payment_mode].amount += r.amount_paid || 0;
      byMode[r.payment_mode].rows.push(r);
    });

    const grand = all.reduce((s,r) => s + (r.amount_paid||0), 0);
    const center = center_id ? db.prepare('SELECT * FROM collection_centers WHERE center_id = ?').get(center_id) : null;

    return { success: true, byMode, grand, total: all.length, date: d, center };
  } catch(e) { return { success: false, message: e.message }; }
});

// Defaulter list — students with pending balance
ipcMain.handle('reports:getDefaulters', (_evt, { academic_year, class: cls }) => {
  try {
    let sql = `
      SELECT l.ledger_id, l.sl_number, l.student_name, l.current_class, l.section,
             l.opening_balance, l.admission_number, g.gsl_number,
             e.father_name, e.mobile_number,
             COALESCE(pt.debit,0)   - COALESCE(pt.credit,0)   - COALESCE(pt.conc,0)   as posted_bal,
             COALESCE(st.debit,0)   - COALESCE(st.credit,0)   - COALESCE(st.conc,0)   as staged_bal,
             st.last_payment
      FROM   fee_ledger l
      LEFT JOIN fee_groups g ON g.group_id = l.group_id
      LEFT JOIN enrollment e ON e.admission_number = l.admission_number
      LEFT JOIN (
        SELECT ledger_id,
               SUM(debit) as debit, SUM(credit) as credit, SUM(concession) as conc
        FROM   fee_transactions WHERE academic_year = ?
        GROUP  BY ledger_id
      ) pt ON pt.ledger_id = l.ledger_id
      LEFT JOIN (
        SELECT ledger_id,
               SUM(debit) as debit, SUM(credit) as credit, SUM(concession) as conc,
               MAX(CASE WHEN transaction_type='RECEIVED' THEN collected_at END) as last_payment
        FROM   fee_transactions_stage
        WHERE  academic_year = ? AND status != 'CANCELLED'
        GROUP  BY ledger_id
      ) st ON st.ledger_id = l.ledger_id
      WHERE l.academic_year = ?
    `;
    const params = [academic_year, academic_year, academic_year];
    if (cls) { sql += ' AND LOWER(l.current_class) = LOWER(?)'; params.push(cls); }
    sql += ' ORDER BY l.current_class, CAST(SUBSTR(l.sl_number,4) AS INTEGER)';

    const rows = db.prepare(sql).all(...params);
    const defaulters = rows.map(r => {
      const balance = (r.opening_balance||0) + (r.posted_bal||0) + (r.staged_bal||0);
      return { ...r, balance };
    }).filter(r => r.balance > 0.005);

    return { success: true, data: defaulters };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get receipt for reprint (checks both staged and posted)
ipcMain.handle('reports:getReceiptForPrint', (_evt, { receipt_number, academic_year }) => {
  try {
    // Try posted first
    let rows = db.prepare(`
      SELECT t.*, l.student_name, l.current_class, l.section, l.sl_number as ledger_sl,
             l.admission_number, l.opening_balance, e.father_name, e.mobile_number,
             g.gsl_number, c.center_name, c.center_code, ct.counter_name, ct.counter_code
      FROM   fee_transactions t
      LEFT JOIN fee_ledger         l  ON l.ledger_id = t.ledger_id
      LEFT JOIN enrollment         e  ON e.admission_number = l.admission_number
      LEFT JOIN fee_groups         g  ON g.group_id = l.group_id
      LEFT JOIN collection_centers c  ON c.center_id = t.center_id
      LEFT JOIN fee_counters       ct ON ct.counter_id = t.counter_id
      WHERE  t.receipt_number = ? AND t.academic_year = ?
    `).all(receipt_number, academic_year);

    let source = 'POSTED';
    if (rows.length === 0) {
      rows = db.prepare(`
        SELECT s.*, l.student_name, l.current_class, l.section, l.sl_number as ledger_sl,
               l.admission_number, l.opening_balance, e.father_name, e.mobile_number,
               g.gsl_number, c.center_name, c.center_code, ct.counter_name, ct.counter_code
        FROM   fee_transactions_stage s
        LEFT JOIN fee_ledger         l  ON l.ledger_id = s.ledger_id
        LEFT JOIN enrollment         e  ON e.admission_number = l.admission_number
        LEFT JOIN fee_groups         g  ON g.group_id = l.group_id
        LEFT JOIN collection_centers c  ON c.center_id = s.center_id
        LEFT JOIN fee_counters       ct ON ct.counter_id = s.counter_id
        WHERE  s.receipt_number = ? AND s.academic_year = ?
      `).all(receipt_number, academic_year);
      source = 'STAGED';
    }
    if (rows.length === 0) return { success: false, message: 'Receipt not found: ' + receipt_number };
    return { success: true, data: rows, source };
  } catch(e) { return { success: false, message: e.message }; }
});

// Browsable receipt history — one row per receipt (individual or group),
// for a given month/year, optionally filtered by class. Powers the Receipt
// History tab so staff can find "that ₹200 receipt from April" without
// already knowing the receipt number.
ipcMain.handle('reports:getReceiptHistory', (_evt, { academic_year, month, year, class: cls }) => {
  try {
    const targetMonth = `${year}-${String(month).padStart(2, '0')}`; // 'YYYY-MM'
    const rows = db.prepare(`
      SELECT t.receipt_number,
             MIN(t.collected_at)                                            as date,
             MAX(t.payment_mode)                                            as payment_mode,
             MAX(t.paid_by)                                                 as paid_by,
             MAX(t.collected_by)                                            as collected_by,
             SUM(CASE WHEN t.transaction_type='RECEIVED' THEN t.credit ELSE 0 END) as total_paid,
             MAX(t.group_id)                                                as group_id,
             MAX(g.gsl_number)                                              as gsl_number,
             GROUP_CONCAT(DISTINCT l.student_name)                          as student_names,
             GROUP_CONCAT(DISTINCT l.sl_number)                             as sl_numbers,
             GROUP_CONCAT(DISTINCT l.current_class)                         as classes,
             COUNT(DISTINCT t.ledger_id)                                    as student_count
      FROM (
        SELECT receipt_number, ledger_id, group_id, transaction_type, credit,
               payment_mode, paid_by, collected_by, collected_at
        FROM   fee_transactions
        WHERE  academic_year = ?
        UNION ALL
        SELECT receipt_number, ledger_id, group_id, transaction_type, credit,
               payment_mode, paid_by, collected_by, collected_at
        FROM   fee_transactions_stage
        WHERE  academic_year = ? AND status != 'CANCELLED'
      ) t
      LEFT JOIN fee_ledger l ON l.ledger_id = t.ledger_id
      LEFT JOIN fee_groups g ON g.group_id  = t.group_id
      WHERE  strftime('%Y-%m', t.collected_at) = ?
      GROUP  BY t.receipt_number
      HAVING (? = '' OR ',' || classes || ',' LIKE '%,' || ? || ',%')
      ORDER  BY date DESC
    `).all(academic_year, academic_year, targetMonth, cls || '', cls || '');
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// CASH BOOK HANDLERS (Phase 7)
// ══════════════════════════════════════════════════════════════

// Get daily cash book — receipts + payments for a date
ipcMain.handle('cashbook:getDaily', (_evt, { date, academic_year }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    // Receipts from posted fee transactions (grouped by receipt)
    const receipts = db.prepare(`
      SELECT
        t.receipt_number,
        t.payment_mode,
        t.collected_at,
        l.student_name,
        l.current_class,
        l.sl_number,
        SUM(CASE WHEN t.transaction_type='RECEIVED' THEN t.credit ELSE 0 END) as amount
      FROM   fee_transactions t
      LEFT JOIN fee_ledger l ON l.ledger_id = t.ledger_id
      WHERE  DATE(t.collected_at) = ? AND t.academic_year = ?
      GROUP  BY t.receipt_number
      HAVING amount > 0
      ORDER  BY t.collected_at
    `).all(d, academic_year);

    // Expenses (payments side)
    const expenses = db.prepare(`
      SELECT * FROM cash_expenses
      WHERE expense_date = ? AND academic_year = ?
      ORDER BY created_at
    `).all(d, academic_year);

    // Running totals for this day
    const receiptsCash = receipts.filter(r => r.payment_mode === 'CASH').reduce((s,r) => s+(r.amount||0), 0);
    const receiptsBank = receipts.filter(r => ['UPI','IMPS','RTGS','CHEQUE'].includes(r.payment_mode)).reduce((s,r) => s+(r.amount||0), 0);
    const expensesCash = expenses.reduce((s,e) => s+(e.cash_amount||0), 0);
    const expensesBank = expenses.reduce((s,e) => s+(e.bank_amount||0), 0);

    // Opening balance = sum of all posted receipts - sum of all expenses before this date
    const prevRecCash = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN t.payment_mode='CASH' THEN t.credit ELSE 0 END),0) as tot
      FROM fee_transactions t WHERE t.transaction_type='RECEIVED' AND DATE(t.collected_at) < ? AND t.academic_year=?
    `).get(d, academic_year);
    const prevExpCash = db.prepare(`
      SELECT COALESCE(SUM(cash_amount),0) as tot FROM cash_expenses WHERE expense_date < ? AND academic_year=?
    `).get(d, academic_year);
    const prevRecBank = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN t.payment_mode IN ('UPI','IMPS','RTGS','CHEQUE') THEN t.credit ELSE 0 END),0) as tot
      FROM fee_transactions t WHERE t.transaction_type='RECEIVED' AND DATE(t.collected_at) < ? AND t.academic_year=?
    `).get(d, academic_year);
    const prevExpBank = db.prepare(`
      SELECT COALESCE(SUM(bank_amount),0) as tot FROM cash_expenses WHERE expense_date < ? AND academic_year=?
    `).get(d, academic_year);

    const openingCash = (prevRecCash?.tot||0) - (prevExpCash?.tot||0);
    const openingBank = (prevRecBank?.tot||0) - (prevExpBank?.tot||0);
    const closingCash = openingCash + receiptsCash - expensesCash;
    const closingBank = openingBank + receiptsBank - expensesBank;

    return {
      success: true, date: d,
      receipts, expenses,
      receiptsCash, receiptsBank,
      expensesCash, expensesBank,
      openingCash, openingBank,
      closingCash, closingBank,
    };
  } catch(e) { return { success: false, message: e.message }; }
});

// Add expense entry
ipcMain.handle('cashbook:addExpense', (_evt, data) => {
  try {
    db.prepare(`
      INSERT INTO cash_expenses
        (expense_date, academic_year, category, description, cash_amount, bank_amount, entered_by)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      data.expense_date, data.academic_year, data.category || 'Other',
      data.description, data.cash_amount || 0, data.bank_amount || 0, data.entered_by || ''
    );
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Update expense
ipcMain.handle('cashbook:updateExpense', (_evt, data) => {
  try {
    db.prepare(`
      UPDATE cash_expenses SET category=?, description=?, cash_amount=?, bank_amount=? WHERE expense_id=?
    `).run(data.category, data.description, data.cash_amount||0, data.bank_amount||0, data.expense_id);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Delete expense
ipcMain.handle('cashbook:deleteExpense', (_evt, expense_id) => {
  try {
    db.prepare('DELETE FROM cash_expenses WHERE expense_id=?').run(expense_id);
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Monthly summary
ipcMain.handle('cashbook:getMonthlySummary', (_evt, { academic_year }) => {
  try {
    // Fee receipts grouped by month
    const receiptRows = db.prepare(`
      SELECT
        SUBSTR(collected_at,6,2) as month,
        SUBSTR(collected_at,1,4) as year,
        SUM(CASE WHEN payment_mode='CASH' THEN credit ELSE 0 END) as cash_in,
        SUM(CASE WHEN payment_mode IN ('UPI','IMPS','RTGS','CHEQUE') THEN credit ELSE 0 END) as bank_in
      FROM fee_transactions
      WHERE transaction_type='RECEIVED' AND academic_year=?
      GROUP BY month, year
      ORDER BY year, month
    `).all(academic_year);

    // Expenses grouped by month
    const expenseRows = db.prepare(`
      SELECT
        SUBSTR(expense_date,6,2) as month,
        SUBSTR(expense_date,1,4) as year,
        SUM(cash_amount) as cash_out,
        SUM(bank_amount) as bank_out
      FROM cash_expenses WHERE academic_year=?
      GROUP BY month, year
      ORDER BY year, month
    `).all(academic_year);

    // Build month map
    const months = {};
    const addToMonth = (key, field, val) => {
      if (!months[key]) months[key] = { cash_in:0, bank_in:0, cash_out:0, bank_out:0 };
      months[key][field] += (val || 0);
    };

    receiptRows.forEach(r => { const k = r.year+'-'+r.month; addToMonth(k,'cash_in',r.cash_in); addToMonth(k,'bank_in',r.bank_in); });
    expenseRows.forEach(r => { const k = r.year+'-'+r.month; addToMonth(k,'cash_out',r.cash_out); addToMonth(k,'bank_out',r.bank_out); });

    const MONTH_NAMES = { '01':'April','02':'May','03':'June','04':'July','05':'August','06':'September','07':'October','08':'November','09':'December','10':'January','11':'February','12':'March' };

    // Sort by academic year order (Apr first)
    const sorted = Object.entries(months).map(([k, v]) => {
      const [y, m] = k.split('-');
      const sortKey = parseInt(m) >= 4 ? parseInt(y)*100+parseInt(m) : (parseInt(y)+1)*100+parseInt(m);
      return { key:k, year:y, month:m, monthName:MONTH_NAMES[m]||m, sortKey, ...v,
        net_cash: v.cash_in - v.cash_out, net_bank: v.bank_in - v.bank_out };
    }).sort((a,b) => a.sortKey - b.sortKey);

    return { success: true, data: sorted };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// PROSPECTUS & PRE-ADMISSION HANDLERS (Phase 8)
// ══════════════════════════════════════════════════════════════

// Add new prospectus inquiry
ipcMain.handle('prospectus:add', (_evt, data) => {
  try {
    db.prepare(`
      INSERT INTO prospectus_inquiries
        (student_name, father_name, mother_name, father_mobile, mother_mobile,
         address, amount_paid, payment_date, receipt_number, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      data.student_name || '', data.father_name || '', data.mother_name || '',
      data.father_mobile || '', data.mother_mobile || '', data.address || '',
      data.amount_paid || 100, data.payment_date || '',
      data.receipt_number || '', data.notes || '', data.created_by || ''
    );
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get all inquiries with filters
ipcMain.handle('prospectus:getAll', (_evt, { admission_taken, from_date, to_date, search } = {}) => {
  try {
    let sql = `
      SELECT p.*, e.current_class, e.student_status
      FROM   prospectus_inquiries p
      LEFT JOIN enrollment e ON e.admission_number = p.admission_number
      WHERE  1=1
    `;
    const params = [];
    if (admission_taken !== undefined && admission_taken !== null) {
      sql += ' AND p.admission_taken = ?'; params.push(admission_taken ? 1 : 0);
    }
    if (from_date) { sql += ' AND p.payment_date >= ?'; params.push(from_date); }
    if (to_date)   { sql += ' AND p.payment_date <= ?'; params.push(to_date); }
    if (search) {
      sql += ' AND (p.student_name LIKE ? OR p.father_name LIKE ? OR p.father_mobile LIKE ? OR p.mother_mobile LIKE ?)';
      const q = '%' + search + '%';
      params.push(q, q, q, q);
    }
    sql += ' ORDER BY p.created_at DESC';
    const rows = db.prepare(sql).all(...params);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Update inquiry (notes, contact info)
ipcMain.handle('prospectus:update', (_evt, data) => {
  try {
    db.prepare(`
      UPDATE prospectus_inquiries SET
        student_name = ?, father_name = ?, mother_name = ?,
        father_mobile = ?, mother_mobile = ?, address = ?,
        notes = ?, amount_paid = ?, payment_date = ?, receipt_number = ?
      WHERE inquiry_id = ?
    `).run(
      data.student_name, data.father_name, data.mother_name,
      data.father_mobile, data.mother_mobile, data.address,
      data.notes, data.amount_paid, data.payment_date, data.receipt_number,
      data.inquiry_id
    );
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Mark as admitted — link to enrollment record
ipcMain.handle('prospectus:markAdmitted', (_evt, { inquiry_id, admission_number, adjust_fee }) => {
  try {
    // Verify the admission number exists
    const student = db.prepare('SELECT * FROM enrollment WHERE admission_number = ?').get(admission_number);
    if (!student) return { success: false, message: 'Admission number not found: ' + admission_number };

    db.prepare(`
      UPDATE prospectus_inquiries
      SET admission_taken = 1, admission_number = ?, fee_adjusted = ?
      WHERE inquiry_id = ?
    `).run(admission_number, adjust_fee ? 1 : 0, inquiry_id);

    return { success: true, student_name: student.student_name };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get conversion stats
ipcMain.handle('prospectus:getStats', () => {
  try {
    const total     = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount_paid),0) as rev FROM prospectus_inquiries').get();
    const converted = db.prepare('SELECT COUNT(*) as c FROM prospectus_inquiries WHERE admission_taken = 1').get();
    const adjusted  = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(amount_paid),0) as amt FROM prospectus_inquiries WHERE fee_adjusted = 1').get();
    const byMonth   = db.prepare(`
      SELECT SUBSTR(payment_date,1,7) as month, COUNT(*) as sold,
             SUM(CASE WHEN admission_taken=1 THEN 1 ELSE 0 END) as admitted
      FROM   prospectus_inquiries
      WHERE  payment_date != ''
      GROUP  BY month ORDER BY month DESC LIMIT 12
    `).all();
    return { success: true, total: total.c, revenue: total.rev, converted: converted.c, adjusted: adjusted.c, adjustedAmt: adjusted.amt, byMonth };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// PHASE 9 — TRANSPORT MONTHLY + SIBLING CONCESSION HANDLERS
// ══════════════════════════════════════════════════════════════

// Get transport assignments for a month
ipcMain.handle('transport:getMonthly', (_evt, { academic_year, month }) => {
  try {
    const rows = db.prepare(`
      SELECT l.ledger_id, l.sl_number, l.admission_number, l.student_name,
             l.current_class, l.section, e.village,
             tm.id as assign_id, tm.route_id, tm.month,
             r.route_name, r.monthly_amount,
             ar.route_id as auto_route_id, ar.route_name as auto_route_name, ar.monthly_amount as auto_monthly_amount
      FROM   fee_ledger l
      LEFT JOIN enrollment e ON e.admission_number = l.admission_number
      LEFT JOIN student_transport_monthly tm
             ON tm.admission_number = l.admission_number
            AND tm.academic_year    = l.academic_year
            AND tm.month            = ?
      LEFT JOIN transport_routes r ON r.route_id = tm.route_id
      LEFT JOIN transport_routes ar
             ON ar.academic_year = l.academic_year
            AND ar.is_active     = 1
            AND ar.route_name    = (UPPER(e.village) || '-SHERPUR ROUTE')
      WHERE  l.academic_year = ?
      ORDER  BY CAST(SUBSTR(l.sl_number,4) AS INTEGER)
    `).all(month, academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Save monthly transport assignments — staff only choose ON/OFF per student.
// The route itself is always resolved here, server-side, from the student's
// enrollment village — never trusted from the client — so it can't go stale
// or be spoofed, and always reflects the current Transport Routes list.
ipcMain.handle('transport:saveMonthly', (_evt, { academic_year, month, assignments, saved_by }) => {
  try {
    const findRoute = db.prepare(`
      SELECT r.route_id
      FROM   enrollment e
      JOIN   transport_routes r
             ON r.academic_year = ? AND r.is_active = 1
            AND r.route_name    = (UPPER(e.village) || '-SHERPUR ROUTE')
      WHERE  e.admission_number = ?
    `);
    const upsert = db.prepare(`
      INSERT INTO student_transport_monthly
        (admission_number, route_id, academic_year, month, assigned_by)
      VALUES (?,?,?,?,?)
      ON CONFLICT(admission_number, academic_year, month)
      DO UPDATE SET route_id=excluded.route_id, assigned_by=excluded.assigned_by
    `);
    const remove = db.prepare(
      'DELETE FROM student_transport_monthly WHERE admission_number=? AND academic_year=? AND month=?'
    );
    let skipped = 0;
    const doAll = db.transaction(() => {
      assignments.forEach(a => {
        if (a.enabled) {
          const match = findRoute.get(academic_year, a.admission_number);
          if (match && match.route_id) {
            upsert.run(a.admission_number, match.route_id, academic_year, month, saved_by || '');
          } else {
            skipped++; // student's village has no matching active route — nothing to assign
          }
        } else {
          remove.run(a.admission_number, academic_year, month);
        }
      });
    });
    doAll();
    return { success: true, skipped };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get student transport for a specific month (used in payment screen)
ipcMain.handle('transport:getForStudent', (_evt, { admission_number, academic_year, month }) => {
  try {
    const row = db.prepare(`
      SELECT tm.*, r.route_name, r.monthly_amount
      FROM   student_transport_monthly tm
      JOIN   transport_routes r ON r.route_id = tm.route_id
      WHERE  tm.admission_number = ? AND tm.academic_year = ? AND tm.month = ?
    `).get(admission_number, academic_year, month);
    return { success: true, data: row || null };
  } catch(e) { return { success: false, message: e.message }; }
});

// Get sibling position for a student (for concession calculation)
ipcMain.handle('ledger:getSiblingPosition', (_evt, { ledger_id, academic_year }) => {
  try {
    const member = db.prepare(
      'SELECT gm.sibling_position, gm.group_id FROM fee_group_members gm WHERE gm.ledger_id = ?'
    ).get(ledger_id);
    if (!member) return { success: true, position: null, group_id: null };

    // Re-rank by class (oldest = position 1) since stored position may vary
    const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
      'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };
    const siblings = db.prepare(`
      SELECT gm.ledger_id, l.current_class
      FROM   fee_group_members gm
      JOIN   fee_ledger l ON l.ledger_id = gm.ledger_id
      WHERE  gm.group_id = ?
    `).all(member.group_id);

    siblings.sort((a,b) => (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1));
    const position = siblings.findIndex(s => s.ledger_id === ledger_id) + 1;
    return { success: true, position, group_id: member.group_id };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// BULK RECEIVABLE ENTRY HANDLERS
// ══════════════════════════════════════════════════════════════

// Get preview of bulk receivables for a month
ipcMain.handle('counter:getBulkPreview', (_evt, { academic_year, month, year, fee_types }) => {
  try {
    const MONTH_NAMES = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
      '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' };
    const monthLabel = MONTH_NAMES[month] + '-' + String(year).slice(2);

    const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
      'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };

    // Fee settings for sibling concession
    const settings = db.prepare('SELECT * FROM fee_settings WHERE academic_year = ?').get(academic_year)
      || { sibling_concession_pct: 0, sibling_concession_from: 3 };

    // All ledger entries for this year
    const ledgerRows = db.prepare(`
      SELECT l.*, e.father_name, e.date_of_admission,
             gm.sibling_position, gm.group_id as gm_group_id
      FROM   fee_ledger l
      LEFT JOIN enrollment e ON e.admission_number = l.admission_number
      LEFT JOIN fee_group_members gm ON gm.ledger_id = l.ledger_id
      WHERE  l.academic_year = ?
      ORDER  BY CAST(SUBSTR(l.sl_number,4) AS INTEGER)
    `).all(academic_year);

    // For each sibling group, recalculate positions by class rank
    const groupMembers = {};
    ledgerRows.forEach(r => {
      if (r.gm_group_id) {
        if (!groupMembers[r.gm_group_id]) groupMembers[r.gm_group_id] = [];
        groupMembers[r.gm_group_id].push(r);
      }
    });
    Object.values(groupMembers).forEach(members => {
      members.sort((a,b) => (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1));
      members.forEach((m, i) => { m._siblingPosition = i + 1; });
    });

    const preview = ledgerRows.map(student => {
      // Fee structure for this class
      const feeRows = db.prepare(
        'SELECT * FROM fee_structure WHERE academic_year = ? AND class = ?'
      ).all(academic_year, student.current_class);
      const feeMap = {};
      feeRows.forEach(f => { feeMap[f.fee_type] = f; });

      // Already charged this year (description-based check)
      const charged = db.prepare(`
        SELECT description FROM fee_transactions_stage
        WHERE ledger_id = ? AND academic_year = ? AND status != 'CANCELLED'
        AND transaction_type = 'RECEIVABLE'
        UNION
        SELECT description FROM fee_transactions
        WHERE ledger_id = ? AND academic_year = ?
        AND transaction_type = 'RECEIVABLE'
      `).all(student.ledger_id, academic_year, student.ledger_id, academic_year);
      const chargedDescs = new Set(charged.map(r => r.description));

      // Transport for this month
      const transport = db.prepare(`
        SELECT tm.*, r.route_name, r.monthly_amount
        FROM   student_transport_monthly tm
        JOIN   transport_routes r ON r.route_id = tm.route_id
        WHERE  tm.admission_number = ? AND tm.academic_year = ? AND tm.month = ?
      `).get(student.admission_number, academic_year, month);

      // Sibling concession
      const sibPos     = student._siblingPosition || null;
      const isSibling  = sibPos !== null && sibPos >= (settings.sibling_concession_from || 3);
      const concessPct = isSibling ? (settings.sibling_concession_pct || 0) : 0;

      // Build line items for selected fee types
      const lines = [];
      fee_types.forEach(ft => {
        if (ft === 'TRANSPORT') {
          if (transport && transport.monthly_amount > 0) {
            const desc = 'Transport Fee (' + monthLabel + ')';
            lines.push({
              fee_type: 'TRANSPORT', description: desc,
              amount: transport.monthly_amount, concession: 0,
              already_charged: chargedDescs.has(desc),
            });
          }
          return;
        }
        const f = feeMap[ft];
        if (!f || f.amount <= 0) return;

        // Admission Fee only applies to students who actually joined this academic year —
        // a continuing student should never see it, regardless of what's checked here.
        if (ft === 'ADMISSION' && !_admittedInAcademicYear(student.date_of_admission, academic_year)) return;

        // Month suffix only makes sense for genuinely monthly fees — Annual/Twice-Yearly/
        // One-Time fees (Activity, Exam, Admission, etc.) are charged once, not per-month,
        // and must match the plain-label format Counter Payment itself uses for them.
        const desc = f.frequency === 'MONTHLY' ? (_feeLabel(ft) + ' (' + monthLabel + ')') : _feeLabel(ft);
        const conc = (ft === 'TUITION' && isSibling) ? Math.round(f.amount * concessPct / 100) : 0;
        lines.push({
          fee_type: ft, description: desc,
          amount: f.amount, concession: conc,
          concession_reason: conc > 0 ? 'Sibling concession ' + concessPct + '% (child ' + sibPos + ')' : '',
          already_charged: chargedDescs.has(desc),
        });
      });

      const total = lines.filter(l => !l.already_charged).reduce((s,l) => s+(l.amount||0)-(l.concession||0), 0);
      return { ...student, lines, total, siblingPosition: sibPos };
    }).filter(s => s.lines.length > 0);

    return { success: true, data: preview, month_label: monthLabel };
  } catch(e) { return { success: false, message: e.message }; }
});

// Admission Fee should only ever apply to students who actually joined
// during this academic year — mirrors the same check used in Counter Payment.
function _admittedInAcademicYear(dateOfAdmission, academicYear) {
  if (!dateOfAdmission || !/^\d{2}-\d{2}-\d{4}$/.test(dateOfAdmission)) return false;
  const [, mm, yyyy] = dateOfAdmission.split('-').map(Number);
  const startYear = parseInt(String(academicYear).split('-')[0], 10);
  if (yyyy === startYear && mm >= 4) return true;
  if (yyyy === startYear + 1 && mm <= 3) return true;
  return false;
}

function _feeLabel(ft) {
  const MAP = { TUITION:'Tuition Fee', COMPUTER:'Computer Fee', ADMISSION:'Admission Fee',
    ACTIVITY:'Activity Fee', LIBRARY:'Library Fee', LAB:'Lab Fee', TRANSPORT:'Transport Fee',
    WELLNESS:'Campus Wellness', BOOKS:'Books Fee',
    EXAM_HY:'Exam Fee (Half Yearly)', EXAM_ANNUAL:'Exam Fee (Annual)' };
  return MAP[ft] || ft;
}

// Save bulk receivable entries to staging
ipcMain.handle('counter:saveBulkReceivable', (_evt, { academic_year, entries, posted_by, center_id, month, year }) => {
  try {
    const ins = db.prepare(`
      INSERT INTO fee_transactions_stage
        (receipt_number, ledger_id, sl_number, academic_year,
         transaction_type, description, debit, credit,
         concession, concession_reason,
         payment_mode, center_id, counter_id, collected_by, status, fee_month)
      VALUES ('', ?, ?, ?, 'RECEIVABLE', ?, ?, 0, ?, ?, 'BULK', ?, 1, ?, 'PENDING', ?)
    `);

    // Canonical 'YYYY-MM' for the month these dues are actually FOR — not
    // today's date — so the monthly report buckets them correctly even
    // though they're being entered late/backdated.
    const feeMonth = (month && year) ? `${year}-${month}` : '';

    const saveAll = db.transaction(() => {
      entries.forEach(({ ledger_id, sl_number, lines }) => {
        lines.forEach(line => {
          if (line.already_charged || line.excluded) return;
          ins.run(
            ledger_id, sl_number, academic_year,
            line.description, line.amount || 0,
            line.concession || 0, line.concession_reason || '',
            center_id || 1, posted_by || '', feeMonth
          );
        });
      });
    });
    saveAll();
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// FEES MODULE — AUTO ACCRUAL (monthly + annual/twice-yearly dues)
// ══════════════════════════════════════════════════════════════

// Preview what's missing — powers the "Missing Fees" banner and status grid.
// Never writes anything; safe to call as often as needed.
ipcMain.handle('accrual:getSummary', (_evt, { academic_year }) => {
  try {
    const plan = _computeAccrualPlan(academic_year);
    const summary = _summarizeAccrualPlan(plan);
    return { success: true, ...summary };
  } catch(e) { return { success: false, message: e.message }; }
});

// Actually raises the missing dues (writes to fee_transactions_stage as
// PENDING RECEIVABLE rows, exactly like Bulk Entry does). Safe to run
// repeatedly — anything already charged is skipped by _computeAccrualPlan.
ipcMain.handle('accrual:generate', (_evt, { academic_year, generated_by }) => {
  try {
    const plan = _computeAccrualPlan(academic_year);
    const ins = db.prepare(`
      INSERT INTO fee_transactions_stage
        (receipt_number, ledger_id, sl_number, academic_year,
         transaction_type, description, debit, credit,
         concession, concession_reason,
         payment_mode, center_id, counter_id, collected_by, status, fee_month, fee_type)
      VALUES ('', ?, ?, ?, 'RECEIVABLE', ?, ?, 0, ?, ?, 'AUTO', 1, 1, ?, 'PENDING', ?, ?)
    `);
    let count = 0, total = 0;
    const run = db.transaction(() => {
      plan.perStudentEntries.forEach(entry => {
        entry.lines.forEach(line => {
          ins.run(
            entry.ledger_id, entry.sl_number, academic_year,
            line.description, line.amount || 0, line.concession || 0, line.concession_reason || '',
            generated_by || '', line.fee_month, line.fee_type || ''
          );
          count++;
          total += (line.amount || 0) - (line.concession || 0);
        });
      });
    });
    run();
    return {
      success: true, count, total: Math.round(total * 100) / 100,
      studentsAffected: plan.perStudentEntries.length,
    };
  } catch(e) { return { success: false, message: e.message }; }
});
