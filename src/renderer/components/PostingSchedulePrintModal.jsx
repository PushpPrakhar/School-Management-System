import React, { useRef, useLayoutEffect, useState } from 'react';
import PrintFooter from './PrintFooter';

const fmt     = (n) => '₹' + Number(n || 0).toFixed(2);
const fmtDate = (d) => d ? String(d).slice(0, 10).split('-').reverse().join('-') : '—';

// Same reasoning and estimates as Marks List's pagination — see the
// comment there for why these are necessarily estimates, not pixel-perfect.
const PAGE_CONTENT_HEIGHT_PX = 950;
const PAGE_CONTENT_WIDTH_PX  = 720;
const PAGE_FOOTER_RESERVE_PX = 40;

export default function PostingSchedulePrintModal({ schedule, receipts, onClose }) {
  const letterhead = (
    <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
      <h1 className="text-xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
      <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
      <h2 className="text-base font-bold mt-2">Posting Schedule — {schedule.schedule_id}</h2>
      <p className="text-sm text-gray-600">Posted on {fmtDate(schedule.posted_at)} by {schedule.posted_by}</p>
    </div>
  );

  const headerRow = (
    <tr className="bg-gray-100">
      <th className="border border-gray-400 px-2 py-1.5 w-8">#</th>
      <th className="border border-gray-400 px-2 py-1.5">Receipt No</th>
      <th className="border border-gray-400 px-2 py-1.5 text-left">Student</th>
      <th className="border border-gray-400 px-2 py-1.5">Class</th>
      <th className="border border-gray-400 px-2 py-1.5">Amount</th>
      <th className="border border-gray-400 px-2 py-1.5">Mode</th>
      <th className="border border-gray-400 px-2 py-1.5">Collected By</th>
    </tr>
  );

  const dataRow = (r, rank) => {
    const amount = (r.lines || []).filter(l => l.transaction_type === 'RECEIVED').reduce((s, l) => s + (l.credit || 0), 0);
    return (
      <tr key={r.receipt_number + '-' + rank}>
        <td className="border border-gray-400 px-2 py-1 text-center">{rank}</td>
        <td className="border border-gray-400 px-2 py-1 text-center font-mono text-blue-700">{r.receipt_number}</td>
        <td className="border border-gray-400 px-2 py-1">{r.student_name || r.sl_number}</td>
        <td className="border border-gray-400 px-2 py-1 text-center">{r.current_class || '—'}</td>
        <td className="border border-gray-400 px-2 py-1 text-right font-semibold">{fmt(amount)}</td>
        <td className="border border-gray-400 px-2 py-1 text-center">{r.payment_mode}</td>
        <td className="border border-gray-400 px-2 py-1 text-center">{r.collected_by || '—'}</td>
      </tr>
    );
  };

  const letterheadRef = useRef(null);
  const headerRowRef  = useRef(null);
  const sampleRowRef  = useRef(null);
  const [rowsPerPage, setRowsPerPage] = useState(null);

  useLayoutEffect(() => {
    const letterheadH = letterheadRef.current?.offsetHeight || 100;
    const headerH     = headerRowRef.current?.offsetHeight  || 26;
    const rowH        = sampleRowRef.current?.offsetHeight  || 20;
    const available   = PAGE_CONTENT_HEIGHT_PX - letterheadH - headerH - PAGE_FOOTER_RESERVE_PX;
    setRowsPerPage(Math.max(5, Math.floor(available / rowH)));
    // eslint-disable-next-line
  }, []);

  const ready = rowsPerPage !== null;
  const ranked = (receipts || []).map((r, i) => ({ r, rank: i + 1 }));
  const pages = [];
  if (ready) {
    for (let i = 0; i < ranked.length; i += rowsPerPage) pages.push(ranked.slice(i, i + rowsPerPage));
    if (pages.length === 0) pages.push([]);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Posting Schedule Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!ready}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {!ready ? (
            <div style={{ position: 'fixed', left: -9999, top: 0, width: PAGE_CONTENT_WIDTH_PX }}>
              <div ref={letterheadRef}>{letterhead}</div>
              <table className="w-full text-xs border border-gray-400 border-collapse">
                <thead><tr ref={headerRowRef}>{headerRow.props.children}</tr></thead>
                <tbody>{ranked[0] && <tr ref={sampleRowRef}>{dataRow(ranked[0].r, ranked[0].rank).props.children}</tr>}</tbody>
              </table>
            </div>
          ) : (
            <div className="print-root">
              {pages.map((pageRows, pageIdx) => (
                <div key={pageIdx}
                  className="border border-gray-300 p-6 text-sm print:border-none"
                  style={pageIdx < pages.length - 1 ? { breakAfter: 'page' } : undefined}>
                  {letterhead}

                  <table className="w-full text-xs border border-gray-400 border-collapse mb-3">
                    <thead>{headerRow}</thead>
                    <tbody>{pageRows.map(({ r, rank }) => dataRow(r, rank))}</tbody>
                  </table>

                  {pageIdx === pages.length - 1 && (
                    <p className="text-xs text-gray-600">
                      Total Receipts: <strong>{schedule.total_transactions}</strong> &nbsp;·&nbsp;
                      Total Amount: <strong>{fmt(schedule.total_amount)}</strong>
                    </p>
                  )}

                  <div className="grid grid-cols-3 text-xs text-gray-500 mt-2">
                    <span></span>
                    <span className="text-center">Page {pageIdx + 1} of {pages.length}</span>
                    <span></span>
                  </div>
                  <PrintFooter />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
