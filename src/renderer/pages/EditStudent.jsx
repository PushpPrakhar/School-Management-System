// EditStudent.jsx
// Search student by admission number or name → load all fields → edit → save

import React, { useState } from 'react';

const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                 'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];
const RELIGIONS   = ['Hindu','Muslim','Sikh','Christian','Jain','Buddhist','Others'];
const CASTES      = ['Brahmin','Rajput','Bania','Kayastha','Yadav','Kurmi','Jat','Jatav',
                     'Gujar','Lodhi','Pasi','Chamar','Valmiki','Kori','Dhobi','Kumhar',
                     'Teli','Mali','Nai','Lohar','Sonkar','Prajapati','Muslim','Others'];
const DISTRICTS   = ['Bulandshahr','Aligarh','Gautam Buddha Nagar','Meerut',
                     'Hapur','Ghaziabad','Agra','Mathura','Bareilly','Others'];

const inp = (highlight) => `w-full border ${highlight ? 'border-blue-400 bg-blue-50' : 'border-gray-300'} rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`;
const sel = `w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white`;

function Label({ text }) {
  return <label className="block text-xs font-medium text-gray-600 mb-1">{text}</label>;
}
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

export default function EditStudent() {
  const [query,    setQuery]   = useState('');
  const [results,  setResults] = useState([]);
  const [searching,setSearching] = useState(false);
  const [student,  setStudent] = useState(null);   // original
  const [form,     setForm]    = useState(null);    // editable copy
  const [saving,   setSaving]  = useState(false);
  const [saved,    setSaved]   = useState(false);
  const [error,    setError]   = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await window.api.searchStudents(query);
    setSearching(false);
    if (res.success) setResults(res.data);
  };

  const loadStudent = (s) => {
    setStudent(s);
    setForm({ ...s });
    setResults([]);
    setQuery('');
    setSaved(false);
    setError('');
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Fields that were empty/default — highlight them to draw attention
  const isEmpty = (val) => !val || val === 'NOT PROVIDED' || val === 'NOT APPLICABLE'
    || val === '000000000000' || val === '99999999999' || val === '00-00-0000' || val === '';

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    const res = await window.api.editStudent(form);
    setSaving(false);
    if (res.success) { setSaved(true); setStudent({ ...form }); }
    else setError(res.message);
  };

  if (!form) return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Edit Student Record</h2>
        <p className="text-sm text-gray-500 mt-0.5">Search a student to view and update their details</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3 items-end mb-4">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Search Student</label>
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Name, Admission Number, or Father's Name…"
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
                <p className="text-xs text-gray-500">{s.admission_number} · SR #{s.sr_number} · {s.current_class} · Father: {s.father_name}</p>
              </div>
              <span className="text-blue-500 text-xs">Edit →</span>
            </button>
          ))}
        </div>
      )}

      {results.length === 0 && query && !searching && (
        <div className="text-center py-8 text-gray-400">
          <p>No students found for "{query}"</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Edit Student Record</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {form.student_name} · {form.admission_number} · SR #{form.sr_number}
          </p>
        </div>
        <button onClick={() => { setStudent(null); setForm(null); }}
          className="text-sm text-gray-400 hover:text-gray-600 underline">← Search again</button>
      </div>

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

      {/* Office info */}
      <Section title="Office Details">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><Label text="Date of Admission" /><input type="date" value={form.date_of_admission} onChange={e => set('date_of_admission', e.target.value)} className={inp(isEmpty(form.date_of_admission))} /></div>
          <div><Label text="Class of Admission" /><select value={form.class_of_admission} onChange={e => set('class_of_admission', e.target.value)} className={sel}><option value="">Select</option>{CLASSES.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><Label text="Current Class" /><select value={form.current_class} onChange={e => set('current_class', e.target.value)} className={sel}><option value="">Select</option>{CLASSES.map(c=><option key={c}>{c}</option>)}</select></div>
          <div><Label text="Academic Year" /><input value={form.academic_year} onChange={e => set('academic_year', e.target.value)} className={inp(false)} /></div>
          <div><Label text="Student Status" /><input value={form.student_status} onChange={e => set('student_status', e.target.value)} className={inp(isEmpty(form.student_status))} /></div>
          <div><Label text="RTE" /><select value={form.rte} onChange={e => set('rte', e.target.value)} className={sel}><option value="No">No</option><option value="Yes">Yes</option></select></div>
          {form.rte === 'Yes' && <div className="col-span-2"><Label text="RTE Details" /><input value={form.rte_details} onChange={e => set('rte_details', e.target.value)} className={inp(false)} /></div>}
        </div>
      </Section>

      {/* Student info */}
      <Section title="Student's Information">
        <div className="space-y-4">
          <div><Label text="Student's Full Name" /><input value={form.student_name} onChange={e => set('student_name', e.target.value.toUpperCase())} className={inp(isEmpty(form.student_name))} /></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><Label text="Gender" /><select value={form.gender} onChange={e => set('gender', e.target.value)} className={sel}><option value="">Select</option><option value="M">Male</option><option value="F">Female</option><option value="Other">Other</option></select></div>
            <div><Label text="Date of Birth" /><input type="date" value={form.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} className={inp(isEmpty(form.date_of_birth))} /></div>
            <div><Label text="Blood Group" /><select value={form.blood_group} onChange={e => set('blood_group', e.target.value)} className={sel}><option value="">Select</option>{['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(b=><option key={b}>{b}</option>)}</select></div>
            <div><Label text="Nationality" /><input value={form.nationality} onChange={e => set('nationality', e.target.value)} className={inp(isEmpty(form.nationality))} /></div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><Label text="Aadhar Number" /><input value={form.aadhar_number} onChange={e => set('aadhar_number', e.target.value.replace(/\D/g,'').slice(0,12))} maxLength={12} className={inp(isEmpty(form.aadhar_number))} /></div>
            <div><Label text="PEN Number" /><input value={form.pen_number} onChange={e => set('pen_number', e.target.value)} className={inp(isEmpty(form.pen_number))} /></div>
            <div><Label text="Religion" /><select value={form.religion} onChange={e => set('religion', e.target.value)} className={sel}><option value="">Select</option>{RELIGIONS.map(r=><option key={r}>{r}</option>)}</select></div>
            <div><Label text="Caste" /><select value={form.caste} onChange={e => set('caste', e.target.value)} className={sel}><option value="">Select</option>{CASTES.map(c=><option key={c}>{c}</option>)}</select></div>
            <div><Label text="Category" /><select value={form.category} onChange={e => set('category', e.target.value)} className={sel}><option value="">Select</option><option value="GEN">GEN</option><option value="OBC">OBC</option><option value="SC">SC</option><option value="ST">ST</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><Label text="Birth Document" /><input value={form.birth_document} onChange={e => set('birth_document', e.target.value)} placeholder="Birth Certificate / R-number" className={inp(isEmpty(form.birth_document))} /></div>
            <div><Label text="Birth Certificate Number" /><input value={form.birth_cert_number} onChange={e => set('birth_cert_number', e.target.value)} className={inp(isEmpty(form.birth_cert_number))} /></div>
          </div>
          {/* Address */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><Label text="House No." /><input value={form.house_no} onChange={e => set('house_no', e.target.value)} className={inp(isEmpty(form.house_no))} /></div>
            <div><Label text="Village" /><input value={form.village} onChange={e => set('village', e.target.value)} className={inp(isEmpty(form.village))} /></div>
            <div><Label text="Post" /><input value={form.post} onChange={e => set('post', e.target.value)} className={inp(isEmpty(form.post))} /></div>
            <div><Label text="District" /><select value={form.district} onChange={e => set('district', e.target.value)} className={sel}>{DISTRICTS.map(d=><option key={d}>{d}</option>)}</select></div>
            <div><Label text="State" /><input value={form.state_name} onChange={e => set('state_name', e.target.value)} className={inp(false)} /></div>
            <div><Label text="Pin Code" /><input value={form.pin_code} onChange={e => set('pin_code', e.target.value.replace(/\D/g,'').slice(0,6))} maxLength={6} className={inp(isEmpty(form.pin_code))} /></div>
          </div>
        </div>
      </Section>

      {/* Parents */}
      <Section title="Parent's Information">
        <div className="space-y-4">
          <div><Label text="Father's Full Name" /><input value={form.father_name} onChange={e => set('father_name', e.target.value.toUpperCase())} className={inp(isEmpty(form.father_name))} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><Label text="Father's Qualification" /><input value={form.father_qualification} onChange={e => set('father_qualification', e.target.value)} className={inp(false)} /></div>
            <div><Label text="Father's Profession" /><input value={form.father_profession} onChange={e => set('father_profession', e.target.value)} className={inp(false)} /></div>
            <div><Label text="Father's Phone" /><input value={form.father_phone} onChange={e => set('father_phone', e.target.value.replace(/\D/g,'').slice(0,10))} className={inp(isEmpty(form.father_phone))} /></div>
          </div>
          <div><Label text="Mother's Full Name" /><input value={form.mother_name} onChange={e => set('mother_name', e.target.value.toUpperCase())} className={inp(isEmpty(form.mother_name))} /></div>
          <div className="grid grid-cols-3 gap-4">
            <div><Label text="Mother's Qualification" /><input value={form.mother_qualification} onChange={e => set('mother_qualification', e.target.value)} className={inp(false)} /></div>
            <div><Label text="Mother's Profession" /><input value={form.mother_profession} onChange={e => set('mother_profession', e.target.value)} className={inp(false)} /></div>
            <div><Label text="Mother's Phone" /><input value={form.mother_phone} onChange={e => set('mother_phone', e.target.value.replace(/\D/g,'').slice(0,10))} className={inp(false)} /></div>
          </div>
        </div>
      </Section>

      {/* Save */}
      <div className="flex items-center justify-between pb-8">
        <button onClick={() => setForm({ ...student })} className="text-sm text-gray-400 hover:text-gray-600 underline">Reset changes</button>
        <button onClick={handleSave} disabled={saving}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-2.5 rounded-lg text-sm flex items-center gap-2">
          {saving ? <><span className="animate-spin">⏳</span> Saving…</> : '💾 Save Changes'}
        </button>
      </div>
    </div>
  );
}
