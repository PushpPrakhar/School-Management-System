import React, { useState, useEffect, useCallback } from 'react';
import PaperReceiptModal from '../components/PaperReceiptModal';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS        = Array.from({ length: 4 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });
const TODAY        = new Date().toISOString().slice(0, 10);
const CLASSES      = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5','Class 6','Class 7','Class 8'];
const MODE_ORDER   = ['CASH','CHEQUE','ONLINE','UPI','IMPS','RTGS','ADJUSTMENT'];
const MODE_COLORS  = { CASH:'bg-green-100 text-green-700', CHEQUE:'bg-indigo-100 text-indigo-700', ONLINE:'bg-blue-100 text-blue-700', UPI:'bg-blue-100 text-blue-700', IMPS:'bg-purple-100 text-purple-700', RTGS:'bg-orange-100 text-orange-700', ADJUSTMENT:'bg-gray-100 text-gray-600' };
const HISTORY_MONTHS = [
  ['04','April'],['05','May'],['06','June'],['07','July'],['08','August'],['09','September'],
  ['10','October'],['11','November'],['12','December'],['01','January'],['02','February'],['03','March'],
];
const fmt          = (n) => Number(n||0).toFixed(2);
const fmtINR       = (n) => '₹' + fmt(n);
const fmtDate      = (d) => d ? String(d).slice(0,10).split('-').reverse().join('-') : '—';

function amountToWords(amount) {
  const num = Math.floor(amount);
  if (num === 0) return 'Zero Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const convert = (n) => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' '+ones[n%10] : '');
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' '+convert(n%100) : '');
    if (n < 100000) return convert(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' '+convert(n%1000) : '');
    if (n < 10000000) return convert(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' '+convert(n%100000) : '');
    return convert(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' '+convert(n%10000000) : '');
  };
  return convert(num) + ' Only';
}

// ── Tab 1: Receipt Reprint ────────────────────────────────────
function ReprintTab({ academicYear, setAcademicYear }) {
  const [query,   setQuery]   = useState('');
  const [openReceipt, setOpenReceipt] = useState(null); // receipt number currently shown in modal
  const [error,   setError]   = useState('');

  const search = () => {
    if (!query.trim()) return;
    setError('');
    setOpenReceipt(query.trim());
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-500 mb-1">Receipt Number</label>
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. 2026-001"
            className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={search}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
          🔍 Search
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {openReceipt && (
        <PaperReceiptModal receiptNumber={openReceipt} academicYear={academicYear} onClose={() => setOpenReceipt(null)} />
      )}
    </div>
  );
}

// ── Tab 2: Daily Payout ───────────────────────────────────────
function PayoutTab({ academicYear, setAcademicYear }) {
  const [date,      setDate]      = useState(TODAY);
  const [centerId,  setCenterId]  = useState(1);
  const [modeFilter,setModeFilter]= useState('ALL');
  const [centers,   setCenters]   = useState([]);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  useEffect(() => {
    window.api.centersGetAll().then(r => { if (r.success) setCenters(r.centers); });
  }, []);

  const generate = async () => {
    setLoading(true); setError(''); setData(null);
    const res = await window.api.reportsGetDailyPayout(centerId, date, academicYear, modeFilter);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res);
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Center</label>
          <select value={centerId} onChange={e => setCenterId(parseInt(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none min-w-44">
            {centers.map(c => <option key={c.center_id} value={c.center_id}>{c.center_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Payment Mode</label>
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            <option value="ALL">All Modes</option>
            {MODE_ORDER.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:bg-blue-300">
          {loading ? '⏳' : '📊 Generate'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {data && (
        <div className="print-root">
          <div className="flex justify-between items-center mb-3 print:hidden">
            <p className="text-sm font-medium text-gray-700">
              Payout for {fmtDate(date)} — {data.center?.center_name || 'All Centers'}
            </p>
            <button onClick={() => window.print()}
              className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              🖨️ Print
            </button>
          </div>
          <p className="hidden print:block text-sm font-medium text-gray-700 mb-3">
            Payout for {fmtDate(date)} — {data.center?.center_name || 'All Centers'}
          </p>

          {/* Grand total */}
          <div className="bg-blue-700 rounded-2xl p-4 mb-4 flex justify-between items-center text-white">
            <div>
              <p className="text-blue-200 text-xs">Grand Total Collections</p>
              <p className="text-3xl font-bold">{fmtINR(data.grand)}</p>
            </div>
            <div className="text-right">
              <p className="text-blue-200 text-xs">Total Receipts</p>
              <p className="text-2xl font-bold">{data.total}</p>
            </div>
          </div>

          {/* By mode */}
          {MODE_ORDER.filter(m => data.byMode[m]).map(m => (
            <div key={m} className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-3">
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${MODE_COLORS[m]}`}>{m}</span>
                  <span className="text-sm text-gray-500">{data.byMode[m].count} receipt{data.byMode[m].count!==1?'s':''}</span>
                </div>
                <span className="font-bold text-lg text-gray-800">{fmtINR(data.byMode[m].amount)}</span>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['Receipt No','Student','Class','Amount','Source','Collected By'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.byMode[m].rows.map((r, i) => (
                    <tr key={r.receipt_number} className={i%2===0?'bg-white':'bg-gray-50'}>
                      <td className="px-3 py-2 font-mono font-bold text-blue-700">{r.receipt_number}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.student_name || r.sl_number}</td>
                      <td className="px-3 py-2 text-gray-500">{r.current_class || '—'}</td>
                      <td className="px-3 py-2 font-bold text-green-700">{fmtINR(r.amount_paid)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${r.source==='POSTED'?'bg-green-100 text-green-700':'bg-amber-100 text-amber-700'}`}>
                          {r.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400">{r.collected_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {data.total === 0 && (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">📭</p>
              <p>No collections found for {fmtDate(date)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Defaulter List ─────────────────────────────────────
function DefaulterTab({ academicYear, setAcademicYear }) {
  const [cls,      setCls]      = useState('');
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [notice,   setNotice]   = useState(null); // student to show notice for

  const generate = async () => {
    setLoading(true); setError(''); setData(null);
    const res = await window.api.reportsGetDefaulters(academicYear, cls || null);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res.data);
  };

  const totalDue = (data || []).reduce((s, r) => s + r.balance, 0);

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class (optional)</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none min-w-36">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={generate} disabled={loading}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:bg-blue-300">
          {loading ? '⏳' : '🔍 Generate List'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {data && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex gap-4">
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-center">
                <p className="text-xl font-bold text-red-600">{data.length}</p>
                <p className="text-xs text-red-400">Defaulters</p>
              </div>
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-center">
                <p className="text-xl font-bold text-red-600">{fmtINR(totalDue)}</p>
                <p className="text-xs text-red-400">Total Outstanding</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setNotice('ALL')}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium">
                📄 Print All Notices
              </button>
              <button onClick={() => window.print()}
                className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
                🖨️ Print List
              </button>
            </div>
          </div>

          {data.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p className="text-4xl mb-3">🎉</p>
              <p className="font-medium">No defaulters! All fees are paid up.</p>
            </div>
          ) : (
            <div className="print-root bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['SL No','Student Name','Class','Father','Mobile','Balance Due','Last Payment',''].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.map((r, i) => (
                    <tr key={r.ledger_id} className={i%2===0?'bg-white':'bg-red-50'}>
                      <td className="px-4 py-2.5 font-bold text-blue-700 text-xs">{r.sl_number}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{r.student_name}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{r.current_class} {r.section}</td>
                      <td className="px-4 py-2.5 text-gray-600">{r.father_name || '—'}</td>
                      <td className="px-4 py-2.5 text-gray-500 text-xs">{r.mobile_number || '—'}</td>
                      <td className="px-4 py-2.5 font-bold text-red-600 text-base">{fmtINR(r.balance)}</td>
                      <td className="px-4 py-2.5 text-gray-400 text-xs">{r.last_payment ? String(r.last_payment).slice(0,10).split('-').reverse().join('-') : 'Never'}</td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => setNotice(r)}
                          className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-2 py-1 rounded-lg">
                          Notice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Fees Notice Modal */}
      {notice && (
        <NoticeModal
          students={notice === 'ALL' ? data : [notice]}
          academicYear={academicYear}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  );
}

// ── Tab 4: Receipt History ──────────────────────────────────────
function HistoryTab({ academicYear, setAcademicYear }) {
  const nowMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const nowYear  = String(new Date().getFullYear());
  const [month,    setMonth]    = useState(nowMonth);
  const [year,     setYear]     = useState(nowYear);
  const [cls,      setCls]      = useState('');
  const [search,   setSearch]   = useState('');
  const [sortBy,   setSortBy]   = useState('date');   // 'date' | 'amount' | 'receipt'
  const [sortDir,  setSortDir]  = useState('desc');   // 'asc' | 'desc'
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [openReceipt, setOpenReceipt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.reportsGetReceiptHistory(academicYear, month, year, cls || null);
    setLoading(false);
    if (!res.success) { setError(res.message); setRows([]); return; }
    setRows(res.data);
  }, [academicYear, month, year, cls]);

  useEffect(() => { load(); }, [load]);

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir(key === 'receipt' ? 'asc' : 'desc'); }
  };

  const filtered = rows.filter(r => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (r.student_names || '').toLowerCase().includes(q)
        || (r.sl_numbers || '').toLowerCase().includes(q)
        || (r.gsl_number || '').toLowerCase().includes(q)
        || (r.receipt_number || '').toLowerCase().includes(q)
        || (r.paid_by || '').toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'date')    cmp = String(a.date).localeCompare(String(b.date));
    if (sortBy === 'amount')  cmp = (a.total_paid || 0) - (b.total_paid || 0);
    if (sortBy === 'receipt') cmp = String(a.receipt_number).localeCompare(String(b.receipt_number));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const grandTotal = filtered.reduce((s, r) => s + (r.total_paid || 0), 0);
  const sortArrow = (key) => sortBy === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {HISTORY_MONTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {[SESSION_YEAR - 1, SESSION_YEAR, SESSION_YEAR + 1].map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Student name, SL/GSL, receipt no, or paid by..."
            className="w-full border border-gray-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
          <p className="text-sm font-semibold text-gray-700">
            {HISTORY_MONTHS.find(m => m[0] === month)?.[1]} {year} — {sorted.length} receipt{sorted.length !== 1 ? 's' : ''}
          </p>
          <p className="text-sm font-bold text-gray-800">Total: {fmtINR(grandTotal)}</p>
        </div>

        {loading ? (
          <p className="text-center text-gray-400 py-10">⏳ Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-center text-gray-400 py-10">No receipts found for this month{cls ? ` in ${cls}` : ''}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 text-left cursor-pointer select-none" onClick={() => toggleSort('receipt')}>Receipt No{sortArrow('receipt')}</th>
                  <th className="px-4 py-2.5 text-left cursor-pointer select-none" onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                  <th className="px-4 py-2.5 text-left">Student(s)</th>
                  <th className="px-4 py-2.5 text-left">SL / GSL</th>
                  <th className="px-4 py-2.5 text-left">Paid By</th>
                  <th className="px-4 py-2.5 text-left">Mode</th>
                  <th className="px-4 py-2.5 text-right cursor-pointer select-none" onClick={() => toggleSort('amount')}>Amount{sortArrow('amount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map(r => (
                  <tr key={r.receipt_number} onClick={() => setOpenReceipt(r.receipt_number)}
                    className="hover:bg-blue-50 cursor-pointer">
                    <td className="px-4 py-2.5 font-bold text-blue-700">{r.receipt_number}</td>
                    <td className="px-4 py-2.5 text-gray-600">{fmtDate(r.date)}</td>
                    <td className="px-4 py-2.5">
                      {r.student_names}
                      {r.student_count > 1 && <span className="text-xs text-purple-500 ml-1">({r.student_count} students)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.gsl_number || r.sl_numbers}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.paid_by || '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${MODE_COLORS[r.payment_mode] || 'bg-gray-100 text-gray-600'}`}>{r.payment_mode}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-green-700">{fmtINR(r.total_paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openReceipt && (
        <PaperReceiptModal receiptNumber={openReceipt} academicYear={academicYear} onClose={() => setOpenReceipt(null)} />
      )}
    </div>
  );
}


// ── Fees Notice Modal ─────────────────────────────────────────
function NoticeModal({ students, academicYear, onClose }) {
  const printDate = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'long', year:'numeric' });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h3 className="font-bold text-gray-800">Fees Notice — {students.length} Student{students.length!==1?'s':''}</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              🖨️ Print All
            </button>
            <button onClick={onClose}
              className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="print-root overflow-y-auto flex-1 p-4 space-y-6">
          {students.map((s, i) => (
            <div key={s.ledger_id} className={`border border-gray-300 rounded-xl p-6 ${i > 0 ? 'break-before-page' : ''}`}>
              {/* Header */}
              <div className="text-center border-b border-gray-300 pb-3 mb-4">
                <h1 className="text-lg font-bold">BRILLIANT PUBLIC SCHOOL</h1>
                <p className="text-xs text-gray-600">(A Govt. Recognised English Medium School)</p>
                <p className="text-xs text-gray-500">Village Sherpur-Nayser, Post-Jawal, Bulandshahr, UP-203131</p>
              </div>

              {/* Address block */}
              <div className="mb-4 text-sm">
                <p>To,</p>
                <p className="font-semibold">{s.father_name || 'Parent/Guardian'}</p>
                <p>Parent/Guardian of: <span className="font-semibold">{s.student_name}</span></p>
                <p>Class: {s.current_class} {s.section}</p>
              </div>

              <p className="text-sm font-bold underline mb-3 text-center">
                Subject: Reminder for Pending School Fees — {academicYear}
              </p>

              <p className="text-sm mb-3">Dear Parent/Guardian,</p>
              <p className="text-sm mb-4">
                This is to inform you that school fees amounting to{' '}
                <strong>₹{Number(s.balance).toFixed(2)} (Rs. {amountToWords(s.balance)})</strong>{' '}
                are outstanding against your ward <strong>{s.student_name}</strong> for the academic year <strong>{academicYear}</strong>.
              </p>

              <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm">
                <div className="flex justify-between font-bold">
                  <span>Total Amount Due:</span>
                  <span className="text-red-600">{fmtINR(s.balance)}</span>
                </div>
                {s.last_payment && (
                  <div className="flex justify-between text-gray-600 text-xs mt-1">
                    <span>Last Payment Date:</span>
                    <span>{String(s.last_payment).slice(0,10).split('-').reverse().join('-')}</span>
                  </div>
                )}
              </div>

              <p className="text-sm mb-4">
                Kindly clear the above outstanding dues at the school fee counter at the earliest. Please note that
                a late fee of <strong>₹5 per day</strong> is applicable after the 10th of each month. Continued
                non-payment may affect your ward's examination admit card and other school services.
              </p>

              <p className="text-sm mb-6">We appreciate your cooperation in this matter. Thank you.</p>

              <div className="flex justify-between text-sm">
                <div>
                  <p>Date: {printDate}</p>
                  <p className="text-gray-500 text-xs mt-1">Ledger No: {s.sl_number}</p>
                </div>
                <div className="text-center">
                  <p className="border-t border-gray-400 w-36 mt-8 text-xs text-gray-500">Principal's Signature</p>
                </div>
              </div>

              <p className="text-xs text-center text-gray-400 mt-3 border-t border-gray-200 pt-2">
                This is a computer generated notice from School Management System, Brilliant Public School.
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function FeeReports() {
  const [tab,          setTab]          = useState('reprint');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);

  const TABS = [
    { key: 'reprint',   label: '🖨️ Receipt Reprint'   },
    { key: 'history',   label: '📜 Receipt History'    },
    { key: 'payout',    label: '📊 Daily Payout List'  },
    { key: 'defaulters',label: '🔴 Defaulter List'     },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Fee Reports</h2>
        <p className="text-sm text-gray-500 mt-0.5">Reprint receipts, view payout lists and manage defaulters</p>
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

      {tab === 'reprint'    && <ReprintTab   academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'history'    && <HistoryTab   academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'payout'     && <PayoutTab    academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'defaulters' && <DefaulterTab academicYear={academicYear} setAcademicYear={setAcademicYear} />}
    </div>
  );
}
