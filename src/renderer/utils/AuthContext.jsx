import React, { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

// ── Role-based permissions ────────────────────────────────────
// Each key matches a nav item's permission field in App.jsx
export const PERMISSIONS = {
  super_admin: [
    'dashboard', 'admission', 'studentList', 'editStudent',
    'approveAdmission', 'rollNumbers', 'promoteStudents',
    'academicCalendar', 'attendance', 'editAttendance',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'admitCard', 'examination', 'tcGeneration',
    'backup', 'userManagement', 'excelImport',
  ],
  admin: [
    'dashboard', 'admission', 'studentList', 'editStudent',
    'approveAdmission', 'rollNumbers', 'promoteStudents',
    'academicCalendar', 'attendance', 'editAttendance',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'admitCard', 'examination', 'tcGeneration',
    'backup', 'excelImport',
  ],
  coordinator: [
    'dashboard', 'studentList',
    'rollNumbers', 'attendance', 'editAttendance',
    'examination', 'admitCard',
  ],
  manager: [
    'dashboard', 'studentList',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'attendance',
  ],
  staff: [
    'dashboard', 'admission', 'studentList',
    'feesLedger', 'feesReceipt', 'feesNotice',
  ],
  teacher: [
    'dashboard', 'studentList', 'attendance', 'examination',
  ],
};

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null); // null = not logged in
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const login = useCallback(async (username, password) => {
    setLoading(true); setError('');
    try {
      const result = await window.api.login({ username, password });
      if (result.success) { setUser(result.user); return true; }
      else { setError(result.message); return false; }
    } catch {
      setError('Could not connect. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => setUser(null), []);

  const can = useCallback((permission) => {
    if (!user) return false;
    return PERMISSIONS[user.role]?.includes(permission) ?? false;
  }, [user]);

  const canAccessClass = useCallback((className) => {
    if (!user) return false;
    if (['super_admin','admin','coordinator','manager'].includes(user.role)) return true;
    if (user.role === 'staff') return true;
    if (user.role === 'teacher') return user.assigned_class === className;
    return false;
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout, can, canAccessClass }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function RequireAuth({ permission, children }) {
  const { user, can } = useAuth();
  if (!user) return null;
  if (permission && !can(permission)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <p className="text-red-600 text-lg font-semibold">Access Denied</p>
        <p className="text-gray-500 mt-1 text-sm">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }
  return children;
}
