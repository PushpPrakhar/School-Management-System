// Dashboard.jsx — Role-based dashboard
// Director / Principal / Staff / Teacher each see different views

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';
import MissingFeesBanner from '../components/MissingFeesBanner';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;

const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3',
  'Class 4','Class 5','Class 6','Class 7','Class 8',
  'Class 9','Class 10','Class 11','Class 12'];

const fmtINR = (n) => `₹${(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Master catalogue of every possible dashboard shortcut. Each dashboard
// below only requests the *keys* relevant to that role's job — can() then
// filters even that down to what THIS specific logged-in person is
// actually permitted to open, so nobody sees a button that leads to
// Access Denied (this used to happen for Coordinator/Manager, and for any
// Staff account whose permissions didn't match the old hardcoded set).
const ALL_QUICK_ACTIONS = [
  { key: 'admission',         label: 'New Admission',      icon: '➕', permission: 'admission',         target: 'admission' },
  { key: 'approveAdmission',  label: 'Approve Admissions', icon: '✅', permission: 'approveAdmission',  target: 'approveAdmission' },
  { key: 'studentList',       label: 'Student List',       icon: '📋', permission: 'studentList',       target: 'studentList' },
  { key: 'editStudent',       label: 'Edit Student',       icon: '✏️', permission: 'editStudent',       target: 'editStudent' },
  { key: 'feesReceipt',       label: 'Collect Fees',       icon: '💰', permission: 'feesReceipt',       target: 'feesReceipt' },
  { key: 'feesNotice',        label: 'Fee Notice',         icon: '📬', permission: 'feesNotice',        target: 'feesNotice' },
  { key: 'feesLedger',        label: 'Fees Ledger',        icon: '📒', permission: 'feesLedger',        target: 'feesLedger' },
  { key: 'tcGeneration',      label: 'TC Generation',      icon: '📄', permission: 'tcGeneration',      target: 'tcGeneration' },
  { key: 'excelImport',       label: 'Import Excel',       icon: '📥', permission: 'backup',            target: 'excelImport' },
  { key: 'backup',            label: 'Backup',             icon: '💾', permission: 'backup',            target: 'backup' },
  { key: 'attendance',        label: 'Attendance',         icon: '📅', permission: 'attendance',        target: 'attendance' },
  { key: 'examination',       label: 'Examination',        icon: '📊', permission: 'examination',       target: 'examination' },
  { key: 'admitCard',         label: 'Admit Cards',        icon: '🪪', permission: 'admitCard',         target: 'admitCard' },
  { key: 'rollNumbers',       label: 'Roll Numbers',       icon: '🔢', permission: 'rollNumbers',       target: 'rollNumbers' },
  { key: 'teacherManagement', label: 'Teacher Management', icon: '🧑‍🏫', permission: 'teacherManagement', target: 'teacherManagement' },
  { key: 'staffManagement',   label: 'Staff Management',   icon: '🧑‍💼', permission: 'staffManagement',   target: 'staffManagement' },
];

function QuickActionsGrid({ actionKeys, can, onNavigate }) {
  const visible = ALL_QUICK_ACTIONS.filter(a => actionKeys.includes(a.key) && can(a.permission));
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {visible.map(a => <QuickAction key={a.key} label={a.label} icon={a.icon} onClick={() => onNavigate(a.target)} />)}
    </div>
  );
}

// ── Shared UI helpers ─────────────────────────────────────────
function StatCard({ label, value, sub, color, icon }) {
  const colors = {
    blue:  'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red:   'bg-red-50 border-red-200 text-red-600',
    gray:  'bg-gray-50 border-gray-200 text-gray-500',
  };
  return (
    <div className={`border rounded-xl p-5 ${colors[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium opacity-70 uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold mt-1">{value ?? '—'}</p>
          {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
        </div>
        <span className="text-2xl opacity-60">{icon}</span>
      </div>
    </div>
  );
}

function PlaceholderCard({ label, icon }) {
  return (
    <div className="bg-gray-50 border border-gray-200 border-dashed rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</p>
          <p className="text-3xl font-bold text-gray-200 mt-1">—</p>
          <span className="text-xs bg-gray-200 text-gray-400 px-2 py-0.5 rounded-full mt-2 inline-block">
            Fees module pending
          </span>
        </div>
        <span className="text-2xl opacity-20">{icon}</span>
      </div>
    </div>
  );
}

function SectionCard({ title, children, action, onAction }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {action && (
          <button onClick={onAction}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            {action} →
          </button>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function QuickAction({ label, icon, onClick }) {
  return (
    <button onClick={onClick}
      className="flex flex-col items-center gap-2 bg-white border border-gray-200
                 hover:border-blue-400 hover:bg-blue-50 rounded-xl p-4 transition-colors text-center">
      <span className="text-2xl">{icon}</span>
      <span className="text-xs font-medium text-gray-600">{label}</span>
    </button>
  );
}

function EmptyRow() {
  return <p className="text-sm text-gray-400 text-center py-4">No data available</p>;
}

// ── Class-wise table (shared by Director + Principal) ─────────
function ClassWiseTable({ rows }) {
  if (!rows?.length) return <EmptyRow />;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-gray-400 border-b border-gray-100">
          <th className="text-left py-2 font-medium">Class</th>
          <th className="text-center py-2 font-medium">Boys</th>
          <th className="text-center py-2 font-medium">Girls</th>
          <th className="text-center py-2 font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.current_class} className="border-b border-gray-50 hover:bg-gray-50">
            <td className="py-2 font-medium text-gray-700">{r.current_class}</td>
            <td className="py-2 text-center text-blue-600">{r.boys}</td>
            <td className="py-2 text-center text-pink-500">{r.girls}</td>
            <td className="py-2 text-center font-semibold text-gray-800">{r.total}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-gray-200 bg-gray-50">
          <td className="py-2 font-semibold text-gray-600 text-xs">Total</td>
          <td className="py-2 text-center font-semibold text-blue-600">
            {rows.reduce((s,r) => s + r.boys, 0)}
          </td>
          <td className="py-2 text-center font-semibold text-pink-500">
            {rows.reduce((s,r) => s + r.girls, 0)}
          </td>
          <td className="py-2 text-center font-bold text-gray-800">
            {rows.reduce((s,r) => s + r.total, 0)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── Pending admissions list (shared by Principal + Director) ──
function PendingList({ rows, onNavigate }) {
  if (!rows?.length) return (
    <p className="text-sm text-green-600 text-center py-3">✅ No pending admissions</p>
  );
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.temp_id ?? r.admission_number ?? i}
          className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-4 py-2.5">
          <div>
            <p className="text-sm font-medium text-gray-800">{r.student_name}</p>
            <p className="text-xs text-gray-400">
              {r.class_of_admission} · Submitted by {r.submitted_by || 'staff'} · {r.created_at?.slice(0,10)}
            </p>
          </div>
          <button onClick={() => onNavigate('approveAdmission')}
            className="text-xs bg-blue-700 hover:bg-blue-800 text-white px-3 py-1.5 rounded-lg font-medium">
            Review →
          </button>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// DIRECTOR DASHBOARD
// ══════════════════════════════════════════════════════════════
function DirectorDashboard({ data, can, onNavigate }) {
  const catColors = { GEN:'blue', GENERAL:'blue', OBC:'amber', SC:'green', ST:'red' };
  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Students"  value={data.totalActive} icon="🎓" color="blue"
          sub={`${data.totalBoys}M · ${data.totalGirls}F`} />
        <StatCard label="Fees Collected (Month)" value={fmtINR(data.feesCollectedThisMonth)} icon="💰" color="green" />
        <StatCard label="Fees Pending" value={fmtINR(data.feesPendingTotal)} icon="⚠️"
          color={data.defaultersCount > 0 ? 'amber' : 'green'} sub={`${data.defaultersCount} students with dues`} />
        <StatCard label="Active Staff" value={data.totalUsers} icon="👥" color="gray"
          sub={`${data.teacherCount} Teachers · ${data.staffCount} Staff`} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Class-wise strength */}
        <SectionCard title="Class-wise Student Strength">
          <ClassWiseTable rows={data.classWise} />
        </SectionCard>

        {/* Category breakdown */}
        <SectionCard title="Category Breakdown">
          {data.categoryRows?.length ? (
            <div className="space-y-3 pt-1">
              {data.categoryRows.map(r => {
                const pct = Math.round((r.count / data.totalActive) * 100);
                const color = catColors[r.category] || 'gray';
                const barColors = {
                  blue:'bg-blue-500', amber:'bg-amber-500',
                  green:'bg-green-500', red:'bg-red-500', gray:'bg-gray-400'
                };
                return (
                  <div key={r.category}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">{r.category || 'Not Set'}</span>
                      <span className="text-gray-500">{r.count} <span className="text-gray-300">({pct}%)</span></span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div className={`${barColors[color]} h-2 rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <EmptyRow />}
        </SectionCard>
      </div>

      {/* Pending admissions */}
      <SectionCard title={`Pending Approvals (${data.totalPending})`}
        action={data.totalPending > 0 ? "View all" : null}
        onAction={() => onNavigate('approveAdmission')}>
        <PendingList rows={data.recentPending} onNavigate={onNavigate} />
      </SectionCard>

      {/* Quick links */}
      <SectionCard title="Quick Actions">
        <QuickActionsGrid
          actionKeys={['studentList','approveAdmission','admission','editStudent','excelImport','backup','teacherManagement','staffManagement']}
          can={can} onNavigate={onNavigate} />
      </SectionCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PRINCIPAL DASHBOARD
// ══════════════════════════════════════════════════════════════
function PrincipalDashboard({ data, can, onNavigate }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active Students"    value={data.totalActive}  icon="🎓" color="blue" />
        <StatCard label="Pending Approvals"  value={data.totalPending} icon="⏳"
          color={data.totalPending > 0 ? 'amber' : 'green'} />
        <StatCard label="Low Attendance" value={data.lowAttendanceCount} icon="📉"
          color={data.lowAttendanceCount > 0 ? 'amber' : 'green'} sub="below 75% this year" />
        <StatCard label="TCs Issued"         value={data.tcIssued}     icon="📄" color="gray" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Pending admissions */}
        <SectionCard title={`Pending Approvals (${data.totalPending})`}
          action={data.totalPending > 5 ? `View all ${data.totalPending}` : null}
          onAction={() => onNavigate('approveAdmission')}>
          <PendingList rows={data.recentPending} onNavigate={onNavigate} />
        </SectionCard>

        {/* Class strength (compact) */}
        <SectionCard title="Student Strength by Class">
          <ClassWiseTable rows={data.classWise} />
        </SectionCard>
      </div>

      {/* Fees overview — real numbers */}
      <SectionCard title="Fees Overview" action="View Reports" onAction={() => onNavigate('feeReports')}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Collected This Month" value={fmtINR(data.feesCollectedThisMonth)} icon="💰" color="green" />
          <StatCard label="Total Pending"        value={fmtINR(data.feesPendingTotal)}       icon="⚠️"
            color={data.feesPendingTotal > 0 ? 'amber' : 'green'} />
          <StatCard label="Defaulters"           value={data.defaultersCount}                 icon="👤" color="gray" />
        </div>
      </SectionCard>

      {/* Quick actions */}
      <SectionCard title="Quick Actions">
        <QuickActionsGrid
          actionKeys={['approveAdmission','admission','studentList','editStudent','tcGeneration','teacherManagement','staffManagement']}
          can={can} onNavigate={onNavigate} />
      </SectionCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STAFF / OFFICE EXECUTIVE DASHBOARD
// ══════════════════════════════════════════════════════════════
function TeamDashboard({ data, user, can, onNavigate }) {
  const showAdmissions = can('admission');
  const showFees       = can('feesReceipt');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Students" value={data.totalActive} icon="🎓" color="blue" />
        {showFees ? (
          <>
            <StatCard label="Fees Collected Today" value={fmtINR(data.feesCollectedToday)} icon="💰" color="green" />
            <StatCard label="Fees Pending" value={fmtINR(data.feesPendingTotal)} icon="⚠️"
              color={data.feesPendingTotal > 0 ? 'amber' : 'green'} />
          </>
        ) : (
          <StatCard label="Low Attendance" value={data.lowAttendanceCount} icon="📉"
            color={data.lowAttendanceCount > 0 ? 'amber' : 'green'} sub="below 75% this year" />
        )}
        {showAdmissions ? (
          <StatCard label="My Pending Submissions"
            value={data.myPending?.filter(r => r.student_status === 'PENDING')?.length || 0}
            icon="⏳" color={data.myPending?.some(r => r.student_status === 'PENDING') ? 'amber' : 'green'} />
        ) : (
          <StatCard label="Active Students" value={data.totalActive} icon="🎓" color="blue" sub={`${data.totalBoys}M · ${data.totalGirls}F`} />
        )}
      </div>

      {/* My submissions — only for those who actually handle admissions */}
      {showAdmissions && (
        <SectionCard title="My Recent Admissions">
          {data.myPending?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left py-2 font-medium">Student</th>
                  <th className="text-left py-2 font-medium">Class</th>
                  <th className="text-left py-2 font-medium">Status</th>
                  <th className="text-left py-2 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.myPending.map(r => (
                  <tr key={r.admission_number} className="border-b border-gray-50">
                    <td className="py-2 font-medium text-gray-800">{r.student_name}</td>
                    <td className="py-2 text-gray-500">{r.class_of_admission}</td>
                    <td className="py-2">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                        ${r.student_status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                          r.student_status === 'ACTIVE'  ? 'bg-green-100 text-green-700' :
                                                           'bg-red-100 text-red-600'}`}>
                        {r.student_status === 'ACTIVE' ? 'Approved' : r.student_status}
                      </span>
                    </td>
                    <td className="py-2 text-gray-400 text-xs">{r.created_at?.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">No admissions submitted yet.</p>
          )}
        </SectionCard>
      )}

      {/* Fee collection — only for those who actually collect fees */}
      {showFees && (
        <SectionCard title="Fee Collection">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Last 5 Receipts</p>
              {data.recentReceipts?.length ? (
                <div className="space-y-2">
                  {data.recentReceipts.map(r => (
                    <div key={r.receipt_number} className="flex justify-between text-sm border-b border-gray-50 pb-1.5">
                      <span className="text-gray-700">{r.student_name || r.receipt_number}</span>
                      <span className="font-medium text-green-700">{fmtINR(r.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400 text-center py-4">No receipts yet today.</p>}
            </div>
            <div className="flex items-center justify-center bg-green-50 border border-green-100 rounded-xl p-4">
              <div className="text-center">
                <p className="text-xs text-green-600 font-medium uppercase tracking-wide">Today's Collection</p>
                <p className="text-3xl font-bold text-green-700 mt-1">{fmtINR(data.feesCollectedToday)}</p>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Quick Actions">
        <QuickActionsGrid
          actionKeys={['admission','studentList','feesReceipt','feesNotice','attendance','examination','admitCard','rollNumbers','teacherManagement']}
          can={can} onNavigate={onNavigate} />
      </SectionCard>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TEACHER DASHBOARD
// ══════════════════════════════════════════════════════════════
function TeacherDashboard({ onNavigate }) {
  const { user } = useAuth();
  const myClasses = user?.classes || [];

  // Remember last-viewed class across sessions (per-teacher, local only)
  const storageKey = `bps_teacher_last_class_${user?.user_id || ''}`;
  const [selectedClass, setSelectedClass] = useState(() => {
    if (myClasses.length === 1) return myClasses[0];
    try {
      const saved = localStorage.getItem(storageKey);
      return (saved && myClasses.includes(saved)) ? saved : '';
    } catch { return ''; }
  });
  const [classData, setClassData] = useState(null);
  const [loading,   setLoading]   = useState(false);

  const loadClass = useCallback(async (cls) => {
    if (!cls) return;
    setLoading(true);
    const res = await window.api.dashboardStats({ role: 'teacher', cls, requesting_user_id: user?.user_id });
    setLoading(false);
    if (res.success) setClassData(res.data);
  }, [user?.user_id]);

  useEffect(() => { if (selectedClass) loadClass(selectedClass); }, [selectedClass, loadClass]);

  const handleClassChange = (cls) => {
    setSelectedClass(cls);
    try { localStorage.setItem(storageKey, cls); } catch {}
  };

  if (myClasses.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-5xl mb-4">🏫</div>
        <p className="font-medium text-gray-600">No class has been assigned to you yet.</p>
        <p className="text-sm mt-1">Ask your Principal or Manager to assign a class in Teacher Management.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Class switcher — only shown when the teacher actually has a choice */}
      {myClasses.length > 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <label className="block text-xs font-medium text-gray-500 mb-2">Your Classes</label>
          <div className="flex flex-wrap gap-2">
            {myClasses.map(c => (
              <button key={c} onClick={() => handleClassChange(c)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors
                  ${selectedClass === c ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {c}
              </button>
            ))}
            {loading && <span className="text-sm text-gray-400 animate-pulse self-center">Loading…</span>}
          </div>
        </div>
      )}

      {selectedClass && classData && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard label={`Students in ${selectedClass}`}
              value={classData.teacherClassStats?.total || 0}
              icon="👦" color="blue"
              sub={`${classData.teacherClassStats?.boys || 0} Boys · ${classData.teacherClassStats?.girls || 0} Girls`} />
            <PlaceholderCard label="Low Attendance in Class" icon="📉" />
            <PlaceholderCard label="Last Exam Avg Score"     icon="📝" />
          </div>

          {/* Quick actions */}
          <SectionCard title="Quick Actions">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <QuickAction label="My Class List"   icon="📋" onClick={() => onNavigate('studentList')} />
              <QuickAction label="Mark Attendance" icon="📅" onClick={() => onNavigate('attendance')} />
              <QuickAction label="Enter Marks"     icon="📝" onClick={() => onNavigate('examination')} />
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN DASHBOARD — routes by role
// ══════════════════════════════════════════════════════════════
export default function Dashboard({ onNavigate }) {
  const { user, can } = useAuth();
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const role = user?.role || 'staff';

  const greetings = {
    super_admin: 'Director Overview',
    admin:       'Principal\'s Dashboard',
    coordinator: 'Coordinator Dashboard',
    manager:     'Manager Dashboard',
    staff:       'Office Dashboard',
    teacher:     'Teacher Dashboard',
  };

  useEffect(() => {
    // Teacher dashboard loads data on class selection, not here
    if (role === 'teacher') { setLoading(false); return; }

    window.api.dashboardStats({
      role,
      submitted_by: user?.username || '',
      academic_year: CURRENT_YEAR,
    }).then(res => {
      setLoading(false);
      if (res.success) setData(res.data);
      else setError(res.message);
    });
  }, [role, user]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <div className="text-4xl animate-spin mb-3">⏳</div>
        <p className="text-gray-400 text-sm">Loading dashboard…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-600">
      <p className="font-semibold">Failed to load dashboard</p>
      <p className="text-sm mt-1">{error}</p>
    </div>
  );

  return (
    <div className="max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">
          {greetings[role] || 'Dashboard'}
        </h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Welcome back, {user?.full_name || user?.username} ·{' '}
          {new Date().toLocaleDateString('en-IN', {
            weekday:'long', day:'numeric', month:'long', year:'numeric'
          })}
        </p>
      </div>

      {/* Missing fee dues alert */}
      {role !== 'teacher' && <MissingFeesBanner academicYear={CURRENT_YEAR} />}

      {/* Role-based view */}
      {(role === 'super_admin') && data && (
        <DirectorDashboard data={data} can={can} onNavigate={onNavigate} />
      )}
      {(role === 'admin') && data && (
        <PrincipalDashboard data={data} can={can} onNavigate={onNavigate} />
      )}
      {(role === 'coordinator' || role === 'manager' || role === 'staff') && data && (
        <TeamDashboard data={data} user={user} can={can} onNavigate={onNavigate} />
      )}
      {role === 'teacher' && (
        <TeacherDashboard onNavigate={onNavigate} />
      )}
    </div>
  );
}
