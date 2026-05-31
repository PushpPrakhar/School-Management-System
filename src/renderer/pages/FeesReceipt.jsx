// FeesReceipt.jsx
// Search a student → see pending dues → collect payment → print receipt

import React, { useState } from 'react';
import { fmtDate, fmtRupees, amountToWords, currentAcademicYear, ACADEMIC_YEARS } from '../utils/helpers';

const CURRENT_YEAR = currentAcademicYear();
const inputCls     = `w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`;

// ── Print receipt (opens print dialog) ───────────────────────
function printReceipt({ receipt_number, student, entry, amountPaid, paymentMode, paymentDate, schoolName }) {
  const remaining = (entry.total_due - entry.amount_paid_this_month);
  const html = `
  <html><head><title>Fee Receipt</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 11px; background: white; }
    .page { width: 190mm; margin: 0 auto; padding: 10mm; }
    .copy { border: 1.5px solid #333; padding: 8mm; margin-bottom: 6mm; }
    .header { text-align: center; border-bottom: 1px solid #333; padding-bottom: 6px; margin-bottom: 8px; }
    h1 { font-size: 16px; margin-bottom: 2px; }
    h2 { font-size: 12px; font-weight: normal; margin-bottom: 2px; color: #555; }
    .badge { font-size: 10px; color: #888; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .meta span { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; }
    td, th { border: 1px solid #ddd; padding: 5px 7px; font-size: 10px; }
    th { background: #f0f4ff; font-weight: 600; text-align: left; }
    .total-row td { font-weight: bold; background: #f9f9f9; }
    .words { font-style: italic; color: #444; margin: 6px 0; font-size: 10px; }
    .footer { display: flex; justify-content: space-between; margin-top: 12px; font-size: 10px; }
    .sig { text-align: center; border-top: 1px solid #333; padding-top: 4px; width: 100px; }
    .copy-label { font-size: 9px; color: #888; text-align: right; margin-bottom: 4px; }
    @media print {
      body { margin: 0; }
      .page { width: 100%; padding: 5mm; }
    }
  </style></head>
  <body><div class="page">
  ${['Parent Copy', 'School Copy'].map(copyLabel => `
    <div class="copy">
      <div class="copy-label">${copyLabel}</div>
      <div class="header">
        <h1>${schoolName}</h1>
        <h2>Fee Receipt</h2>
      </div>
      <div class="meta">
        <div>Receipt No: <span>${receipt_number}</span></div>
        <div>Date: <span>${fmtDate(paymentDate)}</span></div>
      </div>
      <table>
        <tr><th>Student Name</th><td>${student.student_name}</td><th>Admission No.</th><td>${student.admission_number}</td></tr>
        <tr><th>Father's Name</th><td>${student.father_name}</td><th>Class</th><td>${entry.class}</td></tr>
        <tr><th>Address</th><td colspan="3">${student.address || '—'}</td></tr>
      </table>
      <table>
        <thead><tr><th>Description</th><th style="text-align:right">Amount (₹)</th></tr></thead>
        <tbody>
          <tr><td>Month: ${entry.month}</td><td style="text-align:right">${fmtRupees(entry.monthly_tuition_fees)}</td></tr>
          ${entry.transport_fees > 0 ? `<tr><td>Transport Fees</td><td style="text-align:right">${fmtRupees(entry.transport_fees)}</td></tr>` : ''}
          ${entry.concession > 0 ? `<tr><td>Concession</td><td style="text-align:right">- ${fmtRupees(entry.concession)}</td></tr>` : ''}
          ${entry.prev_balance > 0 ? `<tr><td>Previous Balance</td><td style="text-align:right">${fmtRupees(entry.prev_balance - entry.prev_deposit)}</td></tr>` : ''}
          <tr class="total-row"><td>Total Due</td><td style="text-align:right">${fmtRupees(entry.total_due)}</td></tr>
          <tr class="total-row"><td><b>Amount Received</b></td><td style="text-align:right"><b>${fmtRupees(amountPaid)}</b></td></tr>
          <tr><td>Balance Remaining</td><td style="text-align:right">${remaining <= 0 ? '✓ Nil' : fmtRupees(remaining)}</td></tr>
        </tbody>
      </table>
      <p class="words">Amount in words: ${amountToWords(amountPaid)}</p>
      <p style="font-size:10px; color:#555;">Payment Mode: ${paymentMode}</p>
      <div class="footer">
        <div></div>
        <div class="sig">Cashier / Principal</div>
      </div>
    </div>`).join('')}
  </div></body></html>`;

  const w = window.open('', '_blank', 'width=800,height=600');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 500);
}

// ── Main component ────────────────────────────────────────────
export default function FeesReceipt() {
  const [year,          setYear]          = useState(CURRENT_YEAR);
  const [query,         setQuery]         = useState('');
  const [results,       setResults]       = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [student,       setStudent]       = useState(null);
  const [ledger,        setLedger]        = useState([]);
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [amountPaid,    setAmountPaid]    = useState('');
  const [paymentMode,   setPaymentMode]   = useState('Cash');
  const [paymentDate,   setPaymentDate]   = useState(new Date().toISOString().slice(0,10));
  const [saving,        setSaving]        = useState(false);
  const [lastReceipt,   setLastReceipt]   = useState(null);
  const [error,         setError]         = useState('');
  const schoolName = 'School Name';  // TODO: make configurable in settings

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true); setError('');
    const res = await window.api.feesSearchStudent(query, year);
    setSearching(false);
    if (res.success) setResults(res.data);
  };

  const selectStudent = async (s) => {
    setStudent(s);
    setResults([]);
    setQuery('');
    setSelectedEntry(null);
    setLastReceipt(null);
    setError('');
    const res = await window.api.feesGetMonthLedger(s.admission_number, year);
    if (res.success) setLedger(res.data);
  };

  const collectPayment = async () => {
    const amt = parseFloat(amountPaid);
    if (!amt || amt <= 0)     return setError('Please enter a valid amount.');
    if (!selectedEntry)       return setError('Please select a month entry.');
    const remaining = selectedEntry.total_due - selectedEntry.amount_paid_this_month;
    if (amt > remaining + 0.01) return setError(`Amount cannot exceed pending balance of ${fmtRupees(remaining)}.`);

    setSaving(true); setError('');
    const res = await window.api.feesCollectPayment({
      ledger_id:    selectedEntry.ledger_id,
      amount_paid:  amt,
      payment_mode: paymentMode,
      payment_date: paymentDate,
    });
    setSaving(false);

    if (res.success) {
      setLastReceipt({ ...res, amountPaid: amt, paymentMode, paymentDate });
      setAmountPaid('');
      setSelectedEntry(null);
      // Reload ledger
      const reload = await window.api.feesGetMonthLedger(student.admission_number, year);
      if (reload.success) setLedger(reload.data);
    } else {
      setError(res.message);
    }
  };

  const totalPending = ledger.reduce((sum, e) => sum + Math.max(0, e.total_due - e.amount_paid_this_month), 0);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Collect Fees</h2>
        <p className="text-sm text-gray-500 mt-0.5">Search a student, select the month, and record payment</p>
      </div>

      {/* Year picker */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs font-medium text-gray-600">Academic Year</label>
        <select value={year} onChange={e => { setYear(e.target.value); setStudent(null); setLedger([]); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Receipt success banner */}
      {lastReceipt && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-green-800">✅ Payment recorded</p>
              <p className="text-sm text-green-700 mt-0.5">
                Receipt No: <span className="font-mono font-bold">{lastReceipt.receipt_number}</span>
                &nbsp;·&nbsp; Amount: <strong>{fmtRupees(lastReceipt.amountPaid)}</strong>
              </p>
            </div>
            <button
              onClick={() => printReceipt({
                receipt_number: lastReceipt.receipt_number,
                student,
                entry:          lastReceipt.entry,
                amountPaid:     lastReceipt.amountPaid,
                paymentMode:    lastReceipt.paymentMode,
                paymentDate:    lastReceipt.paymentDate,
                schoolName,
              })}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
            >
              🖨️ Print Receipt
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      {!student && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-end mb-4">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search Student</label>
            <input value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && search()}
              placeholder="Name, Admission Number or Father's Name…"
              className={inputCls} />
          </div>
          <button onClick={search} disabled={searching}
            className="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50">
            {searching ? 'Searching…' : '🔍 Search'}
          </button>
        </div>
      )}

      {/* Search results */}
      {results.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
          {results.map(s => (
            <button key={s.admission_number} onClick={() => selectStudent(s)}
              className="w-full flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-blue-50 text-left last:border-0">
              <div className="flex-1">
                <p className="font-medium text-gray-800">{s.student_name}</p>
                <p className="text-xs text-gray-500">{s.admission_number} · {s.current_class} · Father: {s.father_name}</p>
              </div>
              <p className={`text-sm font-semibold ${s.total_pending > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {s.total_pending > 0 ? `₹${Number(s.total_pending).toLocaleString('en-IN')} pending` : '✓ Clear'}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Student + payment panel */}
      {student && (
        <div className="space-y-4">
          {/* Student card */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="font-bold text-gray-800">{student.student_name}</p>
                <span className="text-xs font-mono bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">{student.admission_number}</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{student.current_class} · Father: {student.father_name}</p>
            </div>
            <div className="text-right">
              <p className={`text-lg font-bold ${totalPending > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {totalPending > 0 ? `${fmtRupees(totalPending)} pending` : '✓ All clear'}
              </p>
              <button onClick={() => { setStudent(null); setLedger([]); setLastReceipt(null); }}
                className="text-xs text-gray-400 hover:text-gray-600 underline mt-1">
                Change student
              </button>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</p>}

          {/* Month selection */}
          {ledger.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center text-sm text-yellow-800">
              No fee entries found for {year}. Add entries from the Fees Ledger page first.
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                <p className="text-sm font-semibold text-gray-700">Select Month to Pay</p>
              </div>
              <div className="divide-y divide-gray-100">
                {ledger.map(e => {
                  const remaining = e.total_due - e.amount_paid_this_month;
                  const isSelected = selectedEntry?.ledger_id === e.ledger_id;
                  return (
                    <button
                      key={e.ledger_id}
                      onClick={() => { if (remaining > 0) { setSelectedEntry(e); setAmountPaid(String(remaining)); setError(''); } }}
                      disabled={remaining <= 0}
                      className={`w-full flex items-center gap-4 px-4 py-3 text-left transition-colors
                        ${remaining <= 0 ? 'opacity-50 cursor-not-allowed bg-gray-50'
                        : isSelected    ? 'bg-blue-50 border-l-4 border-blue-600'
                        : 'hover:bg-gray-50'}`}
                    >
                      <div className="flex-1">
                        <p className="font-medium text-gray-700">{e.month}</p>
                        <p className="text-xs text-gray-400">
                          Tuition: {fmtRupees(e.monthly_tuition_fees)}
                          {e.transport_fees > 0 && ` + Transport: ${fmtRupees(e.transport_fees)}`}
                          {e.concession > 0 && ` − Concession: ${fmtRupees(e.concession)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">Total Due: {fmtRupees(e.total_due)}</p>
                        <p className={`font-semibold text-sm ${remaining <= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {remaining <= 0 ? '✓ Paid' : `${fmtRupees(remaining)} due`}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payment form */}
          {selectedEntry && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5">
              <h4 className="text-sm font-semibold text-blue-800 mb-4">
                Record Payment — {selectedEntry.month}
              </h4>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Amount (₹) *</label>
                  <input type="number" min="1"
                    max={selectedEntry.total_due - selectedEntry.amount_paid_this_month}
                    value={amountPaid}
                    onChange={e => setAmountPaid(e.target.value)}
                    className={inputCls} />
                  {amountPaid && <p className="text-xs text-gray-400 mt-1 italic">{amountToWords(parseFloat(amountPaid))}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Mode</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className={inputCls}>
                    <option>Cash</option>
                    <option>Cheque</option>
                    <option>Online Transfer</option>
                    <option>UPI</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
                  <input type="date" value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <button onClick={() => setSelectedEntry(null)} className="text-sm text-gray-500 underline">Cancel</button>
                <button onClick={collectPayment} disabled={saving}
                  className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  {saving ? 'Processing…' : '✅ Collect & Generate Receipt'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
