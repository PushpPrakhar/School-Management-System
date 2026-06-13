// Admission.jsx — Two-step admission form
// Step 1: General Information → Save
// Step 2: Enrollment Details  → Submit

import React, { useState } from 'react';

// ── Constants ─────────────────────────────────────────────────
// Date helpers — DB stores DD-MM-YYYY, <input type="date"> needs YYYY-MM-DD
const toInputDate  = (v) => {
  if (!v || v === '00-00-0000') return '';
  const p = String(v).split('-');
  if (p.length === 3 && p[2]?.length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
  if (p.length === 3 && p[0]?.length === 4) return v; // already YYYY-MM-DD
  return '';
};
const fromInputDate = (v) => {
  if (!v) return '';
  const p = String(v).split('-');
  if (p.length === 3 && p[0]?.length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
  return v;
};

const VILLAGES = [
  'Badauli','Balrau','Bhura Badauli','Danwar',
  'Dushhera','Dushheri','Ishan Pur','Jawal',
  'Kamalpur','Kathpura','Khurja','Kyoli',
  'Madhkola','Mahmudpur','Mansoorpur','Meerpur',
  'Nagla Sherpur','Naglakat','Nayabas Nayser','Nayser',
  'Rohinda','Shahvaj Pur','Sherpur Nayser','Thangora',
  'Tikri','Other',
];

const CLASSES = [
  'Nursery','LKG','UKG',
  'Class 1','Class 2','Class 3','Class 4','Class 5',
  'Class 6','Class 7','Class 8','Class 9','Class 10',
  'Class 11','Class 12',
];

const CLASS_ORDER = {
  'Nursery':0,'LKG':1,'UKG':2,
  'Class 1':3,'Class 2':4,'Class 3':5,'Class 4':6,'Class 5':7,
  'Class 6':8,'Class 7':9,'Class 8':10,'Class 9':11,'Class 10':12,
  'Class 11':13,'Class 12':14,
};
const isClass9Plus  = (c) => CLASS_ORDER[c] >= 11;
const isClass11Plus = (c) => CLASS_ORDER[c] >= 13;

const CASTES            = ['Badhai','Banjara','Brahmin','Chamar','Dhobi','Dhimar',
  'Gaderia','Gujjar','Jaat','Jatav','Khatik','Kori','Kumhar','Muslim',
  'Nai','Rajput','Teli','Vaishya','Valmiki','Yadav'];
const SOCIAL_CATEGORIES = ['General (GEN)','OBC','SC','ST'];
const MINORITY_GROUPS   = ['Not Applicable','Muslim','Christian','Sikh','Buddhist','Parsi','Jain'];
const BLOOD_GROUPS      = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
const MEDIUMS           = ['Hindi','English','Urdu','Sanskrit'];
const LANGUAGES         = ['Hindi','English','Sanskrit','Urdu','Punjabi','Mathematics'];
const STREAMS           = ['Science','Commerce','Arts / Humanities','Vocational'];
const SUBJECT_GROUPS    = [
  'PCM (Physics, Chemistry, Maths)',
  'PCB (Physics, Chemistry, Biology)',
  'PCMB (Physics, Chemistry, Maths & Biology)',
  'Commerce with Maths',
  'Commerce without Maths',
  'Arts / Humanities',
  'Vocational',
];

// CWSN impairment types — RPWD Act 2016 categories used in Indian education
const IMPAIRMENTS = [
  'Blindness',
  'Low Vision',
  'Deaf',
  'Hard of Hearing',
  'Locomotor Disability',
  'Cerebral Palsy',
  'Intellectual Disability',
  'Specific Learning Disabilities (SLD)',
  'Autism Spectrum Disorder (ASD)',
  'Mental Illness',
  'Speech and Language Disability',
  'Multiple Disabilities',
  'Multiple Disabilities including Deaf-Blindness',
  'Chronic Neurological Conditions',
  'Muscular Dystrophy',
  'Dwarfism',
  'Acid Attack Victim',
  'Thalassemia',
  'Hemophilia',
  'Sickle Cell Disease',
  'Leprosy Cured',
  'Parkinson\'s Disease',
  'Other',
];

const CURRENT_SESSION_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1;
})();
const CURRENT_YEAR = `${CURRENT_SESSION_YEAR}-${String(CURRENT_SESSION_YEAR+1).slice(2)}`;
// Allow selecting past years for backdated admissions
const ADMISSION_YEARS = Array.from({ length: 5 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 3 + i;
  return `${y}-${String(y+1).slice(2)}`;
}).reverse(); // newest first

// ── Blank form state ──────────────────────────────────────────
const BLANK_GENERAL = {
  student_name: '', gender: '', date_of_birth: '',
  date_of_admission: new Date().toISOString().slice(0,10),
  indian_nationality: 'Yes',
  blood_group: '', mother_tongue: 'Hindi',
  aadhar_number: '999999999999', aadhar_doc: '',
  birth_cert: 'No', birth_cert_doc: '',
  mother_name: '', mother_profession: 'Housewife',
  father_name: '', father_profession: 'Mazdoori',
  guardian_name: '', contact_email: '',
  mobile_number: '', alternate_mobile: '',
  house_no: '', village: '', post: '',
  district: 'Bulandshahr', state_name: 'Uttar Pradesh', pin_code: '203131',
  caste: '', religion: '',
  category: '', minority_group: 'Not Applicable',
  bpl_beneficiary: 'No', ews_disadvantaged: 'No',
  cwsn: 'No', impairment_type: '',
  disability_certificate: 'No', disability_cert_doc: '', disability_percentage: '',
};

const BLANK_ENROLLMENT = {
  date_of_admission: new Date().toISOString().slice(0,10),
  class_of_admission: '', section: 'A', academic_year: CURRENT_YEAR,
  pen_number: '11111111111', apaar_id: '',
  rte_section_12c: 'No', rte_amount_claimed: '',
  medium_of_instruction: 'English',
  language_group: '', academic_stream: '', subject_group: '',
  studied_elsewhere: 'No', tc_submitted: 'No', tc_doc: '',
  prev_year_status: '', prev_year_class: '',
  prev_enrollment_number: '', prev_academic_year: '',
  prev_school_name: '',
  student_status: 'ACTIVE',
};

// ── Shared UI helpers ─────────────────────────────────────────
const inp = (err) =>
  `w-full border ${err ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm
   focus:outline-none focus:ring-2 focus:ring-blue-500`;
const sel = (err) =>
  `w-full border ${err ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm
   focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white`;
const disabledInp =
  `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed`;

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
function Card({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
// ── Module-level layout helpers (must be outside Step1/Step2 to avoid remount bug) ──
function FieldRow({ children }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-4">{children}</div>;
}
function Field({ label, required, error, children, span }) {
  return (
    <div className={span === 2 ? 'col-span-2' : ''}>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
}
async function pickDocFile() {
  return await window.api.pickFile([{ name: 'Documents', extensions: ['pdf','jpg','jpeg','png'] }]);
}
function UploadBtn({ onUpload, value }) {
  return (
    <div className="flex gap-2 mt-1 items-center">
      <button type="button" onClick={onUpload}
        className="text-xs border border-blue-300 text-blue-600 hover:bg-blue-50
                   px-3 py-1 rounded-lg flex items-center gap-1">
        📎 {value ? 'Change' : 'Upload'}
      </button>
      {value && (
        <span className="text-xs text-green-600 flex items-center gap-1">
          ✓ {value.split(/[\/]/).pop()}
        </span>
      )}
    </div>
  );
}

function YesNo({ value, onChange, disabled }) {
  return (
    <div className="flex gap-4 mt-1">
      {['Yes','No'].map(v => (
        <label key={v} className={`flex items-center gap-1.5 text-sm cursor-pointer ${disabled ? 'opacity-40' : ''}`}>
          <input type="radio" value={v} checked={value === v} onChange={() => !disabled && onChange(v)}
            className="accent-blue-600" disabled={disabled} />
          {v}
        </label>
      ))}
    </div>
  );
}

// ── Step indicator ────────────────────────────────────────────
function StepBar({ step, onStepClick }) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {[
        { n:1, label:'General Profile' },
        { n:2, label:'Enrollment Profile' },
      ].map(({ n, label }, i) => (
        <React.Fragment key={n}>
          <button
            type="button"
            onClick={() => onStepClick(n)}
            className="flex items-center gap-2 group"
            title={`Switch to Step ${n}`}
          >
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
              transition-colors group-hover:ring-2 group-hover:ring-blue-300
              ${step > n ? 'bg-green-600 text-white'
              : step === n ? 'bg-blue-700 text-white'
              : 'bg-gray-200 text-gray-400'}`}>
              {step > n ? '✓' : n}
            </div>
            <span className={`text-sm transition-colors group-hover:text-blue-600
              ${step === n ? 'font-semibold text-blue-700' : 'text-gray-400'}`}>
              {label}
            </span>
          </button>
          {i === 0 && (
            <div className={`flex-1 h-px mx-4 ${step > 1 ? 'bg-green-500' : 'bg-gray-200'}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STEP 1 — General Information
// ══════════════════════════════════════════════════════════════
function Step1({ onSave, initialData }) {
  const [form, setForm]     = useState(initialData || BLANK_GENERAL);
  const [errors, setErrors] = useState({});

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })); };

  const validate = () => {
    const e = {};
    if (!form.student_name.trim()) e.student_name  = 'Required';
    if (!form.gender)              e.gender        = 'Required';
    if (!form.date_of_birth)       e.date_of_birth = 'Required';
    if (!form.father_name.trim())  e.father_name   = 'Required';
    if (!form.village)             e.village       = 'Required';
    if (form.mobile_number && !/^\d{10}$/.test(form.mobile_number))
      e.mobile_number = 'Must be 10 digits';
    if (form.alternate_mobile && !/^\d{10}$/.test(form.alternate_mobile))
      e.alternate_mobile = 'Must be 10 digits';
    if (form.aadhar_number && !/^\d{12}$/.test(form.aadhar_number.replace(/\s/g,'')))
      e.aadhar_number = 'Must be 12 digits';
    if (form.date_of_birth && new Date(form.date_of_birth) >= new Date())
      e.date_of_birth = 'Must be in the past';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave(form);
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-1">New Admission</h2>
      <p className="text-sm text-gray-500 mb-6">Step 1 of 2 — General Profile</p>

      {/* ── STUDENT IDENTITY ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Student Identity</h3>
        </div>
        <div className="p-5 space-y-4">

          {/* Row 1: Name | Gender */}
          <FieldRow>
            <Field label="Student's Full Name" required error={errors.student_name}>
              <input value={form.student_name}
                onChange={e => set('student_name', e.target.value.toUpperCase())}
                placeholder="Full name as per documents"
                className={inp(errors.student_name)} />
            </Field>
            <Field label="Gender" required error={errors.gender}>
              <select value={form.gender} onChange={e => set('gender', e.target.value)}
                className={sel(errors.gender)}>
                <option value="">Select</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="Other">Other / Transgender</option>
              </select>
            </Field>
          </FieldRow>

          {/* Row 2: Date of Birth | Indian Nationality */}
          <FieldRow>
            <Field label="Date of Birth (DD/MM/YYYY)" required error={errors.date_of_birth}>
              <input type="date" value={form.date_of_birth}
                onChange={e => set('date_of_birth', e.target.value)}
                className={inp(errors.date_of_birth)} />
            </Field>
            <Field label="Indian Nationality">
              <input
                value={form.indian_nationality}
                onChange={e => set('indian_nationality', e.target.value)}
                placeholder="e.g. Yes / Indian"
                className={inp(false)}
              />
            </Field>
          </FieldRow>

          {/* Row 3: Blood Group | Mother Tongue */}
          <FieldRow>
            <Field label="Blood Group">
              <select value={form.blood_group} onChange={e => set('blood_group', e.target.value)}
                className={sel(false)}>
                <option value="">Select</option>
                {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Mother Tongue">
              <select value={form.mother_tongue} onChange={e => set('mother_tongue', e.target.value)}
                className={sel(false)}>
                {['Hindi','Urdu','Punjabi','Sanskrit','English','Other'].map(l =>
                  <option key={l}>{l}</option>)}
              </select>
            </Field>
          </FieldRow>

          {/* Row 4: Aadhar | Birth Certificate */}
          <FieldRow>
            <Field label="Aadhar Number" error={errors.aadhar_number}>
              <div className="flex items-center gap-2">
                <input value={form.aadhar_number}
                  onChange={e => set('aadhar_number', e.target.value.replace(/\D/g,'').slice(0,12))}
                  placeholder="12-digit number" maxLength={12}
                  className={`w-44 border ${errors.aadhar_number ? 'border-red-400' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`} />
                <UploadBtn onUpload={async () => { const p = await pickDocFile(); if(p) set('aadhar_doc', p); }} value={form.aadhar_doc} />
              </div>
            </Field>
            <Field label="Birth Certificate">
              <div className="flex items-center gap-2">
                <YesNo value={form.birth_cert} onChange={v => set('birth_cert', v)} />
                <UploadBtn onUpload={async () => { const p = await pickDocFile(); if(p) set('birth_cert_doc', p); }} value={form.birth_cert_doc} />
              </div>
            </Field>
          </FieldRow>

        </div>
      </div>

      {/* ── PARENTS / GUARDIAN ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Parents / Guardian</h3>
        </div>
        <div className="p-5 space-y-4">

          {/* Row 1: Mother's Name | Mother's Profession */}
          <FieldRow>
            <Field label="Mother's Name">
              <input value={form.mother_name}
                onChange={e => set('mother_name', e.target.value.toUpperCase())}
                placeholder="Mother's full name" className={inp(false)} />
            </Field>
            <Field label="Profession">
              <select value={form.mother_profession}
                onChange={e => set('mother_profession', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                <option>Housewife</option>
                <option>Service</option>
                <option>Others</option>
              </select>
            </Field>
          </FieldRow>

          {/* Row 2: Father's Name | Father's Profession */}
          <FieldRow>
            <Field label="Father's Name" required error={errors.father_name}>
              <input value={form.father_name}
                onChange={e => set('father_name', e.target.value.toUpperCase())}
                placeholder="Father's full name" className={inp(errors.father_name)} />
            </Field>
            <Field label="Profession">
              <select value={form.father_profession}
                onChange={e => set('father_profession', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                <option>Farmer</option>
                <option>Service</option>
                <option>Mazdoori</option>
                <option>Others</option>
              </select>
            </Field>
          </FieldRow>

          {/* Row 3: Guardian's Name | Contact Email */}
          <FieldRow>
            <Field label="Guardian's Name">
              <input value={form.guardian_name}
                onChange={e => set('guardian_name', e.target.value.toUpperCase())}
                placeholder="If different from parents" className={inp(false)} />
            </Field>
            <Field label="Contact Email">
              <input type="email" value={form.contact_email}
                onChange={e => set('contact_email', e.target.value)}
                placeholder="email@example.com" className={inp(false)} />
            </Field>
          </FieldRow>

          {/* Row 4: Mobile | Alternate Mobile */}
          <FieldRow>
            <Field label="Mobile Number (Student/Parent/Guardian)" error={errors.mobile_number}>
              <input value={form.mobile_number}
                onChange={e => set('mobile_number', e.target.value.replace(/\D/g,'').slice(0,10))}
                placeholder="10-digit number" className={inp(errors.mobile_number)} />
            </Field>
            <Field label="Alternate Mobile Number" error={errors.alternate_mobile}>
              <input value={form.alternate_mobile}
                onChange={e => set('alternate_mobile', e.target.value.replace(/\D/g,'').slice(0,10))}
                placeholder="10-digit number" className={inp(errors.alternate_mobile)} />
            </Field>
          </FieldRow>

        </div>
      </div>

      {/* ── ADDRESS ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Address</h3>
        </div>
        <div className="p-5 space-y-4">

          {/* Row 1: House No | Village | Post */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-4">
            <Field label="House No. / Street">
              <input value={form.house_no} onChange={e => set('house_no', e.target.value)}
                placeholder="House No., Street" className={inp(false)} />
            </Field>
            <Field label="Village" required error={errors.village}>
              <select value={form.village} onChange={e => set('village', e.target.value)}
                className={sel(errors.village)}>
                <option value="">Select village</option>
                {VILLAGES.map(v => <option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Post (Post Office)">
              <input value={form.post} onChange={e => set('post', e.target.value)}
                placeholder="Post office name" className={inp(false)} />
            </Field>
          </div>

          {/* Row 2: District | State | Pin */}
          <div className="grid grid-cols-3 gap-x-6 gap-y-4">
            <Field label="District">
              <input value={form.district} onChange={e => set('district', e.target.value)}
                className={inp(false)} />
            </Field>
            <Field label="State">
              <input value={form.state_name} onChange={e => set('state_name', e.target.value)}
                className={inp(false)} />
            </Field>
            <Field label="Pin Code">
              <input value={form.pin_code}
                onChange={e => set('pin_code', e.target.value.replace(/\D/g,'').slice(0,6))}
                maxLength={6} className={inp(false)} />
            </Field>
          </div>

        </div>
      </div>

      {/* ── SOCIAL DETAILS ── */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Social Details</h3>
        </div>
        <div className="p-5 space-y-4">

          {/* Row 1: Caste | Religion */}
          <FieldRow>
            <Field label="Caste">
              <select value={form.caste}
                onChange={e => set('caste', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                {CASTES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Religion">
              <select value={form.religion}
                onChange={e => set('religion', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                {['Hindu','Muslim','Sikh','Christian','Jain','Buddhist','Others'].map(r =>
                  <option key={r}>{r}</option>)}
              </select>
            </Field>
          </FieldRow>

          {/* Row 2: Social Category | Minority Group */}
          <FieldRow>
            <Field label="Social Category">
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className={sel(false)}>
                <option value="">Select</option>
                {SOCIAL_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Minority Group">
              <select value={form.minority_group}
                onChange={e => set('minority_group', e.target.value)} className={sel(false)}>
                {MINORITY_GROUPS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </FieldRow>

          {/* Row 3: BPL | EWS */}
          <FieldRow>
            <Field label="BPL Beneficiary">
              <YesNo value={form.bpl_beneficiary} onChange={v => set('bpl_beneficiary', v)} />
            </Field>
            <Field label="EWS / Disadvantaged Group">
              <YesNo value={form.ews_disadvantaged} onChange={v => set('ews_disadvantaged', v)} />
            </Field>
          </FieldRow>

          {/* Row 3: CWSN | Type of Impairment */}
          <FieldRow>
            <Field label="Children with Special Needs (CWSN)">
              <YesNo value={form.cwsn} onChange={v => set('cwsn', v)} />
            </Field>
            <Field label="Type of Impairment">
              {form.cwsn === 'Yes' ? (
                <select value={form.impairment_type}
                  onChange={e => set('impairment_type', e.target.value)} className={sel(false)}>
                  <option value="">Select impairment</option>
                  {IMPAIRMENTS.map(i => <option key={i}>{i}</option>)}
                </select>
              ) : (
                <select disabled className={disabledInp}>
                  <option>Not Applicable</option>
                </select>
              )}
            </Field>
          </FieldRow>

          {/* Row 4: Disability Certificate | Disability % */}
          <FieldRow>
            <Field label="Disability Certificate">
              {form.cwsn === 'Yes' ? (
                <div className="flex items-center gap-2">
                  <YesNo value={form.disability_certificate}
                    onChange={v => set('disability_certificate', v)} />
                  <UploadBtn onUpload={async () => { const p = await pickDocFile(); if(p) set('disability_cert_doc', p); }} value={form.disability_cert_doc} />
                </div>
              ) : (
                <YesNo value="No" disabled />
              )}
            </Field>
            <Field label="Disability Percentage (%)">
              {form.cwsn === 'Yes' ? (
                <input value={form.disability_percentage}
                  onChange={e => set('disability_percentage', e.target.value.replace(/[^\d.]/g,''))}
                  placeholder="e.g. 40" className={inp(false)} />
              ) : (
                <input disabled value="" placeholder="N/A" className={disabledInp} />
              )}
            </Field>
          </FieldRow>

        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end pb-4">
        <button onClick={handleSave}
          className="bg-blue-700 hover:bg-blue-800 text-white font-medium px-10 py-3 rounded-xl text-sm">
          Save &amp; Continue →
        </button>
      </div>
    </div>
  );
}


// ── Confirmation Dialog ───────────────────────────────────────
function ConfirmDialog({ generalData, enrollmentData, onConfirm, onCancel }) {
  const fields = [
    { key: 'class',   label: 'Class',          value: enrollmentData.class_of_admission },
    { key: 'name',    label: 'Name of Student', value: generalData.student_name },
    { key: 'gender',  label: 'Gender',          value: generalData.gender === 'M' ? 'Male' : generalData.gender === 'F' ? 'Female' : generalData.gender },
    { key: 'father',  label: "Father's Name",   value: generalData.father_name },
    { key: 'mother',  label: "Mother's Name",   value: generalData.mother_name || 'Not Provided' },
    { key: 'dob',     label: 'Date of Birth',   value: generalData.date_of_birth },
    { key: 'aadhar',  label: 'Aadhar Number',   value: generalData.aadhar_number || 'Not Provided' },
  ];

  const [checked, setChecked] = React.useState({});
  const allChecked = fields.every(f => checked[f.key]);

  const toggle = (key) => setChecked(c => ({ ...c, [key]: !c[key] }));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

        {/* Header */}
        <div className="bg-blue-700 px-6 py-4">
          <h3 className="text-white font-bold text-lg">Confirm Admission Details</h3>
          <p className="text-blue-200 text-xs mt-0.5">
            Please verify and check each field before submitting.
          </p>
        </div>

        {/* Fields with checkboxes */}
        <div className="px-6 py-4 space-y-2">
          {!allChecked && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
              ⚠️ Please check all boxes to confirm the details are correct.
            </p>
          )}
          {fields.map(f => (
            <label key={f.key}
              className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors
                ${checked[f.key] ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'}`}>
              <div className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-colors
                ${checked[f.key] ? 'bg-green-600 border-green-600' : 'border-gray-300 bg-white'}`}
                onClick={() => toggle(f.key)}>
                {checked[f.key] && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <div className="flex-1 flex justify-between items-center">
                <span className="text-sm text-gray-500 w-36">{f.label}</span>
                <span className={`text-sm font-semibold ${checked[f.key] ? 'text-green-800' : 'text-gray-800'}`}>
                  {f.value || '—'}
                </span>
              </div>
            </label>
          ))}
        </div>

        <p className="text-xs text-gray-400 text-center px-6 pb-2">
          The above information cannot be changed after confirmation without admin access.
        </p>

        {/* Actions */}
        <div className="flex gap-3 px-6 pb-5">
          <button onClick={onCancel}
            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl text-sm">
            ← Go Back
          </button>
          <button onClick={onConfirm} disabled={!allChecked}
            className={`flex-1 font-medium py-2.5 rounded-xl text-sm transition-colors
              ${allChecked
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            {allChecked ? '✅ Confirm & Submit' : 'Check all fields first'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// STEP 2 — Enrollment Details
// ══════════════════════════════════════════════════════════════
function Step2({ generalData, admissionNumber, onSubmit, onBack, saving, initialData, onDataChange }) {
  const [form, setForm]       = useState(initialData || BLANK_ENROLLMENT);
  const [errors, setErrors]   = useState({});
  const [showConfirm, setShowConfirm] = useState(false);

  const set = (k, v) => {
    const updated = { ...form, [k]: v };
    setForm(updated);
    setErrors(e => ({ ...e, [k]: '' }));
    if (onDataChange) onDataChange(updated);
  };

  const pickDoc = async (field) => {
    const path = await window.api.pickFile([{ name: 'Documents', extensions: ['pdf','jpg','jpeg','png'] }]);
    if (path) set(field, path);
  };

  const cls              = form.class_of_admission;
  const isNursery        = cls === 'Nursery';
  const studiedElsewhere = form.studied_elsewhere === 'Yes';
  const show9Plus        = isClass9Plus(cls);
  const show11Plus       = isClass11Plus(cls);

  // Disable logic for Admission Details rows
  // Everything below "studied elsewhere" question is disabled unless:
  // class is not Nursery AND studied_elsewhere = Yes
  const disabledBelowRow3 = isNursery || !studiedElsewhere;

  const validate = () => {
    const e = {};
    if (!form.class_of_admission) e.class_of_admission = 'Required';
    if (!form.date_of_admission)  e.date_of_admission  = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    setShowConfirm(true); // show confirmation dialog before submitting
  };
  const handleConfirmed = () => {
    setShowConfirm(false);
    onSubmit(form);
  };

  // Disabled row wrapper — greys out and blocks interaction
  const DisabledRow = ({ disabled, children }) => (
    <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>
      {children}
    </div>
  );

  const FieldRow = ({ children }) => (
    <div className="grid grid-cols-2 gap-x-8 gap-y-4">{children}</div>
  );
  const Field = ({ label, required, error, children }) => (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
    </div>
  );
  const UploadBtn = ({ field, value }) => (
    <div className="flex gap-2 mt-1">
      <button type="button" onClick={() => pickDoc(field)}
        className="text-xs border border-blue-300 text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg flex items-center gap-1">
        📎 {value ? 'Change' : 'Upload'}
      </button>
      {value && <span className="text-xs text-green-600">✓ {value.split(/[\\/]/).pop()}</span>}
    </div>
  );

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-800 mb-1">New Admission</h2>
      <p className="text-sm text-gray-500 mb-6">Step 2 of 2 — Enrollment Profile for {generalData.student_name}</p>

      {/* ══ 1. ADMISSION-CUM-ENROLLMENT NUMBER ══ */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-700">Admission-cum-Enrollment Number</h3>
          <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            Pending admin approval
          </span>
        </div>
        <div className="p-5 space-y-4">

          {/* Row 1: Temp number | PEN */}
          <FieldRow>
            <Field label="Admission-cum-Enrollment Number">
              <p className="text-xl font-bold font-mono text-amber-600 py-1">{admissionNumber}</p>
              <p className="text-xs text-gray-400 mt-0.5">Converted to permanent after admin approval.</p>
            </Field>
            <Field label="PEN Number">
              <input value={form.pen_number}
                onChange={e => set('pen_number', e.target.value)}
                placeholder="11-digit Permanent Education Number"
                className={inp(false)} />
            </Field>
          </FieldRow>

          {/* Row 2: APAAR ID | RTE (+ amount inline if Yes) */}
          <FieldRow>
            <Field label="APAAR ID">
              <input value={form.apaar_id}
                onChange={e => set('apaar_id', e.target.value)}
                placeholder="Leave blank if not generated"
                className={inp(false)} />
            </Field>
            <Field label="Admitted under Section 12C of RTE Act?">
              <div className="flex items-center gap-4 flex-wrap">
                <YesNo value={form.rte_section_12c} onChange={v => set('rte_section_12c', v)} />
                {form.rte_section_12c === 'Yes' && (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-gray-500 whitespace-nowrap">Amount (₹)</span>
                    <input value={form.rte_amount_claimed}
                      onChange={e => set('rte_amount_claimed', e.target.value.replace(/[^\d.]/g,''))}
                      placeholder="Amount" className={`${inp(false)} w-28`} />
                  </div>
                )}
              </div>
            </Field>
          </FieldRow>

        </div>
      </div>

      {/* ══ 2. ADMISSION DETAILS ══ */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
        <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
          <h3 className="text-sm font-semibold text-gray-700">Admission Details</h3>
        </div>
        <div className="p-5 space-y-5">

          {/* Row 0: Academic Year selection */}
          <FieldRow>
            <Field label="Academic Year">
              <select value={form.academic_year}
                onChange={e => set('academic_year', e.target.value)} className={sel(false)}>
                {ADMISSION_YEARS.map(y => <option key={y}>{y}</option>)}
              </select>
            </Field>
            <div className="flex items-center bg-blue-50 border border-blue-200 rounded-xl px-4 py-2">
              <p className="text-xs text-blue-700">
                <strong>Select 2025-26</strong> for last year's students.<br/>
                Select <strong>2026-27</strong> for new students joining this year.
              </p>
            </div>
          </FieldRow>

          {/* Row 1: Date of Admission | Class */}
          <FieldRow>
            <Field label="Date of Admission (DD-MM-YYYY)" required error={errors.date_of_admission}>
              <input type="date" value={toInputDate(form.date_of_admission)}
                onChange={e => set('date_of_admission', fromInputDate(e.target.value))}
                className={inp(errors.date_of_admission)} />
            </Field>
            <Field label="Class" required error={errors.class_of_admission}>
              <select value={form.class_of_admission}
                onChange={e => {
                  const updated = { ...form,
                    class_of_admission: e.target.value,
                    language_group: '', academic_stream: '', subject_group: '',
                  };
                  setForm(updated);
                  setErrors(err => ({ ...err, class_of_admission: '' }));
                  if (onDataChange) onDataChange(updated);
                }}
                className={sel(errors.class_of_admission)}>
                <option value="">Select class</option>
                {CLASSES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </FieldRow>

          {/* Row 2: Section | Medium of Instruction */}
          <FieldRow>
            <Field label="Section">
              <select value={form.section} onChange={e => set('section', e.target.value)} className={sel(false)}>
                {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Medium of Instruction">
              <select value={form.medium_of_instruction}
                onChange={e => set('medium_of_instruction', e.target.value)} className={sel(false)}>
                {MEDIUMS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </FieldRow>

          {/* Row 3: Studied elsewhere | TC Submitted (TC hidden for Nursery) */}
          <FieldRow>
            <Field label="Whether studied in other school in previous academic year?">
              <YesNo value={form.studied_elsewhere} onChange={v => set('studied_elsewhere', v)} />
            </Field>
            {!isNursery && (
              <div className={disabledBelowRow3 ? 'opacity-40 pointer-events-none' : ''}>
                <Field label="TC Submitted?">
                  <div className="flex items-center gap-2">
                    <YesNo value={form.tc_submitted} onChange={v => set('tc_submitted', v)} />
                    {form.tc_submitted === 'Yes' && <UploadBtn field="tc_doc" value={form.tc_doc} />}
                  </div>
                </Field>
              </div>
            )}
          </FieldRow>

          <div className="border-t border-gray-100" />

          {/* Row 4: Status in previous year | Class passed — disabled for Nursery */}
          <DisabledRow disabled={disabledBelowRow3}>
            <FieldRow>
              <Field label="Status in Previous Year">
                <select value={form.prev_year_status}
                  onChange={e => set('prev_year_status', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  <option value="Pass">Pass</option>
                  <option value="Fail">Fail</option>
                  <option value="Not Applicable">Not Applicable</option>
                </select>
              </Field>
              <Field label="Class Passed in Previous Year">
                <select value={form.prev_year_class}
                  onChange={e => set('prev_year_class', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {CLASSES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </FieldRow>
          </DisabledRow>

          {/* Row 5: Prev enrollment number | Prev academic year — disabled for Nursery or not studied elsewhere */}
          <DisabledRow disabled={disabledBelowRow3}>
            <FieldRow>
              <Field label="Previous Enrollment Number">
                <input value={form.prev_enrollment_number}
                  onChange={e => set('prev_enrollment_number', e.target.value)}
                  placeholder="Enrollment number from previous school"
                  className={inp(false)} />
              </Field>
              <Field label="Previous Academic Year">
                <input value={form.prev_academic_year}
                  onChange={e => set('prev_academic_year', e.target.value)}
                  placeholder="e.g. 2024-25" className={inp(false)} />
              </Field>
            </FieldRow>
          </DisabledRow>

          {/* Row 6: Previous school name — disabled for Nursery or not studied elsewhere */}
          <DisabledRow disabled={disabledBelowRow3}>
            <Field label="Previous School Name">
              <input value={form.prev_school_name}
                onChange={e => set('prev_school_name', e.target.value)}
                placeholder="Full name of previous school"
                className={inp(false)} />
            </Field>
          </DisabledRow>

        </div>
      </div>

      {/* ══ 3. SUBJECTS & STREAM — Class 9+ only ══ */}
      {show9Plus && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-5">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-gray-700">Subjects &amp; Stream</h3>
            <p className="text-xs text-gray-400 mt-0.5">Class 9 and above</p>
          </div>
          <div className="p-5 space-y-4">
            <FieldRow>
              <Field label="Language Group">
                <select value={form.language_group}
                  onChange={e => set('language_group', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>
              {show11Plus && (
                <Field label="Academic Stream">
                  <select value={form.academic_stream}
                    onChange={e => set('academic_stream', e.target.value)} className={sel(false)}>
                    <option value="">Select</option>
                    {STREAMS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              )}
            </FieldRow>
            {show11Plus && (
              <FieldRow>
                <Field label="Subject Group">
                  <select value={form.subject_group}
                    onChange={e => set('subject_group', e.target.value)} className={sel(false)}>
                    <option value="">Select</option>
                    {SUBJECT_GROUPS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </Field>
              </FieldRow>
            )}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pb-8">
        <button onClick={onBack}
          className="text-sm text-gray-500 hover:text-gray-700 underline">
          ← Back to General Info
        </button>
        <button onClick={handleSubmit} disabled={saving}
          className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-10 py-3 rounded-xl text-sm flex items-center gap-2">
          {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '✅ Submit Admission'}
        </button>
      </div>

      {/* Confirmation dialog */}
      {showConfirm && (
        <ConfirmDialog
          generalData={generalData}
          enrollmentData={form}
          onConfirm={handleConfirmed}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN — orchestrates the two steps
// ══════════════════════════════════════════════════════════════
export default function Admission() {
  const [step,            setStep]           = useState(1);
  const [generalData,     setGeneralData]    = useState(null);
  const [enrollmentData,  setEnrollmentData] = useState(null);
  const [admissionNumber, setAdmissionNumber] = useState('');
  const [saving,          setSaving]         = useState(false);
  const [success,         setSuccess]        = useState(null);

  // Allow free switching between steps during development
  const handleStepClick = (n) => {
    if (n === 2 && !generalData) return; // can't go to step 2 without saving step 1 first
    setStep(n);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleStep1Save = async (data) => {
    setGeneralData(data);
    // Generate preview admission number in BPS format
    // Actual number is assigned on final submit — this is just for display
    const now         = new Date();
    const sessionYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const previewSeq  = String(Math.floor(Math.random() * 9000) + 1000);
    setAdmissionNumber(`BPS${sessionYear}-${previewSeq} (preview)`);
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (enrollmentData) => {
    setSaving(true);

    // Build address string
    const g = generalData;
    const result = await window.api.addStudent({
      // General
      student_name:          g.student_name,
      gender:                g.gender,
      date_of_birth:         g.date_of_birth,
      father_name:           g.father_name,
      mother_name:           g.mother_name,
      guardian_name:         g.guardian_name,
      aadhar_number:         g.aadhar_number.replace(/\s/g,''),
      nationality:           g.indian_nationality === 'Yes' ? 'Indian' : 'Other',
      birth_cert_submitted:  g.birth_cert,
      house_no:              g.house_no,
      village:               g.village,
      post:                  g.post,
      district:              g.district,
      state_name:            g.state_name,
      pin_code:              g.pin_code,
      mobile_number:         g.mobile_number,
      alternate_mobile:      g.alternate_mobile,
      contact_email:         g.contact_email,
      mother_tongue:         g.mother_tongue,
      caste:                 g.caste,
      religion:              g.religion,
      category:              g.category,
      minority_group:        g.minority_group,
      bpl_beneficiary:       g.bpl_beneficiary,
      ews_disadvantaged:     g.ews_disadvantaged,
      cwsn:                  g.cwsn,
      impairment_type:       g.cwsn === 'Yes' ? g.impairment_type : '',
      disability_certificate:g.cwsn === 'Yes' ? g.disability_certificate : 'No',
      disability_percentage: g.cwsn === 'Yes' ? g.disability_percentage : '',
      blood_group:           g.blood_group,
      father_profession:     g.father_profession,
      mother_profession:     g.mother_profession,
      // Enrollment
      date_of_admission:     generalData.date_of_admission || enrollmentData.date_of_admission,
      class_of_admission:    enrollmentData.class_of_admission,
      current_class:         enrollmentData.class_of_admission,
      section:               enrollmentData.section,
      academic_year:         enrollmentData.academic_year,
      medium_of_instruction: enrollmentData.medium_of_instruction,
      language_group:        enrollmentData.language_group,
      academic_stream:       enrollmentData.academic_stream,
      subject_group:         enrollmentData.subject_group,
      pen_number:             enrollmentData.pen_number             || '',
      apaar_id:               enrollmentData.apaar_id               || '',
      rte_section_12c:        enrollmentData.rte_section_12c        || 'No',
      rte_amount_claimed:     enrollmentData.rte_section_12c === 'Yes' ? (enrollmentData.rte_amount_claimed || '') : '',
      date_of_admission:      enrollmentData.date_of_admission,
      class_of_admission:     enrollmentData.class_of_admission,
      current_class:          enrollmentData.class_of_admission,
      section:                enrollmentData.section                || 'A',
      medium_of_instruction:  enrollmentData.medium_of_instruction  || 'English',
      studied_elsewhere:      enrollmentData.studied_elsewhere      || 'No',
      tc_submitted:           enrollmentData.tc_submitted           || 'No',
      tc_doc:                 enrollmentData.tc_doc                 || '',
      prev_year_status:       enrollmentData.prev_year_status       || '',
      prev_year_class:        enrollmentData.prev_year_class        || '',
      prev_enrollment_number: enrollmentData.prev_enrollment_number || '',
      prev_academic_year:     enrollmentData.prev_academic_year     || '',
      prev_school_name:       enrollmentData.studied_elsewhere === 'Yes' ? (enrollmentData.prev_school_name || '') : '',
      language_group:         enrollmentData.language_group         || '',
      academic_stream:        enrollmentData.academic_stream        || '',
      subject_group:          enrollmentData.subject_group          || '',
      student_status:        'PENDING',
    });

    setSaving(false);

    if (result.success) {
      setSuccess({ admission_number: result.admission_number });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const reset = () => {
    setStep(1);
    setGeneralData(null);
    setEnrollmentData(null);
    setAdmissionNumber('');
    setSuccess(null);
  };

  // ── Success screen ──────────────────────────────────────────
  if (success) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-6xl mb-6">🎉</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Admission Successful!</h2>
        <p className="text-gray-500 mb-6">{generalData?.student_name} has been admitted.</p>
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6 text-left">
          <div className="flex justify-between items-center">
            <span className="text-sm text-green-700">Admission Number</span>
            <span className="font-mono font-bold text-green-800 text-xl">{success.admission_number}</span>
          </div>
        </div>
        <button onClick={reset}
          className="bg-blue-700 hover:bg-blue-800 text-white font-medium px-8 py-3 rounded-xl text-sm">
          + Admit Another Student
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <StepBar step={step} onStepClick={handleStepClick} />
      {step === 1 && <Step1 onSave={handleStep1Save} initialData={generalData} />}
      {step === 2 && (
        <Step2
          key={admissionNumber || 'new'}
          generalData={generalData}
          admissionNumber={admissionNumber}
          onSubmit={handleSubmit}
          onBack={() => { setStep(1); window.scrollTo({ top:0, behavior:'smooth' }); }}
          saving={saving}
          initialData={enrollmentData}
          onDataChange={setEnrollmentData}
        />
      )}
    </div>
  );
}
