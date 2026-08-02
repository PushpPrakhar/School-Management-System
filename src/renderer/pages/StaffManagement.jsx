// StaffManagement.jsx — Add/remove Staff, Coordinator, Manager accounts
// (Principal + Director), and Admin/Director accounts (Director only).
// Staff accounts get a per-person permission checklist; every other role
// here gets its existing fixed, role-wide permission bucket automatically.

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const ROLE_LABELS = {
  staff: 'Staff', coordinator: 'Coordinator', manager: 'Deputy Manager',
  admin: 'Principal / Administrator', super_admin: 'Director',
};
const PERMISSION_LABELS = {
  admission: 'New Admission', studentList: 'Student List', feesLedger: 'Fees Ledger',
  feesReceipt: 'Counter Payment', feesNotice: 'Fees Notice', admitCard: 'Admit Card',
  examination: 'Examination', rollNumbers: 'Roll Numbers', academicCalendar: 'Academic Calendar',
  approveAdmission: 'Approve Admission', attendance: 'Attendance',
};

const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

function Badge({ active }) {
  return active
    ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Active</span>
    : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-500">Deactivated</span>;
}
function RoleBadge({ role }) {
  const colors = {
    staff: 'bg-gray-100 text-gray-700', coordinator: 'bg-orange-100 text-orange-800',
    manager: 'bg-blue-100 text-blue-800', admin: 'bg-purple-100 text-purple-800',
    super_admin: 'bg-red-100 text-red-800',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[role] || 'bg-gray-100 text-gray-600'}`}>{ROLE_LABELS[role] || role}</span>;
}

// ── Permission checklist (Staff only) ────────────────────────────
function PermissionPicker({ selected, onChange, assignable }) {
  const toggle = (p) => onChange(selected.includes(p) ? selected.filter(x => x !== p) : [...selected, p]);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {assignable.map(p => (
        <label key={p} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs cursor-pointer
          ${selected.includes(p) ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <input type="checkbox" checked={selected.includes(p)} onChange={() => toggle(p)} className="w-3.5 h-3.5" />
          {PERMISSION_LABELS[p] || p}
        </label>
      ))}
    </div>
  );
}

// ── One-time credential reveal ──────────────────────────────────
function CredentialReveal({ username, password, onClose }) {
  const [copied, setCopied] = useState(false);
  const copyAll = () => {
    navigator.clipboard?.writeText(`Username: ${username}\nPassword: ${password}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="text-center mb-4">
          <p className="text-3xl mb-2">🔑</p>
          <h3 className="font-bold text-gray-800 text-lg">Login Credentials</h3>
          <p className="text-xs text-amber-600 mt-1 font-medium">
            This password will not be shown again — write it down or share it with them now.
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 mb-4">
          <div><p className="text-xs text-gray-400">Username</p><p className="font-mono font-bold text-gray-800">{username}</p></div>
          <div><p className="text-xs text-gray-400">Password</p><p className="font-mono font-bold text-blue-700 text-lg tracking-wide">{password}</p></div>
        </div>
        <div className="flex gap-2">
          <button onClick={copyAll} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit Form ───────────────────────────────────────────
function TeamForm({ existing, allowedRoles, staffAssignablePermissions, onSaved, onCancel }) {
  const { user: currentUser } = useAuth();
  const isEdit = !!existing;
  const [form, setForm] = useState({
    full_name:           existing?.full_name || '',
    father_husband_name: existing?.father_husband_name || '',
    date_of_birth:       existing?.date_of_birth || '',
    aadhar_number:       existing?.aadhar_number || '',
    pan_number:          existing?.pan_number || '',
    qualification:       existing?.qualification || '',
    mobile_number:       existing?.mobile_number || '',
    address:             existing?.address || '',
    role:                existing?.role || allowedRoles[0],
    permissions:         existing?.permissions || [],
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [newCreds, setNewCreds] = useState(null);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const save = async () => {
    setError('');
    if (!form.full_name.trim()) { setError('Name is required.'); return; }
    if (form.role === 'staff' && form.permissions.length === 0) { setError('Assign at least one permission.'); return; }

    setSaving(true);
    const payload = { ...form, requesting_user_id: currentUser?.user_id };
    const res = isEdit
      ? await window.api.teamUpdate({ userId: existing.user_id, ...payload })
      : await window.api.teamCreate(payload);
    setSaving(false);

    if (!res.success) { setError(res.message); return; }
    if (!isEdit) setNewCreds({ username: res.username, password: res.password });
    else onSaved();
  };

  if (newCreds) {
    return <CredentialReveal username={newCreds.username} password={newCreds.password}
      onClose={() => { setNewCreds(null); onSaved(); }} />;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 max-w-2xl">
      <h3 className="font-bold text-gray-800">{isEdit ? `Edit ${existing.full_name}` : 'Add New Account'}</h3>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">{error}</div>}

      {!isEdit && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Account Type *</label>
          <select value={form.role} onChange={e => set('role', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {allowedRoles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Full Name *</label>
          <input value={form.full_name} onChange={e => set('full_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Father's / Husband's Name</label>
          <input value={form.father_husband_name} onChange={e => set('father_husband_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date of Birth</label>
          <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Mobile Number</label>
          <input value={form.mobile_number} onChange={e => set('mobile_number', e.target.value)}
            inputMode="numeric" maxLength={10} placeholder="10-digit mobile number"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Aadhar Number {isEdit && <span className="text-gray-400">(full number)</span>}
          </label>
          <input value={form.aadhar_number} onChange={e => set('aadhar_number', e.target.value)}
            inputMode="numeric" maxLength={14} placeholder="12-digit Aadhar number"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">PAN Number</label>
          <input value={form.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase())}
            maxLength={10} placeholder="ABCDE1234F"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Qualification</label>
          <input value={form.qualification} onChange={e => set('qualification', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
          <textarea value={form.address} onChange={e => set('address', e.target.value)} rows={2}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {form.role === 'staff' ? (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">Permissions *</label>
          <PermissionPicker selected={form.permissions} onChange={p => set('permissions', p)} assignable={staffAssignablePermissions} />
        </div>
      ) : (
        <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          {ROLE_LABELS[form.role]} accounts use their existing fixed set of permissions — no individual selection needed.
        </p>
      )}

      {!isEdit && (
        <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          A username (firstname.lastname@bps.in) and password will be generated automatically once saved.
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">
          Cancel
        </button>
        <button onClick={save} disabled={saving}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
          {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Account')}
        </button>
      </div>
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────
function TeamDetail({ userId, allowedRoles, staffAssignablePermissions, onBack, onChanged }) {
  const { user: currentUser } = useAuth();
  const [data,    setData]    = useState(null);
  const [editing, setEditing] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    const res = await window.api.teamGetOne(currentUser?.user_id, userId);
    if (res.success) setData(res.data);
    else setActionError(res.message);
  }, [userId, currentUser]);

  useEffect(() => { load(); }, [load]);

  const doReset = async () => {
    const res = await window.api.teamResetPassword(currentUser?.user_id, userId);
    setConfirmReset(false);
    if (!res.success) { setActionError(res.message); return; }
    setResetResult({ username: data.username, password: res.password });
  };

  const doToggle = async () => {
    const res = await window.api.toggleUser(userId, data.is_active ? 0 : 1, currentUser?.user_id);
    setConfirmToggle(false);
    if (!res.success) { setActionError(res.message); return; }
    load();
    onChanged();
  };

  if (!data) return <p className="text-sm text-gray-400 py-10 text-center">{actionError || 'Loading…'}</p>;

  if (editing) {
    return <TeamForm existing={data} allowedRoles={allowedRoles} staffAssignablePermissions={staffAssignablePermissions}
      onSaved={() => { setEditing(false); load(); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onBack} className="text-sm text-blue-700 hover:underline mb-4">&larr; Back to list</button>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
        {actionError && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">{actionError}</div>}

        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">{data.full_name}</h3>
            <p className="text-xs text-gray-400 font-mono">{data.username}</p>
          </div>
          <div className="flex items-center gap-2"><RoleBadge role={data.role} /><Badge active={data.is_active} /></div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-gray-400">Father's / Husband's Name</p><p className="font-medium">{data.father_husband_name || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Date of Birth</p><p className="font-medium">{fmtDate(data.date_of_birth)}</p></div>
          <div><p className="text-xs text-gray-400">Mobile</p><p className="font-medium">{data.mobile_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Aadhar Number (full)</p><p className="font-medium font-mono">{data.aadhar_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">PAN Number (full)</p><p className="font-medium font-mono">{data.pan_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Qualification</p><p className="font-medium">{data.qualification || '—'}</p></div>
          <div className="col-span-2"><p className="text-xs text-gray-400">Address</p><p className="font-medium">{data.address || '—'}</p></div>
          {data.role === 'staff' && (
            <div className="col-span-2">
              <p className="text-xs text-gray-400 mb-1">Permissions</p>
              <div className="flex flex-wrap gap-1.5">
                {(data.permissions || []).map(p => (
                  <span key={p} className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{PERMISSION_LABELS[p] || p}</span>
                ))}
              </div>
            </div>
          )}
          <div><p className="text-xs text-gray-400">Last Login</p><p className="font-medium">{data.last_login ? fmtDate(data.last_login) : 'Never'}</p></div>
        </div>

        <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
          <button onClick={() => setEditing(true)} className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
            ✏️ Edit Details
          </button>
          <button onClick={() => setConfirmReset(true)} className="px-4 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50">
            🔑 Reset Password
          </button>
          <button onClick={() => setConfirmToggle(true)}
            className={`px-4 py-2 border rounded-xl text-sm font-medium ${data.is_active ? 'border-red-300 text-red-600 hover:bg-red-50' : 'border-green-300 text-green-700 hover:bg-green-50'}`}>
            {data.is_active ? '🚫 Deactivate' : '✓ Reactivate'}
          </button>
        </div>
      </div>

      {confirmReset && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <p className="text-3xl mb-2">🔑</p>
            <p className="font-bold text-gray-800 mb-1">Reset {data.full_name}'s password?</p>
            <p className="text-sm text-gray-500 mb-5">A new password will be generated. The old one will stop working immediately.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmReset(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={doReset} className="flex-1 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-sm font-medium">Reset</button>
            </div>
          </div>
        </div>
      )}

      {confirmToggle && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <p className="text-3xl mb-2">{data.is_active ? '🚫' : '✓'}</p>
            <p className="font-bold text-gray-800 mb-1">
              {data.is_active ? `Deactivate ${data.full_name}?` : `Reactivate ${data.full_name}?`}
            </p>
            <p className="text-sm text-gray-500 mb-5">
              {data.is_active
                ? "They won't be able to log in anymore. Their history stays intact and attributed to them."
                : 'They will be able to log in again with their existing username and last password.'}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmToggle(false)} className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={doToggle}
                className={`flex-1 px-4 py-2.5 text-white rounded-xl text-sm font-medium ${data.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}>
                {data.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetResult && <CredentialReveal username={resetResult.username} password={resetResult.password} onClose={() => setResetResult(null)} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function StaffManagement() {
  const { user: currentUser } = useAuth();
  const [team,     setTeam]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [view,     setView]     = useState('list');
  const [search,   setSearch]   = useState('');
  const [staffAssignablePermissions, setStaffAssignablePermissions] = useState([]);

  // Director can create/manage everything here — Teacher stays exclusively
  // on the separate Teacher Management page (Principal + Manager).
  const allowedRoles = currentUser?.role === 'super_admin'
    ? ['super_admin', 'admin', 'staff', 'coordinator', 'manager']
    : currentUser?.role === 'admin'
      ? ['staff', 'coordinator', 'manager']
      : [];

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.teamGetAll(currentUser?.user_id);
    setLoading(false);
    if (res.success) {
      setTeam(res.data);
      setStaffAssignablePermissions(res.staffAssignablePermissions || []);
    }
  }, [currentUser]);

  useEffect(() => { load(); }, [load]);

  const filtered = team.filter(t =>
    !search.trim() ||
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.username.toLowerCase().includes(search.toLowerCase()) ||
    ROLE_LABELS[t.role]?.toLowerCase().includes(search.toLowerCase())
  );

  if (view === 'add') {
    return <TeamForm allowedRoles={allowedRoles} staffAssignablePermissions={staffAssignablePermissions}
      onSaved={() => { setView('list'); load(); }} onCancel={() => setView('list')} />;
  }
  if (typeof view === 'number') {
    return <TeamDetail userId={view} allowedRoles={allowedRoles} staffAssignablePermissions={staffAssignablePermissions}
      onBack={() => setView('list')} onChanged={load} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Staff Management</h2>
          <p className="text-sm text-gray-500">
            {currentUser?.role === 'super_admin'
              ? 'Add or manage any account here — Director, Principal, Staff, Coordinator, or Manager. Teacher accounts are managed separately in Teacher Management.'
              : 'Add Staff, Coordinator, and Manager accounts, and assign staff their level of access.'}
          </p>
        </div>
        <button onClick={() => setView('add')} className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
          + Add Account
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, username or role…"
        className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-center text-gray-400 py-10 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">No accounts found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name','Username','Role','Permissions','Mobile','Status',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((t, i) => (
                <tr key={t.user_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{t.full_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{t.username}</td>
                  <td className="px-4 py-2.5"><RoleBadge role={t.role} /></td>
                  <td className="px-4 py-2.5">
                    {t.role === 'staff'
                      ? <div className="flex flex-wrap gap-1">
                          {(t.permissions || []).slice(0, 3).map(p => (
                            <span key={p} className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{PERMISSION_LABELS[p] || p}</span>
                          ))}
                          {t.permissions.length > 3 && <span className="text-xs text-gray-400">+{t.permissions.length - 3} more</span>}
                        </div>
                      : <span className="text-xs text-gray-400">Full role access</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{t.mobile_number || '—'}</td>
                  <td className="px-4 py-2.5"><Badge active={t.is_active} /></td>
                  <td className="px-4 py-2.5">
                    <button onClick={() => setView(t.user_id)} className="text-xs text-blue-700 hover:underline font-medium">
                      View / Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
