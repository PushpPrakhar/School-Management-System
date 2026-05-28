# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

This project is currently in **pre-development / planning phase**. The README.md contains the full specification. No application code exists yet. When development begins, update this file with the actual build/run/test commands.

## Decided Tech Stack

**Electron.js + React + SQLite** (Option A from the spec):

| Layer             | Technology                                     |
| ----------------- | ---------------------------------------------- |
| Desktop Framework | Electron.js                                    |
| Frontend          | React.js                                       |
| Database          | SQLite (single `.db` file at `data/school.db`) |
| PDF/Print         | Puppeteer or jsPDF                             |
| Styling           | TailwindCSS or Bootstrap                       |

The alternative (Python Flask + SQLite via PyInstaller) was considered but Electron is preferred for a more polished desktop experience.

## Architecture

Three-tier layered architecture — all offline, no internet dependency:

```
UI Layer (React renderer process)
    ↓
Business Logic / Services Layer (src/services/)
    ↓
Database Layer (SQLite via src/database/db.js)
    ↓
File Output Layer (PDF generation, backup files)
```

Electron's **main process** handles OS-level operations (file system, SQLite, printing). The **renderer process** runs React. IPC bridges the two. All data stays local — no cloud sync, no server.

## Database Tables

Five core tables in `data/school.db`:

- **`enrollment`** — SR Register; one record per student; primary key is `admission_number`; `current_class` is set to `TC Issued` when a Transfer Certificate is generated
- **`fees_ledger`** — per-student per-month fee tracking; carries forward `prev_balance` across academic years; `remaining_balance` and `total_monthly_fees` are auto-calculated
- **`attendance`** — monthly records; `days_absent` and `attendance_percent` are auto-calculated from `total_working_days` and `days_present`
- **`exam_results`** — marks per student per subject per exam; `grade` auto-calculated from percentage thresholds (A+/A/B/C/D/F, configurable by Admin)
- **`users`** — passwords stored as hashes (never plaintext); roles: `admin`, `staff`, `teacher`

`academic_year` (e.g. `2025-26`) is a filter column present in fees_ledger, attendance, and exam_results — always scope queries to the active academic year.

## Role-Based Access Control

Three roles with strictly enforced permissions:

| Action                                | admin | staff           | teacher        |
| ------------------------------------- | ----- | --------------- | -------------- |
| New admission / edit / delete student | ✅    | Add only        | ❌             |
| Fees collection & notices             | ✅    | ✅              | ❌             |
| Attend card / TC generation           | ✅    | Admit card only | ❌             |
| Attendance entry                      | ✅    | ✅              | Own class only |
| Exam marks entry                      | ✅    | ✅              | Own class only |
| Edit past attendance                  | ✅    | ❌              | ❌             |
| Backup & Restore / User Management    | ✅    | ❌              | ❌             |

Teachers are scoped to their own class for both attendance and exam marks — enforce this at the service layer, not just the UI.

## Key Business Rules

- **Admit Card fees check:** Before generating an admit card, check `remaining_balance > 0`. If pending, warn staff and require explicit override (log who approved and when).
- **TC generation:** Admin-only. On confirmation, sets `current_class = 'TC Issued'` in enrollment. TC is locked after generation — re-generation requires Admin override.
- **Attendance locking:** Teachers can only edit the current month. Admin can edit any month.
- **Admission Number:** Auto-generated, must be unique. Aadhar (12 digits) and PEN numbers must also be unique if provided.
- **Date format:** Use `DD/MM/YYYY` throughout the UI (Indian standard).
- **Backup file naming:** `school_backup_YYYY-MM-DD_HH-MM.db`

## Modules / Pages

`src/renderer/pages/`: Dashboard, Admission, StudentList, AdmitCard, Examination, FeesNotice, FeesReceipt, Attendance, TC, Settings

`src/services/`: studentService, feesService, attendanceService, examService, documentService (PDF/print)

`src/database/`: schema.sql (table definitions), db.js (connection + query helpers), migrations/

## Suggested Folder Structure

```
school-management-system/
├── src/
│   ├── main/          # Electron main process
│   ├── renderer/      # React UI (components/, pages/, utils/)
│   ├── database/      # schema.sql, db.js, migrations/
│   ├── services/      # Business logic
│   └── assets/        # logo/, templates/, fonts/
├── data/
│   └── school.db      # SQLite file (auto-created, gitignored)
├── backups/           # Backup .db files (gitignored)
└── docs/
```

## Open Design Decisions (from spec)

These are unresolved and must be clarified before implementing the affected modules:

- Admission numbers: auto-generated or manually entered?
- Class range: Nursery–Class 12 or different?
- Number of subjects per class — configurable or fixed?
- Fee structure: flat monthly or per-class tiers?
- Multi-computer support needed? (reception + principal office)
- Pre-existing records to import/migrate?

## Project

School Management System — offline desktop app

## Commands

- `npm run dev` — start Electron app in dev mode
- `npm run build` — production build
- `npm test` — run tests

## Tech Stack

- Electron.js (desktop framework)
- React (UI)
- SQLite via better-sqlite3 (database)
- jsPDF (document generation)
- TailwindCSS (styling)

## Architecture

- /src/renderer — React UI components
- /src/main — Electron main process
- /src/database — SQLite schema + queries
- /src/services — Business logic
- /data/school.db — SQLite database file

## Rules

- All features must work 100% offline
- Date format: DD/MM/YYYY
- Currency: INR (₹)
- Target users are non-technical school staff
