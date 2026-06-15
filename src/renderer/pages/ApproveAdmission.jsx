import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

function Badge({ text, color }) {
  const s = {
    amber:  'bg-amber-100 text-amber-700 border border-amber-200',
    green:  'bg-green-100 text-green-700 border border-green-200',
    red:    'bg-red-100   text-red-600   border border-red-200',
    blue:   'bg-blue-100  text-blue-700  border border-blue-200',
    gray:   'bg-gray-100  text-gray-500  border border-gray-200',
  };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s[color] || s.gray}`}>{text}</span>;
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h4>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">{children}</div>
    </div>
  );
}
function InfoRow({ label, value, highlight }) {
  return (
    <div>
      <span className="text-xs text-gray-400">{label}</span>
      <p className={`text-sm font-medium mt-0.5 ${highlight ? 'text-red-500' : 'text-gray-800'}`}>
        {value || '—'}
      </p>
    </div>
  );
}

// ── Review Panel ──────────────────────────────────────────────
function ReviewPanel({ tempId, onClose, onApproved, onRejected }) {
  const { user } = useAuth();
  const [student,      setStudent]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [action,       setAction]       = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [editing,      setEditing]      = useState(false);
  const [editForm,     setEditForm]     = useState({});

  useEffect(() => {
    window.api.getAdmissionForReview(tempId).then(res => {
      if (res.success) { setStudent(res.data); setEditForm(res.data); }
      setLoading(false);
    });
  }, [tempId]);

  const setField = (k, v) => setEditForm(f => ({ ...f, [k]: v }));

  const handleSaveEdit = async () => {
    setSaving(true); setError('');
    const res = await window.api.editTempAdmission({ ...editForm, temp_id: tempId });
    setSaving(false);
    if (res.success) { setStudent(editForm); setEditing(false); }
    else setError(res.message || 'Failed to save changes.');
  };

  const handleApprove = async () => {
    setSaving(true); setError('');
    const res = await window.api.approveAdmission(tempId, user?.username || 'admin');
    setSaving(false);
    if (res.success) onApproved(tempId, res.new_admission_number, student?.student_name);
    else setError(res.message);
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setError('Please enter a reason for rejection.'); return; }
    setSaving(true); setError('');
    const res = await window.api.rejectAdmission(tempId, user?.username || 'admin', rejectReason);
    setSaving(false);
    if (res.success) onRejected(tempId);
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
            <Badge text={editing ? "EDITING" : "PENDING APPROVAL"} color={editing ? "blue" : "amber"} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 py-4">

          {/* ── Edit Form ─────────────────────── */}
          {editing && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700 mb-3">
                ✏️ Edit the details below then click Save.
              </div>
              {[
                ['Student Name',    'student_name',   false],
                ["Father's Name",   'father_name',    false],
                ["Mother's Name",   'mother_name',    false],
                ['Mobile Number',   'mobile_number',  false],
                ['Aadhar Number',   'aadhar_number',  false],
                ['Village',         'village',        false],
                ['District',        'district',       false],
                ['Pin Code',        'pin_code',       false],
              ].map(([label, key]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input value={editForm[key] || ''}
                    onChange={e => setField(key, e.target.value.toUpperCase())}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date of Birth</label>
                <input type="date"
                  value={editForm.date_of_birth
                    ? editForm.date_of_birth.split('-').length === 3 && editForm.date_of_birth.split('-')[2].length === 4
                      ? editForm.date_of_birth.split('-').reverse().join('-')
                      : editForm.date_of_birth
                    : ''}
                  onChange={e => setField('date_of_birth', e.target.value.split('-').reverse().join('-'))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Section</label>
                <select value={editForm.section || 'A'} onChange={e => setField('section', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setEditing(false); setError(''); }}
                  className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl text-sm">
                  ← Back
                </button>
                <button onClick={handleSaveEdit} disabled={saving}
                  className="flex-1 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm">
                  {saving ? '⏳ Saving…' : '💾 Save Changes'}
                </button>
              </div>
            </div>
          )}

          {/* ── Review (read-only) ────────────── */}
          {!editing && <>
            <Section title="Student Identity">
              <InfoRow label="Student Name"     value={student.student_name} />
              <InfoRow label="Gender"           value={student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender} />
              <InfoRow label="Date of Birth"    value={student.date_of_birth} />
              <InfoRow label="Aadhar Number"    value={student.aadhar_number} highlight={student.aadhar_number === '999999999999'} />
              <InfoRow label="Blood Group"      value={student.blood_group} />
              <InfoRow label="Birth Certificate" value={student.birth_cert} />
            </Section>

            <Section title="Parents / Guardian">
              <InfoRow label="Father's Name"    value={student.father_name} highlight={student.father_name === 'NOT PROVIDED'} />
              <InfoRow label="Father Profession" value={student.father_profession} />
              <InfoRow label="Mother's Name"    value={student.mother_name} />
              <InfoRow label="Mother Profession" value={student.mother_profession} />
              <InfoRow label="Mobile Number"    value={student.mobile_number} highlight={!student.mobile_number} />
              <InfoRow label="Alternate Mobile" value={student.alternate_mobile} />
            </Section>

            <Section title="Address">
              <InfoRow label="Village"    value={student.village}  highlight={student.village === 'NOT PROVIDED'} />
              <InfoRow label="Post"       value={student.post} />
              <InfoRow label="District"   value={student.district} />
              <InfoRow label="State"      value={student.state_name} />
              <InfoRow label="Pin Code"   value={student.pin_code} />
            </Section>

            <Section title="Social Details">
              <InfoRow label="Category"       value={student.category} />
              <InfoRow label="Caste"          value={student.caste} />
              <InfoRow label="Minority Group" value={student.minority_group} />
              <InfoRow label="BPL"            value={student.bpl_beneficiary} />
              <InfoRow label="CWSN"           value={student.cwsn} />
            </Section>

            <Section title="Enrollment Details">
              <InfoRow label="PEN Number"        value={student.pen_number} />
              <InfoRow label="APAAR ID"          value={student.apaar_id} />
              <InfoRow label="Date of Admission" value={student.date_of_admission} />
              <InfoRow label="Class"             value={student.class_of_admission} />
              <InfoRow label="Section"           value={student.section} />
              <InfoRow label="Academic Year"     value={student.academic_year} />
              <InfoRow label="Medium"            value={student.medium_of_instruction} />
              <InfoRow label="Studied Elsewhere" value={student.studied_elsewhere} />
              {student.studied_elsewhere === 'Yes' && <>
                <InfoRow label="Prev School"    value={student.prev_school_name} />
                <InfoRow label="Prev Enroll No" value={student.prev_enrollment_number} />
                <InfoRow label="Prev Acad Year" value={student.prev_academic_year} />
              </>}
            </Section>

            {action === 'reject' && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <p className="text-sm font-semibold text-red-700 mb-2">Reason for Rejection</p>
                <textarea value={rejectReason} onChange={e => { setRejectReason(e.target.value); setError(''); }}
                  rows={3} placeholder="Enter reason — this will be recorded…"
                  className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400" />
              </div>
            )}

            {error && <p className="text-red-500 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">{error}</p>}
          </>}
        </div>

        {/* Action buttons */}
        <div className="px-6 py-4 bg-white border-t border-gray-200 rounded-b-2xl">
          {!editing && action === null && (
            <div className="flex gap-3 justify-end">
              <button onClick={onClose}
                className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 underline">
                Cancel
              </button>
              <button onClick={() => setAction('reject')}
                className="bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 font-medium px-6 py-2.5 rounded-xl text-sm">
                ✗ Reject
              </button>
              <button onClick={() => { setEditing(true); setError(''); }}
                className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-medium px-6 py-2.5 rounded-xl text-sm">
                ✏️ Edit
              </button>
              <button onClick={handleApprove} disabled={saving}
                className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2">
                {saving ? '⏳ Approving…' : '✓ Approve'}
              </button>
            </div>
          )}
          {!editing && action === 'reject' && (
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setAction(null); setRejectReason(''); setError(''); }}
                className="text-sm text-gray-400 hover:text-gray-600 px-4 py-2 underline">
                ← Back
              </button>
              <button onClick={handleReject} disabled={saving}
                className="bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2">
                {saving ? '⏳ Rejecting…' : '✗ Confirm Reject'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Approved popup ────────────────────────────────────────────
function ApprovedPopup({ name, admNo, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-green-600 px-6 py-5 text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="text-white font-bold text-lg">Admission Approved!</h3>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Student Name</span>
              <span className="font-bold text-gray-800">{name}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500">Admission Number</span>
              <span className="font-bold text-blue-700 font-mono text-lg">{admNo}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 text-center">
            Please note this admission number for the student's records.
          </p>
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose}
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-2.5 rounded-xl text-sm">
            Okay
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function ApproveAdmission({ onCountChange = () => {} }) {
  const [tab,           setTab]           = useState('pending');
  const [pending,       setPending]       = useState([]);
  const [rejected,      setRejected]      = useState([]);
  const [history,       setHistory]       = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [reviewing,     setReviewing]     = useState(null);
  const [toast,         setToast]         = useState(null);
  const [approvedPopup, setApprovedPopup] = useState(null);

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3500);
  };

  const loadPending = useCallback(async () => {
    setLoading(true);
    const res = await window.api.getPendingAdmissions();
    if (res.success) {
      setPending(res.data);
      // Use functional update to avoid stale closure on onCountChange
      if (typeof onCountChange === 'function') onCountChange(res.data.length);
    }
    setLoading(false);
  }, []); // Empty deps — stable reference, prevents infinite loop

  const loadRejected = useCallback(async () => {
    const res = await window.api.getRejectedAdmissions();
    if (res.success) setRejected(res.data);
  }, []);

  const loadHistory = useCallback(async () => {
    const res = await window.api.getApprovalHistory();
    if (res.success) setHistory(res.data);
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  const handleTabChange = (t) => {
    setTab(t);
    if (t === 'rejected') loadRejected();
    if (t === 'history')  loadHistory();
  };

  const handleApproved = (tempId, newAdmNo, studentName) => {
    setReviewing(null);
    setPending(p => p.filter(s => s.temp_id !== tempId));
    onCountChange(prev => prev - 1);
    setApprovedPopup({ name: studentName, admNo: newAdmNo });
  };

  const handleRejected = (tempId) => {
    setReviewing(null);
    setPending(p => p.filter(s => s.temp_id !== tempId));
    onCountChange(prev => prev - 1);
    showToast('✗ Admission rejected and recorded', 'red');
  };

  return (
    <div className="max-w-4xl">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white
          ${toast.color === 'green' ? 'bg-green-600' : 'bg-red-500'}`}>
          {toast.msg}
        </div>
      )}

      {/* Approval success popup */}
      {approvedPopup && (
        <ApprovedPopup
          name={approvedPopup.name}
          admNo={approvedPopup.admNo}
          onClose={() => setApprovedPopup(null)}
        />
      )}

      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Approve Admissions</h2>
        <p className="text-sm text-gray-500 mt-0.5">Review and approve pending student admissions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[
          ['pending',  `Pending (${pending.length})`],
          ['rejected', 'Rejected'],
          ['history',  'History'],
        ].map(([key, label]) => (
          <button key={key} onClick={() => handleTabChange(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Pending Tab ─────────────────────── */}
      {tab === 'pending' && (
        loading ? (
          <div className="text-center py-12 text-gray-400">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">✅</div>
            <p className="font-medium text-gray-600">No pending admissions</p>
            <p className="text-sm text-gray-400 mt-1">All submitted admissions have been reviewed</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
              <p className="text-sm font-semibold text-gray-700">
                {pending.length} student{pending.length !== 1 ? 's' : ''} awaiting approval
              </p>
            </div>
            {pending.map(s => (
              <button key={s.temp_id} onClick={() => setReviewing(s.temp_id)}
                className="w-full flex items-center gap-4 px-5 py-4 border-b border-gray-100 hover:bg-blue-50 text-left last:border-0">
                <div className="w-9 h-9 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                  {(s.student_name || 'S')[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800">{s.student_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {s.class_of_admission} · Father: {s.father_name} · {s.academic_year}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">{s.submitted_at?.slice(0,16)}</p>
                  <Badge text="PENDING" color="amber" />
                </div>
                <span className="text-blue-500 text-xs font-medium ml-2">Review →</span>
              </button>
            ))}
          </div>
        )
      )}

      {/* ── Rejected Tab ────────────────────── */}
      {tab === 'rejected' && (
        rejected.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p>No rejected admissions</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-red-50 border-b border-red-200 px-5 py-3">
              <p className="text-sm font-semibold text-red-700">{rejected.length} rejected admission{rejected.length !== 1 ? 's' : ''}</p>
            </div>
            {rejected.map(s => (
              <div key={s.reject_id} className="px-5 py-4 border-b border-gray-100 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                      {(s.student_name || 'S')[0]}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{s.student_name}</p>
                      <p className="text-xs text-gray-400">
                        {s.class_of_admission} · Father: {s.father_name} · {s.academic_year}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge text="REJECTED" color="red" />
                    <p className="text-xs text-gray-400 mt-1">by {s.rejected_by}</p>
                  </div>
                </div>
                {s.rejected_reason && (
                  <div className="mt-2 ml-12 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <p className="text-xs text-red-600"><span className="font-medium">Reason: </span>{s.rejected_reason}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── History Tab ─────────────────────── */}
      {tab === 'history' && (
        history.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📋</div>
            <p>No approved admissions yet</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
              <p className="text-sm font-semibold text-gray-700">{history.length} approved admissions</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-5 py-3 font-medium">Student</th>
                  <th className="text-left px-4 py-3 font-medium">Admission No.</th>
                  <th className="text-left px-4 py-3 font-medium">Class</th>
                  <th className="text-left px-4 py-3 font-medium">Approved By</th>
                  <th className="text-left px-4 py-3 font-medium">Approved At</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => (
                  <tr key={h.admission_number} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <p className="font-medium text-gray-800">{h.student_name}</p>
                      <p className="text-xs text-gray-400">{h.father_name}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-blue-700 font-bold">{h.admission_number}</td>
                    <td className="px-4 py-3 text-gray-600">{h.class_of_admission}</td>
                    <td className="px-4 py-3 text-gray-600">{h.approved_by}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{h.approved_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Review panel */}
      {reviewing && (
        <ReviewPanel
          tempId={reviewing}
          onClose={() => setReviewing(null)}
          onApproved={handleApproved}
          onRejected={handleRejected}
        />
      )}
    </div>
  );
}
