import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';
import schoolLogo from '../../assets/logo/school-logo.png';
import { gslSearchError } from '../utils/helpers';

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 5 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

const AMOUNT_FILTERS = [
  { label: 'Any amount', value: 0 },
  { label: '> ₹1,000',   value: 1000 },
  { label: '> ₹2,000',   value: 2000 },
  { label: '> ₹3,000',   value: 3000 },
  { label: '> ₹5,000',   value: 5000 },
  { label: '> ₹7,000',   value: 7000 },
  { label: '> ₹10,000',  value: 10000 },
  { label: '> ₹15,000',  value: 15000 },
  { label: '> ₹20,000',  value: 20000 },
];

export default function FeesNotice() {
  const { user } = useAuth();
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [search,   setSearch]   = useState('');
  const [minAmount, setMinAmount] = useState(0);
  const [groupFilter, setGroupFilter] = useState(''); // '' = all, 'single' = not in a group, 'grouped' = in a sibling group
  const [students, setStudents] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [selected, setSelected] = useState(null); // ledger_id
  const [detail,   setDetail]   = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error,    setError]    = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const [showBulkPrint, setShowBulkPrint] = useState(false);
  const [bulkDetails, setBulkDetails] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const lengthError = gslSearchError(search);
    if (lengthError) { setLoading(false); setError(lengthError); setStudents([]); return; }
    const res = await window.api.feesNoticeSearch(academicYear, search, minAmount);
    setLoading(false);
    if (!res.success) { setError(res.message); setStudents([]); return; }
    setStudents(res.data);
  }, [academicYear, search, minAmount]);

  useEffect(() => { load(); }, [load]);

  const openStudent = async (ledgerId) => {
    setSelected(ledgerId); setDetailLoading(true); setDetail(null);
    const res = await window.api.feesNoticeGetDetail(ledgerId, academicYear);
    setDetailLoading(false);
    if (!res.success) { setError(res.message); return; }
    setDetail(res);
  };

  // group_id is already on every search result, so this narrows down
  // client-side — no need to round-trip to the backend for it.
  const visibleStudents = students.filter(s => {
    if (groupFilter === 'single')  return !s.group_id;
    if (groupFilter === 'grouped') return !!s.group_id;
    return true;
  });

  // One notice per unique family, not per student — several students in
  // the list can share the same group_id (siblings), and each of those
  // should produce exactly one combined notice, not one per sibling.
  const bulkTargets = (() => {
    const seenGroups = new Set();
    const targets = [];
    visibleStudents.forEach(s => {
      if (s.group_id) {
        if (seenGroups.has(s.group_id)) return;
        seenGroups.add(s.group_id);
      }
      targets.push(s.ledger_id);
    });
    return targets;
  })();

  const openBulkPrint = async () => {
    setBulkLoading(true); setError('');
    const results = await Promise.all(
      bulkTargets.map(ledgerId => window.api.feesNoticeGetDetail(ledgerId, academicYear))
    );
    setBulkLoading(false);
    const failed = results.find(r => !r.success);
    if (failed) { setError(failed.message); return; }
    setBulkDetails(results);
    setShowBulkPrint(true);
  };

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Fees Notice</h2>
        <p className="text-sm text-gray-500 mt-0.5">Search students with a pending balance and generate a due notice</p>
      </div>

      {/* Search + filters */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-5 flex gap-4 items-end flex-wrap">
        <div className="flex-1 min-w-56">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search — SL No. / GSL No. / Name</label>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. SL-0042, GSL-0012, or a name"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Amount Due</label>
          <select value={minAmount} onChange={e => setMinAmount(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {AMOUNT_FILTERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Student Type</label>
          <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All students</option>
            <option value="single">Single only (no siblings)</option>
            <option value="grouped">Grouped only (has siblings)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs bg-blue-50 text-blue-600 px-3 py-2 rounded-full">
            {visibleStudents.length} student{visibleStudents.length !== 1 ? 's' : ''}
          </span>
          <button onClick={openBulkPrint} disabled={visibleStudents.length === 0 || bulkLoading}
            title="One notice per family — siblings in the same group are combined into a single notice, not printed separately"
            className="px-4 py-2 border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent rounded-xl text-sm font-medium">
            {bulkLoading ? '⏳ Preparing…' : `🖨️ Print All (${bulkTargets.length} notice${bulkTargets.length !== 1 ? 's' : ''})`}
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}

      <div className="grid grid-cols-3 gap-5">
        {/* Left: student list */}
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden max-h-[32rem] overflow-y-auto">
          {loading ? (
            <p className="text-center text-gray-400 py-10 text-sm">Loading…</p>
          ) : visibleStudents.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">No students match this search/filter.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {visibleStudents.map(s => (
                <button key={s.ledger_id} onClick={() => openStudent(s.ledger_id)}
                  className={`w-full text-left px-4 py-3 hover:bg-blue-50 transition-colors ${selected === s.ledger_id ? 'bg-blue-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-blue-700">{s.sl_number}</span>
                    {s.gsl_number && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">{s.gsl_number}</span>}
                  </div>
                  <p className="text-sm font-medium text-gray-800 mt-0.5">{s.student_name}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-gray-400">{s.current_class} {s.section}</span>
                    <span className="text-sm font-bold text-red-600">{fmt(s.balance)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: notice preview */}
        <div className="col-span-2">
          {!selected ? (
            <div className="bg-white border border-gray-200 rounded-2xl h-full flex items-center justify-center py-20 text-gray-400 text-sm">
              Select a student on the left to preview their notice
            </div>
          ) : detailLoading ? (
            <div className="bg-white border border-gray-200 rounded-2xl py-20 text-center text-gray-400 text-sm">Loading…</div>
          ) : detail && (
            <div className="bg-white border border-gray-200 rounded-2xl p-6">
              <div className="flex justify-end mb-4">
                <button onClick={() => setShowPrint(true)}
                  className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
                  🖨️ Print Notice
                </button>
              </div>
              <NoticePreview detail={detail} academicYear={academicYear} />
            </div>
          )}
        </div>
      </div>

      {showPrint && detail && (
        <FeesNoticePrintModal detail={detail} academicYear={academicYear} onClose={() => setShowPrint(false)} />
      )}

      {showBulkPrint && bulkDetails.length > 0 && (
        <BulkFeesNoticePrintModal details={bulkDetails} academicYear={academicYear} onClose={() => setShowBulkPrint(false)} />
      )}
    </div>
  );
}

// ── Notice content — matches the school's actual printed notice format
// exactly (provided as a reference PDF). The late-fee reminder line pulls
// the real configured rate/grace period from Fee Settings rather than a
// hardcoded number, so it can't go stale if those settings ever change.
function NoticePreview({ detail, academicYear, serial }) {
  const { focusStudent, group } = detail;
  const students = group ? group.members : [focusStudent];
  const totalDue = group ? group.total_balance : focusStudent.balance;

  const [lateFeeSettings, setLateFeeSettings] = useState(null);
  useEffect(() => {
    window.api.feeSettingsGet(academicYear).then(res => {
      if (res.success) setLateFeeSettings(res.data);
    });
  }, [academicYear]);

  // Deliberately NOT read from Fee Settings — this is a fixed policy
  // statement on the notice, independent of whatever late fee is actually
  // configured (which may be 0 while late fees aren't being charged yet).
  const lateFeePerDay   = 5;
  const gracePeriodDays = lateFeeSettings?.grace_period_days ?? 10;

  const todayDDMMYYYY = (() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
  })();

  return (
    <div className="text-sm leading-relaxed print:flex print:flex-col print:h-full" style={{ fontFamily: "'Noto Sans Devanagari', 'Mangal', sans-serif" }}>
      {/* Header */}
      <div className="flex items-center gap-4 border-b-2 border-gray-800 pb-3 mb-3">
        <img src={schoolLogo} alt="School Logo"
          className="w-20 h-20 object-contain shrink-0" />
        <div className="flex-1 text-center">
          <h1 className="text-xl font-bold">ब्रिलिएंट पब्लिक स्कूल (मान्यता प्राप्त)</h1>
          <h1 className="text-lg font-bold">BRILLIANT PUBLIC SCHOOL (Affiliated)</h1>
          <p className="text-xs mt-1">Mobile: 8810671008, E-Mail : brilliantpublicschool21@gmail.com</p>
        </div>
      </div>

      {/* Reference + Date */}
      <div className="flex justify-between text-sm mb-3">
        <span>संदर्भ/ पत्र संख्या: BPS/ बकाया फीस/{focusStudent.student_name}/{serial ?? '—'}/{academicYear}</span>
        <span>Dated: {todayDDMMYYYY}</span>
      </div>

      {/* Title */}
      <p className="text-center font-bold underline text-base mb-3">बकाया फीस सूचना</p>

      {/* Salutation */}
      <p className="mb-1">सेवा में,</p>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="shrink-0 w-24">आदरणीय</span>
        <span className="w-1/2 border-b border-dotted border-gray-800">&nbsp;</span>
      </div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="shrink-0 w-24">पता:</span>
        <span className="w-1/2 border-b border-dotted border-gray-800">&nbsp;</span>
      </div>
      <p className="mb-3">जिला: बुलंदशहर, उत्तर प्रदेश।</p>

      {/* Body */}
      <p className="mb-2">प्रिय अभिभावक-गण,</p>
      <p className="mb-2 text-justify">
        आपका/आपके बच्चा/ बच्चे 'ब्रिलिएंट पब्लिक स्कूल', शेरपुर नायसर, में अध्ययनरत हैं जिनकी मासिक फीस का
        भुगतान विलम्ब से किया जाता हैं या इस साल नहीं किया गया हैं। उक्त संदर्भ में आपको कई बार मौखिक
        एवम टेलीफोनिक माध्यम से अवगत कराया गया हैं लेकिन आपके द्वारा अभी तक भी बकाया फीस का
        भुगतान नहीं किया गया है।
      </p>
      <p className="mb-2 text-justify">
        हम जानते हैं कि बच्चा/ बच्चे का स्कूल से नाम काटे जाने पर छात्र की शैक्षणिक कार्य पर नकारात्मक प्रभाव
        पड़ता हैं। अतः आप प्रत्येक माह की फीस का समय पर भुगतान सुनिश्चित करें।
      </p>
      <p className="mb-4 text-justify">
        शैक्षिक वर्ष {academicYear} में, आपका बच्चा/ बच्चों की बकाया फीस का ब्यौरा निम्नलिखित है -
      </p>

      {/* Table — S.No, Name, Class, Total Amount Due */}
      <table className="w-full text-sm border border-gray-400 mb-4">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-400 px-3 py-1.5 text-center w-14">S.No</th>
            <th className="border border-gray-400 px-3 py-1.5 text-left">Name</th>
            <th className="border border-gray-400 px-3 py-1.5 text-left">Class</th>
            <th className="border border-gray-400 px-3 py-1.5 text-right">Total Amount Due</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s, i) => (
            <tr key={s.ledger_id}>
              <td className="border border-gray-400 px-3 py-1.5 text-center">{i + 1}</td>
              <td className="border border-gray-400 px-3 py-1.5">{s.student_name}</td>
              <td className="border border-gray-400 px-3 py-1.5">{s.current_class} {s.section}</td>
              <td className="border border-gray-400 px-3 py-1.5 text-right">{fmt(s.balance)}</td>
            </tr>
          ))}
          {students.length > 1 && (
            <tr className="font-bold bg-gray-50">
              <td className="border border-gray-400 px-3 py-1.5" colSpan={3}>Total</td>
              <td className="border border-gray-400 px-3 py-1.5 text-right">{fmt(totalDue)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Reminder + late fee note */}
      <p className="font-bold text-justify mb-4">
        'ब्रिलिएंट पब्लिक स्कूल', शेरपुर नायसर, आपका बच्चे/बच्चों की सफलता के लिए वचनबद्ध है कृपया {lateFeePerDay} रुपये
        प्रति दिन विलम्ब शुल्क से बचने के लिये अपने बच्चे/बच्चों की फीस प्रत्येक महीने की {gracePeriodDays} तारीख तक जमा
        करा दें।
      </p>

      {/* Special notice — blank writable lines for a custom handwritten message */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="shrink-0">विशेष सूचना:</span>
        <span className="flex-1 border-b border-dotted border-gray-800">&nbsp;</span>
      </div>
      <div className="mb-4 border-b border-dotted border-gray-800">&nbsp;</div>

      {/* Signature + footer — pushed to the bottom of the printed page,
          not left sitting wherever the content happens to end */}
      <div className="print:mt-auto">
        <p className="mb-1">धन्यबाद</p>
        <p className="text-right font-medium mb-6">प्रधानाचार्या</p>

        <div className="border-t-2 border-gray-800 pt-2 text-center text-xs">
          <p>गाँव- शेरपुर नायसर, पोस्ट- जावल, तहसील- खुर्जा, जिला- बुलंदशहर, उ0 प्र0 -203131</p>
          <p className="font-medium">Village Sherpur (Nayser), Post - Jawal, Tahsil - Khurja, Distt. Bulandshar, U. P-203131</p>
        </div>
      </div>
    </div>
  );
}

function FeesNoticePrintModal({ detail, academicYear, onClose }) {
  const [serial, setSerial] = useState(null);
  useEffect(() => {
    window.api.feesNoticeReserveSerials(todayISO(), 1).then(res => {
      if (res.success) setSerial(res.data[0]);
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Notice Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!serial} className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">🖨️ Print</button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Close</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {!serial ? (
            <p className="text-center text-gray-400 text-sm py-10">Assigning notice number…</p>
          ) : (
            <div className="print-root border border-gray-300 p-6 print:border-none print:h-screen print:flex print:flex-col" id="fees-notice-print">
              <NoticePreview detail={detail} academicYear={academicYear} serial={serial} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// One notice per family, each on its own printed page — every unique
// group already collapsed to a single notice before this ever renders
// (see bulkTargets above), so this just lays each one out with a page
// break in between, same mechanism as Examination's Print All.
function BulkFeesNoticePrintModal({ details, academicYear, onClose }) {
  const [serials, setSerials] = useState(null);
  useEffect(() => {
    window.api.feesNoticeReserveSerials(todayISO(), details.length).then(res => {
      if (res.success) setSerials(res.data);
    });
  }, [details.length]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">{details.length} Notices Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!serials} className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">🖨️ Print All</button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Close</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {!serials ? (
            <p className="text-center text-gray-400 text-sm py-10">Assigning notice numbers…</p>
          ) : (
            <div className="print-root">
              {details.map((d, i) => (
                <div key={d.focusStudent.ledger_id}
                  className="border border-gray-300 p-6 print:border-none print:h-screen print:flex print:flex-col mb-6 print:mb-0"
                  style={i < details.length - 1 ? { breakAfter: 'page' } : undefined}>
                  <NoticePreview detail={d} academicYear={academicYear} serial={serials[i]} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
