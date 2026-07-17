// TeacherManagement.jsx — Add/remove teachers, assign classes, reset passwords
// Access: Principal (admin) & Manager only (see 'teacherManagement' permission)

import React, { useState, useEffect, useCallback } from 'react';

const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                  'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];

const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

function Badge({ active }) {
  return active
    ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Active</span>
    : <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 text-gray-500">Deactivated</span>;
}

// ── Class multi-select (checkboxes) ─────────────────────────────
function ClassPicker({ selected, onChange }) {
  const toggle = (c) => {
    onChange(selected.includes(c) ? selected.filter(x => x !== c) : [...selected, c]);
  };
  return (
    <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
      {CLASSES.map(c => (
        <label key={c} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs cursor-pointer
          ${selected.includes(c) ? 'bg-blue-50 border-blue-400 text-blue-700 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} className="w-3.5 h-3.5" />
          {c}
        </label>
      ))}
    </div>
  );
}

// ── One-time credential reveal (shown right after create / reset) ──
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
            This password will not be shown again — write it down or share it with the teacher now.
          </p>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2 mb-4">
          <div>
            <p className="text-xs text-gray-400">Username</p>
            <p className="font-mono font-bold text-gray-800">{username}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">Password</p>
            <p className="font-mono font-bold text-blue-700 text-lg tracking-wide">{password}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={copyAll}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit Teacher Form ──────────────────────────────────────
function TeacherForm({ existing, onSaved, onCancel }) {
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
    classes:             existing?.classes || [],
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [newCreds, setNewCreds] = useState(null);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const validate = () => {
    if (!form.full_name.trim()) return 'Teacher name is required.';
    if (form.classes.length === 0) return 'Assign at least one class.';

    if (form.date_of_birth) {
      const dob = new Date(form.date_of_birth);
      if (isNaN(dob.getTime())) return 'Date of birth is not a valid date.';
      if (dob > new Date()) return 'Date of birth cannot be in the future.';
      const age = (Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18) return 'Date of birth suggests an age below 18 — please check it.';
      if (age > 80) return 'Date of birth suggests an age above 80 — please check it.';
    }

    if (form.aadhar_number) {
      const digits = form.aadhar_number.replace(/\s+/g, '');
      if (!/^\d{12}$/.test(digits)) return 'Aadhar number must be exactly 12 digits.';
    }

    if (form.pan_number) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan_number.trim())) {
        return 'PAN number must be in the format ABCDE1234F (5 letters, 4 digits, 1 letter).';
      }
    }

    if (form.mobile_number) {
      const digits = form.mobile_number.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(digits)) return 'Mobile number must be a valid 10-digit Indian number.';
    }

    return null;
  };

  const save = async () => {
    setError('');
    const validationError = validate();
    if (validationError) { setError(validationError); return; }

    // Normalize Aadhar/mobile to digits-only and PAN to trimmed uppercase
    // before saving, regardless of how the person typed them in.
    const cleanForm = {
      ...form,
      aadhar_number: form.aadhar_number.replace(/\s+/g, ''),
      mobile_number: form.mobile_number.replace(/\D/g, ''),
      pan_number: form.pan_number.trim().toUpperCase(),
    };

    setSaving(true);
    const res = isEdit
      ? await window.api.teachersUpdate({ userId: existing.user_id, ...cleanForm })
      : await window.api.teachersCreate(cleanForm);
    setSaving(false);

    if (!res.success) { setError(res.message); return; }

    if (!isEdit) {
      setNewCreds({ username: res.username, password: res.password });
    } else {
      onSaved();
    }
  };

  if (newCreds) {
    return <CredentialReveal username={newCreds.username} password={newCreds.password}
      onClose={() => { setNewCreds(null); onSaved(); }} />;
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5 max-w-2xl">
      <h3 className="font-bold text-gray-800">{isEdit ? `Edit ${existing.full_name}` : 'Add New Teacher'}</h3>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Teacher's Name *</label>
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
            Aadhar Number {isEdit && <span className="text-gray-400">(full number — edit only if incorrect)</span>}
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

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-2">Assigned Class(es) *</label>
        <ClassPicker selected={form.classes} onChange={c => set('classes', c)} />
      </div>

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
          {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Teacher')}
        </button>
      </div>
    </div>
  );
}

// ── Detail view (full unmasked info + actions) ──────────────────
function TeacherDetail({ userId, onBack, onChanged }) {
  const [data,    setData]    = useState(null);
  const [editing, setEditing] = useState(false);
  const [resetResult, setResetResult] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState(false);

  const load = useCallback(async () => {
    const res = await window.api.teachersGetOne(userId);
    if (res.success) setData(res.data);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const doReset = async () => {
    const res = await window.api.teachersResetPassword(userId);
    setConfirmReset(false);
    if (res.success) setResetResult({ username: data.username, password: res.password });
  };

  const doToggle = async () => {
    await window.api.teachersToggle(userId, data.is_active ? 0 : 1);
    setConfirmToggle(false);
    load();
    onChanged();
  };

  if (!data) return <p className="text-sm text-gray-400 py-10 text-center">Loading…</p>;

  if (editing) {
    return <TeacherForm existing={data} onSaved={() => { setEditing(false); load(); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <div className="max-w-2xl">
      <button onClick={onBack} className="text-sm text-blue-700 hover:underline mb-4">&larr; Back to list</button>

      <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">{data.full_name}</h3>
            <p className="text-xs text-gray-400 font-mono">{data.username}</p>
          </div>
          <Badge active={data.is_active} />
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-xs text-gray-400">Father's / Husband's Name</p><p className="font-medium">{data.father_husband_name || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Date of Birth</p><p className="font-medium">{fmtDate(data.date_of_birth)}</p></div>
          <div><p className="text-xs text-gray-400">Mobile</p><p className="font-medium">{data.mobile_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Aadhar Number (full)</p><p className="font-medium font-mono">{data.aadhar_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">PAN Number (full)</p><p className="font-medium font-mono">{data.pan_number || '—'}</p></div>
          <div><p className="text-xs text-gray-400">Qualification</p><p className="font-medium">{data.qualification || '—'}</p></div>
          <div className="col-span-2"><p className="text-xs text-gray-400">Address</p><p className="font-medium">{data.address || '—'}</p></div>
          <div className="col-span-2">
            <p className="text-xs text-gray-400 mb-1">Assigned Classes</p>
            <div className="flex flex-wrap gap-1.5">
              {(data.classes || []).map(c => (
                <span key={c} className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{c}</span>
              ))}
            </div>
          </div>
          <div><p className="text-xs text-gray-400">Last Login</p><p className="font-medium">{data.last_login ? fmtDate(data.last_login) : 'Never'}</p></div>
        </div>

        <div className="flex flex-wrap gap-3 pt-3 border-t border-gray-100">
          <button onClick={() => setEditing(true)}
            className="px-4 py-2 border border-gray-300 rounded-xl text-sm font-medium hover:bg-gray-50">
            ✏️ Edit Details
          </button>
          <button onClick={() => setConfirmReset(true)}
            className="px-4 py-2 border border-amber-300 text-amber-700 rounded-xl text-sm font-medium hover:bg-amber-50">
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
                ? "They won't be able to log in anymore. Their attendance/exam history stays intact and attributed to them."
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

      {resetResult && (
        <CredentialReveal username={resetResult.username} password={resetResult.password} onClose={() => setResetResult(null)} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────
export default function TeacherManagement() {
  const [teachers, setTeachers] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [view,     setView]     = useState('list'); // 'list' | 'add' | detail user_id
  const [search,   setSearch]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.teachersGetAll();
    setLoading(false);
    if (res.success) setTeachers(res.data);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = teachers.filter(t =>
    !search.trim() ||
    t.full_name.toLowerCase().includes(search.toLowerCase()) ||
    t.username.toLowerCase().includes(search.toLowerCase()) ||
    (t.classes || []).some(c => c.toLowerCase().includes(search.toLowerCase()))
  );

  if (view === 'add') {
    return <TeacherForm onSaved={() => { setView('list'); load(); }} onCancel={() => setView('list')} />;
  }
  if (typeof view === 'number') {
    return <TeacherDetail userId={view} onBack={() => setView('list')} onChanged={load} />;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Teacher Management</h2>
          <p className="text-sm text-gray-500">Add teachers, assign classes, manage credentials.</p>
        </div>
        <button onClick={() => setView('add')}
          className="px-5 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
          + Add Teacher
        </button>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, username or class…"
        className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-center text-gray-400 py-10 text-sm">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">No teachers found.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name','Username','Classes','Mobile','Aadhar','PAN','Status',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((t, i) => (
                <tr key={t.user_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{t.full_name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{t.username}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(t.classes || []).map(c => (
                        <span key={c} className="text-xs px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">{c}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{t.mobile_number || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{t.aadhar_number || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 font-mono">{t.pan_number || '—'}</td>
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
