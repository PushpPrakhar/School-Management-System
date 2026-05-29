-- ============================================================
--  SCHOOL MANAGEMENT SYSTEM — SQLite Schema v1.0
--  Run once on first launch to initialise the database.
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- 1. ENROLLMENT / SR REGISTER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollment (
    admission_number      TEXT PRIMARY KEY,
    date_of_admission     DATE    NOT NULL,
    class_of_admission    TEXT    NOT NULL,
    student_name          TEXT    NOT NULL,
    gender                TEXT    NOT NULL CHECK (gender IN ('M','F','Other')),
    date_of_birth         DATE    NOT NULL,
    aadhar_number         TEXT,
    pen_number            TEXT,
    current_class         TEXT    NOT NULL DEFAULT '',
    father_name           TEXT    NOT NULL,
    mother_name           TEXT,
    father_phone          TEXT,
    mother_phone          TEXT,
    blood_group           TEXT,
    photo_path            TEXT,
    prev_sr_number        TEXT,
    prev_school_name      TEXT,
    documents_submitted   TEXT,   -- comma-separated
    religion              TEXT,
    caste                 TEXT,
    category              TEXT    CHECK (category IN ('GEN','SC','ST','OBC',NULL)),
    address               TEXT,
    academic_year         TEXT    NOT NULL,  -- e.g. '2025-26'
    tc_issued             INTEGER NOT NULL DEFAULT 0,  -- 0 = No, 1 = Yes
    created_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_aadhar
    ON enrollment (aadhar_number)
    WHERE aadhar_number IS NOT NULL AND aadhar_number != '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrollment_pen
    ON enrollment (pen_number)
    WHERE pen_number IS NOT NULL AND pen_number != '';

CREATE INDEX IF NOT EXISTS idx_enrollment_class
    ON enrollment (current_class, academic_year);

-- ------------------------------------------------------------
-- 2. FEES LEDGER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fees_ledger (
    ledger_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    new_ledger_number     TEXT    UNIQUE,
    old_ledger_number     TEXT,
    admission_number      TEXT    NOT NULL REFERENCES enrollment(admission_number),
    student_name          TEXT    NOT NULL,
    father_name           TEXT,
    class                 TEXT    NOT NULL,
    address               TEXT,
    academic_year         TEXT    NOT NULL,
    prev_balance          REAL    NOT NULL DEFAULT 0,
    prev_deposit          REAL    NOT NULL DEFAULT 0,
    prev_balance_left     REAL    GENERATED ALWAYS AS (prev_balance - prev_deposit) VIRTUAL,
    monthly_tuition_fees  REAL    NOT NULL DEFAULT 0,
    transport_fees        REAL    NOT NULL DEFAULT 0,
    concession            REAL    NOT NULL DEFAULT 0,
    total_monthly_fees    REAL    GENERATED ALWAYS AS
                              (monthly_tuition_fees + transport_fees - concession) VIRTUAL,
    month                 TEXT    NOT NULL,  -- e.g. 'April 2025'
    amount_paid_this_month REAL   NOT NULL DEFAULT 0,
    total_due             REAL    NOT NULL DEFAULT 0,
    remaining_balance     REAL    GENERATED ALWAYS AS (total_due - amount_paid_this_month) VIRTUAL,
    payment_date          DATE,
    receipt_number        TEXT,
    created_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_fees_admission
    ON fees_ledger (admission_number, academic_year);

CREATE INDEX IF NOT EXISTS idx_fees_pending
    ON fees_ledger (remaining_balance, academic_year);

-- ------------------------------------------------------------
-- 3. ATTENDANCE REGISTER
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
    attendance_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number      TEXT    NOT NULL REFERENCES enrollment(admission_number),
    student_name          TEXT    NOT NULL,
    class                 TEXT    NOT NULL,
    month                 TEXT    NOT NULL,  -- e.g. 'April 2025'
    academic_year         TEXT    NOT NULL,
    total_working_days    INTEGER NOT NULL DEFAULT 0,
    days_present          INTEGER NOT NULL DEFAULT 0,
    days_absent           INTEGER GENERATED ALWAYS AS
                              (total_working_days - days_present) VIRTUAL,
    attendance_percent    REAL    GENERATED ALWAYS AS
                              (CASE WHEN total_working_days = 0 THEN 0
                                    ELSE ROUND(days_present * 100.0 / total_working_days, 2)
                               END) VIRTUAL,
    is_locked             INTEGER NOT NULL DEFAULT 0,  -- 1 = locked by admin
    updated_by            TEXT,
    updated_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (admission_number, month, academic_year)
);

CREATE INDEX IF NOT EXISTS idx_attendance_class_month
    ON attendance (class, month, academic_year);

-- ------------------------------------------------------------
-- 4. EXAMINATION RESULTS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_results (
    result_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number      TEXT    NOT NULL REFERENCES enrollment(admission_number),
    student_name          TEXT    NOT NULL,
    class                 TEXT    NOT NULL,
    exam_name             TEXT    NOT NULL,  -- 'Half Yearly', 'Annual'
    academic_year         TEXT    NOT NULL,
    subject               TEXT    NOT NULL,
    max_marks             INTEGER NOT NULL DEFAULT 100,
    marks_obtained        REAL    NOT NULL DEFAULT 0,
    grade                 TEXT    GENERATED ALWAYS AS (
        CASE
            WHEN marks_obtained * 100.0 / max_marks >= 90 THEN 'A+'
            WHEN marks_obtained * 100.0 / max_marks >= 75 THEN 'A'
            WHEN marks_obtained * 100.0 / max_marks >= 60 THEN 'B'
            WHEN marks_obtained * 100.0 / max_marks >= 45 THEN 'C'
            WHEN marks_obtained * 100.0 / max_marks >= 33 THEN 'D'
            ELSE 'F'
        END
    ) VIRTUAL,
    remarks               TEXT,
    UNIQUE (admission_number, exam_name, academic_year, subject)
);

CREATE INDEX IF NOT EXISTS idx_results_class_exam
    ON exam_results (class, exam_name, academic_year);

-- ------------------------------------------------------------
-- 5. USERS & AUTHORIZATION
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    user_id               INTEGER PRIMARY KEY AUTOINCREMENT,
    username              TEXT    NOT NULL UNIQUE,
    password_hash         TEXT    NOT NULL,
    full_name             TEXT    NOT NULL,
    role                  TEXT    NOT NULL CHECK (role IN ('admin','staff','teacher')),
    assigned_class        TEXT,   -- teachers: only their own class
    is_active             INTEGER NOT NULL DEFAULT 1,
    created_at            DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    last_login            DATETIME
);

-- ------------------------------------------------------------
-- 6. TC LOG (audit trail for TC generation)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tc_log (
    tc_id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    admission_number      TEXT    NOT NULL REFERENCES enrollment(admission_number),
    tc_number             TEXT    NOT NULL UNIQUE,
    reason_for_leaving    TEXT,
    last_date_attended    DATE,
    conduct               TEXT    DEFAULT 'Good',
    total_working_days    INTEGER,
    total_present_days    INTEGER,
    fees_cleared          INTEGER NOT NULL DEFAULT 0,  -- 0=No, 1=Yes
    remarks               TEXT,
    issued_by             TEXT    NOT NULL,
    issued_at             DATETIME NOT NULL DEFAULT (datetime('now','localtime')),
    is_cancelled          INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------
-- SEED DATA — default admin user
-- Password: admin123  (bcrypt hash — change on first login!)
-- bcrypt hash of 'admin123' with 10 rounds
-- ------------------------------------------------------------
INSERT OR IGNORE INTO users (username, password_hash, full_name, role)
VALUES (
    'admin',
    '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    'School Administrator',
    'admin'
);
