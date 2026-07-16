import React from 'react';

const fmt = (n) => Number(n || 0).toFixed(2);

export default function DailyCollectionPrintModal({ data, date, onClose }) {
  const displayDate = date.split('-').reverse().join('-');

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Collection List Preview</h3>
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
          <div className="print-root border border-gray-300 p-6 text-sm print:border-none" id="daily-collection-print">
            {/* Letterhead */}
            <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
              <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
              <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
              <h2 className="text-lg font-bold mt-2 tracking-wide">DAILY COLLECTION LIST {displayDate}</h2>
            </div>

            <div className="receipt-body">
              <table className="w-full text-xs border border-gray-400 border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-center">
                    <th className="border border-gray-400 px-2 py-1.5 w-12">S No.</th>
                    <th className="border border-gray-400 px-2 py-1.5">Receipt No.</th>
                    <th className="border border-gray-400 px-2 py-1.5">Type</th>
                    <th className="border border-gray-400 px-2 py-1.5">SL No.</th>
                    <th className="border border-gray-400 px-2 py-1.5">Student Name</th>
                    <th className="border border-gray-400 px-2 py-1.5">Class</th>
                    <th className="border border-gray-400 px-2 py-1.5">Amount</th>
                    <th className="border border-gray-400 px-2 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const isCancelled = r.status === 'CANCELLED';
                    return (
                    <tr key={r.receipt_number + '-' + r.type + '-' + i} className={isCancelled ? 'text-red-600' : ''}>
                      <td className="border border-gray-400 px-2 py-1.5 text-center">{i + 1}</td>
                      <td className={`border border-gray-400 px-2 py-1.5 font-semibold text-blue-700 ${isCancelled ? 'line-through' : ''}`}>{r.receipt_number}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-center">{r.type === 'FEE' ? 'Fee' : 'Other'}</td>
                      <td className="border border-gray-400 px-2 py-1.5">{r.sl_number || '—'}</td>
                      <td className={`border border-gray-400 px-2 py-1.5 ${isCancelled ? 'line-through' : ''}`}>{r.student_name || '—'}</td>
                      <td className="border border-gray-400 px-2 py-1.5">{r.class_label || '—'}</td>
                      <td className={`border border-gray-400 px-2 py-1.5 text-right ${isCancelled ? 'line-through' : ''}`}>{fmt(r.amount)}</td>
                      <td className="border border-gray-400 px-2 py-1.5 text-center font-semibold">{isCancelled ? 'CANCELLED' : ''}</td>
                    </tr>
                    );
                  })}
                  <tr className="bg-gray-50 font-bold">
                    <td className="border border-gray-400 px-2 py-1.5" colSpan={6}>Total</td>
                    <td className="border border-gray-400 px-2 py-1.5 text-right">{fmt(data.total)}</td>
                    <td className="border border-gray-400 px-2 py-1.5"></td>
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
