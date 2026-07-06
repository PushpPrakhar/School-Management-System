import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS        = Array.from({ length: 4 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });
const TODAY        = new Date().toISOString().slice(0, 10);
const fmt          = (n) => Number(n || 0).toFixed(2);
const fmtINR       = (n) => '₹' + fmt(n);
const fmtDate      = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';
const CATEGORIES   = ['Salary','Utilities','Fuel / Transport','Maintenance','Stationery','Other'];
const MONTH_NAMES  = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Tab 1: Daily Cash Book ────────────────────────────────────
function DailyTab({ academicYear, setAcademicYear }) {
  const [date,     setDate]     = useState(TODAY);
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.cashbookGetDaily(date, academicYear);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res);
  }, [date, academicYear]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-center py-12 text-gray-400">⏳ Loading cash book...</div>;
  if (error)   return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{error}</div>;

  const balanced = data && Math.abs((data.openingCash + data.receiptsCash - data.expensesCash) - data.closingCash) < 0.01
                       && Math.abs((data.openingBank + data.receiptsBank - data.expensesBank) - data.closingBank) < 0.01;

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button onClick={load}
            className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            🔄 Refresh
          </button>
          <button onClick={() => window.print()}
            className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
            🖨️ Print
          </button>
        </div>
        {data && (
          <div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
            ${balanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {balanced ? '✅ Balanced' : '⚠ Not Balanced'}
          </div>
        )}
      </div>

      {data && (
        <div className="print-root bg-white border border-gray-200 rounded-2xl overflow-hidden">

          {/* Opening balance */}
          <div className="grid grid-cols-2 border-b-2 border-gray-300 bg-amber-50">
            <div className="px-4 py-2.5 border-r border-gray-300">
              <div className="flex justify-between text-sm">
                <span className="text-amber-700 font-semibold">Opening Balance</span>
                <div className="flex gap-6 text-xs font-bold text-amber-700">
                  <span>Cash: {fmtINR(data.openingCash)}</span>
                  <span>Bank: {fmtINR(data.openingBank)}</span>
                </div>
              </div>
            </div>
            <div className="px-4 py-2.5">
              <p className="text-sm text-gray-400 italic">← Brought forward</p>
            </div>
          </div>

          {/* Two-column layout */}
          <div className="grid grid-cols-2 divide-x divide-gray-200">

            {/* RECEIPTS column */}
            <div>
              <div className="bg-green-700 px-4 py-2.5 grid grid-cols-4 gap-2 text-xs font-bold text-white">
                <span className="col-span-1">Date</span>
                <span className="col-span-1">Particulars</span>
                <span className="text-right">Cash (₹)</span>
                <span className="text-right">Bank (₹)</span>
              </div>
              <div className="divide-y divide-gray-100">
                {data.receipts.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-6">No receipts for this date</p>
                ) : data.receipts.map((r, i) => (
                  <div key={r.receipt_number}
                    className={`grid grid-cols-4 gap-2 px-4 py-2 text-xs ${i%2===0?'bg-white':'bg-green-50'}`}>
                    <span className="text-gray-500 col-span-1">{String(r.collected_at||'').slice(8,10)}</span>
                    <span className="text-gray-800 col-span-1 truncate" title={r.student_name}>
                      {r.receipt_number} {r.student_name ? `— ${r.student_name}` : ''}
                    </span>
                    <span className="text-right font-medium text-green-700">
                      {r.payment_mode === 'CASH' ? fmt(r.amount) : '—'}
                    </span>
                    <span className="text-right font-medium text-blue-700">
                      {['UPI','IMPS','RTGS','CHEQUE'].includes(r.payment_mode) ? fmt(r.amount) : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Receipts total */}
              <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-green-50 border-t-2 border-green-200 text-xs font-bold text-green-800">
                <span className="col-span-2">Total Receipts</span>
                <span className="text-right">{fmtINR(data.receiptsCash)}</span>
                <span className="text-right">{fmtINR(data.receiptsBank)}</span>
              </div>
            </div>

            {/* PAYMENTS column */}
            <div>
              <div className="bg-red-700 px-4 py-2.5 grid grid-cols-4 gap-2 text-xs font-bold text-white">
                <span className="col-span-1">Date</span>
                <span className="col-span-1">Particulars</span>
                <span className="text-right">Cash (₹)</span>
                <span className="text-right">Bank (₹)</span>
              </div>
              <div className="divide-y divide-gray-100">
                {data.expenses.length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-6">No payments for this date</p>
                ) : data.expenses.map((e, i) => (
                  <div key={e.expense_id}
                    className={`grid grid-cols-4 gap-2 px-4 py-2 text-xs ${i%2===0?'bg-white':'bg-red-50'}`}>
                    <span className="text-gray-500">{String(e.expense_date||'').slice(8,10)}</span>
                    <span className="text-gray-800 truncate col-span-1" title={e.description}>
                      {e.category} — {e.description}
                    </span>
                    <span className="text-right font-medium text-red-700">
                      {e.cash_amount > 0 ? fmt(e.cash_amount) : '—'}
                    </span>
                    <span className="text-right font-medium text-red-700">
                      {e.bank_amount > 0 ? fmt(e.bank_amount) : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Payments total */}
              <div className="grid grid-cols-4 gap-2 px-4 py-2.5 bg-red-50 border-t-2 border-red-200 text-xs font-bold text-red-800">
                <span className="col-span-2">Total Payments</span>
                <span className="text-right">{fmtINR(data.expensesCash)}</span>
                <span className="text-right">{fmtINR(data.expensesBank)}</span>
              </div>
            </div>
          </div>

          {/* Closing balance */}
          <div className="grid grid-cols-2 border-t-2 border-gray-300 bg-blue-50">
            <div className="px-4 py-3 border-r border-gray-300">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700 font-bold">Closing Balance (C/F)</span>
                <div className="flex gap-6 text-xs font-bold text-blue-800">
                  <span>Cash: {fmtINR(data.closingCash)}</span>
                  <span>Bank: {fmtINR(data.closingBank)}</span>
                </div>
              </div>
            </div>
            <div className="px-4 py-3">
              <div className="flex justify-between text-sm">
                <span className="text-blue-700 font-bold">Closing Balance (C/F)</span>
                <div className="flex gap-6 text-xs font-bold text-blue-800">
                  <span>Cash: {fmtINR(data.closingCash)}</span>
                  <span>Bank: {fmtINR(data.closingBank)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Grand totals row */}
          <div className="grid grid-cols-2 border-t border-gray-300 bg-gray-100">
            <div className="px-4 py-2.5 border-r border-gray-300">
              <div className="flex justify-between text-xs font-bold text-gray-700">
                <span>Grand Total</span>
                <div className="flex gap-6">
                  <span>{fmtINR(data.openingCash + data.receiptsCash)}</span>
                  <span>{fmtINR(data.openingBank + data.receiptsBank)}</span>
                </div>
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="flex justify-between text-xs font-bold text-gray-700">
                <span>Grand Total</span>
                <div className="flex gap-6">
                  <span>{fmtINR(data.expensesCash + data.closingCash)}</span>
                  <span>{fmtINR(data.expensesBank + data.closingBank)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Enter Expense ──────────────────────────────────────
function ExpenseTab({ academicYear, setAcademicYear }) {
  const { user } = useAuth();
  const [date,     setDate]     = useState(TODAY);
  const [category, setCategory] = useState('Salary');
  const [desc,     setDesc]     = useState('');
  const [cashAmt,  setCashAmt]  = useState('');
  const [bankAmt,  setBankAmt]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');
  const [recent,   setRecent]   = useState([]);
  const [editId,   setEditId]   = useState(null);

  const loadRecent = useCallback(async () => {
    const res = await window.api.cashbookGetDaily(date, academicYear);
    if (res.success) setRecent(res.expenses);
  }, [date, academicYear]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const save = async () => {
    if (!desc.trim()) { setError('Please enter a description.'); return; }
    if (!cashAmt && !bankAmt) { setError('Enter cash or bank amount.'); return; }
    setSaving(true); setError('');

    const data = {
      expense_date:  date,
      academic_year: academicYear,
      category,
      description:   desc,
      cash_amount:   parseFloat(cashAmt) || 0,
      bank_amount:   parseFloat(bankAmt) || 0,
      entered_by:    user?.username || '',
    };

    let res;
    if (editId) {
      res = await window.api.cashbookUpdateExpense({ ...data, expense_id: editId });
    } else {
      res = await window.api.cashbookAddExpense(data);
    }

    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setDesc(''); setCashAmt(''); setBankAmt(''); setEditId(null);
    loadRecent();
  };

  const deleteExp = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    await window.api.cashbookDeleteExpense(id);
    loadRecent();
  };

  const startEdit = (e) => {
    setEditId(e.expense_id); setDate(e.expense_date);
    setCategory(e.category); setDesc(e.description);
    setCashAmt(e.cash_amount || ''); setBankAmt(e.bank_amount || '');
  };

  return (
    <div className="max-w-2xl">
      {/* Form */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-gray-700 mb-4">{editId ? '✏️ Edit Expense' : '+ Add Expense'}</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
              {YEARS.map(y => <option key={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description *</label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Staff salary — June"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cash Amount (₹)</label>
            <div className="flex items-center border-2 border-gray-200 focus-within:border-blue-400 rounded-xl overflow-hidden">
              <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">₹</span>
              <input type="number" min="0" value={cashAmt} onChange={e => setCashAmt(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bank Amount (₹)</label>
            <div className="flex items-center border-2 border-gray-200 focus-within:border-blue-400 rounded-xl overflow-hidden">
              <span className="px-2.5 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">₹</span>
              <input type="number" min="0" value={bankAmt} onChange={e => setBankAmt(e.target.value)}
                placeholder="0.00"
                className="flex-1 px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-red-600">{error}</div>}
        {saved  && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 mb-3 text-sm text-green-700">✅ Expense saved</div>}

        <div className="flex gap-3 justify-end">
          {editId && (
            <button onClick={() => { setEditId(null); setDesc(''); setCashAmt(''); setBankAmt(''); }}
              className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Cancel Edit
            </button>
          )}
          <button onClick={save} disabled={saving}
            className="px-8 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
            {saving ? '⏳ Saving...' : editId ? '✏️ Update Expense' : '+ Add Expense'}
          </button>
        </div>
      </div>

      {/* Recent expenses for the date */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <p className="text-sm font-semibold text-gray-700">Expenses on {fmtDate(date)}</p>
        </div>
        {recent.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-6">No expenses recorded for this date</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Category','Description','Cash (₹)','Bank (₹)','Entered By',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent.map((e, i) => (
                <tr key={e.expense_id} className={i%2===0?'bg-white':'bg-gray-50'}>
                  <td className="px-4 py-2.5">
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{e.category}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-800">{e.description}</td>
                  <td className="px-4 py-2.5 font-medium text-red-600">{e.cash_amount > 0 ? fmtINR(e.cash_amount) : '—'}</td>
                  <td className="px-4 py-2.5 font-medium text-red-600">{e.bank_amount > 0 ? fmtINR(e.bank_amount) : '—'}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{e.entered_by || '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(e)} className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg">Edit</button>
                      <button onClick={() => deleteExp(e.expense_id)} className="text-xs text-red-500 hover:text-red-700 border border-red-200 px-2 py-1 rounded-lg">Delete</button>
                    </div>
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

// ── Tab 3: Monthly Summary ────────────────────────────────────
function MonthlyTab({ academicYear, setAcademicYear }) {
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.cashbookGetMonthlySummary(academicYear);
    if (res.success) setData(res.data);
    setLoading(false);
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const totalCashIn  = data.reduce((s,r) => s+r.cash_in,  0);
  const totalBankIn  = data.reduce((s,r) => s+r.bank_in,  0);
  const totalCashOut = data.reduce((s,r) => s+r.cash_out, 0);
  const totalBankOut = data.reduce((s,r) => s+r.bank_out, 0);

  // Running cumulative balance
  let runCash = 0, runBank = 0;
  const withRunning = data.map(r => {
    runCash += r.net_cash;
    runBank += r.net_bank;
    return { ...r, cumCash: runCash, cumBank: runBank };
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm text-gray-500">Academic Year</label>
        <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
        <button onClick={() => window.print()} className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm ml-auto">
          🖨️ Print
        </button>
      </div>

      <div className="print-root">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          {[
            ['Total Cash In',  fmtINR(totalCashIn),  'bg-green-50 border-green-200 text-green-700'],
            ['Total Bank In',  fmtINR(totalBankIn),  'bg-blue-50 border-blue-200 text-blue-700'],
            ['Total Cash Out', fmtINR(totalCashOut), 'bg-red-50 border-red-200 text-red-600'],
            ['Total Bank Out', fmtINR(totalBankOut), 'bg-orange-50 border-orange-200 text-orange-600'],
          ].map(([label, val, cls]) => (
            <div key={label} className={`border rounded-2xl p-4 text-center ${cls}`}>
              <p className="text-xl font-bold">{val}</p>
              <p className="text-xs mt-0.5">{label}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-blue-700">
              <tr>
                {['Month','Receipts — Cash','Receipts — Bank','Total In','Payments — Cash','Payments — Bank','Total Out','Net','Balance (C)','Balance (B)'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs text-blue-100 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {withRunning.map((r, i) => {
                const totalIn  = r.cash_in  + r.bank_in;
                const totalOut = r.cash_out + r.bank_out;
                const net      = totalIn - totalOut;
                return (
                  <tr key={r.key} className={i%2===0?'bg-white':'bg-gray-50'}>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{r.monthName} {r.year}</td>
                    <td className="px-3 py-2.5 text-green-700">{fmtINR(r.cash_in)}</td>
                    <td className="px-3 py-2.5 text-blue-700">{fmtINR(r.bank_in)}</td>
                    <td className="px-3 py-2.5 font-bold text-gray-700">{fmtINR(totalIn)}</td>
                    <td className="px-3 py-2.5 text-red-600">{fmtINR(r.cash_out)}</td>
                    <td className="px-3 py-2.5 text-orange-600">{fmtINR(r.bank_out)}</td>
                    <td className="px-3 py-2.5 font-bold text-red-700">{fmtINR(totalOut)}</td>
                    <td className={`px-3 py-2.5 font-bold ${net>=0?'text-green-700':'text-red-600'}`}>{fmtINR(net)}</td>
                    <td className={`px-3 py-2.5 font-bold ${r.cumCash>=0?'text-green-700':'text-red-600'}`}>{fmtINR(r.cumCash)}</td>
                    <td className={`px-3 py-2.5 font-bold ${r.cumBank>=0?'text-blue-700':'text-red-600'}`}>{fmtINR(r.cumBank)}</td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr><td colSpan={10} className="text-center py-10 text-gray-400">No data for {academicYear}</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300">
              <tr>
                <td className="px-3 py-3 font-bold text-gray-700">TOTAL</td>
                <td className="px-3 py-3 font-bold text-green-700">{fmtINR(totalCashIn)}</td>
                <td className="px-3 py-3 font-bold text-blue-700">{fmtINR(totalBankIn)}</td>
                <td className="px-3 py-3 font-bold">{fmtINR(totalCashIn+totalBankIn)}</td>
                <td className="px-3 py-3 font-bold text-red-600">{fmtINR(totalCashOut)}</td>
                <td className="px-3 py-3 font-bold text-orange-600">{fmtINR(totalBankOut)}</td>
                <td className="px-3 py-3 font-bold">{fmtINR(totalCashOut+totalBankOut)}</td>
                <td className={`px-3 py-3 font-bold ${(totalCashIn+totalBankIn-totalCashOut-totalBankOut)>=0?'text-green-700':'text-red-600'}`}>
                  {fmtINR(totalCashIn+totalBankIn-totalCashOut-totalBankOut)}
                </td>
                <td className="px-3 py-3 font-bold text-green-700">{fmtINR(runCash)}</td>
                <td className="px-3 py-3 font-bold text-blue-700">{fmtINR(runBank)}</td>
              </tr>
            </tfoot>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function CashBook() {
  const [tab,          setTab]          = useState('daily');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);

  const TABS = [
    { key: 'daily',   label: '📒 Daily Cash Book'   },
    { key: 'expense', label: '💸 Enter Expense'      },
    { key: 'monthly', label: '📊 Monthly Summary'    },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Cash Book</h2>
        <p className="text-sm text-gray-500 mt-0.5">Double-entry cash book — receipts from fee collections, payments from manual expense entries</p>
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

      {tab === 'daily'   && <DailyTab   academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'expense' && <ExpenseTab academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'monthly' && <MonthlyTab academicYear={academicYear} setAcademicYear={setAcademicYear} />}
    </div>
  );
}
