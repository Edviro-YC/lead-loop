"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, RefreshCw, Bookmark } from "lucide-react";

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    const supabase = createClient();

    const { data: t } = await supabase
      .from("watched_threads")
      .select("id, subject, status, gmail_thread_id")
      .eq("id", threadId)
      .single();
    setThread(t);

    const { data: msgs } = await supabase
      .from("thread_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true });
    setMessages(msgs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
  }, [threadId]);

  async function saveAsExample() {
    const sentMsg = messages.find((m) => m.direction === "sent");
    if (!sentMsg) return;
    setSaving(true);

    const supabase = createClient();
    await supabase.from("outreach_examples").insert({
      context: `Thread: ${thread?.subject ?? "Unknown"}`,
      subject: thread?.subject,
      body: sentMsg.body_text ?? "",
      outcome: "replied",
      tags: [],
    });

    setSaving(false);
    alert("Saved as outreach example! Visit Examples page to edit details.");
    router.refresh();
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
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
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
            <button
              onClick={saveAsExample}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Bookmark className="h-3 w-3" />
              Save as Example
            </button>
          )}
          <button
            onClick={loadData}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading messages...</p>
        ) : messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No messages synced yet. The thread will sync automatically within 5 minutes.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => {
              const isSent = msg.direction === "sent";
              return (
                <div
                  key={msg.id}
                  className={`rounded-lg border p-4 ${
                    isSent
                      ? "border-primary/20 bg-accent ml-8"
                      : "border-border mr-8"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium">
                      {isSent ? "You" : msg.from_email || "Unknown"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDate(msg.sent_at)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                    {msg.body_text || msg.snippet || "(empty)"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
