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

// Day type config for attendance display
const DAY_STATUS = {
  SUNDAY:   { icon: '📅', label: 'Sunday',     bg: 'bg-gray-100',   text: 'text-gray-600',  border: 'border-gray-200'  },
  HOLIDAY:  { icon: '🎉', label: 'Holiday',    bg: 'bg-red-50',     text: 'text-red-700',   border: 'border-red-200'   },
  VACATION: { icon: '🏖️', label: 'Vacation',   bg: 'bg-amber-50',   text: 'text-amber-700', border: 'border-amber-200' },
  HALF_DAY: { icon: '⏰', label: 'Half Day',   bg: 'bg-blue-50',    text: 'text-blue-700',  border: 'border-blue-200'  },
  WORKING:  { icon: '✅', label: 'Working Day', bg: 'bg-green-50',  text: 'text-green-700', border: 'border-green-200' },
};

// Check if a DD-MM-YYYY date is a Sunday
const isSundayDate = (ddmmyyyy) => {
  if (!ddmmyyyy) return false;
  const [d, m, y] = ddmmyyyy.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
};


// ── Student Monthly Mark (Admin/Principal only) ───────────────
const DAY_NAMES_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_LABELS = {
  '01':'January','02':'February','03':'March','04':'April','05':'May','06':'June',
  '07':'July','08':'August','09':'September','10':'October','11':'November','12':'December'
};

function StudentMonthlyMark({ academicYear, filterClass, filterSection, onClose }) {
  const { user } = useAuth();

  // Phase: 'search' | 'calendar'
  const [phase,      setPhase]      = useState('search');
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [student,    setStudent]    = useState(null);
  const [month,      setMonth]      = useState(String(new Date().getMonth()+1).padStart(2,'0'));
  const [year,       setYear]       = useState(String(new Date().getFullYear()));
  const [dayStatus,  setDayStatus]  = useState({});
  const [holidays,   setHolidays]   = useState({});
  const [locks,      setLocks]      = useState(new Set());
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saveResult, setSaveResult] = useState(null);
  const [error,      setError]      = useState('');

  // Live search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      // Search within selected class if filter active, else all active students
      const res = await window.api.attendanceSearchStudent(query, filterClass || null, filterClass ? filterSection : null);
      if (res.success) setResults(res.data.slice(0, 8));
    }, 280);
    return () => clearTimeout(t);
  }, [query]);

  const loadMonth = async (s, mon, yr) => {
    setLoading(true); setError('');
    const [attRes, holRes, lockRes] = await Promise.all([
      window.api.attendanceGetStudentMonth(s.admission_number, mon, yr, academicYear),
      window.api.calendarGetMonth(academicYear, mon, yr),
      window.api.attendanceGetLockedDates(s.current_class, s.section, mon, yr),
    ]);
    const status = {};
    if (attRes.success) attRes.data.forEach(r => { status[r.date] = r.status; });
    setDayStatus(status);
    const hols = {};
    if (holRes.success) holRes.data.forEach(r => { if (r.day_type !== 'WORKING') hols[r.date] = r; });
    setHolidays(hols);
    const ls = new Set();
    if (lockRes.success) lockRes.data.forEach(r => ls.add(r.date));
    setLocks(ls);
    setLoading(false);
  };

  const selectStudent = async (s) => {
    setStudent(s); setQuery(''); setResults([]);
    setSaveResult(null); setPhase('calendar');
    await loadMonth(s, month, year);
  };

  const navigate = async (dir) => {
    let m = parseInt(month) + dir, y = parseInt(year);
    if (m > 12) { m = 1; y++; }
    if (m < 1)  { m = 12; y--; }
    const nm = String(m).padStart(2,'0'), ny = String(y);
    setMonth(nm); setYear(ny); setSaveResult(null);
    if (student) await loadMonth(student, nm, ny);
  };

  const toggle = (date) => {
    setDayStatus(prev => {
      const cur = prev[date];
      return { ...prev, [date]: cur === 'Present' ? 'Absent' : cur === 'Absent' ? undefined : 'Present' };
    });
    setSaveResult(null);
  };

  const markAll = (status) => {
    const next = {};
    buildDays().forEach(d => {
      if (!d.isSunday && !holidays[d.date]) next[d.date] = status;
    });
    setDayStatus(next); setSaveResult(null);
  };

  const buildDays = () => {
    const count = new Date(parseInt(year), parseInt(month), 0).getDate();
    return Array.from({ length: count }, (_, i) => {
      const d = i + 1;
      const dt = new Date(parseInt(year), parseInt(month)-1, d);
      const date = `${String(d).padStart(2,'0')}-${month}-${year}`;
      return { d, date, dt, isSunday: dt.getDay() === 0, dow: dt.getDay() };
    });
  };

  const save = async () => {
    if (!student) return;
    setSaving(true); setError('');
    const records = buildDays()
      .filter(d => !d.isSunday && !holidays[d.date])
      .map(d => ({ date: d.date, status: dayStatus[d.date] || null }));
    const res = await window.api.attendanceSaveStudentMonth(
      student.admission_number, student.student_name,
      student.current_class, student.section,
      academicYear, records, user?.username || 'admin'
    );
    setSaving(false);
    if (res.success) {
      const p = records.filter(r => r.status==='Present').length;
      const a = records.filter(r => r.status==='Absent').length;
      setSaveResult({ p, a });
    } else setError(res.message);
  };

  const days     = buildDays();
  const firstDow = days[0]?.dow || 0;
  const presentCount = Object.values(dayStatus).filter(v => v==='Present').length;
  const absentCount  = Object.values(dayStatus).filter(v => v==='Absent').length;
  const workingDays  = days.filter(d => !d.isSunday && !holidays[d.date]).length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden"
           style={{ maxHeight: '92vh' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            {phase === 'calendar' && (
              <button onClick={() => { setPhase('search'); setStudent(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 text-lg">
                ←
              </button>
            )}
            <div>
              <h3 className="font-bold text-gray-800">
                {phase === 'search' ? 'Find Student' : student?.student_name}
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {phase === 'search'
                  ? (filterClass
                    ? `Searching in ${filterClass} Section ${filterSection}`
                    : 'Search by name or admission number')
                  : `${student?.admission_number} · ${student?.current_class} ${student?.section}`}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 text-xl leading-none">
            ×
          </button>
        </div>

        {/* ── Search Phase ── */}
        {phase === 'search' && (
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="relative mb-6">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <span className="text-gray-400 text-lg">🔍</span>
              </div>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
                placeholder={filterClass ? `Search in ${filterClass} Section ${filterSection}...` : "Type student name or BPS number..."}
                className="w-full border-2 border-gray-200 focus:border-blue-500 rounded-2xl pl-12 pr-4 py-3.5 text-sm focus:outline-none transition-colors" />
            </div>

            {query && results.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                <p className="text-3xl mb-2">🔍</p>
                <p className="text-sm">No students found for "{query}"</p>
              </div>
            )}

            {results.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                </p>
                {results.map(s => (
                  <button key={s.admission_number} onClick={() => selectStudent(s)}
                    className="w-full flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-300 hover:bg-blue-50 transition-all text-left group">
                    <div className="w-11 h-11 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-lg shrink-0">
                      {s.student_name[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 group-hover:text-blue-700">{s.student_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{s.admission_number} · {s.current_class} Section {s.section}</p>
                    </div>
                    <span className="text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium">
                      Select →
                    </span>
                  </button>
                ))}
              </div>
            )}

            {!query && (
              <div className="text-center py-12 text-gray-300">
                <p className="text-5xl mb-3">👤</p>
                <p className="text-sm text-gray-400">Start typing to search students</p>
              </div>
            )}
          </div>
        )}

        {/* ── Calendar Phase ── */}
        {phase === 'calendar' && (
          <>
            <div className="flex-1 overflow-y-auto px-5 py-4">

              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button onClick={() => navigate(-1)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 font-bold">
                  ‹
                </button>
                <div className="text-center">
                  <p className="font-bold text-gray-800 text-lg">{MONTH_LABELS[month]} {year}</p>
                  <p className="text-xs text-gray-400">{workingDays} working days this month</p>
                </div>
                <button onClick={() => navigate(1)}
                  className="w-9 h-9 flex items-center justify-center rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-600 font-bold">
                  ›
                </button>
              </div>

              {/* Bulk actions */}
              <div className="flex gap-2 mb-4">
                <button onClick={() => markAll('Present')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border-2 border-green-200 text-green-700 hover:bg-green-50 transition-colors">
                  ✓ Mark All Present
                </button>
                <button onClick={() => markAll('Absent')}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                  ✗ Mark All Absent
                </button>
              </div>

              {loading ? (
                <div className="text-center py-12 text-gray-400">
                  <div className="text-2xl animate-spin mb-2">⏳</div>
                  <p className="text-sm">Loading attendance...</p>
                </div>
              ) : (
                <>
                  {/* Day headers */}
                  <div className="grid grid-cols-7 mb-1">
                    {DAY_NAMES_SHORT.map(d => (
                      <div key={d} className={`text-center text-xs font-bold py-1.5
                        ${d==='Sun' ? 'text-gray-300' : 'text-gray-500'}`}>
                        {d}
                      </div>
                    ))}
                  </div>

                  {/* Calendar grid */}
                  <div className="grid grid-cols-7 gap-1">
                    {Array.from({ length: firstDow }).map((_,i) => <div key={`e${i}`}/>)}
                    {days.map(day => {
                      const hol    = holidays[day.date];
                      const locked = locks.has(day.date);
                      const status = dayStatus[day.date];

                      if (day.isSunday) return (
                        <div key={day.date} className="rounded-xl py-2.5 text-center bg-gray-50">
                          <p className="text-xs font-bold text-gray-300">{day.d}</p>
                        </div>
                      );

                      if (hol) return (
                        <div key={day.date} className="rounded-xl py-2 px-1 bg-amber-50 border border-amber-100 text-center">
                          <p className="text-xs font-bold text-amber-600">{day.d}</p>
                          <p className="text-xs text-amber-400 leading-tight mt-0.5 truncate">
                            {(hol.event_name||'Holiday').slice(0,6)}
                          </p>
                        </div>
                      );

                      return (
                        <button key={day.date} onClick={() => toggle(day.date)}
                          className={`relative rounded-xl py-2.5 text-center transition-all active:scale-95
                            ${status === 'Present'
                              ? 'bg-emerald-500 shadow-sm shadow-emerald-200'
                              : status === 'Absent'
                              ? 'bg-rose-500 shadow-sm shadow-rose-200'
                              : 'bg-white border-2 border-gray-100 hover:border-blue-300'}
                            ${locked ? 'ring-2 ring-orange-400 ring-offset-1' : ''}
                          `}>
                          <p className={`text-sm font-bold
                            ${status ? 'text-white' : 'text-gray-700'}`}>
                            {day.d}
                          </p>
                          {status && (
                            <p className="text-xs font-bold text-white opacity-90">
                              {status === 'Present' ? 'P' : 'A'}
                            </p>
                          )}
                          {locked && (
                            <span className="absolute top-0.5 right-0.5 text-xs">🔒</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {/* Legend */}
                  <div className="flex gap-4 mt-4 flex-wrap">
                    {[
                      ['bg-emerald-500','P — Present'],
                      ['bg-rose-500','A — Absent'],
                      ['bg-gray-100','Sunday'],
                      ['bg-amber-100','Holiday'],
                    ].map(([bg, label]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <div className={`w-4 h-4 rounded ${bg}`}/>
                        <span className="text-xs text-gray-400">{label}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ── Footer with live stats + save ── */}
            <div className="shrink-0 border-t border-gray-100 px-5 py-4">
              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>{presentCount + absentCount} of {workingDays} days marked</span>
                  <span>{workingDays - presentCount - absentCount} remaining</span>
                </div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="bg-emerald-500 transition-all"
                       style={{ width: `${workingDays ? (presentCount/workingDays)*100 : 0}%` }}/>
                  <div className="bg-rose-400 transition-all"
                       style={{ width: `${workingDays ? (absentCount/workingDays)*100 : 0}%` }}/>
                </div>
              </div>

              {/* Stats + button */}
              <div className="flex items-center gap-3">
                <div className="flex gap-3 flex-1">
                  <div className="text-center">
                    <p className="text-lg font-bold text-emerald-600">{presentCount}</p>
                    <p className="text-xs text-gray-400">Present</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-rose-500">{absentCount}</p>
                    <p className="text-xs text-gray-400">Absent</p>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-gray-400">{workingDays - presentCount - absentCount}</p>
                    <p className="text-xs text-gray-400">Unmarked</p>
                  </div>
                </div>
                <button onClick={save} disabled={saving || !student}
                  className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-semibold rounded-xl text-sm transition-colors">
                  {saving ? '⏳ Saving...' : 'Save Changes'}
                </button>
              </div>

              {/* Save result */}
              {saveResult && (
                <div className="mt-3 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-xs text-green-700 text-center">
                  ✅ Saved — <strong>{saveResult.p} Present</strong> and <strong>{saveResult.a} Absent</strong> recorded for {MONTH_LABELS[month]}
                </div>
              )}
              {error && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-xs text-red-600 text-center">
                  {error}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TAB 1 — Mark Attendance
// ══════════════════════════════════════════════════════════════
function MarkTab() {
  const { user } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const canUnlock = ['admin','super_admin','coordinator','manager'].includes(user?.role);

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
  const [isDirty,      setIsDirty]      = useState(false);
  const [savedSnapshot,setSavedSnapshot]= useState(null); // snapshot of last saved attendance
  const [showFindStudent, setShowFindStudent] = useState(false);
  const [dayInfo,      setDayInfo]      = useState(null); // { type, name, applies_to }

  const storageDate = fromInput(date);

  // Check calendar whenever date or academic year changes
  useEffect(() => {
    if (!date) return;
    const ddmmyyyy = fromInput(date);
    if (!ddmmyyyy) return;

    // Sunday check first (no DB call needed)
    if (isSundayDate(ddmmyyyy)) {
      setDayInfo({ type: 'SUNDAY', name: 'Sunday', applies_to: 'ALL' });
      setLoaded(false);
      return;
    }

    // Check academic calendar
    const [d, m, y] = ddmmyyyy.split('-');
    window.api.calendarGetMonth(academicYear, m, y).then(res => {
      if (res.success) {
        const entry = res.data.find(r => r.date === ddmmyyyy);
        if (entry && entry.day_type !== 'WORKING') {
          setDayInfo({ type: entry.day_type, name: entry.event_name, applies_to: entry.applies_to });
          setLoaded(false);
        } else {
          setDayInfo(null); // Working day
        }
      }
    });
  }, [date, academicYear]);

  const loadStudents = async () => {
    if (!cls || !date) return;
    setLoading(true); setLoaded(false); setError('');

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
    setSavedSnapshot({ ...init }); // treat loaded data as the baseline
    setLoading(false);
    setLoaded(true);
    setSaved(false);
    setIsDirty(false);
  };

  const setStatus = (admNo, status) => {
    setAttendance(prev => ({ ...prev, [admNo]: status }));
    setIsDirty(true);
  };

  const markAll = (status) => {
    const updated = {};
    students.forEach(s => { updated[s.admission_number] = status; });
    setAttendance(updated);
    setIsDirty(true);
  };

  const save = async () => {
    if (!cls || !date || students.length === 0) return;
    // Check if anything changed since last save
    if (savedSnapshot) {
      const changed = Object.keys(attendance).some(k => attendance[k] !== savedSnapshot[k]);
      if (!changed) {
        setError('No changes detected — attendance is already saved for this date.');
        return;
      }
    }
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
    setSavedSnapshot({ ...attendance });
    setIsDirty(false);
  };

  const unlock = async () => {
    await window.api.attendanceUnlockDay(cls, section, storageDate);
    setLocked(false); setLockedBy(''); setSaved(false);
  };

  const present = students.filter(s => attendance[s.admission_number] === 'Present').length;
  const absent  = students.filter(s => attendance[s.admission_number] === 'Absent').length;
  const isEditable = !locked || canUnlock;

  const isNonWorkingDay = dayInfo && dayInfo.type !== 'WORKING';
  const dayStatus = dayInfo ? DAY_STATUS[dayInfo.type] : null;

  return (
    <div>
      <SelectorBar cls={cls} setCls={v => { setCls(v); setLoaded(false); setIsDirty(false); }}
        section={section} setSection={v => { setSection(v); setLoaded(false); setIsDirty(false); }}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        extra={
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
              <input type="date" value={date}
                onChange={e => { setDate(e.target.value); setLoaded(false); setDayInfo(null); setIsDirty(false); }}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {['super_admin','admin'].includes(user?.role) && (
              <div className="flex items-end">
                <button onClick={() => setShowFindStudent(true)}
                  className="flex items-center gap-2 border border-blue-300 text-blue-700 hover:bg-blue-50 bg-white font-medium px-4 py-2 rounded-lg text-sm transition-colors">
                  🔍 Find Student
                </button>
              </div>
            )}
          </>
        }
      />

      {/* Holiday / Non-working day banner */}
      {isNonWorkingDay && (
        <div className={`flex items-center gap-4 ${dayStatus.bg} ${dayStatus.border} border rounded-2xl px-6 py-5 mb-4`}>
          <div className="text-4xl">{dayStatus.icon}</div>
          <div className="flex-1">
            <p className={`text-lg font-bold ${dayStatus.text}`}>
              {dayStatus.label}
              {dayInfo.name ? ` — ${dayInfo.name}` : ''}
            </p>
            <p className={`text-sm mt-0.5 ${dayStatus.text} opacity-80`}>
              {dayInfo.type === 'SUNDAY'
                ? 'This is a Sunday — no attendance required.'
                : dayInfo.applies_to === 'STUDENTS_ONLY'
                  ? 'Holiday for students only — staff are working. No attendance to mark.'
                  : 'This day is marked as a non-working day in the Academic Calendar. Attendance is not required.'}
            </p>
          </div>
          {dayInfo.type !== 'SUNDAY' && (
            <div className="text-right text-xs opacity-60">
              <p className={dayStatus.text}>Set by Principal</p>
              <p className={dayStatus.text}>in Academic Calendar</p>
            </div>
          )}
        </div>
      )}

      {/* Teacher class notice */}
      {isTeacher && !isNonWorkingDay && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 mb-4 text-sm text-blue-700">
          📌 You are marking attendance for your assigned class. Class assignment will be configured by the principal.
        </div>
      )}

      {!loaded && !isNonWorkingDay && (
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

      {showFindStudent && (
        <StudentMonthlyMark
          academicYear={academicYear}
          filterClass={cls}
          filterSection={section}
          onClose={() => setShowFindStudent(false)}
        />
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
          {loaded && (
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  👥 {students.length} Total
                </span>
                <span className="bg-green-100 text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  ✓ {present} Present
                </span>
                <span className="bg-red-100 text-red-600 text-xs font-semibold px-3 py-1.5 rounded-full">
                  ✗ {absent} Absent
                </span>
              </div>
              <div className="flex gap-2">
                {!locked && (<>
                  <button onClick={() => markAll('Present')}
                    className="text-xs border border-green-300 text-green-700 hover:bg-green-50 px-3 py-1.5 rounded-lg">
                    All Present
                  </button>
                  <button onClick={() => markAll('Absent')}
                    className="text-xs border border-red-300 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">
                    All Absent
                  </button>
                </>)}
              </div>
            </div>
          )}

          {saved && (
            <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                <div className="bg-green-600 px-6 py-5 text-center">
                  <div className="text-4xl mb-2">✅</div>
                  <h3 className="text-white font-bold text-lg">Attendance Saved!</h3>
                </div>
                <div className="px-6 py-4 space-y-2 text-sm text-gray-700">
                  <div className="flex justify-between"><span className="text-gray-500">Class</span><span className="font-semibold">{cls} — Section {section}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-semibold">{storageDate}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Students</span><span className="font-semibold">{students.length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Present</span><span className="font-semibold text-green-600">{Object.values(attendance).filter(v => v === 'Present').length}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Absent</span><span className="font-semibold text-red-500">{Object.values(attendance).filter(v => v === 'Absent').length}</span></div>
                  {locked && <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 text-center">🔒 Marks locked for teachers</p>}
                </div>
                <div className="px-6 pb-5">
                  <button onClick={() => {
                    setSaved(false);
                    setLoaded(false);
                    setStudents([]);
                    setAttendance({});
                    setIsDirty(false);
                  }}
                    className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-xl text-sm">
                    Okay
                  </button>
                </div>
              </div>
            </div>
          )}
          {isDirty && loaded && !saved && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
              <span className="text-amber-500 text-lg">⚠️</span>
              <div className="flex-1">
                <p className="text-amber-700 font-semibold text-sm">Attendance Not Submitted</p>
                <p className="text-amber-600 text-xs">You have unsaved changes. Please submit before navigating away.</p>
              </div>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-red-600 text-sm">{error}</div>
          )}

          {/* Student table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">

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
                      <td className="px-3 py-2.5 text-center text-xs font-medium text-gray-600">{s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : s.gender || '—'}</td>
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
  const [threshold,    setThreshold]    = useState('75'); // stored as string to allow backspace clearing
  const [grid,         setGrid]         = useState([]);
  const [loaded,       setLoaded]       = useState(false);
  const [loading,      setLoading]      = useState(false);

  const [progressive, setProgressive] = useState({ map: {}, total_days: 0 });

  const load = async () => {
    if (!cls) return;
    setLoading(true);

    const [gridRes, progRes] = await Promise.all([
      window.api.attendanceGetDailyGrid(cls, section, month, year, academicYear),
      window.api.attendanceGetProgressive(cls, section, academicYear, month, year),
    ]);

    if (gridRes.success) setGrid(gridRes.data);
    if (progRes.success) {
      const progMap = {};
      progRes.data.forEach(r => { progMap[r.admission_number] = { present: r.total_present, total: r.total_days }; });
      setProgressive({ map: progMap, total_days: progRes.total_days });
    }

    setLoading(false);
    setLoaded(true);
  };

  // Build merged data structure
  const tableData = (() => {
    if (!grid.length) return { students: [], dates: [] };
    const studentMap = {};
    const datesSet   = new Set();
    grid.forEach(r => {
      if (!studentMap[r.admission_number]) {
        studentMap[r.admission_number] = {
          name:        r.student_name,
          roll_number: r.roll_number,
          dates:       {},
        };
      }
      studentMap[r.admission_number].dates[r.date] = r.status;
      datesSet.add(r.date);
    });
    const dates    = Array.from(datesSet).sort();
    const students = Object.entries(studentMap)
      .map(([admNo, v]) => {
        const present  = dates.filter(d => v.dates[d] === 'Present').length;
        const total    = dates.filter(d => v.dates[d]).length;
        const absent   = total - present;
        const pct      = total ? Math.round((present / total) * 100) : 0;
        return { admNo, ...v, present, total, absent, pct };
      })
      .sort((a,b) => {
        if (a.roll_number !== 999 && b.roll_number !== 999) return a.roll_number - b.roll_number;
        return a.name.localeCompare(b.name);
      });
    return { students, dates };
  })();

  const thresholdNum = parseInt(threshold) || 75;

  const getProgPct = (admNo) => {
    const prog = progressive.map[admNo];
    const pp = prog?.present ?? 0;
    const pt = progressive.total_days || 0;
    return pt ? Math.round((pp / pt) * 100) : 0;
  };

  const below = tableData.students.filter(s => getProgPct(s.admNo) < thresholdNum).length;
  const above = tableData.students.filter(s => getProgPct(s.admNo) >= thresholdNum).length;

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
                onChange={e => {
                  const val = e.target.value;
                  if (val === '') { setThreshold(''); return; }
                  const num = parseInt(val);
                  if (!isNaN(num)) setThreshold(String(Math.min(100, Math.max(0, num))));
                }}
                onBlur={e => { if (e.target.value === '' || isNaN(parseInt(e.target.value))) setThreshold('75'); }}
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
          {tableData.students.length > 0 && (
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-blue-700">{tableData.students.length}</p>
                <p className="text-xs text-blue-500 mt-0.5">Total Students</p>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{above}</p>
                <p className="text-xs text-green-500 mt-0.5">Above {thresholdNum}%</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-center">
                <p className="text-2xl font-bold text-red-500">{below}</p>
                <p className="text-xs text-red-400 mt-0.5">Below {thresholdNum}%</p>
              </div>
            </div>
          )}

          {tableData.dates.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
              No attendance data for {MONTH_NAMES[month]} {year}.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="bg-blue-700 px-5 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white font-bold">{cls} — Section {section}</p>
                  <p className="text-blue-200 text-xs">{MONTH_NAMES[month]} {year} · {tableData.dates.length} days marked</p>
                </div>
                <span className="text-blue-200 text-xs">Students below {thresholdNum}% highlighted in red</span>
              </div>

              <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                <table className="text-xs border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-gray-50 border-b-2 border-gray-200">
                      {/* Sticky columns */}
                      <th className="sticky left-0 z-30 bg-gray-50 text-left px-3 py-3 font-semibold text-gray-600 border-r border-gray-200 w-10">#</th>
                      <th className="sticky left-10 z-30 bg-gray-50 text-left px-3 py-3 font-semibold text-gray-600 border-r border-gray-200 min-w-36">Name</th>
                      {/* Day columns */}
                      {tableData.dates.map(d => (
                        <th key={d} className="px-1.5 py-3 font-medium text-gray-500 text-center w-7 border-r border-gray-100">
                          {d.slice(0,2)}
                        </th>
                      ))}
                      {/* Summary columns */}
                      <th className="px-3 py-3 font-semibold text-green-700 text-center bg-green-50 border-l-2 border-green-200 min-w-16">Attended</th>
                      <th className="px-3 py-3 font-semibold text-red-600 text-center bg-red-50 min-w-16">Absent</th>
                      <th className="px-3 py-3 font-semibold text-gray-600 text-center bg-gray-50 min-w-16">Total</th>
                      <th className="px-3 py-3 font-semibold text-purple-700 text-center bg-purple-50 min-w-28 border-l-2 border-purple-200">
                        Progressive
                        <span className="block text-purple-400 font-normal text-xs">Attended / Total</span>
                      </th>
                      <th className="px-3 py-3 font-semibold text-blue-700 text-center bg-blue-50 min-w-16">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.students.map((s, idx) => (
                      <tr key={s.admNo}
                        className={`border-b border-gray-100 ${getProgPct(s.admNo) < thresholdNum ? 'bg-red-50' : idx%2===0 ? 'bg-white' : 'bg-gray-50'}`}>
                        {/* Roll number */}
                        <td className="sticky left-0 z-10 bg-inherit px-3 py-2.5 font-bold text-blue-700 border-r border-gray-200 text-center">
                          {s.roll_number === 999 ? idx+1 : s.roll_number}
                        </td>
                        {/* Name */}
                        <td className="sticky left-10 z-10 bg-inherit px-3 py-2.5 font-medium text-gray-800 border-r border-gray-200 whitespace-nowrap">
                          {s.name}
                        </td>
                        {/* Day cells */}
                        {tableData.dates.map(d => {
                          const st = s.dates[d];
                          return (
                            <td key={d} className="px-1 py-2 text-center border-r border-gray-100">
                              {st ? (
                                <div className={`w-5 h-5 rounded text-xs font-bold flex items-center justify-center mx-auto
                                  ${st === 'Present' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                                  {st === 'Present' ? 'P' : 'A'}
                                </div>
                              ) : <span className="text-gray-200">·</span>}
                            </td>
                          );
                        })}
                        {/* Summary */}
                        <td className="px-3 py-2.5 text-center bg-green-50 border-l-2 border-green-200 font-bold text-green-700">
                          {s.present}
                        </td>
                        <td className="px-3 py-2.5 text-center text-red-500 font-medium bg-red-50">{s.absent}</td>
                        <td className="px-3 py-2.5 text-center text-gray-600 font-medium bg-gray-50">{s.total}</td>
                        <td className="px-3 py-2.5 text-center bg-purple-50 border-l-2 border-purple-200">
                          {(() => {
                            const prog = progressive.map[s.admNo];
                            const progPresent = prog?.present ?? s.present;
                            const progTotal   = progressive.total_days || s.total;
                            return (
                              <span className="font-bold text-purple-700">{progPresent}</span>
                            );
                          })()}
                          <span className="text-gray-400 text-xs"> / {progressive.total_days || s.total}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center bg-blue-50">
                          {(() => {
                            const prog = progressive.map[s.admNo];
                            const progPresent = prog?.present ?? s.present;
                            const progTotal   = progressive.total_days || s.total;
                            const progPct     = progTotal ? Math.round((progPresent / progTotal) * 100) : 0;
                            return (
                              <span className={`font-bold px-2 py-0.5 rounded-full text-xs
                                ${progPct < thresholdNum ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                                {progPct}%
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button onClick={() => setLoaded(false)}
            className="mt-3 text-xs text-gray-400 hover:text-gray-600 underline">
            ← Change Filters
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
  const [threshold,    setThreshold]    = useState('75'); // stored as string to allow backspace clearing
  const [data,         setData]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [loaded,       setLoaded]       = useState(false);
  const thresholdNum = parseInt(threshold) || 75;

  const load = async () => {
    setLoading(true);
    // Parse to number — passing string to SQLite causes type comparison bugs
    const res = await window.api.attendanceGetLow(academicYear, parseInt(threshold) || 75);
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
          <p className="font-medium text-gray-700">No students below {thresholdNum}%</p>
          <p className="text-sm text-gray-400 mt-1">All students are above the threshold for {academicYear}</p>
        </div>
      )}

      {loaded && data.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="bg-red-50 border-b border-red-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-red-700">
              ⚠️ {data.length} student{data.length !== 1 ? 's' : ''} below {thresholdNum}% — {academicYear}
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
