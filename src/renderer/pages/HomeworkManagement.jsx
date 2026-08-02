// HomeworkManagement.jsx — Principal/Director: manage Subjects (per class)
// and Chapters (per subject), and view every teacher's logged homework
// with date-range/class/teacher/subject filters.

import React, { useState, useEffect, useCallback } from 'react';

const CLASSES = ['Nursery','LKG','UKG','Class 1','Class 2','Class 3','Class 4','Class 5',
                  'Class 6','Class 7','Class 8','Class 9','Class 10','Class 11','Class 12'];

const todayInput = () => new Date().toISOString().slice(0, 10);
const toDisplayDate = (iso) => { const [y,m,d] = iso.split('-'); return `${d}-${m}-${y}`; };
const monthAgoInput = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); };

// ── Chapter Table-of-Contents editor for one subject ────────────
function ChapterEditor({ subjectId, onClose }) {
  const [names,   setNames]   = useState(['']);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [warning, setWarning] = useState('');
  const [saved,   setSaved]   = useState(false);

  useEffect(() => {
    setLoading(true);
    window.api.chaptersGetAll(subjectId).then(res => {
      setLoading(false);
      if (res.success && res.data.length > 0) setNames(res.data.map(c => c.chapter_name));
      else setNames(['']);
    });
  }, [subjectId]);

  const updateName = (i, val) => setNames(ns => ns.map((n, idx) => idx === i ? val : n));
  const addRow = () => setNames(ns => [...ns, '']);
  const removeRow = (i) => setNames(ns => ns.filter((_, idx) => idx !== i));

  const save = async () => {
    setError(''); setWarning(''); setSaved(false);
    const cleaned = names.map(n => n.trim()).filter(Boolean);
    if (cleaned.length === 0) { setError('Add at least one chapter before saving.'); return; }
    setSaving(true);
    const res = await window.api.chaptersSaveAll(subjectId, cleaned);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setNames(cleaned);
    if (res.warning) setWarning(res.warning);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  if (loading) return <p className="text-xs text-gray-400 py-3">Loading chapters…</p>;

  return (
    <div className="bg-gray-50 px-4 py-3 border-t border-gray-100">
      <p className="text-xs font-semibold text-gray-400 mb-2">Table of Contents</p>

      {error   && <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-600 mb-2">{error}</div>}
      {warning && <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700 mb-2">{warning}</div>}
      {saved   && <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 mb-2">✓ Saved.</div>}

      <div className="space-y-2 mb-3">
        {names.map((name, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-400 w-16 shrink-0">Chapter {i + 1}:</span>
            <input value={name} onChange={e => updateName(i, e.target.value)}
              placeholder="Chapter name"
              className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {names.length > 1 && (
              <button onClick={() => removeRow(i)} className="text-xs text-red-500 hover:underline shrink-0">Remove</button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={addRow} className="px-3 py-1.5 border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 rounded-lg text-xs font-medium">
          + Add Chapter
        </button>
        <button onClick={save} disabled={saving}
          className="px-4 py-1.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg text-xs font-medium">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Subjects & Chapters tab ──────────────────────────────────
function SubjectsTab() {
  const [cls, setCls] = useState(CLASSES[0]);
  const [subjects, setSubjects] = useState([]);
  const [teachers, setTeachers] = useState([]);
  const [expanded, setExpanded] = useState(null); // subject_id
  const [newSubject, setNewSubject] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const rowRefs = React.useRef({});

  useEffect(() => {
    window.api.teachersGetAll().then(res => { if (res.success) setTeachers(res.data); });
  }, []);

  const loadSubjects = useCallback(async () => {
    setLoading(true);
    // Fills in the standard curriculum for this class if it's not there yet
    // (safe to call every time — never duplicates or resets customizations).
    await window.api.subjectsEnsureDefaults(cls);
    const res = await window.api.subjectsGetAll(cls);
    setLoading(false);
    if (res.success) setSubjects(res.data);
    setExpanded(null);
  }, [cls]);

  useEffect(() => { loadSubjects(); }, [loadSubjects]);

  const addSubject = async () => {
    setError('');
    if (!newSubject.trim()) return;
    const res = await window.api.subjectsCreate(cls, newSubject.trim());
    if (!res.success) { setError(res.message); return; }
    setNewSubject('');
    loadSubjects();
  };

  const deleteSubject = async (id) => {
    if (!window.confirm('Delete this subject and all its chapters?')) return;
    const res = await window.api.subjectsDelete(id);
    if (!res.success) { setError(res.message); return; }
    loadSubjects();
  };

  const assignTeacher = async (subjectId, teacherIdStr) => {
    setError('');
    const res = await window.api.subjectsAssignTeacher(subjectId, teacherIdStr ? Number(teacherIdStr) : null);
    if (!res.success) { setError(res.message); return; }
    loadSubjects();
  };

  // Jumping to a subject via the dropdown expands it and scrolls it into view.
  const jumpToSubject = (subjectIdStr) => {
    if (!subjectIdStr) return;
    const subjectId = Number(subjectIdStr);
    setExpanded(subjectId);
    setTimeout(() => rowRefs.current[subjectId]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40">
            {CLASSES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
          <select value={expanded || ''} onChange={e => jumpToSubject(e.target.value)} disabled={loading || subjects.length === 0}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-48 disabled:bg-gray-50 disabled:text-gray-400">
            <option value="">{subjects.length === 0 ? 'No subjects yet' : 'Jump to a subject…'}</option>
            {subjects.map(s => <option key={s.subject_id} value={s.subject_id}>{s.subject_name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-600 mb-4">{error}</div>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
        {loading ? (
          <p className="text-center text-gray-400 py-8 text-sm">Loading…</p>
        ) : subjects.length === 0 ? (
          <p className="text-center text-gray-400 py-8 text-sm">No subjects for {cls} yet — add one below.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {subjects.map(s => (
              <div key={s.subject_id} ref={el => rowRefs.current[s.subject_id] = el}>
                <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2">
                  <button onClick={() => setExpanded(expanded === s.subject_id ? null : s.subject_id)}
                    className="text-sm font-medium text-gray-800 flex items-center gap-2">
                    <span className={`transition-transform ${expanded === s.subject_id ? 'rotate-90' : ''}`}>▶</span>
                    {s.subject_name}
                  </button>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Subject Teacher:</span>
                      <select value={s.teacher_id || ''} onChange={e => assignTeacher(s.subject_id, e.target.value)}
                        className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="">Unassigned</option>
                        {teachers.map(t => <option key={t.user_id} value={t.user_id}>{t.full_name}</option>)}
                      </select>
                    </div>
                    <button onClick={() => deleteSubject(s.subject_id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                {expanded === s.subject_id && <ChapterEditor subjectId={s.subject_id} />}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <input value={newSubject} onChange={e => setNewSubject(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addSubject()}
          placeholder={`New subject for ${cls}`}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={addSubject} className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-medium">
          + Add Subject
        </button>
      </div>
    </div>
  );
}

// ── Oversight tab ─────────────────────────────────────────────
function OversightTab() {
  const [fromDate, setFromDate] = useState(monthAgoInput());
  const [toDate,   setToDate]   = useState(todayInput());
  const [cls,      setCls]      = useState('');
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.homeworkGetAll({
      from_date: fromDate ? toDisplayDate(fromDate) : null,
      to_date:   toDate   ? toDisplayDate(toDate)   : null,
      class: cls || null,
    });
    setLoading(false);
    if (res.success) setRows(res.data);
  }, [fromDate, toDate, cls]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} max={todayInput()}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
          <p className="text-center text-gray-400 py-10 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-gray-400 py-10 text-sm">No homework logged in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Date','Class','Subject Teacher','Subject','Chapter','Classwork','Homework'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr key={r.entry_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{r.date}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{r.class}</td>
                  <td className="px-4 py-2.5 text-gray-600">{r.teacher_name}</td>
                  <td className="px-4 py-2.5"><span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{r.subject_name}</span></td>
                  <td className="px-4 py-2.5 text-gray-600">{r.chapter_name}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate" title={r.classwork}>{r.classwork || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate" title={r.remarks}>{r.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function HomeworkManagement() {
  const [tab, setTab] = useState('subjects');
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Homework Management</h2>
        <p className="text-sm text-gray-500 mt-0.5">Manage subjects/chapters and review homework logged by teachers.</p>
      </div>
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[['subjects','📚 Subjects & Chapters'],['oversight','📋 Review Homework']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'subjects'  && <SubjectsTab />}
      {tab === 'oversight' && <OversightTab />}
    </div>
  );
}
