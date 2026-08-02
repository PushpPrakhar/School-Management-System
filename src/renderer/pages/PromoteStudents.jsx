import React, { useState, useEffect } from "react";

const CLASS_SEQUENCE = [
  "Nursery",
  "LKG",
  "UKG",
  "Class 1",
  "Class 2",
  "Class 3",
  "Class 4",
  "Class 5",
  "Class 6",
  "Class 7",
  "Class 8",
  "Class 9",
  "Class 10",
  "Class 11",
  "Class 12",
];

const CURRENT_SESSION_YEAR = (() => {
  const now = new Date();
  const y = now.getFullYear();
  return now.getMonth() >= 3 ? y : y - 1;
})();
const CURRENT_YEAR = `${CURRENT_SESSION_YEAR}-${String(CURRENT_SESSION_YEAR + 1).slice(2)}`;
const NEXT_YEAR = `${CURRENT_SESSION_YEAR + 1}-${String(CURRENT_SESSION_YEAR + 2).slice(2)}`;
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => {
  const y = CURRENT_SESSION_YEAR - 2 + i;
  return `${y}-${String(y + 1).slice(2)}`;
});

// ── Step 1 ────────────────────────────────────────────────────
function StepYear({ onNext }) {
  const [fromYear, setFromYear] = useState(CURRENT_YEAR);
  const [toYear, setToYear] = useState(NEXT_YEAR);

  const handleFromChange = (val) => {
    setFromYear(val);
    // Auto-set TO year to the next year
    const idx = YEAR_OPTIONS.indexOf(val);
    if (idx !== -1 && idx < YEAR_OPTIONS.length - 1)
      setToYear(YEAR_OPTIONS[idx + 1]);
  };

  return (
    <div className="max-w-xl">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <p className="text-sm font-semibold text-amber-800 mb-1">
          ⚠️ Year-end operation
        </p>
        <p className="text-xs text-amber-700">
          Run this once at the end of the academic year. Every active student
          moves up one class. Class 12 students will be marked Passed Out. Take
          a database backup before proceeding.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Promoting FROM
          </label>
          <select
            value={fromYear}
            onChange={(e) => handleFromChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {YEAR_OPTIONS.slice(0, -1).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Promoting TO
          </label>
          <select
            value={toYear}
            onChange={(e) => setToYear(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            {YEAR_OPTIONS.slice(1).map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600">
          Students will move from <strong>{fromYear}</strong> →{" "}
          <strong>{toYear}</strong>
        </div>
        <button
          onClick={() => onNext(fromYear, toYear)}
          className="w-full bg-blue-700 hover:bg-blue-800 text-white font-medium py-3 rounded-xl text-sm"
        >
          Preview Promotion →
        </button>
      </div>
    </div>
  );
}

// ── Step 2 ────────────────────────────────────────────────────
function StepPreview({ fromYear, toYear, onBack, onConfirm }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [excluded, setExcluded] = useState(new Set());
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    window.api.promotionPreview(fromYear, toYear).then((res) => {
      if (res.success) {
        setPreview(res);
        // Pre-exclude students who genuinely failed the Final exam — never
        // pre-exclude for missing data, since that's not the same thing
        // as failing. Principal can still override any individual student.
        const preExcluded = new Set();
        res.preview?.forEach((p) =>
          p.students.forEach((s) => {
            if (s.exam_result && s.exam_result.allPass === false)
              preExcluded.add(s.admission_number);
          }),
        );
        setExcluded(preExcluded);
      }
      setLoading(false);
    });
  }, [fromYear, toYear]);

  const toggleStudent = (admNo) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(admNo) ? next.delete(admNo) : next.add(admNo);
      return next;
    });

  const toggleClass = (students) => {
    const allOut = students.every((s) => excluded.has(s.admission_number));
    setExcluded((prev) => {
      const next = new Set(prev);
      students.forEach((s) =>
        allOut ? next.delete(s.admission_number) : next.add(s.admission_number),
      );
      return next;
    });
  };

  if (loading)
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl animate-spin mb-3">⏳</div>
        <p>Loading preview…</p>
      </div>
    );

  const toPromote = (preview?.total || 0) - excluded.size;
  const passedOut =
    preview?.preview
      ?.filter((p) => p.next_class === "PASSED OUT")
      .reduce(
        (s, p) =>
          s +
          p.students.filter((st) => !excluded.has(st.admission_number)).length,
        0,
      ) || 0;
  const failedCount =
    preview?.preview?.reduce(
      (s, p) =>
        s + p.students.filter((st) => st.exam_result?.allPass === false).length,
      0,
    ) || 0;

  return (
    <div>
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-blue-700">{toPromote}</p>
          <p className="text-xs text-blue-600 mt-1">Will be promoted</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-green-700">{passedOut}</p>
          <p className="text-xs text-green-600 mt-1">Passed Out (Class 12)</p>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-600">{failedCount}</p>
          <p className="text-xs text-amber-600 mt-1">Failed Final Exam</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{excluded.size}</p>
          <p className="text-xs text-red-500 mt-1">Excluded</p>
        </div>
      </div>

      <p className="text-xs text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 mb-4">
        💡 Students who failed the Final exam are pre-excluded automatically —
        check/uncheck anyone to override. Excluded students stay in their
        current class.
      </p>

      <div className="space-y-2">
        {preview?.preview?.map((p) => {
          const allOut = p.students.every((s) =>
            excluded.has(s.admission_number),
          );
          const someOut =
            !allOut && p.students.some((s) => excluded.has(s.admission_number));
          const isExpanded = expanded === p.current_class;
          return (
            <div
              key={p.current_class}
              className="bg-white border border-gray-200 rounded-xl overflow-hidden"
            >
              <div className="flex items-center gap-4 px-5 py-4 bg-gray-50">
                <input
                  type="checkbox"
                  checked={!allOut}
                  ref={(el) => {
                    if (el) el.indeterminate = someOut;
                  }}
                  onChange={() => toggleClass(p.students)}
                  className="w-4 h-4 accent-blue-600"
                />
                <div className="flex-1 flex items-center gap-3">
                  <span className="font-semibold text-gray-800">
                    {p.current_class}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span
                    className={`font-semibold text-sm ${p.next_class === "PASSED OUT" ? "text-green-600" : "text-blue-700"}`}
                  >
                    {p.next_class || "⚠️ Unknown"}
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {
                    p.students.filter((s) => !excluded.has(s.admission_number))
                      .length
                  }{" "}
                  / {p.count}
                </span>
                <button
                  onClick={() =>
                    setExpanded(isExpanded ? null : p.current_class)
                  }
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {isExpanded ? "Hide ▲" : "Show ▼"}
                </button>
              </div>
              {isExpanded && (
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50">
                  {p.students.map((s) => (
                    <label
                      key={s.admission_number}
                      className={`flex items-center gap-3 px-5 py-2 cursor-pointer hover:bg-gray-50 ${excluded.has(s.admission_number) ? "bg-red-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={!excluded.has(s.admission_number)}
                        onChange={() => toggleStudent(s.admission_number)}
                        className="w-4 h-4 accent-blue-600"
                      />
                      <span
                        className={`text-sm flex-1 ${excluded.has(s.admission_number) ? "line-through text-gray-400" : "text-gray-700"}`}
                      >
                        {s.student_name}
                      </span>
                      {s.exam_result ? (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${s.exam_result.allPass ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}
                        >
                          {s.exam_result.allPass ? "Pass" : "Fail"} ·{" "}
                          {s.exam_result.pct}% · {s.exam_result.grade}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                          No exam data
                        </span>
                      )}
                      <span className="text-xs font-mono text-gray-400">
                        {s.admission_number}
                      </span>
                      {excluded.has(s.admission_number) && (
                        <span className="text-xs bg-red-100 text-red-500 px-2 py-0.5 rounded-full">
                          Excluded
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between mt-6 pb-4">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          ← Back
        </button>
        <button
          onClick={() => onConfirm(Array.from(excluded))}
          disabled={toPromote === 0}
          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm"
        >
          Promote {toPromote} Students →
        </button>
      </div>
    </div>
  );
}

// ── Step 3 ────────────────────────────────────────────────────
function StepConfirm({ toYear, excluded, onBack, onDone }) {
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const execute = async () => {
    setSaving(true);
    setError("");
    const res = await window.api.promotionExecute(toYear, excluded, "admin");
    setSaving(false);
    if (res.success) setResult(res);
    else setError(res.message);
  };

  if (result)
    return (
      <div className="max-w-lg mx-auto text-center py-8">
        <div className="text-6xl mb-4">🎉</div>
        <h3 className="text-xl font-bold text-gray-800 mb-4">
          Promotion Complete!
        </h3>
        <div className="bg-white border border-gray-200 rounded-xl p-6 text-left space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-500">Promoted to next class</span>
            <span className="font-bold text-blue-700">{result.promoted}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Marked as Passed Out</span>
            <span className="font-bold text-green-600">{result.passedOut}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Excluded</span>
            <span className="font-bold text-red-500">{result.excluded}</span>
          </div>
          <div className="flex justify-between border-t border-gray-100 pt-3">
            <span className="text-gray-500">Academic year updated to</span>
            <span className="font-bold text-gray-800">{toYear}</span>
          </div>
        </div>
        <button
          onClick={onDone}
          className="mt-6 bg-blue-700 hover:bg-blue-800 text-white font-medium px-8 py-2.5 rounded-xl text-sm"
        >
          Done
        </button>
      </div>
    );

  return (
    <div className="max-w-lg">
      <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
        <p className="font-semibold text-red-700 mb-1">⚠️ Final Confirmation</p>
        <p className="text-sm text-red-600">
          This permanently updates <strong>current_class</strong> for all
          selected students. Make sure you have a database backup before
          proceeding.
        </p>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="w-4 h-4 accent-blue-600 mt-0.5"
          />
          <span className="text-sm text-gray-700">
            I have taken a database backup and confirm promoting all selected
            students to the next class for academic year{" "}
            <strong>{toYear}</strong>.
          </span>
        </label>
      </div>
      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600 underline"
        >
          ← Back
        </button>
        <button
          onClick={execute}
          disabled={!confirmed || saving}
          className="bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white font-medium px-8 py-2.5 rounded-xl text-sm flex items-center gap-2"
        >
          {saving ? (
            <>
              <span className="animate-spin">⏳</span> Promoting…
            </>
          ) : (
            "✅ Confirm & Promote"
          )}
        </button>
      </div>
    </div>
  );
}

// ── History ───────────────────────────────────────────────────
function HistoryTab() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.api.promotionHistory().then((res) => {
      if (res.success) setHistory(res.data);
      setLoading(false);
    });
  }, []);

  if (loading)
    return <div className="text-center py-12 text-gray-400">Loading…</div>;
  if (!history.length)
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3">📋</div>
        <p>No promotions have been run yet.</p>
      </div>
    );
  return (
    <div className="space-y-3">
      {history.map((h, i) => (
        <div
          key={i}
          className="bg-white border border-gray-200 rounded-xl px-5 py-4 flex items-center justify-between"
        >
          <div>
            <p className="font-semibold text-gray-800">
              {h.changes?.[0]?.new || "Promotion"}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              By {h.edited_by} · {h.edited_at?.slice(0, 16)}
            </p>
          </div>
          <span className="text-xs bg-green-100 text-green-700 border border-green-200 px-2 py-0.5 rounded-full">
            Completed
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Class Sections ───────────────────────────────────────────
const SECTION_OPTIONS = ["A", "B", "C", "D"];

function ClassSectionsTab() {
  const [cls, setCls] = useState(CLASS_SEQUENCE[0]);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [balanceTargets, setBalanceTargets] = useState(["A", "B"]);
  const [confirmBalance, setConfirmBalance] = useState(false);
  const [balancing, setBalancing] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    setMsg("");
    window.api.sectionsGetBreakdown(cls, year).then((res) => {
      setLoading(false);
      if (!res.success) {
        setError(res.message);
        return;
      }
      setData(res);
    });
  };

  useEffect(() => {
    load();
  }, [cls, year]);

  const moveStudent = async (admissionNumber, newSection) => {
    setError("");
    setMsg("");
    const res = await window.api.sectionsUpdateStudent(
      admissionNumber,
      newSection,
      "admin",
    );
    if (!res.success) {
      setError(res.message);
      return;
    }
    setMsg("✓ Section updated.");
    load();
  };

  const toggleBalanceTarget = (sec) => {
    setBalanceTargets((prev) =>
      prev.includes(sec)
        ? prev.filter((s) => s !== sec)
        : [...prev, sec].sort(),
    );
  };

  const runAutoBalance = async () => {
    setBalancing(true);
    setError("");
    setMsg("");
    const res = await window.api.sectionsAutoBalance(
      cls,
      balanceTargets,
      year,
      "admin",
    );
    setBalancing(false);
    setConfirmBalance(false);
    if (!res.success) {
      setError(res.message);
      return;
    }
    setMsg(
      `✓ Balanced: ${res.breakdown.map((b) => `${b.section} = ${b.count}`).join(", ")}`,
    );
    load();
  };

  const sections = data ? Object.keys(data.bySection).sort() : [];

  return (
    <div>
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-xs text-blue-700">
        Reassign students between sections, or auto-balance a class evenly
        across sections you choose — students are sorted alphabetically then
        dealt out in rotation, so every section gets a spread across the whole
        alphabet, not one block each. This only changes each student's{" "}
        <strong>section</strong> — their class stays the same.
      </div>

      <div className="flex flex-wrap gap-3 items-end mb-5">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Class
          </label>
          <select
            value={cls}
            onChange={(e) => setCls(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"
          >
            {CLASS_SEQUENCE.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Academic Year
          </label>
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-32"
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          {error}
        </p>
      )}
      {msg && (
        <p className="text-green-700 text-sm bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          {msg}
        </p>
      )}

      {loading ? (
        <p className="text-center text-gray-400 py-10 text-sm">Loading…</p>
      ) : !data || data.total === 0 ? (
        <p className="text-center text-gray-400 py-10 text-sm">
          No active students found in {cls}.
        </p>
      ) : (
        <>
          {/* Section breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {sections.map((sec) => (
              <div
                key={sec}
                className="bg-white border border-gray-200 rounded-xl p-4"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-gray-800">
                    {sec === "(unassigned)" ? "No Section" : `Section ${sec}`}
                  </span>
                  <span className="text-xl font-bold text-blue-700">
                    {data.bySection[sec].length}
                  </span>
                </div>
                {data.frozenBySection[sec] && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-1">
                    ⚠️ Roll numbers frozen for {year} — moving students here
                    won't update roll numbers automatically.
                  </p>
                )}
                <button
                  onClick={() => setExpanded(expanded === sec ? null : sec)}
                  className="text-xs text-blue-600 hover:underline mt-2"
                >
                  {expanded === sec ? "Hide students ▲" : "Show students ▼"}
                </button>
                {expanded === sec && (
                  <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                    {data.bySection[sec].map((s) => (
                      <div
                        key={s.admission_number}
                        className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5"
                      >
                        <span className="text-gray-700 truncate">
                          {s.student_name}
                        </span>
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value)
                              moveStudent(s.admission_number, e.target.value);
                            e.target.value = "";
                          }}
                          className="border border-gray-300 rounded px-1 py-0.5 text-xs bg-white ml-2"
                        >
                          <option value="">Move to…</option>
                          {SECTION_OPTIONS.filter((o) => o !== sec).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Auto-Balance */}
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <p className="font-semibold text-gray-800 mb-1">
              ⚖️ Auto-Balance Sections
            </p>
            <p className="text-xs text-gray-500 mb-3">
              Sorts all {data.total} students in {cls} alphabetically, then
              deals them out in rotation across the sections you choose below —
              so every section ends up with a spread across the whole alphabet,
              not just early or late names. This replaces every student's
              current section in {cls}, not just the unassigned ones.
            </p>
            <div className="flex gap-2 mb-4">
              {SECTION_OPTIONS.map((sec) => (
                <label
                  key={sec}
                  className={`px-4 py-2 rounded-lg border text-sm cursor-pointer font-medium
                  ${balanceTargets.includes(sec) ? "bg-blue-50 border-blue-400 text-blue-700" : "border-gray-200 text-gray-500 hover:bg-gray-50"}`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={balanceTargets.includes(sec)}
                    onChange={() => toggleBalanceTarget(sec)}
                  />
                  Section {sec}
                </label>
              ))}
            </div>
            {!confirmBalance ? (
              <button
                onClick={() => setConfirmBalance(true)}
                disabled={balanceTargets.length < 2}
                className="px-5 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-xl text-sm font-medium"
              >
                Preview Balance Across {balanceTargets.join(", ") || "…"}
              </button>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-800 font-semibold mb-1">
                  ⚠️ This will move students immediately
                </p>
                <p className="text-xs text-amber-700 mb-3">
                  All {data.total} active students in {cls} will be
                  redistributed alphabetically across{" "}
                  {balanceTargets.join(", ")}. This can't be bulk-undone — you'd
                  need to move students back individually.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmBalance(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={runAutoBalance}
                    disabled={balancing}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium"
                  >
                    {balancing ? "Balancing…" : "Confirm & Balance Now"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────
export default function PromoteStudents() {
  const [tab, setTab] = useState("promote");
  const [step, setStep] = useState(1);
  const [fromYear, setFromYear] = useState(CURRENT_YEAR);
  const [toYear, setToYear] = useState(NEXT_YEAR);
  const [excluded, setExcluded] = useState([]);

  const reset = () => {
    setStep(1);
    setExcluded([]);
  };
  const STEPS = ["Select Year", "Preview & Exclude", "Confirm"];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Promote Students</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Move students to the next class, and manage class sections
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6 w-fit">
        {[
          ["promote", "Run Promotion"],
          ["sections", "Class Sections"],
          ["history", "Promotion History"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "history" && <HistoryTab />}
      {tab === "sections" && <ClassSectionsTab />}

      {tab === "promote" && (
        <>
          <div className="flex items-center mb-8">
            {STEPS.map((label, i) => {
              const n = i + 1;
              return (
                <React.Fragment key={n}>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                      ${step > n ? "bg-green-600 text-white" : step === n ? "bg-blue-700 text-white" : "bg-gray-200 text-gray-400"}`}
                    >
                      {step > n ? "✓" : n}
                    </div>
                    <span
                      className={`text-sm ${step === n ? "font-semibold text-blue-700" : "text-gray-400"}`}
                    >
                      {label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div
                      className={`flex-1 h-px mx-3 ${step > n ? "bg-green-500" : "bg-gray-200"}`}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {step === 1 && (
            <StepYear
              onNext={(from, to) => {
                setFromYear(from);
                setToYear(to);
                setStep(2);
              }}
            />
          )}
          {step === 2 && (
            <StepPreview
              fromYear={fromYear}
              toYear={toYear}
              onBack={() => setStep(1)}
              onConfirm={(excl) => {
                setExcluded(excl);
                setStep(3);
              }}
            />
          )}
          {step === 3 && (
            <StepConfirm
              toYear={toYear}
              excluded={excluded}
              onBack={() => setStep(2)}
              onDone={reset}
            />
          )}
        </>
      )}
    </div>
  );
}
