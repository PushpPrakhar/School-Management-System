// Homework.jsx — Teachers log classwork/homework given per class/date/
// subject/chapter. One list row per subject already defined for the class
// (Subjects & Chapters, managed by Principal). A row can be left blank if
// nothing was given in that subject that day.

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

const todayInput = () => new Date().toISOString().slice(0, 10);
const toDisplayDate = (iso) => { // YYYY-MM-DD -> DD-MM-YYYY
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

function DayStatusBanner({ status }) {
  if (!status) return null;
  if (status.working) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 mb-4">
        ✓ School is open on this date.
      </div>
    );
  }
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 mb-4">
      ⚠️ School is closed on this date — <strong>{status.reason}</strong>. You can still log homework if needed (e.g. a make-up class).
    </div>
  );
}

// ── One list row, fixed to a single subject ──────────────────────
function SubjectRow({ subject, entry, chapters, onChange }) {
  return (
    <div className="grid grid-cols-12 gap-4 items-start px-4 py-4">
      <div className="col-span-12 sm:col-span-2 sm:pt-2">
        <span className="text-sm font-semibold text-gray-800">{subject.subject_name}</span>
      </div>
      <div className="col-span-12 sm:col-span-2">
        <select value={entry.chapter_id} onChange={e => onChange({ ...entry, chapter_id: e.target.value ? Number(e.target.value) : '' })}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">{chapters.length === 0 ? 'No chapters yet' : 'Select chapter'}</option>
          {chapters.map(c => <option key={c.chapter_id} value={c.chapter_id}>{c.chapter_name}</option>)}
        </select>
      </div>
      <div className="col-span-12 sm:col-span-4">
        <textarea value={entry.classwork} onChange={e => onChange({ ...entry, classwork: e.target.value })} rows={1}
          placeholder="Classwork done — leave blank if none"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
      <div className="col-span-12 sm:col-span-4">
        <textarea value={entry.remarks} onChange={e => onChange({ ...entry, remarks: e.target.value })} rows={1}
          placeholder="Homework given — leave blank if none"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>
    </div>
  );
}

// ── Daily Report — teacher's own reference view, NOT printable ──
function DailyReportModal({ selectedClass, displayDate, teacherName, dayStatus, subjects, entries, chaptersBySubject, absentStudents, onClose }) {
  const filledRows = subjects.filter(s => {
    const e = entries[s.subject_id];
    return e && (e.chapter_id || (e.classwork || '').trim() || (e.remarks || '').trim());
  });
  const chapterName = (subjectId, chapterId) =>
    chapterId ? ((chaptersBySubject[subjectId] || []).find(c => c.chapter_id === chapterId)?.chapter_name || '—') : '—';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          {/* Letterhead — matches the fee receipt's, no print styling since this view is deliberately not printable */}
          <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
            <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
            <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
            <h2 className="text-lg font-bold mt-2 tracking-wide">DAILY CLASSWORK AND HOMEWORK {displayDate}</h2>
          </div>

          {/* Info grid — same layout convention as the receipt's, adapted to this context */}
          <table className="w-full text-xs border border-gray-400 border-collapse mb-4">
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-1.5 font-semibold w-20 bg-gray-50">Class</td>
                <td className="border border-gray-400 px-2 py-1.5">{selectedClass}</td>
                <td className="border border-gray-400 px-2 py-1.5 font-semibold w-24 bg-gray-50">Class Teacher</td>
                <td className="border border-gray-400 px-2 py-1.5">{teacherName}</td>
              </tr>
            </tbody>
          </table>

          {/* Subject / Chapter / Classwork / Homework table */}
          <table className="w-full text-xs border border-gray-400 border-collapse mb-4">
            <thead>
              <tr className="bg-gray-50">
                <th className="border border-gray-400 px-2 py-1.5 text-left w-24">Subject</th>
                <th className="border border-gray-400 px-2 py-1.5 text-left w-28">Chapter</th>
                <th className="border border-gray-400 px-2 py-1.5 text-left">Classwork</th>
                <th className="border border-gray-400 px-2 py-1.5 text-left">Homework</th>
              </tr>
            </thead>
            <tbody>
              {filledRows.length === 0 ? (
                <tr><td colSpan={4} className="border border-gray-400 px-2 py-4 text-center text-gray-400">Nothing logged for this date yet.</td></tr>
              ) : filledRows.map(s => (
                <tr key={s.subject_id}>
                  <td className="border border-gray-400 px-2 py-1.5 font-medium">{s.subject_name}</td>
                  <td className="border border-gray-400 px-2 py-1.5">{chapterName(s.subject_id, entries[s.subject_id].chapter_id)}</td>
                  <td className="border border-gray-400 px-2 py-1.5">{entries[s.subject_id].classwork || '—'}</td>
                  <td className="border border-gray-400 px-2 py-1.5">{entries[s.subject_id].remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Absent Students */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Absent Students {absentStudents.length > 0 ? `(${absentStudents.length})` : ''}
            </p>
            {absentStudents.length === 0 ? (
              <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                No absences recorded for this date, or attendance hasn't been marked yet.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {absentStudents.map(s => (
                  <span key={s.admission_number} className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
                    {s.student_name}{s.section ? ` (${s.section})` : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-gray-100 p-4 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const blankEntry = () => ({ chapter_id: '', classwork: '', remarks: '' });

export default function Homework() {
  const { user } = useAuth();
  const myClasses = user?.classes || [];

  const [selectedClass, setSelectedClass] = useState(myClasses.length === 1 ? myClasses[0] : '');
  const [date,        setDate]        = useState(todayInput());
  const [subjects,    setSubjects]    = useState([]);
  const [chaptersBySubject, setChaptersBySubject] = useState({}); // { [subject_id]: [{chapter_id, chapter_name}] }
  const [entries,     setEntries]     = useState({}); // { [subject_id]: { chapter_id, classwork, remarks } }
  const [dayStatus,   setDayStatus]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const [saved,       setSaved]       = useState(false);
  const [showReport,  setShowReport]  = useState(false);
  const [absentStudents, setAbsentStudents] = useState([]);

  const displayDate = toDisplayDate(date);

  const loadDayStatus = useCallback(async () => {
    const [, mm, yyyy] = displayDate.split('-'); // DD-MM-YYYY
    const res = await window.api.calendarGetMonth(CURRENT_ACADEMIC_YEAR(), mm, yyyy);
    const dt = new Date(date + 'T00:00:00');
    if (dt.getDay() === 0) { setDayStatus({ working: false, reason: 'Sunday' }); return; }
    if (res.success) {
      const entry = res.data.find(d => d.date === displayDate);
      if (entry && entry.day_type !== 'WORKING') {
        const labels = { HOLIDAY: 'Holiday', VACATION: 'Vacation', HALF_DAY: 'Half Day' };
        setDayStatus({ working: false, reason: entry.event_name || labels[entry.day_type] || entry.day_type });
        return;
      }
    }
    setDayStatus({ working: true });
  }, [date, displayDate]);

  const loadHomework = useCallback(async () => {
    if (!selectedClass || !date) return;
    setLoading(true); setError(''); setSaved(false);
    const [subRes, hwRes, absentRes] = await Promise.all([
      window.api.subjectsGetAll(selectedClass),
      window.api.homeworkGetForDate(user?.user_id, selectedClass, displayDate),
      window.api.attendanceGetAbsentByDate(selectedClass, displayDate, user?.user_id),
    ]);
    const subjectList = subRes.success ? subRes.data : [];
    setSubjects(subjectList);
    setAbsentStudents(absentRes.success ? absentRes.data : []);

    // Fetch chapters for every subject once here — shared by each row's
    // dropdown and the Daily Report modal's chapter-name lookup, instead
    // of each row fetching (and each report re-deriving) its own copy.
    const chapterResults = await Promise.all(subjectList.map(s => window.api.chaptersGetAll(s.subject_id)));
    const chaptersMap = {};
    subjectList.forEach((s, i) => { chaptersMap[s.subject_id] = chapterResults[i].success ? chapterResults[i].data : []; });
    setChaptersBySubject(chaptersMap);

    setLoading(false);

    // One entry per subject — blank by default, overlaid with whatever's
    // already been saved for this class+date.
    const initial = {};
    subjectList.forEach(s => { initial[s.subject_id] = blankEntry(); });
    if (hwRes.success) {
      hwRes.data.forEach(h => { initial[h.subject_id] = { chapter_id: h.chapter_id || '', classwork: h.classwork || '', remarks: h.remarks || '' }; });
    }
    setEntries(initial);
    loadDayStatus();
  }, [selectedClass, date, displayDate, user, loadDayStatus]);

  useEffect(() => { loadHomework(); }, [loadHomework]);

  const updateEntry = (subjectId, newEntry) => setEntries(es => ({ ...es, [subjectId]: newEntry }));

  const save = async () => {
    setError(''); setSaved(false);
    if (!selectedClass) { setError('Select a class first.'); return; }

    // A subject gets saved if it has a chapter, classwork, or homework
    // text — not chapter alone. Some subjects (Hindi, Hindi Grammar) may
    // never get chapters written up, and a teacher should still be able
    // to log classwork/homework for them.
    const toSave = subjects
      .filter(s => {
        const e = entries[s.subject_id];
        return e && (e.chapter_id || (e.classwork || '').trim() || (e.remarks || '').trim());
      })
      .map(s => ({
        subject_id: s.subject_id, chapter_id: entries[s.subject_id].chapter_id || null,
        classwork: entries[s.subject_id].classwork, remarks: entries[s.subject_id].remarks,
      }));

    if (toSave.length === 0) { setError('Fill in classwork, homework, or a chapter for at least one subject before saving.'); return; }

    setSaving(true);
    const res = await window.api.homeworkSave(user?.user_id, selectedClass, displayDate, toSave);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Homework</h2>
          <p className="text-sm text-gray-500 mt-0.5">Log the classwork and homework given to your class each day.</p>
        </div>
        {selectedClass && (
          <button onClick={() => setShowReport(true)} className="text-sm text-blue-700 hover:underline font-medium">
            📄 View Daily Report
          </button>
        )}
      </div>

      {/* Class + Date selector */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
          <select value={selectedClass} onChange={e => setSelectedClass(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40">
            <option value="">Select</option>
            {myClasses.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} max={todayInput()}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {!selectedClass ? (
        <p className="text-sm text-gray-400 text-center py-10">Select a class to begin.</p>
      ) : loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
      ) : (
        <>
          <DayStatusBanner status={dayStatus} />

          {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600 mb-4">{error}</div>}
          {saved && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-700 mb-4">✓ Homework saved.</div>}

          {subjects.length === 0 ? (
            <p className="text-sm text-gray-400 bg-gray-50 border border-gray-200 border-dashed rounded-xl px-4 py-6 text-center">
              No subjects have been set up for {selectedClass} yet. Ask your Principal to add subjects for this class.
            </p>
          ) : (
            <>
              <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100">
                <div className="hidden sm:grid grid-cols-12 gap-4 px-4 py-2 bg-gray-50 rounded-t-2xl">
                  <span className="col-span-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Subject</span>
                  <span className="col-span-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Chapter</span>
                  <span className="col-span-4 text-xs font-semibold text-gray-400 uppercase tracking-wide">Classwork</span>
                  <span className="col-span-4 text-xs font-semibold text-gray-400 uppercase tracking-wide">Homework</span>
                </div>
                {subjects.map(s => (
                  <SubjectRow key={s.subject_id} subject={s} entry={entries[s.subject_id] || blankEntry()}
                    chapters={chaptersBySubject[s.subject_id] || []}
                    onChange={(e) => updateEntry(s.subject_id, e)} />
                ))}
              </div>

              <div className="flex justify-end mt-5">
                <button onClick={save} disabled={saving}
                  className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
                  {saving ? 'Saving…' : '💾 Save Homework'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {showReport && (
        <DailyReportModal selectedClass={selectedClass} displayDate={displayDate} teacherName={user?.full_name || user?.username}
          dayStatus={dayStatus} subjects={subjects} entries={entries} chaptersBySubject={chaptersBySubject}
          absentStudents={absentStudents} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}

// Same academic-year convention used across the app
function CURRENT_ACADEMIC_YEAR() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
}
