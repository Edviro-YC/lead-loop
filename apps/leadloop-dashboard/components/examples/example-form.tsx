"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { X } from "lucide-react";

interface ExampleFormProps {
  example?: {
    id: string;
    context: string;
    subject: string | null;
    body: string;
    outcome: string | null;
    tags: string[] | null;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

const OUTCOMES = [
  { value: "replied", label: "Got a reply" },
  { value: "meeting_booked", label: "Meeting booked" },
  { value: "converted", label: "Converted" },
];

export function ExampleForm({ example, onClose, onSaved }: ExampleFormProps) {
  const [context, setContext] = useState(example?.context ?? "");
  const [subject, setSubject] = useState(example?.subject ?? "");
  const [body, setBody] = useState(example?.body ?? "");
  const [outcome, setOutcome] = useState(example?.outcome ?? "replied");
  const [tagsStr, setTagsStr] = useState((example?.tags ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const tags = tagsStr
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      context,
      subject: subject || null,
      body,
      outcome,
      tags,
    };

    const result = example
      ? await supabase.from("outreach_examples").update(payload).eq("id", example.id)
      : await supabase.from("outreach_examples").insert(payload);

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }

    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-background border border-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">
            {example ? "Edit Example" : "Add Example"}
          </h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error && (
            <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Context
            </label>
            <input
              required
              value={context}
              onChange={(e) => setContext(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="e.g., SaaS founder, Series A, hiring engineers"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Describe the target persona, industry, or situation.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Email Body
            </label>
            <textarea
              required
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              placeholder="Paste the successful email text..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Outcome</label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              >
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Tags</label>
              <input
                value={tagsStr}
                onChange={(e) => setTagsStr(e.target.value)}
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="saas, cold-email"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : example ? "Update" : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
