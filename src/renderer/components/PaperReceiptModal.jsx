import React, { useState, useEffect } from 'react';

const fmt = (n) => Number(n || 0).toFixed(2);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

// Indian-style amount to words (Lakh/Crore), matches how the paper receipts read.
function amountToWords(amount) {
  const num = Math.floor(Number(amount) || 0);
  if (num === 0) return 'Zero Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const convert = (n) => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '');
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  };
  return convert(num) + ' Only';
}

const MODE_LABEL = { CASH: 'Cash', CHEQUE: 'Cheque', ONLINE: 'Online' };
const monthYear = (iso) => {
  if (!iso) return 'This Month';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'This Month';
  const month = d.toLocaleString('en-US', { month: 'long' });
  const yy = String(d.getFullYear()).slice(2);
  return `${month}'${yy}`;
};

// Self-contained: give it a receipt number + academic year, it fetches and
// renders the print-ready receipt itself. Used identically right after a
// payment is made and later for reprints, so both always look the same.
export default function PaperReceiptModal({ receiptNumber, academicYear, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const res = await window.api.counterGetReceiptPrintData(receiptNumber, academicYear);
      if (cancelled) return;
      setLoading(false);
      if (!res.success) { setError(res.message); return; }
      setData(res.data);
    })();
    return () => { cancelled = true; };
  }, [receiptNumber, academicYear]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0 print:hidden">
          <h3 className="font-bold text-gray-800">Receipt Preview</h3>
          <div className="flex gap-2">
            <button onClick={() => window.print()} disabled={!data}
              className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
              🖨️ Print
            </button>
            <button onClick={onClose} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6 print:p-0 print:overflow-visible">
          {loading && <p className="text-center text-gray-400 py-16">Loading receipt...</p>}
          {error   && <p className="text-center text-red-500 py-16">{error}</p>}
          {data    && <ReceiptContent data={data} />}
        </div>
      </div>
    </div>
  );
}

function ReceiptContent({ data }) {
  const { students, totals } = data;
  const modeLabel = MODE_LABEL[data.payment_mode] || data.payment_mode;
  const studentLedgerNo = data.is_group ? `${data.sl_number}/${data.gsl_number}` : data.sl_number;

  return (
    <div className="print-root border border-gray-300 p-6 text-sm print:border-none" id="receipt-print">
      {/* Letterhead */}
      <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
        <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
        <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
        <h2 className="text-lg font-bold mt-2 tracking-wide">FEE RECEIPT</h2>
      </div>

      <div className="receipt-body">

      {/* Header info grid */}
      <table className="w-full text-xs border border-gray-400 border-collapse mb-4">
        <tbody>
          <tr>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold w-36 bg-gray-50">Group Student Ledger</td>
            <td className="border border-gray-400 px-2 py-1.5 w-14">{data.is_group ? 'Yes' : 'No'}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold w-24 bg-gray-50">Receipt No.</td>
            <td className="border border-gray-400 px-2 py-1.5 font-bold text-blue-700">{data.receipt_number}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold w-16 bg-gray-50">Date</td>
            <td className="border border-gray-400 px-2 py-1.5">{fmtDate(data.date)}</td>
          </tr>
          <tr>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Student Ledger No</td>
            <td className="border border-gray-400 px-2 py-1.5" colSpan={1}>{studentLedgerNo}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Paid By</td>
            <td className="border border-gray-400 px-2 py-1.5">{data.paid_by || '—'}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Counter</td>
            <td className="border border-gray-400 px-2 py-1.5">{data.counter_code || '—'}</td>
          </tr>
          <tr>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Payment Mode</td>
            <td className="border border-gray-400 px-2 py-1.5">{modeLabel}</td>
            {data.payment_mode === 'CHEQUE' && (
              <>
                <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Cheque No.</td>
                <td className="border border-gray-400 px-2 py-1.5">{data.cheque_no || '—'}</td>
                <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Bank Name</td>
                <td className="border border-gray-400 px-2 py-1.5">{data.bank_name || '—'}</td>
              </>
            )}
            {data.payment_mode === 'ONLINE' && (
              <>
                <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Transaction No.</td>
                <td className="border border-gray-400 px-2 py-1.5" colSpan={3}>{data.txn_number || '—'}</td>
              </>
            )}
            {data.payment_mode === 'CASH' && <td className="border border-gray-400 px-2 py-1.5" colSpan={4}></td>}
          </tr>
        </tbody>
      </table>

      {/* Students table */}
      <table className="w-full text-[11px] border border-gray-400 border-collapse mb-3">
        <thead>
          <tr className="bg-gray-100 text-center">
            <th rowSpan={2} className="border border-gray-400 px-1 py-1 align-middle">Student Ledger No</th>
            <th rowSpan={2} className="border border-gray-400 px-1 py-1 align-middle">Student's Name &amp; Class</th>
            <th rowSpan={2} className="border border-gray-400 px-1 py-1 align-middle">Previous<br />Balance</th>
            <th colSpan={5} className="border border-gray-400 px-1 py-1">{monthYear(data.date)} Fee Details</th>
            <th rowSpan={2} className="border border-gray-400 px-1 py-1 align-middle">Total Fees<br />Due</th>
            <th colSpan={2} className="border border-gray-400 px-1 py-1">Payments / Adjustments</th>
            <th rowSpan={2} className="border border-gray-400 px-1 py-1 align-middle">Fees<br />Balance</th>
          </tr>
          <tr className="bg-gray-100 text-center">
            <th className="border border-gray-400 px-1 py-1">Adm.<br/>Fee</th>
            <th className="border border-gray-400 px-1 py-1">Activity<br/>Fee</th>
            <th className="border border-gray-400 px-1 py-1">Tuition<br/>Fee</th>
            <th className="border border-gray-400 px-1 py-1">TPT<br/>Fee</th>
            <th className="border border-gray-400 px-1 py-1">Others</th>
            <th className="border border-gray-400 px-1 py-1">Con./<br/>Adj.</th>
            <th className="border border-gray-400 px-1 py-1">Fees Paid</th>
          </tr>
        </thead>
        <tbody>
          {students.map(s => (
            <tr key={s.ledger_id}>
              <td className="border border-gray-400 px-1 py-1 font-semibold text-blue-700">{s.sl_number}</td>
              <td className="border border-gray-400 px-1 py-1">
                {s.student_name}
                <br /><span className="text-gray-500">{s.current_class}{s.section ? ' ' + s.section : ''}</span>
              </td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.previous_balance)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.buckets.admission)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.buckets.activity)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.buckets.tuition)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.buckets.transport)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.buckets.others)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right font-semibold">{fmt(s.total_fees_due)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.concession)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right">{fmt(s.fees_paid)}</td>
              <td className="border border-gray-400 px-1 py-1 text-right font-semibold">{fmt(s.balance)}</td>
            </tr>
          ))}
          <tr className="bg-gray-50 font-bold">
            <td className="border border-gray-400 px-1 py-1" colSpan={2}>Total</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.previous_balance)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.admission)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.activity)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.tuition)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.transport)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.others)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.total_fees_due)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.concession)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.fees_paid)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(totals.balance)}</td>
          </tr>
        </tbody>
      </table>

      {/* Bottom summary */}
      <div className="flex gap-6 text-sm mb-3">
        <p><span className="text-gray-600">Amount Paid by Parent/Guardian: </span><span className="font-bold">₹{fmt(data.amount_paid_by_guardian)}</span></p>
        <p><span className="text-gray-600">Amount given at counter: </span><span className="font-bold">₹{fmt(data.amount_given_at_counter)}</span></p>
        <p><span className="text-gray-600">Return Amount: </span><span className="font-bold">₹{fmt(data.return_amount)}</span></p>
      </div>

      <div className="flex items-end justify-between">
        <p className="text-sm font-semibold">
          Received with thanks ₹{fmt(data.amount_paid_by_guardian)}/- ({amountToWords(data.amount_paid_by_guardian)})
        </p>
        <p className="text-xs text-gray-500 border-t border-gray-400 pt-1 w-40 text-center shrink-0">Authorized Signatory</p>
      </div>
      </div>
    </div>
  );
}
