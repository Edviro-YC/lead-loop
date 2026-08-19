"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { workerFetch } from "@/lib/api";
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Send,
  Square,
  Trash2,
  X,
  Zap,
} from "lucide-react";

interface Step {
  body: string;
  delay_days: number;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  steps: Step[];
}

interface Run {
  id: string;
  subject: string | null;
  status: string;
  sequence_id: string;
  sequence_step: number;
  variables: Record<string, string> | null;
  last_activity_at: string | null;
}

interface Schedule {
  thread_id: string;
  status: string;
  scheduled_for: string;
  acted_at: string | null;
}

interface DraftNowResult {
  queued: string[];
  skipped: Array<{ run_id: string; reason: string }>;
}

interface SendDraftsResult {
  results: Array<{ run_id: string; outcome: string; detail?: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  replied: "bg-green-100 text-green-700",
  completed: "bg-muted text-muted-foreground",
  stopped: "bg-amber-100 text-amber-700",
};

const DRAFT_STATE_LABEL: Record<string, string> = {
  draft_created: "draft ready to send",
  sending: "sending…",
  draft_missing: "draft missing in Gmail",
};

const SEND_OUTCOME_LABEL: Record<string, string> = {
  sent: "Sent",
  already_sent: "Already sent",
  skipped_reply: "Skipped — lead replied",
  superseded: "Superseded — a manual email replaced the draft",
  draft_missing: "Draft missing in Gmail",
  no_draft: "No unsent draft",
  not_found: "Run not found",
  failed: "Failed",
};

// Server caps per call; larger explicit selections are chunked client-side.
const DRAFT_NOW_LIMIT = 50;
const SEND_LIMIT = 20;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Same contract as the Worker's lib/render.ts — {{email}} is auto-filled. */
function requiredVariables(steps: Step[]): string[] {
  const text = steps.map((s) => s.body).join("\n");
  const names = [...text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
  return [...new Set(names)].filter((v) => v !== "email");
}

async function callWorker<T = unknown>(path: string, body?: unknown): Promise<T> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");
  return workerFetch<T>(path, { method: "POST", token: session.access_token, body });
}

export function SequenceBoard({
  sequences,
  runs,
  schedules,
}: {
  sequences: Sequence[];
  runs: Run[];
  schedules: Schedule[];
}) {
  const router = useRouter();
  const [editingSeq, setEditingSeq] = useState<Sequence | null>(null);
  const [showNewSeq, setShowNewSeq] = useState(false);
  const [startingSeq, setStartingSeq] = useState<Sequence | null>(null);
  const [stepsDraft, setStepsDraft] = useState<Record<string, Step[]>>({});
  const [savingSteps, setSavingSteps] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [actionBusy, setActionBusy] = useState(false);

  // Pending/draft states are kept separate: a run can have a created draft
  // (sendable) and its next pending step (bumpable is exclusive of it).
  const cadenceByRun = new Map<string, Schedule>();
  const unsentDraftByRun = new Map<string, Schedule>();
  for (const s of schedules) {
    if (s.status === "pending" || s.status === "drafting") {
      if (!cadenceByRun.has(s.thread_id)) cadenceByRun.set(s.thread_id, s);
    } else {
      const prev = unsentDraftByRun.get(s.thread_id);
      if (!prev || (s.acted_at ?? "") > (prev.acted_at ?? "")) {
        unsentDraftByRun.set(s.thread_id, s);
      }
    }
  }

  const canDraftNow = (run: Run) =>
    run.status === "active" &&
    cadenceByRun.get(run.id)?.status === "pending" &&
    !unsentDraftByRun.has(run.id);
  const canSend = (run: Run) => unsentDraftByRun.has(run.id);

  const draftEligible = runs.filter(canDraftNow).map((r) => r.id);
  const sendEligible = runs.filter(canSend).map((r) => r.id);
  const allEligible = [...new Set([...draftEligible, ...sendEligible])];
  const selectedDraftable = draftEligible.filter((id) => selected.has(id));
  const selectedSendable = sendEligible.filter((id) => selected.has(id));

  function toggleRun(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  // "Select all" explicitly materializes every eligible run id — an empty
  // selection is never treated as "all" anywhere in this flow.
  function toggleSelectAllEligible() {
    const allSelected = allEligible.length > 0 && allEligible.every((id) => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(allEligible));
  }

  async function handleDraftNow() {
    if (selectedDraftable.length === 0 || actionBusy) return;
    setActionBusy(true);
    try {
      let queued = 0;
      const skipped: DraftNowResult["skipped"] = [];
      for (const ids of chunk(selectedDraftable, DRAFT_NOW_LIMIT)) {
        const res = await callWorker<DraftNowResult>("/api/runs/draft-now", { run_ids: ids });
        queued += res.queued.length;
        skipped.push(...res.skipped);
      }
      const lines = [`Queued ${queued} draft${queued === 1 ? "" : "s"} — they appear in Gmail momentarily.`];
      if (skipped.length > 0) {
        lines.push(`Skipped ${skipped.length}:`);
        for (const s of skipped) lines.push(`• ${runEmail(s.run_id)}: ${s.reason}`);
      }
      alert(lines.join("\n"));
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleSendDrafts() {
    if (selectedSendable.length === 0 || actionBusy) return;
    const n = selectedSendable.length;
    if (
      !confirm(
        `Send ${n} LeadLoop draft${n === 1 ? "" : "s"} to ${n === 1 ? "its recipient" : "their recipients"} now? ` +
          "This sends real email and cannot be undone."
      )
    ) {
      return;
    }
    setActionBusy(true);
    try {
      const results: SendDraftsResult["results"] = [];
      for (const ids of chunk(selectedSendable, SEND_LIMIT)) {
        const res = await callWorker<SendDraftsResult>("/api/runs/send-drafts", { run_ids: ids });
        results.push(...res.results);
      }
      const counts = new Map<string, number>();
      for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
      const lines = [...counts.entries()].map(
        ([outcome, count]) => `${SEND_OUTCOME_LABEL[outcome] ?? outcome}: ${count}`
      );
      for (const r of results) {
        if (r.outcome === "failed" || r.outcome === "draft_missing") {
          lines.push(`• ${runEmail(r.run_id)}: ${r.detail ?? r.outcome}`);
        }
      }
      alert(lines.join("\n"));
      setSelected(new Set());
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setActionBusy(false);
    }
  }

  function runEmail(runId: string): string {
    const run = runs.find((r) => r.id === runId);
    return run?.variables?.email ?? run?.subject ?? runId.slice(0, 8);
  }

  const savedSteps = (seq: Sequence) => seq.steps ?? [];
  const steps = (seq: Sequence) => stepsDraft[seq.id] ?? savedSteps(seq);

  const isDirty = (seq: Sequence) =>
    stepsDraft[seq.id] !== undefined &&
    JSON.stringify(stepsDraft[seq.id]) !== JSON.stringify(savedSteps(seq));

  function editStep(seq: Sequence, index: number, patch: Partial<Step>) {
    const next = steps(seq).map((s, i) => (i === index ? { ...s, ...patch } : s));
    setStepsDraft({ ...stepsDraft, [seq.id]: next });
  }

  function moveStep(seq: Sequence, index: number, delta: number) {
    const next = [...steps(seq)];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStepsDraft({ ...stepsDraft, [seq.id]: next });
  }

  function removeStep(seq: Sequence, index: number) {
    const next = steps(seq).filter((_, i) => i !== index);
    setStepsDraft({ ...stepsDraft, [seq.id]: next });
  }

  function addStep(seq: Sequence) {
    setStepsDraft({
      ...stepsDraft,
      [seq.id]: [...steps(seq), { body: "", delay_days: 3 }],
    });
  }

  async function saveSteps(seq: Sequence) {
    setSavingSteps(seq.id);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("sequences")
        .update({ steps: stepsDraft[seq.id] })
        .eq("id", seq.id);
      if (error) throw new Error(error.message);
      const { [seq.id]: _saved, ...rest } = stepsDraft;
      setStepsDraft(rest);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSteps(null);
    }
  }

  async function deleteSequence(seq: Sequence) {
    if (!confirm(`Delete sequence "${seq.name}"? Runs assigned to it are unassigned.`)) return;
    const supabase = createClient();
    const { error } = await supabase.from("sequences").delete().eq("id", seq.id);
    if (error) {
      alert(`Delete failed: ${error.message}`);
      return;
    }
    router.refresh();
  }

  async function stopRun(run: Run) {
    if (!confirm("Stop this run? No more drafts will be created.")) return;
    try {
      await callWorker(`/api/runs/${run.id}/stop`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  async function saveRunAsExample(run: Run) {
    try {
      await callWorker(`/api/runs/${run.id}/save-as-example`, {});
      alert("Saved to Examples for the GTM team.");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Sequences</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Each sequence carries its follow-up emails. Send the personalized first email,
            then start a run.
          </p>
        </div>
        <button
          onClick={() => setShowNewSeq(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New Sequence
        </button>
      </div>

      {runs.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-6 py-2.5">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input
              type="checkbox"
              checked={allEligible.length > 0 && allEligible.every((id) => selected.has(id))}
              onChange={toggleSelectAllEligible}
              disabled={allEligible.length === 0 || actionBusy}
              aria-label="Select all eligible runs"
              className="h-3.5 w-3.5 accent-primary"
            />
            Select all eligible ({allEligible.length})
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleDraftNow}
              disabled={actionBusy || selectedDraftable.length === 0}
              title="Create the next follow-up draft immediately for the selected runs. Drafts only — sends nothing."
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Zap className="h-3 w-3" />
              {actionBusy ? "Working…" : `Draft now (${selectedDraftable.length}/${draftEligible.length})`}
            </button>
            <button
              onClick={handleSendDrafts}
              disabled={actionBusy || selectedSendable.length === 0}
              title="Send the selected runs' LeadLoop-created Gmail drafts. Sends real email."
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              {actionBusy
                ? "Working…"
                : `Send LeadLoop drafts (${selectedSendable.length}/${sendEligible.length})`}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-8 p-6">
        {sequences.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <ListOrdered className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No sequences yet. Create one, then write its follow-up steps inline.
            </p>
          </div>
        )}

        {sequences.map((seq) => {
          const draft = steps(seq);
          const seqRuns = runs.filter((r) => r.sequence_id === seq.id);
          const totalSteps = savedSteps(seq).length;
          const canSave = draft.every((s) => s.body.trim().length > 0 && s.delay_days >= 1);

          return (
            <section key={seq.id} className="rounded-lg border border-border">
              <div className="flex items-start justify-between border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold">{seq.name}</h2>
                  {seq.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{seq.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setStartingSeq(seq)}
                    disabled={totalSteps === 0}
                    title={totalSteps === 0 ? "Add steps first" : "Start a run"}
                    className="mr-1 flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    <Play className="h-3 w-3" /> Start run
                  </button>
                  <button
                    onClick={() => setEditingSeq(seq)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => deleteSequence(seq)}
                    className="p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Steps editor: each step is a follow-up email body + delay */}
              <div className="space-y-2 px-4 py-3">
                {draft.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No steps yet. Step 1 is drafted after your first email; each next step
                    after the previous one. Bodies thread as {'"Re:"'} replies.
                  </p>
                )}
                {draft.map((step, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <span className="mt-1.5 w-6 shrink-0 text-xs font-semibold text-muted-foreground">
                      {i + 1}.
                    </span>
                    <textarea
                      value={step.body}
                      onChange={(e) => editStep(seq, i, { body: e.target.value })}
                      rows={Math.min(8, Math.max(2, step.body.split("\n").length))}
                      placeholder="Follow-up body… use {{variables}} like {{first_name}}"
                      className="min-w-0 flex-1 resize-y rounded-md border border-transparent px-2 py-1 text-xs leading-relaxed focus:border-primary focus:outline-none"
                    />
                    <label className="mt-1 flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                      wait
                      <input
                        type="number"
                        min={1}
                        value={step.delay_days}
                        onChange={(e) =>
                          editStep(seq, i, { delay_days: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-12 rounded border border-border px-1 py-0.5 text-xs focus:border-primary focus:outline-none"
                      />
                      d
                    </label>
                    <div className="mt-0.5 flex shrink-0 gap-0.5">
                      <button
                        onClick={() => moveStep(seq, i, -1)}
                        disabled={i === 0}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => moveStep(seq, i, 1)}
                        disabled={i === draft.length - 1}
                        className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => removeStep(seq, i)}
                        className="p-1 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => addStep(seq)}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <Plus className="h-3 w-3" /> Add step
                  </button>
                  {isDirty(seq) && (
                    <>
                      <button
                        onClick={() => saveSteps(seq)}
                        disabled={savingSteps === seq.id || !canSave}
                        title={canSave ? undefined : "Every step needs a body and a wait of at least 1 day"}
                        className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {savingSteps === seq.id ? "Saving…" : "Save steps"}
                      </button>
                      <button
                        onClick={() => {
                          const { [seq.id]: _discarded, ...rest } = stepsDraft;
                          setStepsDraft(rest);
                        }}
                        className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        Discard
                      </button>
                    </>
                  )}
                </div>
                {draft.length > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Variables:{" "}
                    {requiredVariables(draft).length
                      ? requiredVariables(draft)
                          .map((v) => `{{${v}}}`)
                          .join(", ")
                      : "none"}{" "}
                    · {"{{email}}"} fills automatically
                  </p>
                )}
              </div>

              {/* Runs */}
              {seqRuns.length > 0 && (
                <div className="border-t border-border px-4 py-3">
                  <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                    Runs ({seqRuns.length})
                  </h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[10px] uppercase text-muted-foreground">
                        <th className="w-6 pb-1.5 pr-2 font-medium"></th>
                        <th className="pb-1.5 pr-2 font-medium">To</th>
                        <th className="pb-1.5 pr-2 font-medium">Step</th>
                        <th className="pb-1.5 pr-2 font-medium">Status</th>
                        <th className="pb-1.5 pr-2 font-medium">Next draft</th>
                        <th className="pb-1.5 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {seqRuns.map((run) => {
                        const next = cadenceByRun.get(run.id)?.scheduled_for;
                        const unsentDraft = unsentDraftByRun.get(run.id);
                        return (
                          <tr key={run.id} className="border-t border-border/60">
                            <td className="py-2 pr-2">
                              {(canDraftNow(run) || canSend(run)) && (
                                <input
                                  type="checkbox"
                                  checked={selected.has(run.id)}
                                  onChange={() => toggleRun(run.id)}
                                  disabled={actionBusy}
                                  aria-label={`Select run to ${run.variables?.email ?? run.subject ?? "lead"}`}
                                  className="h-3.5 w-3.5 accent-primary"
                                />
                              )}
                            </td>
                            <td className="max-w-[220px] truncate py-2 pr-2">
                              <span className="font-medium">
                                {run.variables?.email ?? "—"}
                              </span>
                              {run.subject && (
                                <span className="ml-1.5 text-muted-foreground">
                                  {run.subject}
                                </span>
                              )}
                            </td>
                            <td className="py-2 pr-2">
                              {Math.min(run.sequence_step, totalSteps || run.sequence_step)}/
                              {totalSteps || "?"}
                            </td>
                            <td className="py-2 pr-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                  STATUS_STYLES[run.status] ?? "bg-muted"
                                }`}
                              >
                                {run.status}
                              </span>
                            </td>
                            <td className="py-2 pr-2 text-muted-foreground">
                              {unsentDraft ? (
                                <span className="font-medium text-amber-700">
                                  {DRAFT_STATE_LABEL[unsentDraft.status] ?? unsentDraft.status}
                                </span>
                              ) : run.status === "active" && next ? (
                                new Date(next).toLocaleDateString()
                              ) : (
                                "—"
                              )}
                            </td>
                            <td className="py-2 text-right">
                              {run.status === "active" && (
                                <button
                                  onClick={() => stopRun(run)}
                                  title="Stop run"
                                  className="p-1 text-muted-foreground hover:text-destructive"
                                >
                                  <Square className="h-3 w-3" />
                                </button>
                              )}
                              <button
                                onClick={() => saveRunAsExample(run)}
                                title="Save as example"
                                className="p-1 text-muted-foreground hover:text-foreground"
                              >
                                <Bookmark className="h-3 w-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {(showNewSeq || editingSeq) && (
        <SequenceForm
          sequence={editingSeq}
          onClose={() => {
            setShowNewSeq(false);
            setEditingSeq(null);
          }}
          onSaved={() => {
            setShowNewSeq(false);
            setEditingSeq(null);
            router.refresh();
          }}
        />
      )}

      {startingSeq && (
        <StartRunForm
          sequence={startingSeq}
          variables={requiredVariables(savedSteps(startingSeq))}
          onClose={() => setStartingSeq(null)}
          onStarted={() => {
            setStartingSeq(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function SequenceForm({
  sequence,
  onClose,
  onSaved,
}: {
  sequence: Sequence | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(sequence?.name ?? "");
  const [description, setDescription] = useState(sequence?.description ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not signed in");
      setSaving(false);
      return;
    }

    const payload = { name, description: description || null };
    const result = sequence
      ? await supabase.from("sequences").update(payload).eq("id", sequence.id)
      : await supabase.from("sequences").insert({ ...payload, user_id: user.id });

    if (result.error) {
      setError(result.error.message);
      setSaving(false);
      return;
    }
    onSaved();
  }

  return (
    <Modal title={sequence ? "Edit Sequence" : "New Sequence"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            placeholder='e.g., "K-12 facilities cold outreach"'
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            placeholder="Who this targets and what arc it follows"
          />
        </div>
        <FormFooter saving={saving} onClose={onClose} submitLabel={sequence ? "Update" : "Create"} />
      </form>
    </Modal>
  );
}

function StartRunForm({
  sequence,
  variables,
  onClose,
  onStarted,
}: {
  sequence: Sequence;
  variables: string[];
  onClose: () => void;
  onStarted: () => void;
}) {
  const [email, setEmail] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await callWorker("/api/runs/start", {
        sequence_id: sequence.id,
        recipient_email: email.trim(),
        variables: values,
      });
      onStarted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <Modal title={`Start run — ${sequence.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <p className="text-xs text-muted-foreground">
          Uses your newest sent Gmail thread to this address. Send the personalized first
          email before starting.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Recipient email
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            placeholder="sara@acme.com"
          />
        </div>
        {variables.map((v) => (
          <div key={v}>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              {`{{${v}}}`}
            </label>
            <input
              required
              value={values[v] ?? ""}
              onChange={(e) => setValues({ ...values, [v]: e.target.value })}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        ))}
        <FormFooter saving={saving} onClose={onClose} submitLabel="Start run" />
      </form>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-background border border-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FormFooter({
  saving,
  onClose,
  submitLabel,
}: {
  saving: boolean;
  onClose: () => void;
  submitLabel: string;
}) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onClose}
        className="rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {saving ? "Working…" : submitLabel}
      </button>
    </div>
  );
}
