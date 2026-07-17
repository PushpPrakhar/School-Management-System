// Login.jsx — Login screen shown when user is not authenticated

import React, { useState, useEffect } from 'react';
import { useAuth } from '../utils/AuthContext';

const LAST_USERNAME_KEY = 'bps_last_username';

export default function Login() {
  const { login, loading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);

  // Remember the last-used username locally (never the password) so it
  // isn't retyped every time the app is opened.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_USERNAME_KEY);
      if (saved) setUsername(saved);
    } catch {}
  }, []);

  const checkCapsLock = (e) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    try { localStorage.setItem(LAST_USERNAME_KEY, username.trim()); } catch {}
    await login(username.trim(), password);
  };

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* School identity */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl font-bold tracking-tight">BPS</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800 tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
          <p className="text-gray-400 text-xs mt-0.5">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
          <p className="text-gray-500 text-sm mt-3">Please sign in to continue</p>
        </div>

        {/* Login card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={handleSubmit} noValidate>

            {/* Error banner */}
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {/* Username */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                autoFocus
                disabled={loading}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                           disabled:bg-gray-50 disabled:text-gray-400"
              />
            </div>

            {/* Password */}
            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={checkCapsLock}
                  onKeyDown={checkCapsLock}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                             disabled:bg-gray-50 disabled:text-gray-400"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPass ? '🙈' : '👁️'}
                </button>
              </div>
              {capsLockOn && (
                <p className="text-amber-600 text-xs mt-1.5 flex items-center gap-1">
                  ⚠️ Caps Lock is on
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300
                         text-white font-medium py-2.5 rounded-lg text-sm mt-4
                         transition-colors duration-150 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin">⏳</span> Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </button>

          </form>
        </div>

        {/* Hint */}
        <p className="text-center text-xs text-gray-400 mt-4">
          Trouble logging in? Contact your Principal or Manager.
        </p>
      </div>
    </div>
  );
}
