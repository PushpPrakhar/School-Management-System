import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

// ── Constants ─────────────────────────────────────────────────
const VILLAGES = [
  'Badauli','Balrau','Bhura Badauli','Danwar',
  'Dushhera','Dushheri','Ishan Pur','Jawal',
  'Kamalpur','Kathpura','Khurja','Kyoli',
  'Madhkola','Mahmudpur','Mansoorpur','Meerpur',
  'Nagla Sherpur','Naglakat','Nayabas Nayser','Nayser',
  'Rohinda','Shahvaj Pur','Sherpur Nayser','Thangora',
  'Tikri','Other',
];
const SCHOOL_LOCATION = 'SHERPUR';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 5 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const CLASSES = ['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5', 'Class 6', 'Class 7', 'Class 8'];
const CLASS_SHORT = { 'Nursery':'Nur','LKG':'LKG','UKG':'UKG','Class 1':'C1','Class 2':'C2','Class 3':'C3','Class 4':'C4','Class 5':'C5','Class 6':'C6','Class 7':'C7','Class 8':'C8' };

const FEE_TYPES = [
  { key: 'TUITION',       label: 'Tuition Fee',               frequency: 'MONTHLY',    section: 'monthly'  },
  { key: 'COMPUTER',      label: 'Computer Fee',              frequency: 'MONTHLY',    section: 'monthly'  },
  { key: 'ADMISSION',     label: 'Admission / Enrollment Fee',frequency: 'ONE_TIME',   section: 'onetime'  },
  { key: 'ACTIVITY',      label: 'Activity / Sports Fee',     frequency: 'ANNUAL',     section: 'annual'   },
  { key: 'LIBRARY',       label: 'Library Fee',               frequency: 'ANNUAL',     section: 'annual'   },
  { key: 'LAB',           label: 'Lab Fee',                   frequency: 'MONTHLY',    section: 'monthly'  },
  { key: 'WELLNESS',      label: 'Campus Wellness Charges',   frequency: 'ANNUAL',     section: 'annual'   },
  { key: 'BOOKS',         label: 'Books Fee',                 frequency: 'ANNUAL',     section: 'annual'   },
  { key: 'EXAM_HY',       label: 'Exam Fee — Half Yearly',    frequency: 'TWICE_YEAR', section: 'exam'     },
  { key: 'EXAM_ANNUAL',   label: 'Exam Fee — Annual',         frequency: 'TWICE_YEAR', section: 'exam'     },
];

const SECTION_LABELS = { monthly: 'Monthly Fees', onetime: 'One-Time Fees', annual: 'Annual Fees', exam: 'Examination Fees' };

const DUE_MONTH_OPTIONS = [
  ['', 'Not set'],
  ['04','April'],['05','May'],['06','June'],['07','July'],['08','August'],['09','September'],
  ['10','October'],['11','November'],['12','December'],['01','January'],['02','February'],['03','March'],
];

// ── Helper: input cell ─────────────────────────────────────────
function AmountCell({ value, onChange, disabled }) {
  return (
    <input
      type="number" min="0" value={value === 0 ? '' : value}
      onChange={e => onChange(parseFloat(e.target.value) || 0)}
      disabled={disabled}
      placeholder="0"
      className="w-16 text-center border border-gray-200 rounded-lg px-1 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
    />
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 1 — Fee Structure
// ════════════════════════════════════════════════════════════════
function FeeStructureTab({ academicYear }) {
  const { user } = useAuth();
  const [matrix,     setMatrix]     = useState({});
  const [dueMonths,  setDueMonths]  = useState({}); // { feeType: 'MM' } — one due month per fee type, applied across all classes
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState('');
  const [copyFrom,   setCopyFrom]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.feeStructureGet(academicYear);
    if (res.success) {
      const m = {};
      const dm = {};
      res.data.forEach(r => {
        if (!m[r.fee_type]) m[r.fee_type] = {};
        m[r.fee_type][r.class] = r.amount;
        if (r.due_month) dm[r.fee_type] = r.due_month;
      });
      setMatrix(m);
      setDueMonths(dm);
    }
    setLoading(false);
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const setCell = (feeType, cls, val) => {
    setMatrix(prev => ({ ...prev, [feeType]: { ...prev[feeType], [cls]: val } }));
    setSaved(false);
  };

  const setDueMonth = (feeType, val) => {
    setDueMonths(prev => ({ ...prev, [feeType]: val }));
    setSaved(false);
  };

  const save = async () => {
    setSaving(true); setError('');
    const entries = [];
    FEE_TYPES.forEach(ft => {
      CLASSES.forEach(cls => {
        entries.push({
          class: cls, fee_type: ft.key, amount: matrix[ft.key]?.[cls] || 0, frequency: ft.frequency,
          due_month: (ft.frequency === 'ANNUAL' || ft.frequency === 'TWICE_YEAR') ? (dueMonths[ft.key] || '') : '',
        });
      });
    });
    const res = await window.api.feeStructureSave(academicYear, entries, user?.username);
    setSaving(false);
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    else setError(res.message);
  };

  const copyYear = async () => {
    if (!copyFrom) return;
    const res = await window.api.feeStructureCopyFromYear(copyFrom, academicYear, user?.username);
    if (res.success) { load(); }
    else setError(res.message || 'Copy failed');
  };

  const sections = [...new Set(FEE_TYPES.map(f => f.section))];

  return (
    <div>
      {/* Copy from year */}
      <div className="flex items-center gap-3 mb-5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-sm text-blue-700 font-medium">Copy structure from another year:</p>
        <select value={copyFrom} onChange={e => setCopyFrom(e.target.value)}
          className="border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white text-blue-700">
          <option value="">Select year</option>
          {YEARS.filter(y => y !== academicYear).map(y => <option key={y}>{y}</option>)}
        </select>
        <button onClick={copyYear} disabled={!copyFrom}
          className="px-4 py-1.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white text-sm rounded-lg font-medium">
          Copy
        </button>
        <p className="text-xs text-blue-500">This fills in the matrix below — you can still edit before saving</p>
      </div>

      <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5">
        💡 Set a <strong>Due Month</strong> for Annual and Examination fees so the system can automatically raise
        them at the right time. Fees with no Due Month set are never auto-charged — staff must add them manually via
        Counter Payment or Bulk Entry.
      </p>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading fee structure...</div>
      ) : (
        sections.map(sec => (
          <div key={sec} className="mb-6">
            <h3 className="font-bold text-gray-700 mb-2 text-sm uppercase tracking-wide border-b border-gray-200 pb-1">
              {SECTION_LABELS[sec]}
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs border-collapse">
                <thead>
                  <tr className="bg-blue-700">
                    <th className="text-left text-white px-4 py-2 font-semibold min-w-44 sticky left-0 bg-blue-700">Fee Type</th>
                    {CLASSES.map(cls => (
                      <th key={cls} className="text-center text-white px-2 py-2 font-semibold min-w-16">
                        {CLASS_SHORT[cls]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEE_TYPES.filter(f => f.section === sec).map((ft, idx) => (
                    <tr key={ft.key} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium text-gray-700 sticky left-0 bg-inherit border-r border-gray-200">
                        {ft.label}
                        <span className="ml-2 text-gray-400 font-normal text-xs">
                          ({ft.frequency === 'MONTHLY' ? '/mo' : ft.frequency === 'ANNUAL' ? '/yr' : ft.frequency === 'TWICE_YEAR' ? '×2/yr' : 'once'})
                        </span>
                        {(ft.frequency === 'ANNUAL' || ft.frequency === 'TWICE_YEAR') && (
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[10px] text-gray-400 font-normal">Due:</span>
                            <select value={dueMonths[ft.key] || ''} onChange={e => setDueMonth(ft.key, e.target.value)}
                              className="text-[11px] border border-gray-200 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                              {DUE_MONTH_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                        )}
                      </td>
                      {CLASSES.map(cls => (
                        <td key={cls} className="px-2 py-1.5 text-center border-r border-gray-100">
                          <AmountCell
                            value={matrix[ft.key]?.[cls] || 0}
                            onChange={v => setCell(ft.key, cls, v)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-3">✅ Fee structure saved successfully</p>}

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
          {saving ? '⏳ Saving...' : '💾 Save Fee Structure'}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 2 — Late Fee & Global Settings
// ════════════════════════════════════════════════════════════════
function LateFeeTab({ academicYear }) {
  const { user } = useAuth();
  const [form,   setForm]   = useState({
    late_fee_per_day: 5, grace_period_days: 10, late_fee_annual_cap: 1000,
    security_deposit: 0, prospectus_fee: 100, tc_fee: 0,
    sibling_concession_pct: 0, sibling_concession_from: 3,
  });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => {
    window.api.feeSettingsGet(academicYear).then(res => {
      if (res.success && res.data) setForm(f => ({ ...f, ...res.data }));
    });
  }, [academicYear]);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setSaved(false); };

  const save = async () => {
    setSaving(true); setError('');
    const res = await window.api.feeSettingsSave({ ...form, academic_year: academicYear, created_by: user?.username || '' });
    setSaving(false);
    if (res.success) { setSaved(true); setTimeout(() => setSaved(false), 3000); }
    else setError(res.message);
  };

  const Row = ({ label, hint, children }) => (
    <div className="flex items-start gap-4 py-3 border-b border-gray-100">
      <div className="w-64 shrink-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );

  const Inp = ({ field, min, max, prefix, suffix }) => (
    <div className="flex items-center gap-2">
      {prefix && <span className="text-gray-500 text-sm">{prefix}</span>}
      <input type="number" min={min || 0} max={max} value={form[field]}
        onChange={e => set(field, parseFloat(e.target.value) || 0)}
        className="w-28 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      {suffix && <span className="text-gray-500 text-sm">{suffix}</span>}
    </div>
  );

  return (
    <div className="max-w-2xl">
      <div className="bg-white border border-gray-200 rounded-2xl px-6 py-2 mb-5">
        <h3 className="font-bold text-gray-700 pt-3 pb-1 text-sm uppercase tracking-wide">Late Fee Settings</h3>
        <Row label="Late Fee Per Day" hint="Applied after grace period expires">
          <Inp field="late_fee_per_day" prefix="₹" suffix="per day" />
        </Row>
        <Row label="Grace Period" hint="Days after due date before late fee starts">
          <Inp field="grace_period_days" suffix="days" />
        </Row>
        <Row label="Annual Maximum Cap" hint="Maximum total late fee a student can be charged in one year">
          <Inp field="late_fee_annual_cap" prefix="₹" />
        </Row>

        <h3 className="font-bold text-gray-700 pt-4 pb-1 text-sm uppercase tracking-wide border-t border-gray-100 mt-1">Sibling Concession</h3>
        <Row label="Concession From" hint="Concession applies from which sibling (3 = 3rd child onward)">
          <Inp field="sibling_concession_from" suffix="th sibling onward" />
        </Row>
        <Row label="Concession Percentage" hint="Applied on Tuition Fee only">
          <Inp field="sibling_concession_pct" suffix="%" max={100} />
        </Row>

        <h3 className="font-bold text-gray-700 pt-4 pb-1 text-sm uppercase tracking-wide border-t border-gray-100 mt-1">Other Fees</h3>
        <Row label="Security Deposit" hint="One-time, refundable at TC. Same for all students">
          <Inp field="security_deposit" prefix="₹" />
        </Row>
        <Row label="Prospectus Fee" hint="Charged at sale of prospectus">
          <Inp field="prospectus_fee" prefix="₹" />
        </Row>
        <Row label="TC Fee" hint="Transfer Certificate fee, charged once in lifetime">
          <Inp field="tc_fee" prefix="₹" />
        </Row>
      </div>

      {/* Late fee explanation */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-xs text-amber-700">
        <p className="font-semibold mb-1">How Late Fee Works:</p>
        <p>Due on 1st of month → Grace period {form.grace_period_days} days → Late fee starts from day {form.grace_period_days + 1}</p>
        <p>Late fee runs per month separately. If April fee unpaid when May starts, both months accumulate simultaneously.</p>
        <p>Maximum ₹{form.late_fee_annual_cap} total late fee per year regardless of days overdue.</p>
      </div>

      {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3">{error}</p>}
      {saved && <p className="text-green-600 text-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-3">✅ Settings saved successfully</p>}

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
          {saving ? '⏳ Saving...' : '💾 Save Settings'}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 3 — Transport Routes
// ════════════════════════════════════════════════════════════════
function TransportTab({ academicYear }) {
  const { user } = useAuth();
  const [routes,  setRoutes]  = useState([]);
  const [editing, setEditing] = useState(null); // null | {} | route object
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    const res = await window.api.transportRoutesGetAll(academicYear);
    if (res.success) setRoutes(res.data);
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const blank = { route_name: '', _to: '', _from: SCHOOL_LOCATION, pickup_points: '', monthly_amount: 0, academic_year: academicYear, is_active: 1 };

  // When editing existing route, parse _to/_from from route_name if possible
  const openEdit = (r) => {
    let _to = '', _from = SCHOOL_LOCATION;
    if (r.route_name) {
      // Format: "DESTINATION-SHERPUR ROUTE" → _to=DESTINATION, _from=SHERPUR
      const parts = r.route_name.replace(' ROUTE','').split('-');
      if (parts.length >= 2) { _to = parts[0].trim(); _from = parts.slice(1).join('-').trim(); }
    }
    setEditing({ ...r, _to, _from });
  };

  const saveRoute = async () => {
    setSaving(true); setError('');
    const res = await window.api.transportRoutesSave({ ...editing, created_by: user?.username || '' });
    setSaving(false);
    if (res.success) { setEditing(null); load(); }
    else setError(res.message);
  };

  const deactivate = async (route_id) => {
    await window.api.transportRoutesDelete(route_id);
    load();
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{routes.filter(r => r.is_active).length} active routes for {academicYear}</p>
        <button onClick={() => setEditing(blank)}
          className="bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium px-5 py-2 rounded-xl">
          + Add Route
        </button>
      </div>

      {/* Route list */}
      <div className="space-y-3 mb-5">
        {routes.filter(r => r.is_active).map(r => (
          <div key={r.route_id} className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center gap-4">
            <div className="flex-1">
              <p className="font-semibold text-gray-800">{r.route_name}</p>
              {r.pickup_points && <p className="text-xs text-gray-400 mt-0.5">Stops: {r.pickup_points}</p>}
            </div>
            <div className="text-right">
              <p className="font-bold text-blue-700 text-lg">₹{r.monthly_amount}</p>
              <p className="text-xs text-gray-400">per month</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => openEdit(r)}
                className="text-xs border border-blue-200 text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg">
                Edit
              </button>
              <button onClick={() => deactivate(r.route_id)}
                className="text-xs border border-red-200 text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg">
                Remove
              </button>
            </div>
          </div>
        ))}
        {routes.filter(r => r.is_active).length === 0 && (
          <div className="text-center py-10 text-gray-400">
            <p className="text-3xl mb-2">🚌</p>
            <p>No transport routes added yet</p>
          </div>
        )}
      </div>

      {/* Add/Edit form */}
      {editing && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-blue-700 px-6 py-4">
              <h3 className="text-white font-bold">{editing.route_id ? 'Edit Route' : 'Add New Route'}</h3>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* To / From dropdowns */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Destination (To) *</label>
                  <select
                    value={editing._to || ''}
                    onChange={e => {
                      const to   = e.target.value;
                      const from = editing._from || SCHOOL_LOCATION;
                      const name = to ? (to.toUpperCase() + '-' + from.toUpperCase() + ' ROUTE') : '';
                      setEditing(v => ({ ...v, _to: to, route_name: name }));
                    }}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">Select destination</option>
                    {VILLAGES.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">From (School)</label>
                  <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500">
                    {SCHOOL_LOCATION} (School)
                  </div>
                </div>
              </div>

              {/* Auto-generated route name preview */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Route Name (auto-generated)</label>
                <div className={`w-full border rounded-lg px-3 py-2.5 text-sm font-bold
                  ${editing.route_name ? 'border-blue-300 bg-blue-50 text-blue-800' : 'border-gray-200 bg-gray-50 text-gray-400'}`}>
                  {editing.route_name || 'Select destination above to generate route name'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Pickup Points</label>
                <input value={editing.pickup_points || ''} onChange={e => setEditing(v => ({ ...v, pickup_points: e.target.value }))}
                  placeholder="e.g. Sherpur → Nayser → Jawal (optional)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Monthly Amount (₹) *</label>
                <div className="flex items-center border-2 border-gray-200 focus-within:border-blue-400 rounded-xl overflow-hidden">
                  <span className="px-3 py-2 text-sm text-gray-400 bg-gray-50 border-r border-gray-200">₹</span>
                  <input type="number" min="0" value={editing.monthly_amount || ''}
                    onChange={e => setEditing(v => ({ ...v, monthly_amount: parseFloat(e.target.value) || 0 }))}
                    placeholder="0"
                    className="flex-1 px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>
              {error && <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => { setEditing(null); setError(''); }}
                className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl text-sm">
                Cancel
              </button>
              <button onClick={saveRoute} disabled={saving || !editing.route_name || !editing._to}
                className="flex-1 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm">
                {saving ? '⏳ Saving...' : '💾 Save Route'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// TAB 4 — Centers & Counters
// ════════════════════════════════════════════════════════════════
function CentersTab() {
  const [centers,      setCenters]      = useState([]);
  const [counters,     setCounters]     = useState([]);
  const [editCenter,   setEditCenter]   = useState(null);
  const [editCounter,  setEditCounter]  = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  const load = useCallback(async () => {
    const res = await window.api.centersGetAll();
    if (res.success) { setCenters(res.centers); setCounters(res.counters); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveCenter = async () => {
    setSaving(true); setError('');
    const res = await window.api.centersSaveCenter(editCenter);
    setSaving(false);
    if (res.success) { setEditCenter(null); load(); }
    else setError(res.message);
  };

  const saveCounter = async () => {
    setSaving(true); setError('');
    const res = await window.api.centersSaveCounter(editCounter);
    setSaving(false);
    if (res.success) { setEditCounter(null); load(); }
    else setError(res.message);
  };

  return (
    <div>
      {centers.map(c => (
        <div key={c.center_id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800">{c.center_name}</p>
              <p className="text-xs text-gray-400">{c.center_code} · {c.address}</p>
            </div>
            <button onClick={() => setEditCenter(c)}
              className="text-xs border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">
              Edit
            </button>
          </div>
          <div className="px-5 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Counters</p>
              <button onClick={() => setEditCounter({ center_id: c.center_id, counter_name: '', counter_code: '', is_active: 1 })}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium">+ Add Counter</button>
            </div>
            <div className="space-y-1">
              {counters.filter(ct => ct.center_id === c.center_id && ct.is_active).map(ct => (
                <div key={ct.counter_id} className="flex items-center justify-between py-1.5 px-3 bg-blue-50 rounded-lg">
                  <div>
                    <span className="text-sm font-medium text-gray-700">{ct.counter_name}</span>
                    <span className="ml-2 text-xs text-blue-500">{ct.counter_code}</span>
                  </div>
                  <button onClick={() => setEditCounter(ct)}
                    className="text-xs text-blue-600 hover:text-blue-800">Edit</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      <button onClick={() => setEditCenter({ center_name: '', center_code: '', address: '', is_active: 1 })}
        className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 rounded-xl text-sm font-medium transition-colors">
        + Add New Branch / Collection Center
      </button>

      {/* Center modal */}
      {editCenter && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-blue-700 px-6 py-4">
              <h3 className="text-white font-bold">{editCenter.center_id ? 'Edit Center' : 'Add New Center'}</h3>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[['Center Name','center_name','BPS Sherpur-Nayser'],['Center Code','center_code','BPSSH'],['Address','address','Village..., UP']].map(([label, field, ph]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input value={editCenter[field] || ''} onChange={e => setEditCenter(v => ({ ...v, [field]: e.target.value }))}
                    placeholder={ph}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              {error && <p className="text-red-500 text-xs">{error}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => { setEditCenter(null); setError(''); }}
                className="flex-1 border border-gray-300 text-gray-600 rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={saveCenter} disabled={saving}
                className="flex-1 bg-blue-700 text-white rounded-xl py-2.5 text-sm font-medium disabled:bg-blue-300">
                {saving ? '⏳' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Counter modal */}
      {editCounter && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="bg-blue-700 px-6 py-4">
              <h3 className="text-white font-bold">{editCounter.counter_id ? 'Edit Counter' : 'Add Counter'}</h3>
            </div>
            <div className="px-6 py-5 space-y-3">
              {[['Counter Name','counter_name','Main Counter'],['Counter Code','counter_code','C-01']].map(([label, field, ph]) => (
                <div key={field}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input value={editCounter[field] || ''} onChange={e => setEditCounter(v => ({ ...v, [field]: e.target.value }))}
                    placeholder={ph}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              {error && <p className="text-red-500 text-xs">{error}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => { setEditCounter(null); setError(''); }}
                className="flex-1 border border-gray-300 text-gray-600 rounded-xl py-2.5 text-sm">Cancel</button>
              <button onClick={saveCounter} disabled={saving}
                className="flex-1 bg-blue-700 text-white rounded-xl py-2.5 text-sm font-medium disabled:bg-blue-300">
                {saving ? '⏳' : '💾 Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════
export default function FeeSettings() {
  const [tab, setTab]               = useState('structure');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);

  const TABS = [
    { key: 'structure', label: 'Fee Structure' },
    { key: 'latefee',   label: 'Late Fee & Global' },
    { key: 'transport', label: 'Transport Routes' },
    { key: 'centers',   label: 'Centers & Counters' },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Fee Settings</h2>
        <p className="text-sm text-gray-500 mt-0.5">Configure fee structure, late fees, transport and collection centers</p>
      </div>

      {/* Academic Year selector */}
      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-medium text-gray-600">Academic Year</label>
        <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-28">
          {YEARS.map(y => <option key={y}>{y}</option>)}
        </select>
        <span className="text-xs text-gray-400 bg-gray-100 px-3 py-1.5 rounded-lg">
          Settings are saved per academic year
        </span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'structure' && <FeeStructureTab academicYear={academicYear} />}
      {tab === 'latefee'   && <LateFeeTab academicYear={academicYear} />}
      {tab === 'transport' && <TransportTab academicYear={academicYear} />}
      {tab === 'centers'   && <CentersTab />}
    </div>
  );
}
