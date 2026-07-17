import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

const AuthContext = createContext(null);

const DEVICE_SESSIONS_KEY = 'bps_device_sessions';
const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes of inactivity

const todayStr = () => new Date().toISOString().slice(0, 10);

// The whole quick-switch feature lives on top of this one local structure:
//   { date: 'YYYY-MM-DD', activeUserId, sessions: { [user_id]: {token, user_id, username, full_name, role} } }
// A mismatched date means a new day has started — everything is wiped, so
// a real password login is required again, exactly as promised. Locking
// never touches this at all; only an explicit Sign Out removes an entry.
function loadDeviceStore() {
  try {
    const raw = localStorage.getItem(DEVICE_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.date === todayStr()) return parsed;
  } catch {}
  return { date: todayStr(), activeUserId: null, sessions: {} };
}
function saveDeviceStore(store) {
  try { localStorage.setItem(DEVICE_SESSIONS_KEY, JSON.stringify(store)); } catch {}
}
const stripToken = (s) => ({ user_id: s.user_id, username: s.username, full_name: s.full_name, role: s.role });

// ── Role-based permissions ────────────────────────────────────
// Each key matches a nav item's permission field in App.jsx
export const PERMISSIONS = {
  super_admin: [
    'dashboard', 'admission', 'studentList', 'editStudent',
    'approveAdmission', 'rollNumbers', 'promoteStudents',
    'academicCalendar', 'attendance', 'editAttendance',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'admitCard', 'examination', 'tcGeneration',
    'backup', 'userManagement', 'excelImport', 'feeSettings',
  ],
  admin: [
    'dashboard', 'admission', 'studentList', 'editStudent',
    'approveAdmission', 'rollNumbers', 'promoteStudents',
    'academicCalendar', 'attendance', 'editAttendance',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'admitCard', 'examination', 'tcGeneration',
    'backup', 'excelImport', 'feeSettings', 'teacherManagement',
  ],
  coordinator: [
    'dashboard', 'studentList',
    'rollNumbers', 'attendance', 'editAttendance',
    'examination', 'admitCard',
  ],
  manager: [
    'dashboard', 'studentList',
    'feesLedger', 'feesReceipt', 'feesNotice',
    'attendance', 'teacherManagement',
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
  const [user,            setUser]            = useState(null); // null = not logged in
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState('');
  const [initializing,    setInitializing]    = useState(true); // resuming a saved session on launch
  const [locked,          setLocked]          = useState(false);
  const [deviceSessions,  setDeviceSessions]  = useState([]); // other users logged in on this device today
  const sessionTokenRef = useRef(null);

  // ── Resume the active saved session on app launch ──────────────
  useEffect(() => {
    (async () => {
      const store = loadDeviceStore();
      setDeviceSessions(Object.values(store.sessions).map(stripToken));

      const active = store.activeUserId != null ? store.sessions[store.activeUserId] : null;
      if (!active) { setInitializing(false); return; }

      try {
        const res = await window.api.resumeSession(active.token);
        if (res.success) {
          sessionTokenRef.current = active.token;
          setUser(res.user);
        } else {
          // Stale/expired/deactivated — drop just this entry, keep the rest.
          delete store.sessions[store.activeUserId];
          store.activeUserId = null;
          saveDeviceStore(store);
          setDeviceSessions(Object.values(store.sessions).map(stripToken));
        }
      } catch {
        // Offline/DB hiccup on launch — fall back to a normal login screen.
      } finally {
        setInitializing(false);
      }
    })();
  }, []);

  const login = useCallback(async (username, password) => {
    setLoading(true); setError('');
    try {
      const result = await window.api.login({ username, password });
      if (result.success) {
        sessionTokenRef.current = result.session_token;
        const store = loadDeviceStore();
        store.sessions[result.user.user_id] = { token: result.session_token, ...stripToken(result.user) };
        store.activeUserId = result.user.user_id;
        saveDeviceStore(store);
        setDeviceSessions(Object.values(store.sessions).map(stripToken));
        setUser(result.user);
        setLocked(false);
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

  // A real sign-out removes THIS user's entry entirely — matches "full
  // password required after a real logout." Anyone else's cached session
  // on this device today is untouched.
  const logout = useCallback(async () => {
    const token = sessionTokenRef.current;
    const outgoingUserId = user?.user_id;
    sessionTokenRef.current = null;

    const store = loadDeviceStore();
    if (outgoingUserId != null) delete store.sessions[outgoingUserId];
    store.activeUserId = null;
    saveDeviceStore(store);
    setDeviceSessions(Object.values(store.sessions).map(stripToken));

    setUser(null);
    setLocked(false);
    if (token) { try { await window.api.logoutSession(token); } catch {} }
  }, [user]);

  // Called once a forced password change succeeds, so the app can proceed
  // past the mandatory change screen without requiring a fresh login.
  const completePasswordChange = useCallback(() => {
    setUser(u => u ? { ...u, must_change_password: false } : u);
  }, []);

  // ── Lock / Unlock — a UI-only state, deliberately separate from the
  // session itself. Locking never deletes any session or logs anyone out;
  // it just blocks the screen until someone re-authenticates. Unlocking
  // the SAME user reuses the normal (rate-limited) login check.
  const lock = useCallback(() => setLocked(true), []);

  const unlock = useCallback(async (password) => {
    if (!user) return { success: false, message: 'No active session.' };
    const result = await window.api.login({ username: user.username, password });
    if (result.success) {
      // A fresh session token was issued — keep the device store in sync
      // so the next resume/switch uses the current one, not a stale one.
      sessionTokenRef.current = result.session_token;
      const store = loadDeviceStore();
      store.sessions[user.user_id] = { token: result.session_token, ...stripToken(result.user) };
      store.activeUserId = user.user_id;
      saveDeviceStore(store);
      setDeviceSessions(Object.values(store.sessions).map(stripToken));
      setLocked(false);
    }
    return result;
  }, [user]);

  // ── Quick-switch: move to a DIFFERENT user who already has a saved
  // session on this device from a real password login earlier today.
  // A PIN only ever confirms identity to resume that existing session —
  // it never creates one, which is what enforces "PIN doesn't work
  // without a real password login the same day."
  const switchUser = useCallback(async (targetUserId, pin) => {
    const store = loadDeviceStore();
    const cached = store.sessions[targetUserId];
    if (!cached) return { success: false, message: 'Please sign in with your password.' };

    const pinResult = await window.api.verifyPin(targetUserId, pin);
    if (!pinResult.success) return pinResult;

    const resumeResult = await window.api.resumeSession(cached.token);
    if (!resumeResult.success) {
      delete store.sessions[targetUserId];
      if (store.activeUserId === targetUserId) store.activeUserId = null;
      saveDeviceStore(store);
      setDeviceSessions(Object.values(store.sessions).map(stripToken));
      return { success: false, message: 'That saved session has expired. Please sign in with your password.' };
    }

    sessionTokenRef.current = cached.token;
    store.activeUserId = targetUserId;
    saveDeviceStore(store);
    setUser(resumeResult.user);
    setLocked(false);
    return { success: true };
  }, []);

  // ── Quick PIN — self-service only; requires the real current password
  // as proof, same trust model as changing the password itself.
  const setPin = useCallback(async (currentPassword, pin) => {
    if (!user) return { success: false, message: 'Not logged in.' };
    return window.api.setPin(user.user_id, currentPassword, pin);
  }, [user]);

  const removePin = useCallback(async (currentPassword) => {
    if (!user) return { success: false, message: 'Not logged in.' };
    return window.api.removePin(user.user_id, currentPassword);
  }, [user]);

  // ── Auto-lock after inactivity ─────────────────────────────────
  useEffect(() => {
    if (!user || user.must_change_password || locked) return;

    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const reset = () => { clearTimeout(timer); timer = setTimeout(lock, AUTO_LOCK_MS); };

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(ev => window.addEventListener(ev, reset));
    return () => {
      clearTimeout(timer);
      events.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [user, locked, lock]);

  const can = useCallback((permission) => {
    if (!user) return false;
    return PERMISSIONS[user.role]?.includes(permission) ?? false;
  }, [user]);

  const canAccessClass = useCallback((className) => {
    if (!user) return false;
    if (['super_admin','admin','coordinator','manager'].includes(user.role)) return true;
    if (user.role === 'staff') return true;
    if (user.role === 'teacher') return (user.classes || []).includes(className);
    return false;
  }, [user]);

  return (
    <AuthContext.Provider value={{
      user, loading, error, initializing, locked, deviceSessions,
      login, logout, lock, unlock, switchUser, setPin, removePin,
      can, canAccessClass, completePasswordChange,
    }}>
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
