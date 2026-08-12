// StudentList.jsx
// Shows all students in a selected class for a given academic year.
// Features: search, PDF export, print, view student detail.

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../utils/AuthContext';

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

// Only show past and current academic years — never future
const CURRENT_SESSION_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1; // April onwards = new session
})();
const ACADEMIC_YEARS = Array.from({ length: 5 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 4 + i; // last 4 years + current
  return `${y}-${String(y + 1).slice(2)}`;
}).reverse(); // newest first

// Format date DD/MM/YYYY
function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

// ── Student detail modal ──────────────────────────────────────
function StudentModal({ student, onClose }) {
  if (!student) return null;

  const Row = ({ label, value }) => (
    <div className="flex py-2 border-b border-gray-100 last:border-0">
      <span className="w-44 text-xs font-medium text-gray-500 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-800">{value || '—'}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <div>
            <h3 className="font-bold text-gray-800 text-lg">{student.student_name}</h3>
            <p className="text-sm text-gray-500 font-mono">{student.admission_number}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl p-1">✕</button>
        </div>

        <div className="p-5 space-y-4">

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Personal</p>
            <Row label="Full Name"         value={student.student_name} />
            <Row label="Gender"            value={student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender} />
            <Row label="Date of Birth"     value={fmtDate(student.date_of_birth)} />
            <Row label="Blood Group"       value={student.blood_group} />
            <Row label="Aadhar Number"     value={student.aadhar_number} />
            <Row label="PEN Number"        value={student.pen_number} />
            <Row label="Religion"          value={student.religion} />
            <Row label="Caste / Category"  value={[student.caste, student.category].filter(Boolean).join(' / ')} />
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Admission</p>
            <Row label="Admission Number"  value={student.admission_number} />
            <Row label="Date of Admission" value={fmtDate(student.date_of_admission)} />
            <Row label="Class of Admission" value={student.class_of_admission} />
            <Row label="Current Class"     value={student.current_class} />
            <Row label="Academic Year"     value={student.academic_year} />
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Parents</p>
            <Row label="Father's Name"     value={student.father_name} />
            <Row label="Father's Phone"    value={student.father_phone} />
            <Row label="Mother's Name"     value={student.mother_name} />
            <Row label="Mother's Phone"    value={student.mother_phone} />
            <Row label="Address"           value={student.address} />
          </div>

          {student.prev_school_name && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Previous School</p>
              <Row label="School Name"     value={student.prev_school_name} />
              <Row label="SR Number"       value={student.prev_sr_number} />
            </div>
          )}

          {student.documents_submitted && (
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Documents Submitted</p>
              <div className="flex flex-wrap gap-2">
                {student.documents_submitted.split(',').map(d => (
                  <span key={d} className="bg-green-100 text-green-800 text-xs px-3 py-1 rounded-full">{d.trim()}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function StudentList() {
  const { user, canAccessSection } = useAuth();
  const isTeacher = user?.role === 'teacher';
  const canExportExcel = user?.role === 'admin' || user?.role === 'super_admin';
  const canViewAllClasses = user?.role === 'admin' || user?.role === 'super_admin';
  const allowedClasses = isTeacher ? (user.classes || []) : CLASSES;
  const SECTIONS = ['A', 'B', 'C', 'D'];

  const [selectedClass, setSelectedClass]     = useState('');
  const [selectedSection, setSelectedSection] = useState('');
  const [academicYear, setAcademicYear]       = useState(CURRENT_YEAR);
  const [students, setStudents]               = useState([]);
  const [loading, setLoading]                 = useState(false);
  const [searched, setSearched]               = useState(false);
  const [query, setQuery]                     = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [exportMsg, setExportMsg]             = useState('');

  const allowedSections = isTeacher && selectedClass && selectedClass !== 'ALL'
    ? SECTIONS.filter(s => canAccessSection(selectedClass, s))
    : SECTIONS;

  // Single-class teacher: skip the extra click.
  useEffect(() => {
    if (isTeacher && allowedClasses.length === 1 && !selectedClass) setSelectedClass(allowedClasses[0]);
  }, [isTeacher, allowedClasses, selectedClass]);

  // Section-scoped teacher with only one allowed section for this class —
  // same auto-select convenience already used in Attendance/Examination.
  useEffect(() => {
    if (isTeacher && selectedClass && selectedClass !== 'ALL' && allowedSections.length === 1 && selectedSection !== allowedSections[0]) {
      setSelectedSection(allowedSections[0]);
    }
  }, [isTeacher, selectedClass, allowedSections, selectedSection]);

  // Sections don't carry over between classes — reset when class changes.
  const changeClass = (cls) => { setSelectedClass(cls); setSelectedSection(''); };

  // Filtered list
  const filtered = students.filter(s => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      s.student_name?.toLowerCase().includes(q)    ||
      s.admission_number?.toLowerCase().includes(q) ||
      s.father_name?.toLowerCase().includes(q)
    );
  });

  const load = async () => {
    if (!selectedClass) return;
    setLoading(true);
    setSearched(true);
    const result = await window.api.getByClass(selectedClass, selectedSection, academicYear, user?.user_id); // academic_year now used for roll-number ordering when a single section is selected
    setLoading(false);
    if (result.success) setStudents(result.data);
    else { setStudents([]); }
  };

  // Reload when filters change (if already searched)
  useEffect(() => {
    if (searched) load();
  }, [selectedClass, selectedSection, academicYear]);

  // ── PDF Export ──────────────────────────────────────────────
  const classLabel = selectedClass === 'ALL'
    ? 'All Classes'
    : selectedSection ? `${selectedClass} - ${selectedSection}` : selectedClass;

  const exportPDF = async () => {
    try {
      setExportMsg('Generating PDF…');
      const { jsPDF } = await import('jspdf');
      const autoTable  = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Title
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(`Student List — ${classLabel} (${academicYear})`, 14, 15);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Students: ${filtered.length}   |   Generated: ${fmtDate(new Date().toISOString())}`, 14, 22);

      autoTable(doc, {
        startY: 27,
        head: [[
          '#', 'Adm. No.', 'Student Name', "Father's Name",
          'Gender', 'Date of Birth', 'Class', 'Phone', 'Category'
        ]],
        body: filtered.map((s, i) => [
          i + 1,
          s.admission_number,
          s.student_name,
          s.father_name,
          s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : s.gender,
          fmtDate(s.date_of_birth),
          s.current_class,
          s.father_phone || s.mother_phone || '—',
          s.category || '—',
        ]),
        styles:       { fontSize: 8, cellPadding: 2 },
        headStyles:   { fillColor: [29, 78, 216], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [239, 246, 255] },
        columnStyles: { 0: { cellWidth: 8 }, 1: { cellWidth: 22 } },
      });

      const fileClassPart = selectedClass === 'ALL' ? 'All_Classes' : selectedClass.replace(' ','') + (selectedSection ? '_' + selectedSection : '');
      doc.save(`StudentList_${fileClassPart}_${academicYear}.pdf`);
      setExportMsg('');
    } catch (err) {
      setExportMsg('PDF export failed: ' + err.message);
    }
  };

  // ── Excel Export (Principal/Director only) ────────────────────
  const exportExcel = async () => {
    setExportMsg('Saving Excel…');
    const res = await window.api.enrollmentExportClassListExcel(filtered, classLabel, academicYear);
    if (res.cancelled) { setExportMsg(''); return; }
    if (!res.success) { setExportMsg('Excel export failed: ' + res.message); return; }
    setExportMsg(`✓ Saved to ${res.filePath}`);
    setTimeout(() => setExportMsg(''), 5000);
  };

  // ── Print ────────────────────────────────────────────────────
  const handlePrint = () => {
    const showClassCol = selectedClass === 'ALL';
    const rows = filtered.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${s.admission_number}</td>
        <td>${s.student_name}</td>
        ${showClassCol ? `<td>${s.current_class}${s.section ? ' - ' + s.section : ''}</td>` : ''}
        <td>${s.father_name}</td>
        <td>${s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : s.gender}</td>
        <td>${fmtDate(s.date_of_birth)}</td>
        <td>${s.father_phone || s.mother_phone || '—'}</td>
        <td>${s.address || '—'}</td>
      </tr>`).join('');

    const html = `
      <html><head><title>Student List</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 20px; }
        h2 { margin-bottom: 4px; }
        p  { margin: 0 0 12px; color: #555; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #1d4ed8; color: white; padding: 6px 8px; text-align: left; }
        td { padding: 5px 8px; border-bottom: 1px solid #e5e7eb; }
        tr:nth-child(even) td { background: #eff6ff; }
      </style></head>
      <body>
        <h2>Student List — ${classLabel} (${academicYear})</h2>
        <p>Total Students: ${filtered.length} &nbsp;|&nbsp; Date: ${fmtDate(new Date().toISOString())}</p>
        <table>
          <thead><tr>
            <th>#</th><th>Adm. No.</th><th>Student Name</th>
            ${showClassCol ? '<th>Class</th>' : ''}
            <th>Father's Name</th>
            <th>Gender</th><th>Date of Birth</th><th>Phone</th><th>Address</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.print();
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Class Student List</h2>
          <p className="text-sm text-gray-500 mt-0.5">View and export students by class</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-4 items-end mb-4">
        <div className="flex-1 min-w-40">
          <label className="block text-xs font-medium text-gray-600 mb-1">Class</label>
          <select
            value={selectedClass}
            onChange={e => changeClass(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a class</option>
            {canViewAllClasses && <option value="ALL">All Classes</option>}
            {allowedClasses.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div className="flex-1 min-w-32">
          <label className="block text-xs font-medium text-gray-600 mb-1">Section</label>
          <select
            value={selectedSection}
            onChange={e => setSelectedSection(e.target.value)}
            disabled={!selectedClass || selectedClass === 'ALL'}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:text-gray-400"
          >
            <option value="">All Sections</option>
            {allowedSections.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div className="flex-1 min-w-40">
          <label className="block text-xs font-medium text-gray-600 mb-1">Academic Year <span className="text-gray-400 font-normal">(for reference)</span></label>
          <select
            value={academicYear}
            onChange={e => setAcademicYear(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <button
          onClick={load}
          disabled={!selectedClass || loading}
          className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white
                     px-6 py-2 rounded-lg text-sm font-medium"
        >
          {loading ? '⏳ Loading…' : '🔍 Show Students'}
        </button>
      </div>

      {/* Results */}
      {searched && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">

          {/* Table toolbar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-gray-700">
                {loading ? 'Loading…' : `${filtered.length} student${filtered.length !== 1 ? 's' : ''}`}
                {query && students.length !== filtered.length && ` (filtered from ${students.length})`}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Search */}
              <input
                value={query}
                onChange={e => setQuery(e.target.value.toUpperCase())}
                placeholder="Search by name or admission no…"
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56
                           focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Export buttons — only show if there are results */}
              {filtered.length > 0 && (
                <>
                  <button
                    onClick={exportPDF}
                    className="flex items-center gap-1.5 border border-red-200 text-red-700
                               hover:bg-red-50 px-3 py-1.5 rounded-lg text-sm"
                  >
                    📄 Export PDF
                  </button>
                  {canExportExcel && (
                    <button
                      onClick={exportExcel}
                      className="flex items-center gap-1.5 border border-green-200 text-green-700
                                 hover:bg-green-50 px-3 py-1.5 rounded-lg text-sm"
                    >
                      📊 Download Excel
                    </button>
                  )}
                  <button
                    onClick={handlePrint}
                    className="flex items-center gap-1.5 border border-gray-300 text-gray-700
                               hover:bg-gray-50 px-3 py-1.5 rounded-lg text-sm"
                  >
                    🖨️ Print
                  </button>
                </>
              )}
            </div>
          </div>

          {exportMsg && (
            <div className="px-4 py-2 bg-blue-50 text-blue-700 text-sm border-b border-blue-100">
              {exportMsg}
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <span className="animate-spin mr-2">⏳</span> Loading students…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-400">
              <div className="text-4xl mb-3">🎒</div>
              <p className="font-medium text-gray-500">
                {students.length === 0
                  ? `No students found in ${classLabel} for ${academicYear}`
                  : 'No students match your search'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {[selectedClass !== 'ALL' && selectedSection ? 'Roll No.' : '#', 'Adm. No.', 'Student Name',
                      ...(selectedClass === 'ALL' ? ['Class'] : ['Section']),
                      "Father's Name", 'Gender', 'Date of Birth', 'Phone', 'Category', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr
                      key={s.admission_number}
                      className="border-b border-gray-100 hover:bg-blue-50 cursor-pointer transition-colors"
                      onClick={() => setSelectedStudent(s)}
                    >
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {selectedClass !== 'ALL' && selectedSection ? (s.roll_number ?? '—') : i + 1}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-blue-700">{s.admission_number}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{s.student_name}</td>
                      {selectedClass === 'ALL' ? (
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{s.current_class}{s.section ? ' - ' + s.section : ''}</td>
                      ) : (
                        <td className="px-4 py-3 text-gray-600">{s.section || '—'}</td>
                      )}
                      <td className="px-4 py-3 text-gray-600">{s.father_name}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {s.gender === 'M' ? '👦 Male' : s.gender === 'F' ? '👧 Female' : s.gender}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{fmtDate(s.date_of_birth)}</td>
                      <td className="px-4 py-3 text-gray-600">{s.father_phone || s.mother_phone || '—'}</td>
                      <td className="px-4 py-3">
                        {s.category && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                            ${s.category === 'GEN' ? 'bg-gray-100 text-gray-700'
                            : s.category === 'OBC' ? 'bg-yellow-100 text-yellow-800'
                            : s.category === 'SC'  ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'}`}>
                            {s.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-blue-500 text-xs">View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Footer count */}
              <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                Showing {filtered.length} of {students.length} students in {classLabel} · {academicYear}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Student detail modal */}
      <StudentModal student={selectedStudent} onClose={() => setSelectedStudent(null)} />
    </div>
  );
}
