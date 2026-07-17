// LockScreen.jsx — shown after inactivity (or an explicit Lock click).
// The locked user can unlock with password or PIN. Other people who
// logged in on this device earlier today appear as quick-switch tiles and
// can PIN their way back in without anyone typing a full password again.
// This never ends any session — only "Sign out instead" does that.

import React, { useState } from 'react';
import { useAuth } from '../utils/AuthContext';

function PinDots({ length, max = 4 }) {
  return (
    <div className="flex justify-center gap-3 my-4">
      {Array.from({ length: max }).map((_, i) => (
        <div key={i} className={`w-4 h-4 rounded-full border-2 ${i < length ? 'bg-blue-700 border-blue-700' : 'border-gray-300'}`} />
      ))}
    </div>
  );
}

export default function LockScreen() {
  const { user, unlock, switchUser, logout, deviceSessions } = useAuth();
  const otherSessions = deviceSessions.filter(s => s.user_id !== user?.user_id);

  const [selected,   setSelected]   = useState(user); // tile currently focused — starts on the locked user
  const [mode,        setMode]      = useState('pin'); // 'pin' | 'password' (password only ever for `user` themself)
  const [pin,         setPin]       = useState('');
  const [password,    setPassword]  = useState('');
  const [showPass,    setShowPass]  = useState(false);
  const [submitting,  setSubmitting]= useState(false);
  const [error,       setError]     = useState('');

  const isSelf = selected?.user_id === user?.user_id;

  const chooseTile = (tile) => {
    setSelected(tile);
    setMode('pin');
    setPin(''); setPassword(''); setError('');
  };

  const submitPin = async (digits) => {
    setSubmitting(true); setError('');
    const res = await switchUser(selected.user_id, digits);
    setSubmitting(false);
    if (!res.success) { setError(res.message); setPin(''); return; }
  };

  const handlePinDigit = (d) => {
    if (submitting) return;
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (next.length === 4) submitPin(next);
  };

  const submitPassword = async (e) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true); setError('');
    const res = await unlock(password);
    setSubmitting(false);
    if (!res.success) { setError(res.message); setPassword(''); return; }
  };

  return (
    <div className="fixed inset-0 bg-blue-50 flex items-center justify-center p-4 z-[100]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-5">
          <div className="w-16 h-16 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-white text-2xl">🔒</span>
          </div>
          <h1 className="text-xl font-bold text-gray-800">Screen Locked</h1>
        </div>

        {/* Quick-switch tiles, only shown when someone else is also cached on this device today */}
        {otherSessions.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-5">
            {[user, ...otherSessions].map(s => (
              <button key={s.user_id} onClick={() => chooseTile(s)}
                className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors
                  ${selected?.user_id === s.user_id ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                {s.full_name || s.username}
              </button>
            ))}
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <p className="text-center text-sm text-gray-500 mb-1">{selected?.full_name || selected?.username}</p>
          <p className="text-center text-xs text-gray-400 mb-4 capitalize">{selected?.role?.replace('_',' ')}</p>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm text-center">{error}</p>
            </div>
          )}

          {mode === 'pin' ? (
            <>
              <p className="text-center text-xs text-gray-500 mb-1">Enter 4-digit PIN</p>
              <PinDots length={pin.length} />
              <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto mb-4">
                {['1','2','3','4','5','6','7','8','9'].map(d => (
                  <button key={d} type="button" disabled={submitting} onClick={() => handlePinDigit(d)}
                    className="py-3 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-800 font-medium text-lg">
                    {d}
                  </button>
                ))}
                <button type="button" disabled={submitting} onClick={() => setPin('')}
                  className="py-3 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-400 text-xs font-medium">Clear</button>
                <button type="button" disabled={submitting} onClick={() => handlePinDigit('0')}
                  className="py-3 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-800 font-medium text-lg">0</button>
                <button type="button" disabled={submitting} onClick={() => setPin(p => p.slice(0, -1))}
                  className="py-3 rounded-xl bg-gray-50 hover:bg-gray-100 disabled:opacity-50 text-gray-400 text-xs font-medium">⌫</button>
              </div>
              {isSelf && (
                <button onClick={() => { setMode('password'); setError(''); }}
                  className="w-full text-center text-xs text-blue-700 hover:underline">
                  Use full password instead
                </button>
              )}
            </>
          ) : (
            <form onSubmit={submitPassword}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <div className="relative">
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    disabled={submitting}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-10 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
                  />
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" tabIndex={-1}>
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={submitting || !password}
                className="w-full bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-lg text-sm mb-2">
                {submitting ? 'Checking…' : 'Unlock'}
              </button>
              <button type="button" onClick={() => { setMode('pin'); setError(''); }}
                className="w-full text-center text-xs text-blue-700 hover:underline">
                Use PIN instead
              </button>
            </form>
          )}
        </div>

        {!isSelf && (
          <p className="text-center text-xs text-gray-400 mt-4">
            Switching to {selected?.full_name || selected?.username} — {user?.full_name || user?.username} stays signed in on this device.
          </p>
        )}
        <button onClick={logout} className="w-full text-center text-xs text-gray-400 hover:text-gray-600 mt-4 underline">
          Not on this list? Sign out instead
        </button>
      </div>
    </div>
  );
}
