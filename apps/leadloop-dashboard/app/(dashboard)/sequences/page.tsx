import { createClient } from "@/lib/supabase/server";
import { SequenceBoard } from "@/components/sequences/sequence-board";

export default async function SequencesPage() {
  const supabase = await createClient();
  const [{ data: sequences }, { data: runs }, { data: pending }] = await Promise.all([
    supabase
      .from("sequences")
      .select("id, name, description, steps")
      .order("created_at", { ascending: false }),
    supabase
      .from("watched_threads")
      .select("id, subject, status, sequence_id, sequence_step, variables, last_activity_at")
      .not("sequence_id", "is", null)
      .order("last_activity_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("scheduled_follow_ups")
      .select("thread_id, scheduled_for")
      .eq("status", "pending"),
  ]);

  return <SequenceBoard sequences={sequences ?? []} runs={runs ?? []} pending={pending ?? []} />;
}
