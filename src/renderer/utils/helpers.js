// utils/helpers.js — shared utility functions

// ── Format date as DD/MM/YYYY ─────────────────────────────────
export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

// ── Today as YYYY-MM-DD (for date inputs) ────────────────────
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── Current academic year e.g. "2025-26" ─────────────────────
export function currentAcademicYear() {
  const now = new Date();
  const y   = now.getFullYear();
  return now.getMonth() >= 3
    ? `${y}-${String(y + 1).slice(2)}`
    : `${y - 1}-${String(y).slice(2)}`;
}

export const ACADEMIC_YEARS = Array.from({ length: 4 }, (_, i) => {
  const y = new Date().getFullYear() - 1 + i;
  return `${y}-${String(y + 1).slice(2)}`;
});

export const CLASSES = [
  'Nursery','LKG','UKG',
  'Class 1','Class 2','Class 3','Class 4','Class 5',
  'Class 6','Class 7','Class 8','Class 9','Class 10',
  'Class 11','Class 12',
];

export const MONTHS = [
  'April','May','June','July','August','September',
  'October','November','December','January','February','March',
];

// ── Amount to words (Indian style) ───────────────────────────
const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
              'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
              'Seventeen','Eighteen','Nineteen'];
const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function numToWords(n) {
  if (n === 0) return 'Zero';
  if (n < 0)   return 'Minus ' + numToWords(-n);

  let words = '';
  if (Math.floor(n / 10000000) > 0) {
    words += numToWords(Math.floor(n / 10000000)) + ' Crore ';
    n %= 10000000;
  }
  if (Math.floor(n / 100000) > 0) {
    words += numToWords(Math.floor(n / 100000)) + ' Lakh ';
    n %= 100000;
  }
  if (Math.floor(n / 1000) > 0) {
    words += numToWords(Math.floor(n / 1000)) + ' Thousand ';
    n %= 1000;
  }
  if (Math.floor(n / 100) > 0) {
    words += numToWords(Math.floor(n / 100)) + ' Hundred ';
    n %= 100;
  }
  if (n > 0) {
    if (n < 20) {
      words += ones[n] + ' ';
    } else {
      words += tens[Math.floor(n / 10)] + ' ';
      if (n % 10 > 0) words += ones[n % 10] + ' ';
    }
  }
  return words.trim();
}

export function amountToWords(amount) {
  if (!amount && amount !== 0) return '';
  const rupees = Math.floor(amount);
  const paise  = Math.round((amount - rupees) * 100);
  let result   = 'Rupees ' + numToWords(rupees);
  if (paise > 0) result += ' and ' + numToWords(paise) + ' Paise';
  return result + ' Only';
}

// ── Format currency ───────────────────────────────────────────
export function fmtRupees(amount) {
  if (amount === null || amount === undefined) return '₹0';
  return `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
