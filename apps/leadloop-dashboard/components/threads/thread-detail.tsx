"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { workerFetch } from "@/lib/api";
import { ArrowLeft, RefreshCw, Bookmark, ListOrdered, Minus, Plus, Clock } from "lucide-react";

interface Message {
  id: string;
  direction: string;
  from_email: string | null;
  to_email: string | null;
  subject: string | null;
  body_text: string | null;
  snippet: string | null;
  sent_at: string | null;
}

interface ThreadInfo {
  id: string;
  subject: string | null;
  status: string;
  gmail_thread_id: string;
  sequence_id: string | null;
  sequence_step: number;
}

interface SequenceOption {
  id: string;
  name: string;
}

/** Split an RFC 5322 From header like `Jane Doe <jane@x.com>` into name and address. */
function parseSender(from: string | null): { name: string; email: string } {
  const match = from?.match(/^\s*"?([^"<]*?)"?\s*<(.+?)>\s*$/);
  if (match?.[1]) return { name: match[1], email: match[2] };
  return { name: from || "Unknown", email: "" };
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, "")[0])
    .filter(Boolean);
  return (letters.slice(0, 2).join("") || name[0] || "?").toUpperCase();
}

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

/** Render plain text with bare URLs as clickable links. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
          >
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

export function ThreadDetail({
  threadId,
  onBack,
}: {
  threadId: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [thread, setThread] = useState<ThreadInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const [stepCount, setStepCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const [{ data: t }, { data: msgs }, { data: seqs }] = await Promise.all([
      supabase
        .from("watched_threads")
        .select("id, subject, status, gmail_thread_id, sequence_id, sequence_step")
        .eq("id", threadId)
        .single(),
      supabase
        .from("thread_messages")
        .select("*")
        .eq("thread_id", threadId)
        .order("sent_at", { ascending: true }),
      supabase.from("sequences").select("id, name").order("created_at", { ascending: false }),
    ]);
    setThread(t);
    setMessages(msgs ?? []);
    setSequences(seqs ?? []);

    if (t?.sequence_id) {
      const { count } = await supabase
        .from("outreach_examples")
        .select("id", { count: "exact", head: true })
        .eq("sequence_id", t.sequence_id);
      setStepCount(count);
    } else {
      setStepCount(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [threadId]);

  async function syncAndReload() {
    setSyncing(true);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      await workerFetch(`/api/threads/${threadId}/sync`, {
        method: "POST",
        token: session.access_token,
      });
    } catch (err) {
      alert(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
    await loadData();
  }

  /** Get the current session token or throw — callers surface the error. */
  async function sessionToken(): Promise<string> {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }

  // Goes through the Worker API so the example is embedded (and actually
  // saved — a direct insert without user_id is rejected by RLS).
  async function saveAsExample() {
    setSaving(true);
    try {
      await workerFetch(`/api/examples/from-thread/${threadId}`, {
        method: "POST",
        token: await sessionToken(),
        body: {},
      });
      alert("Saved as outreach example! Visit Examples page to edit details.");
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
    router.refresh();
  }

  async function saveAsSequence() {
    const name = prompt(
      "Sequence name:",
      `Sequence: ${thread?.subject ?? "Untitled thread"}`
    );
    if (!name?.trim()) return;
    setSaving(true);
    try {
      const result = await workerFetch<{ steps: unknown[] }>(
        `/api/sequences/from-thread/${threadId}`,
        { method: "POST", token: await sessionToken(), body: { name: name.trim() } }
      );
      alert(`Saved sequence "${name.trim()}" with ${result.steps.length} steps.`);
    } catch (err) {
      alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
    router.refresh();
  }

  async function scheduleFollowUp() {
    const days = parseInt(prompt("Days until follow-up:", "3") ?? "", 10);
    if (!days || days < 1) return;
    setSaving(true);
    try {
      await workerFetch(`/api/follow-ups/threads/${threadId}/follow-up`, {
        method: "POST",
        token: await sessionToken(),
        body: { delay_days: days },
      });
      alert(`Follow-up scheduled in ${days} day${days === 1 ? "" : "s"}.`);
    } catch (err) {
      alert(`Schedule failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  async function updateSequenceAssignment(updates: {
    sequence_id: string | null;
    sequence_step: number;
  }) {
    const supabase = createClient();
    const { error } = await supabase
      .from("watched_threads")
      .update(updates)
      .eq("id", threadId);
    if (error) {
      alert(`Update failed: ${error.message}`);
      return;
    }
    await loadData();
  }

  function formatDate(dateStr: string | null) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-6 py-4">
        <button onClick={onBack} className="p-1 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold truncate">
            {thread?.subject || "Thread"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {messages.some((m) => m.direction === "sent") && (
            <>
              <button
                onClick={saveAsExample}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <Bookmark className="h-3 w-3" />
                Save as Example
              </button>
              <button
                onClick={saveAsSequence}
                disabled={saving}
                title="Save every sent message in this thread as an ordered sequence of examples"
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <ListOrdered className="h-3 w-3" />
                Save as Sequence
              </button>
            </>
          )}
          <button
            onClick={scheduleFollowUp}
            disabled={saving}
            title="Draft a follow-up if there's no reply after N days"
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Clock className="h-3 w-3" />
            Schedule Follow-up
          </button>
          <button
            onClick={syncAndReload}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing..." : "Refresh"}
          </button>
        </div>
      </div>

      {!loading && thread && (
        <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-6 py-2">
          <ListOrdered className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <select
            value={thread.sequence_id ?? ""}
            onChange={(e) =>
              updateSequenceAssignment({
                sequence_id: e.target.value || null,
                sequence_step: 1,
              })
            }
            className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
          >
            <option value="">No sequence</option>
            {sequences.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          {thread.sequence_id && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <button
                onClick={() =>
                  updateSequenceAssignment({
                    sequence_id: thread.sequence_id,
                    sequence_step: thread.sequence_step - 1,
                  })
                }
                disabled={thread.sequence_step <= 1}
                className="rounded border border-border p-0.5 hover:bg-muted disabled:opacity-40"
                title="Previous step"
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="tabular-nums">
                Next step: {thread.sequence_step}
                {stepCount != null ? ` of ${stepCount}` : ""}
                {stepCount != null && thread.sequence_step > stepCount ? " (exhausted)" : ""}
              </span>
              <button
                onClick={() =>
                  updateSequenceAssignment({
                    sequence_id: thread.sequence_id,
                    sequence_step: thread.sequence_step + 1,
                  })
                }
                className="rounded border border-border p-0.5 hover:bg-muted"
                title="Next step"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mx-auto w-full max-w-3xl px-6 py-4">
        {loading ? (
          <div className="space-y-8 py-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse gap-4">
                <div className="h-9 w-9 shrink-0 rounded-full bg-muted" />
                <div className="flex-1 space-y-2.5 pt-1">
                  <div className="h-3 w-44 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No messages synced yet. The thread will sync automatically within 5 minutes.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {messages.map((msg) => {
              const isSent = msg.direction === "sent";
              const sender = isSent
                ? { name: "You", email: "" }
                : parseSender(msg.from_email);
              return (
                <div key={msg.id} className="flex gap-4 py-6">
                  <div
                    className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      isSent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {initialsOf(sender.name)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-sm font-semibold">{sender.name}</span>
                      {sender.email && (
                        <span className="truncate text-xs text-muted-foreground">
                          {sender.email}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatDate(msg.sent_at)}
                      </span>
                    </div>
                    <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      <Linkified text={msg.body_text || msg.snippet || "(empty)"} />
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
