import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';
import TCPrintModal from '../components/TCPrintModal';
import {
  toISO, toDMY, dateInWords, classLabel, nextClassLabel, defaultSubjects, clean,
} from '../utils/tcHelpers';

const fmtINR = (n) => '₹' + Number(n || 0).toFixed(2);
const fmtDateTime = (d) => {
  if (!d) return '—';
  const [date, time] = String(d).split(' ');
  return date.split('-').reverse().join('-') + (time ? ' ' + time.slice(0, 5) : '');
};
// Local calendar date (not UTC) — this lands on a legal document, and
// toISOString() would give yesterday's date for the first hours of an Indian day.
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const withClassWord = (c) => (/^Class \d+$/i.test(c) ? `Class ${classLabel(c)}` : c);

const EXAM_OPTIONS = ['School Examination, Pass', 'School Examination, Fail', 'Not Applicable'];
const CONDUCT_OPTIONS = ['Excellent', 'Very Good', 'Good', 'Satisfactory'];
const REASON_SUGGESTIONS = ["Parent's wish", 'Change of residence', "Transfer of parent's job", 'Admission in another school', 'Financial reasons'];

const inputCls = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function Field({ label, required, wide, hint, children }) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

// ── Starting values for the form, from the student's record ──────
function buildForm(d) {
  const s = d.student;
  const caste = clean(s.caste), religion = clean(s.religion);
  const cat = String(s.category || '').trim().toUpperCase();
  const admDate = toDMY(s.date_of_admission);
  const admClass = clean(s.class_of_admission);
  return {
    admission_no: s.admission_number,
    pen_no: clean(s.pen_number),
    admission_date_class: [admDate, admClass ? withClassWord(admClass) : ''].filter(Boolean).join(', '),
    student_name: clean(s.student_name),
    father_name: clean(s.father_name) || clean(s.guardian_name),
    mother_name: clean(s.mother_name),
    dob: toISO(s.date_of_birth),
    dob_words: dateInWords(s.date_of_birth),
    nationality: s.indian_nationality === 'Yes' ? 'INDIAN' : '',
    caste_religion: [caste, religion].filter(Boolean).join(', '),
    sc_st: cat === 'SC' ? 'Yes (SC)' : cat === 'ST' ? 'Yes (ST)' : 'No',
    class_last_studied: classLabel(s.current_class),
    // Left for the issuer to choose on purpose — silently defaulting a
    // legal statement about a student's result is the wrong kind of helpful.
    last_exam_result: '',
    failed_before: 'No',
    subjects: defaultSubjects(s.current_class),
    qualified_promotion: '',
    promoted_to_class: '',
    cleared_upto: d.suggested_cleared_upto || localToday(),
    working_days: String(d.attendance.working_days),
    attended_days: String(d.attendance.present_days),
    conduct: 'Good',
    application_date: localToday(),
    reason_for_leaving: '',
    remarks: '',
    issue_date: localToday(),
  };
}

// ── What gets printed, and frozen into the register ──────────────
function toSnapshot(f) {
  const t = (v) => String(v == null ? '' : v).trim();
  return {
    admission_no: t(f.admission_no),
    pen_no: t(f.pen_no),
    admission_date_class: t(f.admission_date_class),
    student_name: t(f.student_name),
    father_name: t(f.father_name),
    mother_name: t(f.mother_name),
    dob_figure: toDMY(f.dob),
    dob_words: t(f.dob_words),
    nationality: t(f.nationality),
    caste_religion: t(f.caste_religion),
    sc_st: t(f.sc_st),
    class_last_studied: t(f.class_last_studied),
    last_exam_result: t(f.last_exam_result),
    failed_before: t(f.failed_before),
    subjects: t(f.subjects),
    qualified_promotion: t(f.qualified_promotion),
    promoted_to_class: f.qualified_promotion === 'Yes' ? t(f.promoted_to_class) : '—',
    dues_cleared_upto: toDMY(f.cleared_upto),
    working_days: String(parseInt(f.working_days, 10) || 0),
    attended_days: String(parseInt(f.attended_days, 10) || 0),
    conduct: t(f.conduct),
    application_date: toDMY(f.application_date),
    reason_for_leaving: t(f.reason_for_leaving),
    remarks: t(f.remarks),
    issue_date: toDMY(f.issue_date),
  };
}

function validate(f) {
  const required = [
    ['student_name', 'Name of the student'], ['father_name', "Father/Guardian's name"],
    ['dob', 'Date of birth'], ['class_last_studied', 'Class last studied'],
    ['last_exam_result', 'Last annual examination result'],
    ['qualified_promotion', 'Qualified for promotion'],
    ['cleared_upto', 'Dues cleared upto'], ['working_days', 'Working days'],
    ['attended_days', 'Days attended'], ['conduct', 'Conduct'],
    ['application_date', 'Date of application'], ['reason_for_leaving', 'Reason for leaving'],
    ['issue_date', 'Date of issue'],
  ];
  const missing = required.filter(([k]) => !String(f[k] == null ? '' : f[k]).trim()).map(([, l]) => l);
  if (f.qualified_promotion === 'Yes' && !String(f.promoted_to_class).trim()) missing.push('Class promoted to');
  const problems = [];
  const w = parseInt(f.working_days, 10), a = parseInt(f.attended_days, 10);
  if (!isNaN(w) && !isNaN(a) && a > w) problems.push('Days attended cannot be more than the working days.');
  return { missing, problems };
}

// ── Confirmation popup ───────────────────────────────────────────
function ConfirmModal({ snapshot, issuing, error, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6">
        <h3 className="text-lg font-bold text-gray-800 mb-1">Generate Transfer Certificate?</h3>
        <p className="text-sm text-gray-600 mb-4">
          for <strong>{snapshot.student_name}</strong> &nbsp;·&nbsp; Adm. No. <strong>{snapshot.admission_no}</strong>
          &nbsp;·&nbsp; Class {snapshot.class_last_studied}
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-900 mb-4">
          <p className="font-semibold mb-1">Issuing this certificate will:</p>
          <ul className="list-disc ml-5 space-y-0.5">
            <li>Mark the student as <strong>DROPBOX/TC</strong></li>
            <li>Deactivate their fee ledger, so no further fees accrue</li>
            <li>Remove them from active class lists</li>
            <li>Record the TC permanently in the TC Register</li>
          </ul>
          <p className="mt-2">Please check every detail on the form first. This is not meant to be undone casually.</p>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-4">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} disabled={issuing}
            className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 rounded-xl text-sm">
            Go back
          </button>
          <button onClick={onConfirm} disabled={issuing}
            className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
            {issuing ? 'Generating…' : 'Yes, generate TC'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Issue TC ────────────────────────────────────────────────
function IssueTab({ onIssued }) {
  const { user } = useAuth();
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState([]);
  const [searched, setSearched] = useState(false);
  const [detail,   setDetail]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [loadErr,  setLoadErr]  = useState('');
  const [form,     setForm]     = useState(null);
  const [showErrs, setShowErrs] = useState(false);
  const [confirm,  setConfirm]  = useState(false);
  const [issuing,  setIssuing]  = useState(false);
  const [issueErr, setIssueErr] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Debounced search — only active, not-yet-TC'd students come back.
  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return; }
    const t = setTimeout(async () => {
      const res = await window.api.tcSearch(query.trim());
      setResults(res.success ? res.data : []);
      setSearched(true);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const pick = async (admissionNumber) => {
    setLoading(true); setLoadErr(''); setDetail(null); setForm(null);
    setShowErrs(false); setIssueErr('');
    const res = await window.api.tcGetStudent(admissionNumber);
    setLoading(false);
    if (!res.success) { setLoadErr(res.message || 'Could not load this student.'); return; }
    setDetail(res); setForm(buildForm(res));
  };

  const reset = () => { setDetail(null); setForm(null); setLoadErr(''); setShowErrs(false); setIssueErr(''); };

  const setExam = (v) => setForm(f => {
    const n = { ...f, last_exam_result: v };
    if (/Pass$/.test(v))      { n.qualified_promotion = 'Yes'; n.promoted_to_class = nextClassLabel(detail.student.current_class); }
    else if (/Fail$/.test(v)) { n.qualified_promotion = 'No';  n.promoted_to_class = ''; }
    return n;
  });
  const setQualified = (v) => setForm(f => ({
    ...f, qualified_promotion: v,
    promoted_to_class: v === 'Yes' ? (f.promoted_to_class || nextClassLabel(detail.student.current_class)) : '',
  }));
  const setDob = (v) => setForm(f => ({ ...f, dob: v, dob_words: dateInWords(v) }));

  const blocked = detail?.fees?.blocked;
  const { missing, problems } = form ? validate(form) : { missing: [], problems: [] };

  const onGenerate = () => {
    setShowErrs(true); setIssueErr('');
    if (blocked || missing.length || problems.length) return;
    setConfirm(true);
  };

  const doIssue = async () => {
    setIssuing(true); setIssueErr('');
    const snapshot = toSnapshot(form);
    const res = await window.api.tcIssue({
      admission_number: detail.student.admission_number,
      fields: snapshot,
      issued_by: user?.username || '',
    });
    setIssuing(false);
    if (!res.success) {
      setIssueErr(res.message || 'Could not generate the TC.');
      if (res.blocked) pick(detail.student.admission_number); // dues changed since the form loaded
      return;
    }
    setConfirm(false);
    onIssued({ fields: snapshot, tcNumber: res.tc_number });
    reset(); setQuery(''); setResults([]); setSearched(false);
  };

  return (
    <div className="grid grid-cols-[300px_1fr] gap-5 items-start">
      {/* Search */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Find student</label>
        <input value={query} onChange={e => setQuery(e.target.value)} autoFocus
          placeholder="Name, father's name or Adm. No."
          className={inputCls} />
        <div className="mt-3 space-y-1 max-h-[60vh] overflow-y-auto">
          {results.map(r => (
            <button key={r.admission_number} onClick={() => pick(r.admission_number)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm hover:bg-blue-50
                ${detail?.student.admission_number === r.admission_number ? 'border-blue-400 bg-blue-50' : 'border-gray-100'}`}>
              <p className="font-medium text-gray-800">{r.student_name}</p>
              <p className="text-xs text-gray-500">{r.admission_number} · {r.current_class} {r.section}</p>
              <p className="text-xs text-gray-400">S/o {r.father_name}</p>
            </button>
          ))}
          {searched && results.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">No active student found.</p>
          )}
          {!query.trim() && <p className="text-xs text-gray-400 text-center py-4">Only currently active students can be issued a TC.</p>}
        </div>
      </div>

      {/* Form */}
      <div>
        {loading && <div className="text-center py-16 text-gray-400">⏳ Loading student…</div>}
        {loadErr && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{loadErr}</div>}
        {!loading && !loadErr && !detail && (
          <div className="bg-white border border-dashed border-gray-300 rounded-2xl py-16 text-center text-gray-400">
            <p className="text-4xl mb-2">📄</p>
            <p className="text-sm">Search for a student to prepare their Transfer Certificate</p>
          </div>
        )}

        {detail && form && (
          <div className="space-y-4">
            {/* Student strip */}
            <div className="bg-white border border-gray-200 rounded-2xl px-5 py-3 flex items-center justify-between">
              <div>
                <p className="font-bold text-gray-800">{detail.student.student_name}</p>
                <p className="text-xs text-gray-500">
                  {detail.student.admission_number} · {detail.student.current_class} {detail.student.section} · {detail.student.academic_year}
                </p>
              </div>
              <button onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5">
                Choose another
              </button>
            </div>

            {/* Fee status — blocks issuing when anything is owed */}
            {blocked ? (
              <div className="bg-red-50 border-2 border-red-300 rounded-2xl px-5 py-4">
                <p className="font-bold text-red-800">🚫 Unpaid fees — TC cannot be generated</p>
                <p className="text-sm text-red-700 mt-1">
                  {detail.student.student_name} still owes <strong>{fmtINR(detail.fees.total_due)}</strong>. Collect the
                  dues from Counter Payment first, then come back to issue the certificate.
                </p>
                <ul className="mt-2 text-sm text-red-700 space-y-0.5">
                  {detail.fees.due_ledgers.map(l => (
                    <li key={l.academic_year + l.sl_number}>
                      {l.academic_year} &nbsp;({l.sl_number}) &nbsp;—&nbsp; <strong>{fmtINR(l.balance)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ) : detail.fees.has_ledger ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-3 text-sm text-green-800">
                ✅ No dues — all fees are cleared.
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-2xl px-5 py-3 text-sm text-gray-600">
                No fee ledger exists for this student, so there is nothing to clear.
              </div>
            )}

            {/* Student details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-1">Student details</h3>
              <p className="text-xs text-gray-400 mb-4">Filled in from the student's record — correct anything that is wrong or missing.</p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Admission cum SR. No."><input className={inputCls} value={form.admission_no} onChange={e => set('admission_no', e.target.value)} /></Field>
                <Field label="PEN No."><input className={inputCls} value={form.pen_no} onChange={e => set('pen_no', e.target.value)} /></Field>
                <Field label="Date of admission with class"><input className={inputCls} value={form.admission_date_class} onChange={e => set('admission_date_class', e.target.value)} /></Field>
                <Field label="Name of the student" required><input className={inputCls} value={form.student_name} onChange={e => set('student_name', e.target.value)} /></Field>
                <Field label="Father/Guardian's name" required><input className={inputCls} value={form.father_name} onChange={e => set('father_name', e.target.value)} /></Field>
                <Field label="Mother's name"><input className={inputCls} value={form.mother_name} onChange={e => set('mother_name', e.target.value)} /></Field>
                <Field label="Date of birth" required
                  hint={!form.dob ? 'No valid date of birth on record — enter it here.' : undefined}>
                  <input type="date" className={inputCls} value={form.dob} onChange={e => setDob(e.target.value)} />
                </Field>
                <Field label="Date of birth in words"><input className={inputCls} value={form.dob_words} onChange={e => set('dob_words', e.target.value)} /></Field>
                <Field label="Nationality"><input className={inputCls} value={form.nationality} onChange={e => set('nationality', e.target.value)} /></Field>
                <Field label="Caste and religion"><input className={inputCls} value={form.caste_religion} onChange={e => set('caste_religion', e.target.value)} /></Field>
                <Field label="Belongs to Schedule Caste / Schedule Tribe">
                  <select className={inputCls} value={form.sc_st} onChange={e => set('sc_st', e.target.value)}>
                    <option>No</option><option>Yes (SC)</option><option>Yes (ST)</option>
                  </select>
                </Field>
              </div>
            </div>

            {/* Academic details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-4">Academic details</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Class in which last studied" required><input className={inputCls} value={form.class_last_studied} onChange={e => set('class_last_studied', e.target.value)} /></Field>
                <Field label="Annual examination last taken, with result" required>
                  <select className={inputCls} value={form.last_exam_result} onChange={e => setExam(e.target.value)}>
                    <option value="">Select…</option>
                    {EXAM_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
                <Field label="Failed in the same class (once / twice)?">
                  <select className={inputCls} value={form.failed_before} onChange={e => set('failed_before', e.target.value)}>
                    <option>No</option><option>Once</option><option>Twice</option>
                  </select>
                </Field>
                <Field label="Qualified for promotion to the higher class" required>
                  <select className={inputCls} value={form.qualified_promotion} onChange={e => setQualified(e.target.value)}>
                    <option value="">Select…</option><option>Yes</option><option>No</option>
                  </select>
                </Field>
                <Field label="Promoted to class" required={form.qualified_promotion === 'Yes'}>
                  <input className={inputCls} value={form.promoted_to_class} disabled={form.qualified_promotion !== 'Yes'}
                    onChange={e => set('promoted_to_class', e.target.value)} />
                </Field>
                <Field label="Subjects studied" wide><input className={inputCls} value={form.subjects} onChange={e => set('subjects', e.target.value)} /></Field>
                <Field label="Total working days in the academic year" required
                  hint={detail.attendance.working_days === 0 ? 'No attendance is recorded for this student — enter the figures manually.' : `From attendance records for ${detail.attendance.academic_year}.`}>
                  <input type="number" min="0" className={inputCls} value={form.working_days} onChange={e => set('working_days', e.target.value)} />
                </Field>
                <Field label="Total days the student attended" required>
                  <input type="number" min="0" className={inputCls} value={form.attended_days} onChange={e => set('attended_days', e.target.value)} />
                </Field>
                <Field label="All sums due cleared upto" required
                  hint="Suggested from the last month the student was charged.">
                  <input type="date" className={inputCls} value={form.cleared_upto} onChange={e => set('cleared_upto', e.target.value)} />
                </Field>
                <Field label="General conduct" required>
                  <select className={inputCls} value={form.conduct} onChange={e => set('conduct', e.target.value)}>
                    {CONDUCT_OPTIONS.map(o => <option key={o}>{o}</option>)}
                  </select>
                </Field>
              </div>
            </div>

            {/* Leaving details */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="font-bold text-gray-800 mb-4">Leaving details</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Date of application for certificate" required>
                  <input type="date" className={inputCls} value={form.application_date} onChange={e => set('application_date', e.target.value)} />
                </Field>
                <Field label="Date of issue (printed as 'Dated')" required>
                  <input type="date" className={inputCls} value={form.issue_date} onChange={e => set('issue_date', e.target.value)} />
                </Field>
                <Field label="Reason for leaving the school" required wide>
                  <input className={inputCls} list="tc-reasons" value={form.reason_for_leaving} onChange={e => set('reason_for_leaving', e.target.value)} />
                  <datalist id="tc-reasons">{REASON_SUGGESTIONS.map(r => <option key={r} value={r} />)}</datalist>
                </Field>
                <Field label="Any other remarks" wide><input className={inputCls} value={form.remarks} onChange={e => set('remarks', e.target.value)} /></Field>
              </div>
            </div>

            {showErrs && (missing.length > 0 || problems.length > 0) && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
                {missing.length > 0 && <p><strong>Please fill in:</strong> {missing.join(', ')}.</p>}
                {problems.map(p => <p key={p}>{p}</p>)}
              </div>
            )}

            <div className="flex items-center gap-3">
              <button onClick={onGenerate} disabled={blocked}
                className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium">
                Generate TC
              </button>
              {blocked && <span className="text-sm text-red-600">Clear the dues above to enable this.</span>}
            </div>
          </div>
        )}
      </div>

      {confirm && form && (
        <ConfirmModal snapshot={toSnapshot(form)} issuing={issuing} error={issueErr}
          onCancel={() => { setConfirm(false); setIssueErr(''); }} onConfirm={doIssue} />
      )}
    </div>
  );
}

// ── Tab: TC Register ─────────────────────────────────────────────
function RegisterTab({ refreshKey, onReprint }) {
  const [query,   setQuery]   = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.tcList(query.trim());
    setLoading(false);
    if (!res.success) { setError(res.message || 'Could not load the register.'); return; }
    setRows(res.data);
  }, [query]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load, refreshKey]);

  const reprint = async (tcId) => {
    const res = await window.api.tcGet(tcId);
    if (!res.success) { setError(res.message); return; }
    onReprint({ fields: res.fields, tcNumber: res.tc_number });
  };

  return (
    <div>
      <div className="mb-4 max-w-sm">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by TC no., Adm. No. or name" className={inputCls} />
      </div>
      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 mb-3">{error}</div>}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['TC No.', 'Adm. No.', 'Student', 'Class', 'Reason', 'Issued on', 'Issued by', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.tc_id} className={r.is_cancelled ? 'opacity-50' : ''}>
                <td className="px-4 py-2.5 font-mono font-semibold text-blue-700">{r.tc_number}</td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{r.admission_number}</td>
                <td className="px-4 py-2.5 font-medium text-gray-800">{r.student_name}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.class_last_studied}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.reason_for_leaving || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDateTime(r.issued_at)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{r.issued_by || '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => reprint(r.tc_id)}
                    className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1 rounded-lg">
                    🖨️ Reprint
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="text-center py-10 text-gray-400">
                {query.trim() ? 'No matching certificates.' : 'No Transfer Certificates have been issued yet.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function TCGeneration() {
  const [tab,     setTab]     = useState('issue');
  const [show,    setShow]    = useState(null);   // { fields, tcNumber } -> print modal
  const [notice,  setNotice]  = useState('');
  const [version, setVersion] = useState(0);

  const TABS = [
    { key: 'issue',    label: '✍️ Issue TC'    },
    { key: 'register', label: '📚 TC Register' },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Transfer Certificate</h2>
        <p className="text-sm text-gray-500 mt-0.5">Issue a TC to a leaving student. Issuing marks them DROPBOX/TC and deactivates their fee ledger.</p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {notice && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 mb-4 flex justify-between">
          <span>✅ {notice}</span>
          <button onClick={() => setNotice('')} className="text-green-600 hover:text-green-800">✕</button>
        </div>
      )}

      {tab === 'issue' && (
        <IssueTab onIssued={(r) => {
          setShow(r); setVersion(v => v + 1);
          setNotice(`TC ${r.tcNumber} issued for ${r.fields.student_name}. The student is now marked DROPBOX/TC.`);
        }} />
      )}
      {tab === 'register' && <RegisterTab refreshKey={version} onReprint={setShow} />}

      {show && <TCPrintModal fields={show.fields} tcNumber={show.tcNumber} onClose={() => setShow(null)} />}
    </div>
  );
}
