import React from 'react';
import PrintFooter from './PrintFooter';

// The certificate's rows, in the order and wording of the school's existing
// paper format. `fields` holds the final strings exactly as they print, so
// the same component renders both a fresh certificate and a later reprint.
const ROWS = [
  ['Admission cum SR. No.',                                           f => f.admission_no],
  ['PEN NO of the student',                                           f => f.pen_no],
  ['Date of admission with class',                                    f => f.admission_date_class],
  ['Name of the Student',                                             f => f.student_name],
  ["Father/Guardian's Name",                                          f => f.father_name],
  ["Mother's Name",                                                   f => f.mother_name],
  ['Date of Birth as per school records (in figure/words)',           f => [f.dob_figure, f.dob_words].filter(Boolean).join(' — ')],
  ['Nationality',                                                     f => f.nationality],
  ['Caste and Religion',                                              f => f.caste_religion],
  ['Whether the student belongs to Schedule Caste or Schedule Tribe', f => f.sc_st],
  ['Class in which the student last studied',                         f => f.class_last_studied],
  ['Annual examination last taken with result',                       f => f.last_exam_result],
  ['Whether failed, if so, Once/Twice in the same class',             f => f.failed_before],
  ['Subject studied',                                                 f => f.subjects],
  ['Whether qualified for promotion to the higher class',             f => f.qualified_promotion],
  ['If so, to which class (in figure and words)',                     f => f.promoted_to_class],
  ['All sums due to this school have been cleared upto',              f => f.dues_cleared_upto],
  ['Total number of working days in Academic Year',                   f => f.working_days],
  ['Total number of days, student attended the school',               f => f.attended_days],
  ['General conduct of the student',                                  f => f.conduct],
  ['Date of application for certificate',                             f => f.application_date],
  ['Reasons for leaving the school',                                  f => f.reason_for_leaving],
  ['Any other remarks, if any.',                                      f => f.remarks],
];

function Certificate({ fields }) {
  return (
    <div className="text-sm text-black print:flex-1 print:flex print:flex-col">
      {/* Letterhead */}
      <div className="text-center mb-3">
        <h1 className="text-[22px] font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
        <p className="text-xs mt-0.5">(A Govt. Recognized English Medium School)</p>
        <p className="text-xs">Village Sherpur Nayser, Post - Jawal, District- Bulandshahr, UP-203131</p>
        <p className="text-xs font-semibold">School Udise Number: 09114102624</p>
        <h2 className="text-base font-bold underline mt-2 tracking-wide">TRANSFER CERTIFICATE</h2>
      </div>

      {/* Particulars */}
      <table className="w-full text-[13px] leading-snug border-collapse">
        <tbody>
          {ROWS.map(([label, get]) => (
            <tr key={label} className="align-top">
              <td className="py-[3px] pr-3 w-[47%]">{label}</td>
              <td className="py-[3px] pr-2 w-3">:</td>
              <td className="py-[3px] font-semibold">{get(fields) || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Signatures — pinned to the foot of the page when printing */}
      <div className="mt-6 print:mt-auto print:pt-3">
        <div className="flex justify-between items-end">
          <div className="space-y-2 text-[13px]">
            <p>Prepared by : <span className="inline-block w-48 border-b border-black align-bottom">&nbsp;</span></p>
            <p>Verified by<br />(Class Teacher): <span className="inline-block w-40 border-b border-black align-bottom">&nbsp;</span></p>
            <p className="pt-2">Dated : <span className="font-semibold">{fields.issue_date}</span></p>
          </div>
          <div className="text-center text-[13px] leading-snug">
            <div className="h-8" />
            <p className="font-semibold">Principal</p>
            <p>Brilliant Public School</p>
            <p>Sherpur Nayser, Khurja,</p>
            <p>Bulandshahr, Uttar Pradesh-203131</p>
          </div>
        </div>
        <PrintFooter />
      </div>
    </div>
  );
}

export default function TCPrintModal({ fields, tcNumber, onClose }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <div>
            <h3 className="font-bold text-gray-800">Transfer Certificate</h3>
            {tcNumber && <p className="text-xs text-gray-500">Register no. {tcNumber}</p>}
          </div>
          <div className="flex gap-2">
            <button onClick={() => window.print()}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose}
              className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          <div className="print-root border border-gray-300 p-8 print:border-none print:min-h-[240mm] print:flex print:flex-col">
            <div className="print:px-5 print:py-2 print:flex-1 print:flex print:flex-col"><Certificate fields={fields} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
