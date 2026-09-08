import React, { useState } from 'react';
import { AuthProvider, useAuth, RequireAuth } from './utils/AuthContext';
import Login           from './pages/Login';
import ForcedPasswordChange from './pages/ForcedPasswordChange';
import LockScreen      from './pages/LockScreen';
import PinSetupModal   from './components/PinSetupModal';
import ExcelImport     from './pages/ExcelImport';
import Admission       from './pages/Admission';
import StudentList     from './pages/StudentList';
import EditStudent     from './pages/EditStudent';
import Dashboard       from './pages/Dashboard';
import ApproveAdmission from './pages/ApproveAdmission';
import RollNumbers     from './pages/RollNumbers';
import PromoteStudents from './pages/PromoteStudents';
import Attendance      from './pages/Attendance';
import AcademicCalendar from './pages/AcademicCalendar';
import Examination     from './pages/Examination';
import FeeSettings     from './pages/FeeSettings';
import FeesLedger      from './pages/FeesLedger';
import FeesNotice      from './pages/FeesNotice';
import CounterPayment  from './pages/CounterPayment';
import DayEndPosting   from './pages/DayEndPosting';
import FeeReports      from './pages/FeeReports';
import CashBook        from './pages/CashBook';
import Prospectus      from './pages/Prospectus';
import TeacherManagement from './pages/TeacherManagement';
import StaffManagement from './pages/StaffManagement';
import Homework from './pages/Homework';
import HomeworkManagement from './pages/HomeworkManagement';
import AdmitCard from './pages/AdmitCard';

// ── Sidebar nav ────────────────────────────────────────────────
// Dashboard is pinned above the sections, on its own, since it's the one
// destination every role lands on and shouldn't be buried in a collapsed
// group. Every other page lives inside exactly one section below, grouped
// by workflow rather than left as one long flat list.
const DASHBOARD_ITEM = { key: 'dashboard', label: 'Dashboard', permission: 'dashboard' };

const NAV_SECTIONS = [
  {
    key: 'admissions',
    label: 'Admissions & Students',
    items: [
      { key: 'admission',        label: 'New Admission',      permission: 'admission'        },
      { key: 'approveAdmission', label: 'Approve Admissions', permission: 'approveAdmission' },
      { key: 'studentList',      label: 'Student List',       permission: 'studentList'      },
      { key: 'editStudent',      label: 'Edit Student',       permission: 'editStudent'      },
      { key: 'rollNumbers',      label: 'Roll Numbers',       permission: 'rollNumbers'      },
      { key: 'promoteStudents',  label: 'Promote Students',   permission: 'promoteStudents'  },
      { key: 'prospectus',       label: 'Prospectus',         permission: 'feesReceipt'      },
    ],
  },
  {
    key: 'academics',
    label: 'Academics',
    items: [
      { key: 'academicCalendar',  label: 'Academic Calendar',   permission: 'academicCalendar'   },
      { key: 'attendance',        label: 'Attendance',          permission: 'attendance'         },
      { key: 'examination',       label: 'Examination',         permission: 'examination'        },
      { key: 'homework',          label: 'Homework',            permission: 'homework'           },
      { key: 'homeworkManagement',label: 'Homework Management', permission: 'homeworkManagement' },
    ],
  },
  {
    key: 'finance',
    label: 'Fees & Finance',
    items: [
      { key: 'feeSettings',   label: 'Fee Settings',    permission: 'feeSettings'  },
      { key: 'feesLedger',    label: 'Fees Ledger',     permission: 'feesLedger'   },
      { key: 'feesReceipt',   label: 'Counter Payment', permission: 'feesReceipt'  },
      { key: 'dayEndPosting', label: 'Day-End Posting', permission: 'feeSettings'  },
      { key: 'feeReports',    label: 'Fee Reports',     permission: 'feesReceipt'  },
      { key: 'cashBook',      label: 'Cash Book',       permission: 'feeSettings'  },
      { key: 'feesNotice',    label: 'Fees Notice',     permission: 'feesNotice'   },
    ],
  },
  {
    key: 'documents',
    label: 'Documents & Records',
    items: [
      { key: 'admitCard',     label: 'Admit Cards',   permission: 'admitCard'    },
      { key: 'tcGeneration',  label: 'TC Generation', permission: 'tcGeneration' },
    ],
  },
  {
    key: 'administration',
    label: 'Administration',
    items: [
      { key: 'teacherManagement', label: 'Teacher Management', permission: 'teacherManagement' },
      { key: 'staffManagement',   label: 'Staff Management',   permission: 'staffManagement'   },
      { key: 'backup',            label: 'Backup & Restore',   permission: 'backup'            },
      { key: 'excelImport',       label: 'Import from Excel',  permission: 'backup'            },
    ],
  },
];

// Placeholder for pages not yet built
function ComingSoon({ page }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-gray-400">
      <div className="text-6xl mb-4">🚧</div>
      <p className="text-lg font-medium text-gray-500">Coming in a future phase</p>
      <p className="text-sm mt-1">{page}</p>
    </div>
  );
}

// Maps each page key to the permission required to view it — mirrors the
// nav sections' permission fields, plus a couple of keys reachable outside
// the sidebar that still need to be gated.
const PAGE_PERMISSIONS = {
  dashboard: 'dashboard', admission: 'admission', studentList: 'studentList',
  editStudent: 'editStudent', approveAdmission: 'approveAdmission',
  promoteStudents: 'promoteStudents', rollNumbers: 'rollNumbers',
  academicCalendar: 'academicCalendar', attendance: 'attendance',
  examination: 'examination', feeSettings: 'feeSettings', feesLedger: 'feesLedger',
  feesReceipt: 'feesReceipt', dayEndPosting: 'feeSettings', feeReports: 'feesReceipt',
  cashBook: 'feeSettings', prospectus: 'feesReceipt', feesNotice: 'feesNotice',
  admitCard: 'admitCard', tcGeneration: 'tcGeneration', backup: 'backup',
  teacherManagement: 'teacherManagement', staffManagement: 'staffManagement',
  homework: 'homework', homeworkManagement: 'homeworkManagement', excelImport: 'backup',
};

// ── App shell ─────────────────────────────────────────────────
function AppShell() {
  const { user, logout, lock, can } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');
  const [showPinSetup, setShowPinSetup] = useState(false);

  // Sections filtered down to only the items the current role can see —
  // a section left with zero visible items is dropped entirely rather than
  // showing up as an empty collapsed header.
  const visibleSections = NAV_SECTIONS
    .map(section => ({ ...section, items: section.items.filter(item => can(item.permission)) }))
    .filter(section => section.items.length > 0);

  // Accordion: at most one section open at a time. Starts fully collapsed
  // since the initial page (Dashboard) doesn't belong to any section.
  const [openSection, setOpenSection] = useState(null);

  const sectionForPage = (pageKey) =>
    visibleSections.find(s => s.items.some(i => i.key === pageKey))?.key ?? null;

  // Single entry point for all navigation (sidebar clicks, Dashboard
  // shortcut cards, etc.) so the section containing the target page always
  // auto-expands, even when the click didn't originate inside the sidebar.
  const navigateTo = (pageKey) => {
    setActivePage(pageKey);
    const section = sectionForPage(pageKey);
    if (section) setOpenSection(section);
  };

  const toggleSection = (key) => setOpenSection(prev => (prev === key ? null : key));

  const renderPage = () => {
    switch (activePage) {
      case 'dashboard':        return <Dashboard onNavigate={navigateTo} />;
      case 'admission':        return <Admission />;
      case 'studentList':      return <StudentList />;
      case 'editStudent':      return <EditStudent />;
      case 'approveAdmission': return <ApproveAdmission />;
      case 'promoteStudents':  return <PromoteStudents />;
      case 'rollNumbers':      return <RollNumbers />;
      case 'academicCalendar': return <AcademicCalendar />;
      case 'attendance':       return <Attendance />;
      case 'examination':      return <Examination />;
      case 'feeSettings':      return <FeeSettings />;
      case 'feesLedger':       return <FeesLedger />;
      case 'feesReceipt':      return <CounterPayment />;
      case 'dayEndPosting':    return <DayEndPosting />;
      case 'feeReports':       return <FeeReports />;
      case 'cashBook':         return <CashBook />;
      case 'prospectus':       return <Prospectus />;
      case 'feesNotice':       return <FeesNotice />;
      case 'admitCard':        return <AdmitCard />;
      case 'tcGeneration':     return <ComingSoon page="TC Generation — Coming Soon" />;
      case 'backup':           return <ComingSoon page="Backup & Restore — Coming Soon" />;
      case 'teacherManagement':return <TeacherManagement />;
      case 'staffManagement':  return <StaffManagement />;
      case 'homework':          return <Homework />;
      case 'homeworkManagement':return <HomeworkManagement />;
      case 'excelImport':      return <ExcelImport />;
      default:                 return <ComingSoon page={activePage} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 bg-blue-800 text-white flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-blue-700">
          <p className="font-bold text-sm leading-tight">School Management</p>
          <p className="text-blue-300 text-xs mt-0.5">System</p>
        </div>

        <nav className="flex-1 overflow-y-auto py-2">
          {/* Dashboard — pinned above the sections, not part of the accordion */}
          <button onClick={() => navigateTo('dashboard')}
            className={`w-full flex items-center px-4 py-2.5 text-sm text-left transition-colors duration-100
              ${activePage === 'dashboard' ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-700'}`}>
            <span>{DASHBOARD_ITEM.label}</span>
          </button>

          <div className="h-px bg-blue-700 my-2 mx-4" />

          {visibleSections.map(section => {
            const isOpen = openSection === section.key;
            return (
              <div key={section.key}>
                <button onClick={() => toggleSection(section.key)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-blue-300 hover:text-white hover:bg-blue-700 transition-colors duration-100">
                  <span>{section.label}</span>
                  <span className={`text-sm transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                </button>
                {isOpen && (
                  <div>
                    {section.items.map(item => (
                      <button key={item.key} onClick={() => navigateTo(item.key)}
                        className={`w-full flex items-center pl-8 pr-4 py-2 text-sm text-left transition-colors duration-100
                          ${activePage === item.key ? 'bg-blue-900 text-white' : 'text-blue-100 hover:bg-blue-700'}`}>
                        <span>{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-blue-700">
          <p className="text-sm font-medium truncate">{user?.full_name}</p>
          <p className="text-blue-300 text-xs capitalize">{user?.role?.replace('_',' ')} · {user?.username}</p>
          <div className="flex gap-3 mt-2 flex-wrap">
            <button onClick={lock} className="text-xs text-blue-300 hover:text-white underline">Lock</button>
            <button onClick={() => setShowPinSetup(true)} className="text-xs text-blue-300 hover:text-white underline">Set PIN</button>
            <button onClick={logout} className="text-xs text-blue-300 hover:text-white underline">Sign out</button>
          </div>
        </div>
      </aside>

      {showPinSetup && <PinSetupModal onClose={() => setShowPinSetup(false)} />}

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 h-full">
          <RequireAuth permission={PAGE_PERMISSIONS[activePage]}>{renderPage()}</RequireAuth>
        </div>
      </main>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-14 h-14 bg-blue-700 rounded-full flex items-center justify-center mx-auto mb-3 animate-pulse">
          <span className="text-white text-lg font-bold">BPS</span>
        </div>
        <p className="text-gray-400 text-sm">Loading…</p>
      </div>
    </div>
  );
}

function AppContent() {
  const { user, initializing, locked } = useAuth();
  if (initializing) return <SplashScreen />;
  if (!user) return <Login />;
  if (user.must_change_password) return <ForcedPasswordChange />;
  return (
    <>
      <AppShell />
      {locked && <LockScreen />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
