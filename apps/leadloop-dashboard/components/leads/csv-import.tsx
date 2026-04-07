"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { X, Upload } from "lucide-react";

interface CsvImportProps {
  onClose: () => void;
  onImported: () => void;
}

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/['"]/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (values[i]) row[h] = values[i];
    });
    return row;
  });
}

export function CsvImport({ onClose, onImported }: CsvImportProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setResult(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCsv(ev.target?.result as string);
      if (!rows.length) {
        setError("No data rows found. Ensure the CSV has headers: email, name, company, title");
        return;
      }
      if (!rows[0].email) {
        setError("CSV must have an 'email' column.");
        return;
      }
      setPreview(rows.slice(0, 5));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);

    const text = await file.text();
    const rows = parseCsv(text);
    const leads = rows
      .filter((r) => r.email)
      .map((r) => ({
        email: r.email,
        name: r.name || null,
        company: r.company || null,
        title: r.title || null,
      }));

    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("leads")
      .upsert(
        leads.map((l) => ({ ...l, source: "csv" })),
        { onConflict: "user_id,email", ignoreDuplicates: true }
      )
      .select();

    if (err) {
      setError(err.message);
      setImporting(false);
      return;
    }

    setResult(`Imported ${data?.length ?? 0} of ${leads.length} leads.`);
    setImporting(false);
    setTimeout(() => onImported(), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-background border border-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">Import Leads from CSV</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          {result && <div className="rounded-md bg-green-50 p-2 text-sm text-green-700">{result}</div>}

          <div>
            <p className="mb-2 text-xs text-muted-foreground">
              Upload a CSV with columns: <span className="font-mono">email</span>,{" "}
              <span className="font-mono">name</span>,{" "}
              <span className="font-mono">company</span>,{" "}
              <span className="font-mono">title</span>
            </p>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 transition-colors hover:border-primary/40">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Choose CSV file</span>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFile}
              />
            </label>
          </div>

          {preview.length > 0 && (
            <div className="overflow-x-auto rounded border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted">
                    {Object.keys(preview[0]).map((h) => (
                      <th key={h} className="px-3 py-1.5 text-left font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-3 py-1.5 truncate max-w-[150px]">{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="px-3 py-1 text-[10px] text-muted-foreground">
                Preview (first 5 rows)
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button
              onClick={handleImport}
              disabled={importing || !preview.length}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
