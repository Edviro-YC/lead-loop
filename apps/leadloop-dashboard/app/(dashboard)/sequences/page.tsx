import { createClient } from "@/lib/supabase/server";
import { SequenceBoard } from "@/components/sequences/sequence-board";

export default async function SequencesPage() {
  const supabase = await createClient();
  // Actionable schedule rows only: the cadence row (pending/drafting) drives
  // "next draft"/Draft now; outstanding draft rows drive Send LeadLoop drafts.
  // A run can have both at once (created draft + its next pending step).
  const [{ data: sequences }, { data: runs }, { data: schedules }] = await Promise.all([
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
      .select("thread_id, status, scheduled_for, acted_at")
      .in("status", ["pending", "drafting", "draft_created", "sending", "draft_missing"]),
  ]);

  return (
    <SequenceBoard sequences={sequences ?? []} runs={runs ?? []} schedules={schedules ?? []} />
  );
}
