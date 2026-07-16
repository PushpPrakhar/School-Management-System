import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';
import Prospectus from './Prospectus';
import OtherIncomeReceiptModal from '../components/OtherIncomeReceiptModal';

const SESSION_YEAR = (() => { const n = new Date(), y = n.getFullYear(); return n.getMonth() >= 3 ? y : y - 1; })();
const CURRENT_YEAR = `${SESSION_YEAR}-${String(SESSION_YEAR + 1).slice(2)}`;
const YEARS = Array.from({ length: 5 }, (_, i) => { const y = SESSION_YEAR - 1 + i; return `${y}-${String(y + 1).slice(2)}`; });

const fmt    = (n) => Number(n || 0).toFixed(2);
const fmtINR = (n) => '₹' + fmt(n);

// ── Sub-tab: Manage Items (the catalog) ─────────────────────────
function ManageItemsTab({ academicYear }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.otherIncomeGetItems(academicYear);
    setLoading(false);
    if (res.success) setItems(res.data.map(i => ({ ...i })));
  }, [academicYear]);

  useEffect(() => { load(); }, [load]);

  const updateItem = (idx, field, val) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
    setSaved(false);
  };
  const addItem = () => setItems(prev => [...prev, { item_name: '', amount: 0 }]);
  const removeItem = async (idx) => {
    const item = items[idx];
    if (item.item_id) {
      await window.api.otherIncomeDeleteItem(item.item_id);
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    const cleaned = items.filter(i => i.item_name.trim());
    setSaving(true); setError('');
    const res = await window.api.otherIncomeSaveItems(academicYear, cleaned);
    setSaving(false);
    if (!res.success) { setError(res.message); return; }
    setSaved(true); setTimeout(() => setSaved(false), 3000);
    load();
  };

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">
        Set up the items you sell (Tie, Belt, ID Card, etc.) with a fixed price. These will show up as columns when collecting payment.
      </p>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}
      {saved && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 mb-4 text-sm text-green-700">✅ Saved</div>}

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold">Item Name</th>
              <th className="px-4 py-2.5 text-left text-xs text-gray-500 font-semibold w-40">Price (₹)</th>
              <th className="px-4 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={3} className="text-center py-8 text-gray-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-8 text-gray-400">No items yet — add one below</td></tr>
            ) : items.map((it, idx) => (
              <tr key={it.item_id || `new-${idx}`}>
                <td className="px-4 py-2">
                  <input value={it.item_name} onChange={e => updateItem(idx, 'item_name', e.target.value)}
                    placeholder="e.g. Tie"
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </td>
                <td className="px-4 py-2">
                  <input type="number" min="0" value={it.amount} onChange={e => updateItem(idx, 'amount', parseFloat(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                </td>
                <td className="px-4 py-2 text-center">
                  <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700 text-sm">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={addItem} className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Add Item</button>
        </div>
      </div>

      <button onClick={save} disabled={saving}
        className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium">
        {saving ? '⏳ Saving...' : '💾 Save Items'}
      </button>
    </div>
  );
}

// ── Sub-tab: Collect Payment ─────────────────────────────────────
function CollectPaymentTab({ academicYear }) {
  const { user } = useAuth();
  const [catalog,    setCatalog]    = useState([]);
  const [query,      setQuery]      = useState('');
  const [results,    setResults]    = useState([]);
  const [cart,       setCart]       = useState([]); // [{ admission_number, sl_number, student_name, father_name, current_class, section, itemAmounts: {item_name: amount}, concession, amountPaid }]
  const [paidBy,     setPaidBy]     = useState('');
  const [paymentMode,setPaymentMode]= useState('CASH');
  const [chequeNo,   setChequeNo]   = useState('');
  const [bankName,   setBankName]   = useState('');
  const [txnNumber,  setTxnNumber]  = useState('');
  const [amountGiven,setAmountGiven]= useState('');
  const [receiptNo,  setReceiptNo]  = useState('');
  const [searching,  setSearching]  = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [receipt,    setReceipt]    = useState(null);

  useEffect(() => {
    window.api.otherIncomeGetItems(academicYear).then(r => { if (r.success) setCatalog(r.data); });
    window.api.otherIncomeGetNextReceipt(academicYear).then(r => { if (r.success) setReceiptNo(r.receipt_number); });
  }, [academicYear]);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await window.api.otherIncomeSearchStudents(query.trim(), academicYear);
    setSearching(false);
    if (res.success) setResults(res.data);
  };

  const addToCart = (student) => {
    if (cart.some(c => c.admission_number === student.admission_number)) return;
    const itemAmounts = {};
    catalog.forEach(it => { itemAmounts[it.item_name] = it.amount; });
    setCart(prev => [...prev, {
      admission_number: student.admission_number, sl_number: student.sl_number || '',
      student_name: student.student_name, father_name: student.father_name,
      current_class: student.current_class, section: student.section,
      itemAmounts, concession: 0, amountPaid: 0,
    }]);
    setResults([]); setQuery('');
  };

  const removeFromCart = (admNo) => setCart(prev => prev.filter(c => c.admission_number !== admNo));
  const updateCartItemAmount = (admNo, itemName, val) => {
    setCart(prev => prev.map(c => c.admission_number === admNo
      ? { ...c, itemAmounts: { ...c.itemAmounts, [itemName]: val } } : c));
  };
  const updateCartField = (admNo, field, val) => {
    setCart(prev => prev.map(c => c.admission_number === admNo ? { ...c, [field]: val } : c));
  };

  const rowTotal = (c) => Object.values(c.itemAmounts).reduce((s, v) => s + (v || 0), 0);
  const grandTotal    = cart.reduce((s, c) => s + rowTotal(c), 0);
  const grandConcession = cart.reduce((s, c) => s + (c.concession || 0), 0);
  const grandPaid      = cart.reduce((s, c) => s + (c.amountPaid || 0), 0);
  const given = amountGiven === '' ? grandPaid : (parseFloat(amountGiven) || 0);
  const returnAmt = Math.max(0, given - grandPaid);

  const savePayment = async () => {
    if (cart.length === 0) { setError('Add at least one student.'); return; }
    if (grandPaid <= 0) { setError('Please enter the amount paid.'); return; }
    if (!paidBy.trim()) { setError('Please enter who paid (Paid By).'); return; }
    if (paymentMode === 'CHEQUE' && !chequeNo.trim()) { setError('Please enter the cheque number.'); return; }
    if (paymentMode === 'ONLINE' && !txnNumber.trim()) { setError('Please enter the transaction number.'); return; }
    setSaving(true); setError('');

    const entries = cart.map(c => ({
      admission_number: c.admission_number, sl_number: c.sl_number, student_name: c.student_name,
      father_name: c.father_name, current_class: c.current_class, section: c.section,
      items: Object.entries(c.itemAmounts).filter(([, amt]) => amt > 0).map(([item_name, amount], idx) => ({
        item_name, amount,
        concession: idx === 0 ? (c.concession || 0) : 0, // concession applied against the first charged item
        amount_paid: idx === 0 ? (c.amountPaid || 0) : 0, // paid amount recorded once per student
      })),
    }));

    const res = await window.api.otherIncomeSavePayment({
      academic_year: academicYear, receipt_number: receiptNo, entries,
      payment_mode: paymentMode, paid_by: paidBy.trim(), amount_tendered: given,
      cheque_no: chequeNo.trim(), bank_name: bankName.trim(), txn_number: txnNumber.trim(),
      center_id: 1, counter_id: 1, collected_by: user?.username || '',
    });
    setSaving(false);
    if (!res.success) { setError(res.message); return; }

    setReceipt(receiptNo);
    setCart([]); setPaidBy(''); setAmountGiven(''); setChequeNo(''); setBankName(''); setTxnNumber(''); setPaymentMode('CASH');
    const nextRes = await window.api.otherIncomeGetNextReceipt(academicYear);
    if (nextRes.success) setReceiptNo(nextRes.receipt_number);
  };

  return (
    <div>
      {catalog.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-sm text-amber-700">
          ⚠️ No items set up yet — add some in the "Manage Items" tab first.
        </div>
      )}

      {/* Search & add students */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
        <div className="flex gap-3">
          <input value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="Search student by name, SL number, or admission number..."
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <button onClick={search} disabled={searching}
            className="px-6 py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-medium disabled:bg-blue-300">
            {searching ? '⏳' : '🔍 Search'}
          </button>
        </div>
        {results.length > 0 && (
          <div className="mt-3 divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
            {results.map(s => (
              <button key={s.admission_number} onClick={() => addToCart(s)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50 text-left">
                <span className="text-xs font-bold text-blue-700 w-16 shrink-0">{s.sl_number || '—'}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">{s.student_name}</p>
                  <p className="text-xs text-gray-400">{s.father_name} · {s.current_class} {s.section}</p>
                </div>
                <span className="text-blue-600 text-xs font-medium">+ Add</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-4 text-sm text-red-600">{error}</div>}

      {cart.length > 0 && (
        <>
          {/* Receipt details */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 mb-4 flex items-center justify-between">
            <div className="flex gap-8 text-sm">
              <div><span className="text-blue-500 text-xs">Date</span><p className="font-bold text-blue-800">{new Date().toLocaleDateString('en-GB').split('/').join('-')}</p></div>
            </div>
            <div className="text-right">
              <p className="text-xs text-blue-500">Receipt No</p>
              <p className="text-lg font-bold text-blue-800">{receiptNo}</p>
            </div>
          </div>

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
            </div>
          </div>

          {/* Cart table */}
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden mb-4">
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-700">🛒 Items being charged — type directly into any amount</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200 text-center">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Student &amp; Class</th>
                    {catalog.map(it => <th key={it.item_id} className="px-2 py-1.5">{it.item_name}</th>)}
                    <th className="px-2 py-1.5 border-l border-gray-200">Total</th>
                    <th className="px-2 py-1.5 bg-amber-50">Concession</th>
                    <th className="px-2 py-1.5 bg-amber-50">Amount Paid</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map(c => (
                    <tr key={c.admission_number} className="border-b border-gray-100">
                      <td className="px-2 py-1.5 text-left">
                        <span className="font-semibold text-blue-700">{c.sl_number || c.admission_number}</span> {c.student_name}
                        <span className="text-gray-400"> — {c.current_class} {c.section}</span>
                      </td>
                      {catalog.map(it => (
                        <td key={it.item_id} className="px-2 py-1.5">
                          <input type="number" min="0" value={c.itemAmounts[it.item_name] || ''}
                            onChange={e => updateCartItemAmount(c.admission_number, it.item_name, parseFloat(e.target.value) || 0)}
                            placeholder="0" className="w-16 text-right border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </td>
                      ))}
                      <td className="px-2 py-1.5 text-right font-semibold border-l border-gray-100">{fmt(rowTotal(c))}</td>
                      <td className="px-2 py-1.5 bg-amber-50">
                        <input type="number" min="0" value={c.concession || ''}
                          onChange={e => updateCartField(c.admission_number, 'concession', parseFloat(e.target.value) || 0)}
                          placeholder="0" className="w-16 text-right border border-amber-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-2 py-1.5 bg-amber-50">
                        <input type="number" min="0" value={c.amountPaid || ''}
                          onChange={e => updateCartField(c.admission_number, 'amountPaid', parseFloat(e.target.value) || 0)}
                          placeholder="0.00" className="w-20 text-right border border-amber-200 rounded px-1.5 py-1 bg-white font-semibold focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button onClick={() => removeFromCart(c.admission_number)} className="text-red-400 hover:text-red-600">✕</button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50 font-bold">
                    <td className="px-2 py-1.5 text-left">Total</td>
                    {catalog.map(it => (
                      <td key={it.item_id} className="px-2 py-1.5 text-right">
                        {fmt(cart.reduce((s, c) => s + (c.itemAmounts[it.item_name] || 0), 0))}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right border-l border-gray-100">{fmt(grandTotal)}</td>
                    <td className="px-2 py-1.5 text-right">{fmt(grandConcession)}</td>
                    <td className="px-2 py-1.5 text-right text-green-700">{fmt(grandPaid)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Bottom summary */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-4">
            <div className="flex gap-6 items-center flex-wrap">
              <p className="text-sm"><span className="text-gray-500">Amount Paid:</span> <span className="font-bold text-lg">{fmtINR(grandPaid)}</span></p>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-xs">Amount Given at Counter</span>
                <input type="number" min="0" value={amountGiven} onChange={e => setAmountGiven(e.target.value)}
                  placeholder={grandPaid > 0 ? fmt(grandPaid) : '0.00'}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-right text-sm w-32 focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </div>
              {returnAmt > 0 && <p className="text-sm text-green-600"><span>Return:</span> <span className="font-bold">{fmtINR(returnAmt)}</span></p>}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => setCart([])} className="px-6 py-2.5 border border-gray-300 text-gray-600 hover:bg-gray-50 rounded-xl text-sm font-medium">Cancel</button>
            <button onClick={savePayment} disabled={saving || grandPaid <= 0}
              className="px-8 py-2.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded-xl text-sm font-bold">
              {saving ? '⏳ Processing...' : '✅ Submit & Generate Receipt'}
            </button>
          </div>
        </>
      )}

      {receipt && <OtherIncomeReceiptModal receiptNumber={receipt} academicYear={academicYear} onClose={() => setReceipt(null)} />}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────
export default function OtherIncome() {
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [section, setSection] = useState('prospectus'); // 'prospectus' | 'other'
  const [subTab,  setSubTab]  = useState('collect');     // 'collect' | 'manage' (within Other Charges)

  return (
    <div className="max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-800">Other Income</h2>
          <p className="text-sm text-gray-500 mt-0.5">Prospectus sales and other charges — separate from fee collection</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Year</span>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none">
            {YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-5">
        <button onClick={() => setSection('prospectus')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
            ${section === 'prospectus' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          📘 Prospectus
        </button>
        <button onClick={() => setSection('other')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
            ${section === 'other' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          🎽 Other Charges
        </button>
      </div>

      {section === 'prospectus' && <Prospectus />}

      {section === 'other' && (
        <div>
          <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-5">
            <button onClick={() => setSubTab('collect')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
                ${subTab === 'collect' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              💳 Collect Payment
            </button>
            <button onClick={() => setSubTab('manage')}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
                ${subTab === 'manage' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              ⚙️ Manage Items
            </button>
          </div>
          {subTab === 'collect' && <CollectPaymentTab academicYear={academicYear} />}
          {subTab === 'manage'  && <ManageItemsTab academicYear={academicYear} />}
        </div>
      )}
    </div>
  );
}
