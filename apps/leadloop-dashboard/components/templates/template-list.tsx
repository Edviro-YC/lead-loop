"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TemplateForm } from "./template-form";
import { Pencil, Trash2, FileText } from "lucide-react";

interface Template {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  category: string | null;
  variables: string[] | null;
  is_active: boolean;
  created_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  initial_outreach: "Outreach",
  follow_up: "Follow-up",
  reply: "Reply",
};

export function TemplateList({ templates }: { templates: Template[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Template | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function handleDelete(id: string) {
    if (!confirm("Delete this template?")) return;
    const supabase = createClient();
    await supabase.from("templates").delete().eq("id", id);
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
          <h1 className="text-lg font-semibold">Templates</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage email templates for outreach and follow-ups.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New Template
        </button>
      </div>

      <div className="p-6">
        {templates.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <FileText className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No templates yet. Create your first template to get started.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((t) => (
              <div
                key={t.id}
                className="rounded-lg border border-border p-4 space-y-2 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <h3 className="text-sm font-semibold leading-tight">{t.name}</h3>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => setEditing(t)}
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      className="p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {t.subject && (
                  <p className="text-xs text-muted-foreground truncate">
                    Subject: {t.subject}
                  </p>
                )}
                <p className="text-xs text-muted-foreground line-clamp-3">
                  {t.body}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  {t.category && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                      {CATEGORY_LABELS[t.category] ?? t.category}
                    </span>
                  )}
                  {(t.variables?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      {t.variables!.length} var{t.variables!.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(showNew || editing) && (
        <TemplateForm
          template={editing}
          onClose={() => { setShowNew(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </>
  );
}
