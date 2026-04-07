import { createClient } from "@/lib/supabase/server";
import { ThreadList } from "@/components/threads/thread-list";

export default async function ThreadsPage() {
  const supabase = await createClient();
  const { data: threads } = await supabase
    .from("watched_threads")
    .select("*, leads(name, email, company)")
    .order("last_activity_at", { ascending: false, nullsFirst: false });

  return <ThreadList threads={threads ?? []} />;
}
