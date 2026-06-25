import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

// ── Constants ─────────────────────────────────────────────────
const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth()>=3?y:y-1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR+1).slice(2)}`;
const YEARS = Array.from({length:4},(_,i)=>{const y=SESSION_YEAR-1+i;return`${y}-${String(y+1).slice(2)}`;});
const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7','Class 8'];
const SECTIONS = ['A','B','C','D'];

const SUBJECTS = {
  Nursery: ['Hindi','English','Mathematics','Drawing'],
  LKG:     ['Hindi','English','Mathematics','Drawing'],
  UKG:     ['Hindi','English','EVS','Mathematics','Computer','Drawing'],
};
['Class 1','Class 2','Class 3','Class 4','Class 5'].forEach(c => {
  SUBJECTS[c] = ['Hindi','English','Mathematics','Science/EVS','General Knowledge','Computer','Drawing'];
});
['Class 6','Class 7','Class 8'].forEach(c => {
  SUBJECTS[c] = ['Hindi','English','Mathematics','Science','SST','General Knowledge','Computer','Drawing'];
});

const EXAM_TYPES = {
  UT1:         { label:'Unit Test 1',  short:'UT1', max:10,  stage:'half_yearly', order:1 },
  UT2:         { label:'Unit Test 2',  short:'UT2', max:10,  stage:'half_yearly', order:2 },
  HALF_YEARLY: { label:'Half Yearly',  short:'H/Y', max:80,  stage:'half_yearly', order:3 },
  UT3:         { label:'Unit Test 3',  short:'UT3', max:10,  stage:'final',       order:4 },
  UT4:         { label:'Unit Test 4',  short:'UT4', max:10,  stage:'final',       order:5 },
  FINAL:       { label:'Final Exam',   short:'FIN', max:80,  stage:'final',       order:6 },
};
const HY_TYPES    = ['UT1','UT2','HALF_YEARLY'];
const FINAL_TYPES = ['UT1','UT2','HALF_YEARLY','UT3','UT4','FINAL'];

const getGrade = (pct) => {
  if (pct >= 85) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 55) return 'C';
  if (pct >= 40) return 'D';
  if (pct >= 33) return 'E';
  return 'F';
};
const GRADE_STYLE = {
  A:'bg-green-100 text-green-800', B:'bg-blue-100 text-blue-800',
  C:'bg-yellow-100 text-yellow-700', D:'bg-orange-100 text-orange-700',
  E:'bg-red-100 text-red-600', F:'bg-red-200 text-red-800 font-bold',
};

// Build marks map: { [admNo]: { [subject]: { [examType]: { marks, absent } } } }
const buildMarksMap = (rawMarks) => {
  const map = {};
  rawMarks.forEach(r => {
    if (!map[r.admission_number]) map[r.admission_number] = {};
    if (!map[r.admission_number][r.subject]) map[r.admission_number][r.subject] = {};
    map[r.admission_number][r.subject][r.exam_type] = {
      marks: r.marks_obtained, absent: !!r.is_absent,
    };
  });
  return map;
};

// Calculate half yearly result per student
const calcHY = (admNo, subjects, marksMap) => {
  const sm = marksMap[admNo] || {};
  let total = 0;
  const subjects_result = {};
  let allPass = true;

  subjects.forEach(sub => {
    const s = sm[sub] || {};
    const ut1 = s.UT1?.absent ? 'AB' : (s.UT1?.marks ?? null);
    const ut2 = s.UT2?.absent ? 'AB' : (s.UT2?.marks ?? null);
    const hy  = s.HALF_YEARLY?.absent ? 'AB' : (s.HALF_YEARLY?.marks ?? null);
    const subTotal = (ut1==='AB'?0:(ut1??0)) + (ut2==='AB'?0:(ut2??0)) + (hy==='AB'?0:(hy??0));
    const pct = subTotal; // already /100
    if (pct < 33) allPass = false;
    subjects_result[sub] = { ut1, ut2, hy, total: subTotal, grade: getGrade(pct), pass: pct >= 33 };
    total += subTotal;
  });

  const maxTotal = subjects.length * 100;
  const pct = (total / maxTotal * 100);
  return { subjects_result, total, maxTotal, pct: pct.toFixed(1), grade: getGrade(pct), allPass };
};

// Calculate final result per student (scaled to 100)
const calcFinal = (admNo, subjects, marksMap) => {
  const sm = marksMap[admNo] || {};
  let total = 0;
  const subjects_result = {};
  let allPass = true;

  subjects.forEach(sub => {
    const s = sm[sub] || {};
    const get = (t) => s[t]?.absent ? 'AB' : (s[t]?.marks ?? null);
    const vals = { UT1:get('UT1'), UT2:get('UT2'), HY:get('HALF_YEARLY'), UT3:get('UT3'), UT4:get('UT4'), FIN:get('FINAL') };
    const raw = Object.values(vals).reduce((a,v) => a + (v==='AB'?0:(v??0)), 0); // out of 200
    const scaled = raw / 2; // out of 100
    const pct = scaled;
    if (pct < 33) allPass = false;
    subjects_result[sub] = { ...vals, scaled: scaled.toFixed(1), grade: getGrade(pct), pass: pct >= 33 };
    total += scaled;
  });

  const maxTotal = subjects.length * 100;
  const pct = (total / maxTotal * 100);
  return { subjects_result, total: total.toFixed(1), maxTotal, pct: pct.toFixed(1), grade: getGrade(pct), allPass };
};

// ── Selector Bar ──────────────────────────────────────────────
function SelectorBar({ cls, setCls, section, setSection, academicYear, setAcademicYear, extra }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
        <select value={cls} onChange={e => setCls(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32">
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
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-28">
          {YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
      </div>
      {extra}
    </div>
  );
}

// ── Marks Entry Grid ──────────────────────────────────────────
function EnterMarksTab() {
  const { user } = useAuth();
  const isTeacher  = user?.role === 'teacher';
  const canUnlock  = ['super_admin','admin','coordinator'].includes(user?.role);

  const [cls,         setCls]         = useState('');
  const [section,     setSection]     = useState('A');
  const [academicYear,setAcademicYear]= useState(CURRENT_YEAR);
  const [examType,    setExamType]    = useState('UT1');
  const [students,    setStudents]    = useState([]);
  const [marks,       setMarks]       = useState({});  // { [admNo]: { [subject]: { val, absent } } }
  const [loaded,      setLoaded]      = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [locked,      setLocked]      = useState(false);
  const [lockedBy,    setLockedBy]    = useState('');
  const [saved,       setSaved]       = useState(false);
  const [error,       setError]       = useState('');

  const subjects  = SUBJECTS[cls] || [];
  const maxMarks  = EXAM_TYPES[examType]?.max || 10;
  const examLabel = EXAM_TYPES[examType]?.label || '';

  const load = async () => {
    if (!cls) return;
    setLoading(true); setLoaded(false); setError('');

    const lockRes = await window.api.examCheckLocked(cls, section, academicYear, examType);
    if (lockRes.success) { setLocked(lockRes.locked); setLockedBy(lockRes.locked_by); }

    const stuRes = await window.api.examGetStudents(cls, section, academicYear);
    if (!stuRes.success) { setError(stuRes.message); setLoading(false); return; }

    const markRes = await window.api.examGetMarks(cls, section, academicYear, examType);
    const existing = {};
    if (markRes.success) {
      markRes.data.forEach(r => {
        if (!existing[r.admission_number]) existing[r.admission_number] = {};
        existing[r.admission_number][r.subject] = { val: r.marks_obtained ?? '', absent: !!r.is_absent };
      });
    }

    // Init marks for all students/subjects
    const init = {};
    stuRes.data.forEach(s => {
      init[s.admission_number] = {};
      subjects.forEach(sub => {
        init[s.admission_number][sub] = existing[s.admission_number]?.[sub] || { val: '', absent: false };
      });
    });

    setStudents(stuRes.data);
    setMarks(init);
    setLoading(false);
    setLoaded(true);
    setSaved(false);
  };

  const setMark = (admNo, subject, val) => {
    const num = parseFloat(val);
    if (val !== '' && (isNaN(num) || num < 0 || num > maxMarks)) return;
    setMarks(m => ({ ...m, [admNo]: { ...m[admNo], [subject]: { ...m[admNo][subject], val } } }));
  };

  const toggleAbsent = (admNo, subject) => {
    setMarks(m => {
      const cur = m[admNo][subject];
      return { ...m, [admNo]: { ...m[admNo], [subject]: { val: '', absent: !cur.absent } } };
    });
  };

  const markAllPresent  = () => setMarks(m => { const n={...m}; students.forEach(s => { subjects.forEach(sub => { n[s.admission_number]={...n[s.admission_number],[sub]:{val:'',absent:false}}; }); }); return n; });

  const handleSave = async (doLock) => {
    setSaving(true); setError('');
    const rows = [];
    students.forEach(s => {
      subjects.forEach(sub => {
        const cell = marks[s.admission_number]?.[sub];
        rows.push({
          admission_number: s.admission_number,
          student_name:     s.student_name,
          subject:          sub,
          max_marks:        maxMarks,
          marks_obtained:   cell?.absent ? null : (cell?.val === '' ? null : parseFloat(cell?.val)),
          is_absent:        cell?.absent ? 1 : 0,
        });
      });
    });
    const res = await window.api.examSaveMarks(cls, section, academicYear, examType, rows, user?.username, doLock);
    setSaving(false);
    if (res.success) { setSaved(true); if (doLock) setLocked(true); setTimeout(() => setSaved(false), 3000); }
    else setError(res.message);
  };

  const handleUnlock = async () => {
    await window.api.examUnlock(cls, section, academicYear, examType);
    setLocked(false);
  };

  return (
    <div>
      <SelectorBar cls={cls} setCls={v=>{setCls(v);setLoaded(false);}}
        section={section} setSection={v=>{setSection(v);setLoaded(false);}}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        extra={
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Exam</label>
            <select value={examType} onChange={e=>{setExamType(e.target.value);setLoaded(false);}}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36">
              {Object.entries(EXAM_TYPES).map(([k,v]) => <option key={k} value={k}>{v.label} ({v.max}M)</option>)}
            </select>
          </div>
        }
      />

      {/* Lock banner */}
      {loaded && locked && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-600 text-lg">🔒</span>
            <div>
              <p className="text-amber-700 font-semibold text-sm">Marks Locked</p>
              <p className="text-amber-600 text-xs">Submitted by {lockedBy} — editing disabled</p>
            </div>
          </div>
          {canUnlock && (
            <button onClick={handleUnlock}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
              🔓 Unlock
            </button>
          )}
        </div>
      )}

      {/* Load button */}
      {!loaded && (
        <div className="text-center py-4">
          <button onClick={load} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
            {loading ? '⏳ Loading…' : '📋 Load Students'}
          </button>
          {!cls && <p className="text-xs text-gray-400 mt-2">Select a class first</p>}
        </div>
      )}

      {/* Marks grid */}
      {loaded && students.length > 0 && (
        <>
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
            {/* Header */}
            <div className="bg-blue-700 px-5 py-3 flex items-center justify-between">
              <div>
                <p className="text-white font-bold">{cls} — Section {section}</p>
                <p className="text-blue-200 text-xs">{examLabel} · Max {maxMarks} marks per subject · {academicYear}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={markAllPresent} disabled={locked}
                  className="text-xs bg-white bg-opacity-20 hover:bg-opacity-30 text-white px-3 py-1.5 rounded-lg disabled:opacity-40">
                  Clear All AB
                </button>
              </div>
            </div>

            {/* Scrollable table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 text-xs sticky left-0 bg-gray-50 w-8">#</th>
                    <th className="text-left px-3 py-3 font-semibold text-gray-600 text-xs sticky left-8 bg-gray-50 min-w-40">Student Name</th>
                    {subjects.map(sub => (
                      <th key={sub} className="text-center px-2 py-3 font-semibold text-gray-600 text-xs min-w-24">
                        {sub}
                        <span className="block text-gray-400 font-normal">/{maxMarks}</span>
                      </th>
                    ))}
                    <th className="text-center px-3 py-3 font-semibold text-gray-600 text-xs">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, idx) => {
                    const sm = marks[s.admission_number] || {};
                    const rowTotal = subjects.reduce((a, sub) => {
                      const c = sm[sub];
                      return a + (c?.absent ? 0 : (parseFloat(c?.val) || 0));
                    }, 0);
                    const maxTotal = subjects.length * maxMarks;

                    return (
                      <tr key={s.admission_number} className={`border-b border-gray-100 ${idx%2===0?'bg-white':'bg-gray-50'} hover:bg-blue-50`}>
                        <td className="px-3 py-2 text-xs text-gray-400 sticky left-0 bg-inherit">{s.roll_number === 999 ? idx+1 : s.roll_number}</td>
                        <td className="px-3 py-2 sticky left-8 bg-inherit">
                          <p className="font-medium text-gray-800 text-xs">{s.student_name}</p>
                          <p className="text-gray-400 text-xs">{s.admission_number}</p>
                        </td>
                        {subjects.map(sub => {
                          const cell = sm[sub] || { val: '', absent: false };
                          return (
                            <td key={sub} className="px-2 py-2 text-center">
                              {cell.absent ? (
                                <div className="flex flex-col items-center gap-1">
                                  <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-1 rounded">AB</span>
                                  {!locked && (
                                    <button tabIndex={-1} onClick={() => toggleAbsent(s.admission_number, sub)}
                                      className="text-xs text-gray-400 hover:text-blue-600 underline">undo</button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-col items-center gap-1">
                                  <input
                                    type="number" min="0" max={maxMarks}
                                    value={cell.val}
                                    onChange={e => setMark(s.admission_number, sub, e.target.value)}
                                    disabled={locked}
                                    placeholder="—"
                                    className="w-16 text-center border border-gray-300 rounded-lg px-1 py-1 text-sm
                                      focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                                  />
                                  {!locked && (
                                    <button tabIndex={-1} onClick={() => toggleAbsent(s.admission_number, sub)}
                                      className="text-xs text-gray-400 hover:text-red-600 underline">AB</button>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-center">
                          <span className="font-bold text-gray-700 text-sm">{rowTotal}</span>
                          <span className="text-gray-400 text-xs">/{maxTotal}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error */}
          {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">{error}</p>}
          {saved && <p className="text-green-600 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4">✅ Marks saved successfully!</p>}

          {/* Action buttons */}
          {!locked && (
            <div className="flex gap-3 justify-end">
              <button onClick={() => handleSave(false)} disabled={saving}
                className="border border-blue-300 text-blue-700 hover:bg-blue-50 font-medium px-6 py-2.5 rounded-xl text-sm">
                {saving ? '⏳ Saving…' : '💾 Save Draft'}
              </button>
              <button onClick={() => handleSave(true)} disabled={saving}
                className="bg-green-600 hover:bg-green-700 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
                {saving ? '⏳ Submitting…' : '✅ Submit & Lock'}
              </button>
            </div>
          )}
        </>
      )}

      {loaded && students.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">👥</p>
          <p>No active students found in {cls} Section {section}</p>
        </div>
      )}
    </div>
  );
}

// ── Report Card ──────────────────────────────────────────────
function ReportCard({ student, marksMap, subjects, cls, section, academicYear, type }) {
  const isHY    = type === 'half_yearly';
  const sm      = marksMap[student.admission_number] || {};

  const getM = (sub, exam) => {
    const e = sm[sub]?.[exam];
    if (!e) return { v: null, ab: false };
    return { v: e.marks, ab: e.absent };
  };
  const disp = (m) => m.ab ? 'AB' : (m.v !== null && m.v !== undefined ? m.v : '—');
  const num  = (m) => m.ab ? 0 : (m.v ?? 0);

  // Per subject calculations
  const rows = subjects.map(sub => {
    const ut1 = getM(sub,'UT1'), ut2 = getM(sub,'UT2'), hy = getM(sub,'HALF_YEARLY');
    const ut3 = getM(sub,'UT3'), ut4 = getM(sub,'UT4'), fin = getM(sub,'FINAL');
    const hyTotal  = num(ut1)+num(ut2)+num(hy);
    const finTotal = num(ut3)+num(ut4)+num(fin);
    const overall  = hyTotal + finTotal; // out of 200
    const scaled   = overall / 2;        // out of 100
    const hyPct    = hyTotal;            // already /100
    const finPct   = finTotal;           // already /100
    const overallPct = scaled;
    return { sub, ut1,ut2,hy, ut3,ut4,fin, hyTotal, finTotal, overall, scaled, hyPct, finPct, overallPct,
      hyPass: hyPct>=33, finPass: finPct>=33, pass: isHY ? hyPct>=33 : overallPct>=33 };
  });

  // Column totals
  const totUT1  = rows.reduce((a,r)=>a+num(r.ut1),0);
  const totUT2  = rows.reduce((a,r)=>a+num(r.ut2),0);
  const totHY   = rows.reduce((a,r)=>a+num(r.hy),0);
  const totHYT  = rows.reduce((a,r)=>a+r.hyTotal,0);
  const totUT3  = rows.reduce((a,r)=>a+num(r.ut3),0);
  const totUT4  = rows.reduce((a,r)=>a+num(r.ut4),0);
  const totFin  = rows.reduce((a,r)=>a+num(r.fin),0);
  const totFinT = rows.reduce((a,r)=>a+r.finTotal,0);
  const totOver = rows.reduce((a,r)=>a+r.overall,0);
  const maxSub  = subjects.length * 100;
  const maxOver = subjects.length * 200;

  const hyPct   = (totHYT  / maxSub  * 100).toFixed(2);
  const finPct  = (totFinT / maxSub  * 100).toFixed(2);
  const overPct = (totOver / maxOver * 100).toFixed(2);
  const allPass = rows.every(r => isHY ? r.hyPass : r.pass);

  const th = "border border-gray-400 px-2 py-1 text-center text-xs font-semibold bg-gray-100";
  const td = "border border-gray-400 px-2 py-1 text-center text-xs";
  const tf = "border border-gray-400 px-2 py-1 text-center text-xs font-bold bg-gray-50";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 max-w-4xl mx-auto print:shadow-none">
      {/* School Header */}
      <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
        <h1 className="text-xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
        <p className="text-xs text-gray-600">(A Govt. Recognised English Medium School)</p>
        <p className="text-xs text-gray-500">Village Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
        <h2 className="text-base font-bold mt-2 uppercase">
          {isHY ? 'Half Yearly Report Card' : 'Annual Report Card'}
        </h2>
        <p className="text-xs text-gray-600">Academic Session : {academicYear}</p>
      </div>

      {/* Student Info */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-4 text-sm">
        <div className="flex gap-2"><span className="font-semibold w-36">Admission No.</span><span>: {student.admission_number}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Roll No.</span><span>: {student.roll_number === 999 ? '—' : student.roll_number}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Student Name</span><span>: {student.student_name}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Class / Section</span><span>: {cls} / {section}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Date of Birth</span><span>: {student.date_of_birth || '—'}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Mother's Name</span><span>: {student.mother_name || '—'}</span></div>
        <div className="flex gap-2"><span className="font-semibold w-36">Father's Name</span><span>: {student.father_name || '—'}</span></div>
      </div>

      {/* Marks Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={`${th} w-32`} rowSpan={2}>Subject / विषय</th>
              <th className={`${th} bg-blue-50`} colSpan={4}>
                अर्द्ध-वार्षिक परीक्षा / Half Yearly Examination
              </th>
              {!isHY && (
                <th className={`${th} bg-green-50`} colSpan={4}>
                  वार्षिक परीक्षा / Annual Examination
                </th>
              )}
              {!isHY && (
                <th className={`${th} bg-yellow-50`} colSpan={2}>
                  Overall Performance
                </th>
              )}
            </tr>
            <tr>
              <th className={`${th} bg-blue-50`}>Max<br/>Marks</th>
              <th className={`${th} bg-blue-50`}>Periodic<br/>Test (20)</th>
              <th className={`${th} bg-blue-50`}>Mid Term<br/>(80)</th>
              <th className={`${th} bg-blue-50`}>Marks<br/>Obtained</th>
              {!isHY && <>
                <th className={`${th} bg-green-50`}>Max<br/>Marks</th>
                <th className={`${th} bg-green-50`}>Periodic<br/>Test (20)</th>
                <th className={`${th} bg-green-50`}>Final Term<br/>(80)</th>
                <th className={`${th} bg-green-50`}>Marks<br/>Obtained</th>
                <th className={`${th} bg-yellow-50`}>Max<br/>Marks</th>
                <th className={`${th} bg-yellow-50`}>Marks<br/>Obtained</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sub} className={!r.pass && !isHY || (isHY && !r.hyPass) ? 'bg-red-50' : ''}>
                <td className={`${td} text-left font-medium`}>{r.sub}</td>
                <td className={td}>100</td>
                <td className={`${td} ${num(r.ut1)+num(r.ut2)<6?'text-red-600':''}`}>{num(r.ut1)+num(r.ut2)}</td>
                <td className={`${td} ${num(r.hy)<26?'text-red-600':''}`}>{disp(r.hy)}</td>
                <td className={`${td} font-semibold ${r.hyTotal<33?'text-red-600':'text-gray-800'}`}>{r.hyTotal}</td>
                {!isHY && <>
                  <td className={td}>100</td>
                  <td className={`${td} ${num(r.ut3)+num(r.ut4)<6?'text-red-600':''}`}>{num(r.ut3)+num(r.ut4)}</td>
                  <td className={`${td} ${num(r.fin)<26?'text-red-600':''}`}>{disp(r.fin)}</td>
                  <td className={`${td} font-semibold ${r.finTotal<33?'text-red-600':'text-gray-800'}`}>{r.finTotal}</td>
                  <td className={td}>200</td>
                  <td className={`${td} font-bold ${r.overall<66?'text-red-600':'text-gray-800'}`}>{r.overall}</td>
                </>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={`${tf} text-left`}>कुल / Total</td>
              <td className={tf}>{maxSub}</td>
              <td className={tf}>{totUT1+totUT2}</td>
              <td className={tf}>{totHY}</td>
              <td className={`${tf} text-blue-700`}>{totHYT}</td>
              {!isHY && <>
                <td className={tf}>{maxSub}</td>
                <td className={tf}>{totUT3+totUT4}</td>
                <td className={tf}>{totFin}</td>
                <td className={`${tf} text-green-700`}>{totFinT}</td>
                <td className={tf}>{maxOver}</td>
                <td className={`${tf} text-amber-700`}>{totOver}</td>
              </>}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Performance Summary */}
      <div className="mb-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {isHY ? (
                <>
                  <th className={th}>Marks Obtained / Max Marks</th>
                  <th className={th}>Percentage of Marks</th>
                  <th className={th}>Grade</th>
                  <th className={th}>Result</th>
                </>
              ) : (
                <>
                  <th className={th}>Half Yearly</th>
                  <th className={th}>HY %</th>
                  <th className={th}>Annual</th>
                  <th className={th}>Annual %</th>
                  <th className={th}>Overall</th>
                  <th className={th}>Overall %</th>
                  <th className={th}>Grade</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              {isHY ? (
                <>
                  <td className={td}>{totHYT} / {maxSub}</td>
                  <td className={td}>{hyPct}%</td>
                  <td className={td}><span className={`px-2 py-0.5 rounded font-bold ${GRADE_STYLE[getGrade(parseFloat(hyPct))]}`}>{getGrade(parseFloat(hyPct))}</span></td>
                  <td className={`${td} font-bold ${allPass?'text-green-700':'text-red-600'}`}>{allPass?'PASS':'FAIL'}</td>
                </>
              ) : (
                <>
                  <td className={td}>{totHYT}/{maxSub}</td>
                  <td className={td}>{hyPct}%</td>
                  <td className={td}>{totFinT}/{maxSub}</td>
                  <td className={td}>{finPct}%</td>
                  <td className={td}>{totOver}/{maxOver}</td>
                  <td className={td}>{overPct}%</td>
                  <td className={td}><span className={`px-2 py-0.5 rounded font-bold ${GRADE_STYLE[getGrade(parseFloat(overPct))]}`}>{getGrade(parseFloat(overPct))}</span></td>
                </>
              )}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Co-Scholastic */}
      <div className="border border-gray-400 rounded p-3 mb-4 text-xs">
        <p className="font-semibold mb-2">Co-Scholastic Area <span className="font-normal text-gray-500">(on A–E grading scale)</span></p>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2">
          {['Note Book Maintenance','Sports Participation','Reading and Writing Skills','Regularity in Home-Work','Discipline and Punctuality'].map(item => (
            <div key={item} className="flex items-center gap-2">
              <span className="w-48">{item}</span>
              <span>: </span>
              <span className="border-b border-gray-400 flex-1 min-w-16">&nbsp;</span>
            </div>
          ))}
        </div>
      </div>

      {/* Remarks */}
      <div className="border border-gray-400 rounded p-3 mb-4 text-xs">
        <span className="font-semibold">Class Teacher's Remarks : </span>
        <span className="border-b border-gray-400 inline-block w-96">&nbsp;</span>
      </div>

      {/* Result */}
      <div className="border border-gray-400 rounded p-3 mb-4 text-xs text-center">
        <span className="font-bold text-sm">Result : </span>
        <span className={`font-bold text-base underline italic ${allPass?'text-green-700':'text-red-600'}`}>
          {allPass ? 'CONGRATULATIONS, YOU HAVE PASSED AND PROMOTED.' : 'RESULT: FAIL — PROMOTION WITHHELD.'}
        </span>
      </div>

      {/* Date + Signatures */}
      <div className="flex justify-between items-end text-xs mt-4">
        <div>
          <p>Date : <span className="border-b border-gray-400 inline-block w-28">&nbsp;</span></p>
        </div>
        <div className="text-center">
          <p className="border-b border-gray-400 w-36 mb-1">&nbsp;</p>
          <p>Signature</p>
          <p className="text-gray-500">Class Teacher</p>
        </div>
        <div className="text-center">
          <p className="border-b border-gray-400 w-36 mb-1">&nbsp;</p>
          <p>Signature</p>
          <p className="text-gray-500">Head Teacher</p>
        </div>
      </div>
    </div>
  );
}

// ── Result View ───────────────────────────────────────────────
function ResultView({ type }) {
  const [cls,          setCls]         = useState('');
  const [section,      setSection]     = useState('A');
  const [academicYear, setAcademicYear]= useState(CURRENT_YEAR);
  const [students,     setStudents]    = useState([]);
  const [marksMap,     setMarksMap]    = useState({});
  const [loaded,       setLoaded]      = useState(false);
  const [loading,      setLoading]     = useState(false);
  const [error,        setError]       = useState('');
  const [selectedIdx,  setSelectedIdx] = useState(0);

  const subjects = SUBJECTS[cls] || [];
  const isHY     = type === 'half_yearly';

  const load = async () => {
    if (!cls) return;
    setLoading(true); setLoaded(false); setError('');
    const [stuRes, markRes] = await Promise.all([
      window.api.examGetStudents(cls, section, academicYear),
      window.api.examGetMarks(cls, section, academicYear, null),
    ]);
    if (!stuRes.success) { setError(stuRes.message); setLoading(false); return; }
    if (!markRes.success){ setError(markRes.message); setLoading(false); return; }
    setStudents(stuRes.data);
    setMarksMap(buildMarksMap(markRes.data));
    setSelectedIdx(0);
    setLoading(false);
    setLoaded(true);
  };

  const student = students[selectedIdx];

  return (
    <div>
      <SelectorBar
        cls={cls}          setCls={v => { setCls(v); setLoaded(false); }}
        section={section}  setSection={v => { setSection(v); setLoaded(false); }}
        academicYear={academicYear} setAcademicYear={v => { setAcademicYear(v); setLoaded(false); }}
      />

      {!loaded && (
        <div className="text-center py-4">
          <button onClick={load} disabled={!cls || loading}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
            {loading ? '⏳ Loading…' : '📊 Generate Result'}
          </button>
          {!cls && <p className="text-xs text-gray-400 mt-2">Select a class first</p>}
        </div>
      )}

      {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4">{error}</p>}

      {loaded && students.length > 0 && (
        <div className="flex gap-4">
          {/* Student list sidebar */}
          <div className="w-52 shrink-0">
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="bg-blue-700 px-3 py-2">
                <p className="text-white text-xs font-semibold">{students.length} Students</p>
              </div>
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {students.map((s, i) => {
                  const sm = marksMap[s.admission_number] || {};
                  const subj = SUBJECTS[cls] || [];
                  const r = isHY ? calcHY(s.admission_number, subj, marksMap) : calcFinal(s.admission_number, subj, marksMap);
                  return (
                    <button key={s.admission_number} onClick={() => setSelectedIdx(i)}
                      className={`w-full text-left px-3 py-2.5 border-b border-gray-100 hover:bg-blue-50 transition-colors
                        ${selectedIdx === i ? 'bg-blue-50 border-l-4 border-l-blue-700' : ''}`}>
                      <p className="text-xs font-semibold text-gray-800 truncate">{s.student_name}</p>
                      <p className="text-xs text-gray-400">{s.roll_number === 999 ? i+1 : s.roll_number} · {r.pct}%
                        <span className={`ml-1 font-bold ${r.allPass ? 'text-green-600' : 'text-red-500'}`}>
                          {r.allPass ? '✓' : '✗'}
                        </span>
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={() => setLoaded(false)}
              className="mt-2 text-xs text-gray-400 hover:text-gray-600 underline w-full text-center">
              ← Change Class
            </button>
          </div>

          {/* Report card */}
          <div className="flex-1 min-w-0">
            {/* Navigation */}
            <div className="flex items-center justify-between mb-3">
              <button onClick={() => setSelectedIdx(i => Math.max(0, i-1))} disabled={selectedIdx === 0}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30">
                ← Previous
              </button>
              <p className="text-sm text-gray-500">
                Student {selectedIdx+1} of {students.length}
              </p>
              <button onClick={() => setSelectedIdx(i => Math.min(students.length-1, i+1))} disabled={selectedIdx === students.length-1}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-30">
                Next →
              </button>
            </div>

            {student && (
              <ReportCard
                student={student}
                marksMap={marksMap}
                subjects={subjects}
                cls={cls}
                section={section}
                academicYear={academicYear}
                type={type}
              />
            )}
          </div>
        </div>
      )}

      {loaded && students.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <p className="text-4xl mb-3">📋</p>
          <p>No students found in {cls} Section {section}</p>
        </div>
      )}
    </div>
  );
}

// ── Half Yearly Result Tab ────────────────────────────────────
function HalfYearlyTab() {
  return <ResultView type="half_yearly" />;
}

// ── Final Result Tab ──────────────────────────────────────────
function FinalTab() {
  return <ResultView type="final" />;
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function Examination() {
  const [tab, setTab] = useState('enter');

  const TABS = [
    { key: 'enter',      label: '✏️ Enter Marks'       },
    { key: 'halfyearly', label: '📊 Half Yearly Result' },
    { key: 'final',      label: '🏆 Final Result'       },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Examination</h2>

      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'enter'      && <EnterMarksTab />}
      {tab === 'halfyearly' && <HalfYearlyTab />}
      {tab === 'final'      && <FinalTab />}
    </div>
  );
}
