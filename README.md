# 🏫 School Management System — Project Documentation

> **Version:** 1.0.0  
> **Status:** Planning / Pre-Development  
> **Type:** Offline Desktop Application  
> **Last Updated:** May 2026

---

## 📌 Table of Contents

1. [Project Overview](#1-project-overview)
2. [Goals & Non-Negotiables](#2-goals--non-negotiables)
3. [Recommended Tech Stack](#3-recommended-tech-stack)
4. [System Architecture](#4-system-architecture)
5. [Database Schema](#5-database-schema)
   - 5.1 [Enrollment & SR Register](#51-enrollment--sr-register)
   - 5.2 [Fees Ledger](#52-fees-ledger)
   - 5.3 [Attendance Register](#53-attendance-register)
   - 5.4 [Examination Results](#54-examination-results)
   - 5.5 [Users & Authorization](#55-users--authorization)
6. [Features & Modules](#6-features--modules)
   - 6.1 [Dashboard](#61-dashboard)
   - 6.2 [Admission Form](#62-admission-form)
   - 6.3 [Class Student List](#63-class-student-list)
   - 6.4 [Admit Card Generator](#64-admit-card-generator)
   - 6.5 [Examination Gadget](#65-examination-gadget)
   - 6.6 [Fees Notice](#66-fees-notice)
   - 6.7 [Fees Receipt](#67-fees-receipt)
   - 6.8 [Student Attendance System](#68-student-attendance-system)
   - 6.9 [TC Generation](#69-tc-generation)
   - 6.10 [Backup & Restore](#610-backup--restore)
7. [Authorization & User Roles](#7-authorization--user-roles)
8. [UI/UX Guidelines](#8-uiux-guidelines)
9. [Offline Strategy](#9-offline-strategy)
10. [Future Scope](#10-future-scope)
11. [Folder Structure (Suggested)](#11-folder-structure-suggested)
12. [Open Questions / To Be Decided](#12-open-questions--to-be-decided)

---

## 1. Project Overview

The **School Management System** is a fully offline desktop application designed to digitize and streamline the day-to-day administrative operations of a school. It replaces traditional paper-based record-keeping with a structured, user-friendly digital system.

The system handles:
- Student enrollment and registration
- Fee collection and ledger management
- Attendance tracking
- Examination admit card and result management
- Transfer Certificate (TC) generation
- Document generation (notices, receipts, reports)

The system is designed to be operated by school staff with varying levels of technical expertise, and prioritizes ease of use, data integrity, and offline reliability.

---

## 2. Goals & Non-Negotiables

| # | Requirement | Priority |
|---|-------------|----------|
| 1 | System must work **completely offline** — no internet dependency | 🔴 Critical |
| 2 | UI must be **intuitive** — usable by a first-time user without training | 🔴 Critical |
| 3 | **Role-based authorization** — Admin vs User vs Teacher access levels | 🔴 Critical |
| 4 | All documents (TC, Receipt, Admit Card) must be **print-ready** | 🔴 Critical |
| 5 | **Data backup and restore** capability (to USB/local folder) | 🟠 High |
| 6 | System should be **modular** for easy future feature additions | 🟠 High |
| 7 | **Academic year management** — promote students at year-end | 🟡 Medium |

---

## 3. Recommended Tech Stack

### Option A — Electron.js + SQLite *(Recommended)*

| Layer | Technology | Reason |
|-------|-----------|--------|
| Desktop Framework | **Electron.js** | Cross-platform (Windows/Mac/Linux), runs fully offline, packages as a `.exe` installer |
| Frontend UI | **React.js** or **HTML/CSS/JS** | Component-based, easy to maintain and extend |
| Database | **SQLite** | Lightweight, file-based, no server needed, easy to backup (single `.db` file) |
| PDF/Print | **Puppeteer** or **jsPDF** | Generate and print documents like TC, receipts, admit cards |
| Styling | **TailwindCSS** or **Bootstrap** | Clean UI with minimal effort |

### Option B — Python Flask + SQLite *(Alternative)*

| Layer | Technology | Reason |
|-------|-----------|--------|
| Backend | **Python (Flask)** | Simple, readable, large community |
| Frontend | **HTML/CSS/JS + Jinja2** | Template-based rendering |
| Database | **SQLite** | Same as above |
| Packaging | **PyInstaller** | Converts Python app to `.exe` |
| PDF/Print | **ReportLab** or **WeasyPrint** | Document generation |

> **Recommendation:** Go with **Option A (Electron + SQLite)** for a more polished desktop experience.  
> Go with **Option B (Flask + SQLite)** if the development team is more comfortable with Python.

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                  SCHOOL MANAGEMENT SYSTEM           │
│                  (Offline Desktop App)              │
└─────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────┐
│     UI Layer        │  ← React / HTML+CSS+JS
│  (All screens,      │
│   forms, reports)   │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Business Logic    │  ← Validation, calculations,
│      Layer          │     document generation rules
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│   Database Layer    │  ← SQLite (.db file)
│  (SQLite via ORM    │     Stored locally on machine
│   or raw SQL)       │
└─────────────────────┘
          │
          ▼
┌─────────────────────┐
│  File Output Layer  │  ← PDF/Print generation,
│                     │     Backup files
└─────────────────────┘
```

---

## 5. Database Schema

### 5.1 Enrollment & SR Register

> Primary table. Every student in the school has exactly one record here.

| Column Name | Data Type | Notes |
|-------------|-----------|-------|
| `admission_number` | TEXT (PK) | Unique, auto-generated or manual |
| `date_of_admission` | DATE | |
| `class_of_admission` | TEXT | Class when student first joined |
| `student_name` | TEXT | Full name |
| `gender` | TEXT | `M` / `F` / `Other` |
| `date_of_birth` | DATE | |
| `aadhar_number` | TEXT | 12-digit, optional (sensitive) |
| `pen_number` | TEXT | Permanent Education Number |
| `current_class` | TEXT | Current class OR `Left` OR `TC Issued` |
| `father_name` | TEXT | |
| `mother_name` | TEXT | |
| `father_phone` | TEXT | *(Suggested addition)* |
| `mother_phone` | TEXT | *(Suggested addition)* |
| `blood_group` | TEXT | *(Suggested addition)* |
| `photo_path` | TEXT | Path to student photo file *(Suggested)* |
| `prev_sr_number` | TEXT | SR number from previous school |
| `prev_school_name` | TEXT | Name of previous school attended |
| `documents_submitted` | TEXT | Comma-separated: `Birth Certificate`, `TC`, `Aadhar`, etc. |
| `religion` | TEXT | |
| `caste` | TEXT | |
| `category` | TEXT | `GEN` / `SC` / `ST` / `OBC` |
| `address` | TEXT | Full residential address |
| `academic_year` | TEXT | e.g., `2025-26` *(Suggested addition)* |
| `created_at` | DATETIME | Auto-timestamp |
| `updated_at` | DATETIME | Auto-timestamp |

---

### 5.2 Fees Ledger

> Tracks fee collection and balance for each student per academic year.

| Column Name | Data Type | Notes |
|-------------|-----------|-------|
| `ledger_id` | INTEGER (PK) | Auto-increment |
| `new_ledger_number` | TEXT | Unique ledger number for this year |
| `old_ledger_number` | TEXT | Previous year ledger (if pending balance carried forward) |
| `admission_number` | TEXT (FK) | Links to SR Register |
| `student_name` | TEXT | |
| `father_name` | TEXT | |
| `class` | TEXT | |
| `address` | TEXT | |
| `academic_year` | TEXT | e.g., `2025-26` |
| `prev_balance` | DECIMAL | Opening balance from previous year |
| `prev_deposit` | DECIMAL | Amount deposited against previous balance |
| `prev_balance_left` | DECIMAL | Remaining previous balance |
| `monthly_tuition_fees` | DECIMAL | Standard monthly tuition |
| `transport_fees` | DECIMAL | Monthly transport (if applicable) |
| `concession` | DECIMAL | Any fee concession |
| `total_monthly_fees` | DECIMAL | `tuition + transport - concession` (auto-calculated) |
| `month` | TEXT | Month this record applies to (e.g., `April 2025`) |
| `amount_paid_this_month` | DECIMAL | Amount paid in this transaction |
| `total_due` | DECIMAL | Cumulative amount due |
| `remaining_balance` | DECIMAL | `total_due - amount_paid` (auto-calculated) |
| `payment_date` | DATE | Date of payment |
| `receipt_number` | TEXT | Receipt number for this payment |
| `created_at` | DATETIME | |

---

### 5.3 Attendance Register

> Monthly attendance records per student per subject/class.

| Column Name | Data Type | Notes |
|-------------|-----------|-------|
| `attendance_id` | INTEGER (PK) | |
| `admission_number` | TEXT (FK) | Links to SR Register |
| `student_name` | TEXT | |
| `class` | TEXT | |
| `month` | TEXT | e.g., `April 2025` |
| `academic_year` | TEXT | |
| `total_working_days` | INTEGER | Days school was open |
| `days_present` | INTEGER | Days student was present |
| `days_absent` | INTEGER | Auto-calculated: `total - present` |
| `attendance_percent` | DECIMAL | Auto-calculated |
| `updated_by` | TEXT | Teacher/staff who entered data |
| `updated_at` | DATETIME | |

---

### 5.4 Examination Results

> Stores examination marks per student per exam per subject.

| Column Name | Data Type | Notes |
|-------------|-----------|-------|
| `result_id` | INTEGER (PK) | |
| `admission_number` | TEXT (FK) | |
| `student_name` | TEXT | |
| `class` | TEXT | |
| `exam_name` | TEXT | e.g., `Half Yearly`, `Annual` |
| `academic_year` | TEXT | |
| `subject` | TEXT | Subject name |
| `max_marks` | INTEGER | |
| `marks_obtained` | DECIMAL | |
| `grade` | TEXT | Auto-calculated from marks |
| `remarks` | TEXT | Optional teacher remarks |

---

### 5.5 Users & Authorization

> Manages login credentials and role-based access.

| Column Name | Data Type | Notes |
|-------------|-----------|-------|
| `user_id` | INTEGER (PK) | |
| `username` | TEXT | Unique login username |
| `password_hash` | TEXT | Hashed password (never plain text) |
| `full_name` | TEXT | Display name |
| `role` | TEXT | `admin` / `staff` / `teacher` |
| `is_active` | BOOLEAN | Enable/disable users |
| `created_at` | DATETIME | |
| `last_login` | DATETIME | |

---

## 6. Features & Modules

---

### 6.1 Dashboard

**Access:** All roles (content filtered by role)

**Description:**  
The home screen that greets users after login. Displays a quick summary of the school's current status.

**Widgets to display:**
- Total enrolled students (current academic year)
- Students with pending fees
- Today's attendance summary (if entered)
- Class-wise student count
- Quick action buttons → New Admission, Collect Fees, Generate TC

---

### 6.2 Admission Form

**Access:** Admin, Staff

**Description:**  
A form to register a new student into the system. On submission, the student is added to the **SR Register** and a new **Fees Ledger** entry is created for them.

**Form Fields:** *(matches SR Register schema)*

**Workflow:**
1. Staff opens Admission Form
2. Fills in all required fields
3. System validates: checks for duplicate Aadhar / PEN number
4. On submit → creates entry in `enrollment` table
5. System auto-generates Admission Number
6. Option to print the filled admission form

**Validations:**
- Aadhar must be 12 digits (if provided)
- Date of Birth must be in the past
- Admission Number must be unique
- Required fields must not be blank

---

### 6.3 Class Student List

**Access:** Admin, Staff, Teacher

**Description:**  
Generates a list of all students in a given class. Can be filtered by academic year.

**Inputs:**
- Class name (dropdown: Nursery, LKG, UKG, Class 1 ... Class 12)
- Academic Year

**Output:**
- Table showing: Admission No., Student Name, Father's Name, Gender, Date of Birth, Address, Contact
- Options to **Print** or **Export to PDF**
- Count of total students at the bottom

---

### 6.4 Admit Card Generator

**Access:** Admin, Staff

**Description:**  
Generates examination admit cards for students. Before generating, checks for pending fees.

**Inputs:**
- Select exam name (e.g., Half Yearly, Annual Exam)
- Select class OR generate for all classes

**Fees Check Logic:**
```
IF student has remaining_balance > 0:
    Show warning: "This student has pending fees of ₹[amount]"
    Ask: "Generate admit card anyway? [Yes / No]"
    Log the override (who approved it and when)
```

**Admit Card Fields:**
- School Name & Logo
- Student Name, Class, Roll Number
- Admission Number
- Father's Name
- Exam Name & Year
- Subject-wise exam schedule (date, time, subject)
- Invigilator signature line

**Output:** Printable PDF admit card (one per student or batch)

---

### 6.5 Examination Gadget

**Access:** Admin, Staff

**Description:**  
A module to manage exam-related data — entering marks, calculating grades, and generating result sheets.

**Sub-features:**
- Define exam (name, subjects, max marks)
- Enter marks for each student per subject
- Auto-calculate: total marks, percentage, grade, pass/fail
- Generate class result sheet (printable)
- Generate individual report card (printable)

**Grade Calculation:** *(configurable by Admin)*
| Percentage | Grade |
|------------|-------|
| 90–100% | A+ |
| 75–89% | A |
| 60–74% | B |
| 45–59% | C |
| 33–44% | D |
| Below 33% | F (Fail) |

---

### 6.6 Fees Notice

**Access:** Admin, Staff

**Description:**  
A mail-merge-style document generator that creates individual fee due notices for students with pending balances. Similar to "Mail Merge" in MS Word but built into the system.

**Workflow:**
1. System fetches all students with `remaining_balance > 0`
2. Generates a personalized notice for each student
3. Notice includes: Student name, Class, Father's name, Amount due, Last payment date, Month-wise breakdown
4. Output: Batch PDF (all notices in one file) OR individual PDFs
5. Option to print all notices at once

**Notice Template Fields:**
```
To,
[Father's Name]
Parent/Guardian of: [Student Name]
Class: [Class]
Address: [Address]

Subject: Reminder for Pending School Fees

Dear Parent,
This is to inform you that the following fees are pending as of [Date]:

  Previous Balance:     ₹ [prev_balance_left]
  Current Month Fees:   ₹ [total_monthly_fees]
  Total Amount Due:     ₹ [total_due]

Kindly clear the above dues at the earliest.

Thank you,
[School Name]
```

---

### 6.7 Fees Receipt

**Access:** Admin, Staff

**Description:**  
A point-of-collection receipt system. When a parent pays fees, the staff generates a receipt.

**Workflow:**
1. Staff searches student by Name or Admission Number
2. System displays: Student details, current pending amount, month-wise breakdown
3. Staff enters: Amount being paid today, payment mode (Cash/Cheque/Online), date
4. System calculates: New remaining balance
5. Generates and prints receipt (in duplicate — one for parent, one for school)

**Receipt Fields:**
- Receipt Number (auto-generated)
- School Name & Logo
- Date of Payment
- Student Name, Class, Admission No.
- Father's Name
- Amount Received (in digits and words)
- Previous Balance, Amount Paid, Balance Remaining
- Payment Mode
- Cashier signature

---

### 6.8 Student Attendance System

**Access:** Admin, Staff, Teacher

**Description:**  
Allows teachers to record monthly attendance for their class.

**Workflow:**
1. Teacher selects: Class, Month, Academic Year
2. System loads student list for that class
3. Teacher enters: Total working days, Days present for each student
4. System auto-calculates: Days absent, Attendance %
5. Teacher submits — data saved to Attendance table
6. Option to generate monthly attendance report per class (printable)

**Rules:**
- Teachers can only edit attendance for the current month (Admin can edit any month)
- Once submitted, attendance is locked unless Admin unlocks it

---

### 6.9 TC Generation

**Access:** Admin only *(TC is an official document)*

**Description:**  
Generates a Transfer Certificate for a student leaving the school.

**Workflow:**
1. Admin searches student by Name or Admission Number
2. System displays full student profile for verification
3. Admin fills in TC-specific fields (reason for leaving, last date attended, conduct)
4. System generates TC document
5. On confirmation → updates student's `current_class` to `TC Issued` in SR Register
6. TC is locked after generation (cannot be regenerated without Admin override)

**TC Fields:**
- Serial Number / TC Number
- Student Name, Date of Birth, Gender
- Father's Name, Mother's Name
- Admission Number, Date of Admission
- Class of Admission, Class at Time of Leaving
- Date of Leaving
- Reason for Leaving
- Total Attendance / Working Days
- Whether school fees are clear: Yes / No
- Conduct & Character
- Remarks
- Principal Signature & School Stamp

---

### 6.10 Backup & Restore

**Access:** Admin only

**Description:**  
Since the system is offline, data backup is critical. This module allows the Admin to back up and restore the entire database.

**Backup Workflow:**
1. Admin clicks "Backup Now"
2. System copies the `.db` file to a chosen location (USB drive or local folder)
3. Backup file is timestamped: `school_backup_2025-11-15_10-30.db`
4. Success confirmation shown

**Restore Workflow:**
1. Admin selects a backup file
2. System shows backup date/time and warns: *"This will replace all current data. Are you sure?"*
3. On confirmation → restores database from backup file

> **Recommended practice:** Set a reminder in the UI to take weekly backups.

---

## 7. Authorization & User Roles

| Feature / Action | 👑 Admin | 🧑‍💼 Staff | 👩‍🏫 Teacher |
|-----------------|---------|--------|---------|
| View Dashboard | ✅ | ✅ | ✅ |
| New Admission | ✅ | ✅ | ❌ |
| Edit Student Record | ✅ | ❌ | ❌ |
| Delete Student Record | ✅ | ❌ | ❌ |
| Class Student List | ✅ | ✅ | ✅ (own class only) |
| Generate Admit Card | ✅ | ✅ | ❌ |
| Enter Exam Marks | ✅ | ✅ | ✅ (own class) |
| Fees Notice | ✅ | ✅ | ❌ |
| Collect Fees / Receipt | ✅ | ✅ | ❌ |
| Attendance Entry | ✅ | ✅ | ✅ (own class) |
| Edit Past Attendance | ✅ | ❌ | ❌ |
| Generate TC | ✅ | ❌ | ❌ |
| Backup & Restore | ✅ | ❌ | ❌ |
| User Management | ✅ | ❌ | ❌ |
| Direct DB Access | ✅ | ❌ | ❌ |

---

## 8. UI/UX Guidelines

1. **Simple Navigation:** Sidebar or top navigation with clearly labeled sections — no jargon
2. **Search Everywhere:** Every list/table must have a search bar (by name or admission number)
3. **Confirmation Dialogs:** All destructive actions (delete, TC issue, restore) must ask for confirmation
4. **Error Messages:** Show human-readable errors — not technical codes
5. **Loading States:** Show a spinner or progress bar for any action that takes time
6. **Print Preview:** Before printing any document, show a preview screen
7. **Color Coding:**
   - 🔴 Red → Pending fees / Overdue
   - 🟢 Green → Paid / Clear
   - 🟡 Yellow → Partial payment
8. **Keyboard Shortcuts:** Support `Enter` to submit forms, `Esc` to cancel
9. **Responsive Layout:** Works well on both small and large monitors
10. **Indian Date Format:** Use `DD/MM/YYYY` throughout the system

---

## 9. Offline Strategy

The system must function with **zero internet connection at all times**.

| Concern | Solution |
|---------|----------|
| Database | SQLite — file-based, no server needed |
| App delivery | Electron (packaged as `.exe`) or PyInstaller |
| PDF Generation | Client-side libraries (jsPDF / WeasyPrint / ReportLab) |
| No cloud sync | All data stays on the local machine |
| Backup | Manual export to USB / local folder |
| Updates | Installer-based update (distributed via USB or file share) |

> **Important:** Document clearly to the school that backups must be taken regularly. Data loss risk is higher on offline-only systems.

---

## 10. Future Scope

> These features are **not in scope** for v1.0 but the system should be built in a way that adding them later is straightforward.

| Feature | Notes |
|---------|-------|
| 📊 Annual Report Generation | Summary of student performance, fees collected, attendance across the year |
| 👨‍🏫 Staff / Teacher Management | Staff attendance, salary records, leave management |
| 📱 SMS / WhatsApp Notifications | Send fees reminders via SMS (would require internet) |
| 🎓 Alumni Tracking | Records of students who have passed out |
| 📦 Multi-Branch Support | Extend to support multiple school branches |
| ☁️ Optional Cloud Sync | Sync local database to cloud for multi-device access (optional, internet-dependent) |
| 🖼️ Student ID Card Generator | Photo ID card generation for students |
| 📅 School Calendar / Events | Manage school events, exam schedules, holidays |
| 📚 Library Management | Book issue/return tracking |
| 🔔 In-app Reminders | Remind staff about upcoming exams, fee deadlines |

---

## 11. Folder Structure (Suggested)

```
school-management-system/
│
├── src/
│   ├── main/                  # Electron main process (or Flask app)
│   ├── renderer/              # UI components (React/HTML)
│   │   ├── components/        # Reusable UI components
│   │   ├── pages/             # Full page screens
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Admission.jsx
│   │   │   ├── StudentList.jsx
│   │   │   ├── AdmitCard.jsx
│   │   │   ├── Examination.jsx
│   │   │   ├── FeesNotice.jsx
│   │   │   ├── FeesReceipt.jsx
│   │   │   ├── Attendance.jsx
│   │   │   ├── TC.jsx
│   │   │   └── Settings.jsx
│   │   └── utils/             # Helper functions
│   │
│   ├── database/
│   │   ├── schema.sql         # DB table definitions
│   │   ├── db.js              # DB connection & query helpers
│   │   └── migrations/        # Future schema changes
│   │
│   ├── services/              # Business logic layer
│   │   ├── studentService.js
│   │   ├── feesService.js
│   │   ├── attendanceService.js
│   │   ├── examService.js
│   │   └── documentService.js # PDF / print generation
│   │
│   └── assets/
│       ├── logo/
│       ├── templates/         # Document templates (TC, Receipt, etc.)
│       └── fonts/
│
├── data/
│   └── school.db              # SQLite database file (auto-created)
│
├── backups/                   # Backup files stored here
│
├── docs/                      # Documentation
│   └── school_system_project.md   # This file
│
├── package.json
├── README.md
└── .gitignore
```

---

## 12. Open Questions / To Be Decided

- [ ] What classes does the school offer? (Nursery to Class 12? Or different range?)
- [ ] Should Admission Numbers be auto-generated or manually entered?
- [ ] What is the grading system used by the school?
- [ ] How many subjects per class? Are they configurable?
- [ ] Should TC generation require a specific approval workflow?
- [ ] Should the system support multiple academic years simultaneously?
- [ ] What is the school's fee structure — flat monthly fee or different per class?
- [ ] Does the school need the app on multiple computers (reception + principal office)?
- [ ] What operating system does the school use? (Windows / Mac / Linux)
- [ ] Are there any pre-existing records that need to be imported/migrated?

---

> 📝 **Note for Developers:**  
> This document is a living specification. As decisions are made, update the relevant sections and keep a changelog at the bottom of this file. Build the system modularly so that any section can be extended independently without breaking others.

---

*Document prepared for: School Management System Project*  
*Template Version: 1.0*
