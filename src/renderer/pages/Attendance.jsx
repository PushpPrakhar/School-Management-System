import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const CLASSES   = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                   'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];
const SECTIONS  = ['A','B','C','D'];
const MONTHS    = ['01','02','03','04','05','06','07','08','09','10','11','12'];
const MONTH_NAMES = {
  '01':'January','02':'February','03':'March','04':'April','05':'May','06':'June',
  '07':'July','08':'August','09':'September','10':'October','11':'November','12':'December'
};
const CURRENT_SESSION_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1;
})();
const CURRENT_YEAR  = `${CURRENT_SESSION_YEAR}-${String(CURRENT_SESSION_YEAR+1).slice(2)}`;
const ACADEMIC_YEARS = Array.from({ length: 4 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 2 + i;
  return `${y}-${String(y+1).slice(2)}`;
}).reverse();

const todayDDMMYYYY = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
};
const fromInput = v => { if (!v) return ''; const p = v.split('-'); return p.length===3&&p[0].length===4?`${p[2]}-${p[1]}-${p[0]}`:v; };
const toInput   = v => { if (!v) return ''; const p = v.split('-'); return p.length===3&&p[2].length===4?`${p[2]}-${p[1]}-${p[0]}`:v; };

// ── Selector bar ──────────────────────────────────────────────
function SelectorBar({ cls, setCls, section, setSection, academicYear, setAcademicYear, extra }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
        <select value={cls} onChange={e => setCls(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36">
          <option value="">Select</option>
          {CLASSES.map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
        <select value={section} onChange={e => setSection(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-24">
          {SECTIONS.map(s => <option key={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
        <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32">
          {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
      </div>
      {extra}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 1 — Mark Attendance
// ══════════════════════════════════════════════════════════════
function MarkTab() {
  const { user } = useAuth();
  const isTeacher    = user?.role === 'teacher';
  const canUnlock    = ['admin','super_admin','coordinator','manager'].includes(user?.role);

  const [cls,          setCls]          = useState('');
  const [section,      setSection]      = useState('A');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [date,         setDate]         = useState(toInput(todayDDMMYYYY()));
  const [students,     setStudents]     = useState([]);
  const [attendance,   setAttendance]   = useState({});
  const [loaded,       setLoaded]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [locked,       setLocked]       = useState(false);
  const [lockedBy,     setLockedBy]     = useState('');
  const [saved,        setSaved]        = useState(false);
  const [error,        setError]        = useState('');

  const storageDate = fromInput(date);

  const loadStudents = async () => {
    if (!cls || !date) return;
    setLoading(true); setLoaded(false); setError('');

    // Check if locked
    const lockRes = await window.api.attendanceCheckLocked(cls, section, storageDate);
    if (lockRes.success && lockRes.locked) {
      setLocked(true); setLockedBy(lockRes.locked_by);
    } else {
      setLocked(false); setLockedBy('');
    }

    const res = await window.api.attendanceGetStudents(cls, section, academicYear);
    if (!res.success) { setError(res.message); setLoading(false); return; }

    const existing = await window.api.attendanceGetByDate(cls, section, storageDate);
    const existingMap = {};
    if (existing.success) existing.data.forEach(r => { existingMap[r.admission_number] = r.status; });

    const init = {};
    res.data.forEach(s => { init[s.admission_number] = existingMap[s.admission_number] || 'Present'; });

    setStudents(res.data);
    setAttendance(init);
    setLoading(false);
    setLoaded(true);
    setSaved(false);
  };

  const setStatus = (admNo, status) =>
    setAttendance(prev => ({ ...prev, [admNo]: status }));

  const markAll = (status) => {
    const updated = {};
    students.forEach(s => { updated[s.admission_number] = status; });
    setAttendance(updated);
  };

  const save = async () => {
    if (!cls || !date || students.length === 0) return;
    setSaving(true); setError('');
    const records = students.map(s => ({
      admission_number: s.admission_number,
      student_name:     s.student_name,
      status:           attendance[s.admission_number] || 'Present',
    }));
    const res = await window.api.attendanceMarkDay(
      cls, section, storageDate, academicYear, records, user?.username || 'admin'
    );
    if (!res.success) { setError(res.message); setSaving(false); return; }

    // Teachers auto-lock after saving
    if (isTeacher) {
      await window.api.attendanceLockDay(cls, section, storageDate, user?.username);
      setLocked(true);
      setLockedBy(user?.username);
    }
    setSaving(false);
    setSaved(true);
  };

  const unlock = async () => {
    await window.api.attendanceUnlockDay(cls, section, storageDate);
    setLocked(false); setLockedBy(''); setSaved(false);
  };

  const present = students.filter(s => attendance[s.admission_number] === 'Present').length;
  const absent  = students.filter(s => attendance[s.admission_number] === 'Absent').length;
  const isEditable = !locked || canUnlock;

  return (
    <div>
      <SelectorBar cls={cls} setCls={v => { setCls(v); setLoaded(false); }}
        section={section} setSection={v => { setSection(v); setLoaded(false); }}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        extra={
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={date} onChange={e => { setDate(e.target.value); setLoaded(false); }}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        }
      />

      {!loaded && (
        <div className="text-center py-4">
          <button onClick={loadStudents} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
            {loading ? '⏳ Loading…' : '📋 Load Students'}
          </button>
          {!cls && <p className="text-xs text-gray-400 mt-2">Select a class first</p>}
        </div>
      )}

      {loaded && students.length === 0 && (
        <div className="text-center py-12 text-gray-400">No active students in {cls} {section}</div>
      )}

      {loaded && students.length > 0 && (
        <>
          {/* Lock banner */}
          {locked && (
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 mb-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔒</span>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Attendance Locked</p>
                  <p className="text-xs text-amber-600">Submitted by {lockedBy} — editing disabled for teachers</p>
                </div>
              </div>
              {canUnlock && (
                <button onClick={unlock}
                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-medium px-4 py-1.5 rounded-lg">
                  🔓 Unlock
                </button>
              )}
            </div>
          )}

          {/* Summary + quick actions */}
          {!locked && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex gap-3">
                <span className="bg-green-100 text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full">✓ {present} Present</span>
                <span className="bg-red-100 text-red-600 text-xs font-semibold px-3 py-1.5 rounded-full">✗ {absent} Absent</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => markAll('Present')}
                  className="text-xs border border-green-300 text-green-700 hover:bg-green-50 px-3 py-1.5 rounded-lg">
                  All Present
                </button>
                <button onClick={() => markAll('Absent')}
                  className="text-xs border border-red-300 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">
                  All Absent
                </button>
              </div>
            </div>
          )}

          {saved && locked && (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-green-700 text-sm">
              ✅ Attendance saved and locked for {storageDate} — {cls} {section}
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-red-600 text-sm">{error}</div>
          )}

          {/* Student table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
              <h3 className="text-sm font-semibold text-gray-700">
                {cls} {section} — {storageDate} — {students.length} students
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                  <th className="text-center px-3 py-2 font-medium w-12">Roll</th>
                  <th className="text-left px-3 py-2 font-medium w-32">Adm. No.</th>
                  <th className="text-left px-3 py-2 font-medium">Student Name</th>
                  <th className="text-left px-3 py-2 font-medium">Father's Name</th>
                  <th className="text-center px-3 py-2 font-medium w-12">Gender</th>
                  <th className="text-center px-3 py-2 font-medium w-28">Attendance</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s, idx) => {
                  const status = attendance[s.admission_number] || 'Present';
                  return (
                    <tr key={s.admission_number}
                      className={`border-b border-gray-100 ${status === 'Absent' ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-2.5 text-center font-bold text-blue-700 text-xs">
                        {s.roll_number || idx + 1}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-500">{s.admission_number}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-800">{s.student_name}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs">{s.father_name || '—'}</td>
                      <td className="px-3 py-2.5 text-center">{s.gender === 'M' ? '👦' : '👧'}</td>
                      <td className="px-3 py-2.5">
                        {isEditable ? (
                          <div className="flex gap-1 justify-center">
                            {['Present','Absent'].map(st => (
                              <button key={st} onClick={() => setStatus(s.admission_number, st)}
                                className={`w-10 h-7 rounded-lg text-xs font-bold transition-colors
                                  ${status === st
                                    ? st === 'Present' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
                                    : 'bg-gray-100 text-gray-400 hover:bg-gray-200'}`}>
                                {st === 'Present' ? 'P' : 'A'}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex justify-center">
                            <span className={`w-10 h-7 rounded-lg text-xs font-bold flex items-center justify-center
                              ${status === 'Present' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                              {status === 'Present' ? 'P' : 'A'}
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pb-6">
            <button onClick={() => setLoaded(false)}
              className="text-sm text-gray-400 hover:text-gray-600 underline">
              ← Change class / date
            </button>
            {isEditable && (
              <button onClick={save} disabled={saving}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2">
                {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '💾 Save Attendance'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 2 — Monthly Report
// ══════════════════════════════════════════════════════════════
function MonthlyTab() {
  const [cls,          setCls]          = useState('');
  const [section,      setSection]      = useState('A');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [month,        setMonth]        = useState(String(new Date().getMonth()+1).padStart(2,'0'));
  const [year,         setYear]         = useState(String(new Date().getFullYear()));
  const [threshold,    setThreshold]    = useState(75);
  const [summary,      setSummary]      = useState([]);
  const [grid,         setGrid]         = useState([]);
  const [loaded,       setLoaded]       = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [view,         setView]         = useState('summary');

  const load = async () => {
    if (!cls) return;
    setLoading(true);
    const [sumRes, gridRes] = await Promise.all([
      window.api.attendanceGetMonthly(cls, section, month, year, academicYear),
      window.api.attendanceGetDailyGrid(cls, section, month, year, academicYear),
    ]);
    if (sumRes.success) setSummary(sumRes.data);
    if (gridRes.success) setGrid(gridRes.data);
    setLoading(false);
    setLoaded(true);
  };

  const gridData = (() => {
    if (!grid.length) return { students: [], dates: [] };
    const studentMap = {};
    const datesSet   = new Set();
    grid.forEach(r => {
      if (!studentMap[r.admission_number])
        studentMap[r.admission_number] = { name: r.student_name, dates: {} };
      studentMap[r.admission_number].dates[r.date] = r.status;
      datesSet.add(r.date);
    });
    const dates    = Array.from(datesSet).sort();
    const students = Object.entries(studentMap)
      .map(([admNo, v]) => ({ admNo, ...v }))
      .sort((a,b) => a.name.localeCompare(b.name));
    return { students, dates };
  })();

  const below    = summary.filter(s => s.percentage < threshold).length;
  const above    = summary.filter(s => s.percentage >= threshold).length;

  return (
    <div>
      <SelectorBar cls={cls} setCls={v => { setCls(v); setLoaded(false); }}
        section={section} setSection={v => { setSection(v); setLoaded(false); }}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        extra={
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
              <select value={month} onChange={e => { setMonth(e.target.value); setLoaded(false); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36">
                {MONTHS.map(m => <option key={m} value={m}>{MONTH_NAMES[m]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
              <input value={year} onChange={e => { setYear(e.target.value); setLoaded(false); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-24" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Threshold (%)</label>
              <input type="number" min="0" max="100" value={threshold}
                onChange={e => setThreshold(parseInt(e.target.value) || 75)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-20" />
            </div>
          </>
        }
      />

      {!loaded && (
        <div className="text-center py-4">
          <button onClick={load} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
            {loading ? '⏳ Loading…' : '📊 Show Report'}
          </button>
        </div>
      )}

      {loaded && (
        <>
          {/* Stats */}
          {summary.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{summary.length}</p>
                <p className="text-xs text-blue-500 mt-0.5">Total Students</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{above}</p>
                <p className="text-xs text-green-500 mt-0.5">Above {threshold}%</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-red-500">{below}</p>
                <p className="text-xs text-red-400 mt-0.5">Below {threshold}%</p>
              </div>
            </div>
          )}

          {/* View toggle */}
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-4 w-fit">
            {[['summary','Monthly Summary'],['grid','Day-by-Day Grid']].map(([key, label]) => (
              <button key={key} onClick={() => setView(key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${view === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* Summary view */}
          {view === 'summary' && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {MONTH_NAMES[month]} {year} — {cls} {section}
                </h3>
                <span className="text-xs text-gray-400">
                  Students below {threshold}% highlighted in red
                </span>
              </div>
              {summary.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No attendance data for this month.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                      <th className="text-left px-5 py-3 font-medium">Student Name</th>
                      <th className="text-center px-3 py-3 font-medium">Total Days</th>
                      <th className="text-center px-3 py-3 font-medium text-green-600">Present</th>
                      <th className="text-center px-3 py-3 font-medium text-red-500">Absent</th>
                      <th className="text-center px-3 py-3 font-medium">Attendance %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.map(s => (
                      <tr key={s.admission_number}
                        className={`border-b border-gray-100 hover:bg-gray-50 ${s.percentage < threshold ? 'bg-red-50' : ''}`}>
                        <td className="px-5 py-2.5 font-medium text-gray-800">{s.student_name}</td>
                        <td className="px-3 py-2.5 text-center text-gray-600">{s.total_days}</td>
                        <td className="px-3 py-2.5 text-center text-green-600 font-medium">{s.present}</td>
                        <td className="px-3 py-2.5 text-center text-red-500 font-medium">{s.absent}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`font-bold px-2 py-0.5 rounded-full text-xs
                            ${s.percentage < threshold ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                            {s.percentage}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Grid view */}
          {view === 'grid' && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-auto">
              <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
                <h3 className="text-sm font-semibold text-gray-700">
                  Day-by-Day — {MONTH_NAMES[month]} {year} — {cls} {section}
                </h3>
              </div>
              {gridData.dates.length === 0 ? (
                <p className="text-center text-gray-400 py-10">No attendance data for this month.</p>
              ) : (
                <table className="text-xs min-w-max">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="sticky left-0 bg-gray-50 text-left px-4 py-3 font-medium text-gray-500 min-w-44">Student</th>
                      {gridData.dates.map(d => (
                        <th key={d} className="px-2 py-3 font-medium text-gray-500 text-center w-8">
                          {d.slice(0,2)}
                        </th>
                      ))}
                      <th className="px-3 py-3 font-medium text-gray-500 text-center">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridData.students.map(s => {
                      const total    = gridData.dates.length;
                      const attended = gridData.dates.filter(d => s.dates[d] === 'Present').length;
                      const pct      = total ? Math.round((attended/total)*100) : 0;
                      return (
                        <tr key={s.admNo} className={`border-b border-gray-100 ${pct < threshold ? 'bg-red-50' : ''}`}>
                          <td className="sticky left-0 bg-inherit px-4 py-2 font-medium text-gray-800">{s.name}</td>
                          {gridData.dates.map(d => {
                            const st = s.dates[d];
                            return (
                              <td key={d} className="px-1 py-2 text-center">
                                {st ? (
                                  <div className={`w-6 h-6 rounded text-xs font-bold flex items-center justify-center mx-auto
                                    ${st === 'Present' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                    {st === 'Present' ? 'P' : 'A'}
                                  </div>
                                ) : <span className="text-gray-200">—</span>}
                              </td>
                            );
                          })}
                          <td className={`px-3 py-2 text-center font-bold ${pct < threshold ? 'text-red-600' : 'text-green-600'}`}>
                            {pct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <button onClick={() => setLoaded(false)}
            className="mt-4 text-sm text-gray-400 hover:text-gray-600 underline">
            ← Change filters
          </button>
        </>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 3 — Low Attendance Alerts
// ══════════════════════════════════════════════════════════════
function LowAttendanceTab() {
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [threshold,    setThreshold]    = useState(75);
  const [data,         setData]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [loaded,       setLoaded]       = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await window.api.attendanceGetLow(academicYear, threshold);
    if (res.success) setData(res.data);
    setLoading(false);
    setLoaded(true);
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => { setAcademicYear(e.target.value); setLoaded(false); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32">
            {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Below (%)</label>
          <input type="number" value={threshold} min="0" max="100"
            onChange={e => { setThreshold(parseInt(e.target.value) || 75); setLoaded(false); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-20" />
        </div>
        <button onClick={load} disabled={loading}
          className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-medium px-6 py-2 rounded-lg text-sm">
          {loading ? '⏳ Loading…' : '🔍 Find Students'}
        </button>
      </div>

      {loaded && data.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-3">✅</div>
          <p className="font-medium text-gray-700">No students below {threshold}%</p>
          <p className="text-sm text-gray-400 mt-1">All students are above the threshold for {academicYear}</p>
        </div>
      )}

      {loaded && data.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-red-50 border-b border-red-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-red-700">
              ⚠️ {data.length} student{data.length !== 1 ? 's' : ''} below {threshold}% — {academicYear}
            </h3>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                <th className="text-left px-5 py-3 font-medium">Student</th>
                <th className="text-left px-5 py-3 font-medium">Class</th>
                <th className="text-center px-4 py-3 font-medium">Present</th>
                <th className="text-center px-4 py-3 font-medium">Total Days</th>
                <th className="text-center px-4 py-3 font-medium">Attendance %</th>
              </tr>
            </thead>
            <tbody>
              {data.map(s => (
                <tr key={s.admission_number} className="border-b border-gray-100 hover:bg-red-50">
                  <td className="px-5 py-2.5">
                    <p className="font-medium text-gray-800">{s.student_name}</p>
                    <p className="text-xs text-gray-400 font-mono">{s.admission_number}</p>
                  </td>
                  <td className="px-5 py-2.5 text-gray-600">{s.class} {s.section}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{s.attended}</td>
                  <td className="px-4 py-2.5 text-center text-gray-700">{s.total_days}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className="font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full text-xs">
                      {s.percentage}%
                    </span>
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

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function Attendance() {
  const [tab, setTab] = useState('mark');
  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Attendance</h2>
        <p className="text-sm text-gray-500 mt-0.5">Daily attendance — P Present · A Absent</p>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[['mark','Mark Attendance'],['monthly','Monthly Report'],['low','Low Attendance']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'mark'    && <MarkTab />}
      {tab === 'monthly' && <MonthlyTab />}
      {tab === 'low'     && <LowAttendanceTab />}
    </div>
  );
}
