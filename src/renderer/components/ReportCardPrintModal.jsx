import React from 'react';

// Reusable print modal for report cards — shared across Unit Test, Half
// Yearly, and Final result tabs in Examination.jsx. Same pattern as
// DailyCollectionPrintModal / MonthlyLedgerReportPrintModal: preview
// modal with Print/Close buttons, .print-root scoping so nothing else on
// the page bleeds into the printed page. Wraps whichever report card
// component is passed in as children.
export default function ReportCardPrintModal({ studentName, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Report Card Preview — {studentName}</h3>
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
          <div className="print-root">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
