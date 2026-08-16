import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../utils/AuthContext';
import MissingFeesBanner from '../components/MissingFeesBanner';
import MonthlyLedgerReportPrintModal from '../components/MonthlyLedgerReportPrintModal';
import TransportListPrintModal from '../components/TransportListPrintModal';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 5 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const fmt = (n) => n === null || n === undefined ? '0.00' : Number(n).toFixed(2);
const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

// April-March month options for a given academic year ('2026-27' -> April
// 2026 through March 2027), in the exact 'YYYY-MM' format the backend
// compares tuition_start_month against.
const academicMonthOptions = (academicYear) => {
  const startYear = parseInt(String(academicYear).split('-')[0], 10);
  const MONTHS = [
    ['04','April'],['05','May'],['06','June'],['07','July'],['08','August'],['09','September'],
    ['10','October'],['11','November'],['12','December'],['01','January'],['02','February'],['03','March'],
  ];
  return MONTHS.map(([mm, label], i) => {
    const calYear = i < 9 ? startYear : startYear + 1; // Jan-Mar fall in the following calendar year
    return { value: `${calYear}-${mm}`, label: `${label} ${calYear}` };
  });
};

// ── Tab 1: Create Ledger ──────────────────────────────────
const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3',
  'Class 4','Class 5','Class 6','Class 7','Class 8'];
const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
  'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };
const VILLAGES = ['BADAULI','BALRAU','BHURA BADAULI','DANWAR',
  'DUSHHERA','DUSHHERI','ISHAN PUR','JAWAL',
  'KAMALPUR','KATHPURA','KHURJA','KYOLI',
  'MADHKOLA','MAHMUDPUR','MANSOORPUR','MEERPUR',
  'NAGLA SHERPUR','NAGLAKAT','NAYABAS NAYSER','NAYSER',
  'ROHINDA','SHAHVAJ PUR','SHERPUR NAYSER','THANGORA',
  'TIKRI','OTHER'];

// Confirmation modal (generic)
function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, saving, danger }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className={`px-6 py-4 ${danger ? 'bg-red-600' : 'bg-blue-700'}`}>
          <h3 className="text-white font-bold">{title}</h3>
        </div>
        <div className="px-6 py-5">
          <p className="text-sm text-gray-600 whitespace-pre-line">{message}</p>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onCancel}
            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl py-2.5 text-sm font-medium">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={saving}
            className={`flex-1 text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-50
              ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-700 hover:bg-blue-800'}`}>
            {saving ? '⏳ Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Step 1 — Select & Add Students
function AddStudentsStep({ academicYear, onAdded }) {
  const { user }    = useAuth();
  const [cls,       setCls]       = useState('');
  const [students,  setStudents]  = useState([]);
  const [ledger,    setLedger]    = useState([]);
  const [selected,  setSelected]  = useState(new Set());
  const [balances,  setBalances]  = useState({});
  const [tuitionStartMonths, setTuitionStartMonths] = useState({});
  const [loading,   setLoading]   = useState(false);
  const [adding,    setAdding]    = useState(false);
  const [error,     setError]     = useState('');
  const [confirming,setConfirming]= useState(false);

  const loadStudents = useCallback(async () => {
    if (!cls) { setStudents([]); return; }
    setLoading(true);
    const res = await window.api.feeLedgerGetUnassigned(academicYear, cls);
    setLoading(false);
    if (res.success) setStudents(res.data);
  }, [cls, academicYear]);

  const loadLedger = useCallback(async () => {
    const res = await window.api.feeLedgerGetAll(academicYear);
    if (res.success) setLedger(res.data);
  }, [academicYear]);

  useEffect(() => { loadStudents(); }, [loadStudents]);
  useEffect(() => { loadLedger(); }, [loadLedger]);

  const toggleSelect = (admNo) => setSelected(prev => {
    const n = new Set(prev); n.has(admNo) ? n.delete(admNo) : n.add(admNo); return n;
  });

  const selectAll = () => setSelected(new Set(students.map(s => s.admission_number)));
  const clearAll  = () => setSelected(new Set());

  const setBalance = (admNo, val) => setBalances(prev => ({ ...prev, [admNo]: val }));
  const setTuitionStartMonth = (admNo, val) => setTuitionStartMonths(prev => ({ ...prev, [admNo]: val }));

  const confirmAdd = async () => {
    setAdding(true); setError('');
    const entries = students
      .filter(s => selected.has(s.admission_number))
      .map(s => ({
        admission_number: s.admission_number,
        student_name:     s.student_name,
        current_class:    s.current_class,
        section:          s.section,
        opening_balance:  parseFloat(balances[s.admission_number]) || 0,
        tuition_start_month: tuitionStartMonths[s.admission_number] || academicMonthOptions(academicYear)[0].value,
      }));
    const res = await window.api.feeLedgerCreateBulk(academicYear, entries, user?.username);
    setAdding(false); setConfirming(false);
    if (!res.success) { setError(res.message); return; }
    setSelected(new Set()); setBalances({}); setTuitionStartMonths({});
    await loadStudents();
    await loadLedger();
    onAdded();
  };

  const nextSL = ledger.length + 1;
  const selectedList = students.filter(s => selected.has(s.admission_number));

  return (
    <div className="flex gap-4 h-full">
      {/* Left — Class filter + student selector */}
      <div className="flex-1 min-w-0">
        <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-2">Select Class to Add</label>
          <div className="flex flex-wrap gap-2">
            {CLASSES.map(c => (
              <button key={c} onClick={() => { setCls(c); setSelected(new Set()); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors
                  ${cls === c ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                {c}
              </button>
            ))}
          </div>
        </div>

        {cls && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">
                {loading ? 'Loading...' : `${students.length} unassigned students in ${cls}`}
              </p>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1 rounded-lg">Select All</button>
                <button onClick={clearAll}  className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1 rounded-lg">Clear</button>
              </div>
            </div>

            {students.length === 0 && !loading ? (
              <p className="text-center text-gray-400 py-8 text-sm">
                {cls ? `All students from ${cls} are already in the ledger` : 'Select a class above'}
              </p>
            ) : (
              <div className="divide-y divide-gray-100 max-h-[50vh] overflow-y-auto">
                {students.map(s => {
                  const isSel = selected.has(s.admission_number);
                  const slPreview = isSel
                    ? 'SL-' + String(nextSL + [...selected].indexOf(s.admission_number)).padStart(4,'0')
                    : null;
                  return (
                    <div key={s.admission_number}
                      className={`flex items-center gap-3 px-4 py-3 transition-colors
                        ${isSel ? 'bg-blue-50 border-l-4 border-blue-600' : 'hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleSelect(s.admission_number)}
                        className="w-4 h-4 accent-blue-600 cursor-pointer shrink-0" />
                      {slPreview && (
                        <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-lg w-16 text-center shrink-0">
                          {slPreview}
                        </span>
                      )}
                      {!slPreview && <span className="w-16 shrink-0"></span>}
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-gray-800">{s.student_name}</p>
                        <p className="text-xs text-gray-500">{s.father_name || '—'}</p>
                        <p className="text-xs text-gray-400">{s.admission_number} · {s.current_class} {s.section}</p>
                      </div>
                      {isSel && (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center border-2 border-blue-200 focus-within:border-blue-400 rounded-xl overflow-hidden">
                            <span className="px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200">₹</span>
                            <input type="number" min="0" value={balances[s.admission_number]||''}
                              onChange={e => setBalance(s.admission_number, e.target.value)}
                              placeholder="Opening bal."
                              className="w-28 px-2 py-1.5 text-xs text-right focus:outline-none" />
                          </div>
                          <select value={tuitionStartMonths[s.admission_number] || academicMonthOptions(academicYear)[0].value}
                            onChange={e => setTuitionStartMonth(s.admission_number, e.target.value)}
                            title="Tuition dues generate from this month onward — not before"
                            className="border-2 border-blue-200 focus:border-blue-400 rounded-xl px-2 py-1.5 text-xs bg-white focus:outline-none">
                            {academicMonthOptions(academicYear).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {selected.size > 0 && (
              <div className="border-t border-gray-200 px-4 py-3 bg-blue-50 flex items-center justify-between">
                <p className="text-sm text-blue-700 font-medium">
                  {selected.size} student{selected.size !== 1 ? 's' : ''} selected
                  → will get SL-{String(nextSL).padStart(4,'0')} to SL-{String(nextSL + selected.size - 1).padStart(4,'0')}
                </p>
                <button onClick={() => setConfirming(true)}
                  className="px-6 py-2 bg-blue-700 hover:bg-blue-800 text-white text-sm font-bold rounded-xl">
                  + Add {selected.size} to Ledger
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mt-3 text-sm text-red-600">{error}</div>}
      </div>

      {/* Right — Current ledger snapshot */}
      <div className="w-64 shrink-0">
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden sticky top-0">
          <div className="bg-blue-700 px-4 py-3">
            <p className="text-white font-semibold text-sm">Current Ledger</p>
            <p className="text-blue-200 text-xs">{ledger.length} students assigned</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-gray-100">
            {ledger.slice(-20).map(l => (
              <div key={l.ledger_id} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-blue-700 w-16 shrink-0">{l.sl_number}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{l.student_name}</p>
                    <p className="text-xs text-gray-400">{l.current_class}</p>
                  </div>
                </div>
              </div>
            ))}
            {ledger.length === 0 && (
              <p className="text-center text-gray-400 text-xs py-6">No students yet</p>
            )}
            {ledger.length > 20 && (
              <p className="text-center text-gray-400 text-xs py-2">Showing last 20 of {ledger.length}</p>
            )}
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      {confirming && (
        <ConfirmModal
          title="Confirm Adding Students"
          message={`You are about to add ${selectedList.length} student${selectedList.length !== 1 ? 's' : ''} to the ${academicYear} ledger:\n\n` +
            selectedList.map((s,i) => `${i+1}. ${s.student_name} (${s.current_class}) → SL-${String(nextSL+i).padStart(4,'0')}`).join('\n')}
          confirmLabel={`✅ Confirm & Add ${selectedList.length}`}
          saving={adding}
          onConfirm={confirmAdd}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}

// Step 1b — New Students (bypass formal admission, charge them anyway)
function NewStudentStep({ academicYear, onAdded }) {
  const { user } = useAuth();
  const blank = { student_name: '', father_name: '', current_class: '', section: 'A', village: '', opening_balance: 0,
    tuition_start_month: `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}` };
  const [form,    setForm]    = useState(blank);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [result,  setResult]  = useState(null); // { student_ref, sl_number } after a successful add

  const set = (field, val) => { setForm(prev => ({ ...prev, [field]: val })); setResult(null); };

  const submit = async () => {
    if (!form.student_name.trim() || !form.father_name.trim() || !form.current_class) {
      setError('Student name, father\'s name and class are required.'); return;
    }
    setSaving(true); setError('');
    const res = await window.api.feeLedgerCreateProvisional(
      academicYear, form.student_name.trim(), form.father_name.trim(),
      form.current_class, form.section, form.village, form.opening_balance || 0, user?.username,
      form.tuition_start_month
    );
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setResult({ student_ref: res.student_ref, sl_number: res.sl_number });
    setForm(blank);
    onAdded?.();
  };

  return (
    <div className="max-w-xl">
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
        💡 For students who are attending but have NOT been formally admitted through New Admission. They're stored
        separately — never added to the official enrollment / SR Register — but can still be charged fee, transport
        and other charges like any other student.
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">
          ✅ Added — assigned <strong>{result.sl_number}</strong> (Reference No: {result.student_ref})
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Student Name <span className="text-red-400">*</span></label>
          <input value={form.student_name} onChange={e => set('student_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Father's Name <span className="text-red-400">*</span></label>
          <input value={form.father_name} onChange={e => set('father_name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-400">*</span></label>
            <select value={form.current_class} onChange={e => set('current_class', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
            <input value={form.section} onChange={e => set('section', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Village <span className="text-gray-400">(needed if they'll use transport)</span></label>
          <select value={form.village} onChange={e => set('village', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
            <option value="">Select village</option>
            {VILLAGES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Opening Balance (previous year carry-forward, if any)</label>
          <input type="number" min="0" value={form.opening_balance} onChange={e => set('opening_balance', parseFloat(e.target.value) || 0)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Tuition Dues Start From <span className="text-red-400">*</span></label>
          <select value={form.tuition_start_month} onChange={e => set('tuition_start_month', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400">
            {academicMonthOptions(academicYear).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Tuition dues generate from this month onward only — nothing before it.</p>
        </div>
        <button onClick={submit} disabled={saving}
          className="w-full px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
          {saving ? '⏳ Adding...' : '+ Add to Ledger'}
        </button>
      </div>
    </div>
  );
}


function MakeGroupsStep({ academicYear, refreshKey }) {
  const { user }    = useAuth();
  const [ungrouped, setUngrouped] = useState([]);
  const [search,    setSearch]    = useState('');
  const [selected,  setSelected]  = useState(new Set());
  const [confirm,   setConfirm]   = useState(null);   // { members, gsl }
  const [concessions, setConcessions] = useState({}); // { [ledger_id]: percentage string }
  const [settings,  setSettings]  = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState('');
  const [msg,       setMsg]       = useState('');

  const load = useCallback(async () => {
    const res = await window.api.feeLedgerGetUngrouped(academicYear);
    if (res.success) setUngrouped(res.data);
    const setRes = await window.api.feeSettingsGet(academicYear);
    if (setRes.success) setSettings(setRes.data);
  }, [academicYear]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const toggleSelect = (ledgerId) => setSelected(prev => {
    const n = new Set(prev); n.has(ledgerId) ? n.delete(ledgerId) : n.add(ledgerId); return n;
  });

  const filtered = ungrouped.filter(s => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.student_name.toLowerCase().includes(q) ||
           s.sl_number.toLowerCase().includes(q) ||
           (s.father_name||'').toLowerCase().includes(q);
  });

  const concessionFrom = settings?.sibling_concession_from || 3;
  const defaultPct     = settings?.sibling_concession_pct || 0;

  const openConfirm = async () => {
    const gslRes = await window.api.feeLedgerGetNextGSL(academicYear);
    if (!gslRes.success) { setError(gslRes.message); return; }
    const members = ungrouped
      .filter(l => selected.has(l.ledger_id))
      .sort((a,b) => (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1));
    // Pre-fill every eligible sibling (3rd+ by default) with the school's
    // standard rate — each one independently editable from here.
    const initial = {};
    members.forEach((m, i) => { if (i + 1 >= concessionFrom) initial[m.ledger_id] = String(defaultPct); });
    setConcessions(initial);
    setConfirm({ members, gsl: gslRes.next_gsl, gsl_num: gslRes.next_num });
  };

  const setConcession = (ledgerId, val) => setConcessions(prev => ({ ...prev, [ledgerId]: val }));

  const createGroup = async () => {
    if (!confirm) return;
    setSaving(true); setError('');
    const ids = confirm.members.map(m => m.ledger_id);
    const res = await window.api.feeLedgerCreateGroup(academicYear, ids, user?.username, confirm.gsl_num, concessions);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setMsg(`Group ${confirm.gsl} created ✓`);
    setConfirm(null); setSelected(new Set()); setConcessions({});
    setTimeout(() => setMsg(''), 3000);
    load();
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by SL number, name or father's name..."
          className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        {selected.size >= 2 && (
          <button onClick={openConfirm}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl whitespace-nowrap">
            👨‍👧‍👦 Make Group ({selected.size})
          </button>
        )}
      </div>

      {msg   && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">{msg}</div>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
      {selected.size === 1 && <p className="text-xs text-gray-400 mb-3">Select one more student to make a group</p>}

      <p className="text-sm text-gray-500 mb-3">{filtered.length} ungrouped student{filtered.length !== 1 ? 's' : ''}</p>

      <div className="space-y-2">
        {filtered.map(l => {
          const isSel = selected.has(l.ledger_id);
          return (
            <div key={l.ledger_id}
              className={`flex items-center gap-3 px-4 py-3 bg-white border-2 rounded-2xl transition-colors
                ${isSel ? 'border-purple-400 bg-purple-50' : 'border-gray-100 hover:border-gray-200'}`}>
              <input type="checkbox" checked={isSel} onChange={() => toggleSelect(l.ledger_id)}
                className="w-4 h-4 accent-purple-600 cursor-pointer shrink-0" />
              <span className="text-xs font-bold text-blue-700 w-16 shrink-0">{l.sl_number}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{l.student_name}</p>
                <p className="text-xs text-gray-400">{l.father_name || '—'} · {l.current_class} {l.section}</p>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">🎉</p>
            <p>{ungrouped.length === 0 ? 'All students are already in groups.' : 'No matching students.'}</p>
          </div>
        )}
      </div>

      {/* Auto-GSL confirmation modal */}
      {confirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-purple-600 px-6 py-4">
              <h3 className="text-white font-bold">Confirm Group Creation</h3>
              <p className="text-purple-100 text-xs mt-0.5">GSL number assigned automatically</p>
            </div>
            <div className="px-6 py-5 space-y-4">
              {/* GSL number badge */}
              <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4 text-center">
                <p className="text-xs text-purple-500 mb-1">Group Ledger Number</p>
                <p className="text-3xl font-bold text-purple-700">{confirm.gsl}</p>
                <p className="text-xs text-purple-400 mt-1">next available number</p>
              </div>

              {/* Members list sorted oldest first */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-semibold text-gray-500 mb-2">Members (oldest → youngest):</p>
                {confirm.members.map((m, i) => {
                  const isEligible = i + 1 >= concessionFrom;
                  return (
                    <div key={m.ledger_id} className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400 text-xs w-4">{i+1}.</span>
                      <span className="font-bold text-blue-700 text-xs">{m.sl_number}</span>
                      <span className="font-medium text-gray-800">{m.student_name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{m.current_class}</span>
                      {isEligible && (
                        <div className="flex items-center gap-1 shrink-0">
                          <input type="number" min="0" max="100" value={concessions[m.ledger_id] ?? ''}
                            onChange={e => setConcession(m.ledger_id, e.target.value)}
                            title="Tuition concession for this sibling — set individually, doesn't affect other siblings"
                            className="w-14 border border-purple-200 rounded-lg px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-purple-400" />
                          <span className="text-xs text-gray-400">%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                {confirm.members.length >= concessionFrom && (
                  <p className="text-xs text-gray-400 pt-1">
                    Pre-filled with the school's standard {defaultPct}% — adjust any sibling's number individually if a different rate (including a full 100% waiver) was agreed for them specifically.
                  </p>
                )}
              </div>

              {error && <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button onClick={() => { setConfirm(null); setError(''); }}
                className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl py-2.5 text-sm font-medium">
                Cancel
              </button>
              <button onClick={createGroup} disabled={saving}
                className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-xl py-2.5 text-sm font-bold">
                {saving ? '⏳ Creating...' : `✅ Create ${confirm.gsl}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Step 3 — Manage Groups (existing groups, remove members, add members)
function ManageGroupsStep({ academicYear }) {
  const [ledger,    setLedger]    = useState([]);
  const [ungrouped, setUngrouped] = useState([]);
  const [search,    setSearch]    = useState('');
  const [removing,  setRemoving]  = useState(null);
  const [addingTo,  setAddingTo]  = useState(null);  // group to add member to
  const [addError,  setAddError]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [msg,       setMsg]       = useState('');
  const [settings,  setSettings]  = useState(null);
  const [editConcession, setEditConcession] = useState({}); // { [ledger_id]: string }

  const load = useCallback(async () => {
    const [ledRes, ungRes, setRes] = await Promise.all([
      window.api.feeLedgerGetAll(academicYear),
      window.api.feeLedgerGetUngrouped(academicYear),
      window.api.feeSettingsGet(academicYear),
    ]);
    if (ledRes.success) setLedger(ledRes.data);
    if (ungRes.success) setUngrouped(ungRes.data);
    if (setRes.success) setSettings(setRes.data);
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const concessionFrom = settings?.sibling_concession_from || 3;
  const defaultPct     = settings?.sibling_concession_pct || 0;

  const saveConcession = async (ledger_id, pct) => {
    setSaving(true);
    await window.api.feeLedgerUpdateSiblingConcession(ledger_id, pct === '' ? null : pct);
    setSaving(false);
    setEditConcession(p => ({ ...p, [ledger_id]: undefined }));
    load();
  };

  // Build groups map
  const grouped = {};
  ledger.forEach(l => {
    if (l.gsl_number) {
      if (!grouped[l.gsl_number]) grouped[l.gsl_number] = { members: [], group_id: l.group_id };
      grouped[l.gsl_number].members.push(l);
    }
  });
  Object.values(grouped).forEach(g =>
    g.members.sort((a,b) => (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1))
  );

  const filteredGroups = Object.entries(grouped).filter(([gsl, g]) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return gsl.toLowerCase().includes(q) ||
      g.members.some(m => m.student_name.toLowerCase().includes(q) || (m.father_name||'').toLowerCase().includes(q));
  });

  // Remove member
  const confirmRemove = async () => {
    if (!removing) return;
    setSaving(true);
    const res = await window.api.feeLedgerRemoveFromGroup(removing.ledger_id);
    setSaving(false);
    setRemoving(null);
    if (res.success) {
      setMsg(res.dissolved
        ? `${removing.student_name} removed — group dissolved`
        : `${removing.student_name} removed from group`);
      setTimeout(() => setMsg(''), 4000);
      load();
    }
  };

  // Add member to existing group
  const addMember = async (ledger_id) => {
    if (!addingTo) return;
    setSaving(true); setAddError('');
    const res = await window.api.feeLedgerAddToGroup(ledger_id, addingTo.group_id, academicYear);
    setSaving(false);
    if (!res.success) { setAddError(res.message); return; }
    const student = ungrouped.find(u => u.ledger_id === ledger_id);
    setMsg(`${student?.student_name || 'Student'} added to ${addingTo.gsl_number} ✓`);
    setAddingTo(null);
    setTimeout(() => setMsg(''), 4000);
    load();
  };

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by GSL number, student name or father's name..."
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
      </div>

      {msg && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">{msg}</div>}

      <p className="text-sm text-gray-500 mb-3">{filteredGroups.length} group{filteredGroups.length !== 1 ? 's' : ''}</p>

      <div className="space-y-3">
        {filteredGroups.map(([gsl, g]) => (
          <div key={gsl} className="bg-white border-2 border-purple-200 rounded-2xl overflow-hidden">
            <div className="bg-purple-50 px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-purple-700">{gsl}</span>
                <span className="text-xs text-purple-400">{g.members.length} siblings · oldest first</span>
              </div>
              {ungrouped.length > 0 && (
                <button onClick={() => { setAddingTo({ gsl_number: gsl, group_id: g.group_id }); setAddError(''); }}
                  className="text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 border border-purple-300 px-3 py-1.5 rounded-lg font-medium">
                  + Add Member
                </button>
              )}
            </div>
            {g.members.map((l, idx) => {
              const isEligible = idx + 1 >= concessionFrom;
              return (
                <div key={l.ledger_id} className="flex items-center gap-3 px-4 py-2.5 border-t border-purple-100">
                  <span className="text-xs font-bold text-blue-700 w-16 shrink-0">{l.sl_number}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{l.student_name}</p>
                    <p className="text-xs text-gray-400">{l.father_name || '—'} · {l.current_class} {l.section}</p>
                  </div>
                  {isEligible && (
                    editConcession[l.ledger_id] !== undefined ? (
                      <span className="flex items-center gap-1 shrink-0">
                        <input type="number" min="0" max="100" value={editConcession[l.ledger_id]}
                          onChange={e => setEditConcession(p => ({ ...p, [l.ledger_id]: e.target.value }))}
                          className="w-14 border border-purple-300 rounded px-1.5 py-1 text-xs text-right focus:outline-none" />
                        <span className="text-xs text-gray-400">%</span>
                        <button onClick={() => saveConcession(l.ledger_id, editConcession[l.ledger_id])}
                          className="text-xs bg-purple-600 text-white px-1.5 py-1 rounded">✓</button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setEditConcession(p => ({ ...p, [l.ledger_id]: l.custom_concession_pct !== null && l.custom_concession_pct !== undefined ? String(l.custom_concession_pct) : String(defaultPct) }))}
                        title="Tuition concession for this sibling"
                        className={`text-xs px-2.5 py-1 rounded-lg font-medium shrink-0 border ${
                          l.custom_concession_pct !== null && l.custom_concession_pct !== undefined
                            ? 'border-purple-300 bg-purple-50 text-purple-700'
                            : 'border-gray-200 text-gray-400 hover:bg-gray-50'}`}>
                        {l.custom_concession_pct !== null && l.custom_concession_pct !== undefined
                          ? `${l.custom_concession_pct}% (custom)`
                          : `${defaultPct}% (default)`}
                      </button>
                    )
                  )}
                  <button onClick={() => setRemoving({ ...l, gsl_number: gsl })}
                    className="text-xs border border-red-200 text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg font-medium">
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        ))}
        {filteredGroups.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">👨‍👧‍👦</p>
            <p>{Object.keys(grouped).length === 0 ? 'No groups created yet. Use "Make Groups" to create one.' : 'No matching groups.'}</p>
          </div>
        )}
      </div>

      {/* Remove confirmation */}
      {removing && (
        <ConfirmModal
          title="Remove from Group"
          message={`Remove ${removing.student_name} (${removing.sl_number}) from ${removing.gsl_number}?

If only one student remains afterwards, the group will be dissolved automatically.`}
          confirmLabel="🗑 Remove"
          danger saving={saving}
          onConfirm={confirmRemove}
          onCancel={() => setRemoving(null)}
        />
      )}

      {/* Add member modal */}
      {addingTo && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-purple-600 px-6 py-4">
              <h3 className="text-white font-bold">Add Member to {addingTo.gsl_number}</h3>
              <p className="text-purple-100 text-xs mt-0.5">Select an ungrouped student to add</p>
            </div>
            {addError && (
              <div className="bg-red-50 border-b border-red-200 px-5 py-2.5 text-sm text-red-600">{addError}</div>
            )}
            <div className="max-h-96 overflow-y-auto divide-y divide-gray-100">
              {ungrouped.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">No ungrouped students available</p>
              ) : ungrouped.map(u => (
                <button key={u.ledger_id} onClick={() => addMember(u.ledger_id)} disabled={saving}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-purple-50 text-left transition-colors disabled:opacity-50">
                  <span className="text-xs font-bold text-blue-700 w-16 shrink-0">{u.sl_number}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{u.student_name}</p>
                    <p className="text-xs text-gray-400">{u.father_name || '—'} · {u.current_class} {u.section}</p>
                  </div>
                  <span className="text-purple-600 text-xs font-medium">{saving ? '⏳' : 'Add →'}</span>
                </button>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-200">
              <button onClick={() => { setAddingTo(null); setAddError(''); }}
                className="w-full border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl py-2.5 text-sm font-medium">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Tab 1 wrapper — three sub-tabs
function CreateLedgerTab({ academicYear }) {
  const [step,       setStep]       = useState('add');
  const [refreshKey, setRefreshKey] = useState(0);

  const STEPS = [
    { key: 'add',        label: '➕ Existing Students' },
    { key: 'newstudent', label: '🆕 New Students'      },
    { key: 'make',       label: '👨‍👧‍👦 Make Groups'       },
    { key: 'manage',     label: '⚙️ Manage Groups'     },
  ];

  return (
    <div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-4">
        {STEPS.map(s => (
          <button key={s.key} onClick={() => setStep(s.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${step === s.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {step === 'add'        && <AddStudentsStep  academicYear={academicYear} onAdded={() => setRefreshKey(k => k+1)} />}
      {step === 'newstudent' && <NewStudentStep    academicYear={academicYear} onAdded={() => setRefreshKey(k => k+1)} />}
      {step === 'make'       && <MakeGroupsStep    academicYear={academicYear} refreshKey={refreshKey} />}
      {step === 'manage'     && <ManageGroupsStep  academicYear={academicYear} key={refreshKey} />}
    </div>
  );
}

// ── Transport Monthly Tab ─────────────────────────────────────
const MONTHS_MAP = { '04':'April','05':'May','06':'June','07':'July','08':'August','09':'September','10':'October','11':'November','12':'December','01':'January','02':'February','03':'March' };

function TransportMonthlyTab({ academicYear }) {
  const { user } = useAuth();
  const [month,    setMonth]    = useState(String(new Date().getMonth()+1).padStart(2,'0'));
  const [classFilter, setClassFilter] = useState('');
  const [villageFilter, setVillageFilter] = useState('');
  const [students, setStudents] = useState([]);
  const [routes,   setRoutes]   = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');
  const [changes,  setChanges]  = useState({}); // admission_number → true/false (unset = keep as-is)
  const [carriedForward, setCarriedForward] = useState(false);
  const [carriedFromMonth, setCarriedFromMonth] = useState(null);
  const [showPrint, setShowPrint] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(''); setChanges({});
    const [stuRes, routeRes] = await Promise.all([
      window.api.transportGetMonthly(academicYear, month),
      window.api.transportRoutesGetAll(academicYear),
    ]);
    if (stuRes.success) {
      setStudents(stuRes.data);
      setCarriedForward(!!stuRes.carried_forward);
      setCarriedFromMonth(stuRes.carried_from_month || null);
    }
    if (routeRes.success) setRoutes(routeRes.data);
    setLoading(false);
  }, [academicYear, month]);

  useEffect(() => { load(); }, [load]);

  const setEnabled = (admNo, enabled) => {
    setChanges(prev => ({ ...prev, [admNo]: enabled }));
    setSaved(false);
  };

  // Is this student currently ON transport, accounting for unsaved edits?
  const isOn = (s) => changes.hasOwnProperty(s.admission_number) ? changes[s.admission_number] : !!s.assign_id;

  const save = async () => {
    if (!carriedForward && Object.keys(changes).length === 0) { setError('No changes to save.'); return; }
    setSaving(true); setError('');
    // First save for a carried-forward month writes the FULL effective
    // state (carried + any edits) — there's nothing to diff against yet,
    // since this month has never actually been saved before.
    const assignments = carriedForward
      ? students.map(s => ({ admission_number: s.admission_number, enabled: isOn(s) }))
      : Object.entries(changes).map(([admission_number, enabled]) => ({ admission_number, enabled }));
    const res = await window.api.transportSaveMonthly(academicYear, month, assignments, user?.username);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 2000);
    setChanges({});
    load();
  };

  const [exportMsg, setExportMsg] = useState('');
  const exportExcel = async () => {
    setExportMsg('');
    const res = await window.api.feeLedgerExportTransportListExcel(
      visibleStudents.filter(s => isOn(s)), MONTHS_MAP[month], academicYear
    );
    if (res.cancelled) return;
    if (!res.success) { setError(res.message); return; }
    setExportMsg(`✅ Saved to ${res.filePath}`);
    setTimeout(() => setExportMsg(''), 4000);
  };

  const villageOptions = [...new Set(students.map(s => s.village).filter(Boolean))].sort();

  const visibleStudents = students
    .filter(s => !classFilter   || s.current_class === classFilter)
    .filter(s => !villageFilter || s.village === villageFilter);

  const filterLabel = [classFilter, villageFilter].filter(Boolean).join(' — ');

  const changedCount  = Object.keys(changes).length;
  const assignedCount = visibleStudents.filter(s => isOn(s)).length;
  const noRouteCount  = visibleStudents.filter(s => !s.auto_route_id).length;
  const canSave = carriedForward || changedCount > 0;

  return (
    <div>
      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex gap-4 items-end flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
          <select value={month} onChange={e => { setMonth(e.target.value); }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {Object.entries(MONTHS_MAP).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
          <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Village</label>
          <select value={villageFilter} onChange={e => setVillageFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Villages</option>
            {villageOptions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-3 ml-auto">
          {changedCount > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-3 py-1.5 rounded-full font-medium">
              {changedCount} unsaved change{changedCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full">
            {assignedCount} students on transport
          </span>
          <button onClick={() => setShowPrint(true)}
            className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-xl">
            🖨️ Print
          </button>
          <button onClick={exportExcel}
            className="px-4 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium rounded-xl">
            📊 Excel
          </button>
          <button onClick={save} disabled={saving || !canSave}
            className="px-6 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl">
            {saving ? '⏳ Saving...' : '💾 Save Changes'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
      {saved  && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">✅ Transport assignments saved for {MONTHS_MAP[month]}</div>}
      {exportMsg && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">{exportMsg}</div>}
      {!loading && carriedForward && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-4 text-sm text-blue-700">
          📋 {MONTHS_MAP[month]} hasn't been saved yet — showing {MONTHS_MAP[carriedFromMonth]}'s assignments carried over.
          Add or remove anyone who's actually changing this month, then click <strong>Save Changes</strong> to confirm.
        </div>
      )}
      {!loading && noRouteCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
          ⚠️ {noRouteCount} student{noRouteCount !== 1 ? 's live' : ' lives'} in a village with no active route set up —
          they can't be enabled for transport until a route is added in Fee Settings → Transport Routes for that village.
        </div>
      )}

      {loading ? (
        <div className="text-center py-10 text-gray-400">Loading...</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="bg-blue-700 px-5 py-3 flex justify-between items-center">
            <p className="text-white font-semibold">Transport Assignments — {MONTHS_MAP[month]} {academicYear}{filterLabel ? ` — ${filterLabel}` : ''}</p>
            <div className="flex gap-3 text-xs text-blue-200">
              <span>{visibleStudents.length} student{visibleStudents.length !== 1 ? 's' : ''}{filterLabel ? ' matching filters' : ' in ledger'}</span>
              <span>·</span>
              <span>{routes.length} routes available</span>
            </div>
          </div>

          <div className="px-5 py-2 bg-blue-50 border-b border-blue-100 text-xs text-blue-600">
            Routes are matched automatically from each student's village. To change a formally admitted student's village,
            use Edit Student — not here. Provisional students (added via New Students) don't have a village edit screen yet.
          </div>

          {/* Quick assign all */}
          <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">
              Quick assign{filterLabel ? ` (${filterLabel} only)` : ''}:
            </span>
            <button onClick={() => setChanges(prev => {
              const n = { ...prev };
              visibleStudents.forEach(s => { if (s.auto_route_id) n[s.admission_number] = true; });
              return n;
            })} className="text-xs border border-green-200 text-green-600 hover:bg-green-50 px-3 py-1 rounded-lg">
              Enable All (with a matched route)
            </button>
            <button onClick={() => setChanges(prev => {
              const n = { ...prev };
              visibleStudents.forEach(s => { n[s.admission_number] = false; });
              return n;
            })} className="text-xs border border-red-200 text-red-500 hover:bg-red-50 px-3 py-1 rounded-lg">
              Remove All
            </button>
          </div>

          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['SL No','Student','Class','Village','Matched Route','Monthly Fee','Transport this month?'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleStudents.map((s, i) => {
                const on       = isOn(s);
                const changed  = changes.hasOwnProperty(s.admission_number);
                const hasRoute = !!s.auto_route_id;
                return (
                  <tr key={s.admission_number}
                    className={`${changed ? 'bg-amber-50' : i%2===0 ? 'bg-white' : 'bg-gray-50'}`}>
                    <td className="px-4 py-2.5 text-xs font-bold text-blue-700">{s.sl_number}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{s.student_name}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{s.current_class} {s.section}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{s.village || '—'}</td>
                    <td className="px-4 py-2.5 text-xs">
                      {hasRoute
                        ? <span className="text-gray-700">{s.auto_route_name}</span>
                        : <span className="text-amber-500">No route for this village</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm">
                      {hasRoute
                        ? <span className="font-bold text-blue-700">₹{s.auto_monthly_amount}/mo</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => hasRoute && setEnabled(s.admission_number, !on)}
                        disabled={!hasRoute}
                        title={hasRoute ? '' : 'No matched route for this village'}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                          ${!hasRoute ? 'bg-gray-200 cursor-not-allowed' : on ? 'bg-green-500' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                          ${on ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibleStudents.length === 0 && (
            <p className="text-center text-gray-400 py-8 text-sm">
              {filterLabel ? `No students matching ${filterLabel} for ${academicYear}` : `No students in ledger for ${academicYear}`}
            </p>
          )}
        </div>
      )}

      {showPrint && (
        <TransportListPrintModal
          students={visibleStudents.filter(s => isOn(s))}
          monthLabel={MONTHS_MAP[month]}
          academicYear={academicYear}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}

// ── Monthly Fee Pending Report ──────────────────────────────
const REPORT_MONTHS = [
  ['04','April'],['05','May'],['06','June'],['07','July'],['08','August'],['09','September'],
  ['10','October'],['11','November'],['12','December'],['01','January'],['02','February'],['03','March'],
];

function MonthlyFeeReportView({ academicYear }) {
  const nowMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const nowYear  = String(new Date().getFullYear());
  const [month,   setMonth]   = useState(nowMonth);
  const [year,    setYear]    = useState(nowYear);
  const [cls,     setCls]     = useState('');
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [loaded,  setLoaded]  = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  const loadReport = useCallback(async () => {
    setLoading(true); setError('');
    const res = await window.api.feeLedgerGetMonthlyReport(academicYear, month, year, cls || null);
    setLoading(false); setLoaded(true);
    if (!res.success) { setError(res.message); setRows([]); return; }
    setRows(res.data);
  }, [academicYear, month, year, cls]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const monthLabel = (REPORT_MONTHS.find(m => m[0] === month)?.[1] || '') + ' ' + year;

  const totals = rows.reduce((t, r) => ({
    prev_balance: t.prev_balance + (r.prev_balance || 0),
    fee_due:      t.fee_due      + (r.fee_due || 0),
    fee_paid:     t.fee_paid     + (r.fee_paid || 0),
    balance:      t.balance      + (r.balance || 0),
  }), { prev_balance: 0, fee_due: 0, fee_paid: 0, balance: 0 });

  const exportExcel = async () => {
    setExportMsg('');
    setExporting(true);
    const res = await window.api.feeLedgerExportMonthlyReportExcel(rows, totals, monthLabel, cls || null);
    setExporting(false);
    if (res.cancelled) return;
    if (!res.success) { setError(res.message); return; }
    setExportMsg(`✓ Saved to ${res.filePath}`);
    setTimeout(() => setExportMsg(''), 5000);
  };

  return (
    <div>
      {/* Filters — hidden on print */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Month</label>
          <select value={month} onChange={e => setMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {REPORT_MONTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {[SESSION_YEAR - 1, SESSION_YEAR, SESSION_YEAR + 1].map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5">Class</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={exportExcel} disabled={rows.length === 0 || exporting}
          className="ml-auto px-5 py-2 border border-green-600 text-green-700 hover:bg-green-50 rounded-xl text-sm font-medium disabled:opacity-40 disabled:hover:bg-transparent">
          {exporting ? '⏳ Saving…' : '📊 Download Excel'}
        </button>
        <button onClick={() => setShowPrint(true)} disabled={rows.length === 0}
          className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:bg-blue-300">
          🖨️ Print
        </button>
      </div>

      {exportMsg && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700 print:hidden">{exportMsg}</div>}

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600 print:hidden">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">

        {loading && <p className="text-center text-gray-400 py-10">⏳ Loading report...</p>}
        {!loading && loaded && rows.length === 0 && (
          <p className="text-center text-gray-400 py-10">No students found in the ledger for {academicYear}{cls ? ` — ${cls}` : ''}.</p>
        )}

        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left w-12">Sr No</th>
                  <th className="px-3 py-2 text-left">Student Ledger No</th>
                  <th className="px-3 py-2 text-left">Student Name &amp; Class</th>
                  <th className="px-3 py-2 text-left">Father's Name</th>
                  <th className="px-3 py-2 text-left">Village</th>
                  <th className="px-3 py-2 text-right">Previous Balance</th>
                  <th className="px-3 py-2 text-right">Fee Due</th>
                  <th className="px-3 py-2 text-right">Fee Paid</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.ledger_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500">{r.sr_no}</td>
                    <td className="px-3 py-2 font-semibold text-blue-700">{r.sl_number}</td>
                    <td className="px-3 py-2">{r.student_name} <span className="text-gray-400">({r.current_class}{r.section ? '-' + r.section : ''})</span></td>
                    <td className="px-3 py-2 text-gray-600">{r.father_name || '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{r.village || '—'}</td>
                    <td className="px-3 py-2 text-right">₹{fmt(r.prev_balance)}</td>
                    <td className="px-3 py-2 text-right">₹{fmt(r.fee_due)}</td>
                    <td className="px-3 py-2 text-right text-green-700">₹{fmt(r.fee_paid)}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${r.balance > 0 ? 'text-red-600' : 'text-green-700'}`}>₹{fmt(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-300">
                  <td className="px-3 py-2" colSpan={5}>Total</td>
                  <td className="px-3 py-2 text-right">₹{fmt(totals.prev_balance)}</td>
                  <td className="px-3 py-2 text-right">₹{fmt(totals.fee_due)}</td>
                  <td className="px-3 py-2 text-right text-green-700">₹{fmt(totals.fee_paid)}</td>
                  <td className="px-3 py-2 text-right text-red-600">₹{fmt(totals.balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {showPrint && (
        <MonthlyLedgerReportPrintModal rows={rows} totals={totals} monthLabel={monthLabel} cls={cls} onClose={() => setShowPrint(false)} />
      )}
    </div>
  );
}

// ── Tab 3: View Ledger ───────────────────────────────────────
function ViewLedgerTab({ academicYear }) {
  const [subView,     setSubView]     = useState('search'); // 'search' | 'monthly'
  const [query,       setQuery]       = useState('');
  const [results,     setResults]     = useState([]);
  const [selected,    setSelected]    = useState(null);
  const [txnData,     setTxnData]     = useState(null);
  const [groupData,   setGroupData]   = useState(null); // for group ledger view
  const [loadingTxn,  setLoadingTxn]  = useState(false);
  const [editPage,    setEditPage]    = useState({});
  const [editBal,     setEditBal]     = useState({});
  const [editTuitionMonth, setEditTuitionMonth] = useState({});

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!query.trim()) { setResults([]); return; }
      const res = await window.api.feeLedgerSearch(query, academicYear);
      if (res.success) setResults(res.data);
    }, 300);
    return () => clearTimeout(t);
  }, [query, academicYear]);

  const openLedger = async (row) => {
    setSelected(row); setTxnData(null); setGroupData(null); setLoadingTxn(true);

    if (row.is_group_entry) {
      // Load group ledger — fetch each member's transactions
      const memberTxns = await Promise.all(
        row.members.map(m => window.api.feeLedgerGetTransactions(m.ledger_id, academicYear))
      );
      setGroupData({ group: row, memberTxns: memberTxns.map((r,i) => ({ ...r, member: row.members[i] })) });
    } else {
      const res = await window.api.feeLedgerGetTransactions(row.ledger_id, academicYear);
      if (res.success) setTxnData(res);
    }
    setLoadingTxn(false);
  };

  const savePage = async (ledger_id, page) => {
    await window.api.feeLedgerUpdatePage(ledger_id, page);
    setEditPage(p => ({ ...p, [ledger_id]: undefined }));
    if (selected?.ledger_id === ledger_id) setSelected(s => ({ ...s, physical_page: page }));
  };

  const saveBalance = async (ledger_id, bal) => {
    await window.api.feeLedgerUpdateOpeningBal(ledger_id, parseFloat(bal) || 0);
    setEditBal(p => ({ ...p, [ledger_id]: undefined }));
    if (txnData) {
      const res = await window.api.feeLedgerGetTransactions(ledger_id, academicYear);
      if (res.success) setTxnData(res);
    }
    if (groupData) {
      const memberTxns = await Promise.all(
        groupData.group.members.map(m => window.api.feeLedgerGetTransactions(m.ledger_id, academicYear))
      );
      setGroupData(prev => ({ ...prev, memberTxns: memberTxns.map((r,i) => ({ ...r, member: groupData.group.members[i] })) }));
    }
  };

  const saveTuitionMonth = async (ledger_id, month) => {
    await window.api.feeLedgerUpdateTuitionStartMonth(ledger_id, month);
    setEditTuitionMonth(p => ({ ...p, [ledger_id]: undefined }));
    if (txnData) {
      const res = await window.api.feeLedgerGetTransactions(ledger_id, academicYear);
      if (res.success) setTxnData(res);
    }
    if (groupData) {
      const memberTxns = await Promise.all(
        groupData.group.members.map(m => window.api.feeLedgerGetTransactions(m.ledger_id, academicYear))
      );
      setGroupData(prev => ({ ...prev, memberTxns: memberTxns.map((r,i) => ({ ...r, member: groupData.group.members[i] })) }));
    }
  };

  const fmt     = (n) => Number(n || 0).toFixed(2);
  const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

  return (
    <div>
      {/* Sub-view toggle */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-4 w-fit print:hidden">
        <button onClick={() => setSubView('search')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
            ${subView === 'search' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          🔍 Search Ledger
        </button>
        <button onClick={() => setSubView('monthly')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
            ${subView === 'monthly' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          📅 Monthly Fee Report
        </button>
      </div>

      {subView === 'monthly' && <MonthlyFeeReportView academicYear={academicYear} />}

      {subView === 'search' && (
    <div className="flex gap-4">
      {/* Search sidebar */}
      <div className="w-72 shrink-0">
        <input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search SL, GSL or student name..."
          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3" />
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {results.length === 0 && query && (
            <p className="text-center text-gray-400 text-sm py-6">No results</p>
          )}
          {results.length === 0 && !query && (
            <p className="text-center text-gray-400 text-sm py-6">Type to search ledger</p>
          )}
          {results.map((r, i) => (
            <button key={r.is_group_entry ? r.gsl_number : r.ledger_id}
              onClick={() => openLedger(r)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 transition-colors
                ${selected?.sl_number === r.sl_number && selected?.is_group_entry === r.is_group_entry
                  ? 'bg-blue-50 border-l-4 border-l-blue-700' : ''}
                ${r.is_group_entry ? 'bg-purple-50 hover:bg-purple-100' : ''}`}>
              {r.is_group_entry ? (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-purple-700">{r.gsl_number}</p>
                    <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">Group Ledger</span>
                  </div>
                  <p className="text-xs text-purple-500 mt-0.5">{r.member_count} siblings — combined view</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-blue-700">{r.sl_number}</p>
                    {r.gsl_number && <span className="text-xs text-purple-500">{r.gsl_number}</span>}
                  </div>
                  <p className="text-xs font-semibold text-gray-800">{r.student_name}</p>
                  <p className="text-xs text-gray-400">{r.current_class} · {r.father_name || '—'}</p>
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Ledger view */}
      <div className="flex-1 min-w-0">
        {!selected && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📒</p>
            <p>Search for a student or GSL number to view their ledger</p>
          </div>
        )}

        {/* Individual ledger */}
        {selected && !selected.is_group_entry && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="bg-blue-700 px-6 py-4 flex items-start justify-between">
              <div>
                <p className="text-white font-bold text-lg">BRILLIANT PUBLIC SCHOOL</p>
                <p className="text-blue-200 text-xs">Student Fees Ledger — {academicYear}</p>
              </div>
              <div className="text-right">
                <p className="text-white font-bold text-xl">{selected.sl_number}</p>
                {selected.gsl_number && <p className="text-blue-200 text-sm">{selected.gsl_number}</p>}
              </div>
            </div>
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><span className="text-gray-500 text-xs">Student Name</span><p className="font-semibold text-gray-800">{selected.student_name}</p></div>
                <div><span className="text-gray-500 text-xs">Class</span><p className="font-semibold text-gray-800">{selected.current_class} — {selected.section}</p></div>
                <div><span className="text-gray-500 text-xs">Father's Name</span><p className="font-semibold text-gray-800">{selected.father_name || '—'}</p></div>
                <div><span className="text-gray-500 text-xs">Admission No</span><p className="font-semibold text-gray-800">{selected.admission_number}</p></div>
                <div><span className="text-gray-500 text-xs">Transport</span><p className="font-semibold text-gray-800">{selected.route_name || 'None'}</p></div>
                <div>
                  <span className="text-gray-500 text-xs">Physical Page</span>
                  {editPage[selected.ledger_id] !== undefined ? (
                    <div className="flex gap-1 mt-0.5">
                      <input value={editPage[selected.ledger_id]} onChange={e => setEditPage(p => ({ ...p, [selected.ledger_id]: e.target.value }))}
                        className="border border-gray-300 rounded px-2 py-0.5 text-xs w-16 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                      <button onClick={() => savePage(selected.ledger_id, editPage[selected.ledger_id])} className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">✓</button>
                    </div>
                  ) : (
                    <p className="font-semibold text-gray-800 cursor-pointer hover:text-blue-600"
                      onClick={() => setEditPage(p => ({ ...p, [selected.ledger_id]: selected.physical_page || '' }))}>
                      {selected.physical_page || <span className="text-gray-400 italic text-xs">Click to set</span>}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <LedgerTransactionTable txnData={txnData} loadingTxn={loadingTxn} academicYear={academicYear}
              fmt={fmt} fmtDate={fmtDate} editBal={editBal} setEditBal={setEditBal} saveBalance={saveBalance}
              editTuitionMonth={editTuitionMonth} setEditTuitionMonth={setEditTuitionMonth} saveTuitionMonth={saveTuitionMonth} />
          </div>
        )}

        {/* Group ledger — unified single table */}
        {selected && selected.is_group_entry && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="bg-purple-700 px-6 py-4 flex items-start justify-between">
              <div>
                <p className="text-white font-bold text-lg">BRILLIANT PUBLIC SCHOOL</p>
                <p className="text-purple-200 text-xs">Group Fees Ledger — {academicYear}</p>
              </div>
              <div className="text-right">
                <p className="text-white font-bold text-xl">{selected.gsl_number}</p>
                <p className="text-purple-200 text-sm">{selected.member_count} siblings</p>
              </div>
            </div>

            {/* Members table */}
            <div className="px-6 py-3 bg-purple-50 border-b border-purple-200">
              <p className="text-xs font-semibold text-purple-600 mb-2">GROUP MEMBERS</p>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-purple-100">
                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-purple-700 border border-purple-200">Sr No</th>
                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-purple-700 border border-purple-200">SL No</th>
                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-purple-700 border border-purple-200">Student Name</th>
                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-purple-700 border border-purple-200">Class</th>
                    <th className="text-left px-3 py-1.5 text-xs font-semibold text-purple-700 border border-purple-200">Father's Name</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.members.map((m, i) => (
                    <tr key={m.ledger_id} className="bg-white">
                      <td className="px-3 py-1.5 text-xs border border-purple-100">{i + 1}</td>
                      <td className="px-3 py-1.5 text-xs font-bold text-blue-700 border border-purple-100">{m.sl_number}</td>
                      <td className="px-3 py-1.5 text-xs font-semibold text-gray-800 border border-purple-100">{m.student_name}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 border border-purple-100">{m.current_class} {m.section}</td>
                      <td className="px-3 py-1.5 text-xs text-gray-600 border border-purple-100">{m.father_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Unified transaction table */}
            {loadingTxn ? (
              <div className="text-center py-8 text-gray-400">Loading group ledger...</div>
            ) : groupData && (() => {
              // Merge all transactions, add running balance from combined opening
              const combinedOpening = groupData.memberTxns.reduce((s,m) => s + (m.ledger?.opening_balance || 0), 0);
              const allTxns = groupData.memberTxns.flatMap(({ member, transactions }) =>
                (transactions || []).map(t => ({ ...t, _member: member }))
              ).sort((a, b) => {
                const da = String(a.collected_at || '');
                const db2 = String(b.collected_at || '');
                return da.localeCompare(db2);
              });

              let running = combinedOpening;
              const withBalance = allTxns.map(t => {
                running += (t.debit || 0) - (t.credit || 0) - (t.concession || 0);
                return { ...t, running_balance: running };
              });
              const totalDebit  = allTxns.reduce((s,t) => s+(t.debit||0), 0);
              const totalCredit = allTxns.reduce((s,t) => s+(t.credit||0)+(t.concession||0), 0);
              const finalBal    = combinedOpening + totalDebit - totalCredit;

              return (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-100 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Date</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Student</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Transaction Type</th>
                        <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Description</th>
                        <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Receipt No</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-red-600">Debit (Fee Due)</th>
                        <th className="text-right px-3 py-2.5 font-semibold text-green-600">Credit (Fee Paid)</th>
                        <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Combined opening balance */}
                      <tr className="bg-amber-50 border-b border-amber-100">
                        <td className="px-4 py-2 text-amber-700 font-medium">—</td>
                        <td className="px-3 py-2 text-amber-600">All</td>
                        <td className="px-3 py-2 text-amber-700">Opening</td>
                        <td className="px-3 py-2 text-amber-600">Balance forwarded (combined)</td>
                        <td className="px-3 py-2 text-center">—</td>
                        <td className="px-3 py-2 text-right">—</td>
                        <td className="px-3 py-2 text-right">—</td>
                        <td className="px-4 py-2 text-right font-bold text-amber-700">₹{fmt(combinedOpening)}</td>
                      </tr>

                      {withBalance.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-8 text-gray-400">No transactions yet for {academicYear}</td></tr>
                      )}
                      {withBalance.map((t, i) => (
                        <tr key={i} className={`border-b border-gray-100 ${t.source==='STAGED'?'bg-blue-50':i%2===0?'bg-white':'bg-gray-50'}`}>
                          <td className="px-4 py-2 text-gray-600">{fmtDate(t.collected_at)}</td>
                          <td className="px-3 py-2">
                            <span className="text-xs font-bold text-blue-700">{t._member?.sl_number}</span>
                            <span className="text-xs text-gray-500 ml-1">{t._member?.student_name}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                              ${t.transaction_type==='RECEIVABLE'?'bg-red-100 text-red-600':'bg-green-100 text-green-700'}`}>
                              {t.transaction_type==='RECEIVABLE'?'Receivable':'Received'}
                            </span>
                            {t.source==='STAGED' && <span className="ml-1 text-xs text-blue-500 italic">pending</span>}
                          </td>
                          <td className="px-3 py-2 text-gray-700">{t.description}</td>
                          <td className="px-3 py-2 text-center text-gray-500">{t.receipt_number || '—'}</td>
                          <td className="px-3 py-2 text-right text-red-600 font-medium">{t.debit > 0 ? '₹'+fmt(t.debit) : '—'}</td>
                          <td className="px-3 py-2 text-right text-green-600 font-medium">
                            {t.credit > 0 ? '₹'+fmt(t.credit) : '—'}
                            {t.concession > 0 && <span className="block text-gray-400 text-xs">Conc: ₹{fmt(t.concession)}</span>}
                          </td>
                          <td className={`px-4 py-2 text-right font-bold ${t.running_balance>0?'text-red-600':'text-green-600'}`}>
                            ₹{fmt(t.running_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-100 border-t-2 border-gray-300">
                      <tr>
                        <td colSpan={5} className="px-4 py-2.5 text-sm font-bold text-gray-700">Closing Balance (Group)</td>
                        <td className="px-3 py-2.5 text-right text-sm font-bold text-red-600">₹{fmt(totalDebit)}</td>
                        <td className="px-3 py-2.5 text-right text-sm font-bold text-green-600">₹{fmt(totalCredit)}</td>
                        <td className={`px-4 py-2.5 text-right text-base font-bold ${finalBal>0?'text-red-600':'text-green-600'}`}>
                          ₹{fmt(finalBal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
      )}
    </div>
  );
}

// Shared transaction table component
function LedgerTransactionTable({ txnData, loadingTxn, academicYear, fmt, fmtDate, editBal, setEditBal, saveBalance,
  editTuitionMonth, setEditTuitionMonth, saveTuitionMonth }) {
  if (loadingTxn) return <div className="text-center py-8 text-gray-400">Loading transactions...</div>;
  if (!txnData) return null;

  const { ledger, transactions, final_balance } = txnData;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-gray-100 border-b border-gray-200">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold text-gray-600">Date</th>
            <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Transaction Type</th>
            <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Description</th>
            <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Receipt No</th>
            <th className="text-right px-3 py-2.5 font-semibold text-red-600">Debit (Fee Due)</th>
            <th className="text-right px-3 py-2.5 font-semibold text-green-600">Credit (Fee Paid)</th>
            <th className="text-right px-4 py-2.5 font-semibold text-gray-700">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-amber-50 border-b border-amber-100">
            <td className="px-4 py-2 text-amber-700 font-medium">—</td>
            <td className="px-3 py-2 text-amber-700">Opening</td>
            <td className="px-3 py-2 text-amber-600">
              Balance forwarded
              {editBal[ledger?.ledger_id] !== undefined ? (
                <span className="ml-2 inline-flex gap-1">
                  <input type="number" value={editBal[ledger.ledger_id]}
                    onChange={e => setEditBal(p => ({ ...p, [ledger.ledger_id]: e.target.value }))}
                    className="border border-amber-300 rounded px-1 py-0.5 w-20 text-right text-xs focus:outline-none" />
                  <button onClick={() => saveBalance(ledger.ledger_id, editBal[ledger.ledger_id])}
                    className="text-xs bg-amber-500 text-white px-1.5 rounded">✓</button>
                </span>
              ) : null}
            </td>
            <td className="px-3 py-2 text-center">—</td>
            <td className="px-3 py-2 text-right">—</td>
            <td className="px-3 py-2 text-right">—</td>
            <td className="px-4 py-2 text-right font-bold text-amber-700 cursor-pointer hover:text-amber-900"
              onClick={() => ledger && setEditBal(p => ({ ...p, [ledger.ledger_id]: ledger.opening_balance || 0 }))}>
              ₹{fmt(ledger?.opening_balance)}
            </td>
          </tr>

          <tr className="bg-blue-50 border-b border-blue-100">
            <td className="px-4 py-2 text-blue-700 font-medium">—</td>
            <td className="px-3 py-2 text-blue-700">Setting</td>
            <td className="px-3 py-2 text-blue-600" colSpan={3}>
              Tuition dues start from
              {editTuitionMonth[ledger?.ledger_id] !== undefined ? (
                <span className="ml-2 inline-flex gap-1">
                  <select value={editTuitionMonth[ledger.ledger_id] || ''}
                    onChange={e => setEditTuitionMonth(p => ({ ...p, [ledger.ledger_id]: e.target.value }))}
                    className="border border-blue-300 rounded px-1 py-0.5 text-xs bg-white focus:outline-none">
                    <option value="">April (no restriction)</option>
                    {academicMonthOptions(academicYear).map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <button onClick={() => saveTuitionMonth(ledger.ledger_id, editTuitionMonth[ledger.ledger_id])}
                    className="text-xs bg-blue-600 text-white px-1.5 rounded">✓</button>
                </span>
              ) : null}
            </td>
            <td className="px-4 py-2 text-right font-bold text-blue-700 cursor-pointer hover:text-blue-900"
              onClick={() => ledger && setEditTuitionMonth(p => ({ ...p, [ledger.ledger_id]: ledger.tuition_start_month || '' }))}>
              {ledger?.tuition_start_month
                ? (academicMonthOptions(academicYear).find(m => m.value === ledger.tuition_start_month)?.label || ledger.tuition_start_month)
                : 'April (default)'}
            </td>
          </tr>

          {(!transactions || transactions.length === 0) && (
            <tr><td colSpan={7} className="text-center py-8 text-gray-400">No transactions yet for {academicYear}</td></tr>
          )}
          {(transactions || []).map((t, i) => (
            <tr key={i} className={`border-b border-gray-100 ${t.source==='STAGED'?'bg-blue-50':i%2===0?'bg-white':'bg-gray-50'}`}>
              <td className="px-4 py-2 text-gray-600">{fmtDate(t.collected_at)}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                  ${t.transaction_type==='RECEIVABLE'?'bg-red-100 text-red-600':'bg-green-100 text-green-700'}`}>
                  {t.transaction_type==='RECEIVABLE'?'Receivable':'Received'}
                </span>
                {t.source==='STAGED' && <span className="ml-1 text-xs text-blue-500 italic">pending</span>}
              </td>
              <td className="px-3 py-2 text-gray-700">{t.description}</td>
              <td className="px-3 py-2 text-center text-gray-500">{t.receipt_number || '—'}</td>
              <td className="px-3 py-2 text-right text-red-600 font-medium">{t.debit > 0 ? '₹'+fmt(t.debit) : '—'}</td>
              <td className="px-3 py-2 text-right text-green-600 font-medium">
                {t.credit > 0 ? '₹'+fmt(t.credit) : '—'}
                {t.concession > 0 && <span className="block text-gray-400 text-xs">Conc: ₹{fmt(t.concession)}</span>}
              </td>
              <td className={`px-4 py-2 text-right font-bold ${t.running_balance>0?'text-red-600':'text-green-600'}`}>
                ₹{fmt(t.running_balance)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-100 border-t-2 border-gray-300">
          <tr>
            <td colSpan={4} className="px-4 py-2.5 text-sm font-bold text-gray-700">Closing Balance</td>
            <td className="px-3 py-2.5 text-right text-sm font-bold text-red-600">
              ₹{fmt((transactions||[]).reduce((s,t)=>s+(t.debit||0),0))}
            </td>
            <td className="px-3 py-2.5 text-right text-sm font-bold text-green-600">
              ₹{fmt((transactions||[]).reduce((s,t)=>s+(t.credit||0)+(t.concession||0),0))}
            </td>
            <td className={`px-4 py-2.5 text-right text-base font-bold ${(final_balance||0)>0?'text-red-600':'text-green-600'}`}>
              ₹{fmt(final_balance)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function FeesLedger() {
  const [tab,          setTab]          = useState('create');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);

  const TABS = [
    { key: 'create',    label: '📋 Create Ledger'    },
    { key: 'transport', label: '🚌 Transport'         },
    { key: 'view',      label: '📒 View Ledger'       },
  ];

  return (
    <div className="max-w-6xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Fees Ledger</h2>
        <p className="text-sm text-gray-500 mt-0.5">Assign SL numbers, manage sibling groups and view full transaction history</p>
      </div>

      <MissingFeesBanner academicYear={academicYear} />

      <div className="flex items-center gap-4 mb-5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
                ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {tab === 'create'    && <CreateLedgerTab    academicYear={academicYear} />}
      {tab === 'transport' && <TransportMonthlyTab academicYear={academicYear} />}
      {tab === 'view'      && <ViewLedgerTab        academicYear={academicYear} />}
    </div>
  );
}
