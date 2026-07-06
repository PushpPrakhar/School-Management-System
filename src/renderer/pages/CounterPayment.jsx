import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../utils/AuthContext';
import MissingFeesBanner from '../components/MissingFeesBanner';
import PaperReceiptModal from '../components/PaperReceiptModal';

// ── Helpers ───────────────────────────────────────────────────
const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 4 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const fmt    = (n) => Number(n || 0).toFixed(2);
const fmtINR = (n) => '₹' + Number(n || 0).toFixed(2);
const today  = () => { const d = new Date(); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };

// Amount to words
function amountToWords(amount) {
  const num = Math.floor(amount);
  if (num === 0) return 'Zero Only';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  const convert = (n) => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n/10)] + (n%10 ? ' ' + ones[n%10] : '');
    if (n < 1000) return ones[Math.floor(n/100)] + ' Hundred' + (n%100 ? ' ' + convert(n%100) : '');
    if (n < 100000) return convert(Math.floor(n/1000)) + ' Thousand' + (n%1000 ? ' ' + convert(n%1000) : '');
    if (n < 10000000) return convert(Math.floor(n/100000)) + ' Lakh' + (n%100000 ? ' ' + convert(n%100000) : '');
    return convert(Math.floor(n/10000000)) + ' Crore' + (n%10000000 ? ' ' + convert(n%10000000) : '');
  };
  return convert(num) + ' Only';
}

function bucketForFeeType(ft) {
  if (ft === 'ADMISSION') return 'admission';
  if (ft === 'ACTIVITY')  return 'activity';
  if (ft === 'TUITION')   return 'tuition';
  if (ft === 'TRANSPORT') return 'transport';
  return 'others';
}

// Live, interactive ledger-style receipt table. Bucket amounts (Admission /
// Activity / Tuition / Transport / Others) are computed automatically from
// what's actually due — Concession and Fees Paid are the only editable cells,
// matching the two "Payments / Adjustments" columns on the printed receipt.
function FeeSummaryTable({ rows, showTotal, onConcessionChange, onFeesPaidChange }) {
  const totals = rows.reduce((t, r) => ({
    previous_balance: t.previous_balance + r.previous_balance,
    admission: t.admission + r.buckets.admission, activity: t.activity + r.buckets.activity,
    tuition: t.tuition + r.buckets.tuition, transport: t.transport + r.buckets.transport, others: t.others + r.buckets.others,
    total_due: t.total_due + r.total_due, concession: t.concession + (r.concession || 0),
    fees_paid: t.fees_paid + (r.fees_paid || 0), balance: t.balance + r.balance,
  }), { previous_balance: 0, admission: 0, activity: 0, tuition: 0, transport: 0, others: 0, total_due: 0, concession: 0, fees_paid: 0, balance: 0 });

  const bucketTitle = (items) => (items && items.length)
    ? items.map(i => `${i.description}: ₹${fmt(i.amount)}`).join('\n') : undefined;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
      <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5">
        <p className="text-sm font-semibold text-gray-700">📋 Ledger Summary — same layout as the printed receipt</p>
        <p className="text-xs text-gray-400 mt-0.5">Fee amounts are pulled automatically from Fee Settings. Type directly into Concession and Fees Paid.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200 text-center">
            <tr>
              <th rowSpan={2} className="px-2 py-1.5 align-middle">SL No</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle text-left">Student, Father's Name &amp; Class</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle">Previous<br/>Balance</th>
              <th colSpan={5} className="px-2 py-1.5 border-l border-gray-200">Current Month Fee Details</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle border-l border-gray-200">Total<br/>Due</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle border-l border-gray-200 bg-amber-50">Concession</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle bg-amber-50">Fees<br/>Paid</th>
              <th rowSpan={2} className="px-2 py-1.5 align-middle border-l border-gray-200">Balance</th>
            </tr>
            <tr>
              <th className="px-2 py-1 border-l border-gray-200">Admission</th>
              <th className="px-2 py-1">Activity</th>
              <th className="px-2 py-1">Tuition</th>
              <th className="px-2 py-1">Transport</th>
              <th className="px-2 py-1">Others</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.sl_number} className="border-b border-gray-100">
                <td className="px-2 py-1.5 text-center font-semibold text-blue-700">{r.sl_number}</td>
                <td className="px-2 py-1.5">
                  {r.student_name}, {r.father_name}
                  <span className="text-gray-400"> — {r.current_class}{r.section ? ' ' + r.section : ''}</span>
                </td>
                <td className="px-2 py-1.5 text-right">{fmt(r.previous_balance)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100" title={bucketTitle(r.bucket_items?.admission)}>{r.buckets.admission ? fmt(r.buckets.admission) : ''}</td>
                <td className="px-2 py-1.5 text-right" title={bucketTitle(r.bucket_items?.activity)}>{r.buckets.activity ? fmt(r.buckets.activity) : ''}</td>
                <td className="px-2 py-1.5 text-right" title={bucketTitle(r.bucket_items?.tuition)}>{r.buckets.tuition ? fmt(r.buckets.tuition) : ''}</td>
                <td className="px-2 py-1.5 text-right" title={bucketTitle(r.bucket_items?.transport)}>{r.buckets.transport ? fmt(r.buckets.transport) : ''}</td>
                <td className="px-2 py-1.5 text-right" title={bucketTitle(r.bucket_items?.others)}>{r.buckets.others ? fmt(r.buckets.others) : ''}</td>
                <td className="px-2 py-1.5 text-right font-semibold border-l border-gray-100">{fmt(r.total_due)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100 bg-amber-50">
                  <input type="number" min="0" value={r.concession === 0 ? '' : r.concession}
                    onChange={e => onConcessionChange(r.admNo || r.sl_number, parseFloat(e.target.value) || 0)}
                    placeholder="0" className="w-20 text-right border border-amber-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </td>
                <td className="px-2 py-1.5 text-right bg-amber-50">
                  <input type="number" min="0" value={r.fees_paid === 0 ? '' : r.fees_paid}
                    onChange={e => onFeesPaidChange(r.admNo || r.sl_number, parseFloat(e.target.value) || 0)}
                    placeholder="0.00" className="w-24 text-right border border-amber-200 rounded px-1.5 py-1 bg-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400" />
                </td>
                <td className={`px-2 py-1.5 text-right font-semibold border-l border-gray-100 ${r.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmt(r.balance)}</td>
              </tr>
            ))}
            {showTotal && (
              <tr className="bg-gray-50 font-bold">
                <td className="px-2 py-1.5" colSpan={2}>Total</td>
                <td className="px-2 py-1.5 text-right">{fmt(totals.previous_balance)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100">{fmt(totals.admission)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(totals.activity)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(totals.tuition)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(totals.transport)}</td>
                <td className="px-2 py-1.5 text-right">{fmt(totals.others)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100">{fmt(totals.total_due)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100">{fmt(totals.concession)}</td>
                <td className="px-2 py-1.5 text-right text-green-700">{fmt(totals.fees_paid)}</td>
                <td className="px-2 py-1.5 text-right border-l border-gray-100">{fmt(totals.balance)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Individual Payment Tab ────────────────────────────────────
function IndividualTab({ academicYear }) {
  const { user } = useAuth();
  const [query,       setQuery]       = useState('');
  const [ledgerData,  setLedgerData]  = useState(null);
  const [chargeItems, setChargeItems] = useState([]); // read from the ledger (already generated), plus live Late Fee
  const [concession,  setConcession]  = useState(0);
  const [feesPaid,    setFeesPaid]    = useState(0);
  const [amountGiven, setAmountGiven] = useState('');
  const [paidBy,      setPaidBy]      = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [chequeNo,    setChequeNo]    = useState('');
  const [bankName,    setBankName]    = useState('');
  const [txnNumber,   setTxnNumber]   = useState('');
  const [remarks,     setRemarks]     = useState('');
  const [receiptNo,   setReceiptNo]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState('');
  const [receipt,     setReceipt]     = useState(null); // receipt_number to show in the print modal
  const [centers,     setCenters]     = useState([]);
  const [centerId,    setCenterId]    = useState(1);
  const [counterId,   setCounterId]   = useState(1);

  useEffect(() => {
    window.api.centersGetAll().then(r => {
      if (r.success) {
        setCenters(r.centers);
        if (r.centers.length > 0) setCenterId(r.centers[0].center_id);
      }
    });
    window.api.counterGetNextReceipt(academicYear).then(r => {
      if (r.success) setReceiptNo(r.receipt_number);
    });
  }, [academicYear]);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(''); setLedgerData(null); setChargeItems([]);
    const res = await window.api.counterGetLedger(query, academicYear);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setLedgerData(res);
    loadChargeItems(res);
  };

  // Tuition, Transport, Annual/Exam and Admission Fee are never computed here
  // — they're read exactly as Auto Accrual already generated them for this
  // month. Late Fee is the one exception, since it depends on today's date
  // and can't be pre-generated in advance.
  const loadChargeItems = (res) => {
    const items = (res.currentMonthItems || []).map(i => ({ ...i }));
    const settings = res.settings || {};
    const today = new Date();
    const dueDay = settings.grace_period_days || 10;
    if (today.getDate() > dueDay) {
      const lateDays = today.getDate() - dueDay;
      const lateFee  = Math.min(lateDays * (settings.late_fee_per_day || 5), settings.late_fee_annual_cap || 1000);
      if (lateFee > 0) items.push({ description: `Late Fee (${lateDays} days × ₹${settings.late_fee_per_day})`, amount: lateFee, concession: 0, concession_reason: '', fee_type: '', is_late_fee: true });
    }
    setChargeItems(items);
    const tuitionItem = items.find(i => i.fee_type === 'TUITION');
    setConcession(tuitionItem?.concession || 0);
    setFeesPaid(0);
  };

  const generateThisMonth = async () => {
    setGenerating(true); setError('');
    const res = await window.api.accrualGenerate(academicYear, user?.username);
    setGenerating(false);
    if (!res.success) { setError(res.message); return; }
    await search(); // refresh this student now that the month's been generated
  };

  const currentDue  = chargeItems.reduce((s, i) => s + (i.amount || 0), 0);
  const prevBalance = ledgerData?.prevBalance || 0;
  const alreadyPaidThisMonth = ledgerData?.alreadyPaidThisMonth || 0;
  const totalDue     = prevBalance + currentDue;
  const paid         = feesPaid || 0;
  const balance      = Math.max(0, totalDue - concession - alreadyPaidThisMonth - paid);
  const given        = amountGiven === '' ? paid : (parseFloat(amountGiven) || 0);
  const returnAmt    = Math.max(0, given - paid);

  // Ledger-style row — previous balance stays a separate column, everything
  // else buckets into Admission / Activity / Tuition / Transport / Others.
  const summaryRows = ledgerData ? (() => {
    const buckets = { admission: 0, activity: 0, tuition: 0, transport: 0, others: 0 };
    const bucket_items = { admission: [], activity: [], tuition: [], transport: [], others: [] };
    chargeItems.forEach(i => {
      const key = bucketForFeeType(i.fee_type);
      buckets[key] += (i.amount || 0);
      bucket_items[key].push(i);
    });
    return [{
      sl_number: ledgerData.ledger.sl_number, student_name: ledgerData.ledger.student_name,
      father_name: ledgerData.ledger.father_name, current_class: ledgerData.ledger.current_class, section: ledgerData.ledger.section,
      previous_balance: prevBalance, buckets, bucket_items, total_due: totalDue,
      concession, fees_paid: paid, balance,
    }];
  })() : [];

  const savePayment = async () => {
    if (!ledgerData) return;
    if (paid <= 0) { setError('Please enter the amount paid.'); return; }
    if (!paidBy.trim()) { setError('Please enter who paid the fee (Paid By).'); return; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setError('Please enter the cheque number.'); return; }
    if (paymentMode === 'ONLINE' && !txnNumber.trim()) { setError('Please enter the transaction number.'); return; }
    setSaving(true); setError('');

    // Apply the (editable) concession against Tuition specifically, matching
    // the rule that concessions apply to tuition — falls back to a standalone
    // adjustment line if there's no tuition item to attach it to. If the
    // item already exists (generated earlier by Auto Accrual), this only
    // updates its concession — it's never re-created as a new due.
    let finalItems = chargeItems.map(i => ({ ...i }));
    if (concession > 0) {
      const tuitionItem = finalItems.find(i => i.fee_type === 'TUITION');
      if (tuitionItem) {
        tuitionItem.concession = concession;
        tuitionItem.concession_reason = 'Concession/Adjustment';
      } else {
        finalItems.push({ description: 'Concession / Adjustment', amount: 0, concession, concession_reason: 'Concession/Adjustment', fee_type: '' });
      }
    }

    const res = await window.api.counterSavePayment({
      academic_year:    academicYear,
      ledger_id:        ledgerData.ledger.ledger_id,
      group_id:         null,
      sl_number:        ledgerData.ledger.sl_number,
      receipt_number:   receiptNo,
      line_items:       finalItems,
      total_paid:       paid,
      payment_mode:     paymentMode,
      remarks,
      center_id:        centerId,
      counter_id:       counterId,
      collected_by:     user?.username || '',
      paid_by:          paidBy.trim(),
      amount_tendered:  given,
      cheque_no:        chequeNo.trim(),
      bank_name:        bankName.trim(),
      txn_number:       txnNumber.trim(),
    });

    setSaving(false);
    if (!res.success) { setError(res.message); return; }

    // Show the printable receipt (fetched fresh from the DB, so it always matches what was saved)
    setReceipt(receiptNo);

    // Get next receipt number for the next payment
    const nextRes = await window.api.counterGetNextReceipt(academicYear);
    if (nextRes.success) setReceiptNo(nextRes.receipt_number);
  };

  const resetForm = () => {
    setQuery(''); setLedgerData(null); setChargeItems([]);
    setConcession(0); setFeesPaid(0); setAmountGiven(''); setPaidBy('');
    setPaymentMode('CASH'); setChequeNo(''); setBankName(''); setTxnNumber('');
    setRemarks(''); setError('');
  };

  return (
    <div>
      {/* Search */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex gap-3">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Enter SL number or student name..."
          className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={search} disabled={loading}
          className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:bg-blue-300">
          {loading ? '⏳' : '🔍 Search'}
        </button>
        {ledgerData && <button onClick={resetForm} className="px-4 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Clear</button>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {ledgerData && (
        <>
          {/* Info bar */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-4 flex items-center justify-between">
            <div className="flex gap-8 text-sm">
              <div><span className="text-blue-500 text-xs">SL Number</span><p className="font-bold text-blue-800">{ledgerData.ledger.sl_number}</p></div>
              {ledgerData.ledger.gsl_number && <div><span className="text-blue-500 text-xs">GSL Group</span><p className="font-bold text-purple-700">{ledgerData.ledger.gsl_number}</p></div>}
              <div><span className="text-blue-500 text-xs">Date</span><p className="font-bold text-blue-800">{today()}</p></div>
            </div>
            <div className="text-right">
              <p className="text-xs text-blue-500">Receipt No</p>
              <p className="text-lg font-bold text-blue-800">{receiptNo}</p>
            </div>
          </div>

          {!ledgerData.currentMonthGenerated && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-3 mb-4 flex items-center justify-between">
              <p className="text-sm text-amber-700">
                ⚠️ <strong>{ledgerData.current_fee_month}'s fees haven't been generated yet</strong> for this student —
                Current Month columns will show ₹0 until then. You can still collect Previous Balance now.
              </p>
              <button onClick={generateThisMonth} disabled={generating}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium whitespace-nowrap ml-4">
                {generating ? '⏳ Generating...' : '⚡ Generate Now'}
              </button>
            </div>
          )}

          {alreadyPaidThisMonth > 0 && (
            <div className="bg-blue-50 border border-blue-300 rounded-xl px-5 py-3 mb-4">
              <p className="text-sm text-blue-700">
                ℹ️ <strong>₹{fmt(alreadyPaidThisMonth)} has already been paid</strong> for this student this month —
                the Balance below already accounts for that. This receipt only records any additional amount you enter now.
              </p>
            </div>
          )}

          {/* Receipt details — Paid By / Payment Mode / Counter, above the table like the printed receipt */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Paid By <span className="text-red-400">*</span></label>
                <input value={paidBy} onChange={e => setPaidBy(e.target.value)}
                  placeholder="Name of parent / guardian who paid"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment Mode</label>
                <div className="flex flex-wrap gap-2">
                  {['CASH','CHEQUE','ONLINE'].map(m => (
                    <button key={m} onClick={() => setPaymentMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                        ${paymentMode===m ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'}`}>
                      {{CASH:'Cash', CHEQUE:'Cheque', ONLINE:'Online'}[m]}
                    </button>
                  ))}
                </div>
              </div>
              {paymentMode === 'CHEQUE' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cheque No. <span className="text-red-400">*</span></label>
                    <input value={chequeNo} onChange={e => setChequeNo(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Bank Name</label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </div>
                </>
              )}
              {paymentMode === 'ONLINE' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Transaction No. <span className="text-red-400">*</span></label>
                  <input value={txnNumber} onChange={e => setTxnNumber(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </div>
              )}
              {paymentMode === 'CASH' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Counter</label>
                  <select value={counterId} onChange={e => setCounterId(parseInt(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                    <option value={1}>Main Counter (C-01)</option>
                  </select>
                </div>
              )}
            </div>
            {paymentMode !== 'CASH' && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Counter</label>
                <select value={counterId} onChange={e => setCounterId(parseInt(e.target.value))}
                  className="w-56 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                  <option value={1}>Main Counter (C-01)</option>
                </select>
              </div>
            )}
          </div>

          <FeeSummaryTable rows={summaryRows} showTotal={true}
            onConcessionChange={(_sl, val) => setConcession(val)}
            onFeesPaidChange={(_sl, val) => setFeesPaid(val)} />

          {/* Bottom summary — mirrors the printed receipt's totals block */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Amount Paid by Guardian</span><span className="font-bold text-lg">{fmtINR(paid)}</span></div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">Amount Given at Counter</span>
                <input type="number" min="0" value={amountGiven}
                  onChange={e => setAmountGiven(e.target.value)}
                  placeholder={paid > 0 ? fmt(paid) : '0.00'}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              <p className="text-[11px] text-gray-400">Only fill this in if the parent handed over more cash than needed (e.g. for change) — otherwise leave blank.</p>
              <div className="flex justify-between"><span className="text-gray-500">Return Amount</span><span className="font-bold text-green-600">{fmtINR(returnAmt)}</span></div>
              {paid > 0 && <p className="text-xs text-gray-400 italic">Received with thanks {fmtINR(paid)}/- ({amountToWords(paid)})</p>}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 text-sm">
              {balance > 0 && paid > 0 ? (
                <div className="flex justify-between text-red-600">
                  <span>Balance — carried forward as Previous Balance next time</span>
                  <span className="font-bold">{fmtINR(balance)}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No pending balance for this student once this payment is saved.</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remarks</label>
                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-6 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">Cancel</button>
            <button onClick={savePayment} disabled={saving || paid <= 0}
              className="px-8 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl text-sm font-bold">
              {saving ? '⏳ Processing...' : '✅ Submit & Generate Receipt'}
            </button>
          </div>
        </>
      )}

      {receipt && <PaperReceiptModal receiptNumber={receipt} academicYear={academicYear} onClose={() => setReceipt(null)} />}
    </div>
  );
}


// ── Group Payment Tab ────────────────────────────────────────
function GroupTab({ academicYear }) {
  const { user } = useAuth();
  const [query,       setQuery]       = useState('');
  const [groupData,   setGroupData]   = useState(null);
  const [memberItems, setMemberItems] = useState({}); // admission_number → { member, items, position } (read from ledger, not computed)
  const [adjustments, setAdjustments] = useState({}); // admission_number → { concession, feesPaid } (the only editable values)
  const [amountGiven, setAmountGiven] = useState('');
  const [paidBy,      setPaidBy]      = useState('');
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [chequeNo,    setChequeNo]    = useState('');
  const [bankName,    setBankName]    = useState('');
  const [txnNumber,   setTxnNumber]   = useState('');
  const [remarks,     setRemarks]     = useState('');
  const [receiptNo,   setReceiptNo]   = useState('');
  const [loading,     setLoading]     = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [error,       setError]       = useState('');
  const [receipt,     setReceipt]     = useState(null);
  const [settings,    setSettings]    = useState(null);

  useEffect(() => {
    window.api.counterGetNextReceipt(academicYear).then(r => {
      if (r.success) setReceiptNo(r.receipt_number);
    });
    window.api.feeSettingsGet(academicYear).then(r => {
      if (r.success && r.data) setSettings(r.data);
    });
  }, [academicYear]);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(''); setGroupData(null); setMemberItems({}); setAdjustments({});
    // Try GSL search first, then member search
    let res = await window.api.counterGetGroup(query.trim(), academicYear);
    if (!res.success) {
      // Try finding by SL or student name and getting their group
      const ledgerRes = await window.api.counterGetLedger(query.trim(), academicYear);
      if (ledgerRes.success && ledgerRes.ledger?.gsl_group_id) {
        const gslNum = ledgerRes.ledger.gsl_number;
        res = await window.api.counterGetGroup(gslNum, academicYear);
      }
    }
    setLoading(false);
    if (!res.success) { setError(res.message || 'No group found. Try entering the GSL number (e.g. GSL-001).'); return; }
    setGroupData(res);
    loadGroupChargeItems(res);
  };

  // Tuition, Transport, Annual/Exam and Admission Fee are never computed here
  // — they're read exactly as Auto Accrual already generated them for this
  // month, for each sibling individually. Late Fee is the one exception,
  // since it depends on today's date and can't be pre-generated in advance.
  const loadGroupChargeItems = (res) => {
    const { members, settings: s } = res;
    const sett = s || settings || { late_fee_per_day:5, grace_period_days:10, late_fee_annual_cap:1000 };
    const siblingConcessFrom = sett.sibling_concession_from || 3;

    // Sort members by class rank descending (oldest first) — purely for display/position
    const CLASS_RANK = { 'Nursery':0,'LKG':1,'UKG':2,'Class 1':3,'Class 2':4,'Class 3':5,
      'Class 4':6,'Class 5':7,'Class 6':8,'Class 7':9,'Class 8':10 };
    const sorted = [...members].sort((a,b) =>
      (CLASS_RANK[b.current_class]??-1) - (CLASS_RANK[a.current_class]??-1)
    );

    const itemsMap = {};
    const adj = {};
    const today   = new Date();
    const dueDay  = sett.grace_period_days || 10;
    sorted.forEach((m, idx) => {
      const position = idx + 1; // 1 = oldest
      const items = (m.currentMonthItems || []).map(i => ({ ...i }));

      // Late fee — always computed live (depends on today's date, not pre-generated)
      if (today.getDate() > dueDay) {
        const lateDays = today.getDate() - dueDay;
        const lateFee  = Math.min(lateDays * (sett.late_fee_per_day||5), sett.late_fee_annual_cap||1000);
        if (lateFee > 0) items.push({ description:`Late Fee (${lateDays} days × ₹${sett.late_fee_per_day||5})`, amount:lateFee, concession:0, concession_reason:'', fee_type:'', is_late_fee: true });
      }

      itemsMap[m.admission_number] = { member: m, items, position };

      const tuitionItem = items.find(i => i.fee_type === 'TUITION');
      adj[m.admission_number] = { concession: tuitionItem?.concession || 0, feesPaid: 0 };
    });
    setMemberItems(itemsMap);
    setAdjustments(adj);
  };

  const generateThisMonth = async () => {
    setGenerating(true); setError('');
    const res = await window.api.accrualGenerate(academicYear, user?.username);
    setGenerating(false);
    if (!res.success) { setError(res.message); return; }
    await search(); // refresh this group now that the month's been generated
  };

  const setMemberConcession = (admNo, val) => setAdjustments(prev => ({ ...prev, [admNo]: { ...prev[admNo], concession: val } }));
  const setMemberFeesPaid    = (admNo, val) => setAdjustments(prev => ({ ...prev, [admNo]: { ...prev[admNo], feesPaid: val } }));

  // Ledger-style rows — one per sibling, mirrors the printed group receipt.
  const summaryRows = Object.entries(memberItems).map(([admNo, { member, items }]) => {
    const buckets = { admission: 0, activity: 0, tuition: 0, transport: 0, others: 0 };
    const bucket_items = { admission: [], activity: [], tuition: [], transport: [], others: [] };
    items.forEach(i => {
      const key = bucketForFeeType(i.fee_type);
      buckets[key] += (i.amount || 0);
      bucket_items[key].push(i);
    });
    const prevBalance = member.prevBalance || 0;
    const alreadyPaid  = member.alreadyPaidThisMonth || 0;
    const currentDue  = Object.values(buckets).reduce((a,b) => a+b, 0);
    const totalDue     = prevBalance + currentDue;
    const { concession = 0, feesPaid = 0 } = adjustments[admNo] || {};
    return {
      admNo, sl_number: member.sl_number, student_name: member.student_name, father_name: member.father_name,
      current_class: member.current_class, section: member.section,
      previous_balance: prevBalance, buckets, bucket_items, total_due: totalDue,
      concession, fees_paid: feesPaid, alreadyPaidThisMonth: alreadyPaid,
      balance: Math.max(0, totalDue - concession - alreadyPaid - feesPaid),
    };
  });

  const anyAlreadyPaidThisMonth = summaryRows.reduce((s, r) => s + (r.alreadyPaidThisMonth || 0), 0);

  const anyNotGenerated = Object.values(memberItems).some(({ member }) => !member.currentMonthGenerated);
  const grandDue  = summaryRows.reduce((s, r) => s + (r.total_due - r.concession), 0);
  const paid      = summaryRows.reduce((s, r) => s + (r.fees_paid || 0), 0);
  const balance   = summaryRows.reduce((s, r) => s + r.balance, 0);
  const given     = amountGiven === '' ? paid : (parseFloat(amountGiven) || 0);
  const returnAmt = Math.max(0, given - paid);

  const savePayment = async () => {
    if (!groupData) return;
    if (paid <= 0) { setError('Please enter at least one student\'s Fees Paid amount.'); return; }
    if (!paidBy.trim()) { setError('Please enter who paid the fee (Paid By).'); return; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setError('Please enter the cheque number.'); return; }
    if (paymentMode === 'ONLINE' && !txnNumber.trim()) { setError('Please enter the transaction number.'); return; }
    setSaving(true); setError('');

    const saves = [];
    for (const [admNo, { member, items }] of Object.entries(memberItems)) {
      const { concession = 0, feesPaid = 0 } = adjustments[admNo] || {};
      if (feesPaid <= 0 && concession <= 0) continue;

      let finalItems = items.map(i => ({ ...i }));
      if (concession > 0) {
        const tuitionItem = finalItems.find(i => i.fee_type === 'TUITION');
        if (tuitionItem) {
          tuitionItem.concession = concession;
          tuitionItem.concession_reason = 'Concession/Adjustment';
        } else {
          finalItems.push({ description: 'Concession / Adjustment', amount: 0, concession, concession_reason: 'Concession/Adjustment', fee_type: '' });
        }
      }

      saves.push(window.api.counterSavePayment({
        academic_year:    academicYear,
        ledger_id:        member.ledger_id,
        group_id:         groupData.group.group_id,
        sl_number:        member.sl_number,
        receipt_number:   receiptNo,
        line_items:       finalItems,
        total_paid:       feesPaid,
        payment_mode:     paymentMode,
        remarks,
        center_id:        1,
        counter_id:       1,
        collected_by:     user?.username || '',
        paid_by:          paidBy.trim(),
        amount_tendered:  admNo === Object.keys(memberItems)[0] ? given : feesPaid, // physical amount tendered recorded once, on the first member's rows
        cheque_no:        chequeNo.trim(),
        bank_name:        bankName.trim(),
        txn_number:       txnNumber.trim(),
      }));
    }

    await Promise.all(saves);
    setSaving(false);

    // Show the printable receipt (fetched fresh from the DB, so it always matches what was saved)
    setReceipt(receiptNo);

    const nextRes = await window.api.counterGetNextReceipt(academicYear);
    if (nextRes.success) setReceiptNo(nextRes.receipt_number);
  };

  const resetForm = () => {
    setQuery(''); setGroupData(null); setMemberItems({}); setAdjustments({});
    setAmountGiven(''); setPaidBy('');
    setPaymentMode('CASH'); setChequeNo(''); setBankName(''); setTxnNumber('');
    setRemarks(''); setError('');
  };

  return (
    <div>
      {/* Search */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4 flex gap-3">
        <input value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          placeholder="Enter GSL number (e.g. GSL-001) or any member's SL/name..."
          className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
        <button onClick={search} disabled={loading}
          className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium disabled:bg-purple-300">
          {loading ? '⏳' : '🔍 Search Group'}
        </button>
        {groupData && <button onClick={resetForm} className="px-4 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Clear</button>}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {groupData && (
        <>
          {/* Info bar */}
          <div className="bg-purple-50 border border-purple-200 rounded-xl px-5 py-3 mb-4 flex items-center justify-between">
            <div className="flex gap-8 text-sm">
              <div><span className="text-purple-400 text-xs">GSL Number</span><p className="font-bold text-purple-800">{groupData.group.gsl_number}</p></div>
              <div><span className="text-purple-400 text-xs">Date</span><p className="font-bold text-purple-800">{today()}</p></div>
            </div>
            <div className="text-right">
              <p className="text-xs text-purple-400">Receipt No</p>
              <p className="text-lg font-bold text-purple-800">{receiptNo}</p>
            </div>
          </div>

          {anyNotGenerated && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl px-5 py-3 mb-4 flex items-center justify-between">
              <p className="text-sm text-amber-700">
                ⚠️ <strong>This month's fees haven't been generated yet</strong> for one or more siblings in this group —
                their Current Month columns will show ₹0 until then. You can still collect Previous Balance now.
              </p>
              <button onClick={generateThisMonth} disabled={generating}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium whitespace-nowrap ml-4">
                {generating ? '⏳ Generating...' : '⚡ Generate Now'}
              </button>
            </div>
          )}

          {anyAlreadyPaidThisMonth > 0 && (
            <div className="bg-blue-50 border border-blue-300 rounded-xl px-5 py-3 mb-4">
              <p className="text-sm text-blue-700">
                ℹ️ <strong>₹{fmt(anyAlreadyPaidThisMonth)} has already been paid</strong> for this group this month —
                the Balance below already accounts for that. This receipt only records any additional amount you enter now.
              </p>
            </div>
          )}

          {/* Receipt details — Paid By / Payment Mode / Counter, above the table like the printed receipt */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Paid By <span className="text-red-400">*</span></label>
                <input value={paidBy} onChange={e => setPaidBy(e.target.value)}
                  placeholder="Name of parent / guardian who paid"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment Mode</label>
                <div className="flex flex-wrap gap-2">
                  {['CASH','CHEQUE','ONLINE'].map(m => (
                    <button key={m} onClick={() => setPaymentMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
                        ${paymentMode===m?'bg-purple-600 text-white border-purple-600':'bg-white text-gray-600 border-gray-300 hover:border-purple-400'}`}>
                      {{CASH:'Cash', CHEQUE:'Cheque', ONLINE:'Online'}[m]}
                    </button>
                  ))}
                </div>
              </div>
              {paymentMode === 'CHEQUE' && (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Cheque No. <span className="text-red-400">*</span></label>
                    <input value={chequeNo} onChange={e => setChequeNo(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Bank Name</label>
                    <input value={bankName} onChange={e => setBankName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                  </div>
                </>
              )}
              {paymentMode === 'ONLINE' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Transaction No. <span className="text-red-400">*</span></label>
                  <input value={txnNumber} onChange={e => setTxnNumber(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
                </div>
              )}
            </div>
          </div>

          <FeeSummaryTable rows={summaryRows} showTotal={true}
            onConcessionChange={setMemberConcession}
            onFeesPaidChange={setMemberFeesPaid} />

          {/* Bottom summary — mirrors the printed receipt's totals block */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-2 text-sm">
              <div className="flex justify-between border-t border-gray-100 pt-2 mt-1">
                <span className="font-bold text-gray-700">Group Total Due</span>
                <span className="font-bold text-xl">{fmtINR(grandDue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Amount Paid by Guardian</span>
                <span className="font-bold text-lg text-green-700">{fmtINR(paid)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">Amount Given at Counter</span>
                <input type="number" min="0" value={amountGiven} onChange={e => setAmountGiven(e.target.value)}
                  placeholder={paid > 0 ? fmt(paid) : '0.00'}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-purple-400" />
              </div>
              <p className="text-[11px] text-gray-400">Only fill this in if the parent handed over more cash than needed (e.g. for change) — otherwise leave blank. Fees Paid for each student is entered directly in the table above.</p>
              <div className="flex justify-between"><span className="text-gray-500">Return Amount</span><span className="font-bold text-green-600">{fmtINR(returnAmt)}</span></div>
              {paid > 0 && <p className="text-xs text-gray-400 italic">Received with thanks {fmtINR(paid)}/- ({amountToWords(paid)})</p>}
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl p-4 space-y-3 text-sm">
              {balance > 0 && paid > 0 ? (
                <div className="flex justify-between text-red-600">
                  <span>Balance — carried forward as Previous Balance next time</span>
                  <span className="font-bold">{fmtINR(balance)}</span>
                </div>
              ) : (
                <p className="text-xs text-gray-400">No pending balance for this group once this payment is saved.</p>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remarks</label>
                <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={resetForm} className="px-6 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">Cancel</button>
            <button onClick={savePayment} disabled={saving || paid <= 0}
              className="px-8 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded-xl text-sm font-bold">
              {saving ? '⏳ Processing...' : '✅ Submit Group Payment'}
            </button>
          </div>
        </>
      )}

      {receipt && <PaperReceiptModal receiptNumber={receipt} academicYear={academicYear} onClose={() => setReceipt(null)} />}
    </div>
  );
}


// ── Cancel Payment Tab ────────────────────────────────────────
function CancelTab({ academicYear }) {
  const { user } = useAuth();
  const [query,   setQuery]   = useState('');
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [success, setSuccess] = useState('');

  const search = async () => {
    setLoading(true); setError(''); setSuccess(''); setReceipt(null);
    const res = await window.api.counterGetReceipt(query.trim(), academicYear);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setReceipt(res.data);
  };

  const cancel = async () => {
    const res = await window.api.counterCancelPayment(query.trim(), academicYear, user?.username);
    if (res.success) { setSuccess('Receipt ' + query + ' cancelled successfully.'); setReceipt(null); setQuery(''); }
    else setError(res.message);
  };

  const rows     = receipt || [];
  const paid     = rows.filter(r => r.transaction_type === 'RECEIVED').reduce((s,r) => s + (r.credit||0), 0);
  const isCancelled = rows.some(r => r.status === 'CANCELLED');
  const isPosted    = rows.some(r => r.schedule_id && r.schedule_id !== '');

  return (
    <div className="max-w-xl">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <label className="block text-xs font-medium text-gray-500 mb-1">Receipt Number</label>
        <div className="flex gap-3">
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. 2026-001"
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={search} disabled={loading}
            className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium">
            {loading ? '⏳' : 'Search'}
          </button>
        </div>
      </div>

      {error   && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
      {success && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">✅ {success}</div>}

      {receipt && (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
            <div>
              <p className="font-bold text-gray-800">Receipt {query}</p>
              <p className="text-xs text-gray-500">{rows[0]?.student_name} · {rows[0]?.current_class}</p>
            </div>
            <span className={`text-xs font-bold px-3 py-1 rounded-full ${isCancelled ? 'bg-red-100 text-red-600' : isPosted ? 'bg-gray-200 text-gray-600' : 'bg-green-100 text-green-700'}`}>
              {isCancelled ? 'CANCELLED' : isPosted ? 'POSTED' : 'PENDING'}
            </span>
          </div>
          <div className="px-5 py-4">
            <div className="flex justify-between text-sm mb-4">
              <span className="text-gray-500">Amount Paid</span>
              <span className="font-bold text-lg">{fmtINR(paid)}</span>
            </div>
            <div className="space-y-1 text-xs text-gray-500 mb-4">
              {rows.filter(r => r.transaction_type === 'RECEIVABLE').map((r, i) => (
                <div key={i} className="flex justify-between">
                  <span>{r.description}</span>
                  <span>₹{fmt(r.debit)}</span>
                </div>
              ))}
            </div>
            {!isCancelled && !isPosted && (
              <button onClick={cancel}
                className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-bold">
                ❌ Cancel This Receipt
              </button>
            )}
            {isCancelled && <p className="text-center text-red-500 text-sm font-medium">This receipt has already been cancelled</p>}
            {isPosted    && <p className="text-center text-gray-500 text-sm">This receipt has been posted and cannot be cancelled at counter level</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Bulk Receivable Entry Tab ─────────────────────────────────
const FEE_TYPE_OPTIONS = [
  { key: 'TUITION',      label: 'Tuition Fee',              frequency: 'Monthly'   },
  { key: 'TRANSPORT',    label: 'Transport Fee',             frequency: 'Monthly'   },
  { key: 'COMPUTER',     label: 'Computer Fee',              frequency: 'Annual'    },
  { key: 'ACTIVITY',     label: 'Activity / Sports Fee',     frequency: 'Annual'    },
  { key: 'LIBRARY',      label: 'Library Fee',               frequency: 'Annual'    },
  { key: 'LAB',          label: 'Lab Fee',                   frequency: 'Annual'    },
  { key: 'WELLNESS',     label: 'Campus Wellness',           frequency: 'Annual'    },
  { key: 'BOOKS',        label: 'Books Fee',                 frequency: 'Annual'    },
  { key: 'EXAM_HY',      label: 'Exam Fee (Half Yearly)',    frequency: 'Twice/yr'  },
  { key: 'EXAM_ANNUAL',  label: 'Exam Fee (Annual)',         frequency: 'Twice/yr'  },
];

const MONTH_OPTIONS = [
  ['04','April'],['05','May'],['06','June'],['07','July'],['08','August'],['09','September'],
  ['10','October'],['11','November'],['12','December'],['01','January'],['02','February'],['03','March'],
];

function BulkEntryTab({ academicYear }) {
  const { user }     = useAuth();
  const [month,      setMonth]      = useState(String(new Date().getMonth()+1).padStart(2,'0'));
  const [year,       setYear]       = useState(String(new Date().getFullYear()));
  const [feeTypes,   setFeeTypes]   = useState(new Set(['TUITION']));
  const [preview,    setPreview]    = useState(null);
  const [excluded,   setExcluded]   = useState(new Set()); // ledger_ids to skip
  const [loading,    setLoading]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(null);
  const [error,      setError]      = useState('');
  const [confirmed,  setConfirmed]  = useState(false);

  const toggleFeeType = (key) => setFeeTypes(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });

  const toggleExclude = (id) => setExcluded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const loadPreview = async () => {
    if (feeTypes.size === 0) { setError('Select at least one fee type.'); return; }
    setLoading(true); setError(''); setPreview(null); setConfirmed(false); setSaved(null);
    const res = await window.api.counterGetBulkPreview(academicYear, month, year, Array.from(feeTypes));
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    setPreview(res);
    setExcluded(new Set(res.data.filter(s => s.lines.every(l => l.already_charged)).map(s => s.ledger_id)));
  };

  const saveAll = async () => {
    setSaving(true); setError('');
    const entries = preview.data
      .filter(s => !excluded.has(s.ledger_id))
      .map(s => ({
        ledger_id: s.ledger_id,
        sl_number: s.sl_number,
        lines: s.lines,
      }));
    const res = await window.api.counterSaveBulkReceivable(academicYear, entries, user?.username, 1, month, year);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    const total = entries.reduce((s,e) => s + e.lines.filter(l=>!l.already_charged&&!l.excluded).reduce((a,l)=>a+(l.amount||0)-(l.concession||0),0), 0);
    setSaved({ count: entries.length, total, monthLabel: preview.month_label });
    setPreview(null); setConfirmed(false);
  };

  const includedStudents = preview ? preview.data.filter(s => !excluded.has(s.ledger_id)) : [];
  const totalAmount = includedStudents.reduce((s,st) => s + st.total, 0);
  const alreadyChargedCount = preview ? preview.data.filter(s => s.lines.every(l => l.already_charged)).length : 0;

  return (
    <div>
      {/* Config panel */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-4">
        <h3 className="font-bold text-gray-700 mb-4 text-sm">Bulk Receivable Entry</h3>
        <p className="text-xs text-gray-500 mb-4 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          This creates fee <strong>due</strong> entries (debits) for all students in the ledger for the selected month.
          Use this to post April/May fees that were collected on paper before the system was set up.
          Payments received against these dues should be entered separately through Counter Payment.
        </p>

        <div className="grid grid-cols-2 gap-5">
          {/* Month + Year */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Month to Post</label>
            <div className="flex gap-2">
              <select value={month} onChange={e => { setMonth(e.target.value); setPreview(null); }}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {MONTH_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
              </select>
              <input value={year} onChange={e => { setYear(e.target.value); setPreview(null); }}
                className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Fee types */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Fee Types to Include</label>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {FEE_TYPE_OPTIONS.map(ft => (
                <label key={ft.key} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={feeTypes.has(ft.key)}
                    onChange={() => { toggleFeeType(ft.key); setPreview(null); }}
                    className="w-4 h-4 accent-blue-600" />
                  <span className="text-sm text-gray-700 group-hover:text-blue-700">{ft.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{ft.frequency}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={loadPreview} disabled={loading}
            className="px-8 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white text-sm font-medium rounded-xl">
            {loading ? '⏳ Loading Preview...' : '👁 Preview'}
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {saved && (
        <div className="bg-green-50 border border-green-300 rounded-2xl p-5 mb-4 text-center">
          <p className="text-3xl mb-2">✅</p>
          <p className="text-lg font-bold text-green-700">Receivables Posted!</p>
          <p className="text-sm text-green-600 mt-1">
            {saved.count} students · {saved.monthLabel} · Total ₹{Number(saved.total).toFixed(2)}
          </p>
          <p className="text-xs text-gray-500 mt-2">
            These are now in staging. Go to Day-End Posting to post them to the main ledger.
          </p>
          <button onClick={() => setSaved(null)} className="mt-3 text-xs text-blue-600 underline">
            Post another month
          </button>
        </div>
      )}

      {/* Preview table */}
      {preview && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{includedStudents.length}</p>
              <p className="text-xs text-blue-500">Students to post</p>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-green-700">₹{Number(totalAmount).toFixed(2)}</p>
              <p className="text-xs text-green-500">Total Receivable</p>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-amber-600">{alreadyChargedCount}</p>
              <p className="text-xs text-amber-500">Already charged (auto-skipped)</p>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
            <div className="bg-gray-50 border-b border-gray-200 px-5 py-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-700">
                Preview — {preview.month_label} · {preview.data.length} students
              </p>
              <div className="flex gap-2">
                <button onClick={() => setExcluded(new Set())}
                  className="text-xs text-blue-600 border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-50">
                  Include All
                </button>
                <button onClick={() => setExcluded(new Set(preview.data.map(s => s.ledger_id)))}
                  className="text-xs text-gray-500 border border-gray-200 px-3 py-1 rounded-lg hover:bg-gray-50">
                  Exclude All
                </button>
              </div>
            </div>

            <div className="max-h-[45vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold w-8">✓</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold">SL</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold">Student</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold">Class</th>
                    <th className="px-3 py-2.5 text-left text-gray-500 font-semibold">Fee Lines</th>
                    <th className="px-3 py-2.5 text-right text-gray-500 font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.data.map((s, i) => {
                    const isExcluded = excluded.has(s.ledger_id);
                    const allCharged = s.lines.every(l => l.already_charged);
                    return (
                      <tr key={s.ledger_id}
                        className={`${isExcluded||allCharged ? 'opacity-40' : i%2===0 ? 'bg-white' : 'bg-gray-50'}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={!isExcluded && !allCharged}
                            disabled={allCharged}
                            onChange={() => toggleExclude(s.ledger_id)}
                            className="w-4 h-4 accent-blue-600" />
                        </td>
                        <td className="px-3 py-2 font-bold text-blue-700">{s.sl_number}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">{s.student_name}</td>
                        <td className="px-3 py-2 text-gray-500">{s.current_class}</td>
                        <td className="px-3 py-2">
                          <div className="space-y-0.5">
                            {s.lines.map((l, li) => (
                              <div key={li} className="flex items-center gap-2">
                                <span className={`${l.already_charged ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                                  {l.description}
                                </span>
                                <span className="text-gray-500">₹{l.amount}</span>
                                {l.concession > 0 && (
                                  <span className="text-purple-500">-₹{l.concession}</span>
                                )}
                                {l.already_charged && (
                                  <span className="text-amber-500 font-medium">already charged</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-gray-800">
                          {allCharged ? <span className="text-gray-400">—</span> : `₹${s.total.toFixed(2)}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Confirm & Post */}
          {!confirmed ? (
            <div className="flex justify-end">
              <button onClick={() => setConfirmed(true)}
                className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm shadow-sm">
                📮 Post {includedStudents.length} Students → Staging
              </button>
            </div>
          ) : (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 flex items-center justify-between">
              <div>
                <p className="font-bold text-amber-800">Confirm Bulk Receivable Entry</p>
                <p className="text-sm text-amber-700 mt-0.5">
                  This will create <strong>{includedStudents.length}</strong> receivable entries
                  totalling <strong>₹{totalAmount.toFixed(2)}</strong> for <strong>{preview.month_label}</strong>.
                  <br />They will go into staging — post them via Day-End Posting when ready.
                </p>
              </div>
              <div className="flex gap-3 shrink-0 ml-4">
                <button onClick={() => setConfirmed(false)}
                  className="px-5 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm">
                  Cancel
                </button>
                <button onClick={saveAll} disabled={saving}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-bold disabled:bg-green-300">
                  {saving ? '⏳ Posting...' : '✅ Confirm & Post'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────
export default function CounterPayment() {
  const [tab,          setTab]          = useState('individual');
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);

  const { user: currentUser } = useAuth();
  const TABS = [
    { key: 'individual', label: '👤 Individual Payment' },
    { key: 'group',      label: '👨‍👧‍👦 Group Payment'     },
    ...((['super_admin','admin'].includes(currentUser?.role))
      ? [{ key: 'bulk', label: '📋 Bulk Entry' }] : []),
    { key: 'cancel',     label: '❌ Cancel Payment'     },
  ];

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <h2 className="text-xl font-bold text-gray-800">Counter Payment</h2>
        <p className="text-sm text-gray-500 mt-0.5">Collect fees and generate receipts</p>
      </div>

      <MissingFeesBanner academicYear={academicYear} />

      <div className="flex items-center gap-4 mb-5">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
                ${tab === t.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-gray-500">Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {tab === 'individual' && <IndividualTab academicYear={academicYear} />}
      {tab === 'group'      && <GroupTab      academicYear={academicYear} />}
      {tab === 'bulk'       && <BulkEntryTab  academicYear={academicYear} />}
      {tab === 'cancel'     && <CancelTab     academicYear={academicYear} />}
    </div>
  );
}
