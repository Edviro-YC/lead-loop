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
  step_number: number | null;
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
  onEdit,
  onDelete,
}: {
  example: Example;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {example.step_number != null && (
              <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                Step {example.step_number}
              </span>
            )}
            <p className="text-sm font-medium">{example.context}</p>
            {example.outcome && (
              <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                {OUTCOME_LABELS[example.outcome] ?? example.outcome}
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

  async function handleNewSequence() {
    const name = prompt("Sequence name (e.g. \"K-12 facilities cold outreach\"):");
    if (!name?.trim()) return;
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      alert("Not signed in");
      return;
    }
    const { error } = await supabase
      .from("sequences")
      .insert({ user_id: user.id, name: name.trim() });
    if (error) {
      alert(`Create failed: ${error.message}`);
      return;
    }
    router.refresh();
  }

  async function handleDeleteSequence(seq: Sequence) {
    if (!confirm(`Delete sequence "${seq.name}"? Its steps become standalone examples.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("sequences").delete().eq("id", seq.id);
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

  const standalone = examples.filter((ex) => !ex.sequence_id);
  const stepsOf = (sequenceId: string) =>
    examples
      .filter((ex) => ex.sequence_id === sequenceId)
      .sort((a, b) => (a.step_number ?? 0) - (b.step_number ?? 0));

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Outreach Examples</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {examples.length} curated example{examples.length !== 1 ? "s" : ""}
            {sequences.length > 0 &&
              ` · ${sequences.length} sequence${sequences.length !== 1 ? "s" : ""}`}{" "}
            for AI reply suggestions.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleNewSequence}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            New Sequence
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Add Example
          </button>
        </div>
      </div>

      <div className="space-y-8 p-6">
        {sequences.map((seq) => {
          const steps = stepsOf(seq.id);
          return (
            <section key={seq.id}>
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-start gap-2">
                  <ListOrdered className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <h2 className="text-sm font-semibold">{seq.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {seq.description ? `${seq.description} · ` : ""}
                      {steps.length} step{steps.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteSequence(seq)}
                  className="p-1 text-muted-foreground hover:text-destructive"
                  title="Delete sequence (steps become standalone examples)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              {steps.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
                  No steps yet. Add an example and pick this sequence, or ask your agent to
                  build it via MCP.
                </p>
              ) : (
                <div className="space-y-3">
                  {steps.map((ex) => (
                    <ExampleCard
                      key={ex.id}
                      example={ex}
                      onEdit={() => setEditing(ex)}
                      onDelete={() => handleDelete(ex.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {sequences.length > 0 && standalone.length > 0 && (
          <h2 className="text-sm font-semibold text-muted-foreground">Standalone examples</h2>
        )}

        {examples.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <Bookmark className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No examples yet. Add successful outreach emails to improve AI reply suggestions.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              The more examples you add, the better LeadLoop gets at matching your voice and style.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {standalone.map((ex) => (
              <ExampleCard
                key={ex.id}
                example={ex}
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
