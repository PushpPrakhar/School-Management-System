-- ============================================================
--  SCHOOL MANAGEMENT SYSTEM — SQLite Schema v3.0
--  enrollment table strictly follows admission form
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. ENROLLMENT / SR REGISTER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollment (

    -- ── SYSTEM ────────────────────────────────────────────────
    admission_number        TEXT        PRIMARY KEY,
    student_status          TEXT        NOT NULL DEFAULT 'ACTIVE',
    academic_year           TEXT        NOT NULL DEFAULT '2025-26',
    created_at              DATETIME    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at              DATETIME    NOT NULL DEFAULT (datetime('now','localtime')),

    -- ── STEP 1: STUDENT IDENTITY ──────────────────────────────
    student_name            TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    gender                  TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    date_of_birth           TEXT        NOT NULL DEFAULT '00-00-0000',
    indian_nationality      TEXT        NOT NULL DEFAULT 'Yes',
    blood_group             TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    mother_tongue           TEXT        NOT NULL DEFAULT 'Hindi',
    aadhar_number           TEXT        NOT NULL DEFAULT '999999999999',
    aadhar_doc              TEXT        NOT NULL DEFAULT '',
    birth_cert              TEXT        NOT NULL DEFAULT 'No',
    birth_cert_doc          TEXT        NOT NULL DEFAULT '',

    -- ── STEP 1: PARENTS / GUARDIAN ────────────────────────────
    mother_name             TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    mother_profession       TEXT        NOT NULL DEFAULT 'Housewife',
    father_name             TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    father_profession       TEXT        NOT NULL DEFAULT 'Mazdoori',
    guardian_name           TEXT        NOT NULL DEFAULT '',
    contact_email           TEXT        NOT NULL DEFAULT '',
    mobile_number           TEXT        NOT NULL DEFAULT '',
    alternate_mobile        TEXT        NOT NULL DEFAULT '',

    -- ── STEP 1: ADDRESS ───────────────────────────────────────
    house_no                TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    village                 TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    post                    TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    district                TEXT        NOT NULL DEFAULT 'Bulandshahr',
    state_name              TEXT        NOT NULL DEFAULT 'Uttar Pradesh',
    pin_code                TEXT        NOT NULL DEFAULT '203131',

    -- ── STEP 1: SOCIAL DETAILS ────────────────────────────────
    caste                   TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    religion                TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    category                TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    minority_group          TEXT        NOT NULL DEFAULT 'Not Applicable',
    bpl_beneficiary         TEXT        NOT NULL DEFAULT 'No',
    ews_disadvantaged       TEXT        NOT NULL DEFAULT 'No',
    cwsn                    TEXT        NOT NULL DEFAULT 'No',
    impairment_type         TEXT        NOT NULL DEFAULT '',
    disability_certificate  TEXT        NOT NULL DEFAULT 'No',
    disability_cert_doc     TEXT        NOT NULL DEFAULT '',
    disability_percentage   TEXT        NOT NULL DEFAULT '',

    -- ── STEP 2: ADMISSION-CUM-ENROLLMENT NUMBER ───────────────
    pen_number              TEXT        NOT NULL DEFAULT '11111111111',
    apaar_id                TEXT        NOT NULL DEFAULT '',
    rte_section_12c         TEXT        NOT NULL DEFAULT 'No',
    rte_amount_claimed      TEXT        NOT NULL DEFAULT '',

    -- ── STEP 2: ADMISSION DETAILS ─────────────────────────────
    date_of_admission       TEXT        NOT NULL DEFAULT '00-00-0000',
    class_of_admission      TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    current_class           TEXT        NOT NULL DEFAULT 'NOT PROVIDED',
    section                 TEXT        NOT NULL DEFAULT 'A',
    medium_of_instruction   TEXT        NOT NULL DEFAULT 'English',
    studied_elsewhere       TEXT        NOT NULL DEFAULT 'No',
    tc_submitted            TEXT        NOT NULL DEFAULT 'No',
    tc_doc                  TEXT        NOT NULL DEFAULT '',
    prev_year_status        TEXT        NOT NULL DEFAULT '',
    prev_year_class         TEXT        NOT NULL DEFAULT '',
    prev_enrollment_number  TEXT        NOT NULL DEFAULT '',
    prev_academic_year      TEXT        NOT NULL DEFAULT '',
    prev_school_name        TEXT        NOT NULL DEFAULT 'NOT APPLICABLE',

    -- ── STEP 2: SUBJECTS & STREAM (Class 9+) ──────────────────
    language_group          TEXT        NOT NULL DEFAULT '',
    academic_stream         TEXT        NOT NULL DEFAULT '',
    subject_group           TEXT        NOT NULL DEFAULT '',

    -- ── TC ISSUED (set by TC generation module) ───────────────
    tc_issued               INTEGER     NOT NULL DEFAULT 0,
    submitted_by            TEXT        NOT NULL DEFAULT '',
    approved_by             TEXT        NOT NULL DEFAULT '',
    approved_at             TEXT        NOT NULL DEFAULT '',
    rejected_reason         TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_enrollment_class
    ON enrollment (current_class, academic_year);
CREATE INDEX IF NOT EXISTS idx_enrollment_name
    ON enrollment (student_name);
CREATE INDEX IF NOT EXISTS idx_enrollment_aadhar
    ON enrollment (aadhar_number);

-- ------------------------------------------------------------
-- 2. FEES LEDGER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fees_ledger (
    ledger_id               INTEGER     PRIMARY KEY AUTOINCREMENT,
    new_ledger_number       TEXT        NOT NULL DEFAULT '',
    admission_number        TEXT        NOT NULL REFERENCES enrollment(admission_number),
    student_name            TEXT        NOT NULL DEFAULT '',
    father_name             TEXT        NOT NULL DEFAULT '',
    class                   TEXT        NOT NULL DEFAULT '',
    academic_year           TEXT        NOT NULL DEFAULT '2025-26',
    month                   TEXT        NOT NULL DEFAULT '',
    prev_balance            REAL        NOT NULL DEFAULT 0,
    prev_deposit            REAL        NOT NULL DEFAULT 0,
    monthly_tuition_fees    REAL        NOT NULL DEFAULT 0,
    transport_fees          REAL        NOT NULL DEFAULT 0,
    concession              REAL        NOT NULL DEFAULT 0,
    total_due               REAL        NOT NULL DEFAULT 0,
    amount_paid_this_month  REAL        NOT NULL DEFAULT 0,
    payment_date            TEXT        NOT NULL DEFAULT '',
    receipt_number          TEXT        NOT NULL DEFAULT '',
    created_at              DATETIME    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fees_admission
    ON fees_ledger (admission_number, academic_year);

-- ------------------------------------------------------------
-- 3. ATTENDANCE
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
    attendance_id           INTEGER     PRIMARY KEY AUTOINCREMENT,
    admission_number        TEXT        NOT NULL REFERENCES enrollment(admission_number),
    student_name            TEXT        NOT NULL DEFAULT '',
    class                   TEXT        NOT NULL DEFAULT '',
    month                   TEXT        NOT NULL DEFAULT '',
    academic_year           TEXT        NOT NULL DEFAULT '2025-26',
    total_working_days      INTEGER     NOT NULL DEFAULT 0,
    days_present            INTEGER     NOT NULL DEFAULT 0,
    is_locked               INTEGER     NOT NULL DEFAULT 0,
    updated_by              TEXT        NOT NULL DEFAULT '',
    updated_at              DATETIME    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (admission_number, month, academic_year)
);

-- ------------------------------------------------------------
-- 4. EXAM RESULTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_results (
    result_id               INTEGER     PRIMARY KEY AUTOINCREMENT,
    admission_number        TEXT        NOT NULL REFERENCES enrollment(admission_number),
    student_name            TEXT        NOT NULL DEFAULT '',
    class                   TEXT        NOT NULL DEFAULT '',
    exam_name               TEXT        NOT NULL DEFAULT '',
    academic_year           TEXT        NOT NULL DEFAULT '2025-26',
    subject                 TEXT        NOT NULL DEFAULT '',
    max_marks               INTEGER     NOT NULL DEFAULT 100,
    marks_obtained          REAL        NOT NULL DEFAULT 0,
    remarks                 TEXT        NOT NULL DEFAULT '',
    UNIQUE (admission_number, exam_name, academic_year, subject)
);

-- ------------------------------------------------------------
-- 5. TC LOG
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tc_log (
    tc_id                   INTEGER     PRIMARY KEY AUTOINCREMENT,
    admission_number        TEXT        NOT NULL REFERENCES enrollment(admission_number),
    tc_number               TEXT        NOT NULL UNIQUE,
    reason_for_leaving      TEXT        NOT NULL DEFAULT '',
    last_date_attended      TEXT        NOT NULL DEFAULT '',
    conduct                 TEXT        NOT NULL DEFAULT 'Good',
    total_working_days      INTEGER     NOT NULL DEFAULT 0,
    total_present_days      INTEGER     NOT NULL DEFAULT 0,
    fees_cleared            INTEGER     NOT NULL DEFAULT 0,
    remarks                 TEXT        NOT NULL DEFAULT '',
    issued_by               TEXT        NOT NULL DEFAULT '',
    issued_at               DATETIME    NOT NULL DEFAULT (datetime('now','localtime')),
    is_cancelled            INTEGER     NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- 6. USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id                 INTEGER     PRIMARY KEY AUTOINCREMENT,
    username                TEXT        NOT NULL UNIQUE,
    password_hash           TEXT        NOT NULL,
    full_name               TEXT        NOT NULL DEFAULT '',
    role                    TEXT        NOT NULL DEFAULT 'staff',
    assigned_class          TEXT        NOT NULL DEFAULT '',
    is_active               INTEGER     NOT NULL DEFAULT 1,
    created_at              DATETIME    NOT NULL DEFAULT (datetime('now','localtime')),
    last_login              TEXT        NOT NULL DEFAULT ''
);


-- ------------------------------------------------------------
-- 8. ROLL NUMBERS
-- Frozen annual roll numbers per class/section/year
-- Dynamic roll numbers are calculated on the fly via ROW_NUMBER()
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roll_numbers (
    roll_id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    admission_number TEXT     NOT NULL REFERENCES enrollment(admission_number),
    student_name     TEXT     NOT NULL DEFAULT '',
    class            TEXT     NOT NULL DEFAULT '',
    section          TEXT     NOT NULL DEFAULT '',
    academic_year    TEXT     NOT NULL DEFAULT '',
    roll_number      INTEGER  NOT NULL DEFAULT 0,
    is_mid_year      INTEGER  NOT NULL DEFAULT 0,  -- 1 if assigned mid-year
    assigned_at      DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (class, section, academic_year, roll_number),
    UNIQUE (admission_number, class, section, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_roll_class
    ON roll_numbers (class, section, academic_year);


-- ------------------------------------------------------------
-- 9. DAILY ATTENDANCE
-- One row per student per date. Monthly summaries calculated from this.
-- ------------------------------------------------------------
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
);

CREATE INDEX IF NOT EXISTS idx_att_class_date
    ON attendance_daily (class, section, date);
CREATE INDEX IF NOT EXISTS idx_att_student
    ON attendance_daily (admission_number, academic_year);

-- Default admin user (password: admin123)
INSERT OR IGNORE INTO users (username, password_hash, full_name, role)
VALUES (
    'admin',
    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    'School Administrator',
    'admin'
);
