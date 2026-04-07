import { createClient } from "@/lib/supabase/server";
import { LeadList } from "@/components/leads/lead-list";

export default async function LeadsPage() {
  const supabase = await createClient();
  const { data: leads, count } = await supabase
    .from("leads")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .limit(100);

  return <LeadList leads={leads ?? []} total={count ?? 0} />;
}
