"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ExampleForm } from "./example-form";
import { Pencil, Trash2, Bookmark, ListOrdered } from "lucide-react";

interface Example {
  id: string;
  context: string;
  subject: string | null;
  body: string;
  outcome: string | null;
  tags: string[] | null;
  sequence_id: string | null;
  created_at: string;
}

export interface Sequence {
  id: string;
  name: string;
  description: string | null;
}

const OUTCOME_LABELS: Record<string, string> = {
  replied: "Got reply",
  meeting_booked: "Meeting",
  converted: "Converted",
};

function ExampleCard({
  example,
  sequenceName,
  onEdit,
  onDelete,
}: {
  example: Example;
  sequenceName: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{example.context}</p>
            {example.outcome && (
              <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                {OUTCOME_LABELS[example.outcome] ?? example.outcome}
              </span>
            )}
            {sequenceName && (
              <span className="flex shrink-0 items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
                <ListOrdered className="h-2.5 w-2.5" />
                {sequenceName}
              </span>
            )}
          </div>
          {example.subject && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Subject: {example.subject}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1 ml-2">
          <button onClick={onEdit} className="p-1 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs leading-relaxed">
        {example.body.length > 400 ? example.body.slice(0, 400) + "..." : example.body}
      </p>

      {(example.tags?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {example.tags!.map((tag) => (
            <span key={tag} className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-primary">
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExampleList({
  examples,
  sequences,
}: {
  examples: Example[];
  sequences: Sequence[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Example | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("");
  const [sequenceFilter, setSequenceFilter] = useState("");

  const sequenceName = new Map(sequences.map((s) => [s.id, s.name]));

  async function handleDelete(id: string) {
    if (!confirm("Delete this example?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("outreach_examples").delete().eq("id", id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    router.refresh();
  }

  function handleSaved() {
    setEditing(null);
    setShowNew(false);
    router.refresh();
  }

  const needle = filter.trim().toLowerCase();
  const visible = examples.filter((ex) => {
    if (sequenceFilter && ex.sequence_id !== sequenceFilter) return false;
    if (!needle) return true;
    return [ex.context, ex.subject ?? "", ex.body, ...(ex.tags ?? [])]
      .join("\n")
      .toLowerCase()
      .includes(needle);
  });

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Outreach Examples</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {examples.length} winning conversation{examples.length !== 1 ? "s" : ""} tagged
            for the GTM team.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add Example
        </button>
      </div>

      <div className="space-y-4 p-6">
        {examples.length > 0 && (
          <div className="flex gap-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full max-w-sm rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Filter by text or tag…"
            />
            {sequences.length > 0 && (
              <select
                value={sequenceFilter}
                onChange={(e) => setSequenceFilter(e.target.value)}
                className="rounded-md border border-border px-2 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">All sequences</option>
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {examples.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <Bookmark className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No examples yet. When a run gets a reply, save it here (one click on the
              Sequences page, in Gmail, or via MCP).
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No examples match the filter.</p>
        ) : (
          <div className="space-y-3">
            {visible.map((ex) => (
              <ExampleCard
                key={ex.id}
                example={ex}
                sequenceName={ex.sequence_id ? (sequenceName.get(ex.sequence_id) ?? null) : null}
                onEdit={() => setEditing(ex)}
                onDelete={() => handleDelete(ex.id)}
              />
            ))}
          </div>
        )}
      </div>

      {(showNew || editing) && (
        <ExampleForm
          example={editing}
          sequences={sequences}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
