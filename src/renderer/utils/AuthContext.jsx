// AuthContext.jsx
// Provides login state and role-based permission checks to all pages.

import React, { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

// Role permissions map
export const PERMISSIONS = {
  admin: [
    'dashboard', 'admission', 'editStudent', 'deleteStudent',
    'studentList', 'editStudent', 'admitCard', 'examMarks', 'feesNotice',
    'feesReceipt', 'attendance', 'editAttendance',
    'tcGeneration', 'backup', 'userManagement',
  ],
  staff: [
    'dashboard', 'admission', 'studentList', 'editStudent', 'admitCard',
    'examMarks', 'feesNotice', 'feesReceipt', 'attendance',
  ],
  teacher: [
    'dashboard', 'studentList', 'examMarks', 'attendance',
  ],
};

// ── Login disabled temporarily — re-enable at end of project ──
// To re-enable: change DEFAULT_USER to null
const DEFAULT_USER = {
  user_id: 1,
  username: 'admin',
  full_name: 'Administrator',
  role: 'admin',
  assigned_class: null,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEFAULT_USER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const result = await window.api.login({ username, password });
      if (result.success) {
        setUser(result.user);
        return true;
      } else {
        setError(result.message);
        return false;
      }
    } catch {
      setError('Could not connect. Please try again.');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const can = useCallback((permission) => {
    if (!user) return false;
    return PERMISSIONS[user.role]?.includes(permission) ?? false;
  }, [user]);

  const canAccessClass = useCallback((className) => {
    if (!user) return false;
    if (user.role === 'admin' || user.role === 'staff') return true;
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
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-600 text-lg font-medium">Access Denied</p>
          <p className="text-gray-500 mt-1 text-sm">You do not have permission to view this page.</p>
        </div>
      </div>
    );
  }
  return children;
}
