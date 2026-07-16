import React, { useState, useEffect } from 'react';

const fmt = (n) => Number(n || 0).toFixed(2);
const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
};

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

export default function CounterOtherReceiptModal({ receiptNumber, academicYear, onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      const res = await window.api.counterOtherGetReceiptPrintData(receiptNumber, academicYear);
      if (cancelled) return;
      setLoading(false);
      if (!res.success) { setError(res.message); return; }
      setData(res.data);
    })();
    return () => { cancelled = true; };
  }, [receiptNumber, academicYear]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white print:static">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden print:max-w-full print:max-h-full print:rounded-none print:shadow-none">
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
  const modeLabel = MODE_LABEL[data.payment_mode] || data.payment_mode;

  return (
    <div className="print-root border border-gray-300 p-6 text-sm print:border-none" id="counter-other-receipt-print">
      {/* Letterhead */}
      <div className="text-center border-b-2 border-gray-800 pb-3 mb-4">
        <h1 className="text-2xl font-bold tracking-wide">BRILLIANT PUBLIC SCHOOL</h1>
        <p className="text-xs text-gray-500">Village-Sherpur-Nayser, Post-Jawal, District-Bulandshahr, UP-203131</p>
        <h2 className="text-lg font-bold mt-2 tracking-wide">RECEIPT</h2>
      </div>

      <div className="receipt-body">
      {/* Header info grid */}
      <table className="w-full text-xs border border-gray-400 border-collapse mb-4">
        <tbody>
          <tr>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold w-24 bg-gray-50">Receipt No.</td>
            <td className="border border-gray-400 px-2 py-1.5 font-bold text-blue-700">{data.receipt_number}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold w-16 bg-gray-50">Date</td>
            <td className="border border-gray-400 px-2 py-1.5">{fmtDate(data.date)}</td>
          </tr>
          <tr>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Paid By</td>
            <td className="border border-gray-400 px-2 py-1.5">{data.paid_by || '—'}</td>
            <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Payment Mode</td>
            <td className="border border-gray-400 px-2 py-1.5">{modeLabel}</td>
          </tr>
          {data.reference_note && (
            <tr>
              <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">For / Reference</td>
              <td className="border border-gray-400 px-2 py-1.5" colSpan={3}>{data.reference_note}</td>
            </tr>
          )}
          {data.payment_mode === 'CHEQUE' && (
            <tr>
              <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Cheque No.</td>
              <td className="border border-gray-400 px-2 py-1.5">{data.cheque_no || '—'}</td>
              <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Bank Name</td>
              <td className="border border-gray-400 px-2 py-1.5">{data.bank_name || '—'}</td>
            </tr>
          )}
          {data.payment_mode === 'ONLINE' && (
            <tr>
              <td className="border border-gray-400 px-2 py-1.5 font-semibold bg-gray-50">Transaction No.</td>
              <td className="border border-gray-400 px-2 py-1.5" colSpan={3}>{data.txn_number || '—'}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Charges table — charge types as columns, one payee row, matching the fee receipt structure */}
      <table className="w-full text-[11px] border border-gray-400 border-collapse mb-3">
        <thead>
          <tr className="bg-gray-100 text-center">
            <th className="border border-gray-400 px-1 py-1">Payee's Name</th>
            {data.charges.map((c, i) => <th key={i} className="border border-gray-400 px-1 py-1">{c.description}</th>)}
            <th className="border border-gray-400 px-1 py-1">Amount Paid</th>
            <th className="border border-gray-400 px-1 py-1">Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-400 px-1 py-1 font-semibold text-blue-700">{data.paid_by || '—'}</td>
            {data.charges.map((c, i) => <td key={i} className="border border-gray-400 px-1 py-1 text-right">{fmt(c.amount)}</td>)}
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(data.amount_paid)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right font-semibold">{fmt(data.balance)}</td>
          </tr>
          <tr className="bg-gray-50 font-bold">
            <td className="border border-gray-400 px-1 py-1">Total</td>
            {data.charges.map((c, i) => <td key={i} className="border border-gray-400 px-1 py-1 text-right">{fmt(c.amount)}</td>)}
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(data.amount_paid)}</td>
            <td className="border border-gray-400 px-1 py-1 text-right">{fmt(data.balance)}</td>
          </tr>
        </tbody>
      </table>

      {/* Bottom summary */}
      <div className="flex gap-6 text-sm mb-3">
        <p><span className="text-gray-600">Total Charged: </span><span className="font-bold">₹{fmt(data.total_charged)}</span></p>
        <p><span className="text-gray-600">Amount Paid: </span><span className="font-bold">₹{fmt(data.amount_paid)}</span></p>
        <p><span className="text-gray-600">Amount given at counter: </span><span className="font-bold">₹{fmt(data.amount_given_at_counter)}</span></p>
        <p><span className="text-gray-600">Return Amount: </span><span className="font-bold">₹{fmt(data.return_amount)}</span></p>
      </div>

      <div className="flex items-end justify-between">
        <p className="text-sm font-semibold">
          Received with thanks ₹{fmt(data.amount_paid)}/- ({amountToWords(data.amount_paid)})
        </p>
        <p className="text-xs text-gray-500 border-t border-gray-400 pt-1 w-40 text-center shrink-0">Authorized Signatory</p>
      </div>
      </div>
    </div>
  );
}
