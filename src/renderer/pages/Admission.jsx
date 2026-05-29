// Admission.jsx
// Registers a new student into the SR Register.
// On submit → calls enrollment:add IPC → auto-generates Admission Number.

import React, { useState } from 'react';

// ── Constants ─────────────────────────────────────────────────
const CLASSES = [
  'Nursery', 'LKG', 'UKG',
  'Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5',
  'Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10',
  'Class 11', 'Class 12',
];

const CURRENT_YEAR = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 3 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
})();

const ACADEMIC_YEARS = Array.from({ length: 4 }, (_, i) => {
  const y = new Date().getFullYear() - 1 + i;
  return `${y}-${String(y + 1).slice(2)}`;
});

const EMPTY_FORM = {
  student_name: '', father_name: '', mother_name: '',
  gender: '', date_of_birth: '', date_of_admission: new Date().toISOString().slice(0, 10),
  class_of_admission: '', current_class: '', academic_year: CURRENT_YEAR,
  aadhar_number: '', pen_number: '',
  father_phone: '', mother_phone: '', blood_group: '',
  religion: '', caste: '', category: '',
  address: '', prev_school_name: '', prev_sr_number: '',
  documents_submitted: [],
};

const DOCUMENTS = ['Birth Certificate', 'TC', 'Aadhar Card', 'Passport Photo', 'Address Proof', 'Caste Certificate'];

// ── Section wrapper ───────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        {children}
      </div>
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────
function Field({ label, required, children, span }) {
  return (
    <div className={span === 2 ? 'md:col-span-2' : span === 3 ? 'md:col-span-3' : ''}>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = `w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
  disabled:bg-gray-50`;

// ── Main component ────────────────────────────────────────────
export default function Admission() {
  const [form, setForm]       = useState(EMPTY_FORM);
  const [errors, setErrors]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [success, setSuccess] = useState(null);   // { admission_number }

  const set = (key, val) => {
    setForm(f => ({ ...f, [key]: val }));
    if (errors[key]) setErrors(e => ({ ...e, [key]: '' }));
  };

  const toggleDoc = (doc) => {
    setForm(f => ({
      ...f,
      documents_submitted: f.documents_submitted.includes(doc)
        ? f.documents_submitted.filter(d => d !== doc)
        : [...f.documents_submitted, doc],
    }));
  };

  // ── Validation ──────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.student_name.trim())      e.student_name       = 'Student name is required';
    if (!form.father_name.trim())       e.father_name        = "Father's name is required";
    if (!form.gender)                   e.gender             = 'Please select gender';
    if (!form.date_of_birth)            e.date_of_birth      = 'Date of birth is required';
    if (!form.date_of_admission)        e.date_of_admission  = 'Date of admission is required';
    if (!form.class_of_admission)       e.class_of_admission = 'Class of admission is required';
    if (!form.current_class)            e.current_class      = 'Current class is required';
    if (!form.academic_year)            e.academic_year      = 'Academic year is required';

    if (form.aadhar_number && !/^\d{12}$/.test(form.aadhar_number.replace(/\s/g, ''))) {
      e.aadhar_number = 'Aadhar must be exactly 12 digits';
    }
    if (form.father_phone && !/^\d{10}$/.test(form.father_phone.replace(/\s/g, ''))) {
      e.father_phone = 'Phone must be 10 digits';
    }
    if (form.mother_phone && !/^\d{10}$/.test(form.mother_phone.replace(/\s/g, ''))) {
      e.mother_phone = 'Phone must be 10 digits';
    }

    // DOB must be in the past
    if (form.date_of_birth && new Date(form.date_of_birth) >= new Date()) {
      e.date_of_birth = 'Date of birth must be in the past';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      // Scroll to first error
      setTimeout(() => document.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
      return;
    }

    setSaving(true);
    const payload = {
      ...form,
      documents_submitted: form.documents_submitted.join(', '),
      aadhar_number: form.aadhar_number.replace(/\s/g, '') || null,
    };

    const result = await window.api.addStudent(payload);
    setSaving(false);

    if (result.success) {
      setSuccess({ admission_number: result.admission_number });
      setForm(EMPTY_FORM);
      setErrors({});
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setErrors({ _server: result.message });
    }
  };

  const handleReset = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    setSuccess(null);
  };

  // ── Error helper ────────────────────────────────────────────
  const ErrMsg = ({ field }) =>
    errors[field] ? <p className="text-red-500 text-xs mt-1 field-error">{errors[field]}</p> : null;

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-4xl">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">New Admission</h2>
          <p className="text-sm text-gray-500 mt-0.5">Fill in the details to register a new student</p>
        </div>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl">✅</span>
            <div className="flex-1">
              <p className="font-semibold text-green-800">Student admitted successfully!</p>
              <p className="text-green-700 text-sm mt-1">
                Admission Number: <span className="font-mono font-bold text-lg">{success.admission_number}</span>
              </p>
              <p className="text-green-600 text-xs mt-1">Note this number down for the student's records.</p>
            </div>
            <button
              onClick={handleReset}
              className="bg-green-600 hover:bg-green-700 text-white text-sm px-4 py-2 rounded-lg"
            >
              + Add Another
            </button>
          </div>
        </div>
      )}

      {/* Server error */}
      {errors._server && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {errors._server}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>

        {/* ── 1. Basic Information ── */}
        <Section title="1. Basic Information">
          <Field label="Student Full Name" required span={2}>
            <input
              value={form.student_name}
              onChange={e => set('student_name', e.target.value)}
              placeholder="As per birth certificate"
              className={inputCls}
            />
            <ErrMsg field="student_name" />
          </Field>

          <Field label="Gender" required>
            <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputCls}>
              <option value="">Select</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </select>
            <ErrMsg field="gender" />
          </Field>

          <Field label="Date of Birth" required>
            <input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inputCls} />
            <ErrMsg field="date_of_birth" />
          </Field>

          <Field label="Blood Group">
            <select value={form.blood_group} onChange={e => set('blood_group', e.target.value)} className={inputCls}>
              <option value="">Select</option>
              {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(bg => (
                <option key={bg} value={bg}>{bg}</option>
              ))}
            </select>
          </Field>

          <Field label="Aadhar Number">
            <input
              value={form.aadhar_number}
              onChange={e => set('aadhar_number', e.target.value.replace(/\D/g, '').slice(0, 12))}
              placeholder="12-digit number"
              maxLength={12}
              className={inputCls}
            />
            <ErrMsg field="aadhar_number" />
          </Field>

          <Field label="PEN Number">
            <input value={form.pen_number} onChange={e => set('pen_number', e.target.value)} placeholder="Permanent Education Number" className={inputCls} />
          </Field>
        </Section>

        {/* ── 2. Admission Details ── */}
        <Section title="2. Admission Details">
          <Field label="Date of Admission" required>
            <input type="date" value={form.date_of_admission} onChange={e => set('date_of_admission', e.target.value)} className={inputCls} />
            <ErrMsg field="date_of_admission" />
          </Field>

          <Field label="Class of Admission" required>
            <select value={form.class_of_admission} onChange={e => { set('class_of_admission', e.target.value); if (!form.current_class) set('current_class', e.target.value); }} className={inputCls}>
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ErrMsg field="class_of_admission" />
          </Field>

          <Field label="Current Class" required>
            <select value={form.current_class} onChange={e => set('current_class', e.target.value)} className={inputCls}>
              <option value="">Select class</option>
              {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <ErrMsg field="current_class" />
          </Field>

          <Field label="Academic Year" required>
            <select value={form.academic_year} onChange={e => set('academic_year', e.target.value)} className={inputCls}>
              {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ErrMsg field="academic_year" />
          </Field>
        </Section>

        {/* ── 3. Parent / Guardian ── */}
        <Section title="3. Parent / Guardian Details">
          <Field label="Father's Full Name" required span={2}>
            <input value={form.father_name} onChange={e => set('father_name', e.target.value)} placeholder="Father's name" className={inputCls} />
            <ErrMsg field="father_name" />
          </Field>

          <Field label="Father's Phone">
            <input
              value={form.father_phone}
              onChange={e => set('father_phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              className={inputCls}
            />
            <ErrMsg field="father_phone" />
          </Field>

          <Field label="Mother's Full Name" span={2}>
            <input value={form.mother_name} onChange={e => set('mother_name', e.target.value)} placeholder="Mother's name" className={inputCls} />
          </Field>

          <Field label="Mother's Phone">
            <input
              value={form.mother_phone}
              onChange={e => set('mother_phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile"
              className={inputCls}
            />
            <ErrMsg field="mother_phone" />
          </Field>

          <Field label="Residential Address" span={3}>
            <textarea
              value={form.address}
              onChange={e => set('address', e.target.value)}
              placeholder="Full address"
              rows={2}
              className={inputCls + ' resize-none'}
            />
          </Field>
        </Section>

        {/* ── 4. Category & Religion ── */}
        <Section title="4. Category & Religion">
          <Field label="Religion">
            <input value={form.religion} onChange={e => set('religion', e.target.value)} placeholder="e.g. Hindu, Muslim, Christian" className={inputCls} />
          </Field>

          <Field label="Caste">
            <input value={form.caste} onChange={e => set('caste', e.target.value)} className={inputCls} />
          </Field>

          <Field label="Category">
            <select value={form.category} onChange={e => set('category', e.target.value)} className={inputCls}>
              <option value="">Select</option>
              <option value="GEN">General (GEN)</option>
              <option value="OBC">OBC</option>
              <option value="SC">SC</option>
              <option value="ST">ST</option>
            </select>
          </Field>
        </Section>

        {/* ── 5. Previous School ── */}
        <Section title="5. Previous School (if any)">
          <Field label="Previous School Name" span={2}>
            <input value={form.prev_school_name} onChange={e => set('prev_school_name', e.target.value)} placeholder="Name of school last attended" className={inputCls} />
          </Field>

          <Field label="Previous SR Number">
            <input value={form.prev_sr_number} onChange={e => set('prev_sr_number', e.target.value)} className={inputCls} />
          </Field>
        </Section>

        {/* ── 6. Documents ── */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-700">6. Documents Submitted</h3>
          </div>
          <div className="p-5 flex flex-wrap gap-3">
            {DOCUMENTS.map(doc => (
              <label key={doc} className={`flex items-center gap-2 px-4 py-2 rounded-lg border cursor-pointer text-sm transition-colors
                ${form.documents_submitted.includes(doc)
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                <input
                  type="checkbox"
                  checked={form.documents_submitted.includes(doc)}
                  onChange={() => toggleDoc(doc)}
                  className="w-4 h-4 accent-blue-600"
                />
                {doc}
              </label>
            ))}
          </div>
        </div>

        {/* ── Submit ── */}
        <div className="flex items-center justify-between pb-8">
          <button
            type="button"
            onClick={handleReset}
            className="text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear form
          </button>
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white
                       font-medium px-8 py-2.5 rounded-lg text-sm flex items-center gap-2"
          >
            {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '✅ Submit Admission'}
          </button>
        </div>

      </form>
    </div>
  );
}
