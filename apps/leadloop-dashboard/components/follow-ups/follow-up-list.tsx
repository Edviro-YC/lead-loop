"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Clock, X, FileText, CheckCircle } from "lucide-react";

interface ScheduledFollowUp {
  id: string;
  scheduled_for: string;
  status: string;
  generated_body: string | null;
  draft_gmail_id: string | null;
  acted_at: string | null;
  created_at: string;
  watched_threads: { subject: string | null; gmail_thread_id: string } | null;
  follow_up_rules: { delay_days: number; condition: string } | null;
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function daysUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  draft_created: "bg-blue-100 text-blue-700",
  dismissed: "bg-gray-100 text-gray-500",
  sent: "bg-green-100 text-green-700",
};

export function FollowUpList({
  pending,
  recent,
}: {
  pending: ScheduledFollowUp[];
  recent: ScheduledFollowUp[];
}) {
  const router = useRouter();

  async function dismiss(id: string) {
    const supabase = createClient();
    await supabase
      .from("scheduled_follow_ups")
      .update({ status: "dismissed", acted_at: new Date().toISOString() })
      .eq("id", id);
    router.refresh();
  }

  return (
    <>
      <div className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Follow-ups</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pending and past follow-up suggestions.
        </p>
      </div>

      <div className="p-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Upcoming */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-yellow-600" />
              Upcoming ({pending.length})
            </h2>

            {pending.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">No pending follow-ups.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {pending.map((fu) => (
                  <div key={fu.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {fu.watched_threads?.subject || "Unknown thread"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Scheduled {daysUntil(fu.scheduled_for)} · {formatDate(fu.scheduled_for)}
                        </p>
                      </div>
                      <button
                        onClick={() => dismiss(fu.id)}
                        className="shrink-0 p-1 text-muted-foreground hover:text-destructive"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {fu.follow_up_rules && (
                      <p className="text-[10px] text-muted-foreground">
                        Every {fu.follow_up_rules.delay_days}d · Condition: {fu.follow_up_rules.condition}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent */}
          <div>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CheckCircle className="h-4 w-4 text-blue-600" />
              Recent ({recent.length})
            </h2>

            {recent.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">No recent follow-up activity.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map((fu) => (
                  <div key={fu.id} className="rounded-lg border border-border p-3 space-y-1">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium truncate">
                        {fu.watched_threads?.subject || "Unknown thread"}
                      </p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[fu.status] ?? ""}`}>
                        {fu.status.replace("_", " ")}
                      </span>
                    </div>
                    {fu.acted_at && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(fu.acted_at)}
                      </p>
                    )}
                    {fu.status === "draft_created" && fu.generated_body && (
                      <details className="pt-1">
                        <summary className="cursor-pointer text-xs text-primary">
                          View draft preview
                        </summary>
                        <p className="mt-1 whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                          {fu.generated_body.slice(0, 300)}
                          {fu.generated_body.length > 300 ? "..." : ""}
                        </p>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
