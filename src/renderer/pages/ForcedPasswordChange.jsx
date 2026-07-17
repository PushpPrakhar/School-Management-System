// ForcedPasswordChange.jsx — mandatory screen shown right after login when
// the account's password was auto-generated or just reset by Principal/
// Manager. Blocks access to the rest of the app until a real password is set.

import React, { useState } from 'react';
import { useAuth } from '../utils/AuthContext';

export default function ForcedPasswordChange() {
  const { user, logout, completePasswordChange } = useAuth();
  const [oldPassword,  setOldPassword]  = useState('');
  const [newPassword,  setNewPassword]  = useState('');
  const [confirm,      setConfirm]      = useState('');
  const [showPass,     setShowPass]     = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!oldPassword || !newPassword || !confirm) { setError('All fields are required.'); return; }
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (newPassword !== confirm) { setError('New password and confirmation do not match.'); return; }
    if (newPassword === oldPassword) { setError('New password must be different from your current one.'); return; }

    setSaving(true);
    const res = await window.api.changePassword({ userId: user.user_id, oldPassword, newPassword });
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    completePasswordChange();
  };

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl">🔑</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">Set a New Password</h1>
          <p className="text-gray-500 text-sm mt-1">
            {user?.full_name ? `Welcome, ${user.full_name}. ` : ''}
            For your security, please set your own password before continuing.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <form onSubmit={submit} noValidate>
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Current (Temporary) Password</label>
              <input type={showPass ? 'text' : 'password'} value={oldPassword} onChange={e => setOldPassword(e.target.value)}
                autoComplete="current-password" autoFocus disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type={showPass ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password" disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
              <p className="text-xs text-gray-400 mt-1">At least 6 characters.</p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type={showPass ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password" disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            </div>

            <label className="flex items-center gap-2 mb-5 text-xs text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={showPass} onChange={e => setShowPass(e.target.checked)} className="w-3.5 h-3.5" />
              Show passwords
            </label>

            <button type="submit" disabled={saving}
              className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm transition-colors duration-150">
              {saving ? 'Saving…' : 'Set New Password'}
            </button>
          </form>
        </div>

        <button onClick={logout} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4 underline">
          Sign out instead
        </button>
      </div>
    </div>
  );
}
