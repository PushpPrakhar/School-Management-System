import React from 'react';

const fmt = (n) => Number(n || 0).toFixed(2);

export default function MonthlyLedgerReportPrintModal({ rows, totals, monthLabel, cls, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Monthly Ledger Report Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          <div className="print-root border border-gray-300 p-6 text-sm print:border-none" id="monthly-ledger-report-print">
            {/* Letterhead */}
            <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
              <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
              <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
              <h2 className="text-lg font-bold mt-2 tracking-wide">STUDENT LEDGER SUMMARY FOR THE MONTH OF {monthLabel}{cls ? ` — ${cls}` : ''}</h2>
            </div>

            <div className="receipt-body">
              <table className="w-full text-xs border border-gray-400 border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-center">
                    <th className="border border-gray-400 px-2 py-1.5 w-10">Sr No</th>
                    <th className="border border-gray-400 px-2 py-1.5">Student Ledger No</th>
                    <th className="border border-gray-400 px-2 py-1.5">Student Name &amp; Class</th>
                    <th className="border border-gray-400 px-2 py-1.5">Father's Name</th>
                    <th className="border border-gray-400 px-2 py-1.5">Village</th>
                    <th className="border border-gray-400 px-2 py-1.5">Previous Balance</th>
                    <th className="border border-gray-400 px-2 py-1.5">Fee Due</th>
                    <th className="border border-gray-400 px-2 py-1.5">Fee Paid</th>
                    <th className="border border-gray-400 px-2 py-1.5">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.ledger_id}>
                      <td className="border border-gray-400 px-2 py-1.5 text-center">{r.sr_no}</td>
                      <td className="border border-gray-400 px-2 py-1.5 font-semibold text-blue-700">{r.sl_number}</td>
                      <td className="border border-gray-400 px-2 py-1.5">{r.student_name} ({r.current_class}{r.section ? '-' + r.section : ''})</td>
                      <td className="border border-gray-400 px-2 py-1.5">{r.father_name || '—'}</td>
                      <td className="border border-gray-400 px-2 py-1.5">{r.village || '—'}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(r.prev_balance)}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(r.fee_due)}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(r.fee_paid)}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-right font-semibold">{fmt(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border border-gray-400 px-2 py-1.5" colSpan={5}>Total</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(totals.prev_balance)}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(totals.fee_due)}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(totals.fee_paid)}</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(totals.balance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
