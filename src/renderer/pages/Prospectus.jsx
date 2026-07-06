import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const TODAY   = new Date().toISOString().slice(0, 10);
const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';
const fmtINR  = (n) => '₹' + Number(n || 0).toFixed(2);

// ── Tab 1: Record Sale ────────────────────────────────────────
function RecordSaleTab({ prospectusAmount }) {
  const { user } = useAuth();
  const blank = {
    student_name: '', father_name: '', mother_name: '',
    father_mobile: '', mother_mobile: '', address: '',
    amount_paid: prospectusAmount, payment_date: TODAY,
    receipt_number: '', notes: '',
  };
  const [form,   setForm]   = useState({ ...blank, amount_paid: prospectusAmount });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    setForm(f => ({ ...f, amount_paid: prospectusAmount }));
  }, [prospectusAmount]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.student_name.trim()) { setError('Student name is required.'); return; }
    if (!form.father_mobile && !form.mother_mobile) { setError('At least one mobile number is required.'); return; }
    setSaving(true); setError('');
    const res = await window.api.prospectusAdd({ ...form, created_by: user?.username || '' });
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setSaved(true);
    setForm({ ...blank, amount_paid: prospectusAmount });
    setTimeout(() => setSaved(false), 3000);
  };

  const Field = ({ label, field, type = 'text', placeholder, required }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type={type} value={form[field]} onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  );

  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <h3 className="font-bold text-gray-700 mb-5 text-base">Record Prospectus Sale</h3>

        {/* Student info */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Student Details</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Student Name" field="student_name" placeholder="Full name of student" required />
            <Field label="Father's Name" field="father_name" placeholder="Father's full name" />
            <Field label="Mother's Name" field="mother_name" placeholder="Mother's full name" />
            <Field label="Address" field="address" placeholder="Residential address" />
          </div>
        </div>

        {/* Contact */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contact</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Father's Mobile" field="father_mobile" placeholder="10-digit mobile number" />
            <Field label="Mother's Mobile" field="mother_mobile" placeholder="10-digit mobile number" />
          </div>
        </div>

        {/* Payment */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Payment Details</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount Paid (₹)</label>
              <div className="flex items-center border-2 border-gray-200 focus-within:border-blue-400 rounded-xl overflow-hidden">
                <span className="px-3 py-2.5 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">₹</span>
                <input type="number" min="0" value={form.amount_paid}
                  onChange={e => set('amount_paid', parseFloat(e.target.value) || 0)}
                  className="flex-1 px-3 py-2.5 text-sm focus:outline-none" />
              </div>
            </div>
            <Field label="Payment Date" field="payment_date" type="date" />
            <Field label="Receipt / Ref No" field="receipt_number" placeholder="Optional" />
          </div>
        </div>

        {/* Notes */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes / Remarks</label>
          <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2}
            placeholder="Any follow-up notes, interested class, source of inquiry..."
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
        {saved  && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">✅ Prospectus sale recorded successfully</div>}

        <div className="flex justify-end">
          <button onClick={save} disabled={saving}
            className="px-8 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
            {saving ? '⏳ Saving...' : '💾 Save Record'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Mark Admitted Modal ───────────────────────────────────────
function MarkAdmittedModal({ inquiry, onClose, onSuccess }) {
  const [admNo,   setAdmNo]   = useState('');
  const [adjust,  setAdjust]  = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const save = async () => {
    if (!admNo.trim()) { setError('Enter the admission number.'); return; }
    setSaving(true); setError('');
    const res = await window.api.prospectusMarkAdmitted(inquiry.inquiry_id, admNo.trim(), adjust);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    onSuccess(res.student_name);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-green-600 px-6 py-4">
          <h3 className="text-white font-bold">Mark as Admitted</h3>
          <p className="text-green-100 text-xs mt-0.5">{inquiry.student_name}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Admission Number (BPS No) *</label>
            <input value={admNo} onChange={e => setAdmNo(e.target.value)}
              placeholder="e.g. BPS2026-0600"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Enter the BPS admission number assigned after approval</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={adjust} onChange={e => setAdjust(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-green-600" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  Adjust {fmtINR(inquiry.amount_paid)} against admission fee
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  When this student's first fee receipt is generated, ₹{inquiry.amount_paid} will be
                  pre-filled as concession on the admission fee with reason "Prospectus fee adjustment".
                </p>
              </div>
            </label>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">{error}</div>}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl py-2.5 text-sm font-medium">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl py-2.5 text-sm font-bold">
            {saving ? '⏳ Saving...' : '✅ Confirm Admission'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Inquiry Modal ────────────────────────────────────────
function EditModal({ inquiry, onClose, onSaved }) {
  const [form,   setForm]   = useState({ ...inquiry });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true);
    const res = await window.api.prospectusUpdate(form);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="bg-blue-700 px-6 py-4">
          <h3 className="text-white font-bold">Edit Inquiry</h3>
        </div>
        <div className="px-6 py-4 space-y-3 max-h-[70vh] overflow-y-auto">
          {[['Student Name','student_name'],['Father Name','father_name'],['Mother Name','mother_name'],
            ['Father Mobile','father_mobile'],['Mother Mobile','mother_mobile'],['Address','address'],
            ['Receipt / Ref No','receipt_number']].map(([label, field]) => (
            <div key={field}>
              <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
              <input value={form[field]||''} onChange={e => set(field, e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount Paid (₹)</label>
              <input type="number" value={form.amount_paid||''} onChange={e => set('amount_paid', parseFloat(e.target.value)||0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Payment Date</label>
              <input type="date" value={form.payment_date||''} onChange={e => set('payment_date', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes||''} onChange={e => set('notes', e.target.value)} rows={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>
          {error && <div className="text-red-500 text-xs">{error}</div>}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-300 text-gray-600 rounded-xl py-2.5 text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 bg-blue-700 text-white rounded-xl py-2.5 text-sm font-medium disabled:bg-blue-300">
            {saving ? '⏳' : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tab 2: Follow-Up List ─────────────────────────────────────
function FollowUpTab() {
  const [data,      setData]      = useState([]);
  const [search,    setSearch]    = useState('');
  const [fromDate,  setFromDate]  = useState('');
  const [toDate,    setToDate]    = useState('');
  const [loading,   setLoading]   = useState(false);
  const [admitting, setAdmitting] = useState(null); // inquiry to mark admitted
  const [editing,   setEditing]   = useState(null);
  const [msg,       setMsg]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.prospectusGetAll({
      admission_taken: 0,
      from_date: fromDate || undefined,
      to_date:   toDate   || undefined,
      search:    search   || undefined,
    });
    if (res.success) setData(res.data);
    setLoading(false);
  }, [search, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const onAdmitted = (studentName) => {
    setAdmitting(null);
    setMsg(`✅ ${studentName} marked as admitted.`);
    setTimeout(() => setMsg(''), 4000);
    load();
  };

  return (
    <div>
      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Name, father's name or mobile..."
            className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={() => { setFromDate(''); setToDate(''); setSearch(''); }}
          className="px-4 py-2 border border-gray-300 text-gray-500 hover:bg-gray-50 rounded-xl text-sm">
          Clear
        </button>
      </div>

      {msg && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">{msg}</div>}

      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">{data.length} pending follow-up{data.length !== 1 ? 's' : ''}</p>
        <button onClick={() => window.print()}
          className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
          🖨️ Print List
        </button>
      </div>

      {loading ? <div className="text-center py-10 text-gray-400">Loading...</div> :
       data.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🎉</p>
          <p className="font-medium">No pending follow-ups</p>
          <p className="text-sm mt-1">All prospectus buyers have either taken admission or filters returned no results</p>
        </div>
      ) : (
        <div className="print-root bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Student','Father / Mother','Mobile','Address','Date','Amount','Notes','Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r, i) => (
                <tr key={r.inquiry_id} className={i%2===0?'bg-white':'bg-gray-50'}>
                  <td className="px-4 py-3 font-medium text-gray-800">{r.student_name}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <p>{r.father_name || '—'}</p>
                    {r.mother_name && <p className="text-gray-400">{r.mother_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.father_mobile && <p className="text-blue-700 font-medium">{r.father_mobile}</p>}
                    {r.mother_mobile && <p className="text-blue-600">{r.mother_mobile}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-32 truncate" title={r.address}>{r.address || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(r.payment_date)}</td>
                  <td className="px-4 py-3 font-bold text-green-700">{fmtINR(r.amount_paid)}</td>
                  <td className="px-4 py-3 text-xs text-gray-400 max-w-32 truncate" title={r.notes}>{r.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5 flex-col">
                      <button onClick={() => setAdmitting(r)}
                        className="text-xs bg-green-100 text-green-700 hover:bg-green-200 px-2.5 py-1 rounded-lg font-medium whitespace-nowrap">
                        ✅ Admitted
                      </button>
                      <button onClick={() => setEditing(r)}
                        className="text-xs border border-gray-200 text-gray-600 hover:bg-gray-50 px-2.5 py-1 rounded-lg whitespace-nowrap">
                        ✏️ Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {admitting && (
        <MarkAdmittedModal inquiry={admitting} onClose={() => setAdmitting(null)} onSuccess={onAdmitted} />
      )}
      {editing && (
        <EditModal inquiry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

// ── Tab 3: Conversion Report ──────────────────────────────────
function ReportTab() {
  const [stats,    setStats]    = useState(null);
  const [allData,  setAllData]  = useState([]);
  const [showAll,  setShowAll]  = useState('all'); // 'all' | 'admitted' | 'pending'
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    Promise.all([
      window.api.prospectusGetStats(),
      window.api.prospectusGetAll({}),
    ]).then(([statsRes, dataRes]) => {
      if (statsRes.success) setStats(statsRes);
      if (dataRes.success)  setAllData(dataRes.data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="text-center py-10 text-gray-400">Loading...</div>;
  if (!stats)  return null;

  const rate   = stats.total > 0 ? ((stats.converted / stats.total) * 100).toFixed(1) : '0.0';
  const filtered = showAll === 'all' ? allData :
                   showAll === 'admitted' ? allData.filter(r => r.admission_taken) :
                   allData.filter(r => !r.admission_taken);

  return (
    <div>
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 mb-6 lg:grid-cols-4">
        {[
          ['Total Sold',       stats.total,                  'bg-blue-50 border-blue-200 text-blue-700'],
          ['Admissions Taken', stats.converted,              'bg-green-50 border-green-200 text-green-700'],
          ['Pending',          stats.total - stats.converted,'bg-amber-50 border-amber-200 text-amber-700'],
          ['Conversion Rate',  rate + '%',                   'bg-purple-50 border-purple-200 text-purple-700'],
        ].map(([label, val, cls]) => (
          <div key={label} className={`border rounded-2xl p-4 text-center ${cls}`}>
            <p className="text-3xl font-bold">{val}</p>
            <p className="text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-xs text-gray-400 mb-1">Total Prospectus Revenue</p>
          <p className="text-2xl font-bold text-gray-800">{fmtINR(stats.revenue)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <p className="text-xs text-gray-400 mb-1">Fee Adjustments Granted</p>
          <p className="text-2xl font-bold text-amber-700">{fmtINR(stats.adjustedAmt)}</p>
          <p className="text-xs text-gray-400">{stats.adjusted} student{stats.adjusted!==1?'s':''}</p>
        </div>
      </div>

      {/* Monthly breakdown */}
      {stats.byMonth.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-5">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
            <p className="text-sm font-semibold text-gray-700">Month-wise Breakdown (Last 12 months)</p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Month','Prospectus Sold','Admissions Taken','Conversion Rate'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stats.byMonth.map((r, i) => {
                const r2 = r.sold > 0 ? ((r.admitted/r.sold)*100).toFixed(1) : '0.0';
                return (
                  <tr key={r.month} className={i%2===0?'bg-white':'bg-gray-50'}>
                    <td className="px-4 py-2.5 font-medium text-gray-700">{r.month}</td>
                    <td className="px-4 py-2.5 text-blue-700 font-bold">{r.sold}</td>
                    <td className="px-4 py-2.5 text-green-700 font-bold">{r.admitted}</td>
                    <td className="px-4 py-2.5">
                      <span className={`font-bold px-2 py-0.5 rounded-full text-xs
                        ${parseFloat(r2)>=50?'bg-green-100 text-green-700':'bg-amber-100 text-amber-700'}`}>
                        {r2}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Full list */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-700">All Inquiries</p>
          <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
            {[['all','All'],['admitted','Admitted'],['pending','Pending']].map(([val, label]) => (
              <button key={val} onClick={() => setShowAll(val)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors
                  ${showAll===val?'bg-blue-700 text-white':'text-gray-500 hover:text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              {['Student','Father','Mobile','Date','Amount','Status','Adm. No'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((r, i) => (
              <tr key={r.inquiry_id} className={i%2===0?'bg-white':'bg-gray-50'}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{r.student_name}</td>
                <td className="px-4 py-2.5 text-gray-600">{r.father_name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-blue-700">{r.father_mobile || r.mother_mobile || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(r.payment_date)}</td>
                <td className="px-4 py-2.5 font-bold text-green-700">{fmtINR(r.amount_paid)}</td>
                <td className="px-4 py-2.5">
                  {r.admission_taken ? (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">✅ Admitted</span>
                  ) : (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">⏳ Pending</span>
                  )}
                  {r.fee_adjusted ? <span className="ml-1 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">Fee Adj.</span> : null}
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{r.admission_number || '—'}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="text-center py-8 text-gray-400">No records</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function Prospectus() {
  const [tab,               setTab]               = useState('record');
  const [prospectusAmount,  setProspectusAmount]  = useState(100);

  useEffect(() => {
    // Load prospectus fee from settings
    const yr = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? `${y}-${String(y+1).slice(2)}` : `${y-1}-${String(y).slice(2)}`; })();
    window.api.feeSettingsGet(yr).then(r => {
      if (r.success && r.data?.prospectus_fee) setProspectusAmount(r.data.prospectus_fee);
    });
  }, []);

  const TABS = [
    { key: 'record',   label: '📝 Record Sale'         },
    { key: 'followup', label: '📞 Follow-Up List'       },
    { key: 'report',   label: '📊 Conversion Report'    },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Prospectus & Pre-Admission</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Record prospectus sales, track follow-ups and conversion to admission
          <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
            Prospectus fee: {fmtINR(prospectusAmount)}
          </span>
        </p>
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

      {tab === 'record'   && <RecordSaleTab prospectusAmount={prospectusAmount} />}
      {tab === 'followup' && <FollowUpTab />}
      {tab === 'report'   && <ReportTab />}
    </div>
  );
}
