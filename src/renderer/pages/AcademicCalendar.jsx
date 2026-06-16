import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../utils/AuthContext';

// ── Constants ─────────────────────────────────────────────────
const CURRENT_SESSION_YEAR = (() => {
  const now = new Date(); const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1;
})();
const CURRENT_YEAR = `${CURRENT_SESSION_YEAR}-${String(CURRENT_SESSION_YEAR+1).slice(2)}`;
const ACADEMIC_YEARS = Array.from({ length: 4 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 1 + i;
  return `${y}-${String(y+1).slice(2)}`;
});

// Academic year runs April → March
// Base months structure — year is computed dynamically from the selected academic year
const ACADEMIC_MONTHS_BASE = [
  { month: '04', label: 'April',     firstHalf: true  },
  { month: '05', label: 'May',       firstHalf: true  },
  { month: '06', label: 'June',      firstHalf: true  },
  { month: '07', label: 'July',      firstHalf: true  },
  { month: '08', label: 'August',    firstHalf: true  },
  { month: '09', label: 'September', firstHalf: true  },
  { month: '10', label: 'October',   firstHalf: true  },
  { month: '11', label: 'November',  firstHalf: true  },
  { month: '12', label: 'December',  firstHalf: true  },
  { month: '01', label: 'January',   firstHalf: false },
  { month: '02', label: 'February',  firstHalf: false },
  { month: '03', label: 'March',     firstHalf: false },
];

// Build ACADEMIC_MONTHS with correct years from a given academic year string
// e.g. "2025-26" → first year = 2025, second year = 2026
const getAcademicMonths = (academicYear) => {
  const firstYear = parseInt(academicYear?.split('-')[0]) || CURRENT_SESSION_YEAR;
  return ACADEMIC_MONTHS_BASE.map(m => ({
    ...m,
    year: m.firstHalf ? firstYear : firstYear + 1,
  }));
};

// Default for initial render
const ACADEMIC_MONTHS = getAcademicMonths(CURRENT_YEAR);

const DAY_TYPES = {
  WORKING:  { label: 'Working Day',  color: 'bg-white',          text: 'text-gray-700',  border: 'border-gray-200',  dot: 'bg-green-500'  },
  HOLIDAY:  { label: 'Holiday',      color: 'bg-red-50',         text: 'text-red-700',   border: 'border-red-200',   dot: 'bg-red-500'    },
  VACATION: { label: 'Vacation',     color: 'bg-amber-50',       text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500'  },
  HALF_DAY: { label: 'Half Day',     color: 'bg-blue-50',        text: 'text-blue-700',  border: 'border-blue-200',  dot: 'bg-blue-500'   },
  SUNDAY:   { label: 'Sunday',       color: 'bg-gray-100',       text: 'text-gray-400',  border: 'border-gray-200',  dot: 'bg-gray-400'   },
};

const VACATION_PRESETS = [
  { label: '☀️ Summer Vacation',   name: 'SUMMER VACATION',   type: 'VACATION', applies: 'ALL'            },
  { label: '❄️ Winter Vacation',   name: 'WINTER VACATION',   type: 'VACATION', applies: 'ALL'            },
  { label: '🪔 Diwali Break',       name: 'DIWALI BREAK',      type: 'VACATION', applies: 'ALL'            },
  { label: '🎉 Half-Yearly Break', name: 'HALF-YEARLY BREAK', type: 'VACATION', applies: 'STUDENTS_ONLY'  },
  { label: '🏖️ Students Vacation', name: 'STUDENTS VACATION', type: 'VACATION', applies: 'STUDENTS_ONLY'  },
  { label: '📅 Custom Holiday',    name: '',                  type: 'HOLIDAY',  applies: 'ALL'            },
];

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_FULL = ['','January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

// DD-MM-YYYY ↔ Date helpers
const toDate = (s) => { const [d,m,y] = s.split('-').map(Number); return new Date(y,m-1,d); };
const fromDate = (dt) => `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`;
const toInputVal = (ddmmyyyy) => {
  if (!ddmmyyyy) return '';
  const [d,m,y] = ddmmyyyy.split('-');
  return `${y}-${m}-${d}`;
};
const fromInputVal = (yyyymmdd) => {
  if (!yyyymmdd) return '';
  const [y,m,d] = yyyymmdd.split('-');
  return `${d}-${m}-${y}`;
};

// ── Day Edit Modal ────────────────────────────────────────────
function DayModal({ day, academicYear, onSave, onClose }) {
  const { user } = useAuth();
  const [type,    setType]    = useState(day.day_type || 'HOLIDAY');
  const [name,    setName]    = useState(day.event_name || '');
  const [applies, setApplies] = useState(day.applies_to || 'ALL');
  const [saving,  setSaving]  = useState(false);

  const isSunday = day.isSunday;

  const [saveError, setSaveError] = useState('');

  const save = async () => {
    setSaving(true); setSaveError('');
    const res = await window.api.calendarSetDay(
      academicYear, day.date, type, name, applies, user?.username || 'admin'
    );
    setSaving(false);
    if (res && res.success) { onSave(); }
    else { setSaveError(res?.message || 'Failed to save. Please try again.'); }
  };

  const clear = async () => {
    setSaving(true); setSaveError('');
    const res = await window.api.calendarSetDay(
      academicYear, day.date, 'WORKING', '', 'ALL', user?.username || 'admin'
    );
    setSaving(false);
    if (res && res.success) { onSave(); }
    else { setSaveError(res?.message || 'Failed to reset. Please try again.'); }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-700 px-6 py-4">
          <h3 className="text-white font-bold">{day.dayName}, {day.display}</h3>
          <p className="text-blue-200 text-xs mt-0.5">{academicYear}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          {isSunday ? (
            <div className="bg-gray-100 rounded-xl p-4 text-center text-gray-500 text-sm">
              Sunday is automatically a non-working day
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Day Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(DAY_TYPES).filter(([k]) => k !== 'SUNDAY' && k !== 'WORKING').map(([key, val]) => (
                    <button key={key} onClick={() => setType(key)}
                      className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors
                        ${type === key
                          ? `${val.color} ${val.text} ${val.border} ring-2 ring-offset-1 ring-blue-500`
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                      <span className={`inline-block w-2 h-2 rounded-full ${val.dot} mr-2`}></span>
                      {val.label}
                    </button>
                  ))}
                  <button onClick={() => setType('WORKING')}
                    className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors col-span-2
                      ${type === 'WORKING'
                        ? 'bg-green-50 text-green-700 border-green-300 ring-2 ring-offset-1 ring-blue-500'
                        : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-2"></span>
                    ✓ Mark as Working Day (reset to normal)
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Remark / Event Name</label>
                <input value={name} onChange={e => setName(e.target.value.toUpperCase())}
                  placeholder="e.g. DUSSEHRA, REPUBLIC DAY..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-2">Applies To</label>
                <div className="flex gap-2">
                  {[['ALL','Everyone'],['STUDENTS_ONLY','Students Only']].map(([val, label]) => (
                    <button key={val} onClick={() => setApplies(val)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors
                        ${applies === val ? 'bg-blue-700 text-white border-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {saveError && (
          <div className="px-6 pb-2">
            <p className="text-red-500 text-xs bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              ❌ {saveError}
            </p>
          </div>
        )}
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-gray-300 text-gray-600 hover:bg-gray-50 font-medium py-2.5 rounded-xl text-sm">
            Cancel
          </button>
          {!isSunday && day.day_type && day.day_type !== 'WORKING' && (
            <button onClick={clear} disabled={saving}
              className="px-4 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl text-sm font-medium">
              Reset to Working
            </button>
          )}
          {!isSunday && (
            <button onClick={save} disabled={saving}
              className="flex-1 bg-blue-700 hover:bg-blue-800 text-white font-medium py-2.5 rounded-xl text-sm">
              {saving ? '⏳' : '💾 Save'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vacation Range Panel ──────────────────────────────────────
function VacationPanel({ academicYear, onDone }) {
  const { user } = useAuth();
  const [preset,  setPreset]  = useState(VACATION_PRESETS[0]);
  const [name,    setName]    = useState(VACATION_PRESETS[0].name);
  const [from,    setFrom]    = useState('');
  const [to,      setTo]      = useState('');
  const [saving,  setSaving]  = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');

  const selectPreset = (p) => { setPreset(p); setName(p.name); setResult(null); };

  const apply = async () => {
    if (!from || !to) { setError('Please select both start and end dates.'); return; }
    setSaving(true); setError(''); setResult(null);
    const res = await window.api.calendarMarkRange(
      academicYear,
      fromInputVal(from), fromInputVal(to),
      preset.type, name, preset.applies, user?.username || 'admin'
    );
    setSaving(false);
    if (res.success) { setResult(res.count); onDone(); }
    else setError(res.message);
  };

  const clear = async () => {
    if (!from || !to) { setError('Please select both dates to clear.'); return; }
    setSaving(true); setError('');
    await window.api.calendarClearRange(academicYear, fromInputVal(from), fromInputVal(to));
    setSaving(false);
    setResult('cleared');
    onDone();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 mb-6">
      <h3 className="font-bold text-gray-800 mb-1">Mark Vacation / Holiday Period</h3>
      <p className="text-xs text-gray-400 mb-4">
        Mark multiple days at once — Sundays are automatically skipped
      </p>

      {/* Presets */}
      <div className="flex flex-wrap gap-2 mb-4">
        {VACATION_PRESETS.map((p, i) => (
          <button key={i} onClick={() => selectPreset(p)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors
              ${preset.label === p.label
                ? 'bg-blue-700 text-white border-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Name / Remark</label>
          <input value={name} onChange={e => setName(e.target.value.toUpperCase())}
            placeholder="SUMMER VACATION..."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex gap-2">
          <button onClick={apply} disabled={saving}
            className="flex-1 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium py-2 rounded-lg text-sm">
            {saving ? '⏳' : '✓ Apply'}
          </button>
          <button onClick={clear} disabled={saving} title="Reset range to working days"
            className="px-3 py-2 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-sm">
            ✕
          </button>
        </div>
      </div>

      {error  && <p className="text-red-500 text-xs mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {result === 'cleared' && <p className="text-gray-600 text-xs mt-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">✓ Range reset to working days</p>}
      {typeof result === 'number' && (
        <p className="text-green-700 text-xs mt-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          ✅ Marked <strong>{result} days</strong> as {name || preset.label} (Sundays skipped automatically)
        </p>
      )}
    </div>
  );
}

// ── Monthly Calendar Grid ─────────────────────────────────────
function MonthGrid({ monthIdx, academicYear, onRefresh }) {
  const { month, year, label } = getAcademicMonths(academicYear)[monthIdx];
  const [entries,    setEntries]    = useState({});
  const [loading,    setLoading]    = useState(true);
  const [editDay,    setEditDay]    = useState(null);
  const [workingDays, setWorkingDays] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.api.calendarGetMonth(academicYear, month, String(year));
    if (res.success) {
      const map = {};
      res.data.forEach(r => { map[r.date] = r; });
      setEntries(map);
    }
    const wdRes = await window.api.calendarGetWorkingDays(academicYear, month, String(year));
    if (wdRes.success) setWorkingDays(wdRes.working_days);
    setLoading(false);
  }, [academicYear, month, year]);

  useEffect(() => { load(); }, [load, onRefresh]);

  // Build days array for the month
  const daysInMonth = new Date(year, parseInt(month), 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d     = i + 1;
    const dt    = new Date(year, parseInt(month) - 1, d);
    const dateStr = `${String(d).padStart(2,'0')}-${month}-${year}`;
    const isSunday = dt.getDay() === 0;
    const entry    = entries[dateStr];
    const dayType  = isSunday ? 'SUNDAY' : (entry?.day_type || 'WORKING');
    return {
      d, dateStr, date: dateStr,
      dt, isSunday, dayType,
      day_type:   dayType,         // alias for DayModal condition check
      event_name: entry?.event_name || '',
      applies_to: entry?.applies_to || 'ALL',
      dayName:    DAY_NAMES[dt.getDay()],
      entry,
      display:    `${d} ${label} ${year}`,
    };
  });

  const typeCount = {};
  days.forEach(day => {
    const t = day.dayType;
    typeCount[t] = (typeCount[t] || 0) + 1;
  });

  return (
    <div>
      {/* Month header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-800">{label} {year}</h3>
          <div className="flex gap-3 mt-1 flex-wrap">
            {workingDays !== null && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {workingDays} working days
              </span>
            )}
            {Object.entries(typeCount).filter(([k]) => k !== 'WORKING').map(([k, v]) => (
              <span key={k} className={`text-xs px-2 py-0.5 rounded-full font-medium ${DAY_TYPES[k]?.color} ${DAY_TYPES[k]?.text}`}>
                {v} {DAY_TYPES[k]?.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 flex-wrap">
        {Object.entries(DAY_TYPES).map(([k, v]) => (
          <div key={k} className="flex items-center gap-1">
            <div className={`w-2.5 h-2.5 rounded-full ${v.dot}`}></div>
            <span className="text-xs text-gray-500">{v.label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400">Loading…</div>
      ) : (
        <div className="grid grid-cols-7 gap-1">
          {/* Day name headers */}
          {DAY_NAMES.map(d => (
            <div key={d} className={`text-center text-xs font-semibold py-1.5 rounded-lg
              ${d === 'Sun' ? 'text-gray-400 bg-gray-100' : 'text-blue-700 bg-blue-50'}`}>
              {d}
            </div>
          ))}

          {/* Empty cells before month starts */}
          {Array.from({ length: days[0].dt.getDay() }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {/* Day cells */}
          {days.map(day => {
            const style = DAY_TYPES[day.dayType];
            const isClickable = !day.isSunday;
            return (
              <button key={day.dateStr}
                onClick={() => isClickable && setEditDay(day)}
                disabled={!isClickable}
                className={`relative rounded-xl border p-1.5 text-left transition-all min-h-16
                  ${style.color} ${style.border}
                  ${isClickable ? 'hover:shadow-md hover:scale-105 cursor-pointer' : 'cursor-default'}
                `}>
                {/* Date number */}
                <div className={`text-sm font-bold ${style.text}`}>{day.d}</div>

                {/* Status dot */}
                {day.dayType !== 'WORKING' && (
                  <div className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${style.dot}`} />
                )}

                {/* Event name */}
                {day.entry?.event_name && (
                  <div className={`text-[9px] leading-tight mt-0.5 font-medium ${style.text} opacity-80`}>
                    {day.entry.event_name.slice(0, 18)}
                    {day.entry.event_name.length > 18 ? '…' : ''}
                  </div>
                )}

                {/* Applies to badge */}
                {day.entry?.applies_to === 'STUDENTS_ONLY' && (
                  <div className="text-[8px] text-blue-500 font-medium mt-0.5">Students only</div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Edit modal */}
      {editDay && (
        <DayModal
          day={editDay}
          academicYear={academicYear}
          onSave={() => { setEditDay(null); load(); }}
          onClose={() => setEditDay(null)}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
export default function AcademicCalendar() {
  const [academicYear, setAcademicYear] = useState(CURRENT_YEAR);
  const [monthIdx,     setMonthIdx]     = useState(() => {
    // Start at current month
    const now = new Date();
    const m   = String(now.getMonth()+1).padStart(2,'0');
    const idx = ACADEMIC_MONTHS.findIndex(x => x.month === m);
    return idx >= 0 ? idx : 0;
  });
  const [refresh,    setRefresh]    = useState(0);
  const [showVacPanel, setShowVacPanel] = useState(true);

  const { month, year } = ACADEMIC_MONTHS[monthIdx];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Academic Calendar</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Set working days, holidays and vacations for the school year
        </p>
      </div>

      {/* Top controls */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Academic Year</label>
          <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32">
            {ACADEMIC_YEARS.map(y => <option key={y}>{y}</option>)}
          </select>
        </div>
        <button onClick={() => setShowVacPanel(v => !v)}
          className={`mt-4 px-4 py-2 rounded-lg text-sm font-medium border transition-colors
            ${showVacPanel ? 'bg-blue-700 text-white border-blue-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
          {showVacPanel ? '▲ Hide Vacation Marker' : '▼ Mark Vacation Period'}
        </button>
      </div>

      {/* Vacation Panel */}
      {showVacPanel && (
        <VacationPanel
          academicYear={academicYear}
          onDone={() => setRefresh(r => r + 1)}
        />
      )}

      {/* Month navigation */}
      <div className="bg-white border border-gray-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <button onClick={() => setMonthIdx(i => Math.max(0, i-1))}
            disabled={monthIdx === 0}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600">
            ←
          </button>

          {/* Month tabs */}
          <div className="flex gap-1 flex-wrap justify-center">
            {getAcademicMonths(academicYear).map((m, i) => (
              <button key={i} onClick={() => setMonthIdx(i)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors
                  ${monthIdx === i ? 'bg-blue-700 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                {m.label.slice(0,3)}
              </button>
            ))}
          </div>

          <button onClick={() => setMonthIdx(i => Math.min(11, i+1))}
            disabled={monthIdx === 11}
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 text-gray-600">
            →
          </button>
        </div>

        <MonthGrid
          monthIdx={monthIdx}
          academicYear={academicYear}
          onRefresh={refresh}
        />
      </div>

      {/* Info footer */}
      <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700">
        <p className="font-semibold mb-1">How to use the calendar</p>
        <ul className="space-y-0.5 text-blue-600">
          <li>• Click any date to mark it as a Holiday, Vacation, or Half Day</li>
          <li>• Use <strong>Mark Vacation Period</strong> above to mark multiple days at once (summer/winter break)</li>
          <li>• Sundays are automatically non-working — no action needed</li>
          <li>• Working days count is used to calculate correct attendance percentages</li>
          <li>• <strong>Students Only</strong> means teachers work but students are off (e.g. summer vacation for students)</li>
        </ul>
      </div>
    </div>
  );
}
