// Admission.jsx — card-section style, all fields per physical form + requested changes

import React, { useState, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────
const CLASSES = [
  'Nursery','LKG','UKG',
  'Class 1','Class 2','Class 3','Class 4','Class 5',
  'Class 6','Class 7','Class 8','Class 9','Class 10',
  'Class 11','Class 12',
];

const CURRENT_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? `${y}-${String(y+1).slice(2)}` : `${y-1}-${String(y).slice(2)}`;
})();

const ACADEMIC_YEARS = Array.from({ length: 4 }, (_, i) => {
  const y = new Date().getFullYear() - 1 + i;
  return `${y}-${String(y+1).slice(2)}`;
});

const RELIGIONS   = ['— Select —','Hindu','Muslim','Sikh','Christian','Jain','Buddhist','Others'];
const CASTES      = ['— Select —','Brahmin','Rajput','Bania','Kayastha','Yadav','Kurmi','Jat','Jatav',
                     'Gujar','Lodhi','Pasi','Chamar','Valmiki','Kori','Dhobi',
                     'Kumhar','Teli','Mali','Nai','Lohar','Sonkar','Others'];
const PROFESSIONS = ['— Select —','Farmer','Business / Self-Employed','Government Service',
                     'Private Service','Teacher','Doctor','Engineer','Lawyer',
                     'Shopkeeper','Driver','Labour','Housewife','Others'];
const DISTRICTS   = ['Bulandshahr','Aligarh','Gautam Buddha Nagar','Meerut',
                     'Hapur','Ghaziabad','Agra','Mathura','Bareilly','Others'];
// TODO: add actual village list when provided
const VILLAGES    = [];   // empty — shows text input fallback until list is provided

const EMPTY = {
  // Office use
  date_of_admission:   new Date().toISOString().slice(0,10),
  class_of_admission:  '',
  academic_year:       CURRENT_YEAR,
  rte:                 'No',
  rte_details:         '',
  birth_cert_submitted:'No',
  tc_submitted:        'No',
  // Student
  student_first: '', student_middle: '', student_last: '',
  date_of_birth: '', gender: '',
  physically_handicapped: 'No', disability_description: '',
  blood_group: '',
  religion: '', caste: '', category: '',
  nationality: 'Indian',
  aadhar_number: '', pen_number: '',
  birth_cert_number: '',
  prev_school_attended: 'No', prev_school_name: '', prev_sr_number: '',
  // Address
  house_no: '', village: '', town: '', city: '',
  district: 'Bulandshahr', state_name: 'Uttar Pradesh', pin_code: '',
  // Father
  father_first: '', father_middle: '', father_last: '',
  father_qualification: '', father_profession: '', father_phone: '',
  // Mother
  mother_first: '', mother_middle: '', mother_last: '',
  mother_qualification: '', mother_profession: '', mother_phone: '',
  // Siblings
  has_siblings: 'No',
  sibling_search: '',        // temp field for searching
  siblings_list: [],         // [{ admission_number, student_name, current_class }]
};

// ─── UI helpers ───────────────────────────────────────────────
const sel = (err) => `w-full border ${err ? 'border-red-400':'border-gray-300'} rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white`;
const inp = (err) => `w-full border ${err ? 'border-red-400':'border-gray-300'} rounded-lg px-3 py-2 text-sm
  focus:outline-none focus:ring-2 focus:ring-blue-500`;

function Section({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Label({ text, required }) {
  return (
    <label className="block text-xs font-medium text-gray-600 mb-1">
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Err({ msg }) {
  return msg ? <p className="text-red-500 text-xs mt-1">{msg}</p> : null;
}

function SubHead({ text }) {
  return <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{text}</p>;
}

function Divider() {
  return <div className="border-t border-gray-100 my-4" />;
}

// Three-part name row with optional prefix
function NameRow({ prefix, label, first, middle, last, onChange, errors = {} }) {
  return (
    <div>
      <Label text={label} required={!!errors.first} />
      <div className="grid grid-cols-3 gap-3">
        <div className="flex gap-2">
          {prefix && (
            <span className="flex items-center text-sm font-medium text-gray-500 whitespace-nowrap
                             bg-gray-100 border border-gray-300 rounded-lg px-2">
              {prefix}
            </span>
          )}
          <div className="flex-1">
            <input value={first}
              onChange={e => onChange('first', e.target.value.toUpperCase())}
              placeholder="First Name" className={inp(errors.first)} />
            <Err msg={errors.first} />
          </div>
        </div>
        <input value={middle}
          onChange={e => onChange('middle', e.target.value.toUpperCase())}
          placeholder="Middle Name" className={inp(false)} />
        <input value={last}
          onChange={e => onChange('last', e.target.value.toUpperCase())}
          placeholder="Last Name" className={inp(errors.last)} />
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────
export default function Admission() {
  const [form, setForm]         = useState(EMPTY);
  const [errors, setErrors]     = useState({});
  const [saving, setSaving]     = useState(false);
  const [success, setSuccess]   = useState(null);
  const [sibSearch, setSibSearch]     = useState('');
  const [sibSearching, setSibSearching] = useState(false);
  const [sibError, setSibError]       = useState('');

  const set = useCallback((key, val) => {
    setForm(f => ({ ...f, [key]: val }));
    setErrors(e => ({ ...e, [key]: '' }));
  }, []);

  // ── Sibling lookup ──────────────────────────────────────────
  const fetchSibling = async () => {
    if (!sibSearch.trim()) return;
    setSibSearching(true); setSibError('');
    const res = await window.api.getStudent(sibSearch.trim());
    setSibSearching(false);
    if (!res.success) { setSibError('Student not found with this admission number.'); return; }
    const already = form.siblings_list.find(s => s.admission_number === res.data.admission_number);
    if (already) { setSibError('This student is already added.'); return; }
    setForm(f => ({ ...f, siblings_list: [...f.siblings_list, {
      admission_number: res.data.admission_number,
      student_name:     res.data.student_name,
      current_class:    res.data.current_class,
    }]}));
    setSibSearch('');
  };

  const removeSibling = (admNo) =>
    setForm(f => ({ ...f, siblings_list: f.siblings_list.filter(s => s.admission_number !== admNo) }));

  // ── Validation ──────────────────────────────────────────────
  const validate = () => {
    const e = {};
    if (!form.student_first.trim())  e.student_first    = 'First name is required';
    if (!form.student_last.trim())   e.student_last     = 'Last name is required';
    if (!form.father_first.trim())   e.father_first     = 'First name is required';
    if (!form.gender)                e.gender           = 'Required';
    if (!form.date_of_birth)         e.date_of_birth    = 'Required';
    if (!form.date_of_admission)     e.date_of_admission= 'Required';
    if (!form.class_of_admission)    e.class_of_admission='Required';
    if (!form.birth_cert_number.trim()) e.birth_cert_number = 'Birth certificate number is required';
    if (!form.village.trim())        e.village          = 'Village is required';
    if (form.aadhar_number && !/^\d{12}$/.test(form.aadhar_number.replace(/\s/g,'')))
      e.aadhar_number = 'Must be exactly 12 digits';
    if (form.father_phone && !/^\d{10}$/.test(form.father_phone))
      e.father_phone = 'Must be 10 digits';
    if (form.mother_phone && !/^\d{10}$/.test(form.mother_phone))
      e.mother_phone = 'Must be 10 digits';
    if (form.date_of_birth && new Date(form.date_of_birth) >= new Date())
      e.date_of_birth = 'Must be in the past';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Submit ──────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) {
      setTimeout(() => document.querySelector('[data-err]')?.scrollIntoView({ behavior:'smooth', block:'center' }), 100);
      return;
    }
    setSaving(true);

    const student_name = [form.student_first, form.student_middle, form.student_last].filter(Boolean).join(' ');
    const father_name  = [form.father_first,  form.father_middle,  form.father_last ].filter(Boolean).join(' ');
    const mother_name  = [form.mother_first,  form.mother_middle,  form.mother_last ].filter(Boolean).join(' ');

    const address = [
      form.house_no  && `H.No. ${form.house_no}`,
      form.village   && `Village: ${form.village}`,
      form.town      && `Town: ${form.town}`,
      form.city      && `City: ${form.city}`,
      form.district  && `Dist: ${form.district}`,
      form.state_name,
      form.pin_code  && `Pin: ${form.pin_code}`,
    ].filter(Boolean).join(', ');

    const siblings_text = form.siblings_list
      .map(s => `${s.admission_number} - ${s.student_name} (${s.current_class})`)
      .join('; ');
    const sibling_codes = form.siblings_list.map(s => s.admission_number).join(', ');

    const result = await window.api.addStudent({
      // ── Office use ──
      date_of_admission:      form.date_of_admission,
      class_of_admission:     form.class_of_admission,
      current_class:          form.class_of_admission,   // same as class_of_admission on entry
      academic_year:          form.academic_year,
      rte:                    form.rte,
      rte_details:            form.rte === 'Yes' ? form.rte_details : '',
      birth_cert_submitted:   form.birth_cert_submitted,
      tc_submitted:           form.tc_submitted,
      // ── Student ──
      student_name,
      gender:                 form.gender,
      date_of_birth:          form.date_of_birth,
      physically_handicapped: form.physically_handicapped,
      disability_description: form.physically_handicapped === 'Yes' ? form.disability_description : '',
      blood_group:            form.blood_group,
      religion:               form.religion,
      caste:                  form.caste,
      category:               form.category,
      nationality:            form.nationality,
      aadhar_number:          form.aadhar_number.replace(/\s/g,'') || null,
      pen_number:             form.pen_number,
      birth_cert_number:      form.birth_cert_number,
      prev_school_attended:   form.prev_school_attended,
      prev_school_name:       form.prev_school_attended === 'Yes' ? form.prev_school_name : '',
      prev_sr_number:         form.prev_school_attended === 'Yes' ? form.prev_sr_number  : '',
      // ── Address ──
      house_no:               form.house_no,
      village:                form.village,
      town:                   form.town,
      city:                   form.city,
      district:               form.district,
      state_name:             form.state_name,
      pin_code:               form.pin_code,
      address,
      // ── Parents ──
      father_name,
      father_qualification:   form.father_qualification,
      father_profession:      form.father_profession !== '— Select —' ? form.father_profession : '',
      father_phone:           form.father_phone,
      mother_name,
      mother_qualification:   form.mother_qualification,
      mother_profession:      form.mother_profession !== '— Select —' ? form.mother_profession : '',
      mother_phone:           form.mother_phone,
      // ── Siblings ──
      siblings:               siblings_text,
      sibling_codes,
      // ── Misc ──
      documents_submitted:    '',
    });

    setSaving(false);
    if (result.success) {
      setSuccess(result.admission_number);
      setForm(EMPTY);
      setErrors({});
      setSibSearch('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      setErrors({ _server: result.message });
    }
  };

  // ─── Render ──────────────────────────────────────────────────
  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">New Admission</h2>
        <p className="text-sm text-gray-500 mt-0.5">Fill in the details to register a new student</p>
      </div>

      {/* Success banner */}
      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-xl p-5 flex items-center justify-between">
          <div>
            <p className="font-semibold text-green-800">✅ Student admitted successfully!</p>
            <p className="text-green-700 text-sm mt-1">
              Admission Number: <span className="font-mono font-bold text-lg">{success}</span>
            </p>
          </div>
          <button onClick={() => setSuccess(null)}
            className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm">
            + Add Another
          </button>
        </div>
      )}

      {errors._server && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {errors._server}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>

        {/* ══ FOR OFFICE USE ════════════════════════════════════ */}
        <Section title="For Office Use">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <Label text="Date of Admission" required />
              <input type="date" value={form.date_of_admission}
                onChange={e => set('date_of_admission', e.target.value)}
                className={inp(errors.date_of_admission)} data-err={errors.date_of_admission||null} />
              <Err msg={errors.date_of_admission} />
            </div>
            <div>
              <Label text="Class of Admission" required />
              <select value={form.class_of_admission}
                onChange={e => set('class_of_admission', e.target.value)}
                className={sel(errors.class_of_admission)} data-err={errors.class_of_admission||null}>
                <option value="">Select class</option>
                {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <Err msg={errors.class_of_admission} />
            </div>
            <div>
              <Label text="Academic Year" />
              <select value={form.academic_year} onChange={e => set('academic_year', e.target.value)} className={sel(false)}>
                {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* RTE */}
            <div>
              <Label text="RTE (Right to Education)" />
              <select value={form.rte} onChange={e => set('rte', e.target.value)} className={sel(false)}>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>
            {form.rte === 'Yes' && (
              <div className="md:col-span-2">
                <Label text="RTE Category / Details" />
                <input value={form.rte_details} onChange={e => set('rte_details', e.target.value)}
                  placeholder="e.g. Category, quota details…" className={inp(false)} />
              </div>
            )}

            <div>
              <Label text="Birth Certificate & Aadhar Submitted" />
              <select value={form.birth_cert_submitted}
                onChange={e => set('birth_cert_submitted', e.target.value)} className={sel(false)}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </div>
            <div>
              <Label text="Transfer Certificate Submitted" />
              <select value={form.tc_submitted}
                onChange={e => set('tc_submitted', e.target.value)} className={sel(false)}>
                <option value="No">No</option><option value="Yes">Yes</option>
              </select>
            </div>
          </div>
        </Section>

        {/* ══ 1. STUDENT'S INFORMATION ══════════════════════════ */}
        <Section title="1. Student's Information">
          <div className="space-y-4">

            {/* Full name */}
            <NameRow label="Student's Full Name"
              first={form.student_first} middle={form.student_middle} last={form.student_last}
              onChange={(p, v) => set(`student_${p}`, v)}
              errors={{ first: errors.student_first, last: errors.student_last }} />

            {/* DOB, Gender, Handicap, Blood Group */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label text="Date of Birth" required />
                <input type="date" value={form.date_of_birth}
                  onChange={e => set('date_of_birth', e.target.value)}
                  className={inp(errors.date_of_birth)} data-err={errors.date_of_birth||null} />
                <Err msg={errors.date_of_birth} />
              </div>
              <div>
                <Label text="Gender" required />
                <select value={form.gender} onChange={e => set('gender', e.target.value)}
                  className={sel(errors.gender)} data-err={errors.gender||null}>
                  <option value="">Select</option>
                  <option value="M">Male (M)</option>
                  <option value="F">Female (F)</option>
                  <option value="Other">Other</option>
                </select>
                <Err msg={errors.gender} />
              </div>
              <div>
                <Label text="Physically Handicapped" />
                <select value={form.physically_handicapped}
                  onChange={e => set('physically_handicapped', e.target.value)} className={sel(false)}>
                  <option value="No">No</option><option value="Yes">Yes</option>
                </select>
              </div>
              <div>
                <Label text="Blood Group" />
                <select value={form.blood_group} onChange={e => set('blood_group', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(b => <option key={b}>{b}</option>)}
                </select>
              </div>
            </div>

            {/* Disability details — only if handicapped */}
            {form.physically_handicapped === 'Yes' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <Label text="Disability Description" />
                <input value={form.disability_description}
                  onChange={e => set('disability_description', e.target.value)}
                  placeholder="Describe the disability…" className={inp(false)} />
              </div>
            )}

            {/* Religion, Caste, Category, Nationality */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label text="Religion" />
                <select value={form.religion} onChange={e => set('religion', e.target.value)} className={sel(false)}>
                  {RELIGIONS.map(r => <option key={r} value={r === '— Select —' ? '' : r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label text="Caste" />
                <select value={form.caste} onChange={e => set('caste', e.target.value)} className={sel(false)}>
                  {CASTES.map(c => <option key={c} value={c === '— Select —' ? '' : c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label text="Category" />
                <select value={form.category} onChange={e => set('category', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  <option value="GEN">General (GEN)</option>
                  <option value="OBC">OBC</option>
                  <option value="SC">SC</option>
                  <option value="ST">ST</option>
                </select>
              </div>
              <div>
                <Label text="Nationality" />
                <input value={form.nationality} onChange={e => set('nationality', e.target.value)} className={inp(false)} />
              </div>
            </div>

            {/* Aadhar, PEN */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label text="Aadhar Card No." />
                <input value={form.aadhar_number}
                  onChange={e => set('aadhar_number', e.target.value.replace(/\D/g,'').slice(0,12))}
                  placeholder="12-digit number" maxLength={12}
                  className={inp(errors.aadhar_number)} />
                <Err msg={errors.aadhar_number} />
              </div>
              <div>
                <Label text="PEN Number" />
                <input value={form.pen_number} onChange={e => set('pen_number', e.target.value)}
                  placeholder="Permanent Education Number" className={inp(false)} />
              </div>
            </div>

            {/* Birth Certificate — mandatory with number */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <SubHead text="Birth Certificate" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label text="Birth Certificate Submitted" required />
                  <select value={form.birth_cert_submitted}
                    onChange={e => set('birth_cert_submitted', e.target.value)} className={sel(false)}>
                    <option value="No">No</option><option value="Yes">Yes</option>
                  </select>
                </div>
                <div>
                  <Label text="Birth Certificate Number" required />
                  <input value={form.birth_cert_number}
                    onChange={e => set('birth_cert_number', e.target.value)}
                    placeholder="Certificate number"
                    className={inp(errors.birth_cert_number)}
                    data-err={errors.birth_cert_number||null} />
                  <Err msg={errors.birth_cert_number} />
                </div>
              </div>
            </div>

            {/* Previous School */}
            <div>
              <div className="flex items-center gap-4 mb-3">
                <Label text="Previously attended any school?" />
                <div className="flex gap-3">
                  {['No','Yes'].map(v => (
                    <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm">
                      <input type="radio" name="prev_school" value={v}
                        checked={form.prev_school_attended === v}
                        onChange={() => set('prev_school_attended', v)}
                        className="accent-blue-600" />
                      {v}
                    </label>
                  ))}
                </div>
              </div>

              {form.prev_school_attended === 'Yes' && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label text="Name of Previous School" />
                    <input value={form.prev_school_name}
                      onChange={e => set('prev_school_name', e.target.value)}
                      placeholder="Full school name" className={inp(false)} />
                  </div>
                  <div>
                    <Label text="Previous SR / Admission Number" />
                    <input value={form.prev_sr_number}
                      onChange={e => set('prev_sr_number', e.target.value)}
                      className={inp(false)} />
                  </div>
                </div>
              )}
            </div>

            {/* Address */}
            <div>
              <SubHead text="Address" />
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <Label text="House No. / Street" />
                  <input value={form.house_no} onChange={e => set('house_no', e.target.value)}
                    placeholder="House No., Street" className={inp(false)} />
                </div>

                {/* Village — dropdown (to be filled) with text fallback */}
                <div>
                  <Label text="Village" required />
                  {VILLAGES.length > 0 ? (
                    <select value={form.village} onChange={e => set('village', e.target.value)}
                      className={sel(errors.village)} data-err={errors.village||null}>
                      <option value="">— Select Village —</option>
                      {VILLAGES.map(v => <option key={v} value={v}>{v}</option>)}
                    </select>
                  ) : (
                    <input value={form.village} onChange={e => set('village', e.target.value)}
                      placeholder="Village name"
                      className={inp(errors.village)} data-err={errors.village||null} />
                  )}
                  <Err msg={errors.village} />
                </div>

                <div>
                  <Label text="Town (optional)" />
                  <input value={form.town} onChange={e => set('town', e.target.value)}
                    placeholder="Town name" className={inp(false)} />
                </div>
                <div>
                  <Label text="City (optional)" />
                  <input value={form.city} onChange={e => set('city', e.target.value)}
                    placeholder="City name" className={inp(false)} />
                </div>
                <div>
                  <Label text="District" />
                  <select value={form.district} onChange={e => set('district', e.target.value)} className={sel(false)}>
                    {DISTRICTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <Label text="State" />
                  <input value={form.state_name} onChange={e => set('state_name', e.target.value)} className={inp(false)} />
                </div>
                <div>
                  <Label text="Pin Code" />
                  <input value={form.pin_code}
                    onChange={e => set('pin_code', e.target.value.replace(/\D/g,'').slice(0,6))}
                    placeholder="6-digit pin" maxLength={6} className={inp(false)} />
                </div>
              </div>
            </div>

          </div>
        </Section>

        {/* ══ 2. PARENT'S INFORMATION ═══════════════════════════ */}
        <Section title="2. Parent's Information">
          <div className="space-y-5">

            {/* Father */}
            <div>
              <SubHead text="Father's Details" />
              <div className="space-y-4">
                <NameRow label="Father's Full Name"
                  prefix="Mr."
                  first={form.father_first} middle={form.father_middle} last={form.father_last}
                  onChange={(p, v) => set(`father_${p}`, v)}
                  errors={{ first: errors.father_first }} />
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label text="Qualification" />
                    <input value={form.father_qualification}
                      onChange={e => set('father_qualification', e.target.value)} className={inp(false)} />
                  </div>
                  <div>
                    <Label text="Profession" />
                    <select value={form.father_profession}
                      onChange={e => set('father_profession', e.target.value)} className={sel(false)}>
                      {PROFESSIONS.map(p => <option key={p} value={p === '— Select —' ? '' : p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label text="Mobile No." />
                    <input value={form.father_phone}
                      onChange={e => set('father_phone', e.target.value.replace(/\D/g,'').slice(0,10))}
                      placeholder="10-digit number"
                      className={inp(errors.father_phone)} />
                    <Err msg={errors.father_phone} />
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            {/* Mother */}
            <div>
              <SubHead text="Mother's Details" />
              <div className="space-y-4">
                <NameRow label="Mother's Full Name"
                  prefix="Mrs."
                  first={form.mother_first} middle={form.mother_middle} last={form.mother_last}
                  onChange={(p, v) => set(`mother_${p}`, v)}
                  errors={{}} />
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label text="Qualification" />
                    <input value={form.mother_qualification}
                      onChange={e => set('mother_qualification', e.target.value)} className={inp(false)} />
                  </div>
                  <div>
                    <Label text="Profession" />
                    <select value={form.mother_profession}
                      onChange={e => set('mother_profession', e.target.value)} className={sel(false)}>
                      {PROFESSIONS.map(p => <option key={p} value={p === '— Select —' ? '' : p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label text="Mobile No." />
                    <input value={form.mother_phone}
                      onChange={e => set('mother_phone', e.target.value.replace(/\D/g,'').slice(0,10))}
                      placeholder="10-digit number"
                      className={inp(errors.mother_phone)} />
                    <Err msg={errors.mother_phone} />
                  </div>
                </div>
              </div>
            </div>

          </div>
        </Section>

        {/* ══ 3. OTHER INFORMATION ══════════════════════════════ */}
        <Section title="3. Other Information">

          <div className="flex items-center gap-4 mb-4">
            <Label text="Does the student have siblings studying in this school?" />
            <div className="flex gap-4">
              {['No','Yes'].map(v => (
                <label key={v} className="flex items-center gap-1.5 cursor-pointer text-sm font-medium">
                  <input type="radio" name="has_siblings" value={v}
                    checked={form.has_siblings === v}
                    onChange={() => set('has_siblings', v)}
                    className="accent-blue-600" />
                  {v}
                </label>
              ))}
            </div>
          </div>

          {form.has_siblings === 'Yes' && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4">
              <p className="text-xs text-gray-500">Enter the admission number of each sibling to fetch their details.</p>

              {/* Search bar */}
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <Label text="Sibling's Admission Number" />
                  <input value={sibSearch}
                    onChange={e => { setSibSearch(e.target.value); setSibError(''); }}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), fetchSibling())}
                    placeholder="e.g. ADM-2024-0001"
                    className={inp(sibError)} />
                  {sibError && <p className="text-red-500 text-xs mt-1">{sibError}</p>}
                </div>
                <button type="button" onClick={fetchSibling} disabled={sibSearching}
                  className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                  {sibSearching ? 'Searching…' : '+ Add'}
                </button>
              </div>

              {/* Sibling list */}
              {form.siblings_list.length > 0 && (
                <div className="space-y-2">
                  {form.siblings_list.map(s => (
                    <div key={s.admission_number}
                      className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-2.5">
                      <div>
                        <p className="text-sm font-medium text-gray-800">{s.student_name}</p>
                        <p className="text-xs text-gray-400">{s.admission_number} · {s.current_class}</p>
                      </div>
                      <button type="button" onClick={() => removeSibling(s.admission_number)}
                        className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {form.siblings_list.length === 0 && (
                <p className="text-xs text-gray-400 italic">No siblings added yet.</p>
              )}
            </div>
          )}
        </Section>

        {/* Submit */}
        <div className="flex items-center justify-between pb-8">
          <button type="button" onClick={() => { setForm(EMPTY); setErrors({}); setSuccess(null); setSibSearch(''); }}
            className="text-sm text-gray-400 hover:text-gray-600 underline">
            Clear form
          </button>
          <button type="submit" disabled={saving}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300
                       text-white font-medium px-8 py-2.5 rounded-lg text-sm flex items-center gap-2">
            {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '✅ Submit Admission'}
          </button>
        </div>

      </form>
    </div>
  );
}
