// Login.jsx — Login screen shown when user is not authenticated

import React, { useState } from 'react';
import { useAuth } from '../utils/AuthContext';

export default function Login() {
  const { login, loading, error } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    await login(username.trim(), password);
  };

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* School logo / header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-3xl font-bold">🏫</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">School Management System</h1>
          <p className="text-gray-500 text-sm mt-1">Please sign in to continue</p>
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
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username.trim() || !password}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300
                         text-white font-medium py-2.5 rounded-lg text-sm
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
          Default admin: <code className="bg-gray-100 px-1 py-0.5 rounded">admin</code> / <code className="bg-gray-100 px-1 py-0.5 rounded">admin123</code>
          <br />Please change the password after first login.
        </p>
      </div>
    </div>
  );
}
