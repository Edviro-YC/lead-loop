"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { MessageSquare, Eye, Pause, CheckCircle, XCircle } from "lucide-react";
import { ThreadDetail } from "./thread-detail";

interface WatchedThread {
  id: string;
  gmail_thread_id: string;
  subject: string | null;
  status: string;
  last_synced_at: string | null;
  last_activity_at: string | null;
  created_at: string;
  leads: { name: string | null; email: string; company: string | null } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Eye }> = {
  active: { label: "Active", color: "bg-green-100 text-green-700", icon: Eye },
  paused: { label: "Paused", color: "bg-yellow-100 text-yellow-700", icon: Pause },
  completed: { label: "Completed", color: "bg-blue-100 text-blue-700", icon: CheckCircle },
  lost: { label: "Lost", color: "bg-gray-100 text-gray-500", icon: XCircle },
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ThreadList({ threads }: { threads: WatchedThread[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const filtered = filter === "all" ? threads : threads.filter((t) => t.status === filter);

  async function updateStatus(id: string, status: string) {
    const supabase = createClient();
    await supabase.from("watched_threads").update({ status }).eq("id", id);
    router.refresh();
  }

  if (selected) {
    return (
      <ThreadDetail
        threadId={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Watched Threads</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {threads.length} thread{threads.length !== 1 ? "s" : ""} being monitored.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-border p-0.5">
          {["all", "active", "paused", "completed"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                filter === f ? "bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center">
            <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              {threads.length === 0
                ? "No watched threads. Use the Gmail add-on to start watching threads."
                : "No threads match this filter."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((thread) => {
              const cfg = STATUS_CONFIG[thread.status] ?? STATUS_CONFIG.active;
              return (
                <div
                  key={thread.id}
                  className="flex items-center gap-4 rounded-lg border border-border p-4 hover:border-primary/30 transition-colors cursor-pointer"
                  onClick={() => setSelected(thread.id)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {thread.subject || "(no subject)"}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      {thread.leads && (
                        <span>{thread.leads.name || thread.leads.email}</span>
                      )}
                      <span>Synced {timeAgo(thread.last_synced_at)}</span>
                      <span>Activity {timeAgo(thread.last_activity_at)}</span>
                    </div>
                  </div>

                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
                    {cfg.label}
                  </span>

                  <div className="flex shrink-0 gap-1" onClick={(e) => e.stopPropagation()}>
                    {thread.status === "active" && (
                      <button
                        onClick={() => updateStatus(thread.id, "paused")}
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                        title="Pause"
                      >
                        <Pause className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {thread.status === "paused" && (
                      <button
                        onClick={() => updateStatus(thread.id, "active")}
                        className="p-1.5 text-muted-foreground hover:text-foreground"
                        title="Resume"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {(thread.status === "active" || thread.status === "paused") && (
                      <button
                        onClick={() => updateStatus(thread.id, "completed")}
                        className="p-1.5 text-muted-foreground hover:text-green-600"
                        title="Mark complete"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </button>
                    )}
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
