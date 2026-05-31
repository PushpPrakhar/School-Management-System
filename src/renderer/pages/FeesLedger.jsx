// FeesLedger.jsx
// Set up monthly fees for a student and view their full ledger.
// Flow: search student → view ledger → add monthly entry

import React, { useState } from 'react';
import { fmtDate, fmtRupees, currentAcademicYear, ACADEMIC_YEARS, CLASSES, MONTHS } from '../utils/helpers';

const CURRENT_YEAR = currentAcademicYear();

const inputCls = `w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:ring-2 focus:ring-blue-500`;

// ── Month-entry form ──────────────────────────────────────────
function AddEntryForm({ student, academicYear, onSaved, onCancel }) {
  const now         = new Date();
  const monthIndex  = now.getMonth() >= 3 ? now.getMonth() - 3 : now.getMonth() + 9;
  const yearSuffix  = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear();

  const [form, setForm] = useState({
    month:               `${MONTHS[monthIndex]} ${yearSuffix}`,
    monthly_tuition_fees: '',
    transport_fees:       '0',
    concession:           '0',
    prev_balance:         '0',
    prev_deposit:         '0',
    amount_paid_this_month: '0',
    payment_date:         '',
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const tuition   = parseFloat(form.monthly_tuition_fees) || 0;
  const transport = parseFloat(form.transport_fees) || 0;
  const conc      = parseFloat(form.concession) || 0;
  const prevBal   = parseFloat(form.prev_balance) || 0;
  const prevDep   = parseFloat(form.prev_deposit) || 0;
  const totalMonthly = tuition + transport - conc;
  const totalDue     = totalMonthly + (prevBal - prevDep);

  const handleSave = async () => {
    if (!form.month)                 return setError('Please select a month.');
    if (!form.monthly_tuition_fees)  return setError('Tuition fees is required.');

    setSaving(true); setError('');
    const result = await window.api.feesAddEntry({
      admission_number:      student.admission_number,
      student_name:          student.student_name,
      father_name:           student.father_name,
      class:                 student.current_class,
      address:               student.address || '',
      academic_year:         academicYear,
      month:                 form.month,
      monthly_tuition_fees:  tuition,
      transport_fees:        transport,
      concession:            conc,
      prev_balance:          prevBal,
      prev_deposit:          prevDep,
      total_due:             totalDue,
      amount_paid_this_month: parseFloat(form.amount_paid_this_month) || 0,
      payment_date:          form.payment_date || null,
    });
    setSaving(false);
    if (result.success) onSaved();
    else setError(result.message);
  };

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-4">
      <h4 className="text-sm font-semibold text-blue-800 mb-4">Add Monthly Fee Entry</h4>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Month *</label>
          <select value={form.month} onChange={e => set('month', e.target.value)} className={inputCls}>
            <option value="">Select month</option>
            {MONTHS.map(m => {
              const yr = (new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear());
              const label = `${m} ${m === 'January' || m === 'February' || m === 'March' ? yr + 1 : yr}`;
              return <option key={m} value={label}>{label}</option>;
            })}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tuition Fees (₹) *</label>
          <input type="number" min="0" value={form.monthly_tuition_fees}
            onChange={e => set('monthly_tuition_fees', e.target.value)} className={inputCls} placeholder="0" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Transport Fees (₹)</label>
          <input type="number" min="0" value={form.transport_fees}
            onChange={e => set('transport_fees', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Concession (₹)</label>
          <input type="number" min="0" value={form.concession}
            onChange={e => set('concession', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Prev. Balance (₹)</label>
          <input type="number" min="0" value={form.prev_balance}
            onChange={e => set('prev_balance', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Prev. Deposited (₹)</label>
          <input type="number" min="0" value={form.prev_deposit}
            onChange={e => set('prev_deposit', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Amount Paid Now (₹)</label>
          <input type="number" min="0" value={form.amount_paid_this_month}
            onChange={e => set('amount_paid_this_month', e.target.value)} className={inputCls} />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
          <input type="date" value={form.payment_date}
            onChange={e => set('payment_date', e.target.value)} className={inputCls} />
        </div>
      </div>

      {/* Auto-calculated summary */}
      <div className="bg-white rounded-lg border border-blue-200 p-3 flex gap-6 text-sm mb-4">
        <div><span className="text-gray-500">Monthly Total:</span> <strong>{fmtRupees(totalMonthly)}</strong></div>
        <div><span className="text-gray-500">Total Due:</span> <strong className={totalDue > 0 ? 'text-red-600' : 'text-green-600'}>{fmtRupees(totalDue)}</strong></div>
        <div><span className="text-gray-500">After Payment:</span> <strong className={(totalDue - (parseFloat(form.amount_paid_this_month)||0)) > 0 ? 'text-red-600' : 'text-green-600'}>{fmtRupees(totalDue - (parseFloat(form.amount_paid_this_month)||0))}</strong></div>
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 underline">Cancel</button>
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-2 rounded-lg text-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function FeesLedger() {
  const [query,        setQuery]        = useState('');
  const [year,         setYear]         = useState(CURRENT_YEAR);
  const [results,      setResults]      = useState([]);
  const [student,      setStudent]      = useState(null);
  const [ledgerData,   setLedgerData]   = useState(null);
  const [searching,    setSearching]    = useState(false);
  const [showForm,     setShowForm]     = useState(false);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await window.api.feesSearchStudent(query, year);
    setSearching(false);
    if (res.success) setResults(res.data);
  };

  const loadLedger = async (s) => {
    setStudent(s);
    setResults([]);
    setQuery('');
    setShowForm(false);
    const res = await window.api.feesGetLedger(s.admission_number, year);
    if (res.success) setLedgerData(res);
  };

  const reloadLedger = async () => {
    if (!student) return;
    const res = await window.api.feesGetLedger(student.admission_number, year);
    if (res.success) { setLedgerData(res); setShowForm(false); }
  };

  const pendingColour = (remaining) => {
    if (remaining <= 0)  return 'text-green-600';
    if (remaining < 500) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Fees Ledger</h2>
        <p className="text-sm text-gray-500 mt-0.5">View and manage monthly fee records for each student</p>
      </div>

      {/* Search bar */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-end mb-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search Student</label>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Name, Admission Number or Father's Name…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Academic Year</label>
          <select value={year} onChange={e => setYear(e.target.value)} className={inputCls}>
            {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={search} disabled={searching}
          className="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50">
          {searching ? 'Searching…' : '🔍 Search'}
        </button>
      </div>

      {/* Search results */}
      {results.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
          {results.map(s => (
            <button key={s.admission_number} onClick={() => loadLedger(s)}
              className="w-full flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-blue-50 text-left last:border-0">
              <div className="flex-1">
                <p className="font-medium text-gray-800">{s.student_name}</p>
                <p className="text-xs text-gray-500">{s.admission_number} · {s.current_class} · Father: {s.father_name}</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-semibold ${s.total_pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {s.total_pending > 0 ? `₹${s.total_pending} pending` : '✓ Clear'}
                </p>
                {s.last_payment_date && <p className="text-xs text-gray-400">Last paid: {fmtDate(s.last_payment_date)}</p>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Ledger view */}
      {student && ledgerData && (
        <div>
          {/* Student info card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-gray-800 text-lg">{student.student_name}</h3>
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full font-mono">{student.admission_number}</span>
              </div>
              <p className="text-sm text-gray-500">{student.current_class} · Father: {student.father_name} · {year}</p>
            </div>
            <button onClick={() => { setStudent(null); setLedgerData(null); }}
              className="text-xs text-gray-400 hover:text-gray-600 underline">Change student</button>
          </div>

          {/* Summary strip */}
          {ledgerData.summary && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Total Billed',   value: ledgerData.summary.total_billed,   colour: 'blue'  },
                { label: 'Total Paid',     value: ledgerData.summary.total_paid,     colour: 'green' },
                { label: 'Total Pending',  value: ledgerData.summary.total_pending,  colour: ledgerData.summary.total_pending > 0 ? 'red' : 'green' },
              ].map(c => (
                <div key={c.label} className={`bg-${c.colour}-50 border border-${c.colour}-200 rounded-xl p-4`}>
                  <p className={`text-xs text-${c.colour}-600 font-medium mb-1`}>{c.label}</p>
                  <p className={`text-2xl font-bold text-${c.colour}-700`}>{fmtRupees(c.value || 0)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add entry form */}
          {showForm && (
            <AddEntryForm
              student={student}
              academicYear={year}
              onSaved={reloadLedger}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Ledger table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-700">Month-wise Entries</p>
              {!showForm && (
                <button onClick={() => setShowForm(true)}
                  className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg text-xs">
                  + Add Entry
                </button>
              )}
            </div>

            {ledgerData.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                <p className="text-4xl mb-2">📋</p>
                <p className="text-sm">No entries yet for {year}</p>
                <button onClick={() => setShowForm(true)} className="mt-3 text-blue-600 text-sm underline">
                  Add first entry
                </button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    {['Month','Tuition','Transport','Concession','Total Due','Paid','Remaining','Receipt'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledgerData.entries.map(e => {
                    const remaining = e.total_due - e.amount_paid_this_month;
                    return (
                      <tr key={e.ledger_id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-700">{e.month}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtRupees(e.monthly_tuition_fees)}</td>
                        <td className="px-4 py-3 text-gray-600">{fmtRupees(e.transport_fees)}</td>
                        <td className="px-4 py-3 text-gray-600">{e.concession > 0 ? fmtRupees(e.concession) : '—'}</td>
                        <td className="px-4 py-3 font-medium">{fmtRupees(e.total_due)}</td>
                        <td className="px-4 py-3 text-green-600 font-medium">{fmtRupees(e.amount_paid_this_month)}</td>
                        <td className={`px-4 py-3 font-semibold ${pendingColour(remaining)}`}>
                          {remaining <= 0 ? '✓ Clear' : fmtRupees(remaining)}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-400">{e.receipt_number || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
