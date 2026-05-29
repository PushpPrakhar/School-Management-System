// ExcelImport.jsx
// Admin-only page. Flow:
//   1. Pick .xlsx file
//   2. Choose sheet + target table
//   3. Map Excel columns → DB fields (auto-mapped where names match)
//   4. Validate — see errors row-by-row
//   5. Confirm import (insert / update)

import React, { useState, useCallback } from 'react';

// ── Steps ────────────────────────────────────────────────────
const STEPS = ['Upload file', 'Map columns', 'Validate & Import'];

// ── Friendly table labels ─────────────────────────────────────
const TABLE_LABELS = {
  enrollment:  'Students (SR Register)',
  fees_ledger: 'Fees Ledger',
};

export default function ExcelImport() {
  const [step, setStep]           = useState(0);
  const [filePath, setFilePath]   = useState('');
  const [fileName, setFileName]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');

  // Step 1 — sheet data
  const [sheets, setSheets]       = useState([]);   // [{ name, headers, preview, totalRows }]
  const [schemas, setSchemas]     = useState({});   // IMPORT_SCHEMAS from main
  const [selectedSheet, setSelectedSheet] = useState('');
  const [selectedTable, setSelectedTable] = useState('enrollment');

  // Step 2 — mapping
  const [mapping, setMapping]     = useState({});   // { dbColumn: excelColumn }
  const [showPreview, setShowPreview] = useState(false);

  // Step 3 — results
  const [validationResult, setValidationResult] = useState(null);
  const [importResult, setImportResult]         = useState(null);
  const [options, setOptions] = useState({ skipErrors: false, updateExisting: false });

  // ── Step 1: Pick file ───────────────────────────────────────
  const pickFile = async () => {
    setError('');
    const path = await window.api.pickFile([
      { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
    ]);
    if (!path) return;

    setLoading(true);
    const result = await window.api.excelPreview(path);
    setLoading(false);

    if (!result.success) {
      setError(result.message);
      return;
    }

    setFilePath(path);
    setFileName(path.split(/[\\/]/).pop());
    setSheets(result.sheets);
    setSchemas(result.schemas);
    setSelectedSheet(result.sheets[0]?.name || '');
    setStep(1);
    setMapping({});
    setValidationResult(null);
    setImportResult(null);
  };

  // ── Step 2: Auto-map columns ────────────────────────────────
  const currentSheet  = sheets.find(s => s.name === selectedSheet);
  const currentSchema = schemas[selectedTable]?.columns || [];

  const autoMap = useCallback(() => {
    if (!currentSheet) return;
    const excelHeaders = currentSheet.headers.map(h => h.toLowerCase().trim());
    const newMapping   = {};

    currentSchema.forEach(col => {
      // Try exact match first, then partial
      const exactIdx = excelHeaders.findIndex(
        h => h === col.label.toLowerCase() || h === col.key.replace(/_/g,' ')
      );
      if (exactIdx !== -1) {
        newMapping[col.key] = currentSheet.headers[exactIdx];
        return;
      }
      const partialIdx = excelHeaders.findIndex(h =>
        h.includes(col.key.replace(/_/g,' ')) ||
        col.key.replace(/_/g,' ').includes(h)
      );
      if (partialIdx !== -1) {
        newMapping[col.key] = currentSheet.headers[partialIdx];
      }
    });

    setMapping(newMapping);
  }, [currentSheet, currentSchema]);

  // When sheet/table changes, re-auto-map
  React.useEffect(() => {
    if (step === 1) autoMap();
  }, [selectedSheet, selectedTable, step, autoMap]);

  // ── Step 3: Validate (dry run) ──────────────────────────────
  const validate = async () => {
    setLoading(true);
    setError('');
    const result = await window.api.excelImport({
      filePath,
      sheetName: selectedSheet,
      table:     selectedTable,
      mapping,
      options:   { ...options, skipErrors: false, dryRun: true },
    });
    setLoading(false);

    if (!result.success && !result.needsConfirm) {
      setError(result.message || 'Validation failed.');
      return;
    }
    setValidationResult(result);
    setStep(2);
  };

  // ── Import ───────────────────────────────────────────────────
  const doImport = async (skipErrors) => {
    setLoading(true);
    setError('');
    const result = await window.api.excelImport({
      filePath,
      sheetName: selectedSheet,
      table:     selectedTable,
      mapping,
      options:   { ...options, skipErrors },
    });
    setLoading(false);

    if (!result.success && !result.needsConfirm) {
      setError(result.message || 'Import failed.');
      return;
    }
    setImportResult(result);
  };

  // ── Reset ────────────────────────────────────────────────────
  const reset = () => {
    setStep(0);
    setFilePath('');
    setFileName('');
    setSheets([]);
    setMapping({});
    setValidationResult(null);
    setImportResult(null);
    setError('');
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="max-w-4xl">

      {/* Page header */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-800">Import from Excel</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload an .xlsx file to import student records or fees data into the database.
        </p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                ${i < step ? 'bg-green-600 text-white'
                : i === step ? 'bg-blue-700 text-white'
                : 'bg-gray-200 text-gray-400'}`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-sm ${i === step ? 'font-medium text-blue-700' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-3 ${i < step ? 'bg-green-500' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ── STEP 0: Upload ─────────────────────────────────── */}
      {step === 0 && (
        <div className="bg-white border-2 border-dashed border-gray-300 rounded-xl p-12 text-center">
          <div className="text-5xl mb-4">📊</div>
          <p className="text-gray-600 font-medium mb-2">Choose an Excel file to import</p>
          <p className="text-gray-400 text-sm mb-6">Supported formats: .xlsx, .xls</p>
          <button
            onClick={pickFile}
            disabled={loading}
            className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Reading file…' : 'Browse File'}
          </button>

          {/* Tips */}
          <div className="mt-8 text-left bg-blue-50 rounded-xl p-4 max-w-md mx-auto">
            <p className="text-blue-800 font-medium text-sm mb-2">Tips for best results</p>
            <ul className="text-blue-700 text-xs space-y-1 list-disc list-inside">
              <li>First row should be column headers</li>
              <li>Each sheet can be a different type of data</li>
              <li>Dates should be in DD/MM/YYYY format</li>
              <li>Aadhar number must be 12 digits (no spaces)</li>
              <li>Gender: M, F, or Other</li>
              <li>Category: GEN, SC, ST, or OBC</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── STEP 1: Map columns ────────────────────────────── */}
      {step === 1 && currentSheet && (
        <div className="space-y-4">

          {/* File info bar */}
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-green-700">📄</span>
              <span className="text-sm font-medium text-green-800">{fileName}</span>
              <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                {currentSheet.totalRows} rows
              </span>
            </div>
            <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Change file
            </button>
          </div>

          {/* Sheet + table selectors */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sheet to import</label>
              <select
                value={selectedSheet}
                onChange={e => setSelectedSheet(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {sheets.map(s => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.totalRows} rows)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Import into</label>
              <select
                value={selectedTable}
                onChange={e => setSelectedTable(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(TABLE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Column mapping */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <p className="text-sm font-semibold text-gray-700">Column mapping</p>
              <button
                onClick={autoMap}
                className="text-xs text-blue-600 hover:text-blue-800 underline"
              >
                Auto-detect
              </button>
            </div>

            <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {currentSchema.map(col => (
                <div key={col.key} className="flex items-center px-4 py-2.5 gap-4">
                  {/* DB field */}
                  <div className="w-52 flex-shrink-0">
                    <p className="text-sm text-gray-700">{col.label}</p>
                    {col.required && (
                      <span className="text-xs text-red-500">Required</span>
                    )}
                  </div>

                  {/* Arrow */}
                  <div className="text-gray-300 flex-shrink-0">←</div>

                  {/* Excel column picker */}
                  <select
                    value={mapping[col.key] || ''}
                    onChange={e => setMapping({ ...mapping, [col.key]: e.target.value || undefined })}
                    className={`flex-1 border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500
                      ${mapping[col.key] ? 'border-green-300 bg-green-50' : 'border-gray-300'}`}
                  >
                    <option value="">— not mapped —</option>
                    {currentSheet.headers.map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Preview toggle */}
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            {showPreview ? 'Hide' : 'Show'} file preview (first 10 rows)
          </button>

          {showPreview && (
            <div className="overflow-x-auto border border-gray-200 rounded-xl">
              <table className="text-xs w-max">
                <thead>
                  <tr className="bg-gray-50">
                    {currentSheet.headers.map(h => (
                      <th key={h} className="px-3 py-2 text-left font-semibold text-gray-600 border-b border-gray-200 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {currentSheet.preview.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      {currentSheet.headers.map(h => (
                        <td key={h} className="px-3 py-2 text-gray-600 whitespace-nowrap max-w-xs truncate">
                          {row[h] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Import options */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 flex gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={options.updateExisting}
                onChange={e => setOptions({ ...options, updateExisting: e.target.checked })}
                className="w-4 h-4"
              />
              Update existing records if admission number matches
            </label>
          </div>

          {/* Validate button */}
          <div className="flex justify-end">
            <button
              onClick={validate}
              disabled={loading}
              className="bg-blue-700 hover:bg-blue-800 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {loading ? 'Checking…' : 'Validate →'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Validate & Import ──────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">

          {/* Import result (after actual import) */}
          {importResult && (
            <div className={`p-4 rounded-xl border ${importResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              {importResult.success ? (
                <div>
                  <p className="font-semibold text-green-800 mb-2">✅ Import complete</p>
                  <div className="flex gap-6 text-sm text-green-700">
                    <span>✅ {importResult.inserted} inserted</span>
                    {importResult.updated > 0 && <span>✏️ {importResult.updated} updated</span>}
                    {importResult.skipped > 0 && <span>⏭️ {importResult.skipped} skipped (duplicates)</span>}
                    {importResult.errorCount > 0 && <span>❌ {importResult.errorCount} rows had errors</span>}
                  </div>
                  <button
                    onClick={reset}
                    className="mt-3 text-sm text-green-700 underline hover:text-green-900"
                  >
                    Import another file
                  </button>
                </div>
              ) : (
                <p className="text-red-700 text-sm">{importResult.message}</p>
              )}
            </div>
          )}

          {/* Validation summary (before import) */}
          {!importResult && validationResult && (
            <>
              <div className="grid grid-cols-3 gap-4">
                <SummaryCard
                  icon="✅"
                  label="Ready to import"
                  value={validationResult.validCount ?? currentSheet?.totalRows - (validationResult.errorCount || 0)}
                  colour="green"
                />
                <SummaryCard
                  icon="❌"
                  label="Rows with errors"
                  value={validationResult.errorCount || 0}
                  colour={validationResult.errorCount > 0 ? 'red' : 'gray'}
                />
                <SummaryCard
                  icon="📋"
                  label="Total rows"
                  value={currentSheet?.totalRows || 0}
                  colour="gray"
                />
              </div>

              {/* Error detail */}
              {validationResult.errorCount > 0 && (
                <div className="border border-red-200 rounded-xl overflow-hidden">
                  <div className="bg-red-50 px-4 py-2.5 border-b border-red-200">
                    <p className="text-sm font-semibold text-red-700">
                      ⚠️ {validationResult.errorCount} rows could not be imported
                      {validationResult.errorCount > 20 ? ' (showing first 20)' : ''}
                    </p>
                  </div>
                  <div className="divide-y divide-red-100 max-h-64 overflow-y-auto">
                    {(validationResult.errors || []).map((e, i) => (
                      <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                        <span className="text-xs text-red-400 font-mono mt-0.5 flex-shrink-0">
                          Row {e.rowNum}
                        </span>
                        <div>
                          {e.errors.map((err, j) => (
                            <p key={j} className="text-xs text-red-600">{err}</p>
                          ))}
                        </div>
                        <span className="text-xs text-gray-400 ml-auto flex-shrink-0 truncate max-w-xs">
                          {e.data[Object.keys(e.data)[0]]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-gray-500 hover:text-gray-700 underline"
                >
                  ← Back to mapping
                </button>

                <div className="flex gap-3">
                  {validationResult.errorCount > 0 && (
                    <button
                      onClick={() => doImport(true)}
                      disabled={loading}
                      className="border border-orange-300 text-orange-700 hover:bg-orange-50 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                    >
                      {loading ? 'Importing…' : `Import ${validationResult.validCount ?? '?'} valid rows, skip errors`}
                    </button>
                  )}
                  {validationResult.errorCount === 0 && (
                    <button
                      onClick={() => doImport(false)}
                      disabled={loading}
                      className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      {loading ? 'Importing…' : `Import all ${currentSheet?.totalRows} rows`}
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small summary card ────────────────────────────────────────
function SummaryCard({ icon, label, value, colour }) {
  const colours = {
    green: 'bg-green-50 border-green-200 text-green-800',
    red:   'bg-red-50   border-red-200   text-red-800',
    gray:  'bg-gray-50  border-gray-200  text-gray-700',
  };
  return (
    <div className={`border rounded-xl p-4 ${colours[colour]}`}>
      <p className="text-xs font-medium opacity-70 mb-1">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
      <p className="text-lg mt-1">{icon}</p>
    </div>
  );
}
