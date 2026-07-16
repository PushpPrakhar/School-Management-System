// EditStudent.jsx — mirrors admission form exactly
// Search → load student → edit General Profile + Enrollment Profile → save

import React, { useState, useEffect } from 'react';

// ── Date conversion helpers ──────────────────────────────────
// Handles: DD-MM-YYYY | YYYY-MM-DD | DD/MM/YYYY | Excel serial numbers
const toInput = (v) => {
  if (!v || v === '00-00-0000' || v === '0000-00-00' || v === '') return '';
  const s = String(v).trim();

  // Excel serial number (pure integer like 43661)
  if (/^\d{4,5}$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30 + parseInt(s)));
    const yy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

  // DD-MM-YYYY (from Excel text cells / our storage format)
  const hyph = s.split('-');
  if (hyph.length === 3 && hyph[2]?.length === 4)
    return `${hyph[2]}-${hyph[1]}-${hyph[0]}`;

  // DD/MM/YYYY (slash format)
  const slash = s.split('/');
  if (slash.length === 3 && slash[2]?.length === 4)
    return `${slash[2]}-${slash[1]}-${slash[0]}`;

  // Already YYYY-MM-DD
  if (hyph.length === 3 && hyph[0]?.length === 4) return s;

  return ''; // unrecognised — show empty
};

const fromInput = (v) => {
  if (!v) return '';
  const p = String(v).split('-');
  // YYYY-MM-DD → DD-MM-YYYY
  if (p.length === 3 && p[0]?.length === 4) return `${p[2]}-${p[1]}-${p[0]}`;
  return v;
};

// ── Constants ─────────────────────────────────────────────────
const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                 'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];
const CLASS_ORDER = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
  'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10,
  'Class 9':11,'Class 10':12,'Class 11':13,'Class 12':14 };
const isClass9Plus  = c => (CLASS_ORDER[c] ?? -1) >= 11;
const isClass11Plus = c => (CLASS_ORDER[c] ?? -1) >= 13;

const VILLAGES = ['BADAULI','BALRAU','BHURA BADAULI','DANWAR',
  'DUSHHERA','DUSHHERI','ISHAN PUR','JAWAL',
  'KAMALPUR','KATHPURA','KHURJA','KYOLI',
  'MADHKOLA','MAHMUDPUR','MANSOORPUR','MEERPUR',
  'NAGLA SHERPUR','NAGLAKAT','NAYABAS NAYSER','NAYSER',
  'ROHINDA','SHAHVAJ PUR','SHERPUR NAYSER','THANGORA',
  'TIKRI','OTHER'];
const CASTES         = ['Badhai','Banjara','Brahmin','Chamar','Dhobi','Dhimar',
  'Gaderia','Gujjar','Jaat','Jatav','Khatik','Kori','Kumhar','Muslim',
  'Nai','Rajput','Teli','Vaishya','Valmiki','Yadav'];
const RELIGIONS      = ['Hindu','Muslim','Sikh','Christian','Jain','Buddhist','Others'];
// Category values must match exactly what's stored in DB
const MINORITY_GROUPS= ['Not Applicable','Muslim','Christian','Sikh','Buddhist','Parsi','Jain'];
const BLOOD_GROUPS   = ['A+','A-','B+','B-','O+','O-','AB+','AB-'];
const MEDIUMS        = ['Hindi','English','Urdu','Sanskrit'];
const LANGUAGES      = ['Hindi','English','Sanskrit','Urdu','Punjabi','Mathematics'];
const STREAMS        = ['Science','Commerce','Arts / Humanities','Vocational'];
const SUBJECT_GROUPS = ['PCM (Physics, Chemistry, Maths)','PCB (Physics, Chemistry, Biology)',
  'PCMB (Physics, Chemistry, Maths & Biology)','Commerce with Maths',
  'Commerce without Maths','Arts / Humanities','Vocational'];
const IMPAIRMENTS    = ['Blindness','Low Vision','Deaf','Hard of Hearing','Locomotor Disability',
  'Cerebral Palsy','Intellectual Disability','Specific Learning Disabilities (SLD)',
  'Autism Spectrum Disorder (ASD)','Mental Illness','Speech and Language Disability',
  'Multiple Disabilities','Multiple Disabilities including Deaf-Blindness',
  'Chronic Neurological Conditions','Muscular Dystrophy','Dwarfism','Acid Attack Victim',
  'Thalassemia','Hemophilia','Sickle Cell Disease','Leprosy Cured',"Parkinson's Disease",'Other'];
const MOTHER_PROFS   = ['Housewife','Service','Others'];
const FATHER_PROFS   = ['Farmer','Service','Mazdoori','Others'];

// ── UI helpers ────────────────────────────────────────────────
const MISSING = (v) => !v || ['NOT PROVIDED','NOT APPLICABLE','999999999999',
  '11111111111','00-00-0000','0000-00-00',''].includes(String(v).trim());

const inp = (highlight) =>
  `w-full border ${highlight ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
   rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`;
const sel = (highlight) =>
  `w-full border ${highlight ? 'border-blue-400 bg-blue-50' : 'border-gray-300'}
   rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white`;
const disabled_inp =
  `w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed`;

function Label({ text, required }) {
  return (
    <label className="block text-xs font-medium text-gray-600 mb-1">
      {text}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}
function Card({ title, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
      <div className="bg-gray-50 border-b border-gray-200 px-5 py-3">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
function Row({ children }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-4">{children}</div>;
}
function Field({ label, required, children }) {
  return (
    <div>
      <Label text={label} required={required} />
      {children}
    </div>
  );
}
function YesNo({ value, onChange, disabled: dis }) {
  return (
    <div className="flex gap-4 mt-1">
      {['Yes','No'].map(v => (
        <label key={v} className={`flex items-center gap-1.5 text-sm cursor-pointer ${dis ? 'opacity-40' : ''}`}>
          <input type="radio" value={v} checked={value === v}
            onChange={() => !dis && onChange(v)} className="accent-blue-600" disabled={dis} />
          {v}
        </label>
      ))}
    </div>
  );
}
function UploadBtn({ value, onClick }) {
  return (
    <div className="flex gap-2 mt-1 items-center">
      <button type="button" onClick={onClick}
        className="text-xs border border-blue-300 text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg">
        📎 {value ? 'Change' : 'Upload'}
      </button>
      {value && <span className="text-xs text-green-600 truncate max-w-40">✓ {value.split(/[\\/]/).pop()}</span>}
    </div>
  );
}

// ── General Profile tab ───────────────────────────────────────
function GeneralTab({ form, set, pickDoc }) {
  const cwsn = form.cwsn === 'Yes';
  return (
    <div>
      {/* Student Identity */}
      <Card title="Student Identity">
        <div className="space-y-4">
          <Row>
            <Field label="Student's Full Name" required>
              <input value={form.student_name || ''} onChange={e => set('student_name', e.target.value.toUpperCase())}
                className={inp(MISSING(form.student_name))} />
            </Field>
            <Field label="Gender" required>
              <select value={form.gender || ''} onChange={e => set('gender', e.target.value)} className={sel(MISSING(form.gender))}>
                <option value="">Select</option>
                <option value="M">Male</option><option value="F">Female</option><option value="Other">Other / Transgender</option>
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Date of Birth">
              <input type="date" value={toInput(form.date_of_birth)} onChange={e => set('date_of_birth', fromInput(e.target.value))}
                className={inp(MISSING(form.date_of_birth))} />
            </Field>
            <Field label="Indian Nationality">
              <input value={form.indian_nationality || ''} onChange={e => set('indian_nationality', e.target.value)}
                placeholder="e.g. Yes / Indian" className={inp(MISSING(form.indian_nationality))} />
            </Field>
          </Row>
          <Row>
            <Field label="Blood Group">
              <select value={form.blood_group || ''} onChange={e => set('blood_group', e.target.value)} className={sel(MISSING(form.blood_group))}>
                <option value="">Select</option>
                {BLOOD_GROUPS.map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="Mother Tongue">
              <select value={form.mother_tongue || ''} onChange={e => set('mother_tongue', e.target.value)} className={sel(false)}>
                {['Hindi','Urdu','Punjabi','Sanskrit','English','Other'].map(l => <option key={l}>{l}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Aadhar Number">
              <input value={form.aadhar_number || ''} maxLength={12}
                onChange={e => set('aadhar_number', e.target.value.replace(/\D/g,'').slice(0,12))}
                className={inp(MISSING(form.aadhar_number))} />
              <UploadBtn value={form.aadhar_doc} onClick={() => pickDoc('aadhar_doc')} />
            </Field>
            <Field label="Birth Certificate">
              <div className="flex items-center gap-2">
                <YesNo value={form.birth_cert || 'No'} onChange={v => set('birth_cert', v)} />
                <UploadBtn value={form.birth_cert_doc} onClick={() => pickDoc('birth_cert_doc')} />
              </div>
            </Field>
          </Row>
        </div>
      </Card>

      {/* Parents / Guardian */}
      <Card title="Parents / Guardian">
        <div className="space-y-4">
          <Row>
            <Field label="Father's Name" required>
              <input value={form.father_name || ''} onChange={e => set('father_name', e.target.value.toUpperCase())}
                className={inp(MISSING(form.father_name))} />
            </Field>
            <Field label="Profession">
              <select value={form.father_profession || ''} onChange={e => set('father_profession', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                {FATHER_PROFS.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Mother's Name">
              <input value={form.mother_name || ''} onChange={e => set('mother_name', e.target.value.toUpperCase())}
                className={inp(MISSING(form.mother_name))} />
            </Field>
            <Field label="Profession">
              <select value={form.mother_profession || ''} onChange={e => set('mother_profession', e.target.value)} className={sel(false)}>
                <option value="">Select</option>
                {MOTHER_PROFS.map(p => <option key={p}>{p}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Guardian's Name">
              <input value={form.guardian_name || ''} onChange={e => set('guardian_name', e.target.value.toUpperCase())}
                placeholder="If different from parents" className={inp(false)} />
            </Field>
            <Field label="Contact Email">
              <input type="email" value={form.contact_email || ''} onChange={e => set('contact_email', e.target.value)}
                className={inp(false)} />
            </Field>
          </Row>
          <Row>
            <Field label="Mobile Number">
              <input value={form.mobile_number || ''} maxLength={10}
                onChange={e => set('mobile_number', e.target.value.replace(/\D/g,'').slice(0,10))}
                className={inp(MISSING(form.mobile_number))} />
            </Field>
            <Field label="Alternate Mobile">
              <input value={form.alternate_mobile || ''} maxLength={10}
                onChange={e => set('alternate_mobile', e.target.value.replace(/\D/g,'').slice(0,10))}
                className={inp(false)} />
            </Field>
          </Row>
        </div>
      </Card>

      {/* Address */}
      <Card title="Address">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-x-6 gap-y-4">
            <Field label="House No. / Street">
              <input value={form.house_no || ''} onChange={e => set('house_no', e.target.value)}
                className={inp(MISSING(form.house_no))} />
            </Field>
            <Field label="Village" required>
              <select value={form.village || ''} onChange={e => set('village', e.target.value)}
                className={sel(MISSING(form.village))}>
                <option value="">Select village</option>
                {VILLAGES.map(v => <option key={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Post (Post Office)">
              <input value={form.post || ''} onChange={e => set('post', e.target.value)}
                className={inp(MISSING(form.post))} />
            </Field>
            <Field label="District">
              <input value={form.district || ''} onChange={e => set('district', e.target.value)}
                className={inp(false)} />
            </Field>
            <Field label="State">
              <input value={form.state_name || ''} onChange={e => set('state_name', e.target.value)}
                className={inp(false)} />
            </Field>
            <Field label="Pin Code">
              <input value={form.pin_code || ''} maxLength={6}
                onChange={e => set('pin_code', e.target.value.replace(/\D/g,'').slice(0,6))}
                className={inp(false)} />
            </Field>
          </div>
        </div>
      </Card>

      {/* Social Details */}
      <Card title="Social Details">
        <div className="space-y-4">
          <Row>
            <Field label="Caste">
              <select value={form.caste || ''} onChange={e => set('caste', e.target.value)}
                className={sel(MISSING(form.caste))}>
                <option value="">Select</option>
                {CASTES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Religion">
              <select value={form.religion || ''} onChange={e => set('religion', e.target.value)} className={sel(MISSING(form.religion))}>
                <option value="">Select</option>
                {RELIGIONS.map(r => <option key={r}>{r}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Social Category">
              <select value={form.category || ''} onChange={e => set('category', e.target.value)} className={sel(MISSING(form.category))}>
                <option value="">Select</option>
                <option value="GENERAL">General (GEN)</option>
                <option value="OBC">OBC</option>
                <option value="SC">SC</option>
                <option value="ST">ST</option>
              </select>
            </Field>
            <Field label="Minority Group">
              <select value={form.minority_group || ''} onChange={e => set('minority_group', e.target.value)} className={sel(false)}>
                {MINORITY_GROUPS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="BPL Beneficiary">
              <YesNo value={form.bpl_beneficiary || 'No'} onChange={v => set('bpl_beneficiary', v)} />
            </Field>
            <Field label="EWS / Disadvantaged Group">
              <YesNo value={form.ews_disadvantaged || 'No'} onChange={v => set('ews_disadvantaged', v)} />
            </Field>
          </Row>
          <Row>
            <Field label="CWSN">
              <YesNo value={form.cwsn || 'No'} onChange={v => set('cwsn', v)} />
            </Field>
            <Field label="Type of Impairment">
              {cwsn ? (
                <select value={form.impairment_type || ''} onChange={e => set('impairment_type', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {IMPAIRMENTS.map(i => <option key={i}>{i}</option>)}
                </select>
              ) : <select disabled className={disabled_inp}><option>Not Applicable</option></select>}
            </Field>
          </Row>
          <Row>
            <Field label="Disability Certificate">
              {cwsn
                ? <div className="flex items-center gap-2">
                    <YesNo value={form.disability_certificate || 'No'} onChange={v => set('disability_certificate', v)} />
                    <UploadBtn value={form.disability_cert_doc} onClick={() => pickDoc('disability_cert_doc')} />
                  </div>
                : <YesNo value="No" disabled />}
            </Field>
            <Field label="Disability Percentage (%)">
              {cwsn
                ? <input value={form.disability_percentage || ''} onChange={e => set('disability_percentage', e.target.value.replace(/[^\d.]/g,''))}
                    placeholder="e.g. 40" className={inp(false)} />
                : <input disabled value="" placeholder="N/A" className={disabled_inp} />}
            </Field>
          </Row>
        </div>
      </Card>
    </div>
  );
}

// ── Enrollment Profile tab ────────────────────────────────────
function DisabledRow({ disabled, children }) {
  return <div className={disabled ? 'opacity-40 pointer-events-none' : ''}>{children}</div>;
}

function EnrollmentTab({ form, set, pickDoc }) {
  const cls              = form.current_class || '';
  const show9Plus        = isClass9Plus(cls);
  const show11Plus       = isClass11Plus(cls);
  const isNursery        = cls === 'Nursery';
  const studiedElsewhere = form.studied_elsewhere === 'Yes';
  const disabledBelow    = isNursery || !studiedElsewhere;

  return (
    <div>
      {/* Admission-cum-Enrollment Number */}
      <Card title="Admission-cum-Enrollment Number">
        <div className="space-y-4">
          <Row>
            <Field label="Admission Number">
              <div className="flex items-center gap-3">
                <p className="text-xl font-bold font-mono text-blue-700 py-1">{form.admission_number}</p>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Permanent</span>
              </div>
            </Field>
            <Field label="PEN Number">
              <input value={form.pen_number || ''} onChange={e => set('pen_number', e.target.value.replace(/\D/g,'').slice(0,11))} maxLength={11}
                placeholder="11-digit PEN" className={inp(MISSING(form.pen_number))} />
            </Field>
          </Row>
          <Row>
            <Field label="APAAR ID">
              <input value={form.apaar_id || ''} onChange={e => set('apaar_id', e.target.value.replace(/\D/g,'').slice(0,12))} maxLength={12}
                placeholder="Leave blank if not generated" className={inp(false)} />
            </Field>
            <Field label="Admitted under Section 12C of RTE Act?">
              <div className="flex items-center gap-4 flex-wrap">
                <YesNo value={form.rte_section_12c || 'No'} onChange={v => set('rte_section_12c', v)} />
                {form.rte_section_12c === 'Yes' && (
                  <div className="flex items-center gap-2 flex-1">
                    <span className="text-xs text-gray-500 whitespace-nowrap">Amount (₹)</span>
                    <input value={form.rte_amount_claimed || ''} onChange={e => set('rte_amount_claimed', e.target.value.replace(/[^\d.]/g,''))}
                      placeholder="Amount" className={`${inp(false)} w-28`} />
                  </div>
                )}
              </div>
            </Field>
          </Row>
        </div>
      </Card>

      {/* Admission Details */}
      <Card title="Admission Details">
        <div className="space-y-5">
          <Row>
            <Field label="Date of Admission">
              <input type="date" value={toInput(form.date_of_admission)} onChange={e => set('date_of_admission', fromInput(e.target.value))}
                className={inp(MISSING(form.date_of_admission))} />
            </Field>
            <Field label="Current Class" required>
              <select value={form.current_class || ''} onChange={e => set('current_class', e.target.value)} className={sel(MISSING(form.current_class))}>
                <option value="">Select</option>
                {CLASSES.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Section">
              <select value={form.section || 'A'} onChange={e => set('section', e.target.value)} className={sel(false)}>
                {['A','B','C','D'].map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Medium of Instruction">
              <select value={form.medium_of_instruction || 'English'} onChange={e => set('medium_of_instruction', e.target.value)} className={sel(false)}>
                {MEDIUMS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </Row>

          {/* Studied elsewhere + TC */}
          <Row>
            <Field label="Studied in other school previously?">
              <YesNo value={form.studied_elsewhere || 'No'} onChange={v => set('studied_elsewhere', v)} />
            </Field>
            {!isNursery && (
              <Field label="TC Submitted?">
                <div className={`flex items-center gap-2 ${disabledBelow ? 'opacity-40 pointer-events-none' : ''}`}>
                  <YesNo value={form.tc_submitted || 'No'} onChange={v => set('tc_submitted', v)} />
                  {form.tc_submitted === 'Yes' && <UploadBtn value={form.tc_doc} onClick={() => pickDoc('tc_doc')} />}
                </div>
              </Field>
            )}
          </Row>

          <div className="border-t border-gray-100 pt-2" />

          {/* Previous year — disabled for Nursery */}
          <DisabledRow disabled={disabledBelow}>
            <Row>
              <Field label="Status in Previous Year">
                <select value={form.prev_year_status || ''} onChange={e => set('prev_year_status', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  <option value="Pass">Pass</option><option value="Fail">Fail</option>
                  <option value="Not Applicable">Not Applicable</option>
                </select>
              </Field>
              <Field label="Class Passed in Previous Year">
                <select value={form.prev_year_class || ''} onChange={e => set('prev_year_class', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {CLASSES.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </Row>
          </DisabledRow>

          {/* Previous school — disabled if not studied elsewhere */}
          <DisabledRow disabled={disabledBelow}>
            <Row>
              <Field label="Previous Enrollment Number">
                <input value={form.prev_enrollment_number || ''} onChange={e => set('prev_enrollment_number', e.target.value.toUpperCase())}
                  className={inp(false)} />
              </Field>
              <Field label="Previous Academic Year">
                <input value={form.prev_academic_year || ''} onChange={e => set('prev_academic_year', e.target.value.toUpperCase())}
                  placeholder="e.g. 2024-25" className={inp(false)} />
              </Field>
            </Row>
          </DisabledRow>

          <DisabledRow disabled={disabledBelow}>
            <Field label="Previous School Name">
              <input value={form.prev_school_name || ''} onChange={e => set('prev_school_name', e.target.value.toUpperCase())}
                className={inp(false)} />
            </Field>
          </DisabledRow>
        </div>
      </Card>

      {/* Subjects & Stream — Class 9+ only */}
      {show9Plus && (
        <Card title="Subjects & Stream">
          <div className="space-y-4">
            <Row>
              <Field label="Language Group">
                <select value={form.language_group || ''} onChange={e => set('language_group', e.target.value)} className={sel(false)}>
                  <option value="">Select</option>
                  {LANGUAGES.map(l => <option key={l}>{l}</option>)}
                </select>
              </Field>
              {show11Plus && (
                <Field label="Academic Stream">
                  <select value={form.academic_stream || ''} onChange={e => set('academic_stream', e.target.value)} className={sel(false)}>
                    <option value="">Select</option>
                    {STREAMS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              )}
            </Row>
            {show11Plus && (
              <Row>
                <Field label="Subject Group">
                  <select value={form.subject_group || ''} onChange={e => set('subject_group', e.target.value)} className={sel(false)}>
                    <option value="">Select</option>
                    {SUBJECT_GROUPS.map(g => <option key={g}>{g}</option>)}
                  </select>
                </Field>
              </Row>
            )}
          </div>
        </Card>
      )}

      {/* Academic year + status */}
      <Card title="System Details">
        <Row>
          <Field label="Academic Year">
            <input value={form.academic_year || ''} onChange={e => set('academic_year', e.target.value)}
              placeholder="e.g. 2025-26" className={inp(false)} />
          </Field>
          <Field label="Student Status">
            <select value={form.student_status || 'ACTIVE'} onChange={e => set('student_status', e.target.value)} className={sel(false)}>
              <option value="ACTIVE">Active</option>
              <option value="DROPBOX/TC">DROPBOX/TC</option>
              <option value="DROPBOX-MID SESSION">DROPBOX-MID SESSION</option>
              <option value="PENDING">Pending Approval</option>
            </select>
          </Field>
        </Row>
      </Card>
    </div>
  );
}



// ── Global History Tab (all students) ────────────────────────
function GlobalHistoryTab() {
  const [history,  setHistory]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [filter,   setFilter]   = useState('');

  useEffect(() => {
    window.api.getAllEditHistory().then(res => {
      if (res.success) setHistory(res.data);
      setLoading(false);
    });
  }, []);

  const filtered = filter.trim()
    ? history.filter(h =>
        h.student_name.toLowerCase().includes(filter.toLowerCase()) ||
        h.admission_number.toLowerCase().includes(filter.toLowerCase()) ||
        h.edited_by.toLowerCase().includes(filter.toLowerCase())
      )
    : history;

  if (loading) return (
    <div className="text-center py-12 text-gray-400">Loading edit history…</div>
  );

  if (history.length === 0) return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">📋</div>
      <p className="font-medium text-gray-600">No edit history yet</p>
      <p className="text-sm text-gray-400 mt-1">
        Changes made through Edit Student will appear here.
      </p>
    </div>
  );

  return (
    <div>
      {/* Search filter */}
      <div className="mb-4">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value.toUpperCase())}
          placeholder="Filter by student name, admission no., or edited by…"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <p className="text-xs text-gray-400 mb-3">
        {filtered.length} edit{filtered.length !== 1 ? 's' : ''}
        {filter ? ` matching "${filter}"` : ' total'}
      </p>

      <div className="space-y-2">
        {filtered.map(h => (
          <div key={h.history_id}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden">

            {/* Row header */}
            <button
              onClick={() => setExpanded(expanded === h.history_id ? null : h.history_id)}
              className="w-full flex items-center gap-4 px-5 py-3 hover:bg-gray-50 text-left">

              {/* Avatar */}
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center
                              justify-center text-xs font-bold shrink-0">
                {(h.edited_by || 'U')[0].toUpperCase()}
              </div>

              {/* Student info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-800 truncate">{h.student_name}</p>
                <p className="text-xs text-gray-400">
                  <span className="font-mono">{h.admission_number}</span>
                  {' · '}Edited by <span className="font-medium text-gray-600">{h.edited_by}</span>
                </p>
              </div>

              {/* Meta */}
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-500">{h.edited_at?.slice(0,16).replace('T',' ')}</p>
                <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200
                                 px-2 py-0.5 rounded-full mt-0.5 inline-block">
                  {h.changes.length} change{h.changes.length !== 1 ? 's' : ''}
                </span>
              </div>

              <span className="text-gray-300 text-xs ml-2">
                {expanded === h.history_id ? '▲' : '▼'}
              </span>
            </button>

            {/* Expanded changes */}
            {expanded === h.history_id && (
              <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-b border-gray-200">
                      <th className="text-left py-1.5 font-medium w-44">Field</th>
                      <th className="text-left py-1.5 font-medium">Previous Value</th>
                      <th className="text-center py-1.5 font-medium w-8">→</th>
                      <th className="text-left py-1.5 font-medium">New Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.changes.map((c, i) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1.5 text-xs font-medium text-gray-500">{c.field}</td>
                        <td className="py-1.5">
                          <span className="bg-red-50 text-red-500 px-2 py-0.5 rounded text-xs line-through">
                            {c.old || '—'}
                          </span>
                        </td>
                        <td className="py-1.5 text-center text-gray-300 text-xs">→</td>
                        <td className="py-1.5">
                          <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded text-xs font-medium">
                            {c.new || '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── History Tab ───────────────────────────────────────────────
function HistoryTab({ admissionNumber }) {
  const [history, setHistory]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    window.api.getStudentEditHistory(admissionNumber).then(res => {
      if (res.success) setHistory(res.data);
      setLoading(false);
    });
  }, [admissionNumber]);

  if (loading) return (
    <div className="text-center py-12 text-gray-400">Loading history…</div>
  );

  if (history.length === 0) return (
    <div className="text-center py-16">
      <div className="text-4xl mb-3">📋</div>
      <p className="font-medium text-gray-600">No edit history yet</p>
      <p className="text-sm text-gray-400 mt-1">
        Changes made through Edit Student will appear here.
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">{history.length} edit{history.length !== 1 ? 's' : ''} recorded</p>
      {history.map(h => (
        <div key={h.history_id}
          className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {/* Event header */}
          <button
            onClick={() => setExpanded(expanded === h.history_id ? null : h.history_id)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 text-left">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-sm">
                ✏️
              </div>
              <div>
                <p className="text-sm font-medium text-gray-800">
                  Edited by <span className="font-semibold">{h.edited_by}</span>
                </p>
                <p className="text-xs text-gray-400">{h.edited_at}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-2 py-0.5 rounded-full">
                {h.changes.length} field{h.changes.length !== 1 ? 's' : ''} changed
              </span>
              <span className="text-gray-400 text-xs">
                {expanded === h.history_id ? '▲' : '▼'}
              </span>
            </div>
          </button>

          {/* Expanded changes list */}
          {expanded === h.history_id && (
            <div className="border-t border-gray-100 px-5 py-3 bg-gray-50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-200">
                    <th className="text-left py-2 font-medium w-40">Field</th>
                    <th className="text-left py-2 font-medium">Previous Value</th>
                    <th className="text-left py-2 font-medium w-6"></th>
                    <th className="text-left py-2 font-medium">New Value</th>
                  </tr>
                </thead>
                <tbody>
                  {h.changes.map((c, i) => (
                    <tr key={i} className="border-b border-gray-100 last:border-0">
                      <td className="py-2 font-medium text-gray-600">{c.field}</td>
                      <td className="py-2">
                        <span className="bg-red-50 text-red-600 px-2 py-0.5 rounded text-xs line-through">
                          {c.old || '—'}
                        </span>
                      </td>
                      <td className="py-2 text-gray-300 text-center">→</td>
                      <td className="py-2">
                        <span className="bg-green-50 text-green-700 px-2 py-0.5 rounded text-xs font-medium">
                          {c.new || '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function EditStudent() {
  const [homeTab,    setHomeTab]    = useState('search');
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [searching,  setSearching]  = useState(false);
  const [original,   setOriginal]   = useState(null);
  const [form,       setForm]       = useState(null);
  const [activeTab,  setActiveTab]  = useState('general');
  const [historyKey, setHistoryKey] = useState(0); // refreshes history on save
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [error,      setError]      = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await window.api.searchStudents(query);
    setSearching(false);
    if (res.success) setResults(res.data);
  };

  const loadStudent = async (s) => {
    // Always fetch fresh complete record from DB — never use stale search result
    const res = await window.api.getStudent(s.admission_number);
    const data = res.success ? res.data : s; // fallback to search result if fetch fails
    setOriginal(data);
    setForm({ ...data });
    setResults([]);
    setQuery('');
    setSaved(false);
    setError('');
    setActiveTab('general');
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const pickDoc = async (field) => {
    const path = await window.api.pickFile([{ name:'Documents', extensions:['pdf','jpg','jpeg','png'] }]);
    if (path) set(field, path);
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    const res = await window.api.editStudent(form);
    setSaving(false);
    if (res.success) { setSaved(true); setOriginal({ ...form }); setHistoryKey(k => k+1); }
    else setError(res.message);
  };

  // ── Search screen ─────────────────────────────────────────
  if (!form) return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Edit Student Record</h2>
        <p className="text-sm text-gray-500 mt-0.5">Search a student to update their details</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 w-fit">
        {[['search','Search Student'],['history','Edit History']].map(([key, label]) => (
          <button key={key} onClick={() => setHomeTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${homeTab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Search tab */}
      {homeTab === 'search' && (
        <>
          <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-end mb-4">
            <div className="flex-1">
              <Label text="Search Student" />
              <input value={query} onChange={e => setQuery(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Name, Admission No., Father's Name…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <button onClick={search} disabled={searching}
              className="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50">
              {searching ? 'Searching…' : '🔍 Search'}
            </button>
          </div>

          {results.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {results.map(s => (
                <button key={s.admission_number} onClick={() => loadStudent(s)}
                  className="w-full flex items-center gap-4 px-4 py-3 border-b border-gray-100 hover:bg-blue-50 text-left last:border-0">
                  <div className="flex-1">
                    <p className="font-medium text-gray-800">{s.student_name}</p>
                    <p className="text-xs text-gray-500">
                      {s.admission_number} · {s.current_class} · Father: {s.father_name}
                    </p>
                  </div>
                  <span className="text-blue-500 text-xs font-medium">Edit →</span>
                </button>
              ))}
            </div>
          )}

          {results.length === 0 && query && !searching && (
            <p className="text-center text-gray-400 py-8">No students found for "{query}"</p>
          )}
        </>
      )}

      {/* Global history tab */}
      {homeTab === 'history' && <GlobalHistoryTab />}
    </div>
  );

  // ── Edit screen ───────────────────────────────────────────
  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800">{form.student_name}</h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="font-mono text-sm text-blue-700 font-semibold">{form.admission_number}</span>
            <span className="text-gray-300">·</span>
            <span className="text-sm text-gray-500">{form.current_class || form.class_of_admission}</span>
            <span className="text-gray-300">·</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
              ${form.student_status === 'ACTIVE'  ? 'bg-green-100 text-green-700' :
                form.student_status === 'PENDING' ? 'bg-amber-100 text-amber-700' :
                                                    'bg-red-100 text-red-600'}`}>
              {form.student_status}
            </span>
          </div>
        </div>

      </div>

      {/* Alerts */}
      {saved && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          ✅ Record updated successfully.
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 mb-4">
        💡 Fields highlighted in blue have missing or default values — fill them in to complete the record.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 w-fit">
        {[['general','General Profile'],['enrollment','Enrollment Profile'],['history','Edit History']].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${activeTab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'general'    && <GeneralTab    form={form} set={set} pickDoc={pickDoc} />}
      {activeTab === 'enrollment' && <EnrollmentTab form={form} set={set} pickDoc={pickDoc} />}
      {activeTab === 'history'    && <HistoryTab key={historyKey} admissionNumber={form.admission_number} />}

      {/* Save / Reset */}
      <div className="flex items-center justify-between pb-8">
        <button onClick={() => setForm({ ...original })}
          className="text-sm text-gray-400 hover:text-gray-600 underline">
          Reset changes
        </button>
        <div className="flex items-center gap-3">
          <button onClick={() => { setOriginal(null); setForm(null); }}
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium px-6 py-2.5 rounded-xl text-sm">
            ← Search again
          </button>
          <button onClick={handleSave} disabled={saving}
            className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2">
            {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '💾 Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
