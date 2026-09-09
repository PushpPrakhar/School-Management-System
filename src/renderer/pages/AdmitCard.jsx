import React, { useState, useCallback } from 'react';
import schoolLogo from '../../assets/logo/school-logo.png';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 5 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const CLASSES  = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7','Class 8'];
const SECTIONS = ['A','B','C','D'];

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  return `${dd}-${mm}-${d.getFullYear()}`;
};

export default function AdmitCard() {
  const [mode, setMode] = useState('search'); // 'search' | 'class'
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [error, setError] = useState('');

  // Search mode
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true); setError('');
    const res = await window.api.admitCardSearch(query.trim(), academicYear);
    setSearching(false);
    if (!res.success) { setError(res.message); return; }
    setResults(res.data);
  };

  // Class mode
  const [cls, setCls] = useState('Nursery');
  const [section, setSection] = useState('A');
  const [classStudents, setClassStudents] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loadingClass, setLoadingClass] = useState(false);

  const loadClass = async () => {
    setLoadingClass(true); setError(''); setClassStudents(null);
    const res = await window.api.admitCardGetForClass(cls, section, academicYear);
    setLoadingClass(false);
    if (!res.success) { setError(res.message); return; }
    setClassStudents(res.data);
    setSelectedIds(new Set(res.data.map(s => s.ledger_id))); // all selected by default
  };

  const toggleSelected = (ledgerId) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(ledgerId)) next.delete(ledgerId); else next.add(ledgerId);
    return next;
  });

  const [showPrint, setShowPrint] = useState(false);
  const [printTargets, setPrintTargets] = useState([]);

  const printOne = (student) => { setPrintTargets([student]); setShowPrint(true); };
  const printSelectedClass = () => {
    const targets = (classStudents || []).filter(s => selectedIds.has(s.ledger_id));
    setPrintTargets(targets);
    setShowPrint(true);
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Admit Cards</h2>
        <p className="text-sm text-gray-500 mt-0.5">Generate an exam admit card for one student, or a whole class/section at once</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 w-fit">
        <button onClick={() => setMode('search')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
            ${mode === 'search' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          🔍 Single Student
        </button>
        <button onClick={() => setMode('class')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
            ${mode === 'class' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          👥 Whole Class
        </button>
        <div className="ml-2 flex items-center">
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}

      {mode === 'search' && (
        <div className="flex gap-4">
          <div className="w-80 shrink-0">
            <div className="flex gap-2 mb-3">
              <input value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Search SL No, admission no, or name..."
                className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={search} disabled={searching}
                className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
                {searching ? '⏳' : 'Go'}
              </button>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {results.length === 0 && (
                <p className="text-center text-gray-400 text-sm py-6">{query ? 'No results' : 'Search for a student'}</p>
              )}
              {results.map(r => (
                <button key={r.ledger_id} onClick={() => setSelected(r)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 transition-colors
                    ${selected?.ledger_id === r.ledger_id ? 'bg-blue-50 border-l-4 border-l-blue-700' : ''}`}>
                  <p className="text-sm font-bold text-blue-700">{r.sl_number}</p>
                  <p className="text-xs font-semibold text-gray-800">{r.student_name}</p>
                  <p className="text-xs text-gray-400">{r.current_class} {r.section}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-0">
            {!selected ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-4xl mb-3">🎫</p>
                <p>Search and pick a student to preview their admit card</p>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <div className="flex justify-end mb-3">
                  <button onClick={() => printOne(selected)}
                    className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
                    🖨️ Print Admit Card
                  </button>
                </div>
                <div className="border border-gray-300 rounded-xl p-6">
                  <AdmitCardPreview student={selected} academicYear={academicYear} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'class' && (
        <div>
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-4 items-end flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
              <select value={cls} onChange={e => setCls(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {CLASSES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
              <select value={section} onChange={e => setSection(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {SECTIONS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <button onClick={loadClass} disabled={loadingClass}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              {loadingClass ? '⏳ Loading…' : 'Load Students'}
            </button>
            {classStudents && (
              <button onClick={printSelectedClass} disabled={selectedIds.size === 0}
                className="ml-auto px-5 py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent rounded-xl text-sm font-medium">
                🖨️ Print {selectedIds.size} Admit Card{selectedIds.size !== 1 ? 's' : ''}
              </button>
            )}
          </div>

          {classStudents && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {classStudents.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-10">No active students found in {cls} {section} for {academicYear}.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-500">
                      <th className="px-4 py-2 w-10">
                        <input type="checkbox"
                          checked={selectedIds.size === classStudents.length}
                          onChange={e => setSelectedIds(e.target.checked ? new Set(classStudents.map(s => s.ledger_id)) : new Set())} />
                      </th>
                      <th className="px-4 py-2">Roll No</th>
                      <th className="px-4 py-2">SL No</th>
                      <th className="px-4 py-2">Student</th>
                      <th className="px-4 py-2 text-right">Fee Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classStudents.map(s => (
                      <tr key={s.ledger_id} className="border-t border-gray-100">
                        <td className="px-4 py-2">
                          <input type="checkbox" checked={selectedIds.has(s.ledger_id)} onChange={() => toggleSelected(s.ledger_id)} />
                        </td>
                        <td className="px-4 py-2">{s.roll_number ?? '—'}</td>
                        <td className="px-4 py-2 text-blue-700 font-medium">{s.sl_number}</td>
                        <td className="px-4 py-2">{s.student_name}</td>
                        <td className="px-4 py-2 text-right">{fmt(s.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {showPrint && (
        <AdmitCardPrintModal students={printTargets} academicYear={academicYear} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}

// ── Card layout — matches the school's provided Admit Card template ────
function AdmitCardPreview({ student, academicYear }) {
  return (
    <div className="text-sm leading-snug">
      {/* Header — logo, school name/address, blank photo box */}
      <div className="flex items-center justify-center gap-10 border-b-2 border-gray-800 pb-2 mb-2">
        <img src={schoolLogo} alt="School Logo" className="w-20 h-20 object-contain shrink-0" />
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
          <p className="text-sm font-medium">(A Govt. Recognized English Medium School)</p>
          <p className="text-sm mt-0.5">Sherpur-Nayser, Post-Jawal, Bulandshahr, UP-203131</p>
        </div>
        <div className="w-20 h-24 border border-gray-400 shrink-0" />
      </div>

      {/* Title box */}
      <div className="mx-auto border-2 border-amber-400 rounded-lg px-8 py-1 text-center mb-3">
        <p className="text-base font-bold">Admit Card</p>
        <p className="text-xs">Session : {academicYear}</p>
      </div>

      {/* Fields — two columns, blank-line style */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 mb-3">
        <Field label="Admission cum SR No." value={student.admission_number} />
        <Field label="Roll No." value={student.roll_number ?? ''} />
        <Field label="Student's Name" value={student.student_name} />
        <Field label="Class / Section" value={`${student.current_class} / ${student.section}`} />
        <Field label="Father's Name" value={student.father_name} />
        <Field label="Mother's Name" value={student.mother_name} />
      </div>

      <p className="font-semibold mb-2">Total Fee Pending Rs. {fmt(student.balance).replace('₹','')}/-</p>

      <p className="mb-3">
        <span className="font-semibold">Note :</span> Admit card must be in possession of Student daily otherwise
        He/She will not be allowed to appear in the examination.
      </p>

      <div className="mt-2">
        <p className="mb-4">Date: {fmtDate(new Date())}</p>
        <div className="flex justify-between text-sm">
          <span>Signature of<br/>Exam. Incharge</span>
          <span className="self-end">Seal</span>
          <span className="text-right">Signature of<br/>Principal</span>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 w-40 text-gray-700">{label} :</span>
      <span className="flex-1 border-b border-gray-800 font-medium px-1">{value || '\u00A0'}</span>
    </div>
  );
}

function AdmitCardPrintModal({ students, academicYear, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">{students.length > 1 ? `${students.length} Admit Cards` : 'Admit Card Preview'}</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">🖨️ Print</button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Close</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          <div className="print-root">
            {students.map((s, i) => (
              <div key={s.ledger_id}
                className="border border-gray-300 rounded-md p-5 print:border print:border-gray-300 mb-6 print:mb-0"
                style={i < students.length - 1 ? { breakAfter: 'page' } : undefined}>
                <AdmitCardPreview student={s} academicYear={academicYear} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
