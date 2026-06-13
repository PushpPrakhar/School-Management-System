// ApproveAdmission.jsx
// Two tabs: Pending Approvals | History
// Pending → Review panel → Approve / Reject

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

// ── Helpers ───────────────────────────────────────────────────
function Badge({ text, color }) {
  const s = {
    green:  'bg-green-100 text-green-700 border border-green-200',
    red:    'bg-red-100 text-red-600 border border-red-200',
    amber:  'bg-amber-100 text-amber-700 border border-amber-200',
    blue:   'bg-blue-100 text-blue-700 border border-blue-200',
    gray:   'bg-gray-100 text-gray-500 border border-gray-200',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s[color]}`}>{text}</span>;
}
function InfoRow({ label, value, highlight }) {
  return (
    <div className={`flex py-2 border-b border-gray-100 last:border-0 ${highlight ? 'bg-blue-50 -mx-4 px-4 rounded' : ''}`}>
      <span className="text-xs text-gray-400 w-44 shrink-0">{label}</span>
      <span className={`text-sm font-medium ${value === 'NOT PROVIDED' || value === 'NOT APPLICABLE' || value === '999999999999' || value === '11111111111' ? 'text-gray-300' : 'text-gray-700'}`}>
        {value || '—'}
      </span>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div className="mb-5">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="bg-white border border-gray-200 rounded-xl px-4">{children}</div>
    </div>
  );
}

// ── Review Panel ─────────────────────────────────────────────
function ReviewPanel({ admNo, onClose, onApproved, onRejected }) {
  const { user } = useAuth();
  const [student,      setStudent]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [action,       setAction]       = useState(null); // 'reject'
  const [rejectReason, setRejectReason] = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');

  useEffect(() => {
    window.api.getAdmissionForReview(admNo).then(res => {
      if (res.success) setStudent(res.data);
      setLoading(false);
    });
  }, [admNo]);

  const handleApprove = async () => {
    setSaving(true); setError('');
    const res = await window.api.approveAdmission(admNo, user?.username || 'admin');
    setSaving(false);
    if (res.success) onApproved(admNo, res.new_admission_number);
    else setError(res.message);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setError('Please enter a reason for rejection.'); return; }
    setSaving(true); setError('');
    const res = await window.api.rejectAdmission(admNo, user?.username || 'admin', rejectReason);
    setSaving(false);
    if (res.success) onRejected(admNo);
    else setError(res.message);
  };

  if (loading) return (
    <div className="fixed inset-0 bg-black bg-opacity-30 z-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl p-8 text-center">
        <div className="text-3xl animate-spin mb-2">⏳</div>
        <p className="text-gray-500 text-sm">Loading student details…</p>
      </div>
    </div>
  );

  if (!student) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-end md:items-center justify-center p-4">
      <div className="bg-gray-50 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-white rounded-t-2xl border-b border-gray-200">
          <div>
            <h3 className="font-bold text-gray-800">{student.student_name}</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {student.class_of_admission} · {student.academic_year} · Submitted by {student.submitted_by || 'staff'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge text="PENDING APPROVAL" color="amber" />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">

          <Section title="Student Identity">
            <InfoRow label="Student Name"     value={student.student_name} />
            <InfoRow label="Gender"           value={student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender} />
            <InfoRow label="Date of Birth"    value={student.date_of_birth} />
            <InfoRow label="Indian Nationality" value={student.indian_nationality} />
            <InfoRow label="Blood Group"      value={student.blood_group} />
            <InfoRow label="Aadhar Number"    value={student.aadhar_number} highlight={student.aadhar_number === '999999999999'} />
            <InfoRow label="Birth Certificate" value={student.birth_cert} />
          </Section>

          <Section title="Parents / Guardian">
            <InfoRow label="Father's Name"    value={student.father_name} highlight={student.father_name === 'NOT PROVIDED'} />
            <InfoRow label="Father Profession" value={student.father_profession} />
            <InfoRow label="Mother's Name"    value={student.mother_name} highlight={student.mother_name === 'NOT PROVIDED'} />
            <InfoRow label="Mother Profession" value={student.mother_profession} />
            <InfoRow label="Guardian's Name"  value={student.guardian_name} />
            <InfoRow label="Mobile Number"    value={student.mobile_number} highlight={!student.mobile_number} />
            <InfoRow label="Alternate Mobile" value={student.alternate_mobile} />
            <InfoRow label="Email"            value={student.contact_email} />
          </Section>

          <Section title="Address">
            <InfoRow label="House No."  value={student.house_no} />
            <InfoRow label="Village"    value={student.village}   highlight={student.village === 'NOT PROVIDED'} />
            <InfoRow label="Post"       value={student.post} />
            <InfoRow label="District"   value={student.district} />
            <InfoRow label="State"      value={student.state_name} />
            <InfoRow label="Pin Code"   value={student.pin_code} />
          </Section>

          <Section title="Social Details">
            <InfoRow label="Category"       value={student.category} />
            <InfoRow label="Minority Group" value={student.minority_group} />
            <InfoRow label="BPL"            value={student.bpl_beneficiary} />
            <InfoRow label="EWS"            value={student.ews_disadvantaged} />
            <InfoRow label="CWSN"           value={student.cwsn} />
            {student.cwsn === 'Yes' && <>
              <InfoRow label="Impairment Type"  value={student.impairment_type} />
              <InfoRow label="Disability Cert"  value={student.disability_certificate} />
              <InfoRow label="Disability %"     value={student.disability_percentage} />
            </>}
          </Section>

          <Section title="Enrollment Details">
            <InfoRow label="Temp Admission No."   value={student.admission_number} />
            <InfoRow label="PEN Number"           value={student.pen_number} highlight={student.pen_number === '11111111111'} />
            <InfoRow label="APAAR ID"             value={student.apaar_id} />
            <InfoRow label="RTE Section 12C"      value={student.rte_section_12c} />
            {student.rte_section_12c === 'Yes' &&
              <InfoRow label="RTE Amount"         value={`₹ ${student.rte_amount_claimed}`} />}
            <InfoRow label="Date of Admission"    value={student.date_of_admission} />
            <InfoRow label="Class"                value={student.class_of_admission}  highlight={student.class_of_admission === 'NOT PROVIDED'} />
            <InfoRow label="Section"              value={student.section} />
            <InfoRow label="Medium"               value={student.medium_of_instruction} />
            <InfoRow label="Studied Elsewhere"    value={student.studied_elsewhere} />
            {student.studied_elsewhere === 'Yes' && <>
              <InfoRow label="TC Submitted"       value={student.tc_submitted} />
              <InfoRow label="Prev School"        value={student.prev_school_name} />
              <InfoRow label="Prev Enrollment No" value={student.prev_enrollment_number} />
              <InfoRow label="Prev Academic Year" value={student.prev_academic_year} />
              <InfoRow label="Status in Prev Year" value={student.prev_year_status} />
              <InfoRow label="Class Passed"       value={student.prev_year_class} />
            </>}
          </Section>

          {/* Reject reason input */}
          {action === 'reject' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-red-700 mb-2">Reason for Rejection</p>
              <textarea value={rejectReason} onChange={e => { setRejectReason(e.target.value); setError(''); }}
                rows={3} placeholder="Enter reason — this will be recorded in the system…"
                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
            </div>
          )}

          {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}
        </div>

        {/* Action buttons */}
        <div className="px-6 py-4 bg-white border-t border-gray-200 rounded-b-2xl">
          {action === null && (
            <div className="flex gap-3 justify-end">
              <button onClick={onClose}
                className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 underline">
                Cancel
              </button>
              <button onClick={() => setAction('reject')}
                className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium px-6 py-2.5 rounded-xl text-sm">
                ✗ Reject
              </button>
              <button onClick={handleApprove} disabled={saving}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2">
                {saving ? '⏳ Approving…' : '✓ Approve'}
              </button>
            </div>
          )}
          {action === 'reject' && (
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setAction(null); setRejectReason(''); setError(''); }}
                className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 underline">
                Back
              </button>
              <button onClick={handleReject} disabled={saving}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
                {saving ? '⏳ Rejecting…' : 'Confirm Rejection'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Pending Tab ───────────────────────────────────────────────
function PendingTab({ onCountChange }) {
  const [pending,   setPending]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [reviewing, setReviewing] = useState(null);
  const [toast,     setToast]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getPendingAdmissions();
    if (res.success) { setPending(res.data); onCountChange(res.data.length); }
    setLoading(false);
  }, [onCountChange]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 4000);
  };

  const handleApproved = (oldAdmNo, newAdmNo) => {
    setReviewing(null);
    setPending(p => p.filter(s => s.admission_number !== oldAdmNo));
    onCountChange(prev => prev - 1);
    showToast(`✅ Approved — Admission No. ${newAdmNo} assigned`, 'green');
  };

  const handleRejected = (admNo) => {
    setReviewing(null);
    setPending(p => p.filter(s => s.admission_number !== admNo));
    onCountChange(prev => prev - 1);
    showToast('✗ Admission rejected and recorded', 'red');
  };

  if (loading) return <div className="text-center py-16 text-gray-400">Loading pending admissions…</div>;

  if (pending.length === 0) return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">✅</div>
      <p className="font-semibold text-gray-700">No pending admissions</p>
      <p className="text-sm text-gray-400 mt-1">All admissions have been reviewed.</p>
    </div>
  );

  return (
    <>
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white
          ${toast.color === 'green' ? 'bg-green-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Temp No.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Student Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Class</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">DOB</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Village</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Submitted</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {pending.map(s => (
              <tr key={s.admission_number} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-amber-600 font-semibold">{s.admission_number}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{s.student_name}</td>
                <td className="px-4 py-3 text-gray-600">{s.class_of_admission}</td>
                <td className="px-4 py-3 text-gray-600">{s.date_of_birth}</td>
                <td className="px-4 py-3 text-gray-600">{s.village}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{s.created_at?.slice(0,10)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => setReviewing(s.admission_number)}
                    className="bg-blue-700 hover:bg-blue-800 text-white text-xs font-medium px-4 py-1.5 rounded-lg">
                    Review →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reviewing && (
        <ReviewPanel
          admNo={reviewing}
          onClose={() => setReviewing(null)}
          onApproved={handleApproved}
          onRejected={handleRejected}
        />
      )}
    </>
  );
}

// ── History Tab ───────────────────────────────────────────────
function HistoryTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('ALL'); // ALL, ACTIVE, REJECTED

  useEffect(() => {
    window.api.getApprovalHistory().then(res => {
      if (res.success) setHistory(res.data);
      setLoading(false);
    });
  }, []);

  const filtered = filter === 'ALL' ? history : history.filter(h => h.student_status === filter);

  if (loading) return <div className="text-center py-16 text-gray-400">Loading history…</div>;
  if (history.length === 0) return (
    <div className="text-center py-16 text-gray-400">No approval history yet.</div>
  );

  return (
    <div>
      {/* Filter */}
      <div className="flex gap-2 mb-4">
        {[['ALL','All'],['ACTIVE','Approved'],['REJECTED','Rejected']].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`text-xs font-medium px-4 py-1.5 rounded-full border transition-colors
              ${filter === val ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'}`}>
            {label} {filter === val && `(${filtered.length})`}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Admission No.</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Student Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Class</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Action By</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Action At</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Reason</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(h => (
              <tr key={h.admission_number} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-700">{h.admission_number}</td>
                <td className="px-4 py-3 font-medium text-gray-800">{h.student_name}</td>
                <td className="px-4 py-3 text-gray-600">{h.class_of_admission}</td>
                <td className="px-4 py-3">
                  <Badge
                    text={h.student_status === 'ACTIVE' ? 'Approved' : 'Rejected'}
                    color={h.student_status === 'ACTIVE' ? 'green' : 'red'}
                  />
                </td>
                <td className="px-4 py-3 text-gray-600">{h.approved_by}</td>
                <td className="px-4 py-3 text-gray-400 text-xs">{h.approved_at}</td>
                <td className="px-4 py-3 text-gray-400 text-xs max-w-xs truncate">{h.rejected_reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function ApproveAdmission() {
  const [tab,          setTab]          = useState('pending');
  const [pendingCount, setPendingCount] = useState(0);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Approve Admissions</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Review pending admissions and assign official BPS numbers
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[
          ['pending', `Pending${pendingCount > 0 ? ` (${pendingCount})` : ''}`],
          ['history', 'History'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pending' && <PendingTab onCountChange={setPendingCount} />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}
