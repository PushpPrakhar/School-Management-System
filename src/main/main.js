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
const crypto = require('crypto');

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

// One-time cleanup: village dropdowns (Admission, Edit Student, Fee Settings
// Transport Routes, Provisional students) now use ALL CAPS village names.
// Any already-saved village text in the old mixed case would silently stop
// matching those dropdown options — this normalizes existing data to match.
function uppercaseExistingVillages() {
  try {
    let total = 0;
    const e = db.prepare(
      "UPDATE enrollment SET village = UPPER(village) WHERE village != UPPER(village)"
    ).run();
    total += e.changes;
    try {
      const p = db.prepare(
        "UPDATE provisional_students SET village = UPPER(village) WHERE village != UPPER(village)"
      ).run();
      total += p.changes;
    } catch { /* table may not exist yet on very old DBs — harmless */ }
    if (total > 0) console.log(`[DB] Uppercased village on ${total} existing record(s)`);
  } catch (e) {
    console.log('[DB] village uppercase migration skipped:', e.message);
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
    SELECT l.*, gm.group_id as gm_group_id, gm.custom_concession_pct as gm_custom_concession_pct,
           e.date_of_admission
    FROM   fee_ledger l
    LEFT JOIN fee_group_members gm ON gm.ledger_id = l.ledger_id
    LEFT JOIN student_directory e ON e.admission_number = l.admission_number
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
    // A per-sibling override (set individually per child, not per group)
    // takes precedence over the school-wide default when one is set.
    const concessPct = isSibling
      ? (student.gm_custom_concession_pct !== null && student.gm_custom_concession_pct !== undefined
          ? student.gm_custom_concession_pct
          : (settings.sibling_concession_pct || 0))
      : 0;

    const lines = [];

    // Recurring monthly fees: Tuition, Computer, Lab + Transport (where assigned).
    // Computer/Lab/Transport are charged for the full academic year from
    // April regardless of when the student was actually added to the
    // ledger, exactly as before. Tuition specifically respects the
    // ledger's tuition_start_month if one was set — skipped entirely for
    // any month before it, never generated then hidden.
    elapsedMonths.forEach(({ month, feeMonth, shortLabel }) => {
      ['TUITION', 'COMPUTER', 'LAB'].forEach(ft => {
        const f = feeMap[ft];
        if (!f || f.amount <= 0 || f.frequency !== 'MONTHLY') return;
        if (ft === 'TUITION' && student.tuition_start_month && feeMonth < student.tuition_start_month) return;
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
    "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN locked_until TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''",
  ].forEach(sql => { try { db.exec(sql); } catch(_) {} });

  // ── Employee Details: one row per user with extended personal/employment
  // info. Currently populated for teachers only (via Teacher Management),
  // but keyed generically so other roles can use it later without a schema
  // change.
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_details (
      employee_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
      user_id               INTEGER  NOT NULL UNIQUE REFERENCES users(user_id),
      father_husband_name   TEXT     NOT NULL DEFAULT '',
      date_of_birth         TEXT     NOT NULL DEFAULT '',
      aadhar_number         TEXT     NOT NULL DEFAULT '',
      pan_number            TEXT     NOT NULL DEFAULT '',
      qualification         TEXT     NOT NULL DEFAULT '',
      mobile_number         TEXT     NOT NULL DEFAULT '',
      address               TEXT     NOT NULL DEFAULT '',
      created_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── Teacher Classes: proper join table for multi-class assignment.
  // Replaces users.assigned_class (single value) as the source of truth
  // for anything built going forward — assigned_class is left in place
  // only for backward compatibility with existing seeded accounts.
  db.exec(`
    CREATE TABLE IF NOT EXISTS teacher_classes (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id  INTEGER NOT NULL REFERENCES users(user_id),
      class    TEXT    NOT NULL,
      UNIQUE (user_id, class)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_teacher_classes_user ON teacher_classes (user_id)"); } catch(_) {}

  // Add section-level assignment: a teacher can now be scoped to specific
  // sections of a class (e.g. 'Class 1' + 'A'), not just the whole class.
  // section = '' means 'all sections' — this is what every existing row
  // becomes, so no teacher's current access shrinks from this migration.
  // SQLite can't ALTER a UNIQUE constraint in place, so this rebuilds the
  // table; guarded by column existence so it only ever runs once.
  (function migrateTeacherClassesSections() {
    try {
      const cols = db.prepare("PRAGMA table_info(teacher_classes)").all();
      if (cols.some(c => c.name === 'section')) return; // already migrated
      db.transaction(() => {
        db.exec(`
          CREATE TABLE teacher_classes_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id  INTEGER NOT NULL REFERENCES users(user_id),
            class    TEXT    NOT NULL,
            section  TEXT    NOT NULL DEFAULT '',
            UNIQUE (user_id, class, section)
          )
        `);
        db.exec(`INSERT INTO teacher_classes_new (user_id, class, section) SELECT user_id, class, '' FROM teacher_classes`);
        db.exec(`DROP TABLE teacher_classes`);
        db.exec(`ALTER TABLE teacher_classes_new RENAME TO teacher_classes`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_classes_user ON teacher_classes (user_id)`);
      })();
      console.log('[DB] teacher_classes migrated to support section-level assignment');
    } catch (e) {
      console.log('[DB] teacher_classes section migration skipped:', e.message);
    }
  })();

  // Migrate any existing teacher's single assigned_class into the new
  // join table, so nobody who was already working loses their class access
  // when class-scoping switches over to teacher_classes.
  try {
    const legacyTeachers = db.prepare(
      "SELECT user_id, assigned_class FROM users WHERE role = 'teacher' AND assigned_class != ''"
    ).all();
    const insertClass = db.prepare('INSERT OR IGNORE INTO teacher_classes (user_id, class) VALUES (?, ?)');
    legacyTeachers.forEach(t => insertClass.run(t.user_id, t.assigned_class));
  } catch(_) {}

  // ── Sessions: lets login persist across app restarts. Only a hash of the
  // token is ever stored — same idea as password hashing, so a raw copy of
  // the database alone isn't enough to resume someone's session. This is
  // entirely separate from auto-lock (see renderer AuthContext), which is
  // just an in-memory UI state and never touches this table — locking the
  // screen doesn't end the session, only a real sign-out deletes a row here.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       INTEGER  NOT NULL REFERENCES users(user_id),
      created_at    DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      last_seen_at  DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
      expires_at    DATETIME NOT NULL
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)"); } catch(_) {}
  // Sweep out anything already expired so the table doesn't grow forever.
  try { db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now','localtime')").run(); } catch(_) {}

  // ── Staff Permissions: per-person permission scoping, only used for
  // role='staff' accounts. Coordinator/Manager/Admin/Director keep their
  // existing fixed, role-wide permission buckets (defined in the
  // renderer's PERMISSIONS map) — only Staff needed per-person granularity,
  // since two staff members can legitimately have different jobs (one
  // handles fee collection, another handles admissions).
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_permissions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(user_id),
      permission TEXT    NOT NULL,
      UNIQUE (user_id, permission)
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_staff_permissions_user ON staff_permissions (user_id)"); } catch(_) {}

  // ── Homework: subjects (per class) and chapters (per subject) are
  // Principal-managed; homework_entries are written by teachers against
  // those. Deliberately NOT storing whether a date was a working day here
  // — that's derived live from the existing academic_calendar table
  // (already the single source of truth for holidays/vacations/Sundays),
  // never duplicated.
  db.exec(`
    CREATE TABLE IF NOT EXISTS subjects (
      subject_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      class        TEXT    NOT NULL,
      subject_name TEXT    NOT NULL,
      UNIQUE (class, subject_name)
    )
  `);
  // Subject teacher — who actually teaches this subject, distinct from
  // teacher_classes (which governs who can log homework for the class at
  // all). One class's homework might all be entered by its class teacher,
  // but Review Homework should credit the actual subject specialist.
  try { db.exec("ALTER TABLE subjects ADD COLUMN teacher_id INTEGER REFERENCES users(user_id)"); } catch(_) {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS chapters (
      chapter_id   INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id   INTEGER NOT NULL REFERENCES subjects(subject_id),
      chapter_name TEXT    NOT NULL,
      UNIQUE (subject_id, chapter_name)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS homework_entries (
      entry_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
      teacher_id   INTEGER  NOT NULL REFERENCES users(user_id),
      class        TEXT     NOT NULL,
      date         TEXT     NOT NULL,
      subject_id   INTEGER  NOT NULL REFERENCES subjects(subject_id),
      chapter_id   INTEGER  NOT NULL REFERENCES chapters(chapter_id),
      remarks      TEXT     NOT NULL DEFAULT '',
      created_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_homework_teacher_date ON homework_entries (teacher_id, date)"); } catch(_) {}
  try { db.exec("CREATE INDEX IF NOT EXISTS idx_homework_class_date ON homework_entries (class, date)"); } catch(_) {}
  // classwork added alongside the original 'remarks' column (which now
  // represents the homework text specifically) — no rename needed.
  try { db.exec("ALTER TABLE homework_entries ADD COLUMN classwork TEXT NOT NULL DEFAULT ''"); } catch(_) {}

  // chapter_id made optional — some subjects (Hindi, Hindi Grammar) may
  // never get chapters written up, and teachers should still be able to
  // log classwork/homework for them. Table rebuild since SQLite can't
  // drop a NOT NULL constraint in place; guarded by the column's actual
  // nullability so this only ever runs once.
  (function migrateHomeworkChapterOptional() {
    try {
      const cols = db.prepare("PRAGMA table_info(homework_entries)").all();
      const chapterCol = cols.find(c => c.name === 'chapter_id');
      if (!chapterCol || chapterCol.notnull === 0) return; // already nullable
      db.transaction(() => {
        db.exec(`
          CREATE TABLE homework_entries_new (
            entry_id     INTEGER  PRIMARY KEY AUTOINCREMENT,
            teacher_id   INTEGER  NOT NULL REFERENCES users(user_id),
            class        TEXT     NOT NULL,
            date         TEXT     NOT NULL,
            subject_id   INTEGER  NOT NULL REFERENCES subjects(subject_id),
            chapter_id   INTEGER  REFERENCES chapters(chapter_id),
            remarks      TEXT     NOT NULL DEFAULT '',
            classwork    TEXT     NOT NULL DEFAULT '',
            created_at   DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
          )
        `);
        db.exec(`
          INSERT INTO homework_entries_new (entry_id, teacher_id, class, date, subject_id, chapter_id, remarks, classwork, created_at)
          SELECT entry_id, teacher_id, class, date, subject_id, chapter_id, remarks, classwork, created_at FROM homework_entries
        `);
        db.exec(`DROP TABLE homework_entries`);
        db.exec(`ALTER TABLE homework_entries_new RENAME TO homework_entries`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_homework_teacher_date ON homework_entries (teacher_id, date)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_homework_class_date ON homework_entries (class, date)`);
      })();
      console.log('[DB] homework_entries migrated: chapter_id is now optional');
    } catch (e) {
      console.log('[DB] homework_entries chapter_id migration skipped:', e.message);
    }
  })();

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
  // NULL = no restriction (matches every ledger created before this
  // feature existed) — Tuition generates from April as it always has.
  // A 'YYYY-MM' value means Tuition is never generated for any month
  // before it, no matter what Auto-Accrual would otherwise do.
  try { db.exec("ALTER TABLE fee_ledger ADD COLUMN tuition_start_month TEXT DEFAULT NULL"); } catch(_) {}

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
  // NULL = use the school-wide sibling_concession_pct exactly as before.
  // A specific number overrides Tuition concession for THIS sibling only
  // — set individually per child, not per group, so one family's 3rd and
  // 4th children can have entirely different negotiated percentages.
  try { db.exec("ALTER TABLE fee_group_members ADD COLUMN custom_concession_pct REAL DEFAULT NULL"); } catch(_) {}

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

  // ── Counter Other Payment — Tie, Belt, ID Card, damage recovery, scrap
  // sale, donations, etc. Charges anyone who walks up to the counter, not
  // necessarily an enrolled student. No managed price catalog — staff type
  // the exact amount for whichever charge type(s) apply, since these vary
  // person to person. Fully standalone from the fee ledger.
  db.exec(`CREATE TABLE IF NOT EXISTS counter_other_transactions (
    txn_id           INTEGER  PRIMARY KEY AUTOINCREMENT,
    receipt_number   TEXT     NOT NULL DEFAULT '',
    academic_year    TEXT     NOT NULL DEFAULT '',
    paid_by          TEXT     NOT NULL DEFAULT '',
    reference_note   TEXT     NOT NULL DEFAULT '',
    charge_type      TEXT     NOT NULL DEFAULT '',
    description      TEXT     NOT NULL DEFAULT '',
    amount           REAL     NOT NULL DEFAULT 0,
    amount_paid      REAL     NOT NULL DEFAULT 0,
    payment_mode     TEXT     NOT NULL DEFAULT 'CASH',
    cheque_details   TEXT     NOT NULL DEFAULT '',
    amount_tendered  REAL     NOT NULL DEFAULT 0,
    center_id        INTEGER  DEFAULT 1,
    counter_id       INTEGER  DEFAULT 1,
    collected_by     TEXT     NOT NULL DEFAULT '',
    collected_at     DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  // Students who are attending and being charged (fee, transport, other
  // charges) but have NOT been formally admitted through New Admission —
  // deliberately kept out of `enrollment`, which is reserved strictly for
  // real SR Register entries. fee_ledger.admission_number can point at
  // either a real enrollment.admission_number (BPS...) or a student_ref
  // here (PR...) — the two are distinguishable by prefix and never collide.
  db.exec(`CREATE TABLE IF NOT EXISTS provisional_students (
    student_ref    TEXT     PRIMARY KEY,
    student_name   TEXT     NOT NULL DEFAULT '',
    father_name    TEXT     NOT NULL DEFAULT '',
    current_class  TEXT     NOT NULL DEFAULT '',
    section        TEXT     NOT NULL DEFAULT 'A',
    village        TEXT     NOT NULL DEFAULT '',
    academic_year  TEXT     NOT NULL DEFAULT '',
    status         TEXT     NOT NULL DEFAULT 'ACTIVE',
    created_by     TEXT     NOT NULL DEFAULT '',
    created_at     DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
  )`);

  // Unions enrollment + provisional_students behind one consistent set of
  // column names, so every existing query that does
  // "LEFT JOIN student_directory e ON e.admission_number = l.admission_number"
  // can be pointed at this view instead and keep working unchanged for
  // BOTH formally-admitted and provisional students — without duplicating
  // fallback/COALESCE logic across a dozen separate queries.
  db.exec(`DROP VIEW IF EXISTS student_directory`);
  db.exec(`CREATE VIEW student_directory AS
    SELECT admission_number, student_name, father_name, mother_name,
           mobile_number, current_class, section, village,
           category, gender, date_of_admission, date_of_birth,
           student_status, academic_year
    FROM   enrollment
    UNION ALL
    SELECT student_ref as admission_number, student_name, father_name, '' as mother_name,
           '' as mobile_number, current_class, section, village,
           '' as category, '' as gender, '' as date_of_admission, '' as date_of_birth,
           status as student_status, academic_year
    FROM   provisional_students
  `);


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
  uppercaseExistingVillages();
  try { db.prepare('SELECT amount_paid FROM counter_other_transactions LIMIT 1').get(); }
  catch { db.exec("ALTER TABLE counter_other_transactions ADD COLUMN amount_paid REAL NOT NULL DEFAULT 0"); console.log('[DB] Migrated: added amount_paid to counter_other_transactions'); }

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

// ── Class-scoping enforcement (point 4) ────────────────────────
// Used by every handler that returns or modifies per-class student data
// (Attendance, Examination, Student List). Re-derives the truth from the
// database itself rather than trusting anything the renderer claims about
// its own user — a teacher's real class list always comes from
// teacher_classes, keyed off their actual user_id.
//
// requestingUserId is optional/undefined for calls made before login (or
// from non-teacher-only screens that don't pass it yet) — in that case we
// don't block, since the UI-level restriction (dropdowns only showing
// allowed classes) is already in place; this is defense-in-depth on top of
// that, not a replacement for a real server-side session model, which this
// single-process offline app doesn't have.
function _classAccessDenied(requestingUserId, className) {
  if (!requestingUserId || !className) return false;
  const requester = db.prepare('SELECT role FROM users WHERE user_id = ?').get(requestingUserId);
  if (!requester || requester.role !== 'teacher') return false; // only teachers are restricted
  const allowed = db.prepare('SELECT 1 FROM teacher_classes WHERE user_id = ? AND class = ?').get(requestingUserId, className);
  return !allowed;
}

// Section-aware sibling — used by Attendance and Examination handlers,
// which already treat section as a first-class concept. A teacher_classes
// row with section='' means 'every section of this class' (this is what
// every pre-existing assignment became after the migration, and what a
// class checked with no specific sections ticked still means going
// forward). Only blocks a section-specific request when the teacher's
// assignment is narrower than that.
function _classSectionAccessDenied(requestingUserId, className, section) {
  if (!requestingUserId || !className) return false;
  const requester = db.prepare('SELECT role FROM users WHERE user_id = ?').get(requestingUserId);
  if (!requester || requester.role !== 'teacher') return false;
  const rows = db.prepare('SELECT section FROM teacher_classes WHERE user_id = ? AND class = ?').all(requestingUserId, className);
  if (rows.length === 0) return true; // no access to this class at all
  if (rows.some(r => r.section === '')) return false; // full access to every section
  if (!section) return false; // class-wide request, and they have SOME access to this class
  return !rows.some(r => r.section === section);
}

// ── Day-End Posting enforcement ─────────────────────────────────
// A receipt only "needs posting" once it's actually claimed money
// (receipt_number set) — unclaimed dues sitting pending indefinitely is
// normal and unrelated to this. Scoped per center+counter, matching how
// Day-End Posting itself is already scoped, so one counter forgetting to
// post doesn't block a different counter that closed out properly.
function _getUnpostedPastDays(center_id, counter_id) {
  if (!center_id || !counter_id) return [];
  return db.prepare(`
    SELECT DISTINCT DATE(collected_at) as d
    FROM   fee_transactions_stage
    WHERE  status = 'PENDING' AND receipt_number != ''
    AND    center_id = ? AND counter_id = ?
    AND    DATE(collected_at) < DATE('now','localtime')
    ORDER  BY d
  `).all(center_id, counter_id).map(r => r.d);
}

// ── AUTH ─────────────────────────────────────────────────────
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_SECONDS = 60;
const SESSION_TTL_DAYS = 30;

// ── TOGGLE: forced password change on first login / after a reset ─────
// true  = teachers/reset accounts must set their own password before
//         using the app (the original design).
// false = Principal/Manager's chosen password is used as-is; teachers
//         never see the forced-change screen. Nothing else in the login
//         module depends on this — the ForcedPasswordChange screen and
//         the App.jsx gate simply never trigger, since the flag they key
//         off is never set to 1 anywhere when this is false.
const REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN = true;

function _hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Single source of truth for the user object shape returned to the
// renderer — used by both auth:login and auth:resumeSession, so a session
// resumed after a restart always reflects the same (possibly changed since
// last login) role/classes/must_change_password as a fresh login would.
function _buildUserPayload(user) {
  const classRows = db.prepare('SELECT class, section FROM teacher_classes WHERE user_id = ? ORDER BY class, section')
    .all(user.user_id);
  const classes = [...new Set(classRows.map(r => r.class))].sort();
  // Per-class section scoping: [] means every section, otherwise the
  // specific letters this teacher is assigned to for that class. Any '' row
  // for a class means full access, regardless of what other rows exist.
  const classSections = {};
  classes.forEach(cls => {
    const rowsForClass = classRows.filter(r => r.class === cls);
    const hasAllSections = rowsForClass.some(r => r.section === '');
    classSections[cls] = hasAllSections ? [] : rowsForClass.map(r => r.section);
  });
  // Only Staff accounts use per-person permissions — every other role
  // still uses its fixed, role-wide bucket (defined in the renderer).
  const permissions = user.role === 'staff'
    ? db.prepare('SELECT permission FROM staff_permissions WHERE user_id = ? ORDER BY permission').all(user.user_id).map(r => r.permission)
    : [];
  return {
    user_id: user.user_id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    assigned_class: user.assigned_class,
    classes,
    classSections,
    permissions,
    must_change_password: !!user.must_change_password,
  };
}

function _createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (?, ?, datetime('now','localtime','+${SESSION_TTL_DAYS} days'))
  `).run(_hashToken(rawToken), userId);
  return rawToken;
}

// Shared by password login AND PIN verification — a PIN is much lower
// entropy than a password, so it's more important, not less, that it's
// protected by the same rate limit rather than a separate, easily
// forgotten-about implementation.
function _checkLockout(user) {
  if (!user.locked_until) return null;
  const remainingMs = new Date(user.locked_until.replace(' ', 'T')).getTime() - Date.now();
  if (remainingMs <= 0) return null;
  return {
    success: false, locked: true,
    retry_after_seconds: Math.ceil(remainingMs / 1000),
    message: `Too many failed attempts. Try again in ${Math.ceil(remainingMs / 1000)} seconds.`,
  };
}

function _recordFailedAttempt(user, genericMessage) {
  const attempts = (user.failed_attempts || 0) + 1;
  if (attempts >= LOGIN_ATTEMPT_LIMIT) {
    db.prepare(`
      UPDATE users SET failed_attempts = 0,
        locked_until = datetime('now','localtime','+${LOGIN_LOCKOUT_SECONDS} seconds')
      WHERE user_id = ?
    `).run(user.user_id);
    return {
      success: false, locked: true, retry_after_seconds: LOGIN_LOCKOUT_SECONDS,
      message: `Too many failed attempts. Try again in ${LOGIN_LOCKOUT_SECONDS} seconds.`,
    };
  }
  db.prepare('UPDATE users SET failed_attempts = ? WHERE user_id = ?').run(attempts, user.user_id);
  return { success: false, message: genericMessage };
}

function _clearLockout(userId) {
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = '' WHERE user_id = ?").run(userId);
}

ipcMain.handle('auth:login', async (_evt, { username, password }) => {
  try {
    const user = db
      .prepare('SELECT * FROM users WHERE username = ? AND is_active = 1')
      .get(username);

    if (!user) return { success: false, message: 'Invalid username or password.' };

    const lockoutResponse = _checkLockout(user);
    if (lockoutResponse) return lockoutResponse;

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return _recordFailedAttempt(user, 'Invalid username or password.');

    // Successful login — clear any lockout state and record last_login.
    _clearLockout(user.user_id);
    db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE user_id = ?").run(user.user_id);

    const session_token = _createSession(user.user_id);

    return { success: true, user: _buildUserPayload(user), session_token };
  } catch (err) {
    console.error('[auth:login]', err);
    return { success: false, message: 'Login error: ' + err.message };
  }
});

// Restores a session after the app is closed and reopened. Re-validates
// against the database each time (account could have been deactivated,
// role/classes could have changed) rather than trusting anything the
// renderer cached locally.
ipcMain.handle('auth:resumeSession', (_evt, { session_token }) => {
  try {
    if (!session_token) return { success: false };
    const tokenHash = _hashToken(session_token);

    const session = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
    if (!session) return { success: false };

    if (new Date(session.expires_at.replace(' ', 'T')).getTime() < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return { success: false, message: 'Session expired. Please sign in again.' };
    }

    const user = db.prepare('SELECT * FROM users WHERE user_id = ? AND is_active = 1').get(session.user_id);
    if (!user) {
      // Account deactivated (or deleted) since this session was created —
      // the session is no longer valid regardless of its own expiry.
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return { success: false };
    }

    // Sliding expiry — staying active resets the 30-day countdown.
    db.prepare(`
      UPDATE sessions SET last_seen_at = datetime('now','localtime'),
        expires_at = datetime('now','localtime','+${SESSION_TTL_DAYS} days')
      WHERE token_hash = ?
    `).run(tokenHash);

    return { success: true, user: _buildUserPayload(user) };
  } catch (err) {
    console.error('[auth:resumeSession]', err);
    return { success: false };
  }
});

// Explicit sign-out — invalidates the session server-side so the same
// token can't be used to resume later (unlike just clearing it locally).
ipcMain.handle('auth:logout', (_evt, { session_token }) => {
  try {
    if (session_token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(_hashToken(session_token));
    return { success: true };
  } catch (err) {
    return { success: true }; // logout should never appear to fail to the user
  }
});

// Obviously-guessable PINs are blocked outright — a 4-digit PIN already has
// far less entropy than a real password, no reason to allow the weakest of
// the weak on top of that.
const WEAK_PINS = new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','9876']);

// Set or change a quick-unlock PIN — requires the account's real current
// password as proof, same trust model as auth:changePassword. This is
// self-service only: nobody else can set a PIN on your behalf.
ipcMain.handle('auth:setPin', async (_evt, { userId, currentPassword, pin }) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return { success: false, message: 'User not found.' };

    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return { success: false, message: 'Current password is incorrect.' };

    if (!/^\d{4}$/.test(pin || '')) return { success: false, message: 'PIN must be exactly 4 digits.' };
    if (WEAK_PINS.has(pin)) return { success: false, message: 'That PIN is too easy to guess — please choose another.' };

    const hash = await bcrypt.hash(pin, 10);
    db.prepare('UPDATE users SET pin_hash = ? WHERE user_id = ?').run(hash, userId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('auth:removePin', async (_evt, { userId, currentPassword }) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return { success: false, message: 'User not found.' };
    const match = await bcrypt.compare(currentPassword, user.password_hash);
    if (!match) return { success: false, message: 'Current password is incorrect.' };
    db.prepare("UPDATE users SET pin_hash = '' WHERE user_id = ?").run(userId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Verifies a PIN for quick-switch — does NOT create a new session on its
// own. The renderer only ever calls this for a user who already has a
// live, still-valid session token saved locally from a real password
// login earlier today; this just confirms "yes, it's really you" before
// switching the active session back to them. Same rate limiting as a real
// login, since a 4-digit PIN is far easier to brute-force than a password.
ipcMain.handle('auth:verifyPin', async (_evt, { userId, pin }) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ? AND is_active = 1').get(userId);
    if (!user) return { success: false, message: 'Account not available.' };
    if (!user.pin_hash) return { success: false, message: 'No PIN set for this account.' };

    const lockoutResponse = _checkLockout(user);
    if (lockoutResponse) return lockoutResponse;

    const match = await bcrypt.compare(pin, user.pin_hash);
    if (!match) return _recordFailedAttempt(user, 'Incorrect PIN.');

    _clearLockout(user.user_id);
    return { success: true, user: _buildUserPayload(user) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('auth:changePassword', async (_evt, { userId, oldPassword, newPassword }) => {
  try {
    const user = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!user) return { success: false, message: 'User not found.' };

    const match = await bcrypt.compare(oldPassword, user.password_hash);
    if (!match) return { success: false, message: 'Current password is incorrect.' };

    if (!newPassword || newPassword.length < 6) {
      return { success: false, message: 'New password must be at least 6 characters.' };
    }

    const hash = await bcrypt.hash(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE user_id = ?').run(hash, userId);

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

ipcMain.handle('users:toggle', (_evt, { userId, isActive, requesting_user_id }) => {
  try {
    const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!target) return { success: false, message: 'Account not found.' };

    // Safeguards apply only when DISABLING — turning an account back on
    // is always safe and never needs blocking.
    if (!isActive) {
      if (requesting_user_id && Number(requesting_user_id) === Number(userId)) {
        return { success: false, message: 'You cannot disable the account you are currently logged in as.' };
      }
      if (['super_admin', 'admin'].includes(target.role)) {
        const others = db.prepare(
          "SELECT COUNT(*) as c FROM users WHERE role IN ('super_admin','admin') AND is_active = 1 AND user_id != ?"
        ).get(userId).c;
        if (others === 0) {
          return { success: false, message: 'Cannot disable the last remaining Director/Principal-tier account — create another one first.' };
        }
      }
    }

    // Hierarchy check only applies to the Staff Management tier. Teacher
    // toggling keeps its existing behavior (governed by the separate
    // 'teacherManagement' permission, checked at the page level) —
    // deliberately not folded into this newer scheme to avoid changing
    // already-working behavior.
    if (requesting_user_id && ['staff','coordinator','manager','admin','super_admin'].includes(target.role)) {
      const requesterRole = _requesterRole(requesting_user_id);
      if (!_rolesManageableBy(requesterRole).includes(target.role)) {
        return { success: false, message: 'You do not have permission to change this account\'s status.' };
      }
    }

    db.prepare('UPDATE users SET is_active = ? WHERE user_id = ?').run(isActive ? 1 : 0, userId);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── TEACHER MANAGEMENT (Principal / Manager) ──────────────────
// Purpose-built on top of the generic users table + the new
// employee_details / teacher_classes tables. Kept separate from
// users:create/getAll above because the shape of the operation is
// genuinely different (auto-generated credentials, multi-table writes,
// masked sensitive fields) — not a case of duplicating existing logic,
// just orchestrating it for a specific flow.

function _generateTeacherUsername(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const clean = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const first = clean(parts[0] || 'teacher');
  const last  = clean(parts.length > 1 ? parts[parts.length - 1] : '');
  const base  = last ? `${first}.${last}` : first;

  let username = `${base}@bps.in`;
  let n = 2;
  while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    username = `${base}${n}@bps.in`;
    n++;
  }
  return username;
}

// Format: XXXXAYYYYA — first letter capital, next 3 lowercase, a symbol,
// 4 digits, a symbol. Uses crypto.randomInt (not Math.random) since this
// becomes a real login credential.
function _generateTeacherPassword() {
  const UPPER   = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no ambiguous I/O
  const LOWER   = 'abcdefghjkmnpqrstuvwxyz';
  const DIGITS  = '0123456789';
  const SYMBOLS = '!@#$%&*';
  const pick = (chars) => chars[crypto.randomInt(chars.length)];

  let pw = pick(UPPER);
  for (let i = 0; i < 3; i++) pw += pick(LOWER);
  pw += pick(SYMBOLS);
  for (let i = 0; i < 4; i++) pw += pick(DIGITS);
  pw += pick(SYMBOLS);
  return pw;
}

function _maskAadhar(aadhar) {
  const digits = String(aadhar || '').replace(/\D/g, '');
  if (digits.length < 4) return digits ? 'XXXX' : '';
  return 'XXXX XXXX ' + digits.slice(-4);
}

function _maskPAN(pan) {
  const p = String(pan || '').trim();
  if (p.length < 4) return p ? 'XXXXXXXXXX' : '';
  return 'X'.repeat(p.length - 4) + p.slice(-4);
}

// Server-side mirror of the frontend's validation — the UI already checks
// this, but a request could bypass it entirely (a stale form, a future bug
// elsewhere, or just someone poking devtools), so it's enforced here too.
// Shared by every account type (Teacher, Staff, Coordinator, Manager,
// Admin) — the personal-details rules (DOB/Aadhar/PAN/mobile) don't vary
// by role, only what's required ON TOP of them does.
// Permissions a Staff account can be individually granted. Deliberately
// excludes anything with serious, hard-to-undo consequences (backup/
// restore, whole-school fee settings, legal documents like TC, bulk
// operations like Excel import or year-end promotion, editing PAST
// attendance) — those stay Principal/Director-tier regardless of how
// flexible per-staff permissions become.
const STAFF_ASSIGNABLE_PERMISSIONS = [
  'admission', 'studentList', 'feesLedger', 'feesReceipt', 'feesNotice',
  'admitCard', 'examination', 'rollNumbers', 'academicCalendar',
  'approveAdmission', 'attendance',
];

// Who can create/manage which role — Director creates admin-tier-and-above
// (Director, Principal/Administrator), Principal creates everyone below
// that (Staff, Coordinator, Manager). Teacher accounts stay on their own
// dedicated Teacher Management flow, not part of this. Checked against the
// ACTUAL requester role looked up from the database, never trusted from
// whatever the renderer claims about itself.
function _rolesManageableBy(actingRole) {
  // Director: everything in Staff Management except Teacher accounts,
  // which stay exclusively on the separate Teacher Management flow
  // (Principal + Manager), untouched by this change.
  if (actingRole === 'super_admin') return ['super_admin', 'admin', 'staff', 'coordinator', 'manager'];
  if (actingRole === 'admin')       return ['staff', 'coordinator', 'manager'];
  return [];
}

function _validatePersonalDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number }) {
  if (!full_name || !full_name.trim()) return 'Name is required.';

  if (date_of_birth) {
    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime())) return 'Date of birth is not a valid date.';
    if (dob > new Date()) return 'Date of birth cannot be in the future.';
    const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    if (age < 18) return 'Date of birth suggests an age below 18 — please check it.';
    if (age > 80) return 'Date of birth suggests an age above 80 — please check it.';
  }

  if (aadhar_number) {
    const digits = String(aadhar_number).replace(/\s+/g, '');
    if (!/^\d{12}$/.test(digits)) return 'Aadhar number must be exactly 12 digits.';
  }

  if (pan_number) {
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(pan_number).trim())) {
      return 'PAN number must be in the format ABCDE1234F (5 letters, 4 digits, 1 letter).';
    }
  }

  if (mobile_number) {
    const digits = String(mobile_number).replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(digits)) return 'Mobile number must be a valid 10-digit Indian number.';
  }

  return null;
}

function _validateTeacherDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, classes }) {
  const personalError = _validatePersonalDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number });
  if (personalError) return personalError;
  if (!Array.isArray(classes) || classes.length === 0) return 'At least one class must be assigned.';
  return null;
}

function _validateStaffDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, role, permissions }) {
  const personalError = _validatePersonalDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number });
  if (personalError) return personalError;
  if (role === 'staff') {
    if (!Array.isArray(permissions) || permissions.length === 0) {
      return 'At least one permission must be assigned for a Staff account.';
    }
    const invalid = permissions.filter(p => !STAFF_ASSIGNABLE_PERMISSIONS.includes(p));
    if (invalid.length > 0) return `Not a staff-assignable permission: ${invalid.join(', ')}.`;
  }
  return null;
}

// Create a teacher: writes users + employee_details + teacher_classes in
// one transaction — either the whole teacher exists, or none of it does.
// Converts raw teacher_classes rows (class, section) into the shape the
// frontend edits: one entry per class, sections=[] meaning 'all sections'.
function _classRowsToAssignments(rows) {
  const byClass = {};
  rows.forEach(r => { (byClass[r.class] = byClass[r.class] || []).push(r.section); });
  return Object.keys(byClass).sort().map(cls => ({
    class: cls,
    sections: byClass[cls].includes('') ? [] : byClass[cls].filter(Boolean).sort(),
  }));
}

ipcMain.handle('teachers:create', async (_evt, {
  full_name, father_husband_name, date_of_birth, aadhar_number, pan_number,
  qualification, mobile_number, address, classAssignments,
}) => {
  try {
    const classNames = (classAssignments || []).map(a => a.class);
    const validationError = _validateTeacherDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, classes: classNames });
    if (validationError) return { success: false, message: validationError };

    const cleanAadhar = String(aadhar_number || '').replace(/\s+/g, '');
    const cleanMobile = String(mobile_number || '').replace(/\D/g, '');
    const cleanPan     = String(pan_number || '').trim().toUpperCase();

    const username = _generateTeacherUsername(full_name);
    const plainPassword = _generateTeacherPassword();
    const hash = await bcrypt.hash(plainPassword, 10);

    const createTeacher = db.transaction(() => {
      const userResult = db.prepare(
        'INSERT INTO users (username, password_hash, full_name, role, assigned_class, must_change_password) VALUES (?,?,?,?,?,?)'
      ).run(username, hash, full_name.trim(), 'teacher', classNames[0] || '', REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN ? 1 : 0);

      const userId = userResult.lastInsertRowid;

      db.prepare(`
        INSERT INTO employee_details
          (user_id, father_husband_name, date_of_birth, aadhar_number, pan_number, qualification, mobile_number, address)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(userId, father_husband_name || '', date_of_birth || '', cleanAadhar,
             cleanPan, qualification || '', cleanMobile, address || '');

      const insertClass = db.prepare('INSERT OR IGNORE INTO teacher_classes (user_id, class, section) VALUES (?, ?, ?)');
      (classAssignments || []).forEach(a => {
        if (!a.sections || a.sections.length === 0) insertClass.run(userId, a.class, '');
        else a.sections.forEach(sec => insertClass.run(userId, a.class, sec));
      });

      return userId;
    });

    const userId = createTeacher();
    return { success: true, user_id: userId, username, password: plainPassword };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// List all teachers with masked Aadhar/PAN — for the Teacher Management
// table view. Full unmasked detail only via teachers:getOne.
ipcMain.handle('teachers:getAll', async () => {
  try {
    const rows = db.prepare(`
      SELECT u.user_id, u.username, u.full_name, u.is_active, u.created_at, u.last_login,
             e.father_husband_name, e.date_of_birth, e.aadhar_number, e.pan_number,
             e.qualification, e.mobile_number, e.address
      FROM   users u
      LEFT JOIN employee_details e ON e.user_id = u.user_id
      WHERE  u.role = 'teacher'
      ORDER  BY u.full_name
    `).all();

    const classRows = db.prepare('SELECT user_id, class, section FROM teacher_classes ORDER BY class, section').all();
    const rowsByUser = {};
    classRows.forEach(r => { (rowsByUser[r.user_id] = rowsByUser[r.user_id] || []).push(r); });

    const data = rows.map(r => {
      const assignments = _classRowsToAssignments(rowsByUser[r.user_id] || []);
      return {
        user_id: r.user_id, username: r.username, full_name: r.full_name,
        is_active: r.is_active, created_at: r.created_at, last_login: r.last_login,
        father_husband_name: r.father_husband_name, date_of_birth: r.date_of_birth,
        aadhar_number: _maskAadhar(r.aadhar_number), pan_number: _maskPAN(r.pan_number),
        qualification: r.qualification, mobile_number: r.mobile_number, address: r.address,
        classes: assignments.map(a => a.class), // flat names, for simple badge display
        classAssignments: assignments,           // rich shape, for editing
      };
    });

    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Full unmasked detail for one teacher — only called when a specific
// record is opened, not for the list view.
ipcMain.handle('teachers:getOne', async (_evt, { userId }) => {
  try {
    const user = db.prepare(
      "SELECT user_id, username, full_name, is_active, created_at, last_login FROM users WHERE user_id = ? AND role = 'teacher'"
    ).get(userId);
    if (!user) return { success: false, message: 'Teacher not found.' };

    const details = db.prepare('SELECT * FROM employee_details WHERE user_id = ?').get(userId) || {};
    const classRows = db.prepare('SELECT class, section FROM teacher_classes WHERE user_id = ? ORDER BY class, section').all(userId);
    const classAssignments = _classRowsToAssignments(classRows);

    return { success: true, data: { ...user, ...details, classes: classAssignments.map(a => a.class), classAssignments } };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Update a teacher's details/classes (not credentials — see
// teachers:resetPassword for that, kept deliberately separate).
ipcMain.handle('teachers:update', async (_evt, {
  userId, full_name, father_husband_name, date_of_birth, aadhar_number, pan_number,
  qualification, mobile_number, address, classAssignments,
}) => {
  try {
    const classNames = (classAssignments || []).map(a => a.class);
    const validationError = _validateTeacherDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, classes: classNames });
    if (validationError) return { success: false, message: validationError };

    const cleanAadhar = String(aadhar_number || '').replace(/\s+/g, '');
    const cleanMobile = String(mobile_number || '').replace(/\D/g, '');
    const cleanPan     = String(pan_number || '').trim().toUpperCase();

    const doUpdate = db.transaction(() => {
      db.prepare('UPDATE users SET full_name = ?, assigned_class = ? WHERE user_id = ?')
        .run(full_name || '', classNames[0] || '', userId);

      db.prepare(`
        UPDATE employee_details
        SET father_husband_name = ?, date_of_birth = ?, aadhar_number = ?, pan_number = ?,
            qualification = ?, mobile_number = ?, address = ?, updated_at = datetime('now','localtime')
        WHERE user_id = ?
      `).run(father_husband_name || '', date_of_birth || '', cleanAadhar, cleanPan,
             qualification || '', cleanMobile, address || '', userId);

      db.prepare('DELETE FROM teacher_classes WHERE user_id = ?').run(userId);
      const insertClass = db.prepare('INSERT OR IGNORE INTO teacher_classes (user_id, class, section) VALUES (?, ?, ?)');
      (classAssignments || []).forEach(a => {
        if (!a.sections || a.sections.length === 0) insertClass.run(userId, a.class, '');
        else a.sections.forEach(sec => insertClass.run(userId, a.class, sec));
      });
    });
    doUpdate();

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Principal/Manager password reset — generates and returns a brand new
// password ONCE. Deliberately separate from auth:changePassword (self
// service, requires the old password) since this is a different
// authorization model: role-based override, no old password needed, and
// nothing is ever stored in a form that could be "looked up" again later.
ipcMain.handle('teachers:resetPassword', async (_evt, { userId }) => {
  try {
    const user = db.prepare("SELECT user_id FROM users WHERE user_id = ? AND role = 'teacher'").get(userId);
    if (!user) return { success: false, message: 'Teacher not found.' };

    const plainPassword = _generateTeacherPassword();
    const hash = await bcrypt.hash(plainPassword, 10);
    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = ?, failed_attempts = 0, locked_until = ''
      WHERE user_id = ?
    `).run(hash, REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN ? 1 : 0, userId);

    return { success: true, password: plainPassword };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── STAFF MANAGEMENT (Principal / Director) ────────────────────
// Covers Staff, Coordinator, Manager (Principal-creatable) and
// Admin/Director (Director-creatable). Teacher stays on its own dedicated
// flow above. Reuses the same username/password generation, masking, and
// validation primitives already built for Teacher Management — the shape
// of "create an account with generated credentials" doesn't change by
// role, only the hierarchy check and the permission-list handling do.

function _requesterRole(requestingUserId) {
  if (!requestingUserId) return null;
  const row = db.prepare('SELECT role FROM users WHERE user_id = ? AND is_active = 1').get(requestingUserId);
  return row ? row.role : null;
}

ipcMain.handle('team:create', async (_evt, {
  requesting_user_id, full_name, father_husband_name, date_of_birth, aadhar_number, pan_number,
  qualification, mobile_number, address, role, permissions,
}) => {
  try {
    const requesterRole = _requesterRole(requesting_user_id);
    const allowedRoles = _rolesManageableBy(requesterRole);
    if (!allowedRoles.includes(role)) {
      return { success: false, message: 'You do not have permission to create this type of account.' };
    }

    const validationError = _validateStaffDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, role, permissions });
    if (validationError) return { success: false, message: validationError };

    const cleanAadhar = String(aadhar_number || '').replace(/\s+/g, '');
    const cleanMobile = String(mobile_number || '').replace(/\D/g, '');
    const cleanPan     = String(pan_number || '').trim().toUpperCase();

    const username = _generateTeacherUsername(full_name);
    const plainPassword = _generateTeacherPassword();
    const hash = await bcrypt.hash(plainPassword, 10);

    const createAccount = db.transaction(() => {
      const userResult = db.prepare(
        'INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?,?,?,?,?)'
      ).run(username, hash, full_name.trim(), role, REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN ? 1 : 0);

      const userId = userResult.lastInsertRowid;

      db.prepare(`
        INSERT INTO employee_details
          (user_id, father_husband_name, date_of_birth, aadhar_number, pan_number, qualification, mobile_number, address)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(userId, father_husband_name || '', date_of_birth || '', cleanAadhar,
             cleanPan, qualification || '', cleanMobile, address || '');

      if (role === 'staff' && Array.isArray(permissions)) {
        const insertPerm = db.prepare('INSERT OR IGNORE INTO staff_permissions (user_id, permission) VALUES (?, ?)');
        permissions.forEach(p => insertPerm.run(userId, p));
      }

      return userId;
    });

    const userId = createAccount();
    return { success: true, user_id: userId, username, password: plainPassword };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// List every account the requester is allowed to manage. Director sees
// the full picture (their own tier and everything below, minus teachers —
// those stay on the dedicated Teacher Management page); Principal sees
// only what they're actually allowed to create/manage.
ipcMain.handle('team:getAll', async (_evt, { requesting_user_id }) => {
  try {
    const requesterRole = _requesterRole(requesting_user_id);
    const visibleRoles = _rolesManageableBy(requesterRole);
    if (visibleRoles.length === 0) return { success: false, message: 'You do not have permission to view this.' };

    const placeholders = visibleRoles.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT u.user_id, u.username, u.full_name, u.role, u.is_active, u.created_at, u.last_login,
             e.father_husband_name, e.date_of_birth, e.aadhar_number, e.pan_number,
             e.qualification, e.mobile_number, e.address
      FROM   users u
      LEFT JOIN employee_details e ON e.user_id = u.user_id
      WHERE  u.role IN (${placeholders})
      ORDER  BY u.role, u.full_name
    `).all(...visibleRoles);

    const permRows = db.prepare('SELECT user_id, permission FROM staff_permissions ORDER BY permission').all();
    const permsByUser = {};
    permRows.forEach(r => { (permsByUser[r.user_id] ||= []).push(r.permission); });

    const data = rows.map(r => ({
      user_id: r.user_id, username: r.username, full_name: r.full_name, role: r.role,
      is_active: r.is_active, created_at: r.created_at, last_login: r.last_login,
      father_husband_name: r.father_husband_name, date_of_birth: r.date_of_birth,
      aadhar_number: _maskAadhar(r.aadhar_number), pan_number: _maskPAN(r.pan_number),
      qualification: r.qualification, mobile_number: r.mobile_number, address: r.address,
      permissions: permsByUser[r.user_id] || [],
    }));

    return { success: true, data, staffAssignablePermissions: STAFF_ASSIGNABLE_PERMISSIONS };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('team:getOne', async (_evt, { requesting_user_id, userId }) => {
  try {
    const requesterRole = _requesterRole(requesting_user_id);
    const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!target) return { success: false, message: 'Account not found.' };
    if (!_rolesManageableBy(requesterRole).includes(target.role)) {
      return { success: false, message: 'You do not have permission to view this account.' };
    }

    const details = db.prepare('SELECT * FROM employee_details WHERE user_id = ?').get(userId) || {};
    const permissions = target.role === 'staff'
      ? db.prepare('SELECT permission FROM staff_permissions WHERE user_id = ? ORDER BY permission').all(userId).map(r => r.permission)
      : [];

    return { success: true, data: { ...target, ...details, permissions } };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('team:update', async (_evt, {
  requesting_user_id, userId, full_name, father_husband_name, date_of_birth, aadhar_number, pan_number,
  qualification, mobile_number, address, permissions,
}) => {
  try {
    const requesterRole = _requesterRole(requesting_user_id);
    const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!target) return { success: false, message: 'Account not found.' };
    if (!_rolesManageableBy(requesterRole).includes(target.role)) {
      return { success: false, message: 'You do not have permission to edit this account.' };
    }

    const validationError = _validateStaffDetails({ full_name, date_of_birth, aadhar_number, pan_number, mobile_number, role: target.role, permissions });
    if (validationError) return { success: false, message: validationError };

    const cleanAadhar = String(aadhar_number || '').replace(/\s+/g, '');
    const cleanMobile = String(mobile_number || '').replace(/\D/g, '');
    const cleanPan     = String(pan_number || '').trim().toUpperCase();

    const doUpdate = db.transaction(() => {
      db.prepare('UPDATE users SET full_name = ? WHERE user_id = ?').run(full_name || '', userId);

      db.prepare(`
        UPDATE employee_details
        SET father_husband_name = ?, date_of_birth = ?, aadhar_number = ?, pan_number = ?,
            qualification = ?, mobile_number = ?, address = ?, updated_at = datetime('now','localtime')
        WHERE user_id = ?
      `).run(father_husband_name || '', date_of_birth || '', cleanAadhar, cleanPan,
             qualification || '', cleanMobile, address || '', userId);

      if (target.role === 'staff') {
        db.prepare('DELETE FROM staff_permissions WHERE user_id = ?').run(userId);
        const insertPerm = db.prepare('INSERT OR IGNORE INTO staff_permissions (user_id, permission) VALUES (?, ?)');
        (permissions || []).forEach(p => insertPerm.run(userId, p));
      }
    });
    doUpdate();

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('team:resetPassword', async (_evt, { requesting_user_id, userId }) => {
  try {
    const requesterRole = _requesterRole(requesting_user_id);
    const target = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    if (!target) return { success: false, message: 'Account not found.' };
    if (!_rolesManageableBy(requesterRole).includes(target.role)) {
      return { success: false, message: 'You do not have permission to reset this account\'s password.' };
    }

    const plainPassword = _generateTeacherPassword();
    const hash = await bcrypt.hash(plainPassword, 10);
    db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = ?, failed_attempts = 0, locked_until = ''
      WHERE user_id = ?
    `).run(hash, REQUIRE_PASSWORD_CHANGE_ON_FIRST_LOGIN ? 1 : 0, userId);

    return { success: true, password: plainPassword };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── HOMEWORK ─────────────────────────────────────────────────
// Subjects/Chapters are Principal-managed reference data; teachers write
// homework entries against them, scoped to their own classes (reusing the
// existing _classAccessDenied check built for Attendance/Examination).

// Standard curriculum per class — seeded automatically so Principal
// doesn't have to type out the same subject list for every class by hand.
// Classes 9-12 have no default list (not specified) — Principal adds
// those manually, same as adding anything extra beyond the defaults below.
const DEFAULT_SUBJECTS_BY_CLASS = {
  'Nursery': ['Hindi', 'English', 'Math', 'Drawing'],
  'LKG':     ['Hindi', 'English', 'Math', 'Drawing'],
  'UKG':     ['Hindi', 'English', 'Math', 'EVS', 'Computer', 'Drawing'],
  'Class 1': ['Hindi', 'English', 'Math', 'EVS', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 2': ['Hindi', 'English', 'Math', 'EVS', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 3': ['Hindi', 'English', 'Math', 'EVS', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 4': ['Hindi', 'English', 'Math', 'EVS', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 5': ['Hindi', 'English', 'Math', 'EVS', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 6': ['Hindi', 'English', 'Math', 'Science', 'SST', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 7': ['Hindi', 'English', 'Math', 'Science', 'SST', 'General Knowledge', 'Computer', 'Drawing'],
  'Class 8': ['Hindi', 'English', 'Math', 'Science', 'SST', 'General Knowledge', 'Computer', 'Drawing'],
};

// Idempotent — INSERT OR IGNORE means calling this every time a class is
// opened is safe; it only ever fills in whatever's still missing, never
// duplicates or resets anything Principal has already customized.
ipcMain.handle('subjects:ensureDefaults', (_evt, { class: cls }) => {
  try {
    const defaults = DEFAULT_SUBJECTS_BY_CLASS[cls];
    if (!defaults || defaults.length === 0) return { success: true, seeded: false };
    const insert = db.prepare('INSERT OR IGNORE INTO subjects (class, subject_name) VALUES (?, ?)');
    db.transaction(() => defaults.forEach(name => insert.run(cls, name)))();
    return { success: true, seeded: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('subjects:getAll', (_evt, { class: cls }) => {
  try {
    const rows = cls
      ? db.prepare(`
          SELECT s.*, u.full_name as teacher_name
          FROM   subjects s
          LEFT JOIN users u ON u.user_id = s.teacher_id
          WHERE  s.class = ? ORDER BY s.subject_name
        `).all(cls)
      : db.prepare(`
          SELECT s.*, u.full_name as teacher_name
          FROM   subjects s
          LEFT JOIN users u ON u.user_id = s.teacher_id
          ORDER  BY s.class, s.subject_name
        `).all();
    return { success: true, data: rows };
  } catch (err) { return { success: false, message: err.message }; }
});

// Assign (or unassign, if teacher_id is null/empty) which teacher actually
// teaches this subject — separate from teacher_classes, which only
// governs who can log homework for the class at all.
ipcMain.handle('subjects:assignTeacher', (_evt, { subject_id, teacher_id }) => {
  try {
    if (!subject_id) return { success: false, message: 'Subject is required.' };
    db.prepare('UPDATE subjects SET teacher_id = ? WHERE subject_id = ?').run(teacher_id || null, subject_id);
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('subjects:create', (_evt, { class: cls, subject_name }) => {
  try {
    if (!cls || !subject_name?.trim()) return { success: false, message: 'Class and subject name are required.' };
    db.prepare('INSERT INTO subjects (class, subject_name) VALUES (?, ?)').run(cls, subject_name.trim());
    return { success: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { success: false, message: 'This subject already exists for this class.' };
    return { success: false, message: err.message };
  }
});

ipcMain.handle('subjects:delete', (_evt, { subject_id }) => {
  try {
    const inUse = db.prepare('SELECT COUNT(*) as c FROM homework_entries WHERE subject_id = ?').get(subject_id).c;
    if (inUse > 0) return { success: false, message: `Cannot delete — ${inUse} homework entr${inUse === 1 ? 'y' : 'ies'} already reference this subject.` };
    db.transaction(() => {
      db.prepare('DELETE FROM chapters WHERE subject_id = ?').run(subject_id);
      db.prepare('DELETE FROM subjects WHERE subject_id = ?').run(subject_id);
    })();
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('chapters:getAll', (_evt, { subject_id }) => {
  try {
    const rows = db.prepare('SELECT * FROM chapters WHERE subject_id = ? ORDER BY chapter_id').all(subject_id);
    return { success: true, data: rows };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('chapters:create', (_evt, { subject_id, chapter_name }) => {
  try {
    if (!subject_id || !chapter_name?.trim()) return { success: false, message: 'Subject and chapter name are required.' };
    db.prepare('INSERT INTO chapters (subject_id, chapter_name) VALUES (?, ?)').run(subject_id, chapter_name.trim());
    return { success: true };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) return { success: false, message: 'This chapter already exists for this subject.' };
    return { success: false, message: err.message };
  }
});

ipcMain.handle('chapters:delete', (_evt, { chapter_id }) => {
  try {
    const inUse = db.prepare('SELECT COUNT(*) as c FROM homework_entries WHERE chapter_id = ?').get(chapter_id).c;
    if (inUse > 0) return { success: false, message: `Cannot delete — ${inUse} homework entr${inUse === 1 ? 'y' : 'ies'} already reference this chapter.` };
    db.prepare('DELETE FROM chapters WHERE chapter_id = ?').run(chapter_id);
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

// Save a subject's whole Table of Contents in one go. Diffs against what's
// already there — new chapter names get added, chapters no longer in the
// list get removed UNLESS a teacher has already logged homework against
// them, in which case they're kept (never silently orphaning a saved
// homework entry) and reported back so Principal knows why.
ipcMain.handle('chapters:saveAll', (_evt, { subject_id, chapter_names }) => {
  try {
    if (!subject_id) return { success: false, message: 'Subject is required.' };
    const names = (chapter_names || []).map(n => String(n).trim()).filter(Boolean);
    if (names.length === 0) return { success: false, message: 'Add at least one chapter before saving.' };
    const counts = {};
    names.forEach(n => { counts[n] = (counts[n] || 0) + 1; });
    const dupeNames = Object.keys(counts).filter(n => counts[n] > 1);
    if (dupeNames.length > 0) {
      return { success: false, message: `Duplicate chapter name${dupeNames.length > 1 ? 's' : ''}: "${dupeNames.join('", "')}" — appears more than once in the list. Please make each chapter name unique.` };
    }

    const existing = db.prepare('SELECT chapter_id, chapter_name FROM chapters WHERE subject_id = ?').all(subject_id);
    const existingNames = new Set(existing.map(c => c.chapter_name));
    const uniqueNames = new Set(names);
    const toAdd    = names.filter(n => !existingNames.has(n));
    const toRemove = existing.filter(c => !uniqueNames.has(c.chapter_name));
    const blockedRemovals = [];

    db.transaction(() => {
      const insert = db.prepare('INSERT INTO chapters (subject_id, chapter_name) VALUES (?, ?)');
      toAdd.forEach(n => insert.run(subject_id, n));

      toRemove.forEach(c => {
        const inUse = db.prepare('SELECT COUNT(*) as cnt FROM homework_entries WHERE chapter_id = ?').get(c.chapter_id).cnt;
        if (inUse > 0) { blockedRemovals.push(c.chapter_name); return; }
        db.prepare('DELETE FROM chapters WHERE chapter_id = ?').run(c.chapter_id);
      });
    })();

    return {
      success: true,
      warning: blockedRemovals.length > 0
        ? `Kept "${blockedRemovals.join('", "')}" — already used in saved homework, so it can't be removed.`
        : null,
    };
  } catch (err) { return { success: false, message: err.message }; }
});

// Absent students for a class+date — used on the teacher's Daily
// Homework Report. Deliberately not scoped by section (unlike
// attendance:getByDate) since Homework itself has no section concept —
// this aggregates across every section of the class for that date.
ipcMain.handle('attendance:getAbsentByDate', (_evt, { class: cls, date, requesting_user_id }) => {
  try {
    if (_classAccessDenied(requesting_user_id, cls)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
    const rows = db.prepare(`
      SELECT admission_number, student_name, section
      FROM   attendance_daily
      WHERE  LOWER(class) = LOWER(?) AND date = ? AND status = 'Absent'
      ORDER  BY student_name
    `).all(cls, date);
    return { success: true, data: rows };
  } catch (err) { return { success: false, message: err.message }; }
});

// A teacher's homework list for one class+date (to load/edit before saving).
ipcMain.handle('homework:getForDate', (_evt, { requesting_user_id, class: cls, date }) => {
  try {
    if (_classAccessDenied(requesting_user_id, cls)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
    const rows = db.prepare(`
      SELECT h.entry_id, h.subject_id, s.subject_name, h.chapter_id, c.chapter_name, h.classwork, h.remarks
      FROM   homework_entries h
      JOIN   subjects s ON s.subject_id = h.subject_id
      LEFT JOIN chapters c ON c.chapter_id = h.chapter_id
      WHERE  h.teacher_id = ? AND h.class = ? AND h.date = ?
      ORDER  BY h.entry_id
    `).all(requesting_user_id, cls, date);
    return { success: true, data: rows };
  } catch (err) { return { success: false, message: err.message }; }
});

// Saves the WHOLE list for that teacher+class+date in one go — replaces
// whatever was there before (delete + reinsert in one transaction), same
// idea as Attendance's "mark the whole day, then Save" pattern. Avoids
// duplicate accumulation across repeated edits to the same day.
ipcMain.handle('homework:save', (_evt, { requesting_user_id, class: cls, date, entries }) => {
  try {
    if (_classAccessDenied(requesting_user_id, cls)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
    if (!date) return { success: false, message: 'Date is required.' };
    if (!Array.isArray(entries) || entries.length === 0) {
      return { success: false, message: 'Add at least one homework entry before saving.' };
    }
    // Chapter is optional — some subjects (Hindi, Hindi Grammar) may never
    // get chapters written up. A subject only needs SOMETHING to save: a
    // chapter, or classwork text, or homework text.
    for (const e of entries) {
      if (!e.subject_id) return { success: false, message: 'Every entry needs a subject selected.' };
      if (!e.chapter_id && !(e.classwork || '').trim() && !(e.remarks || '').trim()) {
        return { success: false, message: 'Each entry needs a chapter, classwork, or homework filled in — not all blank.' };
      }
    }

    const doSave = db.transaction(() => {
      db.prepare('DELETE FROM homework_entries WHERE teacher_id = ? AND class = ? AND date = ?').run(requesting_user_id, cls, date);
      const insert = db.prepare('INSERT INTO homework_entries (teacher_id, class, date, subject_id, chapter_id, classwork, remarks) VALUES (?,?,?,?,?,?,?)');
      entries.forEach(e => insert.run(requesting_user_id, cls, date, e.subject_id, e.chapter_id || null, e.classwork || '', e.remarks || ''));
    });
    doSave();

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

// Principal/Director oversight — every teacher's homework, filterable by
// date range, class, teacher, and subject.
ipcMain.handle('homework:getAll', (_evt, { from_date, to_date, class: cls, teacher_id, subject_id }) => {
  try {
    const conditions = [];
    const params = [];
    if (from_date) { conditions.push("date(substr(h.date,7,4)||'-'||substr(h.date,4,2)||'-'||substr(h.date,1,2)) >= date(substr(?,7,4)||'-'||substr(?,4,2)||'-'||substr(?,1,2))"); params.push(from_date, from_date, from_date); }
    if (to_date)   { conditions.push("date(substr(h.date,7,4)||'-'||substr(h.date,4,2)||'-'||substr(h.date,1,2)) <= date(substr(?,7,4)||'-'||substr(?,4,2)||'-'||substr(?,1,2))"); params.push(to_date, to_date, to_date); }
    if (cls)         { conditions.push('h.class = ?'); params.push(cls); }
    if (teacher_id)  { conditions.push('h.teacher_id = ?'); params.push(teacher_id); }
    if (subject_id)  { conditions.push('h.subject_id = ?'); params.push(subject_id); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = db.prepare(`
      SELECT h.entry_id, h.class, h.date, h.classwork, h.remarks,
             COALESCE(st.full_name, u.full_name) as teacher_name,
             u.full_name as entered_by_name,
             s.subject_name, c.chapter_name
      FROM   homework_entries h
      JOIN   users u    ON u.user_id = h.teacher_id
      JOIN   subjects s ON s.subject_id = h.subject_id
      LEFT JOIN chapters c ON c.chapter_id = h.chapter_id
      LEFT JOIN users st ON st.user_id = s.teacher_id
      ${where}
      ORDER  BY date(substr(h.date,7,4)||'-'||substr(h.date,4,2)||'-'||substr(h.date,1,2)) DESC, h.class, teacher_name
    `).all(...params);
    return { success: true, data: rows };
  } catch (err) { return { success: false, message: err.message }; }
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

// Returns a teacher's allowed sections for a class: null means
// unrestricted (non-teacher, or teacher has full-class access), [] means
// no access to this class at all, otherwise the specific letters allowed.
function _allowedSectionsForTeacher(userId, className) {
  const requester = userId ? db.prepare('SELECT role FROM users WHERE user_id = ?').get(userId) : null;
  if (!requester || requester.role !== 'teacher') return null;
  const rows = db.prepare('SELECT section FROM teacher_classes WHERE user_id = ? AND class = ?').all(userId, className);
  if (rows.length === 0) return [];
  if (rows.some(r => r.section === '')) return null;
  return rows.map(r => r.section);
}

ipcMain.handle('enrollment:getByClass', (_evt, { class: cls, section, academic_year, requesting_user_id }) => {
  if (cls === 'ALL') {
    // Only non-teacher roles may request every class at once — teachers
    // stay restricted to their own classes regardless of what the UI offers.
    const requester = requesting_user_id ? db.prepare('SELECT role FROM users WHERE user_id = ?').get(requesting_user_id) : null;
    if (requester && requester.role === 'teacher') {
      return { success: false, message: 'You do not have access to view all classes.' };
    }
    const rows = db.prepare(`
      SELECT * FROM enrollment
      WHERE student_status = 'ACTIVE'
      ORDER BY CASE current_class
        WHEN 'Nursery' THEN 0 WHEN 'LKG' THEN 1 WHEN 'UKG' THEN 2
        WHEN 'Class 1' THEN 3 WHEN 'Class 2' THEN 4 WHEN 'Class 3' THEN 5
        WHEN 'Class 4' THEN 6 WHEN 'Class 5' THEN 7 WHEN 'Class 6' THEN 8
        WHEN 'Class 7' THEN 9 WHEN 'Class 8' THEN 10 WHEN 'Class 9' THEN 11
        WHEN 'Class 10' THEN 12 WHEN 'Class 11' THEN 13 WHEN 'Class 12' THEN 14
        ELSE 99 END, student_name
    `).all();
    return { success: true, data: rows };
  }

  const allowedSections = _allowedSectionsForTeacher(requesting_user_id, cls);
  if (Array.isArray(allowedSections) && allowedSections.length === 0) {
    return { success: false, message: 'You do not have access to this class.' };
  }
  if (section && Array.isArray(allowedSections) && !allowedSections.includes(section)) {
    return { success: false, message: 'You do not have access to this section.' };
  }

  let sectionClause = '';
  const sectionParams = [];
  if (section) {
    sectionClause = 'AND e.section = ?';
    sectionParams.push(section);
  } else if (Array.isArray(allowedSections)) {
    // Section-scoped teacher, no specific section chosen — show only the
    // sections they're actually assigned to, not the whole class.
    sectionClause = `AND e.section IN (${allowedSections.map(() => '?').join(',')})`;
    sectionParams.push(...allowedSections);
  }

  // Roll-number ordering only makes sense for one specific section — that's
  // the only case with a single, coherent sequence to sort by. Anything
  // broader (no section chosen, multiple allowed sections) stays
  // alphabetical, same as before.
  let joinClause = '';
  let orderClause = 'ORDER BY e.student_name';
  const joinParams = [];
  if (section) {
    joinClause = `
      LEFT JOIN roll_numbers rn
        ON rn.admission_number = e.admission_number
        AND LOWER(rn.class) = LOWER(e.current_class)
        AND rn.section = e.section
        AND rn.academic_year = ?
    `;
    joinParams.push(academic_year || '');
    orderClause = 'ORDER BY CASE WHEN rn.roll_number IS NULL THEN 1 ELSE 0 END, rn.roll_number, e.student_name';
  }

  // Use LOWER() on both sides so 'Nursery', 'NURSERY', 'nursery' all match
  const rows = db.prepare(`
    SELECT e.*${section ? ', rn.roll_number as roll_number' : ''}
    FROM   enrollment e
    ${joinClause}
    WHERE  LOWER(e.current_class) = LOWER(?)
    AND    e.student_status = 'ACTIVE'
    ${sectionClause}
    ${orderClause}
  `).all(...joinParams, cls, ...sectionParams);
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

    // If this edit results in the student being ACTIVE, and that
    // class/section's roll numbers are already frozen, append them a
    // mid-year roll number if they don't already have one — covers both
    // reactivating from DROPBOX status and moving into a different,
    // already-frozen class/section.
    const finalStatus  = newData.student_status !== undefined ? newData.student_status : old.student_status;
    const finalClass   = newData.current_class  !== undefined ? newData.current_class  : old.current_class;
    const finalSection = newData.section        !== undefined ? newData.section        : old.section;
    const finalYear    = newData.academic_year  !== undefined ? newData.academic_year  : old.academic_year;
    if (finalStatus === 'ACTIVE' && finalClass) {
      _addMidYearRollNumber(admission_number, finalClass, finalSection, finalYear, newData.student_name || old.student_name);
    }

    // Carry attendance history to the new section — only when the class
    // itself stayed the same and just the section changed. A class
    // change (promotion, correction) is a different kind of event and
    // shouldn't relabel attendance from one class into another.
    if (old.current_class === finalClass && old.section !== finalSection) {
      _relabelAttendanceSection(admission_number, finalClass, finalSection);
    }

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
  const requestingUserId = params?.requesting_user_id;

  if (teacherClass && _classAccessDenied(requestingUserId, teacherClass)) {
    return { success: false, message: 'You do not have access to this class.' };
  }

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
    // Respects section-level scoping: a teacher assigned to specific
    // sections of this class only sees those sections' headcount, not
    // the whole class — same rule already enforced for Student List.
    const teacherClassStats = teacherClass
      ? (() => {
          const allowedSections = _allowedSectionsForTeacher(requestingUserId, teacherClass);
          const sectionClause = Array.isArray(allowedSections)
            ? `AND section IN (${allowedSections.map(() => '?').join(',') || "''"})`
            : '';
          const sectionParams = Array.isArray(allowedSections) ? allowedSections : [];
          return db.prepare(`
            SELECT COUNT(*) as total,
              SUM(CASE WHEN gender = 'M' THEN 1 ELSE 0 END) as boys,
              SUM(CASE WHEN gender = 'F' THEN 1 ELSE 0 END) as girls
            FROM enrollment
            WHERE LOWER(current_class) = LOWER(?)
            AND   student_status = 'ACTIVE'
            ${sectionClause}
          `).get(teacherClass, ...sectionParams);
        })()
      : null;

    // ── Real fee/attendance/staffing numbers — replaces the old static
    // placeholder cards. Same query shapes already proven in Counter
    // Payment (daily collection), Fee Reports (defaulters), and Attendance
    // (low attendance) — reused here rather than reinvented, and skipped
    // entirely for teacher/coordinator dashboards that don't show them.
    const academicYear = params?.academic_year || '';
    let feesCollectedToday = 0, feesCollectedThisMonth = 0, feesPendingTotal = 0,
        defaultersCount = 0, lowAttendanceCount = 0, recentReceipts = [],
        teacherCount = 0, staffCount = 0;

    if (academicYear && ['super_admin', 'admin', 'staff', 'coordinator', 'manager'].includes(role)) {
      const feeRowsToday = db.prepare(`
        SELECT COALESCE(SUM(credit),0) as total FROM fee_transactions_stage
        WHERE transaction_type = 'RECEIVED' AND status != 'CANCELLED'
        AND   DATE(collected_at) = DATE('now','localtime') AND academic_year = ?
      `).get(academicYear);
      const otherToday = db.prepare(`
        SELECT COALESCE(SUM(amount_paid),0) as total FROM counter_other_transactions
        WHERE DATE(collected_at) = DATE('now','localtime') AND academic_year = ?
      `).get(academicYear);
      feesCollectedToday = (feeRowsToday?.total || 0) + (otherToday?.total || 0);

      const feeRowsMonth = db.prepare(`
        SELECT COALESCE(SUM(credit),0) as total FROM fee_transactions_stage
        WHERE transaction_type = 'RECEIVED' AND status != 'CANCELLED'
        AND   strftime('%Y-%m', collected_at) = strftime('%Y-%m','now','localtime') AND academic_year = ?
      `).get(academicYear);
      const otherMonth = db.prepare(`
        SELECT COALESCE(SUM(amount_paid),0) as total FROM counter_other_transactions
        WHERE strftime('%Y-%m', collected_at) = strftime('%Y-%m','now','localtime') AND academic_year = ?
      `).get(academicYear);
      feesCollectedThisMonth = (feeRowsMonth?.total || 0) + (otherMonth?.total || 0);

      // Total pending + defaulter count — same balance formula as the
      // Defaulter List report, aggregated instead of returned per-row.
      const balanceRows = db.prepare(`
        SELECT l.opening_balance,
               COALESCE(pt.debit,0)   - COALESCE(pt.credit,0)   - COALESCE(pt.conc,0)   as posted_bal,
               COALESCE(st.debit,0)   - COALESCE(st.credit,0)   - COALESCE(st.conc,0)   as staged_bal
        FROM   fee_ledger l
        LEFT JOIN (
          SELECT ledger_id, SUM(debit) as debit, SUM(credit) as credit, SUM(concession) as conc
          FROM   fee_transactions WHERE academic_year = ? GROUP BY ledger_id
        ) pt ON pt.ledger_id = l.ledger_id
        LEFT JOIN (
          SELECT ledger_id, SUM(debit) as debit, SUM(credit) as credit, SUM(concession) as conc
          FROM   fee_transactions_stage WHERE academic_year = ? AND status = 'PENDING' GROUP BY ledger_id
        ) st ON st.ledger_id = l.ledger_id
        WHERE l.academic_year = ?
      `).all(academicYear, academicYear, academicYear);
      balanceRows.forEach(r => {
        const balance = (r.opening_balance || 0) + (r.posted_bal || 0) + (r.staged_bal || 0);
        if (balance > 0.005) { feesPendingTotal += balance; defaultersCount += 1; }
      });

      lowAttendanceCount = db.prepare(`
        SELECT COUNT(*) as c FROM (
          SELECT admission_number,
            (SUM(CASE WHEN status IN ('Present','Late') THEN 1 ELSE 0 END) * 100.0) / COUNT(*) as pct
          FROM attendance_daily WHERE academic_year = ?
          GROUP BY admission_number HAVING pct < 75
        )
      `).get(academicYear)?.c || 0;

      if (role === 'staff') {
        recentReceipts = db.prepare(`
          SELECT s.receipt_number, l.student_name, SUM(s.credit) as amount, MAX(s.collected_at) as collected_at
          FROM   fee_transactions_stage s
          LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
          WHERE  s.transaction_type = 'RECEIVED' AND s.status != 'CANCELLED' AND s.academic_year = ?
          GROUP  BY s.receipt_number, s.ledger_id
          ORDER  BY collected_at DESC LIMIT 5
        `).all(academicYear);
      }

      if (['super_admin', 'admin'].includes(role)) {
        teacherCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'teacher' AND is_active = 1").get().c;
        staffCount   = db.prepare("SELECT COUNT(*) as c FROM users WHERE role IN ('staff','coordinator','manager') AND is_active = 1").get().c;
      }
    }

    return {
      success: true,
      data: {
        totalActive, totalPending, totalRejected, tcIssued,
        totalBoys, totalGirls, totalUsers,
        classWise, categoryRows, recentPending,
        myPending, teacherClassStats,
        feesCollectedToday, feesCollectedThisMonth, feesPendingTotal,
        defaultersCount, lowAttendanceCount, recentReceipts,
        teacherCount, staffCount,
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

    // If this class/section's roll numbers are already frozen for the
    // year, this new student needs one appended — same rule promised on
    // the Roll Numbers screen ("mid-year additions get the next
    // available number").
    _addMidYearRollNumber(newAdmNumber, student.class_of_admission, student.section, student.academic_year, student.student_name);

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

// ── Sync missing students into an already-frozen list ─────────
// Safe alternative to Re-assign: only adds students who don't already
// have a roll number, appended alphabetically among themselves after
// the current highest number. Never touches or reshuffles anyone who
// already has one — this is what "freeze as-is, append new students at
// the end" actually means in practice.
ipcMain.handle('rollNumbers:syncMissing', (_evt, { class: cls, section, academic_year, assigned_by }) => {
  try {
    const sec = section || 'A';
    const missing = db.prepare(`
      SELECT e.admission_number, e.student_name
      FROM   enrollment e
      LEFT JOIN roll_numbers r
        ON r.admission_number = e.admission_number AND r.academic_year = ?
      WHERE  LOWER(e.current_class) = LOWER(?)
      AND    e.section = ?
      AND    e.student_status = 'ACTIVE'
      AND    r.roll_number IS NULL
      ORDER  BY e.student_name ASC
    `).all(academic_year, cls, sec);

    if (missing.length === 0) {
      return { success: true, added: 0, message: 'Everyone already has a roll number — nothing to add.' };
    }

    const maxRow = db.prepare(`
      SELECT MAX(roll_number) as max FROM roll_numbers WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
    `).get(cls, sec, academic_year);
    let next = (maxRow?.max || 0) + 1;

    const insert = db.prepare(`
      INSERT INTO roll_numbers (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `);
    db.transaction(() => {
      missing.forEach(s => { insert.run(s.admission_number, s.student_name, cls, sec, academic_year, next); next++; });
    })();

    return { success: true, added: missing.length };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Manually set/correct roll numbers for a class/section ──────
// Takes a complete, explicitly-provided list — not auto-computed at all.
// Built specifically for correcting a class after an accidental Re-assign
// wiped a carefully-built order with no backup to restore from. Validates
// thoroughly before writing anything: every student must genuinely be
// active in this exact class/section, every number a positive integer,
// no duplicates within the submitted list, and every currently-active
// student in the class/section must be covered — a partial save that
// silently drops someone is rejected rather than allowed through.
ipcMain.handle('rollNumbers:setManual', (_evt, { class: cls, section, academic_year, assignments, assigned_by }) => {
  try {
    const sec = section || 'A';
    if (!Array.isArray(assignments) || assignments.length === 0) {
      return { success: false, message: 'No roll numbers to save.' };
    }

    const activeStudents = db.prepare(`
      SELECT admission_number, student_name FROM enrollment
      WHERE  LOWER(current_class) = LOWER(?) AND section = ? AND student_status = 'ACTIVE'
    `).all(cls, sec);
    const activeMap = new Map(activeStudents.map(s => [s.admission_number, s.student_name]));

    // Every currently-active student must be covered — no silent gaps.
    if (assignments.length !== activeStudents.length) {
      return { success: false, message: `This class/section has ${activeStudents.length} active students, but ${assignments.length} were submitted — every student needs a roll number, not a partial list.` };
    }

    const seenNumbers = new Set();
    const seenStudents = new Set();
    for (const a of assignments) {
      if (!activeMap.has(a.admission_number)) {
        return { success: false, message: `${a.admission_number} is not an active student in ${cls} ${sec}.` };
      }
      if (seenStudents.has(a.admission_number)) {
        return { success: false, message: `${activeMap.get(a.admission_number)} appears more than once in this list.` };
      }
      seenStudents.add(a.admission_number);
      const n = Number(a.roll_number);
      if (!Number.isInteger(n) || n <= 0) {
        return { success: false, message: `"${a.roll_number}" is not a valid roll number for ${activeMap.get(a.admission_number)} — must be a positive whole number.` };
      }
      if (seenNumbers.has(n)) {
        return { success: false, message: `Roll number ${n} is used more than once — every number must be unique.` };
      }
      seenNumbers.add(n);
    }

    const doSave = db.transaction(() => {
      db.prepare('DELETE FROM roll_numbers WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?').run(cls, sec, academic_year);
      const insert = db.prepare(`
        INSERT INTO roll_numbers (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
        VALUES (?, ?, ?, ?, ?, ?, 0)
      `);
      assignments.forEach(a => {
        insert.run(a.admission_number, activeMap.get(a.admission_number), cls, sec, academic_year, Number(a.roll_number));
      });
    });
    doSave();

    return { success: true, count: assignments.length };
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

// Appends a student to the end of an already-frozen class/section's roll
// number list — shared by the manual 'Add Mid-Year' action and the
// automatic triggers below (new admission approval, reactivating a
// student from DROPBOX status). Silently does nothing if the student
// already has a roll number for this year, or if this class/section was
// never frozen in the first place (nothing to append to).
function _addMidYearRollNumber(admissionNumber, cls, section, academicYear, studentName) {
  const existing = db.prepare('SELECT roll_number FROM roll_numbers WHERE admission_number = ? AND academic_year = ?')
    .get(admissionNumber, academicYear);
  if (existing) return null;

  const isFrozen = db.prepare(`
    SELECT COUNT(*) as c FROM roll_numbers WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
  `).get(cls, section || 'A', academicYear).c > 0;
  if (!isFrozen) return null; // nothing to append to yet — normal pre-freeze case

  const max = db.prepare(`
    SELECT MAX(roll_number) as max FROM roll_numbers WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
  `).get(cls, section || 'A', academicYear);
  const nextRoll = (max?.max || 0) + 1;

  db.prepare(`
    INSERT INTO roll_numbers (admission_number, student_name, class, section, academic_year, roll_number, is_mid_year)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(admissionNumber, studentName, cls, section || 'A', academicYear, nextRoll);

  return nextRoll;
}

// Relabels a student's entire attendance history in their CURRENT class
// to a new section — used whenever a section reassignment happens, so a
// student's monthly report follows them to wherever they currently sit,
// rather than being fragmented across their old and new section. Scoped
// strictly to their current class: never touches attendance from a
// different class (e.g. a prior year's class before a promotion), since
// that's a different kind of change entirely, not a section move.
function _relabelAttendanceSection(admissionNumber, cls, newSection) {
  if (!cls || !newSection) return;
  db.prepare(`
    UPDATE attendance_daily SET section = ?
    WHERE admission_number = ? AND LOWER(class) = LOWER(?)
  `).run(newSection, admissionNumber, cls);
}

// ── Add mid-year student (appends to end of list) ─────────────
ipcMain.handle('rollNumbers:addMidYear', (_evt, { admission_number, class: cls, section, academic_year }) => {
  try {
    const existing = db.prepare(`
      SELECT roll_number FROM roll_numbers
      WHERE admission_number = ? AND academic_year = ?
    `).get(admission_number, academic_year);
    if (existing)
      return { success: false, message: 'Student already has a roll number for this year.' };

    const student = db.prepare(
      'SELECT student_name FROM enrollment WHERE admission_number = ?'
    ).get(admission_number);
    if (!student) return { success: false, message: 'Student not found.' };

    const rollNumber = _addMidYearRollNumber(admission_number, cls, section, academic_year, student.student_name);
    if (rollNumber === null) return { success: false, message: `Roll numbers for ${cls} ${section || 'A'} haven't been assigned yet — nothing to append to.` };

    return { success: true, roll_number: rollNumber };
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

// ── Final exam pass/fail, for the Promotion preview ─────────────
// Deliberately mirrors Examination.jsx's calcFinal exactly (same 6 exam
// types summed out of 200 then scaled to 100, same 33%-per-subject pass
// threshold, same grading scale) — this is a server-side copy, not a
// shared import, since Electron's main and renderer processes are
// separate JS contexts. If the formula in Examination.jsx ever changes,
// this needs updating to match.
const PROMOTION_SUBJECTS = {
  Nursery: ['Hindi','English','Mathematics','Drawing'],
  LKG:     ['Hindi','English','Mathematics','Drawing'],
  UKG:     ['Hindi','English','EVS','Mathematics','Computer','Drawing'],
};
['Class 1','Class 2','Class 3','Class 4','Class 5'].forEach(c => {
  PROMOTION_SUBJECTS[c] = ['Hindi','English','Mathematics','Science/EVS','General Knowledge','Computer','Drawing'];
});
['Class 6','Class 7','Class 8'].forEach(c => {
  PROMOTION_SUBJECTS[c] = ['Hindi','English','Mathematics','Science','SST','General Knowledge','Computer','Drawing'];
});
const PROMOTION_FINAL_TYPES = ['UT1','UT2','HALF_YEARLY','UT3','UT4','FINAL'];

function _promotionGrade(pct) {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 55) return 'C';
  if (pct >= 40) return 'D';
  if (pct >= 33) return 'E';
  return 'F';
}

// Returns null (not false) when there's simply no exam data for this
// student/class — a class with no marks entered yet, or a class outside
// Nursery-8 (the exam module doesn't cover Class 9-12 at all currently) —
// so the UI can show "No exam data" rather than a misleading FAIL badge,
// and so promotion doesn't auto-exclude someone just because data is
// missing, only because they actually failed.
function _finalExamResult(admissionNumber, currentClass, marksMap) {
  const subjects = PROMOTION_SUBJECTS[currentClass];
  if (!subjects || subjects.length === 0) return null;

  const sm = marksMap[admissionNumber] || {};
  let total = 0, allPass = true, anyMarksEntered = false;

  subjects.forEach(sub => {
    const s = sm[sub] || {};
    const get = (t) => {
      const e = s[t];
      if (!e) return null;
      anyMarksEntered = true;
      return e.absent ? 0 : (e.marks ?? 0);
    };
    const raw = PROMOTION_FINAL_TYPES.reduce((a, t) => a + (get(t) ?? 0), 0); // out of 200
    const scaled = raw / 2; // out of 100
    if (scaled < 33) allPass = false;
    total += scaled;
  });

  if (!anyMarksEntered) return null;

  const maxTotal = subjects.length * 100;
  const pct = maxTotal ? (total / maxTotal * 100) : 0;
  return { pct: pct.toFixed(1), grade: _promotionGrade(pct), allPass };
}

ipcMain.handle('promotion:preview', (_evt, { from_year, to_year }) => {
  try {
    const students = db.prepare(`
      SELECT admission_number, student_name, current_class, section, academic_year
      FROM enrollment WHERE student_status = 'ACTIVE'
      ORDER BY current_class, student_name
    `).all();

    // Pull every Final-relevant exam mark for the outgoing year once,
    // rather than querying per student — same data source Examination.jsx
    // itself reads from.
    const markRows = db.prepare(`
      SELECT admission_number, subject, exam_type, marks_obtained, is_absent
      FROM   exam_marks
      WHERE  academic_year = ?
      AND    exam_type IN ('UT1','UT2','HALF_YEARLY','UT3','UT4','FINAL')
    `).all(from_year);
    const marksMap = {};
    markRows.forEach(r => {
      if (!marksMap[r.admission_number]) marksMap[r.admission_number] = {};
      if (!marksMap[r.admission_number][r.subject]) marksMap[r.admission_number][r.subject] = {};
      marksMap[r.admission_number][r.subject][r.exam_type] = { marks: r.marks_obtained, absent: !!r.is_absent };
    });

    const studentsWithResult = students.map(s => ({
      ...s,
      exam_result: _finalExamResult(s.admission_number, s.current_class, marksMap),
    }));

    const classMap = {};
    studentsWithResult.forEach(s => {
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
// CLASS SECTIONS — reassign/redistribute students within a class.
// No new table: 'section' is already just a column on enrollment,
// constrained to the same fixed A-D list already used everywhere else
// (Attendance, Examination, Roll Numbers). Both handlers below check
// whether roll numbers are already frozen for the affected section —
// same underlying check rollNumbers:checkFrozen already uses — so the
// UI can warn rather than silently leave a stale roll number behind.
// ══════════════════════════════════════════════════════════════

function _rollNumbersFrozen(cls, section, academicYear) {
  if (!section || !academicYear) return false;
  const count = db.prepare(`
    SELECT COUNT(*) as c FROM roll_numbers
    WHERE LOWER(class) = LOWER(?) AND section = ? AND academic_year = ?
  `).get(cls, section, academicYear).c;
  return count > 0;
}

// Deals students out to sections in rotation (1st->A, 2nd->B, 3rd->A, ...)
// rather than splitting into contiguous alphabetical blocks. The list is
// still sorted alphabetically first, so this keeps the counts just as
// even as a block split would — but every section ends up with a spread
// across the whole alphabet instead of one section owning only early
// names and another only late ones.
function _splitEvenly(list, n) {
  const result = Array.from({ length: n }, () => []);
  list.forEach((item, i) => result[i % n].push(item));
  return result;
}

ipcMain.handle('enrollment:getSectionBreakdown', (_evt, { class: cls, academic_year }) => {
  try {
    if (!cls) return { success: false, message: 'Class is required.' };
    const students = db.prepare(`
      SELECT admission_number, student_name, section
      FROM   enrollment
      WHERE  LOWER(current_class) = LOWER(?) AND student_status = 'ACTIVE'
      ORDER  BY section, student_name
    `).all(cls);

    const bySection = {};
    students.forEach(s => {
      const sec = s.section || '(unassigned)';
      (bySection[sec] = bySection[sec] || []).push(s);
    });

    const frozenBySection = {};
    Object.keys(bySection).forEach(sec => {
      if (sec === '(unassigned)') { frozenBySection[sec] = false; return; }
      frozenBySection[sec] = _rollNumbersFrozen(cls, sec, academic_year);
    });

    return { success: true, total: students.length, bySection, frozenBySection };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('enrollment:updateStudentSection', (_evt, { admission_number, new_section, updated_by }) => {
  try {
    if (!admission_number || !new_section) return { success: false, message: 'Student and section are required.' };
    const student = db.prepare('SELECT student_name, current_class, section FROM enrollment WHERE admission_number = ?').get(admission_number);
    if (!student) return { success: false, message: 'Student not found.' };
    if (student.section === new_section) return { success: true, unchanged: true };

    db.prepare("UPDATE enrollment SET section = ?, updated_at = datetime('now','localtime') WHERE admission_number = ?")
      .run(new_section, admission_number);

    try {
      db.prepare("INSERT INTO edit_history (admission_number, student_name, edited_by, changes) VALUES (?, ?, ?, ?)")
        .run(admission_number, student.student_name, updated_by || 'admin',
          JSON.stringify([{ field: 'Section', old: student.section || '(none)', new: new_section }]));
    } catch (_) {}

    // Carry their attendance history in this class to the new section —
    // their monthly report should follow them, not stay fragmented.
    _relabelAttendanceSection(admission_number, student.current_class, new_section);

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('enrollment:autoBalanceSections', (_evt, { class: cls, sections, academic_year, updated_by }) => {
  try {
    if (!cls) return { success: false, message: 'Class is required.' };
    if (!Array.isArray(sections) || sections.length < 2) {
      return { success: false, message: 'Select at least two sections to balance across.' };
    }
    const students = db.prepare(`
      SELECT admission_number, student_name, section FROM enrollment
      WHERE  LOWER(current_class) = LOWER(?) AND student_status = 'ACTIVE'
      ORDER  BY student_name
    `).all(cls);
    if (students.length === 0) return { success: false, message: 'No active students found in this class.' };

    const chunks = _splitEvenly(students, sections.length);
    const update = db.prepare("UPDATE enrollment SET section = ?, updated_at = datetime('now','localtime') WHERE admission_number = ?");
    const doAll = db.transaction(() => {
      chunks.forEach((chunk, i) => chunk.forEach(s => update.run(sections[i], s.admission_number)));
    });
    doAll();

    // Carry attendance history along for anyone whose section actually
    // changed — some students may land back in the section they started
    // in, so only touch the ones that genuinely moved.
    chunks.forEach((chunk, i) => {
      chunk.forEach(s => {
        if (s.section !== sections[i]) _relabelAttendanceSection(s.admission_number, cls, sections[i]);
      });
    });

    const breakdown = chunks.map((c, i) => ({ section: sections[i], count: c.length }));
    try {
      db.prepare("INSERT INTO edit_history (admission_number, student_name, edited_by, changes) VALUES ('SYSTEM', 'SECTION BALANCE', ?, ?)")
        .run(updated_by || 'admin', JSON.stringify([{
          field: 'Auto-Balance Sections', old: cls,
          new: `${cls} split alphabetically across ${sections.join(', ')} — ${breakdown.map(b => `${b.section}: ${b.count}`).join(', ')}`,
        }]));
    } catch (_) {}

    return { success: true, breakdown };
  } catch (err) { return { success: false, message: err.message }; }
});

// ══════════════════════════════════════════════════════════════
// DAILY ATTENDANCE HANDLERS
// ══════════════════════════════════════════════════════════════



// ── Get students for a class (for marking attendance) ─────────
ipcMain.handle('attendance:getStudents', (_evt, { class: cls, section, academic_year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
    // A student without a matched frozen roll number sorts to the very
    // end (never collides with a real assigned number) — this used to
    // fall back to ROW_NUMBER() OVER (ORDER BY student_name), which
    // computed a purely alphabetical position blind to already-assigned
    // numbers, and could (and did) collide with a real frozen roll number.
    const students = db.prepare(`
      SELECT e.admission_number, e.student_name, e.father_name, e.gender,
             r.roll_number as roll_number
      FROM enrollment e
      LEFT JOIN roll_numbers r
        ON r.admission_number = e.admission_number
        AND LOWER(r.class) = LOWER(e.current_class)
        AND r.section = e.section
        AND r.academic_year = ?
      WHERE LOWER(e.current_class) = LOWER(?)
      AND   e.section       = ?
      AND   e.student_status = 'ACTIVE'
      ORDER BY CASE WHEN r.roll_number IS NULL THEN 1 ELSE 0 END, r.roll_number, e.student_name
    `).all(academic_year, cls, section);
    return { success: true, data: students };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ── Get attendance for a class on a specific date ─────────────
ipcMain.handle('attendance:getByDate', (_evt, { class: cls, section, date, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:markDay', (_evt, { class: cls, section, date, academic_year, records, marked_by, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:getMonthly', (_evt, { class: cls, section, month, year, academic_year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:getDailyGrid', (_evt, { class: cls, section, month, year, academic_year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:getLowAttendance', (_evt, { academic_year, threshold = 75, requesting_user_id }) => {
  try {
    if (requesting_user_id) {
      const requester = db.prepare('SELECT role FROM users WHERE user_id = ?').get(requesting_user_id);
      // This report has no class filter — it's whole-school by design, so a
      // teacher can never be safely scoped into it. Block outright rather
      // than risk exposing every other class's students.
      if (requester?.role === 'teacher') {
        return { success: false, message: 'This report is not available to teacher accounts.' };
      }
    }
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
ipcMain.handle('attendance:getMarkedDates', (_evt, { class: cls, section, month, year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:lockDay', (_evt, { class: cls, section, date, locked_by, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:unlockDay', (_evt, { class: cls, section, date, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:getLockedDates', (_evt, { class: cls, section, month, year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('attendance:getProgressive', (_evt, { class: cls, section, academic_year, up_to_month, up_to_year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('exam:getStudents', (_evt, { class: cls, section, academic_year, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('exam:getMarks', (_evt, { class: cls, section, academic_year, exam_type, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
ipcMain.handle('exam:saveMarks', (_evt, { class: cls, section, academic_year, exam_type, marks, entered_by, auto_lock, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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

ipcMain.handle('exam:unlock', (_evt, { class: cls, section, academic_year, exam_type, requesting_user_id }) => {
  try {
    if (_classSectionAccessDenied(requesting_user_id, cls, section)) {
      return { success: false, message: 'You do not have access to this class.' };
    }
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
         academic_year, opening_balance, transport_route_id, created_by, tuition_start_month)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    const create = db.transaction(() => {
      entries.forEach(e => {
        const sl = 'SL-' + String(nextSL).padStart(4, '0');
        ins.run(
          sl, e.admission_number, e.student_name,
          e.current_class, e.section, academic_year,
          e.opening_balance || 0, null, created_by || '', e.tuition_start_month || null
        );
        nextSL++;
      });
    });
    create();
    return { success: true };
  } catch(e) { return { success: false, message: e.message }; }
});

// Correct/change an existing ledger's tuition start month — e.g. a
// negotiated adjustment after the ledger was already created.
ipcMain.handle('feeLedger:updateTuitionStartMonth', (_evt, { ledger_id, tuition_start_month }) => {
  try {
    if (!ledger_id) return { success: false, message: 'Ledger is required.' };
    db.prepare('UPDATE fee_ledger SET tuition_start_month = ? WHERE ledger_id = ?')
      .run(tuition_start_month || null, ledger_id);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});

// Create a ledger entry for a student who has NOT been formally admitted
// through New Admission (documents missing, etc.) but is attending and
// needs to be charged. Stores their details in provisional_students —
// never in enrollment — and assigns them the next SL number using the
// exact same query as createBulk above, so the sequence stays unified no
// matter which tab was used last.
ipcMain.handle('feeLedger:createProvisionalStudent', (_evt, { academic_year, student_name, father_name, current_class, section, village, opening_balance, created_by, tuition_start_month }) => {
  try {
    if (!student_name?.trim() || !father_name?.trim() || !current_class) {
      return { success: false, message: "Student name, father's name and class are required." };
    }

    // Reference number — own PR{year}-{NNNN} sequence, deliberately distinct
    // from BPS admission numbers so the two can never collide or be confused.
    const sessionYear = academic_year.split('-')[0];
    const lastRef = db.prepare(`
      SELECT student_ref FROM provisional_students
      WHERE  student_ref LIKE 'PR' || ? || '-%'
      ORDER  BY CAST(SUBSTR(student_ref, 8) AS INTEGER) DESC LIMIT 1
    `).get(sessionYear);
    const lastCounter = lastRef ? (parseInt(lastRef.student_ref.split('-')[1], 10) || 0) : 0;
    const student_ref = 'PR' + sessionYear + '-' + String(lastCounter + 1).padStart(4, '0');

    const maxRow = db.prepare(
      "SELECT MAX(CAST(SUBSTR(sl_number,4) AS INTEGER)) as mx FROM fee_ledger WHERE academic_year=?"
    ).get(academic_year);
    const nextSL = (maxRow?.mx || 0) + 1;
    const sl_number = 'SL-' + String(nextSL).padStart(4, '0');

    const doAll = db.transaction(() => {
      db.prepare(`
        INSERT INTO provisional_students
          (student_ref, student_name, father_name, current_class, section, village, academic_year, created_by)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(student_ref, student_name.trim(), father_name.trim(), current_class, section || 'A', village || '', academic_year, created_by || '');

      db.prepare(`
        INSERT INTO fee_ledger
          (sl_number, admission_number, student_name, current_class, section,
           academic_year, opening_balance, transport_route_id, created_by, tuition_start_month)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(sl_number, student_ref, student_name.trim(), current_class, section || 'A',
             academic_year, opening_balance || 0, null, created_by || '', tuition_start_month || null);
    });
    doAll();

    return { success: true, student_ref, sl_number };
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
      LEFT JOIN student_directory e ON e.admission_number = l.admission_number
      WHERE  l.academic_year = ? AND l.group_id IS NULL
      ORDER  BY CAST(SUBSTR(l.sl_number,4) AS INTEGER)
    `).all(academic_year);
    return { success: true, data: rows };
  } catch(e) { return { success: false, message: e.message }; }
});

// Create sibling group (GSL) with manual GSL number
ipcMain.handle('feeLedger:createGroup', (_evt, { academic_year, ledger_ids, created_by, gsl_number_manual, concession_overrides }) => {
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

    // Add members — each with their own optional concession override
    // (set individually per child, e.g. a fully negotiated waiver for one
    // sibling while another stays at the school-wide default).
    const addMember = db.prepare(`
      INSERT OR REPLACE INTO fee_group_members (group_id, ledger_id, sl_number, sibling_position, custom_concession_pct)
      VALUES (?,?,?,?,?)
    `);
    const updateLedger = db.prepare('UPDATE fee_ledger SET group_id = ? WHERE ledger_id = ?');

    const doIt = db.transaction(() => {
      members.forEach((m, i) => {
        const override = concession_overrides ? concession_overrides[m.ledger_id] : undefined;
        const pct = (override !== undefined && override !== null && override !== '') ? Number(override) : null;
        addMember.run(group.group_id, m.ledger_id, m.sl_number, i + 1, pct);
        updateLedger.run(group.group_id, m.ledger_id);
      });
    });
    doIt();
    return { success: true, gsl_number: gslNumber };
  } catch(e) { return { success: false, message: e.message }; }
});

// Correct/change one sibling's individual concession override after the
// group already exists — e.g. a waiver negotiated after the fact, or
// correcting one that was set wrong at creation. Set to null/empty to
// go back to the school-wide default for that child.
ipcMain.handle('feeLedger:updateSiblingConcession', (_evt, { ledger_id, custom_concession_pct }) => {
  try {
    if (!ledger_id) return { success: false, message: 'Student is required.' };
    const member = db.prepare('SELECT member_id FROM fee_group_members WHERE ledger_id = ?').get(ledger_id);
    if (!member) return { success: false, message: 'This student is not part of a sibling group.' };
    const pct = (custom_concession_pct === '' || custom_concession_pct === undefined || custom_concession_pct === null)
      ? null : Number(custom_concession_pct);
    db.prepare('UPDATE fee_group_members SET custom_concession_pct = ? WHERE ledger_id = ?').run(pct, ledger_id);
    return { success: true };
  } catch (e) { return { success: false, message: e.message }; }
});

// Get all ledger entries for a year
ipcMain.handle('feeLedger:getAll', (_evt, academic_year) => {
  try {
    const rows = db.prepare(`
      SELECT l.*,
             g.gsl_number,
             t.route_name, t.monthly_amount AS transport_amount,
             e.father_name,
             gm.custom_concession_pct
      FROM   fee_ledger l
      LEFT JOIN fee_groups        g ON g.group_id  = l.group_id
      LEFT JOIN transport_routes  t ON t.route_id  = l.transport_route_id
      LEFT JOIN student_directory        e ON e.admission_number = l.admission_number
      LEFT JOIN fee_group_members gm ON gm.ledger_id = l.ledger_id
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
      LEFT JOIN student_directory       e ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id  = l.transport_route_id
      WHERE  l.ledger_id = ?
    `).get(ledger_id);

    if (!ledger) return { success: false, message: 'Ledger not found' };

    // Posted transactions
    const posted = db.prepare(`
      SELECT *, 'POSTED' as source FROM fee_transactions
      WHERE  ledger_id = ? AND academic_year = ?
    `).all(ledger_id, academic_year);

    // Staged (pending, not yet posted)
    const staged = db.prepare(`
      SELECT *, 'STAGED' as source FROM fee_transactions_stage
      WHERE  ledger_id = ? AND academic_year = ? AND status = 'PENDING'
    `).all(ledger_id, academic_year);

    // Posted and staged rows for the same student can be interleaved in time
    // (some transactions get posted before others, depending on when Day-End
    // Posting last ran) — so they need to be merged into one true
    // chronological order here, not just concatenated as two separate lists.
    const all = [...posted, ...staged].sort((a, b) => {
      const byDate = String(a.collected_at).localeCompare(String(b.collected_at));
      if (byDate !== 0) return byDate;
      return (a.txn_id || a.stage_id || 0) - (b.txn_id || b.stage_id || 0);
    });

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
      JOIN   student_directory   e  ON e.admission_number = l.admission_number
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
      LEFT JOIN student_directory       e ON e.admission_number = l.admission_number
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
          LEFT JOIN student_directory e ON e.admission_number = l.admission_number
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
             l.opening_balance, e.father_name, e.village,
             gm.group_id, g.gsl_number
      FROM   fee_ledger l
      LEFT JOIN student_directory e ON e.admission_number = l.admission_number
      LEFT JOIN fee_group_members gm ON gm.ledger_id = l.ledger_id
      LEFT JOIN fee_groups g ON g.group_id = gm.group_id
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
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE' AND status = 'PENDING'
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
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE' AND status = 'PENDING'
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
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND status = 'PENDING'
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
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND status = 'PENDING'
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
        village:       row.village || '',
        group_id:      row.group_id || null,
        gsl_number:    row.gsl_number || '',
        prev_balance:  Math.round(prevBalance * 100) / 100,
        fee_due:       Math.round(feeDueAmt * 100) / 100,
        fee_paid:      Math.round(feePaidAmt * 100) / 100,
        balance:       Math.round(balance * 100) / 100,
      };
    });

    return { success: true, data, month_label: targetMonth };
  } catch(e) { return { success: false, message: e.message }; }
});

// Exports the Monthly Fee Report to an .xlsx file. Takes the exact rows/
// totals already fetched and shown on screen (same data the print version
// uses) rather than re-querying — the exported file can never disagree
// with what's currently displayed.
// Reorders rows so members of the same fee group (siblings sharing a GSL)
// sit consecutively, even if their individual SL numbers are far apart.
// The first time a group is encountered (in normal SL order), every member
// of that group is emitted together right there; later encounters of
// already-emitted members are skipped. Ungrouped students are untouched.
function _groupSiblingsForExport(rows) {
  const emitted = new Set();
  const byGroup = {};
  rows.forEach(r => { if (r.group_id) { (byGroup[r.group_id] = byGroup[r.group_id] || []).push(r); } });

  const result = [];
  rows.forEach(r => {
    if (emitted.has(r.ledger_id)) return;
    if (r.group_id && byGroup[r.group_id]) {
      byGroup[r.group_id].forEach(member => {
        if (!emitted.has(member.ledger_id)) { result.push(member); emitted.add(member.ledger_id); }
      });
    } else {
      result.push(r);
      emitted.add(r.ledger_id);
    }
  });
  return result;
}

ipcMain.handle('feeLedger:exportMonthlyReportExcel', async (_evt, { rows, totals, monthLabel, cls }) => {
  try {
    const safeMonth = String(monthLabel || 'Report').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const safeClass = cls ? '_' + String(cls).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_') : '';
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Monthly Ledger Report',
      defaultPath: `Monthly_Ledger_Report_${safeMonth}${safeClass}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { success: false, cancelled: true };

    const orderedRows = _groupSiblingsForExport(rows || []);

    const header = ['Sr No', 'Student Ledger No', 'Student Name', 'Class', "Father's Name", 'Village',
                     'Previous Balance', 'Fee Due', 'Fee Paid', 'Balance'];
    const dataRows = orderedRows.map((r, i) => [
      i + 1, r.sl_number, r.student_name, `${r.current_class}${r.section ? '-' + r.section : ''}`,
      r.father_name || '', r.village || '',
      r.prev_balance, r.fee_due, r.fee_paid, r.balance,
    ]);
    const totalRow = ['', '', '', '', '', 'Total',
      totals?.prev_balance || 0, totals?.fee_due || 0, totals?.fee_paid || 0, totals?.balance || 0];

    const aoa = [
      ['BRILLIANT PUBLIC SCHOOL'],
      ['Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131'],
      [`STUDENT LEDGER SUMMARY FOR THE MONTH OF ${monthLabel || ''}${cls ? ' — ' + cls : ''}`],
      [],
      header,
      ...dataRows,
      totalRow,
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 9 } },
    ];
    ws['!cols'] = [
      { wch: 6 }, { wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 20 }, { wch: 16 },
      { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Report');
    XLSX.writeFile(wb, filePath);

    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Exports the Transport List to .xlsx, grouped by route — mirrors the
// print view's grouping, takes the exact (already filtered) student list
// from the screen rather than re-querying.
ipcMain.handle('feeLedger:exportTransportListExcel', async (_evt, { students, monthLabel, academicYear }) => {
  try {
    const safeMonth = String(monthLabel || 'Transport').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Transport List',
      defaultPath: `Transport_List_${safeMonth}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { success: false, cancelled: true };

    const byRoute = {};
    (students || []).forEach(s => {
      const routeName = s.auto_route_name || 'No Route Assigned';
      (byRoute[routeName] = byRoute[routeName] || []).push(s);
    });
    const routeNames = Object.keys(byRoute).sort();

    const header = ['#', 'Student Name', 'Class', 'Village', 'Adm. No.', 'Monthly Fee'];
    const aoa = [
      ['BRILLIANT PUBLIC SCHOOL'],
      ['Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131'],
      [`TRANSPORT LIST — ${monthLabel || ''} ${academicYear || ''}`],
      [],
    ];
    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
    ];

    routeNames.forEach(routeName => {
      const rowBefore = aoa.length;
      aoa.push([`${routeName} — ${byRoute[routeName].length} student${byRoute[routeName].length !== 1 ? 's' : ''}`]);
      merges.push({ s: { r: rowBefore, c: 0 }, e: { r: rowBefore, c: 5 } });
      aoa.push(header);
      byRoute[routeName]
        .slice()
        .sort((a, b) => a.student_name.localeCompare(b.student_name))
        .forEach((s, i) => {
          aoa.push([i + 1, s.student_name, `${s.current_class} ${s.section || ''}`.trim(), s.village || '', s.sl_number || '', s.auto_monthly_amount || '']);
        });
      aoa.push([]);
    });
    aoa.push(['', '', '', '', 'Total on transport:', students.length]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = merges;
    ws['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Transport List');
    XLSX.writeFile(wb, filePath);

    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// Exports the Class Student List to .xlsx — mirrors the same columns as
// the existing PDF export, takes the exact (already filtered) student
// list from the screen rather than re-querying.
ipcMain.handle('enrollment:exportClassListExcel', async (_evt, { students, selectedClass, academicYear }) => {
  try {
    if (!students || students.length === 0) return { success: false, message: 'No students to export.' };

    const safeClass = String(selectedClass || 'Class').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Student List',
      defaultPath: `StudentList_${safeClass}_${academicYear || ''}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (canceled || !filePath) return { success: false, cancelled: true };

    // Every field the student record actually has — since getByClass
    // already does SELECT * FROM enrollment, this is the full row, not a
    // curated subset. Derived dynamically from the data itself so it stays
    // complete even if columns are ever added to the enrollment table.
    const columns = Object.keys(students[0]);
    const humanize = (key) => key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const header = ['#', ...columns.map(humanize)];
    const dataRows = students.map((s, i) => [i + 1, ...columns.map(c => s[c] ?? '')]);

    const aoa = [
      ['BRILLIANT PUBLIC SCHOOL'],
      ['Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131'],
      [`STUDENT LIST — ${selectedClass} (${academicYear || ''}) — Full Enrollment Data`],
      [],
      header,
      ...dataRows,
    ];

    const lastCol = header.length - 1;
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastCol } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastCol } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: lastCol } },
    ];
    // Reasonable default width per column, widened a little for the
    // longer header labels rather than guessing content length.
    ws['!cols'] = header.map(h => ({ wch: Math.max(h.length + 2, 12) }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Student List');
    XLSX.writeFile(wb, filePath);

    return { success: true, filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
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
    //
    // Counter Other Payment receipts share this exact same sequence and
    // format (no distinguishing prefix) — at the counter it's one physical
    // receipt book regardless of whether it's a fee or an "other" charge,
    // so the number must stay continuous across both. Type is what
    // distinguishes them everywhere they're displayed (Daily Collection,
    // reprints), not the receipt number itself.
    const feeRows = db.prepare(
      'SELECT receipt_number FROM fee_transactions_stage WHERE academic_year = ? AND receipt_number LIKE ?'
    ).all(academic_year, yr + '%');
    const otherRows = db.prepare(
      'SELECT receipt_number FROM counter_other_transactions WHERE academic_year = ? AND receipt_number LIKE ?'
    ).all(academic_year, yr + '%');

    let maxSeq = 0;
    [...feeRows, ...otherRows].forEach(r => {
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
      LEFT JOIN student_directory       e  ON e.admission_number = l.admission_number
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

    // Previous Balance — everything owed BEFORE the current month's own
    // still-*unclaimed* dues (those are shown separately in the Current
    // Month columns, via currentMonthItems, to avoid counting twice). The
    // distinction is NOT "is this tagged the current month" — it's "is this
    // an unclaimed current-month due". A current-month debit that's already
    // been claimed by an EARLIER receipt this month (receipt_number
    // stamped) is settled history and must be counted fully here, exactly
    // like any past debit — otherwise its matching credit still reduces the
    // balance while the debit it paid off silently vanishes, making
    // Previous Balance drift lower than the true ledger balance with every
    // payment made earlier in the same month. Credits always count
    // regardless of month, as before.
    //
    // fee_transactions (the permanent/posted table) never contains
    // unclaimed rows at all — a row only lands there via Day-End Posting a
    // real receipt — so no month exclusion applies there; every row counts.
    const postedBal = db.prepare(
      `SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal
       FROM fee_transactions WHERE ledger_id = ? AND academic_year = ?`
    ).get(ledger.ledger_id, academic_year);
    const stagedBal = db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN NOT (fee_month = ? AND (receipt_number IS NULL OR receipt_number = ''))
                                 THEN debit - concession ELSE 0 END),0)
            - COALESCE(SUM(credit),0) as bal
       FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND status = 'PENDING'`
    ).get(currentFeeMonth, ledger.ledger_id, academic_year);

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
        SELECT credit FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ? AND status = 'PENDING'
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
        AND  (receipt_number IS NULL OR receipt_number = '')
    `).all(ledger.ledger_id, academic_year, currentFeeMonth)
      .map(i => ({ ...i, fee_type: i.fee_type || _guessFeeTypeFromDescription(i.description) || '' }));

    // Whether Auto Accrual has generated this month's charges AT ALL —
    // deliberately independent of currentMonthItems above, since a charge
    // that's already been fully claimed by an earlier payment this month
    // (receipt_number stamped) is correctly excluded from currentMonthItems
    // but the month clearly HAS been generated, so the "Generate Now"
    // banner must not reappear for it.
    const monthGeneratedCheck = db.prepare(`
      SELECT 1 FROM fee_transactions_stage
      WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
        AND  fee_month = ? AND status != 'CANCELLED'
      LIMIT 1
    `).get(ledger.ledger_id, academic_year, currentFeeMonth);

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
      currentMonthGenerated: !!monthGeneratedCheck,
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
      JOIN   student_directory   e  ON e.admission_number = l.admission_number
      LEFT JOIN transport_routes t ON t.route_id = l.transport_route_id
      WHERE  gm.group_id = ?
      ORDER  BY gm.sibling_position
    `).all(group.group_id);

    // For each member get their balance and current month's already-generated dues
    const currentFeeMonth = new Date().toISOString().slice(0, 7);
    const memberDetails = members.map(m => {
      // See identical comment in getLedgerForPayment: only *unclaimed*
      // current-month debits are excluded here (they're shown separately as
      // currentMonthItems); anything already claimed by an earlier receipt
      // this month counts fully, same as any past debit. fee_transactions
      // (permanent/posted) never holds unclaimed rows, so no exclusion there.
      const postedBal = db.prepare(
        `SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal
         FROM fee_transactions WHERE ledger_id=? AND academic_year=?`
      ).get(m.ledger_id, academic_year);
      const stagedBal = db.prepare(
        `SELECT COALESCE(SUM(CASE WHEN NOT (fee_month = ? AND (receipt_number IS NULL OR receipt_number = ''))
                                   THEN debit - concession ELSE 0 END),0)
              - COALESCE(SUM(credit),0) as bal
         FROM fee_transactions_stage WHERE ledger_id=? AND academic_year=? AND status='PENDING'`
      ).get(currentFeeMonth, m.ledger_id, academic_year);
      const prevBalance = (m.opening_balance || 0) + (postedBal?.bal || 0) + (stagedBal?.bal || 0);
      const paidThisMonth = db.prepare(`
        SELECT COALESCE(SUM(credit),0) as paid FROM (
          SELECT credit FROM fee_transactions WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ?
          UNION ALL
          SELECT credit FROM fee_transactions_stage WHERE ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVED' AND fee_month = ? AND status = 'PENDING'
        )
      `).get(m.ledger_id, academic_year, currentFeeMonth, m.ledger_id, academic_year, currentFeeMonth);
      const alreadyPaidThisMonth = paidThisMonth?.paid || 0;
      const currentMonthItems = db.prepare(`
        SELECT stage_id as existing_stage_id, description, debit as amount, concession, concession_reason, fee_type
        FROM   fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
          AND  fee_month = ? AND status != 'CANCELLED'
          AND  (receipt_number IS NULL OR receipt_number = '')
      `).all(m.ledger_id, academic_year, currentFeeMonth)
        .map(i => ({ ...i, fee_type: i.fee_type || _guessFeeTypeFromDescription(i.description) || '' }));
      // Whether this month's charges have been generated AT ALL, independent
      // of currentMonthItems — a fully-claimed month must not re-trigger the
      // "Generate Now" banner. See identical comment in getLedgerForPayment.
      const monthGeneratedCheck = db.prepare(`
        SELECT 1 FROM fee_transactions_stage
        WHERE  ledger_id = ? AND academic_year = ? AND transaction_type = 'RECEIVABLE'
          AND  fee_month = ? AND status != 'CANCELLED'
        LIMIT 1
      `).get(m.ledger_id, academic_year, currentFeeMonth);
      return { ...m, prevBalance, alreadyPaidThisMonth, currentMonthItems, currentMonthGenerated: !!monthGeneratedCheck };
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
    const unpostedDays = _getUnpostedPastDays(center_id, counter_id);
    if (unpostedDays.length > 0) {
      const formatted = unpostedDays.map(d => { const [y,m,dd] = d.split('-'); return `${dd}-${m}-${y}`; }).join(', ');
      return {
        success: false,
        message: `This counter still has unposted receipts from ${formatted}. Ask your Principal to complete Day-End Posting for that date before collecting new payments.`,
      };
    }

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
      SET    concession = ?, concession_reason = ?, receipt_number = ?, group_id = ?,
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
            item.concession || 0, item.concession_reason || '', receipt_number, group_id || null,
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
      LEFT JOIN student_directory          e  ON e.admission_number = l.admission_number
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
    LEFT JOIN student_directory         e  ON e.admission_number = l.admission_number
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
      LEFT JOIN student_directory         e  ON e.admission_number = l.admission_number
      LEFT JOIN fee_groups         g  ON g.group_id = s.group_id
      LEFT JOIN collection_centers c  ON c.center_id = s.center_id
      LEFT JOIN fee_counters       ct ON ct.counter_id = s.counter_id
      WHERE  s.receipt_number = ? AND s.academic_year = ?
    `).all(receipt_number, academic_year);
    source = 'STAGED';
  }
  if (rows.length === 0) return null;

  const header = rows[0];
  const isGroup = rows.some(r => r.group_id) || new Set(rows.map(r => r.ledger_id)).size > 1;
  const table = source === 'POSTED' ? 'fee_transactions' : 'fee_transactions_stage';

  const prevBalStmt = db.prepare(`
    SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) - COALESCE(SUM(concession),0) as bal
    FROM (
      SELECT debit, credit, concession FROM fee_transactions
      WHERE ledger_id = ? AND academic_year = ? AND receipt_number != ?
      UNION ALL
      SELECT debit, credit, concession FROM fee_transactions_stage
      WHERE ledger_id = ? AND academic_year = ? AND receipt_number != ? AND status = 'PENDING'
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
// Proactive check for the UI — same underlying logic counter:savePayment
// enforces, so a banner shown before someone starts a payment can never
// disagree with what actually gets blocked when they try to save one.
ipcMain.handle('posting:checkUnposted', (_evt, { center_id, counter_id }) => {
  try {
    const unpostedDays = _getUnpostedPastDays(center_id, counter_id);
    return { success: true, unposted_dates: unpostedDays };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('posting:getStaged', (_evt, { center_id, counter_id, date, academic_year }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    // One row per (receipt, student) — a group receipt with 2 siblings
    // shows as 2 rows, each with their own amount, not collapsed into one.
    // Includes CANCELLED receipts for the day too (visible for audit, never
    // selectable/postable) so a cancellation never makes a transaction
    // record disappear from this list — only POSTED excludes purely because
    // that's already visible in the History tab.
    const receipts = db.prepare(`
      SELECT
        s.receipt_number,
        s.ledger_id,
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
      AND    s.status             IN ('PENDING', 'CANCELLED')
      AND    (? IS NULL OR s.center_id  = ?)
      AND    (? IS NULL OR s.counter_id = ?)
      GROUP  BY s.receipt_number, s.ledger_id
      ORDER  BY s.receipt_number, CAST(SUBSTR(s.sl_number,4) AS INTEGER)
    `).all(d, academic_year, center_id || null, center_id || null, counter_id || null, counter_id || null);

    // Only PENDING rows are postable — summary totals reflect what will
    // actually be posted, not the cancelled rows kept visible above.
    const postable = receipts.filter(r => r.status === 'PENDING');

    const modeSummary = {};
    postable.forEach(r => {
      if (!modeSummary[r.payment_mode]) modeSummary[r.payment_mode] = { count: 0, amount: 0 };
      modeSummary[r.payment_mode].count  += 1;
      modeSummary[r.payment_mode].amount += r.amount_paid || 0;
    });

    const total = postable.reduce((s, r) => s + (r.amount_paid || 0), 0);
    return { success: true, receipts, modeSummary, total, count: postable.length };
  } catch(e) { return { success: false, message: e.message }; }
});

// Post all pending transactions for a day
ipcMain.handle('posting:createAndPost', (_evt, { center_id, counter_id, date, academic_year, posted_by, selected_keys }) => {
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
    let staged = db.prepare(`
      SELECT * FROM fee_transactions_stage
      WHERE  DATE(collected_at) = ?
      AND    academic_year       = ?
      AND    status              = 'PENDING'
      AND    (? IS NULL OR center_id  = ?)
      AND    (? IS NULL OR counter_id = ?)
    `).all(d, academic_year, center_id || null, center_id || null, counter_id || null, counter_id || null);

    // If specific (receipt_number, ledger_id) pairs were selected, only post
    // those students' rows — anything unchecked stays PENDING, untouched.
    if (Array.isArray(selected_keys) && selected_keys.length > 0) {
      const keySet = new Set(selected_keys);
      staged = staged.filter(r => keySet.has(r.receipt_number + '::' + r.ledger_id));
    }

    if (staged.length === 0) return { success: false, message: 'No pending transactions selected for ' + d };

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
         center_id, counter_id, collected_by, collected_at, schedule_id,
         fee_month, paid_by, amount_tendered, fee_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
          r.center_id, r.counter_id, r.collected_by, r.collected_at, scheduleId,
          r.fee_month || '', r.paid_by || '', r.amount_tendered || 0, r.fee_type || ''
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

    // Group by (receipt, student) — a group receipt with 2 siblings shows
    // as 2 entries, each with their own lines, not collapsed into one.
    const receipts = {};
    rows.forEach(r => {
      const key = r.receipt_number + '::' + r.ledger_id;
      if (!receipts[key]) receipts[key] = { ...r, lines: [] };
      receipts[key].lines.push(r);
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
        s.receipt_number, s.ledger_id, s.sl_number, s.payment_mode, s.status,
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

    sql += ' GROUP BY s.receipt_number, s.ledger_id ORDER BY s.payment_mode, s.receipt_number';

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
      LEFT JOIN student_directory e ON e.admission_number = l.admission_number
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
        WHERE  academic_year = ? AND status = 'PENDING'
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
      LEFT JOIN student_directory         e  ON e.admission_number = l.admission_number
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
        LEFT JOIN student_directory         e  ON e.admission_number = l.admission_number
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
        WHERE  academic_year = ? AND status = 'PENDING'
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
// COUNTER OTHER PAYMENT — Tie, Belt, ID Card, damage recovery, scrap
// sale, donations, etc. Charges anyone at the counter, not necessarily
// an enrolled student. Fully standalone from the fee ledger.
// ══════════════════════════════════════════════════════════════

const COUNTER_OTHER_CHARGE_LABELS = {
  TIE_BELT: 'Tie & Belt', ID_CARD: 'ID Card', PROSPECTUS: 'Prospectus',
  DAMAGE: 'School Property Damage', SCRAP: 'Sale of Scrap',
  GENERAL_DONATION: 'General Donations', SPECIFIC_DONATION: 'Specific Donations',
  OTHERS: 'Others',
};

// Receipt numbering — own sequence, prefixed CO so it's never confused with
// a fee receipt or a Prospectus receipt. Same continuous-within-academic-
// year, resets-on-new-year logic as the others.
ipcMain.handle('counterOther:getNextReceipt', (_evt, academic_year) => {
  try {
    const yr = academic_year.split('-')[0];
    const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    // Same shared sequence as counter:getNextReceipt — see comment there.
    const feeRows = db.prepare(
      'SELECT receipt_number FROM fee_transactions_stage WHERE academic_year = ? AND receipt_number LIKE ?'
    ).all(academic_year, yr + '%');
    const otherRows = db.prepare(
      'SELECT receipt_number FROM counter_other_transactions WHERE academic_year = ? AND receipt_number LIKE ?'
    ).all(academic_year, yr + '%');
    let maxSeq = 0;
    [...feeRows, ...otherRows].forEach(r => {
      const parts = String(r.receipt_number).split('-');
      const seq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    });
    const receipt_number = `${yr}${currentMonth}-${String(maxSeq + 1).padStart(4, '0')}`;
    return { success: true, receipt_number };
  } catch(e) { return { success: false, message: e.message }; }
});

ipcMain.handle('counterOther:savePayment', (_evt, { academic_year, receipt_number, paid_by, reference_note,
  entries, payment_mode, amount_paid, amount_tendered, cheque_no, bank_name, txn_number,
  center_id, counter_id, collected_by }) => {
  try {
    if (!paid_by || !paid_by.trim()) return { success: false, message: 'Paid By is required.' };
    const active = (entries || []).filter(e => (e.amount || 0) > 0);
    if (active.length === 0) return { success: false, message: 'Enter an amount for at least one charge type.' };

    const VALID_MODES = ['CASH', 'CHEQUE', 'ONLINE'];
    const mode = VALID_MODES.includes(payment_mode) ? payment_mode : 'CASH';
    let chequeDetails = '';
    if (mode === 'CHEQUE') chequeDetails = JSON.stringify({ cheque_no: cheque_no || '', bank_name: bank_name || '' });
    if (mode === 'ONLINE') chequeDetails = JSON.stringify({ txn_number: txn_number || '' });

    const ins = db.prepare(`
      INSERT INTO counter_other_transactions
        (receipt_number, academic_year, paid_by, reference_note, charge_type, description, amount, amount_paid,
         payment_mode, cheque_details, amount_tendered, center_id, counter_id, collected_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    let total = 0;
    const saveAll = db.transaction(() => {
      active.forEach(e => {
        const label = COUNTER_OTHER_CHARGE_LABELS[e.charge_type] || e.charge_type;
        const desc = e.charge_type === 'OTHERS' ? (e.description || 'Others').trim() : label;
        ins.run(
          receipt_number, academic_year, paid_by.trim(), (reference_note || '').trim(),
          e.charge_type, desc, e.amount, amount_paid || 0,
          mode, chequeDetails, amount_tendered || 0, center_id || 1, counter_id || 1, collected_by || ''
        );
        total += e.amount;
      });
    });
    saveAll();
    return { success: true, total: Math.round(total * 100) / 100 };
  } catch(e) { return { success: false, message: e.message }; }
});

// Print-ready data for the Counter Other Payment receipt — charge types as
// columns, one row for the payee, matching the fee receipt's structure.
ipcMain.handle('counterOther:getReceiptPrintData', (_evt, { receipt_number, academic_year }) => {
  try {
    const rows = db.prepare(
      'SELECT * FROM counter_other_transactions WHERE receipt_number = ? AND academic_year = ? ORDER BY txn_id'
    ).all(receipt_number, academic_year);
    if (rows.length === 0) return { success: false, message: 'Receipt not found: ' + receipt_number };

    const header = rows[0];
    const charges = rows.map(r => ({ charge_type: r.charge_type, description: r.description, amount: r.amount }));
    const totalCharged = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const amountPaid = header.amount_paid || 0;
    const balance = Math.max(0, Math.round((totalCharged - amountPaid) * 100) / 100);

    let chequeInfo = {};
    try { chequeInfo = header.cheque_details ? JSON.parse(header.cheque_details) : {}; } catch { chequeInfo = {}; }

    const amountTendered = header.amount_tendered || amountPaid;
    const returnAmount = Math.max(0, Math.round((amountTendered - amountPaid) * 100) / 100);

    return {
      success: true,
      data: {
        receipt_number, academic_year, date: header.collected_at,
        paid_by: header.paid_by || '', reference_note: header.reference_note || '',
        payment_mode: header.payment_mode,
        cheque_no: chequeInfo.cheque_no || '', bank_name: chequeInfo.bank_name || '', txn_number: chequeInfo.txn_number || '',
        charges,
        total_charged: Math.round(totalCharged * 100) / 100,
        amount_paid: Math.round(amountPaid * 100) / 100,
        balance,
        amount_given_at_counter: Math.round(amountTendered * 100) / 100,
        return_amount: returnAmount,
      },
    };
  } catch(e) { return { success: false, message: e.message }; }
});

// Daily Collection — everything collected at the counter today, fee
// payments and other payments combined into one list, so staff don't need
// to check two different places to see "how much came in today."
ipcMain.handle('counterPayment:getDailyCollection', (_evt, { date, academic_year }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    const feeRows = db.prepare(`
      SELECT s.receipt_number, s.collected_at, s.payment_mode, s.collected_by, s.paid_by,
             s.credit as amount,
             COALESCE(NULLIF(l.student_name,''), sd.student_name) as student_name,
             COALESCE(NULLIF(l.current_class,''), sd.current_class) as current_class,
             l.section, l.sl_number
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      LEFT JOIN student_directory sd ON sd.admission_number = l.admission_number
      WHERE  s.transaction_type = 'RECEIVED' AND s.status != 'CANCELLED'
      AND    DATE(s.collected_at) = ? AND s.academic_year = ?
      ORDER  BY s.collected_at
    `).all(d, academic_year);

    const otherRows = db.prepare(`
      SELECT receipt_number, MAX(amount_paid) as amount, MAX(collected_at) as collected_at,
             MAX(payment_mode) as payment_mode, MAX(collected_by) as collected_by, MAX(paid_by) as paid_by,
             GROUP_CONCAT(DISTINCT description) as charge_desc
      FROM   counter_other_transactions
      WHERE  DATE(collected_at) = ? AND academic_year = ?
      GROUP  BY receipt_number
      ORDER  BY collected_at
    `).all(d, academic_year);

    const fee = feeRows.map(r => ({
      receipt_number: r.receipt_number, type: 'FEE', collected_at: r.collected_at,
      payment_mode: r.payment_mode, collected_by: r.collected_by, paid_by: r.paid_by,
      amount: r.amount || 0,
      description: r.student_name ? `${r.student_name} — ${r.current_class}${r.section ? ' ' + r.section : ''}` : (r.sl_number || '—'),
      sl_number: r.sl_number || '',
    }));

    const other = otherRows.map(r => ({
      receipt_number: r.receipt_number, type: 'OTHER', collected_at: r.collected_at,
      payment_mode: r.payment_mode, collected_by: r.collected_by, paid_by: r.paid_by,
      amount: r.amount || 0, description: r.charge_desc || '—', sl_number: '',
    }));

    const all = [...fee, ...other].sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));

    const totalFee   = fee.reduce((s, r) => s + r.amount, 0);
    const totalOther = other.reduce((s, r) => s + r.amount, 0);

    const modeSummary = {};
    all.forEach(r => {
      if (!modeSummary[r.payment_mode]) modeSummary[r.payment_mode] = { count: 0, amount: 0 };
      modeSummary[r.payment_mode].count  += 1;
      modeSummary[r.payment_mode].amount += r.amount;
    });

    return {
      success: true, date: d, rows: all,
      totalFee: Math.round(totalFee * 100) / 100,
      totalOther: Math.round(totalOther * 100) / 100,
      total: Math.round((totalFee + totalOther) * 100) / 100,
      modeSummary,
    };
  } catch(e) { return { success: false, message: e.message }; }
});

// Daily Collection — everything actually collected at the counter today,
// combining Fee payments and Counter Other payments into one list. Purely
// a read-only summary view; doesn't touch either table.
ipcMain.handle('counter:getDailyCollection', (_evt, { date, academic_year }) => {
  try {
    const d = date || new Date().toISOString().slice(0, 10);

    const feeRows = db.prepare(`
      SELECT s.receipt_number, 'FEE' as type, s.sl_number,
             l.student_name, l.current_class, l.section,
             MAX(s.paid_by) as paid_by,
             SUM(s.credit) as amount, s.payment_mode, s.collected_by, s.collected_at,
             MAX(s.status) as status
      FROM   fee_transactions_stage s
      LEFT JOIN fee_ledger l ON l.ledger_id = s.ledger_id
      WHERE  s.transaction_type = 'RECEIVED'
      AND    DATE(s.collected_at) = ? AND s.academic_year = ?
      GROUP  BY s.receipt_number, s.ledger_id
      HAVING SUM(s.credit) > 0
    `).all(d, academic_year);

    const otherRows = db.prepare(`
      SELECT receipt_number, 'OTHER' as type, '' as sl_number,
             '' as student_name, '' as current_class, '' as section,
             MAX(paid_by) as paid_by,
             MAX(amount_paid) as amount, payment_mode, collected_by, collected_at,
             GROUP_CONCAT(DISTINCT description) as charge_desc
      FROM   counter_other_transactions
      WHERE  DATE(collected_at) = ? AND academic_year = ?
      GROUP  BY receipt_number
      HAVING MAX(amount_paid) > 0
    `).all(d, academic_year);

    const fee = feeRows.map(r => ({
      receipt_number: r.receipt_number, type: r.type, sl_number: r.sl_number || '',
      student_name: r.student_name || '', class_label: r.current_class ? `${r.current_class}${r.section ? ' ' + r.section : ''}` : '',
      paid_by: r.paid_by || '', amount: r.amount || 0, status: r.status,
      description: r.student_name ? `${r.student_name} — ${r.current_class}${r.section ? ' ' + r.section : ''}` : (r.sl_number || '—'),
      payment_mode: r.payment_mode, collected_by: r.collected_by, collected_at: r.collected_at,
    }));

    const other = otherRows.map(r => ({
      receipt_number: r.receipt_number, type: r.type, sl_number: '',
      student_name: '', class_label: '',
      paid_by: r.paid_by || '', amount: r.amount || 0, status: 'PENDING', // Counter Other Payment has no cancellation yet
      description: r.charge_desc || '—',
      payment_mode: r.payment_mode, collected_by: r.collected_by, collected_at: r.collected_at,
    }));

    const rows = [...fee, ...other].sort((a, b) => String(a.collected_at).localeCompare(String(b.collected_at)));

    // Cancelled receipts stay in `rows` for visibility, but never count
    // toward money totals — that cash was never actually collected.
    const feeTotal   = fee.filter(r => r.status !== 'CANCELLED').reduce((s, r) => s + (r.amount || 0), 0);
    const otherTotal = other.reduce((s, r) => s + (r.amount || 0), 0);
    const total       = feeTotal + otherTotal;

    const modeSummary = {};
    rows.filter(r => r.status !== 'CANCELLED').forEach(r => {
      if (!modeSummary[r.payment_mode]) modeSummary[r.payment_mode] = { count: 0, amount: 0 };
      modeSummary[r.payment_mode].count  += 1;
      modeSummary[r.payment_mode].amount += r.amount || 0;
    });

    return { success: true, rows, total, totalFee: feeTotal, totalOther: otherTotal, modeSummary, count: rows.length };
  } catch(e) { return { success: false, message: e.message }; }
});

// ══════════════════════════════════════════════════════════════
// PHASE 9 — TRANSPORT MONTHLY + SIBLING CONCESSION HANDLERS
// ══════════════════════════════════════════════════════════════

// Get transport assignments for a month
ipcMain.handle('transport:getMonthly', (_evt, { academic_year, month }) => {
  try {
    // Carry-forward: if this month has never been touched at all, preview it
    // using last month's assignments instead of starting empty — staff only
    // need to adjust the students who are actually changing, not re-select
    // everyone. The instant this month gets its own real rows (even one),
    // carry-forward stops — it's treated as its own data from then on.
    const PREV_MONTH = { '05':'04','06':'05','07':'06','08':'07','09':'08','10':'09','11':'10','12':'11','01':'12','02':'01','03':'02' };
    const hasAnyForMonth = db.prepare(
      'SELECT COUNT(*) as c FROM student_transport_monthly WHERE academic_year = ? AND month = ?'
    ).get(academic_year, month).c > 0;
    const sourceMonth    = (!hasAnyForMonth && PREV_MONTH[month]) ? PREV_MONTH[month] : month;
    const carriedForward = sourceMonth !== month;

    const rows = db.prepare(`
      SELECT l.ledger_id, l.sl_number, l.admission_number, l.student_name,
             l.current_class, l.section, e.village,
             tm.id as assign_id, tm.route_id, tm.month,
             r.route_name, r.monthly_amount,
             ar.route_id as auto_route_id, ar.route_name as auto_route_name, ar.monthly_amount as auto_monthly_amount
      FROM   fee_ledger l
      LEFT JOIN student_directory e ON e.admission_number = l.admission_number
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
    `).all(sourceMonth, academic_year);
    return { success: true, data: rows, carried_forward: carriedForward, carried_from_month: carriedForward ? sourceMonth : null };
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
      FROM   student_directory e
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
      LEFT JOIN student_directory e ON e.admission_number = l.admission_number
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
