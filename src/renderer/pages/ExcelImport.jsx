// ExcelImport.jsx — 4-phase Excel importer
// Phase 1: Upload + Preview
// Phase 2: Validate
// Phase 3: Conflict check + Import options
// Phase 4: Progress + Summary

import React, { useState, useEffect, useRef } from 'react';

// ── Shared helpers ────────────────────────────────────────────
function Card({ title, subtitle, children, color = 'gray' }) {
  const borders = { gray:'border-gray-200', green:'border-green-200', red:'border-red-200', amber:'border-amber-200', blue:'border-blue-200' };
  const headers = { gray:'bg-gray-50', green:'bg-green-50', red:'bg-red-50', amber:'bg-amber-50', blue:'bg-blue-50' };
  return (
    <div className={`bg-white border ${borders[color]} rounded-xl overflow-hidden mb-4`}>
      <div className={`${headers[color]} border-b ${borders[color]} px-5 py-3`}>
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
function Badge({ text, color }) {
  const styles = {
    green: 'bg-green-100 text-green-700',
    red:   'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    blue:  'bg-blue-100 text-blue-700',
    gray:  'bg-gray-100 text-gray-600',
  };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${styles[color]}`}>{text}</span>;
}
function Stat({ label, value, color }) {
  const colors = { green:'text-green-600', red:'text-red-500', amber:'text-amber-600', gray:'text-gray-500', blue:'text-blue-600' };
  return (
    <div className="text-center">
      <p className={`text-3xl font-bold ${colors[color]}`}>{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

// ── Phase 1: Upload + Preview ─────────────────────────────────
function PhaseUpload({ onPreviewReady }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const pickFile = async () => {
    setError('');
    const filePath = await window.api.pickFile([{ name: 'Excel Files', extensions: ['xlsx'] }]);
    if (!filePath) return;
    setLoading(true);
    const res = await window.api.excelPreview(filePath);
    setLoading(false);
    if (!res.success) { setError(res.message); return; }
    onPreviewReady({ filePath, ...res });
  };

  return (
    <div className="max-w-xl mx-auto text-center py-16">
      <div className="text-6xl mb-6">📂</div>
      <h3 className="text-lg font-bold text-gray-800 mb-2">Select Excel File</h3>
      <p className="text-sm text-gray-500 mb-8">
        Select the <span className="font-mono bg-gray-100 px-1 rounded">enrollment.xlsx</span> file.
        Headers must be in Row 1, data from Row 2.
      </p>
      {error && <p className="text-red-500 text-sm mb-4 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}
      <button onClick={pickFile} disabled={loading}
        className="bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white font-medium px-8 py-3 rounded-xl text-sm">
        {loading ? '⏳ Reading file…' : '📂 Choose File'}
      </button>
    </div>
  );
}

// ── Phase 2: Preview ──────────────────────────────────────────
function PhasePreview({ data, onConfirm, onBack }) {
  const { filePath, headers, preview, totalRows } = data;
  const fileName = filePath.split(/[\\/]/).pop();
  return (
    <div>
      <Card title="File Preview" subtitle={`${fileName} — ${totalRows} rows, ${headers.length} columns`} color="blue">
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                {headers.slice(0,8).map(h => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap border-b border-gray-200">
                    {h}
                  </th>
                ))}
                {headers.length > 8 && <th className="px-3 py-2 text-gray-400">+{headers.length-8} more</th>}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                  {headers.slice(0,8).map(h => (
                    <td key={h} className="px-3 py-2 text-gray-600 whitespace-nowrap max-w-32 overflow-hidden text-ellipsis">
                      {row[h] || <span className="text-gray-300">—</span>}
                    </td>
                  ))}
                  {headers.length > 8 && <td className="px-3 py-2 text-gray-300">…</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalRows > 10 && (
          <p className="text-xs text-gray-400 mt-3 text-center">
            Showing first 10 of {totalRows} rows
          </p>
        )}
      </Card>
      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 underline">← Choose different file</button>
        <button onClick={onConfirm}
          className="bg-blue-700 hover:bg-blue-800 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
          Validate Data →
        </button>
      </div>
    </div>
  );
}

// ── Phase 3: Validate ─────────────────────────────────────────
function PhaseValidate({ filePath, totalRows, onValidated, onBack }) {
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    window.api.excelValidate(filePath).then(res => {
      setResult(res);
      setLoading(false);
    });
  }, [filePath]);

  if (loading) return (
    <div className="text-center py-16">
      <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
      <p className="text-gray-500">Running {totalRows} rows through 28 checks…</p>
    </div>
  );

  if (!result.success) return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700">
      <p className="font-semibold">Could not validate file</p>
      <p className="text-sm mt-1">{result.message}</p>
    </div>
  );

  const hasErrors = result.colMissing.length > 0 || result.colExtra.length > 0 ||
                    result.adm_dupes.length > 0   || result.errorRows.length > 0;

  return (
    <div>
      {/* Summary */}
      <Card title="Validation Results" color={result.isClean ? 'green' : 'red'}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-4">
          <Stat label="Total Rows" value={result.totalRows} color="blue" />
          <Stat label="Column Errors" value={result.colMissing.length + result.colExtra.length} color={result.colMissing.length + result.colExtra.length > 0 ? 'red' : 'green'} />
          <Stat label="Row Errors" value={result.errorRows.length} color={result.errorRows.length > 0 ? 'red' : 'green'} />
          <Stat label="Conflicts in DB" value={result.conflicts.length} color={result.conflicts.length > 0 ? 'amber' : 'green'} />
        </div>
        {result.isClean && result.conflicts.length === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="text-green-700 font-semibold">✅ All checks passed — data is clean and ready to import</p>
          </div>
        )}
      </Card>

      {/* Column errors */}
      {(result.colMissing.length > 0 || result.colExtra.length > 0) && (
        <Card title="Column Name Issues" color="red">
          {result.colMissing.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-semibold text-red-600 mb-2">Missing from Excel ({result.colMissing.length}):</p>
              <div className="flex flex-wrap gap-2">
                {result.colMissing.map(c => <Badge key={c} text={c} color="red" />)}
              </div>
            </div>
          )}
          {result.colExtra.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-amber-600 mb-2">Not in schema ({result.colExtra.length}):</p>
              <div className="flex flex-wrap gap-2">
                {result.colExtra.map(c => <Badge key={c} text={c} color="amber" />)}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Duplicate admission numbers */}
      {result.adm_dupes.length > 0 && (
        <Card title={`Duplicate Admission Numbers in File (${result.adm_dupes.length})`} color="red">
          <div className="space-y-1">
            {result.adm_dupes.map((d, i) => (
              <p key={i} className="text-sm text-red-600">Row {d.row}: <span className="font-mono">{d.value}</span></p>
            ))}
          </div>
        </Card>
      )}

      {/* Row errors */}
      {result.errorRows.length > 0 && (
        <Card title={`Row Errors (${result.errorRows.length})`} color="red"
          subtitle="Fix these in the Excel file and re-upload">
          <div className="max-h-64 overflow-y-auto space-y-2">
            {result.errorRows.map((r, i) => (
              <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5">
                <p className="text-xs font-semibold text-red-700">Row {r.row} — {r.admission_number}</p>
                <ul className="mt-1 space-y-0.5">
                  {r.errors.map((e, j) => <li key={j} className="text-xs text-red-600">• {e}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Conflicts */}
      {result.conflicts.length > 0 && (
        <Card title={`Already in Database (${result.conflicts.length})`} color="amber"
          subtitle="These admission numbers already exist — they will be skipped during import">
          <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {result.conflicts.map(c => <Badge key={c} text={c} color="amber" />)}
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-600 underline">← Back</button>
        {!hasErrors && (
          <button onClick={() => onValidated(result.conflicts)}
            className="bg-green-600 hover:bg-green-700 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
            Proceed to Import →
          </button>
        )}
        {hasErrors && (
          <p className="text-sm text-red-500 font-medium self-center">Fix errors in the Excel file and re-upload</p>
        )}
      </div>
    </div>
  );
}

// ── Phase 4: Import ───────────────────────────────────────────
function PhaseImport({ filePath, conflicts, totalRows, onDone, onBack }) {
  const [importing,  setImporting]  = useState(false);
  const [progress,   setProgress]   = useState(0);
  const [result,     setResult]     = useState(null);
  const cleanupRef = useRef(null);

  useEffect(() => () => { if (cleanupRef.current) cleanupRef.current(); }, []);

  const startImport = async () => {
    setImporting(true);
    setProgress(0);
    cleanupRef.current = window.api.onExcelProgress(({ current, total }) => {
      setProgress(Math.round((current / total) * 100));
    });
    const res = await window.api.excelImport({ filePath, skipDuplicates: true });
    if (cleanupRef.current) cleanupRef.current();
    setImporting(false);
    setResult(res);
  };

  // Summary screen
  if (result) return (
    <div>
      <Card title="Import Complete" color={result.success ? 'green' : 'red'}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
          <Stat label="Total Processed" value={result.total}    color="blue"  />
          <Stat label="Imported"        value={result.inserted} color="green" />
          <Stat label="Skipped (Duplicates)" value={result.skipped}  color="amber" />
          <Stat label="Failed"          value={result.failed}   color={result.failed > 0 ? 'red' : 'green'} />
        </div>
        {result.success && result.failed === 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="text-green-700 font-bold text-lg">🎉 Import Successful!</p>
            <p className="text-green-600 text-sm mt-1">
              {result.inserted} students added to the database.
            </p>
          </div>
        )}
        {result.failed > 0 && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-red-600 mb-2">Failed rows:</p>
            {result.failedRows.map((r, i) => (
              <div key={i} className="text-xs text-red-600 bg-red-50 rounded px-3 py-1.5 mb-1">
                Row {r.row} ({r.admission_number}): {r.error}
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="flex justify-end">
        <button onClick={onDone}
          className="bg-blue-700 hover:bg-blue-800 text-white font-medium px-8 py-2.5 rounded-xl text-sm">
          Done
        </button>
      </div>
    </div>
  );

  // Pre-import confirm screen
  return (
    <div>
      <Card title="Ready to Import" color="blue">
        <div className="grid grid-cols-3 gap-6 mb-6">
          <Stat label="Rows to Import" value={totalRows - conflicts.length} color="blue"  />
          <Stat label="Will be Skipped" value={conflicts.length} color="amber" />
          <Stat label="Total in File"   value={totalRows}        color="gray"  />
        </div>
        {conflicts.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-700">
            ⚠️ {conflicts.length} records already exist in the database and will be skipped.
          </div>
        )}
        {importing && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Importing…</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </Card>
      <div className="flex justify-between">
        <button onClick={onBack} disabled={importing}
          className="text-sm text-gray-400 hover:text-gray-600 underline disabled:opacity-30">
          ← Back
        </button>
        <button onClick={startImport} disabled={importing}
          className="bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white font-medium px-10 py-3 rounded-xl text-sm flex items-center gap-2">
          {importing ? <><span className="animate-spin">⏳</span> Importing…</> : '✅ Start Import'}
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function ExcelImport() {
  // Guard: window.api only exists inside Electron, not in a browser
  if (!window.api) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="text-5xl mb-4">⚠️</div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">Not running inside Electron</h3>
        <p className="text-sm text-gray-500">
          This app must be opened through <span className="font-mono bg-gray-100 px-1 rounded">npm start</span>,
          not in a web browser. Close this browser tab and use the Electron window instead.
        </p>
      </div>
    );
  }

  const [phase,     setPhase]     = useState(1);   // 1=upload 2=preview 3=validate 4=import
  const [fileData,  setFileData]  = useState(null);
  const [conflicts, setConflicts] = useState([]);

  const reset = () => { setPhase(1); setFileData(null); setConflicts([]); };

  // Step indicator
  const steps = ['Upload', 'Preview', 'Validate', 'Import'];

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Import from Excel</h2>
        <p className="text-sm text-gray-500 mt-0.5">Import student records from your SR Register Excel file</p>
      </div>

      {/* Step bar */}
      <div className="flex items-center mb-8">
        {steps.map((label, i) => {
          const n = i + 1;
          const done    = phase > n;
          const active  = phase === n;
          return (
            <React.Fragment key={n}>
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                  ${done ? 'bg-green-600 text-white' : active ? 'bg-blue-700 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {done ? '✓' : n}
                </div>
                <span className={`text-sm ${active ? 'font-semibold text-blue-700' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`flex-1 h-px mx-3 ${phase > n ? 'bg-green-500' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {phase === 1 && (
        <PhaseUpload onPreviewReady={data => { setFileData(data); setPhase(2); }} />
      )}
      {phase === 2 && fileData && (
        <PhasePreview
          data={fileData}
          onConfirm={() => setPhase(3)}
          onBack={reset}
        />
      )}
      {phase === 3 && fileData && (
        <PhaseValidate
          filePath={fileData.filePath}
          totalRows={fileData.totalRows}
          onValidated={c => { setConflicts(c); setPhase(4); }}
          onBack={() => setPhase(2)}
        />
      )}
      {phase === 4 && fileData && (
        <PhaseImport
          filePath={fileData.filePath}
          conflicts={conflicts}
          totalRows={fileData.totalRows}
          onDone={reset}
          onBack={() => setPhase(3)}
        />
      )}
    </div>
  );
}
