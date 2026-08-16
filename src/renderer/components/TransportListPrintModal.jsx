import React from 'react';

export default function TransportListPrintModal({ students, monthLabel, academicYear, onClose }) {
  // Group by each student's real, village-based route — useful to whoever
  // is actually running the buses, not just an alphabetical dump.
  const byRoute = {};
  students.forEach(s => {
    const routeName = s.auto_route_name || 'No Route Assigned';
    (byRoute[routeName] = byRoute[routeName] || []).push(s);
  });
  const routeNames = Object.keys(byRoute).sort();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Transport List Preview</h3>
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
          <div className="print-root border border-gray-300 p-6 text-sm print:border-none" id="transport-list-print">
            {/* Letterhead */}
            <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
              <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
              <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
              <h2 className="text-lg font-bold mt-2 tracking-wide">TRANSPORT LIST — {monthLabel} {academicYear}</h2>
            </div>

            {students.length === 0 ? (
              <p className="text-center text-gray-400 py-10">No students currently on transport for this month.</p>
            ) : (
              routeNames.map(routeName => (
                <div key={routeName} className="mb-5 break-inside-avoid">
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
                            <td className="border border-gray-400 px-2 py-1.5">{s.student_name}</td>
                            <td className="border border-gray-400 px-2 py-1.5 text-center">{s.current_class} {s.section}</td>
                            <td className="border border-gray-400 px-2 py-1.5">{s.village || '—'}</td>
                            <td className="border border-gray-400 px-2 py-1.5 font-mono text-blue-700">{s.sl_number}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}

            <div className="flex justify-between mt-8 pt-2 text-xs">
              <span>Total on transport: <strong>{students.length}</strong></span>
              <span>Transport Coordinator Signature: ___________________</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
