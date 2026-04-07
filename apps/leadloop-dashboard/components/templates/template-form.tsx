"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { X } from "lucide-react";

interface TemplateFormProps {
  template?: {
    id: string;
    name: string;
    subject: string | null;
    body: string;
    category: string | null;
  } | null;
  onClose: () => void;
  onSaved: () => void;
}

const CATEGORIES = [
  { value: "initial_outreach", label: "Initial Outreach" },
  { value: "follow_up", label: "Follow-up" },
  { value: "reply", label: "Reply" },
];

function detectVariables(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(2, -2)))];
}

export function TemplateForm({ template, onClose, onSaved }: TemplateFormProps) {
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [category, setCategory] = useState(template?.category ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variables = detectVariables(`${subject} ${body}`);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const payload = {
      name,
      subject: subject || null,
      body,
      category: category || null,
      variables,
    };

    const result = template
      ? await supabase.from("templates").update(payload).eq("id", template.id)
      : await supabase.from("templates").insert(payload);

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
            {template ? "Edit Template" : "New Template"}
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
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="e.g., Cold outreach v1"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              <option value="">None</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="e.g., Quick question about {{company}}"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Body</label>
            <textarea
              required
              rows={8}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-md border border-border px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none"
              placeholder={"Hi {{first_name}},\n\nI noticed {{company}} is..."}
            />
          </div>

          {variables.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Variables:</span>
              {variables.map((v) => (
                <span key={v} className="rounded bg-accent px-1.5 py-0.5 text-xs font-mono text-primary">
                  {`{{${v}}}`}
                </span>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving..." : template ? "Update" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
