// RollNumbers.jsx
// Two tabs: Assign Roll Numbers | View Roll Numbers

import React, { useState, useEffect, useCallback } from 'react';

// Only show past + current years — no future years
const CURRENT_SESSION_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1;
})();
const CURRENT_YEAR = `${CURRENT_SESSION_YEAR}-${String(CURRENT_SESSION_YEAR + 1).slice(2)}`;
const ACADEMIC_YEARS = Array.from({ length: 5 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 4 + i;
  return `${y}-${String(y + 1).slice(2)}`;
}).reverse(); // newest first

function Badge({ text, color }) {
  const s = {
    green:  'bg-green-100 text-green-700 border border-green-200',
    amber:  'bg-amber-100 text-amber-700 border border-amber-200',
    blue:   'bg-blue-100 text-blue-700 border border-blue-200',
    gray:   'bg-gray-100 text-gray-500 border border-gray-200',
    red:    'bg-red-100 text-red-600 border border-red-200',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s[color]}`}>{text}</span>;
}

// ── Assign Tab ────────────────────────────────────────────────
function AssignTab() {
  const [year,     setYear]     = useState(CURRENT_YEAR);
  const [summary,  setSummary]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [assigning, setAssigning] = useState(null); // class being assigned
  const [toast,    setToast]    = useState(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getRollNumberSummary(year);
    if (res.success) setSummary(res.data);
    setLoading(false);
  }, [year]);

  useEffect(() => { loadSummary(); }, [loadSummary]);

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3500);
  };

  const assignClass = async (cls, section) => {
    setAssigning(`${cls}_${section}`);
    const res = await window.api.assignRollNumbersClass(cls, section, year, 'admin');
    setAssigning(null);
    if (res.success) {
      showToast(`✅ Assigned roll numbers to ${cls} ${section} — ${res.assigned} students`, 'green');
      loadSummary();
    } else {
      showToast(`❌ ${res.message}`, 'red');
    }
  };

  const syncMissing = async (cls, section) => {
    setAssigning(`sync_${cls}_${section}`);
    const res = await window.api.syncMissingRollNumbers(cls, section, year, 'admin');
    setAssigning(null);
    if (res.success) {
      showToast(res.added > 0
        ? `✅ Added ${res.added} student${res.added > 1 ? 's' : ''} to the end of ${cls} ${section} — everyone else's number stayed the same`
        : `${cls} ${section} — everyone already has a roll number.`, 'green');
      loadSummary();
    } else {
      showToast(`❌ ${res.message}`, 'red');
    }
  };

  const assignAll = async () => {
    setAssigning('ALL');
    const res = await window.api.assignRollNumbersAll(year, 'admin');
    setAssigning(null);
    if (res.success) {
      showToast(`✅ Roll numbers assigned for all ${res.classes.length} classes — ${res.totalAssigned} students total`, 'green');
      loadSummary();
    } else {
      showToast(`❌ ${res.message}`, 'red');
    }
  };

  const allAssigned = summary.length > 0 && summary.every(s => s.is_assigned);
  const anyAssigned = summary.some(s => s.is_assigned);

  return (
    <div>
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white
          ${toast.color === 'green' ? 'bg-green-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Year selector + Assign All */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5 flex items-end justify-between gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-40">
            {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">
            Run at the start of each academic year (April)
          </p>
        </div>
        <button onClick={assignAll} disabled={assigning === 'ALL'}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-6 py-2.5 rounded-xl text-sm flex items-center gap-2">
          {assigning === 'ALL'
            ? <><span className="animate-spin">⏳</span> Assigning all…</>
            : `🔢 Assign All Classes (${year})`}
        </button>
      </div>

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-700">
        <p className="font-semibold mb-1">How roll numbers work</p>
        <ul className="text-xs space-y-1 text-blue-600 list-disc list-inside">
          <li>Click <strong>Assign All Classes</strong> at the start of the academic year</li>
          <li>Roll numbers are assigned alphabetically per class and section</li>
          <li>Once assigned, they stay fixed for the year — mid-year additions normally get the next available number automatically</li>
          <li>If someone's missing (e.g. reactivated before their class was ever assigned), use <strong>Sync Missing</strong> to add just them at the end — it never touches anyone already assigned</li>
          <li>Re-assigning a class wipes and recalculates everyone from scratch (only do this at year start)</li>
        </ul>
      </div>

      {/* Class-wise status table */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading classes…</div>
      ) : summary.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No active students found.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              Classes — {summary.length} total
            </h3>
            <div className="flex gap-2">
              <Badge text={`${summary.filter(s => s.is_assigned).length} assigned`} color="green" />
              <Badge text={`${summary.filter(s => !s.is_assigned).length} pending`} color="amber" />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                <th className="text-left px-5 py-3 font-medium">Class</th>
                <th className="text-left px-5 py-3 font-medium">Section</th>
                <th className="text-center px-5 py-3 font-medium">Students</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Last Assigned</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {summary.map(s => (
                <tr key={`${s.class}_${s.section}`}
                  className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-800">{s.class}</td>
                  <td className="px-5 py-3 text-gray-600">{s.section}</td>
                  <td className="px-5 py-3 text-center text-gray-700">{s.student_count}</td>
                  <td className="px-5 py-3">
                    {s.is_assigned
                      ? <Badge text={`✓ Assigned (${s.roll_count})`} color="green" />
                      : <Badge text="Not assigned" color="amber" />}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-400">
                    {s.last_assigned ? s.last_assigned.slice(0, 16) : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex gap-2 justify-end">
                      {s.is_assigned && (
                        <button
                          onClick={() => syncMissing(s.class, s.section)}
                          disabled={assigning === `sync_${s.class}_${s.section}`}
                          title="Add anyone active but missing a roll number to the end — doesn't touch anyone already assigned"
                          className="text-xs font-medium px-4 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50">
                          {assigning === `sync_${s.class}_${s.section}` ? '⏳ Syncing…' : '➕ Sync Missing'}
                        </button>
                      )}
                      <button
                        onClick={() => assignClass(s.class, s.section)}
                        disabled={assigning === `${s.class}_${s.section}`}
                        className={`text-xs font-medium px-4 py-1.5 rounded-lg
                          ${s.is_assigned
                            ? 'border border-gray-300 text-gray-500 hover:bg-gray-50'
                            : 'bg-blue-700 hover:bg-blue-800 text-white'}`}>
                        {assigning === `${s.class}_${s.section}`
                          ? '⏳ Assigning…'
                          : s.is_assigned ? '↺ Re-assign' : '🔢 Assign'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── View Tab ──────────────────────────────────────────────────
function ViewTab() {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [cls,     setCls]     = useState('');
  const [section, setSection] = useState('A');
  const [mode,    setMode]    = useState('frozen'); // frozen | dynamic
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded,  setLoaded]  = useState(false);

  const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                   'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];

  const load = async () => {
    if (!cls) return;
    setLoading(true);
    const res = mode === 'frozen'
      ? await window.api.getFrozenRollNumbers(cls, section, year)
      : await window.api.getRollNumbersDynamic(cls, section, year);
    setLoading(false);
    setLoaded(true);
    if (res.success) setRows(res.data);
  };

  return (
    <div>
      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select value={cls} onChange={e => { setCls(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <select value={section} onChange={e => { setSection(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={year} onChange={e => { setYear(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white">
              {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {[['frozen','Frozen'],['dynamic','Live']].map(([val, label]) => (
                <button key={val} onClick={() => { setMode(val); setLoaded(false); }}
                  className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors
                    ${mode === val ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3 items-center">
          <button onClick={load} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white px-6 py-2 rounded-lg text-sm font-medium">
            {loading ? '⏳ Loading…' : '🔍 Show Roll Numbers'}
          </button>
          <p className="text-xs text-gray-400">
            {mode === 'frozen'
              ? 'Frozen: roll numbers assigned at year start (fixed)'
              : 'Live: calculated alphabetically right now (changes as students join/leave)'}
          </p>
        </div>
      </div>

      {/* Results */}
      {loaded && rows.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          {mode === 'frozen'
            ? 'No roll numbers assigned yet. Go to Assign tab to assign them.'
            : 'No active students found in this class/section.'}
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">
              {cls} — Section {section} — {year}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">{rows.length} students</span>
              {mode === 'frozen'
                ? <Badge text="Frozen roll numbers" color="blue" />
                : <Badge text="Live / Dynamic" color="amber" />}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                <th className="text-center px-4 py-3 font-medium w-16">Roll No.</th>
                <th className="text-left px-4 py-3 font-medium">Student Name</th>
                <th className="text-left px-4 py-3 font-medium">Admission No.</th>
                <th className="text-center px-4 py-3 font-medium">Gender</th>
                <th className="text-left px-4 py-3 font-medium">Father's Name</th>
                {mode === 'frozen' && <th className="text-center px-4 py-3 font-medium">Type</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.admission_number}
                  className={`border-b border-gray-100 hover:bg-gray-50
                    ${r.is_mid_year ? 'bg-amber-50' : ''}`}>
                  <td className="px-4 py-3 text-center font-bold text-blue-700">
                    {r.roll_number}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-800">{r.student_name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.admission_number}</td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {r.gender === 'M' ? '👦' : r.gender === 'F' ? '👧' : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{r.father_name}</td>
                  {mode === 'frozen' && (
                    <td className="px-4 py-3 text-center">
                      {r.is_mid_year
                        ? <Badge text="Mid-year" color="amber" />
                        : <Badge text="Annual"   color="green" />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
// ── Manual Fix Tab — hand-correct roll numbers ─────────────────
// Built specifically for recovering from an accidental Re-assign with no
// backup: every field is pre-filled with the CURRENT (possibly wrong)
// number, so only the actually-wrong ones need changing, not all 40+
// retyped from scratch.
function ManualFixTab() {
  const [year,     setYear]     = useState(CURRENT_YEAR);
  const [cls,      setCls]      = useState('');
  const [section,  setSection]  = useState('A');
  const [students, setStudents] = useState([]);
  const [values,   setValues]   = useState({});
  const [loading,  setLoading]  = useState(false);
  const [loaded,   setLoaded]   = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [msg,      setMsg]      = useState('');

  const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                   'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];

  const load = async () => {
    if (!cls) return;
    setLoading(true); setError(''); setMsg('');
    const res = await window.api.getByClass(cls, section, year);
    setLoading(false); setLoaded(true);
    if (!res.success) { setError(res.message); setStudents([]); return; }
    setStudents(res.data);
    const initial = {};
    res.data.forEach(s => { initial[s.admission_number] = s.roll_number != null ? String(s.roll_number) : ''; });
    setValues(initial);
  };

  const setValue = (admNo, v) => setValues(prev => ({ ...prev, [admNo]: v }));

  // Live validation, visible before Save is even clickable
  const numberCounts = {};
  Object.values(values).forEach(v => { const n = v.trim(); if (n) numberCounts[n] = (numberCounts[n] || 0) + 1; });
  const hasDuplicates = Object.values(numberCounts).some(c => c > 1);
  const hasBlanks = students.some(s => !(values[s.admission_number] || '').trim());

  const save = async () => {
    setError(''); setMsg('');
    if (hasBlanks) { setError('Every student needs a roll number — fill in any blank fields.'); return; }
    if (hasDuplicates) { setError('Two or more students have the same roll number — every number must be unique.'); return; }
    const assignments = students.map(s => ({ admission_number: s.admission_number, roll_number: Number(values[s.admission_number]) }));
    setSaving(true);
    const res = await window.api.setManualRollNumbers(cls, section, year, assignments, 'admin');
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setMsg(`✅ Saved ${res.count} roll numbers for ${cls} ${section}.`);
    load();
  };

  return (
    <div>
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5 text-sm text-amber-800">
        <p className="font-semibold mb-1">⚠️ Manual correction tool</p>
        <p className="text-xs">
          Use this to fix a class's roll numbers by hand — e.g. after an accidental Re-assign with no backup to restore from.
          Every field starts pre-filled with the current number; change only the ones that are actually wrong.
          Every active student needs a number, and no two can share one.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <select value={cls} onChange={e => { setCls(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <select value={section} onChange={e => { setSection(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={year} onChange={e => { setYear(e.target.value); setLoaded(false); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={load} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-5 py-2 rounded-lg text-sm">
            {loading ? '⏳ Loading…' : '📋 Load Students'}
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}
      {msg   && <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3 mb-4">{msg}</p>}

      {loaded && students.length === 0 && (
        <p className="text-center text-gray-400 py-10 text-sm">No active students found in {cls} {section}.</p>
      )}

      {loaded && students.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{cls} — Section {section} — {students.length} students</span>
            {hasDuplicates && <span className="text-xs text-red-600 font-medium">⚠️ Duplicate roll numbers — fix before saving</span>}
          </div>
          <div className="max-h-[28rem] overflow-y-auto divide-y divide-gray-50">
            {students.map(s => {
              const val = values[s.admission_number] || '';
              const isDup = val.trim() && numberCounts[val.trim()] > 1;
              return (
                <div key={s.admission_number} className={`flex items-center gap-3 px-5 py-2.5 ${isDup ? 'bg-red-50' : ''}`}>
                  <input type="number" min="1" value={val}
                    onChange={e => setValue(s.admission_number, e.target.value)}
                    className={`w-20 border rounded-lg px-2 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500
                      ${isDup ? 'border-red-400 text-red-700' : 'border-gray-300'}`} />
                  <span className="text-sm text-gray-800 font-medium flex-1">{s.student_name}</span>
                  <span className="text-xs font-mono text-gray-400">{s.admission_number}</span>
                </div>
              );
            })}
          </div>
          <div className="px-5 py-4 border-t border-gray-100 flex justify-end">
            <button onClick={save} disabled={saving || hasDuplicates || hasBlanks}
              className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-6 py-2.5 rounded-xl text-sm">
              {saving ? 'Saving…' : '💾 Save Corrected Roll Numbers'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RollNumbers() {
  const [tab, setTab] = useState('assign');

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Roll Numbers</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Assign and manage student roll numbers per class and section
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[['assign','Assign Roll Numbers'],['view','View Roll Numbers'],['manual','Manual Fix']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'assign' && <AssignTab />}
      {tab === 'view'   && <ViewTab />}
      {tab === 'manual' && <ManualFixTab />}
    </div>
  );
}
