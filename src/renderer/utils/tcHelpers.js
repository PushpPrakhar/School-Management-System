// Pure helpers for the Transfer Certificate form. No React, no I/O — kept
// separate so the date-to-words and class logic can be tested in isolation.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const below100 = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : ''));

// 2014 -> "Two Thousand Fourteen", 1999 -> "Nineteen Ninety Nine".
export function yearInWords(y) {
  if (!Number.isInteger(y) || y < 1900 || y > 2099) return '';
  const rest = y % 100;
  if (y >= 2000) return 'Two Thousand' + (rest ? ' ' + below100(rest) : '');
  return below100(Math.floor(y / 100)) + ' ' + (rest ? below100(rest) : 'Hundred');
}

// Accepts 'YYYY-MM-DD', 'DD-MM-YYYY' or 'DD/MM/YYYY' (the app has stored
// dates in more than one shape over time). Returns { y, m, d } or null for
// anything unusable — including the schema's '00-00-0000' placeholder.
export function parseDate(str) {
  if (!str) return null;
  const s = String(str).trim().slice(0, 10);
  let y, m, d, mt;
  if ((mt = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else return null;
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // e.g. 31 Feb
  return { y, m, d };
}

// -> 'YYYY-MM-DD' for <input type="date">, or '' if unusable.
export function toISO(str) {
  const p = parseDate(str);
  return p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : '';
}

// -> 'DD-MM-YYYY' for printing, or '' if unusable.
export function toDMY(str) {
  const p = parseDate(str);
  return p ? `${String(p.d).padStart(2, '0')}-${String(p.m).padStart(2, '0')}-${p.y}` : '';
}

// 2014-07-13 -> "Thirteen July Two Thousand Fourteen"
export function dateInWords(str) {
  const p = parseDate(str);
  if (!p) return '';
  const yw = yearInWords(p.y);
  if (!yw) return '';
  return `${below100(p.d)} ${MONTHS[p.m - 1]} ${yw}`;
}

// ── Classes ──────────────────────────────────────────────────
const CLASS_ORDER = ['Nursery', 'LKG', 'UKG', 'Class 1', 'Class 2', 'Class 3', 'Class 4',
  'Class 5', 'Class 6', 'Class 7', 'Class 8'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

// 'Class 5' -> 'V'; Nursery / LKG / UKG are left as they are.
export function classLabel(cls) {
  const m = String(cls || '').match(/^Class (\d+)$/i);
  if (m) return ROMAN[+m[1]] || m[1];
  return String(cls || '');
}

// The class a student moves up to. Class 8 is the school's last class, so
// its next step is IX (at another school).
export function nextClassLabel(cls) {
  const i = CLASS_ORDER.indexOf(cls);
  if (i === -1) return '';
  if (i === CLASS_ORDER.length - 1) return 'IX';
  return classLabel(CLASS_ORDER[i + 1]);
}

// Starting point for the "Subject studied" line, which the issuer can edit
// per certificate. Class 1-5 follows the school's existing Class V TC; the
// other bands are best-guess equivalents of the same style.
export function defaultSubjects(cls) {
  if (cls === 'Nursery' || cls === 'LKG') return 'Hindi, English, Maths and Drawing';
  if (cls === 'UKG') return 'Hindi, English, EVS, Maths, Computer and Drawing';
  const m = String(cls || '').match(/^Class (\d+)$/i);
  if (m) {
    const n = +m[1];
    if (n <= 5) return 'Hindi, English, Maths, Science/EVS and S.St';
    return 'Hindi, English, Maths, Science and S.St';
  }
  return '';
}

// The schema fills unknown values with placeholders ('NOT PROVIDED',
// '00-00-0000', an all-ones PEN). Those must never be printed on a
// certificate, so they are treated as blank for the issuer to fill in.
const PLACEHOLDERS = new Set(['NOT PROVIDED', 'NOT APPLICABLE', '00-00-0000', '11111111111', '']);
export function clean(v) {
  const s = String(v == null ? '' : v).trim();
  return PLACEHOLDERS.has(s.toUpperCase()) ? '' : s;
}
