# 🏫 Brilliant Public School — Management System

> **Version:** 1.0.0
> **Status:** Live / In Production
> **Type:** Offline Desktop Application (Windows)
> **School:** Brilliant Public School, Village Sherpur-Nayser, Post-Jawal, District Bulandshahr, UP-203131

---

## 📌 Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [User Roles & Hierarchy](#4-user-roles--hierarchy)
5. [Modules](#5-modules)
   - 5.1 [Admissions](#51-admissions)
   - 5.2 [Student Records](#52-student-records)
   - 5.3 [Attendance](#53-attendance)
   - 5.4 [Examination](#54-examination)
   - 5.5 [Homework](#55-homework)
   - 5.6 [Fees](#56-fees)
   - 5.7 [Documents](#57-documents)
   - 5.8 [Promotion & Class Sections](#58-promotion--class-sections)
   - 5.9 [Staff & Teacher Management](#59-staff--teacher-management)
   - 5.10 [Login, Security & Sessions](#510-login-security--sessions)
   - 5.11 [Backup & Restore](#511-backup--restore)
6. [Database](#6-database)
7. [Offline-First Design](#7-offline-first-design)
8. [Known Limitation: Single-Machine Only](#8-known-limitation-single-machine-only)
9. [Deployment](#9-deployment)
10. [Folder Structure](#10-folder-structure)
11. [Future Scope](#11-future-scope)

---

## 1. Overview

This is a fully offline desktop application built for Brilliant Public School to replace paper-based administration with a single, structured digital system. It covers the full academic and administrative cycle of running the school — from a family's first inquiry, through admission, daily attendance and homework, exams and report cards, fee collection, and year-end promotion to the next class.

It's built to be operated entirely by school staff with no assumed technical background, and to work with **zero internet dependency** at every step — every screen, every calculation, every printed document works the same whether the machine is online or not.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Desktop Framework | **Electron.js** — packages as a Windows `.exe` installer |
| Frontend | **React** + **TailwindCSS** |
| Database | **SQLite** (`better-sqlite3`) — a single local file, no server |
| PDF Generation | **jsPDF** + **jspdf-autotable** |
| Excel Import/Export | **xlsx** (SheetJS) |
| Password Hashing | **bcryptjs** |
| Packaging | **electron-builder** (NSIS installer) |
| CI/CD | **GitHub Actions** — builds and publishes a Windows installer to GitHub Releases whenever a version tag is pushed |

There is no backend server and no cloud service anywhere in this system. The Electron "main process" (`src/main/main.js`) *is* the entire backend — it talks directly to the SQLite file on disk, and the React frontend talks to it over Electron's IPC (inter-process communication) rather than HTTP.

---

## 3. Architecture

```
┌────────────────────────────────────────────┐
│              React Frontend                 │  src/renderer/
│   (pages, components, all screens & forms)   │
└───────────────────┬──────────────────────────┘
                     │  IPC (window.api.*, via preload.js)
┌───────────────────▼──────────────────────────┐
│           Electron Main Process              │  src/main/main.js
│  All business logic, validation, IPC handlers │
└───────────────────┬──────────────────────────┘
                     │  better-sqlite3 (direct, synchronous)
┌───────────────────▼──────────────────────────┐
│                 SQLite Database               │  school.db
│         Single file, holds everything          │
└────────────────────────────────────────────────┘
```

**Where the database actually lives:**
- **In development** — `<project-root>/data/school.db`
- **In the packaged, installed app** — `%APPDATA%\<AppName>\data\school.db` (Electron's standard per-user data directory)

This separation matters: the database lives *outside* the installed program files, so every future app update replaces the program without ever touching your data.

**Schema safety:** every table is created with `CREATE TABLE IF NOT EXISTS`, and every column added since v1.0.0 uses `ALTER TABLE ... ADD COLUMN` wrapped in a safe check (or, where a constraint itself needed to change, a guarded one-time table rebuild). This means updating the app on top of an existing database only ever adds what's missing — it never wipes or resets existing data.

---

## 4. User Roles & Hierarchy

| Role | Who | Access |
|---|---|---|
| **Director** (`super_admin`) | School owner/director | Full authority over everything except Teacher accounts specifically (Teacher Management is Principal/Manager territory) |
| **Principal / Administrator** (`admin`) | Principal | Near-full authority — admissions, students, fees, exams, staff, teachers, reports |
| **Manager** | Deputy manager | Student list, fees, attendance, Teacher Management |
| **Coordinator** | Section coordinator | Student list, roll numbers, attendance, examination, admit cards |
| **Staff** | Office/counter staff | **Per-person permissions** — each Staff account is individually granted exactly the modules their job needs (e.g. one handles admissions, another handles fee collection), rather than one fixed bucket for everyone with that title |
| **Teacher** | Classroom teachers | Scoped to specific classes, and can be further scoped to **specific sections** of a class (e.g. "Class 5 — Section A only") — enforced at the database level in Attendance, Examination, and (at class level) Homework and Student List |

Hierarchy for account creation: **Director creates Director/Principal-tier accounts; Principal creates Staff/Coordinator/Manager accounts.** Teacher accounts are created through a dedicated Teacher Management flow (Principal/Manager). This prevents anyone from being able to grant themselves or others more authority than they should have.

The very first login accounts (`director`, `principal`, `staff`, `teacher`, etc.) are generic seed accounts meant only to get the system started — real, individually-named accounts should replace them as soon as possible, with the generic ones disabled afterward.

---

## 5. Modules

### 5.1 Admissions

- **New Admission** — full SR Register form (student identity, parents, address, category/religion/caste, documents submitted, and more), validated server-side (Aadhar format, DOB sanity, duplicate detection)
- **Prospectus / Pre-Admission Inquiries** — tracks interested families before they formally admit, separate from the enrollment table until a decision is made
- **Approve Admissions** — every new admission goes through a review/approval step before becoming an active student record, with the reviewer able to edit details during review
- **Provisional Students** — a lighter-weight record type for students not yet fully enrolled, kept in a fully separate table (`provisional_students`) but surfaced transparently alongside regular enrollment through a unified `student_directory` view

### 5.2 Student Records

- **Student List** — search and browse by class, with a **Section filter** (respecting a teacher's section-level access exactly), or **"All Classes"** at once for Principal/Director, sorted in proper class sequence (not alphabetical, so "Class 10" doesn't sort before "Class 2")
  - **Export:** PDF (all roles with access), and **full Excel export of every enrollment field** (Principal/Director only) — not a curated subset, the entire record
- **Edit Student** — full record editing, including section reassignment for an individual student
- **Roll Numbers** — assign and "freeze" roll numbers per class/section/academic year

### 5.3 Attendance

- Daily marking per class and section, with bulk "mark all present" plus individual overrides
- Locking — once submitted, a day is locked and requires an explicit unlock to re-edit (Admin only for past days; teachers can only edit the current day)
- Low Attendance report, Monthly attendance report
- Fully section-aware access control — a teacher scoped to specific sections cannot mark or view attendance for sections they aren't assigned to

### 5.4 Examination

- **Unit Test Results** (UT1–UT4), **Half Yearly Result**, and **Final Result** — each with its own official, printable report card matching the school's letterhead format (school header, student info grid, marks table, grade, pass/fail, and a Date/Signature block for Class Teacher and Head Teacher)
- Half Yearly and Final results automatically combine the relevant Unit Tests into the term total, using a consistent per-subject 33%-pass rule and A–F grading scale throughout
- **Printable** — every report card has a dedicated print preview matching the same letterhead style used across the whole system

### 5.5 Homework

- Teachers log **Classwork** and **Homework** separately, per subject, per day, with an optional Chapter reference (chapter is not required — subjects without a written-up chapter list, like Hindi Grammar, can still have classwork/homework logged normally)
- One row per subject already defined for that class — no manual subject picking, since **Homework Management** (Principal/Director) maintains the actual subject and chapter list per class, auto-seeded with the standard curriculum and editable as a proper Table of Contents
- **Subject Teacher assignment** — Principal can assign which teacher actually teaches each subject; the **Review Homework** oversight view credits that subject teacher by name, even if a different teacher (e.g. the class teacher) was the one who physically logged the entry into the system
- **Daily Report** — a non-printable, on-screen summary styled with the school letterhead, showing that day's classwork/homework by subject plus the day's **absent students**, pulled directly from Attendance
- The system shows whether a given date was a working day, holiday, vacation, or Sunday, using the Academic Calendar as the single source of truth

### 5.6 Fees

- **Fee Settings** — the fee structure matrix per class, transport routes
- **Fees Ledger** — per-student ledger with **sibling/group support** (linked via a GSL number so siblings' records can be viewed and reported together), Bulk Receivable Entry for mid-year setup
- **Counter Payment** — single-writer model: counter screens only ever claim pre-generated dues, never compute them live, which is what keeps the whole fee system consistent
- **Day-End Posting** — staged transactions get reviewed and formally posted at day's end. **A counter cannot open a new day's payments if a previous day's receipts were never posted** — this is enforced server-side, not just a UI hint, and clears automatically the moment the missed day is posted (from any date, not just today)
- **Monthly Ledger Report** — printable and **Excel-exportable**, with **siblings grouped together** in the export (not just sorted by ledger number) and every column matching the on-screen/print view exactly
- **Cash Book**, **Fee Reports** (Daily Collection, Defaulter List), **Fees Notice**

### 5.7 Documents

- **Admit Cards**, **TC (Transfer Certificate) Generation** — both print-ready, matching the school's official letterhead

### 5.8 Promotion & Class Sections

- **Promote Students** — a guided, whole-school, year-end promotion wizard (Select Year → Preview & Exclude → Confirm), with a full audit history of every promotion run
  - The preview shows each student's **Final exam pass/fail** (computed from actual exam marks, not guesswork) and automatically pre-excludes students who failed — while never penalizing a student for missing exam data, since that's not the same thing as failing
  - Class 12 students are correctly marked "Passed Out" rather than promoted into a nonexistent class
- **Class Sections** — view section headcounts for a class, individually reassign a student's section, or **Auto-Balance**: split a class evenly across chosen sections, distributed in **alphabetical rotation** (not solid blocks) so every section ends up with a spread across the whole alphabet, not one section owning only early names

### 5.9 Staff & Teacher Management

- **Teacher Management** — assign a teacher to specific classes, and within each class, optionally scope them to **specific sections** (leaving none selected means every section of that class). This is enforced, not cosmetic: a teacher scoped to one section genuinely cannot access another section's attendance or exam marks.
- **Staff Management** — per-person permission assignment (not a fixed role bucket), covering everything from admissions to fee collection to attendance, so two people with the "Staff" title can have entirely different access depending on their actual job
- Auto-generated usernames and passwords, forced password change on first login, reset-and-reveal-once credential handling for both

### 5.10 Login, Security & Sessions

- Lockout after repeated failed login attempts
- Forced password change on first login or after any password reset
- Session persistence across app restarts, with a 10-minute inactivity auto-lock
- PIN-based quick-switch between multiple people who've already logged in with their real password that day
- The last remaining Director/Principal-tier account can never be disabled — a deliberate safeguard against accidentally locking everyone out of administration entirely

### 5.11 Backup & Restore

Since this is an offline, single-file database, regular backups of `school.db` are the only real safety net. Take one before any major update, and on a regular schedule otherwise.

---

## 6. Database

Everything lives in one SQLite file. Some of the more structurally important tables:

| Table | Purpose |
|---|---|
| `enrollment` / `provisional_students` | Student records (unified via the `student_directory` view) |
| `fee_ledger` / `fee_transactions` / `fee_transactions_stage` | Fee ledgers, posted transactions, and staged (pre-posting) transactions |
| `fee_groups` / `fee_group_members` | Sibling grouping for the fee ledger |
| `attendance_daily` | Daily attendance, per student per date |
| `exam_marks` | Marks per student, subject, and exam type (UT1–UT4, Half Yearly, Final) |
| `subjects` / `chapters` | Homework's per-class subject and chapter reference data, including subject-teacher assignment |
| `homework_entries` | Daily classwork/homework log, per teacher/class/date/subject |
| `users` / `teacher_classes` / `staff_permissions` | Accounts, and the class+section / per-permission scoping layered on top of each role |
| `roll_numbers` | Frozen roll number assignments per class/section/year |
| `academic_calendar` | Working days, holidays, vacations — the single source of truth for "is school open on this date" |

---

## 7. Offline-First Design

| Concern | How it's handled |
|---|---|
| Database | SQLite — a single local file, no server, no network dependency |
| App delivery | Packaged as a Windows `.exe` via Electron + electron-builder |
| PDF/Print generation | Fully client-side (jsPDF), no external service |
| Updates | No auto-updater — updates are installed manually from a new installer; nothing changes on a deployed machine until someone deliberately runs a new install |
| Backup | Manual — copy `school.db` to a USB drive or another folder |

---

## 8. Known Limitation: Single-Machine Only

This system is currently built around **one SQLite file on one machine** — there is no server and no data syncing between installs. Running the app on two machines independently means two completely separate, unsynced databases; a payment entered on one will never appear on the other.

If the school needs **true simultaneous multi-machine use** (e.g. reception and the principal's office both actively entering data at the same time), that requires a real architectural change — turning one machine into a small local server that the others connect to over the school's network, rather than each machine reading its own local file. This has been deliberately scoped as a **separate future project**, not something to retrofit quickly, since it touches nearly every feature in the system (150+ backend handlers currently talk directly to the local file).

If usage is closer to "different desks use it at different times of day" rather than truly simultaneous, the existing single-machine setup works fine — just move `school.db` between machines the same way as setting up a new install (see Deployment below), rather than running both at once.

---

## 9. Deployment

**Building a new installer:**
```bash
npm install
npm run build          # react-scripts build && electron-builder
```
Must be built on Windows (or a Windows CI runner) — `better-sqlite3` is a native module compiled per-OS, and a Mac/Linux-built installer will not run correctly on Windows.

**Releasing a new version** (automated via GitHub Actions):
```bash
git add .
git commit -m "..."
git push origin main

git tag v1.0.x
git push origin v1.0.x
```
Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds the installer on a real Windows runner and attaches it to a new GitHub Release automatically — no manual building or uploading required. If a tag already exists and needs to be re-triggered, it must be deleted and recreated (`git tag -d v1.0.0 && git push origin --delete v1.0.0`), since pushing an unchanged tag doesn't fire a new build.

**Moving existing data to a new machine or install:**
1. Back up the current `school.db`
2. Install the app fresh, launch once, close it completely (this creates a new empty database in the correct location)
3. Replace that freshly-created `school.db` with the real one
4. Launch again — any schema changes since that backup was taken are added automatically and safely

---

## 10. Folder Structure

```
School-Management-System/
├── .github/
│   └── workflows/
│       └── release.yml         # Builds + publishes installer on version tags
├── src/
│   ├── main/
│   │   ├── main.js              # All backend logic, schema, IPC handlers
│   │   └── preload.js           # IPC bridge exposed to the frontend as window.api
│   └── renderer/
│       ├── pages/                # One file per major screen
│       ├── components/           # Shared/reusable UI (print modals, receipts, etc.)
│       └── utils/
│           └── AuthContext.jsx  # Auth state, permissions, class/section access checks
├── public/
│   └── electron.js              # Entry-point stub required by electron-builder's CRA preset
├── data/
│   └── school.db                # SQLite database (dev only — see Section 3 for prod path)
├── package.json
└── README.md
```

---

## 11. Future Scope

- **True multi-machine, simultaneous access** — see [Section 8](#8-known-limitation-single-machine-only)
- **Monthly Ledger Report "Posted Only" view** — a toggle to show the ledger as of the last formal Day-End Posting, separate from the real-time operational view, for month-end review/audit purposes
- Code-signing the installer, to remove the Windows SmartScreen "Unknown Publisher" warning on install
- Section-level access enforcement for Homework and Student List (currently class-level only, by deliberate scope decision)

---

*This document reflects the system as actually built and deployed, not the original pre-development plan. Update it as the system continues to evolve.*
