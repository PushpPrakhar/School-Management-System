import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useAuth } from '../utils/AuthContext';
import PrintFooter from '../components/PrintFooter';

// Same reasoning and estimates as Marks List's pagination — see the
// comment there for why these are necessarily estimates, not pixel-perfect.
// Reserves room for Opening Balance (first page) and Closing/Grand Total
// (last page) on every page's calculation, even though they only actually
// appear on one page each — slightly conservative, but guarantees no page
// ever overflows.
const LEDGER_PAGE_CONTENT_HEIGHT_PX = 950;
const LEDGER_PAGE_CONTENT_WIDTH_PX  = 720;
const LEDGER_PAGE_FOOTER_RESERVE_PX = 40;

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS        = Array.from({ length: 4 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });
const TODAY        = new Date().toISOString().slice(0, 10);
const fmt          = (n) => Number(n || 0).toFixed(2);
const fmtINR       = (n) => '₹' + fmt(n);
const fmtDate      = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';
const CATEGORIES   = ['Salary','Utilities','Fuel / Transport','Maintenance','Stationery','Other'];
const MONTH_NAMES  = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

// Per-currency display config — everything that differs between the Cash
// Book and Bank Book views lives here, so the two tabs share one component
// instead of two near-identical copies that could quietly drift apart.
const MODE = {
  cash: {
    title: 'Cash Book', icon: '📒', noun: 'Cash',
    receiptsKey: 'receiptsCash', expensesKey: 'expensesCash',
    openingKey: 'openingCash', closingKey: 'closingCash',
    amountColor: 'text-green-700', headerBg: 'bg-green-700',
    isReceiptOfThisMode: (r) => r.payment_mode === 'CASH',
    expenseAmount: (e) => e.cash_amount,
  },
  bank: {
    title: 'Bank Book', icon: '🏦', noun: 'Bank',
    receiptsKey: 'receiptsBank', expensesKey: 'expensesBank',
    openingKey: 'openingBank', closingKey: 'closingBank',
    amountColor: 'text-blue-700', headerBg: 'bg-blue-700',
    isReceiptOfThisMode: (r) => r.payment_mode !== 'CASH',
    expenseAmount: (e) => e.bank_amount,
  },
};

// ── Tab: Cash Book / Bank Book (single-currency daily ledger) ──
function LedgerTab({ mode, academicYear, setAcademicYear, date, setDate }) {
  const cfg = MODE[mode];
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.cashbookGetDaily(date, academicYear);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res);
  }, [date, academicYear]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-center py-12 text-gray-400">⏳ Loading {cfg.title.toLowerCase()}...</div>;
  if (error)   return <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">{error}</div>;

  const opening  = data ? data[cfg.openingKey]  : 0;
  const receipts = data ? data[cfg.receiptsKey] : 0;
  const expenses = data ? data[cfg.expensesKey] : 0;
  const closing  = data ? data[cfg.closingKey]  : 0;
  const balanced = data && Math.abs((opening + receipts - expenses) - closing) < 0.01;

  const dayReceipts = data ? data.receipts.filter(cfg.isReceiptOfThisMode) : [];
  const dayExpenses = data ? data.expenses.filter(e => cfg.expenseAmount(e) > 0) : [];

  // Merge receipts and payments into one chronological list — receipts as
  // debits, payments as credits — matching a standard single-column cash
  // book rather than the old side-by-side two-table layout.
  const transactions = [
    ...dayReceipts.map(r => ({
      key: 'r-' + r.receipt_number,
      time: r.collected_at,
      particulars: `${r.receipt_number}${r.student_name ? ' — ' + r.student_name : ''}`,
      debit: r.amount, credit: 0,
    })),
    ...dayExpenses.map(e => ({
      key: 'e-' + e.expense_id,
      time: e.expense_date,
      particulars: `${e.category} — ${e.description}`,
      debit: 0, credit: cfg.expenseAmount(e),
    })),
  ].sort((a, b) => String(a.time).localeCompare(String(b.time)));

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
          {data && (
            <button onClick={() => setShowPrint(true)}
              className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              🖨️ Print
            </button>
          )}
        </div>
        {data && (
          <div className={`ml-auto flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
            ${balanced ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
            {balanced ? '✅ Balanced' : '⚠ Not Balanced'}
          </div>
        )}
      </div>

      {/* On-screen view — plain, scrollable, no print styling or pagination;
          the full letterhead/paginated version lives only in the print
          preview modal below. */}
      {data && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className={cfg.headerBg}>
              <tr>
                <th className="px-4 py-2.5 text-left text-xs text-white/90 font-semibold">Date</th>
                <th className="px-4 py-2.5 text-left text-xs text-white/90 font-semibold">Particulars</th>
                <th className="px-4 py-2.5 text-right text-xs text-white/90 font-semibold">Debit (₹)</th>
                <th className="px-4 py-2.5 text-right text-xs text-white/90 font-semibold">Credit (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr className="bg-amber-50 font-semibold">
                <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(date)}</td>
                <td className="px-4 py-2.5 text-amber-700">Opening Balance</td>
                <td className="px-4 py-2.5 text-right text-amber-700">{fmtINR(opening)}</td>
                <td className="px-4 py-2.5"></td>
              </tr>
              {transactions.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-gray-400 text-sm py-6">No transactions for this date</td></tr>
              ) : transactions.map((t, i) => (
                <tr key={t.key} className={i%2===0?'bg-white':'bg-gray-50'}>
                  <td className="px-4 py-2 text-xs text-gray-500">{fmtDate(date)}</td>
                  <td className="px-4 py-2 text-gray-800 truncate" title={t.particulars}>{t.particulars}</td>
                  <td className={`px-4 py-2 text-right font-medium ${cfg.amountColor}`}>{t.debit ? fmt(t.debit) : ''}</td>
                  <td className="px-4 py-2 text-right font-medium text-red-600">{t.credit ? fmt(t.credit) : ''}</td>
                </tr>
              ))}
              <tr className="bg-blue-50 font-bold border-t-2 border-blue-200">
                <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(date)}</td>
                <td className="px-4 py-3 text-blue-700">Closing Balance (C/F)</td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right text-blue-700">{fmtINR(closing)}</td>
              </tr>
              <tr className="bg-gray-100 font-bold border-t border-gray-300">
                <td className="px-4 py-2.5" colSpan={2}>Grand Total</td>
                <td className="px-4 py-2.5 text-right">{fmtINR(opening + receipts)}</td>
                <td className="px-4 py-2.5 text-right">{fmtINR(expenses + closing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {showPrint && (
        <LedgerPrintModal mode={mode} date={date} academicYear={academicYear}
          opening={opening} receipts={receipts} expenses={expenses} closing={closing}
          transactions={transactions} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}

// ── Print preview modal — letterhead + measured pagination. Receives
// already-loaded data as props (never fetches its own), so the hidden
// measurement pass is safe to run once on mount, same as every other
// print-preview modal in this app. ──
function LedgerPrintModal({ mode, date, academicYear, opening, receipts, expenses, closing, transactions, onClose }) {
  const cfg = MODE[mode];

  const letterhead = (
    <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
      <h1 className="text-xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
      <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
      <h2 className="text-base font-bold mt-2">{cfg.title}</h2>
      <p className="text-sm text-gray-600">{fmtDate(date)} · {academicYear}</p>
    </div>
  );

  const headerRow = (
    <tr className="bg-gray-100">
      <th className="border border-gray-400 px-4 py-2.5 text-left text-xs text-gray-700 font-semibold">Date</th>
      <th className="border border-gray-400 px-4 py-2.5 text-left text-xs text-gray-700 font-semibold">Particulars</th>
      <th className="border border-gray-400 px-4 py-2.5 text-right text-xs text-gray-700 font-semibold">Debit (₹)</th>
      <th className="border border-gray-400 px-4 py-2.5 text-right text-xs text-gray-700 font-semibold">Credit (₹)</th>
    </tr>
  );

  const txnRow = (t, i) => (
    <tr key={t.key} className={i%2===0?'bg-white':'bg-gray-50'}>
      <td className="border border-gray-300 px-4 py-2 text-xs text-gray-500">{fmtDate(date)}</td>
      <td className="border border-gray-300 px-4 py-2 text-gray-800 truncate" title={t.particulars}>{t.particulars}</td>
      <td className="border border-gray-300 px-4 py-2 text-right font-medium text-black">{t.debit ? fmt(t.debit) : ''}</td>
      <td className="border border-gray-300 px-4 py-2 text-right font-medium text-black">{t.credit ? fmt(t.credit) : ''}</td>
    </tr>
  );

  const letterheadRef   = useRef(null);
  const headerRowRef    = useRef(null);
  const openingRowRef   = useRef(null);
  const closingBlockRef = useRef(null);
  const sampleRowRef    = useRef(null);
  const [rowsPerPage, setRowsPerPage] = useState(null);

  useLayoutEffect(() => {
    const letterheadH = letterheadRef.current?.offsetHeight   || 90;
    const headerH      = headerRowRef.current?.offsetHeight    || 26;
    const openingH     = openingRowRef.current?.offsetHeight   || 30;
    const closingH     = closingBlockRef.current?.offsetHeight || 56;
    const rowH         = sampleRowRef.current?.offsetHeight    || 20;
    const available = LEDGER_PAGE_CONTENT_HEIGHT_PX - letterheadH - headerH - openingH - closingH - LEDGER_PAGE_FOOTER_RESERVE_PX;
    setRowsPerPage(Math.max(5, Math.floor(available / rowH)));
    // eslint-disable-next-line
  }, []);

  const ready = rowsPerPage !== null;
  const pages = [];
  if (ready) {
    for (let i = 0; i < transactions.length; i += rowsPerPage) pages.push(transactions.slice(i, i + rowsPerPage));
    if (pages.length === 0) pages.push([]);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">{cfg.title} Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!ready}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {!ready ? (
            <div style={{ position: 'fixed', left: -9999, top: 0, width: LEDGER_PAGE_CONTENT_WIDTH_PX }}>
              <div ref={letterheadRef}>{letterhead}</div>
              <table className="w-full text-sm">
                <thead><tr ref={headerRowRef} className="bg-gray-100">{headerRow.props.children}</tr></thead>
                <tbody>
                  <tr ref={openingRowRef} className="bg-gray-50 font-semibold">
                    <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(date)}</td>
                    <td className="px-4 py-2.5 text-gray-800">Opening Balance</td>
                    <td className="px-4 py-2.5 text-right text-gray-800">{fmtINR(opening)}</td>
                    <td className="px-4 py-2.5"></td>
                  </tr>
                  {transactions[0] && <tr ref={sampleRowRef}>{txnRow(transactions[0], 0).props.children}</tr>}
                </tbody>
              </table>
              <div ref={closingBlockRef}>
                <table className="w-full text-sm">
                  <tbody>
                    <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                      <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(date)}</td>
                      <td className="px-4 py-3 text-gray-800">Closing Balance (C/F)</td>
                      <td className="px-4 py-3"></td>
                      <td className="px-4 py-3 text-right text-black">{fmtINR(closing)}</td>
                    </tr>
                    <tr className="bg-gray-100 font-bold border-t border-gray-300">
                      <td className="px-4 py-2.5" colSpan={2}>Grand Total</td>
                      <td className="px-4 py-2.5 text-right">{fmtINR(opening + receipts)}</td>
                      <td className="px-4 py-2.5 text-right">{fmtINR(expenses + closing)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="print-root">
              {pages.map((pageRows, pageIdx) => (
                <div key={pageIdx}
                  className="border border-gray-300 p-6 text-sm print:border-none mb-4 print:mb-0"
                  style={pageIdx < pages.length - 1 ? { breakAfter: 'page' } : undefined}>
                  {letterhead}
                  <table className="w-full text-sm">
                    <thead>{headerRow}</thead>
                    <tbody className="divide-y divide-gray-100">
                      {pageIdx === 0 && (
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(date)}</td>
                          <td className="px-4 py-2.5 text-gray-800">Opening Balance</td>
                          <td className="px-4 py-2.5 text-right text-gray-800">{fmtINR(opening)}</td>
                          <td className="px-4 py-2.5"></td>
                        </tr>
                      )}
                      {transactions.length === 0 && pageIdx === 0 ? (
                        <tr><td colSpan={4} className="text-center text-gray-400 text-sm py-6">No transactions for this date</td></tr>
                      ) : pageRows.map(txnRow)}
                      {pageIdx === pages.length - 1 && (
                        <>
                          <tr className="bg-gray-100 font-bold border-t-2 border-gray-400">
                            <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(date)}</td>
                            <td className="px-4 py-3 text-gray-800">Closing Balance (C/F)</td>
                            <td className="px-4 py-3"></td>
                            <td className="px-4 py-3 text-right text-black">{fmtINR(closing)}</td>
                          </tr>
                          <tr className="bg-gray-100 font-bold border-t border-gray-300">
                            <td className="px-4 py-2.5" colSpan={2}>Grand Total</td>
                            <td className="px-4 py-2.5 text-right">{fmtINR(opening + receipts)}</td>
                            <td className="px-4 py-2.5 text-right">{fmtINR(expenses + closing)}</td>
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                  <div className="grid grid-cols-3 text-xs text-gray-500 mt-2">
                    <span></span>
                    <span className="text-center">Page {pageIdx + 1} of {pages.length}</span>
                    <span></span>
                  </div>
                  <PrintFooter />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Enter Expense ──────────────────────────────────────
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

  const startEdit = (e) => {
    setEditId(e.expense_id); setCategory(e.category); setDesc(e.description);
    setCashAmt(e.cash_amount || ''); setBankAmt(e.bank_amount || '');
  };

  const cancelEdit = () => { setEditId(null); setDesc(''); setCashAmt(''); setBankAmt(''); setCategory('Salary'); };

  const del = async (expense_id) => {
    if (!window.confirm('Delete this expense entry?')) return;
    const res = await window.api.cashbookDeleteExpense(expense_id);
    if (res.success) loadRecent();
  };

  return (
    <div className="max-w-3xl">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-5">
        <h3 className="font-bold text-gray-800 mb-4">{editId ? 'Edit Expense' : 'Add Expense'}</h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
            <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
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
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Electricity bill for September"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Cash Amount</label>
            <input type="number" min="0" value={cashAmt} onChange={e => setCashAmt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Bank Amount</label>
            <input type="number" min="0" value={bankAmt} onChange={e => setBankAmt(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        {saved && <p className="text-green-600 text-sm mb-3">✅ Saved</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
            {saving ? 'Saving…' : editId ? 'Update Expense' : 'Add Expense'}
          </button>
          {editId && (
            <button onClick={cancelEdit} className="px-6 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <h3 className="font-bold text-gray-800 px-5 py-3 border-b border-gray-100">Expenses on {fmtDate(date)}</h3>
        {recent.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">No expenses entered for this date</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-100">
              {recent.map(e => (
                <tr key={e.expense_id}>
                  <td className="px-5 py-2.5 text-gray-500 text-xs">{e.category}</td>
                  <td className="px-5 py-2.5 text-gray-800">{e.description}</td>
                  <td className="px-5 py-2.5 text-right text-red-600">{e.cash_amount > 0 ? `Cash ${fmtINR(e.cash_amount)}` : ''}</td>
                  <td className="px-5 py-2.5 text-right text-orange-600">{e.bank_amount > 0 ? `Bank ${fmtINR(e.bank_amount)}` : ''}</td>
                  <td className="px-5 py-2.5 text-right">
                    <button onClick={() => startEdit(e)} className="text-xs text-blue-600 hover:underline mr-3">Edit</button>
                    <button onClick={() => del(e.expense_id)} className="text-xs text-red-600 hover:underline">Delete</button>
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

// ── Monthly Report: one single-currency table (Cash or Bank) ───
function MonthlyLedgerTable({ mode, academicYear, onJumpToDate }) {
  const cfg = MODE[mode];
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.cashbookGetMonthlySummary(academicYear);
    if (res.success) setData(res.data);
    setLoading(false);
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const inKey  = mode === 'cash' ? 'cash_in'  : 'bank_in';
  const outKey = mode === 'cash' ? 'cash_out' : 'bank_out';

  const [expandedKey, setExpandedKey] = useState(null);
  useEffect(() => { setExpandedKey(null); }, [academicYear]);
  const [days,        setDays]        = useState([]);
  const [daysLoading,  setDaysLoading] = useState(false);

  const toggleMonth = async (r) => {
    if (expandedKey === r.key) { setExpandedKey(null); return; }
    setExpandedKey(r.key); setDays([]); setDaysLoading(true);
    const res = await window.api.cashbookGetMonthDays(academicYear, r.year, r.month);
    setDaysLoading(false);
    if (res.success) setDays(res.days);
  };

  const totalIn  = data.reduce((s,r) => s+r[inKey],  0);
  const totalOut = data.reduce((s,r) => s+r[outKey], 0);

  let runBal = 0;
  const withRunning = data.map(r => {
    runBal += (r[inKey] - r[outKey]);
    return { ...r, cumBal: runBal };
  });

  return (
    <div className="mb-8">
      <h3 className="font-bold text-gray-800 mb-3">{cfg.icon} {cfg.title} — Monthly</h3>
      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className={cfg.headerBg}>
              <tr>
                <th className="px-3 py-3 w-8 print:hidden"></th>
                {['Month','Receipts','Payments','Net','Balance'].map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs text-white/80 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {withRunning.map((r, i) => {
                const net    = r[inKey] - r[outKey];
                const isOpen = expandedKey === r.key;
                return (
                  <React.Fragment key={r.key}>
                  <tr onClick={() => toggleMonth(r)}
                    className={`cursor-pointer hover:bg-blue-50 print:cursor-auto print:hover:bg-transparent ${i%2===0?'bg-white':'bg-gray-50'}`}>
                    <td className="px-3 py-2.5 text-center text-gray-400 print:hidden">
                      <span className={`inline-block transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-gray-800">{r.monthName} {r.year}</td>
                    <td className={`px-3 py-2.5 font-medium ${cfg.amountColor}`}>{fmtINR(r[inKey])}</td>
                    <td className="px-3 py-2.5 font-medium text-red-600">{fmtINR(r[outKey])}</td>
                    <td className={`px-3 py-2.5 font-bold ${net>=0?'text-green-700':'text-red-600'}`}>{fmtINR(net)}</td>
                    <td className={`px-3 py-2.5 font-bold ${r.cumBal>=0?cfg.amountColor:'text-red-600'}`}>{fmtINR(r.cumBal)}</td>
                  </tr>
                  {isOpen && (
                    <tr className="print:hidden">
                      <td colSpan={6} className="bg-gray-50 px-3 py-3">
                        {daysLoading ? (
                          <div className="text-center py-6 text-gray-400 text-sm">Loading days…</div>
                        ) : (
                          <table className="w-full text-xs bg-white border border-gray-200 rounded-xl overflow-hidden">
                            <thead className="bg-gray-100">
                              <tr>
                                {['Date','Opening','Receipts','Payments','Closing'].map(h => (
                                  <th key={h} className="px-2 py-2 text-left text-gray-500 font-semibold">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {days.map(d => {
                                const rec = d[cfg.receiptsKey], exp = d[cfg.expensesKey];
                                const hasActivity = rec || exp;
                                return (
                                  <tr key={d.date} onClick={() => onJumpToDate(d.date)}
                                    className={`cursor-pointer hover:bg-blue-50 ${hasActivity ? '' : 'text-gray-300'}`}>
                                    <td className="px-2 py-1.5 font-medium text-blue-700">{fmtDate(d.date)}</td>
                                    <td className="px-2 py-1.5">{fmtINR(d[cfg.openingKey])}</td>
                                    <td className={`px-2 py-1.5 ${rec ? cfg.amountColor + ' font-medium' : ''}`}>{fmtINR(rec)}</td>
                                    <td className={`px-2 py-1.5 ${exp ? 'text-red-600 font-medium' : ''}`}>{fmtINR(exp)}</td>
                                    <td className="px-2 py-1.5 font-semibold">{fmtINR(d[cfg.closingKey])}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                        <p className="text-xs text-gray-400 mt-2">Click any day to open it in the {cfg.title} tab.</p>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {data.length === 0 && (
                <tr><td colSpan={6} className="text-center py-10 text-gray-400">No data for {academicYear}</td></tr>
              )}
            </tbody>
            <tfoot className="bg-gray-100 border-t-2 border-gray-300">
              <tr>
                <td className="px-3 py-3 print:hidden"></td>
                <td className="px-3 py-3 font-bold text-gray-700">TOTAL</td>
                <td className={`px-3 py-3 font-bold ${cfg.amountColor}`}>{fmtINR(totalIn)}</td>
                <td className="px-3 py-3 font-bold text-red-600">{fmtINR(totalOut)}</td>
                <td className={`px-3 py-3 font-bold ${(totalIn-totalOut)>=0?'text-green-700':'text-red-600'}`}>{fmtINR(totalIn-totalOut)}</td>
                <td className={`px-3 py-3 font-bold ${cfg.amountColor}`}>{fmtINR(runBal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab: Monthly Report (both Cash and Bank tables) ─────────────
function MonthlyReportTab({ academicYear, setAcademicYear, onJumpToDate }) {
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
      <div className="print-root bg-white">
        <div className="p-4 pb-0">
          <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
            <h1 className="text-xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
            <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
            <h2 className="text-base font-bold mt-2">Monthly Report</h2>
            <p className="text-sm text-gray-600">{academicYear}</p>
          </div>
        </div>
        <MonthlyLedgerTable mode="cash" academicYear={academicYear} onJumpToDate={(d) => onJumpToDate('cash', d)} />
        <MonthlyLedgerTable mode="bank" academicYear={academicYear} onJumpToDate={(d) => onJumpToDate('bank', d)} />
        <PrintFooter />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
// ── Starting point — lets Opening Balance / Monthly figures start counting
// from a chosen date instead of the beginning of the academic year. Purely
// a read-time filter: no transaction is ever changed or deleted. ──
function StartingPointModal({ current, onClose, onSaved }) {
  const { user } = useAuth();
  const [value,  setValue]  = useState(current || TODAY);
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const save = async (dateStr) => {
    setSaving(true); setError('');
    const res = await window.api.cashbookSetResetDate(dateStr, user?.username || '');
    setSaving(false);
    if (!res.success) { setError(res.message || 'Could not save.'); return; }
    onSaved(res.reset_date);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-gray-800 text-lg mb-1">Cash Book Starting Point</h3>
        <p className="text-sm text-gray-500 mb-4">
          Choose the date balances should start counting from. Everything before it stops being added into
          Opening Balance and the Monthly Report. <strong>No transactions are deleted or changed</strong> —
          you can move or clear this date at any time.
        </p>
        <label className="block text-xs font-medium text-gray-500 mb-1">Start counting from</label>
        <input type="date" value={value} onChange={e => setValue(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => save(value)} disabled={saving || !value}
            className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
            {saving ? 'Saving…' : 'Save'}
          </button>
          {current && (
            <button onClick={() => save('')} disabled={saving}
              className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Clear (count from year start)
            </button>
          )}
          <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm ml-auto">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CashBook() {
  const [tab,          setTab]          = useState('cash');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [date,         setDate]         = useState(TODAY);
  const [resetDate,    setResetDate]    = useState('');
  const [showStart,    setShowStart]    = useState(false);
  // Bumped after the starting point changes so the active tab remounts and
  // re-fetches its figures instead of showing stale balances.
  const [version,      setVersion]      = useState(0);

  useEffect(() => {
    window.api.cashbookGetSettings().then(r => { if (r.success) setResetDate(r.reset_date || ''); });
  }, []);

  const TABS = [
    { key: 'cash',    label: '📒 Cash Book'      },
    { key: 'bank',    label: '🏦 Bank Book'      },
    { key: 'expense', label: '💸 Enter Expense'  },
    { key: 'monthly', label: '📊 Monthly Report' },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Cash Book</h2>
          <p className="text-sm text-gray-500 mt-0.5">Cash and bank kept as two separate ledgers — receipts from fee collections, payments from manual expense entries</p>
        </div>
        <button onClick={() => setShowStart(true)}
          className="shrink-0 text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-lg px-3 py-2 text-left">
          <span className="block text-gray-400">Balances counting from</span>
          <span className="font-semibold text-gray-700">{resetDate ? fmtDate(resetDate) : 'Start of academic year'}</span>
          <span className="text-blue-600 ml-2">Change</span>
        </button>
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

      {tab === 'cash'    && <LedgerTab key={'c'+version} mode="cash" academicYear={academicYear} setAcademicYear={setAcademicYear} date={date} setDate={setDate} />}
      {tab === 'bank'    && <LedgerTab key={'b'+version} mode="bank" academicYear={academicYear} setAcademicYear={setAcademicYear} date={date} setDate={setDate} />}
      {tab === 'expense' && <ExpenseTab academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'monthly' && <MonthlyReportTab key={'m'+version} academicYear={academicYear} setAcademicYear={setAcademicYear}
                               onJumpToDate={(mode, d) => { setDate(d); setTab(mode); }} />}

      {showStart && (
        <StartingPointModal current={resetDate} onClose={() => setShowStart(false)}
          onSaved={(d) => { setResetDate(d); setVersion(v => v + 1); setShowStart(false); }} />
      )}
    </div>
  );
}
