import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const MONTH_SHORT = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun',
  '07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' };
const fmtMonth = (fm) => { if (!fm) return ''; const [y, m] = fm.split('-'); return `${MONTH_SHORT[m] || m} ${y}`; };
const fmt = (n) => Number(n || 0).toFixed(2);

// Small popover listing exactly which students are in a given bucket —
// opened by clicking a chip in the banner below.
function StudentListModal({ title, students, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="bg-amber-600 px-5 py-3.5 flex items-center justify-between shrink-0">
          <p className="text-white font-semibold text-sm">{title}</p>
          <button onClick={onClose} className="text-amber-100 hover:text-white text-sm">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
          {students.length === 0 ? (
            <p className="text-center text-gray-400 py-8 text-sm">No students to show</p>
          ) : students.map(s => (
            <div key={s.sl_number} className="px-5 py-2.5 flex items-center gap-3 text-sm">
              <span className="font-bold text-blue-700 w-16 shrink-0">{s.sl_number}</span>
              <span className="flex-1 text-gray-800">{s.student_name}</span>
              <span className="text-gray-400 text-xs">{s.current_class}</span>
            </div>
          ))}
        </div>
        <div className="px-5 py-2.5 border-t border-gray-100 text-xs text-gray-400 shrink-0">
          {students.length} student{students.length === 1 ? '' : 's'}
        </div>
      </div>
    </div>
  );
}

// Shows a warning when fee dues haven't been raised yet for some students
// (e.g. a month went by with nobody generating that month's tuition dues),
// and lets staff generate the missing entries in one click. Never writes
// anything on its own — the person always has to press the button.
export default function MissingFeesBanner({ academicYear }) {
  const { user } = useAuth();
  const [summary,    setSummary]    = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded,   setExpanded]   = useState(false);
  const [result,     setResult]     = useState(null);
  const [dismissed,  setDismissed]  = useState(false);
  const [error,      setError]      = useState('');
  const [viewing,    setViewing]    = useState(null); // { title, students } for the popover

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.accrualGetSummary(academicYear);
    setLoading(false);
    if (res.success) setSummary(res);
    else setError(res.message);
  }, [academicYear]);

  useEffect(() => { load(); setDismissed(false); setResult(null); }, [load]);

  const generate = async () => {
    setGenerating(true); setError('');
    const res = await window.api.accrualGenerate(academicYear, user?.username);
    setGenerating(false);
    if (res.success) { setResult(res); load(); }
    else setError(res.message);
  };

  if (loading || dismissed) return null;
  if (error) return null; // fail silently — this is a helper banner, not a critical path

  const hasMissing = summary && ((summary.monthly?.length || 0) > 0 || (summary.annual?.length || 0) > 0);
  if (!hasMissing && !result) return null;

  if (result) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 flex items-center justify-between print:hidden">
        <p className="text-sm text-green-700">
          ✅ Generated {result.count} fee due{result.count === 1 ? '' : 's'} for {result.studentsAffected} student{result.studentsAffected === 1 ? '' : 's'}
          {' '}— ₹{fmt(result.total)} total.
        </p>
        <button onClick={() => setResult(null)} className="text-green-600 hover:text-green-800 text-sm font-medium">
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 print:hidden">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-800">
            ⚠️ {summary.totalStudentsAffected} student{summary.totalStudentsAffected === 1 ? '' : 's'}{' '}
            {summary.totalStudentsAffected === 1 ? 'is' : 'are'} missing fee dues — ₹{fmt(summary.totalAmount)} not yet raised
          </p>
          <button onClick={() => setExpanded(e => !e)} className="text-xs text-amber-600 underline mt-1">
            {expanded ? 'Hide details' : 'Show details'}
          </button>

          {expanded && (
            <div className="mt-3 space-y-2">
              {summary.monthly.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 mb-1">Monthly Fees (Tuition / Computer / Lab / Transport)</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.monthly.map(m => (
                      <button key={m.fee_month}
                        onClick={() => setViewing({ title: `Missing ${fmtMonth(m.fee_month)} dues`, students: m.students || [] })}
                        className="text-xs bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50 rounded-lg px-2 py-1 cursor-pointer">
                        {fmtMonth(m.fee_month)} — {m.studentCount} student{m.studentCount === 1 ? '' : 's'} · ₹{fmt(m.total)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {summary.annual.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-700 mb-1">Annual / Examination Fees</p>
                  <div className="flex flex-wrap gap-2">
                    {summary.annual.map(a => (
                      <button key={a.fee_type}
                        onClick={() => setViewing({ title: `Missing ${a.label} (${fmtMonth(a.fee_month)})`, students: a.students || [] })}
                        className="text-xs bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50 rounded-lg px-2 py-1 cursor-pointer">
                        {a.label} ({fmtMonth(a.fee_month)}) — {a.studentCount} student{a.studentCount === 1 ? '' : 's'} · ₹{fmt(a.total)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button onClick={generate} disabled={generating}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium whitespace-nowrap">
            {generating ? '⏳ Generating...' : '⚡ Generate Now'}
          </button>
          <button onClick={() => setDismissed(true)} title="Dismiss for now"
            className="text-amber-500 hover:text-amber-700 text-sm px-1">
            ✕
          </button>
        </div>
      </div>

      {viewing && (
        <StudentListModal title={viewing.title} students={viewing.students} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
