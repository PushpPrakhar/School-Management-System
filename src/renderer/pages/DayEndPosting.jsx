import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const SESSION_YEAR  = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR  = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS         = Array.from({ length: 4 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });
const TODAY         = new Date().toISOString().slice(0, 10);
const fmt           = (n) => '₹' + Number(n || 0).toFixed(2);
const fmtDate       = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';
const MODE_COLORS   = { CASH: 'bg-green-100 text-green-700', UPI: 'bg-blue-100 text-blue-700', IMPS: 'bg-purple-100 text-purple-700', RTGS: 'bg-orange-100 text-orange-700', ADJUSTMENT: 'bg-gray-100 text-gray-600' };
const MODE_ORDER    = ['CASH', 'UPI', 'IMPS', 'RTGS', 'ADJUSTMENT'];

// ── Shared Selectors ──────────────────────────────────────────
function Selectors({ date, setDate, centerId, setCenterId, counterId, setCounterId, academicYear, setAcademicYear, centers, counters }) {
  const filteredCounters = counters.filter(c => c.center_id === centerId);
  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 mb-5 flex flex-wrap gap-4 items-end">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Collection Center</label>
        <select value={centerId} onChange={e => setCenterId(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-44">
          {centers.map(c => <option key={c.center_id} value={c.center_id}>{c.center_name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Counter</label>
        <select value={counterId} onChange={e => setCounterId(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value={0}>All Counters</option>
          {filteredCounters.map(c => <option key={c.counter_id} value={c.counter_id}>{c.counter_name} ({c.counter_code})</option>)}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
        <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          {YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
      </div>
    </div>
  );
}

// ── Tab 1: Post Payments ──────────────────────────────────────
function PostTab({ centers, counters, academicYear, setAcademicYear }) {
  const { user } = useAuth();
  const [date,      setDate]      = useState(TODAY);
  const [centerId,  setCenterId]  = useState(centers[0]?.center_id || 1);
  const [counterId, setCounterId] = useState(0);
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [posting,   setPosting]   = useState(false);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');
  const [confirm,   setConfirm]   = useState(false);

  const load = async () => {
    setLoading(true); setError(''); setData(null); setResult(null); setConfirm(false);
    const res = await window.api.postingGetStaged(centerId, counterId || null, date, academicYear);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res);
  };

  const post = async () => {
    setPosting(true); setError('');
    const res = await window.api.postingCreateAndPost(centerId, counterId || null, date, academicYear, user?.username);
    setPosting(false);
    if (!res.success) { setError(res.message); return; }
    setResult(res);
    setConfirm(false);
    setData(null);
  };

  const center = centers.find(c => c.center_id === centerId);
  const dt     = new Date(date);
  const ddmmyy = String(dt.getDate()).padStart(2,'0') + String(dt.getMonth()+1).padStart(2,'0') + String(dt.getFullYear()).slice(2);
  const previewId = (center?.center_code || 'BPS').replace(/-/g,'') + ddmmyy;

  return (
    <div>
      <Selectors date={date} setDate={setDate} centerId={centerId} setCenterId={setCenterId}
        counterId={counterId} setCounterId={setCounterId}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        centers={centers} counters={counters} />

      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-xs text-gray-400">Schedule ID will be: <span className="font-mono font-bold text-gray-700">{previewId}</span></p>
        </div>
        <button onClick={load} disabled={loading}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl">
          {loading ? '⏳ Loading...' : '📋 Load Pending Receipts'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {result && (
        <div className="bg-green-50 border border-green-300 rounded-2xl p-5 mb-4 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-lg font-bold text-green-700">Posted Successfully!</p>
          <p className="text-sm text-green-600 mt-1">Schedule ID: <span className="font-mono font-bold">{result.schedule_id}</span></p>
          <div className="flex justify-center gap-8 mt-3 text-sm">
            <div><p className="text-2xl font-bold text-green-700">{result.posted}</p><p className="text-green-500 text-xs">Records Posted</p></div>
            <div><p className="text-2xl font-bold text-green-700">{fmt(result.total_amount)}</p><p className="text-green-500 text-xs">Total Amount</p></div>
          </div>
        </div>
      )}

      {data && !result && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3 mb-4 lg:grid-cols-4">
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-700">{data.count}</p>
              <p className="text-xs text-gray-400 mt-0.5">Total Receipts</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{fmt(data.total)}</p>
              <p className="text-xs text-gray-400 mt-0.5">Total Amount</p>
            </div>
            {MODE_ORDER.filter(m => data.modeSummary[m]).map(m => (
              <div key={m} className="bg-white border border-gray-200 rounded-xl p-4 text-center">
                <p className="text-lg font-bold text-gray-700">{fmt(data.modeSummary[m]?.amount || 0)}</p>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MODE_COLORS[m]}`}>{m}</span>
                <p className="text-xs text-gray-400 mt-0.5">{data.modeSummary[m]?.count || 0} receipt{data.modeSummary[m]?.count !== 1 ? 's' : ''}</p>
              </div>
            ))}
          </div>

          {/* Receipt list */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
              <p className="text-sm font-semibold text-gray-700">{data.receipts.length} pending receipt{data.receipts.length !== 1 ? 's' : ''} for {fmtDate(date)}</p>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Receipt No','Student','Class','Amount','Mode','Collected At'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.receipts.map((r, i) => (
                  <tr key={r.receipt_number} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-mono font-bold text-blue-700 text-xs">{r.receipt_number}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.student_name || r.sl_number}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{r.current_class || '—'}</td>
                    <td className="px-4 py-2.5 font-bold text-green-700">{fmt(r.amount_paid)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MODE_COLORS[r.payment_mode] || 'bg-gray-100 text-gray-600'}`}>
                        {r.payment_mode}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 text-xs">{r.collected_at ? String(r.collected_at).slice(0,16).replace('T',' ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Post button */}
          {!confirm ? (
            <div className="flex justify-end">
              <button onClick={() => setConfirm(true)} disabled={data.count === 0}
                className="px-8 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-bold rounded-xl text-sm shadow-sm">
                📮 Post {data.count} Receipt{data.count !== 1 ? 's' : ''} to Ledger
              </button>
            </div>
          ) : (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="font-bold text-amber-800">Confirm Posting</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  This will post <strong>{data.count}</strong> receipts totalling <strong>{fmt(data.total)}</strong> to the main ledger.
                  <br />Schedule ID: <span className="font-mono font-bold">{previewId}</span>. This cannot be undone at counter level.
                </p>
              </div>
              <div className="flex gap-3 shrink-0 ml-4">
                <button onClick={() => setConfirm(false)}
                  className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">
                  Cancel
                </button>
                <button onClick={post} disabled={posting}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold disabled:bg-green-300">
                  {posting ? '⏳ Posting...' : '✅ Confirm & Post'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 2: Reconciliation ─────────────────────────────────────
function ReconcileTab({ centers, counters, academicYear, setAcademicYear }) {
  const [date,       setDate]       = useState(TODAY);
  const [centerId,   setCenterId]   = useState(centers[0]?.center_id || 1);
  const [counterId,  setCounterId]  = useState(0);
  const [modeFilter, setModeFilter] = useState('ALL');
  const [statusFilter,setStatusFilter] = useState('ALL');
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const load = async () => {
    setLoading(true); setError('');
    const res = await window.api.postingGetReconciliation(
      centerId, counterId || null, date, academicYear, modeFilter, statusFilter
    );
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setData(res);
  };

  const grandTotal = data ? Object.values(data.byMode).reduce((s, m) => s + m.amount, 0) : 0;

  return (
    <div>
      <Selectors date={date} setDate={setDate} centerId={centerId} setCenterId={setCenterId}
        counterId={counterId} setCounterId={setCounterId}
        academicYear={academicYear} setAcademicYear={setAcademicYear}
        centers={centers} counters={counters} />

      {/* Extra filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Payment Mode</label>
          <select value={modeFilter} onChange={e => setModeFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            <option value="ALL">All Modes</option>
            {MODE_ORDER.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            <option value="ALL">All</option>
            <option value="PENDING">Pending</option>
            <option value="POSTED">Posted</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="flex items-end">
          <button onClick={load} disabled={loading}
            className="px-6 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl">
            {loading ? '⏳' : '🔍 Generate Report'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {data && (
        <>
          {/* Mode summary */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex justify-between items-center">
              <p className="text-sm font-semibold text-gray-700">Summary by Payment Mode — {fmtDate(date)}</p>
              <p className="text-sm font-bold text-gray-700">Grand Total: {fmt(grandTotal)}</p>
            </div>
            <div className="divide-y divide-gray-100">
              {MODE_ORDER.filter(m => data.byMode[m]).map(m => (
                <div key={m} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-3 py-1 rounded-full font-bold ${MODE_COLORS[m]}`}>{m}</span>
                    <span className="text-sm text-gray-500">{data.byMode[m].count} receipt{data.byMode[m].count !== 1 ? 's' : ''}</span>
                  </div>
                  <span className="text-base font-bold text-gray-800">{fmt(data.byMode[m].amount)}</span>
                </div>
              ))}
              {Object.keys(data.byMode).length === 0 && (
                <p className="text-center text-gray-400 py-6 text-sm">No transactions found</p>
              )}
            </div>
          </div>

          {/* Detail table */}
          {data.data.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Receipt No','SL No','Student','Class','Amount','Mode','Status','Collected By','Time'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.data.map((r, i) => (
                    <tr key={r.receipt_number} className={`${r.status === 'CANCELLED' ? 'opacity-40 line-through' : i%2===0 ? 'bg-white' : 'bg-gray-50'}`}>
                      <td className="px-3 py-2 font-mono font-bold text-blue-700 text-xs">{r.receipt_number}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.sl_number}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.student_name || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.current_class || '—'}</td>
                      <td className="px-3 py-2 font-bold text-green-700">{fmt(r.amount_paid)}</td>
                      <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${MODE_COLORS[r.payment_mode]}`}>{r.payment_mode}</span></td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${r.status==='POSTED'?'bg-green-100 text-green-700':r.status==='CANCELLED'?'bg-red-100 text-red-600':'bg-amber-100 text-amber-700'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-400">{r.collected_by || '—'}</td>
                      <td className="px-3 py-2 text-xs text-gray-400">{r.collected_at ? String(r.collected_at).slice(11,16) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 3: Posting History ────────────────────────────────────
function HistoryTab({ centers, academicYear, setAcademicYear }) {
  const [centerId,  setCenterId]  = useState(centers[0]?.center_id || 1);
  const [history,   setHistory]   = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [details,   setDetails]   = useState(null);
  const [loadingD,  setLoadingD]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.postingGetHistory(centerId, academicYear);
    if (res.success) setHistory(res.data);
    setLoading(false);
  }, [centerId, academicYear]);

  useEffect(() => { load(); }, [load]);

  const openDetails = async (scheduleId) => {
    setSelected(scheduleId); setLoadingD(true); setDetails(null);
    const res = await window.api.postingGetScheduleDetails(scheduleId);
    if (res.success) setDetails(res);
    setLoadingD(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Center</label>
          <select value={centerId} onChange={e => { setCenterId(parseInt(e.target.value)); setSelected(null); setDetails(null); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {centers.map(c => <option key={c.center_id} value={c.center_id}>{c.center_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-4">
        {/* History list */}
        <div className="w-80 shrink-0">
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
              <p className="text-sm font-semibold text-gray-700">{history.length} Postings</p>
            </div>
            {loading ? <p className="text-center text-gray-400 py-8 text-sm">Loading...</p> :
              history.length === 0 ? <p className="text-center text-gray-400 py-8 text-sm">No postings yet</p> :
              <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
                {history.map(h => (
                  <button key={h.schedule_id} onClick={() => openDetails(h.schedule_id)}
                    className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors
                      ${selected === h.schedule_id ? 'bg-blue-50 border-l-4 border-blue-700' : ''}`}>
                    <p className="font-mono font-bold text-sm text-blue-700">{h.schedule_id}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{fmtDate(h.schedule_date)} · {h.center_name}</p>
                    <div className="flex justify-between mt-1">
                      <span className="text-xs text-gray-400">{h.total_transactions} receipts</span>
                      <span className="text-xs font-bold text-green-600">{fmt(h.total_amount)}</span>
                    </div>
                  </button>
                ))}
              </div>
            }
          </div>
        </div>

        {/* Schedule details */}
        <div className="flex-1 min-w-0">
          {!selected && (
            <div className="text-center py-16 text-gray-400">
              <p className="text-4xl mb-3">📋</p>
              <p>Select a posting to view details</p>
            </div>
          )}
          {loadingD && <p className="text-center text-gray-400 py-8">Loading details...</p>}
          {details && (
            <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              <div className="bg-blue-700 px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="font-mono font-bold text-white text-lg">{details.schedule.schedule_id}</p>
                  <p className="text-blue-200 text-xs mt-0.5">
                    Posted on {fmtDate(details.schedule.posted_at)} by {details.schedule.posted_by}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-xl">{fmt(details.schedule.total_amount)}</p>
                  <p className="text-blue-200 text-xs">{details.schedule.total_transactions} receipts</p>
                </div>
              </div>
              <div className="max-h-[55vh] overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                    <tr>
                      {['Receipt No','Student','Class','Amount','Mode','Collected By'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-gray-500 font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {details.receipts.map((r, i) => (
                      <tr key={r.receipt_number} className={i%2===0?'bg-white':'bg-gray-50'}>
                        <td className="px-3 py-2 font-mono font-bold text-blue-700">{r.receipt_number}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{r.student_name || r.sl_number}</td>
                        <td className="px-3 py-2 text-gray-500">{r.current_class || '—'}</td>
                        <td className="px-3 py-2 font-bold text-green-700">
                          {fmt(r.lines?.filter(l => l.transaction_type === 'RECEIVED').reduce((s, l) => s + (l.credit||0), 0))}
                        </td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full ${MODE_COLORS[r.payment_mode]}`}>{r.payment_mode}</span></td>
                        <td className="px-3 py-2 text-gray-400">{r.collected_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function DayEndPosting() {
  const [tab,          setTab]          = useState('post');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [centers,      setCenters]      = useState([]);
  const [counters,     setCounters]     = useState([]);

  useEffect(() => {
    window.api.centersGetAll().then(r => {
      if (r.success) { setCenters(r.centers); setCounters(r.counters); }
    });
  }, []);

  const TABS = [
    { key: 'post',      label: '📮 Post Payments'       },
    { key: 'reconcile', label: '🔍 Batch Reconciliation' },
    { key: 'history',   label: '📋 Posting History'      },
  ];

  if (centers.length === 0) return <div className="text-gray-400 text-sm py-8 text-center">Loading...</div>;

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Day-End Posting</h2>
        <p className="text-sm text-gray-500 mt-0.5">Review, post and reconcile daily fee collections</p>
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

      {tab === 'post'      && <PostTab      centers={centers} counters={counters} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'reconcile' && <ReconcileTab centers={centers} counters={counters} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
      {tab === 'history'   && <HistoryTab   centers={centers} academicYear={academicYear} setAcademicYear={setAcademicYear} />}
    </div>
  );
}
