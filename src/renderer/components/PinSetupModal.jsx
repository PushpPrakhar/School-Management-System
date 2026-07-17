// PinSetupModal.jsx — self-service quick-PIN setup, reachable from the
// sidebar. Requires the real current password as proof before a PIN can
// be set or removed — nobody else can set a PIN on your behalf.

import React, { useState } from 'react';
import { useAuth } from '../utils/AuthContext';

export default function PinSetupModal({ onClose }) {
  const { setPin, removePin } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [pin, setPinValue] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!currentPassword) { setError('Enter your current password to confirm it\'s you.'); return; }
    if (!/^\d{4}$/.test(pin)) { setError('PIN must be exactly 4 digits.'); return; }
    if (pin !== confirmPin) { setError('PIN and confirmation do not match.'); return; }

    setSaving(true);
    const res = await setPin(currentPassword, pin);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setDone('Quick PIN saved. You can use it to unlock or switch users on this device today.');
  };

  const disable = async () => {
    setError('');
    if (!currentPassword) { setError('Enter your current password to confirm it\'s you.'); return; }
    setSaving(true);
    const res = await removePin(currentPassword);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setDone('Quick PIN removed.');
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="font-bold text-gray-800 mb-1">Quick Unlock PIN</h3>
        <p className="text-xs text-gray-500 mb-4">
          A 4-digit PIN lets you unlock or switch back in quickly on this device today, instead of typing your full password each time. It never replaces your password — a new day, or signing out, always needs your real password again.
        </p>

        {done ? (
          <>
            <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 mb-4">{done}</div>
            <button onClick={onClose} className="w-full px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              Done
            </button>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 mb-4">{error}</div>}

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Current Password</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                autoComplete="current-password" disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">New 4-Digit PIN</label>
              <input value={pin} onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric" maxLength={4} disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            </div>
            <div className="mb-5">
              <label className="block text-xs font-medium text-gray-500 mb-1">Confirm PIN</label>
              <input value={confirmPin} onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric" maxLength={4} disabled={saving}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tracking-[0.5em] text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50" />
            </div>

            <div className="flex gap-2 mb-2">
              <button type="button" onClick={onClose} disabled={saving}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">
                Cancel
              </button>
              <button type="submit" disabled={saving}
                className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
                {saving ? 'Saving…' : 'Save PIN'}
              </button>
            </div>
            <button type="button" onClick={disable} disabled={saving}
              className="w-full text-center text-xs text-red-500 hover:underline mt-1">
              Remove my existing PIN instead
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
