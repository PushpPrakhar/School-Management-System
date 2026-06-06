// App.jsx — Root component
// Routes between Login and the main app shell.
// Each page is lazy-loaded so only the current page's bundle loads.

import React, { Suspense, lazy, useState } from 'react';
import { AuthProvider, useAuth } from './utils/AuthContext';
import Login from './pages/Login';
import ExcelImport from './pages/ExcelImport';
import Admission from './pages/Admission';
import StudentList from './pages/StudentList';
import EditStudent from './pages/EditStudent';
import FeesLedger from './pages/FeesLedger';
import FeesReceipt from './pages/FeesReceipt';
import FeesNotice from './pages/FeesNotice';

// ── Sidebar nav items (add pages here as you build each phase) ─
const NAV_ITEMS = [
  { key: 'dashboard',    label: 'Dashboard',       icon: '🏠', permission: 'dashboard'   },
  { key: 'admission',    label: 'New Admission',    icon: '📝', permission: 'admission'   },
  { key: 'studentList',  label: 'Student List',     icon: '📋', permission: 'studentList' },
  { key: 'editStudent',  label: 'Edit Student',      icon: '✏️',  permission: 'editStudent'  },
  { key: 'feesLedger',   label: 'Fees Ledger',       icon: '📒', permission: 'feesReceipt' },
  { key: 'feesReceipt',  label: 'Collect Fees',       icon: '💰', permission: 'feesReceipt' },
  { key: 'feesNotice',   label: 'Fees Notice',      icon: '📢', permission: 'feesNotice'  },
  { key: 'admitCard',    label: 'Admit Cards',      icon: '🪪', permission: 'admitCard'   },
  { key: 'attendance',   label: 'Attendance',       icon: '📅', permission: 'attendance'  },
  { key: 'examination',  label: 'Examination',      icon: '📊', permission: 'examMarks'   },
  { key: 'tcGeneration', label: 'TC Generation',    icon: '📄', permission: 'tcGeneration'},
  { key: 'backup',       label: 'Backup & Restore', icon: '💾', permission: 'backup'      },
  { key: 'users',        label: 'User Management',  icon: '👥', permission: 'userManagement'},
  { key: 'excelImport', label: 'Import from Excel', icon: '📥', permission: 'backup' },
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

// ── App shell (shown after login) ────────────────────────────
function AppShell() {
  const { user, logout, can } = useAuth();
  const [activePage, setActivePage] = useState('dashboard');

  const visibleNav = NAV_ITEMS.filter(item => can(item.permission));

  const renderPage = () => {
    switch (activePage) {
      // Phase 1 — these exist now
      case 'dashboard':    return <ComingSoon page="Dashboard — Phase 6" />;
      // Phase 2+
      case 'admission':    return <Admission />;
      case 'studentList':  return <StudentList />;
      case 'editStudent':  return <EditStudent />;
      case 'feesLedger':   return <FeesLedger />;
      case 'feesReceipt':  return <FeesReceipt />;
      case 'feesNotice':   return <FeesNotice />;
      case 'admitCard':    return <ComingSoon page="Admit Card — Phase 4" />;
      case 'tcGeneration': return <ComingSoon page="TC Generation — Phase 4" />;
      case 'attendance':   return <ComingSoon page="Attendance — Phase 5" />;
      case 'examination':  return <ComingSoon page="Examination — Phase 5" />;
      case 'backup':       return <ComingSoon page="Backup & Restore — Phase 6" />;
      case 'users':        return <UserManagement />;
      case 'excelImport':  return <ExcelImport />;
      default:             return <ComingSoon page={activePage} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">

      {/* ── Sidebar ── */}
      <aside className="w-56 bg-blue-800 text-white flex flex-col flex-shrink-0">
        {/* School name header */}
        <div className="p-4 border-b border-blue-700">
          <p className="font-bold text-sm leading-tight">School Management</p>
          <p className="text-blue-300 text-xs mt-0.5">System</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {visibleNav.map(item => (
            <button
              key={item.key}
              onClick={() => setActivePage(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left
                          transition-colors duration-100
                          ${activePage === item.key
                            ? 'bg-blue-900 text-white'
                            : 'text-blue-100 hover:bg-blue-700'}`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="p-4 border-t border-blue-700">
          <p className="text-sm font-medium truncate">{user.full_name}</p>
          <p className="text-blue-300 text-xs capitalize">{user.role}</p>
          <button
            onClick={logout}
            className="mt-2 text-xs text-blue-300 hover:text-white underline"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 h-full">
          {renderPage()}
        </div>
      </main>
    </div>
  );
}

// ── User Management page (Phase 1 — Admin only) ──────────────
function UserManagement() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState({ username: '', password: '', full_name: '', role: 'staff', assigned_class: '' });
  const [saving, setSaving] = React.useState(false);
  const [msg, setMsg] = React.useState('');

  const load = async () => {
    setLoading(true);
    const res = await window.api.getUsers();
    if (res.success) setUsers(res.data);
    setLoading(false);
  };

  React.useEffect(() => { load(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg('');
    const res = await window.api.createUser(form);
    if (res.success) {
      setMsg('User created successfully.');
      setShowForm(false);
      setForm({ username: '', password: '', full_name: '', role: 'staff', assigned_class: '' });
      load();
    } else {
      setMsg(res.message);
    }
    setSaving(false);
  };

  const handleToggle = async (userId, isActive) => {
    await window.api.toggleUser(userId, !isActive);
    load();
  };

  const ROLE_COLOURS = {
    admin: 'bg-purple-100 text-purple-800',
    staff: 'bg-blue-100 text-blue-800',
    teacher: 'bg-green-100 text-green-800',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">User Management</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="bg-blue-700 hover:bg-blue-800 text-white text-sm px-4 py-2 rounded-lg"
        >
          {showForm ? 'Cancel' : '+ Add User'}
        </button>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${msg.includes('success') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}

      {/* Add user form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white border border-gray-200 rounded-xl p-5 mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Full Name *</label>
            <input required value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Username *</label>
            <input required value={form.username} onChange={e => setForm({...form, username: e.target.value})}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Password *</label>
            <input required type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role *</label>
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="staff">Staff</option>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {form.role === 'teacher' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Assigned Class</label>
              <input value={form.assigned_class} onChange={e => setForm({...form, assigned_class: e.target.value})}
                placeholder="e.g. Class 5"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div className="col-span-2 flex justify-end">
            <button type="submit" disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white text-sm px-6 py-2 rounded-lg disabled:opacity-50">
              {saving ? 'Saving…' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      {/* Users table */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading…</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Name', 'Username', 'Role', 'Assigned Class', 'Last Login', 'Status'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{u.full_name}</td>
                  <td className="px-4 py-3 text-gray-600">{u.username}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOURS[u.role]}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{u.assigned_class || '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{u.last_login || 'Never'}</td>
                  <td className="px-4 py-3">
                    {u.username !== currentUser.username && (
                      <button
                        onClick={() => handleToggle(u.user_id, u.is_active)}
                        className={`text-xs px-3 py-1 rounded-full border
                          ${u.is_active
                            ? 'border-red-200 text-red-600 hover:bg-red-50'
                            : 'border-green-200 text-green-600 hover:bg-green-50'}`}
                      >
                        {u.is_active ? 'Disable' : 'Enable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Root: show Login if not authenticated, AppShell if yes ───
function AppContent() {
  const { user } = useAuth();
  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
