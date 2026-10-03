import React, { useRef, useLayoutEffect, useState } from 'react';
import PrintFooter from './PrintFooter';

// Same reasoning and same estimates as Marks List's pagination — see the
// comment there for why these are necessarily estimates, not pixel-perfect.
const PAGE_CONTENT_HEIGHT_PX = 950;
const PAGE_CONTENT_WIDTH_PX  = 720;
const PAGE_FOOTER_RESERVE_PX = 40;

export default function TransportListPrintModal({ students, monthLabel, academicYear, onClose }) {
  // Group by each student's real, village-based route — useful to whoever
  // is actually running the buses, not just an alphabetical dump.
  const byRoute = {};
  students.forEach(s => {
    const routeName = s.auto_route_name || 'No Route Assigned';
    (byRoute[routeName] = byRoute[routeName] || []).push(s);
  });
  const routeNames = Object.keys(byRoute).sort();

  const letterhead = (
    <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
      <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
      <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
      <h2 className="text-lg font-bold mt-2 tracking-wide">TRANSPORT LIST — {monthLabel} {academicYear}</h2>
    </div>
  );

  const routeBlock = (routeName) => (
    <div className="mb-5 break-inside-avoid">
      <div className="bg-gray-100 border border-gray-400 px-3 py-1.5 font-bold flex justify-between">
        <span>{routeName}</span>
        <span>{byRoute[routeName].length} student{byRoute[routeName].length !== 1 ? 's' : ''}</span>
      </div>
      <table className="w-full text-xs border border-gray-400 border-t-0 border-collapse">
        <thead>
          <tr className="bg-gray-50 text-center">
            <th className="border border-gray-400 px-2 py-1.5 w-10">#</th>
            <th className="border border-gray-400 px-2 py-1.5">Student Name</th>
            <th className="border border-gray-400 px-2 py-1.5">Class</th>
            <th className="border border-gray-400 px-2 py-1.5">Village</th>
            <th className="border border-gray-400 px-2 py-1.5">Adm. No.</th>
          </tr>
        </thead>
        <tbody>
          {byRoute[routeName]
            .sort((a, b) => a.student_name.localeCompare(b.student_name))
            .map((s, i) => (
              <tr key={s.admission_number}>
                <td className="border border-gray-400 px-2 py-1.5 text-center">{i + 1}</td>
                <td className="border border-gray-400 px-2 py-1.5 whitespace-nowrap">{s.student_name}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-center">{s.current_class} {s.section}</td>
                <td className="border border-gray-400 px-2 py-1.5">{s.village || '—'}</td>
                <td className="border border-gray-400 px-2 py-1.5 font-mono text-blue-700">{s.sl_number}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );

  // Pack whole route blocks into pages — never splits a route mid-block,
  // same intent as the existing break-inside-avoid, just applied up front
  // so the letterhead can repeat correctly on every page it spans.
  const letterheadRef = useRef(null);
  const blockRefs      = useRef({});
  const [pageGroups, setPageGroups] = useState(null);

  useLayoutEffect(() => {
    if (routeNames.length === 0) { setPageGroups([[]]); return; }
    const letterheadH = letterheadRef.current?.offsetHeight || 90;
    const available    = PAGE_CONTENT_HEIGHT_PX - letterheadH - PAGE_FOOTER_RESERVE_PX;

    const groups = [];
    let current = [], currentH = 0;
    routeNames.forEach(name => {
      const blockH = blockRefs.current[name]?.offsetHeight || 100;
      if (current.length > 0 && currentH + blockH > available) {
        groups.push(current); current = []; currentH = 0;
      }
      current.push(name); currentH += blockH;
    });
    if (current.length > 0) groups.push(current);
    setPageGroups(groups);
    // eslint-disable-next-line
  }, []);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Transport List Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={pageGroups === null}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {pageGroups === null ? (
            // Hidden measurement pass — same markup, same width the real print uses.
            <div style={{ position: 'fixed', left: -9999, top: 0, width: PAGE_CONTENT_WIDTH_PX }}>
              <div ref={letterheadRef}>{letterhead}</div>
              {routeNames.map(name => (
                <div key={name} ref={el => { blockRefs.current[name] = el; }}>{routeBlock(name)}</div>
              ))}
            </div>
          ) : (
            <div className="print-root" id="transport-list-print">
              {pageGroups.map((group, pageIdx) => (
                <div key={pageIdx}
                  className="border border-gray-300 p-6 text-sm print:border-none"
                  style={pageIdx < pageGroups.length - 1 ? { breakAfter: 'page' } : undefined}>
                  {letterhead}

                  {students.length === 0 ? (
                    <p className="text-center text-gray-400 py-10">No students currently on transport for this month.</p>
                  ) : group.map(name => <React.Fragment key={name}>{routeBlock(name)}</React.Fragment>)}

                  {pageIdx === pageGroups.length - 1 && students.length > 0 && (
                    <div className="flex justify-between mt-8 pt-2 text-xs">
                      <span>Total on transport: <strong>{students.length}</strong></span>
                      <span>Transport Coordinator Signature: ___________________</span>
                    </div>
                  )}

                  <div className="grid grid-cols-3 text-xs text-gray-500 mt-2">
                    <span></span>
                    <span className="text-center">Page {pageIdx + 1} of {pageGroups.length}</span>
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
