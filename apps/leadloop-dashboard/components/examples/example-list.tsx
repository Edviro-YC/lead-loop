"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ExampleForm } from "./example-form";
import { Pencil, Trash2, Bookmark } from "lucide-react";

interface Example {
  id: string;
  context: string;
  subject: string | null;
  body: string;
  outcome: string | null;
  tags: string[] | null;
  created_at: string;
}

const OUTCOME_LABELS: Record<string, string> = {
  replied: "Got reply",
  meeting_booked: "Meeting",
  converted: "Converted",
};

export function ExampleList({ examples }: { examples: Example[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Example | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function handleDelete(id: string) {
    if (!confirm("Delete this example?")) return;
    const supabase = createClient();
    await supabase.from("outreach_examples").delete().eq("id", id);
    router.refresh();
  }

  function handleSaved() {
    setEditing(null);
    setShowNew(false);
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Outreach Examples</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {examples.length} curated example{examples.length !== 1 ? "s" : ""} for AI reply suggestions.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Add Example
        </button>
      </div>

      <div className="p-6">
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
            {examples.map((ex) => (
              <div
                key={ex.id}
                className="rounded-lg border border-border p-4 space-y-2"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{ex.context}</p>
                      {ex.outcome && (
                        <span className="shrink-0 rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">
                          {OUTCOME_LABELS[ex.outcome] ?? ex.outcome}
                        </span>
                      )}
                    </div>
                    {ex.subject && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Subject: {ex.subject}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1 ml-2">
                    <button
                      onClick={() => setEditing(ex)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(ex.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs leading-relaxed">
                  {ex.body.length > 400 ? ex.body.slice(0, 400) + "..." : ex.body}
                </p>

                {(ex.tags?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {ex.tags!.map((tag) => (
                      <span
                        key={tag}
                        className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {(showNew || editing) && (
        <ExampleForm
          example={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
