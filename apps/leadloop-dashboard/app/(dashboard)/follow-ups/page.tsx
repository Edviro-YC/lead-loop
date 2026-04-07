import { createClient } from "@/lib/supabase/server";
import { FollowUpList } from "@/components/follow-ups/follow-up-list";

export default async function FollowUpsPage() {
  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("scheduled_follow_ups")
    .select(
      "*, watched_threads(subject, gmail_thread_id), follow_up_rules(delay_days, condition)"
    )
    .eq("status", "pending")
    .order("scheduled_for", { ascending: true });

  const { data: recent } = await supabase
    .from("scheduled_follow_ups")
    .select(
      "*, watched_threads(subject, gmail_thread_id), follow_up_rules(delay_days, condition)"
    )
    .neq("status", "pending")
    .order("acted_at", { ascending: false, nullsFirst: false })
    .limit(20);

  return <FollowUpList pending={pending ?? []} recent={recent ?? []} />;
}
