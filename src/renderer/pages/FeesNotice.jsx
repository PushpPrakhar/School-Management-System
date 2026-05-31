// FeesNotice.jsx
// Generates personalised fee reminder notices for all students with pending dues.
// Output: printable batch or individual PDF notices.

import React, { useState } from 'react';
import { fmtDate, fmtRupees, currentAcademicYear, ACADEMIC_YEARS, CLASSES } from '../utils/helpers';

const CURRENT_YEAR = currentAcademicYear();

export default function FeesNotice() {
  const [year,       setYear]       = useState(CURRENT_YEAR);
  const [cls,        setCls]        = useState('');
  const [students,   setStudents]   = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [selected,   setSelected]   = useState(new Set());
  const [generating, setGenerating] = useState(false);
  const [schoolName, setSchoolName] = useState('School Name');
  const [noticeDate, setNoticeDate] = useState(new Date().toISOString().slice(0, 10));

  const load = async () => {
    setLoading(true);
    setSelected(new Set());
    const res = await window.api.feesGetPending(year, cls || undefined);
    setLoading(false);
    if (res.success) {
      setStudents(res.data);
      setSelected(new Set(res.data.map(s => s.ledger_id)));
    }
  };

  const toggleAll = () => {
    if (selected.size === students.length) setSelected(new Set());
    else setSelected(new Set(students.map(s => s.ledger_id)));
  };

  const toggle = (id) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  // ── Print all selected notices ────────────────────────────
  const printNotices = () => {
    const toprint = students.filter(s => selected.has(s.ledger_id));
    if (toprint.length === 0) return;

    setGenerating(true);

    const notices = toprint.map(s => `
      <div class="notice">
        <div class="header">
          <h1>${schoolName}</h1>
          <p class="subtitle">Fee Reminder Notice</p>
        </div>
        <div class="to-block">
          <p>To,</p>
          <p><strong>${s.father_name}</strong></p>
          <p>Parent / Guardian of: <strong>${s.student_name}</strong></p>
          <p>Class: <strong>${s.class}</strong></p>
          ${s.address ? `<p>Address: ${s.address}</p>` : ''}
        </div>
        <p class="subject">Subject: Reminder for Pending School Fees</p>
        <p class="body">
          Dear Parent / Guardian,<br><br>
          This is to inform you that the following school fees are pending as on
          <strong>${fmtDate(noticeDate)}</strong>. Kindly arrange payment at the earliest
          to avoid any inconvenience.
        </p>
        <table>
          <thead><tr><th>Description</th><th>Amount (₹)</th></tr></thead>
          <tbody>
            <tr><td>Month</td><td>${s.month}</td></tr>
            <tr><td>Monthly Fees</td><td>${fmtRupees(s.monthly_tuition_fees + (s.transport_fees||0) - (s.concession||0))}</td></tr>
            <tr><td>Amount Paid</td><td>${fmtRupees(s.amount_paid_this_month)}</td></tr>
            <tr class="total"><td><strong>Total Amount Due</strong></td><td><strong>${fmtRupees(s.remaining)}</strong></td></tr>
          </tbody>
        </table>
        <p class="footer-note">
          Please visit the school office and clear the above dues at the earliest.<br>
          For any queries, please contact the school office.
        </p>
        <div class="sign-area">
          <div class="sign-box">
            <p>___________________________</p>
            <p>Principal / School Authority</p>
            <p>${schoolName}</p>
          </div>
        </div>
      </div>`).join('<div class="page-break"></div>');

    const html = `
    <html><head><title>Fee Notices</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 12px; background: white; color: #111; }
      .notice { padding: 15mm 20mm; min-height: 140mm; border-bottom: 3px dashed #ccc; }
      .header { text-align: center; margin-bottom: 10mm; border-bottom: 2px solid #333; padding-bottom: 4mm; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .subtitle { font-size: 13px; color: #555; letter-spacing: 1px; text-transform: uppercase; }
      .to-block { background: #f9f9f9; border-left: 4px solid #1d4ed8; padding: 8px 12px; margin: 8mm 0; line-height: 1.8; }
      .subject { font-weight: bold; margin: 6mm 0 4mm; text-decoration: underline; }
      .body { line-height: 1.8; margin-bottom: 6mm; }
      table { width: 100%; border-collapse: collapse; margin: 4mm 0 6mm; }
      td, th { border: 1px solid #ccc; padding: 6px 10px; }
      th { background: #eef2ff; font-weight: 600; }
      tr.total td { background: #fef2f2; font-size: 13px; }
      .footer-note { color: #555; font-size: 11px; margin-top: 4mm; line-height: 1.6; }
      .sign-area { margin-top: 10mm; display: flex; justify-content: flex-end; }
      .sign-box { text-align: center; line-height: 2; font-size: 11px; }
      .page-break { page-break-after: always; }
      @media print { .notice { page-break-inside: avoid; } }
    </style></head>
    <body>${notices}</body></html>`;

    const w = window.open('', '_blank', 'width=850,height=700');
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.print(); setGenerating(false); }, 600);
  };

  // ── Export to PDF using jsPDF ─────────────────────────────
  const exportPDF = async () => {
    const toExport = students.filter(s => selected.has(s.ledger_id));
    if (toExport.length === 0) return;
    setGenerating(true);

    try {
      const { jsPDF }  = await import('jspdf');
      const autoTable  = (await import('jspdf-autotable')).default;

      const doc = new jsPDF({ unit: 'mm', format: 'a4' });

      toExport.forEach((s, idx) => {
        if (idx > 0) doc.addPage();

        // Header
        doc.setFontSize(16); doc.setFont('helvetica','bold');
        doc.text(schoolName, 105, 20, { align: 'center' });
        doc.setFontSize(11); doc.setFont('helvetica','normal');
        doc.text('FEE REMINDER NOTICE', 105, 27, { align: 'center' });
        doc.setLineWidth(0.5); doc.line(15, 30, 195, 30);

        // To block
        doc.setFontSize(10);
        doc.text(`To,`, 15, 38);
        doc.setFont('helvetica','bold');
        doc.text(s.father_name, 15, 44);
        doc.setFont('helvetica','normal');
        doc.text(`Parent / Guardian of: ${s.student_name}`, 15, 50);
        doc.text(`Class: ${s.class}`, 15, 56);
        if (s.address) doc.text(`Address: ${s.address}`, 15, 62);

        doc.setFont('helvetica','bold');
        doc.text('Subject: Reminder for Pending School Fees', 15, 72);
        doc.setFont('helvetica','normal');

        const bodyText = `Dear Parent,\n\nThis is to inform you that the following school fees are pending as on ${fmtDate(noticeDate)}. Kindly arrange payment at the earliest to avoid any inconvenience.`;
        const lines = doc.splitTextToSize(bodyText, 180);
        doc.text(lines, 15, 80);

        autoTable(doc, {
          startY: 100,
          head:   [['Description', 'Amount']],
          body:   [
            ['Month',               s.month],
            ['Monthly Fees',        fmtRupees(s.monthly_tuition_fees + (s.transport_fees||0) - (s.concession||0))],
            ['Amount Already Paid', fmtRupees(s.amount_paid_this_month)],
            ['Total Amount Due',    fmtRupees(s.remaining)],
          ],
          styles:     { fontSize: 9 },
          headStyles: { fillColor: [29, 78, 216] },
          columnStyles: { 1: { halign: 'right' } },
          bodyStyles:   { },
          didParseCell: (data) => {
            if (data.row.index === 3) {
              data.cell.styles.fontStyle  = 'bold';
              data.cell.styles.fillColor  = [254, 226, 226];
            }
          },
        });

        const finalY = doc.lastAutoTable.finalY + 10;
        doc.setFontSize(9);
        doc.text('Please visit the school office and clear the above dues at the earliest.', 15, finalY);
        doc.text('___________________________', 140, finalY + 20);
        doc.text('Principal / School Authority', 140, finalY + 26);
        doc.text(schoolName, 140, finalY + 32);
      });

      doc.save(`FeeNotices_${year}_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
      alert('PDF export failed: ' + err.message);
    }
    setGenerating(false);
  };

  const totalPending = students
    .filter(s => selected.has(s.ledger_id))
    .reduce((sum, s) => sum + (s.remaining || 0), 0);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Fees Notice</h2>
        <p className="text-sm text-gray-500 mt-0.5">Generate fee reminder notices for students with pending dues</p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-end mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Academic Year</label>
          <select value={year} onChange={e => setYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {ACADEMIC_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Class (optional)</label>
          <select value={cls} onChange={e => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All Classes</option>
            {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">School Name (on notice)</label>
          <input value={schoolName} onChange={e => setSchoolName(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notice Date</label>
          <input type="date" value={noticeDate} onChange={e => setNoticeDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={load} disabled={loading}
          className="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2 rounded-lg text-sm disabled:opacity-50">
          {loading ? '⏳ Loading…' : '🔍 Fetch Pending'}
        </button>
      </div>

      {/* Results */}
      {students.length > 0 && (
        <>
          {/* Summary + action bar */}
          <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-3 flex-wrap gap-3">
            <div>
              <p className="font-semibold text-red-800">
                {selected.size} of {students.length} students selected
              </p>
              <p className="text-red-600 text-sm">
                Total pending: <strong>{fmtRupees(totalPending)}</strong>
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={printNotices} disabled={selected.size === 0 || generating}
                className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50
                           text-gray-700 px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                🖨️ Print Notices
              </button>
              <button onClick={exportPDF} disabled={selected.size === 0 || generating}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700
                           text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
                {generating ? '⏳ Generating…' : '📄 Export PDF'}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
              <input type="checkbox"
                checked={selected.size === students.length}
                onChange={toggleAll}
                className="w-4 h-4 accent-blue-600" />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Select All</span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="w-10 px-4 py-2.5"></th>
                  {['Student','Class','Month','Total Due','Paid','Pending','Last Payment'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.ledger_id} onClick={() => toggle(s.ledger_id)}
                    className={`border-b border-gray-100 cursor-pointer transition-colors
                      ${selected.has(s.ledger_id) ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(s.ledger_id)}
                        onChange={() => toggle(s.ledger_id)}
                        onClick={e => e.stopPropagation()}
                        className="w-4 h-4 accent-blue-600" />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-800">{s.student_name}</p>
                      <p className="text-xs text-gray-400">{s.father_name}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{s.class}</td>
                    <td className="px-4 py-3 text-gray-600">{s.month}</td>
                    <td className="px-4 py-3 text-gray-600">{fmtRupees(s.total_due)}</td>
                    <td className="px-4 py-3 text-green-600">{fmtRupees(s.amount_paid_this_month)}</td>
                    <td className="px-4 py-3 font-semibold text-red-600">{fmtRupees(s.remaining)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(s.payment_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
              {students.length} student{students.length !== 1 ? 's' : ''} with pending fees · {year}
            </div>
          </div>
        </>
      )}

      {students.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="text-5xl mb-4">📢</div>
          <p className="text-gray-500 font-medium">Click "Fetch Pending" to load students with dues</p>
        </div>
      )}
    </div>
  );
}
